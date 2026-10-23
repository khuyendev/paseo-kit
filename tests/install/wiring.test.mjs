import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { reconcileSettings } from "../../kit/install/hooks.mjs";
import { addImport, GITIGNORE_END, GITIGNORE_START, putGitignoreBlock } from "../../kit/install/text.mjs";
import { makeKit, makeProject, runKit, SHIP_DIR } from "./helpers.mjs";

const TEMPLATE = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, "templates", "settings.hooks.json"), "utf8"));
const cmd = (name) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${name}.mjs"`;
const PROJECT_HOOK = { type: "command", command: "node .claude/hooks/project_check.mjs" };

// [event, matcher, command, timeout] per registration.
const registrations = (settings) => Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
  groups.flatMap((g) => g.hooks.map((h) => [event, g.matcher ?? null, h.command, h.timeout ?? null])));

test("HOOK-01 template merged into empty settings gives exactly the eight kit entries", () => {
  const edits = "Edit|MultiEdit|Write|mcp__.*__(edit|write)_multiple_files";
  assert.deepEqual(registrations(reconcileSettings({}, TEMPLATE)).sort(), [
    ["PreToolUse", "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|mcp__harness-files__.*", cmd("io_guard"), 10],
    ["PostToolUse", "Read|Grep|Glob|mcp__harness-files__read_ranges", cmd("io_guard"), 10],
    ["PostToolUse", "*", cmd("context_guard"), 10],
    ["UserPromptSubmit", null, cmd("context_guard"), 10],
    ["PreToolUse", "Bash", cmd("bash_long_command"), 10],
    ["PreToolUse", "Skill", cmd("skill_usage"), 10],
    ["PreToolUse", edits, cmd("syntax_check"), 90],
    ["PostToolUse", edits, cmd("syntax_check"), 90],
  ].sort());
});

test("INST-14 update keeps a project hook in a kit group and an edited kit hook's registrations; clean runs do not rewrite", async () => {
  const kit = makeKit();
  const p = makeProject();
  await runKit(["install", p.root], { kit });
  const settings = p.json(".claude/settings.json");
  settings.hooks.PreToolUse[0].hooks.push(PROJECT_HOOK);
  settings.env = { A: "1" };
  settings.permissions = { allow: ["Bash(git:*)"] };
  settings.enabledPlugins = { "x@y": true };
  const ioOld = { matcher: "Read", hooks: [{ type: "command", command: cmd("io_guard"), timeout: 5 }] };
  settings.hooks.PostToolUse.unshift(ioOld);
  p.write(".claude/settings.json", JSON.stringify(settings, null, 2));
  p.write(".claude/hooks/io_guard.mjs", "// edited\n");
  const r = await runKit(["update", p.root], { kit });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("conflict .claude/hooks/io_guard.mjs: local script differs; its registrations were kept unchanged"));
  const after = p.json(".claude/settings.json");
  assert.deepEqual(after.env, { A: "1" });
  assert.deepEqual(after.permissions, settings.permissions);
  assert.deepEqual(after.enabledPlugins, { "x@y": true });
  const io = registrations(after).filter((x) => x[2] === cmd("io_guard"));
  assert.deepEqual(io.sort(), registrations(settings).filter((x) => x[2] === cmd("io_guard")).sort());
  assert.equal(registrations(after).filter((x) => x[2] === PROJECT_HOOK.command).length, 1);
  p.write(".claude/hooks/io_guard.mjs", kit.read(".claude/hooks/io_guard.mjs"));
  await runKit(["update", p.root], { kit });
  const bytes = p.read(".claude/settings.json");
  const mtime = fs.statSync(p.path(".claude/settings.json")).mtimeMs;
  const second = await runKit(["update", p.root], { kit });
  assert.equal(second.code, 0, second.stdout);
  assert.equal(p.read(".claude/settings.json"), bytes);
  assert.equal(fs.statSync(p.path(".claude/settings.json")).mtimeMs, mtime);
  assert.equal(registrations(p.json(".claude/settings.json")).filter((x) => x[2] === cmd("io_guard")).length, 2);
});

test("INST-14 a hook added to the template is reconciled with no code change; fresh install registers every kit hook", async () => {
  const template = structuredClone(TEMPLATE);
  template.hooks.Stop = [{ hooks: [{ type: "command", command: cmd("new_hook"), timeout: 10 }] }];
  const kit = makeKit({ template });
  kit.write(".claude/hooks/new_hook.mjs", "// new\n");
  kit.sync();
  const p = makeProject();
  const r = await runKit(["install", p.root], { kit });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(registrations(p.json(".claude/settings.json")).sort(), registrations(reconcileSettings({}, template)).sort());
});

test("INST-15 template and installed settings name only shipped tools and kit hooks", async () => {
  const p = makeProject();
  await runKit(["install", p.root], { kit: makeKit() });
  for (const text of [fs.readFileSync(path.join(SHIP_DIR, "templates", "settings.hooks.json"), "utf8"), p.read(".claude/settings.json")]) {
    assert.doesNotMatch(text, /fsbatch|mcp__filesystem__|subagent_file_tools/);
  }
  assert.deepEqual(registrations(p.json(".claude/settings.json")).sort(), registrations(reconcileSettings({}, TEMPLATE)).sort());
});

test("HOOK-03 project hooks on the kit's matchers stay unchanged and unduplicated beside one copy of each kit entry", async () => {
  const kit = makeKit();
  const own = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [PROJECT_HOOK] }], PostToolUse: [{ matcher: "*", hooks: [PROJECT_HOOK] }] } };
  const p = makeProject({ ".claude/settings.json": JSON.stringify(own) });
  await runKit(["install", p.root], { kit });
  await runKit(["update", p.root], { kit });
  const regs = registrations(p.json(".claude/settings.json"));
  assert.deepEqual(regs.filter((x) => x[2] === PROJECT_HOOK.command), [["PreToolUse", "Bash", PROJECT_HOOK.command, null], ["PostToolUse", "*", PROJECT_HOOK.command, null]]);
  assert.deepEqual(regs.filter((x) => x[2] !== PROJECT_HOOK.command).sort(), registrations(reconcileSettings({}, TEMPLATE)).sort());
});

test("INST-16 CLAUDE.md gets @AGENTS.md after the leading @ lines, EOL kept, idempotent", async () => {
  assert.equal(addImport("@a\ntext"), "@a\n@AGENTS.md\n\ntext");
  assert.equal(addImport("@a\r\ntext\r\n"), "@a\r\n@AGENTS.md\r\n\r\ntext\r\n");
  assert.equal(addImport("# Title\n"), "@AGENTS.md\n\n# Title\n");
  assert.equal(addImport("@a"), "@a\n@AGENTS.md\n");
  assert.equal(addImport(null), "@AGENTS.md\n");
  assert.equal(addImport("x\n@AGENTS.md\n"), null);
  const kit = makeKit();
  const p = makeProject({ "CLAUDE.md": "@a\r\ntext\r\n" });
  const r = await runKit(["install", p.root], { kit });
  assert.ok(r.out.includes("CLAUDE.md: added @AGENTS.md"));
  assert.equal(p.read("CLAUDE.md"), "@a\r\n@AGENTS.md\r\n\r\ntext\r\n");
  const mtime = fs.statSync(p.path("CLAUDE.md")).mtimeMs;
  const u = await runKit(["update", p.root], { kit });
  assert.ok(u.out.includes("CLAUDE.md already imports AGENTS.md"));
  assert.equal(fs.statSync(p.path("CLAUDE.md")).mtimeMs, mtime);
});

test("INST-17 seeds created once, valid, unrecorded; existing seeds and .planning files untouched", async () => {
  const kit = makeKit();
  const fresh = makeProject();
  const r = await runKit(["install", fresh.root], { kit });
  for (const line of ["created .agents/harness.config.json", "created .agents/harness-history.md", "created .planning/"]) assert.ok(r.out.includes(line), line);
  assert.doesNotThrow(() => loadConfig(fresh.root));
  const seed = fresh.json(".agents/harness.config.json");
  assert.deepEqual(Object.keys(seed), ["_notes", "adapter", "gsd"]);
  assert.ok(fresh.read(".agents/harness-history.md").replace(/\r\n/g, "\n").split("\n").includes("| Date | Change | Scope | Reason | Supersedes |"));
  assert.deepEqual(fs.readdirSync(fresh.path(".planning")), []);
  const files = Object.keys(fresh.manifest().files);
  assert.equal(files.some((k) => k.startsWith(".agents/harness.config") || k.startsWith(".agents/harness-history") || k.startsWith(".planning")), false);
  const p = makeProject({ ".agents/harness.config.json": '{"max_subagents": 7}', ".planning/STATE.md": "state\n", ".planning/ROADMAP.md": "road\n" });
  for (const argv of [["install", p.root], ["update", p.root], ["update", p.root, "--force"]]) {
    await runKit(argv, { kit });
    assert.equal(p.read(".agents/harness.config.json"), '{"max_subagents": 7}');
    assert.equal(p.read(".planning/STATE.md"), "state\n");
    assert.equal(p.read(".planning/ROADMAP.md"), "road\n");
  }
});

test("INST-19 .gitignore block replaced in place, appended after a blank line, EOL kept, no rewrite when unchanged", async () => {
  const old = `${GITIGNORE_START}\r\n/old/\r\n${GITIGNORE_END}\r\n`;
  const block = (eol) => [GITIGNORE_START, "/_workspace/", "/.claude/worktrees/", GITIGNORE_END].join(eol);
  assert.equal(putGitignoreBlock(`node_modules/\r\n${old}dist/\r\n`), `node_modules/\r\n${block("\r\n")}\r\ndist/\r\n`);
  assert.equal(putGitignoreBlock("build"), `build\n\n${block("\n")}\n`);
  assert.equal(putGitignoreBlock("build\n"), `build\n\n${block("\n")}\n`);
  assert.equal(putGitignoreBlock(null), `${block("\n")}\n`);
  const kit = makeKit();
  const p = makeProject({ ".gitignore": "build" });
  await runKit(["install", p.root], { kit });
  assert.equal(p.read(".gitignore"), `build\n\n${block("\n")}\n`);
  const mtime = fs.statSync(p.path(".gitignore")).mtimeMs;
  await runKit(["update", p.root], { kit });
  assert.equal(fs.statSync(p.path(".gitignore")).mtimeMs, mtime);
  spawnSync("git", ["init", "-q"], { cwd: p.root });
  const ignored = (rel) => spawnSync("git", ["check-ignore", "-q", rel], { cwd: p.root }).status === 0;
  assert.ok(ignored("_workspace/_runs/x") && ignored(".claude/worktrees/a"));
  for (const rel of [".planning/STATE.md", ".agents/harness-kit.json", ".claude/settings.json"]) assert.equal(ignored(rel), false, rel);
});
