// G029 (bug hunt 2026-10-23): a lens-only skeleton lane must not erase the per-run skeleton_lane role override,
// and a skeleton lane takes only skeleton-stage lenses (kit fidelity/integration or an adapter lens of stage skeleton).
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const perf = { name: "perf", text: "look for slow queries", applies_to: ["src/**"] };

test("G029 a per-run skeleton_lane role override reaches lens-only lanes; lane fields still win over it", async () => {
  const w = makeWorld();
  let first = true;
  const r = await plan(w, { roles: { skeleton_lane: { model: "p/reviewer", effort: "high" } } }, {
    "skeleton-L1": () => { const issues = first ? [{ severity: "blocker", description: "missing row", target: "outline" }] : []; first = false; return { issues }; },
  });
  for (const label of ["skeleton-L1", "resolve-L1"]) {
    const call = r.calls.find((c) => c.opts.label === label);
    assert.ok(call, label);
    assert.deepEqual([call.opts.model, call.opts.effort], ["p/reviewer", "high"], label);
  }
  const w2 = makeWorld();
  const laneWins = await plan(w2, { skeletonLanes: [{ lens: "fidelity", model: "p/lane", effort: "low" }], roles: { skeleton_lane: { model: "p/reviewer", effort: "high" } } });
  const lane = laneWins.calls.find((c) => c.opts.label === "skeleton-L1");
  assert.deepEqual([lane.opts.model, lane.opts.effort], ["p/lane", "low"]);
});

test("G029 a skeleton lane rejects a lens of another stage before any agent runs", async () => {
  for (const lens of [{ ...perf }, { ...perf, stage: "code" }, { ...perf, stage: "plan_review" }]) {
    const w = makeWorld({ overlay: { adapter: { review_lenses: [lens] } } });
    const r = await plan(w, { skeletonLanes: [{ lens: "perf" }] });
    assert.equal(r.result.status, "failed", JSON.stringify(lens));
    assert.match(r.result.reason, /perf/);
    assert.equal(r.calls.length, 0);
  }
  const ok = makeWorld({ overlay: { adapter: { review_lenses: [{ ...perf, stage: "skeleton" }] } } });
  assert.equal((await plan(ok, { skeletonLanes: [{ lens: "perf" }] })).result.status, "planned");
  for (const lens of ["correctness", "source-grounding"]) {
    const r = await plan(makeWorld(), { skeletonLanes: [{ lens }] });
    assert.equal(r.result.status, "failed", lens);
    assert.equal(r.calls.length, 0);
  }
});
