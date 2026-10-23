#!/usr/bin/env node
// Syntax-check shell (PreToolUse and PostToolUse on edit tools, HOOK-26..28): the checker per extension comes from
// `adapter.syntax_checkers` of the tree that holds the edited file; the kit ships no checker (D-45, D-110). Pre stores
// each target's status, Post checks again and reports only newly broken files. Never blocks.
// INV-27: a batch edit once held an agent 15 min and some runtimes ignore hook timeouts, hence the hook-wide budget
// below the 90 s registration timeout and the machine-wide slot cap; worktree edits were once skipped because the
// checker was taken from the session cwd, hence the per-file tree.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configLoader, contextOutput, DAY_MS, firstLine, harnessModule, hookRoot, isScript, publishExclusive, pruneOlderThan, readJsonFile, readTextFile, runHook, sha256, targetPaths } from "./lib/hook_common.mjs";

export { targetPaths };

const STARTED_AT = Date.now() - process.uptime() * 1000;
export const LIMITS = Object.freeze({ budgetMs: 75_000, minStartMs: 10_000, slotWaitMs: 20_000, slotStaleMs: 180_000 });
const DEFAULT_MAX_PARALLEL = 3;
const MAX_DIAGNOSTICS = 6;
const NOT_CHECKED = " (not checked before this edit)";
const DIAGNOSTIC_RE = /^(.+?):(\d+):(\d+): (.+)$/;
const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

// `toAbsolute` is the file tools' own path rule (FTOL-18: `~`, Git Bash `/c/...`, cwd), so Pre, Post and the writer
// name the same file (CR-HOK-02).
export function collectTargets(paths, cwd, toAbsolute) {
  const seen = new Map();
  for (const p of paths) {
    const abs = toAbsolute(p, cwd);
    if (!seen.has(fold(abs))) seen.set(fold(abs), abs);
  }
  return [...seen.values()];
}

// HOOK-28: nearest ancestor holding the config overlay (a worktree has its own), else the hook root.
export function owningTree(file, fallbackRoot, overlayRel) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, overlayRel))) return dir;
    if (path.dirname(dir) === dir) return fallbackRoot;
  }
}

function checkerFor(checkers, file) {
  const ext = path.extname(file).toLowerCase();
  if (!ext) return null;
  const key = Object.keys(checkers ?? {}).find((k) => k.toLowerCase() === ext);
  return key ? checkers[key] : null;
}

export function parseDiagnostics(text) {
  return String(text).split(/\r?\n/).filter((line) => DIAGNOSTIC_RE.test(line.trim())).map((line) => line.trim());
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A guard older than the stale bound was left by a reclaimer that died between creating and removing it. One waiter
// renames it away and then claims as usual; the token check in removeLock still keeps a successor's slot (CR-HOK-03).
function claimGuard(guard, olderThanMs) {
  const create = () => {
    try {
      fs.writeFileSync(guard, "", { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  };
  if (create()) return true;
  try {
    if (olderThanMs < 0 || Date.now() - fs.statSync(guard).mtimeMs <= olderThanMs) return false;
    const taken = `${guard}.${randomUUID()}`;
    fs.renameSync(guard, taken);
    fs.rmSync(taken, { force: true });
  } catch {
    return false;
  }
  return create();
}

// Machine-wide slot cap per checker (HOOK-27): a slot is a lock published whole by an exclusive link and holding
// its acquirer's unique token. Only the winner of `<lock>.reclaim-<token>` may remove the lock of that token, the
// owner on release or anyone once it is stale; the token never recurs, so a late release or a reclaim based on an
// old look never frees a successor's slot (CR-HOK-03).
export function removeLock(lock, token, olderThanMs = -1) {
  const guard = `${lock}.reclaim-${token}`;
  if (!claimGuard(guard, olderThanMs)) return;
  try {
    if (readTextFile(lock) === token && Date.now() - fs.statSync(lock).mtimeMs > olderThanMs) fs.rmSync(lock);
  } catch {
  } finally {
    fs.rmSync(guard, { force: true });
  }
}

export async function acquireSlot(dir, max, deadline, staleMs) {
  fs.mkdirSync(dir, { recursive: true });
  const token = randomUUID();
  for (;;) {
    for (let i = 0; i < max; i++) {
      const lock = path.join(dir, `slot-${i}.lock`);
      try {
        if (publishExclusive(lock, token)) return () => removeLock(lock, token);
      } catch {
        return null;
      }
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) removeLock(lock, readTextFile(lock), staleMs);
      } catch {}
    }
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(100, deadline - Date.now()));
  }
}

// HOOK-27: the checker's own files inside its tree (its script, the config it names) are part of its identity, so
// replacing one in place at the same argv invalidates its cached results. Files outside the tree are not read.
function checkerFiles(tree, argv) {
  return argv.flatMap((arg) => {
    const abs = path.resolve(tree, arg);
    const rel = path.relative(tree, abs);
    if (path.isAbsolute(rel) || rel.split(path.sep)[0] === "..") return [];
    try {
      return [[rel, sha256(fs.readFileSync(abs))]];
    } catch {
      return [];
    }
  });
}

function createChecker(ctx) {
  const { stateDir, limits, runArgv } = ctx;
  const budgetEnd = ctx.startedAt + limits.budgetMs;
  const cacheDir = path.join(stateDir, "cache");

  // Outcome: pass | fail (cached), absent, skip (budget or slots), error (infrastructure; never reported or cached).
  return async function check(target) {
    const { file, tree, checker } = target;
    let content;
    try {
      content = fs.readFileSync(file);
    } catch {
      return { status: "absent" };
    }
    const identity = [checker.argv, checker.timeout_s ?? null, sha256(JSON.stringify(checker)), checkerFiles(tree, checker.argv)];
    const cacheFile = path.join(cacheDir, `${sha256(JSON.stringify([fold(tree), fold(file), identity, sha256(content)]))}.json`);
    try {
      return readJsonFile(cacheFile);
    } catch {}
    if (budgetEnd - Date.now() < limits.minStartMs) return { status: "skip" };
    const slots = path.join(stateDir, `slots-${sha256(JSON.stringify(checker.argv)).slice(0, 24)}`);
    const deadline = Math.min(Date.now() + limits.slotWaitMs, budgetEnd - limits.minStartMs);
    const release = await acquireSlot(slots, checker.max_parallel ?? DEFAULT_MAX_PARALLEL, deadline, limits.slotStaleMs);
    if (!release) return { status: "skip" };
    let r;
    try {
      const remaining = budgetEnd - Date.now();
      if (remaining < limits.minStartMs) return { status: "skip" };
      const timeoutMs = Math.min(checker.timeout_s ? checker.timeout_s * 1000 : remaining, remaining);
      r = await runArgv([...checker.argv, file], { cwd: tree, timeoutMs });
    } finally {
      release();
    }
    if (r.error || r.timedOut || r.code === null) return { status: "error" };
    const diagnostics = parseDiagnostics(`${r.stdout}\n${r.stderr}`);
    let result;
    if (r.code === 0) result = { status: "pass" };
    else if (diagnostics.length) result = { status: "fail", diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) };
    else return { status: "error" };
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(result), "utf8");
    } catch {}
    return result;
  };
}

// Each target paired with its tree's checker; targets without one are dropped before anything is spawned.
async function resolveTargets(files, root, loadConfig, overlayRel) {
  const configs = new Map();
  let warning = null;
  const out = [];
  for (const file of files) {
    const tree = owningTree(file, root, overlayRel);
    if (!configs.has(fold(tree))) {
      try {
        configs.set(fold(tree), loadConfig(tree).adapter.syntax_checkers);
      } catch (e) {
        warning ??= firstLine(e);
        configs.set(fold(tree), {});
      }
    }
    const checker = checkerFor(configs.get(fold(tree)), file);
    if (checker) out.push({ file, tree, checker });
  }
  return { targets: out, warning };
}

const preFile = (stateDir, input) => path.join(stateDir, `pre-${sha256(`${input.session_id ?? "x"}|${input.tool_use_id ?? "x"}`).slice(0, 32)}.json`);

function readPre(file) {
  try {
    return readJsonFile(file);
  } catch {
    return {};
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export async function runSyntaxCheck(input, {
  env = process.env,
  stateDir = path.join(os.tmpdir(), "ph-syntax-check"),
  limits = LIMITS,
  startedAt = STARTED_AT,
} = {}) {
  const event = input.hook_event_name ?? ("tool_response" in input ? "PostToolUse" : "PreToolUse");
  const paths = targetPaths(input, event);
  if (!paths.length) return null;
  const root = hookRoot(input, env);
  const loadConfig = await configLoader(root);
  const { absolutePath } = await harnessModule(root, "files/targets.mjs");
  const files = collectTargets(paths, input.cwd || process.cwd(), absolutePath);
  const { OVERLAY_REL } = await harnessModule(root, "config.mjs");
  const { targets, warning } = await resolveTargets(files, root, loadConfig, OVERLAY_REL);
  if (!targets.length) return warning ? { warning } : null;
  const { runArgv } = await harnessModule(root, "lib/proc.mjs");
  fs.mkdirSync(stateDir, { recursive: true });
  pruneOlderThan(stateDir, DAY_MS, (name) => name.startsWith("pre-"));
  const check = createChecker({ stateDir, limits, runArgv, startedAt });
  const results = await Promise.all(targets.map(check));
  const pre = preFile(stateDir, input);

  if (event === "PreToolUse") {
    const status = Object.fromEntries(targets.map((t, i) => [fold(t.file), results[i].status]));
    fs.writeFileSync(pre, JSON.stringify(status), "utf8");
    return warning ? { warning } : null;
  }
  const before = readPre(pre);
  const reports = [];
  targets.forEach((t, i) => {
    const was = before[fold(t.file)];
    if (results[i].status !== "fail" || was === "fail") return;
    const known = was === "pass" || was === "absent";
    reports.push(`${t.file}${known ? "" : NOT_CHECKED}:`, ...results[i].diagnostics.map((d) => `  ${d}`));
  });
  const output = reports.length
    ? contextOutput("PostToolUse", `Syntax check found new errors after this edit:\n${reports.join("\n")}`)
    : null;
  return output || warning ? { output, warning } : null;
}

if (isScript(import.meta.url)) await runHook("syntax check", (input) => runSyntaxCheck(input));
