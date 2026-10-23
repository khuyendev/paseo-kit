// Bug-hunt G008 (gsd-plan): a checker revision or a skeleton resolution check that returns nothing is a failed call.
// It is neither a finished revision (the plan is not recorded as revised) nor a stalled skeleton (the owner gets no
// stall options for a planner that never answered).
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const recordsOf = (r, key) => r.gsd.callsOf("revisions record").filter((c) => c.argv.includes(key)).length;

test("G008 a plan revision that returns nothing fails the checker loop with its reason and is never recorded as revised", async () => {
  const one = { issues: [{ plan: "01-01", severity: "blocker", description: "c1" }] };
  const r = await plan(makeWorld(), { maxCheckIterations: 3 }, { "checker-": () => one, "revise-01-01": () => NULL("agent timeout") });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /planner revision 01-01 \(checker iteration 1\): agent timeout/);
  assert.equal(labels(r).filter((l) => l.startsWith("checker-")).length, 1);
  assert.equal(labels(r).some((l) => l.startsWith("fix-")), false);
  assert.equal(recordsOf(r, "plan:01-01"), 1, "only the planning-stage record; the unreturned revision is not recorded");
});

test("G008 a phase-level revision that returns nothing fails the checker loop with its reason", async () => {
  const phaseIssue = { issues: [{ plan: null, severity: "blocker", description: "phase gap" }] };
  const r = await plan(makeWorld(), { maxCheckIterations: 3 }, { "checker-": () => phaseIssue, "revise-phase-": () => NULL("agent timeout") });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /phase-level planner revision \(checker iteration 1\): agent timeout/);
  assert.equal(labels(r).filter((l) => l.startsWith("checker-")).length, 1);
});

test("G008 a skeleton resolution check that returns nothing fails the gate with the open issues, not a stall", async () => {
  const three = { issues: [1, 2, 3].map((i) => ({ plan: "01-01", severity: "blocker", description: `issue ${i}`, target: "outline" })) };
  const r = await plan(makeWorld(), {}, { "skeleton-L1": () => three, "resolve-L1": () => NULL("agent timeout") });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /skeleton resolution L1 \(.+\): agent timeout; open issues L1-1, L1-2, L1-3 not judged/);
  assert.deepEqual(r.result.issues.map((i) => i.id), ["L1-1", "L1-2", "L1-3"]);
  assert.doesNotMatch(JSON.stringify(r.result), /stalled/);
});

test("G008 a resolution check that answers with nothing resolved still stalls the skeleton", async () => {
  const three = { issues: [1, 2, 3].map((i) => ({ plan: "01-01", severity: "blocker", description: `issue ${i}`, target: "outline" })) };
  const r = await plan(makeWorld(), {}, { "skeleton-L1": () => three, "resolve-L1": () => ({ resolved: [] }) });
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /stalled: 3 open issues at pass 2 \(was 3\)/);
});
