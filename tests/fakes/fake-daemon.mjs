// FDC: an in-memory Paseo daemon client for offline tests. Implements the subset of the CLI's DaemonClient that
// paseo-client uses, records every call, and plays scripted turns (see docs/INTERFACES.md section 10).
import { randomUUID } from "node:crypto";
import { PARENT_LABEL, TESTED_PASEO_CLI } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { realClock } from "../../ship/.agents/harness/lib/proc.mjs";

const macrotask = () => new Promise((resolve) => setImmediate(resolve));
const DEFAULT_STEPS = () => [{ reply: "ok", usage: { inputTokens: 10, outputTokens: 5 } }];

export function createFakeDaemon({
  clock = realClock,
  version = TESTED_PASEO_CLI,
  cliDir = "/fake/paseo-cli",
  models = {},
  capabilities = { agentDisallowedTools: false },
  responder = DEFAULT_STEPS,
  down = null,
} = {}) {
  const agents = new Map();
  const turns = new Map();
  const lastMessages = new Map();
  const timelines = new Map();
  const handlers = new Set();
  const observed = new Set();
  const failures = new Map();
  const withheld = new Map();
  const calls = [];
  const catalogues = { ...models };
  let respond = responder;
  let eventSeq = 0;
  let turnSeq = 0;
  let permSeq = 0;

  const iso = () => new Date(clock.now()).toISOString();
  const snapshot = (agent) => structuredClone(agent);

  function record(method, args) {
    calls.push({ method, args: structuredClone(args) });
    const error = failures.get(method);
    if (error) {
      failures.delete(method);
      throw error;
    }
  }

  function need(id) {
    const agent = agents.get(id);
    if (!agent) throw new Error(`agent ${id} not found`);
    return agent;
  }

  function emit(agentId, event) {
    if (event.type === "timeline") timelines.get(agentId)?.push({ item: structuredClone(event.item) });
    if (!observed.has(agentId)) return;
    const message = { type: "agent_stream", payload: { agentId, seq: ++eventSeq, event: structuredClone(event) } };
    for (const h of handlers) if (h.type === "agent_stream" || h.type === null) h.fn(message);
  }

  function settle(turn) {
    const waiters = turn.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  function startTurn(agent, text, kind) {
    const previous = turns.get(agent.id);
    if (previous) settle(previous);
    const turn = { steps: respond(snapshot(agent), text, { turn: (previous?.index ?? 0) + 1, kind }) ?? [], i: 0, index: (previous?.index ?? 0) + 1, waiters: [], state: "running" };
    turns.set(agent.id, turn);
    Object.assign(agent, { status: "running", updatedAt: iso(), lastUserMessageAt: iso(), lastError: null });
    lastMessages.set(agent.id, null);
    macrotask().then(() => runSteps(agent, turn));
  }

  function finishIdle(agent, turn, reply, usage, lateUsage) {
    const turnId = `turn-${++turnSeq}`;
    Object.assign(agent, { status: "idle", updatedAt: iso(), lastUsage: usage ?? agent.lastUsage });
    lastMessages.set(agent.id, reply);
    turn.state = "done";
    // lateUsage withholds the event; the test delivers it later with fake.emitLate(agentId).
    const event = { type: "turn_completed", turnId, usage: usage ?? {} };
    if (lateUsage) withheld.set(agent.id, event);
    else emit(agent.id, event);
    settle(turn);
  }

  function runSteps(agent, turn) {
    if (turns.get(agent.id) !== turn || turn.state !== "running") return;
    while (turn.i < turn.steps.length) {
      const step = turn.steps[turn.i++];
      if (step.tool) {
        emit(agent.id, { type: "timeline", item: step.tool });
        continue;
      }
      if (step.reply !== undefined) return finishIdle(agent, turn, step.reply, step.usage, step.lateUsage);
      if (step.error !== undefined) {
        Object.assign(agent, { status: "error", lastError: step.error, updatedAt: iso() });
        turn.state = "done";
        return settle(turn);
      }
      if (step.permission) {
        agent.pendingPermissions = [{ id: `perm-${++permSeq}`, name: step.permission.name, kind: step.permission.kind ?? "tool" }];
        turn.state = "permission";
        return settle(turn);
      }
      if (step.status) {
        Object.assign(agent, { status: step.status, updatedAt: iso() });
        turn.state = "done";
        return settle(turn);
      }
      if (step.hang) {
        turn.state = "hang";
        return settle(turn);
      }
      if (step.manual) return void (turn.state = "manual");
      throw new Error(`fake daemon: unknown step ${JSON.stringify(step)}`);
    }
    finishIdle(agent, turn, "", undefined, false);
  }

  function result(agent) {
    const final = snapshot(agent);
    if (agent.pendingPermissions?.length) return { status: "permission", final, error: null, lastMessage: null };
    if (agent.status === "idle") return { status: "idle", final, error: null, lastMessage: lastMessages.get(agent.id) ?? null };
    if (agent.status === "error") return { status: "error", final, error: agent.lastError, lastMessage: null };
    return { status: agent.status, final, error: null, lastMessage: null };
  }

  const client = {
    async createAgent(options) {
      record("createAgent", [options]);
      const agent = {
        id: randomUUID(), provider: options.provider, model: options.model, cwd: options.cwd, title: options.title ?? null,
        labels: { ...(options.labels ?? {}) }, thinkingOptionId: options.thinkingOptionId ?? null, features: options.featureValues ?? {},
        createdAt: iso(), updatedAt: iso(), lastUserMessageAt: null, archivedAt: null, status: "idle", pendingPermissions: [],
        lastUsage: undefined, lastError: null,
      };
      agents.set(agent.id, agent);
      timelines.set(agent.id, []);
      if (options.initialPrompt !== undefined) startTurn(agent, options.initialPrompt, "create");
      return snapshot(agent);
    },
    async sendAgentMessage(agentId, text) {
      record("sendAgentMessage", [agentId, text]);
      const agent = need(agentId);
      if (agent.archivedAt) throw new Error(`agent ${agentId} is archived`);
      startTurn(agent, text, "send");
    },
    async waitForFinish(agentId, timeoutMs) {
      record("waitForFinish", [agentId, timeoutMs]);
      const agent = need(agentId);
      const turn = turns.get(agentId);
      if (!turn || (turn.state !== "running" && turn.state !== "hang" && turn.state !== "manual")) return result(agent);
      if (turn.state === "hang") {
        await clock.sleep(timeoutMs);
        return { status: "timeout", final: snapshot(agent), error: null, lastMessage: null };
      }
      let timer;
      const timedOut = await new Promise((resolve) => {
        turn.waiters.push(() => resolve(false));
        timer = clock.setTimeout(() => resolve(true), timeoutMs);
      });
      clock.clearTimeout(timer);
      if (!timedOut && turn.state === "hang") {
        await clock.sleep(timeoutMs);
        return { status: "timeout", final: snapshot(agent), error: null, lastMessage: null };
      }
      return timedOut ? { status: "timeout", final: snapshot(agent), error: null, lastMessage: null } : result(agent);
    },
    async fetchAgent(arg) {
      const agentId = typeof arg === "string" ? arg : arg?.agentId;
      record("fetchAgent", [agentId]);
      const agent = agents.get(agentId);
      return agent ? { agent: snapshot(agent) } : null;
    },
    async fetchAgents(options = {}) {
      record("fetchAgents", [options]);
      const want = options.filter?.labels ?? {};
      const entries = [...agents.values()]
        .filter((a) => Object.entries(want).every(([k, v]) => a.labels?.[k] === v))
        .map((a) => ({ agent: snapshot(a) }));
      return { entries };
    },
    async archiveAgent(agentId) {
      record("archiveAgent", [agentId]);
      const agent = need(agentId);
      Object.assign(agent, { archivedAt: iso(), status: "closed", updatedAt: iso() });
      const turn = turns.get(agentId);
      if (turn) settle(turn);
      return { archivedAt: agent.archivedAt };
    },
    async cancelAgent(agentId) {
      record("cancelAgent", [agentId]);
      const agent = need(agentId);
      const turn = turns.get(agentId);
      if (agent.status !== "running") return;
      Object.assign(agent, { status: "idle", pendingPermissions: [], updatedAt: iso() });
      lastMessages.set(agentId, null);
      if (turn) {
        turn.state = "done";
        settle(turn);
      }
    },
    async updateAgent(agentId, updates = {}) {
      record("updateAgent", [agentId, updates]);
      const agent = need(agentId);
      if (updates.labels) agent.labels = { ...agent.labels, ...updates.labels };
      if (updates.name !== undefined) agent.title = updates.name;
      agent.updatedAt = iso();
    },
    async setAgentModel(agentId, model) {
      record("setAgentModel", [agentId, model]);
      const agent = need(agentId);
      if (!fake.ignoreModelUpdates) agent.model = model;
    },
    async setAgentThinkingOption(agentId, thinkingOptionId) {
      record("setAgentThinkingOption", [agentId, thinkingOptionId]);
      need(agentId).thinkingOptionId = thinkingOptionId;
    },
    async respondToPermission(agentId, requestId, response) {
      record("respondToPermission", [agentId, requestId, response]);
      const agent = need(agentId);
      agent.pendingPermissions = (agent.pendingPermissions ?? []).filter((p) => p.id !== requestId);
      const turn = turns.get(agentId);
      if (turn?.state === "permission" && !agent.pendingPermissions.length) {
        turn.state = "running";
        macrotask().then(() => runSteps(agent, turn));
      }
    },
    async listProviderModels(provider) {
      record("listProviderModels", [provider]);
      const entry = catalogues[provider];
      if (entry instanceof Error) throw entry;
      // The daemon's failure reply: no models, the reason in `error` (the provider entry is in error or not ready).
      if (entry?.error) return { provider, error: entry.error, fetchedAt: iso() };
      return { models: structuredClone(entry ?? []) };
    },
    observeTimeline(agentIds) {
      record("observeTimeline", [agentIds]);
      for (const id of agentIds) observed.add(id);
      return { ready: Promise.resolve() };
    },
    async fetchAgentTimeline(agentId, options = {}) {
      record("fetchAgentTimeline", [agentId, options]);
      const entries = timelines.get(agentId) ?? [];
      // limit 0 means every row; a tail page is the newest rows and hasOlder says whether any were left out.
      const limit = options.limit || entries.length;
      return { entries: structuredClone(entries.slice(-limit)), hasOlder: entries.length > limit };
    },
    on(typeOrHandler, maybeHandler) {
      const h = typeof typeOrHandler === "function" ? { type: null, fn: typeOrHandler } : { type: typeOrHandler, fn: maybeHandler };
      handlers.add(h);
      return () => handlers.delete(h);
    },
    async close() {
      calls.push({ method: "close", args: [] });
    },
  };

  const fake = {
    client,
    calls,
    agents,
    ignoreModelUpdates: false,
    daemon: {
      async connect() {
        if (down) throw new Error(`Cannot connect to daemon at fake: ${down}`);
        return { client, version, cliDir, capabilities, reply: async ({ agentId, lastMessage }) => lastMessage ?? lastMessages.get(agentId) ?? "" };
      },
    },
    callsOf: (method) => calls.filter((c) => c.method === method),
    setResponder(fn) {
      respond = fn;
    },
    setModels(provider, list) {
      catalogues[provider] = list;
    },
    failNext(method, error) {
      failures.set(method, error);
    },
    addAgent(partial = {}) {
      const id = partial.id ?? randomUUID();
      const labels = { ...(partial.labels ?? {}) };
      if (partial.parent) labels[PARENT_LABEL] = partial.parent;
      const { parent, ...rest } = partial;
      const agent = {
        id, title: id.slice(0, 8), provider: "circle-agent", model: "m", cwd: "/fake", status: "idle",
        createdAt: iso(), updatedAt: iso(), lastUserMessageAt: null, archivedAt: null, pendingPermissions: [], lastUsage: undefined,
        lastError: null, ...rest, labels,
      };
      agents.set(id, agent);
      timelines.set(id, []);
      if (agent.status === "running") turns.set(id, { steps: [], i: 0, index: 0, waiters: [], state: "manual" });
      return snapshot(agent);
    },
    finish(agentId, steps) {
      const turn = turns.get(agentId);
      if (!turn) throw new Error(`fake daemon: no turn for ${agentId}`);
      Object.assign(turn, { steps, i: 0, state: "running" });
      macrotask().then(() => runSteps(need(agentId), turn));
    },
    emit,
    emitToolCall: (agentId, item) => emit(agentId, { type: "timeline", item }),
    emitLate(agentId) {
      const event = withheld.get(agentId);
      withheld.delete(agentId);
      if (event) emit(agentId, event);
    },
  };
  return fake;
}
