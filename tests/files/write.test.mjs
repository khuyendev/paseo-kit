import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { commitFiles } from "../../ship/.agents/harness/files/commit.mjs";
import { client, scratch } from "./helpers.mjs";

const temps = (dir) => fs.readdirSync(dir, { recursive: true }).filter((n) => String(n).endsWith(".tmp"));

test("FTOL-26 writes several files including a new nested folder, UTF-8 as sent", () => {
  const s = scratch();
  const r = client({ cwd: s.root }).call("write_multiple_files", { files: [{ path: "a.txt", content: "héllo\r\n" }, { path: "new/deep/b.txt", content: "b" }] });
  assert.equal(r.text, `wrote ${s.path("a.txt")} (7 chars)\nwrote ${s.path("new/deep/b.txt")} (1 chars)`);
  assert.deepEqual(s.bytes("a.txt"), Buffer.from("héllo\r\n", "utf8"));
  assert.equal(s.read("new/deep/b.txt"), "b");
});

test("FTOL-26 an invalid or duplicated path writes nothing", () => {
  const s = scratch({ "keep.txt": "old", "dir/x": "x" });
  const c = client({ cwd: s.root });
  const dup = c.call("write_multiple_files", { files: [{ path: "keep.txt", content: "new" }, { path: "./keep.txt", content: "newer" }] });
  assert.match(dup.text, /nothing written:\n\.\/keep\.txt: listed twice/);
  const folder = c.call("write_multiple_files", { files: [{ path: "keep.txt", content: "new" }, { path: "dir", content: "x" }] });
  assert.match(folder.text, /nothing written:\ndir: is a folder, not a file/);
  assert.equal(s.read("keep.txt"), "old");
  if (process.platform === "win32") {
    const fold = c.call("write_multiple_files", { files: [{ path: "keep.txt", content: "a" }, { path: "KEEP.txt", content: "b" }] });
    assert.match(fold.text, /KEEP\.txt: listed twice/);
  }
});

test("FTOL-27 a failed staging removes every temp; a blocked path leaves a.txt unchanged", () => {
  const s = scratch({ "a.txt": "orig", "file": "f" });
  const r = client({ cwd: s.root }).call("write_multiple_files", { files: [{ path: "a.txt", content: "new" }, { path: "file/under.txt", content: "x" }] });
  assert.match(r.text, /nothing written: staging .*under\.txt failed/);
  assert.equal(s.read("a.txt"), "orig");
  assert.deepEqual(temps(s.root), []);
});

test("FTOL-27 a failed rename restores replaced files and reports it; restored mtimes move to a later second", () => {
  const s = scratch({ "a.txt": "A-orig", "b.txt": "B-orig" });
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(s.path("a.txt"), old, old);
  const io = { ...fs, renameSync: (from, to) => (to === s.path("b.txt") ? (() => { const e = new Error("locked"); e.code = "EIO"; throw e; })() : fs.renameSync(from, to)) };
  const before = Date.now();
  assert.throws(() => commitFiles([{ abs: s.path("a.txt"), text: "A-new" }, { abs: s.path("b.txt"), text: "B-new" }], io),
    /^Error: nothing written: writing .*b\.txt failed \(locked\); 1 file\(s\) already replaced were restored$/);
  assert.equal(s.read("a.txt"), "A-orig");
  assert.equal(s.read("b.txt"), "B-orig");
  assert.ok(fs.statSync(s.path("a.txt")).mtimeMs >= Math.floor(before / 1000) * 1000 + 1000);
  assert.deepEqual(temps(s.root), []);
});

test("FTOL-27 a failed restore is reported as ROLLBACK INCOMPLETE naming the file", () => {
  const s = scratch({ "a.txt": "A-orig", "b.txt": "B-orig" });
  const io = {
    ...fs,
    renameSync: (from, to) => { if (to === s.path("b.txt")) { const e = new Error("locked"); e.code = "EIO"; throw e; } fs.renameSync(from, to); },
    utimesSync: () => { throw new Error("utimes refused"); },
  };
  assert.throws(() => commitFiles([{ abs: s.path("a.txt"), text: "A-new" }, { abs: s.path("b.txt"), text: "B-new" }], io),
    (e) => /ROLLBACK INCOMPLETE, these files may hold the new text: .*a\.txt \(utimes refused\)/.test(e.message) && !e.message.startsWith("nothing written"));
});

test("FTOL-27 a read-only second file gets the first restored (Windows)", { skip: process.platform !== "win32" }, () => {
  const s = scratch({ "a.txt": "A", "ro.txt": "R" });
  fs.chmodSync(s.path("ro.txt"), 0o444);
  try {
    const r = client({ cwd: s.root }).call("write_multiple_files", { files: [{ path: "a.txt", content: "A2" }, { path: "ro.txt", content: "R2" }] });
    if (s.read("ro.txt") === "R2") return; // this Windows build replaces read-only targets by rename: nothing to roll back
    assert.match(r.text, /nothing written: writing .*ro\.txt failed .*1 file\(s\) already replaced were restored/);
    assert.equal(s.read("a.txt"), "A");
  } finally {
    fs.chmodSync(s.path("ro.txt"), 0o666);
  }
});

test("FTOL-27 an executable file keeps its mode (POSIX)", { skip: process.platform === "win32" }, () => {
  const s = scratch({ "run.sh": "#!/bin/sh\n" });
  fs.chmodSync(s.path("run.sh"), 0o755);
  client({ cwd: s.root }).call("write_multiple_files", { files: [{ path: "run.sh", content: "#!/bin/sh\necho\n" }] });
  assert.equal(fs.statSync(s.path("run.sh")).mode & 0o777, 0o755);
});

test("FTOL-27 a same-size replacement rolled back within one second leaves git status clean", () => {
  const s = scratch({ "a.txt": "aaaa\n", "b.txt": "bbbb\n" });
  const git = (...args) => spawnSync("git", args, { cwd: s.root, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.email=t@e.invalid", "-c", "user.name=t", "-c", "core.autocrlf=false", "add", "-A");
  git("-c", "user.email=t@e.invalid", "-c", "user.name=t", "commit", "-q", "-m", "i");
  git("status", "--porcelain"); // refresh the index stat cache
  const io = { ...fs, renameSync: (from, to) => { if (to === s.path("b.txt")) { const e = new Error("busy"); e.code = "EIO"; throw e; } fs.renameSync(from, to); } };
  assert.throws(() => commitFiles([{ abs: s.path("a.txt"), text: "AAAA\n" }, { abs: s.path("b.txt"), text: "BBBB\n" }], io), /restored/);
  assert.equal(s.read("a.txt"), "aaaa\n");
  assert.equal(git("status", "--porcelain").stdout, "");
  assert.equal(git("diff", "--quiet").status, 0);
});

test("FTOL-27 new files created by a failed commit are removed with their new folders", () => {
  const s = scratch({ "b.txt": "B" });
  const io = { ...fs, renameSync: (from, to) => { if (to === s.path("b.txt")) { const e = new Error("busy"); e.code = "EIO"; throw e; } fs.renameSync(from, to); } };
  assert.throws(() => commitFiles([{ abs: s.path("n/new.txt"), text: "N" }, { abs: s.path("b.txt"), text: "B2" }], io), /1 file\(s\) already replaced were restored/);
  assert.equal(fs.existsSync(path.join(s.root, "n")), false);
});
