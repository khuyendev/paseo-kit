// Port of habblaud client/src/art/seasonal.ts and client/src/world/render/seasonal.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt).
// Props as upstream; the decoration rules are rewritten from canvas to PixelBuf (new composition; the character costume is not ported).
import { PixelBuf } from './core/pixbuf.ts';
import { mix } from './core/color.ts';
import type { BufSprite } from './core/sprite.ts';
import { hash32 } from './furniture/hash.ts';
import type { WallStyle } from './surfaces/types.ts';

// Seasonal prop kinds.
export type SeasonalProp = 'tree' | 'gift' | 'pumpkin' | 'ghost' | 'wreath' | 'bat';

// Draws one seasonal prop (40 by 64 px, anchored at its feet).
export function renderSeasonalProp(kind: SeasonalProp): BufSprite {
  const b = new PixelBuf(40, 64);
  const rect = (x: number, y: number, w: number, h: number, c: string) => b.rect(x, y, w, h, c);
  if (kind === 'tree') {
    b.shadow(20, 59, 17, 3, '#252c39', 0.22);
    rect(17, 49, 6, 9, '#80573d');
    for (let row = 0; row < 4; row++) {
      const y = 13 + row * 8;
      const half = 6 + row * 3;
      rect(20 - half, y, half * 2 + 1, 9, '#245644');
      rect(22 - half, y, half * 2 - 4, 6, '#387956');
      rect(22 - half, y + 1, half - 1, 3, '#4d9361');
    }
    b.vline(20, 5, 13, '#ffe0a0');
    b.hline(16, 24, 9, '#ffe0a0');
    rect(18, 7, 5, 5, '#ffc45d');
    for (const [x, y] of [[16, 20], [24, 24], [13, 31], [25, 36], [9, 42], [20, 43], [31, 44]]) {
      rect(x, y, 3, 3, '#e05250');
      b.set(x, y, '#ffb27b');
    }
    for (const [x, y] of [[21, 17], [15, 26], [23, 30], [15, 38], [26, 42], [11, 47]]) {
      rect(x, y, 2, 2, '#ffe8b2');
    }
    rect(3, 52, 10, 8, '#a82d42');
    rect(6, 51, 2, 9, '#e5c17b');
    rect(3, 54, 10, 1, '#e5c17b');
    rect(26, 51, 10, 9, '#e6b357');
    rect(30, 50, 2, 10, '#b33549');
    rect(26, 54, 10, 1, '#b33549');
  } else if (kind === 'gift') {
    b.shadow(20, 59, 9, 2, '#252c39', 0.2);
    rect(11, 49, 17, 11, '#bf3849');
    rect(11, 49, 17, 3, '#e35a58');
    rect(18, 49, 3, 11, '#efd1a0');
    rect(11, 54, 17, 2, '#efd1a0');
    rect(14, 46, 5, 3, '#e8b860');
    rect(21, 46, 5, 3, '#e8b860');
  } else if (kind === 'pumpkin') {
    b.shadow(20, 59, 11, 2, '#252c39', 0.2);
    rect(18, 41, 3, 6, '#557342');
    rect(11, 46, 18, 14, '#c56832');
    rect(8, 49, 24, 8, '#e18b39');
    rect(13, 46, 4, 13, '#f0a647');
    rect(23, 47, 3, 12, '#f0a647');
    rect(12, 50, 4, 3, '#523347');
    rect(24, 50, 4, 3, '#523347');
    rect(17, 56, 7, 2, '#523347');
    b.set(13, 51, '#ffd680');
    b.set(25, 51, '#ffd680');
    b.hline(18, 22, 56, '#ffd680');
  } else if (kind === 'ghost') {
    rect(15, 39, 10, 3, '#e0dae9');
    rect(12, 42, 16, 15, '#e0dae9');
    rect(14, 41, 11, 15, '#fff4ed');
    rect(10, 47, 4, 4, '#e0dae9');
    rect(26, 47, 4, 4, '#e0dae9');
    for (const x of [12, 18, 24]) rect(x, 56, 4, 3, '#e0dae9');
    rect(16, 46, 2, 3, '#574563');
    rect(23, 46, 2, 3, '#574563');
    rect(19, 51, 3, 2, '#574563');
  } else if (kind === 'wreath') {
    rect(12, 39, 16, 4, '#347653');
    rect(10, 43, 5, 10, '#245644');
    rect(25, 43, 5, 10, '#347653');
    rect(13, 53, 15, 4, '#245644');
    for (const [x, y] of [[14, 41], [26, 47], [12, 50], [23, 54]]) rect(x, y, 2, 2, '#e45c58');
    rect(15, 55, 4, 4, '#c93945');
    rect(21, 55, 4, 4, '#c93945');
    rect(19, 54, 2, 4, '#f07368');
  } else {
    rect(18, 51, 5, 6, '#47344f');
    rect(10, 50, 9, 4, '#47344f');
    rect(22, 50, 9, 4, '#47344f');
    rect(7, 48, 4, 4, '#47344f');
    rect(30, 48, 4, 4, '#47344f');
    rect(13, 53, 3, 3, '#47344f');
    rect(25, 53, 3, 3, '#47344f');
    b.set(19, 52, '#f5b95f');
    b.set(21, 52, '#f5b95f');
  }
  b.outline();
  return { buf: b, ax: 20, ay: 60 };
}

// Seasonal theme values (habblaud SeasonalTheme).
export const SEASONAL_THEMES = ['none', 'christmas', 'halloween'] as const;
export type SeasonalTheme = (typeof SEASONAL_THEMES)[number];

// Light level of the baked decoration lights: a baked layer has no lights-off state, so it is fixed at lit.
const SEASONAL_LIGHT = 1;

// Prop sprites are drawn once per kind (there are only six).
const propCache = new Map<SeasonalProp, BufSprite>();
export function seasonalSprite(kind: SeasonalProp): BufSprite {
  let sprite = propCache.get(kind);
  if (!sprite) {
    sprite = renderSeasonalProp(kind);
    propCache.set(kind, sprite);
  }
  return sprite;
}

// Rectangle in layer pixels.
interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Structural area: only the fields the seasonal rules read.
export interface SeasonalArea {
  kind: string;
  furniture: readonly { id: string; kind: string }[];
}

// Structural wall segment: only the fields the seasonal rules read.
export interface SeasonalWall {
  kind: string;
  x: number;
  y: number;
  w: number;
  doorways?: readonly { x: number; w: number }[];
}

// Props that replace plants: the first plant_tall becomes a tree (christmas) or a ghost or pumpkin (halloween, by hash32 of its id), every plant_small a gift or pumpkin; none and restrooms get nothing.
export function seasonProps(theme: SeasonalTheme, area: SeasonalArea): Map<string, SeasonalProp> {
  const out = new Map<string, SeasonalProp>();
  if (theme === 'none' || area.kind === 'restroom') return out;
  const first = area.furniture.find((f) => f.kind === 'plant_tall');
  for (const f of area.furniture) {
    if (f.kind === 'plant_tall' && f === first) out.set(f.id, theme === 'christmas' ? 'tree' : hash32(f.id) % 3 === 0 ? 'ghost' : 'pumpkin');
    else if (f.kind === 'plant_small') out.set(f.id, theme === 'christmas' ? 'gift' : 'pumpkin');
  }
  return out;
}

// Rug colour of a theme.
export function seasonalRugColor(theme: SeasonalTheme, original: string): string {
  return theme === 'christmas' ? '#a93649' : theme === 'halloween' ? '#60416f' : original;
}

// Wall style of a theme (glass walls stay as they are).
export function seasonalWallStyle(theme: SeasonalTheme, original: WallStyle): WallStyle {
  if (theme === 'none' || original.pattern === 'glass') return original;
  return { ...original, base: mix(original.base, theme === 'christmas' ? '#ffe3b4' : '#bc97d1', 0.18), trim: theme === 'christmas' ? '#4e7756' : '#725486' };
}

// Rug motifs: a gold border line and a cross (christmas) or pumpkin face (halloween) every 28 px.
export function paintSeasonalRug(buf: PixelBuf, theme: SeasonalTheme, rug: PxRect): void {
  if (theme === 'none') return;
  const x = Math.round(rug.x);
  const y = Math.round(rug.y);
  const w = Math.floor(rug.w);
  const h = Math.floor(rug.h);
  if (w < 25 || h < 16) return;
  const gold = theme === 'christmas' ? '#ddb66e' : '#e5a457';
  buf.rect(x + 4, y + 4, w - 8, 1, gold);
  buf.rect(x + 4, y + h - 5, w - 8, 1, gold);
  for (let cx = x + 14; cx < x + w - 10; cx += 28) {
    const cy = Math.round(y + h / 2);
    if (theme === 'christmas') {
      buf.rect(cx - 4, cy, 9, 1, gold);
      buf.rect(cx, cy - 4, 1, 9, gold);
      for (const d of [-2, 2]) {
        buf.rect(cx + d, cy + d, 1, 1, gold);
        buf.rect(cx + d, cy - d, 1, 1, gold);
      }
    } else {
      buf.rect(cx - 3, cy - 2, 7, 5, gold);
      buf.rect(cx, cy - 4, 1, 2, gold);
      buf.rect(cx - 2, cy - 1, 1, 1, '#60416f');
      buf.rect(cx + 2, cy - 1, 1, 1, '#60416f');
    }
  }
}

// Garland and lights high on a wall face, doorways left free; halloween adds corner cobwebs (pixel lines) and a bat on wide walls.
export function paintSeasonalWall(buf: PixelBuf, theme: SeasonalTheme, wall: SeasonalWall): void {
  if (theme === 'none' || wall.kind !== 'face') return;
  const x0 = Math.round(wall.x + 3);
  const end = Math.floor(wall.x + wall.w - 3);
  const y = Math.round(wall.y + 5);
  const lo = Math.max(x0, -buf.ox - 2);
  const hi = Math.min(end, buf.w - buf.ox + 2);
  for (let x = lo; x < hi; x++) {
    if (wall.doorways?.some((d) => x >= d.x - 1 && x < d.x + d.w + 1)) continue;
    const sag = Math.round(Math.sin((((x - x0) % 48) / 48) * Math.PI) * 3);
    buf.rect(x, y + sag, 1, theme === 'christmas' ? 3 : 1, theme === 'christmas' ? '#347653' : '#584068');
    if ((x - x0) % 12 === 6) {
      buf.rect(x, y + sag + 3, 2, 3, theme === 'christmas' ? '#f5d491' : '#eea24d');
      buf.rect(x, y + sag + 3, 1, 1, theme === 'christmas' ? '#fff0be' : '#ffd78a');
    }
  }
  if (theme === 'halloween') {
    for (const side of [1, -1]) {
      const x = side === 1 ? x0 : end;
      for (const [dx, dy] of [[15, 0], [13, 7], [7, 13], [0, 15]]) buf.line(x, y + 2, x + side * dx, y + 2 + dy, '#d6bfdd');
      for (const r of [5, 10, 15]) {
        const m = Math.round(r * 0.7);
        buf.line(x + side * r, y + 2, x + side * m, y + 2 + m, '#d6bfdd');
        buf.line(x + side * m, y + 2 + m, x, y + 2 + r, '#d6bfdd');
      }
    }
    if (wall.w > 90) {
      const bat = seasonalSprite('bat');
      buf.draw(bat.buf, Math.round(wall.x + wall.w / 2 - bat.ax), y + 18 - bat.ay);
    }
  }
}

// Wreath (christmas) or bat (halloween) on an elevator frame; (x, y) is the item footing.
export function paintElevatorOrnament(buf: PixelBuf, theme: SeasonalTheme, x: number, y: number): void {
  if (theme === 'none') return;
  const sprite = seasonalSprite(theme === 'christmas' ? 'wreath' : 'bat');
  buf.draw(sprite.buf, Math.round(x - sprite.ax), Math.round(y - 19 - sprite.ay));
}

// Radial glow of a light as pixels with their colour: the colour runs from the theme colour to rgba(255,220,180,0) between 1 and 17 px from the centre.
const glowCache = new Map<SeasonalTheme, readonly { x: number; y: number; c: string }[]>();
function glowPixels(theme: SeasonalTheme): readonly { x: number; y: number; c: string }[] {
  let px = glowCache.get(theme);
  if (!px) {
    const c0 = theme === 'christmas' ? [255, 213, 139] : [216, 165, 237];
    const c1 = [255, 220, 180];
    const out: { x: number; y: number; c: string }[] = [];
    for (let gy = 0; gy < 34; gy++) {
      for (let gx = 0; gx < 34; gx++) {
        const d = Math.hypot(gx + 0.5 - 17, gy + 0.5 - 17);
        const t = Math.min(1, Math.max(0, (d - 1) / 16));
        const a = (1 - t) * SEASONAL_LIGHT * 0.3;
        if (a * 255 < 0.5) continue;
        const ch = (i: number) => Math.round(c0[i] + (c1[i] - c0[i]) * t);
        out.push({ x: gx, y: gy, c: `rgba(${ch(0)},${ch(1)},${ch(2)},${a})` });
      }
    }
    px = out;
    glowCache.set(theme, px);
  }
  return px;
}

// Soft decoration lights on the wall faces, clipped to the face; doorways stay free.
export function paintSeasonalLights(buf: PixelBuf, theme: SeasonalTheme, area: { walls: readonly SeasonalWall[] }): void {
  if (theme === 'none') return;
  const dot = theme === 'christmas' ? 'rgba(255,228,169,0.85)' : 'rgba(255,209,129,0.85)';
  for (const wall of area.walls) {
    if (wall.kind !== 'face') continue;
    const cx0 = wall.x;
    const cy0 = wall.y + 4;
    const cx1 = wall.x + wall.w;
    const cy1 = wall.y + 31;
    for (let x = wall.x + 14; x < wall.x + wall.w - 6; x += 24) {
      if (wall.doorways?.some((d) => x >= d.x - 10 && x <= d.x + d.w + 10)) continue;
      const gx = Math.round(x - 17);
      if (gx + 34 < -buf.ox || gx > buf.w - buf.ox) continue;
      const gy = wall.y - 8;
      for (const p of glowPixels(theme)) {
        const px = gx + p.x;
        const py = gy + p.y;
        if (px >= cx0 && px < cx1 && py >= cy0 && py < cy1) buf.set(px, py, p.c);
      }
      buf.rect(Math.round(x), wall.y + 9, 2, 2, dot);
    }
  }
}

// Christmas snow on a window glass: a ledge of snow and 12 flakes at fixed positions (no time argument).
export function paintSeasonalWindow(buf: PixelBuf, theme: SeasonalTheme, glass: PxRect, seed: number): void {
  if (theme !== 'christmas') return;
  const snow = 'rgba(237,243,243,0.7)';
  const ledge = Math.min(2, glass.h);
  buf.rect(glass.x, glass.y + glass.h - ledge, glass.w, ledge, snow);
  for (let i = 0; i < 12; i++) {
    const x = ((seed >>> 0) + i * 17) % Math.max(1, Math.floor(glass.w));
    const y = (i * 11) % Math.max(1, Math.floor(glass.h));
    buf.set(Math.floor(glass.x + x), Math.floor(glass.y + y), snow);
  }
}
