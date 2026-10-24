// The hand-edit log of a phase (kit feedback 68): `<phase dir>/hand-edits.json` lists what the orchestrator or the owner
// changed outside the flow, with the cause category once someone answered. Written only by gsd/hand-edits.mjs; this
// module reads it, for `ph gsd hand-edit` and `ph review-stats`, and counts it. Measurement only: no decision reads it.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf } from "./io.mjs";

export const HAND_EDITS_FILE = "hand-edits.json";
export const CATEGORIES = Object.freeze(["contract-drift", "wrong-api", "owns-reach", "test-fixture", "other"]);
// A category (but `other`, which names no class) logged this many times in a project is a kit defect candidate.
export const CANDIDATE_AT = 2;

const PHASES_REL = ".planning/phases";
const valid = (e) => typeof e?.id === "string" && typeof e.key === "string" && Array.isArray(e.files);

/** The edits of one hand-edits.json (an unreadable file or a malformed entry counts as `bad`). */
export function readEdits(file) {
  let data = null;
  try {
    data = readJsonIf(file, null);
  } catch {
    return { edits: [], bad: 1 };
  }
  if (data === null) return { edits: [], bad: 0 };
  const list = Array.isArray(data?.edits) ? data.edits : [];
  return { edits: list.filter(valid), bad: Array.isArray(data?.edits) ? list.filter((e) => !valid(e)).length : 1 };
}

/** Every edit of the project with its phase number (optionally one phase: "7" matches 07-*). */
export function projectEdits(root, phase) {
  const edits = [];
  let bad = 0;
  const base = path.join(root, PHASES_REL);
  if (!fs.existsSync(base)) return { edits, bad };
  for (const dir of fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const nn = dir.split("-")[0];
    if (phase !== undefined && Number(nn) !== Number(phase)) continue;
    const r = readEdits(path.join(base, dir, HAND_EDITS_FILE));
    bad += r.bad;
    for (const e of r.edits) edits.push({ ...e, phase: nn });
  }
  return { edits, bad };
}

const logged = (e) => CATEGORIES.includes(e.category);

/** Counts per category and phase, the unanswered ones, and the categories that reached CANDIDATE_AT (counted over the edits given). */
export function summarize(edits) {
  const answered = edits.filter(logged);
  const byCategory = CATEGORIES.map((category) => {
    const mine = answered.filter((e) => e.category === category);
    return { category, count: mine.length, phases: [...new Set(mine.map((e) => e.phase).filter(Boolean))].sort(), notes: mine.map((e) => e.note).filter(Boolean) };
  }).filter((c) => c.count);
  const candidates = byCategory.filter((c) => c.category !== "other" && c.count >= CANDIDATE_AT);
  return { logged: answered.length, pending: edits.length - answered.length, byCategory, candidates };
}

export const candidateLine = (c) => `kit defect candidate: ${c.category} seen ${c.count} times${c.phases.length ? ` (phase ${c.phases.join(", ")})` : ""}${c.notes.length ? `: ${c.notes.slice(-2).join(" | ")}` : ""}`;

/** The report lines of `ph review-stats` for the hand fixes; none when nothing was recorded. */
export function handEditLines(edits) {
  if (!edits.length) return [];
  const s = summarize(edits);
  const lines = [`hand fixes ${s.logged}${s.pending ? `, ${s.pending} not logged yet (ph gsd hand-edit record <phase> <id> --category ${CATEGORIES.join("|")} --note <one line, at most 300 characters>)` : ""}: ${s.byCategory.map((c) => `${c.category} ${c.count}`).join(", ") || "none logged"}`];
  const phases = [...new Set(edits.map((e) => e.phase))].sort();
  if (phases.length > 1) for (const p of phases) {
    const mine = summarize(edits.filter((e) => e.phase === p));
    lines.push(`phase ${p}: hand fixes ${mine.logged}${mine.pending ? `, ${mine.pending} not logged` : ""}${mine.byCategory.length ? ` (${mine.byCategory.map((c) => `${c.category} ${c.count}`).join(", ")})` : ""}`);
  }
  for (const c of s.candidates) lines.push(candidateLine(c));
  return lines;
}
