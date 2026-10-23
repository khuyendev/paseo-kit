// Kit feedback 89: the checker issues forceProceed accepted at planning are records, not only text in STATE. gsd-plan writes them
// at the override (flow verb accepted-record) to <phase>/accepted-issues.json: [{id: AI-n, run, reason, plan, plans (the other
// plans the issue text names), dimension, required_property, text, digests: {<plan>: plan text digest at the accept}, at}]. The
// owner answers each one with `ph gsd accepted confirm|resolve` (an owner answer {kind: accepted, issue, decision} in
// owner-answers.json, the latest answer of an issue wins); `ph gsd accepted list` shows them. gsd-execute reads them through
// exec-records: an open record stops the run before the executors of the plans it affects, and the executor of a plan gets the
// confirmed records of its plan in its brief. A record whose plan changed since the accept is `replanned` (the checker judged
// the new text), so resolving the contract and replanning needs no verb.
import fs from "node:fs";
import path from "node:path";
import { textDigest } from "../lib/hash.mjs";
import { readJsonIf, readText, writeJsonAtomic } from "../lib/io.mjs";
import { OWNER_ANSWERS_FILE, readAnswers } from "../lib/owner-answers.mjs";
import { done, fail, idList, none, nowIso, rel, withFileLock } from "./common.mjs";
import { appendAnswer } from "./owner-answers.mjs";
import { guardWriter } from "./state.mjs";

export const ACCEPTED_FILE = "accepted-issues.json";
export const ACCEPTED_DECISIONS = Object.freeze(["confirm", "resolve"]);
const PLAN_ID = /\b(\d+(?:\.\d+)?-\d+)\b/g;
const planFile = (dir, id) => path.join(dir, `${id}-PLAN.md`);
const planIdsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => /^(\d+(?:\.\d+)?-\d+)-PLAN\.md$/.exec(f)?.[1]).filter(Boolean).sort() : []);
const digestOf = (dir, id) => (fs.existsSync(planFile(dir, id)) ? textDigest(readText(planFile(dir, id))).slice(0, 12) : null);
const cut = (s, n = 600) => String(s ?? "").trim().slice(0, n);

/** The records of one phase directory (absolute); an unreadable file is an error, a missing one an empty list. */
export function readAccepted(dir) {
  const list = readJsonIf(path.join(dir, ACCEPTED_FILE), []);
  if (!Array.isArray(list)) throw new Error(`${ACCEPTED_FILE} is not a JSON array`);
  return list.filter((x) => typeof x?.id === "string");
}

/** gsd-plan's record of a forceProceed override: one record per accepted issue, the same issue on the same plan text once. */
export function recordAccepted(dir, { run = null, reason = "", issues = [] }) {
  if (!String(reason).trim()) throw new Error("accepted-record needs the forceProceed reason");
  if (!Array.isArray(issues)) throw new Error("accepted-record needs issues [{plan, dimension, description}]");
  const ids = planIdsIn(dir);
  let out = null;
  withFileLock(path.join(dir, `${ACCEPTED_FILE}.lock`), () => {
    const list = readAccepted(dir);
    const added = [];
    let n = list.reduce((m, x) => Math.max(m, Number(/^AI-(\d+)$/.exec(x.id)?.[1] ?? 0)), 0);
    for (const i of issues) {
      const plan = typeof i?.plan === "string" && i.plan.trim() ? i.plan.trim() : null;
      const text = cut(i?.description ?? i?.text);
      const named = [...`${text} ${i?.required_property ?? ""} ${i?.fix_hint ?? ""}`.matchAll(PLAN_ID)].map((m) => m[1]);
      const plans = [...new Set(named.filter((id) => id !== plan && ids.includes(id)))];
      const affected = plan ? [plan, ...plans] : plans.length ? plans : ids;
      const digests = Object.fromEntries(affected.map((id) => [id, digestOf(dir, id)]));
      const rec = { plan, plans, dimension: String(i?.dimension ?? "").trim().toLowerCase(), required_property: cut(i?.required_property, 300), text, digests };
      const same = (x) => JSON.stringify([x.plan, x.dimension, x.required_property, x.text, x.digests]) === JSON.stringify([rec.plan, rec.dimension, rec.required_property, rec.text, rec.digests]);
      if (list.some(same)) continue;
      const entry = { id: `AI-${++n}`, run, reason: cut(reason), ...rec, at: nowIso() };
      list.push(entry);
      added.push(entry.id);
    }
    if (added.length) writeJsonAtomic(path.join(dir, ACCEPTED_FILE), list);
    out = { added, total: list.length };
  });
  return out;
}

/** Each record with its status (open | confirmed | resolved | replanned), the plans it affects and the owner's answer. */
export function acceptedStatus(dir) {
  const answers = readAnswers(path.join(dir, OWNER_ANSWERS_FILE)).answers.filter((x) => x.kind === "accepted");
  const ids = planIdsIn(dir);
  return readAccepted(dir).map((x) => {
    const answer = answers.filter((a) => a.issue === x.id).at(-1) ?? null;
    const own = x.plan ? [x.plan] : Object.keys(x.digests ?? {});
    const replanned = own.some((id) => (x.digests ?? {})[id] !== undefined && digestOf(dir, id) !== x.digests[id]);
    const status = answer ? (answer.decision === "confirm" ? "confirmed" : "resolved") : replanned ? "replanned" : "open";
    const affects = x.plan ? [x.plan, ...(x.plans ?? [])] : (x.plans ?? []).length ? x.plans : ids;
    return { ...x, status, affects, ...(answer ? { answer: { id: answer.id, decision: answer.decision, reason: answer.reason, at: answer.at } } : {}) };
  });
}

// ---- ph gsd accepted list | confirm | resolve ----

export function acceptedList(g, phase) {
  const list = acceptedStatus(phase.dir);
  const open = list.filter((x) => x.status === "open");
  return done({ phase: phase.number, file: rel(g.codeRoot, path.join(phase.dir, ACCEPTED_FILE)), issues: list, open: open.map((x) => x.id), ...(open.length ? { next: `gsd-execute stops before the plans of ${open.map((x) => x.id).join(", ")}: resolve the contract and replan (gsd-plan ${phase.number}), or answer each with ph gsd accepted confirm|resolve ${phase.number} --id <AI-n> --reason <text>` } : {}) });
}

export function acceptedAnswer(g, phase, decision, { id, reason }) {
  guardWriter(g.env);
  if (!ACCEPTED_DECISIONS.includes(decision)) throw fail(`accepted ${decision}: one of list, ${ACCEPTED_DECISIONS.join(", ")}`);
  const wanted = id === undefined ? [] : idList(id);
  if (!wanted.length) throw fail(`accepted ${decision} needs --id <AI-n>[,<AI-m>] (ph gsd accepted list ${phase.number})`);
  const why = String(reason ?? "").trim();
  if (!why) throw fail(`accepted ${decision} needs --reason <${decision === "confirm" ? "why the plan runs with the accepted issue" : "how the issue was resolved"}>`);
  const list = acceptedStatus(phase.dir);
  const missing = wanted.filter((x) => !list.some((r) => r.id === x));
  if (missing.length) throw none(`no accepted issue ${missing.join(", ")} in ${rel(g.codeRoot, path.join(phase.dir, ACCEPTED_FILE))}${list.length ? ` (recorded: ${list.map((r) => `${r.id} ${r.status}`).join(", ")})` : ""}`);
  const entries = wanted.map((issue) => appendAnswer(phase, { kind: "accepted", issue, decision, reason: why }));
  return done({ answered: entries.map((e) => e.id), kind: "accepted", decision, issues: wanted, reason: why, answers: rel(g.codeRoot, path.join(phase.dir, OWNER_ANSWERS_FILE)), next: decision === "confirm" ? "rerun gsd-execute with the same args; the executors of the affected plans get the issue in their brief" : "rerun gsd-execute with the same args" });
}
