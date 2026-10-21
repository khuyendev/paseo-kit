// The single English table of every user-visible text of the panels and the scene (OFFC-19, D-08).
// Components and view-models hold no user-visible literal; a Vietnamese table can replace STRINGS without a code change.
import type { AgentStatus, AttentionReason, TodoStatus, ToolKind, WorkspaceKind, WorkspaceStatus } from "../shared/model-types.ts";

export const STRINGS = {
  sidebarTitle: "Office",
  sidebarEmpty: "No projects yet",
  sidebarBuilding: "All projects",
  sidebarUnplaced: "Not in a session",
  sidebarMoreRows: "+{count} more",
  sidebarUntitledAgent: "Untitled agent",
  sidebarUnnamedProject: "Unnamed project",
  sidebarUnnamedWorkspace: "Unnamed session",
  sidebarChildBadge: "child",
  sidebarNotDrawn: "not drawn",
  sidebarGlyphOpen: "-",
  sidebarGlyphClosed: "+",
  sidebarExpand: "Expand",
  sidebarCollapse: "Collapse",
  statusInitializing: "Starting",
  statusIdle: "Idle",
  statusRunning: "Working",
  statusError: "Error",
  statusClosed: "Closed",
  workspaceNeedsInput: "Needs input",
  workspaceFailed: "Failed",
  workspaceRunning: "Running",
  workspaceAttention: "Attention",
  workspaceDone: "Done",
  kindDirectory: "Directory",
  kindLocalCheckout: "Local checkout",
  kindCheckout: "Checkout",
  kindWorktree: "Worktree",
  attentionFinished: "Finished, waiting for you",
  attentionError: "Stopped with an error",
  attentionPermission: "Waiting for permission",
  toolShell: "Shell command",
  toolRead: "Reading",
  toolEdit: "Editing",
  toolWrite: "Writing",
  toolSearch: "Searching",
  toolFetch: "Fetching",
  toolWorktreeSetup: "Setting up a worktree",
  toolSubAgent: "Sub-agent",
  toolPlainText: "Text",
  toolPlan: "Planning",
  toolUnknown: "Working",
  activityReasoning: "Thinking",
  activityTool: "Using a tool",
  activityMessage: "Writing a reply",
  activityNone: "Nothing yet",
  todoPending: "Pending",
  todoInProgress: "In progress",
  todoCompleted: "Completed",
  drawerClose: "Close",
  drawerSectionActivity: "Activity",
  drawerSectionTodos: "Todos",
  drawerSectionChildren: "Child agents",
  drawerSectionError: "Last error",
  drawerSectionDetails: "Details",
  drawerNoTodos: "No todos",
  drawerNoChildren: "No child agents",
  drawerNoError: "No error",
  drawerUntitled: "Untitled agent",
  drawerStatus: "State",
  drawerTool: "Tool",
  drawerAttention: "Attention",
  drawerPermissions: "Pending permissions",
  drawerProvider: "Provider",
  drawerModel: "Model",
  drawerMoreItems: "+{count} more",
  counterRunning: "Working",
  counterAttention: "Needs you",
  counterError: "Errors",
  counterIdle: "Idle",
  counterInitializing: "Starting",
  counterClosed: "Closed",
  counterTotal: "Agents",
  contextLabel: "Context",
  contextPercent: "{percent}%",
  contextTokens: "{used} of {max} tokens",
  contextHigh: "High context",
  usageSlotLabel: "Provider usage",
  // The last seven are consumed by the scene and the screen of 07-11.
  sceneSurplus: "+{count} agents",
  sceneDiff: "+{additions} -{deletions}",
  sceneZoomIn: "Zoom in",
  sceneZoomOut: "Zoom out",
  sceneZoomLevel: "{zoom}x",
  screenLoading: "Loading projects",
  screenFailed: "Could not read your projects",
} as const;

export type StringKey = keyof typeof STRINGS;

/** Replaces each {name} token whose name is an own key of params, in one left-to-right pass; other tokens stay. Never throws. */
export function text(key: StringKey, params?: Readonly<Record<string, string | number>>): string {
  const template: string = Object.hasOwn(STRINGS, key) ? STRINGS[key] : "";
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (token: string, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : token));
}

const ELLIPSIS = "…";

/** Agent-provided text for display: not a string gives ""; control and whitespace runs become one space; cut to max characters with an ellipsis. */
export function clipText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const flat = raw.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, Math.max(0, max - 1)) + ELLIPSIS;
}

export const AGENT_STATUS_KEY: Record<AgentStatus, StringKey> = {
  initializing: "statusInitializing",
  idle: "statusIdle",
  running: "statusRunning",
  error: "statusError",
  closed: "statusClosed",
};

export const WORKSPACE_STATUS_KEY: Record<WorkspaceStatus, StringKey> = {
  needs_input: "workspaceNeedsInput",
  failed: "workspaceFailed",
  running: "workspaceRunning",
  attention: "workspaceAttention",
  done: "workspaceDone",
};

export const WORKSPACE_KIND_KEY: Record<WorkspaceKind, StringKey> = {
  directory: "kindDirectory",
  local_checkout: "kindLocalCheckout",
  checkout: "kindCheckout",
  worktree: "kindWorktree",
};

export const ATTENTION_KEY: Record<AttentionReason, StringKey> = {
  finished: "attentionFinished",
  error: "attentionError",
  permission: "attentionPermission",
};

export const TOOL_KEY: Record<ToolKind, StringKey> = {
  shell: "toolShell",
  read: "toolRead",
  edit: "toolEdit",
  write: "toolWrite",
  search: "toolSearch",
  fetch: "toolFetch",
  worktree_setup: "toolWorktreeSetup",
  sub_agent: "toolSubAgent",
  plain_text: "toolPlainText",
  plan: "toolPlan",
  unknown: "toolUnknown",
};

export const TODO_STATUS_KEY: Record<TodoStatus, StringKey> = {
  pending: "todoPending",
  in_progress: "todoInProgress",
  completed: "todoCompleted",
};
