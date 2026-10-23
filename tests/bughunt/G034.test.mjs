// Bug-hunt G034: gsd-plan forwards a plan-review needs-owner stop with the editor's conflict and numbered options.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

test("G034 a plan-review REVISION_CONFLICT stop reaches the owner with the conflict and options", async () => {
  const w = makeWorld();
  const conflict = { issue: "C1-1-1", decision: "D-01", alternatives: ["keep D-01", "revise D-01"] };
  const r = await runScript("gsd-plan", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, planReview: true },
    agent: plannerResponder(w, {
      overrides: {
        "find-": () => ({ issues: [{ severity: "high", actionable: true, description: "cites a missing symbol" }] }),
        "verify-": (p) => ({ verdicts: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], valid: true })) }),
        "judge-": (p) => ({ decisions: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], keep: true })) }),
        "editor-": () => ({ marker: "REVISION_CONFLICT", conflict }),
      },
    }),
  });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plan review"]);
  assert.deepEqual(r.result.conflict, conflict);
  assert.ok(r.result.issues.length > 0, "the kept issues still reach the owner");
  assert.ok(r.result.options.length >= 2, "the plan review stop names the owner's choices");
});
