// The only module that talks to the Paseo daemon (PCLI-01). Everything else uses a Session from connect().
import { loadConfig, configRoot } from "../config.mjs";
import { UsageError, errText } from "../lib/cli.mjs";
import { id8 } from "../lib/paths.mjs";
import { realClock } from "../lib/proc.mjs";
import { assertPromptSize, clampThinking, promptBytes } from "./limits.mjs";
import { daemonTarget, findCliDir, loadRealDaemon } from "./locate.mjs";
import { filePluginState, pluginEnv, workerProviderEnv } from "./plugins.mjs";
import { UsageTracker } from "./usage.mjs";

export { assertPromptSize, clampThinking, promptBytes, daemonTarget, findCliDir, filePluginState, pluginEnv, workerProviderEnv, UsageTracker };

export const TESTED_PASEO_CLI = "0.11.2";
export const PARENT_LABEL = "paseo.parent-agent-id";
export const CONTINUE_PROMPT = "Your previous turn ended with an error. Continue the task from where you stopped.";
export const NO_OWNER_REPLY = "Nobody answers questions from subagents. Do not ask: decide from the material you were given if it settles the point; otherwise record the decision as open in your result the way your instructions say (for example a skipped item with needs_owner and the options), and finish the rest of your task.";
export const RETRY_PAUSES_S = Object.freeze([30, 60, 120, 240, 300]);
export const READ_ONLY_DENIED_TOOLS = Object.freeze([
  "Edit", "Write", "MultiEdit", "NotebookEdit", "mcp__harness-files__edit_multiple_files", "mcp__harness-files__write_multiple_files",
]);

const TITLE_MAX = 60;
const MAX_QUESTIONS_DENIED = 3;
// Retrying these burns the remaining quota and never helps (INV-13).
const NON_RETRYABLE = /quota|credit|billing|auth|unauthori[sz]ed|forbidden|permission|invalid api key/i;
const TRANSIENT_REPLY = /overloaded|rate limit|\b5\d\d\b|\b429\b/i;
const isQuestion = (p) => /AskUserQuestion/i.test(`${p?.name ?? ""} ${p?.kind ?? ""}`);

// A reply that is really a provider error ("API Error ...", a one-line overload/rate-limit text) (HIS-15).
function providerErrorReply(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return t.startsWith("API Error") || (!t.includes("\n") && t.length < 300 && TRANSIENT_REPLY.test(t));
}

const realDaemon = (env) => ({ connect: () => loadRealDaemon(env) });

export async function connect({ env = process.env, root, cfg, clock = realClock, daemon } = {}) {
  const projectRoot = root ?? configRoot(env);
  const config = cfg ?? loadConfig(projectRoot);
  const loaded = await (daemon ?? realDaemon(env)).connect();
  return new Session({ ...loaded, env, root: projectRoot, cfg: config, clock });
}

export class Session {
  constructor({ client, version, cliDir, reply, capabilities, env, root, cfg, clock }) {
    Object.assign(this, { client, version, cliDir, env, root, cfg, clock });
    this.reply = reply;
    this.capabilities = { agentDisallowedTools: false, ...capabilities };
    this.caller = env.PASEO_AGENT_ID?.trim() || null;
    this.leader = env.PASEO_HARNESS_LEADER?.trim() || null;
    this.usage = new UsageTracker(client, clock);
    this.catalogues = new Map();
  }

  requireCaller() {
    if (!this.caller) throw new UsageError("PASEO_AGENT_ID is not set: run ph from an agent inside Paseo, so every agent is created as its subagent");
    return this.caller;
  }

  async createAgent({ sel, prompt, title, name, swarm, run, labels = {}, cwd = this.root, outputSchema, readOnly = false }) {
    assertPromptSize(prompt, this.cfg);
    const caller = this.requireCaller();
    const env = { ...pluginEnv(this.root, sel.provider, this.env), PASEO_HARNESS_LEADER: caller, PASEO_HARNESS_ROOT: this.root, PASEO_HARNESS_ROLE: "worker" };
    const thinking = clampThinking(sel.thinking, await this.thinkingIds(sel.provider, sel.model));
    const features = sel.features && Object.keys(sel.features).length ? sel.features : null;
    const extra = { ...labels };
    delete extra[PARENT_LABEL];
    const request = {
      provider: sel.provider,
      model: sel.model,
      cwd,
      callerAgentId: caller,
      title: String(title).slice(0, TITLE_MAX),
      modeId: this.cfg.mode,
      ...(thinking ? { thinkingOptionId: thinking } : {}),
      initialPrompt: prompt,
      ...(outputSchema ? { outputSchema } : {}),
      ...(features ? { featureValues: features } : {}),
      ...(readOnly && this.capabilities.agentDisallowedTools ? { disallowedTools: [...READ_ONLY_DENIED_TOOLS] } : {}),
      env,
      // The parent label goes last so no caller-supplied label can replace it (PCLI-08, INV-10).
      labels: { ...extra, "harness.name": name, ...(run ? { "harness.run": run } : {}), "ph.swarm": swarm, [PARENT_LABEL]: caller },
    };
    const agent = await this.client.createAgent(request);
    try {
      await this.usage.track([agent.id]);
    } catch (e) {
      // CR-FND-02: callers may drop the agent's worktree only when the archive is confirmed; otherwise it may still be live.
      let archived = false;
      let archiveError;
      try {
        await this.client.archiveAgent(agent.id);
        archived = true;
      } catch (err) {
        archiveError = err;
      }
      const cleanup = archived ? "archived" : `archive failed, agent may still be live: ${errText(archiveError)}`;
      throw Object.assign(new Error(`agent ${id8(agent.id)} created but its usage tracking failed (${cleanup}): ${errText(e)}`, { cause: e }), {
        agentId: agent.id,
        archived,
        archiveError,
      });
    }
    return agent;
  }

  async sendPrompt(agentId, text) {
    assertPromptSize(text, this.cfg);
    await this.client.sendAgentMessage(agentId, text);
    this.usage.expireLate(agentId);
  }

  turnsOf(agentId) {
    return this.usage.turnsOf(agentId);
  }

  waitForFinish(agentId, timeoutMs) {
    return this.client.waitForFinish(agentId, timeoutMs);
  }

  async replyText(agentId, lastMessage = null) {
    return this.reply({ client: this.client, agentId, lastMessage });
  }

  async continueAfterError(agentId, attempt, leftMs = () => Infinity) {
    const pause = RETRY_PAUSES_S[attempt] * 1000;
    if (pause >= leftMs()) return null;
    await this.clock.sleep(pause);
    if (leftMs() <= 0) return null;
    const base = this.turnsOf(agentId);
    await this.sendPrompt(agentId, CONTINUE_PROMPT);
    return base;
  }

  // PCLI-12..14: one finished turn, provider errors continued in the same agent, questions denied.
  // `deadline` (ms on session.clock) bounds every wait, retry pause and continuation; timeoutS bounds each wait.
  // `keepWaiting()` (G144): a slice that ends with the agent still in its turn (a timeout, or a message that settled
  // the wait as running) waits again while it returns true; the caller makes it false to end the wait.
  async waitTurn(agentId, { timeoutS = this.cfg.wait_timeout_s, turnsBefore, deadline = null, keepWaiting = null } = {}) {
    let retries = 0;
    let questions = 0;
    let base = turnsBefore ?? this.turnsOf(agentId);
    const leftMs = () => (deadline === null ? Infinity : deadline - this.clock.now());
    const timedOut = () => new Error(`no reply within ${timeoutS} s`);
    // CR-FND-03: a retry past the caller's whole-call deadline is a timeout, not a fresh full wait.
    const retry = async (text) => {
      if (NON_RETRYABLE.test(text) || retries >= RETRY_PAUSES_S.length) throw new Error(`agent error: ${errText(text)}`);
      const next = await this.continueAfterError(agentId, retries++, leftMs);
      if (next === null) throw timedOut();
      base = next;
    };
    for (;;) {
      const waitMs = Math.min(timeoutS * 1000, leftMs());
      if (waitMs <= 0) throw timedOut();
      const st = await this.client.waitForFinish(agentId, waitMs);
      if (leftMs() <= 0) throw timedOut();
      if (keepWaiting && (st.status === "timeout" || st.status === "running") && keepWaiting()) continue;
      if (st.status === "idle") {
        await this.usage.settleTurn(agentId, base, st.final?.lastUsage, deadline ?? Infinity);
        if (leftMs() <= 0) throw timedOut();
        const text = await this.replyText(agentId, st.lastMessage);
        if (leftMs() <= 0) throw timedOut();
        if (providerErrorReply(text)) {
          await retry(text);
          continue;
        }
        if (!String(text ?? "").trim()) throw new Error("finished without a reply");
        return { text, usage: st.final?.lastUsage ?? {}, agent: st.final };
      }
      if (st.status === "error") {
        await retry(st.error ?? st.final?.lastError ?? "unknown error");
        continue;
      }
      if (st.status === "timeout") throw timedOut();
      if (st.status === "permission") {
        const pending = st.final?.pendingPermissions ?? (await this.fetchAgent(agentId))?.pendingPermissions ?? [];
        if (pending.length && pending.every(isQuestion) && questions < MAX_QUESTIONS_DENIED) {
          questions++;
          for (const p of pending) {
            if (leftMs() <= 0) throw timedOut();
            await this.client.respondToPermission(agentId, p.id, { behavior: "deny", message: NO_OWNER_REPLY });
          }
          continue;
        }
        // The caller's run archives the agent right after this failure (FLOW-25), so the reason says it was stopped.
        const blocking = pending.find((p) => !isQuestion(p)) ?? pending[0];
        throw new Error(`agent stopped: permission${blocking ? ` ${blocking.name ?? blocking.kind}` : ""} was not granted`);
      }
      throw new Error(`agent status ${st.status}`);
    }
  }

  async fetchAgent(agentId) {
    const res = await this.client.fetchAgent({ agentId });
    return res?.agent ?? null;
  }

  async listAgents(parentId = this.caller) {
    if (!parentId) return [];
    return this.findAgents({ [PARENT_LABEL]: parentId });
  }

  // Live agents carrying every given label, across orchestrators (PHCL-32 asks whether a named agent still exists).
  async findAgents(labels = {}) {
    const agents = new Map();
    const seen = new Set();
    let cursor;
    for (let page = 0; page < 1000; page++) {
      const res = await this.client.fetchAgents({ filter: { labels }, ...(cursor ? { page: { cursor } } : {}) });
      if (!Array.isArray(res?.entries)) throw new Error("daemon agent listing is incomplete (missing entries)");
      for (const { agent } of res.entries) if (agent && !agent.archivedAt && Object.entries(labels).every(([k, v]) => agent.labels?.[k] === v)) agents.set(agent.id, agent);
      if (!res.pageInfo?.hasMore) return [...agents.values()];
      cursor = res.pageInfo.nextCursor;
      if (!cursor || seen.has(cursor)) throw new Error("daemon agent listing is incomplete (no new page cursor)");
      seen.add(cursor);
    }
    throw new Error("daemon agent listing exceeds 1000 pages");
  }

  // Adds or replaces labels of an agent (FLOW-48 moves an adopted session agent's `harness.run` to the new run).
  async setLabels(agentId, labels) {
    await this.client.updateAgent(agentId, { labels });
  }

  // PCLI-15: the caller's live subagents, then the leader's; no fallback outside these pools.
  async resolveTargets(refs) {
    if (!refs.length) throw new UsageError("name at least one agent (title, id or unique id prefix)");
    const pools = [await this.listAgents(this.caller)];
    if (this.leader && this.leader !== this.caller) pools.push(await this.listAgents(this.leader));
    return refs.map((ref) => {
      for (const pool of pools) {
        const byId = pool.filter((a) => a.id === ref || (ref.length >= 6 && a.id.startsWith(ref)));
        const matches = byId.length ? byId : pool.filter((a) => a.title === ref);
        if (matches.length > 1) throw new UsageError(`'${ref}' matches ${matches.length} agents; use the id`);
        if (matches.length === 1) return matches[0];
      }
      throw new UsageError(`no live subagent named or id '${ref}'`);
    });
  }

  async archive(agentId) {
    await this.client.archiveAgent(agentId);
  }

  async cancel(agentId) {
    await this.client.cancelAgent(agentId);
  }

  async setModel(agentId, model) {
    await this.client.setAgentModel(agentId, model);
    const got = (await this.fetchAgent(agentId))?.model ?? null;
    if (got !== model) throw new Error(`model readback ${model} != ${got}`);
  }

  // F45B: the thinking level of a live agent, clamped to the levels its model offers (PCLI-10); no level (null) clears it.
  // False when the model offers none of the level asked for, and nothing is set.
  async setThinking(agentId, { provider, model, thinking }) {
    const id = thinking === undefined || thinking === null ? null : clampThinking(thinking, await this.thinkingIds(provider, model));
    if (id === undefined) return false;
    await this.client.setAgentThinkingOption(agentId, id);
    return true;
  }

  // PCLI-16: send to an existing session agent, or start it fresh with the full prompt when the daemon forgot it.
  async resumeSend(agentId, { sel, prompt, create }) {
    const agent = await this.fetchAgent(agentId);
    if (!agent) {
      const fresh = await this.createAgent(create);
      return { agent: fresh, created: true, warning: `agent ${id8(agentId)} is no longer known to the daemon; started ${id8(fresh.id)} fresh with the full prompt` };
    }
    if (agent.status === "running" || agent.activeTurn) throw new Error(`agent ${id8(agentId)} has an active turn`);
    if (sel?.provider && agent.provider !== sel.provider) throw new Error(`agent ${id8(agentId)} runs on ${agent.provider}, not ${sel.provider}`);
    if (sel?.model && agent.model !== sel.model) await this.setModel(agentId, sel.model);
    await this.sendPrompt(agentId, prompt);
    return { agent, created: false, warning: null };
  }

  // A failed read throws, so the caller cannot mistake it for an empty timeline. hasOlder says entries were cut off.
  async timeline(agentId, { limit = 1000 } = {}) {
    const res = await this.client.fetchAgentTimeline(agentId, { direction: "tail", limit });
    return { entries: res?.entries ?? [], hasOlder: res?.hasOlder ?? false };
  }

  async observe(agentIds) {
    await this.client.observeTimeline(agentIds).ready;
  }

  onAgentStream(handler) {
    return this.client.on("agent_stream", (message) => handler(message?.payload ?? message));
  }

  // {models, error}: a failed lookup (a rejected request, or the daemon's error reply with no models) is not an empty
  // catalogue, so the reason stays with it for doctor. Cached per provider per session.
  async providerCatalogue(provider) {
    if (!this.catalogues.has(provider)) {
      const reply = await this.client.listProviderModels(provider).catch((e) => ({ error: errText(e) }));
      const error = reply?.error || (Array.isArray(reply?.models) ? null : "the reply has no model list");
      this.catalogues.set(provider, { models: error ? [] : reply.models, error });
    }
    return this.catalogues.get(provider);
  }

  async providerModels(provider) {
    return (await this.providerCatalogue(provider)).models;
  }

  async thinkingIds(provider, model) {
    const entry = (await this.providerModels(provider)).find((m) => m.id === model);
    return (entry?.thinkingOptions ?? []).map((o) => o.id);
  }

  async close() {
    await this.client.close?.().catch(() => {});
  }
}
