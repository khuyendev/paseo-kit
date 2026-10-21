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

export function workspacePayload(id, over = {}) {
  return { id, projectId: "p1", projectDisplayName: "proj", workspaceKind: "directory", name: `ws ${id}`, status: "running", diffStat: null, ...over };
}

export function projectPayload(id, over = {}) {
  return { projectId: id, projectDisplayName: `project ${id}`, ...over };
}

export const agentUpsert = (agent) => ({ kind: "upsert", agent });
export const agentRemove = (id) => ({ kind: "remove", agentId: id });
export const streamEvent = (agentId, event) => ({ agentId, event });

// agents: payloads; timelines: id -> entries[] or a function (opts, callNo) => entries | throws.
// Added for the office store (07-06): workspaceEntries and projectEntries (payload arrays), pageSize (agents.list pages), and
// timelineSubscribeErrors (agent id -> message). The returned object also records every member call in `calls`.
export function fakePaseo({ agents = [], timelines = {}, extra = {}, workspaces = {}, listError = null, workspaceEntries = [], projectEntries = [], pageSize = null, timelineSubscribeErrors = {} } = {}) {
  const reads = new Map();
  const inflight = new Map();
  let maxInflight = 0;
  const calls = [];
  let currentAgents = agents;
  let currentWorkspaces = workspaceEntries;
  let gate = null;
  let subSeq = 0;
  const handlers = { agents: new Set(), workspaces: new Set(), projects: new Set() };
  const owned = new Set();
  const timelineLive = new Set();
  const timelineHandlers = [];
  const observed = [];

  const agentsResult = (options) => {
    const entries = currentAgents.map((agent) => ({ agent, project: { projectName: "proj" } }));
    if (!pageSize) return { entries, pageInfo: { hasMore: false, nextCursor: null } };
    const start = Number(options?.page?.cursor ?? 0) || 0;
    const more = start + pageSize < entries.length;
    return { entries: entries.slice(start, start + pageSize), pageInfo: { hasMore: more, nextCursor: more ? String(start + pageSize) : null } };
  };
  const workspacesResult = () => ({ requestId: "r", entries: currentWorkspaces, pageInfo: { hasMore: false, nextCursor: null } });
  // A fake owned subscription: ready resolves the result, subscribe(observer) returns an unsubscribe, release() is idempotent.
  const ownedSub = (kind, result) => {
    const observers = new Set();
    const sub = {
      kind,
      observers,
      subscriptionId: `sub-${++subSeq}`,
      ready: Promise.resolve(result),
      subscribe(observer) {
        observers.add(observer);
        return () => observers.delete(observer);
      },
      release: async () => {
        observers.clear();
        owned.delete(sub);
      },
    };
    owned.add(sub);
    return sub;
  };
  const withSubscription = (kind, result, options) => {
    if (!options?.subscribe) return result;
    const sub = ownedSub(kind, result);
    return { ...result, subscriptionId: sub.subscriptionId, subscription: sub };
  };
  const deliver = (set, payload) => {
    for (const handler of [...set]) handler(payload);
  };
  const local = (set) => (handler) => {
    set.add(handler);
    return () => set.delete(handler);
  };

  const api = {
    reads,
    calls,
    observed,
    maxInflight: () => maxInflight,
    agents: {
      list: async (options) => {
        calls.push("agents.list");
        if (gate) await gate;
        if (listError) throw new Error(listError);
        return withSubscription("agents", agentsResult(options), options);
      },
      subscribe: (handler) => {
        calls.push("agents.subscribe");
        return local(handlers.agents)(handler);
      },
      ref: (id) => ({
        refresh: async () => {
          calls.push("agents.ref.refresh");
          const a = api.agentsList().find((x) => x.id === id) ?? extra[id];
          if (a instanceof Error) throw a;
          return a ? { agent: a, project: { projectName: "proj" } } : null;
        },
        timeline: {
          refetch: async (opts) => {
            calls.push("agents.ref.timeline.refetch");
            const n = (reads.get(id) ?? 0) + 1;
            reads.set(id, n);
            inflight.set(id, (inflight.get(id) ?? 0) + 1);
            maxInflight = Math.max(maxInflight, inflight.get(id));
            await new Promise((r) => setImmediate(r));
            inflight.set(id, inflight.get(id) - 1);
            const src = timelines[id] ?? [];
            const all = typeof src === "function" ? src(opts, n) : src;
            const pool = opts?.direction === "before" && opts.cursor ? all.filter((e) => e.seqStart < opts.cursor.seq) : all;
            const entries = pool.slice(-opts.limit);
            const first = entries[0];
            return {
              entries,
              startCursor: first ? { epoch: "fake", seq: first.seqStart } : null,
              hasOlder: first ? all.some((e) => e.seqStart < first.seqStart) : false,
            };
          },
          subscribe: (handler) => {
            calls.push("agents.ref.timeline.subscribe");
            const record = { id, handler };
            timelineHandlers.push(record);
            timelineLive.add(record);
            const off = () => {
              timelineLive.delete(record);
            };
            const message = timelineSubscribeErrors[id];
            const ready = message ? Promise.reject(new Error(message)) : Promise.resolve();
            ready.catch(() => undefined);
            off.ready = ready;
            off.subscriptionId = `tl-${++subSeq}`;
            off.release = async () => off();
            return off;
          },
        },
      }),
    },
    workspaces: {
      list: async (options) => {
        calls.push("workspaces.list");
        if (gate) await gate;
        return withSubscription("workspaces", workspacesResult(), options);
      },
      subscribe: (handler) => {
        calls.push("workspaces.subscribe");
        return local(handlers.workspaces)(handler);
      },
      ref: (id) => ({
        directory: workspaces[id] ?? null,
        current: () => (workspaces[id] ? { workspaceDirectory: workspaces[id] } : null),
        refresh: async () => {
          calls.push("workspaces.ref.refresh");
          return null;
        },
      }),
    },
    projects: {
      list: async () => {
        calls.push("projects.list");
        if (gate) await gate;
        return { requestId: "r", projects: projectEntries };
      },
      subscribe: (handler) => {
        calls.push("projects.subscribe");
        return local(handlers.projects)(handler);
      },
    },
    observeEvents: (events) => {
      calls.push("observeEvents");
      observed.push(events);
      return ownedSub("events", null);
    },
    agentsList: () => currentAgents,
    emitAgent: (payload) => deliver(handlers.agents, payload),
    emitWorkspace: (payload) => deliver(handlers.workspaces, payload),
    emitProject: (payload) => deliver(handlers.projects, payload),
    emitTimeline: (agentId, message) => {
      for (const record of [...timelineLive]) if (record.id === agentId) record.handler(message);
    },
    // Replaces the agents the fake lists and hands the new first page to every live agent-list observer (the daemon restore hook).
    restoreAgents: (entries) => {
      currentAgents = entries;
      for (const sub of [...owned]) if (sub.kind === "agents") for (const observer of [...sub.observers]) observer.snapshot({ ...agentsResult({}), subscriptionId: sub.subscriptionId });
    },
    restoreWorkspaces: (entries) => {
      currentWorkspaces = entries;
      for (const sub of [...owned]) if (sub.kind === "workspaces") for (const observer of [...sub.observers]) observer.snapshot({ ...workspacesResult(), subscriptionId: sub.subscriptionId });
    },
    restoreTimeline: (agentId) => {
      for (const record of [...timelineLive]) if (record.id === agentId) record.handler({ agentId, subscriptionId: "restored", event: { type: "subscription_restored" } });
    },
    // The three list calls resolve only after the returned release function runs; they are still recorded.
    holdLists: () => {
      let open;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      return () => {
        gate = null;
        open();
      };
    },
    // Local handlers plus unreleased owned subscriptions plus live timeline subscriptions.
    liveSubscriptions: () => handlers.agents.size + handlers.workspaces.size + handlers.projects.size + owned.size + timelineLive.size,
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
