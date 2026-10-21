// Port of habblaud client/src/world/constants.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Subset (D-01, D-09): exterior margins, zoom limits and room timing stay out (canvas world, plan 07-08); TILE is defined here because upstream re-exports it from art/api.
export const TILE = 16;

/** Width of one building column (one room to the north plus one to the south). */
export const COL_W = 16;
/** Height of a room: 2 rows of north wall face, 9 of floor, 1 of south wall. */
export const ROOM_H = 12;
/** Height of the corridor that cuts the building from west to east. */
export const CORRIDOR_H = 5;
/** Core columns (reception over restroom, cafe over lounge). */
export const CORE_COLS = 2;

export const NORTH_Y = 0;
export const CORRIDOR_Y = ROOM_H;
export const SOUTH_Y = ROOM_H + CORRIDOR_H;
export const BUILDING_H = ROOM_H * 2 + CORRIDOR_H;

/** First local column of the 2-tile room door. */
export const DOOR_X = 7;
export const DOOR_W = 2;

/** Speeds in world px per second. */
export const WALK_SPEED = 3.2 * TILE;
export const RUN_SPEED = 6 * TILE;

/** Offset of the feet inside the tile a character stands on. */
export const FOOT_DX = TILE / 2;
export const FOOT_DY = 11;
