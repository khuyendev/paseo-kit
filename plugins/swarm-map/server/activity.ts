// Live activity per agent from the tail of its Paseo timeline (PANL-31, PANL-32, PANL-42, PANL-60). Only drawn
// agents that are live or changed within the idle window are read, because loading the timeline of an old idle
// session is slow; reads are rate-limited per agent, at most PARALLEL_READS at once and one in flight per agent.
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Activity, ActivityKind, AgentMessage, FileOp } from "../shared/swarm.ts";
import { type TimelineEntry, toActivity } from "./describe.ts";
import type { FileLedger, Handoff } from "./files.ts";
import {
  ERROR_RETRY_MS,
  FIRST_TAIL_LIMIT,
  LIVE_REFRESH_MS,
  PARALLEL_READS,
  RECENT_MAX,
  SEEN_IDS_MAX,
  TAIL_LIMIT,
} from "./limits.ts";
import { errorText, id8 } from "./text.ts";

export type Paseo = PluginHandlerContext["paseo"];

export interface AgentActivity {
  activity: Activity | null;
  recent: Activity[];
  lastCommand: AgentMessage | null;
  lastReply: AgentMessage | null;
}

export interface ActivityTarget {
  id: string;
  status: string;
  updatedAt: string;
  attention: string | null;
}

export interface ActivityHooks {
  // A tool call first seen on a non-first read.
  onNewTool: (agentId: string, activity: Activity) => void;
  // Files of one call another agent touched before, one call per previous agent (non-first reads only).
  onHandoff: (agentId: string, activity: Activity, handoffs: Handoff[]) => void;
}

interface CacheEntry extends AgentActivity {
  fetchedAtMs: number;
  updatedAt: string;
  status: string;
  seen: Set<string>;
  error: string | null;
}

const EMPTY: AgentActivity = { activity: null, recent: [], lastCommand: null, lastReply: null };
const NO_HOOKS: ActivityHooks = { onNewTool: () => {}, onHandoff: () => {} };
const FILE_OPS: ReadonlySet<ActivityKind> = new Set(["read", "edit", "write"]);
const TOOL_EVENT_KINDS: ReadonlySet<ActivityKind> = new Set(["read", "edit", "write", "shell", "search", "fetch", "agent"]);

export function isLive(a: Pick<ActivityTarget, "status" | "attention">): boolean {
  return a.status === "running" || a.status === "initializing" || a.attention === "permission";
}

export async function runLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(workers);
}

export class ActivityCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly ledger: FileLedger;

  constructor(ledger: FileLedger) {
    this.ledger = ledger;
  }

  get(agentId: string): AgentActivity {
    return this.entries.get(agentId) ?? EMPTY;
  }

  has(agentId: string): boolean {
    return this.entries.has(agentId);
  }

  // Reads the due agents and forgets agents no longer listed. Returns errors that differ from the agent's last one.
  async refresh(paseo: Paseo, agents: readonly ActivityTarget[], listed: ReadonlySet<string>, nowMs: number, idleWindowMs: number, hooks: ActivityHooks): Promise<string[]> {
    const errors: string[] = [];
    const due = agents.filter((a) => {
      if (!isLive(a) && nowMs - Date.parse(a.updatedAt) > idleWindowMs) return false;
      const e = this.entries.get(a.id);
      if (!e) return true;
      const changed = e.updatedAt !== a.updatedAt || e.status !== a.status;
      if (e.error) return changed || nowMs - e.fetchedAtMs >= ERROR_RETRY_MS;
      if (isLive(a)) return nowMs - e.fetchedAtMs >= LIVE_REFRESH_MS;
      return changed;
    });
    await runLimited(due, PARALLEL_READS, async (a) => {
      const error = await this.read(paseo, a, nowMs, hooks);
      if (error) errors.push(error);
    });
    for (const id of this.entries.keys()) if (!listed.has(id)) this.entries.delete(id);
    return errors;
  }

  // Inspector details: from the cache; an agent never read gets one read. Returns the read error, if any.
  async detail(paseo: Paseo, agentId: string, nowMs: number): Promise<{ activity: AgentActivity; error: string | null }> {
    if (!this.entries.has(agentId)) {
      await this.read(paseo, { id: agentId, status: "unknown", updatedAt: "", attention: null }, nowMs, NO_HOOKS);
    }
    const e = this.entries.get(agentId);
    return { activity: e ?? EMPTY, error: e?.error ?? null };
  }

  private read(paseo: Paseo, agent: ActivityTarget, nowMs: number, hooks: ActivityHooks): Promise<string | null> {
    let job = this.inflight.get(agent.id);
    if (!job) {
      job = this.fetchOne(paseo, agent, nowMs, hooks)
        .then(() => null)
        .catch((err: unknown) => {
          const message = `timeline ${id8(agent.id)}: ${errorText(err)}`;
          const prev = this.entries.get(agent.id);
          this.entries.set(agent.id, {
            ...(prev ?? { ...EMPTY, seen: new Set<string>() }),
            fetchedAtMs: nowMs,
            updatedAt: agent.updatedAt,
            status: agent.status,
            error: message,
          });
          return prev?.error === message ? null : message;
        })
        .finally(() => this.inflight.delete(agent.id));
      this.inflight.set(agent.id, job);
    }
    return job;
  }

  private async fetchOne(paseo: Paseo, agent: ActivityTarget, nowMs: number, hooks: ActivityHooks): Promise<void> {
    const prev = this.entries.get(agent.id);
    const known = prev !== undefined && prev.error === null;
    const page = await paseo.agents.ref(agent.id).timeline.refetch({
      direction: "tail",
      limit: known ? TAIL_LIMIT : FIRST_TAIL_LIMIT,
      projection: "projected",
    });
    const acts = (page.entries as TimelineEntry[])
      .map(toActivity)
      .filter((a): a is Activity => a !== null)
      .sort((a, b) => a.at.localeCompare(b.at));
    const recent = new Map((prev?.recent ?? []).map((a) => [a.id, a]));
    const seen = prev?.seen ?? new Set<string>();
    let lastCommand = prev?.lastCommand ?? null;
    let lastReply = prev?.lastReply ?? null;
    for (const act of acts) {
      if (act.kind === "command" && (!lastCommand || act.at >= lastCommand.at)) lastCommand = { text: act.detail, at: act.at };
      if (act.kind === "reply" && (!lastReply || act.at >= lastReply.at)) lastReply = { text: act.detail, at: act.at };
      if (act.kind !== "think") recent.set(act.id, act);
      if (!seen.has(act.id)) {
        seen.add(act.id);
        if (known && TOOL_EVENT_KINDS.has(act.kind)) hooks.onNewTool(agent.id, act);
      }
      // PANL-60: every read records the paths available now, whatever seen-id or event suppression says; paths of
      // a streaming call may appear only on a later read, and a repeated touch is a no-op in the ledger.
      if (FILE_OPS.has(act.kind)) {
        const byPeer = new Map<string, Handoff[]>();
        for (const file of act.files) {
          const handoff = this.ledger.record(file, { agentId: agent.id, op: act.kind as FileOp, at: act.at });
          if (handoff) byPeer.set(handoff.prev.agentId, [...(byPeer.get(handoff.prev.agentId) ?? []), handoff]);
        }
        if (known) for (const group of byPeer.values()) hooks.onHandoff(agent.id, act, group);
      }
    }
    if (seen.size > SEEN_IDS_MAX) for (const id of [...seen].slice(0, seen.size - SEEN_IDS_MAX)) seen.delete(id);
    this.entries.set(agent.id, {
      fetchedAtMs: nowMs,
      updatedAt: agent.updatedAt,
      status: agent.status,
      seen,
      error: null,
      activity: acts.length > 0 ? acts[acts.length - 1] : (prev?.activity ?? null),
      recent: [...recent.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT_MAX),
      lastCommand,
      lastReply,
    });
  }
}
