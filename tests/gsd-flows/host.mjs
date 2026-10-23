// Fake workflow host for the GSD scripts: evaluates a `.agents/workflows/*.js` script with the FLOW-01..11
// globals, a scripted agent responder and a fake `ph gsd`; `gsd-flow.mjs` runs for real in-process against
// the temp project, other argv (git) runs as a real process in the project root. No daemon, no network.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { createWorktree } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { AGENT_OPTIONS } from "../../ship/.agents/harness/workflow/engine.mjs";

const WORKFLOWS = path.join(SHIP_DIR, ".agents", "workflows");
const flowMod = await import(pathToFileURL(path.join(WORKFLOWS, "lib", "gsd-flow.mjs")).href);
const configMod = await import(pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "config.mjs")).href);
const AsyncFunction = (async () => {}).constructor;
// FLOW-04 options plus `detail` and `timeoutS` (as the engine).
const AGENT_OPTS = new Set(AGENT_OPTIONS);
const GROUPS = new Set(["research", "revisions", "attempt", "outline", "check", "verify", "verification", "state", "roadmap", "phase", "debug", "requirements", "init", "contracts"]);

export const NULL = (reason) => ({ __null: reason });

// Scripted `ph gsd`: handlers keyed by "group verb" (e.g. "research status") or the verb; each returns
// {code, json} (json printed as the last line) or a plain object (code 0). Unhandled verbs fail the test loudly.
export class FakeGsd {
  constructor(handlers = {}) {
    this.handlers = { hash: (_a, input) => ({ hash: `h${String(input).length}-${[...String(input)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7)}` }), ...handlers };
    this.calls = [];
  }
  on(key, fn) { this.handlers[key] = fn; return this; }
  keyOf(argv) { return GROUPS.has(argv[0]) ? `${argv[0]} ${argv[1]}` : argv[0]; }
  async call(argv, input) {
    const key = this.keyOf(argv);
    this.calls.push({ key, argv, input });
    const fn = this.handlers[key];
    if (!fn) return { code: 69, stdout: `${JSON.stringify({ status: "unavailable", verb: key, reason: "not faked" })}\n` };
    const r = await fn(argv.slice(GROUPS.has(argv[0]) ? 2 : 1), input, argv);
    const res = r && Object.hasOwn(r, "code") && Object.hasOwn(r, "json") ? r : { code: 0, json: r };
    return { code: res.code, stdout: `${JSON.stringify(res.json)}\n` };
  }
  callsOf(key) { return this.calls.filter((c) => c.key === key); }
}

function guardedGlobals() {
  const RealDate = Date;
  function GDate(...a) {
    if (!new.target || a.length === 0) throw new Error("Date() is not allowed in workflow scripts: pass times through args");
    return new RealDate(...a);
  }
  GDate.now = () => { throw new Error("Date.now() is not allowed in workflow scripts: pass times through args"); };
  GDate.UTC = RealDate.UTC;
  GDate.parse = RealDate.parse;
  const GMath = Object.create(Math);
  GMath.random = () => { throw new Error("Math.random() is not allowed in workflow scripts: vary prompts by index"); };
  return { Date: GDate, Math: GMath };
}

export function loadScript(name) {
  const file = path.join(WORKFLOWS, name.endsWith(".js") ? name : `${name}.js`);
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  if (!/^\s*export const meta\s*=/.test(text)) throw new Error(`${name}: first statement is not export const meta`);
  return text.replace(/^(\s*)export const meta/, "$1const meta");
}

// opts: {root, args, runId, agent(prompt, opts, n) -> value | NULL(reason), gsd: FakeGsd, env}
export async function runScript(name, opts) {
  const { root, runId = "wf_20261020-120000_ab12", gsd = new FakeGsd(), env = {} } = opts;
  const calls = [];
  const logs = [];
  const shells = [];
  let n = 0;
  const respond = opts.agent ?? (() => NULL("no responder"));
  const sessions = new Map();

  async function agent(prompt, o = {}) {
    for (const k of Object.keys(o)) if (!AGENT_OPTS.has(k)) throw new Error(`unknown option '${k}'`);
    const call = { n: ++n, prompt, opts: o, running: true };
    calls.push(call);
    // As the engine (SESSION_FIXED): a session key keeps its options; a continuation reuses its worktree.
    if (o.session !== undefined) {
      const fixed = { agentType: o.agentType ?? null, role: o.role ?? null, readOnly: o.readOnly === true, cwd: o.cwd ?? null, isolation: o.isolation ?? null };
      const first = sessions.get(o.session);
      if (first) {
        for (const [k, v] of Object.entries(fixed)) if (first.fixed[k] !== v) throw new Error(`session ${o.session} cannot change ${k}; use a new session key`);
        call.worktree = first.worktree;
      } else sessions.set(o.session, { fixed, worktree: null, call });
    }
    // FLOW-27 stand-in: a real git worktree per agent that asks for isolation.
    if (o.isolation === "worktree" && !call.worktree) {
      call.worktree = `.claude/worktrees/${runId}-${call.n}`;
      await createWorktree(root, configMod.loadConfig(root), `${runId}-${call.n}`, { seed: o.worktreeSeed });
      if (o.session !== undefined) sessions.get(o.session).worktree = call.worktree;
    }
    let value;
    try { value = await respond(prompt, o, call.n, calls); } finally { call.running = false; }
    const isNull = value === null || value === undefined || Object.hasOwn(Object(value), "__null");
    call.result = isNull ? null : value;
    call.reason = isNull ? (value?.__null ?? "finished without a reply") : null;
    logs.push(`agent done #${call.n} ${o.label ?? "agent"} ${isNull ? `null (${call.reason})` : "ok"}`);
    // The engine's detail reply also names the model and effort the call ran with (the host's own default when unset).
    return o.detail ? { result: call.result, reason: call.reason, agentId: `agent-${call.n}`, worktree: call.worktree ?? null, durationS: 60, model: o.model ?? "host/default", effort: o.effort ?? null } : call.result;
  }
  async function shell(cmd, o = {}) {
    const argv = Array.isArray(cmd) ? cmd : ["sh", "-c", cmd];
    const entry = { argv, input: o.input };
    shells.push(entry);
    let res;
    if (argv[0] === "node" && argv[1] === ".agents/harness/ph.mjs" && argv[2] === "gsd") res = await gsd.call(argv.slice(3), o.input ?? "");
    else if (argv[0] === "node" && argv[1] === ".agents/harness/ph.mjs" && argv[2] === "config") res = { code: 0, stdout: `${JSON.stringify(configMod.loadConfig(root), null, 2)}\n` };
    else if (argv[0] === "node" && argv[1] === ".agents/workflows/lib/gsd-flow.mjs") {
      let stdout = "";
      const code = await flowMod.main(argv.slice(2), { root, input: o.input ?? "", out: (l) => { stdout += `${l}\n`; } });
      res = { code, stdout };
    } else {
      const r = spawnSync(argv[0], argv.slice(1), { cwd: o.cwd ? path.resolve(root, o.cwd) : root, input: o.input, encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } });
      res = { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
    }
    entry.code = res.code;
    return { code: res.code, stdout: res.stdout, stderr: res.stderr ?? "", durationS: 0 };
  }
  async function parallel(thunks) {
    if (!Array.isArray(thunks)) throw new TypeError("parallel() needs an array");
    return Promise.all(thunks.map(async (t, i) => {
      try { return await t(); } catch (e) { logs.push(`log warning: parallel item ${i} -> null: ${e.message}`); return null; }
    }));
  }
  async function pipeline(items, ...stages) {
    return Promise.all(items.map(async (item, i) => {
      let prev = item;
      for (const s of stages) {
        try { prev = await s(prev, item, i); } catch (e) { logs.push(`log warning: pipeline item ${i} -> null: ${e.message}`); return null; }
      }
      return prev;
    }));
  }
  // As the engine: each script knows its own depth, so nested workflows may run at the same time (gsd-plan streams, O65).
  async function evaluate(scriptName, scriptArgs, depth = 0) {
    const body = loadScript(scriptName);
    const g = guardedGlobals();
    const globals = {
      agent, shell, parallel, pipeline, args: scriptArgs === undefined ? undefined : JSON.parse(JSON.stringify(scriptArgs)), runId,
      phase: (t) => logs.push(`phase ${t}`), log: (m) => logs.push(`log ${m}`),
      budget: { total: null, spent: () => 0, remaining: () => Infinity },
      workflow: async (child, childArgs) => {
        if (depth >= 1) throw new Error("workflow() nesting is one level only");
        return JSON.parse(JSON.stringify((await evaluate(child, childArgs, depth + 1)) ?? null));
      },
      console: { log: (m) => logs.push(`log ${m}`), warn: (m) => logs.push(`log ${m}`), error: (m) => logs.push(`log ${m}`), info: (m) => logs.push(`log ${m}`) },
      Date: g.Date, Math: g.Math,
    };
    const fn = new AsyncFunction(...Object.keys(globals), body);
    return fn(...Object.values(globals));
  }
  const result = await evaluate(name, opts.args);
  return { result, calls, logs, shells, gsd };
}
