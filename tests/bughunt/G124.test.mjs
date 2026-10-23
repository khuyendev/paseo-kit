import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertExit, assertLine } from "../helpers/assert.mjs";
import { setup } from "../ph/setup.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

const wtDir = (s) => path.join(s.root, ".claude", "worktrees");
const branches = (s) => s.project.git("branch", "--list", "harness/*").split("\n").map((b) => b.replace(/^[*+ ]+/, "").trim()).filter(Boolean);

test("G124 prune keeps a spawn's worktree until its agent is registered; the lease is cleared afterwards", async () => {
  const s = setup({ git: true });
  const entered = deferred();
  const gate = deferred();
  const createAgent = s.fake.client.createAgent.bind(s.fake.client);
  s.fake.client.createAgent = async (req) => {
    entered.resolve(req);
    await gate.promise;
    return createAgent(req);
  };

  const spawn = s.ph(["spawn", "--name", "x", "--worktree", "--prompt", "edit"]);
  const req = await entered.promise;
  const prune = await s.ph(["worktrees", "--prune"]);
  assertExit(prune, 0);
  assertLine(prune, /^in use {17}harness\/x-/);
  assertLine(prune, "worktrees: 1 listed, 0 removed");
  assert.ok(fs.existsSync(req.cwd), "the worktree the agent is created in must survive the prune");
  assert.equal(branches(s).length, 1);

  gate.resolve();
  assertExit(await spawn, 0);
  assert.deepEqual(fs.readdirSync(wtDir(s)), [path.basename(req.cwd)], "no lease file is left after the agent exists");
});

test("G124 a lease left by a crashed spawn does not pin its worktree; prune removes the lease with the tree", async () => {
  const s = setup({ git: true });
  const name = "clean-20261020-101010_abcd";
  s.project.git("worktree", "add", path.join(wtDir(s), name), "-b", `harness/${name}`);
  const lease = path.join(wtDir(s), `${name}.lease`);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  fs.writeFileSync(lease, JSON.stringify({ pid: dead }));

  const r = await s.ph(["worktrees", "--prune"]);
  assertExit(r, 0);
  assertLine(r, /^merged and clean {7}harness\/clean-/);
  assertLine(r, "worktrees: 1 listed, 1 removed");
  assert.deepEqual(branches(s), []);
  assert.ok(!fs.existsSync(lease));
});
