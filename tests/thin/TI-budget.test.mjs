// THIN.md item 4 (kit feedback 87): budgets of the default composition. No shipped composition defines a helper the
// engine provides (active from stage 1); the 700-line budgets of gsd-execute.js and gsd-plan.js are enabled by stage 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { COMPOSITION_LINE_BUDGET, compositionBudget, compositionScripts } from "./budget.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

test("TI budget helper counts lines with comments and finds top-level helper definitions, not reassignments or locals", () => {
  const file = path.join(makeTempDir(), "gsd-x.js");
  fs.writeFileSync(file, "// c\r\nconst PH = 1;\nasync function call(p) {}\ncall = async () => 1;\n  function flow () {}\nconst phaseDir = 2;\nconst sha2 = 3;\n");
  const b = compositionBudget(file);
  assert.equal(b.lines, 7);
  assert.deepEqual(b.helperDefinitions, [{ name: "PH", line: 2 }, { name: "call", line: 3 }]);
});

test("TI no shipped composition defines a helper the workflow engine provides", () => {
  const scripts = compositionScripts();
  assert.equal(scripts.length, 9);
  for (const f of scripts) assert.deepEqual(compositionBudget(f).helperDefinitions, [], f);
});

for (const f of ["gsd-execute.js", "gsd-plan.js"]) {
  test.skip(`TI ${f} stays within ${COMPOSITION_LINE_BUDGET} lines (THIN stage 2 enables this)`, () => {
    const { lines } = compositionBudget(f);
    assert.ok(lines <= COMPOSITION_LINE_BUDGET, `${f} has ${lines} lines; the budget is ${COMPOSITION_LINE_BUDGET}`);
  });
}
