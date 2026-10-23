// Bug-hunt G040: a plan review never stops on an edit that no review judged. The edit of the last allowed cycle is
// re-found in the review after it, and a stop returns that review's kept issues (G038 and G039 removed the cap that
// returned the unreviewed edit).
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder, planText } from "../gsd-flows/world.mjs";

const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
// Counts 3, 2, 1, 1 across the four review passes: the count stops falling after the third edit, so the review that
// follows that edit (cycle 4) is the stop. Each cycle's editor pass runs after its judge, so the editor passes so far
// give the cycle's count.
function reviewAgent(state) {
  return (p, o) => {
    if (o.label.startsWith("find-")) return { issues: o.label.endsWith("source-grounding") ? Array.from({ length: [3, 2, 1, 1][state.edits] }, (_, k) => ({ severity: "high", description: `issue ${k + 1}` })) : [] };
    if (o.label.startsWith("verify-")) return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
    if (o.label.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: true })) };
    if (o.label.startsWith("editor-")) { state.edits++; return { marker: "REVISION COMPLETE" }; }
    return null;
  };
}

test("G040 the last edit is re-found before the stop, and the stop returns that review's kept issues", async () => {
  const w = makeWorld({ files: { [`${PHASE_DIR}/01-01-PLAN.md`]: planText("01-01") } });
  const state = { edits: 0 };
  const r = await runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"] }, agent: reviewAgent(state) });
  assert.equal(state.edits, 3);
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("find-")).length, 4, "the cycle after the last edit is reviewed");
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /not converging: 1 high issues, not below 1/);
  assert.deepEqual(r.result.issues.map((x) => x.description), ["issue 1"]);
});

test("G040 gsd-plan passes that stop to the owner with its issues", async () => {
  const w = makeWorld();
  const state = { edits: 0 };
  const review = reviewAgent(state);
  const r = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, planReview: true }, agent: plannerResponder(w, { rows: [{ id: "01-01", wave: 1 }], overrides: { "find-": review, "verify-": review, "judge-": review, "editor-": review } }) });
  assert.equal(state.edits, 3);
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plan review"]);
  assert.deepEqual(r.result.issues.map((x) => x.description), ["issue 1"]);
});
