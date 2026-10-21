import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { findPath, PathFinder } from "../../plugins/office/client/path/astar.ts";
import { BLOCKED, FREE, MAX_GRID_CELLS, SEAT, WalkGrid, gridFromRows, gridOf } from "../../plugins/office/client/path/grid.ts";
import { AreaBuilder, SEATED_SORT_BIAS, SEAT_FOOT_DY, furnitureBlocks, furnitureIsSeat } from "../../plugins/office/client/layout/builder.ts";
import * as C from "../../plugins/office/client/layout/constants.ts";
import { CAFE_ID, ELEVATOR_CX, LOUNGE_ID, RECEPTION_ID, RESTROOM_ID, layoutCafe, layoutLounge, layoutReception, layoutRestroom } from "../../plugins/office/client/layout/core.ts";
import { CORRIDOR_ID, layoutCorridor } from "../../plugins/office/client/layout/corridor.ts";
import { FURNITURE } from "../../plugins/office/client/layout/defs.ts";
import { buildingRect, columnsFor, corridorRect, inRect, rectPx, slotAt, slotColumn, slotRect, slotSide } from "../../plugins/office/client/layout/geometry.ts";
import { mulberry32 } from "../../plugins/office/client/layout/rng.ts";
import { layoutProjectRoom, roomVariant } from "../../plugins/office/client/layout/room.ts";
import { THEME_COUNT, roomThemeFor } from "../../plugins/office/client/layout/theme.ts";
import { ROOM_ID_PREFIX, assembleBuilding, buildBuilding, coreAreas } from "../../plugins/office/client/layout/building.ts";
import { KIT_DIR } from "../helpers/temp.mjs";

const COMMIT = "faa1a012b5fbf632c66dc6801c5383e53a542406";
const OFFICE_CLIENT = path.join(KIT_DIR, "plugins", "office", "client");

const pt = (x, y) => ({ x, y });
const turns = (start, steps) => {
  let count = 0;
  let prev = start;
  let prevDir = null;
  for (const s of steps) {
    const dir = `${s.x - prev.x},${s.y - prev.y}`;
    if (prevDir !== null && dir !== prevDir) count++;
    prevDir = dir;
    prev = s;
  }
  return count;
};
const open = (w, h) => gridFromRows(Array.from({ length: h }, () => ".".repeat(w)));

// ---- Task 1: walk grid, A* path finder, constants and furniture data

test("OFFC-12 path: an open row gives the steps without the start and with the goal", () => {
  const steps = findPath(gridFromRows(["......"]), pt(0, 0), pt(5, 0));
  assert.equal(steps.length, 5);
  assert.deepEqual(steps[0], pt(1, 0));
  assert.deepEqual(steps[4], pt(5, 0));
  assert.ok(!steps.some((s) => s.x === 0));
});

test("OFFC-12 path: open ground gives a one-turn L shape", () => {
  const steps = findPath(open(5, 4), pt(0, 0), pt(3, 2));
  assert.equal(steps.length, 5);
  assert.deepEqual(steps[steps.length - 1], pt(3, 2));
  assert.equal(turns(pt(0, 0), steps), 1);
});

test("OFFC-12 path: blocked, outside and disconnected goals give null", () => {
  assert.equal(findPath(gridFromRows([".#.", ".#.", ".#."]), pt(0, 0), pt(2, 0)), null);
  const field = gridFromRows(["...", ".#.", "..."]);
  assert.equal(findPath(field, pt(0, 0), pt(1, 1)), null);
  assert.equal(findPath(field, pt(0, 0), pt(3, 0)), null);
  assert.equal(findPath(field, pt(0, 0), pt(9, 9)), null);
  assert.equal(findPath(field, pt(-1, 0), pt(2, 2)), null);
  assert.equal(findPath(field, pt(0, 3), pt(2, 2)), null);
});

test("OFFC-12 path: fractional and NaN coordinates give null instead of a wrong cell", () => {
  const field = open(4, 4);
  assert.equal(findPath(field, pt(0.5, 0), pt(3, 3)), null);
  assert.equal(findPath(field, pt(0, 0), pt(2.5, 1)), null);
  assert.equal(findPath(field, pt(Number.NaN, 0), pt(3, 3)), null);
  assert.equal(findPath(field, pt(0, 0), pt(3, Number.NaN)), null);
});

test("OFFC-12 path: the same tile gives an empty array when walkable and null when blocked", () => {
  const field = gridFromRows(["..#"]);
  assert.deepEqual(findPath(field, pt(1, 0), pt(1, 0)), []);
  assert.equal(findPath(field, pt(2, 0), pt(2, 0)), null);
});

test("OFFC-12 path: a blocked start inside the grid still finds a way out", () => {
  const steps = findPath(gridFromRows(["#..."]), pt(0, 0), pt(3, 0));
  assert.deepEqual(steps, [pt(1, 0), pt(2, 0), pt(3, 0)]);
});

test("OFFC-12 path: seats are avoided when a cheap detour exists and crossed when they are the only way", () => {
  const detour = findPath(gridFromRows([".....", "..s..", "....."]), pt(0, 1), pt(4, 1));
  assert.ok(detour.length > 4);
  assert.ok(!detour.some((s) => s.x === 2 && s.y === 1));
  const corridor = findPath(gridFromRows(["..s.."]), pt(0, 0), pt(4, 0));
  assert.equal(corridor.length, 4);
  assert.ok(corridor.some((s) => s.x === 2));
  const goalSeat = findPath(gridFromRows(["..s"]), pt(0, 0), pt(2, 0));
  assert.deepEqual(goalSeat, [pt(1, 0), pt(2, 0)]);
});

test("OFFC-12 path: repeated calls agree and interleaved grids never reuse stale search state", () => {
  const big = open(60, 60);
  const small = open(3, 3);
  const wide = gridFromRows(["......", "..##..", "......", "......"]);
  const tall = gridFromRows(["....", "....", ".##.", "....", "....", "...."]);
  const first = findPath(big, pt(0, 0), pt(59, 59));
  assert.equal(first.length, 118);
  assert.deepEqual(findPath(big, pt(0, 0), pt(59, 59)), first);
  assert.equal(findPath(small, pt(0, 0), pt(2, 2)).length, 4);
  assert.equal(findPath(big, pt(0, 0), pt(59, 59)).length, 118);
  for (let i = 0; i < 3; i++) {
    const a = findPath(wide, pt(0, 0), pt(5, 3));
    const b = findPath(tall, pt(0, 0), pt(3, 5));
    assert.equal(a.length, 8);
    assert.equal(b.length, 8);
    assert.ok(!a.some((s) => wide.get(s.x, s.y) === BLOCKED));
    assert.ok(!b.some((s) => tall.get(s.x, s.y) === BLOCKED));
  }
  assert.equal(findPath(wide, pt(0, 0), pt(2, 1)), null);
  // a finder built by hand and re-pointed at another grid of the same cell count stays correct
  const finder = new PathFinder(wide);
  const out = [];
  assert.equal(finder.find(0, 0, 5, 3, out), true);
  finder.setGrid(tall);
  assert.equal(finder.find(0, 0, 3, 5, out), true);
  assert.equal(out.length, 16);
});

test("OFFC-12 grid: cells outside are blocked, fill covers the rectangle, set outside is ignored", () => {
  const g = new WalkGrid(4, 3);
  assert.equal(g.get(-1, 0), BLOCKED);
  assert.equal(g.get(4, 0), BLOCKED);
  assert.equal(g.get(0, 3), BLOCKED);
  g.set(9, 9, FREE);
  g.set(-1, 0, FREE);
  assert.ok(g.cells.every((c) => c === BLOCKED));
  g.fill(1, 1, 2, 2, SEAT);
  assert.equal(g.cells.filter((c) => c === SEAT).length, 4);
  assert.equal(g.get(1, 1), SEAT);
  assert.equal(g.get(2, 2), SEAT);
  assert.equal(g.get(0, 0), BLOCKED);
  assert.equal(g.walkable(1, 1), true);
  assert.equal(g.walkable(0, 0), false);
});

test("OFFC-12 grid: nearestWalkable finds the closest tile by ring or null beyond its radius", () => {
  const g = new WalkGrid(5, 5);
  g.set(3, 2, FREE);
  assert.deepEqual(g.nearestWalkable(3, 2), pt(3, 2));
  assert.deepEqual(g.nearestWalkable(0, 0), pt(3, 2));
  assert.equal(g.nearestWalkable(0, 0, 2), null);
  g.set(1, 0, FREE);
  assert.deepEqual(g.nearestWalkable(0, 0), pt(1, 0));
});

test("OFFC-12 grid: reachableFrom marks exactly the 4-connected component", () => {
  const g = gridFromRows(["..#..", "..#..", "..#.."]);
  const seen = g.reachableFrom(0, 0);
  assert.equal(seen.reduce((a, b) => a + b, 0), 6);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) assert.equal(seen[y * 5 + x], x < 2 ? 1 : 0);
  assert.ok(g.reachableFrom(2, 0).every((c) => c === 0));
  const diagonal = gridFromRows([".#", "#."]);
  assert.equal(diagonal.reachableFrom(0, 0).reduce((a, b) => a + b, 0), 1);
});

test("OFFC-12 grid: the constructor refuses bad sizes and accepts exactly the cap", () => {
  for (const [w, h] of [[0, 1], [1, 0], [-1, 3], [3, -1], [1.5, 2], [2, 1.5], [Number.NaN, 2], [2, Number.NaN], [Infinity, 1]]) {
    assert.throws(() => new WalkGrid(w, h), RangeError, `${w}x${h}`);
  }
  assert.equal(MAX_GRID_CELLS, 250000);
  assert.equal(new WalkGrid(500, 500).cells.length, MAX_GRID_CELLS);
  assert.throws(() => new WalkGrid(500, 501), RangeError);
  assert.throws(() => new WalkGrid(MAX_GRID_CELLS + 1, 1), RangeError);
  assert.equal(new WalkGrid(3, 2, 7).version, 7);
});

test("OFFC-12 grid: gridFromRows maps its characters and refuses ragged or unknown input; gridOf returns the grid itself", () => {
  const g = gridFromRows(["#.s", "s.#"], 4);
  assert.deepEqual([...g.cells], [BLOCKED, FREE, SEAT, SEAT, FREE, BLOCKED]);
  assert.equal(g.version, 4);
  assert.throws(() => gridFromRows(["...", ".."]), RangeError);
  assert.throws(() => gridFromRows(["..x"]), RangeError);
  assert.throws(() => gridFromRows([]), RangeError);
  assert.throws(() => gridFromRows([""]), RangeError);
  assert.equal(gridOf({ grid: g }), g);
});

test("OFFC-10 constants: the building measures match the upstream layout", () => {
  assert.deepEqual(
    [C.TILE, C.COL_W, C.ROOM_H, C.CORRIDOR_H, C.CORE_COLS, C.NORTH_Y, C.CORRIDOR_Y, C.SOUTH_Y, C.BUILDING_H, C.DOOR_X, C.DOOR_W],
    [16, 16, 12, 5, 2, 0, 12, 17, 29, 7, 2],
  );
  assert.equal(C.WALK_SPEED, 3.2 * 16);
  assert.equal(C.RUN_SPEED, 6 * 16);
  assert.deepEqual([C.FOOT_DX, C.FOOT_DY], [8, 11]);
});

test("OFFC-10 furniture: 46 kinds with sound footprints, wall items flat, seats walkable", () => {
  const kinds = Object.keys(FURNITURE);
  assert.equal(kinds.length, 46);
  for (const kind of kinds) {
    const def = FURNITURE[kind];
    assert.ok(def.mount === "floor" || def.mount === "wall", kind);
    assert.ok(Number.isInteger(def.footprint.w) && def.footprint.w >= 1, kind);
    if (def.mount === "floor") assert.ok(Number.isInteger(def.footprint.h) && def.footprint.h >= 1, kind);
    else assert.equal(def.footprint.h, 0, kind);
    if (def.seat) {
      assert.equal(def.mount, "floor", kind);
      assert.equal(def.blocks, false, kind);
    }
  }
});

// ---- Task 2: seeded random, themes, geometry, area builder and the four core areas

test("OFFC-10 rng: mulberry32 gives the pinned sequences and equal seeds stay in step", () => {
  const a = mulberry32(1);
  assert.deepEqual([a(), a(), a()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const b = mulberry32(0xdeadbeef);
  assert.deepEqual([b(), b(), b()], [0.9413696140982211, 0.26719574979506433, 0.772033357527107]);
  const x = mulberry32(42);
  const y = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(x(), y());
});

test("OFFC-10 themes: ten themes, seeds wrap and every result is a private copy", () => {
  assert.equal(THEME_COUNT, 10);
  assert.deepEqual(roomThemeFor(0), roomThemeFor(10));
  assert.deepEqual(roomThemeFor(-1), roomThemeFor(9));
  assert.equal(roomThemeFor(9).accent, "#c9713f");
  assert.deepEqual(roomThemeFor(2.7), roomThemeFor(2));
  assert.equal(roomThemeFor(2.7).accent, "#4cae6a");
  assert.deepEqual(roomThemeFor(Number.NaN), roomThemeFor(0));
  assert.notDeepEqual(roomThemeFor(0), roomThemeFor(1));
  const first = roomThemeFor(3);
  const base = first.wall.base;
  first.wall.base = "#000000";
  first.carpet = "#000000";
  assert.equal(roomThemeFor(3).wall.base, base);
  assert.notEqual(roomThemeFor(3).carpet, "#000000");
});

test("OFFC-10 geometry: slots map to columns, sides and rectangles", () => {
  assert.deepEqual([slotColumn(0), slotColumn(1), slotColumn(2)], [2, 2, 3]);
  assert.deepEqual([slotSide(0), slotSide(1), slotSide(2)], ["north", "south", "north"]);
  assert.deepEqual(slotRect(0), { x: 32, y: 0, w: 16, h: 12 });
  assert.deepEqual(slotRect(1), { x: 32, y: 17, w: 16, h: 12 });
  for (let slot = 0; slot < 12; slot++) assert.equal(slotAt(slotColumn(slot), slotSide(slot)), slot);
  assert.equal(columnsFor([]), 3);
  assert.equal(columnsFor([0, 1]), 3);
  assert.equal(columnsFor([2]), 4);
  assert.equal(columnsFor(new Set([5])), 5);
  assert.deepEqual(corridorRect(3), { x: 0, y: 12, w: 48, h: 5 });
  assert.deepEqual(buildingRect(3), { x: 0, y: 0, w: 48, h: 29 });
  assert.deepEqual(rectPx({ x: 2, y: 3, w: 4, h: 5 }), { x: 32, y: 48, w: 64, h: 80 });
  const r = { x: 2, y: 3, w: 4, h: 2 };
  assert.equal(inRect(r, 2, 3), true);
  assert.equal(inRect(r, 5, 4), true);
  assert.equal(inRect(r, 6, 3), false);
  assert.equal(inRect(r, 5, 5), false);
  assert.equal(inRect(r, 1, 3), false);
});

test("OFFC-10 builder: local tiles become absolute pixels with one id sequence per area", () => {
  const b = new AreaBuilder("area-x", "room", { x: 2, y: 3, w: 16, h: 12 });
  assert.equal(b.px(1), 48);
  assert.equal(b.py(2), 80);
  assert.equal(b.px(0.5), 40);
  const desk = b.furn("desk", 1, 1);
  const clock = b.wall("clock", 4);
  const stand = b.spot("stand", 2, 2, "down");
  const stool = b.seat("stool", "stool", 3, 4, "left");
  assert.equal(desk, "area-x#f0:desk");
  assert.equal(clock, "area-x#w1:clock");
  assert.equal(stand.id, "area-x#s2:stand");
  assert.equal(stand.areaId, "area-x");
  assert.deepEqual([stand.tx, stand.ty], [4, 5]);
  assert.deepEqual([stand.x, stand.y], [4 * 16 + 8, 5 * 16 + 11]);
  assert.equal(stool.id, "area-x#s4:stool");
  assert.equal(stool.furnitureId, "area-x#f3:stool");
  assert.equal(stool.seated, true);
  assert.equal(stool.x, b.px(3) + 8);
  assert.equal(stool.y, b.py(5) - SEAT_FOOT_DY);
  assert.equal(stool.sortY, b.py(5) + SEATED_SORT_BIAS);
  const ids = [...b.area.furniture.map((f) => f.id), ...b.area.wallItems.map((w) => w.id), ...b.area.spots.map((s) => s.id)];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(b.area.furniture[0], { id: desk, kind: "desk", variant: undefined, tx: 3, ty: 4, dx: undefined, dy: undefined, order: 0.5, seat: undefined });
  assert.deepEqual([b.area.wallItems[0].cx, b.area.wallItems[0].baseY, b.area.wallItems[0].on], [b.px(4), b.py(2), "face"]);
  b.walk(1, 2, 3, 4).block(0, 0, 1, 1);
  assert.deepEqual(b.area.walkable, [{ x: 3, y: 5, w: 3, h: 4 }]);
  assert.deepEqual(b.area.blocked, [{ x: 2, y: 3, w: 1, h: 1 }]);
  assert.equal(b.build(), b.area);
});

test("OFFC-10 builder: furnitureBlocks and furnitureIsSeat follow the footprint table", () => {
  assert.equal(furnitureBlocks("desk"), true);
  assert.equal(furnitureBlocks("office_chair"), false);
  assert.equal(furnitureIsSeat("sofa"), true);
  assert.equal(furnitureIsSeat("stool"), true);
  assert.equal(furnitureIsSeat("desk"), false);
  for (const [kind, def] of Object.entries(FURNITURE)) {
    if (def.mount === "wall") {
      assert.equal(furnitureBlocks(kind), false, kind);
      assert.equal(furnitureIsSeat(kind), false, kind);
    }
  }
});

test("OFFC-13 core: reception, restroom, cafe and lounge sit in the two core columns", () => {
  const expected = [
    [layoutReception, "reception", RECEPTION_ID, 0, 0],
    [layoutRestroom, "restroom", RESTROOM_ID, 0, 17],
    [layoutCafe, "cafe", CAFE_ID, 16, 0],
    [layoutLounge, "lounge", LOUNGE_ID, 16, 17],
  ];
  assert.deepEqual([RECEPTION_ID, RESTROOM_ID, CAFE_ID, LOUNGE_ID], ["core:reception", "core:restroom", "core:cafe", "core:lounge"]);
  for (const [layout, kind, id, x, y] of expected) {
    const area = layout();
    assert.equal(area.kind, kind);
    assert.equal(area.id, id);
    assert.deepEqual(area.rect, { x, y, w: 16, h: 12 });
    assert.ok(area.walkable.length > 0, id);
    const ids = area.spots.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${id}: spot ids are unique`);
    for (const s of area.spots) {
      assert.equal(s.areaId, id);
      assert.ok(inRect(area.rect, s.tx, s.ty), `${s.id} approach tile inside its area`);
    }
    const again = layout();
    assert.deepEqual(again, area);
    assert.notEqual(again, area);
    assert.notEqual(again.furniture, area.furniture);
  }
});

test("OFFC-13 core: the reception has two elevators and the lounge has a ping-pong pair", () => {
  const reception = layoutReception();
  assert.deepEqual(ELEVATOR_CX, [3, 6.5]);
  assert.deepEqual(reception.wallItems.filter((w) => w.kind === "elevator").map((w) => w.cx), [48, 104]);
  const elevators = reception.spots.filter((s) => s.kind === "elevator");
  assert.deepEqual(elevators.map((s) => s.group), ["elevator:0", "elevator:1"]);
  const pingpong = layoutLounge().spots.filter((s) => s.kind === "pingpong");
  assert.equal(pingpong.length, 2);
  assert.deepEqual(pingpong.map((s) => s.group), ["pingpong", "pingpong"]);
  const talk = [...layoutReception().spots, ...layoutCafe().spots].filter((s) => s.kind === "talk").map((s) => s.group);
  assert.deepEqual(talk, ["talk:reception", "talk:reception", "talk:cafe", "talk:cafe"]);
});

// ---- Task 3: corridor, project room, building assembly, reachability, determinism and source rules

const room = (id, slot, seed = slot + 1) => ({ id, slot, seed });
const three = () => buildBuilding([room("p-alpha", 0, 11), room("p-beta", 1, 22), room("p-gamma", 2, 33)]);
const kindsOf = (b) => b.areas.map((a) => a.kind);
const doorTile = (area) => pt(area.door.x, area.door.y);
const approach = (spot) => pt(spot.tx, spot.ty);

test("OFFC-13 corridor: two talk spots per column in numbered groups", () => {
  const c3 = layoutCorridor(3);
  assert.equal(c3.kind, "corridor");
  assert.equal(c3.id, CORRIDOR_ID);
  assert.equal(CORRIDOR_ID, "core:corridor");
  assert.deepEqual(c3.rect, { x: 0, y: 12, w: 48, h: 5 });
  const talk3 = c3.spots.filter((s) => s.kind === "talk");
  assert.equal(talk3.length, 6);
  assert.deepEqual([...new Set(talk3.map((s) => s.group))], ["talk:corridor:0", "talk:corridor:1", "talk:corridor:2"]);
  assert.equal(layoutCorridor(4).spots.filter((s) => s.kind === "talk").length, 8);
  assert.deepEqual(layoutCorridor(3), c3);
});

test("OFFC-10 room: the seed variants are deterministic and the corners never match", () => {
  const lefts = new Set(["rest", "print", "green"]);
  const rights = new Set(["standdesk", "stands", "green"]);
  const meetings = new Set(["table", "round", "lounge"]);
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) {
    const v = roomVariant(seed);
    assert.deepEqual(roomVariant(seed), v);
    assert.notEqual(v.left, v.right, `seed ${seed}`);
    assert.ok(lefts.has(v.left) && rights.has(v.right) && meetings.has(v.meeting), `seed ${seed}`);
    seen.add(`${v.mirror}/${v.meeting}`);
  }
  assert.equal(seen.size, 6);
});

test("OFFC-10 room: a north and a south project room get their rect, door, desks and sign", () => {
  const theme = roomThemeFor(3);
  for (const [slot, side] of [[0, "north"], [1, "south"], [2, "north"], [7, "south"]]) {
    const area = layoutProjectRoom({ id: `room:r${slot}`, slot, seed: 40 + slot }, theme);
    const rect = slotRect(slot);
    assert.equal(area.kind, "room");
    assert.equal(area.id, `room:r${slot}`);
    assert.deepEqual(area.rect, rect);
    assert.equal(area.side, side);
    assert.deepEqual(area.door, side === "north" ? { x: rect.x + 7, y: rect.y + 11, w: 2, h: 1 } : { x: rect.x + 7, y: rect.y, w: 2, h: 2 });
    const desks = area.spots.filter((s) => s.kind === "desk");
    assert.equal(desks.length, 6);
    assert.deepEqual(desks.map((s) => s.rank).sort(), [0, 1, 2, 3, 4, 5]);
    assert.equal(desks.filter((s) => s.side === "N").length, 3);
    assert.equal(desks.filter((s) => s.side === "S").length, 3);
    for (const d of desks) assert.ok(area.furniture.some((f) => f.id === d.deskId), `${d.id} names a desk of the same area`);
    assert.equal(area.wallItems.find((w) => w.id === area.signId).kind, "sign");
    const ids = area.spots.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(layoutProjectRoom({ id: `room:r${slot}`, slot, seed: 40 + slot }, theme), area);
  }
});

test("OFFC-10 building: an empty list still gives the core, the corridor and a 3-column grid", () => {
  const b = buildBuilding([]);
  assert.equal(b.cols, 3);
  assert.deepEqual(b.rect, { x: 0, y: 0, w: 48, h: 29 });
  assert.deepEqual(b.areas.map((a) => a.id), [RECEPTION_ID, RESTROOM_ID, CAFE_ID, LOUNGE_ID, CORRIDOR_ID]);
  assert.deepEqual(b.rooms, []);
  assert.deepEqual([b.grid.w, b.grid.h], [48, 29]);
  assert.equal(b.core.length, 4);
  assert.equal(gridOf(b), b.grid);
});

test("OFFC-10 building: columns grow with the highest slot and gaps create no areas", () => {
  const b = three();
  assert.equal(b.cols, 4);
  assert.deepEqual([b.grid.w, b.grid.h], [64, 29]);
  assert.deepEqual(b.rooms.map((r) => r.id), ["room:p-alpha", "room:p-beta", "room:p-gamma"]);
  assert.deepEqual(b.areas.slice(5), b.rooms);
  const gap = buildBuilding([room("a", 0), room("b", 5)]);
  assert.equal(gap.cols, 5);
  assert.equal(gap.rooms.length, 2);
  assert.equal(gap.areas.length, 7);
  assert.deepEqual([gap.grid.w, gap.grid.h], [80, 29]);
  assert.deepEqual(gap.rooms[1].rect, slotRect(5));
  assert.equal(assembleBuilding(3, [], 9).grid.version, 9);
  assert.equal(buildBuilding([], 5).grid.version, 5);
});

test("OFFC-13 areas: reception, cafe, lounge, restroom and corridor exist for every input", () => {
  for (const b of [three(), buildBuilding([])]) {
    const kinds = kindsOf(b);
    for (const kind of ["reception", "restroom", "cafe", "lounge", "corridor"]) assert.equal(kinds.filter((k) => k === kind).length, 1, kind);
    assert.equal(b.areas.find((a) => a.kind === "reception").spots.filter((s) => s.kind === "elevator").length, 2);
  }
  assert.equal(kindsOf(three()).filter((k) => k === "room").length, 3);
  assert.equal(kindsOf(buildBuilding([])).filter((k) => k === "room").length, 0);
});

test("OFFC-14 ids: room ids are opaque keys behind the room: prefix", () => {
  assert.equal(ROOM_ID_PREFIX, "room:");
  const ids = ["../x", "__proto__", "a b", "core:reception", "constructor", ""];
  const b = buildBuilding(ids.map((id, i) => room(id, i)));
  assert.deepEqual(b.rooms.map((r) => r.id), ids.map((id) => ROOM_ID_PREFIX + id));
  const areaIds = b.areas.map((a) => a.id);
  assert.equal(new Set(areaIds).size, areaIds.length);
  assert.equal(b.areas.filter((a) => a.kind === "reception").length, 1);
  assert.equal(b.areas.find((a) => a.id === RECEPTION_ID).kind, "reception");
  for (const r of b.rooms) {
    for (const s of r.spots) assert.equal(s.areaId, r.id);
    assert.ok(r.furniture.every((f) => f.id.startsWith(r.id + "#")));
  }
});

test("OFFC-14 input: bad slots, seeds and ids throw RangeError before anything is built", () => {
  const bad = [
    [room("a", 0), room("a", 1)],
    [room("a", -1)],
    [room("a", 1.5)],
    [room("a", Number.NaN)],
    [room("a", Infinity)],
    [room("a", 0), room("b", 0)],
    [room("a", 0, Number.NaN)],
    [room("a", 0, Infinity)],
    [{ id: 7, slot: 0, seed: 1 }],
    [room("a", 100000)],
  ];
  for (const rooms of bad) assert.throws(() => buildBuilding(rooms), RangeError, JSON.stringify(rooms));
});

test("OFFC-12 reachability: every spot approach tile is walkable on the building grid", () => {
  const b = three();
  assert.ok(b.spots.length > 100);
  for (const s of b.spots) assert.ok(b.grid.walkable(s.tx, s.ty), `${s.id} approach tile (${s.tx}, ${s.ty})`);
  const bigger = buildBuilding([room("a", 0, 1), room("b", 1, 2), room("c", 2, 3), room("d", 3, 4), room("e", 4, 5), room("f", 5, 6)]);
  for (const s of bigger.spots) assert.ok(bigger.grid.walkable(s.tx, s.ty), `${s.id}`);
});

test("OFFC-12 reachability: every area and room is reachable from every project room door", () => {
  for (const b of [three(), buildBuilding([room("a", 0, 7), room("b", 5, 8), room("c", 6, 9)])]) {
    const kinds = new Set();
    for (const home of b.rooms) {
      for (const target of b.areas) {
        if (target === home) continue;
        const first = target.spots[0];
        assert.ok(first, `${target.id} has a spot`);
        const steps = findPath(b.grid, doorTile(home), approach(first));
        assert.ok(steps, `${home.id} door to ${target.id}`);
        assert.deepEqual(steps.length === 0 ? approach(first) : steps[steps.length - 1], approach(first));
        kinds.add(target.kind);
      }
    }
    for (const kind of ["reception", "restroom", "cafe", "lounge", "corridor", "room"]) assert.ok(kinds.has(kind), kind);
  }
});

test("OFFC-12 reachability: handoff walks connect desks of different rooms and seats to their own door", () => {
  const b = three();
  const desks = (r) => r.spots.filter((s) => s.kind === "desk");
  for (const from of b.rooms) {
    for (const to of b.rooms) {
      if (from === to) continue;
      assert.ok(findPath(b.grid, approach(desks(from)[0]), approach(desks(to)[0])), `${from.id} desk to ${to.id} desk`);
    }
  }
  for (const r of b.rooms) {
    const seats = r.spots.filter((s) => s.kind === "stool" || s.kind === "nook");
    assert.ok(seats.length > 0, `${r.id} has stool or nook spots`);
    for (const s of seats) assert.ok(findPath(b.grid, approach(s), doorTile(r)), `${s.id} to its door`);
  }
});

const canonical = (b) => JSON.stringify({ areas: b.areas, spots: b.spots, grid: Buffer.from(b.grid.cells).toString("hex") });

test("OFFC-10 determinism: equal input gives deep-equal buildings that share no object", () => {
  const a = three();
  const b = three();
  assert.deepEqual(a, b);
  assert.notEqual(a.core[0], b.core[0]);
  assert.notEqual(a.grid, b.grid);
  a.core[0].furniture.push({ id: "extra", kind: "desk", tx: 0, ty: 0, order: 0 });
  a.areas[0].spots.length = 0;
  assert.equal(b.core[0].furniture.some((f) => f.id === "extra"), false);
  assert.ok(b.core[0].spots.length > 0);
  assert.ok(coreAreas()[0].spots.length > 0);
  assert.equal(canonical(three()), canonical(three()));
});

test("OFFC-10 determinism: the pinned fixture keeps its layout digest", () => {
  // changes only with a deliberate layout change
  const digest = crypto.createHash("sha256").update(canonical(three())).digest("hex");
  assert.equal(digest, "73ba81c451d29ee58860fef4b5a6be32e24e430566e212e6a066a93dd25535d0");
});

test("OFFC-10 source rules: layout and path are pure, header-marked, .ts-only and import-closed", () => {
  const dirs = { layout: path.join(OFFICE_CLIENT, "layout"), path: path.join(OFFICE_CLIENT, "path") };
  const files = [];
  for (const [name, dir] of Object.entries(dirs)) {
    for (const f of fs.readdirSync(dir)) {
      assert.ok(f.endsWith(".ts"), `${name}/${f} is a .ts file`);
      files.push({ name, file: path.join(dir, f), text: fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n") });
    }
  }
  assert.equal(files.filter((f) => f.name === "layout").length, 11);
  assert.equal(files.filter((f) => f.name === "path").length, 2);
  const header = new RegExp(`^// Port of habblaud (?:client/src/|shared/)\\S+\\.ts @ ${COMMIT} \\(MIT; notice in LICENSES/habblaud-MIT\\.txt, added by plan 07-05\\)\\.$`);
  const forbidden = [
    /child_process/,
    /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|createWriteStream|chmod|truncate|utimes|cp|rm)(Sync)?\s*\(/,
    /\.(send|run|archive|create|respondToPermission|setTitle|setModel|cancel|detach|append|waitForFinish)\s*\(/,
    /fs\.open\([^)]*,\s*"(?!r")|workspaces\.open\s*\(/,
    /\b(spawnProcess|execCommand|terminateProcess)\b/,
    /\bfs\.promises\.(write|append|mkdir|rm|unlink|rename)/,
    /\b(setTimeout|setInterval|requestAnimationFrame|fetch|XMLHttpRequest|WebSocket|HTMLCanvasElement|CanvasRenderingContext2D|localStorage)\b/,
    /\bMath\.random\b|\bDate\b|\bperformance\b/,
  ];
  for (const { name, file, text } of files) {
    const rel = path.relative(KIT_DIR, file);
    assert.match(text.split("\n")[0], header, `${rel}: header`);
    const code = text.replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /constructor\s*\([^)]*\b(?:public|private|protected|readonly)\s+\w/, `${rel}: parameter property`);
    assert.doesNotMatch(code, /^\s*(?:export\s+)?(?:const\s+)?enum\s+\w/m, `${rel}: enum`);
    assert.doesNotMatch(code, /^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+\w/m, `${rel}: namespace`);
    assert.doesNotMatch(code, /\bimport\s*\(|\brequire\s*\(|from\s+'/, `${rel}: dynamic or single-quoted import`);
    assert.doesNotMatch(text, /<div\b|<span\b|<svg\b|\bdocument\.|\bwindow\./, `${rel}: DOM`);
    for (const re of forbidden) assert.doesNotMatch(code, re, `${rel}: ${re}`);
    for (const m of code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?"([^"]+)"/g)) {
      const spec = m[1];
      assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${rel}: bare or absolute import ${spec}`);
      assert.ok(spec.endsWith(".ts"), `${rel}: import ${spec} needs the .ts extension`);
      const target = path.resolve(path.dirname(file), spec);
      const allowed = name === "path" ? [dirs.path] : [dirs.layout, dirs.path];
      assert.ok(allowed.some((d) => path.dirname(target) === d), `${rel}: import ${spec} leaves ${allowed.map((d) => path.basename(d)).join(" and ")}`);
      assert.ok(fs.existsSync(target), `${rel}: import ${spec} resolves`);
    }
  }
});
