// THIN.md stage 3 S1 (TS1, kit feedback 87): the steps the execute schedules share are the kit's step library
// (harness/workflow/steps.mjs), an engine global `executeSteps(run)` bound to the run and to the kit's helpers; gsd-execute.js
// composes them. The agent calls keep their prompts and options, so a run the old script started resumes under the new one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EXECUTE_STEP_NAMES } from "../../ship/.agents/harness/workflow/steps.mjs";
import { KIT_STEP_NAMES } from "../../ship/.agents/harness/workflow/script.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { dieOnce, journal } from "../r87/RE-journal.mjs";
import { compositionBudget, WORKFLOWS_DIR } from "./budget.mjs";
import { newScript, runEngine, stubRoot } from "./engine.mjs";

// The size stage 3 S1 reached with the three schedules inside (1461 before; the ratchet of stage 2 was 1465).
const EXECUTE_RATCHET = 441;
const STEPS = fs.readFileSync(path.join(SHIP_DIR, ".agents/harness/workflow/steps.mjs"), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = fs.readFileSync(path.join(WORKFLOWS_DIR, "gsd-execute.js"), "utf8").replace(/\r\n/g, "\n");
// The composition as kit main 120d38f shipped it (before the step library): a project that kept its edited copy runs it.
const OLD = "../../../tests/thin/fixtures/gsd-execute-120d38f.js";

const BODY = `
call = async () => { throw new Error("the script's own call"); };
const R = executeSteps({ phaseDir: ".planning/phases/01-core", args: {}, cfg: { gsd: {}, adapter: { commands: {} } }, setup: { N: "01" }, policy: {} });
const judged = await R.call("judge this", { judges: { files: ["notes/a.md"] }, label: "judge" });
const stop = R.owner("Gate", "red", { answer: R.ANSWER.rerun() });
const first = { green: false, failureCount: 1, failures: [] };
const rounds = await R.fixRounds("w1", [], first, "wave 1", "", { rounds: 0 });
return { names: Object.keys(R), judged: judged.result, stop: { status: stop.status, stage: stop.stage, reason: stop.reason, answer: stop.answer, events: stop.events }, halt: R.ANSWER.halt("01-01"), rounds };
`;

test("TS1 the engine provides executeSteps: a run's steps are bound to the kit's helpers, not to a script's replacement, and take the policy as values", async () => {
  assert.deepEqual([...KIT_STEP_NAMES], ["executeSteps"]);
  const root = stubRoot({ "notes/a.md": "hello\n" });
  // The digest verb lists the judged files with git.
  spawnSync("git", ["init", "-q"], { cwd: root });
  const r = await runEngine(root, newScript(BODY));
  const v = r.result;
  assert.ok(v?.names, JSON.stringify(r.error ?? r.result));
  assert.deepEqual(v.names, [...EXECUTE_STEP_NAMES]);
  // The judged call of the steps: the research policy and the digest of the files it judges, on the kit's call (the script's throws).
  assert.match(v.judged, /^r:judge this\n\n<research_input_policy>\nApproved research: NONE\. Do not read or use any RESEARCH\.md on disk\.\n<\/research_input_policy>\n\nInput digest \(stage\): [0-9a-f]{64}$/);
  assert.deepEqual(v.stop, { status: "needs-owner", stage: "Gate", reason: "red", answer: { verb: "rerun", command: "rerun with the same args" }, events: [] });
  assert.deepEqual(v.halt, { verb: "halt.clear", command: "ph gsd halt clear 01 --plan 01-01 --reason <answer>" });
  // The round count is the composition's argument: no round, no call, the first gate is the answer.
  assert.deepEqual(v.rounds, { gate: { green: false, failureCount: 1, failures: [] } });
  assert.equal(r.host.calls.runner.length, 1);
});

test("TS1 gsd-execute.js composes the kit steps: within the size stage 3 reached, no engine helper or step defined, no step body copied", () => {
  const { lines, helperDefinitions } = compositionBudget("gsd-execute.js");
  assert.ok(lines <= EXECUTE_RATCHET, `gsd-execute.js has ${lines} lines; stage 3 S1 left it at ${EXECUTE_RATCHET}`);
  assert.deepEqual(helperDefinitions, []);
  const names = [...KIT_STEP_NAMES, ...EXECUTE_STEP_NAMES];
  const defined = [...SCRIPT.matchAll(/^(?:(?:const|let|var)\s+(\w+)\s*=|(?:async\s+)?function\s*\*?\s*(\w+)\s*\()/gm)].map((m) => m[1] ?? m[2]).filter((n) => names.includes(n));
  assert.deepEqual(defined, []);
  // The three schedules are still inside (S2 splits them); the agent prompts are rendered by the steps, but for the batch's integration fixer.
  for (const s of [/async function graphRun\(\)/, /if \(execMode === "per-wave"\)/, /---- batch mode/]) assert.match(SCRIPT, s);
  assert.deepEqual([...new Set([...SCRIPT.matchAll(/renderPrompt\("([a-z0-9-]+)"/g)].map((m) => m[1]))], ["integration-fix"]);
  assert.doesNotMatch(SCRIPT, /\bagent\(/, "the executors are dispatched by the step");
});

test("TS1 the step library follows the composition rules: no clock or randomness, roster agents only, no policy key, stops returned with answers", () => {
  assert.doesNotMatch(STEPS, /\bDate\b|Math\.random|setTimeout|\bsleep\(/);
  const ROSTER = ["gsd-executor", "gsd-code-fixer", "gsd-code-reviewer", "finding-verifier"];
  for (const m of STEPS.matchAll(/"(gsd-[a-z-]+|finding-verifier)"/g)) assert.ok(ROSTER.includes(m[1]) || m[1] === "gsd-execute", m[1]);
  // A step returns its stop: never `return` from the run (it cannot) and never a hidden needs-owner outside owner().
  assert.equal([...STEPS.matchAll(/"needs-owner"/g)].length, 2, "owner() only");
  // The policies are values the composition passes (policy.*, rounds, limit), never config reads.
  assert.doesNotMatch(STEPS.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"), /\bcfg\.gsd\.(request_check|batch_review|fixer_verifies_itself|max_verify_rounds|branching|protected_branches|fixer|parallelization|code_review|review_depth|pending_request_tasks|execute_schedule)\b|smoke_triggers/);
});

const finding = (id) => ({ id, severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 1, description: `finding ${id}` });
// The temp root and the content digest of the input snapshot differ between two worlds.
const norm = (w, x) => JSON.parse(JSON.stringify(x).split(w.root.replace(/\\/g, "\\\\")).join("<root>").split(w.root.replace(/\\/g, "/")).join("<root>").replace(/[0-9a-f]{64}/g, "<h64>"));

test("TS1 the old composition and the step library make the same agent calls (label, prompt, options) and reach the same result", async () => {
  for (const isolation of ["shared", "worktree"]) {
    const runs = [];
    for (const script of [OLD, "gsd-execute"]) {
      const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation, parallelization: { enabled: false, max_concurrent: null } } } });
      const r = await runScript(script, { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, { "review-01-01": () => ({ findings: [finding("F1")] }) }) });
      runs.push({ calls: norm(w, r.calls.map((c) => [c.opts.label, c.prompt, c.opts])), result: norm(w, r.result), logs: norm(w, r.logs) });
    }
    assert.equal(runs[1].result.status, "executed", JSON.stringify(runs[1].result.reason));
    assert.ok(runs[1].calls.some(([label]) => label === "resolve-01-01"), isolation);
    assert.deepEqual(runs[1].calls, runs[0].calls, isolation);
    assert.deepEqual(runs[1].result, runs[0].result, isolation);
    assert.deepEqual(runs[1].logs, runs[0].logs, isolation);
  }
});

test("TS1 a run the old composition started and that died in the review resumes under the step library: the finished calls replay from the journal", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const j = journal();
  const reply = { "review-": () => ({ findings: [finding("F1")] }) };
  const die = dieOnce("the finding verifier");
  const run = (script, overrides, replay) => {
    const { fn, calls } = j.wrap(executor(w, overrides), replay);
    return runScript(script, { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: fn }).then((r) => ({ r, calls }), (error) => ({ error, calls }));
  };
  const first = await run(OLD, { ...reply, "verify-findings": die }, false);
  assert.equal(first.error?.message, "killed at the finding verifier");
  assert.deepEqual(first.calls.map((c) => c.label), ["exec-01-01", "review-01-01", "verify-findings-01-01"]);
  const resumed = await run("gsd-execute", reply, true);
  assert.equal(resumed.r?.result.status, "executed", JSON.stringify(resumed.r?.result.reason ?? resumed.error?.message));
  // The executor finished (its SUMMARY is on disk): no new executor; the reviewer's call is the old run's, served from the journal.
  assert.deepEqual(resumed.calls.filter((c) => c.hit).map((c) => c.label), ["review-01-01"]);
  assert.equal(resumed.calls.some((c) => c.label.startsWith("exec-")), false);
  assert.deepEqual(resumed.calls.filter((c) => !c.hit).map((c) => c.label), ["verify-findings-01-01", "fix-review-w1", "resolve-01-01"]);
});
