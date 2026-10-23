// G009: a skeleton that passed is reviewed again when its lanes, their lens texts or the reviewer definition change.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides: {} }) });
const skeletonLabels = (r) => r.calls.map((c) => c.opts.label).filter((l) => l.startsWith("skeleton-")).sort();
const THREE = [{ lens: "fidelity" }, { lens: "integration" }, { lens: "perf" }];

test("G009 a lane added after a passed skeleton is reviewed; an unchanged rerun still spawns no reviewer", async () => {
  const w = makeWorld({ overlay: { adapter: { review_lenses: [{ name: "perf", stage: "skeleton", text: "Check the outline for latency budgets." }] } } });
  assert.equal((await plan(w)).result.status, "planned");
  assert.deepEqual(skeletonLabels(await plan(w)), []);
  const grown = await plan(w, { skeletonLanes: THREE });
  assert.equal(grown.result.status, "planned");
  assert.deepEqual(skeletonLabels(grown), ["skeleton-L1", "skeleton-L2", "skeleton-L3"]);
  assert.match(w.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`), /\| L3 \| perf \|/);
});

test("G009 a changed custom lens text reruns the skeleton review", async () => {
  const w = makeWorld({ overlay: { adapter: { review_lenses: [{ name: "perf", stage: "skeleton", text: "Check the outline for latency budgets." }] } } });
  const lanes = [{ lens: "fidelity" }, { lens: "perf" }];
  assert.equal((await plan(w, { skeletonLanes: lanes })).result.status, "planned");
  w.project.writeJson(".agents/harness.config.json", { adapter: { review_lenses: [{ name: "perf", stage: "skeleton", text: "Check the outline for memory budgets." }] } });
  assert.deepEqual(skeletonLabels(await plan(w, { skeletonLanes: lanes })), ["skeleton-L1", "skeleton-L2"]);
});

test("G009 an edited kit lens file reruns the skeleton review", async () => {
  const w = makeWorld();
  w.write(".agents/workflows/lenses/fidelity.md", "Check the goal.\n");
  assert.equal((await plan(w)).result.status, "planned");
  assert.deepEqual(skeletonLabels(await plan(w)), []);
  w.write(".agents/workflows/lenses/fidelity.md", "Check the goal and every locked decision.\n");
  assert.deepEqual(skeletonLabels(await plan(w)), ["skeleton-L1", "skeleton-L2"]);
});

test("G009 an edited skeleton reviewer definition changes the skeleton revision", async () => {
  const p = project({ files: { [`${P1}/01-SKELETON-LANES.json`]: "[]\n", ".agents/agents/gsd-skeleton-reviewer.md": "---\nname: gsd-skeleton-reviewer\n---\nReview.\n" } });
  await gsd(p, ["revisions", "record", "1", "skeleton"]);
  assert.equal((await gsd(p, ["revisions", "check", "1", "skeleton"])).code, 0);
  p.write(".agents/agents/gsd-skeleton-reviewer.md", "---\nname: gsd-skeleton-reviewer\n---\nReview harder.\n");
  assert.equal((await gsd(p, ["revisions", "check", "1", "skeleton"])).code, 1);
});
