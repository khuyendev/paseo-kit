// Post-wave gate (GSDF-44, GSDF-51): adapter gates, build, tests and plan obligations, one gate-evidence file
// per run (ADPT-17), failure attribution by owns then the adapter `attribute` hook; evidence validation.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { readJsonIf, writeJsonAtomic, writeTextAtomic } from "../../harness/lib/io.mjs";
import { isInside, resolveInside, safeName, toSlash } from "../../harness/lib/paths.mjs";
import { runArgv } from "../../harness/lib/proc.mjs";
import { invokeHook } from "../../harness/adapter/hooks.mjs";
import { withMutex } from "../../harness/adapter/mutex.mjs";
import { evidenceVerdict, requiredSteps, executionProblem, gateStepName, obligationStepName } from "../../harness/adapter/evidence.mjs";
import { gateObligation } from "../../harness/adapter/contract.mjs";
import { sha256 } from "../../harness/lib/hash.mjs";
import { gitLines, head } from "./flow-git.mjs";
import { contentHash, owned, ownsPrefixes, ownsScope, specificOwners } from "./flow-owns.mjs";

const TIMEOUT_CODE = 124;
const EXCERPT_LINES = 40;

// ADPT-15 through the adapter's invoker (closed request and response shapes); a script fault is {error}.
export async function runHook(root, cfg, script, { op, ...fields }) {
  const r = await invokeHook(cfg, { codeRoot: root, script, op, ...fields });
  return r.ok ? r.response : { error: r.reason };
}

// Split an obligation argument into argv without a shell (double and single quotes group words).
export function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(text)); ) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Error lines before warnings (GSDF-51), bounded; the full log is linked from the evidence.
function excerpt(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  const errors = lines.filter((l) => /\b(error|fail(ed|ure)?|exception|assert)/i.test(l));
  const warns = lines.filter((l) => /\bwarn(ing)?\b/i.test(l) && !errors.includes(l));
  return [...errors, ...warns].slice(0, EXCERPT_LINES).join("\n") || lines.slice(-EXCERPT_LINES).join("\n");
}

// G167: a path may hold spaces (a spaced project root, `src/my file.ts`), so a file is named by the longest span that ends
// at a file extension, starts after a token boundary and holds no character a path does not, and that is a visible file
// under the root. A quoted path is such a span between its quotes. Spans are matched against the visible files, not stat'd.
const PATH_STOP = /[\r\n"'`()<>|?*;=,{}[\]]/;
const SPACE = /\s/;
const MAX_PATH = 260;
// Keys of the visible files: case-folded on Windows, like samePath.
const pathKey = (rel) => (process.platform === "win32" ? rel.toLowerCase() : rel);
// The files the gate can see: tracked, or untracked and not ignored (the same list inputsOf reads).
function visibleFiles(root) {
  return new Set(gitLines(root, ["ls-files", "-co", "--exclude-standard", "-z"]).flatMap((l) => l.split("\0")).filter(Boolean).map((rel) => pathKey(toSlash(rel))));
}
// A file the output reports at a position (`path:line`) is the one that failed; a run's other files (every passing test's
// progress line, a helper in a stack) are only mentioned. Without any position, every mentioned file counts (kit-feedback 51).
function mentionedFiles(root, text, visible) {
  const found = new Set();
  const located = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    for (const ext of line.matchAll(/\.[A-Za-z0-9]+(?![A-Za-z0-9])/g)) {
      const end = ext.index + ext[0].length;
      let lo = end;
      while (lo > 0 && end - lo < MAX_PATH && !PATH_STOP.test(line[lo - 1])) lo--;
      for (let s = lo; s < end; s++) {
        if (SPACE.test(line[s]) || (s > lo && !SPACE.test(line[s - 1]))) continue;
        const abs = path.resolve(root, line.slice(s, end));
        const rel = toSlash(path.relative(root, abs));
        if (!isInside(abs, root) || !visible.has(pathKey(rel)) || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) continue;
        found.add(rel);
        if (/^["'`]?:\d/.test(line.slice(end))) located.add(rel);
        break;
      }
    }
  }
  return [...(located.size ? located : found)];
}

// Input scopes of a gate: the owned paths of its plans and the adapter instructions (ADPT-17).
function scopesOf(cfg, plans, prefixes) {
  const scopes = new Set();
  for (const p of plans) for (const o of p.owns ?? []) {
    const rel = ownsScope(o, prefixes);
    if (rel && !rel.startsWith(".planning/")) scopes.add(rel);
  }
  for (const i of cfg.adapter.instructions ?? []) scopes.add(toSlash(i).replace(/\/$/, ""));
  return [...scopes].sort();
}

// The git-visible files (tracked, or untracked and not ignored) under the scopes, rescanned on every call so a file
// added under an owned directory changes the identity (CR-GSF-11); ignored build output never does.
export function inputsOf(root, scopes) {
  const files = {};
  if (scopes.length) for (const rel of gitLines(root, ["ls-files", "-co", "--exclude-standard", "-z", "--", ...scopes]).flatMap((l) => l.split("\0")).filter(Boolean)) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) files[toSlash(rel)] = null;
    else if (fs.statSync(abs).isFile()) files[toSlash(rel)] = contentHash(abs);
  }
  for (const rel of scopes) if (!/[?*\[\]]/.test(rel) && !fs.existsSync(resolveInside(root, rel))) files[toSlash(rel)] = null;
  // CONF-12: configuration identity comes from the validated shared loader, never raw config files. Only the commands and
  // the verify vocabulary (kinds, runners, parser hooks) shape a gate's steps; other adapter keys and the gsd and harness
  // settings leave its evidence current (G076, kit-feedback 58).
  const cfg = loadConfig(root);
  return { head: head(root), scopes, files: Object.fromEntries(Object.entries(files).sort()), config: sha256(JSON.stringify({ commands: cfg.adapter.commands, verify_vocabulary: cfg.adapter.verify_vocabulary })) };
}

// Files a run writes about itself (gate evidence, review and pre-code review records, transfer and commit records, progress, halts): they
// are not inputs of a judgment, so they never change an agent call's digest; a resumed run then replays the calls
// whose code is unchanged (G080, G081).
const RUN_RECORD = /^\.planning\/(phases|quick)\/[^/]+\/(evidence|review|prereview|transfers|transfers-pending)\/|^\.planning\/(phases|quick)\/[^/]+\/([^/]+-REVIEW\.md|deferred\.md|execute-progress\.json|execute-baseline\.json|commits\.json|[^/]+-HALT\.json|halt-answers\.json)$/;
export const runRecord = (rel) => RUN_RECORD.test(toSlash(rel));

// The adapter and gsd settings a judgment reads: the owns forms and the lens, stack-skill, agent and role tables. Gate
// commands shape no judgment, and the planning settings reach a judgment through its prompt, so neither is hashed (G125).
const judgmentSettings = (cfg) => ({ ownership: cfg.adapter.ownership, review_lenses: cfg.adapter.review_lenses ?? [], stack_skill: cfg.adapter.stack_skill ?? null, agents: cfg.adapter.agents ?? {}, roles: cfg.gsd.roles ?? {} });

// Digest line value of an agent call: the current content of the files and owned paths it judges and the settings a
// judgment reads (GSDF-03, CR-GSF-19). A call names only what it judges, so an edit elsewhere keeps its cache entry (G125).
// HEAD is left out: the content is the identity, and an unrelated commit is no new input (G076).
export function digest(root, { files = [], owns = [] }) {
  const cfg = loadConfig(root);
  const prefixes = ownsPrefixes(root);
  const ownScopes = owns.map((o) => ownsScope(o, prefixes));
  const scopes = [...new Set([...files.map((f) => toSlash(f)), ...ownScopes, ...(cfg.adapter.instructions ?? [])])].filter(Boolean).sort();
  const now = inputsOf(root, scopes);
  for (const rel of Object.keys(now.files)) if (rel.startsWith("_workspace/") || rel.startsWith(`${cfg.worktree_dir}/`) || runRecord(rel)) delete now.files[rel];
  const missing = files.filter((f) => !fs.existsSync(resolveInside(root, f))).sort();
  return { hash: sha256(JSON.stringify({ files: now.files, missing, settings: judgmentSettings(cfg) })) };
}

// The next evidence number of a wave, taken by creating its logs directory exclusively: two gate runs of one wave
// never share a number (G063); only evidence files are counted.
function nextEvidence(dir, waveId) {
  fs.mkdirSync(dir, { recursive: true });
  const used = fs.readdirSync(dir).filter((f) => f.startsWith(`${waveId}-`) && f.endsWith(".json")).length;
  for (let n = used + 1; ; n++) {
    const file = path.join(dir, `${waveId}-${n}.json`);
    if (fs.existsSync(file)) continue;
    try {
      fs.mkdirSync(file.replace(/\.json$/, ".logs"));
      return file;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}

const NOT_RUN = { count: null, targets: [] };

// G063: each finished step is checkpointed in the run's logs directory; a gate of the same wave and the same inputs
// after an interrupted one (no evidence file) reuses its passed steps whose command is unchanged, instead of
// rerunning every command. The inputs-stable check still covers the whole run.
function interruptedSteps(root, dir, waveId, inputs) {
  if (!fs.existsSync(dir)) return new Map();
  const num = (f, ext) => Number(new RegExp(`^${waveId.replace(/[.]/g, "\\.")}-(\\d+)\\.${ext}$`).exec(f)?.[1] ?? NaN);
  const names = fs.readdirSync(dir);
  // Only a run after the last finished one: a finished gate supersedes every earlier checkpoint.
  const lastDone = Math.max(0, ...names.map((f) => num(f, "json")).filter(Number.isFinite));
  const runs = names.map((f) => [f, num(f, "logs")]).filter(([f, n]) => n > lastDone && !fs.existsSync(path.join(dir, f.replace(/\.logs$/, ".json"))));
  for (const [f] of runs.sort((x, y) => y[1] - x[1])) {
    let cp = null;
    try { cp = readJsonIf(path.join(dir, f, "checkpoint.json"), null); } catch { cp = null; }
    if (cp && JSON.stringify(cp.inputs) === JSON.stringify(inputs)) return new Map((cp.steps ?? []).filter((s) => s.outcome === "passed" && typeof s.log === "string" && fs.existsSync(path.join(root, s.log))).map((s) => [s.name, s]));
  }
  return new Map();
}

// The combined log is the human one; stdout and stderr also go to their own files for an evidence parser (G077).
async function step(root, logDir, name, argv, timeoutS, extra = {}) {
  const r = await runArgv(argv, { cwd: root, timeoutMs: timeoutS * 1000 });
  const log = path.join(logDir, `${safeName(name)}.log`);
  writeTextAtomic(log, `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`);
  const streams = { stdout: path.join(logDir, `${safeName(name)}.stdout.log`), stderr: path.join(logDir, `${safeName(name)}.stderr.log`) };
  writeTextAtomic(streams.stdout, r.stdout ?? "");
  writeTextAtomic(streams.stderr, `${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`);
  const outcome = r.timedOut ? "timeout" : r.error && r.code === null ? "unavailable" : r.code === 0 ? "passed" : "failed";
  return { name, argv, outcome, exitCode: r.timedOut ? TIMEOUT_CODE : r.code, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), streams: { stdout: toSlash(path.relative(root, streams.stdout)), stderr: toSlash(path.relative(root, streams.stderr)) }, text: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, ...extra };
}

// A step that did not run still has the ADPT-17 shape: a log holding the reason and an outcome that never certifies.
function noRun(root, logDir, name, outcome, text, extra = {}) {
  const log = path.join(logDir, `${safeName(name)}.log`);
  writeTextAtomic(log, `${text}\n`);
  return { name, argv: [], outcome, exitCode: null, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), text, ...extra };
}

// input: {waveId, plans: [{id, owns, verify: [{task, kind, command, target}]}], testArgv?, skipObligations?, suite?, context?}
// kit-feedback 66 (gsd.execute_schedule graph): `suite: false` runs only the plans' obligations (the adapter gates, the build
// and the tests are the repo-wide suite, run once before a commit); `context` [{id, owns}] are other open plans of the run:
// a failure in their files is attributed to them, though they add no scope and no obligation to this gate.
export async function gate(root, phaseDir, input) {
  const cfg = loadConfig(root);
  const cmds = cfg.adapter.commands;
  const prefixes = ownsPrefixes(root);
  const dir = resolveInside(root, phaseDir);
  const evidenceFile = nextEvidence(path.join(dir, "evidence"), input.waveId);
  const logDir = evidenceFile.replace(/\.json$/, ".logs");
  const steps = [];
  const notes = [];
  const scopes = scopesOf(cfg, input.plans ?? [], prefixes);
  // CR-GSF-11: the identity is taken before anything runs; a change while the gate runs is a failed step.
  const inputs = inputsOf(root, scopes);
  const reusable = interruptedSteps(root, path.dirname(evidenceFile), input.waveId, inputs);
  const checkpoint = () => writeJsonAtomic(path.join(logDir, "checkpoint.json"), { inputs, steps: steps.map(({ text, ...s }) => s) });
  const run = async (name, argv, timeoutS, extra = {}) => {
    const prior = reusable.get(name);
    if (prior && JSON.stringify(prior.argv) === JSON.stringify(argv)) {
      notes.push(`${name}: passed in an interrupted gate run of the same inputs; reused`);
      return { ...prior, ...extra, reused: true, text: fs.existsSync(path.join(root, prior.log)) ? fs.readFileSync(path.join(root, prior.log), "utf8") : "" };
    }
    return step(root, logDir, name, argv, timeoutS, extra);
  };
  // ADPT-10: the same machine-wide lock as every other adapter.mutex user.
  await withMutex(cfg.adapter.mutex, async () => {
    let gateRed = false;
    if (input.suite === false) notes.push("obligations only: the adapter gates, the build and the tests run before the commit");
    else {
      for (const g of cmds.gates ?? []) {
        const s = await run(gateStepName(g.name), g.argv, cmds.build_timeout_s);
        steps.push(s);
        checkpoint();
        if (s.outcome !== "passed") gateRed = true;
      }
      if (cmds.build) { steps.push(await run("build", cmds.build, cmds.build_timeout_s)); checkpoint(); }
      else { notes.push("build not configured (adapter.commands.build)"); steps.push(noRun(root, logDir, "build", "not_configured", notes.at(-1))); }
      if (cmds.test) { steps.push(await run("test", input.testArgv ?? cmds.test, cmds.test_timeout_s)); checkpoint(); }
      else { notes.push("tests not configured (adapter.commands.test)"); steps.push(noRun(root, logDir, "test", "not_configured", notes.at(-1))); }
    }
    for (const p of input.plans ?? []) for (const ob of p.verify ?? []) {
      const name = obligationStepName(p.id, ob.task, ob.kind);
      const meta = { plan: p.id, task: ob.task, kind: ob.kind };
      if (gateRed || input.skipObligations) { steps.push(noRun(root, logDir, name, "unavailable", gateRed ? "not executed: an earlier gate failed" : "not executed: skipped", meta)); continue; }
      const o = await gateObligation(cfg, { codeRoot: root, phaseDir, ...ob });
      if (o.outcome !== "ready") { steps.push(noRun(root, logDir, name, o.outcome, o.reason, meta)); continue; }
      const { argument, targets } = o;
      const s = await step(root, logDir, name, o.argv, o.timeoutS, meta);
      checkpoint();
      if (o.evidenceParser) {
        const ev = await runHook(root, cfg, o.evidenceParser, { op: "evidence", phaseDir, kind: ob.kind, argument, targets, exitCode: s.exitCode, stdoutPath: s.streams.stdout, stderrPath: s.streams.stderr });
        if (ev.error) { s.outcome = "unavailable"; s.text += `\n${ev.error}`; }
        else {
          s.executed = { count: ev.executed?.count ?? 0, targets: ev.executed?.targets ?? [] };
          if (ev.outcome !== "passed") s.outcome = ev.outcome === "unavailable" ? "unavailable" : "failed";
        }
      } else if (!o.exitCodeSufficient) s.outcome = s.outcome === "passed" ? "unavailable" : s.outcome;
      const problem = executionProblem({ targets, executed: s.executed, exitCodeSufficient: o.exitCodeSufficient });
      if (problem) { s.outcome = "failed"; s.text += `\n${problem}`; }
      steps.push(s);
    }
  }, { log: (m) => notes.push(m) });
  const after = inputsOf(root, scopes);
  const moved = Object.keys({ ...inputs.files, ...after.files }).filter((f) => inputs.files[f] !== after.files[f]);
  if (after.head !== inputs.head) moved.unshift("HEAD");
  if (after.config !== inputs.config) moved.unshift("adapter configuration");
  if (moved.length) steps.push(noRun(root, logDir, "inputs-stable", "failed", `inputs changed while the gate ran: ${moved.slice(0, 10).join(", ")}`));
  const evidence = { v: 1, waveId: input.waveId, at: new Date().toISOString(), inputs, ...(input.suite === false ? { suite: false } : {}), steps: steps.map(({ text, ...s }) => s) };
  writeJsonAtomic(evidenceFile, evidence);
  const visible = visibleFiles(root);
  const failures = steps.filter((s) => s.outcome !== "passed").map((s) => ({ step: s.name, plan: s.plan ?? null, outcome: s.outcome, excerpt: excerpt(s.text), log: s.log, files: mentionedFiles(root, s.text, visible) }));
  const attribution = await attribute(root, cfg, [...(input.plans ?? []), ...(input.context ?? []).map(({ id, owns }) => ({ id, owns: owns ?? [] }))], failures, prefixes);
  if (attribution.attributionError) notes.push(`attribution hook failed: ${attribution.attributionError}; its failures stay unplaced`);
  const timedOut = steps.filter((s) => s.outcome === "timeout").map((s) => `${s.name} timed out after its limit (exit ${TIMEOUT_CODE})`);
  return { green: failures.length === 0, evidence: toSlash(path.relative(root, evidenceFile)), notes, timedOut, failures, failureCount: failures.length, ...attribution };
}

async function attribute(root, cfg, plans, failures, prefixes) {
  const byPlan = {};
  const unplaced = [];
  const blockedBy = {};
  const ownersOfFiles = (f) => [...new Set(f.files.flatMap((file) => specificOwners(file, plans, prefixes).map((p) => p.id)))];
  for (const f of failures) {
    // An obligation failing only in files its plan does not own goes to the owners of those files, or to the
    // integration fixer when no plan of the gate owns them (a whole-project obligation hitting committed code,
    // kit-feedback 36); its own plan is then blocked by them.
    const plan = f.plan ? plans.find((p) => p.id === f.plan) : null;
    if (f.plan && !(f.files.length && plan && !f.files.some((file) => owned(file, plan.owns ?? [], prefixes)))) { (byPlan[f.plan] ??= []).push(f); continue; }
    const owners = ownersOfFiles(f);
    if (owners.length) for (const o of owners) (byPlan[o] ??= []).push(f);
    else unplaced.push(f);
  }
  let attributionError = null;
  if (unplaced.length && cfg.adapter.attribution) {
    // G077: each failure carries an id, and an assignment names the failure it answers (an id, or the old echo of the
    // failure text at its own position).
    const ids = unplaced.map((_, i) => `f${i + 1}`);
    const res = await runHook(root, cfg, cfg.adapter.attribution, { op: "attribute", failures: unplaced.map((f, i) => ({ id: ids[i], text: f.excerpt, file: f.files[0] })), plans: plans.map((p) => ({ id: p.id, owns: p.owns ?? [] })) });
    if (res.error) attributionError = res.error;
    for (const [i, as] of (res.assignments ?? []).entries()) {
      const at = ids.indexOf(as?.failure) >= 0 ? ids.indexOf(as.failure) : i;
      if (as?.plan && unplaced[at]) { (byPlan[as.plan] ??= []).push(unplaced[at]); unplaced[at] = null; }
    }
  }
  // An obligation of plan A failing in plan B's files marks A blocked by B.
  for (const f of failures) if (f.plan) for (const file of f.files) for (const p of plans) if (p.id !== f.plan && owned(file, p.owns ?? [], prefixes)) (blockedBy[f.plan] ??= new Set()).add(p.id);
  return { byPlan, unplaced: unplaced.filter(Boolean), blockedBy: Object.fromEntries(Object.entries(blockedBy).map(([k, v]) => [k, [...v]])), ...(attributionError ? { attributionError } : {}) };
}

// ADPT-17 readback through the shared validator: `plans` [{id, owns, verify, waveId?, batch?}] are the planned
// obligations (from the handoff files), independent of the evidence; a plan applies to evidence of its waveId, of
// its batch group, or to any evidence when it names neither. The current inputs are rescanned from the scopes.
export async function evidenceCheck(root, rel, plans = []) {
  const abs = resolveInside(root, rel);
  const ev = readJsonIf(abs, null);
  if (!ev || typeof ev.waveId !== "string" || !Array.isArray(ev.inputs?.scopes)) return { valid: false, status: "invalid", reason: "unparsable, or without waveId or input scopes", code: 1 };
  const cfg = loadConfig(root);
  const mine = plans.filter((p) => (p.waveId === undefined && p.batch === undefined) || p.waveId === ev.waveId || p.batch === ev.waveId);
  const scopes = mine.length ? scopesOf(cfg, mine, ownsPrefixes(root)) : ev.inputs.scopes;
  const now = inputsOf(root, scopes);
  // The content of the scopes is the identity; the orchestrator's own commit after a green gate moves HEAD only.
  const requested = await requiredSteps(cfg, { codeRoot: root, phaseDir: toSlash(path.dirname(path.dirname(rel))), plans: mine });
  const v = evidenceVerdict(abs, { codeRoot: root, requested, inputs: { head: ev.inputs.head ?? null, files: now.files } });
  if (v.verdict === "green" && ev.inputs.config !== now.config) return { valid: false, status: "stale", reason: "adapter configuration differs from the gate inputs", code: 1 };
  if (v.verdict === "green") return { valid: true, status: "current", code: 0 };
  return { valid: false, status: v.verdict, reason: v.reasons.slice(0, 5).join("; "), code: 1 };
}

