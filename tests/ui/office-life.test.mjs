import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { POSE_FRAMES, POSE_NAMES, CHAR_AX, CHAR_AY, CHAR_H, CHAR_W, ZOOM_CANDIDATES, ZOOM_LEVELS, sheetSize } from "../../plugins/office/shared/art-types.ts";
import { PNG_MAX_DIMENSION } from "../../plugins/office/server/limits.ts";
import { FOOT_DX, FOOT_DY, RUN_SPEED, TILE, WALK_SPEED } from "../../plugins/office/client/layout/constants.ts";
import { buildBuilding } from "../../plugins/office/client/layout/building.ts";
import { mulberry32 } from "../../plugins/office/client/layout/rng.ts";
import { gridFromRows } from "../../plugins/office/client/path/grid.ts";
import * as LIM from "../../plugins/office/client/limits-life.ts";
import { POSE_TIER, SHEET_POSE_GROUPS, footPx, frameOrigin, groupOfPose, restPoseOf, rowOffset, sheetFor, sheetWindow, tierOf, xRamp } from "../../plugins/office/client/life/frames.ts";
import { walkPath } from "../../plugins/office/client/life/walk.ts";
import { ElevatorSchedule, arrivalJourney, departureJourney, elevatorFronts, handoffJourney, roundTripJourney } from "../../plugins/office/client/life/journey.ts";
import { createClockBank, createSharedClock } from "../../plugins/office/client/life/bank.ts";
import { runJourney } from "../../plugins/office/client/life/runner.ts";
import { createSpotLedger, indexSpots } from "../../plugins/office/client/life/ledger.ts";
import { IDLE_WEIGHTS, idleSitMs, pickWander, wanderSeed } from "../../plugins/office/client/life/wander.ts";
import { HANGOUT_KINDS, pickHangout, releaseHangout, reserveHangout } from "../../plugins/office/client/life/social.ts";
import { KIT_DIR } from "../helpers/temp.mjs";

const COMMIT = "faa1a012b5fbf632c66dc6801c5383e53a542406";
const CLIENT = path.join(KIT_DIR, "plugins", "office", "client");
const PLUGIN_DIR = path.join(KIT_DIR, "plugins", "office");
const normalise = (text) => text.replace(/\r\n/g, "\n");
const readClient = (...parts) => normalise(fs.readFileSync(path.join(CLIENT, ...parts), "utf8"));
const stripComments = (text) => text.replace(/^\s*\/\/.*$/gm, "");
const open = (w, h) => gridFromRows(Array.from({ length: h }, () => ".".repeat(w)));
const pt = (x, y) => ({ x, y });
const walkMs = Math.round((TILE * 1000) / WALK_SPEED);
const runMs = Math.round((TILE * 1000) / RUN_SPEED);

const buildingOf = () => buildBuilding([{ id: "a", slot: 0, seed: 1 }, { id: "b", slot: 1, seed: 2 }, { id: "c", slot: 2, seed: 3 }]);
const areaOf = (building, id) => building.areas.find((a) => a.id === id);
const deskTiles = (building, roomId) => areaOf(building, `room:${roomId}`).spots.filter((s) => s.kind === "desk").map((s) => pt(s.tx, s.ty));

// Files the source rules read: every file of client/life plus the named client files that exist.
function lifeFiles() {
  const dir = path.join(CLIENT, "life");
  const own = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => path.join("life", f)) : [];
  const named = ["limits-life.ts", "clocks.ts", "character.tsx"].filter((f) => fs.existsSync(path.join(CLIENT, f)));
  return { life: own, all: [...own, ...named] };
}

const PORT_LINE = new RegExp(`^// Port of habblaud \\S+ @ ${COMMIT} \\(MIT; notice in LICENSES/habblaud-MIT\\.txt, added by plan 07-05\\)\\.$`);
const NO_UPSTREAM_LINE = /^\/\/ No upstream: written for plan 07-08\.$/;
const importSpecs = (text) => [...text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

// PANL-05 and PANL-06 patterns of tests/ui/plugin-gates.test.mjs.
const PANL05 = [
  /child_process/,
  /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|createWriteStream|chmod|truncate|utimes|cp|rm)(Sync)?\s*\(/,
  /\.(send|run|archive|create|respondToPermission|setTitle|setModel|cancel|detach|append|waitForFinish)\s*\(/,
  /\b(spawnProcess|execCommand|terminateProcess)\b/,
];
const PANL06 = /<div\b|<span\b|<svg\b|\bdocument\.|\bwindow\./;

// ---------------------------------------------------------------- Task 1: frame math, walk plans, journeys

// Pinned upstream per-pose frame durations in ms: habblaud client/src/art/character/render.ts POSE_DURATION @ faa1a012b5fbf632c66dc6801c5383e53a542406.
const UPSTREAM_POSE_DURATION = {
  stand: 650, walk: 140, run: 95, sit: 800, type: 120, sleep: 1000, drink: 700, use: 380, raise_hand: 320, talk: 280,
  stretch: 800, read: 1100, play: 200, wait: 480, cheer: 260, laugh: 190, game: 150, rps: 300, groom: 420, sulk: 1300,
};

test("OFFC-09 tiers: shared clock constants and the pose to tier table follow the pinned durations", () => {
  assert.deepEqual([...LIM.CLOCK_TICKS_PER_FRAME], [1, 2, 4, 8]);
  assert.equal(LIM.CLOCK_TIER_COUNT, LIM.CLOCK_TICKS_PER_FRAME.length);
  assert.equal(LIM.CLOCK_TIER_COUNT, 4);
  assert.equal(LIM.CLOCK_CYCLE, 4);
  for (const frames of Object.values(POSE_FRAMES)) assert.equal(LIM.CLOCK_CYCLE % frames, 0, `frame count ${frames}`);
  const thresholds = JSON.parse(fs.readFileSync(path.join(KIT_DIR, ".planning", "phases", "07-office", "07-SPIKE-THRESHOLDS.json"), "utf8"));
  assert.ok(Number.isInteger(LIM.CLOCK_TICK_MS) && LIM.CLOCK_TICK_MS > 0);
  assert.ok(LIM.CLOCK_TICK_MS <= thresholds.cadence.medianMsMax);
  assert.deepEqual(Object.keys(POSE_TIER).sort(), [...POSE_NAMES].sort());
  for (const pose of POSE_NAMES) {
    let best = 0;
    LIM.CLOCK_TICKS_PER_FRAME.forEach((ticks, tier) => {
      if (Math.abs(ticks * LIM.CLOCK_TICK_MS - UPSTREAM_POSE_DURATION[pose]) < Math.abs(LIM.CLOCK_TICKS_PER_FRAME[best] * LIM.CLOCK_TICK_MS - UPSTREAM_POSE_DURATION[pose])) best = tier;
    });
    assert.ok(Number.isInteger(POSE_TIER[pose]) && POSE_TIER[pose] >= 0 && POSE_TIER[pose] <= 3, pose);
    assert.equal(POSE_TIER[pose], best, pose);
    assert.equal(tierOf(pose), POSE_TIER[pose]);
  }
});

test("OFFC-09 ramps: xRamp steps the frame offset and repeats with the frame count of the pose", () => {
  assert.deepEqual(xRamp("walk", 2), { inputRange: [0, 1, 2, 3], outputRange: [0, -48, -96, -144] });
  assert.deepEqual(xRamp("stand", 3).outputRange, [0, -72, 0, -72]);
  for (const zoom of ZOOM_LEVELS) {
    for (const pose of POSE_NAMES) {
      const { outputRange } = xRamp(pose, zoom);
      assert.ok(Object.is(outputRange[0], 0), `${pose} first output is +0`);
      outputRange.forEach((v, i) => {
        assert.ok(Number.isInteger(v) && v <= 0, `${pose}@${zoom}`);
        assert.equal(v, outputRange[i % POSE_FRAMES[pose]], `${pose}@${zoom} repeats`);
      });
    }
  }
  assert.throws(() => xRamp("walk", 5), RangeError);
  assert.throws(() => xRamp("flying", 2), RangeError);
});

test("OFFC-09 window: sheet window size and row offsets follow the sheet layout", () => {
  const w = sheetWindow(["walk", "stand"], 3);
  assert.deepEqual(w, { frameW: 72, frameH: 102, cols: 4, rows: 8, sheetW: 288, sheetH: 816 });
  assert.deepEqual(sheetWindow(["stand", "walk"], 3), w);
  assert.ok(Object.is(rowOffset(["walk", "stand"], "stand", "down", 3), 0));
  assert.equal(rowOffset(["walk", "stand"], "walk", "right", 3), -714);
  assert.equal(rowOffset(["walk", "stand"], "walk", "down", 3), -408);
  assert.throws(() => rowOffset([], "stand", "down", 3), RangeError);
  assert.throws(() => rowOffset(["walk"], "stand", "down", 3), RangeError);
  assert.throws(() => sheetWindow([], 3), RangeError);
});

test("OFFC-09 origin: frameOrigin anchors the frame on the foot pixel, also for a smaller sheet", () => {
  assert.deepEqual(frameOrigin(pt(100, 50), 2), { left: 176, top: 38 });
  assert.equal(CHAR_AX * 2, 24);
  assert.equal(CHAR_AY * 2, 62);
  assert.throws(() => frameOrigin(pt(NaN, 50), 2), RangeError);
  assert.throws(() => frameOrigin(pt(100, Infinity), 2), RangeError);
  assert.deepEqual(frameOrigin(pt(100, 50), 3, 3), frameOrigin(pt(100, 50), 3));
  assert.deepEqual(frameOrigin(pt(100, 50), 4, 2), { left: 376, top: 138 });
  assert.throws(() => frameOrigin(pt(100, 50), 2, 3), RangeError);
  assert.throws(() => frameOrigin(pt(100, 50), 4, 5), RangeError);
  assert.deepEqual(footPx(pt(3, 2)), { x: 3 * TILE + FOOT_DX, y: 2 * TILE + FOOT_DY });
});

test("OFFC-09 sheet groups: the partition fits one PNG per group and covers the OFFC-11 poses", () => {
  assert.ok(SHEET_POSE_GROUPS.length >= 3 && SHEET_POSE_GROUPS.length <= 4);
  const seen = new Set();
  for (const group of SHEET_POSE_GROUPS) {
    assert.ok(group.length >= 1 && group.length <= 7);
    for (const pose of group) {
      assert.ok(POSE_NAMES.includes(pose), pose);
      assert.ok(!seen.has(pose), `${pose} in two groups`);
      seen.add(pose);
    }
    const zoom = Math.max(...ZOOM_CANDIDATES);
    assert.ok(sheetSize(group).rows * CHAR_H * zoom <= PNG_MAX_DIMENSION, `${group.join(",")} fits`);
    assert.ok(sheetSize(group).cols * CHAR_W * zoom <= PNG_MAX_DIMENSION);
  }
  for (const pose of ["stand", "walk", "run", "sit", "type", "read", "use", "wait", "raise_hand", "sulk", "sleep", "drink"]) assert.ok(seen.has(pose), pose);
  assert.equal(groupOfPose("walk"), SHEET_POSE_GROUPS.findIndex((g) => g.includes("walk")));
  assert.equal(groupOfPose("groom"), -1);
  const first = { key: "k1", source: { uri: "a" }, poses: ["stand", "walk"] };
  const second = { key: "k2", source: { uri: "b" }, poses: ["walk", "sit"] };
  assert.equal(sheetFor([first, second], "walk"), first);
  assert.equal(sheetFor([second, first], "walk"), second);
  assert.equal(sheetFor([first, second], "sit"), second);
  assert.equal(sheetFor([first, second], "sleep"), null);
  assert.equal(sheetFor([], "stand"), null);
  assert.equal(restPoseOf(first), "stand");
  assert.equal(restPoseOf({ key: "k3", source: { uri: "c" }, poses: ["sit", "walk"] }), "walk");
});

test("OFFC-12 walk: walkPath turns tile steps into straight timed segments", () => {
  const row = walkPath({ grid: open(6, 1) }, pt(0, 0), pt(5, 0));
  assert.equal(row.segments.length, 1);
  assert.equal(row.segments[0].dir, "right");
  assert.equal(row.segments[0].tiles, 5);
  assert.equal(row.segments[0].ms, 5 * walkMs);
  assert.deepEqual(row.startPx, footPx(pt(0, 0)));
  assert.deepEqual({ x: row.segments[0].x, y: row.segments[0].y }, footPx(pt(5, 0)));
  assert.equal(row.totalMs, row.segments.reduce((sum, s) => sum + s.ms, 0));
  assert.equal(row.lastDir, "right");

  const field = walkPath({ grid: open(5, 4) }, pt(0, 0), pt(3, 2));
  assert.equal(field.segments.length, 2);
  assert.equal(field.segments.reduce((sum, s) => sum + s.tiles, 0), 5);
  assert.deepEqual(field.segments.map((s) => s.dir).sort(), ["down", "right"]);

  assert.equal(walkPath({ grid: open(6, 1) }, pt(5, 0), pt(0, 0)).segments[0].dir, "left");
  assert.equal(walkPath({ grid: open(1, 6) }, pt(0, 5), pt(0, 0)).segments[0].dir, "up");

  const same = walkPath({ grid: open(3, 3) }, pt(1, 1), pt(1, 1));
  assert.deepEqual(same.segments, []);
  assert.equal(same.tiles, 0);
  assert.equal(same.totalMs, 0);
  assert.equal(same.lastDir, null);

  const walled = { grid: gridFromRows(["..#..", "..#.."]) };
  assert.equal(walkPath(walled, pt(0, 0), pt(2, 0)), null, "blocked goal");
  assert.equal(walkPath(walled, pt(0, 0), pt(9, 9)), null, "goal outside the grid");
  assert.equal(walkPath(walled, pt(0, 0), pt(4, 1)), null, "disconnected goal");
  assert.equal(walkPath(walled, pt(9, 0), pt(0, 0)), null, "start outside the grid");

  const run = walkPath({ grid: open(6, 1) }, pt(0, 0), pt(5, 0), { run: true });
  assert.equal(run.segments[0].ms, 5 * runMs);
  assert.ok(runMs <= walkMs);
  for (const bad of [1.5, -1, NaN, Infinity]) {
    assert.throws(() => walkPath({ grid: open(6, 1) }, pt(bad, 0), pt(1, 0)), RangeError, `from ${bad}`);
    assert.throws(() => walkPath({ grid: open(6, 1) }, pt(0, 0), pt(0, bad)), RangeError, `to ${bad}`);
  }

  const n = 40;
  const rows = Array.from({ length: n + 1 }, (_, y) => Array.from({ length: n + 1 }, (_, x) => (x === y || x === y + 1 ? "." : "#")).join(""));
  assert.ok(walkPath({ grid: gridFromRows(rows) }, pt(0, 0), pt(n, n)) === null, "a staircase above WALK_PLAN_MAX_SEGMENTS runs is refused");
  assert.ok(2 * n > LIM.WALK_PLAN_MAX_SEGMENTS);

  const a = walkPath({ grid: open(5, 4) }, pt(0, 0), pt(3, 2));
  const b = walkPath({ grid: open(5, 4) }, pt(0, 0), pt(3, 2));
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  assert.notEqual(a.segments[0], b.segments[0]);

  const building = buildingOf();
  const room = areaOf(building, "room:a");
  const talk = areaOf(building, "core:reception").spots.find((s) => s.kind === "talk");
  const plan = walkPath(building, pt(room.door.x, room.door.y), pt(talk.tx, talk.ty));
  assert.ok(plan !== null && plan.tiles > 0);
  const last = plan.segments[plan.segments.length - 1];
  assert.deepEqual({ x: last.x, y: last.y }, footPx(pt(talk.tx, talk.ty)));
});

test("OFFC-12 journeys: round trip and handoff walk to the parent and back, and do not walk without a reachable parent", () => {
  const field = { grid: open(6, 4) };
  const trip = roundTripJourney(field, pt(0, 0), pt(3, 2), { wait: { ms: 700, pose: "stand" }, homeDir: "down" });
  assert.deepEqual(trip.steps.map((s) => s.kind), ["walk", "wait", "walk"]);
  assert.deepEqual(trip.endTile, pt(0, 0));
  assert.equal(trip.endDir, "down");
  assert.equal(trip.steps[2].plan.to.x, 0);
  assert.deepEqual({ x: trip.steps[2].plan.segments.at(-1).x, y: trip.steps[2].plan.segments.at(-1).y }, footPx(pt(0, 0)));
  assert.equal(trip.steps[1].pose, "stand");
  assert.equal(trip.steps[1].ms, 700);
  assert.equal(trip.steps[1].dir, trip.steps[0].plan.lastDir);
  assert.equal(trip.totalMs, trip.steps[0].plan.totalMs + 700 + trip.steps[2].plan.totalMs);

  const stay = roundTripJourney(field, pt(1, 1), pt(1, 1), { wait: { ms: 300, pose: "sit" }, homeDir: "up" });
  assert.deepEqual(stay.steps.map((s) => s.kind), ["wait"]);
  assert.equal(roundTripJourney({ grid: gridFromRows(["..#.."]) }, pt(0, 0), pt(4, 0), { wait: { ms: 1, pose: "stand" }, homeDir: "down" }), null);

  const hand = handoffJourney(field, pt(0, 0), pt(3, 2), { homeDir: "down" });
  assert.equal(hand.steps[1].ms, LIM.HANDOFF_PAUSE_MS);
  assert.equal(hand.steps[1].pose, "stand");
  assert.deepEqual(hand.endTile, pt(0, 0));
  assert.equal(handoffJourney(field, pt(0, 0), null, { homeDir: "down" }), null);
  assert.equal(handoffJourney({ grid: gridFromRows(["..#.."]) }, pt(0, 0), pt(2, 0), { homeDir: "down" }), null);
  assert.equal(handoffJourney({ grid: gridFromRows(["..#.."]) }, pt(0, 0), pt(4, 0), { homeDir: "down" }), null);
  assert.ok(handoffJourney({ grid: gridFromRows(["#...."]) }, pt(0, 0), pt(3, 0), { homeDir: "down" }) !== null, "a blocked start tile inside the grid still works");

  const building = buildingOf();
  const [a0, a1] = deskTiles(building, "a");
  const [b0] = deskTiles(building, "b");
  const sameRoom = handoffJourney(building, a0, a1, { homeDir: "down" });
  const otherRoom = handoffJourney(building, a0, b0, { homeDir: "down" });
  assert.ok(sameRoom !== null && otherRoom !== null);
  assert.deepEqual(sameRoom.endTile, a0);
  assert.deepEqual(otherRoom.endTile, a0);
  assert.deepEqual(handoffJourney(building, a0, b0, { homeDir: "down" }), otherRoom);
  assert.notEqual(handoffJourney(building, a0, b0, { homeDir: "down" }), otherRoom);
});

test("OFFC-13 elevator: arrival and departure journeys use the reception elevators and arrivals are staggered", () => {
  const building = buildingOf();
  const fronts = elevatorFronts(building);
  assert.equal(fronts.length, 2);
  const spots = areaOf(building, "core:reception").spots.filter((s) => s.kind === "elevator");
  assert.deepEqual(fronts, [0, 1].map((i) => { const s = spots.find((x) => x.group === `elevator:${i}`); return pt(s.tx, s.ty); }));
  for (const f of fronts) assert.ok(building.grid.walkable(f.x, f.y));

  const talk = areaOf(building, "core:reception").spots.find((s) => s.kind === "talk");
  const dest = pt(talk.tx, talk.ty);
  const arrive = arrivalJourney(building, fronts[0], dest, { destDir: "left" });
  assert.deepEqual(arrive.steps.map((s) => s.kind), ["appear", "walk"]);
  assert.equal(arrive.steps[0].ms, LIM.ELEVATOR_DOOR_MS);
  assert.deepEqual(arrive.startTile, fronts[0]);
  assert.deepEqual(arrive.endTile, dest);
  assert.equal(arrive.endDir, "left");
  assert.deepEqual(arrivalJourney(building, fronts[0], fronts[0], { destDir: "down" }).steps.map((s) => s.kind), ["appear"]);
  assert.equal(arrivalJourney({ grid: gridFromRows(["..#.."]) }, pt(0, 0), pt(4, 0), { destDir: "down" }), null);

  const leave = departureJourney(building, dest, fronts[1]);
  assert.deepEqual(leave.steps.map((s) => s.kind), ["walk", "vanish"]);
  assert.equal(leave.steps[1].ms, LIM.ELEVATOR_DOOR_MS);
  assert.deepEqual(leave.endTile, fronts[1]);
  assert.equal(departureJourney({ grid: gridFromRows(["..#.."]) }, pt(0, 0), pt(4, 0)), null);

  assert.equal(LIM.ELEVATOR_STAGGER_MS, 520);
  assert.equal(LIM.ELEVATOR_HOLD_MS, 650);
  const schedule = ElevatorSchedule(2);
  assert.deepEqual([schedule.reserve(1000), schedule.reserve(1000), schedule.reserve(1000), schedule.reserve(1000)], [
    { index: 0, at: 1000 }, { index: 1, at: 1000 }, { index: 0, at: 1520 }, { index: 1, at: 1520 },
  ]);
  assert.equal(schedule.reserve(5000).at, 5000);
  assert.throws(() => ElevatorSchedule(0), RangeError);
  assert.throws(() => ElevatorSchedule(1.5), RangeError);
  assert.throws(() => schedule.reserve(NaN), RangeError);
});

test("OFFC-09 source rules: every life file has a header, no class syntax, no randomness, no clock source and no timer", () => {
  const { life, all } = lifeFiles();
  assert.ok(life.length >= 8, "client/life holds the eight modules");
  for (const rel of all) {
    const text = readClient(rel);
    const lines = text.split("\n");
    assert.ok(PORT_LINE.test(lines[0]) || NO_UPSTREAM_LINE.test(lines[0]), `${rel}: header`);
    if (PORT_LINE.test(lines[0])) assert.ok(lines[1].startsWith("//"), `${rel}: second header line`);
    const code = stripComments(text);
    assert.doesNotMatch(code, /constructor\s*\([^)]*\b(private|public|protected|readonly)\b/, rel);
    assert.doesNotMatch(code, /\b(enum|namespace)\s+[A-Za-z_]/, rel);
    assert.doesNotMatch(code, /\bclass\s+[A-Za-z_{]/, `${rel}: no class syntax`);
    for (const spec of importSpecs(code)) {
      if (spec.startsWith(".")) assert.match(spec, /\.tsx?$/, `${rel}: ${spec} needs an extension`);
      assert.doesNotMatch(spec, /server\//, `${rel}: no import from server/`);
    }
    for (const re of PANL05) assert.doesNotMatch(code, re, `${rel}: ${re}`);
    assert.doesNotMatch(text, PANL06, rel);
  }
  for (const rel of life) {
    const code = stripComments(readClient(rel));
    for (const spec of importSpecs(code)) assert.ok(spec.startsWith("."), `${rel}: no bare import (${spec})`);
    assert.doesNotMatch(code, /Math\.random|Date\.now|new Date\b|\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/, rel);
  }
});

// ---------------------------------------------------------------- Task 2: clocks, runner and the CharacterSprite component

const PRECONDITION = "precondition: host render or Animated fake missing";

// Replaces the global interval functions with recorders for the length of one test.
function recordTimers() {
  const real = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const log = { set: [], clear: [] };
  globalThis.setInterval = (fn, ms) => {
    const handle = { n: log.set.length };
    log.set.push({ fn, ms, handle });
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    log.clear.push(handle);
  };
  return { log, restore: () => Object.assign(globalThis, real) };
}

async function withHost(fn) {
  const { fakeHost } = await import("./office-host.mjs");
  const host = await fakeHost();
  const timers = recordTimers();
  try {
    await fn(host, timers.log);
  } finally {
    host.dispose();
    timers.restore();
  }
}

const sheet = (poses, uri = "sheet.png", key = uri) => ({ key, source: { uri }, poses });
const MOVE = SHEET_POSE_GROUPS[0];
const WORK = SHEET_POSE_GROUPS[1];
const baseProps = (overrides = {}) => ({ sheets: [sheet(["stand", "walk"])], zoom: ZOOM_LEVELS[0], pose: "stand", dir: "down", at: pt(3, 2), ...overrides });
const mountSprite = (host, props) => host.mountModule("client/character.tsx", "CharacterSprite", props);
const imageOf = (handle) => handle.find("Animated.Image")[0];
const rampOf = (handle) => imageOf(handle).props.style.transform[0].translateX;
// After 12 ticks the four tiers hold 0, 2, 3 and 1, so a clock value names its tier.
const tierOfValue = (value) => [0, 2, 3, 1].indexOf(value.current);

test("OFFC-09 host: the fake host renders a client module and provides the Animated surface", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-life-probe-"));
  const probe = path.join(dir, "probe.tsx");
  fs.writeFileSync(
    probe,
    `import { Animated, Platform, View } from "react-native";
export function Probe() {
  const v = new Animated.Value(0);
  v.setValue(2);
  const xy = new Animated.ValueXY({ x: 1, y: 2 });
  const timing = Animated.timing(v, { toValue: 1, duration: 10, useNativeDriver: false });
  const delay = Animated.delay(5);
  const facts = {
    set: v.current === 2,
    interp: typeof v.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }).config === "object",
    xy: xy.x.current === 1 && xy.y.current === 2,
    handles: typeof timing.start === "function" && typeof timing.stop === "function" && typeof delay.start === "function" && typeof delay.stop === "function",
    kinds: typeof Animated.View === "string" && typeof Animated.Image === "string",
    os: Platform.OS === "web",
  };
  return <View testID="probe" facts={facts} />;
}
`,
  );
  try {
    await withHost(async (host) => {
      try {
        const handle = host.mountModule(probe, "Probe", {});
        const facts = handle.find("View")[0].props.facts;
        assert.deepEqual(facts, { set: true, interp: true, xy: true, handles: true, kinds: true, os: true });
        assert.equal(host.animations.length, 2);
      } catch (error) {
        assert.fail(`${PRECONDITION}: ${error.message}`);
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("OFFC-09 bank: ticks advance each tier by its own cadence and call setValue only on a change", () => {
  const made = [];
  const bank = createClockBank((initial) => {
    const value = { current: initial, calls: 0, setValue(n) { this.current = n; this.calls++; } };
    made.push(value);
    return value;
  });
  assert.equal(made.length, LIM.CLOCK_TIER_COUNT);
  assert.equal(bank.values.length, LIM.CLOCK_TIER_COUNT);
  for (let n = 1; n <= 64; n++) {
    bank.tick();
    assert.equal(bank.ticks, n);
    made.forEach((value, i) => {
      const expected = Math.floor(n / LIM.CLOCK_TICKS_PER_FRAME[i]) % LIM.CLOCK_CYCLE;
      assert.equal(value.current, expected, `tier ${i} after ${n} ticks`);
      assert.ok(Number.isInteger(value.current) && value.current >= 0 && value.current <= 3);
    });
  }
  assert.equal(made[3].calls, 8);
  assert.equal(made[0].calls, 64);
  assert.equal(made[2].calls, 16);
});

test("OFFC-09 shared timer: one interval serves every user and the last release clears it once", () => {
  const sets = [];
  const clears = [];
  const clock = createSharedClock({
    makeValue: (initial) => ({ current: initial, setValue(n) { this.current = n; } }),
    setIntervalFn: (fn, ms) => {
      const handle = { n: sets.length };
      sets.push({ fn, ms, handle });
      return handle;
    },
    clearIntervalFn: (handle) => clears.push(handle),
  });
  const early = clock.bank();
  assert.equal(sets.length, 0);
  const a = clock.acquire();
  assert.equal(a, early, "bank() before the first acquire is the bank acquire returns");
  clock.acquire();
  assert.equal(sets.length, 1);
  assert.equal(sets[0].ms, LIM.CLOCK_TICK_MS);
  assert.equal(clock.count, 2);
  sets[0].fn();
  assert.equal(a.ticks, 1);
  clock.release();
  assert.equal(clears.length, 0);
  clock.release();
  assert.deepEqual(clears, [sets[0].handle]);
  for (let i = 0; i < 4; i++) sets[0].fn();
  const again = clock.acquire();
  assert.equal(sets.length, 2);
  assert.equal(again, a);
  assert.equal(again.ticks, 5, "the bank keeps its phases");
  clock.release();
  clock.release();
  clock.release();
  assert.equal(clock.count, 0);
  assert.equal(clears.length, 2);
});

// A recording environment: every primitive logs, stores its done callback and returns a stop function.
function recordingEnv() {
  const calls = [];
  const pending = [];
  const prim = (label, done) => {
    const rec = { done, stops: 0 };
    pending.push(rec);
    calls.push(label);
    return () => {
      rec.stops++;
      calls.push("stop");
    };
  };
  const env = {
    place: (f) => calls.push(`place:${f.x},${f.y}`),
    setOpacity: (v) => calls.push(`opacity:${v}`),
    moveTo: (f, ms, done) => prim(`moveTo:${f.x},${f.y}:${ms}`, done),
    fade: (to, ms, done) => prim(`fade:${to}:${ms}`, done),
    hold: (ms, done) => prim(`hold:${ms}`, done),
  };
  const handlers = { onPhase: (pose, dir) => calls.push(`phase:${pose}:${dir}`), onEnd: () => calls.push("end") };
  return { calls, pending, env, handlers };
}

const journeyOf = (steps) => ({ steps, startTile: pt(0, 0), startDir: "down", endTile: pt(0, 0), endDir: "down", totalMs: 0 });

test("OFFC-12 runner: steps run in order against the primitives, once, and stop on cancel", () => {
  const field = { grid: open(6, 4) };
  const out = walkPath(field, pt(0, 0), pt(3, 2));
  const back = walkPath(field, pt(3, 2), pt(0, 2));
  const [s1, s2] = out.segments;
  const s3 = back.segments[0];
  const journey = journeyOf([{ kind: "walk", plan: out, run: false }, { kind: "wait", ms: 500, pose: "stand", dir: "down" }, { kind: "walk", plan: back, run: false }]);

  const r = recordingEnv();
  runJourney(journey, r.env, r.handlers);
  assert.deepEqual(r.calls, ["opacity:1", `phase:walk:${s1.dir}`, `moveTo:${s1.x},${s1.y}:${s1.ms}`]);
  r.pending[0].done();
  r.pending[0].done();
  assert.equal(r.calls.length, 5, "a done callback invoked twice advances once");
  assert.deepEqual(r.calls.slice(3), [`phase:walk:${s2.dir}`, `moveTo:${s2.x},${s2.y}:${s2.ms}`]);
  r.pending[1].done();
  assert.deepEqual(r.calls.slice(5), ["phase:stand:down", "hold:500"]);
  r.pending[2].done();
  assert.deepEqual(r.calls.slice(7), ["phase:walk:left", `moveTo:${s3.x},${s3.y}:${s3.ms}`]);
  r.pending[3].done();
  assert.equal(r.calls.at(-1), "end");
  assert.equal(r.calls.filter((c) => c === "end").length, 1);

  const running = recordingEnv();
  runJourney(journeyOf([{ kind: "walk", plan: out, run: true }]), running.env, running.handlers);
  assert.equal(running.calls[1], `phase:run:${s1.dir}`);

  const appear = recordingEnv();
  runJourney(journeyOf([{ kind: "appear", tile: pt(2, 2), dir: "down", ms: 450 }, { kind: "vanish", ms: 450 }]), appear.env, appear.handlers);
  const foot = footPx(pt(2, 2));
  assert.deepEqual(appear.calls, [`place:${foot.x},${foot.y}`, "opacity:0", "phase:stand:down", "fade:1:450"]);
  appear.pending[0].done();
  assert.deepEqual(appear.calls.slice(4), ["fade:0:450"]);
  appear.pending[1].done();
  assert.equal(appear.calls.at(-1), "end");

  const cancelled = recordingEnv();
  const stop = runJourney(journey, cancelled.env, cancelled.handlers);
  const before = cancelled.calls.length;
  stop();
  stop();
  assert.equal(cancelled.pending[0].stops, 1);
  assert.deepEqual(cancelled.calls.slice(before), ["stop"]);
  cancelled.pending[0].done();
  assert.equal(cancelled.calls.length, before + 1, "no call after cancel");
  assert.ok(!cancelled.calls.includes("end"));

  const skipped = recordingEnv();
  const still = walkPath(field, pt(1, 1), pt(1, 1));
  runJourney(journeyOf([{ kind: "walk", plan: still, run: false }]), skipped.env, skipped.handlers);
  assert.deepEqual(skipped.calls, ["opacity:1", "end"]);

  const empty = recordingEnv();
  runJourney(journeyOf([]), empty.env, empty.handlers);
  assert.deepEqual(empty.calls, ["end"]);

  const long = recordingEnv();
  runJourney(journeyOf(Array.from({ length: LIM.JOURNEY_MAX_STEPS + 1 }, () => ({ kind: "vanish", ms: 1 }))), long.env, long.handlers);
  assert.deepEqual(long.calls, ["end"]);

  const sync = recordingEnv();
  const syncEnv = { ...sync.env, hold: (ms, done) => { sync.calls.push(`hold:${ms}`); done(); return () => {}; } };
  runJourney(journeyOf([{ kind: "wait", ms: 1, pose: "sit", dir: "up" }, { kind: "wait", ms: 2, pose: "sit", dir: "up" }]), syncEnv, sync.handlers);
  assert.equal(sync.calls.at(-1), "end", "primitives that finish at once do not stall the run");
});

test("OFFC-09 character: a clipped frame over the whole sheet, stepped by the tier of the pose", async () => {
  await withHost(async (host) => {
    const sheets = [sheet(["stand", "walk"])];
    const props = baseProps({ sheets });
    const handle = mountSprite(host, props);
    await handle.flush();
    const zoom = props.zoom;
    const outer = handle.tree;
    assert.equal(outer.type, "Animated.View");
    assert.equal(outer.props.style.position, "absolute");
    assert.equal(outer.props.style.opacity.current, 1);
    const origin = frameOrigin(footPx(props.at), zoom);
    assert.equal(outer.props.style.transform[0].translateX.current, origin.left);
    assert.equal(outer.props.style.transform[1].translateY.current, origin.top);
    const frame = outer.children[0];
    assert.equal(frame.type, "View");
    assert.deepEqual({ w: frame.props.style.width, h: frame.props.style.height, o: frame.props.style.overflow }, { w: CHAR_W * zoom, h: CHAR_H * zoom, o: "hidden" });
    assert.equal(frame.children.length, 1);
    const image = frame.children[0];
    assert.equal(image.type, "Animated.Image");
    const win = sheetWindow(["stand", "walk"], zoom);
    assert.equal(image.props.style.width, win.sheetW);
    assert.equal(image.props.style.height, win.sheetH);
    assert.equal(image.props.source, sheets[0].source);
    const ramp = image.props.style.transform[0].translateX;
    assert.deepEqual(ramp.config.outputRange, xRamp("stand", zoom).outputRange);
    assert.equal(ramp.config.extrapolate, "clamp");
    assert.equal(image.props.style.transform[1].translateY, rowOffset(["stand", "walk"], "stand", "down", zoom));
    handle.rerender({ ...props });
    assert.equal(imageOf(handle).props.source, sheets[0].source, "the same source object after a rerender");
    assert.equal(handle.find("Text").length, 0);
  });
});

test("OFFC-09 character poses: the pose picks the ramp, the row and the sheet; missing poses fall back to the rest frame", async () => {
  await withHost(async (host, timers) => {
    const props = baseProps();
    const zoom = props.zoom;
    const handle = mountSprite(host, props);
    await handle.flush();
    for (let i = 0; i < 12; i++) timers.set[0].fn();
    assert.equal(tierOfValue(rampOf(handle).parent), POSE_TIER.stand);
    handle.rerender({ ...props, pose: "walk", dir: "right" });
    assert.deepEqual(rampOf(handle).config.outputRange, xRamp("walk", zoom).outputRange);
    assert.equal(tierOfValue(rampOf(handle).parent), POSE_TIER.walk);
    assert.equal(imageOf(handle).props.style.transform[1].translateY, rowOffset(["stand", "walk"], "walk", "right", zoom));

    const two = { ...props, sheets: [sheet(MOVE, "move.png"), sheet(WORK, "work.png")] };
    handle.rerender({ ...two, pose: "type" });
    assert.equal(imageOf(handle).props.source, two.sheets[1].source);
    handle.rerender({ ...two, pose: "walk" });
    assert.equal(imageOf(handle).props.source, two.sheets[0].source);
    handle.rerender({ ...two, pose: "groom" });
    assert.equal(imageOf(handle).props.source, two.sheets[0].source);
    assert.deepEqual(rampOf(handle).config.outputRange, xRamp("stand", zoom).outputRange);
    assert.ok(Object.is(imageOf(handle).props.style.transform[1].translateY, 0));

    handle.rerender({ ...props, sheets: [] });
    assert.equal(handle.find("Animated.Image").length, 0);

    for (const level of ZOOM_LEVELS) {
      const sized = mountSprite(host, baseProps({ zoom: level }));
      await sized.flush();
      const style = imageOf(sized).props.style;
      const frame = sized.tree.children[0].props.style;
      for (const n of [style.width, style.height, frame.width, frame.height]) assert.ok(Number.isInteger(n), `zoom ${level}`);
    }

    const full = mountSprite(host, baseProps({ children: "child-node", zIndex: 7, testID: "hero", onPress: () => {} }));
    await full.flush();
    assert.equal(full.find("Pressable").length, 1);
    assert.equal(full.find("Pressable")[0].children[0].type, "View");
    assert.ok(full.tree.children.includes("child-node"));
    assert.equal(full.tree.props.testID, "hero");
    assert.equal(full.tree.props.style.zIndex, 7);
    const plain = mountSprite(host, baseProps());
    await plain.flush();
    assert.equal(plain.find("Pressable").length, 0);
  });
});

test("OFFC-09 shared clocks in the component: one interval for every character, cleared with the last", async () => {
  await withHost(async (host, timers) => {
    const a = mountSprite(host, baseProps());
    const b = mountSprite(host, baseProps({ at: pt(5, 5) }));
    await a.flush();
    await b.flush();
    assert.equal(timers.set.length, 1);
    assert.equal(timers.set[0].ms, LIM.CLOCK_TICK_MS);
    const parent = rampOf(a).parent;
    assert.equal(parent, rampOf(b).parent, "both read the same tier value object");
    a.unmount();
    assert.equal(timers.clear.length, 0);
    b.unmount();
    assert.deepEqual(timers.clear, [timers.set[0].handle]);
    const before = parent.current;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(parent.current, before, "no clock value changes with zero characters mounted");
    const c = mountSprite(host, baseProps());
    await c.flush();
    assert.equal(timers.set.length, 2);
  });
});

test("OFFC-12 character journeys: a journey switches the pose, is cancelled when replaced or unmounted, and never ends after that", async () => {
  await withHost(async (host) => {
    const field = { grid: open(8, 4) };
    const first = handoffJourney(field, pt(0, 0), pt(4, 0), { homeDir: "down" });
    const second = handoffJourney(field, pt(0, 0), pt(2, 2), { homeDir: "down" });
    let ended = 0;
    const props = baseProps({ journey: first, onJourneyEnd: () => { ended++; }, at: pt(0, 0) });
    const handle = mountSprite(host, props);
    await handle.flush();
    assert.deepEqual(rampOf(handle).config.outputRange, xRamp("walk", props.zoom).outputRange);
    assert.equal(ended, 0);
    const started = host.animations.length;
    assert.ok(started >= 1);
    assert.equal(host.animations[started - 1].stopped, false);
    handle.rerender({ ...props, journey: second });
    await handle.flush();
    assert.equal(host.animations[started - 1].stopped, true, "the old run was stopped");
    assert.ok(host.animations.length > started, "the new run started");
    const latest = host.animations.length - 1;
    handle.unmount();
    assert.equal(host.animations[latest].stopped, true);
    assert.equal(ended, 0);
  });
});

test("OFFC-09 source rules: clocks and the component keep to the allowed imports, one timer and no visible text", async () => {
  const clocks = stripComments(readClient("clocks.ts"));
  assert.deepEqual([...new Set(importSpecs(clocks))].sort(), ["./life/bank.ts", "react", "react-native"]);
  assert.equal((clocks.match(/\bsetInterval\s*\(/g) ?? []).length, 1);
  assert.equal((clocks.match(/\bclearInterval\s*\(/g) ?? []).length, 1);
  assert.doesNotMatch(clocks, /\b(useState|useReducer|useSyncExternalStore|useRef)\b/);

  const rawChar = readClient("character.tsx");
  const char = stripComments(rawChar);
  for (const spec of importSpecs(char)) {
    if (!spec.startsWith(".")) assert.ok(["react", "react-native"].includes(spec), spec);
    assert.doesNotMatch(spec, /server\//);
  }
  assert.doesNotMatch(char, /\b(setTimeout|setInterval|clearInterval|clearTimeout|requestAnimationFrame)\b/);
  assert.doesNotMatch(char, /StyleSheet\.create|<Text\b/);
  const ts = createRequire(path.join(PLUGIN_DIR, "package.json"))("typescript");
  const source = ts.createSourceFile("character.tsx", rawChar, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const literals = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) assert.equal(node.getText().trim(), "", "no JSX text node");
    if (ts.isStringLiteral(node) && !ts.isImportDeclaration(node.parent)) literals.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const allowed = new Set(["web", "absolute", "hidden", "clamp", "appear", "vanish"]);
  for (const literal of literals) assert.ok(allowed.has(literal), `string literal ${JSON.stringify(literal)} is not a style token or host name`);

  for (const rel of ["clocks.ts", "character.tsx", path.join("life", "bank.ts"), path.join("life", "runner.ts")]) {
    const text = readClient(rel);
    for (const re of PANL05) assert.doesNotMatch(stripComments(text), re, `${rel}: ${re}`);
    assert.doesNotMatch(text, PANL06, rel);
  }
});

test("OFFC-09 child scale: a smaller sheet stands on the same foot pixel", async () => {
  await withHost(async (host) => {
    const small = sheet(["stand", "walk"], "small.png");
    const props = baseProps({ sheets: [small], zoom: 4, sheetZoom: 2, at: pt(3, 2) });
    const handle = mountSprite(host, props);
    await handle.flush();
    const frame = handle.tree.children[0];
    assert.deepEqual({ w: frame.props.style.width, h: frame.props.style.height, o: frame.props.style.overflow }, { w: CHAR_W * 2, h: CHAR_H * 2, o: "hidden" });
    const image = frame.children[0];
    const win = sheetWindow(["stand", "walk"], 2);
    assert.equal(image.props.style.width, win.sheetW);
    assert.equal(image.props.style.height, win.sheetH);
    assert.deepEqual(image.props.style.transform[0].translateX.config.outputRange, xRamp("stand", 2).outputRange);
    assert.equal(image.props.style.transform[1].translateY, rowOffset(["stand", "walk"], "stand", "down", 2));
    const origin = frameOrigin(footPx(pt(3, 2)), 4, 2);
    assert.equal(handle.tree.props.style.transform[0].translateX.current, origin.left);
    assert.equal(handle.tree.props.style.transform[1].translateY.current, origin.top);
    const bigOrigin = frameOrigin(footPx(pt(3, 2)), 4);
    assert.equal(origin.left + CHAR_AX * 2, bigOrigin.left + CHAR_AX * 4, "same foot pixel on screen");
    assert.equal(origin.top + CHAR_AY * 2, bigOrigin.top + CHAR_AY * 4);

    const journey = handoffJourney({ grid: open(8, 4) }, pt(3, 2), pt(6, 2), { homeDir: "down" });
    const walking = mountSprite(host, { ...props, journey });
    await walking.flush();
    const move = host.animations.filter((a) => a.config && a.config.toValue && typeof a.config.toValue === "object").at(-1);
    const target = frameOrigin(journey.steps[0].plan.segments[0] ? { x: journey.steps[0].plan.segments[0].x, y: journey.steps[0].plan.segments[0].y } : footPx(pt(3, 2)), 4, 2);
    assert.deepEqual(move.config.toValue, { x: target.left, y: target.top });

    const same = mountSprite(host, baseProps({ sheets: [small], zoom: 2, at: pt(3, 2) }));
    const explicit = mountSprite(host, baseProps({ sheets: [small], zoom: 2, sheetZoom: 2, at: pt(3, 2) }));
    await same.flush();
    await explicit.flush();
    assert.deepEqual(same.tree.props.style.transform[0].translateX.current, explicit.tree.props.style.transform[0].translateX.current);
    assert.deepEqual(imageOf(same).props.style.width, imageOf(explicit).props.style.width);

    for (const bad of [{ zoom: 2, sheetZoom: 4 }, { zoom: 4, sheetZoom: 5 }]) {
      const none = mountSprite(host, baseProps({ sheets: [small], ...bad }));
      await none.flush();
      assert.deepEqual(none.tree, [], `zoom ${bad.zoom} sheetZoom ${bad.sheetZoom} renders nothing`);
    }
  });
});

// ---------------------------------------------------------------- Task 3: spot ledger, wandering and hangouts

const ELIGIBLE = new Set(["reception", "cafe", "lounge", "corridor"]);
const inSomeGroup = (pose) => SHEET_POSE_GROUPS.some((g) => g.includes(pose));
const eligibleSpots = (index) => index.spots.filter((s) => ELIGIBLE.has(index.areaKindOf(s.id)));
const manhattan = (tile, spot) => Math.abs(tile.x - spot.tx) + Math.abs(tile.y - spot.ty);
// Spot kinds of each kept activity, pinned from habblaud sim/sim.ts planOuting (restroom, mirror and stretch left out).
const ACTIVITY_KINDS = {
  coffee: ["coffee"], water: ["water"], lounge: ["sofa", "armchair", "beanbag"], window: ["window"], shelf: ["shelf"],
  arcade: ["arcade"], snack: ["snack", "fridge"], phone: ["beanbag", "sofa", "armchair", "cafe_seat", "bench"],
};

test("OFFC-13 ledger: one holder per spot, all-or-nothing group reservation, ids are plain keys", () => {
  const ledger = createSpotLedger();
  assert.equal(ledger.reserve("s1", "alice"), true);
  assert.equal(ledger.reserve("s1", "alice"), true, "the holder may reserve again");
  assert.equal(ledger.reserve("s1", "bob"), false);
  assert.equal(ledger.isFree("s1"), false);
  assert.equal(ledger.isFree("s1", "alice"), true);
  assert.equal(ledger.isFree("s1", "bob"), false);
  assert.equal(ledger.ownerOf("s1"), "alice");
  ledger.release("s1", "bob");
  assert.equal(ledger.isFree("s1"), false, "only the holder releases");
  ledger.release("s1", "alice");
  assert.equal(ledger.isFree("s1"), true);

  ledger.reserve("a", "carol");
  ledger.reserve("b", "carol");
  ledger.reserve("c", "dave");
  assert.deepEqual(ledger.reservedBy("carol"), ["a", "b"]);
  ledger.releaseAll("carol");
  assert.deepEqual(ledger.reservedBy("carol"), []);
  assert.equal(ledger.size, 1);
  assert.equal(ledger.reserveAll(["x", "c", "y"], "erin"), false);
  assert.equal(ledger.size, 1, "a refused reserveAll leaves the ledger unchanged");
  assert.equal(ledger.reserveAll(["x", "y"], "erin"), true);
  assert.deepEqual(ledger.reservedBy("erin"), ["x", "y"]);

  const odd = ["__proto__", "constructor", "a b", "room:../x", "core:reception"];
  for (const id of odd) assert.equal(ledger.reserve(id, id), true, id);
  for (const id of odd) {
    assert.equal(ledger.ownerOf(id), id);
    assert.equal(ledger.isFree(id), false);
  }
  assert.equal(ledger.ownerOf("toString"), undefined);
  assert.equal(ledger.isFree("toString"), true);

  const building = buildingOf();
  const index = indexSpots(building);
  const all = building.areas.flatMap((a) => a.spots);
  assert.equal(index.spots.length, all.length);
  assert.deepEqual(index.spots.map((s) => s.id), all.map((s) => s.id), "area order then spot order");
  assert.equal(new Set(index.spots.map((s) => s.id)).size, index.spots.length);
  assert.equal(index.ofKind("pingpong").length, 2);
  assert.equal(index.group("pingpong").length, 2);
  assert.deepEqual(index.ofKind("nothing"), []);
  for (const area of building.areas) for (const spot of area.spots) {
    assert.equal(index.areaOf(spot.id), area.id);
    assert.equal(index.areaKindOf(spot.id), area.kind);
  }
  assert.equal(index.areaOf("__proto__"), undefined);
});

test("OFFC-13 wander: only free spots of the four common areas, by the habblaud weights, deterministic", () => {
  const building = buildingOf();
  const index = indexSpots(building);
  const eligible = eligibleSpots(index);
  assert.ok(eligible.length > 0);
  const activities = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const ledger = createSpotLedger();
    const choice = pickWander({ index, ledger, rng: mulberry32(seed) });
    assert.ok(choice !== null, `seed ${seed}`);
    activities.add(choice.activity);
    const spot = index.spots.find((s) => s.id === choice.spotId);
    assert.ok(spot, "the spot is in the index");
    assert.ok(ELIGIBLE.has(index.areaKindOf(spot.id)), `${spot.id} is in a common area`);
    assert.ok(ACTIVITY_KINDS[choice.activity].includes(spot.kind), `${choice.activity} uses ${spot.kind}`);
    assert.deepEqual(choice.tile, pt(spot.tx, spot.ty));
    assert.ok(building.grid.walkable(choice.tile.x, choice.tile.y));
    assert.equal(choice.dir, spot.dir);
    assert.ok(Object.hasOwn(POSE_FRAMES, choice.pose) && inSomeGroup(choice.pose), choice.pose);
    assert.ok(Number.isInteger(choice.stayMs) && choice.stayMs >= LIM.WANDER_STAY_MS_MIN && choice.stayMs <= LIM.WANDER_STAY_MS_MAX, `stay ${choice.stayMs}`);
    assert.deepEqual(pickWander({ index, ledger, rng: mulberry32(seed) }), choice);
  }
  assert.ok(activities.size >= 3, `activities seen: ${[...activities].join(",")}`);

  // Pinned from habblaud client/src/world/sim/behavior.ts IDLE_WEIGHTS @ faa1a012b5fbf632c66dc6801c5383e53a542406 (kept activities only).
  assert.deepEqual({ ...IDLE_WEIGHTS }, { coffee: 18, water: 12, lounge: 12, window: 7, shelf: 6, arcade: 5, snack: 5, phone: 6 });
  assert.equal(LIM.WANDER_NEAREST_CHOICES, 3);

  const taken = createSpotLedger();
  for (const s of eligible) taken.reserve(s.id, "other");
  assert.equal(pickWander({ index, ledger: taken, rng: mulberry32(1) }), null);
  const coffee = eligible.find((s) => s.kind === "coffee");
  taken.release(coffee.id, "other");
  for (let seed = 0; seed < 50; seed++) {
    const only = pickWander({ index, ledger: taken, rng: mulberry32(seed) });
    assert.equal(only.spotId, coffee.id);
    assert.equal(only.activity, "coffee");
  }
  taken.reserve(coffee.id, "me");
  assert.equal(pickWander({ index, ledger: taken, rng: mulberry32(2) }), null, "held by me, so not free for an anonymous walker");
  assert.equal(pickWander({ index, ledger: taken, rng: mulberry32(2), by: "me" }).spotId, coffee.id, "the owner may take a spot it already holds");

  const from = pt(5, 14);
  for (let seed = 0; seed < 300; seed++) {
    const ledger = createSpotLedger();
    const choice = pickWander({ index, ledger, rng: mulberry32(seed), from });
    const nearest = eligible
      .filter((s) => ACTIVITY_KINDS[choice.activity].includes(s.kind))
      .map((s, order) => ({ s, order, d: manhattan(from, s) }))
      .sort((a, b) => a.d - b.d || a.order - b.order)
      .slice(0, LIM.WANDER_NEAREST_CHOICES)
      .map((x) => x.s.id);
    assert.ok(nearest.includes(choice.spotId), `seed ${seed}: ${choice.spotId} among ${nearest.join(",")}`);
  }

  const seed = wanderSeed("agent-a", 3);
  assert.equal(seed, 2382006587);
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  assert.notEqual(wanderSeed("agent-a", 4), seed);
  assert.notEqual(wanderSeed("agent-b", 3), seed);
  assert.throws(() => wanderSeed("agent-a", -1), RangeError);
  assert.equal(idleSitMs(() => 0), LIM.WANDER_SIT_MS_MIN);
  assert.ok(idleSitMs(() => 0.999999) < LIM.WANDER_SIT_MS_MAX);
  assert.equal(LIM.WANDER_SIT_MS_MIN, 6000);
  assert.equal(LIM.WANDER_SIT_MS_MAX, 20000);
});

test("OFFC-13 hangout: only whole free groups, a pose per member, all-or-nothing reservation", () => {
  const building = buildingOf();
  const index = indexSpots(building);
  const idle = (ids) => ids.map((id, i) => ({ id, tile: pt(5 + i, 14) }));
  const ledger = createSpotLedger();
  assert.equal(pickHangout({ index, ledger, idle: [], rng: mulberry32(1) }), null);
  assert.equal(pickHangout({ index, ledger, idle: idle(["a"]), rng: mulberry32(1) }), null);

  const kinds = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const agents = idle(["u1", "u2", "u3", "u4", "u5"].slice(0, 2 + (seed % 4)));
    const h = pickHangout({ index, ledger, idle: agents, rng: mulberry32(seed) });
    assert.ok(h !== null, `seed ${seed}`);
    kinds.add(h.kind);
    assert.ok(Object.hasOwn(HANGOUT_KINDS, h.kind));
    const rule = HANGOUT_KINDS[h.kind];
    const group = index.group(h.group);
    assert.ok(group.length >= rule.min, "no group below the kind minimum");
    assert.ok(h.members.length >= rule.min && h.members.length <= Math.min(rule.max, group.length, agents.length));
    assert.equal(new Set(h.members.map((m) => m.agentId)).size, h.members.length);
    assert.equal(new Set(h.members.map((m) => m.spotId)).size, h.members.length);
    for (const m of h.members) {
      assert.ok(group.some((s) => s.id === m.spotId), "a member spot belongs to the group");
      assert.ok(agents.some((a) => a.id === m.agentId));
      assert.ok(rule.poses.includes(m.pose) && Object.hasOwn(POSE_FRAMES, m.pose) && inSomeGroup(m.pose), m.pose);
    }
    assert.deepEqual(pickHangout({ index, ledger, idle: agents, rng: mulberry32(seed) }), h);
  }
  assert.ok(kinds.size >= 2, `kinds seen: ${[...kinds].join(",")}`);

  // Pinned from habblaud client/src/world/social/gathering.ts KINDS and BASE @ faa1a012b5fbf632c66dc6801c5383e53a542406 (kept kinds only).
  const table = Object.fromEntries(Object.entries(HANGOUT_KINDS).map(([k, r]) => [k, [r.min, r.max, r.weight]]));
  assert.deepEqual(table, { pingpong: [2, 4, 9], kitchen: [2, 4, 12], talk: [2, 2, 8], rps: [2, 4, 8] });
  assert.equal(LIM.HANGOUT_MAX_MEMBERS, Math.max(...Object.values(HANGOUT_KINDS).map((r) => r.max)));

  const groups = [...new Set(index.spots.filter((s) => s.group !== undefined).map((s) => s.group))];
  const half = createSpotLedger();
  for (const g of groups) half.reserve(index.group(g)[0].id, "other");
  assert.equal(pickHangout({ index, ledger: half, idle: idle(["a", "b", "c"]), rng: mulberry32(3) }), null, "a group is never half used");

  const onlyReception = createSpotLedger();
  for (const g of groups) if (g !== "talk:reception") for (const s of index.group(g)) onlyReception.reserve(s.id, "other");
  const near = [{ id: "far1", tile: pt(60, 14) }, { id: "b", tile: pt(6, 10) }, { id: "far2", tile: pt(59, 14) }, { id: "a", tile: pt(7, 10) }];
  const met = pickHangout({ index, ledger: onlyReception, idle: near, rng: mulberry32(4) });
  assert.equal(met.group, "talk:reception");
  assert.deepEqual(met.members.map((m) => m.agentId).sort(), ["a", "b"], "the nearest idle agents take the group");
  const tied = pickHangout({ index, ledger: onlyReception, idle: ["m", "b", "a", "far"].map((id) => ({ id, tile: id === "far" ? pt(60, 14) : pt(6, 9) })), rng: mulberry32(4) });
  assert.deepEqual(tied.members.map((m) => m.agentId).sort(), ["a", "b"], "ties go to the lower id");

  const odd = pickHangout({ index, ledger: onlyReception, idle: idle(["__proto__", "a b", "constructor"]), rng: mulberry32(5) });
  assert.ok(odd !== null && odd.members.every((m) => ["__proto__", "a b", "constructor"].includes(m.agentId)));

  const shared = createSpotLedger();
  const h = pickHangout({ index, ledger: shared, idle: idle(["p", "q", "r"]), rng: mulberry32(7) });
  assert.equal(reserveHangout(shared, h), true);
  for (const m of h.members) assert.equal(shared.ownerOf(m.spotId), m.agentId);
  for (let seed = 0; seed < 100; seed++) {
    const again = pickHangout({ index, ledger: shared, idle: idle(["x", "y", "z"]), rng: mulberry32(seed) });
    assert.ok(again === null || again.group !== h.group, "a reserved group is not picked again");
  }
  releaseHangout(shared, h);
  assert.equal(shared.size, 0);
  const blocked = createSpotLedger();
  blocked.reserve(h.members[h.members.length - 1].spotId, "stranger");
  assert.equal(reserveHangout(blocked, h), false);
  assert.equal(blocked.size, 1, "a refused reservation changes nothing");
});

test("OFFC-13 source rules: ledger, wander and social stay pure and carry no persona, coin or speech identifier", () => {
  for (const rel of ["ledger.ts", "wander.ts", "social.ts"]) {
    const file = path.join("life", rel);
    const text = readClient(file);
    const lines = text.split("\n");
    assert.match(lines[0], PORT_LINE, `${rel}: port header`);
    assert.ok(lines[1].startsWith("//"), `${rel}: second header line`);
    const code = stripComments(text);
    for (const spec of importSpecs(code)) {
      assert.ok(spec.startsWith("."), `${rel}: no bare import (${spec})`);
      assert.match(spec, /\.tsx?$/);
      assert.match(spec, /^\.\.?\/(\.\.\/shared\/|layout\/|path\/|limits-life|\.\.\/layout\/|\.\.\/path\/|\.\.\/limits-life|ledger|\.\.\/\.\.\/shared)/, `${rel}: ${spec} is outside layout, path, shared and limits-life`);
    }
    assert.doesNotMatch(code, /Math\.random|Date\.now|new Date\b|\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/, rel);
    assert.doesNotMatch(code, /\b(persona|trait|traits|bond|wallet|bet|bets|betting|speech|floater|coin|coins)\b/i, `${rel}: excluded upstream part`);
    for (const re of PANL05) assert.doesNotMatch(code, re, `${rel}: ${re}`);
    assert.doesNotMatch(text, PANL06, rel);
  }
});
