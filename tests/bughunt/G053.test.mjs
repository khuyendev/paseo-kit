// G053: a revision key hashes what its artifact consumes, so edits the phase does not depend on leave research and plans reusable.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, REQUIREMENTS, ROADMAP, gsd, plan, project } from "../gsd-core/fixture.mjs";

const check = async (p, key) => (await gsd(p, ["revisions", "check", "1", key])).code;

// A RESEARCH.md report as the researcher writes it: frontmatter with an attempt key, a body and the completion marker.
const report = (key, finding = "Findings.") => `---\nstatus: complete\ninput_digest: 0${"a".repeat(63)}\nattempt_key: ${key}\n---\n## Findings\n\n${finding}\n<!-- gsd:research-complete ${key} -->\n`;

test("G053 another phase's requirement and formatting of REQUIREMENTS.md leave the research revision; this phase's requirement does not", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>\n" } });
  await gsd(p, ["revisions", "record", "1", "research"]);
  p.write(".planning/REQUIREMENTS.md", `${REQUIREMENTS.replace("**API-01**: Api answers", "**API-01**: Api answers quickly").replace("- [ ] **CORE-02**", "\n\n- [ ] **CORE-02**")}\n\n`);
  assert.equal(await check(p, "research"), 0, "another phase's requirement and formatting");
  p.write(".planning/REQUIREMENTS.md", REQUIREMENTS.replace("**CORE-01**: Core starts", "**CORE-01**: Core starts fast"));
  assert.equal(await check(p, "research"), 1, "a requirement of this phase");
});

test("G053 the generated dependency block of the ROADMAP section leaves the research, inputs, freeze, checked and handoff revisions", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } });
  const keys = ["research", "inputs", "freeze", "checked", "handoff"];
  for (const key of keys) await gsd(p, ["revisions", "record", "1", key]);
  assert.equal((await gsd(p, ["roadmap", "annotate-dependencies", "1"])).json.changed, true);
  assert.deepEqual(await Promise.all(keys.map((key) => check(p, key))), keys.map(() => 0));
  p.write(".planning/ROADMAP.md", ROADMAP.replace("**Goal**: Core works", "**Goal**: Core works fast"));
  assert.equal(await check(p, "research"), 1, "a goal of this phase");
});

test("G053 the research attempt record and the report's attempt key leave the inputs revision; a changed finding does not", async () => {
  const p = project({ files: { [`${P1}/01-RESEARCH.md`]: report("key-a"), [`${P1}/research-attempt.json`]: `{"at":"t1"}\n` } });
  await gsd(p, ["revisions", "record", "1", "inputs"]);
  p.write(`${P1}/research-attempt.json`, `{"at":"t2"}\n`);
  p.write(`${P1}/01-RESEARCH.md`, report("key-b"));
  assert.equal(await check(p, "inputs"), 0, "attempt record and attempt key");
  p.write(`${P1}/01-RESEARCH.md`, report("key-b", "Findings changed."));
  assert.equal(await check(p, "inputs"), 1, "a changed finding");
});

test("G053 PROJECT.md and adapter instruction edits still change research (owner decision, feedback 3)", async () => {
  const p = project({ overlay: { adapter: { instructions: ["docs/rules.md"] } }, files: { "docs/rules.md": "rules\n" } });
  await gsd(p, ["revisions", "record", "1", "research"]);
  p.write("docs/rules.md", "rules, edited\n");
  assert.equal(await check(p, "research"), 1, "an instruction file");
  await gsd(p, ["revisions", "record", "1", "research"]);
  p.write(".planning/PROJECT.md", "# Project\n\nA longer description.\n");
  assert.equal(await check(p, "research"), 1, "PROJECT.md");
});
