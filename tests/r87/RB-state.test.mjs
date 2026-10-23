// Kit feedback #87 part B, #83 F1/F2 (RB): execute-progress.json has one writer, the state-* flow verbs of
// workflows/lib/flow-state.mjs. Each verb checks its completion contract (refused, nothing written, when it does not hold) and
// answers with the whole typed state; a record written by kit 3c00968 is read, migrated and resumed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { committedFiles, died, exec, shared, world } from "../fb6/q77-helpers.mjs";

const PD = PHASE_DIR;
const FILE = `${PD}/execute-progress.json`;
// Loaded on its own so that a kit without the module fails these tests, not the whole file.
const stateMod = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-state.mjs")).href).catch(() => ({}));
async function verb(w, argv, input) {
  let out = "";
  const code = await main(argv, { root: w.root, input: input === undefined ? "" : JSON.stringify(input), out: (l) => { out += l; } });
  return { code, json: JSON.parse(out) };
}
const st = (w, name, input) => verb(w, [`state-${name}`, PD], input);
const onDisk = (w) => JSON.parse(w.read(FILE));
const commit = (w, msg) => { w.git("add", "-A"); w.git("commit", "-qm", msg); return w.git("rev-parse", "HEAD").stdout.trim(); };

test("RB the state verbs are flow verbs; a raw write, append, json-push or remove of execute-progress.json is refused", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  for (const name of ["read", "plan", "shared", "request", "integration", "answer", "smoke"]) assert.ok(stateMod.STATE_FILE && (await verb(w, [`state-${name}`, PD], {})).json.error !== `unknown command state-${name}`, name);
  for (const [cmd, input] of [["write", "{}"], ["append", "{}"], ["json-push", "{}"], ["remove", undefined]]) {
    let out = "";
    const code = await main([cmd, FILE], { root: w.root, input: input ?? "", out: (l) => { out += l; } });
    assert.equal(code, 1, cmd);
    assert.match(JSON.parse(out).error, /written only by the state-\* verbs/, cmd);
  }
  assert.equal(fs.existsSync(path.join(w.root, FILE)), false);
});

test("RB state-plan: each stage checks its contract; committed and tracked keep the plans record of CR-GSF-02", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  assert.equal((await st(w, "plan", { plan: "x", stage: "dispatched" })).code, 1);
  assert.equal((await st(w, "plan", { plan: "01-01", stage: "done" })).code, 1);
  assert.equal((await st(w, "plan", { plan: "01-01", stage: "dispatched" })).json.state.stages["01-01"].stage, "dispatched");
  const noSummary = await st(w, "plan", { plan: "01-01", stage: "executed", summary: `${PD}/01-01-SUMMARY.md` });
  assert.deepEqual([noSummary.code, noSummary.json.status], [1, "refused"]);
  assert.match(noSummary.json.reason, /no SUMMARY at/);
  w.write(`${PD}/01-01-SUMMARY.md`, "done\n");
  assert.equal((await st(w, "plan", { plan: "01-01", stage: "executed", summary: `${PD}/01-01-SUMMARY.md` })).code, 0);
  assert.match((await st(w, "plan", { plan: "01-01", stage: "transferred" })).json.reason, /no .*transfers\/01-01\.json/);
  assert.match((await st(w, "plan", { plan: "01-01", stage: "tracked" })).json.reason, /no recorded commit/);
  assert.match((await st(w, "plan", { plan: "01-01", stage: "committed", commit: "abc", verify: "green" })).json.reason, /not a commit of this repository/);
  assert.match((await st(w, "plan", { plan: "01-01", stage: "committed", commit: "0".repeat(40), verify: "green" })).json.reason, /not a commit/);
  const sha = commit(w, "c1");
  assert.match((await st(w, "plan", { plan: "01-01", stage: "committed", commit: sha, verify: "maybe" })).json.reason, /green\|skipped/);
  const ok = await st(w, "plan", { plan: "01-01", stage: "committed", commit: sha, verify: "green", evidence: "e.json" });
  assert.deepEqual(ok.json.state.plans["01-01"], { commit: sha, verify: "green", evidence: "e.json" });
  w.write("x.txt", "x\n");
  const other = commit(w, "c2");
  assert.match((await st(w, "plan", { plan: "01-01", stage: "committed", commit: other, verify: "green" })).json.reason, /committed already as/);
  assert.equal((await st(w, "plan", { plan: "01-01", stage: "tracked" })).json.state.plans["01-01"].tracked, true);
  assert.match((await st(w, "plan", { plan: "01-01", stage: "halted" })).json.reason, /needs its reason/);
  assert.equal(onDisk(w).version, 2);
});

test("RB a refused verb writes nothing; every write raises rev", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const a = await st(w, "integration", { op: "add", files: ["a.txt"], why: "test" });
  assert.equal(a.json.state.rev, 1);
  const before = w.read(FILE);
  for (const bad of [{ op: "add", files: ["../out.txt"], why: "x" }, { op: "add", files: ["C:/abs.txt"], why: "x" }, { op: "add", files: ["b.txt"] }, { op: "drop", files: [], why: "x" }]) {
    const r = await st(w, "integration", bad);
    assert.equal(r.code, 1, JSON.stringify(bad));
  }
  assert.equal(w.read(FILE), before);
  const b = await st(w, "integration", { op: "add", files: ["a.txt", "b.txt"], why: "test" });
  assert.deepEqual([b.json.state.rev, b.json.added, b.json.state.integration], [2, ["b.txt"], ["a.txt", "b.txt"]]);
});

test("RB state-request: route and close check their contracts (tree, shared change, resolver, owner, reply)", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]] });
  w.write("src/01-02/api.js", "v1\n");
  const q = { plan: "01-02", from: "01-01", path: "src\\01-02\\api.js", change: "export x", reason: "r" };
  assert.match((await st(w, "request", { op: "route", ...q, path: "docs/kit-feedback.md" })).json.reason, /kitNote/);
  const routed = await st(w, "request", { op: "route", ...q, base: true });
  assert.equal(routed.json.routed, true);
  assert.deepEqual(routed.json.state.requests["01-02"], [{ from: "01-01", path: "src/01-02/api.js", change: "export x", reason: "r" }]);
  assert.equal((await st(w, "request", { op: "route", ...q, base: true })).json.duplicate, true, "the same request is kept once");
  const key = JSON.stringify(["01-02", "01-01", "src/01-02/api.js", "export x"]);
  assert.equal(onDisk(w).requestBase[key], textDigest("v1\n"), "the base is the ph gsd hash digest of the file");
  const id = { op: "close", plan: "01-02", from: "01-01", path: "src/01-02/api.js", change: "export x" };
  assert.match((await st(w, "request", { ...id, by: "tree" })).json.reason, /unchanged since the request/);
  assert.match((await st(w, "request", { ...id, by: "shared-change" })).json.reason, /no applied or cleared shared change/);
  assert.match((await st(w, "request", { ...id, by: "resolver" })).json.reason, /evidence/);
  assert.match((await st(w, "request", { ...id, by: "owner", why: "x" })).json.reason, /request clear/);
  assert.match((await st(w, "request", { ...id, by: "guess", why: "x" })).json.reason, /is not one of/);
  assert.match((await st(w, "request", { ...id, change: "other", by: "reply" })).json.reason, /no open request/);
  w.write("src/01-02/api.js", "v2\n");
  const closed = await st(w, "request", { ...id, by: "changed-since-request" });
  assert.equal(closed.code, 0, JSON.stringify(closed.json));
  assert.deepEqual([closed.json.closed.by, closed.json.state.requests["01-02"], closed.json.state.requestBase[key]], ["tree", [], undefined]);
  // A plan already committed takes no request: the change is a shared change.
  const sha = commit(w, "c");
  await st(w, "plan", { plan: "01-02", stage: "committed", commit: sha, verify: "green" });
  assert.match((await st(w, "request", { op: "route", ...q })).json.reason, /committed: a change to its files is a shared change/);
});

test("RB state-shared: add is idempotent by key, applied needs an open named change, cleared only through state-answer", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const one = { key: "w1:01-01:t", from: "01-01", path: "config/app.json", change: "t" };
  const a = await st(w, "shared", { op: "add", changes: [one, { ...one, path: null }] });
  assert.deepEqual(a.json.added, ["S1", "S2"]);
  assert.deepEqual((await st(w, "shared", { op: "add", changes: [one] })).json.added, [], "the same declared change is added once");
  assert.deepEqual((await st(w, "shared", { op: "tag", wave: "w1" })).json.tagged, ["S1", "S2"]);
  assert.match((await st(w, "shared", { op: "applied", ids: ["S2"] })).json.reason, /names no file/);
  assert.match((await st(w, "shared", { op: "applied", ids: ["S9"] })).json.reason, /no shared change S9/);
  assert.match((await st(w, "shared", { op: "cleared", ids: ["S1"] })).json.reason, /owner's answer/);
  await st(w, "request", { op: "route", plan: "01-01", from: "01-02", path: "config/app.json", change: "c" });
  const done = await st(w, "shared", { op: "applied", ids: ["S1"], link: true });
  assert.deepEqual(done.json.closed.map((x) => [x.plan, x.by]), [["01-01", "shared change"]], "a request to the same path closes with the change");
  assert.match((await st(w, "shared", { op: "applied", ids: ["S1"] })).json.reason, /applied already/);
});

test("RB state-answer takes an owner answer once, and only a shared or request answer", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  await st(w, "shared", { op: "add", changes: [{ from: "01-01", path: "a.json", change: "c", wave: "w1" }] });
  w.write(`${PD}/owner-answers.json`, JSON.stringify([{ id: "OA-1", kind: "halt", plan: "01-01", reason: "r" }, { id: "OA-2", kind: "shared", wave: "1", path: "a.json", reason: "made by hand" }]));
  assert.match((await st(w, "answer", { id: "OA-9" })).json.reason, /no owner answer/);
  assert.match((await st(w, "answer", { id: "OA-1" })).json.reason, /halt answer/);
  const took = await st(w, "answer", { id: "OA-2" });
  assert.deepEqual(took.json.taken, { id: "OA-2", kind: "shared", wave: "1", path: "a.json", reason: "made by hand", matched: 1 });
  assert.deepEqual([took.json.state.shared[0].applied, took.json.state.shared[0].cleared, took.json.state.integration, took.json.state.answered], [true, { answer: "OA-2", reason: "made by hand" }, ["a.json"], ["OA-2"]]);
  assert.match((await st(w, "answer", { id: "OA-2" })).json.reason, /taken already/);
});

// The record of 3c00968 as its gsd-execute wrote it (JSON.stringify(progress, null, 2)): no version, no ids, no stages.
const OLD = (sharedApplied) => ({
  plans: {},
  requests: {},
  shared: [{ key: "w1:01-01:register app config", from: "01-01", path: "config/app.json", change: "register app config", reason: "declared in the plan's <shared_changes>", applied: sharedApplied, wave: "w1" }],
  integration: ["config/app.json"],
});

test("RB state-read migrates a 3c00968 record in memory; the next write stores version 2 and keeps every field", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write(FILE, JSON.stringify({ ...OLD(true), closed: [{ plan: "01-02", from: "01-01", path: "x", by: "tree", why: "w" }], answered: ["OA-1"], smoke: { wave: "w1", changed: ["pubspec.yaml"] } }, null, 2));
  const r = await st(w, "read");
  assert.deepEqual([r.json.exists, r.json.migrated, r.json.state.version, r.json.state.shared[0].id, r.json.state.shared[0].applied], [true, true, 2, "S1", true]);
  assert.equal(JSON.parse(w.read(FILE)).version, undefined, "reading never writes");
  await st(w, "integration", { op: "add", files: ["lib.txt"], why: "test" });
  const now = onDisk(w);
  assert.deepEqual([now.version, now.shared[0].id, now.integration, now.closed.length, now.answered, now.smoke.wave], [2, "S1", ["config/app.json", "lib.txt"], 1, ["OA-1"], "w1"]);
  w.write(FILE, JSON.stringify({ plans: [], shared: {} }));
  assert.match((await st(w, "read")).json.error, /plans is not an object; it is written only by the state-\* flow verbs/);
});

test("RB a run of kit 3c00968 stopped after the shared step resumes on this kit: the wave commits the shared file", async () => {
  const w = world({ isolation: "shared" });
  const first = await exec(w, {}, { ...shared(w), "review-": died("reviewer") });
  assert.equal(first.error?.message, "killed reviewer");
  // As 3c00968 left it: the same facts, written in its shape.
  w.write(FILE, JSON.stringify(OLD(true), null, 2));
  const r = await exec(w, {}, shared(w));
  assert.equal(r.result?.status, "executed", JSON.stringify(r.result?.reason ?? r.error?.message));
  assert.ok(r.logs.some((l) => /written by an older kit; it is migrated/.test(l)));
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("shared-")).length, 0, "the applied change is not made again");
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
  assert.deepEqual([onDisk(w).version, onDisk(w).plans["01-01"].tracked], [2, true]);
});

test("RB open requests of a 3c00968 record are judged by the tree with the digest ph gsd hash gave: changed closes, unchanged stays", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { request_check: "tree", parallelization: { enabled: false, max_concurrent: null } } } });
  w.write("src/01-02/api.js", "v1\n");
  w.write("src/01-02/util.js", "u1\r\n");
  commit(w, "api");
  const q = { from: "01-01", path: "src/01-02/api.js", change: "export x", reason: "01-01 imports it" };
  const u = { from: "01-01", path: "src/01-02/util.js", change: "export y", reason: "r" };
  const keyOf = (x) => JSON.stringify(["01-02", x.from, x.path, x.change]);
  const old = { plans: {}, requests: { "01-02": [q, u] }, requestBase: { [keyOf(q)]: textDigest("v1\n"), [keyOf(u)]: textDigest("u1\r\n") }, shared: [] };
  w.write(FILE, JSON.stringify(old, null, 2));
  const run = executor(w);
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w, { "exec-01-02": async (...a) => { const v = await run(...a); w.write("src/01-02/api.js", "export const x = 1;\n"); return v; } }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Commit"], JSON.stringify(r.result.reason));
  assert.deepEqual(r.result.requestsClosed.map((x) => [x.plan, x.path, x.by]), [["01-02", "src/01-02/api.js", "tree"]]);
  assert.deepEqual(r.result.requests, [u], "the unchanged path is not taken as done");
  assert.match(r.calls.find((c) => c.opts.label === "exec-01-02").prompt, /"from":"01-01","path":"src\/01-02\/api\.js","change":"export x"/, "the migrated request reaches its owner");
});

test("RB gsd-execute writes execute-progress.json only through the state verbs and records the plan lifecycle", async () => {
  const text = fs.readFileSync(path.join(SHIP_DIR, ".agents/workflows/gsd-execute.js"), "utf8");
  assert.doesNotMatch(text, /flow\(\["write", PROGRESS\]/);
  assert.doesNotMatch(text, /saveProgress|integrationFiles|closeRequest|closeLinked/);
  assert.doesNotMatch(text, /progress\.\w+(\[[^\]]+\])?\s*=[^=]/, "no field of the record is assigned in the script");
  const w = world({ isolation: "worktree" });
  const r = await exec(w, {}, shared(w));
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  const verbs = r.shells.filter((s) => s.argv[1] === ".agents/workflows/lib/gsd-flow.mjs" && String(s.argv[2]).startsWith("state-")).map((s) => `${s.argv[2]} ${JSON.parse(s.input ?? "{}").stage ?? JSON.parse(s.input ?? "{}").op ?? ""}`.trim());
  for (const v of ["state-read", "state-plan dispatched", "state-plan executed", "state-plan transferred", "state-shared add", "state-shared tag", "state-integration add", "state-shared applied", "state-plan committed", "state-plan tracked"]) assert.ok(verbs.includes(v), `${v} in ${verbs.join(", ")}`);
  assert.equal(onDisk(w).stages["01-01"].stage, "tracked");
});
