import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, test } from "node:test";
import { buildBuilding } from "../../plugins/office/shared/layout/building.ts";
import { drawerModel } from "../../plugins/office/client/drawer-model.ts";
import { CHILDREN_MAX_ITEMS, CONTEXT_WARN_PERCENT, ERROR_MAX_CHARS, LABEL_MAX_CHARS, SIDEBAR_MAX_ROWS, TODO_MAX_ITEMS, TODO_TEXT_MAX_CHARS, USAGE_SLOT_MIN_WIDTH_PX } from "../../plugins/office/client/limits-panels.ts";
import { hideAllProjects, projectList, showAllProjects, toggleProject } from "../../plugins/office/client/sidebar-model.ts";
import { visibleSnapshot } from "../../plugins/office/client/model.ts";
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
const buildingFor = (snap, roomCount) => buildBuilding(snap.projects.slice(0, roomCount).map((p, i) => ({ id: p.id, slot: i, seed: i + 1 })));
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
  const scene = { sceneSurplus: "+{count} agents", sceneDiff: "+{additions} -{deletions}", sceneZoomIn: "Zoom in", sceneZoomOut: "Zoom out", sceneZoomLevel: "{zoom}x", screenLoading: "Loading projects", screenFailedAgents: "Could not read your agents: {error}" };
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

test("OFFC-14 project list: one row per project with counters, the attention dot and a camera target", () => {
  const snap = fixtureSnapshot();
  const building = buildingFor(snap, 2);
  const list = projectList(snap, new Set(), building, SIDEBAR_MAX_ROWS);
  assert.deepEqual(list.rows.map((r) => r.projectId), ["p1", "p2", "p3"]);
  assert.deepEqual(list.rows.map((r) => [r.agents, r.working, r.attention, r.shown]), [[4, 1, false, true], [2, 0, true, true], [1, 0, false, true]]);
  assert.deepEqual([list.more, list.shownCount, list.total], [0, 3, 3]);
  assert.equal(list.rows[0].label, "Project p1");
  assert.deepEqual([list.rows[0].target.scope, list.rows[0].target.roomId], ["room", "p1"]);
  assert.deepEqual(list.rows[0].target.rect, roomRect(building, "p1"));
  // p3 has no room in a two-room building: the camera falls back to the building.
  assert.deepEqual([list.rows[2].target.scope, list.rows[2].target.rect], ["building", building.rect]);
  for (const row of list.rows) assert.ok(inside(row.target.rect, building.rect), row.projectId);
  const empty = projectList({ projects: [], workspaces: [], agents: [] }, new Set(), buildingFor({ projects: [] }, 0), SIDEBAR_MAX_ROWS);
  assert.deepEqual([empty.rows, empty.more, empty.total], [[], 0, 0]);
});

test("OFFC-14 hidden set: toggling, All and None; a new project is shown by default and a stale hidden id is ignored", () => {
  const snap = fixtureSnapshot();
  const building = buildingFor(snap, 3);
  const none = new Set();
  const h1 = toggleProject(none, "p1");
  assert.deepEqual([...h1], ["p1"]);
  assert.deepEqual([...none], [], "the input set is not mutated");
  assert.deepEqual([...toggleProject(h1, "p1")], []);
  const list = projectList(snap, h1, building, SIDEBAR_MAX_ROWS);
  assert.deepEqual(list.rows.map((r) => r.shown), [false, true, true]);
  assert.equal(list.shownCount, 2);
  assert.equal(list.rows.length, 3, "a hidden project stays in the list");
  const all = hideAllProjects(snap);
  assert.deepEqual([...all].sort(), ["p1", "p2", "p3"]);
  assert.equal(projectList(snap, all, building, SIDEBAR_MAX_ROWS).shownCount, 0);
  assert.equal(showAllProjects().size, 0);
  // A project that appears later is shown: the state is the hidden set.
  snap.projects.push(project("p4"));
  assert.equal(projectList(snap, all, building, SIDEBAR_MAX_ROWS).rows.find((r) => r.projectId === "p4").shown, true);
  // A stale hidden id changes nothing and never throws.
  const stale = new Set(["gone", "p2"]);
  const withStale = projectList(snap, stale, building, SIDEBAR_MAX_ROWS);
  assert.deepEqual([withStale.rows.length, withStale.shownCount], [4, 3]);
  assert.deepEqual(visibleSnapshot(snap, new Set(["gone"])), snap);
});

test("OFFC-14 visible snapshot: hidden projects lose their workspaces and agents; agents of no project stay", () => {
  const snap = fixtureSnapshot();
  for (const a of snap.agents) a.projectId = snap.workspaces.find((w) => w.id === a.workspaceId)?.projectId ?? null;
  const v = visibleSnapshot(snap, new Set(["p1"]));
  assert.deepEqual(v.projects.map((p) => p.id), ["p2", "p3"]);
  assert.deepEqual(v.workspaces.map((w) => w.id), ["w3", "w4"]);
  assert.deepEqual(v.agents.map((a) => a.id), ["a5", "a6", "a7", "a8"]);
  assert.equal(visibleSnapshot(snap, new Set()), snap, "nothing hidden: the same object");
  assert.equal(topbarModel(v, null).counters.total, 4, "the top bar counts the visible projects only");
});

test("OFFC-14 rows: capped with an exact count of the rows left out", () => {
  const snap = fixtureSnapshot();
  const capped = projectList(snap, new Set(), buildingFor(snap, 3), 2);
  assert.deepEqual([capped.rows.length, capped.more, capped.total], [2, 1, 3]);
});

test("OFFC-14 edge: hostile ids, long names and null fields never throw", () => {
  const snap = fixtureSnapshot();
  snap.projects.push({ id: "__proto__", name: "x\n".repeat(5000) }, { id: "constructor", name: null }, { id: "dup", name: "first" }, { id: "dup", name: "second" }, { id: 5, name: {} });
  snap.agents.push(agent("toString", { projectId: "__proto__" }), { id: 5, projectId: [] }, null);
  let list;
  assert.doesNotThrow(() => {
    list = projectList(snap, new Set(["__proto__"]), buildingFor(snap, 3), SIDEBAR_MAX_ROWS);
  });
  const ids = list.rows.map((r) => r.projectId);
  assert.deepEqual(ids.filter((id) => id === "dup").length, 1, "a second occurrence of an id is ignored");
  assert.ok(ids.includes("__proto__") && ids.includes("constructor"));
  const proto = list.rows.find((r) => r.projectId === "__proto__");
  assert.ok(proto.label.length <= LABEL_MAX_CHARS && !proto.label.includes("\n"));
  assert.equal(proto.shown, false);
  assert.equal(proto.agents, 1);
  assert.equal(list.rows.find((r) => r.projectId === "constructor").label, null);
  for (const bad of [{ projects: "x", workspaces: null, agents: 5 }, { projects: [null], workspaces: [null, 3], agents: [null, "s"] }, null]) {
    assert.doesNotThrow(() => projectList(bad, new Set(), buildingFor({ projects: [] }, 0), SIDEBAR_MAX_ROWS));
    assert.doesNotThrow(() => hideAllProjects(bad));
    assert.doesNotThrow(() => visibleSnapshot(bad, new Set(["p1"])));
  }
  assert.doesNotThrow(() => projectList(snap, null, buildingFor(snap, 3), SIDEBAR_MAX_ROWS));
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
  const zero = { rooms: 0, subAgents: 0, shells: 0 };
  assert.deepEqual(topbarModel(snap, null).counters, { ...zero, running: 3, attention: 2, error: 1, idle: 2, initializing: 1, closed: 2, total: 9 });
  assert.deepEqual(topbarModel(snapWith(), null).counters, { ...zero, running: 0, attention: 0, error: 0, idle: 0, initializing: 0, closed: 0, total: 0 });
  assert.deepEqual(topbarModel(snapWith(agent("u", { status: "weird" })), null).counters, { ...zero, running: 0, attention: 0, error: 0, idle: 0, initializing: 0, closed: 0, total: 1 });
  assert.deepEqual(TOPBAR_COUNTERS.map((c) => c.id), ["rooms", "total", "subAgents", "running", "attention", "shells", "error", "idle", "initializing", "closed"]);
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
  const list = projectList(snap, over.hiddenSet ?? new Set(), buildingFor(snap, 3), SIDEBAR_MAX_ROWS);
  return { list, colors, onToggle() {}, onShowAll() {}, onHideAll() {}, onFocus() {}, ...over };
}

test("OFFC-14 sidebar render: checkboxes toggle, names move the camera, All and None, fallbacks from the table", () => {
  const toggles = [];
  const focus = [];
  const bulk = [];
  const props = sidebarProps(fixtureSnapshot(), { hiddenSet: new Set(["p2"]), onToggle: (id) => toggles.push(id), onFocus: (row) => focus.push(row), onShowAll: () => bulk.push("all"), onHideAll: () => bulk.push("none") });
  const h = host.mountModule("client/sidebar.tsx", "Sidebar", props);
  const boxes = withTestId(h, "Pressable", "office-sidebar-check");
  assert.equal(boxes.length, 3);
  assert.deepEqual(boxes.map((b) => [b.props.accessibilityRole, b.props.accessibilityState.checked]), [["checkbox", true], ["checkbox", false], ["checkbox", true]]);
  for (const b of boxes) assert.equal(typeof b.props.accessibilityLabel, "string");
  boxes[1].props.onPress();
  assert.deepEqual([toggles, focus.length], [["p2"], 0]);
  const names = withTestId(h, "Pressable", "office-sidebar-row");
  assert.equal(names.length, 3);
  names[0].props.onPress();
  assert.deepEqual([focus.length, focus[0].projectId, toggles.length], [1, "p1", 1]);
  withTestId(h, "Pressable", "office-sidebar-all")[0].props.onPress();
  withTestId(h, "Pressable", "office-sidebar-none")[0].props.onPress();
  assert.deepEqual(bulk, ["all", "none"]);
  const texts = textsOf(h);
  for (const key of ["sidebarProjects", "sidebarAll", "sidebarNone"]) assert.ok(texts.includes(text(key)), key);
  assert.ok(texts.includes(text("sidebarCounts", { agents: 4, working: 1 })));
  assert.equal(withTestId(h, "View", "office-sidebar-attention").length, 1, "p2 has an agent that needs attention");
  assert.ok(!texts.some((t) => t.includes("ws w1") || t.includes("Agent a1")), "no workspace or agent rows");

  const blank = fixtureSnapshot();
  blank.projects[0].name = "";
  assert.ok(textsOf(host.mountModule("client/sidebar.tsx", "Sidebar", sidebarProps(blank))).includes(text("sidebarUnnamedProject")));
  const capped = projectList(fixtureSnapshot(), new Set(), buildingFor(fixtureSnapshot(), 3), 1);
  assert.ok(textsOf(host.mountModule("client/sidebar.tsx", "Sidebar", { ...props, list: capped })).includes(text("sidebarMoreRows", { count: 2 })));
  const empty = projectList({ projects: [], workspaces: [], agents: [] }, new Set(), buildingFor({ projects: [] }, 0), SIDEBAR_MAX_ROWS);
  assert.ok(textsOf(host.mountModule("client/sidebar.tsx", "Sidebar", { ...props, list: empty })).includes(text("sidebarEmpty")));

  const hostile = fixtureSnapshot();
  hostile.projects[0].name = "y".repeat(10_000);
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
