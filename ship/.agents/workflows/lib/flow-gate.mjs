// Post-wave gate (GSDF-44, GSDF-51): adapter gates, build, tests and plan obligations, one gate-evidence file
// per run (ADPT-17), failure attribution by owns then the adapter `attribute` hook; evidence validation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { readJsonIf, writeJsonAtomic, writeTextAtomic } from "../../harness/lib/io.mjs";
import { resolveInside, safeName, toSlash } from "../../harness/lib/paths.mjs";
import { pidAlive, runArgv } from "../../harness/lib/proc.mjs";
import { head } from "./flow-git.mjs";
import { contentHash, owned, ownsPath, ownsPrefixes } from "./flow-owns.mjs";

const TIMEOUT_CODE = 124;
const EXCERPT_LINES = 40;

// ADPT-15: no shell; .mjs/.js through node; one JSON request on stdin, one JSON line back with v: 1.
export async function runHook(root, cfg, script, request) {
  const abs = path.resolve(root, script);
  const argv = /\.(mjs|js)$/.test(abs) ? [process.execPath, abs] : [abs];
  const r = await runArgv(argv, { cwd: root, input: JSON.stringify({ v: 1, codeRoot: root, ...request }), timeoutMs: cfg.adapter.hook_timeout_s * 1000 });
  if (r.code !== 0 || r.timedOut) return { error: `hook ${script} ${r.timedOut ? "timed out" : `exited ${r.code}`}` };
  try {
    const res = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop());
    return res?.v === 1 ? res : { error: `hook ${script} answered v ${res?.v}` };
  } catch {
    return { error: `hook ${script} printed no JSON line` };
  }
}

// Split an obligation argument into argv without a shell (double and single quotes group words).
export function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(text)); ) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

async function withMutex(name, fn) {
  if (!name) return fn();
  const lock = path.join(os.tmpdir(), `paseo-kit-mutex-${safeName(name)}.lock`);
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch {
      const owner = Number(fs.existsSync(lock) ? fs.readFileSync(lock, "utf8") : 0);
      if (!owner || !pidAlive(owner)) { fs.rmSync(lock, { force: true }); continue; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  try { return await fn(); } finally { fs.rmSync(lock, { force: true }); }
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

function inputsOf(root, cfg, plans, prefixes) {
  const files = {};
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs)) walk(rel ? `${rel}/${f}` : f); return; }
    files[toSlash(rel)] = contentHash(abs);
  };
  for (const p of plans) for (const o of p.owns ?? []) {
    const rel = ownsPath(o, prefixes).replace(/\/$/, "");
    if (rel && !rel.startsWith(".planning/")) walk(rel);
  }
  for (const i of cfg.adapter.instructions ?? []) walk(i);
  return { head: head(root), files: Object.fromEntries(Object.entries(files).sort()) };
}

function nextEvidence(dir, waveId) {
  const used = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${waveId}-`)).length : 0;
  return path.join(dir, `${waveId}-${used + 1}.json`);
}

async function step(root, logDir, name, argv, timeoutS, extra = {}) {
  const r = await runArgv(argv, { cwd: root, timeoutMs: timeoutS * 1000 });
  const log = path.join(logDir, `${safeName(name)}.log`);
  writeTextAtomic(log, `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`);
  const outcome = r.timedOut ? "timeout" : r.error && r.code === null ? "unavailable" : r.code === 0 ? "passed" : "failed";
  return { name, argv, outcome, exitCode: r.timedOut ? TIMEOUT_CODE : r.code, executed: null, log: toSlash(path.relative(root, log)), text: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, ...extra };
}

// input: {waveId, plans: [{id, owns, verify: [{task, kind, command, target}]}], testArgv?, skipObligations?}
export async function gate(root, phaseDir, input) {
  const cfg = loadConfig(root);
  const cmds = cfg.adapter.commands;
  const vocab = cfg.adapter.verify_vocabulary;
  const prefixes = ownsPrefixes(root);
  const dir = resolveInside(root, phaseDir);
  const evidenceFile = nextEvidence(path.join(dir, "evidence"), input.waveId);
  const logDir = evidenceFile.replace(/\.json$/, ".logs");
  const steps = [];
  const notes = [];
  await withMutex(cfg.adapter.mutex, async () => {
    let gateRed = false;
    for (const g of cmds.gates ?? []) {
      const s = await step(root, logDir, `gate-${g.name}`, g.argv, cmds.build_timeout_s);
      steps.push(s);
      if (s.outcome !== "passed") gateRed = true;
    }
    if (cmds.build) steps.push(await step(root, logDir, "build", cmds.build, cmds.build_timeout_s));
    else notes.push("build not configured (adapter.commands.build)");
    if (cmds.test) steps.push(await step(root, logDir, "test", input.testArgv ?? cmds.test, cmds.test_timeout_s));
    else notes.push("tests not configured (adapter.commands.test)");
    for (const p of input.plans ?? []) for (const ob of p.verify ?? []) {
      const name = `${p.id}-${ob.task ?? "task"}-${ob.kind}`;
      const v = vocab[ob.kind];
      if (gateRed || input.skipObligations) { steps.push({ name, plan: p.id, task: ob.task, kind: ob.kind, argv: [], outcome: "not_executed", exitCode: null, executed: null, log: null, text: gateRed ? "skipped: an earlier gate failed" : "skipped" }); continue; }
      if (!v) { steps.push({ name, plan: p.id, task: ob.task, kind: ob.kind, argv: [], outcome: "unavailable", exitCode: null, executed: null, log: null, text: `kind ${ob.kind} not in adapter.verify_vocabulary` }); continue; }
      const argument = String(ob.command ?? "").startsWith(v.prefix) ? String(ob.command).slice(v.prefix.length).trim() : String(ob.command ?? "").trim();
      let targets = ob.target ? [ob.target] : [];
      if (v.parser) { const pr = await runHook(root, cfg, v.parser, { op: "parse", phaseDir, kind: ob.kind, argument }); targets = pr.targets ?? targets; }
      let argv;
      let timeoutS = cmds.test_timeout_s;
      if (v.runner) { const rc = cmds.verify[v.runner]; argv = rc ? [...rc.argv, ...targets] : null; timeoutS = rc?.timeout_s ?? timeoutS; }
      else if (ob.kind === "build") argv = cmds.build;
      else argv = splitArgs(argument);
      if (!argv || !argv.length) { steps.push({ name, plan: p.id, task: ob.task, kind: ob.kind, argv: [], outcome: "not_configured", exitCode: null, executed: null, log: null, text: `no runner for kind ${ob.kind}` }); continue; }
      const s = await step(root, logDir, name, argv, timeoutS, { plan: p.id, task: ob.task, kind: ob.kind });
      if (v.evidence_parser) {
        const ev = await runHook(root, cfg, v.evidence_parser, { op: "evidence", phaseDir, kind: ob.kind, argument, targets, exitCode: s.exitCode, stdoutPath: s.log, stderrPath: s.log });
        if (ev.error) { s.outcome = "unavailable"; s.text += `\n${ev.error}`; }
        else {
          s.executed = { count: ev.executed?.count ?? 0, targets: ev.executed?.targets ?? [] };
          if (ev.outcome !== "passed") s.outcome = ev.outcome === "unavailable" ? "unavailable" : "failed";
        }
      } else if (!v.exit_code_sufficient) s.outcome = s.outcome === "passed" ? "unavailable" : s.outcome;
      // A run that executed nothing for named targets is never a pass (GSDF-44, INV-53).
      if (targets.length && s.executed && (s.executed.count === 0 || targets.some((t) => !s.executed.targets.includes(t)))) { s.outcome = "failed"; s.text += `\nexecuted ${s.executed.count} of named targets ${targets.join(", ")}`; }
      steps.push(s);
    }
  });
  const inputs = inputsOf(root, cfg, input.plans ?? [], prefixes);
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

// ADPT-17 readback: certifies green only when complete, all passed, targets executed and inputs current.
export function evidenceCheck(root, rel, plans = []) {
  const abs = resolveInside(root, rel);
  const ev = readJsonIf(abs, null);
  if (!ev || ev.v !== 1 || !Array.isArray(ev.steps)) return { valid: false, status: "invalid", reason: "unparsable or not v 1", code: 1 };
  for (const s of ev.steps) {
    if (s.log && !fs.existsSync(path.join(root, s.log))) return { valid: false, status: "invalid", reason: `log ${s.log} missing`, code: 1 };
    if (s.outcome !== "passed") return { valid: false, status: "incomplete", reason: `step ${s.name} ${s.outcome}`, code: 1 };
  }
  const cfg = loadConfig(root);
  const now = inputsOf(root, cfg, plans.length ? plans : [{ owns: Object.keys(ev.inputs?.files ?? {}) }], ownsPrefixes(root));
  const changed = Object.keys({ ...now.files, ...ev.inputs.files }).filter((f) => now.files[f] !== ev.inputs.files[f]);
  if (changed.length) return { valid: false, status: "stale", reason: `inputs changed: ${changed.slice(0, 5).join(", ")}`, code: 1 };
  return { valid: true, status: "current", code: 0 };
}

