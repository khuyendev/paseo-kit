// Port of habblaud client/src/world/path/astar.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Addition (OFFC-12): findPath(grid, from, to) with one PathFinder per grid as scratch space; the search itself is unchanged.
// 4-direction A* over the WalkGrid. Buffers are reused between searches (no allocation per call except the caller's output array).
// Turns cost extra so routes are natural L shapes instead of staircases.
import { BLOCKED, SEAT } from "./grid.ts";
import type { TilePoint, WalkGrid } from "./grid.ts";

const SEAT_COST = 6;
const TURN_COST = 0.35;
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

export class PathFinder {
  private g!: Float32Array;
  private f!: Float32Array;
  private from!: Int32Array;
  private dirIn!: Int8Array;
  private stamp!: Uint32Array;
  private closed!: Uint32Array;
  private heap!: Int32Array;
  private heapKey!: Float32Array;
  private heapSize = 0;
  private gen = 0;
  private grid!: WalkGrid;

  constructor(grid: WalkGrid) {
    this.setGrid(grid);
  }

  setGrid(grid: WalkGrid): void {
    const n = grid.w * grid.h;
    if (!this.g || this.g.length !== n) {
      this.g = new Float32Array(n);
      this.f = new Float32Array(n);
      this.from = new Int32Array(n);
      this.dirIn = new Int8Array(n);
      this.stamp = new Uint32Array(n);
      this.closed = new Uint32Array(n);
      this.heap = new Int32Array(n * 4 + 8);
      this.heapKey = new Float32Array(n * 4 + 8);
      this.gen = 0;
    }
    this.grid = grid;
  }

  /**
   * Path from (sx, sy) to (gx, gy). Fills `out` with pairs [x0, y0, x1, y1, ...] WITHOUT the start
   * and WITH the goal. The start may be blocked (a character on a seat). Returns false when there is no path.
   */
  find(sx: number, sy: number, gx: number, gy: number, out: number[]): boolean {
    out.length = 0;
    const grid = this.grid;
    if (!grid.inside(sx, sy) || !grid.walkable(gx, gy)) return false;
    if (sx === gx && sy === gy) return true;
    const w = grid.w;
    const cells = grid.cells;
    if (++this.gen >= 0xffffffff) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const start = sy * w + sx;
    const goal = gy * w + gx;
    this.heapSize = 0;
    this.stamp[start] = gen;
    this.g[start] = 0;
    this.f[start] = Math.abs(sx - gx) + Math.abs(sy - gy);
    this.from[start] = -1;
    this.dirIn[start] = -1;
    this.push(start);

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (cur === goal) {
        this.reconstruct(goal, start, w, out);
        return true;
      }
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const gCur = this.g[cur];
      const dIn = this.dirIn[cur];
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= grid.h) continue;
        const ni = ny * w + nx;
        const cell = cells[ni];
        if (cell === BLOCKED) continue;
        if (this.closed[ni] === gen) continue;
        let cost = cell === SEAT && ni !== goal ? SEAT_COST : 1;
        if (dIn >= 0 && dIn !== k) cost += TURN_COST;
        const ng = gCur + cost;
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        // slight tie-break in favour of nodes closer to the goal
        const h = Math.abs(nx - gx) + Math.abs(ny - gy);
        this.f[ni] = ng + h * 1.001;
        this.from[ni] = cur;
        this.dirIn[ni] = k;
        this.push(ni);
      }
    }
    return false;
  }

  private reconstruct(goal: number, start: number, w: number, out: number[]): void {
    let n = 0;
    for (let i = goal; i !== start && i >= 0; i = this.from[i]) n++;
    out.length = n * 2;
    let k = n - 1;
    for (let i = goal; i !== start && i >= 0; i = this.from[i]) {
      const x = i % w;
      out[k * 2] = x;
      out[k * 2 + 1] = (i - x) / w;
      k--;
    }
  }

  private push(i: number): void {
    if (this.heapSize >= this.heap.length) {
      // should not happen (each node enters a few times); grow for safety
      const bi = new Int32Array(this.heap.length * 2);
      bi.set(this.heap);
      this.heap = bi;
      const bk = new Float32Array(this.heapKey.length * 2);
      bk.set(this.heapKey);
      this.heapKey = bk;
    }
    const heap = this.heap;
    const key = this.heapKey;
    const k = this.f[i];
    let pos = this.heapSize++;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (key[parent] <= k) break;
      heap[pos] = heap[parent];
      key[pos] = key[parent];
      pos = parent;
    }
    heap[pos] = i;
    key[pos] = k;
  }

  private pop(): number {
    const heap = this.heap;
    const key = this.heapKey;
    const top = heap[0];
    const size = --this.heapSize;
    const last = heap[size];
    const lastK = key[size];
    let pos = 0;
    while (true) {
      const l = pos * 2 + 1;
      if (l >= size) break;
      const r = l + 1;
      const c = r < size && key[r] < key[l] ? r : l;
      if (key[c] >= lastK) break;
      heap[pos] = heap[c];
      key[pos] = key[c];
      pos = c;
    }
    heap[pos] = last;
    key[pos] = lastK;
    return top;
  }
}

const finders = new WeakMap<WalkGrid, PathFinder>();

/** Tile steps from `from` to `to` without the start and with the goal; [] for the same walkable tile, null when blocked, outside or unreachable. */
export function findPath(grid: WalkGrid, from: TilePoint, to: TilePoint): TilePoint[] | null {
  if (![from.x, from.y, to.x, to.y].every(Number.isInteger)) return null;
  let finder = finders.get(grid);
  if (!finder) {
    finder = new PathFinder(grid);
    finders.set(grid, finder);
  }
  const out: number[] = [];
  if (!finder.find(from.x, from.y, to.x, to.y, out)) return null;
  const steps: TilePoint[] = [];
  for (let i = 0; i < out.length; i += 2) steps.push({ x: out[i], y: out[i + 1] });
  return steps;
}
