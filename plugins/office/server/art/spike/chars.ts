// No upstream: spike-grade drawing written for plan 07-03 (D-12); retired by plan 07-11.
// Flat character silhouettes drawn into the shared sheet layout (sheetSize / sheetCell of shared/art-types.ts).
import { CHAR_H, CHAR_W, DIRS, POSE_FRAMES, canonicalPoses, sheetCell, sheetSize, type Dir, type Pose } from "../../../shared/art-types.ts";
import type { SpriteSpec } from "../../../shared/sprites-rpc.ts";
import type { RenderedBuf } from "../../sprite-registry.ts";
import { PixelBuf } from "../core/pixbuf.ts";
import { HAIR, SHIRT, SKIN, TROUSERS, spikeHash } from "./palette.ts";

interface Look {
  skin: string;
  hair: string;
  shirt: string;
  trousers: string;
}

function lookOf(seed: string): Look {
  const h = spikeHash(seed);
  return {
    skin: SKIN[h % SKIN.length]!,
    hair: HAIR[(h >>> 3) % HAIR.length]!,
    shirt: SHIRT[(h >>> 6) % SHIRT.length]!,
    trousers: TROUSERS[(h >>> 9) % TROUSERS.length]!,
  };
}

// Vertical drop of the upper body per pose; legs stay anchored at the feet.
function dropOf(pose: Pose, frame: number): number {
  if (pose === "sit") return 3;
  if (pose === "sleep") return 4;
  if (pose === "stand" || pose === "wait" || pose === "read" || pose === "use") return frame % 2;
  return 0;
}

// Draws one flat figure into the 24x34 cell at the buffer origin (ox, oy).
function drawFigure(buf: PixelBuf, look: Look, pose: Pose, dir: Dir, frame: number): void {
  const drop = dropOf(pose, frame);
  const moving = pose === "walk" || pose === "run";
  const swing = moving ? (frame % 2 === 0 ? 0 : 2) : 0;
  const side = dir === "left" || dir === "right";
  const shift = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  // Legs: bottom fixed at y 30, top follows the body drop.
  const legTop = 23 + drop;
  buf.rect(8 + shift, legTop, 3, 31 - legTop - swing, look.trousers);
  buf.rect(13 - shift, legTop, 3, 31 - legTop - (moving ? 2 - swing : 0), look.trousers);
  // Torso and arms.
  buf.rect(7, 13 + drop, 10, 10, look.shirt);
  let armLeftY = 14 + drop + (moving ? swing : 0);
  let armRightY = 14 + drop + (moving ? 2 - swing : 0);
  let armLen = 7;
  if (pose === "raise_hand" || pose === "cheer") armRightY = 8 + drop;
  if (pose === "type" || pose === "use" || pose === "game") armLen = 5 + (frame % 2);
  if (pose === "sleep") armLen = 4;
  buf.rect(5, armLeftY, 2, armLen, look.skin);
  buf.rect(17, armRightY, 2, armLen, look.skin);
  // Head, hair and the direction dependent face mark.
  buf.rect(8, 4 + drop, 8, 9, look.skin);
  buf.rect(8, 4 + drop, 8, dir === "up" ? 7 : 3, look.hair);
  if (dir === "down") {
    buf.set(10, 8 + drop, "#202020");
    buf.set(13, 8 + drop, "#202020");
  } else if (side) {
    buf.set(dir === "left" ? 9 : 14, 8 + drop, "#202020");
  }
  if (pose === "sleep") buf.set(11, 10 + drop, "#202020");
}

// Spike character sheet: throws RangeError for an empty pose set; returns the buffer and its unscaled frame grid.
export function renderSpikeChar(spec: SpriteSpec): RenderedBuf {
  const poses = canonicalPoses(spec.poses);
  const { cols, rows } = sheetSize(poses);
  const buf = new PixelBuf(cols * CHAR_W, rows * CHAR_H);
  const look = lookOf(spec.seed);
  for (const pose of poses) {
    for (const dir of DIRS) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const cell = sheetCell(poses, pose, dir, frame);
        buf.ox = cell.col * CHAR_W;
        buf.oy = cell.row * CHAR_H;
        drawFigure(buf, look, pose, dir, frame);
        buf.ox = 0;
        buf.oy = 0;
        buf.outline({ x: cell.col * CHAR_W, y: cell.row * CHAR_H, w: CHAR_W, h: CHAR_H });
      }
    }
  }
  return { buf, frame: { w: CHAR_W, h: CHAR_H, cols, rows } };
}
