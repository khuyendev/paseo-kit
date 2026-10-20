// Pure client state of the swarm surface: poll cursor, feed, header counters, zoom, selection and effect budgets
// (PANL-44, PANL-45, PANL-47, PANL-50, PANL-51, PANL-52). No React here, so it is unit-tested offline.
import type { FileHold, SnapshotInput, SwarmAgent, SwarmEvent, SwarmFailure, SwarmSnapshot } from "../shared/swarm.ts";
import { clip, firstLine } from "./format.ts";
import { ACTIVITY_VERB, agentState } from "./palette.ts";

export const SNAPSHOT_POLL_MS = 1000;
export const DETAIL_POLL_MS = 1500;
export const RECENT_HOURS = 6;
export const FEED_MAX = 80;
export const NEW_BADGE_MS = 12_000;
export const GHOST_MS = 1700;
export const MAX_EFFECTS = 60;
export const TOOL_POP_GAP_MS = 900;
export const HANDOFF_PACKETS_PER_POLL = 8;
export const BOOT_STAGGER_MS = 30;
export const BOOT_STAGGER_MAX_MS = 900;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;
export const ERRORS_SHOWN = 3;

export interface Cursor {
  seq: number;
  epoch: string | null;
}

export const START_CURSOR: Cursor = { seq: -1, epoch: null };

export function snapshotInput(cursor: Cursor, recentOnly: boolean): SnapshotInput {
  return { recentHours: recentOnly ? RECENT_HOURS : 0, afterSeq: cursor.seq, eventEpoch: cursor.epoch };
}

export interface FeedState {
  cursor: Cursor;
  events: SwarmEvent[];
  // Events with seq above this arrived live and may animate; history never does (PANL-44).
  liveFromSeq: number;
}

export const START_FEED: FeedState = { cursor: START_CURSOR, events: [], liveFromSeq: Number.MAX_SAFE_INTEGER };

// Applies one snapshot response. Only ok:true responses move the cursor (PANL-24). Returns the new state and the
// events that are new and live (to animate).
export function applySnapshot(
  state: FeedState,
  res: SwarmSnapshot | SwarmFailure,
  onMap: (agentId: string) => boolean,
): { state: FeedState; live: SwarmEvent[] } {
  if (!res.ok) return { state, live: [] };
  const first = state.cursor.seq < 0 || state.cursor.epoch !== res.eventEpoch;
  const visible = (e: SwarmEvent) => onMap(e.agentId) || (e.parentId !== null && onMap(e.parentId));
  const fresh = res.events.filter((e) => (first || e.seq > state.cursor.seq) && visible(e));
  const base = first ? [] : state.events;
  const seen = new Set(base.map((e) => e.seq));
  const events = [...fresh.filter((e) => !seen.has(e.seq)).reverse(), ...base].slice(0, FEED_MAX);
  const liveFromSeq = first ? res.lastSeq : state.liveFromSeq;
  return {
    state: { cursor: { seq: res.lastSeq, epoch: res.eventEpoch }, events, liveFromSeq },
    live: first ? [] : fresh,
  };
}

export function actionsPerMinute(events: readonly SwarmEvent[], nowMs: number): number {
  return events.filter((e) => e.kind === "tool" && nowMs - Date.parse(e.at) <= 60_000).length;
}

// Feed row text per event kind (PANL-45).
export function eventText(e: SwarmEvent): string {
  const t = (fallback = "") => clip(firstLine(e.text), 80) || fallback;
  switch (e.kind) {
    case "spawn":
      return "spawned";
    case "archive":
      return "archived";
    case "command":
      return `got prompt: ${t("(prompt not captured)")}`;
    case "report":
      return `reported: ${t("(no reply text)")}${e.stats ? ` · ${e.stats}` : ""}`;
    case "failed":
      return `turn failed: ${t("unknown error")}`;
    case "canceled":
      return "turn canceled";
    case "permission":
      return `needs permission: ${t("a tool")}`;
    case "permission_resolved":
      return "permission answered";
    case "tool": {
      const kind = e.activity?.kind ?? "tool";
      const verb = ACTIVITY_VERB[kind][e.activity?.status === "running" ? 0 : 1];
      return `${verb} ${t()}`.trim();
    }
    case "handoff": {
      const kind = e.activity?.kind;
      if (e.peerOp && e.peerOp !== "read" && (kind === "edit" || kind === "write")) return `write conflict: ${t()}`;
      return `took over ${t()}`;
    }
  }
}

export interface HeaderCounts {
  running: number;
  sleep: number;
  waiting: number;
  error: number;
  overThreshold: number;
  conflicts: number;
}

export function headerCounts(agents: readonly SwarmAgent[], files: readonly FileHold[]): HeaderCounts {
  const n = (state: string) => agents.filter((a) => agentState(a) === state).length;
  return {
    running: n("working"),
    sleep: n("sleep"),
    waiting: n("waiting"),
    error: n("error"),
    overThreshold: agents.filter((a) => a.rotatePct !== null && a.contextPct !== null && a.contextPct >= a.rotatePct).length,
    conflicts: files.filter((f) => f.writers >= 2).length,
  };
}

// The header chip names one threshold when all drawn agents share it, else says "per project".
export function thresholdLabel(agents: readonly SwarmAgent[]): string {
  const values = [...new Set(agents.map((a) => a.rotatePct).filter((v): v is number => v !== null))];
  return values.length === 1 ? `ctx ≥${values[0]}%` : "ctx ≥ROTATE";
}

export function subtitle(failed: boolean, data: SwarmSnapshot | null, hubs: number): string {
  if (failed) return "offline";
  if (!data) return "connecting…";
  return `live · ${data.brains.length} brains · ${hubs} swarms`;
}

export function fitZoom(viewportW: number, layoutW: number): number {
  if (viewportW <= 0 || layoutW <= 0) return 1;
  return Math.max(ZOOM_MIN, Math.min(1, (viewportW - 8) / layoutW));
}

const round1 = (z: number) => Math.round(z * 10) / 10;
export const zoomIn = (z: number) => Math.min(ZOOM_MAX, round1(z + ZOOM_STEP));
export const zoomOut = (z: number) => Math.max(ZOOM_MIN, round1(z - ZOOM_STEP));
export const zoomText = (z: number) => `${Math.round(z * 100)}%`;

export type Selection = { kind: "agent" | "brain" | "hub"; id: string };

// Pressing the selected node again closes the inspector.
export function toggleSelection(cur: Selection | null, next: Selection): Selection | null {
  return cur && cur.kind === next.kind && cur.id === next.id ? null : next;
}

// Newest handoffs first so the per-poll budget keeps the latest; a tool event whose call already produced a
// handoff gets no extra pop (PANL-42, PANL-50).
export function effectEvents(live: readonly SwarmEvent[]): SwarmEvent[] {
  const handed = new Set(live.filter((e) => e.kind === "handoff").map((e) => e.activity?.id));
  let budget = HANDOFF_PACKETS_PER_POLL;
  return [...live]
    .sort((a, b) => Number(b.kind === "handoff") - Number(a.kind === "handoff") || b.seq - a.seq)
    .filter((e) => {
      if (e.kind === "tool" && handed.has(e.activity?.id)) return false;
      if (e.kind !== "handoff") return true;
      budget -= 1;
      return budget >= 0;
    });
}

export function bootDelay(index: number): number {
  return Math.min(index * BOOT_STAGGER_MS, BOOT_STAGGER_MAX_MS);
}

// Keeps the newest effects within the live-effect cap.
export function capEffects<T>(effects: readonly T[]): T[] {
  return effects.slice(-MAX_EFFECTS);
}

// Appearance (PANL-49): the first response boots everything in; a node seen later springs in (NEW); after a view
// filter change unseen nodes boot in without NEW. The modes of a response are computed before its ids enter the
// book and are handed to the render that first mounts those nodes (CR-PNL-10: nodes animate only on mount).
export type AppearMode = "boot" | "spawn" | "none";
export interface AppearBook {
  known: ReadonlySet<string>;
  booted: boolean;
  viewKey: string | null;
}
export const EMPTY_BOOK: AppearBook = { known: new Set(), booted: false, viewKey: null };

export function appearance(book: AppearBook, ids: readonly string[], viewKey: string): { modes: Map<string, AppearMode>; book: AppearBook } {
  const viewChanged = book.booted && book.viewKey !== viewKey;
  const mode = (id: string): AppearMode => (!book.booted ? "boot" : book.known.has(id) ? "none" : viewChanged ? "boot" : "spawn");
  return { modes: new Map(ids.map((id) => [id, mode(id)])), book: { known: new Set([...book.known, ...ids]), booted: true, viewKey } };
}
