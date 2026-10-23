// Kit feedback #82, #85, #83 F3 (Q82): the stop path of the shared-change step and of cross-plan requests. The shared step is
// applied when every requested change is present (the fixer reports per change; the gate verifies), an Integration stop is
// answered with `ph gsd shared clear`, an open cross-plan request is checked before Commit (path changed, a shared change to it,
// one resolver call) and answered with `ph gsd request clear`; every answer is one owner-answers.json entry the next run takes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { gsd as runGsdIn, workerEnv } from "../gsd-core/fixture.mjs";

const PD = PHASE_DIR;
// Loaded on its own so that a kit without the module fails the tests that need it, not the whole file.
const { answerLines, projectAnswers, waveMatches } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/lib/owner-answers.mjs")).href).catch(() => ({}));
const { runRecord } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-gate.mjs")).href);
const exec = (w, args = {}, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PD, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const progress = (w) => JSON.parse(w.read(`${PD}/execute-progress.json`));

// 01-01 asks for config/app.json, which no plan owns: a shared change of wave 1.
function sharedWorld(extra = {}) {
  const w = makeExecWorld({ waves: [[task("01-01")]], ...extra });
  w.write("config/app.json", "{}\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "config");
  return w;
}
const askShared = (w, run, requests) => async (...a) => ({ ...(await run(...a)), requests });
const SHARED_REQ = [{ path: "config/app.json", change: "add key x", reason: "shared" }];

// ---- 82 ----

test("Q82 F1 the shared step is applied when every change is present, although the fixer answers unresolved about the rest of the tree", async () => {
  const w = sharedWorld();
  const run = executor(w);
  const r = await exec(w, {}, {
    "exec-01-01": askShared(w, run, [{ path: "config/app.json", change: "add key x", reason: "shared" }, { path: "config/other.json", change: "add key y", reason: "shared" }]),
    "shared-": () => { w.write("config/app.json", "{\"x\":1}\n"); w.write("config/other.json", "{\"y\":1}\n"); return { status: "unresolved", evidence: "03-04's session_ping test timed out", outside: "session_ping timeout in another plan's test", changes: [{ index: 0, applied: true }, { index: 1, applied: true }] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.deepEqual(r.result.sharedChanges.map((s) => s.applied), [true, true]);
  assert.ok(r.logs.some((l) => /left to the gate: session_ping timeout/.test(l)), "the failure outside is logged for the gate");
  assert.ok(labels(r).includes("shared-w1") && labels(r).indexOf("shared-w1") < labels(r).indexOf("review-01-01"));
});

test("Q82 F2 the brief numbers the changes, bounds the checks to the shared files and sends other failures to the gate", async () => {
  const w = sharedWorld();
  const run = executor(w);
  const r = await exec(w, {}, { "exec-01-01": askShared(w, run, SHARED_REQ), "shared-": () => { w.write("config/app.json", "{\"x\":1}\n"); return { status: "fixed", changes: [{ index: 0, applied: true }] }; } });
  const prompt = r.calls.find((c) => c.opts.label === "shared-w1").prompt;
  assert.match(prompt, /"index":0,"from":"01-01","path":"config\/app\.json"/);
  assert.match(prompt, /Check only the shared files you changed/);
  assert.match(prompt, /Do not run other test files or whole suites/);
  assert.match(prompt, /belongs to the plan fixers that gate runs/);
  assert.match(prompt, /Return JSON \{changes: \[\{index, applied, evidence\}\]/);
  const schema = r.calls.find((c) => c.opts.label === "shared-w1").opts.schema;
  assert.ok(schema.properties.changes && schema.properties.outside, "the reply schema carries the per-change report");
});

test("Q82 a change the fixer did not report stays open: the Integration stop names it, keeps the others applied and offers shared clear", async () => {
  const w = sharedWorld();
  const run = executor(w);
  const ask = [{ path: "config/app.json", change: "add key x", reason: "r" }, { path: "config/other.json", change: "add key y", reason: "r" }];
  const first = await exec(w, {}, { "exec-01-01": askShared(w, run, ask), "shared-": () => ({ status: "unresolved", evidence: "other.json is generated", changes: [{ index: 0, applied: true }, { index: 1, applied: false }] }) });
  assert.deepEqual([first.result.status, first.result.stage], ["needs-owner", "Integration"]);
  assert.match(first.result.reason, /not applied \(1 of 2\): other\.json is generated/);
  assert.deepEqual(first.result.sharedChanges.map((s) => s.path), ["config/other.json"]);
  assert.match(first.result.options[0], /^ph gsd shared clear 0?1 w1 \[--path <file>\] --reason "<what you did or accept>", then rerun with the same args$/);
  assert.deepEqual(progress(w).shared.map((s) => [s.path, s.applied, s.wave]), [["config/app.json", true, "w1"], ["config/other.json", false, "w1"]]);
  // The rerun retries only the open change.
  const second = await exec(w, {}, { "shared-": () => { w.write("config/other.json", "{}\n"); return { status: "fixed", changes: [{ index: 0, applied: true }] }; } });
  assert.equal(second.result.status, "executed", JSON.stringify(second.result.reason));
  const prompt = second.calls.find((c) => c.opts.label === "shared-w1").prompt;
  assert.match(prompt, /config\/other\.json/);
  assert.doesNotMatch(prompt, /config\/app\.json/);
});

test("Q82 a reply without the per-change report keeps the old rule (fixed = all applied; unresolved stops)", async () => {
  const w = sharedWorld();
  const run = executor(w);
  const ok = await exec(w, {}, { "exec-01-01": askShared(w, run, SHARED_REQ), "shared-": () => ({ status: "fixed" }) });
  assert.equal(ok.result.status, "executed");
  const s = sharedWorld();
  const runS = executor(s);
  const stop = await exec(s, {}, { "exec-01-01": askShared(s, runS, SHARED_REQ), "shared-": () => ({ status: "unresolved", evidence: "could not" }) });
  assert.deepEqual([stop.result.status, stop.result.stage], ["needs-owner", "Integration"]);
  assert.match(stop.result.options[0], /ph gsd shared clear/);
  const none = sharedWorld();
  const runN = executor(none);
  const nothing = await exec(none, {}, { "exec-01-01": askShared(none, runN, SHARED_REQ), "shared-": () => NULL("died") });
  assert.equal(nothing.result.stage, "Integration");
  assert.match(nothing.result.options[0], /ph gsd shared clear/);
});

test("Q82 F3 ph gsd shared clear records the owner's answer; the next run takes it, applies the change and its file joins the commit as integration", async () => {
  const w = sharedWorld();
  const run = executor(w);
  const stop = await exec(w, {}, { "exec-01-01": askShared(w, run, SHARED_REQ), "shared-": () => ({ status: "unresolved", evidence: "x", changes: [{ index: 0, applied: false }] }) });
  assert.equal(stop.result.stage, "Integration");
  // The orchestrator made the change by hand and answers with the verb.
  w.write("config/app.json", "{\"x\":1}\n");
  assert.equal((await runGsdIn(w, ["shared", "clear", "1", "--reason", "x"])).code, 1, "a wave is required");
  assert.equal((await runGsdIn(w, ["shared", "clear", "1", "w1"])).code, 1, "a reason is required");
  assert.equal((await runGsdIn(w, ["shared", "clear", "1", "w9", "--reason", "x"])).code, 66, "nothing open in that wave");
  assert.equal((await runGsdIn(w, ["shared", "clear", "1", "w1", "--path", "config/none.json", "--reason", "x"])).code, 66);
  const cleared = await runGsdIn(w, ["shared", "clear", "1", "1", "--path", "config\\app.json", "--reason", "made by hand: key x added"]);
  assert.equal(cleared.code, 0, JSON.stringify(cleared.json));
  assert.equal(cleared.json.answered, "OA-1");
  assert.deepEqual(JSON.parse(w.read(`${PD}/owner-answers.json`)).map((x) => [x.id, x.kind, x.wave, x.path, x.reason]), [["OA-1", "shared", "1", "config/app.json", "made by hand: key x added"]]);
  assert.equal(progress(w).shared[0].applied, false, "a verb never writes execute-progress.json");
  const next = await exec(w);
  assert.equal(next.result.status, "executed", JSON.stringify(next.result.reason));
  assert.equal(labels(next).includes("shared-w1"), false, "the cleared change is not given to a fixer again");
  assert.deepEqual(next.result.ownerAnswers, [{ id: "OA-1", kind: "shared", wave: "1", path: "config/app.json", reason: "made by hand: key x added", matched: 1 }]);
  assert.ok(next.result.events.some((e) => /^answer OA-1 shared config\/app\.json \(1 cleared\)$/.test(e)));
  assert.deepEqual(JSON.parse(w.read(`${PD}/commits.json`)).at(-1).integration, ["config/app.json"]);
  assert.deepEqual(progress(w).answered, ["OA-1"]);
  assert.equal(progress(w).shared[0].cleared.reason, "made by hand: key x added");
});

// ---- 85 ----

// 01-01 and 01-02 share wave 1; 01-01 asks 01-02 for src/01-02/api.js.
function requestWorld(overlay = {}) {
  // One executor at a time: 01-01's request is routed (and its path digest taken) before 01-02 writes.
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { ...overlay, gsd: { parallelization: { enabled: false, max_concurrent: null }, ...overlay.gsd } } });
  const run = executor(w);
  const asks = { "exec-01-01": askShared(w, run, [{ path: "src/01-02/api.js", change: "export x", reason: "01-01 imports it" }]) };
  return { w, asks };
}
const oneRequest = { "01-02": [{ from: "01-01", path: "src/01-02/api.js", change: "export x", reason: "01-01 imports it" }] };

test("Q82 85 R1 a request whose path changed since the request closes at Commit without a reply naming it", async () => {
  const { w, asks } = requestWorld();
  const r = await exec(w, {}, { ...asks, "exec-01-02": async (...a) => { const v = await executor(w)(...a); w.write("src/01-02/api.js", "export const x = 1;\n"); return v; } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.equal(labels(r).some((l) => l.startsWith("resolve-requests")), false, "decided deterministically");
  assert.deepEqual(r.result.requestsClosed.map((x) => [x.plan, x.from, x.path, x.by]), [["01-02", "01-01", "src/01-02/api.js", "tree"]]);
  assert.deepEqual(progress(w).closed.map((x) => x.by), ["tree"]);
  assert.deepEqual(progress(w).requests["01-02"], []);
  assert.equal(JSON.parse(w.read(`${PD}/commits.json`)).length, 1);
});

test("Q82 85 F1 a request nothing shows done goes to one read-only resolver call; a request it finds present closes, the rest stops Commit", async () => {
  const { w, asks } = requestWorld();
  const yes = await exec(w, {}, { ...asks, "resolve-requests": () => ({ resolution: [{ id: "R1", resolved: true, evidence: "api.js already exports x" }] }) });
  assert.equal(yes.result.status, "executed", JSON.stringify(yes.result.reason));
  const calls = yes.calls.filter((c) => c.opts.label.startsWith("resolve-requests"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.label, "resolve-requests-01-02");
  assert.equal(calls[0].opts.readOnly, true);
  assert.match(calls[0].prompt, /"id":"R1","plan":"01-02","from":"01-01","path":"src\/01-02\/api\.js","change":"export x"/);
  assert.deepEqual(yes.result.requestsClosed.map((x) => [x.by, x.why]), [["resolver", "api.js already exports x"]]);

  const { w: w2, asks: asks2 } = requestWorld();
  const no = await exec(w2, {}, { ...asks2, "resolve-requests": () => ({ resolution: [{ id: "R1", resolved: false, evidence: "not there" }] }) });
  assert.deepEqual([no.result.status, no.result.stage], ["needs-owner", "Commit"]);
  assert.match(no.result.reason, /cross-plan change requests lack acknowledged resolution/);
  assert.deepEqual(no.result.requests, oneRequest["01-02"]);
  assert.match(no.result.options[0], /^ph gsd request clear 0?1 --plan 01-02 --path src\/01-02\/api\.js --reason "<why it is satisfied>", then rerun with the same args$/);
  assert.equal(fs.existsSync(path.join(w2.root, PD, "commits.json")), false, "nothing was committed");

  const { w: w3, asks: asks3 } = requestWorld();
  const lost = await exec(w3, {}, { ...asks3, "resolve-requests": () => NULL("died") });
  assert.equal(lost.result.stage, "Commit");
  assert.match(lost.result.reason, /the resolver returned nothing \(died\)/);
  assert.equal(labels(lost).filter((l) => l.startsWith("resolve-requests")).length, 1, "no retry loop");
});

test("Q82 85 gsd.request_check tree asks no resolver and off keeps the old stop with no check", async () => {
  for (const mode of ["tree", "off"]) {
    const { w, asks } = requestWorld({ gsd: { request_check: mode } });
    const r = await exec(w, {}, { ...asks, "exec-01-02": async (...a) => { const v = await executor(w)(...a); w.write("src/01-02/api.js", "export const x = 1;\n"); return v; } });
    assert.equal(labels(r).some((l) => l.startsWith("resolve-requests")), false, mode);
    if (mode === "tree") assert.equal(r.result.status, "executed", "tree: the changed path still closes it");
    else assert.deepEqual([r.result.status, r.result.stage, r.result.requests], ["needs-owner", "Commit", oneRequest["01-02"]], "off: every open request stops the commit");
    if (mode === "off") assert.equal(progress(w).requestBase, undefined, "off records no digest");
  }
  const { w, asks } = requestWorld({ gsd: { request_check: "tree" } });
  const rest = await exec(w, {}, asks);
  assert.deepEqual([rest.result.status, rest.result.stage], ["needs-owner", "Commit"], "tree: an unchanged path is not guessed");
  assert.equal(loadConfig(w.root).gsd.request_check, "tree");
});

test("Q82 85 F3 a request whose target path a shared change changed closes with that change", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { request_check: "tree", parallelization: { enabled: false, max_concurrent: null } } } });
  const handoff = JSON.parse(w.read(`${PD}/handoff/w1.args.json`));
  w.write(`${PD}/handoff/w1.args.json`, JSON.stringify({ ...handoff, sharedChanges: [{ source: "01-01", text: "register the export", paths: ["src/01-02/api.js"] }] }));
  const run = executor(w);
  const r = await exec(w, {}, {
    "exec-01-01": askShared(w, run, [{ path: "src/01-02/api.js", change: "export x", reason: "01-01 imports it" }]),
    "shared-": () => { w.write("src/01-02/api.js", "export const x = 1;\n"); return { status: "fixed", changes: [{ index: 0, applied: true }] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.deepEqual(r.result.requestsClosed.map((x) => [x.plan, x.by]), [["01-02", "shared change"]]);
  assert.match(r.result.requestsClosed[0].why, /shared change to src\/01-02\/api\.js \(01-01\) was applied/);
  assert.ok(r.result.events.indexOf("request 01-02 src/01-02/api.js closed by shared change") < r.result.events.findIndex((e) => e.startsWith("gate w1")), "closed when the shared change was applied, before the gate");
});

test("Q82 85 F2 ph gsd request clear records the owner's answer; the next run takes it and commits without a resolver", async () => {
  const { w, asks } = requestWorld({ gsd: { request_check: "tree" } });
  const stop = await exec(w, {}, asks);
  assert.equal(stop.result.stage, "Commit");
  const reasonless = await runGsdIn(w, ["request", "clear", "1", "--plan", "01-02", "--path", "src/01-02/api.js"]);
  assert.equal(reasonless.code, 1);
  assert.equal((await runGsdIn(w, ["request", "clear", "1", "--plan", "01-02", "--reason", "x"])).code, 1, "a path is required");
  assert.equal((await runGsdIn(w, ["request", "clear", "1", "--path", "src/01-02/api.js", "--reason", "x"])).code, 1, "a plan is required");
  const missing = await runGsdIn(w, ["request", "clear", "1", "--plan", "01-02", "--path", "src/01-02/nope.js", "--reason", "x"]);
  assert.equal(missing.code, 66);
  assert.match(missing.json.error, /no open request for src\/01-02\/nope\.js owned by 01-02 .*\(open: 01-02 src\/01-02\/api\.js\)/);
  const ok = await runGsdIn(w, ["request", "clear", "1", "--plan", "01-02", "--path", "src\\01-02\\api.js", "--reason", "api.js exports x since the gate fix; checked by hand"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.clears, [{ from: "01-01", change: "export x" }]);
  assert.deepEqual(progress(w).requests, oneRequest, "a verb never writes execute-progress.json");
  const next = await exec(w, {});
  assert.equal(next.result.status, "executed", JSON.stringify(next.result.reason));
  assert.deepEqual(next.result.requestsClosed.map((x) => [x.plan, x.path, x.by, x.why]), [["01-02", "src/01-02/api.js", "owner", "api.js exports x since the gate fix; checked by hand"]]);
  assert.deepEqual(next.result.ownerAnswers.map((x) => [x.id, x.kind, x.plan, x.matched]), [["OA-1", "request", "01-02", 1]]);
  assert.equal(labels(next).some((l) => l.startsWith("resolve-requests")), false);
  // An answer is taken once: a third run has nothing to take.
  assert.deepEqual(progress(w).answered, ["OA-1"]);
});

// ---- 83 F3: one shape, recorded as a kit event ----

test("Q82 83 F3 halt clear, shared clear and request clear append one shape to owner-answers.json; review-stats counts them", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write(`${PD}/01-01-HALT.json`, JSON.stringify({ plan: "01-01", reason: "pick", runId: "wf_x" }));
  assert.equal((await runGsdIn(w, ["halt", "clear", "1", "--plan", "01-01", "--reason", "use v1"])).code, 0);
  w.write(`${PD}/execute-progress.json`, JSON.stringify({ plans: {}, shared: [{ from: "01-01", path: "a.json", change: "c", applied: false, wave: "w1" }], requests: { "01-01": [{ from: "01-02", path: "src/01-01/x.js", change: "c" }] } }));
  assert.equal((await runGsdIn(w, ["shared", "clear", "1", "w1", "--reason", "done"])).code, 0);
  assert.equal((await runGsdIn(w, ["request", "clear", "1", "--plan", "01-01", "--path", "src/01-01/x.js", "--reason", "present"])).code, 0);
  const list = JSON.parse(w.read(`${PD}/owner-answers.json`));
  assert.deepEqual(list.map((x) => [x.id, x.kind, x.plan ?? null]), [["OA-1", "halt", "01-01"], ["OA-2", "shared", null], ["OA-3", "request", "01-01"]]);
  assert.ok(list.every((x) => x.reason && /^\d{4}-\d\d-\d\dT/.test(x.at)));
  assert.deepEqual(answerLines(projectAnswers(w.root).answers), ["owner answers 3: halt 1, shared 1, request 1"]);
  assert.deepEqual(answerLines([]), []);
  assert.equal(waveMatches("w2", "2") && waveMatches("gap-w2", "2") && waveMatches("w2", "w2") && waveMatches("batch", "batch"), true);
  assert.equal(waveMatches("w2", "3") || waveMatches("w2", ""), false);
  // A worker never writes an answer (single writer).
  const worker = await runGsdIn(w, ["shared", "clear", "1", "w1", "--reason", "x"], { env: workerEnv() });
  assert.notEqual(worker.code, 0);
});

test("Q82 83 F3 owner-answers.json is a run record: an answer does not change an agent call's digest", () => {
  assert.equal(runRecord(`${PD}/owner-answers.json`), true);
  assert.equal(runRecord(`${PD}/halt-answers.json`), true);
  assert.equal(runRecord(`${PD}/grants.json`), false);
});

test("Q82 gsd.request_check defaults to auto, accepts auto|tree|off and nothing else", () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  assert.equal(loadConfig(w.root).gsd.request_check, "auto");
  const bad = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { request_check: "maybe" } } });
  assert.throws(() => loadConfig(bad.root), /request_check/);
  assert.equal(fs.existsSync(path.join(SHIP_DIR, ".agents/harness/gsd/owner-answers.mjs")), true);
});
