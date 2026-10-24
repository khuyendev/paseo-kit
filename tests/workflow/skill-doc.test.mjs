// The ph skill (code-ph) documents the workflow runtime; these checks run once its folder exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SHIP_DIR } from "../helpers/temp.mjs";

const SKILL = path.join(SHIP_DIR, ".claude", "skills", "ph");
const present = fs.existsSync(SKILL);
const skip = present ? false : "ship/.claude/skills/ph not written yet (code-ph)";
const text = () => fs.readdirSync(SKILL, { recursive: true }).filter((f) => f.endsWith(".md")).map((f) => fs.readFileSync(path.join(SKILL, f), "utf8")).join("\n");
const defaults = () => JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));

test("FLOW-22 the ph skill lists every log line type", { skip }, () => {
  const t = text();
  for (const kind of ["workflow start", "phase", "log warning:", "log nested workflow", "log watchdog:", "agent start", "agent prompt", "agent done", "agent cached", "shell start", "shell done", "workflow done", "workflow failed"]) assert.ok(t.includes(kind), kind);
});

test("FLOW-38 every watchdog number in the ph skill equals the shipped default", { skip }, () => {
  const t = text();
  const d = defaults();
  for (const key of ["agent_nudge_s", "agent_stop_s", "agent_tool_stuck_s", "agent_file_tool_stuck_s", "watchdog_repeat_calls", "watchdog_same_file_reads", "watchdog_reads_without_write", "agent_silent_s"]) {
    const m = new RegExp(`${key}\\W+?(\\d+)`).exec(t);
    assert.ok(m, `${key} not in the skill`);
    assert.equal(Number(m[1]), d[key], key);
  }
});

test("FLOW-44 the ph skill states the kit authoring rules and links the recipes", { skip }, () => {
  const t = text();
  for (const re of [/workflow-recipes\.md/, /\.filter\(Boolean\)/, /pipeline/, /opts\.phase|phase:/, /journal\.jsonl/, /--resume/, /args/]) assert.match(t, re);
  assert.ok(!/fsbatch/.test(t));
});

test("FLOW-45 the ph skill states the consent rule and the main-provider deny", { skip }, () => {
  const t = text();
  assert.match(t, /owner asked|asked for (a|one) workflow/i);
  assert.match(t, /Agent.{0,40}Workflow|Workflow.{0,40}Agent/);
  assert.ok(!/SendMessage[^.\n]*denied on (the )?main/i.test(t));
});

test("FLOW-49 the ph skill states the five trusted-code limits", { skip }, () => {
  const t = text();
  for (const re of [/trusted/i, /not a security boundary|no(t a)? sandbox/i, /shell\(\)/, /busy loop/i, /overshoot/i]) assert.match(t, re);
});
