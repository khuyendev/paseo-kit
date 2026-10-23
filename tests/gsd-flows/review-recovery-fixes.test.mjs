import assert from "node:assert/strict";
import test from "node:test";
import { gate, evidenceCheck } from "../../ship/.agents/workflows/lib/flow-gate.mjs";
import { lock, unlock } from "../../ship/.agents/workflows/lib/flow-files.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { makeWorld, PHASE_DIR as PD } from "./world.mjs";
import { makeExecWorld, executor, task } from "./exec-world.mjs";
import { runScript, NULL } from "./host.mjs";
const green = [process.execPath, "-e", "process.exit(0)"];
const commands = { build: green, test: green, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };

test("GSDF-44 configuration changes invalidate evidence through the shared loader", async () => {
  const p = makeTempProject({ overlay: { adapter: { commands } } });
  const g = await gate(p.root, PD, { waveId: "w1", plans: [] });
  assert.equal((await evidenceCheck(p.root, g.evidence)).status, "current");
  p.writeJson(".agents/harness.config.json", { adapter: { commands: { ...commands, build_timeout_s: 45 } } });
  const stale = await evidenceCheck(p.root, g.evidence);
  assert.equal(stale.status, "stale");
  assert.match(stale.reason, /configuration/);
});

test("GSDF-41 CR-GSF-03 batch worktrees receive accepted dependency output before wave two dispatch", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]], meta: { "01-02": { depends: ["01-01"] } }, overlay: { gsd: { isolation: "worktree", execution_mode: "batch" } } });
  let sawDependency = false;
  const normal = executor(w);
  const r = await runScript("gsd-execute", { root: w.root, gsd: w.gsd, args: { phaseDir: PD }, agent: async (...a) => {
    if (a[1].label === "exec-01-02") {
      const wt = a[3].find((c) => c.n === a[2]).worktree;
      assert.equal(w.read(`${wt}/src/01-01/impl.js`), w.read("src/01-01/impl.js"));
      sawDependency = true;
    }
    return normal(...a);
  } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(sawDependency, true);
  assert.ok(JSON.parse(w.read(`${PD}/transfers/01-02.json`)).files.every((f) => !f.path.includes("01-01")));
});

test("GSDF-64 CR-GSF-18 debug excludes execution and quick writers (planning holds only its phase lease: F02)", async () => {
  for (const [name, args] of [["gsd-execute", { phaseDir: PD }], ["gsd-quick", { description: "fix a" }]]) {
    const w = makeWorld({ files: { ".planning/ROADMAP.md": "# R\n" } });
    const held = lock(w.root, "debug", "wf_debug", process.pid);
    try {
      const r = await runScript(name, { root: w.root, gsd: w.gsd, args, runId: "wf_other" });
      assert.equal(r.result.status, "refused");
      assert.equal(r.calls.length, 0);
      assert.match(r.result.reason, /wf_debug/);
    } finally { unlock(w.root, "debug", held.token); }
  }
});

for (const outcome of ["quota", "partial"]) test(`GSDF-52 CR-GSF-16 ${outcome} fix preserves pending requests; a partial fix is decided on the rerun gate`, async () => {
  const w = makeExecWorld({ overlay: { adapter: { commands: { ...commands, test: [process.execPath, "-e", "console.log('error src/01-02/impl.js');process.exit(1)"] } } } });
  const normal = executor(w);
  const responder = executor(w, {
    "exec-01-01": async (...a) => ({ ...await normal(...a), requests: [{ path: "src/01-02/impl.js", change: "handle empty input", reason: "dependency" }] }),
    "fix-01-02": () => outcome === "quota" ? NULL("quota exhausted") : { taskResults: [{ task: "1", status: "partial", evidence: "owner decision" }] },
  });
  const r = await runScript("gsd-execute", { root: w.root, gsd: w.gsd, args: { phaseDir: PD }, agent: responder });
  assert.notEqual(r.result.status, "executed");
  assert.equal(JSON.parse(w.read(`${PD}/execute-progress.json`)).requests["01-02"].length, 1);
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("fix-01-02")).length, 1);
  // kit-feedback 51: a partial fix is an owner decision only after the transfers and the rerun; a quota stops before them.
  assert.equal(r.result.events.filter((e) => e.startsWith("gate ")).length, outcome === "quota" ? 1 : 2);
});
