// ph spawn and ph fanout (PHCL-05, PHCL-06, PHCL-08..10, PHCL-23..25).
import fs from "node:fs";
import path from "node:path";
import { UsageError, errText, failedLine } from "../lib/cli.mjs";
import { readText, writeJsonAtomic, writeTextAtomic } from "../lib/io.mjs";
import { safeName } from "../lib/paths.mjs";
import { loadAgentDef } from "./agents.mjs";
import { checkBlockNames, parseFanout } from "./fanout.mjs";
import { selectModel } from "./models.mjs";
import { loadPrices } from "./pricing.mjs";
import { resultJson } from "./result.mjs";
import { checkCapacity, checkNameLengths, checkNamesFree, prepareCreate, readPrompt, runningCount, startAgent, waitHint } from "./start.mjs";
import { repoTop } from "./worktrees.mjs";

const resolveDir = (ctx, dir) => (dir === undefined ? undefined : path.resolve(ctx.root, dir));

function agentSetup(ctx, { type, role, model, effort }) {
  const def = type ? loadAgentDef(ctx.root, type) : null;
  return { def, sel: selectModel({ cfg: ctx.cfg, explicit: { model, effort }, role, definition: def }) };
}

async function spawn(ctx) {
  const { opts } = ctx;
  const task = readPrompt(ctx);
  if (!opts.name) throw new UsageError("--name is required");
  let names = [opts.name];
  if (opts.count !== undefined) {
    if (!/^[1-9]\d*$/.test(opts.count)) throw new UsageError("--count must be a positive integer");
    names = Array.from({ length: Number(opts.count) }, (_, i) => `${opts.name}-${i + 1}`);
  }
  checkNameLengths(names);
  const { def, sel } = agentSetup(ctx, opts);
  if (opts.worktree && !repoTop(ctx.root)) throw new UsageError("isolation 'worktree' needs a git repository");
  const { session, live } = await prepareCreate(ctx);
  checkCapacity(live, names.length, ctx.cfg);
  checkNamesFree(live, names);
  const spec = {
    swarm: opts.name, task, def, sel, kind: "team", readOnly: opts["read-only"], workdir: resolveDir(ctx, opts.cwd),
    ws: resolveDir(ctx, opts.ws), worktree: opts.worktree,
  };
  const results = await Promise.allSettled(names.map((name) => startAgent(ctx, session, { ...spec, name })));
  const started = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ctx.out(`${r.value.id} ${names[i]}`);
      started.push(names[i]);
    } else ctx.out(failedLine(`spawn ${names[i]}`, r.reason));
  });
  if (started.length) ctx.out(waitHint(ctx.ph, started));
  return started.length === names.length ? 0 : 2;
}

function fanoutBlocks(ctx) {
  const { opts } = ctx;
  if (!opts.file) throw new UsageError("--file is required");
  const file = path.resolve(ctx.root, opts.file);
  const blocks = parseFanout(readText(file), opts.file);
  checkBlockNames(blocks);
  checkNameLengths(blocks.map((b) => b.name));
  return blocks.map((b) => {
    const pick = (key) => b.opts[key] ?? opts[key];
    return { ...b, ...agentSetup(ctx, { type: pick("type"), role: pick("role"), model: pick("model"), effort: pick("effort") }), readOnly: Boolean(pick("read-only")) };
  });
}

async function fanout(ctx) {
  const { opts } = ctx;
  if (opts.keep && !opts.collect) throw new UsageError("--keep needs --collect");
  const blocks = fanoutBlocks(ctx);
  const { session, live } = await prepareCreate(ctx);
  checkNamesFree(live, blocks.map((b) => b.name));
  const common = { swarm: path.basename(opts.file).replace(/\.[^.]*$/, ""), workdir: resolveDir(ctx, opts.cwd), ws: resolveDir(ctx, opts.ws) };
  const spec = (b) => ({ ...common, name: b.name, task: b.prompt, def: b.def, sel: b.sel, readOnly: b.readOnly });
  if (opts.collect) return collect(ctx, session, live, blocks, spec);
  checkCapacity(live, blocks.length, ctx.cfg);
  const results = await Promise.allSettled(blocks.map((b) => startAgent(ctx, session, { ...spec(b), kind: "team" })));
  const started = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ctx.out(`${r.value.id} ${blocks[i].name}`);
      started.push(blocks[i].name);
    } else ctx.out(failedLine(`fanout ${blocks[i].name}`, r.reason));
  });
  if (started.length) ctx.out(waitHint(ctx.ph, started));
  return started.length === blocks.length ? 0 : 2;
}

// Blocks run as one-shot agents under a semaphore of the free running slots; each admission also needs a live slot.
// Replies and result objects are written before the agent is archived (an archived agent cannot be read, INV-15).
async function collect(ctx, session, live, blocks, spec) {
  const { cfg } = ctx;
  const dir = path.resolve(ctx.root, ctx.opts.collect);
  const keep = Boolean(ctx.opts.keep);
  const running = runningCount(live);
  const slots = cfg.max_subagents - running;
  if (slots <= 0) throw new UsageError(`${running} subagents running, max_subagents ${cfg.max_subagents}: no free slot; wait or archive`);
  if (live.length >= cfg.max_live_subagents) {
    throw new UsageError(`${live.length} live subagents, max_live_subagents ${cfg.max_live_subagents}: no free slot; archive idle agents`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const prices = loadPrices(ctx.root);
  let liveCount = live.length;
  let inFlight = 0;
  let failed = 0;
  const waiters = new Set();
  const changed = () => {
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  ctx.out(`waiting for ${blocks.length} agent(s): this command returns when every reply is collected; run it in the foreground and do not poll its output`);

  async function admit() {
    while (liveCount >= cfg.max_live_subagents) {
      if (inFlight === 0) throw new Error(`live agent cap reached (${liveCount} of ${cfg.max_live_subagents})`);
      await new Promise((resolve) => waiters.add(resolve));
    }
    liveCount++;
    inFlight++;
  }

  async function runBlock(b) {
    let agent = null;
    try {
      await admit();
      try {
        agent = await startAgent(ctx, session, { ...spec(b), kind: "oneshot" });
      } catch (e) {
        liveCount--;
        throw e;
      }
      ctx.out(`${agent.id} ${b.name}`);
      await session.waitTurn(agent.id, { timeoutS: cfg.wait_timeout_s, turnsBefore: 0 });
      const result = await resultJson(session, (await session.fetchAgent(agent.id)) ?? agent, prices);
      const base = path.join(dir, safeName(b.name));
      writeTextAtomic(`${base}.md`, `${result.final ?? ""}\n`);
      writeJsonAtomic(`${base}.json`, result);
      ctx.out(`collected ${b.name} -> ${base}.md`);
    } catch (e) {
      failed++;
      ctx.out(`failed ${b.name}: ${errText(e)}`);
    } finally {
      if (agent && !keep) {
        try {
          await session.archive(agent.id);
          liveCount--;
        } catch (e) {
          failed++;
          ctx.out(failedLine(`archive ${b.name}`, e));
        }
      }
      if (agent) inFlight--;
      changed();
    }
  }

  const queue = [...blocks];
  const worker = async () => {
    while (queue.length) await runBlock(queue.shift());
  };
  await Promise.all(Array.from({ length: Math.min(slots, blocks.length) }, worker));
  return failed ? 2 : 0;
}

const AGENT_OPTIONS = { type: "string", role: "string", model: "string", effort: "string", "read-only": "bool", cwd: "string", ws: "string" };

export const startCommands = [
  {
    name: "spawn",
    summary: "start named teammate agents and return at once (wait with ph watch)",
    usage: "ph spawn --name N (--prompt T | --prompt-file F) [--count K] [--type T] [--role R] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--worktree]",
    options: { name: "string", prompt: "string", "prompt-file": "string", count: "string", worktree: "bool", ...AGENT_OPTIONS },
    config: "required",
    run: spawn,
  },
  {
    name: "fanout",
    summary: "start one agent per '=== name' block of a file; --collect DIR waits and writes every reply",
    usage: "ph fanout --file F [--type T] [--role R] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--collect DIR [--keep]]",
    options: { file: "string", collect: "string", keep: "bool", ...AGENT_OPTIONS },
    config: "required",
    run: fanout,
  },
];
