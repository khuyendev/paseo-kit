// G005: the Files/plan lines of the checker scale with plans_per_phase, so a large phase can satisfy both the plan cap
// and the file-count line (feedback 20: 12 plans of ~200 files, scope_sanity blocker on every run).
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

// `count` plans of wave 1, each owning its own directory and listing `files` files.
function phaseFiles(count, files) {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const id = String(i + 1).padStart(2, "0");
    const list = Array.from({ length: files }, (_, f) => `src/p${id}/f${f}.js`).join(", ");
    return [`${P1}/01-${id}-PLAN.md`, plan({ id, files: `[${list}]`, owns: `["Path:src/p${id}/"]` })];
  }));
}

test("G005 check owns: the Files/plan lines stay at 10 and 15 for a small phase and rise to fit a large one", async () => {
  const small = await gsd(project({ files: phaseFiles(12, 3) }), ["check", "owns", "1"]);
  assert.equal(small.code, 0);
  assert.deepEqual(small.json.files_per_plan, { warning: 10, blocker: 15 });
  // 12 plans x 17 files = 204 files: every plan under the blocker (18) fits the cap, so the phase is satisfiable.
  const large = await gsd(project({ files: phaseFiles(12, 17) }), ["check", "owns", "1"]);
  assert.equal(large.code, 0, JSON.stringify(large.json.problems));
  assert.deepEqual(large.json.files_per_plan, { warning: 18, blocker: 18 });
});

test("G005 checker prompt: the run context carries the Files/plan lines of the phase", async () => {
  const w = makeWorld();
  w.probes.owns = { problems: [], files_per_plan: { warning: 18, blocker: 18 } };
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w, { overrides: {} }) });
  const checker = r.calls.find((c) => c.opts.label === "checker-1");
  assert.ok(checker, "checker-1 ran");
  assert.match(checker.prompt, /Files per plan: warning at 18\+, blocker at 18\+/);
});
