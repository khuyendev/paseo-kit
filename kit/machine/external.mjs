// External commands machine runs: `paseo reload` and `npm ci`; never a daemon start, stop or restart (MACH-12, MACH-15).
import fs from "node:fs";
import path from "node:path";
import { errText } from "../../ship/.agents/harness/lib/cli.mjs";
import { runArgv } from "../../ship/.agents/harness/lib/proc.mjs";

const RELOAD_TIMEOUT_MS = 60000;
const NPM_CI_TIMEOUT_MS = 600000;

const pathValue = (env) => env[Object.keys(env).find((k) => k.toUpperCase() === "PATH")] ?? "";

// A bare name on Windows must be found as its .cmd/.exe file: CreateProcess cannot start an npm .cmd shim by name.
function onPath(name, env) {
  if (process.platform !== "win32") return name;
  for (const dir of pathValue(env).split(path.delimiter).filter(Boolean)) {
    for (const ext of [".cmd", ".exe"]) {
      const file = path.join(dir, name + ext);
      if (fs.existsSync(file)) return file;
    }
  }
  return name;
}

// A .js/.mjs CLI runs through this node.
const argvOf = (cli, args) => (/\.[cm]?js$/i.test(cli) ? [process.execPath, cli, ...args] : [cli, ...args]);

function reason(r) {
  if (r.error) return errText(r.error);
  if (r.timedOut) return "timed out";
  const detail = String(r.stderr || r.stdout).trim().split(/\r?\n/)[0];
  return `exit ${r.code}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
}

export async function paseoReload(env) {
  const cli = env.PASEO_CLI || onPath("paseo", env);
  const r = await runArgv(argvOf(cli, ["reload"]), { env, timeoutMs: RELOAD_TIMEOUT_MS });
  return r.code === 0 ? { ok: true } : { ok: false, reason: reason(r) };
}

// npm sets npm_execpath to its own CLI script; outside npm the npm on PATH is used.
export async function npmCi(dir, env) {
  const npm = /npm.*\.[cm]?js$/i.test(path.basename(env.npm_execpath ?? "")) ? env.npm_execpath : onPath("npm", env);
  const r = await runArgv(argvOf(npm, ["ci"]), { cwd: dir, env, timeoutMs: NPM_CI_TIMEOUT_MS });
  return r.code === 0 ? { ok: true } : { ok: false, reason: reason(r) };
}
