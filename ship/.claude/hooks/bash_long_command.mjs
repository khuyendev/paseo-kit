#!/usr/bin/env node
// Windows long-command rescue (PreToolUse Bash, HOOK-30): Claude Code passes a Bash command through a Windows command
// line capped near 8191 chars (each ' grows to '\'') and turns \\ into \ on the way, so a long command is cut off and a
// \\ command runs altered. The hook input still holds the command as written: it goes to a temp script that is sourced
// in the same shell, cwd and env. 6000 leaves room for Claude Code's own wrapper.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DAY_MS, isScript, pruneOlderThan, runHook, sha256 } from "./lib/hook_common.mjs";

const LIMIT = 6000;

export function needsRescue(command) {
  const quotes = (command.match(/'/g) ?? []).length;
  return command.length + 3 * quotes > LIMIT || command.includes("\\\\");
}

export function rescueLongCommand(input, { platform = process.platform, tmpDir = os.tmpdir() } = {}) {
  const command = input.tool_input?.command;
  if (platform !== "win32" || input.tool_name !== "Bash" || typeof command !== "string" || !needsRescue(command)) return null;
  const dir = path.join(tmpDir, "claude-bash-commands");
  fs.mkdirSync(dir, { recursive: true });
  pruneOlderThan(dir, DAY_MS);
  const lf = command.replace(/\r\n/g, "\n");
  const body = lf.endsWith("\n") ? lf : `${lf}\n`;
  const file = path.join(dir, `${sha256(body).slice(0, 16)}-${process.pid}.sh`);
  fs.writeFileSync(file, body, "utf8");
  const quoted = file.replace(/\\/g, "/").replace(/'/g, "'\\''");
  return { output: { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...input.tool_input, command: `source '${quoted}'` } } } };
}

if (isScript(import.meta.url)) await runHook("bash long command", (input) => rescueLongCommand(input));
