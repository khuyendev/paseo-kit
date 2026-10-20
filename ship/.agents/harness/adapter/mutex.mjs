// ADPT-10: a machine-wide named lock for heavy commands (one build at a time across worktrees).
// The lock is a directory in the OS temp folder whose `owner` file holds `{pid, token}`. CR-HAR-04: the lock is
// published complete (built aside, then renamed into place), a dead owner's lock is removed only under a
// per-lock reap claim after re-reading the same owner, and release removes the lock only while it is still ours.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson } from "../lib/io.mjs";
import { safeName } from "../lib/paths.mjs";
import { pidAlive, realClock } from "../lib/proc.mjs";

const POLL_MS = 200;
// A lock dir without a readable owner, or a reap claim, older than this was abandoned by a crashed process.
const ABANDONED_MS = 30000;
// Codes of a rename onto an existing lock (Windows reports EPERM/EACCES for an existing directory).
const BUSY = new Set(["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"]);

export const mutexDir = (name, tmp = os.tmpdir()) => path.join(tmp, `ph-mutex-${safeName(name)}.lock`);

// `{pid, token}`, null when the dir exists without a readable owner, undefined when there is no lock.
function readOwner(dir) {
  try {
    const owner = readJson(path.join(dir, "owner"));
    return Number.isInteger(owner?.pid) && typeof owner.token === "string" ? owner : null;
  } catch {
    return fs.existsSync(dir) ? null : undefined;
  }
}

const ageMs = (p) => {
  try {
    return Date.now() - fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

const removeAside = (dir, token) => {
  const dead = `${dir}.${token}.dead`;
  fs.renameSync(dir, dead);
  fs.rmSync(dead, { recursive: true, force: true });
};

// Removes the lock when its owner is dead (or it was abandoned half-made); safe against concurrent reapers.
// Returns true when this call removed it.
function reapIfStale(dir, token) {
  const seen = readOwner(dir);
  if (seen === undefined || (seen && pidAlive(seen.pid)) || (!seen && ageMs(dir) < ABANDONED_MS)) return false;
  const claim = path.join(dir, "reap");
  try {
    fs.mkdirSync(claim);
  } catch (e) {
    if (e.code === "EEXIST" && ageMs(claim) >= ABANDONED_MS) fs.rmSync(claim, { recursive: true, force: true });
    return false;
  }
  try {
    const now = readOwner(dir);
    if (now === undefined) return false;
    if (seen ? now?.token === seen.token : now === null) {
      removeAside(dir, token);
      return true;
    }
  } catch {}
  // The lock changed hands between the first read and the claim: it is not ours to remove.
  fs.rmSync(claim, { recursive: true, force: true });
  return false;
}

function take(dir, retry) {
  const token = randomUUID();
  const draft = `${dir}.${token}.tmp`;
  fs.mkdirSync(draft, { recursive: true });
  fs.writeFileSync(path.join(draft, "owner"), JSON.stringify({ pid: process.pid, token }), "utf8");
  try {
    fs.renameSync(draft, dir);
    return token;
  } catch (e) {
    fs.rmSync(draft, { recursive: true, force: true });
    if (!BUSY.has(e.code)) throw e;
  }
  return reapIfStale(dir, token) && retry ? take(dir, false) : null;
}

// Takes the named lock (taking over a dead owner's); returns its token, or null when a live owner holds it.
export const tryLock = (name, { tmp } = {}) => take(mutexDir(name, tmp), true);

// Releases the lock only when `token` still owns it (a lock taken over meanwhile stays).
export function unlock(name, token, { tmp } = {}) {
  const dir = mutexDir(name, tmp);
  if (readOwner(dir)?.token !== token) return;
  try {
    removeAside(dir, token);
  } catch {
    // Windows refuses the rename while another process has the owner file open; the lock is still ours.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

// Runs `fn` while holding the named lock; `log` gets one `waiting for mutex <name>` line when it had to wait.
// A null name runs `fn` at once (no mutex configured).
export async function withMutex(name, fn, { log = () => {}, clock = realClock, tmp } = {}) {
  if (!name) return fn();
  let token;
  let waited = false;
  while (!(token = tryLock(name, { tmp }))) {
    if (!waited) log(`waiting for mutex ${name}`);
    waited = true;
    await clock.sleep(POLL_MS);
  }
  try {
    return await fn();
  } finally {
    unlock(name, token, { tmp });
  }
}
