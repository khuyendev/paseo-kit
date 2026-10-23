// Kit feedback #67 F2 F3 and #76 F1 (P67), the gsd-plan flow on the fake host: the contract gate after planners, checker and plan
// review and at handoff, its failures routed to the named plans outside the checker cap, CONTRACT_CHANGE through the manifest's
// one writer, the contract block of revisers, and the gsd.contract_check switch.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, plannerResponder } from "../gsd-flows/world.mjs";

const ROWS = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
const planPath = (id) => `${PD}/${id}-PLAN.md`;
const labels = (r) => r.calls.map((c) => c.opts.label);
const call = (r, label) => r.calls.find((c) => c.opts.label === label);
const SIG = "Future<void> pause()";
const SHOW = {
  "01-01": { plan: "01-01", produces: [{ symbol: "DaemonClient.pause", kind: "method", file: "src/a.js", signature: SIG, structured: true }], consumes: [], consumers: { "DaemonClient.pause": ["01-02"] } },
  "01-02": { plan: "01-02", produces: [], consumes: [{ plan: "01-01", symbol: "DaemonClient.pause", entry: { symbol: "DaemonClient.pause", kind: "method", file: "src/a.js", signature: SIG } }], consumers: {} },
};
const issue = (over = {}) => ({ plan: "01-02", plans: ["01-02", "01-01"], kind: "consumer-signature", symbol: "DaemonClient.pause", message: `01-02 uses DaemonClient.pause of 01-01 without quoting its signature: ${SIG}`, fix_hint: "quote it", ...over });
const world = (overlay) => {
  const w = makeWorld({ overlay: overlay ?? undefined });
  w.gsd.on("contracts show", ([, , id]) => (SHOW[id] ? SHOW[id] : { code: 66, json: { status: "missing" } }));
  return w;
};
const plan = (w, args, overrides) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, ...args }, agent: plannerResponder(w, { rows: ROWS, overrides }) });
const verifyCalls = (w) => w.gsd.callsOf("verify contracts");

test("P67 F3 a failed contract check is an issue for each named plan, revised outside the checker cap, then the check runs again", async () => {
  const w = world();
  let fixed = false;
  // Like the verb, it names only plans that are written.
  w.gsd.on("verify contracts", () => (fixed || !w.read(planPath("01-02")) ? { passed: true, errors: [], warnings: [] } : { code: 1, json: { passed: false, errors: [issue()], warnings: [] } }));
  const r = await plan(w, { planReview: false }, { "contract-01-02": () => { fixed = true; return { marker: "## REVISION COMPLETE" }; } });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const revise = call(r, "contract-01-02-1");
  assert.equal(revise.opts.session, "planner:01-02");
  assert.match(revise.prompt, /"dimension":"contract","severity":"blocker","required_property":"consumer-signature DaemonClient\.pause"/);
  assert.match(revise.prompt, /"related_plans":\["01-01"\]/);
  assert.match(revise.prompt, /<contract_context>[\s\S]*01-02 consumes \(producer manifest entries to quote\): \[\{"plan":"01-01","symbol":"DaemonClient\.pause","kind":"method","file":"src\/a\.js","signature":"Future<void> pause\(\)"\}\]/);
  assert.equal(labels(r).filter((l) => /^(revise|checker)-/.test(l)).length, 1, "one checker pass and no checker revision: the contract rounds are not the checker's");
  assert.equal(w.recorded.has("plan:01-02"), true);
  assert.deepEqual([r.result.contracts.rounds, r.result.contracts.issues], [1, 1]);
  assert.equal(r.result.contracts.changes.length, 0);
});

test("P67 F3 the gate runs after each planner wave, after the checker and at handoff with --complete, before the handoff verb", async () => {
  const w = world();
  w.gsd.on("verify contracts", () => ({ passed: true, errors: [], warnings: [] }));
  const r = await plan(w, { planReview: true }, { "find-": () => ({ issues: [] }) });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const argvs = verifyCalls(w).map((c) => c.argv.slice(2).join(" "));
  // wave 1, wave 2, after the checker, after the plan review, at handoff
  assert.deepEqual(argvs, ["01", "01", "01", "01", "01 --complete"]);
  const order = w.gsd.calls.map((c) => c.key);
  assert.ok(order.lastIndexOf("verify contracts") < order.indexOf("handoff"), "the handoff verb comes after the last contract check");
  assert.equal(r.result.contracts.checks, 5);
});

test("P67 F3 a contract issue that does not fall stops needs-owner at Contracts with the issues, and nothing is handed off", async () => {
  const w = world();
  w.gsd.on("verify contracts", () => (w.read(planPath("01-02")) ? { code: 1, json: { passed: false, errors: [issue()], warnings: [] } } : { passed: true, errors: [], warnings: [] }));
  const r = await plan(w, { planReview: false }, {});
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Contracts"], JSON.stringify(r.result));
  assert.match(r.result.reason, /contract issues not falling: 1, was 1/);
  assert.equal(r.result.issues[0].kind, "consumer-signature");
  assert.deepEqual(labels(r).filter((l) => l.startsWith("contract-")).sort(), ["contract-01-01-1", "contract-01-02-1"], "both named plans got the issue once");
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 0);
});

test("P67 F3 a manifest plan with no plan file at handoff stops needs-owner; an unreadable verb result fails the run", async () => {
  const w = world();
  w.gsd.on("verify contracts", ([, flag]) => (flag === "--complete" ? { code: 1, json: { passed: false, errors: [issue({ plan: "01-02", plans: ["01-02"], kind: "plan-missing", message: "01-02 is in the manifest but has no plan file" })], warnings: [] } } : { passed: true, errors: [], warnings: [] }));
  const r = await plan(w, { planReview: false }, {});
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Contracts"]);
  assert.match(r.result.reason, /01-02 in the manifest but not planned/);
  const bad = world();
  bad.gsd.on("verify contracts", () => ({ code: 69, json: { status: "unavailable", error: "manifest is not valid JSON" } }));
  const f = await plan(bad, { planReview: false }, {});
  assert.equal(f.result.status, "failed");
  assert.match(f.result.reason, /contract check: manifest is not valid JSON/);
});

test("P67 F2 a reviser's CONTRACT_CHANGE goes to the manifest's writer, and the consumers are revised in the same checker iteration", async () => {
  const w = world();
  let changed = false;
  let consumerFixed = false;
  const changes = [];
  w.gsd.on("contracts change", (_a, input) => { changes.push(JSON.parse(input)); changed = true; return { changed: true, plan: "01-01", symbol: "DaemonClient.pause", old: SIG, signature: "Future<void> pause(Duration d)", consumers: ["01-02"] }; });
  w.gsd.on("verify contracts", () => (changed && !consumerFixed && w.read(planPath("01-02")) ? { code: 1, json: { passed: false, errors: [issue({ kind: "stale-signature" })], warnings: [] } } : { passed: true, errors: [], warnings: [] }));
  let checks = 0;
  const r = await plan(w, { planReview: false }, {
    "checker-": () => (checks++ === 0 ? { issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "pause takes a timeout", description: "pause has no timeout" }] } : { issues: [], resolved: [{ id: "open-1", evidence: "ok" }] }),
    "revise-01-01": () => ({ marker: "CONTRACT_CHANGE", summary: "pause takes a timeout", contract_changes: [{ symbol: "DaemonClient.pause", old: SIG, new: "Future<void> pause(Duration d)", reason: "pause needs a timeout" }] }),
    "contract-01-02": () => { consumerFixed = true; },
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(changes, [{ plan: "01-01", symbol: "DaemonClient.pause", old: SIG, new: "Future<void> pause(Duration d)", reason: "pause needs a timeout" }], "the plan defaults to the revised plan");
  assert.deepEqual(r.result.contracts.changes, [{ plan: "01-01", symbol: "DaemonClient.pause", old: SIG, new: "Future<void> pause(Duration d)", reason: "pause needs a timeout", consumers: ["01-02"] }]);
  const order = labels(r);
  assert.ok(order.indexOf("revise-01-01-1") < order.indexOf("contract-01-02-1"));
  assert.ok(order.indexOf("contract-01-02-1") < order.indexOf("checker-2"), "the consumer was revised before the checker read the plans again");
  assert.match(call(r, "revise-01-01-1").prompt, /return marker CONTRACT_CHANGE with contract_changes/);
  assert.match(call(r, "revise-01-01-1").prompt, /01-01 consumers per produced symbol: \{"DaemonClient\.pause":\["01-02"\]\}/);
});

test("P67 F2 a CONTRACT_CHANGE the manifest refuses, or a CONTRACT_CHANGE marker with no entry, stops needs-owner as a conflict", async () => {
  const w = world();
  w.gsd.on("contracts change", () => ({ code: 1, json: { status: "error", error: "CONTRACT_CHANGE rejected: the manifest signature of DaemonClient.pause is Future<void> pause(), not stop()" } }));
  const checker = { "checker-": () => ({ issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "p", description: "d" }] }) };
  const r = await plan(w, { planReview: false }, { ...checker, "revise-01-01": () => ({ marker: "CONTRACT_CHANGE", contract_changes: [{ symbol: "DaemonClient.pause", old: "stop()", new: "x", reason: "r" }] }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Checker"], JSON.stringify(r.result));
  assert.match(r.result.conflict.rejected, /CONTRACT_CHANGE of DaemonClient\.pause rejected: CONTRACT_CHANGE rejected: the manifest signature/);
  const empty = world();
  const e = await plan(empty, { planReview: false }, { ...checker, "revise-01-01": () => ({ marker: "CONTRACT_CHANGE" }) });
  assert.equal(e.result.status, "needs-owner");
  assert.match(e.result.conflict.rejected, /marker CONTRACT_CHANGE without a contract_changes entry/);
  assert.equal(empty.gsd.callsOf("contracts").filter((c) => c.argv[1] === "change").length, 0);
});

test("P67 F1 the planner is told to write produced signatures verbatim and quote consumed ones; a checker reviser sees its manifest entry", async () => {
  const w = world();
  const r = await plan(w, { planReview: false }, {});
  assert.equal(r.result.status, "planned");
  assert.match(call(r, "plan-01-01").prompt, /Contract: this plan produces \(write each signature verbatim in the plan and in <interfaces>; never re-describe or change it\): \[\{"symbol":"DaemonClient\.pause"/);
  assert.match(call(r, "plan-01-02").prompt, /Contract: this plan consumes \(quote each signature verbatim in <interfaces>/);
  assert.match(call(r, "plan-01-02").prompt, /requires: \{kind: ancestor_widget\|provider_override\|registration/);
  assert.match(call(r, "outline").prompt, /`produces` lists every symbol another plan calls or builds on as \{symbol, kind, file, signature\}/);
});

test("P67 gsd.contract_check false: no contract call, no contract text in any prompt, no contracts in the result", async () => {
  const w = world({ gsd: { contract_check: false } });
  let checks = 0;
  const r = await plan(w, { planReview: false }, {
    "checker-": () => (checks++ === 0 ? { issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "p", description: "d" }] } : { issues: [], resolved: [{ id: "open-1", evidence: "ok" }] }),
    "revise-01-01": () => ({ marker: "CONTRACT_CHANGE", contract_changes: [{ symbol: "S", old: "a", new: "b", reason: "r" }] }),
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.equal(verifyCalls(w).length, 0);
  assert.equal(w.gsd.callsOf("contracts").length, 0);
  assert.equal("contracts" in r.result, false);
  for (const c of r.calls) assert.doesNotMatch(c.prompt, /contract_context|Contract: this plan|CONTRACT_CHANGE|`produces` lists every symbol/, c.opts.label);
});

test("P67 streams: the gate runs at each wave's join, after its review streams froze and before the next wave is planned", async () => {
  const w = world({ gsd: { plan_flow: "streams" } });
  const order = [];
  w.gsd.on("verify contracts", (argv) => { order.push(`verify ${argv.join(" ")}`); return { passed: true, errors: [], warnings: [] }; });
  const r = await plan(w, { planReview: true }, {
    "plan-": (_p, o) => { order.push(o.label); },
    "find-": (_p, o) => { order.push(o.label); return { issues: [] }; },
  });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const at = (s) => order.findIndex((x) => x === s || x.startsWith(s));
  assert.ok(at("find-01-01") < at("verify 01"), "wave 1's review stream finished before the gate");
  assert.ok(at("verify 01") < at("plan-01-02"), "the gate ran before the wave-2 planner");
  assert.equal(order.at(-1), "verify 01 --complete");
});
