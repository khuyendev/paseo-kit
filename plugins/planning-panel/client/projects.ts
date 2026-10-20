// Project picker model (PANL-20): workspaces grouped by project (archiving ones dropped); the representative is
// the main checkout (local_checkout < directory < checkout < worktree, then pinned, then name), with the other
// workspaces offered by a switcher; the 5 most recent projects per host survive surface remounts.
import { matchesTokens } from "./format.ts";

export type WorkspaceKind = "local_checkout" | "directory" | "checkout" | "worktree";

export interface RawWorkspace {
  id: string;
  projectId: string;
  projectDisplayName: string;
  projectRootPath: string;
  name: string;
  workspaceKind: WorkspaceKind;
  pinnedAt?: string | null;
  archivingAt?: string | null;
}

export interface ProjectEntry {
  id: string;
  name: string;
  rootPath: string;
  // Main checkout first, then the others in picker order.
  workspaces: RawWorkspace[];
}

export const MAX_RECENT_PROJECTS = 5;
const KIND_RANK: Record<WorkspaceKind, number> = { local_checkout: 0, directory: 1, checkout: 2, worktree: 3 };

export function compareWorkspaces(a: RawWorkspace, b: RawWorkspace): number {
  const byKind = KIND_RANK[a.workspaceKind] - KIND_RANK[b.workspaceKind];
  if (byKind !== 0) return byKind;
  if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function toProjects(raw: readonly RawWorkspace[]): ProjectEntry[] {
  const groups = new Map<string, RawWorkspace[]>();
  for (const w of raw) {
    if (w.archivingAt) continue;
    groups.set(w.projectId, [...(groups.get(w.projectId) ?? []), w]);
  }
  return [...groups.values()]
    .map((list) => {
      const workspaces = [...list].sort(compareWorkspaces);
      return { id: workspaces[0].projectId, name: workspaces[0].projectDisplayName, rootPath: workspaces[0].projectRootPath, workspaces };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function pushRecent(recent: readonly string[], projectId: string): string[] {
  return [projectId, ...recent.filter((id) => id !== projectId)].slice(0, MAX_RECENT_PROJECTS);
}

export function searchProjects(projects: readonly ProjectEntry[], query: string, recent: readonly string[]): ProjectEntry[] {
  if (query.trim()) return projects.filter((p) => matchesTokens(`${p.name} ${p.rootPath}`, query));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const first = recent.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return [...first, ...projects.filter((p) => !recent.includes(p.id))];
}

export const showPicker = (projects: readonly ProjectEntry[]) => projects.length > 1;

// Selection state kept per host outside React, so leaving and returning to the sidebar keeps it.
interface HostMemory {
  recent: string[];
  projectId: string | null;
  workspaceId: string | null;
}
const memory = new Map<string, HostMemory>();

export function hostMemory(hostId: string): HostMemory {
  let m = memory.get(hostId);
  if (!m) {
    m = { recent: [], projectId: null, workspaceId: null };
    memory.set(hostId, m);
  }
  return m;
}

export function rememberSelection(hostId: string, projectId: string, workspaceId: string): HostMemory {
  const m = hostMemory(hostId);
  m.recent = pushRecent(m.recent, projectId);
  m.projectId = projectId;
  m.workspaceId = workspaceId;
  return m;
}

// The workspace to show: the remembered one when it still belongs to the project, else the main checkout.
export function chosenWorkspace(project: ProjectEntry, remembered: string | null): RawWorkspace {
  return project.workspaces.find((w) => w.id === remembered) ?? project.workspaces[0];
}
