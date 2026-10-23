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
// model is not one either: identity.model is the resolved model, so `pro` and its provider/model share an entry.
const CACHE_KEY_OPTIONS = ["schema", "agentType", "effort", "isolation", "readOnly", "cwd", "worktreeSeed"];

// `identity` is the host's resolution of the call: role-text hash, the resolved provider/model and effort, the effective
// read-only mode (the definition's tools or the call's readOnly) and the digest of the prompt notes, so an edited
// definition, role table, note or permission invalidates the cached calls it affects.
export function cacheKey(prompt, opts, identity) {
  const call = { prompt };
  for (const k of CACHE_KEY_OPTIONS) if (opts[k] !== undefined) call[k] = opts[k];
  return sha256(JSON.stringify({ call: sha256(JSON.stringify(call)), role: identity.roleHash ?? "", model: identity.model ?? "", effort: identity.effort ?? "", readOnly: Boolean(identity.readOnly), notes: identity.notesHash ?? "" })).slice(0, 32);
}

// `<key>#<occ>` -> finish entry of an earlier run, only for calls that produced a result; bad lines are skipped.
// A missing journal throws: an empty cache would silently rerun every agent of the resumed run.
export function loadJournalCache(journalPath) {
  const cache = new Map();
  if (!journalPath) return cache;
  if (!fs.existsSync(journalPath)) throw new UsageError(`cannot resume: ${journalPath} not found`);
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

// Agent ids of calls that were created and never finished in a killed run (G123): a resume stops them first.
export function loadInFlight(journalPath) {
  const open = new Map();
  for (const e of readJournal(journalPath)) {
    // Finish records have no kind; the n of a call is shared by its start, created and finish records.
    if (e.kind === "agent" && e.status === "created") open.set(e.n, e.agentId);
    else if (e.status === "ok" || e.status === "null") open.delete(e.n);
  }
  return [...open.values()];
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

// Journal records of a run directory, unparsable lines skipped (run-stats, watch tools). A line that parses to a
// non-object (`null`, a number) is no record either: every reader dereferences the entries it gets.
export function readJournal(journalPath) {
  const out = [];
  for (const line of readText(journalPath).split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      // A torn last line of a killed runner.
      continue;
    }
    if (e !== null && typeof e === "object") out.push(e);
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

// A run id names one immediate child of the runs dir: never "." or ".." (CR-WFL-01). Every command that takes an id checks it.
export function checkRunId(id, flag) {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || /^\.+$/.test(id)) throw new UsageError(`invalid ${flag} '${id}' (letters, digits, . _ - only, not only dots)`);
}

export const runsDirOf = (root, opt) => path.resolve(root, opt ?? DEFAULT_RUNS_DIR);

// The ` --runs-dir <D>` suffix for hints, present whenever the run is not under the default directory.
export function runsDirSuffix(root, runsDir) {
  const def = path.resolve(root, DEFAULT_RUNS_DIR);
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  return fold(path.resolve(runsDir)) === fold(def) ? "" : ` --runs-dir ${JSON.stringify(runsDir.split(path.sep).join("/"))}`;
}
