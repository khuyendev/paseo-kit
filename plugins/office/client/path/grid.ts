// Port of habblaud client/src/world/path/grid.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Additions (D-09: pure data, no host): MAX_GRID_CELLS cap, TilePoint, gridFromRows and gridOf; the constructor validates the size.
// Walk grid of the building, one cell per tile: 0 = blocked, 1 = free, 2 = free but avoided (seats: A* crosses them only when it must).

export const BLOCKED = 0;
export const FREE = 1;
export const SEAT = 2;

/** Largest grid the constructor accepts; keeps a caller-sized building from allocating without bound. */
export const MAX_GRID_CELLS = 250000;

export interface TilePoint {
  x: number;
  y: number;
}

export class WalkGrid {
  readonly w: number;
  readonly h: number;
  readonly version: number;
  readonly cells: Uint8Array;

  constructor(w: number, h: number, version = 0) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > MAX_GRID_CELLS) {
      throw new RangeError(`walk grid size ${w}x${h} must be positive integers within ${MAX_GRID_CELLS} cells`);
    }
    this.w = w;
    this.h = h;
    this.version = version;
    this.cells = new Uint8Array(w * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.cells[y * this.w + x] : BLOCKED;
  }

  set(x: number, y: number, v: number): void {
    if (this.inside(x, y)) this.cells[y * this.w + x] = v;
  }

  walkable(x: number, y: number): boolean {
    return this.get(x, y) !== BLOCKED;
  }

  fill(x: number, y: number, w: number, h: number, v: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, v);
  }

  /** Closest walkable tile (ring search), or null. */
  nearestWalkable(x: number, y: number, maxR = 12): TilePoint | null {
    if (this.walkable(x, y)) return { x, y };
    for (let r = 1; r <= maxR; r++) {
      let best: TilePoint | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.walkable(x + dx, y + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x: x + dx, y: y + dy };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** BFS: the cells (as a 0/1 mask) reachable from (x, y) over 4-connected walkable cells. */
  reachableFrom(x: number, y: number): Uint8Array {
    const seen = new Uint8Array(this.w * this.h);
    if (!this.walkable(x, y)) return seen;
    const queue = new Int32Array(this.w * this.h);
    let head = 0;
    let tail = 0;
    queue[tail++] = y * this.w + x;
    seen[y * this.w + x] = 1;
    while (head < tail) {
      const i = queue[head++];
      const cx = i % this.w;
      const cy = (i - cx) / this.w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!this.walkable(nx, ny)) continue;
        const j = ny * this.w + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    return seen;
  }
}

/** Grid from text rows for fixtures: '#' blocked, '.' free, 's' seat. */
export function gridFromRows(rows: readonly string[], version = 0): WalkGrid {
  const w = rows.length > 0 ? rows[0].length : 0;
  const grid = new WalkGrid(w, rows.length, version);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new RangeError(`grid row ${y} has ${row.length} cells, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === "#") grid.set(x, y, BLOCKED);
      else if (ch === ".") grid.set(x, y, FREE);
      else if (ch === "s") grid.set(x, y, SEAT);
      else throw new RangeError(`grid row ${y} has the unknown cell ${JSON.stringify(ch)}`);
    }
  });
  return grid;
}

/** The walk grid of any object that carries one (a building layout), typed structurally so path never imports layout. */
export function gridOf(source: { readonly grid: WalkGrid }): WalkGrid {
  return source.grid;
}
