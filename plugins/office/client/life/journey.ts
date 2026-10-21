// Port of habblaud client/src/world/sim/steps.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Also ports client/src/world/sim/elevator.ts (arrival stagger). Ported: the step vocabulary go, act, elevOut, elevIn as appear, walk, wait, vanish; stall, switch, gather and the closures stay out.
// Journeys (D-04, D-06, OFFC-12, OFFC-13): handoff walk to the parent and back, elevator arrival and departure, outings. Every builder returns fresh objects.
import type { Dir, Pose } from "../../shared/art-types.ts";
import type { AreaLayout } from "../../shared/layout/types.ts";
import type { TilePoint, WalkGrid } from "../../shared/path/grid.ts";
import { ELEVATOR_DOOR_MS, ELEVATOR_STAGGER_MS, HANDOFF_PAUSE_MS } from "../limits-life.ts";
import { walkPath } from "./walk.ts";
import type { WalkPlan } from "./walk.ts";

export type JourneyStep =
  | { kind: "appear"; tile: TilePoint; dir: Dir; ms: number }
  | { kind: "walk"; plan: WalkPlan; run: boolean }
  | { kind: "wait"; ms: number; pose: Pose; dir: Dir }
  | { kind: "vanish"; ms: number };

export interface Journey {
  steps: JourneyStep[];
  startTile: TilePoint;
  startDir: Dir;
  endTile: TilePoint;
  endDir: Dir;
  totalMs: number;
}

type Source = { readonly grid: WalkGrid };

const OPPOSITE: Readonly<Record<Dir, Dir>> = { up: "down", down: "up", left: "right", right: "left" };

const tileCopy = (tile: TilePoint): TilePoint => ({ x: tile.x, y: tile.y });

function stepMs(step: JourneyStep): number {
  return step.kind === "walk" ? step.plan.totalMs : step.ms;
}

function journeyOf(steps: JourneyStep[], startTile: TilePoint, startDir: Dir, endTile: TilePoint, endDir: Dir): Journey {
  return { steps, startTile: tileCopy(startTile), startDir, endTile: tileCopy(endTile), endDir, totalMs: steps.reduce((sum, s) => sum + stepMs(s), 0) };
}

// The same path walked the other way: segments in reverse order, each ending where the previous one began.
function reversePlan(plan: WalkPlan): WalkPlan {
  const ends = [plan.startPx, ...plan.segments.map((s) => ({ x: s.x, y: s.y }))];
  const segments = plan.segments
    .map((s, i) => ({ x: ends[i].x, y: ends[i].y, dir: OPPOSITE[s.dir], tiles: s.tiles, ms: s.ms }))
    .reverse();
  const finish = ends[ends.length - 1];
  return {
    from: tileCopy(plan.to),
    to: tileCopy(plan.from),
    startPx: { x: finish.x, y: finish.y },
    segments,
    tiles: plan.tiles,
    totalMs: plan.totalMs,
    lastDir: segments.length > 0 ? segments[segments.length - 1].dir : null,
  };
}

export interface RoundTripOpts {
  wait: { ms: number; pose: Pose; dir?: Dir };
  homeDir: Dir;
  run?: boolean;
}

// Walk to the target, wait, walk back along the same path; a target equal to home gives the wait alone, null when the target is unreachable.
export function roundTripJourney(source: Source, home: TilePoint, target: TilePoint, opts: RoundTripOpts): Journey | null {
  const out = walkPath(source, home, target, { run: opts.run });
  if (out === null) return null;
  const run = opts.run === true;
  if (out.segments.length === 0) {
    const wait: JourneyStep = { kind: "wait", ms: opts.wait.ms, pose: opts.wait.pose, dir: opts.wait.dir ?? opts.homeDir };
    return journeyOf([wait], home, opts.homeDir, home, opts.homeDir);
  }
  const wait: JourneyStep = { kind: "wait", ms: opts.wait.ms, pose: opts.wait.pose, dir: opts.wait.dir ?? out.lastDir ?? opts.homeDir };
  const back = reversePlan(out);
  return journeyOf([{ kind: "walk", plan: out, run }, wait, { kind: "walk", plan: back, run }], home, opts.homeDir, home, opts.homeDir);
}

export interface HandoffOpts {
  homeDir: Dir;
  run?: boolean;
}

// A child walks to its parent's tile, pauses and walks back; a missing or unreachable parent gives null, so the child does not walk (D-04).
export function handoffJourney(source: Source, childTile: TilePoint, parentTile: TilePoint | null, opts: HandoffOpts): Journey | null {
  if (parentTile === null) return null;
  return roundTripJourney(source, childTile, parentTile, { wait: { ms: HANDOFF_PAUSE_MS, pose: "stand" }, homeDir: opts.homeDir, run: opts.run });
}

// Approach tiles of the reception's elevator spots, in group order elevator:0 then elevator:1.
export function elevatorFronts(building: { readonly areas: readonly AreaLayout[]; readonly grid: WalkGrid }): TilePoint[] {
  const reception = building.areas.find((area) => area.kind === "reception");
  if (!reception) return [];
  return reception.spots
    .filter((spot) => spot.kind === "elevator" && building.grid.walkable(spot.tx, spot.ty))
    .sort((a, b) => ((a.group ?? "") < (b.group ?? "") ? -1 : (a.group ?? "") > (b.group ?? "") ? 1 : 0))
    .map((spot) => ({ x: spot.tx, y: spot.ty }));
}

export interface ArrivalOpts {
  destDir: Dir;
  run?: boolean;
}

// Appears at an elevator front tile (the door opens) and walks to the destination; null when the destination is unreachable.
export function arrivalJourney(source: Source, front: TilePoint, dest: TilePoint, opts: ArrivalOpts): Journey | null {
  const plan = walkPath(source, front, dest, { run: opts.run });
  if (plan === null) return null;
  const steps: JourneyStep[] = [{ kind: "appear", tile: tileCopy(front), dir: "down", ms: ELEVATOR_DOOR_MS }];
  if (plan.segments.length > 0) steps.push({ kind: "walk", plan, run: opts.run === true });
  return journeyOf(steps, front, "down", dest, opts.destDir);
}

export interface DepartureOpts {
  fromDir?: Dir;
  run?: boolean;
}

// Walks to an elevator front tile and vanishes into it; null when the front is unreachable.
export function departureJourney(source: Source, from: TilePoint, front: TilePoint, opts: DepartureOpts = {}): Journey | null {
  const plan = walkPath(source, from, front, { run: opts.run });
  if (plan === null) return null;
  const steps: JourneyStep[] = [];
  if (plan.segments.length > 0) steps.push({ kind: "walk", plan, run: opts.run === true });
  steps.push({ kind: "vanish", ms: ELEVATOR_DOOR_MS });
  return journeyOf(steps, from, opts.fromDir ?? "down", front, "up");
}

export interface ElevatorSchedule {
  // Picks the elevator that frees first (lowest index on a tie) and the time the arrival may appear.
  reserve(now: number): { index: number; at: number };
}

// Staggers simultaneous arrivals across the elevators; a factory because client code may not declare classes.
export function ElevatorSchedule(count: number): ElevatorSchedule {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("elevator count");
  const free: number[] = Array.from({ length: count }, () => 0);
  return {
    reserve(now) {
      if (!Number.isFinite(now)) throw new RangeError("now");
      let index = 0;
      for (let i = 1; i < count; i++) if (free[i] < free[index]) index = i;
      const at = Math.max(now, free[index]);
      free[index] = at + ELEVATOR_STAGGER_MS;
      return { index, at };
    },
  };
}
