import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runSyntaxCheck } from "../../ship/.claude/hooks/syntax_check.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { hookEnv, hookProject, runHookAsync, runHookSync } from "./helpers.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake_checker.mjs", import.meta.url));
const HF = "mcp__harness-files__";

function checker({ log, tag = "A", sleep, active, ...rest }) {
  const argv = [process.execPath, FAKE, "--log", log, "--tag", tag];
  if (sleep) argv.push("--sleep", String(sleep));
  if (active) argv.push("--active", active);
  return { argv, ...rest };
}

// A project whose `.txt` files are checked by the fake checker; `log` lists every checker run.
function syntaxProject(opts = {}) {
  const log = path.join(makeTempDir("syntax log "), "runs.jsonl");
  const project = hookProject({ overlay: { adapter: { syntax_checkers: { ".txt": checker({ log, ...opts }) } } } });
  return { project, log, stateDir: makeTempDir("syntax state "), env: { CLAUDE_PROJECT_DIR: project.root } };
}

const runs = (log) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

function hook(ctx, opts = {}) {
  return async (event, tool_input, extra = {}) => {
    const input = { session_id: "syn", tool_use_id: extra.id ?? "t1", cwd: ctx.project.root, hook_event_name: event, tool_name: "Edit", tool_input, ...extra };
    const res = await runSyntaxCheck(input, { env: ctx.env, stateDir: ctx.stateDir, ...opts });
    return res?.output?.hookSpecificOutput?.additionalContext ?? "";
  };
}

test("HOOK-26 reports a file edited from valid to invalid, once", async () => {
  const ctx = syntaxProject();
  const file = ctx.project.path("src/a.txt");
  ctx.project.write("src/a.txt", "fine");
  const h = hook(ctx);
  assert.equal(await h("PreToolUse", { file_path: "src/a.txt" }), "");
  ctx.project.write("src/a.txt", "BROKEN");
  const text = await h("PostToolUse", { file_path: "src/a.txt" });
  assert.match(text, /^Syntax check found new errors after this edit:/);
  assert.ok(text.includes(`${file}:`));
  assert.match(text, /:1:2: syntax error near BROKEN/);
  assert.doesNotMatch(text, /not checked before/);
});

test("HOOK-26 invalid before and after is silent; a new invalid file is reported", async () => {
  const ctx = syntaxProject();
  const h = hook(ctx);
  ctx.project.write("b.txt", "BROKEN 1");
  await h("PreToolUse", { file_path: "b.txt" });
  ctx.project.write("b.txt", "BROKEN 2");
  assert.equal(await h("PostToolUse", { file_path: "b.txt" }), "");
  await h("PreToolUse", { file_path: "new.txt" }, { id: "t2" });
  ctx.project.write("new.txt", "BROKEN");
  const text = await h("PostToolUse", { file_path: "new.txt" }, { id: "t2" });
  assert.match(text, /new\.txt:/);
  assert.doesNotMatch(text, /not checked before/);
});

test("HOOK-26 a fix-only mod edit that breaks a file is reported with the marker", async () => {
  const ctx = syntaxProject();
  const file = ctx.project.path("fixed.txt");
  ctx.project.write("fixed.txt", "BROKEN");
  const h = hook(ctx);
  assert.equal(await h("PreToolUse", { fixes: [{ id: "abc" }] }, { tool_name: `${HF}edit_multiple_files` }), "");
  const text = await h("PostToolUse", { fixes: [{ id: "abc" }] }, {
    tool_name: `${HF}edit_multiple_files`,
    tool_response: [{ type: "text", text: `edited ${file}: 1 edit, +3 chars` }],
  });
  assert.ok(text.includes(`${file} (not checked before this edit):`), text);
});

test("HOOK-26 infrastructure errors are silent and the hook exits 0", async () => {
  for (const [content, extra] of [["NODIAG", {}], ["HANG", { timeout_s: 1 }]]) {
    const ctx = syntaxProject(extra);
    ctx.project.write("x.txt", "fine");
    const h = hook(ctx);
    await h("PreToolUse", { file_path: "x.txt" });
    ctx.project.write("x.txt", content);
    assert.equal(await h("PostToolUse", { file_path: "x.txt" }), "", content);
  }
  const project = hookProject({ overlay: { adapter: { syntax_checkers: { ".txt": { argv: [path.join(makeTempDir(), "no-such-checker.exe")] } } } } });
  project.write("y.txt", "BROKEN");
  const env = hookEnv(project.root);
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const r = runHookSync(project.root, "syntax_check.mjs", { session_id: "m", tool_use_id: "u", cwd: project.root, hook_event_name: event, tool_name: "Write", tool_input: { file_path: "y.txt" } }, { env });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  }
});

test("HOOK-26 an extension without a checker spawns nothing", async () => {
  const ctx = syntaxProject();
  ctx.project.write("c.md", "BROKEN");
  const h = hook(ctx);
  await h("PreToolUse", { file_path: "c.md" });
  assert.equal(await h("PostToolUse", { file_path: "c.md" }), "");
  assert.equal(runs(ctx.log).length, 0);
});

test("HOOK-27 two concurrent hook runs never exceed 3 running checks", async () => {
  const active = makeTempDir("syntax active ");
  const ctx = syntaxProject({ sleep: 400, active });
  const files = Array.from({ length: 5 }, (_, i) => `f${i}.txt`);
  for (const f of files) ctx.project.write(f, `ok ${f}`);
  const env = hookEnv(ctx.project.root);
  const input = (id, list) => ({ session_id: id, tool_use_id: id, cwd: ctx.project.root, hook_event_name: "PreToolUse", tool_name: `${HF}write_multiple_files`, tool_input: { files: list.map((p) => ({ path: p })) } });
  // Different contents per run so the cache does not hide the second run's checks.
  const second = files.map((f) => `g${f}`);
  for (const f of second) ctx.project.write(f, `ok ${f}`);
  const results = await Promise.all([runHookAsync(ctx.project.root, "syntax_check.mjs", input("r1", files), { env }), runHookAsync(ctx.project.root, "syntax_check.mjs", input("r2", second), { env })]);
  assert.ok(results.every((r) => r.code === 0));
  const all = runs(ctx.log);
  assert.equal(all.length, 10);
  assert.ok(Math.max(...all.map((r) => r.running)) <= 3, JSON.stringify(all.map((r) => r.running)));
});

test("HOOK-27 a batch of 40 files returns within the budget, the rest skipped", async () => {
  const ctx = syntaxProject({ sleep: 300 });
  const files = Array.from({ length: 40 }, (_, i) => `b${i}.txt`);
  for (const f of files) ctx.project.write(f, "ok");
  const limits = { budgetMs: 2500, minStartMs: 500, slotWaitMs: 2000, slotStaleMs: 180000 };
  const started = Date.now();
  await hook(ctx, { limits, startedAt: started })("PreToolUse", { files: files.map((p) => ({ path: p })) }, { tool_name: `${HF}write_multiple_files` });
  assert.ok(Date.now() - started < limits.budgetMs + 1500, `${Date.now() - started} ms`);
  const n = runs(ctx.log).length;
  assert.ok(n > 0 && n < 40, `${n} checks`);
});

test("HOOK-27 cache: identical content hits; another tree or changed argv checks again", async () => {
  const ctx = syntaxProject();
  ctx.project.write("same.txt", "ok");
  const h = hook(ctx);
  await h("PreToolUse", { file_path: "same.txt" }, { id: "c1" });
  await h("PreToolUse", { file_path: "same.txt" }, { id: "c2" });
  assert.equal(runs(ctx.log).length, 1);
  ctx.project.writeJson(".agents/harness.config.json", { adapter: { syntax_checkers: { ".txt": checker({ log: ctx.log, tag: "A2" }) } } });
  await h("PreToolUse", { file_path: "same.txt" }, { id: "c3" });
  assert.deepEqual(runs(ctx.log).map((r) => r.tag), ["A", "A2"]);
  const wt = ".claude/worktrees/w1";
  ctx.project.writeJson(`${wt}/.agents/harness.config.json`, { adapter: { syntax_checkers: { ".txt": checker({ log: ctx.log, tag: "B" }) } } });
  ctx.project.write(`${wt}/same.txt`, "ok");
  await h("PreToolUse", { file_path: `${wt}/same.txt` }, { id: "c4" });
  assert.deepEqual(runs(ctx.log).map((r) => r.tag), ["A", "A2", "B"]);
});

test("HOOK-27 a failing result is cached; pre state older than 24 h is pruned", async () => {
  const ctx = syntaxProject();
  ctx.project.write("bad.txt", "BROKEN");
  const h = hook(ctx);
  await h("PreToolUse", { file_path: "bad.txt" }, { id: "d1" });
  await h("PreToolUse", { file_path: "bad.txt" }, { id: "d2" });
  assert.equal(runs(ctx.log).length, 1);
  const old = path.join(ctx.stateDir, "pre-leftover.json");
  fs.writeFileSync(old, "{}");
  const past = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  await h("PreToolUse", { file_path: "bad.txt" }, { id: "d3" });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.readdirSync(ctx.stateDir).filter((n) => n.startsWith("pre-")).length, 3);
  await h("PostToolUse", { file_path: "bad.txt" }, { id: "d3" });
  assert.equal(fs.readdirSync(ctx.stateDir).filter((n) => n.startsWith("pre-")).length, 2);
});

test("HOOK-28 the checker comes from the edited file's tree, cwd = that tree, path as one argument", async () => {
  const ctx = syntaxProject();
  const wt = ".claude/worktrees/tree with space";
  ctx.project.writeJson(`${wt}/.agents/harness.config.json`, { adapter: { syntax_checkers: { ".txt": checker({ log: ctx.log, tag: "WT" }) } } });
  ctx.project.write(`${wt}/my file.txt`, "ok");
  ctx.project.write("main.txt", "ok");
  const h = hook(ctx);
  await h("PreToolUse", { files: [{ path: `${wt}/my file.txt` }, { path: "main.txt" }] }, { tool_name: `${HF}write_multiple_files` });
  const byTag = Object.fromEntries(runs(ctx.log).map((r) => [r.tag, r]));
  assert.deepEqual(Object.keys(byTag).sort(), ["A", "WT"]);
  assert.equal(byTag.WT.file, ctx.project.path(`${wt}/my file.txt`));
  assert.equal(path.resolve(byTag.WT.cwd).toLowerCase(), path.resolve(ctx.project.path(wt)).toLowerCase());
  assert.equal(path.resolve(byTag.A.cwd).toLowerCase(), path.resolve(ctx.project.root).toLowerCase());
  assert.equal(byTag.WT.argc, 7, "node, script, 4 option tokens, one file argument");
});
