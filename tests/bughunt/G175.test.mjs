import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageTracker } from "../../ship/.agents/harness/paseo-client/usage.mjs";
import { resultJson } from "../../ship/.agents/harness/runtime/result.mjs";
import { runtime } from "../../ship/.agents/harness/workflow/runtime-bridge.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";

// claude-haiku-5-5 (model-prices.json): $0.10 / $0.50 per 1M tokens up to 100k context, $0.50 / $2.50 above it.
const MODEL = "claude-haiku-5-5";
const LONG_TURN = { inputTokens: 100000, cachedInputTokens: 0, outputTokens: 10000, contextWindowUsedTokens: 120000 };
const SHORT_TURN = { inputTokens: 10000, cachedInputTokens: 0, outputTokens: 5000, contextWindowUsedTokens: 30000 };
// LONG_TURN: 100k x $0.50 + 10k x $2.50 = $0.075; SHORT_TURN: 10k x $0.10 + 5k x $0.50 = $0.0035.

async function trackedTurns(turns) {
  const client = { on() {}, observeTimeline: () => ({ ready: Promise.resolve() }) };
  const usage = new UsageTracker(client, createFakeClock());
  await usage.track(["a1"]);
  turns.forEach((u, seq) => usage.onEvent({ agentId: "a1", seq, event: { type: "turn_completed", turnId: `t${seq}`, usage: u } }));
  return usage;
}

async function resultOf(turns) {
  const usage = await trackedTurns(turns);
  const session = { root: SHIP_DIR, usage, replyText: async () => "", timeline: async () => ({ entries: [], hasOlder: false }) };
  const agent = { id: "a1", provider: "circle", model: MODEL, status: "idle", title: null, lastUsage: turns.at(-1) };
  return resultJson(session, agent);
}

test("G175 ph result prices a call's turns each with its own context (long turn first)", async () => {
  const r = await resultOf([LONG_TURN, SHORT_TURN]);
  assert.equal(r.tokens.turns, 2);
  assert.equal(r.costUsd, 0.0785);
});

test("G175 ph result prices a call's turns each with its own context (long turn last)", async () => {
  const r = await resultOf([SHORT_TURN, LONG_TURN]);
  assert.equal(r.costUsd, 0.0785);
});

test("G175 ph result keeps the plain sum when no turn passes the threshold", async () => {
  const r = await resultOf([SHORT_TURN, SHORT_TURN]);
  assert.equal(r.costUsd, 0.007);
});

test("G175 the runner's call cost prices each turn with its own context", async () => {
  const usage = await trackedTurns([LONG_TURN, SHORT_TURN]);
  const turns = usage.perTurnOf("a1");
  assert.equal(runtime.listPriceCost(SHIP_DIR, MODEL, turns), 0.0785);
  // Only the turns after a base snapshot belong to a call (the runner slices them).
  assert.equal(runtime.listPriceCost(SHIP_DIR, MODEL, turns.slice(1)), 0.0035);
});
