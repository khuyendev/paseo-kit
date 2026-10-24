// Free memory for a gate step and for ph doctor (kit feedback 112 F2, F3).
// Physical memory is os.freemem. Free commit is not in os: on Windows it is Win32_OperatingSystem.FreeVirtualMemory
// (free virtual memory, KB), the commit headroom WMI exposes. One cscript query, not PowerShell (slow to start, and a
// host a tail watcher leaves running) and not wmic (deprecated; typeperf took over a second and then lingered). The
// value is cached briefly so a gate of short steps does not spawn once per step. Off Windows, or when the query fails,
// commit is null and the caller omits it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COMMIT_TTL_MS = 2000;
const SAMPLE_MS = 1000;
const SCRIPT = [
  "try {",
  "  var wmi = GetObject('winmgmts:\\\\\\\\.\\\\root\\\\cimv2');",
  "  var items = new Enumerator(wmi.ExecQuery('SELECT FreeVirtualMemory FROM Win32_OperatingSystem'));",
  "  if (items.atEnd()) WScript.Quit(1);",
  "  WScript.Echo(items.item().FreeVirtualMemory);",
  "} catch (e) { WScript.Quit(1); }",
  "",
].join("\r\n");

let commitCache = { at: 0, mb: null };
let scriptFile = null;

function commitScript() {
  if (!scriptFile) scriptFile = path.join(os.tmpdir(), "paseo-kit-commit-free.js");
  try {
    if (fs.readFileSync(scriptFile, "utf8") !== SCRIPT) fs.writeFileSync(scriptFile, SCRIPT);
  } catch {
    fs.writeFileSync(scriptFile, SCRIPT);
  }
  return scriptFile;
}

// MB, or null when commit cannot be read. `run` is spawnSync-shaped, for a test that must not spawn.
export function readCommitFreeMb({ now = Date.now, run = spawnSync, platform = process.platform } = {}) {
  if (platform !== "win32") return null;
  const t = now();
  if (t - commitCache.at < COMMIT_TTL_MS) return commitCache.mb;
  let mb = null;
  try {
    const r = run("cscript", ["//nologo", "//E:jscript", commitScript()], { encoding: "utf8", timeout: 4000, windowsHide: true });
    const n = Number(String(r.stdout ?? "").trim().split(/\s+/)[0]);
    if (r.status === 0 && Number.isFinite(n) && n >= 0) mb = Math.round(n / 1024);
  } catch {
    mb = null;
  }
  commitCache = { at: t, mb };
  return mb;
}

export function readMemorySample({ freemem = os.freemem, commitFreeMb = readCommitFreeMb } = {}) {
  const physicalMb = Math.max(0, Math.round(Number(freemem()) / 1048576));
  let commitMb = null;
  try {
    const n = commitFreeMb();
    if (Number.isFinite(n) && n >= 0) commitMb = Math.round(n);
  } catch {
    commitMb = null;
  }
  return { physicalMb, commitMb };
}

// One sample, used as both the start and the low (a step that does not run).
export function sampleMemory(read = readMemorySample) {
  const s = read();
  const memory = { physical: { startMb: s.physicalMb, lowMb: s.physicalMb } };
  if (s.commitMb != null) memory.commit = { startMb: s.commitMb, lowMb: s.commitMb };
  return memory;
}

// Samples across a running step: at the start, every second, and once more when the step ends. `lowMb` is the lowest.
export function watchMemory(read = readMemorySample) {
  const first = read();
  let lowP = first.physicalMb;
  let lowC = first.commitMb;
  let sawCommit = first.commitMb != null;
  const take = () => {
    const s = read();
    if (s.physicalMb < lowP) lowP = s.physicalMb;
    if (s.commitMb != null) {
      lowC = lowC == null ? s.commitMb : Math.min(lowC, s.commitMb);
      sawCommit = true;
    }
  };
  const timer = setInterval(take, SAMPLE_MS);
  if (typeof timer.unref === "function") timer.unref();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  return {
    stop,
    finish() {
      if (!stopped) take();
      stop();
      const memory = { physical: { startMb: first.physicalMb, lowMb: lowP } };
      if (sawCommit) memory.commit = { startMb: first.commitMb ?? lowC, lowMb: lowC };
      return memory;
    },
  };
}
