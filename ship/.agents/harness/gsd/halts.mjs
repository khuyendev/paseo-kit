// `ph gsd halt clear` (G055, kit-feedback 27): the owner's answer to a halted plan. gsd-execute removes a HALT record
// only when it dispatches the plan, and a halted plan is never ready, so without this verb a rerun skips the plan and
// its dependants for good. The record moves into <phase>/halt-answers.json with the answer; the next gsd-execute run
// dispatches the plan again and hands every recorded answer of the plan to its executor. The worktree the halted executor
// left (kit feedback 75) moves with it as haltWorktree; the dispatch discards it. With --resume (kit feedback 79) the owner says the
// halted executor's finished work stands: the entry carries resume, and the next run transfers that worktree instead of dispatching.
// Only a halt record marked finished (an owner-decision halt whose worktree holds the SUMMARY) and whose worktree is still there qualifies;
// a record of an older kit names no worktree, so resumeCheck looks it up (kit feedback 90).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeJsonAtomic } from "../lib/io.mjs";
import { isInside, toSlash } from "../lib/paths.mjs";
import { listHarnessWorktrees, repoTop } from "../runtime/worktrees.mjs";
import { DEFAULT_RUNS_DIR, readJournal } from "../workflow/journal.mjs";
import { done, fail, none, rel } from "./common.mjs";
import { normPlanId, summaryPath } from "./planning.mjs";
import { appendAnswer } from "./owner-answers.mjs";
import { guardWriter } from "./state.mjs";

export const HALT_ANSWERS = "halt-answers.json";

const shown = (root, p) => (isInside(p, root) ? toSlash(path.relative(root, p)) : toSlash(p));

// The executor worktrees a halt record of an older kit (no `worktree` field) may have left, most likely first: the worktree of the
// run journal's last executor call of the plan (`exec-<plan>`, worktree.path), then the harness worktrees named after the run.
function lookedUp(root, cfg, id, runId, runsRoot) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(runId ?? ""))) return [];
  const out = [];
  const journal = path.join(runsRoot, DEFAULT_RUNS_DIR, runId, "journal.jsonl");
  try {
    const call = fs.existsSync(journal) ? readJournal(journal).filter((e) => e.label === `exec-${id}` && e.worktree?.path).at(-1) : null;
    if (call) out.push({ path: path.resolve(root, call.worktree.path), found: "journal" });
  } catch { /* an unreadable journal names no tree */ }
  try {
    const top = repoTop(root);
    if (top) for (const wt of listHarnessWorktrees(top, cfg)) if (!wt.missing && wt.name.startsWith(`${runId}-`)) out.push({ path: wt.path, found: "worktrees" });
  } catch { /* no harness worktree list */ }
  return out;
}

// Kit feedback 90: whether `halt clear --resume` takes the halt of plan `id`: {ok, worktree, found?} or {ok: false, why}. A record of
// this kit names its worktree and whether it holds a finished result (`finished`); a record of an older kit has neither, so its tree
// is looked up (lookedUp) and qualifies when it holds the plan's SUMMARY. Shared by the verb and `kit.mjs update` (open halts listed).
export function resumeCheck(root, cfg, phase, id, halt, runsRoot = root) {
  const summary = rel(root, summaryPath(phase, id));
  const holds = (abs) => fs.existsSync(path.join(abs, summary));
  if (!halt || typeof halt !== "object") return { ok: false, why: `the halt record of ${id} is unreadable` };
  if (Object.hasOwn(halt, "worktree")) {
    if (halt.finished !== true || !halt.worktree) return { ok: false, why: `the halt of ${id} has no finished executor worktree (${halt.reason ?? "unreadable record"})` };
    if (!fs.existsSync(path.resolve(root, halt.worktree))) return { ok: false, why: `the worktree ${halt.worktree} of ${id} is gone` };
    return { ok: true, worktree: halt.worktree };
  }
  if (halt.finished === false) return { ok: false, why: `the halt of ${id} has no finished executor worktree (${halt.reason ?? "no reason recorded"})` };
  const trees = lookedUp(root, cfg, id, halt.runId, runsRoot);
  const hit = trees.find((t) => t.found === "journal" && holds(t.path)) ?? (() => {
    const named = trees.filter((t) => t.found === "worktrees" && holds(t.path));
    return named.length === 1 ? named[0] : null;
  })();
  if (hit) return { ok: true, worktree: shown(root, hit.path), found: hit.found };
  const seen = [...new Set(trees.map((t) => shown(root, t.path)))];
  return { ok: false, why: `the halt of ${id} has no finished executor worktree (${halt.reason ?? "no reason recorded"}): the record names none (an older kit), and ${seen.length ? `no single tree of run ${halt.runId} holds ${summary} (${seen.join(", ")})` : `neither the journal of run ${halt.runId ?? "(none recorded)"} nor the harness worktrees name one`}` };
}

export function haltClear(g, phase, planRef, answer, resume = false) {
  guardWriter(g.env);
  if (!planRef) throw fail("halt clear needs --plan <id>");
  if (!String(answer ?? "").trim()) throw fail("halt clear needs --reason <the owner's answer, or what was resolved>");
  const id = /^\d+$/.test(planRef) ? `${phase.padded}-${String(planRef).padStart(2, "0")}` : normPlanId(planRef);
  const file = path.join(phase.dir, `${id}-HALT.json`);
  if (!fs.existsSync(file)) throw none(`no halt record for ${id} in ${rel(g.codeRoot, phase.dir)}`);
  let halt = {};
  try { halt = readJsonIf(file, null) ?? {}; } catch { halt = {}; } // an unreadable record is still cleared
  const check = resume ? resumeCheck(g.codeRoot, g.cfg, phase, id, halt, g.harnessRoot ?? g.codeRoot) : null;
  if (check && !check.ok) throw fail(`halt clear --resume: ${check.why}; clear it without --resume and the plan runs again`);
  const tree = check?.worktree ?? halt?.worktree;
  const answersFile = path.join(phase.dir, HALT_ANSWERS);
  const list = readJsonIf(answersFile, []);
  if (!Array.isArray(list)) throw fail(`${rel(g.codeRoot, answersFile)} is not a JSON array`);
  list.push({ plan: id, halt: halt?.reason ?? null, haltRunId: halt?.runId ?? null, ...(tree ? { haltWorktree: tree } : {}), ...(resume ? { resume: true } : {}), answer: String(answer).trim(), at: new Date().toISOString() });
  writeJsonAtomic(answersFile, list);
  fs.rmSync(file);
  appendAnswer(phase, { kind: "halt", plan: id, reason: String(answer).trim() });
  return done({ cleared: id, halt: halt?.reason ?? null, answer: String(answer).trim(), ...(resume ? { resume: true, worktree: tree, ...(check.found ? { found: check.found } : {}) } : {}), answers: rel(g.codeRoot, answersFile) });
}
