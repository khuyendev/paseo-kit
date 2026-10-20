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

const EXEC_SCHEMA = {
  type: "object",
  properties: {
    taskResults: { type: "array", items: { type: "object", properties: { task: { type: "string" }, status: { type: "string", enum: ["implemented", "partial", "blocked", "skipped"] }, evidence: { type: "string" } }, required: ["task", "status"] } },
    deviations: { type: "array" },
    requests: { type: "array", items: { type: "object", properties: { path: { type: "string" }, change: { type: "string" }, reason: { type: "string" } }, required: ["path", "change"] } },
  },
  required: ["taskResults"],
};
const FINDINGS_SCHEMA = { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { id: { type: "string" }, severity: { type: "string" }, trigger: { type: "string" }, likelihood: { type: "string" }, confidence: { type: "number" }, impact: { type: "string" }, file: { type: "string" }, line: { type: "number" }, description: { type: "string" } }, required: ["severity", "description"] } } }, required: ["findings"] };
const VERDICT_SCHEMA = { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, verdict: { type: "string", enum: ["confirmed", "refuted", "uncertain"] }, evidence: { type: "string" } }, required: ["id", "verdict"] } } }, required: ["verdicts"] };
const RESOLUTION_SCHEMA = { type: "object", properties: { resolution: { type: "array", items: { type: "object", properties: { id: { type: "string" }, resolved: { type: "boolean" }, evidence: { type: "string" } }, required: ["id", "resolved"] } } }, required: ["resolution"] };
const FIXER_SCHEMA = { type: "object", properties: { status: { type: "string", enum: ["fixed", "unresolved"] }, attempts: { type: "number" }, remaining_failures: { type: "number" }, evidence: { type: "string" } }, required: ["status"] };
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
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
const stackSkill = cfg.adapter.stack_skill ? `.claude/skills/${cfg.adapter.stack_skill}/SKILL.md` : null;
const waveResults = [];
const sharedChanges = [];
const events = [];
const ev = (e) => { events.push(e); log(`event ${e}`); };
const result = (status, extra = {}) => ({ status, phaseDir, mode: execMode, isolation: g.isolation, waves: waveResults, sharedChanges, events, ...extra });
const owner = (stage, reason, extra = {}) => result("needs-owner", { stage, reason, ...extra });

// Bounded pool: at most `limit` executors at a time (GSDF-93); never above max_subagents.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await parallel(Array.from({ length: Math.min(n, items.length) }, () => async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// ---- preconditions (GSDF-40, GSDF-11, GSDF-02, GSDF-39) ----
phase("Preconditions");
const guard = await flow(["cwd-guard", cfg.worktree_dir]);
if (guard.code !== 0) return result("refused", { reason: (guard.json?.problems ?? ["cwd guard failed"]).join("; "), stranded: guard.json?.stranded ?? [], dirty: guard.json?.dirty ?? [] });
const anti = await flow(["anti-patterns", phaseDir]);
if (anti.code !== 0) return owner("Execute", `blocking anti-patterns need three written answers each in ${anti.json?.answersFile}: ${(anti.json?.unanswered ?? []).join(", ")}`, { rows: anti.json?.unanswered ?? [] });
const prefix = a.gapsOnly ? "gap-" : "";
const handoff = [];
for (let k = 1; ; k++) {
  const r = await flow(["read", `${phaseDir}/handoff/${prefix}w${k}.args.json`]);
  if (!r.json?.exists) break;
  handoff.push({ k, waveId: `${prefix}w${k}`, ...JSON.parse(r.json.text) });
}
if (!handoff.length) return result("refused", { reason: `no handoff files in ${phaseDir}/handoff/ (${prefix}w1.args.json); plan the phase first` });
const index = async () => (await gsd(["phase-plan-index", N])).json ?? { plans: [] };
let idx = await index();
const planInfo = (id) => idx.plans.find((p) => p.id === id) ?? {};
if (a.gapsOnly) {
  const lacking = idx.plans.filter((p) => p.gap_closure === undefined || p.gap_closure === null).map((p) => p.id);
  if (lacking.length) return result("refused", { reason: `--gaps-only needs a gap_closure key in every plan; missing in ${lacking.join(", ")}` });
}
const selectedTask = (t) => (!planFilter || planFilter.includes(t.plan)) && (!a.gapsOnly || planInfo(t.plan).gap_closure === true);
if (waveFilter !== null) {
  const lower = handoff.filter((w) => w.k < waveFilter).flatMap((w) => w.tasks).filter((t) => !planInfo(t.plan).has_summary).map((t) => t.plan);
  if (lower.length) return result("refused", { reason: `wave ${waveFilter} refused: lower waves have incomplete plans ${[...new Set(lower)].join(", ")}` });
}
const waves = handoff.filter((w) => waveFilter === null || w.k === waveFilter);
const wanted = waves.flatMap((w) => w.tasks).filter(selectedTask);
const pendingPlans = wanted.filter((t) => !planInfo(t.plan).has_summary);
if (!pendingPlans.some((t) => planInfo(t.plan).ready)) {
  if ((planFilter || waveFilter !== null || a.gapsOnly) && !wanted.length) return result("nothing-to-run", { route: "none", reason: "no matching plans" });
  const stuck = idx.plans.filter((p) => p.halted || (p.blocked_by ?? []).length);
  if (pendingPlans.length && stuck.length) return result("nothing-to-run", { route: "stuck", reason: `phase stuck, resolve the halt: ${stuck.map((p) => p.id).join(", ")}` });
  if (pendingPlans.length) return result("nothing-to-run", { route: "waiting", reason: "plans not ready yet" });
  const ver = await gsd(["verification", "status", phaseDir]);
  const vs = ver.code === 66 ? "missing" : ver.json?.status;
  if (vs === "missing" || vs === "stale" || ver.code === 1) return result("nothing-to-run", { route: "verify", reason: `all plans summarised; verification ${vs ?? "invalid"}: run gsd-verify` });
  if (vs === "passed") return result("nothing-to-run", { route: "complete", reason: "verification passed: run phase complete" });
  return result("nothing-to-run", { route: vs === "gaps_found" ? "plan-gaps" : "uat", reason: `verification ${vs}` });
}

// ---- execute baseline and safe-resume gate (GSDF-38) ----
phase("Baseline");
const allTasks = handoff.flatMap((w) => w.tasks);
const gatePlans = () => allTasks.map((t) => ({ id: t.plan, owns: t.owns ?? [], summary: t.summary, complete: Boolean(planInfo(t.plan).has_summary) }));
await flow(["baseline", phaseDir]);
async function resumeGate() {
  const rg = await flow(["resume-gate", phaseDir], { plans: gatePlans() });
  if (rg.json?.status === "error") return result("failed", { reason: `safe-resume gate could not look: ${rg.json.error}` });
  if (rg.code !== 0) return owner("Execute", `safe-resume gate: ${rg.json.problems.map((p) => `${p.kind}${p.path ? ` ${p.path}` : ""}${p.plan ? ` (plan ${p.plan})` : ""}`).join("; ")}`, { recovery: { problems: rg.json.problems, head: rg.json.head }, options: ["close out manually", "re-execute from scratch", "mark and skip"] });
  for (const t of pendingPlans) {
    const sc = await gsd(["check", "evaluation-scope", "--plan", t.plan, "--commits-only"]);
    if (!["resolved", "degraded"].includes(sc.json?.status)) return result("failed", { reason: `evaluation scope of ${t.plan} is ${sc.json?.status ?? `exit ${sc.code}`}: no executor started (fail-closed)` });
    if ((sc.json.commits ?? []).length) return owner("Execute", `plan ${t.plan} has commits (${sc.json.commits.slice(0, 3).map((c) => c.sha ?? c).join(", ")}) but no SUMMARY`, { options: ["close out manually", "re-execute from scratch", "mark and skip"] });
  }
  return null;
}
const stop0 = await resumeGate();
if (stop0) return stop0;

// ---- branching (GSDF-54) ----
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
  }
}
async function warnProtected() {
  const cur = (await shell(["git", "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  if (g.branching === "none" && (g.protected_branches ?? []).includes(cur)) log(`warning: committing to protected branch ${cur}`);
}

// ---- gap wave cap (GSDF-30): mark the attempt before the first executor ----
if (a.gapsOnly) {
  const at = await gsd(["attempt", "show", phaseDir, "--kind", "gap"]);
  if (at.code !== 0) return result("refused", { reason: "no gap attempt record; plan the gaps first" });
  if (at.json.result?.waveExecuted) return owner("Gaps", "the gap wave of this phase already executed; gap closure is capped at one wave", { options: ["verify again", "plan the leftovers as a new phase"] });
  await gsd(["attempt", "record", phaseDir, "--kind", "gap"], { runId: at.json.runId, inputDigest: at.json.inputDigest, before: at.json.before, done: true, result: { ...(at.json.result ?? {}), waveExecuted: true } });
}

// ---- executors (GSDF-41..43, GSDF-45, GSDF-52) ----
const pendingRequests = {};
const execRuntime = (t) => [
  "<kit_executor_runtime>",
  `Plan: ${planPath(t.plan)}`,
  `Write your SUMMARY to exactly: ${t.summary}`,
  `You may edit only these paths (owns): ${JSON.stringify(t.owns ?? [])}`,
  `Stack skill to follow: ${stackSkill ?? "none"}`,
  "Deviation rules (the kit adapter of the rules in your role text):",
  "- Rules 1-3 (bugs, missing critical functionality, blockers): fix automatically, only inside owns; at most 3 auto-fix attempts per task, then list it under Deferred Issues in the SUMMARY.",
  "- Rule 3 never covers package installs: a needed install, or one that fails, returns a blocking human checkpoint (task status blocked, deviation {rule: 3, kind: checkpoint}).",
  "- Rule 4 (architectural change): stop the task and return status partial with the decision needed in the deviation notes ({rule: 4, note}).",
  "- A change needed in a file you do not own: do not edit it; return it in requests [{path, change, reason}].",
  "- Never commit, stage or stash; never write STATE, ROADMAP or REQUIREMENTS.",
  "- The orchestrator's gate runs the build and the tests after the wave: do not run them yourself.",
  "Return JSON {taskResults: [{task, status: implemented|partial|blocked|skipped, evidence}], deviations: [{rule, kind, note}], requests: [{path, change, reason}]}.",
  "</kit_executor_runtime>",
].join("\n");
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
async function dispatch(t, waveId) {
  await flow(["remove", haltPath(t.plan)]);
  const before = await headNow();
  const prompt = [execRuntime(t), digestLine(`plan:${t.plan}`, t.planHash ?? "none")].join("\n\n");
  const opts = { label: `exec-${t.plan}`, session: `executor:${t.plan}`, agentType: agentFor("executor", "gsd-executor"), role: "executor", schema: EXEC_SCHEMA };
  if (t.model) opts.model = t.model;
  if (t.effort) opts.effort = t.effort;
  if (worktreeMode) opts.isolation = "worktree";
  const d = await agent(prompt, { ...opts, detail: true });
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
  for (const rq of res.requests ?? []) {
    const ownerTask = allTasks.find((x) => x.plan !== t.plan && (x.owns ?? []).some((o) => String(rq.path).startsWith(String(o).replace(/^Path:/, ""))));
    if (ownerTask) (pendingRequests[ownerTask.plan] ??= []).push({ from: t.plan, ...rq });
    else sharedChanges.push({ from: t.plan, ...rq });
  }
  const stopTask = (res.taskResults ?? []).find((x) => x.status === "partial" || x.status === "blocked");
  const rule4 = (res.deviations ?? []).find((x) => Number(x.rule) === 4 || x.kind === "checkpoint");
  if (stopTask || rule4) return { ...(await halt(t.plan, `owner decision needed: ${rule4?.note ?? stopTask?.evidence ?? stopTask?.status}`)), decision: rule4 ?? stopTask };
  if (!hasSummary) return { ...(await halt(t.plan, `no SUMMARY at ${t.summary}`)), failed: true };
  return { plan: t.plan, ok: true, wt };
}
async function integrate(outcomes, tasks) {
  for (const t of tasks) {
    const o = outcomes.find((x) => x?.plan === t.plan);
    if (!o?.ok) continue;
    if (worktreeMode && o.wt) {
      const tr = await flow(["transfer", phaseDir], { plan: t.plan, worktree: o.wt, owns: t.owns ?? [], summary: t.summary, files_deleted: planInfo(t.plan).files_deleted ?? [] });
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
async function fixRounds(waveId, tasks, first) {
  let cur = first;
  let prev = first.failureCount;
  let noDrop = 0;
  for (let round = 1; !cur.green && round <= g.max_verify_rounds; round++) {
    const fixes = Object.entries(cur.byPlan ?? {}).map(([id, list]) => async () => {
      const t = tasks.find((x) => x.plan === id);
      if (!t) return null;
      const reqs = pendingRequests[id] ?? [];
      const prompt = [`Fix round ${round} for plan ${id}: the gate failed on your owned files. Fix only inside your owns; do not run the build or the tests.`, failureText(list), reqs.length ? `Change requests from other plans of this wave (JSON): ${JSON.stringify(reqs)}` : "", `Evidence: ${cur.evidence}`, "Return the same JSON as before."].filter(Boolean).join("\n\n");
      const r = await call(prompt, { label: `fix-${id}-${round}`, session: `executor:${id}`, agentType: agentFor("executor", "gsd-executor"), role: "executor", schema: EXEC_SCHEMA });
      if (r.result) delete pendingRequests[id]; // requests survive a failed fix turn (GSDF-52)
      return r;
    });
    if ((cur.unplaced ?? []).length) {
      const files = [...new Set(cur.unplaced.flatMap((f) => f.files ?? []))];
      fixes.push(() => call([`Integration fix: these gate failures belong to no plan. You own exactly these files: ${JSON.stringify(files)}.`, failureText(cur.unplaced), "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}."].join("\n\n"), { label: `integration-fix-${round}`, agentType: agentFor("fixer", "gsd-code-fixer"), role: "fixer", schema: FIXER_SCHEMA }));
    }
    await parallel(fixes);
    if (worktreeMode) { const fixed = tasks.filter((t) => cur.byPlan?.[t.plan]); await integrate(fixed.map((t) => ({ plan: t.plan, ok: true, wt: worktrees[t.plan] })), fixed); }
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
async function verifyFindings(gated, plan) {
  const verdicts = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = gated.filter((f) => !verdicts[f.id]);
    if (!missing.length) break;
    const r = await call([`Verify these review findings of plan ${plan} independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.`, `Findings (JSON): ${JSON.stringify(missing.map(({ id, file, line, trigger, description }) => ({ id, file, line, trigger, description })))}`, "Return JSON {verdicts: [{id, verdict, evidence}]}."].join("\n\n"), { label: `verify-findings-${plan}`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: VERDICT_SCHEMA });
    for (const v of r.result?.verdicts ?? []) if (missing.some((f) => f.id === v.id)) verdicts[v.id] = v.verdict;
  }
  for (const f of gated) f.verdict = verdicts[f.id] ?? "unverified";
}
async function reviewPlan(t, waveId, codeOnly, scopeOverride) {
  const evScope = scopeOverride ? null : await gsd(["check", "evaluation-scope", "--plan", t.plan]);
  const sc = (await flow(["review-scope", phaseDir], { plan: t.plan, files: scopeOverride ?? a.files, summary: t.summary, evaluation: evScope?.json?.files ?? [] })).json ?? { scope: [] };
  for (const l of sc.log ?? []) log(`review scope ${t.plan}: ${l}`);
  const lenses = lensesFor(sc.scope ?? []);
  const record = { plan: t.plan, scope: sc.scope ?? [], excluded: sc.excluded ?? [], lenses: lenses.map((l) => l.name), codeOnly, findings: [], resolution: [] };
  if (record.scope.length) {
    const prompt = [`Review plan ${t.plan} (${planPath(t.plan)}) at depth ${g.review_depth}. Review only these files: ${record.scope.join(", ")}.`, codeOnly ? "This code is not built yet (code-only review)." : "The wave is built and its tests are green.", `Lenses:\n${lenses.map((l) => `- ${l.name}: ${l.text}`).join("\n")}`, "Every finding carries trigger (the concrete input or sequence that makes it fail), likelihood (likely|possible|theoretical), confidence 0-100, impact, file and line.", "Return JSON {findings: [{id, severity (critical|high|medium|low|info), trigger, likelihood, confidence, impact, file, line, description}]}."].join("\n\n");
    let r = await call(prompt, { label: `review-${t.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: FINDINGS_SCHEMA });
    if (r.result === null && !fatal(r.reason)) r = await call(prompt, { label: `review-${t.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: FINDINGS_SCHEMA });
    if (r.result === null) return { stop: owner("Review", `reviewer of ${t.plan} returned nothing${r.reason ? ` (${r.reason})` : ""}`) };
    record.findings = (r.result.findings ?? []).map((f, i) => ({ id: f.id ?? `${t.plan}-F${i + 1}`, severity: String(f.severity).toLowerCase(), trigger: f.trigger ?? "", likelihood: f.likelihood ?? "", confidence: Number(f.confidence ?? 0), impact: f.impact ?? "", file: f.file ?? "", line: f.line ?? null, description: f.description ?? "", status: gateFinding(f), verdict: null }));
    const gated = record.findings.filter((f) => f.status === "gated");
    if (gated.length) await verifyFindings(gated, t.plan);
    const deferred = record.findings.filter((f) => f.status !== "gated");
    if (deferred.length) await flow(["append", `${phaseDir}/deferred.md`], deferred.map((f) => `- ${f.id} (${f.severity}, ${f.status}) plan ${t.plan} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.description} [reason: ${f.status === "downgraded" ? "missing trigger, confidence < 80 or theoretical" : "non-blocking severity"}]`).join("\n"));
    metrics.deferred += deferred.length;
  }
  for (const f of record.findings) if (f.verdict) metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] = (metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] ?? 0) + 1;
  await flow(["review-record", phaseDir], { waveId, record });
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
const fixerBlock = () => (g.fixer_verifies_itself
  ? `After your changes run the build (${JSON.stringify(cmds.build)}) and the tests (${JSON.stringify(testArgv)}) yourself, at most ${g.fixer.max_build_attempts} times and within ${g.fixer.minutes} minutes; stop early when two consecutive attempts do not reduce the failure count. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.`
  : "Do not run the build or the tests: the orchestrator's gate verifies your changes. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.");
async function fixer(label, findings, failures, owns) {
  const prompt = [`<kit_fixer_runtime>\nYou own: ${JSON.stringify(owns)}. Fix the confirmed review findings and gate failures below, nothing else. Never commit.\n${fixerBlock()}\n</kit_fixer_runtime>`, findings.length ? `Confirmed findings (JSON): ${JSON.stringify(findings.map(({ id, file, line, trigger, description }) => ({ id, file, line, trigger, description })))}` : "", failures.length ? `Gate failures:\n${failureText(failures)}` : ""].filter(Boolean).join("\n\n");
  const r = await call(prompt, { label, agentType: agentFor("fixer", "gsd-code-fixer"), role: "fixer", schema: FIXER_SCHEMA, timeoutS: (g.fixer.minutes + 5) * 60 });
  ev(`fixer ${label}`);
  if (!r.result || r.result.status !== "fixed") return { stop: owner("Fix", r.result ? `fixer unresolved: ${r.result.remaining_failures ?? "?"} failures remain` : `fixer stopped or timed out${r.reason ? `: ${r.reason}` : ""}`, { evidence: r.result?.evidence ?? null }) };
  return { ok: true };
}
async function resolutionCheck(reviews, waveId) {
  const unresolved = [];
  for (const rv of reviews) {
    const confirmed = rv.record.findings.filter((f) => f.verdict === "confirmed");
    if (!confirmed.length) continue;
    const r = await call([`Resolution check of plan ${rv.record.plan}: decide for each finding below whether the current code resolves it. Review only these findings; raise no new ones.`, `Findings (JSON): ${JSON.stringify(confirmed.map(({ id, file, line, trigger, description }) => ({ id, file, line, trigger, description })))}`, "Return JSON {resolution: [{id, resolved, evidence}]}."].join("\n\n"), { label: `resolve-${rv.record.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: RESOLUTION_SCHEMA });
    rv.record.resolution = confirmed.map((f) => r.result?.resolution?.find((x) => x.id === f.id) ?? { id: f.id, resolved: false, evidence: "no answer" });
    for (const x of rv.record.resolution) x.resolved ? metrics.resolved++ : unresolved.push(x);
    await flow(["review-record", phaseDir], { waveId, record: rv.record });
  }
  ev(`resolution ${waveId}`);
  return unresolved;
}

// ---- orchestrator commits (GSDF-53) and tracking ----
async function planFiles(tasks) {
  const files = {};
  const removed = [];
  if (worktreeMode) {
    for (const t of tasks) {
      const tr = (await flow(["read", `${phaseDir}/transfers/${t.plan}.json`])).json;
      const rec = tr?.exists ? JSON.parse(tr.text) : { files: [] };
      files[t.plan] = rec.files.filter((f) => !f.deleted).map((f) => f.path);
      removed.push(...rec.files.filter((f) => f.deleted).map((f) => f.path));
    }
  } else {
    const oc = (await flow(["owned-changes", phaseDir], { plans: tasks.map((t) => ({ id: t.plan, owns: t.owns ?? [], summary: t.summary })) })).json;
    Object.assign(files, oc?.files ?? {});
  }
  for (const t of tasks) if (t.summary && !(files[t.plan] ??= []).includes(t.summary)) files[t.plan].push(t.summary);
  return { files, removed };
}
async function commitOne(subject, plansIn, wave, files, removed) {
  await warnProtected();
  const all = [...new Set(plansIn.flatMap((id) => files[id] ?? []))];
  const message = `${subject}\n\nPlans: ${plansIn.join(",")}`;
  const c = await gsd(["commit", message, "--files", ...all, ...(removed.length ? ["--files-removed", ...removed] : [])]);
  if (!c.json?.committed) { log(`warning: commit skipped or failed: ${c.json?.reason ?? c.json?.error ?? c.code}`); return null; }
  await flow(["json-push", `${phaseDir}/commits.json`], { sha: c.json.hash, phase: N, wave, plans: Object.fromEntries(plansIn.map((id) => [id, files[id] ?? []])) });
  ev(`commit ${subject}`);
  return c.json.hash;
}
async function commitWave(w, tasks) {
  phase("Commit");
  const { files, removed } = await planFiles(tasks);
  const ids = tasks.map((t) => t.plan);
  if (g.commit_policy.code === "per-plan") for (const id of ids) await commitOne(`feat(${id}): phase ${N} plan ${id}`, [id], w.k, files, removed);
  else await commitOne(`feat(${N}-w${w.k}): phase ${N} wave ${w.k}`, ids, w.k, files, removed);
}
async function track(w, tasks, verify, evidence) {
  await gsd(["state", "wave", "--phase", N, "--wave", String(w.k)], { plans: tasks.map((t) => t.plan), verify, evidence });
  waveResults.push({ wave: w.k, waveId: w.waveId, plans: tasks.map((t) => t.plan), verify, evidence });
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
async function codeWave(w) {
  phase("Wave");
  idx = await index();
  const tasks = w.tasks.filter(selectedTask).filter((t) => !planInfo(t.plan).has_summary && planInfo(t.plan).ready !== false);
  if (!tasks.length) return { tasks };
  if (!worktreeMode) {
    const ow = await gsd(["check", "owns", N, "--plans", tasks.map((t) => t.plan).join(",")]);
    if (ow.code !== 0) return { stop: result("refused", { reason: `shared tree needs disjoint owns in wave ${w.k}: ${JSON.stringify(ow.json?.problems ?? ow.json?.errors ?? [])}` }) };
  }
  const stop = await resumeGate();
  if (stop) return { stop };
  const outcomes = [];
  for (const group of overlapGroups(tasks)) outcomes.push(...(await pool(group, limit, (t) => dispatch(t, w.waveId))));
  for (const o of outcomes) if (o?.wt) worktrees[o.plan] = o.wt;
  await integrate(outcomes, tasks);
  const hs = haltStop(outcomes, "Execute");
  return hs ? { stop: hs } : { tasks };
}
const worktrees = {};
const isTracer = (w) => w.tasks.some((t) => t.tracer === true || t.tracer?.is === true);

if (execMode === "per-wave") {
  for (const w of waves) {
    const cw = await codeWave(w);
    if (cw.stop) return cw.stop;
    if (!cw.tasks.length) continue;
    phase("Gate");
    const fr = await fixRounds(w.waveId, cw.tasks, await runGate(w.waveId, cw.tasks));
    if (fr.stop) return fr.stop;
    // GSDF-47: no reviewer before the wave is green; a red tracer starts no later wave.
    if (!fr.gate.green) return owner("Gate", `${isTracer(w) ? "tracer wave" : `wave ${w.k}`} is red after ${g.max_verify_rounds} fix rounds${isTracer(w) ? "; no later wave starts" : ""}`, { failures: fr.gate.failures, evidence: fr.gate.evidence, blockedBy: fr.gate.blockedBy });
    phase("Review");
    const rv = await reviewAll(cw.tasks, w.waveId, false);
    if (rv.stop) return rv.stop;
    if (rv.unverified.length) return owner("Review", `${rv.unverified.length} blocking findings could not be verified`, { findings: rv.unverified });
    if (rv.confirmed.length) {
      const fx = await fixer(`fix-review-${w.waveId}`, rv.confirmed, [], cw.tasks.flatMap((t) => t.owns ?? []));
      if (fx.stop) return fx.stop;
      const again = await runGate(w.waveId, cw.tasks);
      if (!again.green) return owner("Gate", `wave ${w.k} red after the review fix`, { failures: again.failures, evidence: again.evidence });
      const unresolved = await resolutionCheck(rv.reviews, w.waveId);
      await flow(["append", "_workspace/review-metrics.jsonl"], JSON.stringify({ phase: N, wave: w.waveId, ...metrics }));
      if (unresolved.length) return owner("Review", `${unresolved.length} confirmed findings unresolved after one fix pass`, { findings: unresolved });
    } else await flow(["append", "_workspace/review-metrics.jsonl"], JSON.stringify({ phase: N, wave: w.waveId, ...metrics }));
    await commitWave(w, cw.tasks);
    await track(w, cw.tasks, "green", evidenceFiles.at(-1));
  }
  return result("executed", { evidence: evidenceFiles });
}

// ---- batch mode (GSDF-49, D-63): code-only waves, one final gate, one fixer ----
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
const phaseScope = [...new Set(allReviews.flatMap((r) => r.record.scope))];
const phaseReview = await reviewPlan({ plan: `${nn}-phase`, summary: null }, "phase", true, phaseScope.length ? phaseScope : null);
if (phaseReview.stop) return phaseReview.stop;
allReviews.push(phaseReview);
const confirmed = allReviews.flatMap((r) => r.confirmed);
const unverified = allReviews.flatMap((r) => r.unverified);
if (unverified.length) return owner("Review", `${unverified.length} blocking findings could not be verified`, { findings: unverified });
let final = await runGate("batch", doneTasks);
if (!final.green || confirmed.length) {
  const fx = await fixer("batch-fixer", confirmed, final.failures ?? [], doneTasks.flatMap((t) => t.owns ?? []));
  if (fx.stop) return fx.stop;
  final = await runGate("batch", doneTasks);
  if (!final.green) return owner("Gate", "batch gate still red after the fixer", { failures: final.failures, evidence: final.evidence });
}
const unresolved = await resolutionCheck(allReviews, "batch");
await flow(["append", "_workspace/review-metrics.jsonl"], JSON.stringify({ phase: N, wave: "batch", ...metrics }));
if (unresolved.length) return owner("Review", `${unresolved.length} confirmed findings unresolved after the fixer`, { findings: unresolved });
for (const d of done) {
  await commitWave(d.w, d.tasks);
  await track(d.w, d.tasks, "skipped", final.evidence);
}
return result("executed", { evidence: evidenceFiles, finalGate: final.evidence });
