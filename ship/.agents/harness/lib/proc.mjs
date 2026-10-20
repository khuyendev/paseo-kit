// Processes and time: pid liveness, the real clock, and argv commands run without a shell (INV-52).
import { spawn, spawnSync } from "node:child_process";

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

// cmd.exe word: quoted unless it holds only plain path characters.
export const cmdWord = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

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

// CreateProcess cannot start a .cmd/.bat shim directly; it goes through cmd.exe as one quoted command line.
function spawnArgv(argv, options) {
  const [cmd, ...args] = argv;
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd)) {
    return spawn(argv.map(cmdWord).join(" "), [], { ...options, shell: true });
  }
  return spawn(cmd, args, options);
}

export function runArgv(argv, { cwd, env, input, timeoutMs } = {}) {
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
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
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
