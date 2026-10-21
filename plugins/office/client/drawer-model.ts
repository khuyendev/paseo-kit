// Drawer view-model (OFFC-15, OFFC-21, D-05): what the owner sees of one agent.
// It reads only AgentView fields and filters the snapshot; it derives nothing from names or text (D-03) and so can show no prompt, file content or absolute path.
import { CHILDREN_MAX_ITEMS, ERROR_MAX_CHARS, LABEL_MAX_CHARS, TODO_MAX_ITEMS, TODO_TEXT_MAX_CHARS } from "./limits-panels.ts";
import { agentName, providerChip, type ProviderChip } from "./names.ts";
import { AGENT_STATUS_KEY, ATTENTION_KEY, TODO_STATUS_KEY, TOOL_KEY, WORKSPACE_KIND_KEY, clipText, text, type StringKey } from "./strings.ts";
import { TOOL_KINDS, type OfficeSnapshot, type TodoStatus } from "../shared/model-types.ts";

export interface DrawerTodo {
  text: string;
  status: TodoStatus | null;
  statusKey: StringKey | null;
}

export interface DrawerChild {
  id: string;
  label: string | null;
  statusKey: StringKey | null;
}

export interface DrawerModel {
  agentId: string;
  label: string | null;
  statusKey: StringKey | null;
  toolKey: StringKey | null;
  activityKey: StringKey;
  attentionKey: StringKey | null;
  permissions: number;
  provider: string | null;
  model: string | null;
  todos: readonly DrawerTodo[];
  hiddenTodos: number;
  children: readonly DrawerChild[];
  hiddenChildren: number;
  lastError: string | null;
  // Stats (step D), each null or empty when the official data does not carry it.
  name: string;
  chip: ProviderChip | null;
  tokens: { used: number; max: number; percent: number } | null;
  workspaceName: string | null;
  workspaceKindKey: StringKey | null;
  diff: { additions: number; deletions: number } | null;
  toolCalls: readonly { key: StringKey; count: number }[];
  cost: string | null;
  age: { key: StringKey; count: number } | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function ageOf(createdAt: unknown, nowMs: number): { key: StringKey; count: number } | null {
  if (typeof createdAt !== "string" || !Number.isFinite(nowMs)) return null;
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at) || at > nowMs) return null;
  const seconds = Math.floor((nowMs - at) / 1000);
  if (seconds < 60) return { key: "ageSeconds", count: seconds };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { key: "ageMinutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { key: "ageHours", count: hours };
  return { key: "ageDays", count: Math.floor(hours / 24) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function listOf(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

function orNull(raw: unknown, max: number): string | null {
  const clipped = clipText(raw, max);
  return clipped === "" ? null : clipped;
}

function keyOf(map: Readonly<Record<string, StringKey>>, value: unknown): StringKey | null {
  return typeof value === "string" && Object.hasOwn(map, value) ? map[value]! : null;
}

function activityKeyOf(activity: unknown): StringKey {
  switch (activity) {
    case "reasoning":
      return "activityReasoning";
    case "tool":
      return "activityTool";
    case "message":
      return "activityMessage";
    default:
      return "activityNone";
  }
}

// nowMs is the wall clock of the screen, for the age; without it the age is null.
export function drawerModel(snapshot: OfficeSnapshot, agentId: string | null, nowMs: number = Number.NaN): DrawerModel | null {
  if (typeof agentId !== "string") return null;
  const agents = listOf(snapshot?.agents);
  let agent: Record<string, unknown> | null = null;
  for (const a of agents) {
    if (isRecord(a) && a.id === agentId) {
      agent = a;
      break;
    }
  }
  if (agent === null) return null;

  const todoList = listOf(agent.todos);
  const todos: DrawerTodo[] = todoList.slice(0, TODO_MAX_ITEMS).map((t) => {
    const item: Record<string, unknown> = isRecord(t) ? t : {};
    const statusKey = keyOf(TODO_STATUS_KEY, item.status);
    return { text: clipText(item.text, TODO_TEXT_MAX_CHARS), status: statusKey === null ? null : (item.status as TodoStatus), statusKey };
  });

  const children: DrawerChild[] = [];
  let childCount = 0;
  for (const a of agents) {
    if (!isRecord(a) || typeof a.id !== "string" || a.id === agentId || a.parentAgentId !== agentId) continue;
    childCount++;
    if (children.length < CHILDREN_MAX_ITEMS) children.push({ id: a.id, label: orNull(a.title, LABEL_MAX_CHARS), statusKey: keyOf(AGENT_STATUS_KEY, a.status) });
  }

  const permissions = typeof agent.pendingPermissions === "number" && Number.isFinite(agent.pendingPermissions) && agent.pendingPermissions > 0 ? Math.floor(agent.pendingPermissions) : 0;

  const used = agent.contextUsedTokens;
  const max = agent.contextMaxTokens;
  const tokens = finite(used) && finite(max) && used >= 0 && max > 0 ? { used, max, percent: Math.min(100, Math.max(0, Math.round((used * 100) / max))) } : null;
  let workspace: Record<string, unknown> | null = null;
  for (const w of listOf(snapshot?.workspaces)) {
    if (isRecord(w) && typeof agent.workspaceId === "string" && w.id === agent.workspaceId) {
      workspace = w;
      break;
    }
  }
  const diff = workspace !== null && finite(workspace.diffAdditions) && finite(workspace.diffDeletions) ? { additions: workspace.diffAdditions, deletions: workspace.diffDeletions } : null;
  const counts = isRecord(agent.toolCounts) ? agent.toolCounts : {};
  const toolCalls = TOOL_KINDS.flatMap((kind) => {
    const n = Object.hasOwn(counts, kind) ? counts[kind] : undefined;
    return finite(n) && n > 0 ? [{ key: TOOL_KEY[kind], count: Math.floor(n) }] : [];
  }).sort((a, b) => b.count - a.count);
  const cost = finite(agent.costUsd) && agent.costUsd >= 0 ? text("drawerCostValue", { value: agent.costUsd.toFixed(2) }) : null;

  return {
    agentId,
    label: orNull(agent.title, LABEL_MAX_CHARS),
    statusKey: keyOf(AGENT_STATUS_KEY, agent.status),
    toolKey: keyOf(TOOL_KEY, agent.lastTool),
    activityKey: activityKeyOf(agent.activity),
    attentionKey: agent.requiresAttention === true ? keyOf(ATTENTION_KEY, agent.attentionReason) : null,
    permissions,
    provider: orNull(agent.provider, LABEL_MAX_CHARS),
    model: orNull(agent.model, LABEL_MAX_CHARS),
    todos,
    hiddenTodos: todoList.length - todos.length,
    children,
    hiddenChildren: childCount - children.length,
    lastError: orNull(agent.lastError, ERROR_MAX_CHARS),
    name: agentName(agentId),
    chip: providerChip(agent.provider),
    tokens,
    workspaceName: workspace !== null ? orNull(workspace.name, LABEL_MAX_CHARS) : null,
    workspaceKindKey: workspace !== null ? keyOf(WORKSPACE_KIND_KEY, workspace.kind) : null,
    diff,
    toolCalls,
    cost,
    age: ageOf(agent.createdAt, nowMs),
  };
}
