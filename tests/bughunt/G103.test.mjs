// G103: gsd-quick repairs a plan-structure error in place once, in the planner's session, as gsd-plan does (GSDF-25).
import assert from "node:assert/strict";
import test from "node:test";
import { quickVerification } from "../../ship/.agents/workflows/lib/flow-project.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, planText } from "../gsd-flows/world.mjs";

const DIR = ".planning/quick/260101-abc-fix";
const PLAN = `${DIR}/260101-abc-PLAN.md`;
const SUMMARY = `${DIR}/260101-abc-SUMMARY.md`;
const VERIFY = `${DIR}/260101-abc-VERIFICATION.md`;
const ERR = "Task 1 (t): missing <action>";

// The planner writes the plan; a fixer turn rewrites it clean when `fixClean`; the checker reports one blocker
// on its first pass only; the executor writes the SUMMARY; the verifier writes a passed report.
function agentFor(w, { fixClean = true } = {}) {
  return (p, o) => {
    const plan = /Write ONE plan (\S+)/.exec(p)?.[1];
    if (plan) { w.write(plan, planText("q")); return { marker: "PLANNING COMPLETE" }; }
    if (o.label.startsWith("quick-fix-")) { if (fixClean) w.write(PLAN, planText("q")); return { marker: "REVISION COMPLETE" }; }
    if (o.label === "quick-check-1") return { issues: [{ severity: "blocker", description: "x" }] };
    if (o.label.startsWith("quick-check")) return { issues: [] };
    if (o.label.startsWith("quick-revise")) { w.write(PLAN, planText("q")); return { marker: "REVISION COMPLETE" }; }
    if (o.label === "quick-exec") { w.write(SUMMARY, "done\n"); return { taskResults: [{ task: "1", status: "implemented" }] }; }
    if (o.label === "quick-verify") {
      const fp = quickVerification(w.root, DIR, "fingerprint");
      w.write(VERIFY, `---\nstatus: passed\ncovered_files: ${JSON.stringify(fp.covered_files)}\ncovered_digest: ${fp.covered_digest}\ngaps: []\nhuman_verification: []\n---\nreport\n`);
      return { status: "passed" };
    }
    return null;
  };
}
const quickWorld = (structureErrors) => {
  const w = makeWorld({ files: { ".planning/ROADMAP.md": "# R\n" } });
  w.structureErrors = { [PLAN]: structureErrors };
  return w;
};
const run = (w, agent, args = {}) => runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix a | b", dir: DIR, ...args }, agent });

test("G103 non-full: one structure error is repaired by one fixer turn in the planner session, then the task is done", async () => {
  const w = quickWorld([[ERR], []]);
  const r = await run(w, agentFor(w));
  assert.equal(r.result.status, "done");
  assert.deepEqual(r.calls.map((c) => c.opts.label), ["quick-plan", "quick-fix-plan", "quick-exec"]);
  const fix = r.calls.find((c) => c.opts.label === "quick-fix-plan");
  assert.ok(fix.prompt.includes(`Fix ${PLAN} in place`));
  assert.ok(fix.prompt.includes(`- ${ERR}`));
  assert.equal(fix.opts.session, "planner:quick");
  assert.equal(fix.opts.agentType, "gsd-planner");
});

test("G103 non-full: a structure error the fixer cannot clear fails after exactly one fixer turn", async () => {
  const w = quickWorld([[ERR], [ERR]]);
  const r = await run(w, agentFor(w, { fixClean: false }));
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /still invalid/);
  assert.deepEqual(r.calls.map((c) => c.opts.label), ["quick-plan", "quick-fix-plan"]);
  assert.equal(r.calls.filter((c) => c.prompt.includes(`- ${ERR}`)).length, 1);
});

test("G103 full: a structure error after a checker revision is repaired and the checker runs again", async () => {
  const w = quickWorld([[], [ERR], []]);
  const r = await run(w, agentFor(w), { full: true });
  assert.equal(r.result.status, "done");
  assert.deepEqual(r.calls.map((c) => c.opts.label), ["quick-research", "quick-plan", "quick-check-1", "quick-revise-1", "quick-fix-1", "quick-check-2", "quick-exec", "quick-verify"]);
  assert.equal(r.calls.find((c) => c.opts.label === "quick-fix-1").opts.session, "planner:quick");
});

test("G103 full: a revision that stays structurally invalid after the one fixer turn fails with exactly one fixer prompt", async () => {
  const w = quickWorld([[], [ERR], [ERR]]);
  const r = await run(w, agentFor(w, { fixClean: false }), { full: true });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /still invalid/);
  assert.deepEqual(r.calls.map((c) => c.opts.label), ["quick-research", "quick-plan", "quick-check-1", "quick-revise-1", "quick-fix-1"]);
});
