// G208: the watchdog counts identical calls since the last prompt (a write resets the count), not only consecutive
// ones, so the ph skill row for watchdog_repeat_calls must not say "in a row".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SHIP_DIR } from "../helpers/temp.mjs";

const SKILL = path.join(SHIP_DIR, ".claude", "skills", "ph", "SKILL.md");
const row = () => fs.readFileSync(SKILL, "utf8").split("\n").find((l) => l.includes("`watchdog_repeat_calls`"));

test("G208 the ph skill counts repeat calls since the last prompt, not in a row", () => {
  const line = row();
  assert.ok(line, "watchdog_repeat_calls row in the ph skill");
  assert.doesNotMatch(line, /identical tool calls in a row/);
  assert.match(line, /since the last prompt/);
  assert.match(line, /a write resets the count/);
});
