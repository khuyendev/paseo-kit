// Review fixes of the adapter contract (CR-HAR-01..05): mutex ownership, closed hook shapes, the gate's
// obligation argv and the one evidence validator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { runArgv } from "../../ship/.agents/harness/lib/proc.mjs";
import { gateObligation } from "../../ship/.agents/harness/adapter/contract.mjs";
import { invokeHook } from "../../ship/.agents/harness/adapter/hooks.mjs";
import { mutexDir, tryLock, unlock, withMutex } from "../../ship/.agents/harness/adapter/mutex.mjs";
import { currentInputs, evidenceVerdict, executionProblem, requiredSteps } from "../../ship/.agents/harness/adapter/evidence.mjs";
import { P1, gsd, plan as planText, project } from "../gsd-core/fixture.mjs";

const MUTEX_URL = pathToFileURL(path.join(SHIP_DIR, ".agents/harness/adapter/mutex.mjs")).href;
const ECHO_ARGS = "console.log(JSON.stringify(process.argv.slice(1)))";
const VOCAB = (extra = {}) => ({
  build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
  cmd: { prefix: "cmd:", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
  ...extra,
});
const COMMANDS = (extra = {}) => ({ build: null, test: null, build_timeout_s: 300, test_timeout_s: 600, gates: [], verify: {}, ...extra });
const seedOwner = (dir, owner) => {
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "owner"), JSON.stringify(owner));
};
const ownerOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "owner"), "utf8"));

test("ADPT-10 two contenders of one stale lock: the late reaper never removes the new owner's lock", () => {
  const tmp = makeTempDir();
  const dir = mutexDir("m", tmp);
  seedOwner(dir, { pid: 999999999, token: "dead" });
  const realMkdir = fs.mkdirSync;
  let tokenA = null;
  // Contender B has read the dead owner; before its reap claim, contender A takes the lock over completely.
  fs.mkdirSync = function (p, ...rest) {
    if (String(p) === path.join(dir, "reap") && tokenA === null) {
      fs.mkdirSync = realMkdir;
      tokenA = tryLock("m", { tmp });
    }
    return realMkdir.call(fs, p, ...rest);
  };
  let tokenB;
  try {
    tokenB = tryLock("m", { tmp });
  } finally {
    fs.mkdirSync = realMkdir;
  }
  assert.ok(tokenA, "A took the stale lock over");
  assert.equal(tokenB, null, "B does not get the lock");
  assert.equal(ownerOf(dir).token, tokenA, "A's lock is intact");
  assert.equal(fs.existsSync(path.join(dir, "reap")), false, "B withdrew its reap claim");
  unlock("m", tokenA, { tmp });
  assert.equal(fs.existsSync(dir), false);
});

test("ADPT-10 release after an ownership change leaves the other owner's lock", () => {
  const tmp = makeTempDir();
  const dir = mutexDir("m", tmp);
  const mine = tryLock("m", { tmp });
  fs.rmSync(dir, { recursive: true });
  seedOwner(dir, { pid: process.pid, token: "other" });
  unlock("m", mine, { tmp });
  assert.equal(ownerOf(dir).token, "other");
});

test("ADPT-10 a crash during lock creation never blocks: drafts are ignored and an ownerless lock is reaped when old", () => {
  const tmp = makeTempDir();
  const dir = mutexDir("m", tmp);
  fs.mkdirSync(`${dir}.crashed.tmp`);
  const t = tryLock("m", { tmp });
  assert.ok(t, "a leftover draft does not hold the lock");
  unlock("m", t, { tmp });
  fs.mkdirSync(dir);
  assert.equal(tryLock("m", { tmp }), null, "a fresh ownerless lock may be mid-creation by another tool");
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(dir, old, old);
  assert.ok(tryLock("m", { tmp }), "an old ownerless lock was abandoned");
});

test("ADPT-10 two processes contending for a dead owner's lock never run the heavy command at once", async () => {
  const tmp = makeTempDir();
  seedOwner(mutexDir("heavy", tmp), { pid: 999999999, token: "dead" });
  const log = path.join(tmp, "spans.txt");
  const script = `import fs from "node:fs";
const { withMutex } = await import(${JSON.stringify(MUTEX_URL)});
await withMutex("heavy", async () => {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 400));
  fs.appendFileSync(${JSON.stringify(log)}, start + " " + Date.now() + "\\n");
}, { tmp: ${JSON.stringify(tmp)} });
`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exit ${code}`))));
  });
  await Promise.all([run(), run()]);
  const spans = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number)).sort((a, b) => a[0] - b[0]);
  assert.equal(spans.length, 2);
  assert.ok(spans[1][0] >= spans[0][1], `heavy commands overlapped: ${JSON.stringify(spans)}`);
  assert.equal(fs.existsSync(mutexDir("heavy", tmp)), false);
});

test("ADPT-10 withMutex keeps the wait report and releases the lock", async () => {
  const tmp = makeTempDir();
  const lines = [];
  const slow = () => new Promise((r) => setTimeout(r, 200));
  await Promise.all([withMutex("w", slow, { log: (l) => lines.push(l), tmp }), withMutex("w", slow, { log: (l) => lines.push(l), tmp })]);
  assert.deepEqual(lines, ["waiting for mutex w"]);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

// A hook whose answer is chosen by HOOK_REPLY (a JSON text or raw text) per test case.
const REPLY_HOOK = "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(process.env.HOOK_REPLY));\n";

async function hookWith(reply, op, fields) {
  const root = makeTempDir("adapter code root ");
  fs.writeFileSync(path.join(root, "hook.mjs"), REPLY_HOOK);
  process.env.HOOK_REPLY = typeof reply === "string" ? reply : JSON.stringify(reply);
  try {
    return await invokeHook({ adapter: { hook_timeout_s: 5 } }, { codeRoot: root, script: "hook.mjs", op, ...fields });
  } finally {
    delete process.env.HOOK_REPLY;
  }
}

test("ADPT-15 resolve needs exactly one well-formed result per requested target", async () => {
  const req = { kind: "test", targets: ["x", "y"], plan: "01", filesModified: [] };
  const ok = (target) => ({ target, status: "ok" });
  assert.equal((await hookWith({ v: 1, results: [ok("x"), ok("y")] }, "resolve", req)).ok, true);
  const cases = {
    omitted: { v: 1, results: [ok("x")] },
    empty: { v: 1, results: [] },
    nullResult: { v: 1, results: [null, ok("y")] },
    duplicate: { v: 1, results: [ok("x"), ok("x"), ok("y")] },
    unexpected: { v: 1, results: [ok("x"), ok("y"), ok("z")] },
    extraResultField: { v: 1, results: [ok("x"), { ...ok("y"), score: 1 }] },
    extraField: { v: 1, results: [ok("x"), ok("y")], note: "hi" },
  };
  for (const [name, reply] of Object.entries(cases)) {
    const r = await hookWith(reply, "resolve", req);
    assert.deepEqual([r.ok, r.status], [false, "unresolvable"], name);
  }
  const trailing = await hookWith(`${JSON.stringify({ v: 1, results: [ok("x"), ok("y")] })}\ngarbage\n`, "resolve", req);
  assert.match(trailing.reason, /2 output lines/);
});

test("ADPT-15 attribute, shared, parse and evidence responses are closed and tied to their request", async () => {
  const attrReq = { failures: [{ text: "boom" }], plans: [{ id: "01", owns: [] }] };
  assert.equal((await hookWith({ v: 1, assignments: [{ failure: "boom", plan: "01" }] }, "attribute", attrReq)).ok, true);
  for (const reply of [{ v: 1, assignments: [null] }, { v: 1, assignments: [] }, { v: 1, assignments: [{ failure: "boom", plan: "99" }] }]) {
    assert.equal((await hookWith(reply, "attribute", attrReq)).ok, false, JSON.stringify(reply));
  }
  assert.equal((await hookWith({ v: 1, shared: ["a.lock"] }, "shared", { paths: ["a.lock", "b.js"] })).ok, true);
  assert.equal((await hookWith({ v: 1, shared: ["c.lock"] }, "shared", { paths: ["a.lock"] })).ok, false);
  assert.equal((await hookWith({ v: 1, targets: ["a"], extra: 1 }, "parse", { kind: "k", argument: "a" })).ok, false);
  const evReq = { kind: "k", argument: "", targets: [], exitCode: 0, stdoutPath: "o", stderrPath: "e" };
  assert.equal((await hookWith({ v: 1, executed: { count: 1, targets: [], more: 1 }, failed: [], outcome: "passed" }, "evidence", evReq)).ok, false);
  await assert.rejects(invokeHook({ adapter: { hook_timeout_s: 1 } }, { codeRoot: ".", script: "x.mjs", op: "parse", kind: "k", argument: "", extra: 1 }), /unknown field extra/);
});

test("ADPT-15 an incomplete resolver answer makes check verify-command-paths unresolvable, never ok", async () => {
  const resolver = "process.stdin.resume(); process.stdin.on('end', () => console.log(process.env.HOOK_REPLY));\n";
  const task = `<task type="auto">\n<name>T</name><action>a</action><verify><automated>check: src/a.js</automated><fails_when>x</fails_when></verify>\n</task>`;
  const p = project({
    files: { "hooks/resolve.mjs": resolver, "src/a.js": "", [`${P1}/01-01-PLAN.md`]: planText({ files: "[src/a.js]", tasks: task }) },
    overlay: { adapter: { verify_vocabulary: VOCAB({ check: { prefix: "check:", parser: null, resolver: "hooks/resolve.mjs", runner: null, evidence_parser: null, exit_code_sufficient: true } }), hook_timeout_s: 5 } },
  });
  for (const reply of [{ v: 1, results: [] }, { v: 1, results: [null] }]) {
    process.env.HOOK_REPLY = JSON.stringify(reply);
    const r = await gsd(p, ["check", "verify-command-paths", "1"]).finally(() => delete process.env.HOOK_REPLY);
    assert.notEqual(r.json.status, "ok", JSON.stringify(reply));
    const row = r.json.commands.find((c) => c.command === "check: src/a.js");
    assert.deepEqual([row.status, row.severity], ["unresolvable", "warning"]);
  }
});

const RUNNER_CFG = (parser = null) => ({
  commands: COMMANDS({ verify: { runner: { argv: [process.execPath, "-e", ECHO_ARGS, "filter={argument}", "{targets}"], timeout_s: 60 } } }),
  verify_vocabulary: VOCAB({ test: { prefix: "test:", parser, resolver: null, runner: "runner", evidence_parser: null, exit_code_sufficient: false } }),
  hook_timeout_s: 5,
});

test("ADPT-03 the gate's obligation argv substitutes {argument} and {targets}, one element per spaced target", async () => {
  const p = makeTempProject({ git: false, overlay: { adapter: RUNNER_CFG() } });
  const cfg = loadConfig(p.root);
  const o = await gateObligation(cfg, { codeRoot: p.root, kind: "test", command: "test: login flow" });
  assert.equal(o.outcome, "ready");
  assert.deepEqual(o.targets, ["login flow"]);
  assert.deepEqual(JSON.parse((await runArgv(o.argv, {})).stdout), ["filter=login flow", "login flow"]);
  assert.equal(o.argv.includes("{targets}"), false);
  const k = loadConfig(makeTempProject({ git: false }).root);
  assert.equal((await gateObligation(k, { codeRoot: p.root, kind: "build", command: "build" })).outcome, "not_configured");
  assert.deepEqual((await gateObligation(k, { codeRoot: p.root, kind: "cmd", command: 'cmd: node "my tool.mjs" a;b' })).argv, ["node", "my tool.mjs", "a;b"]);
  assert.equal((await gateObligation(k, { codeRoot: p.root, kind: "nope", command: "nope: x" })).outcome, "unavailable");
});

test("ADPT-03 a failed parser makes the obligation unavailable and gives no runner argv", async () => {
  const p = makeTempProject({ git: false, files: { "tools/parse.mjs": "console.log('not json')\n" }, overlay: { adapter: RUNNER_CFG("tools/parse.mjs") } });
  const o = await gateObligation(loadConfig(p.root), { codeRoot: p.root, kind: "test", command: "test: login" });
  assert.equal(o.outcome, "unavailable");
  assert.equal(o.argv, null);
  assert.match(o.reason, /unparsable response/);
  const steps = await requiredSteps(loadConfig(p.root), { codeRoot: p.root, plans: [{ id: "01", verify: [{ task: "1", kind: "test", command: "test: login" }] }] });
  assert.match(steps.find((s) => s.name === "01-1-test").unresolvable, /unparsable/);
});

test("ADPT-17 executionProblem: zero, missing and absent executed lists are no proof unless the kind is exit-code-sufficient", () => {
  assert.equal(executionProblem({ targets: ["a"], executed: { count: 1, targets: ["a"] } }), null);
  assert.match(executionProblem({ targets: ["a"], executed: { count: 0, targets: [] } }), /executed 0 of 1/);
  assert.match(executionProblem({ targets: ["a", "b"], executed: { count: 1, targets: ["a"] } }), /b not executed/);
  assert.match(executionProblem({ targets: ["a"], executed: { count: null, targets: [] } }), /no executed list/);
  assert.equal(executionProblem({ targets: ["a"], executed: { count: null, targets: [] }, exitCodeSufficient: true }), null);
});

test("ADPT-17 the validator rejects empty, partial, contradictory, logless and moved-HEAD evidence", async () => {
  const p = makeTempProject({ files: { "src/a.js": "1\n", "logs/s.log": "ok\n" } });
  const cfg = loadConfig(p.root);
  const plans = [{ id: "01", verify: [{ task: "1", kind: "cmd", command: "cmd: node src/a.js" }] }];
  const requested = await requiredSteps(cfg, { codeRoot: p.root, plans });
  assert.deepEqual(requested.map((s) => s.name), ["build", "test", "01-1-cmd"]);
  const inputs = await currentInputs(p.root, ["src/a.js"]);
  const step = (name, extra = {}) => ({ name, argv: ["x"], outcome: "passed", exitCode: 0, executed: { count: null, targets: [] }, log: "logs/s.log", ...extra });
  const verdict = (steps, ins = inputs) => {
    p.writeJson("ev.json", { v: 1, waveId: "w1", at: "2026-10-20T00:00:00Z", inputs: ins, steps });
    return evidenceVerdict(p.path("ev.json"), { codeRoot: p.root, requested, inputs });
  };
  // The obligation step carries the command the plan asks for now (G063: a changed command is stale evidence; kit
  // feedback 97: only that obligation is stale, the evidence is partial).
  const obArgv = requested.find((s) => s.name === "01-1-cmd").argv;
  const all = [step("build"), step("test"), step("01-1-cmd", { argv: obArgv })];
  assert.equal(verdict(all).verdict, "green");
  assert.deepEqual(verdict([step("build"), step("test"), step("01-1-cmd")]), { verdict: "partial", reasons: ["01-1-cmd: command changed since the gate ran"], staleSteps: [{ name: "01-1-cmd", reason: "command changed since the gate ran" }] });
  assert.equal(verdict([]).verdict, "incomplete");
  assert.equal(verdict([step("build"), step("01-1-cmd", { argv: obArgv })]).verdict, "incomplete");
  assert.equal(verdict([step("build", { exitCode: 1 }), step("test"), step("01-1-cmd", { argv: obArgv })]).verdict, "invalid");
  assert.equal(verdict([step("build", { executed: null }), step("test"), step("01-1-cmd", { argv: obArgv })]).verdict, "invalid");
  assert.equal(verdict([step("build", { log: null }), step("test"), step("01-1-cmd", { argv: obArgv })]).verdict, "invalid");
  assert.equal(verdict([step("build", { log: "logs/gone.log" }), step("test"), step("01-1-cmd", { argv: obArgv })]).verdict, "invalid");
  const notConfigured = verdict([step("build", { outcome: "not_configured", exitCode: null, log: null }), step("test"), step("01-1-cmd", { argv: obArgv })]);
  assert.deepEqual(notConfigured, { verdict: "failed", reasons: ["build: not_configured"] });
  assert.equal(verdict([...all, step("gate-extra", { outcome: "unavailable", exitCode: null, log: null })]).verdict, "failed");
  assert.equal(verdict(all, { ...inputs, head: "0".repeat(40) }).verdict, "stale");
});

// The real post-wave gate against the shared adapter contract (CR-HAR-01..03).
const { main: flowMain } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/01-core";
async function flow(root, argv, input) {
  let line = "";
  const code = await flowMain(argv, { root, input: JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

test("ADPT-02 the real gate reports null build and test as not configured and is never green", async () => {
  const p = makeTempProject({ files: { "src/a.js": "1\n" } });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [] });
  assert.equal(r.json.green, false);
  const steps = p.readJson(r.json.evidence).steps;
  for (const name of ["build", "test"]) assert.equal(steps.find((s) => s.name === name)?.outcome, "not_configured", name);
});

test("ADPT-03 the real gate runs the runner with substituted placeholders and never runs it after a parser failure", async () => {
  const capture = "require('fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(1)))";
  const adapter = (parser) => ({
    commands: COMMANDS({ test: [process.execPath, "-e", "0"], verify: { runner: { argv: [process.execPath, "-e", capture, "filter={argument}", "{targets}"], timeout_s: 60 } } }),
    verify_vocabulary: VOCAB({ test: { prefix: "test:", parser, resolver: null, runner: "runner", evidence_parser: null, exit_code_sufficient: true } }),
    hook_timeout_s: 5,
  });
  const plans = [{ id: "01-01", owns: ["Path:src/"], verify: [{ task: "1", kind: "test", command: "test: login flow" }] }];
  const p = makeTempProject({ files: { "src/a.js": "1\n" }, overlay: { adapter: adapter(null) } });
  await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.deepEqual(p.readJson("argv.json"), ["filter=login flow", "login flow"]);
  const q = makeTempProject({ files: { "src/a.js": "1\n", "tools/parse.mjs": "console.log('garbage')\n" }, overlay: { adapter: adapter("tools/parse.mjs") } });
  const r = await flow(q.root, ["gate", PD], { waveId: "w1", plans });
  assert.equal(r.json.green, false);
  assert.equal(fs.existsSync(q.path("argv.json")), false, "no runner after a parser failure");
});

test("ADPT-17 the real gate's evidence passes the shared validator and evidence-check refuses truncated evidence", async () => {
  const p = makeTempProject({ files: { "src/a.js": "1\n" }, overlay: { adapter: { commands: COMMANDS({ build: [process.execPath, "-e", "0"], test: [process.execPath, "-e", "0"] }) } } });
  const plans = [{ id: "01-01", owns: ["Path:src/"], verify: [{ task: "1", kind: "cmd", command: "cmd: node -v" }] }];
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.equal(r.json.green, true);
  const requested = await requiredSteps(loadConfig(p.root), { codeRoot: p.root, plans });
  const ev = p.readJson(r.json.evidence);
  assert.equal(evidenceVerdict(p.path(r.json.evidence), { codeRoot: p.root, requested, inputs: ev.inputs }).verdict, "green");
  p.writeJson(`${PD}/evidence/w9-1.json`, { v: 1, waveId: "w9", at: "x", inputs: { head: "different", files: {} }, steps: [] });
  assert.notEqual((await flow(p.root, ["evidence-check", `${PD}/evidence/w9-1.json`], { plans })).json.status, "current");
});
