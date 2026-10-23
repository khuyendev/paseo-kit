// G015: a failed or stopped sibling in a planning batch must not drop the revision records of the plans that finished.
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, planText, plannerResponder } from "../gsd-flows/world.mjs";

const rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 1 }];
const plan = (w, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w, { rows, overrides }) });
const plannerLabels = (r) => r.calls.map((c) => c.opts.label).filter((l) => l.startsWith("plan-"));
const planKeys = (w) => [...w.recorded.keys()].filter((k) => k.startsWith("plan:")).sort();

test("G015 a same-wave sibling that fails or stops keeps the record of the plan that finished", async () => {
  const stops = [NULL("agent error: rate limit"), { marker: "## CHECKPOINT REACHED", question: "pick one?" }];
  for (const stop of stops) {
    const w = makeWorld();
    const first = await plan(w, { "plan-01-02": () => stop });
    assert.equal(first.result.status, stop.__null ? "failed" : "needs-owner");
    assert.deepEqual(planKeys(w), ["plan:01-01"]);
    const rerun = await plan(w);
    assert.equal(rerun.result.status, "planned");
    assert.deepEqual(plannerLabels(rerun), ["plan-01-02"]);
  }
});

test("G015 a plan that still fails the structure check is not recorded, its finished sibling is", async () => {
  const w = makeWorld();
  w.structureErrors = { [`${PHASE_DIR}/01-01-PLAN.md`]: [["missing frontmatter field must_haves"], ["missing frontmatter field must_haves"]] };
  const r = await plan(w);
  assert.equal(r.result.status, "failed");
  assert.deepEqual(planKeys(w), ["plan:01-02"]);
});

test("G015 a checker REVISION_CONFLICT on one plan keeps the revised record of its sibling", async () => {
  const w = makeWorld();
  let checks = 0;
  const overrides = {
    "checker-": () => (checks++ === 0 ? { issues: [{ plan: "01-01", severity: "blocker", description: "x" }, { plan: "01-02", severity: "blocker", description: "y" }] } : { issues: [] }),
    "revise-01-01": () => ({ marker: "REVISION_CONFLICT", conflict: { issue: "x", decision: "D-01" } }),
    "revise-01-02": () => {
      w.write(`${PHASE_DIR}/01-02-PLAN.md`, `${planText("01-02")}<!-- revised -->\n`);
      return { marker: "## REVISION COMPLETE" };
    },
  };
  const first = await plan(w, overrides);
  assert.deepEqual([first.result.status, first.result.marker], ["needs-owner", "REVISION_CONFLICT"]);
  const rerun = await plan(w);
  assert.equal(rerun.result.status, "planned");
  assert.deepEqual(plannerLabels(rerun), []);
});
