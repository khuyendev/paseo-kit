// Readbacks that decide the lifecycle: verification fingerprint and status (GSDC-34), research status (GSDC-32)
// and the one phase status ladder (GSDC-13). The file is the contract; an agent's claim never is (INV-35, INV-43).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, writeTextAtomic } from "../lib/io.mjs";
import { sha256, textDigest } from "../lib/hash.mjs";
import { isInside } from "../lib/paths.mjs";
import { asArray, done, fail, lf, mentions, none, nowIso, readIf, rel, unavailable } from "./common.mjs";
import { headOf } from "./git.mjs";
import { haltIds, listFiles, phaseFile, planIds, summaryIds } from "./planning.mjs";
import { keyHash, readAttempt, readRevisions } from "./revisions.mjs";
import { loadRoadmap, roadmapPhase } from "./roadmap.mjs";
import { frontmatter } from "./yaml.mjs";

export const DIGEST_PREFIX = "gsdkit1:sha256:";
const PLAN_OR_SUMMARY = /-\d+-(PLAN|SUMMARY)\.md$/;

const liveSummaries = (phase) => {
  const plans = new Set(planIds(phase));
  return summaryIds(phase).filter((id) => plans.has(id));
};

export function fingerprint(codeRoot, phase, extraFiles) {
  const own = [...listFiles(phase, "plan"), ...listFiles(phase, "summary")].map((name) => rel(codeRoot, path.join(phase.dir, name)));
  const verification = rel(codeRoot, phaseFile(phase, "VERIFICATION.md"));
  const files = [...new Set([...extraFiles.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, "")), ...own])].filter((f) => f !== verification).sort();
  const lines = [];
  for (const f of files) {
    const abs = path.resolve(codeRoot, f);
    if (!isInside(abs, codeRoot)) throw unavailable(`covered file outside the code root: ${f}`, { file: f });
    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      throw unavailable(`covered file missing: ${f}`, { file: f });
    }
    lines.push(`${f}\0${textDigest(text)}\n`);
  }
  return { covered_files: files, covered_digest: `${DIGEST_PREFIX}${sha256(lines.join(""))}` };
}

const VERIFICATION_STATUSES = new Set(["passed", "gaps_found", "human_needed"]);

const behaviorCount = (fm) => {
  const v = fm.behavior_unverified;
  if (Array.isArray(v)) return v.length;
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// The frontmatter rules of a verification report, shared by the report and its per-criterion parts.
function reportProblems(fm) {
  const problems = [];
  const status = fm.status;
  const gaps = asArray(fm.gaps);
  const human = asArray(fm.human_verification);
  const behavior = behaviorCount(fm);
  if (!VERIFICATION_STATUSES.has(status)) problems.push(`status must be exactly passed, gaps_found or human_needed (got ${JSON.stringify(status ?? null)})`);
  if (status === "passed" && (gaps.length || human.length || behavior > 0)) problems.push("status passed with gaps, human_verification or behavior_unverified");
  if (status === "gaps_found" && !gaps.length) problems.push("status gaps_found without gaps");
  if (status === "human_needed" && !human.length && behavior <= 0) problems.push("status human_needed without human_verification or behavior_unverified");
  if (!Array.isArray(fm.covered_files) || !fm.covered_files.length) problems.push("covered_files missing");
  if (typeof fm.covered_digest !== "string" || !fm.covered_digest) problems.push("covered_digest missing");
  return problems;
}

// The verification report read back: {exists, valid, problems, status (stale overrides), ...}.
export function readVerification(codeRoot, phase) {
  const file = phaseFile(phase, "VERIFICATION.md");
  const text = readIf(file);
  if (text === null) return { exists: false, valid: false, status: "missing", path: rel(codeRoot, file) };
  const parsed = frontmatter(text);
  const fm = parsed.fm;
  const problems = [];
  if (parsed.error) problems.push(`frontmatter: ${parsed.error}`);
  const status = fm.status;
  const gaps = asArray(fm.gaps);
  const human = asArray(fm.human_verification);
  const behavior = behaviorCount(fm);
  if (!parsed.error) problems.push(...reportProblems(fm));
  const base = {
    exists: true,
    path: rel(codeRoot, file),
    sha: textDigest(text),
    written_status: status ?? null,
    score: fm.score ?? null,
    gaps,
    human_verification: human,
    behavior_unverified: behavior,
  };
  if (problems.length) return { ...base, valid: false, status: "invalid", problems, stale: null };
  let stale;
  try {
    const extra = fm.covered_files.map(String).filter((f) => !PLAN_OR_SUMMARY.test(f));
    stale = fingerprint(codeRoot, phase, extra).covered_digest !== fm.covered_digest;
  } catch {
    stale = true;
  }
  return { ...base, valid: true, status: stale ? "stale" : status, stale };
}

export function verificationStatusVerb(codeRoot, phase) {
  const v = readVerification(codeRoot, phase);
  if (!v.exists) throw none(`no VERIFICATION.md in ${rel(codeRoot, phase.dir)}`, { path: v.path });
  const json = {
    status: v.status,
    written_status: v.written_status,
    score: v.score,
    gaps: v.gaps,
    human_verification: v.human_verification,
    behavior_unverified: v.behavior_unverified,
    path: v.path,
    sha: v.sha,
    stale: v.stale,
  };
  if (!v.valid) return done({ ...json, problems: v.problems }, 1);
  return done(json);
}

// --- per-criterion verification (kit feedback 66): one verifier per part, the merge writes the report ---

export const PART_ID = /^(SC-[1-9]\d*|phase)$/;
// Word values are written plain, as an upstream report writes them; every other value is one line of JSON (valid YAML).
const PLAIN_KEYS = new Set(["phase", "status", "verify_mode", "phase_checks"]);
const PART_LISTS = ["gaps", "human_verification", "behavior_unverified_items", "deferred", "advisory", "overrides", "coincidental_reliance_items"];

// A part read back against this attempt: the report rules, its own criterion id, this attempt's key, not stale.
function readPart(codeRoot, phase, part, attemptKey) {
  const out = { id: part?.id ?? null, path: part?.path ?? null };
  const bad = (status, problems) => ({ ...out, valid: false, status, problems });
  if (!PART_ID.test(String(part?.id ?? ""))) return bad("invalid", [`part id must be SC-<k> or phase (got ${JSON.stringify(part?.id ?? null)})`]);
  const abs = path.resolve(codeRoot, String(part.path ?? ""));
  if (!isInside(abs, path.join(phase.dir, "verify"))) return bad("invalid", [`part path must be inside ${rel(codeRoot, phase.dir)}/verify/`]);
  const text = readIf(abs);
  if (text === null) return bad("missing", [`no ${part.path}`]);
  const parsed = frontmatter(text);
  const fm = parsed.fm;
  const problems = parsed.error ? [`frontmatter: ${parsed.error}`] : reportProblems(fm);
  if (!parsed.error && fm.criterion !== part.id) problems.push(`criterion must be ${part.id} (got ${JSON.stringify(fm.criterion ?? null)})`);
  if (!parsed.error && String(fm.attempt_key ?? "") !== attemptKey) problems.push("attempt_key is not this attempt's key");
  if (!problems.length) {
    try {
      const extra = fm.covered_files.map(String).filter((f) => !PLAN_OR_SUMMARY.test(f));
      if (fingerprint(codeRoot, phase, extra).covered_digest !== fm.covered_digest) problems.push("covered_digest differs from the covered files (stale)");
    } catch (e) {
      problems.push(`covered files unreadable: ${e.message}`);
    }
  }
  if (problems.length) return bad("invalid", problems);
  return { ...out, valid: true, status: fm.status, fm, body: parsed.body };
}

const tagged = (id, item) => (item !== null && typeof item === "object" && !Array.isArray(item) ? { criterion: id, ...item } : `${id}: ${item}`);
const cell = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

// stdin {attemptKey, parts: [{id: SC-<k>|phase, path, text}]}; write false = check only. The merged report is the most
// restrictive status of its parts (gaps_found > human_needed > passed); every gap and human item names its criterion.
export function verificationParts(codeRoot, phase, input, write) {
  const attemptKey = String(input?.attemptKey ?? "");
  const list = Array.isArray(input?.parts) ? input.parts : [];
  if (!attemptKey) throw fail("verification parts needs attemptKey");
  if (!list.length) throw fail("verification parts needs parts [{id, path, text}]");
  const ids = list.map((p) => p?.id);
  if (new Set(ids).size !== ids.length) throw fail(`verification parts: duplicate part ids (${ids.join(", ")})`);
  const parts = list.map((p) => ({ ...readPart(codeRoot, phase, p, attemptKey), text: p?.text ?? null }));
  const summary = parts.map(({ id, path: file, valid, status, problems }) => ({ id, path: file, valid, status, ...(problems ? { problems } : {}) }));
  const allValid = parts.every((p) => p.valid);
  if (!write || !allValid) return done({ valid: allValid, written: null, parts: summary }, allValid ? 0 : 1);
  const lists = Object.fromEntries(PART_LISTS.map((k) => [k, parts.flatMap((p) => asArray(p.fm[k]).map((item) => tagged(p.id, item)))]));
  const behavior = parts.reduce((n, p) => n + behaviorCount(p.fm), 0);
  const status = lists.gaps.length ? "gaps_found" : lists.human_verification.length || behavior > 0 ? "human_needed" : "passed";
  const criteria = parts.filter((p) => p.id !== "phase").map((p) => ({ id: p.id, text: p.text, status: p.status, part: p.path }));
  const phasePart = parts.find((p) => p.id === "phase");
  const extra = [...new Set(parts.flatMap((p) => p.fm.covered_files.map(String)))].filter((f) => !PLAN_OR_SUMMARY.test(f) && !f.includes("/verify/"));
  const fp = fingerprint(codeRoot, phase, extra);
  const fm = {
    phase: path.basename(phase.dir),
    verified: nowIso(),
    status,
    score: `${criteria.filter((c) => c.status === "passed").length}/${criteria.length} criteria verified`,
    verify_mode: "per-criterion",
    attempt_key: attemptKey,
    criteria,
    ...(phasePart ? { phase_checks: phasePart.status } : {}),
    covered_files: fp.covered_files,
    covered_digest: fp.covered_digest,
    behavior_unverified: behavior,
    ...Object.fromEntries(Object.entries(lists).filter(([, v]) => v.length)),
  };
  const head = Object.entries(fm).map(([k, v]) => `${k}: ${typeof v === "number" || PLAIN_KEYS.has(k) ? v : JSON.stringify(v)}`).join("\n");
  const table = ["| Part | Criterion | Status | Report |", "| --- | --- | --- | --- |", ...parts.map((p) => `| ${p.id} | ${cell(p.id === "phase" ? "phase-wide checks" : p.text)} | ${p.status} | ${p.path} |`)].join("\n");
  const sections = parts.map((p) => `## ${p.id}: ${cell(p.id === "phase" ? "phase-wide checks" : p.text)}\n\n${lf(p.body).trim()}\n`).join("\n");
  const text = `---\n${head}\n---\n\n# Phase ${path.basename(phase.dir)}: Verification Report (per criterion)\n\n**Status:** ${status}\n**Score:** ${fm.score}\n\n${table}\n\n${sections}`;
  const file = phaseFile(phase, "VERIFICATION.md");
  writeTextAtomic(file, text);
  return done({ valid: true, written: rel(codeRoot, file), status, sha: textDigest(text), parts: summary });
}

export const completionFile = (phase) => path.join(phase.dir, "complete.json");

// GSDC-13: first matching row wins; a ROADMAP checkbox never changes the answer.
export function phaseStatus(codeRoot, phase) {
  if (!phase) return { status: "NOT_STARTED", plan_count: null, summary_count: null, plan_count_all: null };
  const plans = planIds(phase);
  const summaries = liveSummaries(phase);
  const halted = haltIds(phase).filter((id) => plans.includes(id));
  const counts = { plan_count: plans.length, summary_count: summaries.length, plan_count_all: plans.length + listSuperseded(phase) };
  const v = plans.length && summaries.length === plans.length ? readVerification(codeRoot, phase) : null;
  const completion = readJsonIf(completionFile(phase), null);
  if (v && v.valid && v.status === "passed" && completion && completion.verification_sha === v.sha) return { status: "COMPLETE", ...counts, verification: v.status };
  if (plans.length === 0) return { status: "NOT_STARTED", ...counts };
  if ((summaries.length > 0 && summaries.length < plans.length) || halted.length) return { status: "IN_PROGRESS", ...counts, halted };
  if (summaries.length === 0) return { status: "PLANNED", ...counts };
  if (["stale", "gaps_found", "human_needed"].includes(v.status)) return { status: "NEEDS_REVIEW", ...counts, verification: v.status };
  return { status: "EXECUTED", ...counts, verification: v.exists ? v.status : "missing", next_action: v.status === "passed" ? "complete" : "verify" };
}

const listSuperseded = (phase) => {
  try {
    return fs.readdirSync(path.join(phase.dir, "superseded")).filter((n) => /-\d+-PLAN\.md(\.\d+)?$/.test(n)).length;
  } catch {
    return 0;
  }
};

// --- research status (GSDC-32) ---

export const RESEARCH_SECTIONS = ["Summary", "Standard Stack", "Architecture Patterns", "Don't Hand-Roll", "Common Pitfalls", "Sources"];
const HEX64 = /^[0-9a-f]{64}$/;
// One blocker per list item (or line) inside <research_blockers>; the owner gets the items, not the block.
const researchBlockers = (body) => (/<research_blockers>([\s\S]*?)<\/research_blockers>/.exec(body)?.[1] ?? "")
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^(?:[-*]|\d+[.)])\s+/, ""))
  .filter(Boolean);

export function researchStatus(g, phase) {
  const file = phaseFile(phase, "RESEARCH.md");
  const text = readIf(file);
  const base = { path: rel(g.codeRoot, file) };
  if (text === null) throw none(`no RESEARCH.md in ${rel(g.codeRoot, phase.dir)}`, base);
  const parsed = frontmatter(text);
  const fm = parsed.fm;
  const problems = [];
  if (parsed.error) problems.push(`frontmatter: ${parsed.error}`);
  else {
    if (!["complete", "blocked"].includes(fm.status)) problems.push(`status must be complete or blocked (got ${JSON.stringify(fm.status ?? null)})`);
    if (!HEX64.test(String(fm.input_digest ?? ""))) problems.push("input_digest is not 64 hex");
    if (!HEX64.test(String(fm.attempt_key ?? ""))) problems.push("attempt_key is not 64 hex");
  }
  const body = parsed.body;
  if (text.includes("<!-- gsd:write-continue -->")) problems.push("write-continue sentinel present (report unfinished)");
  if (!problems.length && fm.status === "complete") {
    const lastLine = body.trimEnd().split("\n").pop().trim();
    if (lastLine !== `<!-- gsd:research-complete ${fm.attempt_key} -->`) problems.push("missing final line <!-- gsd:research-complete <attempt_key> -->");
    for (const s of RESEARCH_SECTIONS) if (!new RegExp(`^##\\s+${s.replace(/'/g, "['’]")}\\b`, "m").test(body)) problems.push(`missing section ## ${s}`);
    if (!/\[(VERIFIED:|CITED:|ASSUMED)/.test(body)) problems.push("no provenance tags ([VERIFIED: ...], [CITED: ...], [ASSUMED])");
    if (readIf(phaseFile(phase, "CONTEXT.md")) !== null && !/<user_constraints>/.test(body)) problems.push("missing <user_constraints> (CONTEXT.md exists)");
    const reqBlock = /<phase_requirements>([\s\S]*?)<\/phase_requirements>/.exec(body)?.[1] ?? null;
    const reqs = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), phase.number)?.requirements ?? [];
    if (reqs.length && reqBlock === null) problems.push("missing <phase_requirements>");
    else for (const id of reqs) if (reqBlock !== null && !mentions(reqBlock, id)) problems.push(`phase requirement ${id} missing from <phase_requirements>`);
  }
  if (!problems.length && fm.status === "blocked" && !/<research_blockers>/.test(body)) problems.push("blocked report without <research_blockers>");
  if (problems.length) return done({ status: "invalid", ...base, problems }, 1);
  const current = keyHash(g, phase, "research").hash;
  const out = { ...base, written_status: fm.status, input_digest: fm.input_digest, attempt_key: fm.attempt_key, current_digest: current, sha: textDigest(text) };
  if (fm.input_digest !== current) return done({ ...out, status: "stale" }, 1);
  const attempt = readAttempt(phase, "research");
  if (attempt && attempt.inputDigest === current && attempt.key !== fm.attempt_key) {
    if (attempt.result?.status === "blocked") return done({ ...out, status: "blocked", attempt: attempt.key, blockers: researchBlockers(body) }, 1);
    if (!attempt.done) return done({ ...out, status: "incomplete", attempt: attempt.key }, 1);
  }
  // A report edited after its attempt was accepted is not that attempt's output: changed, so the default run asks for a refresh.
  if (attempt && attempt.key === fm.attempt_key && attempt.done && typeof attempt.result === "string" && attempt.result !== out.sha) return done({ ...out, status: "changed", attempt: attempt.key }, 1);
  if (fm.status === "blocked") return done({ ...out, status: "blocked", blockers: researchBlockers(body) }, 1);
  // A code commit alone is reported, not stale (GSDC-28): headChanged compares HEAD with the research revision's record.
  const recorded = readRevisions(phase).keys.research;
  return done({ ...out, status: "complete", headChanged: recorded ? recorded.head !== headOf(g.codeRoot) : null });
}
