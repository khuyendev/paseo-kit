// Bug-hunt fix G160: a review record with a null or string finding, or a null resolution entry, crashed
// `ph review-stats` (or was miscounted). Such a record is now unreadable: skipped and counted, and its findings
// take no outcome.
import assert from "node:assert/strict";
import test from "node:test";
import { assertErrLine, assertExit, assertLine } from "../helpers/assert.mjs";
import { setup } from "../workflow/helpers.mjs";

const finding = (id, over = {}) => ({ id, severity: "low", trigger: "t", likelihood: "possible", confidence: 50, impact: "", file: "src/a.js", line: 1, description: "d", introduced: true, class: "", instances: [], status: "deferred", verdict: null, ...over });
const record = (plan, findings, resolution = []) => ({ plan, scope: ["src/a.js"], excluded: [], lenses: ["correctness"], codeOnly: false, findings, resolution });
const REVIEW = ".planning/phases/01-test/review";

test("RVST-04 a null finding makes its record unreadable, with or without a resolution, and the report still runs", async () => {
  const s = setup();
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-01.json`, record("01-01", [finding("F-01")]));
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-02.json`, record("01-02", [null]));
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-03.json`, record("01-03", [null], [{ id: "F-01", resolved: true, evidence: "x" }]));
  const r = await s.ph(["review-stats"]);
  assertExit(r, 0);
  assertLine(r, "reviews 1 (phases 1, plans 1), findings 1: critical 0, high 0, medium 0, low 1, info 0");
  assertLine(r, "review-stats: 1 review records from .planning/phases/*/review; skipped 2 unreadable records");
});

test("RVST-04 a string finding makes its record unreadable instead of being counted under an undefined ref", async () => {
  const s = setup();
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-01.json`, record("01-01", [finding("F-01", { severity: "high" })]));
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-02.json`, record("01-02", ["F-01"]));
  const r = await s.ph(["review-stats"]);
  assertExit(r, 0);
  assertLine(r, "reviews 1 (phases 1, plans 1), findings 1: critical 0, high 1, medium 0, low 0, info 0");
  assertLine(r, "review-stats: 1 review records from .planning/phases/*/review; skipped 1 unreadable records");
});

test("RVST-04 a null resolution entry makes its record unreadable", async () => {
  const s = setup();
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-01.json`, record("01-01", [finding("F-01")], [null]));
  const r = await s.ph(["review-stats"]);
  assertExit(r, 0);
  assertLine(r, "review-stats: 0 review records from .planning/phases/*/review; skipped 1 unreadable records");
});

test("RVST-04 outcome records a finding of a readable record and refuses one of a damaged record", async () => {
  const s = setup();
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-01.json`, record("01-01", [finding("F-01")]));
  s.project.writeJson(`${REVIEW}/gsd-01-w1-01-02.json`, record("01-02", [null, finding("F-02")]));
  assertLine(await s.ph(["review-stats", "outcome", "01-01:F-01", "fixed"]), "outcome 01-01:F-01 fixed");
  const refused = await s.ph(["review-stats", "outcome", "01-02:F-02", "fixed"]);
  assertExit(refused, 1);
  assertErrLine(refused, /^usage error: no review finding 01-02:F-02 in \.planning\/phases\/\*\/review/);
  assert.equal(s.project.read("_workspace/review-outcomes.jsonl").trim().split("\n").length, 1);
});
