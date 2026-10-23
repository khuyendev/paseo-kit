// Phase, roadmap and requirement verbs: find-phase, analyze (GSDC-08, GSDC-13, GSDC-14), phase add/insert/remove/
// complete (GSDC-15), uat-passed (GSDC-16), phase-plan-index (GSDC-36), requirement marks (GSDC-09).
import fs from "node:fs";
import path from "node:path";
import { renameWithRetry, writeJsonAtomic, writeTextAtomic } from "../lib/io.mjs";
import { samePath } from "../lib/paths.mjs";
import { textDigest } from "../lib/hash.mjs";
import { done, fail, idList, isFile, lf, nowIso, readIf, rel, today } from "./common.mjs";
import { comparePhase, findPhase, haltIds, listFiles, padPhase, phaseFile, phasesDir, planIds, readPlans, sharedFile, summaryIds, summaryPath } from "./planning.mjs";
import { duplicateIds, loadRequirements, requirementView, setComplete } from "./requirements.mjs";
import { annotateSection, insertPhase, loadRoadmap, parseRoadmap, phaseJson, removePhaseText, renumberText, roadmapPhase, setChecklist, setProgressRow, slugify } from "./roadmap.mjs";
import { advanceState, initStateLocked, parseState, writeShared } from "./state.mjs";
import { completionFile, phaseStatus, readVerification } from "./status.mjs";
import { frontmatter } from "./yaml.mjs";
import { validateDraft } from "./draft.mjs";

export function findPhaseVerb(g, ref) {
  const phase = findPhase(g.codeRoot, ref);
  const entry = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), ref);
  if (!phase) return done({ found: false, phase_number: entry?.number ?? ref, phase_name: entry?.phase_name ?? null, directory: null, status: entry ? "NOT_STARTED" : null, plan_count: null, summary_count: null, plan_count_all: null, in_roadmap: Boolean(entry) }, entry ? 0 : 66);
  const st = phaseStatus(g.codeRoot, phase);
  return done({ found: true, phase_number: phase.number, padded: phase.padded, phase_name: entry?.phase_name ?? null, slug: phase.slug, directory: rel(g.codeRoot, phase.dir), in_roadmap: Boolean(entry), ...st, plans: planIds(phase), summaries: summaryIds(phase) });
}

export function analyze(g) {
  const roadmap = loadRoadmap(g.codeRoot, g.cfg);
  const phases = roadmap.phases.map((rp) => {
    const phase = findPhase(g.codeRoot, rp.number);
    const st = phaseStatus(g.codeRoot, phase);
    const v = phase ? readVerification(g.codeRoot, phase) : { status: "missing" };
    const checked = roadmap.checklist.get(rp.padded) ?? null;
    return { number: rp.number, name: rp.phase_name, directory: phase ? rel(g.codeRoot, phase.dir) : null, status: st.status, plans: st.plan_count, summaries: st.summary_count, verification: v.status, checkbox: checked, requirements: rp.requirements };
  });
  const completed = phases.filter((p) => p.status === "COMPLETE");
  const current = phases.find((p) => ["IN_PROGRESS", "PLANNED", "EXECUTED", "NEEDS_REVIEW"].includes(p.status)) ?? null;
  const next = phases.find((p) => p.status === "NOT_STARTED") ?? null;
  const scope = roadmap.scope;
  const pct = scope === "complete" && phases.length ? Math.round((100 * completed.length) / phases.length) : null;
  return {
    scope,
    phases,
    current_phase: current?.number ?? null,
    next_phase: next?.number ?? null,
    completed_phases: completed.map((p) => p.number),
    checkbox_conflict: phases.filter((p) => p.checkbox === true && p.status !== "COMPLETE").map((p) => ({ phase: p.number, status: p.status, verification: p.verification })),
    progress_percent: pct,
    listed_without_section: roadmap.listedOnly,
  };
}

export function roadmapVerb(g, sub, args) {
  if (sub === "get-phase") {
    const entry = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), args[0]);
    if (!entry) return done({ found: false, phase_number: args[0] ?? null }, 66);
    return done(phaseJson(entry));
  }
  if (sub === "analyze") {
    const a = analyze(g);
    return done(a, a.scope === "unreadable" ? 69 : 0);
  }
  if (sub === "annotate-dependencies") return done(annotate(g, args[0]));
  if (sub === "install-draft") return done(installDraft(g));
  throw fail(`unknown roadmap verb ${sub}`);
}

// GSDF-95: the approved roadmapper draft becomes ROADMAP, the REQUIREMENTS traceability and a fresh STATE, through the
// single writer (GSDC-12). The drafts stay in place as the record of what was approved.
function installDraft(g) {
  return writeShared(g, () => installDraftLocked(g));
}

function installDraftLocked(g) {
  const drafts = path.join(path.dirname(sharedFile(g.codeRoot, "ROADMAP.md")), "drafts");
  const draft = readIf(path.join(drafts, "ROADMAP.md"));
  if (draft === null) throw fail("no .planning/drafts/ROADMAP.md");
  const parsed = parseRoadmap(draft, g.cfg.gsd.requirement_id_regex);
  if (parsed.scope !== "complete") throw fail(`draft ROADMAP is ${parsed.scope}: ${[...parsed.listedOnly, ...parsed.duplicates].join(", ") || "no phases"}`);
  let trace;
  try {
    trace = JSON.parse(readIf(path.join(drafts, "traceability.json")) ?? "null");
  } catch (e) {
    throw fail(`drafts/traceability.json: invalid JSON (${e.message})`);
  }
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) throw fail("drafts/traceability.json must map requirement id -> phase");
  const known = new Set(parsed.phases.map((p) => p.padded));
  const bad = Object.entries(trace).filter(([, ph]) => !known.has(padPhase(String(ph).replace(/^Phase\s+/i, ""))));
  if (bad.length) throw fail(`traceability names phases missing from the draft: ${bad.map(([id, ph]) => `${id} -> ${ph}`).join(", ")}`);
  const reqFile = sharedFile(g.codeRoot, "REQUIREMENTS.md");
  const reqText = readIf(reqFile);
  const validation = validateDraft(reqText ?? "", draft, trace, g.cfg.gsd.requirement_id_regex);
  if (!validation.ok) throw fail(validation.problems.join("; "));
  const result = (() => {
    writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), lf(draft));
    if (reqText !== null) writeTextAtomic(reqFile, withTraceability(reqText, trace));
    return { roadmap: rel(g.codeRoot, sharedFile(g.codeRoot, "ROADMAP.md")), phases: parsed.phases.length, traced: Object.keys(trace).length, requirements: reqText !== null };
  })();
  const stateCreated = !fs.existsSync(sharedFile(g.codeRoot, "STATE.md"));
  if (stateCreated) initStateLocked(g, {});
  return { ...result, state: stateCreated ? "initialised" : "kept" };
}

// Replace (or append) the `## Traceability` section with one row per traced requirement.
function withTraceability(text, trace) {
  const lines = lf(text).trimEnd().split("\n");
  const start = lines.findIndex((l) => /^##\s+Traceability\s*$/.test(l));
  let end = lines.length;
  if (start >= 0) for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  const table = ["## Traceability", "", "| Requirement | Phase | Status |", "|-------------|-------|--------|",
    ...Object.entries(trace).map(([id, ph]) => `| ${id} | Phase ${String(ph).replace(/^Phase\s+/i, "")} | Pending |`), ""];
  const out = start >= 0 ? [...lines.slice(0, start), ...table, ...lines.slice(end)] : [...lines, "", ...table];
  return `${out.join("\n").trimEnd()}\n`;
}

function annotate(g, ref) {
  const phase = findPhase(g.codeRoot, ref);
  if (!phase) throw fail(`phase not found: ${ref}`);
  return writeShared(g, () => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    const entry = roadmapPhase(roadmap, ref);
    if (!entry) throw fail(`phase ${ref} has no ROADMAP entry`);
    const plans = readPlans(phase);
    const waves = [...new Set(plans.map((p) => p.wave))].sort((a, b) => a - b);
    const lines = ["**Waves:**", ...waves.map((w, i) => `- Wave ${w}${i ? ` (blocked on Wave ${waves[i - 1]})` : ""}: ${plans.filter((p) => p.wave === w).map((p) => p.id).join(", ")}`)];
    const truths = new Map();
    for (const p of plans) for (const t of p.fm.must_haves?.truths ?? []) truths.set(String(t), [...(truths.get(String(t)) ?? []), p.id]);
    const cross = [...truths].filter(([, ids]) => ids.length > 1);
    lines.push("**Cross-cutting constraints:**", ...(cross.length ? cross.map(([t, ids]) => `- ${t} (${ids.join(", ")})`) : ["- none"]));
    const next = annotateSection(roadmap.text, entry, lines);
    const changed = next !== roadmap.text.replace(/\r\n?/g, "\n");
    if (changed) writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), next);
    return { phase: entry.number, changed, waves: waves.length, cross_cutting: cross.length };
  });
}

// --- phase add / insert / remove / complete (GSDC-15) ---

// G012: the directory is created before the ROADMAP entry is published, and removed again if that write fails, so a
// failed or interrupted add never leaves an entry without a directory for a retry to number a second phase after.
function publishPhase(g, { number, name }, writeRoadmap) {
  const dir = path.join(phasesDir(g.codeRoot), `${padPhase(number)}-${slugify(name)}`);
  const created = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  try {
    writeRoadmap?.();
  } catch (e) {
    if (created) fs.rmdirSync(dir);
    throw e;
  }
  return dir;
}

// G012: a ROADMAP entry with no directory under the same name is what an interrupted add left behind; the retry completes it.
const strandedEntry = (g, roadmap, number, name) => {
  const entry = roadmapPhase(roadmap, number);
  return entry && !findPhase(g.codeRoot, number) && slugify(entry.phase_name) === slugify(name) ? entry : null;
};

export function phaseAdd(g, name, { goal } = {}) {
  if (!name) throw fail("phase add needs a name");
  return writeShared(g, () => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    if (!roadmap.exists) throw fail("ROADMAP.md does not exist");
    const max = roadmap.phases.reduce((m, p) => Math.max(m, Number(p.number.split(".")[0])), 0);
    const stranded = strandedEntry(g, roadmap, String(max), name);
    if (stranded) {
      const dir = publishPhase(g, { number: stranded.number, name });
      return { phase: stranded.number, directory: rel(g.codeRoot, dir), resumed: true };
    }
    const number = String(max + 1);
    const last = roadmap.phases[roadmap.phases.length - 1];
    const dir = publishPhase(g, { number, name }, () => writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), insertPhase(roadmap.text, roadmap, { number, name, goal, dependsOn: last?.number })));
    return { phase: number, directory: rel(g.codeRoot, dir) };
  });
}

export function phaseInsert(g, after, name, { goal } = {}) {
  if (!after || !name) throw fail("phase insert needs <after> and a name");
  return writeShared(g, () => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    const anchor = roadmapPhase(roadmap, after);
    if (!anchor) throw fail(`phase ${after} has no ROADMAP entry`);
    const base = anchor.number.split(".")[0];
    const used = roadmap.phases.filter((p) => p.number.split(".")[0] === base && p.number.includes(".")).map((p) => Number(p.number.split(".")[1]));
    const stranded = used.length ? strandedEntry(g, roadmap, `${base}.${Math.max(...used)}`, name) : null;
    if (stranded) {
      const dir = publishPhase(g, { number: stranded.number, name });
      return { phase: stranded.number, directory: rel(g.codeRoot, dir), inserted_after: anchor.number, resumed: true };
    }
    const number = `${base}.${(used.length ? Math.max(...used) : 0) + 1}`;
    const lastChild = [...roadmap.phases].filter((p) => p.number.split(".")[0] === base).pop();
    const dir = publishPhase(g, { number, name }, () => writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), insertPhase(roadmap.text, roadmap, { number, name, inserted: true, goal, dependsOn: anchor.number, after: lastChild })));
    return { phase: number, directory: rel(g.codeRoot, dir), inserted_after: anchor.number };
  });
}

const STARTED_ARTIFACTS = ["plan", "summary", "verification", "uat", "outline"];
const PLACEHOLDERS = new Set([".keep", ".gitkeep"]);

// Anything but a placeholder is owner work (CONTEXT, RESEARCH, checkpoints, attempts, notes): never deleted (GSDC-15).
const ownerFiles = (dir) => fs.readdirSync(dir).filter((n) => !PLACEHOLDERS.has(n));

function activePhase(g) {
  const text = readIf(sharedFile(g.codeRoot, "STATE.md"));
  if (text === null) return null;
  const st = parseState(text);
  if (st.error) throw fail(`STATE.md frontmatter: ${st.error}; cannot tell whether the phase is in the future`);
  return st.fm.active_phase === null || st.fm.active_phase === undefined ? null : String(st.fm.active_phase);
}

export function phaseRemove(g, ref) {
  return writeShared(g, () => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    const entry = roadmapPhase(roadmap, ref);
    if (!entry) throw fail(`phase ${ref} has no ROADMAP entry`);
    const active = activePhase(g);
    if (active !== null && comparePhase(entry.number, active) <= 0) throw fail(`phase ${entry.number} is not in the future (STATE active phase ${active}); only a future phase can be removed`);
    const phase = findPhase(g.codeRoot, ref);
    const owned = phase ? ownerFiles(phase.dir) : [];
    if (owned.length) throw fail(`phase ${entry.number} has work on disk (${owned.join(", ")}); only an empty future phase can be removed`);
    if (entry.number.includes(".") === false && roadmap.phases.some((p) => p.number.startsWith(`${entry.number}.`))) throw fail(`phase ${entry.number} has inserted phases; remove those first`);
    const later = roadmap.phases.filter((p) => comparePhase(p.number, entry.number) > 0);
    for (const p of later) {
      const ph = findPhase(g.codeRoot, p.number);
      if (ph && STARTED_ARTIFACTS.some((k) => listFiles(ph, k).length)) throw fail(`phase ${p.number} after ${entry.number} has started; removing would renumber started work`);
    }
    const mapping = new Map();
    if (!entry.number.includes(".")) {
      for (const p of later) {
        const [head, ...rest] = p.number.split(".");
        mapping.set(p.number, [String(Number(head) - 1), ...rest].join("."));
      }
    }
    // Preflight every rename before any write: a destination may only be a directory this removal frees.
    const moves = [...mapping].sort((a, b) => comparePhase(a[0], b[0])).map(([from, to]) => ({ from, to, ph: findPhase(g.codeRoot, from) })).filter((m) => m.ph);
    const freed = [phase?.dir, ...moves.map((m) => m.ph.dir)].filter(Boolean);
    for (const m of moves) {
      m.target = path.join(phasesDir(g.codeRoot), `${padPhase(m.to)}${m.ph.slug ? `-${m.ph.slug}` : ""}`);
      if (fs.existsSync(m.target) && !freed.some((d) => samePath(d, m.target))) throw fail(`renumbering ${m.from} -> ${m.to} would overwrite ${rel(g.codeRoot, m.target)}`);
    }
    let text = removePhaseText(roadmap.text, roadmap, entry);
    text = renumberText(text, mapping);
    const roadmapFile = sharedFile(g.codeRoot, "ROADMAP.md");
    const reqFile = sharedFile(g.codeRoot, "REQUIREMENTS.md");
    const reqText = readIf(reqFile);
    // G012: the directory moves run before the shared files are published. Each completed step is undone, latest first, when
    // a later one fails (Windows can refuse a rename while a reader holds the directory), so the roadmap never disagrees with
    // the directories. The removed phase moves aside until the removal is complete.
    const undo = [];
    const move = (from, to) => {
      renameWithRetry(from, to);
      undo.unshift(() => renameWithRetry(to, from));
    };
    const aside = phase ? path.join(phasesDir(g.codeRoot), `.removed-${path.basename(phase.dir)}`) : null;
    const renamed = [];
    try {
      if (phase) move(phase.dir, aside);
      for (const { from, to, ph, target } of moves) {
        move(ph.dir, target);
        for (const name of fs.readdirSync(target)) if (name.startsWith(`${ph.padded}-`)) move(path.join(target, name), path.join(target, `${padPhase(to)}-${name.slice(ph.padded.length + 1)}`));
        renamed.push({ from, to });
      }
      writeTextAtomic(roadmapFile, text);
      undo.unshift(() => writeTextAtomic(roadmapFile, roadmap.text));
      if (reqText !== null && mapping.size) writeTextAtomic(reqFile, renumberText(reqText, mapping));
    } catch (e) {
      for (const u of undo) u();
      throw e;
    }
    if (aside) {
      for (const n of fs.readdirSync(aside)) fs.rmSync(path.join(aside, n));
      fs.rmdirSync(aside);
    }
    return { removed: entry.number, renumbered: renamed };
  });
}

// Every path claimed in SUMMARY key-files that does not exist (advisory only).
function summaryClaims(g, phase) {
  const warnings = [];
  for (const id of summaryIds(phase)) {
    const fm = frontmatter(readIf(summaryPath(phase, id)) ?? "").fm;
    const kf = fm["key-files"] ?? {};
    for (const p of [...(kf.created ?? []), ...(kf.modified ?? [])].map(String)) {
      if (!isFile(path.resolve(g.codeRoot, p))) warnings.push(`${id}: SUMMARY claims ${p}, which does not exist`);
    }
  }
  return warnings;
}

export function phaseComplete(g, ref) {
  const phase = findPhase(g.codeRoot, ref);
  if (!phase) throw fail(`phase not found: ${ref}`);
  const v = readVerification(g.codeRoot, phase);
  if (!v.valid || v.status !== "passed") throw fail(`phase ${ref} cannot complete: verification status is ${v.status} (needs passed)`, { verification: v.status });
  return writeShared(g, () => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    const entry = roadmapPhase(roadmap, ref);
    if (!entry) throw fail(`phase ${ref} has no ROADMAP entry`);
    const date = today();
    writeJsonAtomic(completionFile(phase), { phase: phase.number, verification: v.path, verification_sha: v.sha, at: nowIso() });
    const n = planIds(phase).length;
    let text = setChecklist(roadmap.text, entry.number, true, date);
    text = setProgressRow(text, entry.number, [entry.phase_name, `${n}/${n}`, "Complete", date]);
    writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), text);
    const reqs = loadRequirements(g.codeRoot);
    const marked = entry.requirements.filter((id) => reqs.map.has(id));
    if (reqs.exists && marked.length) writeTextAtomic(sharedFile(g.codeRoot, "REQUIREMENTS.md"), setComplete(reqs, marked, true));
    const state = advanceState(g, entry.number);
    return { completed: entry.number, date, requirements: marked, state: state?.status ?? null, warnings: summaryClaims(g, phase) };
  });
}

// --- requirements ---

export function requirementsVerb(g, sub, args) {
  const reqs = loadRequirements(g.codeRoot);
  if (sub === "list" || sub === "parse") {
    const re = new RegExp(g.cfg.gsd.requirement_id_regex);
    return done({ exists: reqs.exists, requirements: [...reqs.map.values()].map((r) => ({ ...requirementView(r), valid_id: re.test(r.id) })), duplicates: duplicateIds(reqs) });
  }
  if (!reqs.exists) throw fail("REQUIREMENTS.md does not exist");
  let ids;
  let complete;
  if (sub === "mark-complete") {
    ids = idList(args.join(" "));
    complete = true;
  } else if (sub === "revert") {
    const entry = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), args[0]);
    if (!entry) throw fail(`phase ${args[0]} has no ROADMAP entry`);
    ids = entry.requirements;
    complete = false;
  } else throw fail(`unknown requirements verb ${sub}`);
  const unknown = ids.filter((id) => !reqs.map.has(id));
  if (unknown.length) return done({ status: "error", error: `unknown requirement ids: ${unknown.join(", ")}`, unknown }, 1);
  return done(
    writeShared(g, () => {
      const fresh = loadRequirements(g.codeRoot);
      writeTextAtomic(sharedFile(g.codeRoot, "REQUIREMENTS.md"), setComplete(fresh, ids, complete));
      return { [complete ? "marked" : "reverted"]: ids };
    }),
  );
}

// --- uat-passed (GSDC-16) ---

// The `### N. Name` tests plus every other `###` heading under the exact `## Tests` section (malformed: never silently
// dropped). A heading outside that section, or under a differently named `## Tests (3)`, is no test (G095).
export function parseUat(text) {
  const tests = [];
  const re = /^###\s+(\d+)\.\s*(.+?)\s*$/gm;
  const body = String(text ?? "").replace(/\r\n?/g, "\n");
  const found = /^##\s+Tests\s*$([\s\S]*?)(?=^#{1,2}\s|(?![\s\S]))/m.exec(body);
  const section = found?.[1] ?? "";
  const heads = [...section.matchAll(re)];
  heads.forEach((m, i) => {
    const chunk = section.slice(m.index, heads[i + 1]?.index ?? section.length);
    const result = /^result:\s*\[?([a-z_]+)\]?/m.exec(chunk)?.[1] ?? "pending";
    tests.push({ number: Number(m[1]), name: m[2], result, blocked_by: /^blocked_by:\s*(.+)$/m.exec(chunk)?.[1]?.trim() ?? null });
  });
  const malformed = section.split("\n").filter((l) => /^###/.test(l) && !/^###\s+\d+\.\s*\S/.test(l)).map((l) => l.trim());
  return { tests, malformed, found: found !== null };
}

// G095: the passed UAT is the human verification. Its report becomes passed: the status is set, the human items are
// dropped (the checker rejects passed with any left) and the behavior count is zero. Other keys are kept as written.
const HUMAN_KEYS = new Set(["human_verification", "behavior_unverified", "behavior_unverified_items"]);
export function canonicalVerification(text) {
  const body = lf(text);
  const m = /^---\n([\s\S]*?\n)---/.exec(body);
  if (!m) return body;
  const out = [];
  let dropping = false;
  for (const line of m[1].split("\n").slice(0, -1)) {
    const key = /^([\w-]+):/.exec(line)?.[1];
    if (key !== undefined) dropping = HUMAN_KEYS.has(key);
    if (key === "status") out.push("status: passed");
    else if (key === "behavior_unverified") out.push("behavior_unverified: 0");
    else if (!dropping) out.push(line);
  }
  return `---\n${out.map((l) => `${l}\n`).join("")}---${body.slice(m[0].length)}`;
}

// Writes the canonical report only when it reads back as passed; otherwise the report stays as it was.
function canonicalizeVerification(codeRoot, phase) {
  const file = phaseFile(phase, "VERIFICATION.md");
  const text = readIf(file);
  if (text === null || readVerification(codeRoot, phase).status !== "human_needed") return false;
  writeTextAtomic(file, canonicalVerification(text));
  if (readVerification(codeRoot, phase).status === "passed") return true;
  writeTextAtomic(file, text);
  return false;
}

export function uatPassed(g, phase, { requireVerification, uatOnly }) {
  const uatFiles = listFiles(phase, "uat");
  const blockers = [];
  const checks = [];
  for (const name of uatFiles) {
    const { tests, malformed, found } = parseUat(readIf(path.join(phase.dir, name)));
    // GSDC-16: an empty, draft or malformed UAT is no passed human verification.
    if (!found) blockers.push({ file: name, reason: "no ## Tests section" });
    else if (!tests.length) blockers.push({ file: name, reason: "no recognized test (### N. Name)" });
    for (const h of malformed) blockers.push({ file: name, reason: `unrecognized test heading: ${h}` });
    for (const t of tests) {
      checks.push({ file: name, ...t });
      if (t.result !== "pass") blockers.push({ file: name, test: t.number, name: t.name, result: t.result, blocked_by: t.blocked_by });
    }
  }
  if (!uatFiles.length) blockers.push({ reason: "no UAT file" });
  const verificationFiles = listFiles(phase, "verification");
  let canonicalized = false;
  if (requireVerification && !uatOnly) {
    if (!blockers.length) canonicalized = canonicalizeVerification(g.codeRoot, phase);
    const v = readVerification(g.codeRoot, phase);
    if (v.status !== "passed") blockers.push({ reason: `verification status ${v.status}` });
  }
  const passed = blockers.length === 0;
  return done({ passed, uat_files: uatFiles, verification_files: verificationFiles, checks, blockers, canonicalized }, passed ? 0 : 1);
}

// --- phase-plan-index (GSDC-36) ---

export function planIndex(g, phase) {
  const plans = readPlans(phase);
  const summaries = new Set(summaryIds(phase));
  const halts = new Set(haltIds(phase));
  const ids = new Set(plans.map((p) => p.id));
  const warnings = [];
  const rows = plans.map((p) => {
    for (const d of p.dependsOn) if (!ids.has(d)) warnings.push(`${p.id}: depends_on ${d} does not resolve to a plan`);
    // G057: a plan whose frontmatter did not parse has defaulted wave, owns and dependencies; it is never runnable.
    if (p.error) warnings.push(`${p.id}: frontmatter ${p.error}; not runnable until it parses`);
    const blockedBy = p.dependsOn.filter((d) => ids.has(d) && (halts.has(d) || !summaries.has(d)));
    const hasSummary = summaries.has(p.id);
    const halted = halts.has(p.id);
    return { id: p.id, wave: p.wave, depends_on: p.dependsOn, files_modified: p.filesModified, has_summary: hasSummary, halted, blocked_by: blockedBy, ready: !hasSummary && !halted && !p.error && blockedBy.length === 0, gap_closure: p.fm.gap_closure === true, task_count: p.tasks.length, plan_hash: textDigest(p.text).slice(0, 12), ...(p.error ? { error: p.error } : {}) };
  });
  const waves = [...new Set(rows.map((r) => r.wave))].sort((a, b) => a - b).map((w) => ({ wave: w, plans: rows.filter((r) => r.wave === w).map((r) => r.id) }));
  return done({ phase: phase.number, plans: rows, waves, incomplete: rows.filter((r) => !r.has_summary).map((r) => r.id), runnable: rows.filter((r) => r.ready).map((r) => r.id), warnings });
}

