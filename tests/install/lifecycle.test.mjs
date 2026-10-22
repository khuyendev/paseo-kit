import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { toSlash } from "../../ship/.agents/harness/lib/paths.mjs";
import { HELP } from "../../kit/install/state.mjs";
import { makeKit, makeProject, runKit, treeHash } from "./helpers.mjs";

const SKILL = ".claude/skills/demo/SKILL.md";
const HOOK = ".claude/hooks/io_guard.mjs";
const installed = async (kit = makeKit(), files = {}) => {
  const p = makeProject(files);
  const r = await runKit(["install", p.root], { kit });
  assert.ok(r.code === 0 || r.code === 2, r.stderr);
  return { kit, p, r };
};

test("INST-05 manifest: exactly five keys, installedAt kept, code-point key order, no kit or project path", async () => {
  const kit = makeKit({ files: { "B.md": "b\n", "a.md": "a\n", ".claude/hooks/io_guard.mjs": "x\n", ".claude/hooks/context_guard.mjs": "x\n", ".claude/hooks/bash_long_command.mjs": "x\n", ".claude/hooks/syntax_check.mjs": "x\n", ".claude/hooks/skill_usage.mjs": "x\n" } });
  const p = makeProject();
  await runKit(["install", p.root], { kit, now: () => new Date("2026-01-01T00:00:00Z") });
  const first = p.manifest();
  await runKit(["update", p.root], { kit, now: () => new Date("2026-02-01T00:00:00Z") });
  const m = p.manifest();
  assert.deepEqual(Object.keys(m), ["_notes", "version", "installedAt", "updatedAt", "files"]);
  assert.equal(m.installedAt, first.installedAt);
  assert.equal(m.updatedAt, "2026-02-01T00:00:00.000Z");
  const keys = Object.keys(m.files);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.ok(keys.indexOf("B.md") < keys.indexOf("a.md"));
  const text = p.read(".agents/harness-kit.json");
  assert.ok(text.endsWith("}\n") && text.startsWith('{\n  "_notes"'));
  for (const dir of [kit.dir, p.root]) for (const form of [dir, toSlash(dir), dir.replace(/\\/g, "\\\\")]) assert.equal(text.includes(form), false, form);
  const before = treeHash(p.root);
  await runKit(["status", p.root], { kit });
  assert.equal(treeHash(p.root), before);
});

test("INST-07 update deletes unchanged retired files and blocks, keeps edited ones and unrecorded names", async () => {
  const kit = makeKit({ blocks: { "AGENTS.md": "kit agents\n", "NOTES.md": "kit notes\n" } });
  kit.write("old/keep.md", "k\n");
  kit.write("old/edit.md", "e\n");
  kit.sync();
  const { p } = await installed(kit, { "NOTES.md": "before\r\n" });
  p.write("NOTES.md", `${p.read("NOTES.md")}after\r\n`);
  p.write("old/edit.md", "edited\n");
  kit.remove("old/keep.md");
  kit.remove("old/edit.md");
  kit.remove("blocks/NOTES.md");
  kit.write("unrecorded.md", "u\n");
  kit.sync();
  p.write("stray/keep.md", "same name, no record\n");
  const r = await runKit(["update", p.root, "--force"], { kit });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("deleted old/keep.md (no longer in the kit)"));
  assert.ok(r.out.includes("deleted NOTES.md#paseo-harness-kit (no longer in the kit)"));
  assert.ok(r.out.includes(`kept old/edit.md (removed-local: ${HELP["removed-local"]})`));
  assert.equal(p.exists("old/keep.md"), false);
  assert.equal(p.read("old/edit.md"), "edited\n");
  assert.equal(p.read("NOTES.md"), "\r\nbefore\r\nafter\r\n");
  assert.equal(p.read("stray/keep.md"), "same name, no record\n");
  assert.equal(Object.hasOwn(p.manifest().files, "old/keep.md"), false);
  assert.ok(Object.hasOwn(p.manifest().files, "old/edit.md"));
});

test("INST-08 install keeps a differing file as a conflict; update reports both; --force takes it; second install refused", async () => {
  const kit = makeKit();
  const p = makeProject({ [SKILL]: "project copy\n" });
  const r = await runKit(["install", p.root], { kit });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes(`conflict ${SKILL}: the project has a different version and kept it (install --force replaces it)`));
  assert.match(r.out.at(-1), /^installed paseo-kit 1\.0\.0; machine setup \(once per machine\): node ".*\/kit\.mjs" machine check$/);
  assert.equal(p.read(SKILL), "project copy\n");
  assert.equal(Object.hasOwn(p.manifest().files, SKILL), false);
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 2);
  assert.ok(u.out.includes(`kept ${SKILL} (both: ${HELP.both})`));
  const f = await runKit(["update", p.root, "--force"], { kit });
  assert.equal(f.code, 0, f.stdout);
  assert.equal(p.read(SKILL), kit.read(SKILL));
  const again = await runKit(["install", p.root], { kit });
  assert.equal(again.code, 1);
  assert.deepEqual(again.err, ["failed: .agents/harness-kit.json exists: already installed; use update"]);
});

test("INST-09 update keeps a local hook edit, --force replaces it, then 0 kept", async () => {
  const { kit, p } = await installed();
  const nope = await runKit(["update", makeProject().root], { kit });
  assert.equal(nope.code, 1);
  assert.deepEqual(nope.err, ["failed: not installed; use install"]);
  p.write(HOOK, "// mine\n");
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 2);
  assert.ok(u.out.includes(`kept ${HOOK} (local: ${HELP.local})`));
  assert.equal(u.out.at(-1), "update: 0 part(s) changed, 2 kept; kit 1.0.0");
  const f = await runKit(["update", p.root, "--force"], { kit });
  assert.equal(f.code, 0, f.stdout);
  assert.ok(f.out.includes(`updated ${HOOK}`));
  const plain = await runKit(["update", p.root], { kit });
  assert.equal(plain.code, 0);
  assert.equal(plain.out.at(-1), "update: 0 part(s) changed, 0 kept; kit 1.0.0");
  kit.write(SKILL, "newer\n");
  const newer = await runKit(["update", p.root], { kit });
  assert.ok(newer.out.includes(`updated ${SKILL}`));
  assert.equal(newer.out.at(-1), "update: 1 part(s) changed, 0 kept; kit 1.0.0");
});

test("INST-10 status is read-only: fresh install same, one edit gives one local line and exit 2", async () => {
  const { kit, p } = await installed();
  const fresh = await runKit(["status", p.root], { kit });
  assert.equal(fresh.code, 0);
  assert.deepEqual(fresh.out, ["status: every kit part is the same; project on kit 1.0.0, kit now 1.0.0"]);
  p.write(SKILL, "edit\n");
  const before = treeHash(p.root);
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 2);
  assert.deepEqual(s.out, [`local         ${SKILL}  (${HELP.local})`, "status: 1 part(s) differ; project on kit 1.0.0, kit now 1.0.0"]);
  assert.equal(treeHash(p.root), before);
});

test("INST-11 pull copies a local part into --kit, validates names first, reminds of the CHANGELOG", async () => {
  const { kit, p } = await installed();
  p.write(SKILL, "improved\n");
  const tmpKit = makeKit();
  fs.cpSync(kit.dir, tmpKit.dir, { recursive: true });
  const kitBefore = treeHash(tmpKit.dir);
  const bad = await runKit(["pull", p.root, SKILL, "nope.md", "--kit", tmpKit.dir], { kit });
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.err, ["failed pull nope.md: not a kit part"]);
  assert.equal(treeHash(tmpKit.dir), kitBefore);
  const r = await runKit(["pull", p.root, `./${SKILL.replace(/\//g, "\\")}`, "--kit", tmpKit.dir], { kit });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(r.out.includes(`pulled ${SKILL}`));
  assert.equal(r.out.at(-1), "pull: 1 part(s) copied into the kit; record them in the kit CHANGELOG.md and commit the kit, then update the other projects");
  assert.equal(tmpKit.read(SKILL), "improved\n");
  const s = await runKit(["status", p.root], { kit: tmpKit });
  assert.equal(s.code, 0, s.stdout);
});

test("INST-11 pull resolves the kit from $PASEO_KIT and skips states it cannot copy", async () => {
  const { kit, p } = await installed();
  kit.write(HOOK, "// kit newer\n");
  fs.rmSync(p.path(".agents/harness/runtime/a.mjs"));
  const env = (await import("./helpers.mjs")).testEnv({ PASEO_KIT: kit.dir });
  const r = await runKit(["pull", p.root], { kit: makeKit(), env });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes(`skipped ${HOOK} (kit-newer: ${HELP["kit-newer"]})`));
  assert.ok(r.out.includes(`skipped .agents/harness/runtime/a.mjs (missing: ${HELP.missing})`));
  assert.equal(r.out.at(-1), "pull: 0 part(s) copied into the kit");
});
