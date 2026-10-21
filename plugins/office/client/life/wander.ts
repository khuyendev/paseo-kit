// Port of habblaud client/src/world/sim/behavior.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Ported: the weights of the idle activities that have a spot in the lobby, kitchen, lounge or hallway, the weighted pick, the sit time; the per-activity stay comes from sim/sim.ts planOuting. Character-profile parts, restroom, mirror and stretch stay out.
// Pure decisions (OFFC-13, D-06): the caller owns rng, ledger and reservations; nothing here reserves a spot.
import type { Dir, Pose } from "../../shared/art-types.ts";
import type { AreaKind, SpotDef, SpotKind } from "../../shared/layout/types.ts";
import type { TilePoint } from "../../shared/path/grid.ts";
import { WANDER_NEAREST_CHOICES, WANDER_SIT_MS_MAX, WANDER_SIT_MS_MIN, WANDER_STAY_MS_MAX, WANDER_STAY_MS_MIN } from "../limits-life.ts";
import type { SpotIndex, SpotLedger } from "./ledger.ts";

export type IdleActivity = "coffee" | "water" | "lounge" | "window" | "shelf" | "arcade" | "snack" | "phone";

export const IDLE_WEIGHTS: Readonly<Record<IdleActivity, number>> = {
  coffee: 18,
  water: 12,
  lounge: 12,
  window: 7,
  shelf: 6,
  arcade: 5,
  snack: 5,
  phone: 6,
};

export interface WanderChoice {
  activity: IdleActivity;
  spotId: string;
  tile: TilePoint;
  dir: Dir;
  pose: Pose;
  stayMs: number;
}

// Area kinds an outing may use (OFFC-13): reception is the lobby, cafe the kitchen.
const ELIGIBLE_AREAS: ReadonlySet<AreaKind> = new Set<AreaKind>(["reception", "cafe", "lounge", "corridor"]);

interface ActivityRule {
  kinds: ReadonlySet<SpotKind>;
  pose: Pose;
  stay: readonly [number, number];
}

const clampStay = (ms: number): number => Math.min(Math.max(ms, WANDER_STAY_MS_MIN), WANDER_STAY_MS_MAX);
const inBounds = (lo: number, hi: number): readonly [number, number] => [clampStay(lo), clampStay(hi)];

// Spot kinds and poses follow planOuting; stays are the upstream act durations clamped into the stay bounds.
const RULES: Readonly<Record<IdleActivity, ActivityRule>> = {
  coffee: { kinds: new Set<SpotKind>(["coffee"]), pose: "drink", stay: inBounds(1900 + 2600, 1900 + 2600) },
  water: { kinds: new Set<SpotKind>(["water"]), pose: "drink", stay: inBounds(1000 + 2500, 1000 + 2500) },
  lounge: { kinds: new Set<SpotKind>(["sofa", "armchair", "beanbag"]), pose: "sit", stay: inBounds(9000, 22000) },
  window: { kinds: new Set<SpotKind>(["window"]), pose: "stand", stay: inBounds(5000, 10000) },
  shelf: { kinds: new Set<SpotKind>(["shelf"]), pose: "read", stay: inBounds(5000, 9000) },
  arcade: { kinds: new Set<SpotKind>(["arcade"]), pose: "use", stay: inBounds(6000, 12000) },
  snack: { kinds: new Set<SpotKind>(["snack", "fridge"]), pose: "use", stay: inBounds(1600 + 900, 1600 + 900) },
  phone: { kinds: new Set<SpotKind>(["beanbag", "sofa", "armchair", "cafe_seat", "bench"]), pose: "read", stay: inBounds(8000, 18000) },
};

const ACTIVITIES = Object.keys(IDLE_WEIGHTS) as IdleActivity[];

export interface WanderInput {
  index: SpotIndex;
  ledger: SpotLedger;
  rng: () => number;
  // The walker: it may take a spot it already holds.
  by?: string;
  // Where the walker stands; spots nearer to it come first.
  from?: TilePoint;
}

// Picks an activity by weight among those with a free spot, then a spot among the nearest ones; null when nothing is free.
export function pickWander(input: WanderInput): WanderChoice | null {
  const { index, ledger, rng, by, from } = input;
  const free = index.spots.filter((spot) => {
    const kind = index.areaKindOf(spot.id);
    return kind !== undefined && ELIGIBLE_AREAS.has(kind) && ledger.isFree(spot.id, by);
  });
  const candidates = new Map<IdleActivity, SpotDef[]>();
  let total = 0;
  for (const activity of ACTIVITIES) {
    const list = free.filter((spot) => RULES[activity].kinds.has(spot.kind));
    if (list.length === 0) continue;
    candidates.set(activity, list);
    total += IDLE_WEIGHTS[activity];
  }
  if (total <= 0) return null;
  let r = rng() * total;
  let activity: IdleActivity | null = null;
  for (const name of ACTIVITIES) {
    if (!candidates.has(name)) continue;
    r -= IDLE_WEIGHTS[name];
    if (r < 0) {
      activity = name;
      break;
    }
  }
  if (activity === null) return null;
  const near = (spot: SpotDef): number => (from ? Math.abs(spot.tx - from.x) + Math.abs(spot.ty - from.y) : 0);
  const sorted = [...candidates.get(activity)!].sort((a, b) => near(a) - near(b));
  const spot = sorted[Math.floor(rng() * Math.min(WANDER_NEAREST_CHOICES, sorted.length))];
  const [lo, hi] = RULES[activity].stay;
  return { activity, spotId: spot.id, tile: { x: spot.tx, y: spot.ty }, dir: spot.dir, pose: RULES[activity].pose, stayMs: Math.floor(lo + rng() * (hi - lo)) };
}

// Seed for mulberry32: 32-bit FNV-1a over the UTF-16 code units of the id, then the round added with a fixed step.
export function wanderSeed(agentId: string, round: number): number {
  if (!Number.isInteger(round) || round < 0) throw new RangeError("round");
  let h = 0x811c9dc5;
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h + Math.imul(round, 0x9e3779b9)) >>> 0;
}

// Time an idle agent sits at its desk before the next outing.
export function idleSitMs(rng: () => number): number {
  return WANDER_SIT_MS_MIN + rng() * (WANDER_SIT_MS_MAX - WANDER_SIT_MS_MIN);
}
