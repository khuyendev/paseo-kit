import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { assertErrLine, assertExit, assertLine, assertNoLine } from "../helpers/assert.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "./setup.mjs";

test("PHCL-35 task add, update, list with READY marks, get", async () => {
  const s = setup({ caller: false });
  const ws = ["--ws", "team ws"];
  assertLine(await s.ph(["task", "add", ...ws, "--title", "base"]), "task 1 added");
  assertLine(await s.ph(["task", "add", ...ws, "--title", "mid", "--depends-on", "1", "--assignee", "bob"]), "task 2 added");
  assertLine(await s.ph(["task", "add", ...ws, "--title", "free"]), "task 3 added");
  const list = await s.ph(["task", "list", ...ws]);
  assert.deepEqual(list.out, ["1 pending - base READY", "2 pending bob mid after 1", "3 pending - free READY"]);
  assertLine(await s.ph(["task", "update", "1", ...ws, "--status", "completed"]), "task 1 completed");
  assertLine(await s.ph(["task", "list", ...ws, "--assignee", "bob"]), "2 pending bob mid after 1 READY");
  assert.equal(JSON.parse((await s.ph(["task", "get", "2", ...ws])).stdout).title, "mid");
  assertErrLine(await s.ph(["task", "add", ...ws, "--title", "x", "--depends-on", "9"]), "failed: unknown dependency 9");
  assertErrLine(await s.ph(["task", "update", "7", ...ws]), "failed: no task 7");
  assertErrLine(await s.ph(["task", "update", "1", ...ws, "--status", "done"]), /--status must be one of pending\|in_progress\|completed\|blocked/);
  assertErrLine(await s.ph(["task", "list"]), "usage error: --ws is required");
  assertErrLine(await s.ph(["task", "remove", ...ws]), "usage error: task add | update | list | get");
  const file = path.join(s.root, "team ws", "tasks.json");
  const mtime = fs.statSync(file).mtimeMs;
  await s.ph(["task", "list", ...ws]);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  assertLine(await s.ph(["task", "update", "2", ...ws, "--depends-on", ""]), "task 2 pending");
  assertNoLine(await s.ph(["task", "list", ...ws]), /after/);
});

test("PHCL-35 self, unknown and cyclic dependencies are refused", async () => {
  const s = setup({ caller: false });
  const ws = ["--ws", "w"];
  await s.ph(["task", "add", ...ws, "--title", "a"]);
  await s.ph(["task", "add", ...ws, "--title", "b", "--depends-on", "1"]);
  assertErrLine(await s.ph(["task", "update", "1", ...ws, "--depends-on", "2"]), /^failed: invalid dependency 1 -> 2: creates a cycle$/);
  assertErrLine(await s.ph(["task", "update", "1", ...ws, "--depends-on", "1"]), /^failed: invalid dependency 1 -> 1/);
  assertErrLine(await s.ph(["task", "update", "1", ...ws, "--depends-on", "5"]), /^failed: invalid dependency 1 -> 5/);
});

test("PHCL-35 two processes writing in parallel lose no write", async () => {
  const s = setup({ caller: false });
  const tasks = pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "runtime", "tasks.mjs")).href;
  const proc = pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "lib", "proc.mjs")).href;
  const script = `
    const { taskCommands } = await import(${JSON.stringify(tasks)});
    const { realClock } = await import(${JSON.stringify(proc)});
    for (let i = 0; i < 20; i++) {
      await taskCommands[0].run({ root: process.argv[1], clock: realClock, args: ["add"], opts: { ws: "w", title: process.argv[2] + i }, out: () => {} });
    }`;
  const run = (tag) => new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, s.root, tag], { stdio: "inherit", windowsHide: true });
    child.on("exit", resolve);
  });
  assert.deepEqual(await Promise.all([run("a"), run("b")]), [0, 0]);
  const data = JSON.parse(fs.readFileSync(path.join(s.root, "w", "tasks.json"), "utf8"));
  assert.equal(data.tasks.length, 40);
  assert.equal(new Set(data.tasks.map((t) => t.id)).size, 40);
});

test("PHCL-36 freeze records, check reports modified and new files, a missing record fails", async () => {
  const s = setup({ caller: false });
  s.project.write("ws/P1_spec.md", "spec\n");
  s.project.write("ws/P1_plan.md", "plan\n");
  s.project.write("ws/P2_other.md", "x\n");
  const missing = await s.ph(["freeze", "--check", "--ws", "ws", "--phase", "P1"]);
  assertExit(missing, 1);
  assertErrLine(missing, /^failed: no freeze record .*freeze_P1\.sha256$/);
  const r = await s.ph(["freeze", "--ws", "ws", "--phase", "P1"]);
  assertExit(r, 0);
  assertLine(r, /^frozen P1: 2 files -> .*freeze_P1\.sha256$/);
  assert.match(s.project.read("ws/freeze_P1.sha256"), /^[0-9a-f]{64} {2}P1_plan\.md\n[0-9a-f]{64} {2}P1_spec\.md\n$/);
  assertLine(await s.ph(["freeze", "--check", "--ws", "ws", "--phase", "P1"]), "freeze ok P1: 2 files");
  s.project.write("ws/P1_spec.md", "changed\n");
  s.project.write("ws/P1_spec_v2.md", "new\n");
  fs.rmSync(s.project.path("ws/P1_plan.md"));
  const c = await s.ph(["freeze", "--check", "--ws", "ws", "--phase", "P1"]);
  assertExit(c, 2);
  assertLine(c, "freeze CHANGED P1: modified P1_spec.md; missing P1_plan.md; new P1_spec_v2.md");
  assertErrLine(await s.ph(["freeze", "--ws", "ws", "--phase", "P9"]), /^failed: no P9_\* files in /);
});

test("PHCL-36 the record verifies with sha256sum where available", { skip: spawnSync("sha256sum", ["--version"]).status !== 0 }, async () => {
  const s = setup({ caller: false });
  s.project.write("ws/A_x.md", "x\n");
  await s.ph(["freeze", "--ws", "ws", "--phase", "A"]);
  const r = spawnSync("sha256sum", ["-c", "freeze_A.sha256"], { cwd: path.join(s.root, "ws"), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
