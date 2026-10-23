// Plan-structure warnings of a passing plan reach the checker, the plan-review gate and the workflow result (G019).
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, planText, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const planFile = (id) => `${PHASE_DIR}/${id}-PLAN.md`;
const warning = (id) => `plan-structure (${id}): Task 1 (t): missing <done>`;
const withDone = (id) => planText(id).replace("<name>t</name>", "<name>t</name><done>d</done>");

// The real verb prints the warnings of a passing plan too (plan-checks.mjs:44-47); the fake reports a missing <done>.
function structureWarnings(w) {
  const base = w.gsd.handlers["verify plan-structure"];
  w.gsd.on("verify plan-structure", (argv, input, full) => {
    const r = base(argv, input, full);
    return { code: r.code, json: { ...r.json, warnings: w.read(argv[0]).includes("<done>") ? [] : ["Task 1 (t): missing <done>"] } };
  });
  return w;
}

test("G019 a passing plan's plan-structure warnings reach the checker prompt and the result", async () => {
  const r = await plan(structureWarnings(makeWorld()));
  assert.equal(r.result.status, "planned");
  assert.ok(r.result.warnings.includes(warning("01-01")), JSON.stringify(r.result.warnings));
  assert.ok(r.result.warnings.includes(warning("01-02")), JSON.stringify(r.result.warnings));
  const checker = r.calls.find((c) => c.opts.label === "checker-1");
  assert.ok(checker.prompt.includes(`- ${warning("01-01")}`), checker.prompt);
});

test("G019 a plan the structure fixer repairs keeps no warning from its failed check", async () => {
  const w = structureWarnings(makeWorld());
  w.structureErrors = { [planFile("01-01")]: [["Task 1 (t): missing <action>"]] };
  const r = await plan(w, {}, { "fix-01-01": () => { w.write(planFile("01-01"), withDone("01-01")); return { marker: "## REVISION COMPLETE" }; } });
  assert.equal(r.result.status, "planned");
  assert.equal(r.result.warnings.some((x) => x.startsWith("plan-structure (01-01)")), false, JSON.stringify(r.result.warnings));
  assert.ok(r.result.warnings.includes(warning("01-02")));
});

test("G019 the handoff verb's warnings reach the result", async () => {
  const w = makeWorld();
  w.handoff = { planRevision: "rev1", waves: [{ wave: 1 }], sharedChanges: [], warnings: ["01-02: wave 2 with empty depends_on"] };
  const r = await plan(w);
  assert.equal(r.result.status, "planned");
  assert.ok(r.result.warnings.includes("handoff: 01-02: wave 2 with empty depends_on"), JSON.stringify(r.result.warnings));
});

test("G019 the plan-review gate replaces the warnings of the plans it checked and carries the rest", async () => {
  const w = structureWarnings(makeWorld());
  let cycle = 0;
  const r = await plan(w, { planReview: true }, {
    "find-": () => ({ issues: cycle === 0 ? [{ severity: "high", actionable: true, description: "cites a missing symbol" }] : [] }),
    "verify-": (p) => ({ verdicts: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], valid: true })) }),
    "judge-": (p) => ({ decisions: [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => ({ id: m[1], keep: true })) }),
    "editor-": () => { cycle++; w.write(planFile("01-01"), withDone("01-01")); return { marker: "REVISION COMPLETE" }; },
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal(r.result.warnings.some((x) => x.startsWith("plan-structure (01-01)")), false, JSON.stringify(r.result.warnings));
  assert.equal(r.result.warnings.filter((x) => x === warning("01-02")).length, 1, JSON.stringify(r.result.warnings));
});
