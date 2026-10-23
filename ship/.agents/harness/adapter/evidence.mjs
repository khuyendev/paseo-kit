// ADPT-17: the gate-evidence contract. Evidence certifies green only when it parses, every requested step is
// present, every step passed with exit 0 and a log, every obligation that names targets really executed them,
// and its inputs (HEAD and file hashes) equal the current code. The requested steps come from the current
// plans and config (requiredSteps), never from the evidence being checked (CR-HAR-03).
import fs from "node:fs";
import path from "node:path";
import { readJson } from "../lib/io.mjs";
import { sha256 } from "../lib/hash.mjs";
import { errText } from "../lib/cli.mjs";
import { runArgv } from "../lib/proc.mjs";
import { gateObligation } from "./contract.mjs";

export const STEP_OUTCOMES = Object.freeze(["passed", "failed", "timeout", "unavailable", "not_configured"]);

// Step names shared by the gate writer and every reader.
export const gateStepName = (name) => `gate-${name}`;
export const obligationStepName = (planId, task, kind) => `${planId}-${task ?? "task"}-${kind}`;
// Kit feedback 97: the step name of each obligation of a plan, in order. The first of a task and kind keeps the plain name
// (evidence of a one-command task stays valid); the n-th is `<plan>-<task>-<kind>-<n>`.
export function obligationStepNames(planId, verify = []) {
  const seen = new Map();
  return verify.map((ob) => {
    const name = obligationStepName(planId, ob.task, ob.kind);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}-${n}`;
  });
}

// `{head, files: {<rel>: sha256 of the bytes | null when missing}}` of the code root now.
export async function currentInputs(codeRoot, relFiles) {
  const git = await runArgv(["git", "rev-parse", "HEAD"], { cwd: codeRoot, timeoutMs: 30000 });
  const files = {};
  for (const rel of [...relFiles].sort()) {
    const abs = path.resolve(codeRoot, rel);
    files[rel] = fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : null;
  }
  return { head: git.code === 0 ? git.stdout.trim() : null, files };
}

// INV-53: why a passed run is no proof for its named targets, or null. `executed` = {count|null, targets};
// count null (no evidence parser) is accepted only for an exit-code-sufficient kind. G094: no named targets is
// no proof either, unless the exit code is (a count with no named target is not a selection that ran).
export function executionProblem({ targets = [], executed, exitCodeSufficient = false }) {
  if (!targets.length) return exitCodeSufficient ? null : "no concrete targets selected";
  if (executed.count === null) return exitCodeSufficient ? null : `no executed list for ${targets.length} named target(s)`;
  if (!executed.count) return `executed 0 of ${targets.length} target(s)`;
  const missing = targets.filter((t) => !executed.targets.includes(t));
  return missing.length ? `target(s) ${missing.join(", ")} not executed` : null;
}

function stepProblem(s, i) {
  if (!s || typeof s !== "object" || typeof s.name !== "string" || !Array.isArray(s.argv)) return `steps[${i}] needs name and argv`;
  if (!STEP_OUTCOMES.includes(s.outcome)) return `steps[${i}].outcome must be one of ${STEP_OUTCOMES.join("|")}`;
  if (!(s.exitCode === null || Number.isInteger(s.exitCode))) return `steps[${i}].exitCode must be an integer or null`;
  const ex = s.executed;
  if (!ex || !(ex.count === null || (Number.isInteger(ex.count) && ex.count >= 0)) || !Array.isArray(ex.targets)) return `steps[${i}].executed must be {count, targets}`;
  // A step that never ran has no log; a passed one always has.
  if (!(typeof s.log === "string" || (s.log === null && s.outcome !== "passed"))) return `steps[${i}].log must be a path`;
  if (s.outcome === "passed" && s.exitCode !== 0) return `steps[${i}] is passed with exit code ${s.exitCode}`;
  return null;
}

function shapeProblem(ev) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) return "not an object";
  if (ev.v !== 1) return `v ${JSON.stringify(ev.v)} is not 1`;
  if (typeof ev.waveId !== "string" || typeof ev.at !== "string") return "waveId and at must be strings";
  const inputs = ev.inputs;
  if (!inputs || typeof inputs !== "object" || !("head" in inputs) || !inputs.files || typeof inputs.files !== "object") return "inputs must be {head, files}";
  if (!Array.isArray(ev.steps)) return "steps must be an array";
  for (const [i, s] of ev.steps.entries()) {
    const p = stepProblem(s, i);
    if (p) return p;
  }
  return null;
}

const sameInputs = (a, b) => (a.head ?? null) === (b.head ?? null) && JSON.stringify(sortKeys(a.files)) === JSON.stringify(sortKeys(b.files));
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

// The steps a gate run of `plans` ([{id, verify: [{task, kind, command, target?}]}]) must prove under the current
// config: adapter gates, build, test and every obligation with its targets. An obligation that cannot be
// prepared (unknown kind, parser fault) carries `unresolvable` and makes any evidence invalid.
export async function requiredSteps(cfg, { codeRoot, phaseDir, plans = [] }) {
  const steps = [...(cfg.adapter.commands.gates ?? []).map((g) => ({ name: gateStepName(g.name) })), { name: "build" }, { name: "test" }];
  for (const p of plans) for (const [i, name] of obligationStepNames(p.id, p.verify).entries()) {
    const ob = p.verify[i];
    const o = await gateObligation(cfg, { codeRoot, phaseDir, kind: ob.kind, command: ob.command, target: ob.target });
    const legacy = obligationStepName(p.id, ob.task, ob.kind);
    steps.push({ name, ...(legacy !== name ? { legacy } : {}), targets: o.targets, exitCodeSufficient: o.exitCodeSufficient, ...(Array.isArray(o.argv) ? { argv: o.argv } : {}), ...(o.outcome === "unavailable" ? { unresolvable: o.reason } : {}) });
  }
  return steps;
}

// The evidence step that answers a requested one: its own name, or for evidence written before kit feedback 97 (every
// obligation of a task and kind under one name) the step of the legacy name that ran the requested command.
function stepFor(byName, r) {
  const own = byName.get(r.name) ?? [];
  const list = own.length || !r.legacy ? own : byName.get(r.legacy) ?? [];
  const same = (s) => Array.isArray(r.argv) && JSON.stringify(s.argv) === JSON.stringify(r.argv);
  // A command found nowhere is the last step of the name: a passed one is then stale (G063), not missing.
  return list.length === 1 ? list[0] : list.find(same) ?? list.at(-1) ?? null;
}

// `requested`: [{name, legacy?, targets?, exitCodeSufficient?, unresolvable?}] (a plain string = a step without targets),
// normally from requiredSteps. `inputs`: the current {head, files} over the same scope as the writer's.
// Returns {verdict: green|partial|failed|invalid|incomplete|stale, reasons: [string], staleSteps?: [{name, reason}]}:
// partial = every other step proves its obligation, the staleSteps do not (kit feedback 97).
export function evidenceVerdict(evidenceFile, { codeRoot, requested, inputs }) {
  let ev;
  try {
    ev = readJson(evidenceFile);
  } catch (e) {
    return { verdict: "invalid", reasons: [errText(e)] };
  }
  const shape = shapeProblem(ev);
  if (shape) return { verdict: "invalid", reasons: [shape] };
  const wanted = requested.map((r) => (typeof r === "string" ? { name: r } : r));
  const unresolvable = wanted.filter((r) => r.unresolvable).map((r) => `${r.name}: ${r.unresolvable}`);
  if (unresolvable.length) return { verdict: "invalid", reasons: unresolvable };
  const missingLogs = ev.steps.filter((s) => s.log !== null && !fs.existsSync(path.resolve(codeRoot, s.log))).map((s) => `${s.name}: log ${s.log} does not exist`);
  if (missingLogs.length) return { verdict: "invalid", reasons: missingLogs };
  const byName = new Map();
  for (const s of ev.steps) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  const steps = new Map(wanted.map((r) => [r.name, stepFor(byName, r)]));
  const absent = wanted.filter((r) => !steps.get(r.name)).map((r) => `step ${r.name} missing`);
  if (absent.length) return { verdict: "incomplete", reasons: absent };
  if (!sameInputs(ev.inputs, inputs)) return { verdict: "stale", reasons: ["inputs differ from the current code"] };
  // G063: an obligation whose command changed after its gate is not proven by the old run; kit feedback 97: only that
  // obligation is stale, the other steps of the file still prove theirs.
  const staleSteps = wanted.filter((r) => Array.isArray(r.argv) && steps.get(r.name).outcome === "passed" && JSON.stringify(steps.get(r.name).argv) !== JSON.stringify(r.argv)).map((r) => ({ name: r.name, reason: "command changed since the gate ran" }));
  const staleNames = new Set(staleSteps.map((s) => s.name));
  const reasons = ev.steps.filter((s) => s.outcome !== "passed").map((s) => `${s.name}: ${s.outcome}`);
  for (const r of wanted) {
    const s = steps.get(r.name);
    // Build, test and gate steps name no targets; only obligations (which carry targets) are checked for coverage.
    if (s.outcome !== "passed" || !Array.isArray(r.targets) || staleNames.has(r.name)) continue;
    const problem = executionProblem({ targets: r.targets, executed: s.executed, exitCodeSufficient: r.exitCodeSufficient });
    if (problem) reasons.push(`${r.name}: ${problem}`);
  }
  const staleText = staleSteps.map((s) => `${s.name}: ${s.reason}`);
  if (reasons.length) return { verdict: "failed", reasons: [...reasons, ...staleText], ...(staleSteps.length ? { staleSteps } : {}) };
  return staleSteps.length ? { verdict: "partial", reasons: staleText, staleSteps } : { verdict: "green", reasons };
}
