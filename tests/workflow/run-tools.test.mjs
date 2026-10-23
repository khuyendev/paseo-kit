import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { meta, setup } from "./helpers.mjs";

const DEAD_PID = spawnSync(process.execPath, ["-e", ""]).pid;

function fixtureRun(s, id, { status = "done", pid = DEAD_PID, log = [], journal = [], startedAt = "2026-10-20T10:00:00.000Z", endedAt = "2026-10-20T10:01:40.000Z", runsDir, extra = {} } = {}) {
  const dir = path.join(runsDir ?? s.project.path("_workspace/_runs"), id);
  fs.mkdirSync(dir, { recursive: true });
  if (status !== null) fs.writeFileSync(path.join(dir, "run.json"), `${JSON.stringify({ runId: id, status, pid, startedAt, endedAt, name: "n", ...extra }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "log.txt"), log.map((l) => `${l}\n`).join(""));
  fs.writeFileSync(path.join(dir, "journal.jsonl"), journal.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return dir;
}

test("FLOW-40 status stopped with a dead pid ends after one settling poll; no ids exits 1", async () => {
  const s = setup();
  fixtureRun(s, "wf_a", { status: "stopped" });
  const r = await s.ph(["watch-run", "wf_a"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ["workflow ended (run.json status stopped)"]);
  assert.deepEqual(s.clock.sleeps, [1000]);
  assert.equal((await s.ph(["watch-run"])).code, 1);
});

test("FLOW-40 a dead pid with status running ends after 3 polls", async () => {
  const s = setup();
  fixtureRun(s, "wf_d", { status: "running" });
  const r = await s.ph(["watch-run", "wf_d"]);
  assert.deepEqual(r.out.slice(0, 1), [`workflow interrupted (runner pid ${DEAD_PID} is gone; end it with: ph archive --run wf_d)`]);
  assert.match(r.out[1], /^next: resume with `node ".+ph\.mjs" workflow --resume wf_d --detach`; /);
  assert.deepEqual(s.clock.sleeps, [1000, 1000]);
});

test("FLOW-40 a 500-line log gives one resume summary; --from-start replays; null agent lines shown without --all", async () => {
  const s = setup();
  const log = ["workflow start wf_l x", "phase Draft", ...Array.from({ length: 497 }, (_, i) => `agent done #${i + 1} a ok tokens=1 cost=? 1s`), "workflow done wf_l: r (ok 1)"];
  fixtureRun(s, "wf_l", { status: "done", log });
  const r = await s.ph(["watch-run", "wf_l"]);
  assert.deepEqual(r.out, ["resuming wf_l: skipped 500 earlier lines; current phase Draft (--from-start replays them)", "workflow done wf_l: r (ok 1)"]);
  const all = await s.ph(["watch-run", "wf_l", "--from-start"]);
  assert.deepEqual(all.out, ["workflow start wf_l x", "phase Draft", "workflow done wf_l: r (ok 1)"]);
  fixtureRun(s, "wf_n", { status: "done", log: ["agent done #1 a null (finished without a reply) tokens=0 cost=? 1s", "agent start #2 a 12345678 p/m", "workflow done wf_n: x"] });
  fixtureRun(s, "wf_m", { status: "stopped" });
  const two = await s.ph(["watch-run", "wf_n", "wf_m", "--from-start"]);
  assert.deepEqual(two.out, ["[wf_n] agent done #1 a null (finished without a reply) tokens=0 cost=? 1s", "[wf_n] workflow done wf_n: x", "[wf_m] workflow ended (run.json status stopped)"]);
});

test("FLOW-40 appended bytes are followed with a partial last line held and CR stripped", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock });
  const dir = fixtureRun(s, "wf_f", { status: "running", pid: process.pid });
  const p = s.ph(["watch-run", "wf_f", "--all"]);
  const logFile = path.join(dir, "log.txt");
  const step = async () => {
    await clock.advance(1000);
    await new Promise((r) => setImmediate(r));
  };
  await step();
  fs.appendFileSync(logFile, "phase A\r\nlog par");
  await step();
  fs.appendFileSync(logFile, "tial\nworkflow done wf_f: x\n");
  await step();
  const r = await p;
  assert.deepEqual(r.out, ["phase A", "log partial", "workflow done wf_f: x"]);
});

test("FLOW-40 a missing run dir or a dir without run.json ends after 60 s", async () => {
  const s = setup();
  const r = await s.ph(["watch-run", "wf_none"]);
  assert.match(r.out[0], /^workflow not found \(no .*wf_none\)$/);
  fixtureRun(s, "wf_nr", { status: null });
  const t0 = s.clock.now();
  const r2 = await s.ph(["watch-run", "wf_nr"]);
  assert.match(r2.out[0], /^workflow not started \(no run\.json in .*wf_nr\)$/);
  assert.ok(s.clock.now() - t0 >= 60_000);
});

const J = [
  { n: 1, status: "start" },
  { n: 1, label: "plan:a", role: "planner", model: "circle/m", agentId: "a1", status: "ok", duration_s: 10, tokens: 5, usage: { input: 100, cachedInput: 50, output: 5, costUsd: 0.01 } },
  { n: 2, label: "review:b", role: "checker", model: "circle/mid", agentId: "a2", status: "null", duration_s: 30, tokens: 7, usage: { input: 200, cachedInput: 0, output: 7, costUsd: 0.02 } },
  { n: 3, label: "plan:c", role: "planner", model: "circle/m", agentId: "a3", status: "ok", duration_s: 20, tokens: 1, usage: { input: 1, cachedInput: 1, output: 1, costUsd: 0.005 } },
  { n: 4, label: "plan:a", role: "planner", model: "circle/m", agentId: "a0", status: "cached", duration_s: 0, tokens: 0 },
];

test("FLOW-41 run-stats numbers equal the journal sums; a missing run is one failed line, exit 2", async () => {
  const s = setup();
  fixtureRun(s, "wf_s", { journal: J, extra: { adopted: [{ agentId: "a9", session: "x", fromRun: "wf_p" }] } });
  const r = await s.ph(["run-stats", "wf_s", "wf_missing"]);
  assert.equal(r.code, 2);
  assert.deepEqual(r.out.slice(0, 2), [
    "wf_s [planner circle/m, checker circle/mid] status done",
    "wall 100 s; agents 4: median 20 s, slowest 30 s; tokens in 301 cached 51 out 13; cost $0.035",
  ]);
  assert.match(r.out[2], /^failed wf_missing: no .*run\.json$/);
  assert.equal(r.out.length, 3);
});

test("FLOW-41 FLOW-48 --transcripts counts only turns tagged with the run", async () => {
  const s = setup();
  fixtureRun(s, "wf_t", { journal: J });
  const slug = s.project.root.replace(/[^A-Za-z0-9]/g, "-");
  const dir = path.join(s.env.CLAUDE_CONFIG_DIR, "projects", slug);
  fs.mkdirSync(dir, { recursive: true });
  const user = (text) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
  const tools = (...names) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: names.map((name) => ({ type: "tool_use", name, input: name === "Bash" ? { command: "ls > out.txt" } : {} })) } });
  fs.writeFileSync(path.join(dir, "a.jsonl"), [user("task\n- Run wf_old #1 (bookkeeping only; ignore)."), tools("Read"), user("more\n\nRun wf_t #3 (bookkeeping only; ignore)."), tools("Read", "Grep", "Edit", "Bash", "Skill")].join("\n"));
  fs.writeFileSync(path.join(dir, "b.jsonl"), [user("untagged work"), tools("Read", "Read")].join("\n"));
  const r = await s.ph(["run-stats", "wf_t", "--transcripts"]);
  assert.equal(r.code, 0);
  assert.equal(r.out[2], "transcripts 1; tool calls: read 2, write 2, shell 0, other 1");
});

test("FLOW-42 --prune with 25 done, 2 failed, 1 running removes the 5 oldest done only", async () => {
  const s = setup();
  const stamp = (i) => `2026-10-${String(1 + Math.floor(i / 10)).padStart(2, "0")}T0${i % 10}:00:00.000Z`;
  for (let i = 0; i < 25; i++) fixtureRun(s, `wf_done${String(i).padStart(2, "0")}`, { startedAt: stamp(i) });
  fixtureRun(s, "wf_fail1", { status: "failed", startedAt: stamp(0) });
  fixtureRun(s, "wf_fail2", { status: "failed", startedAt: stamp(1) });
  fixtureRun(s, "wf_run", { status: "running", pid: process.pid, startedAt: stamp(0) });
  const list = await s.ph(["runs"]);
  assert.match(list.out[0], /^wf_done24 done 2026-10-03T04:00:00.000Z n$/);
  const r = await s.ph(["runs", "--prune"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.filter((l) => l.startsWith("removed")), ["removed wf_done04", "removed wf_done03", "removed wf_done02", "removed wf_done01", "removed wf_done00"]);
  assert.equal(r.out.at(-1), "runs: 28 listed, 5 removed");
  assert.ok(fs.existsSync(s.project.path("_workspace/_runs/wf_fail1")) && fs.existsSync(s.project.path("_workspace/_runs/wf_run")));
});

test("FLOW-21 detached start without PASEO_AGENT_ID -> exit 1 and no run dir", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const { PASEO_AGENT_ID, ...env } = s.env;
  const r = await s.ph(["workflow", "--script", "wf.js", "--detach"], { env });
  assert.equal(r.code, 1);
  assert.match(r.err[0], /PASEO_AGENT_ID is not set/);
  assert.ok(!fs.existsSync(s.project.path("_workspace/_runs")));
});

test("FLOW-21 detached start: returns at once, run.json with the child pid, log.txt without duplicates, runs-dir in the hint", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const runsDir = path.join(makeTempDir(), "runs");
  let childArgs = null;
  let childEnv = null;
  let child = null;
  const fakeSpawn = (exe, args, opts) => {
    childArgs = args;
    childEnv = opts.env;
    child = spawn(exe, ["-e", "console.log('workflow start x')"], opts);
    return child;
  };
  const t0 = Date.now();
  const r = await s.ph(["workflow", "--script", "wf.js", "--detach", "--runs-dir", runsDir, "--run-id", "wf_det"], { deps: { spawn: fakeSpawn } });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.code, 0, r.stderr);
  const info = JSON.parse(fs.readFileSync(path.join(runsDir, "wf_det", "run.json"), "utf8"));
  assert.equal(info.status, "running");
  assert.equal(info.pid, child.pid);
  assert.ok(!childArgs.includes("--detach") && childArgs.includes("wf_det"));
  assert.equal(childEnv.PASEO_HARNESS_LOG_IS_STDOUT, "1");
  assert.equal(r.out[0], `workflow started wf_det: ${path.join(runsDir, "wf_det", "log.txt")}`);
  assert.match(r.out[1], new RegExp(`^next: wait with Monitor running \`node ".+ph\\.mjs" watch-run wf_det --quiet --runs-dir ".+/runs"\`; do not poll with sleep/grep loops$`));
  await new Promise((res) => child.on("close", res));
  assert.equal(fs.readFileSync(path.join(runsDir, "wf_det", "log.txt"), "utf8").trim(), "workflow start x");
  // The hint's --runs-dir is honoured by watch-run and run-stats.
  fs.writeFileSync(path.join(runsDir, "wf_det", "run.json"), JSON.stringify({ ...info, status: "done", pid: DEAD_PID }));
  fs.writeFileSync(path.join(runsDir, "wf_det", "journal.jsonl"), "");
  assert.equal((await s.ph(["watch-run", "wf_det", "--runs-dir", runsDir])).code, 0);
  assert.equal((await s.ph(["run-stats", "wf_det", "--runs-dir", runsDir])).code, 0);
});

test("FLOW-21 a foreground run under PASEO_HARNESS_LOG_IS_STDOUT does not write log.txt itself", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_c"], { env: { ...s.env, PASEO_HARNESS_LOG_IS_STDOUT: "1" } });
  assert.equal(r.code, 0);
  assert.ok(!fs.existsSync(s.project.path("_workspace/_runs/wf_c/log.txt")) || fs.readFileSync(s.project.path("_workspace/_runs/wf_c/log.txt"), "utf8") === "");
});
