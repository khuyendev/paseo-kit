// Port of habblaud client/src/world/layout/builder.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Area builder in LOCAL coordinates (tiles relative to the area corner): converts to absolute coordinates and registers spots consistently (D-09: pure data).
import { FOOT_DX, FOOT_DY, TILE } from "./constants.ts";
import { FURNITURE } from "./defs.ts";
import type { Dir, FloorKind, FurnitureKind, WallStyle } from "./defs.ts";
import type { AreaKind, AreaLayout, Doorway, FurniturePlacement, SpotDef, SpotKind, TileRect } from "./types.ts";

/** Feet of a seated character: px above the base of the seat. */
export const SEAT_FOOT_DY = 3;
/** Extra depth of a seated character (just after the seat, before the backrest). */
export const SEATED_SORT_BIAS = 0.25;

export interface SpotOpts {
  /** Offset of the final position (px). */
  dx?: number;
  dy?: number;
  seated?: boolean;
  furnitureId?: string;
  sortY?: number;
  group?: string;
  deskId?: string;
  rank?: number;
  side?: "S" | "N";
  /** Absolute final position in px (replaces the tile based one). */
  x?: number;
  y?: number;
}

export interface AreaBuilder {
  readonly area: AreaLayout;
  readonly x0: number;
  readonly y0: number;
  /** Absolute px of a local tile coordinate (fractions allowed). */
  px(lx: number): number;
  py(ly: number): number;
  floor(kind: FloorKind, lx: number, ly: number, w: number, h: number, seed: number, tint?: string, tint2?: string): AreaBuilder;
  rug(lx: number, ly: number, w: number, h: number, color: string, seed: number): AreaBuilder;
  /** North wall face (2 tiles) between lx and lx+w (local tiles, fractions allowed). */
  face(lx: number, w: number, style: WallStyle, doorways?: { lx: number; w: number }[], ly?: number): AreaBuilder;
  south(lx: number, w: number, ly: number, style: WallStyle, doorways?: { lx: number; w: number }[]): AreaBuilder;
  cap(lx: number, ly: number, w: number, h: number, style: WallStyle): AreaBuilder;
  /** Wall item centred on `lcx` (local tiles). `ly` = local baseboard row (default 2 = base of the north face). */
  wall(kind: FurnitureKind, lcx: number, variant?: string, opts?: { ly?: number; on?: "face" | "south"; order?: number }): string;
  /** Floor furniture with the top-left corner of its footprint at (lx, ly). */
  furn(kind: FurnitureKind, lx: number, ly: number, variant?: string, opts?: { dx?: number; dy?: number; order?: number; seat?: string }): string;
  /** Spot approached from the local tile (lx, ly). The default final position puts the feet on the tile. */
  spot(kind: SpotKind, lx: number, ly: number, dir: Dir, opts?: SpotOpts): SpotDef;
  /**
   * Seat (chair, stool, armchair...) at the local tile (lx, ly). The character approaches through the
   * seat tile itself and snaps to the seat position (optional `dx` in px).
   */
  seat(kind: SpotKind, furnitureKind: FurnitureKind, lx: number, ly: number, dir: Dir, variant?: string, opts?: SpotOpts & { order?: number; noFurniture?: boolean }): SpotDef;
  walk(lx: number, ly: number, w: number, h: number): AreaBuilder;
  block(lx: number, ly: number, w: number, h: number): AreaBuilder;
  build(): AreaLayout;
}

// The upstream class is a factory here: the phone app's Hermes cannot compile class syntax in plugin client code.
export function createAreaBuilder(id: string, kind: AreaKind, rect: TileRect): AreaBuilder {
  const area: AreaLayout = { id, kind, rect, floors: [], rugs: [], walls: [], wallItems: [], furniture: [], spots: [], walkable: [] };
  let seq = 0;
  const px = (lx: number): number => (area.rect.x + lx) * TILE;
  const py = (ly: number): number => (area.rect.y + ly) * TILE;
  const doors = (list: { lx: number; w: number }[]): Doorway[] | undefined => (list.length ? list.map((d) => ({ x: px(d.lx), w: d.w * TILE })) : undefined);

  const b: AreaBuilder = {
    area,
    get x0() {
      return area.rect.x;
    },
    get y0() {
      return area.rect.y;
    },
    px,
    py,

    floor(kind, lx, ly, w, h, seed, tint, tint2) {
      area.floors.push({ kind, x: px(lx), y: py(ly), w: w * TILE, h: h * TILE, seed, tint, tint2 });
      return b;
    },

    rug(lx, ly, w, h, color, seed) {
      area.rugs.push({ x: Math.round(px(lx)), y: Math.round(py(ly)), w: Math.round(w * TILE), h: Math.round(h * TILE), color, seed });
      return b;
    },

    face(lx, w, style, doorways = [], ly = 0) {
      area.walls.push({ kind: "face", x: px(lx), y: py(ly), w: w * TILE, style, doorways: doors(doorways) });
      return b;
    },

    south(lx, w, ly, style, doorways = []) {
      area.walls.push({ kind: "south", x: px(lx), y: py(ly), w: w * TILE, style, doorways: doors(doorways) });
      return b;
    },

    cap(lx, ly, w, h, style) {
      area.walls.push({ kind: "cap", x: px(lx), y: py(ly), w: w * TILE, h: h * TILE, style });
      return b;
    },

    wall(kind, lcx, variant, opts = {}) {
      const id = `${area.id}#w${seq++}:${kind}`;
      area.wallItems.push({
        id,
        kind,
        variant,
        cx: Math.round(px(lcx)),
        baseY: py(opts.ly ?? 2),
        on: opts.on ?? "face",
        order: opts.order ?? 0.5,
      });
      return id;
    },

    furn(kind, lx, ly, variant, opts = {}) {
      const id = `${area.id}#f${seq++}:${kind}`;
      const f: FurniturePlacement = {
        id,
        kind,
        variant,
        tx: b.x0 + lx,
        ty: b.y0 + ly,
        dx: opts.dx,
        dy: opts.dy,
        order: opts.order ?? 0.5,
        seat: opts.seat,
      };
      area.furniture.push(f);
      return id;
    },

    spot(kind, lx, ly, dir, opts = {}) {
      const tx = b.x0 + lx;
      const ty = b.y0 + ly;
      const s: SpotDef = {
        id: `${area.id}#s${seq++}:${kind}`,
        kind,
        areaId: area.id,
        tx,
        ty,
        x: opts.x ?? tx * TILE + FOOT_DX + (opts.dx ?? 0),
        y: opts.y ?? ty * TILE + FOOT_DY + (opts.dy ?? 0),
        dir,
        seated: opts.seated,
        furnitureId: opts.furnitureId,
        sortY: opts.sortY,
        group: opts.group,
        deskId: opts.deskId,
        rank: opts.rank,
        side: opts.side,
      };
      area.spots.push(s);
      return s;
    },

    seat(kind, furnitureKind, lx, ly, dir, variant, opts = {}) {
      const furnitureId = opts.noFurniture ? opts.furnitureId : b.furn(furnitureKind, lx, ly, variant, { dx: opts.dx, order: opts.order });
      const base = py(ly + 1);
      return b.spot(kind, lx, ly, dir, {
        ...opts,
        furnitureId,
        seated: true,
        x: px(lx) + TILE / 2 + (opts.dx ?? 0),
        y: base - SEAT_FOOT_DY + (opts.dy ?? 0),
        sortY: base + SEATED_SORT_BIAS,
      });
    },

    walk(lx, ly, w, h) {
      area.walkable.push({ x: b.x0 + lx, y: b.y0 + ly, w, h });
      return b;
    },

    block(lx, ly, w, h) {
      (area.blocked ??= []).push({ x: b.x0 + lx, y: b.y0 + ly, w, h });
      return b;
    },

    build: () => area,
  };
  return b;
}

/** Whether floor furniture of this kind blocks its tiles. */
export function furnitureBlocks(kind: FurnitureKind): boolean {
  const def = FURNITURE[kind];
  return def.mount === "floor" && def.blocks;
}

/** Whether floor furniture of this kind is a seat (walkable, but avoided by A*). */
export function furnitureIsSeat(kind: FurnitureKind): boolean {
  const def = FURNITURE[kind];
  return def.mount === "floor" && !!def.seat;
}
