// Kit feedback #55: a fixer that stops unresolved says whether its last edit was run through the build and tests. Its
// prompt asks for one more run of an edit made past the cap, and the needs-owner stop carries "last edit unverified"
// when no run followed that edit, so the owner runs the failing tests before a hand fix.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const exec = (w, args = {}, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
const finding = (id) => ({ id, severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 1, description: `finding ${id}` });
const unresolvedFixer = (lastEdit) => ({ "review-": () => ({ findings: [finding("F1")] }), "fix-review": () => ({ status: "unresolved", attempts: 3, remaining_failures: 1, evidence: "test red", ...(lastEdit === undefined ? {} : { lastEdit }) }) });

test("F55 the fixer prompt asks for one more build and test run after an edit made past the cap, and returns lastEdit", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { fixer_verifies_itself: true } } });
  const r = await exec(w, {}, { "review-": () => ({ findings: [finding("F1")] }) });
  const fx = r.calls.find((c) => c.opts.label === "fix-review-w1");
  assert.match(fx.prompt, /If you edit after your last run, run the build and the tests once more on that edit before you answer, even past those limits/);
  assert.match(fx.prompt, /lastEdit is verified \(a build and test run followed your last edit\), unverified \(none did\) or none \(you made no edit\)/);
});

test("F55 an unresolved fixer whose last edit no run followed stops needs-owner with last edit unverified", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w, {}, unresolvedFixer("unverified"));
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Fix");
  assert.match(r.result.reason, /^fixer unresolved: 1 failures remain; last edit unverified: run the failing tests before a hand fix$/);
  assert.equal(r.result.lastEdit, "unverified");
  assert.equal(r.result.evidence, "test red");
});

test("F55 an unresolved fixer whose last edit a run followed does not claim it is unverified", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w, {}, unresolvedFixer("verified"));
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.reason, "fixer unresolved: 1 failures remain");
  assert.equal(r.result.lastEdit, "verified");
});

test("F55 an unresolved fixer that does not say what happened to its last edit counts as unverified", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w, {}, unresolvedFixer());
  assert.match(r.result.reason, /last edit unverified/);
  assert.equal(r.result.lastEdit, "unverified");
});
