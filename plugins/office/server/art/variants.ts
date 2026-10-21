// Port of habblaud client/src/art/dynamic.ts and client/src/art/api.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt).
// Rewrite from canvas to PixelBuf with static-frame entry points; time is frame * SCREEN_FRAME_MS and the clock takes hours and minutes.
import type { Rect } from '../../shared/art-types.ts';
import { mix } from './core/color.ts';
import { PixelBuf } from './core/pixbuf.ts';

// Screen modes in a fixed order.
export const SCREEN_MODES = ['off', 'standby', 'idle', 'code', 'terminal', 'browser', 'search', 'chat', 'docs', 'tasks', 'alert', 'progress', 'show', 'game'] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];
// Status of a kanban board item.
export type BoardItemStatus = 'pending' | 'in_progress' | 'completed';
// Milliseconds one animation frame stands for, and the number of frames a caller may ask for.
export const SCREEN_FRAME_MS = 600;
export const SCREEN_FRAMES = 8;
// Largest edge of a variant in pixels.
const VARIANT_MAX = 1024;

// Fills a rectangle; the buffer bounds are the clip.
function fill(buf: PixelBuf, x: number, y: number, w: number, h: number, c: string): void {
  buf.rect(x, y, w, h, c);
}

// Fast deterministic integer hash (no allocation).
function h32(a: number, b = 0): number {
  let x = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

// Fractional part.
function frac(n: number): number {
  return n - Math.floor(n);
}

// Syntax colours of the code screen.
const SYNTAX = ['#ff79c6', '#8be9fd', '#f1fa8c', '#50fa7b', '#bd93f9', '#ffb86c', '#f8f8f2'] as const;

// Screen content of a mode at time t (ms).
function drawScreen(buf: PixelBuf, r: Rect, mode: ScreenMode, t: number, seed: number): void {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  if (w <= 0 || h <= 0) return;
  const s = seed >>> 0;
  switch (mode) {
    case 'off': {
      fill(buf, x, y, w, h, '#22324f');
      fill(buf, x, y, w, 1, '#2a3d5f');
      fill(buf, x, y + h - 1, w, 1, '#1d2b45');
      const k0 = w - 3 - Math.floor(h / 3);
      for (let i = 0; i < h; i++) {
        const sx = x + k0 - i;
        fill(buf, sx, y + i, 2, 1, '#2f4569');
        fill(buf, sx + 2, y + i, 1, 1, '#293c5e');
        fill(buf, sx + 5, y + i, 1, 1, '#283b5b');
      }
      break;
    }
    case 'standby': {
      const bands = ['#2d63ad', '#285a9f', '#235192', '#1f4884'];
      for (let i = 0; i < h; i++) fill(buf, x, y + i, w, 1, bands[Math.min(bands.length - 1, Math.floor((i * bands.length) / h))]);
      fill(buf, x, y, w, 1, '#3a74c0');
      const cx = x + Math.floor((w - 1) / 2);
      const cy = y + Math.floor((h - 1) / 2) - (h >= 9 ? 1 : 0);
      const pulse = (Math.floor(t / 700) + (s % 3)) % 4;
      const logo = ['#9fcaf5', '#b7d8f8', '#d3e8fb', '#b7d8f8'][pulse];
      fill(buf, cx, cy - 1, 1, 1, logo);
      fill(buf, cx - 1, cy, 1, 1, logo);
      fill(buf, cx + 1, cy, 1, 1, logo);
      fill(buf, cx, cy + 1, 1, 1, logo);
      fill(buf, cx, cy, 1, 1, '#6aa6e6');

      if (h >= 7) fill(buf, cx - 2, cy + 3, 5, 1, '#4f86c9');
      break;
    }
    case 'idle': {
      for (let i = 0; i < h; i++) fill(buf, x, y + i, w, 1, mix('#1b2a4a', '#2c1f4a', i / h));
      const px = bounce(t / 140 + (s % 17), Math.max(1, w - 2));
      const py = bounce(t / 190 + (s % 11), Math.max(1, h - 2));
      const hue = Math.floor(t / 900 + s) % 4;
      fill(buf, x + px, y + py, 2, 2, ['#7fd0ff', '#ff9ad5', '#9be59b', '#ffd36b'][hue]);
      break;
    }
    case 'code': {
      fill(buf, x, y, w, h, '#1d2130');
      fill(buf, x, y, Math.min(2, w), h, '#252a3c');
      const rows = Math.floor(h / 2);
      const scroll = Math.floor(t / 420 + (s % 50));
      for (let i = 0; i < rows; i++) {
        const line = scroll + i;
        const hh = h32(s, line);
        const yy = y + i * 2 + 1;
        if (yy >= y + h) break;
        fill(buf, x, yy, 1, 1, '#4a5170');
        let cx = x + 3 + (hh % 4);
        const tokens = 1 + ((hh >>> 3) % 3);
        if ((hh >>> 7) % 7 === 0) continue;
        for (let k = 0; k < tokens && cx < x + w - 1; k++) {
          const tw = 1 + ((hh >>> (9 + k * 4)) % 4);
          fill(buf, cx, yy, Math.min(tw, x + w - 1 - cx), 1, SYNTAX[(hh >>> (5 + k * 3)) % SYNTAX.length]);
          cx += tw + 1;
        }
        if (i === rows - 1 && Math.floor(t / 500) % 2 === 0 && cx < x + w) fill(buf, cx, yy, 1, 1, '#f8f8f2');
      }
      break;
    }
    case 'terminal': {
      fill(buf, x, y, w, h, '#0c120f');
      const rows = Math.floor((h - 1) / 2);
      const step = Math.floor(t / 260) + (s % 40);
      const lineLen = (n: number) => 2 + (h32(s, n) % Math.max(2, w - 4));

      const slot = Math.max(2, w - 4) + 3;
      const line = Math.floor(step / slot);
      const typed = Math.min(lineLen(line), step - line * slot);
      for (let i = 0; i < rows; i++) {
        const n = line - (rows - 1) + i;
        if (n < 0) continue;
        const yy = y + 1 + i * 2;
        const len = n === line ? typed : lineLen(n);
        fill(buf, x + 1, yy, 1, 1, '#5cff7a');
        fill(buf, x + 3, yy, Math.min(len, w - 4), 1, n === line ? '#8ef0a0' : '#3fae5c');
        if (n === line && Math.floor(t / 450) % 2 === 0) fill(buf, x + 3 + Math.min(len, w - 5), yy, 1, 1, '#d6ffe0');
      }
      break;
    }
    case 'browser': {
      fill(buf, x, y, w, h, '#f3f5f8');
      fill(buf, x, y, w, 2, '#d5dbe4');
      fill(buf, x + 1, y, 1, 1, '#ff6b6b');
      if (w > 6) fill(buf, x + 3, y, 1, 1, '#f7c948');
      if (w > 8) fill(buf, x + 5, y + 1, w - 6, 1, '#ffffff');
      const off = Math.floor(t / 900 + (s % 9)) % 4;
      const accent = ['#5b8fe0', '#4cae6a', '#e2604f', '#8d66cf'][s % 4];
      const top = y + 3;
      for (let i = 0; i < h - 3; i++) {
        const row = i + off;
        const yy = top + i;
        if (row % 6 < 3) {
          if (row % 12 < 3) fill(buf, x + 1, yy, Math.max(1, Math.floor(w * 0.45)), 1, accent);
          else fill(buf, x + 1, yy, Math.max(1, w - 2 - (row % 5)), 1, row % 6 === 0 ? '#9aa5b5' : '#c8cfd9');
        } else if (row % 6 === 3) {
          fill(buf, x + 1, yy, Math.floor(w / 2) - 1, 2, mix(accent, '#ffffff', 0.55));
          fill(buf, x + Math.floor(w / 2) + 1, yy, Math.ceil(w / 2) - 2, 1, '#c8cfd9');
        }
      }
      break;
    }
    case 'search': {
      fill(buf, x, y, w, h, '#ffffff');
      fill(buf, x + 1, y + 1, w - 2, 2, '#e3e8ef');
      fill(buf, x + 2, y + 1, Math.max(1, w - 6), 1, '#ffffff');
      fill(buf, x + w - 3, y + 1, 1, 1, '#3f7fd8');
      fill(buf, x + w - 2, y + 2, 1, 1, '#3f7fd8');
      const sel = Math.floor(t / 700 + (s % 5)) % 3;
      for (let i = 0; i < 3; i++) {
        const yy = y + 4 + i * 3;
        if (yy + 1 >= y + h) break;
        if (i === sel) fill(buf, x, yy - 1, w, 3, '#eef4ff');
        fill(buf, x + 1, yy, Math.max(1, w - 4 - ((s + i) % 4)), 1, '#3f7fd8');
        fill(buf, x + 1, yy + 1, Math.max(1, w - 6 + ((s + i) % 3)), 1, '#b6bfcc');
      }
      break;
    }
    case 'chat': {
      fill(buf, x, y, w, h, '#eef1f6');
      const step = Math.floor(t / 1100 + (s % 13));
      const bubbles = Math.floor(h / 3);
      for (let i = 0; i < bubbles; i++) {
        const n = step + i;
        const mine = (h32(s, n) & 1) === 1;
        const bw = Math.max(3, Math.min(w - 3, 4 + (h32(s, n) >>> 2) % Math.max(1, w - 5)));
        const yy = y + h - 3 - (bubbles - 1 - i) * 3;
        if (yy < y) continue;
        fill(buf, mine ? x + w - 1 - bw : x + 1, yy, bw, 2, mine ? '#5b8fe0' : '#d6dce6');
      }

      const dot = Math.floor(t / 250) % 3;
      for (let k = 0; k < 3; k++) fill(buf, x + 2 + k * 2, y + 1, 1, 1, k === dot ? '#5b6b85' : '#b8c2d2');
      break;
    }
    case 'docs': {
      fill(buf, x, y, w, h, '#e9edf2');
      fill(buf, x + 1, y, w - 2, h, '#ffffff');
      const off = Math.floor(t / 1500 + (s % 7)) % 3;
      fill(buf, x + 2, y + 1, Math.max(1, Math.floor(w * 0.5)), 1, '#2b2f3b');
      for (let i = 0; i < h - 3; i++) {
        const row = i + off;
        const yy = y + 3 + i;
        if (row % 4 === 3) continue;
        fill(buf, x + 2, yy, Math.max(1, w - 4 - (h32(s, row) % 4)), 1, row % 4 === 0 ? '#7d8796' : '#b9c1cd');
      }
      break;
    }
    case 'tasks': {
      fill(buf, x, y, w, h, '#fffaf0');
      const rows = Math.floor((h - 1) / 2);
      const done = Math.floor(t / 900 + (s % 6)) % (rows + 2);
      for (let i = 0; i < rows; i++) {
        const yy = y + 1 + i * 2;
        const ok = i < done;
        fill(buf, x + 1, yy, 1, 1, ok ? '#3fae5c' : '#b9c1cd');
        fill(buf, x + 3, yy, Math.max(1, w - 5 - ((s + i) % 3)), 1, ok ? '#a8d8b3' : '#8b95a5');
      }
      break;
    }
    case 'progress': {
      fill(buf, x, y, w, h, '#0b1210');
      fill(buf, x, y + h - 1, w, 1, '#0f1916');
      const tiny = h < 9;

      fill(buf, x + 1, y + 1, 1, 1, '#5cff7a');
      fill(buf, x + 3, y + 1, Math.max(1, Math.min(w - 5, 4 + (h32(s, 1) % Math.max(1, w - 7)))), 1, '#3c8f57');

      if (h >= 13) {
        fill(buf, x + 3, y + 3, Math.max(1, Math.min(w - 5, 3 + (h32(s, 2) % Math.max(1, w - 6)))), 1, '#2a5c3c');
        fill(buf, x + 3, y + 5, Math.max(1, Math.min(w - 5, 2 + (h32(s, 3) % Math.max(1, w - 6)))), 1, '#2a5c3c');
      }

      const by = tiny ? y + 3 : h >= 13 ? y + h - 7 : y + 3;
      const bh = tiny ? 1 : 2;
      const inner = Math.max(1, w - 4);
      fill(buf, x + 1, by, 1, bh, '#7d8ea0');
      fill(buf, x + w - 2, by, 1, bh, '#7d8ea0');
      fill(buf, x + 2, by, inner, bh, '#163322');
      const period = 3400 + (s % 5) * 300;
      const cycle = (t + (s % 997) * 37) / period;
      const p = frac(cycle);

      const filled = p < 0.85 ? Math.floor((p / 0.85) * (inner + 1)) : inner;
      const done = p >= 0.85;
      if (filled > 0) {
        const blink = done && Math.floor(t / 160) % 2 === 0;
        fill(buf, x + 2, by, filled, bh, blink ? '#b9ffca' : '#3ccf63');
        if (bh > 1) fill(buf, x + 2, by, filled, 1, blink ? '#e4ffe9' : '#7cf09a');
        if (!done) fill(buf, x + 1 + filled, by, 1, bh, '#d8ffe2');
      }

      const sy = tiny ? y + h - 3 : h >= 13 ? y + h - 4 : y + h - 4;
      if (sy + 2 < y + h) {
        const RING = [[1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0]] as const;
        const head = Math.floor(t / 110 + (s % 8)) % 8;
        for (let k = 0; k < 8; k++) {
          const age = (head - k + 8) % 8;
          const c = age === 0 ? '#9ff3ff' : age === 1 ? '#4fb8d6' : age === 2 ? '#2b6f86' : '#173a45';
          fill(buf, x + 1 + RING[k][0], sy + RING[k][1], 1, 1, c);
        }

        const dots = Math.floor(t / 420 + (s % 3)) % 4;
        for (let k = 0; k < dots && 5 + k * 2 < w - 2; k++) fill(buf, x + 5 + k * 2, sy + 2, 1, 1, '#3c8f57');
        if (Math.floor(t / 500) % 2 === 0 && x + 11 < x + w) fill(buf, x + 11, sy + 1, 1, 2, '#d6ffe0');
      }
      break;
    }
    case 'show': {
      const prog = s % 3;
      if (prog === 0) drawFootball(buf, x, y, w, h, t, s);
      else if (prog === 1) drawSoap(buf, x, y, w, h, t, s);
      else drawCartoon(buf, x, y, w, h, t, s);
      break;
    }
    case 'game': {
      if (s % 2 === 0) drawRace(buf, x, y, w, h, t, s);
      else drawFight(buf, x, y, w, h, t, s);
      break;
    }
    case 'alert': {
      const on = Math.floor(t / 380) % 2 === 0;
      fill(buf, x, y, w, h, on ? '#f2b33d' : '#8a5a12');
      const cx = x + Math.floor(w / 2);
      const cy = y + Math.floor(h / 2);
      const ink = on ? '#3a2a08' : '#f7d27a';
      fill(buf, cx, cy - 2, 1, 3, ink);
      fill(buf, cx, cy + 2, 1, 1, ink);
      if (h >= 9) {
        fill(buf, cx - 1, cy - 3, 3, 1, ink);
        fill(buf, cx, cy - 4, 1, 1, ink);
      }
      break;
    }
  }
}

// 3 by 5 letters for the TV vignettes (GOL, KO): each row becomes a few fills.
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  G: ['###', '#..', '#.#', '#.#', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  K: ['#.#', '##.', '#..', '##.', '#.#'],
};

// Draws a word of GLYPHS letters.
function drawWord(buf: PixelBuf, word: string, x: number, y: number, c: string): void {
  for (let i = 0; i < word.length; i++) {
    const g = GLYPHS[word[i]];
    if (!g) continue;
    for (let r = 0; r < g.length; r++) {
      const row = g[r];
      let k = 0;
      while (k < row.length) {
        if (row[k] !== '#') {
          k++;
          continue;
        }
        let e = k;
        while (e < row.length && row[e] === '#') e++;
        fill(buf, x + i * 4 + k, y + r, e - k, 1, c);
        k = e;
      }
    }
  }
}

// Centred word on a dark band (readable over any scene).
function banner(buf: PixelBuf, word: string, x: number, y: number, w: number, h: number, c: string): void {
  const ww = word.length * 4 - 1;
  const bx = x + Math.floor((w - ww) / 2);
  const by = y + Math.floor((h - 5) / 2);
  fill(buf, bx - 2, by - 1, ww + 4, 7, 'rgba(12,16,28,0.78)');
  drawWord(buf, word, bx, by, c);
}

// Duration of one football play on the TV (the ball leaves the middle and ends in a goal).
const FOOTBALL_LANCE_MS = 7000;

// From this fraction of a play the ball is in the goal and the screen flashes GOL.
const FOOTBALL_GOAL_AT = 0.8;

// Football play at time t: play number, progress (0 to 1) and whether the ball goes to the right goal.
function footballLance(t: number, s: number): { lance: number; progress: number; right: boolean; period: number; goalAt: number } {
  const k = Math.floor((t + (s % 997) * 13) / FOOTBALL_LANCE_MS);
  const p = frac((t + (s % 997) * 13) / FOOTBALL_LANCE_MS);
  return { lance: k, progress: p, right: (h32(s, k) & 1) === 1, period: FOOTBALL_LANCE_MS, goalAt: FOOTBALL_GOAL_AT };
}

// Football: striped pitch, centre line, goals, two teams following the ball and a scoreboard.
function drawFootball(buf: PixelBuf, x: number, y: number, w: number, h: number, t: number, s: number): void {
  const { lance: k, progress: p } = footballLance(t, s);
  fill(buf, x, y, w, h, '#3f9a4a');
  for (let i = 0; i * 4 < w; i += 2) fill(buf, x + i * 4, y, 4, h, '#48a855');
  const mx = x + Math.floor(w / 2);
  const my = y + Math.floor(h / 2);
  fill(buf, mx, y, 1, h, '#cfeccd');
  if (h >= 9) {
    fill(buf, mx - 2, my - 1, 1, 3, '#cfeccd');
    fill(buf, mx + 2, my - 1, 1, 3, '#cfeccd');
    fill(buf, mx - 1, my - 2, 3, 1, '#cfeccd');
    fill(buf, mx - 1, my + 2, 3, 1, '#cfeccd');
  }
  const gh = Math.max(3, Math.floor(h / 3));
  fill(buf, x, my - Math.floor(gh / 2), 1, gh, '#ffffff');
  fill(buf, x + w - 1, my - Math.floor(gh / 2), 1, gh, '#ffffff');

  const right = footballLance(t, s).right;
  const u = Math.min(1, p / 0.8);
  const ease = u * u * (3 - 2 * u);
  const span = Math.floor(w / 2) - 1;
  const bx = mx + Math.round((right ? 1 : -1) * span * ease);
  const sway = Math.round(Math.sin(u * Math.PI * 3 + (s % 7)) * Math.max(1, (h - 6) / 3) * (1 - ease));
  const by = my + sway;

  for (let i = 0; i < 6; i++) {
    const red = i < 3;
    const hh = h32(s + i * 31, 7);
    const baseX = mx + (red ? -1 : 1) * Math.floor((w / 2) * (0.25 + (i % 3) * 0.22));
    const baseY = y + 2 + Math.floor(((i % 3) + 0.5) * ((h - 4) / 3));
    const pull = 0.35 + (hh % 5) * 0.08;
    const jx = Math.round(Math.sin(t / (420 + (hh % 300)) + i) * 1.2);
    const px = Math.round(baseX + (bx - baseX) * pull) + jx;
    const py = Math.round(baseY + (by - baseY) * pull * 0.6);
    fill(buf, px, py - 1, 1, 2, red ? '#e8454a' : '#3d7ce0');
  }
  fill(buf, bx, by + 1, 1, 1, 'rgba(10,40,10,0.45)');
  fill(buf, bx, by, 1, 1, '#ffffff');

  if (w >= 16 && h >= 9) {
    const goals = [0, 0];
    for (let j = k - (k % 4); j < k; j++) goals[h32(s, j) & 1]++;
    fill(buf, x + 1, y + 1, 11, 3, 'rgba(12,16,28,0.8)');
    fill(buf, x + 2, y + 2, 1, 1, '#e8454a');
    for (let g = 0; g < goals[0]; g++) fill(buf, x + 4 + g, y + 2, 1, 1, '#ffffff');
    fill(buf, x + 9, y + 2, 1, 1, '#3d7ce0');
    for (let g = 0; g < goals[1]; g++) fill(buf, x + 8 - g - 1, y + 2, 1, 1, '#9fc4ff');
  }
  if (p >= FOOTBALL_GOAL_AT) {
    const blink = Math.floor(t / 180) % 2 === 0;
    const c = blink ? '#ffd84d' : '#ffffff';
    fill(buf, x, y, w, 1, c);
    fill(buf, x, y + h - 1, w, 1, c);
    fill(buf, x, y, 1, h, c);
    fill(buf, x + w - 1, y, 1, h, c);
    if (w >= 15 && h >= 9) banner(buf, 'GOL', x, y, w, h, c);
  }
}

// Close-up face of the soap opera: hair, skin, eyes and mouth at scale sc.
function soapFace(buf: PixelBuf, cx: number, cy: number, sc: number, skin: string, hair: string, long: boolean, look: number, blush: boolean): void {
  const fw = 6 * sc;
  const fh = 7 * sc;
  const fx = cx - Math.floor(fw / 2);
  const fy = cy - Math.floor(fh / 2);
  if (long) fill(buf, fx - sc, fy, fw + 2 * sc, fh + 2 * sc, hair);
  fill(buf, fx, fy + sc, fw, fh - sc, skin);
  fill(buf, fx + sc, fy + fh, fw - 2 * sc, sc, skin);
  fill(buf, fx, fy - sc, fw, 2 * sc, hair);
  if (!long) fill(buf, fx, fy + sc, sc, 2 * sc, hair);
  const ex = look === 0 ? sc : 0;
  fill(buf, fx + sc + ex, fy + 3 * sc, sc, sc, '#2b2236');
  fill(buf, fx + 4 * sc + ex - sc, fy + 3 * sc, sc, sc, '#2b2236');
  if (blush) {
    fill(buf, fx + sc - (sc > 1 ? 0 : 1) + ex, fy + 4 * sc + (sc > 1 ? 1 : 0), sc, sc > 1 ? 1 : 1, '#f08a96');
    fill(buf, fx + 4 * sc + ex - sc + (sc > 1 ? 0 : 1), fy + 4 * sc + (sc > 1 ? 1 : 0), sc, 1, '#f08a96');
  }
  fill(buf, fx + 2 * sc + ex, fy + 5 * sc, Math.max(1, sc + Math.floor(sc / 2)), Math.max(1, Math.floor(sc / 2)), '#b4475a');
}

// Pink heart of 3 by 3.
function heart(buf: PixelBuf, x: number, y: number, c: string): void {
  fill(buf, x, y, 1, 1, c);
  fill(buf, x + 2, y, 1, 1, c);
  fill(buf, x, y + 1, 3, 1, c);
  fill(buf, x + 1, y + 2, 1, 1, c);
}

// Soap opera: warm background, cuts between the two leads in close-up and the couple with rising hearts.
function drawSoap(buf: PixelBuf, x: number, y: number, w: number, h: number, t: number, s: number): void {
  const CUT = 2600;
  const shot = Math.floor((t + (s % 97) * 31) / CUT) % 4;
  const wall = ['#c98a6a', '#b77a62', '#d6a27c', '#8f6f9e'][s % 4];
  fill(buf, x, y, w, h, wall);
  fill(buf, x, y + h - Math.max(2, Math.floor(h / 5)), w, Math.max(2, Math.floor(h / 5)), mix(wall, '#2b2236', 0.35));

  fill(buf, x + w - Math.floor(w / 3), y + 1, Math.floor(w / 4), Math.floor(h / 2), '#ffd59a');
  fill(buf, x + w - Math.floor(w / 3) + Math.floor(w / 8), y + 1, 1, Math.floor(h / 2), mix(wall, '#2b2236', 0.2));
  const sc = h >= 13 ? 2 : 1;
  const her = { skin: '#f2c3a0', hair: '#5a2f24' };
  const him = { skin: '#c98f68', hair: '#2b2530' };
  const my = y + Math.floor(h / 2) + (sc > 1 ? 1 : 0);
  if (shot === 0) soapFace(buf, x + Math.floor(w / 2), my, sc, her.skin, her.hair, true, 0, true);
  else if (shot === 1) soapFace(buf, x + Math.floor(w / 2), my, sc, him.skin, him.hair, false, 1, false);
  else {
    const s1 = w >= 34 ? sc : 1;
    soapFace(buf, x + Math.floor(w * 0.3), my, s1, her.skin, her.hair, true, 0, shot === 3);
    soapFace(buf, x + Math.floor(w * 0.7), my, s1, him.skin, him.hair, false, 1, false);
    if (shot === 3) {
      for (let i = 0; i < 2; i++) {
        const life = frac((t + i * 700) / 1400);
        heart(buf, x + Math.floor(w / 2) - 1 + (i ? 1 : -1), y + h - 3 - Math.floor(life * (h - 2)), i ? '#ff7aa8' : '#ff4f7e');
      }
    }
  }
}

// Cartoon: sky, sun, passing clouds and a pink critter hopping, chased by a yellow one.
function drawCartoon(buf: PixelBuf, x: number, y: number, w: number, h: number, t: number, s: number): void {
  fill(buf, x, y, w, h, '#7fd3ff');
  fill(buf, x, y, w, Math.floor(h / 3), '#9fe0ff');
  const gh = Math.max(2, Math.floor(h / 4));
  fill(buf, x, y + h - gh, w, gh, '#6cc04a');
  fill(buf, x, y + h - gh, w, 1, '#8ee070');
  fill(buf, x + w - 4, y + 1, 3, 3, '#ffd84d');
  fill(buf, x + w - 3, y + 2, 1, 1, '#fff2a8');
  for (let i = 0; i < 2; i++) {
    const cx = x + w - 1 - Math.floor(frac(t / (9000 + i * 4000) + i * 0.5 + (s % 5) * 0.1) * (w + 8));
    const cy = y + 1 + i * 3;
    fill(buf, cx, cy + 1, 5, 2, '#ffffff');
    fill(buf, cx + 1, cy, 3, 1, '#ffffff');
  }
  const run = frac(t / 5200 + (s % 11) * 0.09);
  const ground = y + h - gh;
  const hop = Math.abs(Math.sin((t / 260) % Math.PI)) * Math.max(2, h / 3);
  const px = x + Math.floor(run * (w + 6)) - 3;
  const py = ground - 4 - Math.round(hop);
  fill(buf, px, py, 4, 4, '#ff7ab8');
  fill(buf, px + 1, py + 1, 1, 1, '#2b2236');
  fill(buf, px + 3, py + 1, 1, 1, '#2b2236');
  fill(buf, px + 1, py + 3, 2, 1, '#d84a8a');
  const qx = px - 7;
  const qy = ground - 3 - Math.round(Math.abs(Math.sin((t / 260 + 1.2) % Math.PI)) * Math.max(1, h / 4));
  fill(buf, qx, qy, 3, 3, '#ffd84d');
  fill(buf, qx + 2, qy + 1, 1, 1, '#2b2236');
}

// Split-screen race: a track per half with moving stripes, trees and one car per player.
function drawRace(buf: PixelBuf, x: number, y: number, w: number, h: number, t: number, s: number): void {
  const half = Math.floor(h / 2);
  const cars = ['#e8454a', '#3d7ce0'];
  for (let i = 0; i < 2; i++) {
    const hy = y + i * (h - half);
    const hh = i === 0 ? half : h - half;
    fill(buf, x, hy, w, hh, '#6a7280');
    fill(buf, x, hy, w, 1, '#4caf50');
    fill(buf, x, hy + hh - 1, w, 1, '#4caf50');
    const speed = 0.045 + i * 0.006;
    const off = Math.floor(t * speed + (s % 13)) % 6;
    const lane = hy + Math.floor(hh / 2);
    for (let lx = -off; lx < w; lx += 6) fill(buf, x + lx, lane, 3, 1, '#f4f4f0');
    const tree = Math.floor(t * speed * 0.8 + i * 9) % (w + 6);
    fill(buf, x + w - tree, hy, 2, 1, '#2e7d32');

    const lead = Math.sin(t / 2300 + (s % 9) + i * Math.PI);
    const cx = x + Math.floor(w * 0.3) + Math.round(lead * Math.max(1, w / 8));
    const cy = lane - 1 + (Math.floor(t / 130 + i) % 2 === 0 ? 0 : (hh >= 6 ? 1 : 0));
    fill(buf, cx, cy, 4, 2, cars[i]);
    fill(buf, cx + 2, cy, 1, 1, '#cfe6ff');
    fill(buf, cx, cy + 2 <= hy + hh - 2 ? cy + 2 : cy + 1, 1, 1, '#1d2029');
    fill(buf, cx + 3, cy + 2 <= hy + hh - 2 ? cy + 2 : cy + 1, 1, 1, '#1d2029');
  }
  fill(buf, x, y + half - (h % 2 === 0 ? 1 : 0), w, 1, '#11141c');
}

// Fight: purple stage, two fighters trading punches, life bars and a flashing KO.
function drawFight(buf: PixelBuf, x: number, y: number, w: number, h: number, t: number, s: number): void {
  const ROUND = 9000;
  const tt = t + (s % 991) * 17;
  const k = Math.floor(tt / ROUND);
  const p = frac(tt / ROUND);
  fill(buf, x, y, w, h, '#3b2a6b');
  fill(buf, x, y + Math.floor(h / 3), w, Math.floor(h / 3), '#4b3784');
  const floorH = Math.max(2, Math.floor(h / 4));
  fill(buf, x, y + h - floorH, w, floorH, '#7a4f2a');
  fill(buf, x, y + h - floorH, w, 1, '#a8723f');

  const loser = h32(s, k) & 1;
  const bw = Math.max(3, Math.floor(w / 2) - 2);
  const fight = Math.min(1, p / 0.82);
  const lifeOf = (who: number) => Math.max(0, 1 - fight * (who === loser ? 1 : 0.55));
  for (let who = 0; who < 2; who++) {
    const bx = who === 0 ? x + 1 : x + w - 1 - bw;
    fill(buf, bx, y + 1, bw, 2, '#5a1d2a');
    const lw = Math.round(bw * lifeOf(who));
    if (lw > 0) fill(buf, who === 0 ? bx : bx + bw - lw, y + 1, lw, 2, lifeOf(who) > 0.35 ? '#ffd84d' : '#ff6b4a');
  }

  const ground = y + h - floorH;
  const gap = Math.max(3, Math.round(w * (0.18 + 0.12 * Math.abs(Math.sin(tt / 900)))));
  const mx = x + Math.floor(w / 2);

  const hitter = h32(s, Math.floor(tt / 300)) % 3;
  const ko = p >= 0.82;
  for (let who = 0; who < 2; who++) {
    const dir = who === 0 ? 1 : -1;
    const fx = who === 0 ? mx - gap - 2 : mx + gap;
    const down = ko && who === loser;
    const body = who === 0 ? '#e8454a' : '#3d7ce0';
    const hit = !ko && hitter === 1 - who;
    if (down) {
      fill(buf, fx - 1, ground - 2, 4, 2, body);
      fill(buf, who === 0 ? fx - 3 : fx + 3, ground - 2, 2, 2, '#f2c3a0');
      continue;
    }
    const bob = Math.floor(tt / 220 + who) % 2;
    fill(buf, fx, ground - 7 + bob, 2, 2, hit ? '#ffffff' : '#f2c3a0');
    fill(buf, fx, ground - 5 + bob, 2, 3, hit ? '#ffffff' : body);
    fill(buf, fx, ground - 2, 1, 2, '#2b2530');
    fill(buf, fx + 1, ground - 2, 1, 2, '#2b2530');
    const punching = !ko && hitter === who;
    const ax = dir > 0 ? fx + 2 : fx - (punching ? 3 : 1);
    fill(buf, ax, ground - 5 + bob, punching ? 3 : 1, 1, '#f2c3a0');
  }
  if (ko && Math.floor(tt / 200) % 2 === 0 && w >= 12 && h >= 9) banner(buf, 'KO', x, y, w, h, '#ffd84d');
}

// Triangle wave between 0 and span.
function bounce(v: number, span: number): number {
  const p = frac(v / (span * 2)) * span * 2;
  return Math.floor(p < span ? p : span * 2 - p);
}

// Sticky note colours per status.
const NOTE = {
  pending: ['#ffe27a', '#ffd0a8'],
  in_progress: ['#8fd0ff', '#a9e0ff'],
  completed: ['#9be59b', '#b8efb0'],
} as const;

// Kanban board sticky notes (columns: to do, doing, done).
function drawBoard(buf: PixelBuf, r: Rect, items: readonly { status: 'pending' | 'in_progress' | 'completed' }[], t: number): void {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  const colW = Math.floor(w / 3);
  const header = ['#f2b33d', '#3f7fd8', '#3fae5c'];
  for (let c = 0; c < 3; c++) {
    fill(buf, x + c * colW + 1, y, colW - 2, 1, header[c]);
    if (c > 0) fill(buf, x + c * colW - 1, y + 2, 1, h - 3, '#e1e6ec');
  }
  const order = ['pending', 'in_progress', 'completed'] as const;
  const per = colW >= 11 ? 2 : 1;
  const counts = [0, 0, 0];
  for (const it of items) {
    const c = order.indexOf(it.status);
    if (c < 0) continue;
    const k = counts[c]++;
    const nx = x + c * colW + 1 + (k % per) * 5;
    const ny = y + 2 + Math.floor(k / per) * 4;
    if (ny + 3 > y + h) {
      if (k % per === 0) fill(buf, x + c * colW + Math.floor(colW / 2) - 1, y + h - 1, 3, 1, '#9aa4b2');
      continue;
    }
    const pal = NOTE[it.status];
    const col = pal[k % 2];
    fill(buf, nx, ny, 4, 3, col);
    fill(buf, nx, ny + 2, 4, 1, mix(col, '#7a6a4a', 0.25));
    fill(buf, nx + 1, ny + 1, 2, 1, mix(col, '#2b2f3b', 0.35));
    if (it.status === 'completed') fill(buf, nx + 3, ny, 1, 1, '#2e8a46');
    if (it.status === 'in_progress' && Math.floor(t / 600 + k) % 2 === 0) fill(buf, nx, ny, 4, 1, '#e8f6ff');
  }
}

// Sky colour keys over the day: [hour, top, horizon].
const SKY: readonly (readonly [number, string, string])[] = [
  [0, '#0b1230', '#1f2b57'],
  [4.6, '#0e1838', '#28335f'],
  [5.6, '#38397a', '#e48a6c'],
  [6.6, '#6ea6df', '#f5c99c'],
  [8, '#79b8eb', '#d2ebfa'],
  [16, '#70b0e8', '#d8edf8'],
  [17.4, '#5f86c8', '#f5b37c'],
  [18.4, '#4a4f96', '#ef8a68'],
  [19.4, '#26295f', '#7a4e86'],
  [20.4, '#111b42', '#2b3565'],
  [24, '#0b1230', '#1f2b57'],
];

// Sky colours and night and day levels at an hour.
function skyAt(hour: number): { top: string; bottom: string; night: number; day: number } {
  const hr = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1][0] <= hr) i++;
  const [h0, t0, b0] = SKY[i];
  const [h1, t1, b1] = SKY[i + 1];
  const u = (hr - h0) / Math.max(0.001, h1 - h0);
  const night = hr < 5 || hr > 20 ? 1 : hr < 6.2 ? Math.max(0, (6.2 - hr) / 1.2) : hr > 19 ? Math.min(1, (hr - 19) / 1.2) : 0;
  const day = hr > 7 && hr < 17 ? 1 : hr >= 6 && hr <= 7 ? hr - 6 : hr >= 17 && hr <= 18.5 ? (18.5 - hr) / 1.5 : 0;
  return { top: mix(t0, t1, u), bottom: mix(b0, b1, u), night, day };
}

// Sky and skyline seen through the window at an hour.
function drawWindowView(buf: PixelBuf, r: Rect, hour: number, t: number, seed: number): void {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  if (w <= 0 || h <= 0) return;
  const s = seed >>> 0;
  const sky = skyAt(hour);
  for (let i = 0; i < h; i++) fill(buf, x, y + i, w, 1, mix(sky.top, sky.bottom, i / Math.max(1, h - 1)));

  if (sky.night > 0.3) {
    for (let k = 0; k < 7; k++) {
      const hh = h32(s, k + 101);
      const sx = x + (hh % w);
      const sy = y + ((hh >>> 8) % Math.max(1, Math.floor(h * 0.55)));
      const tw = Math.floor(t / 600 + k) % 5 === 0;
      fill(buf, sx, sy, 1, 1, tw ? '#8090c0' : '#f2f4ff');
    }
    const mx = x + Math.floor(w * 0.72);
    fill(buf, mx, y + 2, 3, 3, '#f4efd2');
    fill(buf, mx + 2, y + 2, 1, 1, sky.top);
    fill(buf, mx, y + 4, 1, 1, '#d9d2ad');
  }

  const hr = ((hour % 24) + 24) % 24;
  if (hr > 5.6 && hr < 19) {
    const p = (hr - 5.6) / 13.4;
    const sx = x + Math.floor(p * (w - 3));
    const sy = y + Math.floor((1 - Math.sin(p * Math.PI)) * (h * 0.55)) + 1;
    const warm = sky.day < 0.7;
    fill(buf, sx - 1, sy, 5, 3, warm ? 'rgba(255,190,120,0.35)' : 'rgba(255,250,210,0.35)');
    fill(buf, sx, sy, 3, 3, warm ? '#ffcf86' : '#fff6c8');
  }

  if (sky.night < 0.8) {
    const cloud = sky.day > 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(255,214,190,0.75)';
    for (let k = 0; k < 2; k++) {
      const hh = h32(s, k + 7);
      const span = w + 12;
      const cx = x - 6 + Math.floor(frac((t / 1000) * (0.35 + k * 0.2) / span + (hh % 100) / 100) * span);
      const cy = y + 2 + k * 3 + ((hh >>> 4) % 2);
      const cw = 5 + (hh % 3);
      for (let i = 0; i < cw; i++) {
        const xx = cx + i;
        if (xx < x || xx >= x + w) continue;
        fill(buf, xx, cy + 1, 1, 1, cloud);
        if (i > 0 && i < cw - 1) fill(buf, xx, cy, 1, 1, cloud);
      }
    }
  }

  const city = mix('#8ea8c6', '#1a2138', Math.max(sky.night, 1 - sky.day) * 0.9);
  const cityFar = mix('#b3c6dc', '#262f4d', Math.max(sky.night, 1 - sky.day) * 0.9);
  let bx = x;
  let k = 0;
  while (bx < x + w) {
    const hh = h32(s, k + 300);
    const bw = 3 + (hh % 4);
    const bh = 3 + ((hh >>> 4) % Math.max(2, Math.floor(h * 0.42)));
    const far = (hh >>> 9) % 3 === 0;
    const ww = Math.min(bw, x + w - bx);
    fill(buf, bx, y + h - bh - (far ? 2 : 0), ww, bh + (far ? 2 : 0), far ? cityFar : city);
    if (sky.night > 0.2) {
      for (let wy = y + h - bh + 1; wy < y + h - 1; wy += 2) {
        for (let wx = bx + 1; wx < bx + ww - 1; wx += 2) {
          const on = h32(s + wx * 31, wy) % 3 === 0;
          if (on) fill(buf, wx, wy, 1, 1, Math.floor(t / 3000 + wx + wy) % 17 === 0 ? '#c99a40' : '#f7d77a');
        }
      }
    } else if (!far && bw > 3) {
      for (let wy = y + h - bh + 1; wy < y + h - 1; wy += 2) fill(buf, bx + 1, wy, ww - 2, 1, mix(city, '#e6f0fa', 0.35));
    }
    bx += bw;
    k++;
  }
}

// Clock hands at the given time.
function drawClock(buf: PixelBuf, r: Rect, hours: number, minutes: number, seconds: number): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const sec = seconds;
  const min = minutes + sec / 60;
  const hr = (hours % 12) + min / 60;
  const hand = (angle: number, len: number, color: string) => {
    const a = angle - Math.PI / 2;
    const steps = Math.ceil(len * 2);
    let lx = -999;
    let ly = -999;
    for (let i = 1; i <= steps; i++) {
      const d = (len * i) / steps;
      const px = Math.floor(cx + Math.cos(a) * d);
      const py = Math.floor(cy + Math.sin(a) * d);
      if (px === lx && py === ly) continue;
      fill(buf, px, py, 1, 1, color);
      lx = px;
      ly = py;
    }
  };
  const size = Math.min(r.w, r.h);
  hand((hr / 12) * Math.PI * 2, size * 0.26, '#2b2f3b');
  hand((min / 60) * Math.PI * 2, size * 0.4, '#3a3f4b');
  hand((sec / 60) * Math.PI * 2, size * 0.38, 'rgba(224,90,90,0.85)');
  fill(buf, Math.floor(cx), Math.floor(cy), 1, 1, '#e05a5a');
}

// Checks a variant size and returns a new buffer.
function newVariant(w: number, h: number): PixelBuf {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > VARIANT_MAX || h > VARIANT_MAX) throw new RangeError('size');
  return new PixelBuf(w, h);
}

// Checks an animation frame and returns the time in ms it stands for.
function frameTime(frame: number): number {
  if (!Number.isInteger(frame) || frame < 0 || frame >= SCREEN_FRAMES) throw new RangeError('frame');
  return frame * SCREEN_FRAME_MS;
}

// Screen of a mode as a w by h buffer; the show and game seeds are reduced to the program they pick (3 shows, 2 games).
export function screenVariant(mode: ScreenMode, w: number, h: number, seed: number, frame = 0): PixelBuf {
  if (!(SCREEN_MODES as readonly string[]).includes(mode)) throw new RangeError('mode');
  if (!Number.isFinite(seed)) throw new RangeError('seed');
  const t = frameTime(frame);
  const buf = newVariant(w, h);
  const s = seed >>> 0;
  drawScreen(buf, { x: 0, y: 0, w, h }, mode, t, mode === 'show' ? s % 3 : mode === 'game' ? s % 2 : s);
  return buf;
}

// Kanban board as a w by h buffer; items beyond the board capacity become dots.
export function boardVariant(w: number, h: number, items: readonly { status: BoardItemStatus }[], frame = 0): PixelBuf {
  const t = frameTime(frame);
  if (!Array.isArray(items) || items.length > 1024) throw new RangeError('items');
  const buf = newVariant(w, h);
  drawBoard(buf, { x: 0, y: 0, w, h }, items, t);
  return buf;
}

// Window view as a w by h buffer at a local hour (0 to 24, fractional).
export function windowVariant(w: number, h: number, hour: number, seed: number, frame = 0): PixelBuf {
  if (!Number.isFinite(hour) || !Number.isFinite(seed)) throw new RangeError('hour');
  const t = frameTime(frame);
  const buf = newVariant(w, h);
  drawWindowView(buf, { x: 0, y: 0, w, h }, hour, t, seed);
  return buf;
}

// Clock face as a w by h buffer showing hours (0 to 24), minutes and seconds (0 to 60).
export function clockVariant(w: number, h: number, hours: number, minutes: number, seconds = 0): PixelBuf {
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new RangeError('hours');
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 60) throw new RangeError('minutes');
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= 60) throw new RangeError('seconds');
  const buf = newVariant(w, h);
  drawClock(buf, { x: 0, y: 0, w, h }, hours, minutes, seconds);
  return buf;
}
