// G004 (kit-feedback 13, 20): the plan checker loop and quick-plan check drive revision, the stall test and the cap from
// blockers only; warnings are carried into the run result and never sent back through paid revisions.
import assert from "node:assert/strict";
import test from "node:test";
import { quickVerification } from "../../ship/.agents/workflows/lib/flow-project.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder, planText } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const labels = (r, prefix) => r.calls.filter((c) => c.opts.label.startsWith(prefix)).map((c) => c.opts.label);
const blocker = (description, plan = "01-01") => ({ plan, severity: "blocker", description });
const warning = (description, plan = "01-01") => ({ plan, severity: "warning", description });
// Checker answers round by round; the last round repeats.
function checkerRounds(...rounds) {
  let n = 0;
  return { "checker-": () => ({ issues: rounds[Math.min(n++, rounds.length - 1)] }) };
}

test("G004 a warning-only checker pass plans with no revision and carries the warning into the result", async () => {
  const r = await plan(makeWorld(), {}, checkerRounds([warning("scope_sanity: 61 files")]));
  assert.equal(r.result.status, "planned");
  assert.deepEqual(labels(r, "checker-"), ["checker-1"]);
  assert.deepEqual(labels(r, "revise-"), []);
  assert.deepEqual(r.result.warnings.filter((x) => x.startsWith("checker")), ["checker (01-01): scope_sanity: 61 files"]);
});

test("G004 a revision carries blockers only; warnings never go back to the planner and do not stall the pass", async () => {
  let revised = null;
  // F44: a blocker leaves the count only when the checker lists it as resolved.
  const r = await plan(makeWorld(), {}, {
    "checker-1": () => ({ issues: [blocker("owns gap"), warning("soft one"), warning("soft two"), warning("soft three"), warning("soft four")] }),
    "checker-2": () => ({ issues: [warning("soft one"), warning("soft two"), warning("soft three"), warning("soft four")], resolved: [{ id: "open-1", evidence: "owns fixed" }] }),
    "revise-01-01": (p) => { revised = p; return { marker: "## REVISION COMPLETE" }; },
  });
  assert.equal(r.result.status, "planned");
  assert.deepEqual(labels(r, "checker-"), ["checker-1", "checker-2"]);
  assert.match(revised, /owns gap/);
  assert.doesNotMatch(revised, /soft one/);
  assert.ok(r.result.warnings.includes("checker (01-01): soft four"));
});

test("G004 the stall test compares blockers only: warnings that grow do not stop a phase whose blockers fall", async () => {
  // F44: "second" is confirmed resolved in round 2; "first" is repeated there and confirmed in round 3.
  const r = await plan(makeWorld(), {}, {
    "checker-1": () => ({ issues: [blocker("first"), blocker("second")] }),
    "checker-2": () => ({ issues: [blocker("first"), warning("w1"), warning("w2"), warning("w3")], resolved: [{ id: "open-2", evidence: "second fixed" }] }),
    "checker-3": () => ({ issues: [warning("w1"), warning("w2"), warning("w3")], resolved: [{ id: "open-1", evidence: "first fixed" }] }),
  });
  assert.equal(r.result.status, "planned");
  assert.deepEqual(labels(r, "checker-"), ["checker-1", "checker-2", "checker-3"]);
  assert.equal(labels(r, "revise-01-01").length, 2);
});

test("G004 a probe warning that could not look does not stop the phase", async () => {
  const w = makeWorld();
  w.probes.owns = { code: 69, json: { status: "unavailable", reason: "no adapter" } };
  const r = await plan(w, { maxCheckIterations: 1 });
  assert.equal(r.result.status, "planned");
  assert.ok(r.result.warnings.some((x) => x.includes("owns could not look")));
});

const Q = ".planning/quick/261020-001-fix";
const ID = "261020-001";
const CONTEXT = `${Q}/${ID}-CONTEXT.md`;
// quick-plan --full with a checker that answers round by round; the verifier writes a passed report.
function quickRun(checks) {
  const w = makeWorld({ files: { ".planning/ROADMAP.md": "# Roadmap\n", [CONTEXT]: "<decisions>\n- **D-01:** keep it small\n</decisions>\n" } });
  let n = 0;
  const agent = (p, o) => {
    if (o.label === "quick-research") { w.write(`${Q}/${ID}-RESEARCH.md`, "research\n"); return "researched"; }
    if (o.label === "quick-plan") { w.write(`${Q}/${ID}-PLAN.md`, planText("01-01")); return { marker: "PLANNING COMPLETE" }; }
    if (o.label.startsWith("quick-check")) return { issues: checks[Math.min(n++, checks.length - 1)] };
    if (o.label.startsWith("quick-revise")) return { marker: "REVISION COMPLETE" };
    if (o.label === "quick-exec") { w.write(`${Q}/${ID}-SUMMARY.md`, "summary\n"); return { taskResults: [] }; }
    if (o.label === "quick-verify") {
      const fp = quickVerification(w.root, Q, "fingerprint");
      w.write(`${Q}/${ID}-VERIFICATION.md`, `---\nstatus: passed\ncovered_files: ${JSON.stringify(fp.covered_files)}\ncovered_digest: ${fp.covered_digest}\ngaps: []\nhuman_verification: []\n---\nreport\n`);
      return { status: "passed" };
    }
    return null;
  };
  return runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { full: true, dir: Q, description: "fix", contextPath: CONTEXT }, agent });
}

test("G004 quick: a warning-only check passes once, with no revision, and returns the warning", async () => {
  const r = await quickRun([[{ severity: "warning", description: "scope" }]]);
  assert.equal(r.result.status, "done");
  assert.deepEqual(labels(r, "quick-check"), ["quick-check-1"]);
  assert.deepEqual(labels(r, "quick-revise"), []);
  assert.deepEqual(r.result.warnings, ["checker: scope"]);
});

test("G004 quick: a revision carries the blocker only; the warning is not sent back to the planner", async () => {
  const r = await quickRun([[{ severity: "blocker", description: "revise me" }, { severity: "warning", description: "soft" }], [{ severity: "warning", description: "soft" }]]);
  assert.equal(r.result.status, "done");
  assert.deepEqual(labels(r, "quick-check"), ["quick-check-1", "quick-check-2"]);
  assert.deepEqual(r.result.warnings, ["checker: soft"]);
  const revise = r.calls.find((c) => c.opts.label === "quick-revise-1").prompt;
  assert.match(revise, /revise me/);
  assert.doesNotMatch(revise, /soft/);
});
