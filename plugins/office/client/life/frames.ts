// Port of habblaud client/src/art/character/render.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Ported: the per-pose frame durations, used only to choose the clock tier of a pose; drawing, palettes and items stay out (the server draws the sheets).
// Frame math of the sheet window: pose tiers, frame ramps, sheet size, row offsets, frame origin and the partition of poses into sheets.
import { CHAR_AX, CHAR_AY, CHAR_W, CHAR_H, POSE_FRAMES, POSE_NAMES, ZOOM_CANDIDATES, canonicalPoses, sheetCell, sheetSize } from "../../shared/art-types.ts";
import type { Dir, Pose } from "../../shared/art-types.ts";
import type { SpriteKey } from "../../shared/sprites-rpc.ts";
import { FOOT_DX, FOOT_DY, TILE } from "../../shared/layout/constants.ts";
import type { TilePoint } from "../../shared/path/grid.ts";
import { CLOCK_CYCLE, CLOCK_TICKS_PER_FRAME, CLOCK_TICK_MS } from "../limits-life.ts";

// Source object of a loaded sheet image; the caller owns it and the component shows that very object.
export interface ImageSource {
  readonly uri: string;
}

// One loaded character sheet: the poses it holds in canonical order of its sprite key.
export interface CharacterSheet {
  readonly key: SpriteKey;
  readonly source: ImageSource;
  readonly poses: readonly Pose[];
}

// Milliseconds one frame of each pose stays on screen upstream.
const POSE_DURATION: Readonly<Record<Pose, number>> = {
  stand: 650, walk: 140, run: 95, sit: 800, type: 120, sleep: 1000, drink: 700, use: 380, raise_hand: 320, talk: 280,
  stretch: 800, read: 1100, play: 200, wait: 480, cheer: 260, laugh: 190, game: 150, rps: 300, groom: 420, sulk: 1300,
};

// Tier whose ticks times CLOCK_TICK_MS is nearest to the duration; a tie takes the lower tier.
function nearestTier(ms: number): number {
  let best = 0;
  let bestGap = Infinity;
  CLOCK_TICKS_PER_FRAME.forEach((ticks, tier) => {
    const gap = Math.abs(ticks * CLOCK_TICK_MS - ms);
    if (gap < bestGap) {
      best = tier;
      bestGap = gap;
    }
  });
  return best;
}

export const POSE_TIER: Readonly<Record<Pose, number>> = Object.fromEntries(POSE_NAMES.map((pose) => [pose, nearestTier(POSE_DURATION[pose])])) as Record<Pose, number>;

export function tierOf(pose: Pose): number {
  return POSE_TIER[pose];
}

function checkZoom(zoom: number): void {
  if (!(ZOOM_CANDIDATES as readonly number[]).includes(zoom)) throw new RangeError("zoom");
}

function checkPose(pose: string): asserts pose is Pose {
  if (!Object.hasOwn(POSE_FRAMES, pose)) throw new RangeError("pose");
}

// Horizontal offset of each tier value 0 to CLOCK_CYCLE - 1; it repeats with the frame count of the pose.
export function xRamp(pose: Pose, zoom: number): { inputRange: number[]; outputRange: number[] } {
  checkZoom(zoom);
  checkPose(pose);
  const frames = POSE_FRAMES[pose];
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i < CLOCK_CYCLE; i++) {
    inputRange.push(i);
    // Written as zero minus the offset so a zero offset is never negative zero.
    outputRange.push(0 - (i % frames) * CHAR_W * zoom);
  }
  return { inputRange, outputRange };
}

// Size of the clipped frame and of the whole sheet image at its natural pixel size.
export function sheetWindow(poses: readonly Pose[], zoom: number): { frameW: number; frameH: number; cols: number; rows: number; sheetW: number; sheetH: number } {
  checkZoom(zoom);
  const { cols, rows } = sheetSize(poses);
  return { frameW: CHAR_W * zoom, frameH: CHAR_H * zoom, cols, rows, sheetW: cols * CHAR_W * zoom, sheetH: rows * CHAR_H * zoom };
}

// Vertical offset of the row of a pose and direction; RangeError for an empty set or a pose outside it.
export function rowOffset(poses: readonly Pose[], pose: Pose, dir: Dir, zoom: number): number {
  checkZoom(zoom);
  const { row } = sheetCell(poses, pose, dir, 0);
  return 0 - row * CHAR_H * zoom;
}

// Foot pixel of a tile in world pixels.
export function footPx(tile: TilePoint): { x: number; y: number } {
  return { x: tile.x * TILE + FOOT_DX, y: tile.y * TILE + FOOT_DY };
}

// Top-left corner of the character frame for a foot pixel; a smaller sheet stands on the same foot pixel scaled by zoom.
export function frameOrigin(foot: { x: number; y: number }, zoom: number, sheetZoom: number = zoom): { left: number; top: number } {
  checkZoom(zoom);
  checkZoom(sheetZoom);
  if (sheetZoom > zoom) throw new RangeError("sheetZoom");
  if (!Number.isFinite(foot.x) || !Number.isFinite(foot.y)) throw new RangeError("foot");
  return { left: foot.x * zoom - CHAR_AX * sheetZoom, top: foot.y * zoom - CHAR_AY * sheetZoom };
}

// Partition of the poses into sheets; each group fits PNG_MAX_DIMENSION at the largest zoom (7 poses times 4 directions).
export const SHEET_POSE_GROUPS: readonly (readonly Pose[])[] = [
  ["stand", "walk", "run", "sit", "drink"],
  ["type", "read", "use", "wait", "raise_hand", "sulk", "sleep"],
  ["talk", "play", "game", "rps", "laugh", "cheer"],
];

// Index of the group that holds the pose, or -1.
export function groupOfPose(pose: Pose): number {
  return SHEET_POSE_GROUPS.findIndex((group) => group.includes(pose));
}

// First loaded sheet that holds the pose (list order decides), else null.
export function sheetFor(sheets: readonly CharacterSheet[], pose: Pose): CharacterSheet | null {
  return sheets.find((sheet) => sheet.poses.includes(pose)) ?? null;
}

// Frame shown when the wanted pose is on no loaded sheet: stand when the sheet has it, else its first pose.
export function restPoseOf(sheet: CharacterSheet): Pose {
  return sheet.poses.includes("stand") ? "stand" : canonicalPoses(sheet.poses)[0];
}
