// `ph gsd halt clear` (G055, kit-feedback 27): the owner's answer to a halted plan. gsd-execute removes a HALT record
// only when it dispatches the plan, and a halted plan is never ready, so without this verb a rerun skips the plan and
// its dependants for good. The record moves into <phase>/halt-answers.json with the answer; the next gsd-execute run
// dispatches the plan again and hands every recorded answer of the plan to its executor. The worktree the halted executor
// left (kit feedback 75) moves with it as haltWorktree; the dispatch discards it.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { done, fail, none, rel } from "./common.mjs";
import { normPlanId } from "./planning.mjs";
import { appendAnswer } from "./owner-answers.mjs";
import { guardWriter } from "./state.mjs";

export const HALT_ANSWERS = "halt-answers.json";

export function haltClear(g, phase, planRef, answer) {
  guardWriter(g.env);
  if (!planRef) throw fail("halt clear needs --plan <id>");
  if (!String(answer ?? "").trim()) throw fail("halt clear needs --reason <the owner's answer, or what was resolved>");
  const id = /^\d+$/.test(planRef) ? `${phase.padded}-${String(planRef).padStart(2, "0")}` : normPlanId(planRef);
  const file = path.join(phase.dir, `${id}-HALT.json`);
  if (!fs.existsSync(file)) throw none(`no halt record for ${id} in ${rel(g.codeRoot, phase.dir)}`);
  let halt = {};
  try { halt = readJsonIf(file, null) ?? {}; } catch { halt = {}; } // an unreadable record is still cleared
  const answersFile = path.join(phase.dir, HALT_ANSWERS);
  const list = readJsonIf(answersFile, []);
  if (!Array.isArray(list)) throw fail(`${rel(g.codeRoot, answersFile)} is not a JSON array`);
  list.push({ plan: id, halt: halt?.reason ?? null, haltRunId: halt?.runId ?? null, ...(halt?.worktree ? { haltWorktree: halt.worktree } : {}), answer: String(answer).trim(), at: new Date().toISOString() });
  writeJsonAtomic(answersFile, list);
  fs.rmSync(file);
  appendAnswer(phase, { kind: "halt", plan: id, reason: String(answer).trim() });
  return done({ cleared: id, halt: halt?.reason ?? null, answer: String(answer).trim(), answers: rel(g.codeRoot, answersFile) });
}
