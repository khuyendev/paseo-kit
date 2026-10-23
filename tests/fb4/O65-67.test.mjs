// Kit feedback #67, folded into O65 (gsd.plan_flow "streams"): the planners of a wave run only on the reviewed, frozen plans
// of the wave before it, and a revision that changes a frozen plan's declared interface reaches every plan whose
// depends_on names it (a dependency check, then a revision of the dependent) before execute. Staged mode is unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText, plannerResponder } from "../gsd-flows/world.mjs";

const ROWS = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
const planPath = (id) => `${PD}/${id}-PLAN.md`;
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const labels = (r) => r.calls.map((c) => c.opts.label);
const count = (r, prefix) => labels(r).filter((l) => l.startsWith(prefix)).length;
const n = (r, label) => r.calls.find((c) => c.opts.label === label)?.n ?? -1;
const streams = () => makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
const plan = (w, args, overrides) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, ...args }, agent: plannerResponder(w, { rows: ROWS, overrides }) });

// 01-01 provides connect(); 01-02 depends on it and calls it.
const provider = (w, sig) => w.write(planPath("01-01"), `${planText("01-01")}<interfaces>\nprovides ${sig}\n</interfaces>\n`);
const consumer = (w, sig) => w.write(planPath("01-02"), `${planText("01-02", { wave: 2, depends: ["01-01"] })}<interfaces>\ncalls ${sig}\n</interfaces>\n`);
const planners = (w) => ({
  "plan-01-01": () => { provider(w, "connect(host)"); return { marker: "## PLANNING COMPLETE" }; },
  "plan-01-02": () => { consumer(w, "connect(host)"); return { marker: "## PLANNING COMPLETE" }; },
});
// The dependency check reports a blocker while 01-02 still calls the old signature.
const depcheck = (w) => ({ "depcheck-01-02": () => ({ issues: w.read(planPath("01-02")).includes("connect(host, timeout)") ? [] : [{ plan: "01-02", dimension: "deps", severity: "blocker", required_property: "calls 01-01 as declared", description: "calls connect(host) without timeout" }] }) });
const reviewClean = { "find-": () => ({ issues: [] }) };

test("O67 a wave-2 planner runs only after the wave-1 plans were reviewed and frozen, and sees the reviewed text", async () => {
  const w = streams();
  let seen = null;
  const r = await plan(w, { planReview: true }, {
    ...planners(w),
    "plan-01-02": () => { seen = w.read(planPath("01-01")); consumer(w, "connect(host)"); return { marker: "## PLANNING COMPLETE" }; },
    "find-01-01": () => ({ issues: w.read(planPath("01-01")).includes("reviewed") ? [] : [{ severity: "high", description: "connect has no timeout" }] }),
    "find-": () => ({ issues: [] }),
    "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }),
    "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }),
    "editor-01-01": () => { w.write(planPath("01-01"), `${planText("01-01")}<interfaces>\nprovides connect(host)\n</interfaces>\n<!-- reviewed -->\n`); return { marker: "REVISION COMPLETE" }; },
    "resolve-01-01": (p) => ({ resolved: ids(p).map((id) => ({ id, evidence: "done" })) }),
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.match(seen, /<!-- reviewed -->/);
  assert.ok(n(r, "resolve-01-01-1") < n(r, "plan-01-02"), "01-01's stream froze before the wave-2 planner started");
  // The edit kept the interface, so no dependency check ran.
  assert.equal(count(r, "depcheck-"), 0);
});

test("O67 a checker revision that changes a provider's signature reaches its dependent, which is revised until it matches", async () => {
  const w = streams();
  const r = await plan(w, { planReview: false }, {
    ...planners(w),
    ...depcheck(w),
    "checker-": () => ({ issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "connect takes a timeout", description: "connect(host) has no timeout" }] }),
    "revise-01-01": () => { provider(w, "connect(host, timeout)"); return { marker: "## REVISION COMPLETE" }; },
    "recheck-": (p) => ({ resolved: ids(p).filter((x) => x.startsWith("K")).map((id) => ({ id, evidence: "now has a timeout" })) }),
    "deprevise-01-02": () => { consumer(w, "connect(host, timeout)"); return { marker: "## REVISION COMPLETE" }; },
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(labels(r).filter((l) => /^(checker|revise|recheck|depcheck|deprevise)-/.test(l)), ["checker-1", "revise-01-01-1", "recheck-01-01-1", "depcheck-01-02-1", "deprevise-01-02-1", "depcheck-01-02-2"]);
  const prompt = r.calls.find((c) => c.opts.label === "depcheck-01-02-1").prompt;
  assert.match(prompt, /provides connect\(host\)"/);
  assert.match(prompt, /provides connect\(host, timeout\)/);
  assert.match(w.read(planPath("01-02")), /calls connect\(host, timeout\)/);
  assert.deepEqual(r.result.dependents, [{ plan: "01-02", providers: ["01-01"], rounds: 2, revised: true }]);
  assert.equal(w.recorded.has("plan:01-02"), true);
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 1);
});

test("O67 a review-stream edit of a frozen plan reaches a kept later-wave dependent before that wave is reviewed", async () => {
  const w = streams();
  const first = await plan(w, { planReview: true }, { ...planners(w), ...reviewClean });
  assert.equal(first.result.status, "planned", JSON.stringify(first.result));
  // A rerun: both plans are kept; 01-01's stream finds a high issue and its editor changes the signature.
  let edited = false;
  const second = await plan(w, { planReview: true }, {
    ...depcheck(w),
    "find-01-01": () => ({ issues: edited ? [] : [{ severity: "high", description: "connect has no timeout" }] }),
    ...reviewClean,
    "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }),
    "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }),
    "editor-01-01": () => { provider(w, "connect(host, timeout)"); edited = true; return { marker: "REVISION COMPLETE" }; },
    "resolve-01-01": (p) => ({ resolved: ids(p).map((id) => ({ id, evidence: "done" })) }),
    "deprevise-01-02": () => { consumer(w, "connect(host, timeout)"); return { marker: "## REVISION COMPLETE" }; },
  });
  assert.equal(second.result.status, "planned", JSON.stringify(second.result));
  assert.equal(count(second, "plan-"), 0);
  assert.ok(n(second, "depcheck-01-02-1") > n(second, "resolve-01-01-1"));
  assert.ok(n(second, "deprevise-01-02-1") < n(second, "find-01-02-source-grounding"), "the dependent was fixed before its own stream");
  assert.match(w.read(planPath("01-02")), /calls connect\(host, timeout\)/);
});

test("O67 a dependent that keeps the old signature stops needs-owner at Dependents", async () => {
  const w = streams();
  const r = await plan(w, { planReview: false }, {
    ...planners(w),
    ...depcheck(w),
    "checker-": () => ({ issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "connect takes a timeout", description: "no timeout" }] }),
    "revise-01-01": () => { provider(w, "connect(host, timeout)"); return { marker: "## REVISION COMPLETE" }; },
    "recheck-": (p) => ({ resolved: ids(p).filter((x) => x.startsWith("K")).map((id) => ({ id })) }),
    "deprevise-01-02": () => ({ marker: "## REVISION COMPLETE" }),
  });
  assert.deepEqual([r.result.status, r.result.stage, r.result.plan], ["needs-owner", "Dependents", "01-02"], JSON.stringify(r.result));
  assert.match(r.result.reason, /01-02 still uses the old interface of 01-01/);
  assert.equal(count(r, "deprevise-01-02"), 1);
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 0);
});

test("O67 the staged flow does not propagate: the same signature change leaves the dependent unchecked", async () => {
  const w = makeWorld();
  let checks = 0;
  const r = await plan(w, { planReview: false }, {
    ...planners(w),
    ...depcheck(w),
    "checker-": () => (checks++ === 0 ? { issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "connect takes a timeout", description: "no timeout" }] } : { issues: [], resolved: [{ id: "open-1", evidence: "fixed" }] }),
    "revise-01-01": () => { provider(w, "connect(host, timeout)"); return { marker: "## REVISION COMPLETE" }; },
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal(count(r, "depcheck-"), 0);
  assert.equal("dependents" in r.result, false);
  assert.match(w.read(planPath("01-02")), /calls connect\(host\)\n/);
});

test("O67 a wave-1 stream that does not converge stops the run before any wave-2 planner", async () => {
  const w = streams();
  const r = await plan(w, { planReview: true }, {
    ...planners(w),
    "find-01-01": () => ({ issues: [{ severity: "high", description: "connect has no timeout" }] }),
    "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }),
    "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }),
    "editor-01-01": () => ({ marker: "REVISION COMPLETE" }),
    "resolve-01-01": () => ({ resolved: [] }),
  });
  assert.deepEqual([r.result.status, r.result.stage, r.result.plan], ["needs-owner", "Plan review", "01-01"], JSON.stringify(r.result));
  assert.equal(count(r, "plan-01-02"), 0);
  assert.deepEqual(r.result.streams.map((s) => [s.plan, s.review]), [["01-01", "needs-owner"], ["01-02", "not started"]]);
});
