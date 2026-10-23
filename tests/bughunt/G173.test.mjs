// G173: a trigger record's precision and recall must agree with the requests it summarizes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempProject } from "../helpers/temp.mjs";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { validateTriggerRecord } from "../../ship/.agents/harness/adapter/records.mjs";

// The first `shouldHit` should-trigger requests and the first `nearHit` near misses report triggered: true.
const record = ({ should = 10, near = 10, shouldHit = should, nearHit = 0, precision = 1, recall = 1 } = {}) => ({
  skill: "web-stack", date: "2026-10-20", model: "circle/gpt-6-luna-fast[1m]",
  requests: [...Array(should).fill(0).map((_, i) => ({ text: `do ${i}`, should_trigger: true, triggered: i < shouldHit })),
    ...Array(near).fill(0).map((_, i) => ({ text: `other ${i}`, should_trigger: false, triggered: i < nearHit })),
  ],
  precision, recall,
});

test("G173 a record with perfect scores that its requests contradict fails", () => {
  // Every should-trigger request missed and every near miss fired: precision 0 and recall 0.
  const inverted = validateTriggerRecord(record({ shouldHit: 0, nearHit: 10 }), "web-stack");
  assert.ok(inverted.some((e) => /precision 1 does not match/.test(e)), inverted.join("\n"));
  assert.ok(inverted.some((e) => /recall 1 does not match/.test(e)), inverted.join("\n"));
  // Every should-trigger request fired and 10 near misses fired too: precision 0.5, not 1.
  const falsePositives = validateTriggerRecord(record({ nearHit: 10 }), "web-stack");
  assert.ok(falsePositives.some((e) => /precision 1 does not match/.test(e)), falsePositives.join("\n"));
  assert.deepEqual(falsePositives.filter((e) => /recall/.test(e)), []);
  // A skill that never fires has precision 0 by definition, so a recorded 1 is wrong.
  const neverFires = validateTriggerRecord(record({ shouldHit: 0, precision: 1, recall: 0 }), "web-stack");
  assert.ok(neverFires.some((e) => /precision 1 does not match/.test(e)), neverFires.join("\n"));
});

test("G173 precision and recall derived from the requests pass, with two-decimal rounding", () => {
  assert.deepEqual(validateTriggerRecord(record(), "web-stack"), []);
  assert.deepEqual(validateTriggerRecord(record({ shouldHit: 0, nearHit: 0, precision: 0, recall: 0 }), "web-stack"), []);
  // 7 of 10 should-trigger requests fired and 2 near misses did: precision 7/9 (0.78 when rounded), recall 0.7.
  assert.deepEqual(validateTriggerRecord(record({ shouldHit: 7, nearHit: 2, precision: 0.78, recall: 0.7 }), "web-stack"), []);
  const off = validateTriggerRecord(record({ shouldHit: 7, nearHit: 2, precision: 0.9, recall: 0.7 }), "web-stack");
  assert.ok(off.some((e) => /precision 0\.9 does not match/.test(e)), off.join("\n"));
});

test("G173 precision and recall outside 0 to 1 fail", () => {
  const errs = validateTriggerRecord(record({ precision: 7, recall: -2 }), "web-stack");
  assert.ok(errs.some((e) => /precision 7 is outside \[0, 1\]/.test(e)), errs.join("\n"));
  assert.ok(errs.some((e) => /recall -2 is outside \[0, 1\]/.test(e)), errs.join("\n"));
});

test("G173 lint reports a trigger record whose metrics contradict its requests", () => {
  const history = `# Harness history

| Date | Change | Scope | Reason | Supersedes |
|------|--------|-------|--------|------------|
| 2026-10-20 | Generate skill | .claude/skills/web-stack/SKILL.md | map-codebase done | |
`;
  const p = makeTempProject({
    git: false,
    files: {
      ".claude/skills/web-stack/SKILL.md": "---\nname: web-stack\ndescription: \"Write code in this service.\"\n---\n\n# Web stack\n",
      ".agents/skill-tests/web-stack/triggers.json": JSON.stringify(record({ shouldHit: 0, nearHit: 10 }), null, 2),
      ".agents/harness-history.md": history,
    },
  });
  const { findings } = lintProject(p.root);
  const fails = findings.filter((f) => f.level === "fail" && f.file === ".agents/skill-tests/web-stack/triggers.json").map(findingLine);
  assert.ok(fails.some((l) => /precision 1 does not match/.test(l)), fails.join("\n"));
});
