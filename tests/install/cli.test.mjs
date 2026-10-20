import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { main } from "../../kit.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { makeKit, makeProject, runKit, treeHash } from "./helpers.mjs";

test("INST-01 bad arguments exit 1 with a usage line and write nothing", async () => {
  const kit = makeKit();
  const p = makeProject({ "keep.txt": "x\n" });
  const before = treeHash(p.root);
  const cases = [
    ["install"],
    ["update"],
    ["status"],
    ["pull"],
    ["install", p.root, "--nope"],
    ["update", "--bogus", p.root],
    ["install", p.root, "second"],
    ["update", p.root, "second"],
    ["status", p.root, "second"],
    ["status", p.root, "--enable-plugin"],
    ["pull", p.root, "--enable-plugin"],
    ["pull", p.root, "--kit"],
    ["install", p.root, "--kit", kit.dir],
  ];
  for (const argv of cases) {
    const r = await runKit(argv, { kit });
    assert.equal(r.code, 1, argv.join(" "));
    assert.ok(r.err.some((l) => l.startsWith("usage: node kit.mjs")), `${argv.join(" ")}: ${r.stderr}`);
    assert.equal(r.stdout, "", argv.join(" "));
  }
  assert.equal(treeHash(p.root), before);
});

test("INST-01 unknown verb through kit.mjs exits 1 with usage on stderr", async () => {
  const err = [];
  assert.equal(await main(["adopt", "x"], { out: () => {}, err: (l) => err.push(l) }), 1);
  assert.ok(err[0].startsWith("usage:"));
});

test("INST-01 flags anywhere after the verb; platform line first; status has none", async () => {
  const kit = makeKit();
  const p = makeProject();
  const r = await runKit(["install", "--force", p.root], { kit });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.out[0], /^platform \S+ \S+, node v?\d/);
  const s = await runKit(["status", p.root, "--force"], { kit });
  assert.equal(s.code, 0);
  assert.doesNotMatch(s.out[0], /^platform/);
  p.write(".claude/skills/demo/SKILL.md", "edited\n");
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 2);
  assert.match(u.out[0], /^platform /);
});

test("INST-01 an unexpected error prints error:, an expected one failed:", async () => {
  const kit = makeKit();
  const p = makeProject();
  const r = await runKit(["status", p.root], { kit });
  assert.equal(r.code, 1);
  assert.deepEqual(r.err, ["failed: not installed; use install"]);
  fs.writeFileSync(path.join(kit.dir, "ship", "templates", "settings.hooks.json"), "{broken");
  const e = await runKit(["install", p.root], { kit });
  assert.equal(e.code, 1);
  assert.match(e.err[0], /^error: .*invalid JSON/);
});

test("INST-02 target refusal: missing, file, inside the kit; a sibling prefix installs", async () => {
  const base = makeTempDir("paseo kit base ");
  const kitDir = path.join(base, "paseo-kit");
  const fixture = makeKit();
  fs.cpSync(fixture.dir, kitDir, { recursive: true });
  const file = path.join(base, "a file.txt");
  fs.writeFileSync(file, "x");
  fs.mkdirSync(path.join(kitDir, "ship", "x"));
  const sibling = path.join(base, "paseo-kit-x");
  fs.mkdirSync(sibling);
  const kitBefore = treeHash(kitDir);
  const cases = [
    [path.join(base, "missing"), `failed: ${path.join(base, "missing")} does not exist`],
    [file, `failed: ${file} is not a folder`],
    [path.join(kitDir, "ship", "x"), "failed: the project cannot be the kit itself"],
    [kitDir.toUpperCase(), "failed: the project cannot be the kit itself"],
  ];
  for (const [target, message] of cases) {
    if (process.platform !== "win32" && target === kitDir.toUpperCase()) continue;
    const r = await runKit(["install", target], { kit: kitDir });
    assert.equal(r.code, 1, target);
    assert.deepEqual(r.err, [message]);
  }
  assert.equal(treeHash(kitDir), kitBefore);
  assert.equal(fs.readFileSync(file, "utf8"), "x");
  const ok = await runKit(["install", sibling], { kit: kitDir });
  assert.equal(ok.code, 0, ok.stderr);
});
