// G030: a manifest entry that is not a plan record (null, a number, an array, an id-less object) is a manifest error
// that names its index; outline check and handoff refuse it instead of throwing on the entry.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const outline = () => `# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n| CORE-01 | \`01-01\` | 1 | do | none |\n| CORE-02 | \`01-02\` | 1 | do | none |\n\n## OUTLINE COMPLETE\n`;
const entry = (id, reqs) => ({ id, owns: [`Path:src/${id}/`], requirements: [reqs], produces: [], consumes: [], tracer: { is: false }, verify: [] });
const projectWith = (plans, { manifest = true } = {}) => project({
  files: {
    [`${P1}/01-PLAN-OUTLINE.md`]: outline(),
    [`${P1}/01-PLAN-OUTLINE.manifest.json`]: manifest ? JSON.stringify({ phase: "01", plans }) : null,
    [`${P1}/01-01-PLAN.md`]: plan(),
    [`${P1}/01-02-PLAN.md`]: plan({ id: "02", reqs: "[CORE-02]", files: "[src/b.js]", owns: '["Path:src/b.js"]' }),
  },
});

test("G030 outline check reports a non-plan manifest entry by index instead of throwing", async () => {
  const good = entry("01-01", "CORE-01");
  const bad = [[null, /plans\[1\] is not an object/], [7, /plans\[1\] is not an object/], [[], /plans\[1\] is not an object/], [{ owns: [] }, /plans\[1\] has no string id/]];
  for (const [entryValue, msg] of bad) {
    const p = projectWith([good, entryValue]);
    const parsed = (await gsd(p, ["outline", "parse", "1"])).json;
    assert.match(parsed.manifestError, msg, JSON.stringify(parsed));
    const check = await gsd(p, ["outline", "check", "1", "--tracer", "false"]);
    assert.equal(check.code, 1, JSON.stringify(check.json));
    assert.ok((check.json.errors ?? []).some((e) => msg.test(e)), JSON.stringify(check.json));
    assert.doesNotMatch(JSON.stringify(check.json), /Cannot read|undefined/);
  }
});

test("G030 handoff refuses a manifest with a bad entry, even when the bad entry precedes the plan, and a missing manifest", async () => {
  const bad = projectWith([null, entry("01-01", "CORE-01")]);
  const refused = await gsd(bad, ["handoff", "1"]);
  assert.equal(refused.code, 1, JSON.stringify(refused.json));
  assert.equal(refused.json.status, "refused", JSON.stringify(refused.json));
  assert.ok(refused.json.errors.some((e) => /plans\[0\] is not an object/.test(e)), JSON.stringify(refused.json));
  assert.equal(fs.existsSync(bad.path(`${P1}/handoff`)), false, "no handoff written");

  const missing = projectWith([], { manifest: false });
  const none = await gsd(missing, ["handoff", "1"]);
  assert.equal(none.json.status, "refused", JSON.stringify(none.json));
  assert.ok(none.json.errors.includes("manifest missing"), JSON.stringify(none.json));
  assert.equal(fs.existsSync(missing.path(`${P1}/handoff`)), false, "no handoff written");
});

test("G030 a valid manifest still passes outline check and hands off", async () => {
  const p = projectWith([entry("01-01", "CORE-01"), entry("01-02", "CORE-02")]);
  const check = await gsd(p, ["outline", "check", "1", "--tracer", "false"]);
  assert.equal(check.code, 0, JSON.stringify(check.json));
  assert.equal(check.json.passed, true);
  const handoff = await gsd(p, ["handoff", "1"]);
  assert.equal(handoff.code, 0, JSON.stringify(handoff.json));
});
