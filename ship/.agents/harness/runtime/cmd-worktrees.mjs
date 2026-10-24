// ph worktrees [--prune] (PHCL-32): list harness worktrees with their state; remove only what provably holds no work.
// --committed-phase N (kit feedback 126) also removes that phase's executor worktrees once its waves are committed,
// after the delta is archived and every link is unlinked. A directory git does not list is an orphan.
import fs from "node:fs";
import path from "node:path";
import { UsageError, errText } from "../lib/cli.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { safeName, samePath } from "../lib/paths.mjs";
import { pidAlive, processStartTimes } from "../lib/proc.mjs";
import { RUNS_DIR } from "./cmd-agents.mjs";
import { listRuns } from "../workflow/cmd-runs.mjs";
import { classify, listHarnessWorktrees, listOrphanWorktrees, ownerOf, removeArchived, removeWorktree, repoTop, runGit } from "./worktrees.mjs";

// Spawned agents named in worktree names, mapped to whether a non-archived agent of that name still exists.
async function agentLiveness(ctx, names, line) {
  const live = new Map();
  if (!names.length) return live;
  let agents;
  try {
    const session = await ctx.paseo();
    // Every live agent of the daemon, not only the caller's pool: another orchestrator's worker may own the worktree.
    agents = await session.findAgents();
  } catch (e) {
    line(`note daemon agent list unavailable (${errText(e)}): worktrees of spawned agents are kept`);
    return live;
  }
  for (const name of names) live.set(name, agents.some((a) => !a.archivedAt && safeName(a.labels?.["harness.name"] ?? "") === name));
  return live;
}

const normPhase = (s) => String(s).split(".").map((p) => String(Number(p))).join(".");
const phaseNumOk = (s) => /^\d+(?:\.\d+)*$/.test(s);

// `.planning/phases/<N>-<slug>` directories whose number is N (`5` matches `05`, `1.1` matches `01.1`).
export function phaseDirsFor(root, arg) {
  const base = path.join(root, ".planning", "phases");
  if (!fs.existsSync(base)) return [];
  const want = String(arg).trim();
  const out = [];
  for (const name of fs.readdirSync(base)) {
    const abs = path.join(base, name);
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
    const num = name.split("-")[0];
    if (num === want || (phaseNumOk(num) && phaseNumOk(want) && normPhase(num) === normPhase(want))) out.push(abs);
  }
  return out;
}

function committedPlanIds(phaseDir) {
  const ids = new Set();
  const commits = readJsonIf(path.join(phaseDir, "commits.json"));
  if (Array.isArray(commits)) for (const c of commits) for (const id of Object.keys(c?.plans ?? {})) ids.add(id);
  const st = readJsonIf(path.join(phaseDir, "execute-progress.json"));
  for (const [id, rec] of Object.entries(st?.plans ?? {})) if (rec?.commit) ids.add(id);
  for (const [id, rec] of Object.entries(st?.stages ?? {})) if (rec?.stage === "committed" || rec?.stage === "tracked" || rec?.commit) ids.add(id);
  return ids;
}

function handoffPlanIds(phaseDir) {
  const dir = path.join(phaseDir, "handoff");
  if (!fs.existsSync(dir)) return [];
  const ids = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".args.json")) continue;
    const j = readJsonIf(path.join(dir, name));
    for (const t of j?.tasks ?? []) if (t?.plan) ids.push(String(t.plan));
  }
  return ids;
}

/** {ok, why, plans, missing}. Committed when every handoff plan has a recorded commit. */
export function phaseCommitted(phaseDir) {
  const plans = [...new Set(handoffPlanIds(phaseDir))];
  if (!plans.length) return { ok: false, why: "no handoff plans", plans, missing: [] };
  const have = committedPlanIds(phaseDir);
  const missing = plans.filter((id) => !have.has(id));
  return missing.length ? { ok: false, why: `plans not committed: ${missing.join(", ")}`, plans, missing } : { ok: true, why: null, plans, missing: [] };
}

// Worktree paths the phase's transfer records and execute state name, plus run ids whose args ran this phase.
function phaseTargets(root, phaseDirs, runsDir) {
  const paths = new Set();
  const runIds = new Set();
  for (const dir of phaseDirs) {
    const transfers = path.join(dir, "transfers");
    if (fs.existsSync(transfers)) for (const name of fs.readdirSync(transfers)) {
      if (!name.endsWith(".json")) continue;
      const wt = readJsonIf(path.join(transfers, name))?.worktree;
      if (typeof wt === "string" && wt) paths.add(path.resolve(root, wt));
    }
    const stages = readJsonIf(path.join(dir, "execute-progress.json"))?.stages ?? {};
    for (const rec of Object.values(stages)) if (typeof rec?.worktree === "string" && rec.worktree) paths.add(path.resolve(root, rec.worktree));
  }
  if (fs.existsSync(runsDir)) for (const name of fs.readdirSync(runsDir)) {
    const ref = readJsonIf(path.join(runsDir, name, "args.json"))?.phaseDir;
    if (typeof ref !== "string") continue;
    const abs = path.resolve(root, ref);
    if (phaseDirs.some((d) => samePath(d, abs))) runIds.add(name);
  }
  return { paths, runIds };
}

function archivePath(root, name) {
  const dir = path.join(root, "_workspace", "worktree-archive");
  const base = safeName(name) || "worktree";
  let file = path.join(dir, `${base}.patch`);
  let n = 2;
  while (fs.existsSync(file)) file = path.join(dir, `${base}-${n++}.patch`);
  return file;
}

export async function worktrees(ctx, { git = runGit, startsOf = processStartTimes } = {}) {
  if (ctx.opts["committed-phase"] !== undefined && !ctx.opts.prune) throw new UsageError("--committed-phase needs --prune");
  const top = repoTop(ctx.root, { git });
  if (!top) throw new Error(`${ctx.root} is not in a git repository; harness worktrees live under <repo>/${ctx.cfg.worktree_dir}`);
  const registered = listHarnessWorktrees(top, ctx.cfg, { git });
  const orphans = listOrphanWorktrees(top, ctx.cfg, { git });
  if (orphans === null) ctx.out("note git worktree list failed: orphan directories were not listed");
  const list = [...registered, ...(orphans ?? [])];
  if (!list.length) {
    ctx.out("no harness worktrees");
    return 0;
  }
  const runsDir = path.resolve(ctx.root, ctx.opts["runs-dir"] ?? RUNS_DIR);
  const runs = listRuns(runsDir);
  const alive = runs.filter((r) => r.info?.status === "running" && pidAlive(r.info.pid)).map((r) => r.info.pid);
  const starts = startsOf(alive);
  const agentNames = [...new Set(list.filter((w) => !w.missing).map((w) => ownerOf(w.name)).filter((o) => o.kind === "agent").map((o) => o.name))];
  const agentLive = await agentLiveness(ctx, agentNames, ctx.out);
  let phaseForce = null;
  let code = 0;
  if (ctx.opts["committed-phase"] !== undefined) {
    const dirs = phaseDirsFor(ctx.root, ctx.opts["committed-phase"]);
    if (!dirs.length) {
      ctx.out(`phase ${ctx.opts["committed-phase"]} has no directory under .planning/phases; its worktrees stay`);
      code = 1;
    } else {
      const states = dirs.map((d) => ({ dir: d, ...phaseCommitted(d) }));
      const blocked = states.filter((s) => !s.ok);
      if (blocked.length) {
        ctx.out(`phase ${ctx.opts["committed-phase"]} is not committed (${blocked.map((s) => `${path.basename(s.dir)}: ${s.why}`).join("; ")}); its executor worktrees stay`);
        code = 1;
      } else {
        phaseForce = phaseTargets(ctx.root, dirs, runsDir);
        ctx.out(`phase ${ctx.opts["committed-phase"]} is committed (${dirs.map((d) => path.basename(d)).join(", ")})`);
      }
    }
  }
  const ofPhase = (wt) => {
    if (!phaseForce) return false;
    if ([...phaseForce.paths].some((p) => samePath(p, wt.path))) return true;
    const owner = ownerOf(wt.name, runsDir);
    return owner.kind === "run" && phaseForce.runIds.has(owner.id);
  };
  let removed = 0;
  let failed = 0;
  for (const wt of list) {
    let c;
    try {
      c = classify(top, wt, { runsDir, agentLive, git, root: ctx.root, starts });
    } catch (e) {
      failed++;
      ctx.out(`failed ${wt.name}: ${errText(e)}`);
      continue;
    }
    ctx.out(`${c.state.padEnd(22)} ${c.branch} ${c.path} (${c.owner})`);
    if (!ctx.opts.prune) continue;
    const force = ofPhase(wt) && c.state !== "in use" && c.state !== "owner unknown";
    if (!c.removable && !force) continue;
    // A dirty executor tree of a committed phase, and every orphan, is archived first. Merged and transferred trees
    // already have their work elsewhere and keep the old removal (kit feedback 75).
    const r = c.orphan || (force && !c.removable)
      ? removeArchived(top, c, { git, archiveFile: archivePath(ctx.root, c.name) })
      : removeWorktree(top, c, { git });
    ctx.out(r.line);
    if (r.removed) removed++;
    if (!r.ok) failed++;
  }
  ctx.out(`worktrees: ${list.length} listed, ${removed} removed`);
  return failed ? 2 : code;
}

export const worktreeCommands = [
  {
    name: "worktrees",
    summary: "list harness git worktrees and their state; --prune removes merged-and-clean, transferred, missing and orphan ones; --committed-phase N also removes that phase's executor worktrees once its waves are committed",
    usage: "ph worktrees [--prune] [--committed-phase N] [--runs-dir D]",
    options: { prune: "bool", "committed-phase": "string", "runs-dir": "string" },
    config: "required",
    run: (ctx) => worktrees(ctx),
  },
];
