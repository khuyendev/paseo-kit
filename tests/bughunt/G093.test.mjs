// Bug-hunt fix G093: a key link needs a source and a target (or a pattern). A missing target must not match every
// source, and a link the verifier could not evaluate must not exit 0.
import assert from "node:assert/strict";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const SOURCES = { "src/use.js": "export const unrelated = true;\n", "src/impl.js": "export function parseThing() {}\n" };

// Runs `verify key-links` on one PLAN whose must_haves.key_links is `links` (YAML lines, indented 4 spaces).
async function verifyLinks(links, extraPlans = {}) {
  const planFile = `${P1}/01-01-PLAN.md`;
  const p = project({ files: { [planFile]: plan({ extra: `  key_links:\n${links}` }), ...SOURCES, ...extraPlans } });
  return gsd(p, ["verify", "key-links", planFile]);
}

test("G093 a key link with no to, an empty to, a misspelt target or no from is invalid_entry and exits 1", async () => {
  const cases = [
    "    - from: src/use.js\n",
    "    - from: src/use.js\n      to: \"\"\n",
    "    - from: src/use.js\n      target: src/impl.js\n",
    "    - to: unrelated\n",
  ];
  for (const links of cases) {
    const k = await verifyLinks(links);
    assert.equal(k.code, 1, `${JSON.stringify(links)}: ${JSON.stringify(k.json)}`);
    assert.equal(k.json.all_verified, false, JSON.stringify(links));
    assert.deepEqual(k.json.results.map((r) => [r.status, r.verified]), [["invalid_entry", false]], JSON.stringify(links));
  }
});

test("G093 a neutralized pattern is not success: the command exits 1 even beside verified links", async () => {
  const alone = await verifyLinks("    - from: src/use.js\n      to: src/impl.js\n      pattern: \"(?=parseThing)\"\n");
  assert.equal(alone.code, 1, JSON.stringify(alone.json));
  assert.equal(alone.json.all_verified, false);
  assert.deepEqual(alone.json.results.map((r) => r.status), ["pattern_neutralized"]);
  const mixed = await verifyLinks("    - from: src/use.js\n      to: unrelated\n    - from: src/use.js\n      to: src/impl.js\n      pattern: \"(?=parseThing)\"\n");
  assert.equal(mixed.code, 1, JSON.stringify(mixed.json));
  assert.deepEqual(mixed.json.results.map((r) => r.status), ["verified", "pattern_neutralized"]);
});

test("G093 a link with a to, or a pattern without a to, still verifies and exits 0", async () => {
  const k = await verifyLinks("    - from: src/use.js\n      to: unrelated\n    - from: src/use.js\n      pattern: \"export const unrelated\"\n");
  assert.equal(k.code, 0, JSON.stringify(k.json));
  assert.equal(k.json.all_verified, true);
  assert.deepEqual(k.json.results.map((r) => r.status), ["verified", "verified"]);
});

test("G093 a link whose source a later wave writes is pending and stays nonblocking (exit 0)", async () => {
  const later = { [`${P1}/01-02-PLAN.md`]: plan({ id: "02", wave: 2, depends: "[01-01]", files: "[src/later.js]", owns: '["Path:src/later.js"]' }) };
  const k = await verifyLinks("    - from: src/later.js\n      to: unrelated\n", later);
  assert.equal(k.code, 0, JSON.stringify(k.json));
  assert.equal(k.json.all_verified, false);
  assert.deepEqual(k.json.results.map((r) => r.status), ["pending"]);
});
