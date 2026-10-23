// THIN.md item 5 (TE, kit feedback 87): the thinned gsd-execute.js made the same agent calls (prompt and options digests), logs
// and results as 04e008f in all 826 fake-host runs of the parity check (kit-bughunt/thin/scratch/TE). The only difference: the
// verbs it now calls add steps between concurrent work, so in 13 runs the steps of two plans that run at once interleave in
// another order. Interleaving across plans was never fixed (agents finish in any order); what is fixed is each plan's own
// order, which this test pins for a wave of two parallel executors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

test("TE each plan of a parallel wave keeps its own step order: dispatched, executed, committed, tracked; one commit for the wave", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { parallelization: { enabled: true, max_concurrent: 2 } } } });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  const stages = {};
  for (const s of r.shells.filter((x) => x.argv[2] === "state-plan")) {
    const input = JSON.parse(s.input);
    (stages[input.plan] ??= []).push(input.stage);
  }
  for (const id of ["01-01", "01-02"]) assert.deepEqual(stages[id], ["dispatched", "executed", "committed", "tracked"], id);
  assert.deepEqual(r.result.waves.map((x) => x.plans), [["01-01", "01-02"]]);
  // The executors' prompts are rendered from the kit template, one render per plan before its executor starts.
  const renders = r.shells.filter((x) => x.argv[2] === "prompt" && x.argv[3] === "executor").map((x) => JSON.parse(x.input).digest);
  assert.deepEqual(renders.sort(), ["Input digest (plan:01-01): h-01-01", "Input digest (plan:01-02): h-01-02"]);
  for (const c of r.calls.filter((x) => /^exec-/.test(x.opts.label))) assert.match(c.prompt, /^<kit_executor_runtime>\nPlan: /);
});
