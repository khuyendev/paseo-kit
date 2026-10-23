// G166: stopping a workflow run (ph archive --run) kills the shell commands its runner started, not only the runner.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { assertExit, assertLine } from "../helpers/assert.mjs";
import { makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";

const SHELL_MODULE = pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "workflow", "shell.mjs")).href;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 15000) {
  for (let t = 0; t < ms && !check(); t += 50) await sleep(50);
  assert.ok(check(), "timed out waiting for the shell command to start");
}

test("G166 archive --run stops the shell command of a live runner, not only the runner", async () => {
  const s = setup();
  const dir = makeTempDir("paseo kit g166 ");
  const runnerFile = path.join(dir, "runner.mjs");
  fs.writeFileSync(runnerFile, `import { runShell } from ${JSON.stringify(SHELL_MODULE)};\nawait runShell(process.env.G166_CMD, { timeoutS: 120 });\n`);
  // The command writes its pid, then a heartbeat file: it stays silent on stdout, so only the heartbeat shows it running.
  const beat = path.join(dir, "beat.txt");
  const script = "require('fs').writeFileSync(process.env.G166_BEAT + '.pid', String(process.pid));setInterval(() => require('fs').appendFileSync(process.env.G166_BEAT, 'x'), 100)";
  const env = { ...process.env, G166_CMD: `"${process.execPath}" -e "${script}"`, G166_BEAT: beat };
  const runner = spawn(process.execPath, [runnerFile], { env, stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
  const id = "wf_20261023-101010_g166";
  let shellPid = null;
  try {
    await until(() => fs.existsSync(`${beat}.pid`) && fs.existsSync(beat) && fs.statSync(beat).size > 0);
    shellPid = Number(fs.readFileSync(`${beat}.pid`, "utf8"));
    s.project.writeJson(`_workspace/_runs/${id}/run.json`, { runId: id, status: "running", pid: runner.pid, adopted: [] });
    const r = await s.ph(["archive", "--run", id]);
    assertExit(r, 0);
    assertLine(r, `stopped runner pid ${runner.pid}`);
    const size = fs.statSync(beat).size;
    await sleep(1000);
    assert.equal(fs.statSync(beat).size, size, "the shell command kept running after the run was stopped");
  } finally {
    runner.kill();
    if (shellPid) {
      try {
        process.kill(shellPid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
});
