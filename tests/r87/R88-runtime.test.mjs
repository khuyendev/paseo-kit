// Kit feedback #88 (runtime): `ph workflow stop RUNID [--at wave-boundary]` leaves a stop request in the run dir and kills
// nothing; the flow verb stop-requested answers it for the current run; a script that returns {status: "paused"} ends the run
// paused (run.json, log line, ph runs, watch-run, metrics), and a resume of a paused run goes on.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";
import { meta, setup } from "../workflow/helpers.mjs";

const FLOW = path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs");
const { main: flowMain } = await import(pathToFileURL(FLOW).href);
const NODE = process.execPath;

async function stopRequested(root, argv, env) {
  let line = "";
  const code = await flowMain(["stop-requested", ...argv], { root, out: (l) => { line = l; }, env });
  return { code, json: JSON.parse(line) };
}
const runInfo = (s, id) => JSON.parse(s.project.read(`_workspace/_runs/${id}/run.json`));
const running = (s, id, extra = {}) => s.project.writeJson(`_workspace/_runs/${id}/run.json`, { runId: id, status: "running", pid: process.pid, startedAt: new Date().toISOString(), name: "gsd-execute", ...extra });

test("R88 ph workflow stop writes a stop request for a running run; ph runs shows it pending; nothing is killed", async () => {
  const s = setup();
  running(s, "wf_live");
  const r = await s.ph(["workflow", "stop", "wf_live", "--reason", "update  the kit"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /stop requested wf_live at the next wave-boundary/);
  const req = s.project.readJson("_workspace/_runs/wf_live/stop.json");
  assert.equal(req.at, "wave-boundary");
  assert.equal(req.reason, "update the kit");
  assert.equal(typeof req.requestedAt, "string");
  assert.equal(runInfo(s, "wf_live").status, "running", "run.json is not touched");
  const runs = await s.ph(["runs"]);
  assert.match(runs.stdout, /^wf_live running \S+ gsd-execute stop requested \(wave-boundary at /m);
  // --at defaults to wave-boundary and takes no other stop point.
  const other = await s.ph(["workflow", "stop", "wf_live", "--at", "now"]);
  assert.equal(other.code, 1);
  assert.match(other.stderr, /--at now is not a stop point; one of wave-boundary/);
});

test("R88 ph workflow stop refuses a run that is missing, ended or whose runner is gone", async () => {
  const s = setup();
  assert.match((await s.ph(["workflow", "stop", "wf_none"])).stderr, /no run wf_none/);
  running(s, "wf_done", { status: "done" });
  assert.match((await s.ph(["workflow", "stop", "wf_done"])).stderr, /is not running \(status done\)/);
  running(s, "wf_dead", { pid: 999999 });
  const dead = await s.ph(["workflow", "stop", "wf_dead"]);
  assert.equal(dead.code, 1);
  assert.match(dead.stderr, /runner of wf_dead \(pid 999999\) is gone; end the run with .*archive --run wf_dead/);
  assert.equal(fs.existsSync(s.project.path("_workspace/_runs/wf_dead/stop.json")), false);
  assert.match((await s.ph(["workflow", "stop"])).stderr, /name one run id/);
  assert.match((await s.ph(["workflow", "--name", "x", "--at", "wave-boundary"])).stderr, /--at belongs to ph workflow stop/);
});

test("R88 stop-requested reads the current run from the env, or the run id given; outside a run it never stops", async () => {
  const p = makeTempProject({ git: false });
  assert.deepEqual((await stopRequested(p.root, [], {})).json, { stop: false, runId: null });
  assert.deepEqual((await stopRequested(p.root, [], { PASEO_HARNESS_WORKFLOW_RUN: "wf_a" })).json, { stop: false, runId: "wf_a" });
  p.writeJson("_workspace/_runs/wf_a/stop.json", { at: "wave-boundary", requestedAt: "2026-10-24T10:00:00.000Z", reason: null });
  assert.deepEqual((await stopRequested(p.root, [], { PASEO_HARNESS_WORKFLOW_RUN: "wf_a" })).json, { stop: true, runId: "wf_a", at: "wave-boundary", requestedAt: "2026-10-24T10:00:00.000Z", reason: null });
  assert.equal((await stopRequested(p.root, ["wf_a"], {})).json.stop, true);
  // A --runs-dir run: the runner names its dir.
  const dir = path.join(p.root, "elsewhere", "wf_b");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "stop.json"), JSON.stringify({ at: "wave-boundary" }));
  assert.equal((await stopRequested(p.root, [], { PASEO_HARNESS_WORKFLOW_RUN: "wf_b", PASEO_HARNESS_WORKFLOW_RUN_DIR: dir })).json.stop, true);
  assert.equal((await stopRequested(p.root, ["../x"], {})).code, 1);
});

// The script asks between its two "waves"; a shell step stands in for `ph workflow stop` arriving during the first wave (once:
// shell steps are not journaled, so a resume runs it again).
const SCRIPT = (stopDuringWave) => `${meta("waves")}
const flow = async () => JSON.parse((await shell([${JSON.stringify(NODE)}, ${JSON.stringify(FLOW)}, "stop-requested"])).stdout.trim().split("\\n").pop());
const one = await agent("wave one");
${stopDuringWave ? `await shell([${JSON.stringify(NODE)}, "-e", "const fs=require('fs');if(!fs.existsSync('stop-once.flag')){fs.writeFileSync('stop-once.flag','');fs.writeFileSync(require('path').join(process.env.PASEO_HARNESS_WORKFLOW_RUN_DIR, 'stop.json'), JSON.stringify({at: 'wave-boundary', reason: 'kit update'}))}"]);` : ""}
const ask = await flow();
if (ask.stop) return { status: "paused", reason: "paused after wave 1", answer: { verb: "rerun", command: "rerun with the same args" } };
const two = await agent("wave two");
return { status: "executed", one, two };
`;

test("R88 a run whose script pauses ends paused: run.json, log, watch-run, ph runs and the metrics ledger; resume goes on and finishes", async () => {
  const s = setup();
  s.project.write("wf.js", SCRIPT(true));
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_p1"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const info = runInfo(s, "wf_p1");
  assert.equal(info.status, "paused");
  assert.equal(info.stopRequest.reason, "kit update");
  assert.equal(typeof info.endedAt, "string");
  assert.equal(s.fake.callsOf("createAgent").length, 1, "wave two never started");
  const log = s.project.read("_workspace/_runs/wf_p1/log.txt");
  assert.match(log, /^workflow paused wf_p1: .*result\.json \(paused after wave 1; ok 1, /m);
  assert.match(log, /^next: rerun with the same args$/m);
  const ledger = s.project.read("_workspace/harness-metrics.jsonl").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(ledger.map((x) => [x.runId, x.status, x.outcome?.status]), [["wf_p1", "paused", "paused"]]);
  const watch = await s.ph(["watch-run", "wf_p1", "--quiet", "--from-start"]);
  assert.equal(watch.code, 0);
  assert.match(watch.stdout, /workflow paused wf_p1/);
  assert.match(watch.stdout, /next: the run paused at a wave boundary; continue it as .*wf_p1\/result\.json answer says/);
  const runs = await s.ph(["runs", "--prune"]);
  assert.match(runs.stdout, /^wf_p1 paused /m);
  assert.ok(fs.existsSync(s.project.path("_workspace/_runs/wf_p1")), "a paused run is not pruned");

  const again = await s.ph(["workflow", "--resume", "wf_p1", "--run-id", "wf_p2"]);
  assert.equal(again.code, 0, again.stderr + again.stdout);
  assert.equal(runInfo(s, "wf_p2").status, "done");
  assert.equal(s.fake.callsOf("createAgent").length, 2, "wave one replays from the journal, wave two runs");
  assert.equal(JSON.parse(s.project.read("_workspace/_runs/wf_p2/result.json")).status, "executed");
});

test("R88 without a stop request the same script runs to its end and the run is done", async () => {
  const s = setup();
  s.project.write("wf.js", SCRIPT(false));
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_n1"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(runInfo(s, "wf_n1").status, "done");
  assert.equal(runInfo(s, "wf_n1").stopRequest, undefined);
  assert.match(s.project.read("_workspace/_runs/wf_n1/log.txt"), /^workflow done wf_n1: /m);
  assert.equal(s.fake.callsOf("createAgent").length, 2);
});
