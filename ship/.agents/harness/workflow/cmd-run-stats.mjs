// ph run-stats (FLOW-41): per-run numbers from run.json and journal.jsonl, optional tool-call counts from Claude Code
// transcripts attributed by the exact `Run <runId> #<n>` tag.
import fs from "node:fs";
import path from "node:path";
import { UsageError, failedLine } from "../lib/cli.mjs";
import { readJson, readText } from "../lib/io.mjs";
import { homeDir } from "../platform.mjs";
import { RUN_FILES, readJournal, runsDirOf } from "./journal.mjs";
import { KINDS, toolKind } from "./tools.mjs";

export const RUN_STATS_OPTIONS = Object.freeze({ transcripts: "bool", "runs-dir": "string" });
const TAG = /Run ([A-Za-z0-9._-]+) #\d+ \(bookkeeping only; ignore\)\./g;

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (x) => Math.round(x * 10) / 10;

// The role and model a journal row ran with: its role, else its agent type, else the role part of its label (rows
// journaled before roles were). The model is "-" when none was recorded (identity-error calls).
const roleModel = (e) => {
  const role = e.role || e.agentType || String(e.label ?? "").split(":")[0];
  return role ? `${role} ${e.model ?? "-"}` : null;
};

export function runSummary(id, info, journal, nowMs) {
  const live = journal.filter((e) => e.status === "ok" || e.status === "null");
  const roles = [...new Set(live.concat(journal.filter((e) => e.status === "cached")).map(roleModel).filter(Boolean))];
  const agents = new Set([...live.map((e) => e.agentId).filter(Boolean), ...(info.adopted ?? []).map((a) => a.agentId)]);
  const secs = live.map((e) => e.duration_s).filter((s) => typeof s === "number");
  const sum = (field) => live.reduce((t, e) => t + (e.usage?.[field] ?? (field === "output" ? e.tokens ?? 0 : 0)), 0);
  const costs = live.map((e) => e.usage?.costUsd);
  const cost = live.length && costs.every((c) => typeof c === "number") ? `$${Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000}` : live.length ? "$?" : "$0";
  const start = Date.parse(info.startedAt);
  const stop = info.endedAt ? Date.parse(info.endedAt) : nowMs;
  const wall = Number.isFinite(start) ? Math.round((stop - start) / 1000) : "?";
  return [
    `${id} [${roles.join(", ")}] status ${info.status}`,
    `wall ${wall} s; agents ${agents.size}: median ${round1(median(secs))} s, slowest ${secs.length ? Math.max(...secs) : 0} s; tokens in ${sum("input")} cached ${sum("cachedInput")} out ${sum("output")}; cost ${cost}`,
  ];
}

// Claude Code keeps a project's transcripts under projects/<cwd with every non-alphanumeric character as '-'>.
export const transcriptDir = (env, root) => path.join(env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), ".claude"), "projects", path.resolve(root).replace(/[^A-Za-z0-9]/g, "-"));

const userText = (msg) => {
  const c = msg?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
};

// Tool calls per run id: each turn belongs to the run named by the last tag seen in a user message before it.
export function countTranscript(text, counts, name) {
  const entry = (id) => {
    if (!counts.has(id)) counts.set(id, { transcripts: new Set(), kinds: Object.fromEntries(KINDS.map((k) => [k, 0])) });
    return counts.get(id);
  };
  let current = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = rec?.message;
    if (rec?.type === "user" || msg?.role === "user") {
      const tags = [...userText(msg).matchAll(TAG)];
      if (tags.length) {
        current = tags[tags.length - 1][1];
        entry(current).transcripts.add(name);
      }
      continue;
    }
    if (!current || !Array.isArray(msg?.content)) continue;
    for (const block of msg.content) if (block?.type === "tool_use") entry(current).kinds[toolKind(block.name, block.input)]++;
  }
}

function transcriptCounts(dir) {
  const counts = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    countTranscript(readText(path.join(dir, name)), counts, name);
  }
  return counts;
}

export async function runStatsCommand(ctx) {
  if (!ctx.args.length) throw new UsageError("name at least one run id: ph run-stats RUNID... [--transcripts] [--runs-dir D]");
  const runsDir = runsDirOf(ctx.root, ctx.opts["runs-dir"]);
  let counts = null;
  let noTranscripts = null;
  if (ctx.opts.transcripts) {
    const dir = transcriptDir(ctx.env, ctx.root);
    if (fs.existsSync(dir)) counts = transcriptCounts(dir);
    else noTranscripts = dir;
  }
  let code = 0;
  for (const id of ctx.args) {
    const dir = path.join(runsDir, id);
    let info;
    let journal;
    try {
      info = readJson(path.join(dir, RUN_FILES.run));
      journal = readJournal(path.join(dir, RUN_FILES.journal));
    } catch (e) {
      ctx.out(failedLine(id, e.code === "ENOENT" ? `no ${e.path ?? "file"}` : e));
      code = 2;
      continue;
    }
    for (const line of runSummary(id, info, journal, ctx.clock.now())) ctx.out(line);
    if (!ctx.opts.transcripts) continue;
    if (noTranscripts) {
      ctx.out(`transcripts 0 (no ${noTranscripts})`);
      continue;
    }
    const c = counts.get(id);
    ctx.out(`transcripts ${c?.transcripts.size ?? 0}; tool calls: ${KINDS.map((k) => `${k} ${c?.kinds[k] ?? 0}`).join(", ")}`);
  }
  return code;
}
