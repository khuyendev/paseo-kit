// Kit feedback 99: the owner's planning decisions and the research questions put to the owner before the outline.
// `ph gsd decide` (F1) answers a planner's REVISION_CONFLICT or owner marker, a skeleton stop or a research scope question with a
// decision of its own: {kind: decision} in <phase>/owner-answers.json, never a CONTEXT.md edit (CONTEXT stays the discuss output
// and a research input). The decisions are no research input; a decision naming plans re-plans only those plans, one with
// --outline the outline (revisions.mjs). `ph gsd research questions` (F2) lists the Open Questions of RESEARCH.md that ask for a
// scope or requirement decision and are not answered yet; gsd-plan stops at Discuss on them before it writes an outline.
import { textDigest } from "../lib/hash.mjs";
import { phaseDecisions, readAnswers } from "../lib/owner-answers.mjs";
import { done, fail, idList, lf, none, readIf, rel } from "./common.mjs";
import { answersFile, appendAnswer } from "./owner-answers.mjs";
import { readOutline } from "./outline.mjs";
import { parseDecisions } from "./plan-checks.mjs";
import { normPlanId, phaseFile, planIds, requirePhase } from "./planning.mjs";
import { guardWriter } from "./state.mjs";

const QUESTIONS_HEAD = /^(#{2,3})\s+Open Questions\b(.*)$/i;
// A scope question: tagged [SCOPE], or its title names a requirement, the scope, a split, a deferral or the phase boundary.
const SCOPE_WORDS = /\b(requirements?|scope[sd]?|splits?|defer(?:s|red|ral)?|descop\w*|phase[- ]boundar\w*|later phase|out of phase)\b/i;

// The items of the first `## Open Questions` section: {n, title, key, scope, resolved, text}. Upstream conventions: a heading
// `(RESOLVED)` closes the section, an inline RESOLVED closes the item. `key` is the digest of the title a decision answers.
export function openQuestions(text) {
  const lines = lf(text ?? "").split("\n");
  const start = lines.findIndex((l) => QUESTIONS_HEAD.test(l));
  if (start < 0) return [];
  const [, level, rest] = QUESTIONS_HEAD.exec(lines[start]);
  const items = [];
  for (const line of lines.slice(start + 1)) {
    const h = /^(#{1,6})\s/.exec(line);
    if (h && h[1].length <= level.length) break;
    const m = /^(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) items.push([m[1]]);
    else if (items.length && line.trim()) items.at(-1).push(line.trim());
  }
  return items.map((parts, i) => {
    const body = parts.join(" ").replace(/\s+/g, " ").trim();
    const bold = /^\*\*(.+?)\*\*/.exec(body);
    const title = (bold ? bold[1] : body.split(/(?<=[.?!:])\s/)[0]).replace(/^\[|\]$/g, "").replace(/[\s:.]+$/, "").trim().slice(0, 160);
    return { n: i + 1, title, key: textDigest(title.toLowerCase()).slice(0, 12), scope: /\[SCOPE\]/i.test(body) || SCOPE_WORDS.test(title), resolved: /\(RESOLVED\)/i.test(rest) || /\bRESOLVED\b/.test(body), text: body.slice(0, 400) };
  });
}

const answersOf = (phase) => readAnswers(answersFile(phase)).answers;
const pad = (n) => `D-${String(n).padStart(2, "0")}`;
const contextIds = (phase) => parseDecisions(readIf(phaseFile(phase, "CONTEXT.md")) ?? "").decisions.map((d) => d.id);
// The next free decision id after every D-NN of CONTEXT.md and of the recorded decisions.
const nextId = (phase) => pad(Math.max(0, ...[...contextIds(phase), ...phaseDecisions(answersOf(phase)).map((d) => d.decision)].map((id) => Number(/^D-(\d+)$/.exec(id)?.[1] ?? 0))) + 1);

/** The scope questions of the phase's research and whether a decision answered them (any decision that named one, replaced or not). */
export function scopeQuestions(phase) {
  const text = readIf(phaseFile(phase, "RESEARCH.md"));
  if (text === null) return null;
  const answered = new Map(answersOf(phase).filter((x) => x.kind === "decision" && x.question?.key).map((x) => [x.question.key, x.decision]));
  return openQuestions(text).filter((q) => q.scope).map((q) => ({ ...q, answeredBy: answered.get(q.key) ?? null }));
}

export function questionsVerb(g, phase) {
  const list = scopeQuestions(phase);
  if (list === null) throw none(`no research ${rel(g.codeRoot, phaseFile(phase, "RESEARCH.md"))}`);
  const open = list.filter((q) => !q.resolved && !q.answeredBy).map(({ n, title, key, text }) => ({ n, title, key, text }));
  return done({ research: rel(g.codeRoot, phaseFile(phase, "RESEARCH.md")), questions: list, open, nextId: nextId(phase) }, open.length ? 1 : 0);
}

// The plan ids a decision names, checked against the outline and the plan files when the phase has them.
function planList(phase, value) {
  const ids = idList(value).map((id) => (/^\d+$/.test(id) ? `${phase.padded}-${id.padStart(2, "0")}` : normPlanId(id)));
  const shape = new RegExp(`^${phase.padded.replace(".", "\\.")}-\\d{2,}$`);
  const bad = ids.find((id) => !shape.test(id));
  if (bad) throw fail(`decide --plans: ${bad} is no plan id of phase ${phase.padded} (${phase.padded}-<MM> or <MM>)`);
  const o = readOutline(phase);
  const known = new Set([...(o.rows ?? []).map((r) => r.id), ...(o.manifest?.plans ?? []).map((p) => String(p?.id)), ...planIds(phase)]);
  const unknown = ids.filter((id) => known.size && !known.has(id));
  if (unknown.length) throw fail(`decide --plans: ${unknown.join(", ")} not in the outline or the plans of phase ${phase.padded} (${[...known].sort().join(", ")})`);
  return [...new Set(ids)];
}

export function decideVerb(g, ref, { id, text, plans, outline, question }) {
  guardWriter(g.env);
  if (!ref) throw fail('decide needs a phase: ph gsd decide <phase> --text "<decision>" (--plans <ids> | --outline | --question <n>) [--id D-NN]');
  const phase = requirePhase(g.codeRoot, ref);
  const what = String(text ?? "").trim();
  if (!what) throw fail("decide needs --text <the owner's decision>");
  let decision = nextId(phase);
  if (id !== undefined) {
    const m = /^D-?(\d+)$/i.exec(String(id).trim());
    if (!m) throw fail(`decide --id takes D-NN, not ${id}`);
    decision = pad(Number(m[1]));
    if (contextIds(phase).includes(decision)) throw fail(`${decision} is a decision of ${rel(g.codeRoot, phaseFile(phase, "CONTEXT.md"))} (the discuss output); give a new id (next free: ${nextId(phase)}) or change CONTEXT with gsd-discuss`);
  }
  let asked = null;
  if (question !== undefined) {
    const list = scopeQuestions(phase) ?? [];
    const q = String(question).trim();
    asked = /^\d+$/.test(q) ? list.find((x) => x.n === Number(q)) : list.find((x) => x.title.toLowerCase() === q.toLowerCase());
    if (!asked) throw fail(`decide --question: no scope question ${q} in the research Open Questions${list.length ? ` (${list.map((x) => `${x.n}. ${x.title}`).join("; ")})` : ""}`);
  }
  const named = plans === undefined ? [] : planList(phase, plans);
  const wide = outline === true || Boolean(asked);
  if (!named.length && !wide) throw fail("decide needs what the decision changes: --plans <ids> (only those plans are planned again), --outline (the outline and every plan) or --question <n>");
  const before = phaseDecisions(answersOf(phase)).find((d) => d.decision === decision) ?? null;
  const entry = appendAnswer(phase, { kind: "decision", decision, plans: named, outline: wide, ...(asked ? { question: { n: asked.n, title: asked.title, key: asked.key } } : {}), reason: what });
  return done({
    answered: entry.id, kind: "decision", decision, plans: named, outline: wide, ...(asked ? { question: { n: asked.n, title: asked.title } } : {}), replaces: before?.id ?? null,
    replans: wide ? "the outline, its skeleton review and the plans (research stays approved)" : `plans ${named.join(", ")} only`, answers: rel(g.codeRoot, answersFile(phase)),
    next: "rerun gsd-plan with the same args; the outline and the planners read the decision",
  });
}
