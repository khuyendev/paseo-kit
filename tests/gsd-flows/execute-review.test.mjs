// gsd-execute.js: review gate, fixer, execution modes, attribution, change requests, commits and branching.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { NULL, runScript } from "./host.mjs";
import { executor, makeExecWorld, task } from "./exec-world.mjs";
import { PHASE_DIR } from "./world.mjs";

const NODE = process.execPath;
const exec = (w, args = {}, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const finding = (id, extra = {}) => ({ id, severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 1, description: `finding ${id}`, ...extra });
// Gate test command: red while fail.flag exists, naming the file given in the flag.
const FLAG_TEST = [NODE, "-e", "const fs=require('fs');if(fs.existsSync('fail.flag')){console.log('error '+fs.readFileSync('fail.flag','utf8').trim());process.exit(1)}"];

test("GSDF-46 untriggered and low-confidence highs are downgraded; an unverifiable high escalates; resolution lists only confirmed findings", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const findings = { findings: [finding("F1", { trigger: "" }), finding("F2", { confidence: 70 }), finding("F3")] };
  const r = await exec(w, {}, { "review-": () => findings, "verify-findings": () => NULL("finished without a reply") });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Review"]);
  assert.equal(labels(r).filter((l) => l.startsWith("verify-findings")).length, 2);
  const rec = w.read(`${PHASE_DIR}/review/w1-01-01.json`);
  assert.deepEqual(JSON.parse(rec).findings.map((f) => [f.id, f.status, f.verdict]), [["F1", "downgraded", null], ["F2", "downgraded", null], ["F3", "gated", "unverified"]]);
  assert.equal(labels(r).some((l) => l.startsWith("fix-review")), false);
  const w2 = makeExecWorld({ waves: [[task("01-01")]] });
  const ok = await exec(w2, {}, { "review-": () => findings });
  assert.equal(ok.result.status, "executed");
  const resolve = ok.calls.find((c) => c.opts.label === "resolve-01-01").prompt;
  assert.match(resolve, /"id":"F3"/);
  assert.doesNotMatch(resolve, /"id":"F1"|"id":"F2"/);
  assert.ok(labels(ok).indexOf("fix-review-w1") < labels(ok).indexOf("resolve-01-01"));
});

test("GSDF-47 no reviewer runs on a red per-wave build; batch reviews are code-only and resolve after the final green gate", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { max_verify_rounds: 1 } } });
  w.write("fail.flag", "x");
  const red = await exec(w, {}, { "fix-": () => ({ taskResults: [] }), "integration-fix": () => ({ status: "unresolved" }) });
  assert.equal(labels(red).some((l) => l.startsWith("review-")), false);
  const b = makeExecWorld({ overlay: { gsd: { execution_mode: "batch" } } });
  const r = await exec(b, {}, { "review-01-01": () => ({ findings: [finding("F9")] }) });
  assert.equal(r.result.status, "executed");
  assert.equal(JSON.parse(b.read(`${PHASE_DIR}/review/w1-01-01.json`)).codeOnly, true);
  const ev = r.result.events;
  assert.ok(ev.indexOf("gate batch green") < ev.indexOf("resolution batch"));
});

test("GSDF-48 normal findings never block: deferred.md gets them and the review run one metrics line", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w, {}, { "review-": () => ({ findings: [finding("N1", { severity: "medium" }), finding("N2", { severity: "low" })] }) });
  assert.equal(r.result.status, "executed");
  const deferred = w.read(`${PHASE_DIR}/deferred.md`).trim().split("\n");
  assert.equal(deferred.length, 2);
  assert.match(deferred[0], /^- N1 \(medium, deferred\) plan 01-01 src\/01-01\/impl\.js:1: finding N1/);
  const metrics = w.read("_workspace/review-metrics.jsonl").trim().split("\n");
  assert.equal(metrics.length, 1);
  assert.equal(JSON.parse(metrics[0]).deferred, 2);
});

test("GSDF-49 batch event order with and without batch_review; the wave results say verify skipped; a red tracer starts no later wave", async () => {
  const order = async (batchReview) => {
    const w = makeExecWorld({ overlay: { gsd: { execution_mode: "batch", batch_review: batchReview }, adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: FLAG_TEST, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
    const r = await exec(w, {}, { "exec-01-02": async (p, o, n, calls) => { w.write("fail.flag", "src/01-02/impl.js"); } });
    return r;
  };
  const on = await order(true);
  assert.equal(on.result.status, "executed");
  assert.deepEqual(on.result.events.filter((e) => !e.startsWith("commit")), ["code w1 01-01", "code w1 01-02", "review w1 01-01 code-only", "review w1 01-02 code-only", "review phase 01-phase code-only", "gate batch red (1)", "fixer batch-fixer", "gate batch green", "resolution batch"]);
  assert.deepEqual(on.result.waves.map((x) => x.verify), ["skipped"]);
  assert.equal(labels(on).filter((l) => l === "batch-fixer").length, 1);
  const off = await order(false);
  assert.deepEqual(off.result.events.filter((e) => e.startsWith("review")), ["review phase 01-phase code-only"]);
  const t = makeExecWorld({ waves: [[task("01-01", { tracer: true })], [task("01-02")]], meta: { "01-02": { depends: ["01-01"] } }, overlay: { gsd: { max_verify_rounds: 1 } } });
  t.write("fail.flag", "x");
  const tr = await exec(t, {}, { "fix-": () => ({ taskResults: [] }), "integration-fix": () => ({ status: "unresolved" }) });
  assert.match(tr.result.reason, /tracer wave is red .*no later wave starts/);
  assert.equal(labels(tr).includes("exec-01-02"), false);
});

test("GSDF-50 the fixer runtime block follows fixer_verifies_itself; unresolved or a deadline stop needs the owner", async () => {
  const prompts = {};
  for (const flag of [true, false]) {
    const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { fixer_verifies_itself: flag } } });
    const r = await exec(w, {}, { "review-": () => ({ findings: [finding("F1")] }) });
    const fx = r.calls.find((c) => c.opts.label === "fix-review-w1");
    prompts[flag] = fx.prompt;
    assert.equal(fx.opts.timeoutS, (60 + 5) * 60);
    assert.equal(fx.opts.role, "fixer");
  }
  assert.match(prompts[true], /run the build \(\[.*\]\) and the tests \(.*\) yourself, at most 3 times and within 60 minutes; stop early when two consecutive attempts do not reduce the failure count/);
  assert.match(prompts[false], /Do not run the build or the tests: the orchestrator's gate verifies/);
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const un = await exec(w, {}, { "review-": () => ({ findings: [finding("F1")] }), "fix-review": () => ({ status: "unresolved", attempts: 3, remaining_failures: 2, evidence: "build red" }) });
  assert.deepEqual([un.result.status, un.result.evidence], ["needs-owner", "build red"]);
  const hang = await exec(makeExecWorld({ waves: [[task("01-01")]] }), {}, { "review-": () => ({ findings: [finding("F1")] }), "fix-review": () => NULL("no reply within 3900 s") });
  assert.match(hang.result.reason, /fixer stopped or timed out: no reply within 3900 s/);
});

test("GSDF-51 a failure in one plan's file goes to that plan's executor session only; unplaced ones to one integration fixer", async () => {
  const w = makeExecWorld({ overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: FLAG_TEST, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  w.write("lib.txt", "l\n");
  w.git("add", "-A"); w.git("commit", "-qm", "lib");
  const r = await exec(w, {}, { "exec-01-02": () => { w.write("fail.flag", "src/01-01/impl.js"); } });
  const fixes = labels(r).filter((l) => l.startsWith("fix-01") || l.startsWith("integration-fix"));
  assert.deepEqual(fixes, ["fix-01-01-1"]);
  assert.equal(r.calls.find((c) => c.opts.label === "fix-01-01-1").opts.session, "executor:01-01");
  const u = makeExecWorld({ overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: FLAG_TEST, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  u.write("lib.txt", "l\n"); u.git("add", "-A"); u.git("commit", "-qm", "lib");
  const r2 = await exec(u, {}, { "exec-01-02": () => { u.write("fail.flag", "lib.txt"); } });
  const fx = r2.calls.find((c) => c.opts.label === "integration-fix-1");
  assert.match(fx.prompt, /You own exactly these files: \["lib\.txt"\]/);
});

test("GSDF-52 a cross-plan request reaches the owner plan's next fix prompt; an unowned path becomes a shared change", async () => {
  const w = makeExecWorld({ overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: FLAG_TEST, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  const run = executor(w);
  const r = await exec(w, {}, {
    "exec-01-01": async (p, o, n, calls) => { const v = await run(p, o, n, calls); w.write("fail.flag", "src/01-02/impl.js"); return { ...v, requests: [{ path: "src/01-02/api.js", change: "export x", reason: "needed" }, { path: "config/app.json", change: "add key", reason: "shared" }] }; },
  });
  const fix = r.calls.find((c) => c.opts.label === "fix-01-02-1");
  assert.match(fix.prompt, /Change requests from other plans of this wave \(JSON\): .*"path":"src\/01-02\/api\.js"/);
  assert.deepEqual(r.result.sharedChanges.map((s) => s.path), ["config/app.json"]);
});

test("GSDF-53 per-wave commits carry the wave subject, the Plans trailer and a commits.json entry; per-plan commits one per plan", async () => {
  const w = makeExecWorld();
  await exec(w);
  assert.equal(w.git("log", "-1", "--format=%B").stdout.trim(), "feat(01-w1): phase 01 wave 1\n\nPlans: 01-01,01-02");
  const entry = JSON.parse(w.read(`${PHASE_DIR}/commits.json`))[0];
  assert.equal(entry.sha, w.git("rev-parse", "HEAD").stdout.trim());
  assert.deepEqual(entry.plans["01-01"].sort(), [`${PHASE_DIR}/01-01-SUMMARY.md`, "src/01-01/impl.js"]);
  assert.match(w.git("show", "--name-only", "--format=", "HEAD").stdout, /01-02-SUMMARY\.md/);
  const p = makeExecWorld({ overlay: { gsd: { commit_policy: { docs: false, code: "per-plan" } } } });
  await exec(p);
  assert.deepEqual(p.git("log", "-2", "--format=%s").stdout.trim().split("\n"), ["feat(01-02): phase 01 plan 01-02", "feat(01-01): phase 01 plan 01-01"]);
});

test("GSDF-54 branching phase starts from origin/<default>, not HEAD; a failed fetch without the ref aborts", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { branching: "phase" } } });
  const bare = path.join(makeTempDir(), "origin.git");
  fs.mkdirSync(bare);
  spawnGit(bare, "init", "-q", "--bare");
  w.git("remote", "add", "origin", bare);
  w.git("push", "-q", "origin", "main");
  const originHead = w.git("rev-parse", "HEAD").stdout.trim();
  w.write("local.txt", "ahead\n"); w.git("add", "-A"); w.git("commit", "-qm", "local only");
  w.git("update-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  w.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const r = await exec(w);
  assert.equal(w.git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim(), "gsd/phase-01-core");
  assert.equal(w.git("merge-base", "--is-ancestor", "main", "HEAD").status, 1);
  assert.equal(w.git("merge-base", "--is-ancestor", originHead, "HEAD").status, 0);
  assert.ok(r.logs.includes("log branch gsd/phase-01-core from origin/main"));
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.ok(labels(r).includes("exec-01-01"));
  assert.equal(JSON.parse(w.read(`${PHASE_DIR}/commits.json`)).length, 1);
  const f = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { branching: "phase" } } });
  f.git("remote", "add", "origin", path.join(makeTempDir(), "missing.git"));
  const bad = await exec(f);
  assert.equal(bad.result.status, "failed");
  assert.equal(f.git("rev-parse", "--verify", "--quiet", "refs/heads/gsd/phase-01-core").status, 1);
});

const spawnGit = (cwd, ...args) => spawnSync("git", args, { cwd, windowsHide: true });
