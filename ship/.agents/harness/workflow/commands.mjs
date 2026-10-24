// ph commands of the workflow module (M6): workflow, watch-run, run-stats, evolve-stats, review-stats, runs.
import { WORKFLOW_OPTIONS, WORKFLOW_USAGE, workflowCommand } from "./cmd-workflow.mjs";
import { WATCH_OPTIONS, WATCH_USAGE, watchRunCommand } from "./cmd-watch-run.mjs";
import { RUN_STATS_OPTIONS, runStatsCommand } from "./cmd-run-stats.mjs";
import { RUNS_OPTIONS, runsCommand } from "./cmd-runs.mjs";
import { EVOLVE_STATS_OPTIONS, EVOLVE_STATS_USAGE, evolveStatsCommand } from "./cmd-evolve-stats.mjs";
import { REVIEW_STATS_OPTIONS, REVIEW_STATS_USAGE, reviewStatsCommand } from "./cmd-review-stats.mjs";

export const commands = [
  {
    name: "workflow",
    summary: "run a workflow script (agent/pipeline/parallel) with journal and resume; --detach returns at once; `workflow stop RUNID` pauses a run at its next wave boundary",
    usage: WORKFLOW_USAGE,
    options: WORKFLOW_OPTIONS,
    config: "required",
    run: (ctx) => workflowCommand(ctx),
  },
  {
    name: "watch-run",
    summary: "follow workflow runs (under Monitor) until they end",
    usage: WATCH_USAGE,
    options: WATCH_OPTIONS,
    config: "none",
    run: (ctx) => watchRunCommand(ctx),
  },
  {
    name: "run-stats",
    summary: "wall time, agent seconds, tokens and cost of workflow runs (--transcripts: tool calls per kind)",
    usage: "ph run-stats RUNID... [--transcripts] [--runs-dir D]",
    options: RUN_STATS_OPTIONS,
    config: "none",
    run: (ctx) => runStatsCommand(ctx),
  },
  {
    name: "evolve-stats",
    summary: "the metrics ledger per agent version (role-text hash, model, effort) and per workflow, for harness-evolve; --import adds ended runs",
    usage: EVOLVE_STATS_USAGE,
    options: EVOLVE_STATS_OPTIONS,
    config: "none",
    run: (ctx) => evolveStatsCommand(ctx),
  },
  {
    name: "review-stats",
    summary: "how the gsd-execute code review performed (gate, verifier, resolution, later fates) from the phases' review records; --stage reports one review stage (skeleton, checker, plan, code) with cost per confirmed finding and escapes; outcome records a finding's fate",
    usage: REVIEW_STATS_USAGE,
    options: REVIEW_STATS_OPTIONS,
    config: "none",
    run: (ctx) => reviewStatsCommand(ctx),
  },
  {
    name: "runs",
    summary: "list workflow runs newest first; a running record whose runner is gone is dead; --live lists live runners; --prune removes done and stopped runs beyond runs_keep and dead running records",
    usage: "ph runs [--prune] [--live] [--runs-dir D]",
    options: RUNS_OPTIONS,
    config: "required",
    run: (ctx) => runsCommand(ctx),
  },
];
