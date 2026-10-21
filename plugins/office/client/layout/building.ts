// Port of habblaud client/src/world/layout/building.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Additions: the flat `areas` field, fresh core areas per call, ROOM_ID_PREFIX and buildBuilding(rooms, version) with input validation (OFFC-14: room ids are opaque keys, never a uri or style).
// Building assembly: core + corridor + project rooms -> walk grid and spots (D-04: even slots north of the corridor, odd slots south).
import { BUILDING_H, COL_W } from "./constants.ts";
import { FURNITURE } from "./defs.ts";
import { BLOCKED, FREE, MAX_GRID_CELLS, SEAT, WalkGrid } from "../path/grid.ts";
import { furnitureBlocks, furnitureIsSeat } from "./builder.ts";
import { layoutCafe, layoutLounge, layoutReception, layoutRestroom } from "./core.ts";
import { layoutCorridor } from "./corridor.ts";
import { buildingRect, columnsFor } from "./geometry.ts";
import { layoutProjectRoom } from "./room.ts";
import type { RoomInput } from "./room.ts";
import { roomThemeFor } from "./theme.ts";
import type { AreaLayout, SpotDef, TileRect } from "./types.ts";

export interface BuildingLayout {
  cols: number;
  rect: TileRect;
  core: AreaLayout[];
  corridor: AreaLayout;
  rooms: AreaLayout[];
  /** Core areas, corridor and rooms, in that order. */
  areas: AreaLayout[];
  grid: WalkGrid;
  spots: SpotDef[];
}

/** Prefix of every project room area id, so a room id can never equal a core area id. */
export const ROOM_ID_PREFIX = "room:";

/** The fixed core areas, built fresh on every call so two buildings never share a mutable object. */
export function coreAreas(): AreaLayout[] {
  return [layoutReception(), layoutRestroom(), layoutCafe(), layoutLounge()];
}

/** Mark the walkable cells of an area on the grid, then its blocks and seats. */
export function paintArea(grid: WalkGrid, area: AreaLayout): void {
  for (const r of area.walkable) grid.fill(r.x, r.y, r.w, r.h, FREE);
  for (const r of area.blocked ?? []) grid.fill(r.x, r.y, r.w, r.h, BLOCKED);
  for (const f of area.furniture) {
    const def = FURNITURE[f.kind];
    if (def.mount !== "floor") continue;
    const { w, h } = def.footprint;
    if (furnitureBlocks(f.kind)) grid.fill(f.tx, f.ty, w, h, BLOCKED);
    else if (furnitureIsSeat(f.kind)) {
      for (let y = f.ty; y < f.ty + h; y++) for (let x = f.tx; x < f.tx + w; x++) if (grid.get(x, y) === FREE) grid.set(x, y, SEAT);
    }
  }
}

export function buildWalkGrid(cols: number, areas: readonly AreaLayout[], version = 0): WalkGrid {
  const grid = new WalkGrid(cols * COL_W, BUILDING_H, version);
  for (const a of areas) paintArea(grid, a);
  return grid;
}

export function assembleBuilding(cols: number, rooms: readonly AreaLayout[], version = 0): BuildingLayout {
  const core = coreAreas();
  const corridor = layoutCorridor(cols);
  const all = [...core, corridor, ...rooms];
  const grid = buildWalkGrid(cols, all, version);
  const spots: SpotDef[] = [];
  for (const a of all) spots.push(...a.spots);
  return { cols, rect: buildingRect(cols), core, corridor, rooms: [...rooms], areas: all, grid, spots };
}

/** Throws RangeError for a bad slot, seed or id; nothing is built before the whole input has been checked. */
function validateRooms(rooms: readonly RoomInput[]): void {
  const ids = new Set<string>();
  const slots = new Set<number>();
  for (const r of rooms) {
    if (typeof r.id !== "string") throw new RangeError("room id must be a string");
    if (ids.has(r.id)) throw new RangeError(`duplicate room id ${JSON.stringify(r.id)}`);
    ids.add(r.id);
    if (!Number.isInteger(r.slot) || r.slot < 0) throw new RangeError(`room slot ${r.slot} must be a non-negative integer`);
    if (slots.has(r.slot)) throw new RangeError(`duplicate room slot ${r.slot}`);
    slots.add(r.slot);
    if (typeof r.seed !== "number" || !Number.isFinite(r.seed)) throw new RangeError(`room seed ${r.seed} must be a finite number`);
  }
}

/** One building for a list of project rooms: each room sits at slotRect(slot) and its area id is ROOM_ID_PREFIX + id. */
export function buildBuilding(rooms: readonly RoomInput[], version = 0): BuildingLayout {
  validateRooms(rooms);
  const cols = columnsFor(rooms.map((r) => r.slot));
  if (cols * COL_W * BUILDING_H > MAX_GRID_CELLS) throw new RangeError(`${cols} building columns exceed the ${MAX_GRID_CELLS} cell walk grid cap`);
  const areas = rooms.map((r) => layoutProjectRoom({ id: ROOM_ID_PREFIX + r.id, slot: r.slot, seed: r.seed }, roomThemeFor(r.seed)));
  return assembleBuilding(cols, areas, version);
}
