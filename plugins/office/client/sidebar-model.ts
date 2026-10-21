// Sidebar view-model (OFFC-14, D-04): Paseo's tree project > workspace > agent, each node with a camera target inside the building.
// Pure data: it only orders and filters values the snapshot and the building model already carry (D-03). Ids are opaque keys held in Map and Set, never in a plain object or a uri.
import { LABEL_MAX_CHARS } from "./limits-panels.ts";
import { AGENT_STATUS_KEY, WORKSPACE_STATUS_KEY, clipText, type StringKey } from "./strings.ts";
import { ROOM_ID_PREFIX, type BuildingLayout } from "../shared/layout/building.ts";
import type { TileRect } from "../shared/layout/types.ts";
import type { BuildingModel, OfficeSnapshot } from "../shared/model-types.ts";

export interface CameraTarget {
  scope: "building" | "room" | "cluster" | "agent";
  rect: TileRect;
  // The project id.
  roomId: string | null;
  workspaceId: string | null;
  agentId: string | null;
}

export interface SidebarNode {
  id: string;
  kind: "project" | "workspace" | "agent" | "unplaced";
  // Clipped name or title; null when empty, so the component shows the fallback text of the kind.
  label: string | null;
  statusKey: StringKey | null;
  attention: boolean;
  isChild: boolean;
  // True for every node that is not an agent; an agent counted only in a surplus group is false.
  drawn: boolean;
  target: CameraTarget;
  children: readonly SidebarNode[];
}

export interface SidebarTree {
  root: CameraTarget;
  nodes: readonly SidebarNode[];
}

export interface SidebarRow {
  node: SidebarNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

interface Builder {
  node: Omit<SidebarNode, "children">;
  children: Builder[];
}

const copyRect = (r: TileRect): TileRect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function listOf(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

function labelOf(raw: unknown): string | null {
  const clipped = clipText(raw, LABEL_MAX_CHARS);
  return clipped === "" ? null : clipped;
}

function keyOf(map: Readonly<Record<string, StringKey>>, value: unknown): StringKey | null {
  return typeof value === "string" && Object.hasOwn(map, value) ? map[value]! : null;
}

function freeze(b: Builder): SidebarNode {
  return { ...b.node, children: b.children.map(freeze) };
}

export function sidebarTree(snapshot: OfficeSnapshot, model: BuildingModel, building: BuildingLayout): SidebarTree {
  const buildingRect = building.rect;
  const rootTarget = (): CameraTarget => ({ scope: "building", rect: copyRect(buildingRect), roomId: null, workspaceId: null, agentId: null });

  const roomRects = new Map<string, TileRect>();
  for (const area of listOf(building.areas)) {
    if (!isRecord(area) || area.kind !== "room" || typeof area.id !== "string" || !area.id.startsWith(ROOM_ID_PREFIX)) continue;
    const key = area.id.slice(ROOM_ID_PREFIX.length);
    if (!roomRects.has(key) && isRecord(area.rect)) roomRects.set(key, area.rect as unknown as TileRect);
  }

  const drawn = new Set<string>();
  for (const room of listOf(model?.rooms)) {
    if (!isRecord(room)) continue;
    for (const cluster of listOf(room.clusters)) {
      if (!isRecord(cluster)) continue;
      for (const d of listOf(cluster.drawn)) if (isRecord(d) && typeof d.agentId === "string") drawn.add(d.agentId);
    }
  }

  const agents = listOf(snapshot?.agents).filter((a): a is Record<string, unknown> => isRecord(a) && typeof a.id === "string");
  const agentIds = new Set<string>();
  for (const a of agents) agentIds.add(a.id as string);

  const targetFor = (projectId: string | null, workspaceId: string | null, agentId: string | null): CameraTarget => {
    const rect = projectId === null ? undefined : roomRects.get(projectId);
    if (!rect) return { ...rootTarget(), roomId: projectId, workspaceId, agentId };
    const scope = agentId !== null ? "agent" : workspaceId !== null ? "cluster" : "room";
    return { scope, rect: copyRect(rect), roomId: projectId, workspaceId, agentId };
  };

  const unplaced: Builder = {
    node: { id: "unplaced", kind: "unplaced", label: null, statusKey: null, attention: false, isChild: false, drawn: true, target: rootTarget() },
    children: [],
  };

  const projects = new Map<string, Builder>();
  const top: Builder[] = [];
  for (const p of listOf(snapshot?.projects)) {
    if (!isRecord(p) || typeof p.id !== "string") continue;
    const b: Builder = {
      node: { id: `project:${p.id}`, kind: "project", label: labelOf(p.name), statusKey: null, attention: false, isChild: false, drawn: true, target: targetFor(p.id, null, null) },
      children: [],
    };
    top.push(b);
    if (!projects.has(p.id)) projects.set(p.id, b);
  }

  // Workspace id -> its builder and the project id its agents belong to.
  const workspaces = new Map<string, { b: Builder; projectId: string | null }>();
  for (const w of listOf(snapshot?.workspaces)) {
    if (!isRecord(w) || typeof w.id !== "string") continue;
    const parent = typeof w.projectId === "string" ? projects.get(w.projectId) : undefined;
    const projectId = parent ? (w.projectId as string) : null;
    const b: Builder = {
      node: {
        id: `workspace:${w.id}`,
        kind: "workspace",
        label: labelOf(w.name),
        statusKey: keyOf(WORKSPACE_STATUS_KEY, w.status),
        attention: false,
        isChild: false,
        drawn: true,
        target: targetFor(projectId, w.id, null),
      },
      children: [],
    };
    (parent ?? unplaced).children.push(b);
    if (!workspaces.has(w.id)) workspaces.set(w.id, { b, projectId });
  }

  for (const a of agents) {
    const id = a.id as string;
    const ws = typeof a.workspaceId === "string" ? workspaces.get(a.workspaceId) : undefined;
    const b: Builder = {
      node: {
        id: `agent:${id}`,
        kind: "agent",
        label: labelOf(a.title),
        statusKey: keyOf(AGENT_STATUS_KEY, a.status),
        attention: a.requiresAttention === true,
        isChild: typeof a.parentAgentId === "string" && a.parentAgentId !== id && agentIds.has(a.parentAgentId),
        drawn: drawn.has(id),
        target: ws ? targetFor(ws.projectId, a.workspaceId as string, id) : { ...rootTarget(), agentId: id },
      },
      children: [],
    };
    (ws ? ws.b : unplaced).children.push(b);
  }

  if (unplaced.children.length > 0) top.push(unplaced);
  return { root: rootTarget(), nodes: top.map(freeze) };
}

/** Depth-first rows of the expanded nodes; rows beyond maxRows are counted into hidden. */
export function sidebarRows(tree: SidebarTree, expanded: ReadonlySet<string>, maxRows: number): { rows: readonly SidebarRow[]; hidden: number } {
  const rows: SidebarRow[] = [];
  let hidden = 0;
  const walk = (node: SidebarNode, depth: number): void => {
    const hasChildren = node.children.length > 0;
    const open = hasChildren && expanded.has(node.id);
    if (rows.length < maxRows) rows.push({ node, depth, hasChildren, expanded: open });
    else hidden++;
    if (open) for (const child of node.children) walk(child, depth + 1);
  };
  for (const node of tree.nodes) walk(node, 0);
  return { rows, hidden };
}

/** Every project, unplaced and workspace node starts expanded. */
export function initialExpanded(tree: SidebarTree): Set<string> {
  const ids = new Set<string>();
  const walk = (node: SidebarNode): void => {
    if (node.kind !== "agent") ids.add(node.id);
    for (const child of node.children) walk(child);
  };
  for (const node of tree.nodes) walk(node);
  return ids;
}
