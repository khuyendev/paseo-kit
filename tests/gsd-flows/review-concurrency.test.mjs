// gsd.code_review (owner decision 2026-10-22, "tùy dự án mà chủ quyết định"): plans reviewed at once and independent
// reviewers with their own model. The kit default keeps one reviewer, one plan after another.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "./host.mjs";
import { executor, makeExecWorld, task } from "./exec-world.mjs";
import { PHASE_DIR } from "./world.mjs";

const PLANS = ["01-01", "01-02", "01-03"];
const exec = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });
const world = (codeReview) => makeExecWorld({ waves: [PLANS.map((id) => task(id))], overlay: codeReview ? { gsd: { code_review: codeReview } } : {} });
const high = (id) => ({ id, severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 1, description: `finding ${id}` });

// Counts how many review calls run at the same time; each review waits a few ticks so overlaps can happen.
function overlapProbe() {
  const probe = { running: 0, peak: 0 };
  probe.review = async () => {
    probe.running++;
    probe.peak = Math.max(probe.peak, probe.running);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    probe.running--;
    return { findings: [] };
  };
  return probe;
}

test("REVW-07 the kit default reviews one plan at a time with one reviewer", async () => {
  const w = world();
  const probe = overlapProbe();
  const r = await exec(w, { "review-": probe.review });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(probe.peak, 1);
  assert.deepEqual(r.calls.filter((c) => c.opts.label.startsWith("review-")).map((c) => c.opts.label), PLANS.map((id) => `review-${id}`));
});

test("REVW-07 code_review.max_concurrent reviews plans at once; every record and the REVIEW.md table are kept", async () => {
  const w = world({ max_concurrent: 3, reviewers: [] });
  const probe = overlapProbe();
  const r = await exec(w, { "review-": probe.review });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(probe.peak, 3);
  for (const id of PLANS) assert.notEqual(w.read(`${PHASE_DIR}/review/w1-${id}.json`), "", id);
  const md = w.read(`${PHASE_DIR}/01-REVIEW.md`);
  for (const id of PLANS) assert.match(md, new RegExp(`## w1-${id}`));
});

test("REVW-08 code_review.reviewers adds independent reviewers with their own model; findings stay apart", async () => {
  const w = world({ max_concurrent: 1, reviewers: [{ model: "pro" }, { model: "circle/other-model", effort: "low" }] });
  const r = await exec(w, {
    "review-01-01": (prompt, o) => ({ findings: o.label === "review-01-01" ? [high("F-01")] : o.label === "review-01-01-r2" ? [high("F-01"), { ...high("F-02"), severity: "low" }] : [] }),
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const reviews = r.calls.filter((c) => c.opts.label.startsWith("review-01-01"));
  assert.deepEqual(reviews.map((c) => [c.opts.label, c.opts.model ?? null, c.opts.effort ?? null]), [["review-01-01", "pro", null], ["review-01-01-r2", "circle/other-model", "low"]]);
  const rec = JSON.parse(w.read(`${PHASE_DIR}/review/w1-01-01.json`));
  assert.deepEqual(rec.findings.map((f) => [f.id, f.status]), [["F-01", "gated"], ["R2-F-01", "gated"], ["R2-F-02", "deferred"]]);
  assert.match(w.read(`${PHASE_DIR}/deferred.md`), /^- R2-F-02 \(low, deferred\) plan 01-01/m);
});

test("REVW-08 one reviewer of several that returns nothing stops the review and names that reviewer", async () => {
  const w = world({ max_concurrent: 1, reviewers: [{}, { model: "pro" }] });
  const r = await exec(w, { "review-01-01-r2": () => ({ __null: "schema mismatch" }) });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Review");
  assert.match(r.result.reason, /^reviewer 2 of 01-01 returned nothing \(schema mismatch\)/);
  assert.equal(r.calls.some((c) => c.opts.label === "review-01-02"), false, "no later plan is reviewed after the stop");
});
