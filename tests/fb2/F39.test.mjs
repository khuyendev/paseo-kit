// Kit feedback #39: a detached runner that dies leaves run.json "running" and log.txt without a reason, and watch-run
// names no way to resume. The runner records its exit reason; watch-run prints the resume command.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";
import { runNode } from "../helpers/run.mjs";
import { CALLER, meta, setup } from "../workflow/helpers.mjs";

const DEAD_PID = spawnSync(process.execPath, ["-e", ""]).pid;
const url = (rel) => pathToFileURL(path.join(KIT_DIR, rel)).href;
const RESUME = /^next: resume with `node ".+ph\.mjs" workflow --resume (\S+) --detach`; the journal keeps the agents that finished$/;

// A runner in its own process, as a detached one is: the daemon never answers the timeline subscription, and nothing
// else keeps the event loop alive, so the runner ends by itself (dry) or by an error thrown by a timer (throw).
function writeDriver() {
  const dir = makeTempDir("paseo kit driver ");
  const file = path.join(dir, "driver.mjs");
  fs.writeFileSync(file, `import { createFakeDaemon } from ${JSON.stringify(url("tests/fakes/fake-daemon.mjs"))};
import { main } from ${JSON.stringify(url("ship/.agents/harness/ph.mjs"))};
const [root, caller, mode] = process.argv.slice(2);
const fake = createFakeDaemon();
fake.addAgent({ id: caller, cwd: root, title: "caller" });
fake.client.observeTimeline = () => ({ ready: new Promise(() => {}) });
if (mode === "throw") setTimeout(() => { throw new Error("boom in runner"); }, 100);
process.exitCode = await main(["workflow", "--script", "wf.js", "--run-id", "wf_f39" + mode], { env: process.env, cwd: root, daemon: fake.daemon });
`);
  return file;
}

function fixtureRun(s, id, { status, pid = DEAD_PID, log = [], error = null }) {
  const dir = s.project.path(`_workspace/_runs/${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const info = { runId: id, status, pid, startedAt: "2026-10-20T10:00:00.000Z", endedAt: status === "running" ? null : "2026-10-20T10:01:40.000Z", name: "n", error };
  fs.writeFileSync(path.join(dir, "run.json"), `${JSON.stringify(info, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "log.txt"), log.map((l) => `${l}\n`).join(""));
  fs.writeFileSync(path.join(dir, "journal.jsonl"), "");
  return dir;
}

test("F39 a runner whose event loop runs dry records the exit code as its reason in run.json and log.txt", () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const r = runNode(writeDriver(), [s.project.root, CALLER, "dry"], { cwd: s.project.root, env: s.env });
  assert.equal(r.code, 13, r.stderr);
  const info = JSON.parse(s.project.read("_workspace/_runs/wf_f39dry/run.json"));
  assert.equal(info.status, "failed");
  assert.equal(info.error, "runner exited with code 13 before the run ended");
  const log = s.project.read("_workspace/_runs/wf_f39dry/log.txt").trimEnd().split("\n");
  assert.equal(log.at(-1), "workflow failed wf_f39dry: runner exited with code 13 before the run ended");
});

test("F39 an uncaught error ends the runner with its message recorded, and the stack still reaches stderr", () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const r = runNode(writeDriver(), [s.project.root, CALLER, "throw"], { cwd: s.project.root, env: s.env });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /boom in runner/);
  const info = JSON.parse(s.project.read("_workspace/_runs/wf_f39throw/run.json"));
  assert.equal(info.status, "failed");
  assert.equal(info.error, "uncaught error: boom in runner");
  assert.equal(s.project.read("_workspace/_runs/wf_f39throw/log.txt").trimEnd().split("\n").at(-1), "workflow failed wf_f39throw: uncaught error: boom in runner");
});

test("F39 a foreground run leaves no exit, signal or uncaught-error listener behind", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const before = ["exit", "uncaughtException", "SIGINT", "SIGTERM", "SIGHUP"].map((e) => process.listenerCount(e));
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_ok"]);
  assert.equal(r.code, 0);
  assert.deepEqual(["exit", "uncaughtException", "SIGINT", "SIGTERM", "SIGHUP"].map((e) => process.listenerCount(e)), before);
  assert.equal(JSON.parse(s.project.read("_workspace/_runs/wf_ok/run.json")).status, "done");
});

test("F39 watch-run: an interrupted run prints the resume command after the interrupted line", async () => {
  const s = setup();
  fixtureRun(s, "wf_d", { status: "running" });
  const r = await s.ph(["watch-run", "wf_d"]);
  assert.equal(r.code, 0);
  assert.equal(r.out[0], `workflow interrupted (runner pid ${DEAD_PID} is gone; end it with: ph archive --run wf_d)`);
  assert.equal(r.out.length, 2);
  assert.match(r.out[1], RESUME);
  assert.equal(RESUME.exec(r.out[1])[1], "wf_d");
});

test("F39 watch-run: a failed run prints its error and the resume command; a done run prints no resume command", async () => {
  const s = setup();
  fixtureRun(s, "wf_f", { status: "failed", error: "boom", log: ["workflow start wf_f x", "workflow failed wf_f: boom"] });
  const failed = await s.ph(["watch-run", "wf_f", "--from-start"]);
  assert.deepEqual(failed.out.slice(0, 2), ["workflow start wf_f x", "workflow failed wf_f: boom"]);
  assert.match(failed.out[2], RESUME);
  // A failed run whose terminal line never reached the log: the run.json fallback prints the same resume command.
  fixtureRun(s, "wf_g", { status: "failed", error: "boom", log: ["workflow start wf_g x"] });
  const settled = await s.ph(["watch-run", "wf_g", "--from-start"]);
  assert.deepEqual(settled.out.slice(0, 2), ["workflow start wf_g x", "workflow ended (run.json status failed; error: boom)"]);
  assert.match(settled.out[2], RESUME);
  fixtureRun(s, "wf_h", { status: "done", log: ["workflow done wf_h: r (ok 1)"] });
  const done = await s.ph(["watch-run", "wf_h", "--from-start"]);
  assert.deepEqual(done.out, ["workflow done wf_h: r (ok 1)"]);
});

test("F39 watch-run: the resume command names the runs dir when it is not the default", async () => {
  const s = setup();
  const runsDir = path.join(makeTempDir(), "other runs");
  fs.mkdirSync(path.join(runsDir, "wf_o"), { recursive: true });
  fs.writeFileSync(path.join(runsDir, "wf_o", "run.json"), JSON.stringify({ runId: "wf_o", status: "failed", pid: DEAD_PID, error: "x" }));
  fs.writeFileSync(path.join(runsDir, "wf_o", "log.txt"), "workflow failed wf_o: x\n");
  const r = await s.ph(["watch-run", "wf_o", "--runs-dir", runsDir, "--from-start"]);
  assert.match(r.out.at(-1), /^next: resume with `node ".+ph\.mjs" workflow --resume wf_o --detach --runs-dir ".+other runs"`; /);
});
