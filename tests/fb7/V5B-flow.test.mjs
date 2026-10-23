// Kit feedback #99 F1, F2 and #101 F2 (V5B) in gsd-plan: a planner's owner marker is answered with `ph gsd decide` for its plan; a
// plan decision re-plans only that plan (no outline, skeleton review or other planner), an outline decision the outline; research
// scope questions stop at Discuss before an outline is written; the skeleton lanes get the inherited tests of the outline check.
import assert from "node:assert/strict";
import test from "node:test";
import { gsd as realGsd } from "../gsd-core/fixture.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, outlineText, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, overrides = {}, args = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const labels = (r) => r.calls.map((c) => c.opts.label);
// The real verbs in the fake world: the revision keys (so decisions count as the kit counts them) and the research questions.
function realVerbs(w, keys) {
  for (const key of keys) w.gsd.on(key, async (_a, input, argv) => { const r = await realGsd(w.root, argv, { stdin: input }); return { code: r.code, json: r.json }; });
}
const decide = async (w, ...argv) => {
  const r = await realGsd(w.root, ["decide", "1", ...argv]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  return r.json;
};
const SPLIT = "---\nstatus: complete\n---\n# Research\n\n## Open Questions\n\n- **Directory/timeline requirement split:** directory cache here, timeline paint deferred.\n- **Comparator:** plan a fixture-backed task.\n";

test("V5B a planner's REVISION_CONFLICT is answered with ph gsd decide for that plan, not a CONTEXT edit", async () => {
  const r = await plan(makeWorld(), { "plan-01-02": () => ({ marker: "REVISION_CONFLICT", summary: "the frozen verify runs a test no plan owns" }) });
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Plan");
  assert.equal(r.result.answer.verb, "decide");
  assert.match(r.result.answer.command, /ph\.mjs gsd decide 01 --text "<the decision>" --plans 01-02 \(only 01-02 is planned again/);
  assert.doesNotMatch(r.result.answer.command, /CONTEXT/);
});

test("V5B a plan decision re-plans only that plan: no outline, skeleton review or other planner; an outline decision the outline", async () => {
  const w = makeWorld();
  realVerbs(w, ["revisions hash", "revisions check", "revisions record"]);
  const first = await plan(w);
  assert.equal(first.result.status, "planned", JSON.stringify(first.result));
  assert.ok(labels(first).includes("outline") && labels(first).includes("plan-01-01"));
  await decide(w, "--plans", "01-02", "--text", "01-02 owns route_restore_test and its fixtures");
  const second = await plan(w);
  assert.equal(second.result.status, "planned", JSON.stringify(second.result));
  const called = labels(second);
  assert.ok(!called.some((l) => l === "outline" || /^(skeleton|resolve|outline)-/.test(l)), called.join(", "));
  assert.ok(called.includes("plan-01-02") && !called.includes("plan-01-01"), called.join(", "));
  assert.ok(second.logs.includes("log plan 01-01 kept: unchanged since recorded"));
  const prompt = second.calls.find((c) => c.opts.label === "plan-01-02").prompt;
  assert.match(prompt, /Owner decisions after discuss .*\n- D-02 \(plans 01-02\): 01-02 owns route_restore_test and its fixtures\n/);
  await decide(w, "--outline", "--text", "timeline paint moves to phase 5");
  // The outline writer answers the decision with a changed outline (a regeneration that changes nothing fails the run).
  const rows = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
  const rewrite = (p, o) => (o.label === "outline" ? (w.write(`${PHASE_DIR}/01-PLAN-OUTLINE.md`, `${outlineText(rows)}\n<!-- D-03 -->\n`), { marker: "## OUTLINE COMPLETE" }) : undefined);
  const third = await plan(w, { outline: rewrite });
  assert.equal(third.result.status, "planned", JSON.stringify(third.result));
  assert.ok(labels(third).includes("outline"));
  assert.ok(third.logs.includes("log inputs changed: decisions:outline"), third.logs.filter((l) => l.includes("inputs")).join("; "));
});

test("V5B research scope questions stop at Discuss before an outline is written; a decide --question lets the next run write it", async () => {
  const w = makeWorld({ files: { [`${PHASE_DIR}/01-RESEARCH.md`]: SPLIT } });
  realVerbs(w, ["research questions"]);
  const r = await plan(w);
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Discuss");
  assert.deepEqual(r.result.questions.map((q) => [q.n, q.title]), [[1, "Directory/timeline requirement split"]]);
  assert.equal(r.result.answer.verb, "decide");
  assert.match(r.result.answer.command, /gsd decide 01 --text "<the decision>" --question <n> \(one decision per question: 1\)/);
  assert.ok(!labels(r).includes("outline"), "no outline written");
  await decide(w, "--question", "1", "--text", "DIR-02 here is the directory cache only");
  const next = await plan(w);
  assert.equal(next.result.status, "planned", JSON.stringify(next.result));
  assert.match(next.calls.find((c) => c.opts.label === "outline").prompt, /- D-02 \(outline\): DIR-02 here is the directory cache only/);
});

test("V5B an outline already written is not stopped by a scope question the research lists", async () => {
  const w = makeWorld({ files: { [`${PHASE_DIR}/01-RESEARCH.md`]: SPLIT } });
  const first = await plan(w);
  assert.equal(first.result.status, "planned", JSON.stringify(first.result));
  realVerbs(w, ["research questions"]);
  const again = await plan(w);
  assert.equal(again.result.status, "planned", JSON.stringify(again.result));
  assert.equal(w.gsd.callsOf("research questions").length, 1, "asked only by the first run, whose fake verb answered none");
});

test("V5B the skeleton lanes get the inherited tests of the outline check; a reused outline checks them as warnings", async () => {
  const w = makeWorld();
  const fake = w.gsd.handlers["outline check"];
  const tests = [{ file: "test/app/route_restore_test.dart", plans: ["01-01"], owners: ["01-02"] }];
  w.gsd.on("outline check", async (...a) => { const r = await fake(...a); return { ...r, json: { ...r.json, inheritedTests: tests } }; });
  const first = await plan(w);
  assert.equal(first.result.status, "planned", JSON.stringify(first.result));
  const lanes = first.calls.filter((c) => /^skeleton-/.test(c.opts.label));
  assert.ok(lanes.length > 0);
  for (const c of lanes) assert.ok(c.prompt.includes(`Existing tests the verify commands run, with the plans that own them: ${JSON.stringify(tests)}.`), c.prompt);
  await plan(w);
  const argvs = w.gsd.callsOf("outline check").map((c) => c.argv.join(" "));
  assert.ok(argvs.at(-1).endsWith("--files-per-plan warn --inherited-tests warn"), argvs.join(" | "));
  assert.ok(!argvs[0].includes("--inherited-tests"), argvs[0]);
});
