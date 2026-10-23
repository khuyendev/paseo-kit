// THIN.md stage 2 (TE, kit feedback 87): the decisions gsd-execute.js took inline are flow verbs `exec-*` (lib/flow-exec.mjs),
// JSON in and out, at most one record written. Each test runs the verb through gsd-flow.mjs as a composition does.
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { makeTempProject } from "../helpers/temp.mjs";

const PD = ".planning/phases/01-core";
async function verb(root, argv, input) {
  const lines = [];
  const code = await main(argv, { root, input: input === undefined ? "" : JSON.stringify(input), out: (l) => lines.push(l) });
  return { code, json: JSON.parse(lines.at(-1)) };
}
const bare = () => makeTempProject({ git: false });

test("TE exec-args validates and normalises the arguments (GSDF-93, kit feedback 88)", async () => {
  const { root } = bare();
  assert.deepEqual((await verb(root, ["exec-args"], { args: { phaseDir: PD, plans: "01-01, 01-02", wave: "2", gapsOnly: 1, files: ["a.js"] } })).json, { status: "ok", phaseDir: PD, plans: ["01-01", "01-02"], wave: 2, stopAfterWave: null, gapsOnly: true, files: ["a.js"] });
  assert.deepEqual((await verb(root, ["exec-args"], { args: { phaseDir: PD, stopAfterWave: null } })).json, { status: "ok", phaseDir: PD, plans: null, wave: null, stopAfterWave: null, gapsOnly: false });
  for (const [args, reason] of [[null, /phaseDir must match/], [{ phaseDir: "../x" }, /phaseDir must match/], [{ phaseDir: PD, plans: ["1"] }, /plans must be plan ids NN-MM/], [{ phaseDir: PD, wave: 0 }, /wave must be an integer >= 1/], [{ phaseDir: PD, wave: null }, /wave must be/], [{ phaseDir: PD, stopAfterWave: 1.5 }, /stopAfterWave must be an integer >= 1/]]) {
    const r = await verb(root, ["exec-args"], { args });
    assert.equal(r.code, 1);
    assert.equal(r.json.status, "failed");
    assert.match(r.json.reason, reason);
  }
});

test("TE exec-setup derives the run settings and the agent schemas (plan defects with review_metrics, pending-request with the policy)", async () => {
  const p = makeTempProject({ git: false, overlay: { gsd: { review_metrics: true, isolation: "worktree" }, adapter: { stack_skill: "flutter" } } });
  const base = loadConfig(p.root);
  const cfg = { ...base, adapter: { ...base.adapter, ownership: { ...base.adapter.ownership, regenerated: ["lib/**/*.g.dart"] } } };
  const s = (await verb(p.root, ["exec-setup"], { cfg, args: { phaseDir: PD, gapsOnly: true, stopAfterWave: null }, pending: true })).json;
  assert.deepEqual([s.N, s.nn, s.prefix, s.worktreeMode, s.metricsOn, s.stackSkill, s.generated], ["01", "01", "gap-", true, true, ".claude/skills/flutter/SKILL.md", '["lib/**/*.g.dart"]']);
  assert.ok(s.schemas.exec.properties.plan_defects && s.schemas.fixer.properties.plan_defects && s.schemas.shared.properties.plan_defects);
  assert.deepEqual(s.schemas.exec.properties.taskResults.items.properties.status.enum, ["implemented", "pending-request", "partial", "blocked", "skipped"]);
  assert.ok(s.schemas.verdict.properties.verdicts.items.properties.plan_catchable);
  assert.deepEqual(Object.keys(s.schemas.shared.properties).slice(-2), ["changes", "outside"]);
  const off = (await verb(p.root, ["exec-setup"], { cfg: { ...cfg, gsd: { ...cfg.gsd, review_metrics: false } }, args: { phaseDir: PD, stopAfterWave: null }, pending: false })).json;
  assert.equal(off.schemas.exec.properties.plan_defects, undefined);
  assert.deepEqual(off.schemas.exec.properties.taskResults.items.properties.status.enum, ["implemented", "partial", "blocked", "skipped"]);
  assert.equal(off.schemas.verdict.properties.verdicts.items.properties.plan_catchable, undefined);
  assert.equal(off.prefix, "");
});

test("TE exec-handoff reads the wave files and the manifest; a malformed wave file is a failed status naming it (G098)", async () => {
  const p = makeTempProject({ git: false, files: { [`${PD}/handoff/w1.args.json`]: JSON.stringify({ tasks: [{ plan: "01-01" }], planRevision: "r" }), [`${PD}/handoff/manifest.json`]: JSON.stringify({ waves: 1, planRevision: "r" }) } });
  const ok = (await verb(p.root, ["exec-handoff", PD], { prefix: "" })).json;
  assert.deepEqual(ok, { status: "ok", waves: [{ k: 1, waveId: "w1", tasks: [{ plan: "01-01" }], planRevision: "r" }], manifest: { exists: true, value: { waves: 1, planRevision: "r" } } });
  assert.deepEqual((await verb(p.root, ["exec-handoff", PD], { prefix: "gap-" })).json, { status: "ok", waves: [], manifest: { exists: false, value: null } });
  p.write(`${PD}/handoff/w2.args.json`, "{bad");
  const bad = await verb(p.root, ["exec-handoff", PD], { prefix: "" });
  assert.equal(bad.code, 1);
  assert.match(bad.json.reason, /handoff\/w2\.args\.json is not valid handoff JSON/);
});

test("TE exec-select checks the handoff against the plans and routes a run with nothing left (G075, GSDF-30)", async () => {
  const { root } = bare();
  const handoff = [{ k: 1, tasks: [{ plan: "01-01", planHash: "a" }], planRevision: "r" }, { k: 2, tasks: [{ plan: "01-02", planHash: "b" }], planRevision: "r" }];
  const plans = [{ id: "01-01", plan_hash: "a", has_summary: false, ready: true }, { id: "01-02", plan_hash: "b", has_summary: false, ready: false }];
  const sel = (extra) => verb(root, ["exec-select", PD], { prefix: "", handoff, manifest: { exists: true, value: { waves: 2, planRevision: "r" } }, plans, state: { plans: {} }, filter: { plans: null, wave: null, gapsOnly: false }, ...extra }).then((r) => r.json);
  assert.deepEqual(await sel(), { status: "ok", warnings: [] });
  assert.deepEqual((await sel({ manifest: { exists: false, value: null } })).warnings, [`${PD}/handoff/ has no manifest.json (an older kit); the wave set is not checked`]);
  assert.match((await sel({ manifest: { exists: true, value: { waves: 3, planRevision: "r" } } })).stop.extra.reason, /incomplete or mixed \(2 wave files, the manifest names 3\)/);
  assert.deepEqual((await sel({ plans: [{ ...plans[0], plan_hash: "z" }, plans[1], { id: "01-03", plan_hash: "c" }] })).stop.extra.stale, ["01-01 changed after the handoff", "01-03 is in no handoff wave"]);
  assert.match((await sel({ filter: { plans: null, wave: null, gapsOnly: true } })).stop.extra.reason, /needs a gap_closure key in every plan; missing in 01-01, 01-02/);
  assert.match((await sel({ filter: { plans: null, wave: 2, gapsOnly: false } })).stop.extra.reason, /wave 2 refused: lower waves have incomplete plans 01-01/);
  assert.deepEqual((await sel({ filter: { plans: ["01-09"], wave: null, gapsOnly: false } })).stop, { status: "nothing-to-run", extra: { route: "none", reason: "no matching plans" } });
  const stuck = await sel({ plans: [{ ...plans[0], ready: false, halted: true }, plans[1]] });
  assert.deepEqual([stuck.stop.extra.route, /ph gsd halt clear 01 --plan <id>/.test(stuck.stop.extra.reason)], ["stuck", true]);
  const done = { plans: { "01-01": { tracked: true }, "01-02": { tracked: true } } };
  assert.equal((await sel({ state: done })).status, "verification");
  for (const [verification, route] of [[{ code: 66, status: null }, "verify"], [{ code: 0, status: "stale" }, "verify"], [{ code: 0, status: "passed" }, "complete"], [{ code: 0, status: "gaps_found" }, "plan-gaps"], [{ code: 0, status: "human_needed" }, "uat"]]) {
    assert.equal((await sel({ state: done, verification })).stop.extra.route, route, JSON.stringify(verification));
  }
});

test("TE exec-records reads grants, owner answers, halt answers, review notes and cleared-halt worktrees", async () => {
  const p = makeTempProject({ git: false, files: {
    [`${PD}/grants.json`]: JSON.stringify([{ path: "a.js" }]),
    [`${PD}/owner-answers.json`]: JSON.stringify([{ id: "A1", kind: "shared" }, { id: "A2", kind: "halt" }, { kind: "request" }]),
    [`${PD}/halt-answers.json`]: JSON.stringify([{ plan: "01-01", halt: "h", answer: "a", haltWorktree: ".claude/worktrees/old", haltRunId: "wf_old" }, { plan: "01-01", halt: "h2", answer: "b", haltWorktree: ".claude/worktrees/mine", haltRunId: "wf_me", resume: true }]),
    [`${PD}/plan-review-notes.json`]: JSON.stringify([{ plan: "01-01", severity: "low", description: "n", extra: 1 }, { plan: "01-02", severity: "low", description: "m" }]),
    ".claude/worktrees/mine/s.md": "summary\n",
  } });
  const all = (await verb(p.root, ["exec-records", PD], { runId: "wf_me" })).json;
  assert.deepEqual(all, { grants: ["a.js"], ownerAnswers: [{ id: "A1", kind: "shared" }] });
  const one = (await verb(p.root, ["exec-records", PD], { runId: "wf_me", plan: "01-01", summary: "s.md", worktrees: true, worktreeDir: ".claude/worktrees" })).json;
  assert.deepEqual(one.answers, [{ halt: "h", answer: "a" }, { halt: "h2", answer: "b" }]);
  assert.deepEqual(one.notes, [{ severity: "low", description: "n" }]);
  assert.deepEqual(one.discard, [".claude/worktrees/old"]);
  assert.equal(one.resume, ".claude/worktrees/mine");
  const gone = (await verb(p.root, ["exec-records", PD], { runId: "wf_me", plan: "01-01", summary: "none.md", worktrees: true, worktreeDir: ".claude/worktrees" })).json;
  assert.equal(gone.resume, undefined);
  assert.match(gone.resumeNote, /the worktree \.claude\/worktrees\/mine of the cleared halt \(--resume\) is gone or holds no SUMMARY/);
  p.write(`${PD}/owner-answers.json`, JSON.stringify({ not: "a list" }));
  assert.equal((await verb(p.root, ["exec-records", PD], { runId: "wf_me" })).json.ownerAnswers, null);
});

test("TE exec-route routes requests to the open plan owning the path, else to a shared change; kit-feedback requests are kit notes", async () => {
  const { root } = bare();
  const reply = { kitNotes: [" wrapper slow ", ""], requests: [{ path: ".\\src\\b\\x.js", change: "c", reason: "r" }, { path: "docs/kit-feedback.md", change: "note this" }, { path: "lib/none.js", change: "d", via: "gen", outputs: ["lib/none.js"] }, { path: " " }] };
  const r = (await verb(root, ["exec-route"], { from: "01-01", reply, plans: [{ id: "01-02", owns: ["Path:src/b/"] }] })).json;
  assert.deepEqual(r.notes, [{ plan: "01-01", note: "wrapper slow" }, { plan: "01-01", note: "note this", from: "request", path: "docs/kit-feedback.md" }]);
  assert.deepEqual(r.routes, [{ plan: "01-02", q: { from: "01-01", path: "src/b/x.js", change: "c", reason: "r" } }, { plan: null, q: { from: "01-01", path: "lib/none.js", change: "d", via: "gen", outputs: ["lib/none.js"] } }]);
  assert.deepEqual(r.asked.map((x) => [x.path, x.plan]), [["src/b/x.js", "01-02"], ["lib/none.js", null]]);
  assert.deepEqual((await verb(root, ["exec-route"], { reply: null, plans: [] })).json, { notes: [], routes: [], asked: [] });
});

test("TE exec-verdict: Rule 4 and checkpoints need the owner; a task waiting only for routed requests is accepted (kit feedback 79); G058", async () => {
  const { root } = bare();
  const v = (input) => verb(root, ["exec-verdict"], { plan: "01-01", requests: { "01-02": [{ from: "01-01", path: "src/b/x.js" }] }, shared: [], pending: true, ...input }).then((r) => r.json);
  const ok = { taskResults: [{ task: "T1", status: "implemented" }] };
  assert.deepEqual(await v({ reply: ok, hasSummary: true, taskCount: 1, summary: "s.md" }), { decision: null, pending: [] });
  const rule4 = await v({ reply: { ...ok, deviations: [{ rule: "4", note: "pick a db" }] }, hasSummary: true });
  assert.deepEqual(rule4.halt, { why: "owner decision needed: pick a db", decision: { rule: "4", note: "pick a db" } });
  const waits = await v({ reply: { taskResults: [{ task: "T1", status: "pending-request", blockedBy: ["src/b/x.js"] }, { task: "T2", status: "partial", evidence: "needs src/b/x.js" }] }, hasSummary: true, taskCount: 2 });
  assert.deepEqual(waits.pending, [{ plan: "01-01", task: "T1", blockedBy: ["src/b/x.js"], via: "blockedBy" }, { plan: "01-01", task: "T2", blockedBy: ["src/b/x.js"], via: "evidence" }]);
  assert.equal(waits.halt, undefined);
  const stray = await v({ reply: { taskResults: [{ task: "T1", status: "pending-request", blockedBy: ["src/c.js"] }] } });
  assert.match(stray.decision.note, /task T1 is pending-request but names no request this plan routed/);
  assert.equal((await v({ reply: { taskResults: [{ task: "T1", status: "partial", evidence: "src/b/x.js" }] }, pending: false })).decision.task, "T1");
  assert.equal((await v({ reply: { taskResults: [] }, hasSummary: true, taskCount: 1 })).halt.why, "executor reported 0 task result(s) for 1 task(s)");
  assert.equal((await v({ reply: { taskResults: [{ task: "T1", status: "skipped", evidence: "why" }] }, hasSummary: true })).halt.why, "owner decision needed: task T1 was skipped (why)");
  assert.deepEqual((await v({ reply: ok, hasSummary: false, summary: "s.md" })).halt, { why: "no SUMMARY at s.md" });
});

test("TE exec-fixers and exec-round-end: fixer routing (G064), owner decisions that still fail, soft failures and the stall rule", async () => {
  const { root } = bare();
  const gate = { green: false, failureCount: 3, byPlan: { "01-01": [{ step: "t" }], "01-09": [{ step: "u" }] }, unplaced: [{ step: "a", files: ["x.js", "y.js"] }, { step: "b", files: ["x.js"] }, { step: "c" }] };
  const f = (await verb(root, ["exec-fixers"], { gate, plans: ["01-01", "01-02"], worktreeMode: true, trees: [] })).json;
  assert.deepEqual([f.plans, f.files, f.fileless, f.placed.length], [[{ id: "01-01", kind: "fixer", failures: [{ step: "t" }] }], ["x.js", "y.js"], 1, 2]);
  assert.equal((await verb(root, ["exec-fixers"], { gate, plans: ["01-01"], worktreeMode: true, trees: ["01-01"] })).json.plans[0].kind, "executor");
  const end = (input) => verb(root, ["exec-round-end"], { decisions: [], soft: [], done: false, stall: { prev: 3, noDrop: 0 }, ...input }).then((r) => r.json);
  const d = { id: "01-01", decision: { note: "decide" } };
  const stuck = await end({ decisions: [d, { id: "01-02", decision: { status: "partial" } }], gate });
  assert.deepEqual(stuck.stuck, { reason: "owner decision needed in the fix of 01-01: decide", decision: { note: "decide" } });
  assert.deepEqual(stuck.logs, ['fix of 01-02 reported "partial", but its failures are gone after the transfer and the rerun; not an owner decision']);
  assert.equal((await end({ soft: [{ id: null, why: "integration unresolved" }], gate })).still, "integration unresolved");
  assert.deepEqual(await end({ gate }), { logs: [], stall: { prev: 3, noDrop: 1 }, stalled: false });
  assert.equal((await end({ gate, stall: { prev: 3, noDrop: 1 } })).stalled, true);
  assert.deepEqual((await end({ gate: { ...gate, failureCount: 2 }, stall: { prev: 3, noDrop: 1 } })).stall, { prev: 2, noDrop: 0 });
  assert.equal((await end({ gate, done: true, stall: { prev: 3, noDrop: 1 } })).stalled, false);
});

test("TE exec-verdicts merges verifier answers: two attempts, a second verifier for uncertain ones, evidence kept (G081)", async () => {
  const { root } = bare();
  const step = (input) => verb(root, ["exec-verdicts"], { metrics: true, ...input }).then((r) => r.json);
  let { seen } = await step({ ids: ["F1", "F2", "F3"], reply: { verdicts: [{ id: "F1", verdict: "confirmed", evidence: "e1", plan_catchable: "yes", catch_reason: "plan said so" }, { id: "F2", verdict: "uncertain", evidence: "e2" }, { id: "F9", verdict: "confirmed" }] } });
  ({ seen } = await step({ seen, ids: ["F2"], second: true, reply: { verdicts: [{ id: "F2", verdict: "refuted", evidence: "e2b" }] } }));
  const out = (await step({ seen, ids: ["F1", "F2", "F3"], final: true })).findings;
  assert.deepEqual(out, [
    { verdict: "confirmed", verdictEvidence: "e1", planCatchable: "yes", catchReason: "plan said so" },
    { verdict: "refuted", verdictEvidence: "e2 | second verifier: e2b" },
    { verdict: "unverified", verdictEvidence: "no verifier answered" },
  ]);
  const still = await step({ seen: { verdicts: { F2: "uncertain" }, evidence: { F2: "e" }, catchable: {} }, ids: ["F2"], second: true, reply: { verdicts: [{ id: "F2", verdict: "uncertain", evidence: "" }] } });
  assert.deepEqual(still.seen.verdicts, { F2: "uncertain" });
});

test("TE exec-review and exec-findings: the record is reused for the same work; findings are gated, downgraded, deferred or pre-existing", async () => {
  const p = makeTempProject({ files: { "src/a.js": "1\n2\n3\n", [`${PD}/01-01-SUMMARY.md`]: "---\nkey-files:\n  created: [src/a.js]\n---\n" } });
  const input = { waveId: "w1", plan: "01-01", planHash: "h", summarySha: "s", files: ["src/a.js"], filterExplicit: false, summary: `${PD}/01-01-SUMMARY.md`, evaluation: [], lenses: [{ name: "sql", text: "SQL", applies_to: ["**/*.sql"] }], reviewers: [[null, null]], codeOnly: false };
  const first = (await verb(p.root, ["exec-review", PD], input)).json;
  assert.deepEqual([first.replay, first.record.scope, first.record.lenses, first.record.key], [undefined, ["src/a.js"], ["correctness"], { plan: "h", summary: "s", lenses: ["correctness"], reviewers: [[null, null]] }]);
  assert.match(first.lensText, /^- correctness: Follow the lens text/);
  assert.match(first.changedText, /^- src\/a\.js: /);
  const fd = (await verb(p.root, ["exec-findings"], { plan: "01-01", changed: { "src/a.js": [[1, 1]] }, replies: [[
    { severity: "HIGH", trigger: "x", likelihood: "likely", confidence: 90, file: "src/a.js", line: 2, description: "gated" },
    { id: "K", severity: "high", trigger: "", likelihood: "likely", confidence: 90, file: "src/a.js", line: 1, description: "no trigger" },
    { severity: "low", trigger: "x", likelihood: "likely", confidence: 90, file: "src/a.js", line: 1, description: "low" },
    { severity: "critical", trigger: "x", likelihood: "likely", confidence: 99, file: "src/a.js", line: 40, description: "far away", introduced: false },
  ], [{ severity: "high", trigger: "x", likelihood: "theoretical", confidence: 90, file: "src/a.js", line: 1, description: "r2" }]] })).json;
  assert.deepEqual(fd.findings.map((f) => [f.id, f.status]), [["01-01-F1", "gated"], ["K", "downgraded"], ["01-01-F3", "deferred"], ["01-01-F4", "pre-existing"], ["R2-01-01-F1", "downgraded"]]);
  assert.deepEqual(fd.counts, { deferred: 4, downgraded: 2, preExisting: 1 });
  assert.equal(fd.deferredLines[2], "- 01-01-F4 (critical, pre-existing) plan 01-01 src/a.js:40: far away [reason: outside the lines this plan changed (pre-existing)]");
  const unknown = (await verb(p.root, ["exec-findings"], { plan: "01-01", changed: {}, replies: [[{ severity: "blocker", description: "x" }]] })).json;
  assert.deepEqual([unknown.unknownSeverities, unknown.expected], [["blocker"], "critical|high|medium|low|info"]);
  // A recorded review of the same work and code is replayed; after a fix pass only the resolution check runs again.
  const record = { ...first.record, findings: [{ ...fd.findings[0], verdict: "uncertain" }, { ...fd.findings[1] }] };
  p.write(`${PD}/review/w1-01-01.json`, JSON.stringify(record));
  const again = (await verb(p.root, ["exec-review", PD], input)).json;
  assert.deepEqual([again.replay, again.openAt], ["review", [0]]);
  p.write(`${PD}/review/w1-01-01.json`, JSON.stringify({ ...record, findings: [{ ...fd.findings[0], verdict: "confirmed" }], fixPass: 1 }));
  assert.equal((await verb(p.root, ["exec-review", PD], input)).json.replay, "resolution");
  assert.equal((await verb(p.root, ["exec-review", PD], { ...input, planHash: "other" })).json.replay, undefined);
});

test("TE exec-pause names the last wave reached, the reason and the answer (kit feedback 88); exec-groups keeps overlapping plans apart (GSDF-40)", async () => {
  const { root } = bare();
  const waves = [{ k: 1, plans: ["01-01"] }, { k: 2, plans: ["01-02"] }];
  const p1 = (await verb(root, ["exec-pause"], { by: "stopAfterWave", nextWave: 2, stopAfterWave: 1, waves, state: { plans: { "01-01": { commit: "abc" } } } })).json;
  assert.deepEqual(p1.pausedAt, { by: "stopAfterWave", afterWave: 1, nextWave: 2 });
  assert.equal(p1.reason, "stopAfterWave 1: paused after wave 1 (committed)");
  assert.match(p1.answer.command, /^rerun with the same args without stopAfterWave/);
  const p2 = (await verb(root, ["exec-pause"], { by: "stop-request", nextWave: 1, stop: { reason: "kit update" }, run: "wf_x", waves, state: { plans: {} } })).json;
  assert.equal(p2.reason, "stop requested (kit update): paused before its first wave");
  assert.deepEqual(p2.answer, { verb: "rerun", command: "rerun with the same args (or ph workflow --resume wf_x); the committed waves are tracked and the run goes on with wave 1" });
  const g = (await verb(root, ["exec-groups"], { tasks: [{ plan: "a", files: ["x"] }, { plan: "b", files: ["y"] }, { plan: "c", files: ["x", "y"] }, { plan: "d", files: ["x"] }] })).json;
  assert.deepEqual(g, { groups: [[0, 1], [2], [3]], defects: ["c", "d"] });
});

test("TE exec-defect records plan-defect events: a replayed event replaces its copy, a repeated one counts up (kit feedback 64)", async () => {
  const p = makeTempProject({ git: false });
  const ev = (input) => verb(p.root, ["exec-defect", PD], { runId: "wf_r", ...input }).then((r) => r.json);
  let { log } = await ev({ log: null });
  assert.deepEqual(log, { events: [], occ: {} });
  ({ log } = await ev({ log, kind: "halt", extra: { plan: "01-01", reason: "r" }, reply: { plan_defects: [{ kind: "wrong-api", evidence: "e" }, { kind: "bogus" }], requests: [{ path: "src\\x.js" }, { path: "kit-feedback.md" }] } }));
  ({ log } = await ev({ log, kind: "halt", extra: { plan: "01-01", reason: "r" } }));
  const disk = p.readJson(`${PD}/prereview/execute-wf_r.json`);
  assert.deepEqual(disk.events.map((e) => [e.kind, e.cause, e.occ, e.defects.length]), [["halt", "plan", 1, 2], ["halt", "other", 2, 0]]);
  assert.deepEqual(disk.events[0].defects, [{ kind: "wrong-api", evidence: "e" }, { kind: "owns-reach", evidence: "request for src/x.js" }]);
  // A resumed run reads the record and replaces the event it replays.
  const resumed = await ev({ log: null });
  const again = await ev({ log: resumed.log, kind: "halt", extra: { plan: "01-01", reason: "r" }, defects: [{ kind: "other", evidence: "x" }] });
  assert.deepEqual(p.readJson(`${PD}/prereview/execute-wf_r.json`).events.map((e) => [e.occ, e.cause]), [[1, "plan"], [2, "other"]]);
  assert.deepEqual(again.defects, [{ kind: "other", evidence: "x" }]);
  p.write(`${PD}/prereview/execute-wf_r.json`, "{bad");
  assert.match((await ev({ log: null })).warning, /unreadable; it is written again/);
});

test("TE exec-branch refuses without origin and creates nothing (GSDF-54)", async () => {
  const p = makeTempProject();
  const r = await verb(p.root, ["exec-branch", PD]);
  assert.equal(r.code, 1);
  assert.equal(r.json.reason, "branching phase: fetch of origin/main failed and no local origin/main; no branch created");
  assert.equal(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/gsd/phase-01-core"], { cwd: p.root }).status, 1);
  p.git("checkout", "-q", "-b", "gsd/phase-01-core");
  assert.deepEqual((await verb(p.root, ["exec-branch", PD])).json, { status: "ok", switched: false, branch: "gsd/phase-01-core" });
});
