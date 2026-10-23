// G201: the ph skill's cap guidance must say which cap queues. Only max_subagents queues a workflow call; a
// max_live_subagents refusal is cleared by archiving idle agents.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";

const SKILL = fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", "ph", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
const CAP_START = SKILL.indexOf("A cap refusal");
const CAP_GUIDANCE = SKILL.slice(CAP_START, SKILL.indexOf("\n\n", CAP_START)).replace(/\n/g, " ");
const SENTENCES = CAP_GUIDANCE.split(/\.\s+/);

test("G201 the cap guidance names both caps and says each cap's own remedy", () => {
  assert.notEqual(CAP_START, -1, "the cap refusal paragraph is missing");
  assert.ok(CAP_GUIDANCE.includes("max_subagents"), "max_subagents is not named");
  assert.ok(CAP_GUIDANCE.includes("max_live_subagents"), "max_live_subagents is not named");
  assert.ok(CAP_GUIDANCE.includes("ph archive --idle"), "the idle-archive remedy is missing");
});

test("G201 only the max_subagents cap is said to queue a workflow call", () => {
  const queuing = SENTENCES.filter((s) => /queue/i.test(s));
  assert.ok(queuing.length > 0, "no sentence says the workflow queues");
  for (const s of queuing) {
    assert.ok(s.includes("max_subagents"), `a queue claim does not name max_subagents: ${s}`);
    assert.doesNotMatch(s, /max_live_subagents/, `a queue claim names max_live_subagents: ${s}`);
  }
});

test("G201 the max_live_subagents sentence does not offer a workflow as the fallback", () => {
  const live = SENTENCES.filter((s) => s.includes("max_live_subagents"));
  assert.ok(live.length > 0, "no sentence covers max_live_subagents");
  for (const s of live) {
    assert.doesNotMatch(s, /workflow|queue/i, `the live-cap sentence offers a workflow: ${s}`);
    assert.match(s, /ph archive --idle/, `the live-cap sentence does not say to archive idle agents: ${s}`);
  }
});
