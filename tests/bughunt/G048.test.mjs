// Bug-hunt fix G048: a longer requirement id (API-10) must not satisfy a shorter required id (API-1) in research status.
import assert from "node:assert/strict";
import test from "node:test";
import { ROADMAP, gsd, project } from "../gsd-core/fixture.mjs";

const SECTIONS = ["Summary", "Standard Stack", "Architecture Patterns", "Don't Hand-Roll", "Common Pitfalls", "Sources"];
const KEY = "b".repeat(64);

// Phase 2 (api) requires API-1 in this roadmap; the report lists the given <phase_requirements> body.
async function apiReport(p, listed) {
  const digest = (await gsd(p, ["revisions", "hash", "2", "research"])).json.hash;
  const sections = SECTIONS.map((s) => `## ${s}\n\nx [VERIFIED: docs]\n`).join("\n");
  p.write(
    ".planning/phases/02-api/02-RESEARCH.md",
    `---\nstatus: complete\ninput_digest: ${digest}\nattempt_key: ${KEY}\n---\n<user_constraints>none</user_constraints>\n<phase_requirements>${listed}</phase_requirements>\n${sections}\n<!-- gsd:research-complete ${KEY} -->\n`,
  );
}

test("GSDC-32 research status: a longer requirement id does not satisfy a shorter one", async () => {
  const p = project({ roadmap: ROADMAP.replace("**Requirements**: API-01", "**Requirements**: API-1") });

  await apiReport(p, "API-10");
  const longer = await gsd(p, ["research", "status", "2"]);
  assert.deepEqual([longer.code, longer.json.status], [1, "invalid"]);
  assert.match(longer.json.problems.join(), /phase requirement API-1 missing from <phase_requirements>/);

  await apiReport(p, "API-1");
  assert.equal((await gsd(p, ["research", "status", "2"])).json.status, "complete");

  await apiReport(p, "API-1, API-10");
  assert.equal((await gsd(p, ["research", "status", "2"])).json.status, "complete");

  await apiReport(p, "`API-1`");
  assert.equal((await gsd(p, ["research", "status", "2"])).json.status, "complete");
});
