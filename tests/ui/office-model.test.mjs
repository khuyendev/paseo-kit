import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildModel, resolveHandoff, workspaceLight } from "../../plugins/office/client/model.ts";
import {
  AGENTS_PER_CLUSTER_MAX,
  CLUSTERS_PER_ROOM_MAX,
  HANDOFF_QUEUE_MAX,
  ID_MAX_CHARS,
  LIST_PAGES_MAX,
  LIST_PAGE_LIMIT,
  MAX_DRAWN_CHARACTERS,
  ROOMS_PER_BUILDING_MAX,
  SPRITE_CALLS_IN_FLIGHT_MAX,
  SPRITE_STORE_KEYS_MAX,
  STORE_ENTRIES_MAX,
  TIMELINE_TAIL_LIMIT,
  TIMELINE_TODO_PAGES_MAX,
  TIMELINE_TODO_PAGE_LIMIT,
  TITLE_MAX_CHARS,
  TODOS_PER_AGENT_MAX,
} from "../../plugins/office/client/limits.ts";
import { createSpriteStore } from "../../plugins/office/client/sprite-store.ts";
import {
  HANDOFF_SIGNAL,
  createStore,
  deriveTimeline,
  emptyState,
  normalizeAgent,
  normalizeProject,
  normalizeWorkspace,
  reduce,
  snapshotOf,
} from "../../plugins/office/client/store.ts";
import { SPRITE_KEYS_PER_CALL_MAX, spriteKey } from "../../plugins/office/shared/sprites-rpc.ts";
import { KIT_DIR } from "../helpers/temp.mjs";
import { agentPayload, agentRemove, agentUpsert, fakePaseo, flush, iso, projectPayload, streamEvent, toolEntry, workspacePayload } from "./fake-paseo.mjs";

const PARENT = "paseo.parent-agent-id";
const EMPTY = { lastTool: null, activity: null, todos: [], todoSeen: false, lastError: null };
const kid = (id, parent, over = {}) => agentPayload(id, { labels: { [PARENT]: parent }, ...over });
const upsert = (agent) => ({ type: "agent.update", payload: agentUpsert(agent) });
const seedAgents = (...agents) => ({ type: "agents.seed", entries: agents.map((agent) => ({ agent })) });
const toolItem = (kind) => ({ type: "timeline", item: { type: "tool_call", detail: { type: kind } } });
const todoItem = (texts) => ({ type: "timeline", item: { type: "todo", items: texts.map((text) => ({ text, completed: false })) } });
const toolEvent = (seq, kind) => ({ item: { type: "tool_call", detail: { type: kind } }, timestamp: iso(seq), seqStart: seq });
const todoEntry = (seq, ...texts) => ({ item: { type: "todo", items: texts.map((text) => ({ text, completed: false })) }, timestamp: iso(seq), seqStart: seq });

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// Drains the store's microtasks and the fake's setImmediate-based reads.
async function settleAll(rounds = 14) {
  for (let i = 0; i < rounds; i++) await flush();
}

// ===== Task 1: pure store core =====

test("OFFC-21 signals: normalizeAgent reads the chosen set and nothing else", () => {
  const full = agentPayload("a1", {
    workspaceId: "w1",
    labels: { [PARENT]: "p1", "harness.run": "run-7" },
    status: "running",
    requiresAttention: true,
    attentionReason: "permission",
    pendingPermissions: [{ id: 1 }, { id: 2 }],
    provider: "circle-agent",
    model: "m1",
    lastUsage: { contextWindowUsedTokens: 50, contextWindowMaxTokens: 200 },
    lastError: "boom",
    cwd: "C:/secret/path",
    prompt: "secret prompt",
  });
  assert.deepEqual(normalizeAgent(full), {
    id: "a1",
    title: "agent a1",
    workspaceId: "w1",
    parentAgentId: "p1",
    status: "running",
    requiresAttention: true,
    attentionReason: "permission",
    pendingPermissions: 2,
    provider: "circle-agent",
    model: "m1",
    contextUsedTokens: 50,
    contextMaxTokens: 200,
    lastError: "boom",
    runId: "run-7",
    updatedAt: iso(0),
  });
  assert.doesNotMatch(JSON.stringify(normalizeAgent(full)), /secret/);
  assert.deepEqual(normalizeAgent({ id: "x", status: "idle" }), {
    id: "x",
    title: null,
    workspaceId: null,
    parentAgentId: null,
    status: "idle",
    requiresAttention: false,
    attentionReason: null,
    pendingPermissions: 0,
    provider: null,
    model: null,
    contextUsedTokens: null,
    contextMaxTokens: null,
    lastError: null,
    runId: null,
    updatedAt: null,
  });
});

test("OFFC-21 signals: hostile and partial agent payloads never throw", () => {
  for (const bad of [null, undefined, 5, "x", [], [{ id: "a" }], {}, { id: "" }, { id: 5, status: "idle" }, { id: "x".repeat(ID_MAX_CHARS + 1), status: "idle" }, { id: "a", status: "weird" }, { id: "a" }]) {
    assert.equal(normalizeAgent(bad), null, JSON.stringify(bad)?.slice(0, 40));
  }
  assert.equal(normalizeAgent({ id: "a", status: "idle", archivedAt: iso(1) }), "archived");
  assert.equal(normalizeAgent({ id: "a", status: "weird", archivedAt: iso(1) }), "archived");
  assert.equal(normalizeAgent({ id: "a", status: "idle", labels: { [PARENT]: "a" } }).parentAgentId, null);
  for (const max of [0, -3, Infinity, NaN, "9"]) assert.equal(normalizeAgent({ id: "a", status: "idle", lastUsage: { contextWindowMaxTokens: max } }).contextMaxTokens, null);
  const title = normalizeAgent({ id: "a", status: "idle", title: `line\nbreak\u0000${"x".repeat(10000)}` }).title;
  assert.ok(title.length <= TITLE_MAX_CHARS);
  assert.doesNotMatch(title, /[\u0000-\u001f\u007f]/);
  assert.equal(normalizeAgent({ id: "a", status: "idle", labels: JSON.parse('{"__proto__": {"x": 1}}') }).parentAgentId, null);
  assert.equal(normalizeAgent({ id: "__proto__", status: "idle" }).id, "__proto__");
  assert.equal(normalizeAgent({ id: "a", status: "idle", pendingPermissions: new Array(500).fill(0) }).pendingPermissions, 99);
});

test("OFFC-21 signals: normalizeWorkspace and normalizeProject map kind, status, diff and names", () => {
  const ws = normalizeWorkspace(workspacePayload("w1", { workspaceKind: "worktree", diffStat: { additions: 4, deletions: 2 }, status: "needs_input", name: `n\n${"x".repeat(500)}` }));
  assert.equal(ws.kind, "worktree");
  assert.deepEqual([ws.status, ws.diffAdditions, ws.diffDeletions, ws.projectDisplayName], ["needs_input", 4, 2, "proj"]);
  assert.ok(ws.name.length <= 80);
  assert.doesNotMatch(ws.name, /\n/);
  assert.equal(normalizeWorkspace(workspacePayload("w1", { workspaceKind: "mystery" })).kind, null);
  assert.equal(normalizeWorkspace(workspacePayload("w1", { status: "mystery" })), null);
  assert.deepEqual([normalizeWorkspace(workspacePayload("w1", { diffStat: { additions: "x" } })).diffAdditions, normalizeWorkspace(workspacePayload("w1")).diffDeletions], [null, null]);
  for (const bad of [null, 7, [], {}, { id: "" }, { id: "w", projectId: "p" }]) assert.equal(normalizeWorkspace(bad), null);
  assert.deepEqual(normalizeProject({ projectId: "p1", projectDisplayName: "Alpha" }), { id: "p1", name: "Alpha" });
  assert.deepEqual(normalizeProject({ projectId: "p1" }), { id: "p1", name: "p1" });
  for (const bad of [null, 1, "p", [], {}, { projectId: "" }]) assert.equal(normalizeProject(bad), null);
});

test("OFFC-05 derive: tool kinds, activity, todos and errors come from typed timeline items", () => {
  for (const kind of ["shell", "read", "edit", "write", "search", "fetch", "worktree_setup", "sub_agent", "plain_text", "plan"]) {
    const next = deriveTimeline(EMPTY, toolItem(kind));
    assert.deepEqual([next.lastTool, next.activity], [kind, "tool"], kind);
  }
  assert.equal(deriveTimeline(EMPTY, toolItem("telepathy")).lastTool, "unknown");
  assert.equal(deriveTimeline(EMPTY, { type: "timeline", item: { type: "tool_call" } }).lastTool, "unknown");
  const withTool = deriveTimeline(EMPTY, toolItem("edit"));
  const thinking = deriveTimeline(withTool, { type: "timeline", item: { type: "reasoning" } });
  assert.deepEqual([thinking.lastTool, thinking.activity], ["edit", "reasoning"]);
  for (const type of ["assistant_message", "user_message"]) assert.equal(deriveTimeline(withTool, { type: "timeline", item: { type } }).activity, "message");
  const cleared = deriveTimeline(withTool, { type: "turn_started" });
  assert.deepEqual([cleared.lastTool, cleared.activity], [null, null]);

  const todos = deriveTimeline(EMPTY, { type: "timeline", item: { type: "todo", items: [{ text: "a", completed: true }, { text: "b", completed: false }, { text: "c", status: "in_progress" }, { text: "" }, 5] } });
  assert.deepEqual(todos.todos, [{ text: "a", status: "completed" }, { text: "b", status: "pending" }, { text: "c", status: "in_progress" }]);
  assert.equal(todos.todoSeen, true);
  const emptyTodo = deriveTimeline(todos, todoItem([]));
  assert.deepEqual([emptyTodo.todos.length, emptyTodo.todoSeen], [0, true]);
  assert.deepEqual(deriveTimeline(todos, { type: "turn_started" }).todos, todos.todos);
  assert.equal(deriveTimeline(todos, { type: "turn_started" }).todoSeen, true);
  const many = deriveTimeline(EMPTY, todoItem(Array.from({ length: 100 }, (_, i) => `t${i}${"x".repeat(500)}`)));
  assert.equal(many.todos.length, TODOS_PER_AGENT_MAX);
  assert.ok(many.todos.every((t) => t.text.length <= 120));
  assert.equal(deriveTimeline(EMPTY, { type: "timeline", item: { type: "error", message: "bad\nthing" } }).lastError, "badthing");

  for (const ignored of ["compaction", "notification", "plugin", "usage_updated"]) assert.equal(deriveTimeline(withTool, { type: "timeline", item: { type: ignored } }), withTool);
  for (const garbage of [null, undefined, 5, "x", [], {}, { type: "turn_completed" }, { type: "timeline" }, { type: "timeline", item: 5 }]) assert.equal(deriveTimeline(withTool, garbage), withTool);
  assert.deepEqual(deriveTimeline(deriveTimeline(EMPTY, toolItem("read")), toolItem("read")), deriveTimeline(EMPTY, toolItem("read")));
});

test("OFFC-05 reducer: seeds, upserts, removes, archived agents and unreadable payloads", () => {
  let s = deepFreeze(reduce(emptyState(), seedAgents(agentPayload("a1", { workspaceId: "w1" }), agentPayload("a2"))));
  assert.deepEqual([...s.agents.keys()].sort(), ["a1", "a2"]);
  const before = s.agents.size;
  const next = reduce(s, upsert(agentPayload("a3")));
  assert.equal(s.agents.size, before);
  assert.ok(next.agents.has("a3"));
  assert.equal(next.version, s.version + 1);
  s = next;
  assert.equal(reduce(s, upsert(agentPayload("a3"))), s);
  for (const payload of [null, 5, "x", [], {}, { kind: "upsert", agent: 5 }, { kind: "upsert", agent: { id: "z", status: "weird" } }, { kind: "remove" }, { kind: "remove", agentId: 7 }, { kind: "other" }]) {
    assert.equal(reduce(s, { type: "agent.update", payload }), s, JSON.stringify(payload));
  }
  assert.equal(reduce(s, { type: "mystery" }), s);
  const archived = reduce(s, upsert(agentPayload("a3", { archivedAt: iso(9) })));
  assert.equal(archived.agents.has("a3"), false);
  const withDerived = reduce(s, { type: "timeline.event", agentId: "a1", event: toolItem("edit") });
  assert.equal(withDerived.derived.get("a1").lastTool, "edit");
  const removed = reduce(withDerived, { type: "agent.update", payload: agentRemove("a1") });
  assert.deepEqual([removed.agents.has("a1"), removed.derived.has("a1")], [false, false]);
  const reseeded = reduce(withDerived, seedAgents(agentPayload("a2")));
  assert.deepEqual([reseeded.agents.has("a1"), reseeded.derived.has("a1")], [false, false]);

  for (const id of ["__proto__", "constructor", "toString"]) {
    const t = reduce(emptyState(), upsert(agentPayload(id)));
    assert.equal(t.agents.get(id).id, id);
    assert.equal(reduce(t, { type: "agent.update", payload: agentRemove(id) }).agents.has(id), false);
  }
  const small = { limits: { storeEntriesMax: 2 } };
  let c = reduce(emptyState(), upsert(agentPayload("a")), small);
  c = reduce(c, upsert(agentPayload("b")), small);
  assert.equal(reduce(c, upsert(agentPayload("c")), small), c);
  assert.equal(reduce(c, upsert(agentPayload("a", { title: "renamed" })), small).agents.get("a").title, "renamed");
});

test("OFFC-05 reducer: workspaces, projects, timeline tail, older history and reset", () => {
  let s = reduce(emptyState(), { type: "workspaces.seed", entries: [workspacePayload("w1"), 5, workspacePayload("w2", { projectId: "p2" })] });
  assert.deepEqual([...s.workspaces.keys()], ["w1", "w2"]);
  s = reduce(s, { type: "workspace.update", payload: { kind: "remove", id: "w2" } });
  assert.deepEqual([...s.workspaces.keys()], ["w1"]);
  const same = reduce(s, { type: "workspace.update", payload: { kind: "upsert", workspace: workspacePayload("w1") } });
  assert.equal(same, s);
  s = reduce(s, { type: "projects.seed", projects: [{ projectId: "p1", projectDisplayName: "One" }, null] });
  s = reduce(s, { type: "project.update", payload: { kind: "upsert", project: { projectId: "p2", projectDisplayName: "Two" } } });
  assert.deepEqual([...s.projects.keys()], ["p1", "p2"]);
  s = reduce(s, { type: "project.update", payload: { kind: "remove", projectId: "p1" } });
  assert.deepEqual([...s.projects.keys()], ["p2"]);

  s = reduce(s, seedAgents(agentPayload("a1")));
  const tail = [{ item: { type: "tool_call", detail: { type: "read" } }, seqStart: 9 }, todoEntry(3, "old"), { item: { type: "tool_call", detail: { type: "edit" } }, seqStart: 5 }, null];
  const tailed = reduce(s, { type: "timeline.tail", agentId: "a1", entries: tail });
  assert.equal(tailed.derived.get("a1").lastTool, "read");
  assert.equal(tailed.derived.get("a1").todos[0].text, "old");
  assert.equal(reduce(s, { type: "timeline.tail", agentId: "ghost", entries: tail }), s);

  const older = reduce(s, { type: "timeline.older", agentId: "a1", entries: [todoEntry(5, "first"), todoEntry(9, "newest"), { item: { type: "tool_call", detail: { type: "shell" } }, seqStart: 10 }] });
  const d = older.derived.get("a1");
  assert.deepEqual([d.todos.map((t) => t.text), d.todoSeen, d.lastTool, d.activity, d.lastError], [["newest"], true, null, null, null]);
  assert.equal(reduce(older, { type: "timeline.older", agentId: "a1", entries: [todoEntry(99, "again")] }), older);
  assert.equal(reduce(s, { type: "timeline.older", agentId: "a1", entries: [toolEvent(1, "read")] }), s);
  assert.equal(reduce(s, { type: "timeline.older", agentId: "ghost", entries: [todoEntry(1, "x")] }), s);
  const live = reduce(tailed, { type: "timeline.older", agentId: "a1", entries: [todoEntry(1, "ancient")] });
  assert.equal(live.derived.get("a1").todos[0].text, "old");
  const reset = reduce(older, { type: "timeline.reset", agentId: "a1" });
  assert.equal(reset.derived.has("a1"), false);
  assert.equal(reduce(reset, { type: "timeline.older", agentId: "a1", entries: [todoEntry(7, "again")] }).derived.get("a1").todos[0].text, "again");
  assert.equal(reduce(s, { type: "select", agentId: "a1" }).selectedAgentId, "a1");
  assert.equal(reduce(reduce(s, { type: "select", agentId: "a1" }), { type: "select", agentId: "a1" }).version, s.version + 1);
});

test("OFFC-05 snapshot: the join gives projectId, derived data, error precedence and sorted lists", () => {
  let s = reduce(emptyState(), { type: "workspaces.seed", entries: [workspacePayload("w1", { projectId: "p1", projectDisplayName: "Alpha", name: "main" })] });
  s = reduce(s, seedAgents(agentPayload("b", { title: "Zed", workspaceId: "w1", lastError: "base" }), agentPayload("a", { title: "alpha", workspaceId: "wX" }), agentPayload("c", { title: "alpha" })));
  s = reduce(s, { type: "timeline.event", agentId: "b", event: toolItem("shell") });
  s = reduce(s, { type: "timeline.event", agentId: "b", event: { type: "timeline", item: { type: "error", message: "from timeline" } } });
  const snap = snapshotOf(s);
  assert.deepEqual(snap.agents.map((a) => a.id), ["a", "c", "b"]);
  const b = snap.agents.find((a) => a.id === "b");
  assert.deepEqual([b.projectId, b.lastTool, b.activity, b.lastError], ["p1", "shell", "tool", "from timeline"]);
  assert.equal(snap.agents.find((a) => a.id === "a").projectId, null);
  assert.equal("todoSeen" in b, false);
  assert.deepEqual(snap.projects, [{ id: "p1", name: "Alpha" }]);
  assert.equal(snap.workspaces[0].name, "main");
  assert.equal("projectDisplayName" in snap.workspaces[0], false);
  assert.equal(snapshotOf(s), snap);
  const fallback = snapshotOf(reduce(reduce(s, { type: "timeline.reset", agentId: "b" }), seedAgents(agentPayload("b", { lastError: "base", workspaceId: "w1" }))));
  assert.equal(fallback.agents[0].lastError, "base");
  assert.deepEqual(snapshotOf(emptyState()), { projects: [], workspaces: [], agents: [] });
  const named = reduce(s, { type: "projects.seed", projects: [{ projectId: "p1", projectDisplayName: "Listed" }] });
  assert.equal(snapshotOf(named).projects[0].name, "Listed");
});

test("OFFC-12 handoff: a finished child turn enqueues one handoff by the status signal", () => {
  assert.ok(["status", "finished"].includes(HANDOFF_SIGNAL));
  const o = { handoffSignal: "status" };
  const run = (s, id, over) => reduce(s, upsert(kid(id, "p", over)), o);
  let s = reduce(emptyState(), seedAgents(agentPayload("p"), kid("c", "p", { status: "running" }), kid("orphan", "ghost", { status: "running" })), o);
  assert.equal(s.handoffs.length, 0);
  s = run(s, "c", { status: "idle" });
  assert.deepEqual(s.handoffs, [{ seq: 1, childId: "c", parentId: "p" }]);
  s = run(s, "c", { status: "idle", title: "quiet" });
  s = reduce(s, seedAgents(agentPayload("p"), kid("c", "p", { status: "idle" })), o);
  assert.equal(s.handoffs.length, 1);
  s = run(s, "c", { status: "running" });
  s = run(s, "c", { status: "idle" });
  assert.deepEqual(s.handoffs.map((h) => h.seq), [1, 2]);

  let t = reduce(emptyState(), seedAgents(agentPayload("p"), kid("o", "ghost"), agentPayload("n")), o);
  t = reduce(reduce(t, upsert(kid("o", "ghost", { status: "running" })), o), upsert(kid("o", "ghost", { status: "idle" })), o);
  t = reduce(reduce(t, upsert(agentPayload("n", { status: "running" })), o), upsert(agentPayload("n", { status: "idle" })), o);
  assert.equal(t.handoffs.length, 0);
  for (const end of ["error", "closed"]) {
    let u = reduce(emptyState(), seedAgents(agentPayload("p"), kid("c", "p", { status: "running" })), o);
    u = reduce(reduce(u, upsert(kid("c", "p", { status: end })), o), upsert(kid("c", "p", { status: "idle" })), o);
    assert.equal(u.handoffs.length, 0, end);
  }
  let v = reduce(emptyState(), seedAgents(agentPayload("p")), o);
  v = reduce(v, upsert(kid("c", "p", { status: "running" })), o);
  v = reduce(v, { type: "agent.update", payload: agentRemove("c") }, o);
  v = reduce(reduce(v, upsert(kid("c", "p", { status: "idle" })), o), upsert(kid("c", "p", { status: "idle", title: "again" })), o);
  assert.equal(v.handoffs.length, 0);
});

test("OFFC-12 handoff: the finished signal, both signals for one turn, take and the queue cap", () => {
  const f = { handoffSignal: "finished" };
  let s = reduce(emptyState(), seedAgents(agentPayload("p"), kid("c", "p", { status: "running" })), f);
  s = reduce(s, upsert(kid("c", "p", { status: "running", requiresAttention: true, attentionReason: "finished" })), f);
  assert.equal(s.handoffs.length, 1);
  s = reduce(s, upsert(kid("c", "p", { status: "idle", requiresAttention: true, attentionReason: "finished" })), f);
  assert.equal(s.handoffs.length, 1);

  const o = { handoffSignal: "status" };
  let b = reduce(emptyState(), seedAgents(agentPayload("p"), kid("c", "p", { status: "running" })), o);
  b = reduce(b, upsert(kid("c", "p", { status: "idle", requiresAttention: true, attentionReason: "finished" })), o);
  assert.equal(b.handoffs.length, 1);

  let q = reduce(emptyState(), seedAgents(agentPayload("p")), o);
  for (let i = 0; i < 3; i++) {
    q = reduce(q, upsert(kid("c", "p", { status: "running" })), o);
    q = reduce(q, upsert(kid("c", "p", { status: "idle" })), o);
  }
  assert.deepEqual(q.handoffs.map((h) => h.seq), [1, 2, 3]);
  const taken = reduce(q, { type: "handoffs.take", upToSeq: 2 }, o);
  assert.deepEqual(taken.handoffs.map((h) => h.seq), [3]);
  assert.equal(reduce(taken, { type: "handoffs.take", upToSeq: 2 }, o), taken);
  const capped = { handoffSignal: "status", limits: { handoffQueueMax: 2 } };
  let r = reduce(emptyState(), seedAgents(agentPayload("p")), capped);
  for (let i = 0; i < 3; i++) {
    r = reduce(r, upsert(kid("c", "p", { status: "running" })), capped);
    r = reduce(r, upsert(kid("c", "p", { status: "idle" })), capped);
  }
  assert.deepEqual(r.handoffs.map((h) => h.seq), [2, 3]);
  assert.ok(HANDOFF_QUEUE_MAX >= 1);
});

// ===== Task 2: store wiring, sprite store and the fake =====
const BASE = 6; // three local handlers plus the owned agent, workspace and event subscriptions
const FORBIDDEN_NAMES = ["send", "run", "create", "archive", "respondToPermission", "setTitle", "listUsage"];
const READ_ONLY_CALLS = [
  "agents.list",
  "agents.subscribe",
  "agents.ref.timeline.subscribe",
  "agents.ref.timeline.refetch",
  "workspaces.list",
  "workspaces.subscribe",
  "projects.list",
  "projects.subscribe",
  "observeEvents",
];

function fixture(extra = {}) {
  return fakePaseo({
    agents: [agentPayload("a1", { workspaceId: "w1" }), agentPayload("a2", { workspaceId: "w1" })],
    workspaceEntries: [workspacePayload("w1")],
    projectEntries: [projectPayload("p1")],
    ...extra,
  });
}

async function boot(extra, storeOptions) {
  const fake = fixture(extra);
  const store = createStore(fake, storeOptions);
  await store.start();
  await settleAll();
  return { fake, store };
}

const agentIds = (store) => store.getSnapshot().agents.map((a) => a.id).sort();
const agentOf = (store, id) => store.getSnapshot().agents.find((a) => a.id === id);
const running = (id, over = {}) => agentPayload(id, { workspaceId: "w1", status: "running", ...over });
const subscribeCount = (fake) => fake.calls.filter((c) => c === "agents.ref.timeline.subscribe").length;

test("OFFC-05 fake: the extended fake keeps its old answers and offers only read members", async () => {
  const f = fakePaseo({
    agents: [agentPayload("a")],
    workspaces: { w1: "C:/x" },
    timelines: { a: [toolEntry("c1", "x", {}, iso(1), { seq: 1 }), toolEntry("c2", "x", {}, iso(2), { seq: 2 }), toolEntry("c3", "x", {}, iso(3), { seq: 3 })] },
  });
  const list = await f.agents.list({ page: { limit: 1 } });
  assert.deepEqual(Object.keys(list).sort(), ["entries", "pageInfo"]);
  assert.deepEqual([list.entries.length, list.pageInfo.hasMore], [1, false]);
  assert.equal(f.workspaces.ref("w1").directory, "C:/x");
  const tail = await f.agents.ref("a").timeline.refetch({ limit: 2 });
  assert.deepEqual(tail.entries.map((e) => e.seqStart), [2, 3]);
  assert.deepEqual([tail.startCursor.seq, tail.hasOlder], [2, true]);
  const older = await f.agents.ref("a").timeline.refetch({ direction: "before", cursor: { epoch: "fake", seq: 3 }, limit: 5 });
  assert.deepEqual(older.entries.map((e) => e.seqStart), [1, 2]);
  assert.equal(older.hasOlder, false);
  assert.equal(f.reads.get("a"), 2);
  for (const name of FORBIDDEN_NAMES) {
    for (const target of [f, f.agents, f.agents.ref("a"), f.agents.ref("a").timeline, f.workspaces, f.projects]) assert.equal(name in target, false, name);
  }
  const sub = await f.agents.list({ subscribe: {} });
  assert.equal(f.liveSubscriptions(), 1);
  await sub.subscription.release();
  assert.equal(f.liveSubscriptions(), 0);
  assert.ok(f.calls.includes("agents.list") && f.calls.includes("agents.ref.timeline.refetch"));
});

test("OFFC-05 store: start seeds agents, workspaces and projects with subscribe set and pages by cursor", async () => {
  const agents = Array.from({ length: 5 }, (_, i) => agentPayload(`a${i}`, { workspaceId: "w1" }));
  const fake = fixture({ agents, pageSize: 2 });
  const seen = [];
  const list = fake.agents.list;
  fake.agents.list = (options) => {
    seen.push(options);
    return list(options);
  };
  const store = createStore(fake);
  await store.start();
  await settleAll();
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].subscribe, {});
  assert.deepEqual(seen[0].filter, { includeArchived: false });
  assert.equal(seen[0].page.limit, LIST_PAGE_LIMIT);
  assert.deepEqual([seen[1].subscribe, seen[1].page.cursor, seen[2].subscribe, seen[2].page.cursor], [undefined, "2", undefined, "4"]);
  assert.equal(fake.calls.filter((c) => c === "workspaces.list").length, 1);
  assert.equal(fake.calls.filter((c) => c === "projects.list").length, 1);
  assert.deepEqual(fake.observed, [["project.update"]]);
  assert.deepEqual(store.getStatus(), { state: "ready", error: null });
  const snap = store.getSnapshot();
  assert.deepEqual([snap.agents.length, snap.workspaces.length, snap.projects.length], [5, 1, 1]);
  store.dispose();

  const many = fixture({ agents: Array.from({ length: LIST_PAGES_MAX + 5 }, (_, i) => agentPayload(`m${i}`)), pageSize: 1 });
  const bounded = createStore(many);
  await bounded.start();
  await settleAll();
  assert.equal(many.calls.filter((c) => c === "agents.list").length, LIST_PAGES_MAX);
  assert.equal(bounded.getSnapshot().agents.length, LIST_PAGES_MAX);
  bounded.dispose();
});

test("OFFC-05 store: a failing list leaves status failed with the error text and an empty snapshot", async () => {
  const fake = fakePaseo({ listError: "daemon offline" });
  const store = createStore(fake);
  await store.start();
  await settleAll();
  assert.deepEqual(store.getStatus(), { state: "failed", error: "daemon offline" });
  assert.deepEqual(store.getSnapshot(), { projects: [], workspaces: [], agents: [] });
  assert.ok(store.stats().listErrors >= 1);
  store.dispose();
  assert.equal(fake.liveSubscriptions(), 0);
});

test("OFFC-05 store: pushed upserts and removes change the snapshot, archived agents leave, updates held during the seed are kept", async () => {
  const { fake, store } = await boot();
  fake.emitAgent(agentUpsert(agentPayload("n1", { workspaceId: "w1" })));
  await flush();
  assert.deepEqual(agentIds(store), ["a1", "a2", "n1"]);
  fake.emitAgent(agentRemove("n1"));
  await flush();
  assert.deepEqual(agentIds(store), ["a1", "a2"]);
  fake.emitAgent(agentUpsert(agentPayload("a2", { workspaceId: "w1", archivedAt: iso(5) })));
  await flush();
  assert.deepEqual(agentIds(store), ["a1"]);
  fake.emitAgent({ kind: "upsert", agent: { id: "min", status: "idle", workspaceId: "w1" } });
  await flush();
  const min = agentOf(store, "min");
  assert.deepEqual([min.title, min.parentAgentId, min.provider, min.lastError, min.runId, min.projectId], [null, null, null, null, null, "p1"]);
  fake.emitWorkspace({ kind: "upsert", workspace: workspacePayload("w2", { projectId: "p1" }) });
  await flush();
  assert.equal(store.getSnapshot().workspaces.length, 2);
  fake.emitWorkspace({ kind: "remove", id: "w2" });
  fake.emitProject({ kind: "upsert", project: projectPayload("p2") });
  await flush();
  assert.deepEqual([store.getSnapshot().workspaces.length, store.getSnapshot().projects.map((p) => p.id)], [1, ["p1", "p2"]]);
  fake.emitProject({ kind: "remove", projectId: "p2" });
  await flush();
  assert.deepEqual(store.getSnapshot().projects.map((p) => p.id), ["p1"]);
  store.dispose();

  const held = fixture();
  const release = held.holdLists();
  const late = createStore(held);
  const started = late.start();
  await flush();
  held.emitAgent(agentUpsert(agentPayload("late", { workspaceId: "w1" })));
  held.emitAgent(agentRemove("a1"));
  release();
  await started;
  await settleAll();
  assert.deepEqual(agentIds(late), ["a2", "late"]);
  late.dispose();
});

test("OFFC-05 store: a daemon restore re-seeds the collection and re-lists the projects without a handoff", async () => {
  const { fake, store } = await boot({ agents: [agentPayload("p", { workspaceId: "w1" }), kid("c", "p", { workspaceId: "w1", status: "running" }), agentPayload("gone", { workspaceId: "w1" })] });
  assert.deepEqual(agentIds(store), ["c", "gone", "p"]);
  const lists = fake.calls.filter((c) => c === "projects.list").length;
  fake.restoreAgents([agentPayload("p", { workspaceId: "w1" }), kid("c", "p", { workspaceId: "w1", status: "idle" }), agentPayload("fresh", { workspaceId: "w1" })]);
  await settleAll();
  assert.deepEqual(agentIds(store), ["c", "fresh", "p"]);
  assert.deepEqual(store.takeHandoffs(), []);
  assert.equal(fake.calls.filter((c) => c === "projects.list").length, lists + 1);
  fake.restoreWorkspaces([workspacePayload("w9")]);
  await settleAll();
  assert.deepEqual(store.getSnapshot().workspaces.map((w) => w.id), ["w9"]);
  store.dispose();
  assert.equal(fake.liveSubscriptions(), 0);
});

test("OFFC-05 store: timelines exist only for running and selected agents, capped, the selected one first", async () => {
  const agents = [running("r1", { updatedAt: iso(1) }), running("r2", { updatedAt: iso(3) }), running("r3", { updatedAt: iso(2) }), agentPayload("i1", { workspaceId: "w1" }), agentPayload("i2", { workspaceId: "w1" })];
  const fake = fixture({ agents });
  const refs = new Set();
  const ref = fake.agents.ref;
  fake.agents.ref = (id) => {
    refs.add(id);
    return ref(id);
  };
  const store = createStore(fake, { limits: { timelineSubscriptionsMax: 2 } });
  store.select("i1");
  await store.start();
  await settleAll();
  assert.deepEqual([...refs].sort(), ["i1", "r2"]);
  assert.equal(fake.liveSubscriptions(), BASE + 2);
  fake.emitAgent(agentUpsert(agentPayload("r2", { workspaceId: "w1", updatedAt: iso(3) })));
  await settleAll();
  assert.deepEqual([...refs].sort(), ["i1", "r2", "r3"]);
  assert.equal(fake.liveSubscriptions(), BASE + 2);
  assert.equal(subscribeCount(fake), 3);
  store.dispose();
  assert.equal(fake.liveSubscriptions(), 0);
});

test("OFFC-05 store: a timeline awaits ready, seeds a bounded tail, replays buffered events, re-reads on restore and resets on replacement", async () => {
  let fake;
  const seen = [];
  const timeline = (opts, n) => {
    seen.push(opts);
    if (n === 1) fake.emitTimeline("t1", streamEvent("t1", toolItem("shell")));
    return n >= 3 ? [toolEvent(1, "edit")] : [todoEntry(1, "do x"), toolEvent(2, "edit")];
  };
  fake = fixture({ agents: [running("t1")], timelines: { t1: timeline } });
  const store = createStore(fake);
  await store.start();
  await settleAll();
  assert.deepEqual(seen[0], { direction: "tail", limit: TIMELINE_TAIL_LIMIT, projection: "projected" });
  assert.deepEqual([agentOf(store, "t1").todos.map((t) => t.text), agentOf(store, "t1").lastTool], [["do x"], "shell"]);
  fake.emitTimeline("t1", streamEvent("t1", toolItem("read")));
  await settleAll();
  assert.equal(agentOf(store, "t1").lastTool, "read");
  fake.restoreTimeline("t1");
  await settleAll();
  assert.equal(fake.reads.get("t1"), 2);
  fake.emitTimeline("t1", { agentId: "t1", event: { type: "replacement", epoch: "e2" } });
  await settleAll();
  assert.equal(fake.reads.get("t1"), 3);
  assert.deepEqual([agentOf(store, "t1").todos, agentOf(store, "t1").lastTool], [[], "edit"]);
  fake.emitTimeline("t1", { agentId: "t1", event: { type: "error", error: "x" } });
  assert.equal(store.stats().timelineErrors, 1);
  store.dispose();
  assert.equal(fake.liveSubscriptions(), 0);
});

test("OFFC-05 store: a failing ready leaves no subscription until a later change, a failing refetch is counted", async () => {
  const bad = fixture({ agents: [running("t1")], timelineSubscribeErrors: { t1: "nope" } });
  const store = createStore(bad);
  await store.start();
  await settleAll();
  assert.equal(bad.liveSubscriptions(), BASE);
  assert.deepEqual([store.stats().timelineErrors, subscribeCount(bad)], [1, 1]);
  bad.emitAgent(agentUpsert(agentPayload("x1", { workspaceId: "w1" })));
  await settleAll();
  assert.deepEqual([subscribeCount(bad), bad.liveSubscriptions()], [2, BASE]);
  store.dispose();

  const flaky = fixture({
    agents: [running("t1")],
    timelines: {
      t1: (opts, n) => {
        if (n === 2) throw new Error("read failed");
        return [toolEvent(1, "read")];
      },
    },
  });
  const second = createStore(flaky);
  await second.start();
  await settleAll();
  flaky.restoreTimeline("t1");
  await settleAll();
  assert.equal(second.stats().refetchErrors, 1);
  assert.equal(agentOf(second, "t1").lastTool, "read");
  second.dispose();
});

const busyEntries = Array.from({ length: 150 }, (_, i) => (i + 1 === 10 ? todoEntry(10, "ship it") : toolEvent(i + 1, "read")));

test("OFFC-05 store: the selected agent pages back to a todo item behind the tail, other agents read the tail only", async () => {
  const seen = [];
  const quiet = Array.from({ length: 150 }, (_, i) => toolEvent(i + 1, "read"));
  const fake = fixture({
    agents: [running("busy"), running("other")],
    timelines: {
      busy: (opts) => {
        seen.push(opts);
        return busyEntries;
      },
      other: () => quiet,
    },
  });
  const store = createStore(fake);
  store.select("busy");
  await store.start();
  await settleAll(30);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0], { direction: "tail", limit: TIMELINE_TAIL_LIMIT, projection: "projected" });
  assert.deepEqual(seen[1], { direction: "before", cursor: { epoch: "fake", seq: 127 }, limit: TIMELINE_TODO_PAGE_LIMIT, projection: "projected" });
  assert.equal(seen[2].cursor.seq, 27);
  assert.deepEqual(agentOf(store, "busy").todos, [{ text: "ship it", status: "pending" }]);
  assert.equal(fake.reads.get("other"), 1);
  assert.deepEqual(agentOf(store, "other").todos, []);
  store.dispose();
});

test("OFFC-05 store: todo paging stops at the page cap, at the first page without older entries, and never replaces a seen todo", async () => {
  const long = Array.from({ length: 1000 }, (_, i) => toolEvent(i + 1, "read"));
  const capped = fixture({ agents: [running("busy")], timelines: { busy: long } });
  const a = createStore(capped);
  a.select("busy");
  await a.start();
  await settleAll(40);
  assert.equal(capped.reads.get("busy"), 1 + TIMELINE_TODO_PAGES_MAX);
  assert.deepEqual([a.stats().todoScanCapped, agentOf(a, "busy").todos], [1, []]);
  a.dispose();

  const short = fixture({ agents: [running("busy")], timelines: { busy: long.slice(0, 30) } });
  const b = createStore(short);
  b.select("busy");
  await b.start();
  await settleAll(20);
  assert.deepEqual([short.reads.get("busy"), b.stats().todoScanCapped], [2, 0]);
  b.dispose();

  const tailTodo = busyEntries.map((e, i) => (i + 1 === 140 ? todoEntry(140, "recent") : e));
  const seenTodo = fixture({ agents: [running("busy")], timelines: { busy: tailTodo } });
  const c = createStore(seenTodo);
  c.select("busy");
  await c.start();
  await settleAll(20);
  assert.equal(seenTodo.reads.get("busy"), 1);
  assert.equal(agentOf(c, "busy").todos[0].text, "recent");
  c.dispose();
});

test("OFFC-05 store: selecting a live running agent pages once, a paging failure or a changed selection stops it", async () => {
  const late = fixture({ agents: [running("late")], timelines: { late: busyEntries } });
  const a = createStore(late);
  await a.start();
  await settleAll(20);
  assert.equal(late.reads.get("late"), 1);
  a.select("late");
  await settleAll(30);
  assert.equal(late.reads.get("late"), 3);
  assert.equal(agentOf(a, "late").todos[0].text, "ship it");
  a.select("late");
  await settleAll();
  assert.equal(late.reads.get("late"), 3);
  a.dispose();

  const failing = fixture({
    agents: [running("busy")],
    timelines: {
      busy: (opts) => {
        if (opts.direction === "before") throw new Error("x");
        return busyEntries;
      },
    },
  });
  const b = createStore(failing);
  b.select("busy");
  await b.start();
  await settleAll(20);
  assert.deepEqual([b.stats().refetchErrors, failing.reads.get("busy")], [1, 2]);
  b.dispose();

  let c;
  const moved = fixture({
    agents: [running("busy")],
    timelines: {
      busy: (opts) => {
        if (opts.direction === "before") c.select(null);
        return busyEntries;
      },
    },
  });
  c = createStore(moved);
  c.select("busy");
  await c.start();
  await settleAll(20);
  assert.deepEqual([moved.reads.get("busy"), agentOf(c, "busy").todos], [2, []]);
  c.dispose();

  let d;
  const gone = fixture({
    agents: [running("busy")],
    timelines: {
      busy: (opts) => {
        if (opts.direction === "before") d.dispose();
        return busyEntries;
      },
    },
  });
  d = createStore(gone);
  d.select("busy");
  await d.start();
  await settleAll(20);
  assert.deepEqual([gone.reads.get("busy"), agentOf(d, "busy").todos, gone.liveSubscriptions()], [2, [], 0]);
});

test("OFFC-05 store: dispose leaves no live subscription, also while the lists are held, and is idempotent", async () => {
  const { fake, store } = await boot({ agents: [running("t1")] });
  assert.equal(fake.liveSubscriptions(), BASE + 1);
  let calls = 0;
  store.subscribe(() => calls++);
  store.dispose();
  assert.equal(fake.liveSubscriptions(), 0);
  store.dispose();
  assert.equal(fake.liveSubscriptions(), 0);
  const before = store.getSnapshot();
  fake.emitAgent(agentUpsert(agentPayload("after", { workspaceId: "w1" })));
  await settleAll();
  assert.equal(store.getSnapshot(), before);
  assert.equal(calls, 0);

  const held = fixture();
  const release = held.holdLists();
  const late = createStore(held);
  let notified = 0;
  late.subscribe(() => notified++);
  const started = late.start();
  await flush();
  late.dispose();
  release();
  await started;
  await settleAll();
  assert.equal(held.liveSubscriptions(), 0);
  assert.equal(notified, 0);
  assert.deepEqual(late.getSnapshot(), { projects: [], workspaces: [], agents: [] });
});

test("OFFC-05 store: 100 synchronous upserts notify once, a no-change upsert is silent, handoffs are taken once", async () => {
  const { fake, store } = await boot({ agents: [agentPayload("p", { workspaceId: "w1" }), kid("c", "p", { workspaceId: "w1", status: "running" })] });
  let calls = 0;
  store.subscribe(() => calls++);
  const first = store.getSnapshot();
  for (let i = 0; i < 100; i++) fake.emitAgent(agentUpsert(agentPayload(`b${i}`, { workspaceId: "w1" })));
  assert.equal(calls, 0);
  await flush();
  assert.equal(calls, 1);
  const second = store.getSnapshot();
  assert.notEqual(second, first);
  assert.equal(store.getSnapshot(), second);
  assert.equal(second.agents.length, 102);
  fake.emitAgent(agentUpsert(agentPayload("b0", { workspaceId: "w1" })));
  await flush();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot(), second);
  fake.emitAgent(agentUpsert(kid("c", "p", { workspaceId: "w1", status: "idle" })));
  await flush();
  const taken = store.takeHandoffs();
  assert.deepEqual(taken.map((h) => [h.childId, h.parentId]), [["c", "p"]]);
  assert.deepEqual(store.takeHandoffs(), []);
  store.dispose();
});

test("OFFC-05 gate: only read-only Paseo calls are made and the sources hold no timer, file read or forbidden import", async () => {
  const { fake, store } = await boot({ agents: [running("t1"), agentPayload("i1", { workspaceId: "w1" })] });
  store.select("i1");
  fake.emitAgent(agentUpsert(agentPayload("n1", { workspaceId: "w1" })));
  fake.emitWorkspace({ kind: "remove", id: "w1" });
  fake.restoreAgents([agentPayload("n1", { workspaceId: "w1" })]);
  await settleAll();
  store.dispose();
  const names = new Set(fake.calls);
  assert.ok(names.size > 0);
  for (const name of names) assert.ok(READ_ONLY_CALLS.includes(name), name);

  const client = path.join(KIT_DIR, "plugins", "office", "client");
  const files = ["store.ts", "model.ts", "poses.ts", "sprite-store.ts"].filter((f) => fs.existsSync(path.join(client, f)));
  assert.ok(files.includes("store.ts") && files.includes("poses.ts") && files.includes("sprite-store.ts"));
  for (const file of files) {
    const code = fs.readFileSync(path.join(client, file), "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.doesNotMatch(code, /\b(setInterval|setTimeout|requestAnimationFrame)\b/, file);
    assert.doesNotMatch(code, /\b(readFile|readdir|readFileSync)\b|from\s+["'](node:|fs["'/])/, file);
    assert.doesNotMatch(code, /\blistUsage\b/, file);
    assert.doesNotMatch(code, /^\s*import\s+(?!type\b)[^;]*from\s+["'](react|react-native|@getpaseo)/m, file);
    assert.doesNotMatch(code, /from\s+["'][^"']*\/server\//, file);
  }
});

// ----- sprite store -----

const keyOf = (i) => spriteKey({ kind: "ruler", seed: `s${i}`, poses: [], scale: 2, tint: 0 });
const okSprite = (key) => ({ ok: true, key, w: 10, h: 20, scale: 2, frame: null, uri: "data:image/png;base64,AAAA" });
const okCall = (keys) => ({ ok: true, sprites: keys.map(okSprite) });

test("OFFC-08 sprite store: a key is asked once, the entry is stable, bad keys cost no call", async () => {
  const calls = [];
  const store = createSpriteStore(async ({ keys }) => {
    calls.push(keys);
    return okCall(keys);
  });
  const k = keyOf(1);
  assert.equal(store.get(k), null);
  store.request([k, k]);
  assert.deepEqual(store.get(k), { state: "pending" });
  store.request([k]);
  await store.settle();
  store.request([k]);
  await store.settle();
  assert.equal(calls.length, 1);
  const entry = store.get(k);
  assert.deepEqual([entry.state, entry.w, entry.h, entry.scale, entry.frame, entry.source], ["ready", 10, 20, 2, null, { uri: "data:image/png;base64,AAAA" }]);
  assert.equal(store.get(k).source, entry.source);
  store.request(["nope", "ruler:bad seed:-:2:0"]);
  await store.settle();
  assert.equal(calls.length, 1);
  assert.deepEqual([store.get("nope").state, store.get("nope").code], ["failed", "bad_key"]);
  for (const junk of [null, undefined, 5, {}, [null, 5, {}]]) assert.doesNotThrow(() => store.request(junk));
  store.dispose();
});

test("OFFC-08 sprite store: calls are chunked and at most SPRITE_CALLS_IN_FLIGHT_MAX are open", async () => {
  const open = [];
  const store = createSpriteStore(({ keys }) => new Promise((resolve) => open.push({ keys, resolve })));
  const keys = Array.from({ length: 40 }, (_, i) => keyOf(i));
  let notified = 0;
  store.subscribe(() => notified++);
  store.request(keys);
  await flush();
  assert.equal(open.length, SPRITE_CALLS_IN_FLIGHT_MAX);
  assert.ok(open.every((c) => c.keys.length <= SPRITE_KEYS_PER_CALL_MAX));
  open[0].resolve(okCall(open[0].keys));
  await flush();
  assert.equal(open.length, SPRITE_CALLS_IN_FLIGHT_MAX + 1);
  open[1].resolve(okCall(open[1].keys));
  await flush();
  open[2].resolve(okCall(open[2].keys));
  await store.settle();
  assert.equal(open.length, 3);
  assert.deepEqual(open.flatMap((c) => c.keys), keys);
  assert.ok(keys.every((k) => store.get(k).state === "ready"));
  assert.ok(notified >= 1 && notified <= 3);
  store.dispose();
});

test("OFFC-08 sprite store: failures become typed entries, call failures retry once, envelope failures are final", async () => {
  const k = keyOf(2);
  let mode = "envelope";
  let count = 0;
  const store = createSpriteStore(async ({ keys }) => {
    count++;
    if (mode === "envelope") return { ok: true, sprites: keys.map((key) => ({ ok: false, key, code: "render_failed", message: "private detail" })) };
    if (mode === "call") return { ok: false, code: "internal", message: "m" };
    if (mode === "throw") throw new Error("secret stack text");
    if (mode === "garbage") return 5;
    if (mode === "count") return { ok: true, sprites: [] };
    if (mode === "order") return { ok: true, sprites: keys.map(() => okSprite(keyOf(99))) };
    if (mode === "uri") return { ok: true, sprites: keys.map((key) => ({ ...okSprite(key), uri: "https://example.invalid/x.png" })) };
    return okCall(keys);
  });
  const codeOf = async (m, key) => {
    mode = m;
    store.request([key]);
    await store.settle();
    return store.get(key);
  };
  assert.deepEqual([(await codeOf("envelope", k)).state, store.get(k).code], ["failed", "render_failed"]);
  store.retry([k]);
  await store.settle();
  assert.equal(count, 1);
  const expected = { call: "call_failed", throw: "call_failed", garbage: "bad_response", count: "mismatch", order: "mismatch", uri: "bad_response" };
  let i = 10;
  for (const [m, code] of Object.entries(expected)) {
    const key = keyOf(i++);
    const entry = await codeOf(m, key);
    assert.equal(entry.code, code, m);
    assert.doesNotMatch(JSON.stringify(entry), /secret|private/, m);
  }
  const retryKey = keyOf(30);
  assert.equal((await codeOf("call", retryKey)).code, "call_failed");
  mode = "ok";
  const before = count;
  store.retry();
  await store.settle();
  assert.equal(store.get(retryKey).state, "ready");
  assert.ok(count > before);
  assert.equal(store.get(keyOf(10)).state, "ready");
  const after = count;
  store.retry();
  await store.settle();
  assert.equal(count, after);
  store.dispose();
});

test("OFFC-08 sprite store: keys beyond the store bound fail with store_full and late responses after dispose change nothing", async () => {
  const asked = [];
  const store = createSpriteStore(async ({ keys }) => {
    asked.push(...keys);
    return okCall(keys);
  });
  const keys = Array.from({ length: SPRITE_STORE_KEYS_MAX + 6 }, (_, i) => keyOf(i));
  store.request(keys);
  await store.settle();
  assert.equal(asked.length, SPRITE_STORE_KEYS_MAX);
  assert.deepEqual([store.get(keys[SPRITE_STORE_KEYS_MAX]).state, store.get(keys[SPRITE_STORE_KEYS_MAX]).code], ["failed", "store_full"]);
  assert.equal(store.get(keys[0]).state, "ready");
  store.dispose();

  let resolveCall;
  const late = createSpriteStore(({ keys: asked2 }) => new Promise((resolve) => (resolveCall = () => resolve(okCall(asked2)))));
  let heard = 0;
  late.subscribe(() => heard++);
  const k = keyOf(1);
  late.request([k]);
  await flush();
  late.dispose();
  resolveCall();
  await flush();
  assert.deepEqual(late.get(k), { state: "pending" });
  assert.equal(heard, 0);
});

// ===== Task 3: building model =====
const av = (id, over = {}) => ({ id, title: id, projectId: null, workspaceId: "w1", parentAgentId: null, status: "idle", requiresAttention: false, attentionReason: null, pendingPermissions: 0, provider: null, model: null, contextUsedTokens: null, contextMaxTokens: null, lastError: null, lastTool: null, activity: null, todos: [], runId: null, updatedAt: null, ...over });
const wv = (id, over = {}) => ({ id, projectId: "p1", name: id, kind: null, status: "running", diffAdditions: null, diffDeletions: null, ...over });
const pv = (id, name = id) => ({ id, name });
const total = (m) => m.drawnAgents + m.surplusAgents + m.rooms.reduce((n, r) => n + r.surplusAgents + r.clusters.reduce((k, c) => k + c.surplusAgents, 0), 0);
const drawnIds = (m) => m.rooms.flatMap((r) => r.clusters.flatMap((c) => c.drawn.map((d) => d.agentId)));
const many = (n, ws, prefix, over = {}) => Array.from({ length: n }, (_, i) => av(`${prefix}${String(i).padStart(2, "0")}`, { workspaceId: ws, ...over }));

test("OFFC-06 model: payloads through reduce, snapshotOf and buildModel give the expected tree", () => {
  let s = reduce(emptyState(), { type: "projects.seed", projects: [projectPayload("pA", { projectDisplayName: "Alpha" }), projectPayload("pB", { projectDisplayName: "beta" }), projectPayload("pC", { projectDisplayName: "Gamma" })] });
  s = reduce(s, { type: "workspaces.seed", entries: [workspacePayload("wA1", { projectId: "pA" }), workspacePayload("wA2", { projectId: "pA" }), workspacePayload("wB1", { projectId: "pB" }), workspacePayload("wB2", { projectId: "pB" })] });
  const a = (id, ws, over = {}) => agentPayload(id, { workspaceId: ws, ...over });
  s = reduce(s, seedAgents(a("a1", "wA1", { status: "running" }), a("a2", "wA1"), kid("a3", "a1", { workspaceId: "wA1", status: "running" }), kid("a4", "a1", { workspaceId: "wA1" }),
    a("a5", "wA2"), kid("a6", "a1", { workspaceId: "wA2" }), a("a7", "wA2", { status: "closed" }), a("a8", "wB1"), a("a9", "wB1", { status: "running" }), kid("a10", "a8", { workspaceId: "wB1" }), kid("a11", "ghost", { workspaceId: "wB1" }),
    a("a12", "wB2"), a("a13", "wB2"), a("a14", "wA1", { archivedAt: iso(1) }), a("a15", null), a("a16", "wX"), a("a17", "wA2"), a("a18", "wA2"), a("a19", "wB2"), a("a20", "wB2")));
  const m = buildModel(snapshotOf(s));
  assert.deepEqual(m.rooms.map((r) => r.name), ["Alpha", "beta", "Gamma"]);
  assert.deepEqual([m.totalAgents, m.drawnAgents, m.surplusAgents], [17, 17, 0]);
  assert.deepEqual(m.rooms[0].clusters.map((c) => c.workspaceId), ["wA1", "wA2"]);
  assert.deepEqual(m.rooms[0].clusters[0].drawn.map((d) => d.agentId), ["a1", "a2", "a3", "a4"]);
  assert.deepEqual(m.rooms[0].clusters[1].drawn.map((d) => d.agentId), ["a17", "a18", "a5", "a7", "a6"]);
  assert.deepEqual(m.rooms[0].clusters[1].drawn.at(-1), { agentId: "a6", parentId: "a1", isChild: true });
  assert.deepEqual(m.rooms[1].clusters[0].drawn.map((d) => d.agentId), ["a9", "a8", "a10", "a11"]);
  assert.deepEqual(m.rooms[1].clusters[0].drawn.slice(2), [{ agentId: "a10", parentId: "a8", isChild: true }, { agentId: "a11", parentId: null, isChild: true }]);
  assert.deepEqual(m.rooms[2].clusters, []);
});

test("OFFC-06 caps: each cap cuts with an exact surplus and the global bound decides", () => {
  let m = buildModel({ projects: [pv("p1")], workspaces: [wv("w1")], agents: many(AGENTS_PER_CLUSTER_MAX + 1, "w1", "a") });
  assert.deepEqual([m.rooms[0].clusters[0].drawn.length, m.rooms[0].clusters[0].surplusAgents], [AGENTS_PER_CLUSTER_MAX, 1]);
  const wsN = Array.from({ length: CLUSTERS_PER_ROOM_MAX + 1 }, (_, i) => wv(`w${i}`));
  m = buildModel({ projects: [pv("p1")], workspaces: wsN, agents: wsN.flatMap((w, i) => many(i + 1, w.id, `x${i}`)) });
  assert.equal(m.rooms[0].clusters.length, CLUSTERS_PER_ROOM_MAX);
  assert.equal(m.rooms[0].surplusAgents, 1);
  const rooms = Array.from({ length: ROOMS_PER_BUILDING_MAX + 1 }, (_, i) => i);
  m = buildModel({ projects: rooms.map((i) => pv(`p${i}`)), workspaces: rooms.map((i) => wv(`w${i}`, { projectId: `p${i}` })), agents: rooms.flatMap((i) => many(i + 1, `w${i}`, `y${i}_`)) });
  assert.deepEqual([m.rooms.length, m.surplusAgents, total(m)], [ROOMS_PER_BUILDING_MAX, 1, m.totalAgents]);
  const sizes = [MAX_DRAWN_CHARACTERS - 19, 12, 12];
  m = buildModel({ projects: [pv("p1"), pv("p2"), pv("p3")], workspaces: [wv("w1", { projectId: "p1" }), wv("w2", { projectId: "p2" }), wv("w3", { projectId: "p3" })], agents: [...many(13, "w1", "a"), ...many(12, "w2", "b"), ...many(12, "w3", "c")] });
  assert.deepEqual([m.totalAgents, m.drawnAgents, total(m)], [37, MAX_DRAWN_CHARACTERS, 37]);
  assert.equal(sizes.length, 3);
  const small = buildModel({ projects: [pv("p1")], workspaces: [wv("w1"), wv("w2")], agents: many(5, "w1", "a") }, { agentsPerCluster: 2, clustersPerRoom: 1, roomsPerBuilding: 1, maxDrawn: 1 });
  assert.deepEqual([small.drawnAgents, total(small)], [1, 5]);
});

test("OFFC-06 selection: brains and running agents survive cuts, output is order independent and input is not mutated", () => {
  const snap = deepFreeze({ projects: [pv("px", "zeta"), pv("py", "alpha"), pv("pz", "mid")], workspaces: [wv("wx", { projectId: "px" }), wv("wy", { projectId: "py" }), wv("wz", { projectId: "pz" })],
    agents: [av("r", { workspaceId: "wx", status: "running" }), ...many(3, "wy", "y"), ...many(2, "wz", "z")] });
  const m = buildModel(snap, { roomsPerBuilding: 2 });
  assert.deepEqual(m.rooms.map((r) => r.projectId), ["py", "px"]);
  const c = buildModel({ projects: [pv("p")], workspaces: [wv("w1", { projectId: "p" })], agents: [av("c1", { parentAgentId: "b1" }), av("b2"), av("b1"), av("r1", { status: "running" })] }, { agentsPerCluster: 3 });
  assert.deepEqual(drawnIds(c), ["r1", "b1", "b2"]);
  const g = buildModel({ projects: [pv("p")], workspaces: [wv("w1"), wv("w2")], agents: [av("b1", { workspaceId: "w1" }), av("c1", { workspaceId: "w1", parentAgentId: "b1", status: "running" }), av("b2", { workspaceId: "w2", status: "running" }), av("b3", { workspaceId: "w2" })] }, { maxDrawn: 3 });
  assert.deepEqual(drawnIds(g).sort(), ["b1", "b2", "b3"]);
  const reversed = { ...snap, agents: [...snap.agents].reverse(), workspaces: [...snap.workspaces].reverse() };
  assert.deepEqual(buildModel(reversed), buildModel(snap));
});

test("OFFC-06 parents: a parent link needs a drawn parent in the same room", () => {
  const m = buildModel({ projects: [pv("p1"), pv("p2")], workspaces: [wv("w1"), wv("w2"), wv("w3", { projectId: "p2" })],
    agents: [av("a"), av("kidA", { workspaceId: "w2", parentAgentId: "a" }), av("orph", { parentAgentId: "ghost" }), av("far", { workspaceId: "w3", parentAgentId: "a" }), av("m1", { parentAgentId: "m2" }), av("m2", { parentAgentId: "m1" })] });
  const all = Object.fromEntries(m.rooms.flatMap((r) => r.clusters.flatMap((c) => c.drawn)).map((d) => [d.agentId, d]));
  assert.equal(all.kidA.parentId, "a");
  assert.deepEqual([all.orph.isChild, all.orph.parentId, all.far.parentId], [true, null, null]);
  assert.deepEqual([all.m1.parentId, all.m2.parentId, all.m1.isChild], ["m2", "m1", true]);
  const cut = buildModel({ projects: [pv("p")], workspaces: [wv("w1", { projectId: "p" })], agents: [av("x1"), av("x2"), av("p0", { parentAgentId: "root" }), av("c", { parentAgentId: "p0", status: "running" })] }, { agentsPerCluster: 3 });
  assert.deepEqual(cut.rooms[0].clusters[0].drawn.find((d) => d.agentId === "c"), { agentId: "c", parentId: null, isChild: true });
});

test("OFFC-06 status: workspace lights and cluster fields", () => {
  const lights = { needs_input: "waiting", failed: "failed", running: "active", attention: "alert", done: "idle" };
  for (const [status, light] of Object.entries(lights)) {
    assert.equal(workspaceLight(status), light);
    assert.equal(buildModel({ projects: [pv("p1")], workspaces: [wv("w1", { status })], agents: [] }).rooms[0].clusters[0].status, status);
  }
  assert.equal(new Set(Object.values(lights)).size, 5);
  const c = buildModel({ projects: [pv("p1")], workspaces: [wv("w1", { kind: "worktree", diffAdditions: 3, diffDeletions: 1 }), wv("w2")], agents: [] }).rooms[0].clusters;
  assert.deepEqual([c[0].kind, c[0].diffAdditions, c[0].diffDeletions, c[1].kind, c[1].diffAdditions], ["worktree", 3, 1, null, null]);
});

test("OFFC-12 resolve: a handoff resolves only to a drawn child with its drawn parent", () => {
  const m = buildModel({ projects: [pv("p1")], workspaces: [wv("w1")], agents: [av("par"), av("kid", { parentAgentId: "par" }), av("lone"), av("o", { parentAgentId: "ghost" })] });
  assert.deepEqual(resolveHandoff(m, { childId: "kid", parentId: "par" }), { childId: "kid", parentId: "par", projectId: "p1", workspaceId: "w1" });
  for (const h of [{ childId: "kid", parentId: "other" }, { childId: "nobody", parentId: "par" }, { childId: "lone", parentId: "par" }, { childId: "o", parentId: "ghost" }]) assert.equal(resolveHandoff(m, h), null);
  const cut = buildModel({ projects: [pv("p1")], workspaces: [wv("w1")], agents: [av("par"), av("kid", { parentAgentId: "par" })] }, { maxDrawn: 1 });
  assert.equal(resolveHandoff(cut, { childId: "kid", parentId: "par" }), null);
});

test("OFFC-06 edge: empty, unknown project, duplicates, bad caps and zero bound", () => {
  assert.deepEqual(buildModel({ projects: [], workspaces: [], agents: [] }), { rooms: [], surplusAgents: 0, totalAgents: 0, drawnAgents: 0 });
  const m = buildModel({ projects: [], workspaces: [wv("w1", { projectId: "pq" })], agents: [av("a")] });
  assert.equal(m.rooms[0].name, "pq");
  const d = buildModel({ projects: [pv("p1"), pv("p1")], workspaces: [wv("w1"), wv("w1")], agents: [av("a"), av("a")] });
  assert.deepEqual([d.totalAgents, d.rooms.length, d.rooms[0].clusters.length], [1, 1, 1]);
  for (const caps of [{ agentsPerCluster: -1 }, { clustersPerRoom: 1.5 }, { roomsPerBuilding: -2 }, { maxDrawn: NaN }]) assert.throws(() => buildModel({ projects: [], workspaces: [], agents: [] }, caps), RangeError);
  const z = buildModel({ projects: [pv("p1")], workspaces: [wv("w1")], agents: [av("a"), av("b")] }, { maxDrawn: 0 });
  assert.deepEqual([z.drawnAgents, z.rooms[0].clusters[0].surplusAgents], [0, 2]);
  assert.equal(ID_MAX_CHARS, 200);
});

test("OFFC-06 invariants: 60 seeded snapshots keep the accounting and parent rules", () => {
  let seed = 12345;
  const rnd = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let round = 0; round < 60; round++) {
    const projects = Array.from({ length: rnd(4) }, (_, i) => pv(`p${i}`));
    const workspaces = Array.from({ length: rnd(6) }, (_, i) => wv(`w${i}`, { projectId: `p${rnd(5)}` }));
    const n = rnd(40);
    const agents = Array.from({ length: n }, (_, i) => av(`a${i}`, { workspaceId: rnd(7) === 0 ? null : `w${rnd(7)}`, status: ["idle", "running", "error"][rnd(3)], parentAgentId: rnd(3) === 0 ? `a${rnd(n + 3)}` : null }));
    const caps = { agentsPerCluster: rnd(5), clustersPerRoom: rnd(3), roomsPerBuilding: rnd(4), maxDrawn: rnd(12) };
    const m = buildModel({ projects, workspaces, agents }, caps);
    assert.equal(total(m), m.totalAgents);
    assert.ok(m.drawnAgents <= caps.maxDrawn);
    const ids = drawnIds(m);
    assert.equal(new Set(ids).size, ids.length);
    for (const r of m.rooms) {
      const inRoom = new Set(r.clusters.flatMap((c) => c.drawn.map((d) => d.agentId)));
      for (const c of r.clusters) for (const dr of c.drawn) if (dr.parentId !== null) assert.ok(inRoom.has(dr.parentId));
    }
    assert.deepEqual(buildModel({ projects, workspaces, agents }, caps), m);
  }
});
