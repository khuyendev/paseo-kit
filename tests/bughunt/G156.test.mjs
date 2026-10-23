import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertExit, assertLine } from "../helpers/assert.mjs";
import { setup } from "../workflow/helpers.mjs";

const finding = (id, over = {}) => ({ id, severity: "low", trigger: "t", likelihood: "possible", confidence: 50, impact: "", file: "src/a.js", line: 1, description: "d", introduced: true, class: "", instances: [], status: "deferred", verdict: "confirmed", ...over });
const record = (plan, findings, resolution = []) => ({ plan, scope: ["src/a.js"], excluded: [], lenses: ["correctness"], codeOnly: false, findings, resolution });

const WAVE = ".planning/phases/03-core/review/gsd-03-w1-03-01.json";
const GAP = ".planning/phases/03-core/review/gsd-03-gap-w1-03-01.json";
const OLD = finding("F-01", { description: "old: missing null check", file: "src/a.js", line: 3 });
const NEW = finding("F-01", { description: "new: unbounded retry loop on 429", file: "src/b.js", line: 9 });

test("G156 a fate recorded for a finding does not pass to a later finding that reuses its id", async () => {
  const s = setup();
  s.project.writeJson(WAVE, record("03-01", [OLD]));
  assertLine(await s.ph(["review-stats", "outcome", "03-01:F-01", "fixed"]), "outcome 03-01:F-01 fixed");
  assertLine(await s.ph(["review-stats"]), "not blocking 1: settled 1 (fixed 1, not-hold 0, duplicate 0, wont-fix 0), open 0");
  // The same wave runs again and rewrites its record: F-01 is now another defect.
  s.project.writeJson(WAVE, record("03-01", [NEW]));
  const r = await s.ph(["review-stats"]);
  assertExit(r, 0);
  assertLine(r, "not blocking 1: settled 0 (fixed 0, not-hold 0, duplicate 0, wont-fix 0), open 1");
  assertLine(r, /; skipped 1 outcomes of findings no record holds$/);
});

test("G156 a gap wave that repeats a plan id does not count the old fate on its own finding too", async () => {
  const s = setup();
  s.project.writeJson(WAVE, record("03-01", [OLD]));
  assertLine(await s.ph(["review-stats", "outcome", "03-01:F-01", "fixed"]), "outcome 03-01:F-01 fixed");
  s.project.writeJson(GAP, record("03-01", [NEW]));
  const r = await s.ph(["review-stats"]);
  assertLine(r, "not blocking 2: settled 1 (fixed 1, not-hold 0, duplicate 0, wont-fix 0), open 1");
  assertLine(r, "review-stats: 2 review records from .planning/phases/*/review");
});

test("G156 an outcome for a ref held by two different findings goes to the newest record and says so", async () => {
  const s = setup();
  s.project.writeJson(WAVE, record("03-01", [{ ...OLD, likelihood: "possible", verdict: "uncertain" }]));
  s.project.writeJson(GAP, record("03-01", [{ ...NEW, likelihood: "likely", verdict: "uncertain" }]));
  const newest = path.join(s.project.root, GAP);
  const older = path.join(s.project.root, WAVE);
  fs.utimesSync(older, new Date("2026-10-20T10:00:00Z"), new Date("2026-10-20T10:00:00Z"));
  fs.utimesSync(newest, new Date("2026-10-21T10:00:00Z"), new Date("2026-10-21T10:00:00Z"));
  const out = await s.ph(["review-stats", "outcome", "03-01:F-01", "fixed"]);
  assertExit(out, 0);
  assertLine(out, /^outcome 03-01:F-01 fixed \(newest of 2 records with 03-01:F-01: gsd-03-gap-w1-03-01\.json\)$/);
  const r = await s.ph(["review-stats"]);
  assertLine(r, "not blocking 2: settled 1 (fixed 1, not-hold 0, duplicate 0, wont-fix 0), open 1");
  assertLine(r, "likelihood likely: 1 findings, judged real 1, judged false 0");
  assertLine(r, "likelihood possible: 1 findings, judged real 0, judged false 0");
});

test("G156 an outcome line without a fingerprint is unbound: it applies to nothing and is reported", async () => {
  const s = setup();
  s.project.writeJson(WAVE, record("03-01", [OLD]));
  s.project.write("_workspace/review-outcomes.jsonl", `${JSON.stringify({ v: 1, ref: "03-01:F-01", fate: "fixed" })}\n`);
  const r = await s.ph(["review-stats"]);
  assertExit(r, 0);
  assertLine(r, "not blocking 1: settled 0 (fixed 0, not-hold 0, duplicate 0, wont-fix 0), open 1");
  assertLine(r, /; skipped 1 outcomes with no finding fingerprint \(not applied\)$/);
});
