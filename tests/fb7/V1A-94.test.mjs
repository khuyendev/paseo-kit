// Kit feedback #94 (fb7 V1A): an owner commit between runs that fixes files of completed plans. F1 the resume gate's head-moved
// problem lists per foreign commit the files no trailer plan owns and the plans of the phase owning each; F2 `ph gsd commit adopt
// <N> <sha> --reason` records such a commit in commits.json as the owner's, so the gate accepts it without a history rewrite; F3
// the gate's stop names real verbs (commit.adopt, or fix-and-rerun with a command per problem).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { gsd as runGsdIn, plan, project as gsdProject } from "../gsd-core/fixture.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const PD = ".planning/phases/01-core";
const SUM = (id) => `${PD}/01-${id}-SUMMARY.md`;
// Three plans: 01-01 owns src/a.js, 01-02 src/b.js (both committed), 01-03 src/c.js (not committed yet).
const OWNS = { "01": "src/a.js", "02": "src/b.js", "03": "src/c.js" };
const gatePlans = () => Object.entries(OWNS).map(([n, f]) => ({ id: `01-${n}`, owns: [`Path:${f}`], summary: SUM(n), complete: n !== "03" }));

async function phaseProject() {
  const files = { "src/a.js": "a0\n", "src/b.js": "b0\n", "src/c.js": "c0\n", "test/phase2_test.js": "t0\n" };
  for (const [n, f] of Object.entries(OWNS)) files[`${PD}/01-${n}-PLAN.md`] = plan({ id: n, files: `[${f}]`, owns: `["Path:${f}"]` });
  for (const n of ["01", "02"]) files[SUM(n)] = "done\n";
  const p = gsdProject({ files });
  const head = p.git("rev-parse", "HEAD").trim();
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  for (const id of ["01-01", "01-02"]) assert.equal((await flow(p.root, ["state-plan", PD], { plan: id, stage: "committed", commit: head, verify: "green" })).code, 0);
  return p;
}
function commit(p, edits, message) {
  for (const [rel, text] of Object.entries(edits)) p.write(rel, text);
  p.git("add", "--", ...Object.keys(edits));
  p.git("commit", "-q", "-m", message);
  return p.git("rev-parse", "HEAD").trim();
}
const gate = (p) => flow(p.root, ["resume-gate", PD], { plans: gatePlans() });
const adopt = (p, sha, reason = "owner-decided alignment of the tests to the contract") => runGsdIn(p, ["commit", "adopt", "1", sha, ...(reason ? ["--reason", reason] : [])]);

test("V1A 94 F1 F3 a foreign owner commit names the files no trailer plan owns with their owners, and the stop answers commit.adopt", async () => {
  const p = await phaseProject();
  const sha = commit(p, { "src/a.js": "a1\n", "src/b.js": "b1\n", "test/phase2_test.js": "t1\n" }, "test(01): align tests\n\nPlans: 01-01");
  const r = await gate(p);
  assert.equal(r.code, 1);
  const moved = r.json.problems.find((x) => x.kind === "head-moved");
  assert.deepEqual(moved.commits, [{ sha, files: [{ path: "src/b.js", plans: ["01-02"] }, { path: "test/phase2_test.js", plans: [] }], adoptable: true }]);
  assert.match(moved.detail, new RegExp(`\\(1 foreign: ${sha.slice(0, 7)}\\); ${sha.slice(0, 7)}: src/b\\.js \\(01-02\\), test/phase2_test\\.js \\(no plan of the phase\\)$`));
  assert.deepEqual(r.json.answer, { verb: "commit.adopt", command: `ph gsd commit adopt 01 ${sha.slice(0, 12)} --reason <why the commit stands>` });
  assert.deepEqual(r.json.options, [r.json.answer.command]);
  assert.match(r.json.reason, /^head-moved HEAD [0-9a-f]+ moved outside the orchestrator's commits/);
});

test("V1A 94 F2 commit adopt records the owner commit in commits.json and owner-answers.json, and the gate accepts it", async () => {
  const p = await phaseProject();
  const sha = commit(p, { "src/a.js": "a1\n", "src/b.js": "b1\n", "test/phase2_test.js": "t1\n" }, "test(01): align tests\n\nPlans: 01-01");
  const r = await adopt(p, sha.slice(0, 9));
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual([r.json.adopted, r.json.plans, r.json.outside], [sha, { "01-01": ["src/a.js"], "01-02": ["src/b.js"] }, ["test/phase2_test.js"]]);
  const entry = p.readJson(`${PD}/commits.json`).at(-1);
  assert.deepEqual({ ...entry, owner: { ...entry.owner, at: "-" } }, { sha, phase: "01", wave: null, owner: { reason: "owner-decided alignment of the tests to the contract", plans: { "01-01": ["src/a.js"], "01-02": ["src/b.js"] }, outside: ["test/phase2_test.js"], at: "-" } });
  assert.equal(entry.plans, undefined, "no top-level plans: no reader takes it for a plan's commit");
  const answer = p.readJson(`${PD}/owner-answers.json`).at(-1);
  assert.deepEqual([answer.kind, answer.sha, answer.reason], ["commit", sha, "owner-decided alignment of the tests to the contract"]);
  const after = await gate(p);
  assert.deepEqual([after.code, after.json.problems], [0, []]);
  // The plan's evaluation scope does not take the owner's commit.
  const scope = await runGsdIn(p, ["check", "evaluation-scope", "--plan", "01-02", "--commits-only"]);
  assert.deepEqual(scope.json.commits, []);
});

test("V1A 94 F2 F3 a commit touching a plan not committed yet is not adoptable: the stop says fix-and-rerun and adopt refuses naming the file", async () => {
  const p = await phaseProject();
  const sha = commit(p, { "src/a.js": "a1\n", "src/c.js": "c1\n" }, "fix: owner edits");
  const r = await gate(p);
  const moved = r.json.problems.find((x) => x.kind === "head-moved");
  assert.deepEqual(moved.commits, [{ sha, files: [{ path: "src/a.js", plans: ["01-01"] }, { path: "src/c.js", plans: ["01-03"] }], adoptable: false }]);
  assert.match(moved.detail, /\(changes files of plans not committed yet\)$/);
  assert.equal(r.json.answer.verb, "fix-and-rerun");
  assert.match(r.json.answer.command, new RegExp(`^git revert ${sha.slice(0, 12)} `));
  const refused = await adopt(p, sha);
  assert.notEqual(refused.code, 0);
  assert.match(refused.json.error, /changes files of plans not committed yet: src\/c\.js \(01-03\)/);
  assert.equal(fs.existsSync(p.path(`${PD}/commits.json`)), false, "nothing recorded");
});

test("V1A 94 F2 commit adopt refuses: no reason, not a commit, the baseline commit itself, a commit recorded already, and a worker", async () => {
  const p = await phaseProject();
  const base = p.readJson(`${PD}/execute-baseline.json`).head;
  const sha = commit(p, { "src/a.js": "a1\n" }, "fix: owner edit");
  assert.match((await adopt(p, sha, null)).json.error, /needs --reason/);
  assert.match((await adopt(p, "nope123")).json.error, /is not a commit of this repository/);
  assert.match((await adopt(p, base)).json.error, /is not a commit after the execute baseline/);
  assert.equal((await adopt(p, sha)).code, 0);
  assert.match((await adopt(p, sha)).json.error, /is recorded in .*commits\.json already/);
  const worker = await runGsdIn(p, ["commit", "adopt", "1", sha, "--reason", "x"], { env: { ...process.env, PASEO_HARNESS_ROLE: "worker" } });
  assert.match(worker.json.error, /single writer/);
  // `ph gsd commit <message>` still commits.
  p.write("src/a.js", "a2\n");
  const c = await runGsdIn(p, ["commit", "feat(01-01): more", "--files", "src/a.js"]);
  assert.equal(c.json.committed, true, JSON.stringify(c.json));
});

test("V1A 94 F3 other gate problems name a command each: grant for an unowned path, restoring a file of an incomplete plan", async () => {
  const p = await phaseProject();
  p.write("docs/notes.md", "n\n");
  p.write("src/c.js", "c-hand\n");
  const r = await gate(p);
  assert.equal(r.code, 1);
  assert.equal(r.json.answer.verb, "fix-and-rerun");
  assert.deepEqual(r.json.options, [
    "restore src/c.js (git checkout -- src/c.js, or delete it when new): plan 01-03 has no SUMMARY yet and its executor writes it, then rerun with the same args",
    "ph gsd grant 01 --path docs/notes.md (the run takes it as its own output), or commit it alone (a commit of files no plan owns is accepted), then rerun with the same args",
  ]);
  assert.equal(r.json.answer.command, r.json.options[0]);
});

// ---- end to end: gsd-execute stops with commit.adopt, the owner adopts, the rerun goes on ----

test("V1A 94 gsd-execute: an owner commit on a committed plan's file stops the rerun with commit.adopt; after ph gsd commit adopt it runs", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  const halting = { "exec-01-02": () => ({ taskResults: [{ task: "1", status: "partial", evidence: "which schema?" }], deviations: [{ rule: 4, note: "pick a schema" }], requests: [] }) };
  const first = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, halting) });
  assert.equal(first.result.status, "needs-owner");
  fs.rmSync(path.join(w.root, PHASE_DIR, "01-02-HALT.json"));
  // The owner fixes 01-01's output and a file outside the phase, and commits without a trailer.
  w.write("src/01-01/impl.js", "impl 01-01 fixed\n");
  w.write("docs/other.md", "x\n");
  w.git("add", "--", "src/01-01/impl.js", "docs/other.md");
  w.git("commit", "-q", "-m", "fix: owner alignment");
  const sha = w.git("rev-parse", "HEAD").stdout.trim();
  const second = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w), runId: "wf_20261021-090000_cd34" });
  assert.equal(second.result.status, "needs-owner", JSON.stringify(second.result.reason));
  assert.equal(second.result.stage, "Execute");
  assert.deepEqual(second.result.answer, { verb: "commit.adopt", command: `ph gsd commit adopt 01 ${sha.slice(0, 12)} --reason <why the commit stands>` });
  assert.match(second.result.reason, /safe-resume gate: head-moved .*1 foreign/);
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-02").length, 0, "no executor before the gate is answered");

  const adopted = await runGsdIn({ root: w.root }, ["commit", "adopt", "1", sha, "--reason", "owner alignment"]);
  assert.equal(adopted.code, 0, JSON.stringify(adopted.json));
  // The verb judges with the handoff owns, as the gate does (the plan files of this world name none).
  assert.deepEqual([adopted.json.plans, adopted.json.outside], [{ "01-01": ["src/01-01/impl.js"] }, ["docs/other.md"]]);
  const third = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w), runId: "wf_20261021-100000_ef56" });
  assert.equal(third.result.status, "executed", JSON.stringify(third.result.reason));
  assert.equal(third.calls.filter((c) => c.opts.label === "exec-01-02").length, 1);
  assert.equal(w.read("src/01-01/impl.js"), "impl 01-01 fixed\n");
});

test("V1A 94 F3 the stop for a plan with commits and no SUMMARY names the commands instead of prose options", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.scope["01-01"] = { status: "resolved", commits: [{ sha: "abc1234" }], files: [] };
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "needs-owner");
  const base = JSON.parse(w.read(`${PHASE_DIR}/execute-baseline.json`)).head;
  assert.deepEqual(r.result.options, [
    `close out by hand: write ${PHASE_DIR}/01-01-SUMMARY.md from those commits, then rerun with the same args`,
    `re-execute: git revert the commits that ph gsd select-revert-commits --plan 01-01 --range ${base}..HEAD lists, then rerun with the same args`,
  ]);
});
