// No upstream: written for the HUD of the office.
// Activity feed: events derived only from two consecutive store snapshots (and the handoffs the scene takes), kept newest first and
// bounded, shown for the visible projects with a relative time from the scene beat. Pure: no React, no SDK, no timer, no clock read.
import type { OfficeSnapshot } from "../shared/model-types.ts";
import { SCENE_BEAT_MS } from "./camera.ts";
import { FEED_MAX } from "./limits-panels.ts";
import { agentName } from "./names.ts";
import type { StringKey } from "./strings.ts";

export type FeedKind = "spawn" | "finished" | "permission" | "error" | "handoff" | "shell" | "archived";

export interface FeedDraft {
  kind: FeedKind;
  agentId: string;
  projectId: string | null;
}

export interface FeedEntry extends FeedDraft {
  seq: number;
  beat: number;
}

export interface FeedState {
  entries: readonly FeedEntry[];
  nextSeq: number;
}

export const EMPTY_FEED: FeedState = { entries: [], nextSeq: 1 };

const KIND_KEY: Readonly<Record<FeedKind, StringKey>> = {
  spawn: "feedSpawn",
  finished: "feedFinished",
  permission: "feedPermission",
  error: "feedError",
  handoff: "feedHandoff",
  shell: "feedShell",
  archived: "feedArchived",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function byId(list: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const a of Array.isArray(list) ? list : []) if (isRecord(a) && typeof a.id === "string" && !out.has(a.id)) out.set(a.id, a);
  return out;
}

const asks = (a: Record<string, unknown>): boolean => (typeof a.pendingPermissions === "number" && a.pendingPermissions > 0) || (a.requiresAttention === true && a.attentionReason === "permission");
const shellOf = (a: Record<string, unknown>): Record<string, unknown> | null => (isRecord(a.shell) ? a.shell : null);
const projectOf = (a: Record<string, unknown>): string | null => (typeof a.projectId === "string" ? a.projectId : null);

// The events between two snapshots; none for the first one, so opening the office shows no burst of old news.
export function feedDrafts(prev: OfficeSnapshot | null, next: OfficeSnapshot): FeedDraft[] {
  if (!isRecord(prev) || !isRecord(next)) return [];
  const before = byId(prev.agents);
  const beforeGone = byId(prev.departing);
  const out: FeedDraft[] = [];
  for (const [id, a] of byId(next.agents)) {
    const was = before.get(id);
    const projectId = projectOf(a);
    if (was === undefined) {
      if (!beforeGone.has(id)) out.push({ kind: "spawn", agentId: id, projectId });
      continue;
    }
    if (was.status === "running" && a.status === "idle") out.push({ kind: "finished", agentId: id, projectId });
    if (!asks(was) && asks(a)) out.push({ kind: "permission", agentId: id, projectId });
    if (was.status !== "error" && a.status === "error") out.push({ kind: "error", agentId: id, projectId });
    const s0 = shellOf(was);
    const s1 = shellOf(a);
    if (s0 !== null && s1 !== null && s0.callId === s1.callId && s0.status === "running" && (s1.status === "completed" || s1.status === "failed")) out.push({ kind: "shell", agentId: id, projectId });
  }
  for (const [id, a] of byId(next.departing)) if (!beforeGone.has(id)) out.push({ kind: "archived", agentId: id, projectId: projectOf(a) });
  return out;
}

export function pushFeed(state: FeedState, drafts: readonly FeedDraft[], beat: number, max: number = FEED_MAX): FeedState {
  if (!Array.isArray(drafts) || drafts.length === 0) return state;
  let seq = state.nextSeq;
  const fresh: FeedEntry[] = [];
  for (const d of drafts) {
    if (typeof d !== "object" || d === null || typeof d.agentId !== "string" || !Object.hasOwn(KIND_KEY, d.kind)) continue;
    fresh.unshift({ kind: d.kind, agentId: d.agentId, projectId: typeof d.projectId === "string" ? d.projectId : null, seq: seq++, beat: Number.isFinite(beat) ? beat : 0 });
  }
  return { entries: [...fresh, ...state.entries].slice(0, Math.max(0, max)), nextSeq: seq };
}

// A relative time from a number of beats: now under 10 s, then seconds, minutes and hours.
export function relativeTime(beats: number): { key: StringKey; count: number } {
  const ms = Number.isFinite(beats) && beats > 0 ? beats * SCENE_BEAT_MS : 0;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 10) return { key: "timeNow", count: 0 };
  if (seconds < 60) return { key: "timeSeconds", count: seconds };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { key: "timeMinutes", count: minutes };
  return { key: "timeHours", count: Math.floor(minutes / 60) };
}

export interface FeedRow {
  seq: number;
  kind: FeedKind;
  agentId: string;
  kindKey: StringKey;
  name: string;
  when: { key: StringKey; count: number };
}

export function feedRows(state: FeedState, hidden: ReadonlySet<string> | null, beat: number): FeedRow[] {
  const hide = hidden instanceof Set ? hidden : new Set<string>();
  return state.entries
    .filter((e) => e.projectId === null || !hide.has(e.projectId))
    .map((e) => ({ seq: e.seq, kind: e.kind, agentId: e.agentId, kindKey: KIND_KEY[e.kind], name: agentName(e.agentId), when: relativeTime(beat - e.beat) }));
}
