// Kit feedback #88 (composition): gsd-execute honours a stop request (`ph workflow stop`, read with the flow verb
// stop-requested) and `stopAfterWave: N` at a wave boundary only: the running wave finishes and commits, the run ends paused
// with the wave reached and its answer (rerun), and a rerun goes on from the next wave. In the graph schedule no new plan
// starts and the started plans commit. No stop request changes nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const RUN = "wf_20261024-100000_r88a";
const run = (w, { args = {}, overrides = {}, runId = RUN } = {}) => runScript("gsd-execute", { root: w.root, runId, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
// What `ph workflow stop <runId>` writes into the run dir.
const requestStop = (w, runId = RUN) => w.write(`_workspace/_runs/${runId}/stop.json`, JSON.stringify({ at: "wave-boundary", requestedAt: "2026-10-24T10:00:00.000Z", reason: "kit update" }));
const execLabels = (r) => r.calls.filter((c) => c.opts.label.startsWith("exec-")).map((c) => c.opts.label.slice(5));
const commits = (w) => w.events.filter((e) => e.startsWith("commit "));
const stateWaves = (w) => w.events.filter((e) => e.startsWith("state wave "));
// Three waves: two plans in wave 1, one in each of waves 2 and 3.
// In the graph schedule 01-03 waits for 01-01 and 01-04 for 01-03, so a later plan starts only after a commit.
const DEPS = { "01-03": { depends: ["01-01"] }, "01-04": { depends: ["01-03"] } };
const world = (overlay = {}, meta = {}) => makeExecWorld({ waves: [[task("01-01"), task("01-02")], [task("01-03")], [task("01-04")]], overlay, meta });
const until = (cond, ms = 20000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (cond() ? resolve() : Date.now() - t0 > ms ? reject(new Error("condition not reached")) : setTimeout(tick, 20));
  tick();
});

test("R88 a stop request made during wave 1 is honoured at the next boundary: wave 1 finishes and commits, wave 2 never starts", async () => {
  const w = world();
  // The request arrives while 01-01 runs; 01-02 of the same wave still runs (never mid-wave).
  const r = await run(w, { overrides: { "exec-01-01": () => { requestStop(w); } } });
  assert.equal(r.result.status, "paused", JSON.stringify(r.result));
  assert.deepEqual(execLabels(r).sort(), ["01-01", "01-02"]);
  assert.deepEqual(stateWaves(w), ["state wave 1 green"]);
  assert.deepEqual(commits(w), ["commit feat(01-w1): phase 01 wave 1"], "wave 1 (both plans) is committed");
  assert.deepEqual(r.result.pausedAt, { by: "stop-request", afterWave: 1, nextWave: 2 });
  assert.equal(r.result.stage, "Wave");
  assert.match(r.result.reason, /^stop requested \(kit update\): paused after wave 1 \(committed\)$/);
  assert.equal(r.result.answer.verb, "rerun");
  assert.match(r.result.answer.command, new RegExp(`rerun with the same args \\(or ph workflow --resume ${RUN}\\).*wave 2`));
  assert.ok(r.result.events.includes("paused stop-request before wave 2"));
  const progress = JSON.parse(w.read(`${PHASE_DIR}/execute-progress.json`));
  assert.equal(progress.plans["01-01"].tracked, true);
  assert.equal(progress.plans["01-03"]?.tracked, undefined);

  // A rerun with the same args (a new run: its run dir holds no stop request) goes on from wave 2 and finishes.
  const again = await run(w, { runId: "wf_20261024-100500_r88b" });
  assert.equal(again.result.status, "executed", JSON.stringify(again.result));
  assert.deepEqual(execLabels(again), ["01-03", "01-04"]);
  assert.deepEqual(stateWaves(w), ["state wave 1 green", "state wave 2 green", "state wave 3 green"]);
});

test("R88 a stop request present before the run pauses before the first wave, with no executor", async () => {
  const w = world();
  requestStop(w);
  const r = await run(w);
  assert.equal(r.result.status, "paused");
  assert.deepEqual(r.result.pausedAt, { by: "stop-request", afterWave: null, nextWave: 1 });
  assert.match(r.result.reason, /paused before its first wave$/);
  assert.deepEqual(execLabels(r), []);
});

test("R88 stopAfterWave pauses after that wave's commit; the same args pause again at once; without it the run finishes", async () => {
  const w = world();
  const r = await run(w, { args: { stopAfterWave: 2 } });
  assert.equal(r.result.status, "paused", JSON.stringify(r.result));
  assert.deepEqual(execLabels(r).sort(), ["01-01", "01-02", "01-03"]);
  assert.deepEqual(stateWaves(w), ["state wave 1 green", "state wave 2 green"]);
  assert.deepEqual(r.result.pausedAt, { by: "stopAfterWave", afterWave: 2, nextWave: 3 });
  assert.equal(r.result.answer.verb, "rerun");
  assert.match(r.result.answer.command, /without stopAfterWave \(or a higher one\)/);

  const same = await run(w, { args: { stopAfterWave: 2 } });
  assert.equal(same.result.status, "paused");
  assert.deepEqual(execLabels(same), []);

  const rest = await run(w);
  assert.equal(rest.result.status, "executed", JSON.stringify(rest.result));
  assert.deepEqual(execLabels(rest), ["01-04"]);
});

test("R88 stopAfterWave at or past the last wave changes nothing; a bad value fails; batch mode refuses it", async () => {
  const w = world();
  const r = await run(w, { args: { stopAfterWave: 3 } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(stateWaves(w), ["state wave 1 green", "state wave 2 green", "state wave 3 green"]);
  assert.equal((await run(world(), { args: { stopAfterWave: 0 } })).result.reason, "stopAfterWave must be an integer >= 1");
  const batch = await run(world({ gsd: { execution_mode: "batch" } }), { args: { stopAfterWave: 1 } });
  assert.equal(batch.result.status, "refused");
  assert.match(batch.result.reason, /stopAfterWave needs gsd.execution_mode per-wave/);
});

test("R88 no stop request and no stopAfterWave: the run is the same, stop-requested is only read", async () => {
  const w = world();
  const r = await run(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(execLabels(r).sort(), ["01-01", "01-02", "01-03", "01-04"]);
  assert.deepEqual(stateWaves(w), ["state wave 1 green", "state wave 2 green", "state wave 3 green"]);
  assert.equal(r.result.pausedAt, undefined);
  const asks = r.shells.filter((s) => s.argv[2] === "stop-requested");
  assert.equal(asks.length, 3, "one read per wave boundary");
  assert.ok(!r.result.events.some((e) => e.startsWith("paused")));
  assert.equal(fs.existsSync(path.join(w.root, "_workspace/_runs")), false, "the verb writes nothing");
});

test("R88 graph schedule: a stop request starts no new plan, the started plans finish and commit, then the run pauses", async () => {
  const w = world({ gsd: { execute_schedule: "graph", parallelization: { enabled: true, max_concurrent: 2 } } }, DEPS);
  // Both wave-1 plans have started before the request arrives.
  const r = await run(w, { overrides: { "exec-01-01": async (_p, _o, _n, calls) => { await until(() => calls.some((c) => c.opts.label === "exec-01-02")); requestStop(w); } } });
  assert.equal(r.result.status, "paused", JSON.stringify(r.result));
  assert.deepEqual(execLabels(r).sort(), ["01-01", "01-02"]);
  assert.deepEqual(r.result.committed.sort(), ["01-01", "01-02"]);
  assert.deepEqual(r.result.notStarted, ["01-03"]);
  assert.deepEqual(r.result.pausedAt, { by: "stop-request", afterWave: 1, nextWave: 2 });
  assert.equal(r.result.answer.verb, "rerun");

  const again = await run(w, { runId: "wf_20261024-100500_r88g" });
  assert.equal(again.result.status, "executed", JSON.stringify(again.result));
  assert.deepEqual(execLabels(again), ["01-03", "01-04"]);
});

test("R88 graph schedule: stopAfterWave never starts a plan of a later wave", async () => {
  const w = world({ gsd: { execute_schedule: "graph" } }, DEPS);
  const r = await run(w, { args: { stopAfterWave: 1 } });
  assert.equal(r.result.status, "paused", JSON.stringify(r.result));
  assert.deepEqual(execLabels(r).sort(), ["01-01", "01-02"]);
  assert.deepEqual(r.result.pausedAt, { by: "stopAfterWave", afterWave: 1, nextWave: 2 });
});

test("R88 batch mode logs a stop request it cannot honour and runs to its commit", async () => {
  const w = world({ gsd: { execution_mode: "batch" } });
  requestStop(w);
  const r = await run(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.ok(r.logs.some((l) => /stop request not honoured: batch mode/.test(l)));
});
