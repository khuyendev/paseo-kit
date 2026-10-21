// No upstream: written for the spawn and archive effects of the office.
// Presence rules (pure, no clock read): which newly seen agents come up by elevator, how archived agents leave, and which rooms are lit.
// Time is passed in by the caller; an unreadable value takes the safe default (no animation, room dark only when nobody is present).
import { ARCHIVE_BULK_MAX, SPAWN_FRESH_MS } from "./limits-life.ts";

export { ARCHIVE_BULK_MAX, SPAWN_FRESH_MS };

export type LeaveMode = "walk" | "fade";

// True when createdAt is an ISO time within freshMs of nowMs (a small clock skew into the future counts); anything unreadable is false.
export function isFreshSpawn(createdAt: unknown, nowMs: number, freshMs: number = SPAWN_FRESH_MS): boolean {
  if (typeof createdAt !== "string" || createdAt === "" || !Number.isFinite(nowMs)) return false;
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return false;
  return Math.abs(nowMs - at) <= freshMs;
}

export interface SpawnBook {
  // Agents already decided: the ones present at the first ready snapshot, then every one seen since. Null until the store is ready.
  baseline: ReadonlySet<string> | null;
  // Agents decided as fresh spawns, kept while they are present.
  spawned: ReadonlySet<string>;
}

const idsOf = (agents: readonly unknown[]): { id: string; createdAt: unknown }[] => {
  const out: { id: string; createdAt: unknown }[] = [];
  for (const a of Array.isArray(agents) ? agents : []) {
    if (typeof a === "object" && a !== null && typeof (a as { id?: unknown }).id === "string") out.push({ id: (a as { id: string }).id, createdAt: (a as { createdAt?: unknown }).createdAt });
  }
  return out;
};

// One decision per agent: present at open means no arrival; seen later and fresh means an arrival. Agents that left are forgotten,
// so both sets stay bounded by the store.
export function trackSpawns(book: SpawnBook | null, ready: boolean, agents: readonly unknown[], nowMs: number): SpawnBook {
  const current = book ?? { baseline: null, spawned: new Set<string>() };
  if (!ready) return current;
  const list = idsOf(agents);
  if (current.baseline === null) return { baseline: new Set(list.map((a) => a.id)), spawned: new Set<string>() };
  const baseline = new Set<string>();
  const spawned = new Set<string>();
  for (const a of list) {
    if (!current.baseline.has(a.id) && isFreshSpawn(a.createdAt, nowMs)) spawned.add(a.id);
    else if (current.spawned.has(a.id)) spawned.add(a.id);
    baseline.add(a.id);
  }
  return { baseline, spawned };
}

// The leave mode of each departing agent: decided once, when it first appears; a batch above ARCHIVE_BULK_MAX fades, a smaller one walks.
export function departureModes(prev: ReadonlyMap<string, LeaveMode> | null, departing: readonly unknown[], bulkMax: number = ARCHIVE_BULK_MAX): Map<string, LeaveMode> {
  const known = prev instanceof Map ? prev : new Map<string, LeaveMode>();
  const ids = (Array.isArray(departing) ? departing : []).filter((id): id is string => typeof id === "string");
  const fresh = ids.filter((id) => !known.has(id));
  const mode: LeaveMode = fresh.length > bulkMax ? "fade" : "walk";
  const out = new Map<string, LeaveMode>();
  for (const id of ids) out.set(id, known.get(id) ?? mode);
  return out;
}

// Lit when at least one agent seated in the room is present; a room with nobody present is dark ("the last one out turns the lights off").
export function roomLights(roomIds: readonly unknown[], seats: readonly unknown[], present: (agentId: string) => boolean): Map<string, boolean> {
  const lit = new Set<string>();
  for (const seat of Array.isArray(seats) ? seats : []) {
    if (typeof seat !== "object" || seat === null) continue;
    const { agentId, roomId } = seat as { agentId?: unknown; roomId?: unknown };
    if (typeof agentId === "string" && typeof roomId === "string" && !lit.has(roomId) && present(agentId)) lit.add(roomId);
  }
  const out = new Map<string, boolean>();
  for (const id of Array.isArray(roomIds) ? roomIds : []) if (typeof id === "string") out.set(id, lit.has(id));
  return out;
}
