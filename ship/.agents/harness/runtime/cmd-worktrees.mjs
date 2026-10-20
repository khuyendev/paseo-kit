// ph worktrees [--prune] (PHCL-32): list harness worktrees with their state; remove only what provably holds no work.
import path from "node:path";
import { errText } from "../lib/cli.mjs";
import { safeName } from "../lib/paths.mjs";
import { RUNS_DIR } from "./cmd-agents.mjs";
import { classify, listHarnessWorktrees, ownerOf, removeWorktree, repoTop, runGit } from "./worktrees.mjs";

// Spawned agents named in worktree names, mapped to whether a non-archived agent of that name still exists.
async function agentLiveness(ctx, names, line) {
  const live = new Map();
  if (!names.length) return live;
  let agents;
  try {
    const session = await ctx.paseo();
    // TODO(integration): use session.findAgents({"harness.name": name}) across orchestrators once paseo-client
    // provides it (requested); until then only the caller's and the leader's agents are seen.
    agents = [...(await session.listAgents(session.caller)), ...(session.leader ? await session.listAgents(session.leader) : [])];
  } catch (e) {
    line(`note daemon not reachable (${errText(e)}): worktrees of spawned agents are kept`);
    return live;
  }
  for (const name of names) live.set(name, agents.some((a) => !a.archivedAt && safeName(a.labels?.["harness.name"] ?? "") === name));
  return live;
}

export async function worktrees(ctx, { git = runGit } = {}) {
  const top = repoTop(ctx.root, { git });
  if (!top) throw new Error(`${ctx.root} is not in a git repository; harness worktrees live under <repo>/${ctx.cfg.worktree_dir}`);
  const list = listHarnessWorktrees(top, ctx.cfg, { git });
  if (!list.length) {
    ctx.out("no harness worktrees");
    return 0;
  }
  const runsDir = path.resolve(ctx.root, ctx.opts["runs-dir"] ?? RUNS_DIR);
  const agentNames = [...new Set(list.filter((w) => !w.missing).map((w) => ownerOf(w.name)).filter((o) => o.kind === "agent").map((o) => o.name))];
  const agentLive = await agentLiveness(ctx, agentNames, ctx.out);
  let removed = 0;
  let failed = 0;
  for (const wt of list) {
    let c;
    try {
      c = classify(top, wt, { runsDir, agentLive, git });
    } catch (e) {
      failed++;
      ctx.out(`failed ${wt.name}: ${errText(e)}`);
      continue;
    }
    ctx.out(`${c.state.padEnd(22)} ${c.branch} ${c.path} (${c.owner})`);
    if (!ctx.opts.prune || !c.removable) continue;
    const r = removeWorktree(top, c, { git });
    ctx.out(r.line);
    if (r.removed) removed++;
    if (!r.ok) failed++;
  }
  ctx.out(`worktrees: ${list.length} listed, ${removed} removed`);
  return failed ? 2 : 0;
}

export const worktreeCommands = [
  {
    name: "worktrees",
    summary: "list harness git worktrees and their state; --prune removes merged-and-clean and missing ones",
    usage: "ph worktrees [--prune] [--runs-dir D]",
    options: { prune: "bool", "runs-dir": "string" },
    config: "required",
    run: (ctx) => worktrees(ctx),
  },
];
