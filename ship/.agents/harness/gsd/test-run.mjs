// ph gsd test-run (kit feedback 109 F1/F4, 107 F1/F3): the only way a gate fixer runs tests. One call takes the project
// test lock, runs each owned failing file at the whole-file bound (killing the runner process tree), and writes the full
// output to a file. The terminal gets a short failure summary and that path, never the log.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { testCommandOf } from "../adapter/contract.mjs";
import { withMutex } from "../adapter/mutex.mjs";
import { sha256 } from "../lib/hash.mjs";
import { writeTextAtomic } from "../lib/io.mjs";
import { isInside, safeName, toSlash } from "../lib/paths.mjs";
import { runArgv } from "../lib/proc.mjs";
import { done, fail } from "./common.mjs";

const TIMEOUT_CODE = 124;

// The whole-file bound. adapter.commands.test_file_timeout_s when set, otherwise test_timeout_s (the bug was no bound at all).
export function fileTimeoutS(commands = {}) {
  const set = commands.test_file_timeout_s;
  if (Number.isInteger(set) && set >= 1) return set;
  const suite = commands.test_timeout_s;
  return Number.isInteger(suite) && suite >= 1 ? suite : 600;
}

// The last test path a runner's output names (a progress line, a `file:line`). `isTest(rel)` is the gate's isTestFile.
export function lastTestFile(text, isTest = () => false) {
  let last = null;
  for (const raw of String(text).split(/[\s"'`()<>|?*;=:{}[\]\\]+/)) {
    let tok = raw.replace(/\\/g, "/").replace(/^\.?\//, "");
    tok = tok.replace(/:\d+(?::\d+)?$/, "");
    if (!tok.includes(".")) continue;
    const rel = tok.replace(/^\.\//, "");
    if (isTest(rel)) last = rel;
  }
  return last;
}

// isTestFile lives in the workflow lib, which a harness-only tree (ph help) does not have. Loaded when a test run starts.
async function loadIsTest(checks) {
  const { isTestFile } = await import("../../workflows/lib/flow-checks.mjs");
  return (rel) => isTestFile(rel, checks);
}

// Drop the file arguments a serial run will append one at a time. Flags stay.
export function argvWithoutFiles(cwd, argv, files) {
  const set = new Set(files.map((f) => toSlash(f)));
  return argv.filter((w) => {
    if (!w || w.startsWith("-")) return true;
    const rel = toSlash(path.relative(cwd, path.resolve(cwd, w)));
    return !set.has(rel) && !set.has(toSlash(w));
  });
}

// One argv, or one process per file. `files` empty: the argv once, at timeoutS, and (when fileTimeoutS is shorter) a kill
// once one test file has been the current one for fileTimeoutS. `files` of two or more: each file at fileTimeoutS, a hang
// does not start the next. Returns the runArgv shape plus hungFile and runs.
export async function runBoundedTests({ cwd, argv, files = [], timeoutS, fileTimeoutS, isTest = () => false, run = runArgv }) {
  const bound = fileTimeoutS ?? timeoutS;
  if (files.length < 2) {
    let hungFile = null;
    let acc = "";
    let current = null;
    const watch = files.length === 0 && Number(bound) < Number(timeoutS);
    const r = await run(argv, {
      cwd,
      timeoutMs: timeoutS * 1000,
      onData: watch ? (_stream, chunk, api) => {
        acc = (acc + chunk).slice(-12000);
        const file = lastTestFile(acc, isTest);
        if (!file || file === current) return;
        current = file;
        api.alsoAfter(bound * 1000, () => { hungFile = file; });
      } : undefined,
    });
    return { ...r, hungFile: r.timedOut ? hungFile : null, runs: [argv] };
  }
  const base = argvWithoutFiles(cwd, argv, files);
  const perFile = Math.min(Number(timeoutS) || bound, Number(bound) || timeoutS);
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let hungFile = null;
  let code = 0;
  let error = null;
  const runs = [];
  for (const file of files) {
    const one = [...base, file];
    runs.push(one);
    const r = await run(one, { cwd, timeoutMs: perFile * 1000 });
    stdout += `\n--- ${file} ---\n${r.stdout ?? ""}`;
    stderr += `${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}`;
    if (r.timedOut) { timedOut = true; hungFile = file; code = null; break; }
    if (r.error && r.code === null) { error = r.error; code = null; break; }
    if ((r.code ?? 1) !== 0) code = r.code ?? 1;
  }
  return { stdout, stderr, timedOut, hungFile, code, error, runs };
}

// Lock shared by every test run of one repo (worktrees included). The adapter mutex when the project set one, so the gate's
// heavy commands wait too; otherwise a name of the git common dir, not of this worktree.
export function testLockName(root, cfg) {
  if (cfg.adapter?.mutex) return cfg.adapter.mutex;
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8", windowsHide: true });
  const rel = (r.stdout ?? "").trim();
  const dir = path.resolve(root, rel || ".git");
  return `gsd-test-${sha256(toSlash(dir)).slice(0, 12)}`;
}

function failureSummary(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bad = lines.filter((l) => /\b(error|fail|hung|timeout|exception|assert)/i.test(l));
  return (bad.length ? bad : lines.slice(-8)).slice(0, 12).map((l) => l.slice(0, 180)).join("\n");
}

function runDirOf(root, env) {
  const fromEnv = env?.PASEO_HARNESS_WORKFLOW_RUN_DIR;
  const base = fromEnv ? path.resolve(fromEnv) : path.join(root, "_workspace");
  return path.join(base, "test-runs", `${Date.now()}-${process.pid}`);
}

function relTo(root, file) {
  const abs = path.resolve(root, file);
  if (!isInside(abs, root)) throw fail(`${file} is outside the project`);
  return toSlash(path.relative(root, abs));
}

// The verb. files empty: the configured suite once. Otherwise each file, serially, under the lock.
export async function testRun(g, files = []) {
  const { cfg, codeRoot: root } = g;
  const cmds = cfg.adapter.commands;
  const { argv: command, caseTimeoutS } = testCommandOf(cfg);
  if (!command?.length) throw fail("tests not configured (adapter.commands.test)");
  let list = [];
  try { list = files.map((f) => relTo(root, f)); } catch (e) { throw e instanceof Error && e.exitCode ? e : fail(e.message); }
  const fileTimeout = fileTimeoutS(cmds);
  const timeoutS = list.length ? fileTimeout : cmds.test_timeout_s;
  const isTest = await loadIsTest(cfg.adapter.checks ?? {});
  const lock = testLockName(root, cfg);
  const dir = runDirOf(root, g.env);
  fs.mkdirSync(dir, { recursive: true });
  const argvs = list.length ? list.map((f) => [...command, f]) : [command];
  const rows = [];
  let waited = false;
  await withMutex(lock, async () => {
    for (const [i, argv] of argvs.entries()) {
      const file = list[i] ?? null;
      const r = await runBoundedTests({ cwd: root, argv, files: [], timeoutS, fileTimeoutS: fileTimeout, isTest });
      const named = file || r.hungFile || (r.timedOut ? lastTestFile(`${r.stdout ?? ""}\n${r.stderr ?? ""}`, isTest) : null);
      const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error}` : ""}${r.timedOut && named ? `\nhung test file: ${named} (killed after ${timeoutS}s)\n` : ""}`;
      const logName = `${safeName(named || "suite")}.log`;
      const logAbs = path.join(dir, logName);
      writeTextAtomic(logAbs, text.endsWith("\n") ? text : `${text}\n`);
      const outcome = r.timedOut ? "hung" : r.error && r.code === null ? "unavailable" : r.code === 0 ? "passed" : "failed";
      const log = isInside(logAbs, root) ? toSlash(path.relative(root, logAbs)) : toSlash(logAbs);
      rows.push({
        file: named,
        outcome,
        exitCode: r.timedOut ? TIMEOUT_CODE : r.code,
        hung: outcome === "hung",
        log,
        summary: failureSummary(text),
      });
      if (r.timedOut || (r.error && r.code === null)) break;
    }
  }, { log: () => { waited = true; } });
  const hung = rows.filter((row) => row.outcome === "hung").map((row) => row.file).filter(Boolean);
  const failed = rows.some((row) => row.outcome !== "passed");
  const lines = [`test-run ${rows.length} file(s), lock ${lock}${waited ? " (waited)" : ""}${caseTimeoutS ? `, per-test timeout ${caseTimeoutS}s` : ""}`];
  for (const row of rows) {
    const where = row.file ?? "(suite)";
    lines.push(row.outcome === "hung" ? `${where}: hung (killed after ${timeoutS}s)` : `${where}: ${row.outcome}${row.exitCode === null ? "" : ` (exit ${row.exitCode})`}`);
    if (row.summary) lines.push(...row.summary.split("\n").map((l) => `  ${l}`));
    lines.push(`  log: ${row.log}`);
  }
  g.write(`${lines.join("\n")}\n`);
  return done({ status: failed ? "failed" : "passed", lock, fileTimeoutS: fileTimeout, caseTimeoutS, hung, files: rows }, failed ? 1 : 0);
}

