// Bug-hunt regression (G137, 2026-10-23 hunt): ph archive --run must not follow a run directory that links out of the runs tree.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { assertErrLine, assertExit, assertLine, assertNoLine } from "../helpers/assert.mjs";
import { addSub, setup } from "../ph/setup.mjs";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("G137 archive --run refuses a run directory that is a junction out of the runs tree; nothing is killed or archived", async () => {
  const s = setup();
  const id = "wf_20261020-101010_abcd";
  const runner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  try {
    s.project.writeJson("outside elsewhere/run.json", { runId: id, status: "running", pid: runner.pid, adopted: [] });
    fs.mkdirSync(s.project.path("_workspace/_runs"), { recursive: true });
    fs.symlinkSync(s.project.path("outside elsewhere"), s.project.path(`_workspace/_runs/${id}`), "junction");
    addSub(s.fake, { title: "w:a", labels: { "harness.run": id } });
    const r = await s.ph(["archive", "--run", id]);
    assertExit(r, 1);
    assertErrLine(r, /^usage error: run wf_20261020-101010_abcd resolves outside /);
    assertNoLine(r, /stopped runner pid/);
    assert.ok(alive(runner.pid), "the runner behind the link was killed");
    assert.equal(s.project.readJson("outside elsewhere/run.json").status, "running");
    assert.deepEqual(s.fake.callsOf("archiveAgent"), []);
  } finally {
    runner.kill();
  }
});

test("G137 archive --run through a linked runs root still stops the run inside the real runs tree", async () => {
  const s = setup();
  const id = "wf_20261020-111111_beef";
  const runner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  try {
    s.project.writeJson(`outside runs/${id}/run.json`, { runId: id, status: "running", pid: runner.pid, adopted: [] });
    fs.symlinkSync(s.project.path("outside runs"), s.project.path("linked runs"), "junction");
    const r = await s.ph(["archive", "--run", id, "--runs-dir", "linked runs"]);
    assertExit(r, 0);
    assertLine(r, `stopped runner pid ${runner.pid}`);
    assert.equal(s.project.readJson(`outside runs/${id}/run.json`).status, "stopped");
  } finally {
    runner.kill();
  }
});
