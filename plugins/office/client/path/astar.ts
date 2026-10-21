// Port of habblaud client/src/world/path/astar.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Addition (OFFC-12): findPath(grid, from, to) with one PathFinder per grid as scratch space; the search itself is unchanged.
// The upstream class is a factory here: the phone app's Hermes cannot compile class syntax in plugin client code.
// 4-direction A* over the WalkGrid. Buffers are reused between searches (no allocation per call except the caller's output array).
// Turns cost extra so routes are natural L shapes instead of staircases.
import { BLOCKED, SEAT } from "./grid.ts";
import type { TilePoint, WalkGrid } from "./grid.ts";

const SEAT_COST = 6;
const TURN_COST = 0.35;
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

export interface PathFinder {
  setGrid(grid: WalkGrid): void;
  /**
   * Path from (sx, sy) to (gx, gy). Fills `out` with pairs [x0, y0, x1, y1, ...] WITHOUT the start
   * and WITH the goal. The start may be blocked (a character on a seat). Returns false when there is no path.
   */
  find(sx: number, sy: number, gx: number, gy: number, out: number[]): boolean;
}

export function createPathFinder(initial: WalkGrid): PathFinder {
  let g = new Float32Array(0);
  let f = new Float32Array(0);
  let from = new Int32Array(0);
  let dirIn = new Int8Array(0);
  let stamp = new Uint32Array(0);
  let closed = new Uint32Array(0);
  let heap = new Int32Array(0);
  let heapKey = new Float32Array(0);
  let heapSize = 0;
  let gen = 0;
  let grid = initial;

  function setGrid(next: WalkGrid): void {
    const n = next.w * next.h;
    if (g.length !== n) {
      g = new Float32Array(n);
      f = new Float32Array(n);
      from = new Int32Array(n);
      dirIn = new Int8Array(n);
      stamp = new Uint32Array(n);
      closed = new Uint32Array(n);
      heap = new Int32Array(n * 4 + 8);
      heapKey = new Float32Array(n * 4 + 8);
      gen = 0;
    }
    grid = next;
  }

  function find(sx: number, sy: number, gx: number, gy: number, out: number[]): boolean {
    out.length = 0;
    if (!grid.inside(sx, sy) || !grid.walkable(gx, gy)) return false;
    if (sx === gx && sy === gy) return true;
    const w = grid.w;
    const cells = grid.cells;
    if (++gen >= 0xffffffff) {
      stamp.fill(0);
      closed.fill(0);
      gen = 1;
    }
    const now = gen;
    const start = sy * w + sx;
    const goal = gy * w + gx;
    heapSize = 0;
    stamp[start] = now;
    g[start] = 0;
    f[start] = Math.abs(sx - gx) + Math.abs(sy - gy);
    from[start] = -1;
    dirIn[start] = -1;
    push(start);

    while (heapSize > 0) {
      const cur = pop();
      if (cur === goal) {
        reconstruct(goal, start, w, out);
        return true;
      }
      if (closed[cur] === now) continue;
      closed[cur] = now;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const gCur = g[cur];
      const dIn = dirIn[cur];
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= grid.h) continue;
        const ni = ny * w + nx;
        const cell = cells[ni];
        if (cell === BLOCKED) continue;
        if (closed[ni] === now) continue;
        let cost = cell === SEAT && ni !== goal ? SEAT_COST : 1;
        if (dIn >= 0 && dIn !== k) cost += TURN_COST;
        const ng = gCur + cost;
        if (stamp[ni] === now && ng >= g[ni]) continue;
        stamp[ni] = now;
        g[ni] = ng;
        // slight tie-break in favour of nodes closer to the goal
        const h = Math.abs(nx - gx) + Math.abs(ny - gy);
        f[ni] = ng + h * 1.001;
        from[ni] = cur;
        dirIn[ni] = k;
        push(ni);
      }
    }
    return false;
  }

  function reconstruct(goal: number, start: number, w: number, out: number[]): void {
    let n = 0;
    for (let i = goal; i !== start && i >= 0; i = from[i]) n++;
    out.length = n * 2;
    let k = n - 1;
    for (let i = goal; i !== start && i >= 0; i = from[i]) {
      const x = i % w;
      out[k * 2] = x;
      out[k * 2 + 1] = (i - x) / w;
      k--;
    }
  }

  function push(i: number): void {
    if (heapSize >= heap.length) {
      // should not happen (each node enters a few times); grow for safety
      const bi = new Int32Array(heap.length * 2);
      bi.set(heap);
      heap = bi;
      const bk = new Float32Array(heapKey.length * 2);
      bk.set(heapKey);
      heapKey = bk;
    }
    const hp = heap;
    const key = heapKey;
    const k = f[i];
    let pos = heapSize++;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (key[parent] <= k) break;
      hp[pos] = hp[parent];
      key[pos] = key[parent];
      pos = parent;
    }
    hp[pos] = i;
    key[pos] = k;
  }

  function pop(): number {
    const hp = heap;
    const key = heapKey;
    const top = hp[0];
    const size = --heapSize;
    const last = hp[size];
    const lastK = key[size];
    let pos = 0;
    while (true) {
      const l = pos * 2 + 1;
      if (l >= size) break;
      const r = l + 1;
      const c = r < size && key[r] < key[l] ? r : l;
      if (key[c] >= lastK) break;
      hp[pos] = hp[c];
      key[pos] = key[c];
      pos = c;
    }
    hp[pos] = last;
    key[pos] = lastK;
    return top;
  }

  setGrid(initial);
  return { setGrid, find };
}

const finders = new WeakMap<WalkGrid, PathFinder>();

/** Tile steps from `from` to `to` without the start and with the goal; [] for the same walkable tile, null when blocked, outside or unreachable. */
export function findPath(grid: WalkGrid, from: TilePoint, to: TilePoint): TilePoint[] | null {
  if (![from.x, from.y, to.x, to.y].every(Number.isInteger)) return null;
  let finder = finders.get(grid);
  if (!finder) {
    finder = createPathFinder(grid);
    finders.set(grid, finder);
  }
  const out: number[] = [];
  if (!finder.find(from.x, from.y, to.x, to.y, out)) return null;
  const steps: TilePoint[] = [];
  for (let i = 0; i < out.length; i += 2) steps.push({ x: out[i], y: out[i + 1] });
  return steps;
}
