#!/usr/bin/env node
// Skill usage log (PreToolUse Skill; owner decision 2026-10-22, after the Claude Code team's skills write-up): one line per
// skill the model invokes, in _workspace/skill-usage.jsonl, so `ph evolve-stats` shows skills that trigger less than
// expected. A skill the owner types as a slash command does not pass through the Skill tool and is not counted. Never
// blocks and prints nothing; a failed write is dropped.
import fs from "node:fs";
import path from "node:path";
import { hookRoot, isScript, runHook } from "./lib/hook_common.mjs";

// The runtime reads the same path (.agents/harness/workflow/metrics.mjs SKILL_USAGE_REL).
export const SKILL_USAGE_REL = "_workspace/skill-usage.jsonl";
const NAME_MAX = 120;

export function recordSkill(input, { env = process.env, now = () => new Date() } = {}) {
  const skill = input?.tool_input?.skill;
  if (input?.tool_name !== "Skill" || typeof skill !== "string" || !skill.trim()) return null;
  const file = path.join(hookRoot(input, env), SKILL_USAGE_REL);
  const line = { at: now().toISOString(), skill: skill.trim().slice(0, NAME_MAX), agent: env.PASEO_AGENT_ID || null, session: typeof input.session_id === "string" ? input.session_id : null };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    // A log line is never worth a blocked or noisy tool call.
  }
  return null;
}

if (isScript(import.meta.url)) await runHook("skill usage", (input) => recordSkill(input));
