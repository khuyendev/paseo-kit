import assert from "node:assert/strict";
import test from "node:test";
import { assertExit, assertErrLine, assertLine } from "../helpers/assert.mjs";
import { setup } from "./helpers.mjs";

const finding = (id, over = {}) => ({ id, severity: "low", trigger: "t", likelihood: "possible", confidence: 50, impact: "", file: "src/a.js", line: 1, description: "d", introduced: true, class: "", instances: [], status: "deferred", verdict: null, ...over });
const record = (plan, findings, resolution = []) => ({ plan, scope: ["src/a.js"], excluded: [], lenses: ["correctness"], codeOnly: false, findings, resolution });

// Phase 03 has a gated, confirmed and resolved high, a refuted high and two deferred; phase 04 one pre-existing.
function project() {
  const s = setup();
  s.project.writeJson(".planning/phases/03-core/review/gsd-03-w1-03-01.json", record("03-01", [
    finding("F-01", { severity: "high", status: "gated", verdict: "confirmed", likelihood: "likely", class: "null-deref", instances: [{ file: "src/b.js", line: 2 }] }),
    finding("F-02", { severity: "high", status: "gated", verdict: "refuted", likelihood: "theoretical" }),
    finding("F-03"),
  ], [{ id: "F-01", resolved: true, evidence: "fixed" }]));
  s.project.writeJson(".planning/phases/03-core/review/gsd-03-w1-03-02.json", record("03-02", [finding("F-01", { severity: "medium", likelihood: "likely" })]));
  s.project.writeJson(".planning/phases/04-ui/review/gsd-04-w1-04-01.json", record("04-01", [finding("F-01", { status: "pre-existing" })]));
  s.project.write(".planning/phases/04-ui/review/broken.json", "{ nope");
  return s;
}

test("REVW-01 review-stats reports gate, verifier, resolution, likelihood and classes over every phase", async () => {
  const s = project();
  const r = await s.ph(["review-stats"]);
  assertExit(r, 0);
  assertLine(r, "reviews 3 (phases 2, plans 3), findings 5: critical 0, high 2, medium 1, low 2, info 0");
  assertLine(r, "gate: gated 2, downgraded 0, deferred 2, pre-existing 1");
  assertLine(r, "gated 2: confirmed 1 (50%), refuted 1 (50%), uncertain 0, unverified 0");
  assertLine(r, "confirmed resolved at the resolution check: 1/1 (100%)");
  assertLine(r, "not blocking 3: settled 0 (fixed 0, not-hold 0, duplicate 0, wont-fix 0), open 3");
  assertLine(r, "likelihood likely: 2 findings, judged real 1, judged false 0");
  assertLine(r, "likelihood theoretical: 1 findings, judged real 0, judged false 1");
  assertLine(r, "defect classes: 1 findings name a class, 1 more instances");
  assertLine(r, "phase 03: reviews 2, findings 4, gated 2, confirmed 1");
  assertLine(r, "review-stats: 3 review records from .planning/phases/*/review; skipped 1 unreadable records");
  const one = await s.ph(["review-stats", "--phase", "4"]);
  assertLine(one, "reviews 1 (phases 1, plans 1), findings 1: critical 0, high 0, medium 0, low 1, info 0");
  assert.equal(one.out.some((l) => l.startsWith("phase ")), false);
});

test("REVW-02 outcome records the later fate of a finding; the report counts it, the last fate wins", async () => {
  const s = project();
  assertLine(await s.ph(["review-stats", "outcome", "03-01:F-03", "not-hold", "--note", "by design"]), "outcome 03-01:F-03 not-hold");
  assertLine(await s.ph(["review-stats", "outcome", "03-02:F-01", "wont-fix"]), "outcome 03-02:F-01 wont-fix");
  assertLine(await s.ph(["review-stats", "outcome", "03-02:F-01", "fixed"]), "outcome 03-02:F-01 fixed");
  const lines = s.project.read("_workspace/review-outcomes.jsonl").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { v: 1, at: lines[0].at, ref: "03-01:F-03", fate: "not-hold", note: "by design" });
  const r = await s.ph(["review-stats"]);
  assertLine(r, "not blocking 3: settled 2 (fixed 1, not-hold 1, duplicate 0, wont-fix 0), open 1");
  assertLine(r, "likelihood likely: 2 findings, judged real 2, judged false 0");
  assertLine(r, "likelihood possible: 2 findings, judged real 0, judged false 1");
});

test("REVW-03 outcome refuses an unknown finding or fate; no records report only the summary line", async () => {
  const s = project();
  assertExit(await s.ph(["review-stats", "outcome", "09-01:F-01", "fixed"]), 1);
  assertErrLine(await s.ph(["review-stats", "outcome", "09-01:F-01", "fixed"]), /^usage error: no review finding 09-01:F-01 in \.planning\/phases\/\*\/review/);
  assertExit(await s.ph(["review-stats", "outcome", "03-01:F-03", "maybe"]), 1);
  assertExit(await s.ph(["review-stats", "outcome", "03-01:F-03", "fixed", "--phase", "3"]), 1);
  assertExit(await s.ph(["review-stats", "--note", "x"]), 1);
  s.project.write("_workspace/review-outcomes.jsonl", `${JSON.stringify({ v: 1, ref: "77-01:F-01", fate: "fixed" })}\nnot json\n`);
  assertLine(await s.ph(["review-stats"]), /skipped 1 unreadable records, 1 unreadable outcome lines, 1 outcomes of findings no record holds$/);
  const empty = setup();
  const r = await empty.ph(["review-stats"]);
  assertExit(r, 0);
  assert.deepEqual(r.out, ["review-stats: 0 review records from .planning/phases/*/review"]);
});
