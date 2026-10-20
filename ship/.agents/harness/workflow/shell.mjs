// shell() of workflow scripts (FLOW-11): host commands run on purpose, as a string through the platform shell or as
// an argv without any shell. Never rejects.
import { spawn, spawnSync } from "node:child_process";
import { runArgv } from "../lib/proc.mjs";
import { errText } from "../lib/cli.mjs";

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

// Node's own shell option: `/bin/sh -c` on POSIX, `cmd.exe /d /s /c` on win32.
function runShellString(command, { cwd, env, input, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [], { cwd, env, shell: true, windowsHide: true, detached: process.platform !== "win32" });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let launchError = null;
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const timer = setTimeout(() => ((timedOut = true), killTree(child)), timeoutMs);
    child.on("error", (e) => (launchError = e));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: launchError ? null : code, stdout, stderr, timedOut, error: launchError });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

const tail = (text, n) => (text.length > n ? text.slice(-n) : text);

// `cmd` is a string or `[file, ...args]`; resolves {code, stdout, stderr, durationS}. Code -1: not launched or timed out.
export async function runShell(cmd, { cwd, env, input, timeoutS, tailChars = 20000, now = Date.now } = {}) {
  const t0 = now();
  const timeoutMs = timeoutS * 1000;
  const r = Array.isArray(cmd)
    ? await runArgv(cmd.map(String), { cwd, env, input, timeoutMs })
    : await runShellString(String(cmd), { cwd, env, input, timeoutMs });
  let { stdout, stderr } = r;
  let code = r.code;
  if (r.timedOut) {
    code = -1;
    stderr = `${stderr}${stderr && !stderr.endsWith("\n") ? "\n" : ""}[timed out after ${timeoutS} s]`;
  } else if (r.error || code === null) {
    code = -1;
    stderr = `${stderr}${stderr ? "\n" : ""}${errText(r.error ?? "process ended without an exit code")}`;
  }
  return { code, stdout: tail(stdout, tailChars), stderr: tail(stderr, tailChars), durationS: Math.round((now() - t0) / 100) / 10 };
}
