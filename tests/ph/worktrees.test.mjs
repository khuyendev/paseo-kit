import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { worktrees } from "../../ship/.agents/harness/runtime/cmd-worktrees.mjs";
import { runGit } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { assertErrLine, assertExit, assertLine } from "../helpers/assert.mjs";
import { connectFake } from "../helpers/run.mjs";
import { creates, setup } from "./setup.mjs";

const branches = (s) => s.project.git("branch", "--list", "harness/*").split("\n").map((b) => b.replace(/^[*+ ]+/, "").trim()).filter(Boolean);
const wtDir = (s) => path.join(s.root, ".claude", "worktrees");

test("PHCL-31 spawn --worktree creates a sanitized worktree and branch and notes it in the prompt", async () => {
  const s = setup({ git: true });
  const r = await s.ph(["spawn", "--name", "a b", "--worktree", "--prompt", "edit"]);
  assertExit(r, 0);
  const [name] = fs.readdirSync(wtDir(s));
  assert.match(name, /^a_b-\d{8}-\d{6}_[0-9a-f]{4}$/);
  assert.deepEqual(branches(s), [`harness/${name}`]);
  const c = creates(s.fake)[0];
  assert.equal(path.resolve(c.cwd), path.join(wtDir(s), name));
  assert.ok(c.initialPrompt.includes(`You work in the git worktree ${path.join(wtDir(s), name)} (branch harness/${name}): edit files only there`));
  assert.ok(!c.initialPrompt.includes("Your working directory for this task"));
});

test("PHCL-31 a failed create removes the new worktree and branch; outside git nothing is created", async () => {
  const s = setup({ git: true });
  s.fake.failNext("createAgent", new Error("no"));
  const r = await s.ph(["spawn", "--name", "x", "--worktree", "--prompt", "edit"]);
  assertExit(r, 2);
  assertLine(r, "failed spawn x: no");
  assert.deepEqual(fs.existsSync(wtDir(s)) ? fs.readdirSync(wtDir(s)) : [], []);
  assert.deepEqual(branches(s), []);
  const n = setup({ git: false });
  const o = await n.ph(["spawn", "--name", "x", "--worktree", "--prompt", "edit"]);
  assertExit(o, 1);
  assertErrLine(o, "usage error: isolation 'worktree' needs a git repository");
  assert.equal(creates(n.fake).length, 0);
});

test("PHCL-32 worktrees: states, targeted prune, unrelated records untouched, no repo-wide prune", async () => {
  const s = setup({ git: true });
  const add = (name) => {
    s.project.git("worktree", "add", path.join(wtDir(s), name), "-b", `harness/${name}`);
    return path.join(wtDir(s), name);
  };
  const stampName = (n) => `${n}-20261020-101010_abcd`;
  add(stampName("clean"));
  const dirty = add(stampName("dirty"));
  fs.writeFileSync(path.join(dirty, "new.txt"), "x");
  const ahead = add(stampName("ahead"));
  s.project.git("-C", ahead, "commit", "--allow-empty", "-q", "-m", "ahead");
  const gone = add(stampName("gone"));
  const unrelated = path.join(s.root, "..", `${path.basename(s.root)} stale`);
  s.project.git("worktree", "add", unrelated, "-b", "other/stale");
  fs.rmSync(gone, { recursive: true, force: true });
  fs.rmSync(unrelated, { recursive: true, force: true });
  const calls = [];
  const spy = (cwd, args) => {
    calls.push(args);
    return runGit(cwd, args);
  };
  const session = await connectFake(s.fake, { env: s.env, root: s.root, clock: s.clock });
  const lines = [];
  const ctx = { root: s.root, cfg: loadConfig(s.root), opts: { prune: true }, out: (l) => lines.push(l), paseo: async () => session };
  const code = await worktrees(ctx, { git: spy });
  assert.equal(code, 0, lines.join("\n"));
  const line = (re) => assert.ok(lines.some((l) => re.test(l)), `${re}\n${lines.join("\n")}`);
  line(/^merged and clean {7}harness\/clean-\S+ .* \(agent clean\)$/);
  line(/^uncommitted changes {4}harness\/dirty-/);
  line(/^1 commit\(s\) not in HEAD harness\/ahead-/);
  line(/^directory missing {6}harness\/gone-/);
  line(/^removed clean-20261020-101010_abcd and branch harness\/clean-20261020-101010_abcd$/);
  line(/^(removed gone-\S+ and branch|kept gone-\S+: registration)/);
  line(/^worktrees: 4 listed, 2 removed$/);
  assert.ok(!calls.some((a) => a[0] === "worktree" && a[1] === "prune"));
  const porcelain = s.project.git("worktree", "list", "--porcelain");
  assert.ok(porcelain.includes("branch refs/heads/other/stale"));
  assert.ok(porcelain.includes("harness/dirty-") && porcelain.includes("harness/ahead-"));
  assert.ok(!porcelain.includes("harness/clean-") && !porcelain.includes("harness/gone-"));
});

test("PHCL-32 not a git repo exits 1; none prints no harness worktrees; a live agent keeps its worktree", async () => {
  const n = setup({ git: false });
  const r = await n.ph(["worktrees"]);
  assertExit(r, 1);
  assertErrLine(r, /is not in a git repository; harness worktrees live under <repo>\/\.claude\/worktrees$/);
  const s = setup({ git: true });
  assertLine(await s.ph(["worktrees"]), "no harness worktrees");
  s.project.git("worktree", "add", path.join(wtDir(s), "rev-20261020-101010_abcd"), "-b", "harness/rev-20261020-101010_abcd");
  s.fake.addAgent({ parent: "c0ffee00-1111-4222-8333-444455556666", title: "rev", labels: { "harness.name": "rev" } });
  const live = await s.ph(["worktrees", "--prune"]);
  assertExit(live, 0);
  assertLine(live, /^in use {17}harness\/rev-/);
  assertLine(live, "worktrees: 1 listed, 0 removed");
  const down = setup({ git: true, fake: { down: "refused" } });
  down.project.git("worktree", "add", path.join(wtDir(down), "rev-20261020-101010_abcd"), "-b", "harness/rev-20261020-101010_abcd");
  const d = await down.ph(["worktrees"]);
  assertLine(d, /^note daemon not reachable \(Cannot connect to daemon at fake: refused\): worktrees of spawned agents are kept$/);
  assertLine(d, /^owner unknown {10}harness\/rev-/);
});
