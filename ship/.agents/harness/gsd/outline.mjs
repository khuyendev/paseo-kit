// Outline + manifest (GSDC-24, GSDC-25), waves (GSDC-26) and the executor-neutral handoff (GSDC-27).
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../lib/io.mjs";
import { sha256, textDigest } from "../lib/hash.mjs";
import { done, fail, idList, lf, none, readIf, rel } from "./common.mjs";
import { classify, covers, filesUnder, ownsPath, sharedPaths } from "./adapter-hooks.mjs";
import { normPlanId, phaseFile, planIds, planPath, readPlans, summaryPath } from "./planning.mjs";
import { ownershipProblems, waveOverlaps } from "./plan-checks.mjs";
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

export async function outlineCheck(g, phase, { tracer = true, plansPerPhase, wavesPerPhase } = {}) {
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
  if (o.manifestError) errors.push(o.manifestError);
  else {
    const mplans = new Map(o.manifest.plans.map((p) => [String(p.id), p]));
    for (const id of ids) if (!mplans.has(id)) errors.push(`manifest has no entry for ${id}`);
    for (const id of mplans.keys()) if (!byId.has(id)) errors.push(`manifest entry ${id} is not in the outline`);
    const forms = g.cfg.adapter.ownership.owns_forms;
    const ownedOf = new Map();
    const candidates = new Set();
    for (const [id, p] of mplans) {
      const owns = Array.isArray(p.owns) ? p.owns : [];
      if (!owns.length) errors.push(`${id}: empty owns`);
      const paths = [];
      for (const e of owns) {
        const m = ownsPath(e, forms);
        if (m === null) errors.push(`${id}: invalid owns entry ${e}`);
        else {
          paths.push(m);
          candidates.add(m);
          for (const f of filesUnder(g.codeRoot, m)) candidates.add(f);
        }
      }
      ownedOf.set(id, paths);
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
        if (!(producer.produces ?? []).some((s) => s.symbol === c.symbol)) warnings.push(`${id}: consumed symbol ${c.symbol} is not in ${c.plan} produces`);
        crossPlan.push({ consumer: id, producer: String(c.plan), symbol: c.symbol, sameWave: Boolean(row && prow.wave === row.wave) });
      }
    }
    const shared = await sharedPaths(g, [...candidates]);
    for (const [id, paths] of ownedOf) for (const p of paths) if ([...shared].some((s) => s === p || covers(p, s))) errors.push(`${id}: owns ${p} covers a shared path`);
    const asPlans = o.rows.filter((r) => mplans.has(r.id)).map((r) => ({ id: r.id, wave: r.wave, filesModified: [] }));
    for (const pr of waveOverlaps(asPlans, (p) => ownedOf.get(p.id) ?? [])) if (pr.kind === "overlapping-owns") errors.push(pr.message);
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
  const json = { passed: errors.length === 0, errors, warnings, crossPlan, needsWiring: crossPlan.length > 0, waves, rows: o.rows, limits };
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

export async function handoff(g, phase, { subset, prefix }) {
  if (prefix !== undefined && !/^[a-z0-9-]+$/.test(prefix)) throw fail("--prefix takes lower-case letters, digits and dashes");
  const w = waveCheck(g, phase, subset);
  const { problems } = await ownershipProblems(g, w.plans);
  const manifest = readOutline(phase).manifest;
  const mOf = (id) => manifest?.plans?.find((p) => String(p.id) === id) ?? null;
  const tracerErrors = [];
  for (const p of w.plans) {
    if (!isTracer(p, mOf(p.id))) continue;
    if (p.dependsOn.length) tracerErrors.push(`${p.id}: tracer plan depends on ${p.dependsOn.join(", ")}`);
    if ((mOf(p.id)?.consumes ?? []).length) tracerErrors.push(`${p.id}: tracer plan consumes another plan`);
  }
  const refused = [...w.errors, ...problems.map((x) => x.message), ...tracerErrors];
  if (refused.length) return done({ status: "refused", errors: refused, waves: [] }, 1);
  const mode = g.cfg.gsd.execution_mode;
  const segments = [];
  for (const wave of w.waves) {
    const plans = wave.plans.map((id) => w.plans.find((p) => p.id === id));
    const tracers = plans.filter((p) => isTracer(p, mOf(p.id)));
    if (mode === "per-wave" && tracers.length && tracers.length < plans.length) {
      segments.push({ planWave: wave.wave, plans: tracers, tracer: true });
      segments.push({ planWave: wave.wave, plans: plans.filter((p) => !tracers.includes(p)), tracer: false });
    } else segments.push({ planWave: wave.wave, plans, tracer: tracers.length > 0 });
  }
  const revision = planRevision(readPlans(phase));
  const reqs = loadRequirements(g.codeRoot);
  const role = g.cfg.gsd.roles.executor ?? {};
  const dir = path.join(phase.dir, "handoff");
  const own = new RegExp(`^${prefix ? `${prefix}-` : ""}w\d+\.args\.json$`);
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) if (own.test(name)) fs.rmSync(path.join(dir, name));
  const out = [];
  segments.forEach((seg, i) => {
    const k = i + 1;
    const waveId = `${prefix ?? `gsd-${phase.padded}`}-w${k}`;
    const tasks = seg.plans.map((p) => {
      const summary = rel(g.codeRoot, summaryPath(phase, p.id));
      return {
        key: `plan-${p.id}`,
        plan: rel(g.codeRoot, planPath(phase, p.id)),
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
    const args = { wave: k, waveId, gsdPhase: phase.padded, planWave: seg.planWave, planRevision: revision, executionMode: mode, tasks };
    const file = path.join(dir, `${prefix ? `${prefix}-` : ""}w${k}.args.json`);
    writeJsonAtomic(file, args);
    out.push({ executionWave: k, planWave: seg.planWave, waveId, argsFile: rel(g.codeRoot, file), tasks: seg.plans.map((p) => p.id), tracer: seg.tracer });
  });
  const sharedChanges = w.plans.flatMap((p) => p.sharedChanges.map((text) => ({ source: p.id, text })));
  return done({ planRevision: revision, waves: out, sharedChanges, warnings: w.warnings });
}


