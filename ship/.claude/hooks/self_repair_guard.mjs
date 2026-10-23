#!/usr/bin/env node
// Self-repair guard (PreToolUse on edit tools, kit feedback 87 C2): an agent started by a workflow run may not edit
// kit, harness or composition files (`.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` of its tree), and no other
// session may edit a composition script or the overlay while a workflow run of the project is live. Without the
// boundary the cheapest way past a red gate is to relax it; the harness changes between runs through harness-evolve.
// The only kit hook that denies a call. An internal error allows it (a hook must not wedge a session); a config that
// does not load does not open the boundary.
import fs from "node:fs";
import path from "node:path";
import { harnessModule, HookConfigError, hookRoot, isScript, loadHookConfig, readTextFile, runHook, targetPaths } from "./lib/hook_common.mjs";

// The runtime marks every agent a workflow run creates (paseo-client createAgent).
export const RUN_ENV = "PASEO_HARNESS_RUN";
export const HEAD_BYTES = 2 * 1024 * 1024;
// The run tag ends every workflow prompt (runtime/prompts.mjs, workflow/runner.mjs); a daemon that relaunches an agent
// drops its creation env, the transcript keeps the tag.
const RUN_TAG = /(?:^|\n)(?:- )?Run (\S+) #\d+ \(bookkeeping only; ignore\)\.\s*$/;
// The role turn of a two-turn primed agent (workflow/runtime-bridge.mjs READY_LINE); its task, with the tag, comes next.
const READY_LINE = "This message only loads your role. Reply with the single word READY; your task comes in the next message.";
const DEFAULTS = Object.freeze({ enabled: true, allow: [] });
// Overlay keys a live run reads again on purpose (F45B live retier): an edit of these alone is no composition change.
const RETIER_KEYS = new Set(["tiers", "tier_aliases", "default_tier"]);
const REPLAYABLE = new Set(["Edit", "MultiEdit", "Write"]);

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const samePath = (a, b) => fold(path.resolve(a)) === fold(path.resolve(b));
const toSlash = (p) => p.split(path.sep).join("/");

function promptTexts(content) {
  if (typeof content === "string") return content ? [content] : null;
  if (!Array.isArray(content) || !content.length || content.some((b) => b?.type === "tool_result")) return null;
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text);
}

// The run id in the first prompt of a transcript (the second when the first only primes the role), else null.
export function runTagOf(head) {
  for (const line of String(head).split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.type !== "user" || e.isMeta || e.isSidechain) continue;
    const texts = promptTexts(e.message?.content);
    if (!texts) continue;
    const tag = texts.map((t) => RUN_TAG.exec(t)?.[1]).find(Boolean);
    if (tag) return tag;
    if (!texts.some((t) => t.trimEnd().endsWith(READY_LINE))) return null;
  }
  return null;
}

export function readHeadText(file, bytes = HEAD_BYTES) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, bytes));
    return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** The workflow run that started this session: {runId, via: env|transcript}, or null. */
export function workflowRunOf(input, env = process.env, readHead = readHeadText) {
  const fromEnv = String(env[RUN_ENV] ?? "").trim();
  if (fromEnv) return { runId: fromEnv, via: "env" };
  if (!input.transcript_path) return null;
  try {
    const runId = runTagOf(readHead(input.transcript_path));
    return runId ? { runId, via: "transcript" } : null;
  } catch {
    return null;
  }
}

// The tree a file belongs to: the nearest ancestor holding `.git` (a worktree under .claude/worktrees is its own
// tree) or the project root, whichever comes first; null outside both.
export function treeOf(file, root) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (samePath(dir, root) || fs.existsSync(path.join(dir, ".git"))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

export function isProtectedRel(rel) {
  const segs = fold(rel).split("/");
  return segs[0] === ".agents" || segs[0] === ".claude" || (segs.length === 1 && (segs[0] === "agents.md" || segs[0] === "claude.md"));
}

// A top-level workflow script (the project's composition) or the overlay (config.mjs OVERLAY_REL).
export const isCompositionRel = (rel, overlayRel) => fold(rel) === fold(overlayRel) || /^\.agents\/workflows\/[^/]+\.js$/.test(fold(rel));

const globMatch = (rel, glob) => path.posix.matchesGlob(rel, glob) || (glob.endsWith("/**") && rel === glob.slice(0, -3));

// Each target as {shown, rel, atRoot} per spelling (as given and through links); a target outside every tree is dropped.
export function classifyTargets(paths, { cwd, root, absolutePath, canonicalPath }) {
  const out = [];
  for (const p of paths) {
    let abs;
    try {
      abs = absolutePath(p, cwd);
    } catch {
      continue;
    }
    let real = abs;
    try {
      real = canonicalPath(abs);
    } catch {}
    const spellings = samePath(real, abs) ? [abs] : [abs, real];
    const views = spellings.map((file) => {
      const tree = treeOf(file, root);
      return tree ? { rel: toSlash(path.relative(tree, file)), atRoot: samePath(tree, root) } : null;
    }).filter((v) => v && v.rel && !v.rel.startsWith(".."));
    if (views.length) out.push({ shown: p, views });
  }
  return out;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => sameValue(a[k], b[k]));
}

// True when `after` differs from `before` only in the tiers, their aliases, the default tier or the GSD roles.
export function retierOnly(beforeText, afterText) {
  let before;
  let after;
  try {
    before = beforeText === null ? {} : JSON.parse(beforeText.replace(/^﻿/, ""));
    after = JSON.parse(String(afterText).replace(/^﻿/, ""));
  } catch {
    return false;
  }
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) return false;
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (RETIER_KEYS.has(k) || sameValue(before[k], after[k])) continue;
    if (k !== "gsd" || !isObj(before.gsd ?? {}) || !isObj(after.gsd ?? {})) return false;
    const { roles: _a, ...restBefore } = before.gsd ?? {};
    const { roles: _b, ...restAfter } = after.gsd ?? {};
    if (!sameValue(restBefore, restAfter)) return false;
  }
  return true;
}

function replaceOnce(text, oldText, newText, all) {
  if (typeof text !== "string" || typeof oldText !== "string" || typeof newText !== "string" || !oldText || !text.includes(oldText)) return null;
  if (all) return text.split(oldText).join(newText);
  const at = text.indexOf(oldText);
  return text.slice(0, at) + newText + text.slice(at + oldText.length);
}

// The overlay text a native Edit, MultiEdit or Write would leave; null when it cannot be replayed here.
export function overlayAfter(toolName, toolInput, current) {
  const i = toolInput ?? {};
  if (toolName === "Write") return typeof i.content === "string" ? i.content : null;
  if (current === null) return null;
  if (toolName === "Edit") return replaceOnce(current, i.old_string, i.new_string, i.replace_all === true);
  if (toolName === "MultiEdit" && Array.isArray(i.edits)) {
    return i.edits.reduce((text, e) => (text === null ? null : replaceOnce(text, e?.old_string, e?.new_string, e?.replace_all === true)), current);
  }
  return null;
}

const readIf = (file) => {
  try {
    return readTextFile(file);
  } catch {
    return null;
  }
};

const denyOutput = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

// Model-facing texts (INV-49: wording changes only with owner review).
export const MSG = {
  workflowAgent: (runId, files) => `Self-repair boundary (kit feedback 87): this agent was started by workflow run ${runId}, and workflow agents may not edit kit, harness or composition files (.agents/, .claude/, AGENTS.md, CLAUDE.md): ${files.join(", ")}. Do not make the change another way (shell or another tool); finish the task without it and name the change you need in your final reply. The owner changes the harness between runs through harness-evolve.`,
  liveRun: (run, files, ph, overlay) => `Self-repair boundary (kit feedback 87): workflow run ${run.runId} of this project is live (runner pid ${run.pid}), and ${files.join(", ")} ${files.length > 1 ? "are" : "is"} the composition or harness config it runs on. Wait for the run to end (\`${ph} watch-run ${run.runId}\`) or stop it (\`${ph} archive --run ${run.runId} --reason <text>\`), then make the change between runs through harness-evolve.${overlay ? ` A tier change alone (tiers, tier_aliases, default_tier, gsd.roles) is allowed with native Edit or Write; \`${ph} model ${run.runId} <tier>\` switches the run's live agents now.` : ""}`,
};

// The newest run of the project whose run.json says running and whose runner is alive (default runs dir only).
export function liveRunOf(root, { runsRel, runFile, readJsonIf, pidAlive }) {
  const dir = path.join(root, runsRel);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names.sort().reverse()) {
    let info = null;
    try {
      info = readJsonIf(path.join(dir, name, runFile));
    } catch {}
    if (info?.status === "running" && pidAlive(info.pid)) return { runId: info.runId ?? name, pid: info.pid };
  }
  return null;
}

/** deps (tests): {env, loadConfig, readHead, pidAlive}. Returns null or {output, warning}. */
export async function runSelfRepairGuard(input, { env = process.env, loadConfig = loadHookConfig, readHead = readHeadText, pidAlive } = {}) {
  if ((input.hook_event_name ?? "PreToolUse") !== "PreToolUse") return null;
  const paths = targetPaths(input, "PreToolUse");
  if (!paths.length) return null;
  const root = hookRoot(input, env);
  const { absolutePath, canonicalPath } = await harnessModule(root, "files/targets.mjs");
  const targets = classifyTargets(paths, { cwd: input.cwd ?? root, root, absolutePath, canonicalPath });
  const guarded = targets.filter((t) => t.views.some((v) => isProtectedRel(v.rel)));
  if (!guarded.length) return null;

  let cfg = DEFAULTS;
  let warning = null;
  try {
    cfg = (await loadConfig(input, env)).self_repair ?? DEFAULTS;
  } catch (e) {
    if (!(e instanceof HookConfigError)) throw e;
    warning = e.message;
  }
  if (!cfg.enabled) return warning ? { warning } : null;

  const run = workflowRunOf(input, env, readHead);
  if (run) {
    // Every protected spelling of a target (as given, through links) must be allowed.
    const allowed = (rel) => cfg.allow.some((g) => globMatch(fold(rel), fold(g)));
    const denied = guarded.filter((t) => t.views.some((v) => isProtectedRel(v.rel) && !allowed(v.rel)));
    return denied.length ? { output: denyOutput(MSG.workflowAgent(run.runId, denied.map((t) => t.shown))), warning } : warning ? { warning } : null;
  }

  const { OVERLAY_REL } = await harnessModule(root, "config.mjs");
  const composition = guarded.filter((t) => t.views.some((v) => v.atRoot && isCompositionRel(v.rel, OVERLAY_REL)));
  if (!composition.length) return warning ? { warning } : null;
  const [{ DEFAULT_RUNS_DIR, RUN_FILES }, io, proc, { phCommand }] = await Promise.all([
    harnessModule(root, "workflow/journal.mjs"), harnessModule(root, "lib/io.mjs"), harnessModule(root, "lib/proc.mjs"), harnessModule(root, "lib/cli.mjs"),
  ]);
  const live = liveRunOf(root, { runsRel: DEFAULT_RUNS_DIR, runFile: RUN_FILES.run, readJsonIf: io.readJsonIf, pidAlive: pidAlive ?? proc.pidAlive });
  if (!live) return warning ? { warning } : null;
  const isOverlay = (t) => t.views.some((v) => v.atRoot && fold(v.rel) === fold(OVERLAY_REL));
  const denied = composition.filter((t) => {
    if (!isOverlay(t) || !REPLAYABLE.has(input.tool_name)) return true;
    const file = path.join(root, OVERLAY_REL);
    const current = readIf(file);
    return !retierOnly(current, overlayAfter(input.tool_name, input.tool_input, current));
  });
  if (!denied.length) return warning ? { warning } : null;
  return { output: denyOutput(MSG.liveRun(live, denied.map((t) => t.shown), phCommand(), denied.some(isOverlay))), warning };
}

if (isScript(import.meta.url)) await runHook("self-repair guard", (input) => runSelfRepairGuard(input));
