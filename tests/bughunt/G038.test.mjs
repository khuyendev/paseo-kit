// G038: the plan review's last allowed edit (cycle 3) was never re-reviewed, and the cap result carried no issues.
// Every edit is followed by a review pass and the stop rules apply to that pass. G039 removed the fixed cap (trend-sized),
// so the 4-3-2-1 case below now runs on until the count stops falling.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, planText } from "../gsd-flows/world.mjs";

// counts[k] = issues the finders report in review pass k+1; each editor run advances the pass.
function review(counts) {
  const w = makeWorld();
  let pass = 0;
  const calls = [];
  const agent = (p, o) => {
    calls.push(o.label);
    if (o.label.startsWith("find-")) return { issues: Array.from({ length: counts[pass] ?? 0 }, (_, i) => ({ severity: "high", description: `p${pass}-${i}` })) };
    if (o.label.startsWith("verify-")) return { verdicts: [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => ({ id: m[1], valid: true })) };
    if (o.label.startsWith("judge-")) return { decisions: [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => ({ id: m[1], keep: true })) };
    if (o.label.startsWith("editor-")) {
      pass++;
      w.handoff = { planRevision: `rev${pass + 1}`, waves: [{ wave: 1 }] };
      w.write(`${PHASE_DIR}/01-01-PLAN.md`, planText("01-01"));
      return { marker: "REVISION COMPLETE" };
    }
    return null;
  };
  return runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"] }, agent }).then((r) => ({ r, calls }));
}

test("G038 falling 4-3-2-1-1: the stall check stops after the review that follows the last edit, with its issues", async () => {
  const { r, calls } = await review([4, 3, 2, 1, 1]);
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /not converging: 1 high issues, not below 1/);
  assert.equal(r.result.issues.length, 1);
  assert.equal(r.result.issues[0].description, "p4-0");
  assert.equal(calls.filter((l) => l.startsWith("find-")).length, 5);
  assert.equal(calls.filter((l) => l.startsWith("editor-")).length, 4);
});

test("G038 falling 3-2-1-0: the final review after the last edit is clean and converges", async () => {
  const { r, calls } = await review([3, 2, 1, 0]);
  assert.deepEqual([r.result.status, r.result.cycles, r.result.planRevision], ["converged", 4, "rev4"]);
  assert.equal(calls.filter((l) => l.startsWith("editor-")).length, 3);
});

test("G038 falling 3-2-0: converges in cycle 3, no extra pass", async () => {
  const { r, calls } = await review([3, 2, 0]);
  assert.deepEqual([r.result.status, r.result.cycles], ["converged", 3]);
  assert.equal(calls.filter((l) => l.startsWith("find-")).length, 3);
});

test("G038 flat 3-3: the stall check still stops at cycle 2 with the issues", async () => {
  const { r, calls } = await review([3, 3]);
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /not converging: 3 high issues, not below 3/);
  assert.equal(r.result.issues.length, 3);
  assert.equal(calls.filter((l) => l.startsWith("editor-")).length, 1);
});
