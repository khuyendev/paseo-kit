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

export class AreaBuilder {
  readonly area: AreaLayout;
  private seq: number;

  constructor(id: string, kind: AreaKind, rect: TileRect) {
    this.area = { id, kind, rect, floors: [], rugs: [], walls: [], wallItems: [], furniture: [], spots: [], walkable: [] };
    this.seq = 0;
  }

  get x0(): number {
    return this.area.rect.x;
  }

  get y0(): number {
    return this.area.rect.y;
  }

  /** Absolute px of a local tile coordinate (fractions allowed). */
  px(lx: number): number {
    return (this.x0 + lx) * TILE;
  }

  py(ly: number): number {
    return (this.y0 + ly) * TILE;
  }

  floor(kind: FloorKind, lx: number, ly: number, w: number, h: number, seed: number, tint?: string, tint2?: string): this {
    this.area.floors.push({ kind, x: this.px(lx), y: this.py(ly), w: w * TILE, h: h * TILE, seed, tint, tint2 });
    return this;
  }

  rug(lx: number, ly: number, w: number, h: number, color: string, seed: number): this {
    this.area.rugs.push({ x: Math.round(this.px(lx)), y: Math.round(this.py(ly)), w: Math.round(w * TILE), h: Math.round(h * TILE), color, seed });
    return this;
  }

  /** North wall face (2 tiles) between lx and lx+w (local tiles, fractions allowed). */
  face(lx: number, w: number, style: WallStyle, doorways: { lx: number; w: number }[] = [], ly = 0): this {
    this.area.walls.push({ kind: "face", x: this.px(lx), y: this.py(ly), w: w * TILE, style, doorways: this.doors(doorways) });
    return this;
  }

  south(lx: number, w: number, ly: number, style: WallStyle, doorways: { lx: number; w: number }[] = []): this {
    this.area.walls.push({ kind: "south", x: this.px(lx), y: this.py(ly), w: w * TILE, style, doorways: this.doors(doorways) });
    return this;
  }

  cap(lx: number, ly: number, w: number, h: number, style: WallStyle): this {
    this.area.walls.push({ kind: "cap", x: this.px(lx), y: this.py(ly), w: w * TILE, h: h * TILE, style });
    return this;
  }

  private doors(list: { lx: number; w: number }[]): Doorway[] | undefined {
    return list.length ? list.map((d) => ({ x: this.px(d.lx), w: d.w * TILE })) : undefined;
  }

  /** Wall item centred on `lcx` (local tiles). `ly` = local baseboard row (default 2 = base of the north face). */
  wall(kind: FurnitureKind, lcx: number, variant?: string, opts: { ly?: number; on?: "face" | "south"; order?: number } = {}): string {
    const id = `${this.area.id}#w${this.seq++}:${kind}`;
    this.area.wallItems.push({
      id,
      kind,
      variant,
      cx: Math.round(this.px(lcx)),
      baseY: this.py(opts.ly ?? 2),
      on: opts.on ?? "face",
      order: opts.order ?? 0.5,
    });
    return id;
  }

  /** Floor furniture with the top-left corner of its footprint at (lx, ly). */
  furn(kind: FurnitureKind, lx: number, ly: number, variant?: string, opts: { dx?: number; dy?: number; order?: number; seat?: string } = {}): string {
    const id = `${this.area.id}#f${this.seq++}:${kind}`;
    const f: FurniturePlacement = {
      id,
      kind,
      variant,
      tx: this.x0 + lx,
      ty: this.y0 + ly,
      dx: opts.dx,
      dy: opts.dy,
      order: opts.order ?? 0.5,
      seat: opts.seat,
    };
    this.area.furniture.push(f);
    return id;
  }

  /** Spot approached from the local tile (lx, ly). The default final position puts the feet on the tile. */
  spot(kind: SpotKind, lx: number, ly: number, dir: Dir, opts: SpotOpts = {}): SpotDef {
    const tx = this.x0 + lx;
    const ty = this.y0 + ly;
    const s: SpotDef = {
      id: `${this.area.id}#s${this.seq++}:${kind}`,
      kind,
      areaId: this.area.id,
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
    this.area.spots.push(s);
    return s;
  }

  /**
   * Seat (chair, stool, armchair...) at the local tile (lx, ly). The character approaches through the
   * seat tile itself and snaps to the seat position (optional `dx` in px).
   */
  seat(kind: SpotKind, furnitureKind: FurnitureKind, lx: number, ly: number, dir: Dir, variant?: string, opts: SpotOpts & { order?: number; noFurniture?: boolean } = {}): SpotDef {
    const furnitureId = opts.noFurniture ? opts.furnitureId : this.furn(furnitureKind, lx, ly, variant, { dx: opts.dx, order: opts.order });
    const base = this.py(ly + 1);
    return this.spot(kind, lx, ly, dir, {
      ...opts,
      furnitureId,
      seated: true,
      x: this.px(lx) + TILE / 2 + (opts.dx ?? 0),
      y: base - SEAT_FOOT_DY + (opts.dy ?? 0),
      sortY: base + SEATED_SORT_BIAS,
    });
  }

  walk(lx: number, ly: number, w: number, h: number): this {
    this.area.walkable.push({ x: this.x0 + lx, y: this.y0 + ly, w, h });
    return this;
  }

  block(lx: number, ly: number, w: number, h: number): this {
    (this.area.blocked ??= []).push({ x: this.x0 + lx, y: this.y0 + ly, w, h });
    return this;
  }

  build(): AreaLayout {
    return this.area;
  }
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
