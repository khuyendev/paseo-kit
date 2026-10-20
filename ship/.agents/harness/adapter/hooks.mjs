// ADPT-15: invoking adapter scripts. One JSON request on stdin, one JSON line on stdout, no shell; anything
// but a well-formed `v: 1` response is `unresolvable`, never a pass (INV-36).
import path from "node:path";
import { errText } from "../lib/cli.mjs";
import { runArgv } from "../lib/proc.mjs";

const STATUSES = new Set(["ok", "pending_creation", "missing", "unresolvable"]);
const OUTCOMES = new Set(["passed", "failed", "unavailable"]);

const isStr = (v) => typeof v === "string";
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);

// Response checks per op; each returns null when the response is well-formed, else the problem.
const RESPONSES = {
  parse: (r) => (isStrArr(r.targets) ? null : "targets must be an array of strings"),
  resolve: (r) => {
    if (!Array.isArray(r.results)) return "results must be an array";
    const bad = r.results.find((x) => !x || !isStr(x.target) || !STATUSES.has(x.status) || (x.detail !== undefined && !isStr(x.detail)));
    return bad ? "each result needs target and status ok|pending_creation|missing|unresolvable" : null;
  },
  shared: (r) => (isStrArr(r.shared) ? null : "shared must be an array of paths"),
  evidence: (r) => {
    const ex = r.executed;
    if (!ex || !Number.isInteger(ex.count) || ex.count < 0 || !isStrArr(ex.targets)) return "executed must be {count, targets}";
    if (!isStrArr(r.failed)) return "failed must be an array of strings";
    return OUTCOMES.has(r.outcome) ? null : "outcome must be passed|failed|unavailable";
  },
  attribute: (r) => {
    if (!Array.isArray(r.assignments)) return "assignments must be an array";
    const bad = r.assignments.find((a) => !a || !("failure" in a) || !(a.plan === null || isStr(a.plan)));
    return bad ? "each assignment needs failure and plan (string or null)" : null;
  },
};

const REQUESTS = {
  parse: ["kind", "argument"],
  resolve: ["kind", "targets", "plan", "filesModified"],
  shared: ["paths"],
  evidence: ["kind", "argument", "targets", "exitCode", "stdoutPath", "stderrPath"],
  attribute: ["failures", "plans"],
};

export const HOOK_OPS = Object.freeze(Object.keys(REQUESTS));

// `.mjs`/`.js` run with the current node; any other script runs directly.
export function hookArgv(codeRoot, scriptRel) {
  const abs = path.resolve(codeRoot, scriptRel);
  return /\.(mjs|js)$/i.test(abs) ? [process.execPath, abs] : [abs];
}

// Resolves `{ok: true, response}` or `{ok: false, status: "unresolvable", reason}`; never throws for script faults.
export async function invokeHook(cfg, { codeRoot, script, op, phaseDir, ...fields }) {
  if (!REQUESTS[op]) throw new Error(`unknown adapter hook op ${op}`);
  const missing = REQUESTS[op].filter((k) => !(k in fields));
  if (missing.length) throw new Error(`adapter hook ${op} request misses ${missing.join(", ")}`);
  const request = { v: 1, op, codeRoot, ...(phaseDir ? { phaseDir } : {}), ...fields };
  const timeoutS = cfg.adapter.hook_timeout_s;
  const fail = (reason) => ({ ok: false, status: "unresolvable", reason: `adapter ${op} ${script}: ${reason}` });
  const res = await runArgv(hookArgv(codeRoot, script), { cwd: codeRoot, input: JSON.stringify(request) + "\n", timeoutMs: timeoutS * 1000 });
  if (res.timedOut) return fail(`no response within ${timeoutS} s`);
  if (res.error) return fail(`could not start: ${errText(res.error)}`);
  if (res.code !== 0) return fail(`exit ${res.code}${res.stderr.trim() ? `: ${errText(res.stderr.trim())}` : ""}`);
  const line = res.stdout.split(/\r?\n/).find((l) => l.trim());
  let response;
  try {
    response = JSON.parse(line ?? "");
  } catch {
    return fail("unparsable response");
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) return fail("response is not an object");
  if (response.v !== 1) return fail(`response version ${JSON.stringify(response.v)} is not 1`);
  const problem = RESPONSES[op](response);
  return problem ? fail(problem) : { ok: true, response };
}
