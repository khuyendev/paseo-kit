// Post-wave gate (GSDF-44, GSDF-51): adapter gates, build, tests and plan obligations, one gate-evidence file
// per run (ADPT-17), failure attribution by owns then the adapter `attribute` hook; evidence validation.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { errText } from "../../harness/lib/cli.mjs";
import { readJsonIf, writeJsonAtomic, writeTextAtomic } from "../../harness/lib/io.mjs";
import { isInside, resolveInside, safeName, toSlash } from "../../harness/lib/paths.mjs";
import { runArgv } from "../../harness/lib/proc.mjs";
import { invokeHook } from "../../harness/adapter/hooks.mjs";
import { withMutex } from "../../harness/adapter/mutex.mjs";
import { evidenceVerdict, requiredSteps, executionProblem, gateStepName, obligationStepNames } from "../../harness/adapter/evidence.mjs";
import { gateObligation, testCommandOf } from "../../harness/adapter/contract.mjs";
import { sha256 } from "../../harness/lib/hash.mjs";
import { producedCheck } from "../../harness/gsd/contracts.mjs";
import { gitLines, head } from "./flow-git.mjs";
import { contentHash, owned, ownsPrefixes, ownsScope, specificOwners } from "./flow-owns.mjs";
import { OWNER_ANSWERS_FILE, readAnswers } from "../../harness/lib/owner-answers.mjs";
import { checksStop, checkWeakening, isTestFile } from "./flow-checks.mjs";
import { readState } from "./flow-state.mjs";
import { fileTimeoutS, runBoundedTests } from "../../harness/gsd/test-run.mjs";
import { sampleMemory, watchMemory } from "../../harness/lib/memory.mjs";

const TIMEOUT_CODE = 124;
const EXCERPT_LINES = 40;

// Kit feedback 112 F1: a test tool that dies is not a hung test. First match wins; adapter.crash_signatures (regex
// strings, absent by default) extends the list. The signature reported is the matched text.
export const CRASH_SIGNATURES = Object.freeze([
  "Out of memory",
  "out of memory",
  "DumpStackTrace",
  "Connection closed before test suite loaded",
  "FATAL ERROR:.*heap",
  "std::bad_alloc",
  "Segmentation fault",
]);
export function crashSignature(text, extra = []) {
  const src = String(text ?? "");
  if (!src) return null;
  for (const pattern of [...CRASH_SIGNATURES, ...(Array.isArray(extra) ? extra : [])]) {
    if (typeof pattern !== "string" || !pattern) continue;
    let re;
    try { re = new RegExp(pattern); } catch { continue; }
    const hit = re.exec(src)?.[0];
    if (hit) return hit.replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return null;
}

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
function mentionedFiles(root, text, visible, { locatedOnly = false } = {}) {
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
  return [...(located.size || locatedOnly ? located : found)];
}

// A path the output names, relative to the root, when it is a visible file. Backslashes and a file:// URL are accepted.
function visibleRel(root, raw, visible) {
  let s = String(raw ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^file:\/\//, "");
  if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
  if (!s || s.startsWith("package:") || s.split("/").includes("..")) return null;
  const abs = path.resolve(root, s);
  const rel = toSlash(path.relative(root, abs));
  if (!isInside(abs, root) || !visible.has(pathKey(rel)) || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) return null;
  return rel;
}

// Kit feedback 108 F1: files a failure report names that a path:line scan drops once any path:line exists. A failing test is a
// progress line ending in [E] (its path is the test file); until the next progress line, a bare project path and a stack line
// `path line:col` count (the production file an analyzer or the test printed, the test file on the stack). No such header, nothing.
function failureReportFiles(root, text, visible) {
  const out = new Set();
  const add = (raw) => { const rel = visibleRel(root, raw, visible); if (rel) out.add(rel); };
  let block = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\d{2}:\d{2}\s+[+-]\d/.test(line)) {
      block = /\[E\]\s*$/.test(line);
      if (block) {
        const m = /^\d{2}:\d{2}\s+[+-][\d\s+-]*:\s+(.+?):\s+.*\[E\]\s*$/.exec(line);
        if (m) add(m[1]);
      }
      continue;
    }
    if (!block) continue;
    const bare = line.trim();
    if (bare && !/\s/.test(bare) && !bare.startsWith("package:") && !bare.startsWith("#")) add(bare);
    for (const ext of line.matchAll(/\.[A-Za-z0-9]+(?![A-Za-z0-9])/g)) {
      const end = ext.index + ext[0].length;
      if (!/^\s+\d+:\d+/.test(line.slice(end))) continue;
      let lo = end;
      while (lo > 0 && end - lo < MAX_PATH && !PATH_STOP.test(line[lo - 1])) lo--;
      for (let s = lo; s < end; s++) {
        if (SPACE.test(line[s]) || (s > lo && !SPACE.test(line[s - 1]))) continue;
        add(line.slice(s, end));
        break;
      }
    }
  }
  return [...out];
}

const squashWs = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// The file's stem without a trailing test/spec marker: feature_providers_test.js → feature_providers.
function subjectOf(file) {
  return toSlash(file).split("/").pop().replace(/\.[^.]+$/, "").replace(/(?:[._-](?:test|spec)|Test|Spec)$/i, "");
}
// A change names a file when its text holds the path, the subject (at least 6 characters), or a `_` prefix of the subject of at
// least 8 characters (rpc_error names rpc_error_correlation_test).
function namesFile(text, file) {
  const t = squashWs(text).toLowerCase();
  if (!t) return false;
  if (t.includes(toSlash(file).toLowerCase())) return true;
  const subject = subjectOf(file).toLowerCase();
  if (subject.length >= 6 && t.includes(subject)) return true;
  if (subject.length < 8) return false;
  let acc = "";
  for (const part of subject.split(/[_-]/).filter(Boolean)) {
    acc = acc ? `${acc}_${part}` : part;
    if (acc.length >= 8 && acc.length < subject.length && (t.includes(acc) || t.includes(acc.replace(/_/g, " ")))) return true;
  }
  return false;
}
// The change that likely broke an unowned test: a phase shared change or an owner answer (halt, decision, allow) whose path is
// the file, else one whose text names it. Path equality wins; a shared change wins over an answer that only names the subject.
function likelyCause(file, shared, answers) {
  const eq = (p) => p && toSlash(p).toLowerCase() === toSlash(file).toLowerCase();
  const blob = (rec) => [rec.path, rec.change, rec.reason].filter(Boolean).join(" ");
  const asShared = (s) => ({ kind: "shared", id: s.id ?? null, from: s.from ?? null, path: s.path ? toSlash(s.path) : null, text: squashWs(s.change).slice(0, 240) });
  const asAnswer = (a) => ({ kind: "decision", id: a.id ?? null, from: a.plan ?? null, path: a.path ? toSlash(a.path) : null, text: squashWs(a.reason).slice(0, 240) });
  const sharedPath = (shared ?? []).find((s) => eq(s.path));
  const answerPath = (answers ?? []).find((a) => eq(a.path));
  if (answerPath) return asAnswer(answerPath);
  if (sharedPath) return asShared(sharedPath);
  const s = (shared ?? []).find((x) => namesFile(blob(x), file));
  if (s) return asShared(s);
  const a = (answers ?? []).find((x) => namesFile(blob(x), file));
  return a ? asAnswer(a) : null;
}
// Kit feedback 108 F2: failing test files no plan of this gate owns (an earlier wave's plan, or none). context plans are not this
// wave. cause is set when a shared change or an owner answer of the phase names the file or its subject.
function unownedTestsOf(root, phaseDir, plans, failures, prefixes) {
  const files = [...new Set(failures.flatMap((f) => f.tests ?? []).filter((file) => !specificOwners(file, plans, prefixes).length))];
  if (!files.length) return [];
  let shared = [];
  try { shared = readState(root, phaseDir).shared ?? []; } catch { shared = []; }
  let answers = [];
  try { answers = readAnswers(path.join(resolveInside(root, phaseDir), OWNER_ANSWERS_FILE)).answers.filter((a) => ["halt", "decision", "allow"].includes(a.kind)); } catch { answers = []; }
  return files.map((file) => ({ file, cause: likelyCause(file, shared, answers) }));
}

// Kit feedback 102: the visible files an argv names (a word that is a path to one, relative to the root or absolute inside it).
function argvFiles(root, argv, visible) {
  const out = new Set();
  for (const w of argv ?? []) {
    if (!w || w.startsWith("-")) continue;
    const abs = path.resolve(root, w);
    const rel = toSlash(path.relative(root, abs));
    if (isInside(abs, root) && visible.has(pathKey(rel))) out.add(rel);
  }
  return [...out];
}
// The test files a timed-out step was running: those its argv names (an obligation), else those the last output line that names
// one names (the suite names no file; a runner that prints a test when it starts names the one that never finished).
function hungFiles(root, s, visible, checks) {
  const tests = (list) => list.filter((f) => isTestFile(f, checks));
  const named = tests(argvFiles(root, s.argv, visible));
  if (named.length) return { files: named, source: "argv" };
  for (const stream of [s.streams?.stdout, s.streams?.stderr].filter(Boolean)) {
    const lines = String(fs.readFileSync(path.join(root, stream), "utf8")).split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const files = tests(mentionedFiles(root, lines[i], visible));
      if (files.length) return { files, source: "output" };
    }
  }
  return { files: [], source: null };
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
const RUN_RECORD = /^\.planning\/(phases|quick)\/[^/]+\/(evidence|review|prereview|transfers|transfers-pending)\/|^\.planning\/(phases|quick)\/[^/]+\/([^/]+-REVIEW\.md|deferred\.md|execute-progress\.json|plan-progress\.json|execute-baseline\.json|commits\.json|[^/]+-HALT\.json|halt-answers\.json|owner-answers\.json)$/;
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
// A whole-file kill sets r.hungFile; the step then names that file (source "file") instead of scanning the log.
// Kit feedback 112: a runtime crash in that output is not a hang, so the hung-file line is not written.
function recordRun(root, logDir, name, argv, r, extra = {}) {
  const { crashPatterns = [], ...rest } = extra;
  const blob = `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`;
  const outcome = r.timedOut ? "timeout" : r.error && r.code === null ? "unavailable" : r.code === 0 ? "passed" : "failed";
  // A passing step may print the phrase (a test of the error text). Only a timed-out or failed step is a tool crash.
  const signature = outcome === "timeout" || outcome === "failed" ? crashSignature(blob, crashPatterns) : null;
  const hungNote = !signature && r.hungFile ? `\nhung test file: ${r.hungFile} (killed at its whole-file bound)\n` : "";
  const stdout = `${r.stdout ?? ""}${hungNote}`;
  const log = path.join(logDir, `${safeName(name)}.log`);
  writeTextAtomic(log, `${stdout}\n${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`);
  const streams = { stdout: path.join(logDir, `${safeName(name)}.stdout.log`), stderr: path.join(logDir, `${safeName(name)}.stderr.log`) };
  writeTextAtomic(streams.stdout, stdout);
  writeTextAtomic(streams.stderr, `${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`);
  return { name, argv, outcome, exitCode: r.timedOut ? TIMEOUT_CODE : r.code, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), streams: { stdout: toSlash(path.relative(root, streams.stdout)), stderr: toSlash(path.relative(root, streams.stderr)) }, text: `${stdout}\n${r.stderr ?? ""}`, ...rest, ...(signature ? { crash: { signature } } : {}), ...(!signature && r.hungFile ? { hang: { files: [r.hungFile], source: "file" } } : {}) };
}
// Free memory at the start and the lowest sample while the command runs (kit feedback 112 F2).
async function watched(fn) {
  const watch = watchMemory();
  try {
    return { r: await fn(), memory: watch.finish() };
  } finally {
    watch.stop();
  }
}
async function step(root, logDir, name, argv, timeoutS, extra = {}) {
  const { r, memory } = await watched(() => runArgv(argv, { cwd: root, timeoutMs: timeoutS * 1000 }));
  return recordRun(root, logDir, name, argv, r, { ...extra, memory });
}

// A step that did not run still has the ADPT-17 shape: a log holding the reason and an outcome that never certifies.
function noRun(root, logDir, name, outcome, text, extra = {}) {
  const log = path.join(logDir, `${safeName(name)}.log`);
  writeTextAtomic(log, `${text}\n`);
  return { name, argv: [], outcome, exitCode: null, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), text, memory: sampleMemory(), ...extra };
}

// Kit feedback 87 C1: every gate runs check-weakening over the files changed since HEAD (a composition passes no base and no file
// list, so it cannot narrow it). A weakening no plan declared and the owner did not allow is the failed step `checks`, whose
// failure names the answer (stage Checks, `ph gsd allow`) and goes to no fixer; a check that cannot run fails closed. The
// evidence holds the step whenever the check had something to judge (a changed check file, a weakening, an allow, an error).
export const CHECKS_STEP = "checks";
function checksStep(root, phaseDir, logDir, notes) {
  let r;
  try {
    r = checkWeakening(root, phaseDir);
  } catch (e) {
    r = { status: "error", error: errText(e), weakened: [], allowed: [], notes: [] };
  }
  for (const n of r.notes) notes.push(`checks: ${n}`);
  for (const a of r.allowed) notes.push(`checks: ${a.path} ${a.kind} allowed by ${a.by === "plan" ? `plan ${a.plan}` : `owner answer ${a.answer}`}: ${a.reason}`);
  const summary = { status: r.status, weakened: r.weakened, allowed: r.allowed, ...(r.error ? { error: r.error } : {}) };
  if (r.status === "off" || (r.status === "ok" && !r.compared.length && !r.allowed.length)) return { summary };
  const stop = r.weakened.length ? checksStop(phaseDir, r.weakened) : null;
  const text = r.status === "error" ? `check-weakening could not run: ${r.error}`
    : stop ? [stop.reason, "Answers:", ...stop.options.map((o) => `- ${o}`)].join("\n")
    : `${r.compared.length} changed test or gate file(s) compared with ${r.base ? r.base.slice(0, 7) : "no base"}; no unallowed weakening${r.allowed.length ? ` (${r.allowed.length} allowed)` : ""}`;
  const log = path.join(logDir, `${CHECKS_STEP}.log`);
  writeTextAtomic(log, `${text}\n`);
  const outcome = r.status === "error" ? "unavailable" : stop ? "failed" : "passed";
  return { summary, stop, step: { name: CHECKS_STEP, argv: [], outcome, exitCode: outcome === "passed" ? 0 : 1, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), text, memory: sampleMemory(), plan: null, task: null, kind: CHECKS_STEP } };
}

// Flow verb test-command {testArgv?} -> {argv, caseTimeoutS}: the test command a gate runs, with the per-test timeout (kit feedback 102).
export const testCommand = (root, { testArgv } = {}) => {
  const cfg = loadConfig(root);
  return testCommandOf(cfg, cfg.adapter.commands.test ? testArgv ?? cfg.adapter.commands.test : null);
};

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
  // Kit feedback 102 F1: the test files of a step that timed out; a later step of this gate run that would run one does not run.
  const checks = cfg.adapter.checks ?? {};
  const hung = [];
  let seen = null;
  const noteHang = (s) => {
    // Kit feedback 112: a tool crash is not a hang, and later steps of this gate run are not blocked by it.
    if (s.crash?.signature) return;
    if (s.outcome !== "timeout") return;
    // A whole-file kill (kit feedback 109 F4) already names its file; the output scan is the fallback (item 102).
    if (!s.hang?.files?.length) {
      const h = hungFiles(root, s, (seen ??= visibleFiles(root)), checks);
      if (h.files.length) s.hang = h;
    }
    const h = s.hang ?? { files: [], source: null };
    hung.push({ step: s.name, files: h.files, source: h.source, blocked: [] });
  };
  const hangOf = (argv) => {
    const files = hung.some((h) => h.files.length) ? argvFiles(root, argv, (seen ??= visibleFiles(root))) : [];
    for (const h of hung) {
      const hit = h.files.filter((f) => files.includes(f));
      if (hit.length) return { h, files: hit };
    }
    return null;
  };
  // Kit feedback 102 F2: the suite runs with the per-test limit, like every obligation that runs the test command (gateObligation).
  const { argv: suiteArgv, caseTimeoutS } = testCommandOf(cfg, cmds.test ? input.testArgv ?? cmds.test : null);
  if (Boolean(cmds.test_case_timeout_s) !== Boolean(cmds.test_case_timeout_arg?.length)) notes.push(`adapter.commands.${cmds.test_case_timeout_s ? "test_case_timeout_s is set without test_case_timeout_arg" : "test_case_timeout_arg is set without test_case_timeout_s"}: the test runner gets no per-test timeout`);
  // Kit feedback 109 F4 / 107 F3: the whole-file bound. Unset test_file_timeout_s uses test_timeout_s. A test command that
  // names several test files runs them one at a time; a suite (no file) keeps its step cap, and a shorter file bound kills
  // the tree once one file has been current that long.
  const fileTimeout = fileTimeoutS(cmds);
  const crashPatterns = cfg.adapter.crash_signatures ?? [];
  const testPrefix = (argv) => Array.isArray(cmds.test) && cmds.test.length > 0 && Array.isArray(argv) && cmds.test.every((w, i) => argv[i] === w);
  const runBounded = async (name, argv, timeoutS, extra = {}) => {
    const tagged = { ...extra, crashPatterns };
    if (!testPrefix(argv)) return step(root, logDir, name, argv, timeoutS, tagged);
    const files = argvFiles(root, argv, (seen ??= visibleFiles(root))).filter((f) => isTestFile(f, checks));
    if (files.length < 2 && !(files.length === 0 && fileTimeout < timeoutS)) return step(root, logDir, name, argv, timeoutS, tagged);
    const { r, memory } = await watched(() => runBoundedTests({ cwd: root, argv, files, timeoutS, fileTimeoutS: fileTimeout, isTest: (rel) => isTestFile(rel, checks) }));
    return recordRun(root, logDir, name, argv, r, { ...tagged, memory });
  };
  const run = async (name, argv, timeoutS, extra = {}) => {
    const prior = reusable.get(name);
    if (prior && JSON.stringify(prior.argv) === JSON.stringify(argv)) {
      notes.push(`${name}: passed in an interrupted gate run of the same inputs; reused`);
      return { ...prior, memory: prior.memory ?? sampleMemory(), ...extra, reused: true, text: fs.existsSync(path.join(root, prior.log)) ? fs.readFileSync(path.join(root, prior.log), "utf8") : "" };
    }
    return runBounded(name, argv, timeoutS, extra);
  };
  // ADPT-10: the same machine-wide lock as every other adapter.mutex user.
  await withMutex(cfg.adapter.mutex, async () => {
    let gateRed = false;
    if (input.suite === false) notes.push("obligations only: the adapter gates, the build and the tests run before the commit");
    else {
      for (const g of cmds.gates ?? []) {
        const s = await run(gateStepName(g.name), g.argv, cmds.build_timeout_s);
        steps.push(s);
        noteHang(s);
        checkpoint();
        if (s.outcome !== "passed") gateRed = true;
      }
      if (cmds.build) { steps.push(await run("build", cmds.build, cmds.build_timeout_s)); noteHang(steps.at(-1)); checkpoint(); }
      else { notes.push("build not configured (adapter.commands.build)"); steps.push(noRun(root, logDir, "build", "not_configured", notes.at(-1))); }
      if (cmds.test) { steps.push(await run("test", suiteArgv, cmds.test_timeout_s)); noteHang(steps.at(-1)); checkpoint(); }
      else { notes.push("tests not configured (adapter.commands.test)"); steps.push(noRun(root, logDir, "test", "not_configured", notes.at(-1))); }
    }
    // Kit feedback 67 F5: a plan that produces structured symbols (outline manifest) must have them at the declared file.
    if (cfg.gsd.contract_check) for (const c of producedCheck(root, phaseDir, (input.plans ?? []).map((p) => p.id))) {
      const text = c.ok ? `${c.symbols} produced symbol(s) found at their declared files` : ["produced symbols missing:", ...c.problems].join("\n");
      const log = path.join(logDir, `${safeName(`contract-${c.plan}`)}.log`);
      writeTextAtomic(log, `${text}\n`);
      steps.push({ name: `contract-${c.plan}`, argv: [], outcome: c.ok ? "passed" : "failed", exitCode: c.ok ? 0 : 1, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), text, plan: c.plan, task: null, kind: "contract" });
      for (const n of c.notes) notes.push(`contract ${c.plan}: ${n}`);
    }
    for (const p of input.plans ?? []) for (const [i, name] of obligationStepNames(p.id, p.verify).entries()) {
      const ob = p.verify[i];
      const meta = { plan: p.id, task: ob.task, kind: ob.kind };
      if (gateRed || input.skipObligations) { steps.push(noRun(root, logDir, name, "unavailable", gateRed ? "not executed: an earlier gate failed" : "not executed: skipped", meta)); continue; }
      const o = await gateObligation(cfg, { codeRoot: root, phaseDir, ...ob });
      if (o.outcome !== "ready") { steps.push(noRun(root, logDir, name, o.outcome, o.reason, meta)); continue; }
      const { argument, targets } = o;
      const block = hangOf(o.argv);
      if (block) {
        block.h.blocked.push(name);
        steps.push(noRun(root, logDir, name, "failed", `blocked by hang: ${block.files.join(", ")} timed out in step ${block.h.step} of this gate run; not run again in this pass`, { ...meta, argv: o.argv, blockedByHang: { step: block.h.step, files: block.files } }));
        continue;
      }
      const s = await runBounded(name, o.argv, o.timeoutS, meta);
      noteHang(s);
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
  const weak = checksStep(root, phaseDir, logDir, notes);
  if (weak.step) steps.push(weak.step);
  const after = inputsOf(root, scopes);
  const moved = Object.keys({ ...inputs.files, ...after.files }).filter((f) => inputs.files[f] !== after.files[f]);
  if (after.head !== inputs.head) moved.unshift("HEAD");
  if (after.config !== inputs.config) moved.unshift("adapter configuration");
  if (moved.length) steps.push(noRun(root, logDir, "inputs-stable", "failed", `inputs changed while the gate ran: ${moved.slice(0, 10).join(", ")}`));
  const evidence = { v: 1, waveId: input.waveId, at: new Date().toISOString(), inputs, ...(input.suite === false ? { suite: false } : {}), steps: steps.map(({ text, ...s }) => s) };
  writeJsonAtomic(evidenceFile, evidence);
  const visible = visibleFiles(root);
  const failures = steps.filter((s) => s.outcome !== "passed").map((s) => (s.kind === CHECKS_STEP
    ? { step: s.name, plan: null, outcome: s.outcome, excerpt: s.text, log: s.log, files: [], needsOwner: weak.stop ?? { stage: "Checks", reason: s.text, options: ["fix the cause (git, the harness config), then rerun with the same args"] } }
    : stepFailure(root, s, visible, checks)));
  const attribution = await attribute(root, cfg, [...(input.plans ?? []), ...(input.context ?? []).map(({ id, owns }) => ({ id, owns: owns ?? [] }))], failures.filter((f) => f.step !== CHECKS_STEP), prefixes);
  if (attribution.attributionError) notes.push(`attribution hook failed: ${attribution.attributionError}; its failures stay unplaced`);
  // Kit feedback 112: a crash is reported on its own. It is not a timeout hang, even when the step also hit its limit.
  const crashed = steps.filter((s) => s.crash?.signature).map((s) => `${s.name} crashed: ${s.crash.signature}`);
  const timedOut = steps.filter((s) => s.outcome === "timeout" && !s.crash?.signature).map((s) => {
    const h = hung.find((x) => x.step === s.name);
    return `${s.name} timed out after its limit (exit ${TIMEOUT_CODE})${h?.files.length ? `; hung test file(s) ${h.files.join(", ")} (${h.source === "argv" ? "named by its command" : h.source === "file" ? "killed at its whole-file bound" : "named last in its output"})${h.blocked.length ? `; blocked by hang in this pass: ${h.blocked.join(", ")}` : ""}` : ""}`;
  });
  // Kit feedback 108 F2: failing test files no plan of this gate owns, with the change that likely broke them when one names the file.
  const unownedTests = unownedTestsOf(root, phaseDir, input.plans ?? [], failures, prefixes);
  return { green: failures.length === 0, evidence: toSlash(path.relative(root, evidenceFile)), notes, timedOut, ...(crashed.length ? { crashed } : {}), ...(hung.length ? { hung } : {}), ...(suiteArgv ? { testCommand: suiteArgv, caseTimeoutS } : {}), failures, failureCount: failures.length, checks: weak.summary, ...attribution, ...(unownedTests.length ? { unownedTests } : {}) };
}

// A failed step as the fixers see it: the files its output names, and the test files a fixer may run to see it (kit feedback 102
// F3): those its command names, among its files, and the hung ones. A step that hung (or was blocked by a hang) names its hung
// files and the files its output reports at a position; a file only mentioned (a progress line of a test that ran) is none.
function stepFailure(root, s, visible, checks) {
  // Kit feedback 112: a tool crash is not attributed to the file its output printed last, and no fixer is given a test to run.
  if (s.crash?.signature) return { step: s.name, plan: s.plan ?? null, outcome: s.outcome, excerpt: excerpt(s.text), log: s.log, files: [], crash: { signature: s.crash.signature } };
  const hungOnes = s.hang?.files ?? s.blockedByHang?.files ?? [];
  const files = [...new Set([...mentionedFiles(root, s.text, visible, { locatedOnly: hungOnes.length > 0 }), ...failureReportFiles(root, s.text, visible), ...hungOnes])];
  const tests = [...new Set([...argvFiles(root, s.argv, visible), ...files].filter((f) => isTestFile(f, checks)))];
  return { step: s.name, plan: s.plan ?? null, outcome: s.outcome, excerpt: excerpt(s.text), log: s.log, files, ...(tests.length ? { tests } : {}) };
}

async function attribute(root, cfg, plans, failures, prefixes) {
  const byPlan = {};
  const unplaced = [];
  const blockedBy = {};
  const ownersOfFiles = (f) => [...new Set(f.files.flatMap((file) => specificOwners(file, plans, prefixes).map((p) => p.id)))];
  for (const f of failures) {
    // Kit feedback 112: a tool crash is an environment failure. It is not the plan's, even when the step is that plan's obligation.
    if (f.crash) { unplaced.push(f); continue; }
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
  const open = unplaced.filter((f) => !f.crash);
  if (open.length && cfg.adapter.attribution) {
    // G077: each failure carries an id, and an assignment names the failure it answers (an id, or the old echo of the
    // failure text at its own position).
    const ids = open.map((_, i) => `f${i + 1}`);
    const res = await runHook(root, cfg, cfg.adapter.attribution, { op: "attribute", failures: open.map((f, i) => ({ id: ids[i], text: f.excerpt, file: f.files[0] })), plans: plans.map((p) => ({ id: p.id, owns: p.owns ?? [] })) });
    if (res.error) attributionError = res.error;
    for (const [i, as] of (res.assignments ?? []).entries()) {
      const at = ids.indexOf(as?.failure) >= 0 ? ids.indexOf(as.failure) : i;
      const hit = open[at];
      const idx = hit ? unplaced.indexOf(hit) : -1;
      if (as?.plan && idx >= 0) { (byPlan[as.plan] ??= []).push(unplaced[idx]); unplaced[idx] = null; }
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
  // Kit feedback 97: partial = proof of every step but the stale ones (a command changed since the gate ran).
  const stale = v.staleSteps ? { stale: v.staleSteps.map((x) => x.name) } : {};
  return { valid: false, status: v.verdict, reason: v.reasons.slice(0, 5).join("; "), ...stale, code: 1 };
}

