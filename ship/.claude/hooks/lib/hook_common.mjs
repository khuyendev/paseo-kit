// Shared plumbing of the kit hooks: stdin parsing, the config root rule, the never-block wrapper (HOOK-04, HOOK-05).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TAIL_BYTES = 1024 * 1024;
export const DAY_MS = 24 * 60 * 60 * 1000;

// A broken or missing harness config: the only failure a hook reports (one stderr line, HOOK-05).
export class HookConfigError extends Error {}

export const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");
export const firstLine = (e) => String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 300);

// HOOK-04: one root rule for every kit hook.
export function hookRoot(input, env = process.env) {
  return path.resolve(env.PASEO_HARNESS_ROOT || env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd());
}

// Modules of the installed runtime are loaded by absolute file URL from the root, never by a relative import (INV-09).
export function harnessModule(root, rel) {
  return import(pathToFileURL(path.join(root, ".agents", "harness", rel)).href);
}

// Returns loadConfig of the project's config.mjs; any failure to load it is a configuration error.
export async function configLoader(root) {
  try {
    const { loadConfig } = await harnessModule(root, "config.mjs");
    return loadConfig;
  } catch (e) {
    throw new HookConfigError(firstLine(e));
  }
}

export async function loadHookConfig(input, env = process.env) {
  const root = hookRoot(input, env);
  const loadConfig = await configLoader(root);
  try {
    return loadConfig(root);
  } catch (e) {
    throw new HookConfigError(firstLine(e));
  }
}

// The last bytes of a transcript as text; the first, possibly cut, line fails JSON parsing and is skipped by callers.
export function readTailText(file, bytes = TAIL_BYTES) {
  const size = fs.statSync(file).size;
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, len, size - len);
  } finally {
    fs.closeSync(fd);
  }
  return buf.toString("utf8");
}

// Text of a tool result or tool_response: a string, content blocks, or an object holding either.
export function resultText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(resultText).join("\n");
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if ("content" in value) return resultText(value.content);
  }
  return "";
}

// Kit feedback 84: any MCP server's batch writer (the mod's, fsbatch, a filesystem-style server) is checked like the mod's.
export const isBatchWriter = (toolName) => /^mcp__.+__(edit|write)_multiple_files$/.test(String(toolName));

// Files the batch write tools changed, from their reply lines (FTOL `edited <abs>: N edit(s)...`, `wrote <abs> (N chars)`).
export function changedPathsInResult(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^edited (.+?): \d+ edits?\b/.exec(line) ?? /^wrote (.+) \(\d+ chars\)$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

// Files an edit tool call names (syntax_check, self_repair_guard). Batch writers of the mod and of fsbatch name files in
// files[].path and fixes[].path; filesystem-style servers in path / paths; NotebookEdit in notebook_path.
export function targetPaths(input, event) {
  const i = input.tool_input ?? {};
  const named = (list) => (Array.isArray(list) ? list.map((f) => (typeof f === "string" ? f : f?.path)) : []);
  const raw = [i.file_path, i.notebook_path, i.path, ...named(i.files), ...named(i.fixes), ...named(i.paths)];
  if (event === "PostToolUse" && isBatchWriter(input.tool_name)) raw.push(...changedPathsInResult(resultText(input.tool_response)));
  return raw.filter((p) => typeof p === "string" && p);
}

// A file published whole and only if its name is free: written to a private temp name, then hard-linked (exclusive,
// atomic), so no reader ever sees a partial record and exactly one of several writers wins the name.
export function publishExclusive(file, text) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, "utf8");
    fs.linkSync(tmp, file);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function pruneOlderThan(dir, maxAgeMs, filter = () => true) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of names) {
    if (!filter(name)) continue;
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}

// BOM-aware text read (CONF-02) for hook state files and stdin; hooks cannot import lib/io.mjs by a relative path.
export const readTextFile = (fileOrFd) => fs.readFileSync(fileOrFd, "utf8").replace(/^﻿/, "");
export const readJsonFile = (fileOrFd) => JSON.parse(readTextFile(fileOrFd));

export const contextOutput = (hookEventName, additionalContext) => ({ hookSpecificOutput: { hookEventName, additionalContext } });

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

export function isScript(moduleUrl) {
  try {
    return Boolean(process.argv[1]) && fold(fs.realpathSync(process.argv[1])) === fold(fs.realpathSync(fileURLToPath(moduleUrl)));
  } catch {
    return false;
  }
}

// HOOK-05: exit 0 on every path; a config error is one stderr line `<name> unavailable: <msg>`, anything else is silent.
// The handler returns null or {output, warning}.
export async function runHook(name, handler) {
  try {
    const input = readJsonFile(0);
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    const result = await handler(input);
    if (result?.warning) process.stderr.write(`${name} unavailable: ${result.warning}\n`);
    if (result?.output) process.stdout.write(JSON.stringify(result.output));
  } catch (e) {
    if (e instanceof HookConfigError) process.stderr.write(`${name} unavailable: ${e.message}\n`);
  } finally {
    process.exitCode = 0;
  }
}
