// Private per-session state of the file tools (FTOL-14..16): a 0700 directory per Claude session, a session lock
// with stale recovery, ticket retention and budgets, and removal of whole stale session directories.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson } from "../lib/io.mjs";
import { HEX64 } from "./tools.mjs";

export const PRIVATE = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  lockWaitMs: 20000, // below the mod's 30 s transport timeout
  lockUnwrittenMs: 10000,
  ticketMs: 3600000,
  budgetBytes: 64 * 1024 * 1024,
  budgetFiles: 384,
  staleSessionMs: 24 * 3600000,
});

const POSIX = process.platform !== "win32";
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export const defaultStateRoot = () => path.join(os.tmpdir(), `paseo-harness-files-${process.getuid?.() ?? "user"}`);

export function identifier(value, what = "transport identifier") {
  if (typeof value !== "string" || !HEX64.test(value)) throw new Error(`invalid ${what}`);
  return value;
}

export const sessionHash = (claudeSessionId) => crypto.createHash("sha256").update(String(claudeSessionId)).digest("hex");

function unsafeOwner(stat) {
  return POSIX && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0);
}

function secureDirectory(dir) {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe private state directory ${dir}: not a plain directory`);
  if (unsafeOwner(stat)) throw new Error(`unsafe private state directory ${dir}: another owner or group/other permission bits`);
  const real = fs.realpathSync.native(dir);
  const same = POSIX ? real === path.resolve(dir) : real.toLowerCase() === path.resolve(dir).toLowerCase();
  if (!same) throw new Error(`unsafe private state directory ${dir}: it resolves elsewhere`);
}

export function sessionDirectory(stateRoot, session) {
  secureDirectory(stateRoot);
  const dir = path.join(stateRoot, identifier(session, "session"));
  secureDirectory(dir);
  const now = new Date();
  fs.utimesSync(dir, now, now); // touched by every action: a session dir untouched for 24 h is stale
  return dir;
}

export function readPrivate(file, fallback) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > PRIVATE.maxFileBytes) throw new Error(`unsafe private state file ${path.basename(file)}`);
    if (unsafeOwner(stat)) throw new Error(`unsafe private state file permissions ${path.basename(file)}`);
    return readJson(file);
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== undefined) return fallback;
    throw e;
  }
}

export function writePrivate(file, value) {
  const temp = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// the owner pid of a lock, null while not written yet, undefined when the lock is gone
function lockOwner(lock) {
  let text;
  try {
    text = fs.readFileSync(lock, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
  try {
    return JSON.parse(text).pid;
  } catch {
    return null;
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

// A process killed inside locked() (Esc on the native Bash call, its timeout) never runs finally. A lock of a dead
// pid, or left unwritten, is moved aside atomically and checked, so two waiters never both take it.
function recoverLock(lock) {
  const owner = lockOwner(lock);
  if (owner === undefined) return true;
  if (owner === null) {
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs < PRIVATE.lockUnwrittenMs) return false;
    } catch {
      return true;
    }
  } else if (Number.isSafeInteger(owner) && owner > 0 && alive(owner)) return false;
  const aside = `${lock}.${crypto.randomBytes(8).toString("hex")}.stale`;
  try {
    fs.renameSync(lock, aside);
  } catch (e) {
    if (e.code === "ENOENT") return true;
    throw e;
  }
  if (lockOwner(aside) === owner) {
    fs.rmSync(aside, { force: true });
    return true;
  }
  try {
    fs.linkSync(aside, lock); // a live owner replaced the stale lock in between: give its lock back
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  fs.rmSync(aside, { force: true });
  return false;
}

export function locked(dir, fn, { lockWaitMs = PRIVATE.lockWaitMs } = {}) {
  const lock = path.join(dir, "session.lock");
  const deadline = Date.now() + lockWaitMs;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, "wx", 0o600);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (recoverLock(lock)) continue;
      if (Date.now() >= deadline) throw new Error("private session state locked by another running file operation; retry later");
      pause(20);
    }
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid }));
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

const TICKET_FILE = /^([a-f0-9]{64})\.(?:(request|plan|result|page)\.json|started)$/;

// Ticket files older than 1 h go first; over budget, completed results and pages are evicted oldest first;
// unfinished tickets are never evicted (FTOL-16).
export function sweep(dir) {
  const now = Date.now();
  const kept = [];
  for (const file of fs.readdirSync(dir)) {
    const m = TICKET_FILE.exec(file);
    if (!m) continue;
    const stat = fs.lstatSync(path.join(dir, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe private ticket file ${file}`);
    if (now - stat.mtimeMs > PRIVATE.ticketMs) fs.rmSync(path.join(dir, file), { force: true });
    else kept.push({ file, token: m[1], done: m[2] === "result" || m[2] === "page", size: stat.size, mtime: stat.mtimeMs });
  }
  let bytes = kept.reduce((s, e) => s + e.size, 0);
  let count = kept.length;
  const over = () => bytes >= PRIVATE.budgetBytes || count >= PRIVATE.budgetFiles;
  for (const entry of kept.filter((e) => e.done).sort((a, b) => a.mtime - b.mtime)) {
    if (!over()) break;
    for (const item of kept.filter((e) => e.token === entry.token && !e.gone)) {
      fs.rmSync(path.join(dir, item.file), { force: true });
      item.gone = true;
      bytes -= item.size;
      count--;
    }
  }
  if (over()) throw new Error("private session transport budget reached by unfinished tickets; finish or recover them, or retry after the one-hour ticket expiry");
}

// whole session directories untouched for 24 h, whichever session's call notices them
export function sweepSessions(stateRoot, current) {
  const now = Date.now();
  for (const name of fs.readdirSync(stateRoot)) {
    if (name === current || !HEX64.test(name)) continue;
    const dir = path.join(stateRoot, name);
    try {
      const stat = fs.lstatSync(dir);
      if (stat.isDirectory() && !stat.isSymbolicLink() && now - stat.mtimeMs > PRIVATE.staleSessionMs) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* gone meanwhile */ }
  }
}
