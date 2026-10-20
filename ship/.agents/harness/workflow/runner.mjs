// The Paseo-backed host of the engine (FLOW-43): call identity, admission, session agents and their adoption on
// resume, and the live runner (prompt assembly, priming, schema retries, watchdog, archive) on a paseo-client Session.
import fs from "node:fs";
import path from "node:path";
import { errText } from "../lib/cli.mjs";
import { id8, samePath } from "../lib/paths.mjs";
import { createCapacity } from "./admission.mjs";
import { parseReply } from "./schema.mjs";
import { createWatchdog } from "./watchdog.mjs";

const TRANSPORT_LOST = /Transport (closed|not connected)/;
const MAX_LISTED_ERRORS = 20;

export const schemaInstruction = (schema) => `\n\nReply with only a JSON object (no other text) that matches this JSON schema:\n${JSON.stringify(schema)}`;

export function schemaRetryPrompt(errors, schema, native) {
  const listed = errors.slice(0, MAX_LISTED_ERRORS).map((e) => `- ${e}`).join("\n");
  return `Your reply did not match the required JSON schema:\n${listed}\nReply again with only the corrected JSON object.${native ? "" : schemaInstruction(schema)}`;
}

const contextOf = (u) => u?.contextWindowUsedTokens ?? (u?.inputTokens ?? 0) + (u?.cachedInputTokens ?? 0);

/**
 * session: paseo-client Session; runtime: the runtime-bridge exports; onAdopt({agentId, session, fromRun}) records an
 * adopted session agent in run.json before the next live call (FLOW-48).
 */
export function createPaseoHost({ session, cfg, runtime, root, runId, parentRunId, out, clock, onAdopt }) {
  const watchdog = createWatchdog({ session, cfg, clock, out, root });
  const capacity = createCapacity({ session, cfg, clock, out });
  const definitions = new Map();
  const sessions = new Map();
  const gates = new Map();
  const adopted = new Set();
  let transportDown = null;

  const definition = (type) => {
    if (!definitions.has(type)) definitions.set(type, runtime.loadAgentDefinition(root, type));
    return definitions.get(type);
  };

  function identify({ opts }) {
    // An invalid role is a configuration error of the script (PHCL-22); everything else is the call's null reason.
    try {
      runtime.checkRole(cfg, opts.role);
    } catch (e) {
      throw new Error(`agent(): ${errText(e)}`);
    }
    try {
      const def = opts.agentType ? definition(opts.agentType) : null;
      const sel = runtime.selectModel(cfg, { explicit: { model: opts.model, effort: opts.effort }, role: opts.role, definition: def });
      return { def, sel, model: sel.id, effort: sel.thinking ?? null, roleHash: def?.roleHash ?? "", provider: sel.provider };
    } catch (e) {
      return { error: errText(e) };
    }
  }

  async function admit(spec) {
    if (transportDown) return { release() {} };
    const needsNew = !(spec.opts.session !== undefined && sessions.has(spec.opts.session));
    try {
      return await capacity.admit({ needsNew });
    } catch (e) {
      noteTransport(e);
      return { reason: transportDown ? lostReason() : `runner error: ${errText(e)}` };
    }
  }

  async function adopt(entry, spec) {
    const key = spec.opts.session;
    sessions.set(key, { agentId: entry.agentId, worktree: entry.worktree ?? null, keep: spec.opts.keep === true, adopted: true });
    capacity.retain(entry.agentId);
    if (adopted.has(entry.agentId)) return;
    adopted.add(entry.agentId);
    await onAdopt?.({ agentId: entry.agentId, session: key, fromRun: parentRunId ?? null });
    // FLOW-48: the adopted agent now belongs to this run (ph archive --run, swarm grouping).
    await session.setLabels(entry.agentId, { "harness.run": runId }).catch((e) => out(`log warning: label of ${id8(entry.agentId)} not moved to ${runId}: ${errText(e)}`));
  }

  const lostReason = () => `daemon connection lost earlier in this run (${transportDown}); resume the run`;
  function noteTransport(e) {
    if (transportDown || !TRANSPORT_LOST.test(errText(e))) return;
    transportDown = errText(e);
    out(`log runner lost the daemon connection (${transportDown}): remaining agent() calls return null; resume the run`);
  }

  // Warm-up gate (FLOW-28): the first agent per run, type, model and thinking starts alone.
  async function passGate(def, identity) {
    const key = `${runId}|${def.type}|${identity.model}|${identity.effort ?? ""}`;
    const gate = gates.get(key);
    if (gate) {
      let timer = null;
      await Promise.race([gate.promise, new Promise((resolve) => (timer = clock.setTimeout(resolve, cfg.warmup_timeout_s * 1000)))]);
      // A pending fallback timer kept `ph workflow` alive up to 90 s after done (INV-23).
      clock.clearTimeout(timer);
      return null;
    }
    let resolve;
    const entry = { promise: new Promise((r) => (resolve = r)), timer: null };
    entry.open = () => {
      clock.clearTimeout(entry.timer);
      resolve();
    };
    gates.set(key, entry);
    return entry;
  }

  async function runner(spec) {
    const { n, opts, identity, label, workflowName, prompt, admission } = spec;
    const t0 = clock.now();
    const def = identity.def;
    const sel = identity.sel;
    const key = opts.session;
    const prior = key !== undefined ? sessions.get(key) : null;
    const readOnly = opts.readOnly === true || Boolean(def?.readOnly);
    let agentId = prior?.agentId ?? null;
    let base = null;
    let wd = null;
    let gate = null;
    let worktree = null;
    let newWorktree = false;
    let maxContext = 0;
    let ok = false;
    if (key !== undefined || opts.keep === true) admission?.keep?.();

    const usageNow = () => session.usage.get(agentId) ?? { input: 0, cachedInput: 0, output: 0, reportedCostUsd: null };
    const usageOf = () => {
      if (!agentId) return { tokens: 0, usage: null };
      const now = usageNow();
      const b = base ?? { input: 0, cachedInput: 0, output: 0 };
      const u = { input: now.input - b.input, cachedInput: now.cachedInput - b.cachedInput, output: now.output - b.output, maxContext };
      const costUsd = runtime.listPriceCost(root, identity.model, u);
      return { tokens: u.output, usage: { ...u, costUsd: costUsd ?? null, reportedCostUsd: now.reportedCostUsd ?? null } };
    };
    const durationS = () => Math.round((clock.now() - t0) / 1000);
    const result = (status, fields) => ({ status, agentId, model: identity.model, ...usageOf(), durationS: durationS(), worktreePath: worktree?.path ?? null, ...(worktree ? { worktree } : {}), ...fields });
    // opts.timeoutS bounds the whole call (all turns of it); at the deadline the call ends null and the agent is archived.
    const deadline = opts.timeoutS !== undefined ? t0 + opts.timeoutS * 1000 : null;
    const expired = () => deadline !== null && clock.now() >= deadline;
    const late = () => new Error(`no reply within ${opts.timeoutS} s`);
    const waitOpts = (before) => {
      if (deadline === null) return { turnsBefore: before };
      const left = Math.ceil((deadline - clock.now()) / 1000);
      if (left <= 0) throw late();
      // The absolute deadline also bounds waitTurn's provider-retry pauses and continue prompts (CR-WFL-05).
      return { turnsBefore: before, timeoutS: Math.min(opts.timeoutS, cfg.wait_timeout_s), deadline };
    };

    async function waitReply(turnsBefore) {
      let text = null;
      let err = null;
      const once = async (before) => {
        try {
          const r = await session.waitTurn(agentId, waitOpts(before));
          if (expired()) throw late();
          maxContext = Math.max(maxContext, contextOf(r.usage));
          text = r.text;
          err = null;
        } catch (e) {
          err = expired() ? late() : e;
        }
        if (wd?.stopReason) throw new Error(wd.stopReason);
      };
      await once(turnsBefore);
      // A stuck-tool interrupt ends the turn without a reply; wait for the watchdog's retry turn instead (FLOW-35).
      if (wd?.retry && (!err || /finished without a reply/.test(errText(err)))) {
        const retry = wd.retry;
        wd.retry = null;
        await retry;
        await once(wd.retryBase);
      }
      if (err) throw err;
      return text;
    }

    async function send(text) {
      if (expired()) throw late();
      wd?.reset();
      const before = session.turnsOf(agentId);
      await session.sendPrompt(agentId, text);
      return waitReply(before);
    }

    async function create(text, outputSchema) {
      const agent = await session.createAgent({ sel, prompt: text, title: `${workflowName}:${label}`, name: label, swarm: workflowName, run: runId, cwd, outputSchema, readOnly });
      agentId = agent.id;
      admission?.created?.(agentId);
      wd = watchdog.arm(agentId, label);
      out(`agent start #${n} ${label} ${id8(agentId)} ${identity.model}${primed ? " prime:two-turn" : ""}`);
    }

    let cwd = root;
    let primed = false;
    if (transportDown) return { status: "null", reason: lostReason(), agentId: null, model: identity.model, tokens: 0, usage: null, durationS: 0 };
    try {
      if (opts.isolation === "worktree") {
        if (prior?.worktree) {
          if (!fs.existsSync(prior.worktree.path)) throw new Error(`session worktree ${prior.worktree.path} is gone`);
          worktree = prior.worktree;
        } else {
          worktree = runtime.createWorktree(root, cfg, `${runId}-${n}`, opts.worktreeSeed);
          newWorktree = true;
        }
      }
      cwd = worktree ? worktree.path : opts.cwd ? path.resolve(root, opts.cwd) : root;
      const workdir = !worktree && !samePath(cwd, root) ? cwd : null;
      primed = !prior && Boolean(def) && cfg.prime_role === "two-turn";
      // Session agents and primed agents get the schema as prompt text; only a fresh unprimed agent gets it natively.
      const native = Boolean(opts.schema) && key === undefined && !primed;
      const task = opts.schema && !native ? `${prompt}${schemaInstruction(opts.schema)}` : prompt;
      const tag = { runId, n };
      const fullPrompt = () => runtime.composePrompt({ def, prompt: task, readOnly, worktree, workdir, cfg, root, rolePrimed: primed, tag });

      let text;
      const known = prior?.adopted ? await session.fetchAgent(agentId) : null;
      if (prior?.adopted && (!known || known.archivedAt)) {
        // The earlier run already ended this agent: start the session fresh with the full prompt (PCLI-16).
        out(`log warning: session agent ${id8(agentId)} of an earlier run is no longer live; started fresh with the full prompt`);
        agentId = null;
        await create(fullPrompt(), undefined);
        text = await waitReply(0);
      } else if (prior) {
        await session.usage.track([agentId]);
        base = usageNow();
        wd = watchdog.arm(agentId, label);
        const before = session.turnsOf(agentId);
        // Later prompts of a session carry the run tag so run-stats attributes the turn to this run (FLOW-48).
        const continuation = `${task.trim()}\n\nRun ${runId} #${n} (bookkeeping only; ignore).`;
        const fresh = { sel, prompt: fullPrompt(), title: `${workflowName}:${label}`, name: label, swarm: workflowName, run: runId, cwd, readOnly };
        const r = await session.resumeSend(agentId, { sel, prompt: continuation, create: fresh });
        if (r.created) {
          wd?.disarm();
          agentId = r.agent.id;
          base = null;
          admission?.created?.(agentId);
          wd = watchdog.arm(agentId, label);
          out(`log warning: ${r.warning}`);
        }
        text = await waitReply(r.created ? 0 : before);
      } else {
        if (cfg.warmup && def) gate = await passGate(def, identity);
        if (primed) {
          await create(runtime.rolePrompt({ def, readOnly, worktree, workdir, cfg }), undefined);
          await waitReply(0);
          gate?.open();
          text = await send(fullPrompt());
        } else {
          await create(fullPrompt(), native ? opts.schema : undefined);
          if (gate) gate.timer = clock.setTimeout(gate.open, cfg.warmup_s * 1000);
          text = await waitReply(0);
        }
      }
      if (!opts.schema) {
        ok = true;
        return result("ok", { result: text });
      }
      const seen = [];
      for (let attempt = 1; ; attempt++) {
        const { value, errors } = parseReply(text, opts.schema);
        if (!errors.length) {
          ok = true;
          return result("ok", { result: value });
        }
        seen.push(...errors.map((e) => `#${attempt} ${e}`));
        if (attempt > cfg.schema_retries) return result("null", { reason: `reply did not match the schema after ${attempt} replies: ${seen.slice(0, 3).join("; ")}` });
        text = await send(schemaRetryPrompt(errors, opts.schema, native));
      }
    } catch (e) {
      if (e.agentId && e.archived !== true) {
        agentId = e.agentId;
        admission?.created?.(agentId);
        capacity.retain(agentId);
        out(`log warning: creation cleanup unconfirmed for ${agentId}; retaining its worktree`);
      }
      noteTransport(e);
      return result("null", { reason: errText(e) });
    } finally {
      wd?.disarm();
      gate?.open();
      await settle();
    }

    async function settle() {
      if (!agentId) {
        if (newWorktree) {
          try {
            runtime.removeWorktree(worktree);
          } catch (e) {
            out(`log warning: worktree ${worktree.path} not removed: ${errText(e)}`);
          }
        }
        return;
      }
      const archive = async () => {
        try {
          if (!wd?.archived) await session.archive(agentId);
          capacity.unretain(agentId);
        } catch (e) {
          capacity.retain(agentId);
          out(`log warning: archive ${id8(agentId)} failed: ${errText(e)}`);
        }
      };
      if (key !== undefined) {
        if (ok) {
          sessions.set(key, { agentId, worktree, keep: opts.keep === true || prior?.keep === true });
          capacity.retain(agentId);
          return;
        }
        // A failed session call ends its agent; the next call with the key starts a new one (FLOW-12).
        sessions.delete(key);
        capacity.unretain(agentId);
        await archive();
        return;
      }
      if (opts.keep === true) capacity.retain(agentId);
      else await archive();
    }
  }

  // Run end (done, failed or stopped): every session agent is archived unless kept (FLOW-12).
  async function finish() {
    for (const s of sessions.values()) {
      if (s.keep) continue;
      await session.archive(s.agentId).catch((e) => out(`log warning: archive ${id8(s.agentId)} failed: ${errText(e)}`));
    }
    sessions.clear();
    watchdog.close();
  }

  return { identify, admit, adopt, runner, finish, watchdog };
}
