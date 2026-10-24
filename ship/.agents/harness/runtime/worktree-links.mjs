// Links inside a harness worktree (kit feedback 75). A worktree can hold junctions or symlinks that point out of it: the
// setup links, and any an agent made. Whatever deletes the tree recursively through one deletes its target (the main
// checkout's `upstream/`), so every harness removal unlinks all of them first, never following one.
import fs from "node:fs";
import path from "node:path";

const lstat = (p) => fs.lstatSync(p, { throwIfNoEntry: false });

/** Every link under dir (dir itself excluded), found without following any; `unreadable` lists folders that could not be listed. */
export function findLinks(dir) {
  const links = [];
  const unreadable = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let names;
    try {
      names = fs.readdirSync(current);
    } catch (e) {
      unreadable.push(`${current} (${e.code ?? e.message})`);
      continue;
    }
    for (const name of names) {
      const child = path.join(current, name);
      const st = lstat(child);
      if (!st) continue;
      if (st.isSymbolicLink()) links.push(child);
      else if (st.isDirectory()) stack.push(child);
    }
  }
  return { links, unreadable };
}

/**
 * Unlinks every link in the worktree directory dir, non-recursively (a link is removed, never the folder it points to).
 * Returns {unlinked, refused}: refused lists what blocks a safe removal (a root that is a link, a folder that cannot be
 * listed, a link that stays), each with a reason; git must not remove the tree while it is not empty.
 */
export function clearLinks(dir) {
  const root = lstat(dir);
  if (!root) return { unlinked: [], refused: [] };
  if (root.isSymbolicLink()) return { unlinked: [], refused: [{ path: dir, reason: "the worktree directory is itself a link" }] };
  const { links, unreadable } = findLinks(dir);
  const refused = unreadable.map((p) => ({ path: p, reason: "folder cannot be listed, so its links are unknown" }));
  const unlinked = [];
  for (const link of links) {
    let failure = null;
    try {
      // fs.rmSync without recursive removes the link itself (a junction too), never the folder it points to.
      fs.rmSync(link);
    } catch (e) {
      failure = e.code ?? e.message;
    }
    if (lstat(link)) refused.push({ path: link, reason: `link could not be removed (${failure ?? "still present"})` });
    else unlinked.push(link);
  }
  return { unlinked, refused };
}

/**
 * Deletes dir after clearLinks, never following a link: lstat, non-recursive unlink of a link, recurse only into a real
 * directory (kit feedback 126). A link that stays, or a dir that is itself a link, is refused and nothing further is removed.
 */
export function removeUnlinkedTree(dir) {
  const root = lstat(dir);
  if (!root) return { ok: true, removed: false };
  if (root.isSymbolicLink()) return { ok: false, removed: false, reason: "the worktree directory is itself a link" };
  const { refused } = clearLinks(dir);
  if (refused.length) return { ok: false, removed: false, reason: `refused, a link in the worktree stays: ${refused.map((r) => `${r.path} (${r.reason})`).join("; ")}` };
  const rm = (current) => {
    for (const name of fs.readdirSync(current)) {
      const child = path.join(current, name);
      const st = lstat(child);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        fs.rmSync(child);
        if (lstat(child)) throw new Error(`link stayed: ${child}`);
      } else if (st.isDirectory()) rm(child);
      else fs.rmSync(child);
    }
    fs.rmdirSync(current);
  };
  try {
    rm(dir);
  } catch (e) {
    return { ok: false, removed: false, reason: e.message ?? String(e) };
  }
  return { ok: true, removed: true };
}
