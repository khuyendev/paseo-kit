// Kit feedback 102 F1, F2: a gate step that times out names its hung test files and the later steps of the same gate run that
// would run one are failed `blocked by hang` without running; adapter.commands.test_case_timeout_s reaches the test runner
// through the test_case_timeout_arg template, in the suite and in every obligation that runs the test command.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const { withTestCaseTimeout } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/adapter/contract.mjs")).href);
const { loadConfig } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/config.mjs")).href);
const PD = ".planning/phases/03-api";
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

// A fake test runner: --suite prints a progress line per test file as it starts and hangs on test/b.test.js; given files, it
// hangs when one of them is test/b.test.js or test/c.test.js, else passes. It writes every run to runs.log.
const RUNNER = `import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync("runs.log", args.join(" ") + "\\n");
const files = args.filter((a) => a.endsWith(".js"));
if (args.includes("--suite")) {
  console.log("00:01 +0: test/a.test.js: one passes");
  console.log("00:02 +1: test/b.test.js: two never ends");
  setInterval(() => {}, 1000);
} else if (files.some((f) => /[bc]\\.test\\.js$/.test(f))) setInterval(() => {}, 1000);
else console.log("ran " + files.join(" "));
`;
const FILES = { "tools/run.mjs": RUNNER, "test/a.test.js": "a\n", "test/b.test.js": "b\n", "test/c.test.js": "c\n", "src/a/x.js": "x\n", ".gitignore": "runs.log\n" };
const commands = (extra = {}) => ({ adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs", "--suite"], build_timeout_s: 30, test_timeout_s: 2, gates: [], verify: {}, ...extra } } });
const ob = (task, files) => ({ task, kind: "cmd", command: `cmd: node tools/run.mjs ${files}` });
const runs = (p) => p.read("runs.log").trim().split(/\r?\n/);

test("W102 F1 a suite that hangs on a test file blocks the later obligations of that file in the same gate run, attributed to its owner", async () => {
  const p = makeTempProject({ files: FILES, overlay: commands() });
  const plans = [{ id: "03-01", owns: ["Path:src/a/", "Path:test/b.test.js"], verify: [ob("1", "test/b.test.js"), ob("2", "test/a.test.js"), ob("3", "test/a.test.js test/b.test.js")] }, { id: "03-02", owns: ["Path:test/a.test.js"], verify: [] }];
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.equal(r.json.green, false);
  const steps = p.readJson(r.json.evidence).steps;
  const by = (name) => steps.find((s) => s.name === name);
  assert.equal(by("test").outcome, "timeout");
  assert.deepEqual(by("test").hang, { files: ["test/b.test.js"], source: "output" });
  // Only the obligation that runs test/a.test.js alone ran after the suite; the other two were not run again.
  assert.deepEqual(runs(p), ["--suite", "test/a.test.js"]);
  for (const name of ["03-01-1-cmd", "03-01-3-cmd"]) {
    assert.equal(by(name).outcome, "failed");
    assert.equal(by(name).exitCode, null);
    assert.deepEqual(by(name).blockedByHang, { step: "test", files: ["test/b.test.js"] });
    assert.match(p.read(by(name).log), /^blocked by hang: test\/b\.test\.js timed out in step test of this gate run; not run again in this pass/);
    assert.ok(by(name).argv.includes("test/b.test.js"), "the command it would have run is kept");
  }
  assert.equal(by("03-01-2-cmd").outcome, "passed");
  assert.deepEqual(r.json.hung, [{ step: "test", files: ["test/b.test.js"], source: "output", blocked: ["03-01-1-cmd", "03-01-3-cmd"] }]);
  assert.match(r.json.timedOut[0], /^test timed out after its limit \(exit 124\); hung test file\(s\) test\/b\.test\.js \(named last in its output\); blocked by hang in this pass: 03-01-1-cmd, 03-01-3-cmd$/);
  // The timeout and the blocked steps go to the plan owning the hung file, each failure naming the test files a fixer may run.
  assert.deepEqual(r.json.byPlan["03-01"].map((f) => f.step).sort(), ["03-01-1-cmd", "03-01-3-cmd", "test"]);
  assert.equal(r.json.byPlan["03-02"], undefined);
  assert.deepEqual(r.json.failures.find((f) => f.step === "test").tests, ["test/b.test.js"]);
  assert.deepEqual(r.json.failures.find((f) => f.step === "03-01-3-cmd").tests, ["test/a.test.js", "test/b.test.js"]);
});

test("W102 F1 an obligation that hangs blocks the later obligations naming its file; without a timeout every step runs", async () => {
  const p = makeTempProject({ files: FILES, overlay: commands({ test: [NODE, "-e", "process.exit(0)"] }) });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:src/a/", "Path:test/"], verify: [ob("1", "test/c.test.js"), ob("2", "test/a.test.js"), ob("3", "test/c.test.js")] }] });
  const steps = p.readJson(r.json.evidence).steps;
  assert.deepEqual(steps.filter((s) => s.plan).map((s) => s.outcome), ["timeout", "passed", "failed"]);
  assert.deepEqual(steps.find((s) => s.name === "03-01-1-cmd").hang, { files: ["test/c.test.js"], source: "argv" });
  assert.deepEqual(runs(p), ["test/c.test.js", "test/a.test.js"]);
  assert.match(r.json.timedOut[0], /^03-01-1-cmd timed out .*\(named by its command\); blocked by hang in this pass: 03-01-3-cmd$/);

  const calm = makeTempProject({ files: FILES, overlay: commands({ test: [NODE, "-e", "process.exit(0)"] }) });
  const g = await flow(calm.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:test/"], verify: [ob("1", "test/a.test.js"), ob("2", "test/a.test.js test/a.test.js")] }] });
  assert.equal(g.json.green, true, JSON.stringify(g.json.failures));
  assert.equal(g.json.hung, undefined);
  assert.equal(calm.readJson(g.json.evidence).steps.some((s) => s.blockedByHang), false);
});

test("W102 F2 the per-test timeout reaches the suite and the obligations that run the test command; the evidence readback agrees", async () => {
  const cfgOf = (extra) => ({ adapter: { commands: { test: ["node", "tools/run.mjs"], test_case_timeout_s: 7, test_case_timeout_arg: ["--timeout", "{s}s"], ...extra } } });
  assert.deepEqual(withTestCaseTimeout(cfgOf(), ["node", "tools/run.mjs", "test/a.test.js"]), ["node", "tools/run.mjs", "--timeout", "7s", "test/a.test.js"]);
  assert.deepEqual(withTestCaseTimeout(cfgOf(), ["node", "tools/run.mjs", "--timeout", "3s", "x"]), ["node", "tools/run.mjs", "--timeout", "3s", "x"], "a command that names the flag keeps its own");
  assert.deepEqual(withTestCaseTimeout(cfgOf(), ["node", "other.mjs", "x"]), ["node", "other.mjs", "x"], "not the test command");
  assert.deepEqual(withTestCaseTimeout(cfgOf({ test_case_timeout_arg: ["--testTimeout={s}000"] }), ["node", "tools/run.mjs"]), ["node", "tools/run.mjs", "--testTimeout=7000"]);
  assert.deepEqual(withTestCaseTimeout(cfgOf({ test_case_timeout_arg: ["--testTimeout={s}000"] }), ["node", "tools/run.mjs", "--testTimeout=1"]), ["node", "tools/run.mjs", "--testTimeout=1"]);
  assert.deepEqual(withTestCaseTimeout(cfgOf({ test_case_timeout_s: null }), ["node", "tools/run.mjs"]), ["node", "tools/run.mjs"]);

  const vocab = (kind, runner) => ({ prefix: kind === "cmd" ? "cmd:" : kind === "unit" ? "unit:" : kind, parser: null, resolver: null, runner, evidence_parser: null, exit_code_sufficient: true });
  const overlay = commands({ test: ["node", "tools/run.mjs"], test_case_timeout_s: 7, test_case_timeout_arg: ["--timeout", "{s}s"], verify: { unit: { argv: ["node", "tools/run.mjs", "{targets}"], timeout_s: 30 } } });
  overlay.adapter.verify_vocabulary = { build: vocab("build", null), cmd: vocab("cmd", null), unit: vocab("unit", "unit") };
  const p = makeTempProject({ files: FILES, overlay });
  assert.equal(loadConfig(p.root).adapter.commands.test_case_timeout_s, 7);
  const plans = [{ id: "03-01", owns: ["Path:test/"], verify: [ob("1", "test/a.test.js"), { task: "2", kind: "unit", command: "unit: test/a.test.js" }, { task: "3", kind: "cmd", command: "cmd: node -e 0" }] }];
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  const steps = p.readJson(r.json.evidence).steps;
  assert.deepEqual(steps.find((s) => s.name === "test").argv, ["node", "tools/run.mjs", "--timeout", "7s"]);
  assert.deepEqual(steps.find((s) => s.name === "03-01-1-cmd").argv, ["node", "tools/run.mjs", "--timeout", "7s", "test/a.test.js"]);
  assert.deepEqual(steps.find((s) => s.name === "03-01-2-unit").argv, ["node", "tools/run.mjs", "--timeout", "7s", "test/a.test.js"]);
  assert.deepEqual(steps.find((s) => s.name === "03-01-3-cmd").argv, ["node", "-e", "0"]);
  assert.deepEqual([r.json.testCommand, r.json.caseTimeoutS], [["node", "tools/run.mjs", "--timeout", "7s"], 7]);
  assert.equal((await flow(p.root, ["evidence-check", r.json.evidence], { plans })).json.status, "current");
  // The same command without a gate (gsd-execute gives it to its fixers, also in a resumed run that runs no gate).
  assert.deepEqual((await flow(p.root, ["test-command"], { testArgv: ["node", "tools/run.mjs", "--ci"] })).json, { argv: ["node", "tools/run.mjs", "--timeout", "7s", "--ci"], caseTimeoutS: 7 });

  // One key without the other is said in the notes; nothing is added.
  const half = makeTempProject({ files: FILES, overlay: commands({ test: ["node", "tools/run.mjs"], test_case_timeout_s: 7 }) });
  const h = await flow(half.root, ["gate", PD], { waveId: "w1", plans: [] });
  assert.ok(h.json.notes.includes("adapter.commands.test_case_timeout_s is set without test_case_timeout_arg: the test runner gets no per-test timeout"), h.json.notes.join("\n"));
  assert.deepEqual(half.readJson(h.json.evidence).steps.find((s) => s.name === "test").argv, ["node", "tools/run.mjs"]);
  assert.equal(h.json.caseTimeoutS, null);
  // The schema takes the keys only in their shapes.
  const bad = makeTempProject({ overlay: commands({ test_case_timeout_s: 0 }) });
  assert.throws(() => loadConfig(bad.root), /adapter\.commands\.test_case_timeout_s/);
});
