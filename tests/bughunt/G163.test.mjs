import { test } from "node:test";
import assert from "node:assert/strict";
import { runSummary } from "../../ship/.agents/harness/workflow/cmd-run-stats.mjs";

const info = { status: "done", startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T10:01:40.000Z" };
const NOW = Date.parse("2026-10-20T10:05:00.000Z");

// A call refused before any agent existed (unknown model, rejected label, transport down): no agentId, no usage.
const refused = { n: 1, label: "bad-model", agentId: null, status: "null", reason: "unknown model 'nope'", tokens: 0, usage: null, duration_s: 0 };
const queued = { n: 2, label: "queued", agentId: null, status: "null", reason: "label rejected", tokens: 0, usage: null, duration_s: 0 };
const ok = { n: 3, label: "plan:good", agentId: "a3", status: "ok", duration_s: 10, tokens: 5, usage: { input: 100, cachedInput: 0, output: 5, costUsd: 0.02 } };
// An agent was created and then returned null without usage: its cost is unknown, so the total is $?.
const agentNull = { n: 4, label: "plan:broken", agentId: "a4", status: "null", reason: "no reply", tokens: 0, usage: null, duration_s: 25 };

// The roles header still lists refused calls by label (G158 pins the label fallback); only cost and agent time skip them.
test("G163 a call that never created an agent adds no cost and no agent time", () => {
  assert.deepEqual(runSummary("wf_g", info, [refused, queued, ok], NOW), [
    "wf_g [bad-model -, queued -, plan -] status done",
    "wall 100 s; agents 1: median 10 s, slowest 10 s; tokens in 100 cached 0 out 5; cost $0.02",
  ]);
});

test("G163 a run whose calls all refused before any agent costs $0 with no agent time", () => {
  assert.deepEqual(runSummary("wf_r", info, [refused, queued], NOW), [
    "wf_r [bad-model -, queued -] status done",
    "wall 100 s; agents 0: median 0 s, slowest 0 s; tokens in 0 cached 0 out 0; cost $0",
  ]);
});

test("G163 an agent-created null with unknown usage still makes the cost $?", () => {
  assert.deepEqual(runSummary("wf_a", info, [refused, ok, agentNull], NOW), [
    "wf_a [bad-model -, plan -] status done",
    "wall 100 s; agents 2: median 17.5 s, slowest 25 s; tokens in 100 cached 0 out 5; cost $?",
  ]);
});
