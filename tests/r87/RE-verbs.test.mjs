// Kit feedback #87 part B for planning (RE): the planning state verbs (flow-plan-state.mjs), the one writer of
// <phaseDir>/plan-progress.json. Each verb keeps one record and refuses what breaks its contract: the run and its instances, the
// plan lifecycle, the checker parts (cap and stall per plan, issues no checker confirmed resolved, forceProceed per issue and never
// for a plan this instance wrote), the contract changes of a run across its resumed instances, the reallocation rounds and the
// recheck scope; `revisions record` without --settings reuses the digest the last gsd-plan run used (item 73).
import assert from "node:assert/strict";
import test from "node:test";
import * as ps from "../../ship/.agents/workflows/lib/flow-plan-state.mjs";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";

const RUN = "wf_20261023-100000_aaaa";
const SETTINGS = { freeze: "F1", plan: "P1", checked: "C1" };
const rec = (w) => JSON.parse(w.read(`${PHASE_DIR}/plan-progress.json`));
const start = (w, extra = {}) => ps.planRun(w.root, PHASE_DIR, { run: RUN, settings: SETTINGS, ...extra });
const step = (w, part, id, ops, run = RUN) => ps.planChecker(w.root, PHASE_DIR, { run, part, step: id, ops });
const reply = (r) => {
  assert.equal(r.status, "ok", JSON.stringify(r));
  return r.replies.length === 1 ? r.replies[0] : r.replies;
};
const blocker = (plan, dimension, extra = {}) => ({ plan, dimension, severity: "blocker", required_property: dimension, description: `${plan} ${dimension}`, ...extra });
const SCOPE = ["01-01", "01-02"];
const round = (issues, extra = {}) => ({ op: "round", scope: SCOPE, live: SCOPE, resolved: [], issues, checkerIssues: issues, probes: [], cap: 3, reallocate: false, ...extra });

test("RE plan-run starts an instance; one that never ended makes the next start a resume, one that ended a new run", () => {
  const w = makeWorld();
  assert.equal(ps.planRun(w.root, PHASE_DIR, { run: RUN, settings: { freeze: "F1" } }).status, "refused");
  assert.deepEqual(start(w), { status: "ok", rev: 1, resumed: false, instance: `${RUN}#1`, recorded: [], outline: null });
  assert.equal(ps.planMark(w.root, PHASE_DIR, { run: RUN, plans: ["01-01"], stage: "recorded" }).status, "ok");
  assert.equal(ps.planMark(w.root, PHASE_DIR, { run: RUN, plans: ["1-x"], stage: "recorded" }).status, "refused");
  assert.equal(ps.planMark(w.root, PHASE_DIR, { run: RUN, plans: ["01-01"], stage: "checked" }).status, "refused");
  ps.planOutline(w.root, PHASE_DIR, { run: RUN, inputs: "I1", sha: "O1" });
  // The runner died: the next start of the run resumes it, with the plans it recorded and the outline it wrote.
  const resumed = start(w);
  assert.deepEqual([resumed.resumed, resumed.instance, resumed.recorded, resumed.outline?.sha], [true, `${RUN}#2`, ["01-01"], "O1"]);
  assert.equal(ps.planEnd(w.root, PHASE_DIR, { run: RUN }).status, "ok");
  const next = start(w);
  assert.deepEqual([next.resumed, next.instance, next.recorded, next.outline], [false, `${RUN}#3`, [], null]);
  assert.deepEqual([rec(w).since, rec(w).settings], [3, SETTINGS]);
  const other = ps.planRun(w.root, PHASE_DIR, { run: "wf_20261023-110000_bbbb", settings: SETTINGS });
  assert.deepEqual([other.resumed, other.instance], [false, "wf_20261023-110000_bbbb#1"]);
  assert.equal(step(w, "checker", "i1", [round([])]).status, "refused", "a step of another run than the record's is refused");
});

test("RE plan-checker round: per plan cap and stall, the blockers no checker confirmed resolved come back, the same step is answered again unchanged", () => {
  const w = makeWorld();
  start(w);
  const r1 = reply(step(w, "checker", "i1", [round([blocker("01-01", "a"), blocker("01-02", "b"), blocker(null, "phase")])]));
  assert.deepEqual(r1.revise.map(([k, l]) => [k, l.length]), [["01-01", 1], ["01-02", 1], [null, 1]]);
  assert.deepEqual(r1.next.map((i) => i.id), ["open-1", "open-2", "open-3"]);
  const rev = rec(w).rev;
  assert.deepEqual(reply(step(w, "checker", "i1", [round([blocker("01-01", "a"), blocker("01-02", "b"), blocker(null, "phase")])])), r1);
  assert.equal(rec(w).rev, rev, "the same step again writes nothing");
  // Round 2: the checker confirms 01-02's blocker resolved and says nothing of 01-01's: it stays open and does not fall (stall).
  const r2 = reply(step(w, "checker", "i2", [round([], { resolved: ["open-2"] })]));
  assert.equal(r2.confirmed, 1);
  assert.deepEqual(r2.newlyStuck.map((s) => [s.key, s.why]), [["01-01", "stalled: 1 issues, not below 1"], [null, "stalled: 1 issues, not below 1"]]);
  assert.deepEqual(r2.revise, []);
  const s = reply(step(w, "checker", "settle", [{ op: "settle", scope: SCOPE }]));
  assert.equal(s.stop, "stuck");
  assert.deepEqual(s.answer, [{ plan: "01-01", dimension: "a" }, { plan: null, dimension: "phase" }]);
  const view = ps.planState(w.root, PHASE_DIR).views.checker;
  assert.deepEqual(view.findings.map((f) => [f.id, f.plan, f.fate]), [["K1", "01-01", "open"], ["K2", "01-02", "applied"], ["K3", null, "open"]]);
  assert.equal(step(w, "checker", "i3", [round([], { cap: 4 })]).status, "refused", "the cap is 1..3");
  assert.equal(step(w, "checker", "i3", [{ op: "drop" }]).status, "refused");
  assert.equal(step(w, "contracts", "x", [{ op: "round" }]).status, "refused", "plan-checker writes only checker parts");
});

test("RE forceProceed accepts only the issues it names and never a plan this instance wrote; a reason alone accepts what is stuck", () => {
  const w = makeWorld();
  start(w, { force: { reason: "size accepted", issues: [{ plan: "01-01", dimension: "Scope_Sanity " }] } });
  ps.planMark(w.root, PHASE_DIR, { run: RUN, plans: ["01-02"], stage: "planned" });
  const r1 = reply(step(w, "checker", "i1", [round([blocker("01-01", "scope_sanity"), blocker("01-02", "key_links")], { cap: 1 })]));
  assert.deepEqual(r1.newlyStuck.map((s) => s.key), ["01-02"], "the accepted issue is never counted");
  const s = reply(step(w, "checker", "settle", [{ op: "settle", scope: SCOPE }]));
  assert.deepEqual([s.stop, s.accepted.map((a) => a.plan), s.answer], ["uncovered", ["01-01"], [{ plan: "01-01", dimension: "scope_sanity" }, { plan: "01-02", dimension: "key_links" }]]);
  // Only the named issue, in a plan this instance did not write: accepted, one STATE line per issue.
  const w2 = makeWorld();
  start(w2, { force: { reason: "size accepted", issues: [{ plan: "01-01", dimension: "scope_sanity" }, { plan: "01-02", dimension: "never" }] } });
  reply(step(w2, "checker", "i1", [round([blocker("01-01", "scope_sanity")], { cap: 1 })]));
  const ok = reply(step(w2, "checker", "settle", [{ op: "settle", scope: SCOPE }]));
  assert.deepEqual([ok.override.mode, ok.lines, ok.override.unused], ["issues", ["01-01 [scope_sanity]: 01-01 scope_sanity"], [{ plan: "01-02", dimension: "never" }]]);
  assert.equal(rec(w2).accepted.mode, "issues");
  // A reason alone accepts the stuck plan, but not one a planner of this instance wrote (F40); the next run may.
  const w3 = makeWorld();
  start(w3, { force: { reason: "go" } });
  ps.planMark(w3.root, PHASE_DIR, { run: RUN, plans: ["01-01"], stage: "planned" });
  reply(step(w3, "checker", "i1", [round([blocker("01-01", "x")], { cap: 1 })]));
  assert.deepEqual(reply(step(w3, "checker", "settle", [{ op: "settle", scope: SCOPE }])).plans, ["01-01"]);
  ps.planEnd(w3.root, PHASE_DIR, { run: RUN });
  start(w3, { force: { reason: "go" } });
  reply(step(w3, "checker", "i1", [round([blocker("01-01", "x")], { cap: 1 })]));
  const all = reply(step(w3, "checker", "settle", [{ op: "settle", scope: SCOPE }]));
  assert.deepEqual([all.override.mode, all.warnAll], ["all", true]);
});

test("RE the streams join and the dependency checks: route rounds, confirmed blockers, final probe blockers stuck with their plan", () => {
  const w = makeWorld();
  start(w);
  const probe = { probe: "owns", plan: "01-02", severity: "blocker", description: "owns overlap" };
  const j = reply(step(w, "join", "join", [{ op: "join", scope: SCOPE, issues: [blocker("01-01", "a")], checkerIssues: [blocker("01-01", "a")], probes: [probe] }]));
  assert.deepEqual([j.keys, j.found.map((i) => i.id)], [["01-01", "01-02"], ["K1"]]);
  const g = reply(step(w, "join", "route:01-01:1", [{ op: "route", key: "01-01", round: 1, cap: 3 }]));
  assert.deepEqual(g.asked.map((i) => i.id), ["K1"]);
  assert.deepEqual(reply(step(w, "join", "route:01-01:1:done", [{ op: "route-done", key: "01-01", resolved: ["K1"], probes: [] }])).open, []);
  const f = reply(step(w, "join", "final", [{ op: "final", probes: [probe] }]));
  assert.deepEqual([f.stuck.map((x) => [x.key, x.why]), f.rounds], [[["01-02", "01-02: probe blockers left after the routed revisions"]], { "01-01": 1 }]);
  const dep = (round, issues) => reply(step(w, "dependents", `dep:1:01-02:${round}`, [{ op: "dep", plan: "01-02", stream: "1:01-02", round, providers: ["01-01"], issues, cap: 3 }]));
  assert.equal(dep(1, [blocker(null, "stale"), blocker(null, "old")]).open.length, 2);
  const d2 = dep(2, [blocker(null, "stale")]);
  assert.deepEqual([d2.open.length, d2.stuck, d2.dependents], [1, undefined, []]);
  const d3 = dep(3, [blocker(null, "stale")]);
  assert.deepEqual([d3.stuck, d3.dependents], [true, [{ plan: "01-02", providers: ["01-01"], rounds: 3, revised: true, stuck: true }]]);
  assert.deepEqual(ps.planState(w.root, PHASE_DIR).views.dependents.findings.map((x) => [x.id, x.class, x.fate]), [["D1", "stale", "open"], ["D2", "old", "applied"]]);
});


test("RE plan-realloc counts the rounds a run may use; plan-recheck sorts a plan edit from every other change", () => {
  const w = makeWorld();
  start(w);
  const realloc = (id, ops) => ps.planRealloc(w.root, PHASE_DIR, { run: RUN, step: id, ops });
  assert.deepEqual(reply(realloc("r1", [{ op: "begin", rounds: 1 }])), { round: 1, left: 0, reallocated: [] });
  assert.equal(realloc("r2", [{ op: "begin", rounds: 1 }]).status, "refused");
  assert.deepEqual(reply(realloc("r1:done", [{ op: "done", round: 1, plans: ["01-01"], changed: ["01-01", "01-03"] }])).reallocated, [{ round: 1, plans: ["01-01"], changed: ["01-01", "01-03"], removed: [], issues: [] }]);
  const scope = (id, checked, body) => reply(ps.planRecheck(w.root, PHASE_DIR, { run: RUN, step: id, ops: [{ op: "scope", phaseDir: PHASE_DIR, scope: SCOPE, checked, ...(body ? { body } : {}) }] }));
  assert.deepEqual(scope("a", { code: 66, changed: null }), { full: "no earlier passing check" });
  assert.deepEqual(scope("b", { code: 1, changed: [`${PHASE_DIR}/01-PLAN-OUTLINE.md`, `${PHASE_DIR}/01-01-PLAN.md`] }), { full: `not a plan edit: ${PHASE_DIR}/01-PLAN-OUTLINE.md` });
  const planEdit = { code: 1, changed: [`${PHASE_DIR}/01-01-PLAN.md`, `${PHASE_DIR}/01-02-PLAN.md`] };
  assert.deepEqual(scope("c", planEdit), { changed: ["01-01", "01-02"] });
  assert.deepEqual(scope("d", planEdit, { code: 1, changed: [`${PHASE_DIR}/01-02-PLAN.md`] }), { changed: ["01-01", "01-02"], bodyChanged: ["01-02"] });
});

test("RE plan-progress.json has one writer: the file verbs of gsd-flow refuse it", async () => {
  const w = makeWorld();
  start(w);
  for (const [cmd, input] of [["write", "{}"], ["append", "x"], ["json-push", "{}"], ["remove", ""]]) {
    let line = "";
    const code = await main([cmd, `${PHASE_DIR}/plan-progress.json`], { root: w.root, input, out: (l) => { line = l; } });
    assert.equal(code, 1, cmd);
    assert.match(JSON.parse(line).error, /written only by the plan-\* verbs/);
  }
  assert.equal(rec(w).run, RUN);
});

test("RE revisions record without --settings takes the settings digest the last gsd-plan run used, before another plan's record (item 73)", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ id: "01" }), [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[src/b.js]", owns: "[\"Path:src/b.js\"]" }), [`${P1}/01-PLAN-OUTLINE.md`]: "# outline\n" } });
  await gsd(p, ["revisions", "record", "1", "plan:01-01", "--settings", "S-old"]);
  ps.planRun(p.root, P1, { run: RUN, settings: { freeze: "S-f", plan: "S-run", checked: "S-c" } });
  const r = await gsd(p, ["revisions", "record", "1", "plan:01-02"]);
  assert.deepEqual(r.json.settings, { digest: "S-run", source: "the last gsd-plan run (plan-progress.json)" });
  const own = await gsd(p, ["revisions", "record", "1", "plan:01-01"]);
  assert.deepEqual(own.json.settings, { digest: "S-old", source: "previous record" }, "a key's own record still comes first");
});
