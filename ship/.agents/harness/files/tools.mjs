// The three harness-files tools (FTOL-01, D-39): names, descriptions, flat schemas and argument validation.
// Schemas carry no root combinator and no _meta (FTOL-02): custom registered tools must stay Messages-compatible.

export const PREFIX = "mcp__harness-files__";
export const TOOL_NAMES = Object.freeze(["read_ranges", "edit_multiple_files", "write_multiple_files"]);

const str = { type: "string" };
const int = (minimum) => ({ type: "integer", minimum });
const obj = (properties, required = []) => ({ type: "object", required, properties });
const list = (items) => ({ type: "array", minItems: 1, items });

// Supplied after the base description of every tool (FTOL-03).
export const SUFFIX = " Supply operation arguments, or only continuation/receipt.";

const BASE = [
  {
    name: "read_ranges",
    description: "Read inclusive, 1-based ranges from several files with line numbers; omit from/to for a small whole file. Paths are cwd-relative. A unique missing-path substitute is explicitly identified; otherwise candidates are listed. Oversized or binary entries are not read; follow their diagnostics. Each entry header has a tag for line edits with edit_multiple_files.",
    inputSchema: obj({ ranges: list(obj({ path: str, from: int(1), to: int(1) }, ["path"])) }, ["ranges"]),
  },
  {
    name: "edit_multiple_files",
    description: "Apply ordered exact replacements across files, preserving line endings. oldText must match once after earlier edits. Line edits, instead of oldText: give the file entry the tag of a read_ranges entry, then {from, to, newText} replaces those lines of that read (newText \"\" deletes them) or {after, newText} inserts after a line (0: at the top); a final line break in newText is optional. The lines are checked against that read and found again if earlier edits moved them; an entry's line edits apply before its oldText edits. By default matching edits commit, failures get retained fix IDs, and already-applied edits are skipped. Do not resend successful edits. Retry fixes with {id} for a suggested match, {id, occurrence}, {id, oldText}, {id, path}, or {id, from/to/after, tag} for a line edit; newText may override the retained replacement. atomic aborts all writes on any failure; dryRun writes nothing.",
    inputSchema: obj({
      files: list(obj({
        path: { type: "string", minLength: 1 },
        tag: str,
        edits: list(obj({ oldText: { type: "string", minLength: 1 }, newText: str, from: int(1), to: int(1), after: int(0) }, ["newText"])),
      }, ["path", "edits"])),
      fixes: list(obj({
        id: str, occurrence: int(1), oldText: { type: "string", minLength: 1 }, newText: str, path: { type: "string", minLength: 1 },
        tag: str, from: int(1), to: int(1), after: int(0),
      }, ["id"])),
      atomic: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false },
    }),
  },
  {
    name: "write_multiple_files",
    description: "Create or overwrite several files in one call (all-or-nothing: if any path is invalid, nothing is written). Parent directories are created.",
    inputSchema: obj({ files: list(obj({ path: str, content: str }, ["path", "content"])) }, ["files"]),
  },
];

const RECOVERY = {
  continuation: { type: "string", description: "Opaque continuation returned by this tool; omit all other fields when continuing." },
  receipt: { type: "string", description: "Recover an outcome-unknown execution receipt, without rerunning target I/O." },
};

// What `describe` returns and the mod registers: base requireds move to the backend so {continuation} alone is valid.
export const TOOLS = BASE.map(({ name, description, inputSchema }) => ({
  name,
  description: description + SUFFIX,
  inputSchema: { type: "object", properties: { ...inputSchema.properties, ...RECOVERY } },
  isDeferred: false,
}));

export const HEX64 = /^[a-f0-9]{64}$/;

function check(value, schema, label) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    for (const key of schema.required ?? []) if (value[key] === undefined) throw new Error(`${label}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (value[key] !== undefined) check(value[key], child, `${label}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0)) throw new Error(`${label} must be a nonempty array`);
    value.forEach((item, i) => check(item, schema.items, `${label}[${i}]`));
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity)) throw new Error(`${label} must be a valid integer`);
  } else if (typeof value !== schema.type || (typeof value === "string" && value.length < (schema.minLength ?? 0))) {
    throw new Error(`${label} has an invalid ${schema.type} value`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${label} must be one of ${schema.enum.join(", ")}`);
}

// Throws a field-path message (FTOL-02); returns the recovery field name or null for base arguments.
export function validateArgs(method, args) {
  const tool = BASE.find((t) => t.name === method);
  if (!tool) throw new Error(`unknown file tool ${method}`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`${method} arguments must be an object`);
  if (args.continuation !== undefined || args.receipt !== undefined) {
    const field = args.continuation !== undefined ? "continuation" : "receipt";
    if (Object.keys(args).some((key) => key !== field)) throw new Error("supply only continuation OR receipt, not base arguments or both");
    if (typeof args[field] !== "string" || !HEX64.test(args[field])) throw new Error(`${method}.${field} must be 64 lowercase hex characters`);
    return field;
  }
  check(args, tool.inputSchema, method);
  // CR-FIL-04: newText alone selects nothing
  if (method === "edit_multiple_files") (args.files ?? []).forEach((f, i) => f.edits.forEach((e, j) => {
    if (e.oldText === undefined && e.from === undefined && e.to === undefined && e.after === undefined) {
      throw new Error(`${method}.files[${i}].edits[${j}] needs oldText, or from/to or after with the file entry's tag`);
    }
  }));
  return null;
}

