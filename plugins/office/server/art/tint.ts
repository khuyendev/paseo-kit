// Port of habblaud client/src/world/render/daylight.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt).
// New composition: night tint variants of a buffer from the night colour and fixed hours of daylight.ts.
import { TINT_LEVELS, TINT_MAX_LEVELS, TINT_MIN_LEVELS } from '../../shared/tint.ts';
import { PixelBuf } from './core/pixbuf.ts';

// Hour used for the fixed day and the fixed night.
export const FIXED_DAY_HOUR = 13.5;
export const FIXED_NIGHT_HOUR = 22.5;

// Exterior colour keys of the pinned daylight table that bracket the fixed night hour: [hour, [r, g, b]].
const KEY_BEFORE: readonly [number, readonly [number, number, number]] = [20, [80, 96, 150]];
const KEY_AFTER: readonly [number, readonly [number, number, number]] = [24, [70, 84, 140]];

// Per-channel multiplier out of 255 at the fixed night hour (linear between the two keys, rounded like mixRgb).
export const NIGHT_MULTIPLY: readonly [number, number, number] = (() => {
  const u = (FIXED_NIGHT_HOUR - KEY_BEFORE[0]) / (KEY_AFTER[0] - KEY_BEFORE[0]);
  const ch = (i: 0 | 1 | 2) => Math.round(KEY_BEFORE[1][i] + (KEY_AFTER[1][i] - KEY_BEFORE[1][i]) * u);
  return [ch(0), ch(1), ch(2)] as const;
})();

// Checks a tint level against the number of levels.
function checkLevel(level: number, levels: number): void {
  if (!Number.isInteger(levels) || levels < TINT_MIN_LEVELS || levels > TINT_MAX_LEVELS) throw new RangeError('levels');
  if (!Number.isInteger(level) || level < 0 || level >= levels) throw new RangeError('level');
}

// New buffer darkened to a tint level: level 0 is a byte copy and the last level is the channel-wise multiply by NIGHT_MULTIPLY.
// Each channel is src * m / 255 with m moving linearly from 255 to the night value, rounded half up in integer arithmetic.
export function tintBuf(src: PixelBuf, level: number, levels: number = TINT_LEVELS): PixelBuf {
  checkLevel(level, levels);
  const out = new PixelBuf(src.w, src.h);
  const steps = levels - 1;
  const den = 255 * steps;
  const num = NIGHT_MULTIPLY.map((n) => 255 * steps + (n - 255) * level);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    d[i + 3] = s[i + 3];
    if (s[i + 3] === 0) {
      d[i] = s[i];
      d[i + 1] = s[i + 1];
      d[i + 2] = s[i + 2];
      continue;
    }
    for (let c = 0; c < 3; c++) d[i + c] = Math.floor((2 * s[i + c] * num[c] + den) / (2 * den));
  }
  return out;
}

// Hour of day a tint level stands for, so the window sky of a tinted layer matches its darkness.
export function hourForTint(level: number, levels: number = TINT_LEVELS): number {
  checkLevel(level, levels);
  return FIXED_DAY_HOUR + (level / (levels - 1)) * (FIXED_NIGHT_HOUR - FIXED_DAY_HOUR);
}
