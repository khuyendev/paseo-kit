// G043: the plan-review editor takes its agent type from adapter.agents.plan_editor, as the other GSD roles do.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, planText } from "../gsd-flows/world.mjs";

// One cycle with one issue that the editor resolves, then a converging cycle.
async function planReview(overlay) {
  const w = makeWorld({ overlay });
  let cycle = 0;
  const r = await runScript("gsd-plan-review", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"] },
    agent: (p, o) => {
      if (o.label.startsWith("find-")) return { issues: cycle === 0 ? [{ severity: "high", description: "x" }] : [] };
      if (o.label.startsWith("verify-")) return { verdicts: [{ id: /"id":"([^"]+)"/.exec(p)[1], valid: true }] };
      if (o.label.startsWith("judge-")) return { decisions: [{ id: /"id":"([^"]+)"/.exec(p)[1], keep: true }] };
      if (o.label.startsWith("editor-")) { cycle++; w.write(`${PHASE_DIR}/01-01-PLAN.md`, planText("01-01")); return { marker: "REVISION COMPLETE" }; }
      return null;
    },
  });
  return r;
}

test("G043 the plan editor runs as the agent type mapped to plan_editor, the stock planner when unmapped", async () => {
  const mapped = await planReview({ adapter: { agents: { plan_editor: "my-editor" } } });
  assert.equal(mapped.result.status, "converged");
  const editor = mapped.calls.find((c) => c.opts.label === "editor-1");
  assert.equal(editor.opts.agentType, "my-editor");
  assert.equal(editor.opts.role, "plan_editor");

  const unmapped = await planReview(undefined);
  assert.equal(unmapped.calls.find((c) => c.opts.label === "editor-1").opts.agentType, "gsd-planner");
});
