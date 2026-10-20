// Layout of the swarm map in canvas pixels (PANL-46): brain on the left, each swarm a hub to its right with its
// agents on one ring (<= 10 slots) or two C-shaped rings whose opening faces the brain. Agents keep their slot
// while they live (SlotBook), so spawns and archives never move the others; a freed slot cools down before reuse.
import type { Brain, SwarmAgent, SwarmGroup } from "../shared/swarm.ts";

export interface Point {
  x: number;
  y: number;
}

export const BRAIN_R = 62;
export const HUB_R = 42;
export const AGENT_R = 26;
export const AGENT_LABEL = { w: 150, h: 58 };
export const BRAIN_LABEL = { w: 300, h: 136 };
export const HUB_LABEL = { w: 190, h: 64 };
const FILE_ROW_DY = AGENT_R + 7 + 44;

const PAD = 40;
export const SLOT_COOLDOWN_MS = 4000;
export const TIERS = [4, 6, 8, 10, 12, 16, 20, 24, 30, 36, 48, 64, 96, 128];
const ONE_RING_MAX = 10;
const GAP_DEG = 70;
const SLOT_ARC_PX = 138;
const MIN_R = 172;
const RING_GAP_PX = 118;
const INNER_SHARE = 0.42;
const BRAIN_TO_CLUSTER_PX = 70;
const CLUSTER_GAP_PX = 24;
const SYSTEM_GAP_PX = 90;
const BRAIN_BLOCK_H = BRAIN_R * 2 + 40 + BRAIN_LABEL.h;

export interface BrainPlace {
  key: string;
  brain: Brain;
  x: number;
  y: number;
}

export interface HubPlace {
  id: string;
  brainKey: string;
  group: SwarmGroup;
  x: number;
  y: number;
  edge: Point[];
  orbits: number[];
  haloR: number;
}

export interface AgentPlace {
  agent: SwarmAgent;
  hubId: string;
  swarm: string;
  x: number;
  y: number;
  edge: Point[];
}

export interface Layout {
  width: number;
  height: number;
  brains: BrainPlace[];
  hubs: HubPlace[];
  agents: AgentPlace[];
  byAgent: Map<string, AgentPlace>;
  byHub: Map<string, HubPlace>;
  byBrain: Map<string, BrainPlace>;
}

// Kept by the caller across renders: per hub, agent id -> slot, and freed slot -> time it was freed.
export interface SlotBook {
  slots: Map<string, Map<string, number>>;
  freed: Map<string, Map<number, number>>;
}

export function createSlotBook(): SlotBook {
  return { slots: new Map(), freed: new Map() };
}

export const brainKeyOf = (b: Brain) => b.agent?.id ?? "orphans";
export const hubIdOf = (brainKey: string, group: string) => `${brainKey}/${group}`;

export function tier(n: number): number {
  return TIERS.find((t) => t >= n) ?? Math.ceil(n / 32) * 32;
}

export function assignSlots(book: SlotBook, hub: string, agents: readonly SwarmAgent[], nowMs: number): { slots: Map<string, number>; capacity: number } {
  const prev = book.slots.get(hub) ?? new Map<string, number>();
  const freed = book.freed.get(hub) ?? new Map<number, number>();
  const live = new Set(agents.map((a) => a.id));
  let slots = new Map<string, number>();
  for (const [id, s] of prev) {
    if (live.has(id)) slots.set(id, s);
    else freed.set(s, nowMs);
  }
  for (const [s, t] of freed) if (nowMs - t > SLOT_COOLDOWN_MS) freed.delete(s);
  const used = new Set(slots.values());
  const capacityNow = tier(Math.max(agents.length, 1));
  for (const a of agents) {
    if (slots.has(a.id)) continue;
    // Lowest slot neither used nor cooling down; a cooling slot only when the tier is otherwise full.
    let next = 0;
    while (used.has(next) || (freed.has(next) && next < capacityNow)) next += 1;
    if (next >= capacityNow) {
      next = 0;
      while (used.has(next)) next += 1;
    }
    slots.set(a.id, next);
    used.add(next);
    freed.delete(next);
  }
  book.freed.set(hub, freed);
  // Renumber only when the swarm's tier shrinks.
  let maxSlot = Math.max(-1, ...slots.values());
  if (maxSlot + 1 > tier(agents.length)) {
    slots = new Map([...slots].sort((a, b) => a[1] - b[1]).map(([id], i) => [id, i]));
    maxSlot = slots.size - 1;
  }
  book.slots.set(hub, slots);
  return { slots, capacity: tier(Math.max(agents.length, maxSlot + 1, 1)) };
}

interface Rings {
  n1: number;
  n2: number;
  r1: number;
  r2: number;
}

function rings(capacity: number): Rings {
  const n1 = capacity <= ONE_RING_MAX ? capacity : Math.ceil(capacity * INNER_SHARE);
  const n2 = capacity - n1;
  const span = ((360 - GAP_DEG) * Math.PI) / 180;
  const r1 = Math.max(MIN_R, (n1 * SLOT_ARC_PX) / span);
  const r2 = n2 > 0 ? Math.max(r1 + RING_GAP_PX, (n2 * SLOT_ARC_PX) / span) : r1;
  return { n1, n2, r1, r2 };
}

function slotOffset(slot: number, r: Rings, openingDeg: number): Point {
  const inner = slot < r.n1;
  const n = inner ? r.n1 : r.n2;
  const k = inner ? slot : slot - r.n1;
  const deg = openingDeg + GAP_DEG / 2 + ((k + 0.5) * (360 - GAP_DEG)) / n;
  const rad = (deg * Math.PI) / 180;
  const radius = inner ? r.r1 : r.r2;
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
}

function extent(r: Rings): { halfW: number; halfH: number } {
  const radius = Math.max(r.r1, r.r2);
  return { halfW: radius + AGENT_LABEL.w / 2 + 6, halfH: radius + AGENT_R + 12 + AGENT_LABEL.h };
}

export function computeLayout(input: readonly Brain[], book: SlotBook, nowMs: number): Layout {
  const brains: BrainPlace[] = [];
  const hubs: HubPlace[] = [];
  const agents: AgentPlace[] = [];
  let top = PAD;
  let right = 0;
  const brainX = PAD + BRAIN_LABEL.w / 2;
  for (const brain of input) {
    const key = brainKeyOf(brain);
    const clusters = brain.groups.map((g) => {
      const id = hubIdOf(key, g.name);
      const { slots, capacity } = assignSlots(book, id, g.agents, nowMs);
      const r = rings(capacity);
      return { g, id, slots, r, ext: extent(r) };
    });
    const stackH = clusters.reduce((h, cl) => h + cl.ext.halfH * 2, 0) + CLUSTER_GAP_PX * Math.max(0, clusters.length - 1);
    const systemH = Math.max(stackH, BRAIN_BLOCK_H);
    let y = top + (systemH - stackH) / 2;
    const brainY = top + systemH / 2 - BRAIN_LABEL.h / 2 + 10;
    brains.push({ key, brain, x: brainX, y: brainY });
    for (const cl of clusters) {
      const cx = brainX + BRAIN_LABEL.w / 2 + BRAIN_TO_CLUSTER_PX + cl.ext.halfW;
      const cy = y + cl.ext.halfH;
      y += cl.ext.halfH * 2 + CLUSTER_GAP_PX;
      right = Math.max(right, cx + cl.ext.halfW);
      const openingDeg = (Math.atan2(brainY - cy, brainX - cx) * 180) / Math.PI;
      hubs.push({
        id: cl.id,
        brainKey: key,
        group: cl.g,
        x: cx,
        y: cy,
        edge: [{ x: brainX, y: brainY }, { x: cx, y: cy }],
        orbits: cl.r.n2 > 0 ? [cl.r.r1, cl.r.r2] : [cl.r.r1],
        haloR: Math.max(cl.r.r1, cl.r.r2) + AGENT_R + 30,
      });
      const ordered = [...cl.g.agents].sort((a, b) => (cl.slots.get(a.id) ?? 0) - (cl.slots.get(b.id) ?? 0));
      for (const a of ordered) {
        const off = slotOffset(cl.slots.get(a.id) ?? 0, cl.r, openingDeg);
        const p = { x: cx + off.x, y: cy + off.y };
        agents.push({ agent: a, hubId: cl.id, swarm: cl.g.name, x: p.x, y: p.y, edge: [{ x: cx, y: cy }, p] });
      }
    }
    top += systemH + SYSTEM_GAP_PX;
  }
  return {
    width: Math.max(1, Math.ceil(Math.max(right, brainX + BRAIN_LABEL.w / 2) + PAD)),
    height: Math.max(1, Math.ceil(top - SYSTEM_GAP_PX + PAD)),
    brains,
    hubs,
    agents,
    byAgent: new Map(agents.map((a) => [a.agent.id, a])),
    byHub: new Map(hubs.map((h) => [h.id, h])),
    byBrain: new Map(brains.map((b) => [b.key, b])),
  };
}

export function pathToAgent(layout: Layout, agentId: string): Point[] | null {
  const a = layout.byAgent.get(agentId);
  const hub = a ? layout.byHub.get(a.hubId) : undefined;
  return a && hub ? [...hub.edge, ...a.edge.slice(1)] : null;
}

// Where an agent's or brain's held files are drawn.
export function fileAnchor(layout: Layout, id: string): Point | null {
  const a = layout.byAgent.get(id);
  if (a) return { x: a.x, y: a.y + FILE_ROW_DY };
  const b = layout.byBrain.get(id);
  return b ? { x: b.x + BRAIN_R + 30, y: b.y } : null;
}

// Quadratic arc from a to b bulging upwards, as a polyline.
export function arc(a: Point, b: Point, bend = 0.22, steps = 12): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len;
  let py = dx / len;
  if (py > 0) {
    px = -px;
    py = -py;
  }
  const cx = (a.x + b.x) / 2 + px * bend * len;
  const cy = (a.y + b.y) / 2 + py * bend * len;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
  });
}

export function polylineLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}
