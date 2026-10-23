// Kit feedback #66 (O66A, points 1 and 2): gsd.execute_schedule graph starts a plan when the plans it waits for are
// committed, runs its obligations, review, fix and resolution on that plan alone, and commits through one queue that
// runs the repo-wide suite first. The default (waves) keeps the wave-by-wave flow.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const graph = (gsd = {}) => ({ gsd: { execute_schedule: "graph", ...gsd } });
const run = (w, overrides = {}, args = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
// Resolves when cond() holds, polling; rejects after a while so a broken schedule fails the test instead of hanging it.
const until = (cond, ms = 20000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (cond() ? resolve() : Date.now() - t0 > ms ? reject(new Error("condition not reached")) : setTimeout(tick, 20));
  tick();
});
const progressOf = (w) => JSON.parse(w.read(`${PHASE_DIR}/execute-progress.json`));

test("O66A gsd.execute_schedule defaults to waves and validates; another value is rejected", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.equal(defaults.gsd.execute_schedule, "waves");
  assert.doesNotThrow(() => validateAgainstSchema({ ...defaults, gsd: { ...defaults.gsd, execute_schedule: "graph" } }));
  assert.throws(() => validateAgainstSchema({ ...defaults, gsd: { ...defaults.gsd, execute_schedule: "dag" } }), /execute_schedule/);
});

test("O66A schedule-graph: depends_on, owns and files_modified overlaps with earlier plans, tracers of earlier waves; a cycle is refused", async () => {
  const p = makeTempProject({ files: {} });
  const plans = [
    { id: "02-01", wave: 1, depends_on: [], owns: ["Path:lib/session/", ".planning/phases/02-x/02-01-SUMMARY.md"], files_modified: [], tracer: true },
    { id: "02-02", wave: 2, depends_on: [], owns: ["Path:lib/crypto/"], files_modified: [], tracer: false },
    { id: "02-03", wave: 2, depends_on: [], owns: ["Path:lib/hosts/"], files_modified: ["lib/main.dart"], tracer: false },
    { id: "02-04", wave: 3, depends_on: ["02-01"], owns: ["Path:lib/session/daemon_session.dart"], files_modified: [], tracer: false },
    { id: "02-05", wave: 3, depends_on: [], owns: ["Path:lib/relay/"], files_modified: ["lib/main.dart"], tracer: false },
  ];
  const r = await flow(p.root, ["schedule-graph"], { plans });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.deps, { "02-01": [], "02-02": ["02-01"], "02-03": ["02-01"], "02-04": ["02-01"], "02-05": ["02-01", "02-03"] });
  assert.deepEqual(r.json.reasons["02-04"].map((x) => x.why), ["depends_on", "tracer", "owns overlap"]);
  assert.deepEqual(r.json.reasons["02-05"].find((x) => x.on === "02-03"), { on: "02-03", why: "files_modified overlap" });
  assert.equal(r.json.cycle, null);
  const loop = await flow(p.root, ["schedule-graph"], { plans: [{ id: "02-01", wave: 1, depends_on: ["02-02"], owns: ["Path:a/"] }, { id: "02-02", wave: 2, depends_on: ["02-01"], owns: ["Path:b/"] }] });
  assert.equal(loop.code, 1);
  assert.deepEqual(loop.json.cycle, ["02-01", "02-02", "02-01"]);
});

test("O66A the gate input suite false runs only obligations; context plans take the failures in their files", async () => {
  const commands = { build: [NODE, "-e", "process.exit(1)"], test: [NODE, "-e", "console.log('error src/b/y.js:2: boom');process.exit(1)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
  const p = makeTempProject({ files: { "src/a/x.js": "x\n", "src/b/y.js": "y\n" }, overlay: { adapter: { commands } } });
  const a = { id: "03-01", owns: ["Path:src/a/"], verify: [{ task: "1", kind: "cmd", command: "cmd: node -v" }] };
  const only = await flow(p.root, ["gate", ".planning/phases/03-api"], { waveId: "w1-03-01", plans: [a], suite: false });
  assert.equal(only.json.green, true, JSON.stringify(only.json.failures));
  const ev = JSON.parse(fs.readFileSync(path.join(p.root, only.json.evidence), "utf8"));
  assert.equal(ev.suite, false);
  assert.deepEqual(ev.steps.map((s) => s.name).filter((n) => ["build", "test"].includes(n)), []);
  const suite = await flow(p.root, ["gate", ".planning/phases/03-api"], { waveId: "join", plans: [{ ...a, verify: [] }], context: [{ id: "03-02", owns: ["Path:src/b/"] }] });
  assert.equal(suite.json.green, false);
  assert.deepEqual(suite.json.byPlan["03-02"].map((f) => f.step), ["test"]);
  assert.deepEqual(suite.json.unplaced.map((f) => f.step), ["build"]);
});

test("O66A graph: a plan starts when the plans it depends on are committed, not when its whole wave is", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")], [task("01-03")]], meta: { "01-03": { depends: ["01-01"] } }, overlay: graph({ isolation: "worktree" }) });
  // 01-02 (wave 1) finishes only after 01-03 (wave 2) has started: with wave barriers that would never happen.
  const r = await run(w, {
    "exec-01-02": async (p, o, n, calls) => { await until(() => calls.some((c) => c.opts.label === "exec-01-03")); },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.result.schedule, "graph");
  const at = (e) => r.result.order.findIndex((x) => x === e || (x.startsWith("commit ") && e.startsWith("commit ") && x.slice(7).split(",").includes(e.slice(7))));
  assert.ok(at("commit 01-01") < at("start 01-03"), JSON.stringify(r.result.order));
  assert.ok(at("start 01-03") < at("commit 01-02"), JSON.stringify(r.result.order));
  assert.deepEqual([...r.result.committed].sort(), ["01-01", "01-02", "01-03"]);
  const prog = progressOf(w);
  for (const id of ["01-01", "01-02", "01-03"]) assert.equal(prog.plans[id].tracked, true, id);
  // One phase gate over every plan is the run's evidence, as in the waves schedule (F58).
  assert.equal(r.result.evidence.length, 1);
  assert.match(r.result.evidence[0], /\/evidence\/batch-1\.json$/);
  // Every commit ran after a green repo-wide suite.
  assert.ok(r.result.events.filter((e) => e.startsWith("gate join")).every((e) => e.endsWith("green")), JSON.stringify(r.result.events));
  const log = w.git("log", "--format=%s%n%b").stdout;
  for (const id of ["01-01", "01-02", "01-03"]) assert.match(log, new RegExp(`Plans: (\\S+,)*${id}`));
});

test("O66A graph: a red plan stops alone; independent plans commit, its dependants are skipped; the rerun resumes only what is left", async () => {
  const obligation = [{ task: "1", kind: "cmd", command: `cmd: node -e "process.exit(require('fs').existsSync('src/01-01/ok.txt')?0:1)"`, target: null }];
  const w = makeExecWorld({ waves: [[task("01-01", { verify: obligation }), task("01-02")], [task("01-03")]], meta: { "01-03": { depends: ["01-01"] } }, overlay: graph() });
  const tried = { taskResults: [{ task: "1", status: "implemented", evidence: "tried" }], deviations: [], requests: [] };
  const r1 = await run(w, { "fix-01-01": () => tried });
  assert.equal(r1.result.status, "needs-owner", JSON.stringify(r1.result));
  assert.equal(r1.result.stage, "Gate");
  assert.match(r1.result.reason, /plan 01-01|stalled/);
  assert.deepEqual(r1.result.committed, ["01-02"]);
  assert.deepEqual(r1.result.stopped.map((s) => s.plans), [["01-01"]]);
  assert.deepEqual(r1.result.skipped.map((s) => [s.plan, s.why]), [["01-03", "blocked by 01-01"]]);
  assert.equal(r1.calls.filter((c) => c.opts.label === "exec-01-03").length, 0, "a dependant of a stopped plan never starts");
  assert.equal(progressOf(w).plans["01-02"].tracked, true);
  assert.equal(progressOf(w).plans["01-01"], undefined);

  // The owner makes the check pass; the rerun takes 01-01 (SUMMARY kept) straight to its checks, then 01-03 starts.
  w.write("src/01-01/ok.txt", "ok\n");
  const r2 = await run(w);
  assert.equal(r2.result.status, "executed", JSON.stringify(r2.result));
  const labels = r2.calls.map((c) => c.opts.label);
  assert.equal(labels.includes("exec-01-01"), false, "a coded plan gets no new executor");
  assert.equal(labels.includes("exec-01-02"), false, "a committed plan is not run again");
  assert.equal(labels.includes("exec-01-03"), true);
  assert.deepEqual([...r2.result.committed].sort(), ["01-01", "01-03"]);
  assert.ok(r2.logs.some((l) => l.includes("plan 01-01: SUMMARY present but not committed")), r2.logs.join("\n"));
});

test("O66A graph: a suite failure in another open plan's file makes the batch wait for that plan; the two commit together", async () => {
  // The repo-wide test fails while 01-02's impl.js says "bad"; 01-02's fixer repairs it in its worktree.
  const test = [NODE, "-e", "const s=require('fs').existsSync('src/01-02/impl.js')?require('fs').readFileSync('src/01-02/impl.js','utf8'):'';if(s.includes('bad')){console.log('error src/01-02/impl.js:1: bad');process.exit(1)}"];
  const commands = { build: [NODE, "-e", "process.exit(0)"], test, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { ...graph({ isolation: "worktree" }), adapter: { commands } } });
  const wtOf = (calls, n) => calls.find((c) => c.n === n).worktree;
  const r = await run(w, {
    "exec-01-02": (p, o, n, calls) => {
      w.write(`${wtOf(calls, n)}/src/01-02/impl.js`, "impl 01-02 bad\n");
      w.write(`${wtOf(calls, n)}/${PHASE_DIR}/01-02-SUMMARY.md`, "---\nkey-files:\n  created: [src/01-02/impl.js]\n---\ndone\n");
      return { taskResults: [{ task: "1", status: "implemented", evidence: "ok" }], deviations: [], requests: [] };
    },
    // 01-02 reaches the queue only after 01-01's first suite ran.
    "review-01-02": async () => { await until(() => fs.existsSync(path.join(w.root, PHASE_DIR, "evidence", "join-1.json"))); },
    "fix-01-02": (p, o, n, calls) => { w.write(`${wtOf(calls, n)}/src/01-02/impl.js`, "impl 01-02 fixed\n"); return { taskResults: [{ task: "1", status: "implemented", evidence: "fixed" }], deviations: [], requests: [] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.ok(r.logs.some((l) => /commit queue: the suite fails only in files of open plans 01-02; 01-01 wait/.test(l)), r.logs.join("\n"));
  assert.ok(r.result.order.includes("commit 01-01,01-02"), JSON.stringify(r.result.order));
  assert.equal(w.read("src/01-02/impl.js"), "impl 01-02 fixed\n");
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("fix-01-01")).length, 0, "01-01 is never asked to fix 01-02's failure");
});

test("O66A graph: an obligation red only in another open plan's file is not dropped: the suite of the commit runs it again", async () => {
  const bad = "const s=require('fs').existsSync('src/01-02/impl.js')?require('fs').readFileSync('src/01-02/impl.js','utf8'):'';if(s.includes('bad')){console.log('error src/01-02/impl.js:1: bad');process.exit(1)}";
  const obligation = [{ task: "1", kind: "cmd", command: `cmd: node -e "${bad}"`, target: null }];
  // Two reviews at once: 01-02's review is held open until 01-01's commit suite ran.
  const w = makeExecWorld({ waves: [[task("01-01", { verify: obligation }), task("01-02")]], overlay: graph({ isolation: "worktree", code_review: { max_concurrent: 2, reviewers: [] } }) });
  const wtOf = (calls, n) => calls.find((c) => c.n === n).worktree;
  const r = await run(w, {
    // 01-02's bad code is in the main tree before 01-01's own check runs.
    "exec-01-01": async (p, o, n, calls) => { await until(() => fs.existsSync(path.join(w.root, PHASE_DIR, "transfers", "01-02.json"))); },
    "exec-01-02": (p, o, n, calls) => {
      w.write(`${wtOf(calls, n)}/src/01-02/impl.js`, "impl 01-02 bad\n");
      w.write(`${wtOf(calls, n)}/${PHASE_DIR}/01-02-SUMMARY.md`, "---\nkey-files:\n  created: [src/01-02/impl.js]\n---\ndone\n");
      return { taskResults: [{ task: "1", status: "implemented", evidence: "ok" }], deviations: [], requests: [] };
    },
    "review-01-02": async () => { await until(() => fs.existsSync(path.join(w.root, PHASE_DIR, "evidence", "join-1.json"))); },
    "fix-01-02": (p, o, n, calls) => { w.write(`${wtOf(calls, n)}/src/01-02/impl.js`, "impl 01-02 fixed\n"); return { taskResults: [{ task: "1", status: "implemented", evidence: "fixed" }], deviations: [], requests: [] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.ok(r.logs.some((l) => l.includes("plan 01-01: its obligations fail only in files of open plans 01-02")), r.logs.join("\n"));
  const join1 = JSON.parse(w.read(`${PHASE_DIR}/evidence/join-1.json`));
  assert.ok(join1.steps.some((s) => s.plan === "01-01" && s.outcome === "failed"), "the commit suite ran 01-01's obligation again");
  assert.ok(r.result.order.includes("commit 01-01,01-02"), JSON.stringify(r.result.order));
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("fix-01-01")).length, 0);
});

test("O66A graph: a quota stop drains the run; plans not committed are interrupted, not skipped, and nothing new starts", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")], [task("01-03")]], meta: { "01-03": { depends: ["01-02"] } }, overlay: graph() });
  const r = await run(w, {
    "exec-01-01": () => NULL("429 too many requests, retry after 60 s"),
    // 01-02 is still coding when the quota stop comes.
    "exec-01-02": async (p, o, n, calls) => { await until(() => calls.some((c) => c.opts.label === "exec-01-01" && !c.running)); },
  });
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.match(r.result.reason, /quota or rate limit/);
  assert.equal(r.result.failure.class, "quota");
  assert.deepEqual(r.result.committed, []);
  assert.deepEqual([...r.result.interrupted].sort(), ["01-02", "01-03"]);
  assert.equal(r.result.skipped, undefined);
  assert.equal(r.calls.filter((c) => c.opts.label === "exec-01-03").length, 0);
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("review-")).length, 0);
});

test("O66A graph needs per-wave execution: with batch the run is refused before it starts", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: graph({ execution_mode: "batch" }) });
  const r = await run(w);
  assert.equal(r.result.status, "refused");
  assert.match(r.result.reason, /execute_schedule graph needs gsd\.execution_mode per-wave/);
  assert.equal(r.calls.length, 0);
});

test("O66A the default schedule is unchanged: wave gates, no per-plan gates, no graph fields in the result", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")], [task("01-03")]], meta: { "01-03": { depends: ["01-01"] } } });
  const r = await run(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.result.schedule, undefined);
  assert.equal(r.result.order, undefined);
  assert.deepEqual(r.result.events.filter((e) => e.startsWith("gate ")), ["gate w1 green", "gate w2 green", "gate batch green"]);
  assert.deepEqual(r.result.waves.map((x) => x.plans), [["01-01", "01-02"], ["01-03"]]);
  assert.deepEqual(w.events.filter((e) => e.startsWith("commit ")), ["commit feat(01-w1): phase 01 wave 1", "commit feat(01-w2): phase 01 wave 2"]);
});
