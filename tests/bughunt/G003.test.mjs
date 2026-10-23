import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const task = (inner, type = "auto", attrs = "") => `<task type="${type}"${attrs}>\n${inner}\n</task>`;
const okTask = task("<name>T</name><files>src/a.js</files><action>do</action><verify><automated>cmd: node src/a.js</automated><fails_when>exit 1</fails_when></verify><done>d</done>");
const oneWay = okTask.replace("<name>T</name>", "<name>Format</name>").replace("<files>", '<reversibility rating="one-way">x</reversibility><files>');
const decision = task('<name>Pick</name><decision>region</decision><options><option id="a"></option></options><resume-signal>r</resume-signal>', "checkpoint:decision");

async function oneWayWarnings(tasks) {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ tasks }).replace("autonomous: true", "autonomous: false"), "src/a.js": "" } });
  const r = await gsd(p, ["verify", "plan-structure", "1"]);
  return r.json.warnings.filter((w) => w.includes("one-way reversibility"));
}

test("G003 one-way task: a checkpoint:decision for another choice earlier in the plan does not satisfy it", async () => {
  const w = await oneWayWarnings(`${decision}\n${okTask}\n${oneWay}`);
  assert.equal(w.length, 1, w.join("\n"));
  assert.match(w[0], /^Task 3 \(Format\): one-way reversibility without a checkpoint:decision immediately before it$/);
});

test("G003 one-way task: the checkpoint:decision immediately before it satisfies it", async () => {
  assert.deepEqual(await oneWayWarnings(`${okTask}\n${decision}\n${oneWay}`), []);
});

test("G003 one-way task: no checkpoint:decision at all is still a warning", async () => {
  assert.equal((await oneWayWarnings(`${okTask}\n${oneWay}`)).length, 1);
});
