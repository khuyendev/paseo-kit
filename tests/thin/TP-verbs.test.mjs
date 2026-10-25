// THIN.md stage 2 for gsd-plan (TP, kit feedback 87): the deterministic parts of gsd-plan as pure flow verbs of
// lib/flow-plan.mjs (no record written): plan-args, plan-skeleton, plan-probes, plan-linked, plan-realloc-diff,
// plan-validation. Each answers what the script computed inline before (thin/TI, fde400b).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { planArgs, planLinked, planProbes, planReallocDiff, planSkeleton, planValidation, skeletonBook, SCHEMAS } from "../../ship/.agents/workflows/lib/flow-plan.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { makeTempDir, makeTempProject } from "../helpers/temp.mjs";

const G = { max_skeleton_passes: 2, max_check_iterations: 3, skeleton_lanes: [{ lens: "fidelity" }, { lens: "integration", model: "m", effort: "high" }], plan_review: false, granularity: "standard", plan_limits: { tasks_per_plan: 3, plans_per_phase: 8, waves_per_phase: 4 }, roles: { checker: { model: "c" } } };
const KIT = ["fidelity", "integration"];
// The composition policies as gsd-plan.js resolves them (kit feedback 87, RF: only the script reads them).
const policyOf = (a, g) => ({
  mode: a.mode ?? "plan", tracer: a.tracer ?? true, reversibilityGates: a.reversibilityGates ?? true, wiring: a.wiring ?? "auto", granularity: g.granularity,
  maxSkeletonPasses: a.maxSkeletonPasses ?? g.max_skeleton_passes, maxCheckIterations: a.maxCheckIterations ?? g.max_check_iterations, skeletonLanes: a.skeletonLanes ?? g.skeleton_lanes,
  planReview: a.planReview ?? g.plan_review, planFlow: a.planFlow ?? g.plan_flow ?? "staged", checkerReallocate: g.checker_reallocate ?? 0, checkerRecheck: g.checker_recheck ?? "full",
});
const args = (a, g = G, adapter = {}) => planArgs(makeTempDir(), { args: a, policy: policyOf(a, g), gsd: g, adapter, kitLenses: KIT });

test("TP plan-args checks the arguments in the GSDF-15 order and answers the first problem", () => {
  const bad = [
    [{ mode: "x", maxSkeletonPasses: 9 }, "mode must be plan or gaps, not x"],
    [{ maxSkeletonPasses: 4, maxCheckIterations: 0 }, "maxSkeletonPasses must be an integer 1..3, not 4"],
    [{ maxCheckIterations: 1.5 }, "maxCheckIterations must be an integer 1..3, not 1.5"],
    [{ skeletonLanes: [{ lens: " " }] }, "skeletonLanes needs a list of lanes, each with a non-empty lens"],
    [{ wiring: "maybe", planFlow: "x" }, "wiring must be auto, always or never, not maybe"],
    [{ planFlow: "pipelined" }, "planFlow must be staged or streams, not pipelined"],
    [{ forceProceed: { reason: " " } }, "forceProceed needs a non-empty reason"],
    [{ forceProceed: { reason: "ok", issues: [{ plan: "", dimension: "x" }] } }, "forceProceed.issues needs a non-empty list of {plan (a plan id, null for a phase-level issue), dimension}"],
    [{ reviewGuidance: "" }, "reviewGuidance needs non-empty text"],
    [{ skeletonLanes: [{ lens: "correctness" }] }, "skeleton lane lens 'correctness' is neither a skeleton kit lens (fidelity, integration) nor an adapter.review_lenses entry of stage skeleton"],
  ];
  for (const [a, reason] of bad) assert.deepEqual(args(a), { status: "failed", reason, code: 1 }, reason);
  // skipResearch without a reason is the owner's to answer; a bad lens after it is not reached.
  assert.deepEqual(args({ skipResearch: true, skeletonLanes: [{ lens: "correctness" }] }), { status: "needs-owner", stage: "Research", reason: "skipResearch needs a researchSkipReason", code: 1 });
});

test("TP plan-args normalises the arguments and answers the settings each revision key hashes, as the script had them", () => {
  const custom = { name: "layout", stage: "skeleton", text: "Check the layout." };
  const r = args({ roles: { skeleton_lane: { effort: "low" }, planner: { model: "p" } }, skeletonLanes: [{ lens: "fidelity", model: "x" }, { lens: "layout" }], forceProceed: { reason: "ok", issues: [{ plan: null, dimension: "scope" }] } }, { ...G, checker_reallocate: 2, tracer_extra_files: 3, files_per_plan: { warning: 8, blocker: 12 } }, { review_lenses: [custom], stack_skill: "flutter" });
  assert.equal(r.status, "ok");
  assert.deepEqual([r.mode, r.tracer, r.reversibilityGates, r.maxSkeletonPasses, r.maxCheckIterations, r.wiringMode, r.planReview, r.planFlow, r.reallocRounds, r.recheckMode], ["plan", true, true, 2, 3, "auto", false, "staged", 2, "full"]);
  assert.deepEqual(r.forcedIssues, [{ plan: null, dimension: "scope" }]);
  assert.deepEqual(r.lanes.map((l) => [l.id, l.text, l.opts]), [["L1", "Lens: fidelity. Follow the lens text in .agents/workflows/lenses/fidelity.md.", { role: "skeleton_lane", model: "x", effort: "low" }], ["L2", "Lens: layout.\nCheck the layout.", { role: "skeleton_lane", effort: "low" }]]);
  assert.deepEqual(r.roles, { planner: { role: "planner", model: "p" }, outline: { role: "outline" }, checker: { role: "checker" }, architect: { role: "architect" }, skeleton_lane: { role: "skeleton_lane", effort: "low" } });
  const planning = { tracer: true, reversibilityGates: true, granularity: "standard", plan_limits: G.plan_limits, stack_skill: "flutter" };
  assert.equal(JSON.stringify(r.settings), JSON.stringify({
    freeze: { lanes: [{ lens: "fidelity", text: r.lanes[0].text, model: "x", effort: null }, { lens: "layout", text: r.lanes[1].text, model: null, effort: null }], skeleton_lane: { effort: "low" }, tracer: true, maxSkeletonPasses: 2 },
    plan: planning,
    checked: { ...planning, checker: { model: "c" }, maxCheckIterations: 3, tracerExtraFiles: 3, filesPerPlan: { warning: 8, blocker: 12 }, reallocRounds: 2 },
  }));
  assert.deepEqual(r.schemas, JSON.parse(JSON.stringify(SCHEMAS)));
  // Kit feedback 69, 76: reallocation and the incremental recheck belong to the staged plan mode only.
  assert.equal(args({ planFlow: "streams" }, { ...G, checker_reallocate: 2 }).reallocRounds, 0);
  assert.deepEqual([args({ mode: "gaps" }, { ...G, checker_reallocate: 2, checker_recheck: "incremental" })].map((x) => [x.reallocRounds, x.recheckMode]), [[0, "full"]]);
});

test("TP plan-args answers the skeleton lane inputs with the project's kit lens files, as flow read gives them (G009)", async () => {
  const p = makeTempProject({ git: false, files: { ".agents/workflows/lenses/fidelity.md": "Fidelity lens\r\nline two\n" } });
  const cfg = loadConfig(p.root);
  const a = { skeletonLanes: [{ lens: "fidelity" }, { lens: "integration" }] };
  const r = planArgs(p.root, { args: a, policy: policyOf(a, cfg.gsd), gsd: cfg.gsd, adapter: cfg.adapter, kitLenses: KIT });
  assert.equal(r.status, "ok", JSON.stringify(r));
  const lines = [];
  await main(["read", ".agents/workflows/lenses/fidelity.md"], { root: p.root, out: (l) => lines.push(l) });
  assert.deepEqual(r.laneInputs.lanes.map((l) => l.file), [JSON.parse(lines.at(-1)).text, null]);
  assert.deepEqual(r.skeleton, skeletonBook(r.lanes));
});

test("TP plan-skeleton keeps the gate's issue book: lanes, routing, resolution, stall numbers and the review", () => {
  let sk = skeletonBook([{ id: "L1", lens: "fidelity", text: "t1" }, { id: "L2", lens: "integration", text: "t2" }]);
  const op = (name, data = {}) => {
    const r = planSkeleton(".", name, { sk, ...data });
    sk = r.sk;
    return r;
  };
  // A failed lane keeps the other lane's findings; the answer names the failed lane.
  const failed = planSkeleton(".", "first", { sk, replies: [{ result: { issues: [{ severity: "blocker", description: "x" }] }, model: "m" }, { result: null, reason: "quota" }], outlineChanges: [] });
  assert.equal(failed.failed, "skeleton lane L2 (integration): quota");
  assert.equal(failed.sk.issues.length, 1);
  const first = op("first", { replies: [{ result: { issues: [{ severity: "BLOCKER", plan: "01-01", description: "b1", target: "wiring" }, { severity: "info", description: "note" }, { severity: "warning", description: "w1" }] }, model: "m", effort: null }, { result: { issues: [] } }], outlineChanges: [{ severity: "blocker", description: "arch", target: "outline" }] });
  assert.deepEqual([first.blockers, first.advisories], [2, [{ lane: "L1", plan: null, description: "note" }]]);
  assert.deepEqual(sk.issues.map((i) => [i.id, i.lane, i.severity, i.target]), [["L1-1", "L1", "blocker", "wiring"], ["L1-2", "L1", "warning", "outline"], ["L2-3", "L2", "blocker", "outline"]]);
  assert.deepEqual(sk.laneIssueIds, ["L1-1", "L1-2"]);
  assert.deepEqual(sk.passCounts, [3]);
  // Without a wiring contract a wiring issue goes to the outline writer.
  assert.deepEqual(op("route", { wiringInUse: false }).toOutline.map((i) => i.id), ["L1-1", "L1-2", "L2-3"]);
  const routed = op("route", { wiringInUse: true });
  assert.deepEqual([routed.startBlockers, routed.toOutline.map((i) => i.id), routed.toWiring.map((i) => i.id)], [2, ["L1-2", "L2-3"], ["L1-1"]]);
  op("add", { issues: [{ severity: "blocker", description: "edge" }] });
  const { byLane } = op("pending");
  assert.deepEqual([byLane.L1.map((i) => i.id), byLane.L2.map((i) => i.id)], [["L1-1", "L1-2"], ["L2-3", "L2-4"]]);
  // A resolution check resolves only its own lane's open issues; one that returned nothing stops the gate.
  const un = planSkeleton(".", "resolve", { sk, checks: [{ lane: "L1", open: byLane.L1, r: { result: { resolved: [{ id: "L1-1", evidence: "e" }, { id: "L2-3" }] } } }, { lane: "L2", open: byLane.L2, r: { result: null, reason: null } }] });
  assert.deepEqual(un.unjudged, { reason: "skeleton resolution L2 (integration) returned nothing; open issues L2-3, L2-4 not judged", issues: byLane.L2 });
  const res = op("resolve", { checks: [{ lane: "L1", open: byLane.L1, r: { result: { resolved: [{ id: "L1-1", evidence: "e" }, { id: "L2-3" }] } } }, null] });
  assert.deepEqual([res.blockers, res.open.map((i) => i.id), sk.passCounts], [2, ["L2-3", "L2-4"], [3, 3]]);
  const end = op("end");
  // The warnings carried by a passing gate are its open issues (the script reads them only when no blocker is open).
  assert.deepEqual([end.blockers.length, end.passes, end.warnings], [2, 2, ["skeleton L1-2: w1", "skeleton L2-3: arch", "skeleton L2-4: edge"]]);
  const report = op("report", { gate: { status: "needs-owner", reason: "stalled", marker: "REVISION_CONFLICT" }, advisories: [{ lane: "L1", description: "note" }, { lane: "checker", description: "other" }], nn: "01" });
  assert.match(report.text, /^# Phase 01 outline review\n\nStatus: needs-owner \(stalled\)\n/);
  assert.match(report.text, /\| L1 \| fidelity \| m \| agent default \| ok \|/);
  assert.match(report.text, /- pass 1: 3 open\n- pass 2: 3 open/);
  assert.deepEqual(report.findings.map((f) => [f.id, f.source, f.fate, f.confirmed]), [["L1-1", "lane", "applied", true], ["L1-2", "lane", "open", false], ["L2-3", "flow", "conflict", false], ["L2-4", "flow", "conflict", false], ["L1-info-1", "lane", "carried", false]]);
  assert.throws(() => planSkeleton(".", "nope", { sk }), /unknown plan-skeleton op 'nope'/);
  assert.throws(() => planSkeleton(".", "end", {}), /needs sk/);
});

test("TP plan-probes turns the three probes into issues, with the Files/plan lines under reallocation", () => {
  const runs = {
    "verify-command-paths": { code: 69, json: { reason: "no shell" } },
    "verify-failure-directions": { code: 1, json: { findings: [{ plan: "01-01", severity: "info", message: "i" }, { plan: "01-02", detail: "d" }, { severity: "ERROR", description: "e" }] } },
    owns: { code: 1, json: { problems: [{ plan: "01-01", severity: "warning", message: "overlap" }], files_per_plan: { warning: 3, blocker: 5 }, plans: [{ id: "01-01", files_modified: [1, 2, 3, 4, 5] }, { id: "01-02", tracer: true, files_modified: [1, 2, 3, 4, 5] }, { id: "01-03", files_modified: [1, 2, 3] }] } },
  };
  const base = [
    { probe: "verify-command-paths", severity: "warning", description: "verify-command-paths could not look: no shell" },
    { probe: "verify-failure-directions", plan: "01-02", severity: "warning", description: "d" },
    { probe: "verify-failure-directions", plan: null, severity: "blocker", description: "e" },
    { probe: "owns", plan: "01-01", severity: "blocker", description: "overlap" },
  ];
  assert.deepEqual(planProbes(".", { runs }).found, base);
  assert.deepEqual(planProbes(".", { runs, filesPerPlan: true, tracerExtraFiles: 2 }).found, [...base,
    { probe: "files-per-plan", plan: "01-01", severity: "blocker", outcome: "reallocate", description: "01-01 lists 5 files in files_modified, blocker at 5+ (its owned paths need a new allocation in the outline)" },
    { probe: "files-per-plan", plan: "01-02", severity: "warning", description: "01-02 lists 5 files in files_modified, warning at 5+" },
    { probe: "files-per-plan", plan: "01-03", severity: "warning", description: "01-03 lists 3 files in files_modified, warning at 3+" },
  ]);
});

test("TP plan-linked names the plans a plan edit can affect: depends_on, consumes and key_links into a write set", () => {
  const scope = ["01-01", "01-02", "01-03", "01-04", "01-05"];
  const plans = {
    "01-01": { mustHaves: { key_links: [{ from: "lib/a.dart", to: "src:lib/shared/x.dart#L3" }] }, owns: ["lib/a.dart"], written: [] },
    "01-02": { owns: ["lib/b/"], written: [] },
    "01-03": { owns: ["lib/shared"], written: ["./test\\c.dart"] },
    "01-04": { mustHaves: { key_links: [{ from: "test/c.dart", to: "x" }] }, owns: [], written: [] },
    "01-05": { owns: [], written: [] },
  };
  const r = planLinked(".", { ids: ["01-01"], scope, index: [{ id: "01-02", depends_on: ["01-01"] }, { id: "01-01", depends_on: [] }], manifest: [{ id: "01-05", consumes: [{ plan: "01-01" }] }], plans });
  assert.deepEqual(r.linked, ["01-02", "01-03", "01-05"]);
  assert.deepEqual(planLinked(".", { ids: ["01-03"], scope, index: [], manifest: [], plans }).linked, ["01-01", "01-04"]);
  assert.deepEqual(planLinked(".", { ids: [], scope, plans }).linked, []);
});

test("TP plan-realloc-diff names the changed, removed and unchanged plans and the forceProceed issues for the unchanged", () => {
  const before = { rows: [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 1 }, { id: "01-03", wave: 2 }], manifest: { plans: [{ id: "01-01", owns: ["a"] }, { id: "01-02", owns: ["b", "c"] }, { id: "01-03", owns: ["d"] }] } };
  const after = { rows: [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 1 }, { id: "01-04", wave: 2 }], manifest: { plans: [{ id: "01-01", owns: ["a"] }, { id: "01-02", owns: ["b"] }, { id: "01-04", owns: ["c"] }] } };
  const sent = [{ plan: "01-01", probe: "files-per-plan", description: "x" }, { plan: "01-01", dimension: " Files-Per-Plan ", description: "y" }, { plan: "01-02", description: "z" }];
  assert.deepEqual(planReallocDiff(".", { before, after, named: ["01-01", "01-02"], planIds: ["01-01", "01-02", "01-03"], sent }), {
    idsAfter: ["01-01", "01-02", "01-04"], changed: ["01-02", "01-04"], removed: ["01-03"], unchanged: ["01-01"], accept: [{ plan: "01-01", dimension: "files-per-plan" }],
  });
});

test("TP plan-validation: the Dimension 8 note, the warnings, the log line and the commit of the validation strategy step", () => {
  assert.deepEqual(planValidation(".", { off: "gsd.validation_strategy is off", approvedResearch: "R.md" }), { validation: { skipped: "gsd.validation_strategy is off" }, report: null, warnings: [], log: null, commit: null });
  assert.deepEqual(planValidation(".", { approvedResearch: null }).validation, { skipped: "no approved research in this run" });
  assert.deepEqual(planValidation(".", { approvedResearch: "R.md", strategy: { status: "no-section" } }), { validation: { skipped: "the approved research has no Validation Architecture section" }, report: { status: "no-section" }, warnings: ["validation: R.md has no Validation Architecture section; no VALIDATION.md was written and Dimension 8 is skipped"], log: null, commit: null });
  assert.deepEqual(planValidation(".", { approvedResearch: "R.md", strategy: { status: "written", path: "V.md" } }), { validation: { path: "V.md" }, report: { status: "written", path: "V.md" }, warnings: [], log: "validation strategy written: V.md", commit: "V.md" });
  const kept = planValidation(".", { approvedResearch: "R.md", strategy: { status: "kept", path: "V.md", stale: true } });
  assert.deepEqual([kept.log, kept.commit, kept.warnings.length], ["validation strategy kept: V.md", null, 1]);
});

test("TP the planning verbs are flow verbs that write nothing", async () => {
  const root = makeTempDir();
  const before = fs.readdirSync(root);
  for (const [argv, input] of [[["plan-args"], { args: {}, policy: policyOf({}, G), gsd: G, kitLenses: KIT }], [["plan-probes"], { runs: {} }], [["plan-linked"], { ids: [] }], [["plan-realloc-diff"], {}], [["plan-validation"], {}], [["plan-skeleton", "end"], { sk: skeletonBook([{ id: "L1", lens: "fidelity" }]) }]]) {
    const lines = [];
    const code = await main(argv, { root, input: JSON.stringify(input), out: (l) => lines.push(l) });
    assert.equal(code, 0, `${argv.join(" ")}: ${lines.at(-1)}`);
  }
  assert.deepEqual(fs.readdirSync(root), before);
});
