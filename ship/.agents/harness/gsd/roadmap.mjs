// ROADMAP.md grammar (GSDC-07): phase sections `Phase <N>[.<M>]: <name>` with Goal, Depends on, Requirements,
// Success Criteria; the phase checklist and the Progress table are orchestrator-written and have no authority.
import { escapeRe, lf, readIf } from "./common.mjs";
import { comparePhase, padPhase, sharedFile } from "./planning.mjs";

const HEADING = /^(#{2,4})\s+Phase\s+(\d+(?:\.\d+)*)\s*[:\-–—]\s*(.+?)\s*$/;
const ANY_HEADING = /^(#{1,6})\s/;

const field = (line, name) => {
  const m = new RegExp(`^\\s*\\*\\*${name}(?::\\*\\*|\\*\\*\\s*(?:\\([^)]*\\))?\\s*:)\\s*(.*)$`, "i").exec(line);
  return m ? m[1].trim() : null;
};

const EMPTY_WORDS = /^(tbd|none|n\/a|-|—|nothing)$/i;
const RANGE = /(\.\.|–|—|\bto\b|(?<=\d)-(?=[A-Z]))/;

// The Requirements line: comma/space list; TBD or None = declared empty; malformed tokens warn, never vanish.
export function parseRequirementLine(value, idRegex) {
  const warnings = [];
  const src = String(value ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (src === "" || EMPTY_WORDS.test(src.replace(/[[\]`]/g, "").trim())) return { ids: [], declaredEmpty: src !== "", warnings };
  const re = new RegExp(idRegex);
  if (src.includes(";")) {
    const after = src.split(";").slice(1).join(";").split(/[\s,]+/).map((t) => t.replace(/[[\]`]/g, "")).filter(Boolean);
    warnings.push({ kind: "req-line-misparse", tokens: after, message: `Requirements line uses ';' as a separator; read ${after.join(", ")} as requirement ids (separate ids with commas)` });
  }
  const ids = [];
  for (const raw of src.replace(/[[\]]/g, " ").split(/[\s,;]+/)) {
    const token = raw.replace(/^`|`$/g, "").trim();
    if (!token || EMPTY_WORDS.test(token)) continue;
    if (re.test(token)) {
      ids.push(token);
      continue;
    }
    if (RANGE.test(token)) {
      warnings.push({ kind: "req-line-range-reading", tokens: [token], message: `Requirements token ${token} reads as a range; list each id` });
      continue;
    }
    warnings.push({ kind: "req-line-unverified", tokens: [token], message: `Requirements token ${token} does not match gsd.requirement_id_regex` });
    ids.push(token);
  }
  return { ids: [...new Set(ids)], declaredEmpty: false, warnings };
}

const dependsOn = (value) => (value === null || /^(nothing|none|-|—)\b/i.test(value) ? [] : [...value.matchAll(/\d+(?:\.\d+)*/g)].map((m) => m[0]));

function parseSection(lines, start, end, idRegex) {
  const out = { goal: null, depends_on: [], requirements: [], requirements_declared_empty: false, success_criteria: [], warnings: [] };
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    const goal = field(line, "Goal");
    if (goal !== null) out.goal = goal;
    const dep = field(line, "Depends on");
    if (dep !== null) out.depends_on = dependsOn(dep);
    const req = field(line, "Requirements");
    if (req !== null) {
      const parsed = parseRequirementLine(req, idRegex);
      out.requirements = parsed.ids;
      out.requirements_declared_empty = parsed.declaredEmpty;
      out.warnings.push(...parsed.warnings);
    }
    if (/^\s*\*\*Success Criteria/i.test(line)) {
      for (let j = i + 1; j < end; j++) {
        const item = /^\s*\d+\.\s+(.*)$/.exec(lines[j]);
        if (item) out.success_criteria.push(item[1].trim());
        else if (lines[j].trim() !== "") break;
      }
    }
  }
  return out;
}

// Parse ROADMAP text: phases in file order, the checklist and the scope of the reading (GSDC-14).
export function parseRoadmap(text, idRegex) {
  const lines = lf(text).split("\n");
  const heads = [];
  lines.forEach((line, i) => {
    const m = HEADING.exec(line);
    if (m) heads.push({ i, level: m[1].length, number: m[2], name: m[3].replace(/\s*\(INSERTED\)\s*$/i, "").trim(), inserted: /\(INSERTED\)/i.test(m[3]) });
  });
  const phases = heads.map((h, k) => {
    let end = lines.length;
    for (let i = h.i + 1; i < lines.length; i++) {
      const hm = ANY_HEADING.exec(lines[i]);
      if (hm && (hm[1].length <= h.level || HEADING.test(lines[i]))) {
        end = i;
        break;
      }
    }
    if (heads[k + 1] && heads[k + 1].i < end) end = heads[k + 1].i;
    return {
      number: h.number,
      padded: padPhase(h.number),
      phase_name: h.name,
      inserted: h.inserted,
      start: h.i,
      end,
      section: lines.slice(h.i, end).join("\n").trimEnd(),
      ...parseSection(lines, h.i, end, idRegex),
    };
  });
  const checklist = new Map();
  for (const line of lines) {
    const m = /^\s*-\s*\[([ xX])\]\s*\*\*Phase\s+(\d+(?:\.\d+)*)\s*[:\-–—]/.exec(line);
    if (m) checklist.set(padPhase(m[2]), m[1].toLowerCase() === "x");
  }
  const known = new Set(phases.map((p) => p.padded));
  const listedOnly = [...checklist.keys()].filter((p) => !known.has(p));
  const dupes = phases.filter((p, i) => phases.findIndex((q) => q.padded === p.padded) !== i).map((p) => p.number);
  let scope = "complete";
  if (phases.length === 0) scope = "unscoped";
  else if (listedOnly.length || dupes.length) scope = "truncated";
  return { lines, phases, checklist, scope, listedOnly, duplicates: dupes };
}

export function loadRoadmap(root, cfg) {
  const text = readIf(sharedFile(root, "ROADMAP.md"));
  if (text === null) return { exists: false, text: null, lines: [], phases: [], checklist: new Map(), scope: "unreadable", listedOnly: [], duplicates: [] };
  return { exists: true, text, ...parseRoadmap(text, cfg.gsd.requirement_id_regex) };
}

export const roadmapPhase = (roadmap, id) => roadmap.phases.find((p) => p.padded === padPhase(id)) ?? null;

export const phaseJson = (p) => ({
  found: true,
  phase_number: p.number,
  phase_name: p.phase_name,
  goal: p.goal,
  depends_on: p.depends_on,
  requirements: p.requirements,
  success_criteria: p.success_criteria,
  section: p.section,
  warnings: p.warnings,
});

export const slugify = (name, max = 40) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "phase";

// --- edits (callers hold the single writer, GSDC-12) ---

const replaceLines = (lines, start, end, insert) => [...lines.slice(0, start), ...insert, ...lines.slice(end)];

export function setChecklist(text, number, checked, date) {
  const re = new RegExp(`^(\\s*-\\s*)\\[[ xX]\\](\\s*\\*\\*Phase\\s+0*${escapeRe(String(number).replace(/^0+(?=\d)/, ""))}\\s*[:\\-–—].*?)(\\s*\\(completed [^)]*\\))?\\s*$`);
  return lf(text)
    .split("\n")
    .map((line) => {
      const m = re.exec(line);
      if (!m) return line;
      return `${m[1]}[${checked ? "x" : " "}]${m[2]}${checked && date ? ` (completed ${date})` : ""}`;
    })
    .join("\n");
}

export function setProgressRow(text, number, cells) {
  const num = String(number).replace(/^0+(?=\d)/, "");
  const re = new RegExp(`^\\|\\s*0*${escapeRe(num)}\\.\\s`);
  return lf(text)
    .split("\n")
    .map((line) => (re.test(line) ? `| ${num}. ${cells.join(" | ")} |` : line))
    .join("\n");
}

export function phaseSectionText({ number, name, inserted, goal, dependsOn }) {
  return [
    `### Phase ${number}: ${name}${inserted ? " (INSERTED)" : ""}`,
    `**Goal**: ${goal ?? "TBD"}`,
    `**Depends on**: ${dependsOn ? `Phase ${dependsOn}` : "Nothing (first phase)"}`,
    "**Requirements**: TBD",
    "**Success Criteria** (what must be TRUE):",
    "  1. TBD",
    "**Plans**: TBD",
    "",
  ];
}

// Insert a phase section after the section of `after` (or at the end of the phase list) plus its checklist and progress rows.
export function insertPhase(text, roadmap, { number, name, inserted, goal, dependsOn, after }) {
  let lines = lf(text).split("\n");
  const section = phaseSectionText({ number, name, inserted, goal, dependsOn });
  const anchor = after ?? roadmap.phases[roadmap.phases.length - 1];
  const at = anchor ? anchor.end : lines.length;
  const pad = at > 0 && lines[at - 1]?.trim() !== "" ? [""] : [];
  lines = replaceLines(lines, at, at, [...pad, ...section]);
  const checkLine = `- [ ] **Phase ${number}: ${name}**${inserted ? " (INSERTED)" : ""}`;
  const checks = lines.map((l, i) => (/^\s*-\s*\[[ xX]\]\s*\*\*Phase\s+(\d+(?:\.\d+)*)/.exec(l) ? { i, n: /Phase\s+(\d+(?:\.\d+)*)/.exec(l)[1] } : null)).filter(Boolean);
  if (checks.length) {
    const before = checks.filter((c) => comparePhase(c.n, number) < 0).pop() ?? null;
    const pos = before ? before.i + 1 : checks[0].i;
    lines = replaceLines(lines, pos, pos, [checkLine]);
  }
  const rows = lines.map((l, i) => (/^\|\s*(\d+(?:\.\d+)*)\.\s/.exec(l) ? { i, n: /^\|\s*(\d+(?:\.\d+)*)/.exec(l)[1] } : null)).filter(Boolean);
  if (rows.length) {
    const before = rows.filter((r) => comparePhase(r.n, number) < 0).pop() ?? null;
    const pos = before ? before.i + 1 : rows[0].i;
    lines = replaceLines(lines, pos, pos, [`| ${number}. ${name} | 0/0 | Not started | - |`]);
  }
  return lines.join("\n");
}

export function removePhaseText(text, roadmap, phase) {
  let lines = lf(text).split("\n");
  lines = replaceLines(lines, phase.start, phase.end, []);
  const num = String(phase.number);
  const drop = new RegExp(`^(\\s*-\\s*\\[[ xX]\\]\\s*\\*\\*Phase\\s+0*${escapeRe(num.replace(/^0+(?=\d)/, ""))}\\s*[:\\-–—]|\\|\\s*0*${escapeRe(num.replace(/^0+(?=\d)/, ""))}\\.\\s)`);
  return lines.filter((l) => !drop.test(l)).join("\n");
}

// Renumber `Phase X` mentions and progress rows through a mapping old -> new (phase remove).
export function renumberText(text, mapping) {
  const map = new Map([...mapping].map(([a, b]) => [padPhase(a), b]));
  const swap = (n) => map.get(padPhase(n)) ?? n;
  return lf(text)
    .replace(/(\bPhase\s+)(\d+(?:\.\d+)*)/g, (_, p, n) => `${p}${swap(n)}`)
    .replace(/^(\|\s*)(\d+(?:\.\d+)*)(\.\s)/gm, (_, a, n, b) => `${a}${swap(n)}${b}`)
    .replace(/\b(\d+(?:\.\d+)*)-(\d{2,})\b(?=[:\s-])/g, (all, n, m) => (map.has(padPhase(n)) ? `${padPhase(map.get(padPhase(n)))}-${m}` : all));
}

const DEP_BEGIN = "<!-- gsd:dependencies:begin -->";
const DEP_END = "<!-- gsd:dependencies:end -->";

// The phase section without its generated dependency block: annotate-dependencies writes that block after the plans
// are handed off, so it must not stale the revisions built on the section.
export function sectionContent(section) {
  const b = section.indexOf(DEP_BEGIN);
  const e = section.indexOf(DEP_END);
  if (b < 0 || e < b) return section;
  return `${section.slice(0, b)}${section.slice(e + DEP_END.length)}`.trimEnd();
}

// Replace (or add) the generated wave/constraint block at the end of a phase section; same input, same bytes.
export function annotateSection(text, phase, blockLines) {
  const lines = lf(text).split("\n");
  const section = lines.slice(phase.start, phase.end);
  const b = section.indexOf(DEP_BEGIN);
  const e = section.indexOf(DEP_END);
  let body = b >= 0 && e > b ? [...section.slice(0, b), ...section.slice(e + 1)] : section;
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  body = [...body, "", DEP_BEGIN, ...blockLines, DEP_END, ""];
  return replaceLines(lines, phase.start, phase.end, body).join("\n");
}
