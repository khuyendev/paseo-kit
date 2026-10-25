// G017: a plan or review reuse key covers the effective workflow and review settings, not only the files it hashes.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const skeletonLabels = (r) => labels(r).filter((l) => l.startsWith("skeleton-"));

test("G017 a changed settings digest changes the freeze key; the same digest keeps it", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>", "src/a.js": "1" } });
  await gsd(p, ["revisions", "record", "1", "freeze", "--settings", "s1"]);
  const same = await gsd(p, ["revisions", "check", "1", "freeze", "--settings", "s1"]);
  assert.deepEqual([same.code, same.json.status], [0, "same"]);
  const changed = await gsd(p, ["revisions", "check", "1", "freeze", "--settings", "s2"]);
  assert.deepEqual([changed.code, changed.json.status], [1, "changed"], "a config-only change invalidates the key");
  const research = await gsd(p, ["revisions", "hash", "1", "research"]);
  assert.equal(research.code, 0, "research takes no settings digest");
});

test("G017 a changed skeleton lane reruns the skeleton review; a checker role change reruns only its judgment, a planner role change nothing", async () => {
  const w = makeWorld();
  const first = await plan(w, { skeletonLanes: [{ lens: "fidelity" }] });
  assert.equal(first.result.status, "planned");
  const same = await plan(w, { skeletonLanes: [{ lens: "fidelity" }] });
  assert.deepEqual(skeletonLabels(same), [], "an unchanged skeleton stays reused");
  const lanes = await plan(w, { skeletonLanes: [{ lens: "fidelity" }, { lens: "integration" }] });
  assert.deepEqual(skeletonLabels(lanes), ["skeleton-L1", "skeleton-L2"], "a new lane runs");
  const checker = await plan(w, { skeletonLanes: [{ lens: "fidelity" }, { lens: "integration" }], roles: { checker: { model: "checker-model" } } });
  assert.deepEqual([skeletonLabels(checker), labels(checker).filter((l) => l.startsWith("plan-"))], [[], []], "a checker change leaves skeleton and plans reused");
  assert.ok(labels(checker).includes("checker-1"), "the checker reruns");
  // Role overrides are per run: the checker override is repeated, or its effective role would revert and rerun the checker.
  // Kit feedback W20: a planner's model is how a plan was written; upstream keeps a written plan, so nothing is planned again.
  const planner = await plan(w, { skeletonLanes: [{ lens: "fidelity" }, { lens: "integration" }], roles: { checker: { model: "checker-model" }, planner: { model: "planner-model" } } });
  assert.deepEqual([skeletonLabels(planner), labels(planner).includes("checker-1")], [[], false], "a planner change reruns neither the skeleton nor the checker");
  assert.deepEqual(labels(planner).filter((l) => l.startsWith("plan-")), [], "the plans are kept");
  assert.ok(!labels(planner).includes("outline"), "the outline stays file-keyed: a regenerated outline may match the old one");
});
