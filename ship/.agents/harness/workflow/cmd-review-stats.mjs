// ph review-stats: how the code review of gsd-execute performed, read from the records every phase keeps
// (`.planning/phases/<NN>-<slug>/review/<waveId>-<plan>.json`), plus the later fate of findings recorded with
// `ph review-stats outcome`. A change to the review rules or lenses is measured with it before it is called better.
// The records, not `_workspace/review-metrics.jsonl`, are the source: a resumed run appends that line again.
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "../lib/cli.mjs";
import { sha256 } from "../lib/hash.mjs";
import { readJsonIf, readText } from "../lib/io.mjs";

export const OUTCOMES_REL = "_workspace/review-outcomes.jsonl";
export const FATES = Object.freeze(["fixed", "not-hold", "duplicate", "wont-fix"]);
export const REVIEW_STATS_OPTIONS = Object.freeze({ phase: "string", note: "string" });
export const REVIEW_STATS_USAGE = `ph review-stats [--phase NN] | ph review-stats outcome PLAN:FINDING (${FATES.join("|")}) [--note T]`;

const PHASES_REL = ".planning/phases";
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const STATUSES = ["gated", "downgraded", "deferred", "pre-existing"];
const LIKELIHOODS = ["likely", "possible", "theoretical"];
const REF = /^[^:\s]+:[^:\s]+$/;
const FINGERPRINT = /^[0-9a-f]{16}$/;

const ref = (plan, id) => `${plan}:${id}`;
// What a finding says, not only its id: a rerun that reuses the id for another defect has another fingerprint.
const fingerprint = (f) => sha256(JSON.stringify([f.id, f.file ?? null, f.line ?? null, f.class ?? null, f.description ?? null, f.trigger ?? null])).slice(0, 16);
const fateKey = (key, fp) => `${key} ${fp}`;
const pct = (a, b) => (b ? ` (${Math.round((100 * a) / b)}%)` : "");
const countBy = (list, key, names) => names.map((n) => `${n} ${list.filter((x) => x[key] === n).length}`).join(", ");

/** {reviews: [{phase, file, rec}], bad}: every review record, optionally of one phase ("7" matches 07-*). */
export function readReviews(root, phase) {
  const reviews = [];
  let bad = 0;
  const base = path.join(root, PHASES_REL);
  if (!fs.existsSync(base)) return { reviews, bad };
  for (const dir of fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const nn = dir.split("-")[0];
    if (phase !== undefined && Number(nn) !== Number(phase)) continue;
    const rdir = path.join(base, dir, "review");
    if (!fs.existsSync(rdir)) continue;
    for (const file of fs.readdirSync(rdir).filter((f) => f.endsWith(".json")).sort()) {
      let rec = null;
      try {
        rec = readJsonIf(path.join(rdir, file));
      } catch {
        rec = null;
      }
      if (typeof rec?.plan === "string" && Array.isArray(rec.findings)) reviews.push({ phase: nn, file, full: path.join(rdir, file), rec });
      else bad++;
    }
  }
  return { reviews, bad };
}

/** {fates: Map "ref fingerprint" -> {fate, note}, bad, unbound}; a later line for the same finding wins; a line with no fingerprint (written before fates were bound to findings) applies to nothing. */
export function readOutcomes(root) {
  const fates = new Map();
  let bad = 0;
  let unbound = 0;
  const file = path.join(root, OUTCOMES_REL);
  if (!fs.existsSync(file)) return { fates, bad, unbound };
  for (const line of readText(file).split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (!REF.test(o?.ref) || !FATES.includes(o.fate)) bad++;
      else if (!FINGERPRINT.test(o.fp ?? "")) unbound++;
      else fates.set(fateKey(o.ref, o.fp), { fate: o.fate, note: o.note ?? null });
    } catch {
      bad++;
    }
  }
  return { fates, bad, unbound };
}

/** Every finding with its phase, ref, fingerprint, resolution and the fate recorded for this very finding. */
export function findingsOf(reviews, fates) {
  return reviews.flatMap(({ phase, rec }) => rec.findings.map((f) => {
    const resolved = (rec.resolution ?? []).find((r) => r.id === f.id)?.resolved ?? null;
    const key = ref(rec.plan, f.id);
    const fp = fingerprint(f);
    return { ...f, phase, plan: rec.plan, ref: key, fp, resolved, fate: fates.get(fateKey(key, fp))?.fate ?? null };
  }));
}

const real = (f) => f.verdict === "confirmed" || f.fate === "fixed";
const bogus = (f) => f.verdict === "refuted" || f.fate === "not-hold";

export function reviewLines(reviews, findings) {
  const lines = [];
  const phases = [...new Set(reviews.map((r) => r.phase))];
  lines.push(`reviews ${reviews.length} (phases ${phases.length}, plans ${new Set(reviews.map((r) => r.rec.plan)).size}), findings ${findings.length}: ${countBy(findings, "severity", SEVERITIES)}`);
  lines.push(`gate: ${countBy(findings, "status", STATUSES)}`);
  const gated = findings.filter((f) => f.status === "gated");
  const n = (v) => gated.filter((f) => f.verdict === v).length;
  lines.push(`gated ${gated.length}: confirmed ${n("confirmed")}${pct(n("confirmed"), gated.length)}, refuted ${n("refuted")}${pct(n("refuted"), gated.length)}, uncertain ${n("uncertain")}, unverified ${n("unverified")}`);
  const confirmed = gated.filter((f) => f.verdict === "confirmed");
  const resolved = confirmed.filter((f) => f.resolved === true).length;
  lines.push(`confirmed resolved at the resolution check: ${resolved}/${confirmed.length}${pct(resolved, confirmed.length)}`);
  const passed = findings.filter((f) => f.status !== "gated");
  const settled = passed.filter((f) => f.fate);
  lines.push(`not blocking ${passed.length}: settled ${settled.length} (${countBy(settled, "fate", FATES)}), open ${passed.length - settled.length}`);
  for (const lk of LIKELIHOODS) {
    const g = findings.filter((f) => String(f.likelihood).toLowerCase() === lk);
    if (g.length) lines.push(`likelihood ${lk}: ${g.length} findings, judged real ${g.filter(real).length}, judged false ${g.filter(bogus).length}`);
  }
  const classed = findings.filter((f) => String(f.class ?? "").trim());
  if (classed.length) lines.push(`defect classes: ${classed.length} findings name a class, ${classed.reduce((s, f) => s + (f.instances?.length ?? 0), 0)} more instances`);
  if (phases.length > 1) for (const p of phases) {
    const mine = findings.filter((f) => f.phase === p);
    lines.push(`phase ${p}: reviews ${reviews.filter((r) => r.phase === p).length}, findings ${mine.length}, gated ${mine.filter((f) => f.status === "gated").length}, confirmed ${mine.filter((f) => f.verdict === "confirmed").length}`);
  }
  return lines;
}

function recordOutcome(ctx, [, key, fate]) {
  if (!REF.test(key ?? "") || !FATES.includes(fate)) throw new UsageError(`usage: ${REVIEW_STATS_USAGE}`);
  if (ctx.opts.phase !== undefined) throw new UsageError("--phase goes with the report, not with outcome");
  const { reviews } = readReviews(ctx.root);
  const hits = reviews.flatMap((r) => findingsOf([r], new Map()).filter((f) => f.ref === key).map((f) => ({ fp: f.fp, file: r.file, at: fs.statSync(r.full).mtimeMs })));
  if (!hits.length) throw new UsageError(`no review finding ${key} in ${PHASES_REL}/*/review (PLAN:FINDING as in deferred.md, e.g. 03-02:F-01)`);
  // A plan id can sit in several records (a rerun under another wave id): the fate goes to the newest record's finding.
  const newest = hits.reduce((a, b) => (b.at > a.at ? b : a));
  const file = path.join(ctx.root, OUTCOMES_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ v: 1, at: new Date(ctx.clock?.now() ?? Date.now()).toISOString(), ref: key, fp: newest.fp, fate, note: ctx.opts.note ?? null })}\n`, "utf8");
  const ambiguous = new Set(hits.map((h) => h.fp)).size > 1 ? ` (newest of ${hits.length} records with ${key}: ${newest.file})` : "";
  ctx.out(`outcome ${key} ${fate}${ambiguous}`);
  return 0;
}

export async function reviewStatsCommand(ctx) {
  if (ctx.args[0] === "outcome") return recordOutcome(ctx, ctx.args);
  if (ctx.args.length) throw new UsageError(`usage: ${REVIEW_STATS_USAGE}`);
  if (ctx.opts.note !== undefined) throw new UsageError("--note goes with outcome");
  const { reviews, bad } = readReviews(ctx.root, ctx.opts.phase);
  const outcomes = readOutcomes(ctx.root);
  const findings = findingsOf(reviews, outcomes.fates);
  if (reviews.length) for (const line of reviewLines(reviews, findings)) ctx.out(line);
  const known = new Set(findingsOf(readReviews(ctx.root).reviews, new Map()).map((f) => fateKey(f.ref, f.fp)));
  const orphans = [...outcomes.fates.keys()].filter((k) => !known.has(k)).length;
  const skipped = [bad && `${bad} unreadable records`, outcomes.bad && `${outcomes.bad} unreadable outcome lines`, outcomes.unbound && `${outcomes.unbound} outcomes with no finding fingerprint (not applied)`, orphans && `${orphans} outcomes of findings no record holds`].filter(Boolean);
  ctx.out(`review-stats: ${reviews.length} review records from ${PHASES_REL}/*/review${ctx.opts.phase !== undefined ? ` (phase ${ctx.opts.phase})` : ""}${skipped.length ? `; skipped ${skipped.join(", ")}` : ""}`);
  return 0;
}
