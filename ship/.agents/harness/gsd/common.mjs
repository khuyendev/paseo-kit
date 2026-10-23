// Shared pieces of the `ph gsd` verbs: the exit contract (GSDC-02) and small path/text helpers.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toSlash } from "../lib/paths.mjs";
import { pidAlive } from "../lib/proc.mjs";

const EXIT_OK = 0;
const EXIT_NEGATIVE = 1;
const EXIT_NONE = 66;
const EXIT_UNAVAILABLE = 69;

// A verb failure with its exit code: 1 error, 66 nothing in scope, 69 could not look (INV-36).
export class GsdError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.exitCode = code;
    this.extra = extra;
  }
}

export const fail = (message, extra) => new GsdError(EXIT_NEGATIVE, message, extra);
export const none = (message, extra) => new GsdError(EXIT_NONE, message, { status: "missing", ...extra });
export const unavailable = (message, extra) => new GsdError(EXIT_UNAVAILABLE, message, { status: "unresolvable", ...extra });

// A verb result: the JSON document and its exit code (1 = negative verdict with the JSON on stdout).
export const done = (json, code = EXIT_OK) => ({ code, json });

export const rel = (root, abs) => toSlash(path.relative(root, abs));

export const lf = (text) => String(text).replace(/\r\n?/g, "\n");

export function readIf(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") return null;
    throw e;
  }
}

export const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

export const isDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

export const today = () => new Date().toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Exclusive-create lock file held while fn runs. The file holds `<pid> <token>` of its writer: a lock whose process is gone
// is taken over at once, and any lock older than LOCK_STALE_MS is too; a wait over LOCK_WAIT_MS fails.
const LOCK_WAIT_MS = 30000;
// A lock whose holder is alive is taken over only past this age; no mutation under the lock comes near it.
const LOCK_STALE_MS = 600000;
// A reap claim older than this was left by a reaper that crashed.
const CLAIM_STALE_MS = 30000;

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const ageOf = (file) => {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

// The lock file holds `<pid> <token>` of its writer: stale when that process is gone or the lock is far too old.
function lockIsStale(lock, text) {
  const pid = Number.parseInt(text, 10);
  return (Number.isInteger(pid) && pid > 0 && !pidAlive(pid)) || ageOf(lock) > LOCK_STALE_MS;
}

// Removes a stale lock. Reapers take turns through a claim file and read the lock again under it, so a lock that
// another writer has taken over meanwhile is kept.
function reapStaleLock(lock) {
  try {
    const seen = readIf(lock);
    if (seen === null || !lockIsStale(lock, seen)) return;
    const claim = `${lock}.reap`;
    try {
      fs.writeFileSync(claim, "", { flag: "wx" });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (ageOf(claim) > CLAIM_STALE_MS) fs.rmSync(claim, { force: true });
      return;
    }
    try {
      if (readIf(lock) === seen) fs.rmSync(lock, { force: true });
    } finally {
      fs.rmSync(claim, { force: true });
    }
  } catch {
    // removed by its holder meanwhile
  }
}

// Runs fn while holding the lock file; the holder removes only the lock it created.
export function withFileLock(lock, fn) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const mine = `${process.pid} ${randomUUID()}\n`;
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, mine, { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      reapStaleLock(lock);
      if (Date.now() - start > LOCK_WAIT_MS) throw fail(`${path.basename(lock)} is held (${lock})`);
      pause(25 + Math.floor(Math.random() * 50));
    }
  }
  try {
    return fn();
  } finally {
    // Removed only while it is still ours: a lock taken over after a stale reap belongs to its new holder.
    if (readIf(lock) === mine) fs.rmSync(lock, { force: true });
  }
}

// Comma, space or [..] separated id list.
export const idList = (value) =>
  String(value ?? "")
    .replace(/[[\]]/g, " ")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const asArray = (v) => (v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);

export const uniq = (items) => [...new Set(items)];

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Word-bounded occurrence of an id (REQ-1 never matches REQ-10).
export const mentions = (text, id) => new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(id)}(?![A-Za-z0-9_]|-\\d)`).test(String(text ?? ""));
