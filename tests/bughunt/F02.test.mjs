// F02 (kit-feedback 2, owner-approved): gsd-plan holds only its phase's lease, so planning phase N+1 can run while phase N
// executes. Execute holds the phase lease and the code-root writer lease for its run; another plan of the same phase, a
// second execute, and a debug or quick run exclude it. The short writer steps (ph gsd commit) wait on the git writer lock.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { lock, lockCheck, unlock } from "../../ship/.agents/workflows/lib/flow-files.mjs";
import { FakeGsd, NULL, runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld } from "../gsd-flows/exec-world.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";
import { project } from "../gsd-core/fixture.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { testEnv } from "../helpers/env.mjs";

const PH = path.join(SHIP_DIR, ".agents", "harness", "ph.mjs");
const NEXT = ".planning/phases/02-next";
const plan = (w, runId) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR }, runId, agent: plannerResponder(w) });
const execute = (w, runId) => runScript("gsd-execute", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR }, runId, agent: executor(w) });
const quickWorld = () => makeWorld({ files: { ".planning/ROADMAP.md": "# R\n" } });
const quickAgent = (w) => (p, o) => {
  const planFile = /Write ONE plan (\S+)/.exec(p)?.[1];
  if (planFile) { w.write(planFile,"---\nphase: quick\n---\n<tasks><task><name>t</name><automated>cmd: node -v</automated></task></tasks>\n"); return { marker: "PLANNING COMPLETE" }; }
  if (o.label === "quick-exec") { w.write(/SUMMARY to exactly: (\S+)/.exec(p)[1], "done\n"); return { taskResults: [{ task: "1", status: "implemented" }] }; }
  return null;
};

// Plan of phase 2 with its own fake ph gsd: only what the run reads before its first agent call is faked.
function planPhaseTwo(w, runId) {
  w.write(`${NEXT}/02-CONTEXT.md`, "<decisions>\n- **D-01:** later\n</decisions>\n");
  const gsdTwo = new FakeGsd({
    "find-phase": () => ({ found: true, status: "NOT_STARTED", directory: NEXT }),
    "research status": () => ({ code: 0, json: { status: "complete" } }),
  });
  return runScript("gsd-plan", { root: w.root, gsd: gsdTwo, args: { phaseDir: NEXT }, runId, agent: (p, o) => (o.label === "outline" ? NULL("stop after the first outline call") : null) });
}

test("F02 gsd-plan of a phase is not refused by a debug run holding the code root, and releases its phase lease", async () => {
  const w = makeWorld();
  const held = lock(w.root, "debug", "wf_debug_A", process.pid, "gsd-debug");
  try {
    const r = await plan(w, "wf_plan_B");
    assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  } finally { unlock(w.root, "debug", held.token); }
  assert.equal(lockCheck(w.root, "phase-01").held, false);
});

test("F02 planning phase 2 runs while execute of phase 1 holds its phase lease and the code-root lease", async () => {
  const w = makeExecWorld();
  const exec = executor(w);
  const during = [];
  let planned = null;
  const r = await runScript("gsd-execute", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR }, runId: "wf_exec_A", agent: async (p, o, n, calls) => {
    if (o.label === "exec-01-01") {
      during.push([lockCheck(w.root, "phase-01").holderKind, lockCheck(w.root, "debug").holderKind]);
      planned = await planPhaseTwo(w, "wf_plan_B");
    }
    return exec(p, o, n, calls);
  } });
  assert.deepEqual(during, [["gsd-execute", "gsd-execute"]]);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.notEqual(planned.result.status, "refused", JSON.stringify(planned.result));
  assert.ok(planned.calls.some((c) => c.opts.label === "outline"), "the plan of phase 2 reached its planner while execute ran");
  assert.deepEqual(["phase-01", "debug", "phase-02"].map((n) => lockCheck(w.root, n).held), [false, false, false]);
});

test("F02 a second plan of a phase is refused while the first holds the phase lease, and the refusal names its holder", async () => {
  const w = makeWorld();
  const held = lock(w.root, "phase-01", "wf_plan_A", process.pid, "gsd-plan");
  try {
    const r = await plan(w, "wf_plan_B");
    assert.deepEqual([r.result.status, r.calls.length], ["refused", 0]);
    assert.equal(r.result.reason, "a gsd-plan run holds phase 01 (wf_plan_A); plan after it ends");
  } finally { unlock(w.root, "phase-01", held.token); }
});

test("F02 a plan of a phase is refused while execute of that phase holds the phase lease, and the refusal names the execute run", async () => {
  const w = makeWorld();
  const held = lock(w.root, "phase-01", "wf_exec_A", process.pid, "gsd-execute");
  try {
    const r = await plan(w, "wf_plan_B");
    assert.deepEqual([r.result.status, r.calls.length], ["refused", 0]);
    assert.equal(r.result.reason, "a gsd-execute run holds phase 01 (wf_exec_A); plan after it ends");
  } finally { unlock(w.root, "phase-01", held.token); }
});

test("F02 an execute of a phase is refused while a plan of that phase holds the phase lease, and takes no code-root lease", async () => {
  const w = makeExecWorld();
  const held = lock(w.root, "phase-01", "wf_plan_A", process.pid, "gsd-plan");
  try {
    const r = await execute(w, "wf_exec_B");
    assert.deepEqual([r.result.status, r.calls.length], ["refused", 0]);
    assert.equal(r.result.reason, "a gsd-plan run holds phase 01 (wf_plan_A); execute starts after it ends");
    assert.equal(lockCheck(w.root, "debug").held, false);
  } finally { unlock(w.root, "phase-01", held.token); }
});

test("F02 an execute is refused while a debug run holds the code root, before any agent, and releases the phase lease it took", async () => {
  const w = makeExecWorld();
  const held = lock(w.root, "debug", "wf_debug_A", process.pid, "gsd-debug");
  try {
    const r = await execute(w, "wf_exec_B");
    assert.deepEqual([r.result.status, r.calls.length], ["refused", 0]);
    assert.equal(r.result.reason, "a gsd-debug run holds this code root (wf_debug_A); execute starts after it ends");
    assert.equal(lockCheck(w.root, "phase-01").held, false);
  } finally { unlock(w.root, "debug", held.token); }
});

test("F02 a quick run and a debug run are refused while execute holds the code root; a quick run proceeds beside a plan's phase lease", async () => {
  const w = quickWorld();
  const held = lock(w.root, "debug", "wf_exec_A", process.pid, "gsd-execute");
  try {
    const quick = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix a" }, runId: "wf_quick_B", agent: quickAgent(w) });
    assert.deepEqual([quick.result.status, quick.calls.length], ["refused", 0]);
    assert.equal(quick.result.reason, "a gsd-execute run holds this code root (wf_exec_A); quick after it ends");
    const debug = await runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug: "fix-a" }, runId: "wf_debug_B", agent: () => NULL("no agent") });
    assert.deepEqual([debug.result.status, debug.calls.length], ["refused", 0]);
    assert.equal(debug.result.reason, "a gsd-execute run holds this code root (wf_exec_A); debug after it ends");
  } finally { unlock(w.root, "debug", held.token); }
  const phaseHeld = lock(w.root, "phase-01", "wf_plan_A", process.pid, "gsd-plan");
  try {
    const quick = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix b" }, runId: "wf_quick_C", agent: quickAgent(w) });
    assert.equal(quick.result.status, "done", JSON.stringify(quick.result));
  } finally { unlock(w.root, "phase-01", phaseHeld.token); }
});

// The git writer lock waits with a blocking pause, so the commit runs in its own process while the test releases the lock.
function phCommit(root, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PH, "gsd", ...args], { cwd: root, env: { ...testEnv(), PASEO_HARNESS_ROOT: root }, windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (code) => resolve({ code, json: JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "null") }));
  });
}

test("F02 ph gsd commit waits for the git writer lock another run holds, then commits", async () => {
  const p = project({ files: { "src/a.js": "1\n" } });
  const lockFile = p.path("_workspace/locks/git-writer.lock");
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, `${process.pid} held-by-test\n`);
  p.write("src/a.js", "2\n");
  const before = p.git("rev-parse", "HEAD");
  const pending = phCommit(p.root, ["commit", "feat(01-01): x", "--files", "src/a.js"]);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal(p.git("rev-parse", "HEAD"), before, "the commit did not land while the lock was held");
  fs.rmSync(lockFile);
  const r = await pending;
  assert.deepEqual([r.code, r.json?.committed], [0, true], JSON.stringify(r.json));
  assert.notEqual(p.git("rev-parse", "HEAD"), before);
  assert.equal(fs.existsSync(lockFile), false);
});
