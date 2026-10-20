// Run journal and resume cache (FLOW-15, FLOW-17), run ids (FLOW-19) and budget parsing (FLOW-09).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readText } from "../lib/io.mjs";
import { sha256 } from "../lib/hash.mjs";
import { UsageError } from "../lib/cli.mjs";

export const DEFAULT_RUNS_DIR = path.join("_workspace", "_runs");
export const RUN_FILES = Object.freeze({ script: "script.js", args: "args.json", run: "run.json", journal: "journal.jsonl", log: "log.txt", result: "result.json" });

// Options that change what the agent does; label, phase, keep, role and session are not part of the key (FLOW-15).
const CACHE_KEY_OPTIONS = ["schema", "agentType", "model", "effort", "isolation", "readOnly", "cwd"];

// `identity` is the host's resolution of the call: role-text hash and the resolved provider/model and effort, so an
// edited definition or role table invalidates the cached calls it affects.
export function cacheKey(prompt, opts, identity) {
  const call = { prompt };
  for (const k of CACHE_KEY_OPTIONS) if (opts[k] !== undefined) call[k] = opts[k];
  return sha256(JSON.stringify({ call: sha256(JSON.stringify(call)), role: identity.roleHash ?? "", model: identity.model ?? "", effort: identity.effort ?? "" })).slice(0, 32);
}

// `<key>#<occ>` -> finish entry of an earlier run, only for calls that produced a result; bad lines are skipped.
export function loadJournalCache(journalPath) {
  const cache = new Map();
  if (!journalPath || !fs.existsSync(journalPath)) return cache;
  for (const line of readText(journalPath).split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if ((e?.status === "ok" || e?.status === "cached") && typeof e.key === "string") cache.set(`${e.key}#${e.occ}`, e);
  }
  return cache;
}

export function createJournal(journalPath) {
  if (journalPath) {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.appendFileSync(journalPath, "", "utf8");
  }
  return (entry) => {
    if (journalPath) fs.appendFileSync(journalPath, `${JSON.stringify(entry)}\n`, "utf8");
  };
}

// Journal records of a run directory, unparsable lines skipped (run-stats, watch tools).
export function readJournal(journalPath) {
  const out = [];
  for (const line of readText(journalPath).split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn last line of a killed runner.
    }
  }
  return out;
}

export function parseBudget(text) {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(String(text).trim());
  if (!m) throw new UsageError(`invalid --budget '${text}' (examples: 500000, 500k, 1.5m)`);
  return Math.round(Number(m[1]) * { "": 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()]);
}

// wf_<yyyymmdd>-<hhmmss>_<4 hex>: local time of the host plus two random bytes.
export function newRunId(date) {
  const p = (x) => String(x).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `wf_${stamp}_${crypto.randomBytes(2).toString("hex")}`;
}

export const runsDirOf = (root, opt) => path.resolve(root, opt ?? DEFAULT_RUNS_DIR);

// The ` --runs-dir <D>` suffix for hints, present whenever the run is not under the default directory.
export function runsDirSuffix(root, runsDir) {
  const def = path.resolve(root, DEFAULT_RUNS_DIR);
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  return fold(path.resolve(runsDir)) === fold(def) ? "" : ` --runs-dir ${JSON.stringify(runsDir.split(path.sep).join("/"))}`;
}
