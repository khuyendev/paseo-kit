import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { meta, setup } from "../workflow/helpers.mjs";

// A detached start whose spawn fails must end its run record as failed, not leave it running with the parent's pid.

test("G128 a detached spawn that throws ends the run as failed, exit 2, no start line", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const throwingSpawn = () => {
    throw new Error("simulated spawn failure");
  };
  const r = await s.ph(["workflow", "--script", "wf.js", "--detach", "--run-id", "wf_sync"], { deps: { spawn: throwingSpawn } });
  assert.equal(r.code, 2, r.stderr);
  assert.deepEqual(r.out, ["workflow failed wf_sync: simulated spawn failure"]);
  const info = JSON.parse(fs.readFileSync(s.project.path("_workspace/_runs/wf_sync/run.json"), "utf8"));
  assert.equal(info.status, "failed");
  assert.equal(info.error, "simulated spawn failure");
  assert.equal(info.endedAt, new Date(s.clock.now()).toISOString());
});

test("G128 a detached spawn whose binary is missing (async 'error' event) ends the run as failed, exit 2, no start line", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const missingSpawn = (exe, args, opts) => spawn("no-such-binary-g128", args, opts);
  const r = await s.ph(["workflow", "--script", "wf.js", "--detach", "--run-id", "wf_async"], { deps: { spawn: missingSpawn } });
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^workflow failed wf_async: .*ENOENT/);
  const info = JSON.parse(fs.readFileSync(s.project.path("_workspace/_runs/wf_async/run.json"), "utf8"));
  assert.equal(info.status, "failed");
  assert.match(info.error, /ENOENT/);
  assert.equal(info.endedAt, new Date(s.clock.now()).toISOString());
});
