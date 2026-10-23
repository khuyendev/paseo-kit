export const meta = {
  name: "gsd-execute",
  description: "GSD phase execution: safe-resume gate, executors per handoff wave, green gate with bounded fix rounds, bounded code review, orchestrator commits",
  phases: [{ title: "Preconditions" }, { title: "Baseline" }, { title: "Wave" }, { title: "Gate" }, { title: "Review" }, { title: "Commit" }, { title: "Batch" }],
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

const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const EXEC_SCHEMA = {
  type: "object",
  properties: {
    taskResults: { type: "array", items: { type: "object", properties: { task: { type: "string" }, status: { type: "string", enum: ["implemented", "partial", "blocked", "skipped"] }, evidence: { type: "string" } }, required: ["task", "status"] } },
    deviations: { type: "array" },
    resolvedRequests: { type: "array", items: { type: "string" } },
    requests: { type: "array", items: { type: "object", properties: { path: { type: "string" }, change: { type: "string" }, reason: { type: "string" } }, required: ["path", "change"] } },
  },
  required: ["taskResults"],
};
const INSTANCE_SCHEMA = { type: "object", properties: { file: { type: "string" }, line: { type: "number" } }, required: ["file"] };
// G056: the gate reads trigger, likelihood, confidence and file; a reply without them is re-asked by the schema retry
// instead of being recorded as a low-confidence (downgraded) finding.
const FINDINGS_SCHEMA = { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { id: { type: "string" }, severity: { type: "string", enum: SEVERITIES }, trigger: { type: "string" }, likelihood: { type: "string" }, confidence: { type: "number" }, impact: { type: "string" }, file: { type: "string" }, line: { type: "number" }, description: { type: "string" }, introduced: { type: "boolean" }, class: { type: "string" }, instances: { type: "array", items: INSTANCE_SCHEMA } }, required: ["severity", "description", "trigger", "likelihood", "confidence", "file"] } } }, required: ["findings"] };
const VERDICT_SCHEMA = { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, verdict: { type: "string", enum: ["confirmed", "refuted", "uncertain"] }, evidence: { type: "string" } }, required: ["id", "verdict"] } } }, required: ["verdicts"] };
const RESOLUTION_SCHEMA = { type: "object", properties: { resolution: { type: "array", items: { type: "object", properties: { id: { type: "string" }, resolved: { type: "boolean" }, evidence: { type: "string" } }, required: ["id", "resolved"] } } }, required: ["resolution"] };
const FIXER_SCHEMA = { type: "object", properties: { resolvedRequests: { type: "array", items: { type: "string" } }, requests: EXEC_SCHEMA.properties.requests, status: { type: "string", enum: ["fixed", "unresolved"] }, attempts: { type: "number" }, remaining_failures: { type: "number" }, evidence: { type: "string" }, lastEdit: { type: "string", enum: ["verified", "unverified", "none"] } }, required: ["status"] };
const QUOTA = /usage limit|rate limit|\b429\b|too many requests|RESOURCE_EXHAUSTED|quota/i;

// ---- arguments (GSDF-93) ----
const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const planFilter = a.plans ? (Array.isArray(a.plans) ? a.plans : String(a.plans).split(",")).map((s) => String(s).trim()).filter(Boolean) : null;
if (planFilter && planFilter.some((id) => !/^\d+(\.\d+)?-\d+$/.test(id))) return { status: "failed", reason: "plans must be plan ids NN-MM" };
const waveFilter = a.wave === undefined ? null : Number(a.wave);
if (waveFilter !== null && !(Number.isInteger(waveFilter) && waveFilter >= 1)) return { status: "failed", reason: "wave must be an integer >= 1" };
const cfg = await loadCfg();
const g = cfg.gsd;
const cmds = cfg.adapter.commands;
const execMode = g.execution_mode;
const worktreeMode = g.isolation === "worktree";
const limit = g.parallelization.enabled ? Math.min(g.parallelization.max_concurrent ?? cfg.max_subagents, cfg.max_subagents) : 1;
// gsd.code_review: plans reviewed at once and the independent reviewers of each plan (none = one, per gsd.roles.reviewer).
const reviewLimit = Math.max(1, Math.min(g.code_review.max_concurrent, cfg.max_subagents));
const reviewers = g.code_review.reviewers.length ? g.code_review.reviewers : [{}];
const N = phaseNumber(phaseDir);
const nn = phaseDir.split("/").pop().split("-")[0];
const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
const haltPath = (id) => `${phaseDir}/${id}-HALT.json`;
const PROGRESS = `${phaseDir}/execute-progress.json`;
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
const stackSkill = cfg.adapter.stack_skill ? `.claude/skills/${cfg.adapter.stack_skill}/SKILL.md` : null;
const waveResults = [];
// Shared changes (requests no open plan owns, the plans' <shared_changes> of each execution wave) and cross-plan
// requests live in execute-progress.json, so a stopped run hands them to the next one (G074, G089).
let sharedChanges = [];
let pendingRequests = {};
const skipped = [];
const events = [];
const worktrees = {};
const seeds = {};
const integrationFiles = new Set();
const ev = (e) => { events.push(e); log(`event ${e}`); };
const result = (status, extra = {}) => ({ status, phaseDir, mode: execMode, isolation: g.isolation, waves: waveResults, sharedChanges, ...(Object.keys(pendingRequests).length ? { requests: pendingRequests } : {}), ...(skipped.length ? { skipped } : {}), events, ...extra });
const owner = (stage, reason, extra = {}) => result("needs-owner", { stage, reason, ...extra });
const digestOf = async (input) => (await flow(["digest"], input)).json?.hash ?? "none";

// Bounded pool: at most `limit` executors at a time (GSDF-93); never above max_subagents.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await parallel(Array.from({ length: Math.min(n, items.length) }, () => async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// ---- preconditions (GSDF-40, GSDF-11, GSDF-02, GSDF-39, GSDF-64) ----
phase("Preconditions");
const guard = await flow(["cwd-guard", cfg.worktree_dir]);
if (guard.code !== 0) return result("refused", { reason: (guard.json?.problems ?? ["cwd guard failed"]).join("; "), stranded: guard.json?.stranded ?? [], dirty: guard.json?.dirty ?? [] });
// kit-feedback 2: execute writes the code root and its phase directory, so it holds the phase lease and the root writer lease
// for the whole run. Planning of another phase may run meanwhile; another plan of this phase, a debug or a quick run may not.
const phaseLease = await flow(["lock", `phase-${nn}`, runId, "gsd-execute"]);
if (phaseLease.code !== 0) return result("refused", { reason: `${leaseText(phaseLease.json, `phase ${N}`)}; execute starts after it ends` });
const lease = await flow(["lock", "debug", runId, "gsd-execute"]);
if (lease.code !== 0) {
  await flow(["unlock", `phase-${nn}`, phaseLease.json.token]);
  return result("refused", { reason: `${leaseText(lease.json)}; execute starts after it ends` });
}
try {
const anti = await flow(["anti-patterns", phaseDir]);
if (anti.code !== 0) return owner("Execute", `blocking anti-patterns need three written answers each in ${anti.json?.answersFile}: ${(anti.json?.unanswered ?? []).join(", ")}; run gsd-discuss ${N} to write them (it reads CONTEXT), or write them with node ${FLOW} write ${anti.json?.answersFile} (JSON on stdin)`, { rows: anti.json?.unanswered ?? [] });
const prefix = a.gapsOnly ? "gap-" : "";
// A malformed handoff file throws here and the callers return it as a failed status naming the file (G098).
async function readHandoff() {
  const list = [];
  for (let k = 1; ; k++) {
    const file = `${phaseDir}/handoff/${prefix}w${k}.args.json`;
    const r = await flow(["read", file]);
    if (!r.json?.exists) break;
    let h;
    try { h = JSON.parse(r.json.text); } catch (e) { throw new Error(`${file} is not valid handoff JSON: ${e.message}`); }
    list.push({ k, waveId: `${prefix}w${k}`, ...h });
  }
  return list;
}
let handoff;
try { handoff = await readHandoff(); } catch (e) { return result("failed", { reason: e.message }); }
if (!handoff.length) return result("refused", { reason: `no handoff files in ${phaseDir}/handoff/ (${prefix}w1.args.json); plan the phase first` });
const index = async () => (await gsd(["phase-plan-index", N])).json ?? { plans: [] };
let idx = await index();
const planInfo = (id) => idx.plans.find((p) => p.id === id) ?? {};
// CR-GSF-02: a SUMMARY ends only the coding stage; a plan is done when its commit is tracked in this record.
const progressRead = await flow(["read", PROGRESS]);
const progress = progressRead.json?.exists ? JSON.parse(progressRead.json.text) : { plans: {} };
const tracked = (id) => progress.plans[id]?.tracked === true;
const committedOnly = (id) => progress.plans[id]?.commit !== undefined && !tracked(id);
const saveProgress = async () => (await flow(["write", PROGRESS], JSON.stringify(progress, null, 2))).code === 0;
pendingRequests = progress.requests ??= {};
sharedChanges = progress.shared ??= [];
// kit-feedback 53: a granted file is integration output from the start of the run (the resume gate and the wave commit).
await grantedFiles();
// G075: the handoff must still describe the plans on disk. A failed or killed handoff rerun can leave a cut-short wave
// set (the manifest, written last, names the wave count), and a plan edited, added or deleted after the handoff would
// run with stale owns, verify commands and plan set.
const manifestRead = await flow(["read", `${phaseDir}/handoff/${prefix}manifest.json`]);
if (manifestRead.json?.exists) {
  let m = null;
  try { m = JSON.parse(manifestRead.json.text); } catch {}
  if (!m || m.waves !== handoff.length || handoff.some((w) => w.planRevision !== m.planRevision)) return result("refused", { reason: `the handoff in ${phaseDir}/handoff/ is incomplete or mixed (${handoff.length} wave files, the manifest names ${m?.waves ?? "none"}); regenerate it with gsd-plan` });
} else log(`warning: ${phaseDir}/handoff/ has no ${prefix}manifest.json (an older kit); the wave set is not checked`);
const staleHandoff = [];
for (const t of handoff.flatMap((w) => w.tasks).filter((x) => !tracked(x.plan))) {
  const p = idx.plans.find((x) => x.id === t.plan);
  if (!p) staleHandoff.push(`${t.plan} no longer exists`);
  else if (p.plan_hash && t.planHash && p.plan_hash !== t.planHash) staleHandoff.push(`${t.plan} changed after the handoff`);
}
if (!prefix) for (const p of idx.plans) if (p.plan_hash && !p.has_summary && p.gap_closure !== true && !handoff.some((w) => w.tasks.some((t) => t.plan === p.id))) staleHandoff.push(`${p.id} is in no handoff wave`);
if (staleHandoff.length) return result("refused", { reason: `the handoff does not match the plans: ${staleHandoff.join("; ")}; regenerate it with gsd-plan`, stale: staleHandoff });
if (a.gapsOnly) {
  const lacking = idx.plans.filter((p) => p.gap_closure === undefined || p.gap_closure === null).map((p) => p.id);
  if (lacking.length) return result("refused", { reason: `--gaps-only needs a gap_closure key in every plan; missing in ${lacking.join(", ")}` });
}
const selectedTask = (t) => (!planFilter || planFilter.includes(t.plan)) && (!a.gapsOnly || planInfo(t.plan).gap_closure === true);
if (waveFilter !== null) {
  const lower = handoff.filter((w) => w.k < waveFilter).flatMap((w) => w.tasks).filter((t) => !tracked(t.plan)).map((t) => t.plan);
  if (lower.length) return result("refused", { reason: `wave ${waveFilter} refused: lower waves have incomplete plans ${[...new Set(lower)].join(", ")}` });
}
const waves = handoff.filter((w) => waveFilter === null || w.k === waveFilter);
const wanted = waves.flatMap((w) => w.tasks).filter(selectedTask);
const open = wanted.filter((t) => !tracked(t.plan));
const pendingPlans = open.filter((t) => !planInfo(t.plan).has_summary);
if (pendingPlans.length === open.length && !pendingPlans.some((t) => planInfo(t.plan).ready)) {
  if ((planFilter || waveFilter !== null || a.gapsOnly) && !wanted.length) return result("nothing-to-run", { route: "none", reason: "no matching plans" });
  const stuck = idx.plans.filter((p) => p.halted || (p.blocked_by ?? []).length);
  if (pendingPlans.length && stuck.length) return result("nothing-to-run", { route: "stuck", reason: `phase stuck, resolve the halt: ${stuck.map((p) => p.id).join(", ")}; record the answer with ph gsd halt clear ${N} --plan <id> --reason <answer>, then rerun` });
  if (pendingPlans.length) return result("nothing-to-run", { route: "waiting", reason: "plans not ready yet" });
  const ver = await gsd(["verification", "status", phaseDir]);
  const vs = ver.code === 66 ? "missing" : ver.json?.status;
  if (vs === "missing" || vs === "stale" || ver.code === 1) return result("nothing-to-run", { route: "verify", reason: `all plans committed; verification ${vs ?? "invalid"}: run gsd-verify` });
  if (vs === "passed") return result("nothing-to-run", { route: "complete", reason: "verification passed: run phase complete" });
  return result("nothing-to-run", { route: vs === "gaps_found" ? "plan-gaps" : "uat", reason: `verification ${vs}` });
}

// ---- branching (GSDF-54): before the baseline, so the baseline belongs to the checkout that executes (CR-GSF-05) ----
if (g.branching === "phase") {
  const slug = phaseDir.split("/").pop().replace(/^[\d.]+-/, "");
  const branch = `gsd/phase-${N}-${slug}`;
  const cur = (await shell(["git", "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  if (cur !== branch) {
    const def = ((await shell(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).stdout.trim().replace(/^origin\//, "")) || "main";
    const fetched = (await shell(["git", "fetch", "origin", def])).code === 0;
    const hasRef = (await shell(["git", "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${def}`])).code === 0;
    if (!fetched && !hasRef) return result("failed", { reason: `branching phase: fetch of origin/${def} failed and no local origin/${def}; no branch created` });
    const exists = (await shell(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
    const sw = await shell(exists ? ["git", "switch", branch] : ["git", "switch", "--no-track", "-c", branch, `origin/${def}`]);
    if (sw.code !== 0) return result("failed", { reason: `could not switch to ${branch}: ${sw.stderr.split(/\r?\n/)[0]}` });
    log(`branch ${branch} from origin/${def}`);
    let again;
    try { again = await readHandoff(); } catch (e) { return result("failed", { reason: e.message }); }
    if (JSON.stringify(again) !== JSON.stringify(handoff)) return result("refused", { reason: `the handoff files differ on ${branch}; plan the phase on that branch` });
    idx = await index();
  }
}
async function warnProtected() {
  const cur = (await shell(["git", "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  if (g.branching === "none" && (g.protected_branches ?? []).includes(cur)) log(`warning: committing to protected branch ${cur}`);
}

// ---- execute baseline and safe-resume gate (GSDF-38) ----
phase("Baseline");
const allTasks = handoff.flatMap((w) => w.tasks);
const gatePlans = () => allTasks.map((t) => ({ id: t.plan, owns: t.owns ?? [], summary: t.summary, complete: Boolean(planInfo(t.plan).has_summary) }));
const base = await flow(["baseline", phaseDir]);
if (base.code !== 0) return result("failed", { reason: `execute baseline could not be recorded: ${base.json?.error ?? base.code}` });
async function resumeGate() {
  idx = await index();
  const rg = await flow(["resume-gate", phaseDir], { plans: gatePlans(), integration: progress.integration ?? [] });
  if (rg.json?.status === "error") return result("failed", { reason: `safe-resume gate could not look: ${rg.json.error}` });
  if (rg.code !== 0) return owner("Execute", `safe-resume gate: ${rg.json.problems.map((p) => `${p.kind}${p.path ? ` ${p.path}` : ""}${p.plan ? ` (plan ${p.plan})` : ""}${p.detail ? ` ${p.detail}` : ""}`).join("; ")}`, { recovery: { problems: rg.json.problems, head: rg.json.head }, options: ["close out manually", "re-execute from scratch", "mark and skip"] });
  for (const a of rg.json?.accepted ?? []) log(`resume gate: commit ${a.sha.slice(0, 7)} touches no plan-owned file (${a.files.slice(0, 5).join(", ")}); accepted`);
  // G054: a commit of this run whose commits.json record failed is reconciled; its plans are tracked, not re-run.
  for (const c of rg.json?.reconciled ?? []) {
    log(`resume gate: commit ${c.sha.slice(0, 7)} of plans ${c.plans.join(",")} was not in commits.json; reconciled`);
    for (const id of c.plans) if (progress.plans[id]?.commit === undefined) progress.plans[id] = { commit: c.sha, verify: execMode === "batch" ? "skipped" : "green", evidence: null };
  }
  if ((rg.json?.reconciled ?? []).length && !(await saveProgress())) return result("failed", { reason: `${PROGRESS} could not be written after reconciling commits` });
  // CR-GSF-01: only plans that still lack a SUMMARY now, not the list captured at start.
  for (const t of wanted.filter((x) => !tracked(x.plan) && !planInfo(x.plan).has_summary)) {
    const sc = await gsd(["check", "evaluation-scope", "--plan", t.plan, "--commits-only"]);
    if (!["resolved", "degraded"].includes(sc.json?.status)) return result("failed", { reason: `evaluation scope of ${t.plan} is ${sc.json?.status ?? `exit ${sc.code}`}: no executor started (fail-closed)` });
    if ((sc.json.commits ?? []).length) return owner("Execute", `plan ${t.plan} has commits (${sc.json.commits.slice(0, 3).map((c) => c.sha ?? c).join(", ")}) but no SUMMARY`, { options: ["close out manually", "re-execute from scratch", "mark and skip"] });
  }
  return null;
}
const stop0 = await resumeGate();
if (stop0) return stop0;

// ---- gap wave cap (GSDF-30, D-73): marked before the first executor; the run that started it may resume it ----
if (a.gapsOnly) {
  const at = await gsd(["attempt", "show", phaseDir, "--kind", "gap"]);
  if (at.code !== 0) return result("refused", { reason: "no gap attempt record; plan the gaps first" });
  const prior = at.json.result ?? {};
  if (prior.waveExecuted && prior.waveRunId !== runId) return owner("Gaps", "the gap wave of this phase already executed; gap closure is capped at one wave", { options: ["verify again", "plan the leftovers as a new phase"] });
  if (!prior.waveExecuted) {
    const rec = await gsd(["attempt", "record", phaseDir, "--kind", "gap"], { runId: at.json.runId, inputDigest: at.json.inputDigest, before: at.json.before, done: true, result: { ...prior, waveExecuted: true, waveRunId: runId } });
    if (rec.code !== 0) return result("failed", { reason: `gap attempt could not be marked: ${rec.json?.error ?? rec.code}` });
  } else log(`resuming the gap wave started by this run (${runId})`);
}

// ---- executors (GSDF-41..43, GSDF-45, GSDF-52) ----
// CR-GSF-03: an executor worktree starts from HEAD; uncommitted planning inputs are read from the main checkout.
const snapshot = worktreeMode ? await flow(["execution-inputs"]) : null;
if (snapshot && snapshot.code !== 0) return result("failed", { reason: `execution inputs unavailable: ${snapshot.json?.error}` });
const mainRoot = snapshot?.json?.root ?? null;
const fromMain = (rel) => (mainRoot ? `${mainRoot}/${rel}` : rel);
const execRuntime = (t) => [
  "<kit_executor_runtime>",
  `Plan: ${fromMain(planPath(t.plan))}`,
  mainRoot ? `Planning inputs (.planning/ files, the stack skill) are read, read-only, from the immutable input snapshot ${mainRoot}: they may not be committed into your worktree. Write code and your SUMMARY only in your worktree.` : null,
  `Write your SUMMARY to exactly: ${t.summary}`,
  `You may edit only these paths (owns): ${JSON.stringify(t.owns ?? [])}`,
  `Stack skill to follow: ${stackSkill ? fromMain(stackSkill) : "none"}`,
  "Deviation rules (the kit adapter of the rules in your role text):",
  "- Rules 1-3 (bugs, missing critical functionality, blockers): fix automatically, only inside owns; at most 3 auto-fix attempts per task, then list it under Deferred Issues in the SUMMARY.",
  "- Rule 3 never covers package installs: a needed install, or one that fails, returns a blocking human checkpoint (task status blocked, deviation {rule: 3, kind: checkpoint}).",
  "- Rule 4 (architectural change): stop the task and return status partial with the decision needed in the deviation notes ({rule: 4, note}).",
  "- A change needed in a file you do not own: do not edit it; return it in requests [{path, change, reason}].",
  "- Before you return, delete every file you created outside owns (your SUMMARY excepted): scratch files are cleanup, not a Rule-4 decision.",
  "- Never commit, stage or stash; never write STATE, ROADMAP or REQUIREMENTS.",
  "- The orchestrator's gate runs the build and the tests after the wave: do not run them yourself.",
  "Return JSON {taskResults: [{task, status: implemented|partial|blocked|skipped, evidence}], deviations: [{rule, kind, note}], requests: [{path, change, reason}]}.",
  "</kit_executor_runtime>",
].filter(Boolean).join("\n");
// Every call of one executor session carries the same fixed options, worktree isolation included (CR-GSF-04).
function execOpts(t, label) {
  const o = { label, session: `executor:${t.plan}`, agentType: agentFor("executor", "gsd-executor"), role: "executor", schema: EXEC_SCHEMA };
  if (t.model) o.model = t.model;
  if (t.effort) o.effort = t.effort;
  if (worktreeMode) {
    o.isolation = "worktree";
    if (seeds[t.plan]) o.worktreeSeed = seeds[t.plan];
  }
  return o;
}
const classify = (reason) => {
  if (reason && QUOTA.test(reason)) {
    const m = /retry[- ]?after\D{0,20}(\d+)/i.exec(reason);
    return { class: "quota", retryAfterSeconds: m ? Number(m[1]) : null };
  }
  return { class: "unknown" };
};
async function halt(id, why) {
  await flow(["write", haltPath(id)], JSON.stringify({ plan: id, reason: why, runId }, null, 2));
  return { plan: id, halted: true, reason: why, ...(pendingRequests[id]?.length ? { requests: pendingRequests[id] } : {}) };
}
async function headNow(cwd) { return (await shell(["git", "rev-parse", "HEAD"], cwd ? { cwd } : {})).stdout.trim(); }
const slashPath = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "");
// G072: a request goes to the plan owning its path most specifically (adapter owns forms, path boundaries). G089: a
// path no open plan of the phase owns (no plan, or one already committed) is a shared change, applied before the next
// gate by the integration fixer and committed with the wave.
async function routeRequests(t, res) {
  const list = (res.requests ?? []).filter((rq) => rq && typeof rq.path === "string" && rq.path.trim()).map((rq) => ({ ...rq, path: slashPath(rq.path) }));
  if (!list.length) return;
  const others = allTasks.filter((x) => x.plan !== t.plan).map((x) => ({ id: x.plan, owns: x.owns ?? [], summary: x.summary }));
  const owners = (await flow(["owners"], { paths: list.map((rq) => rq.path), plans: others })).json?.owners ?? {};
  for (const rq of list) {
    const id = (owners[rq.path] ?? [])[0];
    if (id && progress.plans[id]?.commit === undefined) (pendingRequests[id] ??= []).push({ from: t.plan, ...rq });
    else sharedChanges.push({ from: t.plan, ...rq, applied: false });
  }
}
const ownerDecision = (res) => (res.deviations ?? []).find((x) => Number(x.rule) === 4 || x.kind === "checkpoint") ?? (res.taskResults ?? []).find((x) => x.status === "partial" || x.status === "blocked") ?? null;
const clearResolved = (id, res) => { if (pendingRequests[id]) pendingRequests[id] = pendingRequests[id].filter((q) => !(res?.resolvedRequests ?? []).map(slashPath).includes(slashPath(q.path))); };
// The owner's answers to earlier halts of a plan (ph gsd halt clear), handed to its next executor (G055).
async function haltAnswers(id) {
  const r = await flow(["read", `${phaseDir}/halt-answers.json`]);
  try { return r.json?.exists ? JSON.parse(r.json.text).filter((x) => x.plan === id).map(({ halt: why, answer }) => ({ halt: why, answer })) : []; } catch { return []; }
}
// G039: the medium and low notes of the converged plan review (gsd-plan-review), carried into the brief of their plan.
async function reviewNotes(id) {
  const r = await flow(["read", `${phaseDir}/plan-review-notes.json`]);
  try { return r.json?.exists ? JSON.parse(r.json.text).filter((x) => x.plan === id).map(({ severity, description }) => ({ severity, description })) : []; } catch { return []; }
}
async function dispatch(t, waveId) {
  await flow(["remove", haltPath(t.plan)]);
  const before = await headNow();
  const answers = await haltAnswers(t.plan);
  const notes = await reviewNotes(t.plan);
  const reqs = pendingRequests[t.plan] ?? [];
  const prompt = [
    execRuntime(t),
    answers.length ? `Owner answers to earlier halts of this plan (JSON); follow them: ${JSON.stringify(answers)}` : "",
    notes.length ? `Plan-review notes for this plan (medium or low, not blocking; act on each one inside your owns, else say why in your SUMMARY): ${JSON.stringify(notes)}` : "",
    reqs.length ? `Change requests from other plans for files you own (JSON): ${JSON.stringify(reqs)}. Make them inside your owns and list each request path you resolved in resolvedRequests.` : "",
    digestLine(`plan:${t.plan}`, t.planHash ?? "none"),
  ].filter(Boolean).join("\n\n");
  const d = await agent(prompt, { ...execOpts(t, `exec-${t.plan}`), detail: true });
  const res = d?.result ?? null;
  const wt = d?.worktree ?? null;
  ev(`code ${waveId} ${t.plan}`);
  // GSDF-42: workers never commit; a moved HEAD (main or the agent worktree) fails the plan.
  if ((await headNow()) !== before || (wt && (await headNow(wt)) !== before)) return { ...(await halt(t.plan, "executor committed (HEAD moved)")), failed: true };
  const summaryAt = wt ? `${wt}/${t.summary}` : t.summary;
  const hasSummary = Boolean((await flow(["exists", summaryAt])).json?.exists?.[summaryAt]);
  if (!res) {
    if (hasSummary) { log(`plan ${t.plan}: no normal completion but SUMMARY present; reconciled as complete`); return { plan: t.plan, ok: true, wt, reconciled: true }; }
    const c = classify(d?.reason);
    return { ...(await halt(t.plan, `executor ended abnormally (${c.class}): ${d?.reason ?? "no reply"}`)), failure: c };
  }
  await routeRequests(t, res);
  clearResolved(t.plan, res);
  const decision = ownerDecision(res);
  if (decision) return { ...(await halt(t.plan, `owner decision needed: ${decision.note ?? decision.evidence ?? decision.status}`)), decision };
  // G058: one result per plan task; an empty list or a skipped task is no finished plan.
  const want = planInfo(t.plan).task_count;
  const got = (res.taskResults ?? []).length;
  if (!got || (Number.isInteger(want) && got < want)) return { ...(await halt(t.plan, `executor reported ${got} task result(s)${Number.isInteger(want) ? ` for ${want} task(s)` : ""}`)), failed: true };
  const skippedTask = res.taskResults.find((x) => x.status === "skipped");
  if (skippedTask) return { ...(await halt(t.plan, `owner decision needed: task ${skippedTask.task} was skipped${skippedTask.evidence ? ` (${skippedTask.evidence})` : ""}`)), decision: skippedTask };
  if (!hasSummary) return { ...(await halt(t.plan, `no SUMMARY at ${t.summary}`)), failed: true };
  return { plan: t.plan, ok: true, wt };
}
async function integrate(outcomes, tasks) {
  for (const t of tasks) {
    const o = outcomes.find((x) => x?.plan === t.plan);
    if (!o?.ok) continue;
    if (worktreeMode && o.wt) {
      // CR-GSF-08: the deletion declaration comes from the validated handoff task (the index does not carry it).
      const tr = await flow(["transfer", phaseDir], { plan: t.plan, worktree: o.wt, owns: t.owns ?? [], summary: t.summary, files_deleted: t.files_deleted ?? [] });
      if (tr.code !== 0) { Object.assign(o, await halt(t.plan, `transfer refused: ${(tr.json?.refused ?? []).map((r) => `${r.path} (${r.reason})`).join(", ") || tr.json?.error}`), { ok: false }); continue; }
      ev(`transfer ${t.plan}`);
      for (const d of tr.json?.dropped ?? []) log(`transfer ${t.plan}: ${d.path} not copied to the main tree (${d.reason})`);
    }
    const sc = await flow(["spot-check", t.summary]);
    if (sc.code !== 0) Object.assign(o, await halt(t.plan, `SUMMARY spot-check: missing ${(sc.json?.missing ?? []).join(", ")}`), { ok: false });
  }
  return outcomes;
}
const haltStop = (outcomes, stage) => {
  const bad = outcomes.filter((o) => o && !o.ok);
  if (!bad.length) return null;
  const quota = bad.find((o) => o.failure?.class === "quota");
  if (quota) return owner(stage, `quota or rate limit: ${quota.reason}`, { failure: quota.failure, halted: bad, options: [`rerun after the reset${quota.failure.retryAfterSeconds ? ` (about ${quota.failure.retryAfterSeconds} s)` : ""}`] });
  return owner(stage, bad.map((o) => `${o.plan}: ${o.reason}`).join("; "), { halted: bad, options: [`answer each halt with ph gsd halt clear ${N} --plan <id> --reason <answer>, then rerun with the same args`, "stop"] });
};

// ---- green gate and bounded verify-fix rounds (GSDF-44, GSDF-49..52) ----
const evidenceFiles = [];
let testArgv = null;
if (cmds.test) {
  const joined = cmds.test.join(" ");
  const nt = (await gsd(["normalize-test-command", joined])).json?.command;
  testArgv = nt && nt !== joined && nt.startsWith(joined) ? [...cmds.test, ...nt.slice(joined.length).trim().split(/\s+/)] : cmds.test;
}
async function runGate(waveId, tasks) {
  const r = await flow(["gate", phaseDir], { waveId, plans: tasks.map((t) => ({ id: t.plan, owns: t.owns ?? [], verify: t.verify ?? [] })), testArgv });
  if (!r.json || r.json.status === "error") return { green: false, failureCount: 1, failures: [{ step: "gate", excerpt: r.json?.error ?? "gate failed to run" }], byPlan: {}, unplaced: [], blockedBy: {} };
  evidenceFiles.push(r.json.evidence);
  for (const n of r.json.notes ?? []) log(`gate: ${n}`);
  for (const tline of r.json.timedOut ?? []) log(`gate timeout: ${tline}`);
  ev(`gate ${waveId} ${r.json.green ? "green" : `red (${r.json.failureCount})`}`);
  return r.json;
}
const failureText = (list) => list.map((f) => `- ${f.step}${f.plan ? ` (plan ${f.plan})` : ""}: ${f.outcome ?? "failed"}; full log ${f.log ?? "n/a"}\n${String(f.excerpt ?? "").split(/\r?\n/).map((l) => `    ${l}`).join("\n")}`).join("\n");
const fixerBlock = () => (g.fixer_verifies_itself
  ? `After your changes run the build (${JSON.stringify(cmds.build)}) and the tests (${JSON.stringify(testArgv)}) yourself, at most ${g.fixer.max_build_attempts} times and within ${g.fixer.minutes} minutes; stop early when two consecutive attempts do not reduce the failure count. If you edit after your last run, run the build and the tests once more on that edit before you answer, even past those limits. Judge yourself only on the failures and findings given to you: a failure in a file you do not own is not yours and does not make your status unresolved. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is verified (a build and test run followed your last edit), unverified (none did) or none (you made no edit).`
  : "Do not run the build or the tests: the orchestrator's gate verifies your changes. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is unverified (you edited) or none (you made no edit).");
// G070: an edit outside the owns is never a workaround; the fixer returns it as a request instead.
const fixerText = (owns, findings, failures) => [`<kit_fixer_runtime>\nYou own: ${JSON.stringify(owns)}. Fix the confirmed review findings and gate failures below, nothing else; a finding with instances is fixed at every instance. Never commit. A change needed in a file you do not own: do not make it (not even a rename or an import tweak to dodge a clash); return it in requests [{path, change, reason}].\n${fixerBlock()}\n</kit_fixer_runtime>`, findings.length ? `Confirmed findings (JSON): ${JSON.stringify(findings.map(findingBrief))}` : "", failures.length ? `Gate failures:\n${failureText(failures)}` : ""].filter(Boolean).join("\n\n");
// The fixer repairs confirmed defects and failed checks in existing code, where more effort finds the edge cases its
// tests miss (owner decision 2026-10-22, after "Spending your effort"): it runs at FIXER_EFFORT on its own tier's
// model unless the project's gsd.roles.fixer sets an effort.
const FIXER_EFFORT = "high";
const fixerOpts = (label, extra = {}) => ({ label, agentType: agentFor("fixer", "gsd-code-fixer"), role: "fixer", ...(cfg.gsd.roles?.fixer?.effort ? {} : { effort: FIXER_EFFORT }), schema: FIXER_SCHEMA, ...extra });
// Main-tree edits outside every plan's owns stop the run before the gate and the review are paid for, not at Commit
// (G070, kit-feedback 35).
async function strayStop(tasks, stage) {
  const pf = await planFiles(tasks);
  if (pf.stop) return pf.stop;
  if (!pf.unowned.length) return null;
  return owner(stage, `changes outside every plan's owns: ${pf.unowned.slice(0, 10).join(", ")}`, { paths: pf.unowned, options: ["move or revert them, then rerun with the same args", "add them to a plan's owns and replan"] });
}
// G089, G083: shared changes (requests no open plan owns; the plans' <shared_changes> of this execution wave) are made
// by one integration fixer owning exactly their paths, before the gate; its files join the wave commit and
// commits.json, and the resume gate knows them from execute-progress.json.
async function applyShared(waveId, label) {
  const open = sharedChanges.filter((s) => !s.applied);
  if (!open.length) return null;
  const nameless = open.filter((s) => !s.path);
  if (nameless.length) return owner("Integration", `shared changes of ${label} name no file, so no fixer can own them: ${nameless.map((s) => `${s.from}: ${String(s.change).slice(0, 120)}`).join("; ")}`, { sharedChanges: nameless, options: ["apply them by hand, commit them, then rerun with the same args", "name the file in the plan's <shared_changes> and regenerate the handoff"] });
  const files = [...new Set(open.map((s) => s.path))];
  for (const f of files) integrationFiles.add(f);
  progress.integration = [...integrationFiles];
  if (!(await saveProgress())) return result("failed", { reason: `${PROGRESS} could not be written before the shared changes` });
  const brief = open.map(({ from, path, change, reason }) => ({ from, path, change, reason }));
  const r = await call([`Shared changes for ${label}: no open plan of the phase owns these paths, so you make them. You own exactly these files: ${JSON.stringify(files)}. Make each change below and nothing else; never commit.`, `Changes (JSON): ${JSON.stringify(brief)}`, "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.", digestLine(`shared:${waveId}`, await digestOf({ files }))].join("\n\n"), fixerOpts(`shared-${waveId}`));
  if (r.result === null) return owner("Integration", `the shared-change fixer of ${label} returned nothing${r.reason ? ` (${r.reason})` : ""}`, { sharedChanges: open, ...(fatal(r.reason) ? { failure: classify(r.reason) } : {}) });
  if (r.result.status !== "fixed") return owner("Integration", `shared changes of ${label} unresolved${r.result.evidence ? `: ${r.result.evidence}` : ""}`, { sharedChanges: open });
  for (const s of open) s.applied = true;
  if (!(await saveProgress())) return result("failed", { reason: `${PROGRESS} could not be written after the shared changes` });
  ev(`shared ${waveId} ${files.length}`);
  return null;
}
// CR-GSF-16: every fix result is inspected before the gate reruns. A quota or a call that could not run stops the round
// at once; a fixer that answers unresolved, or a fix call that returned nothing, is judged on a fresh gate (G066, G088,
// kit-feedback 28/30): the round stops red only while that fixer's own failures remain. An owner decision of a fixer
// (kit-feedback 51) waits for the transfer of every fixer's owned changes and the rerun, and stops the round only while
// its plan still fails.
async function fixRounds(waveId, tasks, first, label, tail) {
  let cur = first;
  let prev = first.failureCount;
  let noDrop = 0;
  for (let round = 1; !cur.green && round <= g.max_verify_rounds; round++) {
    const red = (why, extra = {}) => ({ stop: owner("Gate", `${label} is red after fix round ${round}: ${why}${tail}`, { failures: cur.failures, evidence: cur.evidence, blockedBy: cur.blockedBy, ...extra }) });
    const placed = (cur.unplaced ?? []).filter((f) => (f.files ?? []).length);
    const fileless = (cur.unplaced ?? []).filter((f) => !(f.files ?? []).length);
    const fixes = Object.entries(cur.byPlan ?? {}).filter(([id]) => tasks.some((x) => x.plan === id)).map(([id, list]) => async () => {
      const t = tasks.find((x) => x.plan === id);
      if (!t) return { id, skipped: true };
      const reqs = pendingRequests[id] ?? [];
      const dg = digestLine(`fix:${id}`, await digestOf({ owns: t.owns ?? [] }));
      // A plan resumed without its worktree is repaired in the main tree: a new worktree would start from HEAD,
      // without the plan's integrated output.
      if (worktreeMode && !worktrees[id]) return { id, kind: "fixer", ...(await call([fixerText(t.owns ?? [], [], list), reqs.length ? `Change requests from other plans of this wave (JSON): ${JSON.stringify(reqs)}` : "", dg].filter(Boolean).join("\n\n"), fixerOpts(`fix-${id}-${round}`))) };
      const prompt = [`Fix round ${round} for plan ${id}: the gate failed on your owned files. Fix only inside your owns; do not run the build or the tests.`, failureText(list), reqs.length ? `Change requests from other plans of this wave (JSON): ${JSON.stringify(reqs)}` : "", `Evidence: ${cur.evidence}`, "Return the same JSON as before, with resolvedRequests listing only request paths you actually resolved.", dg].filter(Boolean).join("\n\n");
      return { id, kind: "executor", t, ...(await call(prompt, execOpts(t, `fix-${id}-${round}`))) };
    });
    // G064: an integration fixer owns exactly the files its failures name; a failure naming no file has no owner.
    if (placed.length) {
      const files = [...new Set(placed.flatMap((f) => f.files ?? []))];
      for (const f of files) integrationFiles.add(f);
      progress.integration = [...integrationFiles];
      fixes.push(async () => ({ id: null, kind: "integration", ...(await call([`Integration fix: these gate failures belong to no plan. You own exactly these files: ${JSON.stringify(files)}.`, failureText(placed), "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.", digestLine("fix:integration", await digestOf({ files })) ].join("\n\n"), fixerOpts(`integration-fix-${round}`))) }));
    }
    if (!fixes.length && !sharedChanges.some((s) => !s.applied)) return red(fileless.length ? `${fileless.length} gate failure(s) name no file of any plan, so no fixer can own them` : "no fixer owns the failing files");
    const results = await parallel(fixes);
    const soft = [];
    const decisions = [];
    for (const r of results) {
      if (!r) return red("a fix call failed to run");
      if (r.skipped) continue;
      const who = r.id ? `plan ${r.id}` : "the integration fixer";
      if (r.result === null) {
        if (fatal(r.reason)) return { stop: owner("Gate", `fix call of ${who} failed: ${r.reason}`, { failure: classify(r.reason), evidence: cur.evidence }) };
        soft.push({ id: r.id, why: `fix call of ${who} returned nothing${r.reason ? ` (${r.reason})` : ""}` });
        continue;
      }
      await routeRequests(r.t ?? { plan: r.id ?? "integration" }, r.result);
      if (!(await saveProgress())) return red("could not persist pending change requests");
      if (r.kind === "executor") {
        const decision = ownerDecision(r.result);
        if (decision) decisions.push({ id: r.id, decision });
      } else if (r.result.status !== "fixed") soft.push({ id: r.id, why: `${who} unresolved (${r.result.remaining_failures ?? "?"} failures remain)${r.result.evidence ? `: ${r.result.evidence}` : ""}` });
      if (r.id) clearResolved(r.id, r.result);
    }
    if (!(await saveProgress())) return red("could not persist pending change requests");
    if (worktreeMode) {
      const live = tasks.filter((t) => cur.byPlan?.[t.plan] && worktrees[t.plan]);
      const hs = haltStop(await integrate(live.map((t) => ({ plan: t.plan, ok: true, wt: worktrees[t.plan] })), live), "Gate");
      if (hs) return { stop: hs };
    }
    const stray = await strayStop(tasks, "Gate");
    if (stray) return { stop: stray };
    const sh = await applyShared(waveId, label);
    if (sh) return { stop: sh };
    ev(`fix ${waveId} round ${round}`);
    cur = await runGate(waveId, tasks);
    // kit-feedback 51: a fixer's decision stops the round only while its plan still fails after the transfers and the rerun;
    // otherwise its failures were another fixer's to fix, and the answer is logged.
    const stuck = decisions.filter((d) => (cur.byPlan?.[d.id] ?? []).length > 0);
    for (const d of decisions.filter((x) => !stuck.includes(x))) log(`fix of ${d.id} reported "${d.decision.note ?? d.decision.evidence ?? d.decision.status}", but its failures are gone after the transfer and the rerun; not an owner decision`);
    if (stuck.length) return { stop: owner("Gate", stuck.map((d) => `owner decision needed in the fix of ${d.id}: ${d.decision.note ?? d.decision.evidence ?? d.decision.status}`).join("; "), { decision: stuck[0].decision, evidence: cur.evidence }) };
    const still = soft.filter((s) => (s.id ? (cur.byPlan?.[s.id] ?? []).length > 0 : (cur.unplaced ?? []).some((f) => (f.files ?? []).length)));
    if (!cur.green && still.length) return red(still.map((s) => s.why).join("; "));
    noDrop = cur.failureCount >= prev ? noDrop + 1 : 0;
    prev = cur.failureCount;
    if (!cur.green && noDrop >= 2) return { stop: owner("Gate", `verify-fix stalled: ${cur.failureCount} failures did not drop over 2 rounds`, { failures: cur.failures, evidence: cur.evidence }) };
  }
  return { gate: cur };
}

// ---- bounded code review (GSDF-46..48, GSDF-92) ----
const globRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
function lensesFor(scope) {
  const list = (cfg.adapter.review_lenses ?? []).filter((l) => (l.stage ?? "code") === "code" && (!l.applies_to?.length || scope.some((f) => l.applies_to.some((gl) => globRe(gl).test(f)))));
  return list.length ? list.map((l) => ({ name: l.name, text: l.text })) : [{ name: "correctness", text: "Follow the lens text in .agents/workflows/lenses/correctness.md." }];
}
// A finding as the verifier, the fixer and the resolution check see it: one defect, every place it occurs.
const findingBrief = ({ id, file, line, trigger, description, class: kind, instances }) => ({ id, file, line, trigger, description, ...(kind ? { class: kind } : {}), ...(instances?.length ? { instances } : {}) });
// Pre-existing (owner decision 2026-10-22, after the Claude Code team's review write-up, where most repeat findings sat
// in code the change never touched): a finding whose line lies outside the lines the plan changed, by more than
// PRE_EXISTING_MARGIN, and that the reviewer does not say the change caused, is recorded and deferred, never blocking.
const PRE_EXISTING_MARGIN = 3;
const preExisting = (f, changed) => {
  const ranges = changed[f.file];
  if (!Array.isArray(ranges) || !Number.isInteger(f.line) || f.line < 1 || f.introduced === true) return false;
  return !ranges.some(([s, e]) => f.line >= s - PRE_EXISTING_MARGIN && f.line <= e + PRE_EXISTING_MARGIN);
};
const rangeText = (ranges) => (ranges === "all" ? "all (new file)" : Array.isArray(ranges) ? ranges.map(([s, e]) => (s === e ? `${s}` : `${s}-${e}`)).join(", ") : "unknown");
const DEFER_REASON = { downgraded: "missing trigger, confidence < 80 or theoretical", deferred: "non-blocking severity", "pre-existing": "outside the lines this plan changed (pre-existing)" };
const gateFinding = (f) => {
  const high = ["critical", "high"].includes(String(f.severity).toLowerCase());
  if (!high) return "deferred";
  return String(f.trigger ?? "").trim() && Number(f.confidence) >= 80 && String(f.likelihood).toLowerCase() !== "theoretical" ? "gated" : "downgraded";
};
const metrics = { confirmed: 0, refuted: 0, unverified: 0, resolved: 0, deferred: 0, downgraded: 0, preExisting: 0, secondVerifier: 0 };
const findingFiles = (list) => [...new Set(list.flatMap((f) => [f.file, ...(f.instances ?? []).map((x) => x.file)]).filter(Boolean))];
// Each verdict keeps its evidence on the finding (G081): an uncertain or unverified finding reaches the owner with
// what the verifiers found, not only a generic reason.
async function verifyFindings(gated, plan) {
  const verdicts = {};
  const evidence = {};
  const dg = digestLine(`findings:${plan}`, await digestOf({ files: findingFiles(gated) }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = gated.filter((f) => !verdicts[f.id]);
    if (!missing.length) break;
    const r = await call([`Verify these review findings of plan ${plan} independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.`, `Findings (JSON): ${JSON.stringify(missing.map(findingBrief))}`, "Return JSON {verdicts: [{id, verdict, evidence}]}.", dg].join("\n\n"), { label: `verify-findings-${plan}`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: VERDICT_SCHEMA });
    // GSDF-01: a quota, credit or auth failure is never retried.
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `finding verifier of ${plan} failed: ${r.reason}`, { failure: classify(r.reason), findings: gated.map(findingBrief) }) };
    for (const v of r.result?.verdicts ?? []) if (missing.some((f) => f.id === v.id)) { verdicts[v.id] = v.verdict; evidence[v.id] = v.evidence ?? ""; }
  }
  // A second, independent verifier decides what the first left uncertain, before the owner is asked; it does not see
  // the first verdict. Still uncertain stays unverified.
  const unsure = gated.filter((f) => verdicts[f.id] === "uncertain");
  if (unsure.length) {
    metrics.secondVerifier += unsure.length;
    const r = await call([`Verify these review findings of plan ${plan} independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.`, `Findings (JSON): ${JSON.stringify(unsure.map(findingBrief))}`, "Return JSON {verdicts: [{id, verdict, evidence}]}.", dg].join("\n\n"), { label: `verify-findings-${plan}-second`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: VERDICT_SCHEMA });
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `second finding verifier of ${plan} failed: ${r.reason}`, { failure: classify(r.reason), findings: gated.map(findingBrief) }) };
    for (const v of r.result?.verdicts ?? []) if (unsure.some((f) => f.id === v.id)) {
      if (v.verdict !== "uncertain") verdicts[v.id] = v.verdict;
      evidence[v.id] = [evidence[v.id], v.evidence].filter(Boolean).join(" | second verifier: ");
    }
  }
  for (const f of gated) {
    f.verdict = verdicts[f.id] ?? "unverified";
    f.verdictEvidence = evidence[f.id] ?? (verdicts[f.id] ? "" : "no verifier answered");
  }
  return {};
}
// Review records and deferred.md are written one at a time: review-record renders REVIEW.md from every record, and two
// renders at once could each miss the other's record.
let reviewWrites = Promise.resolve();
const reviewWrite = (fn) => (reviewWrites = reviewWrites.then(fn, fn));
async function writeRecord(waveId, record) {
  const wr = await reviewWrite(() => flow(["review-record", phaseDir], { waveId, record }));
  return wr.code === 0 ? null : result("failed", { reason: `review record of ${record.plan} refused: ${(wr.json?.errors ?? [wr.json?.error ?? `exit ${wr.code}`]).join("; ")}` });
}
async function readRecord(waveId, plan) {
  const r = await flow(["read", `${phaseDir}/review/${waveId}-${plan}.json`]);
  try { return r.json?.exists ? JSON.parse(r.json.text) : null; } catch { return null; }
}
// deferred.md lines are appended once per finding (G081): a resumed review does not repeat them.
async function appendDeferred(lines) {
  if (!lines.length) return;
  await reviewWrite(async () => {
    const cur = await flow(["read", `${phaseDir}/deferred.md`]);
    const have = new Set(String(cur.json?.text ?? "").split(/\r?\n/));
    const fresh = lines.filter((l) => !have.has(l));
    return fresh.length ? flow(["append", `${phaseDir}/deferred.md`], fresh.join("\n")) : null;
  });
}
const confirmedOf = (record) => record.findings.filter((f) => f.verdict === "confirmed");
const resolvedIds = (record) => new Set((record.resolution ?? []).filter((x) => x.resolved === true).map((x) => x.id));
const unresolvedOf = (record) => confirmedOf(record).filter((f) => !resolvedIds(record).has(f.id));
const asReview = (record, replay = null) => ({ record, replay, confirmed: confirmedOf(record), unverified: record.findings.filter((f) => f.verdict === "unverified" || f.verdict === "uncertain") });
async function reviewPlan(t, waveId, codeOnly, scopeOverride) {
  const evScope = scopeOverride ? null : await gsd(["check", "evaluation-scope", "--plan", t.plan]);
  const sc = (await flow(["review-scope", phaseDir], { plan: t.plan, files: scopeOverride ?? a.files, filterExplicit: Boolean(scopeOverride), summary: t.summary, evaluation: evScope?.json?.files ?? [] })).json ?? { scope: [] };
  for (const l of sc.log ?? []) log(`review scope ${t.plan}: ${l}`);
  const lenses = lensesFor(sc.scope ?? []);
  // The record of a review is reused for the same work (plan text, SUMMARY, lenses, reviewers): unchanged code replays
  // its findings; after a fix pass (a stop at Review, a hand fix) only the resolution check runs again (G080,
  // kit-feedback 33/34). Findings left unverified, and resolutions without an answer, are judged again.
  const key = { plan: t.planHash ?? null, summary: t.summary ? await fileSha(t.summary) : null, lenses: lenses.map((l) => l.name), reviewers: reviewers.map((rv) => [rv.model ?? null, rv.effort ?? null]) };
  const record = { plan: t.plan, scope: sc.scope ?? [], excluded: sc.excluded ?? [], lenses: lenses.map((l) => l.name), codeOnly, findings: [], resolution: [], key, stamp: null, fixPass: 0 };
  record.stamp = record.scope.length ? await digestOf({ files: record.scope }) : null;
  const prior = await readRecord(waveId, t.plan);
  if (prior && JSON.stringify(prior.key) === JSON.stringify(key) && JSON.stringify(prior.scope) === JSON.stringify(record.scope)) {
    const open = prior.findings.filter((f) => f.status === "gated" && !["confirmed", "refuted"].includes(f.verdict));
    if (!open.length && (prior.fixPass ?? 0) >= 1) {
      log(`review ${t.plan}: the recorded findings were fixed once; only the resolution check runs again`);
      return asReview(prior, "resolution");
    }
    if (prior.stamp === record.stamp && !(prior.fixPass ?? 0)) {
      log(`review ${t.plan}: the recorded review of this code is reused${open.length ? `; ${open.length} finding(s) are verified again` : ""}`);
      if (open.length) {
        const vf = await verifyFindings(open, t.plan);
        const bad = await writeRecord(waveId, prior);
        if (bad) return { stop: bad };
        if (vf.stop) return vf;
      }
      return asReview(prior, "review");
    }
  }
  if (record.scope.length) {
    const changed = (await flow(["changed-lines", phaseDir], { plan: t.plan, files: record.scope })).json?.files ?? {};
    const prompt = [
      `Review plan ${t.plan} (${planPath(t.plan)}) at depth ${g.review_depth}. Review only these files: ${record.scope.join(", ")}.`,
      `Lines this plan changed:\n${record.scope.map((p) => `- ${p}: ${rangeText(changed[p])}`).join("\n")}`,
      codeOnly ? "This code is not built yet (code-only review)." : "The wave is built and its tests are green.",
      `Lenses:\n${lenses.map((l) => `- ${l.name}: ${l.text}`).join("\n")}`,
      "Every finding carries trigger (the concrete input or sequence that makes it fail), likelihood (likely|possible|theoretical), confidence 0-100, impact, file and line.",
      "Set introduced true when this plan's change causes the defect, also on an unchanged line (a caller broken by a changed signature); false when the defect was there before the change. A defect outside the changed lines that the change did not cause is recorded as pre-existing and does not block.",
      "Report one defect once: when the same defect occurs in several places, give it a class (a short name of the defect kind) and list every other place in the reviewed files as instances [{file, line}], so one fix covers all of them.",
      `Return JSON {findings: [{id, severity (${SEVERITIES.join("|")}), trigger, likelihood, confidence, impact, file, line, description, introduced, class, instances}]}; an empty findings list when nothing needs fixing.`,
      digestLine(`review:${t.plan}`, record.stamp),
    ].join("\n\n");
    // Each reviewer reviews the plan on its own; their findings are kept apart (ids R2-, R3-, ...), not merged.
    const replies = await parallel(reviewers.map((rv, k) => async () => {
      const opts = { label: `review-${t.plan}${k ? `-r${k + 1}` : ""}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: FINDINGS_SCHEMA, ...(rv.model ? { model: rv.model } : {}), ...(rv.effort ? { effort: rv.effort } : {}) };
      const first = await call(prompt, opts);
      return first.result === null && !fatal(first.reason) ? call(prompt, opts) : first;
    }));
    // parallel() turns a thrown call into a null item.
    const empty = replies.findIndex((r) => !r || r.result === null);
    if (empty >= 0) return { stop: owner("Review", `reviewer${reviewers.length > 1 ? ` ${empty + 1}` : ""} of ${t.plan} returned nothing${replies[empty]?.reason ? ` (${replies[empty].reason})` : ""}`) };
    const found = replies.flatMap((r, k) => (r.result.findings ?? []).map((f, i) => ({ ...f, id: `${k ? `R${k + 1}-` : ""}${f.id ?? `${t.plan}-F${i + 1}`}` })));
    // CR-GSF-17: an unknown severity is a named blocking error, never a silent downgrade to non-blocking.
    const unknown = found.filter((f) => !SEVERITIES.includes(String(f.severity).toLowerCase()));
    if (unknown.length) return { stop: owner("Review", `reviewer of ${t.plan} returned unknown severities (${[...new Set(unknown.map((f) => f.severity))].join(", ")}), expected ${SEVERITIES.join("|")}`, { findings: unknown }) };
    record.findings = found.map((f) => {
      const kept = { id: f.id, severity: String(f.severity).toLowerCase(), trigger: f.trigger ?? "", likelihood: f.likelihood ?? "", confidence: Number(f.confidence ?? 0), impact: f.impact ?? "", file: f.file ?? "", line: f.line ?? null, description: f.description ?? "", introduced: typeof f.introduced === "boolean" ? f.introduced : null, class: f.class ?? "", instances: Array.isArray(f.instances) ? f.instances.filter((x) => x && typeof x.file === "string") : [] };
      return { ...kept, status: preExisting(kept, changed) ? "pre-existing" : gateFinding(f), verdict: null };
    });
    const gated = record.findings.filter((f) => f.status === "gated");
    if (gated.length) {
      const vf = await verifyFindings(gated, t.plan);
      if (vf.stop) {
        // G081: what came back is kept, so the owner sees the findings and a rerun does not pay for them again.
        const bad = await writeRecord(waveId, record);
        return bad ? { stop: bad } : vf;
      }
    }
    const deferred = record.findings.filter((f) => f.status !== "gated");
    await appendDeferred(deferred.map((f) => `- ${f.id} (${f.severity}, ${f.status}) plan ${t.plan} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.description} [reason: ${DEFER_REASON[f.status]}]`));
    metrics.deferred += deferred.length;
    metrics.downgraded += deferred.filter((f) => f.status === "downgraded").length;
    metrics.preExisting += deferred.filter((f) => f.status === "pre-existing").length;
  }
  for (const f of record.findings) if (f.verdict) metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] = (metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] ?? 0) + 1;
  const bad = await writeRecord(waveId, record);
  if (bad) return { stop: bad };
  ev(`review ${waveId} ${t.plan}${codeOnly ? " code-only" : ""}`);
  return asReview(record);
}
// Runs fn over items, gsd.code_review.max_concurrent at a time, in order; after the first stop no new item starts.
async function reviewPool(items, fn) {
  let stopped = null;
  const out = await pool(items, reviewLimit, async (item) => {
    if (stopped) return null;
    const r = await fn(item);
    if (r?.stop) stopped ??= r;
    return r;
  });
  return stopped ? { stop: stopped.stop } : { out };
}
async function reviewAll(tasks, waveId, codeOnly) {
  const done = await reviewPool(tasks, (t) => reviewPlan(t, waveId, codeOnly));
  if (done.stop) return done;
  const out = done.out;
  return { reviews: out, confirmed: out.flatMap((r) => r.confirmed), unverified: out.flatMap((r) => r.unverified) };
}
// kit-feedback 53: the owner's grants (ph gsd grant) are files the phase's fixers may change. A granted file is integration
// output of the phase: it joins the wave commit it changes in, and commits.json records it.
async function grantedFiles() {
  const r = await flow(["read", `${phaseDir}/grants.json`]);
  let list = [];
  try { list = r.json?.exists ? JSON.parse(r.json.text).map((x) => x.path) : []; } catch { list = []; }
  if (list.length) {
    for (const f of list) integrationFiles.add(f);
    progress.integration = [...integrationFiles];
  }
  return list;
}
// The plans of the phase owning the files a fixer asked for (plan null: no plan owns the file).
async function askedOwners(requests) {
  const list = (requests ?? []).filter((rq) => rq && typeof rq.path === "string" && rq.path.trim()).map((rq) => ({ ...rq, path: slashPath(rq.path) }));
  if (!list.length) return [];
  const plans = allTasks.map((x) => ({ id: x.plan, owns: x.owns ?? [], summary: x.summary }));
  const owners = (await flow(["owners"], { paths: list.map((rq) => rq.path), plans })).json?.owners ?? {};
  return list.map((rq) => ({ ...rq, plan: (owners[rq.path] ?? [])[0] ?? null }));
}
const grantOption = (rq) => `ph gsd grant ${N} --path ${rq.path}${rq.plan ? ` --plan ${rq.plan}` : ""}, then rerun with the same args`;
async function fixer(label, findings, failures, owns) {
  const fixOwns = [...owns, ...(await grantedFiles())];
  const prompt = [fixerText(fixOwns, findings, failures), digestLine(`fix:${label}`, await digestOf({ owns: fixOwns, files: findingFiles(findings) }))].join("\n\n");
  const r = await call(prompt, fixerOpts(label, { timeoutS: (g.fixer.minutes + 5) * 60 }));
  ev(`fixer ${label}`);
  // kit-feedback 55: an edit that no build or test run followed is named in the stop, so the owner runs the failing tests before any hand fix.
  const lastEdit = r.result ? r.result.lastEdit ?? "unverified" : null;
  if (!r.result || r.result.status !== "fixed") {
    // The files the fixer asked for and could not change are offered as grants: the owner grants them and reruns.
    const grantRequests = await askedOwners(r.result?.requests);
    return { stop: owner("Fix", r.result ? `fixer unresolved: ${r.result.remaining_failures ?? "?"} failures remain${lastEdit === "unverified" ? "; last edit unverified: run the failing tests before a hand fix" : ""}` : `fixer stopped or timed out${r.reason ? `: ${r.reason}` : ""}`, { evidence: r.result?.evidence ?? null, lastEdit, ...(grantRequests.length ? { grantRequests, options: [...grantRequests.map(grantOption), "stop"] } : {}) }) };
  }
  await routeRequests({ plan: "fixer" }, r.result);
  return { ok: true };
}
// Checks the confirmed findings still unresolved; findings resolved earlier keep their answer. A resolution call that
// returns nothing (a dead caller, a lost transport) is no verdict: the run fails with a resume hint instead of
// recording the findings as unresolved (G126, kit-feedback 32).
async function resolutionCheck(reviews, waveId) {
  const unresolved = [];
  const done = await reviewPool(reviews, async (rv) => {
    const open = unresolvedOf(rv.record);
    if (!open.length) return null;
    const prompt = [`Resolution check of plan ${rv.record.plan}: decide for each finding below whether the current code resolves it; a finding with instances is resolved only when every instance is. Review only these findings; raise no new ones.`, `Findings (JSON): ${JSON.stringify(open.map(findingBrief))}`, "Return JSON {resolution: [{id, resolved, evidence}]}.", digestLine(`resolve:${rv.record.plan}`, await digestOf({ files: [...new Set([...rv.record.scope, ...findingFiles(open)])] }))].join("\n\n");
    const r = await call(prompt, { label: `resolve-${rv.record.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: RESOLUTION_SCHEMA });
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `resolution check of ${rv.record.plan} failed: ${r.reason}`, { failure: classify(r.reason) }) };
    if (r.result === null) return { stop: result("failed", { stage: "Review", reason: `resolution check of ${rv.record.plan} returned nothing (${r.reason ?? "no reply"}); this is no verdict on the findings: rerun with the same args (the recorded review and fix are reused)` }) };
    const answered = open.map((f) => r.result.resolution?.find((x) => x.id === f.id) ?? { id: f.id, resolved: false, evidence: "no answer" });
    rv.record.resolution = [...(rv.record.resolution ?? []).filter((x) => !open.some((f) => f.id === x.id)), ...answered];
    for (const x of answered) x.resolved ? metrics.resolved++ : unresolved.push({ ...x, plan: rv.record.plan });
    const bad = await writeRecord(waveId, rv.record);
    return bad ? { stop: bad } : null;
  });
  if (done.stop) return done;
  ev(`resolution ${waveId}`);
  return { unresolved };
}
// The fix of confirmed findings: one fixer pass, the gate, the resolution check; findings still unresolved get one more
// fixer pass limited to them (G080). A replayed review whose first pass already ran goes straight to the check.
// opts: {label (first fixer label), failures (gate failures for the first pass), owns, gate() -> gate result}.
async function fixAndResolve(waveId, reviews, opts) {
  let open = reviews.filter((r) => unresolvedOf(r.record).length || ((opts.failures ?? []).length && r.replay !== "resolution"));
  let evidence = null;
  for (let pass = 1; pass <= 2; pass++) {
    const fixNow = open.filter((r) => (r.record.fixPass ?? 0) < pass);
    const findings = fixNow.flatMap((r) => unresolvedOf(r.record));
    const failures = pass === 1 ? opts.failures ?? [] : [];
    if (findings.length || failures.length) {
      const fx = await fixer(pass === 1 ? opts.label : `fix-unresolved-${waveId}`, findings, failures, opts.owns);
      if (fx.stop) return fx;
      for (const r of fixNow) {
        r.record.fixPass = pass;
        const bad = await writeRecord(waveId, r.record);
        if (bad) return { stop: bad };
      }
      const stray = await strayStop(opts.tasks, "Fix");
      if (stray) return { stop: stray };
      const sh = await applyShared(waveId, opts.what);
      if (sh) return { stop: sh };
      const again = await opts.gate();
      if (!again.green) return { stop: owner("Gate", `${opts.what} red after the review fix`, { failures: again.failures, evidence: again.evidence }) };
      evidence = again.evidence;
    }
    const rc = await resolutionCheck(open, waveId);
    if (rc.stop) return rc;
    if (!rc.unresolved.length) return { evidence };
    open = open.filter((r) => unresolvedOf(r.record).length);
    if (pass === 2) return { stop: owner("Review", `${rc.unresolved.length} confirmed findings unresolved after two fix passes`, { findings: rc.unresolved, options: ["fix them by hand, then rerun with the same args (only the resolution check runs again)", "stop"] }) };
  }
  return { evidence };
}

// ---- orchestrator commits (GSDF-53) and tracking ----
// The manifest is every change of the main tree since the baseline (fixer deltas included, CR-GSF-07), assigned
// to plans by transfer claim or owns; unowned changes stop the commit.
async function planFiles(tasks) {
  const claimed = {};
  if (worktreeMode) for (const t of tasks) {
    const tr = (await flow(["read", `${phaseDir}/transfers/${t.plan}.json`])).json;
    claimed[t.plan] = tr?.exists ? JSON.parse(tr.text).files.map((f) => f.path) : [];
  }
  const ids = new Set(tasks.map((t) => t.plan));
  const later = allTasks.filter((t) => !ids.has(t.plan) && progress.plans[t.plan]?.commit === undefined);
  const asPlan = (t) => ({ id: t.plan, owns: t.owns ?? [], summary: t.summary, claimed: claimed[t.plan] ?? [] });
  const oc = await flow(["owned-changes", phaseDir], { plans: tasks.map(asPlan), pending: later.map(asPlan), integration: [...integrationFiles], ignore: [cfg.worktree_dir] });
  if (oc.code !== 0 || !oc.json?.files) return { stop: result("failed", { reason: `commit scope could not be resolved: ${oc.json?.error ?? `exit ${oc.code}`}` }) };
  const files = oc.json.files;
  for (const t of tasks) if (t.summary && !(files[t.plan] ??= []).includes(t.summary)) files[t.plan].push(t.summary);
  return { files, removed: oc.json.removed, integration: oc.json.integration, unowned: oc.json.unowned };
}
// CR-GSF-06: a code commit that fails, or whose commits.json record fails, stops the run; nothing is tracked.
async function commitOne(subject, ids, wave, pf, withIntegration) {
  await warnProtected();
  const files = [...new Set([...ids.flatMap((id) => pf.files[id] ?? []), ...(withIntegration ? pf.integration : [])])];
  const removed = [...new Set(ids.flatMap((id) => pf.removed[id] ?? []))];
  const recovery = { plans: ids, files, removed };
  const c = await gsd(["commit", `${subject}\n\nPlans: ${ids.join(",")}`, ...(files.length ? ["--files", ...files] : []), ...(removed.length ? ["--files-removed", ...removed] : [])]);
  if (!c.json?.committed) {
    return { stop: owner("Commit", `code commit of ${ids.join(",")} failed: ${c.json?.error ?? c.json?.reason ?? `exit ${c.code}`}; nothing tracked`, { recovery, options: ["fix the cause (hook, identity, index) and rerun with the same args", "stop"] }) };
  }
  const entry = { sha: c.json.hash, phase: N, wave, plans: Object.fromEntries(ids.map((id) => [id, [...(pf.files[id] ?? []), ...(pf.removed[id] ?? [])]])) };
  if (withIntegration && pf.integration.length) entry.integration = pf.integration;
  const jp = await flow(["json-push", `${phaseDir}/commits.json`], entry);
  if (jp.code !== 0) return { stop: owner("Commit", `commit ${c.json.hash} made but ${phaseDir}/commits.json was not updated: ${jp.json?.error ?? `exit ${jp.code}`}`, { recovery: { ...recovery, entry } }) };
  ev(`commit ${subject}`);
  return { sha: c.json.hash };
}
async function commitWaves(list, verify, evidence) {
  phase("Commit");
  const requests = list.flatMap((w) => w.tasks.flatMap((t) => pendingRequests[t.plan] ?? []));
  if (requests.length) return { stop: owner("Commit", "cross-plan change requests lack acknowledged resolution", { requests }) };
  const pf = await planFiles(list.flatMap((d) => d.tasks));
  if (pf.stop) return pf;
  if (pf.unowned.length) return { stop: owner("Commit", `changes outside every plan's owns: ${pf.unowned.slice(0, 10).join(", ")}`, { paths: pf.unowned, options: ["move or revert them, then rerun with the same args", "add them to a plan's owns and replan"] }) };
  let withIntegration = true;
  for (const { w, tasks } of list) {
    const ids = tasks.map((t) => t.plan);
    const units = g.commit_policy.code === "per-plan" ? ids.map((id) => [`feat(${id}): phase ${N} plan ${id}`, [id]]) : [[`feat(${N}-w${w.k}): phase ${N} wave ${w.k}`, ids]];
    for (const [subject, unit] of units) {
      const c = await commitOne(subject, unit, w.k, pf, withIntegration);
      if (c.stop) return c;
      withIntegration = false;
      for (const id of unit) progress.plans[id] = { commit: c.sha, verify, evidence };
      if (!(await saveProgress())) return { stop: result("failed", { reason: `${PROGRESS} could not be written after commit ${c.sha}` }) };
    }
  }
  return {};
}
async function track(w, tasks, verify, evidence) {
  const st = await gsd(["state", "wave", "--phase", N, "--wave", String(w.k)], { plans: tasks.map((t) => t.plan), verify, evidence });
  if (st.code !== 0) return { stop: owner("Commit", `wave ${w.k} committed but STATE was not updated: ${st.json?.error ?? `exit ${st.code}`}`, { options: ["rerun with the same args"] }) };
  waveResults.push({ wave: w.k, waveId: w.waveId, plans: tasks.map((t) => t.plan), verify, evidence });
  for (const t of tasks) progress.plans[t.plan] = { ...progress.plans[t.plan], tracked: true };
  if (!(await saveProgress())) return { stop: result("failed", { reason: `${PROGRESS} could not be written after tracking wave ${w.k}` }) };
  return {};
}

// Plans sharing a files_modified entry never run at the same time (GSDF-40): later ones move to a later group.
function overlapGroups(tasks) {
  const groups = [];
  for (const t of tasks) {
    const mine = new Set(planInfo(t.plan).files_modified ?? []);
    let gi = 0;
    while (groups[gi]?.some((o) => (planInfo(o.plan).files_modified ?? []).some((f) => mine.has(f)))) gi++;
    if (gi > 0) log(`planning defect: ${t.plan} shares files_modified with an earlier plan of the wave; running it after them`);
    (groups[gi] ??= []).push(t);
  }
  return groups;
}
// One wave's coding stage. Plans already committed are only tracked; plans with a SUMMARY but no commit (an
// interrupted transaction, CR-GSF-02) rejoin the wave's gate, review and commit without a new executor.
async function codeWave(w) {
  phase("Wave");
  idx = await index();
  let open = w.tasks.filter(selectedTask).filter((t) => !tracked(t.plan));
  const committed = open.filter((t) => committedOnly(t.plan));
  if (committed.length) {
    const p0 = progress.plans[committed[0].plan];
    const tr = await track(w, committed, p0.verify ?? "green", p0.evidence ?? null);
    if (tr.stop) return tr;
    open = open.filter((t) => !committed.includes(t));
  }
  const coded = open.filter((t) => planInfo(t.plan).has_summary);
  const haltedCoded = coded.filter((t) => planInfo(t.plan).halted).map((t) => t.plan);
  if (haltedCoded.length) return { stop: owner("Execute", `plans with a SUMMARY and a halt record: ${haltedCoded.join(", ")}; resolve the halt first (ph gsd halt clear ${N} --plan <id> --reason <answer>)`, { halted: haltedCoded }) };
  // G069: a transfer that started and never finished left a partial copy; the plan does not rejoin as if complete.
  const partial = ((await flow(["pending-transfers", phaseDir])).json?.pending ?? []).filter((p) => open.some((t) => t.plan === p.plan));
  if (partial.length) return { stop: owner("Execute", `the transfer of ${partial.map((p) => p.plan).join(", ")} did not finish: the main tree holds part of it (the worktree ${partial[0].worktree} is kept)`, { partial, options: ["copy the rest from the worktree by hand and delete the transfers-pending record", "revert the copied paths, delete the SUMMARY and the record, then rerun to re-execute"] }) };
  for (const t of coded) log(`plan ${t.plan}: SUMMARY present but not committed; it rejoins the gate, review and commit of wave ${w.k}`);
  const toRun = open.filter((t) => !planInfo(t.plan).has_summary && planInfo(t.plan).ready !== false);
  // G055: a halted or blocked plan is reported, never skipped in silence while the rest of the wave commits.
  for (const t of open.filter((x) => !planInfo(x.plan).has_summary && planInfo(x.plan).ready === false)) {
    const p = planInfo(t.plan);
    const why = p.halted ? "halted" : p.error ? `frontmatter ${p.error}` : `blocked by ${(p.blocked_by ?? []).join(", ") || "an unfinished plan"}`;
    if (!skipped.some((s) => s.plan === t.plan)) skipped.push({ plan: t.plan, wave: w.k, why });
    log(`warning: plan ${t.plan} skipped (${why}); answer a halt with ph gsd halt clear ${N} --plan ${t.plan} --reason <answer>`);
  }
  const tasks = w.tasks.filter((t) => coded.includes(t) || toRun.includes(t));
  // G083: the plans' <shared_changes> of this execution wave are applied before its gate.
  for (const s of w.sharedChanges ?? []) {
    const key = `${w.waveId}:${s.source}:${s.text}`;
    if (!tasks.some((t) => t.plan === s.source) || sharedChanges.some((x) => x.key === key)) continue;
    for (const p of s.paths?.length ? s.paths : [null]) sharedChanges.push({ key, from: s.source, path: p, change: s.text, reason: "declared in the plan's <shared_changes>", applied: false });
  }
  if (!tasks.length) return { tasks };
  if (toRun.length && !worktreeMode) {
    const ow = await gsd(["check", "owns", N, "--plans", tasks.map((t) => t.plan).join(",")]);
    if (ow.code !== 0) return { stop: result("refused", { reason: `shared tree needs disjoint owns in wave ${w.k}: ${JSON.stringify(ow.json?.problems ?? ow.json?.errors ?? [])}` }) };
  }
  if (toRun.length && worktreeMode) {
    // CR-GSF-03: a worktree starts from HEAD, so it must already hold every earlier plan's output and the owner's
    // edits to the plans' owned files.
    const earlier = handoff.filter((x) => x.k < w.k).flatMap((x) => x.tasks).filter((t) => !tracked(t.plan) && planInfo(t.plan).has_summary).map((t) => t.plan);
    if (earlier.length) {
      const seed = await flow(["dependency-seed", phaseDir], { plans: earlier });
      if (seed.code !== 0) return { stop: result("refused", { reason: `dependency seed unavailable: ${seed.json?.error}` }) };
      for (const t of toRun) seeds[t.plan] = seed.json;
    }
    const dirty = await flow(["dirty-owned", phaseDir], { plans: toRun.map((t) => ({ id: t.plan, owns: t.owns ?? [] })) });
    if (dirty.code !== 0) return { stop: owner("Execute", dirty.json?.dirty ? `owned files edited before the execute baseline are not in an executor worktree (it starts from HEAD): ${dirty.json.dirty.map((d) => `${d.path} (${d.plan})`).join(", ")}` : `owned-file check failed: ${dirty.json?.error}`, { dirty: dirty.json?.dirty ?? [], options: ["commit or stash those edits, then rerun with the same args", "set gsd.isolation shared"] }) };
  }
  const stop = await resumeGate();
  if (stop) return { stop };
  const outcomes = [];
  for (const group of overlapGroups(toRun)) outcomes.push(...(await pool(group, limit, (t) => dispatch(t, w.waveId))));
  for (const o of outcomes) if (o?.wt) worktrees[o.plan] = o.wt;
  await integrate(outcomes, toRun);
  if (!(await saveProgress())) return { stop: result("failed", { reason: "could not persist pending change requests" }) };
  const hs = haltStop(outcomes, "Execute");
  if (hs) return { stop: hs };
  // G070: shared-tree executors write the main tree; an edit outside the owns stops here, before gate and review.
  if (toRun.length && !worktreeMode) {
    const stray = await strayStop(execMode === "batch" ? [...doneSoFar, ...tasks] : tasks, "Execute");
    if (stray) return { stop: stray };
  }
  return { tasks };
}
const doneSoFar = [];
const isTracer = (w) => w.tasks.some((t) => t.tracer === true || t.tracer?.is === true);
const metricsLine = (wave) => flow(["append", "_workspace/review-metrics.jsonl"], JSON.stringify({ phase: N, wave, ...metrics }));

// A run that skipped halted or blocked plans says so in its result; shared changes left unapplied stop it.
const finish = (extra = {}) => {
  const left = sharedChanges.filter((s) => !s.applied);
  if (left.length) return owner("Integration", `${left.length} shared change(s) were never applied`, { sharedChanges: left });
  return result("executed", { ...extra, ...(skipped.length ? { reason: `executed except ${skipped.map((s) => `${s.plan} (${s.why})`).join(", ")}`, next: `answer the halts (ph gsd halt clear ${N} --plan <id> --reason <answer>) and rerun with the same args` } : {}) });
};

if (execMode === "per-wave") {
  for (const w of waves) {
    const cw = await codeWave(w);
    if (cw.stop) return cw.stop;
    if (!cw.tasks.length) continue;
    const label = isTracer(w) ? "tracer wave" : `wave ${w.k}`;
    const tail = isTracer(w) ? "; no later wave starts" : "";
    const sh = await applyShared(w.waveId, label);
    if (sh) return sh;
    phase("Gate");
    const fr = await fixRounds(w.waveId, cw.tasks, await runGate(w.waveId, cw.tasks), label, tail);
    if (fr.stop) return fr.stop;
    // GSDF-47: no reviewer before the wave is green; a red tracer starts no later wave.
    if (!fr.gate.green) return owner("Gate", `${label} is red after ${g.max_verify_rounds} fix rounds${tail}`, { failures: fr.gate.failures, evidence: fr.gate.evidence, blockedBy: fr.gate.blockedBy });
    phase("Review");
    const rv = await reviewAll(cw.tasks, w.waveId, false);
    if (rv.stop) return rv.stop;
    if (rv.unverified.length) return owner("Review", `${rv.unverified.length} blocking findings could not be verified`, { findings: rv.unverified.map((f) => ({ ...findingBrief(f), verdict: f.verdict, evidence: f.verdictEvidence ?? "" })) });
    let evidence = fr.gate.evidence;
    if (rv.reviews.some((r) => unresolvedOf(r.record).length)) {
      const fx = await fixAndResolve(w.waveId, rv.reviews, { label: `fix-review-${w.waveId}`, owns: cw.tasks.flatMap((t) => t.owns ?? []), tasks: cw.tasks, what: `wave ${w.k}`, gate: () => runGate(w.waveId, cw.tasks) });
      await metricsLine(w.waveId);
      if (fx.stop) return fx.stop;
      evidence = fx.evidence ?? evidence;
    } else await metricsLine(w.waveId);
    const cm = await commitWaves([{ w, tasks: cw.tasks }], "green", evidence);
    if (cm.stop) return cm.stop;
    const tr = await track(w, cw.tasks, "green", evidence);
    if (tr.stop) return tr.stop;
  }
  return finish({ evidence: evidenceFiles });
}

// ---- batch mode (GSDF-49, D-63): code-only waves, one phase review, one final gate, one fixer ----
const done = [];
const allReviews = [];
for (const w of waves) {
  const cw = await codeWave(w);
  if (cw.stop) return cw.stop;
  if (!cw.tasks.length) continue;
  done.push({ w, tasks: cw.tasks });
  doneSoFar.push(...cw.tasks);
  if (g.batch_review) {
    const rv = await reviewAll(cw.tasks, w.waveId, true);
    if (rv.stop) return rv.stop;
    allReviews.push(...rv.reviews);
  }
}
if (!done.length) return finish({ evidence: evidenceFiles });
phase("Batch");
const doneTasks = done.flatMap((d) => d.tasks);
// CR-GSF-10: the phase review covers the actual changes of every executed plan, with or without per-wave reviews.
const phaseFiles = await planFiles(doneTasks);
if (phaseFiles.stop) return phaseFiles.stop;
// G070: an edit outside every plan's owns stops before the phase review is paid for.
if (phaseFiles.unowned.length) return owner("Commit", `changes outside every plan's owns: ${phaseFiles.unowned.slice(0, 10).join(", ")}`, { paths: phaseFiles.unowned, options: ["move or revert them, then rerun with the same args", "add them to a plan's owns and replan"] });
const phaseScope = [...new Set([...Object.values(phaseFiles.files).flat(), ...phaseFiles.integration])].filter((f) => !f.startsWith(".planning/")).sort();
if (!phaseScope.length) log("phase review: the phase diff holds no code changes");
// G071: the phase review covers the whole phase diff; an explicit files list scopes only the per-wave reviews.
if (Array.isArray(a.files) && a.files.length) log(`phase review: the files argument scopes only the per-wave reviews${g.batch_review ? "" : " (none run: batch_review is off)"}; the phase review covers the phase diff`);
const phaseReview = await reviewPlan({ plan: `${nn}-phase`, summary: null }, "phase", true, phaseScope);
if (phaseReview.stop) return phaseReview.stop;
allReviews.push(phaseReview);
const unverified = allReviews.flatMap((r) => r.unverified);
if (unverified.length) return owner("Review", `${unverified.length} blocking findings could not be verified`, { findings: unverified.map((f) => ({ ...findingBrief(f), verdict: f.verdict, evidence: f.verdictEvidence ?? "" })) });
const batchId = `${prefix}batch`;
const batchGate = () => runGate(batchId, doneTasks);
const shB = await applyShared(batchId, "the batch");
if (shB) return shB;
let final = await batchGate();
// G064: failures in files no executed plan owns go to an integration fixer owning exactly those files; the batch fixer
// gets only the failures of the executed plans; a failure naming no file has no fixer.
if (!final.green) {
  const placed = (final.unplaced ?? []).filter((f) => (f.files ?? []).length);
  if (placed.length) {
    const files = [...new Set(placed.flatMap((f) => f.files))];
    for (const f of files) integrationFiles.add(f);
    progress.integration = [...integrationFiles];
    if (!(await saveProgress())) return result("failed", { reason: `${PROGRESS} could not be written before the integration fix` });
    const r = await call([`Integration fix: these gate failures belong to no plan. You own exactly these files: ${JSON.stringify(files)}.`, failureText(placed), "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.", digestLine("fix:integration", await digestOf({ files }))].join("\n\n"), fixerOpts("integration-fix-batch"));
    if (!r.result || r.result.status !== "fixed") return owner("Gate", `the integration fixer of the batch ${r.result ? "answered unresolved" : `returned nothing${r.reason ? ` (${r.reason})` : ""}`}`, { failures: placed, evidence: final.evidence, ...(fatal(r.reason) ? { failure: classify(r.reason) } : {}) });
    final = await batchGate();
  }
}
const batchFailures = [...new Set(Object.entries(final.byPlan ?? {}).filter(([id]) => doneTasks.some((t) => t.plan === id)).flatMap(([, list]) => list))];
if (!final.green && !batchFailures.length) return owner("Gate", `batch gate red: ${final.failureCount} failure(s) that no executed plan owns${(final.unplaced ?? []).some((f) => !(f.files ?? []).length) ? " (some name no file)" : ""}`, { failures: final.failures, evidence: final.evidence });
let finalEvidence = final.evidence;
if (!final.green || allReviews.some((r) => unresolvedOf(r.record).length)) {
  const fx = await fixAndResolve(batchId, allReviews, { label: "batch-fixer", failures: final.green ? [] : batchFailures, owns: doneTasks.flatMap((t) => t.owns ?? []), tasks: doneTasks, what: "batch gate still", gate: batchGate });
  await metricsLine(batchId);
  if (fx.stop) return fx.stop;
  finalEvidence = fx.evidence ?? finalEvidence;
} else await metricsLine(batchId);
const cm = await commitWaves(done, "skipped", finalEvidence);
if (cm.stop) return cm.stop;
for (const d of done) {
  const tr = await track(d.w, d.tasks, "skipped", finalEvidence);
  if (tr.stop) return tr.stop;
}
return finish({ evidence: evidenceFiles, finalGate: finalEvidence });
} finally {
  await flow(["unlock", "debug", lease.json.token]);
  await flow(["unlock", `phase-${nn}`, phaseLease.json.token]);
}
