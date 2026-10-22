// Registration lint (HOOK-29) and template consistency (HOOK-02), shared by the hook tests.
import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "../../ship/.claude/hooks/syntax_check.mjs";

export const NATIVE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "TodoWrite", "Task", "Agent", "Skill"]);
export const MOD_TOOLS = ["mcp__harness-files__read_ranges", "mcp__harness-files__edit_multiple_files", "mcp__harness-files__write_multiple_files"];

// Internal time budget per kit hook script; a registration timeout must exceed it.
export const HOOK_BUDGET_S = { "syntax_check.mjs": LIMITS.budgetMs / 1000 };

export const scriptOf = (command) => /[\\/]\.claude[\\/]hooks[\\/]([\w.-]+\.mjs)(?:["'\s]|$)/.exec(command)?.[1] ?? null;

export function registrations(template) {
  const out = [];
  for (const [event, groups] of Object.entries(template.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) out.push({ event, matcher: group.matcher, type: hook.type, command: hook.command, timeout: hook.timeout, script: scriptOf(hook.command ?? "") });
    }
  }
  return out;
}

// Top-level alternatives of a matcher (a `|` inside parentheses belongs to its group).
function alternatives(matcher) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of matcher) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "|" && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  return [...out, current];
}

function matcherProblems(matcher) {
  if (matcher === undefined || matcher === "*") return [];
  return alternatives(matcher).flatMap((alt) => {
    if (NATIVE_TOOLS.has(alt)) return [];
    if (alt.startsWith("mcp__harness-files__")) {
      const re = new RegExp(`^(?:${alt})$`);
      return MOD_TOOLS.some((t) => re.test(t)) ? [] : [`matcher ${alt} names no shipped mod tool`];
    }
    return [`matcher ${alt} names a tool the kit does not ship`];
  });
}

export function lintRegistration(template) {
  const problems = [];
  for (const r of registrations(template)) {
    problems.push(...matcherProblems(r.matcher).map((p) => `${r.event} ${r.script}: ${p}`));
    const budget = HOOK_BUDGET_S[r.script] ?? 0;
    if (!(r.timeout > budget)) problems.push(`${r.event} ${r.script}: timeout ${r.timeout} s is not larger than its budget ${budget} s`);
  }
  return problems;
}

export const shippedHookScripts = (hooksDir) => fs.readdirSync(hooksDir).filter((n) => n.endsWith(".mjs") && fs.statSync(path.join(hooksDir, n)).isFile()).sort();

export function consistencyProblems(template, hooksDir) {
  const referenced = new Set(registrations(template).map((r) => r.script));
  const shipped = new Set(shippedHookScripts(hooksDir));
  return [
    ...[...referenced].filter((s) => !s || !shipped.has(s)).map((s) => `template references ${s ?? "a non-kit command"} that is not shipped`),
    ...[...shipped].filter((s) => !referenced.has(s)).map((s) => `${s} is shipped but not registered`),
  ];
}
