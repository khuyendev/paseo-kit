import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runGsd } from "../../ship/.agents/harness/gsd/commands.mjs";
import { testEnv } from "../helpers/env.mjs";
import { executor, makeExecWorld, task } from "./exec-world.mjs";
import { NULL, runScript } from "./host.mjs";
import { PHASE_DIR as PD } from "./world.mjs";

const exec = (w, overrides = {}, args = {}, runId = "wf_review") => runScript("gsd-execute", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, ...args }, agent: executor(w, overrides), runId });
const summary = (id) => `${PD}/${id}-SUMMARY.md`;
const finding = { id: "F1", severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", description: "missing guard" };
const one = (overlay = {}) => makeExecWorld({ waves: [[task("01-01")]], overlay });
const real = (w, key) => w.gsd.on(key, async (_a, input, argv) => {
  const lines = [];
  const code = await runGsd(argv, { root: w.root, env: testEnv(), stdin: input, out: (l) => lines.push(l), err() {} });
  return { code, json: JSON.parse(lines.at(-1)) };
});

test("GSDF-38 CR-GSF-01 two waves finish with the real evaluation-scope verb", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]], meta: { "01-02": { depends: ["01-01"] } } });
  real(w, "check evaluation-scope");
  const r = await exec(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.deepEqual(r.calls.filter((c) => c.opts.label.startsWith("exec-")).map((c) => c.opts.label), ["exec-01-01", "exec-01-02"]);
  assert.equal(JSON.parse(w.read(`${PD}/commits.json`)).length, 2);
});

test("GSDF-43 CR-GSF-02 a SUMMARY after a failed review rejoins gates instead of routing straight to verify", async () => {
  const w = one();
  const first = await exec(w, { "review-": () => NULL("quota exhausted") });
  assert.equal(first.result.status, "needs-owner");
  assert.ok(w.read(summary("01-01")));
  const again = await exec(w);
  assert.equal(again.result.status, "executed", JSON.stringify(again.result));
  assert.equal(again.calls.some((c) => c.opts.label.startsWith("exec-")), false);
  assert.ok(again.result.events.includes("gate w1 green"));
  assert.ok(again.calls.some((c) => c.opts.label === "review-01-01"));
  assert.equal(JSON.parse(w.read(`${PD}/commits.json`)).length, 1);
});

test("GSDF-43 CR-GSF-02 partial successful waves retain the successful plan in their gates and commits", async () => {
  const w = makeExecWorld();
  const first = await exec(w, { "exec-01-02": () => NULL("quota exhausted") });
  assert.equal(first.result.status, "needs-owner");
  fs.rmSync(path.join(w.root, `${PD}/01-02-HALT.json`));
  const again = await exec(w);
  assert.equal(again.result.status, "executed", JSON.stringify(again.result));
  assert.deepEqual(again.calls.filter((c) => c.opts.label.startsWith("exec-")).map((c) => c.opts.label), ["exec-01-02"]);
  assert.deepEqual(Object.keys(JSON.parse(w.read(`${PD}/commits.json`))[0].plans), ["01-01", "01-02"]);
});

test("GSDF-41 CR-GSF-03 worktrees read uncommitted plans from immutable input snapshots and refuse owner edits", async () => {
  const w = one({ gsd: { isolation: "worktree" } });
  w.write(`${PD}/01-01-PLAN.md`, w.read(`${PD}/01-01-PLAN.md`) + "\nnew planning input\n");
  const r = await exec(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const inputPath = /Plan: (.*)/.exec(r.calls[0].prompt)[1];
  assert.match(inputPath, /_workspace\/gsd-inputs\/[a-f0-9]{64}/);
  assert.match(fs.readFileSync(inputPath, "utf8"), /new planning input/);
  w.write(`${PD}/01-01-PLAN.md`, "changed again");
  assert.match(fs.readFileSync(inputPath, "utf8"), /new planning input/);
  const owner = one({ gsd: { isolation: "worktree" } });
  owner.write("src/01-01/.keep", "owner edit");
  const refused = await exec(owner);
  assert.equal(refused.calls.length, 0);
  assert.equal(refused.result.status, "needs-owner");
  assert.equal(owner.read("src/01-01/.keep"), "owner edit");
});

test("GSDF-49 CR-GSF-04 worktree executor continuations keep isolation and transfer the repair", async () => {
  const commands = { build: [process.execPath, "-e", "process.exit(0)"], test: [process.execPath, "-e", "const f=require('fs');if(!f.readFileSync('src/01-01/impl.js','utf8').includes('fixed')){console.log('error src/01-01/impl.js');process.exit(1)}"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
  const w = one({ gsd: { isolation: "worktree" }, adapter: { commands } });
  const r = await exec(w, { "fix-01-01": (_p, _o, n, calls) => {
    w.write(`${calls.find((c) => c.n === n).worktree}/src/01-01/impl.js`, "fixed\n");
    return { taskResults: [{ task: "1", status: "implemented" }] };
  } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const calls = r.calls.filter((c) => c.opts.session === "executor:01-01");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.opts.isolation === "worktree"));
  assert.equal(w.git("show", "HEAD:src/01-01/impl.js").stdout, "fixed\n");
});

test("GSDF-53 CR-GSF-06 failed code commits and failed commit records never advance tracking", async () => {
  const w = one();
  w.gsd.on("commit", () => ({ code: 1, json: { error: "hook rejected" } }));
  const r = await exec(w);
  assert.equal(r.result.stage, "Commit");
  assert.match(r.result.reason, /hook rejected/);
  assert.equal(w.gsd.callsOf("state wave").length, 0);
  const record = one();
  const original = record.gsd.handlers.commit;
  record.gsd.on("commit", (argv) => { const c = original(argv); fs.mkdirSync(path.join(record.root, `${PD}/commits.json`)); return c; });
  const failed = await exec(record);
  assert.equal(failed.result.stage, "Commit");
  assert.match(failed.result.reason, /commits.json was not updated/);
  assert.equal(record.gsd.callsOf("state wave").length, 0);
});

test("GSDF-53 CR-GSF-07 a worktree review fixer adds owned files to the committed manifest", async () => {
  const w = one({ gsd: { isolation: "worktree" } });
  const r = await exec(w, {
    "review-": () => ({ findings: [finding] }),
    "fix-review": () => { w.write("src/01-01/regression.test.js", "new regression\n"); return { status: "fixed" }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(w.git("show", "HEAD:src/01-01/regression.test.js").stdout, "new regression\n");
  assert.ok(JSON.parse(w.read(`${PD}/commits.json`))[0].plans["01-01"].includes("src/01-01/regression.test.js"));
});

test("GSDF-41 CR-GSF-08 separate declared deletions stay in their own per-plan commits", async () => {
  const ts = ["01-01", "01-02"].map((id) => task(id, { files_deleted: [`src/${id}/old.js`] }));
  const w = makeExecWorld({ waves: [ts], overlay: { gsd: { isolation: "worktree", commit_policy: { docs: false, code: "per-plan" } } } });
  for (const t of ts) w.write(t.files_deleted[0], "old\n");
  w.git("add", "-A"); w.git("commit", "-qm", "old files");
  const r = await exec(w, { "exec-": (_p, o, n, calls) => { fs.rmSync(path.join(w.root, calls.find((c) => c.n === n).worktree, `src/${o.label.slice(5)}/old.js`)); } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const map = JSON.parse(w.read(`${PD}/commits.json`));
  for (const [i, t] of ts.entries()) {
    assert.ok(map[i].plans[t.plan].includes(t.files_deleted[0]));
    assert.equal(w.git("show", "--format=", "--diff-filter=D", "--name-only", map[i].sha).stdout.trim(), t.files_deleted[0]);
  }
});

test("GSDF-49 CR-GSF-10 phase review still calls a reviewer for the whole phase with batch_review off", async () => {
  const w = makeExecWorld({ overlay: { gsd: { execution_mode: "batch", batch_review: false } } });
  const r = await exec(w);
  assert.equal(r.result.status, "executed");
  const reviews = r.calls.filter((c) => c.opts.role === "reviewer");
  assert.equal(reviews.length, 1);
  assert.match(reviews[0].prompt, /src\/01-01\/impl.js/);
  assert.match(reviews[0].prompt, /src\/01-02\/impl.js/);
});

test("GSDF-30 CR-GSF-15 the same partially completed gap wave resumes but a fresh gap run cannot", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], prefix: "gap-", meta: { "01-01": { gap: true }, "01-02": { gap: true } } });
  real(w, "attempt show"); real(w, "attempt record");
  await w.gsd.call(["attempt", "record", PD, "--kind", "gap"], JSON.stringify({ runId: "wf_plan", inputDigest: "a".repeat(64), before: "b".repeat(64), done: true, result: { waveExecuted: false } }));
  const first = await exec(w, { "exec-01-02": () => NULL("quota exhausted") }, { gapsOnly: true });
  assert.equal(first.result.status, "needs-owner");
  fs.rmSync(path.join(w.root, `${PD}/01-02-HALT.json`));
  const fresh = await exec(w, {}, { gapsOnly: true }, "wf_fresh");
  assert.equal(fresh.calls.length, 0);
  const resumed = await exec(w, {}, { gapsOnly: true });
  assert.equal(resumed.result.status, "executed", JSON.stringify(resumed.result));
  assert.deepEqual(resumed.calls.filter((c) => c.opts.label.startsWith("exec-")).map((c) => c.opts.label), ["exec-01-02"]);
});

test("GSDF-46 CR-GSF-16 fatal finding-verifier failures never retry", async () => {
  const w = one();
  const r = await exec(w, { "review-": () => ({ findings: [finding] }), "verify-findings": () => NULL("auth failed") });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("verify-findings")).length, 1);
  assert.equal(w.gsd.callsOf("commit").length, 0);
});

test("GSDF-92 CR-GSF-17 unknown severities and failed review record writes stop before commit", async () => {
  const w = one();
  const r = await exec(w, { "review-": () => ({ findings: [{ ...finding, severity: "blocker" }] }) });
  assert.match(r.result.reason, /unknown severities/);
  assert.equal(w.gsd.callsOf("commit").length, 0);
  const blocked = one();
  blocked.write(`${PD}/review`, "not a directory");
  const failed = await exec(blocked);
  assert.match(failed.result.reason, /review record .* refused/);
  assert.equal(blocked.gsd.callsOf("commit").length, 0);
});
