// Kind to renderer table: a new SpriteKind without a renderer here fails tsc.
import type { SpriteFrame, SpriteKind, SpriteSpec } from "../shared/sprites-rpc.ts";
import { PixelBuf } from "./art/core/pixbuf.ts";

// A drawn buffer plus its frame grid in unscaled pixels (null for a single image).
export type RenderedBuf = { buf: PixelBuf; frame: SpriteFrame | null };
export type SpriteRenderer = (spec: SpriteSpec) => RenderedBuf;

export const RULER_W = 32;
export const RULER_H = 8;
export const RULER_COLORS = ["#000000", "#ffffff", "#ff0000"] as const;

// Alternating one-pixel black and white columns with one red row at y 3: crispness probe for the spike.
const renderRuler: SpriteRenderer = () => {
  const buf = new PixelBuf(RULER_W, RULER_H);
  for (let x = 0; x < RULER_W; x++) {
    for (let y = 0; y < RULER_H; y++) buf.set(x, y, y === 3 ? RULER_COLORS[2] : RULER_COLORS[x % 2]);
  }
  return { buf, frame: null };
};

export const SPRITE_REGISTRY: Readonly<Record<SpriteKind, SpriteRenderer>> = {
  ruler: renderRuler,
};
