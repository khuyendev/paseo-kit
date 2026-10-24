// Processes and time: pid liveness and trees, the real clock, and argv commands run without a shell (INV-52).
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

// A runner's process starts with the run, or seconds after run.json's startedAt (the parent writes the record, then the
// child starts). A pid reused by an unrelated process started later than this is not that runner (kit feedback 118).
export const RUNNER_START_SLACK_MS = 2 * 60 * 1000;

// pid -> epoch ms, one process-list call. A pid the list does not name is absent (the caller treats that as unknown,
// not as dead). Windows StartTime is UTC; POSIX etimes is seconds ago, so the stamp is approximate.
export function processStartTimes(pids) {
  const want = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  const out = new Map();
  if (!want.length) return out;
  if (process.platform === "win32") {
    const ids = want.join(",");
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$want=@(${ids}); Get-Process -ErrorAction SilentlyContinue | Where-Object { $want -contains $_.Id } | ForEach-Object { '{0} {1}' -f $_.Id, $_.StartTime.ToUniversalTime().ToString('o') }`],
    { encoding: "utf8", windowsHide: true, timeout: 20000 });
    for (const line of String(r.stdout ?? "").split(/\r?\n/)) {
      const m = /^(\d+)\s+(\S+)/.exec(line.trim());
      if (!m) continue;
      const t = Date.parse(m[2]);
      if (Number.isFinite(t)) out.set(Number(m[1]), t);
    }
    return out;
  }
  const r = spawnSync("ps", ["-o", "pid=,etimes=", "-p", want.join(",")], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0) return out;
  const now = Date.now();
  for (const line of String(r.stdout ?? "").split("\n")) {
    const [pid, sec] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isFinite(sec) && sec >= 0) out.set(pid, now - sec * 1000);
  }
  return out;
}

/**
 * A run.json record whose runner is still the process that started it (kit feedback 118). `starts` is processStartTimes;
 * omit it to judge by pid liveness only. An alive pid whose process started after startedAt plus the slack is a reused
 * pid. An alive pid with no start time (the list failed, or startedAt is missing) stays live: a live run is not called dead.
 */
export function runnerLive(info, { alive = pidAlive, starts } = {}) {
  if (info?.status !== "running") return false;
  if (!alive(info.pid)) return false;
  if (!starts) return true;
  const proc = starts.get(info.pid);
  if (proc == null) return true;
  const runAt = Date.parse(info.startedAt ?? "");
  if (!Number.isFinite(runAt)) return true;
  return proc <= runAt + RUNNER_START_SLACK_MS;
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

// G166: pid and every process under it. Windows: taskkill /T walks the tree. POSIX: the descendants are listed before
// pid dies, since they are reparented once it is gone; each shell has its own process group (shell.mjs), so each is
// killed by pid.
export function killPidTree(pid) {
  if (process.platform === "win32") {
    // When taskkill fails (pid gone, or taskkill missing) the pid alone is killed; that throws when the pid is gone too.
    if (spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).status !== 0) process.kill(pid);
    return;
  }
  const descendants = descendantPids(pid);
  process.kill(pid);
  for (const d of descendants) {
    try {
      process.kill(d, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

// Pids under pid from one ps snapshot; none when ps is not installed.
function descendantPids(pid) {
  const r = spawnSync("ps", ["-A", "-o", "pid=", "-o", "ppid="], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return [];
  const children = new Map();
  for (const line of r.stdout.split("\n")) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(parent)) children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const found = [];
  const todo = [pid];
  while (todo.length) {
    for (const c of children.get(todo.pop()) ?? []) {
      found.push(c);
      todo.push(c);
    }
  }
  return found;
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

export function runArgv(argv, { cwd, env, input, timeoutMs, tailChars, onData } = {}) {
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
    // An extra bound beside timeoutMs (kit feedback 109 F4): the original timer stays. Whichever fires first kills the tree.
    let extra = null;
    const api = {
      alsoAfter(ms, onFire) {
        if (extra) clearTimeout(extra);
        if (!ms) { extra = null; return; }
        const handle = setTimeout(() => {
          if (extra !== handle) return;
          extra = null;
          onFire?.();
          timedOut = true;
          killTree(child);
        }, ms);
        extra = handle;
      },
    };
    const take = (stream, d) => {
      if (stream === "stdout") stdout = appendTail(stdout, d, tailChars);
      else stderr = appendTail(stderr, d, tailChars);
      if (onData) try { onData(stream, d, api); } catch { /* a watcher fault never hides the run */ }
    };
    child.stdout.setEncoding("utf8").on("data", (d) => take("stdout", d));
    child.stderr.setEncoding("utf8").on("data", (d) => take("stderr", d));
    const timer = timeoutMs ? setTimeout(() => ((timedOut = true), killTree(child)), timeoutMs) : null;
    child.on("error", (e) => (spawnError = e));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (extra) { clearTimeout(extra); extra = null; }
      resolve({ code: spawnError ? null : code, stdout, stderr, timedOut, error: spawnError });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
