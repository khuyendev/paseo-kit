// Kit feedback #99 F1, F2 (V5B): an owner answer of planning is its own record, `ph gsd decide`, never a CONTEXT edit. It is no
// research input: a decision naming plans changes only those plans' revision keys, an outline decision the inputs key. `ph gsd
// research questions` lists the research Open Questions that ask the owner for a scope decision until a decision answers them.
import assert from "node:assert/strict";
import test from "node:test";
import { phaseDecisions, readAnswers } from "../../ship/.agents/harness/lib/owner-answers.mjs";
import { gsd, P1, plan, project, workerEnv } from "../gsd-core/fixture.mjs";

const CONTEXT = "# Context\n\n<decisions>\n- **D-01:** keep it small\n- **D-02:** no cache\n</decisions>\n";
const OUTLINE = "| Plan ID | Objective | Wave | Depends | Requirements |\n| --- | --- | --- | --- | --- |\n| 01-01 | core | 1 | - | CORE-01 |\n| 01-02 | stop | 2 | 01-01 | CORE-02 |\n\n## OUTLINE COMPLETE\n";
const MANIFEST = JSON.stringify({ phase: "1", plans: [{ id: "01-01", owns: ["Path:src/a.js"], requirements: ["CORE-01"], tracer: { is: true, outcome: "runs" } }, { id: "01-02", owns: ["Path:src/b.js"], requirements: ["CORE-02"] }] });
const RESEARCH = [
  "---", "status: complete", "---", "# Research", "", "## Open Questions", "",
  "- **Unicode ordering implementation:** locale-aware comparison; plan a fixture-backed comparator task.",
  "- **Directory/timeline requirement split:** the directory cache is delivered here, timeline paint stays deferred.",
  "  - Recommendation: carry the full requirement wording into validation.",
  "- **Export format** [SCOPE] whether CSV export belongs to this phase.",
  "- **Phase boundary of imports** RESOLVED: phase 5 owns them.",
  "", "## Sources", "", "- **Not a question:** a source line.", "",
].join("\n");
const files = { [`${P1}/01-CONTEXT.md`]: CONTEXT, [`${P1}/01-PLAN-OUTLINE.md`]: OUTLINE, [`${P1}/01-PLAN-OUTLINE.manifest.json`]: MANIFEST, [`${P1}/01-RESEARCH.md`]: RESEARCH };
const decisions = (p) => phaseDecisions(readAnswers(p.path(`${P1}/owner-answers.json`)).answers);

test("V5B decide records an owner decision of its own: next free id after CONTEXT, plans checked against the outline, CONTEXT untouched", async () => {
  const p = project({ files });
  const r = await gsd(p, ["decide", "1", "--plans", "2", "--text", "01-02 owns the router test"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual([r.json.kind, r.json.decision, r.json.plans, r.json.outline, r.json.replans], ["decision", "D-03", ["01-02"], false, "plans 01-02 only"]);
  assert.equal(p.read(`${P1}/01-CONTEXT.md`), CONTEXT);
  assert.deepEqual(decisions(p).map((d) => [d.decision, d.plans, d.outline, d.text]), [["D-03", ["01-02"], false, "01-02 owns the router test"]]);
  // Refused: a CONTEXT id, an unknown plan, no scope, a worker, no text.
  assert.equal((await gsd(p, ["decide", "1", "--id", "D-02", "--plans", "01-01", "--text", "x"])).code, 1);
  assert.match((await gsd(p, ["decide", "1", "--plans", "01-07", "--text", "x"])).json.error, /01-07 not in the outline/);
  assert.match((await gsd(p, ["decide", "1", "--text", "x"])).json.error, /--plans <ids>.*--outline/);
  assert.equal((await gsd(p, ["decide", "1", "--plans", "01-01", "--text", "x"], { env: workerEnv() })).code, 1);
  assert.equal((await gsd(p, ["decide", "1", "--plans", "01-01"])).code, 1);
  // The same id again replaces the decision (D-12 widened): the newest entry is the decision.
  const again = await gsd(p, ["decide", "1", "--id", "d-3", "--plans", "1,02", "--text", "01-02 owns the test and its fixtures"]);
  assert.equal(again.code, 0, JSON.stringify(again.json));
  assert.equal(again.json.replaces, r.json.answered);
  assert.deepEqual(decisions(p).map((d) => [d.decision, d.plans, d.text]), [["D-03", ["01-01", "01-02"], "01-02 owns the test and its fixtures"]]);
  assert.equal((await gsd(p, ["decide", "1", "--outline", "--text", "one outline"])).json.decision, "D-04");
});

test("V5B a plan decision changes only that plan's revision key, an outline decision the inputs; the research key never", async () => {
  const p = project({ files: { ...files, [`${P1}/01-01-PLAN.md`]: plan({ id: "01" }), [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[src/b.js]", owns: "[\"Path:src/b.js\"]" }) } });
  const keys = ["research", "inputs", "freeze", "plan:01-01", "plan:01-02"];
  for (const k of keys) assert.equal((await gsd(p, ["revisions", "record", "1", k])).code, 0, k);
  const state = async () => Object.fromEntries(await Promise.all(keys.map(async (k) => { const c = await gsd(p, ["revisions", "check", "1", k]); return [k, c.code === 0 ? "same" : c.json.changed]; })));
  assert.deepEqual(Object.values(await state()), ["same", "same", "same", "same", "same"]);
  await gsd(p, ["decide", "1", "--plans", "01-02", "--text", "01-02 owns the router test"]);
  assert.deepEqual(await state(), { research: "same", inputs: "same", freeze: "same", "plan:01-01": "same", "plan:01-02": ["decisions:01-02"] });
  await gsd(p, ["decide", "1", "--outline", "--text", "the timeline paint moves to phase 5"]);
  const after = await state();
  assert.equal(after.research, "same");
  assert.deepEqual(after.inputs, ["decisions:outline"]);
  // A plan key holds the plan's own outline row and manifest entry: the outline revision decides which plans are planned again.
  assert.equal(after["plan:01-01"], "same");
});

test("V5B research questions lists the open scope questions; a decide --question answers one; RESOLVED and other questions are not asked", async () => {
  const p = project({ files });
  const q = await gsd(p, ["research", "questions", "1"]);
  assert.equal(q.code, 1, JSON.stringify(q.json));
  assert.deepEqual(q.json.open.map((x) => [x.n, x.title]), [[2, "Directory/timeline requirement split"], [3, "Export format"]]);
  assert.equal(q.json.nextId, "D-03");
  assert.match(q.json.open[0].text, /Recommendation: carry the full requirement wording/);
  const d = await gsd(p, ["decide", "1", "--question", "2", "--text", "DIR-02 here covers the directory cache only"]);
  assert.equal(d.code, 0, JSON.stringify(d.json));
  assert.deepEqual([d.json.outline, d.json.question], [true, { n: 2, title: "Directory/timeline requirement split" }]);
  assert.deepEqual((await gsd(p, ["research", "questions", "1"])).json.open.map((x) => x.n), [3]);
  assert.match((await gsd(p, ["decide", "1", "--question", "9", "--text", "x"])).json.error, /no scope question 9/);
  assert.equal((await gsd(p, ["decide", "1", "--question", "export format", "--text", "CSV export is phase 6"])).code, 0);
  const done = await gsd(p, ["research", "questions", "1"]);
  assert.deepEqual([done.code, done.json.open], [0, []]);
  assert.equal((await gsd(project(), ["research", "questions", "1"])).code, 66, "no research");
});
