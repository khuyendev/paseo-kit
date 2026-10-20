import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MIN_CLAUDE_VERSION, versionAtLeast } from "../../ship/.agents/harness/platform.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { claudeEnv, defaultKitFiles, FAKE_CLAUDE, LIVE_CONFIG_DIRS, makeKit, makeProject, runKit, treeHash } from "./helpers.mjs";

const below = MIN_CLAUDE_VERSION.replace(/\d+$/, (n) => String(Number(n) - 1));
const pluginCalls = (calls) => calls.filter((c) => c.args[0] === "plugin");
const installCall = (calls) => calls.find((c) => c.args[0] === "plugin" && c.args[1] === "install");

test("INST-20 version gate below the minimum: exit 1, nothing written, only --version called", async () => {
  const { env, calls } = claudeEnv({ FAKE_CC_VERSION: below });
  const p = makeProject({ "keep.md": "k\n" });
  const before = treeHash(p.root);
  const r = await runKit(["install", p.root, "--enable-plugin"], { kit: makeKit(), env });
  assert.equal(r.code, 1);
  assert.match(r.err[0], new RegExp(`^failed: file mod requires Claude Code >= ${MIN_CLAUDE_VERSION.replace(/\./g, "\\.")}; found ${below}`));
  assert.equal(treeHash(p.root), before);
  assert.deepEqual(calls().map((c) => c.args), [["--version"]]);
});

test("INST-20 a kept local edit of a mod file fails with the assets message and no plugin install", async () => {
  const kit = makeKit();
  const { env, calls } = claudeEnv();
  const p = makeProject();
  await runKit(["install", p.root], { kit, env });
  p.write(".claude/plugins/harness-files/register.ts", "// mine\n");
  const r = await runKit(["update", p.root, "--enable-plugin"], { kit, env });
  assert.equal(r.code, 1);
  assert.deepEqual(r.err, ["failed: mod activation: file mod has untracked or locally modified assets; resolve conflicts before enabling"]);
  assert.equal(installCall(calls()), undefined);
  p.write(".claude/plugins/harness-files/register.ts", kit.read(".claude/plugins/harness-files/register.ts"));
  p.write(".claude/plugins/harness-files/extra.txt", "untracked\n");
  assert.equal((await runKit(["update", p.root, "--enable-plugin"], { kit, env })).code, 1);
});

test("INST-20 success: exact args, cwd = project, caller's CLAUDE_CONFIG_DIR; no flag makes no plugin call", async () => {
  const kit = makeKit();
  const { env, calls } = claudeEnv();
  const plain = makeProject();
  const n = await runKit(["install", plain.root], { kit, env });
  assert.equal(n.code, 0);
  assert.ok(n.out.some((l) => l.startsWith("harness-files mod: copied, not enabled")));
  assert.deepEqual(calls(), []);
  const p = makeProject();
  const r = await runKit(["install", p.root, "--enable-plugin"], { kit, env });
  assert.equal(r.code, 0, r.stderr);
  const call = installCall(calls());
  assert.deepEqual(call.args, ["plugin", "install", "harness-files", "--marketplace", path.join(p.root, ".claude", "plugins"), "--scope", "project"]);
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(p.root));
  assert.equal(call.CLAUDE_CONFIG_DIR, env.CLAUDE_CONFIG_DIR);
  assert.ok(r.out.some((l) => /current-session activation is not verified/.test(l)));
  assert.equal(p.json(".claude/settings.json").enabledPlugins["harness-files@paseo-harness-kit"], true);
  const again = await runKit(["update", p.root], { kit, env });
  assert.ok(again.out.some((l) => l.startsWith("harness-files mod: project settings already enable it")));
  assert.ok(Object.keys(p.json(".claude/settings.json").hooks).length > 0);
});

test("INST-21 an identical marketplace elsewhere is reused; a differing one stops with no install or removal", async () => {
  const kit = makeKit();
  const other = makeProject();
  await runKit(["install", other.root], { kit });
  const listing = JSON.stringify([{ name: "paseo-harness-kit", source: "directory", path: path.join(other.root, ".claude", "plugins") }]);
  const same = claudeEnv({ FAKE_MARKETPLACES: listing });
  const p = makeProject();
  const r = await runKit(["install", p.root, "--enable-plugin"], { kit, env: same.env });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(installCall(same.calls()).args, ["plugin", "install", "harness-files@paseo-harness-kit", "--scope", "project"]);
  assert.ok(r.out.some((l) => l.includes(`reusing the marketplace already registered from ${path.join(other.root, ".claude", "plugins")}`)));
  other.write(".claude/plugins/harness-files/register.ts", "// other version\n");
  const diff = claudeEnv({ FAKE_MARKETPLACES: listing });
  const q = makeProject();
  const d = await runKit(["install", q.root, "--enable-plugin"], { kit, env: diff.env });
  assert.equal(d.code, 1);
  assert.match(d.err[0], /^failed: mod activation: marketplace paseo-harness-kit is already registered from .* with different plugin files; update that project to this kit version, or run: claude plugin marketplace remove paseo-harness-kit$/);
  assert.deepEqual(pluginCalls(diff.calls()).map((c) => c.args.slice(0, 3)), [["plugin", "marketplace", "list"]]);
  const failing = claudeEnv({ FAKE_MARKETPLACES: "fail" });
  const f = makeProject();
  assert.equal((await runKit(["install", f.root, "--enable-plugin"], { kit, env: failing.env })).code, 0);
  assert.equal(installCall(failing.calls()).args[3], "--marketplace");
});

test("INST-18 a failing wiring step names the step, writes no manifest and claims no success; the rerun succeeds", async () => {
  const kit = makeKit();
  const p = makeProject();
  const bad = claudeEnv({ FAKE_PLUGIN_EXIT: "9" });
  const r = await runKit(["install", p.root, "--enable-plugin"], { kit, env: bad.env });
  assert.equal(r.code, 1);
  assert.match(r.err[0], /^failed: mod activation: plugin install failed \(9\): fake plugin install failure$/);
  assert.equal(p.exists(".agents/harness-kit.json"), false);
  assert.equal(r.stdout.includes("installed paseo-kit"), false);
  const good = claudeEnv();
  const ok = await runKit(["install", p.root, "--enable-plugin"], { kit, env: good.env });
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.out.at(-1), /^installed paseo-kit/);
});

test("INST-33 wiring uses the prospective record: clean kit update registers new hooks and activates; failures keep the old manifest", async () => {
  const kit = makeKit();
  const p = makeProject();
  const { env, calls } = claudeEnv();
  assert.equal((await runKit(["install", p.root, "--enable-plugin"], { kit, env })).code, 0);
  kit.write(".claude/hooks/io_guard.mjs", "// io v2\n");
  kit.write(".claude/plugins/harness-files/register.ts", "// mod v2\n");
  const failing = claudeEnv({ FAKE_PLUGIN_EXIT: "4" });
  const manifestBefore = p.read(".agents/harness-kit.json");
  assert.equal((await runKit(["update", p.root, "--enable-plugin"], { kit, env: failing.env })).code, 1);
  assert.equal(p.read(".agents/harness-kit.json"), manifestBefore);
  const u = await runKit(["update", p.root, "--enable-plugin"], { kit, env });
  assert.equal(u.code, 0, u.stdout + u.stderr);
  assert.equal(calls().filter((c) => c.args[1] === "install").length, 2);
  assert.equal(u.out.some((l) => l.startsWith("conflict ")), false);
  p.write(".claude/hooks/context_guard.mjs", "// mine\n");
  const blocked = await runKit(["update", p.root], { kit, env });
  assert.ok(blocked.out.includes("conflict .claude/hooks/context_guard.mjs: local script differs; its registrations were kept unchanged"));
  const forced = await runKit(["update", p.root, "--force"], { kit, env });
  assert.equal(forced.code, 0, forced.stdout);
  assert.equal(forced.out.some((l) => l.startsWith("conflict ")), false);
});

test("INST-23 versionAtLeast and a .cmd Claude CLI in a folder with spaces", { skip: process.platform !== "win32" && "Windows .cmd shim" }, async () => {
  assert.equal(versionAtLeast("2.1.296 (Claude Code)", "2.1.296"), true);
  assert.equal(versionAtLeast("2.1.295", "2.1.296"), false);
  assert.equal(versionAtLeast("unknown", "2.1.296"), null);
  const bin = makeTempDir("paseo kit claude bin ");
  const shim = path.join(bin, "claude shim.cmd");
  fs.writeFileSync(shim, `@"${process.execPath}" "${FAKE_CLAUDE}" %*\r\n`);
  const { env, calls } = claudeEnv({}, shim);
  const p = makeProject();
  const r = await runKit(["install", p.root, "--enable-plugin"], { kit: makeKit(), env });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls().map((c) => c.args.slice(0, 2)), [["--version"], ["plugin", "marketplace"], ["plugin", "install"]]);
});

test("INST-29 fake CLI logs stay in temp folders and never name the owner's live config, mcp or restart", async () => {
  const { env, calls } = claudeEnv();
  const p = makeProject();
  await runKit(["install", p.root, "--enable-plugin"], { kit: makeKit(), env });
  const logged = calls();
  assert.ok(logged.length >= 3);
  for (const c of logged) {
    for (const dir of LIVE_CONFIG_DIRS) {
      for (const value of [c.cwd, c.CLAUDE_CONFIG_DIR, ...c.args]) assert.equal(String(value).toLowerCase().startsWith(dir.toLowerCase()), false, value);
    }
    assert.equal(c.args.some((a) => /^(mcp|restart)$/.test(a)), false);
  }
  for (const key of ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "PASEO_HOME"]) assert.match(env[key], / /);
  assert.equal(env.PASEO_HARNESS_ROOT, undefined);
});

test("INST-20 FTOL-05 a mod without its backend discovery script is not activated", async () => {
  const files = defaultKitFiles();
  delete files[".claude/plugins/harness-files/scripts/discover.mjs"];
  const { env, calls } = claudeEnv();
  const p = makeProject();
  const r = await runKit(["install", p.root, "--enable-plugin"], { kit: makeKit({ files }), env });
  assert.equal(r.code, 1);
  assert.deepEqual(r.err.filter((l) => l.startsWith("failed:")), ["failed: mod activation: file mod has untracked or locally modified assets; resolve conflicts before enabling"]);
  assert.equal(installCall(calls()), undefined);
});
