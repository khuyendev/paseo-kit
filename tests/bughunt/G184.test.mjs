// G184: the upstream build, vendor and bump never write through a symlink or junction under the target.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { gsd } from "../gsd-core/fixture.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

const SHA = "1111111111111111111111111111111111111111";
const up = (target, sub, args = []) => gsd(target, ["upstream", sub, "--target", target, ...args]);

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

function makeClone() {
  const clone = makeTempDir("paseo kit clone ");
  writeTree(clone, {
    ".git/HEAD": "ref: refs/heads/next\n",
    ".git/packed-refs": `# pack-refs\n${SHA} refs/heads/next\n`,
    "agents/gsd-x.md": "---\nname: gsd-x\ntools: Read, Write\n---\n# Agent X\n",
    "gsd-core/workflows/w.md": "# W\n",
    LICENSE: "MIT License\n",
  });
  return clone;
}

function makeTarget() {
  const target = makeTempDir("paseo kit target ");
  const inventory = {
    v: 1,
    snapshot: ".agents/gsd/upstream",
    entries: [
      { installed: ".agents/agents/gsd-x.md", kind: "agent", source: "agents/gsd-x.md", transformations: ["path-rewrite"], model: "pro", description: "X role", include: [] },
      { installed: ".agents/gsd/generated/workflows/w.md", kind: "skill-workflow", source: "gsd-core/workflows/w.md", transformations: ["path-rewrite"], overlay: null },
      { installed: ".agents/gsd/upstream/LICENSE", kind: "reference", source: "LICENSE", transformations: [], overlay: null },
    ],
    extra_verbs: {},
  };
  writeTree(target, { ".agents/gsd/inventory.json": JSON.stringify(inventory, null, 2) });
  return target;
}

// A junction (a symlink to a directory on platforms without junctions) at link, pointing at outside; false when the
// platform refuses to create it.
function linkDir(link, outside) {
  try {
    fs.symlinkSync(outside, link, "junction");
    return true;
  } catch (e) {
    if (e.code === "EPERM") return false;
    throw e;
  }
}

test("G184 build: a junction on a generated path is refused and no file lands outside the target", async () => {
  const target = makeTarget();
  assert.equal((await up(target, "vendor", ["--from", makeClone(), "--commit", SHA])).code, 0);
  const outside = makeTempDir("paseo kit outside ");
  if (!linkDir(path.join(target, ".agents/agents"), outside)) return;
  const r = await up(target, "build");
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.match(r.json.error, /\.agents\/agents\/gsd-x\.md.*link/);
  assert.deepEqual(fs.readdirSync(outside), [], "nothing written through the junction");
});

test("G184 vendor: a junction on the snapshot path is refused before the snapshot is touched", async () => {
  const target = makeTarget();
  const outside = makeTempDir("paseo kit outside ");
  fs.mkdirSync(path.join(target, ".agents/gsd"), { recursive: true });
  if (!linkDir(path.join(target, ".agents/gsd/upstream"), outside)) return;
  const r = await up(target, "vendor", ["--from", makeClone(), "--commit", SHA]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.match(r.json.error, /link/);
  assert.deepEqual(fs.readdirSync(outside), [], "snapshot and pin not written through the junction");
});

test("G184 bump: a junction on the snapshot path is refused before the pin is rewritten", async () => {
  const target = makeTarget();
  assert.equal((await up(target, "vendor", ["--from", makeClone(), "--commit", SHA])).code, 0);
  const outside = makeTempDir("paseo kit outside ");
  fs.rmSync(path.join(target, ".agents/gsd/upstream"), { recursive: true, force: true });
  if (!linkDir(path.join(target, ".agents/gsd/upstream"), outside)) return;
  const r = await up(target, "bump", ["--from", makeClone(), "--commit", SHA]);
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.match(r.json.error, /link/);
  assert.deepEqual(fs.readdirSync(outside), [], "pin not written through the junction");
});
