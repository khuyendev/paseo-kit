// Ported from marmottajr/habblaud client/src/art/icons.ts at faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice added by 07-05).
// Small pixel-art state icons (above the head), pure. ASCII templates with automatic outline.
// Icon names (~8-12px) for states above the head.
export type IconName = 'alert' | 'question' | 'zzz' | 'check' | 'heart' | 'coffee' | 'music' | 'idea' | 'sweat' | 'star' | 'lightning' | 'chat' | 'box' | 'wave'
  | 'hourglass' // hourglass (waiting for a shell)
  | 'hourglass_flip' // the same hourglass turning over (alternate with 'hourglass' to animate)
  | 'cobweb' // cobweb (~12px) for the corner of the chair/character when the wait gets long
  | 'storm' // little rain cloud with lightning (something failed)
  // --- social life (additive)
  | 'coin' // golden coin with a sparkle (~8px) - earned money
  | 'sparkle' // 4-point sparkle (~9px) - got tidy in the mirror
  | 'trophy' // golden trophy (~10px) - won the match/bet
  | 'hand_rock' // rock gesture (fist) (~10px) - rock-paper-scissors reveal
  | 'hand_paper' // paper gesture (open hand) (~10px)
  | 'hand_scissors'; // scissors gesture (V) (~10px)
import { PixelBuf, type Palette } from './core/pixbuf.ts';
import type { BufSprite } from './core/sprite.ts';

interface IconDef {
  rows: readonly string[];
  pal: Palette;
  /**
   * Outline opacity (0-1). Default 1. Thin strands (cobweb) get a translucent outline so they
   * do not turn into thick dark strokes - they stay legible on both the light floor and the chair.
   */
  outlineAlpha?: number;
  /**
   * Outline opacity in the "holes" (transparent areas surrounded by the drawing, like the cobweb
   * cells). Without it the halo fills every cell and the cobweb becomes a grey smudge. Default = outlineAlpha.
   */
  holeOutlineAlpha?: number;
}

// Hourglass: wooden caps, bluish glass with a highlight on the left and golden sand.
const HOURGLASS_PAL: Palette = {
  t: '#e6b37a', // wood (highlight)
  c: '#c48a52', // wood
  C: '#8f5d36', // wood (shadow)
  g: '#e4f3fc', // glass
  w: '#ffffff', // reflection
  G: '#a6c9e3', // glass in shadow (right)
  s: '#f5c451', // sand
  S: '#d6952a', // sand in shadow
};

const ICONS: Readonly<Record<IconName, IconDef>> = {
  alert: {
    rows: [
      '....o....',
      '...oyo...',
      '...yky...',
      '..yykyy..',
      '..yykyy..',
      '.yyykyyy.',
      '.yyyyyyy.',
      'yyyykyyyy',
      'ddddddddd',
    ],
    pal: { o: '#fff2a8', y: '#f7c843', k: '#4a3510', d: '#d9a12a' },
  },
  question: {
    rows: [
      '..bbbbb..',
      '.bbwwwbb.',
      'bbwbbbwbb',
      'bbbbbbwbb',
      'bbbbbwbbb',
      'bbbbwbbbb',
      'bbbbbbbbb',
      '.bbbwbbb.',
      '..ddddd..',
    ],
    pal: { b: '#4f8fe6', w: '#ffffff', d: '#3466b8' },
  },
  zzz: {
    rows: [
      '.....zzzz',
      '.......z.',
      '......z..',
      'zzz..zzzz',
      '..z......',
      '.z.......',
      'zzz......',
    ],
    pal: { z: '#cfe3ff' },
  },
  check: {
    rows: [
      '..ggggg..',
      '.ggggggg.',
      'gggggggwg',
      'ggggggwwg',
      'gwggggwgg',
      'gwwggwwgg',
      'ggwwwwggg',
      '.ggwwggg.',
      '..ddddd..',
    ],
    pal: { g: '#45b866', w: '#ffffff', d: '#2f8a4a' },
  },
  heart: {
    rows: [
      '.rr...rr.',
      'rhrr.rrrr',
      'rhrrrrrrr',
      'rrrrrrrrr',
      '.rrrrrrd.',
      '..rrrrd..',
      '...rrd...',
      '....d....',
    ],
    pal: { r: '#ef5a6f', h: '#ffb3bf', d: '#c23a50' },
  },
  coffee: {
    rows: [
      '..s..s...',
      '.s..s....',
      '..s..s...',
      'wwwwwww..',
      'wccccchhh',
      'wrrrrrw.h',
      'wrrrrrwhh',
      'wwwwwww..',
      '.ddddd...',
    ],
    pal: { s: '#e6ecf5', w: '#f4f2ee', c: '#6b4226', r: '#e2604f', h: '#d6d2c8', d: '#b9b3a6' },
  },
  music: {
    rows: [
      '...nnnnnn',
      '...nhhhhn',
      '...n....n',
      '...n....n',
      '...n....n',
      '.nnn..nnn',
      'nnnn.nnnn',
      '.nn...nn.',
    ],
    pal: { n: '#8d66cf', h: '#b89aea' },
  },
  idea: {
    rows: [
      '..yyyyy..',
      '.yhhyyyy.',
      'yhhyyyyyy',
      'yhyyyyyyy',
      'yyyyyyyyd',
      '.yyyyyyd.',
      '..yyyyd..',
      '..ggggg..',
      '...ggg...',
    ],
    pal: { y: '#ffd84d', h: '#fff4b8', d: '#e0b12e', g: '#9aa2ae' },
  },
  sweat: {
    rows: [
      '...b...',
      '...b...',
      '..bbb..',
      '.bwbbb.',
      '.bwbbb.',
      'bbbbbbb',
      '.bbbbd.',
      '..ddd..',
    ],
    pal: { b: '#6fc3f2', w: '#e6f6ff', d: '#3f9ad6' },
  },
  star: {
    rows: [
      '....y....',
      '...yhy...',
      '...yhy...',
      'yyyyhyyyy',
      '.yyyyyyy.',
      '..yyyyy..',
      '..yyyyy..',
      '.yyd.dyy.',
      '.yd...dy.',
    ],
    pal: { y: '#ffcf3f', h: '#fff2a8', d: '#d99e1f' },
  },
  lightning: {
    rows: [
      '....yyy',
      '...yyy.',
      '..yyy..',
      '.yyyyyy',
      '...yyy.',
      '..yyy..',
      '.yyd...',
      '.yd....',
      'yd.....',
    ],
    pal: { y: '#ffd84d', d: '#e0a62e' },
  },
  chat: {
    rows: [
      '.wwwwwwww.',
      'wwwwwwwwww',
      'wwkwwkwwkw',
      'wwwwwwwwww',
      '.wwwwwwww.',
      '..ww......',
      '.w........',
    ],
    pal: { w: '#ffffff', k: '#5b6b85' },
  },
  box: {
    rows: [
      '.hhhtthhh.',
      'hhhhtthhhh',
      'ccccttcccc',
      'cccctttccd',
      'ccccccccdd',
      'cccllllccd',
      'ccccccccdd',
      '.ddddddddd',
    ],
    pal: { h: '#e2b47a', c: '#c99a5e', t: '#f1dfb6', l: '#8b6a43', d: '#a87b45' },
  },
  hourglass: {
    // Standing: almost all the sand on top, a strand falling and a little mound below.
    rows: [
      'tcccccccC',
      'CCCCCCCCC',
      '.wgggggG.',
      '.wsssssG.',
      '..wsssG..',
      '...gSG...',
      '..wgsgG..',
      '.wggsggG.',
      '.wgsssSG.',
      'tcccccccC',
      'CCCCCCCCC',
    ],
    pal: HOURGLASS_PAL,
  },
  hourglass_flip: {
    // The same hourglass lying down (half turn): the sand runs to the lower side of both bulbs.
    // Alternated with 'hourglass' (same anchor at the bottom centre) it looks like turning over the head.
    rows: [
      'tc.......tc',
      'tcw.....Gtc',
      'tcwg...gGtc',
      'tcggg.ggGtc',
      'tcsssSggGtc',
      'tcsss.ggGtc',
      'tcSs...sStc',
      'tcS.....Stc',
      'tc.......tc',
    ],
    pal: { ...HOURGLASS_PAL, t: '#d9a46c', c: '#a8723f' },
  },
  cobweb: {
    // Corner cobweb, triangular (the corner is top left; mirror it for other corners):
    // edge strands, the diagonal spoke and two quarter-circle arcs; a little spider with light eyes
    // on the outer edge. White strands with a translucent outline only on the silhouette (the cells
    // stay almost clean), legible on both the light floor and the dark upholstery.
    rows: [
      'wwwwwwwwwwww',
      'wf...w....w.',
      'w.f..w....w.',
      'w..fw.....w.',
      'w..wf....w..',
      'www..f...w..',
      'w.....f.w...',
      'w......w....',
      'w.....w.l.l.',
      'w...ww.lkKkl',
      'wwww....eke.',
      'w......l...l',
    ],
    pal: { w: '#ffffff', f: '#d3dbe5', k: '#3a3346', K: '#6f6287', e: '#fff7d6', l: '#55496a' },
    outlineAlpha: 0.6,
    holeOutlineAlpha: 0.14,
  },
  storm: {
    // Heavy cloud with rain and a yellow lightning bolt (something failed).
    rows: [
      '...hHHh....',
      '.hhHHHHhhh.',
      'hhHhhhhhhcc',
      'cccccccccdd',
      '.dddddddddd',
      '......yo..b',
      '.b...yo...B',
      '.B..yyyyo..',
      '......yo...',
      '.b...yo....',
      '.B...o.....',
    ],
    pal: { h: '#8d97ab', H: '#b3bccc', c: '#6b7489', d: '#4f566a', y: '#ffd84d', o: '#e3a530', b: '#9fd2f6', B: '#5a9fd8' },
  },
  wave: {
    rows: [
      '..s.s.s..',
      '..s.s.s.s',
      '..s.s.s.s',
      's.sssssss',
      'sssssssss',
      '.sssssssd',
      '..ssssssd',
      '...ssssd.',
    ],
    pal: { s: '#ffd2a8', d: '#e0a87a' },
  },
  coin: {
    // Golden coin from the front: light rim at top left, shadow at bottom right, an engraved "C"
    // in the middle and a sparkle.
    rows: [
      '..yyyy..',
      '.yhwyyy.',
      'yhyKKyyd',
      'yhKyyyyd',
      'yhKyyyyd',
      'yyyKKyyd',
      '.yyyyydd',
      '..dddd..',
    ],
    pal: { y: '#ffcf3f', h: '#fff2a8', w: '#ffffff', K: '#d4931c', d: '#c98a1c' },
  },
  sparkle: {
    // 4-point sparkle: white centre and thin, long arms.
    rows: [
      '....y....',
      '....y....',
      '...yhy...',
      '..yhwhy..',
      'yyhwwwhyy',
      '..yhwhy..',
      '...yhy...',
      '....y....',
      '....y....',
    ],
    pal: { y: '#ffe07a', h: '#fff6c8', w: '#ffffff' },
  },
  trophy: {
    // Golden cup with handles and a wooden pedestal.
    rows: [
      'yhhhyyyyd',
      'yhwhyyydy',
      'y.hhyyd.y',
      '.yhhyyd.y',
      '..hyyyd..',
      '...yyd...',
      '....y....',
      '..bbbbb..',
      '.BBBBBBB.',
    ],
    pal: { y: '#ffcf3f', h: '#fff2a8', w: '#ffffff', d: '#d99e1f', b: '#a8723f', B: '#7a4f2a' },
  },
  hand_rock: {
    // Closed fist from the front: three knuckles on top, creases between the fingers and the thumb
    // across the bottom (warmer tone).
    rows: [
      '.LL.LL.LL.',
      'LsskssksSS',
      'LsskssksSS',
      'LssssssssS',
      'LTTTTTsssS',
      '.TTTTTssS.',
      '..SSSSSS..',
    ],
    pal: { L: '#ffe0c4', s: '#f6c9a2', S: '#d99d72', k: '#c48660', T: '#ecb68b' },
  },
  hand_paper: {
    // Open hand: four fingers stretched and separated, thumb open to the side.
    rows: [
      '..L.L....',
      '.LsLsL...',
      '.LsLsLs..',
      '.LsLsLs..',
      'LLsssss..',
      'sLssssss.',
      '.sssssSS.',
      '..ssssS..',
      '..SSSS...',
    ],
    pal: { L: '#ffe0c4', s: '#f6c9a2', S: '#d99d72' },
  },
  hand_scissors: {
    // Index and middle fingers open in a V; the other fingers folded into the fist.
    rows: [
      '.L...L...',
      '.Ls..Ls..',
      '..Ls.Ls..',
      '..LsLs...',
      '.LLsssk..',
      '.LsksksS.',
      '.sssssSS.',
      '..SSSSS..',
    ],
    pal: { L: '#ffe0c4', s: '#f6c9a2', S: '#d99d72', k: '#c48660' },
  },
};

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** Icon with outline; anchor at the bottom centre. */
export function renderIcon(name: IconName): BufSprite {
  const def = ICONS[name];
  const w = Math.max(...def.rows.map((r) => r.length));
  const h = def.rows.length;
  const b = new PixelBuf(w + 2, h + 2);
  b.stamp(def.rows, 1, 1, def.pal);
  const soft = def.outlineAlpha !== undefined || def.holeOutlineAlpha !== undefined;
  const before = soft ? b.data.slice() : null;
  b.outline();
  if (before) {
    // Only the pixels created by the outline get the reduced opacity (even lower in the holes).
    const outer = alpha255(def.outlineAlpha ?? 1);
    const hole = alpha255(def.holeOutlineAlpha ?? def.outlineAlpha ?? 1);
    const outside = reachableFromBorder(before, b.w, b.h);
    for (let p = 0; p < b.w * b.h; p++) {
      const i = p * 4 + 3;
      if (before[i] === 0 && b.data[i] > 0) b.data[i] = outside[p] ? outer : hole;
    }
  }
  return { buf: b, ax: Math.floor((w + 2) / 2), ay: h + 2 };
}

function alpha255(a: number): number {
  return Math.round(Math.max(0, Math.min(1, a)) * 255);
}

/**
 * Transparent pixels reachable from the border walking only through transparent ones (4-neighbourhood).
 * The remaining transparent ones are "holes" surrounded by the drawing (diagonal lines also close them,
 * because the 4-neighbourhood does not cross a diagonal step).
 */
function reachableFromBorder(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p] || data[p * 4 + 3] !== 0) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return seen;
}

export function iconTemplates(): Readonly<Record<IconName, IconDef>> {
  return ICONS;
}
