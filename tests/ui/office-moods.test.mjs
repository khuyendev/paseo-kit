// Agent states like the original (step C): the store's latest shell call and tool counts, the test-run heuristic, the activity glyph,
// the beat-driven mood machine (needs you, waiting on shell with its escalation and celebration, idle dozing) and the generated names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_DERIVED, createStore, deriveTimeline, emptyState, reduce, snapshotOf } from "../../plugins/office/client/store.ts";
import { activityGlyph, isTestCommand } from "../../plugins/office/client/activity.ts";
import { CELEBRATE_BEATS, IDLE_DOZE_BEATS, SHELL_BORED_BEATS, SHELL_COBWEB_BEATS, SHELL_DOZE_BEATS, moodLook, moodSignature, stepMoods } from "../../plugins/office/client/moods.ts";
import { agentName, providerChip } from "../../plugins/office/client/names.ts";
import { AGENT_FIRST_NAMES, STRINGS, text } from "../../plugins/office/client/strings.ts";
import { SHELL_COMMAND_MAX_CHARS, TOOL_CALLS_WINDOW_MAX } from "../../plugins/office/client/limits.ts";
import { agentPayload, fakePaseo, flush, iso, workspacePayload } from "./fake-paseo.mjs";

const call = (callId, kind, status, extra = {}) => ({ type: "timeline", item: { type: "tool_call", callId, name: kind, status, error: null, detail: { type: kind, ...extra } } });

// ---- store

test("C derive: the latest shell call keeps its id, status and a clipped command; later updates of the same call change its status", () => {
  let d = deriveTimeline(EMPTY_DERIVED, call("c1", "shell", "running", { command: "npm test\u0007 --watch" }));
  assert.deepEqual(d.shell, { callId: "c1", status: "running", command: "npm test --watch" });
  d = deriveTimeline(d, call("r1", "read", "completed", { filePath: "/x" }));
  assert.equal(d.shell.callId, "c1", "a later call of another kind keeps the shell call");
  d = deriveTimeline(d, { type: "turn_started" });
  assert.equal(d.shell.status, "running", "the shell call outlives the turn");
  d = deriveTimeline(d, call("c1", "shell", "completed", {}));
  assert.deepEqual(d.shell, { callId: "c1", status: "completed", command: "npm test --watch" });
  d = deriveTimeline(d, call("c2", "shell", "weird", { command: "x".repeat(1000) }));
  assert.deepEqual([d.shell.callId, d.shell.status, d.shell.command.length <= SHELL_COMMAND_MAX_CHARS], ["c2", null, true], "an unreadable status is null (the state never shows)");
  assert.equal(deriveTimeline(EMPTY_DERIVED, call(null, "shell", "running", {})).shell, null, "no call id, no shell state");
});

test("C derive: tool calls are counted by kind over a bounded window of distinct call ids", () => {
  let d = EMPTY_DERIVED;
  for (const [id, kind] of [["a", "read"], ["a", "read"], ["b", "edit"], ["c", "shell"], ["c", "shell"], ["d", "read"]]) d = deriveTimeline(d, call(id, kind, "completed"));
  const counts = snapshotOf(reduce(reduce(reduce(emptyState(), { type: "agents.seed", entries: [{ agent: agentPayload("x") }] }), { type: "timeline.event", agentId: "x", event: call("q", "read", "running") }), { type: "timeline.event", agentId: "x", event: call("q", "read", "completed") })).agents[0].toolCounts;
  assert.deepEqual(counts, { read: 1 });
  assert.equal(d.calls.size, 4);
  for (let i = 0; i < TOOL_CALLS_WINDOW_MAX + 20; i++) d = deriveTimeline(d, call(`n${i}`, "search", "completed"));
  assert.equal(d.calls.size, TOOL_CALLS_WINDOW_MAX);
});

test("C store: an idle agent whose latest shell call still runs keeps its timeline subscription", async () => {
  const fake = fakePaseo({
    agents: [agentPayload("sh", { workspaceId: "w1", status: "running" })],
    workspaceEntries: [workspacePayload("w1")],
    timelines: { sh: [{ item: call("c9", "shell", "running", { command: "pytest -q" }).item, seqStart: 1 }] },
  });
  const store = createStore(fake);
  await store.start();
  for (let i = 0; i < 12; i++) await flush();
  assert.equal(store.getSnapshot().agents[0].shell.status, "running");
  const live = fake.liveSubscriptions();
  fake.emitAgent({ kind: "upsert", agent: agentPayload("sh", { workspaceId: "w1", status: "idle" }) });
  for (let i = 0; i < 12; i++) await flush();
  assert.equal(fake.liveSubscriptions(), live, "still subscribed while the shell runs");
  fake.emitTimeline("sh", { agentId: "sh", event: call("c9", "shell", "completed") });
  for (let i = 0; i < 12; i++) await flush();
  assert.equal(store.getSnapshot().agents[0].shell.status, "completed");
  assert.equal(fake.liveSubscriptions(), live - 1, "released once the shell is done");
  store.dispose();
});

// ---- heuristic and activity

test("C heuristic isTestCommand: common test runners are a test run; anything else or unreadable is not", () => {
  for (const cmd of ["npm test", "npm run test:unit", "pnpm test", "yarn test", "node --test tests/*.mjs", "pytest -q", "python -m pytest", "go test ./...", "cargo test", "npx vitest run", "jest --ci", "mvn test", "dotnet test", "bun test", "rspec spec", "phpunit", "make test", "cd x && npm test"]) {
    assert.equal(isTestCommand(cmd), true, cmd);
  }
  for (const cmd of ["npm install", "git status", "ls tests", "cat test.txt", "echo latest", "node build.mjs", "", null, 5, {}]) assert.equal(isTestCommand(cmd), false, String(cmd));
});

test("C activity glyph: the latest tool kind of a working agent, the tests glyph from the heuristic, thinking for reasoning", () => {
  const a = (over) => ({ status: "running", lastTool: null, activity: null, shell: null, ...over });
  assert.equal(activityGlyph(a({ lastTool: "read" })), "glyphRead");
  assert.equal(activityGlyph(a({ lastTool: "edit" })), "glyphEdit");
  assert.equal(activityGlyph(a({ lastTool: "write" })), "glyphEdit");
  assert.equal(activityGlyph(a({ lastTool: "shell", shell: { callId: "c", status: "running", command: "git log" } })), "glyphTerminal");
  assert.equal(activityGlyph(a({ lastTool: "shell", shell: { callId: "c", status: "running", command: "npm test" } })), "glyphTests");
  assert.equal(activityGlyph(a({ lastTool: "search" })), "glyphSearch");
  assert.equal(activityGlyph(a({ lastTool: "fetch" })), "glyphSearch");
  assert.equal(activityGlyph(a({ lastTool: "plan" })), "glyphPlan");
  assert.equal(activityGlyph(a({ activity: "reasoning", lastTool: "read" })), "glyphThinking");
  assert.equal(activityGlyph(a({ status: "idle", lastTool: "read" })), null);
  assert.equal(activityGlyph(null), null);
  for (const key of ["glyphRead", "glyphEdit", "glyphTerminal", "glyphTests", "glyphSearch", "glyphPlan", "glyphThinking"]) assert.ok(Object.hasOwn(STRINGS, key), key);
});

// ---- mood machine

const input = (agentId, over = {}) => ({ agentId, status: "idle", pendingPermissions: 0, requiresAttention: false, attentionReason: null, shell: null, lastTool: null, activity: null, moving: false, ...over });
const shellOf = (status, callId = "c1", command = "sleep 600") => ({ callId, status, command });

function run(book, inputs, from, to) {
  let celebrations = [];
  for (let beat = from; beat <= to; beat++) {
    const out = stepMoods(book, inputs, beat);
    book = out.book;
    celebrations = celebrations.concat(out.celebrations.map((c) => ({ ...c, beat })));
  }
  return { book, celebrations };
}

test("C moods: waiting on shell keeps the agent at its desk with an hourglass and escalates by beats, then celebrates when it finishes", () => {
  const waiting = [input("s", { shell: shellOf("running") })];
  let { book } = run(null, waiting, 0, 1);
  let look = moodLook(book.get("s"), waiting[0], 1);
  assert.deepEqual([look.kind, look.still, look.glyphs.includes("glyphHourglass"), look.glyphs.includes("glyphPopcorn"), look.pose], ["shell", true, true, true, "wait"]);
  look = moodLook(book.get("s"), waiting[0], SHELL_BORED_BEATS + 1);
  assert.deepEqual([look.pose, look.glyphs.includes("glyphPopcorn")], ["wait", false], "after 3 min: arms crossed");
  const spins = Array.from({ length: 40 }, (_, i) => moodLook(book.get("s"), waiting[0], SHELL_BORED_BEATS + 1 + i).spinDir).filter((d) => d !== null);
  assert.ok(spins.length > 0 && new Set(spins).size > 1, "spins in the chair now and then");
  look = moodLook(book.get("s"), waiting[0], SHELL_COBWEB_BEATS + 1);
  assert.ok(look.glyphs.includes("glyphCobweb"));
  look = moodLook(book.get("s"), waiting[0], SHELL_DOZE_BEATS + 1);
  assert.deepEqual([look.pose, look.glyphs.includes("glyphZzz")], ["sleep", true]);
  const done = [input("s", { shell: shellOf("completed") })];
  const out = stepMoods(book, done, SHELL_DOZE_BEATS + 2);
  assert.deepEqual(out.celebrations, [{ agentId: "s", callId: "c1" }]);
  look = moodLook(out.book.get("s"), done[0], SHELL_DOZE_BEATS + 3);
  assert.deepEqual([look.kind, look.pose], ["celebrate", "cheer"]);
  const later = run(out.book, done, SHELL_DOZE_BEATS + 3, SHELL_DOZE_BEATS + 3 + CELEBRATE_BEATS);
  assert.equal(later.celebrations.length, 0, "one celebration per call");
  assert.equal(moodLook(later.book.get("s"), done[0], SHELL_DOZE_BEATS + 4 + CELEBRATE_BEATS).kind, "idle");
  const failed = stepMoods(run(null, waiting, 0, 1).book, [input("s", { shell: shellOf("failed") })], 2);
  assert.deepEqual([failed.celebrations.length, moodLook(failed.book.get("s"), input("s"), 3).kind], [0, "failed"]);
});

test("C moods: a running shell of a working agent is not waiting; an unknown shell status never shows the state", () => {
  const book = run(null, [input("w", { status: "running", shell: shellOf("running"), lastTool: "shell" }), input("u", { shell: shellOf(null) })], 0, 3).book;
  assert.equal(moodLook(book.get("w"), input("w", { status: "running", lastTool: "shell", shell: shellOf("running") }), 3).kind, "working");
  assert.equal(moodLook(book.get("u"), input("u", { shell: shellOf(null) }), 3).kind, "idle");
  assert.equal(stepMoods(book, [input("w", { status: "idle", shell: shellOf("completed") })], 4).celebrations.length, 0, "no celebration without a wait");
});

test("C moods: needs you raises a blinking alert for a permission and a soft notice for finished or error", () => {
  const perm = input("p", { pendingPermissions: 1, status: "running" });
  const fin = input("f", { requiresAttention: true, attentionReason: "finished" });
  const book = stepMoods(null, [perm, fin], 0).book;
  const p = moodLook(book.get("p"), perm, 0);
  assert.deepEqual([p.kind, p.blink, p.soft, p.glyphs], ["permission", true, false, ["glyphAlert"]]);
  const f = moodLook(book.get("f"), fin, 0);
  assert.deepEqual([f.kind, f.blink, f.soft, f.glyphs], ["attention", false, true, ["glyphNotice"]]);
});

test("C moods: an idle agent dozes after IDLE_DOZE_BEATS at its seat and wakes on any change", () => {
  const idle = [input("i")];
  let { book } = run(null, idle, 0, IDLE_DOZE_BEATS - 1);
  assert.equal(moodLook(book.get("i"), idle[0], IDLE_DOZE_BEATS - 1).kind, "idle");
  const walking = stepMoods(book, [input("i", { moving: true })], IDLE_DOZE_BEATS).book;
  assert.equal(moodLook(walking.get("i"), input("i", { moving: true }), IDLE_DOZE_BEATS).kind, "idle", "not while it walks");
  book = stepMoods(walking, idle, IDLE_DOZE_BEATS + 1).book;
  const look = moodLook(book.get("i"), idle[0], IDLE_DOZE_BEATS + 1);
  assert.deepEqual([look.kind, look.pose, look.still, look.glyphs], ["doze", "sleep", true, ["glyphZzz"]]);
  book = stepMoods(book, [input("i", { status: "running" })], IDLE_DOZE_BEATS + 2).book;
  assert.equal(moodLook(book.get("i"), input("i", { status: "running" }), IDLE_DOZE_BEATS + 2).kind, "working");
  assert.equal(stepMoods(book, [], IDLE_DOZE_BEATS + 3).book.size, 0, "agents that left are dropped");
});

test("C moods: hostile input never throws and the signature changes only with what is drawn", () => {
  assert.doesNotThrow(() => stepMoods(null, [null, 5, { agentId: 7 }, input("ok", { shell: { callId: {}, status: [] } })], 0));
  assert.doesNotThrow(() => moodLook(undefined, null, NaN));
  const a = moodSignature(new Map([["x", moodLook(undefined, input("x"), 0)]]));
  assert.equal(a, moodSignature(new Map([["x", moodLook(undefined, input("x"), 5)]])));
  assert.notEqual(a, moodSignature(new Map([["x", moodLook(undefined, input("x", { pendingPermissions: 2 }), 0)]])));
});

// ---- names

test("C names: a deterministic name from the fixed list per agent id, and a provider chip from the first letter", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `agent-${i}-${"x".repeat(i % 7)}`);
  const names = ids.map(agentName);
  assert.deepEqual(names, ids.map(agentName), "deterministic");
  for (const name of names) assert.ok(AGENT_FIRST_NAMES.some((first) => name.startsWith(`${first} `)), name);
  assert.ok(new Set(names).size > 265, `unique-looking: ${new Set(names).size} of 300`);
  assert.equal(agentName("__proto__"), agentName("__proto__"));
  assert.equal(typeof agentName(null), "string");
  assert.deepEqual(providerChip("claude").letter, "C");
  assert.deepEqual(providerChip("codex").letter, "C");
  assert.notEqual(providerChip("claude").color, providerChip("codex").color);
  assert.equal(providerChip(null), null);
  assert.equal(providerChip("  "), null);
  assert.equal(providerChip("\u0007z").letter, "Z");
  assert.ok(text("agentNameFormat", { first: "Ada", initial: "K" }).includes("Ada"));
});
