// Runtime capability checks and the one Claude CLI lookup shared by install, machine, ph and the file mod (PHCL-34).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cmdShim } from "./lib/proc.mjs";

// INST-23: the one Node gate. minVersion is the oldest Node the shipped runtime runs on; capabilities are the Node APIs
// it uses beyond that version's baseline, each with a presence probe. The test-runner floor (tests/) is not a gate.
export const NODE_RUNTIME = Object.freeze({
  minVersion: "20.17.0",
  capabilities: Object.freeze([{ name: "path.matchesGlob", probe: () => typeof path.matchesGlob === "function" }]),
});
export const NODE_REQUIREMENT = `Node ${NODE_RUNTIME.minVersion.replace(/\.0$/, "")}+ with ${NODE_RUNTIME.capabilities.map((c) => c.name).join(", ")}`;
export const MIN_CLAUDE_VERSION = "2.1.296";
export const FILE_PLUGIN_ID = "harness-files@paseo-harness-kit";

// null when this Node passes the gate, else the reason naming the version or the missing capability.
export function nodeRuntimeProblem(version = process.versions.node, runtime = NODE_RUNTIME) {
  if (!versionAtLeast(version, runtime.minVersion)) return `node ${version} is older than ${runtime.minVersion}`;
  const missing = runtime.capabilities.find((c) => !c.probe());
  return missing ? `node ${version} lacks ${missing.name}` : null;
}

export function homeDir(env = process.env) {
  const home = process.platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME;
  return home || os.homedir();
}

export const paseoHome = (env = process.env) => env.PASEO_HOME || path.join(homeDir(env), ".paseo");
export const paseoConfigFile = (env = process.env) => path.join(paseoHome(env), "config.json");

// $CLAUDE_CLI, else the native installer's ~/.local/bin/claude (a shell started by Node may lack it on PATH), else PATH.
export function claudeCli(env = process.env) {
  const native = path.join(homeDir(env), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return env.CLAUDE_CLI || (fs.existsSync(native) ? native : "claude");
}

// A .js CLI runs through this node; on Windows anything but .exe/.com goes through cmd.exe as one quoted command
// line, since CreateProcess cannot start an npm .cmd shim (INV-52).
export function runClaude(args, opts = {}, env = process.env) {
  const cli = claudeCli(env);
  const options = { env, windowsHide: true, ...opts };
  if (/\.[cm]?js$/i.test(cli)) return spawnSync(process.execPath, [cli, ...args], options);
  if (process.platform === "win32" && !/\.(exe|com)$/i.test(cli)) {
    let shim;
    try {
      shim = cmdShim([cli, ...args]);
    } catch (error) {
      return { status: null, stdout: "", stderr: "", error };
    }
    return spawnSync(shim.file, shim.args, { ...options, ...shim.options });
  }
  return spawnSync(cli, args, options);
}

export function claudeVersion(env = process.env) {
  const r = runClaude(["--version"], { encoding: "utf8", timeout: 10000 }, env);
  return !r.error && r.status === 0 ? String(r.stdout).trim() : null;
}

export function versionAtLeast(text, min = MIN_CLAUDE_VERSION) {
  const m = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(String(text ?? ""));
  if (!m) return null;
  const want = min.split(".").map(Number);
  return m.slice(1).map(Number).reduce((cmp, v, i) => cmp || Math.sign(v - want[i]), 0) >= 0;
}
