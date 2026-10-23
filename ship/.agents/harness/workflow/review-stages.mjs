// ph review-stats --stage (kit feedback 64): what each review stage found, what became of it, what it cost and what got past
// it, so an owner can decide where review money goes. The pre-code stages (skeleton lanes, plan checker, plan review) are read
// from the records gsd-plan and gsd-plan-review write (`.planning/phases/<NN>-<slug>/prereview/<stage>-<runId>.json`), code
// review from the review records, plan-defect events from gsd-execute's `prereview/execute-<runId>.json`, costs from the run
// journals: finished calls only, so a cached replay of a resumed run costs nothing.
import fs from "node:fs";
import path from "node:path";
import { readJsonIf } from "../lib/io.mjs";
import { RUN_FILES, readJournal } from "./journal.mjs";
import { listRuns } from "./cmd-runs.mjs";

export const STAGES = Object.freeze(["skeleton", "checker", "plan", "code"]);
// The writer's vocabulary (workflows/lib/flow-review.mjs); a record with another fate is unreadable.
const FATES = ["applied", "carried", "rejected", "duplicate", "conflict", "open", "unjudged"];
const EVENT_KINDS = [["halt", "halts"], ["gate-failure", "gate failures"], ["fix-round", "fix rounds"]];
const DEFECT_KINDS = ["wrong-api", "owns-reach", "missing-dependency", "other"];
const SEVERITY_ORDER = ["critical", "blocker", "high", "warning", "medium", "low", "info"];
const CONFIRMED_WHAT = { skeleton: "applied blockers", checker: "applied blockers", plan: "kept high issues" };
const PHASES_REL = ".planning/phases";
// A call is review cost when one of these roles made it; every other call of a stage (revisions, the plan editor, fixers) is
// fix cost.
const REVIEW_ROLES = new Set(["skeleton_lane", "checker", "plan_finder", "plan_verifier", "plan_judge", "reviewer", "finding_verifier"]);
const PLAN_PHASES = { "Skeleton review": "skeleton", Checker: "checker", Find: "plan", Judge: "plan", Edit: "plan", Resolve: "plan" };

const usd = (x) => `$${(Math.round(x * 100) / 100).toFixed(2)}`;
const sameNn = (nn, phase) => phase === undefined || Number(nn) === Number(phase);
const nnOf = (phaseDir) => /phases\/(\d+(?:\.\d+)?)-/.exec(String(phaseDir ?? ""))?.[1] ?? null;
const readable = (rec) => {
  if (!["skeleton", "checker", "plan", "execute"].includes(rec?.stage) || typeof rec.runId !== "string") return false;
  if (rec.stage === "execute") return Array.isArray(rec.events) && rec.events.every((e) => typeof e?.kind === "string" && Array.isArray(e.defects));
  return Array.isArray(rec.findings) && rec.findings.every((f) => typeof f?.id === "string" && FATES.includes(f.fate) && typeof f.confirmed === "boolean");
};

/** {records: [{phase, file, rec}], bad}: every pre-code review and plan-defect record, optionally of one phase. */
export function readPrereviews(root, phase) {
  const records = [];
  let bad = 0;
  const base = path.join(root, PHASES_REL);
  if (!fs.existsSync(base)) return { records, bad };
  for (const dir of fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const nn = dir.split("-")[0];
    if (!sameNn(nn, phase)) continue;
    const pdir = path.join(base, dir, "prereview");
    if (!fs.existsSync(pdir)) continue;
    for (const file of fs.readdirSync(pdir).filter((f) => f.endsWith(".json")).sort()) {
      let rec = null;
      try {
        rec = readJsonIf(path.join(pdir, file));
      } catch {
        rec = null;
      }
      if (readable(rec)) records.push({ phase: nn, file, rec });
      else bad++;
    }
  }
  return { records, bad };
}

/** The stage a finished journal call belongs to, or null: gsd-plan by the call's phase (gap mode and the streams flow's
 * dependency checks by label), gsd-plan-review wholly plan review, gsd-execute by role (reviewer, finding verifier) and the
 * review-fix labels. */
export function stageOf(workflow, e) {
  const label = String(e.label ?? "");
  if (workflow === "gsd-plan-review") return "plan";
  if (workflow === "gsd-plan") return /^depcheck-|^deprevise-/.test(label) ? "checker" : PLAN_PHASES[e.phase] ?? (/^checker-\d+$|^revise-/.test(label) ? "checker" : null);
  if (workflow === "gsd-execute") return e.role === "reviewer" || e.role === "finding_verifier" || /^fix-review-|^fix-unresolved-/.test(label) ? "code" : null;
  return null;
}

/** {[stage]: {review: {usd, calls, unpriced}, fix: {...}}, runs}: the agent cost of each stage over the runs of the phases. */
export function stageCosts(runsDir, phase) {
  const costs = Object.fromEntries(STAGES.map((s) => [s, { review: { usd: 0, calls: 0, unpriced: 0 }, fix: { usd: 0, calls: 0, unpriced: 0 } }]));
  let runs = 0;
  for (const run of listRuns(runsDir)) {
    const workflow = run.info?.name;
    if (!["gsd-plan", "gsd-plan-review", "gsd-execute"].includes(workflow)) continue;
    let args = null;
    try {
      args = readJsonIf(path.join(run.dir, RUN_FILES.args));
    } catch {
      args = null;
    }
    const nn = nnOf(args?.phaseDir);
    if (!nn || !sameNn(nn, phase) || !fs.existsSync(path.join(run.dir, RUN_FILES.journal))) continue;
    runs++;
    for (const e of readJournal(path.join(run.dir, RUN_FILES.journal))) {
      // As run-stats: a finished call that created an agent; a cached replay or a call refused before a turn cost nothing.
      if (!(e.status === "ok" || (e.status === "null" && e.agentId))) continue;
      const stage = stageOf(workflow, e);
      if (!stage) continue;
      const bucket = costs[stage][REVIEW_ROLES.has(e.role) ? "review" : "fix"];
      bucket.calls++;
      if (typeof e.usage?.costUsd === "number") bucket.usd += e.usage.costUsd;
      else bucket.unpriced++;
    }
  }
  return { costs, runs };
}

const countList = (list, key, names) => names.filter((n) => list.some((x) => x[key] === n)).map((n) => `${n} ${list.filter((x) => x[key] === n).length}`).join(", ");
const costText = (b) => `${usd(b.usd)} in ${b.calls} calls${b.unpriced ? ` (${b.unpriced} unpriced)` : ""}`;
function costLines(cost, confirmed) {
  const per = confirmed ? `per confirmed finding ${usd(cost.review.usd / confirmed)}${cost.review.unpriced ? " (priced calls only)" : ""}` : "per confirmed finding n/a (none confirmed)";
  return [`cost: review ${costText(cost.review)}, fix ${costText(cost.fix)}; ${per}`];
}

/** What got past the pre-code reviews: confirmed code findings a plan review could have caught, and the plan-defect events. */
function precodeEscapes(codeFindings, records) {
  const confirmed = codeFindings.filter((f) => f.verdict === "confirmed");
  const tag = (t) => confirmed.filter((f) => (f.planCatchable ?? null) === t).length;
  const events = records.filter((r) => r.rec.stage === "execute").flatMap((r) => r.rec.events);
  const parts = EVENT_KINDS.map(([kind, name]) => {
    const mine = events.filter((e) => e.kind === kind);
    return `${name} ${mine.filter((e) => e.cause === "plan").length} of ${mine.length}`;
  });
  const defects = events.filter((e) => e.kind !== "gate-failure").flatMap((e) => e.defects);
  const kinds = countList(defects, "kind", DEFECT_KINDS);
  return [
    `escapes past the pre-code reviews (shared by skeleton, checker and plan): confirmed code findings plan-catchable yes ${tag("yes")} of ${confirmed.length} (no ${tag("no")}, untagged ${tag(null)})`,
    `plan-defect events of execute: ${parts.join(", ")}${kinds ? `; defects named: ${kinds}` : ""}`,
  ];
}

/** The report of one stage. codeFindings: findingsOf() of the review records (with fates); codeReport: reviewLines() of them. */
export function stageLines(stage, { records, codeFindings, codeReport, costs }) {
  const lines = [];
  if (stage === "code") {
    lines.push(...codeReport);
    const confirmed = codeFindings.filter((f) => f.status === "gated" && f.verdict === "confirmed").length;
    lines.push(...costLines(costs.code, confirmed));
    const passed = codeFindings.filter((f) => f.status !== "gated");
    lines.push(`escapes past code review: non-blocking findings later recorded fixed ${passed.filter((f) => f.fate === "fixed").length} of ${passed.length} (ph review-stats outcome)`);
    return lines;
  }
  const mine = records.filter((r) => r.rec.stage === stage);
  const findings = mine.flatMap((r) => r.rec.findings);
  const severities = [...SEVERITY_ORDER, ...new Set(findings.map((f) => f.severity).filter((s) => !SEVERITY_ORDER.includes(s)))];
  lines.push(`stage ${stage}: records ${mine.length}, findings ${findings.length}${findings.length ? `: ${countList(findings, "severity", severities)}` : ""}`);
  lines.push(`fates: ${FATES.map((f) => `${f} ${findings.filter((x) => x.fate === f).length}`).join(", ")}`);
  const confirmed = findings.filter((f) => f.confirmed).length;
  const classes = [...new Set(findings.map((f) => String(f.class ?? "").trim()).filter(Boolean))]
    .map((c) => [c, findings.filter((f) => String(f.class ?? "").trim() === c).length]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8);
  lines.push(`confirmed ${confirmed} (${CONFIRMED_WHAT[stage]})${classes.length ? `; classes: ${classes.map(([c, n]) => `${c} ${n}`).join(", ")}` : ""}`);
  lines.push(...costLines(costs[stage], confirmed));
  lines.push(...precodeEscapes(codeFindings, records));
  return lines;
}
