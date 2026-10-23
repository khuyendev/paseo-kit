// Bug-hunt regression for G095: only the exact `## Tests` section of a UAT holds human tests; a numbered heading
// anywhere else, or under a differently named Tests header, never counts as a passed human verification.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalVerification } from "../../ship/.agents/harness/gsd/phases.mjs";
import { frontmatter } from "../../ship/.agents/harness/gsd/yaml.mjs";
import { P1, gsd, plan, project, summary, writeVerification } from "../gsd-core/fixture.mjs";

const uatProject = (text) => project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), [`${P1}/01-UAT.md`]: text } });
const uat = (result) => `---\nstatus: complete\n---\n## Tests\n\n### 1. Screen renders\nexpected: renders\nresult: ${result}\n`;

test("G095 a numbered heading outside ## Tests is not a human test", async () => {
  const text = "---\nstatus: testing\n---\n## Tests\n\n## Notes\n\n### 1. A heading outside Tests\nexpected: nothing\nresult: pass\n";
  const r = await gsd(uatProject(text), ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.equal(r.json.passed, false);
  assert.deepEqual(r.json.checks, []);
  assert.ok(r.json.blockers.some((b) => b.reason === "no recognized test (### N. Name)"), JSON.stringify(r.json.blockers));
});

test("G095 a differently named Tests header is no test section, so its issue is never dropped", async () => {
  const text = "---\nstatus: testing\n---\n## Tests (3)\n\n### 1. Screen renders\nexpected: renders\nresult: pass\n\n### 2 - Login works\nexpected: login\nresult: issue\n";
  const r = await gsd(uatProject(text), ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.equal(r.json.passed, false);
  assert.ok(r.json.blockers.some((b) => b.reason === "no ## Tests section"), JSON.stringify(r.json.blockers));
});

test("G095 the exact ## Tests section counts with CRLF and trailing spaces, and a level-one heading ends it", async () => {
  const text = "---\r\nstatus: testing\r\n---\r\n## Tests  \r\n\r\n### 1. Screen renders\r\nexpected: renders\r\nresult: pass\r\n\r\n# Notes\r\n\r\n### 2. Outside\r\nresult: issue\r\n";
  const r = await gsd(uatProject(text), ["phase", "uat-passed", "1"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.checks.map((c) => c.name), ["Screen renders"]);
});

test("G095 canonicalVerification sets passed and drops the human items, keeping the rest of the report", () => {
  const report = '---\nphase: 01-core\nstatus: human_needed\nbehavior_unverified: 1\nbehavior_unverified_items:\n  - truth: "x"\n    test: y\nhuman_verification:\n  - test: "Check"\n    expected: "renders"\ncovered_digest: "v3:sha256:abc"\n---\n\n# Verification\n';
  const out = canonicalVerification(report);
  assert.equal(out, '---\nphase: 01-core\nstatus: passed\nbehavior_unverified: 0\ncovered_digest: "v3:sha256:abc"\n---\n\n# Verification\n');
  const fm = frontmatter(out);
  assert.ok(!fm.error, fm.error);
  assert.equal(fm.fm.status, "passed");
});

test("G095 a passing UAT canonicalises a human_needed report; an issue, --uat-only or a rerun leaves it alone", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), [`${P1}/01-UAT.md`]: uat("issue"), "src/a.js": "" } });
  await writeVerification(p, "human_needed", { human: ["Check the screen"] });
  const report = p.read(`${P1}/01-VERIFICATION.md`);
  const blocked = await gsd(p, ["phase", "uat-passed", "1", "--require-verification"]);
  assert.equal(blocked.code, 1, JSON.stringify(blocked.json));
  assert.equal(blocked.json.canonicalized, false);
  assert.equal(p.read(`${P1}/01-VERIFICATION.md`), report, "an issue leaves the report alone");
  p.write(`${P1}/01-UAT.md`, uat("pass"));
  const reading = await gsd(p, ["phase", "uat-passed", "1", "--uat-only"]);
  assert.equal(reading.code, 0, JSON.stringify(reading.json));
  assert.equal(p.read(`${P1}/01-VERIFICATION.md`), report, "--uat-only only reads");
  const done = await gsd(p, ["phase", "uat-passed", "1", "--require-verification"]);
  assert.equal(done.code, 0, JSON.stringify(done.json));
  assert.equal(done.json.canonicalized, true);
  assert.match(p.read(`${P1}/01-VERIFICATION.md`), /^status: passed$/m);
  assert.doesNotMatch(p.read(`${P1}/01-VERIFICATION.md`), /human_verification/);
  assert.equal((await gsd(p, ["verification", "status", "1"])).json.status, "passed");
  const again = await gsd(p, ["phase", "uat-passed", "1", "--require-verification"]);
  assert.equal(again.code, 0);
  assert.equal(again.json.canonicalized, false, "already passed: nothing to write");
});

test("G095 a canonical report that would not read back as passed is restored", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), [`${P1}/01-UAT.md`]: uat("pass"), "src/a.js": "" } });
  await writeVerification(p, "human_needed", { gaps: ["Login works"], human: ["Check the screen"] });
  const report = p.read(`${P1}/01-VERIFICATION.md`);
  const r = await gsd(p, ["phase", "uat-passed", "1", "--require-verification"]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.equal(r.json.canonicalized, false);
  assert.ok(r.json.blockers.some((b) => b.reason === "verification status human_needed"), JSON.stringify(r.json.blockers));
  assert.equal(p.read(`${P1}/01-VERIFICATION.md`), report, "the failed write is undone");
});
