// Bug-hunt fix G049 (kit-feedback 4): research is checked only after the paid run, the researcher has no self-check,
// and a failed run hides its reason and the report's problems. The real `research` verbs answer the workflow here.
import assert from "node:assert/strict";
import test from "node:test";
import { FakeGsd, NULL, runScript } from "../gsd-flows/host.mjs";
import { gsd as runGsdIn, P1, project } from "../gsd-core/fixture.mjs";

const REPORT = `${P1}/01-RESEARCH.md`;
const SECTIONS = ["Summary", "Standard Stack", "Architecture Patterns", "Don't Hand-Roll", "Common Pitfalls", "Sources"];
const CONTEXT = { [`${P1}/01-CONTEXT.md`]: "<decisions>\n- **D-01:** keep it small\n</decisions>\n" };
const KEY = "a".repeat(64);

// The contract line the workflow appends to the researcher prompt: the report's digest and attempt key.
const contract = (prompt) => ({ key: /attempt_key: ([^\s;]+)/.exec(prompt)[1], digest: /input_digest: (\S+)/.exec(prompt)[1] });
const complete = ({ digest, key, drop = null }) => `---\nstatus: complete\ninput_digest: ${digest}\nattempt_key: ${key}\n---\n<user_constraints>none</user_constraints>\n<phase_requirements>CORE-01 CORE-02</phase_requirements>\n${SECTIONS.filter((s) => s !== drop).map((s) => `## ${s}\n\nx [VERIFIED: docs]\n`).join("\n")}\n<!-- gsd:research-complete ${key} -->\n`;
const blocked = ({ digest, key, items }) => `---\nstatus: blocked\ninput_digest: ${digest}\nattempt_key: ${key}\n---\n<research_blockers>\n${items.map((i) => `- ${i}`).join("\n")}\n</research_blockers>\n`;

// Every `ph gsd` verb the research flow calls runs for real against the project; only the researcher is scripted.
function realGsd(p) {
  const gsd = new FakeGsd();
  for (const key of ["research status", "research prompt", "revisions hash", "revisions record", "attempt record", "attempt show"]) {
    gsd.on(key, (_argv, input, argv) => runGsdIn(p, argv, { stdin: input }));
  }
  return gsd;
}
const research = (p, args, agent) => runScript("gsd-research", { root: p.root, gsd: realGsd(p), args: { phaseDir: P1, ...args }, agent, runId: "wf_20261023-100000_g049" });

test("G049 research status returns the blocker items of a blocked report", async () => {
  const p = project({ files: CONTEXT });
  const digest = (await runGsdIn(p, ["revisions", "hash", "1", "research"])).json.hash;
  p.write(REPORT, blocked({ digest, key: KEY, items: ["which auth flow", "is offline mode in scope"] }));
  const st = await runGsdIn(p, ["research", "status", "1"]);
  assert.deepEqual([st.code, st.json.status], [1, "blocked"]);
  assert.deepEqual(st.json.blockers, ["which auth flow", "is offline mode in scope"]);
});

test("G049 a blocked research run hands the owner the blockers, in view mode and after the run", async () => {
  const p = project({ files: CONTEXT });
  const digest = (await runGsdIn(p, ["revisions", "hash", "1", "research"])).json.hash;
  p.write(REPORT, blocked({ digest, key: KEY, items: ["which auth flow"] }));
  const view = await research(p, { view: true });
  assert.deepEqual(view.result.report.blockers, ["which auth flow"]);
  const plain = await research(p, {}, () => { throw new Error("no agent expected for a blocked report"); });
  assert.deepEqual([plain.result.status, plain.result.stage, plain.result.problems], ["needs-owner", "Research", ["which auth flow"]]);
  const p2 = project({ files: CONTEXT });
  const run = await research(p2, {}, (prompt) => {
    const c = contract(prompt);
    p2.write(REPORT, blocked({ ...c, items: ["which auth flow", "is offline mode in scope"] }));
    return { status: "blocked" };
  });
  assert.deepEqual([run.result.status, run.result.stage, run.result.issues], ["needs-owner", "Research", ["which auth flow", "is offline mode in scope"]]);
});

test("G049 the researcher is told to run the research status self-check before its final reply", async () => {
  const p = project({ files: CONTEXT });
  const r = await research(p, {}, (prompt) => {
    p.write(REPORT, complete(contract(prompt)));
    return { status: "complete" };
  });
  assert.equal(r.result.status, "researched");
  assert.match(r.calls[0].prompt, /node \.agents\/harness\/ph\.mjs gsd research status \.planning\/phases\/01-core/);
  assert.match(r.calls[0].prompt, /fix every listed problem/);
});

test("G049 a failed run keeps the researcher's reason and the report's problems", async () => {
  const p = project({ files: { ...CONTEXT, [REPORT]: complete({ digest: "d".repeat(64), key: "c".repeat(64), drop: "Sources" }) } });
  const r = await research(p, { refresh: true }, () => NULL("runner error: timed out after 600s"));
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /not this attempt's/);
  assert.match(r.result.reason, /runner error: timed out after 600s/);
  assert.deepEqual(r.result.problems, ["missing section ## Sources"]);
});

test("G049 an invalid report the researcher wrote fails with its problems, not only a generic message", async () => {
  const p = project({ files: CONTEXT });
  const r = await research(p, {}, (prompt) => {
    p.write(REPORT, complete({ ...contract(prompt), drop: "Sources" }));
    return { status: "complete" };
  });
  assert.equal(r.result.status, "failed");
  assert.deepEqual(r.result.problems, ["missing section ## Sources"]);
});
