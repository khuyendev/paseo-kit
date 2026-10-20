// ADPT-17: the gate-evidence contract. Evidence certifies green only when it parses, is complete, every step
// passed, every obligation that names targets really executed them, and its inputs equal the current code.
import fs from "node:fs";
import path from "node:path";
import { readJson } from "../lib/io.mjs";
import { sha256 } from "../lib/hash.mjs";
import { errText } from "../lib/cli.mjs";
import { runArgv } from "../lib/proc.mjs";

export const STEP_OUTCOMES = Object.freeze(["passed", "failed", "timeout", "unavailable", "not_configured"]);

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

function shapeProblem(ev) {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) return "not an object";
  if (ev.v !== 1) return `v ${JSON.stringify(ev.v)} is not 1`;
  if (typeof ev.waveId !== "string" || typeof ev.at !== "string") return "waveId and at must be strings";
  const inputs = ev.inputs;
  if (!inputs || typeof inputs !== "object" || !("head" in inputs) || !inputs.files || typeof inputs.files !== "object") return "inputs must be {head, files}";
  if (!Array.isArray(ev.steps)) return "steps must be an array";
  for (const [i, s] of ev.steps.entries()) {
    if (!s || typeof s.name !== "string" || !Array.isArray(s.argv)) return `steps[${i}] needs name and argv`;
    if (!STEP_OUTCOMES.includes(s.outcome)) return `steps[${i}].outcome must be one of ${STEP_OUTCOMES.join("|")}`;
    const ex = s.executed;
    if (!ex || !(ex.count === null || (Number.isInteger(ex.count) && ex.count >= 0)) || !Array.isArray(ex.targets)) return `steps[${i}].executed must be {count, targets}`;
    if (typeof s.log !== "string") return `steps[${i}].log must be a path`;
  }
  return null;
}

const sameInputs = (a, b) => (a.head ?? null) === (b.head ?? null) && JSON.stringify(sortKeys(a.files)) === JSON.stringify(sortKeys(b.files));
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

// `requested`: [{name, targets?: [string], exitCodeSufficient?: bool}] (a plain string = a step without targets).
// Returns {verdict: green|failed|invalid|incomplete|stale, reasons: [string]}.
export function evidenceVerdict(evidenceFile, { codeRoot, requested, inputs }) {
  let ev;
  try {
    ev = readJson(evidenceFile);
  } catch (e) {
    return { verdict: "invalid", reasons: [errText(e)] };
  }
  const shape = shapeProblem(ev);
  if (shape) return { verdict: "invalid", reasons: [shape] };
  const missingLogs = ev.steps.filter((s) => !fs.existsSync(path.resolve(codeRoot, s.log))).map((s) => `${s.name}: log ${s.log} does not exist`);
  if (missingLogs.length) return { verdict: "invalid", reasons: missingLogs };
  const steps = new Map(ev.steps.map((s) => [s.name, s]));
  const wanted = requested.map((r) => (typeof r === "string" ? { name: r } : r));
  const absent = wanted.filter((r) => !steps.has(r.name)).map((r) => `step ${r.name} missing`);
  if (absent.length) return { verdict: "incomplete", reasons: absent };
  if (!sameInputs(ev.inputs, inputs)) return { verdict: "stale", reasons: ["inputs differ from the current code"] };
  const reasons = [];
  for (const r of wanted) {
    const s = steps.get(r.name);
    if (s.outcome !== "passed") {
      reasons.push(`${r.name}: ${s.outcome}`);
      continue;
    }
    const targets = r.targets ?? [];
    if (!targets.length || (r.exitCodeSufficient && s.executed.count === null)) continue;
    if (!s.executed.count) reasons.push(`${r.name}: executed 0 of ${targets.length} target(s)`);
    else for (const t of targets.filter((t) => !s.executed.targets.includes(t))) reasons.push(`${r.name}: target ${t} not executed`);
  }
  return { verdict: reasons.length ? "failed" : "green", reasons };
}
