// Kit feedback #65 (O65): with gsd.plan_flow "streams", gsd-plan hands each plan to its own review stream as soon as its
// planner returns (find, verify, judge, edit, then a resolution check of only that plan's open findings), all streams at
// once; the phase-wide checker reads the frozen set once and sends its blockers back to only the plans they name.
// The default "staged" flow is unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, planText, plannerResponder } from "../gsd-flows/world.mjs";

const ROWS = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
const planPath = (id) => `${PD}/${id}-PLAN.md`;
const ids = (p, re = /"id":"([^"]+)"/g) => [...p.matchAll(re)].map((m) => m[1]);
const labels = (r) => r.calls.map((c) => c.opts.label);
const count = (r, prefix) => labels(r).filter((l) => l.startsWith(prefix)).length;
const plan = (w, args, overrides, rows = ROWS) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: true, ...args }, agent: plannerResponder(w, { rows, overrides }) });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// Review agents: the finder of a plan in `high` reports one high issue until that plan was edited; every plan gets one
// medium note; the verifier and judge keep everything; the resolution check resolves what `resolves(plan)` says.
function review(w, { high = [], resolves = () => true, edited = new Set() } = {}) {
  return {
    "find-": (p, o) => {
      const id = /find-(\d+-\d+)-/.exec(o.label)[1];
      return { issues: [{ severity: "medium", description: `note ${id}` }, ...(high.includes(id) && !edited.has(id) ? [{ severity: "high", actionable: true, description: `cites a missing symbol in ${id}` }] : [])] };
    },
    "verify-": (p) => ({ verdicts: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, valid: true })) }),
    "judge-": (p) => ({ decisions: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, keep: true })) }),
    "editor-": (p, o) => {
      // A stream's editor names its plan in the label; the staged editor (editor-<cycle>) revises every plan with a high issue.
      const one = /editor-(\d+-\d+)-/.exec(o.label);
      for (const id of one ? [one[1]] : high) {
        w.write(planPath(id), `${planText(id)}<!-- revised ${o.label} -->\n`);
        edited.add(id);
      }
      return { marker: "REVISION COMPLETE" };
    },
    "resolve-0": (p, o) => ({ resolved: resolves(/resolve-(\d+-\d+)-/.exec(o.label)[1]) ? ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, evidence: "fixed" })) : [] }),
  };
}

test("O65 streams: each plan is reviewed in its own stream, a high finding gets a resolution check instead of a fresh find, and the checker runs once", async () => {
  const w = makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
  const r = await plan(w, {}, review(w, { high: ["01-01"] }));
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal(r.result.planFlow, "streams");
  assert.deepEqual(r.result.streams.map((s) => [s.plan, s.planned, s.review, s.cycles, s.checker]), [["01-01", true, "converged", 2, "clean"], ["01-02", true, "converged", 1, "clean"]]);
  // One finder per plan and lens, never re-run after the edit; the edit and the resolution check touch only 01-01.
  assert.deepEqual(labels(r).filter((l) => l.startsWith("find-")).sort(), ["find-01-01-source-grounding", "find-01-02-source-grounding"]);
  assert.deepEqual(labels(r).filter((l) => /^(editor|resolve-0)/.test(l)), ["editor-01-01-1", "resolve-01-01-1"]);
  assert.match(r.calls.find((c) => c.opts.label === "editor-01-01-1").prompt, /Edit only \.planning\/phases\/01-core\/01-01-PLAN\.md/);
  assert.equal(count(r, "checker-"), 1);
  assert.equal(count(r, "revise-"), 0);
  // The stream recorded its edit; the notes of both streams are written once, at the join.
  assert.equal(w.recorded.has("plan:01-01"), true);
  assert.deepEqual(JSON.parse(w.read(`${PD}/plan-review-notes.json`)).map((n) => n.plan).sort(), ["01-01", "01-02"]);
  assert.deepEqual(r.result.advisories.filter((x) => x.lane === "plan-review").map((x) => x.plan).sort(), ["01-01", "01-02"]);
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 1);
});

test("O65 streams: the streams of one wave do not wait for each other", { timeout: 30000 }, async () => {
  const w = makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
  const otherJudged = deferred();
  const base = review(w, { high: ["01-01"] });
  // The plan-specific responders come first: the first matching label prefix answers. 01-01's resolution check answers
  // only once 01-02's stream judged; if one stream held the other, the run would never finish.
  const r = await plan(w, {}, {
    "judge-01-02": (p) => { otherJudged.resolve(); return base["judge-"](p); },
    "resolve-01-01": async (p, o) => { await otherJudged.promise; return base["resolve-0"](p, o); },
    ...base,
  }, [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 1 }]);
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const n = (label) => r.calls.find((c) => c.opts.label === label).n;
  assert.ok(n("judge-01-02-1") < n("resolve-01-01-1"));
});

test("O65 streams: the checker's blocker goes back only to the plan it names, which gets a resolution check, not a second checker", async () => {
  const w = makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
  const blocker = { plan: "01-02", dimension: "deps", severity: "blocker", required_property: "uses 01-01's API as declared", description: "calls a function 01-01 does not export" };
  const r = await plan(w, {}, {
    ...review(w),
    "checker-": () => ({ issues: [blocker, { plan: "01-01", severity: "warning", required_property: "x", description: "long task" }] }),
    "recheck-": (p) => ({ resolved: ids(p).filter((x) => x.startsWith("K")).map((id) => ({ id, evidence: "now matches" })) }),
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(labels(r).filter((l) => /^(revise|recheck|checker)-/.test(l)), ["checker-1", "revise-01-02-1", "recheck-01-02-1"]);
  assert.match(r.calls.find((c) => c.opts.label === "revise-01-02-1").prompt, /calls a function 01-01 does not export/);
  assert.deepEqual(r.result.streams.map((s) => [s.plan, s.checker, s.checkerRounds]), [["01-01", "clean", 0], ["01-02", "resolved", 1]]);
  assert.ok(r.result.warnings.some((x) => /checker \(01-01\): long task/.test(x)));
  assert.equal(w.recorded.has("checked"), true);
});

test("O65 streams: a checker blocker that is never resolved leaves its plan stuck at the cap, with the other plan done", async () => {
  const w = makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
  const r = await plan(w, {}, {
    ...review(w),
    "checker-": () => ({ issues: [{ plan: "01-02", dimension: "deps", severity: "blocker", required_property: "p", description: "still broken" }] }),
    "recheck-": () => ({ resolved: [] }),
  });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Checker"], JSON.stringify(r.result));
  assert.match(r.result.reason, /01-02: (checker cap 3 reached|stalled)/);
  assert.equal(count(r, "revise-01-02"), 1);
  assert.equal(count(r, "revise-01-01"), 0);
  assert.equal(r.result.planFlow, "streams");
});

test("O65 streams: a probe blocker left after the routed revisions is stuck with its plan", async () => {
  const w = makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
  w.probes.owns = { problems: [{ plan: "01-01", detail: "owns overlaps 01-02" }] };
  const r = await plan(w, {}, review(w));
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Checker"], JSON.stringify(r.result));
  assert.match(r.result.reason, /01-01:/);
  assert.equal(count(r, "revise-01-01"), 1);
  assert.equal(count(r, "recheck-"), 0);
});

test("O65 streams: a stream that does not converge stops at Plan review naming its plan; the other stream finished; a rerun replays its prompts and plans nothing", async () => {
  const w = makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
  // One wave: the stream of 01-02 runs beside 01-01's (a later wave would wait for 01-01 to freeze, item 67).
  const ONE_WAVE = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 1 }];
  const first = await plan(w, {}, review(w, { high: ["01-01"], resolves: () => false }), ONE_WAVE);
  assert.deepEqual([first.result.status, first.result.stage, first.result.plan], ["needs-owner", "Plan review", "01-01"], JSON.stringify(first.result));
  assert.match(first.result.reason, /plan review of 01-01 not converging/);
  assert.deepEqual(first.result.streams.map((s) => [s.plan, s.review]), [["01-01", "needs-owner"], ["01-02", "converged"]]);
  assert.deepEqual(first.result.counts, [{ cycle: 1, high: 1, mediumOrLow: 1 }, { cycle: 2, high: 1, mediumOrLow: 1 }]);
  assert.equal(count(first, "checker-"), 0);
  assert.equal(w.recorded.has("plan:01-01"), true);
  assert.equal(w.recorded.has("plan:01-02"), true);
  // The owner's answer is a rerun: both plans are kept, 01-02's stream asks exactly what it asked before (a --resume of the
  // run would serve it from the journal), and 01-01's stream goes on from its edited file.
  const second = await plan(w, {}, review(w, { high: [] }), ONE_WAVE);
  assert.equal(second.result.status, "planned", JSON.stringify(second.result));
  assert.equal(count(second, "plan-"), 0);
  assert.deepEqual(second.result.streams.map((s) => s.planned), [false, false]);
  const prompt = (r, label) => r.calls.find((c) => c.opts.label === label).prompt;
  assert.equal(prompt(second, "find-01-02-source-grounding"), prompt(first, "find-01-02-source-grounding"));
});

test("O65 streams without plan review: the planners run and the checker joins once", async () => {
  const w = makeWorld({ overlay: { gsd: { plan_flow: "streams" } } });
  const r = await plan(w, { planReview: false }, {});
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(r.result.streams.map((s) => s.review), ["off", "off"]);
  assert.equal(count(r, "find-"), 0);
  assert.equal(count(r, "checker-"), 1);
});

test("O65 the default staged flow is unchanged: one review over the whole set, no stream fields", async () => {
  const w = makeWorld();
  const r = await plan(w, {}, review(w, { high: ["01-01"] }));
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal("planFlow" in r.result, false);
  assert.equal("streams" in r.result, false);
  assert.ok(labels(r).includes("editor-1"));
  assert.equal(count(r, "resolve-0"), 0);
  assert.equal(count(r, "find-01-01"), 2);
});

test("O65 planFlow is validated before any agent; the arg overrides gsd.plan_flow", async () => {
  const w = makeWorld();
  const bad = await plan(w, { planFlow: "pipelined" }, {});
  assert.equal(bad.result.status, "failed");
  assert.match(bad.result.reason, /planFlow must be staged or streams/);
  assert.equal(bad.calls.length, 0);
  const on = await plan(makeWorld(), { planFlow: "streams", planReview: false }, {});
  assert.equal(on.result.planFlow, "streams");
});

test("O65 stream mode of gsd-plan-review takes exactly one plan", async () => {
  const w = makeWorld({ files: { [planPath("01-01")]: planText("01-01"), [planPath("01-02")]: planText("01-02") } });
  const r = await runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, plans: ["01-01", "01-02"], stream: true } });
  assert.deepEqual([r.result.status, r.result.reason], ["failed", "stream reviews exactly one plan"]);
});
