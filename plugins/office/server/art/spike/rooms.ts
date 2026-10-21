// No upstream: spike-grade drawing written for plan 07-03 (D-12); retired by plan 07-11.
// Flat room layers with real tile sizes; textured so the PNG compresses like art, not like flat colour.
import { TILE } from "../../../shared/art-types.ts";
import type { SpriteSpec } from "../../../shared/sprites-rpc.ts";
import type { RenderedBuf } from "../../sprite-registry.ts";
import { PixelBuf } from "../core/pixbuf.ts";
import { AREA_PALETTES, spikeHash } from "./palette.ts";

// Seed to size in tiles; equals the rects of the corridor, room, reception, cafe and lounge of buildBuilding([{ id: "spike-room", slot: 0, seed: 7 }]).
export const SPIKE_LAYERS: Readonly<Record<string, { tw: number; th: number }>> = {
  corridor: { tw: 48, th: 5 },
  room: { tw: 16, th: 12 },
  reception: { tw: 16, th: 12 },
  cafe: { tw: 16, th: 12 },
  lounge: { tw: 16, th: 12 },
};

// Multipliers of red, green and blue per tint index; index 0 is untinted, alpha is unchanged.
export const SPIKE_TINT_RAMP: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [0.88, 0.88, 0.96],
  [0.7, 0.72, 0.9],
  [0.52, 0.56, 0.84],
  [0.34, 0.4, 0.76],
];

interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  color: "prop" | "prop2" | "base";
}

// Props in tile units, chosen per seed.
function blocksOf(seed: string): Block[] {
  switch (seed) {
    case "room":
      return [
        { x: 2, y: 4, w: 3, h: 2, color: "prop" },
        { x: 7, y: 4, w: 3, h: 2, color: "prop" },
        { x: 2, y: 8, w: 3, h: 2, color: "prop" },
        { x: 7, y: 8, w: 3, h: 2, color: "prop" },
        { x: 12, y: 3, w: 2, h: 1, color: "prop2" },
      ];
    case "reception":
      return [
        { x: 1, y: 0, w: 3, h: 2, color: "prop2" },
        { x: 5, y: 0, w: 3, h: 2, color: "prop2" },
        { x: 4, y: 7, w: 8, h: 2, color: "prop" },
      ];
    case "cafe":
      return [
        { x: 1, y: 3, w: 10, h: 1, color: "prop" },
        { x: 3, y: 7, w: 2, h: 2, color: "prop2" },
        { x: 8, y: 7, w: 2, h: 2, color: "prop2" },
      ];
    case "lounge":
      return [
        { x: 2, y: 4, w: 4, h: 2, color: "prop" },
        { x: 9, y: 4, w: 4, h: 2, color: "prop" },
        { x: 5, y: 8, w: 5, h: 1, color: "prop2" },
      ];
    default:
      return [{ x: 0, y: 2, w: 48, h: 1, color: "prop2" }];
  }
}

function tintBuf(buf: PixelBuf, index: number): void {
  const ramp = SPIKE_TINT_RAMP[index];
  if (!ramp || index === 0) return;
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i]! * ramp[0];
    d[i + 1] = d[i + 1]! * ramp[1];
    d[i + 2] = d[i + 2]! * ramp[2];
  }
}

// Spike room layer: throws RangeError for a seed outside SPIKE_LAYERS.
export function renderSpikeRoom(spec: SpriteSpec): RenderedBuf {
  const size = Object.hasOwn(SPIKE_LAYERS, spec.seed) ? SPIKE_LAYERS[spec.seed] : undefined;
  const pal = Object.hasOwn(AREA_PALETTES, spec.seed) ? AREA_PALETTES[spec.seed] : undefined;
  if (!size || !pal) throw new RangeError("seed");
  const w = size.tw * TILE;
  const h = size.th * TILE;
  const buf = new PixelBuf(w, h);
  const salt = spikeHash(spec.seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const checker = (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2 === 0;
      const noisy = spikeHash(`${salt}:${x}:${y}`) % 8 === 0;
      buf.set(x, y, noisy ? pal.noise : checker ? pal.floorA : pal.floorB);
    }
  }
  if (spec.seed !== "corridor") {
    buf.rect(0, 0, w, 2 * TILE, pal.wall);
    buf.rect(0, 2 * TILE - 3, w, 3, pal.base);
  }
  for (const b of blocksOf(spec.seed)) buf.rect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE, pal[b.color]);
  tintBuf(buf, spec.tint);
  return { buf, frame: null };
}
