// Kit feedback #44 (F44): a checker blocker stays open until a checker says it is resolved. The next checker prompt
// carries the still-open blockers as "still open?", and a blocker no checker confirms does not drop out of the count.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const promptOf = (r, label) => r.calls.find((c) => c.opts.label === label).prompt;
const blocker = { plan: "01-01", dimension: "coverage", severity: "blocker", required_property: "x holds", description: "x is missing" };

test("F44 a blocker no checker confirmed resolved is carried into the next checker prompt and keeps the loop open", async () => {
  const r = await plan(makeWorld(), {}, { "checker-1": () => ({ issues: [blocker] }), "checker-2": () => ({ issues: [] }) });
  assert.match(promptOf(r, "checker-2"), /still open\?[\s\S]*"required_property":"x holds"/);
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /stalled: 1 issues/);
});

test("F44 a carried blocker leaves the loop only when a checker lists its id as resolved", async () => {
  const r = await plan(makeWorld(), {}, { "checker-1": () => ({ issues: [blocker] }), "checker-2": () => ({ issues: [], resolved: [{ id: "open-1", evidence: "x holds in 01-01" }] }) });
  assert.match(promptOf(r, "checker-2"), /"id":"open-1"/);
  assert.equal(r.result.status, "planned");
});

test("F44 a still-open blocker that the checker repeats is counted once, not once per carry", async () => {
  const again = { ...blocker, description: "x is still missing" };
  const r = await plan(makeWorld(), { maxCheckIterations: 3 }, { "checker-1": () => ({ issues: [blocker] }), "checker-2": () => ({ issues: [again] }) });
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /stalled: 1 issues/);
  assert.equal(r.result.stage, "Checker");
});
