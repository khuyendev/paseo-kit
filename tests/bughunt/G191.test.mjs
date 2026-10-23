// G191: two sessions editing one shared file must not overwrite each other's committed edits.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runTicket } from "../../ship/.agents/harness/files/backend.mjs";
import { lockedTargets, sessionDirectory, sessionHash, writePrivate } from "../../ship/.agents/harness/files/private.mjs";
import { fileKey } from "../../ship/.agents/harness/files/targets.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { client, scratch } from "../files/helpers.mjs";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

// Runs act(); the first time a file named `name` is renamed into place, during() runs first (as another session's
// call would) and its result is returned. The rename is the commit of session A, after its text was read.
function duringCommit(name, during, act) {
  const rename = fs.renameSync;
  let seen;
  fs.renameSync = (from, to) => {
    if (seen === undefined && path.basename(to) === name) seen = during();
    return rename(from, to);
  };
  try {
    act();
  } finally {
    fs.renameSync = rename;
  }
  return seen;
}

// the reply of session b's ticket, or the error its execution gave (lock timeout: nothing written)
function executeOf(c, stage) {
  try {
    runTicket("--execute", stage.session, stage.ticket, { stateRoot: c.stateRoot, lockWaitMs: 50 });
    return c.collect(stage.ticket).text;
  } catch (e) {
    return e.message;
  }
}

test("G191 an edit of session B that lands during session A's commit is not overwritten", () => {
  const s = scratch({ "shared.txt": "one\ntwo\nthree\n" });
  const stateRoot = makeTempDir("paseo kit state ");
  const a = client({ cwd: s.root, session: "session-a", stateRoot });
  const b = client({ cwd: s.root, session: "session-b", stateRoot });
  const stageA = a.stage("edit_multiple_files", { files: [{ path: "shared.txt", edits: [{ oldText: "one", newText: "ONE-A" }] }] });
  a.plan(stageA);
  const stageB = b.stage("edit_multiple_files", { files: [{ path: "shared.txt", edits: [{ oldText: "two", newText: "TWO-B" }] }] });
  b.plan(stageB);
  const bReply = duringCommit("shared.txt", () => executeOf(b, stageB), () => a.execute(stageA));
  const aReply = a.collect(stageA.ticket).text;
  const text = s.read("shared.txt");
  assert.match(aReply, /^edited /);
  assert.match(text, /ONE-A/);
  // B is either refused while A holds the file, or its edit is in the file: a reported success is never lost
  if (/^edited /.test(bReply)) assert.match(text, /TWO-B/, "session B reported its edit as written, then session A's commit dropped it");
  else assert.match(bReply, /locked by another running file operation; retry later/);
});

test("G191 an edit of another file does not wait for session A's commit of shared.txt", () => {
  const s = scratch({ "shared.txt": "one\n", "other.txt": "alpha\n" });
  const stateRoot = makeTempDir("paseo kit state ");
  const a = client({ cwd: s.root, session: "session-a", stateRoot });
  const b = client({ cwd: s.root, session: "session-b", stateRoot });
  const stageA = a.stage("edit_multiple_files", { files: [{ path: "shared.txt", edits: [{ oldText: "one", newText: "ONE-A" }] }] });
  a.plan(stageA);
  const stageB = b.stage("edit_multiple_files", { files: [{ path: "other.txt", edits: [{ oldText: "alpha", newText: "ALPHA-B" }] }] });
  b.plan(stageB);
  const bReply = duringCommit("shared.txt", () => executeOf(b, stageB), () => a.execute(stageA));
  assert.match(bReply, /^edited /);
  assert.equal(s.read("other.txt"), "ALPHA-B\n");
  assert.equal(s.read("shared.txt"), "ONE-A\n");
});

test("G191 the rollback of a killed batch waits for the target lock of its file", () => {
  const s = scratch({ "shared.txt": "ONE-A\n" });
  const stateRoot = makeTempDir("paseo kit state ");
  const a = client({ cwd: s.root, session: "session-a", stateRoot });
  const dir = sessionDirectory(stateRoot, sessionHash("session-a"));
  const ticket = "ab".repeat(32);
  // the journal of a batch killed after it renamed shared.txt: the file holds the batch's text, the original is kept
  writePrivate(path.join(dir, "journal.json"), {
    ticket,
    method: "edit_multiple_files",
    dirs: [],
    entries: [{ abs: s.path("shared.txt"), tmp: s.path("shared.txt.killed.tmp"), original: Buffer.from("one\n").toString("base64"), before: sha256("one\n"), after: sha256("ONE-A\n"), mtimeMs: 0 }],
  });
  // session B's commit of the file holds its target lock: the rollback must not write the original over it meanwhile
  lockedTargets(stateRoot, [fileKey(s.path("shared.txt"))], () => {
    assert.throws(() => runTicket("--execute", sessionHash("session-a"), ticket, { stateRoot, lockWaitMs: 50 }), /locked by another running file operation; retry later/);
  });
  assert.equal(s.read("shared.txt"), "ONE-A\n");
  assert.ok(fs.existsSync(path.join(dir, "journal.json")));
  runTicket("--execute", sessionHash("session-a"), ticket, { stateRoot });
  assert.equal(s.read("shared.txt"), "one\n");
  assert.match(a.collect(ticket).text, /rolled back: nothing written/);
});
