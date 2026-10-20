// ADPT-10: a machine-wide named lock for heavy commands (one build at a time across worktrees).
// The lock is a directory in the OS temp folder holding the owner's pid; a dead owner's lock is taken over.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeName } from "../lib/paths.mjs";
import { pidAlive, realClock } from "../lib/proc.mjs";

const POLL_MS = 200;

export const mutexDir = (name, tmp = os.tmpdir()) => path.join(tmp, `ph-mutex-${safeName(name)}.lock`);

function tryTake(dir) {
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let owner = NaN;
    try {
      owner = Number(fs.readFileSync(path.join(dir, "pid"), "utf8"));
    } catch {}
    // A lock without a readable pid may be mid-creation; only a lock whose pid is dead is taken over.
    if (!Number.isInteger(owner) || pidAlive(owner)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return tryTake(dir);
  }
  fs.writeFileSync(path.join(dir, "pid"), String(process.pid), "utf8");
  return true;
}

// Runs `fn` while holding the named lock; `log` gets one `waiting for mutex <name>` line when it had to wait.
// A null name runs `fn` at once (no mutex configured).
export async function withMutex(name, fn, { log = () => {}, clock = realClock, tmp } = {}) {
  if (!name) return fn();
  const dir = mutexDir(name, tmp);
  let waited = false;
  while (!tryTake(dir)) {
    if (!waited) log(`waiting for mutex ${name}`);
    waited = true;
    await clock.sleep(POLL_MS);
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
