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

// Append the lines {lines} the file does not hold yet (deferred.md, G081: one line per finding), in order; none: nothing written.
export function appendNew(root, rel, { lines = [] }) {
  const abs = guardedPath(root, rel);
  const have = new Set(fs.existsSync(abs) ? readText(abs).split(/\r?\n/) : []);
  const fresh = lines.map(String).filter((l) => !have.has(l));
  if (!fresh.length) return { appended: null, lines: 0 };
  append(root, rel, fresh.join("\n"));
  return { appended: rel, lines: fresh.length };
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

// GSDF-64: debug, execute and quick share one root writer lock (the file keeps its old name `debug`); plan holds only
// `phase-<NN>` (kit-feedback 2). The
// record names the holder's workflow, so a refusal says which run holds the root. The short transition claim
// serializes acquisition, stale reclamation and release, so a contender cannot remove a newly acquired lease.
// Unknown liveness fails closed; it is never permission to write. The claim records its owner pid, so a claim left by a
// process that died inside the window (or whose rmdir failed) is reclaimed once that pid is dead, or once an empty
// claim (a death between mkdir and the owner write) is older than CLAIM_ABANDONED_MS.
const CLAIM_ABANDONED_MS = 30000;
const lockFile = (root, name) => guardedPath(root, `_workspace/locks/${name}.lock`);
const live = (held) => !Number.isInteger(held?.pid) || pidAlive(held.pid);
function staleClaim(claim) {
  const owner = readJsonIf(path.join(claim, "owner.json"), null);
  if (owner) return !pidAlive(owner.pid);
  try { return Date.now() - fs.statSync(claim).mtimeMs >= CLAIM_ABANDONED_MS; } catch { return false; }
}
function dropClaim(claim) {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(claim, { recursive: true, force: true }); return; } catch (e) { if (i === 4) throw e; }
  }
}
function transition(file, fn, retry = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const claim = `${file}.transition`;
  try { fs.mkdirSync(claim); } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (retry && staleClaim(claim)) {
      // Reclaim by renaming aside first: of two reclaimers only one rename succeeds.
      const aside = `${claim}.${randomUUID()}.dead`;
      try { fs.renameSync(claim, aside); fs.rmSync(aside, { recursive: true, force: true }); } catch {}
      return transition(file, fn, false);
    }
    return { locked: false, holder: "lock transition (retry after checking the holder)", code: 1 };
  }
  try {
    fs.writeFileSync(path.join(claim, "owner.json"), JSON.stringify({ pid: process.pid }));
    return fn();
  } finally { dropClaim(claim); }
}
// `kind` names the workflow (gsd-plan, gsd-execute, gsd-debug, gsd-quick); a record without it is from an older kit.
export function lock(root, name, runId, pid = process.ppid, kind = null) {
  const file = lockFile(root, name);
  return transition(file, () => {
    const held = readJsonIf(file, null);
    if (held && live(held)) return { locked: false, holder: held.runId, holderKind: held.kind ?? null, code: 1 };
    const token = randomUUID();
    writeJsonAtomic(file, { runId, pid, token, ...(kind ? { kind } : {}) });
    return { locked: true, token };
  });
}
// The refusal text of a held root lease: "a gsd-plan run holds this code root (wf_...)".
export const holderText = (r) => `${r?.holderKind ? `a ${r.holderKind} run` : "another run"} holds this code root (${r?.holder ?? r?.error ?? "unknown run"})`;
export function lockCheck(root, name) {
  const file = lockFile(root, name);
  const held = readJsonIf(file, null);
  return (held && live(held)) || fs.existsSync(`${file}.transition`) ? { held: true, holder: held?.runId ?? "lock transition", holderKind: held?.kind ?? null, code: 1 } : { held: false };
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
