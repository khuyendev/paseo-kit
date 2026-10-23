// G114 (bug hunt 2026-10-23): the debug staging guard in gsd-debug.js compared only the names of the staged paths. A debugger
// turn that re-stages a path the owner had already staged, or commits, must now fail the session.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const FORM = "src/login/form.js";
const git = (w, ...args) => spawnSync("git", args, { cwd: w.root, encoding: "utf8", windowsHide: true });

// The fake debug verbs of gsd-flows/misc.test.mjs (GSDC-43 contract, simplified), with one session kept in memory.
function debugWorld() {
  const w = makeWorld({ overlay: { gsd: { debug: { max_turns: 3, minutes: 120 } } } });
  const s = { path: ".planning/debug/login-fails.md", frontmatter: { goal: "find_and_fix", owns: ["Path:src/login/"], budget_used: { turns: 0, minutes: 0 } } };
  w.gsd.on("debug status", () => ({ status: "investigating", path: s.path, frontmatter: s.frontmatter }));
  w.gsd.on("debug budget", (argv, input) => {
    const d = JSON.parse(input);
    s.frontmatter.budget_used = { turns: s.frontmatter.budget_used.turns + (d.turns ?? 0), minutes: s.frontmatter.budget_used.minutes + (d.minutes ?? 0) };
    return { budget_used: s.frontmatter.budget_used };
  });
  return w;
}
const debug = (w, agent) => runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug: "login-fails" }, agent });

// A committed login form, then the owner's staged work on it.
function ownerStaged() {
  const w = debugWorld();
  w.write(FORM, "v1\n");
  git(w, "add", "-A");
  git(w, "commit", "-q", "-m", "login");
  w.write(FORM, "owner staged work\n");
  git(w, "add", FORM);
  return w;
}

test("G114 a debugger turn that re-stages a path the owner already staged fails the session", async () => {
  const w = ownerStaged();
  const r = await debug(w, () => {
    w.write(FORM, "debugger edit\n");
    git(w, "add", FORM);
    return { status: "continue" };
  });
  assert.deepEqual([r.result.status, r.calls.length], ["failed", 1]);
  assert.match(r.result.reason, /staged, committed or stashed/);
});

test("G114 a debugger commit made when nothing was staged before the turn fails the session", async () => {
  const w = debugWorld();
  w.write(FORM, "v1\n");
  git(w, "add", "-A");
  git(w, "commit", "-q", "-m", "login");
  const r = await debug(w, () => {
    w.write(FORM, "debugger fix\n");
    git(w, "add", FORM);
    git(w, "commit", "-q", "-m", "fix: debugger");
    return { status: "continue" };
  });
  assert.deepEqual([r.result.status, r.calls.length], ["failed", 1]);
  assert.match(r.result.reason, /staged, committed or stashed/);
});

test("G114 a debugger that only edits files, with the owner's staged work untouched, runs to its turn cap", async () => {
  const w = ownerStaged();
  const before = git(w, "write-tree").stdout;
  const r = await debug(w, () => {
    w.write(FORM, "debugger edit in the worktree\n");
    return { status: "continue" };
  });
  assert.deepEqual([r.result.status, r.result.type, r.calls.length], ["needs-owner", "budget-exhausted", 3]);
  assert.equal(git(w, "write-tree").stdout, before);
});
