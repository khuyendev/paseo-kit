// Building model (OFFC-06, OFFC-12, D-04): OfficeSnapshot in, rooms, clusters and drawn agents out, with named caps and exact "+N" accounting.
// Pure and deterministic: plain string comparison (never a locale one), no React, no SDK, no timer, no Node API.
import type { AgentView, BuildingModel, ClusterModel, DrawnAgent, OfficeSnapshot, ProjectView, RoomModel, WorkspaceStatus, WorkspaceView } from "../shared/model-types.ts";
import { AGENTS_PER_CLUSTER_MAX, CLUSTERS_PER_ROOM_MAX, MAX_DRAWN_CHARACTERS, ROOMS_PER_BUILDING_MAX } from "./limits.ts";

export interface BuildCaps {
  agentsPerCluster: number;
  clustersPerRoom: number;
  roomsPerBuilding: number;
  maxDrawn: number;
}

export type LightState = "waiting" | "failed" | "active" | "alert" | "idle";

export function workspaceLight(status: WorkspaceStatus): LightState {
  switch (status) {
    case "needs_input":
      return "waiting";
    case "failed":
      return "failed";
    case "running":
      return "active";
    case "attention":
      return "alert";
    case "done":
      return "idle";
  }
}

interface ClusterDraft {
  workspace: WorkspaceView;
  agents: AgentView[];
  running: number;
}

interface RoomDraft {
  projectId: string;
  name: string;
  clusters: ClusterDraft[];
  agentCount: number;
  running: number;
}

interface Candidate {
  agent: AgentView;
  isChild: boolean;
  running: boolean;
  roomIndex: number;
  clusterIndex: number;
}

function compareText(aName: string, aId: string, bName: string, bId: string): number {
  const an = aName.toLowerCase();
  const bn = bName.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  if (aId !== bId) return aId < bId ? -1 : 1;
  return 0;
}

// Cut order: rooms or clusters with running agents first, then with more agents, then name and id.
function rank(a: { running: number; count: number; name: string; id: string }, b: { running: number; count: number; name: string; id: string }): number {
  if (a.running !== b.running) return b.running - a.running;
  if (a.count !== b.count) return b.count - a.count;
  return compareText(a.name, a.id, b.name, b.id);
}

// Brain before child, running before others.
function tuple(a: Candidate, b: Candidate): number {
  if (a.isChild !== b.isChild) return a.isChild ? 1 : -1;
  if (a.running !== b.running) return a.running ? -1 : 1;
  return a.agent.id < b.agent.id ? -1 : a.agent.id > b.agent.id ? 1 : 0;
}

function checkCaps(caps: BuildCaps): void {
  for (const [name, value] of Object.entries(caps)) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(name);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const listOf = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

// The project of an agent: its joined projectId, else the project of its workspace, else null.
export function projectOfAgent(agent: unknown, workspaceProject: ReadonlyMap<string, string>): string | null {
  if (!isRecord(agent)) return null;
  if (typeof agent.projectId === "string") return agent.projectId;
  return typeof agent.workspaceId === "string" ? (workspaceProject.get(agent.workspaceId) ?? null) : null;
}

export function workspaceProjects(snapshot: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of listOf(isRecord(snapshot) ? snapshot.workspaces : null)) {
    if (isRecord(w) && typeof w.id === "string" && typeof w.projectId === "string" && !out.has(w.id)) out.set(w.id, w.projectId);
  }
  return out;
}

// The snapshot without the hidden projects, their workspaces and their agents; agents of no project stay. The same object comes back
// when no hidden id names a project of the snapshot, so a stale hidden id costs nothing (sidebar checkboxes, D-04).
export function visibleSnapshot(snapshot: OfficeSnapshot, hidden: ReadonlySet<string> | null | undefined): OfficeSnapshot {
  if (!isRecord(snapshot)) return { projects: [], workspaces: [], agents: [] };
  const projects = listOf(snapshot.projects) as OfficeSnapshot["projects"];
  const workspaces = listOf(snapshot.workspaces) as OfficeSnapshot["workspaces"];
  const agents = listOf(snapshot.agents) as OfficeSnapshot["agents"];
  const departing = listOf(snapshot.departing) as OfficeSnapshot["agents"];
  if (!(hidden instanceof Set) || hidden.size === 0) return snapshot;
  const byWorkspace = workspaceProjects(snapshot);
  const named = new Set<string>();
  for (const p of projects) if (isRecord(p) && typeof p.id === "string") named.add(p.id);
  for (const project of byWorkspace.values()) named.add(project);
  if (![...hidden].some((id) => named.has(id))) return snapshot;
  const keep = (a: unknown): boolean => {
    const project = projectOfAgent(a, byWorkspace);
    return project === null || !hidden.has(project);
  };
  return {
    projects: projects.filter((p) => !(isRecord(p) && typeof p.id === "string" && hidden.has(p.id))),
    workspaces: workspaces.filter((w) => !(isRecord(w) && typeof w.projectId === "string" && hidden.has(w.projectId))),
    agents: agents.filter(keep),
    departing: departing.filter(keep),
  };
}

// Hidden projects are filtered here, before any cap, so layout, caps, "+N" groups and the life director see visible projects only.
export function buildModel(input: OfficeSnapshot, partial: Partial<BuildCaps> = {}, hidden: ReadonlySet<string> | null = null): BuildingModel {
  const snapshot = visibleSnapshot(input, hidden);
  const caps: BuildCaps = {
    agentsPerCluster: partial.agentsPerCluster ?? AGENTS_PER_CLUSTER_MAX,
    clustersPerRoom: partial.clustersPerRoom ?? CLUSTERS_PER_ROOM_MAX,
    roomsPerBuilding: partial.roomsPerBuilding ?? ROOMS_PER_BUILDING_MAX,
    maxDrawn: partial.maxDrawn ?? MAX_DRAWN_CHARACTERS,
  };
  checkCaps(caps);

  // 1. A second occurrence of an id is ignored.
  const projects = new Map<string, ProjectView>();
  for (const p of snapshot.projects) if (!projects.has(p.id)) projects.set(p.id, p);
  const workspaces = new Map<string, WorkspaceView>();
  for (const w of snapshot.workspaces) if (!workspaces.has(w.id)) workspaces.set(w.id, w);
  // Departing agents (tombstones) keep their seat until the scene releases them; a live agent of the same id wins.
  const agents = new Map<string, AgentView>();
  for (const a of snapshot.agents) if (!agents.has(a.id)) agents.set(a.id, a);
  for (const a of listOf(snapshot.departing) as readonly AgentView[]) if (isRecord(a) && typeof a.id === "string" && !agents.has(a.id)) agents.set(a.id, a);

  // 2. Placed agents are those whose workspace is listed; the others stay out of the model and out of totalAgents.
  const byWorkspace = new Map<string, AgentView[]>();
  let totalAgents = 0;
  for (const a of agents.values()) {
    if (a.workspaceId === null || !workspaces.has(a.workspaceId)) continue;
    const list = byWorkspace.get(a.workspaceId) ?? [];
    list.push(a);
    byWorkspace.set(a.workspaceId, list);
    totalAgents++;
  }

  // 3. One room per project, plus one for a project named only by a workspace; a project without workspaces is an empty room.
  const rooms = new Map<string, RoomDraft>();
  for (const p of projects.values()) rooms.set(p.id, { projectId: p.id, name: p.name, clusters: [], agentCount: 0, running: 0 });
  for (const w of workspaces.values()) {
    let room = rooms.get(w.projectId);
    if (room === undefined) {
      room = { projectId: w.projectId, name: w.projectId, clusters: [], agentCount: 0, running: 0 };
      rooms.set(w.projectId, room);
    }
    const members = byWorkspace.get(w.id) ?? [];
    const running = members.filter((a) => a.status === "running").length;
    room.clusters.push({ workspace: w, agents: members, running });
    room.agentCount += members.length;
    room.running += running;
  }

  // 4. Cut rooms, then clusters; the kept ones are listed by name and id.
  let buildingSurplus = 0;
  const roomRank = [...rooms.values()].sort((a, b) => rank({ running: a.running, count: a.agentCount, name: a.name, id: a.projectId }, { running: b.running, count: b.agentCount, name: b.name, id: b.projectId }));
  const keptRooms = roomRank.slice(0, caps.roomsPerBuilding);
  for (const cut of roomRank.slice(caps.roomsPerBuilding)) buildingSurplus += cut.agentCount;
  keptRooms.sort((a, b) => compareText(a.name, a.projectId, b.name, b.projectId));

  const roomSurplus: number[] = [];
  const keptClusters: ClusterDraft[][] = [];
  for (const room of keptRooms) {
    const clusterRank = [...room.clusters].sort((a, b) => rank({ running: a.running, count: a.agents.length, name: a.workspace.name, id: a.workspace.id }, { running: b.running, count: b.agents.length, name: b.workspace.name, id: b.workspace.id }));
    const kept = clusterRank.slice(0, caps.clustersPerRoom);
    let cutAgents = 0;
    for (const cut of clusterRank.slice(caps.clustersPerRoom)) cutAgents += cut.agents.length;
    kept.sort((a, b) => compareText(a.workspace.name, a.workspace.id, b.workspace.name, b.workspace.id));
    keptClusters.push(kept);
    roomSurplus.push(cutAgents);
  }

  // 5. Per cluster keep the first agentsPerCluster candidates.
  const perCluster: Candidate[][][] = keptClusters.map((clusters, roomIndex) =>
    clusters.map((cluster, clusterIndex) =>
      cluster.agents
        .map((agent): Candidate => ({ agent, isChild: agent.parentAgentId !== null, running: agent.status === "running", roomIndex, clusterIndex }))
        .sort(tuple)
        .slice(0, caps.agentsPerCluster),
    ),
  );

  // 6. Pool the kept candidates; when the pool exceeds maxDrawn brains survive before children, running before others, building wide.
  const pool = perCluster.flat(2);
  const survivors = new Set<Candidate>(pool);
  if (pool.length > caps.maxDrawn) {
    const ordered = [...pool].sort((a, b) => {
      if (a.isChild !== b.isChild) return a.isChild ? 1 : -1;
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (a.roomIndex !== b.roomIndex) return a.roomIndex - b.roomIndex;
      if (a.clusterIndex !== b.clusterIndex) return a.clusterIndex - b.clusterIndex;
      return a.agent.id < b.agent.id ? -1 : a.agent.id > b.agent.id ? 1 : 0;
    });
    survivors.clear();
    for (const c of ordered.slice(0, caps.maxDrawn)) survivors.add(c);
  }

  // 7. A parent link is kept only for a parent that is drawn in the same room; one hop, so a cycle is harmless.
  let drawnAgents = 0;
  const builtRooms: RoomModel[] = keptRooms.map((room, roomIndex) => {
    const drawnIds = new Set<string>();
    for (const cluster of perCluster[roomIndex] ?? []) for (const c of cluster) if (survivors.has(c)) drawnIds.add(c.agent.id);
    const clusters: ClusterModel[] = (keptClusters[roomIndex] ?? []).map((draft, clusterIndex) => {
      const drawn: DrawnAgent[] = (perCluster[roomIndex]?.[clusterIndex] ?? [])
        .filter((c) => survivors.has(c))
        .map((c) => {
          const parent = c.agent.parentAgentId;
          return { agentId: c.agent.id, parentId: parent !== null && parent !== c.agent.id && drawnIds.has(parent) ? parent : null, isChild: c.isChild };
        });
      drawnAgents += drawn.length;
      const w = draft.workspace;
      return {
        workspaceId: w.id,
        name: w.name,
        status: w.status,
        kind: w.kind,
        diffAdditions: w.diffAdditions,
        diffDeletions: w.diffDeletions,
        drawn,
        surplusAgents: draft.agents.length - drawn.length,
      };
    });
    return { projectId: room.projectId, name: room.name, clusters, surplusAgents: roomSurplus[roomIndex] ?? 0 };
  });

  // 8. Invariant: drawnAgents plus every surplusAgents equals totalAgents.
  return { rooms: builtRooms, surplusAgents: buildingSurplus, totalAgents, drawnAgents };
}

// The drawn child, its drawn parent, the room and the workspace; null when no walk can be drawn (OFFC-12).
export function resolveHandoff(
  model: BuildingModel,
  handoff: { childId: string; parentId: string },
): { childId: string; parentId: string; projectId: string; workspaceId: string } | null {
  for (const room of model.rooms) {
    for (const cluster of room.clusters) {
      const child = cluster.drawn.find((d) => d.agentId === handoff.childId);
      if (child === undefined) continue;
      if (!child.isChild || child.parentId === null || child.parentId !== handoff.parentId) return null;
      return { childId: child.agentId, parentId: child.parentId, projectId: room.projectId, workspaceId: cluster.workspaceId };
    }
  }
  return null;
}
