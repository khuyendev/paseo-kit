// G001 (bug hunt 2026-10-23): the STATE.md writer lock is taken over only when its holder is gone or the lock is far
// older than any mutation, and a holder removes only the lock it created.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { sharedFile } from "../../ship/.agents/harness/gsd/planning.mjs";
import { withStateLock } from "../../ship/.agents/harness/gsd/state.mjs";

const lockOf = (root) => `${sharedFile(root, "STATE.md")}.lock`;

// Writes a lock file as a holder would have, then ages it.
function heldLock(root, text, ageMs) {
  const lock = lockOf(root);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, text);
  const at = (Date.now() - ageMs) / 1000;
  fs.utimesSync(lock, at, at);
  return lock;
}

test("a lock held by a live process is not taken over after ten seconds", () => {
  const root = makeTempDir();
  const lock = heldLock(root, `${process.pid} live\n`, 11000);
  let ran = false;
  assert.throws(() => withStateLock(root, () => (ran = true)), /STATE\.md\.lock is held/);
  assert.equal(ran, false);
  assert.equal(fs.readFileSync(lock, "utf8"), `${process.pid} live\n`);
});

test("a lock whose holder process is gone is taken over at once", () => {
  const root = makeTempDir();
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  const lock = heldLock(root, `${gone} crashed\n`, 0);
  const start = Date.now();
  let ran = false;
  withStateLock(root, () => (ran = true));
  assert.ok(Date.now() - start < 5000, "reclaimed without waiting out the ten-second age");
  assert.equal(ran, true);
  assert.equal(fs.existsSync(lock), false);
});

test("a lock older than the stale bound is taken over even when its holder is alive", () => {
  const root = makeTempDir();
  const lock = heldLock(root, `${process.pid} stuck\n`, 11 * 60 * 1000);
  let ran = false;
  withStateLock(root, () => (ran = true));
  assert.equal(ran, true);
  assert.equal(fs.existsSync(lock), false);
});

test("a holder leaves in place a lock that another writer took over", () => {
  const root = makeTempDir();
  const lock = lockOf(root);
  withStateLock(root, () => fs.writeFileSync(lock, "999999 other\n"));
  assert.equal(fs.readFileSync(lock, "utf8"), "999999 other\n");
});
