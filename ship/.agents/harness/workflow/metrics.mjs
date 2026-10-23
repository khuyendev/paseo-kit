// Harness metrics ledger (evolve data): one line per ended workflow run in _workspace/harness-metrics.jsonl. It
// outlives `ph runs --prune`, which removes run directories; `ph evolve-stats` aggregates it per agent version.
import fs from "node:fs";
import path from "node:path";
import { readText } from "../lib/io.mjs";

export const METRICS_REL = "_workspace/harness-metrics.jsonl";
// Written by the skill usage hook (.claude/hooks/skill_usage.mjs): one line per skill the model invoked.
export const SKILL_USAGE_REL = "_workspace/skill-usage.jsonl";
export const RECORD_VERSION = 1;

// A null reason's cause. Agent causes are the agent's own doing; infra causes are the daemon, the provider, caps
// and permissions, which say nothing about the role text; anything else (config, scripts) is "other".
const CAUSES = [
  ["schema", /did not match the schema/],
  ["timeout", /^no reply within/],
  ["empty", /^finished without a reply/],
  ["infra", /daemon|^runner error|live agent cap|usage tracking|model readback|worktree .* is gone|^agent error:|^agent stopped: permission|^agent status|quota|rate limit|\b429\b|too many requests|RESOURCE_EXHAUSTED/i],
];
export const AGENT_CAUSES = Object.freeze(["schema", "timeout", "empty"]);

// outputTokens: the call's output. An empty reply that produced no output at all is the provider's doing (2026-10-21:
// four executors ended that way in 37 s, minutes before the account hit its 429 quota), so it counts as infra.
export function nullCause(reason, outputTokens = null) {
  const text = String(reason ?? "");
  if (/quota|rate limit|\b429\b|too many requests|RESOURCE_EXHAUSTED/i.test(text)) return "infra";
  const cause = CAUSES.find(([, re]) => re.test(text))?.[0] ?? "other";
  return cause === "empty" && outputTokens === 0 ? "infra" : cause;
}

// The agent of a journal entry: its definition, else `label:` and the label's role part without numbered suffixes
// (`plan-07-02` -> `label:plan`), for calls without agentType and journals written before it was journaled.
export function agentOf(e) {
  if (e.agentType) return e.agentType;
  const words = String(e.label ?? "").split(":")[0].split("-");
  while (words.length > 1 && /\d/.test(words.at(-1))) words.pop();
  return `label:${words.join("-") || "agent"}`;
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
// A failed run's error text, capped as a stop reason is (cmd-agents.mjs).
const ERROR_MAX_CHARS = 300;

// One ledger record from a run's run.json, journal and result. Only calls that ran count (ok and null); cached calls
// of a resumed run were counted in the run that made them.
export function runRecord(runId, info, journal, result) {
  const groups = new Map();
  for (const e of journal) {
    if (e.status !== "ok" && e.status !== "null") continue;
    const g = { agent: agentOf(e), roleHash: e.roleHash ? String(e.roleHash).slice(0, 12) : null, model: e.model ?? null, effort: e.effort ?? null };
    const key = JSON.stringify(g);
    if (!groups.has(key)) groups.set(key, { ...g, calls: 0, ok: 0, nulls: 0, causes: {}, secs: [], input: 0, cachedInput: 0, output: 0, costUsd: 0, costKnown: true });
    const s = groups.get(key);
    s.calls++;
    if (e.status === "ok") s.ok++;
    else {
      s.nulls++;
      const c = nullCause(e.reason, typeof e.usage?.output === "number" ? e.usage.output : typeof e.tokens === "number" ? e.tokens : null);
      s.causes[c] = (s.causes[c] ?? 0) + 1;
    }
    if (typeof e.duration_s === "number") s.secs.push(e.duration_s);
    s.input += num(e.usage?.input);
    s.cachedInput += num(e.usage?.cachedInput);
    s.output += num(e.usage?.output ?? e.tokens);
    if (typeof e.usage?.costUsd === "number") s.costUsd += e.usage.costUsd;
    else if (e.agentId) s.costKnown = false;
  }
  const start = Date.parse(info?.startedAt);
  const stop = Date.parse(info?.endedAt);
  const outcome = result && typeof result === "object" && typeof result.status === "string" ? { status: result.status, ...(Array.isArray(result.gaps) ? { gaps: result.gaps.length } : {}) } : null;
  return {
    v: RECORD_VERSION, runId, workflow: info?.name ?? null, status: info?.status ?? null, startedAt: info?.startedAt ?? null, endedAt: info?.endedAt ?? null,
    ...(info?.status === "stopped" ? { stopReason: typeof info.stopReason === "string" ? info.stopReason : null } : {}),
    ...(info?.status === "failed" && typeof info.error === "string" ? { error: info.error.slice(0, ERROR_MAX_CHARS) } : {}),
    wallS: Number.isFinite(start) && Number.isFinite(stop) ? Math.round((stop - start) / 1000) : null, outcome,
    groups: [...groups.values()].map(({ costKnown, costUsd, ...g }) => ({ ...g, costUsd: costKnown ? Math.round(costUsd * 10000) / 10000 : null })),
  };
}

// Appends records in one write, so concurrent runs never interleave inside a line. A run is recorded once: a record
// whose runId the ledger already holds is skipped. The ledger is read here, at append time, so a completion that
// landed after an import read the ledger is not recorded twice. Returns the records written.
export function appendRecords(root, records) {
  if (!records.length) return [];
  const seen = new Set(readLedger(root).records.map((r) => r.runId));
  const fresh = [];
  for (const r of records) {
    if (seen.has(r.runId)) continue;
    seen.add(r.runId);
    fresh.push(r);
  }
  if (!fresh.length) return fresh;
  const file = path.join(root, METRICS_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, fresh.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
  return fresh;
}

// Skill calls per skill name since an ISO date, and every project skill folder, so a never-called skill shows as 0.
export function skillUsage(root, since) {
  const calls = new Map();
  const file = path.join(root, SKILL_USAGE_REL);
  if (fs.existsSync(file)) {
    for (const line of readText(file).split("\n")) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof e?.skill !== "string" || (since !== undefined && String(e.at ?? "") < since)) continue;
      const c = calls.get(e.skill) ?? { calls: 0, last: null };
      c.calls++;
      if (!c.last || String(e.at) > c.last) c.last = String(e.at);
      calls.set(e.skill, c);
    }
  }
  const dir = path.join(root, ".claude", "skills");
  if (fs.existsSync(dir)) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory() && fs.existsSync(path.join(dir, ent.name, "SKILL.md")) && !calls.has(ent.name)) calls.set(ent.name, { calls: 0, last: null });
    }
  }
  return calls;
}

// A record the stats can read: its version and run id, and groups that are objects (a null group aborts the stats).
const isRecord = (r) => r?.v === RECORD_VERSION && typeof r.runId === "string" && Array.isArray(r.groups) && r.groups.every((g) => g !== null && typeof g === "object");

// {records, bad}: unparsable or foreign lines are counted, not fatal.
export function readLedger(root) {
  const file = path.join(root, METRICS_REL);
  const records = [];
  let bad = 0;
  if (!fs.existsSync(file)) return { records, bad, file };
  for (const line of readText(file).split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (isRecord(r)) records.push(r);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { records, bad, file };
}
