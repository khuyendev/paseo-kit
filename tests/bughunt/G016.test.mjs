// G016: a failed skeleton lane keeps the findings of the lanes that answered (gsd-plan.js skeletonGate).
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}, rows) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides, ...(rows ? { rows } : {}) }) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const lanes = [{ lens: "fidelity" }, { lens: "correctness" }];
const blocker = { plan: "01-01", severity: "blocker", description: "sibling blocker", target: "outline" };

test("G016 a failed lane keeps the findings of the answering lane, whichever lane fails", async () => {
  for (const failing of ["L1", "L2"]) {
    const answering = failing === "L1" ? "L2" : "L1";
    const w = makeWorld();
    const r = await plan(w, { skeletonLanes: lanes }, { [`skeleton-${failing}`]: () => NULL("finished without a reply"), [`skeleton-${answering}`]: () => ({ issues: [blocker] }) });
    assert.equal(r.result.status, "failed");
    assert.equal(labels(r).filter((l) => l === `skeleton-${failing}`).length, 2);
    const review = w.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`);
    assert.match(review, new RegExp(`Status: failed \\(skeleton lane ${failing} \\(`));
    assert.match(review, new RegExp(`\\| ${failing} \\|[^\\n]*failed`));
    assert.match(review, new RegExp(`\\| ${answering}-1 \\| ${answering} \\| 01-01 \\| blocker \\| outline \\| sibling blocker`));
  }
});

test("G016 architect outline changes are kept when a skeleton lane fails", async () => {
  const rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"], consumes: [{ plan: "01-01", symbol: "Api" }] }];
  const archAgent = { ".agents/agents/arch.md": "---\nname: arch\n---\nbody\n" };
  const w = makeWorld({ files: archAgent, overlay: { adapter: { agents: { architect: "arch" } } } });
  const r = await plan(w, { skeletonLanes: lanes }, {
    architect: () => { w.write(`${PHASE_DIR}/01-WIRING.md`, "Api: 01-01 -> 01-02\n"); return { status: "complete", sharedChanges: [], outlineChanges: [{ plan: "01-02", description: "outline change kept" }] }; },
    "skeleton-L1": () => NULL("finished without a reply"),
    "skeleton-L2": () => ({ issues: [] }),
  }, rows);
  assert.equal(r.result.status, "failed");
  assert.match(w.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`), /outline change kept/);
});
