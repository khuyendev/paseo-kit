import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ago, clock, shortModel, shortTitle, tokens } from "../../plugins/swarm-map/client/format.ts";
import { assignSlots, computeLayout, createSlotBook, tier } from "../../plugins/swarm-map/client/geometry.ts";
import { hubProgress, overThreshold, waveLine } from "../../plugins/swarm-map/client/labels.ts";
import { LEGEND, agentState } from "../../plugins/swarm-map/client/palette.ts";
import { register } from "../../plugins/swarm-map/client/register.ts";
import {
  applySnapshot,
  bootDelay,
  GHOST_MS,
  NEW_BADGE_MS,
  effectEvents,
  eventText,
  fitZoom,
  headerCounts,
  START_FEED,
  subtitle,
  toggleSelection,
  zoomIn,
  zoomOut,
  zoomText,
} from "../../plugins/swarm-map/client/state.ts";
import { KIT_DIR } from "../helpers/temp.mjs";

const CLIENT = path.join(KIT_DIR, "plugins", "swarm-map", "client");
const clientFiles = () => fs.readdirSync(CLIENT).map((f) => [f, fs.readFileSync(path.join(CLIENT, f), "utf8")]);

const agent = (id, over = {}) => ({
  id, title: `w ${id}`, model: "circle/gpt", thinking: null, mode: null, status: "idle", contextPct: null, usedTokens: null, maxTokens: null,
  rotatePct: 60, attention: null, parentId: "b", swarm: null, project: null, createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z",
  turnStartedAt: null, activity: null, heldFiles: 0, ...over,
});
const ev = (seq, kind, over = {}) => ({ seq, at: "2026-10-20T10:00:00.000Z", kind, agentId: "a1", parentId: "b", title: "a1", text: "", stats: "", activity: null, path: null, peerId: null, peerOp: null, ...over });
const snap = (over = {}) => ({ ok: true, generatedAt: "2026-10-20T10:00:00.000Z", brains: [], standaloneCount: 0, eventEpoch: "e1", files: [], events: [], lastSeq: 0, errors: [], ...over });

test("PANL-02 swarm client registers surface swarm and a sidebar item; disposer runs every cleanup", () => {
  const calls = [];
  let cleaned = 0;
  const host = {
    addSurface: (id) => (calls.push(["surface", id]), () => (cleaned += 1)),
    addSidebarItem: (item) => (calls.push(["sidebar", item.id, item.surface]), () => (cleaned += 1)),
  };
  const dispose = register(host, () => null);
  assert.deepEqual(calls, [["surface", "swarm"], ["sidebar", "swarm", "swarm"]]);
  dispose();
  assert.equal(cleaned, 2);
});

test("PANL-23 swarm format helpers", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  assert.equal(ago("2026-10-20T09:59:01Z", now), "59s");
  assert.equal(ago("2026-10-20T08:00:00Z", now), "2h");
  assert.equal(clock(65_000), "1:05");
  assert.equal(clock(3_725_000), "1:02:05");
  assert.equal(tokens(null), "?");
  assert.equal(tokens(1_500_000), "1.5M");
  assert.equal(tokens(12_345), "12k");
  assert.equal(shortModel("circle/gpt-6.1-sol[1m]"), "gpt-6.1-sol [1m]");
  assert.deepEqual(shortTitle("review #3: C:\\x\\y\\file.md", "review"), { badge: "3", label: "file.md" });
});

test("PANL-44 epoch change clears the feed and refills it with history that is not animated", () => {
  const onMap = () => true;
  let r = applySnapshot(START_FEED, snap({ events: [ev(1, "spawn"), ev(2, "tool")], lastSeq: 2 }), onMap);
  assert.equal(r.live.length, 0, "first response is history");
  assert.deepEqual(r.state.cursor, { seq: 2, epoch: "e1" });
  r = applySnapshot(r.state, snap({ events: [ev(3, "report")], lastSeq: 3 }), onMap);
  assert.deepEqual(r.live.map((e) => e.seq), [3]);
  assert.deepEqual(r.state.events.map((e) => e.seq), [3, 2, 1]);
  const failed = applySnapshot(r.state, { ok: false, code: "failed", message: "x", directory: null }, onMap);
  assert.equal(failed.state, r.state, "ok:false never moves the cursor");
  r = applySnapshot(r.state, snap({ eventEpoch: "e2", events: [ev(1, "archive")], lastSeq: 1 }), onMap);
  assert.deepEqual(r.state.events.map((e) => [e.seq, e.kind]), [[1, "archive"]]);
  assert.equal(r.live.length, 0);
  assert.equal(r.state.liveFromSeq, 1);
});

test("PANL-45 feed texts per kind; events of agents off the map never appear; feed capped at 80", () => {
  const rows = {
    spawn: "spawned",
    archive: "archived",
    command: "got prompt: fix it",
    report: "reported: done · 2 read",
    failed: "turn failed: boom",
    canceled: "turn canceled",
    permission: "needs permission: Run ls",
    permission_resolved: "permission answered",
  };
  const text = { command: "fix it", report: "done", failed: "boom", permission: "Run ls" };
  for (const [kind, want] of Object.entries(rows)) assert.equal(eventText(ev(1, kind, { text: text[kind] ?? "", stats: kind === "report" ? "2 read" : "" })), want);
  const act = { id: "c", kind: "edit", label: "a.md", detail: "", status: "completed", at: "", files: [] };
  assert.equal(eventText(ev(1, "tool", { text: "a.md", activity: act })), "edited a.md");
  assert.equal(eventText(ev(1, "handoff", { text: "a.md", activity: act, peerOp: "write" })), "write conflict: a.md");
  assert.equal(eventText(ev(1, "handoff", { text: "a.md", activity: { ...act, kind: "read" }, peerOp: "write" })), "took over a.md");
  const r = applySnapshot(START_FEED, snap({ events: [ev(1, "spawn", { agentId: "off", parentId: "nobody" }), ev(2, "spawn")], lastSeq: 2 }), (id) => id === "a1");
  assert.deepEqual(r.state.events.map((e) => e.seq), [2]);
  const many = applySnapshot(START_FEED, snap({ events: Array.from({ length: 120 }, (_, i) => ev(i + 1, "tool")), lastSeq: 120 }), () => true);
  assert.equal(many.state.events.length, 80);
});

test("PANL-46 spawning then archiving one agent leaves the other slots unchanged", () => {
  const book = createSlotBook();
  const six = Array.from({ length: 6 }, (_, i) => agent(`a${i}`));
  const brains = (list) => [{ agent: agent("b", { parentId: null }), groups: [{ name: "s", agents: list, wave: null }] }];
  const pos = (l) => Object.fromEntries(l.agents.map((p) => [p.agent.id, [p.x, p.y]]));
  const before = pos(computeLayout(brains(six), book, 0));
  computeLayout(brains([...six, agent("new")]), book, 1000);
  const after = pos(computeLayout(brains(six), book, 2000));
  assert.deepEqual(after, before);
  assert.equal(tier(7), 8);
  assert.equal(tier(130), 160);
  const b2 = createSlotBook();
  assignSlots(b2, "h", [agent("x"), agent("y")], 0);
  const { slots } = assignSlots(b2, "h", [agent("y"), agent("z")], 100);
  assert.notEqual(slots.get("z"), 0, "freed slot cools down");
});

test("PANL-47 agentState over status and attention; header counters use each agent's rotatePct", () => {
  const rows = [
    [{ status: "running", attention: "permission" }, "waiting"],
    [{ status: "error", attention: null }, "error"],
    [{ status: "idle", attention: "error" }, "error"],
    [{ status: "running", attention: null }, "working"],
    [{ status: "initializing", attention: null }, "working"],
    [{ status: "idle", attention: "finished" }, "sleep"],
    [{ status: "closed", attention: null }, "sleep"],
  ];
  for (const [a, want] of rows) assert.equal(agentState(a), want, JSON.stringify(a));
  const c = headerCounts([agent("1", { contextPct: 61, rotatePct: 60 }), agent("2", { contextPct: 61, rotatePct: 70, status: "running" })], [{ writers: 2 }, { writers: 1 }]);
  assert.deepEqual(c, { running: 1, sleep: 1, waiting: 0, error: 0, overThreshold: 1, conflicts: 1 });
});

test("PANL-48 hub ring: wave progress when linked, running share when unlinked; wave line", () => {
  const four = [agent("1", { status: "running" }), agent("2", { status: "running" }), agent("3"), agent("4")];
  assert.equal(hubProgress({ name: "s", agents: four, wave: { phase: "02", wave: 1, plansDone: 2, plansTotal: 4, scope: "complete" } }), 0.5);
  assert.equal(hubProgress({ name: "s", agents: four, wave: null }), 0.5);
  assert.equal(waveLine({ phase: "02", wave: 1, plansDone: 2, plansTotal: 4, scope: "complete" }), "phase 02 wave 1 · 2/4 plans");
  assert.equal(waveLine(null), "unlinked");
  assert.equal(overThreshold({ contextPct: 60, rotatePct: 60 }), true);
  assert.equal(overThreshold({ contextPct: 60, rotatePct: null }), false);
});

test("PANL-50 30 handoffs in one poll start at most 8 packets, newest kept; 4 shared clocks", () => {
  const live = Array.from({ length: 30 }, (_, i) => ev(i + 1, "handoff", { activity: { id: `c${i}` } }));
  const picked = effectEvents(live).filter((e) => e.kind === "handoff");
  assert.equal(picked.length, 8);
  assert.deepEqual(picked.map((e) => e.seq), [30, 29, 28, 27, 26, 25, 24, 23]);
  const dup = effectEvents([ev(1, "handoff", { activity: { id: "x" } }), ev(2, "tool", { activity: { id: "x" } })]);
  assert.deepEqual(dup.map((e) => e.kind), ["handoff"]);
  const loops = clientFiles().flatMap(([f, t]) => (t.match(/Animated\.loop\(/g) ?? []).map(() => f));
  assert.deepEqual(loops, ["anim.ts"], "only the shared clock source loops");
  const anim = fs.readFileSync(path.join(CLIENT, "anim.ts"), "utf8");
  assert.match(anim, /CLOCK_PERIODS_MS = \{ flow: 1600, pulse: 2200, spin: 9000, blink: 1000 \}/);
});

test("PANL-51 zoom in at fit 0.8 goes to 0.9 and shows 90%; bounds 0.4..1.6", () => {
  assert.equal(fitZoom(808, 1000), 0.8);
  assert.equal(zoomIn(0.8), 0.9);
  assert.equal(zoomText(zoomIn(0.8)), "90%");
  assert.equal(zoomIn(1.6), 1.6);
  assert.equal(zoomOut(0.4), 0.4);
  assert.equal(fitZoom(100, 1000), 0.4);
  assert.equal(fitZoom(5000, 1000), 1);
});

test("PANL-52 pressing the same node twice closes; another node switches", () => {
  const a = { kind: "agent", id: "a" };
  assert.deepEqual(toggleSelection(null, a), a);
  assert.equal(toggleSelection(a, { kind: "agent", id: "a" }), null);
  assert.deepEqual(toggleSelection(a, { kind: "hub", id: "a" }), { kind: "hub", id: "a" });
});

test("PANL-43 header subtitle: offline, connecting, live counts", () => {
  assert.equal(subtitle(true, null, 0), "offline");
  assert.equal(subtitle(false, null, 0), "connecting…");
  assert.equal(subtitle(false, snap({ brains: [{}, {}] }), 3), "live · 2 brains · 3 swarms");
});

test("PANL-53 legend covers every map icon; decorative hues never colour text", () => {
  const legend = new Set(LEGEND.map((r) => r.icon));
  const controls = new Set(["Copy", "X", "Orbit", "Clock", "ZoomIn", "ZoomOut", "Maximize2", "Telescope", "MousePointerClick", "Gauge", "Activity", "Moon", "ShieldAlert", "CircleX", "TriangleAlert"]);
  const used = new Set();
  for (const [, t] of clientFiles()) {
    for (const m of t.matchAll(/(?:name|icon)[=:]\s*\{?"([A-Z][A-Za-z0-9]+)"/g)) used.add(m[1]);
    for (const m of t.matchAll(/:\s*"([A-Z][A-Za-z0-9]+)",?\s*$/gm)) used.add(m[1]);
  }
  for (const icon of used) assert.ok(legend.has(icon) || controls.has(icon), `icon ${icon} missing from the legend`);
  const palette = fs.readFileSync(path.join(CLIENT, "palette.ts"), "utf8");
  assert.match(palette, /statusWarning is reserved for permission and the\s*\n?\/\/ context threshold/);
});

test("PANL-54 compact layout stacks canvas and panel in one scroll view", () => {
  const surface = fs.readFileSync(path.join(CLIENT, "swarm-surface.tsx"), "utf8");
  assert.match(surface, /compact \? \(\s*<ScrollView style=\{\{ flex: 1 \}\}>\s*\{canvas\}\s*\{panel\}/);
  assert.match(surface, /minHeight: compact \? COMPACT_CANVAS_MIN_H/);
  assert.match(surface, /const COMPACT_CANVAS_MIN_H = 420;/);
  assert.match(surface, /const PANEL_W = 380;/);
  assert.match(surface, /No swarm is flying right now/);
});

test("PANL-49 boot stagger min(index*30, 900) ms, NEW badge 12 s, ghost 1.7 s", () => {
  assert.deepEqual([bootDelay(0), bootDelay(5), bootDelay(30), bootDelay(100)], [0, 150, 900, 900]);
  assert.equal(NEW_BADGE_MS, 12_000);
  assert.equal(GHOST_MS, 1700);
  const surface = fs.readFileSync(path.join(CLIENT, "swarm-surface.tsx"), "utf8");
  assert.match(surface, /!booted\.current \? "boot" : known\.has\(id\) \? "none" : viewChangedNow \? "boot" : "spawn"/);
  assert.match(surface, /archived\.has\(p\.agent\.id\) \? "archived" : "gone"/);
});
