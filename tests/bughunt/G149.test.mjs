import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/temp.mjs";
import { meta, setup } from "../workflow/helpers.mjs";

// G149: a --detach token that is the value of a string option is data, not the detach flag; only the flag is dropped.
const detachedChildArgs = async (s, argv) => {
  const spawned = [];
  const fakeSpawn = (exe, args) => {
    spawned.push(args.slice(2));
    // detach() waits for the spawn event before it announces the start, as Node emits it for a real child.
    const child = Object.assign(new EventEmitter(), { pid: 4242, unref() {} });
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  const r = await s.ph(argv, { deps: { spawn: fakeSpawn } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(spawned.length, 1);
  return spawned[0];
};

test("G149 detach passes a --detach value of --script to the child and drops only the flag", async () => {
  const s = setup();
  s.project.write("--detach", `${meta()}return 1;`);
  const childArgs = await detachedChildArgs(s, ["workflow", "--script", "--detach", "--detach"]);
  const runId = childArgs[3];
  assert.deepEqual(childArgs, ["--script", "--detach", "--run-id", runId]);
  assert.ok(fs.existsSync(s.project.path(path.join("_workspace", "_runs", runId, "run.json"))));
});

test("G149 detach passes a --detach value of --runs-dir to the child and drops only the flag", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const childArgs = await detachedChildArgs(s, ["workflow", "--script", "wf.js", "--runs-dir", "--detach", "--detach"]);
  const runId = childArgs[5];
  assert.deepEqual(childArgs, ["--script", "wf.js", "--runs-dir", "--detach", "--run-id", runId]);
  assert.ok(fs.existsSync(s.project.path(path.join("--detach", runId, "run.json"))));
});

test("G149 detach keeps a --detach value given with an explicit --run-id", async () => {
  const s = setup();
  s.project.write("--detach", `${meta()}return 1;`);
  const runsDir = path.join(makeTempDir(), "runs");
  const childArgs = await detachedChildArgs(s, ["workflow", "--script", "--detach", "--detach", "--runs-dir", runsDir, "--run-id", "wf_g149"]);
  assert.deepEqual(childArgs, ["--script", "--detach", "--runs-dir", runsDir, "--run-id", "wf_g149"]);
});
