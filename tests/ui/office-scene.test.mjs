import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CHAR_H, CHAR_W, ZOOM_LEVELS, sheetSize, TILE } from "../../plugins/office/shared/art-types.ts";
import { TINT_LEVELS } from "../../plugins/office/shared/tint.ts";
import {
  CORRIDOR_SEGMENT_TILES,
  ROOM_COLS_MAX,
  ROOM_LAYER_AREAS,
  ROOM_SLOT_MAX,
  ROOM_VARIANT_MAX,
  SEASON_CODES,
  SEASON_NAMES,
  SPRITE_KINDS,
  SPRITE_SEED_MAX_CHARS,
  parseRoomSeed,
  parseSpriteKey,
  roomSeed,
  spriteKey,
} from "../../plugins/office/shared/sprites-rpc.ts";
import { SPRITE_REGISTRY, renderRoomKey } from "../../plugins/office/server/sprite-registry.ts";
import { createSpritesHandler } from "../../plugins/office/server/sprites.ts";
import { renderRoomLayer } from "../../plugins/office/server/art/rooms.ts";
import { buildBuilding, ROOM_ID_PREFIX } from "../../plugins/office/shared/layout/building.ts";
import { appearanceSeed } from "../../plugins/office/client/poses.ts";
import { SHEET_POSE_GROUPS } from "../../plugins/office/client/life/frames.ts";
import { KIT_DIR } from "../helpers/temp.mjs";
import { fakeHost } from "./office-host.mjs";

const PLUGIN_DIR = path.join(KIT_DIR, "plugins", "office");
const normalise = (text) => text.replace(/\r\n/g, "\n");
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const readPlugin = (...parts) => normalise(fs.readFileSync(path.join(PLUGIN_DIR, ...parts), "utf8"));
const PNG_PREFIX = "data:image/png;base64,";
const pngSize = (uri) => {
  const bytes = Buffer.from(uri.slice(PNG_PREFIX.length), "base64");
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
};
const handler = () => createSpritesHandler();
const one = (key) => handler()({ keys: [key] }).sprites[0];
const mean = (buf) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < buf.data.length; i += 4) {
    if (buf.data[i + 3] === 0) continue;
    sum += buf.data[i] + buf.data[i + 1] + buf.data[i + 2];
    n += 3;
  }
  return sum / n;
};
const MAX_ZOOM = Math.max(...ZOOM_LEVELS);
const threeRooms = () => buildBuilding([{ id: "a", slot: 0, seed: 11 }, { id: "b", slot: 1, seed: 12 }, { id: "c", slot: 2, seed: 13 }]);

// ---------------------------------------------------------------- Task 1: room seed grammar, registry, retirement

test("OFFC-08 room seed: every spec round-trips and fits a sprite key", () => {
  const specs = [
    { area: "room", slot: 0, variant: 0, cols: null, segment: null, season: "none" },
    { area: "room", slot: ROOM_SLOT_MAX, variant: ROOM_VARIANT_MAX, cols: null, segment: null, season: "halloween" },
    ...["reception", "restroom", "cafe", "lounge"].map((area) => ({ area, slot: null, variant: null, cols: null, segment: null, season: "christmas" })),
    { area: "corridor", slot: null, variant: null, cols: 3, segment: 2, season: "none" },
    { area: "corridor", slot: null, variant: null, cols: ROOM_COLS_MAX, segment: ROOM_COLS_MAX - 1, season: "christmas" },
  ];
  assert.deepEqual([...ROOM_LAYER_AREAS], ["room", "reception", "restroom", "cafe", "lounge", "corridor"]);
  assert.deepEqual(SEASON_NAMES, ["none", "christmas", "halloween"]);
  assert.deepEqual({ ...SEASON_CODES }, { none: "n", christmas: "c", halloween: "h" });
  for (const spec of specs) {
    const seed = roomSeed(spec);
    assert.ok(seed.length <= SPRITE_SEED_MAX_CHARS, seed);
    assert.deepEqual(parseRoomSeed(seed), spec);
    assert.equal(roomSeed(parseRoomSeed(seed)), seed);
    const key = spriteKey({ kind: "room-layer", seed, poses: [], scale: 2, tint: 0 });
    assert.equal(parseSpriteKey(key).seed, seed);
  }
  assert.equal(roomSeed(specs[0]), "room-s0-q0-n");
  assert.equal(roomSeed(specs[2]), "reception-c");
  assert.equal(CORRIDOR_SEGMENT_TILES, 16);
});

test("OFFC-08 room seed: malformed seeds parse to null and bad specs name the field", () => {
  const bad = [
    "", "room", "room-s0-q0", "room-s00-q0-n", "room-s01-q0-n", "room-s-1-q0-n", "room-s32-q0-n", "room-s0-q4294967296-n", "room-s0-q0-x",
    "room-s0-q0-n-extra", "room-s0-q00-n", "reception", "reception-x", "reception-n-n", "spa-n", "corridor-c3-g3-n", "corridor-c0-g0-n",
    "corridor-c19-g0-n", "corridor-c3-g03-n", "corridor-c3-g-1-n", "Room-s0-q0-n", " room-s0-q0-n", "room-s0-q0-n\n", "__proto__", "constructor",
    "room-s1.5-q0-n", "room-s0-q1e3-n", "x".repeat(200),
  ];
  for (const seed of bad) assert.equal(parseRoomSeed(seed), null, JSON.stringify(seed));
  for (const seed of [null, undefined, 4, {}, []]) assert.equal(parseRoomSeed(seed), null);
  const room = { area: "room", slot: 1, variant: 5, cols: null, segment: null, season: "none" };
  const corridor = { area: "corridor", slot: null, variant: null, cols: 3, segment: 1, season: "none" };
  const cases = [
    [{ ...room, area: "garden" }, "area"],
    [{ ...room, season: "easter" }, "season"],
    [{ ...room, season: "__proto__" }, "season"],
    [{ ...room, slot: ROOM_SLOT_MAX + 1 }, "slot"],
    [{ ...room, slot: -1 }, "slot"],
    [{ ...room, slot: 1.5 }, "slot"],
    [{ ...room, variant: ROOM_VARIANT_MAX + 1 }, "variant"],
    [{ ...room, variant: null }, "variant"],
    [{ ...corridor, cols: 0 }, "cols"],
    [{ ...corridor, cols: ROOM_COLS_MAX + 1 }, "cols"],
    [{ ...corridor, segment: 3 }, "segment"],
    [{ ...corridor, segment: -1 }, "segment"],
  ];
  for (const [spec, field] of cases) assert.throws(() => roomSeed(spec), (e) => e instanceof RangeError && e.message === field, field);
});

test("OFFC-07 registry kinds: exactly ruler, character-sheet, room-layer and room-front", () => {
  assert.deepEqual([...SPRITE_KINDS], ["ruler", "character-sheet", "room-layer", "room-front"]);
  assert.deepEqual(Object.keys(SPRITE_REGISTRY), [...SPRITE_KINDS]);
  assert.equal(parseSpriteKey("spike-char:abc:stand:2:0"), null);
  assert.equal(parseSpriteKey("spike-room:room:-:2:0"), null);
});

test("OFFC-11 registry sheets: sheet size, determinism and per-seed bytes", () => {
  const handle = handler();
  for (const zoom of ZOOM_LEVELS) {
    for (const poses of SHEET_POSE_GROUPS) {
      const key = spriteKey({ kind: "character-sheet", seed: appearanceSeed("agent-1"), poses, scale: zoom, tint: 0 });
      const first = handle({ keys: [key] }).sprites[0];
      assert.equal(first.ok, true, key);
      const { cols, rows } = sheetSize(poses);
      assert.deepEqual(pngSize(first.uri), { w: cols * CHAR_W * zoom, h: rows * CHAR_H * zoom });
      assert.equal(handle({ keys: [key] }).sprites[0].uri, first.uri);
      const other = spriteKey({ kind: "character-sheet", seed: appearanceSeed("agent-2"), poses, scale: zoom, tint: 0 });
      assert.notEqual(handle({ keys: [other] }).sprites[0].uri, first.uri);
    }
  }
  const empty = spriteKey({ kind: "character-sheet", seed: appearanceSeed("agent-1"), poses: [], scale: 2, tint: 0 });
  const result = handler()({ keys: [empty] }).sprites[0];
  assert.equal(result.ok, false);
  assert.equal(result.code, "render_failed");
});

test("OFFC-17 registry layers: every area, tint and season is drawn at the tile size", () => {
  const building = threeRooms();
  const seedOf = (area) => {
    if (area.kind === "room") return { seeds: [roomSeed({ area: "room", slot: area.id === "room:a" ? 0 : area.id === "room:b" ? 1 : 2, variant: area.id === "room:a" ? 11 : area.id === "room:b" ? 12 : 13, cols: null, segment: null, season: "none" })], w: area.rect.w };
    if (area.kind === "corridor") {
      return { seeds: Array.from({ length: building.cols }, (_, g) => roomSeed({ area: "corridor", slot: null, variant: null, cols: building.cols, segment: g, season: "none" })), w: CORRIDOR_SEGMENT_TILES };
    }
    return { seeds: [roomSeed({ area: area.kind, slot: null, variant: null, cols: null, segment: null, season: "none" })], w: area.rect.w };
  };
  const handle = handler();
  const seen = new Set();
  for (const area of building.areas) {
    const { seeds, w } = seedOf(area);
    seen.add(area.kind);
    for (const seed of seeds) {
      for (const tint of [0, TINT_LEVELS - 1]) {
        for (const kind of ["room-layer", "room-front"]) {
          const key = spriteKey({ kind, seed, poses: [], scale: MAX_ZOOM, tint });
          const out = handle({ keys: [key] }).sprites[0];
          assert.equal(out.ok, true, `${key} ${out.message ?? ""}`);
          assert.deepEqual(pngSize(out.uri), { w: w * TILE * MAX_ZOOM, h: area.rect.h * TILE * MAX_ZOOM }, key);
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), ["cafe", "corridor", "lounge", "reception", "restroom", "room"]);
  const roomA = buildBuilding([{ id: "r", slot: 0, seed: 11 }]).areas.find((a) => a.id === `${ROOM_ID_PREFIX}r`);
  const roomSpec = { kind: "room-layer", seed: "room-s0-q11-n", poses: [], scale: 2, tint: 0 };
  const direct = renderRoomLayer(roomA, { theme: "none", hour: 13.5 });
  const viaRegistry = renderRoomKey(roomSpec, "base").buf;
  assert.equal(Buffer.compare(Buffer.from(viaRegistry.data), Buffer.from(direct.base.data)), 0);
  assert.equal(renderRoomKey({ ...roomSpec, kind: "room-front" }, "front").buf.w, direct.base.w);
  const night = renderRoomKey({ ...roomSpec, tint: TINT_LEVELS - 1 }, "base").buf;
  assert.ok(mean(night) < mean(viaRegistry), "the last tint is darker");
  const christmas = renderRoomKey({ ...roomSpec, seed: "room-s0-q11-c" }, "base").buf;
  assert.notEqual(Buffer.compare(Buffer.from(christmas.data), Buffer.from(viaRegistry.data)), 0);
});

test("OFFC-07 registry failures: bad seeds, tints and ranges are per-key render_failed", () => {
  const handle = handler();
  const keys = [
    "room-layer:room-s00-q0-n:-:2:0",
    "room-layer:nowhere:-:2:0",
    "room-front:corridor-c3-g3-n:-:2:0",
    "room-layer:room-s32-q0-n:-:2:0",
    `room-layer:room-s0-q0-n:-:2:${TINT_LEVELS}`,
    "room-layer:corridor-c2-g5-n:-:2:0",
  ];
  const out = handle({ keys });
  assert.equal(out.ok, true);
  for (const result of out.sprites) {
    assert.equal(result.ok, false, result.key);
    assert.ok(["render_failed", "bad_key"].includes(result.code), result.code);
    assert.ok(!/at |\.ts|\\|\//.test(result.message), result.message);
  }
  assert.equal(out.sprites[1].code, "render_failed" === out.sprites[1].code ? "render_failed" : "bad_key");
  for (const i of [2, 3, 4, 5]) assert.equal(out.sprites[i].code, "render_failed");
  assert.doesNotThrow(() => handle({ keys: [null] }));
});

test("OFFC-10 retirement: the spike is gone and one office screen is registered", async () => {
  for (const rel of [["server", "art", "spike"], ["client", "spike-screen.tsx"], ["client", "spike-hud.ts"]]) {
    assert.equal(fs.existsSync(path.join(PLUGIN_DIR, ...rel)), false, rel.join("/"));
  }
  const register = stripComments(readPlugin("client", "register.ts"));
  assert.ok(!/registerSpike|SPIKE/i.test(register));
  assert.ok(!/spike/i.test(stripComments(readPlugin("index.client.tsx"))));
  const exported = [...register.matchAll(/export (?:const|function) (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["SCREEN_ID", "SCREEN_TITLE", "register"]);
  const host = await fakeHost();
  try {
    assert.equal(host.screens.length, 1);
    assert.equal(host.sidebarItems.length, 1);
    assert.equal(host.screens[0].id, "office");
    assert.equal(host.sidebarItems[0].id, "office");
  } finally {
    host.dispose();
  }
});

// ---------------------------------------------------------------- Task 2: pure scene logic

const CAM = await import("../../plugins/office/client/camera.ts");
const { WAVE_CALLS_IN_FLIGHT_MAX, WAVE_MIN_INTERVAL_MS, WAVE_RUNS_MAX, waveTrigger } = await import("../../plugins/office/client/wave-trigger.ts");
const { projectList } = await import("../../plugins/office/client/sidebar-model.ts");
const { poseFor } = await import("../../plugins/office/client/poses.ts");
const { elevatorFronts } = await import("../../plugins/office/client/life/journey.ts");
const { indexSpots } = await import("../../plugins/office/client/life/ledger.ts");
const { HANGOUT_KINDS } = await import("../../plugins/office/client/life/social.ts");
const { effectFor } = await import("../../plugins/office/client/effects.ts");
const { createStore: _unused } = await import("../../plugins/office/client/store.ts");
void _unused;

const flushMicro = () => new Promise((resolve) => setImmediate(resolve));
const THRESHOLDS = JSON.parse(fs.readFileSync(path.join(KIT_DIR, ".planning", "phases", "07-office", "07-SPIKE-THRESHOLDS.json"), "utf8"));
const pt = (x, y) => ({ x, y });

const drawn = (agentId, parentId = null) => ({ agentId, parentId, isChild: parentId !== null });
const cluster = (workspaceId, list, surplusAgents = 0) => ({ workspaceId, name: workspaceId, status: "running", kind: null, diffAdditions: null, diffDeletions: null, drawn: list, surplusAgents });
const roomOf = (projectId, clusters, surplusAgents = 0) => ({ projectId, name: projectId, clusters, surplusAgents });
const modelOf = (rooms, surplusAgents = 0) => {
  const drawnAgents = rooms.reduce((n, r) => n + r.clusters.reduce((m, c) => m + c.drawn.length, 0), 0);
  return { rooms, surplusAgents, totalAgents: drawnAgents, drawnAgents };
};
const layoutOf = (model) => buildBuilding(CAM.roomInputsOf(model));
const agentView = (id, over = {}) => ({
  id, title: id, projectId: null, workspaceId: null, parentAgentId: null, status: "running", requiresAttention: false, attentionReason: null,
  pendingPermissions: 0, provider: null, model: null, contextUsedTokens: null, contextMaxTokens: null, lastError: null, lastTool: null, activity: null,
  todos: [], runId: null, updatedAt: null, ...over,
});

const threeModel = () =>
  modelOf([
    roomOf("p1", [cluster("w1", [drawn("a"), drawn("b"), drawn("c", "a"), drawn("d", "zzz")]), cluster("w2", [drawn("e")])]),
    roomOf("p2", [cluster("w3", [drawn("f")])]),
    roomOf("p3", [cluster("w4", [])]),
  ]);

test("OFFC-09 zoom: default is the smallest level, steps stay on offered levels", () => {
  assert.equal(CAM.defaultZoom(ZOOM_LEVELS), Math.min(...ZOOM_LEVELS));
  assert.equal(CAM.defaultZoom([4, 2, 3]), 2);
  assert.equal(CAM.zoomStep(2, 1, [2, 3, 4]), 3);
  assert.equal(CAM.zoomStep(3, 1, [2, 3, 4]), 4);
  assert.equal(CAM.zoomStep(4, 1, [2, 3, 4]), 4);
  assert.equal(CAM.zoomStep(2, -1, [2, 3, 4]), 2);
  assert.equal(CAM.zoomStep(4, -1, [2, 3, 4]), 3);
  assert.equal(CAM.zoomStep(7, -1, [2, 3, 4]), 3);
  assert.equal(CAM.zoomStep(NaN, 1, [2, 3]), 3);
  assert.throws(() => CAM.defaultZoom([]), RangeError);
  assert.throws(() => CAM.zoomStep(2, 1, []), RangeError);
  for (const level of ZOOM_LEVELS) assert.ok(Number.isInteger(level));
});

test("OFFC-14 camera: every target lands inside the scene as integer offsets", () => {
  const model = threeModel();
  const building = layoutOf(model);
  const placement = CAM.placeScene(building, model);
  const snapshot = {
    projects: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }, { id: "p3", name: "Three" }],
    workspaces: ["w1", "w2", "w3", "w4"].map((id, i) => ({ id, projectId: i < 2 ? "p1" : i === 2 ? "p2" : "p3", name: id, kind: null, status: "running", diffAdditions: null, diffDeletions: null })),
    agents: [agentView("a", { workspaceId: "w1" }), agentView("c", { workspaceId: "w1", parentAgentId: "a" }), agentView("f", { workspaceId: "w3" }), agentView("loose")],
  };
  const p1Rect = building.areas.find((a) => a.id === "room:p1").rect;
  const clusterTarget = { scope: "cluster", rect: p1Rect, roomId: "p1", workspaceId: "w1", agentId: null };
  const agentTarget = { scope: "agent", rect: p1Rect, roomId: "p1", workspaceId: "w1", agentId: "a" };
  const targets = [{ scope: "building", rect: building.rect, roomId: null, workspaceId: null, agentId: null }, clusterTarget, agentTarget];
  for (const row of projectList(snapshot, new Set(), building, 100).rows) targets.push(row.target);
  targets.push({ scope: "cluster", rect: building.rect, roomId: "ghost", workspaceId: "nope", agentId: null });
  targets.push({ scope: "agent", rect: { x: -50, y: -50, w: 3, h: 3 }, roomId: null, workspaceId: null, agentId: "nope" });
  for (const zoom of ZOOM_LEVELS) {
    const scene = CAM.sceneSize(building.rect, zoom);
    for (const view of [{ w: 300, h: 200 }, { w: 1280, h: 800 }, { w: 99999, h: 99999 }, { w: 333.5, h: 201.25 }]) {
      for (const target of targets) {
        const cam = CAM.cameraFor(target, building, view, zoom, placement);
        assert.ok(Number.isInteger(cam.x) && Number.isInteger(cam.y));
        assert.ok(cam.x >= 0 && cam.x <= Math.max(0, scene.w - view.w), `x ${cam.x}`);
        assert.ok(cam.y >= 0 && cam.y <= Math.max(0, scene.h - view.h), `y ${cam.y}`);
        const f = cam.focus;
        assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= building.rect.w && f.y + f.h <= building.rect.h, JSON.stringify(f));
        if (scene.w <= view.w) assert.equal(cam.x, 0);
        if (scene.h <= view.h) assert.equal(cam.y, 0);
      }
    }
  }
  const anchor = placement.clusters.find((c) => c.workspaceId === "w1");
  assert.deepEqual(CAM.cameraFor(clusterTarget, building, { w: 400, h: 300 }, 2, placement).focus, anchor.rect);
  const seat = placement.seats.find((s) => s.agentId === "a");
  const agentFocus = CAM.cameraFor(agentTarget, building, { w: 400, h: 300 }, 2, placement).focus;
  assert.ok(seat.tile.x >= agentFocus.x && seat.tile.x < agentFocus.x + agentFocus.w && seat.tile.y >= agentFocus.y && seat.tile.y < agentFocus.y + agentFocus.h);
  const unknown = CAM.cameraFor({ scope: "cluster", rect: building.areas.find((a) => a.id === "room:p2").rect, roomId: "p2", workspaceId: "missing", agentId: null }, building, { w: 400, h: 300 }, 2, placement);
  assert.deepEqual(unknown.focus, building.areas.find((a) => a.id === "room:p2").rect);
});

test("OFFC-06 place: seats are distinct and walkable, brains take desks by rank, children sit near their parent", () => {
  const model = modelOf(
    [
      roomOf("p1", [cluster("w1", [drawn("a"), drawn("b"), drawn("c", "a"), drawn("d", "zzz")], 2), cluster("w2", [drawn("e")])], 4),
      roomOf("p2", [cluster("w3", [])]),
    ],
    7,
  );
  const building = layoutOf(model);
  const placement = CAM.placeScene(building, model);
  const room = building.areas.find((a) => a.id === "room:p1");
  const seatOf = (id) => placement.seats.find((s) => s.agentId === id);
  const tiles = new Set(placement.seats.map((s) => `${s.tile.x},${s.tile.y}`));
  assert.equal(tiles.size, placement.seats.length);
  for (const s of placement.seats) assert.ok(building.grid.walkable(s.tile.x, s.tile.y), s.agentId);
  const desks = room.spots.filter((s) => s.kind === "desk").sort((x, y) => x.rank - y.rank);
  assert.deepEqual(["a", "b", "e"].map((id) => seatOf(id).spotId), desks.slice(0, 3).map((s) => s.id));
  const free = (taken) => room.spots.filter((s) => ["nook", "stool", "stand"].includes(s.kind) && !taken.has(s.id));
  const nearest = (from, taken) => free(taken).sort((x, y) => Math.abs(x.tx - from.x) + Math.abs(x.ty - from.y) - (Math.abs(y.tx - from.x) + Math.abs(y.ty - from.y)))[0];
  const c = seatOf("c");
  const expectedC = nearest(seatOf("a").tile, new Set());
  assert.equal(c.spotId, expectedC.id);
  assert.ok(seatOf("d").isChild && seatOf("d").spotId !== null);
  assert.equal(seatOf("d").spotId, nearest(seatOf("a").tile, new Set([c.spotId])).id);
  assert.deepEqual(placement.labels.map((l) => l.roomId), ["p1", "p2"]);
  assert.deepEqual(placement.labels[0].tile, { x: room.rect.x, y: room.rect.y });
  const counts = (scope) => placement.surplus.filter((s) => s.scope === scope).map((s) => s.count);
  assert.deepEqual(counts("cluster"), [2]);
  assert.deepEqual(counts("room"), [4]);
  assert.deepEqual(counts("building"), [7]);
  assert.equal(placement.clusters.length, 3);
  const empty = placement.clusters.find((a) => a.workspaceId === "w3");
  assert.ok(empty.rect.w >= 1 && empty.rect.h >= 1);
  const again = CAM.placeScene(building, model);
  assert.deepEqual(again, placement);
  assert.notEqual(again.seats[0], placement.seats[0]);
  assert.notEqual(again.seats[0].tile, placement.seats[0].tile);
  // more drawn agents than desks: nobody shares a tile, everybody stands on walkable ground
  const crowd = modelOf([roomOf("p1", [cluster("w1", Array.from({ length: 12 }, (_, i) => drawn(`n${i}`))), cluster("w2", Array.from({ length: 12 }, (_, i) => drawn(`m${i}`)))])]);
  const crowded = CAM.placeScene(layoutOf(crowd), crowd);
  assert.equal(crowded.seats.length, 24);
  assert.equal(new Set(crowded.seats.map((s) => `${s.tile.x},${s.tile.y}`)).size, 24);
  for (const s of crowded.seats) assert.ok(layoutOf(crowd).grid.walkable(s.tile.x, s.tile.y));
});

test("OFFC-06 place growth: a cluster rect never shrinks, holds every seat and hangs its sign top-left", () => {
  let previous = null;
  for (const n of [0, 1, 3, 6, 12]) {
    const list = Array.from({ length: n }, (_, i) => (i === 0 ? drawn("x0") : drawn(`x${i}`, "x0")));
    const model = modelOf([roomOf("p", [cluster("w", list)])]);
    const building = layoutOf(model);
    const placement = CAM.placeScene(building, model);
    const anchor = placement.clusters[0];
    for (const s of placement.seats) {
      assert.ok(s.tile.x >= anchor.rect.x && s.tile.x < anchor.rect.x + anchor.rect.w && s.tile.y >= anchor.rect.y && s.tile.y < anchor.rect.y + anchor.rect.h, `n=${n} ${s.agentId}`);
    }
    assert.deepEqual(anchor.sign, { x: anchor.rect.x, y: anchor.rect.y });
    if (previous) {
      assert.ok(anchor.rect.x <= previous.x && anchor.rect.y <= previous.y, `n=${n}`);
      assert.ok(anchor.rect.x + anchor.rect.w >= previous.x + previous.w && anchor.rect.y + anchor.rect.h >= previous.y + previous.h, `n=${n}`);
    }
    previous = anchor.rect;
  }
  let width = 0;
  for (const n of [1, 3, 5]) {
    const building = buildBuilding(Array.from({ length: n }, (_, i) => ({ id: `r${i}`, slot: i, seed: i })));
    assert.ok(building.rect.w >= width);
    width = building.rect.w;
    assert.equal(building.rooms.length, n);
  }
});

test("OFFC-08 visible: only layers near the viewport are returned, the corridor in segments", () => {
  const model = threeModel();
  const building = layoutOf(model);
  const zoom = 2;
  const wide = CAM.visibleLayers(building, zoom, { x: 0, y: 0, w: 1e6, h: 1e6 }, CAM.SCENE_CULL_MARGIN_PX);
  assert.deepEqual(wide.filter((l) => l.area === "corridor").map((l) => l.segment), Array.from({ length: building.cols }, (_, g) => g));
  for (const l of wide.filter((l) => l.area === "corridor")) assert.equal(l.rect.w, CORRIDOR_SEGMENT_TILES);
  assert.equal(wide.filter((l) => l.area === "room").length, 3);
  const roomP3 = building.areas.find((a) => a.id === "room:p3");
  const origin = CAM.visibleLayers(building, zoom, { x: 0, y: 0, w: 200, h: 200 }, CAM.SCENE_CULL_MARGIN_PX);
  assert.ok(!origin.some((l) => l.roomId === "p3"));
  assert.ok(origin.some((l) => l.area === "reception"));
  assert.ok(roomP3.rect.x * TILE * zoom > 200 + CAM.SCENE_CULL_MARGIN_PX);
  const none = CAM.visibleLayers(building, zoom, { x: 0, y: 0, w: 0, h: 0 }, CAM.SCENE_CULL_MARGIN_PX);
  assert.ok(none.length > 0);
  assert.ok(none.every((l) => l.rect.x * TILE * zoom < CAM.SCENE_CULL_MARGIN_PX && l.rect.y * TILE * zoom < CAM.SCENE_CULL_MARGIN_PX));
  const scene = CAM.sceneSize(building.rect, zoom);
  const union = new Set();
  for (let x = 0; x < scene.w; x += 200) for (let y = 0; y < scene.h; y += 200) for (const l of CAM.visibleLayers(building, zoom, { x, y, w: 200, h: 200 }, 0)) union.add(`${l.areaId}#${l.segment}`);
  const all = new Set(wide.map((l) => `${l.areaId}#${l.segment}`));
  assert.deepEqual([...union].sort(), [...all].sort());
  assert.deepEqual(wide.map((l) => l.areaId), [...wide].sort((a, b) => building.areas.findIndex((x) => x.id === a.areaId) - building.areas.findIndex((x) => x.id === b.areaId)).map((l) => l.areaId));
});

test("OFFC-17 keys: tint indices, layer keys, sheet keys, child zoom and wanted groups", () => {
  assert.deepEqual(CAM.tintIndices(0, 5), [0]);
  assert.deepEqual(CAM.tintIndices(2, 5), [2]);
  assert.deepEqual(CAM.tintIndices(1.25, 5), [1, 2]);
  assert.deepEqual(CAM.tintIndices(-3, 5), [0]);
  assert.deepEqual(CAM.tintIndices(99, 5), [4]);
  assert.deepEqual(CAM.tintIndices(NaN, 3), [0]);
  assert.deepEqual(CAM.tintIndices(0.5, 1), [0]);
  assert.throws(() => CAM.tintIndices(0, 0), RangeError);
  const model = threeModel();
  const building = layoutOf(model);
  const rooms = CAM.roomInputsOf(model);
  assert.deepEqual(rooms.map((r) => r.slot), [0, 1, 2]);
  assert.equal(CAM.roomVariantOf("p1"), CAM.roomVariantOf("p1"));
  const handle = handler();
  const layers = CAM.visibleLayers(building, 2, { x: 0, y: 0, w: 1e6, h: 1e6 });
  for (const season of SEASON_NAMES) {
    for (const layer of layers) {
      for (const kind of ["room-layer", "room-front"]) {
        const key = CAM.layerKey(layer, kind, { zoom: 2, season, tint: TINT_LEVELS - 1, cols: building.cols, rooms });
        const spec = parseSpriteKey(key);
        assert.ok(spec, key);
        assert.equal(spec.scale, 2);
        assert.equal(spec.tint, TINT_LEVELS - 1);
        assert.ok(spec.seed.endsWith(`-${SEASON_CODES[season]}`));
        assert.equal(handle({ keys: [key] }).sprites[0].ok, true, key);
      }
    }
  }
  assert.throws(() => CAM.layerKey({ ...layers.find((l) => l.area === "room"), roomId: "ghost" }, "room-layer", { zoom: 2, season: "none", tint: 0, cols: 3, rooms }), RangeError);
  const sheet = CAM.characterSheetKey("agent-1", 1, 3);
  assert.equal(parseSpriteKey(sheet).kind, "character-sheet");
  assert.equal(parseSpriteKey(sheet).scale, 3);
  assert.equal(handle({ keys: [sheet] }).sprites[0].ok, true);
  assert.throws(() => CAM.characterSheetKey("agent-1", 9, 3), RangeError);
  assert.equal(CAM.sheetZoomFor(true, 3, [2, 3]), 2);
  assert.equal(CAM.sheetZoomFor(true, 2, [2, 3]), 2);
  assert.equal(CAM.sheetZoomFor(false, 3, [2, 3]), 3);
  const input = (agentId, status, over = {}) => ({ agentId, status, choice: poseFor(agentView(agentId, { status, ...over })), handoffPending: false });
  const wanted = CAM.wantedGroups([input("w", "running"), input("i", "initializing"), input("c", "closed"), { ...input("h", "running"), handoffPending: true }, input("l", "idle")]);
  assert.deepEqual(wanted.get("w"), [1]);
  assert.ok(wanted.get("i").includes(CAM.MOVE_GROUP));
  assert.ok(wanted.get("c").includes(CAM.MOVE_GROUP) && wanted.get("c").includes(1));
  assert.ok(wanted.get("h").includes(CAM.MOVE_GROUP));
  assert.ok(wanted.get("l").includes(CAM.SOCIAL_GROUP));
  for (const id of ["w", "i", "c", "h"]) assert.ok(!wanted.get(id).includes(CAM.SOCIAL_GROUP));
  const many = CAM.wantedGroups(Array.from({ length: 20 }, (_, i) => input(`l${i}`, "idle")));
  assert.equal([...many.values()].filter((g) => g.includes(CAM.SOCIAL_GROUP)).length, CAM.SCENE_MAX_WALKERS);
});

// Characters of a placement for the life director.
function lifeScene(statuses, ready = new Set([0, 1, 2]), parents = {}) {
  const list = Object.keys(statuses).map((id) => drawn(id, parents[id] ?? null));
  const model = modelOf([roomOf("p1", [cluster("w1", list)])]);
  const building = layoutOf(model);
  const placement = CAM.placeScene(building, model);
  const characters = (over = {}) =>
    placement.seats.map((seat) => {
      const status = over[seat.agentId] ?? statuses[seat.agentId];
      return { agentId: seat.agentId, seat: { tile: seat.tile, dir: seat.dir }, status, choice: poseFor(agentView(seat.agentId, { status })), ready };
    });
  return { building, placement, characters };
}

test("OFFC-13 life: arrivals are staggered, closed agents sleep then leave, idle agents wander within the cap", () => {
  const { building, characters } = lifeScene({ i1: "initializing", i2: "initializing", i3: "initializing", i4: "initializing", r1: "running", c1: "closed" });
  const dir = CAM.createLifeDirector(building);
  const fronts = elevatorFronts(building).map((f) => `${f.x},${f.y}`);
  const first = dir.step(characters(), 0);
  const arrivals = [];
  const take = (changes, beat) => changes.starts.forEach((s) => arrivals.push({ ...s, beat }));
  take(first, 0);
  for (let beat = 1; beat < 4; beat++) take(dir.step(characters(), beat), beat);
  const arr = arrivals.filter((s) => s.kind === "arrival");
  assert.deepEqual(arr.map((s) => s.agentId).sort(), ["i1", "i2", "i3", "i4"]);
  assert.ok(new Set(arr.map((s) => `${s.startBeat}|${s.journey.startTile.x},${s.journey.startTile.y}`)).size === 4, "no two arrivals share an elevator and a beat");
  assert.ok(Math.max(...arr.map((s) => s.startBeat)) > Math.min(...arr.map((s) => s.startBeat)), "staggered");
  for (const s of arr) {
    assert.equal(s.journey.steps[0].kind, "appear");
    assert.ok(fronts.includes(`${s.journey.startTile.x},${s.journey.startTile.y}`));
  }
  assert.ok(!arrivals.some((s) => s.agentId === "r1"));
  // closed agent: sleeps SCENE_SLEEP_BEATS, then exactly one departure and gone after finished()
  const departures = arrivals.filter((s) => s.kind === "departure");
  assert.equal(departures.length, 0 + (CAM.SCENE_SLEEP_BEATS < 4 ? 1 : 0));
  let departure = null;
  for (let beat = 4; beat <= CAM.SCENE_SLEEP_BEATS + 2; beat++) {
    for (const s of dir.step(characters(), beat).starts) if (s.kind === "departure") { assert.equal(departure, null); departure = { ...s, beat }; }
  }
  assert.ok(departure && departure.beat >= CAM.SCENE_SLEEP_BEATS);
  assert.equal(departure.agentId, "c1");
  assert.equal(dir.journeyOf("c1"), "departure");
  assert.deepEqual(dir.finished("c1", 20).gone, ["c1"]);
  assert.equal(dir.isGone("c1"), true);
  const back = dir.step(characters({ c1: "idle" }), 21);
  assert.deepEqual(back.starts.filter((s) => s.agentId === "c1").map((s) => s.kind).slice(0, 1).concat(dir.step(characters({ c1: "idle" }), 22).starts.filter((s) => s.agentId === "c1").map((s) => s.kind)).includes("arrival"), true);
  assert.equal(dir.isGone("c1"), false);
});

test("OFFC-13 life: excursions use common areas, respect the walker cap, cancel when work starts, and are deterministic", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `w${i}`);
  const statuses = Object.fromEntries(ids.map((id) => [id, "idle"]));
  const run = (cancelAt = null) => {
    const { building, characters } = lifeScene(statuses);
    const dir = CAM.createLifeDirector(building);
    const index = indexSpots(building);
    const allowed = new Set(["reception", "cafe", "lounge", "corridor"]);
    const log = [];
    const ends = [];
    let peak = 0;
    let running = 0;
    const kinds = new Set();
    for (let beat = 0; beat < 400; beat++) {
      for (const e of ends.filter((x) => x.at <= beat)) {
        dir.finished(e.id, beat);
        running--;
      }
      ends.splice(0, ends.length, ...ends.filter((x) => x.at > beat));
      const over = cancelAt !== null && beat >= cancelAt && log.length > 0 ? { [log[0].agentId]: "running" } : {};
      const changes = dir.step(characters(over), beat);
      for (const id of changes.cancels) {
        const at = ends.findIndex((x) => x.id === id);
        if (at >= 0) {
          ends.splice(at, 1);
          running--;
        }
      }
      for (const s of changes.starts) {
        running++;
        peak = Math.max(peak, running);
        kinds.add(s.kind);
        log.push({ agentId: s.agentId, kind: s.kind, beat, steps: s.journey.steps.length, to: s.journey.steps[0].plan ? s.journey.steps[0].plan.to : null });
        ends.push({ id: s.agentId, at: beat + Math.ceil(s.journey.totalMs / CAM.SCENE_BEAT_MS) });
        if (s.kind === "excursion") {
          const to = s.journey.steps[0].plan.to;
          const spot = index.spots.find((sp) => sp.tx === to.x && sp.ty === to.y);
          assert.ok(spot && allowed.has(index.areaKindOf(spot.id)), `${spot?.id}`);
        }
      }
      assert.ok(running <= CAM.SCENE_MAX_WALKERS, `beat ${beat}: ${running}`);
    }
    return { log, peak, kinds, cancelled: dir.journeyOf(log[0]?.agentId ?? "") };
  };
  const a = run();
  assert.ok(a.log.length > 3, "idle agents wander");
  assert.ok(a.peak <= CAM.SCENE_MAX_WALKERS);
  assert.ok(a.kinds.has("excursion"));
  assert.deepEqual(run().log, a.log);
  // an agent that starts working cancels its outing
  const { building, characters } = lifeScene({ x: "idle", y: "idle" });
  const dir = CAM.createLifeDirector(building);
  let started = null;
  for (let beat = 0; beat < 300 && !started; beat++) started = dir.step(characters(), beat).starts.find((s) => s.kind === "excursion" || s.kind === "hangout") ?? null;
  assert.ok(started, "an outing starts");
  const cancel = dir.step(characters({ [started.agentId]: "running" }), 400);
  assert.ok(cancel.cancels.includes(started.agentId));
  assert.equal(dir.journeyOf(started.agentId), null);
  // finished() releases and reschedules: nothing starts again at once
  const { building: b2, characters: c2 } = lifeScene({ solo: "idle" });
  const d2 = CAM.createLifeDirector(b2);
  let s2 = null;
  let at = 0;
  for (; at < 300 && !s2; at++) s2 = d2.step(c2(), at).starts[0] ?? null;
  assert.ok(s2);
  assert.equal(d2.journeyOf("solo"), "excursion");
  d2.finished("solo", at);
  assert.equal(d2.journeyOf("solo"), null);
  assert.equal(d2.step(c2(), at).starts.length, 0);
});

test("OFFC-13 life: idle agents at home may gather, spots reserved all or nothing", () => {
  const ids = ["g0", "g1", "g2", "g3"];
  const { building, characters } = lifeScene(Object.fromEntries(ids.map((id) => [id, "idle"])));
  const dir = CAM.createLifeDirector(building);
  const hangouts = [];
  const ends = [];
  for (let beat = 0; beat < 600 && hangouts.length === 0; beat++) {
    for (const e of ends.filter((x) => x.at <= beat)) dir.finished(e.id, beat);
    ends.splice(0, ends.length, ...ends.filter((x) => x.at > beat));
    for (const s of dir.step(characters(), beat).starts) {
      ends.push({ id: s.agentId, at: beat + Math.ceil(s.journey.totalMs / CAM.SCENE_BEAT_MS) });
      if (s.kind === "hangout") hangouts.push(s);
    }
  }
  assert.ok(hangouts.length >= 2, "a hangout of at least two members starts");
  const poses = new Set(Object.values(HANGOUT_KINDS).flatMap((k) => k.poses));
  const targets = new Set();
  for (const h of hangouts) {
    const wait = h.journey.steps.find((st) => st.kind === "wait");
    assert.ok(poses.has(wait.pose), wait.pose);
    const to = h.journey.steps[0].plan.to;
    assert.ok(!targets.has(`${to.x},${to.y}`), "no two members share a spot");
    targets.add(`${to.x},${to.y}`);
  }
});

test("OFFC-12 life handoff: one round trip for a child at its seat, none otherwise", () => {
  const { building, characters, placement } = lifeScene({ parent: "running", child: "running" }, new Set([0, 1, 2]), { child: "parent" });
  const seatTile = (id) => placement.seats.find((s) => s.agentId === id).tile;
  const dir = CAM.createLifeDirector(building);
  dir.step(characters(), 0);
  const request = { childId: "child", parentId: "parent" };
  const first = dir.handoff(request, characters(), 1);
  assert.equal(first.starts.length, 1);
  assert.equal(first.starts[0].kind, "handoff");
  assert.equal(first.starts[0].agentId, "child");
  const journey = first.starts[0].journey;
  assert.deepEqual(journey.startTile, seatTile("child"));
  assert.deepEqual(journey.endTile, seatTile("child"));
  assert.deepEqual(journey.steps[0].plan.to, seatTile("parent"));
  assert.equal(dir.handoff(request, characters(), 2).starts.length, 0, "a second request while it runs");
  dir.finished("child", 10);
  assert.equal(dir.journeyOf("child"), null);
  assert.equal(dir.handoff({ childId: "child", parentId: "ghost" }, characters(), 11).starts.length, 0);
  assert.equal(dir.handoff({ childId: "ghost", parentId: "parent" }, characters(), 11).starts.length, 0);
  assert.equal(dir.handoff(request, lifeScene({ parent: "running", child: "running" }, new Set([1]), { child: "parent" }).characters(), 11).starts.length, 0, "no move sheet");
  assert.equal(dir.handoff(request, characters({ child: "closed" }), 11).starts.length, 0);
  const unreachable = characters().map((c) => (c.agentId === "parent" ? { ...c, seat: { ...c.seat, tile: pt(0, 0) } } : c));
  assert.equal(CAM.createLifeDirector(building).handoff(request, unreachable, 12).starts.length, 0);
  // a child away on a hangout or excursion is not at its seat
  const away = CAM.createLifeDirector(building);
  const idle = lifeScene({ parent: "running", child: "idle" }, new Set([0, 1, 2]), { child: "parent" });
  let outing = null;
  for (let beat = 0; beat < 300 && !outing; beat++) outing = away.step(idle.characters(), beat).starts.find((s) => s.agentId === "child") ?? null;
  assert.ok(outing);
  assert.equal(away.handoff(request, idle.characters(), 301).starts.length, 0);
});

test("OFFC-18 wave trigger: id-only asks, bounded and debounced, readings feed effects", async () => {
  const link = (done, total = 3) => ({ ok: true, link: { phase: "7", wave: 1, plansDone: done, plansTotal: total, scope: "complete" } });
  const clock = { t: 10000 };
  const calls = [];
  const effects = [];
  const replies = [];
  const make = (extra = {}) =>
    waveTrigger({
      ask: (input) => {
        calls.push(input);
        return new Promise((resolve, reject) => replies.push({ resolve, reject }));
      },
      now: () => clock.t,
      onEffect: (spec, run) => effects.push({ spec, run }),
      ...extra,
    });
  const trigger = make();
  const run = (sig, id = "r1", ws = "ws1") => ({ workspaceId: ws, runId: id, sig });
  trigger.observe([run("a")]);
  assert.deepEqual(calls, [{ workspaceId: "ws1", runId: "r1" }]);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["runId", "workspaceId"]);
  replies[0].resolve(link(1));
  await flushMicro();
  assert.equal(effects.length, 0, "a first reading never yields an effect");
  trigger.observe([run("a")]);
  clock.t += WAVE_MIN_INTERVAL_MS;
  trigger.pump();
  assert.equal(calls.length, 1, "a repeat sig asks nothing");
  trigger.observe([run("b")]);
  assert.equal(calls.length, 2);
  replies[1].resolve(link(3));
  await flushMicro();
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].spec, effectFor(link(1).link, link(3).link));
  assert.deepEqual(effects[0].run, { workspaceId: "ws1", runId: "r1" });
  // closer than the interval waits for pump
  clock.t += 1000;
  trigger.observe([run("c")]);
  assert.equal(calls.length, 2);
  clock.t += WAVE_MIN_INTERVAL_MS;
  trigger.pump();
  assert.equal(calls.length, 3);
  replies[2].resolve(link(3));
  await flushMicro();
  assert.equal(effects.length, 1, "no new completion");
  // hostile and over-cap input
  const bad = ["../x", "", " a", "a b", "__proto__", "x".repeat(200), "-a", ".a", null, 4];
  const before = calls.length;
  trigger.observe(bad.map((id) => ({ workspaceId: "ws1", runId: id, sig: "s" })));
  trigger.observe([{ workspaceId: "ws\n1", runId: "ok", sig: "s" }, { workspaceId: "w".repeat(500), runId: "ok", sig: "s" }, { workspaceId: 4, runId: "ok", sig: "s" }]);
  assert.equal(calls.length, before);
  // failures never throw
  const hostile = make({ ask: () => Promise.reject(new Error("boom")) });
  assert.doesNotThrow(() => hostile.observe([run("a")]));
  await flushMicro();
  assert.equal(hostile.stats().failed, 1);
  const throwing = make({ ask: () => { throw new Error("sync"); } });
  assert.doesNotThrow(() => throwing.observe([run("a")]));
  for (const payload of [null, undefined, 4, "x", { ok: false }, { ok: true, link: null }, { ok: true, link: { phase: 4 } }, { ok: true, link: { phase: "7", wave: 1, plansDone: 1, plansTotal: 3, scope: "unreadable" } }]) {
    const t = make({ ask: () => Promise.resolve(payload) });
    assert.doesNotThrow(() => t.observe([run("a")]));
    await flushMicro();
    assert.equal(t.stats().effects, 0);
  }
  // caps
  calls.length = 0;
  replies.length = 0;
  const capped = make();
  capped.observe(Array.from({ length: WAVE_RUNS_MAX + 4 }, (_, i) => run("s", `run${i}`)));
  assert.equal(calls.length, WAVE_CALLS_IN_FLIGHT_MAX);
  assert.equal(capped.stats().runs, WAVE_RUNS_MAX);
  // dispose ignores late responses
  const late = make();
  late.observe([run("a", "late")]);
  late.dispose();
  replies.at(-1).resolve(link(3));
  await flushMicro();
  assert.equal(late.stats().effects, 0);
  late.observe([run("z", "later")]);
  assert.equal(late.stats().runs, 0);
});

test("OFFC-08 budget: the real art stays within the recorded first-load threshold", () => {
  const zoom = Math.max(...ZOOM_LEVELS);
  const handle = handler();
  const sumOf = (keys) => {
    let total = 0;
    for (let i = 0; i < keys.length; i += 16) {
      for (const sprite of handle({ keys: keys.slice(i, i + 16) }).sprites) {
        assert.equal(sprite.ok, true, `${sprite.key} ${sprite.code}`);
        total += sprite.uri.length;
      }
    }
    return total;
  };
  const sceneKeys = (model, viewport, tints) => {
    const building = layoutOf(model);
    const rooms = CAM.roomInputsOf(model);
    const layers = CAM.visibleLayers(building, zoom, viewport).filter((l) => l.area !== "restroom");
    return layers.flatMap((layer) =>
      ["room-layer", "room-front"].flatMap((kind) => tints.map((tint) => CAM.layerKey(layer, kind, { zoom, season: "none", tint, cols: building.cols, rooms }))),
    );
  };
  const measured = modelOf([roomOf("p0", [cluster("w0", [])])]);
  const everything = { x: 0, y: 0, w: 1e6, h: 1e6 };
  const worst = CAM.tintIndices((TINT_LEVELS - 1) / 2 + 0.25, TINT_LEVELS);
  const sheets = [];
  for (let i = 0; i < 32; i++) sheets.push(CAM.characterSheetKey(`agent-${i}`, i < 26 ? 1 : CAM.MOVE_GROUP, zoom));
  for (let i = 26; i < 32; i++) sheets.push(CAM.characterSheetKey(`agent-${i}`, CAM.SOCIAL_GROUP, zoom));
  for (let i = 0; i < 4; i++) sheets.push(CAM.characterSheetKey(`agent-${i}`, CAM.MOVE_GROUP, zoom));
  const characters = sumOf(sheets);
  const measuredSum = sumOf(sceneKeys(measured, everything, worst)) + characters;
  const allTints = sumOf(sceneKeys(measured, everything, Array.from({ length: TINT_LEVELS }, (_, i) => i))) + characters;
  const six = modelOf(Array.from({ length: 6 }, (_, i) => roomOf(`p${i}`, [cluster(`w${i}`, [])])));
  const sixSum = sumOf(sceneKeys(six, { x: 0, y: 0, w: 1600, h: 900 }, worst)) + characters;
  console.log(`budget: measured scene ${measuredSum}, all ${TINT_LEVELS} tint variants ${allTints}, six rooms at 1600x900 ${sixSum}, max ${THRESHOLDS.firstLoadBytesMax}`);
  const fail = (sum) => `budget gate failed: ${sum} > ${THRESHOLDS.firstLoadBytesMax}; return to the owner (D-12); sums ${measuredSum}, ${allTints}, ${sixSum}`;
  assert.ok(measuredSum <= THRESHOLDS.firstLoadBytesMax, fail(measuredSum));
  assert.ok(sixSum <= THRESHOLDS.firstLoadBytesMax, fail(sixSum));
  // a second pass over the same keys costs no call
  return (async () => {
    const calls = [];
    const { createSpriteStore } = await import("../../plugins/office/client/sprite-store.ts");
    const inner = handler();
    const store = createSpriteStore(async (input) => {
      calls.push(input);
      return inner(input);
    });
    const keys = [...sheets, ...sceneKeys(measured, everything, worst)];
    store.request(keys);
    await store.settle();
    const first = calls.length;
    assert.ok(first > 0);
    store.request(keys);
    await store.settle();
    assert.equal(calls.length, first);
    store.dispose();
  })();
});

// Source checker shared by the pure-source and component gates.
const TIMER_PATTERNS = [/\bsetInterval\b/, /\bsetTimeout\b/, /\brequestAnimationFrame\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bMath\.random\b/, /\bperformance\.now\b/, /\bfetch\s*\(/, /\breadFile(Sync)?\b/, /\bfs\./];
const PANL05_PATTERNS = [
  /child_process/,
  /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|createWriteStream|chmod|truncate|utimes|cp|rm)(Sync)?\s*\(/,
  /\.(send|run|archive|create|respondToPermission|setTitle|setModel|cancel|detach|append|waitForFinish)\s*\(/,
  /\b(spawnProcess|execCommand|terminateProcess)\b/,
];
function pureSourceProblems(name, source, allowed) {
  const text = stripComments(normalise(source));
  const problems = [];
  for (const m of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith(".") || /(^|\/)(react|react-native)(\/|$)/.test(spec) || !allowed.some((re) => re.test(spec))) problems.push(`${name}: import ${spec}`);
  }
  for (const re of [...TIMER_PATTERNS, ...PANL05_PATTERNS]) if (re.test(text)) problems.push(`${name}: ${re}`);
  if (/<div\b|<span\b|<svg\b|\bdocument\.|\bwindow\./.test(text)) problems.push(`${name}: PANL-06`);
  return problems;
}

test("OFFC-05 pure sources: camera.ts and wave-trigger.ts hold no timer, clock, random, file or write call", () => {
  const camera = /^(\.\.\/shared\/(?:(?:layout|path)\/)?[\w-]+\.ts|\.\/life\/[\w-]+\.ts|\.\/[\w-]+\.ts)$/;
  assert.deepEqual(pureSourceProblems("camera.ts", readPlugin("client", "camera.ts"), [camera]), []);
  assert.deepEqual(pureSourceProblems("wave-trigger.ts", readPlugin("client", "wave-trigger.ts"), [/^\.\.\/shared\/wave-rpc\.ts$/, /^\.\/effects\.ts$/]), []);
  const fixtures = [
    "setInterval(() => 1, 5);", "setTimeout(() => 1, 5);", "requestAnimationFrame(() => 1);", "Date.now();", "Math.random();", "fetch('x');", "fs.readFileSync('x');",
    "import x from 'react';", "import x from 'react-native';", "import x from 'node:fs';", "api.send('x');", "writeFileSync('a', 'b');", "document.body;",
  ];
  for (const fixture of fixtures) assert.notDeepEqual(pureSourceProblems("fixture", fixture, [camera]), [], fixture);
});

// ---------------------------------------------------------------- Task 3: components, screen, registration

import { createRequire } from "node:module";
import { mock } from "node:test";
import { agentPayload, agentUpsert, fakePaseo, iso, projectPayload, workspacePayload } from "./fake-paseo.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { ATTENTION_KEY, WORKSPACE_KIND_KEY, STRINGS, text as str } from "../../plugins/office/client/strings.ts";
import { LABEL_MAX_CHARS } from "../../plugins/office/client/limits-panels.ts";
import { dayPhase } from "../../plugins/office/client/daylight.ts";
import { seasonFor } from "../../plugins/office/client/season.ts";

const pluginRequire = createRequire(path.join(PLUGIN_DIR, "package.json"));
const tsc = pluginRequire("typescript");
const PARENT_LABEL = "paseo.parent-agent-id";
const kidP = (id, parent, over = {}) => agentPayload(id, { labels: { [PARENT_LABEL]: parent }, ...over });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(handle, rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await handle.flush();
    await sleep(15);
  }
}
const textsOf = (handle) => handle.find("Text").map((n) => n.children.filter((c) => typeof c === "string").join(""));
const byTestId = (handle, type, test) => handle.find(type).filter((n) => (test instanceof RegExp ? test.test(n.props.testID ?? "") : n.props.testID === test));
const characterNodes = (handle) => byTestId(handle, "Animated.View", /^office-char-\d+$/);
const spriteKeys = (host) => host.rpcCalls.filter((c) => c.method === "office.sprites").flatMap((c) => c.input.keys);
const tintOf = (key) => Number(key.split(":")[4]);
const scaleOf = (key) => Number(key.split(":")[3]);

// A probe that exposes the shared clock values to the test, so a beat can be driven by hand.
function clockProbe() {
  const dir = makeTempDir("ui office probe ");
  const file = path.join(dir, "probe.tsx");
  fs.writeFileSync(file, `import { useClock } from ${JSON.stringify(path.join(PLUGIN_DIR, "client", "clocks.ts"))};\nexport function Probe() { globalThis.__officeClocks = useClock(); return null; }\n`);
  return file;
}
const beats = (n) => {
  const value = globalThis.__officeClocks[CAM.SCENE_LIFE_BEAT_TIER];
  for (let i = 0; i < n; i++) value.setValue((value.current + 1) % 4);
};

const officeFixture = (extra = {}) =>
  fakePaseo({
    agents: [
      agentPayload("par", { workspaceId: "w1", status: "running", title: "parent" }),
      kidP("kid", "par", { workspaceId: "w1", status: "running", title: "child" }),
      agentPayload("ini", { workspaceId: "w1", status: "initializing", title: "starting" }),
      agentPayload("clo", { workspaceId: "w2", status: "closed", title: "done" }),
      agentPayload("i1", { workspaceId: "w2", status: "idle" }),
      agentPayload("i2", { workspaceId: "w2", status: "idle" }),
      agentPayload("i3", { workspaceId: "w3", status: "idle", requiresAttention: true, attentionReason: "finished" }),
      agentPayload("r1", { workspaceId: "w3", status: "running" }),
    ],
    workspaceEntries: [workspacePayload("w1", { projectId: "p1", name: "alpha" }), workspacePayload("w2", { projectId: "p1", name: "beta" }), workspacePayload("w3", { projectId: "p2", name: "gamma" })],
    projectEntries: [projectPayload("p1"), projectPayload("p2")],
    ...extra,
  });

async function withScreen(fake, body, options = {}) {
  const host = await fakeHost({ paseo: fake });
  const probe = host.mountModule(clockProbe(), "Probe", {});
  const handle = host.mount("office", options.props);
  try {
    await settle(handle, options.rounds ?? 10);
    await body({ host, handle, fake, probe });
  } finally {
    host.dispose();
  }
}

// ---- gate checker for the component sources (OFFC-14)
const WRITE_MEMBERS = new Set(["send", "run", "archive", "create", "respondToPermission", "setTitle", "setModel", "cancel", "detach", "append", "waitForFinish", "spawnProcess", "execCommand", "terminateProcess", "listUsage"]);
const TIMER_NAMES = new Set(["setInterval", "setTimeout", "requestAnimationFrame", "setImmediate"]);
const AGENT_IDENT = /^(agentId|parentId|workspaceId|projectId|runId|title|name|label|lastError|todo|todos|id)$/;
const LABEL_ATTRS = new Set(["accessibilityLabel", "accessibilityHint", "aria-label", "alt", "title", "placeholder"]);

function componentProblems(name, source) {
  const sf = tsc.createSourceFile(name, source, tsc.ScriptTarget.ES2022, true, tsc.ScriptKind.TSX);
  const out = [];
  const literal = (n) => n && (tsc.isStringLiteral(n) || tsc.isNoSubstitutionTemplateLiteral(n));
  const idents = (n, list = []) => {
    if (tsc.isIdentifier(n)) list.push(n.text);
    tsc.forEachChild(n, (c) => {
      idents(c, list);
    });
    return list;
  };
  const visit = (n) => {
    if (tsc.isJsxText(n) && n.getText().trim() !== "") out.push(`${name}: JSX text literal`);
    if (tsc.isJsxExpression(n) && literal(n.expression) && !tsc.isJsxAttribute(n.parent)) out.push(`${name}: string child`);
    if (tsc.isJsxAttribute(n)) {
      const attr = n.name.getText();
      const init = n.initializer;
      if (LABEL_ATTRS.has(attr) && init && (literal(init) || (tsc.isJsxExpression(init) && literal(init.expression)))) out.push(`${name}: literal ${attr}`);
      if ((attr === "style" || attr === "testID") && init) for (const id of idents(init)) if (AGENT_IDENT.test(id)) out.push(`${name}: ${id} in ${attr}`);
    }
    if (tsc.isIdentifier(n) && n.text === "uri") out.push(`${name}: uri`);
    if (tsc.isIdentifier(n) && TIMER_NAMES.has(n.text)) out.push(`${name}: timer ${n.text}`);
    if (tsc.isPropertyAccessExpression(n) && WRITE_MEMBERS.has(n.name.text)) out.push(`${name}: member ${n.name.text}`);
    if (tsc.isIdentifier(n) && WRITE_MEMBERS.has(n.text) && tsc.isCallExpression(n.parent) && n.parent.expression === n) out.push(`${name}: call ${n.text}`);
    tsc.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const sceneProps = (over = {}) => {
  const model = modelOf([roomOf("p1", [cluster("w1", [drawn("par"), drawn("__proto__", "par")])])]);
  const building = layoutOf(model);
  const layers = CAM.visibleLayers(building, 2, { x: 0, y: 0, w: 1e6, h: 1e6 }).map((layer) => ({ layer, base: [{ uri: "data:image/png;base64,AA" }, null], front: [null, null] }));
  const sheet = (agentId, zoom) => ({ key: CAM.characterSheetKey(agentId, 1, zoom), source: { uri: "data:image/png;base64,AA" }, poses: SHEET_POSE_GROUPS[1] });
  const characters = [
    { key: "par", sheets: [sheet("par", 3)], pose: "type", dir: "down", at: pt(3, 4), journey: null, sheetZoom: 3, isChild: false, attention: null, onJourneyEnd() {}, onPress() {} },
    { key: "__proto__", sheets: [sheet("kid", 2)], pose: "type", dir: "up", at: pt(4, 7), journey: null, sheetZoom: 2, isChild: true, attention: null, onJourneyEnd() {}, onPress() {} },
  ];
  const colors = { surface1: "#111111", surface2: "#222222", border: "#333333", foreground: "#444444", foregroundMuted: "#555555", accent: "#666666", statusSuccess: "#777777", statusWarning: "#888888", statusDanger: "#999999" };
  return {
    size: CAM.sceneSize(building.rect, 3), zoom: 3, position: 0.5, layers, characters,
    signs: [{ tile: pt(2, 2), name: "x".repeat(10000), kind: "worktree", light: "active", additions: 3, deletions: 1 }],
    labels: [{ tile: pt(0, 0), name: "room\u0007name" }], surplus: [{ tile: pt(5, 5), count: 17 }], effects: [], colors, onEffectDone() {},
    ...over,
  };
};

test("OFFC-10 precondition: the host mounts modules, animated values listen and the character takes a sheet zoom", async () => {
  const host = await fakeHost();
  try {
    assert.equal(typeof host.mountModule, "function", "precondition: host mountModule or addListener missing");
    const probe = host.mountModule(clockProbe(), "Probe", {});
    assert.equal(typeof globalThis.__officeClocks[0].addListener, "function", "precondition: host mountModule or addListener missing");
    assert.equal(typeof globalThis.__officeClocks[0].removeListener, "function");
    assert.ok(/sheetZoom\??:/.test(readPlugin("client", "character.tsx")), "precondition: character.tsx sheetZoom missing");
    probe.unmount();
  } finally {
    host.dispose();
  }
});

test("OFFC-06 scene: layers, characters, fronts, signs and badges sit where the tile numbers say", async () => {
  const host = await fakeHost();
  try {
    const props = sceneProps();
    const handle = host.mountModule("client/scene.tsx", "Scene", props);
    await handle.flush();
    const root = byTestId(handle, "View", "office-scene")[0];
    assert.deepEqual([root.props.style.width, root.props.style.height], [props.size.w, props.size.h]);
    props.layers.forEach((entry, index) => {
      for (const [prefix, z] of [["base", 0], ["front", CAM.SCENE_Z_FRONT]]) {
        const wrapper = byTestId(handle, "View", `office-${prefix}-${index}`)[0];
        const style = wrapper.props.style;
        assert.deepEqual([style.left, style.top, style.width, style.height], [entry.layer.rect.x * TILE * 3, entry.layer.rect.y * TILE * 3, entry.layer.rect.w * TILE * 3, entry.layer.rect.h * TILE * 3]);
        assert.equal(style.zIndex, z);
        assert.equal(style.pointerEvents, "none");
      }
    });
    assert.ok(props.layers.some((e) => e.layer.area === "corridor" && e.layer.rect.x > 0), "a corridor segment offset is included");
    assert.equal(byTestId(handle, "View", "office-tint").length, props.layers.length, "one fade per base layer; a front without a variant draws nothing");
    assert.equal(characterNodes(handle).length, 2);
    const images = handle.find("Animated.Image");
    assert.equal(images[0].props.style.width, 4 * CHAR_W * 3);
    assert.equal(images[1].props.style.width, 4 * CHAR_W * 2, "a child uses the smaller sheet");
    assert.equal(byTestId(handle, "View", "office-char-badge-1").length, 1);
    assert.equal(byTestId(handle, "View", "office-char-badge-0").length, 0);
    const texts = textsOf(handle);
    assert.ok(texts.includes(str("sceneSurplus", { count: 17 })));
    assert.ok(texts.includes(str(WORKSPACE_KIND_KEY.worktree)));
    assert.ok(texts.includes(str("sceneDiff", { additions: 3, deletions: 1 })));
    assert.ok(texts.every((t) => t.length <= LABEL_MAX_CHARS), "clipped");
    assert.ok(!texts.some((t) => /[\u0000-\u001f]/.test(t)));
    const ids = handle.find("View").concat(handle.find("Animated.View"), handle.find("Animated.Image")).map((n) => n.props.testID).filter(Boolean);
    for (const id of ids) assert.match(id, /^office-[a-z]+(-[a-z]+)*(-\d+)?(-light)?$/, id);
    assert.ok(!JSON.stringify(handle.tree, (k, v) => (k === "children" ? undefined : v)).includes("__proto__"));
    // the five light states differ
    const lights = new Set();
    for (const light of ["waiting", "failed", "active", "alert", "idle"]) {
      const lit = host.mountModule("client/room.tsx", "ClusterSign", { tile: pt(0, 0), zoom: 2, name: "n", kind: null, light, additions: null, deletions: null, colors: props.colors, testID: "office-sign-0" });
      await lit.flush();
      lights.add(byTestId(lit, "View", "office-sign-0-light")[0].props.style.backgroundColor);
    }
    assert.equal(lights.size, 5);
  } finally {
    host.dispose();
  }
});

test("OFFC-21 scene signals: the attention dot follows the reason and nothing is shown for a missing kind or diff", async () => {
  const host = await fakeHost();
  try {
    const base = sceneProps();
    const seen = new Set();
    for (const reason of ["finished", "error", "permission"]) {
      const characters = base.characters.map((c, i) => (i === 0 ? { ...c, attention: reason } : c));
      const handle = host.mountModule("client/scene.tsx", "Scene", { ...base, characters });
      await handle.flush();
      const dot = byTestId(handle, "View", "office-char-attention-0");
      assert.equal(dot.length, 1);
      seen.add(dot[0].props.style.backgroundColor);
      assert.ok(ATTENTION_KEY[reason]);
    }
    assert.equal(seen.size, 3);
    const calm = host.mountModule("client/scene.tsx", "Scene", base);
    await calm.flush();
    assert.equal(byTestId(calm, "View", /^office-char-attention-/).length, 0);
    const bare = host.mountModule("client/scene.tsx", "Scene", { ...base, signs: [{ tile: pt(2, 2), name: "plain", kind: null, light: "idle", additions: null, deletions: 3 }], surplus: [], labels: [] });
    await bare.flush();
    const texts = textsOf(bare);
    assert.deepEqual(texts, ["plain"]);
  } finally {
    host.dispose();
  }
});

test("OFFC-21 scene effects: a burst clears itself through onDone", async () => {
  const host = await fakeHost();
  try {
    const done = [];
    const handle = host.mountModule("client/scene.tsx", "Scene", sceneProps({ effects: [{ id: "wave:7:1", kind: "wave", x: 10, y: 20 }], effectDurationMs: { wave: 0, phase: 0 }, onEffectDone: (id) => done.push(id) }));
    await handle.flush();
    assert.equal(byTestId(handle, "View", "office-fx-burst-0").length, 1);
    assert.deepEqual(done, ["wave:7:1"]);
  } finally {
    host.dispose();
  }
});

test("OFFC-14 scene gates: no text literal, hostile field in style or testID, timer or write call (can fail)", () => {
  for (const file of ["scene.tsx", "room.tsx", "office-screen.tsx"]) assert.deepEqual(componentProblems(file, readPlugin("client", file)), [], file);
  const fixtures = {
    "JSX text literal": "export const A = () => <Text>hello</Text>;",
    "string child": "export const A = () => <Text>{'hello'}</Text>;",
    "literal accessibilityLabel": "export const A = () => <View accessibilityLabel='Close' />;",
    uri: "const uri = 1;",
    "id in style": "export const A = (p) => <View style={{ left: p.agent.id }} />;",
    "name in testID": "export const A = (p) => <View testID={`x-${p.name}`} />;",
    "timer setTimeout": "setTimeout(() => 1, 5);",
    "timer requestAnimationFrame": "requestAnimationFrame(() => 1);",
    "member send": "paseo.agents.send('x');",
    "member archive": "paseo.agents.archive('x');",
    "call listUsage": "listUsage();",
  };
  for (const [label, source] of Object.entries(fixtures)) assert.notDeepEqual(componentProblems("fixture.tsx", source), [], label);
});

test("OFFC-05 screen: the store starts, the panels and the characters appear, unmount releases everything", async () => {
  const date = new Date(2026, 5, 15, 12, 0, 0);
  mock.timers.enable({ apis: ["Date"], now: date });
  try {
    const fake = officeFixture();
    const host = await fakeHost({ paseo: fake });
    host.mountModule(clockProbe(), "Probe", {});
    const handle = host.mount("office");
    try {
      await settle(handle, 14);
      assert.ok(fake.calls.includes("agents.list") && fake.calls.includes("workspaces.list") && fake.calls.includes("projects.list"));
      assert.ok(fake.liveSubscriptions() > 0);
      assert.equal(byTestId(handle, "Pressable", "office-sidebar-row").length, 2, "one sidebar row per project");
      assert.equal(byTestId(handle, "View", "office-usage-slot").length, 1, "top bar");
      assert.equal(characterNodes(handle).length, 8, "one character per drawn agent");
      assert.ok(byTestId(handle, "View", /^office-base-\d+$/).length >= 5);
      const keys = spriteKeys(host);
      assert.ok(keys.length > 10);
      assert.equal(new Set(keys).size, keys.length, "every key once");
      for (const key of keys) assert.ok(parseSpriteKey(key), key);
      assert.ok(host.rpcCalls.every((c) => c.method !== "office.wave"), "no run label, no wave call");
      const before = host.rpcCalls.length;
      handle.unmount();
      await sleep(20);
      assert.equal(fake.liveSubscriptions(), 0);
      assert.equal(globalThis.__officeClocks[CAM.SCENE_LIFE_BEAT_TIER].listeners.size, 0);
      const again = host.mount("office");
      await settle(again, 14);
      assert.equal(host.rpcCalls.length, before, "a remount issues no second sprite call");
      assert.equal(characterNodes(again).length, 8);
    } finally {
      host.dispose();
    }
  } finally {
    mock.timers.reset();
  }
});

test("OFFC-05 screen edges: an empty building, a failed read and hostile strings never throw", async () => {
  await withScreen(fakePaseo({}), async ({ handle, host }) => {
    assert.ok(textsOf(handle).includes(str("sidebarEmpty")));
    assert.equal(characterNodes(handle).length, 0);
    const kinds = new Set(byTestId(handle, "View", /^office-base-\d+$/).length ? ["layers"] : []);
    assert.ok(kinds.has("layers"), "core areas and the corridor are drawn");
    assert.ok(spriteKeys(host).some((k) => k.startsWith("room-layer:corridor-")));
  });
  await withScreen(fakePaseo({ listError: "daemon offline" }), async ({ handle }) => {
    assert.ok(textsOf(handle).includes(str("screenFailed")));
  });
  const hostile = "HOSTILE" + "\u0007x ".repeat(5000);
  const fake = fakePaseo({
    agents: [
      agentPayload("__proto__", { workspaceId: "__proto__", status: "running", title: hostile, labels: {} }),
      agentPayload("constructor", { workspaceId: null, status: "idle", title: hostile }),
      agentPayload("noseat", { workspaceId: "ghost", status: "error", title: null }),
    ],
    workspaceEntries: [workspacePayload("__proto__", { projectId: "__proto__", name: hostile })],
    projectEntries: [projectPayload("__proto__", { projectDisplayName: hostile })],
  });
  await withScreen(fake, async ({ handle, host }) => {
    const texts = textsOf(handle);
    assert.ok(texts.every((t) => t.length <= 500), "clipped");
    const tree = JSON.stringify(handle.tree, (k, v) => (k === "children" ? undefined : v));
    assert.ok(!tree.includes("HOSTILE") && !tree.includes("__proto__") && !tree.includes("constructor"), "never in a prop");
    assert.ok(spriteKeys(host).every((k) => !k.includes("HOSTILE") && !k.includes("__proto__")));
  });
});

test("OFFC-14 screen camera: rows move the camera, zoom offers exactly the levels, a scroll requests only newly visible layers", async () => {
  await withScreen(officeFixture(), async ({ host, handle }) => {
    const scrolls = handle.find("ScrollView");
    const outer = scrolls.find((n) => n.props.onScroll && !n.props.horizontal);
    const inner = scrolls.find((n) => n.props.horizontal);
    const moves = [];
    for (const [name, node] of [["y", outer], ["x", inner]]) node.props.ref.current = { scrollTo: (o) => moves.push([name, o]) };
    const rows = () => byTestId(handle, "Pressable", "office-sidebar-row");
    const labelOf = (row) => row.children.flatMap((c) => (typeof c === "object" && c ? textsIn(c) : [])).join("|");
    const textsIn = (node) => [...(node.children ?? []).filter((c) => typeof c === "string"), ...(node.children ?? []).flatMap((c) => (typeof c === "object" && c ? textsIn(c) : []))];
    const rowFor = (name) => rows().find((r) => textsIn(r).includes(name));
    const moveTo = async (name) => {
      moves.length = 0;
      rowFor(name).props.onPress();
      await settle(handle, 3);
      return { y: moves.find((m) => m[0] === "y")?.[1].y, x: moves.find((m) => m[0] === "x")?.[1].x };
    };
    assert.ok(labelOf(rows()[0]).length > 0);
    // the room of the first project is north of the corridor, the second one south of it
    const first = await moveTo("project p1");
    const second = await moveTo("project p2");
    for (const v of [first.x, first.y, second.x, second.y]) assert.ok(Number.isInteger(v) && v >= 0);
    assert.ok(second.y > first.y, `south room scrolls further down: ${first.y} then ${second.y}`);
    characterNodes(handle)[0].children.find((c) => c && c.type === "Pressable").props.onPress();
    await settle(handle, 3);
    assert.equal(byTestId(handle, "Pressable", "office-drawer-close").length, 1, "a character opens the drawer");
    // zoom
    const levels = [byTestId(handle, "Text", "office-zoom-level")[0].children.join("")];
    const before = spriteKeys(host).length;
    for (let i = 0; i < ZOOM_LEVELS.length + 1; i++) {
      byTestId(handle, "Pressable", "office-zoom-in")[0].props.onPress();
      await settle(handle, 6);
      levels.push(byTestId(handle, "Text", "office-zoom-level")[0].children.join(""));
    }
    assert.deepEqual([...new Set(levels)], ZOOM_LEVELS.map((z) => str("sceneZoomLevel", { zoom: z })));
    const fresh = spriteKeys(host).slice(before);
    assert.ok(fresh.length > 0);
    for (const key of fresh) assert.ok(ZOOM_LEVELS.includes(scaleOf(key)), key);
    assert.equal(new Set(spriteKeys(host)).size, spriteKeys(host).length);
    byTestId(handle, "Pressable", "office-zoom-out")[0].props.onPress();
    await settle(handle, 6);
    assert.equal(byTestId(handle, "Text", "office-zoom-level")[0].children.join(""), str("sceneZoomLevel", { zoom: ZOOM_LEVELS.at(-2) ?? ZOOM_LEVELS[0] }));
  });
});

test("OFFC-14 screen checkboxes: an unchecked project leaves the scene and the counters, None and All, kept across a remount", async () => {
  await withScreen(officeFixture(), async ({ host, handle }) => {
    const boxes = () => byTestId(handle, "Pressable", "office-sidebar-check");
    const labels = () => byTestId(handle, "View", /^office-label-\d+$/).length;
    const total = () => {
      const texts = textsOf(handle);
      return Number(texts[texts.indexOf(str("counterTotal")) + 1]);
    };
    assert.equal(boxes().length, 2);
    assert.deepEqual([characterNodes(handle).length, labels(), total()], [8, 2, 8]);
    boxes()[0].props.onPress();
    await settle(handle, 6);
    assert.deepEqual(boxes().map((b) => b.props.accessibilityState.checked), [false, true]);
    assert.equal(byTestId(handle, "Pressable", "office-sidebar-row").length, 2, "the hidden project stays in the list");
    assert.deepEqual([characterNodes(handle).length, labels(), total()], [2, 1, 2], "p1 (six agents) leaves the scene and the counters");
    byTestId(handle, "Pressable", "office-sidebar-none")[0].props.onPress();
    await settle(handle, 6);
    assert.deepEqual([characterNodes(handle).length, labels(), total()], [0, 0, 0]);
    const again = host.mount("office");
    await settle(again, 8);
    assert.deepEqual(byTestId(again, "Pressable", "office-sidebar-check").map((b) => b.props.accessibilityState.checked), [false, false], "the hidden set outlives a remount");
    again.unmount();
    byTestId(handle, "Pressable", "office-sidebar-all")[0].props.onPress();
    await settle(handle, 8);
    assert.deepEqual([characterNodes(handle).length, labels(), total()], [8, 2, 8]);
  });
});

test("OFFC-14 screen camera: a scroll that changes the visible set requests the newly visible layers only", async () => {
  await withScreen(officeFixture(), async ({ host, handle }) => {
    byTestId(handle, "View", "office-viewport")[0].props.onLayout({ nativeEvent: { layout: { width: 600, height: 400 } } });
    await settle(handle, 4);
    byTestId(handle, "Pressable", "office-zoom-in")[0].props.onPress();
    await settle(handle, 6);
    const known = new Set(spriteKeys(host));
    const eastRooms = (keys) => keys.filter((k) => scaleOf(k) === 3 && (k.startsWith("room-layer:room-") || k.startsWith("room-front:room-")));
    assert.equal(eastRooms([...known]).length, 0, "the project rooms are beyond the margin at the larger zoom");
    const inner = handle.find("ScrollView").find((n) => n.props.horizontal);
    inner.props.onScroll({ nativeEvent: { contentOffset: { x: 1100 }, layoutMeasurement: { width: 1280 } } });
    await settle(handle, 8);
    const fresh = spriteKeys(host).filter((k) => !known.has(k));
    const layerKeys = fresh.filter((k) => k.startsWith("room-") && scaleOf(k) === 3);
    assert.ok(layerKeys.length > 0, "the east rooms load");
    assert.ok(layerKeys.every((k) => k.includes(":room-s") || k.includes("corridor-c3-g2")), layerKeys.join());
    assert.equal(new Set(spriteKeys(host)).size, spriteKeys(host).length);
  });
});

test("OFFC-17 screen tint: day position and season pick the requested variants", async () => {
  const cases = [
    { date: new Date(2026, 5, 15, 12, 0, 0), season: "none" },
    { date: new Date(2026, 5, 15, 22, 30, 0), season: "none" },
    { date: new Date(2026, 11, 10, 18, 18, 0), season: "christmas" },
  ];
  const seen = [];
  for (const { date, season } of cases) {
    mock.timers.enable({ apis: ["Date"], now: date });
    try {
      await withScreen(fakePaseo({ agents: [agentPayload("a", { workspaceId: "w1", status: "running" })], workspaceEntries: [workspacePayload("w1")], projectEntries: [projectPayload("p1")] }), async ({ host }) => {
        const layer = spriteKeys(host).filter((k) => k.startsWith("room-layer:") || k.startsWith("room-front:"));
        const expected = CAM.tintIndices(dayPhase(date).position, TINT_LEVELS);
        assert.deepEqual([...new Set(layer.map(tintOf))].sort(), expected);
        assert.equal(seasonFor(date), season);
        assert.ok(layer.every((k) => k.split(":")[1].endsWith(`-${SEASON_CODES[season]}`)), layer[0]);
        seen.push(expected);
      });
    } finally {
      mock.timers.reset();
    }
  }
  assert.deepEqual(seen[0], [0]);
  assert.deepEqual(seen[1], [TINT_LEVELS - 1]);
  assert.equal(seen[2].length, 2, "a fractional position mounts the two nearest variants");
});

function waveProject(plans) {
  const root = makeTempDir("ui office screen wave ");
  const dir = path.join(root, ".planning", "phases", "02-api");
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, summary] of plans) {
    fs.writeFileSync(path.join(dir, `02-${id}-PLAN.md`), `---\nphase: 02\nplan: ${id}\nwave: 1\n---\n# plan\n`, "utf8");
    if (summary) fs.writeFileSync(path.join(dir, `02-${id}-SUMMARY.md`), `---\nstatus: ${summary}\n---\n`, "utf8");
  }
  const run = path.join(root, "_workspace", "_runs", "wf_x");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ runId: "wf_x", status: "running" }), "utf8");
  fs.writeFileSync(path.join(run, "args.json"), JSON.stringify({ phaseDir: ".planning/phases/02-api", wave: 1 }), "utf8");
  return root;
}

test("OFFC-18 screen wave: labelled agents cause id-only wave calls and one completion plays one burst", async () => {
  const root = waveProject([["01", "complete"], ["02", false]]);
  const labelled = (status) => agentPayload("w", { workspaceId: "w1", status, labels: { "harness.run": "wf_x" } });
  const fake = fakePaseo({
    agents: [labelled("running"), agentPayload("plain", { workspaceId: "w1", status: "running" })],
    workspaceEntries: [workspacePayload("w1")],
    projectEntries: [projectPayload("p1")],
    workspaces: { w1: root },
  });
  await withScreen(fake, async ({ host, handle }) => {
    const waves = () => host.rpcCalls.filter((c) => c.method === "office.wave");
    assert.equal(waves().length, 1);
    assert.deepEqual(waves()[0].input, { workspaceId: "w1", runId: "wf_x" });
    assert.deepEqual(Object.keys(waves()[0].input).sort(), ["runId", "workspaceId"]);
    assert.equal(byTestId(handle, "View", /^office-fx-burst-/).length, 0, "a first reading plays nothing");
    fs.writeFileSync(path.join(root, ".planning", "phases", "02-api", "02-02-SUMMARY.md"), "---\nstatus: complete\n---\n", "utf8");
    fake.emitAgent(agentUpsert(labelled("idle")));
    await settle(handle, 4);
    beats(6);
    await settle(handle, 8);
    assert.equal(waves().length, 2);
    assert.equal(byTestId(handle, "View", /^office-fx-burst-\d+$/).length, 1);
  }, { rounds: 8 });
});

test("OFFC-12 screen handoff: a child that finishes walks to its parent once, the parent does not move", async () => {
  const fake = fakePaseo({
    agents: [agentPayload("par", { workspaceId: "w1", status: "running" }), kidP("kid", "par", { workspaceId: "w1", status: "running" })],
    workspaceEntries: [workspacePayload("w1")],
    projectEntries: [projectPayload("p1")],
  });
  await withScreen(fake, async ({ host, handle }) => {
    const origins = (from) => new Set(host.animations.slice(from).map((a) => a.value).filter((v) => v && v.x && v.y));
    const before = host.animations.length;
    fake.emitAgent(agentUpsert(kidP("kid", "par", { workspaceId: "w1", status: "idle" })));
    await settle(handle, 10);
    const grown = host.animations.length;
    assert.ok(grown > before, "the child starts walking");
    assert.equal(origins(before).size, 1, "only one character moves");
    fake.emitAgent(agentUpsert(kidP("kid", "par", { workspaceId: "w1", status: "idle", updatedAt: "2026-10-20T10:00:09.000Z" })));
    await settle(handle, 6);
    assert.equal(host.animations.length, grown, "a second idle push starts nothing");
  });
});

test("OFFC-10 registration: one office screen and sidebar item, every cleanup runs on dispose", async () => {
  const host = await fakeHost();
  assert.deepEqual(host.screens.map((s) => s.id), ["office"]);
  assert.deepEqual(host.sidebarItems.map((s) => s.id), ["office"]);
  const entry = stripComments(readPlugin("index.client.tsx"));
  assert.ok(entry.includes("disposeOfficeCaches()") && entry.includes("OfficeScreen") && entry.includes("OfficeSidebarItem"));
  assert.ok(!/TracerScreen/.test(entry));
  host.dispose();
  assert.ok(host.cleanups.every((c) => c.ran), JSON.stringify(host.cleanups));
});

// ---------------------------------------------------------------- gap plan 07-15: reopen, retry, relayout

const { createWalkGrid, BLOCKED } = await import("../../plugins/office/shared/path/grid.ts");
const { handoffJourney } = await import("../../plugins/office/client/life/journey.ts");
const { createSpriteStore } = await import("../../plugins/office/client/sprite-store.ts");
// The plan fixes these at 20 and 3; the fallback keeps the screen tests meaningful before the constants exist.
const RETRY_BEATS = CAM.SCENE_SPRITE_RETRY_BEATS ?? 20;
const RETRY_ROUNDS = CAM.SCENE_SPRITE_RETRY_ROUNDS_MAX ?? 3;
const tileKey = (t) => `${t.x},${t.y}`;
const frontKeys = (building) => elevatorFronts(building).map(tileKey);
const LATER = "2026-10-20T10:00:09.000Z";

// Steps a director from one beat to another over one character list and returns the starts with their beat.
function runBeats(dir, characters, from, to) {
  const out = [];
  for (let beat = from; beat <= to; beat++) for (const s of dir.step(characters, beat).starts) out.push({ ...s, beat });
  return out;
}

// Steps until the agent's departure starts and returns that beat (null when it never does).
function departureBeat(dir, characters, agentId) {
  for (let beat = 0; beat <= CAM.SCENE_SLEEP_BEATS + 4; beat++) {
    if (dir.step(characters(), beat).starts.some((s) => s.agentId === agentId && s.kind === "departure")) return beat;
  }
  return null;
}

// The same layout under a new building object with its first elevator front blocked, so the fronts move.
function blockedFront(building) {
  const grid = createWalkGrid(building.grid.w, building.grid.h, building.grid.version);
  grid.cells.set(building.grid.cells);
  const [first] = elevatorFronts(building);
  grid.set(first.x, first.y, BLOCKED);
  return { ...building, grid };
}
const noElevators = (building) => ({ ...building, areas: building.areas.map((a) => (a.kind === "reception" ? { ...a, spots: a.spots.filter((s) => s.kind !== "elevator") } : a)) });
const withoutMove = (characters) => characters.map((c) => ({ ...c, ready: new Set([...c.ready].filter((g) => g !== CAM.MOVE_GROUP)) }));

test("OFFC-13 life reopen: a closed agent that starts work during its departure walk arrives again by elevator", () => {
  const { building, characters } = lifeScene({ c1: "closed", r1: "running" });
  const dir = CAM.createLifeDirector(building);
  const at = departureBeat(dir, characters, "c1");
  assert.ok(at !== null, "the departure starts");
  const reopened = characters({ c1: "running" });
  dir.step(reopened, at + 1);
  assert.equal(dir.journeyOf("c1"), "departure", "the walk keeps going");
  assert.deepEqual(dir.finished("c1", at + 2).gone, ["c1"]);
  assert.equal(dir.isGone("c1"), true);
  const back = runBeats(dir, reopened, at + 3, at + 40).filter((s) => s.agentId === "c1");
  assert.deepEqual(back.map((s) => s.kind), ["arrival"], "exactly one arrival");
  assert.ok(frontKeys(building).includes(tileKey(back[0].journey.startTile)));
  assert.equal(dir.isGone("c1"), false);
});

test("OFFC-13 life reopen: a closed agent that stays closed is hidden at the end of its walk and never comes back", () => {
  const { building, characters } = lifeScene({ c1: "closed", r1: "running" });
  const dir = CAM.createLifeDirector(building);
  const at = departureBeat(dir, characters, "c1");
  assert.deepEqual(dir.finished("c1", at + 1).gone, ["c1"]);
  assert.deepEqual(runBeats(dir, characters(), at + 2, at + 40).filter((s) => s.agentId === "c1"), []);
  assert.equal(dir.isGone("c1"), true);
});

test("OFFC-13 life reopen: a status that leaves closed after the walk ended schedules exactly one arrival", () => {
  const { building, characters } = lifeScene({ c1: "closed", r1: "running" });
  const dir = CAM.createLifeDirector(building);
  const at = departureBeat(dir, characters, "c1");
  dir.finished("c1", at + 1);
  const back = runBeats(dir, characters({ c1: "idle" }), at + 2, at + 40).filter((s) => s.agentId === "c1");
  assert.deepEqual(back.map((s) => s.kind), ["arrival"]);
  assert.equal(dir.isGone("c1"), false);
});

// A probe that also hands the test the host's Animated, so walks can be held and finished by hand.
function lifeProbe() {
  const dir = makeTempDir("ui office life probe ");
  const file = path.join(dir, "probe.tsx");
  const clocks = JSON.stringify(path.join(PLUGIN_DIR, "client", "clocks.ts"));
  fs.writeFileSync(file, `import { Animated } from "react-native";\nimport { useClock } from ${clocks};\nexport function Probe() { globalThis.__officeClocks = useClock(); globalThis.__officeAnimated = Animated; return null; }\n`);
  return file;
}

// The fake host never ends a timed animation; this holds every one started from now on until finish() completes it.
function holdWalks() {
  const animated = globalThis.__officeAnimated;
  const { timing, delay } = animated;
  const held = [];
  const hold = (handle, complete, ms) => {
    let stopped = false;
    return {
      ...handle,
      start(callback) {
        if (ms === 0) return handle.start(callback);
        held.push(() => {
          if (stopped) return;
          complete();
          callback?.({ finished: true });
        });
      },
      stop() {
        stopped = true;
        handle.stop();
      },
    };
  };
  animated.timing = (value, config) => hold(timing(value, config), () => value.setValue(config.toValue), config?.duration ?? 500);
  animated.delay = (ms) => hold(delay(ms), () => undefined, ms);
  return {
    count: () => held.length,
    finish() {
      for (let round = 0; round < 200 && held.length > 0; round++) for (const done of held.splice(0)) done();
    },
    restore() {
      animated.timing = timing;
      animated.delay = delay;
    },
  };
}

async function withLifeScreen(fake, hostOptions, body) {
  const host = await fakeHost({ paseo: fake, ...hostOptions });
  host.mountModule(lifeProbe(), "Probe", {});
  const handle = host.mount("office");
  try {
    await settle(handle, 10);
    await body({ host, handle, fake });
  } finally {
    host.dispose();
  }
}

const pairFixture = () =>
  fakePaseo({
    agents: [agentPayload("clo", { workspaceId: "w1", status: "closed" }), agentPayload("run", { workspaceId: "w1", status: "running" })],
    workspaceEntries: [workspacePayload("w1", { projectId: "p1" })],
    projectEntries: [projectPayload("p1")],
  });

// Lets the closed agent depart, runs `during` while its walk is in flight, ends the walks, and returns the drawn characters.
async function departureRun(during, after = async () => undefined) {
  let shown = null;
  await withLifeScreen(pairFixture(), {}, async ({ handle, fake }) => {
    assert.equal(characterNodes(handle).length, 2, "both agents are drawn");
    const walks = holdWalks();
    try {
      beats(CAM.SCENE_SLEEP_BEATS + 2);
      await settle(handle, 4);
      assert.ok(walks.count() > 0, "the departure walk runs");
      await during({ handle, fake });
      walks.finish();
      await settle(handle, 4);
      beats(12);
      await settle(handle, 6);
      await after({ handle, fake, walks });
      shown = characterNodes(handle).length;
    } finally {
      walks.restore();
    }
  });
  return shown;
}

test("OFFC-13 screen reopen: an agent that reopens during its departure walk is drawn again, one that stays closed is not", async () => {
  assert.equal(await departureRun(async () => undefined), 1, "control: the closed agent stays gone");
  const reopen = async ({ handle, fake }) => {
    fake.emitAgent(agentUpsert(agentPayload("clo", { workspaceId: "w1", status: "running", updatedAt: LATER })));
    await settle(handle, 4);
  };
  assert.equal(await departureRun(reopen), 2, "the reopened agent is drawn again");
});

test("OFFC-08 retry rule: one round every SCENE_SPRITE_RETRY_BEATS beats, at most SCENE_SPRITE_RETRY_ROUNDS_MAX rounds", () => {
  assert.equal(CAM.SCENE_SPRITE_RETRY_BEATS, 20);
  assert.equal(CAM.SCENE_SPRITE_RETRY_ROUNDS_MAX, 3);
  const every = CAM.SCENE_SPRITE_RETRY_BEATS;
  const max = CAM.SCENE_SPRITE_RETRY_ROUNDS_MAX;
  assert.equal(CAM.shouldRetrySprites(every, 0), true);
  assert.equal(CAM.shouldRetrySprites(every * 3, max - 1), true);
  for (const [beat, rounds] of [[0, 0], [every - 1, 0], [every + 1, 0], [every, max], [every, max + 1], [-every, 0], [every, -1], [every + 0.5, 0], [every, 0.5], [NaN, 0], [every, NaN], [Infinity, 0]]) {
    assert.equal(CAM.shouldRetrySprites(beat, rounds), false, `${beat} ${rounds}`);
  }
});

test("OFFC-08 retry rule: a final failure costs no round and is never asked again, a transient one is (store level, as the screen applies it)", async () => {
  // The fake host can only make a call throw (call_failed), so the final failure comes from the real handler's render_failed.
  const good = CAM.characterSheetKey("agent-a", 0, 2);
  const bad = "room-layer:room-s32-q0-n:-:2:0";
  const handle = handler();
  const asked = [];
  let calls = 0;
  const store = createSpriteStore(async ({ keys }) => {
    asked.push(...keys);
    calls++;
    if (calls === 1) throw new Error("rpc failed");
    return handle({ keys });
  });
  const keys = [good, bad];
  store.request(keys);
  await store.settle();
  assert.deepEqual([store.get(good).code, store.get(bad).code], ["call_failed", "call_failed"]);
  let rounds = 0;
  for (let beat = 1; beat <= RETRY_BEATS * (RETRY_ROUNDS + 3); beat++) {
    const transient = keys.some((k) => store.get(k)?.state === "failed" && store.get(k).code === "call_failed");
    if (CAM.shouldRetrySprites(beat, rounds) && transient) {
      store.retry(keys);
      rounds++;
      await store.settle();
    }
  }
  assert.equal(rounds, 1, "only the round that found a call_failed key");
  assert.equal(store.get(good).state, "ready");
  assert.equal(store.get(bad).code, "render_failed");
  assert.equal(asked.filter((k) => k === bad).length, 2, "the final failure is never asked again");
  store.dispose();
});

const runningFixture = () =>
  fakePaseo({
    agents: [agentPayload("ra", { workspaceId: "w1", status: "running" }), agentPayload("rb", { workspaceId: "w1", status: "running" })],
    workspaceEntries: [workspacePayload("w1", { projectId: "p1" })],
    projectEntries: [projectPayload("p1")],
  });
const spriteCalls = (host) => host.rpcCalls.filter((c) => c.method === "office.sprites");
const imagesOf = (handle) => handle.find("Image").length + handle.find("Animated.Image").length;
// Fires the beats of whole retry periods, letting the calls of each period settle.
async function retryPeriods(handle, periods) {
  for (let i = 0; i < periods; i++) {
    beats(RETRY_BEATS);
    await settle(handle, 4);
  }
}

test("OFFC-08 screen retry: a key whose office.sprites call failed is asked again on a slow beat and then drawn", async () => {
  let healthy = null;
  await withLifeScreen(runningFixture(), {}, async ({ handle }) => {
    await retryPeriods(handle, 1);
    healthy = imagesOf(handle);
  });
  await withLifeScreen(runningFixture(), { rpcFail: (method, _input, index) => method === "office.sprites" && index === 0 }, async ({ host, handle }) => {
    const first = spriteCalls(host)[0].input.keys;
    const before = spriteCalls(host).length;
    assert.ok(imagesOf(handle) < healthy, "the failed call leaves sprites blank");
    await retryPeriods(handle, 1);
    const later = spriteCalls(host).slice(before).flatMap((c) => c.input.keys);
    assert.deepEqual(first.filter((k) => !later.includes(k)), [], "every key of the failed call is asked again");
    assert.equal(imagesOf(handle), healthy, "the layers and characters of that call appear");
  });
});

test("OFFC-08 screen retry: a persistent failure is asked again at most SCENE_SPRITE_RETRY_ROUNDS_MAX rounds per wanted set", async () => {
  await withLifeScreen(runningFixture(), { rpcFail: (method) => method === "office.sprites" }, async ({ host, handle }) => {
    const first = spriteCalls(host).length;
    await retryPeriods(handle, RETRY_ROUNDS + 3);
    const spent = spriteCalls(host).length;
    assert.ok(spent > first, "failed keys are asked again");
    assert.ok(spent <= first * (1 + RETRY_ROUNDS), `${spent} calls for ${first} first calls`);
    await retryPeriods(handle, 3);
    assert.equal(spriteCalls(host).length, spent, "no call after the last round");
  });
});

test("OFFC-08 screen retry: with every call succeeding, retry beats make no office.sprites call", async () => {
  await withLifeScreen(runningFixture(), {}, async ({ host, handle }) => {
    const first = spriteCalls(host).length;
    await retryPeriods(handle, RETRY_ROUNDS + 2);
    assert.equal(spriteCalls(host).length, first);
  });
});

test("OFFC-08 screen retry: a new wanted set (a zoom) restores the retry rounds", async () => {
  await withLifeScreen(runningFixture(), { rpcFail: (method) => method === "office.sprites" }, async ({ host, handle }) => {
    await retryPeriods(handle, RETRY_ROUNDS + 2);
    const spent = spriteCalls(host).length;
    byTestId(handle, "Pressable", "office-zoom-in")[0].props.onPress();
    await settle(handle, 6);
    const zoomed = spriteCalls(host).length;
    assert.ok(zoomed > spent, "the zoom asks its new keys");
    await retryPeriods(handle, 2);
    assert.ok(spriteCalls(host).length > zoomed, "the new wanted set is retried again");
  });
});

// A model with three agents and, optionally, a second project room; its building and characters by status.
function relayoutScene(extraRoom) {
  const list = [drawn("c1"), drawn("s1"), drawn("r1")];
  const rooms = [roomOf("p1", [cluster("w1", list)])];
  if (extraRoom) rooms.push(roomOf("p2", [cluster("w2", [drawn("x1")])]));
  const model = modelOf(rooms);
  const building = layoutOf(model);
  const placement = CAM.placeScene(building, model);
  const characters = (statuses) =>
    placement.seats
      .filter((seat) => statuses[seat.agentId])
      .map((seat) => ({ agentId: seat.agentId, seat: { tile: seat.tile, dir: seat.dir }, status: statuses[seat.agentId], choice: poseFor(agentView(seat.agentId, { status: statuses[seat.agentId] })), ready: new Set([0, 1, 2]) }));
  return { building, characters };
}

test("OFFC-13 life relayout: a departed agent stays gone and a sleeping agent keeps its sleep clock across a new building", () => {
  const one = relayoutScene(false);
  const two = relayoutScene(true);
  assert.ok(two.building.areas.length > one.building.areas.length, "the second building has one more project room");
  const run = (relayoutAt) => {
    const dir = CAM.createLifeDirector(one.building);
    let scene = one;
    const log = [];
    for (let beat = 0; beat <= 40; beat++) {
      if (beat === relayoutAt) {
        const changes = dir.relayout(two.building);
        assert.deepEqual(changes.starts, []);
        scene = two;
      }
      const statuses = { c1: "closed", s1: beat >= 12 ? "closed" : "running", r1: "running" };
      for (const s of dir.step(scene.characters(statuses), beat).starts) {
        log.push({ agentId: s.agentId, kind: s.kind, beat });
        if (s.agentId === "c1" && s.kind === "departure") dir.finished("c1", beat);
      }
    }
    return { dir, log };
  };
  const plain = run(null);
  const moved = run(14);
  assert.ok(moved.log.some((s) => s.agentId === "c1" && s.kind === "departure" && s.beat < 14), "c1 departed before the relayout");
  assert.equal(moved.dir.isGone("c1"), true, "the departed agent stays gone");
  assert.deepEqual(moved.log.filter((s) => s.agentId === "c1" && s.kind === "arrival"), []);
  const sleeper = (r) => r.log.find((s) => s.agentId === "s1" && s.kind === "departure")?.beat;
  assert.ok(sleeper(plain) !== undefined);
  assert.equal(sleeper(moved), sleeper(plain), "the sleeper departs on the same beat");
});

test("OFFC-13 life relayout: a pending arrival keeps its schedule and arrives on an elevator of the new building", () => {
  const { building, characters, placement } = lifeScene({ n1: "initializing", r1: "running" });
  const moved = blockedFront(building);
  assert.notDeepEqual(frontKeys(moved), frontKeys(building), "the fronts move");
  const dir = CAM.createLifeDirector(building);
  dir.step(withoutMove(characters()), 0);
  assert.equal(dir.isGone("n1"), true);
  assert.deepEqual(dir.relayout(moved).starts, []);
  assert.equal(dir.isGone("n1"), true, "still hidden with its arrival due");
  const arrivals = runBeats(dir, characters(), 1, 30).filter((s) => s.agentId === "n1");
  assert.deepEqual(arrivals.map((s) => s.kind), ["arrival"]);
  assert.ok(arrivals[0].beat <= 2, `arrives on beat ${arrivals[0].beat}`);
  assert.ok(frontKeys(moved).includes(tileKey(arrivals[0].journey.startTile)));
  assert.deepEqual(arrivals[0].journey.endTile, placement.seats.find((s) => s.agentId === "n1").tile);
  // A handoff started after the relayout begins at the child's seat and is computed on the new building.
  const fam = lifeScene({ parent: "running", child: "running" }, new Set([0, 1, 2]), { child: "parent" });
  const famMoved = blockedFront(fam.building);
  const d2 = CAM.createLifeDirector(fam.building);
  d2.step(fam.characters(), 0);
  d2.relayout(famMoved);
  const started = d2.handoff({ childId: "child", parentId: "parent" }, fam.characters(), 1).starts;
  assert.equal(started.length, 1);
  const seat = (id) => fam.placement.seats.find((s) => s.agentId === id);
  assert.deepEqual(started[0].journey.startTile, seat("child").tile);
  assert.deepEqual(started[0].journey, handoffJourney(famMoved, seat("child").tile, seat("parent").tile, { homeDir: seat("child").dir }));
});

test("OFFC-13 life relayout: running arrivals, departures, excursions, hangouts and handoffs end once and free every walker slot", () => {
  const check = (dir, building, label) => {
    const kinds = new Map();
    for (const id of ["a1", "c1", "child", ...Array.from({ length: 12 }, (_, i) => `g${i}`)]) if (dir.journeyOf(id)) kinds.set(id, dir.journeyOf(id));
    const changes = dir.relayout({ ...building });
    assert.deepEqual([...changes.cancels].sort(), [...kinds.keys()].sort(), `${label}: each running journey ends once`);
    for (const id of kinds.keys()) assert.equal(dir.journeyOf(id), null, `${label}: ${id}`);
    return kinds;
  };
  // arrival
  const a = lifeScene({ a1: "initializing" });
  const da = CAM.createLifeDirector(a.building);
  runBeats(da, a.characters(), 0, 3);
  assert.deepEqual([...check(da, a.building, "arrival").values()], ["arrival"]);
  // departure
  const c = lifeScene({ c1: "closed" });
  const dc = CAM.createLifeDirector(c.building);
  departureBeat(dc, c.characters, "c1");
  assert.deepEqual([...check(dc, c.building, "departure").values()], ["departure"]);
  // handoff
  const h = lifeScene({ parent: "running", child: "running" }, new Set([0, 1, 2]), { child: "parent" });
  const dh = CAM.createLifeDirector(h.building);
  dh.step(h.characters(), 0);
  dh.handoff({ childId: "child", parentId: "parent" }, h.characters(), 1);
  assert.deepEqual([...check(dh, h.building, "handoff").values()], ["handoff"]);
  // excursions and hangouts up to the walker cap, none finished
  const ids = Array.from({ length: 12 }, (_, i) => `g${i}`);
  const g = lifeScene(Object.fromEntries(ids.map((id) => [id, "idle"])));
  const dg = CAM.createLifeDirector(g.building);
  const seen = new Set();
  let beat = 0;
  let running = 0;
  for (; beat < 800 && !(running === CAM.SCENE_MAX_WALKERS && seen.has("hangout") && seen.has("excursion")); beat++) {
    for (const s of dg.step(g.characters(), beat).starts) {
      seen.add(s.kind);
      running++;
    }
    if (running === CAM.SCENE_MAX_WALKERS && !(seen.has("hangout") && seen.has("excursion"))) {
      for (const id of ids) if (dg.journeyOf(id)) dg.finished(id, beat);
      running = 0;
    }
  }
  assert.equal(running, CAM.SCENE_MAX_WALKERS, "the walker cap is reached");
  assert.ok(seen.has("hangout") && seen.has("excursion"), [...seen].join(","));
  assert.equal(dg.step(g.characters(), beat).starts.length, 0, "no slot is free before the relayout");
  const ended = check(dg, g.building, "outings");
  assert.equal(ended.size, CAM.SCENE_MAX_WALKERS);
  const next = runBeats(dg, g.characters(), beat + 1, beat + 1);
  assert.ok(next.length > 0 && next.length <= CAM.SCENE_MAX_WALKERS, `${next.length} journeys start after the relayout`);
});

test("OFFC-13 life relayout: the same building object changes nothing", () => {
  const { building, characters } = lifeScene({ a1: "initializing", r1: "running" });
  const dir = CAM.createLifeDirector(building);
  runBeats(dir, characters(), 0, 3);
  assert.equal(dir.journeyOf("a1"), "arrival");
  assert.deepEqual(dir.relayout(building), { starts: [], cancels: [], gone: [] });
  assert.equal(dir.journeyOf("a1"), "arrival");
});

test("OFFC-13 life relayout: a building without elevators shows every hidden agent and schedules no arrival", () => {
  const { building, characters } = lifeScene({ n1: "initializing", c1: "closed", r1: "running" });
  const flat = noElevators(building);
  assert.equal(elevatorFronts(flat).length, 0);
  const dir = CAM.createLifeDirector(building);
  dir.step(withoutMove(characters()), 0);
  const at = departureBeat(dir, () => withoutMove(characters()).map((c) => (c.agentId === "c1" ? { ...c, ready: new Set([0, 1, 2]) } : c)), "c1");
  assert.ok(at !== null);
  dir.finished("c1", at + 1);
  assert.equal(dir.isGone("n1"), true);
  assert.equal(dir.isGone("c1"), true);
  dir.relayout(flat);
  assert.equal(dir.isGone("n1"), false);
  assert.equal(dir.isGone("c1"), false);
  assert.deepEqual(runBeats(dir, characters(), at + 2, at + 30).filter((s) => s.kind === "arrival"), []);
});

test("OFFC-13 screen relayout: a new project room keeps a departed agent hidden", async () => {
  const addProject = async ({ handle, fake }) => {
    fake.emitProject({ kind: "upsert", project: projectPayload("p2") });
    fake.emitWorkspace({ kind: "upsert", workspace: workspacePayload("w2", { projectId: "p2" }) });
    fake.emitAgent(agentUpsert(agentPayload("new", { workspaceId: "w2", status: "running" })));
    await settle(handle, 8);
  };
  // The departed agent is gone; a new project, workspace and agent change the building: the new agent appears, the departed one does not.
  assert.equal(await departureRun(async () => undefined, addProject), 2);
});

// ---------------------------------------------------------------- step B: spawn and archive effects on the screen

const isXY = (v) => v !== null && typeof v === "object" && "x" in v && "y" in v;
const charOpacity = (node) => node.props.style.opacity?.current;
const roomShades = (handle) => byTestId(handle, "Animated.View", /^office-room-(dark|lit)-\d+$/).map((n) => n.props.testID.split("-")[2]);

test("B screen archive: the archived agent walks out to an elevator, then its tombstone is released and an empty room goes dark", async () => {
  const fake = fakePaseo({
    agents: [agentPayload("run", { workspaceId: "w1", status: "running" }), agentPayload("solo", { workspaceId: "w2", status: "idle" })],
    workspaceEntries: [workspacePayload("w1", { projectId: "p1" }), workspacePayload("w2", { projectId: "p2" })],
    projectEntries: [projectPayload("p1"), projectPayload("p2")],
  });
  await withLifeScreen(fake, {}, async ({ host, handle }) => {
    assert.equal(characterNodes(handle).length, 2);
    assert.deepEqual(roomShades(handle), ["lit", "lit"]);
    const walks = holdWalks();
    try {
      const before = host.animations.length;
      fake.emitAgent(agentUpsert(agentPayload("solo", { workspaceId: "w2", status: "idle", archivedAt: iso(9) })));
      await settle(handle, 6);
      assert.equal(characterNodes(handle).length, 2, "the tombstone is still drawn while it walks");
      assert.ok(host.animations.slice(before).some((a) => isXY(a.value)), "a walk is running");
      const texts = textsOf(handle);
      assert.equal(Number(texts[texts.indexOf(str("counterTotal")) + 1]), 1, "the tombstone is not counted");
      walks.finish();
      await settle(handle, 6);
    } finally {
      walks.restore();
    }
    assert.equal(characterNodes(handle).length, 1);
    assert.deepEqual(roomShades(handle), ["lit", "dark"], "the last one out turns the lights off");
  });
});

test("B screen bulk archive: more than ARCHIVE_BULK_MAX agents archived at once fade in place, nobody walks", async () => {
  const { ARCHIVE_BULK_MAX } = await import("../../plugins/office/client/presence.ts");
  const ids = Array.from({ length: ARCHIVE_BULK_MAX + 1 }, (_, i) => `z${i}`);
  const fake = fakePaseo({
    agents: [agentPayload("keep", { workspaceId: "w1", status: "running" }), ...ids.map((id) => agentPayload(id, { workspaceId: "w1", status: "idle" }))],
    workspaceEntries: [workspacePayload("w1", { projectId: "p1" })],
    projectEntries: [projectPayload("p1")],
  });
  await withLifeScreen(fake, {}, async ({ host, handle }) => {
    assert.equal(characterNodes(handle).length, ids.length + 1);
    const walks = holdWalks();
    try {
      const before = host.animations.length;
      for (const id of ids) fake.emitAgent(agentUpsert(agentPayload(id, { workspaceId: "w1", status: "idle", archivedAt: iso(9) })));
      await settle(handle, 6);
      const started = host.animations.slice(before);
      assert.ok(started.some((a) => !isXY(a.value) && a.config?.toValue === 0), "the tombstones fade");
      assert.ok(!started.some((a) => isXY(a.value)), "no walk");
      walks.finish();
      await settle(handle, 6);
    } finally {
      walks.restore();
    }
    assert.equal(characterNodes(handle).length, 1);
  });
});

test("B screen spawn: a fresh agent that is already running comes up by elevator; an old one and the agents present at open just sit", async () => {
  await withLifeScreen(officeFixture(), {}, async ({ handle, fake }) => {
    const shown = characterNodes(handle);
    assert.equal(shown.length, 8);
    assert.equal(shown.filter((n) => charOpacity(n) === 0).length, 0, "nobody arrives at open");
    const walks = holdWalks();
    try {
      fake.emitAgent(agentUpsert(agentPayload("fresh", { workspaceId: "w3", status: "running", createdAt: new Date().toISOString() })));
      fake.emitAgent(agentUpsert(agentPayload("stale", { workspaceId: "w3", status: "running", createdAt: iso(0) })));
      await settle(handle, 6);
      const nodes = characterNodes(handle);
      assert.equal(nodes.length, 10);
      const zeros = nodes.filter((n) => charOpacity(n) === 0);
      assert.equal(zeros.length, 1, "exactly one character is fading in at an elevator door");
      walks.finish();
      await settle(handle, 6);
    } finally {
      walks.restore();
    }
    assert.equal(characterNodes(handle).filter((n) => charOpacity(n) === 0).length, 0);
  });
});

// ---------------------------------------------------------------- step C: agent states on the screen

const { agentName } = await import("../../plugins/office/client/names.ts");
const shellCall = (callId, status, command) => ({ type: "tool_call", callId, name: "Bash", status, error: null, detail: { type: "shell", command } });

test("C screen: a permission raises a blinking alert, a working agent shows its tool, every character carries its generated name", async () => {
  const fake = fakePaseo({
    agents: [
      agentPayload("perm", { workspaceId: "w1", status: "running", pendingPermissions: [{ id: "x" }] }),
      agentPayload("work", { workspaceId: "w1", status: "running" }),
      agentPayload("done", { workspaceId: "w1", status: "idle", requiresAttention: true, attentionReason: "finished" }),
    ],
    workspaceEntries: [workspacePayload("w1", { projectId: "p1" })],
    projectEntries: [projectPayload("p1")],
    timelines: { work: [{ item: { type: "tool_call", callId: "r1", name: "Read", status: "completed", error: null, detail: { type: "read", filePath: "/x" } }, seqStart: 1 }] },
  });
  await withLifeScreen(fake, {}, async ({ host, handle }) => {
    beats(1);
    await settle(handle, 4);
    const texts = textsOf(handle);
    for (const id of ["perm", "work", "done"]) assert.ok(texts.includes(agentName(id)), id);
    assert.ok(texts.includes(str("glyphRead")), "the working agent shows its tool");
    assert.equal(byTestId(handle, "Animated.View", /^office-bubble-alert-\d+$/).length, 1, "one blinking alert");
    assert.equal(byTestId(handle, "Animated.View", /^office-bubble-soft-\d+$/).length, 1, "one soft notice");
    assert.ok(host.animations.some((a) => a.value && a.config && a.config.toValue !== undefined), "the alert blinks on Animated");
    assert.ok(texts.includes(str("glyphAlert")));
  });
});

test("C screen: an idle agent waiting on a running shell shows the hourglass at its desk, then cheers with confetti when the command ends", async () => {
  const fake = fakePaseo({
    agents: [agentPayload("sh", { workspaceId: "w1", status: "running" }), agentPayload("other", { workspaceId: "w1", status: "running" })],
    workspaceEntries: [workspacePayload("w1", { projectId: "p1" })],
    projectEntries: [projectPayload("p1")],
    timelines: { sh: [{ item: shellCall("c1", "running", "npm test"), seqStart: 1 }] },
  });
  await withLifeScreen(fake, {}, async ({ handle }) => {
    beats(1);
    await settle(handle, 4);
    assert.ok(textsOf(handle).includes(str("glyphTests")), "the running test command shows the tests glyph");
    fake.emitAgent(agentUpsert(agentPayload("sh", { workspaceId: "w1", status: "idle", requiresAttention: true, attentionReason: "finished" })));
    await settle(handle, 4);
    beats(1);
    await settle(handle, 4);
    assert.ok(textsOf(handle).includes(str("glyphHourglass")), "waiting on shell");
    assert.equal(byTestId(handle, "View", /^office-fx-burst-\d+$/).length, 0);
    fake.emitTimeline("sh", { agentId: "sh", event: { type: "timeline", item: shellCall("c1", "completed", "npm test") } });
    await settle(handle, 4);
    beats(1);
    await settle(handle, 4);
    assert.ok(textsOf(handle).includes(str("glyphParty")), "it celebrates");
    assert.ok(!textsOf(handle).includes(str("glyphHourglass")));
    assert.equal(byTestId(handle, "View", /^office-fx-burst-\d+$/).length, 1, "confetti");
  });
});

// ---------------------------------------------------------------- step D: HUD on the screen

const counterOf = (handle, key) => {
  const texts = textsOf(handle);
  return Number(texts[texts.indexOf(str(key)) + 1]);
};
const pressCharacter = (handle, index = 0) => characterNodes(handle)[index].children.find((c) => c && c.type === "Pressable").props.onPress();

test("D screen: top bar counters, the feed panel with a permission request, and Next request opening the agent that waits", async () => {
  await withScreen(officeFixture(), async ({ handle, fake }) => {
    assert.deepEqual([counterOf(handle, "counterRooms"), counterOf(handle, "counterSubAgents"), counterOf(handle, "counterShells")], [2, 1, 0]);
    assert.equal(byTestId(handle, "View", "office-feed").length, 0);
    byTestId(handle, "Pressable", "office-feed-toggle")[0].props.onPress();
    await settle(handle, 3);
    assert.equal(byTestId(handle, "View", "office-feed").length, 1);
    assert.ok(textsOf(handle).includes(str("feedEmpty")));
    fake.emitAgent(agentUpsert(agentPayload("r1", { workspaceId: "w3", status: "running", pendingPermissions: [{ id: "q" }] })));
    await settle(handle, 4);
    const rows = byTestId(handle, "Pressable", "office-feed-row");
    assert.equal(rows.length, 1);
    const texts = textsOf(handle);
    assert.ok(texts.includes(str("feedPermission")) && texts.includes(agentName("r1")) && texts.includes(str("timeNow")));
    byTestId(handle, "Pressable", "office-next-request")[0].props.onPress();
    await settle(handle, 3);
    assert.ok(textsOf(handle).includes(agentName("i3")), "the first agent that needs the owner, in snapshot order");
    byTestId(handle, "Pressable", "office-next-request")[0].props.onPress();
    await settle(handle, 3);
    assert.ok(textsOf(handle).includes(agentName("r1")));
    assert.equal(byTestId(handle, "Pressable", "office-drawer-close").length, 1);
  });
});

test("D screen: search filters the project list and a found agent opens the drawer and moves the camera", async () => {
  await withScreen(officeFixture(), async ({ handle }) => {
    const moves = [];
    for (const node of handle.find("ScrollView").filter((n) => n.props.onScroll)) node.props.ref.current = { scrollTo: (o) => moves.push(o) };
    assert.equal(byTestId(handle, "TextInput", "office-search").length, 0, "the field opens on demand");
    byTestId(handle, "Pressable", "office-search-open")[0].props.onPress();
    await settle(handle, 2);
    const input = byTestId(handle, "TextInput", "office-search")[0];
    assert.equal(typeof input.props.placeholder, "string");
    input.props.onChangeText("p2");
    await settle(handle, 3);
    assert.equal(byTestId(handle, "Pressable", "office-sidebar-row").length, 1, "the project list is filtered");
    byTestId(handle, "TextInput", "office-search")[0].props.onChangeText("parent");
    await settle(handle, 3);
    const results = byTestId(handle, "Pressable", "office-search-result");
    assert.equal(results.length, 1);
    results[0].props.onPress();
    await settle(handle, 3);
    assert.equal(byTestId(handle, "Pressable", "office-drawer-close").length, 1);
    assert.ok(textsOf(handle).includes("parent"));
    assert.ok(moves.length > 0, "the camera moved");
    byTestId(handle, "Pressable", "office-search-close")[0].props.onPress();
    await settle(handle, 2);
    assert.deepEqual([byTestId(handle, "TextInput", "office-search").length, byTestId(handle, "Pressable", "office-sidebar-row").length], [0, 2], "closing clears the query");
  });
});

test("D screen: Overview fits the building at the smallest zoom; Follow from the drawer button and from a double press", async () => {
  await withLifeScreen(officeFixture(), {}, async ({ handle }) => {
    const moves = [];
    for (const node of handle.find("ScrollView").filter((n) => n.props.onScroll)) node.props.ref.current = { scrollTo: (o) => moves.push(o) };
    byTestId(handle, "Pressable", "office-zoom-in")[0].props.onPress();
    await settle(handle, 4);
    byTestId(handle, "Pressable", "office-overview")[0].props.onPress();
    await settle(handle, 4);
    assert.equal(byTestId(handle, "Text", "office-zoom-level")[0].children.join(""), str("sceneZoomLevel", { zoom: ZOOM_LEVELS[0] }));
    pressCharacter(handle);
    await settle(handle, 3);
    const follow = () => byTestId(handle, "Pressable", "office-drawer-follow")[0];
    assert.equal(follow().props.accessibilityState.selected, false);
    follow().props.onPress();
    await settle(handle, 3);
    assert.equal(follow().props.accessibilityState.selected, true);
    moves.length = 0;
    beats(1);
    await settle(handle, 3);
    assert.ok(moves.length > 0, "the camera follows on the beat");
    follow().props.onPress();
    await settle(handle, 3);
    assert.equal(follow().props.accessibilityState.selected, false);
    pressCharacter(handle, 1);
    pressCharacter(handle, 1);
    await settle(handle, 3);
    assert.equal(follow().props.accessibilityState.selected, true, "a double press follows the character");
  });
});

// ---------------------------------------------------------------- mobile: the narrow layout (habblaud's phone layout)

import { feedHeight, layoutMode, sheetHeight, sidePanelWidth } from "../../plugins/office/client/narrow.ts";
import { NARROW_GAP_PX, NARROW_MAX_WIDTH_PX, NARROW_SIDE_MAX_PX } from "../../plugins/office/client/limits-panels.ts";

const PHONE = { width: 390, height: 700 };
const layBody = (handle, size) => byTestId(handle, "View", "office-body")[0].props.onLayout({ nativeEvent: { layout: size } });

test("MOB-01 narrow layout: the breakpoint and the panel sizes", () => {
  assert.equal(layoutMode(0), "wide", "an unmeasured screen keeps the first frame's layout");
  assert.equal(layoutMode(Number.NaN), "wide");
  assert.equal(layoutMode(PHONE.width), "narrow");
  assert.equal(layoutMode(NARROW_MAX_WIDTH_PX), "narrow");
  assert.equal(layoutMode(NARROW_MAX_WIDTH_PX + 1), "wide");
  assert.equal(sidePanelWidth(320), 320 - NARROW_GAP_PX * 2, "a small phone: the screen less the gaps");
  assert.equal(sidePanelWidth(PHONE.width), NARROW_SIDE_MAX_PX, "a common phone: the cap");
  assert.equal(sheetHeight(PHONE.height), 406);
  assert.equal(feedHeight(PHONE.height), 308);
  assert.equal(sheetHeight(10), 0);
  assert.equal(feedHeight(-5), 0);
});

test("MOB-02 screen narrow: the room list leaves the flow for an overlay that the scrim, the close button or a picked room closes", async () => {
  await withScreen(officeFixture(), async ({ handle }) => {
    const checks = () => byTestId(handle, "Pressable", "office-sidebar-check").length;
    const overlay = () => byTestId(handle, "View", "office-rooms-overlay").length;
    assert.equal(byTestId(handle, "Pressable", "office-rooms-open").length, 0, "wide by default: no room button");
    assert.equal(checks(), 2);
    layBody(handle, PHONE);
    await settle(handle, 3);
    assert.equal(checks(), 0, "the list column leaves the flow");
    assert.equal(byTestId(handle, "Pressable", "office-feed-toggle").length, 0, "the Activity bar replaces the feed button");
    byTestId(handle, "Pressable", "office-rooms-open")[0].props.onPress();
    await settle(handle, 2);
    assert.equal(byTestId(handle, "View", "office-rooms-panel")[0].props.style.width, sidePanelWidth(PHONE.width));
    assert.equal(checks(), 2);
    byTestId(handle, "Pressable", "office-sidebar-check")[0].props.onPress();
    await settle(handle, 2);
    assert.equal(overlay(), 1, "hiding a project keeps the list open");
    byTestId(handle, "Pressable", "office-sidebar-check")[0].props.onPress();
    byTestId(handle, "Pressable", "office-scrim")[0].props.onPress();
    await settle(handle, 2);
    assert.equal(overlay(), 0);
    byTestId(handle, "Pressable", "office-rooms-open")[0].props.onPress();
    await settle(handle, 2);
    byTestId(handle, "Pressable", "office-rooms-close")[0].props.onPress();
    await settle(handle, 2);
    assert.equal(overlay(), 0);
    byTestId(handle, "Pressable", "office-rooms-open")[0].props.onPress();
    await settle(handle, 2);
    byTestId(handle, "Pressable", "office-sidebar-row")[0].props.onPress();
    await settle(handle, 2);
    assert.equal(overlay(), 0, "a picked room closes the list");
    byTestId(handle, "Pressable", "office-rooms-open")[0].props.onPress();
    await settle(handle, 2);
    layBody(handle, { width: 1200, height: 700 });
    await settle(handle, 3);
    assert.deepEqual([checks(), overlay(), byTestId(handle, "Pressable", "office-rooms-open").length], [2, 0, 0], "wide again: the column is back");
    layBody(handle, PHONE);
    await settle(handle, 3);
    assert.equal(overlay(), 0, "the list left open does not come back");
  });
});

test("MOB-03 screen narrow: the Activity bar shows the newest line and opens the feed; agent details open as a bottom sheet over it", async () => {
  await withScreen(officeFixture(), async ({ handle, fake }) => {
    layBody(handle, PHONE);
    await settle(handle, 3);
    const bar = () => byTestId(handle, "Pressable", "office-feed-bar");
    assert.equal(bar().length, 1);
    assert.ok(textsOf(handle).includes(str("feedEmpty")));
    fake.emitAgent(agentUpsert(agentPayload("r1", { workspaceId: "w3", status: "running", pendingPermissions: [{ id: "q" }] })));
    await settle(handle, 4);
    assert.ok(textsOf(handle).includes(str("narrowFeedLine", { name: agentName("r1"), what: str("feedPermission") })));
    bar()[0].props.onPress();
    await settle(handle, 2);
    assert.equal(byTestId(handle, "View", "office-feed")[0].props.style.flex, 1, "the open feed spans the screen");
    assert.equal(bar()[0].props.accessibilityState.expanded, true);
    byTestId(handle, "Pressable", "office-feed-row")[0].props.onPress();
    await settle(handle, 3);
    const sheet = byTestId(handle, "View", "office-sheet");
    assert.equal(sheet.length, 1, "a picked line opens the agent as a sheet");
    assert.equal(sheet[0].props.style.height, sheetHeight(PHONE.height));
    assert.equal(byTestId(handle, "View", "office-feed-dock").length, 0, "one bottom panel at a time");
    assert.ok(textsOf(handle).includes(agentName("r1")));
    byTestId(handle, "Pressable", "office-drawer-close")[0].props.onPress();
    await settle(handle, 2);
    assert.equal(byTestId(handle, "View", "office-sheet").length, 0);
    assert.equal(byTestId(handle, "View", "office-feed").length, 0, "picking a line closed the feed");
    assert.equal(bar().length, 1);
  });
});

test("MOB-04 screen narrow: the compact top bar keeps Working and shows the alarms only when set", async () => {
  await withScreen(officeFixture(), async ({ handle }) => {
    layBody(handle, PHONE);
    await settle(handle, 3);
    const texts = textsOf(handle);
    assert.ok(texts.includes(str("counterRunning")));
    assert.ok(texts.includes(str("counterAttention")), "one agent needs the owner in the fixture");
    for (const key of ["counterRooms", "counterTotal", "counterSubAgents", "counterShells", "counterIdle", "counterError"]) assert.ok(!texts.includes(str(key)), key);
    assert.equal(byTestId(handle, "View", "office-topbar")[0].props.style.flexWrap, "wrap");
  });
});

// ---- mobile fit (owner feedback 2026-10-22: sideways swiping through a room wider than the phone is unpleasant)

import { columnSnaps, narrowFit } from "../../plugins/office/client/narrow.ts";

test("MOB-05 narrow fit: one column fills the width on whole device pixels; snaps centre each column", () => {
  assert.deepEqual(narrowFit(390, 3), { zoom: 4, devicePx: 4, factor: 1 / 3 }, "iPhone: 341 of 390 dp, one sprite pixel per device pixel");
  assert.deepEqual(narrowFit(411, 2.625), { zoom: 4, devicePx: 4, factor: 4 / (4 * 2.625) });
  assert.deepEqual(narrowFit(375, 2), { zoom: 2, devicePx: 2, factor: 0.5 }, "a 2x phone: zoom 2, 256 dp");
  assert.deepEqual(narrowFit(430, 3), { zoom: 4, devicePx: 4, factor: 1 / 3 }, "never above the largest sprite zoom");
  assert.deepEqual(narrowFit(390, 1), { zoom: 2, devicePx: 1, factor: 0.5 }, "a 1x narrow window downscales the smallest zoom");
  assert.deepEqual(narrowFit(390, Number.NaN), narrowFit(390, 1));
  assert.deepEqual(narrowFit(Number.NaN, 3), { zoom: 2, devicePx: 1, factor: 1 / 6 });
  assert.deepEqual(columnSnaps(4, 4, 1 / 3, 390), [0, 317, 658, 975]);
  assert.deepEqual(columnSnaps(1, 4, 1 / 3, 390), [0], "a building narrower than the view does not scroll");
  assert.deepEqual(columnSnaps(0, 4, 1 / 3, 390), []);
});

test("MOB-06 screen narrow on a 3x phone: zoom-4 sprites shown at a third, column snaps, no zoom buttons; wide again restores them", async () => {
  globalThis.__officeWindowScale = 3;
  try {
    await withScreen(officeFixture(), async ({ host, handle }) => {
      layBody(handle, PHONE);
      byTestId(handle, "View", "office-viewport")[0].props.onLayout({ nativeEvent: { layout: { width: PHONE.width, height: 600 } } });
      await settle(handle, 8);
      const fitView = byTestId(handle, "View", "office-fit")[0];
      const laidOut = fitView.children.find((c) => c && c.type === "View").props.style;
      const cols = laidOut.width / (16 * TILE * 4);
      assert.ok(Number.isInteger(cols) && cols >= 2, `laid out at zoom 4: ${laidOut.width}`);
      assert.ok(Math.abs(fitView.props.style.width - laidOut.width / 3) < 1e-6, "shown at a third");
      assert.equal(laidOut.transform.at(-1).scale, 1 / 3);
      for (const id of ["office-zoom-in", "office-zoom-out", "office-overview"]) assert.equal(byTestId(handle, "Pressable", id).length, 0, id);
      const inner = handle.find("ScrollView").find((n) => n.props.horizontal);
      assert.deepEqual(inner.props.snapToOffsets, columnSnaps(cols, 4, 1 / 3, PHONE.width));
      const scale4 = [...new Set(spriteKeys(host).filter((k) => scaleOf(k) === 4))];
      assert.ok(scale4.some((k) => k.startsWith("room-layer:")) && scale4.some((k) => k.startsWith("character")), scale4.slice(0, 4).join());
      const failed = scale4.map((k) => one(k)).filter((s) => !s.ok);
      assert.deepEqual(failed, [], "every zoom-4 sprite renders under the PNG cap");
      // A scroll of the shown scene maps back to scene pixels: the east columns load.
      const before = new Set(spriteKeys(host));
      inner.props.onScroll({ nativeEvent: { contentOffset: { x: 634 }, layoutMeasurement: { width: PHONE.width } } });
      await settle(handle, 6);
      assert.ok(spriteKeys(host).some((k) => !before.has(k) && scaleOf(k) === 4), "scrolled columns request their layers");
      layBody(handle, { width: 1200, height: 700 });
      await settle(handle, 6);
      assert.equal(byTestId(handle, "Pressable", "office-zoom-in").length, 1);
      assert.ok(textsOf(handle).includes(str("sceneZoomLevel", { zoom: 2 })), "back to the smallest offered level");
      assert.equal(handle.find("ScrollView").find((n) => n.props.horizontal).props.snapToOffsets, undefined);
    });
  } finally {
    delete globalThis.__officeWindowScale;
  }
});
