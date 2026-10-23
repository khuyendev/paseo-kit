// Kit feedback #89 (V1B): every checker issue a forceProceed override accepts becomes a record (accepted-issues.json, written by
// gsd-plan at the override); gsd-execute stops before the executors of the plans an open record affects (answer: resolve the
// contract and replan, or `ph gsd accepted confirm|resolve`), the executor of an affected plan gets a confirmed issue in its brief,
// and a forceProceed reason that promises a follow-up is refused (the records are the follow-up).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";
import { gsd as runGsdIn, workerEnv } from "../gsd-core/fixture.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { main as flowMain } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { planArgs } from "../../ship/.agents/workflows/lib/flow-plan.mjs";

const labels = (r) => r.calls.map((c) => c.opts.label);
const accepted = (w) => JSON.parse(fs.readFileSync(path.join(w.root, PHASE_DIR, "accepted-issues.json"), "utf8"));
async function verb(root, argv, input) {
  let line = "";
  const code = await flowMain(argv, { root, input: JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const record = (w, issues, reason = "the owner accepts it for this phase") => verb(w.root, ["accepted-record", PHASE_DIR], { run: "wf_plan", reason, issues });
const exec = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });
const twoWaves = () => makeExecWorld({ waves: [[task("01-01")], [task("01-02")]], meta: { "01-02": { depends: ["01-01"] } } });
const ISSUE = { plan: "01-02", dimension: "contract", required_property: "addProbedConnection is cancellable", description: "the frozen contract says non-cancellable" };

test("V1B 89 F1 gsd-plan records each issue a forceProceed override accepts: plan, other plans, dimension, text, plan digests", async () => {
  const w = makeWorld();
  const stuck = () => ({ issues: [{ plan: "01-01", severity: "blocker", dimension: "Contract", required_property: "back is allowed", description: "01-01 always vetoes back while 01-02 makes the veto" }] });
  const plan = () => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, maxCheckIterations: 1, forceProceed: { reason: "the owner accepts the veto for this phase" } }, gsd: w.gsd, agent: plannerResponder(w, { overrides: { "checker-": stuck } }) });
  await plan();
  const r = await plan();
  assert.equal(r.result.status, "planned", JSON.stringify(r.result.reason));
  const recs = accepted(w);
  assert.equal(recs.length, 1);
  assert.deepEqual([recs[0].id, recs[0].plan, recs[0].plans, recs[0].dimension, recs[0].required_property, recs[0].text, recs[0].reason], ["AI-1", "01-01", ["01-02"], "contract", "", "01-01 always vetoes back while 01-02 makes the veto", "the owner accepts the veto for this phase"]);
  assert.deepEqual(Object.keys(recs[0].digests), ["01-01", "01-02"]);
  assert.ok(w.events.some((e) => e.startsWith("state override")), "the STATE text is still written");
  // The same issue on the same plan text is recorded once (a resumed or repeated override writes nothing twice).
  const again = await verb(w.root, ["accepted-record", PHASE_DIR], { run: "wf_x", reason: "again", issues: [{ plan: "01-01", dimension: "Contract", description: "01-01 always vetoes back while 01-02 makes the veto" }] });
  assert.deepEqual([again.json.added, again.json.total], [[], 1]);
});

test("V1B 89 F3 a forceProceed reason that promises a follow-up is refused; a plain reason is not", () => {
  const policy = { mode: "plan", tracer: true, reversibilityGates: true, wiring: "auto", granularity: "standard", maxSkeletonPasses: 2, maxCheckIterations: 3, skeletonLanes: [{ lens: "fidelity" }], planReview: false, planFlow: "staged", checkerReallocate: 0, checkerRecheck: "full" };
  const g = { plan_limits: { tasks_per_plan: 3, plans_per_phase: 8, waves_per_phase: 4 }, roles: {} };
  const args = (reason) => planArgs(makeTempDir(), { args: { phaseDir: PHASE_DIR, forceProceed: { reason } }, policy, gsd: g, adapter: {}, kitLenses: ["fidelity"] });
  for (const reason of ["the orchestrator will read the checker issues before execute", "fix it later", "follow-up in phase 4", "TODO check the toast host", "accepted; go through them before execution"]) {
    const r = args(reason);
    assert.equal(r.status, "failed", reason);
    assert.match(r.reason, /^forceProceed reason promises a follow-up .*ph gsd accepted list/, reason);
  }
  assert.equal(args("the owner accepts the contract as frozen").status, "ok");
});

test("V1B 89 F1 an open accepted issue stops execute before its plan: earlier waves commit, the stop names accepted.confirm", async () => {
  const w = twoWaves();
  await record(w, [ISSUE]);
  const r = await exec(w);
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Execute"]);
  assert.deepEqual(r.result.waves.map((x) => x.plans), [["01-01"]], "wave 1 ran and committed");
  assert.equal(labels(r).includes("exec-01-02"), false);
  assert.match(r.result.reason, /^checker issues accepted by forceProceed at planning wait for the owner before 01-02 run: AI-1 01-02 \[contract\]: the frozen contract says non-cancellable/);
  assert.equal(r.result.answer.verb, "accepted.confirm");
  assert.match(r.result.answer.command, /^ph gsd accepted confirm 0?1 --id AI-1 --reason <why the plan may run with it>$/);
  assert.deepEqual(r.result.accepted.map((x) => [x.id, x.affects]), [["AI-1", ["01-02"]]]);
  assert.equal(r.result.options.length, 3);
  assert.match(r.result.options[0], /^resolve the contract and replan with gsd-plan 0?1/);
  // The owner confirms: the rerun dispatches 01-02 and its executor gets the issue in its brief.
  assert.equal((await runGsdIn(w, ["accepted", "confirm", "1", "--id", "AI-1"])).code, 1, "a reason is required");
  assert.equal((await runGsdIn(w, ["accepted", "confirm", "1", "--id", "AI-9", "--reason", "x"])).code, 66);
  assert.equal((await runGsdIn(w, ["accepted", "confirm", "1", "--id", "AI-1", "--reason", "x"], { env: workerEnv() })).code, 1, "a worker never answers");
  const ok = await runGsdIn(w, ["accepted", "confirm", "1", "--id", "AI-1", "--reason", "the probe stays non-cancellable in this phase"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  const answers = JSON.parse(w.read(`${PHASE_DIR}/owner-answers.json`));
  assert.deepEqual(answers.map((x) => [x.kind, x.issue, x.decision]), [["accepted", "AI-1", "confirm"]]);
  const next = await exec(w);
  assert.equal(next.result.status, "executed", JSON.stringify(next.result.reason));
  assert.equal(labels(next).includes("exec-01-01"), false);
  const prompt = next.calls.find((c) => c.opts.label === "exec-01-02").prompt;
  assert.match(prompt, /Checker issues of this plan that the owner accepted at planning \(forceProceed\) and confirmed for execution \(JSON\): \[\{"id":"AI-1","plan":"01-02"/);
  assert.match(prompt, /"owner":"the probe stays non-cancellable in this phase"/);
  const list = await runGsdIn(w, ["accepted", "list", "1"]);
  assert.deepEqual(list.json.issues.map((x) => [x.id, x.status]), [["AI-1", "confirmed"]]);
  assert.deepEqual(list.json.open, []);
});

test("V1B 89 the plans an issue names are affected too, a phase-level issue that names none affects every plan", async () => {
  const named = twoWaves();
  await record(named, [{ ...ISSUE, description: "01-01's committed tests contradict this contract" }]);
  const r = await exec(named);
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Execute"]);
  assert.equal(labels(r).some((l) => l.startsWith("exec-")), false, "01-01 is named by the issue: nothing runs");
  assert.deepEqual(r.result.accepted[0].affects, ["01-02", "01-01"]);
  const phase = twoWaves();
  await record(phase, [{ plan: null, dimension: "scope", description: "the phase splits a requirement" }]);
  const p = await exec(phase);
  assert.match(p.result.reason, /before 01-01 run: AI-1 phase \[scope\]/);
});

test("V1B 89 resolve answers it without a brief; a plan replanned since the accept no longer stops", async () => {
  const w = twoWaves();
  await record(w, [ISSUE]);
  assert.equal((await runGsdIn(w, ["accepted", "resolve", "1", "--id", "AI-1", "--reason", "03-01's tests were changed to the frozen contract"])).code, 0);
  const r = await exec(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.doesNotMatch(r.calls.find((c) => c.opts.label === "exec-01-02").prompt, /Checker issues of this plan/);
  const re = twoWaves();
  await record(re, [ISSUE]);
  re.write(`${PHASE_DIR}/01-02-PLAN.md`, `${re.read(`${PHASE_DIR}/01-02-PLAN.md`)}\n<!-- replanned: the contract is cancellable -->\n`);
  const list = await runGsdIn(re, ["accepted", "list", "1"]);
  assert.deepEqual(list.json.issues.map((x) => [x.id, x.status]), [["AI-1", "replanned"]]);
  // The handoff still names the old plan text, so execute refuses the stale handoff: the replan regenerates it. The accept stops nothing.
  const recs = (await verb(re.root, ["exec-records", PHASE_DIR], { runId: "wf_x", stopFor: ["01-02"] })).json;
  assert.equal(recs.acceptedStop, null);
});
