// Processes and time: pid liveness, the real clock, and argv commands run without a shell (INV-52).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

export const realClock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
});

// cmd.exe word: bare when it holds only plain path characters, else quoted for both cmd.exe and the C runtime's argv
// parser (backslashes before a quote doubled, an inner quote as ""), so no cmd.exe operator is outside quotes.
export function cmdWord(arg) {
  const a = String(arg);
  if (/^[\w@+:./\\-]+$/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1""').replace(/(\\+)$/, "$1$1")}"`;
}

// CR-FND-01 (INV-52): cmd.exe expands %NAME% even inside quotes and cannot escape it there, and a line break ends the
// command; such arguments cannot reach a .cmd/.bat file literally, so they are refused instead of being run.
export function cmdShim(argv) {
  const bad = argv.find((a) => /[%\r\n\0]/.test(String(a)));
  if (bad !== undefined) throw new Error(`argument cannot be passed literally to ${argv[0]} through cmd.exe (%, line break or NUL): ${String(bad).slice(0, 80)}`);
  // /v:off keeps !NAME! literal even when delayed expansion is on in the registry; /s /c runs the quoted line as is.
  const line = argv.map(cmdWord).join(" ");
  return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/v:off", "/s", "/c", `"${line}"`], options: { windowsVerbatimArguments: true } };
}

function killTree(child) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

const envValue = (env, key) => env[Object.keys(env).find((k) => k.toUpperCase() === key)] ?? "";

// G164: a bare name is looked up on PATH with each PATHEXT extension, as cmd.exe does (npm -> npm.cmd); the current
// directory is not searched. A name with a directory part is tried as given. Null when nothing matches.
export function winPathFile(name, env = process.env) {
  const exts = (envValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const dirs = /[\\/]/.test(name) ? [""] : envValue(env, "PATH").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

// CreateProcess cannot start a .cmd/.bat shim directly; it goes through cmd.exe as one quoted command line. An
// extensionless name on Windows is first resolved to its PATHEXT file; a name that matches nothing spawns as given.
function spawnArgv(argv, options) {
  const [name, ...args] = argv;
  const cmd = process.platform === "win32" && !path.extname(name) ? (winPathFile(name, options.env ?? process.env) ?? name) : name;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd)) {
    const shim = cmdShim([cmd, ...args]);
    return spawn(shim.file, shim.args, { ...options, ...shim.options });
  }
  return spawn(cmd, args, options);
}

// Keeps the last `tailChars` characters of a stream while it grows (no limit when absent or 0). The text may hold up to
// twice that before it is cut back, so a command that prints without bound cannot grow the buffer past 2 x tailChars.
export function appendTail(text, chunk, tailChars) {
  const joined = text + chunk;
  return tailChars && joined.length > 2 * tailChars ? joined.slice(-tailChars) : joined;
}

export function runArgv(argv, { cwd, env, input, timeoutMs, tailChars } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnArgv(argv, { cwd, env, windowsHide: true, detached: process.platform !== "win32" });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError = null;
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout = appendTail(stdout, d, tailChars)));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr = appendTail(stderr, d, tailChars)));
    const timer = timeoutMs ? setTimeout(() => ((timedOut = true), killTree(child)), timeoutMs) : null;
    child.on("error", (e) => (spawnError = e));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: spawnError ? null : code, stdout, stderr, timedOut, error: spawnError });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
