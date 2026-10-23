// Plan checks: structure (GSDC-18), verify-command probe (GSDC-19), failure directions (GSDC-20), decision and
// requirement coverage (GSDC-21, GSDC-22) and disjoint write sets (GSDC-23). Adapter data only through hooks.
import { done, mentions, readIf, unavailable } from "./common.mjs";
import { HookError, builtinResolve, callHook, classify, covers, filesUnder, overlaps, ownsPath, pathKey, physicalPath, sharedPaths, targetsOf } from "./adapter-hooks.mjs";
import { phaseFile, readPlans } from "./planning.mjs";
import { loadRoadmap, roadmapPhase } from "./roadmap.mjs";

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
    // A one-way task is gated only by the checkpoint:decision right before it (planner-reversibility.md).
    if (t.reversibility === "one-way" && !decisionBefore) warnings.push(`${label}: one-way reversibility without a checkpoint:decision immediately before it`);
    decisionBefore = t.type === "checkpoint:decision";
  }
  if (Number(plan.wave) > 1 && !plan.dependsOn.length) warnings.push(`wave ${plan.wave} with empty depends_on`);
  const limit = g.cfg.gsd.plan_limits.tasks_per_plan;
  if (tasks.length > limit) warnings.push(`${tasks.length} tasks > gsd.plan_limits.tasks_per_plan ${limit} (split the plan)`);
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
      else paths.push(p);
    }
    owned.set(plan.id, paths);
    for (const p of [...plan.filesModified, ...paths.filter((x) => !/[*?[{]/.test(x))]) {
      const problem = identityProblem(g.codeRoot, p);
      if (problem) add(plan, problem.kind, `${plan.id}: ${p} ${problem.message}`, { file: p });
    }
    for (const f of plan.filesModified) {
      candidates.add(f);
      if (paths.length && !paths.some((p) => covers(p, f))) add(plan, "outside-owns", `${plan.id}: files_modified outside owns: ${f}`, { file: f });
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
  return done({ passed: problems.length === 0, problems, plans: plans.map((p) => ({ id: p.id, wave: p.wave, owns: p.owns, files_modified: p.filesModified })) }, problems.length ? 1 : 0);
}
