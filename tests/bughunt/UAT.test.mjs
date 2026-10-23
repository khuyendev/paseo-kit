// Bug-hunt regression for G099: `phase uat-passed` follows upstream GSD (elaboration.md § 4). A phase passes when at least
// one test passed and no row is pending or blocked, no skipped row lacks a reason, and every issue is a verified gap
// resolution: each ## Gaps entry for it is resolved by an executed plan in the phase directory with its SUMMARY.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan, project, summary } from "../gsd-core/fixture.mjs";

const uatProject = (text, files = {}) => project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), [`${P1}/01-UAT.md`]: text, ...files } });
const closure = { [`${P1}/01-02-PLAN.md`]: plan({ id: "02" }), [`${P1}/01-02-SUMMARY.md`]: summary("02") };
const row = (n, name, result, extra = "") => `### ${n}. ${name}\nexpected: ${name} works\nresult: ${result}\n${extra}\n`;
const gap = (test, status, resolvedBy = "") => `- truth: "Login works"\n  status: ${status}\n  reason: "User reported: broken"\n  severity: minor\n  test: ${test}\n  resolved_by: "${resolvedBy}"\n  resolved_at: "2026-10-23"\n`;
const uat = (tests, gaps = "") => `---\nstatus: complete\n---\n## Tests\n\n${tests}## Summary\n\ntotal: 2\n\n## Gaps\n\n${gaps}`;
const issue = row(2, "Login works", "issue", 'reported: "broken"\nseverity: minor\n');

test("UAT a resolved gap clears its issue when an executed gap-closure plan and its SUMMARY name it", async () => {
  const p = uatProject(uat(row(1, "Screen renders", "pass") + issue, gap(2, "resolved", "01-02-PLAN.md")), closure);
  const r = await gsd(p, ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.passed, true);
  assert.deepEqual(r.json.blockers, []);
});

test("UAT the resolved status is case-insensitive", async () => {
  const p = uatProject(uat(row(1, "Screen renders", "pass") + issue, gap(2, "Resolved", "01-02-PLAN.md")), closure);
  const r = await gsd(p, ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
});

test("UAT a hand-written resolved gap without a valid plan and SUMMARY still blocks", async () => {
  const cases = {
    "no plan file": { [`${P1}/01-02-SUMMARY.md`]: summary("02") },
    "plan without SUMMARY": { [`${P1}/01-02-PLAN.md`]: plan({ id: "02" }) },
    "resolved_by with a path": closure,
    "empty resolved_by": closure,
  };
  const resolvedBy = { "no plan file": "01-02-PLAN.md", "plan without SUMMARY": "01-02-PLAN.md", "resolved_by with a path": "./01-02-PLAN.md", "empty resolved_by": "" };
  for (const [name, files] of Object.entries(cases)) {
    const p = uatProject(uat(row(1, "Screen renders", "pass") + issue, gap(2, "resolved", resolvedBy[name])), files);
    const r = await gsd(p, ["phase", "uat-passed", "1"]);
    assert.equal(r.code, 1, name);
    assert.equal(r.json.passed, false, name);
    assert.ok(r.json.blockers.some((b) => b.name === "Login works" && b.result === "issue"), name);
  }
  const open = uatProject(uat(row(1, "Screen renders", "pass") + issue, gap(2, "failed", "01-02-PLAN.md")), closure);
  assert.equal((await gsd(open, ["phase", "uat-passed", "1"])).code, 1, "a failed gap blocks even with a plan and SUMMARY");
});

test("UAT two gap entries for one test: one still open keeps the issue blocking", async () => {
  const oneOpen = uatProject(uat(row(1, "Screen renders", "pass") + issue, gap(2, "resolved", "01-02-PLAN.md") + gap(2, "failed")), closure);
  const r = await gsd(oneOpen, ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.ok(r.json.blockers.some((b) => b.name === "Login works" && b.result === "issue"), JSON.stringify(r.json.blockers));
  const allResolved = uatProject(uat(row(1, "Screen renders", "pass") + issue, gap(2, "resolved", "01-02-PLAN.md") + gap(2, "resolved", "01-02-PLAN.md")), closure);
  assert.equal((await gsd(allResolved, ["phase", "uat-passed", "1"])).code, 0);
});

test("UAT an issue with no gap entry blocks, whatever its severity", async () => {
  const p = uatProject(uat(row(1, "Screen renders", "pass") + issue));
  const r = await gsd(p, ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.ok(r.json.blockers.some((b) => b.name === "Login works"), JSON.stringify(r.json.blockers));
});

test("UAT a skipped test with a reason passes; one without a reason blocks", async () => {
  const withReason = uatProject(uat(row(1, "Screen renders", "pass") + row(2, "Login works", "skipped", "reason: Deferred follow-up\n")));
  const ok = await gsd(withReason, ["phase", "uat-passed", "1"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.equal(ok.json.passed, true);
  const noReason = uatProject(uat(row(1, "Screen renders", "pass") + row(2, "Login works", "skipped")));
  const r = await gsd(noReason, ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.ok(r.json.blockers.some((b) => b.name === "Login works" && b.result === "skipped"), JSON.stringify(r.json.blockers));
});

test("UAT the phase needs at least one passed test: all skipped with reasons, or zero passes, blocks", async () => {
  const allSkipped = uatProject(uat(row(1, "Screen renders", "skipped", "reason: Server down\n") + row(2, "Login works", "skipped", "reason: Later\n")));
  const r = await gsd(allSkipped, ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.equal(r.json.passed, false);
  assert.ok(r.json.blockers.some((b) => b.reason === "no passed test"), JSON.stringify(r.json.blockers));
  const blocked = uatProject(uat(row(1, "Screen renders", "blocked", "blocked_by: server\n")));
  assert.equal((await gsd(blocked, ["phase", "uat-passed", "1"])).code, 1);
});

test("UAT a pending or blocked row always blocks, even beside a passed test", async () => {
  const pending = uatProject(uat(row(1, "Screen renders", "pass") + row(2, "Login works", "[pending]")));
  assert.equal((await gsd(pending, ["phase", "uat-passed", "1"])).code, 1);
  const blocked = uatProject(uat(row(1, "Screen renders", "pass") + row(2, "Login works", "blocked", "blocked_by: server\n")));
  assert.equal((await gsd(blocked, ["phase", "uat-passed", "1"])).code, 1);
});
