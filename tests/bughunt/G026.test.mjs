// G026: the checker's research-resolution dimension must not demand an edit to RESEARCH.md, which the revising planner may not make.
// The upstream role text stays generated and unchanged (GSDC-47); the kit overlay, loaded after it, carries the rule.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";

const OVERLAY = path.join(SHIP_DIR, ".agents", "gsd", "overlays", "gsd-plan-checker.md");
// Line endings depend on the checkout (core.autocrlf on Windows); these checks compare text, not bytes.
const dimension11 = () => {
  const text = fs.readFileSync(OVERLAY, "utf8").replace(/\r\n/g, "\n");
  return text.split("\n").find((l) => l.includes("Research Resolution (Dimension 11)")) ?? "";
};

test("G026 dimension 11 lets a plan resolve a research question and never asks for a RESEARCH.md edit", () => {
  const d = dimension11();
  assert.match(d, /plan[^\n]*\banswer|\banswer[^\n]*\bplan/i, "a plan that states the answer resolves the question");
  assert.match(d, /may not edit RESEARCH\.md/, "the fix leaves RESEARCH.md alone");
  assert.match(d, /never for a RESEARCH\.md edit/, "no fix_hint asks for a RESEARCH.md edit");
  assert.match(d, /resolved in RESEARCH\.md or answered in a plan/, "the required property is reachable inside the planner's grant");
});
