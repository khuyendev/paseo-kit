// Port of habblaud client/src/world/layout/types.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// ExteriorProp is not ported (exterior props belong to the canvas world). Layout modules are pure data (D-09): they describe an office that a renderer draws and a walker moves through.
import type { Dir, FloorKind, FurnitureKind, WallStyle } from "./defs.ts";

export type AreaKind = "reception" | "restroom" | "cafe" | "lounge" | "room" | "corridor";

/** Rectangle in tiles (absolute world coordinates). */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Placed floor furniture. */
export interface FurniturePlacement {
  id: string;
  kind: FurnitureKind;
  variant?: string;
  /** Top-left corner of the footprint, in absolute tiles. */
  tx: number;
  ty: number;
  /** Draw offset in px (a chair centred on a 2-tile desk); the footprint is unaffected. */
  dx?: number;
  dy?: number;
  /** Relative order in the build animation (0..1). */
  order: number;
  /** Desks: the seat index (the screen follows whoever sits there). */
  seat?: string;
}

/** Wall-mounted item. `cx` is the centre in world px; `baseY` the baseboard line in px. */
export interface WallItemPlacement {
  id: string;
  kind: FurnitureKind;
  variant?: string;
  cx: number;
  baseY: number;
  /** 'face' = north wall face; 'south' = on the low south wall. */
  on: "face" | "south";
  order: number;
}

export interface Doorway {
  x: number;
  w: number;
}

/** Wall run in world px. */
export type WallSegment =
  | { kind: "face"; x: number; y: number; w: number; style: WallStyle; doorways?: Doorway[] }
  | { kind: "south"; x: number; y: number; w: number; style: WallStyle; doorways?: Doorway[] }
  | { kind: "cap"; x: number; y: number; w: number; h: number; style: WallStyle };

export interface FloorPatch {
  kind: FloorKind;
  /** world px */
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  tint?: string;
  tint2?: string;
}

export interface RugPatch {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  seed: number;
}

export type SpotKind =
  | "desk" // workplace (desk + chair)
  | "stool" // meeting table stool
  | "nook" // armchair or beanbag inside a project room (extra workplace, with a laptop)
  | "stand" // standing point inside the room (work without a desk)
  | "switch" // light switch
  | "whiteboard"
  | "coffee"
  | "water"
  | "snack"
  | "fridge"
  | "cafe_seat"
  | "sofa"
  | "armchair"
  | "beanbag"
  | "bench"
  | "pingpong"
  | "arcade"
  | "shelf"
  | "window"
  | "stall"
  | "sink"
  | "elevator"
  | "talk"
  | "watch"; // standing point of the crowd (watching a match)

/**
 * Point of interest. A character walks to the approach tile (tx, ty), which is walkable,
 * and then snaps to the final position (x, y) in px, facing `dir`.
 */
export interface SpotDef {
  id: string;
  kind: SpotKind;
  areaId: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  dir: Dir;
  seated?: boolean;
  /** Linked furniture (chair, machine, stall). */
  furnitureId?: string;
  /** Depth to use while occupied (seats: just after the furniture). */
  sortY?: number;
  /** Paired spots (ping-pong, conversation) share a group. */
  group?: string;
  /** Desk whose screen follows whoever sits here. */
  deskId?: string;
  /** Preference order (desks). */
  rank?: number;
  /** Side of the island: 'S' = back to the camera (screen visible), 'N' = facing it (desk_back). */
  side?: "S" | "N";
}

export interface AreaLayout {
  id: string;
  kind: AreaKind;
  /** Area rectangle in absolute tiles. */
  rect: TileRect;
  floors: FloorPatch[];
  rugs: RugPatch[];
  walls: WallSegment[];
  wallItems: WallItemPlacement[];
  furniture: FurniturePlacement[];
  spots: SpotDef[];
  /** Walkable tiles (absolute), besides the ones furniture blocks. */
  walkable: TileRect[];
  /** Explicitly blocked tiles (partitions drawn as floor, and so on). */
  blocked?: TileRect[];
  /** Door tiles (absolute). */
  door?: TileRect;
  /** Project rooms: the side of the corridor they are on. */
  side?: "north" | "south";
  /** Colour (hex) laid lightly over the floor so each room has its own identity. */
  floorTint?: string;
  /** Rectangle (px) darkened when the light is off. */
  shade?: { x: number; y: number; w: number; h: number };
  /** Id of the wall item that carries the room name. */
  signId?: string;
}
