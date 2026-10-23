// REQUIREMENTS.md grammar (GSDC-09): the table `| ID | Spec | Rule | Phase | Status |` or bullets
// `- [ ] **ID**: text (spec: path)`, plus the Traceability table; ids are free-form, validated by the adapter regex.
import { lf, readIf } from "./common.mjs";
import { sharedFile } from "./planning.mjs";

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim().replace(/^`|`$/g, ""));

const isDivider = (line) => /^\|?\s*:?-{2,}/.test(line.trim());
const COMPLETE = /^(complete|completed|done|validated|\[x\])$/i;

export function parseRequirements(text) {
  const lines = lf(text ?? "").split("\n");
  const map = new Map();
  const trace = new Map();
  // Every row that names an id, in file order: map and trace keep the last row for readers, copies keeps all of them.
  const copies = new Map();
  const copy = (id, entry) => copies.set(id, [...(copies.get(id) ?? []), entry]);
  let header = null;
  lines.forEach((line, i) => {
    const bullet = /^\s*-\s*(?:\[([ xX])\]\s*)?\*\*([^*]+?)\*\*\s*:?\s*(.*)$/.exec(line);
    if (bullet && !line.trim().startsWith("|")) {
      const id = bullet[2].trim();
      const specM = /\s*\(spec:\s*([^)]+)\)\s*$/.exec(bullet[3]);
      const entry = {
        id,
        text: (specM ? bullet[3].slice(0, specM.index) : bullet[3]).trim(),
        spec: specM ? specM[1].trim() : null,
        complete: (bullet[1] ?? " ").toLowerCase() === "x",
        form: "bullet",
        line: i,
        checkable: bullet[1] !== undefined,
      };
      map.set(id, entry);
      copy(id, entry);
      return;
    }
    if (!line.trim().startsWith("|")) {
      header = null;
      return;
    }
    if (isDivider(line)) return;
    const row = cells(line);
    if (!header) {
      header = row.map((c) => c.toLowerCase());
      return;
    }
    const col = (name) => header.findIndex((h) => h.startsWith(name));
    if (header[0] === "id") {
      const id = row[0];
      if (!id) return;
      const entry = {
        id,
        text: row[col("rule")] ?? row[col("description")] ?? "",
        spec: row[col("spec")] || null,
        complete: COMPLETE.test(row[col("status")] ?? ""),
        form: "table",
        line: i,
        phase: row[col("phase")] || null,
        statusIndex: col("status"),
      };
      map.set(id, entry);
      copy(id, entry);
    } else if (header[0] === "requirement") {
      const entry = { id: row[0], phase: row[col("phase")] ?? null, status: row[col("status")] ?? null, form: "trace", line: i, statusIndex: col("status") };
      trace.set(row[0], entry);
      copy(row[0], entry);
    }
  });
  for (const [id, t] of trace) {
    const r = map.get(id);
    if (r && !r.phase) r.phase = t.phase;
  }
  return { lines, map, trace, copies };
}

export function loadRequirements(root) {
  const text = readIf(sharedFile(root, "REQUIREMENTS.md"));
  return { exists: text !== null, text, ...parseRequirements(text ?? "") };
}

// The comparable view of a requirement (both forms give the same object).
export const requirementView = (r) => ({ id: r.id, text: r.text, spec: r.spec, phase: r.phase ?? null, complete: r.complete });

// Ids with more than one defining row (bullet or table) or more than one traceability row.
export const duplicateIds = (parsed) =>
  [...parsed.copies].filter(([, rows]) => rows.filter((r) => r.form === "trace").length > 1 || rows.filter((r) => r.form !== "trace").length > 1).map(([id]) => id);

function setRowStatus(line, statusIndex, value) {
  const parts = line.split("|");
  // parts[0] is the text before the first pipe; cell k sits at parts[k + 1].
  const k = statusIndex + 1;
  if (k >= parts.length - 1) return line;
  const old = parts[k];
  const lead = /^\s*/.exec(old)[0] || " ";
  const trail = /\s*$/.exec(old)[0] || " ";
  parts[k] = `${lead}${value}${trail}`;
  return parts.join("|");
}

// Set the completion of requirement ids on every row that names them (bullet checkbox, table status cell, traceability row); returns new text.
export function setComplete(parsed, ids, complete) {
  const lines = [...parsed.lines];
  for (const id of ids) {
    for (const row of parsed.copies.get(id) ?? []) {
      if (row.form === "bullet") {
        if (row.checkable) lines[row.line] = lines[row.line].replace(/\[[ xX]\]/, complete ? "[x]" : "[ ]");
      } else if (row.statusIndex >= 0) lines[row.line] = setRowStatus(lines[row.line], row.statusIndex, complete ? "Complete" : "Pending");
    }
  }
  return lines.join("\n");
}
