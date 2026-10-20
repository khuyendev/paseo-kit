// Timeline item -> activity (PANL-33..36). Paseo maps known tools to typed details; everything else arrives as
// detail type "unknown" with the raw tool name and input, classified here by the tool tables first (Claude Code
// native tools and the three harness-files tools), then by generic name patterns.
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { Activity, ActivityKind } from "../shared/swarm.ts";
import { batchFilePaths } from "./file-input.ts";
import { DETAIL_MAX_CHARS, FILES_PER_ACTIVITY, LABEL_MAX_CHARS, MESSAGE_MAX_CHARS } from "./limits.ts";
import { baseName, clip, filesLabel, firstLine } from "./text.ts";

export type TimelineItem = AgentTimelineItem;
export interface TimelineEntry {
  item: TimelineItem;
  timestamp: string;
  seqStart: number;
}

export interface Described {
  kind: ActivityKind;
  label: string;
  detail: string;
  files: string[];
}

// Tools whose kind is fixed by name, before any generic rule (PANL-34).
const TOOL_KINDS: Record<string, ActivityKind> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  PowerShell: "shell",
  Glob: "search",
  Grep: "search",
  WebSearch: "search",
  WebFetch: "fetch",
  Agent: "agent",
  Task: "agent",
  TodoWrite: "plan",
  "mcp__harness-files__read_ranges": "read",
  "mcp__harness-files__write_multiple_files": "write",
  "mcp__harness-files__edit_multiple_files": "edit",
};

// edit_multiple_files takes replacements and line edits under files[] and retries under fixes[].
const EDIT_TOOL = "mcp__harness-files__edit_multiple_files";
const MCP_NAME = /^mcp__(.+?)__(.+)$/;
const FILE_KINDS: ReadonlySet<ActivityKind> = new Set(["read", "edit", "write"]);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// PANL-36: "cd C:/x && node tools/build/run.mjs --all" -> "node run.mjs --all".
export function shellLabel(command: string): string {
  const segments = command.split(/&&|\|\||;/).map((s) => s.trim()).filter(Boolean);
  const main = segments.find((s) => !/^(cd|set|export)(\s|$)/i.test(s)) ?? segments[0] ?? command;
  const short = main
    .replace(/"[^"]*[\\/]([^"\\/]+)"/g, "$1")
    .replace(/'[^']*[\\/]([^'\\/]+)'/g, "$1")
    .replace(/(?:[A-Za-z]:)?[\\/]?(?:[^\s\\/"']+[\\/])+([^\s\\/"']+)/g, "$1");
  return clip(short, LABEL_MAX_CHARS);
}

function pathsOf(name: string, rec: Record<string, unknown>): string[] {
  const single = [rec.file_path, rec.filePath, rec.path, rec.notebook_path].map(str).filter((p): p is string => p !== null);
  const batch = batchFilePaths(rec, name === EDIT_TOOL ? ["files", "ranges", "fixes"] : ["files", "ranges"]);
  return [...new Set([...single, ...batch])];
}

function fileActivity(kind: ActivityKind, paths: string[], fallback: string): Described {
  if (paths.length === 0) return { kind, label: fallback, detail: fallback, files: [] };
  return { kind, label: filesLabel(paths, 2), detail: paths.join("\n"), files: paths };
}

function byKind(kind: ActivityKind, name: string, rec: Record<string, unknown>, paths: string[]): Described {
  if (FILE_KINDS.has(kind)) return fileActivity(kind, paths, name);
  if (kind === "shell") {
    const command = str(rec.command) ?? str(rec.cmd);
    return { kind, label: command ? shellLabel(command) : name, detail: command ?? name, files: [] };
  }
  if (kind === "search") {
    const q = str(rec.pattern) ?? str(rec.query) ?? (paths[0] ? `${baseName(paths[0])}/` : name);
    return { kind, label: name === "WebSearch" ? `web: ${q}` : q, detail: q, files: [] };
  }
  if (kind === "fetch") {
    const u = str(rec.url) ?? name;
    return { kind, label: u.replace(/^https?:\/\//, ""), detail: u, files: [] };
  }
  if (kind === "agent") {
    const d = str(rec.description) ?? str(rec.title) ?? str(rec.prompt) ?? name;
    return { kind, label: d, detail: d, files: [] };
  }
  return { kind, label: name, detail: name, files: [] };
}

export function describeUnknown(rawName: string, input: unknown): Described {
  const rec = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mcp = MCP_NAME.exec(rawName);
  const tool = (mcp?.[2] ?? rawName).toLowerCase();
  const name = mcp ? `${mcp[1]}: ${mcp[2]}` : rawName;
  const paths = pathsOf(rawName, rec);
  const fixed = TOOL_KINDS[rawName];
  if (fixed) return byKind(fixed, name, rec, paths);
  if (str(rec.command) || str(rec.cmd) || /bash|powershell|shell|exec|terminal/.test(tool)) return byKind("shell", name, rec, paths);
  if (batchFilePaths(rec).length > 0) return fileActivity(/write/.test(tool) ? "write" : /edit/.test(tool) ? "edit" : "read", paths, name);
  if (/agent|task/.test(tool)) return byKind("agent", name, rec, paths);
  if (/^(read|view|cat|get_file_info)/.test(tool)) return fileActivity("read", paths, name);
  if (/edit|replace|patch/.test(tool)) return fileActivity("edit", paths, name);
  if (/^(write|create_file)/.test(tool)) return fileActivity("write", paths, name);
  if (/grep|glob|search|find|directory|list/.test(tool)) return byKind("search", name, rec, paths);
  if (/fetch|url|browse/.test(tool)) return byKind("fetch", name, rec, paths);
  return { kind: "tool", label: name, detail: name, files: [] };
}

export function describeItem(item: TimelineItem): Described | null {
  switch (item.type) {
    case "tool_call": {
      const d = item.detail;
      switch (d.type) {
        case "read":
        case "edit":
        case "write":
          return { kind: d.type, label: baseName(d.filePath), detail: d.filePath, files: [d.filePath] };
        case "shell":
          return { kind: "shell", label: shellLabel(d.command), detail: d.command, files: [] };
        case "search":
          return { kind: "search", label: d.toolName === "web_search" ? `web: ${d.query}` : d.query, detail: d.query, files: [] };
        case "fetch":
          return { kind: "fetch", label: d.url.replace(/^https?:\/\//, ""), detail: d.url, files: [] };
        case "sub_agent": {
          const text = d.description ?? d.subAgentType ?? item.name;
          return { kind: "agent", label: text, detail: text, files: [] };
        }
        case "worktree_setup":
          return { kind: "shell", label: `worktree ${d.branchName}`, detail: d.worktreePath, files: [] };
        case "plan":
          return { kind: "plan", label: firstLine(d.text) || "plan", detail: d.text, files: [] };
        case "plain_text": {
          const text = d.label ?? d.text ?? item.name;
          return { kind: "tool", label: text, detail: d.text ?? text, files: [] };
        }
        case "unknown":
          return describeUnknown(item.name, d.input);
      }
      return { kind: "tool", label: item.name, detail: item.name, files: [] };
    }
    case "user_message":
      return { kind: "command", label: firstLine(item.text), detail: item.text, files: [] };
    case "assistant_message":
      return { kind: "reply", label: firstLine(item.text), detail: item.text, files: [] };
    case "reasoning":
      return { kind: "think", label: "thinking", detail: item.text, files: [] };
    case "compaction":
      return { kind: "think", label: "compacting context", detail: "compacting context", files: [] };
    case "todo": {
      const done = item.items.filter((t) => t.completed).length;
      const current = item.items.find((t) => t.status === "in_progress");
      return {
        kind: "plan",
        label: current?.activeForm ?? `${done}/${item.items.length} todos done`,
        detail: item.items.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.text}`).join("\n"),
        files: [],
      };
    }
    case "error":
      return { kind: "tool", label: item.message, detail: item.message, files: [] };
    default:
      return null;
  }
}

export function toActivity(entry: TimelineEntry): Activity | null {
  const d = describeItem(entry.item);
  if (!d) return null;
  const item = entry.item;
  const isTool = item.type === "tool_call";
  const isMessage = d.kind === "command" || d.kind === "reply";
  return {
    id: isTool ? item.callId : `${item.type}:${entry.seqStart}`,
    kind: d.kind,
    label: clip(d.label, LABEL_MAX_CHARS) || d.kind,
    detail: clip(d.detail, isMessage ? MESSAGE_MAX_CHARS : DETAIL_MAX_CHARS),
    status: isTool ? item.status : item.type === "error" ? "failed" : "completed",
    at: entry.timestamp,
    files: [...new Set(d.files)].slice(0, FILES_PER_ACTIVITY),
  };
}
