// File primitives for workflow scripts: reads, existence, and guarded writes inside the project root.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, readText, writeJsonAtomic, writeTextAtomic } from "../../harness/lib/io.mjs";
import { resolveInside, toSlash } from "../../harness/lib/paths.mjs";
import { pidAlive } from "../../harness/lib/proc.mjs";
import { randomUUID } from "node:crypto";

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

// GSDF-64: debug, plan and execute share one root writer lock. The short transition claim serializes
// acquisition, stale reclamation and release, so a contender cannot remove a newly acquired lease.
// Unknown liveness (including an interrupted transition) fails closed; it is never permission to write.
const lockFile = (root, name) => guardedPath(root, `_workspace/locks/${name}.lock`);
const live = (held) => !Number.isInteger(held?.pid) || pidAlive(held.pid);
function transition(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const claim = `${file}.transition`;
  try { fs.mkdirSync(claim); } catch (e) {
    if (e.code === "EEXIST") return { locked: false, holder: "lock transition (retry after checking the holder)", code: 1 };
    throw e;
  }
  try { return fn(); } finally { fs.rmdirSync(claim); }
}
export function lock(root, name, runId, pid = process.ppid) {
  const file = lockFile(root, name);
  return transition(file, () => {
    const held = readJsonIf(file, null);
    if (held && live(held)) return { locked: false, holder: held.runId, code: 1 };
    const token = randomUUID();
    writeJsonAtomic(file, { runId, pid, token });
    return { locked: true, token };
  });
}
export function lockCheck(root, name) {
  const file = lockFile(root, name);
  const held = readJsonIf(file, null);
  return (held && live(held)) || fs.existsSync(`${file}.transition`) ? { held: true, holder: held?.runId ?? "lock transition", code: 1 } : { held: false };
}
export function unlock(root, name, token) {
  const file = lockFile(root, name);
  return transition(file, () => {
    const held = readJsonIf(file, null);
    if (held?.token !== token) return { unlocked: false, code: 1 };
    fs.rmSync(file);
    return { unlocked: true };
  });
}
