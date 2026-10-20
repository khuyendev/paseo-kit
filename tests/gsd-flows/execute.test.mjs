// gsd-execute.js: preconditions, safe resume, dispatch, reconciliation, concurrency and commits.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { NULL, runScript } from "./host.mjs";
import { executor, makeExecWorld, task } from "./exec-world.mjs";
import { makeWorld, PHASE_DIR } from "./world.mjs";

const exec = (w, args = {}, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
const labels = (r) => r.calls.map((c) => c.opts.label);

test("GSDF-02 execute refuses a phase without handoff files", async () => {
  const w = makeWorld();
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd });
  assert.equal(r.result.status, "refused");
  assert.match(r.result.reason, /no handoff files/);
});

test("GSDF-11 a blocking anti-pattern without answers stops execute at stage Execute naming the row", async () => {
  const w = makeExecWorld();
  w.write(`${PHASE_DIR}/.continue-here.md`, "## Critical Anti-Patterns\n\n| Pattern | Description | Severity | Prevention Mechanism |\n|---|---|---|---|\n| skipped gate | x | blocking | y |\n");
  const r = await exec(w);
  assert.deepEqual([r.result.status, r.result.stage, r.result.rows], ["needs-owner", "Execute", ["skipped gate"]]);
  w.write(`${PHASE_DIR}/.continue-here.answers.json`, JSON.stringify({ "skipped gate": { what: "a", manifested: "b", prevention: "c" } }));
  assert.equal((await exec(w)).result.status, "executed");
});

test("GSDF-38 a killed executor's owned edits stop the resumed run before dispatch; commits without SUMMARY and unreadable scopes too", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write("src/01-01/tracked.js", "v1\n");
  w.git("add", "-A"); w.git("commit", "-qm", "seed");
  const killed = await exec(w, {}, { "exec-": () => { w.write("src/01-01/tracked.js", "half\n"); w.write("src/01-01/created.js", "new\n"); return NULL("runner error: killed"); } });
  assert.equal(killed.result.status, "needs-owner");
  fs.rmSync(`${w.root}/${PHASE_DIR}/01-01-HALT.json`);
  const resumed = await exec(w);
  assert.equal(resumed.result.status, "needs-owner");
  assert.match(resumed.result.reason, /src\/01-01\/created\.js/);
  assert.match(resumed.result.reason, /src\/01-01\/tracked\.js/);
  assert.equal(labels(resumed).length, 0);
  const w2 = makeExecWorld({ waves: [[task("01-01")]] });
  w2.scope["01-01"] = { status: "resolved", commits: [{ sha: "abc1234" }], files: [] };
  const committed = await exec(w2);
  assert.match(committed.result.reason, /plan 01-01 has commits \(abc1234\) but no SUMMARY/);
  assert.equal(committed.calls.length, 0);
  w2.scope["01-01"] = { code: 69, json: { status: "unresolvable" } };
  const blind = await exec(w2);
  assert.deepEqual([blind.result.status, blind.calls.length], ["failed", 0]);
  const w3 = makeExecWorld({ waves: [[task("01-01")]] });
  await exec(w3, {}, { "exec-": () => NULL("runner error: killed") });
  fs.rmSync(`${w3.root}/${PHASE_DIR}/01-01-HALT.json`);
  w3.write("README.md", "unrelated\n");
  assert.match((await exec(w3)).result.reason, /unauthorized path README\.md/);
});

test("GSDF-39 a halted plan with blocked dependents reports stuck and starts nothing", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02"), task("01-03")]], meta: { "01-02": { depends: ["01-01"] }, "01-03": { depends: ["01-01"] } } });
  w.write(`${PHASE_DIR}/01-01-HALT.json`, "{}");
  const r = await exec(w);
  assert.deepEqual([r.result.status, r.result.route], ["nothing-to-run", "stuck"]);
  assert.equal(r.calls.length, 0);
  assert.equal(w.gsd.callsOf("verification status").length, 0);
  const filtered = await exec(makeExecWorld(), { plans: "01-09" });
  assert.equal(filtered.result.reason, "no matching plans");
});

test("GSDF-40 plans sharing a modified file run one after the other", async () => {
  const w = makeExecWorld({ meta: { "01-01": { files: ["src/shared.txt"] }, "01-02": { files: ["src/shared.txt"] } } });
  let running = 0, max = 0;
  const r = await exec(w, {}, { "exec-": async () => { running++; max = Math.max(max, running); await new Promise((res) => setTimeout(res, 20)); running--; } });
  assert.equal(max, 1);
  assert.ok(r.logs.some((l) => /planning defect: 01-02 shares files_modified/.test(l)));
});

test("GSDF-41 the shared tree needs disjoint owns per wave; worktree mode integrates in plan order", async () => {
  const w = makeExecWorld();
  w.gsd.on("check owns", () => ({ code: 1, json: { problems: [{ kind: "overlapping owns", plans: ["01-01", "01-02"] }] } }));
  const r = await exec(w);
  assert.equal(r.result.status, "refused");
  assert.match(r.result.reason, /disjoint owns/);
  const wt = makeExecWorld({ overlay: { gsd: { isolation: "worktree" } } });
  const slowFirst = await exec(wt, {}, { "exec-01-01": async () => { await new Promise((res) => setTimeout(res, 40)); } });
  assert.equal(slowFirst.result.status, "executed");
  assert.deepEqual(slowFirst.result.events.filter((e) => e.startsWith("transfer")), ["transfer 01-01", "transfer 01-02"]);
  assert.equal(wt.read("src/01-02/impl.js"), "impl 01-02\n");
  assert.ok(wt.read(`${PHASE_DIR}/transfers/01-01.json`));
});

test("GSDF-42 executor prompts carry the rule blocks and the stack skill; Rule 4 needs the owner; a committing executor fails", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { adapter: { stack_skill: "stack-x" } } });
  const r4 = await exec(w, {}, { "exec-": () => ({ taskResults: [{ task: "1", status: "partial", evidence: "needs a schema change" }], deviations: [{ rule: 4, note: "pick a schema" }], requests: [] }) });
  const p = r4.calls[0].prompt;
  for (const s of ["Rules 1-3", "at most 3 auto-fix attempts per task", "Rule 3 never covers package installs", "Rule 4 (architectural change)", "Stack skill to follow: .claude/skills/stack-x/SKILL.md", "Never commit, stage or stash", "do not run them yourself", "Write your SUMMARY to exactly: .planning/phases/01-core/01-01-SUMMARY.md"]) assert.ok(p.includes(s), s);
  assert.doesNotMatch(p, /<tasks>/);
  assert.deepEqual([r4.result.status, r4.result.stage], ["needs-owner", "Execute"]);
  assert.match(r4.result.reason, /pick a schema/);
  const w2 = makeExecWorld({ waves: [[task("01-01")]] });
  const sneaky = await exec(w2, {}, { "exec-": () => { w2.write("src/01-01/c.js", "c\n"); w2.git("add", "-A"); w2.git("commit", "-qm", "agent commit"); return { taskResults: [] }; } });
  assert.match(sneaky.result.reason, /executor committed/);
});

test("GSDF-43 an executor that wrote its SUMMARY and code but ended abnormally is reconciled complete", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const run = executor(w);
  const r = await exec(w, {}, { "exec-": async (p, o, n, calls) => { await run(p, o, n, calls); return NULL("runner error: transport closed"); } });
  assert.equal(r.result.status, "executed");
  assert.ok(r.logs.some((l) => /reconciled as complete/.test(l)));
});

test("GSDF-44 failing tests leave the plans untracked and stop with the evidence", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { max_verify_rounds: 1 } } });
  w.write("fail.flag", "x");
  const r = await exec(w, {}, { "fix-": () => ({ taskResults: [] }), "integration-fix": () => ({ status: "unresolved" }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Gate"]);
  assert.equal(w.events.some((e) => e.startsWith("state wave")), false);
  assert.equal(w.events.some((e) => e.startsWith("commit")), false);
  assert.ok(r.result.evidence);
});

test("GSDF-45 a 429 failure is classed quota with the retry hint and is not re-dispatched", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w, {}, { "exec-": () => NULL("agent error: 429 Too Many Requests, retry after 120 s") });
  assert.equal(r.result.failure.class, "quota");
  assert.equal(r.result.failure.retryAfterSeconds, 120);
  assert.match(r.result.options[0], /rerun after the reset \(about 120 s\)/);
  assert.equal(labels(r).filter((l) => l.startsWith("exec-")).length, 1);
});

test("GSDF-93 parallelization off runs one executor at a time, max_concurrent caps it, gaps-only needs the key", async () => {
  const three = [[task("01-01"), task("01-02"), task("01-03")]];
  const measure = async (overlay) => {
    const w = makeExecWorld({ waves: three, overlay });
    let running = 0, max = 0;
    await exec(w, {}, { "exec-": async () => { running++; max = Math.max(max, running); await new Promise((res) => setTimeout(res, 20)); running--; } });
    return max;
  };
  assert.equal(await measure({ gsd: { parallelization: { enabled: false, max_concurrent: null } } }), 1);
  assert.equal(await measure({ gsd: { parallelization: { enabled: true, max_concurrent: 2 } } }), 2);
  const g = makeExecWorld({ waves: [[task("01-01")]], prefix: "gap-", meta: { "01-01": { noGapKey: true } } });
  const r = await exec(g, { gapsOnly: true });
  assert.equal(r.result.status, "refused");
  assert.match(r.result.reason, /missing in 01-01/);
});

test("GSDF-30 executing the gap wave marks waveExecuted before the first executor; a second gap wave is refused", async () => {
  const g = makeExecWorld({ waves: [[task("01-03")]], prefix: "gap-", meta: { "01-03": { gap: true } } });
  g.attempts.gap = { key: "k", runId: "wf_plan", inputDigest: "v", before: "b", done: true, result: { plans: ["01-03"], waveExecuted: false } };
  let markedFirst = null;
  const r = await exec(g, { gapsOnly: true }, { "exec-": () => { markedFirst = g.attempts.gap.result.waveExecuted; } });
  assert.equal(markedFirst, true);
  assert.equal(r.result.status, "executed");
  const g2 = makeExecWorld({ waves: [[task("01-03")]], prefix: "gap-", meta: { "01-03": { gap: true } } });
  g2.attempts.gap = { ...g.attempts.gap };
  const again = await exec(g2, { gapsOnly: true });
  assert.equal(again.calls.length, 0);
  assert.match(again.result.reason, /capped at one wave/);
});
