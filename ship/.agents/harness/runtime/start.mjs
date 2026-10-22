// What spawn, fanout and the workflow runner share before and while creating agents: prompt input, capacity and
// name checks, the caller-root check and starting one agent (PHCL-03, PHCL-05..07, PHCL-23..25, PHCL-31, PHCL-33).
import path from "node:path";
import { UsageError, quoteName } from "../lib/cli.mjs";
import { readText } from "../lib/io.mjs";
import { id8, isInside } from "../lib/paths.mjs";
import { composePrompt } from "./prompts.mjs";
import { createWorktree, discardWorktree, stamp } from "./worktrees.mjs";

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

export function checkNamesFree(live, names) {
  const taken = names.filter((n) => live.some((a) => a.title === n));
  if (taken.length) throw new UsageError(`a live subagent already has the name ${taken.join(", ")} (names must be unique)`);
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

/**
 * Starts one named agent (spawn, fanout). spec: {name, swarm, task, def, sel, kind, readOnly, workdir, ws, worktree}.
 * A worktree is created for the agent and removed again when the agent cannot be created.
 */
export async function startAgent(ctx, session, spec) {
  const wt = spec.worktree ? await createWorktree(ctx.root, ctx.cfg, `${spec.name}-${stamp(ctx.clock.now())}`) : null;
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
  }
}
