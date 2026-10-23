// Review fixes: manifest paths stay inside the project, no write through links, older ignore blocks, retired hooks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { GITIGNORE_END, GITIGNORE_START, putGitignoreBlock } from "../../kit/install/text.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { defaultKitFiles, makeKit, makeProject, runKit, SHIP_DIR, treeHash } from "./helpers.mjs";

const TEMPLATE = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, "templates", "settings.hooks.json"), "utf8"));
const LINK = "the kit does not write through links (replace it with a real folder or file)";
const slashRel = (from, to) => path.relative(from, to).split(path.sep).join("/");

test("INST-07 manifest keys outside the project are refused before any delete or rewrite", async () => {
  const kit = makeKit();
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  const outside = makeTempDir("paseo kit outside ");
  fs.writeFileSync(path.join(outside, "victim.txt"), "victim\n");
  fs.writeFileSync(path.join(outside, "AGENTS.md"), "<!-- PASEO-HARNESS-KIT START -->\nx\n<!-- PASEO-HARNESS-KIT END -->\n");
  const before = treeHash(outside);
  const victim = slashRel(p.root, path.join(outside, "victim.txt"));
  const block = `${slashRel(p.root, path.join(outside, "AGENTS.md"))}#paseo-harness-kit`;
  for (const key of [victim, block, path.join(outside, "victim.txt"), "a\\..\\..\\b", "./a", "C:x"]) {
    const m = p.manifest();
    m.files = { ...m.files, [key]: key === block ? textDigest("x") : textDigest("victim\n") };
    p.write(".agents/harness-kit.json", JSON.stringify(m, null, 2));
    const projectBefore = treeHash(p.root);
    for (const argv of [["update", p.root, "--force"], ["status", p.root], ["pull", p.root]]) {
      const r = await runKit(argv, { kit });
      assert.equal(r.code, 1, `${argv[0]} ${key}`);
      assert.match(r.err[0], /^failed: \.agents\/harness-kit\.json records paths outside the project: /);
    }
    assert.equal(treeHash(p.root), projectBefore, key);
  }
  assert.equal(treeHash(outside), before);
});

// A Windows junction (no privilege needed) or a POSIX directory symlink.
const linkDir = (target, link) => {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, "junction");
};

test("INST-24 a linked .claude is refused before any write, also with --force; the linked tree is unchanged", async () => {
  const kit = makeKit();
  const owner = makeTempDir("paseo kit owner config ");
  fs.writeFileSync(path.join(owner, "settings.json"), '{"env":{"A":"1"}}\n');
  const p = makeProject({ "AGENTS.md": "# Mine\n" });
  linkDir(owner, p.path(".claude"));
  const before = treeHash(owner);
  for (const argv of [["install", p.root], ["install", p.root, "--force"]]) {
    const r = await runKit(argv, { kit });
    assert.equal(r.code, 1, r.stdout);
    assert.deepEqual(r.err, [`failed: .claude is a link; ${LINK}`]);
  }
  assert.equal(treeHash(owner), before);
  assert.deepEqual(fs.readdirSync(p.root).sort(), [".claude", "AGENTS.md"]);
  assert.equal(p.read("AGENTS.md"), "# Mine\n");
});

test("INST-24 a linked skill folder is a kept conflict for install, update and pull, with and without --force", async () => {
  const kit = makeKit();
  const other = makeTempDir("paseo kit other project ");
  fs.writeFileSync(path.join(other, "SKILL.md"), "other project's skill\n");
  const p = makeProject();
  linkDir(other, p.path(".claude/skills/demo"));
  const before = treeHash(other);
  const line = `conflict .claude/skills/demo/SKILL.md: .claude/skills/demo is a link; ${LINK}`;
  for (const argv of [["install", p.root, "--force"], ["update", p.root], ["update", p.root, "--force"], ["status", p.root]]) {
    const r = await runKit(argv, { kit });
    assert.equal(r.code, 2, `${argv.join(" ")}\n${r.stdout}${r.stderr}`);
    assert.ok(r.out.includes(line), r.stdout);
  }
  assert.equal(Object.hasOwn(p.manifest().files, ".claude/skills/demo/SKILL.md"), false);
  const pulled = await runKit(["pull", p.root, ".claude/skills/demo/SKILL.md", "--force"], { kit });
  assert.equal(pulled.code, 2);
  assert.ok(pulled.out.includes(`skipped .claude/skills/demo/SKILL.md (.claude/skills/demo is a link; ${LINK})`), pulled.stdout);
  assert.equal(treeHash(other), before);
  assert.equal(kit.read(".claude/skills/demo/SKILL.md"), defaultKitFiles()[".claude/skills/demo/SKILL.md"]);
});

test("INST-24 a linked file is not written through, also with --force", async (t) => {
  const kit = makeKit();
  const outside = makeTempDir("paseo kit outside file ");
  const target = path.join(outside, "a.mjs");
  fs.writeFileSync(target, "owner text\n");
  const p = makeProject();
  fs.mkdirSync(p.path(".agents/harness/runtime"), { recursive: true });
  try {
    fs.symlinkSync(target, p.path(".agents/harness/runtime/a.mjs"), "file");
  } catch (e) {
    if (e.code === "EPERM") return t.skip("file symlinks need a privilege on this machine");
    throw e;
  }
  const r = await runKit(["install", p.root, "--force"], { kit });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes(`conflict .agents/harness/runtime/a.mjs: .agents/harness/runtime/a.mjs is a link; ${LINK}`), r.stdout);
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 2);
  assert.ok(s.out.includes(`conflict .agents/harness/runtime/a.mjs: .agents/harness/runtime/a.mjs is a link; ${LINK}`), s.stdout);
  assert.equal(fs.readFileSync(target, "utf8"), "owner text\n");
});

const REF_FINAL_START = "# >>> paseo-harness-kit: generated paths, kept by install.mjs and ph skills-sync (edit outside this block)";

test("INST-19 an older kit's ignore block is recognized by its marker prefix and replaced in place", async () => {
  const block = (eol) => [GITIGNORE_START, "/_workspace/", "/.claude/worktrees/", GITIGNORE_END].join(eol);
  const older = `node_modules/\r\n${REF_FINAL_START}\r\n/.agents/skills/harness/\r\n${GITIGNORE_END}\r\ndist/\r\n`;
  assert.equal(putGitignoreBlock(older), `node_modules/\r\n${block("\r\n")}\r\ndist/\r\n`);
  assert.throws(() => putGitignoreBlock(`${REF_FINAL_START}\n${GITIGNORE_START}\n${GITIGNORE_END}\n`), /broken/);
  assert.throws(() => putGitignoreBlock(`${GITIGNORE_END}\n${GITIGNORE_START}\n`), /broken/);
  assert.equal(putGitignoreBlock("# >>> paseo-harness-kitty\n"), `# >>> paseo-harness-kitty\n\n${block("\n")}\n`);
});

test("INST-31 an older kit project with its ref-final ignore block completes a fresh install after the manifest is moved aside", async () => {
  const kit = makeKit();
  const older = `node_modules/\r\n${REF_FINAL_START}\r\n/.agents/skills/harness/\r\n${GITIGNORE_END}\r\ndist/\r\n`;
  const p = makeProject({ ".agents/harness-kit.old.json": '{"kit":"C:/old","version":"0.1.0","files":{}}\n', ".gitignore": older });
  const r = await runKit(["install", p.root], { kit });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(p.exists(".agents/harness-kit.json"));
  const text = p.read(".gitignore");
  assert.equal(text.split(GITIGNORE_START).length, 2);
  assert.ok(text.startsWith("node_modules/\r\n") && text.endsWith(`${GITIGNORE_END}\r\ndist/\r\n`));
  assert.equal(text.includes("skills"), false);
});

const cmd = (name) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${name}.mjs"`;
const PROJECT_HOOK = { type: "command", command: "node .claude/hooks/project_check.mjs" };
const commands = (settings) => Object.values(settings.hooks ?? {}).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));

// A kit with an extra registered hook `old_guard`, installed, then a release that retires it from units and template.
async function retiredHookProject() {
  const withOld = structuredClone(TEMPLATE);
  withOld.hooks.PreToolUse.push({ matcher: "Write", hooks: [{ type: "command", command: cmd("old_guard"), timeout: 10 }] });
  const kit = makeKit({ files: { ...defaultKitFiles(), ".claude/hooks/old_guard.mjs": "// old_guard\n" }, template: withOld });
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  const settings = p.json(".claude/settings.json");
  settings.hooks.PreToolUse.find((g) => g.hooks.some((h) => h.command === cmd("old_guard"))).hooks.push(PROJECT_HOOK);
  p.write(".claude/settings.json", JSON.stringify(settings, null, 2));
  kit.remove(".claude/hooks/old_guard.mjs");
  kit.write("templates/settings.hooks.json", JSON.stringify(TEMPLATE, null, 2));
  kit.sync();
  return { kit, p };
}

test("INST-14 update removes the registrations of a hook it deleted as retired; an owner hook in its group stays", async () => {
  const { kit, p } = await retiredHookProject();
  const r = await runKit(["update", p.root], { kit });
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes("deleted .claude/hooks/old_guard.mjs (no longer in the kit)"));
  const after = commands(p.json(".claude/settings.json"));
  assert.equal(after.includes(cmd("old_guard")), false);
  assert.equal(after.filter((c) => c === PROJECT_HOOK.command).length, 1);
  assert.ok(after.includes(cmd("io_guard")));
});

test("INST-07 an edited retired hook keeps its script and its registrations", async () => {
  const { kit, p } = await retiredHookProject();
  p.write(".claude/hooks/old_guard.mjs", "// owner edit\n");
  const r = await runKit(["update", p.root, "--force"], { kit });
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.out.some((l) => l.startsWith("kept .claude/hooks/old_guard.mjs (removed-local")), r.stdout);
  assert.equal(p.read(".claude/hooks/old_guard.mjs"), "// owner edit\n");
  const after = commands(p.json(".claude/settings.json"));
  assert.ok(after.includes(cmd("old_guard")) && after.includes(PROJECT_HOOK.command));
});
