export const meta = {
  name: "gsd-plan",
  description: "GSD phase planning: outline, wiring, skeleton review, per-plan planners, checker loop, coverage and handoff (or one gap-closure wave)",
  phases: [
    { title: "Preconditions" }, { title: "Outline" }, { title: "Wiring" }, { title: "Skeleton review" },
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
const KNOWN_MARKERS = [...OWNER_MARKERS, "OUTLINE COMPLETE", "PLANNING COMPLETE", "REVISION COMPLETE", "WIRING COMPLETE"];
// Skeleton kit lenses; correctness (code) and source-grounding (plan_review) are other stages' lenses (G029).
const KIT_LENSES = ["fidelity", "integration"];
const markerOf = (r) => String(typeof r === "string" ? r : r?.marker ?? "");
const ownerMarker = (r) => OWNER_MARKERS.find((m) => markerOf(r).includes(m)) ?? null;
const knownMarker = (r) => KNOWN_MARKERS.some((m) => markerOf(r).includes(m));
const isInt13 = (v) => Number.isInteger(v) && v >= 1 && v <= 3;
const PLANNER_SCHEMA = {
  type: "object",
  properties: { marker: { type: "string" }, summary: { type: "string" }, question: { type: "string" }, plans: { type: "array", items: { type: "string" }, description: "with an owner marker: the proposal, one string per proposed split group (PHASE SPLIT RECOMMENDED) or per audit option (SOURCE AUDIT)" }, conflict: { type: "object" }, changes: { type: "array" } },
  required: ["marker"],
};
const ISSUE = { type: "object", properties: { plan: { type: ["string", "null"] }, dimension: { type: "string" }, severity: { type: "string" }, required_property: { type: "string" }, description: { type: "string" }, evidence: { type: "string" }, fix_hint: { type: "string" }, target: { type: "string" } }, required: ["severity", "required_property", "description"] };
const ISSUES_SCHEMA = { type: "object", properties: { issues: { type: "array", items: ISSUE } }, required: ["issues"] };
const RESOLUTION_SCHEMA = { type: "object", properties: { resolved: { type: "array", items: { type: "object", properties: { id: { type: "string" }, evidence: { type: "string" } }, required: ["id"] } } }, required: ["resolved"] };
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
const roleOverrides = a.roles ?? {};
if (!["plan", "gaps"].includes(mode)) return { status: "failed", reason: `mode must be plan or gaps, not ${mode}` };
if (!isInt13(maxSkeletonPasses)) return { status: "failed", reason: `maxSkeletonPasses must be an integer 1..3, not ${maxSkeletonPasses}` };
if (!isInt13(maxCheckIterations)) return { status: "failed", reason: `maxCheckIterations must be an integer 1..3, not ${maxCheckIterations}` };
if (!Array.isArray(lanesArg) || !lanesArg.length || lanesArg.some((l) => typeof l?.lens !== "string" || !l.lens.trim())) return { status: "failed", reason: "skeletonLanes needs at least one lane with a non-empty lens" };
if (!["auto", "always", "never"].includes(wiringMode)) return { status: "failed", reason: `wiring must be auto, always or never, not ${wiringMode}` };
if (a.forceProceed !== undefined && !String(a.forceProceed?.reason ?? "").trim()) return { status: "failed", reason: "forceProceed needs a non-empty reason" };
if (a.reviewGuidance !== undefined && (typeof a.reviewGuidance !== "string" || !a.reviewGuidance.trim())) return { status: "failed", reason: "reviewGuidance needs non-empty text" };
if (a.skipResearch && typeof a.researchSkipReason !== "string") return needsOwner("Research", "skipResearch needs a researchSkipReason");
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
const result = (status, extra = {}) => ({ status, phaseDir, mode, warnings, advisories, ...extra });
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
  checked: { ...planning, checker: roleOf("checker"), maxCheckIterations, ...(tracerExtraFiles ? { tracerExtraFiles } : {}) },
};
const settingsDigest = {};
for (const [key, value] of Object.entries(settingsOf)) settingsDigest[key] = await sha(JSON.stringify(value));
if (Object.values(settingsDigest).some((h) => !h)) return result("failed", { reason: "settings digest unavailable" });

// ---- preconditions (GSDF-16, GSDF-33) ----
phase("Preconditions");
// kit-feedback 2: plan holds only its phase's lease, so planning phase N+1 can run while phase N executes. It writes no code
// and takes no root writer lease; STATE, ROADMAP and the commit take their short writer locks inside ph gsd.
const lease = await flow(["lock", `phase-${nn}`, runId, "gsd-plan"]);
if (lease.code !== 0) return result("refused", { reason: `${leaseText(lease.json, `phase ${N}`)}; plan after it ends` });
try {
const found = (await gsd(["find-phase", N])).json;
// G010: the number names the phase directory; a phaseDir with another slug would plan into a stale directory.
if (found?.directory && found.directory !== phaseDir) return result("refused", { reason: `phaseDir ${phaseDir} is not the directory of phase ${N} (${found.directory}); pass ${found.directory}` });
if (found?.status === "COMPLETE") {
  if (!a.force) return result("refused", { reason: `phase ${N} is complete (see ${P("VERIFICATION.md")}); pass force to replan it` });
  log(`warning: ======== replanning COMPLETE phase ${N} (force) ========`);
}
const open = await discussOpen(phaseDir, nn);
if (open) return owner("Discuss", open);
// G084: a blocking anti-pattern row without its three answers sends the phase back to discuss now, not to a stop at
// execute after the plans are paid for.
const anti = await flow(["anti-patterns", phaseDir]);
if (anti.code !== 0) return owner("Discuss", `blocking anti-patterns lack their three written answers in ${anti.json?.answersFile ?? `${phaseDir}/.continue-here.answers.json`}: ${(anti.json?.unanswered ?? [anti.json?.error ?? "check failed"]).join(", ")}; run gsd-discuss ${N} to write them (it reads CONTEXT)`, { rows: anti.json?.unanswered ?? [] });
const research = await gsd(["research", "status", phaseDir]);
let approvedResearch = null;
if (mode === "plan") {
  if (a.skipResearch) {
    if (!String(a.researchSkipReason ?? "").trim()) return owner("Research", "skipResearch needs a non-empty researchSkipReason");
    log(`research skipped: ${a.researchSkipReason}`);
  } else if (research.code === 0) approvedResearch = P("RESEARCH.md");
  else return owner("Research", `research is ${research.json?.status ?? (research.code === 66 ? "missing" : "not complete")}; run gsd-research or pass skipResearch with a reason`);
} else if (research.code === 0) approvedResearch = P("RESEARCH.md");
const roadmapPhase = (await gsd(["roadmap", "get-phase", N])).json ?? {};
const reqIds = roadmapPhase.requirements ?? [];
if (!reqIds.length) log(`warning: ROADMAP lists no requirement IDs for phase ${N}; the coverage gate decides later`);
const drift = (await flow(["drift", String(g.drift_threshold)])).json;
if (drift?.status === "drift") log(`warning: codebase map drift: ${drift.count} changes since ${drift.baseline} (threshold ${drift.threshold}); consider gsd-map-codebase --paths`);
else if (drift?.status === "skipped") log(`drift check skipped: ${drift.reason}`);
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
  "</planning_context>",
].join("\n");
// GSDF-17: no SPEC sections exist in the kit, so every plan-mode prompt carries the specless block.
const SPECLESS = "<specless_edges>\nNo SPEC defines edge cases or prohibitions for this phase. List the edge cases you plan for in must_haves.truths and the must-not items in must_haves.prohibitions, or record `edges_skipped: <reason>` in the plan frontmatter. Never neither.\n</specless_edges>";
const RETURN_NOTE = "Never ask the owner. Return JSON {marker, summary, question?, conflict?, plans?}: marker is one of OUTLINE COMPLETE, PLANNING COMPLETE, REVISION COMPLETE, or an owner marker (REVISION_CONFLICT, PHASE SPLIT RECOMMENDED, SOURCE AUDIT, CHECKPOINT REACHED, PLANNING INCONCLUSIVE) with the question or conflict. For PHASE SPLIT RECOMMENDED and SOURCE AUDIT, summary states the proposal and plans lists its options, one string each. Do not commit; do not write STATE, ROADMAP or REQUIREMENTS.";
const revisionContext = (plans, issues) => [
  "<revision_context>",
  `Existing plans: ${plans.join(", ") || "none"}`,
  `Checker issues (JSON): ${JSON.stringify(issues)}`,
  "Instructions: revise in place only what the issues require. Answer every issue with one `changes` entry {issue, change}; when an issue contradicts a locked decision or another issue, return REVISION_CONFLICT with the conflict instead of guessing.",
  "</revision_context>",
].join("\n");
async function inputsDigest() { return (await gsd(["revisions", "hash", phaseDir, "inputs"])).json?.hash ?? "none"; }
// CR-GSF-19: skeleton reviews judge the outline, manifest and wiring, which the freeze key covers and inputs does not.
async function skeletonDigest() { return (await gsd(["revisions", "hash", phaseDir, "freeze", "--settings", settingsDigest.freeze])).json?.hash ?? "none"; }
// G125: a call's stage digest covers the files it judges. The outline stage judges the outline files and the owned paths of
// the phase's plans; a plan-level call judges its plan files and the owns each plan's frontmatter declares.
const outlineJudges = async () => ({ files: [OUTLINE, MANIFEST, P("CONTEXT.md")], owns: (await gsd(["outline", "parse", N])).json?.manifest?.plans?.flatMap((p) => p.owns ?? []) ?? [] });
const planOwns = async (id) => (await gsd(["frontmatter", "get", planPath(id), "owns"])).json?.value ?? [];
const plansJudges = async (ids) => ({ files: ids.map(planPath), owns: (await Promise.all(ids.map(planOwns))).flat() });
async function plannerCall(session, label, body, digestKey, digest, extra = {}) {
  const prompt = [body, POLICY, RETURN_NOTE, digestLine(digestKey, digest)].join("\n\n");
  return call(prompt, { label, session, agentType: agentFor("planner", "gsd-planner"), schema: PLANNER_SCHEMA, ...roleOpts(session === "planner:outline" ? "outline" : "planner"), ...extra });
}
const ownerStop = (stage, r) => owner(stage, `planner returned ${ownerMarker(r)}`, { marker: ownerMarker(r), question: r?.question ?? r?.summary ?? null, summary: r?.summary ?? null, plans: r?.plans ?? null, conflict: r?.conflict ?? null, options: ["answer and rerun with the same args", "adjust CONTEXT and rerun", "abandon"] });
const failedCall = (what, reason) => result("failed", { reason: `${what}${reason ? `: ${reason}` : " returned nothing"}` });

const sharedChanges = [];
// F40 (kit-feedback 40): the plans a planner wrote in this run; forceProceed does not accept them in the run that wrote them.
const plansPlanned = new Set();
// Digest line of plan and checker prompts: the freeze hash, or the verification report in gap mode.
let freezeHash = "none";
if (mode === "gaps") return await gapMode();

// ---- outline (GSDF-19) ----
phase("Outline");
// The writer runs the same check the gate runs (G027), so a deterministic outline failure is repaired in its own turn.
const outlineCheckArgs = ["outline", "check", N, ...(tracer ? [] : ["--tracer", "false"])];
const outlineCheck = async () => gsd(outlineCheckArgs);
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
if (parsed.json?.complete && inputsSame && !a.replan) {
  outlineReused = true;
  log("outline reused: marker present and inputs unchanged");
} else {
  const beforeSha = await fileSha(OUTLINE);
  const body = [
    planningContext("outline"),
    SPECLESS,
    `Write the phase outline ${OUTLINE} (table: Plan ID, Objective, Wave, Depends, Requirements; last line exactly \`## OUTLINE COMPLETE\`) and its manifest ${MANIFEST} ({phase, plans:[{id, owns, requirements, produces, consumes, tracer, verify}]}). Do not write PLAN files yet.`,
    `Before you return, run \`node ${PH} gsd ${outlineCheckArgs.join(" ")}\`, repair every error it reports in ${OUTLINE} and ${MANIFEST}, and run it again until it exits 0.`,
  ].join("\n\n");
  const { result: r, reason } = await plannerCall("planner:outline", "outline", body, "inputs", await inputsDigest(), { judges: await outlineJudges() });
  if (fatal(reason)) return failedCall("outline planner", reason);
  if (ownerMarker(r)) return ownerStop("Outline", r);
  const after = await gsd(["outline", "parse", N]);
  const afterSha = await fileSha(OUTLINE);
  // An old marker never acknowledges new inputs: a regeneration must change the outline.
  if (beforeSha && afterSha === beforeSha) return result("failed", { reason: `outline regeneration ${r === null ? "returned nothing" : "left the old outline unchanged"} after an input change` });
  if (!after.json?.complete) return r === null ? failedCall("outline planner", reason) : owner("Outline", "outline has no `## OUTLINE COMPLETE` marker", { options: ["rerun", "adjust CONTEXT", "abandon"] });
}
const fixed = await fixOutline(2, "Outline");
if (fixed.stop) return fixed.stop;
let outline = fixed.check.json;
if (!outlineReused || !inputsSame) await gsd(["revisions", "record", phaseDir, "inputs"]);

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
  if (r?.status === "conflict") return { stop: owner("Wiring", "architect reported a conflict", { conflict: r.conflicts ?? [], options: ["decide and rerun", "abandon"] }) };
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
function addIssue(laneId, raw) {
  const sev = sevClass(String(raw.severity ?? "").toLowerCase());
  if (sev === "info") { advisories.push({ lane: laneId, plan: raw.plan ?? null, description: raw.description }); return; }
  const id = `${laneId}-${++laneSeq}`;
  issues.set(id, { id, lane: laneId, plan: raw.plan ?? null, dimension: raw.dimension ?? "", required_property: raw.required_property ?? "", severity: sev, target: raw.target ?? "outline", description: raw.description ?? "", evidence: raw.evidence ?? "", fix_hint: raw.fix_hint ?? "", state: "open", resolution: "" });
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
    else for (const raw of r.result.issues ?? []) addIssue(lanes[i].id, raw);
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
    if (openBlockers().length >= startBlockers) return { status: "needs-owner", stop: owner("Skeleton review", `stalled: ${openBlockers().length} open blockers at pass ${pass} (was ${startBlockers})`, { issues: openBlockers(), options: ["give guidance and rerun", "adjust CONTEXT", "abandon"] }) };
  }
  const blockers = openBlockers();
  if (blockers.length) return { status: "needs-owner", stop: owner("Skeleton review", `${blockers.length} open blockers after ${passCounts.length} passes`, { issues: blockers, options: ["give guidance and rerun", "adjust CONTEXT", "abandon"] }) };
  for (const w of openIssues()) warnings.push(`skeleton ${w.id}${w.plan ? ` (${w.plan})` : ""}: ${w.description}`);
  return { status: "passed" };
}
const cut300 = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 300);
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
  if (gate.status !== "passed") return gate.stop;
  await gsd(["revisions", "record", phaseDir, "freeze", "--settings", settingsDigest.freeze]);
  await gsd(["revisions", "record", phaseDir, "skeleton"]);
  docPaths.push(P("OUTLINE-REVIEW.md"));
  if (await wiringExists()) docPaths.push(WIRING);
  await commitDocs(`docs(${N}): phase ${N} outline and skeleton review`, docPaths);
}

// ---- per-plan planning (GSDF-24, GSDF-25, GSDF-34) ----
phase("Plans");
const frozen = (await gsd(["outline", "parse", N])).json ?? {};
const rows = frozen.rows ?? outline?.rows ?? [];
const planIds = rows.map((r) => r.id);
const manifestOf = (id) => (frozen.manifest?.plans ?? []).find((p) => p.id === id) ?? { id };
freezeHash = (await gsd(["revisions", "hash", phaseDir, "freeze", "--settings", settingsDigest.freeze])).json?.hash ?? "none";
const wavesOf = (list) => [...new Set(list.map((r) => Number(r.wave ?? 1)))].sort((x, y) => x - y).map((w) => list.filter((r) => Number(r.wave ?? 1) === w).map((r) => r.id));
const superseded = await gsd(["supersede", phaseDir, "--keep", planIds.join(",")]);
for (const m of superseded.json?.moved ?? []) log(`superseded ${typeof m === "string" ? m : m.from ?? JSON.stringify(m)}`);
const wiringText = (await flow(["read", WIRING])).json?.text ?? "";
const wiringQuotes = (id) => wiringText.split(/\r?\n/).filter((l) => l.includes(id)).slice(0, 40);
for (const ids of wavesOf(rows)) {
  const todo = [];
  for (const id of ids) {
    const same = (await gsd(["revisions", "check", phaseDir, `plan:${id}`, "--settings", settingsDigest.plan])).code === 0;
    const st = !skeletonFresh && same ? await gsd(["verify", "plan-structure", planPath(id)]) : null;
    if (st?.code === 0) {
      setStructureWarnings(id, st.json?.warnings);
      log(`plan ${id} kept: unchanged since recorded`);
    } else todo.push(id);
  }
  const outcomes = await parallel(todo.map((id) => () => planOne(id)));
  // G015: the plans that finished are recorded before the batch stops, so a failed sibling does not drop them.
  const recorded = await recordEach(todo.filter((_, i) => outcomes[i]?.ok), false);
  const failed = outcomes.findIndex((o) => !o || o.stop);
  if (failed >= 0) return outcomes[failed]?.stop ?? failedCall(`planner ${todo[failed]}`, null);
  if (recorded) return recorded;
}
async function planOne(id) {
  plansPlanned.add(id);
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
  ].filter(Boolean).join("\n\n");
  const { result: r, reason } = await plannerCall(`planner:${id}`, `plan-${id}`, body, "freeze", freezeHash, { judges: await plansJudges([id]) });
  if (fatal(reason)) return { stop: failedCall(`planner ${id}`, reason) };
  if (ownerMarker(r)) return { stop: ownerStop("Plan", r) };
  if (!knownMarker(r)) {
    const onDisk = (await flow(["exists", planPath(id)])).json?.exists?.[planPath(id)];
    if (!onDisk) return { stop: owner("Plan", `planner for ${id} returned no recognised marker and wrote no plan (inconclusive)`, { options: ["rerun", "adjust CONTEXT", "abandon"] }) };
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
// G015: each plan is recorded once its own structure check passes, so one plan's stop does not drop its finished siblings.
async function recordEach(ids, gapScoped) {
  let stop = null;
  for (const id of ids) {
    const s = await structureFix(id, gapScoped ? "planner:gaps" : `planner:${id}`);
    if (s) stop ??= s;
    else if (!gapScoped) await gsd(["revisions", "record", phaseDir, `plan:${id}`, "--settings", settingsDigest.plan]);
  }
  return stop;
}

// ---- checker loop (GSDF-26..28) ----
phase("Checker");
const checked = await checkerLoop(planIds, false);
if (checked.stop) return checked.stop;
if (!checked.skipped) await gsd(["revisions", "record", phaseDir, "checked", "--settings", settingsDigest.checked]);
docPaths.push(...planIds.map(planPath));

// ---- optional plan review (GSDF-37) ----
if (planReview) {
  phase("Plan review");
  const pr = await workflow("gsd-plan-review", { phaseDir, plans: planIds, roles: roleOverrides, researchPath: approvedResearch, guidance: a.reviewGuidance ?? null, planSettings: settingsDigest.plan });
  if (pr?.status !== "converged") {
    const stop = { stage: "Plan review", reason: pr?.reason ?? "plan review did not converge", issues: pr?.issues ?? [], conflict: pr?.conflict ?? null };
    // The owner answers here and reruns: reviewGuidance goes to the review prompts, a CONTEXT decision is read by them too.
    return pr?.status === "failed" ? result("failed", stop) : result("needs-owner", { ...stop, options: ["give reviewGuidance and rerun", "record the decision in CONTEXT and rerun", "disable plan review (planReview false) and rerun"] });
  }
  for (const s of pr.structure ?? []) setStructureWarnings(s.plan, s.warnings);
  advisories.push(...(pr.issues ?? []).map((x) => ({ lane: "plan-review", plan: x.plan ?? null, severity: x.severity, description: x.description })));
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
  return found;
}
async function checkerLoop(scopeIds, gapScoped) {
  if (!gapScoped && !a.replan && (await gsd(["revisions", "check", phaseDir, "checked", "--settings", settingsDigest.checked])).code === 0) {
    log("checker skipped: plans unchanged since the last passing check");
    return { skipped: true };
  }
  // The cap and the stall test count per plan (kit-feedback 9): a plan that stops converging leaves the loop as stuck, and
  // the other plans keep being checked and revised until they pass or get stuck too. Blockers with no plan use key null.
  const tally = new Map(); // key -> { rounds, prev }
  const stuck = new Map(); // key -> { why, issues }
  const carriedBy = new Map(); // key -> warnings of that key's latest check, carried into the result when the loop ends
  const keyOf = (i) => (i.plan && scopeIds.includes(i.plan) ? i.plan : null);
  for (let iter = 1; ; iter++) {
    const live = scopeIds.filter((id) => !stuck.has(id));
    const probeIssues = await countProbes(scopeIds, gapScoped);
    const probeFile = `${phaseDir}/checker-probes.json`;
    await flow(["write", probeFile], JSON.stringify({ iteration: iter, probes: probeIssues }, null, 2));
    // The Files/plan thresholds grow with the phase's files, so the checker judges them against this phase's plans.
    const filesPerPlan = (await gsd(["check", "owns", N])).json?.files_per_plan;
    const prompt = [
      `Check the plans of phase ${N} read-only: ${live.map(planPath).join(", ")}.`,
      planningContext(gapScoped ? "gap_closure" : "standard"),
      filesPerPlan ? `Files per plan: warning at ${filesPerPlan.warning}+, blocker at ${filesPerPlan.blocker}+ (use these for the Files/plan thresholds).` : "",
      filesPerPlan && tracerExtraFiles ? `Tracer files per plan (a plan with a type="tracer" task): warning at ${filesPerPlan.warning + tracerExtraFiles}+, blocker at ${filesPerPlan.blocker + tracerExtraFiles}+.` : "",
      `Deterministic probe results are in ${probeFile}: they are already counted; do not re-derive them, do not repeat them as issues.`,
      warnings.length ? `Carried warnings:\n${warnings.map((w) => `- ${w}`).join("\n")}` : "",
      "Return JSON {issues: [{plan (null for phase-level), dimension, severity (blocker|warning|info), required_property (the invariant that must hold), description (the evidence it does not), fix_hint}]}.",
      POLICY,
      digestLine("freeze", freezeHash),
      // The checker judges PLAN contents, which the freeze key does not cover (CR-GSF-19).
      digestLine("checked", (await gsd(["revisions", "hash", phaseDir, "checked", "--settings", settingsDigest.checked])).json?.hash ?? "none"),
    ].filter(Boolean).join("\n\n");
    const opts = { label: `checker-${iter}`, agentType: agentFor("checker", "gsd-plan-checker"), readOnly: true, schema: ISSUES_SCHEMA, judges: await plansJudges(scopeIds), ...roleOpts("checker") };
    let c = await call(prompt, opts);
    if (c.result === null && !fatal(c.reason)) c = await call(prompt, opts);
    if (c.result === null) return { stop: failedCall("plan checker", c.reason) };
    const checkerIssues = [];
    for (const i of c.result.issues ?? []) {
      if (String(i.severity).toLowerCase() === "info") advisories.push({ lane: "checker", plan: i.plan ?? null, description: i.description });
      else checkerIssues.push({ ...i, severity: String(i.severity).toLowerCase() === "warning" ? "warning" : "blocker" });
    }
    // Only blockers drive the stall test, the cap and the revisions; warnings are carried into the result (kit-feedback 13, 20).
    const all = [...checkerIssues, ...probeIssues];
    const blockers = all.filter((i) => i.severity === "blocker");
    const carried = all.filter((i) => i.severity === "warning");
    log(`checker iteration ${iter}: ${checkerIssues.length} checker + ${probeIssues.length} probe issues, ${blockers.length} blockers`);
    for (const key of [...live, null]) {
      if (!stuck.has(key)) carriedBy.set(key, carried.filter((w) => keyOf(w) === key).map((w) => `checker${w.plan ? ` (${w.plan})` : ""}: ${w.description}`));
    }
    const blockersByKey = new Map();
    for (const i of blockers) blockersByKey.set(keyOf(i), [...(blockersByKey.get(keyOf(i)) ?? []), i]);
    const revise = new Map();
    for (const [key, list] of blockersByKey) {
      if (stuck.has(key)) continue;
      const t = tally.get(key) ?? { rounds: 0, prev: Infinity };
      t.rounds++;
      tally.set(key, t);
      if (t.rounds >= maxCheckIterations || list.length >= t.prev) {
        const why = t.rounds >= maxCheckIterations ? `checker cap ${maxCheckIterations} reached with ${list.length} issues` : `stalled: ${list.length} issues, not below ${t.prev}`;
        stuck.set(key, { why: `${key ?? "phase"}: ${why}`, issues: list });
        log(`checker: ${key ?? "phase"} left the loop: ${why}`);
      } else {
        t.prev = list.length;
        revise.set(key, list);
      }
    }
    if (!revise.size) break;
    // Every plan is stuck, so no plan is left to revise and the open phase-level issues stop with them.
    if (scopeIds.every((id) => stuck.has(id))) {
      for (const [key, list] of revise) stuck.set(key, { why: `${key ?? "phase"}: no plan left to revise`, issues: list });
      break;
    }
    const perPlan = [...revise].filter(([key]) => key !== null);
    const phaseLevel = revise.get(null) ?? [];
    const revised = await parallel(perPlan.map(([id, list]) => async () => plannerCall(gapScoped ? "planner:gaps" : `planner:${id}`, `revise-${id}-${iter}`, [planningContext("revision"), revisionContext([planPath(id)], list)].join("\n\n"), "freeze", freezeHash, { judges: await plansJudges([id]) })));
    // G015: each revision that answered is fixed and recorded when it returns, so an owner or failed stop of a sibling does not drop it.
    // A revision that returned nothing or stopped for an owner is never recorded as revised (G008).
    const answered = perPlan.filter((_, i) => revised[i] && revised[i].result !== null && !ownerMarker(revised[i].result)).map(([id]) => id);
    const stop = await recordEach(answered, gapScoped);
    // kit-feedback 37: a REVISION_CONFLICT on one plan does not skip the phase-level issues. Their revision still runs, and the
    // conflict stops the loop after it, so the owner's answer reruns a phase whose other revisions are recorded.
    const owned = revised.find((r) => ownerMarker(r?.result));
    const conflict = owned ? ownerStop("Checker", owned.result) : null;
    // A revision that returned nothing is not a finished revision: stop with its reason; the plan is never recorded as revised.
    const missed = revised.findIndex((r) => !r || r.result === null);
    if (!conflict && missed !== -1) return { stop: failedCall(`planner revision ${perPlan[missed][0]} (checker iteration ${iter})`, revised[missed]?.reason ?? null) };
    if (!conflict && stop) return { stop };
    if (phaseLevel.length) {
      const r = await plannerCall(gapScoped ? "planner:gaps" : "planner:outline", `revise-phase-${iter}`, [planningContext("revision"), revisionContext(scopeIds.map(planPath), phaseLevel)].join("\n\n"), "freeze", freezeHash, { judges: await plansJudges(scopeIds) });
      if (ownerMarker(r.result)) return { stop: conflict ?? ownerStop("Checker", r.result) };
      if (r.result === null) return { stop: conflict ?? failedCall(`phase-level planner revision (checker iteration ${iter})`, r.reason) };
      // The phase-level revision can change any plan, so every plan is checked and recorded again.
      const s = await recordEach(scopeIds, gapScoped);
      if (s) return { stop: conflict ?? s };
    }
    if (conflict) return { stop: conflict };
  }
  for (const list of carriedBy.values()) warnings.push(...list);
  if (!stuck.size) return { passed: true };
  const why = [...stuck.values()].map((s) => s.why).join("; ");
  const remaining = [...stuck.values()].flatMap((s) => s.issues);
  if (a.forceProceed) {
    // F40 (kit-feedback 40): forceProceed accepts the stuck plans unchecked, so it may not accept a plan this run planned (a planner
    // call, e.g. a re-plan after the outline or skeleton changed). Checker revisions of plans the loop already checked do not count.
    // A rerun accepts the stuck plan once it is kept and the checker judges it again.
    const accepted = [...stuck.keys()].flatMap((key) => (key === null ? scopeIds : [key]));
    const fresh = accepted.filter((id) => plansPlanned.has(id));
    if (fresh.length) return { stop: owner("Checker", `forceProceed refused: ${fresh.join(", ")} written by a planner in this run; a rerun can accept them`, { issues: remaining, options: ["rerun with forceProceed {reason}", "give guidance and retry", "abandon"] }) };
    const override = { reason: a.forceProceed.reason, why, remaining };
    const saved = await gsd(["state", "override", "--phase", N], { reason: a.forceProceed.reason, issues: remaining.map((x) => `${x.plan ?? "phase"}: ${x.description}`) });
    if (saved.code !== 0) return { stop: failedCall("state override failed", saved.json?.error ?? `exit ${saved.code}`) };
    log(`override: ${why}; proceeding (${a.forceProceed.reason})`);
    return { passed: true, override };
  }
  return { stop: owner("Checker", why, { issues: remaining, options: ["force proceed (rerun with forceProceed {reason})", "give guidance and retry", "abandon"] }) };
}

async function handoffStage(ids, docs, override, handoffArgs = [], gap = null) {
  const cov = await gsd(["check", "coverage", N]);
  if (cov.code !== 0) return owner("Handoff", "coverage gate failed", { coverage: cov.json, options: ["re-plan (recommended)", "move the requirement or decision to a later phase", "tag the decision informational"] });
  // G022: with adapter.dependency_probe, the dependencies the plans declare must resolve together before the handoff writes waves.
  if (cfg.adapter.dependency_probe) {
    phase("Dependencies");
    const dep = await gsd(["check", "dependencies", N, "--plans", ids.join(",")]);
    phase(gap ? "Gaps" : "Handoff");
    if (dep.code !== 0) return owner("Dependencies", dep.json?.reason ?? `dependency check exit ${dep.code}`, { output: dep.json?.output ?? null, dependencies: dep.json?.dependencies ?? [], options: ["edit the dependency lines of the plans or the probe, then rerun", "give guidance and rerun with replan", "abandon"] });
  }
  const h = await gsd(["handoff", N, ...handoffArgs]);
  if (h.code !== 0) return result("failed", { reason: `handoff refused: ${h.json?.error ?? h.json?.errors?.join?.("; ") ?? h.code}`, errors: h.json?.errors ?? [] });
  for (const w of h.json?.warnings ?? []) warnings.push(`handoff: ${typeof w === "string" ? w : JSON.stringify(w)}`);
  if (gap && (h.json?.waves ?? []).length !== 1) return owner("Gaps", `gap handoff has ${(h.json?.waves ?? []).length} execution waves; gap closure is one wave`, { options: ["re-plan the gaps as independent plans", "plan a new phase", "abandon"] });
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
  if (prev.code === 0 && prev.json?.result?.waveExecuted) return owner("Gaps", "a gap wave already executed for this phase; gap closure is capped at one wave", { options: ["verify again", "plan the leftovers as a new phase", "abandon"] });
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
  if (!gapIds.length) return owner("Gaps", "gap planner wrote no gap_closure plan (inconclusive)", { options: ["rerun", "abandon"] });
  for (const id of gapIds) {
    const s = await structureFix(id, "planner:gaps");
    if (s) return s;
  }
  const dependent = after.filter((p) => gapIds.includes(p.id) && (p.depends_on ?? []).some((d) => gapIds.includes(d)));
  if (dependent.length) return owner("Gaps", `gap plans depend on each other (${dependent.map((p) => p.id).join(", ")}); gap closure is one wave`, { options: ["re-plan the gaps as independent plans", "plan a new phase", "abandon"] });
  const checkedGaps = await checkerLoop(gapIds, true);
  if (checkedGaps.stop) return checkedGaps.stop;
  const out = await handoffStage(gapIds, [], checkedGaps.override, ["--plans", gapIds.join(","), "--prefix", "gap", "--no-tracer-split"], { attemptKey: attempt.key });
  if (out.status === "planned") await gsd(["attempt", "record", phaseDir, "--kind", "gap"], { runId, inputDigest, before: beforeSha, done: true, result: { plans: gapIds, waveExecuted: false } });
  return out;
}
} finally {
  await flow(["unlock", `phase-${nn}`, lease.json.token]);
}
