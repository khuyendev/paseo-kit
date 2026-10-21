// No upstream: written for the HUD of the office.
// Camera and search helpers: the next agent that needs the owner, the camera target of an agent, the foot of a walking character for
// Follow, and the agent search by generated name or title. Pure: no React, no SDK, no timer, no clock read.
import { ROOM_ID_PREFIX, type BuildingLayout } from "../shared/layout/building.ts";
import type { TileRect } from "../shared/layout/types.ts";
import type { OfficeSnapshot } from "../shared/model-types.ts";
import { footPx } from "./life/frames.ts";
import type { Journey } from "./life/journey.ts";
import { LABEL_MAX_CHARS, SEARCH_QUERY_MAX_CHARS } from "./limits-panels.ts";
import { projectOfAgent, workspaceProjects } from "./model.ts";
import { agentName } from "./names.ts";
import type { CameraTarget } from "./sidebar-model.ts";
import { clipText } from "./strings.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const listOf = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const needsOwner = (a: Record<string, unknown>): boolean => (typeof a.pendingPermissions === "number" && a.pendingPermissions > 0) || a.requiresAttention === true;

// The agent that needs the owner after the current one, in snapshot order, wrapping around; null when none does.
export function nextRequest(snapshot: OfficeSnapshot | null, currentId: string | null): string | null {
  const ids = listOf(isRecord(snapshot) ? snapshot.agents : null)
    .filter((a): a is Record<string, unknown> => isRecord(a) && typeof a.id === "string" && needsOwner(a))
    .map((a) => a.id as string);
  if (ids.length === 0) return null;
  const all = listOf(isRecord(snapshot) ? snapshot.agents : null).filter((a): a is Record<string, unknown> => isRecord(a) && typeof a.id === "string").map((a) => a.id as string);
  const at = currentId === null ? -1 : all.indexOf(currentId);
  for (const id of ids) if (all.indexOf(id) > at) return id;
  return ids[0] as string;
}

// The camera target of one agent: its room when the room is drawn, else the whole building.
export function agentTarget(agent: { id: string; projectId: string | null; workspaceId: string | null }, building: BuildingLayout): CameraTarget {
  const area = building.areas.find((a) => a.kind === "room" && agent.projectId !== null && a.id === `${ROOM_ID_PREFIX}${agent.projectId}`);
  const rect: TileRect = area ? area.rect : building.rect;
  return { scope: area ? "agent" : "building", rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, roomId: agent.projectId, workspaceId: agent.workspaceId, agentId: agent.id };
}

// The foot pixel of a character elapsedMs into its journey, clamped to the journey's ends; null for a journey without steps.
export function journeyFootAt(journey: Journey | null, elapsedMs: number): { x: number; y: number } | null {
  if (!isRecord(journey) || !Array.isArray(journey.steps) || journey.steps.length === 0) return null;
  let at = footPx(journey.startTile);
  let left = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  for (const step of journey.steps) {
    if (step.kind === "appear") at = footPx(step.tile);
    if (step.kind !== "walk") {
      left -= step.ms;
      if (left <= 0) return at;
      continue;
    }
    let from = step.plan.startPx;
    for (const seg of step.plan.segments) {
      if (left < seg.ms && seg.ms > 0) {
        const t = left / seg.ms;
        return { x: Math.round(from.x + (seg.x - from.x) * t), y: Math.round(from.y + (seg.y - from.y) * t) };
      }
      left -= seg.ms;
      from = { x: seg.x, y: seg.y };
    }
    at = from;
  }
  return at;
}

export interface SearchResult {
  agentId: string;
  name: string;
  label: string | null;
}

// Agents of the visible projects whose generated name or title holds the query (case-insensitive), in snapshot order, capped.
export function searchAgents(snapshot: OfficeSnapshot | null, query: unknown, hidden: ReadonlySet<string> | null, max: number): SearchResult[] {
  const q = clipText(query, SEARCH_QUERY_MAX_CHARS).toLowerCase();
  if (q === "" || !Number.isInteger(max) || max <= 0) return [];
  const hide = hidden instanceof Set ? hidden : new Set<string>();
  const byWorkspace = workspaceProjects(snapshot);
  const out: SearchResult[] = [];
  for (const a of listOf(isRecord(snapshot) ? snapshot.agents : null)) {
    if (out.length >= max) break;
    if (!isRecord(a) || typeof a.id !== "string") continue;
    const project = projectOfAgent(a, byWorkspace);
    if (project !== null && hide.has(project)) continue;
    const name = agentName(a.id);
    const label = clipText(a.title, LABEL_MAX_CHARS);
    if (name.toLowerCase().includes(q) || label.toLowerCase().includes(q)) out.push({ agentId: a.id, name, label: label === "" ? null : label });
  }
  return out;
}
