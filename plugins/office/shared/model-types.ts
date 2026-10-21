// Office model types (OFFC-06, OFFC-21): plain data shared by the store (07-06) and the panels (07-10).
// No Node or React import. Invariant 07-06 enforces: drawnAgents plus every surplusAgents equals totalAgents.
// Agent-provided strings (title, lastError, todo text) are shown as Text only, never in a uri or style (OFFC-14).
// Neither 07-06 nor 07-10 may add a field without a shared_changes request to the owner of this file.

export const AGENT_STATUSES = ["initializing", "idle", "running", "error", "closed"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const ATTENTION_REASONS = ["finished", "error", "permission"] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export const TOOL_KINDS = ["shell", "read", "edit", "write", "search", "fetch", "worktree_setup", "sub_agent", "plain_text", "plan", "unknown"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const WORKSPACE_STATUSES = ["needs_input", "failed", "running", "attention", "done"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const WORKSPACE_KINDS = ["directory", "local_checkout", "checkout", "worktree"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoView {
  text: string;
  status: TodoStatus;
}

export interface AgentView {
  id: string;
  title: string | null;
  projectId: string | null;
  workspaceId: string | null;
  parentAgentId: string | null;
  status: AgentStatus;
  requiresAttention: boolean;
  attentionReason: AttentionReason | null;
  pendingPermissions: number;
  provider: string | null;
  model: string | null;
  contextUsedTokens: number | null;
  contextMaxTokens: number | null;
  lastError: string | null;
  lastTool: ToolKind | null;
  activity: "reasoning" | "tool" | "message" | null;
  todos: readonly TodoView[];
  // Value of the harness.run label.
  runId: string | null;
  updatedAt: string | null;
}

export interface ProjectView {
  id: string;
  name: string;
}

export interface WorkspaceView {
  id: string;
  projectId: string;
  name: string;
  kind: WorkspaceKind | null;
  status: WorkspaceStatus;
  diffAdditions: number | null;
  diffDeletions: number | null;
}

export interface OfficeSnapshot {
  projects: readonly ProjectView[];
  workspaces: readonly WorkspaceView[];
  agents: readonly AgentView[];
}

export interface DrawnAgent {
  agentId: string;
  parentId: string | null;
  isChild: boolean;
}

export interface ClusterModel {
  workspaceId: string;
  name: string;
  status: WorkspaceStatus;
  kind: WorkspaceKind | null;
  diffAdditions: number | null;
  diffDeletions: number | null;
  drawn: readonly DrawnAgent[];
  // Agents of the workspace beyond the per-cluster cap.
  surplusAgents: number;
}

export interface RoomModel {
  projectId: string;
  name: string;
  clusters: readonly ClusterModel[];
  // Agents of the clusters beyond the cluster cap.
  surplusAgents: number;
}

export interface BuildingModel {
  rooms: readonly RoomModel[];
  // Agents of the rooms beyond the room cap.
  surplusAgents: number;
  totalAgents: number;
  drawnAgents: number;
}
