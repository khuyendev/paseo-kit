// new-project, quick and forensics plumbing: roadmapper draft check (GSDF-95), research SUMMARY self-heal
// (GSDF-09), quick task directories (GSDF-61) and dated forensics report paths (GSDF-63).
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { resolveInside } from "../../harness/lib/paths.mjs";
import { fingerprint, readVerification } from "../../harness/gsd/status.mjs";
import { readJsonIf, readText, writeTextAtomic } from "../../harness/lib/io.mjs";
import { validateDraft, v1RequirementIds } from "../../harness/gsd/draft.mjs";
export { v1RequirementIds };

export const DRAFT_ROADMAP = ".planning/drafts/ROADMAP.md";
export const DRAFT_TRACE = ".planning/drafts/traceability.json";
export const SUMMARY = ".planning/research/SUMMARY.md";
export const WRITE_CONTINUE = "<!-- gsd:write-continue -->";
const SUMMARY_MARKERS = ["## Executive Summary", "## Key Findings", "## Implications for Roadmap"];

const readIf = (abs) => (fs.existsSync(abs) ? readText(abs) : null);



export function draftCheck(root) {
  const cfg = loadConfig(root);
  const problems = [];
  const reqText = readIf(path.join(root, ".planning/REQUIREMENTS.md"));
  const draft = readIf(path.join(root, DRAFT_ROADMAP));
  const trace = readJsonIf(path.join(root, DRAFT_TRACE), null);
  if (reqText === null) problems.push(".planning/REQUIREMENTS.md missing");
  if (draft === null) problems.push(`${DRAFT_ROADMAP} missing`);
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) problems.push(`${DRAFT_TRACE} missing or not an object {requirement: phase}`);
  if (problems.length) return { ok: false, problems, unmapped: [], code: 1 };
  return validateDraft(reqText, draft, trace, cfg.gsd.requirement_id_regex);
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

// Quick reports use the same status/fingerprint contract as phase verification (GSDF-61).
export function quickVerification(root, dir, action) {
  if (!/^\.planning\/quick\/\d{6}-[0-9a-z]{3}-[a-z0-9-]+$/.test(dir)) throw new Error("invalid quick directory");
  const id = dir.split("/").pop().slice(0, 10);
  const phase = { dir: resolveInside(root, dir), padded: id };
  if (action === "fingerprint") return fingerprint(root, phase, [`${dir}/${id}-PLAN.md`, `${dir}/${id}-SUMMARY.md`]);
  const v = readVerification(root, phase);
  return { ...v, code: v.valid && !v.stale ? 0 : 1 };
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
