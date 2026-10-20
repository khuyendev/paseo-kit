// The workflow engine (FLOW-43): runs one script with the globals of FLOW-03..FLOW-11 and hands every live agent()
// call to the injected host. No Paseo code here; the Paseo-backed host is runner.mjs.
import path from "node:path";
import { parseScript, runBody } from "./script.mjs";
import { checkSchema } from "./schema.mjs";
import { cacheKey, createJournal } from "./journal.mjs";
import { runShell } from "./shell.mjs";
import { errText } from "../lib/cli.mjs";

export const MAX_ITEMS_PER_CALL = 4096;
export const AGENT_OPTIONS = Object.freeze(["label", "phase", "schema", "agentType", "role", "model", "effort", "isolation", "readOnly", "cwd", "keep", "session"]);
const SHELL_OPTIONS = new Set(["cwd", "input", "timeoutS", "tailChars"]);
// Fixed by a session's first call (FLOW-47); model and effort may change.
const SESSION_FIXED = ["agentType", "roleHash", "role", "readOnly", "cwd", "isolation", "provider"];

class Semaphore {
  constructor(n) {
    this.free = n;
    this.waiters = [];
  }

  async acquire() {
    if (this.free > 0) {
      this.free--;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.free++;
  }
}

function checkAgentOptions(opts) {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) throw new Error("agent(): options must be an object");
  for (const k of Object.keys(opts)) if (!AGENT_OPTIONS.includes(k)) throw new Error(`agent(): unknown option '${k}'`);
  if (opts.schema !== undefined) checkSchema(opts.schema);
  if (opts.isolation !== undefined && opts.isolation !== "worktree") throw new Error("agent(): isolation must be 'worktree'");
  if (opts.session !== undefined && (typeof opts.session !== "string" || !opts.session)) throw new Error("agent(): session must be a non-empty string");
  for (const k of ["label", "phase", "agentType", "role", "model", "effort", "cwd"]) {
    if (opts[k] !== undefined && typeof opts[k] !== "string") throw new Error(`agent(): ${k} must be a string`);
  }
}

const fmtCost = (usd) => (typeof usd === "number" ? String(Math.round(usd * 10000) / 10000) : "?");
const shellText = (cmd) => (Array.isArray(cmd) ? cmd.map(String).join(" ") : String(cmd));

/**
 * o = {source, scriptPath, args, runId, root, env, limits: {maxConcurrent, maxAgents, budgetTotal, shellTimeoutS},
 *      journalPath, cache, out, resolveChild(ref) -> {source, scriptPath}, extraSpent() -> tokens,
 *      host: {identify({prompt, opts}), admit(spec), adopt(entry, spec), runner(spec)}}
 * host.identify is synchronous (occurrence numbers are assigned at call time) and returns
 * {roleHash, model, effort, provider} or {error}; it throws configuration errors.
 * host.admit(spec without n) resolves {release()} or {reason} (a named null, FLOW-14); the runner gets it as
 * spec.admission.
 */
export async function runWorkflow(o) {
  const { limits, host, out } = o;
  const budgetTotal = limits.budgetTotal ?? null;
  const state = { sem: new Semaphore(Math.max(1, limits.maxConcurrent)), seq: 0, shellSeq: 0, started: 0, spent: 0, ok: 0, nulls: 0, cached: 0, costUsd: null, keyCount: new Map(), sessions: new Map() };
  const cache = o.cache ?? new Map();
  const journal = createJournal(o.journalPath);
  const pending = new Set();
  const spent = () => state.spent + (o.extraSpent?.() ?? 0);

  const checkBudget = () => {
    if (budgetTotal !== null && spent() >= budgetTotal) throw new Error(`budget exhausted: spent ${spent()} of ${budgetTotal} tokens`);
  };
  const checkCap = () => {
    if (state.started >= limits.maxAgents) throw new Error(`agent cap reached: ${limits.maxAgents} agents in this run`);
  };

  function checkSession(key, opts, identity) {
    const props = { agentType: opts.agentType ?? null, roleHash: identity.roleHash ?? null, role: opts.role ?? null, readOnly: opts.readOnly === true, cwd: opts.cwd ?? null, isolation: opts.isolation ?? null, provider: identity.provider ?? null };
    const first = state.sessions.get(key);
    if (!first) return void state.sessions.set(key, props);
    for (const p of SESSION_FIXED) {
      if (first[p] !== props[p]) throw new Error(`session ${key} cannot change ${p === "roleHash" ? "agentType" : p}; use a new session key`);
    }
  }

  function finish(base, r) {
    const ok = r.status === "ok";
    if (ok) state.ok++;
    else state.nulls++;
    const cost = r.usage?.costUsd;
    if (typeof cost === "number") state.costUsd = (state.costUsd ?? 0) + cost;
    const reason = ok ? null : (r.reason ?? "unknown");
    journal({ ...base, agentId: r.agentId ?? null, model: r.model ?? null, status: ok ? "ok" : "null", reason, result: ok ? r.result : null, tokens: r.tokens ?? 0, usage: r.usage ?? null, duration_s: r.durationS ?? null, ...(r.worktree ? { worktree: r.worktree } : {}) });
    out(`agent done #${base.n} ${base.label} ${ok ? "ok" : `null (${reason})`} tokens=${r.tokens ?? 0} cost=${fmtCost(cost)} ${r.durationS ?? "?"}s`);
  }

  async function callAgent(prompt, opts, meta, currentPhase) {
    checkAgentOptions(opts);
    const phase = opts.phase ?? currentPhase ?? null;
    const label = String(opts.label ?? phase ?? "agent");
    const identity = host.identify({ prompt, opts });
    if (opts.session !== undefined) checkSession(opts.session, opts, identity);
    const key = cacheKey(prompt, opts, identity);
    const occ = state.keyCount.get(key) ?? 0;
    state.keyCount.set(key, occ + 1);
    const wrap = (value) => (opts.schema ? { kind: "json", value: JSON.stringify(value) } : { kind: "text", value: String(value) });
    const base = () => ({ n: ++state.seq, key, occ, label, phase, ...(opts.session !== undefined ? { session: opts.session } : {}) });
    const spec = (n) => ({ n, runId: o.runId, workflowName: meta.name, label, phase, prompt, opts, identity });

    const hit = cache.get(`${key}#${occ}`);
    if (hit) {
      const b = base();
      state.cached++;
      journal({ ...b, agentId: hit.agentId ?? null, model: hit.model ?? null, status: "cached", reason: null, result: hit.result, tokens: 0, usage: null, duration_s: 0, ...(hit.worktree ? { worktree: hit.worktree } : {}) });
      out(`agent cached #${b.n} ${label}`);
      if (opts.session !== undefined && hit.agentId) await host.adopt(hit, spec(b.n));
      return wrap(hit.result);
    }
    checkBudget();
    checkCap();
    if (identity.error) {
      finish(base(), { status: "null", reason: identity.error, tokens: 0, durationS: 0 });
      return null;
    }
    await state.sem.acquire();
    let r;
    let admission = null;
    let b = null;
    try {
      // Queued calls recheck at admission; only already running agents can overshoot the budget.
      checkBudget();
      checkCap();
      try {
        admission = await host.admit(spec(null));
      } catch (e) {
        admission = { reason: `runner error: ${errText(e)}` };
      }
      if (admission.reason) {
        r = { status: "null", reason: admission.reason, tokens: 0, durationS: 0 };
        b = base();
      } else {
        b = base();
        state.started++;
        journal({ n: b.n, kind: "agent", key, occ, label, phase, status: "start", ...(b.session !== undefined ? { session: b.session } : {}) });
        try {
          r = await host.runner({ ...spec(b.n), admission });
        } catch (e) {
          r = { status: "null", reason: `runner error: ${errText(e)}`, tokens: 0 };
        }
      }
    } finally {
      // Tokens are charged before the slot is released, so the next waiter sees the updated pool.
      state.spent += r?.tokens ?? 0;
      admission?.release?.();
      state.sem.release();
    }
    finish(b, r);
    return r.status === "ok" ? wrap(r.result) : null;
  }

  async function callShell(cmd, opts) {
    if (!(typeof cmd === "string" || (Array.isArray(cmd) && cmd.length))) throw new Error("shell() takes a command string or a non-empty argv array");
    for (const k of Object.keys(opts)) if (!SHELL_OPTIONS.has(k)) throw new Error(`shell(): unknown option '${k}'`);
    const n = ++state.shellSeq;
    const text = shellText(cmd);
    const cwd = path.resolve(o.root, opts.cwd ?? ".");
    out(`shell start #${n} ${text.slice(0, 80)}`);
    const r = await runShell(cmd, { cwd, env: o.env, input: opts.input, timeoutS: opts.timeoutS ?? limits.shellTimeoutS, tailChars: opts.tailChars ?? 20000 });
    journal({ n, kind: "shell", cmd: text, cwd, code: r.code, duration_s: r.durationS });
    out(`shell done #${n} code=${r.code} ${r.durationS}s`);
    return r;
  }

  function track(promise) {
    const entry = { done: false };
    pending.add(entry);
    entry.promise = promise.finally(() => {
      entry.done = true;
      pending.delete(entry);
    });
    return entry.promise;
  }

  async function runScript(source, scriptPath, argsValue, depth) {
    const { meta, body } = parseScript(source);
    const titles = new Set((meta.phases ?? []).map((p) => p.title));
    let currentPhase;
    const bridge = {
      argsJson: argsValue === undefined ? undefined : JSON.stringify(argsValue),
      log: (m) => out(`log ${m}`),
      warn: (m) => out(`log warning: ${m}`),
      phase: (t) => {
        currentPhase = t;
        out(`phase ${t}`);
        if (meta.phases && !titles.has(t)) out(`log warning: phase "${t}" has no entry in meta.phases`);
      },
      checkItems: (n, what) => {
        if (n > MAX_ITEMS_PER_CALL) throw new Error(`${what}() got ${n} items; one call takes at most ${MAX_ITEMS_PER_CALL}`);
      },
      budgetTotal: () => budgetTotal,
      budgetSpent: () => spent(),
      budgetRemaining: () => (budgetTotal === null ? Infinity : Math.max(0, budgetTotal - spent())),
      agent: (prompt, optsJson) => track(callAgent(prompt, optsJson === undefined ? {} : JSON.parse(optsJson), meta, currentPhase)),
      shell: async (cmdJson, optsJson) => JSON.stringify(await callShell(JSON.parse(cmdJson), optsJson === undefined ? {} : JSON.parse(optsJson))),
      workflow: async (refJson, argsJson) => {
        if (depth >= 1) throw new Error("workflow() nesting is one level only");
        const child = o.resolveChild(JSON.parse(refJson));
        out(`log nested workflow ${child.scriptPath}`);
        const r = await runScript(child.source, child.scriptPath, argsJson === undefined ? undefined : JSON.parse(argsJson), depth + 1);
        return r.result === undefined ? undefined : JSON.stringify(r.result);
      },
    };
    const result = await runBody(body, scriptPath, bridge);
    return { meta, result };
  }

  const settleUnawaited = async () => {
    if (!pending.size) return;
    out(`log warning: ${pending.size} agent() call(s) were not awaited by the script`);
    await Promise.allSettled([...pending].map((e) => e.promise));
  };
  let run;
  try {
    run = await runScript(o.source, o.scriptPath, o.args, 0);
  } finally {
    await settleUnawaited();
  }
  return { result: run.result, meta: run.meta, stats: { started: state.started, ok: state.ok, null: state.nulls, cached: state.cached, tokens: state.spent, costUsd: state.costUsd } };
}
