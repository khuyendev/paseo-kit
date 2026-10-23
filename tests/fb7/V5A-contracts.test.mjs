// Kit feedback #100 and #98 F3 (V5A): a contract issue goes to the plan whose planner can fix it (F1); a reviser's REVISION_CONFLICT
// is acted on only after the contract check ran again, and dropped when its issue is gone (F2, F3); a planner conflict that carries
// its own contract_changes is answered with `ph gsd contracts change` first (98 F3). Verb tests run the real verbs on a temp
// project; the flow tests drive gsd-plan on the fake host.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan as planFile, project } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, plannerResponder } from "../gsd-flows/world.mjs";
import { fixPlans } from "../../ship/.agents/harness/gsd/contracts.mjs";
import { planContractRoute } from "../../ship/.agents/workflows/lib/flow-plan.mjs";

const SIG = "Future<void> pause()";
const OUTLINE = `# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n| CORE-01 | \`01-01\` | 1 | do | none |\n| CORE-02 | \`01-02\` | 2 | do | 01-01 |\n\n## OUTLINE COMPLETE\n`;
const MANIFEST = { phase: "01", plans: [
  { id: "01-01", owns: ["Path:src/a.js"], requirements: ["CORE-01"], produces: [{ symbol: "DaemonClient.pause", kind: "method", file: "src/a.js", signature: SIG }], consumes: [], tracer: { is: false }, verify: [] },
  { id: "01-02", owns: ["Path:src/b.js"], requirements: ["CORE-02"], produces: [], consumes: [{ plan: "01-01", symbol: "DaemonClient.pause" }], tracer: { is: false }, verify: [] },
] };
const ifaces = (text) => `\n<interfaces>\n${text}\n</interfaces>\n`;

test("V5A 100 F1 verify contracts names the fixing plan of each error: a missing consumed quotation is the consumer's alone", async () => {
  const p = project({ files: {
    [`${P1}/01-PLAN-OUTLINE.md`]: OUTLINE, [`${P1}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify(MANIFEST),
    [`${P1}/01-01-PLAN.md`]: planFile({}) + ifaces(SIG),
    [`${P1}/01-02-PLAN.md`]: planFile({ id: "02", wave: 2, depends: "[01-01]", reqs: "[CORE-02]", files: "[src/b.js]", owns: '["Path:src/b.js"]' }) + ifaces("calls client.pause()"),
  } });
  const r = await gsd(p, ["verify", "contracts", "1"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  const [e] = r.json.errors;
  assert.deepEqual([e.kind, e.plans, e.fixers], ["consumer-signature", ["01-02", "01-01"], ["01-02"]]);
});

test("V5A 100 F1 the fixing side per error kind; the route verb sends each issue there and keeps the gate's stop rule", () => {
  assert.deepEqual(fixPlans({ kind: "consumer-signature", plans: ["04-09", "04-02"] }), ["04-09"]);
  assert.deepEqual(fixPlans({ kind: "stale-signature", plans: ["04-11", "04-03"] }), ["04-11"]);
  assert.deepEqual(fixPlans({ kind: "requires-unprovided", plans: ["04-04", "04-01"] }), ["04-01"], "the provider the requirer names");
  assert.deepEqual(fixPlans({ kind: "requires-unprovided", plans: ["04-04"] }), ["04-04"]);
  assert.deepEqual(fixPlans({ kind: "requires-later-wave", plans: ["04-04", "04-08"] }), ["04-04", "04-08"], "either side can move");
  assert.deepEqual(fixPlans({ kind: "edge-unresolved", plans: ["04-02", "04-01"] }), ["04-02", "04-01"]);
  const errors = [
    { plan: "04-09", plans: ["04-09", "04-02"], kind: "consumer-signature", symbol: "SurfaceActivity", message: "m1", fix_hint: "quote it" },
    { plan: "04-04", plans: ["04-04", "04-01"], kind: "requires-unprovided", message: "m2", fixers: ["04-01"] },
  ];
  const r = planContractRoute(null, { errors, planIds: ["04-01", "04-02", "04-04", "04-09"], round: 1, prev: null, cap: 2 });
  assert.deepEqual(r.byPlan.map(([id]) => id), ["04-09", "04-01"]);
  assert.deepEqual(r.byPlan[0][1], [{ plan: "04-09", dimension: "contract", severity: "blocker", required_property: "consumer-signature SurfaceActivity", description: "m1", fix_hint: "quote it", related_plans: ["04-02"] }]);
  assert.equal(r.stop, null);
  assert.match(planContractRoute(null, { errors, planIds: ["04-09"], round: 2, prev: 2, cap: 2 }).stop, /contract issues not falling: 2, was 2/);
  assert.match(planContractRoute(null, { errors, planIds: ["04-09"], round: 3, prev: 5, cap: 2 }).stop, /2 contract issues left after 2 revisions/);
  // A conflict stands while the check still routes an issue to its plan.
  assert.deepEqual(planContractRoute(null, { errors, planIds: ["04-01", "04-02", "04-04", "04-09"], conflicts: ["04-02", "04-09"] }), { ...r, standing: ["04-09"], dropped: ["04-02"] });
});

// ---- the flow ----
const ROWS = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
const labels = (r) => r.calls.map((c) => c.opts.label);
const issue = (over = {}) => ({ plan: "01-02", plans: ["01-02", "01-01"], kind: "requires-later-wave", message: "01-02 (wave 2) requires provider override x, provided only by 01-01 (wave 3)", fix_hint: "move it", ...over });
const run = (w, overrides, args = {}) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false, ...args }, agent: plannerResponder(w, { rows: ROWS, overrides }) });

test("V5A 100 F1 a consumer-side issue naming both plans is revised by the consumer only, and the run is planned", async () => {
  const w = makeWorld();
  let fixed = false;
  w.gsd.on("verify contracts", () => (fixed || !w.read(`${PD}/01-02-PLAN.md`) ? { passed: true, errors: [], warnings: [] } : { code: 1, json: { passed: false, errors: [issue({ kind: "consumer-signature", message: `01-02 uses DaemonClient.pause of 01-01 without quoting its signature: ${SIG}` })], warnings: [] } }));
  const r = await run(w, { "contract-01-02": () => { fixed = true; } });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(labels(r).filter((l) => l.startsWith("contract-")), ["contract-01-02-1"]);
});

test("V5A 100 F2 F3 a reviser's REVISION_CONFLICT whose issue the other plan fixed is dropped after the re-check, and the run goes on", async () => {
  const w = makeWorld();
  let fixed = false;
  w.gsd.on("verify contracts", () => (fixed || !w.read(`${PD}/01-02-PLAN.md`) ? { passed: true, errors: [], warnings: [] } : { code: 1, json: { passed: false, errors: [issue()], warnings: [] } }));
  const r = await run(w, {
    "contract-01-01": () => { fixed = true; },
    "contract-01-02": () => ({ marker: "REVISION_CONFLICT", summary: "this worker may revise only 01-02-PLAN.md", conflict: { constraint: "may revise only 01-02-PLAN.md" } }),
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(labels(r).filter((l) => l.startsWith("contract-")).sort(), ["contract-01-01-1", "contract-01-02-1"]);
  assert.ok(r.logs.some((l) => /REVISION_CONFLICT of 01-02 dropped: the check after round 1 routes no issue to it/.test(l)), r.logs.join("\n"));
  assert.equal(w.recorded.has("plan:01-02"), true, "the dropped conflict's plan is recorded like an answered revision");
});

test("V5A 100 F2 a REVISION_CONFLICT whose issue is still there after the re-check stops at Contracts; another owner marker stops at once", async () => {
  const w = makeWorld();
  w.gsd.on("verify contracts", () => (w.read(`${PD}/01-02-PLAN.md`) ? { code: 1, json: { passed: false, errors: [issue({ kind: "consumer-signature", message: "01-02 does not quote it" })], warnings: [] } } : { passed: true, errors: [], warnings: [] }));
  const conflict = { marker: "REVISION_CONFLICT", summary: "the quoted signature contradicts D-01", conflict: { required_property: "quote it" } };
  const r = await run(w, { "contract-01-02": () => conflict });
  assert.deepEqual([r.result.status, r.result.stage, r.result.marker], ["needs-owner", "Contracts", "REVISION_CONFLICT"], JSON.stringify(r.result));
  assert.equal(w.gsd.callsOf("verify contracts").length, 3, "wave 1, wave 2 and the re-check after the round");
  const audit = makeWorld();
  audit.gsd.on("verify contracts", () => (audit.read(`${PD}/01-02-PLAN.md`) ? { code: 1, json: { passed: false, errors: [issue()], warnings: [] } } : { passed: true, errors: [], warnings: [] }));
  const a = await run(audit, { "contract-01-01": () => ({ marker: "SOURCE AUDIT", summary: "which source?", plans: ["a", "b"] }) });
  assert.deepEqual([a.result.stage, a.result.marker], ["Contracts", "SOURCE AUDIT"]);
  assert.equal(audit.gsd.callsOf("verify contracts").length, 2, "no re-check before a non-conflict owner marker stops");
});

test("V5A 98 F3 a planner's REVISION_CONFLICT that carries contract_changes is answered with ph gsd contracts change first", async () => {
  const w = makeWorld();
  const change = { plan: "01-01", symbol: "SheetTab", old: "const SheetTab({required this.target})", new: "const SheetTab({required this.origin, required this.target})", reason: "sheets keep their workspace" };
  const r = await run(w, { "plan-01-02": () => ({ marker: "REVISION_CONFLICT", summary: "the contract requires the old constructor", conflict: { constraint: "verbatim" }, contract_changes: [change, { symbol: "promote", old: "a()", new: "b()", reason: "r" }] }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plan"], JSON.stringify(r.result));
  const { answer } = r.result;
  assert.equal(answer.verb, "contracts-change");
  assert.deepEqual(answer.changes, [change, { plan: "01-02", symbol: "promote", old: "a()", new: "b()", reason: "r" }], "a change without a plan is the conflicting planner's own");
  assert.match(answer.command, /ph\.mjs gsd contracts change 01 \(stdin JSON \{plan, symbol, old, new, reason\}/);
  assert.match(answer.command, /gsd-plan --args-file/);
  assert.ok(r.result.options.some((o) => /CONTEXT/.test(o)), "the CONTEXT decision stays an option");
  // A change the manifest refused is no proposal to apply again: the answer stays a decision.
  const refused = makeWorld();
  refused.gsd.on("contracts change", () => ({ code: 1, json: { error: "CONTRACT_CHANGE rejected: old differs" } }));
  let checks = 0;
  const f = await run(refused, {
    "checker-": () => (checks++ === 0 ? { issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "p", description: "d" }] } : { issues: [] }),
    "revise-01-01": () => ({ marker: "CONTRACT_CHANGE", contract_changes: [change] }),
  });
  assert.equal(f.result.stage, "Checker", JSON.stringify(f.result));
  assert.equal(f.result.answer.verb, "decide"); // kit feedback 99 F1 (merged with V5B): an owner answer is a decide record, not a CONTEXT edit
});
