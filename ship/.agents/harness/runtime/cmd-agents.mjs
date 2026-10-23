// Commands on existing agents: send, watch, result, team, context, stop, archive, model (PHCL-11..13, PHCL-15, PHCL-16,
// PHCL-19, PHCL-20, F45B).
import fs from "node:fs";
import path from "node:path";
import { assertPromptSize } from "../paseo-client/index.mjs";
import { UsageError, errText, failedLine } from "../lib/cli.mjs";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { id8, isInside, resolveInside } from "../lib/paths.mjs";
import { killPidTree, pidAlive } from "../lib/proc.mjs";
import { resolveModel } from "./models.mjs";
import { resultJson } from "./result.mjs";
import { RUN_FILES, readJournal } from "../workflow/journal.mjs";
import { appendRecords, readLedger, runRecord } from "../workflow/metrics.mjs";
import { readPrompt, waitHint } from "./start.mjs";

export const RUNS_DIR = "_workspace/_runs";
const SEND_NOW_WAIT_MS = 60000;
const SEND_POLL_MS = 500;
const SEND_POLL_MAX_MS = 15000;
const TURN_ENDED = new Set(["idle", "error"]);

async function send(ctx) {
  const text = readPrompt(ctx);
  assertPromptSize(text, ctx.cfg);
  const session = await ctx.paseo();
  const targets = await session.resolveTargets(ctx.args);
  const results = await Promise.allSettled(targets.map(async (a) => {
    const now = await session.fetchAgent(a.id);
    if (now?.status === "running") {
      if (ctx.opts.now) await session.cancel(a.id);
      const waitMs = ctx.opts.now ? SEND_NOW_WAIT_MS : ctx.cfg.wait_timeout_s * 1000;
      const st = await session.waitForFinish(a.id, waitMs);
      // PHCL-11, INV-55: deliver only once the running turn has ended; a timed-out wait would land in that turn.
      if (!TURN_ENDED.has(st?.status)) throw new Error(`turn still ${st?.status ?? "unknown"} after ${waitMs / 1000} s; not sent`);
    }
    await session.sendPrompt(a.id, text);
    // Wait until the agent reports running, so a `ph watch` started right after does not see the stale idle state.
    for (let waited = 0; waited < SEND_POLL_MAX_MS; waited += SEND_POLL_MS) {
      if ((await session.fetchAgent(a.id))?.status === "running") break;
      await ctx.clock.sleep(SEND_POLL_MS);
    }
  }));
  const sent = [];
  results.forEach((r, i) => {
    const title = targets[i].title ?? targets[i].id;
    if (r.status === "fulfilled") {
      ctx.out(`sent ${title}`);
      sent.push(title);
    } else ctx.out(failedLine(`send ${title}`, r.reason));
  });
  if (sent.length) ctx.out(waitHint(ctx.ph, sent));
  return sent.length === targets.length ? 0 : 2;
}

const orQ = (v) => (v === undefined || v === null ? "?" : v);

// Raw waits only: watch subscribes no usage tracker and reads the numbers the daemon keeps for the last turn.
async function watch(ctx) {
  const session = await ctx.paseo();
  const targets = await session.resolveTargets(ctx.args);
  let idle = 0;
  await Promise.all(targets.map(async (a) => {
    try {
      const st = await session.waitForFinish(a.id, ctx.cfg.wait_timeout_s * 1000);
      if (st.status !== "idle") {
        ctx.out(`failed ${a.title} ${id8(a.id)}: ${st.status === "error" ? `error: ${errText(st.error ?? "unknown error")}` : st.status}`);
        return;
      }
      const f = st.final ?? a;
      const u = f.lastUsage ?? {};
      const from = Date.parse(f.lastUserMessageAt ?? "");
      const to = Date.parse(f.updatedAt ?? "");
      const duration = Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / 1000) : null;
      ctx.out(`idle ${a.title} ${id8(a.id)} out_tokens=${orQ(u.outputTokens)} context_tokens=${orQ(u.contextWindowUsedTokens)} duration_s=${orQ(duration)}`);
      idle++;
    } catch (e) {
      ctx.out(`failed ${a.title} ${id8(a.id)}: ${errText(e)}`);
    }
  }));
  const failed = targets.length - idle;
  ctx.out(`watch done: ${idle} idle, ${failed} failed`);
  return failed ? 2 : 0;
}

async function result(ctx) {
  const session = await ctx.paseo();
  const targets = await session.resolveTargets(ctx.args);
  for (const a of targets) {
    if (ctx.opts.json) ctx.out(JSON.stringify(await resultJson(session, a)));
    else {
      if (targets.length > 1) ctx.out(`## ${a.title}`);
      ctx.out(String(await session.replyText(a.id)));
    }
  }
  return 0;
}

export function usedPct(agent) {
  const u = agent?.lastUsage ?? {};
  return u.contextWindowUsedTokens && u.contextWindowMaxTokens ? (100 * u.contextWindowUsedTokens) / u.contextWindowMaxTokens : null;
}

async function team(ctx) {
  const session = await ctx.paseo();
  session.requireCaller();
  const live = await session.listAgents();
  if (!live.length) ctx.out("no live subagents");
  for (const a of live) {
    const p = usedPct(a);
    ctx.out(`${id8(a.id)} ${a.status} ${p === null ? "?" : Math.round(p)}% ${a.provider}/${a.model} ${a.title}`);
  }
  return 0;
}

function rotatePct(ctx) {
  const raw = ctx.opts["rotate-pct"];
  if (raw === undefined) return ctx.cfg.context_guard.start_pct;
  const n = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw) || n <= 0 || n > 100) throw new UsageError(`--rotate-pct must be a number above 0 and at most 100, got '${raw}'`);
  return n;
}

// The context guard reminds the main session at start_pct and every step_pct above it (context_guard.mjs contextBand); this
// is that threshold and the tokens left before the next reminder, from the window the self row reports.
function reminderLine(agent, cfg) {
  const p = usedPct(agent);
  if (p === null) return `compact reminder at ${cfg.start_pct}% (usage not reported yet)`;
  const { start_pct: start, step_pct: step } = cfg;
  const next = p < start ? start : start + (Math.floor((p - start) / step) + 1) * step;
  const u = agent.lastUsage;
  return `compact reminder at ${start}% (next in ${Math.ceil((next * u.contextWindowMaxTokens) / 100) - u.contextWindowUsedTokens} tokens)`;
}

async function context(ctx) {
  const rotate = rotatePct(ctx);
  const session = await ctx.paseo();
  const caller = session.requireCaller();
  let agents;
  if (ctx.opts.self) agents = [await session.fetchAgent(caller)].filter(Boolean);
  else agents = ctx.args.length ? await session.resolveTargets(ctx.args) : await session.listAgents();
  if (!agents.length) {
    ctx.out("no live subagents");
    return 0;
  }
  const sorted = [...agents].sort((x, y) => (usedPct(y) ?? -1) - (usedPct(x) ?? -1));
  for (const a of sorted) {
    const p = usedPct(a);
    const u = a.lastUsage ?? {};
    const pct = p === null ? "  n/a" : `${p.toFixed(0).padStart(4)}%`;
    ctx.out(`${id8(a.id)} ${pct} ${orQ(u.contextWindowUsedTokens)}/${orQ(u.contextWindowMaxTokens)} ${a.status} ${a.title ?? ""}${p !== null && p >= rotate ? "  ROTATE" : ""}`);
  }
  if (ctx.opts.self) ctx.out(reminderLine(agents[0], ctx.cfg.context_guard));
  return 0;
}

async function stop(ctx) {
  const session = await ctx.paseo();
  let failed = 0;
  for (const a of await session.resolveTargets(ctx.args)) {
    try {
      await session.cancel(a.id);
      ctx.out(`stopped ${a.title}`);
    } catch (e) {
      failed++;
      ctx.out(failedLine(`stop ${a.title}`, e));
    }
  }
  return failed ? 2 : 0;
}

// A run directory that is a symlink or a junction must still resolve inside the real runs tree: a link out of it would send
// the runner kill and the run.json rewrite to another run (G137). The lexical check in resolveInside stays the early reject.
function refuseLinkedRunDir(runsDir, runId, runDir) {
  if (!fs.existsSync(runDir)) return;
  if (!isInside(fs.realpathSync.native(runDir), fs.realpathSync.native(runsDir))) throw new UsageError(`run ${runId} resolves outside ${runsDir}`);
}

// --run: end a workflow run for good, so watchers and resumes see a terminal state.
async function runAgents(ctx, session, own) {
  const runId = ctx.opts.run;
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId.includes("..")) throw new UsageError(`invalid run id '${runId}'`);
  const runsDir = path.resolve(ctx.root, ctx.opts["runs-dir"] ?? RUNS_DIR);
  const runDir = resolveInside(runsDir, runId);
  refuseLinkedRunDir(runsDir, runId, runDir);
  const file = path.join(runDir, "run.json");
  const info = readJsonIf(file);
  if (!info) throw new Error(`no run ${runId} (${file})`);
  // G166: the shell commands the runner started are its descendants and go with it. Once the runner is gone nothing
  // records them, so they are not stopped (ph skill).
  if (info.status === "running" && pidAlive(info.pid)) {
    try {
      killPidTree(info.pid);
      ctx.out(`stopped runner pid ${info.pid}`);
    } catch (e) {
      ctx.out(`could not stop runner pid ${info.pid}: ${errText(e)}`);
    }
  }
  // FLOW-48: agents adopted from an earlier run belong to this run too.
  const adopted = new Set((info.adopted ?? []).map((a) => a.agentId));
  const selected = own.filter((a) => a.labels?.["harness.run"] === runId || adopted.has(a.id));
  // The stop reason (owner decision 2026-10-22: 37 runs of one project stopped mid-phase left no reason to learn from) goes into
  // run.json and, with the run, into the metrics ledger at once; a killed runner never records itself.
  const finish = () => {
    if (info.status !== "running") return;
    // The runner can end the run after the read above (G143): the kill then fails or finds nothing, and the run keeps the
    // status, stats and ledger line it ended with. Only a run still running is marked stopped.
    const fresh = readJsonIf(file);
    if (!fresh) return;
    const ended = fresh.status !== "running";
    const run = ended ? fresh : { ...fresh, status: "stopped", endedAt: new Date(ctx.clock.now()).toISOString(), stopReason: stopReasonOf(ctx.opts.reason) };
    if (!ended) writeJsonAtomic(file, run);
    try {
      if (!readLedger(ctx.root).records.some((r) => r.runId === runId)) {
        const dir = path.dirname(file);
        appendRecords(ctx.root, [runRecord(runId, run, readJournalIf(path.join(dir, RUN_FILES.journal)), ended ? readJsonIf(path.join(dir, RUN_FILES.result)) : null)]);
      }
    } catch (e) {
      ctx.out(`run metrics not recorded: ${errText(e)}`);
    }
  };
  return { selected, finish };
}

const STOP_REASON_MAX_CHARS = 300;
const stopReasonOf = (text) => (typeof text === "string" && text.trim() ? text.replace(/\s+/g, " ").trim().slice(0, STOP_REASON_MAX_CHARS) : null);
const readJournalIf = (file) => {
  try {
    return readJournal(file);
  } catch {
    return [];
  }
};

async function archive(ctx) {
  const { opts } = ctx;
  const session = await ctx.paseo();
  session.requireCaller();
  const own = await session.listAgents();
  let selected;
  let finish = () => {};
  if (opts.reason !== undefined && opts.run === undefined) throw new UsageError("--reason goes with --run");
  if (opts.run !== undefined) ({ selected, finish } = await runAgents(ctx, session, own));
  else if (ctx.args.length) selected = await session.resolveTargets(ctx.args);
  else if (opts.idle || opts["name-prefix"] !== undefined) {
    selected = own.filter((a) => (!opts.idle || a.status !== "running") && (opts["name-prefix"] === undefined || (a.title ?? "").startsWith(opts["name-prefix"])));
  } else throw new UsageError("name agents, or use --idle / --name-prefix");
  let ok = 0;
  for (const a of selected) {
    try {
      await session.archive(a.id);
      ok++;
    } catch (e) {
      ctx.out(failedLine(`archive ${a.title}`, e));
    }
  }
  finish();
  ctx.out(`archived ${ok} of ${selected.length} agents`);
  return ok === selected.length ? 0 : 2;
}

// F45B: a live agent moves to the model (and thinking) of sel, within its provider; the next call of a tier moves on its own.
async function moveAgent(ctx, session, agent, sel) {
  if (agent.provider !== sel.provider) {
    throw new UsageError(`agent ${id8(agent.id)} runs on ${agent.provider}, not ${sel.provider}; a model change stays within one provider, so start a new agent for ${sel.id}`);
  }
  const from = `${agent.provider}/${agent.model}`;
  await session.setModel(agent.id, sel.model);
  // No thinking level (no --thinking and none on the tier) keeps the agent's thinking; null would turn it off.
  const thinkingSet = sel.thinking === undefined || sel.thinking === null ? true : await session.setThinking(agent.id, sel);
  ctx.out(`model ${agent.title ?? id8(agent.id)} ${id8(agent.id)}: ${from} -> ${sel.id}`);
  if (!thinkingSet) ctx.out(`log warning: ${sel.id} offers no ${sel.thinking} thinking; the thinking stays`);
}

// ph model <agentId|runId> <tier|provider/model>: an agent id switches that kit agent; a run id switches every live agent of the run.
async function model(ctx) {
  if (ctx.args.length !== 2) throw new UsageError("usage: ph model <agentId|runId> <tier|provider/model> [--thinking LEVEL]");
  const [target, spec] = ctx.args;
  const sel = resolveModel(ctx.cfg, spec, ctx.opts.thinking);
  const session = await ctx.paseo();
  const runsDir = path.resolve(ctx.root, ctx.opts["runs-dir"] ?? RUNS_DIR);
  if (/^[A-Za-z0-9._-]+$/.test(target) && !target.includes("..") && fs.existsSync(path.join(runsDir, target, RUN_FILES.run))) {
    const agents = await session.findAgents({ "harness.run": target });
    if (!agents.length) throw new UsageError(`run ${target} has no live agents`);
    let failed = 0;
    for (const agent of agents) {
      try {
        await moveAgent(ctx, session, agent, sel);
      } catch (e) {
        failed++;
        ctx.out(failedLine(`model ${agent.title ?? id8(agent.id)}`, e));
      }
    }
    return failed ? 2 : 0;
  }
  const agent = await session.fetchAgent(target);
  if (!agent || agent.archivedAt) throw new UsageError(`no live agent or run '${target}'`);
  if (!agent.labels?.["harness.name"]) throw new UsageError(`agent ${id8(agent.id)} was not started by the kit (ph spawn, fanout or a workflow)`);
  await moveAgent(ctx, session, agent, sel);
  return 0;
}

export const agentCommands = [
  {
    name: "send",
    summary: "deliver a message to agents between their turns (--now interrupts the running turn)",
    usage: "ph send (--prompt T | --prompt-file F) [--now] NAME|ID...",
    options: { prompt: "string", "prompt-file": "string", now: "bool" },
    config: "required",
    run: send,
  },
  {
    name: "watch",
    summary: "wait until the named agents are idle, one line per agent (run under Monitor)",
    usage: "ph watch NAME|ID...",
    options: {},
    config: "required",
    run: watch,
  },
  {
    name: "result",
    summary: "print the final reply of agents (--json: reply, usage, tokens, cost, skills)",
    usage: "ph result [--json] NAME|ID...",
    options: { json: "bool" },
    config: "required",
    run: result,
  },
  {
    name: "team",
    summary: "list your live subagents: id, status, context use, model, name",
    usage: "ph team",
    options: {},
    config: "required",
    run: team,
  },
  {
    name: "context",
    summary: "context-window use of your subagents or yourself, ROTATE at the threshold",
    usage: "ph context [--self] [--rotate-pct N] [NAME|ID...]",
    options: { self: "bool", "rotate-pct": "string" },
    config: "required",
    run: context,
  },
  {
    name: "stop",
    summary: "cancel the running turn of agents, keeping agent and context",
    usage: "ph stop NAME|ID...",
    options: {},
    config: "required",
    run: stop,
  },
  {
    name: "archive",
    summary: "archive agents by name, --idle, --name-prefix, or every agent of a workflow run",
    usage: "ph archive NAME|ID... | --idle [--name-prefix P] | --name-prefix P | --run RUNID [--reason TEXT] [--runs-dir D]",
    options: { idle: "bool", "name-prefix": "string", run: "string", reason: "string", "runs-dir": "string" },
    config: "required",
    run: archive,
  },
  {
    name: "model",
    summary: "switch a live agent (or every live agent of a run) to a tier or provider/model, within its provider",
    usage: "ph model <agentId|runId> <tier|provider/model> [--thinking LEVEL] [--runs-dir D]",
    options: { thinking: "string", "runs-dir": "string" },
    config: "required",
    run: model,
  },
];
