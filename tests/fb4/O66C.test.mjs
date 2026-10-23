// Kit feedback #66 point 4 (O66C): gsd.verify_mode per-criterion runs one verifier per ROADMAP success criterion plus one
// for the phase-wide checks, at once and bounded; `verification merge` writes the report from their parts, and only the
// criteria that need a human reach UAT. The default (phase) keeps the one verifier.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { canonicalVerification } from "../../ship/.agents/harness/gsd/phases.mjs";
import { requirePhase } from "../../ship/.agents/harness/gsd/planning.mjs";
import { fingerprint, readVerification, verificationParts, verificationStatusVerb } from "../../ship/.agents/harness/gsd/status.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, planText } from "../gsd-flows/world.mjs";

const CRITERIA = ["A client completes the handshake | over direct WebSocket", "Two sessions report independent status"];
const REPORT = `${PHASE_DIR}/01-VERIFICATION.md`;

// The verification verbs run for real against the world's temp project; the roadmap and routing verbs are faked.
function pcWorld({ gsd = { verify_mode: "per-criterion" }, criteria = CRITERIA } = {}) {
  const w = makeWorld({ overlay: { gsd }, files: { [`${PHASE_DIR}/01-01-PLAN.md`]: planText("01-01"), [`${PHASE_DIR}/01-01-SUMMARY.md`]: "summary\n" } });
  const phase = () => requirePhase(w.root, PHASE_DIR);
  const real = (fn) => (args, input) => {
    try { return fn(args, input); } catch (e) { return { code: e.exitCode ?? 1, json: { ...(e.extra ?? {}), error: e.message } }; }
  };
  w.gsd.on("roadmap get-phase", () => ({ found: true, phase_number: "1", goal: "core works", success_criteria: criteria }));
  w.gsd.on("verification status", real(() => verificationStatusVerb(w.root, phase())));
  w.gsd.on("verification fingerprint", real((args) => ({ code: 0, json: fingerprint(w.root, phase(), args.slice(1)) })));
  w.gsd.on("verification parts", real((_a, input) => verificationParts(w.root, phase(), JSON.parse(input), false)));
  w.gsd.on("verification merge", real((_a, input) => verificationParts(w.root, phase(), JSON.parse(input), true)));
  w.gsd.on("phase complete", () => { w.events.push("phase complete"); return { completed: true, warnings: [] }; });
  w.gsd.on("requirements revert", () => { w.events.push("requirements revert"); return { reverted: ["R-1"] }; });
  return w;
}

const scalar = (v) => (typeof v === "string" && /^[\w.-]+$/.test(v) ? v : JSON.stringify(v));
const partText = (fm, body) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${scalar(v)}`).join("\n")}\n---\n${body}\n`;

// A verifier that writes the part its prompt names; verdicts: unit id -> status | "null" | "fatal" | "bad" | fn(prompt, n).
function verifiers(w, verdicts = {}, { delayMs = 0 } = {}) {
  const seen = {};
  return async (prompt) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const file = /Write (\S+) \(status/.exec(prompt)[1];
    const id = /criterion: (\S+),/.exec(prompt)[1];
    seen[id] = (seen[id] ?? 0) + 1;
    const v = typeof verdicts[id] === "function" ? verdicts[id](prompt, seen[id]) : verdicts[id] ?? "passed";
    if (v === "null") return NULL("runner error: killed");
    if (v === "fatal") return NULL("usage limit reached");
    const fm = { status: v === "bad" ? "passed" : v, criterion: id, attempt_key: /attempt_key: "([^"]+)"/.exec(prompt)[1], covered_files: JSON.parse(/covered_files: (\[.*?\]), covered_digest/.exec(prompt)[1]), covered_digest: /covered_digest: (\S+)/.exec(prompt)[1] };
    if (v === "gaps_found" || v === "bad") fm.gaps = [{ truth: `${id} truth`, status: "failed", reason: "not wired" }];
    if (v === "human_needed") fm.human_verification = [{ test: `look at ${id}`, expected: "it shows", why_human: "visual" }];
    w.write(file, partText(fm, `${id} findings`));
    return { status: fm.status, path: file };
  };
}
const verify = (w, agent, runId) => runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR }, agent, ...(runId ? { runId } : {}) });
const labels = (r) => r.calls.map((c) => c.opts.label).sort();

test("O66C per-criterion: one verifier per criterion and one for the phase checks; only the criterion needing a human goes to UAT", async () => {
  const w = pcWorld();
  const r = await verify(w, verifiers(w, { "SC-2": "human_needed" }));
  assert.equal(r.result.status, "human_needed", JSON.stringify(r.result));
  assert.deepEqual(labels(r), ["verifier SC-1", "verifier SC-2", "verifier phase"]);
  assert.deepEqual([r.result.mode, r.result.route, r.result.dispatched], ["per-criterion", "uat", 3]);
  assert.deepEqual(r.result.criteria.map((c) => [c.id, c.status, c.reused]), [["SC-1", "passed", false], ["SC-2", "human_needed", false], ["phase", "passed", false]]);
  const sc1 = r.calls.find((c) => c.opts.label === "verifier SC-1").prompt;
  assert.match(sc1, /Verify ONE ROADMAP success criterion of phase 01, SC-1: "A client completes the handshake \| over direct WebSocket"/);
  assert.match(sc1, /do not write \.planning\/phases\/01-core\/01-VERIFICATION\.md \(the run merges the parts\)/);
  assert.match(r.calls.find((c) => c.opts.label === "verifier phase").prompt, /do not judge the criteria themselves/);
  const uat = w.read(`${PHASE_DIR}/01-UAT.md`);
  assert.match(uat, /### 1\. SC-2: look at SC-2\nexpected: it shows/);
  assert.doesNotMatch(uat, /SC-1|### 2\./);
  const report = w.read(REPORT);
  assert.match(report, /^verify_mode: per-criterion$/m);
  assert.match(report, /^score: "1\/2 criteria verified"$/m);
  assert.match(report, /\| SC-1 \| A client completes the handshake \\\| over direct WebSocket \| passed \|/);
  assert.match(report, /## SC-2: Two sessions report independent status\n\nSC-2 findings/);
  const v = readVerification(w.root, requirePhase(w.root, PHASE_DIR));
  assert.deepEqual([v.valid, v.status, v.human_verification[0].criterion], [true, "human_needed", "SC-2"]);
  // The UAT pass canonicalises the merged report as it does a single one.
  fs.writeFileSync(path.join(w.root, REPORT), canonicalVerification(report));
  assert.equal(readVerification(w.root, requirePhase(w.root, PHASE_DIR)).status, "passed");
});

test("O66C per-criterion: all passed completes the phase; a gap in one criterion routes to gap planning tagged with it", async () => {
  const w = pcWorld();
  const p = await verify(w, verifiers(w));
  assert.deepEqual([p.result.status, p.result.route, w.events.includes("phase complete")], ["passed", "complete", true]);
  assert.match(w.read(REPORT), /^score: "2\/2 criteria verified"$/m);
  const g = pcWorld();
  const gr = await verify(g, verifiers(g, { "SC-1": "gaps_found", "SC-2": "human_needed" }));
  assert.deepEqual([gr.result.status, gr.result.route, g.events.includes("requirements revert")], ["gaps_found", "plan-gaps", true]);
  assert.deepEqual(gr.result.gaps.map((x) => x.criterion), ["SC-1"]);
  assert.deepEqual(gr.result.humanVerification.map((x) => x.criterion), ["SC-2"]);
});

test("O66C per-criterion: verifiers run at once, never above gsd.parallelization.max_concurrent", async () => {
  const w = pcWorld({ gsd: { verify_mode: "per-criterion", parallelization: { enabled: true, max_concurrent: 2 } }, criteria: ["a", "b", "c", "d"] });
  let peak = 0;
  const inner = verifiers(w, {}, { delayMs: 20 });
  let running = 0;
  const r = await verify(w, async (p) => { running++; peak = Math.max(peak, running); try { return await inner(p); } finally { running--; } });
  assert.equal(r.result.status, "passed", JSON.stringify(r.result));
  assert.equal(r.calls.length, 5);
  assert.equal(peak, 2);
});

test("O66C per-criterion: a verifier that died fails the run naming it; --resume reruns only that criterion; a new run verifies all again", async () => {
  const w = pcWorld();
  const first = await verify(w, verifiers(w, { "SC-2": "null" }), "wf_a");
  assert.equal(first.result.status, "failed");
  assert.match(first.result.reason, /no valid report from SC-2 \(no \.planning\/phases\/01-core\/verify\/SC-2\.md\); --resume reruns/);
  assert.deepEqual(first.result.criteria.map((c) => [c.id, c.status]), [["SC-1", "passed"], ["SC-2", "missing"], ["phase", "passed"]]);
  assert.equal(w.read(REPORT), "");
  const resumed = await verify(w, verifiers(w), "wf_a");
  assert.equal(resumed.result.status, "passed", JSON.stringify(resumed.result));
  assert.deepEqual(labels(resumed), ["verifier SC-2"]);
  assert.deepEqual(resumed.result.criteria.map((c) => [c.id, c.reused]), [["SC-1", true], ["SC-2", false], ["phase", true]]);
  assert.ok(resumed.logs.some((l) => /kept the parts of this attempt for SC-1, phase/.test(l)));
  // A finished attempt is read back on resume without any agent.
  const again = await verify(w, () => { throw new Error("no agent expected"); }, "wf_a");
  assert.deepEqual([again.result.status, again.calls.length], ["passed", 0]);
  // Another run is another attempt: parts of the earlier attempt are not adopted.
  const fresh = await verify(w, verifiers(w), "wf_b");
  assert.equal(fresh.result.status, "passed", JSON.stringify(fresh.result));
  assert.equal(fresh.calls.length, 3);
});

test("O66C per-criterion: an invalid part gets one rewrite naming its problems; still invalid fails; a fatal reply stops the queue", async () => {
  const w = pcWorld();
  const fixed = await verify(w, verifiers(w, { "SC-1": (_p, n) => (n === 1 ? "bad" : "passed") }));
  assert.equal(fixed.result.status, "passed", JSON.stringify(fixed.result));
  const rewrites = fixed.calls.filter((c) => c.opts.label === "verifier SC-1");
  assert.equal(rewrites.length, 2);
  assert.match(rewrites[1].prompt, /was rejected: status passed with gaps, human_verification or behavior_unverified\. Rewrite it\./);
  const w2 = pcWorld();
  const bad = await verify(w2, verifiers(w2, { phase: "bad" }));
  assert.equal(bad.result.status, "failed");
  assert.match(bad.result.reason, /no valid report from phase \(status passed with gaps/);
  assert.equal(bad.calls.length, 4);
  const w3 = pcWorld({ gsd: { verify_mode: "per-criterion", parallelization: { enabled: true, max_concurrent: 1 } } });
  const fatal = await verify(w3, verifiers(w3, { "SC-1": "fatal" }));
  assert.deepEqual([fatal.result.status, fatal.calls.length], ["failed", 1]);
  assert.match(fatal.result.reason, /verifier SC-1 failed: usage limit reached/);
  assert.deepEqual(fatal.result.criteria.map((c) => c.status), ["missing", "skipped", "skipped"]);
});

test("O66C default verify_mode phase is unchanged: one verifier, the roadmap is not read, no parts", async () => {
  const w = pcWorld({ gsd: {} });
  const r = await verify(w, (prompt) => {
    const files = JSON.parse(/covered_files: (\[.*?\]), covered_digest/.exec(prompt)[1]);
    w.write(REPORT, partText({ status: "passed", covered_files: files, covered_digest: /covered_digest: (\S+)/.exec(prompt)[1] }, "report"));
    return { status: "passed" };
  });
  assert.equal(r.result.status, "passed", JSON.stringify(r.result));
  assert.deepEqual([r.result.mode, r.result.criteria, r.calls.length, r.calls[0].opts.label], ["phase", undefined, 1, "verifier"]);
  assert.equal(w.gsd.callsOf("roadmap get-phase").length + w.gsd.callsOf("verification parts").length + w.gsd.callsOf("verification merge").length, 0);
  const lines = r.calls[0].prompt.split("\n\n");
  assert.deepEqual(lines.slice(0, 5), [
    "Verify phase 01 against its goal. Write .planning/phases/01-core/01-VERIFICATION.md (status passed|gaps_found|human_needed) and do not commit.",
    "Read: the phase PLAN files and SUMMARY files (claims, not proof), .planning/ROADMAP.md, .planning/REQUIREMENTS.md, the phase CONTEXT and WIRING when present, the previous report when present, and the gate evidence below.",
    "Gate evidence (current; proof of what ran): none",
    "Do not rerun anything: no build, no tests, no commands with side effects.",
    `Put these fingerprint fields in the report frontmatter verbatim: covered_files: ${JSON.stringify(fingerprint(w.root, requirePhase(w.root, PHASE_DIR), []).covered_files)}, covered_digest: ${fingerprint(w.root, requirePhase(w.root, PHASE_DIR), []).covered_digest}`,
  ]);
  assert.match(lines[6], /^Input digest \(verify\): /);
});

test("O66C per-criterion without success criteria falls back to the one verifier and says so", async () => {
  const w = pcWorld({ criteria: [] });
  const r = await verify(w, (prompt) => {
    const files = JSON.parse(/covered_files: (\[.*?\]), covered_digest/.exec(prompt)[1]);
    w.write(REPORT, partText({ status: "passed", covered_files: files, covered_digest: /covered_digest: (\S+)/.exec(prompt)[1] }, "report"));
    return { status: "passed" };
  });
  assert.deepEqual([r.result.status, r.result.mode, r.calls.length], ["passed", "phase", 1]);
  assert.match(r.result.fallback, /ROADMAP phase 01 has no success criteria/);
  assert.ok(r.logs.some((l) => /verify_mode per-criterion: ROADMAP phase 01 has no success criteria; one verifier for the phase/.test(l)));
});

test("O66C verification merge refuses a part of another attempt, of another criterion, outside verify/, or stale", () => {
  const w = pcWorld();
  const phase = requirePhase(w.root, PHASE_DIR);
  const fp = fingerprint(w.root, phase, []);
  const base = { status: "passed", criterion: "SC-1", attempt_key: "k1", covered_files: fp.covered_files, covered_digest: fp.covered_digest };
  w.write(`${PHASE_DIR}/verify/SC-1.md`, partText(base, "ok"));
  w.write(`${PHASE_DIR}/verify/phase.md`, partText({ ...base, criterion: "SC-9" }, "wrong id"));
  w.write(`${PHASE_DIR}/SC-1.md`, partText(base, "outside"));
  const parts = [{ id: "SC-1", path: `${PHASE_DIR}/verify/SC-1.md`, text: "a" }, { id: "phase", path: `${PHASE_DIR}/verify/phase.md` }];
  const other = verificationParts(w.root, phase, { attemptKey: "k2", parts }, true);
  assert.equal(other.code, 1);
  assert.deepEqual(other.json.parts.map((p) => p.problems), [["attempt_key is not this attempt's key"], ["criterion must be phase (got \"SC-9\")", "attempt_key is not this attempt's key"]]);
  assert.equal(fs.existsSync(path.join(w.root, REPORT)), false);
  const outside = verificationParts(w.root, phase, { attemptKey: "k1", parts: [{ id: "SC-1", path: `${PHASE_DIR}/SC-1.md` }] }, false);
  assert.match(outside.json.parts[0].problems[0], /part path must be inside \.planning\/phases\/01-core\/verify\//);
  assert.throws(() => verificationParts(w.root, phase, { attemptKey: "k1", parts: [parts[0], parts[0]] }, false), /duplicate part ids/);
  assert.equal(verificationParts(w.root, phase, { attemptKey: "k1", parts: [parts[0]] }, false).code, 0);
  w.write(`${PHASE_DIR}/01-01-SUMMARY.md`, "summary changed after the part\n");
  const stale = verificationParts(w.root, phase, { attemptKey: "k1", parts: [parts[0]] }, true);
  assert.deepEqual([stale.code, stale.json.parts[0].problems], [1, ["covered_digest differs from the covered files (stale)"]]);
});
