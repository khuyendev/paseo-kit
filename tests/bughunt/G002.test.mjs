// Bug-hunt fix G002: the skeleton stall and the owner stop count open blockers only; warnings are carried forward.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const issue = (n, severity, target = "outline") => ({ plan: "01-01", severity, description: `issue ${n}`, target });
// Pass 1 reports the given issues in lane L1; each resolution check resolves the ids listed for that pass.
function skeleton(issues, resolvePerPass) {
  let pass = 0;
  return {
    "skeleton-L1": () => ({ issues }),
    "resolve-L1": () => ({ resolved: (resolvePerPass[pass++] ?? []).map((id) => ({ id, evidence: "fixed" })) }),
  };
}

test("G002 a warning-only skeleton review passes and carries the warning without a revision or stall", async () => {
  const r = await plan(makeWorld(), skeleton([issue(1, "warning")], [[]]));
  assert.equal(r.result.status, "planned");
  assert.ok(r.result.warnings.some((x) => x.includes("issue 1")));
  assert.ok(!labels(r).includes("outline-revise-2"));
});

test("G002 a pass that clears the last blocker passes with the remaining warning instead of stalling on it", async () => {
  const r = await plan(makeWorld(), skeleton([issue(1, "blocker"), issue(2, "warning")], [["L1-1"]]));
  assert.equal(r.result.status, "planned");
  assert.ok(r.result.warnings.some((x) => x.includes("issue 2")));
});

test("G002 a stall with a blocker still open ends needs-owner, counts blockers only, and lists only the blockers", async () => {
  const r = await plan(makeWorld(), skeleton([issue(1, "blocker"), issue(2, "blocker"), issue(3, "warning")], [[]]));
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Skeleton review"]);
  assert.match(r.result.reason, /stalled: 2 open blockers at pass 2 \(was 2\)/);
  assert.deepEqual(r.result.issues.map((i) => i.description), ["issue 1", "issue 2"]);
});
