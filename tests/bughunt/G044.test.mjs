// Bug-hunt fix G044: the standalone gsd-plan-review workflow is documented with its arguments, its research default and
// the source-grounding lens that always runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { KIT_DIR, SHIP_DIR } from "../helpers/temp.mjs";

// Line endings depend on the checkout (core.autocrlf on Windows); these checks compare text, not bytes.
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const planSkill = read(path.join(SHIP_DIR, ".claude", "skills", "gsd-plan", "SKILL.md"));
const script = read(path.join(SHIP_DIR, ".agents", "workflows", "gsd-plan-review.js"));
const interfaces = read(path.join(KIT_DIR, "docs", "INTERFACES.md"));
const standalone = /### Standalone plan review[\s\S]*?(?=\n##|$)/.exec(planSkill)?.[0] ?? "";
const row = (name) => interfaces.split("\n").find((l) => l.startsWith(`| \`${name}\``));

test("G044 the gsd-plan skill documents the standalone plan review: invocation, arguments and the research default", () => {
  assert.ok(standalone, "gsd-plan SKILL.md has a standalone plan review section");
  assert.match(standalone, /--name gsd-plan-review --args-file/);
  assert.match(standalone, /"phaseDir": ".planning\/phases\/02-api", "plans": \["02-01", "02-02"\]/);
  assert.match(standalone, /`roles /);
  assert.match(standalone, /`researchPath`/);
  assert.match(standalone, /Without `researchPath` no RESEARCH\.md is read/);
});

test("G044 the documented plan id format is the one the workflow filters on", () => {
  assert.ok(script.includes("/^\\d+(\\.\\d+)?-\\d+$/"), "gsd-plan-review.js still filters plan ids by NN-MM");
  assert.match(standalone, /`NN-MM`/);
});

test("G044 the always-on source-grounding lens is named by the skill and by the config reference", () => {
  assert.match(standalone, /source-grounding/);
  assert.match(standalone, /always runs/);
  assert.ok(row("review_lenses"), "INTERFACES.md has the review_lenses row");
  assert.match(row("review_lenses"), /source-grounding/);
  assert.ok(row("plan_review"), "INTERFACES.md has the plan_review row");
  assert.match(row("plan_review"), /source-grounding/);
});
