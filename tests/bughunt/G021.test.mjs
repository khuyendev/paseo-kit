// Bug-hunt fix G021: the planner's owner-marker proposal (summary, plans) reaches the needs-owner result of gsd-plan.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const SPLIT_PLANS = ["01-01: auth endpoints", "01-02: login screen"];

test("G021 a PHASE SPLIT stop keeps the planner's summary and proposed plans next to the question", async () => {
  const r = await plan(makeWorld(), {}, { outline: () => ({ marker: "## PHASE SPLIT RECOMMENDED", summary: "two phases fit the budget", question: "split into two phases?", plans: SPLIT_PLANS }) });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.question, "split into two phases?");
  assert.equal(r.result.summary, "two phases fit the budget");
  assert.deepEqual(r.result.plans, SPLIT_PLANS);
});

test("G021 a SOURCE AUDIT stop with only a summary keeps the summary and the audit plans", async () => {
  const r = await plan(makeWorld(), {}, { outline: () => ({ marker: "## SOURCE AUDIT", summary: "R-2 has no plan", plans: ["add a plan for R-2", "defer R-2"] }) });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.question, "R-2 has no plan");
  assert.equal(r.result.summary, "R-2 has no plan");
  assert.deepEqual(r.result.plans, ["add a plan for R-2", "defer R-2"]);
});

test("G021 the planner is told that owner markers carry their proposal in plans", async () => {
  const r = await plan(makeWorld());
  const outline = r.calls.find((c) => c.opts.label === "outline");
  assert.match(outline.prompt, /PHASE SPLIT RECOMMENDED[^\n]*plans/);
  assert.match(outline.opts.schema.properties.plans.description, /PHASE SPLIT RECOMMENDED/);
});
