// The harness method text is carried unchanged except for inventoried adapter-layer regions (HARN-01/02, D-111).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { KIT_DIR, SHIP_DIR } from "../helpers/temp.mjs";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";

const FIXTURES = path.join(KIT_DIR, "tests", "harness", "fixtures");
const SOURCE = path.join(FIXTURES, "method-source");
const SKILLS = path.join(SHIP_DIR, ".claude", "skills");
const PROV = JSON.parse(fs.readFileSync(path.join(FIXTURES, "PROVENANCE.json"), "utf8"));
const lf = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const METHOD_FILES = PROV.files.map((f) => f.file).filter((f) => f.endsWith(".md") && !f.endsWith("NOTICE.md"));

// Rebuilds the shipped file from the source and the regions; any line outside a region must be unchanged and
// every region must equal its recorded replacement.
function checkFile(rel) {
  const src = lf(path.join(SOURCE, rel)).split("\n");
  const out = lf(path.join(SKILLS, rel)).split("\n");
  const regions = PROV.regions.filter((r) => r.file === rel).sort((a, b) => a.from - b.from);
  let s = 0;
  let d = 0;
  const keep = (until) => {
    for (; s < until; s++, d++) assert.equal(out[d], src[s], `${rel}: line ${s + 1} of the source differs outside an inventoried region`);
  };
  for (const r of regions) {
    keep(r.from - 1);
    const replacement = out.slice(d, d + r.lines).join("\n");
    assert.equal(textDigest(replacement), r.sha256, `${rel}: region ${r.from}-${r.to} differs from its recorded replacement`);
    d += r.lines;
    s = r.to;
  }
  keep(src.length);
  assert.equal(d, out.length, `${rel}: extra lines after the last source line`);
}

test("HARN-01 shipped method files equal the source copy outside inventoried adapter regions", () => {
  for (const f of PROV.files) assert.equal(textDigest(lf(path.join(SOURCE, f.file))), f.sha256, `fixture ${f.file} differs from its recorded source digest`);
  assert.equal(PROV.source.tag, "ref-final");
  const expected = ["SKILL.md", "execution-modes.md", "team-patterns.md", "team-examples.md", "orchestrator-template.md", "qa-agent-guide.md",
    "skill-writing-guide.md", "skill-testing-guide.md", "model-selection-guide.md", "workflow-recipes.md", "paseo-runtime.md"];
  for (const name of expected) assert.ok(METHOD_FILES.some((f) => f.endsWith(`/${name}`)), `${name} is carried`);
  assert.ok(METHOD_FILES.includes("harness-evolve/SKILL.md"));
  for (const rel of METHOD_FILES) checkFile(rel);
});

test("HARN-01 a hunk outside the inventory fails the diff check", () => {
  const rel = "harness/references/qa-agent-guide.md";
  const file = path.join(SKILLS, rel);
  const original = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, original.replace("## ", "## Changed "), "utf8");
    assert.throws(() => checkFile(rel), /differs/);
  } finally {
    fs.writeFileSync(file, original, "utf8");
  }
});

test("HARN-02 shipped method text has no old paths, sync step, other harnesses or Backlog", () => {
  const banned = [/project\/\.agents/, /project\/CLAUDE\.md/, /skills-sync/, /codex\//, /opencode\//, /backlog/i, /paseo_harness\.mjs/, /fsbatch/, /filesystem MCP/];
  for (const dir of ["harness", "harness-evolve"]) {
    for (const name of fs.readdirSync(path.join(SKILLS, dir), { recursive: true })) {
      const file = path.join(SKILLS, dir, String(name));
      if (!file.endsWith(".md") || name === "NOTICE.md") continue;
      const text = lf(file);
      for (const re of banned) assert.doesNotMatch(text, re, `${dir}/${name} matches ${re}`);
    }
  }
});

test("HARN-02 every region has an (a)-(h) category and NOTICE lists the categories and every region", () => {
  assert.deepEqual(Object.keys(PROV.categories), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  for (const skill of ["harness", "harness-evolve"]) {
    const notice = lf(path.join(SKILLS, skill, "NOTICE.md"));
    for (const c of Object.keys(PROV.categories)) assert.match(notice, new RegExp(`- \\(${c}\\) `), `${skill} NOTICE lists (${c})`);
    for (const r of PROV.regions.filter((x) => x.file.startsWith(`${skill}/`))) {
      assert.ok(r.categories.length && r.categories.every((c) => c in PROV.categories), `${r.file} ${r.from} has categories`);
      const f = r.file.slice(skill.length + 1);
      const range = r.to < r.from ? `insertion before line ${r.from}` : `lines ${r.from}-${r.to}`;
      assert.ok(notice.includes(`\`${f}\` ${range} -> ${r.lines} line(s)`), `${skill} NOTICE lists ${f} ${range}`);
    }
  }
});

test("HARN-02 the runtime reference describes the new ph", () => {
  const rt = lf(path.join(SKILLS, "harness", "references", "paseo-runtime.md"));
  for (const s of ["node .agents/harness/ph.mjs", "ph workflow --script <file> --args-file <file> --resume <runId>", "ph watch-run", "_workspace/_runs", "max_subagents", "circle/<model>"]) {
    assert.ok(rt.includes(s), `paseo-runtime.md mentions ${s}`);
  }
});

test("HARN-03 the kit overlay exists, each SKILL.md loads it, and it names every adapter section", () => {
  const overlay = lf(path.join(SKILLS, "harness", "references", "kit-adapter.md"));
  assert.match(lf(path.join(SKILLS, "harness", "SKILL.md")), /^Kit overlay: .*`references\/kit-adapter\.md`/m);
  assert.match(lf(path.join(SKILLS, "harness-evolve", "SKILL.md")), /^Kit overlay: .*`\.claude\/skills\/harness\/references\/kit-adapter\.md`/m);
  for (const s of ["gsd-map-codebase", ".planning/codebase/", ".agents/harness.config.json", "ph.mjs harness lint", "harness-history.md", "confirm",
    "adapter.commands", "adapter.verify_vocabulary", "adapter.ownership", "adapter.review_lenses", "adapter.syntax_checkers", "adapter.instructions",
    "adapter.envelope", "adapter.stack_skill", "adapter.agents", "adapter.mutex", "gsd.roles", "gsd.granularity", "gsd.plan_limits", "reason"]) {
    assert.ok(overlay.includes(s), `overlay names ${s}`);
  }
  for (const id of ["ADPT-02", "ADPT-03", "ADPT-04", "ADPT-05", "ADPT-06", "ADPT-07", "ADPT-08", "ADPT-09", "ADPT-10", "ADPT-11", "ADPT-12", "ADPT-13"]) {
    assert.ok(overlay.includes(id), `overlay cites ${id}`);
  }
  assert.match(overlay, /standard\*\* = coding with a clear procedure/);
  assert.match(overlay, /pro\*\* = multi-step structural coding/);
});

test("HARN-08 HARN-11 the overlay states tier-only agent models and English harness files", () => {
  const overlay = lf(path.join(SKILLS, "harness", "references", "kit-adapter.md"));
  assert.match(overlay, /Agent files name only a tier in `model:`/);
  assert.match(overlay, /are in English whatever language the owner uses/);
  assert.match(overlay, /in the owner's language/);
});

test("HARN-12 harness-evolve reads the run records and names the kit pull form", () => {
  const evolve = lf(path.join(SKILLS, "harness-evolve", "SKILL.md"));
  assert.ok(evolve.includes("_workspace/_runs/*/run.json"));
  assert.ok(evolve.includes("journal.jsonl"));
  assert.match(evolve, /kit\.mjs pull <project> <files> --kit <kit dir>/);
  assert.match(evolve, /\| Date \| Change \| Scope \| Reason \| Supersedes \|/);
  const overlay = lf(path.join(SKILLS, "harness", "references", "kit-adapter.md"));
  for (const s of ["_workspace/review-metrics.jsonl", "deferred.md", "3 + 3 trigger"]) assert.ok(overlay.includes(s), `overlay evolve section names ${s}`);
});

test("HARN-16 harness skills ship the Apache-2.0 LICENSE and a NOTICE naming upstream and the kit edits", () => {
  const license = lf(path.join(SOURCE, "harness", "LICENSE"));
  assert.match(license, /Apache License\s+Version 2\.0/);
  for (const skill of ["harness", "harness-evolve"]) {
    assert.equal(lf(path.join(SKILLS, skill, "LICENSE")), license);
    const notice = lf(path.join(SKILLS, skill, "NOTICE.md"));
    for (const s of ["revfactory/harness", "2.1.0", "92d9f1b29e7af81acebf51a9fcd1832e739a1414", "Adapter-layer edits"]) assert.ok(notice.includes(s), `${skill} NOTICE has ${s}`);
  }
  assert.equal(lf(path.join(KIT_DIR, "LICENSES", "harness-Apache-2.0.txt")), license);
  assert.match(lf(path.join(SKILLS, "harness", "NOTICE.md")), /Translated from Korean to English/);
});

test("HARN-17 ai-orchestrator ships its method text with the config-read agent limit and no Backlog", () => {
  const text = lf(path.join(SKILLS, "ai-orchestrator", "SKILL.md"));
  assert.match(text, /^name: ai-orchestrator$/m);
  assert.ok(text.includes("Definition of Done") && text.includes("## Waiting for agents"));
  assert.ok(text.includes("`max_subagents`"));
  assert.doesNotMatch(text, /\b20\b/);
  assert.doesNotMatch(text, /backlog/i);
  checkFile("ai-orchestrator/SKILL.md");
  const notice = lf(path.join(SKILLS, "ai-orchestrator", "NOTICE.md"));
  for (const r of PROV.regions.filter((x) => x.file.startsWith("ai-orchestrator/"))) {
    assert.ok(notice.includes(`\`SKILL.md\` lines ${r.from}-${r.to} -> ${r.lines} line(s)`));
  }
});
