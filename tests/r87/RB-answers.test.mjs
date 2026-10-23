// Kit feedback #83 F3, #87 part B3 (RB): every needs-owner stop of gsd-execute names what answers it, `answer: {verb, command}`:
// halt.clear, shared.clear, request.clear, grant, allow, fix-and-rerun (the rerun decides again from the tree), rerun (a call
// that could not run) or workflow. The test enumerates every stop of the script; one without an answer path fails it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const SCRIPT = fs.readFileSync(path.join(SHIP_DIR, ".agents/workflows/gsd-execute.js"), "utf8");
const VERBS = ["halt.clear", "shared.clear", "request.clear", "grant", "allow", "fix-and-rerun", "rerun", "workflow"];

// The top-level arguments of the call whose "(" is at `open` (strings, template literals and nesting skipped).
function callArgs(text, open) {
  const args = [];
  const stack = [];
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    const top = stack.at(-1);
    if (top === "'" || top === '"') {
      if (c === "\\") i++;
      else if (c === top) stack.pop();
      continue;
    }
    if (top === "`") {
      if (c === "\\") i++;
      else if (c === "`") stack.pop();
      else if (c === "$" && text[i + 1] === "{") { stack.push("${"); i++; }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); continue; }
    if (c === "'" || c === '"' || c === "`") stack.push(c);
    else if ("([{".includes(c)) stack.push(c);
    else if (")]}".includes(c)) {
      stack.pop();
      if (!stack.length) { args.push(text.slice(start, i).trim()); return args; }
    } else if (c === "," && stack.length === 1) { args.push(text.slice(start, i).trim()); start = i + 1; }
  }
  throw new Error(`unbalanced call at ${open}`);
}
const stops = [...SCRIPT.matchAll(/(?<![\w.])owner\(/g)].map((m) => {
  const args = callArgs(SCRIPT, m.index + m[0].length - 1);
  return { line: SCRIPT.slice(0, m.index).split("\n").length, stage: args[0], extra: args[2] ?? "" };
});

test("RB B3 every needs-owner stop of gsd-execute names its answer verb", () => {
  assert.ok(stops.length >= 40, `found ${stops.length} stops`);
  const without = stops.filter((s) => !/^\{(.*[,{])?\s*answer:\s*(ANSWER\.\w+\(|GATE_RED\b|grantRequests\.length \? ANSWER|fatal\(r\.reason\) \? ANSWER)/s.test(s.extra));
  assert.deepEqual(without.map((s) => `line ${s.line} (${s.stage})`), [], "stops without an answer path");
  // The answer table: one entry per verb, nothing outside the list.
  const table = /const ANSWER = \{([\s\S]*?)\n\};/.exec(SCRIPT)?.[1] ?? "";
  const verbs = [...table.matchAll(/verb: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(verbs.length >= 6);
  for (const v of verbs) assert.ok(VERBS.includes(v), v);
  // Every needs-owner result is made by owner(): no other construction of the status.
  assert.deepEqual([...SCRIPT.matchAll(/"needs-owner"/g)].length, 3, "owner(), the shared needsOwner helper and the graph drain check");
});

const exec = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });

test("RB B3 the stops carry their answer in the result: halt, request, red gate", async () => {
  const halted = makeExecWorld({ waves: [[task("01-01")]] });
  const h = await exec(halted, { "exec-01-01": () => ({ taskResults: [{ task: "1", status: "partial", evidence: "which store?" }], deviations: [], requests: [] }) });
  assert.deepEqual([h.result.stage, h.result.answer], ["Execute", { verb: "halt.clear", command: "ph gsd halt clear 01 --plan <id> --reason <answer>" }]);

  const req = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { request_check: "tree", parallelization: { enabled: false, max_concurrent: null } } } });
  const run = executor(req);
  const r = await exec(req, { "exec-01-01": async (...a) => ({ ...(await run(...a)), requests: [{ path: "src/01-02/api.js", change: "export x", reason: "r" }] }) });
  assert.deepEqual([r.result.stage, r.result.answer], ["Commit", { verb: "request.clear", command: "ph gsd request clear 01 --plan 01-02 --path src/01-02/api.js --reason <why it is satisfied>" }]);

  const red = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { max_verify_rounds: 1 } } });
  red.write("fail.flag", "x");
  const g = await exec(red, { "fix-": () => ({ taskResults: [{ task: "1", status: "implemented", evidence: "tried" }], deviations: [], requests: [] }) });
  assert.equal(g.result.stage, "Gate");
  assert.equal(g.result.answer.verb, "fix-and-rerun");
});
