// Kit feedback #47 (F47): the plan-review editor records each plan it edited, once that plan passes verify plan-structure,
// as the checker's revision loop does; a sibling that fails the structure check does not drop the recorded edits, and a
// plan the editor did not touch is not recorded.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "../gsd-flows/world.mjs";

const PLANS = ["01-01", "01-02"];
const planPath = (id) => `${PD}/${id}-PLAN.md`;
const issue = (plan) => ({ plan, severity: "high", description: `bad ${plan}`, actionable: true });
const planOf = (label) => /(\d+-\d+)/.exec(label)[1];
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const world = () => makeWorld({ files: Object.fromEntries(PLANS.map((id) => [planPath(id), planText(id)])) });
const review = (w, agent) => runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: PLANS }, agent });

// Cycle 1 finds one high issue per plan; the editor rewrites the plans in `edits` and the finders find nothing afterwards.
function reviewer(w, edits) {
  let edited = false;
  return (p, o) => {
    if (o.label.startsWith("find-")) return { issues: edited ? [] : [issue(planOf(o.label))] };
    if (o.label.startsWith("verify-")) return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
    if (o.label.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: true })) };
    if (o.label.startsWith("editor-")) {
      for (const id of edits) w.write(planPath(id), `${planText(id)}<!-- revised -->\n`);
      edited = true;
      return { marker: "REVISION COMPLETE" };
    }
    return null;
  };
}

test("F47 an edited plan is recorded after the review, an untouched plan is not", async () => {
  const w = world();
  const r = await review(w, reviewer(w, ["01-01"]));
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  assert.equal(w.recorded.has("plan:01-01"), true);
  assert.equal(w.recorded.has("plan:01-02"), false);
});

test("F47 an edited plan that passes plan-structure is recorded when a sibling fails it after the edit", async () => {
  const w = world();
  w.structureErrors = { [planPath("01-02")]: [["Task 1 missing <action>"], ["Task 1 missing <action>"]] };
  const r = await review(w, reviewer(w, PLANS));
  assert.equal(r.result.status, "failed", JSON.stringify(r.result));
  assert.match(r.result.reason, /plan 01-02 fails verify plan-structure after the edit/);
  assert.equal(w.recorded.has("plan:01-01"), true);
  assert.equal(w.recorded.has("plan:01-02"), false);
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 0);
});
