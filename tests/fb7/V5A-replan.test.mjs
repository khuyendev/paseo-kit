// Kit feedback #99 F3 and #101 F3 (V5A). 99 F3: a planner that needs a change in another plan says so in `plan_changes`; that plan is
// marked for re-planning in plan-progress.json (verb plan-replan) and planned again with the note, never left as a prose follow-up.
// 101 F3: a planner's REVISION_CONFLICT about one plan answers with replanPlans; the rerun after the owner's CONTEXT decision keeps
// the outline, its skeleton review and the other plans (verb plan-replan-keep) and plans only that plan.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, plannerResponder } from "../gsd-flows/world.mjs";
import { planMark, planReplan, planRun } from "../../ship/.agents/workflows/lib/flow-plan-state.mjs";
import { planReplanKeep } from "../../ship/.agents/workflows/lib/flow-plan.mjs";

const labels = (r) => r.calls.map((c) => c.opts.label);
const SETTINGS = { freeze: "f", plan: "p", checked: "c" };

test("V5A 99 F3 plan-replan: a note stays open across runs until a planner of the plan was given it and the plan was recorded", () => {
  const w = makeWorld();
  assert.equal(planRun(w.root, PD, { run: "wf_a", settings: SETTINGS }).replan, undefined, "no marks: the reply is as before");
  assert.deepEqual(planReplan(w.root, PD, { run: "wf_a", plan: "01-01", by: "revise-01-02-1", change: "add openHostSettingsSection" }).open, ["01-01"]);
  assert.equal(planReplan(w.root, PD, { run: "wf_a", plan: "01-01", by: "revise-01-02-1", change: "add openHostSettingsSection" }).rev, 2, "the same note again writes nothing");
  assert.equal(planReplan(w.root, PD, { run: "wf_a", plan: "x", by: "b", change: "c" }).status, "refused");
  // A recorded mark before any planner was given the note does not close it.
  planMark(w.root, PD, { run: "wf_a", plans: ["01-01"], stage: "recorded" });
  assert.deepEqual(planRun(w.root, PD, { run: "wf_b", settings: SETTINGS }).replan, ["01-01"], "the next run sees the open mark");
  const given = planMark(w.root, PD, { run: "wf_b", plans: ["01-01"], stage: "planned" });
  assert.deepEqual(given.notes, { "01-01": [{ by: "revise-01-02-1", change: "add openHostSettingsSection" }] });
  planMark(w.root, PD, { run: "wf_b", plans: ["01-01"], stage: "recorded" });
  assert.equal(planRun(w.root, PD, { run: "wf_c", settings: SETTINGS }).replan, undefined, "closed once planned with the note and recorded");
});

test("V5A 99 F3 a checker reviser's plan_changes for an already planned plan stop the handoff; the rerun plans only that plan, with the note", async () => {
  const w = makeWorld();
  let checks = 0;
  const overrides = {
    "checker-": () => (checks++ === 0 ? { issues: [{ plan: "01-02", dimension: "key_links", severity: "blocker", required_property: "opens settings", description: "01-02 calls a navigator method no plan writes" }] } : { issues: [], resolved: [{ id: "open-1", evidence: "ok" }] }),
    "revise-01-02": () => ({ marker: "## REVISION COMPLETE", summary: "01-02 calls openHostSettingsSection", plan_changes: [{ plan: "01-01", change: "PaseoNavigator gains void openHostSettingsSection(BuildContext context, {required String serverId})" }, { plan: "01-02", change: "own plan: ignored" }, { plan: "05-01", change: "another phase: ignored" }] }),
  };
  const r = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, { overrides }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plans"], JSON.stringify(r.result));
  assert.deepEqual(r.result.replan, ["01-01"]);
  assert.equal(r.result.answer.verb, "rerun");
  assert.ok(r.logs.some((l) => /plan 01-01 marked for re-planning by revise-01-02-1: PaseoNavigator gains/.test(l)), r.logs.join("\n"));
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 0);
  const again = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, runId: "wf_20261020-130000_cd34", args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, {}) });
  assert.equal(again.result.status, "planned", JSON.stringify(again.result));
  assert.deepEqual(labels(again).filter((l) => l.startsWith("plan-")), ["plan-01-01"], "01-02 kept, 01-01 planned again");
  assert.match(again.calls.find((c) => c.opts.label === "plan-01-01").prompt, /re-plan request of revise-01-02-1: PaseoNavigator gains void openHostSettingsSection/);
});

test("V5A 99 F3 an outline reviser's plan_changes reach that plan's planner in the same run", async () => {
  const w = makeWorld();
  const overrides = {
    "skeleton-L1": () => ({ issues: [{ plan: "01-01", severity: "blocker", target: "outline", required_property: "p", description: "d" }] }),
    "resolve-L1": () => ({ resolved: [{ id: "L1-1", evidence: "fixed" }] }),
    "outline-revise": () => ({ marker: "## REVISION COMPLETE", plan_changes: [{ plan: "01-02", change: "quote the new constructor" }] }),
  };
  const r = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, { overrides }) });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.match(r.calls.find((c) => c.opts.label === "plan-01-02").prompt, /re-plan request of outline-revise-2: quote the new constructor/);
});

// ---- 101 F3 ----
const digest = (text) => `d${[...String(text)].reduce((s, c) => (s * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(16)}`;
// The revisions verbs as the real ones answer them: a record keeps the digest of each part, a check names the parts that changed
// and the recorded hash (inputs, freeze, skeleton, plan:<id>); the other keys stay the world's.
function partedRevisions(w) {
  const f = (name) => `${PD}/01-${name}`;
  const inputs = [f("CONTEXT.md"), f("RESEARCH.md")];
  const freeze = [...inputs, f("PLAN-OUTLINE.md"), f("PLAN-OUTLINE.manifest.json"), f("WIRING.md")];
  const filesOf = (key) => (key === "inputs" ? inputs : key === "freeze" ? freeze : key === "skeleton" ? [f("SKELETON-LANES.json")] : key.startsWith("plan:") ? [...freeze, `${PD}/${key.slice(5)}-PLAN.md`] : null);
  const settingsOf = (args) => (args.includes("--settings") ? args[args.indexOf("--settings") + 1] : null);
  const partsOf = (key, args) => ({ ...Object.fromEntries(filesOf(key).map((p) => [p, digest(w.read(p))])), ...(settingsOf(args) ? { settings: settingsOf(args) } : {}) });
  const store = new Map();
  const orig = { record: w.gsd.handlers["revisions record"], check: w.gsd.handlers["revisions check"], hash: w.gsd.handlers["revisions hash"] };
  w.gsd.on("revisions record", (args, ...rest) => {
    if (!filesOf(args[1])) return orig.record(args, ...rest);
    const parts = partsOf(args[1], args);
    store.set(args[1], { parts, hash: digest(JSON.stringify(parts)) });
    w.recorded.set(args[1], store.get(args[1]).hash);
    w.events.push(`record ${args[1]}`);
    return { key: args[1], hash: store.get(args[1]).hash };
  });
  w.gsd.on("revisions hash", (args, ...rest) => (filesOf(args[1]) ? { hash: digest(JSON.stringify(partsOf(args[1], args))) } : orig.hash(args, ...rest)));
  w.gsd.on("revisions check", (args, ...rest) => {
    if (!filesOf(args[1])) return orig.check(args, ...rest);
    const was = store.get(args[1]);
    if (!was) return { code: 66, json: { status: "never" } };
    const now = partsOf(args[1], args);
    const changed = [...new Set([...Object.keys(was.parts), ...Object.keys(now)])].filter((k) => was.parts[k] !== now[k]).sort();
    return { code: changed.length ? 1 : 0, json: { same: !changed.length, changed, recorded: was.hash } };
  });
  return w;
}
const conflict = { marker: "REVISION_CONFLICT", summary: "the host-index fallback contradicts route_restore_test.dart", conflict: { required_property: "keep the fallback", constraint: "D-01" } };
const plan = (w, args, overrides = {}, runId) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, ...(runId ? { runId } : {}), args: { phaseDir: PD, planReview: false, ...args }, agent: plannerResponder(w, { overrides }) });
const decide = (w, text) => w.write(`${PD}/01-CONTEXT.md`, `${w.read(`${PD}/01-CONTEXT.md`).replace("</decisions>", `- **${text}**\n</decisions>`)}`);

test("V5A 101 F3 a planner's REVISION_CONFLICT about one plan answers with replanPlans; the rerun after the decision plans only that plan", async () => {
  const w = partedRevisions(makeWorld());
  const stop = await plan(w, {}, { "plan-01-02": () => conflict });
  assert.deepEqual([stop.result.status, stop.result.stage], ["needs-owner", "Plan"], JSON.stringify(stop.result));
  const { answer } = stop.result;
  assert.equal(answer.verb, "decide"); // kit feedback 99 F1 (merged with V5B)
  assert.deepEqual(Object.keys(answer.args), ["replanPlans"]);
  assert.deepEqual(answer.args.replanPlans.plans, ["01-02"]);
  assert.match(answer.args.replanPlans.inputs, /^d[0-9a-f]+$/);
  decide(w, "D-02: the fallback redirects; 01-02 owns the test");
  const r = await plan(w, answer.args, {}, "wf_20261020-130000_cd34");
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const ran = labels(r);
  assert.deepEqual(ran.filter((l) => /^(outline|skeleton-|plan-)/.test(l)), ["plan-01-02"], `no outline, no skeleton lane, 01-01 kept: ${ran.join(", ")}`);
  assert.ok(ran.some((l) => l.startsWith("checker-")), "the checker still judges every plan");
  assert.ok(r.logs.some((l) => /replanPlans: the owner's answer to the conflict of 01-02 changed \.planning\/phases\/01-core\/01-CONTEXT\.md; the outline, its review and 01-01 are kept, 01-02 planned again/.test(l)), r.logs.join("\n"));
  // The args apply once: a later decision with the same args file plans as without them.
  decide(w, "D-03: another decision");
  const rewrite = (_p, o) => (o.label === "outline" ? (w.write(`${PD}/01-PLAN-OUTLINE.md`, `${w.read(`${PD}/01-PLAN-OUTLINE.md`)}
<!-- D-03 -->
`), { marker: "## OUTLINE COMPLETE" }) : undefined);
  const later = await plan(w, answer.args, { outline: rewrite }, "wf_20261020-140000_ef56");
  assert.equal(later.result.status, "planned", JSON.stringify(later.result));
  assert.ok(labels(later).includes("outline"), "the outline is written again for the new inputs");
  assert.ok(later.logs.some((l) => /replanPlans not applied: the inputs record is not the one the stop named/.test(l)));
});

test("V5A 101 F3 plan-replan-keep keeps nothing when an outline file, the research or the settings changed, or replanPlans is malformed", async () => {
  const keys = { inputs: ["inputs"], freeze: ["freeze", "--settings", "s"], skeleton: ["skeleton"], "plan:01-01": ["plan:01-01", "--settings", "p"], "plan:01-02": ["plan:01-02", "--settings", "p"] };
  const ctx = `${PD}/01-CONTEXT.md`;
  const ok = { inputs: { code: 1, changed: [ctx], recorded: "H" }, freeze: { code: 1, changed: [ctx] }, skeleton: { code: 0 }, "plan:01-01": { code: 1, changed: [ctx] }, "plan:01-02": { code: 66 } };
  const files = [`${PD}/01-PLAN-OUTLINE.md`, `${PD}/01-PLAN-OUTLINE.manifest.json`, `${PD}/01-WIRING.md`, `${PD}/01-RESEARCH.md`];
  const rp = { plans: ["01-02"], inputs: "H" };
  assert.deepEqual(planReplanKeep(null, { replanPlans: rp, keys, checks: ok, files }).record, [keys.inputs, keys.freeze, keys["plan:01-01"]]);
  for (const [why, checks] of [
    ["outline", { ...ok, freeze: { code: 1, changed: [ctx, `${PD}/01-PLAN-OUTLINE.md`] } }],
    ["research", { ...ok, inputs: { ...ok.inputs, changed: [ctx, `${PD}/01-RESEARCH.md`] } }],
    ["settings", { ...ok, freeze: { code: 1, changed: ["settings"] } }],
    ["skeleton", { ...ok, skeleton: { code: 1, changed: ["x"] } }],
  ]) assert.equal(planReplanKeep(null, { replanPlans: rp, keys, checks, files }).keep, false, why);
  assert.deepEqual(planReplanKeep(null, { replanPlans: rp, keys, checks: { ...ok, "plan:01-01": { code: 1, changed: [ctx, `${PD}/01-01-PLAN.md`] } }, files }).kept, [], "a plan edited since its record is planned again");
  const w = makeWorld();
  const bad = await plan(w, { replanPlans: { plans: ["01-02"] } });
  assert.equal(bad.result.status, "failed");
  assert.match(bad.result.reason, /replanPlans needs \{plans: \[plan ids NN-MM\], inputs/);
  const both = await plan(w, { replan: true, replanPlans: rp });
  assert.match(both.result.reason, /cannot go with replan/);
});
