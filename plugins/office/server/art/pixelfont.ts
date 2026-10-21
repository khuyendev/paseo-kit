// Port of habblaud client/src/art/pixelfont.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt).
// Whole file; pixelText writes into a PixelBuf instead of a canvas context.
import type { PixelBuf } from './core/pixbuf.ts';

// 3 by 5 glyphs, 15 characters of 0 and 1 each (row by row).
const GLYPHS: Readonly<Record<string, string>> = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111',
  f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010',
  k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010',
  p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010',
  z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', '_': '000000000000111', '-': '000000111000000', '#': '101111101111101', '.': '000000000000010',
  '(': '010100100100010', ')': '010001001001010', '/': '001001010100100', ' ': '000000000000000', ':': '000010000010000',
  ',': '000000000010100', '×': '000101010101000', '—': '000000111000000', '>': '100010001010100', '<': '001010100010001',
  '+': '000010111010000',
};

// Diacritic marks: rows of 3 columns and the vertical offset of the first row (accents sit 2 rows above the glyph, the cedilla 2 rows below).
const MARKS = {
  acute: { dy: -3, rows: ['001', '010'] },
  grave: { dy: -3, rows: ['100', '010'] },
  circ: { dy: -3, rows: ['010', '101'] },
  tilde: { dy: -3, rows: ['011', '110'] },
  cedilla: { dy: 5, rows: ['010', '110'] },
} as const;

// Name of a diacritic mark.
type Mark = keyof typeof MARKS;

// Accented letter to its base letter and mark.
const DIACRITIC: Readonly<Record<string, readonly [string, Mark]>> = {
  á: ['a', 'acute'], à: ['a', 'grave'], â: ['a', 'circ'], ã: ['a', 'tilde'],
  é: ['e', 'acute'], ê: ['e', 'circ'], í: ['i', 'acute'],
  ó: ['o', 'acute'], ô: ['o', 'circ'], õ: ['o', 'tilde'], ú: ['u', 'acute'], ç: ['c', 'cedilla'],
};

// Width in px of a text drawn by pixelText (3 px per letter plus 1 px of space).
export function pixelTextWidth(text: string): number {
  return Math.max(0, [...text].length * 4 - 1);
}

// Draws lower-case text (3 by 5 per letter, 1 px of space, accents and cedilla) and returns the advance in px.
export function pixelText(buf: PixelBuf, text: string, x: number, y: number, color: string): number {
  let cx = x;
  for (const raw of text.toLowerCase()) {
    const dia = DIACRITIC[raw];
    const ch = dia ? dia[0] : raw;
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') buf.set(cx + (i % 3), y + Math.floor(i / 3), color);
    if (dia) {
      const m = MARKS[dia[1]];
      m.rows.forEach((row, r) => {
        for (let c = 0; c < 3; c++) if (row[c] === '1') buf.set(cx + c, y + m.dy + r, color);
      });
    }
    cx += 4;
  }
  return cx - x;
}
