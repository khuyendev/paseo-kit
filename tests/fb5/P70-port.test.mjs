// P70 port check (kit feedback 70): a port drops an upstream step and keeps the check that depends on it (VALIDATION.md: plan-phase
// step 5.5 dropped, plan checker 8e kept as a blocker). Every phase artifact the vendored plan checker (and the references it
// loads) names is classified here, and every one whose absence blocks has a producing step in the kit flow. A re-vendored checker
// that names a new artifact fails until the artifact is classified.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";

const UPSTREAM = path.join(SHIP_DIR, ".agents", "gsd", "upstream");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");
const checker = read(UPSTREAM, "agents", "gsd-plan-checker.md");
const refs = [...checker.matchAll(/@[~a-z./_-]*gsd-core\/references\/([a-z0-9_-]+\.md)/g)].map((m) => m[1]);
const texts = { "agents/gsd-plan-checker.md": checker };
for (const r of new Set(refs)) {
  const file = path.join(UPSTREAM, "gsd-core", "references", r);
  if (fs.existsSync(file)) texts[`gsd-core/references/${r}`] = read(file);
}
const mentioned = new Set(Object.values(texts).flatMap((t) => [...t.matchAll(/\b([A-Z][A-Z-]{3,})\.md\b/g)].map((m) => m[1])));

// kind: gate = a checker dimension fails or blocks without it; optional = the dimension skips without it; produced = a
// kit step or an earlier stage writes it before the checker runs; external = no phase artifact (instruction or shared planning
// file); reference = named in prose only. `producer` = [file under ship/, pattern] for gate and produced.
const ARTIFACTS = {
  VALIDATION: { kind: "gate", producer: [".agents/workflows/gsd-plan.js", /"validation-strategy"/], also: [".agents/workflows/lib/gsd-flow.mjs", /"validation-strategy"/] },
  RESEARCH: { kind: "produced", producer: [".agents/workflows/gsd-research.js", /RESEARCH\.md/] },
  CONTEXT: { kind: "produced", producer: [".claude/skills/gsd-discuss/SKILL.md", /CONTEXT\.md/] },
  PLAN: { kind: "produced", producer: [".agents/workflows/gsd-plan.js", /PLAN\.md/] },
  PATTERNS: { kind: "optional", skip: /Dimension 12: SKIPPED \(no PATTERNS\.md found\)/ },
  REVIEWS: { kind: "optional", skip: /REVIEWS\.md\*\* \(if included/ },
  AGENTS: { kind: "external" }, CLAUDE: { kind: "external" }, SKILL: { kind: "external" }, CONFIGURATION: { kind: "external" },
  PROJECT: { kind: "external" }, ROADMAP: { kind: "external" }, REQUIREMENTS: { kind: "external" }, STATE: { kind: "external" },
  SUMMARY: { kind: "reference" }, VERIFICATION: { kind: "reference" },
};

test("P70 port check: every artifact the vendored plan checker names is classified", () => {
  const unknown = [...mentioned].filter((n) => !ARTIFACTS[n]);
  assert.deepEqual(unknown, [], `classify ${unknown.join(", ")} in ARTIFACTS: does the checker block without it (gate), skip (optional), or is it written before the checker runs (produced)?`);
  for (const [name, a] of Object.entries(ARTIFACTS)) if (a.kind === "gate" || a.kind === "optional") assert.ok(mentioned.has(name), `${name} is no longer named by the checker: reclassify or drop it`);
});

test("P70 port check: a gate artifact still blocks in the vendored text, an optional one still skips", () => {
  const all = Object.values(texts).join("\n");
  assert.match(texts["gsd-core/references/nyquist-compliance.md"], /Check 8e[\s\S]*\*\*If missing:\*\* \*\*BLOCKING FAIL\*\*[\s\S]*VALIDATION\.md not found/);
  for (const [name, a] of Object.entries(ARTIFACTS)) if (a.kind === "optional") assert.match(all, a.skip, `${name}: the checker no longer skips without it`);
});

test("P70 port check: every gate and produced artifact has a producing step in the kit flow", () => {
  for (const [name, a] of Object.entries(ARTIFACTS)) {
    if (!a.producer) continue;
    for (const [file, pattern] of [a.producer, ...(a.also ? [a.also] : [])]) {
      const full = path.join(SHIP_DIR, file);
      assert.ok(fs.existsSync(full), `${name}: producer ${file} is missing`);
      assert.match(read(full), pattern, `${name}: ${file} no longer produces it`);
    }
  }
});

test("P70 port check: the gsd-plan step produces a file the checker's own ls pattern finds", async () => {
  const TEMPLATE = ".agents/gsd/upstream/gsd-core/templates/VALIDATION.md";
  const w = makeWorld({ files: { [TEMPLATE]: read(SHIP_DIR, TEMPLATE), [`${PHASE_DIR}/01-RESEARCH.md`]: "# R\n\n## Validation Architecture\nx\n" } });
  const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
  assert.equal(await main(["validation-strategy", PHASE_DIR], { root: w.root, out: () => {} }), 0);
  const found = fs.readdirSync(path.join(w.root, PHASE_DIR)).filter((f) => /^.*-VALIDATION\.md$/.test(f));
  assert.deepEqual(found, ["01-VALIDATION.md"]);
  assert.match(read(UPSTREAM, "gsd-core", "references", "nyquist-compliance.md"), /ls "\$\{PHASE_DIR\}"\/\*-VALIDATION\.md/);
});
