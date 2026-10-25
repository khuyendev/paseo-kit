// Kit feedback #87 part B for planning (RE): a gsd-plan run stopped at each stage (outline, skeleton review, planners, checker, plan
// review, handoff) resumes from its journal (`ph workflow --resume`: same run id, finished calls replayed) to the result an unstopped
// run reaches, without paying again for the work it finished. plan-progress.json says it was a resumed instance of the run.
import assert from "node:assert/strict";
import test from "node:test";
import { dieOnce, journal, planRun } from "./RE-journal.mjs";
import { makeWorld, PHASE_DIR, planText, plannerResponder } from "../gsd-flows/world.mjs";

const planFile = (id) => `${PHASE_DIR}/${id}-PLAN.md`;
const ARGS = { planReview: true };
const json = (x) => JSON.parse(JSON.stringify(x ?? null));
const record = (w) => JSON.parse(w.read(`${PHASE_DIR}/plan-progress.json`));
const labels = (r) => r.calls.map((c) => c.label);
const paid = (r) => r.calls.filter((c) => !c.hit).map((c) => c.label);

// Two plans in two waves; the checker blocks 01-01 until its reviser adds a verify step, then confirms it resolved; plan review finds
// one high issue in 01-01 until its editor fixes it. `kill.agent` overrides labels (a dying call), `kill.editor` runs after the edit.
function responder(w, kill = {}) {
  return plannerResponder(w, {
    overrides: {
      ...(kill.agent ?? {}),
      "checker-": (p) => (w.read(planFile("01-01")).includes("revised")
        ? { issues: [], resolved: [...p.matchAll(/"id":"(open-\d+)"/g)].map((m) => ({ id: m[1], evidence: "verify step added" })) }
        : { issues: [{ plan: "01-01", dimension: "task_completeness", severity: "blocker", required_property: "verify", description: "no verify step" }] }),
      "revise-01-01": () => { w.write(planFile("01-01"), `${planText("01-01")}\n<!-- revised -->\n`); return { marker: "## REVISION COMPLETE" }; },
      "find-": (p, o) => (o.label.includes("01-01") && !w.read(planFile("01-01")).includes("reviewed") ? { issues: [{ severity: "high", actionable: true, description: "cites a missing symbol" }] } : { issues: [] }),
      "verify-": (p) => ({ verdicts: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], valid: true })) }),
      "judge-": (p) => ({ decisions: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], keep: true })) }),
      "editor-": () => { w.write(planFile("01-01"), `${w.read(planFile("01-01"))}\n<!-- reviewed -->\n`); kill.editor?.(); return { marker: "REVISION COMPLETE" }; },
    },
  });
}

// A ph gsd verb that dies the first time `when` holds.
function dieInVerb(w, key, when = () => true) {
  const die = dieOnce(key);
  const real = w.gsd.handlers[key];
  w.gsd.on(key, (a, input, argv) => {
    if (when(a)) die();
    return real(a, input, argv);
  });
}

// The unstopped run, the stopped one and its resume.
async function stopAndResume(arm) {
  const u = makeWorld();
  const ref = await planRun(u, journal(), responder(u), { args: ARGS });
  assert.equal(ref.result?.status, "planned", JSON.stringify(ref.result));
  const w = makeWorld();
  const kill = arm(w) ?? {};
  const j = journal();
  const first = await planRun(w, j, responder(w, kill), { args: ARGS });
  assert.ok(first.error, `the first run was stopped (${JSON.stringify(first.result ?? null).slice(0, 200)})`);
  assert.equal(record(w).open, true, "a stopped run leaves its instance open");
  const resumed = await planRun(w, j, responder(w), { args: ARGS, replay: true });
  assert.equal(resumed.result?.status, "planned", JSON.stringify(resumed.result));
  assert.deepEqual(json(resumed.result), json(ref.result), "the resumed run ends where the unstopped run ends");
  const rec = record(w);
  assert.deepEqual([rec.instance, rec.since, rec.open], [2, 1, false], "a resumed instance of the run, ended");
  assert.ok(resumed.logs.some((l) => l.startsWith("log resumed run (instance wf_20261020-120000_ab12#2)")), resumed.logs.join("\n"));
  return { w, ref, first, resumed };
}

test("RE resume outline: a run that died before the inputs of its new outline were recorded keeps that outline", async () => {
  const { resumed } = await stopAndResume((w) => dieInVerb(w, "revisions record", (a) => a[1] === "inputs"));
  assert.equal(labels(resumed).includes("outline"), false, "the outline writer is not paid again");
  assert.ok(resumed.logs.includes("log outline kept: this run wrote it for the same inputs before it stopped"));
});

test("RE resume skeleton review: the lanes that finished are replayed from the journal", async () => {
  const { resumed } = await stopAndResume((w) => dieInVerb(w, "write", (a) => a[1] === "OUTLINE-REVIEW"));
  assert.deepEqual(resumed.calls.filter((c) => c.label.startsWith("skeleton-")), [{ label: "skeleton-L1", hit: true }, { label: "skeleton-L2", hit: true }]);
  assert.equal(labels(resumed).includes("outline"), false);
});

test("RE resume planners: a plan of an earlier wave that was recorded is kept; only the stopped planner runs again", async () => {
  const { resumed } = await stopAndResume(() => ({ agent: { "plan-01-02": dieOnce("planner 01-02") } }));
  assert.deepEqual(labels(resumed).filter((l) => l.startsWith("plan-")), ["plan-01-02"]);
  assert.ok(resumed.logs.includes("log plan 01-01 kept: unchanged since recorded"));
});

test("RE resume checker: a revision that was recorded is not asked again; the checker judges the revised plans", async () => {
  const { resumed } = await stopAndResume(() => ({ agent: { "checker-2": dieOnce("checker-2") } }));
  assert.equal(labels(resumed).some((l) => l.startsWith("revise-") || l.startsWith("plan-")), false, labels(resumed).join(", "));
  assert.deepEqual(paid(resumed).filter((l) => l.startsWith("checker-")), ["checker-1"]);
});

test("RE resume plan review: a plan the editor changed before the run died is kept with the edit, not planned again", async () => {
  const { w, resumed } = await stopAndResume(() => ({ editor: dieOnce("plan-review editor") }));
  assert.equal(labels(resumed).some((l) => l.startsWith("plan-") || l.startsWith("revise-")), false, labels(resumed).join(", "));
  assert.match(w.read(planFile("01-01")), /reviewed/);
  assert.ok(resumed.logs.includes("log plan 01-01 kept: this run changed it after its record before it stopped; recorded again"), resumed.logs.join("\n"));
});

test("RE resume handoff: a run that died at the handoff hands off without planning or revising again", async () => {
  const { w, resumed } = await stopAndResume((x) => dieInVerb(x, "handoff"));
  assert.equal(labels(resumed).some((l) => /^(outline|skeleton-|plan-|revise-|editor-)/.test(l)), false, labels(resumed).join(", "));
  assert.ok(w.events.some((e) => e.startsWith("handoff")));
});

test("RE a run after a run that ended is a new run, even with the same run id: a plan edited by hand in between is planned again", async () => {
  const w = makeWorld();
  const j = journal();
  assert.equal((await planRun(w, j, responder(w), { args: ARGS })).result.status, "planned");
  w.write(planFile("01-02"), `${planText("01-02", { wave: 2, depends: ["01-01"] })}\n<!-- by hand -->\n`);
  const again = await planRun(w, journal(), responder(w), { args: ARGS });
  assert.ok(labels(again).includes("plan-01-02"), labels(again).join(", "));
  assert.equal(again.logs.some((l) => l.startsWith("log resumed run")), false);
  assert.deepEqual([record(w).instance, record(w).since], [2, 2]);
});
