#!/usr/bin/env node
// io guard (PreToolUse on file tools, PostToolUse on lookups): just-in-time reminders of the AGENTS.md File I/O rules,
// for every session (HOOK-13..25). A round is one assistant message; its parallel tool calls share the message id.
// The in-flight round never counts as a previous round, so parallel siblings do not count each other. Every
// PreToolUse reminder is claimed by an exclusive-create file, so the hooks of one parallel round speak once; a
// process that dies after its claim loses that one reminder (no recovery, HOOK-20).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changedPathsInResult, contextOutput, DAY_MS, isScript, loadHookConfig, pruneOlderThan, readTailText, resultText, runHook, sha256 } from "./lib/hook_common.mjs";

const HF = "mcp__harness-files__";
const list = (v) => (Array.isArray(v) ? v : []);

// HOOK-13: the one table of file tools and the input fields that name their files.
export const TOOLS = {
  Read: { kind: "lookup", reads: (i) => (i.limit === 1 ? [] : [i.file_path]) },
  Grep: { kind: "lookup", result: true },
  Glob: { kind: "lookup", result: true },
  [`${HF}read_ranges`]: { kind: "lookup", reads: (i) => list(i.ranges).map((r) => r?.path) },
  Edit: { kind: "mutating", edits: (i) => [i.file_path] },
  MultiEdit: { kind: "mutating", edits: (i) => [i.file_path] },
  Write: { kind: "mutating", edits: (i) => [i.file_path] },
  NotebookEdit: { kind: "mutating", edits: (i) => [i.notebook_path] },
  [`${HF}edit_multiple_files`]: { kind: "mutating", edits: (i) => list(i.files).map((f) => f?.path), replyLines: true },
  [`${HF}write_multiple_files`]: { kind: "mutating", edits: (i) => list(i.files).map((f) => f?.path), replyLines: true },
};
const toolOf = (name) => (Object.hasOwn(TOOLS, name) ? TOOLS[name] : null);

const PREFIX = "File I/O (AGENTS.md): ";
const WITH_MOD = "when the harness-files tools are available, else native Read/Edit";
const BATCH_HOW = `one Grep with alternation, one Glob with a single brace group, and ${HF}read_ranges for several files ${WITH_MOD}`;
// HOOK-23: model-facing texts, at most three sentences each; wording changes only with owner review (INV-49).
export const MSG = {
  firstLookup: `${PREFIX}first file lookup of this task. List everything the task needs and cover it in as few rounds as possible: ${BATCH_HOW}. Add a round only for targets the results in hand make necessary.`,
  firstEdit: `${PREFIX}first edit of this task. Think through every change first, then apply them all in one turn: ${HF}edit_multiple_files takes edits to several files in one call ${WITH_MOD}.`,
  lookupStreak: (n) => `${PREFIX}this is lookup round ${n} in a row with nothing edited in between. Collect what is still missing in one batched call (${BATCH_HOW}), then decide or edit. Batch any further round the results in hand make necessary.`,
  editStreak: (n) => `${PREFIX}this is edit round ${n} in a row with nothing looked up in between. Apply the remaining changes in one call: ${HF}edit_multiple_files for edits and ${HF}write_multiple_files for new files ${WITH_MOD}.`,
  reread: (files) => `${PREFIX}${files.join(", ")} was edited earlier in this task. Edit and Write error when a change fails, so do not re-read the file to verify it; run the checks the task names. Read it again only for parts you have not seen yet.`,
  empty: `${PREFIX}empty result. Suspect the query before concluding the target does not exist: Glob syntax (one brace group, no nesting, no spaces), search root, case, regex escaping. Fix the pattern inside the next batched call instead of adding a separate round.`,
  truncated: `${PREFIX}truncated result. Narrow the path or the pattern, or set head_limit and offset on Grep, in the next batched call; do not repeat the same wide listing.`,
};
const EMPTY_RE = /\b(No files found|No matches found)\b/i;
const TRUNCATED_RE = /\(Showing \d+ of \d+|more are not listed|with pagination = limit/i;

// HOOK-18: backslashes, relative to the hook cwd, dot segments, lower case.
export function normPath(p, cwd) {
  let s = String(p).replace(/\\/g, "/");
  if (cwd && !/^([a-z]:)?\//i.test(s)) s = `${String(cwd).replace(/\\/g, "/")}/${s}`;
  return path.posix.normalize(s).toLowerCase();
}
const normAll = (values, cwd) => values.filter((v) => typeof v === "string" && v).map((p) => normPath(p, cwd));

function isUserPrompt(entry) {
  const c = entry.message?.content;
  if (typeof c === "string") return c.length > 0;
  return Array.isArray(c) && c.length > 0 && !c.some((b) => b?.type === "tool_result");
}

// HOOK-14: rounds of the current prompt from the transcript tail.
export function scanTranscript(text, cwd) {
  let rounds = [];
  let byMessage = new Map();
  const byToolUse = new Map();
  const resultIds = new Set();
  let promptKey = "tail-start";
  for (const [i, line] of text.split("\n").entries()) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || e.isSidechain || e.isMeta) continue;
    if (e.type === "user") {
      if (isUserPrompt(e)) {
        rounds = [];
        byMessage = new Map();
        promptKey = String(e.uuid ?? e.timestamp ?? `line${i}`);
        continue;
      }
      for (const b of list(e.message?.content)) {
        if (b?.type !== "tool_result") continue;
        resultIds.add(b.tool_use_id);
        const use = byToolUse.get(b.tool_use_id);
        // Fix-only calls of the mod name their files only in the reply (HOOK-18).
        if (use?.tool.replyLines) use.round.edited.push(...normAll(changedPathsInResult(resultText(b.content)), cwd));
      }
      continue;
    }
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    const id = e.message.id ?? e.uuid;
    for (const b of e.message.content) {
      if (b?.type !== "tool_use") continue;
      let round = byMessage.get(id);
      if (!round) {
        round = { toolUseIds: new Set(), lookup: false, mutating: false, fileCalls: 0, edited: [] };
        byMessage.set(id, round);
        rounds.push(round);
      }
      round.toolUseIds.add(b.id);
      const tool = toolOf(b.name);
      if (!tool) continue;
      round.fileCalls++;
      if (tool.kind === "lookup") round.lookup = true;
      else {
        round.mutating = true;
        round.edited.push(...normAll(tool.edits(b.input ?? {}), cwd));
        byToolUse.set(b.id, { tool, round });
      }
    }
  }
  const finished = (r) => [...r.toolUseIds].every((id) => resultIds.has(id));
  const inFlight = rounds.filter((r) => !finished(r));
  return { previous: rounds.filter(finished), inFlightFileCalls: inFlight.reduce((n, r) => n + r.fileCalls, 0), promptKey };
}

function lookupStreak(previous) {
  let n = 0;
  for (let i = previous.length - 1; i >= 0; i--) {
    if (previous[i].mutating) break;
    if (previous[i].lookup) n++;
  }
  return n;
}

function editStreak(previous) {
  let n = 0;
  for (let i = previous.length - 1; i >= 0; i--) {
    if (!previous[i].mutating || previous[i].lookup) break;
    n++;
  }
  return n;
}

const bandOf = (n, start, step) => (n < start ? -1 : Math.floor((n - start) / step));

// HOOK-20: creating the claim file is permission to speak; any error means silence.
function claim(dir, key) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, sha256(key).slice(0, 32)), "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export const claimDir = (sessionId, tmpDir = os.tmpdir()) => path.join(tmpDir, `ph-io-guard-${sha256(sessionId ?? "x").slice(0, 24)}`);

// HOOK-15..18, HOOK-21: messages in the fixed order first-round, lookup streak, edit streak, reread.
export function preMessages(input, cfg, dir, transcriptText) {
  const { previous, inFlightFileCalls, promptKey } = scanTranscript(transcriptText, input.cwd);
  const tool = toolOf(input.tool_name);
  const isLookup = tool.kind === "lookup";
  const out = [];

  if (!previous.some((r) => r.lookup || r.mutating) && claim(dir, `first|${promptKey}`)) {
    pruneOlderThan(dir, DAY_MS);
    if (inFlightFileCalls < 2) out.push(isLookup ? MSG.firstLookup : MSG.firstEdit);
  }
  if (isLookup) {
    const n = lookupStreak(previous) + 1;
    const band = bandOf(n, cfg.start_rounds, cfg.step_rounds);
    const segment = previous.filter((r) => r.mutating).length;
    if (band >= 0 && claim(dir, `lookup|${promptKey}|${segment}|${band}`)) out.push(MSG.lookupStreak(n));
  } else {
    const run = editStreak(previous);
    const n = run + 1;
    const band = bandOf(n, cfg.edit_start_rounds, cfg.edit_step_rounds);
    if (band >= 0 && claim(dir, `edit|${promptKey}|${previous.length - run}|${band}`)) out.push(MSG.editStreak(n));
  }
  if (isLookup && tool.reads) {
    const edited = new Set(previous.flatMap((r) => r.edited));
    const hit = [...new Set(normAll(tool.reads(input.tool_input ?? {}), input.cwd))].filter((p) => edited.has(p));
    if (hit.length && claim(dir, `reread|${promptKey}|${hit.join("|")}`)) out.push(MSG.reread(hit));
  }
  return out;
}

function isEmptyResult(r, text) {
  if (r && typeof r === "object") {
    const hasContent = typeof r.content === "string" && r.content.trim() !== "";
    if (r.numFiles === 0 && !hasContent && list(r.filenames).length === 0 && !(r.numLines > 0)) return true;
  }
  return text.length < 200 && EMPTY_RE.test(text);
}

// HOOK-19: no claim; speaks on every empty or truncated Grep/Glob result.
export function postMessages(input) {
  if (!toolOf(input.tool_name)?.result) return [];
  const r = input.tool_response;
  const text = typeof r === "string" ? r : JSON.stringify(r ?? "");
  if (r?.truncated === true || TRUNCATED_RE.test(text.slice(-600))) return [MSG.truncated];
  if (isEmptyResult(r, text)) return [MSG.empty];
  return [];
}

// HOOK-21, HOOK-25: no identity check; PostToolUse needs neither transcript nor config.
export async function runIoGuard(input, { env = process.env, tmpDir = os.tmpdir(), loadConfig = loadHookConfig, readTail = readTailText } = {}) {
  if (!toolOf(input.tool_name)) return null;
  const event = input.hook_event_name ?? ("tool_response" in input ? "PostToolUse" : "PreToolUse");
  let out = [];
  if (event === "PostToolUse") out = postMessages(input);
  else if (input.transcript_path) {
    const cfg = (await loadConfig(input, env)).io_guard;
    out = preMessages(input, cfg, claimDir(input.session_id, tmpDir), readTail(input.transcript_path));
  }
  return out.length ? { output: contextOutput(event, out.join("\n")) } : null;
}

if (isScript(import.meta.url)) await runHook("io guard", (input) => runIoGuard(input));
