// Port of habblaud client/src/art/index.ts and client/src/world/render/scene.ts and client/src/world/render/renderer.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt).
// New composition (draw order read from scene.ts and renderer.ts): areas baked into PixelBuf layers; no text is drawn, the sign face stays blank and is returned as an anchor.
import { TILE, type Rect } from '../../shared/art-types.ts';
import { shade } from './core/color.ts';
import { PixelBuf } from './core/pixbuf.ts';
import type { BufFurniture, BufSprite } from './core/sprite.ts';
import { hash32 } from './furniture/hash.ts';
import { normalizeFurniture, renderFurniture } from './furniture/index.ts';
import { FURNITURE, isFurnitureKind, type FurnitureKind } from './furniture/types.ts';
import {
  SEASONAL_THEMES,
  paintElevatorOrnament,
  paintSeasonalLights,
  paintSeasonalRug,
  paintSeasonalWall,
  paintSeasonalWindow,
  seasonProps,
  seasonalRugColor,
  seasonalSprite,
  seasonalWallStyle,
  type SeasonalTheme,
} from './seasonal.ts';
import { CHUNK_PX, floorChunk } from './surfaces/floor.ts';
import { renderRug } from './surfaces/rug.ts';
import { FLOOR_KINDS, WALL_PATTERNS, type Doorway, type FloorKind, type WallStyle } from './surfaces/types.ts';
import { WALL_CAP_H, WALL_FACE_H, capColor, southWallTile, wallFaceTile } from './surfaces/walls.ts';
import { FIXED_DAY_HOUR } from './tint.ts';
import { SCREEN_MODES, boardVariant, clockVariant, screenVariant, windowVariant, type ScreenMode } from './variants.ts';

// Area kinds a layer can be drawn for.
export type RoomAreaKind = 'reception' | 'restroom' | 'cafe' | 'lounge' | 'room' | 'corridor';
const AREA_KINDS: readonly RoomAreaKind[] = ['reception', 'restroom', 'cafe', 'lounge', 'room', 'corridor'];

// Structural input: a 07-02 AreaLayout is accepted as is. Floor, rug and wall coordinates are world pixels; the rect is in tiles.
export interface RoomLayerInput {
  kind: RoomAreaKind;
  rect: { x: number; y: number; w: number; h: number };
  floors: readonly { kind: FloorKind; x: number; y: number; w: number; h: number; seed: number; tint?: string; tint2?: string }[];
  rugs: readonly { x: number; y: number; w: number; h: number; color: string; seed: number }[];
  walls: readonly { kind: 'face' | 'south' | 'cap'; x: number; y: number; w: number; h?: number; style: WallStyle; doorways?: readonly Doorway[] }[];
  wallItems: readonly { id: string; kind: FurnitureKind; variant?: string; cx: number; baseY: number; on: 'face' | 'south' }[];
  furniture: readonly { id: string; kind: FurnitureKind; variant?: string; tx: number; ty: number; dx?: number; dy?: number }[];
  floorTint?: string;
}

// Options: seasonal theme (default none), screen mode of desk screens (default standby), local hour of the window sky (default the fixed day hour) and an area-local tile crop.
export interface RoomLayerOpts {
  theme?: SeasonalTheme;
  screens?: ScreenMode;
  hour?: number;
  crop?: { x: number; y: number; w: number; h: number };
}

// Region the caller overlays: a sign face, a desk screen or a whiteboard, in output pixels after the crop.
export interface RoomAnchor {
  kind: 'sign' | 'screen' | 'board';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Result: base layer, front layer (only the front sprites) or null, and the anchors.
export interface RoomLayers {
  base: PixelBuf;
  front: PixelBuf | null;
  anchors: RoomAnchor[];
}

// Size and list limits checked before any drawing.
export const ROOM_LAYER_LIMITS = {
  maxTilesW: 1024,
  maxTilesH: 64,
  floors: 64,
  rugs: 32,
  walls: 64,
  wallItems: 128,
  furniture: 512,
  doorways: 8,
} as const;

// Bounds of the memoised floor chunks and of the memoised sprites, wall tiles and rugs (a cache clears when it is full).
export const ROOM_ART_CACHE_LIMITS = { chunks: 128, sprites: 1024 } as const;

// Largest absolute coordinate and edge accepted for world pixels, and the largest rug area.
const COORD_MAX = 1_000_000;
const EDGE_MAX = ROOM_LAYER_LIMITS.maxTilesW * TILE;
const RUG_AREA_MAX = 4_000_000;
const STRING_MAX = 128;

// Wall items redrawn after the fixed ones (upstream DYNAMIC_WALL), with the sign last.
const DYNAMIC_WALL: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>(['window', 'clock', 'whiteboard', 'tv', 'elevator', 'light_switch', 'sign', 'mirror']);

// ------------------------------------------------------------------ caches

const chunkCache = new Map<string, PixelBuf>();
const furnCache = new Map<string, BufFurniture>();
const pieceCache = new Map<string, PixelBuf>();

// Memoises a value in a bounded map that clears when it is full.
function memo<T>(map: Map<string, T>, limit: number, key: string, make: () => T): T {
  const hit = map.get(key);
  if (hit !== undefined) return hit;
  if (map.size >= limit) map.clear();
  const value = make();
  map.set(key, value);
  return value;
}

// Sprites of a furniture piece for a normalised key.
function furnitureOf(kind: FurnitureKind, variant: string | undefined, state: number, seed: number): BufFurniture {
  const n = normalizeFurniture(kind, variant, state, seed);
  return memo(furnCache, ROOM_ART_CACHE_LIMITS.sprites, `${kind}|${n.variant ?? '-'}|${n.state}|${n.vseed}`, () => renderFurniture(kind, n.variant, n.state, n.vseed));
}

// ------------------------------------------------------------------ validation

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Finite number within the coordinate bound.
function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > COORD_MAX) throw new RangeError(name);
  return v;
}

// Non-negative edge no larger than EDGE_MAX.
function edge(v: unknown, name: string): number {
  const n = num(v, name);
  if (n < 0 || n > EDGE_MAX) throw new RangeError(name);
  return n;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length > STRING_MAX) throw new RangeError(name);
  return v;
}

function optStr(v: unknown, name: string): string | undefined {
  return v === undefined ? undefined : str(v, name);
}

// Array no longer than its limit.
function list(v: unknown, name: string, max: number): readonly unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new RangeError(name);
  return v;
}

function checkStyle(v: unknown): WallStyle {
  if (!isRecord(v)) throw new RangeError('style');
  const style: WallStyle = { base: str(v.base, 'style.base') };
  if (v.trim !== undefined) style.trim = str(v.trim, 'style.trim');
  if (v.pattern !== undefined) {
    if (typeof v.pattern !== 'string' || !(WALL_PATTERNS as readonly string[]).includes(v.pattern)) throw new RangeError('style.pattern');
    style.pattern = v.pattern as WallStyle['pattern'];
  }
  if (v.exterior !== undefined) style.exterior = v.exterior === true;
  return style;
}

// Validated and normalised copy of the input; throws RangeError before anything is drawn.
interface Checked {
  kind: RoomAreaKind;
  rect: { x: number; y: number; w: number; h: number };
  floors: { kind: FloorKind; x: number; y: number; w: number; h: number; seed: number; tint?: string; tint2?: string }[];
  rugs: { x: number; y: number; w: number; h: number; color: string; seed: number }[];
  walls: { kind: 'face' | 'south' | 'cap'; x: number; y: number; w: number; h: number; style: WallStyle; doorways: Doorway[] }[];
  wallItems: { id: string; kind: FurnitureKind; variant?: string; cx: number; baseY: number; on: 'face' | 'south' }[];
  furniture: { id: string; kind: FurnitureKind; variant?: string; tx: number; ty: number; dx: number; dy: number }[];
  floorTint?: string;
}

function checkInput(input: unknown): Checked {
  if (!isRecord(input)) throw new RangeError('input');
  if (typeof input.kind !== 'string' || !(AREA_KINDS as readonly string[]).includes(input.kind)) throw new RangeError('kind');
  const r = input.rect;
  if (!isRecord(r)) throw new RangeError('rect');
  const rect = { x: num(r.x, 'rect.x'), y: num(r.y, 'rect.y'), w: num(r.w, 'rect.w'), h: num(r.h, 'rect.h') };
  if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y)) throw new RangeError('rect');
  if (!Number.isInteger(rect.w) || !Number.isInteger(rect.h) || rect.w < 1 || rect.h < 1) throw new RangeError('rect');
  if (rect.w > ROOM_LAYER_LIMITS.maxTilesW || rect.h > ROOM_LAYER_LIMITS.maxTilesH) throw new RangeError('rect');
  const out: Checked = { kind: input.kind as RoomAreaKind, rect, floors: [], rugs: [], walls: [], wallItems: [], furniture: [] };
  for (const f of list(input.floors, 'floors', ROOM_LAYER_LIMITS.floors)) {
    if (!isRecord(f)) throw new RangeError('floor');
    if (typeof f.kind !== 'string' || !(FLOOR_KINDS as readonly string[]).includes(f.kind)) throw new RangeError('floor.kind');
    out.floors.push({ kind: f.kind as FloorKind, x: num(f.x, 'floor.x'), y: num(f.y, 'floor.y'), w: edge(f.w, 'floor.w'), h: edge(f.h, 'floor.h'), seed: num(f.seed, 'floor.seed'), tint: optStr(f.tint, 'floor.tint'), tint2: optStr(f.tint2, 'floor.tint2') });
  }
  for (const g of list(input.rugs, 'rugs', ROOM_LAYER_LIMITS.rugs)) {
    if (!isRecord(g)) throw new RangeError('rug');
    const rug = { x: num(g.x, 'rug.x'), y: num(g.y, 'rug.y'), w: edge(g.w, 'rug.w'), h: edge(g.h, 'rug.h'), color: str(g.color, 'rug.color'), seed: num(g.seed, 'rug.seed') };
    if (rug.w * rug.h > RUG_AREA_MAX) throw new RangeError('rug');
    out.rugs.push(rug);
  }
  for (const w of list(input.walls, 'walls', ROOM_LAYER_LIMITS.walls)) {
    if (!isRecord(w)) throw new RangeError('wall');
    if (w.kind !== 'face' && w.kind !== 'south' && w.kind !== 'cap') throw new RangeError('wall.kind');
    const doorways: Doorway[] = [];
    if (w.doorways !== undefined) {
      for (const d of list(w.doorways, 'doorways', ROOM_LAYER_LIMITS.doorways)) {
        if (!isRecord(d)) throw new RangeError('doorway');
        doorways.push({ x: num(d.x, 'doorway.x'), w: edge(d.w, 'doorway.w') });
      }
    }
    out.walls.push({ kind: w.kind, x: num(w.x, 'wall.x'), y: num(w.y, 'wall.y'), w: edge(w.w, 'wall.w'), h: w.h === undefined ? 0 : edge(w.h, 'wall.h'), style: checkStyle(w.style), doorways });
  }
  for (const it of list(input.wallItems, 'wallItems', ROOM_LAYER_LIMITS.wallItems)) {
    if (!isRecord(it)) throw new RangeError('wallItem');
    if (!isFurnitureKind(it.kind) || FURNITURE[it.kind].mount !== 'wall') throw new RangeError('wallItem.kind');
    if (it.on !== 'face' && it.on !== 'south') throw new RangeError('wallItem.on');
    out.wallItems.push({ id: str(it.id, 'wallItem.id'), kind: it.kind, variant: optStr(it.variant, 'wallItem.variant'), cx: num(it.cx, 'wallItem.cx'), baseY: num(it.baseY, 'wallItem.baseY'), on: it.on });
  }
  for (const f of list(input.furniture, 'furniture', ROOM_LAYER_LIMITS.furniture)) {
    if (!isRecord(f)) throw new RangeError('furniture');
    if (!isFurnitureKind(f.kind) || FURNITURE[f.kind].mount !== 'floor') throw new RangeError('furniture.kind');
    out.furniture.push({ id: str(f.id, 'furniture.id'), kind: f.kind, variant: optStr(f.variant, 'furniture.variant'), tx: num(f.tx, 'furniture.tx'), ty: num(f.ty, 'furniture.ty'), dx: f.dx === undefined ? 0 : num(f.dx, 'furniture.dx'), dy: f.dy === undefined ? 0 : num(f.dy, 'furniture.dy') });
  }
  if (input.floorTint !== undefined) out.floorTint = str(input.floorTint, 'floorTint');
  return out;
}

// ------------------------------------------------------------------ drawing helpers

// Visible world rectangle [x0, x1) by [y0, y1).
interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Fills a rectangle limited to the view (so a huge rectangle costs nothing extra).
function fillClip(buf: PixelBuf, v: View, x: number, y: number, w: number, h: number, c: string): void {
  const x0 = Math.max(x, v.x0);
  const y0 = Math.max(y, v.y0);
  const x1 = Math.min(x + w, v.x1);
  const y1 = Math.min(y + h, v.y1);
  if (x1 <= x0 || y1 <= y0) return;
  buf.rect(x0, y0, x1 - x0, y1 - y0, c);
}

// Draws a region of a piece at (dx, dy); the whole piece when the region covers it.
function blit(buf: PixelBuf, piece: PixelBuf, sx: number, sy: number, ex: number, ey: number, dx: number, dy: number): void {
  const whole = sx === 0 && sy === 0 && ex === piece.w && ey === piece.h;
  buf.draw(whole ? piece : piece.crop(sx, sy, ex - sx, ey - sy), dx, dy);
}

// Floor patch copied from world-aligned chunks.
function paintFloor(buf: PixelBuf, v: View, f: Checked['floors'][number]): void {
  const fx = Math.round(f.x);
  const fy = Math.round(f.y);
  const fw = Math.round(f.w);
  const fh = Math.round(f.h);
  const ax0 = Math.max(fx, v.x0);
  const ay0 = Math.max(fy, v.y0);
  const ax1 = Math.min(fx + fw, v.x1);
  const ay1 = Math.min(fy + fh, v.y1);
  if (ax1 <= ax0 || ay1 <= ay0) return;
  for (let cy = Math.floor(ay0 / CHUNK_PX); cy * CHUNK_PX < ay1; cy++) {
    for (let cx = Math.floor(ax0 / CHUNK_PX); cx * CHUNK_PX < ax1; cx++) {
      const key = `f|${f.kind}|${f.seed}|${f.tint ?? ''}|${f.tint2 ?? ''}|${cx}|${cy}`;
      const chunk = memo(chunkCache, ROOM_ART_CACHE_LIMITS.chunks, key, () => floorChunk(f.kind, cx, cy, { seed: f.seed, tint: f.tint, tint2: f.tint2 }));
      const px = cx * CHUNK_PX;
      const py = cy * CHUNK_PX;
      const sx = Math.max(0, ax0 - px);
      const sy = Math.max(0, ay0 - py);
      const ex = Math.min(CHUNK_PX, ax1 - px);
      const ey = Math.min(CHUNK_PX, ay1 - py);
      if (ex <= sx || ey <= sy) continue;
      blit(buf, chunk, sx, sy, ex, ey, px + sx, py + sy);
    }
  }
}

// Light room tone laid over the floor by multiply (10% of the colour towards white); only painted pixels change.
function tintFloor(buf: PixelBuf, color: string): void {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return;
  const n = parseInt(m[1], 16);
  const k = 0.1;
  const ch = (x: number) => Math.round(255 + (x - 255) * k);
  const mul = [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) d[i + c] = Math.round((d[i + c] * mul[c]) / 255);
  }
}

// Wall style key for the tile caches.
function styleKey(s: WallStyle): string {
  return `${s.base}|${s.trim ?? ''}|${s.pattern ?? 'plain'}|${s.exterior ? 1 : 0}`;
}

// Hash of a tile column (selects the face variant).
function tileHash(seed: number, tx: number, ty: number): number {
  let h = Math.imul(tx | 0, 0x9e3779b1) ^ Math.imul(ty | 0, 0x85ebca77) ^ Math.imul(seed | 0, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

// Parts [x0, x1) of a wall that are not doorways.
function solidSegments(x: number, w: number, doorways: readonly Doorway[]): [number, number][] {
  let segs: [number, number][] = [[x, x + w]];
  for (const d of doorways) {
    const next: [number, number][] = [];
    for (const [a, b] of segs) {
      const da = d.x;
      const db = d.x + d.w;
      if (db <= a || da >= b) {
        next.push([a, b]);
        continue;
      }
      if (da > a) next.push([a, da]);
      if (db < b) next.push([db, b]);
    }
    segs = next;
  }
  return segs;
}

// Tiles a span [x0, x1) with 16 px wide tiles at row y.
function drawTiled(buf: PixelBuf, v: View, x0: number, x1: number, y: number, h: number, tileFor: (tx: number) => PixelBuf): void {
  const hi = Math.min(x1, v.x1);
  for (let tx = Math.floor(Math.max(x0, v.x0) / TILE); tx * TILE < hi; tx++) {
    const px = tx * TILE;
    const sx = Math.max(0, x0 - px);
    const ex = Math.min(TILE, x1 - px);
    if (ex <= sx) continue;
    blit(buf, tileFor(tx), sx, 0, ex, h, px + sx, y);
  }
}

// North wall face of 2 tiles: tiles by column hash, jambs shaded beside doorways.
function paintWallFace(buf: PixelBuf, v: View, w: Checked['walls'][number], style: WallStyle): void {
  const sk = styleKey(style);
  const tileFor = (tx: number) => {
    const variant = tileHash(7, tx, 0) % 4;
    const col = tx & 1;
    return memo(pieceCache, ROOM_ART_CACHE_LIMITS.sprites, `w|${sk}|${variant}|${col}`, () => wallFaceTile(style, variant, col));
  };
  const jamb = shade(style.base, -0.14);
  const jambLight = shade(style.base, 0.04);
  const cap = capColor(style);
  const x = Math.round(w.x);
  const y = Math.round(w.y);
  const ww = Math.round(w.w);
  for (const [a, b] of solidSegments(x, ww, w.doorways)) {
    drawTiled(buf, v, a, b, y, WALL_FACE_H, tileFor);
    if (b < x + ww) {
      fillClip(buf, v, b - 2, y + WALL_CAP_H, 2, WALL_FACE_H - WALL_CAP_H, jamb);
      fillClip(buf, v, b - 1, y, 1, WALL_CAP_H, shade(cap, -0.08));
    }
    if (a > x) {
      fillClip(buf, v, a, y + WALL_CAP_H, 1, WALL_FACE_H - WALL_CAP_H, jambLight);
      fillClip(buf, v, a + 1, y + WALL_CAP_H, 1, WALL_FACE_H - WALL_CAP_H, jamb);
      fillClip(buf, v, a, y, 1, WALL_CAP_H, shade(cap, 0.06));
    }
  }
}

// Wall cap: a rectangle with a light top and left edge and a dark bottom and right edge.
function paintWallTop(buf: PixelBuf, v: View, w: Checked['walls'][number], style: WallStyle): void {
  const x = Math.round(w.x);
  const y = Math.round(w.y);
  const ww = Math.round(w.w);
  const h = Math.round(w.h);
  const cap = capColor(style);
  fillClip(buf, v, x, y, ww, h, cap);
  fillClip(buf, v, x, y, ww, 1, shade(cap, 0.08));
  if (ww > 2) fillClip(buf, v, x, y, 1, h, shade(cap, 0.08));
  if (h > 2) fillClip(buf, v, x, y + h - 1, ww, 1, shade(cap, -0.06));
  if (ww > 2) fillClip(buf, v, x + ww - 1, y, 1, h, shade(cap, -0.06));
}

// South wall of 1 tile: tiles by column modulo 4, edges shaded beside doorways.
function paintSouthWall(buf: PixelBuf, v: View, w: Checked['walls'][number], style: WallStyle): void {
  const sk = styleKey(style);
  const tileFor = (tx: number) => {
    const col = tx & 3;
    return memo(pieceCache, ROOM_ART_CACHE_LIMITS.sprites, `s|${sk}|${col}`, () => southWallTile(style, col));
  };
  const cap = capColor(style);
  const x = Math.round(w.x);
  const y = Math.round(w.y);
  const ww = Math.round(w.w);
  for (const [a, b] of solidSegments(x, ww, w.doorways)) {
    drawTiled(buf, v, a, b, y, TILE, tileFor);
    if (b < x + ww) fillClip(buf, v, b - 1, y, 1, TILE, shade(cap, -0.08));
    if (a > x) fillClip(buf, v, a, y, 1, TILE, shade(cap, 0.08));
  }
}

// ------------------------------------------------------------------ composition

// Sprite rectangle in layer pixels from a sprite origin and a sprite-relative rect.
function placed(ox: number, oy: number, r: Rect): Rect {
  return { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h };
}

// Draws a static overlay (screen, board, clock, window view) at a rect; rects without a positive integer size are skipped.
function overlay(buf: PixelBuf, r: Rect, make: (w: number, h: number) => PixelBuf): void {
  if (!Number.isInteger(r.w) || !Number.isInteger(r.h) || r.w < 1 || r.h < 1) return;
  buf.draw(make(r.w, r.h), r.x, r.y);
}

// Option value that must be one of a list (the default when undefined).
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, name: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new RangeError(name);
  return value as T;
}

// Renders one area into a base layer, a front layer and anchors. Deterministic: the same input gives the same bytes.
export function renderRoomLayer(input: RoomLayerInput, opts: RoomLayerOpts = {}): RoomLayers {
  const area = checkInput(input);
  if (!isRecord(opts)) throw new RangeError('opts');
  const theme = oneOf(opts.theme, SEASONAL_THEMES, 'none', 'theme');
  const screens = oneOf(opts.screens, SCREEN_MODES, 'standby', 'screens');
  const hour = opts.hour === undefined ? FIXED_DAY_HOUR : opts.hour;
  if (typeof hour !== 'number' || !Number.isFinite(hour)) throw new RangeError('hour');
  let crop = { x: 0, y: 0, w: area.rect.w, h: area.rect.h };
  if (opts.crop !== undefined) {
    const c = opts.crop;
    if (!isRecord(c) || ![c.x, c.y, c.w, c.h].every((n) => typeof n === 'number' && Number.isInteger(n))) throw new RangeError('crop');
    const k = { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number };
    if (k.x < 0 || k.y < 0 || k.w < 1 || k.h < 1 || k.x + k.w > area.rect.w || k.y + k.h > area.rect.h) throw new RangeError('crop');
    crop = k;
  }
  // The restroom is never decorated.
  const season: SeasonalTheme = area.kind === 'restroom' ? 'none' : theme;

  const wx0 = (area.rect.x + crop.x) * TILE;
  const wy0 = (area.rect.y + crop.y) * TILE;
  const outW = crop.w * TILE;
  const outH = crop.h * TILE;
  const v: View = { x0: wx0, y0: wy0, x1: wx0 + outW, y1: wy0 + outH };
  const base = new PixelBuf(outW, outH);
  base.ox = -wx0;
  base.oy = -wy0;
  const anchors: RoomAnchor[] = [];

  // Floors, room tone and rugs.
  for (const f of area.floors) paintFloor(base, v, f);
  if (area.floorTint) tintFloor(base, area.floorTint);
  for (const rug of area.rugs) {
    const rw = Math.max(4, Math.round(rug.w));
    const rh = Math.max(4, Math.round(rug.h));
    const color = seasonalRugColor(season, rug.color);
    const piece = memo(pieceCache, ROOM_ART_CACHE_LIMITS.sprites, `r|${rw}|${rh}|${color}|${rug.seed}`, () => renderRug(rw, rh, color, rug.seed));
    base.draw(piece, Math.round(rug.x), Math.round(rug.y));
    paintSeasonalRug(base, season, rug);
  }

  // Walls (face, then south, then cap) and their decoration.
  const order = { face: 0, south: 1, cap: 2 } as const;
  for (const w of [...area.walls].sort((a, b) => order[a.kind] - order[b.kind])) {
    const style = seasonalWallStyle(season, w.style);
    if (w.kind === 'face') paintWallFace(base, v, w, style);
    else if (w.kind === 'south') paintSouthWall(base, v, w, style);
    else paintWallTop(base, v, w, style);
  }
  for (const w of area.walls) paintSeasonalWall(base, season, w);

  // Wall items: fixed ones, then the dynamic ones, then the signs.
  const origin = (it: Checked['wallItems'][number], s: BufSprite): { x: number; y: number } =>
    it.on === 'south'
      ? { x: Math.round(it.cx - s.buf.w / 2), y: Math.round(it.baseY - TILE + 9 - s.buf.h / 2) }
      : { x: Math.round(it.cx - s.ax), y: Math.round(it.baseY - s.ay) };
  const wallItemBase = (it: Checked['wallItems'][number], variant: string | undefined): BufSprite =>
    furnitureOf(it.kind, variant, 0, hash32(it.id)).base;
  const signs: Checked['wallItems'] = [];
  const dynamic: Checked['wallItems'] = [];
  for (const it of area.wallItems) {
    if (it.kind === 'sign') signs.push(it);
    else if (DYNAMIC_WALL.has(it.kind)) dynamic.push(it);
    else {
      const s = wallItemBase(it, it.variant === 'wide' ? undefined : it.variant);
      const o = origin(it, s);
      base.draw(s.buf, o.x, o.y);
    }
  }
  for (const it of dynamic) {
    const seed = hash32(it.id);
    const s = wallItemBase(it, it.kind === 'light_switch' ? 'on' : it.variant);
    const o = origin(it, s);
    if (it.kind === 'window') {
      const r = s.rects?.glass ?? { x: 2, y: 2, w: s.buf.w - 4, h: s.buf.h - 4 };
      const glass = placed(o.x, o.y, r);
      overlay(base, glass, (w, h) => windowVariant(w, h, hour, seed));
      paintSeasonalWindow(base, season, glass, seed);
      base.draw(s.buf, o.x, o.y);
      continue;
    }
    base.draw(s.buf, o.x, o.y);
    if (it.kind === 'elevator') paintElevatorOrnament(base, season, it.cx, it.baseY);
    else if (it.kind === 'clock' && s.rects?.face) overlay(base, placed(o.x, o.y, s.rects.face), (w, h) => clockVariant(w, h, 10, 10, 0));
    else if (it.kind === 'whiteboard' && s.rects?.board) {
      const r = placed(o.x, o.y, s.rects.board);
      overlay(base, r, (w, h) => boardVariant(w, h, []));
      anchors.push({ kind: 'board', id: it.id, ...r });
    } else if (it.kind === 'tv' && s.rects?.tv) overlay(base, placed(o.x, o.y, s.rects.tv), (w, h) => screenVariant('show', w, h, seed));
  }
  for (const it of signs) {
    const s = wallItemBase(it, it.variant);
    const o = origin(it, s);
    base.draw(s.buf, o.x, o.y);
    const r = s.rects?.sign ?? { x: 3, y: 3, w: s.buf.w - 6, h: s.buf.h - 6 };
    anchors.push({ kind: 'sign', id: it.id, ...placed(o.x, o.y, r) });
  }

  // Floor furniture by anchor row, then input order; seasonal props replace plants.
  const props = seasonProps(season, { kind: area.kind, furniture: area.furniture });
  const placedFurniture = area.furniture.map((f, i) => {
    const def = FURNITURE[f.kind];
    return { f, i, ax: (f.tx + def.footprint.w / 2) * TILE + f.dx, ay: (f.ty + def.footprint.h) * TILE + f.dy };
  });
  placedFurniture.sort((a, b) => a.ay - b.ay || a.i - b.i);
  let front: PixelBuf | null = null;
  for (const { f, ax, ay } of placedFurniture) {
    const seed = hash32(f.id);
    const sprites = furnitureOf(f.kind, f.variant, 0, seed);
    const propKind = props.get(f.id);
    const seasonal = propKind ? seasonalSprite(propKind) : null;
    const s = seasonal ?? sprites.base;
    const dx = Math.round(ax - s.ax);
    const dy = Math.round(ay - s.ay);
    base.draw(s.buf, dx, dy);
    if (!seasonal && s.rects?.screen) {
      const r = placed(dx, dy, s.rects.screen);
      if (f.kind === 'desk') {
        overlay(base, r, (w, h) => screenVariant(screens, w, h, seed));
        anchors.push({ kind: 'screen', id: f.id, ...r });
      } else if (f.kind === 'arcade') overlay(base, r, (w, h) => screenVariant('game', w, h, seed));
    }
    if (sprites.front) {
      if (!front) {
        front = new PixelBuf(outW, outH);
        front.ox = -wx0;
        front.oy = -wy0;
      }
      front.draw(sprites.front.buf, Math.round(ax - sprites.front.ax), Math.round(ay - sprites.front.ay));
    }
  }
  paintSeasonalLights(base, season, { walls: area.walls });

  base.ox = 0;
  base.oy = 0;
  if (front) {
    front.ox = 0;
    front.oy = 0;
  }
  const kept = anchors
    .map((a) => ({ ...a, x: a.x - wx0, y: a.y - wy0 }))
    .filter((a) => a.x < outW && a.y < outH && a.x + a.w > 0 && a.y + a.h > 0);
  return { base, front, anchors: kept };
}
