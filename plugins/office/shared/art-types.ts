// Shared art constants and types: plain data only, no Node builtin, no React, nothing from server/.
// Pose, rect and character-sheet values follow marmottajr/habblaud client/src/art at faa1a012b5fbf632c66dc6801c5383e53a542406.

// Edge of one floor tile in pixels.
export const TILE = 16;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Dynamic regions inside a sprite, in sprite pixels relative to its top-left corner.
export type SpriteRectName = "screen" | "board" | "glass" | "face" | "tv" | "sign" | "art" | "glow" | "screen2";

export type Dir = "down" | "up" | "left" | "right";

// 20 poses, 46 frames in total.
export const POSE_FRAMES = {
  stand: 2,
  walk: 4,
  run: 4,
  sit: 2,
  type: 4,
  sleep: 2,
  drink: 2,
  use: 2,
  raise_hand: 2,
  talk: 2,
  stretch: 2,
  read: 2,
  play: 2,
  wait: 2,
  cheer: 2,
  laugh: 2,
  game: 2,
  rps: 2,
  groom: 2,
  sulk: 2,
} as const;

export type Pose = keyof typeof POSE_FRAMES;

// Ordered pose names: the canonical order of a pose set inside a sprite key.
export const POSE_NAMES = Object.keys(POSE_FRAMES) as readonly Pose[];

// Character sheet: 24x34 px with the anchor at the centre of the feet.
export const CHAR_W = 24;
export const CHAR_H = 34;
export const CHAR_AX = 12;
export const CHAR_AY = 31;

// Integer scales a sprite may be shipped at; the spike (07-03) picks the subset kept as ZOOM_LEVELS.
export const ZOOM_CANDIDATES = [2, 3, 4] as const;
export type ZoomCandidate = (typeof ZOOM_CANDIDATES)[number];
