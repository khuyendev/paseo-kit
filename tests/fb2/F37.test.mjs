// F37 (kit-feedback 37): a tracer plan may carry its own file line above the checker's Files/plan lines, and a
// REVISION_CONFLICT on one plan lets the phase-level issues get their revision before the loop stops.
import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { makeTempProject } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w, { rows: [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 1 }], overrides }) });

test("F37 tracer_extra_files is an optional gsd key: 0 by default, a non-negative integer otherwise", () => {
  assert.equal(loadConfig(makeTempProject({ git: false, overlay: {} }).root).gsd.tracer_extra_files, 0);
  assert.equal(loadConfig(makeTempProject({ git: false, overlay: { gsd: { tracer_extra_files: 10 } } }).root).gsd.tracer_extra_files, 10);
  assert.throws(() => loadConfig(makeTempProject({ git: false, overlay: { gsd: { tracer_extra_files: -1 } } }).root), /gsd\.tracer_extra_files/);
});

test("F37 the checker run context gives a tracer plan its own file line when tracer_extra_files is set", async () => {
  const w = makeWorld({ overlay: { gsd: { tracer_extra_files: 10 } } });
  w.probes.owns = { problems: [], files_per_plan: { warning: 10, blocker: 15 } };
  const r = await plan(w);
  const checker = r.calls.find((c) => c.opts.label === "checker-1");
  assert.ok(checker, "checker-1 ran");
  assert.match(checker.prompt, /Files per plan: warning at 10\+, blocker at 15\+/);
  assert.match(checker.prompt, /Tracer files per plan \(a plan with a type="tracer" task\): warning at 20\+, blocker at 25\+\./);
});

test("F37 without tracer_extra_files the checker run context has no tracer line", async () => {
  const w = makeWorld();
  w.probes.owns = { problems: [], files_per_plan: { warning: 10, blocker: 15 } };
  const r = await plan(w);
  const checker = r.calls.find((c) => c.opts.label === "checker-1");
  assert.ok(checker, "checker-1 ran");
  assert.doesNotMatch(checker.prompt, /Tracer files per plan/);
});

test("F37 a REVISION_CONFLICT on one plan still runs the phase-level revision before the loop stops", async () => {
  const w = makeWorld();
  let checks = 0;
  const overrides = {
    "checker-": () => (checks++ === 0 ? { issues: [
      { plan: "01-01", severity: "blocker", required_property: "p", description: "x" },
      { plan: null, severity: "blocker", required_property: "q", description: "phase-gap-37" },
    ] } : { issues: [] }),
    "revise-01-01": () => ({ marker: "REVISION_CONFLICT", conflict: { issue: "x", decision: "D-01" } }),
  };
  const r = await plan(w, overrides);
  assert.deepEqual([r.result.status, r.result.marker], ["needs-owner", "REVISION_CONFLICT"]);
  const phaseRevision = r.calls.find((c) => c.opts.label === "revise-phase-1");
  assert.ok(phaseRevision, "revise-phase-1 ran before the stop");
  assert.match(phaseRevision.prompt, /phase-gap-37/);
  assert.equal(checks, 1, "the loop stopped without a second checker pass");
});
