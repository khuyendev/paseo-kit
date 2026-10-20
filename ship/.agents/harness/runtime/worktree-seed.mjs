// Accepted dependency output is copied before dispatch, never committed by the worker (GSDF-41/94).
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../lib/hash.mjs";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { resolveInside } from "../lib/paths.mjs";

function fileInside(root, rel) {
  if (typeof rel !== "string" || rel.includes("\\") || rel.includes(":") || rel.split("/").some((p) => !p || p === "." || p === ".." || p === ".git")) throw new Error(`invalid worktree seed path: ${rel}`);
  const abs = resolveInside(root, rel);
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`worktree seed path is a link: ${rel}`);
  }
  return abs;
}

export function seedWorktree(root, wt, seed, git) {
  if (!seed) return;
  if (!Array.isArray(seed.files) || typeof seed.head !== "string") throw new Error("invalid worktree seed");
  const base = git(wt.path, ["rev-parse", "HEAD"]);
  if (base.code !== 0 || base.stdout.trim() !== seed.head) throw new Error("worktree seed HEAD changed");
  const seen = new Set();
  const copies = seed.files.map((file) => {
    const key = process.platform === "win32" ? file.path?.toLowerCase() : file.path;
    if (seen.has(key)) throw new Error(`duplicate worktree seed path: ${file.path}`);
    seen.add(key);
    const source = fileInside(root, file.path);
    const dest = fileInside(wt.path, file.path);
    if (file.deleted === true) {
      if (fs.existsSync(source)) throw new Error(`worktree seed changed: ${file.path}`);
      return { file, dest, bytes: null };
    }
    const bytes = fs.readFileSync(source);
    if (sha256(bytes) !== file.sha256) throw new Error(`worktree seed changed: ${file.path}`);
    return { file, dest, bytes };
  });
  const gd = git(wt.path, ["rev-parse", "--absolute-git-dir"]);
  if (gd.code !== 0) throw new Error("worktree git directory unavailable");
  for (const { dest, bytes } of copies) {
    if (bytes === null) fs.rmSync(dest, { force: true });
    else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); }
  }
  writeJsonAtomic(path.join(gd.stdout.trim(), "harness-seed.json"), seed);
}

export function readWorktreeSeed(dir, git) {
  const gd = git(dir, ["rev-parse", "--absolute-git-dir"]);
  if (gd.code !== 0) throw new Error("worktree git directory unavailable");
  return readJsonIf(path.join(gd.stdout.trim(), "harness-seed.json"), null);
}
