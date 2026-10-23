// Kit feedback #46: plan review re-reviews its last cycle's edit (no cycle cap) and reports the per-cycle counts in its result,
// which gsd-plan forwards in its Plan review stop.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText, plannerResponder } from "../gsd-flows/world.mjs";

const PLAN = `${PD}/01-01-PLAN.md`;
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const highs = (n) => Array.from({ length: n }, (_, i) => ({ severity: "high", description: `gap ${n}-${i}` }));

// Cycle n's finder reports cycles[n] (none past the end); each editor run moves to the next cycle.
async function review(cycles) {
  const w = makeWorld({ files: { [PLAN]: planText("01-01") } });
  let cycle = 0;
  const r = await runScript("gsd-plan-review", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01"] },
    agent: (p, o) => {
      if (o.label.startsWith("find-")) return { issues: cycles[cycle] ?? [] };
      if (o.label.startsWith("verify-")) return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
      if (o.label.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: true })) };
      if (o.label.startsWith("editor-")) { cycle++; w.handoff = { planRevision: `rev${cycle}`, waves: [{ wave: 1 }] }; w.write(PLAN, planText("01-01")); return { marker: "REVISION COMPLETE" }; }
      return null;
    },
  });
  return { w, r };
}

test("F46 a last-cycle fix converges on a post-edit pass, and the result carries the count of every cycle", async () => {
  const { r } = await review([highs(9), highs(4), highs(1), [{ severity: "low", actionable: true, description: "nit" }]]);
  assert.deepEqual([r.result.status, r.result.cycles], ["converged", 4]);
  assert.deepEqual(r.result.counts, [
    { cycle: 1, high: 9, mediumOrLow: 0 },
    { cycle: 2, high: 4, mediumOrLow: 0 },
    { cycle: 3, high: 1, mediumOrLow: 0 },
    { cycle: 4, high: 0, mediumOrLow: 1 },
  ]);
});

test("F46 a stalled review reports the counts up to the stop", async () => {
  const { r } = await review([highs(1), highs(1)]);
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /not below 1/);
  assert.deepEqual(r.result.counts, [
    { cycle: 1, high: 1, mediumOrLow: 0 },
    { cycle: 2, high: 1, mediumOrLow: 0 },
  ]);
});

test("F46 gsd-plan's Plan review stop forwards the per-cycle counts", async () => {
  const w = makeWorld();
  const high = () => ({ issues: [{ severity: "high", actionable: true, description: "cites a missing symbol" }] });
  const r = await runScript("gsd-plan", {
    root: w.root, args: { phaseDir: PD, planReview: true }, gsd: w.gsd,
    agent: plannerResponder(w, {
      overrides: {
        "find-": high,
        "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }),
        "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }),
        "editor-": () => ({ marker: "REVISION COMPLETE" }),
      },
    }),
  });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plan review"]);
  // The phase has two plans, each with one high issue per cycle.
  assert.deepEqual(r.result.counts, [
    { cycle: 1, high: 2, mediumOrLow: 0 },
    { cycle: 2, high: 2, mediumOrLow: 0 },
  ]);
});
