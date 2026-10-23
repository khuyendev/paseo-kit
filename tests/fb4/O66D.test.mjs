// Kit feedback #66 point 5 (O66D): with gsd.research_ahead, research of a phase runs while earlier phases execute. Claims
// about the project's own code live in ## Code APIs; the report reads `provisional` until the earlier phases are COMPLETE,
// then `code-stale`, and `refresh: "code"` re-verifies only that section. A source-only input change is `code-stale`, not
// `stale`. The default (false) keeps today's research: one `stale` for any changed input, no ahead text, no new fields.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { gsd, plan, project, summary, writeVerification } from "../gsd-core/fixture.mjs";
import { testEnv } from "../helpers/env.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";

const { main: flowMain } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const lock = (root, argv) => flowMain(["lock", ...argv], { root, input: "", out: () => {} });

const P2 = ".planning/phases/02-api";
const REPORT = `${P2}/02-RESEARCH.md`;
const OWNERSHIP = { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: ["src"], ignore: [], regenerated: [] };
const CONTEXT = "# Phase 2 context\n\n<decisions>\n- **D-01:** the api answers\n</decisions>\n\n<canonical_refs>\n- `src/api/client.js`\n- `docs/api.md`\n</canonical_refs>\n";

function world({ ahead = true } = {}) {
  const p = project({
    files: { [`${P2}/02-CONTEXT.md`]: CONTEXT, "src/api/client.js": "export const connect = () => 1;\n", "docs/api.md": "# api\n" },
    overlay: { adapter: { ownership: OWNERSHIP }, gsd: { research_ahead: ahead } },
  });
  p.env = testEnv();
  return p;
}
const ph = (p, argv, stdin) => gsd(p, argv, { env: p.env, ...(stdin === undefined ? {} : { stdin: typeof stdin === "string" ? stdin : JSON.stringify(stdin) }) });

// Phase 1 of the fixture roadmap becomes COMPLETE: one plan, its summary, a passed verification and its completion record.
async function completePhase1(p) {
  p.write(".planning/phases/01-core/01-01-PLAN.md", plan());
  p.write(".planning/phases/01-core/01-01-SUMMARY.md", summary("01-01"));
  p.write("src/a.js", "a\n");
  const sha = await writeVerification(p, "passed");
  p.writeJson(".planning/phases/01-core/complete.json", { verification_sha: sha });
}

function reportText({ digest, key, aheadOf, summaryText = "the api is plain", code = "- `src/api/client.js` exports connect() [PENDING: phase 1]", extra = "" }) {
  const sections = [
    ["Summary", `${summaryText} [VERIFIED: docs/api.md]`],
    ["Standard Stack", "node [CITED: nodejs.org]"],
    ["Architecture Patterns", "one module"],
    ["Don't Hand-Roll", "none"],
    ["Common Pitfalls", "none"],
    ...(code === null ? [] : [["Code APIs", `${code}${extra}`]]),
    ["Sources", "docs/api.md"],
  ];
  return `---\nstatus: complete\ninput_digest: ${digest}\nattempt_key: ${key}\n${aheadOf ? `ahead_of: ${JSON.stringify(aheadOf)}\n` : ""}---\n# Phase 2: Api - Research\n\n<user_constraints>\nD-01\n</user_constraints>\n\n<phase_requirements>\nAPI-01\n</phase_requirements>\n\n${sections.map(([h, b]) => `## ${h}\n\n${b}\n`).join("\n")}\n<!-- gsd:research-complete ${key} -->\n`;
}

// A report accepted the way gsd-research accepts one: attempt recorded (with what it asked), report written, attempt done,
// research revision recorded.
async function accepted(p, { aheadOf, runId = "wf_seed", ...rest } = {}) {
  const digest = (await ph(p, ["revisions", "hash", "2", "research"])).json.hash;
  const asked = aheadOf === undefined ? {} : { aheadOf, part: "full" };
  const key = (await ph(p, ["attempt", "record", "2", "--kind", "research"], { runId, inputDigest: digest, before: null, ...asked })).json.key;
  p.write(REPORT, reportText({ digest, key, aheadOf: aheadOf?.length ? aheadOf : undefined, ...rest }));
  const result = (await ph(p, ["hash"], p.read(REPORT))).json.hash;
  await ph(p, ["attempt", "record", "2", "--kind", "research"], { runId, inputDigest: digest, before: null, done: true, result });
  await ph(p, ["revisions", "record", "2", "research"]);
  return { digest, key };
}
const status = async (p) => (await ph(p, ["research", "status", "2"]));

// The workflow host with the real `ph gsd` verbs; only the upstream prompt render is faked.
function realGsd(p) {
  const calls = [];
  return {
    calls,
    async call(argv, input) {
      calls.push(argv.slice(0, 2).join(" "));
      if (argv[0] === "research" && argv[1] === "prompt") return { code: 0, stdout: `${JSON.stringify({ prompt: "<upstream research dispatch>", path: REPORT })}\n` };
      const r = await ph(p, argv, input === "" ? undefined : input);
      return { code: r.code, stdout: r.stdout };
    },
  };
}
const research = (p, args, agent, runId = "wf_20261023-120000_aa01") => runScript("gsd-research", { root: p.root, gsd: realGsd(p), args: { phaseDir: P2, ...args }, agent, runId });
// The researcher: writes the report the contract asks for (ahead_of copied from the prompt) and returns.
const researcher = (p, opts = {}) => (prompt) => {
  const key = /attempt_key: ([^\s;]+)/.exec(prompt)[1];
  const digest = /input_digest: (\S+)/.exec(prompt)[1];
  const ahead = /ahead_of: (\[[^\]]*\])/.exec(prompt);
  p.write(REPORT, reportText({ digest, key, aheadOf: ahead ? JSON.parse(ahead[1]) : undefined, ...opts }));
  return { status: "complete", path: REPORT };
};

test("O66D status: with the switch off any changed input is stale, a source edit included, and PENDING tags are not checked", async () => {
  const p = world({ ahead: false });
  await accepted(p, { code: "- connect() [PENDING: phase 1]" });
  const fresh = await status(p);
  assert.deepEqual([fresh.code, fresh.json.status], [0, "complete"], JSON.stringify(fresh.json));
  p.write("src/api/client.js", "export const connect = () => 2;\n");
  const st = await status(p);
  assert.deepEqual([st.code, st.json.status, st.json.changed], [1, "stale", undefined]);
});

test("O66D status: with the switch on a source-only change is code-stale and names the file; a decision change is stale", async () => {
  const p = world();
  await accepted(p, { code: "- connect() [VERIFIED: src/api/client.js:1]" });
  p.write("src/api/client.js", "export const connect = () => 2;\n");
  const st = await status(p);
  assert.deepEqual([st.code, st.json.status, st.json.reason, st.json.changed], [1, "code-stale", "source", ["src/api/client.js"]], JSON.stringify(st.json));
  p.write(`${P2}/02-CONTEXT.md`, CONTEXT.replace("the api answers", "the api answers twice"));
  assert.equal((await status(p)).json.status, "stale");
  // a report with PENDING tags but no ahead_of is invalid under the switch
  const q = world();
  await accepted(q, { code: "- connect() [PENDING: phase 1]" });
  const inv = await status(q);
  assert.deepEqual([inv.code, inv.json.status], [1, "invalid"]);
  assert.match(inv.json.problems.join(), /\[PENDING: \.\.\.\] claims in a report without ahead_of/);
});

test("O66D status: an ahead report is provisional while its phase runs (source drift included), then code-stale; its contract is checked", async () => {
  const p = world();
  await accepted(p, { aheadOf: ["1"] });
  const prov = await status(p);
  assert.deepEqual([prov.code, prov.json.status, prov.json.pending_phases, prov.json.ahead_of], [1, "provisional", ["1"], ["1"]], JSON.stringify(prov.json));
  p.write("src/api/client.js", "export const connect = () => 2;\n");
  const drift = await status(p);
  assert.deepEqual([drift.json.status, drift.json.changed], ["provisional", ["src/api/client.js"]]);
  await completePhase1(p);
  const after = await status(p);
  assert.deepEqual([after.code, after.json.status, after.json.reason], [1, "code-stale", "ahead"], JSON.stringify(after.json));

  const q = world();
  await accepted(q, { aheadOf: ["1"], code: null });
  assert.match((await status(q)).json.problems.join(), /missing section ## Code APIs \(ahead_of is set\)/);
  // the attempt asked for ahead_of ["1"]; a report claiming none is not that attempt's contract
  const r = world();
  const { digest, key } = await accepted(r, { aheadOf: ["1"] });
  r.write(REPORT, reportText({ digest, key, code: "- connect() [VERIFIED: src/api/client.js:1]" }));
  assert.match((await status(r)).json.problems.join(), /ahead_of must be \["1"\]/);
});

test("O66D research ahead: the run lists the running phase, the report is accepted as provisional, a default run reports it with no agent", async () => {
  const p = world();
  // phase 1 is executing: its run holds the code-root lease and its phase lease (F02); research of phase 2 takes neither
  assert.equal(await lock(p.root, ["debug", "wf_exec", "gsd-execute"]), 0);
  assert.equal(await lock(p.root, ["phase-01", "wf_exec", "gsd-execute"]), 0);
  const r = await research(p, {}, researcher(p));
  assert.equal(r.result.status, "researched", JSON.stringify(r.result));
  assert.deepEqual([r.result.part, r.result.aheadOf, r.result.reportStatus], ["full", ["1"], "provisional"]);
  assert.match(r.calls[0].prompt, /Research ahead: phase 1 before this one is not complete/);
  assert.match(r.calls[0].prompt, /ahead_of: \["1"\]\. For this report the status check ends at provisional/);
  assert.equal(p.readJson(`${P2}/research-attempt.json`).aheadOf[0], "1");
  const again = await research(p, {}, () => { throw new Error("no agent expected"); }, "wf_20261023-120001_aa02");
  assert.deepEqual([again.result.status, again.result.pendingPhases, again.calls.length], ["provisional", ["1"], 0]);
  // a code refresh before the phase is complete is refused
  const early = await research(p, { refresh: "code" }, () => { throw new Error("no agent expected"); }, "wf_20261023-120002_aa03");
  assert.deepEqual([early.result.status, early.result.reportStatus, early.calls.length], ["needs-owner", "provisional", 0]);
});

test("O66D code refresh: once the phase is complete only ## Code APIs is redone; outside edits and full-refresh notes are reported", async () => {
  const p = world();
  await research(p, {}, researcher(p));
  await completePhase1(p);
  const ask = await research(p, {}, null, "wf_20261023-120003_aa04");
  assert.deepEqual([ask.result.status, ask.result.reportStatus, ask.result.options[0]], ["needs-owner", "code-stale", "refresh code"], JSON.stringify(ask.result));
  const r = await research(p, { refresh: "code" }, researcher(p, { code: "- `src/api/client.js` exports connect() [VERIFIED: src/api/client.js:1]" }), "wf_20261023-120004_aa05");
  assert.equal(r.result.status, "researched", JSON.stringify(r.result));
  assert.deepEqual([r.result.part, r.result.aheadOf, r.result.reportStatus, r.result.outsideCode, r.result.needsFullRefresh], ["code", [], "complete", [], []]);
  assert.match(r.calls[0].prompt, /Code refresh: the decisions, libraries and upstream findings of \.planning\/phases\/02-api\/02-RESEARCH\.md stand/);
  assert.doesNotMatch(r.calls[0].prompt, /Research ahead/);
  assert.equal((await status(p)).json.status, "complete");
  assert.equal((await research(p, {}, null, "wf_20261023-120005_aa06")).result.status, "reused");
  // a refresh that also rewrites the Summary and flags a finding is accepted, with both reported
  p.write("src/api/client.js", "export const connect = () => 2;\n");
  const r2 = await research(p, { refresh: "code" }, researcher(p, { summaryText: "the api changed", code: "- connect() returns 2 [VERIFIED: src/api/client.js:1]", extra: "\n- Needs full refresh: Summary says the api is plain" }), "wf_20261023-120006_aa07");
  assert.deepEqual([r2.result.status, r2.result.outsideCode, r2.result.needsFullRefresh], ["researched", ["## Summary"], ["Needs full refresh: Summary says the api is plain"]], JSON.stringify(r2.result));
  assert.ok(r2.logs.some((l) => /code refresh changed sections outside ## Code APIs: ## Summary/.test(l)));
});

test("O66D code refresh resume: a run killed after the report write is accepted with no agent and compares against its first base", async () => {
  const p = world();
  await research(p, {}, researcher(p));
  await completePhase1(p);
  const run = "wf_20261023-120007_aa08";
  await assert.rejects(research(p, { refresh: "code" }, (prompt) => { researcher(p, { summaryText: "rewritten", code: "- connect() [VERIFIED: src/api/client.js:1]" })(prompt); throw new Error("runner killed"); }, run));
  assert.equal(p.readJson(`${P2}/research-attempt.json`).done, false);
  const resumed = await research(p, { refresh: "code" }, () => { throw new Error("no agent expected"); }, run);
  assert.deepEqual([resumed.result.status, resumed.calls.length, resumed.result.part, resumed.result.outsideCode], ["researched", 0, "code", ["## Summary"]], JSON.stringify(resumed.result));
  // a killed refresh whose agent wrote nothing redispatches the same attempt on resume
  p.write("src/api/client.js", "export const connect = () => 3;\n");
  const run2 = "wf_20261023-120008_aa09";
  await assert.rejects(research(p, { refresh: "code" }, () => { throw new Error("runner killed"); }, run2));
  const again = await research(p, { refresh: "code" }, researcher(p, { summaryText: "rewritten", code: "- connect() returns 3 [VERIFIED: src/api/client.js:1]" }), run2);
  assert.deepEqual([again.result.status, again.calls.length, again.result.outsideCode], ["researched", 1, []], JSON.stringify(again.result));
});

test("O66D code refresh refusals: stale decisions, a missing report, no Code APIs section, the switch off", async () => {
  const p = world();
  const none = await research(p, { refresh: "code" }, null);
  assert.deepEqual([none.result.status, none.result.reportStatus], ["needs-owner", "missing"]);
  await accepted(p, { code: "- connect() [VERIFIED: src/api/client.js:1]" });
  p.write(`${P2}/02-CONTEXT.md`, CONTEXT.replace("the api answers", "the api answers twice"));
  const stale = await research(p, { refresh: "code" }, null, "wf_20261023-120009_aa10");
  assert.deepEqual([stale.result.status, stale.result.reportStatus, stale.calls.length], ["needs-owner", "stale", 0]);
  const q = world();
  await accepted(q, { code: null });
  const noSection = await research(q, { refresh: "code" }, null);
  assert.equal(noSection.result.status, "needs-owner");
  assert.match(noSection.result.reason, /no ## Code APIs section/);
  const off = world({ ahead: false });
  const r = await research(off, { refresh: "code" }, null);
  assert.deepEqual([r.result.status, r.result.reason], ["failed", 'refresh "code" needs gsd.research_ahead; rerun with refresh true']);
});

test("O66D default unchanged: with the switch off a phase researched while an earlier one runs gets today's prompt, record and result", async () => {
  const p = world({ ahead: false });
  const r = await research(p, {}, researcher(p, { code: null }), "wf_20261023-120010_aa11");
  assert.deepEqual(r.result, { status: "researched", path: REPORT, attemptKey: r.result.attemptKey });
  assert.doesNotMatch(r.calls[0].prompt, /Research ahead|Code APIs|ahead_of|Code refresh/);
  const rec = p.readJson(`${P2}/research-attempt.json`);
  assert.deepEqual([rec.aheadOf, rec.part, rec.base], [undefined, undefined, undefined]);
  assert.equal((await status(p)).json.status, "complete");
  assert.ok(!r.gsd.calls.includes("roadmap analyze"));
  // a source edit stays a plain stale report that the default run reports with the refresh option only
  p.write("src/api/client.js", "export const connect = () => 2;\n");
  const st = await research(p, {}, null, "wf_20261023-120011_aa12");
  assert.deepEqual([st.result.status, st.result.reportStatus, st.result.options], ["needs-owner", "stale", ["refresh", "keep the report as it is"]]);
});
