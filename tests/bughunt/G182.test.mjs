// G182: status reads no kit part through a project link; it reports the link as a conflict, like update does.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { defaultKitFiles, makeKit, makeProject, runKit, treeHash } from "../install/helpers.mjs";

const LINK = "the kit does not write through links (replace it with a real folder or file)";
const SKILL = ".claude/skills/demo/SKILL.md";
const RUNTIME = ".agents/harness/runtime";
const KIT_BYTES = defaultKitFiles()[`${RUNTIME}/a.mjs`];

// A Windows junction (no privilege needed) or a POSIX directory symlink.
const linkDir = (target, link) => {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, "junction");
};

test("G182 status over a linked skill folder reports a conflict and does not read the owner's file", async () => {
  const kit = makeKit();
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  const other = makeTempDir("paseo kit other project ");
  fs.writeFileSync(path.join(other, "SKILL.md"), "other project's skill\n");
  fs.rmSync(p.path(".claude/skills/demo"), { recursive: true, force: true });
  linkDir(other, p.path(".claude/skills/demo"));
  const before = treeHash(other);
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 2, s.stdout);
  assert.ok(s.out.includes(`conflict ${SKILL}: .claude/skills/demo is a link; ${LINK}`), s.stdout);
  assert.ok(!s.out.some((l) => l.startsWith("local ")), s.stdout);
  assert.match(s.out.at(-1), /^status: 1 part\(s\) differ; /);
  assert.equal(treeHash(other), before);
});

test("G182 status over a link holding the kit's own bytes is a conflict, not every part the same", async () => {
  const kit = makeKit();
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  const other = makeTempDir("paseo kit other runtime ");
  fs.writeFileSync(path.join(other, "a.mjs"), KIT_BYTES);
  fs.rmSync(p.path(RUNTIME), { recursive: true, force: true });
  linkDir(other, p.path(RUNTIME));
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 2, s.stdout);
  assert.ok(s.out.includes(`conflict ${RUNTIME}/a.mjs: ${RUNTIME} is a link; ${LINK}`), s.stdout);
  assert.ok(!s.out.some((l) => l.startsWith("status: every kit part is the same")), s.stdout);
});

test("G182 status over a dangling file link is a conflict, not a missing part that update would add", async (t) => {
  const kit = makeKit();
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  fs.rmSync(p.path(`${RUNTIME}/a.mjs`));
  try {
    fs.symlinkSync(path.join(makeTempDir("paseo kit gone "), "missing.mjs"), p.path(`${RUNTIME}/a.mjs`), "file");
  } catch (e) {
    if (e.code === "EPERM") return t.skip("file symlinks need a privilege on this machine");
    throw e;
  }
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 2, s.stdout);
  assert.ok(s.out.includes(`conflict ${RUNTIME}/a.mjs: ${RUNTIME}/a.mjs is a link; ${LINK}`), s.stdout);
  assert.ok(!s.out.some((l) => l.startsWith("missing ")), s.stdout);
});
