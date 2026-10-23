// Did a worktree's work land in the main tree? gsd-execute moves an executor's delta by `transfer` (a copy, never a commit in
// the worktree), and the transfer record lists each copied path with the hash of the worktree's content (kit feedback 75).
// A worktree whose every changed path has such a record is `transferred`: removing it loses nothing.
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../lib/hash.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { readWorktreeSeed } from "./worktree-seed.mjs";

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const sameDir = (a, b) => fold(path.resolve(a)) === fold(path.resolve(b));

/** Hash of a worktree file as the transfer records it; `deleted` when the path is gone. */
export function fileHash(abs) {
  const st = fs.statSync(abs, { throwIfNoEntry: false });
  return st?.isFile() ? sha256(fs.readFileSync(abs)) : "deleted";
}

/** [{record, pending}] of every plan of the project whose transfer record names the worktree wtPath. */
export function transfersOf(root, wtPath) {
  const phases = path.join(root, ".planning", "phases");
  const found = [];
  if (!fs.existsSync(phases)) return found;
  for (const dir of fs.readdirSync(phases)) {
    const tdir = path.join(phases, dir, "transfers");
    if (!fs.existsSync(tdir)) continue;
    for (const file of fs.readdirSync(tdir).filter((f) => f.endsWith(".json"))) {
      const record = readJsonIf(path.join(tdir, file), null);
      if (!record || typeof record.worktree !== "string" || !Array.isArray(record.files) || !sameDir(path.resolve(root, record.worktree), wtPath)) continue;
      // A transfer that started and never finished (G069) copied only part of the delta.
      found.push({ record, pending: fs.existsSync(path.join(phases, dir, "transfers-pending", file)) });
    }
  }
  return found;
}

/**
 * The changed paths of the worktree wtPath (entries: [{path}] from git status) that no transfer record accounts for; [] means
 * the whole delta landed. A path is accounted for by a finished transfer of this worktree that has it with the same content
 * (deleted: still absent), or by an accepted-dependency seed file that is still as seeded.
 */
export function unlanded(root, wtPath, entries, git) {
  const transfers = transfersOf(root, wtPath);
  const done = transfers.filter((t) => !t.pending).map((t) => t.record);
  const landed = new Map();
  for (const rec of done) {
    for (const f of rec.files) landed.set(f.path, f.deleted ? "deleted" : f.wt_sha256 ?? f.sha256);
    // A dropped path (regenerated output, line endings only) was refused for copying on purpose; the main tree's version stays.
    for (const d of rec.dropped ?? []) if (d.wt_sha256 && !landed.has(d.path)) landed.set(d.path, d.wt_sha256);
  }
  let seed = null;
  try {
    seed = readWorktreeSeed(wtPath, git);
  } catch {
    seed = null;
  }
  const seeded = new Map((seed?.files ?? []).map((f) => [f.path, f.deleted ? "deleted" : f.sha256]));
  return entries.map((e) => e.path).filter((p) => {
    const have = fileHash(path.join(wtPath, p));
    return landed.get(p) !== have && seeded.get(p) !== have;
  });
}
