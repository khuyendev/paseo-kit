// Bug-hunt fix G142: the ph task list lock is taken over and released only while it still holds the token of the
// caller that judged it, so a caller that lost its lock never deletes the lock of the next holder.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";

const { taskCommands } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "runtime", "tasks.mjs")).href);
const clock = { now: () => Date.now(), sleep: async () => {} };

// a workspace whose task list lock already exists, last written 60 s ago (stale after 30 s)
function staleWorkspace(lockText) {
  const root = makeTempDir("paseo kit task lock ");
  fs.mkdirSync(path.join(root, "w"));
  const lock = path.join(root, "w", "tasks.json.lock");
  fs.writeFileSync(lock, lockText);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  return { root, lock };
}

const add = (root, title, out = () => {}) => taskCommands[0].run({ root, clock, args: ["add"], opts: { ws: "w", title }, out });

test("G142 a stale task lock, written or empty, is reclaimed and released by its new holder", async () => {
  for (const lockText of ["old-token", ""]) {
    const { root, lock } = staleWorkspace(lockText);
    const lines = [];
    assert.equal(await add(root, "first", (l) => lines.push(l)), 0);
    assert.deepEqual(lines, ["task 1 added"]);
    assert.equal(fs.existsSync(lock), false);
  }
});

test("G142 a caller that judged a lock stale does not delete a lock a rival acquired after the judgement", async () => {
  const { root, lock } = staleWorkspace("old-token");
  const statSync = fs.statSync;
  let injected = false;
  // the rival runs in the gap between the stale judgement and the takeover: it removes the stale lock and takes a fresh one
  fs.statSync = (file, ...rest) => {
    const stat = statSync(file, ...rest);
    if (file === lock && !injected) {
      injected = true;
      fs.rmSync(lock);
      fs.writeFileSync(lock, "rival-token", { flag: "wx" });
    }
    return stat;
  };
  try {
    await assert.rejects(add(root, "b"), /task list locked/);
  } finally {
    fs.statSync = statSync;
  }
  assert.equal(fs.readFileSync(lock, "utf8"), "rival-token");
  assert.equal(fs.existsSync(path.join(root, "w", "tasks.json")), false);
});

test("G142 a holder whose lock was reclaimed while it ran leaves the new holder's lock in place on release", async () => {
  const root = makeTempDir("paseo kit task lock ");
  const lock = path.join(root, "w", "tasks.json.lock");
  // the rival takes the lock while the holder is still inside its section, after the holder's own write
  const out = () => {
    fs.rmSync(lock);
    fs.writeFileSync(lock, "rival-token", { flag: "wx" });
  };
  assert.equal(await add(root, "holder", out), 0);
  assert.equal(fs.existsSync(lock) && fs.readFileSync(lock, "utf8"), "rival-token");
});
