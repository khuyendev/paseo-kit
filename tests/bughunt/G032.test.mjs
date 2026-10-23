// Bug-hunt G032: a plan-review issue from a finder of one plan is verified by that plan's verifier, even when the
// finder names another plan in the review list.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "../gsd-flows/world.mjs";

const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);

test("G032 an issue naming another plan is verified by the plan the finder reviewed, not by that plan", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01"), [`${PD}/01-02-PLAN.md`]: planText("01-02") } });
  const issue = { plan: "01-02", severity: "high", description: "01-01 misses a rollback step", actionable: true };
  const r = await runScript("gsd-plan-review", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01", "01-02"] },
    agent: (p, o) => {
      if (o.label.startsWith("find-01-01")) return { issues: [issue] };
      if (o.label.startsWith("find-")) return { issues: [] };
      if (o.label === "verify-01-01") return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
      if (o.label === "verify-01-02") return { verdicts: ids(p).map((id) => ({ id, valid: false })) };
      if (o.label.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: false })) };
      return null;
    },
  });
  assert.equal(r.result.status, "converged", JSON.stringify(r.result));
  assert.equal(r.calls.filter((c) => c.opts.label === "verify-01-02").length, 0);
  const verify = r.calls.find((c) => c.opts.label === "verify-01-01");
  assert.ok(verify, "the finder's own plan verifier must receive the issue");
  assert.match(verify.prompt, /01-01 misses a rollback step/);
  assert.match(r.calls.find((c) => c.opts.label.startsWith("judge-")).prompt, /01-01 misses a rollback step/);
});
