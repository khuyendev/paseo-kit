// The typed answer verbs of the stops of gsd-execute (kit feedback 82, 85, 83 F3): `ph gsd shared clear` answers an Integration
// stop (shared changes the owner made, or accepts, by hand) and `ph gsd request clear` a cross-plan request that a Commit stop
// lists. A verb never edits execute-progress.json (its one writer is workflows/lib/flow-state.mjs, kit feedback 87): it reads it
// through lib/execute-state.mjs, appends the answer to <phase>/owner-answers.json and the next gsd-execute run takes it with state-answer
// (lib/owner-answers.mjs holds the shape). `halt clear` appends its answer here too.
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { STATE_FILE, readStateFile } from "../lib/execute-state.mjs";
import { OWNER_ANSWERS_FILE, readAnswers, waveMatches } from "../lib/owner-answers.mjs";
import { done, fail, none, nowIso, rel, withFileLock } from "./common.mjs";
import { normPlanId } from "./planning.mjs";
import { guardWriter } from "./state.mjs";

export const answersFile = (phase) => path.join(phase.dir, OWNER_ANSWERS_FILE);
const slash = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
const nextId = (list) => `OA-${list.reduce((n, x) => Math.max(n, Number(/^OA-(\d+)$/.exec(x.id)?.[1] ?? 0)), 0) + 1}`;
const reasonOf = (reason, verb) => {
  const text = String(reason ?? "").trim();
  if (!text) throw fail(`${verb} needs --reason <what was done or why it is accepted>`);
  return text;
};

/** Appends one answer (id and time added) and returns it; the only writer of owner-answers.json. */
export function appendAnswer(phase, entry) {
  let made = null;
  withFileLock(`${answersFile(phase)}.lock`, () => {
    const file = answersFile(phase);
    const list = readJsonIf(file, []);
    if (!Array.isArray(list)) throw fail(`${file} is not a JSON array`);
    made = { id: nextId(list), ...entry, at: nowIso() };
    writeJsonAtomic(file, [...list, made]);
  });
  return made;
}

// What execute-progress.json holds open now, read only and typed (a record of an older kit is migrated in memory).
const progressOf = (phase) => readStateFile(path.join(phase.dir, STATE_FILE)).state;
// The answers of a kind that no run has taken yet (progress.answered lists the taken ids).
const untaken = (phase, kind) => {
  const taken = new Set(progressOf(phase).answered ?? []);
  return readAnswers(answersFile(phase)).answers.filter((x) => x.kind === kind && !taken.has(x.id));
};

// What one cleared entry looks like in the verb result (kit feedback 105 F2): the entry and the applied state it has now.
const clearedEntry = (s) => ({ id: s.id ?? null, from: s.from ?? null, path: s.path ?? null, change: s.change ?? null, applied: s.applied === true });
// An answer with no path text clears entries that name no file (a new answer stores path: null). An answer a kit before this one
// wrote has no path key at all and still clears every open entry; state-answer tells them apart.
const filelessAnswer = (x) => !String(x.path ?? "").trim();

export function sharedClear(g, phase, waveRef, { path: filePath, reason }) {
  guardWriter(g.env);
  if (!waveRef) throw fail("shared clear needs a wave: ph gsd shared clear <phase> <wave> [--path <file>] --reason <text>");
  const why = reasonOf(reason, "shared clear");
  const want = filePath === undefined ? null : slash(filePath);
  if (filePath !== undefined && !want) throw fail("shared clear --path needs a file");
  const open = (progressOf(phase).shared ?? []).filter((s) => s && !s.applied);
  const waveOpen = open.filter((s) => s.wave === undefined || waveMatches(s.wave, waveRef));
  // Kit feedback 105 F2: without --path only a change that names no file is cleared. Unapplied changes that name a file stay, and
  // the verb refuses rather than drop them; it names each file and the --path form.
  if (want === null) {
    const named = [...new Set(waveOpen.filter((s) => s.path).map((s) => slash(s.path)))];
    if (named.length) throw fail(`shared clear without --path clears only a change that names no file; wave ${waveRef} still has unapplied changes with a file: ${named.join(", ")}. Clear each with ph gsd shared clear <phase> ${waveRef} --path <file> --reason <text>`);
  }
  const mine = waveOpen.filter((s) => (want === null ? !s.path : slash(s.path) === want));
  const pending = untaken(phase, "shared").filter((x) => waveMatches(x.wave, waveRef) && (want === null ? filelessAnswer(x) : x.path === want));
  if (!mine.length) {
    const left = open.map((s) => `${s.wave ?? "?"}: ${s.path ?? "(no file)"}`);
    throw none(`no open shared change${want ? ` for ${want}` : ""} in wave ${waveRef} of ${rel(g.codeRoot, phase.dir)}${left.length ? ` (open: ${left.join("; ")})` : ""}${pending.length ? `; ${pending.map((x) => x.id).join(", ")} already answers it and the next run takes it` : ""}`);
  }
  // path: null (not an omitted key) so a record already written without path keeps meaning "every open entry of the wave".
  const entry = appendAnswer(phase, { kind: "shared", wave: String(waveRef).trim(), ...(want ? { path: want } : { path: null }), reason: why });
  return done({ answered: entry.id, kind: "shared", wave: entry.wave, ...(want ? { path: want } : { path: null }), clears: mine.map(clearedEntry), reason: why, answers: rel(g.codeRoot, answersFile(phase)), next: "rerun gsd-execute with the same args; the run takes this answer first" });
}

export function requestClear(g, phase, planRef, { path: filePath, reason }) {
  guardWriter(g.env);
  if (!planRef) throw fail("request clear needs --plan <id>, the plan that owns the requested file");
  if (!String(filePath ?? "").trim()) throw fail("request clear needs --path <the requested file>");
  const why = reasonOf(reason, "request clear");
  const id = /^\d+$/.test(planRef) ? `${phase.padded}-${String(planRef).padStart(2, "0")}` : normPlanId(planRef);
  const want = slash(filePath);
  const requests = progressOf(phase).requests ?? {};
  const open = requests[id] ?? [];
  const mine = open.filter((q) => slash(q.path) === want);
  if (!mine.length) {
    const left = Object.entries(requests).flatMap(([plan, list]) => list.map((q) => `${plan} ${slash(q.path)}`));
    throw none(`no open request for ${want} owned by ${id} in ${rel(g.codeRoot, phase.dir)}${left.length ? ` (open: ${left.join("; ")})` : ""}`);
  }
  const entry = appendAnswer(phase, { kind: "request", plan: id, path: want, reason: why });
  return done({ answered: entry.id, kind: "request", plan: id, path: want, clears: mine.map((q) => ({ from: q.from ?? null, change: q.change ?? null })), reason: why, answers: rel(g.codeRoot, answersFile(phase)), next: "rerun gsd-execute with the same args; the run takes this answer first" });
}
