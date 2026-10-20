#!/usr/bin/env node
// Context guard (PostToolUse `*`, UserPromptSubmit): reminds the main session to compact itself at start_pct of its
// window and every step_pct above it. A reminder, never a compaction (HOOK-06..12).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contextOutput, DAY_MS, isScript, loadHookConfig, pruneOlderThan, readJsonFile, readTailText, runHook, sha256 } from "./lib/hook_common.mjs";

const STATE_PREFIX = "ph-context-guard-";

// HOOK-06: identity by role; agent_type is not identity (a main session started with --agent carries it) and the model
// name plays no part.
export function isMainSession(input, env = process.env) {
  return !input.agent_id && !input.agentId && !input.parent_agent_id
    && !env.PASEO_HARNESS_LEADER && env.PASEO_HARNESS_ROLE !== "worker";
}

// HOOK-07: newest main-thread assistant usage in the transcript tail; sidechain, child and synthetic lines are skipped.
export function lastUsage(tailText) {
  const lines = tailText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const m = e?.message;
    if (e?.type !== "assistant" || e.isSidechain || e.agentId || !m?.usage || m.model === "<synthetic>") continue;
    const u = m.usage;
    const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (!Number.isFinite(used) || used < 0) continue;
    return { used, window: u.context_window ?? u.contextWindowMaxTokens ?? null };
  }
  return null;
}

// HOOK-08: the reported window wins; the configured window_tokens is the fallback.
export function contextBand(used, cfg, window = null) {
  const size = Number.isFinite(window) && window > 0 ? window : cfg.window_tokens;
  if (!(Number.isFinite(size) && size > 0 && Number.isFinite(cfg.step_pct) && cfg.step_pct > 0
    && Number.isFinite(cfg.start_pct) && cfg.start_pct > 0 && cfg.start_pct <= 100)) {
    throw new Error("context_guard needs a positive window and step, and start_pct between 0 and 100");
  }
  const pct = (100 * used) / size;
  return { pct, window: size, band: pct < cfg.start_pct ? -1 : Math.floor((pct - cfg.start_pct) / cfg.step_pct) };
}

export function reminderText({ pct, used, window }, cfg) {
  return `Context guard: this main session uses ${Math.round(pct)}% of its context (${used}/${window} tokens; threshold ${cfg.start_pct}%). `
    + "At the next natural break (no edit half-done, no background job or Monitor still running), compact yourself: "
    + 'run `node .agents/harness/ph.mjs compact-self --focus "<what to keep>"` and end the turn. '
    + `You will be reminded again at the next ${cfg.step_pct}% step.`;
}

function readState(dir) {
  try {
    const s = readJsonFile(path.join(dir, "state.json"));
    if (Number.isInteger(s.band) && Number.isInteger(s.epoch)) return s;
  } catch {}
  return { band: -1, epoch: 0 };
}

// Best effort: a lost state write only means the claim files decide (a claimed band stays silent).
function writeState(dir, state) {
  const tmp = path.join(dir, `state.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(state), "utf8");
    fs.renameSync(tmp, path.join(dir, "state.json"));
  } catch {
    fs.rmSync(tmp, { force: true });
  }
}

// HOOK-09: the decision to remind is one exclusive create of `claim-e<epoch>-b<band>`; a downward move lowers the
// stored band and opens a new epoch, so a later climb claims fresh names. No PID or mtime recovery: a crash after the
// claim loses that one reminder.
export function claimBand(dir, band) {
  fs.mkdirSync(dir, { recursive: true });
  const state = readState(dir);
  if (band < state.band) {
    writeState(dir, { band, epoch: state.epoch + 1 });
    return false;
  }
  if (band === state.band || band < 0) return false;
  try {
    fs.writeFileSync(path.join(dir, `claim-e${state.epoch}-b${band}`), "", { flag: "wx" });
  } catch {
    return false;
  }
  writeState(dir, { band, epoch: state.epoch });
  pruneOlderThan(dir, 0, (name) => name.startsWith("claim-e") && !name.startsWith(`claim-e${state.epoch}-`));
  return true;
}

// HOOK-12: identity first; a non-main session returns before any config, transcript or state read.
export async function runContextGuard(input, { env = process.env, stateDir = os.tmpdir(), loadConfig = loadHookConfig, readTail = readTailText } = {}) {
  if (!isMainSession(input, env) || !input.transcript_path) return null;
  const cfg = (await loadConfig(input, env)).context_guard;
  const last = lastUsage(readTail(input.transcript_path));
  if (!last) return null;
  const { pct, window, band } = contextBand(last.used, cfg, last.window);
  const key = sha256(input.session_id || input.transcript_path).slice(0, 24);
  if (!claimBand(path.join(stateDir, `${STATE_PREFIX}${key}`), band)) return null;
  pruneOlderThan(stateDir, DAY_MS, (name) => name.startsWith(STATE_PREFIX));
  return { output: contextOutput(input.hook_event_name || "PostToolUse", reminderText({ pct, used: last.used, window }, cfg)) };
}

if (isScript(import.meta.url)) await runHook("context guard", (input) => runContextGuard(input));
