import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { runGsd } from "../../ship/.agents/harness/gsd/commands.mjs";
import { main as flow } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { lock, unlock } from "../../ship/.agents/workflows/lib/flow-files.mjs";
import { v1RequirementIds } from "../../ship/.agents/workflows/lib/flow-project.mjs";
import { gate, evidenceCheck } from "../../ship/.agents/workflows/lib/flow-gate.mjs";
import { evidenceVerdict, requiredSteps } from "../../ship/.agents/harness/adapter/evidence.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { testEnv } from "../helpers/env.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { NULL, runScript } from "./host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "./world.mjs";

const node = process.execPath;
const green = [node, "-e", "process.exit(0)"];
const commands = { build: green, test: green, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
const plans = [{ id: "01-01", owns: ["Path:src/"], verify: [] }];
const review = (w, agent) => runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01"] }, agent });
const issue = { severity: "high", description: "bad plan", actionable: true };
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);

for (const role of ["plan_finder", "plan_verifier", "plan_judge"]) for (const failure of ["quota exhausted", "finished without a reply"]) {
  test(`GSDF-37 CR-GSF-09 ${role} ${failure} never converges`, async () => {
    const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
    const r = await review(w, (p, o) => {
      if (o.role === role) return NULL(failure);
      if (o.role === "plan_finder") return { issues: [issue] };
      if (o.role === "plan_verifier") return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
      throw new Error("unexpected role " + o.role);
    });
    assert.equal(r.result.status, "failed");
    assert.equal(r.calls.filter((c) => c.opts.role === role).length, failure.includes("quota") ? 1 : 2);
  });
}

test("GSDF-37 CR-GSF-09 a missing verdict cannot be dropped by the judge", async () => {
  const w = makeWorld({ files: { [`${PD}/01-01-PLAN.md`]: planText("01-01") } });
  const r = await review(w, (_p, o) => o.role === "plan_finder" ? { issues: [issue] } : { verdicts: [] });
  assert.equal(r.result.status, "failed");
  assert.equal(r.calls.some((c) => c.opts.role === "plan_judge"), false);
});

test("GSDF-44 CR-GSF-11 evidence uses the shared schema, independent required steps and rescanned scopes", async () => {
  const p = makeTempProject({ files: { "src/a.js": "a\n" }, overlay: { adapter: { commands } } });
  const g = await gate(p.root, PD, { waveId: "w1", plans });
  const ev = p.readJson(g.evidence);
  assert.equal(evidenceVerdict(p.path(g.evidence), { codeRoot: p.root, requested: await requiredSteps(loadConfig(p.root), { codeRoot: p.root, plans }), inputs: ev.inputs }).verdict, "green");
  assert.equal((await evidenceCheck(p.root, g.evidence, plans)).status, "current");
  p.write("src/new.js", "new file\n");
  assert.equal((await evidenceCheck(p.root, g.evidence, plans)).status, "stale");
  fs.rmSync(p.path("src/new.js"));
  p.writeJson(g.evidence, { ...ev, steps: [] });
  assert.equal((await evidenceCheck(p.root, g.evidence, plans)).status, "incomplete");
  p.writeJson(g.evidence, { ...ev, steps: null });
  assert.equal((await evidenceCheck(p.root, g.evidence, plans)).status, "invalid");
});

test("GSDF-44 CR-GSF-11 mutation during gates and unconfigured commands cannot certify green", async () => {
  const p = makeTempProject({ files: { "src/a.js": "old\n" }, overlay: { adapter: { commands: { ...commands, test: [node, "-e", "require('fs').writeFileSync('src/a.js','new')"] } } } });
  const g = await gate(p.root, PD, { waveId: "w1", plans });
  assert.equal(g.green, false);
  assert.ok(g.failures.some((f) => f.step === "inputs-stable"));
  const n = makeTempProject();
  const absent = await gate(n.root, PD, { waveId: "w1", plans: [] });
  assert.equal(absent.green, false);
  assert.deepEqual(n.readJson(absent.evidence).steps.map((s) => s.outcome), ["not_configured", "not_configured"]);
});

test("GSDF-44 CR-GSF-11 parser faults are unavailable, never a fallback to supplied targets", async () => {
  const p = makeTempProject({ files: { "parse.mjs": "console.log('bad JSON')" }, overlay: { adapter: { commands: { ...commands, verify: { unit: { argv: green, timeout_s: 30 } } }, verify_vocabulary: { test: { prefix: "test:", parser: "parse.mjs", resolver: null, runner: "unit", evidence_parser: null, exit_code_sufficient: true } } } } });
  const g = await gate(p.root, PD, { waveId: "w1", plans: [{ ...plans[0], verify: [{ task: "1", kind: "test", command: "test: suite", target: "suite" }] }] });
  assert.equal(g.green, false);
  assert.equal(p.readJson(g.evidence).steps.at(-1).outcome, "unavailable");
});

test("GSDF-32 CR-GSF-12 real attempt resume preserves the before hash after report write and completion", async () => {
  const w = makeWorld();
  for (const key of ["attempt show", "attempt record"]) w.gsd.on(key, async (_a, input, argv) => {
    const out = [];
    const code = await runGsd(argv, { root: w.root, env: testEnv(), stdin: input, out: (l) => out.push(l), err() {} });
    return { code, json: JSON.parse(out.at(-1)) };
  });
  let report = "old";
  w.gsd.on("verification status", () => ({ status: "gaps_found", sha: report, gaps: [{ id: "G1" }] }));
  w.gsd.on("verification fingerprint", () => ({ covered_files: [], covered_digest: "test" }));
  w.gsd.on("requirements revert", () => ({}));
  const original = w.gsd.handlers["attempt record"];
  w.gsd.on("attempt record", (a, input, argv) => {
    if (JSON.parse(input).done) throw new Error("simulated crash after report write");
    return original(a, input, argv);
  });
  const run = (agent) => runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PD }, runId: "wf_resume", agent });
  await assert.rejects(run(() => { report = "new"; return { status: "gaps_found" }; }), /simulated crash/);
  w.gsd.on("attempt record", original);
  for (let i = 0; i < 2; i++) {
    const resumed = await run(() => { throw new Error("must not dispatch"); });
    assert.equal(resumed.calls.length, 0);
    assert.equal(resumed.result.status, "gaps_found", JSON.stringify(resumed.result));
    const attempt = JSON.parse(w.read(`${PD}/verify-attempt.json`));
    assert.equal(attempt.before, "old");
    assert.equal(attempt.result, "new");
  }
});

test("GSDF-95 CR-GSF-13 category headings retain bullet and table v1 requirements", async () => {
  const text = "## v1 Requirements\n### Login\n- [ ] **AUTH-01**: Login\n### Data\n| DATA-01 | spec | rule | 1 | pending |\n## v2 Requirements\n- [ ] **NEXT-01**: Later\n";
  assert.deepEqual(v1RequirementIds(text, /^[A-Z]+-\d+$/), ["AUTH-01", "DATA-01"]);
  const p = makeTempProject({ files: { ".planning/REQUIREMENTS.md": text, ".planning/drafts/ROADMAP.md": "## Phase 1: Login\n**Requirements**: AUTH-01\n**Success Criteria**:\n1. a\n2. b\n", ".planning/drafts/traceability.json": '{"AUTH-01":"1"}' } });
  let result;
  assert.equal(await flow(["draft-check"], { root: p.root, out: (s) => { result = JSON.parse(s); } }), 1);
  assert.deepEqual(result.unmapped, ["DATA-01"]);
});

for (const status of ["stale", "blocked", "invalid", "incomplete"]) test(`GSDF-13 CR-GSF-20 default research reports ${status} without a dispatch or attempt`, async () => {
  const w = makeWorld();
  w.gsd.on("research status", () => ({ code: 1, json: { status } }));
  const r = await runScript("gsd-research", { root: w.root, gsd: w.gsd, args: { phaseDir: PD } });
  assert.equal(r.result.reportStatus, status);
  assert.equal(r.calls.length, 0);
  assert.equal(w.gsd.callsOf("attempt record").length, 0);
});

test("GSDF-64 CR-GSF-18 concurrent lock acquisition is exclusive, same-run live holders cannot be stolen", async () => {
  const p = makeTempProject();
  const module = new URL("../../ship/.agents/workflows/lib/flow-files.mjs", import.meta.url).href;
  const script = `import {lock} from ${JSON.stringify(module)}; console.log(JSON.stringify(lock(process.argv[1],'debug',process.argv[2],Number(process.argv[3]))));`;
  const attempt = (id) => new Promise((resolve, reject) => {
    const c = spawn(node, ["--input-type=module", "-e", script, p.root, id, String(process.pid)], { env: testEnv() });
    let text = ""; c.stdout.on("data", (d) => { text += d; }); c.on("error", reject); c.on("close", (code) => code ? reject(new Error(text)) : resolve(JSON.parse(text)));
  });
  const acquired = await Promise.all([attempt("first"), attempt("second")]);
  assert.equal(acquired.filter((r) => r.locked).length, 1);
  const held = p.readJson("_workspace/locks/debug.lock");
  assert.equal(lock(p.root, "debug", held.runId, process.pid).locked, false);
  assert.equal(unlock(p.root, "debug", "wrong-token").unlocked, false);
  assert.equal(unlock(p.root, "debug", held.token).unlocked, true);
  p.writeJson("_workspace/locks/debug.lock", { runId: "old", pid: 2147483647, token: "old" });
  const resumed = lock(p.root, "debug", "old", process.pid);
  assert.equal(resumed.locked, true);
  assert.equal(unlock(p.root, "debug", "old").unlocked, false);
  unlock(p.root, "debug", resumed.token);
});
