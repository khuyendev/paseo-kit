// G026: the checker's research-resolution dimension must not demand an edit to RESEARCH.md, which the revising planner may not make.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";

const CHECKER = path.join(SHIP_DIR, ".agents", "agents", "gsd-plan-checker.md");
// Line endings depend on the checkout (core.autocrlf on Windows); these checks compare text, not bytes.
const dimension11 = () => {
  const text = fs.readFileSync(CHECKER, "utf8").replace(/\r\n/g, "\n");
  return /## Dimension 11:[\s\S]*?(?=\n## Dimension 12:)/.exec(text)[0];
};

test("G026 dimension 11 lets a plan resolve a research question and never asks for a RESEARCH.md edit", () => {
  const d = dimension11();
  assert.match(d, /plan[^\n]*\banswer|\banswer[^\n]*\bplan/i, "a plan that states the answer resolves the question");
  assert.match(d, /(not|never) edit RESEARCH\.md|may not (write|edit) RESEARCH\.md/, "the fix leaves RESEARCH.md alone");
  assert.doesNotMatch(d, /Resolve questions and mark section/, "no fix_hint asks for a RESEARCH.md edit");
  assert.doesNotMatch(d, /RESEARCH\.md carries no unresolved open question/, "the required property is reachable inside the planner's grant");
});
