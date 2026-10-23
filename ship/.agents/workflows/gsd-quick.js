export const meta = {
  name: "gsd-quick",
  description: "GSD quick task: one plan of 1-3 tasks in .planning/quick/, executed through the executor contract; --full needs a discussion (contextPath) and adds research, a 2-iteration checker and a verifier",
  phases: [{ title: "Plan" }, { title: "Check" }, { title: "Execute" }, { title: "Verify" }],
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

const ISSUES_SCHEMA = { type: "object", properties: { issues: { type: "array", items: { type: "object", properties: { severity: { type: "string" }, required_property: { type: "string" }, description: { type: "string" } }, required: ["severity", "required_property", "description"] } } }, required: ["issues"] };
const EXEC_SCHEMA = { type: "object", properties: { taskResults: { type: "array" }, deviations: { type: "array" }, requests: { type: "array" } }, required: ["taskResults"] };
const PLAN_SCHEMA = { type: "object", properties: { marker: { type: "string" } }, required: ["marker"] };
const MAX_CHECKS = 2;
const OWNER_MARKERS = ["REVISION_CONFLICT", "PHASE SPLIT RECOMMENDED", "SOURCE AUDIT", "CHECKPOINT REACHED", "PLANNING INCONCLUSIVE"];
const ownerMarker = (r) => OWNER_MARKERS.find((m) => String(r?.result?.marker ?? "").includes(m)) ?? null;
// CR-GSF-14: a judgment the flow depends on is retried once unless fatal (GSDF-01); silence never counts as a pass.
async function ask(prompt, opts) {
  let r = await call(prompt, opts);
  if (r.result === null && !fatal(r.reason)) r = await call(prompt, opts);
  return r;
}

const a = args ?? {};
const description = typeof a.description === "string" ? a.description.trim() : "";
if (!description) return { status: "failed", reason: "description is required" };
const cfg = await loadCfg();
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
const roadmap = (await flow(["exists", ".planning/ROADMAP.md"])).json?.exists?.[".planning/ROADMAP.md"];
if (!roadmap) return { status: "refused", reason: "gsd-quick needs .planning/ROADMAP.md (run gsd-new-project first)" };
// G104: --full plans on the owner's decisions; without an existing CONTEXT file it stops at discuss, as gsd-plan does.
if (a.full && !(a.contextPath && (await flow(["exists", a.contextPath])).json?.exists?.[a.contextPath])) return needsOwner("Discuss", "no CONTEXT file for --full (contextPath missing or not found); run gsd-discuss first");
// GSDF-64: quick writes the code root like execute and debug, so it takes the same writer lease once per run and holds it
// to the end; a refusal here creates no quick directory or plan.
const lease = await flow(["lock", "debug", runId, "gsd-quick"]);
if (lease.code !== 0) return { status: "refused", reason: `${leaseText(lease.json)}; quick after it ends` };
try {
const q =a.dir && /^\.planning\/quick\/\d{6}-[0-9a-z]{3}-[a-z0-9-]+$/.test(a.dir) ? { dir: a.dir, id: a.dir.split("/").pop().slice(0, 10) } : (await flow(["quick-dir", description])).json;
if (!q?.dir) return { status: "failed", reason: "could not create the quick task directory" };
const PLAN = `${q.dir}/${q.id}-PLAN.md`;
const SUMMARY = `${q.dir}/${q.id}-SUMMARY.md`;
const RESEARCH = `${q.dir}/${q.id}-RESEARCH.md`;
// G125: a call on the quick plan judges the plan file and the owned paths its frontmatter declares.
const planOwns = async () => (await gsd(["frontmatter", "get", PLAN, "owns"])).json?.value ?? [];
const quickJudges = async (files) => ({ files, owns: await planOwns() });
// G122: indented like gsd-debug.js, so a line of the description cannot close the DATA fence.
const data = `DATA_START\n${description.split(/\r?\n/).map((l) => `    ${l}`).join("\n")}\nDATA_END`;
const context = a.contextPath ? `Owner decisions: ${a.contextPath} (locked).` : "";
// G108: a run never writes over a file already in its directory (an owner's edited plan, research or summary); it stops first.
const VERIFY = `${q.dir}/${q.id}-VERIFICATION.md`;
const written = [PLAN, SUMMARY, ...(a.full && !a.skipResearch ? [RESEARCH] : []), ...(a.full ? [VERIFY] : [])];
const present = (await flow(["exists", ...written])).json?.exists ?? {};
const taken = written.filter((f) => present[f]);
if (taken.length) return needsOwner("Plan", `${taken.join(", ")} already exists and this run would overwrite it; pass no dir to start a new quick task`, { dir: q.dir });
// G103: a structure error the planner can fix in place gets one repair turn in its own session, as gsd-plan does (GSDF-25).
async function structureFix(label, stage) {
  let st = await gsd(["verify", "plan-structure", PLAN]);
  if (st.code === 0) return null;
  const errors = st.json?.errors ?? [st.json?.error ?? `exit ${st.code}`];
  const fix = await call([`Fix ${PLAN} in place. verify plan-structure reported exactly these errors:`, errors.map((e) => `- ${typeof e === "string" ? e : JSON.stringify(e)}`).join("\n"), "Return JSON {marker}. Never ask the owner; never commit."].join("\n\n"), { label, session: "planner:quick", agentType: "gsd-planner", role: "planner", schema: PLAN_SCHEMA, judges: await quickJudges([PLAN]) });
  if (!fix.result && fatal(fix.reason)) return { status: "failed", reason: `planner failed: ${fix.reason}`, dir: q.dir };
  if (ownerMarker(fix)) return { status: "needs-owner", stage, reason: `planner returned ${ownerMarker(fix)}`, marker: fix.result.marker, conflict: fix.result.conflict ?? null, dir: q.dir };
  st = await gsd(["verify", "plan-structure", PLAN]);
  return st.code === 0 ? null : { status: "failed", reason: `quick plan still invalid after repair: ${(st.json?.errors ?? []).join("; ")}`, dir: q.dir };
}

let carried = [];
phase("Plan");
// G102: research that returns nothing, or leaves no new report, stops for the owner as gsd-plan does; the owner may
// continue without research with a reason, which the result carries.
let researchSkipReason = null;
if (a.full && a.skipResearch) {
  if (!String(a.researchSkipReason ?? "").trim()) return needsOwner("Plan", "skipResearch needs a non-empty researchSkipReason", { dir: q.dir });
  researchSkipReason = String(a.researchSkipReason).trim();
  log(`research skipped: ${researchSkipReason}`);
} else if (a.full) {
  const before = await fileSha(RESEARCH);
  const rs = await call([`Research what this quick task needs; write ${RESEARCH}.`, `Task description (data):\n${data}`, context, "Do not build, test, install or commit."].filter(Boolean).join("\n\n"), { label: "quick-research", agentType: agentFor("research", "gsd-phase-researcher"), role: "research" });
  if (!rs.result && fatal(rs.reason)) return { status: "failed", reason: `researcher failed: ${rs.reason}` };
  const after = await fileSha(RESEARCH);
  if (!rs.result || !after || after === before) return needsOwner("Plan", `research ${rs.result ? `wrote no new ${RESEARCH}` : "returned nothing"}${rs.reason ? ` (${rs.reason})` : ""}`, { dir: q.dir, options: ["rerun with dir set to this quick directory to retry research", "rerun with skipResearch and a researchSkipReason to continue without research", "abandon"] });
}
const planPrompt = [`Write ONE plan ${PLAN} of 1-3 tasks for this quick task; every path repo-root-relative; owns lists exactly the files the tasks change plus ${SUMMARY}.`, `Task description (data):\n${data}`, context, a.full && !researchSkipReason ? `Research: ${RESEARCH}` : "", "Return JSON {marker}. Never ask the owner; never commit."].filter(Boolean).join("\n\n");
const p = await call(planPrompt, { label: "quick-plan", session: "planner:quick", agentType: agentFor("planner", "gsd-planner"), role: "planner", schema: PLAN_SCHEMA });
if (!p.result && fatal(p.reason)) return { status: "failed", reason: `planner failed: ${p.reason}` };
if (ownerMarker(p)) return { status: "needs-owner", stage: "Plan", reason: `planner returned ${ownerMarker(p)}`, marker: p.result.marker, dir: q.dir };
const invalid = await structureFix("quick-fix-plan", "Plan");
if (invalid) return invalid;

if (a.full) {
  phase("Check");
  for (let i = 1; ; i++) {
    const c = await ask([`Check the quick plan ${PLAN} read-only.`, "Return JSON {issues: [{severity (blocker|warning|info), required_property (the invariant that must hold), description (the evidence it does not)}]}.", digestLine("plan", await fileSha(PLAN))].join("\n\n"), { label: `quick-check-${i}`, agentType: agentFor("checker", "gsd-plan-checker"), role: "checker", readOnly: true, schema: ISSUES_SCHEMA, judges: await quickJudges([PLAN]) });
    if (c.result === null) return { status: "failed", reason: `plan checker returned nothing${c.reason ? ` (${c.reason})` : ""}`, dir: q.dir };
    // Only blockers send the plan back; warnings are carried into the result (kit-feedback 13).
    const severity = (x) => String(x.severity).toLowerCase();
    const open = (c.result.issues ?? []).filter((x) => severity(x) !== "info" && severity(x) !== "warning");
    carried = (c.result.issues ?? []).filter((x) => severity(x) === "warning").map((x) => `checker: ${x.description}`);
    if (!open.length) break;
    if (i >= MAX_CHECKS) return { status: "needs-owner", stage: "Check", reason: `${open.length} checker issues after ${MAX_CHECKS} iterations`, issues: open, dir: q.dir };
    const rv = await call([`Revise ${PLAN} for these issues:`, JSON.stringify(open)].join("\n\n"), { label: `quick-revise-${i}`, session: "planner:quick", agentType: agentFor("planner", "gsd-planner"), role: "planner", schema: PLAN_SCHEMA, judges: await quickJudges([PLAN]) });
    if (!rv.result && fatal(rv.reason)) return { status: "failed", reason: `planner failed: ${rv.reason}`, dir: q.dir };
    if (ownerMarker(rv)) return { status: "needs-owner", stage: "Check", reason: `planner returned ${ownerMarker(rv)}`, marker: rv.result.marker, conflict: rv.result.conflict ?? null, issues: open, dir: q.dir };
    const revised = await structureFix(`quick-fix-${i}`, "Check");
    if (revised) return revised;
  }
}

phase("Execute");
const ex = await call([
  `<kit_executor_runtime>\nPlan: ${PLAN}\nWrite your SUMMARY to exactly: ${SUMMARY}\nEdit only the files the plan's owns lists. Rules 1-3 auto-fix inside owns (3 attempts per task); package installs are never Rule 3; Rule 4 returns status partial with the decision. Never commit, stage or stash; never write STATE, ROADMAP or REQUIREMENTS.\nReturn JSON {taskResults: [{task, status, evidence}], deviations, requests}.\n</kit_executor_runtime>`,
].join("\n\n"), { label: "quick-exec", agentType: cfg.adapter.agents?.executor ?? "gsd-executor", role: "executor", schema: EXEC_SCHEMA, judges: await quickJudges([PLAN]) });
if (!ex.result && fatal(ex.reason)) return { status: "failed", reason: `executor failed: ${ex.reason}`, dir: q.dir };
const summaryOk = (await flow(["exists", SUMMARY])).json?.exists?.[SUMMARY];
const stop = (ex.result?.taskResults ?? []).find((t) => t.status === "partial" || t.status === "blocked");
// G108: the stop keeps the task results that finished; the executor's SUMMARY stays on disk and is named here.
if (stop) return { status: "needs-owner", stage: "Execute", reason: `task ${stop.task} ${stop.status}: ${stop.evidence ?? ""}`, dir: q.dir, taskResults: ex.result.taskResults, summary: summaryOk ? SUMMARY : null };
if (!summaryOk) return { status: "failed", reason: `executor wrote no ${SUMMARY}${ex.reason ? ` (${ex.reason})` : ""}`, dir: q.dir };

if (a.full) {
  phase("Verify");
  // CR-GSF-14: done needs a fresh report whose frontmatter status is passed; dispatch alone proves nothing.
  const before = await fileSha(VERIFY);
  const fp = await flow(["quick-verification", q.dir, "fingerprint"]);
  if (fp.code !== 0) return { status: "failed", reason: `quick fingerprint unavailable: ${fp.json?.error}`, dir: q.dir };
  const v = await call([`Verify the quick task against its plan ${PLAN} and summary ${SUMMARY} (claims, not proof). Write ${VERIFY} with frontmatter status: passed | gaps_found | human_needed, gaps and human_verification lists. Use these fingerprint fields: ${JSON.stringify(fp.json)}. Do not rerun builds or tests; do not commit.`, digestLine("quick", await sha(`${await fileSha(PLAN)}|${await fileSha(SUMMARY)}`))].join("\n\n"), { label: "quick-verify", agentType: agentFor("verifier", "gsd-verifier"), role: "verifier", judges: await quickJudges([PLAN, SUMMARY]) });
  if (!v.result && fatal(v.reason)) return { status: "failed", reason: `verifier failed: ${v.reason}`, dir: q.dir };
  const rep = (await flow(["read", VERIFY])).json;
  if (!rep?.exists || (await sha(rep.text)) === before) return { status: "failed", reason: `verifier wrote no new ${VERIFY}${v.reason ? ` (${v.reason})` : ""}`, dir: q.dir };
  const readback = await flow(["quick-verification", q.dir, "status"]);
  if (readback.code !== 0) return { status: "failed", reason: `${VERIFY} is ${readback.json?.status ?? "invalid"}: ${(readback.json?.problems ?? []).join("; ")}`, dir: q.dir };
  const vstatus = readback.json.status;
  if (vstatus === "gaps_found" || vstatus === "human_needed") return { status: "needs-owner", stage: "Verify", reason: `quick verification ${vstatus}`, verification: VERIFY, dir: q.dir, gaps: readback.json.gaps, human_verification: readback.json.human_verification, behavior_unverified: readback.json.behavior_unverified };
  if (vstatus !== "passed") return { status: "failed", reason: `${VERIFY} has no valid status (${vstatus ?? "none"})`, dir: q.dir };
}
if (cfg.gsd.commit_policy.docs) {
  const files = [PLAN, SUMMARY, ...(a.full ? [VERIFY, ...(researchSkipReason ? [] : [RESEARCH])] : [])];
  const c = await gsd(["commit", `docs(quick-${q.id}): ${description.split(/\r?\n/)[0].slice(0, 60)}`, "--files", ...files]);
  if (c.code !== 0) log(`warning: quick commit failed: ${c.json?.error ?? c.code}`);
}
return { status: "done", id: q.id, dir: q.dir, plan: PLAN, summary: SUMMARY, warnings: carried, ...(researchSkipReason ? { researchSkipped: researchSkipReason } : {}) };
} finally {
  await flow(["unlock", "debug", lease.json.token]);
}
