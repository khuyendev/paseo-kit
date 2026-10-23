// G121: a research or roadmap run that fails accepts only the files this run wrote; an earlier SUMMARY or draft never stands in.
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const PROJECT = { ".planning/PROJECT.md": "# P\n" };
const DIMS = ["STACK", "FEATURES", "ARCHITECTURE", "PITFALLS"];
const SUMMARY_OLD = "# Project Research Summary\n## Executive Summary\nold\n## Key Findings\nold\n## Implications for Roadmap\nold\n";
const OLD_RESEARCH = { ...Object.fromEntries(DIMS.map((d) => [`.planning/research/${d}.md`, `old ${d}\n`])), ".planning/research/SUMMARY.md": SUMMARY_OLD };
const DOC = "# Project Research Summary\n## Executive Summary\na\n## Key Findings\nb\n## Implications for Roadmap\nc\n";

// Researchers write and name their report; the synthesizer replies with `synth`; `failed` names one label that times out.
function researchAgent(w, { failed = null, synth = DOC } = {}) {
  return (p, o) => {
    if (o.label === "synthesizer") return synth;
    if (o.label === failed) return NULL("worker timed out");
    const file = `.planning/research/${o.label.replace("researcher-", "").toUpperCase()}.md`;
    w.write(file, `new ${file}\n`);
    return { written: [file] };
  };
}

const REQS = "# Requirements\n\n## v1 Requirements\n\n- [ ] **CORE-01**: a\n- [ ] **CORE-02**: b\n";
const draft = (reqs, goal = "g") => `## Phase 1: Core\n**Goal**: ${goal}\n**Requirements**: ${reqs}\n**Success Criteria**:\n1. one\n2. two\n`;
const OLD_DRAFT = { ".planning/drafts/ROADMAP.md": draft("CORE-01, CORE-02"), ".planning/drafts/traceability.json": JSON.stringify({ "CORE-01": "1", "CORE-02": "1" }) };

test("G121 research: a researcher that times out stops the stage; the earlier SUMMARY is not accepted", async () => {
  const w = makeWorld({ files: { ...PROJECT, ...OLD_RESEARCH } });
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: researchAgent(w, { failed: "researcher-stack" }) });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /project researcher stack failed: worker timed out/);
  assert.equal(r.calls.some((c) => c.opts.label === "synthesizer"), false);
});

test("G121 research: a synthesizer that times out stops the stage even when an earlier SUMMARY is valid", async () => {
  const w = makeWorld({ files: { ...PROJECT, ...OLD_RESEARCH } });
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: researchAgent(w, { synth: NULL("synthesizer timed out") }) });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /synthesizer failed: synthesizer timed out/);
  assert.equal(w.read(".planning/research/SUMMARY.md"), SUMMARY_OLD);
});

test("G121 research: a synthesizer that replies without writing SUMMARY does not keep the earlier one", async () => {
  const w = makeWorld({ files: { ...PROJECT, ...OLD_RESEARCH } });
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: researchAgent(w, { synth: "done" }) });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /\.planning\/research\/SUMMARY\.md was not written by this run/);
});

test("G121 research: a researcher that names its report without writing it does not count", async () => {
  const w = makeWorld({ files: { ...PROJECT, ...OLD_RESEARCH } });
  const stale = (p, o) => (o.label === "researcher-features" ? { written: [".planning/research/FEATURES.md"] } : researchAgent(w)(p, o));
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: stale });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /project researcher features did not write \.planning\/research\/FEATURES\.md in this run/);
});

test("G121 research: a complete run is still researched, with the synthesizer's file kept or its inline document healed", async () => {
  const w = makeWorld({ files: { ...PROJECT, ...OLD_RESEARCH } });
  const written = (p, o) => {
    if (o.label !== "synthesizer") return researchAgent(w)(p, o);
    w.write(".planning/research/SUMMARY.md", DOC.replace("a\n", "written\n"));
    return "## SYNTHESIS COMPLETE";
  };
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "research" }, agent: written });
  assert.deepEqual([r.result.status, r.result.healed], ["researched", false]);
  assert.match(w.read(".planning/research/SUMMARY.md"), /written/);
  const w2 = makeWorld({ files: { ...PROJECT, ...OLD_RESEARCH } });
  const inline = await runScript("gsd-new-project", { root: w2.root, gsd: w2.gsd, args: { stage: "research" }, agent: researchAgent(w2) });
  assert.deepEqual([inline.result.status, inline.result.healed], ["researched", true]);
  assert.equal(w2.read(".planning/research/SUMMARY.md"), DOC);
});

test("G121 roadmap: a roadmapper that times out fails the stage and leaves the earlier draft in place", async () => {
  const w = makeWorld({ files: { ...PROJECT, ".planning/REQUIREMENTS.md": REQS, ...OLD_DRAFT } });
  const before = w.read(".planning/drafts/ROADMAP.md");
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "roadmap", feedback: "split core" }, agent: () => NULL("worker timed out") });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /roadmapper failed: worker timed out/);
  assert.equal(w.read(".planning/drafts/ROADMAP.md"), before);
});

test("G121 roadmap: a roadmapper that replies without rewriting the draft does not reuse the earlier one", async () => {
  const w = makeWorld({ files: { ...PROJECT, ".planning/REQUIREMENTS.md": REQS, ...OLD_DRAFT } });
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "roadmap" }, agent: () => ({ written: [] }) });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /roadmapper did not write \.planning\/drafts\/ROADMAP\.md in this run/);
});

test("G121 roadmap: a new ROADMAP that does not name the traceability file is not a draft of this run", async () => {
  const w = makeWorld({ files: { ...PROJECT, ".planning/REQUIREMENTS.md": REQS, ...OLD_DRAFT } });
  const agent = () => { w.write(".planning/drafts/ROADMAP.md", draft("CORE-01, CORE-02", "new goal")); return { written: [".planning/drafts/ROADMAP.md"] }; };
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "roadmap" }, agent });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /roadmapper did not write \.planning\/drafts\/traceability\.json in this run/);
});

test("G121 roadmap: a rerun that rewrites the ROADMAP and repeats the same traceability is draft-ready", async () => {
  const w = makeWorld({ files: { ...PROJECT, ".planning/REQUIREMENTS.md": REQS, ...OLD_DRAFT } });
  const agent = () => { w.write(".planning/drafts/ROADMAP.md", draft("CORE-01, CORE-02", "new goal")); w.write(".planning/drafts/traceability.json", JSON.stringify({ "CORE-01": "1", "CORE-02": "1" })); return { written: [".planning/drafts/ROADMAP.md", ".planning/drafts/traceability.json"] }; };
  const r = await runScript("gsd-new-project", { root: w.root, gsd: w.gsd, args: { stage: "roadmap" }, agent });
  assert.equal(r.result.status, "draft-ready");
});
