// Harness git worktrees: created for `ph spawn --worktree` and workflow isolation (PHCL-31), listed and pruned by
// `ph worktrees` (PHCL-32). Removal must never lose work: only merged-and-clean, transferred (kit feedback 75: the whole delta
// landed in the main tree by transfer) or directory-missing entries go, and only through targeted git commands (never the
// repo-wide `git worktree prune`, which drops unrelated stale records).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UsageError, errText } from "../lib/cli.mjs";
import { readJsonIf, writeJsonAtomic, writeTextAtomic } from "../lib/io.mjs";
import { isInside, safeName, samePath, toSlash } from "../lib/paths.mjs";
import { pidAlive, runnerLive } from "../lib/proc.mjs";
import { seedWorktree } from "./worktree-seed.mjs";
import { unlanded } from "./worktree-landed.mjs";
import { clearLinks, removeUnlinkedTree } from "./worktree-links.mjs";
import { applyWorktreeSetup, removeSetupLinks } from "./worktree-setup.mjs";

// timeoutMs bounds the call: spawnSync blocks the whole ph process while git runs, so a hung git must end on its own (G146).
// raw keeps stdout as git printed it (a porcelain status starts with a space that trim would eat).
export function runGit(cwd, args, { timeoutMs, raw = false } = {}) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, timeout: timeoutMs });
  const stdout = r.stdout ?? "";
  return { code: r.error ? null : r.status, stdout: raw ? stdout : stdout.trim(), stderr: (r.stderr ?? String(r.error ?? "")).trim() };
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

// A lease holds a new tree from its creation until its agent is registered (`lease: true`, spawn and fanout). The file
// records the pid of the spawning process; a dead pid is a crashed spawn and holds nothing.
const leasePath = (base, name) => path.join(base, `${name}.lease`);

function leaseHeld(file) {
  if (!file) return false;
  return pidAlive(readJsonIf(file)?.pid);
}

export function releaseLease(wt) {
  if (wt?.lease) fs.rmSync(wt.lease, { force: true });
}

// timeoutMs: the time the call has left when the step starts; each git call gets what is left of it (G146). Discarding stays unbounded.
export async function createWorktree(root, cfg, name, { git = runGit, seed, lease = false, timeoutMs } = {}) {
  const until = timeoutMs === undefined ? null : Date.now() + timeoutMs;
  const bounded = (cwd, args) => git(cwd, args, { timeoutMs: until === null ? undefined : Math.max(1, until - Date.now()) });
  const top = repoTop(root, { git: bounded });
  if (!top) throw new UsageError("isolation 'worktree' needs a git repository");
  const safe = safeName(name);
  const dir = path.join(worktreeBase(top, cfg), safe);
  const branch = `harness/${safe}`;
  const wt = { top, path: dir, branch, name: safe, lease: lease ? leasePath(worktreeBase(top, cfg), safe) : null };
  if (wt.lease) writeJsonAtomic(wt.lease, { pid: process.pid });
  try {
    must(bounded, top, ["worktree", "add", dir, "-b", branch]);
  } catch (e) {
    releaseLease(wt);
    throw e;
  }
  try {
    seedWorktree(root, wt, seed, bounded);
    await applyWorktreeSetup(root, wt, cfg.adapter.worktree_setup, bounded);
    return wt;
  } catch (e) {
    const undone = discardWorktree(wt, { git });
    if (!undone.ok) e.message += ` (worktree ${wt.path} kept: ${undone.reason})`;
    throw e;
  }
}

// Every link of a worktree directory goes before git removes the tree (kit feedback 75): the recorded setup links, then any
// other link found in it, an agent's included. {left, refusal}: recorded paths outside the tree that were left alone, and the
// reason the tree must stay (null when it holds no link any more).
function unlinkAll(dir, git) {
  const left = removeSetupLinks(dir, git);
  const { refused } = clearLinks(dir);
  return { left, refusal: refused.length ? `refused, a link in the worktree stays: ${refused.map((r) => `${r.path} (${r.reason})`).join("; ")}` : null };
}

// Undo a worktree whose agent could not be created: the directory, the new branch and the lease go, nothing else. A link that
// cannot be unlinked keeps all of them: {ok: false, reason}.
export function discardWorktree(wt, { git = runGit } = {}) {
  const { refusal } = unlinkAll(wt.path, git);
  if (refusal) return { ok: false, reason: refusal };
  git(wt.top, ["worktree", "remove", "--force", wt.path]);
  git(wt.top, ["branch", "-D", wt.branch]);
  releaseLease(wt);
  return { ok: true };
}

const WORKFLOW_NAME = /^(wf_\d{8}-\d{6}_[0-9a-f]{4})-\d+$/;
const AGENT_NAME = /^(.+)-\d{8}-\d{6}_[0-9a-f]{4}$/;
// A custom --run-id (any safe id) names its isolated agents `<run id>-<n>`; the digits after the last hyphen are n.
const RUN_AGENT_NAME = /^(.+)-\d+$/;

export function ownerOf(name, runsDir) {
  const wf = WORKFLOW_NAME.exec(name);
  if (wf) return { kind: "run", id: wf[1] };
  const agent = AGENT_NAME.exec(name);
  if (agent) return { kind: "agent", name: agent[1] };
  // Only a prefix that names an existing run dir is a run; a stray `<word>-<digits>` stays unknown.
  const custom = RUN_AGENT_NAME.exec(name);
  if (custom && runsDir && fs.existsSync(path.join(runsDir, custom[1], "run.json"))) return { kind: "run", id: custom[1] };
  return { kind: "unknown" };
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
    const name = path.basename(abs);
    list.push({ path: abs, name, branch, missing, lease: leasePath(base, name) });
  }
  return list;
}

// Absolute paths `git worktree list` names, or null when git cannot be asked (an unknown list must not look empty).
export function listedWorktreePaths(top, { git = runGit } = {}) {
  const r = git(top, ["worktree", "list", "--porcelain"]);
  if (r.code !== 0) return null;
  const paths = new Set();
  for (const line of r.stdout.split(/\r?\n/)) if (line.startsWith("worktree ")) paths.add(path.resolve(line.slice("worktree ".length)));
  return paths;
}

/**
 * Directories under the harness worktree root that git does not list (kit feedback 126 F2). `git -C` one of these is the
 * main checkout. Null when git cannot be asked. A link at the root is not a directory to remove.
 */
export function listOrphanWorktrees(top, cfg, { git = runGit } = {}) {
  const listed = listedWorktreePaths(top, { git });
  if (!listed) return null;
  const base = worktreeBase(top, cfg);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const name of fs.readdirSync(base)) {
    const abs = path.join(base, name);
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
    if (listed.has(path.resolve(abs))) continue;
    out.push({ path: abs, name, branch: "-", missing: false, orphan: true, lease: leasePath(base, name) });
  }
  return out;
}

// The changed paths of a worktree as git status lists them, renames as two paths (the old one is gone from the tree).
export function worktreeEntries(dir, git = runGit) {
  const parts = must((cwd, args) => git(cwd, args, { raw: true }), dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    entries.push({ path: parts[i].slice(3), code });
    if (code[0] === "R" || code[0] === "C") entries.push({ path: parts[++i], code: " D" });
  }
  return entries;
}

// What a worktree that nobody uses holds: nothing, commits, a delta that all landed by transfer, or work that may not have landed.
function contentState(top, wt, root, git) {
  const dirty = must(git, wt.path, ["status", "--porcelain", "--untracked-files=all"]) !== "";
  const commitsAhead = () => Number(must(git, top, ["rev-list", "--count", `HEAD..${wt.branch}`]));
  if (!dirty) {
    const ahead = commitsAhead();
    return ahead ? `${ahead} commit(s) not in HEAD` : "merged and clean";
  }
  if (root && !commitsAhead() && !unlanded(root, wt.path, worktreeEntries(wt.path, git), git).length) return "transferred";
  return "uncommitted changes";
}

/**
 * inUse: run id -> from run.json; agent name -> agentLive.get(name) (true/false, undefined when the daemon was not asked).
 * root (the project root) lets a dirty tree whose whole delta landed by transfer be `transferred`, and so removable (kit feedback 75).
 */
export function classify(top, wt, { runsDir, agentLive = new Map(), git = runGit, root, starts }) {
  const owner = ownerOf(wt.name, runsDir);
  let inUse = null;
  let ownerText = "owner unknown";
  if (owner.kind === "run") {
    ownerText = `run ${owner.id}`;
    const info = readJsonIf(path.join(runsDir, owner.id, "run.json"));
    // A runner killed without a terminal status, or whose pid was reused, no longer uses its worktrees (kit feedback 118).
    if (info) inUse = runnerLive(info, { starts });
  } else if (owner.kind === "agent") {
    ownerText = `agent ${owner.name}`;
    inUse = agentLive.get(owner.name) ?? null;
  }
  // A spawn that has not registered its agent yet is still using the tree, whatever the daemon says.
  if (leaseHeld(wt.lease)) return { ...wt, owner: ownerText, state: "in use", removable: false };
  // The directory is gone: only git's record and the branch remain, no file can be lost.
  if (wt.missing) return { ...wt, owner: ownerText, state: "directory missing", removable: true };
  // A dir git does not list is not a worktree: git -C there is the main repo, so it is never classified by status (126 F2).
  if (wt.orphan) {
    if (inUse === true) return { ...wt, owner: ownerText, state: "in use", removable: false };
    if (inUse === null && owner.kind === "agent") return { ...wt, owner: ownerText, state: "owner unknown", removable: false };
    return { ...wt, owner: ownerText, state: "orphan", removable: true };
  }
  let state;
  if (inUse === null) state = "owner unknown";
  else if (inUse) state = "in use";
  else state = contentState(top, wt, root, git);
  return { ...wt, owner: ownerText, state, removable: state === "merged and clean" || state === "transferred" };
}

/**
 * The harness worktrees of finished runs that are still there (kit feedback 75): {total, removable, names}. A tree of a run
 * that is still going, of a spawned agent or of an unknown owner is not a leftover. The list is [] when git cannot be asked.
 */
export function leftoverWorktrees(root, cfg, { runsDir, git = runGit } = {}) {
  const top = repoTop(root, { git });
  if (!top) return { total: 0, removable: 0, names: [] };
  const left = [];
  for (const wt of listHarnessWorktrees(top, cfg, { git })) {
    if (ownerOf(wt.name, runsDir).kind !== "run") continue;
    try {
      const c = classify(top, wt, { runsDir, git, root });
      if (c.state !== "in use") left.push(c);
    } catch {
      left.push({ ...wt, removable: false });
    }
  }
  return { total: left.length, removable: left.filter((c) => c.removable).length, names: left.map((c) => c.name) };
}

/** Removes one removable worktree, then its branch when git agrees it is merged. Returns {ok, line}. */
export function removeWorktree(top, wt, { git = runGit, force = false } = {}) {
  const { left, refusal } = wt.missing ? { left: [], refusal: null } : unlinkAll(wt.path, git);
  if (refusal) return { ok: false, removed: false, line: `failed remove ${wt.name}: ${refusal}` };
  const note = left.length ? `; left ${left.length} recorded path(s) outside the worktree: ${left.join(", ")}` : "";
  // `worktree remove --force <path>` drops only this entry's registration when its directory is gone. A transferred tree is
  // dirty by design (its work lives in the main tree), so git needs --force for it as well.
  const removed = git(top, wt.missing || force || wt.state === "transferred" ? ["worktree", "remove", "--force", wt.path] : ["worktree", "remove", wt.path]);
  if (removed.code !== 0) {
    if (wt.missing) return { ok: true, removed: false, line: `kept ${wt.name}: registration of a missing directory cannot be removed without touching others` };
    return { ok: false, removed: false, line: `failed remove ${wt.name}: ${errText(removed.stderr || removed.stdout || "git worktree remove failed")}` };
  }
  releaseLease(wt);
  const branch = git(top, ["branch", "-d", wt.branch]);
  if (branch.code === 0) return { ok: true, removed: true, line: `removed ${wt.name} and branch ${wt.branch}${note}` };
  return { ok: true, removed: true, line: `removed ${wt.name}; branch ${wt.branch} kept (${errText(branch.stderr || branch.stdout)})${note}` };
}

/**
 * Removes the harness worktree at wtPath for gsd-execute (kit feedback 75). reason "landed": the plan's commit is recorded, so
 * the run's own tree goes once its whole delta landed (nothing else: unlanded work stays). reason "halted": the plan's halt was
 * cleared and the plan is dispatched again, so its old tree goes unless the run that owns it still uses it. Returns
 * {removed, gone, why}; `gone` when no such harness worktree is registered.
 */
export function retireWorktree(root, cfg, wtPath, { reason, runsDir, git = runGit }) {
  const top = repoTop(root, { git });
  if (!top) return { removed: false, why: "not in a git repository" };
  const abs = path.resolve(root, wtPath);
  const wt = listHarnessWorktrees(top, cfg, { git }).find((w) => samePath(w.path, abs));
  if (!wt) return { removed: false, gone: true, why: "no such harness worktree" };
  const c = reason === "halted" ? classify(top, wt, { runsDir, git, root }) : { ...wt, state: wt.missing ? "directory missing" : contentState(top, wt, root, git) };
  if (c.state === "in use") return { removed: false, why: "its run still uses it" };
  if (reason === "landed" && !(c.state === "merged and clean" || c.state === "transferred" || c.state === "directory missing")) return { removed: false, why: c.state === "uncommitted changes" ? "its delta is not all in the transfer record" : c.state };
  const r = removeWorktree(top, c, { git, force: reason === "halted" });
  return { removed: r.removed, why: r.line };
}

const BINARY_NOTE = 512 * 1024;

function pathHasLink(root, rel) {
  let cur = root;
  for (const part of toSlash(rel).split("/")) {
    cur = path.join(cur, part);
    const st = fs.lstatSync(cur, { throwIfNoEntry: false });
    if (!st) return false;
    if (st.isSymbolicLink()) return true;
  }
  return false;
}

function looksText(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return buf.length <= BINARY_NOTE;
}

// One unified diff of a file against the main checkout's copy (null when the main tree has no such file). Identical files
// are empty. A binary or a large file is a note, not a dump of the bytes.
function fileDelta(rel, before, after) {
  if (before && after.equals(before)) return "";
  const slash = toSlash(rel);
  if (!looksText(after) || (before && !looksText(before))) return `# binary ${slash} ${after.length} bytes\n`;
  const oldText = before ? before.toString("utf8") : null;
  const newText = after.toString("utf8");
  const oldLines = oldText === null ? [] : oldText.split("\n");
  const newLines = newText.split("\n");
  return [
    `diff --git a/${slash} b/${slash}`,
    `--- ${oldText === null ? "/dev/null" : `a/${slash}`}`,
    `+++ b/${slash}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
    "",
  ].join("\n");
}

// Files under dir, links not followed and not entered (a junction's target is not part of the delta).
function walkRealFiles(dir, rel = "") {
  const out = [];
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (rel === "" && name === ".git") continue;
    const child = path.join(dir, name);
    const st = fs.lstatSync(child, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink()) continue;
    const next = rel ? path.join(rel, name) : name;
    if (st.isDirectory()) out.push(...walkRealFiles(child, next));
    else if (st.isFile()) out.push(next);
  }
  return out;
}

// The delta of a directory git does not list, compared to the main checkout file by file. Git is not run in dir.
function orphanDelta(top, dir) {
  const parts = ["# orphan: git was not run in this directory\n"];
  for (const rel of walkRealFiles(dir)) {
    let after;
    try { after = fs.readFileSync(path.join(dir, rel)); } catch { continue; }
    const main = path.join(top, rel);
    const before = fs.lstatSync(main, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(main) : null;
    const diff = fileDelta(toSlash(rel), before, after);
    if (diff) parts.push(diff);
  }
  return parts.join("");
}

// Tracked delta of a registered worktree against the main HEAD, plus untracked files (git diff does not list those).
function registeredDelta(top, dir, git) {
  const head = git(top, ["rev-parse", "HEAD"]);
  if (head.code !== 0 || !head.stdout) return null;
  const diff = git(dir, ["diff", "--binary", head.stdout]);
  let text = diff.stdout ?? "";
  if (text && !text.endsWith("\n")) text += "\n";
  let entries = [];
  try { entries = worktreeEntries(dir, git); } catch { return text; }
  for (const e of entries) {
    if (!e.code.includes("?")) continue;
    // A junction or symlink is not part of the delta: reading it would follow the link into the target (126).
    if (pathHasLink(dir, e.path)) continue;
    let after;
    try { after = fs.readFileSync(path.join(dir, e.path)); } catch { continue; }
    text += fileDelta(toSlash(e.path), null, after);
  }
  return text;
}

/** Writes the worktree's delta to dest. An orphan is never asked through git. Returns {ok, file, reason}. */
export function archiveWorktreeDelta(top, wt, dest, { git = runGit } = {}) {
  const body = wt.orphan ? orphanDelta(top, wt.path) : registeredDelta(top, wt.path, git);
  if (body === null) return { ok: false, reason: "git diff failed; the worktree was not removed" };
  const text = `# worktree-archive ${wt.name}\n# path ${wt.path}\n# orphan ${Boolean(wt.orphan)}\n# branch ${wt.branch ?? "-"}\n${body}`;
  writeTextAtomic(dest, text.endsWith("\n") ? text : `${text}\n`);
  return { ok: true, file: dest };
}

/**
 * Archives the delta, unlinks every link, then removes the tree (kit feedback 126). A registered worktree goes through
 * `git worktree remove --force`; an orphan is deleted by removeUnlinkedTree (never git -C, never a recursive remove that
 * could follow a junction). A link that stays keeps the tree and the archive.
 */
export function removeArchived(top, wt, { git = runGit, archiveFile }) {
  const archived = archiveWorktreeDelta(top, wt, archiveFile, { git });
  if (!archived.ok) return { ok: false, removed: false, line: `failed remove ${wt.name}: ${archived.reason}` };
  const note = `; archived ${archiveFile}`;
  if (wt.orphan) {
    const gone = removeUnlinkedTree(wt.path);
    if (!gone.ok) return { ok: false, removed: false, line: `failed remove ${wt.name}: ${gone.reason}${note}` };
    return { ok: true, removed: true, line: `removed orphan ${wt.name}${note}` };
  }
  const r = removeWorktree(top, { ...wt, state: "uncommitted changes" }, { git, force: true });
  return { ...r, line: `${r.line}${note}` };
}
