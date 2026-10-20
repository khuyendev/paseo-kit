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
  let header = null;
  lines.forEach((line, i) => {
    const bullet = /^\s*-\s*(?:\[([ xX])\]\s*)?\*\*([^*]+?)\*\*\s*:?\s*(.*)$/.exec(line);
    if (bullet && !line.trim().startsWith("|")) {
      const id = bullet[2].trim();
      const specM = /\s*\(spec:\s*([^)]+)\)\s*$/.exec(bullet[3]);
      map.set(id, {
        id,
        text: (specM ? bullet[3].slice(0, specM.index) : bullet[3]).trim(),
        spec: specM ? specM[1].trim() : null,
        complete: (bullet[1] ?? " ").toLowerCase() === "x",
        form: "bullet",
        line: i,
        checkable: bullet[1] !== undefined,
      });
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
      map.set(id, {
        id,
        text: row[col("rule")] ?? row[col("description")] ?? "",
        spec: row[col("spec")] || null,
        complete: COMPLETE.test(row[col("status")] ?? ""),
        form: "table",
        line: i,
        phase: row[col("phase")] || null,
      });
    } else if (header[0] === "requirement") {
      trace.set(row[0], { phase: row[col("phase")] ?? null, status: row[col("status")] ?? null, line: i });
    }
  });
  for (const [id, t] of trace) {
    const r = map.get(id);
    if (r && !r.phase) r.phase = t.phase;
  }
  return { lines, map, trace };
}

export function loadRequirements(root) {
  const text = readIf(sharedFile(root, "REQUIREMENTS.md"));
  return { exists: text !== null, text, ...parseRequirements(text ?? "") };
}

// The comparable view of a requirement (both forms give the same object).
export const requirementView = (r) => ({ id: r.id, text: r.text, spec: r.spec, phase: r.phase ?? null, complete: r.complete });

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

// Set the completion of requirement ids (bullet checkbox, table status cell, traceability row); returns new text.
export function setComplete(parsed, ids, complete) {
  const lines = [...parsed.lines];
  let header = null;
  lines.forEach((line, i) => {
    if (!line.trim().startsWith("|")) header = null;
    else if (!isDivider(line) && !header) header = cells(line).map((c) => c.toLowerCase());
    for (const id of ids) {
      const r = parsed.map.get(id);
      if (r?.line === i && r.form === "bullet" && r.checkable) lines[i] = line.replace(/\[[ xX]\]/, complete ? "[x]" : "[ ]");
      if (header && (r?.line === i || parsed.trace.get(id)?.line === i)) {
        const status = header.findIndex((h) => h.startsWith("status"));
        if (status >= 0) lines[i] = setRowStatus(lines[i], status, complete ? "Complete" : "Pending");
      }
    }
  });
  return lines.join("\n");
}
