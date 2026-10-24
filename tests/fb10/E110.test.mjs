// Kit feedback 110 and 111: a gap wave's commit subject and record, and a verb that refreshes a phase's stale batch evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { subjectScope } from "../../ship/.agents/harness/gsd/gitverbs.mjs";
import { gsd, project } from "../gsd-core/fixture.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;
const PD = ".planning/phases/03-ui";
const COMMANDS = { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
const OB = { task: "1", kind: "cmd", command: "cmd: node -v" };

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

function phaseProject(commands = COMMANDS, files = {}) {
  return project({
    overlay: { adapter: { commands } },
    files: {
      "src/a/x.js": "x\n",
      "src/b/y.js": "y\n",
      [`${PD}/handoff/w1.args.json`]: JSON.stringify({ wave: 1, waveId: "w1", tasks: [{ plan: "03-01", owns: ["Path:src/a/"], verify: [OB] }] }),
      [`${PD}/handoff/w2.args.json`]: JSON.stringify({ wave: 2, waveId: "w2", tasks: [{ plan: "03-02", owns: ["Path:src/b/"], verify: [] }] }),
      [`${PD}/handoff/gap-w1.args.json`]: JSON.stringify({ wave: 1, waveId: "gap-w1", tasks: [{ plan: "03-13", owns: ["Path:src/a/"], verify: [{ task: "9", kind: "cmd", command: "cmd: node -e \"process.exit(9)\"" }] }] }),
      ...files,
    },
  });
}

const deadPid = () => new Promise((resolve) => {
  const c = spawn(NODE, ["-e", "process.exit(0)"], { windowsHide: true });
  c.on("exit", () => resolve(c.pid));
});

test("E110 110 subjectScope reads a gap wave and a real wave, and a gap plan stays a plan", () => {
  assert.equal(subjectScope("fix(04-gap1): phase 04 gap wave 1").unit, "gap1");
  assert.equal(subjectScope("fix(04-gap1): phase 04 gap wave 1").plan, null);
  assert.equal(subjectScope("feat(02.1-w1): phase 02.1 wave 1").unit, "w1");
  assert.equal(subjectScope("fix(04-13): phase 04 plan 04-13").plan, "04-13");
});

test("E110 110 evaluation-scope and select-revert find a gap wave commit and a real wave commit", async () => {
  const p = project();
  const base = p.git("rev-parse", "HEAD");
  p.write("src/g.js", "g\n");
  p.git("add", "-A");
  p.git("commit", "-qm", "fix(03-gap1): phase 03 gap wave 1");
  const gap = p.git("rev-parse", "HEAD");
  p.write("src/w.js", "w\n");
  p.git("add", "-A");
  p.git("commit", "-qm", "feat(03-w2): phase 03 wave 2");
  const wave = p.git("rev-parse", "HEAD");
  p.writeJson(`${PD}/commits.json`, [
    { sha: gap, phase: "03", wave: 1, plans: { "03-13": ["src/g.js"] }, gaps: ["03-13"] },
    { sha: wave, phase: "03", wave: 2, plans: { "03-01": ["src/w.js"], "03-13": ["src/w.js"] } },
  ]);
  const scope = await gsd(p, ["check", "evaluation-scope", "--plan", "03-13"]);
  assert.deepEqual(scope.json.commits.map((c) => c.sha).sort(), [gap, wave].sort());
  const reverted = await gsd(p, ["select-revert-commits", "--plan", "03-13", "--range", `${base}..HEAD`]);
  assert.deepEqual(reverted.json.commits.map((c) => c.sha).sort(), [gap, wave].sort());
  const shared = reverted.json.commits.find((c) => c.sha === wave);
  assert.equal(shared.shared, true);
  assert.deepEqual(shared.siblings, ["03-01"]);
});

test("E110 110 a gap wave commits as fix(N-gapk) and the record names the gap ids; per-plan uses fix(id)", async () => {
  const exec = (w, args = {}, overlayRuns) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, gapsOnly: true, ...args }, gsd: w.gsd, agent: executor(w, overlayRuns) });
  const g = makeExecWorld({ waves: [[task("01-13"), task("01-14")]], prefix: "gap-", meta: { "01-13": { gap: true }, "01-14": { gap: true } } });
  g.attempts.gap = { key: "k", runId: "wf_plan", inputDigest: "v", before: "b", done: true, result: { plans: ["01-13", "01-14"], waveExecuted: false } };
  const r = await exec(g);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(g.git("log", "-1", "--format=%s").stdout.trim(), "fix(01-gap1): phase 01 gap wave 1");
  assert.match(g.git("log", "-1", "--format=%B").stdout, /Plans: 01-13,01-14/);
  const entry = JSON.parse(g.read(`${PHASE_DIR}/commits.json`))[0];
  assert.equal(entry.wave, 1);
  assert.deepEqual(entry.gaps, ["01-13", "01-14"]);
  const one = makeExecWorld({ waves: [[task("01-13")]], prefix: "gap-", meta: { "01-13": { gap: true } }, overlay: { gsd: { commit_policy: { docs: false, code: "per-plan" } } } });
  one.attempts.gap = { key: "k", runId: "wf_plan", inputDigest: "v", before: "b", done: true, result: { plans: ["01-13"], waveExecuted: false } };
  const pr = await exec(one);
  assert.equal(pr.result.status, "executed", JSON.stringify(pr.result));
  assert.equal(one.git("log", "-1", "--format=%s").stdout.trim(), "fix(01-13): phase 01 plan 01-13");
  assert.deepEqual(JSON.parse(one.read(`${PHASE_DIR}/commits.json`))[0].gaps, ["01-13"]);
});

test("E110 111 F1 evidence refresh reruns the batch gate from w* handoff, names what ran, and a second run is current", async () => {
  const p = phaseProject();
  const r = await gsd(p, ["evidence", "refresh", "3"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.waveId, "batch");
  assert.deepEqual(r.json.plans, ["03-01", "03-02"]);
  assert.deepEqual(r.json.obligations, ["03-01 cmd cmd: node -v"]);
  assert.ok(r.json.suite.test.includes("process.exit(0)"), JSON.stringify(r.json.suite));
  assert.match(r.json.evidence, /03-ui\/evidence\/batch-1\.json$/);
  assert.match(r.stdout, new RegExp(`evidence: ${r.json.evidence.replace(/[.]/g, "\\.")}`));
  assert.equal(r.stdout.includes("03-13"), false, "a gap handoff plan is not part of the phase batch");
  const ev = p.readJson(r.json.evidence);
  assert.equal(ev.waveId, "batch");
  p.write("src/a/x.js", "later phase\n");
  const stale = await flow(p.root, ["evidence-check", r.json.evidence], { plans: [{ id: "03-01", owns: ["Path:src/a/"], verify: [OB] }, { id: "03-02", owns: ["Path:src/b/"], verify: [] }] });
  assert.equal(stale.json.status, "stale", JSON.stringify(stale.json));
  const again = await gsd(p, ["evidence.refresh", "03"]);
  assert.equal(again.code, 0, JSON.stringify(again.json));
  assert.match(again.json.evidence, /batch-2\.json$/);
  const now = await flow(p.root, ["evidence-check", again.json.evidence], { plans: [{ id: "03-01", owns: ["Path:src/a/"], verify: [OB], waveId: "w1", batch: "batch" }, { id: "03-02", owns: ["Path:src/b/"], verify: [], waveId: "w2", batch: "batch" }] });
  assert.equal(now.json.status, "current", JSON.stringify(now.json));
});

test("E110 111 F1 evidence refresh refuses a live phase lease, a dead one does not, and a bad or gap-only handoff is named", async () => {
  const live = phaseProject();
  live.writeJson("_workspace/locks/phase-03.lock", { runId: "wf_live", pid: process.pid, token: "t", kind: "gsd-execute" });
  const refused = await gsd(live, ["evidence", "refresh", "3"]);
  assert.equal(refused.code, 1);
  assert.match(refused.json.error, /gsd-execute run of phase 03 is live \(wf_live\)/);
  assert.equal(fs.existsSync(live.path(`${PD}/evidence`)), false);
  live.writeJson("_workspace/locks/phase-03.lock", { runId: "wf_dead", pid: await deadPid(), token: "t", kind: "gsd-execute" });
  const gone = await gsd(live, ["evidence.refresh", "3"]);
  assert.equal(gone.code, 0, JSON.stringify(gone.json));
  const bad = project({ files: { [`${PD}/handoff/w1.args.json`]: "{" } });
  const malformed = await gsd(bad, ["evidence", "refresh", "3"]);
  assert.equal(malformed.code, 1);
  assert.match(malformed.json.error, /handoff\/w1\.args\.json is not valid handoff JSON/);
  const gapOnly = project({ files: { [`${PD}/handoff/gap-w1.args.json`]: "{\"tasks\":[]}\n" } });
  const named = await gsd(gapOnly, ["evidence", "refresh", "3"]);
  assert.equal(named.code, 1);
  assert.match(named.json.error, /no w\*\.args\.json/);
  const missing = await gsd(project(), ["evidence", "refresh", "1"]);
  assert.equal(missing.code, 1);
  assert.match(missing.json.error, /w\*\.args\.json/);
});

test("E110 111 F1 a red batch gate still prints the evidence path", async () => {
  const red = phaseProject({ ...COMMANDS, test: [NODE, "-e", "process.exit(1)"] });
  const r = await gsd(red, ["evidence", "refresh", "3"]);
  assert.equal(r.code, 1);
  assert.equal(r.json.green, false);
  assert.match(r.json.evidence, /batch-1\.json$/);
  assert.match(r.stdout, /red,/);
  assert.equal(fs.existsSync(red.path(r.json.evidence)), true);
});

function verify(w, evidence) {
  w.gsd.on("verification status", () => ({ code: 66, json: { status: "missing" } }));
  return runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, evidence }, agent: () => ({ status: "passed" }) });
}

test("E110 111 F2 every stale evidence file stops needs-owner with evidence.refresh and does not call the verifier", async () => {
  const t = task("01-01", { verify: [OB] });
  const w = makeExecWorld({ waves: [[t]] });
  const plans = [{ id: t.plan, owns: t.owns, verify: t.verify }];
  const g1 = await flow(w.root, ["gate", PHASE_DIR], { waveId: "batch", plans });
  assert.equal(g1.json.green, true, JSON.stringify(g1.json));
  w.write("src/01-01/.keep", "changed by a later phase\n");
  const st = await flow(w.root, ["evidence-check", g1.json.evidence], { plans: [{ ...plans[0], waveId: "w1", batch: "batch" }] });
  assert.equal(st.json.status, "stale", JSON.stringify(st.json));
  const v = await verify(w, [g1.json.evidence]);
  assert.equal(v.calls.length, 0, "the verifier is not sent stale verdicts");
  assert.equal(v.result.status, "needs-owner");
  assert.equal(v.result.stage, "Evidence");
  assert.deepEqual(v.result.answer, { verb: "evidence.refresh", command: "ph gsd evidence refresh 01" });
  assert.match(v.result.reason, /batch-1\.json/);
});

test("E110 111 F2 partial evidence and a mix of current and stale still reach the verifier", async () => {
  const t = task("01-01", { verify: [OB] });
  const w = makeExecWorld({ waves: [[t]] });
  const plans = [{ id: t.plan, owns: t.owns, verify: t.verify, waveId: "w1", batch: "batch" }];
  const g1 = await flow(w.root, ["gate", PHASE_DIR], { waveId: "batch", plans });
  assert.equal(g1.json.green, true, JSON.stringify(g1.json));
  const h = JSON.parse(w.read(`${PHASE_DIR}/handoff/w1.args.json`));
  h.tasks[0].verify = [{ task: "1", kind: "cmd", command: "cmd: node -e \"process.exit(0)\"" }];
  w.write(`${PHASE_DIR}/handoff/w1.args.json`, JSON.stringify(h));
  const partial = await flow(w.root, ["evidence-check", g1.json.evidence], { plans: [{ ...plans[0], verify: h.tasks[0].verify }] });
  assert.equal(partial.json.status, "partial", JSON.stringify(partial.json));
  const vp = await verify(w, [g1.json.evidence]);
  assert.equal(vp.result.status === "needs-owner", false, JSON.stringify(vp.result));
  assert.equal(vp.calls.length, 1);
  assert.match(vp.calls[0].prompt, /Partly current evidence/);
  const mix = makeExecWorld({ waves: [[t]] });
  const first = await flow(mix.root, ["gate", PHASE_DIR], { waveId: "batch", plans });
  mix.write("src/01-01/.keep", "changed\n");
  const second = await flow(mix.root, ["gate", PHASE_DIR], { waveId: "batch", plans });
  assert.equal(second.json.green, true, JSON.stringify(second.json));
  const vm = await verify(mix, [first.json.evidence, second.json.evidence]);
  assert.equal(vm.calls.length, 1);
  assert.match(vm.calls[0].prompt, /Gate evidence \(current; proof of what ran\): .*batch-2\.json/);
  assert.match(vm.calls[0].prompt, /Stale or invalid evidence \(NOT proof.*batch-1\.json \(stale\)/);
});

test("E110 111 F3 the gsd-execute kit block says a later phase stales evidence and names the refresh verb", () => {
  const text = fs.readFileSync(path.join(SHIP_DIR, ".claude/skills/gsd-execute/SKILL.md"), "utf8");
  const kit = text.slice(text.indexOf("PASEO-HARNESS-KIT START"), text.indexOf("PASEO-HARNESS-KIT END"));
  assert.match(kit, /Starting the next phase before this phase's gsd-verify passes makes the phase's gate evidence stale/);
  assert.match(kit, /ph gsd evidence refresh <N>/);
  const verify = fs.readFileSync(path.join(SHIP_DIR, ".claude/skills/gsd-verify/SKILL.md"), "utf8");
  assert.match(verify, /every evidence file is stale/);
  assert.match(verify, /ph gsd evidence refresh <N>/);
  assert.match(verify, /kit feedback 97/);
});
