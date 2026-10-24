// Shell-side helper of the GSD workflow scripts. Scripts have no file or git API (FLOW-02), so every
// file read, guarded write and git inspection they need runs here: `node .agents/workflows/lib/gsd-flow.mjs <cmd> ...`.
// Output follows the ph gsd rule: one JSON document on the last stdout line; exit 0 ok, 1 negative verdict or error.
import fs from "node:fs";
import path from "node:path";
import { configRoot } from "../../harness/config.mjs";
import { DEFAULT_RUNS_DIR, checkRunId, readStopRequest } from "../../harness/workflow/journal.mjs";
import { errText, isMain } from "../../harness/lib/cli.mjs";
import * as files from "./flow-files.mjs";
import * as map from "./flow-map.mjs";
import { head } from "./flow-git.mjs";
import * as project from "./flow-project.mjs";
import * as execute from "./flow-execute.mjs";
import * as review from "./flow-review.mjs";
import * as gate from "./flow-gate.mjs";
import * as validation from "./flow-validation.mjs";
import * as checks from "./flow-checks.mjs";
import * as planState from "./flow-plan-state.mjs";
import * as plan from "./flow-plan.mjs";
import * as state from "./flow-state.mjs";
import { renderPrompt } from "./flow-prompt.mjs";
import * as exec from "./flow-exec.mjs";
import { recordAccepted } from "../../harness/gsd/accepted.mjs";
import { resolveInside } from "../../harness/lib/paths.mjs";

// execute-progress.json has one writer, the state-* verbs (kit feedback 83 F1, 87); a raw write would skip their contracts.
const notState = (p) => {
  if (state.isStateFile(p)) throw new Error(`${p} is written only by the state-* verbs (state-plan, state-shared, state-request, state-integration, state-answer, state-smoke)`);
  return p;
};

// Kit feedback 88: the stop request `ph workflow stop` left for the current run (the runner names it in the script's env), or
// for the run id given. Read-only; a script run outside `ph workflow` has no run and never stops.
function stopRequested(root, [id], env) {
  const runId = id ?? env.PASEO_HARNESS_WORKFLOW_RUN ?? null;
  if (!runId) return { stop: false, runId: null };
  checkRunId(runId, "run id");
  const runDir = !id && env.PASEO_HARNESS_WORKFLOW_RUN_DIR ? env.PASEO_HARNESS_WORKFLOW_RUN_DIR : path.join(root, DEFAULT_RUNS_DIR, runId);
  const req = readStopRequest(runDir);
  return req ? { stop: true, runId, at: req.at ?? "wave-boundary", requestedAt: req.requestedAt ?? null, reason: req.reason ?? null } : { stop: false, runId };
}

const COMMANDS = {
  exists: (root, args) => files.exists(root, args),
  read: (root, [p]) => files.read(root, p),
  write: (root, [p], input) => files.write(root, notState(p), input),
  append: (root, [p], input) => files.append(root, notState(p), input),
  "append-new": (root, [p], input) => files.appendNew(root, notState(p), JSON.parse(input)),
  "json-push": (root, [p], input) => files.jsonPush(root, notState(p), JSON.parse(input)),
  secrets: (root, args) => map.secrets(root, args),
  stamp: (root, args) => map.stamp(root, args.length ? args : undefined),
  drift: (root, [threshold]) => map.drift(root, Number(threshold)),
  "map-drift": (root, _args, input) => map.mapDrift(root, input ? JSON.parse(input) : {}),
  "map-check": (root, args) => map.mapCheck(root, args.length ? args : undefined),
  head: (root) => ({ commit: head(root) }),
  "draft-check": (root) => project.draftCheck(root),
  "summary-heal": (root, args, input) => project.summaryHeal(root, input, { stale: args.includes("--stale") }),
  "anti-patterns": (root, [phaseDir]) => execute.antiPatterns(root, phaseDir),
  "cwd-guard": (root, [worktreeDir]) => execute.cwdGuard(root, worktreeDir, process.cwd()),
  baseline: (root, [phaseDir]) => execute.recordBaseline(root, phaseDir),
  "resume-gate": (root, [phaseDir], input) => execute.resumeGate(root, phaseDir, JSON.parse(input)),
  transfer: (root, [phaseDir], input) => execute.transfer(root, phaseDir, JSON.parse(input)),
  "discard-worktree": (root, _args, input) => execute.discardWorktree(root, JSON.parse(input)),
  "leftover-worktrees": (root) => execute.leftoverTrees(root),
  adopt: (root, [phaseDir, plan, rel]) => execute.adopt(root, phaseDir, plan, rel),
  "owned-changes": (root, [phaseDir], input) => execute.ownedChanges(root, phaseDir, JSON.parse(input)),
  "smoke-due": (root, _args, input) => execute.smokeDue(JSON.parse(input)),
  "schedule-graph": (root, _args, input) => execute.scheduleGraph(root, JSON.parse(input)),
  "dirty-owned": (root, [phaseDir], input) => execute.dirtyOwned(root, phaseDir, JSON.parse(input)),
  "execution-inputs": (root) => execute.executionInputs(root),
  "dependency-seed": (root, [phaseDir], input) => execute.dependencySeed(root, phaseDir, JSON.parse(input)),
  "pending-transfers": (root, [phaseDir]) => execute.pendingTransfers(root, phaseDir),
  owners: (root, _args, input) => execute.ownersOf(root, JSON.parse(input)),
  remove: (root, [p]) => files.remove(root, notState(p)),
  lock: (root, [name, runId, kind]) => files.lock(root, name, runId, undefined, kind ?? null),
  unlock: (root, [name, runId]) => files.unlock(root, name, runId),
  "lock-check": (root, [name, runId]) => files.lockCheck(root, name, runId),
  digest: (root, _args, input) => gate.digest(root, JSON.parse(input)),
  gate: (root, [phaseDir], input) => gate.gate(root, phaseDir, JSON.parse(input)),
  "test-command": (root, _args, input) => gate.testCommand(root, input ? JSON.parse(input) : {}),
  "evidence-check": (root, [p], input) => gate.evidenceCheck(root, p, input ? JSON.parse(input).plans ?? [] : []),
  "check-weakening": (root, [phaseDir], input) => checks.checkWeakening(root, phaseDir, input ? JSON.parse(input) : {}),
  "spot-check": (root, [summary]) => execute.spotCheck(root, summary),
  "review-scope": (root, [phaseDir], input) => review.reviewScope(root, phaseDir, JSON.parse(input)),
  "review-record": (root, [phaseDir], input) => review.writeRecord(root, phaseDir, JSON.parse(input)),
  "prereview-record": (root, [phaseDir], input) => review.writePrereview(root, phaseDir, JSON.parse(input)),
  "validation-strategy": (root, [phaseDir]) => validation.validationStrategy(root, phaseDir),
  "changed-lines": (root, [phaseDir], input) => review.changedLines(root, phaseDir, JSON.parse(input)),
  "quick-dir": (root, [slugSource]) => project.quickDir(root, slugSource),
  "quick-verification": (root, [dir, action]) => project.quickVerification(root, dir, action),
  "forensics-path": (root, _args, input) => project.forensicsPath(root, input),
  // Planning state (kit feedback 87): the one writer of <phaseDir>/plan-progress.json.
  "plan-state": (root, [phaseDir]) => planState.planState(root, phaseDir),
  "plan-run": (root, [phaseDir], input) => planState.planRun(root, phaseDir, JSON.parse(input)),
  "plan-mark": (root, [phaseDir], input) => planState.planMark(root, phaseDir, JSON.parse(input)),
  "plan-end": (root, [phaseDir], input) => planState.planEnd(root, phaseDir, JSON.parse(input)),
  "plan-outline": (root, [phaseDir], input) => planState.planOutline(root, phaseDir, JSON.parse(input)),
  "plan-checker": (root, [phaseDir], input) => planState.planChecker(root, phaseDir, JSON.parse(input)),
  "plan-contracts": (root, [phaseDir], input) => planState.planContracts(root, phaseDir, JSON.parse(input)),
  "plan-realloc": (root, [phaseDir], input) => planState.planRealloc(root, phaseDir, JSON.parse(input)),
  "plan-recheck": (root, [phaseDir], input) => planState.planRecheck(root, phaseDir, JSON.parse(input)),
  "plan-replan": (root, [phaseDir], input) => planState.planReplan(root, phaseDir, JSON.parse(input)),
  "plan-replan-drain": (root, [phaseDir], input) => planState.planReplanDrain(root, phaseDir, JSON.parse(input)),
  // Pure planning verbs of the gsd-plan composition (THIN.md stage 2): no record, one answer.
  "plan-args": (root, _args, input) => plan.planArgs(root, JSON.parse(input)),
  "plan-prompt": (root, [kind], input) => plan.planPrompt(root, kind, JSON.parse(input)),
  "plan-skeleton": (root, [op], input) => plan.planSkeleton(root, op, JSON.parse(input)),
  "plan-probes": (root, _args, input) => plan.planProbes(root, JSON.parse(input)),
  "plan-linked": (root, _args, input) => plan.planLinked(root, JSON.parse(input)),
  "plan-realloc-diff": (root, _args, input) => plan.planReallocDiff(root, JSON.parse(input)),
  "plan-validation": (root, _args, input) => plan.planValidation(root, JSON.parse(input)),
  // Kit feedback 89: the checker issues a forceProceed override accepted, recorded by gsd-plan (<phaseDir>/accepted-issues.json).
  "accepted-record": (root, [phaseDir], input) => recordAccepted(resolveInside(root, phaseDir), JSON.parse(input)),
  "plan-contract-route": (root, _args, input) => plan.planContractRoute(root, JSON.parse(input)),
  "plan-contract-drift": (root, _args, input) => plan.planContractDrift(root, JSON.parse(input)),
  "plan-replan-keep": (root, _args, input) => plan.planReplanKeep(root, JSON.parse(input)),
  "plan-streams-end": (root, _args, input) => plan.planStreamsEnd(root, JSON.parse(input)),
  "plan-checker-reply": (root, _args, input) => plan.planCheckerReply(root, JSON.parse(input)),
  "plan-dependents": (root, _args, input) => plan.planDependents(root, JSON.parse(input)),
  "state-read": (root, [phaseDir]) => state.stateRead(root, phaseDir),
  "state-plan": (root, [phaseDir], input) => state.statePlan(root, phaseDir, JSON.parse(input)),
  "state-shared": (root, [phaseDir], input) => state.stateShared(root, phaseDir, JSON.parse(input)),
  "state-request": (root, [phaseDir], input) => state.stateRequest(root, phaseDir, JSON.parse(input)),
  "state-integration": (root, [phaseDir], input) => state.stateIntegration(root, phaseDir, JSON.parse(input)),
  "state-answer": (root, [phaseDir], input) => state.stateAnswer(root, phaseDir, JSON.parse(input)),
  "state-smoke": (root, [phaseDir], input) => state.stateSmoke(root, phaseDir, JSON.parse(input)),
  "stop-requested": (root, args, _input, env) => stopRequested(root, args, env),
  // Prompt templates (THIN.md item 2): kit `.agents/workflows/prompts/<name>.md` or project `project/<name>`.
  prompt: (root, [name], input) => renderPrompt(root, name, input ? JSON.parse(input) : {}),
  // Decisions of the default execute composition (THIN stage 2, lib/flow-exec.mjs).
  "exec-args": (root, _args, input) => exec.execArgs(JSON.parse(input)),
  "exec-setup": (root, _args, input) => exec.execSetup(JSON.parse(input)),
  "exec-defect": (root, [phaseDir], input) => exec.execDefect(root, phaseDir, JSON.parse(input)),
  "exec-handoff": (root, [phaseDir], input) => exec.execHandoff(root, phaseDir, JSON.parse(input)),
  "exec-records": (root, [phaseDir], input) => exec.execRecords(root, phaseDir, JSON.parse(input)),
  "exec-select": (root, [phaseDir], input) => exec.execSelect(phaseDir, JSON.parse(input)),
  "exec-branch": (root, [phaseDir]) => exec.execBranch(root, phaseDir),
  "exec-route": (root, _args, input) => exec.execRoute(root, JSON.parse(input)),
  "exec-verdict": (root, _args, input) => exec.execVerdict(JSON.parse(input)),
  "exec-fix-allowance": (root, _args, input) => exec.fixAllowance(JSON.parse(input || "{}")),
  "exec-fix-reply": (root, _args, input) => exec.execFixReply(JSON.parse(input || "{}")),
  "exec-fixers": (root, _args, input) => exec.execFixers(JSON.parse(input)),
  "exec-round-end": (root, _args, input) => exec.execRoundEnd(JSON.parse(input)),
  "exec-verdicts": (root, _args, input) => exec.execVerdicts(JSON.parse(input)),
  "exec-review": (root, [phaseDir], input) => exec.execReview(root, phaseDir, JSON.parse(input)),
  "exec-findings": (root, _args, input) => exec.execFindings(JSON.parse(input)),
  "exec-pause": (root, _args, input) => exec.execPause(JSON.parse(input)),
  "exec-groups": (root, _args, input) => exec.execGroups(JSON.parse(input)),
  "exec-shared-before": (root, [phaseDir], input) => exec.execSharedBefore(root, phaseDir, JSON.parse(input)),
  "exec-shared-reply": (root, _args, input) => exec.execSharedReply(JSON.parse(input)),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

// Verbs whose handler reads JSON or text from stdin; every other verb never touches stdin, so a person running
// `gsd-flow.mjs remove <path>` from a shell whose stdin is an open pipe is not left waiting (G088).
const STDIN = new Set(["write", "append", "append-new", "json-push", "summary-heal", "resume-gate", "transfer", "discard-worktree", "owned-changes", "smoke-due", "schedule-graph", "dirty-owned", "dependency-seed", "owners", "digest", "gate", "test-command", "evidence-check", "check-weakening", "review-scope", "review-record", "prereview-record", "changed-lines", "forensics-path", "plan-run", "plan-mark", "plan-end", "plan-outline", "plan-checker", "plan-contracts", "plan-realloc", "plan-recheck", "state-plan", "state-shared", "state-request", "state-integration", "state-answer", "state-smoke", "prompt", "exec-args", "exec-setup", "exec-defect", "exec-handoff", "exec-records", "exec-select", "exec-route", "exec-verdict", "exec-fix-allowance", "exec-fix-reply", "exec-fixers", "exec-round-end", "exec-verdicts", "exec-review", "exec-findings", "exec-pause", "exec-groups", "exec-shared-before", "exec-shared-reply", "map-drift", "plan-args", "plan-prompt", "plan-skeleton", "plan-probes", "plan-linked", "plan-realloc-diff", "plan-validation", "accepted-record", "plan-contract-route", "plan-contract-drift", "plan-replan-keep", "plan-replan", "plan-replan-drain", "plan-streams-end", "plan-checker-reply", "plan-dependents"]);
export const readsStdin = (cmd) => STDIN.has(cmd);

export async function main(argv, { root = configRoot(), input = "", out = (l) => process.stdout.write(`${l}\n`), env = process.env } = {}) {
  const [cmd, ...args] = argv;
  const fn = COMMANDS[cmd];
  // The plan-* verbs are the only writer of plan-progress.json.
  if (["write", "append", "append-new", "json-push", "remove"].includes(cmd) && planState.isPlanStateFile(args[0])) {
    out(JSON.stringify({ status: "refused", error: `${args[0]} is written only by the plan-* verbs` }));
    return 1;
  }
  if (!fn) {
    out(JSON.stringify({ status: "error", error: `unknown command ${cmd ?? "(none)"}; one of ${COMMAND_NAMES.join(", ")}` }));
    return 1;
  }
  try {
    const { code = 0, ...json } = await fn(root, args, typeof input === "function" ? input() : input, env);
    out(JSON.stringify(json));
    return code;
  } catch (e) {
    out(JSON.stringify({ status: "error", error: errText(e) }));
    return 1;
  }
}

if (isMain(import.meta.url)) {
  const cmd = process.argv[2];
  const input = () => (process.stdin.isTTY || !readsStdin(cmd) ? "" : fs.readFileSync(0, "utf8"));
  process.exitCode = await main(process.argv.slice(2), { input });
}
