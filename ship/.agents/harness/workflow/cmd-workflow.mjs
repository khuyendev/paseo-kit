// ph workflow (FLOW-16, FLOW-18..FLOW-21): checks that fail with exit 1 before the run directory exists, then the run
// in the foreground or a detached child.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PH_FILE, UsageError, errText } from "../lib/cli.mjs";
import { readText, writeJsonAtomic, readJsonIf } from "../lib/io.mjs";
import { resolveInside, samePath } from "../lib/paths.mjs";
import { pidAlive } from "../lib/proc.mjs";
import { runWorkflow } from "./engine.mjs";
import { RUN_FILES, STOP_AT, checkRunId, loadInFlight, loadJournalCache, newRunId, parseBudget, readJournal, readStopRequest, runsDirOf, runsDirSuffix } from "./journal.mjs";
import { METRICS_REL, appendRecords, runRecord } from "./metrics.mjs";
import { createPaseoHost } from "./runner.mjs";
import { runtime as kitRuntime } from "./runtime-bridge.mjs";
import { parseScript } from "./script.mjs";

export const WORKFLOW_OPTIONS = Object.freeze({
  script: "string", name: "string", args: "string", "args-file": "string", resume: "string", budget: "string", "runs-dir": "string", detach: "bool", "run-id": "string",
  at: "string", reason: "string",
});
export const WORKFLOW_USAGE = "ph workflow [--script F | --name N] [--args JSON | --args-file F] [--resume RUNID] [--budget N|Nk|N.Nm] [--runs-dir D] [--detach] [--run-id ID] | ph workflow stop RUNID [--at wave-boundary] [--reason TEXT] [--runs-dir D]";
const STOP_USAGE = "ph workflow stop RUNID [--at wave-boundary] [--reason TEXT] [--runs-dir D]";
const STOP_REASON_MAX_CHARS = 300;
// Same text as Session.requireCaller (PCLI-06); checked here before any daemon contact.
const NO_CALLER = "PASEO_AGENT_ID is not set: run ph from an agent inside Paseo, so every agent is created as its subagent";
// The detached child runs in the directory its parent claimed; this names it, nothing else may reuse a run dir.
const CLAIMED_ENV = "PASEO_HARNESS_CLAIMED_RUN_DIR";

// GSDF-18: an object result.json names the run's effective roles; a `roles` key the script returns itself wins.
const withRoles = (result, roles) => (result !== null && typeof result === "object" && !Array.isArray(result) ? { roles, ...result } : (result ?? null));

// A saved workflow lives only in .agents/workflows/ (FLOW-10); {scriptPath} is relative to the root.
export function resolveScript(root, ref) {
  let file;
  if (typeof ref === "string") {
    if (!/^[A-Za-z0-9._-]+$/.test(ref)) throw new Error(`no saved workflow '${ref}' in .agents/workflows/`);
    file = [".js", ".mjs"].map((ext) => path.join(root, ".agents", "workflows", `${ref}${ext}`)).find((f) => fs.existsSync(f));
    if (!file) throw new Error(`no saved workflow '${ref}' in .agents/workflows/`);
  } else if (ref && typeof ref.scriptPath === "string") {
    file = path.resolve(root, ref.scriptPath);
    if (!fs.existsSync(file)) throw new Error(`workflow script not found: ${file}`);
  } else throw new Error("workflow() takes a name or {scriptPath}");
  return { source: readText(file), scriptPath: file };
}

function parseJsonArg(text, what) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${what} is not valid JSON: ${e.message}`);
  }
}

// Everything that can fail with exit 1 (FLOW-20): arguments, script, args, budget, caller, caller root.
async function prepare(ctx, deps) {
  const { opts, root } = ctx;
  if (opts.script !== undefined && opts.name !== undefined) throw new UsageError("give --script or --name, not both");
  if (opts.args !== undefined && opts["args-file"] !== undefined) throw new UsageError("use --args or --args-file, not both");
  const runsDir = runsDirOf(root, opts["runs-dir"]);
  if (opts.resume !== undefined) checkRunId(opts.resume, "--resume");
  if (opts["run-id"] !== undefined) checkRunId(opts["run-id"], "--run-id");
  const prevDir = opts.resume !== undefined ? path.join(runsDir, opts.resume) : null;
  // Read before the first await, so a prune of the source run after this point cannot empty the cache (G136) or lose
  // the calls it left running (G123).
  const cache = prevDir ? loadJournalCache(path.join(prevDir, RUN_FILES.journal)) : new Map();
  const inFlight = prevDir ? loadInFlight(path.join(prevDir, RUN_FILES.journal)) : [];
  let ref;
  if (opts.script !== undefined) ref = { scriptPath: opts.script };
  else if (opts.name !== undefined) ref = opts.name;
  else if (prevDir) ref = { scriptPath: path.join(prevDir, RUN_FILES.script) };
  else throw new UsageError(`give --script or --name (or --resume RUNID to rerun that run's script); usage: ${WORKFLOW_USAGE}`);
  let script;
  try {
    script = resolveScript(root, ref);
  } catch (e) {
    throw new UsageError(errText(e));
  }
  const { meta } = parseScript(script.source);
  let args;
  if (opts.args !== undefined) args = parseJsonArg(opts.args, "--args");
  else if (opts["args-file"] !== undefined) args = parseJsonArg(readText(path.resolve(root, opts["args-file"])), "--args-file");
  // A run without args writes no args.json, so a file that exists (even holding null) is the value the run was given.
  else if (prevDir && fs.existsSync(path.join(prevDir, RUN_FILES.args))) args = readJsonIf(path.join(prevDir, RUN_FILES.args));
  const budgetTotal = opts.budget !== undefined ? parseBudget(opts.budget) : null;
  if (!ctx.env.PASEO_AGENT_ID?.trim()) throw new UsageError(NO_CALLER);
  const runtime = deps.runtime ?? kitRuntime;
  // A missing daemon or CLI is a run failure (exit 2), so the connection error is kept for after the run dir exists.
  let session = null;
  let connectError = null;
  try {
    session = await ctx.paseo();
  } catch (e) {
    connectError = e;
  }
  if (session) await runtime.assertCallerInRoot(session);
  const runId = opts["run-id"] ?? newRunId(new Date(ctx.clock.now()));
  // The script global `runId` stays the first run's id across --resume, so attempt keys survive (GSDC-30, GSDF-12).
  const attemptRunId = prevDir ? (readJsonIf(path.join(prevDir, RUN_FILES.run))?.attemptRunId ?? opts.resume) : runId;
  const runDir = path.join(runsDir, runId);
  const claimed = ctx.env[CLAIMED_ENV] !== undefined && samePath(ctx.env[CLAIMED_ENV], runDir);
  if (!claimed && fs.existsSync(runDir)) throw new UsageError(`run ${runId} already exists in ${runsDir}; give another --run-id`);
  return { runsDir, prevDir, script, meta, args, budgetTotal, runtime, session, connectError, runId, attemptRunId, runDir, claimed, cache, inFlight };
}

// Claims the run dir exclusively, so a repeated or concurrent --run-id never overwrites a run (CR-WFL-01).
function claimRunDir(p) {
  fs.mkdirSync(p.runsDir, { recursive: true });
  if (p.claimed) {
    const info = readJsonIf(path.join(p.runDir, RUN_FILES.run));
    // The parent records its own pid, then the child's; a worker that inherited the variable matches neither.
    const ours = info?.pid === process.pid || info?.pid === process.ppid;
    if (info?.status !== "running" || info.runId !== p.runId || !ours) throw new UsageError(`run ${p.runId} was not started by a detaching ph workflow`);
    return info;
  }
  try {
    fs.mkdirSync(p.runDir);
  } catch (e) {
    if (e.code === "EEXIST") throw new UsageError(`run ${p.runId} already exists in ${p.runsDir}; give another --run-id`);
    throw e;
  }
  return null;
}

function writeRunStart(p, ctx, pid) {
  const existing = claimRunDir(p);
  fs.writeFileSync(path.join(p.runDir, RUN_FILES.script), p.script.source, "utf8");
  if (p.args !== undefined) writeJsonAtomic(path.join(p.runDir, RUN_FILES.args), p.args);
  const info = {
    runId: p.runId, attemptRunId: p.attemptRunId, parent: ctx.opts.resume ?? null, script: p.script.scriptPath, status: "running",
    startedAt: existing ? existing.startedAt : new Date(ctx.clock.now()).toISOString(),
    endedAt: null, agents: null, budget: p.budgetTotal, pid, name: p.meta.name, description: p.meta.description,
  };
  writeJsonAtomic(path.join(p.runDir, RUN_FILES.run), info);
  return info;
}

// A detached start whose spawn failed never has a child to rewrite run.json, so the parent ends the record here (G128).
function detachFailed(ctx, p, e) {
  const runFile = path.join(p.runDir, RUN_FILES.run);
  const info = { ...readJsonIf(runFile), status: "failed", endedAt: new Date(ctx.clock.now()).toISOString(), error: errText(e) };
  writeJsonAtomic(runFile, info);
  ctx.out(`workflow failed ${p.runId}: ${errText(e)}`);
  return 2;
}

// The child gets the same arguments without the --detach flag; the token after a string option is its value and stays.
function childArgvOf(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith("--") ? argv[i].slice(2) : null;
    if (key === "detach") continue;
    out.push(argv[i]);
    if (WORKFLOW_OPTIONS[key] === "string" && i + 1 < argv.length) out.push(argv[++i]);
  }
  return out;
}

async function detach(ctx, p, deps) {
  const logFile = path.join(p.runDir, RUN_FILES.log);
  writeRunStart(p, ctx, process.pid);
  const fd = fs.openSync(logFile, "a");
  const childArgs = childArgvOf(ctx.argv);
  if (ctx.opts["run-id"] === undefined) childArgs.push("--run-id", p.runId);
  let child;
  try {
    child = (deps.spawn ?? spawn)(process.execPath, [PH_FILE, "workflow", ...childArgs], {
      cwd: ctx.root, detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...ctx.env, PASEO_HARNESS_LOG_IS_STDOUT: "1", [CLAIMED_ENV]: p.runDir },
    });
  } catch (e) {
    return detachFailed(ctx, p, e);
  } finally {
    fs.closeSync(fd);
  }
  // Node reports a missing binary or another failed spawn as an 'error' event, not a throw, so the start is announced
  // only once the child has spawned.
  const spawnError = await new Promise((resolve) => {
    child.once("spawn", () => resolve(null));
    child.once("error", resolve);
  });
  if (spawnError) return detachFailed(ctx, p, spawnError);
  child.unref?.();
  // The child rewrites run.json at its start; the parent only puts the child's pid into a still-running record.
  const runFile = path.join(p.runDir, RUN_FILES.run);
  const info = readJsonIf(runFile);
  if (info?.status === "running" && child.pid) writeJsonAtomic(runFile, { ...info, pid: child.pid });
  ctx.out(`workflow started ${p.runId}: ${logFile}`);
  ctx.out(`next: wait with Monitor running \`${ctx.ph} watch-run ${p.runId} --quiet${runsDirSuffix(ctx.root, p.runsDir)}\`; do not poll with sleep/grep loops`);
  return 0;
}

const fmtCost = (usd) => (typeof usd === "number" ? `$${Math.round(usd * 10000) / 10000}` : "$?");

// Kit feedback 121: the run's last line names codebase-map drift when the result carries it. Empty when it does not,
// so a run with no drift keeps the line it had.
export function resultTail(result) {
  const line = result?.mapDrift?.line;
  return typeof line === "string" && line ? `; ${line}` : "";
}

// The ended run's line in the metrics ledger; a failure to write it never fails the run.
function recordMetrics(ctx, p, info, journalPath, result, out) {
  try {
    appendRecords(ctx.root, [runRecord(p.runId, info, readJournal(journalPath), result)]);
  } catch (e) {
    out(`log warning: run metrics not recorded in ${METRICS_REL}: ${errText(e)}`);
  }
}

// Kit feedback #39: a runner that ends without its own terminal line leaves run.json "running" and log.txt silent. A
// signal or an uncaught error is recorded as it happens; any other exit with the run still running (an unsettled
// top-level await, a loop that ran dry) is recorded from the exit code. A hard kill (taskkill /F, TerminateProcess)
// runs no handler, so that death stays without a reason and watch-run reports it as interrupted.
const RUNNER_SIGNALS = process.platform === "win32" ? ["SIGINT", "SIGBREAK", "SIGHUP"] : ["SIGINT", "SIGTERM", "SIGHUP"];
function recordRunnerExit(ctx, p, out) {
  const runFile = path.join(p.runDir, RUN_FILES.run);
  let reason = null;
  const onSignal = (signal) => {
    reason = `signal ${signal}`;
    process.exit(128 + os.constants.signals[signal]);
  };
  const onError = (error) => {
    reason = `uncaught error: ${errText(error)}`;
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  };
  const onExit = (code) => {
    const info = readJsonIf(runFile);
    if (info?.status !== "running") return;
    const why = reason ?? `runner exited with code ${code} before the run ended`;
    writeJsonAtomic(runFile, { ...info, status: "failed", endedAt: new Date(ctx.clock.now()).toISOString(), error: why });
    out(`workflow failed ${p.runId}: ${why}`);
  };
  process.on("exit", onExit);
  process.on("uncaughtException", onError);
  for (const signal of RUNNER_SIGNALS) process.on(signal, onSignal);
  // The listeners last only as long as the run, so a process that runs several runs in turn does not stack them.
  return () => {
    process.off("exit", onExit);
    process.off("uncaughtException", onError);
    for (const signal of RUNNER_SIGNALS) process.off(signal, onSignal);
  };
}

async function runForeground(ctx, p) {
  const logFile = path.join(p.runDir, RUN_FILES.log);
  let info = writeRunStart(p, ctx, process.pid);
  const runFile = path.join(p.runDir, RUN_FILES.run);
  const toStdoutOnly = Boolean(ctx.env.PASEO_HARNESS_LOG_IS_STDOUT);
  const out = (line) => {
    ctx.out(line);
    if (!toStdoutOnly) fs.appendFileSync(logFile, `${line}\n`, "utf8");
  };
  const journalPath = path.join(p.runDir, RUN_FILES.journal);
  fs.appendFileSync(journalPath, "", "utf8");
  const stopRecording = recordRunnerExit(ctx, p, out);
  out(`workflow start ${p.runId} ${p.runDir}`);
  let host = null;
  try {
    if (p.connectError) throw p.connectError;
    const { session } = p;
    const caller = session.requireCaller();
    host = createPaseoHost({
      session, cfg: ctx.cfg, runtime: p.runtime, root: ctx.root, runId: p.runId, parentRunId: ctx.opts.resume ?? null, out, clock: ctx.clock,
      onAdopt: (entry) => {
        info = { ...info, adopted: [...(info.adopted ?? []), entry] };
        writeJsonAtomic(runFile, info);
      },
    });
    // One budget pool: the orchestrator's own output during the run counts too (FLOW-09).
    await session.usage.track([caller]);
    const callerBase = session.usage.get(caller)?.output ?? 0;
    // Calls the killed run created and never finished may still be running: stopped before any replacement starts (G123).
    for (const agentId of p.inFlight) await host.stop(agentId);
    const r = await runWorkflow({
      source: p.script.source, scriptPath: p.script.scriptPath, args: p.args, runId: p.runId, attemptRunId: p.attemptRunId, root: ctx.root,
      limits: { maxConcurrent: ctx.cfg.max_subagents, maxAgents: ctx.cfg.max_agents_per_workflow, budgetTotal: p.budgetTotal, shellTimeoutS: ctx.cfg.wait_timeout_s },
      env: { ...ctx.env, PASEO_HARNESS_WORKFLOW_RUN: p.runId, PASEO_HARNESS_WORKFLOW_RUN_DIR: p.runDir },
      journalPath, cache: p.cache, out,
      resolveChild: (ref) => resolveScript(ctx.root, ref),
      extraSpent: () => (session.usage.get(caller)?.output ?? 0) - callerBase,
      host,
    });
    await host.finish();
    const resultFile = path.join(p.runDir, RUN_FILES.result);
    writeJsonAtomic(resultFile, withRoles(r.result, r.roles));
    // Kit feedback 88: a script that stopped at a wave boundary returns {status: "paused"}; the run ends paused, to be continued.
    const paused = r.result?.status === "paused";
    const stopRequest = paused ? readStopRequest(p.runDir) : null;
    info = { ...info, status: paused ? "paused" : "done", endedAt: new Date(ctx.clock.now()).toISOString(), agents: r.stats, ...(stopRequest ? { stopRequest } : {}) };
    writeJsonAtomic(runFile, info);
    recordMetrics(ctx, p, info, journalPath, r.result, out);
    const stats = `ok ${r.stats.ok}, null ${r.stats.null}, cached ${r.stats.cached}, tokens ${r.stats.tokens}, cost ${fmtCost(r.stats.costUsd)}`;
    const tail = resultTail(r.result);
    if (paused) {
      out(`workflow paused ${p.runId}: ${resultFile} (${typeof r.result.reason === "string" ? `${r.result.reason}; ` : ""}${stats}${tail})`);
      out(`next: ${typeof r.result.answer?.command === "string" ? r.result.answer.command : `continue with \`${ctx.ph} workflow --resume ${p.runId} --detach${runsDirSuffix(ctx.root, p.runsDir)}\``}`);
    } else out(`workflow done ${p.runId}: ${resultFile} (${stats}${tail})`);
    return 0;
  } catch (e) {
    await host?.finish().catch(() => {});
    info = { ...info, status: "failed", endedAt: new Date(ctx.clock.now()).toISOString(), error: errText(e) };
    writeJsonAtomic(runFile, info);
    recordMetrics(ctx, p, info, journalPath, null, out);
    out(`workflow failed ${p.runId}: ${errText(e)}`);
    return 2;
  } finally {
    stopRecording();
  }
}

// Kit feedback 88: `ph workflow stop RUNID` asks a running run to stop at its next wave boundary. It kills nothing: it writes
// stop.json in the run dir, which the composition reads between waves (flow verb stop-requested) and then ends the run paused.
function stopCommand(ctx) {
  const [, runId, ...extra] = ctx.args;
  if (!runId || extra.length) throw new UsageError(`name one run id: ${STOP_USAGE}`);
  checkRunId(runId, "run id");
  const at = ctx.opts.at ?? "wave-boundary";
  if (!STOP_AT.includes(at)) throw new UsageError(`--at ${at} is not a stop point; one of ${STOP_AT.join(", ")}`);
  for (const k of ["script", "name", "args", "args-file", "resume", "budget", "detach", "run-id"]) if (ctx.opts[k] !== undefined) throw new UsageError(`--${k} does not apply to workflow stop: ${STOP_USAGE}`);
  const runsDir = runsDirOf(ctx.root, ctx.opts["runs-dir"]);
  const runDir = resolveInside(runsDir, runId);
  const info = readJsonIf(path.join(runDir, RUN_FILES.run));
  if (!info) throw new UsageError(`no run ${runId} in ${runsDir}`);
  if (info.status !== "running") throw new UsageError(`run ${runId} is not running (status ${info.status}); nothing to stop`);
  if (!pidAlive(info.pid)) throw new UsageError(`the runner of ${runId} (pid ${info.pid}) is gone; end the run with ${ctx.ph} archive --run ${runId}${runsDirSuffix(ctx.root, runsDir)}`);
  const reason = typeof ctx.opts.reason === "string" && ctx.opts.reason.trim() ? ctx.opts.reason.replace(/\s+/g, " ").trim().slice(0, STOP_REASON_MAX_CHARS) : null;
  writeJsonAtomic(path.join(runDir, RUN_FILES.stop), { at, requestedAt: new Date(ctx.clock.now()).toISOString(), reason });
  ctx.out(`stop requested ${runId} at the next ${at}: the running agents finish, the wave commits, then the run ends paused`);
  ctx.out(`next: wait with Monitor running \`${ctx.ph} watch-run ${runId} --quiet${runsDirSuffix(ctx.root, runsDir)}\`; a workflow that has no wave boundary runs to its end`);
  return 0;
}

// deps (tests): {runtime, spawn}.
export async function workflowCommand(ctx, deps = {}) {
  if (ctx.args?.[0] === "stop") return stopCommand(ctx);
  if (ctx.args?.length) throw new UsageError(`unexpected argument '${ctx.args[0]}': ${WORKFLOW_USAGE}`);
  for (const k of ["at", "reason"]) if (ctx.opts[k] !== undefined) throw new UsageError(`--${k} belongs to ph workflow stop: ${STOP_USAGE}`);
  const p = await prepare(ctx, deps);
  return ctx.opts.detach ? detach(ctx, p, deps) : runForeground(ctx, p);
}
