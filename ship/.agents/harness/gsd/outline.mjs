// Outline + manifest (GSDC-24, GSDC-25), waves (GSDC-26) and the executor-neutral handoff (GSDC-27).
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../lib/io.mjs";
import { sha256, textDigest } from "../lib/hash.mjs";
import { done, fail, idList, lf, none, readIf, rel } from "./common.mjs";
import { producesOf, producesProblems, resolveEdge } from "./contracts.mjs";
import { balancedGlob, classify, covers, filesUnder, hasGlob, ownsPath, sharedPaths } from "./adapter-hooks.mjs";
import { normPlanId, phaseFile, planIds, planPath, readPlans, summaryPath } from "./planning.mjs";
import { inheritedTests } from "./inherited-tests.mjs";
import { filesPerPlanLines, ownershipProblems, waveOverlaps } from "./plan-checks.mjs";
import { loadRequirements } from "./requirements.mjs";
import { loadRoadmap, roadmapPhase } from "./roadmap.mjs";

const EMPTY = /^(none|-|—|n\/a)?$/i;
const cell = (s) => String(s ?? "").trim().replace(/^`|`$/g, "").replace(/`/g, "").trim();
const listCell = (s) => (EMPTY.test(cell(s)) ? [] : idList(cell(s)).filter((x) => !EMPTY.test(x)));

export function parseOutline(text) {
  const lines = lf(text).split("\n");
  const complete = lines.some((l) => /^## OUTLINE COMPLETE\s*$/.test(l));
  const rows = [];
  let header = null;
  for (const line of lines) {
    if (!line.trim().startsWith("|")) {
      if (header && rows.length) break;
      header = null;
      continue;
    }
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (/^:?-{2,}/.test(cells[0])) continue;
    if (!header) {
      const lower = cells.map((c) => c.toLowerCase());
      if (lower.some((c) => c.startsWith("plan id"))) header = lower;
      continue;
    }
    const col = (prefix) => header.findIndex((h) => h.startsWith(prefix));
    const get = (prefix) => (col(prefix) >= 0 ? cells[col(prefix)] : "");
    rows.push({ id: cell(get("plan id")), objective: cell(get("objective")), wave: Number(cell(get("wave"))) || null, depends_on: listCell(get("depends")), requirements: listCell(get("requirements")) });
  }
  return { complete, rows };
}

// G030: each manifest entry is a plan record with a string id; a null or id-less entry would throw or read as "undefined".
const entryError = (p, i) => {
  if (!p || typeof p !== "object" || Array.isArray(p)) return `manifest plans[${i}] is not an object`;
  if (typeof p.id !== "string") return `manifest plans[${i}] has no string id`;
  return null;
};

export function readOutline(phase) {
  const file = phaseFile(phase, "PLAN-OUTLINE.md");
  const manifestFile = phaseFile(phase, "PLAN-OUTLINE.manifest.json");
  const text = readIf(file);
  if (text === null) return { exists: false, file, manifestFile };
  const parsed = parseOutline(text);
  let manifest = null;
  let manifestError = null;
  const mtext = readIf(manifestFile);
  if (mtext === null) manifestError = "manifest missing";
  else {
    try {
      manifest = JSON.parse(mtext);
      if (!manifest || !Array.isArray(manifest.plans)) manifestError = "manifest has no plans array";
      else manifestError = manifest.plans.map(entryError).find(Boolean) ?? null;
    } catch (e) {
      manifestError = `manifest is not valid JSON (${e.message})`;
    }
  }
  return { exists: true, file, manifestFile, ...parsed, manifest, manifestError };
}

export function outlineParseVerb(g, phase) {
  const o = readOutline(phase);
  if (!o.exists) throw none(`no outline ${rel(g.codeRoot, o.file)}`);
  return done({ file: rel(g.codeRoot, o.file), manifestFile: rel(g.codeRoot, o.manifestFile), exists: true, complete: o.complete, rows: o.rows, manifest: o.manifest, manifestError: o.manifestError });
}

// filesPerPlan: "error" (default) holds a plan whose owns reach the blocker line as an error; "warn" reports it as a warning (an outline
// that was reviewed and has plans is not reopened by this check, kit feedback 69); inheritedTests the same for a test file a verify
// command runs that no plan of the phase owns (kit feedback 101).
export async function outlineCheck(g, phase, { tracer = true, plansPerPhase, wavesPerPhase, filesPerPlan = "error", inheritedTests: inheritedMode = "error" } = {}) {
  const errors = [];
  const warnings = [];
  const o = readOutline(phase);
  const limits = { ...g.cfg.gsd.plan_limits, ...(plansPerPhase ? { plans_per_phase: plansPerPhase } : {}), ...(wavesPerPhase ? { waves_per_phase: wavesPerPhase } : {}) };
  if (!o.exists) {
    errors.push("no outline file");
    return done({ passed: false, errors, warnings, crossPlan: [], needsWiring: false, waves: [], rows: [] }, 1);
  }
  if (!o.complete) errors.push("outline has no ## OUTLINE COMPLETE line");
  if (!o.rows.length) errors.push("outline has no plan rows");
  const ids = o.rows.map((r) => r.id);
  const idRe = new RegExp(`^${phase.padded.replace(".", "\\.")}-\\d{2,}$`);
  const byId = new Map();
  for (const r of o.rows) {
    if (byId.has(r.id)) errors.push(`duplicate plan id ${r.id}`);
    byId.set(r.id, r);
    if (!idRe.test(r.id)) errors.push(`malformed plan id ${r.id} (expected ${phase.padded}-<MM>)`);
    if (!r.objective) errors.push(`${r.id}: empty objective`);
    if (!Number.isInteger(r.wave) || r.wave < 1) errors.push(`${r.id}: wave must be a positive integer`);
  }
  for (const r of o.rows) {
    for (const d of r.depends_on) {
      const dep = byId.get(d) ?? byId.get(normPlanId(d));
      if (!dep) errors.push(`${r.id}: depends on unknown plan ${d}`);
      else if (dep.wave >= r.wave) errors.push(`${r.id}: depends on ${d} in the same or a later wave`);
    }
  }
  const entry = roadmapPhase(loadRoadmap(g.codeRoot, g.cfg), phase.number);
  const roadmapIds = entry?.requirements ?? [];
  if (!entry) warnings.push("phase has no ROADMAP entry");
  const assigned = new Set(o.rows.flatMap((r) => r.requirements));
  for (const id of roadmapIds) if (!assigned.has(id)) errors.push(`ROADMAP requirement ${id} is assigned to no plan`);
  for (const id of assigned) if (entry && !roadmapIds.includes(id)) warnings.push(`requirement ${id} is not on the ROADMAP line`);
  const waves = [...new Set(o.rows.map((r) => r.wave))].filter(Number.isInteger).sort((a, b) => a - b);
  if (o.rows.length > limits.plans_per_phase) errors.push(`${o.rows.length} plans > plans_per_phase ${limits.plans_per_phase}`);
  if (waves.length > limits.waves_per_phase) errors.push(`${waves.length} waves > waves_per_phase ${limits.waves_per_phase}`);
  const crossPlan = [];
  let filesLines = null;
  let inherited = [];
  if (o.manifestError) errors.push(o.manifestError);
  else {
    // G014: a repeated id is refused, and every entry (not one per id) feeds the owns, shared and overlap checks.
    const mplans = new Map();
    for (const p of o.manifest.plans) {
      const id = String(p.id);
      if (mplans.has(id)) errors.push(`manifest has duplicate plan id ${id}`);
      mplans.set(id, p);
    }
    for (const id of ids) if (!mplans.has(id)) errors.push(`manifest has no entry for ${id}`);
    for (const id of mplans.keys()) if (!byId.has(id)) errors.push(`manifest entry ${id} is not in the outline`);
    const forms = g.cfg.adapter.ownership.owns_forms;
    const ownedOf = new Map();
    const candidates = new Set();
    for (const p of o.manifest.plans) {
      const id = String(p.id);
      const owns = Array.isArray(p.owns) ? p.owns : [];
      if (!owns.length) errors.push(`${id}: empty owns`);
      const paths = [];
      for (const e of owns) {
        const m = ownsPath(e, forms);
        if (m === null) errors.push(`${id}: invalid owns entry ${e}`);
        else {
          paths.push(m);
          if (hasGlob(m) && !balancedGlob(m)) errors.push(`${id}: owns glob has an unbalanced [ or {, it would match nothing: ${m}`);
          candidates.add(m);
          for (const f of filesUnder(g.codeRoot, m)) candidates.add(f);
        }
      }
      ownedOf.set(id, [...(ownedOf.get(id) ?? []), ...paths]);
      // Kit feedback 67: a produced symbol is {symbol, kind, file, signature} with its file inside the plan's owns.
      if (g.cfg.gsd.contract_check) {
        const pp = producesProblems(p, paths);
        errors.push(...pp.errors);
        warnings.push(...pp.warnings);
      }
      const row = byId.get(id);
      if (row && JSON.stringify([...(p.requirements ?? [])].sort()) !== JSON.stringify([...row.requirements].sort())) warnings.push(`${id}: manifest requirements differ from the outline row`);
      for (const v of p.verify ?? []) if (classify(v, g.cfg.adapter.verify_vocabulary).kind === "unknown") warnings.push(`${id}: verify obligation outside the vocabulary: ${v}`);
      for (const c of p.consumes ?? []) {
        const producer = mplans.get(String(c.plan));
        const prow = byId.get(String(c.plan));
        if (!producer || !prow) {
          errors.push(`${id}: consumes from unknown plan ${c.plan}`);
          continue;
        }
        if (row && prow.wave > row.wave) errors.push(`${id}: consumes from later-wave plan ${c.plan}`);
        if (!resolveEdge(producesOf(producer), c.symbol)) warnings.push(`${id}: consumed symbol ${c.symbol} is not in ${c.plan} produces`);
        crossPlan.push({ consumer: id, producer: String(c.plan), symbol: c.symbol, sameWave: Boolean(row && prow.wave === row.wave) });
      }
    }
    const shared = await sharedPaths(g, [...candidates]);
    for (const [id, paths] of ownedOf) for (const p of paths) if ([...shared].some((s) => s === p || covers(p, s))) errors.push(`${id}: owns ${p} covers a shared path`);
    const asPlans = o.rows.filter((r) => mplans.has(r.id)).map((r) => ({ id: r.id, wave: r.wave, filesModified: [] }));
    for (const pr of waveOverlaps(asPlans, (p) => ownedOf.get(p.id) ?? [])) if (pr.kind === "overlapping-owns") errors.push(pr.message);
    const it = await inheritedTests(g, o.manifest.plans, ownedOf);
    (inheritedMode === "warn" ? warnings : errors).push(...it.problems);
    inherited = it.tests;
    // Kit feedback 69: the checker's Files/plan lines, applied to the allocation while it can still change. A directory in owns counts 1.
    const counts = new Map([...ownedOf].map(([id, paths]) => [id, [...new Set(paths)]]));
    filesLines = filesPerPlanLines(g, [...counts].map(([, files]) => ({ filesModified: files })), limits.plans_per_phase);
    const extra = g.cfg.gsd.tracer_extra_files;
    for (const [id, files] of counts) {
      const more = mplans.get(id)?.tracer?.is ? extra : 0;
      const [warnAt, blockAt] = [filesLines.warning + more, filesLines.blocker + more];
      if (files.length >= blockAt) (filesPerPlan === "warn" ? warnings : errors).push(`${id}: owns ${files.length} paths, blocker at ${blockAt}+ (split the plan or move owned paths to another plan; gsd.files_per_plan sets the lines)`);
      else if (files.length >= warnAt) warnings.push(`${id}: owns ${files.length} paths, warning at ${warnAt}+`);
    }
    if (tracer) {
      const tracers = [...mplans].filter(([, p]) => p.tracer?.is);
      if (!tracers.length) errors.push("tracer mode: no manifest plan has tracer.is");
      for (const [id, p] of tracers) {
        if (byId.get(id)?.wave !== 1) errors.push(`${id}: tracer plan outside wave 1`);
        if ((p.consumes ?? []).length) errors.push(`${id}: tracer plan consumes another plan`);
        if (!p.tracer.outcome) errors.push(`${id}: tracer plan lacks tracer.outcome`);
        if (/^none:\s*\S/.test(String(p.tracer.scenario ?? ""))) warnings.push(`${id}: tracer.scenario ${p.tracer.scenario}`);
      }
    }
  }
  const json = { passed: errors.length === 0, errors, warnings, crossPlan, needsWiring: crossPlan.length > 0, waves, rows: o.rows, limits, files_per_plan: filesLines, inheritedTests: inherited };
  return done(json, errors.length ? 1 : 0);
}

// --- waves (GSDC-26) ---

export function waveCheck(g, phase, subset) {
  const all = new Set(planIds(phase));
  const ids = subset ?? [...all];
  const plans = readPlans(phase, ids);
  const errors = [];
  const warnings = [];
  for (const id of ids) if (!all.has(id)) errors.push(`unknown plan ${id}`);
  const inSet = new Map(plans.map((p) => [p.id, p]));
  for (const p of plans) {
    if (p.error) errors.push(`${p.id}: frontmatter parse error: ${p.error}`);
    for (const d of p.dependsOn) {
      const dep = inSet.get(d);
      if (dep) {
        if (dep.wave >= p.wave) errors.push(`${p.id}: depends on ${d}, which is not in an earlier wave`);
      } else if (!subset || !all.has(d)) errors.push(`${p.id}: depends on unknown plan ${d}`);
    }
    if (p.wave > 1 && !p.dependsOn.length) warnings.push(`${p.id}: wave ${p.wave} with empty depends_on`);
  }
  const forms = g.cfg.adapter.ownership.owns_forms;
  for (const pr of waveOverlaps(plans, (p) => p.owns.map((e) => ownsPath(e, forms)).filter(Boolean))) errors.push(pr.message);
  const waves = [...new Set(plans.map((p) => p.wave))].sort((a, b) => a - b).map((w) => ({ wave: w, plans: plans.filter((p) => p.wave === w).map((p) => p.id) }));
  return { waves, errors, warnings, plans };
}

export const wavesVerb = (g, phase, subset) => {
  const r = waveCheck(g, phase, subset);
  return done({ waves: r.waves, errors: r.errors, warnings: r.warnings }, r.errors.length ? 1 : 0);
};

// --- handoff (GSDC-27) ---

const isTracer = (plan, manifestEntry) => plan.tasks.some((t) => t.type === "tracer") || plan.fm.tracer === true || Boolean(manifestEntry?.tracer?.is);

export const planRevision = (plans) => sha256(plans.map((p) => `${p.id}\0${textDigest(p.text)}\n`).join(""));

function summaryOwns(forms, summaryRel) {
  const form = forms.find((f) => f.maps_to === "<path>") ?? { prefix: "Path:" };
  return `${form.prefix}${summaryRel}`;
}

// noTracerSplit: gap handoffs keep a wave whole (GSDF-30: gap closure is one execution wave).
export async function handoff(g, phase, { subset, prefix, noTracerSplit = false }) {
  if (prefix !== undefined && !/^[a-z0-9-]+$/.test(prefix)) throw fail("--prefix takes lower-case letters, digits and dashes");
  const w = waveCheck(g, phase, subset);
  const { problems } = await ownershipProblems(g, w.plans);
  const outline = readOutline(phase);
  // G030: a manifest with a manifestError is not read; the refusal below names the error.
  const manifest = outline.manifestError ? null : outline.manifest;
  const mOf = (id) => manifest?.plans?.find((p) => String(p.id) === id) ?? null;
  const tracerErrors = [];
  for (const p of w.plans) {
    if (!isTracer(p, mOf(p.id))) continue;
    if (p.dependsOn.length) tracerErrors.push(`${p.id}: tracer plan depends on ${p.dependsOn.join(", ")}`);
    if ((mOf(p.id)?.consumes ?? []).length) tracerErrors.push(`${p.id}: tracer plan consumes another plan`);
  }
  const limit = g.cfg.gsd.plan_limits.tasks_per_plan;
  const overLimit = w.plans.filter((p) => p.tasks.length > limit).map((p) => `${p.id}: ${p.tasks.length} tasks > gsd.plan_limits.tasks_per_plan ${limit} (split the plan)`);
  const refused = [...w.errors, ...problems.map((x) => x.message), ...tracerErrors, ...overLimit, ...(outline.manifestError ? [outline.manifestError] : [])];
  if (refused.length) return done({ status: "refused", errors: refused, waves: [] }, 1);
  const mode = g.cfg.gsd.execution_mode;
  const segments = [];
  for (const wave of w.waves) {
    const plans = wave.plans.map((id) => w.plans.find((p) => p.id === id));
    const tracers = plans.filter((p) => isTracer(p, mOf(p.id)));
    if (!noTracerSplit && mode === "per-wave" && tracers.length && tracers.length < plans.length) {
      segments.push({ planWave: wave.wave, plans: tracers, tracer: true });
      segments.push({ planWave: wave.wave, plans: plans.filter((p) => !tracers.includes(p)), tracer: false });
    } else segments.push({ planWave: wave.wave, plans, tracer: tracers.length > 0 });
  }
  const revision = planRevision(readPlans(phase));
  const reqs = loadRequirements(g.codeRoot);
  const role = g.cfg.gsd.roles.executor ?? {};
  const dir = path.join(phase.dir, "handoff");
  const own = /^w(\d+)\.args\.json$/;
  const pre = prefix ? `${prefix}-` : "";
  const out = [];
  segments.forEach((seg, i) => {
    const k = i + 1;
    const waveId = `${prefix ?? `gsd-${phase.padded}`}-w${k}`;
    const tasks = seg.plans.map((p) => {
      const summary = rel(g.codeRoot, summaryPath(phase, p.id));
      return {
        key: `plan-${p.id}`,
        plan: p.id,
        planPath: rel(g.codeRoot, planPath(phase, p.id)),
        planHash: textDigest(p.text).slice(0, 12),
        summary,
        owns: [...p.owns, summaryOwns(g.cfg.adapter.ownership.owns_forms, summary)],
        files_deleted: p.filesDeleted,
        requirements: p.requirements,
        specs: [...new Set([...p.requirements.map((id) => reqs.map.get(id)?.spec).filter(Boolean), ...(Array.isArray(p.fm.specs) ? p.fm.specs.map(String) : [])])],
        verify: p.tasks.flatMap((t) => t.automated.map((o) => {
          const c = classify(o.command, g.cfg.adapter.verify_vocabulary);
          return { task: t.index, kind: c.kind, command: o.command, target: c.argument || null };
        })),
        tracer: isTracer(p, mOf(p.id)),
        role: "executor",
        agent: g.cfg.adapter.agents.executor ?? "gsd-executor",
        model: role.model ?? null,
        effort: role.effort ?? null,
      };
    });
    // G083: a plan's <shared_changes> belong to its execution wave; gsd-execute applies them before that wave's gate.
    const shared = seg.plans.flatMap((p) => p.sharedChanges.map((text) => ({ source: p.id, text, paths: sharedChangePaths(text) })));
    const args = { wave: k, waveId, gsdPhase: phase.padded, planWave: seg.planWave, planRevision: revision, executionMode: mode, tasks, sharedChanges: shared };
    const file = path.join(dir, `${pre}w${k}.args.json`);
    writeJsonAtomic(file, args);
    out.push({ executionWave: k, planWave: seg.planWave, waveId, argsFile: rel(g.codeRoot, file), tasks: seg.plans.map((p) => p.id), tracer: seg.tracer, shared });
  });
  // G075: the new set is complete before the old one goes: surplus wave files of an earlier, longer handoff are removed
  // only now, and the manifest (written last) names the wave count and plan digests gsd-execute checks.
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(pre)) continue;
    const m = own.exec(name.slice(pre.length));
    if (m && Number(m[1]) > out.length) fs.rmSync(path.join(dir, name));
  }
  writeJsonAtomic(path.join(dir, `${pre}manifest.json`), { planRevision: revision, waves: out.length, plans: segments.flatMap((s) => s.plans).map((p) => ({ id: p.id, planHash: textDigest(p.text).slice(0, 12) })) });
  const sharedChanges = out.flatMap((o) => o.shared.map(({ source, text, paths }) => ({ source, text, paths, executionWave: o.executionWave })));
  return done({ planRevision: revision, waves: out.map(({ shared, ...o }) => o), sharedChanges, warnings: w.warnings });
}

// The files a <shared_changes> block changes: the leading `path:` of each of its lines (`lib/main.dart: import x`).
export function sharedChangePaths(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:[-*]\s+)?`?([^\s:`]+\.[A-Za-z0-9]+|[^\s:`]*\/[^\s:`]+)`?\s*:/.exec(line);
    if (m && !/^[a-z]+:\/\//i.test(line.trim())) out.push(m[1].replace(/\\/g, "/").replace(/^\.\//, ""));
  }
  return [...new Set(out)];
}


