// Office store (OFFC-05, OFFC-12, OFFC-21): the official Paseo API in, one OfficeSnapshot out. Pushed, never polled (D-03); read-only (D-09).
// This part is pure: normalizers, timeline derivation, the reducer with the exactly-once handoff and the snapshot join.
// The effect part (createStore) is below. No React, no SDK runtime, no timer, no file or Node API.
import type { PaseoApi } from "@getpaseo/client";
import {
  AGENT_STATUSES,
  ATTENTION_REASONS,
  SHELL_STATUSES,
  TODO_STATUSES,
  TOOL_KINDS,
  WORKSPACE_KINDS,
  WORKSPACE_STATUSES,
  type AgentStatus,
  type AgentView,
  type AttentionReason,
  type OfficeSnapshot,
  type ProjectView,
  type ShellStatus,
  type ShellView,
  type TodoStatus,
  type TodoView,
  type ToolKind,
  type WorkspaceKind,
  type WorkspaceStatus,
  type WorkspaceView,
} from "../shared/model-types.ts";
import {
  DEPARTING_MAX,
  ERROR_MAX_CHARS,
  HANDOFF_QUEUE_MAX,
  ID_MAX_CHARS,
  LIST_PAGES_MAX,
  LIST_PAGE_LIMIT,
  NAME_MAX_CHARS,
  PENDING_PERMISSIONS_MAX,
  SHELL_COMMAND_MAX_CHARS,
  STORE_ENTRIES_MAX,
  TIMELINE_SUBSCRIPTIONS_MAX,
  TIMELINE_TAIL_LIMIT,
  TIMELINE_TODO_PAGES_MAX,
  TIMELINE_TODO_PAGE_LIMIT,
  TIME_TEXT_MAX_CHARS,
  TITLE_MAX_CHARS,
  TODOS_PER_AGENT_MAX,
  TODO_TEXT_MAX_CHARS,
  TOOL_CALLS_WINDOW_MAX,
} from "./limits.ts";

// Defined here because the protocol package is not imported into the bundle.
export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
export const RUN_LABEL = "harness.run";

export type HandoffSignal = "status" | "finished";
// Evidence from 07-SPIKE.md: none observed. SPIKE_WAIVER records "Update log: not captured" (the owner waived the D-12 measurement), so
// the default of assumption A17 holds: a child's finished turn is its status going from running to idle.
export const HANDOFF_SIGNAL: HandoffSignal = "status";

export interface Handoff {
  seq: number;
  childId: string;
  parentId: string;
}

export type AgentBase = Omit<AgentView, "projectId" | "lastTool" | "activity" | "todos" | "shell" | "toolCounts">;

export interface WorkspaceRecord extends WorkspaceView {
  projectDisplayName: string | null;
}

// How the todo read of an agent went: ok when no read failed and no older scan hit the page cap; failed or capped otherwise.
export type TodoScan = "ok" | "failed" | "capped";

export interface TimelineDerived {
  lastTool: ToolKind | null;
  activity: "reasoning" | "tool" | "message" | null;
  todos: readonly TodoView[];
  // Store-internal: true once a todo item was applied (live, tail or older history).
  todoSeen: boolean;
  todoScan: TodoScan;
  lastError: string | null;
  // The latest shell call (it outlives the turn, so an idle agent can wait on it).
  shell: ShellView | null;
  // Distinct tool call ids seen, with their kind, in arrival order, bounded by TOOL_CALLS_WINDOW_MAX.
  calls: ReadonlyMap<string, ToolKind>;
}

export interface StoreLimits {
  storeEntriesMax: number;
  handoffQueueMax: number;
  listPageLimit: number;
  listPagesMax: number;
  timelineSubscriptionsMax: number;
  timelineTailLimit: number;
  timelinePageLimit: number;
  timelinePagesMax: number;
}

export const DEFAULT_STORE_LIMITS: StoreLimits = {
  storeEntriesMax: STORE_ENTRIES_MAX,
  handoffQueueMax: HANDOFF_QUEUE_MAX,
  listPageLimit: LIST_PAGE_LIMIT,
  listPagesMax: LIST_PAGES_MAX,
  timelineSubscriptionsMax: TIMELINE_SUBSCRIPTIONS_MAX,
  timelineTailLimit: TIMELINE_TAIL_LIMIT,
  timelinePageLimit: TIMELINE_TODO_PAGE_LIMIT,
  timelinePagesMax: TIMELINE_TODO_PAGES_MAX,
};

export interface ReduceOptions {
  handoffSignal?: HandoffSignal;
  limits?: Partial<StoreLimits>;
}

export interface StoreState {
  agents: ReadonlyMap<string, AgentBase>;
  derived: ReadonlyMap<string, TimelineDerived>;
  workspaces: ReadonlyMap<string, WorkspaceRecord>;
  projects: ReadonlyMap<string, ProjectView>;
  // Archived or removed agents kept as tombstones until the scene has walked them out (released by "departed.release").
  departing: ReadonlyMap<string, AgentBase>;
  // Agents seen running whose finished turn has not fired a handoff yet.
  armed: ReadonlySet<string>;
  handoffs: readonly Handoff[];
  nextSeq: number;
  selectedAgentId: string | null;
  version: number;
}

export type StoreAction =
  | { type: "agents.seed"; entries: unknown }
  | { type: "workspaces.seed"; entries: unknown }
  | { type: "projects.seed"; projects: unknown }
  | { type: "agent.update"; payload: unknown }
  | { type: "workspace.update"; payload: unknown }
  | { type: "project.update"; payload: unknown }
  | { type: "timeline.event"; agentId: string; event: unknown }
  | { type: "timeline.tail"; agentId: string; entries: unknown }
  | { type: "timeline.older"; agentId: string; entries: unknown }
  | { type: "timeline.reset"; agentId: string }
  | { type: "timeline.scan"; agentId: string; scan: TodoScan }
  | { type: "select"; agentId: string | null }
  | { type: "handoffs.take"; upToSeq: number }
  | { type: "departed.release"; ids: unknown };

// ---------- helpers ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(rec: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}

// Removes control characters (below 32 and 127), trims and cuts; an empty result is null.
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (text.length === 0) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function idOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= ID_MAX_CHARS ? v : null;
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function shallowEqual(a: object, b: object): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

// Plain string comparison, never a locale one, so output does not depend on the host.
function less(aName: string, aId: string, bName: string, bId: string): number {
  const an = aName.toLowerCase();
  const bn = bName.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  if (aId !== bId) return aId < bId ? -1 : 1;
  return 0;
}

// ---------- normalizers (never throw) ----------

// AgentBase, the string "archived" when archivedAt is set, or null when the payload is unreadable. Only the listed fields are read;
// cwd, prompts and every unlisted field are never copied (OFFC-15, T-07-64).
export function normalizeAgent(payload: unknown): AgentBase | "archived" | null {
  if (!isRecord(payload)) return null;
  const id = idOf(own(payload, "id"));
  if (id === null) return null;
  const archivedAt = own(payload, "archivedAt");
  if (archivedAt !== undefined && archivedAt !== null && archivedAt !== "") return "archived";
  const status = oneOf<AgentStatus>(AGENT_STATUSES, own(payload, "status"));
  if (status === null) return null;
  const labelsRaw = own(payload, "labels");
  const labels = isRecord(labelsRaw) ? labelsRaw : null;
  let parentAgentId = labels ? idOf(own(labels, PARENT_AGENT_ID_LABEL)) : null;
  if (parentAgentId === id) parentAgentId = null;
  const usageRaw = own(payload, "lastUsage");
  const usage = isRecord(usageRaw) ? usageRaw : null;
  const used = usage ? finite(own(usage, "contextWindowUsedTokens")) : null;
  const max = usage ? finite(own(usage, "contextWindowMaxTokens")) : null;
  const cost = usage ? finite(own(usage, "totalCostUsd")) : null;
  const permissions = own(payload, "pendingPermissions");
  return {
    id,
    title: clean(own(payload, "title"), TITLE_MAX_CHARS),
    workspaceId: idOf(own(payload, "workspaceId")),
    parentAgentId,
    status,
    requiresAttention: own(payload, "requiresAttention") === true,
    attentionReason: oneOf<AttentionReason>(ATTENTION_REASONS, own(payload, "attentionReason")),
    pendingPermissions: Array.isArray(permissions) ? Math.min(permissions.length, PENDING_PERMISSIONS_MAX) : 0,
    provider: clean(own(payload, "provider"), NAME_MAX_CHARS),
    model: clean(own(payload, "model"), NAME_MAX_CHARS),
    contextUsedTokens: used !== null && used >= 0 ? used : null,
    contextMaxTokens: max !== null && max > 0 ? max : null,
    costUsd: cost !== null && cost >= 0 ? cost : null,
    lastError: clean(own(payload, "lastError"), ERROR_MAX_CHARS),
    runId: labels ? clean(own(labels, RUN_LABEL), NAME_MAX_CHARS) : null,
    updatedAt: clean(own(payload, "updatedAt"), TIME_TEXT_MAX_CHARS),
    createdAt: clean(own(payload, "createdAt"), TIME_TEXT_MAX_CHARS),
  };
}

// The workspace plus the project display name the snapshot join uses when the project list lacks the project.
export function normalizeWorkspace(payload: unknown): WorkspaceRecord | null {
  if (!isRecord(payload)) return null;
  const id = idOf(own(payload, "id"));
  const projectId = idOf(own(payload, "projectId"));
  const status = oneOf<WorkspaceStatus>(WORKSPACE_STATUSES, own(payload, "status"));
  if (id === null || projectId === null || status === null) return null;
  const diffRaw = own(payload, "diffStat");
  const diff = isRecord(diffRaw) ? diffRaw : null;
  return {
    id,
    projectId,
    name: clean(own(payload, "name"), NAME_MAX_CHARS) ?? id,
    kind: oneOf<WorkspaceKind>(WORKSPACE_KINDS, own(payload, "workspaceKind")),
    status,
    diffAdditions: diff ? finite(own(diff, "additions")) : null,
    diffDeletions: diff ? finite(own(diff, "deletions")) : null,
    projectDisplayName: clean(own(payload, "projectDisplayName"), NAME_MAX_CHARS),
  };
}

export function normalizeProject(payload: unknown): ProjectView | null {
  if (!isRecord(payload)) return null;
  const id = idOf(own(payload, "projectId"));
  if (id === null) return null;
  return { id, name: clean(own(payload, "projectDisplayName"), NAME_MAX_CHARS) ?? id };
}

// ---------- timeline derivation ----------

export const EMPTY_DERIVED: TimelineDerived = { lastTool: null, activity: null, todos: [], todoSeen: false, todoScan: "ok", lastError: null, shell: null, calls: new Map() };

function todosOf(items: unknown): TodoView[] {
  const out: TodoView[] = [];
  if (!Array.isArray(items)) return out;
  for (const raw of items) {
    if (out.length >= TODOS_PER_AGENT_MAX) break;
    if (!isRecord(raw)) continue;
    const text = clean(raw.text, TODO_TEXT_MAX_CHARS);
    if (text === null) continue;
    const status: TodoStatus = oneOf<TodoStatus>(TODO_STATUSES, raw.status) ?? (raw.completed === true ? "completed" : "pending");
    out.push({ text, status });
  }
  return out;
}

function sameTodos(a: readonly TodoView[], b: readonly TodoView[]): boolean {
  return a.length === b.length && a.every((t, i) => t.text === b[i]?.text && t.status === b[i]?.status);
}

const sameShell = (a: ShellView | null, b: ShellView | null): boolean => a === b || (a !== null && b !== null && a.callId === b.callId && a.status === b.status && a.command === b.command);

function withDerived(prev: TimelineDerived, next: TimelineDerived): TimelineDerived {
  const same =
    prev.lastTool === next.lastTool && prev.activity === next.activity && prev.todoSeen === next.todoSeen && prev.todoScan === next.todoScan && prev.lastError === next.lastError && sameTodos(prev.todos, next.todos) && sameShell(prev.shell, next.shell) && prev.calls === next.calls;
  return same ? prev : next;
}

// The call window with one more distinct id; the same map when the id is known or absent.
function withCall(calls: ReadonlyMap<string, ToolKind>, callId: string | null, kind: ToolKind): ReadonlyMap<string, ToolKind> {
  if (callId === null || calls.has(callId)) return calls;
  const next = new Map(calls);
  next.set(callId, kind);
  for (const id of next.keys()) {
    if (next.size <= TOOL_CALLS_WINDOW_MAX) break;
    next.delete(id);
  }
  return next;
}

// The latest shell call after one shell tool_call item: an update of the same call keeps its command when the update has none.
function withShell(prev: ShellView | null, callId: string | null, detail: Record<string, unknown> | null, status: unknown): ShellView | null {
  if (callId === null) return prev;
  const command = detail ? clean(detail.command, SHELL_COMMAND_MAX_CHARS) : null;
  const shellStatus = oneOf<ShellStatus>(SHELL_STATUSES, status);
  if (prev !== null && prev.callId === callId) return { callId, status: shellStatus, command: command ?? prev.command };
  return { callId, status: shellStatus, command };
}

// Tool kind comes from the typed detail only; anything else is unknown. No tool-name table (OFFC-05, D-03).
export function deriveTimeline(prev: TimelineDerived, event: unknown): TimelineDerived {
  if (!isRecord(event)) return prev;
  if (event.type === "turn_started") return withDerived(prev, { ...prev, lastTool: null, activity: null });
  if (event.type !== "timeline" || !isRecord(event.item)) return prev;
  const item = event.item;
  switch (item.type) {
    case "tool_call": {
      const detail = isRecord(item.detail) ? item.detail : null;
      const kind = detail ? oneOf<ToolKind>(TOOL_KINDS, detail.type) : null;
      const callId = idOf(item.callId);
      const shell = kind === "shell" ? withShell(prev.shell, callId, detail, item.status) : prev.shell;
      return withDerived(prev, { ...prev, lastTool: kind ?? "unknown", activity: "tool", shell, calls: withCall(prev.calls, callId, kind ?? "unknown") });
    }
    case "reasoning":
      return withDerived(prev, { ...prev, activity: "reasoning" });
    case "assistant_message":
    case "user_message":
      return withDerived(prev, { ...prev, activity: "message" });
    case "todo":
      return withDerived(prev, { ...prev, todos: todosOf(item.items), todoSeen: true });
    case "error": {
      const message = clean(item.message, ERROR_MAX_CHARS);
      return message === null ? prev : withDerived(prev, { ...prev, lastError: message });
    }
    default:
      return prev;
  }
}

// ---------- reducer ----------

export function emptyState(): StoreState {
  return {
    agents: new Map(),
    derived: new Map(),
    workspaces: new Map(),
    projects: new Map(),
    departing: new Map(),
    armed: new Set(),
    handoffs: [],
    nextSeq: 1,
    selectedAgentId: null,
    version: 0,
  };
}

function bump(state: StoreState, patch: Partial<StoreState>): StoreState {
  return { ...state, ...patch, version: state.version + 1 };
}

function limitsOf(options: ReduceOptions | undefined): StoreLimits {
  return { ...DEFAULT_STORE_LIMITS, ...(options?.limits ?? {}) };
}

function entriesOf(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function numericSeq(entry: unknown): number {
  return isRecord(entry) && typeof entry.seqStart === "number" && Number.isFinite(entry.seqStart) ? entry.seqStart : 0;
}

// A tombstone set with the agent as the newest entry, the oldest dropped beyond DEPARTING_MAX.
function withDeparting(departing: ReadonlyMap<string, AgentBase>, base: AgentBase): Map<string, AgentBase> {
  const next = new Map(departing);
  next.delete(base.id);
  next.set(base.id, base);
  for (const id of next.keys()) {
    if (next.size <= DEPARTING_MAX) break;
    next.delete(id);
  }
  return next;
}

function withoutAgent(state: StoreState, id: string): StoreState {
  const base = state.agents.get(id);
  if (base === undefined) return state;
  const agents = new Map(state.agents);
  agents.delete(id);
  const departing = withDeparting(state.departing, base);
  const derived = new Map(state.derived);
  derived.delete(id);
  const armed = new Set(state.armed);
  armed.delete(id);
  return bump(state, { agents, derived, armed, departing });
}

function seedAgents(state: StoreState, raw: unknown, limits: StoreLimits): StoreState {
  const agents = new Map<string, AgentBase>();
  for (const entry of entriesOf(raw)) {
    if (agents.size >= limits.storeEntriesMax) break;
    const base = normalizeAgent(isRecord(entry) ? entry.agent : null);
    if (base !== null && base !== "archived") agents.set(base.id, base);
  }
  const derived = new Map<string, TimelineDerived>();
  for (const [id, value] of state.derived) if (agents.has(id)) derived.set(id, value);
  const armed = new Set<string>();
  for (const [id, base] of agents) if (base.status === "running") armed.add(id);
  // A tombstone whose agent is listed again is live again.
  let departing = state.departing;
  if ([...departing.keys()].some((id) => agents.has(id))) departing = new Map([...departing].filter(([id]) => !agents.has(id)));
  return bump(state, { agents, derived, armed, departing });
}

function upsertAgent(state: StoreState, raw: unknown, options: ReduceOptions | undefined, limits: StoreLimits): StoreState {
  const base = normalizeAgent(raw);
  if (base === null) return state;
  if (base === "archived") {
    const id = isRecord(raw) ? idOf(raw.id) : null;
    return id === null ? state : withoutAgent(state, id);
  }
  const prev = state.agents.get(base.id);
  if (prev === undefined && state.agents.size >= limits.storeEntriesMax) return state;
  const signal = options?.handoffSignal ?? HANDOFF_SIGNAL;
  const wasArmed = state.armed.has(base.id);
  // One finish edge per running period: the armed flag is spent by the handoff (OFFC-12, A17).
  let edge = false;
  if (wasArmed) {
    if (signal === "status") edge = prev?.status === "running" && base.status === "idle";
    else edge = base.requiresAttention && base.attentionReason === "finished" && !(prev?.requiresAttention && prev.attentionReason === "finished");
  }
  const armedNow = edge ? false : base.status === "running" ? true : base.status === "error" || base.status === "closed" ? false : wasArmed;
  if (prev !== undefined && shallowEqual(prev, base) && armedNow === wasArmed) return state;
  const agents = new Map(state.agents);
  agents.set(base.id, base);
  const patch: Partial<StoreState> = { agents };
  if (state.departing.has(base.id)) {
    const departing = new Map(state.departing);
    departing.delete(base.id);
    patch.departing = departing;
  }
  if (armedNow !== wasArmed) {
    const armed = new Set(state.armed);
    if (armedNow) armed.add(base.id);
    else armed.delete(base.id);
    patch.armed = armed;
  }
  if (edge && base.parentAgentId !== null && state.agents.has(base.parentAgentId)) {
    const next: Handoff = { seq: state.nextSeq, childId: base.id, parentId: base.parentAgentId };
    patch.handoffs = [...state.handoffs, next].slice(-limits.handoffQueueMax);
    patch.nextSeq = state.nextSeq + 1;
  }
  return bump(state, patch);
}

function applyDerived(state: StoreState, agentId: string, step: (prev: TimelineDerived) => TimelineDerived): StoreState {
  if (!state.agents.has(agentId)) return state;
  const prev = state.derived.get(agentId) ?? EMPTY_DERIVED;
  const next = step(prev);
  if (next === prev) return state;
  const derived = new Map(state.derived);
  derived.set(agentId, next);
  return bump(state, { derived });
}

function updateWorkspace(state: StoreState, payload: unknown, limits: StoreLimits): StoreState {
  if (!isRecord(payload)) return state;
  if (payload.kind === "remove") {
    const id = idOf(payload.id);
    if (id === null || !state.workspaces.has(id)) return state;
    const workspaces = new Map(state.workspaces);
    workspaces.delete(id);
    return bump(state, { workspaces });
  }
  if (payload.kind !== "upsert") return state;
  const next = normalizeWorkspace(payload.workspace);
  if (next === null) return state;
  const prev = state.workspaces.get(next.id);
  if (prev === undefined && state.workspaces.size >= limits.storeEntriesMax) return state;
  if (prev !== undefined && shallowEqual(prev, next)) return state;
  const workspaces = new Map(state.workspaces);
  workspaces.set(next.id, next);
  return bump(state, { workspaces });
}

function updateProject(state: StoreState, payload: unknown, limits: StoreLimits): StoreState {
  if (!isRecord(payload)) return state;
  if (payload.kind === "remove") {
    const id = idOf(payload.projectId);
    if (id === null || !state.projects.has(id)) return state;
    const projects = new Map(state.projects);
    projects.delete(id);
    return bump(state, { projects });
  }
  if (payload.kind !== "upsert") return state;
  const next = normalizeProject(payload.project);
  if (next === null) return state;
  const prev = state.projects.get(next.id);
  if (prev === undefined && state.projects.size >= limits.storeEntriesMax) return state;
  if (prev !== undefined && shallowEqual(prev, next)) return state;
  const projects = new Map(state.projects);
  projects.set(next.id, next);
  return bump(state, { projects });
}

// Pure and total: the same object comes back when nothing changed, and the previous state is never mutated.
export function reduce(state: StoreState, action: StoreAction, options?: ReduceOptions): StoreState {
  const limits = limitsOf(options);
  switch (action.type) {
    case "agents.seed":
      return seedAgents(state, action.entries, limits);
    case "workspaces.seed": {
      const workspaces = new Map<string, WorkspaceRecord>();
      for (const raw of entriesOf(action.entries)) {
        if (workspaces.size >= limits.storeEntriesMax) break;
        const next = normalizeWorkspace(raw);
        if (next !== null) workspaces.set(next.id, next);
      }
      return bump(state, { workspaces });
    }
    case "projects.seed": {
      const projects = new Map<string, ProjectView>();
      for (const raw of entriesOf(action.projects)) {
        if (projects.size >= limits.storeEntriesMax) break;
        const next = normalizeProject(raw);
        if (next !== null) projects.set(next.id, next);
      }
      return bump(state, { projects });
    }
    case "agent.update": {
      if (!isRecord(action.payload)) return state;
      if (action.payload.kind === "remove") {
        const id = idOf(action.payload.agentId);
        return id === null ? state : withoutAgent(state, id);
      }
      return action.payload.kind === "upsert" ? upsertAgent(state, action.payload.agent, options, limits) : state;
    }
    case "workspace.update":
      return updateWorkspace(state, action.payload, limits);
    case "project.update":
      return updateProject(state, action.payload, limits);
    case "timeline.event":
      return applyDerived(state, action.agentId, (prev) => deriveTimeline(prev, action.event));
    case "timeline.tail":
      return applyDerived(state, action.agentId, (prev) => {
        const sorted = entriesOf(action.entries).filter(isRecord).sort((a, b) => numericSeq(a) - numericSeq(b));
        return sorted.reduce((acc, entry) => deriveTimeline(acc, { type: "timeline", item: entry.item }), prev);
      });
    case "timeline.older":
      return applyDerived(state, action.agentId, (prev) => {
        if (prev.todoSeen) return prev;
        let newest: Record<string, unknown> | null = null;
        for (const entry of entriesOf(action.entries)) {
          if (!isRecord(entry) || !isRecord(entry.item) || entry.item.type !== "todo") continue;
          if (newest === null || numericSeq(entry) >= numericSeq(newest)) newest = entry;
        }
        if (newest === null) return prev;
        return withDerived(prev, { ...prev, todos: todosOf((newest.item as Record<string, unknown>).items), todoSeen: true });
      });
    case "timeline.scan":
      return applyDerived(state, action.agentId, (prev) => withDerived(prev, { ...prev, todoScan: action.scan }));
    case "timeline.reset": {
      if (!state.derived.has(action.agentId)) return state;
      const derived = new Map(state.derived);
      derived.delete(action.agentId);
      return bump(state, { derived });
    }
    case "select":
      return state.selectedAgentId === action.agentId ? state : bump(state, { selectedAgentId: action.agentId });
    case "handoffs.take": {
      const rest = state.handoffs.filter((h) => h.seq > action.upToSeq);
      return rest.length === state.handoffs.length ? state : bump(state, { handoffs: rest });
    }
    case "departed.release": {
      const ids = entriesOf(action.ids).filter((id): id is string => typeof id === "string" && state.departing.has(id));
      if (ids.length === 0) return state;
      const departing = new Map(state.departing);
      for (const id of ids) departing.delete(id);
      return bump(state, { departing });
    }
    default:
      return state;
  }
}

// ---------- snapshot join ----------

const snapshotCache = new WeakMap<object, { derived: object; workspaces: object; projects: object; departing: object; snapshot: OfficeSnapshot }>();

function countsOf(calls: ReadonlyMap<string, ToolKind> | undefined): Partial<Record<ToolKind, number>> {
  const out: Partial<Record<ToolKind, number>> = {};
  if (calls) for (const kind of calls.values()) out[kind] = (out[kind] ?? 0) + 1;
  return out;
}

function viewOf(state: StoreState, base: AgentBase): AgentView {
  const derived = state.derived.get(base.id);
  const workspace = base.workspaceId === null ? undefined : state.workspaces.get(base.workspaceId);
  return {
    ...base,
    projectId: workspace ? workspace.projectId : null,
    lastError: derived?.lastError ?? base.lastError,
    lastTool: derived?.lastTool ?? null,
    activity: derived?.activity ?? null,
    todos: derived?.todos ?? [],
    shell: derived?.shell ?? null,
    toolCounts: countsOf(derived?.calls),
  };
}

// Same reference until agents, derived data, workspaces, projects or tombstones change (works with useSyncExternalStore).
export function snapshotOf(state: StoreState): OfficeSnapshot {
  const hit = snapshotCache.get(state.agents);
  if (hit && hit.derived === state.derived && hit.workspaces === state.workspaces && hit.projects === state.projects && hit.departing === state.departing) return hit.snapshot;
  const agents: AgentView[] = [];
  for (const base of state.agents.values()) agents.push(viewOf(state, base));
  agents.sort((a, b) => less(a.title ?? "", a.id, b.title ?? "", b.id));
  const departing: AgentView[] = [];
  for (const base of state.departing.values()) departing.push(viewOf(state, base));
  const workspaces: WorkspaceView[] = [];
  const projects = new Map<string, ProjectView>(state.projects);
  for (const record of state.workspaces.values()) {
    const { projectDisplayName, ...view } = record;
    workspaces.push(view);
    // A project named only by a workspace is synthesized from the workspace (Pitfall 7).
    if (!projects.has(view.projectId)) projects.set(view.projectId, { id: view.projectId, name: projectDisplayName ?? view.projectId });
  }
  workspaces.sort((a, b) => less(a.name, a.id, b.name, b.id));
  const projectList = [...projects.values()].sort((a, b) => less(a.name, a.id, b.name, b.id));
  const snapshot: OfficeSnapshot = { projects: projectList, workspaces, agents, departing };
  snapshotCache.set(state.agents, { derived: state.derived, workspaces: state.workspaces, projects: state.projects, departing: state.departing, snapshot });
  return snapshot;
}

// ===== effect part: createStore over the read-only Paseo API =====

// The nine read-only members the store uses (OFFC-05, D-03, D-09); no send, run, create, archive, permission or usage member exists here.
// Parameters are loose on purpose: the real API is assignable and tsc proves it in asStorePaseo.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface StorePaseo {
  agents: {
    list(options: any): Promise<unknown>;
    subscribe(handler: (update: any) => void): unknown;
    ref(id: any): {
      timeline: {
        subscribe(handler: (event: any) => void): unknown;
        refetch(options: any): Promise<unknown>;
      };
    };
  };
  workspaces: {
    list(options: any): Promise<unknown>;
    subscribe(handler: (update: any) => void): unknown;
  };
  projects: {
    list(options?: any): Promise<unknown>;
    subscribe(handler: (update: any) => void): unknown;
  };
  observeEvents(events: any, options?: any): unknown;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// tsc checks here that the real PaseoApi is assignable to the narrow read-only type.
export function asStorePaseo(api: PaseoApi): StorePaseo {
  return api;
}

export interface StoreOptions {
  handoffSignal?: HandoffSignal;
  limits?: Partial<StoreLimits>;
}

export interface StoreStatus {
  state: "idle" | "loading" | "ready" | "failed";
  // The collection whose read failed first, with its error text; null when no read failed.
  failed: "agents" | "workspaces" | "projects" | null;
  error: string | null;
  // Collections whose list stopped at the page cap: the snapshot holds their first pages only.
  capped: ("agents" | "workspaces")[];
}

export interface StoreStats {
  listErrors: number;
  refetchErrors: number;
  timelineErrors: number;
  // Selected-agent todo scans that stopped at the page cap with older entries left.
  todoScanCapped: number;
}

export interface OfficeStore {
  start(): Promise<void>;
  getSnapshot(): OfficeSnapshot;
  getState(): StoreState;
  getVersion(): number;
  subscribe(listener: () => void): () => void;
  select(agentId: string | null): void;
  takeHandoffs(upToSeq?: number): Handoff[];
  // Drops the tombstones of departed agents once the scene has walked them out.
  release(ids: readonly string[]): void;
  getStatus(): StoreStatus;
  // The todo read state of one agent (ok, failed or capped); ok for null and unknown agents.
  todoScan(agentId: string | null): TodoScan;
  stats(): StoreStats;
  dispose(): void;
}

type Collection = "agents" | "workspaces";

interface OwnedLike {
  subscribe?: (observer: unknown) => unknown;
  release?: () => unknown;
  ready?: unknown;
}

interface TimelineEntry {
  agentId: string;
  sub: unknown;
  buffer: unknown[];
  live: boolean;
  dead: boolean;
  token: number;
  // Token of the read that is paging older entries, or -1.
  paging: number;
  tailInfo: { hasOlder: boolean; startCursor: unknown } | null;
}

// Longest event buffer kept while a tail read is pending.
const BUFFER_MAX = 200;

// Runs a release step, swallowing a throw or a rejected promise: releasing never fails the store.
function safely(step: () => unknown): void {
  try {
    const out = step();
    if (out && typeof (out as { then?: unknown }).then === "function") (out as Promise<unknown>).then(undefined, () => undefined);
  } catch {
    // ignored: a release that throws leaves nothing to clean
  }
}

function releaseOwned(target: unknown): void {
  if (typeof target === "function") safely(() => (target as () => unknown)());
  if (typeof target === "object" || typeof target === "function") {
    const owned = target as OwnedLike | null;
    if (owned && typeof owned.release === "function") safely(() => owned.release?.());
  }
}

function errorText(error: unknown): string {
  return clean(error instanceof Error ? error.message : String(error), ERROR_MAX_CHARS) ?? "error";
}

export function createStore(paseo: StorePaseo, options: StoreOptions = {}): OfficeStore {
  const limits: StoreLimits = { ...DEFAULT_STORE_LIMITS, ...(options.limits ?? {}) };
  const reduceOptions: ReduceOptions = { handoffSignal: options.handoffSignal ?? HANDOFF_SIGNAL, limits };
  let state = emptyState();
  let status: StoreStatus = { state: "idle", failed: null, error: null, capped: [] };
  let disposed = false;
  let started = false;
  let scheduled = false;
  const counters: StoreStats = { listErrors: 0, refetchErrors: 0, timelineErrors: 0, todoScanCapped: 0 };
  const listeners = new Set<() => void>();
  // Local handlers, owned list subscriptions and the event subscription: everything dispose releases besides timelines.
  const held = new Set<unknown>();
  const seeded: Record<Collection | "projects", boolean> = { agents: false, workspaces: false, projects: false };
  const pending: Record<Collection | "projects", unknown[]> = { agents: [], workspaces: [], projects: [] };
  const reseedToken: Record<Collection | "projects", number> = { agents: 0, workspaces: 0, projects: 0 };
  // Set while a re-read after a daemon restore replaces the collection; updates arriving meanwhile wait in pending.
  const reseeding: Record<Collection | "projects", boolean> = { agents: false, workspaces: false, projects: false };
  const timelines = new Map<string, TimelineEntry>();

  const filter = { includeArchived: false };

  function notify(): void {
    for (const listener of [...listeners]) safely(listener);
  }

  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      reconcile();
      notify();
    });
  }

  function dispatch(action: StoreAction): void {
    if (disposed) return;
    const next = reduce(state, action, reduceOptions);
    if (next === state) return;
    state = next;
    schedule();
  }

  // ----- list loading -----

  function pageOptions(cursor: string | null, first: boolean, withFilter: boolean): Record<string, unknown> {
    const page: Record<string, unknown> = cursor === null ? { limit: limits.listPageLimit } : { limit: limits.listPageLimit, cursor };
    const out: Record<string, unknown> = { page };
    if (withFilter) out.filter = filter;
    if (first) out.subscribe = {};
    return out;
  }

  // Reads the first page (given or listed) and the following pages by cursor, without subscribe, at most listPagesMax pages.
  // capped is true when a page remained behind the cap, so the entries are the first pages only.
  async function pull(
    list: (options: unknown) => Promise<unknown>,
    firstOptions: unknown,
    firstPage: unknown,
    withFilter: boolean,
    onHead: (head: unknown) => void,
  ): Promise<{ entries: unknown[]; complete: boolean; capped: boolean }> {
    let page = firstPage !== undefined ? firstPage : await list(firstOptions);
    onHead(page);
    const entries: unknown[] = [];
    for (let n = 1; ; n++) {
      if (disposed) return { entries, complete: false, capped: false };
      const rec = isRecord(page) ? page : null;
      if (rec === null) break;
      if (Array.isArray(rec.entries)) entries.push(...rec.entries.slice(0, limits.storeEntriesMax));
      const info = isRecord(rec.pageInfo) ? rec.pageInfo : null;
      const cursor = info && info.hasMore === true && typeof info.nextCursor === "string" ? info.nextCursor : null;
      if (cursor === null) break;
      if (n >= limits.listPagesMax || entries.length >= limits.storeEntriesMax) return { entries, complete: !disposed, capped: true };
      page = await list(pageOptions(cursor, false, withFilter));
    }
    return { entries, complete: !disposed, capped: false };
  }

  // Keeps the owned subscription of a list head until dispose; a head that arrives after dispose is released on the spot.
  function adopt(collection: Collection, head: unknown): void {
    const sub = isRecord(head) ? head.subscription : undefined;
    if (sub === undefined || sub === null) return;
    if (disposed) {
      releaseOwned(sub);
      return;
    }
    held.add(sub);
    const owned = sub as OwnedLike;
    safely(() => {
      const off = owned.subscribe?.({
        snapshot: (snapshot: unknown) => onRestore(collection, snapshot),
        update: () => undefined,
        error: () => {
          counters.listErrors++;
        },
      });
      if (typeof off === "function") held.add(off);
    });
  }

  function listFor(collection: Collection): (options: unknown) => Promise<unknown> {
    return collection === "agents" ? (o) => paseo.agents.list(o) : (o) => paseo.workspaces.list(o);
  }

  function seedAction(collection: Collection, entries: unknown[]): StoreAction {
    return collection === "agents" ? { type: "agents.seed", entries } : { type: "workspaces.seed", entries };
  }

  function updateAction(collection: Collection | "projects", payload: unknown): StoreAction {
    if (collection === "agents") return { type: "agent.update", payload };
    if (collection === "workspaces") return { type: "workspace.update", payload };
    return { type: "project.update", payload };
  }

  // Ends a re-read of a collection and replays the updates that arrived during it, over the list as it now stands.
  function endReseed(collection: Collection | "projects"): void {
    reseeding[collection] = false;
    for (const update of pending[collection].splice(0)) dispatch(updateAction(collection, update));
  }

  // Records whether a collection's list stopped at the page cap (status.capped).
  function setCapped(collection: Collection, capped: boolean): void {
    const rest = status.capped.filter((c) => c !== collection);
    status = { ...status, capped: capped ? [...rest, collection] : rest };
  }

  async function load(collection: Collection): Promise<boolean> {
    try {
      const result = await pull(listFor(collection), pageOptions(null, true, collection === "agents"), undefined, collection === "agents", (head) => adopt(collection, head));
      if (!result.complete || disposed) return true;
      dispatch(seedAction(collection, result.entries));
      setCapped(collection, result.capped);
      seeded[collection] = true;
      for (const update of pending[collection].splice(0)) dispatch(updateAction(collection, update));
      return true;
    } catch (error) {
      counters.listErrors++;
      if (!disposed) {
        status = { ...status, state: "failed", failed: collection, error: errorText(error) };
        seeded[collection] = true;
        pending[collection].length = 0;
      }
      return false;
    }
  }

  async function loadProjects(first: boolean): Promise<boolean> {
    const token = ++reseedToken.projects;
    if (!first) reseeding.projects = true;
    try {
      const result = await paseo.projects.list();
      if (disposed || reseedToken.projects !== token) return true;
      const rec = isRecord(result) ? result : null;
      dispatch({ type: "projects.seed", projects: rec ? rec.projects : [] });
      seeded.projects = true;
      endReseed("projects");
      return true;
    } catch (error) {
      counters.listErrors++;
      if (disposed) return false;
      if (first) {
        status = { ...status, state: "failed", failed: "projects", error: errorText(error) };
        seeded.projects = true;
        pending.projects.length = 0;
      } else if (reseedToken.projects === token) {
        // A re-list after a restore that fails keeps the office it has: the error is counted, the status stays ready.
        endReseed("projects");
      }
      return false;
    }
  }

  // The owned list subscription says the daemon restored it: the first page of the snapshot plus the later pages replace the collection.
  // Updates that arrive while those pages are read wait in pending and replay over the replacement.
  function onRestore(collection: Collection, snapshot: unknown): void {
    if (disposed || !seeded[collection]) return;
    const token = ++reseedToken[collection];
    reseeding[collection] = true;
    void (async () => {
      try {
        const result = await pull(listFor(collection), null, snapshot, collection === "agents", () => undefined);
        if (!result.complete || disposed || reseedToken[collection] !== token) return;
        dispatch(seedAction(collection, result.entries));
        setCapped(collection, result.capped);
        endReseed(collection);
      } catch {
        counters.listErrors++;
        if (!disposed && reseedToken[collection] === token) endReseed(collection);
      }
      await loadProjects(false);
    })();
  }

  function onUpdate(collection: Collection | "projects", type: "agent.update" | "workspace.update" | "project.update"): (update: unknown) => void {
    return (update) => {
      if (disposed) return;
      if (!seeded[collection] || reseeding[collection]) {
        if (pending[collection].length < limits.storeEntriesMax) pending[collection].push(update);
        return;
      }
      dispatch({ type, payload: update });
    };
  }

  async function start(): Promise<void> {
    if (started || disposed) return;
    started = true;
    status = { state: "loading", failed: null, error: null, capped: [] };
    // Local handlers first, so no update falls between a list and its subscription.
    for (const hook of [
      () => paseo.agents.subscribe(onUpdate("agents", "agent.update")),
      () => paseo.workspaces.subscribe(onUpdate("workspaces", "workspace.update")),
      () => paseo.projects.subscribe(onUpdate("projects", "project.update")),
    ]) {
      safely(() => held.add(hook()));
    }
    // Assumption A2: the owned event subscription is kept as one more subscription next to projects.subscribe.
    safely(() => {
      const events = paseo.observeEvents(["project.update"]);
      if (events === undefined || events === null) return;
      held.add(events);
      (events as OwnedLike).subscribe?.({
        snapshot: () => undefined,
        update: (message: unknown) => {
          if (isRecord(message) && message.type === "project.update") onUpdate("projects", "project.update")(message.payload);
        },
        error: () => {
          counters.listErrors++;
        },
      });
    });
    const outcomes = await Promise.all([load("agents"), load("workspaces"), loadProjects(true)]);
    if (disposed) return;
    if (outcomes.every(Boolean)) status = { ...status, state: "ready", failed: null, error: null };
    schedule();
  }

  // ----- timelines -----

  function wanted(): string[] {
    const out: string[] = [];
    if (state.selectedAgentId !== null && state.agents.has(state.selectedAgentId)) out.push(state.selectedAgentId);
    const running = [...state.agents.values()].filter((a) => a.status === "running" && a.id !== state.selectedAgentId);
    running.sort((a, b) => {
      const au = a.updatedAt ?? "";
      const bu = b.updatedAt ?? "";
      if (au !== bu) return au < bu ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    for (const agent of running) out.push(agent.id);
    // An idle agent whose latest shell call still runs keeps its timeline, so the end of the command is seen (waiting on shell).
    for (const agent of state.agents.values()) {
      if (agent.status === "idle" && agent.id !== state.selectedAgentId && state.derived.get(agent.id)?.shell?.status === "running") out.push(agent.id);
    }
    return out.slice(0, limits.timelineSubscriptionsMax);
  }

  function releaseEntry(entry: TimelineEntry): void {
    if (entry.dead) return;
    entry.dead = true;
    entry.buffer.length = 0;
    releaseOwned(entry.sub);
  }

  function reconcile(): void {
    // The three first lists seed one after the other; timelines open once, after the last of them, so a failed one is not retried by a sibling seed.
    if (disposed || status.state === "loading") return;
    const keep = wanted();
    for (const [id, entry] of [...timelines]) {
      if (!keep.includes(id)) {
        releaseEntry(entry);
        timelines.delete(id);
      }
    }
    for (const id of keep) if (!timelines.has(id)) openTimeline(id);
  }

  function dropEntry(entry: TimelineEntry): void {
    releaseEntry(entry);
    if (timelines.get(entry.agentId) === entry) timelines.delete(entry.agentId);
  }

  function openTimeline(agentId: string): void {
    const entry: TimelineEntry = { agentId, sub: null, buffer: [], live: false, dead: false, token: 0, paging: -1, tailInfo: null };
    timelines.set(agentId, entry);
    try {
      entry.sub = paseo.agents.ref(agentId).timeline.subscribe((message) => onTimelineMessage(entry, message));
    } catch {
      counters.timelineErrors++;
      timelines.delete(agentId);
      return;
    }
    void runOpen(entry);
  }

  function onTimelineMessage(entry: TimelineEntry, message: unknown): void {
    if (disposed || entry.dead || !isRecord(message) || !isRecord(message.event)) return;
    const event = message.event;
    if (event.type === "subscription_restored") {
      void readTail(entry);
    } else if (event.type === "replacement") {
      dispatch({ type: "timeline.reset", agentId: entry.agentId });
      void readTail(entry);
    } else if (event.type === "error") {
      counters.timelineErrors++;
    } else if (entry.live) {
      dispatch({ type: "timeline.event", agentId: entry.agentId, event });
    } else if (entry.buffer.length < BUFFER_MAX) {
      entry.buffer.push(event);
    }
  }

  async function runOpen(entry: TimelineEntry): Promise<void> {
    const ready = (entry.sub as OwnedLike | null)?.ready;
    try {
      if (ready !== undefined) await ready;
    } catch {
      counters.timelineErrors++;
      dropEntry(entry);
      return;
    }
    if (disposed || entry.dead) {
      dropEntry(entry);
      return;
    }
    await readTail(entry);
  }

  // Seeds a bounded tail, then replays the events buffered during the read in order, then goes live (OFFC-05).
  async function readTail(entry: TimelineEntry): Promise<void> {
    const token = ++entry.token;
    entry.live = false;
    const current = (): boolean => !disposed && !entry.dead && entry.token === token;
    let payload: unknown = null;
    try {
      payload = await paseo.agents.ref(entry.agentId).timeline.refetch({ direction: "tail", limit: limits.timelineTailLimit, projection: "projected" });
    } catch {
      if (current()) counters.refetchErrors++;
    }
    if (!current()) return;
    const rec = isRecord(payload) ? payload : null;
    if (rec) dispatch({ type: "timeline.tail", agentId: entry.agentId, entries: rec.entries });
    dispatch({ type: "timeline.scan", agentId: entry.agentId, scan: rec ? "ok" : "failed" });
    for (const event of entry.buffer.splice(0)) dispatch({ type: "timeline.event", agentId: entry.agentId, event });
    entry.live = true;
    entry.tailInfo = rec ? { hasOlder: rec.hasOlder === true, startCursor: rec.startCursor ?? null } : null;
    if (entry.tailInfo) await pageOlder(entry, entry.tailInfo, token);
  }

  // Only the selected agent, only until a todo item is found (OFFC-15, D-03): pages are pulled once and never polled.
  async function pageOlder(entry: TimelineEntry, info: { hasOlder: boolean; startCursor: unknown }, token: number): Promise<void> {
    if (entry.paging === token) return;
    entry.paging = token;
    try {
      let current = info;
      let pages = 0;
      dispatch({ type: "timeline.scan", agentId: entry.agentId, scan: "ok" });
      for (;;) {
        if (disposed || entry.dead || entry.token !== token || state.selectedAgentId !== entry.agentId) return;
        if (state.derived.get(entry.agentId)?.todoSeen) return;
        if (!current.hasOlder || current.startCursor === null || current.startCursor === undefined) return;
        if (pages >= limits.timelinePagesMax) {
          counters.todoScanCapped++;
          dispatch({ type: "timeline.scan", agentId: entry.agentId, scan: "capped" });
          return;
        }
        pages++;
        let payload: unknown;
        try {
          payload = await paseo.agents.ref(entry.agentId).timeline.refetch({ direction: "before", cursor: current.startCursor, limit: limits.timelinePageLimit, projection: "projected" });
        } catch {
          if (!disposed) counters.refetchErrors++;
          if (entry.token === token && !entry.dead) dispatch({ type: "timeline.scan", agentId: entry.agentId, scan: "failed" });
          return;
        }
        if (disposed || entry.dead || entry.token !== token || state.selectedAgentId !== entry.agentId) return;
        const rec = isRecord(payload) ? payload : null;
        dispatch({ type: "timeline.older", agentId: entry.agentId, entries: rec ? rec.entries : [] });
        current = { hasOlder: rec?.hasOlder === true, startCursor: rec?.startCursor ?? null };
      }
    } finally {
      if (entry.paging === token) entry.paging = -1;
    }
  }

  function select(agentId: string | null): void {
    if (disposed) return;
    const before = state.selectedAgentId;
    dispatch({ type: "select", agentId });
    if (agentId === null || before === agentId) return;
    const entry = timelines.get(agentId);
    if (entry && entry.live && entry.tailInfo && !state.derived.get(agentId)?.todoSeen) void pageOlder(entry, entry.tailInfo, entry.token);
    // A tail read that failed leaves no cursor to page from, so selecting the agent reads the tail again.
    else if (entry && entry.live && !entry.tailInfo && state.derived.get(agentId)?.todoScan === "failed") void readTail(entry);
  }

  function takeHandoffs(upToSeq: number = Number.MAX_SAFE_INTEGER): Handoff[] {
    const taken = state.handoffs.filter((h) => h.seq <= upToSeq);
    if (taken.length === 0) return [];
    // No notification: taking a handoff changes no snapshot content.
    state = reduce(state, { type: "handoffs.take", upToSeq }, reduceOptions);
    return taken;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const target of held) releaseOwned(target);
    held.clear();
    for (const entry of timelines.values()) releaseEntry(entry);
    timelines.clear();
    listeners.clear();
    for (const key of ["agents", "workspaces", "projects"] as const) pending[key].length = 0;
  }

  return {
    start,
    getSnapshot: () => snapshotOf(state),
    getState: () => state,
    getVersion: () => state.version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select,
    takeHandoffs,
    release: (ids) => dispatch({ type: "departed.release", ids }),
    getStatus: () => status,
    todoScan: (agentId) => (agentId === null ? "ok" : (state.derived.get(agentId)?.todoScan ?? "ok")),
    stats: () => ({ ...counters }),
    dispose,
  };
}
