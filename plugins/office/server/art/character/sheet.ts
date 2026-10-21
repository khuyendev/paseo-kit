// Original code for plan 07-04 that draws the frames of marmottajr/habblaud client/src/art/character/render.ts at faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice added by 07-05).
// Character-sheet renderer in the shared sheet layout of shared/art-types.ts (sheetSize / sheetCell).
// Contract for plans 07-08 and 07-11:
// - one row per pose and direction (POSE_NAMES order, then DIRS), one column per frame; each cell is CHAR_W x CHAR_H (24 x 34);
// - the foot anchor (CHAR_AX, CHAR_AY) = (12, 31) sits inside every cell; unused columns of shorter poses stay transparent;
// - raise_hand, read and sulk are drawn seated (SEAT_DROP = 4 px lower inside the same cell); type, sit, sleep and wait are seated
//   by the renderer itself; every other pose stands;
// - the look comes only from the seed: appearanceFromSeed(hash32(seed)), no look, sub, parts, held or costume input;
// - pose budget of one PNG: floor(PNG_MAX_DIMENSION / (4 directions * 34 * zoom)) = 7 poses at zoom 4, 10 at zoom 3, 15 at zoom 2.
import { CHAR_H, CHAR_W, DIRS, POSE_FRAMES, canonicalPoses, sheetCell, sheetSize, type Pose } from '../../../shared/art-types.ts';
import type { SpriteFrame, SpriteSpec } from '../../../shared/sprites-rpc.ts';
import type { SpriteRenderer } from '../../sprite-registry.ts';
import { PixelBuf } from '../core/pixbuf.ts';
import { hash32 } from '../hash.ts';
import { appearanceFromSeed } from './appearance.ts';
import { renderCharacter } from './render.ts';

// Only the fields the renderer reads; scale and tint of the sprite key never change the drawn pixels.
export type CharacterSheetSpec = Pick<SpriteSpec, 'seed' | 'poses'>;

// Dual poses an agent performs at its desk: drawn seated. Sit, type, sleep and wait are seated by the renderer, use stays standing.
export const SHEET_SEATED_POSES: ReadonlySet<Pose> = new Set<Pose>(['raise_hand', 'read', 'sulk']);

// Throws TypeError for a non-string seed and RangeError for an empty or unknown pose list, before any drawing.
export function renderCharacterSheet(spec: CharacterSheetSpec): { buf: PixelBuf; frame: SpriteFrame } {
  if (typeof spec.seed !== 'string') throw new TypeError('seed');
  const poses = canonicalPoses(spec.poses);
  const { cols, rows } = sheetSize(poses);
  const appearance = appearanceFromSeed(hash32(spec.seed));
  const buf = new PixelBuf(cols * CHAR_W, rows * CHAR_H);
  for (const pose of poses) {
    const seated = SHEET_SEATED_POSES.has(pose);
    for (const dir of DIRS) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const cell = sheetCell(poses, pose, dir, frame);
        const sprite = renderCharacter({ appearance, dir, pose, frame, seated });
        if (sprite.buf.w !== CHAR_W || sprite.buf.h !== CHAR_H) throw new Error('character frame size');
        buf.draw(sprite.buf, cell.col * CHAR_W, cell.row * CHAR_H);
      }
    }
  }
  return { buf, frame: { w: CHAR_W, h: CHAR_H, cols, rows } };
}

// Type-level proof that the renderer can be registered as a SpriteRenderer without an adapter.
type Extends<A, B> = [A] extends [B] ? true : false;
const _isSpriteRenderer: Extends<typeof renderCharacterSheet, SpriteRenderer> = true;
void _isSpriteRenderer;
