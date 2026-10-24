// Planning verbs of the default gsd-plan composition (THIN.md stage 2, kit feedback 87). gsd-plan.js keeps the step order, the
// agent calls, the stops and their answers; what is deterministic lives here, as pure verbs (JSON in, one JSON answer out, no
// record written; plan-progress.json stays with flow-plan-state.mjs):
//   plan-args          the run's arguments checked (GSDF-15) and normalised, the settings each revision key hashes, the skeleton
//                      lane inputs, the agent schemas and the planner markers
//   plan-prompt <kind> an agent prompt of the composition, from the kit templates `.agents/workflows/prompts/plan-*.md`
//   plan-skeleton <op> the skeleton gate's issue book: the issues the lanes raised and their fates, the passes, the report
//   plan-probes        the checker's deterministic probes as issues (countProbes, the Files/plan lines)
//   plan-linked        the plans a plan edit can affect (incremental recheck, kit feedback 76)
//   plan-realloc-diff  what an outline reallocation changed (kit feedback 69)
//   plan-contract-route the contract gate's issues per plan and its stop rule, and which revision conflicts still stand (100)
//   plan-contract-drift a symbol an outline revision reshaped in the prose but not in the manifest (98)
//   plan-replan-keep   what the owner's answer to a conflict about some plans keeps on the rerun (101 F3)
//   plan-streams-end, plan-checker-reply, plan-dependents: the streams flow's end, a checker reply's issues, the dependent plans (O65, O67)
import fs from "node:fs";
import path from "node:path";
import { read } from "./flow-files.mjs";
import { fillTemplate, templateFile, templateText } from "./flow-prompt.mjs";
import { readText } from "../../harness/lib/io.mjs";
import { contractDrift, fixPlans } from "../../harness/gsd/contracts.mjs";
import { decisionLines, decisionsOf } from "../../harness/lib/owner-answers.mjs";
import { kitHelpers } from "../../harness/workflow/script.mjs";

const { PH, policyBlock, digestLine } = kitHelpers({ shell: null, agent: null });
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const asArray = (v) => (Array.isArray(v) ? v : []);
const isInt13 = (v) => Number.isInteger(v) && v >= 1 && v <= 3;
// Kit feedback 89 F3: words of a promise in a forceProceed reason (a follow-up the reason says will happen).
export const FORCE_PROMISE = /\b(?:will|shall|going to|later|follow[- ]?ups?|todo|remember to|next run|before (?:execut(?:e|ion|ing)|the executors?))\b/i;
const cut300 = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 300);
const failedText = (what, reason) => `${what}${reason ? `: ${reason}` : " returned nothing"}`;

// ---- agent schemas and planner markers (contracts of the planner, checker, lane and architect agents) ----
export const OWNER_MARKERS = ["REVISION_CONFLICT", "PHASE SPLIT RECOMMENDED", "SOURCE AUDIT", "CHECKPOINT REACHED", "PLANNING INCONCLUSIVE"];
export const KNOWN_MARKERS = [...OWNER_MARKERS, "OUTLINE COMPLETE", "PLANNING COMPLETE", "REVISION COMPLETE", "WIRING COMPLETE", "CONTRACT_CHANGE"];
const PLANNER_SCHEMA = {
  type: "object",
  properties: { marker: { type: "string" }, summary: { type: "string" }, question: { type: "string" }, plans: { type: "array", items: { type: "string" }, description: "with an owner marker: the proposal, one string per proposed split group (PHASE SPLIT RECOMMENDED) or per audit option (SOURCE AUDIT)" }, conflict: { type: "object" }, changes: { type: "array" }, contract_changes: { type: "array", items: { type: "object", properties: { plan: { type: "string" }, symbol: { type: "string" }, old: { type: "string" }, new: { type: "string" }, reason: { type: "string" } }, required: ["symbol", "old", "new", "reason"] }, description: "CONTRACT_CHANGE: a produced signature that has to change, one entry per symbol" }, plan_changes: { type: "array", items: { type: "object", properties: { plan: { type: "string" }, change: { type: "string" } }, required: ["plan", "change"] }, description: "a change another plan of this phase needs because of your work, which you may not edit (one entry per plan, its id NN-MM): the flow has that plan planned again with this change; never leave such a follow-up only in the summary" } },
  required: ["marker"],
};
const ISSUE = { type: "object", properties: { plan: { type: ["string", "null"] }, dimension: { type: "string" }, severity: { type: "string" }, required_property: { type: "string" }, description: { type: "string" }, evidence: { type: "string" }, fix_hint: { type: "string" }, target: { type: "string" } }, required: ["severity", "required_property", "description"] };
const ISSUES_SCHEMA = { type: "object", properties: { issues: { type: "array", items: ISSUE } }, required: ["issues"] };
const RESOLUTION_SCHEMA = { type: "object", properties: { resolved: { type: "array", items: { type: "object", properties: { id: { type: "string" }, evidence: { type: "string" } }, required: ["id"] } } }, required: ["resolved"] };
const CHECKER_SCHEMA = { type: "object", properties: { issues: { type: "array", items: ISSUE }, resolved: RESOLUTION_SCHEMA.properties.resolved }, required: ["issues"] };
// Kit feedback 69: with gsd.checker_reallocate the checker names, per issue, whether the fix is a revision or a new allocation.
const OUTCOME_ISSUE = { ...ISSUE, properties: { ...ISSUE.properties, outcome: { type: "string", enum: ["revise", "reallocate"] } } };
const CHECKER_SCHEMA_REALLOC = { ...CHECKER_SCHEMA, properties: { ...CHECKER_SCHEMA.properties, issues: { type: "array", items: OUTCOME_ISSUE } } };
const ARCHITECT_SCHEMA = { type: "object", properties: { status: { type: "string", enum: ["complete", "conflict"] }, sharedChanges: { type: "array" }, outlineChanges: { type: "array" }, conflicts: { type: "array" } }, required: ["status"] };
export const SCHEMAS = Object.freeze({ planner: PLANNER_SCHEMA, issues: ISSUES_SCHEMA, resolution: RESOLUTION_SCHEMA, checker: CHECKER_SCHEMA, checkerRealloc: CHECKER_SCHEMA_REALLOC, architect: ARCHITECT_SCHEMA });

// ---- plan-args (GSDF-15): every check runs before the first agent, in this order; the first problem is the answer ----
// A skeleton lane's lens text: a kit lens names its file; an adapter lens of stage skeleton carries its text (G029: a lens
// without a stage is a code lens). null: the lens is neither.
function lensText(lens, kitLenses, adapter) {
  if (kitLenses.includes(lens)) return `Lens: ${lens}. Follow the lens text in .agents/workflows/lenses/${lens}.md.`;
  const custom = (adapter?.review_lenses ?? []).find((l) => l.name === lens && (l.stage ?? "code") === "skeleton");
  return custom ? `Lens: ${lens}.\n${custom.text}` : null;
}

// GSDF-18: per-run overrides pass as model/effort (the engine records the roles the calls resolved to); G029: an unset lane field
// (undefined) leaves the per-run override in place instead of erasing it.
function roleOpts(overrides, role, extra = {}) {
  const o = { ...(overrides[role] ?? {}), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) };
  const out = { role };
  if (o.model) out.model = o.model;
  if (o.effort) out.effort = o.effort;
  return out;
}
const ROLES = ["planner", "outline", "checker", "architect", "skeleton_lane"];

// `policy`: the composition policies the script resolved (kit feedback 87, RF: a gsd.* policy key is read by the script only, each
// overridden by its argument); `gsd`: the kit settings (plan_limits, roles, tracer_extra_files, files_per_plan, contract_check).
export function planArgs(root, { args = {}, policy = {}, gsd: g = {}, adapter = {}, kitLenses = [] } = {}) {
  const a = isObj(args) ? args : {};
  const failed = (reason) => ({ status: "failed", reason, code: 1 });
  const { mode, tracer, reversibilityGates, maxSkeletonPasses, maxCheckIterations, skeletonLanes: lanesArg, wiring: wiringMode, planReview, planFlow } = policy;
  // Kit feedback 69, 76: reallocation rounds the checker may send plans back to the outline (staged flow, plan mode only), and the recheck scope.
  const reallocRounds = planFlow === "staged" && mode === "plan" ? policy.checkerReallocate : 0;
  const recheckMode = mode === "plan" ? policy.checkerRecheck : "full";
  const roleOverrides = a.roles ?? {};
  if (!["plan", "gaps"].includes(mode)) return failed(`mode must be plan or gaps, not ${mode}`);
  if (!isInt13(maxSkeletonPasses)) return failed(`maxSkeletonPasses must be an integer 1..3, not ${maxSkeletonPasses}`);
  if (!isInt13(maxCheckIterations)) return failed(`maxCheckIterations must be an integer 1..3, not ${maxCheckIterations}`);
  if (!Array.isArray(lanesArg) || !lanesArg.length || lanesArg.some((l) => typeof l?.lens !== "string" || !l.lens.trim())) return failed("skeletonLanes needs at least one lane with a non-empty lens");
  if (!["auto", "always", "never"].includes(wiringMode)) return failed(`wiring must be auto, always or never, not ${wiringMode}`);
  if (!["staged", "streams"].includes(planFlow)) return failed(`planFlow must be staged or streams, not ${planFlow}`);
  if (a.forceProceed !== undefined && !String(a.forceProceed?.reason ?? "").trim()) return failed("forceProceed needs a non-empty reason");
  // Kit feedback 89 F3: the accepted issues are records gsd-execute stops on until the owner answers them; a reason that promises
  // a follow-up (which nothing would track) is refused.
  const promise = a.forceProceed !== undefined ? FORCE_PROMISE.exec(String(a.forceProceed.reason)) : null;
  if (promise) return failed(`forceProceed reason promises a follow-up ("${promise[0]}"); the accepted issues are recorded (ph gsd accepted list) and gsd-execute stops before their plans until the owner confirms or resolves each one, so the reason says only why they are accepted now`);
  // Kit feedback 71: forceProceed.issues names the checker issues the owner accepts; without it every issue still stuck is accepted.
  const forcedIssues = a.forceProceed?.issues ?? null;
  if (forcedIssues !== null && (!Array.isArray(forcedIssues) || !forcedIssues.length || forcedIssues.some((i) => !i || typeof i !== "object" || !(i.plan === null || (typeof i.plan === "string" && i.plan.trim())) || typeof i.dimension !== "string" || !i.dimension.trim()))) return failed("forceProceed.issues needs a non-empty list of {plan (a plan id, null for a phase-level issue), dimension}");
  if (a.reviewGuidance !== undefined && (typeof a.reviewGuidance !== "string" || !a.reviewGuidance.trim())) return failed("reviewGuidance needs non-empty text");
  // Kit feedback 101 F3: the answer to a planner's conflict about these plans (the stop's args), for the inputs record it names.
  const rp = a.replanPlans;
  if (rp !== undefined && (!isObj(rp) || !Array.isArray(rp.plans) || !rp.plans.length || rp.plans.some((id) => typeof id !== "string" || !/^\d+(\.\d+)?-\d+$/.test(id)) || typeof rp.inputs !== "string" || !rp.inputs)) return failed("replanPlans needs {plans: [plan ids NN-MM], inputs: the inputs digest the stop named}");
  if (rp !== undefined && a.replan) return failed("replanPlans keeps the outline and the other plans; it cannot go with replan");
  if (a.skipResearch && typeof a.researchSkipReason !== "string") return { status: "needs-owner", stage: "Research", reason: "skipResearch needs a researchSkipReason", code: 1 };
  const lanes = lanesArg.map((l, i) => ({ id: `L${i + 1}`, lens: l.lens, model: l.model, effort: l.effort, text: lensText(l.lens, kitLenses, adapter), opts: roleOpts(roleOverrides, "skeleton_lane", { model: l.model, effort: l.effort }) }));
  const unknownLens = lanes.find((l) => !l.text);
  if (unknownLens) return failed(`skeleton lane lens '${unknownLens.lens}' is neither a skeleton kit lens (${kitLenses.join(", ")}) nor an adapter.review_lenses entry of stage skeleton`);
  // G017: the effective settings each gated judgment reads, hashed into its revision key (`--settings`): a changed lane, role or
  // limit reruns the judgments it decides; each key takes only the settings its own judgments read. kit-feedback 37: the checked
  // key takes tracer_extra_files only when set, so earlier records stay valid.
  const roleOf = (name) => ({ ...(g.roles?.[name] ?? {}), ...(roleOverrides[name] ?? {}) });
  const planning = { tracer, reversibilityGates, granularity: policy.granularity, plan_limits: g.plan_limits, stack_skill: adapter.stack_skill ?? null };
  const tracerExtraFiles = g.tracer_extra_files;
  const settings = {
    freeze: { lanes: lanes.map((l) => ({ lens: l.lens, text: l.text, model: l.model ?? null, effort: l.effort ?? null })), skeleton_lane: roleOf("skeleton_lane"), tracer, maxSkeletonPasses },
    plan: { ...planning, planner: roleOf("planner") },
    checked: { ...planning, checker: roleOf("checker"), maxCheckIterations, ...(tracerExtraFiles ? { tracerExtraFiles } : {}), ...(g.files_per_plan ? { filesPerPlan: g.files_per_plan } : {}), ...(reallocRounds ? { reallocRounds } : {}) },
  };
  // G009: the lanes, their lens texts and the role settings are skeleton-review inputs (SKELETON-LANES.json, hashed by the skeleton key).
  const laneInputs = { role: { ...g.roles?.skeleton_lane, ...roleOverrides.skeleton_lane }, lanes: lanes.map((l) => ({ id: l.id, lens: l.lens, model: l.model ?? null, effort: l.effort ?? null, text: l.text, file: kitLenses.includes(l.lens) ? read(root, `.agents/workflows/lenses/${l.lens}.md`).text ?? null : null })) };
  return {
    status: "ok", mode, tracer, reversibilityGates, maxSkeletonPasses, maxCheckIterations, wiringMode, planReview, planFlow, reallocRounds, recheckMode,
    roleOverrides, roles: Object.fromEntries(ROLES.map((r) => [r, roleOpts(roleOverrides, r)])), forcedIssues, tracerExtraFiles, contractsOn: g.contract_check !== false, lanes, settings, laneInputs, skeleton: skeletonBook(lanes), schemas: SCHEMAS, ownerMarkers: OWNER_MARKERS, knownMarkers: KNOWN_MARKERS,
  };
}

// ---- plan-prompt <kind> ----
// A plan template is rendered like `prompt <name>`, plus one rule for its optional parts: a paragraph whose variables are all empty
// strings is left out (never the whole template), else a line whose variables are all empty strings is left out.
const VAR = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const allEmpty = (text, vars) => {
  const names = [...text.matchAll(VAR)].map((m) => m[1]);
  return names.length > 0 && names.every((n) => vars[n] === "");
};
export function dropEmpty(text, vars) {
  const paragraphs = text.split("\n\n");
  return (paragraphs.length > 1 ? paragraphs.filter((p) => !allEmpty(p, vars)) : paragraphs).map((p) => p.split("\n").filter((l) => !allEmpty(l, vars)).join("\n")).join("\n\n");
}
export function renderPlanTemplate(root, name, vars) {
  const { rel, file } = templateFile(root, name);
  if (!fs.existsSync(file)) throw new Error(`prompt template ${rel} not found`);
  try {
    return fillTemplate(dropEmpty(templateText(readText(file)), vars), vars).text;
  } catch (e) {
    throw new Error(`prompt ${name}: ${e.message}`);
  }
}

const json = (v) => JSON.stringify(v);
const bullets = (list) => list.map((e) => `- ${typeof e === "string" ? e : JSON.stringify(e)}`).join("\n");
// The paths of a phase: <phaseDir>/<nn>-<name>.
function phasePaths(ctx) {
  const P = (name) => `${ctx.phaseDir}/${ctx.nn}-${name}`;
  return { P, OUTLINE: P("PLAN-OUTLINE.md"), MANIFEST: P("PLAN-OUTLINE.manifest.json"), WIRING: P("WIRING.md"), planPath: (id) => `${ctx.phaseDir}/${id}-PLAN.md` };
}
// Kit feedback 99 F1: the owner's decisions of the phase (`ph gsd decide`, owner-answers.json), one line each; empty without any.
const decisionsText = (root, ctx) => decisionLines(decisionsOf(path.join(root, ctx.phaseDir)));
function planningContext(root, ctx, mode) {
  const { P } = phasePaths(ctx);
  const limits = ctx.planLimits ?? {};
  return renderPlanTemplate(root, "plan-context", {
    phase: `${ctx.N}${ctx.phaseName ? ` (${ctx.phaseName})` : ""}`, phaseDir: ctx.phaseDir, mode, contextFile: P("CONTEXT.md"), decisions: decisionsText(root, ctx),
    research: ctx.approvedResearch ? `${ctx.approvedResearch} (approved research)` : "research: NONE approved",
    requirements: ctx.reqIds?.length ? ctx.reqIds.join(", ") : "none declared", instructions: (ctx.instructions ?? []).join(", ") || "none", stackSkill: ctx.stackSkill ?? "none",
    tracer: String(ctx.tracer), reversibilityGates: String(ctx.reversibilityGates), granularity: String(ctx.granularity),
    tasksPerPlan: String(limits.tasks_per_plan), plansPerPhase: String(limits.plans_per_phase), wavesPerPhase: String(limits.waves_per_phase),
    validationSkipped: ctx.validation?.skipped ?? "", validationPath: ctx.validation?.path ?? "",
  });
}
// Kit feedback 67 F2: a reviser gets the manifest entry of each plan it edits and, per produced symbol, the plans that consume it.
function contractBlock(root, shows) {
  const parts = [];
  for (const { id, show: s } of shows ?? []) {
    if (!s?.plan || !(s.produces?.some((p) => p.structured) || s.consumes?.some((c) => c.entry))) continue;
    const consumers = Object.fromEntries(Object.entries(s.consumers ?? {}).filter(([, list]) => list.length));
    parts.push(`${id} produces (manifest): ${json(s.produces.filter((p) => p.structured).map(({ symbol, kind, file, signature }) => ({ symbol, kind, file, signature })))}`, `${id} consumers per produced symbol: ${json(consumers)}`, `${id} consumes (producer manifest entries to quote): ${json(s.consumes.filter((c) => c.entry).map((c) => ({ plan: c.plan, ...c.entry })))}`);
  }
  return parts.length ? renderPlanTemplate(root, "plan-contract-context", { parts: parts.join("\n") }) : "";
}
const revisionContext = (root, plans, issues, shows) => renderPlanTemplate(root, "plan-revision", { plans: plans.join(", ") || "none", issues: json(issues), contract: shows ? contractBlock(root, shows) : "" });
const PLANNER_TAIL = (root, ctx, d) => ({ policy: policyBlock(ctx.approvedResearch ?? null), returnNote: renderPlanTemplate(root, "plan-return", {}), digest: digestLine(d.key, d.digest) });
const issueView = (list, keys) => list.map((i) => Object.fromEntries(keys.map((k) => [k, i[k]])));

const KINDS = {
  outline: (root, ctx, d, p) => renderPlanTemplate(root, "plan-outline", { context: planningContext(root, ctx, "outline"), specless: renderPlanTemplate(root, "plan-specless", {}), outline: p.OUTLINE, manifest: p.MANIFEST, contracts: ctx.contractsOn ? renderPlanTemplate(root, "plan-outline-contracts", {}) : "", ph: PH, checkArgs: d.checkArgs.join(" "), ...PLANNER_TAIL(root, ctx, { key: "inputs", digest: d.digest }) }),
  "outline-fix": (root, ctx, d, p) => renderPlanTemplate(root, "plan-outline-fix", { outline: p.OUTLINE, manifest: p.MANIFEST, errors: `\n${bullets(d.errors)}`, ...PLANNER_TAIL(root, ctx, { key: "inputs", digest: d.digest }) }),
  // A revision of plans (or of the outline): the planning context in revision mode and the issues to answer.
  revise: (root, ctx, d) => renderPlanTemplate(root, "plan-revise", { context: planningContext(root, ctx, "revision"), revision: revisionContext(root, d.plans, d.issues, d.shows), ...PLANNER_TAIL(root, ctx, d) }),
  write: (root, ctx, d, p) => {
    const quotes = (d.wiringText ?? "").split(/\r?\n/).filter((l) => l.includes(d.id)).slice(0, 40);
    const wiring = d.wiringText ? renderPlanTemplate(root, "plan-write-wiring", { id: d.id, wiring: p.WIRING, quotes: quotes.map((l) => `> ${l}`).join("\n") || "> (none name this plan)" }) : "No WIRING contract for this phase.";
    // Kit feedback 67 F1, 76: the planner writes each produced signature as the manifest has it and quotes each consumed one.
    const s = d.contract;
    const mine = (s?.show?.produces ?? []).filter((x) => x.structured).map(({ symbol, kind, file, signature }) => ({ symbol, kind, file, signature }));
    const used = (s?.show?.consumes ?? []).filter((c) => c.entry).map((c) => ({ plan: c.plan, ...c.entry }));
    const contract = s ? renderPlanTemplate(root, "plan-write-contract", { produces: mine.length ? json(mine) : "", consumes: used.length ? json(used) : "" }) : "";
    return renderPlanTemplate(root, "plan-write", { context: planningContext(root, ctx, "standard"), specless: renderPlanTemplate(root, "plan-specless", {}), plan: p.planPath(d.id), id: d.id, manifest: p.MANIFEST, entry: json(d.entry), owns: json(d.entry?.owns ?? []), wiring, carried: bullets(d.carried ?? []), contract, ...PLANNER_TAIL(root, ctx, { key: "freeze", digest: d.digest }) });
  },
  fix: (root, ctx, d, p) => renderPlanTemplate(root, "plan-fix", { plan: p.planPath(d.id), errors: `\n${bullets(d.errors)}`, ...PLANNER_TAIL(root, ctx, { key: "freeze", digest: d.digest }) }),
  realloc: (root, ctx, d, p) => renderPlanTemplate(root, "plan-realloc", {
    context: planningContext(root, ctx, "revision"), revision: revisionContext(root, [p.OUTLINE, p.MANIFEST], d.sent.map(({ plan, probe, dimension, description }) => ({ plan, dimension: dimension || probe || "", severity: "blocker", description }))),
    round: String(d.round), named: d.named.join(", "), whose: d.named.length > 1 ? "their" : "its", lines: d.lines ? ` (plan size lines: warning at ${d.lines.warning}+, blocker at ${d.lines.blocker}+ files)` : "",
    outline: p.OUTLINE, manifest: p.MANIFEST, plansPerPhase: String(ctx.planLimits?.plans_per_phase), wavesPerPhase: String(ctx.planLimits?.waves_per_phase), ph: PH, checkArgs: d.checkArgs.join(" "),
    ...PLANNER_TAIL(root, ctx, { key: "inputs", digest: d.digest }),
  }),
  gaps: (root, ctx, d, p) => renderPlanTemplate(root, "plan-gaps", {
    context: planningContext(root, ctx, "gap_closure"), report: p.P("VERIFICATION.md"), gaps: json(d.gaps ?? []), phaseDir: ctx.phaseDir, nn: ctx.nn, first: String(d.nextNo).padStart(2, "0"),
    kept: (d.kept ?? []).map(p.planPath).join(", "), ...PLANNER_TAIL(root, ctx, { key: "verification", digest: d.digest }),
  }),
  architect: (root, ctx, d, p) => renderPlanTemplate(root, "plan-architect", { context: planningContext(root, ctx, "wiring"), wiring: p.WIRING, outline: p.OUTLINE, manifest: p.MANIFEST, why: d.why, policy: policyBlock(ctx.approvedResearch ?? null), digest: digestLine("inputs", d.digest) }),
  "skeleton-lane": (root, ctx, d) => renderPlanTemplate(root, "plan-skeleton-lane", {
    lens: d.lens, phase: String(ctx.N), goal: ctx.goal ? ` (goal: ${ctx.goal})` : "", files: d.files.join(", "), requirements: (ctx.reqIds ?? []).join(", ") || "none", tracer: String(ctx.tracer),
    warnings: json(d.warnings ?? []), edges: json(d.edges ?? []), focusNamed: d.focus ? d.focus.named.join(", ") : "", focusChanged: d.focus ? d.focus.changed.join(", ") : "",
    // Kit feedback 99 F1, 101 F2: the owner's decisions, and the existing test files the verify commands run with their owner plans.
    decisions: decisionsText(root, ctx), inherited: d.tests?.length ? json(d.tests) : "",
    policy: policyBlock(ctx.approvedResearch ?? null), digest: digestLine("freeze", d.digest),
  }),
  "skeleton-resolve": (root, ctx, d) => renderPlanTemplate(root, "plan-skeleton-resolve", { lens: d.lens, files: d.files.join(", "), issues: json(issueView(d.open, ["id", "plan", "required_property", "description", "fix_hint"])), policy: policyBlock(ctx.approvedResearch ?? null), digest: digestLine("freeze", d.digest) }),
  checker: (root, ctx, d, p) => {
    const f = d.filesPerPlan;
    const t = f && d.tracerExtraFiles;
    return renderPlanTemplate(root, "plan-checker", {
      phase: String(ctx.N), plans: d.live.map(p.planPath).join(", "), context: planningContext(root, ctx, d.gapScoped ? "gap_closure" : "standard"),
      filesWarning: f ? String(f.warning) : "", filesBlocker: f ? String(f.blocker) : "", tracerWarning: t ? String(f.warning + d.tracerExtraFiles) : "", tracerBlocker: t ? String(f.blocker + d.tracerExtraFiles) : "",
      sendBackFile: d.sendBack ? d.probeFile : "", probeFile: d.probeFile, carried: bullets(d.carried ?? []),
      earlier: d.earlier?.length ? json(issueView(d.earlier, ["id", "plan", "dimension", "required_property", "description", "fix_hint"])) : "",
      policy: policyBlock(ctx.approvedResearch ?? null), freezeDigest: digestLine("freeze", d.freeze), checkedDigest: digestLine("checked", d.checked),
    });
  },
  depcheck: (root, ctx, d, p) => renderPlanTemplate(root, "plan-depcheck", { plan: p.planPath(d.id), providers: d.providers.map((x) => x.path).join(", "), interfaces: json(d.providers), policy: policyBlock(ctx.approvedResearch ?? null), freezeDigest: digestLine("freeze", d.freeze), planDigest: digestLine(`plan:${d.id}`, d.planHash) }),
  "join-resolve": (root, ctx, d, p) => renderPlanTemplate(root, "plan-join-resolve", { plans: d.scope.map(p.planPath).join(", "), blockers: json(issueView(d.asked, ["id", "plan", "dimension", "required_property", "description", "fix_hint"])), policy: policyBlock(ctx.approvedResearch ?? null), freezeDigest: digestLine("freeze", d.freeze), keyDigest: digestLine(d.key, d.hash) }),
};
export const PROMPT_KINDS = Object.freeze(Object.keys(KINDS));

/** Flow verb `plan-prompt <kind>` {ctx, ...data} -> {kind, text}. */
export function planPrompt(root, kind, input = {}) {
  const build = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!build) throw new Error(`unknown plan prompt '${kind}'; one of ${PROMPT_KINDS.join(", ")}`);
  const { ctx, ...data } = input;
  if (!isObj(ctx) || typeof ctx.phaseDir !== "string" || typeof ctx.nn !== "string") throw new Error("plan-prompt needs ctx {N, nn, phaseDir, ...}");
  return { kind, text: build(root, ctx, data, phasePaths(ctx)) };
}

// ---- plan-skeleton <op>: the skeleton gate's issue book (GSDF-21..23) ----
// sk: {lanes [{id, lens, text, model, effort, resolved}], issues [{id, lane, plan, ..., state, resolution}], seq, passCounts, failures
// [[lane, reason]], laneIssueIds}. Each op answers the new sk and the info notes it moved to the advisories.
const sevClass = (s) => (s === "info" ? "info" : s === "warning" ? "warning" : "blocker"); // unknown severity = blocker
const integrationLane = (sk) => (sk.lanes.find((l) => l.lens === "integration") ?? sk.lanes[0]).id;
const openOf = (sk) => sk.issues.filter((i) => i.state === "open");
const blockersOf = (sk) => openOf(sk).filter((i) => i.severity === "blocker");
function addIssue(sk, laneId, raw, advisories) {
  const sev = sevClass(String(raw.severity ?? "").toLowerCase());
  if (sev === "info") { advisories.push({ lane: laneId, plan: raw.plan ?? null, description: raw.description }); return null; }
  const id = `${laneId}-${++sk.seq}`;
  sk.issues.push({ id, lane: laneId, plan: raw.plan ?? null, dimension: raw.dimension ?? "", required_property: raw.required_property ?? "", severity: sev, target: raw.target ?? "outline", description: raw.description ?? "", evidence: raw.evidence ?? "", fix_hint: raw.fix_hint ?? "", state: "open", resolution: "" });
  return id;
}
function renderReview(sk, gate, advisories, nn) {
  const rows = (list, cols) => list.map((i) => `| ${cols.map((c) => cut300(i[c])).join(" | ")} |`);
  const open = openOf(sk);
  const resolved = sk.issues.filter((i) => i.state === "resolved");
  const failures = new Map(sk.failures);
  return [
    `# Phase ${nn} outline review`, "", `Status: ${gate.status}${gate.reason ? ` (${gate.reason})` : ""}`, "",
    "## Lanes", "", "| lane | lens | model | effort | result |", "| --- | --- | --- | --- | --- |",
    ...sk.lanes.map((l) => `| ${l.id} | ${l.lens} | ${l.resolved?.model ?? "unresolved"} | ${l.resolved?.effort ?? "agent default"} | ${failures.has(l.id) ? `failed: ${cut300(failures.get(l.id) ?? "no reply")}` : "ok"} |`), "",
    "## Passes", "", ...sk.passCounts.map((c, i) => `- pass ${i + 1}: ${c} open`), "",
    "## Open", "", "| id | lane | plan | severity | target | required_property | description | evidence |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows(open, ["id", "lane", "plan", "severity", "target", "required_property", "description", "evidence"]), "",
    "## Resolved", "", "| id | lane | description | evidence |", "| --- | --- | --- | --- |",
    ...rows(resolved, ["id", "lane", "description", "resolution"]), "",
    "## Advisories", "", ...(advisories.length ? advisories.map((x) => `- ${x.lane}${x.plan ? ` ${x.plan}` : ""}: ${cut300(x.description)}`) : ["- none"]), "",
    "## Report", "", "```json", JSON.stringify({ status: gate.status, passes: sk.passCounts, open: open.map((i) => i.id), resolved: resolved.map((i) => i.id) }), "```", "",
  ].join("\n");
}
// Kit feedback 64: a skeleton issue is applied once its lane's resolution check confirmed the revision; an open blocker of a
// REVISION_CONFLICT stop is a conflict; a warning of a passed gate and every info note are carried. Confirmed: applied blockers.
function skeletonFindings(sk, gate, advisories) {
  const lensOf = (laneId) => sk.lanes.find((l) => l.id === laneId)?.lens ?? null;
  const conflict = String(gate.marker ?? "").includes("REVISION_CONFLICT");
  const raised = sk.issues.map((i) => {
    const blocking = i.severity === "blocker";
    const fate = i.state === "resolved" ? "applied" : blocking ? (conflict ? "conflict" : "open") : gate.status === "passed" ? "carried" : "open";
    return { id: i.id, plan: i.plan, class: i.dimension || lensOf(i.lane), lane: i.lane, lens: lensOf(i.lane), source: sk.laneIssueIds.includes(i.id) ? "lane" : "flow", severity: i.severity, blocking, confirmed: blocking && fate === "applied", fate, description: cut300(i.description) };
  });
  const notes = advisories.filter((x) => sk.lanes.some((l) => l.id === x.lane)).map((x, k) => ({ id: `${x.lane}-info-${k + 1}`, plan: x.plan ?? null, class: lensOf(x.lane), lane: x.lane, lens: lensOf(x.lane), source: "lane", severity: "info", blocking: false, confirmed: false, fate: "carried", description: cut300(x.description) }));
  return [...raised, ...notes];
}
const SKELETON_OPS = {
  // The first pass: each lane's reply (null: the lane failed) and the architect's outline changes. A failed lane keeps the findings
  // of the lanes that answered; `failed` names the failed lanes.
  first: (sk, { replies = [], outlineChanges = [] }, adv) => {
    for (const [i, r] of replies.entries()) {
      const lane = sk.lanes[i];
      lane.resolved = { model: r?.model ?? null, effort: r?.effort ?? null };
      if (!r || r.result === null || r.result === undefined) sk.failures.push([lane.id, r?.reason ?? null]);
      else for (const raw of r.result.issues ?? []) { const id = addIssue(sk, lane.id, raw, adv); if (id) sk.laneIssueIds.push(id); }
    }
    for (const c of outlineChanges) addIssue(sk, integrationLane(sk), c, adv);
    if (sk.failures.length) return { failed: sk.lanes.filter((l) => sk.failures.some(([id]) => id === l.id)).map((l) => failedText(`skeleton lane ${l.id} (${l.lens})`, sk.failures.find(([id]) => id === l.id)[1])).join("; ") };
    sk.passCounts.push(openOf(sk).length);
    return { blockers: blockersOf(sk).length };
  },
  // A revision pass routes the open issues: outline issues (and wiring ones without a wiring contract) to the outline writer.
  route: (sk, { wiringInUse }) => {
    const open = openOf(sk);
    return {
      startBlockers: blockersOf(sk).length,
      toOutline: open.filter((i) => i.target === "outline" || i.target === "both" || (i.target === "wiring" && !wiringInUse)),
      toWiring: wiringInUse ? open.filter((i) => i.target === "wiring" || i.target === "both") : [],
    };
  },
  // Issues the flow adds (architect outline changes, new cross-plan edges), on the integration lane.
  add: (sk, { issues = [] }, adv) => { for (const raw of issues) addIssue(sk, integrationLane(sk), raw, adv); return {}; },
  // Each lane's own open issues, for its resolution check.
  pending: (sk) => ({ byLane: Object.fromEntries(sk.lanes.map((l) => [l.id, openOf(sk).filter((i) => i.lane === l.id)])) }),
  // The resolution checks' replies; a check that returned nothing judged none of its issues: a failed call, not a stalled skeleton.
  resolve: (sk, { checks = [] }) => {
    for (const c of checks) for (const res of c?.r?.result?.resolved ?? []) {
      const i = sk.issues.find((x) => x.id === res.id);
      if (i && i.lane === c.lane && i.state === "open") { i.state = "resolved"; i.resolution = res.evidence ?? ""; }
    }
    const un = checks.find((c) => c && (c.r?.result === null || c.r?.result === undefined));
    if (un) {
      const lane = sk.lanes.find((l) => l.id === un.lane);
      return { unjudged: { reason: `skeleton resolution ${lane.id} (${lane.lens})${un.r?.reason ? `: ${un.r.reason}` : " returned nothing"}; open issues ${un.open.map((i) => i.id).join(", ")} not judged`, issues: un.open } };
    }
    sk.passCounts.push(openOf(sk).length);
    return { blockers: blockersOf(sk).length, open: blockersOf(sk) };
  },
  // The end of the passes: the open blockers stop the gate; open warnings are carried into the result.
  end: (sk) => ({ blockers: blockersOf(sk), passes: sk.passCounts.length, warnings: openOf(sk).map((w) => `skeleton ${w.id}${w.plan ? ` (${w.plan})` : ""}: ${w.description}`) }),
  // OUTLINE-REVIEW.md and the review-metrics findings of a finished gate {status, reason, marker}.
  report: (sk, { gate = {}, advisories = [], nn = "" }) => ({ text: renderReview(sk, gate, advisories, nn), findings: skeletonFindings(sk, gate, advisories) }),
};
export const SKELETON_OP_NAMES = Object.freeze(Object.keys(SKELETON_OPS));
export const skeletonBook = (lanes) => ({ lanes: lanes.map(({ id, lens, text, model, effort, opts }) => ({ id, lens, text, model, effort, opts })), issues: [], seq: 0, passCounts: [], failures: [], laneIssueIds: [] });

/** Flow verb `plan-skeleton <op>` {sk, ...} -> {sk, advisories, ...}. */
export function planSkeleton(root, op, input = {}) {
  const fn = Object.hasOwn(SKELETON_OPS, op) ? SKELETON_OPS[op] : null;
  if (!fn) throw new Error(`unknown plan-skeleton op '${op}'; one of ${SKELETON_OP_NAMES.join(", ")}`);
  const { sk: given, ...data } = input;
  if (!isObj(given) || !Array.isArray(given.lanes) || !given.lanes.length || !Array.isArray(given.issues)) throw new Error("plan-skeleton needs sk {lanes, issues, ...}");
  const sk = { seq: 0, passCounts: [], failures: [], laneIssueIds: [], ...structuredClone(given) };
  const advisories = [];
  const out = fn(sk, data, advisories);
  return { sk, advisories, ...out };
}

// ---- plan-probes: the checker's deterministic probes (GSDF-26) ----
const PROBES = [["verify-command-paths", "warning"], ["verify-failure-directions", "warning"], ["owns", "blocker"]];
export const PROBE_NAMES = Object.freeze(PROBES.map(([p]) => p));
// Kit feedback 69: with reallocation the Files/plan lines are judged here, not by the checker agent: a plan at the blocker line is
// a blocker whose only fix is a new allocation (outcome reallocate).
function filesPerPlanProbes(owns, tracerExtraFiles) {
  const lines = owns?.files_per_plan;
  if (!lines) return [];
  const out = [];
  for (const p of owns.plans ?? []) {
    const n = (p.files_modified ?? []).length;
    const more = p.tracer ? tracerExtraFiles : 0;
    if (n >= lines.blocker + more) out.push({ probe: "files-per-plan", plan: p.id, severity: "blocker", outcome: "reallocate", description: `${p.id} lists ${n} files in files_modified, blocker at ${lines.blocker + more}+ (its owned paths need a new allocation in the outline)` });
    else if (n >= lines.warning + more) out.push({ probe: "files-per-plan", plan: p.id, severity: "warning", description: `${p.id} lists ${n} files in files_modified, warning at ${lines.warning + more}+` });
  }
  return out;
}
/** Flow verb `plan-probes` {runs: {<probe>: {code, json}}, filesPerPlan, tracerExtraFiles} -> {found}. */
export function planProbes(root, { runs = {}, filesPerPlan = false, tracerExtraFiles } = {}) {
  const found = [];
  for (const [probe, defaultSev] of PROBES) {
    const r = runs[probe] ?? { code: 69, json: null };
    if (r.code === 69) { found.push({ probe, severity: "warning", description: `${probe} could not look: ${r.json?.reason ?? r.json?.error ?? "exit 69"}` }); continue; }
    const items = ["commands", "probes", "findings", "problems", "errors", "issues"].flatMap((k) => (Array.isArray(r.json?.[k]) ? r.json[k] : []));
    for (const it of items) {
      const sev = String(probe === "owns" ? "blocker" : it.severity ?? defaultSev).toLowerCase();
      if (["none", "ok", "info", ""].includes(sev)) continue;
      const description = typeof it === "string" ? it : it.detail ?? it.message ?? it.description ?? JSON.stringify(it);
      found.push({ probe, plan: it.plan ?? null, severity: sev === "warning" ? "warning" : "blocker", description, ...(it.fix ? { fix: it.fix } : {}) });
    }
  }
  if (filesPerPlan) found.push(...filesPerPlanProbes(runs.owns?.json, tracerExtraFiles));
  return { found };
}

// ---- plan-linked (kit feedback 76): the plans a plan edit can affect ----
// depends_on in both directions, manifest consumes edges in both directions, and plans whose write set (owns, files_modified)
// holds an endpoint of the other's must_haves.key_links. `plans`: {<id>: {mustHaves, owns, written}} for every plan of the scope.
export function planLinked(root, { ids = [], scope = [], index = [], manifest = [], plans = {} } = {}) {
  if (!ids.length) return { linked: [] };
  const linked = new Set();
  for (const p of index) {
    const deps = p.depends_on ?? [];
    if (ids.includes(p.id)) deps.forEach((d) => linked.add(d));
    else if (deps.some((d) => ids.includes(d))) linked.add(p.id);
  }
  for (const m of manifest) {
    const from = (m.consumes ?? []).map((c) => String(c.plan));
    if (ids.includes(String(m.id))) from.forEach((x) => linked.add(x));
    else if (from.some((x) => ids.includes(x))) linked.add(String(m.id));
  }
  const pathOf = (x) => String(x).replace(/^[A-Za-z][\w-]*:(?!\/\/)/, "").split(/[\s#]/)[0].replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const under = (file, entry) => entry !== "" && (file === entry || file.startsWith(`${entry}/`));
  const ends = new Map();
  const sets = new Map();
  for (const id of scope) {
    const p = plans[id] ?? {};
    ends.set(id, (p.mustHaves?.key_links ?? []).flatMap((l) => [l?.from, l?.to]).filter(Boolean).map(pathOf));
    sets.set(id, [...(p.owns ?? []), ...(p.written ?? [])].map(pathOf));
  }
  const reaches = (from, to) => ends.get(from).some((e) => sets.get(to).some((s) => under(e, s)));
  for (const id of ids) for (const other of scope) if (other !== id && (reaches(id, other) || reaches(other, id))) linked.add(other);
  return { linked: scope.filter((id) => linked.has(id) && !ids.includes(id)) };
}

// ---- plan-realloc-diff (kit feedback 69): what an outline reallocation changed ----
// A plan changed when its manifest entry or its outline row changed; a named plan the writer left as it was is `unchanged`, and
// `accept` is the forceProceed issues list that accepts its size.
export function planReallocDiff(root, { before = {}, after = {}, named = [], planIds = [], sent = [] } = {}) {
  const entryOf = (o, id) => JSON.stringify([(o.manifest?.plans ?? []).find((p) => String(p.id) === id) ?? null, (o.rows ?? []).find((r) => r.id === id) ?? null]);
  const idsAfter = (after.rows ?? []).map((row) => row.id);
  const changed = idsAfter.filter((id) => entryOf(before, id) !== entryOf(after, id));
  const unchanged = named.filter((id) => idsAfter.includes(id) && !changed.includes(id));
  const dim = (i) => String(i.dimension || i.probe || "").trim().toLowerCase();
  const accept = [...new Map(sent.filter((i) => unchanged.includes(i.plan)).map((i) => [`${i.plan}\0${dim(i)}`, { plan: i.plan, dimension: dim(i) }])).values()];
  return { idsAfter, changed, removed: planIds.filter((id) => !idsAfter.includes(id)), unchanged, accept };
}

// ---- plan-validation (kit feedback 70): what the validation strategy step means for the run ----
// `strategy` is the answer of the flow verb validation-strategy (null when it did not run: `off` names why the composition turned
// the step off, or no research was approved). The checker is told in the planning context whether Dimension 8 applies
// (`validation.path`) or is skipped, and why.
export function planValidation(root, { off = null, approvedResearch = null, strategy = null } = {}) {
  const skipped = (why, extra = {}) => ({ validation: { skipped: why }, report: null, warnings: [], log: null, commit: null, ...extra });
  if (off) return skipped(off);
  if (!approvedResearch || !strategy) return skipped("no approved research in this run");
  const report = { status: strategy.status, ...(strategy.path ? { path: strategy.path } : {}) };
  if (["no-research", "no-section"].includes(strategy.status)) return skipped("the approved research has no Validation Architecture section", { report, warnings: [`validation: ${approvedResearch} has no Validation Architecture section; no VALIDATION.md was written and Dimension 8 is skipped`] });
  const written = ["written", "refreshed"].includes(strategy.status);
  return {
    validation: { path: String(strategy.path) }, report,
    warnings: strategy.stale ? [`validation: ${strategy.path} was rendered from an older ${approvedResearch}; it is already validated or edited, so it was kept (update it by hand or delete it to render again)`] : [],
    log: written ? `validation strategy ${strategy.status}: ${strategy.path}` : `validation strategy kept: ${strategy.path}`, commit: written ? strategy.path : null,
  };
}

// ---- plan-contract-route (kit feedback 67 F3, 100): the issues of a contract check per plan, and the gate's stop rule ----
// Each error goes to its `fixers` (the plans whose planner can fix it, `ph gsd verify contracts`; fixPlans for an error without the
// field) that are plans of the run, else to the plans it names. `conflicts`: the plans whose reviser returned REVISION_CONFLICT in
// the last round; a conflict stands while this check still routes an issue to its plan, else it is dropped (100 F2).
export function planContractRoute(root, { errors = [], planIds = [], round = 1, prev = null, cap = 1, conflicts = [] } = {}) {
  const byPlan = new Map();
  for (const e of errors) {
    const ours = (list) => list.filter((p) => planIds.includes(p));
    const to = ours(asArray(e.fixers).length ? asArray(e.fixers) : fixPlans(e));
    for (const p of to.length ? to : ours(asArray(e.plans).length ? e.plans : [e.plan])) byPlan.set(p, [...(byPlan.get(p) ?? []), { plan: p, dimension: "contract", severity: "blocker", required_property: `${e.kind}${e.symbol ? ` ${e.symbol}` : ""}`, description: e.message, fix_hint: e.fix_hint, related_plans: asArray(e.plans).filter((x) => x !== p) }]);
  }
  const missing = errors.filter((e) => e.kind === "plan-missing").map((e) => e.plan);
  const over = errors.length > 0 && (round > cap || (prev !== null && errors.length >= prev));
  const stop = missing.length ? `${missing.join(", ")} in the manifest but not planned` : over ? (round > cap ? `${errors.length} contract issues left after ${round - 1} revisions` : `contract issues not falling: ${errors.length}, was ${prev}`) : null;
  return { byPlan: [...byPlan], stop, standing: conflicts.filter((id) => byPlan.has(id)), dropped: conflicts.filter((id) => !byPlan.has(id)) };
}

// ---- plan-contract-drift (kit feedback 98 F1): an outline revision that reshaped a symbol in the prose but not in the manifest ----
/** Flow verb `plan-contract-drift` {before: {outline, manifest}, after: {outline, manifest}} -> {drift, errors, warnings}. */
export const planContractDrift = (root, { before = {}, after = {} } = {}) => contractDrift(before, after);

// ---- plan-replan-keep (kit feedback 101 F3): what the owner's answer to a conflict about some plans keeps ----
// `replanPlans` {plans, inputs}; `keys` {<name>: revisions key argv} for inputs, freeze, skeleton and plan:<id>; `checks`
// {<name>: {code, changed, recorded}} their `revisions check` answers; `files`: the outline, manifest, wiring and research report.
// The answer applies once: the inputs record is still the one the stop named. An input that changed since may be the owner's
// answer (CONTEXT.md, a decision record), never the outline files, the research, a requirement, a role file, the roadmap or the
// settings. Then inputs, freeze and every plan not named are recorded again; the named plans are planned again.
export function planReplanKeep(root, { replanPlans = null, keys = {}, checks = {}, files = [] } = {}) {
  const no = (why) => ({ keep: false, record: [], kept: [], log: `replanPlans not applied: ${why}; the run plans as without it` });
  if (!replanPlans) return no("none given");
  if (checks.inputs?.code === 0) return no("the inputs did not change since the stop");
  if (checks.inputs?.recorded !== replanPlans.inputs) return no(`the inputs record is not the one the stop named (${replanPlans.inputs}): used already, or the outline was written again since`);
  const denied = (label) => files.includes(label) || ["settings", "roadmap"].includes(label) || /^(requirement|harness):/.test(label) || /-PLAN\.md$/.test(label);
  const answerOnly = (c) => c?.code === 1 && Array.isArray(c.changed) && c.changed.length > 0 && !c.changed.some(denied);
  for (const k of ["inputs", "freeze"]) if (!answerOnly(checks[k])) return no(`the ${k} record changed in ${checks[k]?.changed?.join(", ") || "parts it cannot name"}, not only in the owner's answer`);
  if (checks.skeleton?.code !== 0) return no("the skeleton review inputs changed");
  const kept = Object.keys(keys).filter((k) => k.startsWith("plan:") && !replanPlans.plans.includes(k.slice(5)) && answerOnly(checks[k])).map((k) => k.slice(5));
  return { keep: true, record: [keys.inputs, keys.freeze, ...kept.map((id) => keys[`plan:${id}`])], kept, log: `replanPlans: the owner's answer to the conflict of ${replanPlans.plans.join(", ")} changed ${checks.inputs.changed.join(", ")}; the outline, its review and ${kept.length ? kept.join(", ") : "no other plan"} are kept, ${replanPlans.plans.join(", ")} planned again` };
}

// ---- plan-streams-end (O65, O67): the end of the streams flow once every review stream returned ----
// `done`: the reviews of `ids` (the plans whose stream started), in that order. Answers the log lines, the streams report, the first
// review that did not converge (`bad` {status, stop}) and the plan-review notes with their advisories and structure warnings. The
// script adds its live dependents list to the report (the checker join fills it later).
export function planStreamsEnd(root, { planIds = [], ids = [], done = [], planned = [], planReview = false } = {}) {
  const reviewOf = new Map(ids.map((id, i) => [id, done[i]]));
  const logs = [...reviewOf].map(([id, r]) => `plan stream ${id}: review ${r?.status ?? "failed"}${r?.cycles ? ` after ${r.cycles} cycles` : ""}`);
  const flowReport = { planFlow: "streams", streams: planIds.map((id) => ({ plan: id, planned: planned.includes(id), review: reviewOf.get(id) ? reviewOf.get(id).status ?? "failed" : planReview ? "not started" : "off", cycles: reviewOf.get(id)?.cycles ?? 0, counts: reviewOf.get(id)?.counts ?? [] })) };
  const b = ids.map((id) => reviewOf.get(id)).find((r) => r?.status !== "converged");
  const bad = b ? { status: b.status ?? null, stop: { stage: "Plan review", plan: b.plan ?? null, reason: b.reason ?? "plan review did not converge", issues: b.issues ?? [], conflict: b.conflict ?? null, counts: b.counts ?? [] } } : null;
  const notes = bad || !planReview ? [] : ids.flatMap((id) => reviewOf.get(id).issues ?? []);
  return {
    logs, flowReport, bad, notes: notes.map(({ plan, severity, description }) => ({ plan, severity, description })),
    structure: bad || !planReview ? [] : done.flatMap((r) => r.structure ?? []), advisories: notes.map((x) => ({ lane: "plan-review", plan: x.plan ?? null, severity: x.severity, description: x.description })),
  };
}

// ---- plan-checker-reply (GSDF-26): a checker reply's info issues are advisories, the others warnings or blockers ----
export function planCheckerReply(root, { issues = [] } = {}) {
  const sev = (i) => String(i.severity).toLowerCase();
  return {
    advisories: issues.filter((i) => sev(i) === "info").map((i) => ({ lane: "checker", plan: i.plan ?? null, description: i.description })),
    findings: issues.filter((i) => sev(i) !== "info").map((i) => ({ ...i, severity: sev(i) === "warning" ? "warning" : "blocker" })),
  };
}

// ---- plan-dependents (O67): the plans whose depends_on names a plan whose interface changed, with those providers ----
export function planDependents(root, { index = [], changed = [], planIds = [] } = {}) {
  const list = [];
  for (const p of index) {
    const from = (p.depends_on ?? []).filter((d) => changed.includes(d));
    if (from.length && planIds.includes(p.id)) list.push([p.id, from]);
  }
  return { list, log: list.length ? `plan interfaces changed: ${changed.join(", ")}; checking ${list.map(([id]) => id).join(", ")}` : null };
}

export const PLAN_VERBS = Object.freeze(["plan-args", "plan-prompt", "plan-skeleton", "plan-probes", "plan-linked", "plan-realloc-diff", "plan-validation", "plan-contract-route", "plan-contract-drift", "plan-replan-keep", "plan-streams-end", "plan-checker-reply", "plan-dependents"]);
