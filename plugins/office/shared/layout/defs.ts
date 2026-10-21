// Port of habblaud client/src/art/api.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Subset (D-01, D-09): only the pure geometry data (Dir, FloorKind, WallStyle, RoomTheme, FurnitureKind and the footprint table); sprites, poses, icons and every canvas member stay out.

export type Dir = "down" | "up" | "left" | "right";

export type FloorKind =
  | "carpet" // project rooms (tinted by the room theme)
  | "wood" // lounge
  | "tile_check" // cafe (checkerboard)
  | "tile_white" // restroom
  | "concrete" // corridor
  | "marble" // reception
  | "grass" // outdoors
  | "sidewalk" // outdoors
  | "street"; // outdoors

export type WallPattern = "plain" | "stripes" | "tiles" | "wood_panel" | "brick" | "glass" | "marble";

export interface WallStyle {
  /** Base colour of the wall face. */
  base: string;
  /** Detail colour (baseboard and stripe). */
  trim?: string;
  pattern?: WallPattern;
  /** Outer building wall (a plainer tone). */
  exterior?: boolean;
}

export interface RoomTheme {
  carpet: string;
  carpet2: string;
  wall: WallStyle;
  accent: string;
  deskVariant: string;
  chairVariant: string;
}

export type FurnitureKind =
  // project rooms
  | "desk"
  | "desk_back"
  | "office_chair_front"
  | "office_chair"
  | "bookshelf"
  | "filing_cabinet"
  | "printer"
  | "trash_bin"
  | "plant_small"
  | "plant_tall"
  | "glass_partition"
  | "binder_shelf"
  | "meeting_table"
  | "stool"
  | "floor_lamp"
  | "water_cooler"
  // wall mounted
  | "whiteboard"
  | "window"
  | "clock"
  | "poster"
  | "painting"
  | "tv"
  | "light_switch"
  | "elevator"
  | "door_frame"
  | "sign"
  | "mirror"
  | "shelf_wall"
  // cafe
  | "counter"
  | "counter_sink"
  | "coffee_machine"
  | "microwave"
  | "fridge"
  | "vending_machine"
  | "cafe_table"
  | "cafe_chair"
  // lounge
  | "sofa"
  | "armchair"
  | "coffee_table"
  | "pingpong_table"
  | "beanbag"
  | "arcade"
  // restroom
  | "toilet_stall"
  | "sink"
  // reception
  | "reception_desk"
  | "bench";

/** Geometry of a furniture kind; the sprite-side fields (variants, states) belong to the server art port. */
export interface FurnitureDef {
  mount: "floor" | "wall";
  /** Floor: tiles taken on the ground (w x h). Wall: width in tiles on the wall face (h is 0). */
  footprint: { w: number; h: number };
  /** Floor: whether the tiles block walking. Seats do not block (the character steps into them). */
  blocks: boolean;
  /** A character can sit on it. */
  seat?: boolean;
}

/** Furniture catalogue, geometry only. */
export const FURNITURE: Readonly<Record<FurnitureKind, FurnitureDef>> = {
  desk: { mount: "floor", footprint: { w: 2, h: 1 }, blocks: true },
  desk_back: { mount: "floor", footprint: { w: 2, h: 1 }, blocks: true },
  office_chair_front: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: false, seat: true },
  office_chair: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: false, seat: true },
  bookshelf: { mount: "floor", footprint: { w: 2, h: 1 }, blocks: true },
  filing_cabinet: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  printer: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  trash_bin: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  plant_small: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  plant_tall: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  glass_partition: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  binder_shelf: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  meeting_table: { mount: "floor", footprint: { w: 3, h: 2 }, blocks: true },
  stool: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: false, seat: true },
  floor_lamp: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  water_cooler: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  whiteboard: { mount: "wall", footprint: { w: 3, h: 0 }, blocks: false },
  window: { mount: "wall", footprint: { w: 2, h: 0 }, blocks: false },
  clock: { mount: "wall", footprint: { w: 1, h: 0 }, blocks: false },
  poster: { mount: "wall", footprint: { w: 1, h: 0 }, blocks: false },
  painting: { mount: "wall", footprint: { w: 2, h: 0 }, blocks: false },
  tv: { mount: "wall", footprint: { w: 2, h: 0 }, blocks: false },
  light_switch: { mount: "wall", footprint: { w: 1, h: 0 }, blocks: false },
  elevator: { mount: "wall", footprint: { w: 2, h: 0 }, blocks: false },
  door_frame: { mount: "wall", footprint: { w: 2, h: 0 }, blocks: false },
  sign: { mount: "wall", footprint: { w: 3, h: 0 }, blocks: false },
  mirror: { mount: "wall", footprint: { w: 1, h: 0 }, blocks: false },
  shelf_wall: { mount: "wall", footprint: { w: 2, h: 0 }, blocks: false },
  counter: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  counter_sink: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  coffee_machine: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  microwave: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  fridge: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  vending_machine: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  cafe_table: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  cafe_chair: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: false, seat: true },
  sofa: { mount: "floor", footprint: { w: 3, h: 1 }, blocks: false, seat: true },
  armchair: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: false, seat: true },
  coffee_table: { mount: "floor", footprint: { w: 2, h: 1 }, blocks: true },
  pingpong_table: { mount: "floor", footprint: { w: 3, h: 2 }, blocks: true },
  beanbag: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: false, seat: true },
  arcade: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  toilet_stall: { mount: "floor", footprint: { w: 2, h: 2 }, blocks: true },
  sink: { mount: "floor", footprint: { w: 1, h: 1 }, blocks: true },
  reception_desk: { mount: "floor", footprint: { w: 3, h: 1 }, blocks: true },
  bench: { mount: "floor", footprint: { w: 2, h: 1 }, blocks: false, seat: true },
};
