// gsd-research.js and gsd-verify.js against the fake host.
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "./host.mjs";
import { makeWorld, PHASE_DIR } from "./world.mjs";

const REPORT = `${PHASE_DIR}/01-RESEARCH.md`;
// research status reads the report frontmatter the way GSDC-32 does (simplified): key, digest, status, marker.
function researchWorld() {
  const w = makeWorld({ research: false });
  w.gsd.on("research prompt", () => ({ prompt: "<upstream research dispatch>", path: REPORT }));
  w.gsd.on("research status", () => {
    const t = w.read(REPORT);
    if (!t) return { code: 66, json: { status: "missing" } };
    const f = (k) => new RegExp(`^${k}: (.*)$`, "m").exec(t)?.[1] ?? null;
    const digest = w.gsd.handlers["revisions hash"]([PHASE_DIR, "research"]).hash;
    const json = { status: f("status"), attempt_key: f("attempt_key"), input_digest: f("input_digest") };
    if (json.status === "blocked") return { code: 1, json: { ...json, blockers: ["needs owner"] } };
    if (json.input_digest !== digest) return { code: 1, json: { ...json, status: "stale" } };
    return { code: 0, json };
  });
  return w;
}
const writeReport = (w, prompt, status = "complete") => {
  const key = /attempt_key: ([^\s;]+)/.exec(prompt)[1];
  const digest = /input_digest: (\S+)/.exec(prompt)[1];
  w.write(REPORT, `---\nstatus: ${status}\ninput_digest: ${digest}\nattempt_key: ${key}\n---\nfindings\n<!-- gsd:research-complete ${key} -->\n`);
};
const research = (w, args, agent, runId) => runScript("gsd-research", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, ...args }, agent, ...(runId ? { runId } : {}) });

test("GSDF-12 research: reuse, attempt keys per run, resume adopts the report, an old key fails, blocked needs the owner", async () => {
  const w = researchWorld();
  const view = await research(w, { view: true });
  assert.deepEqual([view.result.status, view.calls.length], ["failed", 0]);
  const r1 = await research(w, {}, (p) => { writeReport(w, p); return { status: "complete" }; }, "wf_a");
  assert.equal(r1.result.status, "researched", JSON.stringify(r1.result) + w.read(REPORT));
  assert.match(r1.calls[0].prompt, /^<upstream research dispatch>[\s\S]*Input digest \(research\): /);
  assert.equal((await research(w, {}, null)).result.status, "reused");
  const k1 = r1.result.attemptKey;
  const r2 = await research(w, { refresh: true }, (p) => { writeReport(w, p); return { status: "complete" }; }, "wf_b");
  assert.notEqual(r2.result.attemptKey, k1);
  // killed after the report write: same run resumed -> accepted with no agent; a fresh run dispatches again
  let killedPrompt = null;
  await research(w, { refresh: true }, (p) => { killedPrompt = p; writeReport(w, p); return NULL("runner error: killed"); }, "wf_c");
  w.attempts.research.done = false;
  const resumed = await research(w, { refresh: true }, () => { throw new Error("no agent expected"); }, "wf_c");
  assert.deepEqual([resumed.result.status, resumed.calls.length], ["researched", 0]);
  w.attempts.research.done = false;
  const fresh = await research(w, { refresh: true }, () => ({ status: "complete" }), "wf_d");
  assert.equal(fresh.calls.length, 1);
  assert.equal(fresh.result.status, "failed");
  assert.match(fresh.result.reason, /not this attempt's/);
  assert.ok(killedPrompt);
  const blocked = await research(w, { refresh: true }, (p) => { writeReport(w, p, "blocked"); return { status: "blocked" }; }, "wf_e");
  assert.deepEqual([blocked.result.status, blocked.result.stage], ["needs-owner", "Research"]);
});

test("GSDF-12 an unfinished discuss stops research before any agent", async () => {
  const w = researchWorld();
  w.write(`${PHASE_DIR}/01-DISCUSS-CHECKPOINT.json`, "{}");
  const r = await research(w, {}, () => ({ status: "complete" }));
  assert.deepEqual([r.result.stage, r.calls.length], ["Discuss", 0]);
});

const REPORT_V = `${PHASE_DIR}/01-VERIFICATION.md`;
function verifyWorld() {
  const w = makeWorld();
  w.gsd.on("verification status", () => {
    const t = w.read(REPORT_V);
    if (!t) return { code: 66, json: { status: "missing" } };
    const status = /^status: (.*)$/m.exec(t)?.[1];
    if (!["passed", "gaps_found", "human_needed"].includes(status)) return { code: 1, json: { status: "invalid", error: "bad status" } };
    return { code: 0, json: { status, sha: `sha-${t.length}-${t.charCodeAt(t.length - 2)}`, score: "3/3", gaps: status === "gaps_found" ? [{ id: "G1" }] : [], human_verification: status === "human_needed" ? [{ test: "open the app", expected: "it starts" }] : [] } };
  });
  w.gsd.on("verification fingerprint", () => ({ covered_files: ["a"], covered_digest: "kit:abc" }));
  w.gsd.on("phase complete", () => { w.events.push("phase complete"); return { completed: true, warnings: [] }; });
  w.gsd.on("requirements revert", () => { w.events.push("requirements revert"); return { reverted: ["R-1"] }; });
  return w;
}
const verify = (w, agent, args = {}, runId) => runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR, ...args }, agent, ...(runId ? { runId } : {}) });
const writes = (w, status) => () => { w.write(REPORT_V, `---\nstatus: ${status}\n---\nreport ${status}\n`); return { status: "passed" }; };

test("GSDF-55 the report file's status wins; no file, an unchanged report and stale evidence are handled", async () => {
  const w = verifyWorld();
  const r = await verify(w, writes(w, "gaps_found"));
  assert.equal(r.result.status, "gaps_found");
  assert.ok(r.logs.some((l) => /verifier returned passed but .* says gaps_found; the file wins/.test(l)));
  assert.match(r.calls[0].prompt, /Do not rerun anything/);
  const none = await verify(verifyWorld(), () => ({ status: "passed" }));
  assert.equal(none.result.status, "failed");
  const same = await verify(w, () => ({ status: "gaps_found" }), {}, "wf_second");
  assert.match(same.result.reason, /unchanged from the previous report/);
  const w2 = verifyWorld();
  w2.write("src/a.js", "a\n");
  w2.write(`${PHASE_DIR}/evidence/w1-1.json`, JSON.stringify({ v: 1, waveId: "w1", at: "2026-10-20T00:00:00Z", inputs: { head: null, scopes: ["src"], files: { "src/a.js": "old" } }, steps: [] }));
  const st = await verify(w2, writes(w2, "passed"), { evidence: [`${PHASE_DIR}/evidence/w1-1.json`] });
  assert.match(st.calls[0].prompt, /Stale or invalid evidence \(NOT proof[^\n]*w1-1\.json \(incomplete\)/);
  assert.match(st.calls[0].prompt, /Gate evidence \(current; proof of what ran\): none/);
});

test("GSDF-56 passed completes the phase, human_needed writes UAT without completing, gaps_found reverts requirement marks", async () => {
  const w = verifyWorld();
  const p = await verify(w, writes(w, "passed"));
  assert.deepEqual([p.result.route, w.events.includes("phase complete")], ["complete", true]);
  const h = verifyWorld();
  const hr = await verify(h, writes(h, "human_needed"));
  assert.equal(hr.result.route, "uat");
  assert.match(h.read(`${PHASE_DIR}/01-UAT.md`), /status: testing[\s\S]*### 1\. open the app\nexpected: it starts\nresult: \[pending\]/);
  assert.equal(h.events.includes("phase complete"), false);
  const g = verifyWorld();
  const gr = await verify(g, writes(g, "gaps_found"));
  assert.deepEqual([gr.result.route, g.events.includes("requirements revert")], ["plan-gaps", true]);
});
