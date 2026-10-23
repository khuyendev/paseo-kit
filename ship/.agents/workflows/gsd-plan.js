export const meta = {
  name: "gsd-plan",
  description: "GSD phase planning: outline, wiring, skeleton review, per-plan planners, checker loop, coverage and handoff (or one gap-closure wave)",
  phases: [
    { title: "Preconditions" }, { title: "Smoke build" }, { title: "Outline" }, { title: "Wiring" }, { title: "Skeleton review" },
    { title: "Plans" }, { title: "Checker" }, { title: "Plan review" }, { title: "Dependencies" }, { title: "Handoff" }, { title: "Gaps" },
  ],
};
// The default planning composition (kit feedback 87, THIN.md): step order, agents and verbs, stops and their answers, retry counts.
// Prompt texts are kit templates (prompts/plan-*.md, verb plan-prompt); bookkeeping is in flow verbs (lib/flow-plan.mjs, flow-plan-state.mjs).

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
const GUIDE = ["give guidance and rerun", "adjust CONTEXT", "abandon"];
const REVIEW_OPTIONS = ["give reviewGuidance and rerun", "record the decision in CONTEXT and rerun", "disable plan review (planReview false) and rerun"];

const rawCall = call;
call = async (prompt, { judges = {}, ...opts } = {}) => {
  // GSDF-03: bind judgments and repairs to the files and owned paths the call judges (`judges`) and to the adapter settings.
  const identity = await flow(["digest"], judges);
  if (identity.code !== 0 || !identity.json?.hash) throw new Error("agent input digest unavailable");
  const researchPolicy = prompt.includes("<research_input_policy>") ? "" : policyBlock(null);
  prompt = [prompt, researchPolicy, digestLine("stage", identity.json.hash)].filter(Boolean).join("\n\n");
  return rawCall(prompt, opts);
};
// A null reply of a lane, the architect or a checker is retried once; a quota or auth failure is not.
const callTwice = async (prompt, opts) => { const r = await call(prompt, opts); return r.result === null && !fatal(r.reason) ? call(prompt, opts) : r; };
// Skeleton kit lenses; correctness (code) and source-grounding (plan_review) are other stages' lenses (G029).
const KIT_LENSES = ["fidelity", "integration"];

// ---- arguments (GSDF-15): every check runs before the first agent (verb plan-args) ----
const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const cfg = await loadCfg();
const g = cfg.gsd;
// Composition policies (kit feedback 87, RF): the gsd.* settings this script reads, each overridden by its argument. O65: `staged` runs
// every plan through each stage together, `streams` gives each plan its own review stream.
const policy = {
  mode: a.mode ?? "plan", tracer: a.tracer ?? true, reversibilityGates: a.reversibilityGates ?? true, wiring: a.wiring ?? "auto", granularity: g.granularity,
  maxSkeletonPasses: a.maxSkeletonPasses ?? g.max_skeleton_passes, maxCheckIterations: a.maxCheckIterations ?? g.max_check_iterations, skeletonLanes: a.skeletonLanes ?? g.skeleton_lanes,
  planReview: a.planReview ?? g.plan_review, planFlow: a.planFlow ?? g.plan_flow ?? "staged", checkerReallocate: g.checker_reallocate ?? 0, checkerRecheck: g.checker_recheck ?? "full",
};
const A = (await flow(["plan-args"], { args: a, policy, gsd: g, adapter: cfg.adapter, kitLenses: KIT_LENSES })).json ?? {};
if (A.status === "needs-owner") return needsOwner("Research", A.reason, { answer: answers.args({ researchSkipReason: "<why research is skipped>" }, "give the reason research is skipped") });
if (A.status !== "ok") return { status: "failed", reason: A.reason ?? `plan-args: ${A.error ?? "no answer"}` };
const { mode, tracer, maxSkeletonPasses, maxCheckIterations, wiringMode, planReview, planFlow, reallocRounds, recheckMode, roleOverrides, roles, forcedIssues, tracerExtraFiles, contractsOn, schemas: S } = A;
const N = phaseNumber(phaseDir);
const nn = phaseDir.split("/").pop().split("-")[0];
const P = (name) => `${phaseDir}/${nn}-${name}`;
const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
const [OUTLINE, MANIFEST, WIRING] = [P("PLAN-OUTLINE.md"), P("PLAN-OUTLINE.manifest.json"), P("WIRING.md")];
const markerOf = (r) => String(typeof r === "string" ? r : r?.marker ?? "");
const ownerMarker = (r) => A.ownerMarkers.find((m) => markerOf(r).includes(m)) ?? null;
const isConflict = (r) => markerOf(r).includes("REVISION_CONFLICT");
// The agent definition of each role: the adapter's, else the kit's; planner and checker stay apart (GSDF-35).
const agents = Object.fromEntries(Object.entries({ planner: "gsd-planner", checker: "gsd-plan-checker", skeleton_lane: "gsd-skeleton-reviewer" }).map(([role, kit]) => [role, cfg.adapter.agents?.[role] ?? kit]));
// The run's report: O65/O67 the streams flow and its dependent streams; kit feedback 68, 70, 69, 76, 67: the hand edits, the validation
// strategy, the plans sent back to the outline, the incremental recheck scope and the contract gate (parts of plan-progress.json).
const [warnings, advisories, dependents, reallocated, sharedChanges] = [[], [], [], [], []];
const contractReport = { checks: 0, rounds: 0, issues: 0, changes: [] };
let [flowReport, streamed, handEdits, validationReport, recheckReport, manifestFresh, contractDirty, depRounds] = [null, null, null, null, null, null, false, 0];
const result = (status, extra = {}) => ({ status, phaseDir, mode, warnings, advisories, ...(flowReport ?? {}), ...(handEdits ? { handEdits } : {}), ...(validationReport ? { validation: validationReport } : {}), ...(reallocated.length ? { reallocated } : {}), ...(recheckReport ? { recheck: recheckReport } : {}), ...(contractReport.checks ? { contracts: contractReport } : {}), ...extra });
const owner = (stage, reason, extra = {}) => result("needs-owner", { stage, reason, ...extra });
const failedCall = (what, reason) => result("failed", { reason: `${what}${reason ? `: ${reason}` : " returned nothing"}` });
const ownerStop = (stage, r) => owner(stage, `planner returned ${ownerMarker(r)}`, { marker: ownerMarker(r), question: r?.question ?? r?.summary ?? null, summary: r?.summary ?? null, plans: r?.plans ?? null, conflict: r?.conflict ?? null, options: ["answer and rerun with the same args", "adjust CONTEXT and rerun", "abandon"], answer: answers.context(`the planner's ${ownerMarker(r)} (its question, conflict or proposal)`) });
// G017: the settings each revision key hashes (plan-args): a changed lane, role or limit reruns the judgments it decides.
const settingsDigest = {};
for (const [key, value] of Object.entries(A.settings)) settingsDigest[key] = await sha(JSON.stringify(value));
if (Object.values(settingsDigest).some((h) => !h)) return result("failed", { reason: "settings digest unavailable" });

// ---- preconditions (GSDF-16, GSDF-33) ----
phase("Preconditions");
// kit-feedback 2: plan holds only its phase's lease (no root writer lease), so planning phase N+1 can run while phase N executes.
const lease = await flow(["lock", `phase-${nn}`, runId, "gsd-plan"]);
let crashed = false;
if (lease.code !== 0) return result("refused", { reason: `${leaseText(lease.json, `phase ${N}`)}; plan after it ends` });
try {
const found = (await gsd(["find-phase", N])).json;
// Kit feedback 68 (gsd.review_metrics, measurement only): what changed by hand since the last record goes to the log and the result.
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
if (found?.status === "COMPLETE" && !a.force) return result("refused", { reason: `phase ${N} is complete (see ${P("VERIFICATION.md")}); pass force to replan it` });
if (found?.status === "COMPLETE") log(`warning: ======== replanning COMPLETE phase ${N} (force) ========`);
const open = await discussOpen(phaseDir, nn);
if (open) return owner("Discuss", open, { answer: answers.workflow(`gsd-discuss ${N}`, "finish the discussion") });
// G084: a blocking anti-pattern row without its three answers sends the phase back to discuss now, not to a stop at execute.
const anti = await flow(["anti-patterns", phaseDir]);
if (anti.code !== 0) return owner("Discuss", `blocking anti-patterns lack their three written answers in ${anti.json?.answersFile ?? `${phaseDir}/.continue-here.answers.json`}: ${(anti.json?.unanswered ?? [anti.json?.error ?? "check failed"]).join(", ")}; run gsd-discuss ${N} to write them (it reads CONTEXT)`, { rows: anti.json?.unanswered ?? [], answer: answers.workflow(`gsd-discuss ${N}`, "write the three answers of each blocking anti-pattern") });
// Kit feedback 87: the run's record in plan-progress.json; a --resume after a runner died keeps what this run wrote and recorded.
const started = await flow(["plan-run", phaseDir], { run: runId, settings: settingsDigest, force: a.forceProceed ? { reason: a.forceProceed.reason, issues: forcedIssues } : null });
if (started.code !== 0) return result("failed", { reason: `plan state: ${started.json?.reason ?? started.json?.error ?? `exit ${started.code}`}` });
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
// F50: with adapter.commands.smoke_builds, every declared verification target builds once before any planner runs.
if (cfg.adapter.commands.smoke_builds?.length) {
  phase("Smoke build");
  const smoke = await gsd(["check", "smoke"]);
  if (smoke.code !== 0) return owner("Smoke build", smoke.json?.reason ?? `smoke build check exit ${smoke.code}`, { builds: (smoke.json?.builds ?? []).filter((b) => b.status !== "passed"), options: ["install the missing toolchain component or fix the build, then rerun", "remove the target from adapter.commands.smoke_builds, then rerun", "abandon"], answer: answers.fix("install the missing toolchain component or fix the build until `ph gsd check smoke` passes") });
  phase("Preconditions");
}

// ---- shared steps ----
// What every prompt is told about the phase; the verb plan-prompt renders the kit templates prompts/plan-*.md.
const ctx = { N, nn, phaseDir, phaseName: roadmapPhase.phase_name, goal: roadmapPhase.goal, approvedResearch, reqIds, instructions: cfg.adapter.instructions ?? [], stackSkill: cfg.adapter.stack_skill ? `.claude/skills/${cfg.adapter.stack_skill}/SKILL.md` : null, tracer, reversibilityGates: A.reversibilityGates, granularity: g.granularity, planLimits: g.plan_limits, contractsOn, validation: null };
async function promptFor(kind, data) {
  const r = await flow(["plan-prompt", kind], { ctx, ...data });
  if (r.code !== 0 || typeof r.json?.text !== "string") throw new Error(r.json?.error ?? `plan-prompt ${kind}: exit ${r.code}`);
  return r.json.text;
}
// Kit feedback 67 F2: the manifest entries of the plans a reviser edits (its contract block); null without gsd.contract_check.
async function shows(ids) {
  const out = [];
  for (const id of contractsOn ? ids : []) out.push({ id, show: (await gsd(["contracts", "show", N, "--plan", id])).json });
  return contractsOn ? out : null;
}
// The revision keys: a key's digest for a prompt's digest line, whether its record holds, a new record. CR-GSF-19: skeleton reviews
// judge the outline, manifest and wiring (freeze key); the checker judges PLAN contents (checked key).
const hashOf = async (...key) => (await gsd(["revisions", "hash", phaseDir, ...key])).json?.hash ?? "none";
const holds = async (...key) => (await gsd(["revisions", "check", phaseDir, ...key])).code === 0;
const record = (...key) => gsd(["revisions", "record", phaseDir, ...key]);
const FREEZE = () => ["freeze", "--settings", settingsDigest.freeze];
const CHECKED = () => ["checked", "--settings", settingsDigest.checked];
// G125: a call's stage digest covers the files it judges: the outline files and the owned paths of the phase's plans, or plan files and owns.
const outlineJudges = async () => ({ files: [OUTLINE, MANIFEST, P("CONTEXT.md")], owns: (await gsd(["outline", "parse", N])).json?.manifest?.plans?.flatMap((p) => p.owns ?? []) ?? [] });
const planOwns = async (id) => (await gsd(["frontmatter", "get", planPath(id), "owns"])).json?.value ?? [];
const plansJudges = async (ids) => ({ files: ids.map(planPath), owns: (await Promise.all(ids.map(planOwns))).flat() });
const checkerOpts = async (label, schema, ids) => ({ label, agentType: agents.checker, readOnly: true, schema, judges: await plansJudges(ids), ...roles.checker });
// A planner call; `label#n` names one call of a recurring label in the run's log (contract changes).
const labelCalls = new Map();
async function plannerCall(session, label, kind, data, extra = {}) {
  const nth = (labelCalls.get(label) ?? 0) + 1;
  labelCalls.set(label, nth);
  const r = await call(await promptFor(kind, data), { label, session, agentType: agents.planner, schema: S.planner, ...roles[session === "planner:outline" ? "outline" : "planner"], ...extra });
  return contractsOn && r.result && /^(revise|deprevise|contract|fix)-/.test(label) ? applyContractChanges(r, session, `${label}#${nth}`) : r;
}
const reviseCall = async (session, label, ids, issues) => plannerCall(session, label, "revise", { plans: ids.map(planPath), issues, shows: await shows(ids), key: "freeze", digest: freezeHash }, { judges: await plansJudges(ids) });
// Each plan of `list` ([[id, issues]]) revised by its own planner, all at once (G015, G008): each revision that answered is fixed and
// recorded; one that returned nothing (`missed`) or stopped for an owner (`owned`) is never recorded as revised.
async function revisePlans(list, label, gapScoped = false) {
  const revised = await parallel(list.map(([id, issues]) => () => reviseCall(gapScoped ? "planner:gaps" : `planner:${id}`, label(id), [id], issues)));
  const answered = list.filter((_, i) => revised[i] && revised[i].result !== null && !ownerMarker(revised[i].result)).map(([id]) => id);
  const stop = await recordEach(answered, gapScoped);
  const missed = revised.findIndex((r) => !r || r.result === null);
  return { answered, stop, owned: revised.find((r) => ownerMarker(r?.result))?.result ?? null, conflicted: list.filter((_, i) => isConflict(revised[i]?.result)).map(([id]) => id), missed: missed === -1 ? null : { id: list[missed][0], reason: revised[missed]?.reason ?? null } };
}
// Kit feedback 87: one step of a part of the run's planning log in plan-progress.json; the answers are a function of the ops sent,
// so a resumed run that replays the same replies gets the same answers.
async function planStep(verb, part, step, ops) {
  const r = await flow([verb, phaseDir], { run: runId, part, step, ops });
  if (r.code !== 0 || !Array.isArray(r.json?.replies)) throw new Error(`${verb} ${part} ${step}: ${r.json?.reason ?? r.json?.error ?? `exit ${r.code}`}`);
  return r.json.replies;
}
// Kit feedback 64, 87: a checker part of plan-progress.json (a loop, the streams join, the dependency checks); its findings are
// recorded (gsd.review_metrics) when it ends, if a checker agent judged in it (`ran`).
const checkerPart = (name) => ({ name, ran: false, step: (id, ops) => planStep("plan-checker", name, id, ops) });
const depLedger = checkerPart("dependents");
async function partFindings(ledger, part) {
  if (ledger.ran) await prereview("checker", (await flow(["plan-state", phaseDir])).json?.views?.[ledger.name]?.findings ?? [], part);
}
async function withPart(name, fn, part) {
  const ledger = checkerPart(name);
  try { return await fn(ledger); } finally { await partFindings(ledger, part); }
}
// Kit feedback 67 F2: a reviser's CONTRACT_CHANGE entries become the manifest's new signatures (`ph gsd contracts change`); the next
// contract gate revises the consumers. A refused change, or the marker without an entry, is a REVISION_CONFLICT. A reply replayed on
// resume repeats a change already applied (`already`); plan-progress.json still names it as this run's change.
async function applyContractChanges(r, session, callId) {
  const list = Array.isArray(r.result.contract_changes) ? r.result.contract_changes : [];
  const conflict = (why, change) => ({ ...r, result: { ...r.result, marker: "REVISION_CONFLICT", summary: why, conflict: { contract_change: change ?? null, rejected: why } } });
  if (!list.length) return markerOf(r.result).includes("CONTRACT_CHANGE") ? conflict("marker CONTRACT_CHANGE without a contract_changes entry") : r;
  const own = /^planner:(\d+(?:\.\d+)?-\d+)$/.exec(session)?.[1] ?? null;
  for (const c of list) {
    const w = await gsd(["contracts", "change", N], { plan: c.plan ?? own, symbol: c.symbol, old: c.old, new: c.new, reason: c.reason });
    if (w.code !== 0) return conflict(`CONTRACT_CHANGE of ${c.symbol} rejected: ${w.json?.error ?? `exit ${w.code}`}`, c);
    const [d] = await planStep("plan-contracts", "contracts", `${callId}:${c.symbol}`, [{ op: "change", plan: c.plan ?? own, symbol: c.symbol, old: c.old, new: c.new, reason: c.reason, outcome: { changed: Boolean(w.json?.changed), already: Boolean(w.json?.already), plan: w.json?.plan ?? null, old: w.json?.old ?? null, signature: w.json?.signature ?? null, consumers: w.json?.consumers ?? [] } }]);
    if (!d.changed) continue;
    Object.assign(contractReport, d.report);
    log(`contract change: ${d.entry.plan} ${c.symbol}: ${d.entry.old} -> ${d.entry.new}; consumers ${d.entry.consumers.join(", ") || "none"}`);
    contractDirty = d.dirty;
    manifestFresh = (await gsd(["outline", "parse", N])).json?.manifest ?? manifestFresh;
  }
  return r;
}
// Kit feedback 67 F3, 76: `ph gsd verify contracts` after the planners of a wave, after the checker and plan-review edits and at
// handoff (--complete). Each plan a failure names is revised by its planner; the rounds are counted here, not in the checker's caps.
// Still failing after maxCheckIterations rounds, or not falling, stops needs-owner. Returns the stop, or null.
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
    const v = await revisePlans([...byPlan], (id) => `contract-${id}-${round}`);
    if (v.owned) return ownerStop("Contracts", v.owned);
    if (v.missed) return failedCall(`contract revision ${v.missed.id} (round ${round})`, v.missed.reason);
    if (v.stop) return v.stop;
    await contracts(`g${gate}:${round}:clean`, "clean");
  }
}
// Kit feedback 88: `ph workflow stop <runId>` stops the run at its next boundary (between planner waves and between checker rounds,
// where every plan written so far is recorded); a rerun with the same args keeps the recorded plans and goes on.
async function pauseAsked(stage, where, at = {}) {
  const r = await flow(["stop-requested"]);
  if (!r.json?.stop) return null;
  log(`stop request of run ${r.json.runId} (${r.json.at}) seen: paused ${where}`);
  return result("paused", { stage, reason: `stop requested${r.json.reason ? ` (${r.json.reason})` : ""}: paused ${where}`, pausedAt: { by: "stop-request", ...at }, answer: answers.rerun("") });
}
// Kit feedback 64 (gsd.review_metrics, measurement only): the findings of each pre-code review stage for `ph review-stats --stage`.
async function prereview(stage, findings, part) {
  if (!g.review_metrics) return;
  const w = await flow(["prereview-record", phaseDir], { stage, runId, mode, ...(part ? { part } : {}), findings });
  log(w.code !== 0 ? `warning: ${stage} review record not written: ${(w.json?.errors ?? [w.json?.error ?? `exit ${w.code}`]).join("; ")}` : `review metrics: ${w.json.record}`);
}
async function commitDocs(message, paths) {
  const c = g.commit_policy.docs ? await gsd(["commit", message, "--files", ...paths]) : { code: 0 };
  if (c.code !== 0) log(`warning: docs commit failed: ${c.json?.error ?? c.stderr ?? c.code}`);
}
// Kit feedback 69: reallocation rounds still open to this run. The digest line of plan and checker prompts: the freeze hash, or the
// verification report in gap mode.
let reallocLeft = reallocRounds;
let freezeHash = "none";

// ---- validation strategy (kit feedback 70): <NN>-VALIDATION.md rendered by the verb; the checker is told whether Dimension 8 applies ----
const strategy = g.validation_strategy && approvedResearch ? await flow(["validation-strategy", phaseDir]) : null;
if (strategy && (strategy.code !== 0 || !strategy.json?.status)) return result("failed", { reason: `validation strategy: ${strategy.json?.error ?? strategy.stderr ?? `exit ${strategy.code}`}` });
const vs = (await flow(["plan-validation"], { off: g.validation_strategy ? null : "gsd.validation_strategy is off", approvedResearch, strategy: strategy?.json ?? null })).json;
[ctx.validation, validationReport] = [vs.validation, vs.report];
warnings.push(...vs.warnings);
if (vs.log) log(vs.log);
if (vs.commit) await commitDocs(`docs(phase-${N}): add validation strategy`, [vs.commit]);
if (mode === "gaps") return await gapMode();

// ---- outline (GSDF-19) ----
phase("Outline");
// The writer runs the same check the gate runs (G027). Kit feedback 69: the check holds a plan whose owns reach the Files/plan blocker
// line as an error; an outline reused from an earlier run was reviewed and may have plans, so this run's first check only warns.
const outlineCheckArgs = ["outline", "check", N, ...(tracer ? [] : ["--tracer", "false"])];
let outlineFilesMode = "error";
const outlineCheck = async () => gsd([...outlineCheckArgs, ...(outlineFilesMode === "warn" ? ["--files-per-plan", "warn"] : [])]);
async function fixOutline(turns, stage) {
  let check = await outlineCheck();
  for (let t = 0; check.code !== 0 && t < turns; t++) {
    const errors = check.json?.errors ?? [check.json?.error ?? `outline check exit ${check.code}`];
    const { result: r, reason } = await plannerCall("planner:outline", "outline-fix", "outline-fix", { errors, digest: await hashOf("inputs") }, { judges: await outlineJudges() });
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
// Kit feedback 87: a resumed run keeps the outline its writer wrote for these same inputs before the run stopped (plan-outline).
const ownOutline = !inputsSame && !a.replan && parsed.json?.complete ? started.json.outline : null;
const keepOwnOutline = ownOutline ? ownOutline.inputs === (await hashOf("inputs")) && ownOutline.sha === (await fileSha(OUTLINE)) : false;
const outlineReused = Boolean(parsed.json?.complete && inputsSame && !a.replan);
if (outlineReused) log("outline reused: marker present and inputs unchanged");
else if (keepOwnOutline) log("outline kept: this run wrote it for the same inputs before it stopped");
else {
  const beforeSha = await fileSha(OUTLINE);
  const { result: r, reason } = await plannerCall("planner:outline", "outline", "outline", { checkArgs: outlineCheckArgs, digest: await hashOf("inputs") }, { judges: await outlineJudges() });
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
const ownOutlineRecord = !outlineReused ? await flow(["plan-outline", phaseDir], { run: runId, inputs: await hashOf("inputs"), sha: await fileSha(OUTLINE) }) : null;
if (ownOutlineRecord && ownOutlineRecord.code !== 0) log(`warning: outline record not written: ${ownOutlineRecord.json?.reason ?? ownOutlineRecord.json?.error ?? `exit ${ownOutlineRecord.code}`}`);
if (!outlineReused || !inputsSame) await record("inputs");

// ---- wiring contract (GSDF-20): only with an adapter architect agent ----
phase("Wiring");
const architect = cfg.adapter.agents?.architect ?? null;
const architectReady = architect ? Boolean((await flow(["exists", `.agents/agents/${architect}.md`])).json?.exists?.[`.agents/agents/${architect}.md`]) : false;
const wiringExists = async () => Boolean((await flow(["exists", WIRING])).json?.exists?.[WIRING]);
const wiringInUse = architectReady && wiringMode !== "never";
let outlineChangeIssues = [];
async function runArchitect(label, why) {
  const prompt = await promptFor("architect", { why, digest: await hashOf("inputs") });
  // An existing WIRING.md never stands in for the reply (G011).
  const { result: r, reason } = await callTwice(prompt, { label, agentType: architect, schema: S.architect, judges: await outlineJudges(), ...roles.architect });
  if (fatal(reason)) return { stop: failedCall("architect", reason) };
  if (r?.status === "conflict") return { stop: owner("Wiring", "architect reported a conflict", { conflict: r.conflicts ?? [], options: ["decide and rerun", "abandon"], answer: answers.context("the architect's conflicts") }) };
  if (r?.status !== "complete") return { stop: result("failed", { reason: `architect ${r ? `ended with status ${r.status}` : "returned nothing"}${reason ? ` (${reason})` : ""}` }) };
  if (!(await wiringExists())) return { stop: result("failed", { reason: `architect wrote no ${WIRING}${reason ? ` (${reason})` : ""}` }) };
  sharedChanges.push(...(r?.sharedChanges ?? []));
  return { changes: (r?.outlineChanges ?? []).map((c, i) => ({ id: `W${i + 1}`, plan: c.plan ?? null, severity: "blocker", description: typeof c === "string" ? c : c.description ?? JSON.stringify(c), target: "outline", evidence: "architect outlineChanges", lane: "integration" })) };
}
const wantsWiring = wiringMode === "always" || (wiringMode !== "never" && (outline?.needsWiring || (outline?.crossPlan ?? []).length > 0 || (await wiringExists())));
if (!architectReady) log("wiring: no architect agent");
else if (!wantsWiring) log(`wiring: skipped (${wiringMode === "never" ? "wiring never" : "no cross-plan edges"})`);
else {
  const w = await runArchitect("architect", "Cover every consumes edge.");
  if (w.stop) return w.stop;
  outlineChangeIssues = w.changes;
}

// ---- skeleton review (GSDF-21..23): lanes judge, the outline writer and the architect revise, until no blocker is open ----
phase("Skeleton review");
// The gate's issue book (verb plan-skeleton); kit feedback 69: skeletonFocus is set while the skeleton is reviewed again after the
// checker reallocated plans.
let sk = A.skeleton;
let skeletonFocus = null;
const hasEdges = (o) => Boolean(o?.needsWiring || (o?.crossPlan ?? []).length);
async function skel(op, data = {}) {
  const r = await flow(["plan-skeleton", op], { sk, ...data });
  if (r.code !== 0 || !r.json?.sk) throw new Error(`plan-skeleton ${op}: ${r.json?.error ?? `exit ${r.code}`}`);
  sk = r.json.sk;
  advisories.push(...r.json.advisories);
  return r.json;
}
async function snapshotList() {
  const paths = [OUTLINE, MANIFEST, P("CONTEXT.md"), ".planning/REQUIREMENTS.md", ".planning/ROADMAP.md"];
  return (await wiringExists()) ? [...paths, WIRING] : paths;
}
const laneOpts = async (label, schema, lane) => ({ label, agentType: agents.skeleton_lane, readOnly: true, schema, judges: await outlineJudges(), ...lane.opts });
const reviewLane = async (lane) => callTwice(await promptFor("skeleton-lane", { lens: lane.text, files: await snapshotList(), warnings: outline?.warnings ?? [], edges: outline?.crossPlan ?? [], focus: skeletonFocus, digest: await hashOf(...FREEZE()) }), await laneOpts(`skeleton-${lane.id}`, S.issues, lane));
const resolutionCheck = async (lane, open) => call(await promptFor("skeleton-resolve", { lens: lane.text, files: await snapshotList(), open, digest: await hashOf(...FREEZE()) }), await laneOpts(`resolve-${lane.id}`, S.resolution, lane));
async function skeletonGate() {
  // A failed lane keeps the findings of the lanes that answered; the stop lists the failed lanes.
  let s = await skel("first", { replies: await parallel(sk.lanes.map((l) => () => reviewLane(l))), outlineChanges: outlineChangeIssues });
  if (s.failed) return { status: "failed", stop: result("failed", { reason: s.failed }) };
  // Revisions and the stall rule follow open blockers only; warnings are carried after the loop.
  for (let pass = 2; s.blockers && pass <= maxSkeletonPasses; pass++) {
    const { startBlockers, toOutline, toWiring } = await skel("route", { wiringInUse });
    let wroteThisPass = false;
    if (toOutline.length) {
      const edgesBefore = hasEdges(outline);
      const { result: r, reason } = await plannerCall("planner:outline", `outline-revise-${pass}`, "revise", { plans: [OUTLINE, MANIFEST], issues: toOutline, shows: null, key: "inputs", digest: await hashOf("inputs") }, { judges: await outlineJudges() });
      if (fatal(reason)) return { status: "failed", stop: failedCall("outline reviser", reason) };
      if (ownerMarker(r)) return { status: "needs-owner", stop: ownerStop("Skeleton review", r) };
      const f = await fixOutline(1, "Skeleton review");
      if (f.stop) return { status: f.stop.status, stop: f.stop };
      outline = f.check.json;
      if (!edgesBefore && hasEdges(outline) && wiringInUse) {
        const w = await runArchitect("architect", "A revision introduced the first cross-plan edge: write the wiring contract now.");
        if (w.stop) return { status: w.stop.status, stop: w.stop };
        wroteThisPass = true;
        await skel("add", { issues: [...w.changes, { severity: "blocker", target: "wiring", description: `${WIRING} was written in pass ${pass}: review all of it`, evidence: "first cross-plan edge" }] });
      } else if (!edgesBefore && hasEdges(outline)) await skel("add", { issues: (outline.crossPlan ?? []).map((e) => ({ severity: "blocker", plan: e.plan ?? null, target: "outline", description: `new cross-plan edge ${JSON.stringify(e)}: review the integration`, evidence: "introduced by the outline revision" })) });
    }
    if (wiringInUse && !wroteThisPass && (toWiring.length || toOutline.length)) {
      const w = await runArchitect("architect", toWiring.length ? `Resolve these skeleton issues: ${JSON.stringify(toWiring.map(({ id, required_property, description, fix_hint }) => ({ id, required_property, description, fix_hint })))}` : "Realign WIRING.md with the revised outline.");
      if (w.stop) return { status: w.stop.status, stop: w.stop };
      await skel("add", { issues: w.changes });
    }
    const { byLane } = await skel("pending");
    const checks = await parallel(sk.lanes.map((l) => async () => (byLane[l.id].length ? { lane: l.id, open: byLane[l.id], r: await resolutionCheck(l, byLane[l.id]) } : null)));
    // A resolution check that returned nothing judged none of its issues: a failed call, not a stalled skeleton.
    s = await skel("resolve", { checks });
    if (s.unjudged) return { status: "failed", stop: result("failed", s.unjudged) };
    if (s.blockers >= startBlockers) return { status: "needs-owner", stop: owner("Skeleton review", `stalled: ${s.blockers} open blockers at pass ${pass} (was ${startBlockers})`, { issues: s.open, options: GUIDE, answer: answers.context("the open skeleton blockers") }) };
  }
  const end = await skel("end");
  if (end.blockers.length) return { status: "needs-owner", stop: owner("Skeleton review", `${end.blockers.length} open blockers after ${end.passes} passes`, { issues: end.blockers, options: GUIDE, answer: answers.context("the open skeleton blockers") }) };
  warnings.push(...end.warnings);
  return { status: "passed" };
}
// OUTLINE-REVIEW.md of a finished gate and its review-metrics record (kit feedback 64); a passed gate records the skeleton keys.
async function skeletonDone(gate, part) {
  const { text, findings } = await skel("report", { gate: { status: gate.status, reason: gate.stop?.reason, marker: gate.stop?.marker }, advisories, nn });
  await gsd(["write", phaseDir, "OUTLINE-REVIEW"], text);
  await prereview("skeleton", findings, part);
  if (gate.status !== "passed") return gate.stop;
  await record(...FREEZE());
  await record("skeleton");
  return null;
}
const docPaths = [OUTLINE, MANIFEST];
// G009: the lanes, their lens texts and the role settings are skeleton-review inputs, hashed by the skeleton key.
const laneWrite = await flow(["write", P("SKELETON-LANES.json")], JSON.stringify(A.laneInputs, null, 2));
if (laneWrite.code !== 0) return failedCall("skeleton lane inputs", laneWrite.stderr);
// A skeleton reviewed in this run invalidates every plan written against the old one (GSDF-24).
let skeletonFresh = false;
if ((await holds(...FREEZE())) && (await holds("skeleton")) && !a.replan) log("skeleton unchanged since its review passed");
else {
  skeletonFresh = true;
  const stop = await skeletonDone(await skeletonGate());
  if (stop) return stop;
  docPaths.push(P("OUTLINE-REVIEW.md"), ...((await wiringExists()) ? [WIRING] : []));
  await commitDocs(`docs(${N}): phase ${N} outline and skeleton review`, docPaths);
}

// ---- per-plan planning (GSDF-24, GSDF-25, GSDF-34) ----
phase("Plans");
let frozen = (await gsd(["outline", "parse", N])).json ?? {};
const rows = frozen.rows ?? outline?.rows ?? [];
const planIds = rows.map((r) => r.id);
freezeHash = await hashOf(...FREEZE());
async function supersede() {
  const moved = await gsd(["supersede", phaseDir, "--keep", planIds.join(",")]);
  for (const m of moved.json?.moved ?? []) log(`superseded ${typeof m === "string" ? m : m.from ?? JSON.stringify(m)}`);
}
await supersede();
const wiringText = (await flow(["read", WIRING])).json?.text ?? "";
// G039: the medium and low plan-review notes gsd-execute reads; the streams flow writes them once, at its join.
const notesPath = `${phaseDir}/plan-review-notes.json`;
streamed = planFlow === "streams" ? await planStreams() : null;
if (streamed?.stop) return streamed.stop;
// A plan with a valid record (unchanged since recorded, on the skeleton it was written on) and a passing structure check is kept (the
// check is returned). Kit feedback 87: a plan this run recorded before it stopped and edited since is kept and recorded again.
async function keptPlan(id) {
  const same = (await gsd(["revisions", "check", phaseDir, `plan:${id}`, "--settings", settingsDigest.plan])).code === 0;
  const own = !same && ownRecorded.includes(id);
  const st = !skeletonFresh && (same || own) ? await gsd(["verify", "plan-structure", planPath(id)]) : null;
  if (st?.code !== 0) return null;
  if (own) await recordPlan(id);
  log(own ? `plan ${id} kept: this run changed it after its record before it stopped; recorded again` : `plan ${id} kept: unchanged since recorded`);
  return st;
}
// The waves in order, each by `wave(ids)` (a stop, or null); between waves a stop request pauses the run (kit feedback 88).
async function eachWave(wave) {
  const all = [...new Set(rows.map((r) => Number(r.wave ?? 1)))].sort((x, y) => x - y).map((w) => rows.filter((r) => Number(r.wave ?? 1) === w).map((r) => r.id));
  for (const [i, ids] of all.entries()) {
    const stop = (i > 0 ? await pauseAsked("Plans", `after planner wave ${i} of ${all.length}`, { afterWave: i, nextWave: i + 1 }) : null) ?? (await wave(ids));
    if (stop) return stop;
  }
  return null;
}
// The plans of a wave without a valid record go to `plan`, all at once; a kept plan's review stream starts (`onKept`). failedOf: the first stop.
async function waveOf(ids, plan, onKept = null) {
  const todo = [];
  for (const id of ids) {
    const st = await keptPlan(id);
    if (!st) todo.push(id);
    else setStructureWarnings(id, st.json?.warnings);
    if (st && onKept) await onKept(id);
  }
  return { todo, outcomes: await parallel(todo.map((id) => () => plan(id))) };
}
function failedOf({ todo, outcomes }) {
  const i = outcomes.findIndex((o) => !o || o.stop);
  return i >= 0 ? outcomes[i]?.stop ?? failedCall(`planner ${todo[i]}`, null) : null;
}
// The staged flow: wave by wave; returns the stop, or null. The checker's reallocation runs it again. G015: the plans that finished are
// recorded before the batch stops, so a failed sibling does not drop them.
const stagedWaves = () => eachWave(async (ids) => {
  const w = await waveOf(ids, planOne);
  const recorded = await recordEach(w.todo.filter((_, i) => w.outcomes[i]?.ok), false);
  return failedOf(w) ?? recorded ?? (await contractGate("Plans"));
});
if (!streamed) {
  const stop = await stagedWaves();
  if (stop) return stop;
}
// O65 (kit-feedback 65): the planner waves keep their order (GSDF-24), but each plan is structure-checked and recorded on its own and
// its review stream (gsd-plan-review with `stream`) starts as soon as its planner returns. O67: the next wave's planners start once
// every stream of this wave froze; a frozen plan whose interface its stream changed passes the change on to its dependents.
async function planStreams() {
  const [reviews, planned, shape] = [new Map(), new Set(), new Map()];
  const startReview = async (id) => {
    if (!planReview) return;
    shape.set(id, await planInterface(id));
    reviews.set(id, workflow("gsd-plan-review", { phaseDir, plans: [id], stream: true, roles: roleOverrides, researchPath: approvedResearch, guidance: a.reviewGuidance ?? null, planSettings: settingsDigest.plan }).catch((e) => ({ status: "failed", plan: id, reason: `review stream ${id}: ${e?.message ?? e}` })));
  };
  if (planReview) await flow(["remove", notesPath]);
  const stop = await eachWave(async (ids) => {
    const failed = failedOf(await waveOf(ids, async (id) => {
      const o = await planOne(id);
      const s = o?.ok ? await structureFix(id, `planner:${id}`) : null;
      if (!o?.ok || s) return o?.ok ? { stop: s } : o;
      await recordPlan(id);
      planned.add(id);
      await startReview(id);
      return { ok: true };
    }, startReview));
    if (failed || !planReview) return failed ?? contractGate("Plans");
    // The wave's join: a stream that did not converge stops the run below. Kit feedback 67: no stream of this wave edits a plan now,
    // so the contract gate may revise any plan; what it changes passes on to the dependents like a stream's edit.
    if ((await Promise.all(ids.filter((id) => reviews.has(id)).map((id) => reviews.get(id)))).some((r) => r?.status !== "converged")) return "join";
    const cs = await contractGate("Plans");
    if (cs) return cs;
    const changed = new Map();
    for (const id of ids) {
      const now = await planInterface(id);
      if (shape.has(id) && !sameInterface(shape.get(id), now)) changed.set(id, { before: shape.get(id), after: now });
    }
    return propagate(changed);
  });
  const ids = planIds.filter((id) => reviews.has(id));
  const done = await Promise.all(ids.map((id) => reviews.get(id)));
  const reviewOf = new Map(ids.map((id, i) => [id, done[i]]));
  for (const [id, r] of reviewOf) log(`plan stream ${id}: review ${r?.status ?? "failed"}${r?.cycles ? ` after ${r.cycles} cycles` : ""}`);
  flowReport = { planFlow: "streams", streams: planIds.map((id) => ({ plan: id, planned: planned.has(id), review: reviewOf.get(id) ? reviewOf.get(id).status ?? "failed" : planReview ? "not started" : "off", cycles: reviewOf.get(id)?.cycles ?? 0, counts: reviewOf.get(id)?.counts ?? [] })), dependents };
  const bad = ids.map((id) => reviewOf.get(id)).find((r) => r?.status !== "converged");
  if (stop && stop !== "join" && !bad) return { stop: { ...stop, ...flowReport } };
  const s = bad && { stage: "Plan review", plan: bad.plan ?? null, reason: bad.reason ?? "plan review did not converge", issues: bad.issues ?? [], conflict: bad.conflict ?? null, counts: bad.counts ?? [] };
  if (bad) return { stop: bad.status === "needs-owner" ? result("needs-owner", { ...s, options: REVIEW_OPTIONS, answer: answers.guidance() }) : result("failed", s) };
  if (!planReview) return { ok: true };
  const notes = ids.flatMap((id) => reviewOf.get(id).issues ?? []);
  await flow(["write", notesPath], JSON.stringify(notes.map(({ plan, severity, description }) => ({ plan, severity, description })), null, 2));
  for (const r of done) for (const st of r.structure ?? []) setStructureWarnings(st.plan, st.warnings);
  advisories.push(...notes.map((x) => ({ lane: "plan-review", plan: x.plan ?? null, severity: x.severity, description: x.description })));
  return { ok: true };
}
// O67 (kit-feedback 67): the surface other plans build on: the artifacts and key_links of must_haves and the <interfaces> blocks.
async function planInterface(id) {
  const mh = (await gsd(["frontmatter", "get", planPath(id), "must_haves"])).json?.value ?? {};
  const text = (await flow(["read", planPath(id)])).json?.text ?? "";
  return { artifacts: mh.artifacts ?? [], key_links: mh.key_links ?? [], interfaces: [...text.matchAll(/<interfaces>([\s\S]*?)<\/interfaces>/g)].map((m) => m[1].trim()) };
}
function sameInterface(x, y) { return JSON.stringify(x) === JSON.stringify(y); }
// O67: every plan on disk whose depends_on names a changed plan gets one dependent stream for all its changed providers, all at once
// (each plan edited only by its own stream); a dependent whose own interface changed passes it on. The depends_on graph has no cycle.
async function propagate(changed) {
  try {
    while (changed.size) {
      const providersOf = new Map();
      for (const p of (await gsd(["phase-plan-index", N])).json?.plans ?? []) {
        const from = (p.depends_on ?? []).filter((d) => changed.has(d));
        if (from.length && planIds.includes(p.id)) providersOf.set(p.id, from);
      }
      if (!providersOf.size) return null;
      log(`plan interfaces changed: ${[...changed.keys()].join(", ")}; checking ${[...providersOf.keys()].join(", ")}`);
      const list = [...providersOf];
      const k = ++depRounds;
      const outs = await parallel(list.map(([id, from]) => () => dependentStream(id, from.map((plan) => ({ plan, path: planPath(plan), ...changed.get(plan) })), `${k}:${id}`)));
      const bad = outs.findIndex((o) => !o || o.stop);
      if (bad !== -1) return outs[bad]?.stop ?? failedCall(`dependent stream ${list[bad][0]}`, null);
      changed = new Map(list.map(([id], i) => [id, outs[i].changed]).filter(([, c]) => c));
    }
    return null;
  } finally {
    await partFindings(depLedger, "dependents");
  }
}
// O67: a read-only dependency check of one plan against its providers' interface before and after their revision; its blockers go to
// the plan's own planner session, and the check runs again while its count falls (cap maxCheckIterations, the dependents part).
async function dependentStream(id, providers, stream) {
  const before = await planInterface(id);
  for (let round = 1; ; round++) {
    const prompt = await promptFor("depcheck", { id, providers, freeze: freezeHash, planHash: await hashOf(`plan:${id}`) });
    depLedger.ran = true;
    const c = await callTwice(prompt, await checkerOpts(`depcheck-${id}-${round}`, S.issues, [id, ...providers.map((p) => p.plan)]));
    if (c.result === null) return { stop: failedCall(`dependency check ${id}`, c.reason) };
    // Kit feedback 64: a blocker of an earlier round that this check no longer raises was resolved by the revision.
    const [d] = await depLedger.step(`dep:${stream}:${round}`, [{ op: "dep", plan: id, stream, round, providers: providers.map((p) => p.plan), issues: c.result.issues ?? [], cap: maxCheckIterations }]);
    dependents.splice(0, dependents.length, ...d.dependents);
    const after = d.open.length ? null : await planInterface(id);
    if (after) return { changed: sameInterface(before, after) ? null : { before, after } };
    if (d.stuck) return { stop: owner("Dependents", `${id} still uses the old interface of ${providers.map((p) => p.plan).join(", ")} after ${round - 1} revisions (${d.open.length} blockers)`, { plan: id, issues: d.open, options: ["give guidance and rerun", "revise the plan by hand, then rerun", "abandon"], answer: answers.fix(`revise ${planPath(id)} to the providers' interface by hand and record it (ph gsd revisions record ${N} plan:${id})`) }) };
    const r = await reviseCall(`planner:${id}`, `deprevise-${id}-${round}`, [id], d.open);
    if (isConflict(r.result)) await depLedger.step(`dep:${stream}:${round}:conflict`, [{ op: "conflict", plans: [id] }]);
    if (ownerMarker(r.result)) return { stop: ownerStop("Dependents", r.result) };
    if (r.result === null) return { stop: failedCall(`dependent revision ${id}`, r.reason) };
    const s = await recordEach([id], false);
    if (s) return { stop: s };
  }
}
async function planOne(id) {
  // F40 (kit-feedback 40): forceProceed never accepts a plan a planner of this run wrote (plan lifecycle in plan-progress.json).
  const marked = await flow(["plan-mark", phaseDir], { run: runId, plans: [id], stage: "planned" });
  if (marked.code !== 0) return { stop: result("failed", { reason: `plan state: ${marked.json?.reason ?? marked.json?.error ?? `exit ${marked.code}`}` }) };
  const entry = ((manifestFresh ?? frozen.manifest)?.plans ?? []).find((p) => p.id === id) ?? { id };
  const carried = warnings.filter((w) => w.includes(`(${id})`));
  const contract = contractsOn ? { show: (await gsd(["contracts", "show", N, "--plan", id])).json } : null;
  const { result: r, reason } = await plannerCall(`planner:${id}`, `plan-${id}`, "write", { id, entry, wiringText, carried, contract, digest: freezeHash }, { judges: await plansJudges([id]) });
  if (fatal(reason)) return { stop: failedCall(`planner ${id}`, reason) };
  if (ownerMarker(r)) return { stop: ownerStop("Plan", r) };
  const known = A.knownMarkers.some((m) => markerOf(r).includes(m));
  if (!known && !(await flow(["exists", planPath(id)])).json?.exists?.[planPath(id)]) return { stop: owner("Plan", `planner for ${id} returned no recognised marker and wrote no plan (inconclusive)`, { options: ["rerun", "adjust CONTEXT", "abandon"], answer: answers.rerun("") }) };
  if (!known) log(`planner ${id}: no recognised marker; the structure check decides`);
  return { ok: true };
}
// Plan-structure warnings do not block (plan-checks.mjs:78); a check replaces the warnings of its plan.
function setStructureWarnings(id, list) {
  const prefix = `plan-structure (${id}): `;
  for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i].startsWith(prefix)) warnings.splice(i, 1);
  for (const w of list ?? []) warnings.push(`${prefix}${typeof w === "string" ? w : JSON.stringify(w)}`);
}
async function structureFix(id, session) {
  const verify = async () => { const st = await gsd(["verify", "plan-structure", planPath(id)]); setStructureWarnings(id, st.json?.warnings); return st; };
  let st = await verify();
  if (st.code === 0) return null;
  const { result: r, reason } = await plannerCall(session, `fix-${id}`, "fix", { id, errors: st.json?.errors ?? [st.json?.error ?? `exit ${st.code}`], digest: freezeHash }, { judges: await plansJudges([id]) });
  if (fatal(reason)) return failedCall(`structure fixer ${id}`, reason);
  if (ownerMarker(r)) return ownerStop("Plan", r);
  st = await verify();
  return st.code === 0 ? null : result("failed", { reason: `plan ${id} still fails verify plan-structure`, errors: st.json?.errors ?? [] });
}
// A plan's record: its revisions key with the planner's settings, and its mark in plan-progress.json (a resumed run keeps it).
async function recordPlan(id) {
  await record(`plan:${id}`, "--settings", settingsDigest.plan);
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
  checked = streamed ? await withPart("join", (l) => checkerJoin(planIds, l)) : await checkerLoop(planIds, false, again ? `reallocated-${again}` : undefined);
  if (!checked.reallocate) break;
  // Kit feedback 69: plans the checker could only fix by a new allocation go back to the outline stage, then to the checker again.
  phase("Outline");
  const back = await reallocateStage(checked.reallocate);
  if (back.stop) return back.stop;
  phase("Checker");
}
if (checked.stop) return checked.stop;
const checkerContracts = await contractGate("Checker");
if (checkerContracts) return checkerContracts;
if (!checked.skipped) await record(...CHECKED());
if (!checked.skipped && recheckMode === "incremental") await record("checkedbody");
docPaths.push(...planIds.map(planPath));

// ---- optional plan review (GSDF-37) ----
if (planReview && !streamed) {
  phase("Plan review");
  const pr = await workflow("gsd-plan-review", { phaseDir, plans: planIds, roles: roleOverrides, researchPath: approvedResearch, guidance: a.reviewGuidance ?? null, planSettings: settingsDigest.plan });
  // The owner answers here and reruns: reviewGuidance goes to the review prompts, a CONTEXT decision is read by them too.
  const stop = { stage: "Plan review", reason: pr?.reason ?? "plan review did not converge", issues: pr?.issues ?? [], conflict: pr?.conflict ?? null, counts: pr?.counts ?? [] };
  if (pr?.status !== "converged") return pr?.status === "failed" ? result("failed", stop) : result("needs-owner", { ...stop, options: REVIEW_OPTIONS, answer: answers.guidance() });
  for (const s of pr.structure ?? []) setStructureWarnings(s.plan, s.warnings);
  advisories.push(...(pr.issues ?? []).map((x) => ({ lane: "plan-review", plan: x.plan ?? null, severity: x.severity, description: x.description })));
  const reviewContracts = await contractGate("Plan review");
  if (reviewContracts) return reviewContracts;
}

// ---- coverage and handoff (GSDF-29, GSDF-36) ----
phase("Handoff");
return await handoffStage(planIds, docPaths, checked.override);

// The deterministic probes (verb plan-probes) over the phase's plans, or over the gap plans.
async function countProbes(scopeIds, gapScoped) {
  const plans = gapScoped ? ["--plans", scopeIds.join(",")] : [];
  const runs = { "verify-command-paths": await gsd(["check", "verify-command-paths", N, ...plans]), "verify-failure-directions": await gsd(["check", "verify-failure-directions", N, ...plans]), owns: await gsd(["check", "owns", N, ...plans]) };
  return (await flow(["plan-probes"], { runs, filesPerPlan: Boolean(reallocRounds) && !gapScoped, tracerExtraFiles })).json?.found ?? [];
}
// One fresh read-only checker over the plans `live` (GSDF-26), with the probe file and the still-open blockers `earlier`. In the
// streams flow the carried warnings are sorted, so the order in which the plan streams finished does not change the prompt.
async function checkerCall(iter, live, gapScoped, probeFile, earlier, judged) {
  const carried = streamed ? [...warnings].sort() : warnings;
  const sendBack = reallocRounds > 0 && !gapScoped;
  // The Files/plan thresholds grow with the phase's files, so the checker judges them against this phase's plans.
  const filesPerPlan = sendBack ? null : (await gsd(["check", "owns", N])).json?.files_per_plan;
  const prompt = await promptFor("checker", { live, gapScoped, filesPerPlan, tracerExtraFiles, sendBack, probeFile, carried, earlier, freeze: freezeHash, checked: await hashOf(...CHECKED()) });
  const c = await callTwice(prompt, await checkerOpts(`checker-${iter}`, sendBack ? S.checkerRealloc : S.checker, judged));
  // A reply's info issues go to the advisories; the others are warnings or blockers (unknown severity = blocker).
  const sev = (i) => String(i.severity).toLowerCase();
  for (const i of c.result?.issues ?? []) if (sev(i) === "info") advisories.push({ lane: "checker", plan: i.plan ?? null, description: i.description });
  return { ...c, findings: (c.result?.issues ?? []).filter((i) => sev(i) !== "info").map((i) => ({ ...i, severity: sev(i) === "warning" ? "warning" : "blocker" })) };
}
async function checkerSkipped() {
  const same = await holds(...CHECKED());
  if (same) log("checker skipped: plans unchanged since the last passing check");
  return same;
}
// The checker loop (part checker, checker:<part> after a reallocation, or gaps). The cap and the stall test count per plan
// (kit-feedback 9): a plan that stops converging leaves the loop as stuck, the others go on. The round op keeps the counts, the stuck
// plans, the carried warnings and the blockers no checker confirmed resolved (kit-feedback 44), asked again as `earlier`.
function checkerLoop(scopeIds, gapScoped, part) {
  return withPart(gapScoped ? "gaps" : part ? `checker:${part}` : "checker", (ledger) => checkerRounds(scopeIds, gapScoped, ledger), part);
}
async function checkerRounds(scopeIds, gapScoped, ledger) {
  if (!gapScoped && !a.replan && (await checkerSkipped())) return { skipped: true };
  // Kit feedback 76: after a plan edit the checker agent judges the changed plans and the plans linked to them (null = all plans).
  const scope = gapScoped ? null : await recheckScope(scopeIds, ledger.name);
  let [agentScope, earlier, stuckKeys] = [scope ? scope.agent : scopeIds, [], []];
  for (let iter = 1; ; iter++) {
    // Kit feedback 88: the last round's revisions are recorded; a stop request ends the run here. Kit feedback 67 F2: a CONTRACT_CHANGE
    // of the last round has its consumers revised before the checker reads them again.
    const pause = iter > 1 ? await pauseAsked("Checker", `before checker round ${iter}`, { round: iter }) : null;
    const contractStop = pause ?? (contractDirty && !gapScoped ? await contractGate("Checker") : null);
    if (contractStop) return { stop: contractStop };
    const live = scopeIds.filter((id) => !stuckKeys.includes(id) && agentScope.includes(id));
    const probeIssues = await countProbes(scopeIds, gapScoped);
    const probeFile = `${phaseDir}/checker-probes.json`;
    await flow(["write", probeFile], JSON.stringify({ iteration: iter, probes: probeIssues }, null, 2));
    // Kit feedback 69: a probe that says reallocate ends the round before the checker agent is paid for.
    const sendBack = reallocLeft > 0 ? (await ledger.step(`i${iter}:sendback`, [{ op: "accept", list: probeIssues.filter((i) => i.outcome === "reallocate" && i.severity === "blocker" && Boolean(i.plan) && scopeIds.includes(i.plan)), scope: scopeIds }]))[0].list : [];
    if (sendBack.length) return { reallocate: sendBack };
    const runChecker = !scope || live.length || earlier.length;
    if (runChecker) ledger.ran = true;
    else log(`checker iteration ${iter}: no plan for the checker agent (a write-set edit only); the probes ran on all ${scopeIds.length} plans`);
    const c = runChecker ? await checkerCall(iter, live, gapScoped, probeFile, earlier, scope ? agentScope : scopeIds) : { result: { issues: [], resolved: [] }, findings: [] };
    if (c.result === null) return { stop: failedCall("plan checker", c.reason) };
    // Only blockers drive the stall test, the cap and the revisions; warnings are carried (kit-feedback 13, 20). A blocker forceProceed
    // names is accepted, never counted, revised or carried (kit feedback 71).
    const [r] = await ledger.step(`i${iter}`, [{ op: "round", scope: scopeIds, live, resolved: (c.result.resolved ?? []).map((x) => x.id), issues: c.result.issues ?? [], checkerIssues: c.findings, probes: probeIssues, cap: maxCheckIterations, reallocate: reallocLeft > 0 }]);
    log(`checker iteration ${iter}: ${c.findings.length} checker + ${probeIssues.length} probe issues, ${r.blockers} blockers (${r.confirmed} of ${r.earlier} earlier blockers confirmed resolved)`);
    if (r.reallocate.length) return { reallocate: r.reallocate };
    for (const x of r.newlyStuck) log(`checker: ${x.key ?? "phase"} left the loop: ${x.why}`);
    [earlier, stuckKeys] = [r.next, r.stuck.map((x) => x.key)];
    const revise = new Map(r.revise);
    if (!revise.size) break;
    // Every plan is stuck, so no plan is left to revise and the open phase-level issues stop with them.
    if (scopeIds.every((id) => stuckKeys.includes(id))) { await ledger.step(`i${iter}:stuck-all`, [{ op: "stuck-all" }]); break; }
    const perPlan = [...revise].filter(([key]) => key !== null);
    const v = await revisePlans(perPlan, (id) => `revise-${id}-${iter}`, gapScoped);
    if (scope) agentScope = [...new Set([...agentScope, ...v.answered, ...(await linkedPlans(v.answered, scopeIds))])];
    // kit-feedback 37: a REVISION_CONFLICT on one plan does not skip the phase-level revision; the conflict stops the loop after it.
    const conflict = v.owned ? ownerStop("Checker", v.owned) : null;
    if (v.conflicted.length) await ledger.step(`i${iter}:conflict`, [{ op: "conflict", keys: v.conflicted }]);
    if (!conflict && v.missed) return { stop: failedCall(`planner revision ${v.missed.id} (checker iteration ${iter})`, v.missed.reason) };
    if (!conflict && v.stop) return { stop: v.stop };
    if (revise.get(null)?.length) {
      const p = await reviseCall(gapScoped ? "planner:gaps" : "planner:outline", `revise-phase-${iter}`, scopeIds, revise.get(null));
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
// The end of a checker loop or join: passed, or the stuck plans as a needs-owner stop or a forceProceed override (GSDF-28). The settle
// op decides what forceProceed may accept (kit feedback 71: only the {plan, dimension} issues it names, or with `{reason}` alone every
// issue still stuck; F40: never a plan a planner of this run wrote); the run writes it to STATE and accepted-issues.json (89).
async function settleStuck(ledger, scopeIds) {
  const [s] = await ledger.step("settle", [{ op: "settle", scope: scopeIds }]);
  warnings.push(...s.carried);
  if (s.passed) return { passed: true };
  if (s.stop === "stuck") return { stop: owner("Checker", s.why, { issues: s.issues, options: ["force proceed (rerun with forceProceed {reason})", "give guidance and retry", "abandon"], answer: answers.forceProceed(s.answer) }) };
  // The issues forceProceed {reason, issues} named do not cover a stuck one: the run stops with both lists.
  if (s.stop === "uncovered") return { stop: owner("Checker", s.why, { issues: s.issues, accepted: s.accepted, options: ["rerun with forceProceed {reason, issues} naming these issues too (plan and dimension)", "give guidance and retry", "abandon"], answer: answers.forceProceed(s.answer) }) };
  if (s.stop === "fresh") return { stop: owner("Checker", `forceProceed refused: ${s.plans.join(", ")} written by a planner in this run; a rerun can accept them`, { issues: s.issues, options: ["rerun with forceProceed {reason}", "give guidance and retry", "abandon"], answer: answers.rerun("start a new run (not --resume) with the same forceProceed; the checker judges the kept plans again") }) };
  const saved = await gsd(["state", "override", "--phase", N], { reason: a.forceProceed.reason, issues: s.lines });
  const kept = saved.code === 0 ? await flow(["accepted-record", phaseDir], { run: runId, reason: a.forceProceed.reason, issues: s.override.accepted }) : saved;
  if (kept.code !== 0) return { stop: failedCall(saved.code !== 0 ? "state override failed" : "accepted-issue record failed", kept.json?.error ?? `exit ${kept.code}`) };
  if (s.warnAll) warnings.push("forceProceed without issues accepted every issue still stuck; name them with forceProceed.issues [{plan, dimension}] to accept only those");
  log(`override: ${s.override.why || `${s.override.accepted.length} accepted issues`}; proceeding (${a.forceProceed.reason})`);
  return { passed: true, override: s.override };
}
// Kit feedback 76 F2 (gsd.checker_recheck incremental): after an edit of some plans the checker agent judges those plans and the plans
// linked to them; every probe still runs on all plans. Anything else that changed, a missing record or an unknown part list is a full
// check (null). The recheck part of plan-progress.json sorts the labels and keeps the scope the result reports.
async function recheckScope(scopeIds, part) {
  if (recheckMode !== "incremental" || a.replan) return null;
  const chk = await gsd(["revisions", "check", phaseDir, ...CHECKED()]);
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
// The plans a plan edit can affect (verb plan-linked), from the plan index, the manifest and each plan's key_links and write set.
async function linkedPlans(ids, scopeIds) {
  if (!ids.length) return [];
  const index = (await gsd(["phase-plan-index", N])).json?.plans ?? [];
  const manifest = (await gsd(["outline", "parse", N])).json?.manifest?.plans ?? [];
  const plans = {};
  for (const id of scopeIds) plans[id] = { mustHaves: (await gsd(["frontmatter", "get", planPath(id), "must_haves"])).json?.value ?? {}, written: (await gsd(["frontmatter", "get", planPath(id), "files_modified"])).json?.value ?? [], owns: await planOwns(id) };
  return (await flow(["plan-linked"], { ids, scope: scopeIds, index, manifest, plans })).json?.linked ?? [];
}
// Kit feedback 69: plans the checker could fix only by a new allocation go back to the outline stage, for those plans only. The outline
// writer changes their owns, the skeleton is reviewed again on the new allocation and recorded, plans that did not change keep their
// records, and the plans whose allocation changed (and new ones) are written again; the caller then runs the checker again.
async function reallocateStage(sent) {
  // The realloc part of plan-progress.json counts the rounds this run used; a round is used when it begins.
  const [{ round, left }] = await planStep("plan-realloc", "realloc", `r${reallocRounds - reallocLeft + 1}`, [{ op: "begin", rounds: reallocRounds }]);
  reallocLeft = left;
  const named = [...new Set(sent.map((i) => i.plan))];
  log(`checker: ${named.join(", ")} go back to the outline (reallocation ${round} of ${reallocRounds})`);
  const before = (await gsd(["outline", "parse", N])).json ?? {};
  const valid = [];
  for (const id of planIds) if (!named.includes(id) && (await holds(`plan:${id}`, "--settings", settingsDigest.plan))) valid.push(id);
  const lines = (await outlineCheck()).json?.files_per_plan;
  const { result: r, reason } = await plannerCall("planner:outline", `reallocate-${round}`, "realloc", { round, named, lines, sent, checkArgs: outlineCheckArgs, digest: await hashOf("inputs") }, { judges: await outlineJudges() });
  if (fatal(reason) || r === null) return { stop: failedCall("outline reallocation", reason) };
  if (ownerMarker(r)) return { stop: ownerStop("Checker", r) };
  const fixedAgain = await fixOutline(2, "Checker");
  if (fixedAgain.stop) return fixedAgain;
  outline = fixedAgain.check.json;
  const after = (await gsd(["outline", "parse", N])).json ?? {};
  const diff = (await flow(["plan-realloc-diff"], { before, after, named, planIds, sent })).json;
  if (diff.unchanged.length) return { stop: owner("Checker", `outline reallocation left ${diff.unchanged.join(", ")} unchanged`, { issues: sent, options: ["give guidance and rerun", "rerun with forceProceed {reason, issues: [{plan, dimension: \"files-per-plan\"}]} to accept the size", "abandon"], answer: answers.forceProceed(diff.accept) }) };
  planIds.splice(0, planIds.length, ...diff.idsAfter);
  rows.splice(0, rows.length, ...(after.rows ?? []));
  frozen = after;
  const w = wiringInUse && (await wiringExists()) ? await runArchitect(`architect-reallocate-${round}`, `Reallocation: the allocation of ${diff.changed.join(", ")} changed in the outline; realign ${WIRING} with it.`) : null;
  if (w?.stop) return w;
  if (w) outlineChangeIssues = w.changes;
  [sk, skeletonFocus] = [{ ...sk, issues: [], passCounts: [], failures: [], laneIssueIds: [] }, { named, changed: diff.changed }];
  const gate = await skeletonGate();
  skeletonFocus = null;
  const stop = await skeletonDone(gate, `reallocated-${round}`);
  if (stop) return { stop };
  for (const f of [P("OUTLINE-REVIEW.md"), ...((await wiringExists()) ? [WIRING] : [])]) if (!docPaths.includes(f)) docPaths.push(f);
  freezeHash = await hashOf(...FREEZE());
  await supersede();
  // The outline moved the freeze key under every plan; the plans that were valid and whose allocation did not change are valid still.
  for (const id of valid) if (diff.idsAfter.includes(id) && !diff.changed.includes(id)) await recordPlan(id);
  skeletonFresh = false;
  const [done] = await planStep("plan-realloc", "realloc", `r${round}:done`, [{ op: "done", round, plans: named, changed: diff.changed, removed: diff.removed, issues: sent.map(({ plan, probe, description }) => ({ plan, ...(probe ? { probe } : {}), description })) }]);
  reallocated.splice(0, reallocated.length, ...done.reallocated);
  const waves = await stagedWaves();
  return waves ? { stop: waves } : { ok: true };
}
// O65 (kit-feedback 65): the streams flow's one join point (part join). The checker reads the frozen set once, with the probes; each plan
// it names gets its blockers back in its own route stream (revision, structure check, record, this plan's probes and a resolution check
// of only its checker blockers), all plans at once, under the per-plan cap and stall rule (kit-feedback 9). Phase-level blockers get
// the phase-level revision after the plan streams, so no plan has two editors at once; a final probe pass closes the join.
async function checkerJoin(scopeIds, ledger) {
  if (!a.replan && (await checkerSkipped())) return { skipped: true };
  const probeFile = `${phaseDir}/checker-probes.json`;
  const [accepted] = await ledger.step("probes", [{ op: "accept", list: await countProbes(scopeIds, false), scope: scopeIds }]);
  await flow(["write", probeFile], JSON.stringify({ iteration: 1, probes: accepted.list }, null, 2));
  // Kit feedback 76: the one checker call judges the changed plans and the plans linked to them (no call for a write-set edit only).
  const scope = await recheckScope(scopeIds, ledger.name);
  const runChecker = !scope || scope.agent.length;
  if (runChecker) ledger.ran = true;
  else log("checker join: no plan for the checker agent (a write-set edit only); the probes ran on all plans");
  const c = runChecker ? await checkerCall(1, scope ? scope.agent : scopeIds, false, probeFile, [], scope ? scope.agent : scopeIds) : { result: { issues: [], resolved: [] }, findings: [] };
  if (c.result === null) return { stop: failedCall("plan checker", c.reason) };
  const [{ keys }] = await ledger.step("join", [{ op: "join", scope: scopeIds, issues: c.result.issues ?? [], checkerIssues: c.findings, probes: accepted.list }]);
  log(`checker join: ${c.findings.length} checker + ${accepted.list.length} probe issues, blockers for ${keys.length ? keys.map((k) => k ?? "phase").join(", ") : "no plan"}`);
  // O67: each revised plan's interface before its first join revision, to pass a change on to its dependents.
  const shapeBefore = new Map();
  // One key's stream: its rounds count checker judgments of the key, the first one being the join's checker.
  async function route(key) {
    const name = key ?? "phase";
    for (let round = 1; ; round++) {
      const [gr] = await ledger.step(`route:${name}:${round}`, [{ op: "route", key, round, cap: maxCheckIterations }]);
      if (gr.stuck) { log(`checker: ${name} left the join: ${gr.log}`); return { stuck: gr.stuck }; }
      const scope = key ? [key] : scopeIds;
      for (const id of scope) if (!shapeBefore.has(id)) shapeBefore.set(id, await planInterface(id));
      const r = await reviseCall(key ? `planner:${key}` : "planner:outline", `revise-${name}-${round}`, scope, gr.open);
      if (isConflict(r.result)) await ledger.step(`route:${name}:${round}:conflict`, [{ op: "conflict", keys: [key] }]);
      if (ownerMarker(r.result)) return { conflict: ownerStop("Checker", r.result) };
      if (r.result === null) return { stop: failedCall(`planner revision ${name} (checker join round ${round})`, r.reason) };
      const s = await recordEach(scope, false);
      if (s) return { stop: s };
      // The resolution check of this key's checker blockers; the blockers it did not confirm, then this key's probe blockers, stay open.
      const hashKey = key ? `plan:${key}` : "checked";
      const v = gr.asked.length ? await callTwice(await promptFor("join-resolve", { scope, asked: gr.asked, freeze: freezeHash, key: hashKey, hash: await hashOf(hashKey) }), await checkerOpts(`recheck-${name}-${round}`, S.resolution, scope)) : null;
      if (v && v.result === null) return { stop: failedCall(`plan checker resolution ${name}`, v.reason) };
      const [d] = await ledger.step(`route:${name}:${round}:done`, [{ op: "route-done", key, resolved: v ? (v.result.resolved ?? []).map((x) => x.id) : null, probes: await countProbes(scopeIds, false) }]);
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
  if (keys.includes(null) && scopeIds.every((id) => stuckPlans.includes(id))) await ledger.step("stuck:phase", [{ op: "stuck", key: null, why: "phase: no plan left to revise", join: true }]);
  else if (keys.includes(null)) {
    const r = await route(null);
    if (r.conflict || r.stop) return { stop: conflict ?? r.conflict ?? r.stop };
    if (r.stuck) await ledger.step("stuck:phase", [{ op: "stuck", key: null, ...r.stuck }]);
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
  const contractStop = gap ? null : await contractGate("Handoff", { complete: true });
  if (contractStop) return contractStop;
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
  await record("handoff");
  const total = ((await gsd(["phase-plan-index", N])).json?.plans ?? []).length || ids.length;
  await gsd(["state", "planned-phase", "--phase", N, "--plans", String(total)]);
  await gsd(["roadmap", "annotate-dependencies", N]);
  await commitDocs(`docs(${N}): ${gap ? "gap-closure plans" : "plans"} for phase ${N}`, [...docs, ...ids.map(planPath)]);
  return result("planned", { coverage: cov.json, waves: h.json?.waves ?? [], planRevision: h.json?.planRevision ?? null, sharedChanges: [...sharedChanges, ...(h.json?.sharedChanges ?? [])], plans: ids, ...(gap ? { gap } : {}), ...(override ? { override } : {}) });
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
  const nextNo = Math.max(0, ...before.map((p) => Number(String(p.id).split("-").pop()) || 0)) + 1;
  const { result: r, reason } = await plannerCall("planner:gaps", "gaps", "gaps", { gaps: ver.json?.gaps ?? [], nextNo, kept: pending(before), digest: inputDigest }, { judges: await outlineJudges() });
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
