// Port of habblaud client/src/art/api.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt).
// Subset: FloorKind, WallPattern, WallStyle and Doorway; the ordered lists are new.

// Floor kinds.
export type FloorKind =
  | 'carpet'
  | 'wood'
  | 'tile_check'
  | 'tile_white'
  | 'concrete'
  | 'marble'
  | 'grass'
  | 'sidewalk'
  | 'street';

// Wall texture patterns.
export type WallPattern = 'plain' | 'stripes' | 'tiles' | 'wood_panel' | 'brick' | 'glass' | 'marble';

// Wall look: base colour, optional trim colour and pattern, and an exterior flag for the building shell.
export interface WallStyle {
  base: string;
  trim?: string;
  pattern?: WallPattern;
  exterior?: boolean;
}

// Gap in a wall: start in absolute world pixels and width in pixels.
export interface Doorway {
  x: number;
  w: number;
}

// Floor kinds in a fixed order (used to validate input).
export const FLOOR_KINDS: readonly FloorKind[] = ['carpet', 'wood', 'tile_check', 'tile_white', 'concrete', 'marble', 'grass', 'sidewalk', 'street'];

// Wall patterns in a fixed order (used to validate input).
export const WALL_PATTERNS: readonly WallPattern[] = ['plain', 'stripes', 'tiles', 'wood_panel', 'brick', 'glass', 'marble'];
