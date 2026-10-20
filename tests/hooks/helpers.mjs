// Hook test fixtures: an installed project (runtime + hooks), synthetic transcripts, hook processes with a temp TMPDIR.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { testEnv } from "../helpers/env.mjs";
import { runNode } from "../helpers/run.mjs";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

export const HOOKS_DIR = path.join(SHIP_DIR, ".claude", "hooks");

export function hookProject({ overlay, files } = {}) {
  const project = makeTempProject({ git: false, runtime: true, overlay, files });
  fs.cpSync(HOOKS_DIR, project.path(".claude/hooks"), { recursive: true });
  return project;
}

// Environment of a hook process: isolated home, the project dir, and a private temp dir for hook state (HOOK-31).
export function hookEnv(root, overrides = {}) {
  const tmp = makeTempDir("paseo kit hook tmp ");
  return testEnv({ CLAUDE_PROJECT_DIR: root, TEMP: tmp, TMP: tmp, TMPDIR: tmp, ...overrides });
}

export const hookScript = (root, name) => path.join(root, ".claude", "hooks", name);

export function runHookSync(root, name, input, { env = hookEnv(root), cwd = root } = {}) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return runNode(hookScript(root, name), [], { cwd, env, input: text });
}

export function runHookAsync(root, name, input, { env, cwd = root } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hookScript(root, name)], { cwd, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

export const contextOf = (stdout) => (stdout ? JSON.parse(stdout).hookSpecificOutput.additionalContext : "");

// Synthetic transcript lines in the Claude Code JSONL shape (one line per entry).
export const T = {
  prompt: (uuid, text = "do the task") => ({ type: "user", uuid, message: { role: "user", content: text } }),
  uses: (messageId, calls) => ({
    type: "assistant",
    message: { id: messageId, role: "assistant", content: calls.map(([id, name, input = {}]) => ({ type: "tool_use", id, name, input })) },
  }),
  results: (ids, content = "ok") => ({
    type: "user",
    message: { role: "user", content: ids.map((id) => ({ type: "tool_result", tool_use_id: id, content })) },
  }),
  usage: (used, { model = "some-model", window, sidechain, agentId } = {}) => ({
    type: "assistant",
    ...(sidechain ? { isSidechain: true } : {}),
    ...(agentId ? { agentId } : {}),
    message: { model, usage: { input_tokens: used, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...(window ? { context_window: window } : {}) } },
  }),
};

export function writeTranscript(dir, entries, name = "transcript.jsonl") {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  return file;
}

// Finished lookup rounds (one Grep each) after a prompt.
export function lookupRounds(count, prefix = "l") {
  const out = [];
  for (let i = 0; i < count; i++) out.push(T.uses(`${prefix}m${i}`, [[`${prefix}t${i}`, "Grep", { pattern: "x" }]]), T.results([`${prefix}t${i}`]));
  return out;
}

export function editRounds(count, prefix = "e", file = "C:/Work/a.txt") {
  const out = [];
  for (let i = 0; i < count; i++) out.push(T.uses(`${prefix}m${i}`, [[`${prefix}t${i}`, "Edit", { file_path: file }]]), T.results([`${prefix}t${i}`]));
  return out;
}
