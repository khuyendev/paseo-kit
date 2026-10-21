// Ported from marmottajr/habblaud client/src/art/core/pixbuf.ts at faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice added by 07-05).
// Pure RGBA pixel buffer (no DOM): all art is composed here and only the PNG encoder reads it.
import { outlineFor, parseColor, type RGBA } from './color.ts';

// Palette of an ASCII template: character to colour (absent means not drawn).
export type Palette = Readonly<Record<string, string | undefined>>;

export class PixelBuf {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  // Draw origin: every paint call adds (ox, oy); outline, bounds and crop use absolute coordinates.
  ox = 0;
  oy = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  // True when the absolute pixel lies inside the buffer.
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  alpha(x: number, y: number): number {
    const xi = x + this.ox;
    const yi = y + this.oy;
    if (!this.inside(xi, yi)) return 0;
    return this.data[(yi * this.w + xi) * 4 + 3];
  }

  // Paints one pixel; colours with alpha below 1 are composited over (source-over).
  set(x: number, y: number, c: string | undefined): void {
    if (!c) return;
    const xi = Math.floor(x) + this.ox;
    const yi = Math.floor(y) + this.oy;
    if (!this.inside(xi, yi)) return;
    const [r, g, b, a] = parseColor(c);
    this.blend(xi, yi, r, g, b, a);
  }

  // Fast write of an opaque pre-parsed colour; honours the origin.
  put(x: number, y: number, c: RGBA): void {
    const xi = x + this.ox;
    const yi = y + this.oy;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  private blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const i = (y * this.w + x) * 4;
    const d = this.data;
    if (a >= 255) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      return;
    }
    if (a <= 0) return;
    const sa = a / 255;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    d[i] = (r * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }

  // Paints UNDER what exists (destination-over), used for contact shadows.
  under(x: number, y: number, c: string): void {
    const xi = Math.floor(x) + this.ox;
    const yi = Math.floor(y) + this.oy;
    if (!this.inside(xi, yi)) return;
    const i = (yi * this.w + xi) * 4;
    const d = this.data;
    const [r, g, b, a] = parseColor(c);
    const da = d[i + 3] / 255;
    if (da >= 1) return;
    const sa = (a / 255) * (1 - da);
    const oa = da + sa;
    if (oa <= 0) return;
    d[i] = (d[i] * da + r * sa) / oa;
    d[i + 1] = (d[i + 1] * da + g * sa) / oa;
    d[i + 2] = (d[i + 2] * da + b * sa) / oa;
    d[i + 3] = oa * 255;
  }

  clear(x: number, y: number): void {
    const xi = x + this.ox;
    const yi = y + this.oy;
    if (!this.inside(xi, yi)) return;
    this.data.fill(0, (yi * this.w + xi) * 4, (yi * this.w + xi) * 4 + 4);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.clear(xx, yy);
  }

  rect(x: number, y: number, w: number, h: number, c: string | undefined): void {
    if (!c || w <= 0 || h <= 0) return;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  // Inclusive horizontal line from x0 to x1.
  hline(x0: number, x1: number, y: number, c: string | undefined): void {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    for (let x = a; x <= b; x++) this.set(x, y, c);
  }

  // Inclusive vertical line from y0 to y1.
  vline(x: number, y0: number, y1: number, c: string | undefined): void {
    const a = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    for (let y = a; y <= b; y++) this.set(x, y, c);
  }

  // Bresenham line with an optional square brush of size px.
  line(x0: number, y0: number, x1: number, y1: number, c: string | undefined, size = 1): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (size <= 1) this.set(x, y, c);
      else this.rect(x, y, size, size, c);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // Filled ellipse with centre (cx, cy) and radii rx, ry (half pixels allowed).
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string | undefined): void {
    if (!c) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
    }
  }

  // Contact shadow (ellipse) composited under the sprite.
  shadow(cx: number, cy: number, rx: number, ry: number, c = '#1c2034', alpha = 0.22): void {
    const [r, g, b] = parseColor(c);
    const col = `rgba(${r},${g},${b},${alpha})`;
    const inner = `rgba(${r},${g},${b},${Math.min(1, alpha * 1.35)})`;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const d = nx * nx + ny * ny;
        if (d <= 1) this.under(x, y, d < 0.45 ? inner : col);
      }
    }
  }

  // Stamps an ASCII template; '.' and ' ' are skipped, flip mirrors inside the template width.
  stamp(rows: readonly string[], x: number, y: number, pal: Palette, flip = false): void {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const col = pal[ch];
        if (!col) continue;
        const cx = flip ? row.length - 1 - i : i;
        this.set(x + cx, y + r, col);
      }
    }
  }

  // Copies another buffer on top of this one (with alpha), optionally mirrored.
  draw(src: PixelBuf, dx: number, dy: number, flip = false): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        const a = src.data[i + 3];
        if (!a) continue;
        const tx = dx + this.ox + (flip ? src.w - 1 - x : x);
        const ty = dy + this.oy + y;
        if (!this.inside(tx, ty)) continue;
        this.blend(tx, ty, src.data[i], src.data[i + 1], src.data[i + 2], a);
      }
    }
  }

  flipped(): PixelBuf {
    const out = new PixelBuf(this.w, this.h);
    out.draw(this, 0, 0, true);
    return out;
  }

  // Crops a region into a new buffer.
  crop(x: number, y: number, w: number, h: number): PixelBuf {
    const out = new PixelBuf(w, h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (!this.inside(x + xx, y + yy)) continue;
        const si = ((y + yy) * this.w + (x + xx)) * 4;
        const di = (yy * w + xx) * 4;
        out.data[di] = this.data[si];
        out.data[di + 1] = this.data[si + 1];
        out.data[di + 2] = this.data[si + 2];
        out.data[di + 3] = this.data[si + 3];
      }
    }
    return out;
  }

  // Automatic 1px outline (4-neighbourhood) around opaque pixels, optionally limited to a region.
  outline(only?: { x: number; y: number; w: number; h: number }): void {
    const { w, h } = this;
    const src = this.data.slice();
    const x0 = only ? Math.max(0, only.x) : 0;
    const y0 = only ? Math.max(0, only.y) : 0;
    const x1 = only ? Math.min(w, only.x + only.w) : w;
    const y1 = only ? Math.min(h, only.y + only.h) : h;
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] >= 160;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3] >= 160) continue;
        let best = -1;
        let bestLum = 1e9;
        const tryN = (nx: number, ny: number) => {
          if (!opaque(nx, ny)) return;
          const j = (ny * w + nx) * 4;
          const lum = src[j] * 0.3 + src[j + 1] * 0.59 + src[j + 2] * 0.11;
          if (lum < bestLum) {
            bestLum = lum;
            best = j;
          }
        };
        tryN(x, y - 1);
        tryN(x - 1, y);
        tryN(x + 1, y);
        tryN(x, y + 1);
        if (best < 0) continue;
        const [r, g, b] = parseColor(outlineFor(src[best], src[best + 1], src[best + 2]));
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
        this.data[i + 3] = 255;
      }
    }
  }

  // Bounding box of the visible pixels, or null when empty.
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let minX = this.w;
    let minY = this.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.data[(y * this.w + x) * 4 + 3] === 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // Number of visible pixels (alpha above 0).
  countOpaque(): number {
    let n = 0;
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i]) n++;
    return n;
  }
}
