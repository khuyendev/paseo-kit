// Kit feedback 115 (P115). F1: a plan marked after its planner ran is planned again before the checker.
// F2: the checker does not start while plan-progress.json holds an open re-plan mark; the run stops with answer
// rerun only once maxSkeletonPasses is spent. F3: each plan's threat ids are T-<NN>-<plan index>xx, the planner
// and checker prompts quote that range, and a plan that uses an id outside it is a checker probe blocker.
import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { planProbes } from "../../ship/.agents/workflows/lib/flow-plan.mjs";
import { planReplan, planRun } from "../../ship/.agents/workflows/lib/flow-plan-state.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR as PD, plannerResponder, planText } from "../gsd-flows/world.mjs";

const labels = (r) => r.calls.map((c) => c.opts.label);
const planCalls = (r, id) => r.calls.filter((c) => c.opts.label === `plan-${id}`);
const SETTINGS = { freeze: "f", plan: "p", checked: "c" };

const flow = async (root, argv, input) => {
  const lines = [];
  const code = await main(argv, { root, input: JSON.stringify(input), out: (l) => lines.push(l) });
  return { code, json: JSON.parse(lines.at(-1)) };
};

test("P115 115 F1 a planner that marks an earlier plan has it planned again before the checker", async () => {
  const w = makeWorld();
  const overrides = {
    "plan-01-02": () => {
      w.write(`${PD}/01-02-PLAN.md`, planText("01-02", { wave: 2, depends: ["01-01"] }));
      return { marker: "## PLANNING COMPLETE", plan_changes: [{ plan: "01-01", change: "PaseoNavigator gains openHostSettings" }] };
    },
  };
  const r = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, { overrides }) });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const first = planCalls(r, "01-01");
  assert.equal(first.length, 2, `01-01 planned twice, got ${labels(r).join(", ")}`);
  assert.match(first[1].prompt, /re-plan request of plan-01-02: PaseoNavigator gains openHostSettings/);
  const at = (c) => r.calls.indexOf(c);
  const plan02 = r.calls.find((c) => c.opts.label === "plan-01-02");
  const checker = r.calls.find((c) => String(c.opts.label).startsWith("checker-"));
  assert.ok(at(first[0]) < at(plan02) && at(plan02) < at(first[1]) && at(first[1]) < at(checker), labels(r).join(", "));
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 1);
});

test("P115 115 F2 the checker does not start when a re-plan mark is still open after maxSkeletonPasses", async () => {
  const w = makeWorld();
  const write = (id, wave) => w.write(`${PD}/${id}-PLAN.md`, planText(id, { wave }));
  let planned = 0;
  const overrides = {
    "plan-01-01": () => {
      planned += 1;
      write("01-01", 1);
      return planned > 1 ? { marker: "## PLANNING COMPLETE", plan_changes: [{ plan: "01-02", change: "follow the new range" }] } : { marker: "## PLANNING COMPLETE" };
    },
    "plan-01-02": () => {
      write("01-02", 2);
      return { marker: "## PLANNING COMPLETE", plan_changes: [{ plan: "01-01", change: "add the method" }] };
    },
  };
  const r = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false, maxSkeletonPasses: 1 }, agent: plannerResponder(w, { overrides }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plans"], JSON.stringify(r.result));
  assert.equal(r.result.answer.verb, "rerun");
  assert.ok(r.result.replan?.length, JSON.stringify(r.result.replan));
  assert.equal(r.calls.some((c) => String(c.opts.label).startsWith("checker-")), false, labels(r).join(", "));
  assert.equal(w.events.filter((e) => e.startsWith("handoff")).length, 0);
  assert.ok(r.logs.some((l) => /re-planning/.test(l)), r.logs.join("\n"));
});

test("P115 115 F2 plan-replan-drain re-plans while the bound holds and stops only once it is spent", async () => {
  const w = makeWorld();
  const run = "wf_a";
  planRun(w.root, PD, { run, settings: SETTINGS });
  const none = await flow(w.root, ["plan-replan-drain", PD], { run, scope: ["01-01", "01-02"], pass: 1, max: 1 });
  assert.deepEqual(none.json, { status: "ok", act: "clear", open: [] });
  planReplan(w.root, PD, { run, plan: "01-01", by: "plan-01-02", change: "add the method" });
  const again = await flow(w.root, ["plan-replan-drain", PD], { run, scope: ["01-01", "01-02"], pass: 1, max: 1 });
  assert.equal(again.json.act, "replan");
  assert.deepEqual(again.json.open, ["01-01"]);
  const spent = await flow(w.root, ["plan-replan-drain", PD], { run, scope: ["01-01", "01-02"], pass: 2, max: 1 });
  assert.equal(spent.json.act, "stop");
  assert.deepEqual(spent.json.open, ["01-01"]);
  assert.match(spent.json.reason, /01-01/);
  assert.match(spent.json.reason, /bound/);
});

test("P115 115 F3 the planner and checker prompts quote each plan's threat-id range", async () => {
  const w = makeWorld();
  const r = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, {}) });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.match(r.calls.find((c) => c.opts.label === "outline").prompt, /T-NN-MMxx/);
  assert.match(planCalls(r, "01-01")[0].prompt, /T-01-01xx/);
  assert.match(planCalls(r, "01-01")[0].prompt, /T-01-0101/);
  assert.match(planCalls(r, "01-02")[0].prompt, /T-01-02xx/);
  const checker = r.calls.find((c) => String(c.opts.label).startsWith("checker-"));
  assert.match(checker.prompt, /01-01 T-01-01xx/);
  assert.match(checker.prompt, /01-02 T-01-02xx/);
  assert.match(checker.prompt, /threat-id/);
});

test("P115 115 F3 a threat id outside the plan's range is a checker probe blocker, and one inside is not", async () => {
  const threats = (found) => found.filter((f) => f.probe === "threat-id");
  const outside = threats(planProbes(".", { runs: {}, plans: [{ id: "05-01", text: "Threat T-05-806 covers the host.\nAlso T-05-0101 is this plan's.\n" }, { id: "05-02", text: "T-05-0201 only.\n" }] }).found);
  assert.equal(outside.length, 1);
  assert.equal(outside[0].plan, "05-01");
  assert.equal(outside[0].severity, "blocker");
  assert.match(outside[0].description, /T-05-806/);
  assert.match(outside[0].description, /T-05-01xx/);
  assert.equal(outside[0].description.includes("T-05-0101"), false);
  const wide = threats(planProbes(".", { runs: {}, plans: [{ id: "05-10", text: "T-05-1000\n" }, { id: "05-100", text: "T-05-10000\n" }] }).found);
  assert.deepEqual(wide, [], "05-10's T-05-1000 and 05-100's T-05-10000 do not collide");
});

test("P115 115 F3 the checker revises a plan that used another plan's threat id", async () => {
  const w = makeWorld();
  const overrides = {
    "plan-01-01": () => {
      w.write(`${PD}/01-01-PLAN.md`, `${planText("01-01")}\nThreat T-01-999 covers the host.\n`);
      return { marker: "## PLANNING COMPLETE" };
    },
    "revise-01-01": () => {
      w.write(`${PD}/01-01-PLAN.md`, planText("01-01"));
      return { marker: "## REVISION COMPLETE" };
    },
  };
  const r = await runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, planReview: false }, agent: plannerResponder(w, { overrides }) });
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const revise = r.calls.find((c) => String(c.opts.label).startsWith("revise-01-01"));
  assert.ok(revise, labels(r).join(", "));
  assert.match(revise.prompt, /T-01-999/);
  assert.match(revise.prompt, /T-01-01xx/);
});
