// ADPT-15: invoking adapter scripts. One JSON request on stdin, one JSON line on stdout, no shell; anything
// but a well-formed `v: 1` response is `unresolvable`, never a pass (INV-36).
import path from "node:path";
import { errText } from "../lib/cli.mjs";
import { runArgv } from "../lib/proc.mjs";

const STATUSES = new Set(["ok", "pending_creation", "missing", "unresolvable"]);
const OUTCOMES = new Set(["passed", "failed", "unavailable"]);

const isStr = (v) => typeof v === "string";
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
// Closed shapes: a key outside `allowed` (or a missing required key) is a malformed response.
const extraKey = (obj, allowed) => Object.keys(obj).find((k) => !allowed.includes(k));

// Response checks per op against its request; each returns null when well-formed, else the problem.
const RESPONSES = {
  parse: (r) => (isStrArr(r.targets) ? null : "targets must be an array of strings"),
  resolve: (r, req) => {
    if (!Array.isArray(r.results)) return "results must be an array";
    const badAt = r.results.findIndex((x) => !isObj(x) || extraKey(x, ["target", "status", "detail"]) || !isStr(x.target) || !STATUSES.has(x.status) || (x.detail !== undefined && !isStr(x.detail)));
    if (badAt >= 0) return `results[${badAt}] needs exactly target, status ok|pending_creation|missing|unresolvable and an optional string detail`;
    // CR-HAR-05: one result per requested target; an omitted target must not let the check pass.
    const got = r.results.map((x) => x.target);
    const dup = got.find((t, i) => got.indexOf(t) !== i);
    if (dup !== undefined) return `target ${dup} answered twice`;
    const extra = got.find((t) => !req.targets.includes(t));
    if (extra !== undefined) return `target ${extra} was not requested`;
    const omitted = req.targets.find((t) => !got.includes(t));
    return omitted !== undefined ? `no result for target ${omitted}` : null;
  },
  shared: (r, req) => {
    if (!isStrArr(r.shared)) return "shared must be an array of paths";
    const extra = r.shared.find((p) => !req.paths.includes(p));
    return extra !== undefined ? `shared path ${extra} was not requested` : null;
  },
  evidence: (r) => {
    const ex = r.executed;
    if (!isObj(ex) || extraKey(ex, ["count", "targets"]) || !Number.isInteger(ex.count) || ex.count < 0 || !isStrArr(ex.targets)) return "executed must be {count, targets}";
    if (!isStrArr(r.failed)) return "failed must be an array of strings";
    return OUTCOMES.has(r.outcome) ? null : "outcome must be passed|failed|unavailable";
  },
  attribute: (r, req) => {
    if (!Array.isArray(r.assignments)) return "assignments must be an array";
    if (r.assignments.length !== req.failures.length) return `${r.assignments.length} assignment(s) for ${req.failures.length} failure(s)`;
    const ids = req.plans.map((p) => p?.id);
    const badAt = r.assignments.findIndex((a) => !isObj(a) || extraKey(a, ["failure", "plan"]) || !("failure" in a) || !(a.plan === null || (isStr(a.plan) && ids.includes(a.plan))));
    return badAt >= 0 ? `assignments[${badAt}] needs exactly failure and plan (a requested plan id or null)` : null;
  },
};

const REQUESTS = {
  parse: ["kind", "argument"],
  resolve: ["kind", "targets", "plan", "filesModified"],
  shared: ["paths"],
  evidence: ["kind", "argument", "targets", "exitCode", "stdoutPath", "stderrPath"],
  attribute: ["failures", "plans"],
};
const RESPONSE_KEYS = { parse: ["targets"], resolve: ["results"], shared: ["shared"], evidence: ["executed", "failed", "outcome"], attribute: ["assignments"] };
// Request fields that must be arrays (the response checks compare against them).
const REQUEST_ARRAYS = { resolve: ["targets", "filesModified"], shared: ["paths"], evidence: ["targets"], attribute: ["failures", "plans"] };

export const HOOK_OPS = Object.freeze(Object.keys(REQUESTS));

// `.mjs`/`.js` run with the current node; any other script runs directly.
export function hookArgv(codeRoot, scriptRel) {
  const abs = path.resolve(codeRoot, scriptRel);
  return /\.(mjs|js)$/i.test(abs) ? [process.execPath, abs] : [abs];
}

function requestProblem(op, fields) {
  const missing = REQUESTS[op].filter((k) => !(k in fields));
  if (missing.length) return `misses ${missing.join(", ")}`;
  const extra = extraKey(fields, REQUESTS[op]);
  if (extra) return `has the unknown field ${extra}`;
  const notArray = (REQUEST_ARRAYS[op] ?? []).find((k) => !Array.isArray(fields[k]));
  return notArray ? `field ${notArray} must be an array` : null;
}

// Resolves `{ok: true, response}` or `{ok: false, status: "unresolvable", reason}`; never throws for script faults.
export async function invokeHook(cfg, { codeRoot, script, op, phaseDir, ...fields }) {
  if (!REQUESTS[op]) throw new Error(`unknown adapter hook op ${op}`);
  const bad = requestProblem(op, fields);
  if (bad) throw new Error(`adapter hook ${op} request ${bad}`);
  const request = { v: 1, op, codeRoot, ...(phaseDir ? { phaseDir } : {}), ...fields };
  const timeoutS = cfg.adapter.hook_timeout_s;
  const fail = (reason) => ({ ok: false, status: "unresolvable", reason: `adapter ${op} ${script}: ${reason}` });
  const res = await runArgv(hookArgv(codeRoot, script), { cwd: codeRoot, input: JSON.stringify(request) + "\n", timeoutMs: timeoutS * 1000 });
  if (res.timedOut) return fail(`no response within ${timeoutS} s`);
  if (res.error) return fail(`could not start: ${errText(res.error)}`);
  if (res.code !== 0) return fail(`exit ${res.code}${res.stderr.trim() ? `: ${errText(res.stderr.trim())}` : ""}`);
  const lines = res.stdout.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length !== 1) return fail(lines.length ? `${lines.length} output lines (one JSON line expected)` : "no response");
  let response;
  try {
    response = JSON.parse(lines[0]);
  } catch {
    return fail("unparsable response");
  }
  if (!isObj(response)) return fail("response is not an object");
  if (response.v !== 1) return fail(`response version ${JSON.stringify(response.v)} is not 1`);
  const extra = extraKey(response, ["v", ...RESPONSE_KEYS[op]]);
  if (extra) return fail(`response has the unknown field ${extra}`);
  const problem = RESPONSES[op](response, fields);
  return problem ? fail(problem) : { ok: true, response };
}
