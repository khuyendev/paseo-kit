// ph commands of the workflow module (M6): workflow, watch-run, run-stats, runs.
import { WORKFLOW_OPTIONS, WORKFLOW_USAGE, workflowCommand } from "./cmd-workflow.mjs";
import { WATCH_OPTIONS, watchRunCommand } from "./cmd-watch-run.mjs";
import { RUN_STATS_OPTIONS, runStatsCommand } from "./cmd-run-stats.mjs";
import { RUNS_OPTIONS, runsCommand } from "./cmd-runs.mjs";

export const commands = [
  {
    name: "workflow",
    summary: "run a workflow script (agent/pipeline/parallel) with journal and resume; --detach returns at once",
    usage: WORKFLOW_USAGE,
    options: WORKFLOW_OPTIONS,
    config: "required",
    run: (ctx) => workflowCommand(ctx),
  },
  {
    name: "watch-run",
    summary: "follow workflow runs (under Monitor) until they end",
    usage: "ph watch-run RUNID... [--all] [--from-start] [--runs-dir D]",
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
    name: "runs",
    summary: "list workflow runs newest first; --prune removes done and stopped runs beyond runs_keep",
    usage: "ph runs [--prune] [--runs-dir D]",
    options: RUNS_OPTIONS,
    config: "required",
    run: (ctx) => runsCommand(ctx),
  },
];
