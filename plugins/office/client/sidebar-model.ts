// Sidebar view-model (OFFC-14, D-04): a flat list of the projects, each with a checkbox state, small counters and a camera target.
// The state is the set of HIDDEN project ids, so a project that appears later is shown; a hidden id that names no project is ignored.
// Pure data: it only orders and filters values the snapshot and the building already carry (D-03). Ids are opaque keys held in Map and Set.
import { LABEL_MAX_CHARS, SEARCH_QUERY_MAX_CHARS } from "./limits-panels.ts";
import { projectOfAgent, workspaceProjects } from "./model.ts";
import { clipText } from "./strings.ts";
import { ROOM_ID_PREFIX, type BuildingLayout } from "../shared/layout/building.ts";
import type { TileRect } from "../shared/layout/types.ts";
import type { OfficeSnapshot } from "../shared/model-types.ts";

export interface CameraTarget {
  scope: "building" | "room" | "cluster" | "agent";
  rect: TileRect;
  // The project id.
  roomId: string | null;
  workspaceId: string | null;
  agentId: string | null;
}

export interface ProjectRow {
  projectId: string;
  // Clipped name; null when empty, so the component shows the fallback text.
  label: string | null;
  // False when the project is in the hidden set.
  shown: boolean;
  agents: number;
  working: number;
  // Some agent of the project needs the owner.
  attention: boolean;
  target: CameraTarget;
}

export interface ProjectList {
  rows: readonly ProjectRow[];
  // Projects beyond the row cap, counted exactly.
  more: number;
  // Projects shown in the scene, rows beyond the cap included.
  shownCount: number;
  total: number;
}

const copyRect = (r: TileRect): TileRect => ({ x: r.x, y: r.y, w: r.w, h: r.h });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const listOf = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

function labelOf(raw: unknown): string | null {
  const clipped = clipText(raw, LABEL_MAX_CHARS);
  return clipped === "" ? null : clipped;
}

const hiddenOf = (hidden: unknown): ReadonlySet<string> => (hidden instanceof Set ? hidden : new Set<string>());

// Project ids of the snapshot in its order, each once.
function projectsOf(snapshot: unknown): { id: string; name: unknown }[] {
  const out: { id: string; name: unknown }[] = [];
  const seen = new Set<string>();
  for (const p of listOf(isRecord(snapshot) ? snapshot.projects : null)) {
    if (!isRecord(p) || typeof p.id !== "string" || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: p.name });
  }
  return out;
}

// query keeps the projects whose name holds it (case-insensitive); the counts and shownCount still cover every project.
export function projectList(snapshot: OfficeSnapshot, hidden: ReadonlySet<string> | null, building: BuildingLayout, maxRows: number, query: unknown = ""): ProjectList {
  const hide = hiddenOf(hidden);
  const q = clipText(query, SEARCH_QUERY_MAX_CHARS).toLowerCase();
  const buildingRect = isRecord(building) && isRecord(building.rect) ? (building.rect as unknown as TileRect) : { x: 0, y: 0, w: 1, h: 1 };
  const roomRects = new Map<string, TileRect>();
  for (const area of listOf(isRecord(building) ? building.areas : null)) {
    if (!isRecord(area) || area.kind !== "room" || typeof area.id !== "string" || !area.id.startsWith(ROOM_ID_PREFIX)) continue;
    const key = area.id.slice(ROOM_ID_PREFIX.length);
    if (!roomRects.has(key) && isRecord(area.rect)) roomRects.set(key, area.rect as unknown as TileRect);
  }

  const counts = new Map<string, { agents: number; working: number; attention: boolean }>();
  const byWorkspace = workspaceProjects(snapshot);
  for (const a of listOf(isRecord(snapshot) ? snapshot.agents : null)) {
    const project = projectOfAgent(a, byWorkspace);
    if (project === null || !isRecord(a)) continue;
    const c = counts.get(project) ?? { agents: 0, working: 0, attention: false };
    c.agents++;
    if (a.status === "running") c.working++;
    if (a.requiresAttention === true || (typeof a.pendingPermissions === "number" && a.pendingPermissions > 0)) c.attention = true;
    counts.set(project, c);
  }

  const rows: ProjectRow[] = [];
  let more = 0;
  let shownCount = 0;
  const projects = projectsOf(snapshot);
  const cap = Number.isInteger(maxRows) && maxRows >= 0 ? maxRows : 0;
  for (const p of projects) {
    const shown = !hide.has(p.id);
    if (shown) shownCount++;
    const label = labelOf(p.name);
    if (q !== "" && !(label ?? "").toLowerCase().includes(q)) continue;
    if (rows.length >= cap) {
      more++;
      continue;
    }
    const rect = roomRects.get(p.id);
    const target: CameraTarget = rect
      ? { scope: "room", rect: copyRect(rect), roomId: p.id, workspaceId: null, agentId: null }
      : { scope: "building", rect: copyRect(buildingRect), roomId: p.id, workspaceId: null, agentId: null };
    const c = counts.get(p.id) ?? { agents: 0, working: 0, attention: false };
    rows.push({ projectId: p.id, label, shown, agents: c.agents, working: c.working, attention: c.attention, target });
  }
  return { rows, more, shownCount, total: projects.length };
}

// A new hidden set with the project flipped; the input is not changed.
export function toggleProject(hidden: ReadonlySet<string> | null, projectId: string): ReadonlySet<string> {
  const next = new Set(hiddenOf(hidden));
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  return next;
}

// "All": nothing hidden.
export function showAllProjects(): ReadonlySet<string> {
  return new Set<string>();
}

// "None": every project of the snapshot hidden; a project that appears later is still shown.
export function hideAllProjects(snapshot: OfficeSnapshot): ReadonlySet<string> {
  return new Set(projectsOf(snapshot).map((p) => p.id));
}
