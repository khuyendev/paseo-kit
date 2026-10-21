// Port of habblaud client/src/world/render/daylight.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Kept: phases, light colours, the 14 sky keys and the ambient arithmetic; dropped: URL and settings handling and canvas helpers; added: localHour, tintPosition, dayPhase, fadeLayers.
import { TINT_LEVELS } from "../shared/tint.ts";

export type DayPhaseName = "predawn" | "dawn" | "day" | "dusk" | "night";

export type Rgb = readonly [number, number, number];

export interface Ambient {
  hour: number;
  phase: DayPhaseName;
  // 0 is full day, 1 is closed night.
  night: number;
  // 0..1: strength of the warm dawn and dusk tone.
  warm: number;
  // Multiplier over the outdoor area.
  outside: Rgb;
  // Multiplier over lit interiors.
  inside: Rgb;
  // Multiplier over empty common areas at night.
  dim: Rgb;
}

// The ambient plus the tint variant count and the position among the variants.
export interface DaySample extends Ambient {
  levels: number;
  position: number;
}

// Which variants to mount: the base, an optional overlay and the overlay opacity.
export interface FadePlan {
  base: number | null;
  over: number | null;
  overOpacity: number;
}

// Hours used when no clock reading is usable and for the fixed day and night of the upstream settings.
export const FIXED_DAY_HOUR = 13.5;
export const FIXED_NIGHT_HOUR = 22.5;

export const WHITE: Rgb = [255, 255, 255];
// Lamp light (interiors at night).
const LAMP: Rgb = [244, 220, 184];
// Low sun through the windows (dawn and dusk).
const SUN: Rgb = [255, 222, 184];
// Empty common area at night: bluish dimness.
const VIGIL: Rgb = [138, 144, 180];

const SUN_SHARE = 0.55;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = 3600;
const MIN_SPAN = 1e-6;
const NEUTRAL_NIGHT = 0.005;
const NEUTRAL_CHANNEL = 254;
const PREDAWN_END = 5;
const DAWN_END = 7;
const DAY_END = 17;
const DUSK_END = 19;

// Sky keys over the day: [hour, night, warm, outside colour]; linear between keys, 0 h and 24 h equal so midnight is continuous.
const KEYS: readonly (readonly [number, number, number, Rgb])[] = [
  [0, 1, 0, [70, 84, 140]],
  [4.5, 1, 0, [72, 86, 142]],
  [5.25, 0.86, 0.25, [104, 100, 156]],
  [5.9, 0.56, 0.8, [190, 146, 168]],
  [6.5, 0.2, 1, [255, 208, 174]],
  [7.25, 0, 0.35, [255, 238, 220]],
  [8, 0, 0, WHITE],
  [16.25, 0, 0, WHITE],
  [17.25, 0.04, 0.45, [255, 236, 206]],
  [18, 0.24, 1, [255, 202, 162]],
  [18.6, 0.55, 0.75, [194, 148, 164]],
  [19.25, 0.85, 0.3, [110, 108, 162]],
  [20, 1, 0, [80, 96, 150]],
  [24, 1, 0, [70, 84, 140]],
];

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

// Hour normalised to [0, 24); a non-finite hour is 0.
export function wrapHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
}

export function phaseOf(hour: number): DayPhaseName {
  const h = wrapHour(hour);
  if (h < PREDAWN_END) return "predawn";
  if (h < DAWN_END) return "dawn";
  if (h < DAY_END) return "day";
  if (h < DUSK_END) return "dusk";
  return "night";
}

// Light level and colours for a fractional local hour (0-24).
export function ambientAt(hour: number): Ambient {
  const h = wrapHour(hour);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, n0, w0, c0] = KEYS[i];
  const [h1, n1, w1, c1] = KEYS[i + 1];
  const u = (h - h0) / Math.max(MIN_SPAN, h1 - h0);
  const night = n0 + (n1 - n0) * u;
  const warm = w0 + (w1 - w0) * u;
  const outside = mixRgb(c0, c1, u);
  // Lit interiors: warm lamp at night; by day a breath of low sun through the windows.
  const inside = mixRgb(mixRgb(WHITE, LAMP, night), SUN, warm * (1 - night) * SUN_SHARE);
  const dim = mixRgb(WHITE, VIGIL, night);
  return { hour: h, phase: phaseOf(h), night, warm, outside, inside, dim };
}

// Neutral ambient (full day): multiplying by it changes nothing.
export function isNeutral(a: Ambient): boolean {
  return a.night < NEUTRAL_NIGHT && a.outside[0] >= NEUTRAL_CHANNEL && a.outside[1] >= NEUTRAL_CHANNEL && a.outside[2] >= NEUTRAL_CHANNEL && a.inside[2] >= NEUTRAL_CHANNEL;
}

// Local clock as a fractional hour; an invalid Date reads as the fixed day hour.
export function localHour(date: Date): number {
  if (typeof date?.getTime !== "function" || !Number.isFinite(date.getTime())) return FIXED_DAY_HOUR;
  return date.getHours() + date.getMinutes() / MINUTES_PER_HOUR + date.getSeconds() / SECONDS_PER_HOUR;
}

function checkLevels(levels: number): void {
  if (!Number.isInteger(levels) || levels < 1) throw new RangeError("levels");
}

// Night fraction (clamped to 0..1, NaN as 0) mapped onto the variant indexes 0..levels-1.
export function tintPosition(night: number, levels: number): number {
  checkLevels(levels);
  const fraction = Number.isNaN(night) ? 0 : clamp(night, 0, 1);
  return fraction * (levels - 1);
}

// Day state for the local clock plus the tint position; variant i of a layer is the layer lit at night fraction i / (levels - 1).
export function dayPhase(date: Date, levels: number = TINT_LEVELS): DaySample {
  checkLevels(levels);
  const ambient = ambientAt(localHour(date));
  return { ...ambient, levels, position: tintPosition(ambient.night, levels) };
}

// Which tint variants to mount for a position, given which variants are loaded. The overlay is drawn over a fully opaque
// base, so the cross-fade never dips through transparency. At most two layers whatever the number of variants.
export function fadeLayers(position: number, available: readonly boolean[]): FadePlan {
  const n = available.length;
  if (n === 0) return { base: null, over: null, overOpacity: 0 };
  const at = Number.isFinite(position) ? clamp(position, 0, n - 1) : 0;
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, n - 1);
  const mix = at - lo;
  if (available[lo]) {
    if (hi !== lo && available[hi] && mix > 0) return { base: lo, over: hi, overOpacity: mix };
    return { base: lo, over: null, overOpacity: 0 };
  }
  if (available[hi]) return { base: hi, over: null, overOpacity: 0 };
  // Neither neighbour is loaded: the loaded variant nearest to the position, ties to the lower index.
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < n; i++) {
    if (!available[i]) continue;
    const distance = Math.abs(i - at);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return { base: best, over: null, overOpacity: 0 };
}
