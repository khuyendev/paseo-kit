// `ph gsd halt clear` (G055, kit-feedback 27): the owner's answer to a halted plan. gsd-execute removes a HALT record
// only when it dispatches the plan, and a halted plan is never ready, so without this verb a rerun skips the plan and
// its dependants for good. The record moves into <phase>/halt-answers.json with the answer; the next gsd-execute run
// dispatches the plan again and hands every recorded answer of the plan to its executor. The worktree the halted executor
// left (kit feedback 75) moves with it as haltWorktree; the dispatch discards it. With --resume (kit feedback 79) the owner says the
// halted executor's finished work stands: the entry carries resume, and the next run transfers that worktree instead of dispatching.
// Only a halt record marked finished (an owner-decision halt whose worktree holds the SUMMARY) and whose worktree is still there qualifies.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { done, fail, none, rel } from "./common.mjs";
import { normPlanId } from "./planning.mjs";
import { guardWriter } from "./state.mjs";

export const HALT_ANSWERS = "halt-answers.json";

export function haltClear(g, phase, planRef, answer, resume = false) {
  guardWriter(g.env);
  if (!planRef) throw fail("halt clear needs --plan <id>");
  if (!String(answer ?? "").trim()) throw fail("halt clear needs --reason <the owner's answer, or what was resolved>");
  const id = /^\d+$/.test(planRef) ? `${phase.padded}-${String(planRef).padStart(2, "0")}` : normPlanId(planRef);
  const file = path.join(phase.dir, `${id}-HALT.json`);
  if (!fs.existsSync(file)) throw none(`no halt record for ${id} in ${rel(g.codeRoot, phase.dir)}`);
  let halt = {};
  try { halt = readJsonIf(file, null) ?? {}; } catch { halt = {}; } // an unreadable record is still cleared
  if (resume) {
    if (halt?.finished !== true || !halt?.worktree) throw fail(`halt clear --resume: the halt of ${id} has no finished executor worktree (${halt?.reason ?? "unreadable record"}); clear it without --resume and the plan runs again`);
    if (!fs.existsSync(path.resolve(g.codeRoot, halt.worktree))) throw fail(`halt clear --resume: the worktree ${halt.worktree} of ${id} is gone; clear it without --resume and the plan runs again`);
  }
  const answersFile = path.join(phase.dir, HALT_ANSWERS);
  const list = readJsonIf(answersFile, []);
  if (!Array.isArray(list)) throw fail(`${rel(g.codeRoot, answersFile)} is not a JSON array`);
  list.push({ plan: id, halt: halt?.reason ?? null, haltRunId: halt?.runId ?? null, ...(halt?.worktree ? { haltWorktree: halt.worktree } : {}), ...(resume ? { resume: true } : {}), answer: String(answer).trim(), at: new Date().toISOString() });
  writeJsonAtomic(answersFile, list);
  fs.rmSync(file);
  return done({ cleared: id, halt: halt?.reason ?? null, answer: String(answer).trim(), ...(resume ? { resume: true, worktree: halt.worktree } : {}), answers: rel(g.codeRoot, answersFile) });
}
