// Plan checks: structure (GSDC-18), verify-command probe (GSDC-19), failure directions (GSDC-20), decision and
// requirement coverage (GSDC-21, GSDC-22), disjoint write sets (GSDC-23), the dependency probe (G022) and the smoke builds (F50).
// Adapter data only through hooks and the argv of adapter.dependency_probe and adapter.commands.smoke_builds.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withMutex } from "../adapter/mutex.mjs";
import { runArgv } from "../lib/proc.mjs";
import { done, mentions, readIf, unavailable } from "./common.mjs";
import { HookError, builtinResolve, callHook, classify, covers, filesUnder, balancedGlob, hasGlob, overlaps, ownsPath, pathKey, physicalPath, sharedPaths, targetsOf } from "./adapter-hooks.mjs";
import { phaseFile, readPlans, sharedDependencies } from "./planning.mjs";
import { loadRoadmap, roadmapPhase } from "./roadmap.mjs";
import { pathlessIssues, timingIssues } from "./shared-changes.mjs";

export const REQUIRED_PLAN_FIELDS = ["phase", "plan", "type", "wave", "depends_on", "files_modified", "autonomous", "requirements", "must_haves"];
const TASK_TYPES = new Set(["auto", "tracer", "manual", "checkpoint:human-verify", "checkpoint:decision", "checkpoint:human-action"]);
const CHECKPOINT_SHAPES = {
  "checkpoint:human-verify": ["what-built", "how-to-verify", "resume-signal"],
  "checkpoint:decision": ["decision", "options", "resume-signal"],
  "checkpoint:human-action": ["action", "instructions", "verification", "resume-signal"],
};

const has = (inner, t) => new RegExp(`<${t}(\\s[^>]*)?>`).test(inner);

function truncation(text, body) {
  const out = [];
  if (text.includes("<!-- gsd:write-continue -->")) out.push("Truncated: write-continue sentinel present");
  if (/<tasks>/.test(body) && !/<\/tasks>/.test(body)) out.push("Truncated: <tasks> is not closed");
  const tail = body.trimEnd();
  const lastOpen = tail.lastIndexOf("<");
  // Either a tag cut mid-way (`<name`) or an element opened last and never closed (`<name>Half`).
  if (lastOpen >= 0 && (tail.indexOf(">", lastOpen) < 0 || /^<[A-Za-z][^>]*[^/>]>[^<]*$/.test(tail.slice(lastOpen)))) out.push("Truncated: file ends inside a tag");
  return out;
}

// Decision ids the human settled in the phase CONTEXT.md (G007). Deferred, informational and discretion decisions are not
// settled, and a quick plan outside a phase has no CONTEXT.md.
function settledDecisionIds(phase) {
  if (!phase) return [];
  const text = readIf(phaseFile(phase, "CONTEXT.md"));
  if (text === null) return [];
  return parseDecisions(text).decisions.filter((d) => d.trackable).map((d) => d.id);
}

// Core structure checks of one plan, then the adapter's ownership and vocabulary checks.
export async function planStructure(g, phase, plan) {
  const errors = [];
  const warnings = [];
  if (plan.error) errors.push(`Frontmatter parse error: ${plan.error}`);
  const fm = plan.fm;
  if (!plan.error) for (const f of REQUIRED_PLAN_FIELDS) if (!Object.hasOwn(fm, f)) errors.push(`Missing required frontmatter field: ${f}`);
  errors.push(...truncation(plan.text, plan.body));
  const tasks = plan.tasks;
  if (!tasks.length) errors.push("No <task> elements found");
  else if (!tasks.some((t) => t.automated.length)) errors.push("No task has an <automated> verify obligation");
  const settled = settledDecisionIds(phase);
  let decisionBefore = false;
  for (const t of tasks) {
    const label = `Task ${t.index}${t.name ? ` (${t.name})` : ""}`;
    if (!t.name) errors.push(`Task ${t.index} missing <name>`);
    if (!TASK_TYPES.has(t.type)) warnings.push(`${label}: unknown task type ${t.type}`);
    if (["auto", "tracer", "manual"].includes(t.type)) {
      if (!has(t.inner, "action")) errors.push(`${label}: missing <action>`);
      for (const tg of ["verify", "done", "files"]) if (!has(t.inner, tg)) warnings.push(`${label}: missing <${tg}>`);
    }
    const shape = CHECKPOINT_SHAPES[t.type];
    if (shape) {
      for (const tg of shape) if (!has(t.inner, tg)) errors.push(`${label}: ${t.type} missing <${tg}>`);
      if (fm.autonomous !== false) errors.push(`${label}: checkpoint task in a plan whose autonomous is not false`);
      if (t.type === "checkpoint:decision") {
        const ids = [...t.inner.matchAll(/<option\s+id="([^"]+)"/g)].map((m) => m[1]);
        if (t.autoSelect !== null && !ids.includes(t.autoSelect)) errors.push(`${label}: auto_select "${t.autoSelect}" names no option id`);
      }
    }
    // A one-way task is gated by the checkpoint:decision right before it or by a CONTEXT decision it cites as settled.
    if (t.reversibility === "one-way" && !decisionBefore && !settled.some((id) => mentions(t.inner, id))) warnings.push(`${label}: one-way reversibility without a checkpoint:decision immediately before it`);
    decisionBefore = t.type === "checkpoint:decision";
  }
  // Kit feedback 87 C1: each <check_changes> line names one file and why its checks get weaker; the gate accepts exactly those.
  const forms = g.cfg.adapter.ownership.owns_forms;
  for (const c of plan.checkChanges ?? []) {
    if (!c.path) errors.push(`<check_changes> line is not \`<path>: <reason>\`: ${c.line}`);
    else if (/[*?[\]{}]/.test(c.path)) errors.push(`<check_changes> names a glob, not a file: ${c.path}`);
    else if (!c.reason.trim()) errors.push(`<check_changes> ${c.path} gives no reason`);
    else if (plan.owns.length && !plan.owns.some((o) => { const m = ownsPath(o, forms); return m !== null && covers(m, c.path); })) warnings.push(`<check_changes> ${c.path} is outside the plan's owns`);
  }
  if (Number(plan.wave) > 1 && !plan.dependsOn.length) warnings.push(`wave ${plan.wave} with empty depends_on`);
  const limit = g.cfg.gsd.plan_limits.tasks_per_plan;
  if (tasks.length > limit) errors.push(`${tasks.length} tasks > gsd.plan_limits.tasks_per_plan ${limit} (split the plan)`);
  let unresolvable = null;
  try {
    const own = await ownershipProblems(g, [plan]);
    errors.push(...own.problems.map((p) => p.message));
  } catch (e) {
    if (!(e instanceof HookError)) throw e;
    unresolvable = e.message;
    errors.push(`ownership unresolvable: ${e.message}`);
  }
  for (const t of tasks) {
    for (const o of t.automated) if (classify(o.command, g.cfg.adapter.verify_vocabulary).kind === "unknown") warnings.push(`Task ${t.index}: <automated> outside the verify vocabulary: ${o.command}`);
  }
  return {
    plan: plan.id,
    valid: errors.length === 0,
    errors,
    warnings,
    task_count: tasks.length,
    tasks: tasks.map((t) => ({ index: t.index, name: t.name, type: t.type, automated: t.automated.map((o) => o.command) })),
    ...((plan.checkChanges ?? []).length ? { check_changes: plan.checkChanges.filter((c) => c.path).map(({ path: p, reason }) => ({ path: p, reason })) } : {}),
    frontmatter_fields: Object.keys(fm),
    ...(unresolvable ? { unresolvable } : {}),
  };
}

// --- verify-command-paths ---

const shareMentions = (plans, target) => plans.some((p) => p.sharedChanges.some((s) => s.includes(target)));

export async function verifyCommandPaths(g, phase, plans) {
  if (!plans.length) throw unavailable(`no plans in ${phase.name}`, { commands: [] });
  const vocab = g.cfg.adapter.verify_vocabulary;
  const commands = [];
  let unresolvableHooks = 0;
  for (const plan of plans) {
    for (const t of plan.tasks) {
      for (const o of t.automated) {
        const row = { plan: plan.id, task: t.index, command: o.command };
        const c = classify(o.command, vocab);
        if (c.kind === "sentinel" || c.kind === "build") {
          commands.push({ ...row, kind: c.kind, status: "ok", severity: "none", detail: null, target: null });
          continue;
        }
        if (c.kind === "unknown") {
          commands.push({ ...row, kind: "unknown", status: "missing", severity: "blocker", detail: "kind not registered in adapter.verify_vocabulary", target: null });
          continue;
        }
        try {
          const results = c.spec.resolver
            ? (await callHook(g, c.spec.resolver, "resolve", { kind: c.kind, targets: await targetsOf(g, c.kind, c.spec, c.argument), plan: plan.id, filesModified: plan.filesModified, phaseDir: phase.dir })).results
            : builtinResolve(g, c.argument, plan);
          for (const r of results) {
            let status = r.status;
            if (status === "missing" && shareMentions(plans, r.target)) status = "pending_shared";
            const severity = status === "missing" ? "blocker" : status === "unresolvable" ? "warning" : "none";
            commands.push({ ...row, kind: c.kind, status, severity, detail: r.detail ?? null, target: r.target });
          }
          // G094: a parser that extracts no target must not drop the obligation; only an exit-code-sufficient kind may run targetless.
          if (!results.length) {
            const targetless = c.spec.exit_code_sufficient;
            commands.push({ ...row, kind: c.kind, status: targetless ? "ok" : "missing", severity: targetless ? "none" : "blocker", detail: "no concrete target selected", target: null });
          }
        } catch (e) {
          if (!(e instanceof HookError)) throw e;
          unresolvableHooks++;
          commands.push({ ...row, kind: c.kind, status: "unresolvable", severity: "warning", detail: e.message, target: null });
        }
      }
    }
  }
  const blockers = commands.filter((c) => c.severity === "blocker").length;
  return { status: blockers ? "issues" : commands.some((c) => c.severity !== "none") ? "warnings" : "ok", blockers, unresolvable_hooks: unresolvableHooks, commands };
}

// --- verify-failure-directions ---

const PLACEHOLDER = /^(tbd|todo|n\/a|none|unknown|\?|-)$/i;
const RESTATEMENT = /^(it\s+)?(fails?|failure|error)\.?$/i;

export function failureDirections(g, plans) {
  const commands = [];
  for (const plan of plans) {
    for (const t of plan.tasks) {
      for (const o of t.automated) {
        if (classify(o.command, g.cfg.adapter.verify_vocabulary).kind === "sentinel") continue;
        const row = { plan: plan.id, task: t.index, command: o.command, fails_when: o.failsWhen };
        if (o.failsWhen === null) commands.push({ ...row, status: "missing", severity: "blocker", detail: "<automated> not followed immediately by <fails_when>" });
        else if (PLACEHOLDER.test(o.failsWhen)) commands.push({ ...row, status: "rejected", severity: "blocker", detail: "placeholder failure direction" });
        else if (RESTATEMENT.test(o.failsWhen)) commands.push({ ...row, status: "restatement", severity: "warning", detail: "name the observable failure signal" });
        else commands.push({ ...row, status: "stated", severity: "none", detail: null });
      }
    }
  }
  return { status: commands.some((c) => c.severity === "blocker") ? "issues" : "ok", commands };
}

// --- decisions (GSDC-21) ---

const NON_TRACKABLE_TAGS = new Set(["informational", "folded", "deferred"]);

export function parseDecisions(contextText) {
  const decisions = [];
  const malformed = [];
  for (const block of String(contextText ?? "").matchAll(/<decisions>([\s\S]*?)<\/decisions>/g)) {
    let category = null;
    for (const line of block[1].split(/\r?\n/)) {
      const h = /^#{2,4}\s+(.+?)\s*$/.exec(line);
      if (h) {
        category = h[1];
        continue;
      }
      if (!/^\s*[-*]\s*\*\*D/.test(line)) continue;
      const m = /^\s*[-*]\s*\*\*(D\d*-\d+)(?:\s*\[([^\]]*)\])?\s*:?\*\*\s*:?\s*(?:\[([^\]]*)\]\s*)?[—–-]?\s*(.*)$/.exec(line);
      if (!m) {
        malformed.push(line.trim());
        continue;
      }
      const tags = `${m[2] ?? ""},${m[3] ?? ""}`.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      const trackable = !/claude'?s discretion/i.test(category ?? "") && !tags.some((t) => NON_TRACKABLE_TAGS.has(t));
      decisions.push({ id: m[1], category, text: m[4].trim(), tags, trackable });
    }
  }
  return { decisions, malformed };
}

const planCitationText = (plan) => [plan.body, JSON.stringify(plan.fm.must_haves ?? null), JSON.stringify(plan.fm.truths ?? null), JSON.stringify(plan.fm.objective ?? null)].join("\n");

export function decisionCoverage(phase, plans) {
  const text = readIf(phaseFile(phase, "CONTEXT.md"));
  if (text === null) return { passed: true, skipped: "no CONTEXT.md", total: 0, covered: [], uncovered: [], malformed: [] };
  const { decisions, malformed } = parseDecisions(text);
  if (malformed.length) return { passed: false, message: "unparseable decision bullet; use `- **D-NN:** text`", malformed, total: decisions.length, covered: [], uncovered: [] };
  const trackable = decisions.filter((d) => d.trackable);
  if (!trackable.length) return { passed: true, skipped: "no trackable decisions", total: 0, covered: [], uncovered: [], malformed: [] };
  const corpus = plans.map(planCitationText).join("\n");
  const covered = trackable.filter((d) => mentions(corpus, d.id)).map((d) => d.id);
  const uncovered = trackable.filter((d) => !covered.includes(d.id)).map((d) => ({ id: d.id, category: d.category, text: d.text }));
  return { passed: uncovered.length === 0, total: trackable.length, covered, uncovered, malformed: [] };
}

// --- requirement coverage (GSDC-22) ---

export function coverage(g, phase, plans) {
  const entry = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), phase.number);
  const ids = entry?.requirements ?? [];
  const claimed = new Set(plans.flatMap((p) => p.requirements));
  const covered = ids.filter((id) => claimed.has(id));
  const uncovered = ids.filter((id) => !claimed.has(id));
  const extra = [...claimed].filter((id) => !ids.includes(id));
  const decisions = decisionCoverage(phase, plans);
  const requirements = { total: ids.length, covered, uncovered, extra, roadmapEntry: Boolean(entry) };
  return { passed: Boolean(entry) && uncovered.length === 0 && decisions.passed, requirements, decisions };
}

// --- ownership (GSDC-23, ADPT-04) ---

export async function ownershipProblems(g, plans) {
  const forms = g.cfg.adapter.ownership.owns_forms;
  const problems = [];
  const owned = new Map();
  const add = (plan, kind, message, extra = {}) => problems.push({ plan: plan?.id ?? null, kind, message, ...extra });
  const candidates = new Set();
  for (const plan of plans) {
    const paths = [];
    if (!plan.owns.length) add(plan, "no-owns", `${plan.id}: no owns`);
    for (const entry of plan.owns) {
      const p = ownsPath(entry, forms);
      if (p === null) add(plan, "invalid-owns", `${plan.id}: owns entry not in adapter.ownership.owns_forms: ${entry}`);
      else {
        paths.push(p);
        if (hasGlob(p) && !balancedGlob(p)) add(plan, "invalid-owns-glob", `${plan.id}: owns glob has an unbalanced [ or {, it would match nothing: ${p}`, { file: p });
      }
    }
    owned.set(plan.id, paths);
    for (const p of [...plan.filesModified, ...paths.filter((x) => !/[*?[{]/.test(x))]) {
      const problem = identityProblem(g.codeRoot, p);
      if (problem) add(plan, problem.kind, `${plan.id}: ${p} ${problem.message}`, { file: p });
    }
    for (const f of plan.filesModified) {
      candidates.add(f);
      // Kit feedback 74: files_modified names files. A `*` or `?` there would match an owns glob of the same text as a
      // pattern against itself, while the transfer matches the real file names the generator writes.
      if (/[*?]/.test(f)) add(plan, "glob-files-modified", `${plan.id}: files_modified holds a glob: ${f} (list the files, or put the glob or the directory in owns)`, { file: f });
      else if (paths.length && !paths.some((p) => covers(p, f))) add(plan, "outside-owns", `${plan.id}: files_modified outside owns: ${f}`, { file: f });
    }
    for (const p of paths) {
      candidates.add(p);
      for (const f of filesUnder(g.codeRoot, p)) candidates.add(f);
    }
  }
  const shared = await sharedPaths(g, [...candidates]);
  const sharedKeys = new Set([...shared].map(pathKey));
  for (const plan of plans) {
    for (const f of plan.filesModified) if (sharedKeys.has(pathKey(f))) add(plan, "shared-file", `${plan.id}: files_modified holds shared file ${f} (declare it in <shared_changes>)`, { file: f });
    for (const p of owned.get(plan.id)) {
      const hit = [...shared].find((s) => covers(p, s));
      if (hit) add(plan, "owns-shared", `${plan.id}: owns ${p} covers shared path ${hit}`, { file: hit });
    }
  }
  return { problems, owned };
}

// A path that leaves the code root, lexically or through a link/junction, or reaches its file under another name
// (a link alias) cannot be compared for disjointness (GSDC-23, INV-52).
function identityProblem(codeRoot, p) {
  const key = pathKey(p);
  if (key === null) return { kind: "invalid-path", message: "is absolute or leaves the code root" };
  const phys = physicalPath(codeRoot, p);
  if (phys === null) return { kind: "invalid-path", message: "resolves outside the code root through a link" };
  if (pathKey(phys) !== key) return { kind: "aliased-path", message: `resolves through a link to ${phys}; name the physical path` };
  return null;
}

// Files/plan lines of the checker (gsd-plan-checker.md: warning 10, blocker 15). A phase whose plans list more files
// than plans_per_phase can hold under those lines gets lines one above the average plan, so the cap stays satisfiable.
// Kit feedback 69: gsd.files_per_plan {warning, blocker} sets the lines exactly (no average rule); the checker prompt, the file
// probe and `outline check` (which counts owns paths instead of files_modified) all read them from here.
const FILES_PER_PLAN = { warning: 10, blocker: 15 };
export function filesPerPlanLines(g, plans, plansPerPhase = g.cfg.gsd.plan_limits.plans_per_phase) {
  const set = g.cfg.gsd.files_per_plan;
  if (set) return { warning: set.warning, blocker: set.blocker };
  const average = Math.ceil(plans.reduce((n, p) => n + p.filesModified.length, 0) / plansPerPhase);
  return { warning: Math.max(FILES_PER_PLAN.warning, average + 1), blocker: Math.max(FILES_PER_PLAN.blocker, average + 1) };
}

// Same-wave overlap of owns or files_modified (also used by waves and outline check).
export function waveOverlaps(plans, ownedOf) {
  const problems = [];
  const byWave = new Map();
  for (const p of plans) byWave.set(p.wave, [...(byWave.get(p.wave) ?? []), p]);
  for (const [wave, group] of byWave) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const keysB = new Set(b.filesModified.map(pathKey));
        const files = a.filesModified.filter((f) => pathKey(f) !== null && keysB.has(pathKey(f)));
        if (files.length) problems.push({ kind: "overlapping-files", wave, plans: [a.id, b.id], message: `wave ${wave}: ${a.id} and ${b.id} both modify ${files.join(", ")}` });
        const oa = ownedOf(a);
        const ob = ownedOf(b);
        const pair = oa.flatMap((x) => ob.filter((y) => overlaps(x, y)).map((y) => `${x} ~ ${y}`));
        if (pair.length) problems.push({ kind: "overlapping-owns", wave, plans: [a.id, b.id], message: `wave ${wave}: ${a.id} and ${b.id} have overlapping owns (${pair.join(", ")})` });
      }
    }
  }
  return problems;
}

export async function checkOwns(g, phase, ids) {
  const plans = readPlans(phase, ids);
  const { problems, owned } = await ownershipProblems(g, plans);
  problems.push(...waveOverlaps(plans, (p) => owned.get(p.id) ?? []));
  // Kit feedback 95 F2: a <shared_changes> wave timing gsd-execute cannot honour is an issue for the plan checker (the owns probe).
  // Kit feedback 105 F1: so is an entry that names no file (pathlessIssues, with its fix). Neither is a problem, so the exit code
  // (gsd-execute's shared-tree check) does not change.
  const issues = [...plans.flatMap(timingIssues), ...plans.flatMap(pathlessIssues)];
  return done({ passed: problems.length === 0, problems, ...(issues.length ? { issues } : {}), plans: plans.map((p) => ({ id: p.id, wave: p.wave, owns: p.owns, files_modified: p.filesModified, tracer: p.tasks.some((t) => t.type === "tracer") || p.fm.tracer === true })), files_per_plan: filesPerPlanLines(g, readPlans(phase)) }, problems.length ? 1 : 0);
}

// --- dependencies (G022) ---

const PROBE_TAIL_CHARS = 4000;

// The dependency lines of the plans as one JSON file, passed as the last argument of adapter.dependency_probe (argv, run in the
// project root). Exit 0 passes the set, a non-zero exit fails it, and a probe that cannot run is unresolvable (exit 69, never a
// pass). No probe configured or no dependency line: nothing runs.
export async function checkDependencies(g, phase, plans) {
  const dependencies = plans.flatMap((p) => p.sharedChanges.flatMap((text) => sharedDependencies(text).map((d) => ({ plan: p.id, ...d }))));
  const probe = g.cfg.adapter.dependency_probe;
  if (!dependencies.length) return done({ status: "none", dependencies });
  if (!probe) return done({ status: "skipped", reason: "adapter.dependency_probe is unset", dependencies });
  const nameless = dependencies.filter((d) => !d.name);
  if (nameless.length) return done({ status: "failed", reason: `dependency line(s) name no package: ${nameless.map((d) => `${d.plan} ${d.path}`).join(", ")}`, dependencies }, 1);
  const secs = g.cfg.adapter.dependency_probe_timeout_s;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-deps-"));
  try {
    const file = path.join(dir, "dependencies.json");
    fs.writeFileSync(file, `${JSON.stringify({ phase: phase.padded, dependencies }, null, 2)}\n`, "utf8");
    const run = await runArgv([...probe, file], { cwd: g.codeRoot, env: g.env, timeoutMs: secs * 1000, tailChars: PROBE_TAIL_CHARS });
    const output = `${run.stdout}${run.stderr}`.trim();
    if (run.timedOut) return done({ status: "unresolvable", reason: `dependency probe timed out after ${secs}s`, output, dependencies }, 69);
    if (run.error || run.code === null) return done({ status: "unresolvable", reason: `dependency probe could not run: ${run.error?.message ?? "stopped by a signal"}`, output, dependencies }, 69);
    if (run.code !== 0) return done({ status: "failed", reason: `dependency probe exited ${run.code}`, output, dependencies }, 1);
    return done({ status: "passed", dependencies });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- smoke builds (F50) ---

const BUILD_TAIL_CHARS = 4000;

// Each adapter.commands.smoke_builds argv builds one declared verification target once, in the project root, before any planner
// runs: a missing toolchain component fails here, not at the first obligation that needs that target. Every target runs, so the
// owner sees all failures at once. A build that times out or cannot run is unresolvable (exit 69), never a pass. Nothing configured:
// nothing runs. The build holds adapter.mutex like every other adapter build (ADPT-10).
export async function checkSmokeBuilds(g) {
  const builds = g.cfg.adapter.commands.smoke_builds ?? [];
  if (!builds.length) return done({ status: "none", builds: [] });
  const secs = g.cfg.adapter.commands.build_timeout_s;
  const results = await withMutex(g.cfg.adapter.mutex, async () => {
    const out = [];
    for (const argv of builds) {
      const run = await runArgv(argv, { cwd: g.codeRoot, env: g.env, timeoutMs: secs * 1000, tailChars: BUILD_TAIL_CHARS });
      const output = `${run.stdout}${run.stderr}`.trim();
      if (run.timedOut) out.push({ argv, status: "unresolvable", reason: `build timed out after ${secs}s`, output });
      else if (run.error || run.code === null) out.push({ argv, status: "unresolvable", reason: `build could not run: ${run.error?.message ?? "stopped by a signal"}`, output });
      else if (run.code !== 0) out.push({ argv, status: "failed", reason: `build exited ${run.code}`, output });
      else out.push({ argv, status: "passed" });
    }
    return out;
  });
  const bad = results.filter((b) => b.status !== "passed");
  if (!bad.length) return done({ status: "passed", builds: results });
  const reason = bad.map((b) => `${b.argv.join(" ")}: ${b.reason}`).join("; ");
  return done({ status: bad.some((b) => b.status === "failed") ? "failed" : "unresolvable", reason, builds: results }, bad.some((b) => b.status === "failed") ? 1 : 69);
}
