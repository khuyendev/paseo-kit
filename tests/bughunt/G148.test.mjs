// G148: a custom --run-id names its agents <run id>-<n>; ph worktrees must read their owner from runs/<run id>/run.json.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertExit, assertLine } from "../helpers/assert.mjs";
import { setup } from "../ph/setup.mjs";

const wtDir = (s) => path.join(s.root, ".claude", "worktrees");
const runDir = (s, id) => path.join(s.root, "_workspace", "_runs", id);
const branches = (s) => s.project.git("branch", "--list", "harness/*");

function addWorktree(s, name) {
  s.project.git("worktree", "add", path.join(wtDir(s), name), "-b", `harness/${name}`);
}

function writeRun(s, id, status, pid = null) {
  fs.mkdirSync(runDir(s, id), { recursive: true });
  fs.writeFileSync(path.join(runDir(s, id), "run.json"), JSON.stringify({ runId: id, status, pid }));
}

test("G148 a finished custom run's clean, merged worktree is classified by its run.json and pruned", async () => {
  const s = setup({ git: true });
  writeRun(s, "deploy-42", "succeeded");
  addWorktree(s, "deploy-42-1");
  const r = await s.ph(["worktrees", "--prune"]);
  assertExit(r, 0);
  assertLine(r, /^merged and clean {7}harness\/deploy-42-1 .* \(run deploy-42\)$/);
  assertLine(r, "removed deploy-42-1 and branch harness/deploy-42-1");
  assertLine(r, "worktrees: 1 listed, 1 removed");
  assert.equal(branches(s), "");
});

test("G148 a custom run that is still running with a live pid keeps its worktree", async () => {
  const s = setup({ git: true });
  writeRun(s, "deploy-43", "running", process.pid);
  addWorktree(s, "deploy-43-1");
  const r = await s.ph(["worktrees", "--prune"]);
  assertExit(r, 0);
  assertLine(r, /^in use {17}harness\/deploy-43-1 .* \(run deploy-43\)$/);
  assertLine(r, "worktrees: 1 listed, 0 removed");
  assert.match(branches(s), /harness\/deploy-43-1/);
});

test("G148 a custom run whose run dir is gone stays owner unknown and is kept", async () => {
  const s = setup({ git: true });
  addWorktree(s, "deploy-44-1");
  const r = await s.ph(["worktrees", "--prune"]);
  assertExit(r, 0);
  assertLine(r, /^owner unknown {10}harness\/deploy-44-1 .* \(owner unknown\)$/);
  assertLine(r, "worktrees: 1 listed, 0 removed");
  assert.match(branches(s), /harness\/deploy-44-1/);
});
