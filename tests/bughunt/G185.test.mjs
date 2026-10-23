// Bug-hunt fix G185: a bump that vendor refuses leaves the pin and the snapshot alone, a vendor swaps the snapshot in
// whole, and bump, vendor, build and check of one target run one at a time.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { tryLock, unlock } from "../../ship/.agents/harness/adapter/mutex.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { gsd } from "../gsd-core/fixture.mjs";

const SHA1 = "1111111111111111111111111111111111111111";
const SHA2 = "2222222222222222222222222222222222222222";
const up = (target, sub, args = []) => gsd(target, ["upstream", sub, "--target", target, ...args]);
const snapshot = (target) => path.join(target, ".agents/gsd/upstream");
const pinOf = (target) => JSON.parse(fs.readFileSync(path.join(snapshot(target), "UPSTREAM.json"), "utf8"));

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

// Every file under root, relative path -> text.
function readTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
    }
  };
  walk(root);
  return out;
}

// A clone whose HEAD (through packed-refs) is `sha`.
function makeClone(sha) {
  const clone = makeTempDir("paseo kit clone ");
  writeTree(clone, {
    ".git/HEAD": "ref: refs/heads/next\n",
    ".git/packed-refs": `# pack-refs\n${sha} refs/heads/next\n`,
    LICENSE: "MIT License\n",
    "gsd-core/workflows/w.md": "# W\nno verbs here\n",
  });
  return clone;
}

function makeTarget() {
  const target = makeTempDir("paseo kit target ");
  writeTree(target, {
    ".agents/gsd/inventory.json": JSON.stringify({
      v: 1,
      snapshot: ".agents/gsd/upstream",
      entries: [
        { installed: ".agents/gsd/generated/workflows/w.md", kind: "skill-workflow", source: "gsd-core/workflows/w.md", transformations: ["path-rewrite"], overlay: null },
        { installed: ".agents/gsd/upstream/LICENSE", kind: "reference", source: "LICENSE", transformations: [], overlay: null },
      ],
      extra_verbs: {},
    }, null, 2),
  });
  return target;
}

test("G185 a bump the clone refuses leaves UPSTREAM.json and the snapshot as they were", async () => {
  const target = makeTarget();
  const clone = makeClone(SHA1);
  assert.equal((await up(target, "vendor", ["--from", clone, "--commit", SHA1])).code, 0);
  assert.equal((await up(target, "build")).code, 0);
  const before = readTree(snapshot(target));
  const refused = await up(target, "bump", ["--from", clone, "--commit", SHA2]);
  assert.equal(refused.code, 1);
  assert.match(refused.json.error, /differs from the pin/);
  assert.equal(pinOf(target).commit, SHA1, "the pin is not moved before the vendor succeeds");
  assert.deepEqual(readTree(snapshot(target)), before, "the snapshot files are unchanged");
  assert.equal((await up(target, "check")).code, 0, "the installed snapshot still checks");
});

test("G185 a successful bump publishes the new tree and pin together and leaves no staging tree", async () => {
  const target = makeTarget();
  assert.equal((await up(target, "vendor", ["--from", makeClone(SHA1), "--commit", SHA1])).code, 0);
  const bumped = await up(target, "bump", ["--from", makeClone(SHA2), "--commit", SHA2]);
  assert.equal(bumped.code, 0, JSON.stringify(bumped.json));
  assert.deepEqual([pinOf(target).commit, pinOf(target).vendored_commit], [SHA2, SHA2]);
  assert.deepEqual(fs.readdirSync(path.join(target, ".agents/gsd")).filter((n) => n.startsWith("upstream.")), []);
});

test("G185 a vendor clears a staging tree an interrupted run left behind", async () => {
  const target = makeTarget();
  writeTree(target, { ".agents/gsd/upstream.staging/left-over.md": "x\n" });
  assert.equal((await up(target, "vendor", ["--from", makeClone(SHA1), "--commit", SHA1])).code, 0);
  assert.deepEqual(fs.readdirSync(path.join(target, ".agents/gsd")).filter((n) => n.startsWith("upstream.")), []);
  assert.equal(pinOf(target).commit, SHA1);
});

test("G185 a bump waits while another bump holds the target, then runs and writes its pin", async () => {
  const { upstreamLock } = await import("../../ship/.agents/harness/gsd/upstream.mjs");
  const target = makeTarget();
  assert.equal((await up(target, "vendor", ["--from", makeClone(SHA1), "--commit", SHA1])).code, 0);
  const lock = upstreamLock(target);
  const token = tryLock(lock);
  assert.ok(token, "the test holds the lock first");
  const pending = up(target, "bump", ["--from", makeClone(SHA2), "--commit", SHA2]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(pinOf(target).commit, SHA1, "the waiting bump has not touched the pin");
  unlock(lock, token);
  const bumped = await pending;
  assert.equal(bumped.code, 0, JSON.stringify(bumped.json));
  assert.ok(bumped.out.includes(`waiting for mutex ${lock}`));
  assert.equal(pinOf(target).commit, SHA2);
});
