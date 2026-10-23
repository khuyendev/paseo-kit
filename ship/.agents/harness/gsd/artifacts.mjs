// Artifact verbs: verify artifacts/key-links (GSDC-35), read verbs (GSDC-37), init payloads (GSDC-17),
// write/hash (GSDC-31), supersede (GSDC-29) and research prompt (GSDC-33).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeTextAtomic } from "../lib/io.mjs";
import { textDigest } from "../lib/hash.mjs";
import { isInside, samePath } from "../lib/paths.mjs";
import { asArray, done, fail, isDir, isFile, none, readIf, rel, unavailable } from "./common.mjs";
import { ARTIFACT_KINDS, artifactKind, findPhase, phaseFile, phasesDir, planIds, planPath, summaryIds, summaryPath } from "./planning.mjs";
import { keyHash } from "./revisions.mjs";
import { loadRoadmap, roadmapPhase } from "./roadmap.mjs";
import { REQUIRED_PLAN_FIELDS } from "./plan-checks.mjs";
import { phaseStatus } from "./status.mjs";
import { frontmatter } from "./yaml.mjs";

// --- verify artifacts / key-links ---

const inRoot = (root, p) => {
  const abs = path.resolve(root, String(p ?? ""));
  return isInside(abs, root) ? abs : null;
};

export function verifyArtifacts(g, plans) {
  const items = plans.flatMap((p) => asArray(p.fm.must_haves?.artifacts).map((a) => ({ plan: p.id, ...(typeof a === "string" ? { path: a } : a) })));
  if (!items.length) throw none("no must_haves.artifacts in scope");
  const results = items.map((a) => {
    const issues = [];
    const abs = inRoot(g.codeRoot, a.path);
    if (!abs) return { ...a, exists: false, passed: false, status: "path_rejected", issues: ["path outside the code root"] };
    if (!fs.existsSync(abs)) return { ...a, exists: false, passed: false, status: "missing", issues: ["file does not exist"] };
    if (isDir(abs)) return { ...a, exists: true, passed: false, status: "directory", issues: ["path is a directory"] };
    const text = readIf(abs) ?? "";
    const lines = text.split(/\r?\n/).length;
    if (a.min_lines && lines < Number(a.min_lines)) issues.push(`${lines} lines < min_lines ${a.min_lines}`);
    for (const c of asArray(a.contains)) if (!text.includes(String(c))) issues.push(`does not contain ${c}`);
    for (const e of asArray(a.exports)) if (!text.includes(String(e))) issues.push(`does not export ${e}`);
    return { ...a, exists: true, passed: issues.length === 0, status: issues.length ? "failed" : "passed", issues };
  });
  const allPassed = results.length > 0 && results.every((r) => r.passed);
  // passed/total/artifacts: the field names the generated verifier reads (GSDC-35, adapter layer for D-111).
  return done({ all_passed: allPassed, checked: results.length, passed: results.filter((r) => r.passed).length, total: results.length, results, artifacts: results }, allPassed ? 0 : 1);
}

// Patterns that could run away or depend on lookaround are not run (ReDoS guard).
const unsafePattern = (p) => p.length > 500 || /\(\?[=!<]|\\[1-9]|\\k</.test(p);

export function verifyKeyLinks(g, plans, allPlans) {
  const items = plans.flatMap((p) => asArray(p.fm.must_haves?.key_links).map((k) => ({ plan: p.id, wave: p.wave, ...k })));
  if (!items.length) throw none("no must_haves.key_links in scope");
  const results = items.map((k) => {
    const base = { plan: k.plan, from: k.from, to: k.to, via: k.via ?? null, pattern: k.pattern ?? null };
    // A link needs a source and something to look for: a missing `to` would otherwise match every source (G093).
    const given = (v) => String(v ?? "").trim() !== "";
    if (!given(k.from) || !(given(k.to) || given(k.pattern))) return { ...base, status: "invalid_entry", verified: false, detail: "key link needs a from and a to or a pattern" };
    const from = inRoot(g.codeRoot, k.from);
    if (!from) return { ...base, status: "path_rejected", verified: false, detail: "source path rejected: outside the code root" };
    if (k.to && /[/\\.]/.test(String(k.to)) && !inRoot(g.codeRoot, k.to)) return { ...base, status: "path_rejected", verified: false, detail: "target path rejected: outside the code root" };
    const src = readIf(from);
    if (src === null) {
      const promised = allPlans.some((p) => p.wave >= k.wave && p.filesModified.includes(String(k.from)));
      return { ...base, status: promised ? "pending" : "source_missing", verified: false, detail: promised ? "source not written yet (promised by a plan)" : "Source file not found" };
    }
    if (k.pattern) {
      if (unsafePattern(String(k.pattern))) return { ...base, status: "pattern_neutralized", verified: false, detail: "Pattern not verified (lookaround, backreference or over 500 chars)" };
      let re;
      try {
        re = new RegExp(String(k.pattern));
      } catch {
        return { ...base, status: "pattern_invalid", verified: false, detail: "Pattern is not a valid regular expression" };
      }
      // The link is the source's call/import of the target: a match only in the target proves the target's own
      // symbol, not the wiring (GSDC-35, INV-36).
      const ok = re.test(src);
      return { ...base, status: ok ? "verified" : "not_found", verified: ok, detail: ok ? "Pattern found in source" : `Pattern "${k.pattern}" not found in source` };
    }
    const ok = src.includes(String(k.to ?? ""));
    return { ...base, status: ok ? "verified" : "not_found", verified: ok, detail: ok ? "Target referenced in source" : "Target not referenced in source" };
  });
  // Pending is nonblocking (a later wave writes the source); a neutralized pattern never verifies, so it fails (G093).
  const hard = results.filter((r) => !["verified", "pending"].includes(r.status));
  const allVerified = results.length > 0 && hard.length === 0 && results.every((r) => r.verified);
  return done({ all_verified: allVerified, verified: results.filter((r) => r.verified).length, total: results.length, results, links: results }, hard.length ? 1 : 0);
}

// --- read verbs ---

export function frontmatterGet(g, file, key) {
  const abs = inRoot(g.codeRoot, file);
  if (!abs) throw fail(`${file} is outside the code root`);
  const text = readIf(abs);
  if (text === null) throw none(`no file ${file}`);
  const p = frontmatter(text);
  if (p.error) return done({ status: "error", error: p.error, line: p.line }, 1);
  if (key === undefined) return done({ present: p.present, frontmatter: p.fm });
  if (!Object.hasOwn(p.fm, key)) throw none(`frontmatter has no key ${key}`, { keys: Object.keys(p.fm) });
  return done({ key, value: p.fm[key] });
}

const SCHEMAS = {
  plan: [...REQUIRED_PLAN_FIELDS],
  "plan-gap-closure": [...REQUIRED_PLAN_FIELDS, "gap_closure"],
  summary: ["phase", "plan", "key-files"],
  verification: ["phase", "status", "covered_files", "covered_digest"],
};

export function frontmatterValidate(g, file, schema) {
  if (!SCHEMAS[schema]) throw fail(`--schema must be one of ${Object.keys(SCHEMAS).join(", ")}`);
  const abs = inRoot(g.codeRoot, file);
  const text = abs ? readIf(abs) : null;
  if (text === null) throw none(`no file ${file}`);
  const p = frontmatter(text);
  const problems = p.error ? [p.error] : SCHEMAS[schema].filter((k) => !Object.hasOwn(p.fm, k)).map((k) => `missing ${k}`);
  if (!p.error && schema === "plan-gap-closure" && p.fm.gap_closure !== true) problems.push("gap_closure must be true");
  return done({ valid: problems.length === 0, schema, problems }, problems.length ? 1 : 0);
}

export function listArtifacts(g, phase, type) {
  if (type && !ARTIFACT_KINDS[type]) throw fail(`--type must be one of ${Object.keys(ARTIFACT_KINDS).join(", ")}`);
  const names = isDir(phase.dir) ? fs.readdirSync(phase.dir).filter((n) => isFile(path.join(phase.dir, n))) : [];
  const items = names.map((n) => ({ name: n, kind: artifactKind(n), path: rel(g.codeRoot, path.join(phase.dir, n)) })).filter((a) => a.kind && (!type || a.kind === type));
  if (!items.length) throw none(`no ${type ?? ""} artifacts in ${phase.name}`.replace("  ", " "));
  return done({ phase: phase.number, artifacts: items });
}

export function summaryExtract(g, globs, fields) {
  const want = fields ? fields.split(",").map((f) => f.trim()).filter(Boolean) : null;
  const files = [];
  const walk = (dir) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else files.push(rel(g.codeRoot, abs));
    }
  };
  walk(path.join(g.codeRoot, ".planning"));
  const hits = files.filter((f) => globs.some((gl) => path.posix.matchesGlob(f, gl))).sort();
  if (!hits.length) throw none("no file matches");
  return done({
    summaries: hits.map((f) => {
      const fm = frontmatter(readIf(path.join(g.codeRoot, f)) ?? "").fm;
      return { path: f, fields: want ? Object.fromEntries(want.map((k) => [k, fm[k] ?? null])) : fm };
    }),
  });
}

const DIGEST_FIELDS = ["subsystem", "provides", "affects", "tech-stack", "patterns-established", "key-decisions", "key-files"];

export function historyDigest(g) {
  const roadmap = loadRoadmap(g.codeRoot, g.cfg);
  const phases = [];
  for (const rp of roadmap.phases) {
    const phase = findPhase(g.codeRoot, rp.number);
    if (!phase) continue;
    const summaries = summaryIds(phase).map((id) => {
      const fm = frontmatter(readIf(summaryPath(phase, id)) ?? "").fm;
      return { plan: id, ...Object.fromEntries(DIGEST_FIELDS.map((k) => [k, fm[k] ?? null])) };
    });
    if (summaries.length) phases.push({ phase: rp.number, name: rp.phase_name, summaries });
  }
  return done({ phases });
}

// --- init payloads (paths and flags, never file contents) ---

export function initPayload(g, workflow, ref) {
  const roadmap = loadRoadmap(g.codeRoot, g.cfg);
  const entry = roadmapPhase(roadmap, ref);
  if (!entry) throw unavailable(`phase not found: ${ref}`, { status: "unavailable", phase_found: false });
  const phase = findPhase(g.codeRoot, ref);
  const p = (suffix) => (phase && isFile(phaseFile(phase, suffix)) ? rel(g.codeRoot, phaseFile(phase, suffix)) : null);
  const plans = phase ? planIds(phase) : [];
  const summaries = phase ? summaryIds(phase) : [];
  const shared = (name) => ({ path: `.planning/${name}`, exists: isFile(path.join(g.codeRoot, ".planning", name)) });
  return done({
    workflow,
    phase_found: true,
    phase_number: entry.number,
    padded_phase: entry.padded,
    phase_name: entry.phase_name,
    phase_slug: phase?.slug ?? null,
    phase_dir: phase ? rel(g.codeRoot, phase.dir) : null,
    phase_status: phaseStatus(g.codeRoot, phase).status,
    phase_req_ids: entry.requirements,
    phase_goal: entry.goal,
    context_path: p("CONTEXT.md"),
    research_path: p("RESEARCH.md"),
    wiring_path: p("WIRING.md"),
    verification_path: p("VERIFICATION.md"),
    uat_path: p("UAT.md"),
    outline_path: p("PLAN-OUTLINE.md"),
    has_discuss_checkpoint: Boolean(p("DISCUSS-CHECKPOINT.json")),
    plans: plans.map((id) => rel(g.codeRoot, planPath(phase, id))),
    plan_count: plans.length,
    summary_count: summaries.filter((id) => plans.includes(id)).length,
    incomplete_plans: plans.filter((id) => !summaries.includes(id)),
    roadmap: shared("ROADMAP.md"),
    state: shared("STATE.md"),
    requirements: shared("REQUIREMENTS.md"),
    project: shared("PROJECT.md"),
    gsd: g.cfg.gsd,
  });
}

export function initProject(g) {
  const files = ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"];
  const missing = files.filter((f) => !isFile(path.join(g.codeRoot, ".planning", f)));
  let stateVersion = null;
  if (!missing.includes("STATE.md")) stateVersion = frontmatter(readIf(path.join(g.codeRoot, ".planning", "STATE.md")) ?? "").fm.gsd_state_version ?? null;
  const initialized = missing.length === 0 && stateVersion !== null;
  return done({ initialized, missing, state_version: stateVersion, planning_exists: isDir(path.join(g.codeRoot, ".planning")) });
}

// --- write / hash / supersede ---

const SHARED = new Set(["PROJECT", "REQUIREMENTS", "ROADMAP", "STATE"]);

// `<phaseDir>` must be an existing .planning/phases/<NN>-<slug> directory after `..` and symlinks are resolved.
export function resolvePhaseDir(g, ref) {
  let real;
  try {
    real = fs.realpathSync(path.resolve(g.codeRoot, String(ref ?? "")));
  } catch {
    throw fail(`phase directory ${ref} does not exist`);
  }
  const phases = fs.existsSync(phasesDir(g.codeRoot)) ? fs.realpathSync(phasesDir(g.codeRoot)) : null;
  if (!phases || !samePath(path.dirname(real), phases) || !/^\d+(?:\.\d+)*-[^/\\]+$/.test(path.basename(real))) throw fail(`${ref} is not a .planning/phases/<NN>-<slug> directory`);
  return findPhase(g.codeRoot, path.join(phasesDir(g.codeRoot), path.basename(real)));
}

export function writeArtifact(g, ref, name, text) {
  if (!/^[A-Z][A-Z-]*$/.test(String(name ?? "")) || SHARED.has(name)) throw fail(`NAME must match ^[A-Z][A-Z-]*$ and not be a shared planning file (got ${name})`);
  const phase = resolvePhaseDir(g, ref);
  const file = phaseFile(phase, `${name}.md`);
  writeTextAtomic(file, text);
  return done({ written: rel(g.codeRoot, file), hash: textDigest(text) });
}

export function supersede(g, phase, keep) {
  const keepSet = new Set(keep);
  const dest = path.join(phase.dir, "superseded");
  const moved = [];
  for (const id of planIds(phase)) {
    if (keepSet.has(id)) continue;
    for (const file of [planPath(phase, id), summaryPath(phase, id)]) {
      if (!isFile(file)) continue;
      fs.mkdirSync(dest, { recursive: true });
      let target = path.join(dest, path.basename(file));
      for (let n = 1; fs.existsSync(target); n++) target = path.join(dest, `${path.basename(file)}.${n}`);
      fs.renameSync(file, target);
      moved.push({ from: rel(g.codeRoot, file), to: rel(g.codeRoot, target) });
    }
  }
  return done({ moved, kept: [...keepSet] });
}

// --- research prompt (GSDC-33): the vendored dispatch fragment with phase values only ---

export const FRAGMENT_FILE = fileURLToPath(new URL("../../gsd/upstream/capabilities/research/fragments/plan-pre.md", import.meta.url));

export function researchPrompt(g, phase) {
  const fragment = readIf(FRAGMENT_FILE);
  if (fragment === null) throw unavailable(`vendored research fragment missing: ${FRAGMENT_FILE}`);
  const entry = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), phase.number);
  const optional = {
    context_path: isFile(phaseFile(phase, "CONTEXT.md")) ? rel(g.codeRoot, phaseFile(phase, "CONTEXT.md")) : null,
    requirements_path: isFile(path.join(g.codeRoot, ".planning", "REQUIREMENTS.md")) ? ".planning/REQUIREMENTS.md" : null,
    state_path: isFile(path.join(g.codeRoot, ".planning", "STATE.md")) ? ".planning/STATE.md" : null,
  };
  const values = {
    phase_number: entry?.number ?? phase.number,
    phase_name: entry?.phase_name ?? phase.slug,
    phase_description: entry?.goal ?? "",
    phase_req_ids: (entry?.requirements ?? []).join(", ") || "none",
    phase_dir: rel(g.codeRoot, phase.dir),
    phase_num: phase.padded,
    ...optional,
  };
  const prompt = fragment
    .split(/\r?\n/)
    .filter((line) => !Object.entries(optional).some(([k, v]) => v === null && line.includes(`{${k}}`)))
    .map((line) => (line.trim() === "${AGENT_SKILLS_RESEARCHER}" ? "" : line.replace(/\{([a-z_]+)\}/g, (all, k) => (Object.hasOwn(values, k) ? String(values[k]) : all))))
    .join("\n");
  return done({ prompt, inputDigest: keyHash(g, phase, "research").hash, path: rel(g.codeRoot, phaseFile(phase, "RESEARCH.md")) });
}

