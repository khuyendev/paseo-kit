// Kit feedback 112. F1 a timed-out or failed step whose output matches a runtime crash signature is `crashed: <signature>`
// with no hung file and no `blocked by hang`; a plain timeout keeps item 102. F2 each evidence step records free memory.
// F3 ph doctor notes a low free commit (or free memory). A fix round stops before any fixer with answer verb rerun.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { gateConfigHash } from "../../ship/.agents/harness/gsd/allow.mjs";
import { loadConfig, loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { readCommitFreeMb, watchMemory } from "../../ship/.agents/harness/lib/memory.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";
import { newScript, runEngine, stubRoot } from "../thin/engine.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const { crashSignature, CRASH_SIGNATURES } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-gate.mjs")).href);

const PD = ".planning/phases/03-api";
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const RUNNER = `import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync("runs.log", args.join(" ") + "\\n");
const files = args.filter((a) => a.endsWith(".js"));
if (args.includes("--oom")) {
  fs.writeSync(1, "00:01 +0: test/b.test.js: loading\\n");
  fs.writeSync(2, "runtime/platform/allocation.cc: 30: error: Out of memory\\n");
  fs.writeSync(2, "Failed to load test/open_project_screen_test.dart: Connection closed before test suite loaded\\n");
  if (args.includes("--hang")) setInterval(() => {}, 1000);
  else process.exit(1);
} else if (args.includes("--custom")) {
  fs.writeSync(2, "CUSTOM_TOOL_ABORT in the runner\\n");
  process.exit(1);
} else if (args.includes("--mention")) {
  console.log("the assertion text says Out of memory and the test passes");
} else if (args.includes("--suite")) {
  console.log("00:01 +0: test/a.test.js: one passes");
  console.log("00:02 +1: test/b.test.js: two never ends");
  setInterval(() => {}, 1000);
} else console.log("ran " + files.join(" "));
`;
const FILES = { "tools/run.mjs": RUNNER, "test/a.test.js": "a\n", "test/b.test.js": "b\n", "src/a/x.js": "x\n", ".gitignore": "runs.log\n" };
const commands = (extra = {}) => ({ adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs", "--suite"], build_timeout_s: 30, test_timeout_s: 2, gates: [], verify: {}, ...extra } } });
const ob = (task, files) => ({ task, kind: "cmd", command: `cmd: node tools/run.mjs ${files}` });
const plans = [{ id: "03-01", owns: ["Path:src/a/", "Path:test/b.test.js"], verify: [ob("1", "test/b.test.js")] }];
const runs = (p) => p.read("runs.log").trim().split(/\r?\n/);

function assertMemory(step) {
  const m = step.memory;
  assert.equal(typeof m?.physical?.startMb, "number", step.name);
  assert.equal(typeof m.physical.lowMb, "number");
  assert.ok(m.physical.lowMb <= m.physical.startMb && m.physical.lowMb >= 0, JSON.stringify(m));
  if (process.platform === "win32") {
    assert.equal(typeof m.commit?.startMb, "number", `commit on ${step.name}: ${JSON.stringify(m)}`);
    assert.ok(m.commit.lowMb <= m.commit.startMb && m.commit.lowMb >= 0);
  }
}

test("E112 F1 a crash signature is not a hang: no hung file, no blocked-by-hang, not attributed to the file's owner", async () => {
  const p = makeTempProject({ files: FILES, overlay: commands({ test: [NODE, "tools/run.mjs", "--oom", "--hang"] }) });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.equal(r.json.green, false);
  const steps = p.readJson(r.json.evidence).steps;
  const by = (name) => steps.find((s) => s.name === name);
  const suite = by("test");
  assert.equal(suite.outcome, "timeout");
  assert.equal(suite.crash.signature, "Out of memory");
  assert.equal(suite.hang, undefined);
  assert.equal(by("03-01-1-cmd").outcome, "passed", "the later obligation ran");
  assert.equal(by("03-01-1-cmd").blockedByHang, undefined);
  assert.ok(!steps.some((s) => s.blockedByHang), "no step is blocked by hang");
  assert.equal(r.json.hung, undefined);
  assert.deepEqual(r.json.timedOut, []);
  assert.deepEqual(r.json.crashed, ["test crashed: Out of memory"]);
  assert.match(p.read(suite.log), /Out of memory/);
  assert.doesNotMatch(p.read(suite.log), /hung test file/);
  assert.deepEqual(runs(p), ["--oom --hang", "test/b.test.js"]);
  const failure = r.json.failures.find((f) => f.step === "test");
  assert.deepEqual(failure.files, []);
  assert.equal(failure.tests, undefined);
  assert.deepEqual(failure.crash, { signature: "Out of memory" });
  assert.equal(r.json.byPlan["03-01"], undefined, "not the owner of the last file printed");
  assert.deepEqual(r.json.unplaced.map((f) => f.step), ["test"]);
  for (const s of steps) assertMemory(s);
});

test("E112 F1 a failed step (the tool exited) is crashed the same way; a plain timeout keeps the 102 hang", async () => {
  const died = makeTempProject({ files: FILES, overlay: commands({ test: [NODE, "tools/run.mjs", "--oom"], test_timeout_s: 30 }) });
  const r = await flow(died.root, ["gate", PD], { waveId: "w1", plans });
  const suite = died.readJson(r.json.evidence).steps.find((s) => s.name === "test");
  assert.equal(suite.outcome, "failed");
  assert.equal(suite.crash.signature, "Out of memory");
  assert.equal(suite.hang, undefined);
  assert.deepEqual(r.json.crashed, ["test crashed: Out of memory"]);
  assert.equal(r.json.byPlan["03-01"], undefined);
  assert.equal(died.readJson(r.json.evidence).steps.find((s) => s.name === "03-01-1-cmd").outcome, "passed");

  const hung = makeTempProject({ files: FILES, overlay: commands() });
  const h = await flow(hung.root, ["gate", PD], { waveId: "w1", plans });
  const steps = hung.readJson(h.json.evidence).steps;
  assert.equal(steps.find((s) => s.name === "test").outcome, "timeout");
  assert.deepEqual(steps.find((s) => s.name === "test").hang, { files: ["test/b.test.js"], source: "output" });
  assert.equal(steps.find((s) => s.name === "test").crash, undefined);
  assert.deepEqual(steps.find((s) => s.name === "03-01-1-cmd").blockedByHang, { step: "test", files: ["test/b.test.js"] });
  assert.match(h.json.timedOut[0], /hung test file\(s\) test\/b\.test\.js \(named last in its output\); blocked by hang in this pass: 03-01-1-cmd$/);
  assert.equal(h.json.crashed, undefined);
  assert.deepEqual(h.json.byPlan["03-01"].map((f) => f.step).sort(), ["03-01-1-cmd", "test"]);
});

test("E112 F1 an adapter signature extends the kit list; a passing step that only mentions the phrase is not a crash", async () => {
  assert.deepEqual(CRASH_SIGNATURES.filter((s) => s === "FATAL ERROR:.*heap"), ["FATAL ERROR:.*heap"]);
  assert.equal(crashSignature("FATAL ERROR: Reached heap limit Allocation failed"), "FATAL ERROR: Reached heap");
  assert.equal(crashSignature("all well"), null);
  assert.equal(crashSignature("no kit hit", ["CUSTOM_TOOL_ABORT"]), null);
  assert.equal(crashSignature("CUSTOM_TOOL_ABORT in the runner", ["CUSTOM_TOOL_ABORT"]), "CUSTOM_TOOL_ABORT");

  const p = makeTempProject({ files: FILES, overlay: { adapter: { ...commands({ test: [NODE, "tools/run.mjs", "--custom"], test_timeout_s: 30 }).adapter, crash_signatures: ["CUSTOM_TOOL_ABORT"] } } });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [] });
  assert.deepEqual(r.json.crashed, ["test crashed: CUSTOM_TOOL_ABORT"]);
  assert.equal(r.json.hung, undefined);

  const ok = makeTempProject({ files: FILES, overlay: commands({ test: [NODE, "tools/run.mjs", "--mention"], test_timeout_s: 30 }) });
  const g = await flow(ok.root, ["gate", PD], { waveId: "w1", plans: [] });
  assert.equal(g.json.green, true, JSON.stringify(g.json.failures));
  const suite = ok.readJson(g.json.evidence).steps.find((s) => s.name === "test");
  assert.equal(suite.outcome, "passed");
  assert.equal(suite.crash, undefined);
  assert.match(ok.read(suite.log), /Out of memory/);
});

test("E112 F1 adapter.crash_signatures is optional, not part of the gate hash; a bad regex is refused", () => {
  const plain = makeTempProject();
  assert.equal(Object.hasOwn(loadConfig(plain.root).adapter, "crash_signatures"), false);
  const named = makeTempProject({ overlay: { adapter: { crash_signatures: ["TOOL_DIED"] } } });
  assert.deepEqual(loadConfig(named.root).adapter.crash_signatures, ["TOOL_DIED"]);
  assert.equal(gateConfigHash(loadConfig(plain.root)), gateConfigHash(loadConfig(named.root)), "a phase baseline hash does not move");
  const bad = makeTempProject({ overlay: { adapter: { crash_signatures: ["("] } } });
  assert.throws(() => loadConfig(bad.root), /adapter\.crash_signatures\[0\].*invalid regular expression/);
  const empty = makeTempProject({ overlay: { adapter: { crash_signatures: [""] } } });
  assert.match(String(loadConfigLenient(empty.root).error?.message), /adapter\.crash_signatures\[0\]/);
});

test("E112 F2 a running step keeps the lowest memory sample", () => {
  let n = 0;
  const watch = watchMemory(() => {
    n += 1;
    return n === 1 ? { physicalMb: 1000, commitMb: 8000 } : { physicalMb: 400, commitMb: 1000 };
  });
  assert.deepEqual(watch.finish(), { physical: { startMb: 1000, lowMb: 400 }, commit: { startMb: 8000, lowMb: 1000 } });
  if (process.platform === "win32") {
    const mb = readCommitFreeMb();
    assert.equal(typeof mb, "number");
    assert.ok(mb > 0, mb);
  }
});

test("E112 F1 a fix round does not dispatch a fixer for a tool crash; the answer is rerun", async () => {
  const root = stubRoot();
  const body = `
  const R = executeSteps({ phaseDir: ".planning/phases/01-core", args: {}, cfg: { gsd: {}, adapter: { commands: {} } }, setup: { N: "01" }, policy: {} });
  const first = { green: false, failureCount: 1, failures: [{ step: "test", outcome: "timeout", files: ["test/b.test.js"], crash: { signature: "Out of memory" } }], byPlan: { "01-01": [{ step: "test" }] }, unplaced: [] };
  const rounds = await R.fixRounds("w1", [{ plan: "01-01" }], first, "wave 1", "", { rounds: 2 });
  return rounds.stop ? { status: rounds.stop.status, stage: rounds.stop.stage, reason: rounds.stop.reason, answer: rounds.stop.answer } : { ran: true };
  `;
  const r = await runEngine(root, newScript(body));
  const stop = r.result;
  assert.equal(stop?.status, "needs-owner", JSON.stringify(r.error ?? r.result));
  assert.equal(stop.stage, "Gate");
  assert.match(stop.reason, /test crashed: Out of memory/);
  assert.match(stop.reason, /no fixer runs/);
  assert.deepEqual(stop.answer, { verb: "rerun", command: "rerun with the same args after freeing memory or bounding test concurrency" });
  assert.equal(r.host.calls.runner.length, 0, "no fixer call");
});

async function doctor(s, opts = {}) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  const code = await runDoctor(ctx, { freemem: opts.freemem ?? (() => 64 * 2 ** 30), commitFreeMb: opts.commitFreeMb, claudeVersionText: () => "2.1.300 (Claude Code)" });
  return { code, out };
}

test("E112 F3 doctor notes a fake low free commit, and low free memory when commit cannot be read", async () => {
  const s = setup();
  const low = await doctor(s, { commitFreeMb: () => 100 });
  assert.ok(low.out.some((l) => l === "note free commit 100 MB is below 4096 MB; a suite that starts servers can crash the test tool (free memory, or bound its concurrency)"), low.out.join("\n"));
  const high = await doctor(s, { commitFreeMb: () => 20000 });
  assert.ok(!high.out.some((l) => /free commit/.test(l)), high.out.join("\n"));
  const physical = await doctor(s, { commitFreeMb: () => null, freemem: () => 512 * 2 ** 20 });
  assert.ok(physical.out.some((l) => l === "note free memory 512 MB is below 2048 MB; a suite that starts servers can crash the test tool (free memory, or bound its concurrency)"), physical.out.join("\n"));
  assert.ok(!physical.out.some((l) => /free commit/.test(l)));
  // A note does not fail doctor by itself: the same fixture with plenty of both is not a memory problem.
  const plenty = await doctor(s, { commitFreeMb: () => 20000 });
  assert.equal(low.code, plenty.code);
});

test("E112 F4 paseo-runtime says a Windows tail outlives the Monitor", () => {
  const text = fs.readFileSync(path.join(SHIP_DIR, ".claude/skills/harness/references/paseo-runtime.md"), "utf8");
  assert.match(text, /On Windows a\s+`tail -F` watcher outlives the expired Monitor/);
  assert.match(text, /waiting on a\s+run is `ph watch-run`, never a tail/);
});
