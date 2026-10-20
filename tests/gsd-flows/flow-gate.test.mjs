// Gate, evidence, attribution, review scope and draft checks of the flow helper.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/03-api";
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const adapter = (commands, vocab = {}) => ({ adapter: { commands: { build: null, test: null, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {}, ...commands }, ...(Object.keys(vocab).length ? { verify_vocabulary: { build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true }, cmd: { prefix: "cmd:", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true }, ...vocab } } : {}) } });
const plan = (verify = []) => ({ id: "03-01", owns: ["Path:src/a/"], verify });

test("GSDF-44 a failing test leaves the gate red; a test obligation that executed 0 tests fails; a build timeout is reported", async () => {
  const parser = "tools/count.mjs";
  const p = makeTempProject({
    files: { "src/a/x.js": "x\n", [parser]: "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify({v:1,executed:{count:0,targets:[]},failed:[],outcome:'passed'}))})\n" },
    overlay: adapter({ test: [NODE, "-e", "console.error('FAIL src/a/x.js: boom');process.exit(1)"], verify: { unit: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 30 } } }, { test: { prefix: "test:", parser: null, resolver: null, runner: "unit", evidence_parser: parser, exit_code_sufficient: false } }),
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [plan([{ task: "1", kind: "test", command: "test: suite-a", target: "suite-a" }])] });
  assert.equal(r.json.green, false);
  const steps = p.readJson(r.json.evidence).steps;
  assert.equal(steps.find((s) => s.name === "test").outcome, "failed");
  const ob = steps.find((s) => s.kind === "test");
  assert.equal(ob.outcome, "failed");
  assert.deepEqual(ob.executed, { count: 0, targets: [] });
  assert.deepEqual(r.json.byPlan["03-01"].map((f) => f.step).sort(), ["03-01-1-test", "test"]);
  const slow = makeTempProject({ overlay: adapter({ build: [NODE, "-e", "setTimeout(()=>{},20000)"], build_timeout_s: 1 }) });
  const t = await flow(slow.root, ["gate", PD], { waveId: "w1", plans: [plan()] });
  assert.equal(t.json.green, false);
  assert.match(t.json.timedOut[0], /build timed out .*exit 124/);
  assert.equal(slow.readJson(t.json.evidence).steps[0].outcome, "timeout");
});

test("GSDF-44 green evidence turns stale when a covered file changes", async () => {
  const p = makeTempProject({ files: { "src/a/x.js": "x\n" }, overlay: adapter({ test: [NODE, "-e", "process.exit(0)"] }) });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [plan()] });
  assert.equal(r.json.green, true);
  assert.equal((await flow(p.root, ["evidence-check", r.json.evidence], { plans: [plan()] })).json.status, "current");
  p.write("src/a/x.js", "fixer edit\n");
  const st = await flow(p.root, ["evidence-check", r.json.evidence], { plans: [plan()] });
  assert.equal(st.json.status, "stale");
  fs.rmSync(p.path(p.readJson(r.json.evidence).steps[0].log));
  assert.equal((await flow(p.root, ["evidence-check", r.json.evidence])).json.status, "invalid");
});

test("GSDF-51 failures are attributed by owns, the rest is unplaced; a red adapter gate skips later obligations", async () => {
  const p = makeTempProject({
    files: { "src/a/x.js": "x\n", "lib/shared.js": "s\n" },
    overlay: adapter({ gates: [{ name: "lint", argv: [NODE, "-e", "console.log('error src/a/x.js:3');console.log('error lib/shared.js:1');process.exit(1)"] }] }, { }),
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [plan([{ task: "1", kind: "cmd", command: `cmd: node -v` }]), { id: "03-02", owns: ["Path:src/b/"], verify: [] }] });
  assert.deepEqual(Object.keys(r.json.byPlan), ["03-01"]);
  const ev = p.readJson(r.json.evidence);
  assert.equal(ev.steps.find((s) => s.plan === "03-01").outcome, "not_executed");
  assert.ok(r.json.failures.some((f) => f.outcome === "not_executed"));
  const lint = r.json.failures.find((f) => f.step === "gate-lint");
  assert.deepEqual(lint.files.sort(), ["lib/shared.js", "src/a/x.js"]);
  assert.match(lint.excerpt, /^error src\/a\/x\.js:3/);
});

test("GSDF-53 commits.json entries are appended atomically as a JSON array", async () => {
  const p = makeTempProject();
  await flow(p.root, ["json-push", `${PD}/commits.json`], { sha: "a1", phase: "03", wave: 1, plans: { "03-01": ["src/a/x.js"] } });
  await flow(p.root, ["json-push", `${PD}/commits.json`], { sha: "b2", phase: "03", wave: 2, plans: { "03-02": [] } });
  assert.deepEqual(p.readJson(`${PD}/commits.json`).map((c) => c.sha), ["a1", "b2"]);
  assert.equal((await flow(p.root, ["write", ".planning/STATE.md"], "x")).code, 1);
});

test("GSDF-92 review scope: SUMMARY key-files, explicit list kept narrow, omitted changes added, planning and lockfiles excluded", async () => {
  const p = makeTempProject({ files: { Dockerfile: "FROM x\n", "src/a/x.js": "x\n", "src/a/y.js": "y\n", "package-lock.json": "{}\n", [`${PD}/03-01-SUMMARY.md`]: "---\nkey-files:\n  created: [Dockerfile]\n---\n" } });
  const only = await flow(p.root, ["review-scope", PD], { plan: "03-01", summary: `${PD}/03-01-SUMMARY.md` });
  assert.deepEqual(only.json.scope, ["Dockerfile"]);
  const narrow = await flow(p.root, ["review-scope", PD], { plan: "03-01", files: ["src/a/x.js"], summary: `${PD}/03-01-SUMMARY.md` });
  assert.deepEqual([narrow.json.source, narrow.json.scope], ["explicit", ["src/a/x.js"]]);
  p.writeJson(`${PD}/commits.json`, [{ sha: "s", phase: "03", wave: 1, plans: { "03-01": ["Dockerfile", "src/a/y.js", "package-lock.json", `${PD}/03-01-SUMMARY.md`], "03-02": ["src/a/x.js"] } }]);
  const crossed = await flow(p.root, ["review-scope", PD], { plan: "03-01", summary: `${PD}/03-01-SUMMARY.md` });
  assert.deepEqual(crossed.json.scope, ["Dockerfile", "src/a/y.js"]);
  assert.ok(crossed.json.log.some((l) => l.startsWith("added src/a/y.js")));
  assert.deepEqual(crossed.json.excluded.map((e) => e.reason).sort(), ["lockfile", "planning artifact"]);
  const rec = { plan: "03-01", scope: crossed.json.scope, excluded: [], lenses: ["correctness"], codeOnly: false, findings: [{ id: "F1", severity: "high", trigger: "t", likelihood: "likely", confidence: 90, impact: "i", file: "Dockerfile", line: 1, status: "gated", verdict: "confirmed" }], resolution: [] };
  const w = await flow(p.root, ["review-record", PD], { waveId: "w1", record: rec });
  assert.equal(w.code, 0);
  assert.match(p.read(`${PD}/03-REVIEW.md`), /\| F1 \| high \| gated \| confirmed \|/);
  assert.equal((await flow(p.root, ["review-record", PD], { waveId: "w1", record: { ...rec, findings: [{ ...rec.findings[0], confidence: 120 }] } })).code, 1);
});

test("GSDF-95 roadmapper draft check names an unmapped v1 requirement and checks 2-5 success criteria", async () => {
  const req = "# Requirements\n\n## v1 Requirements\n\n- [ ] **AUTH-01**: login\n- [ ] **AUTH-02**: logout\n\n## v2 Requirements\n\n- [ ] **AUTH-09**: sso\n";
  const draft = (crit) => `# Roadmap\n\n## Phase 1: Auth\n**Goal**: g\n**Depends on**: none\n**Requirements**: AUTH-01\n**Success Criteria**:\n${crit}\n`;
  const p = makeTempProject({ files: { ".planning/REQUIREMENTS.md": req, ".planning/drafts/ROADMAP.md": draft("1. a\n2. b"), ".planning/drafts/traceability.json": JSON.stringify({ "AUTH-01": "1" }) } });
  const r = await flow(p.root, ["draft-check"]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.unmapped, ["AUTH-02"]);
  p.write(".planning/drafts/ROADMAP.md", draft("1. a").replace("AUTH-01", "AUTH-01, AUTH-02"));
  p.write(".planning/drafts/traceability.json", JSON.stringify({ "AUTH-01": "1", "AUTH-02": "1" }));
  assert.deepEqual((await flow(p.root, ["draft-check"])).json.problems, ["phase 1: 1 success criteria (needs 2-5)"]);
  p.write(".planning/drafts/ROADMAP.md", draft("1. a\n2. b\n3. c").replace("AUTH-01", "AUTH-01, AUTH-02"));
  assert.equal((await flow(p.root, ["draft-check"])).code, 0);
  assert.equal(fs.existsSync(p.path(".planning/ROADMAP.md")), false);
});
