// What spawn, fanout and the workflow runner share before and while creating agents: prompt input, capacity and
// name checks, the caller-root check and starting one agent (PHCL-03, PHCL-05..07, PHCL-23..25, PHCL-31, PHCL-33).
import path from "node:path";
import { UsageError, quoteName } from "../lib/cli.mjs";
import { readText } from "../lib/io.mjs";
import { id8, isInside } from "../lib/paths.mjs";
import { takeCapLock } from "./cap-lock.mjs";
import { composePrompt } from "./prompts.mjs";
import { createWorktree, discardWorktree, releaseLease, stamp } from "./worktrees.mjs";

export const NAME_MAX = 60;

export function readPrompt(ctx) {
  const { prompt, "prompt-file": file } = ctx.opts;
  if (prompt !== undefined && file !== undefined) throw new UsageError("use --prompt or --prompt-file, not both");
  if (prompt === undefined && file === undefined) throw new UsageError("--prompt or --prompt-file is required");
  return prompt ?? readText(path.resolve(ctx.root, file));
}

export function waitHint(ph, names) {
  return `next: wait with Monitor running \`${ph} watch ${names.map(quoteName).join(" ")}\` (one event per idle agent, exits when all are idle); do not poll with sleep/grep loops`;
}

export function checkNameLengths(names) {
  const long = names.filter((n) => n.length > NAME_MAX);
  if (long.length) throw new UsageError(`names longer than ${NAME_MAX} characters: ${long.join(", ")}`);
}

// errText keeps 300 characters. One full id fits; more than one would be cut off mid-id, so the rest use the 8-character
// prefix ph result and ph archive already accept, and a list that still does not fit names the first ids and a count.
const CLASH_LIMIT = 290;
const clashLine = (list, them, hidden) => {
  const who = list.map((c) => `${c.name} (id ${c.id})`).join(", ");
  const ids = list.map((c) => c.id).join(" ");
  const tail = hidden ? ` and ${hidden} more` : "";
  return `a live subagent already has the name ${who}${tail}; ph result ${ids} to read ${them} or ph archive ${ids} to free the name`;
};
const clashFitted = (clashes, them, idOf) => {
  const rows = clashes.map((c) => ({ name: c.name, id: idOf(c) }));
  for (let n = rows.length; n >= 1; n--) {
    const text = clashLine(rows.slice(0, n), them, clashes.length - n);
    if (text.length <= CLASH_LIMIT) return text;
  }
  return clashLine([{ name: rows[0].name.slice(0, 24), id: rows[0].id }], them, clashes.length - 1);
};

export function checkNamesFree(live, names) {
  const clashes = [];
  for (const n of names) for (const a of live) if (a.title === n) clashes.push({ name: n, id: a.id });
  if (!clashes.length) return;
  // The interrupted fanout left these agents running and the error is the only record of them.
  const them = clashes.length > 1 ? "them" : "it";
  const full = clashLine(clashes, them, 0);
  throw new UsageError(full.length <= CLASH_LIMIT ? full : clashFitted(clashes, them, (c) => id8(c.id)));
}

export const runningCount = (live) => live.filter((a) => a.status === "running").length;

export function checkCapacity(live, n, cfg) {
  const running = runningCount(live);
  if (running + n > cfg.max_subagents) {
    throw new UsageError(`${running} subagents running + ${n} new > max_subagents ${cfg.max_subagents} (harness config); wait, archive, or use a workflow (it queues)`);
  }
  if (live.length + n > cfg.max_live_subagents) {
    throw new UsageError(`${live.length} live subagents + ${n} new > max_live_subagents ${cfg.max_live_subagents}; archive idle agents (ph archive --idle)`);
  }
}

// INV-10: agents of another project must not be created from here; the daemon reports the caller's directory.
export async function checkCallerRoot(session) {
  const caller = session.requireCaller();
  const agent = await session.fetchAgent(caller);
  if (agent?.cwd && !isInside(agent.cwd, session.root)) {
    throw new UsageError(`caller ${id8(caller)} works in ${agent.cwd}, outside the project root ${session.root}; run ph from an agent of this project`);
  }
}

/** Connects, requires a caller inside the root, and returns the caller's live subagents. */
export async function prepareCreate(ctx) {
  const session = await ctx.paseo();
  session.requireCaller();
  await checkCallerRoot(session);
  return { session, live: await session.listAgents() };
}

// G133: fn runs under the caller's cap lock with a fresh listing of its agents, so the checks and the creates it makes
// cannot race a spawn or a workflow run of the same caller in another process.
export async function withCapLock(ctx, session, fn) {
  const release = await takeCapLock(ctx.root, session.requireCaller(), ctx.clock);
  try {
    return await fn(await session.listAgents());
  } finally {
    release();
  }
}

/**
 * Starts one named agent (spawn, fanout). spec: {name, swarm, task, def, sel, kind, readOnly, workdir, ws, worktree}.
 * A worktree is created for the agent and removed again when the agent cannot be created. Its lease keeps `ph worktrees
 * --prune` away until the agent is registered (or the tree is gone).
 */
export async function startAgent(ctx, session, spec) {
  const wt = spec.worktree ? await createWorktree(ctx.root, ctx.cfg, `${spec.name}-${stamp(ctx.clock.now())}`, { lease: true }) : null;
  try {
    const readOnly = Boolean(spec.readOnly || spec.def?.readOnly);
    const prompt = composePrompt({
      cfg: ctx.cfg, root: ctx.root, task: spec.task, def: spec.def, kind: spec.kind, name: spec.name,
      leader: session.caller, ws: spec.ws, readOnly, worktree: wt, workdir: spec.workdir,
    });
    return await session.createAgent({
      sel: spec.sel, prompt, title: spec.name, name: spec.name, swarm: spec.swarm, cwd: wt?.path ?? spec.workdir ?? ctx.root, readOnly,
    });
  } catch (e) {
    // An unconfirmed archive leaves a live worker using this tree (CR-FND-02).
    if (wt && (!e.agentId || e.archived === true)) discardWorktree(wt);
    throw e;
  } finally {
    releaseLease(wt);
  }
}
