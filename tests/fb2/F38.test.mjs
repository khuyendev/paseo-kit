// F38 (kit feedback #38, #42): `phase complete` proposes the codebase map and the harness pass after a phase that ships code.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan, project, summary, writeVerification } from "../gsd-core/fixture.mjs";

const completed = async (p) => {
  await gsd(p, ["state", "init"]);
  await writeVerification(p, "passed");
  return gsd(p, ["phase", "complete", "1"]);
};

test("F38 a phase that ships code proposes gsd-map-codebase and harness while neither exists", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), "src/a.js": "x\n" } });
  const ok = await completed(p);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.proposals?.map((x) => x.skill), ["gsd-map-codebase", "harness"]);
});

test("F38 a map and a review lens stop the proposals", async () => {
  const p = project({
    files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), "src/a.js": "x\n", ".planning/codebase/STACK.md": "# Stack\n" },
    overlay: { adapter: { review_lenses: [{ name: "stack", text: "Check the stack rules." }] } },
  });
  const ok = await completed(p);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.proposals, []);
});

test("F38 a phase with no code proposes nothing", async () => {
  const notes = "---\nphase: 01-core\nplan: 01\nkey-files:\n  created: [.planning/notes.md]\n  modified: []\n---\n# Summary 01\n";
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: notes, "src/a.js": "x\n" } });
  const ok = await completed(p);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.proposals, []);
});
