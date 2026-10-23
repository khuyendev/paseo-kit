// F52 (kit feedback #52): ph context --self prints the compact reminder threshold and the tokens left before the next reminder,
// so the owner and the orchestrator can tell whether a reminder is due.
import assert from "node:assert/strict";
import test from "node:test";
import { assertExit, assertLine, assertNoLine } from "../helpers/assert.mjs";
import { CALLER, addSub, setup } from "../ph/setup.mjs";

test("F52 context --self prints the compact reminder threshold and the tokens to the next reminder", async () => {
  const s = setup();
  s.fake.agents.get(CALLER).lastUsage = { contextWindowUsedTokens: 10, contextWindowMaxTokens: 100 };
  const r = await s.ph(["context", "--self"]);
  assertExit(r, 0);
  assertLine(r, /^c0ffee00   10% 10\/100 idle leader$/);
  assertLine(r, "compact reminder at 60% (next in 50 tokens)");
});

test("F52 the reminder line follows the band the guard would be in, and the reported window", async () => {
  const s = setup();
  s.fake.agents.get(CALLER).lastUsage = { contextWindowUsedTokens: 70, contextWindowMaxTokens: 100 };
  assertLine(await s.ph(["context", "--self"]), "compact reminder at 60% (next in 5 tokens)");
  s.fake.agents.get(CALLER).lastUsage = { contextWindowUsedTokens: 580000, contextWindowMaxTokens: 1000000 };
  assertLine(await s.ph(["context", "--self"]), "compact reminder at 60% (next in 20000 tokens)");
});

test("F52 the reminder line uses the overlay start_pct, and says so when no usage is reported", async () => {
  const o = setup({ overlay: { context_guard: { window_tokens: 1000000, start_pct: 45, step_pct: 5 } } });
  o.fake.agents.get(CALLER).lastUsage = { contextWindowUsedTokens: 10, contextWindowMaxTokens: 100 };
  assertLine(await o.ph(["context", "--self"]), "compact reminder at 45% (next in 35 tokens)");
  const n = setup();
  assertLine(await n.ph(["context", "--self"]), "compact reminder at 60% (usage not reported yet)");
});

test("F52 the reminder line is only for --self", async () => {
  const s = setup();
  s.fake.agents.get(CALLER).lastUsage = { contextWindowUsedTokens: 10, contextWindowMaxTokens: 100 };
  addSub(s.fake, { title: "worker", lastUsage: { contextWindowUsedTokens: 20, contextWindowMaxTokens: 100 } });
  const r = await s.ph(["context"]);
  assertExit(r, 0);
  assertNoLine(r, /compact reminder/);
});
