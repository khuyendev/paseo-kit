// adapter.worktree_setup: git-ignored paths a new harness worktree gets from the checkout before its agent starts.
// `git worktree add` checks out tracked files only, so without node_modules (or .venv, vendor/) an executor could not
// build or test (phase 7 of the kit: a paseo.json setup never ran, because Paseo does not create these worktrees).
// `copy` gives the worktree its own copy; `link` is a directory junction (symlink on POSIX) to the checkout's folder.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, readText, writeJsonAtomic } from "../lib/io.mjs";
import { isInside } from "../lib/paths.mjs";

const RECORD = "harness-setup.json";

const fold = (rel) => (process.platform === "win32" ? rel.toLowerCase() : rel);

// Dependency folders a toolchain reads without naming them in an argv or an instruction file (a Flutter build reads .dart_tool).
const TOOLCHAIN_DIRS = ["node_modules", ".venv", "vendor", ".dart_tool"];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pathProblem(rel) {
  if (typeof rel !== "string" || !rel) return "is not a repo-relative path";
  if (rel.includes("\\") || rel.includes(":") || rel.startsWith("/")) return "must be a repo-relative path with forward slashes";
  if (rel.split("/").some((p) => !p || p === "." || p === ".." || p === ".git")) return "has an empty, '.', '..' or '.git' segment";
  return null;
}

function linkedPart(root, rel) {
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) return current;
  }
  return null;
}

/** [{mode, rel}] of the configured entries, copy first. */
export function setupEntries(setup) {
  return [...(setup?.copy ?? []).map((rel) => ({ mode: "copy", rel })), ...(setup?.link ?? []).map((rel) => ({ mode: "link", rel }))];
}

/** One text per problem of the configured entries against the checkout at root; [] when every entry can be set up. */
export function setupProblems(root, setup, git) {
  const problems = [];
  const entries = setupEntries(setup);
  entries.forEach(({ mode, rel }, i) => {
    const key = `adapter.worktree_setup.${mode} ${rel}`;
    const bad = pathProblem(rel);
    if (bad) return problems.push(`${key}: ${bad}`);
    const other = entries.slice(0, i).find((e) => !pathProblem(e.rel) && (fold(e.rel) === fold(rel) || fold(rel).startsWith(`${fold(e.rel)}/`) || fold(e.rel).startsWith(`${fold(rel)}/`)));
    if (other) return problems.push(`${key}: overlaps ${other.mode} ${other.rel}`);
    const src = path.join(root, rel);
    const st = fs.lstatSync(src, { throwIfNoEntry: false });
    if (!st) return problems.push(`${key}: does not exist in the checkout (install or build it there first)`);
    const link = linkedPart(root, rel);
    if (link) return problems.push(`${key}: ${link} is a link`);
    if (mode === "link" && !st.isDirectory()) return problems.push(`${key}: link takes a directory`);
    // check-ignore never reports a tracked path: tracked files already come with the checkout.
    const r = git(root, ["check-ignore", "-q", "--", rel]);
    if (r.code === 1) return problems.push(`${key}: is not git-ignored (tracked files come with the worktree checkout)`);
    if (r.code !== 0) problems.push(`${key}: git check-ignore failed: ${(r.stderr || "no exit code").split("\n")[0]}`);
  });
  return problems;
}

/**
 * One text per git-ignored path of the checkout that the adapter uses and that no worktree_setup entry sets up; [] unless
 * gsd.isolation is worktree. Used: a toolchain folder at the top, or named by the adapter's argv (commands, gates, verify,
 * syntax checkers, dependency probe) or its instruction files. A directory is named with its slash (`upstream/`), a file by its path.
 */
export function setupGaps(root, cfg, git) {
  if (cfg.gsd.isolation !== "worktree") return [];
  const ignored = git(root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"]);
  if (ignored.code !== 0) return [];
  const a = cfg.adapter;
  const argvs = [a.commands.build, a.commands.test, a.dependency_probe, ...a.commands.gates.map((g) => g.argv), ...Object.values(a.commands.verify).map((v) => v.argv), ...Object.values(a.syntax_checkers).map((v) => v.argv)];
  const instructions = a.instructions.filter((rel) => fs.existsSync(path.resolve(root, rel))).map((rel) => readText(path.resolve(root, rel)));
  const text = [...argvs.flatMap((argv) => argv ?? []), ...instructions].join("\n");
  const set = setupEntries(a.worktree_setup).map(({ rel }) => fold(rel));
  return ignored.stdout.split("\0").filter(Boolean).flatMap((entry) => {
    const dir = entry.endsWith("/");
    const name = dir ? entry.slice(0, -1) : entry;
    const used = (dir && TOOLCHAIN_DIRS.includes(name)) || new RegExp(`(?:^|[^\\w.-])${escapeRe(entry)}${dir ? "" : "(?![\\w-])"}`).test(text);
    const covered = set.some((rel) => rel === fold(name) || rel.startsWith(`${fold(name)}/`) || fold(name).startsWith(`${rel}/`));
    if (!used || covered) return [];
    return [`adapter.worktree_setup: ${entry} is git-ignored and used by the adapter, but no entry sets it up in a new worktree (add it to copy or link)`];
  });
}

function recordPath(dir, git) {
  const gd = git(dir, ["rev-parse", "--absolute-git-dir"]);
  if (gd.code !== 0) throw new Error("worktree git directory unavailable");
  return path.join(gd.stdout.trim(), RECORD);
}

/**
 * Copies and links the entries into the new worktree wt ({top, path}); rejects before the agent starts on any problem.
 * The copy is asynchronous: a large dependency folder takes seconds, and a workflow runner keeps other agents going.
 */
export async function applyWorktreeSetup(root, wt, setup, git) {
  const entries = setupEntries(setup);
  if (!entries.length) return;
  const problems = setupProblems(root, setup, git);
  if (problems.length) throw new Error(`worktree setup: ${problems.join("; ")}`);
  const base = path.join(wt.path, path.relative(wt.top, root));
  const dests = entries.map((e) => ({ ...e, src: path.resolve(root, e.rel), dest: path.join(base, e.rel) }));
  const present = dests.find((d) => fs.lstatSync(d.dest, { throwIfNoEntry: false }));
  if (present) throw new Error(`worktree setup: ${present.rel} already exists in the worktree`);
  // Recorded before the first link exists, so removal finds every link even after a failure part way.
  writeJsonAtomic(recordPath(wt.path, git), { v: 1, links: dests.filter((d) => d.mode === "link").map((d) => d.dest) });
  for (const d of dests) {
    fs.mkdirSync(path.dirname(d.dest), { recursive: true });
    if (d.mode === "copy") await fs.promises.cp(d.src, d.dest, { recursive: true, verbatimSymlinks: true });
    else fs.symlinkSync(d.src, d.dest, process.platform === "win32" ? "junction" : "dir");
  }
}

// The record is data on disk: a link counts only when it sits inside dir, also once the folders on its way are followed.
function linkInside(dir, dest) {
  if (!isInside(dest, dir)) return false;
  try {
    return isInside(fs.realpathSync.native(path.dirname(dest)), fs.realpathSync.native(dir));
  } catch {
    return false;
  }
}

/**
 * Removes the setup links of a worktree directory before git removes it; leaves anything that is no longer a link.
 * Returns the recorded paths it left alone because they are not inside dir.
 */
export function removeSetupLinks(dir, git) {
  if (!fs.existsSync(dir)) return [];
  let record;
  try {
    record = readJsonIf(recordPath(dir, git), null);
  } catch {
    return [];
  }
  const kept = [];
  for (const recorded of record?.links ?? []) {
    const dest = path.resolve(dir, recorded);
    if (!linkInside(dir, dest)) {
      kept.push(recorded);
      continue;
    }
    // fs.rmSync without recursive removes the link itself, never the folder it points to.
    if (fs.lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmSync(dest);
  }
  return kept;
}
