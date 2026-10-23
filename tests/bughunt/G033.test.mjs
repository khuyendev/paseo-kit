// Bug-hunt fix G033: a plan-review needs-owner stop keeps its conflict, names the owner answer, and the answer reaches
// the next review (gsd-plan reviewGuidance, CONTEXT.md as locked decisions in the finder, verifier, judge and editor).
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const ids = (p) => [...p.matchAll(/"id":"(C[\d-]+)"/g)].map((m) => m[1]);
// Every plan finder reports a high issue; the editor answer is the only thing a test varies.
const reviewers = (editor) => ({
  "find-": () => ({ issues: [{ severity: "high", actionable: true, description: "cites a missing symbol" }] }),
  "verify-": (p) => ({ verdicts: ids(p).map((id) => ({ id, valid: true })) }),
  "judge-": (p) => ({ decisions: ids(p).map((id) => ({ id, keep: true })) }),
  "editor-": editor,
});

test("G033 a plan-review REVISION_CONFLICT stop keeps the conflict and offers the owner answer channel", async () => {
  const w = makeWorld();
  const conflict = { issue: "C1-1-1", options: ["keep the split", "merge the plans"] };
  const r = await plan(w, { planReview: true }, reviewers(() => ({ marker: "REVISION_CONFLICT", conflict })));
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Plan review"]);
  assert.deepEqual(r.result.conflict, conflict);
  assert.ok(r.result.options.some((o) => /reviewGuidance/.test(o)), JSON.stringify(r.result.options));
});

test("G033 the owner's reviewGuidance reaches every plan-review prompt on the rerun, with CONTEXT.md named as locked", async () => {
  const w = makeWorld();
  const guidance = "Keep the two plans separate; D-01 is locked.";
  const r = await plan(w, { planReview: true, reviewGuidance: guidance }, reviewers(() => ({ marker: "REVISION COMPLETE" })));
  const reviewCalls = r.calls.filter((c) => /^(find|verify|judge|editor)-/.test(c.opts.label));
  assert.ok(reviewCalls.some((c) => c.opts.label.startsWith("editor-")), "the editor ran");
  for (const c of reviewCalls) {
    assert.match(c.prompt, /<owner_guidance>\nKeep the two plans separate; D-01 is locked\.\n<\/owner_guidance>/, c.opts.label);
    assert.match(c.prompt, /Locked user decisions: \.planning\/phases\/01-core\/01-CONTEXT\.md/, c.opts.label);
  }
});

test("G033 CONTEXT.md is named as locked decisions in the plan-review prompts even without an owner answer", async () => {
  const w = makeWorld();
  const r = await plan(w, { planReview: true }, reviewers(() => ({ marker: "REVISION COMPLETE" })));
  const reviewCalls = r.calls.filter((c) => /^(find|verify|judge|editor)-/.test(c.opts.label));
  assert.ok(reviewCalls.length >= 4);
  for (const c of reviewCalls) assert.match(c.prompt, /Locked user decisions: \.planning\/phases\/01-core\/01-CONTEXT\.md/, c.opts.label);
  assert.ok(reviewCalls.every((c) => !/<owner_guidance>/.test(c.prompt)), "no owner block without an answer");
});

test("G033 an empty reviewGuidance is refused before any agent runs, in gsd-plan and in the review workflow", async () => {
  const w = makeWorld();
  const r = await plan(w, { planReview: true, reviewGuidance: "   " });
  assert.equal(r.result.status, "failed");
  assert.equal(r.calls.length, 0);
  const direct = await runScript("gsd-plan-review", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, plans: ["01-01"], guidance: 42 } });
  assert.equal(direct.result.status, "failed");
  assert.equal(direct.calls.length, 0);
});
