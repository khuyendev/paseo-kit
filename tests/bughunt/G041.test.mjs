// Bug-hunt fix G041: plan-review editor and verdict failures get the same one repair pass planning already uses
// (a null editor reply is retried, a partial verifier or judge reply is asked again for the ids it missed, and a plan
// that fails verify plan-structure after the edit gets one fix before the review fails).
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "../gsd-flows/world.mjs";

const finding = { severity: "high", description: "bad plan", actionable: true };
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const review = (w, agent) => runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01"] }, agent });
const roleCalls = (r, role) => r.calls.filter((c) => c.opts.role === role);

// Cycle 1 finds two issues; the finder finds none once an edit has run, so a successful edit converges in cycle 2.
function reviewer({ edits, verifier, judge = (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }), editor = () => ({ marker: "REVISION COMPLETE" }) }) {
  return (p, o) => {
    if (o.role === "plan_finder") return { issues: edits.count === 0 ? [finding, finding] : [] };
    if (o.role === "plan_verifier") return verifier(p, o);
    if (o.role === "plan_judge") return judge(p, o);
    if (o.role === "plan_editor") { edits.count++; return editor(p, o); }
    throw new Error(`unexpected role ${o.role}`);
  };
}

test("G041 a null plan editor reply is retried once before the review fails", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  const edits = { count: 0 };
  const r = await review(w, reviewer({ edits, verifier: (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }), editor: () => (edits.count === 1 ? NULL("finished without a reply") : { marker: "REVISION COMPLETE" }) }));
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  assert.equal(roleCalls(r, "plan_editor").length, 2);
});

test("G041 a quota failure of the plan editor is not retried", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  const edits = { count: 0 };
  const r = await review(w, reviewer({ edits, verifier: (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }), editor: () => NULL("quota exhausted") }));
  assert.equal(r.result.status, "failed");
  assert.equal(roleCalls(r, "plan_editor").length, 1);
});

test("G041 a verifier that answers one of two issues is asked again for the missing one only", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  const edits = { count: 0 };
  let first = true;
  const verifier = (p) => {
    const all = ids(p);
    if (!first) return { verdicts: all.map((id) => ({ id, valid: true })) };
    first = false;
    return { verdicts: all.slice(0, 1).map((id) => ({ id, valid: true })) };
  };
  const r = await review(w, reviewer({ edits, verifier }));
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  assert.equal(roleCalls(r, "plan_verifier").length, 2);
  assert.equal(roleCalls(r, "plan_judge").length, 1);
  assert.match(roleCalls(r, "plan_verifier")[1].prompt, /still needing a verdict/);
});

test("G041 a verifier that gives no verdicts even after the repair fails before the judge", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  const edits = { count: 0 };
  const r = await review(w, reviewer({ edits, verifier: () => ({ verdicts: [] }) }));
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /plan verifier did not answer every issue exactly once/);
  assert.equal(roleCalls(r, "plan_verifier").length, 2);
  assert.equal(roleCalls(r, "plan_judge").length, 0);
});

test("G041 a judge that answers one of two issues is asked again for the missing one only", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  const edits = { count: 0 };
  let first = true;
  const judge = (p) => {
    const all = ids(p);
    if (!first) return { decisions: all.map((id) => ({ id, keep: true })) };
    first = false;
    return { decisions: all.slice(0, 1).map((id) => ({ id, keep: true })) };
  };
  const r = await review(w, reviewer({ edits, verifier: (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }), judge }));
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  assert.equal(roleCalls(r, "plan_judge").length, 2);
  assert.equal(roleCalls(r, "plan_editor").length, 1);
});

test("G041 a plan that fails plan-structure after the edit gets one repair pass", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  w.structureErrors = { [`${PD}/01-01-PLAN.md`]: [["Task 1 missing <action>"]] };
  const edits = { count: 0 };
  const r = await review(w, reviewer({ edits, verifier: (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }) }));
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  assert.equal(roleCalls(r, "plan_editor").length, 2);
  assert.match(roleCalls(r, "plan_editor")[1].prompt, /Task 1 missing <action>/);
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 1);
});

test("G041 a plan that still fails plan-structure after the repair fails the review without a handoff", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  w.structureErrors = { [`${PD}/01-01-PLAN.md`]: [["Task 1 missing <action>"], ["Task 1 missing <action>"]] };
  const edits = { count: 0 };
  const r = await review(w, reviewer({ edits, verifier: (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }) }));
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /plan 01-01 fails verify plan-structure after the edit/);
  assert.deepEqual(r.result.errors, ["Task 1 missing <action>"]);
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 0);
});

test("G041 the editor prompt tells the editor to run the plan-structure check", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  const edits = { count: 0 };
  const r = await review(w, reviewer({ edits, verifier: (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }) }));
  assert.match(roleCalls(r, "plan_editor")[0].prompt, /verify plan-structure/);
});
