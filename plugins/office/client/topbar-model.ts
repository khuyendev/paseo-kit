// Top bar view-model (OFFC-16, D-05, D-07): counters by agent state and the context percentage of one agent.
// The provider usage slot stays null: the usage windows (5h, weekly) are not read (D-07) and the owner supplies the API later.
// No provider usage call may be added to this plugin until then.
import { CONTEXT_WARN_PERCENT } from "./limits-panels.ts";
import type { StringKey } from "./strings.ts";
import type { OfficeSnapshot } from "../shared/model-types.ts";

export interface TopBarCounters {
  running: number;
  attention: number;
  error: number;
  idle: number;
  initializing: number;
  closed: number;
  total: number;
}

export interface TopBarContext {
  agentId: string;
  usedTokens: number;
  maxTokens: number;
  percent: number;
  warn: boolean;
  source: "selected" | "busiest";
}

export interface TopBarModel {
  counters: TopBarCounters;
  context: TopBarContext | null;
  usageSlot: null;
}

export const TOPBAR_COUNTERS: readonly { id: keyof TopBarCounters; labelKey: StringKey }[] = [
  { id: "running", labelKey: "counterRunning" },
  { id: "attention", labelKey: "counterAttention" },
  { id: "error", labelKey: "counterError" },
  { id: "idle", labelKey: "counterIdle" },
  { id: "initializing", labelKey: "counterInitializing" },
  { id: "closed", labelKey: "counterClosed" },
  { id: "total", labelKey: "counterTotal" },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Used, max and the clamped percent of an agent, or null when the values are missing or not usable. */
function readContext(agent: Record<string, unknown>): { used: number; max: number; percent: number } | null {
  const used = agent.contextUsedTokens;
  const max = agent.contextMaxTokens;
  if (typeof used !== "number" || typeof max !== "number" || !Number.isFinite(used) || !Number.isFinite(max) || used < 0 || max <= 0) return null;
  const percent = Math.min(100, Math.max(0, Math.round((used * 100) / max)));
  return { used, max, percent };
}

export function topbarModel(snapshot: OfficeSnapshot, selectedAgentId: string | null): TopBarModel {
  const counters: TopBarCounters = { running: 0, attention: 0, error: 0, idle: 0, initializing: 0, closed: 0, total: 0 };
  const agents = Array.isArray(snapshot?.agents) ? (snapshot.agents as readonly unknown[]).filter(isRecord) : [];
  let selected: Record<string, unknown> | null = null;
  let busiest: { agent: Record<string, unknown>; used: number; max: number; percent: number } | null = null;
  for (const a of agents) {
    counters.total++;
    switch (a.status) {
      case "running":
        counters.running++;
        break;
      case "idle":
        counters.idle++;
        break;
      case "initializing":
        counters.initializing++;
        break;
      case "error":
        counters.error++;
        break;
      case "closed":
        counters.closed++;
        break;
      default:
        break;
    }
    if (a.requiresAttention === true) counters.attention++;
    if (selected === null && typeof selectedAgentId === "string" && a.id === selectedAgentId) selected = a;
    if (a.status !== "closed") {
      const ctx = readContext(a);
      if (ctx !== null && (busiest === null || ctx.percent > busiest.percent)) busiest = { agent: a, ...ctx };
    }
  }

  let context: TopBarContext | null = null;
  if (selected !== null) {
    const ctx = readContext(selected);
    if (ctx !== null && typeof selected.id === "string") {
      context = { agentId: selected.id, usedTokens: ctx.used, maxTokens: ctx.max, percent: ctx.percent, warn: ctx.percent >= CONTEXT_WARN_PERCENT, source: "selected" };
    }
  } else if (busiest !== null && typeof busiest.agent.id === "string") {
    context = { agentId: busiest.agent.id, usedTokens: busiest.used, maxTokens: busiest.max, percent: busiest.percent, warn: busiest.percent >= CONTEXT_WARN_PERCENT, source: "busiest" };
  }
  return { counters, context, usageSlot: null };
}
