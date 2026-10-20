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
// GSDF-03: the one verb helper; JSON goes on stdin, only validated values reach the argv.
async function run(argv, input) {
  const r = await shell(["node", ...argv], input === undefined ? {} : { input: typeof input === "string" ? input : JSON.stringify(input) });
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
// agent option `detail: true` resolves {result, reason, agentId, worktree, durationS};
// the global `runId` is the first run's id, kept by --resume (GSDC-30 attempt keys).
async function call(prompt, opts) {
  const d = await agent(prompt, { ...opts, detail: true });
  return { result: d?.result ?? null, reason: d?.reason ?? null };
}
const fatal = (reason) => Boolean(reason && NEVER_RETRY.test(reason));
const needsOwner = (stage, reason, extra = {}) => ({ status: "needs-owner", stage, reason, ...extra });
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
call = async (prompt, opts) => {
  // GSDF-03: bind judgments and repairs to current code, planning artifacts and adapter settings.
  const identity = await flow(["digest"], { files: ["."] });
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
const FINDINGS_SCHEMA = { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { id: { type: "string" }, severity: { type: "string", enum: SEVERITIES }, trigger: { type: "string" }, likelihood: { type: "string" }, confidence: { type: "number" }, impact: { type: "string" }, file: { type: "string" }, line: { type: "number" }, description: { type: "string" } }, required: ["severity", "description"] } } }, required: ["findings"] };
const VERDICT_SCHEMA = { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, verdict: { type: "string", enum: ["confirmed", "refuted", "uncertain"] }, evidence: { type: "string" } }, required: ["id", "verdict"] } } }, required: ["verdicts"] };
const RESOLUTION_SCHEMA = { type: "object", properties: { resolution: { type: "array", items: { type: "object", properties: { id: { type: "string" }, resolved: { type: "boolean" }, evidence: { type: "string" } }, required: ["id", "resolved"] } } }, required: ["resolution"] };
const FIXER_SCHEMA = { type: "object", properties: { resolvedRequests: { type: "array", items: { type: "string" } }, status: { type: "string", enum: ["fixed", "unresolved"] }, attempts: { type: "number" }, remaining_failures: { type: "number" }, evidence: { type: "string" } }, required: ["status"] };
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
const N = phaseNumber(phaseDir);
const nn = phaseDir.split("/").pop().split("-")[0];
const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
const haltPath = (id) => `${phaseDir}/${id}-HALT.json`;
const PROGRESS = `${phaseDir}/execute-progress.json`;
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
const stackSkill = cfg.adapter.stack_skill ? `.claude/skills/${cfg.adapter.stack_skill}/SKILL.md` : null;
const waveResults = [];
const sharedChanges = [];
const events = [];
const worktrees = {};
const seeds = {};
const integrationFiles = new Set();
const ev = (e) => { events.push(e); log(`event ${e}`); };
const result = (status, extra = {}) => ({ status, phaseDir, mode: execMode, isolation: g.isolation, waves: waveResults, sharedChanges, events, ...extra });
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
const lease = await flow(["lock", "debug", runId]);
if (lease.code !== 0) return result("refused", { reason: `a debug session holds this code root (${lease.json?.holder ?? lease.json?.error ?? "unknown run"}); execute starts after it ends` });
try {
const anti = await flow(["anti-patterns", phaseDir]);
if (anti.code !== 0) return owner("Execute", `blocking anti-patterns need three written answers each in ${anti.json?.answersFile}: ${(anti.json?.unanswered ?? []).join(", ")}`, { rows: anti.json?.unanswered ?? [] });
const prefix = a.gapsOnly ? "gap-" : "";
async function readHandoff() {
  const list = [];
  for (let k = 1; ; k++) {
    const r = await flow(["read", `${phaseDir}/handoff/${prefix}w${k}.args.json`]);
    if (!r.json?.exists) break;
    list.push({ k, waveId: `${prefix}w${k}`, ...JSON.parse(r.json.text) });
  }
  return list;
}
const handoff = await readHandoff();
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
  if (pendingPlans.length && stuck.length) return result("nothing-to-run", { route: "stuck", reason: `phase stuck, resolve the halt: ${stuck.map((p) => p.id).join(", ")}` });
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
    if (JSON.stringify(await readHandoff()) !== JSON.stringify(handoff)) return result("refused", { reason: `the handoff files differ on ${branch}; plan the phase on that branch` });
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
  const rg = await flow(["resume-gate", phaseDir], { plans: gatePlans() });
  if (rg.json?.status === "error") return result("failed", { reason: `safe-resume gate could not look: ${rg.json.error}` });
  if (rg.code !== 0) return owner("Execute", `safe-resume gate: ${rg.json.problems.map((p) => `${p.kind}${p.path ? ` ${p.path}` : ""}${p.plan ? ` (plan ${p.plan})` : ""}`).join("; ")}`, { recovery: { problems: rg.json.problems, head: rg.json.head }, options: ["close out manually", "re-execute from scratch", "mark and skip"] });
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
const pendingRequests = progress.requests ??= {};
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
  return { plan: id, halted: true, reason: why };
}
async function headNow(cwd) { return (await shell(["git", "rev-parse", "HEAD"], cwd ? { cwd } : {})).stdout.trim(); }
function routeRequests(t, res) {
  for (const rq of res.requests ?? []) {
    const ownerTask = allTasks.find((x) => x.plan !== t.plan && (x.owns ?? []).some((o) => String(rq.path).startsWith(String(o).replace(/^Path:/, ""))));
    if (ownerTask) (pendingRequests[ownerTask.plan] ??= []).push({ from: t.plan, ...rq });
    else sharedChanges.push({ from: t.plan, ...rq });
  }
}
const ownerDecision = (res) => (res.deviations ?? []).find((x) => Number(x.rule) === 4 || x.kind === "checkpoint") ?? (res.taskResults ?? []).find((x) => x.status === "partial" || x.status === "blocked") ?? null;
async function dispatch(t, waveId) {
  await flow(["remove", haltPath(t.plan)]);
  const before = await headNow();
  const prompt = [execRuntime(t), digestLine(`plan:${t.plan}`, t.planHash ?? "none")].join("\n\n");
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
  routeRequests(t, res);
  const decision = ownerDecision(res);
  if (decision) return { ...(await halt(t.plan, `owner decision needed: ${decision.note ?? decision.evidence ?? decision.status}`)), decision };
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
  return owner(stage, bad.map((o) => `${o.plan}: ${o.reason}`).join("; "), { halted: bad, options: ["continue (rerun with the same args after resolving)", "stop"] });
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
  ? `After your changes run the build (${JSON.stringify(cmds.build)}) and the tests (${JSON.stringify(testArgv)}) yourself, at most ${g.fixer.max_build_attempts} times and within ${g.fixer.minutes} minutes; stop early when two consecutive attempts do not reduce the failure count. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.`
  : "Do not run the build or the tests: the orchestrator's gate verifies your changes. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.");
const fixerText = (owns, findings, failures) => [`<kit_fixer_runtime>\nYou own: ${JSON.stringify(owns)}. Fix the confirmed review findings and gate failures below, nothing else. Never commit.\n${fixerBlock()}\n</kit_fixer_runtime>`, findings.length ? `Confirmed findings (JSON): ${JSON.stringify(findings.map(({ id, file, line, trigger, description }) => ({ id, file, line, trigger, description })))}` : "", failures.length ? `Gate failures:\n${failureText(failures)}` : ""].filter(Boolean).join("\n\n");
const fixerOpts = (label, extra = {}) => ({ label, agentType: agentFor("fixer", "gsd-code-fixer"), role: "fixer", schema: FIXER_SCHEMA, ...extra });
// CR-GSF-16: every fix result is inspected before the gate reruns; a failed or unresolved repair stops the round.
async function fixRounds(waveId, tasks, first, label, tail) {
  let cur = first;
  let prev = first.failureCount;
  let noDrop = 0;
  for (let round = 1; !cur.green && round <= g.max_verify_rounds; round++) {
    const red = (why, extra = {}) => ({ stop: owner("Gate", `${label} is red after fix round ${round}: ${why}${tail}`, { failures: cur.failures, evidence: cur.evidence, blockedBy: cur.blockedBy, ...extra }) });
    const fixes = Object.entries(cur.byPlan ?? {}).map(([id, list]) => async () => {
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
    if ((cur.unplaced ?? []).length) {
      const files = [...new Set(cur.unplaced.flatMap((f) => f.files ?? []))];
      for (const f of files) integrationFiles.add(f);
      fixes.push(async () => ({ id: null, kind: "integration", ...(await call([`Integration fix: these gate failures belong to no plan. You own exactly these files: ${JSON.stringify(files)}.`, failureText(cur.unplaced), "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.", digestLine("fix:integration", await digestOf({ files })) ].join("\n\n"), fixerOpts(`integration-fix-${round}`))) }));
    }
    const results = await parallel(fixes);
    for (const r of results) {
      if (!r) return red("a fix call failed to run");
      if (r.skipped) continue;
      const who = r.id ? `plan ${r.id}` : "the integration fixer";
      if (r.result === null) return fatal(r.reason) ? { stop: owner("Gate", `fix call of ${who} failed: ${r.reason}`, { failure: classify(r.reason), evidence: cur.evidence }) } : red(`fix call of ${who} returned nothing${r.reason ? ` (${r.reason})` : ""}`);
      if (r.kind === "executor") {
        routeRequests(r.t, r.result);
        if (!(await saveProgress())) return red("could not persist pending change requests");
        const decision = ownerDecision(r.result);
        if (decision) return { stop: owner("Gate", `owner decision needed in the fix of ${r.id}: ${decision.note ?? decision.evidence ?? decision.status}`, { decision, evidence: cur.evidence }) };
        pendingRequests[r.id] = (pendingRequests[r.id] ?? []).filter((q) => !(r.result.resolvedRequests ?? []).includes(q.path));
      } else if (r.result.status !== "fixed") return red(`${who} unresolved (${r.result.remaining_failures ?? "?"} failures remain)${r.result.evidence ? `: ${r.result.evidence}` : ""}`);
      else if (r.id) pendingRequests[r.id] = (pendingRequests[r.id] ?? []).filter((q) => !(r.result.resolvedRequests ?? []).includes(q.path));
    }
    if (!(await saveProgress())) return red("could not persist pending change requests");
    if (worktreeMode) {
      const live = tasks.filter((t) => cur.byPlan?.[t.plan] && worktrees[t.plan]);
      const hs = haltStop(await integrate(live.map((t) => ({ plan: t.plan, ok: true, wt: worktrees[t.plan] })), live), "Gate");
      if (hs) return { stop: hs };
    }
    ev(`fix ${waveId} round ${round}`);
    cur = await runGate(waveId, tasks);
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
const gateFinding = (f) => {
  const high = ["critical", "high"].includes(String(f.severity).toLowerCase());
  if (!high) return "deferred";
  return String(f.trigger ?? "").trim() && Number(f.confidence) >= 80 && String(f.likelihood).toLowerCase() !== "theoretical" ? "gated" : "downgraded";
};
const metrics = { confirmed: 0, refuted: 0, unverified: 0, resolved: 0, deferred: 0 };
const findingFiles = (list) => [...new Set(list.map((f) => f.file).filter(Boolean))];
async function verifyFindings(gated, plan) {
  const verdicts = {};
  const dg = digestLine(`findings:${plan}`, await digestOf({ files: findingFiles(gated) }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = gated.filter((f) => !verdicts[f.id]);
    if (!missing.length) break;
    const r = await call([`Verify these review findings of plan ${plan} independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.`, `Findings (JSON): ${JSON.stringify(missing.map(({ id, file, line, trigger, description }) => ({ id, file, line, trigger, description })))}`, "Return JSON {verdicts: [{id, verdict, evidence}]}.", dg].join("\n\n"), { label: `verify-findings-${plan}`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: VERDICT_SCHEMA });
    // GSDF-01: a quota, credit or auth failure is never retried.
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `finding verifier of ${plan} failed: ${r.reason}`, { failure: classify(r.reason) }) };
    for (const v of r.result?.verdicts ?? []) if (missing.some((f) => f.id === v.id)) verdicts[v.id] = v.verdict;
  }
  for (const f of gated) f.verdict = verdicts[f.id] ?? "unverified";
  return {};
}
async function writeRecord(waveId, record) {
  const wr = await flow(["review-record", phaseDir], { waveId, record });
  return wr.code === 0 ? null : result("failed", { reason: `review record of ${record.plan} refused: ${(wr.json?.errors ?? [wr.json?.error ?? `exit ${wr.code}`]).join("; ")}` });
}
async function reviewPlan(t, waveId, codeOnly, scopeOverride) {
  const evScope = scopeOverride ? null : await gsd(["check", "evaluation-scope", "--plan", t.plan]);
  const sc = (await flow(["review-scope", phaseDir], { plan: t.plan, files: scopeOverride ?? a.files, summary: t.summary, evaluation: evScope?.json?.files ?? [] })).json ?? { scope: [] };
  for (const l of sc.log ?? []) log(`review scope ${t.plan}: ${l}`);
  const lenses = lensesFor(sc.scope ?? []);
  const record = { plan: t.plan, scope: sc.scope ?? [], excluded: sc.excluded ?? [], lenses: lenses.map((l) => l.name), codeOnly, findings: [], resolution: [] };
  if (record.scope.length) {
    const prompt = [`Review plan ${t.plan} (${planPath(t.plan)}) at depth ${g.review_depth}. Review only these files: ${record.scope.join(", ")}.`, codeOnly ? "This code is not built yet (code-only review)." : "The wave is built and its tests are green.", `Lenses:\n${lenses.map((l) => `- ${l.name}: ${l.text}`).join("\n")}`, "Every finding carries trigger (the concrete input or sequence that makes it fail), likelihood (likely|possible|theoretical), confidence 0-100, impact, file and line.", `Return JSON {findings: [{id, severity (${SEVERITIES.join("|")}), trigger, likelihood, confidence, impact, file, line, description}]}.`, digestLine(`review:${t.plan}`, await digestOf({ files: record.scope }))].join("\n\n");
    let r = await call(prompt, { label: `review-${t.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: FINDINGS_SCHEMA });
    if (r.result === null && !fatal(r.reason)) r = await call(prompt, { label: `review-${t.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: FINDINGS_SCHEMA });
    if (r.result === null) return { stop: owner("Review", `reviewer of ${t.plan} returned nothing${r.reason ? ` (${r.reason})` : ""}`) };
    // CR-GSF-17: an unknown severity is a named blocking error, never a silent downgrade to non-blocking.
    const unknown = (r.result.findings ?? []).filter((f) => !SEVERITIES.includes(String(f.severity).toLowerCase()));
    if (unknown.length) return { stop: owner("Review", `reviewer of ${t.plan} returned unknown severities (${[...new Set(unknown.map((f) => f.severity))].join(", ")}), expected ${SEVERITIES.join("|")}`, { findings: unknown }) };
    record.findings = (r.result.findings ?? []).map((f, i) => ({ id: f.id ?? `${t.plan}-F${i + 1}`, severity: String(f.severity).toLowerCase(), trigger: f.trigger ?? "", likelihood: f.likelihood ?? "", confidence: Number(f.confidence ?? 0), impact: f.impact ?? "", file: f.file ?? "", line: f.line ?? null, description: f.description ?? "", status: gateFinding(f), verdict: null }));
    const gated = record.findings.filter((f) => f.status === "gated");
    if (gated.length) {
      const vf = await verifyFindings(gated, t.plan);
      if (vf.stop) return vf;
    }
    const deferred = record.findings.filter((f) => f.status !== "gated");
    if (deferred.length) await flow(["append", `${phaseDir}/deferred.md`], deferred.map((f) => `- ${f.id} (${f.severity}, ${f.status}) plan ${t.plan} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.description} [reason: ${f.status === "downgraded" ? "missing trigger, confidence < 80 or theoretical" : "non-blocking severity"}]`).join("\n"));
    metrics.deferred += deferred.length;
  }
  for (const f of record.findings) if (f.verdict) metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] = (metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] ?? 0) + 1;
  const bad = await writeRecord(waveId, record);
  if (bad) return { stop: bad };
  ev(`review ${waveId} ${t.plan}${codeOnly ? " code-only" : ""}`);
  return { record, confirmed: record.findings.filter((f) => f.verdict === "confirmed"), unverified: record.findings.filter((f) => f.verdict === "unverified" || f.verdict === "uncertain") };
}
async function reviewAll(tasks, waveId, codeOnly) {
  const out = [];
  for (const t of tasks) {
    const r = await reviewPlan(t, waveId, codeOnly);
    if (r.stop) return r;
    out.push(r);
  }
  return { reviews: out, confirmed: out.flatMap((r) => r.confirmed), unverified: out.flatMap((r) => r.unverified) };
}
async function fixer(label, findings, failures, owns) {
  const prompt = [fixerText(owns, findings, failures), digestLine(`fix:${label}`, await digestOf({ owns, files: findingFiles(findings) }))].join("\n\n");
  const r = await call(prompt, fixerOpts(label, { timeoutS: (g.fixer.minutes + 5) * 60 }));
  ev(`fixer ${label}`);
  if (!r.result || r.result.status !== "fixed") return { stop: owner("Fix", r.result ? `fixer unresolved: ${r.result.remaining_failures ?? "?"} failures remain` : `fixer stopped or timed out${r.reason ? `: ${r.reason}` : ""}`, { evidence: r.result?.evidence ?? null }) };
  return { ok: true };
}
async function resolutionCheck(reviews, waveId) {
  const unresolved = [];
  for (const rv of reviews) {
    const confirmed = rv.record.findings.filter((f) => f.verdict === "confirmed");
    if (!confirmed.length) continue;
    const r = await call([`Resolution check of plan ${rv.record.plan}: decide for each finding below whether the current code resolves it. Review only these findings; raise no new ones.`, `Findings (JSON): ${JSON.stringify(confirmed.map(({ id, file, line, trigger, description }) => ({ id, file, line, trigger, description })))}`, "Return JSON {resolution: [{id, resolved, evidence}]}.", digestLine(`resolve:${rv.record.plan}`, await digestOf({ files: [...new Set([...rv.record.scope, ...findingFiles(confirmed)])] }))].join("\n\n"), { label: `resolve-${rv.record.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: RESOLUTION_SCHEMA });
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `resolution check of ${rv.record.plan} failed: ${r.reason}`, { failure: classify(r.reason) }) };
    rv.record.resolution = confirmed.map((f) => r.result?.resolution?.find((x) => x.id === f.id) ?? { id: f.id, resolved: false, evidence: "no answer" });
    for (const x of rv.record.resolution) x.resolved ? metrics.resolved++ : unresolved.push(x);
    const bad = await writeRecord(waveId, rv.record);
    if (bad) return { stop: bad };
  }
  ev(`resolution ${waveId}`);
  return { unresolved };
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
  if (haltedCoded.length) return { stop: owner("Execute", `plans with a SUMMARY and a halt record: ${haltedCoded.join(", ")}; resolve the halt first`, { halted: haltedCoded }) };
  for (const t of coded) log(`plan ${t.plan}: SUMMARY present but not committed; it rejoins the gate, review and commit of wave ${w.k}`);
  const toRun = open.filter((t) => !planInfo(t.plan).has_summary && planInfo(t.plan).ready !== false);
  const tasks = w.tasks.filter((t) => coded.includes(t) || toRun.includes(t));
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
  return hs ? { stop: hs } : { tasks };
}
const isTracer = (w) => w.tasks.some((t) => t.tracer === true || t.tracer?.is === true);
const metricsLine = (wave) => flow(["append", "_workspace/review-metrics.jsonl"], JSON.stringify({ phase: N, wave, ...metrics }));

if (execMode === "per-wave") {
  for (const w of waves) {
    const cw = await codeWave(w);
    if (cw.stop) return cw.stop;
    if (!cw.tasks.length) continue;
    const label = isTracer(w) ? "tracer wave" : `wave ${w.k}`;
    const tail = isTracer(w) ? "; no later wave starts" : "";
    phase("Gate");
    const fr = await fixRounds(w.waveId, cw.tasks, await runGate(w.waveId, cw.tasks), label, tail);
    if (fr.stop) return fr.stop;
    // GSDF-47: no reviewer before the wave is green; a red tracer starts no later wave.
    if (!fr.gate.green) return owner("Gate", `${label} is red after ${g.max_verify_rounds} fix rounds${tail}`, { failures: fr.gate.failures, evidence: fr.gate.evidence, blockedBy: fr.gate.blockedBy });
    phase("Review");
    const rv = await reviewAll(cw.tasks, w.waveId, false);
    if (rv.stop) return rv.stop;
    if (rv.unverified.length) return owner("Review", `${rv.unverified.length} blocking findings could not be verified`, { findings: rv.unverified });
    let evidence = fr.gate.evidence;
    if (rv.confirmed.length) {
      const fx = await fixer(`fix-review-${w.waveId}`, rv.confirmed, [], cw.tasks.flatMap((t) => t.owns ?? []));
      if (fx.stop) return fx.stop;
      const again = await runGate(w.waveId, cw.tasks);
      if (!again.green) return owner("Gate", `wave ${w.k} red after the review fix`, { failures: again.failures, evidence: again.evidence });
      evidence = again.evidence;
      const rc = await resolutionCheck(rv.reviews, w.waveId);
      if (rc.stop) return rc.stop;
      await metricsLine(w.waveId);
      if (rc.unresolved.length) return owner("Review", `${rc.unresolved.length} confirmed findings unresolved after one fix pass`, { findings: rc.unresolved });
    } else await metricsLine(w.waveId);
    const cm = await commitWaves([{ w, tasks: cw.tasks }], "green", evidence);
    if (cm.stop) return cm.stop;
    const tr = await track(w, cw.tasks, "green", evidence);
    if (tr.stop) return tr.stop;
  }
  return result("executed", { evidence: evidenceFiles });
}

// ---- batch mode (GSDF-49, D-63): code-only waves, one phase review, one final gate, one fixer ----
const done = [];
const allReviews = [];
for (const w of waves) {
  const cw = await codeWave(w);
  if (cw.stop) return cw.stop;
  if (!cw.tasks.length) continue;
  done.push({ w, tasks: cw.tasks });
  if (g.batch_review) {
    const rv = await reviewAll(cw.tasks, w.waveId, true);
    if (rv.stop) return rv.stop;
    allReviews.push(...rv.reviews);
  }
}
if (!done.length) return result("executed", { evidence: evidenceFiles });
phase("Batch");
const doneTasks = done.flatMap((d) => d.tasks);
// CR-GSF-10: the phase review covers the actual changes of every executed plan, with or without per-wave reviews.
const phaseFiles = await planFiles(doneTasks);
if (phaseFiles.stop) return phaseFiles.stop;
const phaseScope = [...new Set([...Object.values(phaseFiles.files).flat(), ...phaseFiles.integration])].filter((f) => !f.startsWith(".planning/")).sort();
if (!phaseScope.length) log("phase review: the phase diff holds no code changes");
const phaseReview = await reviewPlan({ plan: `${nn}-phase`, summary: null }, "phase", true, phaseScope);
if (phaseReview.stop) return phaseReview.stop;
allReviews.push(phaseReview);
const confirmed = allReviews.flatMap((r) => r.confirmed);
const unverified = allReviews.flatMap((r) => r.unverified);
if (unverified.length) return owner("Review", `${unverified.length} blocking findings could not be verified`, { findings: unverified });
const batchId = `${prefix}batch`;
let final = await runGate(batchId, doneTasks);
if (!final.green || confirmed.length) {
  const fx = await fixer("batch-fixer", confirmed, final.failures ?? [], doneTasks.flatMap((t) => t.owns ?? []));
  if (fx.stop) return fx.stop;
  final = await runGate(batchId, doneTasks);
  if (!final.green) return owner("Gate", "batch gate still red after the fixer", { failures: final.failures, evidence: final.evidence });
}
const rc = await resolutionCheck(allReviews, batchId);
if (rc.stop) return rc.stop;
await metricsLine(batchId);
if (rc.unresolved.length) return owner("Review", `${rc.unresolved.length} confirmed findings unresolved after the fixer`, { findings: rc.unresolved });
const cm = await commitWaves(done, "skipped", final.evidence);
if (cm.stop) return cm.stop;
for (const d of done) {
  const tr = await track(d.w, d.tasks, "skipped", final.evidence);
  if (tr.stop) return tr.stop;
}
return result("executed", { evidence: evidenceFiles, finalGate: final.evidence });
} finally {
  await flow(["unlock", "debug", lease.json.token]);
}
