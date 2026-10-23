// THIN.md item 4 for gsd-plan (TP, kit feedback 87). The 700-line budget of THIN.md is not reached with full parity (the stage
// note says why); this test holds what stage 2 reached so the composition does not grow back, and that it keeps no copy of a
// planning verb's logic. The 700-line test of TI-budget.test.mjs stays skipped until the budget is reached.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compositionBudget, WORKFLOWS_DIR } from "./budget.mjs";

// gsd-plan.js after stage 2 (1549 lines on thin/TI before it).
const GSD_PLAN_CEILING = 1020;

test("TP gsd-plan.js stays within the stage-2 ceiling and defines no engine helper", () => {
  const { lines, helperDefinitions } = compositionBudget("gsd-plan.js");
  assert.ok(lines <= GSD_PLAN_CEILING, `gsd-plan.js has ${lines} lines; the stage-2 ceiling is ${GSD_PLAN_CEILING}`);
  assert.deepEqual(helperDefinitions, []);
});

test("TP gsd-plan.js keeps no copy of the planning verbs: schemas, lens texts, issue book, probe and recheck logic", () => {
  const src = fs.readFileSync(path.join(WORKFLOWS_DIR, "gsd-plan.js"), "utf8");
  for (const [what, re] of [
    ["an agent schema", /type: "object", properties:/],
    ["the lens text", /Follow the lens text in/],
    ["the skeleton issue book", /function addIssue|function renderReview|function skeletonFindings/],
    ["the Files/plan probe", /function filesPerPlanProbes|lists \$\{n\} files in files_modified/],
    ["the linked-plan search", /const reaches = /],
    ["an argument check", /must be an integer 1\.\.3/],
    ["a planning-context block", /<planning_context>|<revision_context>|<specless_edges>/],
  ]) assert.doesNotMatch(src, re, `gsd-plan.js still has ${what}`);
  for (const verb of ["plan-args", "plan-prompt", "plan-skeleton", "plan-probes", "plan-linked", "plan-realloc-diff", "plan-validation"]) assert.ok(src.includes(`"${verb}"`), `gsd-plan.js calls ${verb}`);
});
