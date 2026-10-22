import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main as kitMain } from "../../kit.mjs";
import { testEnv } from "../helpers/env.mjs";
import { runNode } from "../helpers/run.mjs";
import { KIT_DIR, makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { HOOKS_DIR } from "./helpers.mjs";
import { consistencyProblems, lintRegistration, registrations } from "./registration-lint.mjs";

const TEMPLATE_FILE = path.join(SHIP_DIR, "templates", "settings.hooks.json");
const template = () => JSON.parse(fs.readFileSync(TEMPLATE_FILE, "utf8"));
const HF = "mcp__harness-files__";
const cmd = (script) => `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${script}"`;

const EXPECTED = [
  ["PreToolUse", `Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|${HF}.*`, "io_guard.mjs", 10],
  ["PreToolUse", "Bash", "bash_long_command.mjs", 10],
  ["PreToolUse", "Skill", "skill_usage.mjs", 10],
  ["PreToolUse", `Edit|MultiEdit|Write|${HF}(edit|write)_multiple_files`, "syntax_check.mjs", 90],
  ["PostToolUse", `Read|Grep|Glob|${HF}read_ranges`, "io_guard.mjs", 10],
  ["PostToolUse", "*", "context_guard.mjs", 10],
  ["PostToolUse", `Edit|MultiEdit|Write|${HF}(edit|write)_multiple_files`, "syntax_check.mjs", 90],
  ["UserPromptSubmit", undefined, "context_guard.mjs", 10],
];
const key = ([event, matcher, script, timeout]) => JSON.stringify([event, matcher ?? null, script, timeout]);

async function kit(argv, env) {
  const out = [];
  const err = [];
  const code = await kitMain(argv, { env, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

test("HOOK-01 template: exactly the eight kit entries with their matchers and timeouts", () => {
  const regs = registrations(template());
  assert.ok(regs.every((r) => r.type === "command" && r.command === cmd(r.script)));
  assert.deepEqual(regs.map((r) => key([r.event, r.matcher, r.script, r.timeout])).sort(), EXPECTED.map(key).sort());
  assert.doesNotMatch(fs.readFileSync(TEMPLATE_FILE, "utf8"), /fsbatch|mcp__filesystem__|subagent_file_tools/);
});

test("HOOK-01 each command runs a shipped script under a $CLAUDE_PROJECT_DIR with spaces", () => {
  const project = path.join(makeTempDir("hook dir "), "my project");
  fs.cpSync(HOOKS_DIR, path.join(project, ".claude", "hooks"), { recursive: true });
  for (const r of registrations(template())) {
    const file = r.command.match(/^node "(.+)"$/)[1].replace("$CLAUDE_PROJECT_DIR", project);
    assert.ok(fs.existsSync(file), file);
    const res = runNode(file, [], { env: testEnv({ CLAUDE_PROJECT_DIR: project }), input: "{}" });
    assert.equal(res.code, 0, `${r.script}: ${res.stderr}`);
  }
});

test("HOOK-02 the template names exactly the shipped hook scripts; no legacy stub", () => {
  assert.deepEqual(consistencyProblems(template(), HOOKS_DIR), []);
  const extra = template();
  extra.hooks.PreToolUse.push({ matcher: "Read", hooks: [{ type: "command", command: cmd("not_shipped.mjs"), timeout: 10 }] });
  assert.deepEqual(consistencyProblems(extra, HOOKS_DIR), ["template references not_shipped.mjs that is not shipped"]);
  assert.equal(fs.existsSync(path.join(HOOKS_DIR, "subagent_file_tools.mjs")), false);
  assert.doesNotMatch(fs.readFileSync(path.join(KIT_DIR, "kit.json"), "utf8"), /subagent_file_tools/);
});

test("HOOK-29 registration lint passes on the template, fails on a short syntax timeout or an fsbatch matcher", () => {
  assert.deepEqual(lintRegistration(template()), []);
  const short = template();
  for (const group of short.hooks.PostToolUse) for (const h of group.hooks) if (h.command.includes("syntax_check")) h.timeout = 60;
  assert.match(lintRegistration(short).join("\n"), /syntax_check\.mjs: timeout 60 s is not larger than its budget 75 s/);
  const foreign = template();
  foreign.hooks.PreToolUse[0].matcher += "|mcp__fsbatch__.*";
  assert.match(lintRegistration(foreign).join("\n"), /mcp__fsbatch__\.\* names a tool the kit does not ship/);
});

test("HOOK-03 project hooks on the kit's matchers survive install and update beside one copy of each kit entry", async () => {
  const own = { type: "command", command: "node \"$CLAUDE_PROJECT_DIR/tools/my_lint.mjs\"", timeout: 20 };
  const settings = { hooks: {
    PreToolUse: [{ matcher: "Edit|Write", hooks: [own] }],
    PostToolUse: [{ matcher: "Read|Grep|Glob", hooks: [own] }],
  } };
  const project = makeTempProject({ files: { ".claude/settings.json": `${JSON.stringify(settings, null, 2)}\n` } });
  const env = testEnv();
  const install = await kit(["install", project.root], env);
  assert.ok([0, 2].includes(install.code), install.err.join("\n"));
  const update = await kit(["update", project.root], env);
  assert.ok([0, 2].includes(update.code), update.err.join("\n"));
  const regs = registrations(project.readJson(".claude/settings.json"));
  const projectRegs = regs.filter((r) => r.command === own.command);
  assert.deepEqual(projectRegs.map((r) => `${r.event} ${r.matcher}`).sort(), ["PostToolUse Read|Grep|Glob", "PreToolUse Edit|Write"]);
  const kitRegs = regs.filter((r) => r.script);
  assert.deepEqual(kitRegs.map((r) => key([r.event, r.matcher, r.script, r.timeout])).sort(), EXPECTED.map(key).sort());
});

test("HOOK-31 hook tests use no real home path", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const self = path.basename(fileURLToPath(import.meta.url));
  const realHome = new RegExp(["[A-Za-z]:[\\\\/]Users[\\\\/]", "/home/[a-z]", "homedir\\(", "\\.claude-circle"].join("|"));
  const files = fs.readdirSync(here, { recursive: true }).filter((n) => n.endsWith(".mjs") && path.basename(n) !== self);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(here, file), "utf8"), realHome, file);
});
