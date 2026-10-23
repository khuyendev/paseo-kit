// O64 (kit feedback 64): the pre-code reviews (skeleton lanes, plan checker, plan review) had only a cost, no measure of
// effect. gsd-plan and gsd-plan-review now record every finding with a class and its fate, the finding verifier tags each
// confirmed code finding plan-catchable, gsd-execute records its halts, red gates and fix calls with their plan-defect cause,
// and `ph review-stats --stage` prints cost per confirmed finding and escapes per stage. Measurement only (gsd.review_metrics).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { assertErrLine, assertExit, assertLine } from "../helpers/assert.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";
import { setup } from "../workflow/helpers.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const RUN = "wf_20261020-120000_ab12";
const NODE = process.execPath;
const FLAG_TEST = [NODE, "-e", "const fs=require('fs');if(fs.existsSync('fail.flag')){console.log('error '+fs.readFileSync('fail.flag','utf8').trim());process.exit(1)}"];
const flagCommands = { build: [NODE, "-e", "process.exit(0)"], test: FLAG_TEST, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
const off = { gsd: { review_metrics: false } };

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const exec = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const prereviewDir = (w) => path.join(w.root, PHASE_DIR, "prereview");
const record = (w, stage, runId = RUN) => JSON.parse(w.read(`${PHASE_DIR}/prereview/${stage}-${runId}.json`));
const fates = (rec) => Object.fromEntries(rec.findings.map((f) => [f.id, [f.fate, f.confirmed]]));
const ids = (p) => [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => m[1]);

// A skeleton lane with one blocker its resolution check confirms, one warning and one info note; a checker blocker a later
// checker lists resolved, and a warning.
const skeletonAndChecker = () => ({
  "skeleton-L1": () => ({ issues: [
    { plan: "01-01", dimension: "fidelity-scope", severity: "blocker", required_property: "covers R-1", description: "b1", target: "outline" },
    { plan: "01-02", dimension: "naming", severity: "warning", description: "w1", target: "outline" },
    { severity: "info", description: "i1" },
  ] }),
  "resolve-L1": () => ({ resolved: [{ id: "L1-1", evidence: "the revision covers R-1" }] }),
  "checker-": (p, o) => (o.label === "checker-1"
    ? { issues: [{ plan: "01-01", dimension: "task_completeness", severity: "blocker", required_property: "verify step", description: "c1" }, { plan: "01-02", dimension: "scope", severity: "warning", required_property: "files", description: "cw" }] }
    : { issues: [], resolved: [{ id: "open-1", evidence: "added" }] }),
});

test("O64 gsd.review_metrics defaults to true and validates; a non-boolean is rejected", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.equal(defaults.gsd.review_metrics, true);
  assert.doesNotThrow(() => validateAgainstSchema(defaults));
  assert.throws(() => validateAgainstSchema({ ...defaults, gsd: { ...defaults.gsd, review_metrics: "yes" } }), /review_metrics/);
});

test("O64 prereview-record writes one file per stage and run id and refuses an unknown fate or stage", async () => {
  const w = makeWorld();
  const call = async (input) => {
    let line = "";
    const code = await main(["prereview-record", PHASE_DIR], { root: w.root, input: JSON.stringify(input), out: (l) => { line = l; } });
    return { code, json: JSON.parse(line) };
  };
  const ok = await call({ stage: "checker", runId: RUN, findings: [{ id: "K1", fate: "applied", blocking: true, confirmed: true }] });
  assert.deepEqual([ok.code, ok.json.record], [0, `${PHASE_DIR}/prereview/checker-${RUN}.json`]);
  assert.equal(record(w, "checker").v, 1);
  const bad = await call({ stage: "checker", runId: RUN, findings: [{ id: "K1", fate: "fixed", blocking: true, confirmed: true }] });
  assert.equal(bad.code, 1);
  assert.match(bad.json.errors.join(" "), /findings\[0\]\.fate/);
  assert.equal((await call({ stage: "code", runId: RUN, findings: [] })).code, 1);
  assert.equal((await call({ stage: "execute", runId: RUN, events: [{ kind: "halt", cause: "plan", defects: [{ kind: "typo" }] }] })).code, 1);
  assert.deepEqual(fs.readdirSync(prereviewDir(w)), [`checker-${RUN}.json`]);
});

test("O64 gsd-plan records the skeleton and checker findings with class and fate; confirmed are the applied blockers", async () => {
  const w = makeWorld();
  const r = await plan(w, {}, skeletonAndChecker());
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const sk = record(w, "skeleton");
  assert.deepEqual([sk.stage, sk.runId, sk.mode], ["skeleton", RUN, "plan"]);
  assert.deepEqual(fates(sk), { "L1-1": ["applied", true], "L1-2": ["carried", false], "L1-info-1": ["carried", false] });
  assert.deepEqual(sk.findings.map((f) => [f.class, f.lens, f.source]), [["fidelity-scope", "fidelity", "lane"], ["naming", "fidelity", "lane"], ["fidelity", "fidelity", "lane"]]);
  const ck = record(w, "checker");
  assert.deepEqual(ck.findings.map((f) => [f.id, f.plan, f.class, f.severity, f.fate, f.confirmed]), [["K1", "01-01", "task_completeness", "blocker", "applied", true], ["K2", "01-02", "scope", "warning", "carried", false]]);
  assert.ok(r.logs.includes(`log review metrics: ${PHASE_DIR}/prereview/checker-${RUN}.json`));
  // The ledger never reaches a prompt: the revision sees the checker's issue as the checker wrote it.
  assert.doesNotMatch(r.calls.find((c) => c.opts.label === "revise-01-01-1").prompt, /"lid"|K1/);
});

test("O64 gsd-plan-review records each finder issue with its lens and fate: rejected, duplicate, carried, applied", async () => {
  const w = makeWorld();
  let cycle = 0;
  const r = await plan(w, { planReview: true }, {
    ...skeletonAndChecker(),
    "find-01-01": () => (cycle ? { issues: [] } : { issues: [{ severity: "high", description: "h1" }, { severity: "medium", description: "m1" }, { severity: "low", description: "l1" }, { severity: "high", description: "h1 again" }] }),
    "find-01-02": () => ({ issues: cycle ? [] : [{ severity: "high", description: "bogus" }] }),
    "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: id !== "C1-2-1" })) }),
    "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: id !== "C1-1-3", ...(id === "C1-1-4" ? { duplicate_of: "C1-1-1" } : {}) })) }),
    "editor-": () => { cycle++; return { marker: "REVISION COMPLETE" }; },
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const pr = record(w, "plan");
  assert.deepEqual(fates(pr), { "C1-1-1": ["applied", true], "C1-1-2": ["carried", false], "C1-1-3": ["rejected", false], "C1-1-4": ["duplicate", false], "C1-2-1": ["rejected", false] });
  assert.deepEqual([...new Set(pr.findings.map((f) => f.class))], ["source-grounding"]);
  // The verifier and judge prompts carry the issues as before: no lens or fate field was added to them.
  assert.doesNotMatch(r.calls.find((c) => c.opts.label === "verify-01-01").prompt, /"fate"|"lens"/);
});

test("O64 a stage that stops still records: unjudged plan-review issues, a checker conflict; a resumed run keeps one file per stage", async () => {
  const w = makeWorld();
  const failed = await plan(w, { planReview: true }, {
    "find-01-01": () => ({ issues: [{ severity: "high", description: "h1" }] }),
    "find-01-02": () => NULL("finished without a reply"),
  });
  assert.deepEqual([failed.result.status, failed.result.stage], ["failed", "Plan review"]);
  assert.deepEqual(fates(record(w, "plan")), { "C1-1-1": ["unjudged", false] });

  const c = makeWorld();
  const conflict = await plan(c, {}, {
    "checker-": () => ({ issues: [{ plan: "01-01", dimension: "scope", severity: "blocker", required_property: "x holds", description: "x" }] }),
    "revise-01-01": () => ({ marker: "REVISION_CONFLICT", conflict: { issue: "x", decision: "D-01" } }),
  });
  assert.equal(conflict.result.marker, "REVISION_CONFLICT");
  assert.deepEqual(fates(record(c, "checker")), { K1: ["conflict", false] });

  // A resumed run keeps the first run's id (the global runId), so it rewrites the same record instead of adding one.
  const s = makeWorld();
  const stuck = { "checker-": () => ({ issues: [{ plan: "01-01", severity: "blocker", description: "still open" }] }) };
  const first = await plan(s, { maxCheckIterations: 1 }, stuck);
  assert.equal(first.result.stage, "Checker");
  const before = s.read(`${PHASE_DIR}/prereview/checker-${RUN}.json`);
  assert.equal((await plan(s, { maxCheckIterations: 1 }, stuck)).result.stage, "Checker");
  assert.equal(s.read(`${PHASE_DIR}/prereview/checker-${RUN}.json`), before);
  assert.deepEqual(fs.readdirSync(prereviewDir(s)).sort(), [`checker-${RUN}.json`, `skeleton-${RUN}.json`]);
  assert.deepEqual(fates(record(s, "checker")), { K1: ["open", false] });
});

test("O64 review_metrics changes no decision: the same run with it off takes the same steps and writes no record", async () => {
  const scenario = { ...skeletonAndChecker(), "revise-01-01": () => ({ marker: "REVISION COMPLETE" }) };
  const on = await plan(makeWorld(), {}, scenario);
  const wOff = makeWorld({ overlay: off });
  const offRun = await plan(wOff, {}, scenario);
  assert.deepEqual([offRun.result.status, labels(offRun)], [on.result.status, labels(on)]);
  assert.deepEqual(offRun.result.warnings, on.result.warnings);
  assert.equal(fs.existsSync(prereviewDir(wOff)), false);
  // The prompts of the agents differ only by nothing: the plan flow adds no prompt text.
  assert.deepEqual(offRun.calls.map((c) => c.prompt), on.calls.map((c) => c.prompt));

  const execOn = makeExecWorld({ waves: [[task("01-01")]] });
  const execOff = makeExecWorld({ waves: [[task("01-01")]], overlay: off });
  const finding = { id: "F1", severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 1, description: "finding F1" };
  const a = await exec(execOn, { "review-": () => ({ findings: [finding] }) });
  const b = await exec(execOff, { "review-": () => ({ findings: [finding] }) });
  assert.deepEqual([b.result.status, labels(b)], [a.result.status, labels(a)]);
  const verifyOff = b.calls.find((c) => c.opts.label === "verify-findings-01-01");
  assert.doesNotMatch(verifyOff.prompt, /plan_catchable/);
  assert.equal(Object.hasOwn(verifyOff.opts.schema.properties.verdicts.items.properties, "plan_catchable"), false);
  const execCallOff = b.calls.find((c) => c.opts.label === "exec-01-01");
  assert.doesNotMatch(execCallOff.prompt, /plan_defects/);
  assert.equal(Object.hasOwn(execCallOff.opts.schema.properties, "plan_defects"), false);
  assert.equal(JSON.parse(execOff.read(`${PHASE_DIR}/review/w1-01-01.json`)).findings[0].planCatchable, undefined);
  assert.equal(fs.existsSync(prereviewDir(execOff)), false);
});

test("O64 gsd-execute tags confirmed findings plan-catchable and records halts, red gates and fix calls with their plan-defect cause", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { adapter: { commands: flagCommands } } });
  const run = executor(w);
  const finding = { id: "F1", severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 1, description: "finding F1" };
  const r = await exec(w, {
    "exec-01-01": async (...x) => { await run(...x); w.write("fail.flag", "src/01-01/impl.js"); return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] }; },
    "fix-01-01": () => { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { taskResults: [], plan_defects: [{ kind: "missing-dependency", evidence: "the plan never adds pkg" }] }; },
    "review-": () => ({ findings: [finding] }),
    "verify-findings": () => ({ verdicts: [{ id: "F1", verdict: "confirmed", evidence: "traced", plan_catchable: "yes", catch_reason: "the plan named the empty case and no task" }] }),
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.match(r.calls.find((c) => c.opts.label === "verify-findings-01-01").prompt, /plan_catchable yes when a review of the plan/);
  assert.match(r.calls.find((c) => c.opts.label === "exec-01-01").prompt, /plan_defects \[\{kind: wrong-api\|owns-reach\|missing-dependency\|other, evidence\}\]/);
  assert.match(r.calls.find((c) => c.opts.label === "fix-review-w1").prompt, /plan_defects/);
  const f = JSON.parse(w.read(`${PHASE_DIR}/review/w1-01-01.json`)).findings[0];
  assert.deepEqual([f.verdict, f.planCatchable, f.catchReason], ["confirmed", "yes", "the plan named the empty case and no task"]);
  const ev = record(w, "execute").events;
  assert.deepEqual(ev.map((e) => [e.kind, e.cause, e.defects.map((d) => d.kind).join(",")]), [
    ["fix-round", "plan", "missing-dependency"], ["gate-failure", "plan", "missing-dependency"], ["fix-round", "other", ""],
  ]);
  assert.deepEqual([ev[0].wave, ev[0].round, ev[0].plan, ev[1].failures, ev[2].fixer], ["w1", 1, "01-01", 1, "review"]);

  // A halt: the executor's decision stop with a wrong API it met and a request for a file outside its owns.
  const h = makeExecWorld({ waves: [[task("01-01")]] });
  const runH = executor(h);
  const stop = await exec(h, { "exec-01-01": async (...x) => ({ ...(await runH(...x)), taskResults: [{ task: "1", status: "partial" }], deviations: [{ rule: 4, note: "Api.load does not exist" }], requests: [{ path: "lib\\api.dart", change: "add load", reason: "needs it" }], plan_defects: [{ kind: "wrong-api", evidence: "Api.load" }] }) });
  assert.deepEqual([stop.result.status, stop.result.stage], ["needs-owner", "Execute"]);
  const halt = record(h, "execute").events;
  assert.deepEqual(halt.map((e) => [e.kind, e.plan, e.cause, e.defects]), [["halt", "01-01", "plan", [{ kind: "wrong-api", evidence: "Api.load" }, { kind: "owns-reach", evidence: "request for lib/api.dart" }]]]);
});

test("O64 a resumed execute keeps the events of the waves it skips and replaces the ones it replays", async () => {
  // Wave 1 is red once and fixed (a fix call naming an owns-reach request), wave 2's executor dies: the run stops with a halt.
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]], overlay: { adapter: { commands: flagCommands } } });
  const run = executor(w);
  let dies = true;
  const overrides = {
    "exec-01-01": async (...x) => { await run(...x); w.write("fail.flag", "src/01-01/impl.js"); return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] }; },
    "fix-01-01": () => { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { taskResults: [], requests: [{ path: "src/shared/x.js", change: "export y", reason: "plan owns too little" }] }; },
    "exec-01-02": (...x) => (dies ? NULL("agent error: transport closed") : undefined),
  };
  const first = await exec(w, overrides);
  assert.deepEqual([first.result.status, first.result.stage], ["needs-owner", "Execute"], JSON.stringify(first.result));
  const kinds = (rec) => rec.events.map((e) => `${e.kind}:${e.wave ?? e.plan}:${e.cause}`);
  assert.deepEqual(kinds(record(w, "execute")), ["fix-round:w1:plan", "gate-failure:w1:plan", "halt:01-02:other"]);
  // The resume (same run id) skips the committed wave 1 and runs wave 2 again.
  fs.rmSync(path.join(w.root, PHASE_DIR, "01-02-HALT.json"), { force: true });
  dies = false;
  const resumed = await exec(w, overrides);
  assert.equal(resumed.result.status, "executed", JSON.stringify(resumed.result));
  assert.equal(labels(resumed).includes("exec-01-01"), false);
  assert.deepEqual(kinds(record(w, "execute")), ["fix-round:w1:plan", "gate-failure:w1:plan", "halt:01-02:other"]);

  // A replayed red gate replaces its copy instead of counting twice.
  const red = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { max_verify_rounds: 1 }, adapter: { commands: flagCommands } } });
  const runR = executor(red);
  const stuck = {
    "exec-01-01": async (...x) => { await runR(...x); red.write("fail.flag", "src/01-01/impl.js"); return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] }; },
    "fix-01-01": () => ({ taskResults: [], plan_defects: [{ kind: "wrong-api", evidence: "Api.x" }] }),
  };
  assert.equal((await exec(red, stuck)).result.stage, "Gate");
  assert.equal((await exec(red, stuck)).result.stage, "Gate");
  assert.deepEqual(kinds(record(red, "execute")), ["fix-round:w1:plan", "gate-failure:w1:plan"]);
});

// review-stats --stage over fixture records and run journals.
function statsProject() {
  const s = setup();
  const pd = ".planning/phases/02-host";
  const f = (id, fate, confirmed, extra = {}) => ({ id, plan: "02-01", class: "source-grounding", severity: "high", blocking: true, confirmed, fate, description: "d", ...extra });
  s.project.writeJson(`${pd}/prereview/plan-wf_a.json`, { v: 1, stage: "plan", runId: "wf_a", findings: [f("C1-1-1", "applied", true), f("C1-1-2", "carried", false, { severity: "medium", blocking: false }), f("C1-1-3", "rejected", false), f("C2-1-1", "applied", true, { class: "ownership-reach" })] });
  s.project.writeJson(`${pd}/prereview/skeleton-wf_a.json`, { v: 1, stage: "skeleton", runId: "wf_a", findings: [f("L1-1", "applied", true, { severity: "blocker", class: "fidelity" })] });
  s.project.writeJson(`${pd}/prereview/execute-wf_b.json`, { v: 1, stage: "execute", runId: "wf_b", events: [
    { kind: "halt", plan: "02-01", cause: "plan", defects: [{ kind: "wrong-api" }] }, { kind: "halt", plan: "02-02", cause: "other", defects: [] },
    { kind: "gate-failure", wave: "w1", cause: "other", defects: [] }, { kind: "fix-round", wave: "w1", cause: "plan", defects: [{ kind: "owns-reach" }] },
  ] });
  s.project.write(`${pd}/prereview/torn.json`, "{ nope");
  const cf = (id, extra) => ({ id, severity: "high", trigger: "t", likelihood: "likely", confidence: 90, impact: "", file: "src/a.dart", line: 1, description: "d", introduced: true, class: "", instances: [], status: "gated", verdict: "confirmed", ...extra });
  s.project.writeJson(`${pd}/review/w1-02-01.json`, { plan: "02-01", scope: ["src/a.dart"], excluded: [], lenses: ["correctness"], codeOnly: false, findings: [cf("F-01", { planCatchable: "yes" }), cf("F-02", { planCatchable: "no" }), cf("F-03"), cf("F-04", { status: "deferred", verdict: null, severity: "low" })], resolution: [] });
  const journal = (name, rows) => {
    s.project.writeJson(`_workspace/_runs/${name}/run.json`, { runId: name, name: name.includes("exec") ? "gsd-execute" : "gsd-plan", status: "done", startedAt: "2026-10-23T10:00:00.000Z" });
    s.project.writeJson(`_workspace/_runs/${name}/args.json`, { phaseDir: pd });
    s.project.write(`_workspace/_runs/${name}/journal.jsonl`, `${rows.map((x) => JSON.stringify(x)).join("\n")}\n`);
  };
  const row = (label, phase, role, costUsd, status = "ok") => ({ n: 1, label, phase, role, status, agentId: "a", usage: costUsd === null ? {} : { costUsd } });
  journal("wf_20261023-100000_plan", [
    row("skeleton-L1", "Skeleton review", "skeleton_lane", 2), row("outline-revise-2", "Skeleton review", "outline", 1),
    row("find-02-01-source-grounding", "Find", "plan_finder", 6), row("verify-02-01", "Judge", "plan_verifier", 3), row("judge-1", "Judge", "plan_judge", null),
    row("editor-1", "Edit", "plan_editor", 4), { ...row("find-02-01-source-grounding", "Find", "plan_finder", 9), status: "cached" },
    row("checker-1", "Checker", "checker", 5), row("plan-02-01", "Plans", "planner", 7),
  ]);
  journal("wf_20261023-110000_exec", [row("review-02-01", "Review", "reviewer", 4), row("verify-findings-02-01", "Review", "finding_verifier", 2), row("fix-review-w1", "Review", "fixer", 3), row("exec-02-01", "Wave", "executor", 10)]);
  return s;
}

test("O64 ph review-stats --stage prints findings by fate, cost per confirmed finding and escapes for each stage", async () => {
  const s = statsProject();
  const plan = await s.ph(["review-stats", "--stage", "plan"]);
  assertExit(plan, 0);
  assertLine(plan, "stage plan: records 1, findings 4: high 3, medium 1");
  assertLine(plan, "fates: applied 2, carried 1, rejected 1, duplicate 0, conflict 0, open 0, unjudged 0");
  assertLine(plan, "confirmed 2 (kept high issues); classes: source-grounding 3, ownership-reach 1");
  // The cached replay costs nothing; the judge call has no price.
  assertLine(plan, "cost: review $9.00 in 3 calls (1 unpriced), fix $4.00 in 1 calls; per confirmed finding $4.50 (priced calls only)");
  assertLine(plan, "escapes past the pre-code reviews (shared by skeleton, checker and plan): confirmed code findings plan-catchable yes 1 of 3 (no 1, untagged 1)");
  assertLine(plan, "plan-defect events of execute: halts 1 of 2, gate failures 0 of 1, fix rounds 1 of 1; defects named: wrong-api 1, owns-reach 1");
  assertLine(plan, "review-stats --stage plan: 3 pre-code records from .planning/phases/*/prereview, 1 review records, 2 runs; skipped 1 unreadable pre-code records");
  const sk = await s.ph(["review-stats", "--stage", "skeleton"]);
  assertLine(sk, "cost: review $2.00 in 1 calls, fix $1.00 in 1 calls; per confirmed finding $2.00");
  const ck = await s.ph(["review-stats", "--stage", "checker"]);
  assertLine(ck, "stage checker: records 0, findings 0");
  assertLine(ck, "cost: review $5.00 in 1 calls, fix $0.00 in 0 calls; per confirmed finding n/a (none confirmed)");
  const code = await s.ph(["review-stats", "--stage", "code", "--phase", "2"]);
  assertLine(code, "gated 3: confirmed 3 (100%), refuted 0 (0%), uncertain 0, unverified 0");
  assertLine(code, "cost: review $6.00 in 2 calls, fix $3.00 in 1 calls; per confirmed finding $2.00");
  assertLine(code, "escapes past code review: non-blocking findings later recorded fixed 0 of 1 (ph review-stats outcome)");
  assertLine(await s.ph(["review-stats", "--stage", "plan", "--phase", "3"]), "stage plan: records 0, findings 0");
});

test("O64 ph review-stats without --stage keeps its report and names the pre-code records; bad --stage use is a usage error", async () => {
  const s = statsProject();
  const r = await s.ph(["review-stats"]);
  assertExit(r, 0);
  assertLine(r, "reviews 1 (phases 1, plans 1), findings 4: critical 0, high 3, medium 0, low 1, info 0");
  assertLine(r, "pre-code review records: skeleton 1, plan 1 (ph review-stats --stage skeleton|checker|plan|code)");
  assertLine(r, "review-stats: 1 review records from .planning/phases/*/review");
  assertExit(await s.ph(["review-stats", "--stage", "lint"]), 1);
  assertErrLine(await s.ph(["review-stats", "--stage", "lint"]), /--stage is one of skeleton\|checker\|plan\|code, not lint/);
  assertErrLine(await s.ph(["review-stats", "--runs-dir", "x"]), /--runs-dir goes with --stage/);
  assertErrLine(await s.ph(["review-stats", "outcome", "02-01:F-04", "fixed", "--stage", "code"]), /--stage and --runs-dir go with the report/);
  // A project with no pre-code records prints no extra line.
  const plain = setup();
  assert.equal((await plain.ph(["review-stats"])).out.some((l) => l.startsWith("pre-code review records")), false);
});
