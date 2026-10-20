import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  claudeCli, claudeVersion, homeDir, NODE_REQUIREMENT, NODE_RUNTIME, nodeRuntimeProblem, paseoConfigFile, paseoHome, versionAtLeast,
} from "../../ship/.agents/harness/platform.mjs";
import { errText, failedLine, quoteName } from "../../ship/.agents/harness/lib/cli.mjs";
import { fileDigest, sha256, textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { readJson, readJsonIf, readJsonLines, readText, writeJsonAtomic, writeTextAtomic, writeTextIfChanged } from "../../ship/.agents/harness/lib/io.mjs";
import { id8, isInside, resolveInside, safeName, samePath, toSlash } from "../../ship/.agents/harness/lib/paths.mjs";
import { pidAlive, runArgv } from "../../ship/.agents/harness/lib/proc.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { assertExit } from "../helpers/assert.mjs";
import { testEnv } from "../helpers/env.mjs";
import { runNode } from "../helpers/run.mjs";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";

const win = process.platform === "win32";

test("PHCL-34 version gate and Node gate", () => {
  assert.equal(versionAtLeast("2.1.296 (Claude Code)", "2.1.296"), true);
  assert.equal(versionAtLeast("2.1.295 (Claude Code)", "2.1.296"), false);
  assert.equal(versionAtLeast("3.0.0", "2.1.296"), true);
  assert.equal(versionAtLeast("none", "2.1.296"), null);
  assert.equal(nodeRuntimeProblem("24.1.0"), null);
  assert.equal(nodeRuntimeProblem(), null);
});

test("INST-23 Node gate boundaries are driven by NODE_RUNTIME", () => {
  const { minVersion, capabilities } = NODE_RUNTIME;
  assert.equal(nodeRuntimeProblem(minVersion), null);
  const [maj, min, patch] = minVersion.split(".").map(Number);
  const lower = patch > 0 ? `${maj}.${min}.${patch - 1}` : `${maj}.${min - 1}.99`;
  assert.equal(nodeRuntimeProblem(lower), `node ${lower} is older than ${minVersion}`);
  for (const cap of capabilities) {
    const without = { minVersion, capabilities: capabilities.map((c) => (c === cap ? { ...c, probe: () => false } : c)) };
    assert.equal(nodeRuntimeProblem(minVersion, without), `node ${minVersion} lacks ${cap.name}`);
  }
  assert.ok(NODE_REQUIREMENT.includes(capabilities[0].name));
});

test("PHCL-34 Claude CLI lookup: CLAUDE_CLI, then ~/.local/bin, then PATH; .mjs through node", () => {
  const env = testEnv();
  assert.equal(claudeCli(env), "claude");
  const native = path.join(homeDir(env), ".local", "bin", win ? "claude.exe" : "claude");
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(native, "");
  assert.equal(claudeCli(env), native);
  const dir = makeTempDir("paseo kit claude ");
  const script = path.join(dir, "fake claude.mjs");
  fs.writeFileSync(script, "console.log('2.1.300 (Claude Code)');\n");
  assert.equal(claudeVersion({ ...env, CLAUDE_CLI: script }), "2.1.300 (Claude Code)");
  assert.equal(claudeVersion({ ...env, CLAUDE_CLI: path.join(dir, "missing.exe") }), null);
});

test("PHCL-34 win32: a .cmd CLI in a path with spaces runs through cmd.exe", { skip: !win }, () => {
  const dir = path.join(makeTempDir("paseo kit cmd "), "with space");
  fs.mkdirSync(dir);
  const cmd = path.join(dir, "claude.cmd");
  fs.writeFileSync(cmd, "@echo 2.1.301 (Claude Code)\r\n");
  assert.equal(claudeVersion({ ...testEnv(), CLAUDE_CLI: cmd }), "2.1.301 (Claude Code)");
});

test("PCLI-03 paseo home and config file follow PASEO_HOME, else the home dir", () => {
  const env = testEnv();
  assert.equal(paseoHome(env), env.PASEO_HOME);
  assert.equal(paseoConfigFile({ ...env, PASEO_HOME: undefined }), path.join(env.HOME, ".paseo", "config.json"));
});

test("CONF-02 readText strips one BOM; readJson names the file; readJsonLines names the line", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "a.json");
  fs.writeFileSync(file, "﻿{\"a\": \"é\"}");
  assert.equal(readText(file), "{\"a\": \"é\"}");
  assert.deepEqual(readJson(file), { a: "é" });
  fs.writeFileSync(file, "{bad");
  assert.throws(() => readJson(file), (e) => e.code === "EJSON" && e.message.startsWith(`${file}: invalid JSON (`));
  assert.equal(readJsonIf(path.join(dir, "missing.json"), 7), 7);
  assert.throws(() => readJsonIf(file), (e) => e.code === "EJSON");
  const lines = path.join(dir, "j.jsonl");
  fs.writeFileSync(lines, "﻿{\"n\":1}\r\n\r\n{\"n\":2}\n");
  assert.deepEqual(readJsonLines(lines), [{ n: 1 }, { n: 2 }]);
  fs.writeFileSync(lines, "{\"n\":1}\n{oops}\n");
  assert.throws(() => readJsonLines(lines), new RegExp(`j\\.jsonl:2: invalid JSON line`));
  const sha = path.join(dir, "freeze_p.sha256");
  fs.writeFileSync(sha, `﻿${"0".repeat(64)}  p_a.md\n`);
  assert.match(readText(sha), /^0{64} {2}p_a\.md\n$/);
});

test("CONF-02 atomic UTF-8 writes; write only when changed", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "sub dir", "x.json");
  writeJsonAtomic(file, { b: "ü" });
  assert.equal(fs.readFileSync(file, "utf8"), "{\n  \"b\": \"ü\"\n}\n");
  assert.equal(writeTextIfChanged(file, fs.readFileSync(file, "utf8")), false);
  assert.equal(writeTextIfChanged(file, "new"), true);
  writeTextAtomic(file, "final");
  assert.equal(fs.readFileSync(file, "utf8"), "final");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["x.json"]);
});

test("INST-04 one line-ending-insensitive digest", () => {
  assert.equal(textDigest("a\r\nb\r\n"), textDigest("a\nb\n"));
  assert.equal(textDigest("a\nb"), sha256("a\nb"));
  assert.equal(textDigest("x").length, 64);
  const file = path.join(makeTempDir(), "f.txt");
  fs.writeFileSync(file, "l1\r\nl2\r\n");
  assert.equal(fileDigest(file), textDigest("l1\nl2\n"));
});

test("INV-52 path helpers: containment without the sibling-prefix bug, case folding on win32", () => {
  const root = path.resolve(makeTempDir(), "proj");
  assert.equal(isInside(path.join(root, "a", "b"), root), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(`${root}-sibling`, root), false);
  assert.equal(isInside(path.join(root, "..", "x"), root), false);
  assert.equal(isInside(path.join(root, "..dots"), root), true);
  assert.equal(samePath(root.toUpperCase(), root), win);
  assert.equal(isInside(path.join(root.toUpperCase(), "a"), root), win);
  assert.throws(() => resolveInside(root, "../../etc"), /is outside/);
  assert.equal(resolveInside(root, "a/b"), path.join(root, "a", "b"));
  assert.equal(safeName("a b/c:d"), "a_b_c_d");
  assert.equal(id8("1234567890"), "12345678");
  assert.equal(toSlash(path.join("a", "b")), "a/b");
});

test("P8 output helpers", () => {
  assert.equal(errText(new Error(`first\nsecond`)), "first");
  assert.equal(errText("x".repeat(400)).length, 300);
  assert.equal(failedLine("spawn a", new Error("no slot")), "failed spawn a: no slot");
  assert.equal(quoteName("a-b.c_1"), "a-b.c_1");
  assert.equal(quoteName("a b"), "'a b'");
});

test("INV-52 runArgv runs argv without a shell, .cmd through cmd.exe, and kills on timeout", async () => {
  const dir = makeTempDir("paseo kit argv ");
  const echo = await runArgv([process.execPath, "-e", "process.stdout.write(process.argv[1])", "a;b & c"], { cwd: dir });
  assert.deepEqual([echo.code, echo.stdout], [0, "a;b & c"]);
  const input = await runArgv([process.execPath, "-e", "process.stdin.pipe(process.stdout)"], { input: "piped" });
  assert.equal(input.stdout, "piped");
  const slow = await runArgv([process.execPath, "-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  const missing = await runArgv([path.join(dir, "no-such-binary")]);
  assert.ok(missing.error && missing.code === null);
  if (win) {
    const cmd = path.join(dir, "say hi.cmd");
    fs.writeFileSync(cmd, "@echo hi %1\r\n");
    const res = await runArgv([cmd, "there"]);
    assert.equal(res.stdout.trim(), "hi there");
  }
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
});

test("FCLOCK auto and manual modes", async () => {
  const auto = createFakeClock();
  const t0 = auto.now();
  await auto.sleep(30000);
  assert.equal(auto.now() - t0, 30000);
  assert.deepEqual(auto.sleeps, [30000]);
  const manual = createFakeClock({ auto: false });
  let woke = false;
  manual.sleep(1000).then(() => (woke = true));
  await manual.advance(999);
  assert.equal(woke, false);
  await manual.advance(1);
  assert.equal(woke, true);
});

test("INST-01 kit.mjs dispatches verbs and prints usage for unknown ones", () => {
  const kit = path.join(KIT_DIR, "kit.mjs");
  const none = runNode(kit, [], { env: testEnv() });
  assertExit(none, 1);
  assert.match(none.stderr, /^usage: node kit\.mjs install\|update\|status/);
  const adopt = runNode(kit, ["adopt", "x"], { env: testEnv() });
  assertExit(adopt, 1);
  assert.match(adopt.stderr, /^usage: /);
});
