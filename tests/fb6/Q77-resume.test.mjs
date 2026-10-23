// Kit feedback #78, #83 F2 (Q77): all resume state of gsd-execute lives in execute-progress.json. A run that dies at each
// stop point (after code, after transfer, after the shared step, after the gate, after the review) is followed by a run with the
// same args that finishes without a hand action; the integration files the first run applied are committed with the wave.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { NODE_FLAG_COMMANDS, committedFiles, died, exec, shared, world } from "./q77-helpers.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { executor } from "../gsd-flows/exec-world.mjs";
import { Killed } from "../gsd-flows/host.mjs";

const progressOf = (w) => JSON.parse(w.read(`${PHASE_DIR}/execute-progress.json`));
const SECOND = "wf_20261020-120000_cd34";
const finished = (w, r) => {
  assert.equal(r.result?.status, "executed", JSON.stringify(r.result ?? r.error?.message));
  const left = w.git("status", "--porcelain", "-uall").stdout.split("\n").filter((l) => l && !l.slice(3).startsWith(".planning/"));
  assert.deepEqual(left, [], "nothing of the code is left uncommitted");
  const p = progressOf(w);
  assert.ok(Object.values(p.plans).every((x) => x.tracked === true), JSON.stringify(p.plans));
};

test("Q77 F78 a run stopped after the shared step: the next run commits the shared files with the wave (shared tree)", async () => {
  const w = world({ isolation: "shared" });
  const first = await exec(w, {}, { ...shared(w), "review-": died("reviewer") });
  assert.equal(first.error?.message, "killed reviewer");
  assert.deepEqual(progressOf(w).integration, ["config/app.json"]);
  assert.equal(progressOf(w).shared[0].applied, true);
  const r = await exec(w);
  finished(w, r);
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"), committedFiles(w, "feat(01-w1)").join(","));
  assert.deepEqual(JSON.parse(w.read(`${PHASE_DIR}/commits.json`))[0].integration, ["config/app.json"]);
});

test("Q77 F83 stop after code (the executor died after writing its files and SUMMARY): the next run rejoins the plan without a new executor", async () => {
  const w = world({ isolation: "shared" });
  const run = executor(w);
  const first = await exec(w, {}, { ...shared(w), "exec-01-01": async (...a) => { await run(...a); throw new Killed("killed after code"); } });
  assert.equal(first.error?.message, "killed after code");
  const r = await exec(w, {}, shared(w));
  finished(w, r);
  assert.equal(r.calls.filter((c) => c.opts.label === "exec-01-01").length, 0, "01-01 has its SUMMARY: no executor");
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
});

test("Q77 F83 stop after the transfer (worktree): the next run does not run the executors again and applies the shared step", async () => {
  const w = world({ isolation: "worktree" });
  // Kit feedback 95: the declared shared change is made before the executor; the shared step after the transfer is the one
  // of the executor's request, and that fixer dies.
  const fix = shared(w)["shared-"];
  const die = died("shared fixer");
  let n = 0;
  const run = executor(w);
  const ask = { "exec-01-01": async (...a) => ({ ...(await run(...a)), requests: [{ path: "config/other.json", change: "add key y", reason: "shared" }] }) };
  const first = await exec(w, {}, { ...ask, "shared-": (...a) => (++n === 1 ? fix(...a) : die(...a)) });
  assert.equal(first.error?.message, "killed shared fixer");
  assert.ok(fs.existsSync(path.join(w.root, `${PHASE_DIR}/transfers/01-01.json`)));
  const r = await exec(w, {}, shared(w), SECOND);
  finished(w, r);
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("exec-")).length, 0);
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
});

test("Q77 F83 stop after the shared step (worktree), gate red and its fixer dead: the next run fixes and commits the shared files", async () => {
  const w = world({ isolation: "worktree", commands: NODE_FLAG_COMMANDS });
  const first = await exec(w, {}, {
    ...shared(w),
    "exec-01-01": async (p, o, n, calls) => { const v = await executor(w)(p, o, n, calls); w.write("fail.flag", "src/01-01/impl.js"); return v; },
    "fix-01-01": died("gate fixer"),
  });
  assert.equal(first.error?.message, "killed gate fixer");
  assert.equal(progressOf(w).shared[0].applied, true);
  const r = await exec(w, {}, shared(w), SECOND);
  finished(w, r);
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
});

test("Q77 F83 stop after the gate (worktree): the next run reviews and commits", async () => {
  const w = world({ isolation: "worktree" });
  const first = await exec(w, {}, { ...shared(w), "review-": died("reviewer") });
  assert.equal(first.error?.message, "killed reviewer");
  const r = await exec(w, {}, shared(w), SECOND);
  finished(w, r);
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
});

test("Q77 F83 stop after the review and its fix (worktree): the next run runs only the resolution check and commits", async () => {
  const w = world({ isolation: "worktree" });
  const finding = { findings: [{ id: "F1", severity: "high", trigger: "x", likelihood: "likely", confidence: 95, impact: "i", file: "src/01-01/impl.js", line: 1, description: "d" }] };
  const first = await exec(w, {}, { ...shared(w), "review-01-01": () => finding, "resolve-": died("resolver") });
  assert.equal(first.error?.message, "killed resolver");
  const r = await exec(w, {}, { ...shared(w), "review-01-01": () => finding }, SECOND);
  finished(w, r);
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("fix-review")).length, 0, "the fix of the first run is not repeated");
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
});

test("Q77 F83 stop after the commit before the STATE update: the next run only tracks the wave", async () => {
  const w = world({ isolation: "shared" });
  let armed = true;
  w.gsd.on("state wave", () => { if (armed) { armed = false; throw new Killed("killed at state"); } return { updated: ["wave log"] }; });
  const first = await exec(w, {}, shared(w));
  assert.ok(first.error || first.result?.status === "needs-owner" || first.result?.status === "failed", JSON.stringify(first.result));
  const r = await exec(w, {}, shared(w));
  finished(w, r);
  assert.equal(w.git("log", "--format=%s").stdout.split("\n").filter((l) => l.startsWith("feat(01-w1)")).length, 1, "one wave commit");
});

test("Q77 F83 an integration fixer that died after writing its file: the next run knows the file and finishes", async () => {
  const w = world({ isolation: "shared", commands: NODE_FLAG_COMMANDS });
  w.write("lib.txt", "l\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "lib");
  const first = await exec(w, {}, {
    ...shared(w),
    "exec-01-01": async (p, o, n, calls) => { const v = await executor(w)(p, o, n, calls); w.write("fail.flag", "lib.txt"); return v; },
    "integration-fix": () => { w.write("lib.txt", "fixed\n"); throw new Killed("killed integration fixer"); },
  });
  assert.equal(first.error?.message, "killed integration fixer");
  assert.deepEqual(progressOf(w).integration, ["config/app.json", "lib.txt"]);
  const r = await exec(w, {}, { ...shared(w), "integration-fix": () => { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { status: "fixed" }; } });
  finished(w, r);
  assert.ok(committedFiles(w, "feat(01-w1)").includes("lib.txt"));
});

test("Q77 F83 a commit made but not recorded in commits.json: the next run reconciles it and commits nothing twice", async () => {
  const w = world({ isolation: "shared" });
  const commit = w.gsd.handlers.commit;
  let armed = true;
  w.gsd.on("commit", async (...a) => { const v = await commit(...a); if (armed) { armed = false; throw new Killed("killed after commit"); } return v; });
  const first = await exec(w, {}, shared(w));
  assert.equal(first.error?.message, "killed after commit");
  const r = await exec(w, {}, shared(w));
  finished(w, r);
  assert.equal(w.git("log", "--format=%s").stdout.split("\n").filter((l) => l.startsWith("feat(01-w1)")).length, 1, "one wave commit");
});
