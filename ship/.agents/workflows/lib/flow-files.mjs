// File primitives for workflow scripts: reads, existence, and guarded writes inside the project root.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, readText, writeJsonAtomic, writeTextAtomic } from "../../harness/lib/io.mjs";
import { resolveInside, safeName, toSlash } from "../../harness/lib/paths.mjs";

// Shared planning files have one writer, `ph gsd` (GSDC-12); scripts never write them directly.
const SINGLE_WRITER = [".planning/PROJECT.md", ".planning/STATE.md", ".planning/ROADMAP.md", ".planning/REQUIREMENTS.md"];

export function guardedPath(root, rel) {
  const abs = resolveInside(root, rel);
  const relSlash = toSlash(path.relative(root, abs)).toLowerCase();
  if (SINGLE_WRITER.some((p) => p.toLowerCase() === relSlash)) throw new Error(`single writer: ${rel} is written only by ph gsd`);
  return abs;
}

export function exists(root, rels) {
  const out = {};
  for (const rel of rels) out[rel] = fs.existsSync(resolveInside(root, rel));
  return { exists: out };
}

export function read(root, rel) {
  const abs = resolveInside(root, rel);
  if (!fs.existsSync(abs)) return { exists: false, text: null };
  return { exists: true, text: readText(abs) };
}

export function write(root, rel, text) {
  writeTextAtomic(guardedPath(root, rel), text);
  return { written: rel };
}

export function append(root, rel, text) {
  const abs = guardedPath(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return { appended: rel };
}

// Append one entry to a JSON array file (commits.json, GSDF-53), atomically.
export function jsonPush(root, rel, entry) {
  const abs = guardedPath(root, rel);
  const list = readJsonIf(abs, []);
  if (!Array.isArray(list)) throw new Error(`${rel} is not a JSON array`);
  list.push(entry);
  writeJsonAtomic(abs, list);
  return { pushed: rel, count: list.length };
}


export function remove(root, rel) {
  const abs = guardedPath(root, rel);
  const existed = fs.existsSync(abs);
  fs.rmSync(abs, { force: true });
  return { removed: existed ? rel : null };
}

// Run-scoped exclusive lock under _workspace/locks/: a holder whose run is no longer running is stale.
export function lock(root, name, runId) {
  const file = guardedPath(root, `_workspace/locks/${name}.lock`);
  const held = readJsonIf(file, null);
  if (held && held.runId !== runId) {
    const run = readJsonIf(path.join(root, "_workspace/_runs", safeName(held.runId), "run.json"), null);
    if (run?.status === "running") return { locked: false, holder: held.runId, code: 1 };
  }
  writeJsonAtomic(file, { runId });
  return { locked: true };
}

export function unlock(root, name, runId) {
  const file = guardedPath(root, `_workspace/locks/${name}.lock`);
  if (readJsonIf(file, null)?.runId === runId) fs.rmSync(file, { force: true });
  return { unlocked: true };
}
