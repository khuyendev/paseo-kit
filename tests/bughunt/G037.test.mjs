// Bug-hunt fix G037: plan review re-finds a plan that had no open issue at its last pass only when the plan changed.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "../gsd-flows/world.mjs";

const ids = (p) => [...p.matchAll(/"id":"(C[^"]+)"/g)].map((m) => m[1]);
const finds = (r, plan) => r.calls.filter((c) => c.opts.label.startsWith(`find-${plan}-`)).length;

// Both plans are recorded as planned (gsd-plan records plan:<id> after each planner call).
async function plannedWorld() {
  const w = makeWorld();
  w.write(`${PD}/01-01-PLAN.md`, planText("01-01"));
  w.write(`${PD}/01-02-PLAN.md`, planText("01-02"));
  await w.gsd.call(["revisions", "record", PD, "plan:01-01"], "");
  await w.gsd.call(["revisions", "record", PD, "plan:01-02"], "");
  return w;
}

test("G037 a clean plan is not re-found in a later cycle while the editor leaves it unchanged", async () => {
  const w = await plannedWorld();
  let pass02 = 0;
  const r = await runScript("gsd-plan-review", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01", "01-02"] },
    agent: (p, o) => {
      const l = o.label;
      if (l === "find-01-01-source-grounding") return { issues: [] };
      // 01-02 has one high issue in pass 1 and none after the editor revises it.
      if (l === "find-01-02-source-grounding") return { issues: ++pass02 === 1 ? [{ severity: "high", actionable: true, description: "open" }] : [] };
      if (l.startsWith("verify-")) return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
      if (l.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: true })) };
      if (l.startsWith("editor-")) { w.write(`${PD}/01-02-PLAN.md`, planText("01-02") + "\nrevised\n"); return { marker: "REVISION COMPLETE" }; }
      return null;
    },
  });
  assert.deepEqual([r.result.status, r.result.cycles], ["converged", 2], JSON.stringify(r.result));
  assert.equal(finds(r, "01-01"), 1, "clean 01-01 is found in cycle 1 only");
  assert.equal(finds(r, "01-02"), 2, "01-02 is found in both cycles");
});

test("G037 a clean plan the editor touched is found again", async () => {
  const w = await plannedWorld();
  let pass02 = 0;
  const r = await runScript("gsd-plan-review", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01", "01-02"] },
    agent: (p, o) => {
      const l = o.label;
      if (l === "find-01-01-source-grounding") return { issues: [] };
      if (l === "find-01-02-source-grounding") return { issues: ++pass02 === 1 ? [{ severity: "high", actionable: true, description: "open" }] : [] };
      if (l.startsWith("verify-")) return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
      if (l.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: true })) };
      if (l.startsWith("editor-")) {
        // The editor revises both plans in one pass, so 01-01 changed after its clean pass.
        w.write(`${PD}/01-01-PLAN.md`, planText("01-01") + "\nrevised\n");
        w.write(`${PD}/01-02-PLAN.md`, planText("01-02") + "\nrevised\n");
        return { marker: "REVISION COMPLETE" };
      }
      return null;
    },
  });
  assert.deepEqual([r.result.status, r.result.cycles], ["converged", 2], JSON.stringify(r.result));
  assert.equal(finds(r, "01-01"), 2, "the edited clean plan is reviewed again");
});
