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
// PROVISIONAL: the owner waived the D-12 spike on 2026-10-21 (07-SPIKE.md, SPIKE_WAIVER); crispness was not measured, so only the
// two smallest candidates are kept. Replace with the recorded levels when the measurement is taken.
export const ZOOM_LEVELS: readonly ZoomCandidate[] = [2, 3];
export type ZoomCandidate = (typeof ZOOM_CANDIDATES)[number];

// Character sheet layout (07-03), the contract for 07-04 (renderCharacterSheet) and 07-08 (frame stepping):
// one row per pose and direction, one column per frame. Rows run pose by pose in POSE_NAMES order, each pose
// holding the DIRS in order; columns are the frames of the pose (unused columns of shorter poses stay transparent).
export const DIRS = ["down", "up", "left", "right"] as const satisfies readonly Dir[];

// Unique poses of a set in POSE_NAMES order; throws RangeError for an empty set or an unknown pose.
export function canonicalPoses(poses: readonly Pose[]): readonly Pose[] {
  if (!Array.isArray(poses) || poses.length === 0) throw new RangeError("poses");
  if (poses.some((p) => !(POSE_NAMES as readonly string[]).includes(p))) throw new RangeError("poses");
  const wanted = new Set<string>(poses);
  return POSE_NAMES.filter((name) => wanted.has(name));
}

// Grid size of the sheet in cells: cols is the largest frame count among the poses.
export function sheetSize(poses: readonly Pose[]): { cols: number; rows: number } {
  const set = canonicalPoses(poses);
  return { cols: Math.max(...set.map((p) => POSE_FRAMES[p])), rows: set.length * DIRS.length };
}

// Cell of one frame; throws RangeError for a pose outside the set, a direction outside DIRS or a bad frame.
export function sheetCell(poses: readonly Pose[], pose: Pose, dir: Dir, frame: number): { col: number; row: number } {
  const set = canonicalPoses(poses);
  const poseIndex = set.indexOf(pose);
  if (poseIndex < 0) throw new RangeError("pose");
  const dirIndex = (DIRS as readonly string[]).indexOf(dir);
  if (dirIndex < 0) throw new RangeError("dir");
  if (!Number.isInteger(frame) || frame < 0 || frame >= POSE_FRAMES[pose]) throw new RangeError("frame");
  return { col: frame, row: poseIndex * DIRS.length + dirIndex };
}

// The subset of ZOOM_CANDIDATES whose crispness answer is true, ascending; a missing answer counts as false.
export function selectZoomLevels(crisp: Readonly<Partial<Record<number, boolean>>>): ZoomCandidate[] {
  return ZOOM_CANDIDATES.filter((z) => crisp[z] === true);
}
