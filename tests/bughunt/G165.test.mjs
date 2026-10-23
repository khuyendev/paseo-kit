import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanningService } from "../../plugins/planning-panel/server/service.ts";
import { countingLadder, fakeWorkspaces, makeWorkspace, planText, summaryText, write } from "../ui/planning-fixtures.mjs";

// Windows names `Phases/` and `phases/` one folder, so a case-variant phase directory keeps its plans there.
test("G165 a Phases/ directory on Windows keeps its plans: indexed with a plan id, counted on the board, found by plan lookup", { skip: process.platform !== "win32" && "Windows folds case" }, async () => {
  const { dir, root } = makeWorkspace();
  write(root, "Phases/01-core/01-01-PLAN.md", planText());
  write(root, "Phases/01-core/01-01-SUMMARY.md", summaryText("complete"));
  const paseo = fakeWorkspaces({ w: dir });
  const s = new PlanningService(countingLadder);

  const index = await s.index(paseo, { workspaceId: "w" });
  const plan = index.files.find((f) => f.kind === "plan");
  assert.deepEqual([plan.path, plan.phase, plan.planId], ["Phases/01-core/01-01-PLAN.md", "01", "01-01"]);

  const board = await s.board(paseo, { workspaceId: "w" });
  const phase = board.columns.flatMap((c) => c.phases)[0];
  assert.deepEqual([phase.dir, phase.plans, phase.summaries, phase.done, phase.pct], ["phases/01-core", 1, 1, 1, 100]);

  const detail = await s.plan(paseo, { workspaceId: "w", planId: "01-01" });
  assert.deepEqual([detail.ok, detail.path, detail.summary?.path], [true, "Phases/01-core/01-01-PLAN.md", "Phases/01-core/01-01-SUMMARY.md"]);
});
