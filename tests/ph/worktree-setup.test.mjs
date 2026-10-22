import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { loadConfig, loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { createWorktree, discardWorktree, removeWorktree, runGit } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { removeSetupLinks, setupProblems } from "../../ship/.agents/harness/runtime/worktree-setup.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { assertExit, assertLine } from "../helpers/assert.mjs";
import { meta, setup as wfSetup } from "../workflow/helpers.mjs";
import { creates, setup } from "./setup.mjs";

const IGNORE = { ".gitignore": "deps/\ncache/\n*.local\n", "src/tracked.txt": "t" };

// A git project whose ignored deps/ and cache/ exist only in the checkout, with the given worktree_setup.
function project(worktreeSetup) {
  const s = setup({ git: true, files: IGNORE, overlay: { adapter: { worktree_setup: worktreeSetup } } });
  s.project.write("deps/pkg/index.js", "dep");
  s.project.write("cache/blob.bin", "cache");
  s.project.write("app.local", "local");
  return s;
}

const wtDir = (s) => path.join(s.root, ".claude", "worktrees");
const branches = (s) => s.project.git("branch", "--list", "harness/*").split("\n").map((b) => b.replace(/^[*+ ]+/, "").trim()).filter(Boolean);

test("PHCL-31 spawn --worktree copies and links the adapter's git-ignored paths before the agent starts", async () => {
  const s = project({ copy: ["deps", "app.local"], link: ["cache"] });
  const r = await s.ph(["spawn", "--name", "x", "--worktree", "--prompt", "edit"]);
  assertExit(r, 0);
  const wt = creates(s.fake)[0].cwd;
  assert.equal(fs.readFileSync(path.join(wt, "deps/pkg/index.js"), "utf8"), "dep");
  assert.equal(fs.lstatSync(path.join(wt, "deps")).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(wt, "app.local"), "utf8"), "local");
  assert.equal(fs.lstatSync(path.join(wt, "cache")).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(wt, "cache/blob.bin"), "utf8"), "cache");
  // Ignored paths keep the worktree clean, so ph worktrees can still call it merged and clean.
  assert.equal(runGit(wt, ["status", "--porcelain", "--untracked-files=all"]).stdout, "");
});

test("PHCL-31 removing or discarding a worktree drops its links first and never the checkout's folder", async () => {
  const s = project({ copy: [], link: ["cache"] });
  const cfg = loadConfig(s.root);
  const a = await createWorktree(s.root, cfg, "a");
  discardWorktree(a);
  assert.equal(fs.existsSync(a.path), false);
  const c = await createWorktree(s.root, cfg, "c");
  removeSetupLinks(c.path, runGit);
  assert.equal(fs.existsSync(path.join(c.path, "cache")), false);
  assert.equal(fs.existsSync(path.join(c.path, "src/tracked.txt")), true);
  discardWorktree(c);
  const b = await createWorktree(s.root, cfg, "b");
  const removed = removeWorktree(b.top, { ...b, missing: false });
  assert.equal(removed.ok, true, removed.line);
  assert.equal(fs.existsSync(b.path), false);
  assert.equal(s.project.read("cache/blob.bin"), "cache");
});

test("PHCL-31 a setup problem stops the spawn before any agent and leaves no worktree or branch", async () => {
  const s = project({ copy: ["deps", "missing"], link: [] });
  const r = await s.ph(["spawn", "--name", "x", "--worktree", "--prompt", "edit"]);
  assertExit(r, 2);
  assertLine(r, /^failed spawn x: worktree setup: adapter\.worktree_setup\.copy missing: does not exist in the checkout/);
  assert.equal(creates(s.fake).length, 0);
  assert.deepEqual(fs.existsSync(wtDir(s)) ? fs.readdirSync(wtDir(s)) : [], []);
  assert.deepEqual(branches(s), []);
});

test("PHCL-31 setup problems: bad paths, overlaps, missing, links of files, tracked or linked sources", () => {
  const s = project({ copy: [], link: [] });
  fs.symlinkSync(s.project.path("cache"), s.project.path("cache2"), process.platform === "win32" ? "junction" : "dir");
  fs.appendFileSync(s.project.path(".gitignore"), "cache2\n");
  const problems = setupProblems(s.root, {
    copy: ["../up", "a\\b", "/abs", ".git/x", "deps", "deps/pkg", "nope", "src/tracked.txt", "cache2"],
    link: ["app.local", "DEPS"],
  }, runGit);
  const want = [
    /copy \.\.\/up: has an empty/, /copy a\\b: must be a repo-relative path/, /copy \/abs: must be a repo-relative path/, /copy \.git\/x: has an empty/,
    /copy deps\/pkg: overlaps copy deps/, /copy nope: does not exist in the checkout/, /copy src\/tracked\.txt: is not git-ignored/,
    /copy cache2: .*cache2 is a link/, /link app\.local: link takes a directory/,
  ];
  for (const re of want) assert.ok(problems.some((p) => re.test(p)), `${re}\n${problems.join("\n")}`);
  if (process.platform === "win32") assert.ok(problems.some((p) => /link DEPS: overlaps copy deps/.test(p)), problems.join("\n"));
  assert.equal(problems.some((p) => /copy deps:/.test(p)), false, problems.join("\n"));
  assert.deepEqual(setupProblems(s.root, { copy: ["deps", "app.local"], link: ["cache"] }, runGit), []);
});

async function doctor(s) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  await runDoctor(ctx, { freemem: () => 64 * 2 ** 30, claudeVersionText: () => "2.1.300 (Claude Code)" });
  return out;
}

test("PHCL-04 doctor reports worktree setup problems, an ok line when set up, nothing when unset", async () => {
  const bad = await doctor(project({ copy: ["missing"], link: [] }));
  assert.ok(bad.includes("problem adapter.worktree_setup.copy missing: does not exist in the checkout (install or build it there first)"), bad.join("\n"));
  const good = await doctor(project({ copy: ["deps"], link: ["cache"] }));
  assert.ok(good.includes("ok worktree setup: 1 copy, 1 link path(s) present and git-ignored"), good.join("\n"));
  const none = await doctor(setup({ git: true }));
  assert.equal(none.some((l) => /worktree setup/.test(l)), false, none.join("\n"));
});

test("HARN-07 harness lint fails a worktree setup path that is tracked", () => {
  const s = project({ copy: ["src/tracked.txt"], link: [] });
  const lines = lintProject(s.root).findings.map(findingLine);
  assert.ok(lines.includes("fail .agents/harness.config.json: adapter.worktree_setup.copy src/tracked.txt: is not git-ignored (tracked files come with the worktree checkout)"), lines.join("\n"));
});

test("PHCL-31 workflow isolation gets the setup paths too, and a setup problem fails only that agent call", async () => {
  const w = wfSetup({ git: true, files: IGNORE, overlay: { adapter: { worktree_setup: { copy: ["deps"], link: [] } } } });
  w.project.write("deps/pkg/index.js", "dep");
  w.project.write("wf.js", `${meta()}return await agent("edit", {isolation:"worktree", detail:true});`);
  assertExit(await w.ph(["workflow", "--script", "wf.js", "--run-id", "wf_setup"]), 0);
  const cwd = w.fake.callsOf("createAgent")[0].args[0].cwd;
  assert.equal(fs.readFileSync(path.join(cwd, "deps/pkg/index.js"), "utf8"), "dep");
  fs.rmSync(w.project.path("deps"), { recursive: true });
  await w.ph(["workflow", "--script", "wf.js", "--run-id", "wf_setup_bad"]);
  const result = w.project.readJson("_workspace/_runs/wf_setup_bad/result.json");
  assert.equal(result.agentId, null);
  assert.match(result.reason, /worktree setup: adapter\.worktree_setup\.copy deps: does not exist in the checkout/);
  assert.equal(w.fake.callsOf("createAgent").length, 1);
});
