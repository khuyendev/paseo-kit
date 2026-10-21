// HUD (step D): the extra top bar counters, the activity feed, search, the drawer stats and the camera helpers (next request, agent
// target, the foot of a walking character for Follow). Pure modules only; the screen behaviour is tested in office-scene.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBuilding } from "../../plugins/office/shared/layout/building.ts";
import { EMPTY_FEED, feedDrafts, feedRows, pushFeed, relativeTime } from "../../plugins/office/client/feed.ts";
import { agentTarget, journeyFootAt, nextRequest, searchAgents } from "../../plugins/office/client/hud.ts";
import { drawerModel } from "../../plugins/office/client/drawer-model.ts";
import { topbarModel } from "../../plugins/office/client/topbar-model.ts";
import { projectList } from "../../plugins/office/client/sidebar-model.ts";
import { agentName } from "../../plugins/office/client/names.ts";
import { FEED_MAX, SEARCH_RESULTS_MAX } from "../../plugins/office/client/limits-panels.ts";
import { SCENE_BEAT_MS } from "../../plugins/office/client/camera.ts";
import { STRINGS } from "../../plugins/office/client/strings.ts";

const agent = (id, over = {}) => ({
  id, title: `Agent ${id}`, projectId: "p1", workspaceId: "w1", parentAgentId: null, status: "idle", requiresAttention: false, attentionReason: null,
  pendingPermissions: 0, provider: "claude", model: "opus", contextUsedTokens: null, contextMaxTokens: null, costUsd: null, lastError: null, lastTool: null,
  activity: null, todos: [], runId: null, updatedAt: null, createdAt: null, shell: null, toolCounts: {}, ...over,
});
const snap = (agents, over = {}) => ({
  projects: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
  workspaces: [{ id: "w1", projectId: "p1", name: "main", kind: "worktree", status: "running", diffAdditions: 12, diffDeletions: 3 }, { id: "w2", projectId: "p2", name: "side", kind: null, status: "done", diffAdditions: null, diffDeletions: null }],
  agents,
  departing: [],
  ...over,
});

// ---- top bar

test("D top bar: rooms, agents, sub-agents and shells running join the state counters; the usage slot stays empty", () => {
  const s = snap([
    agent("a", { status: "running" }),
    agent("k", { parentAgentId: "a" }),
    agent("w", { status: "idle", shell: { callId: "c", status: "running", command: "sleep 9" } }),
    agent("x", { status: "running", shell: { callId: "d", status: "running", command: "sleep 9" } }),
  ]);
  const bar = topbarModel(s, null, 2);
  assert.deepEqual([bar.counters.rooms, bar.counters.total, bar.counters.subAgents, bar.counters.shells, bar.counters.running], [2, 4, 1, 1, 2]);
  assert.equal(bar.usageSlot, null);
  assert.equal(topbarModel(s, null).counters.rooms, 0);
});

// ---- feed

test("D feed: store changes become events (spawn, finished, permission, error, shell, archived); the first snapshot gives none", () => {
  const before = snap([agent("a", { status: "running" }), agent("b"), agent("c", { status: "idle", shell: { callId: "s1", status: "running", command: "x" } }), agent("d", { status: "running" })]);
  assert.deepEqual(feedDrafts(null, before), []);
  const after = snap(
    [agent("a", { status: "idle" }), agent("b", { pendingPermissions: 1 }), agent("c", { status: "idle", shell: { callId: "s1", status: "completed", command: "x" } }), agent("n", { projectId: "p2" }), agent("d", { status: "error" })],
    { departing: [agent("gone")] },
  );
  const drafts = feedDrafts(before, after);
  assert.deepEqual(drafts.map((d) => [d.kind, d.agentId]).sort(), [["archived", "gone"], ["error", "d"], ["finished", "a"], ["permission", "b"], ["shell", "c"], ["spawn", "n"]].sort());
  assert.equal(drafts.find((d) => d.kind === "spawn").projectId, "p2");
  assert.deepEqual(feedDrafts(after, after), [], "no change, no event");
  assert.doesNotThrow(() => feedDrafts({ agents: 5 }, { agents: [null, { id: 3 }] }));
});

test("D feed: newest first, bounded to FEED_MAX, filtered to the visible projects, with a relative time from the beat", () => {
  let feed = EMPTY_FEED;
  for (let i = 0; i < FEED_MAX + 15; i++) feed = pushFeed(feed, [{ kind: "finished", agentId: `a${i}`, projectId: i % 2 ? "p2" : "p1" }], i);
  assert.equal(feed.entries.length, FEED_MAX);
  assert.equal(feed.entries[0].agentId, `a${FEED_MAX + 14}`);
  const beat = FEED_MAX + 14;
  const rows = feedRows(feed, new Set(["p2"]), beat);
  assert.ok(rows.length > 0 && rows.every((r) => r.agentId.match(/\d+$/)[0] % 2 === 0), "p2 hidden");
  assert.deepEqual([rows[0].kindKey, rows[0].name, rows[0].when.key], ["feedFinished", agentName(rows[0].agentId), "timeNow"]);
  const minute = Math.round(60000 / SCENE_BEAT_MS);
  assert.deepEqual(relativeTime(0), { key: "timeNow", count: 0 });
  assert.equal(relativeTime(Math.round(20000 / SCENE_BEAT_MS)).key, "timeSeconds");
  assert.deepEqual(relativeTime(minute * 3), { key: "timeMinutes", count: 3 });
  assert.equal(relativeTime(minute * 120).key, "timeHours");
  assert.deepEqual(relativeTime(NaN), { key: "timeNow", count: 0 });
  for (const row of rows) assert.ok(Object.hasOwn(STRINGS, row.kindKey) && Object.hasOwn(STRINGS, row.when.key));
});

// ---- search and camera helpers

test("D search: projects filter by name; agents are found by generated name or title in the visible projects, capped", () => {
  const s = snap([agent("a", { title: "Fix the login" }), agent("b", { title: "Docs" }), agent("c", { title: "login page", projectId: "p2", workspaceId: "w2" })]);
  const building = buildBuilding([{ id: "p1", slot: 0, seed: 1 }, { id: "p2", slot: 1, seed: 2 }]);
  assert.deepEqual(projectList(s, new Set(), building, 50, "tw").rows.map((r) => r.projectId), ["p2"]);
  assert.deepEqual(projectList(s, new Set(), building, 50, "").rows.length, 2);
  assert.deepEqual(searchAgents(s, "LOGIN", new Set(), SEARCH_RESULTS_MAX).map((r) => r.agentId), ["a", "c"]);
  assert.deepEqual(searchAgents(s, "login", new Set(["p2"]), SEARCH_RESULTS_MAX).map((r) => r.agentId), ["a"]);
  const byName = agentName("b").split(" ")[0];
  assert.ok(searchAgents(s, byName.toLowerCase(), new Set(), SEARCH_RESULTS_MAX).some((r) => r.agentId === "b"));
  assert.deepEqual(searchAgents(s, "  ", new Set(), SEARCH_RESULTS_MAX), []);
  const many = snap(Array.from({ length: 30 }, (_, i) => agent(`m${i}`, { title: "same" })));
  assert.equal(searchAgents(many, "same", new Set(), SEARCH_RESULTS_MAX).length, SEARCH_RESULTS_MAX);
  assert.doesNotThrow(() => searchAgents(null, "x", null, 3));
  const t = agentTarget(s.agents[0], building);
  assert.deepEqual([t.scope, t.agentId, t.roomId, t.workspaceId], ["agent", "a", "p1", "w1"]);
  assert.equal(agentTarget({ id: "z", projectId: "ghost", workspaceId: null }, building).rect.w, building.rect.w);
});

test("D next request: cycles over the agents that need the owner, in snapshot order, after the current one", () => {
  const s = snap([agent("a"), agent("b", { pendingPermissions: 2 }), agent("c"), agent("d", { requiresAttention: true, attentionReason: "finished" })]);
  assert.equal(nextRequest(s, null), "b");
  assert.equal(nextRequest(s, "b"), "d");
  assert.equal(nextRequest(s, "d"), "b");
  assert.equal(nextRequest(s, "c"), "d");
  assert.equal(nextRequest(snap([agent("a")]), null), null);
  assert.equal(nextRequest(null, null), null);
});

test("D follow: the foot of a walking character at a time along its journey, clamped to its ends", () => {
  const plan = { from: { x: 0, y: 0 }, to: { x: 3, y: 0 }, startPx: { x: 8, y: 11 }, segments: [{ x: 56, y: 11, dir: "right", tiles: 3, ms: 900 }], tiles: 3, totalMs: 900, lastDir: "right" };
  const journey = { steps: [{ kind: "wait", ms: 100, pose: "stand", dir: "down" }, { kind: "walk", plan, run: false }], startTile: { x: 0, y: 0 }, startDir: "down", endTile: { x: 3, y: 0 }, endDir: "right", totalMs: 1000 };
  assert.deepEqual(journeyFootAt(journey, 0), { x: 8, y: 11 });
  assert.deepEqual(journeyFootAt(journey, 550), { x: 32, y: 11 });
  assert.deepEqual(journeyFootAt(journey, 99999), { x: 56, y: 11 });
  assert.equal(journeyFootAt(null, 5), null);
  assert.deepEqual(journeyFootAt({ steps: [], startTile: { x: 1, y: 1 } }, 5), null);
});

// ---- drawer stats

test("D drawer stats: name and chip, tokens with a bar, model, provider, session, lines, tool calls by kind, cost and age", () => {
  const now = Date.parse("2026-10-21T10:00:00.000Z");
  const s = snap([agent("a", { contextUsedTokens: 50_000, contextMaxTokens: 200_000, costUsd: 1.234, createdAt: new Date(now - 125 * 60000).toISOString(), toolCounts: { read: 3, shell: 7, edit: 1 } })]);
  const m = drawerModel(s, "a", now);
  assert.equal(m.name, agentName("a"));
  assert.deepEqual(m.chip.letter, "C");
  assert.deepEqual(m.tokens, { used: 50_000, max: 200_000, percent: 25 });
  assert.deepEqual([m.workspaceName, m.workspaceKindKey], ["main", "kindWorktree"]);
  assert.deepEqual(m.diff, { additions: 12, deletions: 3 });
  assert.deepEqual(m.toolCalls, [{ key: "toolShell", count: 7 }, { key: "toolRead", count: 3 }, { key: "toolEdit", count: 1 }]);
  assert.equal(m.cost, "$1.23");
  assert.deepEqual(m.age, { key: "ageHours", count: 2 });
  const bare = drawerModel(snap([agent("b", { provider: null, workspaceId: "nope" })]), "b");
  assert.deepEqual([bare.chip, bare.tokens, bare.workspaceName, bare.diff, bare.toolCalls, bare.cost, bare.age], [null, null, null, null, [], null, null]);
  assert.doesNotThrow(() => drawerModel(snap([agent("h", { toolCounts: { bogus: 5, read: "x" }, costUsd: -3, createdAt: "never" })]), "h", now));
  assert.deepEqual(drawerModel(snap([agent("h", { toolCounts: { bogus: 5, read: "x" } })]), "h", now).toolCalls, []);
});
