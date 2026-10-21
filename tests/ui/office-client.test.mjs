import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, test } from "node:test";
import { buildBuilding } from "../../plugins/office/client/layout/building.ts";
import { drawerModel } from "../../plugins/office/client/drawer-model.ts";
import { CHILDREN_MAX_ITEMS, CONTEXT_WARN_PERCENT, ERROR_MAX_CHARS, LABEL_MAX_CHARS, SIDEBAR_MAX_ROWS, TODO_MAX_ITEMS, TODO_TEXT_MAX_CHARS, USAGE_SLOT_MIN_WIDTH_PX } from "../../plugins/office/client/limits-panels.ts";
import { initialExpanded, sidebarRows, sidebarTree } from "../../plugins/office/client/sidebar-model.ts";
import { AGENT_STATUS_KEY, ATTENTION_KEY, STRINGS, TODO_STATUS_KEY, TOOL_KEY, WORKSPACE_KIND_KEY, WORKSPACE_STATUS_KEY, clipText, text } from "../../plugins/office/client/strings.ts";
import { TOPBAR_COUNTERS, topbarModel } from "../../plugins/office/client/topbar-model.ts";
import { AGENT_STATUSES, ATTENTION_REASONS, TODO_STATUSES, TOOL_KINDS, WORKSPACE_KINDS, WORKSPACE_STATUSES } from "../../plugins/office/shared/model-types.ts";
import { KIT_DIR } from "../helpers/temp.mjs";
import { fakeHost } from "./office-host.mjs";

const CLIENT = path.join(KIT_DIR, "plugins", "office", "client");
const read = (file) => fs.readFileSync(path.join(CLIENT, file), "utf8").replace(/\r\n/g, "\n");
const OWNED_SOURCES = ["limits-panels.ts", "strings.ts", "sidebar-model.ts", "drawer-model.ts", "topbar-model.ts", "sidebar.tsx", "drawer.tsx", "topbar.tsx"];
const TSX_SOURCES = ["sidebar.tsx", "drawer.tsx", "topbar.tsx"];

// ---- fixtures

const agent = (id, over = {}) => ({
  id,
  title: `Agent ${id}`,
  projectId: null,
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
  lastTool: null,
  activity: null,
  todos: [],
  runId: null,
  updatedAt: null,
  ...over,
});
const workspace = (id, projectId, over = {}) => ({ id, projectId, name: `ws ${id}`, kind: "checkout", status: "running", diffAdditions: null, diffDeletions: null, ...over });
const project = (id) => ({ id, name: `Project ${id}` });

// 3 projects, 4 workspaces, 8 agents; a2 is a child of a1 and a8 has no workspace.
const fixtureSnapshot = () => ({
  projects: [project("p1"), project("p2"), project("p3")],
  workspaces: [workspace("w1", "p1"), workspace("w2", "p1"), workspace("w3", "p2"), workspace("w4", "p3")],
  agents: [
    agent("a1", { workspaceId: "w1", status: "running" }),
    agent("a2", { workspaceId: "w1", parentAgentId: "a1" }),
    agent("a3", { workspaceId: "w2" }),
    agent("a4", { workspaceId: "w2" }),
    agent("a5", { workspaceId: "w3", status: "error", requiresAttention: true }),
    agent("a6", { workspaceId: "w3" }),
    agent("a7", { workspaceId: "w4" }),
    agent("a8", { workspaceId: null }),
  ],
});
const modelFor = (snap, drawnIds) => ({
  rooms: snap.projects.map((p) => ({
    projectId: p.id,
    name: p.name,
    surplusAgents: 0,
    clusters: snap.workspaces
      .filter((w) => w.projectId === p.id)
      .map((w) => ({
        workspaceId: w.id,
        name: w.name,
        status: w.status,
        kind: w.kind,
        diffAdditions: null,
        diffDeletions: null,
        surplusAgents: 0,
        drawn: snap.agents.filter((a) => a.workspaceId === w.id && drawnIds.has(a.id)).map((a) => ({ agentId: a.id, parentId: null, isChild: false })),
      })),
  })),
  surplusAgents: 0,
  totalAgents: snap.agents.length,
  drawnAgents: drawnIds.size,
});
const allIds = (snap) => new Set(snap.agents.map((a) => a.id));
const buildingFor = (snap, roomCount) => buildBuilding(snap.projects.slice(0, roomCount).map((p, i) => ({ id: p.id, slot: i, seed: i + 1 })));
const treeOf = (snap, roomCount = 3, drawn = allIds(snap)) => {
  const building = buildingFor(snap, roomCount);
  return { building, tree: sidebarTree(snap, modelFor(snap, drawn), building) };
};
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children)]);
const byId = (tree, id) => flat(tree.nodes).find((n) => n.id === id);
const inside = (r, outer) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
const roomRect = (building, projectId) => building.areas.find((a) => a.id === `room:${projectId}`).rect;

// ---- Task 1: strings, key maps, sidebar tree

test("OFFC-19 strings: every value is text, text() substitutes one pass, clipText flattens and bounds", () => {
  for (const [key, value] of Object.entries(STRINGS)) assert.ok(typeof value === "string" && value.length > 0, key);
  assert.equal(text("sidebarMoreRows", { count: 7 }), "+7 more");
  assert.equal(text("sceneDiff", { additions: 1 }), "+1 -{deletions}");
  assert.equal(text("sidebarMoreRows", { count: "{count}" }), "+{count} more");
  assert.equal(text("sceneSurplus", { constructor: "x" }), "+{count} agents");
  for (const key of Object.keys(STRINGS)) assert.doesNotThrow(() => text(key));
  assert.equal(clipText(null, 10), "");
  assert.equal(clipText(42, 10), "");
  assert.equal(clipText("   ", 10), "");
  assert.equal(clipText("a\nb\tc\u0000d", 40), "a b c d");
  const long = clipText("x".repeat(10_000), 40);
  assert.equal(long.length, 40);
  assert.ok(long.endsWith("…"));
  assert.equal(clipText("short", 40), "short");
  assert.equal(clipText("x".repeat(40), 40), "x".repeat(40));
  const scene = { sceneSurplus: "+{count} agents", sceneDiff: "+{additions} -{deletions}", sceneZoomIn: "Zoom in", sceneZoomOut: "Zoom out", sceneZoomLevel: "{zoom}x", screenLoading: "Loading projects", screenFailed: "Could not read your projects" };
  for (const [key, value] of Object.entries(scene)) assert.equal(STRINGS[key], value, key);
  assert.equal(text("sceneSurplus", { count: 3 }), "+3 agents");
  assert.equal(text("sceneDiff", { additions: 12, deletions: 4 }), "+12 -4");
  assert.equal(text("sceneZoomLevel", { zoom: 3 }), "3x");
});

test("OFFC-19 key maps: every union member maps to a key of STRINGS", () => {
  const maps = [
    [AGENT_STATUSES, AGENT_STATUS_KEY],
    [WORKSPACE_STATUSES, WORKSPACE_STATUS_KEY],
    [WORKSPACE_KINDS, WORKSPACE_KIND_KEY],
    [ATTENTION_REASONS, ATTENTION_KEY],
    [TOOL_KINDS, TOOL_KEY],
    [TODO_STATUSES, TODO_STATUS_KEY],
  ];
  for (const [members, map] of maps) {
    assert.equal(Object.keys(map).length, members.length);
    for (const member of members) assert.ok(Object.hasOwn(map, member) && Object.hasOwn(STRINGS, map[member]), member);
  }
});

test("OFFC-14 tree: project > workspace > agent in snapshot order with an unplaced group", () => {
  const snap = fixtureSnapshot();
  const { tree } = treeOf(snap);
  assert.deepEqual(tree.nodes.map((n) => n.id), ["project:p1", "project:p2", "project:p3", "unplaced"]);
  assert.deepEqual(byId(tree, "project:p1").children.map((n) => n.id), ["workspace:w1", "workspace:w2"]);
  assert.deepEqual(byId(tree, "workspace:w1").children.map((n) => n.id), ["agent:a1", "agent:a2"]);
  assert.equal(byId(tree, "agent:a2").isChild, true);
  assert.equal(byId(tree, "agent:a1").isChild, false);
  assert.deepEqual(byId(tree, "unplaced").children.map((n) => n.id), ["agent:a8"]);
  assert.equal(byId(tree, "agent:a5").attention, true);
  assert.equal(byId(tree, "agent:a5").statusKey, "statusError");
  assert.equal(byId(tree, "workspace:w1").statusKey, "workspaceRunning");
  snap.workspaces.push(workspace("w9", "zz"));
  const withOrphan = treeOf(snap).tree;
  assert.ok(byId(withOrphan, "unplaced").children.some((n) => n.id === "workspace:w9"));
  const empty = sidebarTree({ projects: [], workspaces: [], agents: [] }, modelFor({ projects: [], workspaces: [], agents: [] }, new Set()), buildingFor({ projects: [] }, 0));
  assert.deepEqual(empty.nodes, []);
});

test("OFFC-14 camera targets: every node has a target inside the building; rooms get their room rect", () => {
  const snap = fixtureSnapshot();
  const { building, tree } = treeOf(snap, 2);
  assert.equal(tree.root.scope, "building");
  for (const node of flat(tree.nodes)) assert.ok(inside(node.target.rect, building.rect), node.id);
  const p1 = byId(tree, "project:p1");
  assert.equal(p1.target.scope, "room");
  assert.deepEqual(p1.target.rect, roomRect(building, "p1"));
  const w1 = byId(tree, "workspace:w1");
  assert.deepEqual([w1.target.scope, w1.target.workspaceId, w1.target.roomId], ["cluster", "w1", "p1"]);
  assert.deepEqual(w1.target.rect, roomRect(building, "p1"));
  const a1 = byId(tree, "agent:a1");
  assert.deepEqual([a1.target.scope, a1.target.agentId, a1.target.workspaceId], ["agent", "a1", "w1"]);
  for (const id of ["project:p3", "workspace:w4", "agent:a7", "unplaced", "agent:a8"]) {
    const t = byId(tree, id).target;
    assert.equal(t.scope, "building", id);
    assert.deepEqual(t.rect, building.rect, id);
  }
});

test("OFFC-14 drawn flag: drawn only when some cluster draws the agent", () => {
  const snap = fixtureSnapshot();
  const drawn = allIds(snap);
  drawn.delete("a6");
  const { tree } = treeOf(snap, 3, drawn);
  assert.equal(byId(tree, "agent:a6").drawn, false);
  assert.equal(byId(tree, "agent:a6").target.scope, "agent");
  assert.equal(byId(tree, "agent:a5").drawn, true);
  assert.equal(byId(tree, "project:p1").drawn, true);
});

test("OFFC-14 rows: depth-first, collapsible, capped with an exact hidden count", () => {
  const snap = fixtureSnapshot();
  const { tree } = treeOf(snap);
  const expanded = initialExpanded(tree);
  const full = sidebarRows(tree, expanded, SIDEBAR_MAX_ROWS);
  assert.equal(full.hidden, 0);
  assert.equal(full.rows.length, 16);
  assert.deepEqual(full.rows.slice(0, 4).map((r) => [r.node.id, r.depth]), [["project:p1", 0], ["workspace:w1", 1], ["agent:a1", 2], ["agent:a2", 2]]);
  expanded.delete("workspace:w1");
  expanded.add("not-in-the-tree");
  const collapsed = sidebarRows(tree, expanded, SIDEBAR_MAX_ROWS);
  const w1 = collapsed.rows.find((r) => r.node.id === "workspace:w1");
  assert.deepEqual([w1.hasChildren, w1.expanded], [true, false]);
  assert.ok(!collapsed.rows.some((r) => r.node.id === "agent:a1"));
  const capped = sidebarRows(tree, initialExpanded(tree), 5);
  assert.equal(capped.rows.length, 5);
  assert.equal(capped.hidden, 11);
  assert.deepEqual(capped.rows.map((r) => r.node.id), full.rows.slice(0, 5).map((r) => r.node.id));
});

test("OFFC-14 edge: hostile ids, cycles, long titles and null fields never throw", () => {
  const snap = fixtureSnapshot();
  snap.agents.push(
    agent("__proto__", { workspaceId: "w1" }),
    agent("constructor", { workspaceId: "w1" }),
    agent("toString", { workspaceId: "w1" }),
    agent("dup", { workspaceId: "w1", title: "first" }),
    agent("dup", { workspaceId: "w1", title: "second" }),
    agent("self", { workspaceId: "w1", parentAgentId: "self" }),
    agent("long", { workspaceId: "w1", title: `${"x\n".repeat(5000)}` }),
    agent("untitled", { workspaceId: "w1", title: null }),
    { id: 5, title: {}, workspaceId: [] },
  );
  snap.workspaces.push({ id: "wnull", projectId: "p1", name: null, kind: null, status: "bogus" });
  snap.projects.push({ id: "pbad", name: 7 });
  let first;
  assert.doesNotThrow(() => {
    first = treeOf(snap).tree;
  });
  const ids = flat(first.nodes).map((n) => n.id);
  assert.equal(ids.filter((id) => id === "agent:dup").length, 2);
  for (const id of ["agent:__proto__", "agent:constructor", "agent:toString"]) assert.ok(ids.includes(id), id);
  assert.equal(byId(first, "agent:self").isChild, false);
  const long = byId(first, "agent:long");
  assert.ok(long.label.length <= LABEL_MAX_CHARS && !long.label.includes("\n"));
  assert.equal(byId(first, "agent:untitled").label, null);
  assert.equal(byId(first, "workspace:wnull").label, null);
  assert.equal(byId(first, "workspace:wnull").statusKey, null);
  const second = treeOf(snap).tree;
  assert.notEqual(first.nodes[0], second.nodes[0]);
  assert.notEqual(first.nodes[0].target, second.nodes[0].target);
  assert.notEqual(first.nodes[0].target.rect, second.nodes[0].target.rect);
  assert.doesNotThrow(() => sidebarTree({ projects: "x", workspaces: null, agents: 5 }, { rooms: "x" }, buildingFor({ projects: [] }, 0)));
  assert.doesNotThrow(() => sidebarTree({ projects: [null], workspaces: [null, 3], agents: [null, "s"] }, { rooms: [null, { clusters: [null] }] }, buildingFor({ projects: [] }, 0)));
});

// ---- Task 2: drawer and top bar view-models

const snapWith = (...agents) => ({ projects: [], workspaces: [], agents });
const todo = (textValue, status) => ({ text: textValue, status });

test("OFFC-15 drawer: presents activity, ordered todos, children and the last error", () => {
  const snap = snapWith(
    agent("A", { title: "Main", status: "running", lastTool: "edit", activity: "tool", lastError: "boom", todos: [todo("one", "completed"), todo("two", "in_progress"), todo("three", "pending")] }),
    agent("C1", { parentAgentId: "A", title: "Kid 1", status: "running" }),
    agent("C2", { parentAgentId: "A", title: null }),
    agent("Z"),
  );
  const m = drawerModel(snap, "A");
  assert.equal(m.agentId, "A");
  assert.equal(m.label, "Main");
  assert.equal(m.statusKey, "statusRunning");
  assert.equal(m.toolKey, "toolEdit");
  assert.equal(m.activityKey, "activityTool");
  assert.deepEqual(m.todos.map((t) => [t.text, t.status, t.statusKey]), [["one", "completed", "todoCompleted"], ["two", "in_progress", "todoInProgress"], ["three", "pending", "todoPending"]]);
  assert.deepEqual(m.children.map((c) => [c.id, c.label, c.statusKey]), [["C1", "Kid 1", "statusRunning"], ["C2", null, "statusIdle"]]);
  assert.equal(m.lastError, "boom");
  for (const id of ["nope", null, 7, undefined]) assert.equal(drawerModel(snap, id), null);
  assert.equal(drawerModel({ projects: [], workspaces: [], agents: [] }, "A"), null);
});

test("OFFC-15 empty sections: nothing is guessed for an absent value", () => {
  const m = drawerModel(snapWith(agent("A", { lastError: "  \n\t ", lastTool: null, activity: null })), "A");
  assert.deepEqual([m.todos, m.hiddenTodos, m.children, m.lastError, m.toolKey, m.activityKey], [[], 0, [], null, null, "activityNone"]);
  assert.deepEqual([m.provider, m.model, m.attentionKey, m.permissions], [null, null, null, 0]);
});

test("OFFC-15 children: a filter on parentAgentId, bounded, cycle and self safe", () => {
  const cycle = snapWith(agent("A", { parentAgentId: "B" }), agent("B", { parentAgentId: "A" }), agent("S", { parentAgentId: "S" }));
  assert.deepEqual(drawerModel(cycle, "A").children.map((c) => c.id), ["B"]);
  assert.deepEqual(drawerModel(cycle, "B").children.map((c) => c.id), ["A"]);
  assert.deepEqual(drawerModel(cycle, "S").children, []);
  const kids = Array.from({ length: CHILDREN_MAX_ITEMS + 7 }, (_, i) => agent(`k${i}`, { parentAgentId: "P" }));
  const m = drawerModel(snapWith(agent("P"), ...kids), "P");
  assert.equal(m.children.length, CHILDREN_MAX_ITEMS);
  assert.equal(m.hiddenChildren, 7);
});

test("OFFC-15 bounds: huge todo lists and texts are clipped, bad values are kept as nothing", () => {
  const todos = Array.from({ length: 10_000 }, () => todo("t".repeat(5000), "pending"));
  const m = drawerModel(snapWith(agent("A", { todos, lastError: "e\n".repeat(5000) })), "A");
  assert.equal(m.todos.length, TODO_MAX_ITEMS);
  assert.equal(m.hiddenTodos, 10_000 - TODO_MAX_ITEMS);
  assert.ok(m.todos.every((t) => t.text.length <= TODO_TEXT_MAX_CHARS));
  assert.ok(m.lastError.length <= ERROR_MAX_CHARS && !m.lastError.includes("\n"));
  const odd = drawerModel(snapWith(agent("A", { todos: [todo("x", "weird"), null] })), "A");
  assert.deepEqual(odd.todos.map((t) => [t.text, t.status, t.statusKey]), [["x", null, null], ["", null, null]]);
  assert.deepEqual(drawerModel(snapWith(agent("A", { todos: "nope" })), "A").todos, []);
});

test("OFFC-21 attention: reason shown only when attention is required; provider and model are clipped text", () => {
  const key = (over) => drawerModel(snapWith(agent("A", over)), "A").attentionKey;
  assert.equal(key({ requiresAttention: true, attentionReason: "permission" }), "attentionPermission");
  assert.equal(key({ requiresAttention: true, attentionReason: "finished" }), "attentionFinished");
  assert.equal(key({ requiresAttention: true, attentionReason: "error" }), "attentionError");
  assert.equal(key({ requiresAttention: false, attentionReason: "error" }), null);
  assert.equal(key({ requiresAttention: true, attentionReason: null }), null);
  const m = drawerModel(snapWith(agent("A", { pendingPermissions: 3, provider: "claude", model: "m".repeat(500) })), "A");
  assert.equal(m.permissions, 3);
  assert.equal(m.provider, "claude");
  assert.ok(m.model.length <= LABEL_MAX_CHARS);
  assert.equal(drawerModel(snapWith(agent("A", { pendingPermissions: "x" })), "A").permissions, 0);
});

test("OFFC-21 information bound: extra fields never reach the drawer model", () => {
  const m = drawerModel(snapWith(agent("A", { cwd: "C:/secret/dir", prompt: "do the secret thing", filePath: "/etc/passwd" })), "A");
  const json = JSON.stringify(m);
  for (const value of ["C:/secret/dir", "do the secret thing", "/etc/passwd"]) assert.ok(!json.includes(value), value);
});

test("OFFC-16 counters: by state, attention and total", () => {
  const snap = snapWith(
    ...["r1", "r2", "r3"].map((id) => agent(id, { status: "running", requiresAttention: id === "r1" })),
    agent("i1"),
    agent("i2"),
    agent("n1", { status: "initializing" }),
    agent("e1", { status: "error", requiresAttention: true }),
    agent("c1", { status: "closed" }),
    agent("c2", { status: "closed" }),
  );
  assert.deepEqual(topbarModel(snap, null).counters, { running: 3, attention: 2, error: 1, idle: 2, initializing: 1, closed: 2, total: 9 });
  assert.deepEqual(topbarModel(snapWith(), null).counters, { running: 0, attention: 0, error: 0, idle: 0, initializing: 0, closed: 0, total: 0 });
  assert.deepEqual(topbarModel(snapWith(agent("u", { status: "weird" })), null).counters, { running: 0, attention: 0, error: 0, idle: 0, initializing: 0, closed: 0, total: 1 });
  assert.deepEqual(TOPBAR_COUNTERS.map((c) => c.id), ["running", "attention", "error", "idle", "initializing", "closed", "total"]);
  for (const c of TOPBAR_COUNTERS) assert.ok(Object.hasOwn(STRINGS, c.labelKey), c.labelKey);
});

test("OFFC-16 context: selected agent first, else the busiest open agent, never a guess", () => {
  const ctx = (used, max, over = {}) => agent(over.id ?? "S", { contextUsedTokens: used, contextMaxTokens: max, ...over });
  const pick = (a) => topbarModel(snapWith(a), "S").context;
  assert.deepEqual(pick(ctx(50_000, 200_000)), { agentId: "S", usedTokens: 50_000, maxTokens: 200_000, percent: 25, warn: false, source: "selected" });
  assert.equal(pick(ctx(130_000, 200_000)).percent, 65);
  assert.equal(pick(ctx(130_000, 200_000)).warn, true);
  assert.equal(pick(ctx((200_000 * CONTEXT_WARN_PERCENT) / 100, 200_000)).warn, true);
  assert.equal(pick(ctx(300_000, 200_000)).percent, 100);
  for (const max of [null, undefined, 0, -5, NaN, Infinity]) assert.equal(pick(ctx(10, max)), null, String(max));
  assert.equal(pick(ctx(null, 100)), null);
  const others = [ctx(10, 100, { id: "x" }), ctx(90, 100, { id: "y", status: "closed" }), ctx(40, 100, { id: "z" }), ctx(40, 100, { id: "w" })];
  assert.equal(topbarModel(snapWith(agent("S"), ...others), "S").context, null);
  for (const selected of [null, "missing"]) {
    const c = topbarModel(snapWith(...others), selected).context;
    assert.deepEqual([c.agentId, c.percent, c.source], ["z", 40, "busiest"]);
  }
  assert.equal(topbarModel(snapWith(agent("q")), null).context, null);
});

test("OFFC-16 usage slot: always null and no usage call exists in the models", () => {
  const snap = snapWith(agent("A", { provider: "claude", model: "x", contextUsedTokens: 1, contextMaxTokens: 2 }));
  for (const selected of [null, "A"]) assert.equal(topbarModel(snap, selected).usageSlot, null);
  assert.equal(topbarModel(snapWith(), null).usageSlot, null);
  for (const file of ["drawer-model.ts", "topbar-model.ts"]) assert.ok(!read(file).includes("listUsage"), file);
});

// ---- Task 3: component renders and source gates

const host = await fakeHost();
after(() => host.dispose());

const colors = { surface1: "#111111", surface2: "#222222", border: "#333333", foreground: "#eeeeee", foregroundMuted: "#999999", accent: "#3366ff", statusWarning: "#ffaa00", statusDanger: "#ff0000" };
const textOf = (n) => (typeof n === "string" ? n : Array.isArray(n) ? n.map(textOf).join("") : n && typeof n === "object" ? textOf(n.children) : "");
const textsOf = (handle) => handle.find("Text").map(textOf);
const withTestId = (handle, type, testID) => handle.find(type).filter((n) => n.props.testID === testID);

function sidebarProps(snap = fixtureSnapshot(), over = {}) {
  const { tree } = treeOf(snap);
  const { rows, hidden } = sidebarRows(tree, initialExpanded(tree), SIDEBAR_MAX_ROWS);
  return { rows, hidden, selectedId: null, colors, onSelect() {}, onToggle() {}, ...over };
}

test("OFFC-14 sidebar render: rows select, toggles toggle, fallbacks and the hidden count come from the table", () => {
  const selects = [];
  const toggles = [];
  const props = sidebarProps(fixtureSnapshot(), { onSelect: (n) => selects.push(n), onToggle: (id) => toggles.push(id) });
  const h = host.mountModule("client/sidebar.tsx", "Sidebar", props);
  const rows = withTestId(h, "Pressable", "office-sidebar-row");
  assert.equal(rows.length, props.rows.length);
  rows[2].props.onPress();
  assert.deepEqual([selects.length, selects[0], toggles.length], [1, props.rows[2].node, 0]);
  const toggleButtons = withTestId(h, "Pressable", "office-sidebar-toggle");
  assert.equal(toggleButtons.length, props.rows.filter((r) => r.hasChildren).length);
  toggleButtons[0].props.onPress();
  assert.deepEqual([toggles, selects.length], [[props.rows.find((r) => r.hasChildren).node.id], 1]);

  const sel = host.mountModule("client/sidebar.tsx", "Sidebar", { ...props, selectedId: props.rows[1].node.id });
  const styles = withTestId(sel, "Pressable", "office-sidebar-row").map((n) => n.props.style.backgroundColor);
  assert.notEqual(styles[1], styles[0]);

  const blank = fixtureSnapshot();
  blank.projects[0].name = "";
  blank.workspaces[0].name = "";
  blank.agents[0].title = null;
  const fallbackTexts = textsOf(host.mountModule("client/sidebar.tsx", "Sidebar", sidebarProps(blank)));
  for (const key of ["sidebarUnnamedProject", "sidebarUnnamedWorkspace", "sidebarUntitledAgent"]) assert.ok(fallbackTexts.includes(text(key)), key);

  assert.ok(textsOf(host.mountModule("client/sidebar.tsx", "Sidebar", { ...props, hidden: 7 })).includes(text("sidebarMoreRows", { count: 7 })));
  assert.ok(textsOf(host.mountModule("client/sidebar.tsx", "Sidebar", { ...props, rows: [], hidden: 0 })).includes(text("sidebarEmpty")));

  const hostile = fixtureSnapshot();
  hostile.agents[0].title = "y".repeat(10_000);
  assert.ok(textsOf(host.mountModule("client/sidebar.tsx", "Sidebar", sidebarProps(hostile))).every((t) => t.length <= LABEL_MAX_CHARS));
});

function fullDrawerModel() {
  const snap = snapWith(
    agent("A", { title: "Main", status: "running", lastTool: "edit", activity: "tool", lastError: "it broke", provider: "claude", model: "opus", requiresAttention: true, attentionReason: "permission", pendingPermissions: 2, todos: [todo("write tests", "in_progress")] }),
    agent("C", { parentAgentId: "A", title: "Kid" }),
  );
  return drawerModel(snap, "A");
}

test("OFFC-15 drawer render: sections, todo and child lines, error, details and close", () => {
  let closed = 0;
  const h = host.mountModule("client/drawer.tsx", "Drawer", { model: fullDrawerModel(), colors, onClose: () => closed++ });
  const texts = textsOf(h);
  for (const key of ["drawerSectionActivity", "drawerSectionTodos", "drawerSectionChildren", "drawerSectionError", "drawerSectionDetails", "drawerProvider", "drawerModel", "drawerPermissions"]) assert.ok(texts.includes(text(key)), key);
  for (const shown of ["Main", "write tests", text("todoInProgress"), "Kid", "it broke", "claude", "opus", text("attentionPermission"), "2"]) assert.ok(texts.includes(shown), shown);
  withTestId(h, "Pressable", "office-drawer-close")[0].props.onPress();
  assert.equal(closed, 1);

  const bare = textsOf(host.mountModule("client/drawer.tsx", "Drawer", { model: drawerModel(snapWith(agent("A")), "A"), colors, onClose() {} }));
  for (const key of ["drawerNoTodos", "drawerNoChildren", "drawerNoError"]) assert.ok(bare.includes(text(key)), key);
  for (const key of ["drawerProvider", "drawerModel", "drawerSectionDetails", "drawerPermissions"]) assert.ok(!bare.includes(text(key)), key);

  const none = host.mountModule("client/drawer.tsx", "Drawer", { model: null, colors, onClose() {} });
  assert.deepEqual(none.tree, []);
});

test("OFFC-16 topbar render: counters, context bar and the empty usage slot", () => {
  const snap = snapWith(agent("A", { status: "running", contextUsedTokens: 50_000, contextMaxTokens: 200_000 }));
  const model = topbarModel(snap, "A");
  const h = host.mountModule("client/topbar.tsx", "TopBar", { model, colors });
  const texts = textsOf(h);
  for (const c of TOPBAR_COUNTERS) {
    const at = texts.indexOf(text(c.labelKey));
    assert.ok(at >= 0, c.id);
    assert.equal(texts[at + 1], String(model.counters[c.id]), c.id);
  }
  assert.ok(texts.includes(text("contextPercent", { percent: 25 })));
  assert.ok(texts.includes(text("contextTokens", { used: 50_000, max: 200_000 })));
  assert.ok(!texts.includes(text("contextHigh")));
  const widths = h.find("View").map((n) => n.props.style?.width).filter((w) => typeof w === "string");
  assert.deepEqual(widths, ["25%"]);

  const hot = textsOf(host.mountModule("client/topbar.tsx", "TopBar", { model: topbarModel(snapWith(agent("A", { contextUsedTokens: 190_000, contextMaxTokens: 200_000 })), "A"), colors }));
  assert.ok(hot.includes(text("contextHigh")));

  const noCtx = host.mountModule("client/topbar.tsx", "TopBar", { model: topbarModel(snapWith(agent("A")), "A"), colors });
  assert.ok(!textsOf(noCtx).includes(text("contextLabel")));
  assert.deepEqual(noCtx.find("View").map((n) => n.props.style?.width).filter((w) => typeof w === "string"), []);

  for (const handle of [h, noCtx]) {
    const slots = withTestId(handle, "View", "office-usage-slot");
    assert.equal(slots.length, 1);
    assert.deepEqual(slots[0].children, []);
    assert.equal(slots[0].props.style.minWidth, USAGE_SLOT_MIN_WIDTH_PX);
  }
});

const ts = createRequire(path.join(KIT_DIR, "plugins", "office", "package.json"))("typescript");
const sourceOf = (src) => ts.createSourceFile("x.tsx", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const isLiteral = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);
const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};

function literalProblems(src) {
  const sf = sourceOf(src);
  const problems = [];
  walk(sf, (n) => {
    if (ts.isJsxText(n) && n.text.trim() !== "") problems.push(`jsx text ${n.text.trim()}`);
    if (ts.isJsxExpression(n) && n.expression && isLiteral(n.expression) && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) problems.push("jsx literal expression");
    if (ts.isJsxAttribute(n) && ["accessibilityLabel", "title", "placeholder"].includes(n.name.getText(sf)) && n.initializer) {
      const init = n.initializer;
      if (ts.isStringLiteral(init) || (ts.isJsxExpression(init) && init.expression && isLiteral(init.expression))) problems.push(`literal ${n.name.getText(sf)}`);
    }
  });
  return problems;
}

const BANNED_IN_STYLE = new Set(["label", "title", "text", "lastError", "name", "provider", "model", "id", "agentId", "workspaceId", "projectId", "runId"]);
function uriStyleProblems(src) {
  const sf = sourceOf(src);
  const problems = [];
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && n.text === "uri") problems.push("uri");
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === "style" && n.initializer) {
      walk(n.initializer, (m) => {
        if (ts.isIdentifier(m) && BANNED_IN_STYLE.has(m.text)) problems.push(`style ${m.text}`);
      });
    }
  });
  return problems;
}

function keyProblems(src) {
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  const names = [...code.matchAll(/\bSTRINGS\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  for (const m of code.matchAll(/\btext\(\s*["']([A-Za-z0-9_]+)["']/g)) names.push(m[1]);
  return names.filter((name) => !Object.hasOwn(STRINGS, name));
}

test("OFFC-19 JSX literal gate: no user-visible literal in the components, and the checker can fail", () => {
  assert.equal(literalProblems('const a = <View accessibilityLabel="Close">hi{"x"}</View>;').length, 3);
  for (const file of TSX_SOURCES) assert.deepEqual(literalProblems(read(file)), [], file);
});

test("OFFC-19 key gate: every key used in the owned sources exists, and the checker can fail", () => {
  assert.deepEqual(keyProblems('const a = text("noSuchKey"); const b = STRINGS.alsoMissing; const c = text("sidebarTitle");'), ["alsoMissing", "noSuchKey"]);
  for (const file of OWNED_SOURCES) assert.deepEqual(keyProblems(read(file)), [], file);
  assert.ok(Object.values(STRINGS).every((v) => v.length > 0));
});

test("OFFC-14 uri and style gate: no uri and no agent field in a style, and the checker can fail", () => {
  assert.deepEqual(uriStyleProblems("const a = <View style={{ color: node.label }} />;"), ["style label"]);
  assert.deepEqual(uriStyleProblems("const a = { uri: x };"), ["uri"]);
  for (const file of TSX_SOURCES) assert.deepEqual(uriStyleProblems(read(file)), [], file);
});

test("OFFC-16 and D-09 gates: read-only, no usage call, no timer, host primitives and allowed imports only", () => {
  const forbidden = [
    /listUsage/,
    /child_process/,
    /\b(setInterval|setTimeout)\b/,
    /\bfetch\s*\(/,
    /\bspawn\w*\s*\(/,
    /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|createWriteStream|readFile|readdir)(Sync)?\s*\(/,
    /\.(send|run|archive|create|respondToPermission|setTitle|setModel|cancel|detach|append|waitForFinish)\s*\(/,
  ];
  for (const file of OWNED_SOURCES) {
    const code = read(file).replace(/^\s*\/\/.*$/gm, "");
    for (const re of forbidden) assert.doesNotMatch(code, re, `${file}: ${re}`);
  }
  const allowed = /^(react|react-native|@getpaseo\/plugin|\.\/(strings|limits-panels|sidebar-model|drawer-model|topbar-model)\.ts|\.\/sidebar\.tsx|\.\.\/shared\/model-types\.ts)$/;
  for (const file of TSX_SOURCES) {
    const code = read(file).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /<div\b|<span\b|<svg\b|<canvas\b|\bdocument\.|\bwindow\./, file);
    for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) assert.match(m[1], allowed, `${file}: ${m[1]}`);
    assert.doesNotMatch(code, /import\s+(?!type\b)[^;]*from\s+["']@getpaseo\/plugin["']/, `${file}: the theme import must be type-only`);
  }
});
