// G031 (kit-feedback 18): a plan-review edit is recorded once its plan passes the structure check, so the next gsd-plan run keeps it.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, planText, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const review = (w, agent) => runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"] }, agent });
const ids = (p) => [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => m[1]);

test("G031 a plan-review edit is recorded, so the next gsd-plan run keeps the edited plan", async () => {
  const w = makeWorld();
  let edited = false;
  const first = await plan(w, { planReview: true }, {
    "find-01-01-": () => ({ issues: edited ? [] : [{ severity: "high", actionable: true, description: "cites a missing symbol" }] }),
    "find-": () => ({ issues: [] }),
    "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }),
    "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }),
    "editor-": () => {
      edited = true;
      w.write(`${PHASE_DIR}/01-01-PLAN.md`, `${planText("01-01")}\nreviewed\n`);
      return { marker: "REVISION COMPLETE" };
    },
  });
  assert.equal(first.result.status, "planned", JSON.stringify(first.result));
  assert.ok(w.events.includes("record plan:01-01"));

  const second = await plan(w);
  assert.equal(second.result.status, "planned", JSON.stringify(second.result));
  assert.deepEqual(second.calls.map((c) => c.opts.label).filter((l) => l.startsWith("plan-")), [], "the edited plan is kept, not planned again");
  assert.match(w.read(`${PHASE_DIR}/01-01-PLAN.md`), /reviewed/);
});

test("G031 a plan-review edit that fails plan-structure records nothing", async () => {
  const w = makeWorld({ files: { [`${PHASE_DIR}/01-01-PLAN.md`]: planText("01-01") } });
  w.structureErrors = { [`${PHASE_DIR}/01-01-PLAN.md`]: [["no <task>"]] };
  const r = await review(w, (p, o) => {
    if (o.label.startsWith("find-")) return { issues: [{ severity: "high", actionable: true, description: "x" }] };
    if (o.label.startsWith("verify-")) return { verdicts: ids(p).map((id) => ({ id, valid: true })) };
    if (o.label.startsWith("judge-")) return { decisions: ids(p).map((id) => ({ id, keep: true })) };
    if (o.label.startsWith("editor-")) return { marker: "REVISION COMPLETE" };
    return null;
  });
  assert.equal(r.result.status, "failed");
  assert.equal(w.events.some((e) => e.startsWith("record plan:")), false);
});
