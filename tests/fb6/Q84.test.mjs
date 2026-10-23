// Kit feedback #84 (Q84): the hooks name the harness-files mod's tools, so with the mod unselected and an old batch
// writer server still registered nothing was checked. F1 doctor reports the server as a problem, F2 install/update
// without --enable-plugin say so, F3 the syntax_check matchers and script cover any `mcp__*__(edit|write)_multiple_files`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { runSyntaxCheck, targetPaths } from "../../ship/.claude/hooks/syntax_check.mjs";
import { lintRegistration, registrations } from "../hooks/registration-lint.mjs";
import { hookProject } from "../hooks/helpers.mjs";
import { claudeEnv, makeKit, makeProject, runKit } from "../install/helpers.mjs";
import { makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";

const FAKE_CHECKER = fileURLToPath(new URL("../hooks/fixtures/fake_checker.mjs", import.meta.url));
const FSBATCH = { type: "stdio", command: "node", args: ["C:/old-kit/mcp/mcp_fs_batch.mjs", "C:/"], env: {} };
const FILESYSTEM = { type: "stdio", command: "node", args: ["C:/old-kit/mcp/mcp_fs_proxy.mjs", "server-filesystem/dist/index.js", "C:/"], env: {} };
const GITHUB = { type: "stdio", command: "node", args: ["github-mcp.js"], env: {} };
const MOD_ID = "harness-files@paseo-harness-kit";

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};

async function doctor(s) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  const code = await runDoctor(ctx, { freemem: () => 64 * 2 ** 30, claudeVersionText: () => "2.1.300 (Claude Code)" });
  return { code, out };
}
const writerLines = (r) => r.out.filter((l) => /MCP server /.test(l));
const globalConfig = (env) => path.join(env.CLAUDE_CONFIG_DIR, ".claude.json");

test("Q84 F1 doctor: mod not selected and fsbatch + filesystem registered at user scope -> one problem each, with the remove command", async () => {
  const s = setup();
  writeJson(globalConfig(s.env), { mcpServers: { fsbatch: FSBATCH, filesystem: FILESYSTEM, github: GITHUB } });
  const r = await doctor(s);
  const lines = writerLines(r);
  assert.equal(lines.length, 2, r.out.join("\n"));
  assert.match(lines[0], /^problem MCP server fsbatch \(user scope, .*\.claude\.json\) exposes file writers while the file mod is not selected/);
  assert.match(lines[0], /claude mcp remove --scope user fsbatch/);
  assert.match(lines[1], /^problem MCP server filesystem \(user scope/);
  assert.match(lines[1], /claude mcp remove --scope user filesystem/);
  assert.ok(r.out.some((l) => /^note file mod not selected/.test(l)));
  assert.equal(r.code, 2);
});

test("Q84 F1 doctor: local scope (projects[root]) and project scope (.mcp.json) are read too", async () => {
  const s = setup();
  writeJson(globalConfig(s.env), { projects: { [s.root.replace(/\\/g, "/")]: { mcpServers: { fsbatch: FSBATCH } }, "C:/other": { mcpServers: { filesystem: FILESYSTEM } } } });
  s.project.write(".mcp.json", JSON.stringify({ mcpServers: { filesystem: FILESYSTEM } }));
  const lines = writerLines(await doctor(s));
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.ok(lines.some((l) => /fsbatch \(local scope/.test(l) && /remove --scope local fsbatch/.test(l)));
  assert.ok(lines.some((l) => /filesystem \(project scope.*\.mcp\.json/.test(l) && /remove --scope project filesystem/.test(l)));
});

test("Q84 F1 doctor: no problem when no writer server is registered, for unrelated servers, or the mod's own name", async () => {
  const s = setup();
  const quiet = await doctor(s);
  assert.deepEqual(writerLines(quiet), []);
  assert.ok(quiet.out.some((l) => /^note file mod not selected/.test(l)));
  writeJson(globalConfig(s.env), { mcpServers: { github: GITHUB, "harness-files": FSBATCH, "plugin:harness-files:files": FSBATCH } });
  assert.deepEqual(writerLines(await doctor(s)), []);
});

test("Q84 F1 doctor: no problem once the mod is selected (project settings) or loaded directly", async () => {
  const s = setup();
  writeJson(globalConfig(s.env), { mcpServers: { fsbatch: FSBATCH } });
  assert.equal(writerLines(await doctor(s)).length, 1);
  s.project.write(".claude/settings.json", JSON.stringify({ enabledPlugins: { [MOD_ID]: true } }));
  assert.deepEqual(writerLines(await doctor(s)), []);
  const t = setup();
  writeJson(globalConfig(t.env), { mcpServers: { fsbatch: FSBATCH } });
  t.env.CLAUDE_CODE_PLUGIN_DIRS = path.join(t.root, ".claude", "plugins", "harness-files");
  assert.deepEqual(writerLines(await doctor(t)), []);
});

test("Q84 F1 doctor: an unreadable MCP config is a note and the other checks still run", async () => {
  const s = setup();
  writeJson(globalConfig(s.env), "{ broken");
  s.project.write(".mcp.json", JSON.stringify({ mcpServers: { fsbatch: FSBATCH } }));
  const r = await doctor(s);
  assert.ok(r.out.some((l) => /^note MCP registrations: .*\.claude\.json not read/.test(l)), r.out.join("\n"));
  assert.equal(writerLines(r).length, 1);
  assert.ok(r.out.some((l) => /^ok harness config valid$/.test(l)));
});

test("Q84 F2 install and update without --enable-plugin print the doctor line, the hook consequence and the registered writer", async () => {
  const kit = makeKit();
  const { env } = claudeEnv();
  writeJson(globalConfig(env), { mcpServers: { fsbatch: FSBATCH } });
  const p = makeProject();
  for (const verb of ["install", "update"]) {
    const r = await runKit([verb, p.root], { kit, env });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.ok(r.out.some((l) => l.startsWith("harness-files mod: copied, not enabled")));
    const off = r.out.find((l) => l.startsWith("harness-files mod: not selected"));
    assert.ok(off, r.out.join("\n"));
    assert.match(off, /ph doctor: note file mod not selected/);
    assert.match(off, /io_guard reminders do not run/);
    assert.match(off, /mcp__<server>__\(edit\|write\)_multiple_files/);
    assert.ok(r.out.some((l) => /^problem MCP server fsbatch \(user scope/.test(l) && /claude mcp remove --scope user fsbatch/.test(l)), r.out.join("\n"));
  }
});

test("Q84 F2 no writer server: the consequence line only; mod already enabled or --enable-plugin: neither line", async () => {
  const kit = makeKit();
  const { env } = claudeEnv();
  const p = makeProject();
  const plain = await runKit(["install", p.root], { kit, env });
  assert.ok(plain.out.some((l) => l.startsWith("harness-files mod: not selected")));
  assert.ok(!plain.out.some((l) => /MCP server/.test(l)));
  writeJson(globalConfig(env), { mcpServers: { fsbatch: FSBATCH } });
  p.write(".claude/settings.json", JSON.stringify({ ...p.json(".claude/settings.json"), enabledPlugins: { [MOD_ID]: true } }));
  const enabled = await runKit(["update", p.root], { kit, env });
  assert.ok(enabled.out.some((l) => l.startsWith("harness-files mod: project settings already enable it")));
  assert.ok(!enabled.out.some((l) => /not selected|MCP server/.test(l)), enabled.out.join("\n"));
  const flagged = await runKit(["update", p.root, "--enable-plugin"], { kit, env });
  assert.ok(!flagged.out.some((l) => /not selected|MCP server/.test(l)), flagged.out.join("\n"));
});

const template = () => JSON.parse(fs.readFileSync(path.join(SHIP_DIR, "templates", "settings.hooks.json"), "utf8"));
const matches = (matcher, tool) => new RegExp(`^(?:${matcher})$`).test(tool);

test("Q84 F3 template: syntax_check matchers (Pre and Post) match any server's batch writers, nothing else new", () => {
  const regs = registrations(template()).filter((r) => r.script === "syntax_check.mjs");
  assert.deepEqual(regs.map((r) => r.event).sort(), ["PostToolUse", "PreToolUse"]);
  for (const { matcher } of regs) {
    for (const tool of ["Edit", "MultiEdit", "Write", "mcp__harness-files__edit_multiple_files", "mcp__harness-files__write_multiple_files", "mcp__fsbatch__edit_multiple_files", "mcp__fsbatch__write_multiple_files", "mcp__other-srv__write_multiple_files"]) {
      assert.ok(matches(matcher, tool), `${matcher} should match ${tool}`);
    }
    for (const tool of ["mcp__filesystem__read_multiple_files", "mcp__fsbatch__read_ranges", "Read", "Bash", "mcp__harness-files__read_ranges"]) {
      assert.ok(!matches(matcher, tool), `${matcher} should not match ${tool}`);
    }
  }
  const t = template();
  assert.deepEqual(lintRegistration(t), []);
  t.hooks.PreToolUse[0].matcher += "|mcp__fsbatch__.*";
  assert.match(lintRegistration(t).join("\n"), /mcp__fsbatch__\.\* names a tool the kit does not ship/);
});

test("Q84 F3 syntax_check target paths: files[].path, fixes[].path, string files/paths; reply lines of any batch writer, not of a reader", () => {
  const fsb = (event, input, text) => targetPaths({ tool_name: "mcp__fsbatch__edit_multiple_files", tool_input: input, tool_response: text }, event);
  assert.deepEqual(fsb("PreToolUse", { files: [{ path: "a.txt", edits: [] }], fixes: [{ id: "x", path: "b.txt" }] }), ["a.txt", "b.txt"]);
  assert.deepEqual(fsb("PreToolUse", { files: ["c.txt"], paths: ["d.txt"], path: "e.txt" }), ["e.txt", "c.txt", "d.txt"]);
  assert.deepEqual(fsb("PostToolUse", { fixes: [{ id: "x" }] }, "edited /w/f.txt: 1 edit(s) applied"), ["/w/f.txt"]);
  const reader = targetPaths({ tool_name: "mcp__fsbatch__read_ranges", tool_input: {}, tool_response: "wrote /w/g.txt (3 chars)" }, "PostToolUse");
  assert.deepEqual(reader, []);
  assert.deepEqual(targetPaths({ tool_name: "Edit", tool_input: { file_path: "h.txt" } }, "PreToolUse"), ["h.txt"]);
});

test("Q84 F3 syntax_check checks an fsbatch edit: a new error is reported, a reply-only fix call too", async () => {
  const log = path.join(makeTempDir("q84 log "), "runs.jsonl");
  const project = hookProject({ overlay: { adapter: { syntax_checkers: { ".txt": { argv: [process.execPath, FAKE_CHECKER, "--log", log, "--tag", "A"] } } } } });
  const stateDir = makeTempDir("q84 state ");
  const env = { CLAUDE_PROJECT_DIR: project.root };
  const run = async (event, tool_input, extra = {}) => {
    const input = { session_id: "q84", tool_use_id: extra.id ?? "t1", cwd: project.root, hook_event_name: event, tool_name: "mcp__fsbatch__edit_multiple_files", tool_input, ...extra };
    const res = await runSyntaxCheck(input, { env, stateDir });
    return res?.output?.hookSpecificOutput?.additionalContext ?? "";
  };
  project.write("src/a.txt", "fine");
  const edit = { files: [{ path: "src/a.txt", edits: [{ oldText: "fine", newText: "BROKEN" }] }] };
  assert.equal(await run("PreToolUse", edit), "");
  project.write("src/a.txt", "BROKEN");
  const text = await run("PostToolUse", edit, { tool_response: { content: [{ type: "text", text: `edited ${project.path("src/a.txt")}: 1 edit(s)` }] } });
  assert.match(text, /^Syntax check found new errors after this edit:/);
  assert.match(text, /:1:2: syntax error near BROKEN/);
  project.write("src/b.txt", "fine");
  const fix = { fixes: [{ id: "f1" }] };
  assert.equal(await run("PreToolUse", fix, { id: "t2" }), "");
  project.write("src/b.txt", "BROKEN");
  const text2 = await run("PostToolUse", fix, { id: "t2", tool_response: `edited ${project.path("src/b.txt")}: 1 edit(s)` });
  assert.match(text2, /src[\\/]b\.txt/);
});
