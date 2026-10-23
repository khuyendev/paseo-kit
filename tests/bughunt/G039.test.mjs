// Bug-hunt fix G039 (kit-feedback 17): plan review converges on high issues only, carries the medium and low notes of the
// converged cycle into the execute brief, and sizes its cycles by the issue trend.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "../gsd-flows/world.mjs";

const PLAN = `${PD}/01-01-PLAN.md`;
const NOTES = `${PD}/plan-review-notes.json`;
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const highs = (n) => Array.from({ length: n }, (_, i) => ({ severity: "high", description: `gap ${n}-${i}` }));
const labels = (r) => r.calls.map((c) => c.opts.label);

// Cycle n's finder reports cycles[n] (none past the end); each editor run moves to the next cycle.
async function review(cycles, { files = {} } = {}) {
  const w = makeWorld({ files: { [PLAN]: planText("01-01"), ...files } });
  let cycle = 0;
  const r = await runScript("gsd-plan-review", {
    root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01"] },
    agent: (p, o) => {
      if (o.label.startsWith("find-")) return { issues: cycles[cycle] ?? [] };
      if (o.label.startsWith("verify-")) return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
      if (o.label.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: true })) };
      if (o.label.startsWith("editor-")) { cycle++; w.handoff = { planRevision: `rev${cycle}`, waves: [{ wave: 1 }] }; w.write(PLAN, planText("01-01")); return { marker: "REVISION COMPLETE" }; }
      return null;
    },
  });
  return { w, r };
}

test("G039 a low actionable nit alone converges in one cycle, without an editor run, and is carried", async () => {
  const { w, r } = await review([[{ severity: "low", actionable: true, description: "empty string vs null edge case" }]]);
  assert.deepEqual([r.result.status, r.result.cycles], ["converged", 1]);
  assert.equal(labels(r).some((l) => l.startsWith("editor-")), false);
  assert.deepEqual(JSON.parse(w.read(NOTES)).map((x) => [x.severity, x.description]), [["low", "empty string vs null edge case"]]);
});

test("G039 the editor gets only the high issues; the medium issue left at convergence is carried", async () => {
  const { w, r } = await review([
    [{ severity: "high", description: "missing symbol" }, { severity: "medium", description: "wording of the goal" }],
    [{ severity: "medium", description: "wording of the goal" }],
  ]);
  assert.deepEqual([r.result.status, r.result.cycles], ["converged", 2]);
  const editor = r.calls.find((c) => c.opts.label === "editor-1").prompt;
  assert.match(editor, /missing symbol/);
  assert.doesNotMatch(editor, /wording of the goal/);
  assert.deepEqual(JSON.parse(w.read(NOTES)).map((x) => x.description), ["wording of the goal"]);
});

test("G039 the cycle count follows the trend: a count that keeps falling is not cut off at three cycles", async () => {
  const { r } = await review([highs(4), highs(3), highs(2), highs(1), []]);
  assert.deepEqual([r.result.status, r.result.cycles], ["converged", 5]);
  assert.equal(labels(r).filter((l) => l.startsWith("editor-")).length, 4);
});

test("G039 a plan review that does not converge drops the notes of an earlier converged review", async () => {
  const { w, r } = await review([highs(1), highs(1)], { files: { [NOTES]: JSON.stringify([{ plan: "01-01", severity: "low", description: "stale" }]) } });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(w.read(NOTES), "");
});

test("G039 execute hands each plan its carried plan-review notes", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]] });
  w.write(NOTES, JSON.stringify([{ plan: "01-01", severity: "medium", description: "wording of the goal" }]));
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "executed");
  assert.match(r.calls.find((c) => c.opts.label === "exec-01-01").prompt, /Plan-review notes for this plan .*wording of the goal/);
  assert.doesNotMatch(r.calls.find((c) => c.opts.label === "exec-01-02").prompt, /wording of the goal/);
});
