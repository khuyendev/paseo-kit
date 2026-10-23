import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "../gsd-flows/world.mjs";

const PLANS = ["01-01", "01-02"];
const issue = (plan) => ({ plan, severity: "high", description: `bad ${plan}`, actionable: true });
const planOf = (label) => /(\d+-\d+)/.exec(label)[1];
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const world = () => makeWorld({ files: Object.fromEntries(PLANS.map((id) => [`${PD}/${id}-PLAN.md`, planText(id)])) });
const review = (w, agent) => runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: PLANS }, agent });

test("G036 a failed plan finder keeps the issues of the finders that answered", async () => {
  const w = world();
  const r = await review(w, (_p, o) => {
    if (o.label === "find-01-02-source-grounding") return NULL("quota exhausted");
    if (o.label === "find-01-01-source-grounding") return { issues: [issue("01-01")] };
    return null;
  });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /plan finder 01-02 \(source-grounding\) returned nothing \(quota exhausted\)/);
  assert.match(r.result.reason, /ph workflow --resume/);
  assert.deepEqual(r.result.issues.map((x) => [x.plan, x.description]), [["01-01", "bad 01-01"]]);
  assert.equal(r.calls.some((c) => c.opts.role === "plan_verifier"), false);
});

test("G036 a failed plan verifier keeps the issues of the plans whose verifier answered", async () => {
  const w = world();
  const r = await review(w, (p, o) => {
    if (o.label.startsWith("find-")) return { issues: [issue(planOf(o.label))] };
    if (o.label === "verify-01-02") return NULL("quota exhausted");
    if (o.label === "verify-01-01") return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
    return null;
  });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /plan verifier 01-02 returned nothing \(quota exhausted\)/);
  assert.deepEqual(r.result.issues.map((x) => [x.plan, x.description]), [["01-01", "bad 01-01"]]);
  assert.equal(r.calls.some((c) => c.opts.role === "plan_judge"), false);
});
