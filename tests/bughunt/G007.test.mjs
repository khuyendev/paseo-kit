// Regression test for G007: a one-way task whose decision CONTEXT.md already settles gets no reversibility warning.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const CONTEXT = "<decisions>\n### Storage\n- **D-09 [one-way]:** Drift schema v1 is the on-disk format\n- **D-10 [deferred]:** Later\n### Claude's Discretion\n- **D-11:** naming\n</decisions>\n";
const WARNING = "Task 1 (Write drift schema v1): one-way reversibility without a checkpoint:decision immediately before it";

const oneWay = (cite) => `<task type="auto">
<name>Write drift schema v1</name>
<reversibility rating="one-way">${cite}</reversibility>
<files>src/a.js</files>
<action>Write it</action>
<verify>
<automated>cmd: node src/a.js</automated>
<fails_when>node prints an error and exits non-zero</fails_when>
</verify>
<done>works</done>
</task>`;

async function warnings(tasks) {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: CONTEXT, [`${P1}/01-01-PLAN.md`]: plan({ tasks }), "src/a.js": "" } });
  return (await gsd(p, ["verify", "plan-structure", "1"])).json.warnings;
}

test("G007: a one-way task citing a CONTEXT decision that settles it gets no checkpoint warning", async () => {
  assert.ok(!(await warnings(oneWay("Settled by D-09; the format is fixed."))).includes(WARNING));
});

test("G007: a one-way task with no cited decision still warns", async () => {
  assert.ok((await warnings(oneWay("Changes the on-disk format."))).includes(WARNING));
});

test("G007: a cited decision that is not settled (deferred, discretion, absent from CONTEXT) still warns", async () => {
  for (const cite of ["Settled by D-10.", "Settled by D-11.", "Settled by D-99."]) assert.ok((await warnings(oneWay(cite))).includes(WARNING), cite);
});

test("G007: a decision id matches by identity, not as a prefix of another id", async () => {
  assert.ok((await warnings(oneWay("Settled by D-0."))).includes(WARNING));
});

test("G007: a quick plan outside a phase has no CONTEXT.md to settle the decision and still warns", async () => {
  const p = project({ files: { ".planning/quick/01-fix/01-fix-PLAN.md": plan({ tasks: oneWay("Settled by D-09.") }), "src/a.js": "" } });
  const r = await gsd(p, ["verify", "plan-structure", ".planning/quick/01-fix/01-fix-PLAN.md"]);
  assert.ok(r.json.warnings.includes(WARNING), r.stdout);
});
