// Post-wave gate (GSDF-44, GSDF-51): adapter gates, build, tests and plan obligations, one gate-evidence file
// per run (ADPT-17), failure attribution by owns then the adapter `attribute` hook; evidence validation.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { readJsonIf, writeJsonAtomic, writeTextAtomic } from "../../harness/lib/io.mjs";
import { resolveInside, safeName, toSlash } from "../../harness/lib/paths.mjs";
import { runArgv } from "../../harness/lib/proc.mjs";
import { invokeHook } from "../../harness/adapter/hooks.mjs";
import { withMutex } from "../../harness/adapter/mutex.mjs";
import { evidenceVerdict, requiredSteps, executionProblem, gateStepName, obligationStepName } from "../../harness/adapter/evidence.mjs";
import { gateObligation } from "../../harness/adapter/contract.mjs";
import { sha256 } from "../../harness/lib/hash.mjs";
import { gitLines, head } from "./flow-git.mjs";
import { contentHash, owned, ownsPath, ownsPrefixes } from "./flow-owns.mjs";

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

function mentionedFiles(root, text) {
  const found = new Set();
  for (const m of String(text).matchAll(/(?:^|[\s("'`])((?:[A-Za-z]:)?[\w./\\-]+\.[A-Za-z0-9]+)(?::\d+)?/g)) {
    const abs = path.resolve(root, m[1]);
    if (abs.startsWith(root) && fs.existsSync(abs)) found.add(toSlash(path.relative(root, abs)));
  }
  return [...found];
}

// Input scopes of a gate: the owned paths of its plans and the adapter instructions (ADPT-17).
function scopesOf(cfg, plans, prefixes) {
  const scopes = new Set();
  for (const p of plans) for (const o of p.owns ?? []) {
    const rel = ownsPath(o, prefixes).replace(/\/$/, "");
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
  // CONF-12: configuration identity comes from the validated shared loader, never raw config files.
  const cfg = loadConfig(root);
  return { head: head(root), scopes, files: Object.fromEntries(Object.entries(files).sort()), config: sha256(JSON.stringify({ adapter: cfg.adapter, gsd: cfg.gsd })) };
}

// Digest line value of an agent call: the current content of the files it judges (GSDF-03, CR-GSF-19).
export function digest(root, { files = [], owns = [] }) {
  const cfg = loadConfig(root);
  const prefixes = ownsPrefixes(root);
  const ownScopes = owns.map((o) => ownsPath(o, prefixes).replace(/\/$/, ""));
  const scopes = [...new Set([...files.map((f) => toSlash(f)), ...ownScopes, ...(cfg.adapter.instructions ?? [])])].filter(Boolean).sort();
  const now = inputsOf(root, scopes);
  for (const rel of Object.keys(now.files)) if (rel.startsWith("_workspace/") || rel.startsWith(`${cfg.worktree_dir}/`)) delete now.files[rel];
  const missing = files.filter((f) => !fs.existsSync(resolveInside(root, f))).sort();
  return { hash: sha256(JSON.stringify({ head: now.head, files: now.files, missing, adapter: cfg.adapter, gsd: cfg.gsd })) };
}

function nextEvidence(dir, waveId) {
  const used = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${waveId}-`)).length : 0;
  return path.join(dir, `${waveId}-${used + 1}.json`);
}

const NOT_RUN = { count: null, targets: [] };

async function step(root, logDir, name, argv, timeoutS, extra = {}) {
  const r = await runArgv(argv, { cwd: root, timeoutMs: timeoutS * 1000 });
  const log = path.join(logDir, `${safeName(name)}.log`);
  writeTextAtomic(log, `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`);
  const outcome = r.timedOut ? "timeout" : r.error && r.code === null ? "unavailable" : r.code === 0 ? "passed" : "failed";
  return { name, argv, outcome, exitCode: r.timedOut ? TIMEOUT_CODE : r.code, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), text: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, ...extra };
}

// A step that did not run still has the ADPT-17 shape: a log holding the reason and an outcome that never certifies.
function noRun(root, logDir, name, outcome, text, extra = {}) {
  const log = path.join(logDir, `${safeName(name)}.log`);
  writeTextAtomic(log, `${text}\n`);
  return { name, argv: [], outcome, exitCode: null, executed: { ...NOT_RUN }, log: toSlash(path.relative(root, log)), text, ...extra };
}

// input: {waveId, plans: [{id, owns, verify: [{task, kind, command, target}]}], testArgv?, skipObligations?}
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
  // ADPT-10: the same machine-wide lock as every other adapter.mutex user.
  await withMutex(cfg.adapter.mutex, async () => {
    let gateRed = false;
    for (const g of cmds.gates ?? []) {
      const s = await step(root, logDir, gateStepName(g.name), g.argv, cmds.build_timeout_s);
      steps.push(s);
      if (s.outcome !== "passed") gateRed = true;
    }
    if (cmds.build) steps.push(await step(root, logDir, "build", cmds.build, cmds.build_timeout_s));
    else { notes.push("build not configured (adapter.commands.build)"); steps.push(noRun(root, logDir, "build", "not_configured", notes.at(-1))); }
    if (cmds.test) steps.push(await step(root, logDir, "test", input.testArgv ?? cmds.test, cmds.test_timeout_s));
    else { notes.push("tests not configured (adapter.commands.test)"); steps.push(noRun(root, logDir, "test", "not_configured", notes.at(-1))); }
    for (const p of input.plans ?? []) for (const ob of p.verify ?? []) {
      const name = obligationStepName(p.id, ob.task, ob.kind);
      const meta = { plan: p.id, task: ob.task, kind: ob.kind };
      if (gateRed || input.skipObligations) { steps.push(noRun(root, logDir, name, "unavailable", gateRed ? "not executed: an earlier gate failed" : "not executed: skipped", meta)); continue; }
      const o = await gateObligation(cfg, { codeRoot: root, phaseDir, ...ob });
      if (o.outcome !== "ready") { steps.push(noRun(root, logDir, name, o.outcome, o.reason, meta)); continue; }
      const { argument, targets } = o;
      const s = await step(root, logDir, name, o.argv, o.timeoutS, meta);
      if (o.evidenceParser) {
        const ev = await runHook(root, cfg, o.evidenceParser, { op: "evidence", phaseDir, kind: ob.kind, argument, targets, exitCode: s.exitCode, stdoutPath: s.log, stderrPath: s.log });
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
  const evidence = { v: 1, waveId: input.waveId, at: new Date().toISOString(), inputs, steps: steps.map(({ text, ...s }) => s) };
  writeJsonAtomic(evidenceFile, evidence);
  const failures = steps.filter((s) => s.outcome !== "passed").map((s) => ({ step: s.name, plan: s.plan ?? null, outcome: s.outcome, excerpt: excerpt(s.text), log: s.log, files: mentionedFiles(root, s.text) }));
  const attribution = await attribute(root, cfg, input.plans ?? [], failures, prefixes);
  const timedOut = steps.filter((s) => s.outcome === "timeout").map((s) => `${s.name} timed out after its limit (exit ${TIMEOUT_CODE})`);
  return { green: failures.length === 0, evidence: toSlash(path.relative(root, evidenceFile)), notes, timedOut, failures, failureCount: failures.length, ...attribution };
}

async function attribute(root, cfg, plans, failures, prefixes) {
  const byPlan = {};
  const unplaced = [];
  const blockedBy = {};
  for (const f of failures) {
    if (f.plan) { (byPlan[f.plan] ??= []).push(f); continue; }
    const owners = [...new Set(f.files.flatMap((file) => plans.filter((p) => owned(file, p.owns ?? [], prefixes)).map((p) => p.id)))];
    if (owners.length) for (const o of owners) (byPlan[o] ??= []).push(f);
    else unplaced.push(f);
  }
  if (unplaced.length && cfg.adapter.attribution) {
    const res = await runHook(root, cfg, cfg.adapter.attribution, { op: "attribute", failures: unplaced.map((f) => ({ text: f.excerpt, file: f.files[0] })), plans: plans.map((p) => ({ id: p.id, owns: p.owns ?? [] })) });
    for (const [i, as] of (res.assignments ?? []).entries()) if (as?.plan && unplaced[i]) { (byPlan[as.plan] ??= []).push(unplaced[i]); unplaced[i] = null; }
  }
  // An obligation of plan A failing in plan B's files marks A blocked by B.
  for (const f of failures) if (f.plan) for (const file of f.files) for (const p of plans) if (p.id !== f.plan && owned(file, p.owns ?? [], prefixes)) (blockedBy[f.plan] ??= new Set()).add(p.id);
  return { byPlan, unplaced: unplaced.filter(Boolean), blockedBy: Object.fromEntries(Object.entries(blockedBy).map(([k, v]) => [k, [...v]])) };
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

