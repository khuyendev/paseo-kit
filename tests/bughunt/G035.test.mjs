// G035: a converged plan review returns the kept findings it does not count (medium or low, not actionable), and
// gsd-plan carries them to its result as advisories instead of dropping them at convergence.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder, planText } from "../gsd-flows/world.mjs";

const advisory = { severity: "medium", actionable: false, description: "the plan cites no source for the helper name" };
const ids = (p) => [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => m[1]);
const reviewOverrides = {
  "find-": (_p, o) => ({ issues: o.label === "find-01-01-source-grounding" ? [advisory] : [] }),
  "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }),
  "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }),
};
const reviewAgent = (p, o) => {
  const key = Object.keys(reviewOverrides).find((k) => o.label.startsWith(k));
  return key ? reviewOverrides[key](p, o) : null;
};

test("G035 a converged plan review returns its kept non-actionable finding and runs no editor", async () => {
  const w = makeWorld({ files: { [`${PHASE_DIR}/01-01-PLAN.md`]: planText("01-01") } });
  const r = await runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"] }, agent: reviewAgent });
  assert.equal(r.result.status, "converged");
  assert.equal(r.calls.some((c) => c.opts.label.startsWith("editor-")), false);
  assert.deepEqual(r.result.issues?.map((i) => [i.severity, i.actionable, i.description]), [[advisory.severity, false, advisory.description]]);
});

test("G035 gsd-plan keeps a converged plan review's advisory in its planned result", async () => {
  const w = makeWorld();
  const r = await runScript("gsd-plan", {
    root: w.root, args: { phaseDir: PHASE_DIR, planReview: true }, gsd: w.gsd,
    agent: plannerResponder(w, { overrides: reviewOverrides }),
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(r.result.advisories.map((x) => [x.lane, x.plan, x.severity, x.description]), [["plan-review", "01-01", advisory.severity, advisory.description]]);
});
