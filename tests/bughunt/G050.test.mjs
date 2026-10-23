import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, project } from "../gsd-core/fixture.mjs";

// A complete research report for the attempt, written the way the researcher writes it.
function report(key, digest) {
  const sections = ["Summary", "Standard Stack", "Architecture Patterns", "Don't Hand-Roll", "Common Pitfalls", "Sources"].map((s) => `## ${s}\n\nx [VERIFIED: docs]\n`).join("\n");
  return `---\nstatus: complete\ninput_digest: ${digest}\nattempt_key: ${key}\n---\n<user_constraints>none</user_constraints>\n<phase_requirements>CORE-01 CORE-02</phase_requirements>\n${sections}\n<!-- gsd:research-complete ${key} -->\n`;
}

// accept() in gsd-research.js: the attempt keeps the report's sha, then the research revision is recorded.
async function accepted(p) {
  const digest = (await gsd(p, ["revisions", "hash", "1", "research"])).json.hash;
  const attempt = (await gsd(p, ["attempt", "record", "1", "--kind", "research", "--run-id", "r1", "--input-digest", digest])).json;
  const text = report(attempt.key, digest);
  p.write(`${P1}/01-RESEARCH.md`, text);
  const result = (await gsd(p, ["hash"], { stdin: text })).json.hash;
  await gsd(p, ["attempt", "record", "1", "--kind", "research", "--run-id", "r1", "--input-digest", digest, "--done", "true", "--result", JSON.stringify(result)]);
  await gsd(p, ["revisions", "record", "1", "research"]);
  return text;
}

test("G050 research status: a report edited after its accepted attempt is changed, not reused", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>" } });
  const text = await accepted(p);
  assert.equal((await gsd(p, ["research", "status", "1"])).json.status, "complete");
  p.write(`${P1}/01-RESEARCH.md`, text.replace("x [VERIFIED: docs]", "x [VERIFIED: docs] edited by hand"));
  const edited = await gsd(p, ["research", "status", "1"]);
  assert.deepEqual([edited.code, edited.json.status], [1, "changed"]);
});

test("G050 research status: a code commit after the accepted report reports headChanged", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>", "src/a.js": "1" } });
  await accepted(p);
  p.write("src/a.js", "2");
  p.git("add", "-A");
  p.git("commit", "-q", "-m", "code");
  const moved = await gsd(p, ["research", "status", "1"]);
  assert.deepEqual([moved.code, moved.json.status, moved.json.headChanged], [0, "complete", true]);
});
