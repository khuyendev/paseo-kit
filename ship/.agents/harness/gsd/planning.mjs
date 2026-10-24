// The .planning tree (GSDC-01, GSDC-06): phase ids, phase directories, artifact kinds, plans and their tasks.
import fs from "node:fs";
import path from "node:path";
import { isInside, samePath } from "../lib/paths.mjs";
import { asArray, isDir, none, readIf } from "./common.mjs";
import { frontmatter } from "./yaml.mjs";

export const planningDir = (root) => path.join(root, ".planning");
export const phasesDir = (root) => path.join(planningDir(root), "phases");
export const sharedFile = (root, name) => path.join(planningDir(root), name);
export const SHARED_FILES = ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"];

const PHASE_ID = /^\d+(?:\.\d+)*$/;

// `1` -> `01`, `1.1` -> `01.1`, `01.1` -> `01.1`; only the integer part is padded.
export function padPhase(id) {
  const s = String(id ?? "").trim();
  if (!PHASE_ID.test(s)) return null;
  const [head, ...rest] = s.split(".");
  return [String(Number(head)).padStart(2, "0"), ...rest.map((p) => String(Number(p)))].join(".");
}

// Numeric comparison of phase ids (2 < 2.1 < 2.2 < 3; 10 > 9).
export function comparePhase(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export const samePhase = (a, b) => padPhase(a) !== null && padPhase(a) === padPhase(b);

export const ARTIFACT_KINDS = {
  plan: /^(\d+(?:\.\d+)*)-(\d+)-PLAN\.md$/,
  summary: /^(\d+(?:\.\d+)*)-(\d+)-SUMMARY\.md$/,
  halt: /^(\d+(?:\.\d+)*)-(\d+)-HALT\.json$/,
  context: /^(\d+(?:\.\d+)*)-CONTEXT\.md$/,
  research: /^(\d+(?:\.\d+)*)-RESEARCH\.md$/,
  verification: /^(\d+(?:\.\d+)*)-VERIFICATION\.md$/,
  uat: /^(\d+(?:\.\d+)*)-UAT\.md$/,
  outline: /^(\d+(?:\.\d+)*)-PLAN-OUTLINE\.md$/,
  wiring: /^(\d+(?:\.\d+)*)-WIRING\.md$/,
  "outline-review": /^(\d+(?:\.\d+)*)-OUTLINE-REVIEW\.md$/,
};

export function artifactKind(name) {
  for (const [kind, re] of Object.entries(ARTIFACT_KINDS)) if (re.test(name)) return kind;
  return null;
}

// Phase directories `<NN>[.<M>]-<slug>` under .planning/phases, sorted by phase number.
export function listPhaseDirs(root) {
  const dir = phasesDir(root);
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+(?:\.\d+)*(-|$)/.test(e.name))
    .map((e) => {
      const number = /^(\d+(?:\.\d+)*)/.exec(e.name)[1];
      return { name: e.name, number, padded: padPhase(number), slug: e.name.slice(number.length + 1), dir: path.join(dir, e.name) };
    })
    .sort((a, b) => comparePhase(a.number, b.number));
}

// A phase by number (`1.1` finds `01.1-x`) or by its directory path inside .planning/phases.
export function findPhase(root, ref) {
  const padded = padPhase(ref);
  if (padded) return listPhaseDirs(root).find((p) => p.padded === padded) ?? null;
  const abs = path.resolve(root, String(ref ?? ""));
  if (!isInside(abs, phasesDir(root)) || !samePath(path.dirname(abs), phasesDir(root))) return null;
  return listPhaseDirs(root).find((p) => samePath(p.dir, abs)) ?? null;
}

export function requirePhase(root, ref) {
  const phase = findPhase(root, ref);
  if (!phase) throw none(`phase not found: ${ref}`);
  return phase;
}

export const phaseFile = (phase, suffix) => path.join(phase.dir, `${phase.padded}-${suffix}`);

export function listFiles(phase, kind) {
  if (!isDir(phase.dir)) return [];
  return fs
    .readdirSync(phase.dir)
    .filter((name) => ARTIFACT_KINDS[kind].test(name))
    .sort((a, b) => planSort(a, b));
}

const planSort = (a, b) => {
  const ma = /^(\d+(?:\.\d+)*)-(\d+)/.exec(a);
  const mb = /^(\d+(?:\.\d+)*)-(\d+)/.exec(b);
  if (ma && mb) return comparePhase(ma[1], mb[1]) || Number(ma[2]) - Number(mb[2]);
  return a.localeCompare(b);
};

export const planIdOf = (name) => name.replace(/-(PLAN\.md|SUMMARY\.md|HALT\.json)$/, "");

// Plan ids are `<NN>-<MM>`; compare them tolerant of padding (`1-1` equals `01-01`).
export function normPlanId(id) {
  const m = /^(\d+(?:\.\d+)*)-(\d+)$/.exec(String(id ?? "").trim());
  return m ? `${padPhase(m[1])}-${m[2].padStart(2, "0")}` : String(id ?? "").trim();
}

export const planIds = (phase) => listFiles(phase, "plan").map(planIdOf);
export const summaryIds = (phase) => listFiles(phase, "summary").map(planIdOf);
export const haltIds = (phase) => listFiles(phase, "halt").map(planIdOf);

export const planPath = (phase, id) => path.join(phase.dir, `${id}-PLAN.md`);
export const summaryPath = (phase, id) => path.join(phase.dir, `${id}-SUMMARY.md`);

const TASK_RE = /<task(\s[^>]{0,1000})?>((?:(?!<task[\s>])[\s\S])*?)<\/task>/g;

const attr = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs ?? "")?.[1] ?? null;

export function tag(text, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(text ?? "");
  return m ? m[1].trim() : null;
}

export const hasTag = (text, name) => new RegExp(`<${name}(\\s[^>]*)?>`).test(text ?? "");

// Each <automated> obligation with whether <fails_when> follows it immediately (GSDC-20).
function obligations(inner) {
  const out = [];
  const re = /<automated>([\s\S]*?)<\/automated>/g;
  let m;
  while ((m = re.exec(inner))) {
    const after = inner.slice(m.index + m[0].length);
    const fw = /^\s*<fails_when>([\s\S]*?)<\/fails_when>/.exec(after);
    out.push({ command: m[1].trim(), failsWhen: fw ? fw[1].trim() : null });
  }
  return out;
}

export function parseTasks(body) {
  const tasks = [];
  let m;
  let n = 0;
  TASK_RE.lastIndex = 0;
  while ((m = TASK_RE.exec(body ?? ""))) {
    n++;
    const inner = m[2];
    tasks.push({
      index: n,
      type: attr(m[1], "type") ?? "auto",
      attrs: m[1] ?? "",
      autoSelect: attr(m[1], "auto_select"),
      name: tag(inner, "name"),
      inner,
      automated: obligations(inner),
      reversibility: /<reversibility\s[^>]*rating\s*=\s*"([^"]*)"/.exec(inner)?.[1] ?? null,
    });
  }
  return tasks;
}

// The file a <shared_changes> line changes: its leading `path:` (`lib/main.dart: import x`). One rule for the parser, the
// handoff (`outline.mjs` sharedChangePaths) and the checker. A URL (`https://…`) is not a path.
const SHARED_LINE_PATH = /^\s*(?:[-*]\s+)?`?([^\s:`]+\.[A-Za-z0-9]+|[^\s:`]*\/[^\s:`]+)`?\s*:/;
export function sharedLinePath(line) {
  const text = String(line ?? "");
  const m = SHARED_LINE_PATH.exec(text);
  if (!m || /^[a-z]+:\/\//i.test(text.trim())) return null;
  return m[1].replace(/\\/g, "/").replace(/^\.\//, "");
}

// Kit feedback 105 F1: a block whose text is none / n/a / empty (any case), optionally followed by prose, and that names no
// file, is no shared change. `None. Catalog, primitives, route files remain with their owners.` is dropped; a block that also
// has a `path:` line is kept.
const ABSENT_SHARED = /^(?:none|n\/a|empty)\b/i;
export function absentSharedChange(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  if (!ABSENT_SHARED.test(t)) return false;
  return !t.split(/\r?\n/).some((line) => sharedLinePath(line));
}

export const sharedChanges = (body) => [...String(body ?? "").matchAll(/<shared_changes>([\s\S]*?)<\/shared_changes>/g)].map((m) => m[1].trim()).filter((text) => !absentSharedChange(text));

// G022: a `<path>: dependency <name> [<constraint>] [dev]` line of a <shared_changes> body declares a package the plan adds or
// changes. The line stays a file change of its path (gsd-execute applies it), and the dependency probe checks the declared set.
// A line that names no package has name null, so the check refuses it instead of skipping it.
export function sharedDependencies(body) {
  return String(body ?? "").split(/\r?\n/).flatMap((line) => {
    const m = /^\s*(?:[-*]\s+)?`?([^\s:`]+)`?\s*:\s*dependency(?:\s+(.*?))?\s*$/.exec(line);
    if (!m) return [];
    const rest = (m[2] ?? "").replace(/\s*\[dev\]$/, "");
    const [name, ...constraint] = rest.split(/\s+/);
    return [{ path: m[1].replace(/\\/g, "/"), name: name || null, constraint: constraint.join(" ") || null, dev: rest !== (m[2] ?? "") }];
  });
}

// Kit feedback 87 C1: a `<check_changes>` block declares up front, one line per file, a test or gate file whose checks the plan
// weakens on purpose (a deleted test, fewer assertions, an added skip): `<path>: <reason>` (a path holding spaces in backticks).
// The gate's check-weakening accepts exactly these paths; a line that does not parse has path null.
export function checkChanges(body) {
  return [...String(body ?? "").matchAll(/<check_changes>([\s\S]*?)<\/check_changes>/g)].flatMap((m) => m[1].split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const x = /^\s*(?:[-*]\s+)?(?:`([^`]+)`|([^\s:`]+))\s*:\s*(.*?)\s*$/.exec(line);
    return x ? { path: (x[1] ?? x[2]).trim().replace(/\\/g, "/").replace(/^\.\//, ""), reason: x[3], line: line.trim() } : { path: null, reason: "", line: line.trim() };
  }));
}

// A plan file read with its frontmatter, tasks and declared write sets.
export function readPlan(phase, id) {
  const file = planPath(phase, id);
  const text = readIf(file);
  if (text === null) return null;
  const parsed = frontmatter(text);
  const fm = parsed.fm;
  return {
    id,
    file,
    text,
    fm,
    body: parsed.body,
    error: parsed.error,
    tasks: parseTasks(parsed.body),
    wave: Number.isInteger(fm.wave) ? fm.wave : Number(fm.wave) || 1,
    dependsOn: asArray(fm.depends_on).map((d) => (/^\d+$/.test(String(d)) ? `${phase.padded}-${String(d).padStart(2, "0")}` : normPlanId(String(d)))),
    filesModified: asArray(fm.files_modified).map(String),
    filesDeleted: asArray(fm.files_deleted).map(String),
    owns: asArray(fm.owns).map(String),
    requirements: asArray(fm.requirements).map(String),
    sharedChanges: sharedChanges(parsed.body),
    checkChanges: checkChanges(parsed.body),
  };
}

export const readPlans = (phase, ids = planIds(phase)) => ids.map((id) => readPlan(phase, id)).filter(Boolean);

export function readArtifact(file) {
  const text = readIf(file);
  if (text === null) return null;
  return { file, text, ...frontmatter(text) };
}
