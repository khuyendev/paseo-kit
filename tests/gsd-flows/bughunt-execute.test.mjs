// Bug-hunt fixes of the execute flow (groups G054-G092 of the 2026-10-23 hunt): safe resume, owners, halts, requests,
// shared changes, fix rounds, review replay and the flow helpers they use.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { NULL, runScript } from "./host.mjs";
import { executor, makeExecWorld, task } from "./exec-world.mjs";
import { PHASE_DIR } from "./world.mjs";
import { gsd as runGsdIn, plan as planFixture, project, summary as summaryFixture } from "../gsd-core/fixture.mjs";

const lib = (f) => pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib", f)).href;
const { main } = await import(lib("gsd-flow.mjs"));
const { keyFiles, specificOwners } = await import(lib("flow-owns.mjs"));
const { lock, unlock, lockCheck } = await import(lib("flow-files.mjs"));
const { parseReply } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/workflow/schema.mjs")).href);
const NODE = process.execPath;
const PD = PHASE_DIR;
const FLAG_TEST = [NODE, "-e", "const fs=require('fs');if(fs.existsSync('fail.flag')){console.log('error '+fs.readFileSync('fail.flag','utf8').trim());process.exit(1)}"];
const flagCommands = { build: [NODE, "-e", "process.exit(0)"], test: FLAG_TEST, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const exec = (w, args = {}, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PD, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const finding = (id, extra = {}) => ({ id, severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 1, description: `finding ${id}`, ...extra });

// A project with an execute baseline and two transferred plans, the second nested in the first's directory.
function nestedProject() {
  const p = makeTempProject({ files: { ".gitignore": "_workspace/\n", "lib/p/d/base.dart": "b\n", "lib/p/d/auth/login.dart": "l\n", [`${PD}/.keep`]: "" } });
  return p;
}
const plansNested = [{ id: "01-01", owns: ["Path: lib/p/d"], summary: `${PD}/01-01-SUMMARY.md`, complete: true }, { id: "01-02", owns: ["Path:lib/p/d/auth/"], summary: `${PD}/01-02-SUMMARY.md`, complete: true }];

test("G079 nested owns: a changed path belongs to the plan owning it most specifically; a real tie stays ambiguous", async () => {
  const p = nestedProject();
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  p.write("lib/p/d/auth/login.dart", "fixed\n");
  p.write("lib/p/d/base.dart", "fixed\n");
  const rg = await flow(p.root, ["resume-gate", PD], { plans: plansNested });
  assert.deepEqual([rg.code, rg.json.problems], [0, []]);
  const oc = await flow(p.root, ["owned-changes", PD], { plans: plansNested });
  assert.deepEqual(oc.json.files, { "01-01": ["lib/p/d/base.dart"], "01-02": ["lib/p/d/auth/login.dart"] });
  const tie = await flow(p.root, ["resume-gate", PD], { plans: [...plansNested, { id: "01-03", owns: ["lib/p/d/auth"], summary: `${PD}/01-03-SUMMARY.md`, complete: true }] });
  assert.deepEqual(tie.json.problems.map((x) => [x.kind, x.plans]), [["ambiguous owner", ["01-02", "01-03"]]]);
  assert.deepEqual(specificOwners("src/api-v2/r.js", [{ id: "a", owns: ["Path:src/api"] }, { id: "b", owns: ["Path:src/api-v2"] }], ["Path:"]).map((x) => x.id), ["b"]);
});

test("G072 request routing uses path boundaries and the adapter owns forms", async () => {
  const p = makeTempProject();
  const r = await flow(p.root, ["owners"], { paths: ["src/api-v2/routes.js", "src/apidocs/x.md", "src\\api\\a.js"], plans: [{ id: "01-01", owns: ["Path:src/api"] }, { id: "01-02", owns: ["Path:src/api-v2"] }] });
  assert.deepEqual(r.json.owners, { "src/api-v2/routes.js": ["01-02"], "src/apidocs/x.md": [], "src\\api\\a.js": ["01-01"] });
});

test("G054 G085 resume gate: an unrecorded commit of the run is reconciled, a commit touching no plan file is accepted, ignored paths are no plan output", async () => {
  const p = makeTempProject({ files: { ".gitignore": "_workspace/\n", "src/a.js": "1\n", "docs/notes.md": "n\n", [`${PD}/.keep`]: "" }, overlay: { adapter: { ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: ["docs/feedback.md"] } } } });
  const plans = [{ id: "01-01", owns: ["Path:src/a.js"], summary: `${PD}/01-01-SUMMARY.md`, complete: true }];
  await flow(p.root, ["baseline", PD]);
  p.write("src/a.js", "2\n");
  p.write(`${PD}/01-01-SUMMARY.md`, "done\n");
  p.git("add", "-A");
  p.git("commit", "-qm", "feat(01-w1): phase 01 wave 1\n\nPlans: 01-01");
  p.write("docs/notes.md", "edited by the owner\n");
  p.git("add", "-A");
  p.git("commit", "-qm", "docs: a note between runs");
  p.write("docs/feedback.md", "a note during the run\n");
  const rg = await flow(p.root, ["resume-gate", PD], { plans });
  assert.deepEqual(rg.json.problems, []);
  assert.deepEqual(rg.json.reconciled.map((c) => c.plans), [["01-01"]]);
  assert.deepEqual(rg.json.accepted.map((c) => c.files), [["docs/notes.md"]]);
  const commits = p.readJson(`${PD}/commits.json`);
  assert.deepEqual(commits[0].plans, { "01-01": [`${PD}/01-01-SUMMARY.md`, "src/a.js"].sort() });
  assert.deepEqual((await flow(p.root, ["owned-changes", PD], { plans })).json.unowned, []);
  p.write("src/a.js", "3\n");
  p.git("add", "-A");
  p.git("commit", "-qm", "hand edit of owned code");
  const foreign = await flow(p.root, ["resume-gate", PD], { plans });
  assert.match(foreign.json.problems[0].detail, /1 foreign/);
});

test("G055 halt clear records the owner's answer; the rerun dispatches the plan with it and reports skipped plans", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]] });
  const first = await exec(w, {}, { "exec-01-02": () => ({ taskResults: [{ task: "1", status: "partial" }], deviations: [{ rule: 4, note: "pick a schema" }], requests: [] }) });
  assert.equal(first.result.status, "needs-owner");
  assert.match(first.result.options[0], /ph gsd halt clear 0?1 --plan <id> --reason/);
  const p = project({ files: { ".planning/phases/01-core/01-02-HALT.json": JSON.stringify({ plan: "01-02", reason: "owner decision needed: pick a schema", runId: "wf_x" }) } });
  const cleared = await runGsdIn(p, ["halt", "clear", "1", "--plan", "01-02", "--reason", "use schema v1 (D-09)"]);
  assert.equal(cleared.code, 0, JSON.stringify(cleared.json));
  assert.equal(fs.existsSync(p.path(".planning/phases/01-core/01-02-HALT.json")), false);
  assert.deepEqual(p.readJson(".planning/phases/01-core/halt-answers.json").map((x) => [x.plan, x.halt, x.answer]), [["01-02", "owner decision needed: pick a schema", "use schema v1 (D-09)"]]);
  assert.equal((await runGsdIn(p, ["halt", "clear", "1", "--plan", "01-02", "--reason", "again"])).code, 66);
  // The workflow side: the answer file reaches the next executor, and a still-halted plan is listed as skipped.
  fs.rmSync(path.join(w.root, PD, "01-02-HALT.json"));
  w.write(`${PD}/halt-answers.json`, JSON.stringify([{ plan: "01-02", halt: "pick a schema", answer: "use schema v1" }]));
  const second = await exec(w);
  assert.equal(second.result.status, "executed");
  assert.match(second.calls.find((c) => c.opts.label === "exec-01-02").prompt, /Owner answers to earlier halts of this plan .*use schema v1/);
  const s = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  s.write(`${PD}/01-02-HALT.json`, "{}");
  const skippedRun = await exec(s);
  assert.equal(skippedRun.result.status, "executed");
  assert.deepEqual(skippedRun.result.skipped.map((x) => [x.plan, x.why]), [["01-02", "halted"]]);
  assert.match(skippedRun.result.reason, /executed except 01-02 \(halted\)/);
});

test("G058 an empty task list or a skipped task is no finished plan", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const run = executor(w);
  const empty = await exec(w, {}, { "exec-": async (...a) => ({ ...(await run(...a)), taskResults: [] }) });
  assert.match(empty.result.reason, /executor reported 0 task result/);
  const w2 = makeExecWorld({ waves: [[task("01-01")]] });
  const run2 = executor(w2);
  const skipped = await exec(w2, {}, { "exec-": async (...a) => ({ ...(await run2(...a)), taskResults: [{ task: "1", status: "skipped", evidence: "not needed" }] }) });
  assert.match(skipped.result.reason, /task 1 was skipped \(not needed\)/);
  assert.equal(labels(skipped).some((l) => l.startsWith("review-")), false);
});

test("G074 G089 requests: an owner plan's request survives a decision stop; an unowned path is made by the shared-change fixer and committed with the wave", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  const run = executor(w);
  const stop = await exec(w, {}, { "exec-01-01": async (...a) => ({ ...(await run(...a)), taskResults: [{ task: "1", status: "partial" }], deviations: [{ rule: 4, note: "pick" }], requests: [{ path: "src/01-02/api.js", change: "export x", reason: "needs it" }] }) });
  assert.deepEqual(stop.result.requests, { "01-02": [{ from: "01-01", path: "src/01-02/api.js", change: "export x", reason: "needs it" }] });
  const s = makeExecWorld({ waves: [[task("01-01")]] });
  s.write("config/app.json", "{}\n");
  s.git("add", "-A"); s.git("commit", "-qm", "config");
  const runS = executor(s);
  const r = await exec(s, {}, {
    "exec-01-01": async (...a) => ({ ...(await runS(...a)), requests: [{ path: "config\\app.json", change: "add key x", reason: "shared" }] }),
    "shared-": () => { s.write("config/app.json", "{\"x\":1}\n"); return { status: "fixed" }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.match(r.calls.find((c) => c.opts.label === "shared-w1").prompt, /You own exactly these files: \["config\/app\.json"\]/);
  assert.deepEqual(r.result.sharedChanges.map((x) => [x.path, x.applied]), [["config/app.json", true]]);
  assert.deepEqual(JSON.parse(s.read(`${PD}/commits.json`))[0].integration, ["config/app.json"]);
  assert.equal(s.git("status", "--porcelain", "config/app.json").stdout.trim(), "");
});

test("G070 a shared-tree executor's edit outside every owns stops before the gate and the review", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const run = executor(w);
  const r = await exec(w, {}, { "exec-": async (...a) => { const v = await run(...a); w.write("lib/committed.dart", "hide X\n"); return v; } });
  assert.deepEqual([r.result.status, r.result.stage, r.result.paths], ["needs-owner", "Execute", ["lib/committed.dart"]]);
  assert.equal(labels(r).some((l) => l.startsWith("review-")), false);
  assert.equal(r.result.events.some((e) => e.startsWith("gate")), false);
});

test("G066 G088 an unresolved fixer is judged on a fresh gate: its own failures gone means no stop", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { adapter: { commands: flagCommands } } });
  w.write("lib.txt", "l\n"); w.git("add", "-A"); w.git("commit", "-qm", "lib");
  const r = await exec(w, {}, {
    "exec-01-01": async (p, o, n, calls) => { await executor(w)(p, o, n, calls); w.write("fail.flag", "lib.txt"); return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] }; },
    "integration-fix": () => { fs.rmSync(path.join(w.root, "fail.flag")); return { status: "unresolved", remaining_failures: 0 }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const nofile = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { max_verify_rounds: 2 } } });
  nofile.write("fail.flag", "x");
  const red = await exec(nofile);
  assert.match(red.result.reason, /name no file of any plan, so no fixer can own them/);
  assert.equal(labels(red).some((l) => l.startsWith("integration-fix")), false);
});

test("G064 batch mode: an unplaced failure goes to an integration fixer owning exactly its file, before the batch fixer", async () => {
  const w = makeExecWorld({ overlay: { gsd: { execution_mode: "batch" }, adapter: { commands: flagCommands } } });
  w.write("lib.txt", "l\n"); w.git("add", "-A"); w.git("commit", "-qm", "lib");
  const r = await exec(w, {}, { "exec-01-02": async (p, o, n, calls) => { await executor(w)(p, o, n, calls); w.write("fail.flag", "lib.txt"); return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] }; } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.match(r.calls.find((c) => c.opts.label === "integration-fix-batch").prompt, /You own exactly these files: \["lib\.txt"\]/);
  assert.equal(labels(r).includes("batch-fixer"), false);
});

test("G075 a cut-short or stale handoff is refused", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write(`${PD}/handoff/manifest.json`, JSON.stringify({ planRevision: undefined, waves: 2, plans: [] }));
  assert.match((await exec(w)).result.reason, /handoff .* is incomplete or mixed \(1 wave files, the manifest names 2\)/);
  const s = makeExecWorld({ waves: [[task("01-01", { planHash: "aaaaaaaaaaaa" })]] });
  const base = s.gsd.handlers["phase-plan-index"];
  s.gsd.on("phase-plan-index", (...x) => { const r = base(...x); return { ...r, plans: r.plans.map((p) => ({ ...p, plan_hash: "bbbbbbbbbbbb" })) }; });
  const stale = await exec(s);
  assert.deepEqual([stale.result.status, stale.result.stale], ["refused", ["01-01 changed after the handoff"]]);
  assert.equal(stale.calls.length, 0);
});

test("G075 G083 handoff publishes a manifest last, carries each plan's shared changes in its execution wave, and keeps an earlier set until the new one is written", async () => {
  const p = project({ files: { ".planning/phases/01-core/01-01-PLAN.md": planFixture({ id: "01", extra: "" }).replace("</tasks>", "</tasks>\n<shared_changes>\nlib/main.dart: import bootstrap.dart\n</shared_changes>"), ".planning/phases/01-core/01-01-SUMMARY.md": null } });
  fs.mkdirSync(p.path(".planning/phases/01-core/handoff"), { recursive: true });
  p.write(".planning/phases/01-core/handoff/w2.args.json", "{}");
  const h = await runGsdIn(p, ["handoff", "1"]);
  assert.equal(h.code, 0, JSON.stringify(h.json));
  const man = p.readJson(".planning/phases/01-core/handoff/manifest.json");
  assert.equal(man.waves, h.json.waves.length);
  assert.equal(fs.existsSync(p.path(".planning/phases/01-core/handoff/w2.args.json")), h.json.waves.length >= 2);
  const w1 = p.readJson(".planning/phases/01-core/handoff/w1.args.json");
  assert.deepEqual(w1.sharedChanges.map((s) => [s.source, s.paths]), [["01-01", ["lib/main.dart"]]]);
  assert.deepEqual(h.json.sharedChanges.map((s) => s.executionWave), [1]);
});

test("G069 a transfer records its intent first; an unfinished one stops the wave instead of rejoining as complete", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" } } });
  w.write(`${PD}/01-01-SUMMARY.md`, "---\nkey-files:\n  created: []\n---\n");
  w.write(`${PD}/transfers-pending/01-01.json`, JSON.stringify({ plan: "01-01", worktree: ".claude/worktrees/x", paths: ["src/01-01/impl.js"] }));
  const r = await exec(w);
  assert.match(r.result.reason, /the transfer of 01-01 did not finish/);
  const ok = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" } } });
  assert.equal((await exec(ok)).result.status, "executed");
  assert.equal(fs.existsSync(path.join(ok.root, PD, "transfers-pending", "01-01.json")), false);
  assert.equal(fs.existsSync(path.join(ok.root, PD, "transfers", "01-01.json")), true);
});

test("G080 G081 G126 a resolution check without an answer fails with a resume hint; the rerun reuses the recorded review and runs only the resolution check", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const first = await exec(w, {}, { "review-": () => ({ findings: [finding("F1")] }), "resolve-": () => NULL("Caller agent 197ff54e not found") });
  assert.deepEqual([first.result.status, first.result.stage], ["failed", "Review"]);
  assert.match(first.result.reason, /returned nothing \(Caller agent 197ff54e not found\); this is no verdict/);
  const second = await exec(w);
  assert.equal(second.result.status, "executed", JSON.stringify(second.result));
  assert.deepEqual(labels(second).filter((l) => /^(review|verify|fix-review|resolve)/.test(l)), ["resolve-01-01"]);
  // Uncertain verdicts reach the owner with the verifiers' evidence; deferred lines are written once.
  const u = makeExecWorld({ waves: [[task("01-01")]] });
  const un = await exec(u, {}, { "review-": () => ({ findings: [finding("F2"), finding("N1", { severity: "low" })] }), "verify-findings": (p) => ({ verdicts: [{ id: "F2", verdict: "uncertain", evidence: "EVIDENCE-MARKER" }] }) });
  assert.match(JSON.stringify(un.result.findings), /EVIDENCE-MARKER/);
  await exec(u, {}, { "verify-findings": () => ({ verdicts: [{ id: "F2", verdict: "confirmed" }] }) });
  assert.equal(u.read(`${PD}/deferred.md`).trim().split("\n").filter((l) => l.includes("N1")).length, 1);
});

test("G080 findings still unresolved after the first fix get one more fixer pass limited to them", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  let pass = 0;
  const r = await exec(w, {}, { "review-": () => ({ findings: [finding("F1"), finding("F2")] }), "resolve-": (p) => ({ resolution: pass++ === 0 ? [{ id: "F1", resolved: true, evidence: "ok" }, { id: "F2", resolved: false, evidence: "still" }] : [{ id: "F2", resolved: true, evidence: "ok" }] }) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const extra = r.calls.find((c) => c.opts.label === "fix-unresolved-w1");
  assert.match(extra.prompt, /"id":"F2"/);
  assert.doesNotMatch(extra.prompt, /"id":"F1"/);
});

test("G056 the findings schema needs trigger, likelihood, confidence and file, so the runner re-asks for them", async () => {
  // The schema is the kit's since THIN stage 2 (flow verb exec-setup hands it to gsd-execute).
  const { FINDINGS_SCHEMA: schema } = await import(lib("flow-exec.mjs"));
  const reply = (f) => JSON.stringify({ findings: [f] });
  assert.ok(parseReply(reply({ severity: "high", description: "d", likelihood: "likely", confidence: 90, file: "a.js" }), schema).errors.some((e) => /trigger/.test(e)));
  assert.equal(parseReply(reply(finding("F1")), schema).errors.length, 0);
});

test("G059 a review record's plan is a plan id, never a path", async () => {
  const p = makeTempProject({ files: { [`${PD}/.keep`]: "" } });
  const rec = { plan: "../../../escape", scope: [], excluded: [], lenses: [], codeOnly: false, findings: [], resolution: [] };
  const r = await flow(p.root, ["review-record", PD], { waveId: "w1", record: rec });
  assert.equal(r.code, 1);
  assert.match(r.json.errors[0], /plan id/);
  assert.equal((await flow(p.root, ["review-record", PD], { waveId: "w1", record: { ...rec, plan: "01-phase" } })).code, 0);
});

test("G071 G082 the batch phase review drops lockfiles; review scopes drop paths that leave the root through a junction", async (t) => {
  const p = makeTempProject({ files: { "src/app.js": "a\n", "package-lock.json": "{}\n" } });
  const phase = await flow(p.root, ["review-scope", PD], { plan: "01-phase", files: ["src/app.js", "package-lock.json"], filterExplicit: true });
  assert.deepEqual([phase.json.scope, phase.json.excluded.map((x) => x.reason)], [["src/app.js"], ["lockfile"]]);
  const owner = await flow(p.root, ["review-scope", PD], { plan: "01-01", files: ["src/app.js", "package-lock.json"] });
  assert.deepEqual(owner.json.scope, ["src/app.js", "package-lock.json"]);
  const outside = makeTempDir("outside ");
  fs.writeFileSync(path.join(outside, "secret.js"), "s\n");
  try { fs.symlinkSync(outside, p.path("src/linked"), "junction"); } catch { t.skip("no junction support"); return; }
  const linked = await flow(p.root, ["review-scope", PD], { plan: "01-01", files: ["src/linked/secret.js", "src/app.js"] });
  assert.deepEqual(linked.json.scope, ["src/app.js"]);
  assert.deepEqual(linked.json.excluded, [{ path: "src/linked/secret.js", reason: "outside the code root" }]);
});

test("G078 SUMMARY key-files: a quoted path with a comma and a wrapped flow list", () => {
  assert.deepEqual(keyFiles("---\nkey-files:\n  created: [\"src/a,b.js\"]\n---\n").created, ["src/a,b.js"]);
  assert.deepEqual(keyFiles("---\nkey-files:\n  created: [src/a.js,\n    src/b.js]\n---\n").created, ["src/a.js", "src/b.js"]);
});

test("G063 two gate runs of one wave never share an evidence number, and numbers do not skip", async () => {
  const p = makeTempProject({ files: { [`${PD}/.keep`]: "" }, overlay: { adapter: { commands: { build: [NODE, "-e", "0"], test: [NODE, "-e", "0"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  const [a, b] = await Promise.all([flow(p.root, ["gate", PD], { waveId: "w3", plans: [] }), flow(p.root, ["gate", PD], { waveId: "w3", plans: [] })]);
  assert.notEqual(a.json.evidence, b.json.evidence);
  const c = await flow(p.root, ["gate", PD], { waveId: "w3", plans: [] });
  assert.match(c.json.evidence, /w3-3\.json$/);
});

test("G063 a gate after an interrupted one of the same inputs reuses its passed steps", async () => {
  const count = [NODE, "-e", "require('fs').appendFileSync('runs.txt','b')"];
  const p = makeTempProject({ files: { [`${PD}/.keep`]: "", ".gitignore": "runs.txt\n" }, overlay: { adapter: { commands: { build: count, test: [NODE, "-e", "0"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  const first = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [] });
  fs.rmSync(p.path(first.json.evidence));
  const again = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [] });
  assert.equal(again.json.green, true);
  assert.equal(p.read("runs.txt"), "b");
  assert.ok(again.json.notes.some((n) => /^build: passed in an interrupted gate run/.test(n)));
  const third = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [] });
  assert.equal(p.read("runs.txt"), "bb", "a finished run is never reused");
  assert.equal(third.json.green, true);
});

test("G076 a gsd setting edit leaves green gate evidence current", async () => {
  const cmds = { build: [NODE, "-e", "0"], test: [NODE, "-e", "0"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
  const p = makeTempProject({ files: { [`${PD}/.keep`]: "" }, overlay: { adapter: { commands: cmds } } });
  const g = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [] });
  assert.equal(g.json.green, true);
  p.writeJson(".agents/harness.config.json", { adapter: { commands: cmds }, gsd: { review_depth: "deep" } });
  assert.equal((await flow(p.root, ["evidence-check", g.json.evidence])).json.status, "current");
  p.writeJson(".agents/harness.config.json", { adapter: { commands: { ...cmds, build_timeout_s: 31 } } });
  assert.equal((await flow(p.root, ["evidence-check", g.json.evidence])).json.status, "stale");
});

test("G080 the stage digest ignores the run's own records and HEAD, and still follows the code", async () => {
  const p = makeTempProject({ files: { "src/a.js": "1\n", [`${PD}/.keep`]: "" } });
  const d0 = (await flow(p.root, ["digest"], { files: ["."] })).json.hash;
  p.write(`${PD}/review/w1-01-01.json`, "{}");
  p.write(`${PD}/evidence/w1-1.json`, "{}");
  p.write(`${PD}/deferred.md`, "- x\n");
  p.git("commit", "-q", "--allow-empty", "-m", "unrelated");
  assert.equal((await flow(p.root, ["digest"], { files: ["."] })).json.hash, d0);
  p.write("src/a.js", "2\n");
  assert.notEqual((await flow(p.root, ["digest"], { files: ["."] })).json.hash, d0);
});

test("G077 attribution answers are matched by failure id, and a failing hook is named in the gate notes", async () => {
  const hook = (body) => `const req=JSON.parse(require('fs').readFileSync(0,'utf8'));${body}`;
  const fail = (msg) => [NODE, "-e", `console.log('error ${msg}');process.exit(1)`];
  const base = { build: [NODE, "-e", "0"], test: [NODE, "-e", "0"], build_timeout_s: 30, test_timeout_s: 30, gates: [{ name: "lint-a", argv: fail("lint a") }, { name: "lint-b", argv: fail("lint b") }], verify: {} };
  const plans = [{ id: "01-01", owns: ["Path:src/a/"], verify: [] }, { id: "01-02", owns: ["Path:src/b/"], verify: [] }];
  const mk = (script) => makeTempProject({ files: { [`${PD}/.keep`]: "", "tools/attr.js": hook(script) }, overlay: { adapter: { commands: base, attribution: "tools/attr.js" } } });
  // The right pairs (lint a -> 01-01, lint b -> 01-02) given in reverse order: matched by id, not by position.
  const rev = mk("console.log(JSON.stringify({v:1,assignments:[...req.failures].reverse().map(f=>({failure:f.id,plan:/lint a/.test(f.text)?'01-01':'01-02'}))}))");
  const r = await flow(rev.root, ["gate", PD], { waveId: "w1", plans });
  assert.deepEqual(Object.fromEntries(Object.entries(r.json.byPlan).map(([k, v]) => [k, v.map((f) => f.step)])), { "01-01": ["gate-lint-a"], "01-02": ["gate-lint-b"] });
  const dup = mk("console.log(JSON.stringify({v:1,assignments:req.failures.map(f=>({failure:req.failures[0].id,plan:'01-01'}))}))");
  const d = await flow(dup.root, ["gate", PD], { waveId: "w1", plans });
  assert.ok(d.json.notes.some((n) => /answered more than once/.test(n)), JSON.stringify(d.json.notes));
  const bad = mk("process.exit(3)");
  const b = await flow(bad.root, ["gate", PD], { waveId: "w1", plans });
  assert.ok(b.json.notes.some((n) => /^attribution hook failed: .*exit 3/.test(n)), JSON.stringify(b.json.notes));
  assert.equal(b.json.unplaced.length, 2);
});

test("G088 gsd-flow verbs that take no input never wait on an open stdin", async () => {
  const p = makeTempProject({ files: { "x.txt": "x\n" } });
  const child = spawn(NODE, [path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs"), "remove", "x.txt"], { cwd: p.root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PASEO_HARNESS_ROOT: p.root } });
  const code = await new Promise((resolve) => { const t = setTimeout(() => { child.kill(); resolve("hung"); }, 15000); child.on("close", (c) => { clearTimeout(t); resolve(c); }); });
  assert.notEqual(code, "hung");
});

test("G092 tracking the same wave and plans twice keeps one Wave log line", async () => {
  const p = project({ files: { ".planning/STATE.md": "# State\n\n## Current Position\n\nPhase: 1\n\n## Wave log\n\n-\n" } });
  for (const v of ["green", "green"]) assert.equal((await runGsdIn(p, ["state", "wave", "--phase", "1", "--wave", "1"], { stdin: JSON.stringify({ plans: ["01-01"], verify: v, evidence: "_workspace/e.json" }) })).code, 0);
  await runGsdIn(p, ["state", "wave", "--phase", "1", "--wave", "1"], { stdin: JSON.stringify({ plans: ["01-02"], verify: "green", evidence: "_workspace/f.json" }) });
  const lines = p.read(".planning/STATE.md").split(/\r?\n/).filter((l) => /phase 1 wave 1:/.test(l));
  assert.equal(lines.length, 2, lines.join("\n"));
});

test("G057 a plan whose frontmatter does not parse is not runnable", async () => {
  const p = project({ files: { ".planning/phases/01-core/01-01-PLAN.md": "---\nwave: [1\n---\n<tasks></tasks>\n" } });
  const idx = await runGsdIn(p, ["phase-plan-index", "1"]);
  const row = idx.json.plans.find((x) => x.id === "01-01");
  assert.equal(row.ready, false);
  assert.ok(idx.json.warnings.some((x) => /01-01: frontmatter/.test(x)));
});

test("G065 G073 revision arguments never become git options; the scope walk is not cut at 500 commits", async () => {
  const p = project();
  const victim = p.path("victim.txt");
  fs.writeFileSync(victim, "KEEP\n");
  const r = await runGsdIn(p, ["select-revert-commits", "--phase", "1", "--range", `--output=${victim}`]);
  assert.equal(r.code, 1);
  assert.equal(fs.readFileSync(victim, "utf8"), "KEEP\n");
  p.git("commit", "-q", "--allow-empty", "-m", "feat(01-01): the plan");
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x.invalid" };
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: p.root, encoding: "utf8" }).stdout.trim();
  let parent = spawnSync("git", ["rev-parse", "HEAD"], { cwd: p.root, encoding: "utf8" }).stdout.trim();
  for (let i = 0; i < 501; i++) parent = spawnSync("git", ["commit-tree", tree, "-p", parent, "-m", `chore: ${i}`], { cwd: p.root, encoding: "utf8", env }).stdout.trim();
  spawnSync("git", ["update-ref", "HEAD", parent], { cwd: p.root });
  const all = await runGsdIn(p, ["check", "evaluation-scope", "--plan", "01-01", "--commits-only"]);
  assert.deepEqual(all.json.commits.map((c) => c.subject), ["feat(01-01): the plan"]);
  const cut = await runGsdIn(p, ["check", "evaluation-scope", "--plan", "01-01", "--commits-only", "--max-commits", "5"]);
  assert.deepEqual([cut.json.truncated, cut.json.maxCommits], [true, 5]);
});

test("G068 a git commit that fails silently names its exit code", async () => {
  const p = project({ files: { "src/a.js": "1\n" } });
  fs.writeFileSync(p.path(".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  p.write("src/a.js", "2\n");
  const r = await runGsdIn(p, ["commit", "feat(01-01): x", "--files", "src/a.js"]);
  assert.equal(r.code, 1);
  assert.match(r.json.error, /git commit failed: (exit 1|.+)/);
  assert.doesNotMatch(r.json.error, /failed: $/);
});

test("G006 G020 the code-root lease names the holder's workflow; a claim left by a dead process is reclaimed", async () => {
  const p = makeTempProject();
  const held = lock(p.root, "debug", "wf_plan_A", process.pid, "gsd-plan");
  const refused = lock(p.root, "debug", "wf_exec_B", process.pid, "gsd-execute");
  assert.deepEqual([refused.locked, refused.holder, refused.holderKind], [false, "wf_plan_A", "gsd-plan"]);
  unlock(p.root, "debug", held.token);
  const claim = p.path("_workspace/locks/debug.lock.transition");
  fs.mkdirSync(claim, { recursive: true });
  fs.writeFileSync(path.join(claim, "owner.json"), JSON.stringify({ pid: 2147483647 }));
  const after = lock(p.root, "debug", "wf_new", process.pid, "gsd-debug");
  assert.equal(after.locked, true);
  assert.equal(lockCheck(p.root, "debug").holderKind, "gsd-debug");
  unlock(p.root, "debug", after.token);
  const w = makeExecWorld();
  const h = lock(w.root, "debug", "wf_quick_A", process.pid, "gsd-quick");
  try {
    const r = await exec(w);
    assert.match(r.result.reason, /^a gsd-quick run holds this code root \(wf_quick_A\); execute starts after it ends$/);
  } finally { unlock(w.root, "debug", h.token); }
});

test("G084 an unanswered blocking anti-pattern stops gsd-plan at Discuss and names the writer", async () => {
  const w = makeExecWorld();
  w.write(`${PD}/.continue-here.md`, "## Critical Anti-Patterns\n\n| Pattern | Description | Severity | Prevention Mechanism |\n|---|---|---|---|\n| skipped gate | x | blocking | y |\n");
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: () => null });
  assert.deepEqual([r.result.status, r.result.stage, r.result.rows], ["needs-owner", "Discuss", ["skipped gate"]]);
  assert.match(r.result.reason, /run gsd-discuss 0?1/);
  const e = await exec(w);
  assert.match(e.result.reason, /gsd-flow\.mjs write .*\.continue-here\.answers\.json/);
});

test("G060 G061 G067 G086 G087 role texts match the workflow: no fixer worktree, workflow severities, no WINDOWS ledger, batched verdicts", () => {
  const read = (rel) => fs.readFileSync(path.join(SHIP_DIR, rel), "utf8");
  assert.match(read(".agents/gsd/overlays/gsd-code-fixer.md"), /Never create a git worktree or branch/);
  assert.match(read(".agents/gsd/overlays/gsd-code-reviewer.md"), /`critical`, `high`, `medium`, `low` and `info`, never BLOCKER, WARNING/);
  assert.match(read(".agents/gsd/overlays/gsd-executor.md"), /never run `windows append`/);
  const fv = read(".agents/agents/finding-verifier.md");
  assert.match(fv, /\{verdicts: \[\{id, verdict, evidence\}\]\}/);
  assert.doesNotMatch(fv, /Return `\{verdict, evidence/);
  assert.match(fs.readFileSync(path.join(SHIP_DIR, "..", "README.md"), "utf8"), /Only critical and high findings/);
});
