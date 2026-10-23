// Kit feedback #97 (V4): a task with several verify commands. Each command is its own gate step (the first keeps the old
// name), so the phase evidence stays current through gate -> evidence-check -> gsd-verify; a command changed after the
// gate makes only its obligation stale (evidence `partial`), and evidence written before the fix (every command of the
// task under one name) is matched by its command.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { obligationStepNames, requiredSteps } from "../../ship/.agents/harness/adapter/evidence.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;
const REPORT = `${PHASE_DIR}/01-VERIFICATION.md`;
const HANDOFF = `${PHASE_DIR}/handoff/w1.args.json`;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const cmd = (n) => ({ task: "2", kind: "cmd", command: `cmd: "${NODE}" -e "process.exit(0)" ${n}` });
const THREE = [cmd("one"), cmd("two"), cmd("three")];

// One plan whose task 2 declares three verify commands, executed through the real gate.
async function executed() {
  const w = makeExecWorld({ waves: [[task("01-01", { verify: THREE })]] });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.result.evidence.length, 1, JSON.stringify(r.result.evidence));
  return { w, evidence: r.result.evidence[0] };
}

// The planned obligations as gsd-verify reads them from the handoff files.
const planned = (w) => JSON.parse(w.read(HANDOFF)).tasks.map((t) => ({ id: t.plan, owns: t.owns, verify: t.verify ?? [], waveId: "w1", batch: "batch" }));

function verify(w, evidence) {
  w.gsd.on("verification status", () => {
    const t = w.read(REPORT);
    if (!t) return { code: 66, json: { status: "missing" } };
    return { code: 0, json: { status: /^status: (.*)$/m.exec(t)[1], sha: `sha-${t.length}`, score: "1/1", gaps: [], human_verification: [] } };
  });
  w.gsd.on("verification fingerprint", (argv) => ({ covered_files: argv.slice(1), covered_digest: "kit:abc" }));
  w.gsd.on("phase complete", () => ({ completed: true, warnings: [] }));
  const agent = () => { w.write(REPORT, "---\nstatus: passed\n---\nreport\n"); return { status: "passed" }; };
  return runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, evidence: [evidence] }, agent });
}

test("V4 the n-th command of a task and kind gets its own step name; the first keeps the old name", async () => {
  assert.deepEqual(obligationStepNames("01-01", [...THREE, { task: "3", kind: "cmd" }, { task: "2", kind: "test" }]), ["01-01-2-cmd", "01-01-2-cmd-2", "01-01-2-cmd-3", "01-01-3-cmd", "01-01-2-test"]);
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const steps = await requiredSteps(loadConfig(w.root), { codeRoot: w.root, plans: [{ id: "01-01", verify: THREE }] });
  assert.deepEqual(steps.map((s) => s.name), ["build", "test", "01-01-2-cmd", "01-01-2-cmd-2", "01-01-2-cmd-3"]);
});

test("V4 a task with three verify commands: gate -> evidence-check current -> gsd-verify reads the evidence as proof", async () => {
  const { w, evidence } = await executed();
  const ev = JSON.parse(w.read(evidence));
  const obligations = ev.steps.filter((s) => s.kind === "cmd");
  assert.deepEqual(obligations.map((s) => s.name), ["01-01-2-cmd", "01-01-2-cmd-2", "01-01-2-cmd-3"]);
  assert.equal(new Set(obligations.map((s) => s.log)).size, 3, "each command keeps its own log");
  const c = await flow(w.root, ["evidence-check", evidence], { plans: planned(w) });
  assert.equal(c.json.status, "current", JSON.stringify(c.json));
  const v = await verify(w, evidence);
  assert.equal(v.result.status, "passed", JSON.stringify(v.result));
  assert.ok(v.calls[0].prompt.includes(`Gate evidence (current; proof of what ran): ${evidence}`), v.calls[0].prompt);
  assert.doesNotMatch(v.calls[0].prompt, /Stale or invalid evidence/);
});

test("V4 a command changed after the gate makes only its obligation stale: evidence partial, the verifier told which", async () => {
  const { w, evidence } = await executed();
  const h = JSON.parse(w.read(HANDOFF));
  h.tasks[0].verify[1] = cmd("two-changed");
  w.write(HANDOFF, JSON.stringify(h));
  const c = await flow(w.root, ["evidence-check", evidence], { plans: planned(w) });
  assert.equal(c.code, 1);
  assert.equal(c.json.status, "partial", JSON.stringify(c.json));
  assert.deepEqual(c.json.stale, ["01-01-2-cmd-2"]);
  assert.match(c.json.reason, /^01-01-2-cmd-2: command changed since the gate ran$/);
  const v = await verify(w, evidence);
  const prompt = v.calls[0].prompt;
  assert.ok(prompt.includes(`Partly current evidence (proof of what ran, except the named obligations`), prompt);
  assert.ok(prompt.includes(`${evidence} (stale: 01-01-2-cmd-2)`), prompt);
  assert.doesNotMatch(prompt, /Stale or invalid evidence/);
  assert.ok(prompt.includes("Gate evidence (current; proof of what ran): none"), prompt);
});

test("V4 evidence written before the fix (three steps of one name) is matched by command and stays current", async () => {
  const { w, evidence } = await executed();
  const ev = JSON.parse(w.read(evidence));
  w.write(evidence, JSON.stringify({ ...ev, steps: ev.steps.map((s) => (s.kind === "cmd" ? { ...s, name: "01-01-2-cmd" } : s)) }));
  const c = await flow(w.root, ["evidence-check", evidence], { plans: planned(w) });
  assert.equal(c.json.status, "current", JSON.stringify(c.json));
  // A command that none of the legacy steps ran is stale, not a missing step.
  const h = JSON.parse(w.read(HANDOFF));
  h.tasks[0].verify[2] = cmd("three-changed");
  w.write(HANDOFF, JSON.stringify(h));
  const p = await flow(w.root, ["evidence-check", evidence], { plans: planned(w) });
  assert.deepEqual([p.json.status, p.json.stale], ["partial", ["01-01-2-cmd-3"]]);
});

test("V4 a failed step still makes the evidence failed, and a changed command is listed with it", async () => {
  const { w, evidence } = await executed();
  const ev = JSON.parse(w.read(evidence));
  w.write(evidence, JSON.stringify({ ...ev, steps: ev.steps.map((s) => (s.name === "01-01-2-cmd-3" ? { ...s, outcome: "failed", exitCode: 1 } : s)) }));
  const h = JSON.parse(w.read(HANDOFF));
  h.tasks[0].verify[0] = cmd("one-changed");
  w.write(HANDOFF, JSON.stringify(h));
  const c = await flow(w.root, ["evidence-check", evidence], { plans: planned(w) });
  assert.equal(c.json.status, "failed", JSON.stringify(c.json));
  assert.deepEqual(c.json.stale, ["01-01-2-cmd"]);
  assert.match(c.json.reason, /01-01-2-cmd-3: failed; 01-01-2-cmd: command changed since the gate ran/);
});
