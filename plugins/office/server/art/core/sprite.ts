// Ported from marmottajr/habblaud client/src/art/core/sprite.ts at faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice added by 07-05).
// Pure buffer sprites and drawing sheets whose origin is the furniture footprint.
import { TILE, type Rect, type SpriteRectName } from '../../../shared/art-types.ts';
import { PixelBuf } from './pixbuf.ts';

export type Rects = Partial<Record<SpriteRectName, Rect>>;

// Pure equivalent of a Sprite: buffer, anchor and dynamic regions.
export interface BufSprite {
  buf: PixelBuf;
  ax: number;
  ay: number;
  rects?: Rects;
}

export interface BufFurniture {
  base: BufSprite;
  front?: BufSprite;
}

// Sheet for floor furniture: (0, 0) is the footprint top-left; the anchor is the bottom centre.
export function floorSheet(wTiles: number, hTiles: number, up: number, side = 4, down = 3): BufSprite {
  const buf = new PixelBuf(wTiles * TILE + side * 2, up + hTiles * TILE + down);
  buf.ox = side;
  buf.oy = up;
  return { buf, ax: side + (wTiles * TILE) / 2, ay: up + hTiles * TILE };
}

// Sheet for wall items: y = 0 is the skirting line; the anchor is the bottom centre of the wall run.
export function wallSheet(wTiles: number, side = 2): BufSprite {
  const up = TILE * 2 + 4;
  const buf = new PixelBuf(wTiles * TILE + side * 2, up + 2);
  buf.ox = side;
  buf.oy = up;
  return { buf, ax: side + (wTiles * TILE) / 2, ay: up };
}

// Converts a rectangle in drawing coordinates (with origin) to sprite pixels.
export function rectAt(s: BufSprite, x: number, y: number, w: number, h: number): Rect {
  return { x: x + s.buf.ox, y: y + s.buf.oy, w, h };
}

// Crops the sprite to its visible content, keeping the anchor and the regions.
export function trim(s: BufSprite): BufSprite {
  const b = s.buf.bounds();
  if (!b) return s;
  const buf = s.buf.crop(b.x, b.y, b.w, b.h);
  let rects: Rects | undefined;
  if (s.rects) {
    rects = {};
    for (const [k, r] of Object.entries(s.rects) as [SpriteRectName, Rect][]) {
      rects[k] = { x: r.x - b.x, y: r.y - b.y, w: r.w, h: r.h };
    }
  }
  return { buf, ax: s.ax - b.x, ay: s.ay - b.y, rects };
}
