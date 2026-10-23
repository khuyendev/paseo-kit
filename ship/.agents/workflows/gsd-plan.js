export const meta = {
  name: "gsd-plan",
  description: "GSD phase planning: outline, wiring, skeleton review, per-plan planners, checker loop, coverage and handoff (or one gap-closure wave)",
  phases: [
    { title: "Preconditions" }, { title: "Smoke build" }, { title: "Outline" }, { title: "Wiring" }, { title: "Skeleton review" },
    { title: "Plans" }, { title: "Checker" }, { title: "Plan review" }, { title: "Dependencies" }, { title: "Handoff" }, { title: "Gaps" },
  ],
};

// ---- shared GSD script helpers (scripts cannot import; keep identical across gsd-*.js) ----
const PH = ".agents/harness/ph.mjs";
const FLOW = ".agents/workflows/lib/gsd-flow.mjs";
const PHASE_DIR_RE = /^\.planning\/phases\/\d+(\.\d+)?-[a-z0-9-]+$/;
const lastJson = (text) => { try { return JSON.parse(String(text).trim().split(/\r?\n/).pop()); } catch { return null; } };
// A verb prints its JSON on one last line; shell() keeps only the last 20000 characters by default, which cut the line of
// `outline parse` for a 12-plan phase (23 KB) and made the outline look incomplete. Keep the whole output.
const VERB_TAIL_CHARS = 4000000;
// GSDF-03: the one verb helper; JSON goes on stdin, only validated values reach the argv.
async function run(argv, input) {
  const r = await shell(["node", ...argv], { tailChars: VERB_TAIL_CHARS, ...(input === undefined ? {} : { input: typeof input === "string" ? input : JSON.stringify(input) }) });
  return { code: r.code, json: lastJson(r.stdout), stderr: r.stderr };
}
async function loadCfg() {
  const r = await shell(["node", PH, "config"]);
  if (r.code !== 0) throw new Error(`ph config failed: ${String(r.stderr).split(/\r?\n/)[0]}`);
  return JSON.parse(r.stdout);
}
const gsd = (argv, input) => run([PH, "gsd", ...argv], input);
const flow = (argv, input) => run([FLOW, ...argv], input);
const phaseNumber = (dir) => /phases\/(\d+(?:\.\d+)?)-/.exec(dir)[1];
const digestLine = (key, hash) => `Input digest (${key}): ${hash}`;
const policyBlock = (path) => `<research_input_policy>\n${path ? `Approved research: ${path}. Read and use only this report.` : "Approved research: NONE. Do not read or use any RESEARCH.md on disk."}\n</research_input_policy>`;
const NEVER_RETRY = /quota|credit|billing|auth|permission|usage limit|rate limit|\b429\b|too many requests|RESOURCE_EXHAUSTED/i;
// agent option `detail: true` resolves {result, reason, agentId, worktree, durationS, model, effort};
// the global `runId` is the first run's id, kept by --resume (GSDC-30 attempt keys).
async function call(prompt, opts) {
  const d = await agent(prompt, { ...opts, detail: true });
  return { result: d?.result ?? null, reason: d?.reason ?? null, model: d?.model ?? null, effort: d?.effort ?? null };
}
const fatal = (reason) => Boolean(reason && NEVER_RETRY.test(reason));
const needsOwner = (stage, reason, extra = {}) => ({ status: "needs-owner", stage, reason, ...extra });
// The refusal of a held lease names the holder's workflow and run (kit-feedback 1); `what` says what it holds.
const leaseText = (r, what = "this code root") => `${r?.holderKind ? `a ${r.holderKind} run` : "another run"} holds ${what} (${r?.holder ?? r?.error ?? "unknown run"})`;
async function discussOpen(phaseDir, nn) {
  const ex = (await flow(["exists", `${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`, `${phaseDir}/${nn}-CONTEXT.md`])).json?.exists ?? {};
  if (ex[`${phaseDir}/${nn}-DISCUSS-CHECKPOINT.json`]) return "discussion interrupted (DISCUSS-CHECKPOINT present); finish it with gsd-discuss";
  if (!ex[`${phaseDir}/${nn}-CONTEXT.md`]) return "no CONTEXT.md; run gsd-discuss first";
  return null;
}
async function sha(text) { return (await gsd(["hash"], text ?? "")).json?.hash ?? null; }
async function fileSha(path) { const r = await flow(["read", path]); return r.json?.exists ? sha(r.json.text) : null; }
// ---- end shared helpers ----

// Kit feedback 87 (B3): every needs-owner stop names its answer, the one owner action after which the next run goes on (`verb`,
// with the `args` to set when the answer is an argument); `options` keep the alternatives. A rerun reads the run's args file.
const RERUN = "node .agents/harness/ph.mjs workflow --name gsd-plan --args-file _workspace/args/gsd-plan.json";
const answers = {
  rerun: (what) => ({ verb: "rerun", command: `${what ? `${what}, then ` : ""}${RERUN} (same args)` }),
  context: (what) => ({ verb: "context", command: `record the owner's decision on ${what} in the phase's CONTEXT.md (a locked decision), then ${RERUN} (same args)` }),
  args: (args, what) => ({ verb: "args", args, command: `${what}: set ${JSON.stringify(args)} in the args file, then ${RERUN}` }),
  forceProceed: (issues) => ({ verb: "forceProceed", args: { forceProceed: { reason: "<why the owner accepts them>", issues } }, command: `if the owner accepts these issues, set forceProceed {reason, issues} in the args file, then ${RERUN}` }),
  guidance: () => ({ verb: "reviewGuidance", args: { reviewGuidance: "<the owner's answer to the issues>" }, command: `set reviewGuidance (the owner's answer) in the args file, then ${RERUN}` }),
  fix: (what) => ({ verb: "fix-and-rerun", command: `${what}, then ${RERUN} (same args)` }),
  workflow: (name, what) => ({ verb: "workflow", command: `${what}: run ${name}, then ${RERUN} (same args)` }),
};

const rawCall = call;
call = async (prompt, { judges = {}, ...opts } = {}) => {
  // GSDF-03: bind judgments and repairs to the files and owned paths the call judges (`judges`) and to the adapter settings.
  const identity = await flow(["digest"], judges);
  if (identity.code !== 0 || !identity.json?.hash) throw new Error("agent input digest unavailable");
  const researchPolicy = prompt.includes("<research_input_policy>") ? "" : policyBlock(null);
  prompt = [prompt, researchPolicy, digestLine("stage", identity.json.hash)].filter(Boolean).join("\n\n");
  return rawCall(prompt, opts);
};

const OWNER_MARKERS = ["REVISION_CONFLICT", "PHASE SPLIT RECOMMENDED", "SOURCE AUDIT", "CHECKPOINT REACHED", "PLANNING INCONCLUSIVE"];
const KNOWN_MARKERS = [...OWNER_MARKERS, "OUTLINE COMPLETE", "PLANNING COMPLETE", "REVISION COMPLETE", "WIRING COMPLETE", "CONTRACT_CHANGE"];
// Skeleton kit lenses; correctness (code) and source-grounding (plan_review) are other stages' lenses (G029).
const KIT_LENSES = ["fidelity", "integration"];
const markerOf = (r) => String(typeof r === "string" ? r : r?.marker ?? "");
const ownerMarker = (r) => OWNER_MARKERS.find((m) => markerOf(r).includes(m)) ?? null;
const knownMarker = (r) => KNOWN_MARKERS.some((m) => markerOf(r).includes(m));
const isInt13 = (v) => Number.isInteger(v) && v >= 1 && v <= 3;
const PLANNER_SCHEMA = {
  type: "object",
  properties: { marker: { type: "string" }, summary: { type: "string" }, question: { type: "string" }, plans: { type: "array", items: { type: "string" }, description: "with an owner marker: the proposal, one string per proposed split group (PHASE SPLIT RECOMMENDED) or per audit option (SOURCE AUDIT)" }, conflict: { type: "object" }, changes: { type: "array" }, contract_changes: { type: "array", items: { type: "object", properties: { plan: { type: "string" }, symbol: { type: "string" }, old: { type: "string" }, new: { type: "string" }, reason: { type: "string" } }, required: ["symbol", "old", "new", "reason"] }, description: "CONTRACT_CHANGE: a produced signature that has to change, one entry per symbol" } },
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

// ---- arguments (GSDF-15): every check runs before the first agent ----
const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const cfg = await loadCfg();
const g = cfg.gsd;
const mode = a.mode ?? "plan";
const tracer = a.tracer ?? true;
const reversibilityGates = a.reversibilityGates ?? true;
const maxSkeletonPasses = a.maxSkeletonPasses ?? g.max_skeleton_passes;
const maxCheckIterations = a.maxCheckIterations ?? g.max_check_iterations;
const lanesArg = a.skeletonLanes ?? g.skeleton_lanes;
const wiringMode = a.wiring ?? "auto";
const planReview = a.planReview ?? g.plan_review;
// O65 (kit-feedback 65): `staged` runs every plan through each stage together; `streams` gives each plan its own review stream.
const planFlow = a.planFlow ?? g.plan_flow ?? "staged";
// Kit feedback 69, 76: reallocation rounds the checker may send plans back to the outline (staged flow, plan mode only), and the recheck scope.
const reallocRounds = planFlow === "staged" && mode === "plan" ? g.checker_reallocate ?? 0 : 0;
const recheckMode = mode === "plan" ? g.checker_recheck ?? "full" : "full";
const roleOverrides = a.roles ?? {};
if (!["plan", "gaps"].includes(mode)) return { status: "failed", reason: `mode must be plan or gaps, not ${mode}` };
if (!isInt13(maxSkeletonPasses)) return { status: "failed", reason: `maxSkeletonPasses must be an integer 1..3, not ${maxSkeletonPasses}` };
if (!isInt13(maxCheckIterations)) return { status: "failed", reason: `maxCheckIterations must be an integer 1..3, not ${maxCheckIterations}` };
if (!Array.isArray(lanesArg) || !lanesArg.length || lanesArg.some((l) => typeof l?.lens !== "string" || !l.lens.trim())) return { status: "failed", reason: "skeletonLanes needs at least one lane with a non-empty lens" };
if (!["auto", "always", "never"].includes(wiringMode)) return { status: "failed", reason: `wiring must be auto, always or never, not ${wiringMode}` };
if (!["staged", "streams"].includes(planFlow)) return { status: "failed", reason: `planFlow must be staged or streams, not ${planFlow}` };
if (a.forceProceed !== undefined && !String(a.forceProceed?.reason ?? "").trim()) return { status: "failed", reason: "forceProceed needs a non-empty reason" };
// Kit feedback 71: forceProceed.issues names the checker issues the owner accepts; without it every issue still stuck is accepted.
const forcedIssues = a.forceProceed?.issues ?? null;
if (forcedIssues !== null && (!Array.isArray(forcedIssues) || !forcedIssues.length || forcedIssues.some((i) => !i || typeof i !== "object" || !(i.plan === null || (typeof i.plan === "string" && i.plan.trim())) || typeof i.dimension !== "string" || !i.dimension.trim()))) return { status: "failed", reason: "forceProceed.issues needs a non-empty list of {plan (a plan id, null for a phase-level issue), dimension}" };
if (a.reviewGuidance !== undefined && (typeof a.reviewGuidance !== "string" || !a.reviewGuidance.trim())) return { status: "failed", reason: "reviewGuidance needs non-empty text" };
if (a.skipResearch && typeof a.researchSkipReason !== "string") return needsOwner("Research", "skipResearch needs a researchSkipReason", { answer: answers.args({ researchSkipReason: "<why research is skipped>" }, "give the reason research is skipped") });
const N = phaseNumber(phaseDir);
const nn = phaseDir.split("/").pop().split("-")[0];
const P = (name) => `${phaseDir}/${nn}-${name}`;
const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
const OUTLINE = P("PLAN-OUTLINE.md");
const MANIFEST = P("PLAN-OUTLINE.manifest.json");
const WIRING = P("WIRING.md");
const lensText = (lens) => {
  if (KIT_LENSES.includes(lens)) return `Lens: ${lens}. Follow the lens text in .agents/workflows/lenses/${lens}.md.`;
  // G029: a skeleton lane takes only skeleton-stage lenses; an adapter lens without a stage is a code lens.
  const custom = (cfg.adapter.review_lenses ?? []).find((l) => l.name === lens && (l.stage ?? "code") === "skeleton");
  return custom ? `Lens: ${lens}.\n${custom.text}` : null;
};
const lanes = lanesArg.map((l, i) => ({ id: `L${i + 1}`, lens: l.lens, model: l.model, effort: l.effort }));
const unknownLens = lanes.find((l) => !lensText(l.lens));
if (unknownLens) return { status: "failed", reason: `skeleton lane lens '${unknownLens.lens}' is neither a skeleton kit lens (${KIT_LENSES.join(", ")}) nor an adapter.review_lenses entry of stage skeleton` };

// GSDF-18: per-run overrides pass as model/effort; the engine records the roles the calls resolved to (result.json roles).
const roleOpts = (role, extra = {}) => {
  // G029: an unset lane field (undefined) leaves the per-run override in place instead of erasing it.
  const set = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
  const o = { ...(roleOverrides[role] ?? {}), ...set };
  const out = { role };
  if (o.model) out.model = o.model;
  if (o.effort) out.effort = o.effort;
  return out;
};
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
const warnings = [];
const advisories = [];
// O65: the streams flow names itself and each plan's stream in every result; the staged flow adds nothing.
let flowReport = null;
// The streams flow's plan stage outcome; null in the staged flow and in gap mode, which keep the checker loop.
let streamed = null;
// O67: what the dependent streams did, returned with the streams flow's results (the dependents part of plan-progress.json).
const dependents = [];
// Each round of dependent streams gets the next number; a stream is `<round>:<plan>` in the dependents log.
let depRounds = 0;
// Kit feedback 68: plans, artifacts and owned files changed outside the flow since their last record, from `ph gsd hand-edit scan`.
let handEdits = null;
// Kit feedback 70: what the validation strategy step did ({status, path}), returned with every result once it ran.
let validationReport = null;
// Kit feedback 69, 76: what the checker stage did beyond the plain loop: the plans it sent back to the outline and the scope of an incremental recheck,
// as the realloc and recheck parts of plan-progress.json last answered.
const reallocated = [];
let recheckReport = null;
// Kit feedback 67, 76 (gsd.contract_check): what the cross-plan contract gate did, returned with every result once it ran; the contracts part of
// plan-progress.json holds it and whether a contract changed since the last gate (dirty).
const contractsOn = g.contract_check !== false;
const contractReport = { checks: 0, rounds: 0, issues: 0, changes: [] };
let contractDirty = false;
let manifestFresh = null; // the manifest after a CONTRACT_CHANGE: later planners are told the current signatures
const result = (status, extra = {}) => ({ status, phaseDir, mode, warnings, advisories, ...(flowReport ?? {}), ...(handEdits ? { handEdits } : {}), ...(validationReport ? { validation: validationReport } : {}), ...(reallocated.length ? { reallocated } : {}), ...(recheckReport ? { recheck: recheckReport } : {}), ...(contractReport.checks ? { contracts: contractReport } : {}), ...extra });
const owner = (stage, reason, extra = {}) => result("needs-owner", { stage, reason, ...extra });
// G017: the effective settings each gated judgment reads, hashed into its revision key (`--settings`). A changed lane,
// role or limit reruns the judgments it decides; each key takes only the settings its own judgments read. The inputs
// key (outline reuse) stays file-only: a regenerated outline that matches the old one is refused below, so a
// planning-only change would fail there; `replan` regenerates the outline on purpose.
const roleOf = (name) => ({ ...(g.roles?.[name] ?? {}), ...(roleOverrides[name] ?? {}) });
const planning = { tracer, reversibilityGates, granularity: g.granularity, plan_limits: g.plan_limits, stack_skill: cfg.adapter.stack_skill ?? null };
// kit-feedback 37: extra files a tracer plan may list above the checker's Files/plan lines (0 = the same lines). It sits outside
// plan_limits so setting it does not replan every plan; the checked key takes it only when set, so earlier records stay valid.
const tracerExtraFiles = g.tracer_extra_files;
const settingsOf = {
  freeze: { lanes: lanes.map((l) => ({ lens: l.lens, text: lensText(l.lens), model: l.model ?? null, effort: l.effort ?? null })), skeleton_lane: roleOf("skeleton_lane"), tracer, maxSkeletonPasses },
  plan: { ...planning, planner: roleOf("planner") },
  checked: { ...planning, checker: roleOf("checker"), maxCheckIterations, ...(tracerExtraFiles ? { tracerExtraFiles } : {}), ...(g.files_per_plan ? { filesPerPlan: g.files_per_plan } : {}), ...(reallocRounds ? { reallocRounds } : {}) },
};
const settingsDigest = {};
for (const [key, value] of Object.entries(settingsOf)) settingsDigest[key] = await sha(JSON.stringify(value));
if (Object.values(settingsDigest).some((h) => !h)) return result("failed", { reason: "settings digest unavailable" });

// ---- preconditions (GSDF-16, GSDF-33) ----
phase("Preconditions");
// kit-feedback 2: plan holds only its phase's lease, so planning phase N+1 can run while phase N executes. It writes no code
// and takes no root writer lease; STATE, ROADMAP and the commit take their short writer locks inside ph gsd.
const lease = await flow(["lock", `phase-${nn}`, runId, "gsd-plan"]);
let crashed = false;
if (lease.code !== 0) return result("refused", { reason: `${leaseText(lease.json, `phase ${N}`)}; plan after it ends` });
try {
const found = (await gsd(["find-phase", N])).json;
// Kit feedback 68 (gsd.review_metrics, measurement only): what changed by hand since the last record is listed in the log and the
// result, with the verb that logs its cause; nothing stops and no later step reads it.
const handScan = g.review_metrics ? await gsd(["hand-edit", "scan", phaseDir]) : null;
if (handScan?.code === 0 && (handScan.json?.pending?.length || handScan.json?.candidates?.length)) {
  const { pending = [], candidates = [], ask } = handScan.json;
  handEdits = { pending, candidates, ...(ask ? { ask } : {}) };
  for (const e of pending) log(`hand edit ${e.id} (${e.key}): ${e.files.join(", ")}`);
  if (ask) log(`warning: ${pending.length} hand edits since the last record; ${ask}`);
  for (const c of candidates) log(`warning: ${c}`);
}
// G010: the number names the phase directory; a phaseDir with another slug would plan into a stale directory.
if (found?.directory && found.directory !== phaseDir) return result("refused", { reason: `phaseDir ${phaseDir} is not the directory of phase ${N} (${found.directory}); pass ${found.directory}` });
if (found?.status === "COMPLETE") {
  if (!a.force) return result("refused", { reason: `phase ${N} is complete (see ${P("VERIFICATION.md")}); pass force to replan it` });
  log(`warning: ======== replanning COMPLETE phase ${N} (force) ========`);
}
const open = await discussOpen(phaseDir, nn);
if (open) return owner("Discuss", open, { answer: answers.workflow(`gsd-discuss ${N}`, "finish the discussion") });
// G084: a blocking anti-pattern row without its three answers sends the phase back to discuss now, not to a stop at
// execute after the plans are paid for.
const anti = await flow(["anti-patterns", phaseDir]);
if (anti.code !== 0) return owner("Discuss", `blocking anti-patterns lack their three written answers in ${anti.json?.answersFile ?? `${phaseDir}/.continue-here.answers.json`}: ${(anti.json?.unanswered ?? [anti.json?.error ?? "check failed"]).join(", ")}; run gsd-discuss ${N} to write them (it reads CONTEXT)`, { rows: anti.json?.unanswered ?? [], answer: answers.workflow(`gsd-discuss ${N}`, "write the three answers of each blocking anti-pattern") });
// Kit feedback 87: the run's record in plan-progress.json (a --resume keeps its logs, a new run starts them), with the settings digests
// its plans are recorded with and the forceProceed it was given.
const started = await flow(["plan-run", phaseDir], { run: runId, settings: settingsDigest, force: a.forceProceed ? { reason: a.forceProceed.reason, issues: forcedIssues } : null });
if (started.code !== 0) return result("failed", { reason: `plan state: ${started.json?.reason ?? started.json?.error ?? `exit ${started.code}`}` });
// A resumed run (`ph workflow --resume` after a runner died): the plans an earlier instance of this run recorded, and the outline it wrote.
const ownRecorded = started.json.recorded ?? [];
if (started.json.resumed) log(`resumed run (instance ${started.json.instance})${ownRecorded.length ? `: plans this run recorded before it stopped: ${ownRecorded.join(", ")}` : ""}`);
const research = await gsd(["research", "status", phaseDir]);
let approvedResearch = null;
if (mode === "plan") {
  if (a.skipResearch) {
    if (!String(a.researchSkipReason ?? "").trim()) return owner("Research", "skipResearch needs a non-empty researchSkipReason", { answer: answers.args({ researchSkipReason: "<why research is skipped>" }, "give the reason research is skipped") });
    log(`research skipped: ${a.researchSkipReason}`);
  } else if (research.code === 0) approvedResearch = P("RESEARCH.md");
  else return owner("Research", `research is ${research.json?.status ?? (research.code === 66 ? "missing" : "not complete")}; run gsd-research or pass skipResearch with a reason`, { answer: answers.workflow(`gsd-research ${N}`, "research the phase (or set skipResearch with researchSkipReason)") });
} else if (research.code === 0) approvedResearch = P("RESEARCH.md");
const roadmapPhase = (await gsd(["roadmap", "get-phase", N])).json ?? {};
const reqIds = roadmapPhase.requirements ?? [];
if (!reqIds.length) log(`warning: ROADMAP lists no requirement IDs for phase ${N}; the coverage gate decides later`);
const drift = (await flow(["drift", String(g.drift_threshold)])).json;
if (drift?.status === "drift") log(`warning: codebase map drift: ${drift.count} changes since ${drift.baseline} (threshold ${drift.threshold}); consider gsd-map-codebase --paths`);
else if (drift?.status === "skipped") log(`drift check skipped: ${drift.reason}`);
// F50: with adapter.commands.smoke_builds, every declared verification target builds once before any planner runs, so a missing
// toolchain component stops the run here (needs-owner) instead of at the first obligation that needs that target.
if (cfg.adapter.commands.smoke_builds?.length) {
  phase("Smoke build");
  const smoke = await gsd(["check", "smoke"]);
  if (smoke.code !== 0) return owner("Smoke build", smoke.json?.reason ?? `smoke build check exit ${smoke.code}`, { builds: (smoke.json?.builds ?? []).filter((b) => b.status !== "passed"), options: ["install the missing toolchain component or fix the build, then rerun", "remove the target from adapter.commands.smoke_builds, then rerun", "abandon"], answer: answers.fix("install the missing toolchain component or fix the build until `ph gsd check smoke` passes") });
  phase("Preconditions");
}
const POLICY = policyBlock(approvedResearch);
const stackSkill = cfg.adapter.stack_skill ? `.claude/skills/${cfg.adapter.stack_skill}/SKILL.md` : null;
const planningContext = (planMode) => [
  "<planning_context>",
  `Phase: ${N}${roadmapPhase.phase_name ? ` (${roadmapPhase.phase_name})` : ""}`,
  `Phase directory: ${phaseDir}`,
  `Mode: ${planMode}`,
  "Required reading (open these paths yourself):",
  "- .planning/STATE.md",
  "- .planning/ROADMAP.md",
  "- .planning/REQUIREMENTS.md",
  `- ${P("CONTEXT.md")} (user decisions: locked, do not revisit)`,
  approvedResearch ? `- ${approvedResearch} (approved research)` : "- research: NONE approved",
  `Phase requirement IDs: ${reqIds.length ? reqIds.join(", ") : "none declared"}`,
  `Project instruction files: ${(cfg.adapter.instructions ?? []).join(", ") || "none"}`,
  `Stack skill to follow: ${stackSkill ?? "none"}`,
  `TRACER_MODE: ${tracer}`,
  `REVERSIBILITY_GATES: ${reversibilityGates}`,
  "MVP_MODE: false",
  "WALKING_SKELETON: false",
  `Granularity: ${g.granularity}`,
  `Plan limits: ${g.plan_limits.tasks_per_plan} tasks per plan, ${g.plan_limits.plans_per_phase} plans per phase, ${g.plan_limits.waves_per_phase} waves per phase`,
  ...(validationNote ? [validationNote] : []),
  "</planning_context>",
].join("\n");
// GSDF-17: no SPEC sections exist in the kit, so every plan-mode prompt carries the specless block.
const SPECLESS = "<specless_edges>\nNo SPEC defines edge cases or prohibitions for this phase. List the edge cases you plan for in must_haves.truths and the must-not items in must_haves.prohibitions, or record `edges_skipped: <reason>` in the plan frontmatter. Never neither.\n</specless_edges>";
const RETURN_NOTE = "Never ask the owner. Return JSON {marker, summary, question?, conflict?, plans?}: marker is one of OUTLINE COMPLETE, PLANNING COMPLETE, REVISION COMPLETE, or an owner marker (REVISION_CONFLICT, PHASE SPLIT RECOMMENDED, SOURCE AUDIT, CHECKPOINT REACHED, PLANNING INCONCLUSIVE) with the question or conflict. For PHASE SPLIT RECOMMENDED and SOURCE AUDIT, summary states the proposal and plans lists its options, one string each. Do not commit; do not write STATE, ROADMAP or REQUIREMENTS.";
const revisionContext = (plans, issues, contract = "") => [
  "<revision_context>",
  `Existing plans: ${plans.join(", ") || "none"}`,
  `Checker issues (JSON): ${JSON.stringify(issues)}`,
  "Instructions: revise in place only what the issues require. Answer every issue with one `changes` entry {issue, change}; when an issue contradicts a locked decision or another issue, return REVISION_CONFLICT with the conflict instead of guessing.",
  ...(contract ? [contract] : []),
  "</revision_context>",
].join("\n");
// Kit feedback 67 F2: a reviser gets the manifest entry of each plan it edits and, per produced symbol, the plans that consume it.
const CONTRACT_RULE = "The manifest owns every produced signature. Never change a produced signature in plan text, and keep every consumed signature quoted exactly as the manifest has it. When an issue can only be met by a different signature, leave the plan on the manifest signature and return marker CONTRACT_CHANGE with contract_changes: [{plan, symbol, old, new, reason}], one entry per symbol: the flow updates the manifest and has every consumer revised in this run. Return REVISION_CONFLICT when a consumer cannot follow.";
async function contractBlock(ids) {
  if (!contractsOn) return "";
  const parts = [];
  for (const id of ids) {
    const s = (await gsd(["contracts", "show", N, "--plan", id])).json;
    if (!s?.plan || !(s.produces?.some((p) => p.structured) || s.consumes?.some((c) => c.entry))) continue;
    const consumers = Object.fromEntries(Object.entries(s.consumers ?? {}).filter(([, list]) => list.length));
    parts.push(`${id} produces (manifest): ${JSON.stringify(s.produces.filter((p) => p.structured).map(({ symbol, kind, file, signature }) => ({ symbol, kind, file, signature })))}`, `${id} consumers per produced symbol: ${JSON.stringify(consumers)}`, `${id} consumes (producer manifest entries to quote): ${JSON.stringify(s.consumes.filter((c) => c.entry).map((c) => ({ plan: c.plan, ...c.entry })))}`);
  }
  return parts.length ? ["<contract_context>", ...parts, CONTRACT_RULE, "</contract_context>"].join("\n") : "";
}
async function inputsDigest() { return (await gsd(["revisions", "hash", phaseDir, "inputs"])).json?.hash ?? "none"; }
// CR-GSF-19: skeleton reviews judge the outline, manifest and wiring, which the freeze key covers and inputs does not.
async function skeletonDigest() { return (await gsd(["revisions", "hash", phaseDir, "freeze", "--settings", settingsDigest.freeze])).json?.hash ?? "none"; }
// G125: a call's stage digest covers the files it judges. The outline stage judges the outline files and the owned paths of
// the phase's plans; a plan-level call judges its plan files and the owns each plan's frontmatter declares.
const outlineJudges = async () => ({ files: [OUTLINE, MANIFEST, P("CONTEXT.md")], owns: (await gsd(["outline", "parse", N])).json?.manifest?.plans?.flatMap((p) => p.owns ?? []) ?? [] });
const planOwns = async (id) => (await gsd(["frontmatter", "get", planPath(id), "owns"])).json?.value ?? [];
const plansJudges = async (ids) => ({ files: ids.map(planPath), owns: (await Promise.all(ids.map(planOwns))).flat() });
// The calls of one label so far: a label recurs across checker loops and contract gates, `label#n` names one call in the run's log.
const labelCalls = new Map();
async function plannerCall(session, label, body, digestKey, digest, extra = {}) {
  const prompt = [body, POLICY, RETURN_NOTE, digestLine(digestKey, digest)].join("\n\n");
  const nth = (labelCalls.get(label) ?? 0) + 1;
  labelCalls.set(label, nth);
  const r = await call(prompt, { label, session, agentType: agentFor("planner", "gsd-planner"), schema: PLANNER_SCHEMA, ...roleOpts(session === "planner:outline" ? "outline" : "planner"), ...extra });
  return contractsOn && r.result && /^(revise|deprevise|contract|fix)-/.test(label) ? applyContractChanges(r, session, `${label}#${nth}`) : r;
}
// Kit feedback 87: one step of the run's planning log in plan-progress.json (flow-plan-state.mjs); the verb keeps the bookkeeping
// and answers per op. A resumed run replays the same steps and gets the same answers.
async function planStep(verb, part, step, ops) {
  const r = await flow([verb, phaseDir], { run: runId, part, step, ops });
  if (r.code !== 0 || !Array.isArray(r.json?.replies)) throw new Error(`${verb} ${part} ${step}: ${r.json?.reason ?? r.json?.error ?? `exit ${r.code}`}`);
  return r.json.replies;
}
const partView = async (part) => (await flow(["plan-state", phaseDir])).json?.views?.[part] ?? null;
// Kit feedback 67 F2: a reviser's CONTRACT_CHANGE entries become the manifest's new signatures (the one writer, ph gsd contracts
// change); the consumers are revised by the next contract gate. A change the manifest refuses, or a CONTRACT_CHANGE marker with no
// entry, comes back as a REVISION_CONFLICT, which every caller already stops on (needs-owner). A reply replayed on resume repeats
// a change already applied, which the verb accepts (`already`); the contracts log of the run still holds it as this run's change.
async function applyContractChanges(r, session, callId) {
  const list = Array.isArray(r.result.contract_changes) ? r.result.contract_changes : [];
  const conflict = (why, change) => ({ ...r, result: { ...r.result, marker: "REVISION_CONFLICT", summary: why, conflict: { contract_change: change ?? null, rejected: why } } });
  if (!list.length) return markerOf(r.result).includes("CONTRACT_CHANGE") ? conflict("marker CONTRACT_CHANGE without a contract_changes entry") : r;
  const own = /^planner:(\d+(?:\.\d+)?-\d+)$/.exec(session)?.[1] ?? null;
  for (const c of list) {
    const w = await gsd(["contracts", "change", N], { plan: c.plan ?? own, symbol: c.symbol, old: c.old, new: c.new, reason: c.reason });
    if (w.code !== 0) return conflict(`CONTRACT_CHANGE of ${c.symbol} rejected: ${w.json?.error ?? `exit ${w.code}`}`, c);
    const [d] = await planStep("plan-contracts", "contracts", `${callId}:${c.symbol}`, [{ op: "change", plan: c.plan ?? own, symbol: c.symbol, old: c.old, new: c.new, reason: c.reason, outcome: { changed: Boolean(w.json?.changed), already: Boolean(w.json?.already), plan: w.json?.plan ?? null, old: w.json?.old ?? null, signature: w.json?.signature ?? null, consumers: w.json?.consumers ?? [] } }]);
    if (d.changed) {
      Object.assign(contractReport, d.report);
      log(`contract change: ${d.entry.plan} ${c.symbol}: ${d.entry.old} -> ${d.entry.new}; consumers ${d.entry.consumers.join(", ") || "none"}`);
      contractDirty = d.dirty;
      manifestFresh = (await gsd(["outline", "parse", N])).json?.manifest ?? manifestFresh;
    }
  }
  return r;
}
// Kit feedback 67 F3, 76: `ph gsd verify contracts` after the planners of a wave, after the checker and plan-review edits and at
// handoff (--complete). A failure is an issue for each plan it names, revised by that plan's planner with its contract block;
// the rounds are counted here, not in the checker's caps. Plans stay single-writer: the gate runs between stages and at the
// streams' wave joins, when no review stream edits a plan. Still failing after maxCheckIterations rounds, or not falling,
// stops needs-owner at stage Contracts. Returns null when the contracts hold, else the stop.
let contractGates = 0;
async function contractGate(stage, { complete = false } = {}) {
  if (!contractsOn) return null;
  const gate = ++contractGates;
  const contracts = async (step, op, extra = {}) => {
    const [d] = await planStep("plan-contracts", "contracts", step, [{ op, ...extra }]);
    Object.assign(contractReport, d.report);
    contractDirty = d.dirty;
  };
  await contracts(`g${gate}`, "clean");
  let prev = Infinity;
  for (let round = 1; ; round++) {
    const c = await gsd(["verify", "contracts", N, ...(complete ? ["--complete"] : [])]);
    const verdict = Boolean(c.json) && [0, 1].includes(c.code);
    const errors = c.json?.errors ?? [];
    await contracts(`g${gate}:${round}`, "check", { errors: verdict && c.code !== 0 ? errors.length : 0 });
    if (!verdict) return failedCall("contract check", c.json?.error ?? c.json?.reason ?? `exit ${c.code}`);
    for (const w of c.json.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);
    if (c.code === 0 || !errors.length) return null;
    log(`contract gate (${stage}) round ${round}: ${errors.length} issues`);
    const options = ["fix the named plans or the manifest by hand, then rerun", "give guidance and rerun", "abandon"];
    const answer = answers.fix(`fix the contract issues in the named plans or ${MANIFEST} by hand and record each plan (ph gsd revisions record ${N} plan:<id>)`);
    if (errors.some((e) => e.kind === "plan-missing")) return owner("Contracts", `${errors.filter((e) => e.kind === "plan-missing").map((e) => e.plan).join(", ")} in the manifest but not planned`, { issues: errors, options, answer });
    if (round > maxCheckIterations || errors.length >= prev) return owner("Contracts", round > maxCheckIterations ? `${errors.length} contract issues left after ${round - 1} revisions` : `contract issues not falling: ${errors.length}, was ${prev}`, { issues: errors, options, answer });
    prev = errors.length;
    await contracts(`g${gate}:${round}:round`, "round");
    const byPlan = new Map();
    for (const e of errors) for (const p of e.plans ?? [e.plan]) if (planIds.includes(p)) byPlan.set(p, [...(byPlan.get(p) ?? []), { plan: p, dimension: "contract", severity: "blocker", required_property: `${e.kind}${e.symbol ? ` ${e.symbol}` : ""}`, description: e.message, fix_hint: e.fix_hint, related_plans: (e.plans ?? []).filter((x) => x !== p) }]);
    const named = [...byPlan.keys()];
    const revised = await parallel(named.map((id) => async () => plannerCall(`planner:${id}`, `contract-${id}-${round}`, [planningContext("revision"), revisionContext([planPath(id)], byPlan.get(id), await contractBlock([id]))].join("\n\n"), "freeze", freezeHash, { judges: await plansJudges([id]) })));
    const answered = named.filter((_, i) => revised[i] && revised[i].result !== null && !ownerMarker(revised[i].result));
    const stop = await recordEach(answered, false);
    const owned = revised.find((r) => ownerMarker(r?.result));
    if (owned) return ownerStop("Contracts", owned.result);
    const missed = revised.findIndex((r) => !r || r.result === null);
    if (missed !== -1) return failedCall(`contract revision ${named[missed]} (round ${round})`, revised[missed]?.reason ?? null);
    if (stop) return stop;
    await contracts(`g${gate}:${round}:clean`, "clean");
  }
}
const ownerStop = (stage, r) => owner(stage, `planner returned ${ownerMarker(r)}`, { marker: ownerMarker(r), question: r?.question ?? r?.summary ?? null, summary: r?.summary ?? null, plans: r?.plans ?? null, conflict: r?.conflict ?? null, options: ["answer and rerun with the same args", "adjust CONTEXT and rerun", "abandon"], answer: answers.context(`the planner's ${ownerMarker(r)} (its question, conflict or proposal)`) });
const failedCall = (what, reason) => result("failed", { reason: `${what}${reason ? `: ${reason}` : " returned nothing"}` });
// Kit feedback 64: each pre-code review stage that ran leaves a record of its findings and their fates for `ph review-stats
// --stage` (gsd.review_metrics); `part` names a part of a stage that runs beside others (the dependency checks). Measurement
// only: no flow reads it back, and a failed write is a warning, never a stop.
async function prereview(stage, findings, part) {
  if (!g.review_metrics) return;
  const w = await flow(["prereview-record", phaseDir], { stage, runId, mode, ...(part ? { part } : {}), findings });
  if (w.code !== 0) log(`warning: ${stage} review record not written: ${(w.json?.errors ?? [w.json?.error ?? `exit ${w.code}`]).join("; ")}`);
  else log(`review metrics: ${w.json.record}`);
}
// Kit feedback 64, 87: the checker ledger (the findings of the checker loop, the streams join and the dependency checks, one entry per
// distinct issue with its fate), the per-plan cap and stall rule, the stuck issues and what forceProceed accepts are the checker parts
// of plan-progress.json (plan-checker); each loop or join is one part, and `ran` says whether a checker agent judged in it.
const checkerPart = (name) => ({ name, ran: false, step: (id, ops) => planStep("plan-checker", name, id, ops) });
const isConflict = (r) => markerOf(r).includes("REVISION_CONFLICT");
// O67's dependency checks of the streams flow, recorded as their own part of the checker stage.
const depLedger = checkerPart("dependents");

const sharedChanges = [];
// Kit feedback 69: reallocation rounds still open to this run, as the realloc part of plan-progress.json last answered.
let reallocLeft = reallocRounds;
// Digest line of plan and checker prompts: the freeze hash, or the verification report in gap mode.
let freezeHash = "none";

// ---- validation strategy (Kit feedback 70) ----
// Upstream plan-phase step 5.5: `<NN>-VALIDATION.md` from the template and the research's Validation Architecture section; the
// checker's check 8e blocks without it. The verb renders it (no agent, an existing file is kept) and the checker is told in the
// planning context whether Dimension 8 applies or is skipped, and why.
let validationNote = null;
{
  const skipped = (why) => { validationNote = `Nyquist validation (checker Dimension 8): SKIPPED, ${why}. The checker reports "Dimension 8: SKIPPED (nyquist_validation disabled or not applicable)" and runs no check 8a-8e.`; };
  if (!g.validation_strategy) skipped("gsd.validation_strategy is off");
  else if (!approvedResearch) skipped("no approved research in this run");
  else {
    const v = await flow(["validation-strategy", phaseDir]);
    if (v.code !== 0 || !v.json?.status) return result("failed", { reason: `validation strategy: ${v.json?.error ?? v.stderr ?? `exit ${v.code}`}` });
    validationReport = { status: v.json.status, ...(v.json.path ? { path: v.json.path } : {}) };
    if (["no-research", "no-section"].includes(v.json.status)) {
      warnings.push(`validation: ${approvedResearch} has no Validation Architecture section; no VALIDATION.md was written and Dimension 8 is skipped`);
      skipped("the approved research has no Validation Architecture section");
    } else {
      validationNote = `Nyquist validation (checker Dimension 8): applies; ${v.json.path} exists, so check 8e passes; run checks 8a-8d.`;
      if (v.json.stale) warnings.push(`validation: ${v.json.path} was rendered from an older ${approvedResearch}; it is already validated or edited, so it was kept (update it by hand or delete it to render again)`);
      if (["written", "refreshed"].includes(v.json.status)) {
        log(`validation strategy ${v.json.status}: ${v.json.path}`);
        await commitDocs(`docs(phase-${N}): add validation strategy`, [v.json.path]);
      } else log(`validation strategy kept: ${v.json.path}`);
    }
  }
}
if (mode === "gaps") return await gapMode();

// ---- outline (GSDF-19) ----
phase("Outline");
// The writer runs the same check the gate runs (G027), so a deterministic outline failure is repaired in its own turn.
const outlineCheckArgs = ["outline", "check", N, ...(tracer ? [] : ["--tracer", "false"])];
// Kit feedback 69: the check holds a plan whose owns reach the Files/plan blocker line as an error, so the outline writer reallocates it
// in its own turn; an outline reused from an earlier run was reviewed and may have plans, so this run's first check only warns.
let outlineFilesMode = "error";
const outlineCheck = async () => gsd([...outlineCheckArgs, ...(outlineFilesMode === "warn" ? ["--files-per-plan", "warn"] : [])]);
async function fixOutline(turns, stage) {
  let check = await outlineCheck();
  for (let t = 0; check.code !== 0 && t < turns; t++) {
    const errs = check.json?.errors ?? [check.json?.error ?? `outline check exit ${check.code}`];
    const { result: r, reason } = await plannerCall("planner:outline", "outline-fix", `Fix ${OUTLINE} and ${MANIFEST} in place. outline check reported these errors (fix exactly these):\n${errs.map((e) => `- ${typeof e === "string" ? e : JSON.stringify(e)}`).join("\n")}`, "inputs", await inputsDigest(), { judges: await outlineJudges() });
    if (fatal(reason)) return { stop: failedCall("outline fixer", reason) };
    if (ownerMarker(r)) return { stop: ownerStop(stage, r) };
    check = await outlineCheck();
  }
  if (check.code !== 0) return { stop: result("failed", { reason: "outline check still failing", errors: check.json?.errors ?? [] }) };
  for (const w of check.json?.warnings ?? []) warnings.push(`outline: ${typeof w === "string" ? w : JSON.stringify(w)}`);
  return { check };
}
const parsed = await gsd(["outline", "parse", N]);
const inputsCheck = await gsd(["revisions", "check", phaseDir, "inputs"]);
const inputsSame = inputsCheck.code === 0;
// F40 (kit-feedback 40): name the input that changed, so a regenerated outline has a visible cause.
if (!inputsSame) log(`inputs changed: ${inputsCheck.json?.changed?.length ? inputsCheck.json.changed.join(", ") : inputsCheck.json?.error ?? "unknown (the record has no per-input digests)"}`);
let outlineReused = false;
// Kit feedback 87: a resumed run keeps the outline its writer wrote for these same inputs before the run stopped (plan-outline), so a
// runner that died before the inputs were recorded does not write the outline again (it would match the old one and fail below).
const ownOutline = !inputsSame && !a.replan && parsed.json?.complete ? started.json.outline : null;
const keepOwnOutline = ownOutline ? ownOutline.inputs === (await inputsDigest()) && ownOutline.sha === (await fileSha(OUTLINE)) : false;
if (parsed.json?.complete && inputsSame && !a.replan) {
  outlineReused = true;
  log("outline reused: marker present and inputs unchanged");
} else if (keepOwnOutline) log("outline kept: this run wrote it for the same inputs before it stopped");
else {
  const beforeSha = await fileSha(OUTLINE);
  const body = [
    planningContext("outline"),
    SPECLESS,
    `Write the phase outline ${OUTLINE} (table: Plan ID, Objective, Wave, Depends, Requirements; last line exactly \`## OUTLINE COMPLETE\`) and its manifest ${MANIFEST} ({phase, plans:[{id, owns, requirements, produces, consumes, tracer, verify}]}). Do not write PLAN files yet.`,
    contractsOn ? "In the manifest `produces` lists every symbol another plan calls or builds on as {symbol, kind, file, signature}: file is inside the plan's owns, signature is the exact interface text the consumers will quote (a method, constructor, widget or provider as it will be written). `consumes` lists {plan, symbol} naming a symbol that plan produces. A precondition a plan needs from another (an ancestor widget, a provider override, a registration) is declared later in the plans as must_haves.key_links `requires`/`provides` entries." : "",
    `Before you return, run \`node ${PH} gsd ${outlineCheckArgs.join(" ")}\`, repair every error it reports in ${OUTLINE} and ${MANIFEST}, and run it again until it exits 0.`,
  ].filter(Boolean).join("\n\n");
  const { result: r, reason } = await plannerCall("planner:outline", "outline", body, "inputs", await inputsDigest(), { judges: await outlineJudges() });
  if (fatal(reason)) return failedCall("outline planner", reason);
  if (ownerMarker(r)) return ownerStop("Outline", r);
  const after = await gsd(["outline", "parse", N]);
  const afterSha = await fileSha(OUTLINE);
  // An old marker never acknowledges new inputs: a regeneration must change the outline.
  if (beforeSha && afterSha === beforeSha) return result("failed", { reason: `outline regeneration ${r === null ? "returned nothing" : "left the old outline unchanged"} after an input change` });
  if (!after.json?.complete) return r === null ? failedCall("outline planner", reason) : owner("Outline", "outline has no `## OUTLINE COMPLETE` marker", { options: ["rerun", "adjust CONTEXT", "abandon"], answer: answers.rerun("") });
}
outlineFilesMode = outlineReused ? "warn" : "error";
const fixed = await fixOutline(2, "Outline");
outlineFilesMode = "error";
if (fixed.stop) return fixed.stop;
let outline = fixed.check.json;
if (!outlineReused || !inputsSame) {
  if (!outlineReused) {
    const own = await flow(["plan-outline", phaseDir], { run: runId, inputs: await inputsDigest(), sha: await fileSha(OUTLINE) });
    if (own.code !== 0) log(`warning: outline record not written: ${own.json?.reason ?? own.json?.error ?? `exit ${own.code}`}`);
  }
  await gsd(["revisions", "record", phaseDir, "inputs"]);
}

// ---- wiring contract (GSDF-20): only with an adapter architect agent ----
phase("Wiring");
const architect = cfg.adapter.agents?.architect ?? null;
const architectReady = architect ? Boolean((await flow(["exists", `.agents/agents/${architect}.md`])).json?.exists?.[`.agents/agents/${architect}.md`]) : false;
const wiringExists = async () => Boolean((await flow(["exists", WIRING])).json?.exists?.[WIRING]);
const wiringInUse = architectReady && wiringMode !== "never";
let outlineChangeIssues = [];
async function runArchitect(label, why) {
  const prompt = [
    planningContext("wiring"),
    `Write only ${WIRING}: the wiring contract of the cross-plan edges of ${OUTLINE} (manifest ${MANIFEST}). ${why}`,
    "Return JSON {status: complete|conflict, sharedChanges[], outlineChanges[], conflicts[]}. outlineChanges are changes the outline must make; conflicts are contradictions only the owner can settle.",
    POLICY,
    digestLine("inputs", await inputsDigest()),
  ].join("\n\n");
  const opts = { label, agentType: architect, schema: ARCHITECT_SCHEMA, judges: await outlineJudges(), ...roleOpts("architect") };
  let attempt = await call(prompt, opts);
  // A null reply is retried once, as the skeleton lane does. An existing WIRING.md never stands in for the reply (G011).
  if (attempt.result === null && !fatal(attempt.reason)) attempt = await call(prompt, opts);
  const { result: r, reason } = attempt;
  if (fatal(reason)) return { stop: failedCall("architect", reason) };
  if (r?.status === "conflict") return { stop: owner("Wiring", "architect reported a conflict", { conflict: r.conflicts ?? [], options: ["decide and rerun", "abandon"], answer: answers.context("the architect's conflicts") }) };
  if (r?.status !== "complete") return { stop: result("failed", { reason: `architect ${r ? `ended with status ${r.status}` : "returned nothing"}${reason ? ` (${reason})` : ""}` }) };
  if (!(await wiringExists())) return { stop: result("failed", { reason: `architect wrote no ${WIRING}${reason ? ` (${reason})` : ""}` }) };
  sharedChanges.push(...(r?.sharedChanges ?? []));
  return { changes: (r?.outlineChanges ?? []).map((c, i) => ({ id: `W${i + 1}`, plan: c.plan ?? null, severity: "blocker", description: typeof c === "string" ? c : c.description ?? JSON.stringify(c), target: "outline", evidence: "architect outlineChanges", lane: "integration" })) };
}
let wroteWiring = false;
const wantsWiring = wiringMode === "always" || (wiringMode !== "never" && (outline?.needsWiring || (outline?.crossPlan ?? []).length > 0 || (await wiringExists())));
if (!architectReady) log("wiring: no architect agent");
else if (!wantsWiring) log(`wiring: skipped (${wiringMode === "never" ? "wiring never" : "no cross-plan edges"})`);
else {
  const w = await runArchitect("architect", "Cover every consumes edge.");
  if (w.stop) return w.stop;
  outlineChangeIssues = w.changes;
  wroteWiring = true;
}

// ---- skeleton review (GSDF-21..23) ----
phase("Skeleton review");
const sevClass = (s) => (s === "info" ? "info" : s === "warning" ? "warning" : "blocker"); // unknown severity = blocker
const issues = new Map();
const passCounts = [];
const laneFailures = new Map(); // lane id -> reason of a lane that returned nothing
const integrationLane = (lanes.find((l) => l.lens === "integration") ?? lanes[0]).id;
const hasEdges = (o) => Boolean(o?.needsWiring || (o?.crossPlan ?? []).length);
const openIssues = () => [...issues.values()].filter((i) => i.state === "open");
const openBlockers = () => openIssues().filter((i) => i.severity === "blocker");
let laneSeq = 0;
// Kit feedback 69: set while the skeleton is reviewed again after the checker reallocated plans: the plans that changed.
let skeletonFocus = null;
// The issues a lane reviewer raised, not the ones the flow added (architect outline changes, new cross-plan edges).
const laneIssueIds = new Set();
function addIssue(laneId, raw) {
  const sev = sevClass(String(raw.severity ?? "").toLowerCase());
  if (sev === "info") { advisories.push({ lane: laneId, plan: raw.plan ?? null, description: raw.description }); return null; }
  const id = `${laneId}-${++laneSeq}`;
  issues.set(id, { id, lane: laneId, plan: raw.plan ?? null, dimension: raw.dimension ?? "", required_property: raw.required_property ?? "", severity: sev, target: raw.target ?? "outline", description: raw.description ?? "", evidence: raw.evidence ?? "", fix_hint: raw.fix_hint ?? "", state: "open", resolution: "" });
  return id;
}
async function snapshotList() {
  const paths = [OUTLINE, MANIFEST, P("CONTEXT.md"), ".planning/REQUIREMENTS.md", ".planning/ROADMAP.md"];
  if (await wiringExists()) paths.push(WIRING);
  return paths;
}
async function reviewLane(lane) {
  const files = await snapshotList();
  const prompt = [
    lensText(lane.lens),
    `Review the skeleton of phase ${N}${roadmapPhase.goal ? ` (goal: ${roadmapPhase.goal})` : ""} read-only. Frozen snapshot: ${files.join(", ")}.`,
    `Requirement IDs: ${reqIds.join(", ") || "none"}. TRACER_MODE: ${tracer}.`,
    `Mechanical warnings: ${JSON.stringify(outline?.warnings ?? [])}. Cross-plan edges: ${JSON.stringify(outline?.crossPlan ?? [])}.`,
    ...(skeletonFocus ? [`Reallocation: the plan checker sent ${skeletonFocus.named.join(", ")} back to the outline and the allocation of ${skeletonFocus.changed.join(", ")} changed (owned paths split or moved). The rest of the skeleton passed review before: judge the changed plans and the edges to and from them.`] : []),
    "Return JSON {issues: [{plan, dimension, severity (blocker|warning|info), required_property, description, evidence, fix_hint, target (outline|wiring|both)}]}; an empty list when the skeleton holds under this lens.",
    POLICY,
    digestLine("freeze", await skeletonDigest()),
  ].join("\n\n");
  const opts = { label: `skeleton-${lane.id}`, agentType: agentFor("skeleton_lane", "gsd-skeleton-reviewer"), readOnly: true, schema: ISSUES_SCHEMA, judges: await outlineJudges(), ...roleOpts("skeleton_lane", { model: lane.model, effort: lane.effort }) };
  let r = await call(prompt, opts);
  if (r.result === null && !fatal(r.reason)) r = await call(prompt, opts);
  return r;
}
async function resolutionCheck(lane, open) {
  const files = await snapshotList();
  const prompt = [
    lensText(lane.lens),
    `Resolution check, read-only, of your own open skeleton issues after a revision. Snapshot: ${files.join(", ")}.`,
    `Open issues (JSON): ${JSON.stringify(open.map(({ id, plan, required_property, description, fix_hint }) => ({ id, plan, required_property, description, fix_hint })))}`,
    "Return JSON {resolved: [{id, evidence}]} listing only the ids now resolved, each with evidence. Do not raise new issues; an id you do not list stays open.",
    POLICY,
    digestLine("freeze", await skeletonDigest()),
  ].join("\n\n");
  return call(prompt, { label: `resolve-${lane.id}`, agentType: agentFor("skeleton_lane", "gsd-skeleton-reviewer"), readOnly: true, schema: RESOLUTION_SCHEMA, judges: await outlineJudges(), ...roleOpts("skeleton_lane", { model: lane.model, effort: lane.effort }) });
}
async function skeletonGate() {
  const first = await parallel(lanes.map((l) => () => reviewLane(l)));
  // A failed lane keeps the findings of the lanes that answered; the stop lists the failed lanes.
  for (const [i, r] of first.entries()) {
    // The lane table shows the model and effort this lane's reviewer resolved to, not the other lanes' (GSDF-18).
    lanes[i].resolved = { model: r?.model ?? null, effort: r?.effort ?? null };
    if (!r || r.result === null) laneFailures.set(lanes[i].id, r?.reason ?? null);
    else for (const raw of r.result.issues ?? []) { const id = addIssue(lanes[i].id, raw); if (id) laneIssueIds.add(id); }
  }
  for (const c of outlineChangeIssues) addIssue(integrationLane, c);
  if (laneFailures.size) {
    const failed = lanes.filter((l) => laneFailures.has(l.id)).map((l) => failedCall(`skeleton lane ${l.id} (${l.lens})`, laneFailures.get(l.id)).reason);
    return { status: "failed", stop: result("failed", { reason: failed.join("; ") }) };
  }
  passCounts.push(openIssues().length);
  // Revisions and the stall rule follow open blockers only; warnings are carried after the loop.
  for (let pass = 2; openBlockers().length && pass <= maxSkeletonPasses; pass++) {
    const startBlockers = openBlockers().length;
    const open = openIssues();
    const toOutline = open.filter((i) => i.target === "outline" || i.target === "both" || (i.target === "wiring" && !wiringInUse));
    const toWiring = wiringInUse ? open.filter((i) => i.target === "wiring" || i.target === "both") : [];
    let wroteThisPass = false;
    if (toOutline.length) {
      const edgesBefore = hasEdges(outline);
      const { result: r, reason } = await plannerCall("planner:outline", `outline-revise-${pass}`, [planningContext("revision"), revisionContext([OUTLINE, MANIFEST], toOutline)].join("\n\n"), "inputs", await inputsDigest(), { judges: await outlineJudges() });
      if (fatal(reason)) return { status: "failed", stop: failedCall("outline reviser", reason) };
      if (ownerMarker(r)) return { status: "needs-owner", stop: ownerStop("Skeleton review", r) };
      const f = await fixOutline(1, "Skeleton review");
      if (f.stop) return { status: f.stop.status, stop: f.stop };
      outline = f.check.json;
      if (!edgesBefore && hasEdges(outline)) {
        if (wiringInUse) {
          const w = await runArchitect("architect", "A revision introduced the first cross-plan edge: write the wiring contract now.");
          if (w.stop) return { status: w.stop.status, stop: w.stop };
          wroteThisPass = true;
          w.changes.forEach((c) => addIssue(integrationLane, c));
          addIssue(integrationLane, { severity: "blocker", target: "wiring", description: `${WIRING} was written in pass ${pass}: review all of it`, evidence: "first cross-plan edge" });
        } else {
          for (const e of outline.crossPlan ?? []) addIssue(integrationLane, { severity: "blocker", plan: e.plan ?? null, target: "outline", description: `new cross-plan edge ${JSON.stringify(e)}: review the integration`, evidence: "introduced by the outline revision" });
        }
      }
    }
    if (wiringInUse && !wroteThisPass && (toWiring.length || toOutline.length)) {
      const w = await runArchitect("architect", toWiring.length ? `Resolve these skeleton issues: ${JSON.stringify(toWiring.map(({ id, required_property, description, fix_hint }) => ({ id, required_property, description, fix_hint })))}` : "Realign WIRING.md with the revised outline.");
      if (w.stop) return { status: w.stop.status, stop: w.stop };
      w.changes.forEach((c) => addIssue(integrationLane, c));
    }
    const checks = await parallel(lanes.map((l) => async () => {
      const mine = openIssues().filter((i) => i.lane === l.id);
      return mine.length ? { lane: l, open: mine, r: await resolutionCheck(l, mine) } : null;
    }));
    for (const c of checks) for (const res of c?.r?.result?.resolved ?? []) {
      const i = issues.get(res.id);
      if (i && i.lane === c.lane.id && i.state === "open") { i.state = "resolved"; i.resolution = res.evidence ?? ""; }
    }
    // A resolution check that returned nothing judged none of its issues: a failed call, not a stalled skeleton.
    const unjudged = checks.find((c) => c?.r.result === null);
    if (unjudged) return { status: "failed", stop: result("failed", { reason: `skeleton resolution ${unjudged.lane.id} (${unjudged.lane.lens})${unjudged.r.reason ? `: ${unjudged.r.reason}` : " returned nothing"}; open issues ${unjudged.open.map((i) => i.id).join(", ")} not judged`, issues: unjudged.open }) };
    passCounts.push(openIssues().length);
    if (openBlockers().length >= startBlockers) return { status: "needs-owner", stop: owner("Skeleton review", `stalled: ${openBlockers().length} open blockers at pass ${pass} (was ${startBlockers})`, { issues: openBlockers(), options: ["give guidance and rerun", "adjust CONTEXT", "abandon"], answer: answers.context("the open skeleton blockers") }) };
  }
  const blockers = openBlockers();
  if (blockers.length) return { status: "needs-owner", stop: owner("Skeleton review", `${blockers.length} open blockers after ${passCounts.length} passes`, { issues: blockers, options: ["give guidance and rerun", "adjust CONTEXT", "abandon"], answer: answers.context("the open skeleton blockers") }) };
  for (const w of openIssues()) warnings.push(`skeleton ${w.id}${w.plan ? ` (${w.plan})` : ""}: ${w.description}`);
  return { status: "passed" };
}
const cut300 = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 300);
// Kit feedback 64: a skeleton issue is applied once its lane's resolution check confirmed the revision; an open blocker of a
// REVISION_CONFLICT stop is a conflict; a warning of a passed gate and every info note are carried. Confirmed: applied blockers.
function skeletonFindings(gate) {
  const lensOf = (laneId) => lanes.find((l) => l.id === laneId)?.lens ?? null;
  const conflict = isConflict(gate.stop);
  const raised = [...issues.values()].map((i) => {
    const blocking = i.severity === "blocker";
    const fate = i.state === "resolved" ? "applied" : blocking ? (conflict ? "conflict" : "open") : gate.status === "passed" ? "carried" : "open";
    return { id: i.id, plan: i.plan, class: i.dimension || lensOf(i.lane), lane: i.lane, lens: lensOf(i.lane), source: laneIssueIds.has(i.id) ? "lane" : "flow", severity: i.severity, blocking, confirmed: blocking && fate === "applied", fate, description: cut300(i.description) };
  });
  const notes = advisories.filter((x) => lanes.some((l) => l.id === x.lane)).map((x, k) => ({ id: `${x.lane}-info-${k + 1}`, plan: x.plan ?? null, class: lensOf(x.lane), lane: x.lane, lens: lensOf(x.lane), source: "lane", severity: "info", blocking: false, confirmed: false, fate: "carried", description: cut300(x.description) }));
  return [...raised, ...notes];
}
function renderReview(gate) {
  const rows = (list, cols) => list.map((i) => `| ${cols.map((c) => cut300(i[c])).join(" | ")} |`);
  const open = openIssues();
  const resolved = [...issues.values()].filter((i) => i.state === "resolved");
  return [
    `# Phase ${nn} outline review`, "", `Status: ${gate.status}${gate.stop?.reason ? ` (${gate.stop.reason})` : ""}`, "",
    "## Lanes", "", "| lane | lens | model | effort | result |", "| --- | --- | --- | --- | --- |",
    ...lanes.map((l) => `| ${l.id} | ${l.lens} | ${l.resolved?.model ?? "unresolved"} | ${l.resolved?.effort ?? "agent default"} | ${laneFailures.has(l.id) ? `failed: ${cut300(laneFailures.get(l.id) ?? "no reply")}` : "ok"} |`), "",
    "## Passes", "", ...passCounts.map((c, i) => `- pass ${i + 1}: ${c} open`), "",
    "## Open", "", "| id | lane | plan | severity | target | required_property | description | evidence |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows(open, ["id", "lane", "plan", "severity", "target", "required_property", "description", "evidence"]), "",
    "## Resolved", "", "| id | lane | description | evidence |", "| --- | --- | --- | --- |",
    ...rows(resolved, ["id", "lane", "description", "resolution"]), "",
    "## Advisories", "", ...(advisories.length ? advisories.map((x) => `- ${x.lane}${x.plan ? ` ${x.plan}` : ""}: ${cut300(x.description)}`) : ["- none"]), "",
    "## Report", "", "```json", JSON.stringify({ status: gate.status, passes: passCounts, open: open.map((i) => i.id), resolved: resolved.map((i) => i.id) }), "```", "",
  ].join("\n");
}
const docPaths = [OUTLINE, MANIFEST];
async function commitDocs(message, paths) {
  if (!g.commit_policy.docs) return;
  const c = await gsd(["commit", message, "--files", ...paths]);
  if (c.code !== 0) log(`warning: docs commit failed: ${c.json?.error ?? c.stderr ?? c.code}`);
}
// G009: the lanes, their lens texts and the role settings are skeleton-review inputs too; the freeze key covers the outline
// only. They are written here for the skeleton key, which also hashes the reviewer definition.
const laneInputs = { role: { ...g.roles?.skeleton_lane, ...roleOverrides.skeleton_lane }, lanes: [] };
for (const l of lanes) {
  const file = KIT_LENSES.includes(l.lens) ? (await flow(["read", `.agents/workflows/lenses/${l.lens}.md`])).json?.text ?? null : null;
  laneInputs.lanes.push({ id: l.id, lens: l.lens, model: l.model ?? null, effort: l.effort ?? null, text: lensText(l.lens), file });
}
const laneWrite = await flow(["write", P("SKELETON-LANES.json")], JSON.stringify(laneInputs, null, 2));
if (laneWrite.code !== 0) return failedCall("skeleton lane inputs", laneWrite.stderr);

// A skeleton reviewed in this run invalidates every plan written against the old one (GSDF-24).
let skeletonFresh = false;
if ((await gsd(["revisions", "check", phaseDir, "freeze", "--settings", settingsDigest.freeze])).code === 0 && (await gsd(["revisions", "check", phaseDir, "skeleton"])).code === 0 && !a.replan) {
  log("skeleton unchanged since its review passed");
} else {
  skeletonFresh = true;
  const gate = await skeletonGate();
  await gsd(["write", phaseDir, "OUTLINE-REVIEW"], renderReview(gate));
  await prereview("skeleton", skeletonFindings(gate));
  if (gate.status !== "passed") return gate.stop;
  await gsd(["revisions", "record", phaseDir, "freeze", "--settings", settingsDigest.freeze]);
  await gsd(["revisions", "record", phaseDir, "skeleton"]);
  docPaths.push(P("OUTLINE-REVIEW.md"));
  if (await wiringExists()) docPaths.push(WIRING);
  await commitDocs(`docs(${N}): phase ${N} outline and skeleton review`, docPaths);
}

// ---- per-plan planning (GSDF-24, GSDF-25, GSDF-34) ----
phase("Plans");
let frozen = (await gsd(["outline", "parse", N])).json ?? {};
const rows = frozen.rows ?? outline?.rows ?? [];
const planIds = rows.map((r) => r.id);
const manifestOf = (id) => ((manifestFresh ?? frozen.manifest)?.plans ?? []).find((p) => p.id === id) ?? { id };
freezeHash = (await gsd(["revisions", "hash", phaseDir, "freeze", "--settings", settingsDigest.freeze])).json?.hash ?? "none";
const wavesOf = (list) => [...new Set(list.map((r) => Number(r.wave ?? 1)))].sort((x, y) => x - y).map((w) => list.filter((r) => Number(r.wave ?? 1) === w).map((r) => r.id));
const superseded = await gsd(["supersede", phaseDir, "--keep", planIds.join(",")]);
for (const m of superseded.json?.moved ?? []) log(`superseded ${typeof m === "string" ? m : m.from ?? JSON.stringify(m)}`);
const wiringText = (await flow(["read", WIRING])).json?.text ?? "";
const wiringQuotes = (id) => wiringText.split(/\r?\n/).filter((l) => l.includes(id)).slice(0, 40);
// G039: the medium and low plan-review notes gsd-execute reads; the streams flow writes them once, at its join.
const notesPath = `${phaseDir}/plan-review-notes.json`;
streamed = planFlow === "streams" ? await planStreams() : null;
if (streamed?.stop) return streamed.stop;
// A plan with a valid record (unchanged since recorded, on the skeleton it was written on) and a passing structure check is kept: the
// check is returned, else null. Kit feedback 87: in a resumed run, a plan an earlier instance recorded and that changed since (a step
// of this run edited it after its record, e.g. the plan-review editor before the run died) is kept and recorded again, not planned
// again; the checker judges it again since its plans changed.
async function keptPlan(id) {
  const same = (await gsd(["revisions", "check", phaseDir, `plan:${id}`, "--settings", settingsDigest.plan])).code === 0;
  const own = !same && ownRecorded.includes(id);
  const st = !skeletonFresh && (same || own) ? await gsd(["verify", "plan-structure", planPath(id)]) : null;
  if (st?.code !== 0) return null;
  if (own) {
    await recordPlan(id);
    log(`plan ${id} kept: this run changed it after its record before it stopped; recorded again`);
  } else log(`plan ${id} kept: unchanged since recorded`);
  return st;
}
// Wave by wave, the plans without a valid record are written; returns the stop, or null. The checker's reallocation runs it again.
async function stagedWaves() {
  for (const ids of wavesOf(rows)) {
    const todo = [];
    for (const id of ids) {
      const st = await keptPlan(id);
      if (st) setStructureWarnings(id, st.json?.warnings);
      else todo.push(id);
    }
    const outcomes = await parallel(todo.map((id) => () => planOne(id)));
    // G015: the plans that finished are recorded before the batch stops, so a failed sibling does not drop them.
    const recorded = await recordEach(todo.filter((_, i) => outcomes[i]?.ok), false);
    const failed = outcomes.findIndex((o) => !o || o.stop);
    if (failed >= 0) return outcomes[failed]?.stop ?? failedCall(`planner ${todo[failed]}`, null);
    if (recorded) return recorded;
    const contractStop = await contractGate("Plans");
    if (contractStop) return contractStop;
  }
  return null;
}
if (!streamed) {
  const stop = await stagedWaves();
  if (stop) return stop;
}
// O65 (kit-feedback 65): the planner waves keep their order (GSDF-24), but each plan is structure-checked and recorded on its own
// and its review stream (gsd-plan-review with `stream`) starts as soon as its planner returns, never waiting for the other
// plans of its wave. All streams of a wave run at once; the engine queues calls past max_subagents. O67 (kit-feedback 67): the
// next wave's planners start only once every stream of this wave froze, so they are written on reviewed plans, and a frozen
// plan whose interface its stream changed passes the change on to the plans on disk that depend on it.
async function planStreams() {
  const reviews = new Map();
  const planned = new Set();
  const shape = new Map();
  const startReview = async (id) => {
    if (!planReview) return;
    shape.set(id, await planInterface(id));
    reviews.set(id, workflow("gsd-plan-review", { phaseDir, plans: [id], stream: true, roles: roleOverrides, researchPath: approvedResearch, guidance: a.reviewGuidance ?? null, planSettings: settingsDigest.plan }).catch((e) => ({ status: "failed", plan: id, reason: `review stream ${id}: ${e?.message ?? e}` })));
  };
  if (planReview) await flow(["remove", notesPath]);
  let stop = null;
  for (const ids of wavesOf(rows)) {
    const todo = [];
    for (const id of ids) {
      const st = await keptPlan(id);
      if (st) {
        setStructureWarnings(id, st.json?.warnings);
        await startReview(id);
      } else todo.push(id);
    }
    const outcomes = await parallel(todo.map((id) => async () => {
      const o = await planOne(id);
      if (!o?.ok) return o;
      const s = await structureFix(id, `planner:${id}`);
      if (s) return { stop: s };
      await recordPlan(id);
      planned.add(id);
      await startReview(id);
      return { ok: true };
    }));
    const failed = outcomes.findIndex((o) => !o || o.stop);
    if (failed >= 0) { stop = outcomes[failed]?.stop ?? failedCall(`planner ${todo[failed]}`, null); break; }
    if (!planReview) {
      const cs = await contractGate("Plans");
      if (cs) { stop = cs; break; }
      continue;
    }
    // The wave's join: a stream that did not converge stops the run below, before any later wave is planned.
    const frozen = await Promise.all(ids.filter((id) => reviews.has(id)).map((id) => reviews.get(id)));
    if (frozen.some((r) => r?.status !== "converged")) break;
    // Kit feedback 67: no stream of this wave edits a plan now, so the contract gate may revise any plan on disk; what it changes
    // is passed on to the dependents below like a stream's edit.
    const cs = await contractGate("Plans");
    if (cs) { stop = cs; break; }
    const changed = new Map();
    for (const id of ids) {
      const now = await planInterface(id);
      if (shape.has(id) && !sameInterface(shape.get(id), now)) changed.set(id, { before: shape.get(id), after: now });
    }
    const dep = await propagate(changed);
    if (dep) { stop = dep; break; }
  }
  const ids = planIds.filter((id) => reviews.has(id));
  const done = await Promise.all(ids.map((id) => reviews.get(id)));
  const reviewOf = new Map(ids.map((id, i) => [id, done[i]]));
  for (const [id, r] of reviewOf) log(`plan stream ${id}: review ${r?.status ?? "failed"}${r?.cycles ? ` after ${r.cycles} cycles` : ""}`);
  flowReport = { planFlow: "streams", streams: planIds.map((id) => {
    const r = reviewOf.get(id);
    return { plan: id, planned: planned.has(id), review: r ? r.status ?? "failed" : planReview ? "not started" : "off", cycles: r?.cycles ?? 0, counts: r?.counts ?? [] };
  }), dependents };
  const bad = ids.map((id) => reviewOf.get(id)).find((r) => r?.status !== "converged");
  if (stop && !bad) return { stop: { ...stop, ...flowReport } };
  if (bad) {
    const s = { stage: "Plan review", plan: bad.plan ?? null, reason: bad.reason ?? "plan review did not converge", issues: bad.issues ?? [], conflict: bad.conflict ?? null, counts: bad.counts ?? [] };
    return { stop: bad.status === "needs-owner" ? result("needs-owner", { ...s, options: ["give reviewGuidance and rerun", "record the decision in CONTEXT and rerun", "disable plan review (planReview false) and rerun"], answer: answers.guidance() }) : result("failed", s) };
  }
  if (planReview) {
    const notes = ids.flatMap((id) => reviewOf.get(id).issues ?? []);
    await flow(["write", notesPath], JSON.stringify(notes.map(({ plan, severity, description }) => ({ plan, severity, description })), null, 2));
    for (const r of done) for (const st of r.structure ?? []) setStructureWarnings(st.plan, st.warnings);
    advisories.push(...notes.map((x) => ({ lane: "plan-review", plan: x.plan ?? null, severity: x.severity, description: x.description })));
  }
  return { ok: true };
}
// O67 (kit-feedback 67): the surface other plans build on: the artifacts and key_links of must_haves and the <interfaces> blocks.
async function planInterface(id) {
  const mh = (await gsd(["frontmatter", "get", planPath(id), "must_haves"])).json?.value ?? {};
  const text = (await flow(["read", planPath(id)])).json?.text ?? "";
  return { artifacts: mh.artifacts ?? [], key_links: mh.key_links ?? [], interfaces: [...text.matchAll(/<interfaces>([\s\S]*?)<\/interfaces>/g)].map((m) => m[1].trim()) };
}
function sameInterface(x, y) { return JSON.stringify(x) === JSON.stringify(y); }
// O67: every plan on disk whose depends_on names a changed plan gets one dependent stream for all its changed providers, all
// dependents at once (each plan edited only by its own stream); a dependent whose own interface changed passes it on. The
// depends_on graph has no cycle, so the rounds end. Returns the first stop, or null.
async function propagate(changed) {
  try {
    return await propagateRounds(changed);
  } finally {
    if (depLedger.ran) await prereview("checker", (await partView(depLedger.name))?.findings ?? [], "dependents");
  }
}
async function propagateRounds(changed) {
  while (changed.size) {
    const index = (await gsd(["phase-plan-index", N])).json?.plans ?? [];
    const providersOf = new Map();
    for (const p of index) {
      const from = (p.depends_on ?? []).filter((d) => changed.has(d));
      if (from.length && planIds.includes(p.id)) providersOf.set(p.id, from);
    }
    if (!providersOf.size) return null;
    log(`plan interfaces changed: ${[...changed.keys()].join(", ")}; checking ${[...providersOf.keys()].join(", ")}`);
    const list = [...providersOf];
    const k = ++depRounds;
    const outs = await parallel(list.map(([id, from]) => () => dependentStream(id, from.map((plan) => ({ plan, path: planPath(plan), ...changed.get(plan) })), `${k}:${id}`)));
    const next = new Map();
    for (const [i, o] of outs.entries()) {
      if (!o || o.stop) return o?.stop ?? failedCall(`dependent stream ${list[i][0]}`, null);
      if (o.changed) next.set(list[i][0], o.changed);
    }
    changed = next;
  }
  return null;
}
// O67: a read-only dependency check of one plan against its providers' interface before and after their revision; its
// blockers go to the plan's own planner session, and the check runs again while its count falls (cap maxCheckIterations; the
// dependents part of plan-progress.json keeps the count, the findings and what each stream did).
async function dependentStream(id, providers, stream) {
  const before = await planInterface(id);
  for (let round = 1; ; round++) {
    const prompt = [
      `Dependency check, read-only, of ${planPath(id)} after a revision of the plans it depends on: ${providers.map((p) => p.path).join(", ")}.`,
      `Their declared interface before and after the revision (JSON): ${JSON.stringify(providers)}`,
      "Read the providers as they are now. Return JSON {issues: [{plan, dimension, severity (blocker|warning|info), required_property, description, fix_hint}]}: one blocker for each place this plan still uses a name, signature, parameter, path or link the revision renamed, changed or removed; an empty list when it matches the providers as they are now.",
      POLICY,
      digestLine("freeze", freezeHash),
      digestLine(`plan:${id}`, (await gsd(["revisions", "hash", phaseDir, `plan:${id}`])).json?.hash ?? "none"),
    ].join("\n\n");
    const opts = { label: `depcheck-${id}-${round}`, agentType: agentFor("checker", "gsd-plan-checker"), readOnly: true, schema: ISSUES_SCHEMA, judges: await plansJudges([id, ...providers.map((p) => p.plan)]), ...roleOpts("checker") };
    depLedger.ran = true;
    let c = await call(prompt, opts);
    if (c.result === null && !fatal(c.reason)) c = await call(prompt, opts);
    if (c.result === null) return { stop: failedCall(`dependency check ${id}`, c.reason) };
    // Kit feedback 64: a blocker of an earlier round that this check no longer raises was resolved by the revision.
    const [d] = await depLedger.step(`dep:${stream}:${round}`, [{ op: "dep", plan: id, stream, round, providers: providers.map((p) => p.plan), issues: c.result.issues ?? [], cap: maxCheckIterations }]);
    const open = d.open;
    dependents.splice(0, dependents.length, ...d.dependents);
    if (!open.length) {
      const after = await planInterface(id);
      return { changed: sameInterface(before, after) ? null : { before, after } };
    }
    if (d.stuck) {
      return { stop: owner("Dependents", `${id} still uses the old interface of ${providers.map((p) => p.plan).join(", ")} after ${round - 1} revisions (${open.length} blockers)`, { plan: id, issues: open, options: ["give guidance and rerun", "revise the plan by hand, then rerun", "abandon"], answer: answers.fix(`revise ${planPath(id)} to the providers' interface by hand and record it (ph gsd revisions record ${N} plan:${id})`) }) };
    }
    const r = await plannerCall(`planner:${id}`, `deprevise-${id}-${round}`, [planningContext("revision"), revisionContext([planPath(id)], open, await contractBlock([id]))].join("\n\n"), "freeze", freezeHash, { judges: await plansJudges([id]) });
    if (isConflict(r.result)) await depLedger.step(`dep:${stream}:${round}:conflict`, [{ op: "conflict", plans: [id] }]);
    if (ownerMarker(r.result)) return { stop: ownerStop("Dependents", r.result) };
    if (r.result === null) return { stop: failedCall(`dependent revision ${id}`, r.reason) };
    const s = await recordEach([id], false);
    if (s) return { stop: s };
  }
}
// Kit feedback 67 F1: the planner writes each produced signature as the manifest has it and quotes each consumed one in <interfaces>.
// The key_links `requires`/`provides` entries state the preconditions (kit feedback 76).
async function contractPlanText(id) {
  if (!contractsOn) return "";
  const s = (await gsd(["contracts", "show", N, "--plan", id])).json;
  const mine = (s?.produces ?? []).filter((p) => p.structured).map(({ symbol, kind, file, signature }) => ({ symbol, kind, file, signature }));
  const used = (s?.consumes ?? []).filter((c) => c.entry).map((c) => ({ plan: c.plan, ...c.entry }));
  return [
    mine.length ? `Contract: this plan produces (write each signature verbatim in the plan and in <interfaces>; never re-describe or change it): ${JSON.stringify(mine)}` : "",
    used.length ? `Contract: this plan consumes (quote each signature verbatim in <interfaces>; call it only as written there): ${JSON.stringify(used)}` : "",
    "If this plan needs an ancestor widget, a provider override or a registration that another plan provides, list it in must_haves.key_links as `- requires: {kind: ancestor_widget|provider_override|registration, name: <name>, by: <plan id>}`; a plan that mounts or registers one lists `- provides: {kind: ..., name: ..., at: <file>}`. The provider is in the same or an earlier wave.",
  ].filter(Boolean).join("\n");
}
async function planOne(id) {
  // F40 (kit-feedback 40): forceProceed never accepts a plan a planner of this run wrote (plan lifecycle in plan-progress.json).
  const marked = await flow(["plan-mark", phaseDir], { run: runId, plans: [id], stage: "planned" });
  if (marked.code !== 0) return { stop: result("failed", { reason: `plan state: ${marked.json?.reason ?? marked.json?.error ?? `exit ${marked.code}`}` }) };
  const entry = manifestOf(id);
  const carried = warnings.filter((w) => w.includes(`(${id})`));
  const body = [
    planningContext("standard"),
    SPECLESS,
    `Write ${planPath(id)} for plan ${id} only.`,
    `Frozen manifest entry (${MANIFEST}): ${JSON.stringify(entry)}`,
    `owns (repeat exactly in the plan frontmatter): ${JSON.stringify(entry.owns ?? [])}`,
    wiringText ? `WIRING declarations for ${id} (verbatim from ${WIRING}):\n${wiringQuotes(id).map((l) => `> ${l}`).join("\n") || "> (none name this plan)"}` : "No WIRING contract for this phase.",
    carried.length ? `Open skeleton warnings for this plan:\n${carried.map((w) => `- ${w}`).join("\n")}` : "",
    await contractPlanText(id),
  ].filter(Boolean).join("\n\n");
  const { result: r, reason } = await plannerCall(`planner:${id}`, `plan-${id}`, body, "freeze", freezeHash, { judges: await plansJudges([id]) });
  if (fatal(reason)) return { stop: failedCall(`planner ${id}`, reason) };
  if (ownerMarker(r)) return { stop: ownerStop("Plan", r) };
  if (!knownMarker(r)) {
    const onDisk = (await flow(["exists", planPath(id)])).json?.exists?.[planPath(id)];
    if (!onDisk) return { stop: owner("Plan", `planner for ${id} returned no recognised marker and wrote no plan (inconclusive)`, { options: ["rerun", "adjust CONTEXT", "abandon"], answer: answers.rerun("") }) };
    log(`planner ${id}: no recognised marker; the structure check decides`);
  }
  return { ok: true };
}
// Plan-structure warnings do not block (plan-checks.mjs:78); they reach the checker and the result like the other warnings.
// A check replaces the warnings of its plan: they describe the plan file as it stands after that check.
function setStructureWarnings(id, list) {
  const prefix = `plan-structure (${id}): `;
  for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i].startsWith(prefix)) warnings.splice(i, 1);
  for (const w of list ?? []) warnings.push(`${prefix}${typeof w === "string" ? w : JSON.stringify(w)}`);
}
async function structureFix(id, session) {
  let st = await gsd(["verify", "plan-structure", planPath(id)]);
  setStructureWarnings(id, st.json?.warnings);
  if (st.code === 0) return null;
  const errors = st.json?.errors ?? [st.json?.error ?? `exit ${st.code}`];
  const { result: r, reason } = await plannerCall(session, `fix-${id}`, `Fix ${planPath(id)} in place. verify plan-structure reported exactly these errors:\n${errors.map((e) => `- ${typeof e === "string" ? e : JSON.stringify(e)}`).join("\n")}`, "freeze", freezeHash, { judges: await plansJudges([id]) });
  if (fatal(reason)) return failedCall(`structure fixer ${id}`, reason);
  if (ownerMarker(r)) return ownerStop("Plan", r);
  st = await gsd(["verify", "plan-structure", planPath(id)]);
  setStructureWarnings(id, st.json?.warnings);
  return st.code === 0 ? null : result("failed", { reason: `plan ${id} still fails verify plan-structure`, errors: st.json?.errors ?? [] });
}
// A plan's record: its revisions key with the planner's settings, and its mark in plan-progress.json (kit feedback 87: a resumed run
// keeps a plan this run recorded).
async function recordPlan(id) {
  await gsd(["revisions", "record", phaseDir, `plan:${id}`, "--settings", settingsDigest.plan]);
  const m = await flow(["plan-mark", phaseDir], { run: runId, plans: [id], stage: "recorded" });
  if (m.code !== 0) log(`warning: plan ${id} mark not written: ${m.json?.reason ?? m.json?.error ?? `exit ${m.code}`}`);
}
// G015: each plan is recorded once its own structure check passes, so one plan's stop does not drop its finished siblings.
async function recordEach(ids, gapScoped) {
  let stop = null;
  for (const id of ids) {
    const s = await structureFix(id, gapScoped ? "planner:gaps" : `planner:${id}`);
    if (s) stop ??= s;
    else if (!gapScoped) await recordPlan(id);
  }
  return stop;
}

// ---- checker loop (GSDF-26..28) ----
phase("Checker");
let checked = null;
for (let again = 0; ; again++) {
  checked = streamed ? await checkerJoin(planIds) : await checkerLoop(planIds, false, again ? `reallocated-${again}` : undefined);
  if (!checked.reallocate) break;
  // Kit feedback 69: plans the checker could only fix by a new allocation go back to the outline stage, then to the checker again.
  phase("Outline");
  const back = await reallocateStage(checked.reallocate);
  if (back.stop) return back.stop;
  phase("Checker");
}
if (checked.stop) return checked.stop;
{
  const contractStop = await contractGate("Checker");
  if (contractStop) return contractStop;
}
if (!checked.skipped) {
  await gsd(["revisions", "record", phaseDir, "checked", "--settings", settingsDigest.checked]);
  if (recheckMode === "incremental") await gsd(["revisions", "record", phaseDir, "checkedbody"]);
}
docPaths.push(...planIds.map(planPath));

// ---- optional plan review (GSDF-37) ----
if (planReview && !streamed) {
  phase("Plan review");
  const pr = await workflow("gsd-plan-review", { phaseDir, plans: planIds, roles: roleOverrides, researchPath: approvedResearch, guidance: a.reviewGuidance ?? null, planSettings: settingsDigest.plan });
  if (pr?.status !== "converged") {
    const stop = { stage: "Plan review", reason: pr?.reason ?? "plan review did not converge", issues: pr?.issues ?? [], conflict: pr?.conflict ?? null, counts: pr?.counts ?? [] };
    // The owner answers here and reruns: reviewGuidance goes to the review prompts, a CONTEXT decision is read by them too.
    return pr?.status === "failed" ? result("failed", stop) : result("needs-owner", { ...stop, options: ["give reviewGuidance and rerun", "record the decision in CONTEXT and rerun", "disable plan review (planReview false) and rerun"], answer: answers.guidance() });
  }
  for (const s of pr.structure ?? []) setStructureWarnings(s.plan, s.warnings);
  advisories.push(...(pr.issues ?? []).map((x) => ({ lane: "plan-review", plan: x.plan ?? null, severity: x.severity, description: x.description })));
  const contractStop = await contractGate("Plan review");
  if (contractStop) return contractStop;
}

// ---- coverage and handoff (GSDF-29, GSDF-36) ----
phase("Handoff");
return await handoffStage(planIds, docPaths, checked.override);

async function countProbes(scopeIds, gapScoped) {
  const plansFlag = gapScoped ? ["--plans", scopeIds.join(",")] : [];
  const runs = [
    ["verify-command-paths", await gsd(["check", "verify-command-paths", N, ...plansFlag]), "warning"],
    ["verify-failure-directions", await gsd(["check", "verify-failure-directions", N, ...plansFlag]), "warning"],
    ["owns", await gsd(["check", "owns", N, ...plansFlag]), "blocker"],
  ];
  const found = [];
  for (const [probe, r, defaultSev] of runs) {
    if (r.code === 69) { found.push({ probe, severity: "warning", description: `${probe} could not look: ${r.json?.reason ?? r.json?.error ?? "exit 69"}` }); continue; }
    const items = ["commands", "probes", "findings", "problems", "errors", "issues"].flatMap((k) => (Array.isArray(r.json?.[k]) ? r.json[k] : []));
    for (const it of items) {
      const sev = String(probe === "owns" ? "blocker" : it.severity ?? defaultSev).toLowerCase();
      if (["none", "ok", "info", ""].includes(sev)) continue;
      found.push({ probe, plan: it.plan ?? null, severity: sev === "warning" ? "warning" : "blocker", description: typeof it === "string" ? it : it.detail ?? it.message ?? it.description ?? JSON.stringify(it) });
    }
  }
  if (reallocRounds && !gapScoped) found.push(...filesPerPlanProbes(runs[2][1].json));
  return found;
}
// Kit feedback 69: the Files/plan lines judged here, not by the checker agent, when plans may be sent back to the outline: a plan at the
// blocker line is a blocker whose only fix is a new allocation (outcome reallocate).
function filesPerPlanProbes(owns) {
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
// One fresh read-only checker over the plans `live` (GSDF-26), with the probe file and the still-open blockers `earlier`;
// a null reply is retried once. In the streams flow the carried warnings are sorted, so the order in which the plan streams
// finished does not change the prompt a resumed run replays.
async function checkerCall(iter, live, scopeIds, gapScoped, probeFile, earlier, judged = scopeIds) {
  const carriedText = streamed ? [...warnings].sort() : warnings;
  const sendBack = reallocRounds > 0 && !gapScoped;
  // The Files/plan thresholds grow with the phase's files, so the checker judges them against this phase's plans.
  const filesPerPlan = sendBack ? null : (await gsd(["check", "owns", N])).json?.files_per_plan;
  const prompt = [
    `Check the plans of phase ${N} read-only: ${live.map(planPath).join(", ")}.`,
    planningContext(gapScoped ? "gap_closure" : "standard"),
    filesPerPlan ? `Files per plan: warning at ${filesPerPlan.warning}+, blocker at ${filesPerPlan.blocker}+ (use these for the Files/plan thresholds).` : "",
    filesPerPlan && tracerExtraFiles ? `Tracer files per plan (a plan with a type="tracer" task): warning at ${filesPerPlan.warning + tracerExtraFiles}+, blocker at ${filesPerPlan.blocker + tracerExtraFiles}+.` : "",
    sendBack ? `Files per plan is judged by a deterministic probe (${probeFile}): do not raise a Files/plan issue. Give an issue "outcome": "reallocate" only when its only fix is a different split of the owned paths between plans (the plan's owns, which a revision of the plan cannot change); every other issue has outcome "revise".` : "",
    `Deterministic probe results are in ${probeFile}: they are already counted; do not re-derive them, do not repeat them as issues.`,
    carriedText.length ? `Carried warnings:\n${carriedText.map((w) => `- ${w}`).join("\n")}` : "",
    earlier.length ? `Blockers from earlier checker iterations, still open? Judge each against the plans as they are now. Repeat it in issues (same plan, dimension and required_property) while it holds; list its id in resolved, with evidence, once it is fixed. An id you do not list stays open.\n${JSON.stringify(earlier.map(({ id, plan, dimension, required_property, description, fix_hint }) => ({ id, plan, dimension, required_property, description, fix_hint })))}` : "",
    "Return JSON {issues: [{plan (null for phase-level), dimension, severity (blocker|warning|info), required_property (the invariant that must hold), description (the evidence it does not), fix_hint}], resolved: [{id, evidence}] (only ids of the still-open blockers above)}.",
    POLICY,
    digestLine("freeze", freezeHash),
    // The checker judges PLAN contents, which the freeze key does not cover (CR-GSF-19).
    digestLine("checked", (await gsd(["revisions", "hash", phaseDir, "checked", "--settings", settingsDigest.checked])).json?.hash ?? "none"),
  ].filter(Boolean).join("\n\n");
  const opts = { label: `checker-${iter}`, agentType: agentFor("checker", "gsd-plan-checker"), readOnly: true, schema: sendBack ? CHECKER_SCHEMA_REALLOC : CHECKER_SCHEMA, judges: await plansJudges(judged), ...roleOpts("checker") };
  let c = await call(prompt, opts);
  if (c.result === null && !fatal(c.reason)) c = await call(prompt, opts);
  return c;
}
// A checker reply's non-info issues, severity warning or blocker (unknown = blocker); info goes to the advisories.
function checkerFindings(c) {
  const out = [];
  for (const i of c.result.issues ?? []) {
    if (String(i.severity).toLowerCase() === "info") advisories.push({ lane: "checker", plan: i.plan ?? null, description: i.description });
    else out.push({ ...i, severity: String(i.severity).toLowerCase() === "warning" ? "warning" : "blocker" });
  }
  return out;
}
// Kit feedback 64: the checker's findings are recorded when the loop ends (pass, stop or failure), if a checker ran.
// Kit feedback 69: a checker that ran after a reallocation is its own record (`part`), the first one is kept.
async function checkerLoop(scopeIds, gapScoped, part) {
  const ledger = checkerPart(gapScoped ? "gaps" : part ? `checker:${part}` : "checker");
  try {
    return await checkerRounds(scopeIds, gapScoped, ledger);
  } finally {
    if (ledger.ran) await prereview("checker", (await partView(ledger.name))?.findings ?? [], part);
  }
}
async function checkerRounds(scopeIds, gapScoped, ledger) {
  if (!gapScoped && !a.replan && (await gsd(["revisions", "check", phaseDir, "checked", "--settings", settingsDigest.checked])).code === 0) {
    log("checker skipped: plans unchanged since the last passing check");
    return { skipped: true };
  }
  // Kit feedback 76: after a plan edit the checker agent judges the changed plans and the plans linked to them (null = all plans).
  const scope = gapScoped ? null : await recheckScope(scopeIds, ledger.name);
  let agentScope = scope ? scope.agent : scopeIds;
  // The cap and the stall test count per plan (kit-feedback 9): a plan that stops converging leaves the loop as stuck, and the other
  // plans keep being checked and revised until they pass or get stuck too; blockers with no plan use key null. The round op of the
  // loop's part keeps the counts, the stuck plans, the warnings each plan carries, and the checker blockers no checker confirmed
  // resolved (kit-feedback 44): `earlier` goes back into the next checker prompt as "still open?" and leaves the count only when a
  // checker lists its id in `resolved`, never because a checker went silent.
  let earlier = [];
  let stuckKeys = [];
  for (let iter = 1; ; iter++) {
    // Kit feedback 67 F2: a CONTRACT_CHANGE of the last round has its consumers revised before the checker reads them again.
    if (contractDirty && !gapScoped) {
      const contractStop = await contractGate("Checker");
      if (contractStop) return { stop: contractStop };
    }
    const live = scopeIds.filter((id) => !stuckKeys.includes(id) && agentScope.includes(id));
    const probeIssues = await countProbes(scopeIds, gapScoped);
    const probeFile = `${phaseDir}/checker-probes.json`;
    await flow(["write", probeFile], JSON.stringify({ iteration: iter, probes: probeIssues }, null, 2));
    // Kit feedback 69: a probe that says reallocate ends the round before the checker agent is paid for.
    const sendBack = reallocLeft > 0 ? (await ledger.step(`i${iter}:sendback`, [{ op: "accept", list: probeIssues.filter((i) => wantsReallocation(i, scopeIds)), scope: scopeIds }]))[0].list : [];
    if (sendBack.length) return { reallocate: sendBack };
    let c = { result: { issues: [], resolved: [] } };
    if (!scope || live.length || earlier.length) {
      ledger.ran = true;
      c = await checkerCall(iter, live, scopeIds, gapScoped, probeFile, earlier, scope ? agentScope : scopeIds);
      if (c.result === null) return { stop: failedCall("plan checker", c.reason) };
    } else log(`checker iteration ${iter}: no plan for the checker agent (a write-set edit only); the probes ran on all ${scopeIds.length} plans`);
    const checkerIssues = checkerFindings(c);
    // Only blockers drive the stall test, the cap and the revisions; warnings are carried into the result (kit-feedback 13, 20). A blocker
    // forceProceed names is accepted, never counted, revised or carried (kit feedback 71).
    const [r] = await ledger.step(`i${iter}`, [{ op: "round", scope: scopeIds, live, resolved: (c.result.resolved ?? []).map((x) => x.id), issues: c.result.issues ?? [], checkerIssues, probes: probeIssues, cap: maxCheckIterations, reallocate: reallocLeft > 0 }]);
    log(`checker iteration ${iter}: ${checkerIssues.length} checker + ${probeIssues.length} probe issues, ${r.blockers} blockers (${r.confirmed} of ${r.earlier} earlier blockers confirmed resolved)`);
    if (r.reallocate.length) return { reallocate: r.reallocate };
    for (const x of r.newlyStuck) log(`checker: ${x.key ?? "phase"} left the loop: ${x.why}`);
    earlier = r.next;
    stuckKeys = r.stuck.map((x) => x.key);
    const revise = new Map(r.revise);
    if (!revise.size) break;
    // Every plan is stuck, so no plan is left to revise and the open phase-level issues stop with them.
    if (scopeIds.every((id) => stuckKeys.includes(id))) {
      await ledger.step(`i${iter}:stuck-all`, [{ op: "stuck-all" }]);
      break;
    }
    const perPlan = [...revise].filter(([key]) => key !== null);
    const phaseLevel = revise.get(null) ?? [];
    const revised = await parallel(perPlan.map(([id, list]) => async () => plannerCall(gapScoped ? "planner:gaps" : `planner:${id}`, `revise-${id}-${iter}`, [planningContext("revision"), revisionContext([planPath(id)], list, await contractBlock([id]))].join("\n\n"), "freeze", freezeHash, { judges: await plansJudges([id]) })));
    // G015: each revision that answered is fixed and recorded when it returns, so an owner or failed stop of a sibling does not drop it.
    // A revision that returned nothing or stopped for an owner is never recorded as revised (G008).
    const answered = perPlan.filter((_, i) => revised[i] && revised[i].result !== null && !ownerMarker(revised[i].result)).map(([id]) => id);
    const stop = await recordEach(answered, gapScoped);
    if (scope) agentScope = [...new Set([...agentScope, ...answered, ...(await linkedPlans(answered, scopeIds))])];
    // kit-feedback 37: a REVISION_CONFLICT on one plan does not skip the phase-level issues. Their revision still runs, and the
    // conflict stops the loop after it, so the owner's answer reruns a phase whose other revisions are recorded.
    const owned = revised.find((x) => ownerMarker(x?.result));
    const conflict = owned ? ownerStop("Checker", owned.result) : null;
    const conflicted = perPlan.filter((_, i) => isConflict(revised[i]?.result)).map(([id]) => id);
    if (conflicted.length) await ledger.step(`i${iter}:conflict`, [{ op: "conflict", keys: conflicted }]);
    // A revision that returned nothing is not a finished revision: stop with its reason; the plan is never recorded as revised.
    const missed = revised.findIndex((x) => !x || x.result === null);
    if (!conflict && missed !== -1) return { stop: failedCall(`planner revision ${perPlan[missed][0]} (checker iteration ${iter})`, revised[missed]?.reason ?? null) };
    if (!conflict && stop) return { stop };
    if (phaseLevel.length) {
      const p = await plannerCall(gapScoped ? "planner:gaps" : "planner:outline", `revise-phase-${iter}`, [planningContext("revision"), revisionContext(scopeIds.map(planPath), phaseLevel, await contractBlock(scopeIds))].join("\n\n"), "freeze", freezeHash, { judges: await plansJudges(scopeIds) });
      if (isConflict(p.result)) await ledger.step(`i${iter}:phase-conflict`, [{ op: "conflict", keys: [null] }]);
      if (ownerMarker(p.result)) return { stop: conflict ?? ownerStop("Checker", p.result) };
      if (p.result === null) return { stop: conflict ?? failedCall(`phase-level planner revision (checker iteration ${iter})`, p.reason) };
      // The phase-level revision can change any plan, so every plan is checked and recorded again.
      agentScope = scopeIds;
      const s = await recordEach(scopeIds, gapScoped);
      if (s) return { stop: conflict ?? s };
    }
    if (conflict) return { stop: conflict };
  }
  return settleStuck(ledger, scopeIds);
}
function wantsReallocation(i, scopeIds) { return i.outcome === "reallocate" && i.severity === "blocker" && Boolean(i.plan) && scopeIds.includes(i.plan); }
// The end of a checker loop or join: passed, or the stuck plans as a needs-owner stop or a forceProceed override (GSDF-28). The settle op
// of the part decides what forceProceed may accept and the run writes it to STATE.
// Kit feedback 71: `forceProceed {reason, issues}` accepts only the issues it names ({plan, dimension}); they are taken out of the blockers
// of every round, so the cap and stall tests never count them and no reviser is asked for what the owner accepted. `{reason}` alone keeps
// its meaning: every issue still stuck at the end is accepted. A probe's dimension is its name.
// F40 (kit-feedback 40): forceProceed accepts plans unchecked, so it may not accept a plan this run planned (a planner call, e.g. a
// re-plan after the outline or skeleton changed). Checker revisions of plans the loop already checked do not count. A rerun accepts
// the stuck plan once it is kept and the checker judges it again.
async function settleStuck(ledger, scopeIds) {
  const [s] = await ledger.step("settle", [{ op: "settle", scope: scopeIds }]);
  warnings.push(...s.carried);
  if (s.passed) return { passed: true };
  if (s.stop === "stuck") return { stop: owner("Checker", s.why, { issues: s.issues, options: ["force proceed (rerun with forceProceed {reason})", "give guidance and retry", "abandon"], answer: answers.forceProceed(s.answer) }) };
  // The issues forceProceed {reason, issues} named do not cover a stuck one: the run stops with both lists.
  if (s.stop === "uncovered") return { stop: owner("Checker", s.why, { issues: s.issues, accepted: s.accepted, options: ["rerun with forceProceed {reason, issues} naming these issues too (plan and dimension)", "give guidance and retry", "abandon"], answer: answers.forceProceed(s.answer) }) };
  if (s.stop === "fresh") return { stop: owner("Checker", `forceProceed refused: ${s.plans.join(", ")} written by a planner in this run; a rerun can accept them`, { issues: s.issues, options: ["rerun with forceProceed {reason}", "give guidance and retry", "abandon"], answer: answers.rerun("start a new run (not --resume) with the same forceProceed; the checker judges the kept plans again") }) };
  const saved = await gsd(["state", "override", "--phase", N], { reason: a.forceProceed.reason, issues: s.lines });
  if (saved.code !== 0) return { stop: failedCall("state override failed", saved.json?.error ?? `exit ${saved.code}`) };
  if (s.warnAll) warnings.push("forceProceed without issues accepted every issue still stuck; name them with forceProceed.issues [{plan, dimension}] to accept only those");
  log(`override: ${s.override.why || `${s.override.accepted.length} accepted issues`}; proceeding (${a.forceProceed.reason})`);
  return { passed: true, override: s.override };
}

// Kit feedback 76 F2 (gsd.checker_recheck incremental): after an edit of some plans the checker agent judges those plans and the plans
// linked to them; every deterministic probe still runs on all plans. `revisions check checked` names the plan files that changed since the
// last passing check, `checkedbody` those whose content (not their owns / files_modified) changed. Anything else that changed (outline,
// manifest, wiring, settings, roadmap, a removed plan), a missing record or an unknown part list is a full check (null). The recheck part
// of plan-progress.json sorts the labels and keeps the scope the result reports.
async function recheckScope(scopeIds, part) {
  if (recheckMode !== "incremental" || a.replan) return null;
  const chk = await gsd(["revisions", "check", phaseDir, "checked", "--settings", settingsDigest.checked]);
  const checked = { code: chk.code, changed: chk.json?.changed ?? null };
  const recheck = async (step, op) => (await planStep("plan-recheck", "recheck", `${part}:${step}`, [op]))[0];
  const first = await recheck("labels", { op: "scope", phaseDir, scope: scopeIds, checked });
  if (first.full) { log(`checker: full check (${first.full})`); return null; }
  const body = await gsd(["revisions", "check", phaseDir, "checkedbody"]);
  const { changed, bodyChanged } = await recheck("body", { op: "scope", phaseDir, scope: scopeIds, checked, body: { code: body.code, changed: body.json?.changed ?? null } });
  const linked = await linkedPlans(bodyChanged, scopeIds);
  const agent = scopeIds.filter((id) => bodyChanged.includes(id) || linked.includes(id));
  recheckReport = (await recheck("record", { op: "record", changed, bodyChanged, linked, agent })).recheck;
  log(`checker: incremental recheck: changed ${changed.join(", ")}; content changed ${bodyChanged.join(", ") || "none"}; checker agent on ${agent.join(", ") || "no plan"}; probes on all ${scopeIds.length} plans`);
  return { agent };
}
// The plans a plan edit can affect: depends_on in both directions, manifest consumes edges in both directions, and plans whose write set
// (owns, files_modified) holds an endpoint of the other's must_haves.key_links.
async function linkedPlans(ids, scopeIds) {
  if (!ids.length) return [];
  const linked = new Set();
  for (const p of (await gsd(["phase-plan-index", N])).json?.plans ?? []) {
    const deps = p.depends_on ?? [];
    if (ids.includes(p.id)) deps.forEach((d) => linked.add(d));
    else if (deps.some((d) => ids.includes(d))) linked.add(p.id);
  }
  for (const m of (await gsd(["outline", "parse", N])).json?.manifest?.plans ?? []) {
    const from = (m.consumes ?? []).map((c) => String(c.plan));
    if (ids.includes(String(m.id))) from.forEach((x) => linked.add(x));
    else if (from.some((x) => ids.includes(x))) linked.add(String(m.id));
  }
  const pathOf = (x) => String(x).replace(/^[A-Za-z][\w-]*:(?!\/\/)/, "").split(/[\s#]/)[0].replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const under = (file, entry) => entry !== "" && (file === entry || file.startsWith(`${entry}/`));
  const ends = new Map();
  const sets = new Map();
  for (const id of scopeIds) {
    const mh = (await gsd(["frontmatter", "get", planPath(id), "must_haves"])).json?.value ?? {};
    ends.set(id, (mh.key_links ?? []).flatMap((l) => [l?.from, l?.to]).filter(Boolean).map(pathOf));
    const written = (await gsd(["frontmatter", "get", planPath(id), "files_modified"])).json?.value ?? [];
    sets.set(id, [...(await planOwns(id)), ...written].map(pathOf));
  }
  const reaches = (from, to) => ends.get(from).some((e) => sets.get(to).some((s) => under(e, s)));
  for (const id of ids) for (const other of scopeIds) if (other !== id && (reaches(id, other) || reaches(other, id))) linked.add(other);
  return scopeIds.filter((id) => linked.has(id) && !ids.includes(id));
}

// Kit feedback 69: plans the checker could fix only by a new allocation go back to the outline stage, for those plans only. The outline
// writer changes their owns (the outline check holds the Files/plan lines, so a plan still too large is repaired in that turn), the
// skeleton is reviewed again on the new allocation and recorded, plans that did not change keep their records, and the plans whose
// allocation changed (and new ones) are written again; the caller then runs the checker again over the whole set.
async function reallocateStage(sent) {
  // The realloc part of plan-progress.json counts the rounds this run used; a round is used when it begins.
  const [begun] = await planStep("plan-realloc", "realloc", `r${reallocRounds - reallocLeft + 1}`, [{ op: "begin", rounds: reallocRounds }]);
  const round = begun.round;
  reallocLeft = begun.left;
  const named = [...new Set(sent.map((i) => i.plan))];
  log(`checker: ${named.join(", ")} go back to the outline (reallocation ${round} of ${reallocRounds})`);
  const entryOf = (o, id) => JSON.stringify([(o.manifest?.plans ?? []).find((p) => String(p.id) === id) ?? null, (o.rows ?? []).find((r) => r.id === id) ?? null]);
  const before = (await gsd(["outline", "parse", N])).json ?? {};
  const valid = [];
  for (const id of planIds) if (!named.includes(id) && (await gsd(["revisions", "check", phaseDir, `plan:${id}`, "--settings", settingsDigest.plan])).code === 0) valid.push(id);
  const lines = (await outlineCheck()).json?.files_per_plan;
  const body = [
    planningContext("revision"),
    revisionContext([OUTLINE, MANIFEST], sent.map(({ plan, probe, dimension, description }) => ({ plan, dimension: dimension || probe || "", severity: "blocker", description }))),
    `Reallocation ${round}: the plan checker sent ${named.join(", ")} back to the outline because ${named.length > 1 ? "their" : "its"} owned paths do not fit one plan${lines ? ` (plan size lines: warning at ${lines.warning}+, blocker at ${lines.blocker}+ files)` : ""}. Change only the allocation of ${named.join(", ")} in ${OUTLINE} and ${MANIFEST}: split a named plan into plans with their own ids (new ids after the last existing id, in a wave after the plans they depend on), or move owned paths to another plan that stays under the lines. Every other plan keeps its id, wave, owns, produces and consumes; keep requirement coverage, the tracer and the consumes edges valid, within ${g.plan_limits.plans_per_phase} plans and ${g.plan_limits.waves_per_phase} waves.`,
    `Before you return, run \`node ${PH} gsd ${outlineCheckArgs.join(" ")}\` and repair every error it reports until it exits 0.`,
  ].join("\n\n");
  const { result: r, reason } = await plannerCall("planner:outline", `reallocate-${round}`, body, "inputs", await inputsDigest(), { judges: await outlineJudges() });
  if (fatal(reason) || r === null) return { stop: failedCall("outline reallocation", reason) };
  if (ownerMarker(r)) return { stop: ownerStop("Checker", r) };
  const fixed = await fixOutline(2, "Checker");
  if (fixed.stop) return fixed;
  outline = fixed.check.json;
  const after = (await gsd(["outline", "parse", N])).json ?? {};
  const idsAfter = (after.rows ?? []).map((row) => row.id);
  const changed = idsAfter.filter((id) => entryOf(before, id) !== entryOf(after, id));
  const removed = planIds.filter((id) => !idsAfter.includes(id));
  const unchanged = named.filter((id) => idsAfter.includes(id) && !changed.includes(id));
  if (unchanged.length) return { stop: owner("Checker", `outline reallocation left ${unchanged.join(", ")} unchanged`, { issues: sent, options: ["give guidance and rerun", "rerun with forceProceed {reason, issues: [{plan, dimension: \"files-per-plan\"}]} to accept the size", "abandon"], answer: answers.forceProceed([...new Map(sent.filter((i) => unchanged.includes(i.plan)).map((i) => [`${i.plan}\0${String(i.dimension || i.probe || "").trim().toLowerCase()}`, { plan: i.plan, dimension: String(i.dimension || i.probe || "").trim().toLowerCase() }])).values()]) }) };
  planIds.splice(0, planIds.length, ...idsAfter);
  rows.splice(0, rows.length, ...(after.rows ?? []));
  frozen = after;
  if (wiringInUse && (await wiringExists())) {
    const w = await runArchitect(`architect-reallocate-${round}`, `Reallocation: the allocation of ${changed.join(", ")} changed in the outline; realign ${WIRING} with it.`);
    if (w.stop) return w;
    outlineChangeIssues = w.changes;
  }
  issues.clear();
  passCounts.length = 0;
  laneFailures.clear();
  laneIssueIds.clear();
  skeletonFocus = { named, changed };
  const gate = await skeletonGate();
  skeletonFocus = null;
  await gsd(["write", phaseDir, "OUTLINE-REVIEW"], renderReview(gate));
  await prereview("skeleton", skeletonFindings(gate), `reallocated-${round}`);
  if (gate.status !== "passed") return { stop: gate.stop };
  await gsd(["revisions", "record", phaseDir, "freeze", "--settings", settingsDigest.freeze]);
  await gsd(["revisions", "record", phaseDir, "skeleton"]);
  for (const f of [P("OUTLINE-REVIEW.md"), ...((await wiringExists()) ? [WIRING] : [])]) if (!docPaths.includes(f)) docPaths.push(f);
  freezeHash = (await gsd(["revisions", "hash", phaseDir, "freeze", "--settings", settingsDigest.freeze])).json?.hash ?? "none";
  const moved = await gsd(["supersede", phaseDir, "--keep", planIds.join(",")]);
  for (const m of moved.json?.moved ?? []) log(`superseded ${typeof m === "string" ? m : m.from ?? JSON.stringify(m)}`);
  // The outline moved the freeze key under every plan; the plans that were valid and whose allocation did not change are valid still.
  for (const id of valid) if (idsAfter.includes(id) && !changed.includes(id)) await recordPlan(id);
  skeletonFresh = false;
  const [done] = await planStep("plan-realloc", "realloc", `r${round}:done`, [{ op: "done", round, plans: named, changed, removed, issues: sent.map(({ plan, probe, description }) => ({ plan, ...(probe ? { probe } : {}), description })) }]);
  reallocated.splice(0, reallocated.length, ...done.reallocated);
  const stop = await stagedWaves();
  return stop ? { stop } : { ok: true };
}
// O65 (kit-feedback 65): the streams flow's one join point. The checker reads the frozen set once, with the probes; each plan
// it names gets its blockers back in its own route stream (revision, structure check, record, then this plan's probes and a
// resolution check of only its checker blockers), all plans at once and none waiting for another, under the loop's per-plan
// cap and stall rule (kit-feedback 9). Phase-level blockers get the phase-level revision after the plan streams, so no plan
// has two editors at once; a final probe pass over the whole set closes the join.
// Kit feedback 64: the join's checker findings are recorded when the join ends, as the loop's are. The join part of plan-progress.json
// keeps its bookkeeping: the blockers found, each key's rounds and its cap and stall rule, the stuck keys, the carried warnings.
async function checkerJoin(scopeIds) {
  const ledger = checkerPart("join");
  try {
    return await checkerJoinRounds(scopeIds, ledger);
  } finally {
    if (ledger.ran) await prereview("checker", (await partView(ledger.name))?.findings ?? []);
  }
}
async function checkerJoinRounds(scopeIds, ledger) {
  if (!a.replan && (await gsd(["revisions", "check", phaseDir, "checked", "--settings", settingsDigest.checked])).code === 0) {
    log("checker skipped: plans unchanged since the last passing check");
    return { skipped: true };
  }
  const probeFile = `${phaseDir}/checker-probes.json`;
  const [accepted] = await ledger.step("probes", [{ op: "accept", list: await countProbes(scopeIds, false), scope: scopeIds }]);
  const probes = accepted.list;
  await flow(["write", probeFile], JSON.stringify({ iteration: 1, probes }, null, 2));
  // Kit feedback 76: the one checker call judges the changed plans and the plans linked to them (no call for a write-set edit only).
  const scope = await recheckScope(scopeIds, ledger.name);
  let c = { result: { issues: [], resolved: [] } };
  if (!scope || scope.agent.length) {
    ledger.ran = true;
    c = await checkerCall(1, scope ? scope.agent : scopeIds, scopeIds, false, probeFile, [], scope ? scope.agent : scopeIds);
    if (c.result === null) return { stop: failedCall("plan checker", c.reason) };
  } else log("checker join: no plan for the checker agent (a write-set edit only); the probes ran on all plans");
  const checkerIssues = checkerFindings(c);
  const [{ keys }] = await ledger.step("join", [{ op: "join", scope: scopeIds, issues: c.result.issues ?? [], checkerIssues, probes }]);
  log(`checker join: ${checkerIssues.length} checker + ${probes.length} probe issues, blockers for ${keys.length ? keys.map((k) => k ?? "phase").join(", ") : "no plan"}`);
  // O67: each revised plan's interface before its first join revision, to pass a change on to its dependents.
  const shapeBefore = new Map();
  // One key's stream: its rounds count checker judgments of the key, the first one being the join's checker.
  async function route(key) {
    const name = key ?? "phase";
    for (let round = 1; ; round++) {
      const [g] = await ledger.step(`route:${name}:${round}`, [{ op: "route", key, round, cap: maxCheckIterations }]);
      if (g.stuck) {
        log(`checker: ${name} left the join: ${g.log}`);
        return { stuck: g.stuck };
      }
      const scope = key ? [key] : scopeIds;
      for (const id of scope) if (!shapeBefore.has(id)) shapeBefore.set(id, await planInterface(id));
      const r = await plannerCall(key ? `planner:${key}` : "planner:outline", `revise-${name}-${round}`, [planningContext("revision"), revisionContext(scope.map(planPath), g.open, await contractBlock(scope))].join("\n\n"), "freeze", freezeHash, { judges: await plansJudges(scope) });
      if (isConflict(r.result)) await ledger.step(`route:${name}:${round}:conflict`, [{ op: "conflict", keys: [key] }]);
      if (ownerMarker(r.result)) return { conflict: ownerStop("Checker", r.result) };
      if (r.result === null) return { stop: failedCall(`planner revision ${name} (checker join round ${round})`, r.reason) };
      const s = await recordEach(scope, false);
      if (s) return { stop: s };
      const asked = g.asked;
      let resolved = null;
      if (asked.length) {
        const prompt = [
          `Resolution check, read-only, of plan checker blockers after a revision of ${scope.map(planPath).join(", ")}.`,
          `Blockers (JSON): ${JSON.stringify(asked.map(({ id, plan, dimension, required_property, description, fix_hint }) => ({ id, plan, dimension, required_property, description, fix_hint })))}`,
          "Return JSON {resolved: [{id, evidence}]} listing only the ids the plans now resolve, each with evidence. Do not raise new issues; an id you do not list stays open.",
          POLICY,
          digestLine("freeze", freezeHash),
          digestLine(key ? `plan:${key}` : "checked", (await gsd(["revisions", "hash", phaseDir, key ? `plan:${key}` : "checked"])).json?.hash ?? "none"),
        ].join("\n\n");
        const opts = { label: `recheck-${name}-${round}`, agentType: agentFor("checker", "gsd-plan-checker"), readOnly: true, schema: RESOLUTION_SCHEMA, judges: await plansJudges(scope), ...roleOpts("checker") };
        let v = await call(prompt, opts);
        if (v.result === null && !fatal(v.reason)) v = await call(prompt, opts);
        if (v.result === null) return { stop: failedCall(`plan checker resolution ${name}`, v.reason) };
        resolved = (v.result.resolved ?? []).map((x) => x.id);
      }
      // The blockers the resolution check did not confirm, then this key's probe blockers.
      const [d] = await ledger.step(`route:${name}:${round}:done`, [{ op: "route-done", key, resolved, probes: await countProbes(scopeIds, false) }]);
      log(`checker join: ${name} round ${round}: ${d.open.length} blockers open`);
      if (!d.open.length) return { passed: true };
    }
  }
  const perPlan = keys.filter((k) => k !== null);
  const routed = await parallel(perPlan.map((id) => () => route(id)));
  const stuckPlans = perPlan.filter((_, i) => routed[i]?.stuck);
  if (stuckPlans.length) await ledger.step("stuck", stuckPlans.map((id) => ({ op: "stuck", key: id, ...routed[perPlan.indexOf(id)].stuck })));
  // As the loop (kit-feedback 37): a REVISION_CONFLICT on one plan still lets the phase-level blockers get their revision.
  const conflict = routed.find((r) => r?.conflict)?.conflict ?? null;
  const missed = routed.findIndex((r) => !r || r.stop);
  if (!conflict && missed !== -1) return { stop: routed[missed]?.stop ?? failedCall(`checker join stream ${perPlan[missed]}`, null) };
  if (keys.includes(null)) {
    if (scopeIds.every((id) => stuckPlans.includes(id))) await ledger.step("stuck:phase", [{ op: "stuck", key: null, why: "phase: no plan left to revise", join: true }]);
    else {
      const r = await route(null);
      if (r.conflict || r.stop) return { stop: conflict ?? r.conflict ?? r.stop };
      if (r.stuck) await ledger.step("stuck:phase", [{ op: "stuck", key: null, ...r.stuck }]);
    }
  }
  if (conflict) return { stop: conflict };
  const changed = new Map();
  for (const [id, before] of shapeBefore) {
    const after = await planInterface(id);
    if (!sameInterface(before, after)) changed.set(id, { before, after });
  }
  const dep = await propagate(changed);
  if (dep) return { stop: dep };
  // The final probe pass sees every revision together; a probe blocker left over is stuck with its plan.
  const [f] = await ledger.step("final", [{ op: "final", probes: await countProbes(scopeIds, false) }]);
  await flow(["write", probeFile], JSON.stringify({ iteration: "final", probes: f.last }, null, 2));
  warnings.push(...f.warnings);
  const stuckNow = f.stuck.map((x) => x.key);
  if (flowReport) flowReport.streams = flowReport.streams.map((st) => ({ ...st, checkerRounds: f.rounds[st.plan] ?? 0, checker: stuckNow.includes(st.plan) ? "stuck" : Object.hasOwn(f.rounds, st.plan) ? "resolved" : "clean" }));
  return settleStuck(ledger, scopeIds);
}

async function handoffStage(ids, docs, override, handoffArgs = [], gap = null) {
  // Kit feedback 67 F3: the last contract check, with every manifest plan written. Gap plans have no manifest entry.
  if (!gap) {
    const contractStop = await contractGate("Handoff", { complete: true });
    if (contractStop) return contractStop;
  }
  const cov = await gsd(["check", "coverage", N]);
  if (cov.code !== 0) return owner("Handoff", "coverage gate failed", { coverage: cov.json, options: ["re-plan (recommended)", "move the requirement or decision to a later phase", "tag the decision informational"], answer: answers.args({ replan: true }, "re-plan the phase so every requirement and decision is covered") });
  // G022: with adapter.dependency_probe, the dependencies the plans declare must resolve together before the handoff writes waves.
  if (cfg.adapter.dependency_probe) {
    phase("Dependencies");
    const dep = await gsd(["check", "dependencies", N, "--plans", ids.join(",")]);
    phase(gap ? "Gaps" : "Handoff");
    if (dep.code !== 0) return owner("Dependencies", dep.json?.reason ?? `dependency check exit ${dep.code}`, { output: dep.json?.output ?? null, dependencies: dep.json?.dependencies ?? [], options: ["edit the dependency lines of the plans or the probe, then rerun", "give guidance and rerun with replan", "abandon"], answer: answers.fix("edit the `<path>: dependency` lines of the plans (or the probe) until the dependencies resolve together") });
  }
  const h = await gsd(["handoff", N, ...handoffArgs]);
  if (h.code !== 0) return result("failed", { reason: `handoff refused: ${h.json?.error ?? h.json?.errors?.join?.("; ") ?? h.code}`, errors: h.json?.errors ?? [] });
  for (const w of h.json?.warnings ?? []) warnings.push(`handoff: ${typeof w === "string" ? w : JSON.stringify(w)}`);
  if (gap && (h.json?.waves ?? []).length !== 1) return owner("Gaps", `gap handoff has ${(h.json?.waves ?? []).length} execution waves; gap closure is one wave`, { options: ["re-plan the gaps as independent plans", "plan a new phase", "abandon"], answer: answers.rerun("remove the gap plans that need a second wave") });
  await gsd(["revisions", "record", phaseDir, "handoff"]);
  const total = ((await gsd(["phase-plan-index", N])).json?.plans ?? []).length || ids.length;
  await gsd(["state", "planned-phase", "--phase", N, "--plans", String(total)]);
  await gsd(["roadmap", "annotate-dependencies", N]);
  await commitDocs(`docs(${N}): ${gap ? "gap-closure plans" : "plans"} for phase ${N}`, [...docs, ...ids.map(planPath)]);
  return result("planned", {
    coverage: cov.json, waves: h.json?.waves ?? [], planRevision: h.json?.planRevision ?? null,
    sharedChanges: [...sharedChanges, ...(h.json?.sharedChanges ?? [])], plans: ids,
    ...(gap ? { gap } : {}), ...(override ? { override } : {}),
  });
}

// ---- gap closure, capped at one wave (GSDF-30) ----
async function gapMode() {
  phase("Gaps");
  const ver = await gsd(["verification", "status", phaseDir]);
  if (ver.json?.status !== "gaps_found") return result("refused", { reason: `gap planning needs verification status gaps_found, not ${ver.json?.status ?? `exit ${ver.code}`}` });
  const prev = await gsd(["attempt", "show", phaseDir, "--kind", "gap"]);
  if (prev.code === 0 && prev.json?.result?.waveExecuted) return owner("Gaps", "a gap wave already executed for this phase; gap closure is capped at one wave", { options: ["verify again", "plan the leftovers as a new phase", "abandon"], answer: answers.workflow(`gsd-verify ${N}`, "verify the phase again (the leftovers go to a new phase)") });
  const index = async () => (await gsd(["phase-plan-index", N])).json?.plans ?? [];
  const before = await index();
  const inputDigest = ver.json?.sha ?? (await fileSha(P("VERIFICATION.md")));
  const beforeSha = await sha(JSON.stringify(before.map((p) => p.id).sort()));
  freezeHash = inputDigest;
  const attempt = (await gsd(["attempt", "record", phaseDir, "--kind", "gap"], { runId, inputDigest, before: beforeSha })).json;
  if (!attempt?.key) return result("failed", { reason: "attempt record gap failed" });
  const pending = (list) => list.filter((p) => p.gap_closure === true && !p.has_summary).map((p) => p.id);
  const kept = pending(before);
  const nextNo = Math.max(0, ...before.map((p) => Number(String(p.id).split("-").pop()) || 0)) + 1;
  const body = [
    planningContext("gap_closure"),
    "<gap_context>",
    `Verification report: ${P("VERIFICATION.md")} (status gaps_found). Gaps (JSON): ${JSON.stringify(ver.json?.gaps ?? [])}`,
    `Write one plan per gap group as ${phaseDir}/${nn}-<MM>-PLAN.md numbered from ${nn}-${String(nextNo).padStart(2, "0")}, each with frontmatter gap_closure: true and owns taken from the plans that own the gaps' files.`,
    "All gap plans form ONE execution wave: no dependencies between them.",
    kept.length ? `Gap plans already written by this attempt (keep them; write only the missing ones): ${kept.map(planPath).join(", ")}` : "",
    "</gap_context>",
  ].filter(Boolean).join("\n");
  const { result: r, reason } = await plannerCall("planner:gaps", "gaps", body, "verification", inputDigest, { judges: await outlineJudges() });
  if (fatal(reason)) return failedCall("gap planner", reason);
  if (ownerMarker(r)) return ownerStop("Gaps", r);
  const after = await index();
  const gapIds = pending(after);
  if (!gapIds.length) return owner("Gaps", "gap planner wrote no gap_closure plan (inconclusive)", { options: ["rerun", "abandon"], answer: answers.rerun("") });
  for (const id of gapIds) {
    const s = await structureFix(id, "planner:gaps");
    if (s) return s;
  }
  const dependent = after.filter((p) => gapIds.includes(p.id) && (p.depends_on ?? []).some((d) => gapIds.includes(d)));
  if (dependent.length) return owner("Gaps", `gap plans depend on each other (${dependent.map((p) => p.id).join(", ")}); gap closure is one wave`, { options: ["re-plan the gaps as independent plans", "plan a new phase", "abandon"], answer: answers.rerun("remove the gap plans that depend on another gap plan") });
  const checkedGaps = await checkerLoop(gapIds, true);
  if (checkedGaps.stop) return checkedGaps.stop;
  const out = await handoffStage(gapIds, [], checkedGaps.override, ["--plans", gapIds.join(","), "--prefix", "gap", "--no-tracer-split"], { attemptKey: attempt.key });
  if (out.status === "planned") await gsd(["attempt", "record", phaseDir, "--kind", "gap"], { runId, inputDigest, before: beforeSha, done: true, result: { plans: gapIds, waveExecuted: false } });
  return out;
}
} catch (e) {
  // A run that ends with an error leaves its instance open: a --resume of it is a resumed run (plan-run).
  crashed = true;
  throw e;
} finally {
  if (!crashed) await flow(["plan-end", phaseDir], { run: runId });
  await flow(["unlock", `phase-${nn}`, lease.json.token]);
}
