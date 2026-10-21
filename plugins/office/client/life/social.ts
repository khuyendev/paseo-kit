// Port of habblaud client/src/world/social/gathering.ts @ faa1a012b5fbf632c66dc6801c5383e53a542406 (MIT; notice in LICENSES/habblaud-MIT.txt, added by plan 07-05).
// Also ports client/src/world/social/social.ts (spot groups and base poses). Ported: min, max and trait-free base weight of the kept kinds, whole-group rule, base pose; labels, emoji, money, rps gestures and chat lines stay out.
// Pure decisions (OFFC-13, D-06): which idle agents meet at which spot group; the caller owns rng and ledger and reserves through reserveHangout.
import type { Dir, Pose } from "../../shared/art-types.ts";
import type { AreaKind, SpotDef, SpotKind } from "../../shared/layout/types.ts";
import type { TilePoint } from "../../shared/path/grid.ts";
import type { SpotIndex, SpotLedger } from "./ledger.ts";

export type HangoutKind = "pingpong" | "kitchen" | "talk" | "rps";

interface KindRule {
  min: number;
  max: number;
  solo: boolean;
  weight: number;
  // Spot kind and area kinds whose groups serve the kind.
  spotKind: SpotKind;
  areas: readonly AreaKind[];
  // Pose of each member in turn.
  poses: readonly Pose[];
}

const COMMON_AREAS: readonly AreaKind[] = ["reception", "cafe", "lounge", "corridor"];

export const HANGOUT_KINDS: Readonly<Record<HangoutKind, KindRule>> = {
  pingpong: { min: 2, max: 4, solo: false, weight: 9, spotKind: "pingpong", areas: ["lounge"], poses: ["play"] },
  kitchen: { min: 2, max: 4, solo: false, weight: 12, spotKind: "talk", areas: ["cafe"], poses: ["stand"] },
  talk: { min: 2, max: 2, solo: false, weight: 8, spotKind: "talk", areas: COMMON_AREAS, poses: ["talk"] },
  rps: { min: 2, max: 4, solo: false, weight: 8, spotKind: "talk", areas: COMMON_AREAS, poses: ["rps"] },
};

const KINDS = Object.keys(HANGOUT_KINDS) as HangoutKind[];

export interface HangoutMember {
  agentId: string;
  spotId: string;
  tile: TilePoint;
  dir: Dir;
  pose: Pose;
}

export interface Hangout {
  kind: HangoutKind;
  group: string;
  members: HangoutMember[];
}

export interface HangoutInput {
  index: SpotIndex;
  ledger: SpotLedger;
  idle: readonly { id: string; tile: TilePoint }[];
  rng: () => number;
}

const manhattan = (a: TilePoint, b: { tx: number; ty: number }): number => Math.abs(a.x - b.tx) + Math.abs(a.y - b.ty);

// Groups (in index order) of one kind whose spots are all of the spot kind, sit in an allowed area, number at least the minimum and are all free.
function freeGroups(kind: HangoutKind, input: HangoutInput, candidates: number): SpotDef[][] {
  const rule = HANGOUT_KINDS[kind];
  if (candidates < rule.min) return [];
  const seen = new Set<string>();
  const groups: SpotDef[][] = [];
  for (const spot of input.index.spots) {
    if (spot.group === undefined || seen.has(spot.group)) continue;
    seen.add(spot.group);
    const members = input.index.group(spot.group);
    if (members.length < rule.min) continue;
    const fits = members.every((m) => {
      const area = input.index.areaKindOf(m.id);
      return m.kind === rule.spotKind && area !== undefined && rule.areas.includes(area);
    });
    if (fits && members.every((m) => input.ledger.isFree(m.id))) groups.push([...members]);
  }
  return groups;
}

// Picks a kind by weight among those with a whole free group, then a group, then the idle agents nearest to it; null when no group fits.
export function pickHangout(input: HangoutInput): Hangout | null {
  const seenIds = new Set<string>();
  const idle = input.idle.filter((agent) => {
    if (seenIds.has(agent.id)) return false;
    seenIds.add(agent.id);
    return true;
  });
  const available = new Map<HangoutKind, SpotDef[][]>();
  let total = 0;
  for (const kind of KINDS) {
    const groups = freeGroups(kind, input, idle.length);
    if (groups.length === 0) continue;
    available.set(kind, groups);
    total += HANGOUT_KINDS[kind].weight;
  }
  if (total <= 0) return null;
  let r = input.rng() * total;
  let kind: HangoutKind | null = null;
  for (const name of KINDS) {
    if (!available.has(name)) continue;
    r -= HANGOUT_KINDS[name].weight;
    if (r < 0) {
      kind = name;
      break;
    }
  }
  if (kind === null) return null;
  const groups = available.get(kind)!;
  const group = groups[Math.floor(input.rng() * groups.length)];
  const rule = HANGOUT_KINDS[kind];
  const count = Math.min(rule.max, group.length, idle.length);
  const anchor = { tx: group[0].tx, ty: group[0].ty };
  const ordered = [...idle].sort((a, b) => manhattan(a.tile, anchor) - manhattan(b.tile, anchor) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const left = [...group];
  const members: HangoutMember[] = [];
  for (const agent of ordered.slice(0, count)) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (manhattan(agent.tile, left[i]) < manhattan(agent.tile, left[best])) best = i;
    const [spot] = left.splice(best, 1);
    members.push({ agentId: agent.id, spotId: spot.id, tile: { x: spot.tx, y: spot.ty }, dir: spot.dir, pose: rule.poses[members.length % rule.poses.length] });
  }
  return { kind, group: group[0].group as string, members };
}

// Reserves the spot of every member for that member, all or none.
export function reserveHangout(ledger: SpotLedger, hangout: Hangout): boolean {
  if (!hangout.members.every((m) => ledger.isFree(m.spotId, m.agentId))) return false;
  for (const m of hangout.members) ledger.reserve(m.spotId, m.agentId);
  return true;
}

export function releaseHangout(ledger: SpotLedger, hangout: Hangout): void {
  for (const m of hangout.members) ledger.release(m.spotId, m.agentId);
}
