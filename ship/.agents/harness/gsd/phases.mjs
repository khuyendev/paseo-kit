// Phase, roadmap and requirement verbs: find-phase, analyze (GSDC-08, GSDC-13, GSDC-14), phase add/insert/remove/
// complete (GSDC-15), uat-passed (GSDC-16), phase-plan-index (GSDC-36), requirement marks (GSDC-09).
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, writeTextAtomic } from "../lib/io.mjs";
import { done, fail, idList, isFile, nowIso, readIf, rel, today } from "./common.mjs";
import { comparePhase, findPhase, haltIds, listFiles, padPhase, phasesDir, planIds, readPlans, sharedFile, summaryIds, summaryPath } from "./planning.mjs";
import { loadRequirements, requirementView, setComplete } from "./requirements.mjs";
import { annotateSection, insertPhase, loadRoadmap, phaseJson, removePhaseText, renumberText, roadmapPhase, setChecklist, setProgressRow, slugify } from "./roadmap.mjs";
import { advanceState, writeShared } from "./state.mjs";
import { completionFile, phaseStatus, readVerification } from "./status.mjs";
import { frontmatter } from "./yaml.mjs";

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
  throw fail(`unknown roadmap verb ${sub}`);
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

export function phaseAdd(g, name, { goal } = {}) {
  if (!name) throw fail("phase add needs a name");
  return writeShared(g, () => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    if (!roadmap.exists) throw fail("ROADMAP.md does not exist");
    const max = roadmap.phases.reduce((m, p) => Math.max(m, Number(p.number.split(".")[0])), 0);
    const number = String(max + 1);
    const last = roadmap.phases[roadmap.phases.length - 1];
    writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), insertPhase(roadmap.text, roadmap, { number, name, goal, dependsOn: last?.number }));
    const dir = path.join(phasesDir(g.codeRoot), `${padPhase(number)}-${slugify(name)}`);
    fs.mkdirSync(dir, { recursive: true });
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
    const number = `${base}.${(used.length ? Math.max(...used) : 0) + 1}`;
    const lastChild = [...roadmap.phases].filter((p) => p.number.split(".")[0] === base).pop();
    writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), insertPhase(roadmap.text, roadmap, { number, name, inserted: true, goal, dependsOn: anchor.number, after: lastChild }));
    const dir = path.join(phasesDir(g.codeRoot), `${padPhase(number)}-${slugify(name)}`);
    fs.mkdirSync(dir, { recursive: true });
    return { phase: number, directory: rel(g.codeRoot, dir), inserted_after: anchor.number };
  });
}

const STARTED_ARTIFACTS = ["plan", "summary", "verification", "uat", "outline"];

export function phaseRemove(g, ref) {
  return writeShared(g, () => {
    const roadmap = loadRoadmap(g.codeRoot, g.cfg);
    const entry = roadmapPhase(roadmap, ref);
    if (!entry) throw fail(`phase ${ref} has no ROADMAP entry`);
    const phase = findPhase(g.codeRoot, ref);
    if (phase && STARTED_ARTIFACTS.some((k) => listFiles(phase, k).length)) throw fail(`phase ${entry.number} has started (plans or reports exist); only an unstarted future phase can be removed`);
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
    let text = removePhaseText(roadmap.text, roadmap, entry);
    text = renumberText(text, mapping);
    writeTextAtomic(sharedFile(g.codeRoot, "ROADMAP.md"), text);
    const reqFile = sharedFile(g.codeRoot, "REQUIREMENTS.md");
    const reqText = readIf(reqFile);
    if (reqText !== null && mapping.size) writeTextAtomic(reqFile, renumberText(reqText, mapping));
    if (phase) fs.rmSync(phase.dir, { recursive: true });
    const renamed = [];
    for (const [from, to] of [...mapping].sort((a, b) => comparePhase(a[0], b[0]))) {
      const ph = findPhase(g.codeRoot, from);
      if (!ph) continue;
      const target = path.join(phasesDir(g.codeRoot), `${padPhase(to)}${ph.slug ? `-${ph.slug}` : ""}`);
      fs.renameSync(ph.dir, target);
      for (const name of fs.readdirSync(target)) if (name.startsWith(`${ph.padded}-`)) fs.renameSync(path.join(target, name), path.join(target, `${padPhase(to)}-${name.slice(ph.padded.length + 1)}`));
      renamed.push({ from, to });
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
    return done({ exists: reqs.exists, requirements: [...reqs.map.values()].map((r) => ({ ...requirementView(r), valid_id: re.test(r.id) })) });
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

export function parseUat(text) {
  const tests = [];
  const re = /^###\s+(\d+)\.\s*(.+?)\s*$/gm;
  const body = String(text ?? "").replace(/\r\n?/g, "\n");
  const heads = [...body.matchAll(re)];
  heads.forEach((m, i) => {
    const chunk = body.slice(m.index, heads[i + 1]?.index ?? body.length);
    const result = /^result:\s*\[?([a-z_]+)\]?/m.exec(chunk)?.[1] ?? "pending";
    tests.push({ number: Number(m[1]), name: m[2], result, blocked_by: /^blocked_by:\s*(.+)$/m.exec(chunk)?.[1]?.trim() ?? null });
  });
  return tests;
}

export function uatPassed(g, phase, { requireVerification, uatOnly }) {
  const uatFiles = listFiles(phase, "uat");
  const blockers = [];
  const checks = [];
  for (const name of uatFiles) {
    const tests = parseUat(readIf(path.join(phase.dir, name)));
    for (const t of tests) {
      checks.push({ file: name, ...t });
      if (t.result !== "pass") blockers.push({ file: name, test: t.number, name: t.name, result: t.result, blocked_by: t.blocked_by });
    }
  }
  if (!uatFiles.length) blockers.push({ reason: "no UAT file" });
  const verificationFiles = listFiles(phase, "verification");
  if (requireVerification && !uatOnly) {
    const v = readVerification(g.codeRoot, phase);
    if (v.status !== "passed") blockers.push({ reason: `verification status ${v.status}` });
  }
  const passed = blockers.length === 0;
  return done({ passed, uat_files: uatFiles, verification_files: verificationFiles, checks, blockers }, passed ? 0 : 1);
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
    const blockedBy = p.dependsOn.filter((d) => ids.has(d) && (halts.has(d) || !summaries.has(d)));
    const hasSummary = summaries.has(p.id);
    const halted = halts.has(p.id);
    return { id: p.id, wave: p.wave, depends_on: p.dependsOn, files_modified: p.filesModified, has_summary: hasSummary, halted, blocked_by: blockedBy, ready: !hasSummary && !halted && blockedBy.length === 0, gap_closure: p.fm.gap_closure === true };
  });
  const waves = [...new Set(rows.map((r) => r.wave))].sort((a, b) => a - b).map((w) => ({ wave: w, plans: rows.filter((r) => r.wave === w).map((r) => r.id) }));
  return done({ phase: phase.number, plans: rows, waves, incomplete: rows.filter((r) => !r.has_summary).map((r) => r.id), runnable: rows.filter((r) => r.ready).map((r) => r.id), warnings });
}

