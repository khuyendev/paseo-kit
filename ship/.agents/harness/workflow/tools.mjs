// Tool facts the watchdog and run-stats share: kinds by exact tool name (FLOW-32), input readiness (FLOW-30) and the
// input key of a call (input fields only).
export const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "mcp__harness-files__write_multiple_files", "mcp__harness-files__edit_multiple_files"]);
export const READ_TOOLS = new Set(["Read", "Grep", "Glob", "mcp__harness-files__read_ranges"]);
export const SEARCH_TOOLS = new Set(["Grep", "Glob"]);
export const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
export const KINDS = Object.freeze(["read", "write", "shell", "other"]);

// A redirect to a file (`>`/`>>`, not `=>` or `>&`) or a file-writing call; nothing else in a command counts.
const SHELL_WRITE = /(?<![=>])>>?(?![>&])|\b(writeFileSync|appendFileSync|Set-Content|Out-File|Add-Content)\b/;

export function toolKind(name, input) {
  if (WRITE_TOOLS.has(name)) return "write";
  if (READ_TOOLS.has(name)) return "read";
  if (SHELL_TOOLS.has(name)) return SHELL_WRITE.test(String(input?.command ?? "")) ? "write" : "shell";
  return "other";
}

const filled = (v) => v != null && v !== "" && !(typeof v === "object" && Object.keys(v).length === 0);
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
// Result fields a completed typed detail carries next to the input.
const RESULT_FIELDS = new Set(["type", "output", "exitCode", "exit_code", "error", "status"]);

// The call's input in Claude Code tool shape. Paseo gives native tools a typed detail ({type: "write", filePath,
// content}, {type: "shell", command}, ...) and other tools {type: "unknown", input}.
export function inputOf(detail) {
  if (!detail || typeof detail !== "object") return null;
  if ("input" in detail) return detail.input ?? null;
  const input = {};
  for (const [k, v] of Object.entries(detail)) {
    if (RESULT_FIELDS.has(k) || (detail.type === "read" && k === "content")) continue;
    input[snake(k)] = v;
  }
  return input;
}

export function inputKey(input) {
  if (!input || typeof input !== "object") return filled(input) ? JSON.stringify(input) : null;
  return Object.values(input).some(filled) ? JSON.stringify(input) : null;
}

const nonEmpty = (v) => Array.isArray(v) && v.length > 0;

export function inputReady(name, input) {
  if (!input || typeof input !== "object") return filled(input);
  switch (name) {
    case "Write": return filled(input.file_path) && typeof input.content === "string";
    case "Edit": return filled(input.file_path) && typeof input.new_string === "string";
    case "MultiEdit": return nonEmpty(input.edits);
    case "Bash":
    case "PowerShell": return filled(input.command);
    case "Read": return filled(input.file_path);
    case "mcp__harness-files__write_multiple_files": return nonEmpty(input.files) && input.files.every((f) => typeof f?.content === "string");
    case "mcp__harness-files__edit_multiple_files": return (nonEmpty(input.files) && input.files.every((f) => nonEmpty(f?.edits))) || nonEmpty(input.fixes);
    case "mcp__harness-files__read_ranges": return nonEmpty(input.ranges);
    default: return Object.values(input).some(filled);
  }
}

// File paths a read names: file_path, filePath, path, paths[], ranges[].path.
export function readPaths(input) {
  if (!input || typeof input !== "object") return [];
  const all = [input.file_path, input.filePath, input.path, ...(Array.isArray(input.paths) ? input.paths : []), ...(Array.isArray(input.ranges) ? input.ranges.map((r) => r?.path) : [])];
  return all.filter((p) => typeof p === "string" && p);
}
