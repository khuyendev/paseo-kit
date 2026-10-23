import assert from "node:assert/strict";
import test from "node:test";
import { METRICS_REL, runRecord } from "../../ship/.agents/harness/workflow/metrics.mjs";
import { runOwn, setup } from "../workflow/helpers.mjs";

const ID = "wf_20261023-101010_cafe";
const DIR = `_workspace/_runs/${ID}`;
const RUNNING = { runId: ID, status: "running", pid: 54321, adopted: [], name: "code-wave", startedAt: "2026-10-23T10:10:00.000Z" };
const DONE = { ...RUNNING, status: "done", endedAt: "2026-10-23T10:20:00.000Z", agents: { ok: 1, null: 0, cached: 0, tokens: 50, costUsd: 0.01 } };

// The runner ends the run after `ph archive --run` read run.json and before it kills the runner: the kill finds no process.
async function archiveRunEndingFirst(s) {
  const kill = process.kill;
  process.kill = (pid, signal) => {
    // pidAlive (signal 0) sees the runner alive at the read.
    if (pid === RUNNING.pid && signal === 0) return true;
    if (pid !== RUNNING.pid) return kill.call(process, pid, signal);
    s.project.writeJson(`${DIR}/run.json`, DONE);
    throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  };
  try {
    return await runOwn(["archive", "--run", ID, "--reason", "build hung"],{ project: s.project, fake: s.fake, clock: s.clock, env: s.env });
  } finally {
    process.kill = kill;
  }
}

test("G143 archive --run: a run that finishes before the kill keeps its done status, stats and single ledger line", async () => {
  const s = setup();
  s.project.writeJson(`${DIR}/run.json`, RUNNING);
  // The runner appended its own ledger record before it exited.
  s.project.write(METRICS_REL, `${JSON.stringify(runRecord(ID, DONE, [], null))}\n`);
  const r = await archiveRunEndingFirst(s);
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.ok(r.out.includes("could not stop runner pid 54321: kill ESRCH"), r.out.join("\n"));
  assert.deepEqual(s.project.readJson(`${DIR}/run.json`), DONE);
  const ledger = s.project.read(METRICS_REL).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(ledger.map((x) => [x.runId, x.status, x.stopReason ?? null]), [[ID, "done", null]]);
});

test("G143 archive --run: a run that finishes before the kill and never reached the ledger is recorded as done, from its own files", async () => {
  const s = setup();
  s.project.writeJson(`${DIR}/run.json`, RUNNING);
  s.project.writeJson(`${DIR}/result.json`, { status: "ok", gaps: [] });
  const r = await archiveRunEndingFirst(s);
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.deepEqual(s.project.readJson(`${DIR}/run.json`), DONE);
  const ledger = s.project.read(METRICS_REL).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(ledger.map((x) => [x.runId, x.status, x.stopReason ?? null, x.outcome]), [[ID, "done", null, { status: "ok", gaps: 0 }]]);
});
