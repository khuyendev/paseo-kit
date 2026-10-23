// Kit feedback #79 (Q79): an executor that routes a change request may report its dependent task `pending-request` (or partial with
// evidence naming only routed requests) without halting the plan; `ph gsd halt clear --resume` transfers the halted plan's finished
// worktree instead of dispatching again; executor observations about the kit travel as `kitNotes`, never as a request against a
// project file (a request for a kit-feedback document is refused).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { gsd as runGsdIn, project as gsdProject } from "../gsd-core/fixture.mjs";

const REPAIR = "lib/client/session/rpc_correlator.dart";
const exec = (w, overrides = {}, args = {}, runId) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides), ...(runId ? { runId } : {}) });
const writeOut = (w, id, n, calls) => {
  const base = calls.find((c) => c.n === n)?.worktree ?? "";
  const at = (rel) => (base ? `${base}/${rel}` : rel);
  w.write(at(`src/${id}/impl.js`), `impl ${id}\n`);
  w.write(at(`${PHASE_DIR}/${id}-SUMMARY.md`), `---\nkey-files:\n  created: [src/${id}/impl.js]\n---\ndone\n`);
};
// An executor reply for 01-01 that writes its output and returns `res`.
const reply = (id, res) => ({ [`exec-${id}`]: (p, o, n, calls) => { writeOut(calls.w, id, n, calls); return res; } });
const withWorld = (w) => (fn) => (p, o, n, calls) => { calls.w = w; return fn(p, o, n, calls); };
function overrides(w, map) { return Object.fromEntries(Object.entries(map).map(([k, fn]) => [k, withWorld(w)(fn)])); }
const request = { path: REPAIR, change: "prefer payload.requestId", reason: "upstream selector" };
const pendingTask = (extra = {}) => ({ task: "3", status: "pending-request", evidence: "regression fails until the repair lands", blockedBy: [REPAIR], ...extra });
const okTask = { task: "1", status: "implemented", evidence: "ok" };
// The shared-change fixer makes the repair, as a real one would.
const sharedFixer = (w) => ({ "shared-": () => { w.write(REPAIR, "// repaired\n"); return { status: "fixed", attempts: 1, remaining_failures: 0 }; } });

function run(res, { overlay, extra = {} } = {}) {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay });
  return exec(w, { ...sharedFixer(w), ...overrides(w, reply("01-01", res)), ...extra }).then((r) => ({ w, r }));
}

// ---- F1 ----

test("Q79 F1 a pending-request task naming the request it routed is done: the shared step runs, the gate proves it, the plan commits", async () => {
  const { w, r } = await run({ taskResults: [okTask, pendingTask()], deviations: [], requests: [request] });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.deepEqual(r.result.pendingRequestTasks, [{ plan: "01-01", task: "3", blockedBy: [REPAIR], via: "blockedBy" }]);
  assert.ok(r.result.events.includes("pending-request 01-01 3"));
  assert.ok(r.result.events.some((e) => e.startsWith("shared w1")), "the shared step ran");
  assert.ok(r.result.events.indexOf("shared w1 1") < r.result.events.findIndex((e) => e.startsWith("gate w1")), "the shared step comes before the gate");
  assert.equal(w.read(REPAIR), "// repaired\n");
  assert.ok(w.events.some((e) => e.startsWith("commit feat(")));
  assert.equal(fs.existsSync(path.join(w.root, PHASE_DIR, "01-01-HALT.json")), false);
});

test("Q79 F1 pending-request is an owner decision when it names no routed request: no blockedBy, an unrouted path, or no request at all", async () => {
  for (const [name, t, requests] of [
    ["no blockedBy", pendingTask({ blockedBy: undefined }), [request]],
    ["an unrouted path", pendingTask({ blockedBy: ["lib/other.dart"] }), [request]],
    ["one routed and one not", pendingTask({ blockedBy: [REPAIR, "lib/other.dart"] }), [request]],
    ["no request routed", pendingTask(), []],
  ]) {
    const { w, r } = await run({ taskResults: [okTask, t], deviations: [], requests });
    assert.equal(r.result.status, "needs-owner", name);
    assert.match(r.result.reason, /owner decision needed: task 3 is pending-request but names no request this plan routed/, name);
    assert.equal(r.result.pendingRequestTasks, undefined, name);
    assert.equal(fs.existsSync(path.join(w.root, PHASE_DIR, "01-01-HALT.json")), true, name);
  }
});

test("Q79 F1 the executor brief and schema offer pending-request and kitNotes; with the setting off they do not", async () => {
  for (const on of [true, false]) {
    const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { pending_request_tasks: on } } });
    let seen = null;
    await exec(w, { "exec-": (p, o) => { seen = { p, o }; } });
    const statuses = seen.o.schema.properties.taskResults.items.properties.status.enum;
    assert.equal(statuses.includes("pending-request"), on);
    assert.equal(/pending-request/.test(seen.p), on);
    assert.match(seen.p, /kitNotes/);
    assert.ok(seen.o.schema.properties.kitNotes);
  }
});

// ---- F2 ----

test("Q79 F2 a partial task whose blockedBy or evidence names only routed requests is no owner decision", async () => {
  for (const [name, t] of [
    ["blockedBy", { task: "3", status: "partial", evidence: "needs the repair", blockedBy: [REPAIR] }],
    ["evidence, full path", { task: "3", status: "partial", evidence: `cannot run tests; its regression fails until ${REPAIR} is repaired` }],
    ["evidence, file name", { task: "3", status: "partial", evidence: "the regression fails until rpc_correlator.dart prefers payload.requestId (daemon-client.ts:2293)" }],
  ]) {
    const { r } = await run({ taskResults: [okTask, t], deviations: [], requests: [request] });
    assert.equal(r.result.status, "executed", name);
    assert.equal(r.result.pendingRequestTasks[0].via, name === "blockedBy" ? "blockedBy" : "evidence", name);
  }
});

test("Q79 F2 a partial task still halts when its evidence names another path, no path, a blocked task or a rule-4 deviation", async () => {
  for (const [name, res] of [
    ["other path", { taskResults: [{ task: "3", status: "partial", evidence: `needs ${REPAIR} and a decision on lib/app/paseo_app.dart` }], deviations: [], requests: [request] }],
    ["no path", { taskResults: [{ task: "3", status: "partial", evidence: "the schema choice is open" }], deviations: [], requests: [request] }],
    ["blocked", { taskResults: [{ task: "3", status: "blocked", evidence: `waits for ${REPAIR}`, blockedBy: [REPAIR] }], deviations: [], requests: [request] }],
    ["rule 4", { taskResults: [{ task: "3", status: "partial", blockedBy: [REPAIR] }], deviations: [{ rule: 4, note: "pick a schema" }], requests: [request] }],
    ["no request", { taskResults: [{ task: "3", status: "partial", evidence: `needs ${REPAIR}` }], deviations: [], requests: [] }],
  ]) {
    const { r } = await run(res);
    assert.equal(r.result.status, "needs-owner", name);
    assert.match(r.result.reason, /owner decision needed/, name);
  }
});

test("Q79 F2 gsd.pending_request_tasks false: every partial task halts, as before", async () => {
  const { r } = await run({ taskResults: [okTask, { task: "3", status: "partial", evidence: "x", blockedBy: [REPAIR] }], deviations: [], requests: [request] }, { overlay: { gsd: { pending_request_tasks: false } } });
  assert.equal(r.result.status, "needs-owner");
  const off = await run({ taskResults: [okTask, pendingTask()], deviations: [], requests: [request] }, { overlay: { gsd: { pending_request_tasks: false } } });
  assert.equal(off.r.result.status, "needs-owner");
});

test("Q79 F2 unchanged: a plain run with implemented tasks and a request has no pendingRequestTasks and no kitNotes", async () => {
  const { r } = await run({ taskResults: [okTask], deviations: [], requests: [request] });
  assert.equal(r.result.status, "executed");
  assert.equal(r.result.pendingRequestTasks, undefined);
  assert.equal(r.result.kitNotes, undefined);
});

// ---- kitNotes ----

test("Q79 kitNotes are logged and returned; a request for the kit-feedback document is refused, recorded as a note and never reaches a fixer", async () => {
  const feedback = { path: "docs/kit-feedback.md", change: "append: the Flutter wrapper has no dart subcommand", reason: "kit feedback" };
  let sharedCalls = 0;
  const { r } = await run({ taskResults: [okTask], deviations: [], requests: [feedback, { path: "Docs/Kit-Feedback.md", change: "second" }], kitNotes: ["fixture regeneration rewrote 132 CRLF fixtures"] }, { extra: { "shared-": () => { sharedCalls++; return { status: "fixed" }; } } });
  assert.equal(r.result.status, "executed");
  assert.equal(sharedCalls, 0);
  assert.deepEqual(r.result.sharedChanges, []);
  assert.deepEqual(r.result.kitNotes.map((k) => [k.plan, k.note, k.from ?? null]), [
    ["01-01", "fixture regeneration rewrote 132 CRLF fixtures", null],
    ["01-01", "append: the Flutter wrapper has no dart subcommand", "request"],
    ["01-01", "second", "request"],
  ]);
  assert.ok(r.logs.some((l) => /kit note 01-01 \(a request for docs\/kit-feedback\.md was refused\)/.test(l)));
});

test("Q79 kitNotes: a request for another file is still routed as a shared change", async () => {
  const { r } = await run({ taskResults: [okTask], deviations: [], requests: [request, { path: "docs/kit-feedback.md", change: "note" }] });
  assert.equal(r.result.status, "executed");
  assert.deepEqual(r.result.sharedChanges.map((s) => s.path), [REPAIR]);
  assert.equal(r.result.kitNotes.length, 1);
});

// ---- F3 ----

// Run 1 halts 01-02 on a decision after it wrote its whole output; the owner then answers with or without --resume.
async function haltedWorld(res) {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation: "worktree" } } });
  const first = await exec(w, overrides(w, reply("01-02", res ?? { taskResults: [{ task: "1", status: "partial", evidence: "which schema?" }], deviations: [{ rule: 4, note: "pick a schema" }], requests: [] })));
  const halt = JSON.parse(w.read(`${PHASE_DIR}/01-02-HALT.json`));
  return { w, first, halt };
}
// What `ph gsd halt clear` leaves.
function clear(w, halt, extra = {}) {
  fs.rmSync(path.join(w.root, PHASE_DIR, "01-02-HALT.json"));
  w.write(`${PHASE_DIR}/halt-answers.json`, JSON.stringify([{ plan: "01-02", halt: halt.reason, haltRunId: halt.runId, haltWorktree: halt.worktree, answer: "the work stands", ...extra }]));
}

test("Q79 F3 a halt of a finished executor result is marked finished and names its worktree", async () => {
  const { first, halt, w } = await haltedWorld();
  assert.equal(first.result.status, "needs-owner");
  assert.equal(halt.finished, true);
  assert.equal(fs.existsSync(path.join(w.root, halt.worktree, "src/01-02/impl.js")), true);
});

test("Q79 F3 after halt clear --resume the next run transfers the halted worktree and runs no executor for the plan", async () => {
  const { w, halt } = await haltedWorld();
  clear(w, halt, { resume: true });
  const second = await exec(w, {}, {}, "wf_20261021-090000_cd34");
  assert.equal(second.result.status, "executed", JSON.stringify(second.result.reason));
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-02").length, 0);
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-01").length, 0, "01-01 was transferred by the first run");
  assert.ok(second.result.events.includes("resume w1 01-02"));
  assert.ok(second.result.events.includes("transfer 01-02"));
  assert.equal(w.read("src/01-02/impl.js"), "impl 01-02\n");
  assert.equal(fs.existsSync(path.join(w.root, PHASE_DIR, "01-02-HALT.json")), false);
  assert.ok(second.result.worktrees.discarded.includes("01-02"), "the transferred tree goes after the commit");
  assert.equal(fs.existsSync(path.join(w.root, halt.worktree)), false);
});

test("Q79 F3 without --resume the plan is dispatched again and its old tree discarded, as before", async () => {
  const { w, halt } = await haltedWorld();
  clear(w, halt);
  const second = await exec(w, {}, {}, "wf_20261021-090000_cd34");
  assert.equal(second.result.status, "executed");
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-02").length, 1);
  assert.ok(!second.result.events.includes("resume w1 01-02"));
  assert.ok(second.logs.some((l) => l.includes(`worktree of the cleared halt ${halt.worktree}: discarded`)));
});

test("Q79 F3 --resume whose worktree is gone dispatches the plan again", async () => {
  const { w, halt } = await haltedWorld();
  w.git("worktree", "remove", "--force", path.join(w.root, halt.worktree));
  clear(w, halt, { resume: true });
  const second = await exec(w, {}, {}, "wf_20261021-090000_cd34");
  assert.equal(second.result.status, "executed");
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-02").length, 1);
  assert.ok(second.logs.some((l) => /gone or holds no SUMMARY; the plan is dispatched again/.test(l)));
});

test("Q79 F3 a later answer without --resume wins over an earlier --resume", async () => {
  const { w, halt } = await haltedWorld();
  clear(w, halt, { resume: true });
  const list = JSON.parse(w.read(`${PHASE_DIR}/halt-answers.json`));
  w.write(`${PHASE_DIR}/halt-answers.json`, JSON.stringify([...list, { plan: "01-02", halt: "again", answer: "redo it" }]));
  const second = await exec(w, {}, {}, "wf_20261021-090000_cd34");
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-02").length, 1);
});

test("Q79 F3 ph gsd halt clear --resume: records resume for a finished halt; refuses an unfinished one and a missing worktree", async () => {
  const wt = ".claude/worktrees/wf_x-2";
  const halt = (extra) => JSON.stringify({ plan: "01-02", reason: "pick", runId: "wf_x", worktree: wt, ...extra });
  const p = gsdProject({ files: { ".planning/phases/01-core/01-02-HALT.json": halt({ finished: true }), ".planning/phases/01-core/01-03-HALT.json": halt({ plan: "01-03", worktree: wt }), ".planning/phases/01-core/01-04-HALT.json": halt({ plan: "01-04", finished: true, worktree: ".claude/worktrees/missing" }) } });
  fs.mkdirSync(path.join(p.root, wt), { recursive: true });
  const bad = await runGsdIn(p, ["halt", "clear", "1", "--plan", "01-03", "--reason", "ok", "--resume"]);
  assert.notEqual(bad.code, 0);
  assert.match(JSON.stringify(bad.json) + bad.err.join(""), /no finished executor worktree/);
  assert.ok(fs.existsSync(path.join(p.root, ".planning/phases/01-core/01-03-HALT.json")), "a refused clear keeps the record");
  const gone = await runGsdIn(p, ["halt", "clear", "1", "--plan", "01-04", "--reason", "ok", "--resume"]);
  assert.notEqual(gone.code, 0);
  assert.match(JSON.stringify(gone.json) + gone.err.join(""), /is gone/);
  const ok = await runGsdIn(p, ["halt", "clear", "1", "--plan", "01-02", "--reason", "the work stands", "--resume"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.equal(ok.json.resume, true);
  const list = p.readJson(".planning/phases/01-core/halt-answers.json");
  assert.deepEqual(list.map((a) => [a.plan, a.resume, a.haltWorktree]), [["01-02", true, wt]]);
  const plain = await runGsdIn(p, ["halt", "clear", "1", "--plan", "01-03", "--reason", "redo"]);
  assert.equal(plain.code, 0);
  assert.equal(p.readJson(".planning/phases/01-core/halt-answers.json").at(-1).resume, undefined);
});
