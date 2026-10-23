// P70 (kit feedback 70): gsd-plan never wrote <NN>-VALIDATION.md while the vendored checker kept Dimension 8e as a blocker.
// Upstream plan-phase step 5.5 is now a step of gsd-plan (flow verb validation-strategy, gsd.validation_strategy), the checker is
// told whether Dimension 8 applies, and the file's source digest joins the plans/checked/handoff revision keys.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";
import { P1, gsd, project } from "../gsd-core/fixture.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const TEMPLATE = ".agents/gsd/upstream/gsd-core/templates/VALIDATION.md";
const templateText = fs.readFileSync(path.join(SHIP_DIR, TEMPLATE), "utf8");
const VALIDATION = `${PHASE_DIR}/01-VALIDATION.md`;
const RESEARCH_WITH = "# Research\n\n## Summary\nx\n\n## Validation Architecture\n\n### Test Framework\n| Framework | node:test |\n\n### Wave 0 Gaps\n- none\n\n## Sources\ny\n";
const world = (opts = {}) => makeWorld({ ...opts, files: { [TEMPLATE]: templateText, [`${PHASE_DIR}/01-RESEARCH.md`]: RESEARCH_WITH, ...(opts.files ?? {}) } });
const DOCS = { gsd: { commit_policy: { docs: true, code: "per-wave" } } };
const plan = (w, args = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w) });
const checkerPrompts = (r) => r.calls.filter((c) => c.opts.label.startsWith("checker-")).map((c) => c.prompt);
const strategyCommits = (w) => w.events.filter((e) => /add validation strategy/.test(e)).length;
const verb = async (w, phaseDir = PHASE_DIR) => {
  let line = "";
  const code = await main(["validation-strategy", phaseDir], { root: w.root, out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
};

test("P70 gsd-plan renders <NN>-VALIDATION.md from the template and the research section, commits it and tells the checker", async () => {
  const w = world({ overlay: DOCS });
  const r = await plan(w);
  assert.equal(r.result.status, "planned");
  assert.deepEqual(r.result.validation, { status: "written", path: VALIDATION });
  const text = w.read(VALIDATION).replace(/\r\n/g, "\n");
  assert.match(text, /^---\nphase: "01"\nslug: "core"\n/);
  assert.match(text, /^status: draft$/m);
  assert.match(text, /created: "\d{4}-\d{2}-\d{2}"/);
  assert.match(text, /^# Phase 01 — Validation Strategy$/m);
  assert.match(text, /^<!-- gsd:validation-source [0-9a-f]{64} -->$/m);
  assert.match(text, /## Research: Validation Architecture[\s\S]*### Test Framework\n\| Framework \| node:test \|[\s\S]*### Wave 0 Gaps\n- none\n$/);
  assert.doesNotMatch(text, /## Sources/);
  assert.equal(strategyCommits(w), 1, w.events.join("|"));
  assert.ok(w.events.some((e) => e.includes(`--files ${VALIDATION}`)), w.events.join("|"));
  const prompts = checkerPrompts(r);
  assert.ok(prompts.length >= 1);
  for (const p of prompts) assert.match(p, /Nyquist validation \(checker Dimension 8\): applies; \.planning\/phases\/01-core\/01-VALIDATION\.md exists, so check 8e passes/);
});

test("P70 a rerun keeps the file: no second write, no second commit; a hand-written file is never touched", async () => {
  const w = world({ overlay: DOCS });
  await plan(w);
  const first = w.read(VALIDATION);
  assert.equal(strategyCommits(w), 1);
  const again = await plan(w);
  assert.deepEqual(again.result.validation, { status: "kept", path: VALIDATION });
  assert.equal(w.read(VALIDATION), first);
  assert.equal(strategyCommits(w), 1);
  const mine = "---\nstatus: validated\nnyquist_compliant: true\n---\nmine\n";
  const hand = world({ overlay: DOCS, files: { [VALIDATION]: mine } });
  const r = await plan(hand);
  assert.equal(r.result.validation.status, "kept");
  assert.equal(hand.read(VALIDATION), mine);
  assert.equal(strategyCommits(hand), 0);
  assert.deepEqual(r.result.warnings.filter((x) => /validation/.test(x)), []);
});

test("P70 with commit_policy.docs off (the default) the file is written and not committed", async () => {
  const w = world();
  assert.equal((await plan(w)).result.validation.status, "written");
  assert.equal(strategyCommits(w), 0);
});

test("P70 a changed research re-renders a draft file; a validated one is kept with a warning", async () => {
  const w = world();
  await plan(w);
  const before = w.read(VALIDATION);
  w.write(`${PHASE_DIR}/01-RESEARCH.md`, RESEARCH_WITH.replace("node:test", "vitest"));
  const r = await plan(w);
  assert.equal(r.result.validation.status, "refreshed");
  assert.match(w.read(VALIDATION), /vitest/);
  assert.notEqual(w.read(VALIDATION), before);
  w.write(VALIDATION, w.read(VALIDATION).replace("status: draft", "status: validated"));
  const validated = w.read(VALIDATION);
  w.write(`${PHASE_DIR}/01-RESEARCH.md`, RESEARCH_WITH.replace("node:test", "jest"));
  const r2 = await plan(w);
  assert.equal(r2.result.validation.status, "kept");
  assert.equal(w.read(VALIDATION), validated);
  assert.ok(r2.result.warnings.some((x) => /rendered from an older/.test(x)), r2.result.warnings.join("|"));
});

test("P70 the checker gets an explicit Dimension 8 skip when the step is off, research is skipped or the section is missing", async () => {
  const skip = /Nyquist validation \(checker Dimension 8\): SKIPPED, (.*?)\. The checker reports "Dimension 8: SKIPPED/;
  const off = world({ overlay: { gsd: { validation_strategy: false } } });
  const r1 = await plan(off);
  assert.equal(r1.result.status, "planned");
  assert.equal(off.read(VALIDATION), "");
  assert.equal(r1.result.validation, undefined);
  assert.ok(checkerPrompts(r1).length >= 1);
  for (const p of checkerPrompts(r1)) assert.equal(skip.exec(p)?.[1], "gsd.validation_strategy is off");
  const skipped = world();
  const r2 = await plan(skipped, { skipResearch: true, researchSkipReason: "trivial" });
  assert.equal(skipped.read(VALIDATION), "");
  assert.ok(checkerPrompts(r2).length >= 1);
  for (const p of checkerPrompts(r2)) assert.equal(skip.exec(p)?.[1], "no approved research in this run");
  const none = world({ files: { [`${PHASE_DIR}/01-RESEARCH.md`]: "# Research\n\nnothing on validation\n" } });
  const r3 = await plan(none);
  assert.equal(r3.result.status, "planned");
  assert.equal(none.read(VALIDATION), "");
  assert.equal(r3.result.validation.status, "no-section");
  assert.ok(r3.result.warnings.some((x) => /has no Validation Architecture section/.test(x)));
  for (const p of checkerPrompts(r3)) assert.equal(skip.exec(p)?.[1], "the approved research has no Validation Architecture section");
});

test("P70 a missing template stops the run (upstream: STOP) before any agent and writes nothing", async () => {
  const w = world();
  fs.rmSync(path.join(w.root, TEMPLATE));
  const r = await plan(w);
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /validation strategy: validation template missing/);
  assert.equal(r.calls.length, 0);
  assert.equal(w.read(VALIDATION), "");
});

test("P70 the verb: research without the section, no research and a bad phase dir report without writing", async () => {
  const w = world({ files: { [`${PHASE_DIR}/01-RESEARCH.md`]: "# R\n## Validation Architecture Notes\nnot the section\n" } });
  assert.deepEqual((await verb(w)).json, { ok: true, status: "no-section" });
  const none = makeWorld({ research: false });
  assert.deepEqual((await verb(none)).json, { ok: true, status: "no-research" });
  const bad = await verb(w, ".planning/phases/core");
  assert.equal(bad.code, 1);
  assert.match(bad.json.error, /not a phase directory/);
  assert.equal(w.read(VALIDATION), "");
});

test("P70 CRLF research renders the same source digest as LF research", async () => {
  const lf = world();
  const crlf = world({ files: { [`${PHASE_DIR}/01-RESEARCH.md`]: RESEARCH_WITH.replace(/\n/g, "\r\n") } });
  await verb(lf);
  await verb(crlf);
  const marker = (w) => /gsd:validation-source ([0-9a-f]{64})/.exec(w.read(VALIDATION))[1];
  assert.equal(marker(lf), marker(crlf));
});

test("P70 the file's source digest joins the plans, checked and handoff keys, not inputs or freeze; a hand-written file joins nothing", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>\n", [`${P1}/01-RESEARCH.md`]: RESEARCH_WITH } });
  const hash = async (key) => (await gsd(p, ["revisions", "hash", "1", key])).json.hash;
  const keys = ["inputs", "freeze", "plans", "checked", "handoff"];
  const base = {};
  for (const k of keys) base[k] = await hash(k);
  p.write(`${P1}/01-VALIDATION.md`, "---\nstatus: validated\n---\nhand written\n");
  for (const k of keys) assert.equal(await hash(k), base[k], `hand-written: ${k}`);
  p.write(`${P1}/01-VALIDATION.md`, `---\nstatus: draft\n---\n<!-- gsd:validation-source ${"a".repeat(64)} -->\n`);
  for (const k of ["inputs", "freeze"]) assert.equal(await hash(k), base[k], `marked: ${k}`);
  const marked = {};
  for (const k of ["plans", "checked", "handoff"]) { marked[k] = await hash(k); assert.notEqual(marked[k], base[k], `marked: ${k}`); }
  p.write(`${P1}/01-VALIDATION.md`, `---\nstatus: validated\n---\n<!-- gsd:validation-source ${"a".repeat(64)} -->\nfilled in later\n`);
  for (const k of ["plans", "checked", "handoff"]) assert.equal(await hash(k), marked[k], `edited after validate-phase: ${k}`);
  p.write(`${P1}/01-VALIDATION.md`, `---\nstatus: draft\n---\n<!-- gsd:validation-source ${"b".repeat(64)} -->\n`);
  assert.notEqual(await hash("checked"), marked.checked);
});

test("P70 gsd.validation_strategy is a boolean defaulting to true", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.equal(defaults.gsd.validation_strategy, true);
  assert.doesNotThrow(() => validateAgainstSchema(defaults));
  assert.throws(() => validateAgainstSchema({ ...defaults, gsd: { ...defaults.gsd, validation_strategy: "yes" } }), /validation_strategy/);
});
