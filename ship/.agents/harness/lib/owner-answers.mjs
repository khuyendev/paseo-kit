// The owner's typed answers to the stops of a phase (kit feedback 83 F3): `<phase dir>/owner-answers.json` is an append-only
// array of {id, kind, plan?, wave?, path?, config?, sha?, reason, at}, one shape for every answer verb (`halt clear`, `shared clear`,
// `request clear`, `allow` for a check weakening, kit feedback 87 C1, `commit adopt` for an owner commit, kit feedback 94, and
// `accepted confirm|resolve` for a checker issue forceProceed accepted, kit feedback 89, with {issue, decision}). Written only by
// gsd/owner-answers.mjs; gsd-execute reads it at start and applies what it has not taken
// yet, and `ph review-stats` counts it, so the orchestrator's answers are kit events and no hand edit of a state file.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf } from "./io.mjs";

export const OWNER_ANSWERS_FILE = "owner-answers.json";
export const ANSWER_KINDS = Object.freeze(["halt", "shared", "request", "allow", "commit", "accepted"]);

const PHASES_REL = ".planning/phases";
const valid = (x) => typeof x?.id === "string" && ANSWER_KINDS.includes(x.kind) && typeof x.reason === "string";

/** The answers of one owner-answers.json (an unreadable file or a malformed entry counts as `bad`). */
export function readAnswers(file) {
  let data = null;
  try {
    data = readJsonIf(file, null);
  } catch {
    return { answers: [], bad: 1 };
  }
  if (data === null) return { answers: [], bad: 0 };
  if (!Array.isArray(data)) return { answers: [], bad: 1 };
  return { answers: data.filter(valid), bad: data.filter((x) => !valid(x)).length };
}

/** Every answer of the project with its phase number (optionally one phase: "7" matches 07-*). */
export function projectAnswers(root, phase) {
  const answers = [];
  let bad = 0;
  const base = path.join(root, PHASES_REL);
  if (!fs.existsSync(base)) return { answers, bad };
  for (const dir of fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const nn = dir.split("-")[0];
    if (phase !== undefined && Number(nn) !== Number(phase)) continue;
    const r = readAnswers(path.join(base, dir, OWNER_ANSWERS_FILE));
    bad += r.bad;
    for (const x of r.answers) answers.push({ ...x, phase: nn });
  }
  return { answers, bad };
}

/** The report line of `ph review-stats` for the owner's answers; none when nothing was answered. */
export function answerLines(answers) {
  if (!answers.length) return [];
  const by = ANSWER_KINDS.map((kind) => [kind, answers.filter((x) => x.kind === kind).length]).filter(([, n]) => n);
  return [`owner answers ${answers.length}: ${by.map(([k, n]) => `${k} ${n}`).join(", ")}`];
}

/** Does a wave id of a run (`w2`, `gap-w2`, `batch`) match the wave an answer names (`2`, `w2`, `gap-w2`, `batch`)? */
export const waveMatches = (waveId, ref) => {
  const r = String(ref ?? "").trim();
  return Boolean(r) && (waveId === r || waveId === `w${r}` || waveId === `gap-w${r}`);
};
