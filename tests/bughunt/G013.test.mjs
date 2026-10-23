// Bug-hunt fix G013 (kit-feedback 9): the plan checker's cap and stall test count per plan, so one plan that stops
// converging does not stop the other plans of the phase.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const labels = (r) => r.calls.map((c) => c.opts.label);

// The checker reports script[id][n] blockers for the n-th time it is asked about plan id; a plan it is not asked about
// does not use up its script.
function scriptedChecker(script) {
  const seen = {};
  return (prompt) => {
    const issues = [];
    for (const [id, counts] of Object.entries(script)) {
      if (!prompt.includes(`${id}-PLAN.md`)) continue;
      const n = seen[id] ?? 0;
      seen[id] = n + 1;
      for (let k = 0; k < (counts[n] ?? 0); k++) issues.push({ plan: id, severity: "blocker", description: `${id} blocker ${n}.${k}` });
    }
    return { issues };
  };
}

test("G013 a plan that converges is not stalled by the count of another plan", async () => {
  // Round 2 totals 2 against 2 in round 1 (01-01 falls 2 -> 1 while 01-02 rises 0 -> 1): a phase-wide stall test
  // stopped here. Per plan, 01-01 falls and 01-02 is new, so both are revised and both pass in round 3.
  const r = await plan(makeWorld(), { maxCheckIterations: 3 }, { "checker-": scriptedChecker({ "01-01": [2, 1, 0], "01-02": [0, 1, 0] }) });
  assert.equal(r.result.status, "planned", r.result.reason);
});

test("G013 a plan that stalls leaves the checker loop alone; the others keep being revised and the stop names only it", async () => {
  const r = await plan(makeWorld(), { maxCheckIterations: 3 }, { "checker-": scriptedChecker({ "01-01": [1, 1, 1], "01-02": [2, 1, 0] }) });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Checker");
  assert.equal(r.result.reason, "01-01: stalled: 1 issues, not below 1");
  assert.deepEqual(r.result.issues.map((i) => i.plan), ["01-01"]);
  assert.ok(labels(r).includes("revise-01-02-2"), labels(r).join(" "));
  assert.doesNotMatch(r.calls.filter((c) => c.opts.label.startsWith("checker-")).pop().prompt, /01-01-PLAN\.md/);
  const forced = await plan(makeWorld(), { maxCheckIterations: 3, forceProceed: { reason: "owner accepts 01-01" } }, { "checker-": scriptedChecker({ "01-01": [1, 1, 1], "01-02": [2, 1, 0] }) });
  assert.equal(forced.result.status, "planned");
  assert.deepEqual(forced.result.override.remaining.map((i) => i.plan), ["01-01"]);
});
