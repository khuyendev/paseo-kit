// Event log for the activity feed and one-shot animations (PANL-40, PANL-41). Lifecycle hooks record spawns,
// archives, prompts, reports and permissions; the snapshot adds tool and handoff events. In memory only: a plugin
// restart starts a new epoch, so clients reset their cursor.
import type { PluginLifecycleRegistration } from "@getpaseo/plugin/server";
import type { SwarmEvent } from "../shared/swarm.ts";
import type { Paseo } from "./activity.ts";
import { type TimelineItem, describeItem } from "./describe.ts";
import {
  EVENT_HISTORY,
  EVENT_LOG_MAX,
  EVENT_TEXT_MAX_CHARS,
  EVENTS_PER_CALL_MAX,
  PROMPT_FRESH_MS,
  PROMPT_LOOKBACK_ITEMS,
  PROMPT_RETRY_MS,
} from "./limits.ts";
import { clip, id8 } from "./text.ts";

export type NewEvent = Omit<SwarmEvent, "seq" | "at">;

export class EventLog {
  readonly epoch: string;
  private seq = 0;
  private readonly items: SwarmEvent[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now, pid: number = process.pid) {
    this.now = now;
    this.epoch = `${pid}-${now().toString(36)}`;
  }

  push(event: NewEvent): void {
    this.seq += 1;
    this.items.push({ ...event, text: clip(event.text, EVENT_TEXT_MAX_CHARS), seq: this.seq, at: new Date(this.now()).toISOString() });
    if (this.items.length > EVENT_LOG_MAX) this.items.splice(0, this.items.length - EVENT_LOG_MAX);
  }

  // History (newest EVENT_HISTORY) on a first call or another epoch, else events after the cursor.
  since(afterSeq: number, epoch: string | null): SwarmEvent[] {
    if (afterSeq < 0 || epoch !== this.epoch) return this.items.slice(-EVENT_HISTORY);
    return this.items.filter((e) => e.seq > afterSeq).slice(-EVENTS_PER_CALL_MAX);
  }

  get lastSeq(): number {
    return this.seq;
  }

  get size(): number {
    return this.items.length;
  }
}

interface HookAgent {
  id: string;
  parentAgentId: string | null;
  title: string | null;
}

function base(agent: HookAgent) {
  return {
    agentId: agent.id,
    parentId: agent.parentAgentId,
    title: agent.title ?? id8(agent.id),
    stats: "",
    activity: null,
    path: null,
    peerId: null,
    peerOp: null,
  };
}

async function latestPrompt(paseo: Paseo, agentId: string, sinceMs: number): Promise<string | null> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: PROMPT_LOOKBACK_ITEMS, projection: "projected" });
  for (const entry of [...page.entries].reverse()) {
    if (entry.item.type !== "user_message") continue;
    return Date.parse(entry.timestamp) >= sinceMs - PROMPT_FRESH_MS ? entry.item.text : null;
  }
  return null;
}

// "12 read · 3 edit · 2 shell" from the tool calls of one turn.
export function turnStats(timeline: readonly TimelineItem[]): string {
  const counts = new Map<string, number>();
  for (const item of timeline) {
    if (item.type !== "tool_call") continue;
    const kind = describeItem(item)?.kind;
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(" · ");
}

function lastReply(timeline: readonly TimelineItem[]): string {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item.type === "assistant_message" && item.text.trim()) return item.text;
  }
  return "";
}

export interface LifecycleTiming {
  now: () => number;
  delay: (ms: number) => Promise<void>;
}

const REAL_TIMING: LifecycleTiming = { now: Date.now, delay: (ms) => new Promise((r) => setTimeout(r, ms)) };

// Registers the lifecycle hooks; returns the function that unsubscribes every one of them (PANL-02).
export function recordLifecycle(server: PluginLifecycleRegistration, log: EventLog, timing: LifecycleTiming = REAL_TIMING): () => void {
  const offs = [
    server.on("agent.created", ({ agent }) => log.push({ ...base(agent), kind: "spawn", text: "" })),
    server.on("agent.archived", ({ agent }) => log.push({ ...base(agent), kind: "archive", text: "" })),
    server.on("agent.turn_started", ({ agent }, { paseo }) => {
      // Not awaited: the hook never blocks the turn; the prompt lands in the timeline shortly after.
      const startedMs = timing.now();
      void (async () => {
        let text: string | null = null;
        try {
          text = await latestPrompt(paseo, agent.id, startedMs);
          if (text === null) {
            await timing.delay(PROMPT_RETRY_MS);
            text = await latestPrompt(paseo, agent.id, startedMs);
          }
        } catch {
          text = null;
        }
        log.push({ ...base(agent), kind: "command", text: text ?? "" });
      })();
    }),
    server.on("agent.turn_ended", ({ agent, outcome, timeline }) => {
      const kind = outcome.kind === "completed" ? "report" : outcome.kind === "failed" ? "failed" : "canceled";
      const text = outcome.kind === "failed" ? outcome.error.message : outcome.kind === "canceled" ? outcome.reason : lastReply(timeline);
      log.push({ ...base(agent), kind, text, stats: turnStats(timeline) });
    }),
    server.on("agent.permission_requested", ({ agent, request }) =>
      log.push({ ...base(agent), kind: "permission", text: request.title ?? request.name }),
    ),
    server.on("agent.permission_resolved", ({ agent }) => log.push({ ...base(agent), kind: "permission_resolved", text: "" })),
  ];
  return () => {
    for (const off of offs) off();
  };
}
