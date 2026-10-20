// Harness git worktrees: created for `ph spawn --worktree` and workflow isolation (PHCL-31), listed and pruned by
// `ph worktrees` (PHCL-32). Removal must never lose work: only merged-and-clean or directory-missing entries go, and
// only through targeted git commands (never the repo-wide `git worktree prune`, which drops unrelated stale records).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UsageError, errText } from "../lib/cli.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { isInside, safeName } from "../lib/paths.mjs";
import { pidAlive } from "../lib/proc.mjs";
import { seedWorktree } from "./worktree-seed.mjs";

export function runGit(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  return { code: r.error ? null : r.status, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? String(r.error ?? "")).trim() };
}

function must(git, cwd, args) {
  const r = git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr || r.stdout || "failed").split("\n")[0]}`);
  return r.stdout;
}

export function repoTop(root, { git = runGit } = {}) {
  const r = git(root, ["rev-parse", "--show-toplevel"]);
  return r.code === 0 && r.stdout ? path.resolve(r.stdout) : null;
}

const two = (n) => String(n).padStart(2, "0");

// `yyyymmdd-hhmmss_xxxx` in local time, the same shape as the stamp of a workflow run id.
export function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}_${randomBytes(2).toString("hex")}`;
}

export function worktreeBase(top, cfg) {
  return path.join(top, cfg.worktree_dir);
}

export function createWorktree(root, cfg, name, { git = runGit, seed } = {}) {
  const top = repoTop(root, { git });
  if (!top) throw new UsageError("isolation 'worktree' needs a git repository");
  const safe = safeName(name);
  const dir = path.join(worktreeBase(top, cfg), safe);
  const branch = `harness/${safe}`;
  must(git, top, ["worktree", "add", dir, "-b", branch]);
  const wt = { top, path: dir, branch, name: safe };
  try {
    seedWorktree(root, wt, seed, git);
    return wt;
  } catch (e) {
    discardWorktree(wt, { git });
    throw e;
  }
}

// Undo a worktree whose agent could not be created: the directory and the new branch go, nothing else.
export function discardWorktree(wt, { git = runGit } = {}) {
  git(wt.top, ["worktree", "remove", "--force", wt.path]);
  git(wt.top, ["branch", "-D", wt.branch]);
}

const WORKFLOW_NAME = /^(wf_\d{8}-\d{6}_[0-9a-f]{4})-\d+$/;
const AGENT_NAME = /^(.+)-\d{8}-\d{6}_[0-9a-f]{4}$/;

export function ownerOf(name) {
  const wf = WORKFLOW_NAME.exec(name);
  if (wf) return { kind: "run", id: wf[1] };
  const agent = AGENT_NAME.exec(name);
  return agent ? { kind: "agent", name: agent[1] } : { kind: "unknown" };
}

export function listHarnessWorktrees(top, cfg, { git = runGit } = {}) {
  const base = worktreeBase(top, cfg);
  const list = [];
  for (const block of must(git, top, ["worktree", "list", "--porcelain"]).split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const field = (key) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
    const wt = field("worktree");
    const branch = field("branch")?.replace(/^refs\/heads\//, "");
    if (!wt || !branch?.startsWith("harness/")) continue;
    const abs = path.resolve(wt);
    if (abs === path.resolve(base) || !isInside(abs, base)) continue;
    const missing = lines.some((l) => l === "prunable" || l.startsWith("prunable ")) || !fs.existsSync(abs);
    list.push({ path: abs, name: path.basename(abs), branch, missing });
  }
  return list;
}

/** inUse: run id -> from run.json; agent name -> agentLive.get(name) (true/false, undefined when the daemon was not asked). */
export function classify(top, wt, { runsDir, agentLive = new Map(), git = runGit }) {
  const owner = ownerOf(wt.name);
  let inUse = null;
  let ownerText = "owner unknown";
  if (owner.kind === "run") {
    ownerText = `run ${owner.id}`;
    const info = readJsonIf(path.join(runsDir, owner.id, "run.json"));
    // A runner killed without a terminal status no longer uses its worktrees.
    if (info) inUse = info.status === "running" && pidAlive(info.pid);
  } else if (owner.kind === "agent") {
    ownerText = `agent ${owner.name}`;
    inUse = agentLive.get(owner.name) ?? null;
  }
  // The directory is gone: only git's record and the branch remain, no file can be lost.
  if (wt.missing) return { ...wt, owner: ownerText, state: "directory missing", removable: true };
  let state;
  if (inUse === null) state = "owner unknown";
  else if (inUse) state = "in use";
  else if (must(git, wt.path, ["status", "--porcelain", "--untracked-files=all"]) !== "") state = "uncommitted changes";
  else {
    const ahead = Number(must(git, top, ["rev-list", "--count", `HEAD..${wt.branch}`]));
    state = ahead ? `${ahead} commit(s) not in HEAD` : "merged and clean";
  }
  return { ...wt, owner: ownerText, state, removable: state === "merged and clean" };
}

/** Removes one removable worktree, then its branch when git agrees it is merged. Returns {ok, line}. */
export function removeWorktree(top, wt, { git = runGit } = {}) {
  // `worktree remove --force <path>` drops only this entry's registration when its directory is gone.
  const removed = git(top, wt.missing ? ["worktree", "remove", "--force", wt.path] : ["worktree", "remove", wt.path]);
  if (removed.code !== 0) {
    if (wt.missing) return { ok: true, removed: false, line: `kept ${wt.name}: registration of a missing directory cannot be removed without touching others` };
    return { ok: false, removed: false, line: `failed remove ${wt.name}: ${errText(removed.stderr || removed.stdout || "git worktree remove failed")}` };
  }
  const branch = git(top, ["branch", "-d", wt.branch]);
  if (branch.code === 0) return { ok: true, removed: true, line: `removed ${wt.name} and branch ${wt.branch}` };
  return { ok: true, removed: true, line: `removed ${wt.name}; branch ${wt.branch} kept (${errText(branch.stderr || branch.stdout)})` };
}
