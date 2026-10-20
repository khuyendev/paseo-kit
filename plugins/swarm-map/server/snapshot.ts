// Builds the read-only swarm snapshot (PANL-24..31, PANL-38, PANL-43, PANL-55, PANL-61): brains (agents with
// live subagents) -> swarms (`ph.swarm` groups) -> agents with live activity, file holds and new events.
// Archived and closed agents are never drawn, except a closed brain whose subagents still live (drawn asleep).
import type { AgentDetail, Brain, SnapshotInput, SwarmAgent, SwarmFailure, SwarmGroup, SwarmSnapshot } from "../shared/swarm.ts";
import { type ActivityCache, type Paseo, isLive } from "./activity.ts";
import type { EventLog } from "./events.ts";
import type { FileLedger } from "./files.ts";
import { SWARM_LABEL, groupName } from "./group.ts";
import { IDLE_WINDOW_MS, MAX_PAGES, PAGE_LIMIT, PARENT_TTL_MS, SNAPSHOT_ACTIVITY_FILES } from "./limits.ts";
import type { RotateResolver } from "./rotate.ts";
import { errorText, filesLabel, id8 } from "./text.ts";
import { RUN_LABEL, type WaveLinker } from "./wave-link.ts";

// Written last by `ph` createAgent (PCLI-08), so a caller-supplied label cannot override it.
export const PARENT_LABEL = "paseo.parent-agent-id";
const LIVE_STATUSES = ["initializing", "idle", "running", "error"] as const;
const OP_RANK = { read: 0, edit: 1, write: 2 } as const;

type ListResult = Awaited<ReturnType<Paseo["agents"]["list"]>>;
type AgentPayload = ListResult["entries"][number]["agent"];
type BaseAgent = Omit<SwarmAgent, "activity" | "heldFiles"> & { cwd: string | null; workspaceId: string | null; runId: string | null };

export interface SnapshotDeps {
  activity: ActivityCache;
  events: EventLog;
  files: FileLedger;
  rotate: RotateResolver;
  waves: WaveLinker;
  now?: () => number;
}

export function toAgent(a: AgentPayload, project: string | null): Omit<BaseAgent, "rotatePct"> {
  const used = a.lastUsage?.contextWindowUsedTokens ?? null;
  const max = a.lastUsage?.contextWindowMaxTokens ?? null;
  const pending = (a.pendingPermissions ?? []).length > 0;
  const labels = (a.labels ?? {}) as Record<string, string>;
  return {
    id: a.id,
    title: a.title || id8(a.id),
    model: `${a.provider}/${a.model ?? "?"}`,
    thinking: a.thinkingOptionId ?? null,
    mode: a.currentModeId ?? null,
    status: a.status,
    contextPct: used !== null && max !== null && max > 0 ? Math.round((used / max) * 100) : null,
    usedTokens: used,
    maxTokens: max,
    attention: pending ? "permission" : a.requiresAttention ? (a.attentionReason ?? null) : null,
    parentId: labels[PARENT_LABEL] ?? null,
    swarm: labels[SWARM_LABEL] ?? null,
    project,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    turnStartedAt: a.status === "running" ? (a.activeTurn?.startedAt ?? null) : null,
    cwd: a.cwd ?? null,
    workspaceId: a.workspaceId ?? null,
    runId: labels[RUN_LABEL] ?? null,
  };
}

function failure(code: SwarmFailure["code"], message: string): SwarmFailure {
  return { ok: false, code, message, directory: null };
}

export class SnapshotBuilder {
  private readonly deps: SnapshotDeps;
  private readonly now: () => number;
  private readonly parents = new Map<string, { atMs: number; agent: BaseAgent | null }>();
  private readonly workspaceDirs = new Map<string, { atMs: number; dir: string | null }>();
  private listedIds = new Set<string>();

  constructor(deps: SnapshotDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  private async withRotate(a: Omit<BaseAgent, "rotatePct">, nowMs: number): Promise<BaseAgent> {
    return { ...a, rotatePct: await this.deps.rotate.forCwd(a.cwd, nowMs) };
  }

  private async listAgents(paseo: Paseo, nowMs: number): Promise<BaseAgent[]> {
    const agents: Omit<BaseAgent, "rotatePct">[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await paseo.agents.list({
        filter: { includeArchived: false, statuses: [...LIVE_STATUSES] },
        sort: [{ key: "created_at", direction: "asc" }],
        page: { limit: PAGE_LIMIT, cursor },
      });
      for (const e of res.entries) if (!e.agent.archivedAt) agents.push(toAgent(e.agent, e.project?.projectName ?? null));
      if (!res.pageInfo.hasMore || !res.pageInfo.nextCursor) break;
      cursor = res.pageInfo.nextCursor;
    }
    return Promise.all(agents.map((a) => this.withRotate(a, nowMs)));
  }

  // A parent the status filter dropped (closed brain with live subagents); null when archived, missing or failing.
  private async fetchParent(paseo: Paseo, id: string, nowMs: number): Promise<BaseAgent | null> {
    const hit = this.parents.get(id);
    if (hit && nowMs - hit.atMs < PARENT_TTL_MS) return hit.agent;
    let agent: BaseAgent | null = null;
    try {
      const res = await paseo.agents.ref(id).refresh();
      if (res && !res.agent.archivedAt) agent = await this.withRotate(toAgent(res.agent, res.project?.projectName ?? null), nowMs);
    } catch {
      agent = null;
    }
    this.parents.set(id, { atMs: nowMs, agent });
    return agent;
  }

  private async workspaceDir(paseo: Paseo, a: BaseAgent, nowMs: number): Promise<string | null> {
    if (!a.workspaceId) return a.cwd;
    const hit = this.workspaceDirs.get(a.workspaceId);
    if (hit && nowMs - hit.atMs < PARENT_TTL_MS) return hit.dir;
    let dir: string | null = null;
    try {
      const ref = paseo.workspaces.ref(a.workspaceId);
      const ws = ref.current() ?? (await ref.refresh());
      dir = ws?.workspaceDirectory ?? ref.directory ?? null;
    } catch {
      dir = null;
    }
    this.workspaceDirs.set(a.workspaceId, { atMs: nowMs, dir });
    return dir;
  }

  private async groupWave(paseo: Paseo, agents: BaseAgent[], nowMs: number): Promise<SwarmGroup["wave"]> {
    const linked = agents.find((a) => a.runId);
    if (!linked) return null;
    return this.deps.waves.link(await this.workspaceDir(paseo, linked, nowMs), linked.runId);
  }

  async detail(paseo: Paseo, agentId: string): Promise<AgentDetail | SwarmFailure> {
    try {
      if (!this.deps.activity.has(agentId) && !this.listedIds.has(agentId)) {
        const found = await paseo.agents.ref(agentId).refresh().catch(() => null);
        if (!found) return failure("not_found", `no agent ${agentId}`);
      }
      const { activity, error } = await this.deps.activity.detail(paseo, agentId, this.now());
      if (error) return failure("failed", error);
      return { ok: true, recent: activity.recent, lastCommand: activity.lastCommand, lastReply: activity.lastReply };
    } catch (err) {
      return failure("failed", errorText(err));
    }
  }

  async build(paseo: Paseo, input: SnapshotInput): Promise<SwarmSnapshot | SwarmFailure> {
    try {
      return await this.buildUnsafe(paseo, input);
    } catch (err) {
      return failure("failed", errorText(err));
    }
  }

  private async buildUnsafe(paseo: Paseo, input: SnapshotInput): Promise<SwarmSnapshot> {
    const { activity, events, files, rotate } = this.deps;
    const now = this.now();
    const errors: string[] = [];
    const listed = await this.listAgents(paseo, now).catch((err: unknown) => {
      errors.push(`agents: ${errorText(err)}`);
      return [] as BaseAgent[];
    });
    this.listedIds = new Set(listed.map((a) => a.id));

    const byId = new Map(listed.map((a) => [a.id, a]));
    const missing = [...new Set(listed.map((a) => a.parentId).filter((p): p is string => !!p && !byId.has(p)))];
    for (const parent of await Promise.all(missing.map((id) => this.fetchParent(paseo, id, now)))) if (parent) byId.set(parent.id, parent);

    const children = new Map<string | null, BaseAgent[]>();
    for (const a of listed) {
      if (a.parentId === null) continue;
      const key = byId.has(a.parentId) ? a.parentId : null;
      children.set(key, [...(children.get(key) ?? []), a]);
    }
    // PANL-29: counted before the recent filter.
    const standaloneCount = listed.filter((a) => a.parentId === null && !children.has(a.id)).length;

    const recentMs = input.recentHours * 3600 * 1000;
    const isRecent = (a: BaseAgent) => isLive(a) || now - Date.parse(a.updatedAt) < recentMs;
    const membersOf = (brainId: string | null, kids: BaseAgent[]) => [...(brainId ? [byId.get(brainId)!] : []), ...kids];
    if (input.recentHours > 0) for (const [brainId, kids] of [...children]) if (!membersOf(brainId, kids).some(isRecent)) children.delete(brainId);

    const drawn = [...children].flatMap(([brainId, kids]) => membersOf(brainId, kids));
    const titleOf = (id: string) => byId.get(id)?.title ?? id8(id);
    const parentOf = (id: string) => byId.get(id)?.parentId ?? null;
    const readErrors = await activity.refresh(paseo, drawn, new Set(byId.keys()), now, IDLE_WINDOW_MS, {
      onNewTool: (agentId, act) =>
        events.push({ kind: "tool", agentId, parentId: parentOf(agentId), title: titleOf(agentId), text: act.label, stats: "", activity: act, path: null, peerId: null, peerOp: null }),
      onHandoff: (agentId, act, handoffs) =>
        events.push({
          kind: "handoff",
          agentId,
          parentId: parentOf(agentId),
          title: titleOf(agentId),
          text: filesLabel(handoffs.map((h) => h.path), 3),
          stats: "",
          activity: act,
          path: handoffs[0].path,
          peerId: handoffs[0].prev.agentId,
          peerOp: handoffs.map((h) => h.prev.op).sort((x, y) => OP_RANK[y] - OP_RANK[x])[0],
        }),
    });
    errors.push(...readErrors, ...rotate.drainErrors());

    const fileState = files.holds(new Set(drawn.map((a) => a.id)), now);
    const full = (a: BaseAgent): SwarmAgent => {
      const { cwd: _cwd, workspaceId: _ws, runId: _run, ...rest } = a;
      const act = activity.get(a.id).activity;
      return { ...rest, activity: act && { ...act, files: act.files.slice(0, SNAPSHOT_ACTIVITY_FILES) }, heldFiles: fileState.counts.get(a.id) ?? 0 };
    };

    const brains: Brain[] = await Promise.all(
      [...children].map(async ([brainId, kids]) => {
        const groups = new Map<string, BaseAgent[]>();
        for (const k of kids) groups.set(groupName(k), [...(groups.get(groupName(k)) ?? []), k]);
        return {
          agent: brainId === null ? null : full(byId.get(brainId)!),
          groups: await Promise.all(
            [...groups].map(async ([name, list]) => ({ name, agents: list.map(full), wave: await this.groupWave(paseo, list, now) })),
          ),
        };
      }),
    );
    const busy = (b: Brain) => b.agent?.status === "running" || b.groups.some((g) => g.agents.some((a) => a.status === "running"));
    brains.sort((a, b) => Number(a.agent === null) - Number(b.agent === null) || Number(busy(b)) - Number(busy(a)));

    return {
      ok: true,
      generatedAt: new Date(now).toISOString(),
      brains,
      standaloneCount,
      eventEpoch: events.epoch,
      files: fileState.holds,
      events: events.since(input.afterSeq, input.eventEpoch),
      lastSeq: events.lastSeq,
      errors,
    };
  }
}
