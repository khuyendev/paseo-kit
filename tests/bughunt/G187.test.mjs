// G187: a gsd_run verb named only in a second- or third-level upstream reference was never compared with the verb table.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { gsd } from "../gsd-core/fixture.mjs";

const SHA = "1111111111111111111111111111111111111111";
const up = (target, sub, args = []) => gsd(target, ["upstream", sub, "--target", target, ...args]);

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

// A chain: the agent cites r1, r1 cites r2, r2 cites r3. `files` replaces the leaf texts to put a verb at a given depth.
async function vendoredChain(files) {
  const clone = makeTempDir("paseo kit clone ");
  writeTree(clone, {
    ".git/HEAD": "ref: refs/heads/next\n",
    ".git/packed-refs": `# pack-refs\n${SHA} refs/heads/next\n`,
    "agents/gsd-x.md": "---\nname: gsd-x\ntools: Read\n---\n# Agent X\nRead gsd-core/references/r1.md.\n",
    "gsd-core/references/r1.md": "See gsd-core/references/r2.md\n",
    "gsd-core/references/r2.md": "See gsd-core/references/r3.md\n",
    "gsd-core/references/r3.md": "leaf\n",
    ...files,
  });
  const target = makeTempDir("paseo kit target ");
  const inventory = {
    v: 1,
    snapshot: ".agents/gsd/upstream",
    entries: [{ installed: ".agents/agents/gsd-x.md", kind: "agent", source: "agents/gsd-x.md", transformations: ["path-rewrite"], overlay: null, model: "pro", description: "X role", include: [] }],
    extra_verbs: {},
  };
  writeTree(target, { ".agents/gsd/inventory.json": JSON.stringify(inventory, null, 2) });
  assert.equal((await up(target, "vendor", ["--from", clone, "--commit", SHA])).code, 0);
  assert.equal((await up(target, "build")).code, 0);
  return target;
}

test("G187 check: an unmapped verb at depth 1 fails; at depth 2 and 3 it is reported as a warning, not skipped", async () => {
  const body = "Then `gsd_run foo.bar`.\n";
  const direct = await vendoredChain({ "gsd-core/references/r1.md": `See gsd-core/references/r2.md\n${body}` });
  const depth1 = await up(direct, "check", ["--verbose"]);
  assert.equal(depth1.code, 1);
  assert.ok(depth1.json.problems.some((p) => p.includes('unmapped gsd-tools verb "foo.bar"')));

  const second = await vendoredChain({ "gsd-core/references/r2.md": `See gsd-core/references/r3.md\n${body}` });
  const depth2 = await up(second, "check", ["--verbose"]);
  assert.equal(depth2.code, 0, JSON.stringify(depth2.json));
  assert.ok(depth2.out.some((l) => l.startsWith('warning: unmapped gsd-tools verb "foo.bar"') && l.includes("gsd-core/references/r2.md")), depth2.out.join("\n"));

  const third = await vendoredChain({ "gsd-core/references/r3.md": `leaf\n${body}` });
  const depth3 = await up(third, "check", ["--verbose"]);
  assert.equal(depth3.code, 0, JSON.stringify(depth3.json));
  assert.ok(depth3.out.some((l) => l.startsWith('warning: unmapped gsd-tools verb "foo.bar"') && l.includes("gsd-core/references/r3.md")), depth3.out.join("\n"));

  const quiet = await up(third, "check");
  assert.ok(!quiet.out.some((l) => l.includes("foo.bar")), "warnings stay out of the default output");
});

test("G187 check: a verb in the table counts as mapped at depth 2 and draws no warning", async () => {
  const target = await vendoredChain({ "gsd-core/references/r2.md": "See gsd-core/references/r3.md\nThen `gsd_run todo.match-phase`.\n" });
  const r = await up(target, "check", ["--verbose"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.ok(!r.out.some((l) => l.includes("todo.match-phase")), r.out.join("\n"));
  assert.match(r.out.at(-2), /^check: 0 problems, 0 warnings; 3 references followed, 1 verbs mapped$/);
});
