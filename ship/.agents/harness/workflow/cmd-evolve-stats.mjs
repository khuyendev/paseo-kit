// ph evolve-stats: the metrics ledger per agent version (agent, role-text hash, model, effort) and per workflow, the
// numbers harness-evolve compares before and after a change; --import adds ended runs that are not in it yet.
import path from "node:path";
import { UsageError, failedLine } from "../lib/cli.mjs";
import { readJsonIf } from "../lib/io.mjs";
import { listRuns } from "./cmd-runs.mjs";
import { RUN_FILES, readJournal, runsDirOf } from "./journal.mjs";
import { AGENT_CAUSES, METRICS_REL, appendRecords, readLedger, runRecord, skillUsage } from "./metrics.mjs";

export const EVOLVE_STATS_OPTIONS = Object.freeze({ agent: "string", workflow: "string", since: "string", import: "bool", "runs-dir": "string" });
export const EVOLVE_STATS_USAGE = "ph evolve-stats [--agent A] [--workflow N] [--since YYYY-MM-DD] [--import [--runs-dir D]]";
// Fewer runs than this per version are reported, but are no measurement of a change.
export const FEW_RUNS = 5;
// The suggested `ph workflow --budget` of a workflow: this many times its median output tokens per run (owner decision
// 2026-10-22, after "Building effective agent automations": a cap of three to five normal runs, tightened later).
export const BUDGET_FACTOR = 4;
// YYYY-MM-DD of a day that exists: 2026-02-31 is not read as 2026-03-03.
const isIsoDay = (text) => {
  const t = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(t) && new Date(t).toISOString().startsWith(text);
};

// A --budget value rounded up to whole thousands: 118400 -> "119k".
export const budgetText = (tokens) => `${Math.max(1, Math.ceil(tokens / 1000))}k`;

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (x) => Math.round(x * 10) / 10;
const usd = (x) => `$${Math.round(x * 10000) / 10000}`;
const counts = (obj) => Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(", ");
// Runs per stop or failure reason, each reason in full (two reasons that differ later are two reasons); no reason is null.
const tally = (reasons, why) => reasons.set(why, (reasons.get(why) ?? 0) + 1);
const reasonCounts = (reasons) => [...reasons].map(([why, n]) => `${why === null ? "no reason" : JSON.stringify(why)} ${n}`).join(", ");

function importRuns(ctx, ledger) {
  const known = new Set(ledger.records.map((r) => r.runId));
  const added = [];
  let skipped = 0;
  let code = 0;
  for (const run of listRuns(runsDirOf(ctx.root, ctx.opts["runs-dir"])).reverse()) {
    if (known.has(run.id) || !run.info || run.info.status === "running") {
      skipped++;
      continue;
    }
    try {
      const journal = readJournal(path.join(run.dir, RUN_FILES.journal));
      added.push(runRecord(run.id, run.info, journal, readJsonIf(path.join(run.dir, RUN_FILES.result))));
    } catch (e) {
      ctx.out(failedLine(run.id, e.code === "ENOENT" ? `no ${RUN_FILES.journal}` : e));
      code = 2;
    }
  }
  const written = appendRecords(ctx.root, added);
  ctx.out(`imported ${written.length} runs (${skipped} skipped: already recorded, running or without run.json)`);
  return { added: written, code };
}

// Agent versions in order of first use: one line each.
function versionLines(records, agentFilter) {
  const versions = new Map();
  for (const r of records) {
    for (const g of r.groups) {
      if (agentFilter && g.agent !== agentFilter) continue;
      const key = JSON.stringify([g.agent, g.roleHash, g.model, g.effort]);
      if (!versions.has(key)) versions.set(key, { g, runs: new Set(), calls: 0, ok: 0, nulls: 0, causes: {}, secs: [], input: 0, cachedInput: 0, output: 0, cost: 0, costKnown: true, outcomes: {}, first: r.startedAt, last: r.startedAt });
      const v = versions.get(key);
      if (!v.runs.has(r.runId) && r.outcome) v.outcomes[r.outcome.status] = (v.outcomes[r.outcome.status] ?? 0) + 1;
      v.runs.add(r.runId);
      v.calls += g.calls;
      v.ok += g.ok;
      v.nulls += g.nulls;
      for (const [c, n] of Object.entries(g.causes ?? {})) v.causes[c] = (v.causes[c] ?? 0) + n;
      v.secs.push(...(g.secs ?? []));
      for (const k of ["input", "cachedInput", "output"]) v[k] += g[k] ?? 0;
      if (typeof g.costUsd === "number") v.cost += g.costUsd;
      else v.costKnown = false;
      v.last = r.startedAt;
    }
  }
  return [...versions.values()].map((v) => {
    const agentNulls = AGENT_CAUSES.reduce((t, c) => t + (v.causes[c] ?? 0), 0);
    const agentPart = AGENT_CAUSES.filter((c) => v.causes[c]).map((c) => `${c} ${v.causes[c]}`).join(", ");
    const nullPart = v.nulls ? ` (agent ${agentNulls}${agentPart ? `: ${agentPart}` : ""}; infra ${v.causes.infra ?? 0}; other ${v.causes.other ?? 0})` : "";
    // Tokens per call compare cost without a price table (.agents/model-prices.json); cost needs one.
    const perCall = (x) => Math.round(x / Math.max(1, v.calls));
    const tokens = `tokens/call in ${perCall(v.input)} cached ${perCall(v.cachedInput)} out ${perCall(v.output)}`;
    const cost = v.costKnown && v.calls ? `${usd(v.cost / v.calls)}/call` : "?";
    const outcomes = Object.keys(v.outcomes).length ? `; run results ${counts(v.outcomes)}` : "";
    const few = v.runs.size < FEW_RUNS ? ` (few runs: < ${FEW_RUNS}, not a measurement)` : "";
    const { agent, roleHash, model, effort } = v.g;
    return `${agent} ${roleHash ?? "-"} ${model ?? "-"} ${effort ?? "-"}: runs ${v.runs.size}, calls ${v.calls}, ok ${v.ok}, null ${v.nulls}${nullPart}; median ${round1(median(v.secs))} s; ${tokens}; cost ${cost}; ${String(v.first ?? "?").slice(0, 10)}..${String(v.last ?? "?").slice(0, 10)}${outcomes}${few}`;
  });
}

function workflowLines(records) {
  const flows = new Map();
  for (const r of records) {
    const name = r.workflow ?? "-";
    if (!flows.has(name)) flows.set(name, { runs: 0, status: {}, outcomes: {}, gaps: 0, walls: [], outputs: [], failed: new Map(), stops: new Map(), cost: 0, costKnown: true });
    const f = flows.get(name);
    f.runs++;
    f.status[r.status ?? "unknown"] = (f.status[r.status ?? "unknown"] ?? 0) + 1;
    if (r.status === "stopped") tally(f.stops, r.stopReason || null);
    if (r.status === "failed") tally(f.failed, r.error || null);
    if (r.outcome) {
      f.outcomes[r.outcome.status] = (f.outcomes[r.outcome.status] ?? 0) + 1;
      f.gaps += r.outcome.gaps ?? 0;
    }
    if (typeof r.wallS === "number") f.walls.push(r.wallS);
    f.outputs.push(r.groups.reduce((t, g) => t + (g.output ?? 0), 0));
    for (const g of r.groups) {
      if (typeof g.costUsd === "number") f.cost += g.costUsd;
      else f.costKnown = false;
    }
  }
  return [...flows.entries()].map(([name, f]) => {
    const outcomes = Object.keys(f.outcomes).length ? `; results ${counts(f.outcomes)}${f.gaps ? `, gaps ${f.gaps}` : ""}` : "";
    // --budget counts output tokens, so the suggestion scales the median output of a run.
    const out = median(f.outputs);
    const budget = out > 0 ? `; suggested --budget ${budgetText(out * BUDGET_FACTOR)} (${BUDGET_FACTOR} x median output ${Math.round(out)})${f.runs < FEW_RUNS ? `, few runs` : ""}` : "";
    const failed = f.failed.size ? `; failed: ${reasonCounts(f.failed)}` : "";
    const stops = f.stops.size ? `; stopped: ${reasonCounts(f.stops)}` : "";
    return `workflow ${name}: runs ${f.runs} (${counts(f.status)})${outcomes}${failed}${stops}; median wall ${round1(median(f.walls))} s; cost ${f.costKnown ? `${usd(f.cost / f.runs)}/run` : "?"}${budget}`;
  });
}

export async function evolveStatsCommand(ctx) {
  if (ctx.args.length) throw new UsageError(`no positional arguments; usage: ${EVOLVE_STATS_USAGE}`);
  const { since, workflow, agent } = ctx.opts;
  if (since !== undefined && !isIsoDay(since)) throw new UsageError(`--since takes an ISO date (YYYY-MM-DD), got '${since}'`);
  if (ctx.opts["runs-dir"] !== undefined && !ctx.opts.import) throw new UsageError("--runs-dir goes with --import");
  let ledger = readLedger(ctx.root);
  let code = 0;
  if (ctx.opts.import) {
    code = importRuns(ctx, ledger).code;
    ledger = readLedger(ctx.root);
  }
  const records = ledger.records
    .filter((r) => since === undefined || String(r.startedAt ?? "") >= since)
    .filter((r) => workflow === undefined || r.workflow === workflow)
    .sort((a, b) => String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")));
  for (const line of versionLines(records, agent)) ctx.out(line);
  if (agent === undefined) for (const line of workflowLines(records)) ctx.out(line);
  // Skills the model invoked (the skill usage hook), most used first; a 0 marks a skill whose description never fired.
  if (agent === undefined && workflow === undefined) {
    const skills = [...skillUsage(ctx.root, since).entries()].sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]));
    for (const [name, s] of skills) ctx.out(`skill ${name}: ${s.calls} calls by the model${s.last ? `, last ${s.last.slice(0, 10)}` : ""}`);
  }
  ctx.out(`evolve-stats: ${records.length} runs from ${METRICS_REL}${ledger.bad ? `, ${ledger.bad} unreadable lines skipped` : ""}`);
  return code;
}
