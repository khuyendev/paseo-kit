// Kit feedback 109 F1-F4 and 107 F1, F3: a gate fixer's test runs. The allowance is at least the failing files plus two,
// an unverified last edit reaches the next gate and is not an owner decision, a whole-file kill names the file, and
// concurrent test-run calls take one project lock (a fake runner).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const { runGsd } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/gsd/commands.mjs")).href);
const { loadConfig } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/config.mjs")).href);
const { pidAlive } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/lib/proc.mjs")).href);
const NODE = process.execPath;
const PD = ".planning/phases/03-api";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

test("G109 F2 the run allowance is at least the failing files plus two, and never below the configured attempts", async () => {
  const { root } = makeTempProject();
  const runs = async (attempts, files) => (await flow(root, ["exec-fix-allowance"], { attempts, files })).json;
  assert.deepEqual(await runs(3, []), { runs: 3, files: 0 });
  assert.deepEqual(await runs(3, ["a.test.js"]), { runs: 3, files: 1 });
  assert.deepEqual(await runs(3, ["a", "b", "c", "d", "e"]), { runs: 7, files: 5 });
  assert.deepEqual(await runs(10, ["a.test.js"]), { runs: 10, files: 1 });
  assert.deepEqual(await runs(1, ["a", "b"]), { runs: 4, files: 2 });
});

test("G109 F3 an unverified edit is not an owner decision; a Rule 4 or an explicit ask still is", async () => {
  const { root } = makeTempProject();
  const verdict = (reply) => flow(root, ["exec-verdict"], { reply, plan: "01-01", requests: {}, shared: [], pending: true }).then((r) => r.json);
  const unverified = await verdict({ taskResults: [{ task: "1", status: "partial", evidence: "[UNVERIFIED] terminal output omitted 12374 characters" }], deviations: [] });
  assert.equal(unverified.decision, null);
  assert.equal(unverified.halt, undefined);
  const word = await verdict({ taskResults: [{ task: "1", status: "blocked", evidence: "This final correction remains UNVERIFIED" }] });
  assert.equal(word.decision, null);
  const rule4 = await verdict({ deviations: [{ rule: 4, note: "[UNVERIFIED] but owner decision: the public API must change" }], taskResults: [] });
  assert.equal(rule4.decision.rule, 4);
  assert.match(rule4.halt.why, /owner decision needed/);
  const ask = await verdict({ taskResults: [{ task: "1", status: "partial", evidence: "owner decision: pick API A or B" }] });
  assert.equal(ask.decision.status, "partial");
  const reply = (body) => flow(root, ["exec-fix-reply"], { reply: body }).then((r) => r.json);
  assert.deepEqual(await reply({ status: "unresolved", lastEdit: "unverified", evidence: "allowance spent" }), { unverified: true, explicit: false, unverifiedOnly: true });
  assert.equal((await reply({ status: "unresolved", lastEdit: "unverified", evidence: "needs-owner: the contract changed" })).unverifiedOnly, false);
  assert.equal((await reply({ status: "fixed", evidence: "green" })).unverified, false);
});

const RUNNER = `import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync("runs.log", args.join(" ") + "\\n");
if (args.includes("--suite")) {
  fs.writeSync(1, "00:01 +0: test/b.test.js: hung outside the body\\n");
  setInterval(() => {}, 1000);
} else if (args.some((a) => /b\\.test\\.js$/.test(a))) setInterval(() => {}, 1000);
else console.log("ran " + args.filter((a) => a.endsWith(".js")).join(" "));
`;
const FILES = { "tools/run.mjs": RUNNER, "test/a.test.js": "a\n", "test/b.test.js": "b\n", "test/c.test.js": "c\n", ".gitignore": "runs.log\n" };

test("G109 F4 a shorter whole-file bound kills the suite on the file it is hanging in and names that file", async () => {
  const p = makeTempProject({ files: FILES, overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs", "--suite"], build_timeout_s: 30, test_timeout_s: 30, test_file_timeout_s: 1, gates: [], verify: {} } } } });
  const started = Date.now();
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:test/"], verify: [] }] });
  assert.ok(Date.now() - started < 10000, `suite waited ${Date.now() - started}ms`);
  assert.equal(r.json.green, false);
  const step = p.readJson(r.json.evidence).steps.find((s) => s.name === "test");
  assert.equal(step.outcome, "timeout");
  assert.deepEqual(step.hang, { files: ["test/b.test.js"], source: "file" });
  assert.match(r.json.timedOut[0], /hung test file\(s\) test\/b\.test\.js \(killed at its whole-file bound\)/);
  assert.equal(loadConfig(p.root).adapter.commands.test_file_timeout_s, 1);
  const bad = makeTempProject({ overlay: { adapter: { commands: { build: null, test: null, build_timeout_s: 30, test_timeout_s: 30, test_file_timeout_s: 0, gates: [], verify: {} } } } });
  assert.throws(() => loadConfig(bad.root), /test_file_timeout_s/);
});

test("G109 F4 a test command that names several files kills the hung one and does not start the next", async () => {
  const p = makeTempProject({ files: FILES, overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs"], build_timeout_s: 30, test_timeout_s: 30, test_file_timeout_s: 1, gates: [], verify: {} } } } });
  const ob = (task, files) => ({ task, kind: "cmd", command: `cmd: "${NODE}" tools/run.mjs ${files}` });
  // The obligation argv is the test command plus two files, so the gate runs them one at a time.
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:test/"], verify: [ob("1", "test/a.test.js test/b.test.js test/c.test.js")] }] });
  const step = p.readJson(r.json.evidence).steps.find((s) => s.name === "03-01-1-cmd");
  assert.equal(step.outcome, "timeout");
  assert.deepEqual(step.hang, { files: ["test/b.test.js"], source: "file" });
  assert.deepEqual(p.read("runs.log").trim().split(/\r?\n/), ["test/a.test.js", "test/b.test.js"]);
});

function commands(extra = {}) {
  return { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {}, ...extra };
}

async function gsd(root, args) {
  let out = "";
  let written = "";
  const code = await runGsd(args, { root, out: (l) => { out += `${l}\n`; }, write: (t) => { written += t; }, err: () => {} });
  const line = out.trim().split(/\r?\n/).at(-1);
  return { code, json: JSON.parse(line), text: written + out };
}

test("G109 F1 F4 test-run writes the full output to a file, prints a short summary, kills the tree and names the hung file", async () => {
  const pidFile = "pids.txt";
  const hang = `import { spawn } from "node:child_process";
import fs from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n" + child.pid + "\\n");
console.log("started " + process.argv.at(-1));
setInterval(() => {}, 1000);
`;
  const p = makeTempProject({ files: { "tools/hang.mjs": hang, "test/b.test.js": "b\n" }, overlay: { adapter: { commands: commands({ test_file_timeout_s: 1, test: [NODE, "tools/hang.mjs"] }) } } });
  const r = await gsd(p.root, ["test-run", "test/b.test.js"]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.hung, ["test/b.test.js"]);
  assert.equal(r.json.files[0].outcome, "hung");
  assert.match(r.text, /test\/b\.test\.js: hung \(killed after 1s\)/);
  assert.match(r.text, /log: /);
  const log = p.read(r.json.files[0].log);
  assert.match(log, /hung test file: test\/b\.test\.js/);
  const [parent, child] = p.read(pidFile).trim().split(/\r?\n/).map(Number);
  const until = Date.now() + 3000;
  while (Date.now() < until && (pidAlive(parent) || pidAlive(child))) { /* the tree kill is synchronous; a moment of grace */ }
  assert.equal(pidAlive(parent), false, `parent ${parent} still alive`);
  assert.equal(pidAlive(child), false, `child ${child} still alive`);

  const loud = `console.log("FAIL " + "x".repeat(30000)); process.exit(1);\n`;
  const q = makeTempProject({ files: { "tools/loud.mjs": loud, "test/a.test.js": "a\n" }, overlay: { adapter: { commands: commands({ test: [NODE, "tools/loud.mjs"] }) } } });
  const s = await gsd(q.root, ["test-run", "test/a.test.js"]);
  assert.equal(s.json.files[0].outcome, "failed");
  assert.ok(q.read(s.json.files[0].log).includes("x".repeat(3000)), "the log file keeps the full output");
  assert.ok(!s.text.includes("x".repeat(1000)), "the terminal summary is not the truncated-or-full log");
  assert.match(s.text, /FAIL /);
});

test("G109 107 F1 concurrent test-run calls on one repo do not overlap", async () => {
  const slow = `import fs from "node:fs";
fs.appendFileSync("runs.log", "start " + Date.now() + "\\n");
const end = Date.now() + 400;
while (Date.now() < end) {}
fs.appendFileSync("runs.log", "end " + Date.now() + "\\n");
`;
  const p = makeTempProject({ files: { "tools/slow.mjs": slow, "test/a.test.js": "a\n", "test/b.test.js": "b\n", ".gitignore": "runs.log\n" }, overlay: { adapter: { commands: commands({ test: [NODE, "tools/slow.mjs"] }), mutex: "g109-test-run" } } });
  const [a, b] = await Promise.all([gsd(p.root, ["test-run", "test/a.test.js"]), gsd(p.root, ["test-run", "test/b.test.js"])]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(a.json.lock, "g109-test-run");
  const lines = p.read("runs.log").trim().split(/\r?\n/);
  assert.deepEqual(lines.map((l) => l.split(" ")[0]), ["start", "end", "start", "end"]);
  const stamps = lines.map((l) => Number(l.split(" ")[1]));
  assert.ok(stamps[1] <= stamps[2], `overlapped ${lines}`);
});

const PRINT = `import fs from "node:fs";
if (fs.existsSync("fail.flag")) { console.log(fs.readFileSync("fail.flag", "utf8")); process.exit(1); }
`;

function world() {
  const w = makeExecWorld({ waves: [[task("01-01", { owns: ["Path:src/01-01/", "Path:test/", `${PHASE_DIR}/01-01-SUMMARY.md`] })]], overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  w.write("tools/run.mjs", PRINT);
  for (const name of ["a", "b", "c"]) w.write(`test/${name}.test.js`, `${name}\n`);
  w.git("add", "-A");
  w.git("commit", "-qm", "tests");
  return w;
}

test("G109 F2 F3 a fix round of three failing files allows five runs, and an unverified edit is gated rather than an owner decision", async () => {
  const w = world();
  w.write("fail.flag", "error test/a.test.js:1\nerror test/b.test.js:2\nerror test/c.test.js:3\n");
  const r = await runScript("gsd-execute", {
    root: w.root,
    args: { phaseDir: PHASE_DIR },
    gsd: w.gsd,
    agent: executor(w, {
      "exec-01-01": async (p, o, n, calls) => executor(w)(p, o, n, calls),
      "fix-01-01-1": () => {
        fs.rmSync(path.join(w.root, "fail.flag"), { force: true });
        return { taskResults: [{ task: "1", status: "partial", evidence: "[UNVERIFIED] terminal output omitted 12374 characters" }], deviations: [], requests: [] };
      },
    }),
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const fix = r.calls.find((c) => c.opts.label === "fix-01-01-1").prompt;
  assert.match(fix, /At most 5 runs within/);
  assert.match(fix, /ph gsd test-run/);
  assert.match(fix, /never from a truncated terminal/);
  assert.ok(r.logs.some((l) => /last edit unverified; the next gate verifies it/.test(l)), r.logs.join("\n"));
  assert.ok(!r.logs.some((l) => /owner decision needed/.test(l)), r.logs.join("\n"));
});

test("G109 F3 a fixer that asks for an owner decision still stops needs-owner when the gate stays red", async () => {
  const w = world();
  w.write("fail.flag", "error test/a.test.js:1\n");
  const r = await runScript("gsd-execute", {
    root: w.root,
    args: { phaseDir: PHASE_DIR },
    gsd: w.gsd,
    agent: executor(w, {
      "exec-01-01": async (p, o, n, calls) => executor(w)(p, o, n, calls),
      "fix-01-01": () => ({ deviations: [{ rule: 4, note: "owner decision: the public API must change" }], taskResults: [{ task: "1", status: "partial", evidence: "owner decision: the public API must change" }], requests: [] }),
    }),
  });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Gate");
  assert.match(r.result.reason, /owner decision needed/);
});

test("G109 F3 an integration fixer whose last edit is unverified reaches the next gate", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } } });
  w.write("tools/run.mjs", PRINT);
  w.write("test/lib.test.js", "lib\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "lib test");
  w.write("fail.flag", "error test/lib.test.js:1\n");
  const r = await runScript("gsd-execute", {
    root: w.root,
    args: { phaseDir: PHASE_DIR },
    gsd: w.gsd,
    agent: executor(w, {
      "exec-01-01": async (p, o, n, calls) => executor(w)(p, o, n, calls),
      "integration-fix-1": () => {
        fs.rmSync(path.join(w.root, "fail.flag"), { force: true });
        return { status: "unresolved", lastEdit: "unverified", attempts: 3, remaining_failures: 1, evidence: "[UNVERIFIED] No fresh tests were run" };
      },
    }),
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.ok(r.logs.some((l) => /integration fixer: last edit unverified/.test(l)), r.logs.join("\n"));
});
