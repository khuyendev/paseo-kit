// Kit feedback #88 (composition): gsd-plan honours a stop request between planner waves and between checker rounds, where every
// plan written so far is recorded; the run ends paused with its answer (rerun with the same args), and the rerun keeps the
// recorded plans. No stop request changes nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const RUN = "wf_20261024-110000_r88p";
const plan = (w, { args = {}, overrides = {}, runId = RUN } = {}) => runScript("gsd-plan", { root: w.root, runId, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const requestStop = (w, runId = RUN) => w.write(`_workspace/_runs/${runId}/stop.json`, JSON.stringify({ at: "wave-boundary", requestedAt: "2026-10-24T11:00:00.000Z", reason: "kit update" }));
const labels = (r, prefix) => r.calls.map((c) => c.opts.label ?? "").filter((l) => l.startsWith(prefix));

for (const planFlow of ["staged", "streams"]) {
  test(`R88 gsd-plan (${planFlow}) pauses between planner waves on a stop request; a rerun keeps wave 1 and plans wave 2`, async () => {
    const w = makeWorld();
    const r = await plan(w, { args: { planFlow }, overrides: { "plan-01-01": () => { requestStop(w); } } });
    assert.equal(r.result.status, "paused", JSON.stringify(r.result));
    assert.equal(r.result.stage, "Plans");
    assert.deepEqual(r.result.pausedAt, { by: "stop-request", afterWave: 1, nextWave: 2 });
    assert.match(r.result.reason, /^stop requested \(kit update\): paused after planner wave 1 of 2$/);
    assert.equal(r.result.answer.verb, "rerun");
    assert.match(r.result.answer.command, /workflow --name gsd-plan .*\(same args\)/);
    assert.deepEqual(labels(r, "plan-"), ["plan-01-01"]);
    assert.deepEqual(labels(r, "checker-"), []);

    const again = await plan(w, { args: { planFlow }, runId: "wf_20261024-110500_r88q" });
    assert.equal(again.result.status, "planned", JSON.stringify(again.result));
    assert.deepEqual(labels(again, "plan-"), ["plan-01-02"], "the plan of wave 1 is kept");
  });
}

test("R88 gsd-plan pauses between checker rounds once the round's revisions are recorded; a rerun checks again and plans", async () => {
  const w = makeWorld();
  let first = true;
  const blocker = { plan: "01-01", dimension: "scope_sanity", severity: "blocker", required_property: "scope_sanity", description: "01-01 too wide" };
  const overrides = { "checker-": () => {
    if (!first) return { issues: [] };
    first = false;
    requestStop(w);
    return { issues: [blocker] };
  } };
  const r = await plan(w, { overrides });
  assert.equal(r.result.status, "paused", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Checker");
  assert.deepEqual(r.result.pausedAt, { by: "stop-request", round: 2 });
  assert.equal(labels(r, "checker-").length, 1);
  assert.equal(labels(r, "revise-01-01").length, 1, "the round's revision ran and was recorded before the pause");

  const again = await plan(w, { overrides, runId: "wf_20261024-110500_r88r" });
  assert.equal(again.result.status, "planned", JSON.stringify(again.result));
  assert.deepEqual(labels(again, "plan-"), [], "both plans are kept");
});

test("R88 gsd-plan without a stop request plans as before", async () => {
  const w = makeWorld();
  const r = await plan(w);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal(r.result.pausedAt, undefined);
  assert.equal(r.shells.filter((s) => s.argv[2] === "stop-requested").length, 1, "one read between the two planner waves");
});
