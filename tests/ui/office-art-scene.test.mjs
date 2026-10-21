import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FURNITURE, FURNITURE_KINDS, isFurnitureKind } from "../../plugins/office/server/art/furniture/types.ts";
import { hash32, mulberry32 } from "../../plugins/office/server/art/furniture/hash.ts";
import { rngOf } from "../../plugins/office/server/art/furniture/kit.ts";
import { normalizeFurniture, renderFurniture, SEED_VARIATIONS } from "../../plugins/office/server/art/furniture/index.ts";
import { CHUNK_PX, CHUNK_TILES, floorChunk } from "../../plugins/office/server/art/surfaces/floor.ts";
import { renderRug } from "../../plugins/office/server/art/surfaces/rug.ts";
import { BASEBOARD_H, WALL_CAP_H, WALL_FACE_H, capColor, southWallTile, wallFaceTile } from "../../plugins/office/server/art/surfaces/walls.ts";
import { FLOOR_KINDS, WALL_PATTERNS } from "../../plugins/office/server/art/surfaces/types.ts";
import { THEME_COUNT, themeFor } from "../../plugins/office/server/art/theme.ts";
import { tintBuf, NIGHT_MULTIPLY, FIXED_DAY_HOUR, FIXED_NIGHT_HOUR, hourForTint } from "../../plugins/office/server/art/tint.ts";
import * as roomsModule from "../../plugins/office/server/art/rooms.ts";
import { ROOM_ART_CACHE_LIMITS, ROOM_LAYER_LIMITS, renderRoomLayer } from "../../plugins/office/server/art/rooms.ts";
import { PixelBuf } from "../../plugins/office/server/art/core/pixbuf.ts";
import { pixelText, pixelTextWidth } from "../../plugins/office/server/art/pixelfont.ts";
import { SCREEN_FRAMES, SCREEN_MODES, boardVariant, clockVariant, screenVariant, windowVariant } from "../../plugins/office/server/art/variants.ts";
import {
  SEASONAL_THEMES,
  paintElevatorOrnament,
  paintSeasonalLights,
  paintSeasonalRug,
  paintSeasonalWall,
  paintSeasonalWindow,
  renderSeasonalProp,
  seasonProps,
  seasonalRugColor,
  seasonalWallStyle,
} from "../../plugins/office/server/art/seasonal.ts";
import { TINT_LEVELS, TINT_MAX_LEVELS, TINT_MIN_LEVELS } from "../../plugins/office/shared/tint.ts";
import { TILE, ZOOM_LEVELS } from "../../plugins/office/shared/art-types.ts";
import { encodePng } from "../../plugins/office/server/png.ts";
import { PNG_MAX_DIMENSION, SPRITE_PNG_MAX_BYTES } from "../../plugins/office/server/limits.ts";
import { KIT_DIR } from "../helpers/temp.mjs";

// Fixtures and pixel helpers shared by the tests below (kept in this file: every file of the plan must be owned by it).
// Fixtures and buffer helpers for the scene art tests (07-05): one small area per area kind and pixel comparisons.

const sha = (b) => crypto.createHash("sha256").update(b.data).digest("hex");

const PLAIN = { base: "#eef1f4", trim: "#9fb0c4", pattern: "plain" };

// Pixel offsets where two equal-sized buffers differ.
function diffPixels(a, b) {
  const out = [];
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
      const p = i / 4;
      out.push({ x: p % a.w, y: Math.floor(p / a.w) });
    }
  }
  return out;
}

const insideAny = (p, rects) => rects.some((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);

// Area of a kind with a 16 by 12 tile rect at the world origin, a full floor, a face wall and a south wall.
function area(kind, extra) {
  return {
    kind,
    rect: { x: 0, y: 0, w: 16, h: 12 },
    floors: [{ kind: "carpet", x: 0, y: 0, w: 256, h: 192, seed: 3 }],
    rugs: [],
    walls: [
      { kind: "face", x: 0, y: 0, w: 256, style: PLAIN, doorways: [{ x: 224, w: 24 }] },
      { kind: "south", x: 0, y: 176, w: 256, style: PLAIN },
    ],
    wallItems: [],
    furniture: [],
    ...extra,
  };
}

// One fixture per area kind, with what the plan lists for it.
function fixtures() {
  return {
    room: area("room", {
      rugs: [{ x: 48, y: 112, w: 96, h: 48, color: "#3f6f9a", seed: 2 }],
      wallItems: [
        { id: "room#sign", kind: "sign", cx: 40, baseY: 32, on: "face" },
        { id: "room#window", kind: "window", cx: 100, baseY: 32, on: "face" },
        { id: "room#board", kind: "whiteboard", cx: 160, baseY: 32, on: "face" },
        { id: "room#clock", kind: "clock", cx: 205, baseY: 32, on: "face" },
      ],
      furniture: [
        { id: "room#desk1", kind: "desk", tx: 3, ty: 4 },
        { id: "room#chair1", kind: "office_chair", tx: 3, ty: 6 },
        { id: "room#desk2", kind: "desk", tx: 9, ty: 4 },
        { id: "room#chair2", kind: "office_chair", tx: 10, ty: 6 },
      ],
    }),
    reception: area("reception", {
      wallItems: [
        { id: "rec#lift1", kind: "elevator", cx: 40, baseY: 32, on: "face" },
        { id: "rec#lift2", kind: "elevator", cx: 90, baseY: 32, on: "face" },
        { id: "rec#sign", kind: "sign", cx: 170, baseY: 32, on: "face" },
      ],
      furniture: [{ id: "rec#desk", kind: "reception_desk", tx: 6, ty: 6 }],
    }),
    cafe: area("cafe", {
      floors: [{ kind: "wood", x: 0, y: 0, w: 256, h: 192, seed: 4 }],
      wallItems: [{ id: "cafe#sign", kind: "sign", cx: 128, baseY: 32, on: "face" }],
      furniture: [
        { id: "cafe#c1", kind: "counter", tx: 2, ty: 3 },
        { id: "cafe#c2", kind: "counter_sink", tx: 3, ty: 3 },
        { id: "cafe#c3", kind: "coffee_machine", tx: 4, ty: 3 },
        { id: "cafe#t", kind: "cafe_table", tx: 8, ty: 7 },
        { id: "cafe#ch", kind: "cafe_chair", variant: "up", tx: 8, ty: 8 },
      ],
    }),
    lounge: area("lounge", {
      wallItems: [
        { id: "lounge#tv", kind: "tv", cx: 80, baseY: 32, on: "face" },
        { id: "lounge#sign", kind: "sign", cx: 170, baseY: 32, on: "face" },
      ],
      furniture: [
        { id: "lounge#sofa1", kind: "sofa", variant: "down", tx: 3, ty: 5 },
        { id: "lounge#sofa2", kind: "sofa", variant: "up", tx: 3, ty: 9 },
        { id: "lounge#arcade", kind: "arcade", tx: 12, ty: 3 },
      ],
    }),
    restroom: area("restroom", {
      floors: [{ kind: "tile_white", x: 0, y: 0, w: 256, h: 192, seed: 5 }],
      wallItems: [
        { id: "wc#mirror", kind: "mirror", cx: 180, baseY: 32, on: "face" },
        { id: "wc#sign", kind: "sign", cx: 60, baseY: 32, on: "face" },
      ],
      furniture: [
        { id: "wc#s1", kind: "toilet_stall", tx: 2, ty: 4 },
        { id: "wc#s2", kind: "toilet_stall", tx: 5, ty: 4 },
        { id: "wc#sink", kind: "sink", tx: 11, ty: 3 },
        { id: "wc#plant", kind: "plant_tall", tx: 14, ty: 9 },
      ],
    }),
    corridor: {
      kind: "corridor",
      rect: { x: 0, y: 12, w: 40, h: 5 },
      floors: [{ kind: "concrete", x: 0, y: 192, w: 640, h: 80, seed: 6 }],
      rugs: [],
      walls: [{ kind: "face", x: 0, y: 192, w: 640, style: PLAIN }],
      wallItems: [{ id: "cor#sign", kind: "sign", cx: 300, baseY: 224, on: "face" }],
      furniture: [
        { id: "cor#bench", kind: "bench", tx: 4, ty: 14 },
        { id: "cor#plant", kind: "plant_tall", tx: 15, ty: 14 },
        { id: "cor#desk", kind: "desk", tx: 23, ty: 14 },
        { id: "cor#chair", kind: "office_chair", tx: 24, ty: 15 },
      ],
    },
  };
}

// Area with plants, a rug and wall decoration: what the seasonal themes change.
function seasonalFixture(kind = "room") {
  return area(kind, {
    rugs: [{ x: 32, y: 96, w: 96, h: 48, color: "#3f6f9a", seed: 1 }],
    wallItems: [{ id: "sea#lift", kind: "elevator", cx: 60, baseY: 32, on: "face" }],
    furniture: [
      { id: "sea#tall1", kind: "plant_tall", tx: 12, ty: 5 },
      { id: "sea#tall2", kind: "plant_tall", tx: 14, ty: 5 },
      { id: "sea#small", kind: "plant_small", tx: 10, ty: 8 },
    ],
  });
}

// The 07-02 client copies, when present (parity and real-layout tests note a skip otherwise).
const CLIENT_LAYOUT = path.join(KIT_DIR, "plugins", "office", "shared", "layout");
const clientImport = async (file) => (fs.existsSync(path.join(CLIENT_LAYOUT, file)) ? import(new URL(`../../plugins/office/shared/layout/${file}`, import.meta.url).href) : null);
const clientDefs = await clientImport("defs.ts");
const clientTheme = await clientImport("theme.ts");
const clientBuilding = await clientImport("building.ts");

const PIN = "faa1a012b5fbf632c66dc6801c5383e53a542406";
const norm = (t) => t.replace(/\r\n/g, "\n");
const OFFICE = path.join(KIT_DIR, "plugins", "office");

function artFiles() {
  const art = path.join(OFFICE, "server", "art");
  const own = ["furniture", "surfaces"].flatMap((d) => fs.readdirSync(path.join(art, d)).map((f) => path.join(art, d, f)));
  return [...own, ...["theme", "seasonal", "pixelfont", "variants", "rooms", "tint"].map((n) => path.join(art, `${n}.ts`)).filter((f) => fs.existsSync(f))];
}

test("OFFC-07 furniture table", () => {
  assert.equal(FURNITURE_KINDS.length, 46);
  assert.deepEqual([...FURNITURE_KINDS], Object.keys(FURNITURE));
  for (const k of FURNITURE_KINDS) {
    const d = FURNITURE[k];
    if (d.mount === "floor") assert.ok(Number.isInteger(d.footprint.w) && d.footprint.w >= 1 && d.footprint.h >= 1, k);
    else assert.equal(d.footprint.h, 0, k);
    if (d.seat) assert.ok(d.mount === "floor" && !d.blocks, k);
  }
  assert.deepEqual(FURNITURE.desk.variants, ["wood", "white", "dark"]);
  assert.equal(FURNITURE.poster.variants.length, 6);
  assert.equal(FURNITURE.elevator.states, 5);
  assert.ok(isFurnitureKind("desk"));
  for (const bad of ["bogus", "__proto__", "constructor", "toString"]) assert.ok(!isFurnitureKind(bad), bad);
});

test("OFFC-07 hash", () => {
  assert.equal(hash32(""), 0x811c9dc5);
  assert.equal(hash32("a"), 0xe40c292c);
  assert.equal(hash32("foobar"), 0xbf9cf968);
  const a = mulberry32(1);
  assert.deepEqual([a(), a(), a()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const b = mulberry32(0xdeadbeef);
  assert.deepEqual([b(), b(), b()], [0.9413696140982211, 0.26719574979506433, 0.772033357527107]);
  const c = mulberry32(5);
  const d = mulberry32(5);
  assert.deepEqual([c(), c(), c()], [d(), d(), d()]);
  const r1 = rngOf(3, 7);
  const r2 = rngOf(3, 7);
  const r3 = rngOf(3, 8);
  const seq = (r) => [r(), r(), r()];
  assert.deepEqual(seq(r1), seq(r2));
  assert.notDeepEqual(seq(rngOf(3, 7)), seq(r3));
});

test("OFFC-07 floor", () => {
  const opts = { seed: 7, tint: "#c9d1dc", tint2: "#bdc6d3" };
  const g = floorChunk("carpet", 0, 0, opts);
  assert.equal(CHUNK_PX, 128);
  assert.equal(g.w, 128);
  // Changes only with a deliberate art change.
  assert.equal(sha(g), "12061d8ff53cd7257bbbf9caa02f886441449e99cdc5be5b23459157400ebe0f");
  for (const k of ["carpet", "wood", "marble", "concrete"]) assert.notEqual(sha(floorChunk(k, 0, 0, { seed: 1 })), sha(floorChunk(k, 0, 0, { seed: 2 })), k);
  assert.equal(CHUNK_TILES, 8);
  assert.equal(FLOOR_KINDS.length, 9);
  for (const k of FLOOR_KINDS) {
    const c = floorChunk(k, 0, 0, { seed: 1 });
    assert.equal(`${c.w}x${c.h}`, "128x128", k);
    assert.equal(sha(c), sha(floorChunk(k, 0, 0, { seed: 1 })), k);
  }
  for (const k of ["wood", "marble"]) assert.notEqual(sha(floorChunk(k, 0, 0, { seed: 1 })), sha(floorChunk(k, 1, 0, { seed: 1 })), k);
  assert.notEqual(sha(floorChunk("carpet", 0, 0, { seed: 7, tint: "#aa3344" })), sha(floorChunk("carpet", 0, 0, { seed: 7 })));
});

test("OFFC-07 rug", () => {
  const r = renderRug(48, 32, "#a93649", 1);
  // Changes only with a deliberate art change.
  assert.equal(sha(r), "69cfc6818aa7e671e9e5723c61ebbf8df825fc7e12860d372c71ea7458e12a59");
  assert.equal(sha(renderRug(48, 32, "#a93649", 3)), sha(renderRug(48, 32, "#a93649", 0)));
  assert.equal(`${r.w}x${r.h}`, "48x32");
  for (const [x, y] of [[0, 0], [47, 0], [0, 31], [47, 31]]) assert.equal(r.data[(y * r.w + x) * 4 + 3], 0, `corner ${x},${y}`);
  const shas = [0, 1, 2].map((n) => sha(renderRug(48, 32, "#a93649", n)));
  assert.equal(new Set(shas).size, 3);
  assert.equal(sha(renderRug(48, 32, "#a93649", -1)), sha(renderRug(48, 32, "#a93649", 1)));
});

test("OFFC-07 walls", () => {
  assert.equal(WALL_FACE_H, 32);
  assert.equal(WALL_CAP_H, 4);
  assert.equal(BASEBOARD_H, 3);
  assert.equal(WALL_PATTERNS.length, 7);
  const faces = new Set();
  for (const pattern of WALL_PATTERNS) {
    const style = { base: "#eef1f4", trim: "#9fb0c4", pattern };
    for (let v = 0; v < 4; v++) {
      for (let col = 0; col < 2; col++) {
        const f = wallFaceTile(style, v, col);
        assert.equal(`${f.w}x${f.h}`, "16x32", `${pattern} ${v} ${col}`);
        assert.equal(sha(f), sha(wallFaceTile(style, v, col)));
        const s = southWallTile(style, col + v);
        assert.equal(`${s.w}x${s.h}`, "16x16", pattern);
        assert.equal(sha(s), sha(southWallTile(style, col + v)));
      }
    }
    faces.add(sha(wallFaceTile(style, 0, 0)));
  }
  assert.equal(faces.size, WALL_PATTERNS.length);
  const base = { base: "#eef1f4", trim: "#9fb0c4", pattern: "plain" };
  assert.notEqual(capColor({ ...base, exterior: true }), capColor(base));
  // Changes only with a deliberate art change.
  assert.equal(sha(wallFaceTile(themeFor(0).wall, 0, 0)), "a5b431b28cdd9511bfc42474bccef73a7a724fc3d8b9c3e14580225890b41088");
});

test("OFFC-07 theme", () => {
  assert.equal(THEME_COUNT, 10);
  assert.deepEqual(themeFor(0), themeFor(10));
  assert.deepEqual(themeFor(-1), themeFor(9));
  assert.deepEqual(themeFor(2.7), themeFor(2));
  const t = themeFor(4);
  const before = JSON.stringify(t);
  t.wall.base = "#000000";
  t.accent = "#000000";
  assert.equal(JSON.stringify(themeFor(4)), before);
});

test("OFFC-20 licence and notice", () => {
  const lic = norm(fs.readFileSync(path.join(KIT_DIR, "LICENSES", "habblaud-MIT.txt"), "utf8"));
  assert.ok(lic.startsWith("MIT License"));
  assert.match(lic, /^Copyright \(c\) 2026 /m);
  assert.match(lic, /Permission is hereby granted, free of charge/);
  const notice = norm(fs.readFileSync(path.join(KIT_DIR, "NOTICE.md"), "utf8"));
  for (const s of ["habblaud", PIN, "LICENSES/habblaud-MIT.txt", "## Harness v2 (Apache License 2.0)", "## GSD core (MIT)"]) assert.ok(notice.includes(s), s);
});

test("OFFC-07 source rules", () => {
  const header = new RegExp(`^// Port of habblaud (client/src|shared)/\\S+( and (client/src|shared)/\\S+)* @ ${PIN} \\(MIT; notice in LICENSES/habblaud-MIT\\.txt\\)\\.$`);
  for (const f of artFiles()) {
    const text = norm(fs.readFileSync(f, "utf8"));
    assert.match(text.split("\n")[0], header, f);
    const code = text.replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /constructor\s*\(\s*(private|public|protected|readonly)\b/, f);
    assert.doesNotMatch(code, /^\s*(export\s+)?(const\s+)?enum\b|^\s*(export\s+)?namespace\b/m, f);
    const art = path.join(OFFICE, "server", "art");
    const shared = path.join(OFFICE, "shared");
    const banned = ["character", "icons", "hash", "spike"].map((n) => path.join(art, n));
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      assert.ok(spec.startsWith("."), `${f}: bare specifier ${spec}`);
      assert.ok(spec.endsWith(".ts"), `${f}: ${spec}`);
      const target = path.resolve(path.dirname(f), spec);
      const inArt = target.startsWith(art + path.sep) && !banned.some((b) => target === `${b}.ts` || target.startsWith(b + path.sep));
      const okShared = [path.join(shared, "art-types.ts"), path.join(shared, "tint.ts")].includes(target);
      assert.ok(inArt || okShared, `${f}: import outside the allow-list ${spec}`);
    }
    assert.doesNotMatch(code, /Math\.random|\bDate\b|setTimeout|setInterval|node:|\bfs\b|\bprocess\b|\bfetch\(|HTMLCanvasElement|CanvasRenderingContext2D|\bdocument\.|\bwindow\./, f);
    assert.doesNotMatch(code, /\.(send|run|archive|create|append)\s*\(/, f);
    assert.doesNotMatch(path.basename(f), /editor|permission|message|terminal|docker|codex|world|dictation|delivery|timelapse|character|icons/i, f);
  }
  assert.doesNotMatch(norm(fs.readFileSync(path.join(OFFICE, "server", "art", "rooms.ts"), "utf8")), /pixelfont/);
  assert.ok(artFiles().length >= 15);
});

test("OFFC-07 furniture render", () => {
  for (const k of FURNITURE_KINDS) {
    for (const v of FURNITURE[k].variants ?? [undefined]) {
      for (let s = 0; s < (FURNITURE[k].states ?? 1); s++) {
        const f = renderFurniture(k, v, s, 0);
        const b = f.base.buf.bounds();
        assert.ok(b && b.x === 0 && b.y === 0 && b.w === f.base.buf.w && b.h === f.base.buf.h, `${k} trimmed`);
        assert.equal(sha(f.base.buf), sha(renderFurniture(k, v, s, 0).base.buf), k);
      }
    }
  }
});

test("OFFC-07 furniture seeds", () => {
  assert.deepEqual(SEED_VARIATIONS, { desk: 6, desk_back: 4, bookshelf: 4, binder_shelf: 4, meeting_table: 2, shelf_wall: 3, painting: 2, coffee_table: 2, plant_small: 3, plant_tall: 3 });
  assert.equal(sha(renderFurniture("stool", undefined, 0, 0).base.buf), sha(renderFurniture("stool", undefined, 0, 5).base.buf));
});

test("OFFC-07 furniture normaliser", () => {
  assert.deepEqual(normalizeFurniture("desk", "nope", 99, -3), { variant: "wood", state: 0, vseed: 3 });
  assert.equal(normalizeFurniture("elevator", undefined, 9).state, 4);
  assert.equal(normalizeFurniture("toilet_stall", undefined, 1.9).state, 1);
  assert.equal(normalizeFurniture("stool").variant, undefined);
});

test("OFFC-07 furniture golden", () => {
  // Each changes only with a deliberate art change.
  assert.equal(sha(renderFurniture("desk", "wood", 0, 0).base.buf), "05648c3e41a357824c1a0cb664351bb929956f2803acb1e0bf9022b9b0ead76b");
  assert.equal(sha(renderFurniture("sofa", "down", 0, 0).base.buf), "57b9d54b779b7ed609278f2082c0fbbe0689ff114d29ed867f35c1ca9090fdaf");
  assert.equal(sha(renderFurniture("elevator", undefined, 0, 0).base.buf), "9016a265ff19e1ba092326d9bbe2a7cdcbfa17c2e1b666f47f63901cf3e6385b");
});

test("OFFC-17 tint", () => {
  const src = renderFurniture("desk", "wood", 0, 0).base.buf;
  const before = sha(src);
  const t0 = tintBuf(src, 0, 3);
  assert.notEqual(t0, src);
  assert.equal(sha(t0), before);
  const last = tintBuf(src, 2, 3);
  for (let i = 0; i < src.data.length; i += 4) {
    assert.equal(last.data[i + 3], src.data[i + 3]);
    if (src.data[i + 3]) assert.equal(last.data[i], Math.round((src.data[i] * NIGHT_MULTIPLY[0]) / 255));
  }
  assert.equal(sha(src), before);
  assert.throws(() => tintBuf(src, 3, 3), RangeError);
});

test("OFFC-07 room layer", () => {
  const style = { base: "#eef1f4", trim: "#9fb0c4", pattern: "plain" };
  const area = {
    kind: "room",
    rect: { x: 0, y: 0, w: 16, h: 12 },
    floors: [{ kind: "carpet", x: 0, y: 0, w: 256, h: 192, seed: 3 }],
    rugs: [],
    walls: [{ kind: "face", x: 8, y: 0, w: 240, style }],
    wallItems: [{ id: "s", kind: "sign", cx: 128, baseY: 32, on: "face" }],
    furniture: [{ id: "d", kind: "desk", tx: 4, ty: 6 }],
  };
  const a = renderRoomLayer(area);
  assert.equal([a.base.w, a.base.h].join("x"), "256x192");
  assert.equal(sha(a.base), sha(renderRoomLayer(area).base));
  assert.deepEqual(a.anchors.map((x) => x.kind).sort(), ["screen", "sign"]);
  const kinds = ["reception", "restroom", "cafe", "lounge", "room", "corridor"].map((kind) => sha(renderRoomLayer({ ...area, kind }).base));
  assert.equal(new Set(kinds).size, 1);
  assert.equal(sha(renderRoomLayer(area, { theme: "none" }).base), sha(a.base));
  assert.throws(() => renderRoomLayer({ ...area, rect: { x: 0, y: 0, w: 0, h: 1 } }), RangeError);
  assert.throws(() => renderRoomLayer({ ...area, furniture: [{ id: "w", kind: "window", tx: 1, ty: 1 }] }), RangeError);
  assert.throws(() => renderRoomLayer(area, { theme: "easter" }), RangeError);
  assert.throws(() => renderRoomLayer(area, { crop: { x: 10, y: 0, w: 10, h: 2 } }), RangeError);
  const over = (k, n) => Array.from({ length: n }, () => area[k][0] ?? ({ kind: "carpet", x: 0, y: 0, w: 16, h: 16, seed: 1 }));
  assert.deepEqual(ROOM_LAYER_LIMITS.floors, 64);
  for (const [k, lim] of [["floors", ROOM_LAYER_LIMITS.floors], ["walls", ROOM_LAYER_LIMITS.walls], ["wallItems", ROOM_LAYER_LIMITS.wallItems], ["furniture", ROOM_LAYER_LIMITS.furniture]]) {
    assert.throws(() => renderRoomLayer({ ...area, [k]: over(k, lim + 1) }), RangeError, k);
  }
  for (const bad of [1.5, -1, ROOM_LAYER_LIMITS.maxTilesW + 1, NaN]) assert.throws(() => renderRoomLayer({ ...area, rect: { x: 0, y: 0, w: bad, h: 1 } }), RangeError, String(bad));
  assert.throws(() => renderRoomLayer({ ...area, rect: { x: 0, y: 0, w: 1, h: ROOM_LAYER_LIMITS.maxTilesH + 1 } }), RangeError);
  assert.throws(() => renderRoomLayer({ ...area, floors: [{ kind: "bogus", x: 0, y: 0, w: 16, h: 16, seed: 1 }] }), RangeError);
  assert.throws(() => renderRoomLayer({ ...area, furniture: [{ id: "d", kind: "desk", tx: NaN, ty: 1 }] }), RangeError);
  assert.throws(() => renderRoomLayer(area, { screens: "bogus" }), RangeError);
  assert.throws(() => renderRoomLayer(area, { hour: NaN }), RangeError);
  for (let i = 0; i < ROOM_ART_CACHE_LIMITS.chunks + 20; i++) renderRoomLayer({ ...area, floors: [{ kind: "carpet", x: 0, y: 0, w: 256, h: 192, seed: 1000 + i }] });
  assert.ok(renderRoomLayer(area).base.w > 0);
  assert.equal(sha(renderRoomLayer({ ...area, wallItems: [], walls: [], furniture: [], rugs: [] }).base).length, 64);
  const empty = renderRoomLayer({ ...area, floors: [], walls: [], wallItems: [], furniture: [], rugs: [] });
  assert.equal(`${empty.base.w}x${empty.base.h}`, "256x192");
  assert.equal(empty.front, null);
  const c = renderRoomLayer(area, { crop: { x: 8, y: 0, w: 8, h: 12 } });
  assert.equal(sha(c.base), sha(a.base.crop(128, 0, 128, 192)));
});

// ------------------------------------------------------------------ Task 1 additions

test("OFFC-07 furniture table details and client parity", (t) => {
  assert.equal(FURNITURE.plant_tall.variants.length, 4);
  assert.deepEqual(FURNITURE.sofa.variants, ["down", "up"]);
  assert.deepEqual(FURNITURE.beanbag.variants, ["red", "blue", "yellow", "green"]);
  assert.equal(FURNITURE.toilet_stall.states, 2);
  assert.equal(FURNITURE.coffee_machine.states, 2);
  if (!clientDefs) return t.diagnostic("skipped client parity: plugins/office/shared/layout/defs.ts is absent");
  assert.deepEqual(Object.keys(clientDefs.FURNITURE).sort(), [...FURNITURE_KINDS].sort());
  const shape = (d) => ({ mount: d.mount, footprint: { w: d.footprint.w, h: d.footprint.h }, blocks: d.blocks, seat: !!d.seat });
  for (const k of FURNITURE_KINDS) assert.deepEqual(shape(FURNITURE[k]), shape(clientDefs.FURNITURE[k]), k);
});

test("OFFC-07 theme client parity", (t) => {
  if (!clientTheme) return t.diagnostic("skipped: plugins/office/shared/layout/theme.ts is absent");
  assert.equal(clientTheme.THEME_COUNT, THEME_COUNT);
  for (let s = 0; s < THEME_COUNT; s++) assert.deepEqual(themeFor(s), clientTheme.roomThemeFor(s), `seed ${s}`);
});

test("OFFC-07 walls golden", () => {
  const all = crypto.createHash("sha256");
  for (const pattern of WALL_PATTERNS) all.update(wallFaceTile({ ...PLAIN, pattern }, 0, 0).data);
  // These pin the current output of surfaces/walls.ts and change only with a deliberate art change.
  assert.equal(all.digest("hex"), "b7ddc0603303c55b5f6a0ef074b60dc32fc0a5e0ea64eed179996f5fe6869f92");
  assert.equal(sha(southWallTile(themeFor(0).wall, 0)), "2ebb7b982b1e9bb8197ee161c747eea3ad54bfdeb68144ac902c266b57477291");
  assert.equal(sha(wallFaceTile(themeFor(0).wall, 0, 0)), "a5b431b28cdd9511bfc42474bccef73a7a724fc3d8b9c3e14580225890b41088");
  assert.equal(capColor(themeFor(0).wall), "#4f5466");
  assert.equal(capColor({ ...themeFor(0).wall, exterior: true }), "#5a5f6b");
});

// ------------------------------------------------------------------ Task 2 additions

// Variants and states of a kind, as [variant, state] pairs.
const looks = (k) => (FURNITURE[k].variants ?? [undefined]).flatMap((v) => Array.from({ length: FURNITURE[k].states ?? 1 }, (_, s) => [v, s]));

test("OFFC-07 furniture seed cycles", () => {
  // Pinned upstream: these variants draw the same plant for every seed; every other variant of a seeded kind varies.
  const seedBlind = new Set(["plant_small:fern", "plant_small:succulent", "plant_tall:palm", "plant_tall:monstera"]);
  for (const [k, n] of Object.entries(SEED_VARIATIONS)) {
    let varies = false;
    for (const v of FURNITURE[k].variants ?? [undefined]) {
      const shas = Array.from({ length: n }, (_, i) => sha(renderFurniture(k, v, 0, i).base.buf));
      assert.equal(sha(renderFurniture(k, v, 0, n).base.buf), shas[0], `${k} ${v} seed ${n}`);
      assert.equal(sha(renderFurniture(k, v, 0, -1).base.buf), shas[n - 1], `${k} ${v} seed -1`);
      const distinct = new Set(shas).size;
      if (seedBlind.has(`${k}:${v}`)) assert.equal(distinct, 1, `${k} ${v}`);
      else assert.ok(distinct >= 2, `${k} ${v}`);
      varies ||= distinct >= 2;
    }
    assert.ok(varies, k);
  }
  for (const k of FURNITURE_KINDS.filter((k) => !(k in SEED_VARIATIONS))) {
    for (const [v, s] of looks(k)) assert.equal(sha(renderFurniture(k, v, s, 0).base.buf), sha(renderFurniture(k, v, s, 5).base.buf), `${k} ${v}`);
  }
});

test("OFFC-07 furniture regions", () => {
  // Checked against the pinned upstream sprites: these are every dynamic rectangle they set (vending_machine adds a glow).
  const regions = { desk: ["screen"], floor_lamp: ["glow"], whiteboard: ["board"], window: ["glass"], clock: ["face"], painting: ["art"], tv: ["tv"], sign: ["sign"], mirror: ["glass"], vending_machine: ["glow"], arcade: ["screen"] };
  for (const k of FURNITURE_KINDS) {
    for (const [v, s] of looks(k)) {
      const { buf, rects } = renderFurniture(k, v, s, 0).base;
      assert.deepEqual(Object.keys(rects ?? {}).sort(), regions[k] ?? [], `${k} ${v}`);
      for (const [name, r] of Object.entries(rects ?? {})) {
        assert.ok(r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= buf.w && r.y + r.h <= buf.h, `${k} ${name} inside ${buf.w}x${buf.h}`);
      }
    }
  }
});

test("OFFC-07 furniture fronts", () => {
  const fronts = new Set();
  for (const k of FURNITURE_KINDS) {
    for (const [v, s] of looks(k)) {
      const f = renderFurniture(k, v, s, 0).front;
      if (!f) continue;
      fronts.add(`${k}:${v ?? "-"}`);
      const b = f.buf.bounds();
      assert.ok(b && b.x === 0 && b.y === 0 && b.w === f.buf.w && b.h === f.buf.h, `${k} front trimmed`);
    }
  }
  const chairs = FURNITURE.office_chair.variants.map((v) => `office_chair:${v}`);
  assert.deepEqual([...fronts].sort(), [...chairs, "sofa:up", "cafe_chair:up", "armchair:up", "toilet_stall:-"].sort());
  assert.equal(renderFurniture("stool").front, undefined);
  assert.equal(renderFurniture("desk").front, undefined);
});

test("OFFC-07 furniture states", () => {
  // A state may change the base or the front sprite: the toilet stall's occupied door is drawn in its front sprite.
  const look = (k, s) => {
    const f = renderFurniture(k, undefined, s, 0);
    return `${sha(f.base.buf)}|${f.front ? sha(f.front.buf) : "-"}`;
  };
  const states = (k) => new Set(Array.from({ length: FURNITURE[k].states }, (_, s) => look(k, s))).size;
  assert.equal(states("elevator"), 5);
  assert.equal(states("toilet_stall"), 2);
  assert.equal(states("coffee_machine"), 2);
  assert.equal(sha(renderFurniture("toilet_stall", undefined, 0).base.buf), sha(renderFurniture("toilet_stall", undefined, 1).base.buf));
  assert.notEqual(sha(renderFurniture("light_switch", "on").base.buf), sha(renderFurniture("light_switch", "off").base.buf));
  assert.notEqual(sha(renderFurniture("sofa", "down").base.buf), sha(renderFurniture("sofa", "up").base.buf));
});

test("OFFC-07 furniture anchors", () => {
  // The plan's "anchor inside the buffer" is refuted by the pinned upstream: wall items anchor on the skirting line below
  // their sprite, and the toilet stall below its own; the x anchor is always inside.
  const below = new Set(["whiteboard", "window", "clock", "poster", "painting", "tv", "light_switch", "sign", "mirror", "shelf_wall", "toilet_stall"]);
  for (const k of FURNITURE_KINDS) {
    for (const [v, s] of looks(k)) {
      const { buf, ax, ay } = renderFurniture(k, v, s, 0).base;
      assert.ok(Number.isInteger(ax) && ax >= 0 && ax <= buf.w, `${k} ax`);
      if (below.has(k)) assert.ok(ay > buf.h, `${k} ay below`);
      else assert.ok(Number.isInteger(ay) && ay >= 0 && ay <= buf.h, `${k} ay inside`);
    }
  }
});

// ------------------------------------------------------------------ Task 3 additions

// Opaque pixels of a buffer as "x,y" strings.
const lit = (b) => {
  const out = new Set();
  for (let i = 3; i < b.data.length; i += 4) if (b.data[i]) out.add(`${((i - 3) / 4) % b.w},${Math.floor((i - 3) / 4 / b.w)}`);
  return out;
};

test("OFFC-07 pixelfont", () => {
  assert.equal(pixelTextWidth("abc"), 11);
  assert.equal(pixelTextWidth(""), 0);
  const i = new PixelBuf(12, 16);
  assert.equal(pixelText(i, "i", 2, 6, "#ffffff"), 4);
  const rows = "111010010010111";
  assert.deepEqual(lit(i), new Set([...rows].flatMap((c, n) => (c === "1" ? [`${2 + (n % 3)},${6 + Math.floor(n / 3)}`] : []))));
  const upper = new PixelBuf(16, 8);
  const lower = new PixelBuf(16, 8);
  assert.equal(pixelText(upper, "ABC", 1, 1, "#ffffff"), 12);
  pixelText(lower, "abc", 1, 1, "#ffffff");
  assert.equal(sha(upper), sha(lower));
  const unknown = new PixelBuf(8, 8);
  assert.equal(pixelText(unknown, "~", 1, 1, "#ffffff"), 4);
  assert.equal(unknown.countOpaque(), 0);
  // Accents sit in the two rows y-3 and y-2 above the glyph, the cedilla in y+5 and y+6 below it.
  const marks = (ch, base, rowsOf) => {
    const a = new PixelBuf(8, 16);
    const b = new PixelBuf(8, 16);
    pixelText(a, ch, 2, 5, "#ffffff");
    pixelText(b, base, 2, 5, "#ffffff");
    const extra = [...lit(a)].filter((p) => !lit(b).has(p)).map((p) => Number(p.split(",")[1]));
    assert.ok(extra.length > 0, ch);
    assert.ok(extra.every((y) => rowsOf.includes(y)), `${ch} rows ${extra}`);
  };
  for (const ch of ["á", "à", "â", "ã", "é", "ê", "í", "ó", "ô", "õ", "ú"]) marks(ch, ch.normalize("NFD")[0], [2, 3]);
  marks("ç", "c", [10, 11]);
  const src = norm(fs.readFileSync(path.join(OFFICE, "server", "art", "pixelfont.ts"), "utf8"));
  const table = src.slice(src.indexOf("const GLYPHS"), src.indexOf("};", src.indexOf("const GLYPHS")));
  const glyphs = [...table.matchAll(/(?:'[^']*'|\w+):\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(glyphs.length >= 40);
  for (const g of glyphs) assert.match(g, /^[01]{15}$/);
});

test("OFFC-07 variants", () => {
  assert.deepEqual([...SCREEN_MODES], ["off", "standby", "idle", "code", "terminal", "browser", "search", "chat", "docs", "tasks", "alert", "progress", "show", "game"]);
  for (const m of SCREEN_MODES) {
    const b = screenVariant(m, 20, 12, 1);
    assert.equal(`${b.w}x${b.h}`, "20x12", m);
    assert.ok(b.countOpaque() > 0, m);
    assert.equal(sha(b), sha(screenVariant(m, 20, 12, 1)), m);
  }
  const full = (b) => b.countOpaque() === b.w * b.h;
  assert.ok(full(screenVariant("off", 20, 12, 0)) && full(screenVariant("standby", 20, 12, 0)));
  assert.notEqual(sha(screenVariant("off", 20, 12, 0)), sha(screenVariant("standby", 20, 12, 0)));
  const show = [0, 1, 2, 3].map((s) => sha(screenVariant("show", 20, 12, s)));
  assert.equal(new Set(show.slice(0, 3)).size, 3);
  assert.equal(show[3], show[0]);
  const game = [0, 1, 2].map((s) => sha(screenVariant("game", 20, 12, s)));
  assert.notEqual(game[0], game[1]);
  assert.equal(game[2], game[0]);
  for (const m of ["code", "terminal", "progress"]) assert.notEqual(sha(screenVariant(m, 20, 12, 0, 0)), sha(screenVariant(m, 20, 12, 0, 3)), m);
  assert.notEqual(sha(boardVariant(30, 20, [])), sha(boardVariant(30, 20, [{ status: "pending" }])));
  const crowded = boardVariant(30, 20, Array.from({ length: 60 }, () => ({ status: "completed" })));
  assert.equal(`${crowded.w}x${crowded.h}`, "30x20");
  assert.equal(new Set([3, 7, 13, 18, 22].map((h) => sha(windowVariant(28, 20, h, 1)))).size, 5);
  assert.notEqual(sha(clockVariant(11, 11, 10, 10)), sha(clockVariant(11, 11, 3, 45)));
  for (const [w, h] of [[0, 4], [1.5, 4], [4, -1], [NaN, 4]]) {
    assert.throws(() => screenVariant("code", w, h, 0), RangeError, `screen ${w}x${h}`);
    assert.throws(() => boardVariant(w, h, []), RangeError, `board ${w}x${h}`);
    assert.throws(() => windowVariant(w, h, 12, 0), RangeError, `window ${w}x${h}`);
    assert.throws(() => clockVariant(w, h, 1, 1), RangeError, `clock ${w}x${h}`);
  }
  for (const frame of [-1, SCREEN_FRAMES, 1.5]) {
    assert.throws(() => screenVariant("code", 8, 8, 0, frame), RangeError, `screen frame ${frame}`);
    assert.throws(() => boardVariant(8, 8, [], frame), RangeError, `board frame ${frame}`);
    assert.throws(() => windowVariant(8, 8, 12, 0, frame), RangeError, `window frame ${frame}`);
  }
  assert.throws(() => screenVariant("bogus", 8, 8, 0), RangeError);
});

test("OFFC-17 seasonal props", () => {
  for (const k of ["tree", "gift", "pumpkin", "ghost", "wreath", "bat"]) {
    const s = renderSeasonalProp(k);
    const b = s.buf.bounds();
    assert.ok(s.buf.countOpaque() > 40, k);
    assert.ok(b.x > 0 && b.y > 0 && b.x + b.w < s.buf.w && b.y + b.h < s.buf.h, `${k} margin`);
    assert.equal(sha(s.buf), sha(renderSeasonalProp(k).buf), k);
  }
  assert.deepEqual([...SEASONAL_THEMES], ["none", "christmas", "halloween"]);
  const every = FURNITURE_KINDS.map((k) => ({ id: `id-${k}`, kind: k }));
  const furniture = [{ id: "tall-a", kind: "plant_tall" }, { id: "tall-b", kind: "plant_tall" }, { id: "small-a", kind: "plant_small" }, { id: "small-b", kind: "plant_small" }, ...every];
  assert.equal(seasonProps("none", { kind: "room", furniture }).size, 0);
  for (const theme of SEASONAL_THEMES) assert.equal(seasonProps(theme, { kind: "restroom", furniture }).size, 0, theme);
  const xmas = seasonProps("christmas", { kind: "room", furniture });
  assert.deepEqual(Object.fromEntries(xmas), { "tall-a": "tree", "small-a": "gift", "small-b": "gift", "id-plant_small": "gift" });
  const hall = seasonProps("halloween", { kind: "lounge", furniture });
  assert.deepEqual(Object.fromEntries(hall), { "tall-a": hash32("tall-a") % 3 === 0 ? "ghost" : "pumpkin", "small-a": "pumpkin", "small-b": "pumpkin", "id-plant_small": "pumpkin" });
  const outcomes = new Set();
  for (let i = 0; i < 40; i++) {
    const id = `p${i}`;
    const got = seasonProps("halloween", { kind: "cafe", furniture: [{ id, kind: "plant_tall" }] }).get(id);
    assert.equal(got, hash32(id) % 3 === 0 ? "ghost" : "pumpkin", id);
    outcomes.add(got);
  }
  assert.deepEqual([...outcomes].sort(), ["ghost", "pumpkin"]);
  assert.equal(seasonalRugColor("christmas", "#123456"), "#a93649");
  assert.equal(seasonalRugColor("halloween", "#123456"), "#60416f");
  assert.equal(seasonalRugColor("none", "#123456"), "#123456");
  const glass = { ...PLAIN, pattern: "glass" };
  assert.deepEqual(seasonalWallStyle("none", PLAIN), PLAIN);
  for (const theme of ["christmas", "halloween"]) assert.deepEqual(seasonalWallStyle(theme, glass), glass, theme);
  const c = seasonalWallStyle("christmas", PLAIN);
  const h = seasonalWallStyle("halloween", PLAIN);
  assert.deepEqual([c.trim, h.trim, c.pattern, h.pattern], ["#4e7756", "#725486", "plain", "plain"]);
  assert.ok(c.base !== PLAIN.base && h.base !== PLAIN.base && c.base !== h.base);
});

test("OFFC-17 seasonal paint", () => {
  const changed = (w, h, paint) => {
    const b = new PixelBuf(w, h);
    const before = sha(b);
    paint(b);
    return sha(b) !== before;
  };
  const rug = (theme, w, h) => changed(64, 48, (b) => paintSeasonalRug(b, theme, { x: 0, y: 0, w, h }));
  assert.ok(!rug("none", 60, 40));
  assert.ok(!rug("christmas", 24, 40) && !rug("christmas", 60, 15) && !rug("halloween", 24, 16));
  assert.ok(rug("christmas", 25, 16) && rug("halloween", 60, 40));
  const wall = { kind: "face", x: 0, y: 0, w: 200, doorways: [{ x: 60, w: 20 }] };
  assert.ok(!changed(200, 40, (b) => paintSeasonalWall(b, "none", wall)));
  assert.ok(!changed(200, 40, (b) => paintSeasonalWall(b, "christmas", { ...wall, kind: "south" })));
  for (const theme of ["christmas", "halloween"]) {
    const b = new PixelBuf(200, 40);
    paintSeasonalWall(b, theme, wall);
    const cols = diffPixels(b, new PixelBuf(200, 40)).map((p) => p.x);
    assert.ok(cols.length > 0, theme);
    assert.ok(!cols.some((x) => x >= 59 && x < 81), `${theme}: doorway and one pixel each side stay free`);
  }
  // The bat: only its colours, painted only on a face wider than 90 px.
  const decor = new Set();
  const plain = new PixelBuf(200, 40);
  paintSeasonalWall(plain, "halloween", { kind: "face", x: 0, y: 0, w: 90 });
  for (let i = 0; i < plain.data.length; i += 4) if (plain.data[i + 3]) decor.add(plain.data.slice(i, i + 4).join());
  const batColours = new Set();
  const bat = renderSeasonalProp("bat").buf;
  for (let i = 0; i < bat.data.length; i += 4) if (bat.data[i + 3] === 255 && !decor.has(bat.data.slice(i, i + 4).join())) batColours.add(bat.data.slice(i, i + 4).join());
  assert.ok(batColours.size > 0);
  const batPixels = (w) => {
    const b = new PixelBuf(200, 40);
    paintSeasonalWall(b, "halloween", { kind: "face", x: 0, y: 0, w });
    let n = 0;
    for (let i = 0; i < b.data.length; i += 4) if (batColours.has(b.data.slice(i, i + 4).join())) n++;
    return n;
  };
  assert.equal(batPixels(90), 0);
  assert.ok(batPixels(91) > 0);
  const orn = (theme) => {
    const b = new PixelBuf(60, 90);
    paintElevatorOrnament(b, theme, 30, 80);
    return sha(b);
  };
  assert.equal(orn("none"), sha(new PixelBuf(60, 90)));
  assert.equal(new Set([orn("none"), orn("christmas"), orn("halloween")]).size, 3);
  const lights = (theme, kind = "face") => changed(120, 40, (b) => paintSeasonalLights(b, theme, { walls: [{ kind, x: 0, y: 0, w: 120 }] }));
  assert.ok(!lights("none") && lights("christmas") && lights("halloween"));
  assert.ok(!lights("christmas", "south"));
  const snow = (theme) => changed(30, 20, (b) => paintSeasonalWindow(b, theme, { x: 2, y: 2, w: 26, h: 16 }, 7));
  assert.ok(snow("christmas") && !snow("halloween") && !snow("none"));
});

test("OFFC-17 tint levels and hours", () => {
  assert.deepEqual([...NIGHT_MULTIPLY], [74, 89, 144]);
  const src = renderFurniture("sofa", "down", 0, 0).base.buf;
  const before = sha(src);
  const brightness = (b) => {
    let s = 0;
    for (let i = 0; i < b.data.length; i += 4) s += b.data[i] + b.data[i + 1] + b.data[i + 2];
    return s;
  };
  for (let levels = TINT_MIN_LEVELS; levels <= TINT_MAX_LEVELS; levels++) {
    let prev = Infinity;
    let prevHour = -Infinity;
    for (let level = 0; level < levels; level++) {
      const t = tintBuf(src, level, levels);
      for (let i = 0; i < src.data.length; i += 4) {
        assert.equal(t.data[i + 3], src.data[i + 3]);
        if (!src.data[i + 3]) assert.deepEqual([...t.data.slice(i, i + 3)], [...src.data.slice(i, i + 3)]);
      }
      assert.ok(brightness(t) <= prev, `levels ${levels} level ${level}`);
      prev = brightness(t);
      const hour = hourForTint(level, levels);
      assert.ok(hour > prevHour);
      prevHour = hour;
    }
    // Last level: each channel times its NIGHT_MULTIPLY entry over 255, rounded half up (tint.ts).
    const last = tintBuf(src, levels - 1, levels);
    for (let i = 0; i < src.data.length; i += 4) {
      if (!src.data[i + 3]) continue;
      for (let c = 0; c < 3; c++) assert.equal(last.data[i + c], Math.floor((2 * src.data[i + c] * NIGHT_MULTIPLY[c] + 255) / 510));
    }
    assert.equal(hourForTint(0, levels), FIXED_DAY_HOUR);
    assert.equal(hourForTint(levels - 1, levels), FIXED_NIGHT_HOUR);
  }
  const mid = tintBuf(src, 1, 3);
  const night = tintBuf(src, 2, 3);
  for (let i = 0; i < src.data.length; i += 4) for (let c = 0; c < 3; c++) assert.ok(night.data[i + c] <= mid.data[i + c] && mid.data[i + c] <= src.data[i + c]);
  assert.equal(sha(tintBuf(src, TINT_LEVELS - 1)), sha(tintBuf(src, TINT_LEVELS - 1, TINT_LEVELS)));
  for (const [level, levels] of [[-1, 3], [1.5, 3], [3, 3], [0, TINT_MIN_LEVELS - 1], [0, TINT_MAX_LEVELS + 1], [0, 2.5]]) {
    assert.throws(() => tintBuf(src, level, levels), RangeError, `tint ${level}/${levels}`);
    assert.throws(() => hourForTint(level, levels), RangeError, `hour ${level}/${levels}`);
  }
  assert.equal(sha(src), before);
});

// ------------------------------------------------------------------ room layers

const signFace = (() => {
  const s = renderFurniture("sign").base;
  const r = s.rects.sign;
  return sha(s.buf.crop(r.x, r.y, r.w, r.h));
})();
const cropOf = (b, r) => b.crop(r.x, r.y, r.w, r.h);
const idsOf = (area, kind) => area.furniture.filter((f) => f.kind === kind).map((f) => f.id).concat(area.wallItems.filter((w) => w.kind === kind).map((w) => w.id)).sort();

test("OFFC-07 room layer fixtures per area kind", () => {
  assert.deepEqual(Object.keys(roomsModule).sort(), ["ROOM_ART_CACHE_LIMITS", "ROOM_LAYER_LIMITS", "renderRoomLayer"]);
  for (const [name, area] of Object.entries(fixtures())) {
    const l = renderRoomLayer(area);
    assert.equal(`${l.base.w}x${l.base.h}`, `${area.rect.w * TILE}x${area.rect.h * TILE}`, name);
    const again = renderRoomLayer(area);
    assert.equal(sha(l.base), sha(again.base), name);
    const hasFront = area.furniture.some((f) => renderFurniture(f.kind, f.variant).front);
    assert.equal(l.front !== null, hasFront, `${name} front`);
    if (l.front) {
      assert.equal(`${l.front.w}x${l.front.h}`, `${l.base.w}x${l.base.h}`);
      assert.ok(l.front.countOpaque() > 0);
      assert.equal(sha(l.front), sha(again.front));
    }
    const anchorIds = (kind) => l.anchors.filter((a) => a.kind === kind).map((a) => a.id).sort();
    assert.deepEqual(anchorIds("screen"), idsOf(area, "desk"), `${name} screens`);
    assert.deepEqual(anchorIds("board"), idsOf(area, "whiteboard"), `${name} boards`);
    assert.deepEqual(anchorIds("sign"), idsOf(area, "sign"), `${name} signs`);
    // Nothing is painted over a sign face under theme none: it is the sign sprite's face, pixel for pixel.
    for (const a of l.anchors.filter((x) => x.kind === "sign")) assert.equal(sha(cropOf(l.base, a)), signFace, `${name} ${a.id}`);
  }
  // The screens option changes only the desk screen rectangles.
  const room = fixtures().room;
  const standby = renderRoomLayer(room);
  const code = renderRoomLayer(room, { screens: "code" });
  const diff = diffPixels(standby.base, code.base);
  assert.ok(diff.length > 0);
  assert.ok(diff.every((p) => insideAny(p, standby.anchors.filter((a) => a.kind === "screen"))));
  // A sprite that overhangs the layer edge is clipped; empty lists give a blank layer.
  const over = renderRoomLayer({ ...room, furniture: [{ id: "edge", kind: "meeting_table", tx: 14, ty: 10 }, { id: "top", kind: "bookshelf", tx: -1, ty: -1 }] });
  assert.equal(`${over.base.w}x${over.base.h}`, "256x192");
  for (const kind of ["reception", "restroom", "cafe", "lounge", "room", "corridor"]) {
    const empty = renderRoomLayer({ kind, rect: { x: 2, y: 3, w: 4, h: 2 }, floors: [], rugs: [], walls: [], wallItems: [], furniture: [] });
    assert.deepEqual([empty.base.w, empty.base.h, empty.base.countOpaque(), empty.front, empty.anchors.length], [64, 32, 0, null, 0], kind);
  }
  // Two rooms that share an edge, floor kind and seed match a single area drawn across both.
  for (const kind of ["wood", "marble", "carpet"]) {
    const part = (x, w) => renderRoomLayer({ kind: "room", rect: { x, y: 0, w, h: 4 }, floors: [{ kind, x: x * TILE, y: 0, w: w * TILE, h: 64, seed: 9 }], rugs: [], walls: [], wallItems: [], furniture: [] }).base;
    const joint = part(0, 12);
    assert.equal(sha(part(0, 4)), sha(joint.crop(0, 0, 64, 64)), kind);
    assert.equal(sha(part(4, 8)), sha(joint.crop(64, 0, 128, 64)), kind);
  }
});

test("OFFC-17 room layer theme", () => {
  const f = seasonalFixture();
  const none = renderRoomLayer(f, { theme: "none" });
  assert.equal(sha(none.base), sha(renderRoomLayer(f).base));
  const xmas = renderRoomLayer(f, { theme: "christmas" });
  const hall = renderRoomLayer(f, { theme: "halloween" });
  assert.equal(new Set([sha(none.base), sha(xmas.base), sha(hall.base)]).size, 3);
  for (const area of [fixtures().restroom, seasonalFixture("restroom")]) {
    assert.equal(new Set(SEASONAL_THEMES.map((theme) => sha(renderRoomLayer(area, { theme }).base))).size, 1);
  }
  // The window hour changes only the window sprite's rectangle.
  const room = fixtures().room;
  const win = room.wallItems.find((w) => w.kind === "window");
  const s = renderFurniture("window", undefined, 0, hash32(win.id)).base;
  const winRect = { x: Math.round(win.cx - s.ax), y: Math.round(win.baseY - s.ay), w: s.buf.w, h: s.buf.h };
  const diff = diffPixels(renderRoomLayer(room, { hour: 13.5 }).base, renderRoomLayer(room, { hour: 22.5 }).base);
  assert.ok(diff.length > 0);
  assert.ok(diff.every((p) => insideAny(p, [winRect])));
  // Under a seasonal theme the sign face differs from theme none only by the decoration lights painted last (rooms.ts).
  const plain = renderRoomLayer(room);
  const sign = plain.anchors.find((a) => a.kind === "sign");
  for (const theme of ["christmas", "halloween"]) {
    const glow = plain.base.crop(0, 0, plain.base.w, plain.base.h);
    paintSeasonalLights(glow, theme, { walls: room.walls });
    assert.equal(sha(cropOf(renderRoomLayer(room, { theme }).base, sign)), sha(cropOf(glow, sign)), theme);
  }
});

test("OFFC-07 room layer limits and crop", () => {
  const room = fixtures().room;
  const items = {
    floors: { kind: "carpet", x: 0, y: 0, w: 16, h: 16, seed: 1 },
    rugs: { x: 0, y: 0, w: 32, h: 32, color: "#334455", seed: 1 },
    walls: { kind: "face", x: 0, y: 0, w: 32, style: PLAIN },
    wallItems: { id: "w", kind: "clock", cx: 20, baseY: 32, on: "face" },
    furniture: { id: "f", kind: "stool", tx: 1, ty: 3 },
  };
  for (const [k, item] of Object.entries(items)) {
    assert.doesNotThrow(() => renderRoomLayer({ ...room, [k]: Array(ROOM_LAYER_LIMITS[k]).fill(item) }), k);
    assert.throws(() => renderRoomLayer({ ...room, [k]: Array(ROOM_LAYER_LIMITS[k] + 1).fill(item) }), RangeError, k);
  }
  const doors = (n) => ({ ...room, walls: [{ kind: "face", x: 0, y: 0, w: 256, style: PLAIN, doorways: Array(n).fill({ x: 8, w: 8 }) }] });
  assert.doesNotThrow(() => renderRoomLayer(doors(ROOM_LAYER_LIMITS.doorways)));
  assert.throws(() => renderRoomLayer(doors(ROOM_LAYER_LIMITS.doorways + 1)), RangeError);
  const bad = [
    ["rect w 0", { rect: { x: 0, y: 0, w: 0, h: 4 } }],
    ["rect w 1.5", { rect: { x: 0, y: 0, w: 1.5, h: 4 } }],
    ["rect h negative", { rect: { x: 0, y: 0, w: 4, h: -2 } }],
    ["rect too wide", { rect: { x: 0, y: 0, w: ROOM_LAYER_LIMITS.maxTilesW + 1, h: 4 } }],
    ["rect too tall", { rect: { x: 0, y: 0, w: 4, h: ROOM_LAYER_LIMITS.maxTilesH + 1 } }],
    ["rect x fractional", { rect: { x: 0.5, y: 0, w: 4, h: 4 } }],
    ["area kind", { kind: "garage" }],
    ["furniture kind", { furniture: [{ id: "x", kind: "bogus", tx: 1, ty: 1 }] }],
    ["wall item kind", { wallItems: [{ id: "x", kind: "bogus", cx: 1, baseY: 32, on: "face" }] }],
    ["floor kind as wall item", { wallItems: [{ id: "x", kind: "desk", cx: 1, baseY: 32, on: "face" }] }],
    ["wall item side", { wallItems: [{ id: "x", kind: "clock", cx: 1, baseY: 32, on: "ceiling" }] }],
    ["floor kind", { floors: [{ kind: "lava", x: 0, y: 0, w: 16, h: 16, seed: 1 }] }],
    ["wall kind", { walls: [{ kind: "arch", x: 0, y: 0, w: 16, style: PLAIN }] }],
    ["wall pattern", { walls: [{ kind: "face", x: 0, y: 0, w: 16, style: { ...PLAIN, pattern: "zigzag" } }] }],
    ["floor x NaN", { floors: [{ kind: "carpet", x: NaN, y: 0, w: 16, h: 16, seed: 1 }] }],
    ["floor seed Infinity", { floors: [{ kind: "carpet", x: 0, y: 0, w: 16, h: 16, seed: Infinity }] }],
    ["rug y Infinity", { rugs: [{ x: 0, y: Infinity, w: 32, h: 32, color: "#334455", seed: 1 }] }],
    ["wall x NaN", { walls: [{ kind: "face", x: NaN, y: 0, w: 16, style: PLAIN }] }],
    ["doorway x NaN", { walls: [{ kind: "face", x: 0, y: 0, w: 16, style: PLAIN, doorways: [{ x: NaN, w: 4 }] }] }],
    ["wall item cx NaN", { wallItems: [{ id: "x", kind: "clock", cx: NaN, baseY: 32, on: "face" }] }],
    ["wall item baseY -Infinity", { wallItems: [{ id: "x", kind: "clock", cx: 1, baseY: -Infinity, on: "face" }] }],
    ["furniture ty Infinity", { furniture: [{ id: "x", kind: "desk", tx: 1, ty: Infinity }] }],
    ["furniture dx NaN", { furniture: [{ id: "x", kind: "desk", tx: 1, ty: 1, dx: NaN }] }],
  ];
  for (const k of FURNITURE_KINDS.filter((k) => FURNITURE[k].mount === "wall")) bad.push([`wall item ${k} as floor furniture`, { furniture: [{ id: "x", kind: k, tx: 1, ty: 1 }] }]);
  for (const [why, patch] of bad) assert.throws(() => renderRoomLayer({ ...room, ...patch }), RangeError, why);
  const badOpts = [{ theme: "easter" }, { screens: "hologram" }, { hour: NaN }, { hour: Infinity }, { hour: "13" }, { crop: { x: -1, y: 0, w: 4, h: 4 } }, { crop: { x: 0, y: 0, w: 0, h: 4 } }, { crop: { x: 10, y: 0, w: 7, h: 4 } }, { crop: { x: 0, y: 10, w: 4, h: 3 } }, { crop: { x: 0.5, y: 0, w: 4, h: 4 } }];
  for (const opts of badOpts) assert.throws(() => renderRoomLayer(room, opts), RangeError, JSON.stringify(opts));
  // The caches clear on overflow (their size is internal): after many distinct floor seeds an earlier layer is unchanged.
  const small = { kind: "room", rect: { x: 0, y: 0, w: 8, h: 4 }, floors: [{ kind: "carpet", x: 0, y: 0, w: 128, h: 64, seed: 1 }], rugs: [], walls: [], wallItems: [], furniture: [] };
  const first = sha(renderRoomLayer(small).base);
  for (let i = 0; i < ROOM_ART_CACHE_LIMITS.chunks + 40; i++) renderRoomLayer({ ...small, floors: [{ ...small.floors[0], seed: 5000 + i }] });
  assert.equal(sha(renderRoomLayer(small).base), first);
  // A crop equals the same region of the whole layer, base and front, with the anchors that reach it shifted into it.
  const corridor = fixtures().corridor;
  for (const theme of SEASONAL_THEMES) {
    const whole = renderRoomLayer(corridor, { theme });
    for (const crop of [{ x: 0, y: 0, w: 16, h: 5 }, { x: 16, y: 0, w: 16, h: 5 }, { x: 32, y: 0, w: 8, h: 5 }, { x: 22, y: 1, w: 5, h: 3 }]) {
      const c = renderRoomLayer(corridor, { theme, crop });
      const px = { x: crop.x * TILE, y: crop.y * TILE, w: crop.w * TILE, h: crop.h * TILE };
      assert.equal(sha(c.base), sha(cropOf(whole.base, px)), `${theme} ${JSON.stringify(crop)} base`);
      assert.equal(sha(c.front), sha(cropOf(whole.front, px)), `${theme} ${JSON.stringify(crop)} front`);
      const shifted = whole.anchors.map((a) => ({ ...a, x: a.x - px.x, y: a.y - px.y })).filter((a) => a.x < px.w && a.y < px.h && a.x + a.w > 0 && a.y + a.h > 0);
      assert.deepEqual(c.anchors, shifted, `${theme} ${JSON.stringify(crop)} anchors`);
    }
  }
});

test("OFFC-07 real layout", (t) => {
  if (!clientBuilding) return t.diagnostic("skipped: plugins/office/shared/layout/building.ts is absent");
  const zoom = Math.max(...ZOOM_LEVELS);
  const png = (b) => {
    assert.ok(b.w * zoom <= PNG_MAX_DIMENSION && b.h * zoom <= PNG_MAX_DIMENSION, `${b.w}x${b.h} at zoom ${zoom}`);
    const bytes = encodePng(b.data, b.w, b.h, zoom).length;
    assert.ok(bytes <= SPRITE_PNG_MAX_BYTES, `${bytes} bytes`);
    return bytes;
  };
  const buildings = {
    three: clientBuilding.buildBuilding([{ id: "a", slot: 0, seed: 1 }, { id: "b", slot: 1, seed: 2 }, { id: "c", slot: 2, seed: 3 }]),
    empty: clientBuilding.buildBuilding([]),
  };
  for (const [name, building] of Object.entries(buildings)) {
    assert.ok(building.areas.length >= 5, name);
    for (const area of building.areas) {
      for (const theme of SEASONAL_THEMES) {
        const l = renderRoomLayer(area, { theme });
        assert.equal(`${l.base.w}x${l.base.h}`, `${area.rect.w * TILE}x${area.rect.h * TILE}`, `${area.id} ${theme}`);
        if (theme !== "none") continue;
        // Every floor kind and wall item kind that appears is drawn: leaving it out changes the layer.
        for (const kind of new Set(area.floors.map((f) => f.kind))) assert.notEqual(sha(renderRoomLayer({ ...area, floors: area.floors.filter((f) => f.kind !== kind) }).base), sha(l.base), `${area.id} floor ${kind}`);
        for (const kind of new Set(area.wallItems.map((w) => w.kind))) assert.notEqual(sha(renderRoomLayer({ ...area, wallItems: area.wallItems.filter((w) => w.kind !== kind) }).base), sha(l.base), `${area.id} wall item ${kind}`);
        if (area.kind !== "corridor") {
          t.diagnostic(`${name} ${area.id} ${l.base.w * zoom}x${l.base.h * zoom} base ${png(l.base)} B${l.front ? `, front ${png(l.front)} B` : ""}`);
          continue;
        }
        // The corridor is delivered in crops of 16 tiles.
        for (let x = 0; x < area.rect.w; x += 16) {
          const c = renderRoomLayer(area, { crop: { x, y: 0, w: Math.min(16, area.rect.w - x), h: area.rect.h } });
          t.diagnostic(`${name} ${area.id} crop ${x} ${c.base.w * zoom}x${c.base.h * zoom} base ${png(c.base)} B${c.front ? `, front ${png(c.front)} B` : ""}`);
        }
      }
    }
  }
});
