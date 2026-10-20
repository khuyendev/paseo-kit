// new-project, quick and forensics plumbing: roadmapper draft check (GSDF-95), research SUMMARY self-heal
// (GSDF-09), quick task directories (GSDF-61) and dated forensics report paths (GSDF-63).
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { readJsonIf, readText, writeTextAtomic } from "../../harness/lib/io.mjs";

export const DRAFT_ROADMAP = ".planning/drafts/ROADMAP.md";
export const DRAFT_TRACE = ".planning/drafts/traceability.json";
export const SUMMARY = ".planning/research/SUMMARY.md";
export const WRITE_CONTINUE = "<!-- gsd:write-continue -->";
const SUMMARY_MARKERS = ["## Executive Summary", "## Key Findings", "## Implications for Roadmap"];

const readIf = (abs) => (fs.existsSync(abs) ? readText(abs) : null);

// v1 requirement ids of REQUIREMENTS.md: bullets `- [ ] **ID**: ...` or table rows `| ID | ...` under a v1 heading.
export function v1RequirementIds(text, idRegex) {
  const ids = [];
  let inV1 = false;
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) { inV1 = /\bv1\b/i.test(h[1]); continue; }
    if (!inV1) continue;
    const m = /^\s*-\s*\[[ xX]\]\s*\*\*([^*]+)\*\*/.exec(line) ?? /^\|\s*([^|\s][^|]*?)\s*\|/.exec(line);
    if (m && idRegex.test(m[1].trim())) ids.push(m[1].trim());
  }
  return [...new Set(ids)];
}

// Draft phases: heading `Phase N[.M]: name`, its Requirements line and numbered Success Criteria.
export function draftPhases(text) {
  const phases = [];
  let cur = null;
  let field = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{2,4}\s+Phase\s+(\d+(?:\.\d+)?)\s*:\s*(.+?)\s*$/.exec(line);
    if (h) { cur = { id: h[1], name: h[2], requirements: [], criteria: 0 }; phases.push(cur); field = null; continue; }
    if (/^#{1,4}\s/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const f = /^\s*\*\*([^*]+)\*\*:?\s*(.*)$/.exec(line);
    if (f) {
      field = f[1].replace(/:$/, "").trim().toLowerCase();
      if (field === "requirements") cur.requirements = f[2].split(/[,\s]+/).map((s) => s.replace(/[`[\]]/g, "")).filter((s) => s && !/^(tbd|none)$/i.test(s));
      continue;
    }
    if (field === "success criteria" && /^\s*\d+\.\s+\S/.test(line)) cur.criteria++;
  }
  return phases;
}

export function draftCheck(root) {
  const cfg = loadConfig(root);
  const idRegex = new RegExp(cfg.gsd.requirement_id_regex);
  const problems = [];
  const reqText = readIf(path.join(root, ".planning/REQUIREMENTS.md"));
  const draft = readIf(path.join(root, DRAFT_ROADMAP));
  const trace = readJsonIf(path.join(root, DRAFT_TRACE), null);
  if (reqText === null) problems.push(".planning/REQUIREMENTS.md missing");
  if (draft === null) problems.push(`${DRAFT_ROADMAP} missing`);
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) problems.push(`${DRAFT_TRACE} missing or not an object {requirement: phase}`);
  if (problems.length) return { ok: false, problems, unmapped: [], code: 1 };
  const v1 = v1RequirementIds(reqText, idRegex);
  const phases = draftPhases(draft);
  if (!phases.length) problems.push(`${DRAFT_ROADMAP}: no "Phase N: name" headings`);
  for (const p of phases) {
    if (p.criteria < 2 || p.criteria > 5) problems.push(`phase ${p.id}: ${p.criteria} success criteria (needs 2-5)`);
  }
  const unmapped = [];
  for (const id of v1) {
    const listed = phases.filter((p) => p.requirements.includes(id)).map((p) => p.id);
    if (!trace[id] || listed.length === 0) unmapped.push(id);
    else if (listed.length > 1) problems.push(`${id} is in ${listed.length} phases (${listed.join(", ")}); needs exactly one`);
    else if (String(trace[id]) !== listed[0]) problems.push(`${id}: traceability says phase ${trace[id]}, ROADMAP lists it in phase ${listed[0]}`);
  }
  if (unmapped.length) problems.push(`v1 requirements mapped to no phase: ${unmapped.join(", ")}`);
  return { ok: problems.length === 0, problems, unmapped, v1: v1.length, phases: phases.map(({ id, name, criteria }) => ({ id, name, criteria })), code: problems.length ? 1 : 0 };
}

const summaryUsable = (text) => text !== null && text.trim() !== "" && !text.includes(WRITE_CONTINUE);

// The synthesizer may fail to write the file but return the document inline; then the orchestrator writes it.
export function summaryHeal(root, reply) {
  const abs = path.join(root, SUMMARY);
  if (summaryUsable(readIf(abs))) return { ok: true, healed: false, path: SUMMARY };
  const doc = String(reply ?? "");
  if (SUMMARY_MARKERS.every((m) => doc.includes(m)) && !doc.includes(WRITE_CONTINUE)) {
    const start = doc.search(/^# /m);
    writeTextAtomic(abs, `${(start >= 0 ? doc.slice(start) : doc).trim()}\n`);
    return { ok: true, healed: true, path: SUMMARY };
  }
  return { ok: false, healed: false, path: SUMMARY, error: `${SUMMARY} missing, empty or unfinished and the reply holds no full summary`, code: 1 };
}

export const slugify = (text, max = 40) =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "") || "task";

const pad2 = (n) => String(n).padStart(2, "0");

export function quickDir(root, description, now = new Date()) {
  const day = `${String(now.getFullYear()).slice(2)}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const base = path.join(root, ".planning/quick");
  const taken = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith(`${day}-`)).length : 0;
  const id = `${day}-${(taken + 1).toString(36).padStart(3, "0")}`;
  const rel = `.planning/quick/${id}-${slugify(description)}`;
  fs.mkdirSync(path.join(root, rel), { recursive: true });
  return { id, dir: rel };
}

export function forensicsPath(root, description, now = new Date()) {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return { path: `.planning/forensics/${date}-${slugify(description)}.md` };
}
