// No upstream: written for plan 07-08.
// Walk planner (D-04, OFFC-12): turns the tile steps of findPath into straight timed runs between foot pixels. Reads the grid only (D-09).
import type { Dir } from "../../shared/art-types.ts";
import { RUN_SPEED, TILE, WALK_SPEED } from "../../shared/layout/constants.ts";
import { findPath } from "../../shared/path/astar.ts";
import { gridOf } from "../../shared/path/grid.ts";
import type { TilePoint, WalkGrid } from "../../shared/path/grid.ts";
import { WALK_PLAN_MAX_SEGMENTS } from "../limits-life.ts";
import { footPx } from "./frames.ts";

// One straight run: end foot pixel, direction, tiles walked and whole milliseconds.
export interface WalkSegment {
  x: number;
  y: number;
  dir: Dir;
  tiles: number;
  ms: number;
}

export interface WalkPlan {
  from: TilePoint;
  to: TilePoint;
  startPx: { x: number; y: number };
  segments: WalkSegment[];
  tiles: number;
  totalMs: number;
  lastDir: Dir | null;
}

export interface WalkOpts {
  run?: boolean;
}

// Speeds are world pixels per second, so a tile takes TILE / speed seconds; rounded to whole milliseconds once.
const stepMs = (speed: number): number => Math.round((TILE * 1000) / speed);

function checkTile(tile: TilePoint): void {
  if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || tile.x < 0 || tile.y < 0) throw new RangeError("tile");
}

function dirOfStep(dx: number, dy: number): Dir {
  if (dy === 0 && dx > 0) return "right";
  if (dy === 0 && dx < 0) return "left";
  if (dx === 0 && dy > 0) return "down";
  if (dx === 0 && dy < 0) return "up";
  throw new RangeError("step");
}

// Plan from one tile to another over the building grid; null when blocked, outside, disconnected or too long.
export function walkPath(source: { readonly grid: WalkGrid }, from: TilePoint, to: TilePoint, opts: WalkOpts = {}): WalkPlan | null {
  checkTile(from);
  checkTile(to);
  const steps = findPath(gridOf(source), from, to);
  if (steps === null) return null;
  const perTile = stepMs(opts.run ? RUN_SPEED : WALK_SPEED);
  const runs: { dir: Dir; tiles: number; end: TilePoint }[] = [];
  let prev = from;
  for (const step of steps) {
    const dir = dirOfStep(step.x - prev.x, step.y - prev.y);
    const last = runs[runs.length - 1];
    if (last && last.dir === dir) {
      last.tiles++;
      last.end = step;
    } else {
      runs.push({ dir, tiles: 1, end: step });
    }
    prev = step;
  }
  if (runs.length > WALK_PLAN_MAX_SEGMENTS) return null;
  const segments: WalkSegment[] = runs.map((run) => ({ ...footPx(run.end), dir: run.dir, tiles: run.tiles, ms: run.tiles * perTile }));
  return {
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    startPx: footPx(from),
    segments,
    tiles: steps.length,
    totalMs: segments.reduce((sum, s) => sum + s.ms, 0),
    lastDir: runs.length > 0 ? runs[runs.length - 1].dir : null,
  };
}
