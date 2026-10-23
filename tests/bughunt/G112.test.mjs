// G112: a debug create holds the create lock across its whole sequence (active scan, reopen, slug loop, write). The
// first create is paused after it picked its slug and before it writes; the second must wait for it and then reuse its
// session (same signature) or take the next free slug (same label), never write over the first session.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { project } from "../gsd-core/fixture.mjs";
import { testEnv } from "../helpers/env.mjs";

const COMMANDS = new URL("../../ship/.agents/harness/gsd/commands.mjs", import.meta.url).href;

// One `debug create` per thread, so the test thread stays free while the others wait on each other. A paused create
// stops once its slug is free, before the write, and waits for the test to release it through the shared gate.
const CREATE_WORKER = `
const { workerData, parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const { commands, env, root, stdin, pauseAt, gate } = workerData;
const flag = new Int32Array(gate);
if (pauseAt) {
  const realExists = fs.existsSync;
  let paused = false;
  fs.existsSync = (p) => {
    const found = realExists(p);
    if (!paused && !found && p === pauseAt) {
      paused = true;
      parentPort.postMessage({ signal: "paused" });
      Atomics.wait(flag, 1, 0);
    }
    return found;
  };
}
(async () => {
  const { runGsd } = await import(commands);
  const out = [];
  const err = [];
  parentPort.postMessage({ signal: "started" });
  const code = await runGsd(["debug", "create"], { env, root, stdin, out: (l) => out.push(l), err: (l) => err.push(l) });
  parentPort.postMessage({ result: { code, out: out.at(-1) ?? "", err: err.join("\\n") } });
})();
`;

const input = (errors, key = "auth.login") =>
  JSON.stringify({ signature: { kind: "test", key, label: "Login fails" }, symptoms: { expected: "200", actual: "500", errors, reproduction: "npm test", started: "today" }, owns: [], goal: "find_and_fix" });

// Starts a create thread; `reached` resolves on the signal `waitFor`, `result` on its outcome.
function startCreate(data, waitFor) {
  const worker = new Worker(CREATE_WORKER, { eval: true, workerData: { ...data, commands: COMMANDS, env: testEnv() } });
  const reached = new Promise((resolve, reject) => {
    worker.on("message", (m) => m.signal === waitFor && resolve());
    worker.on("error", reject);
  });
  const result = new Promise((resolve, reject) => {
    worker.on("message", (m) => m.result && resolve(m.result));
    worker.on("error", reject);
  });
  return { worker, reached, result };
}

// Pauses create A after it picked its slug, runs create B while A waits, then lets A write.
async function raceCreates(p, stdinA, stdinB) {
  const gate = new SharedArrayBuffer(8);
  const flag = new Int32Array(gate);
  const pauseAt = path.join(p.root, ".planning", "debug", "login-fails.md");
  const workers = [];
  try {
    const a = startCreate({ root: p.root, stdin: stdinA, pauseAt, gate }, "paused");
    workers.push(a.worker);
    await a.reached;
    const b = startCreate({ root: p.root, stdin: stdinB, gate }, "started");
    workers.push(b.worker);
    await b.reached;
    await new Promise((resolve) => setTimeout(resolve, 300));
    Atomics.store(flag, 1, 1);
    Atomics.notify(flag, 1);
    return { a: await a.result, b: await b.result };
  } finally {
    for (const worker of workers) await worker.terminate();
  }
}

test("G112 a second debug create for the same signature waits and reuses the session the first one wrote", async () => {
  const p = project();
  const { a, b } = await raceCreates(p, input("A: TypeError from login A"), input("B: TypeError from login B"));
  assert.equal(a.code, 0, a.err);
  const bJson = JSON.parse(b.out);
  assert.deepEqual([b.code, bJson.slug, bJson.reused], [0, "login-fails", true], b.err);
  assert.deepEqual(fs.readdirSync(path.join(p.root, ".planning", "debug")), ["login-fails.md"]);
  assert.match(p.read(".planning/debug/login-fails.md"), /A: TypeError from login A/);
  assert.doesNotMatch(p.read(".planning/debug/login-fails.md"), /B: TypeError/);
});

test("G112 two different signatures with one label get distinct slugs, not one overwriting the other", async () => {
  const p = project();
  const { a, b } = await raceCreates(p, input("A: TypeError from login A", "auth.login"), input("B: TypeError from login B", "auth.logout"));
  assert.equal(a.code, 0, a.err);
  const bJson = JSON.parse(b.out);
  assert.deepEqual([b.code, bJson.slug, bJson.reused], [0, "login-fails-2", false], b.err);
  assert.deepEqual(fs.readdirSync(path.join(p.root, ".planning", "debug")).sort(), ["login-fails-2.md", "login-fails.md"]);
  assert.match(p.read(".planning/debug/login-fails.md"), /A: TypeError from login A/);
  assert.match(p.read(".planning/debug/login-fails-2.md"), /B: TypeError from login B/);
});
