// Kit feedback 102 F3: with gsd.fixer_verifies_itself a gate fixer (the executor's fix round, the integration fixer of a round
// and of the batch) may run the failing test files of its failures with the gate's test command (per-test timeout included);
// with it false, the fix prompts are as before.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

test("W102 F3 exec-fixers lists the test files of each fixer's failures only when fixers verify themselves", async () => {
  const { root } = makeTempProject();
  const gate = { byPlan: { "01-01": [{ step: "t", files: ["a.test.js"], tests: ["a.test.js"] }, { step: "u", tests: ["a.test.js", "b.test.js"] }], "01-02": [{ step: "v" }] }, unplaced: [{ step: "w", files: ["lib.test.js"], tests: ["lib.test.js"] }] };
  const on = (await flow(root, ["exec-fixers"], { gate, plans: ["01-01", "01-02"], verifies: true })).json;
  assert.deepEqual(on.plans.map((p) => [p.id, p.tests]), [["01-01", ["a.test.js", "b.test.js"]], ["01-02", undefined]]);
  assert.deepEqual(on.tests, ["lib.test.js"]);
  const off = (await flow(root, ["exec-fixers"], { gate, plans: ["01-01", "01-02"] })).json;
  assert.deepEqual([off.plans.some((p) => p.tests), off.tests], [false, []]);
});

test("W102 F3 the executor-fix and integration-fix templates hold the runtime block only when test files are listed", async () => {
  const { root } = makeTempProject();
  const run = { command: JSON.stringify(["flutter", "test", "--timeout", "30s"]), attempts: "3", minutes: "20" };
  const fix = async (tests) => (await flow(root, ["prompt", "executor-fix"], { round: 1, plan: "01-01", failures: "- test: failed", requests: "", evidence: "e.json", tests, ...run, digest: "D" })).json.text;
  const on = await fix(JSON.stringify(["test/a_test.dart"]));
  assert.match(on, /^Fix round 1 for plan 01-01: the gate failed on your owned files\. Fix only inside your owns\.\n<kit_fix_runtime>\nYou may run the failing test files of these failures yourself: \["test\/a_test\.dart"\]\. Run them with \["flutter","test","--timeout","30s"\] followed by those files, and nothing else/);
  assert.match(on, /At most 3 runs within 20 minutes/);
  assert.match(on, /an uncaught exception at dispose/);
  assert.match(on, /Every file outside your owns stays read-only/);
  const off = await fix("");
  assert.match(off, /^Fix round 1 for plan 01-01: the gate failed on your owned files\. Fix only inside your owns; do not run the build or the tests\.\n\n- test: failed/);
  assert.doesNotMatch(off, /kit_fix_runtime/);
  const integ = async (tests) => (await flow(root, ["prompt", "integration-fix"], { files: '["test/lib_test.dart"]', failures: "- test: failed", tests, ...run, digest: "D" })).json.text;
  assert.match(await integ('["test/lib_test.dart"]'), /You own exactly these files: \["test\/lib_test\.dart"\]\.\n<kit_fix_runtime>\nYou may run the failing test files of these failures yourself: \["test\/lib_test\.dart"\]/);
  assert.equal(await integ(""), 'Integration fix: these gate failures belong to no plan. You own exactly these files: ["test/lib_test.dart"].\n\n- test: failed\n\nReturn JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.\n\nD');
});

// The world's test command: tools/run.mjs fails while fail.flag exists, printing its text (a file and a line) as the error.
const RUNNER = "import fs from 'node:fs';\nif (fs.existsSync('fail.flag')) { console.log('error ' + fs.readFileSync('fail.flag', 'utf8').trim()); process.exit(1); }\n";
const TIMEOUT = { test_case_timeout_s: 5, test_case_timeout_arg: ["--timeout", "{s}s"] };
function world({ verifies = true, batch = false, waves = [[task("01-01")]] } = {}) {
  const w = makeExecWorld({ waves, overlay: { gsd: { fixer_verifies_itself: verifies, ...(batch ? { execution_mode: "batch" } : {}) }, adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {}, ...TIMEOUT } } } });
  w.write("tools/run.mjs", RUNNER);
  w.write("test/lib.test.js", "lib\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "runner");
  return w;
}
const exec = (w, overrides) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });
// The executor of `id` also writes a test file of its own, and leaves the gate red on `flag` (a file:line its output reports).
const failingExecutor = (w, id, flag, ownTest = true) => async (p, o, n, calls) => {
  await executor(w)(p, o, n, calls);
  if (ownTest) w.write(`src/${id}/a.test.js`, "t\n");
  w.write("fail.flag", flag);
  return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] };
};
const promptOf = (r, label) => r.calls.find((c) => c.opts.label === label)?.prompt ?? "";

test("W102 F3 a fix round of a failing test file lets the executor run it with the per-test timeout; not when fixers do not verify themselves", async () => {
  const w = world();
  const r = await exec(w, { "exec-01-01": failingExecutor(w, "01-01", "src/01-01/a.test.js:3") });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const fix = promptOf(r, "fix-01-01-1");
  assert.match(fix, /<kit_fix_runtime>\nYou may run the failing test files of these failures yourself: \["src\/01-01\/a\.test\.js"\]\./);
  assert.ok(fix.includes(`Run them with ${JSON.stringify([NODE, "tools/run.mjs", "--timeout", "5s"])} followed by those files`), fix);
  assert.doesNotMatch(fix, /do not run the build or the tests/);

  const quiet = world({ verifies: false });
  const q = await exec(quiet, { "exec-01-01": failingExecutor(quiet, "01-01", "src/01-01/a.test.js:3") });
  assert.equal(q.result.status, "executed", JSON.stringify(q.result));
  assert.match(promptOf(q, "fix-01-01-1"), /Fix only inside your owns; do not run the build or the tests\./);
  assert.doesNotMatch(promptOf(q, "fix-01-01-1"), /kit_fix_runtime/);
});

test("W102 F3 the integration fixer of a round and of the batch may run the failing test file no plan owns", async () => {
  const w = world();
  const r = await exec(w, { "exec-01-01": failingExecutor(w, "01-01", "test/lib.test.js:1", false) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.match(promptOf(r, "integration-fix-1"), /You own exactly these files: \["test\/lib\.test\.js"\]\.\n<kit_fix_runtime>\nYou may run the failing test files of these failures yourself: \["test\/lib\.test\.js"\]/);

  const b = world({ batch: true, waves: [[task("01-01"), task("01-02")]] });
  const rb = await exec(b, { "exec-01-02": failingExecutor(b, "01-02", "test/lib.test.js:1", false) });
  assert.equal(rb.result.status, "executed", JSON.stringify(rb.result));
  assert.match(promptOf(rb, "integration-fix-batch"), /<kit_fix_runtime>\nYou may run the failing test files of these failures yourself: \["test\/lib\.test\.js"\]/);
  assert.ok(promptOf(rb, "integration-fix-batch").includes(JSON.stringify([NODE, "tools/run.mjs", "--timeout", "5s"])));

  const quiet = world({ batch: true, verifies: false, waves: [[task("01-01"), task("01-02")]] });
  const rq = await exec(quiet, { "exec-01-02": failingExecutor(quiet, "01-02", "test/lib.test.js:1", false) });
  assert.equal(rq.result.status, "executed", JSON.stringify(rq.result));
  assert.doesNotMatch(promptOf(rq, "integration-fix-batch"), /kit_fix_runtime/);
});
