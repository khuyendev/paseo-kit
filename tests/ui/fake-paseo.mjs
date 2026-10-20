// Offline stand-in for the plugin SDK's `paseo` API and lifecycle registration (never a daemon).

const T0 = Date.parse("2026-10-20T10:00:00.000Z");
export const iso = (offsetMs = 0) => new Date(T0 + offsetMs).toISOString();
export const T_START = T0;

export function agentPayload(id, over = {}) {
  return {
    id,
    provider: "circle-agent",
    model: "gpt-6-luna-fast[1m]",
    cwd: null,
    workspaceId: null,
    thinkingOptionId: null,
    currentModeId: "bypassPermissions",
    status: "idle",
    title: `agent ${id}`,
    labels: {},
    createdAt: iso(0),
    updatedAt: iso(0),
    archivedAt: null,
    pendingPermissions: [],
    requiresAttention: false,
    attentionReason: null,
    activeTurn: null,
    lastUsage: null,
    ...over,
  };
}

export function toolEntry(callId, name, input, at, { status = "completed", seq = 1 } = {}) {
  return { item: { type: "tool_call", callId, name, status, error: null, detail: { type: "unknown", input, output: null } }, timestamp: at, seqStart: seq };
}

export function messageEntry(type, text, at, seq) {
  return { item: { type, text }, timestamp: at, seqStart: seq };
}

// agents: payloads; timelines: id -> entries[] or a function (opts, callNo) => entries | throws.
export function fakePaseo({ agents = [], timelines = {}, extra = {}, workspaces = {}, listError = null } = {}) {
  const reads = new Map();
  const inflight = new Map();
  let maxInflight = 0;
  const api = {
    reads,
    maxInflight: () => maxInflight,
    agents: {
      list: async () => {
        if (listError) throw new Error(listError);
        return { entries: api.agentsList().map((agent) => ({ agent, project: { projectName: "proj" } })), pageInfo: { hasMore: false, nextCursor: null } };
      },
      ref: (id) => ({
        refresh: async () => {
          const a = api.agentsList().find((x) => x.id === id) ?? extra[id];
          if (a instanceof Error) throw a;
          return a ? { agent: a, project: { projectName: "proj" } } : null;
        },
        timeline: {
          refetch: async (opts) => {
            const n = (reads.get(id) ?? 0) + 1;
            reads.set(id, n);
            inflight.set(id, (inflight.get(id) ?? 0) + 1);
            maxInflight = Math.max(maxInflight, inflight.get(id));
            await new Promise((r) => setImmediate(r));
            inflight.set(id, inflight.get(id) - 1);
            const src = timelines[id] ?? [];
            const entries = typeof src === "function" ? src(opts, n) : src;
            return { entries: entries.slice(-opts.limit) };
          },
        },
      }),
    },
    workspaces: {
      ref: (id) => ({ directory: workspaces[id] ?? null, current: () => (workspaces[id] ? { workspaceDirectory: workspaces[id] } : null), refresh: async () => null }),
    },
    agentsList: () => agents,
  };
  return api;
}

export function fakeServer() {
  const hooks = new Map();
  const handlers = new Map();
  return {
    hooks,
    handlers,
    on(name, fn) {
      const list = hooks.get(name) ?? [];
      list.push(fn);
      hooks.set(name, list);
      return () => hooks.set(name, (hooks.get(name) ?? []).filter((f) => f !== fn));
    },
    handle(contract, fn) {
      handlers.set(contract.name, fn);
    },
    emit(name, event, ctx) {
      for (const fn of hooks.get(name) ?? []) fn(event, ctx);
    },
    subscriptions() {
      return [...hooks.values()].reduce((n, l) => n + l.length, 0);
    },
  };
}

export const flush = () => new Promise((r) => setImmediate(r));
