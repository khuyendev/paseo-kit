// G164: on Windows a bare argv name that PATHEXT resolves to a .cmd shim (npm -> npm.cmd) and a .ps1 adapter hook must launch.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { paseoReload } from "../../kit/machine/external.mjs";
import { hookArgv, invokeHook } from "../../ship/.agents/harness/adapter/hooks.mjs";
import { runArgv } from "../../ship/.agents/harness/lib/proc.mjs";
import { testEnv } from "../helpers/env.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

const win = process.platform === "win32";

// The test env with one more PATH directory in front; the PATH key keeps the case the host uses (Path on Windows).
function envWithPathDir(dir) {
  const env = testEnv();
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  env[key] = [dir, env[key]].join(path.delimiter);
  return env;
}

test("G164 win32: a bare name runs the .cmd shim that PATHEXT finds on PATH", { skip: !win }, async () => {
  const dir = path.join(makeTempDir("paseo kit g164 "), "shim dir");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "g164probe.cmd"), "@echo PATHEXT-RESOLVED %1\r\n");
  const res = await runArgv(["g164probe", "a"], { env: envWithPathDir(dir) });
  assert.equal(res.code, 0, res.stderr || String(res.error));
  assert.equal(res.stdout.trim(), "PATHEXT-RESOLVED a");
});

test("G164 win32: machine's paseo reload finds paseo.cmd on PATH by its bare name", { skip: !win }, async () => {
  const dir = makeTempDir("paseo kit g164 ");
  fs.writeFileSync(path.join(dir, "paseo.cmd"), "@echo off\r\nif \"%1\"==\"reload\" exit /b 0\r\nexit /b 3\r\n");
  assert.deepEqual(await paseoReload(envWithPathDir(dir)), { ok: true });
});

test("G164: a bare name that resolves to nothing still fails to start, as before", async () => {
  const res = await runArgv(["g164-no-such-command-anywhere"], { env: testEnv() });
  assert.equal(res.code, null);
  assert.ok(res.error);
});

test("G164 hookArgv: a .ps1 hook runs through powershell.exe with -File on win32, and directly elsewhere", async () => {
  const root = makeTempDir("adapter code root ");
  const script = path.join(root, "tools", "hook.ps1");
  fs.mkdirSync(path.dirname(script));
  assert.deepEqual(hookArgv(root, "tools/hook.ps1"), win ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] : [script]);
});

test("G164 win32: a .ps1 adapter hook answers one JSON line through powershell.exe", { skip: !win }, async () => {
  const root = makeTempDir("adapter code root ");
  fs.mkdirSync(path.join(root, "tools"));
  fs.writeFileSync(path.join(root, "tools", "hook.ps1"), "$null = [Console]::In.ReadToEnd()\r\nWrite-Output '{\"v\":1,\"targets\":[\"from ps1\"]}'\r\n");
  const r = await invokeHook({ adapter: { hook_timeout_s: 30 } }, { codeRoot: root, script: "tools/hook.ps1", op: "parse", kind: "test", argument: "a" });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.response.targets, ["from ps1"]);
});
