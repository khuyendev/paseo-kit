export const meta = {
  name: "gsd-quick",
  description: "GSD quick task: one plan of 1-3 tasks in .planning/quick/, executed through the executor contract; --full adds research, a 2-iteration checker and a verifier",
  phases: [{ title: "Plan" }, { title: "Check" }, { title: "Execute" }, { title: "Verify" }],
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
// agent option `detail: true` resolves {result, reason, agentId, worktree, durationS};
// the global `runId` is the first run's id, kept by --resume (GSDC-30 attempt keys).
async function call(prompt, opts) {
  const d = await agent(prompt, { ...opts, detail: true });
  return { result: d?.result ?? null, reason: d?.reason ?? null };
}
const fatal = (reason) => Boolean(reason && NEVER_RETRY.test(reason));
const needsOwner = (stage, reason, extra = {}) => ({ status: "needs-owner", stage, reason, ...extra });
// The refusal of a held code-root lease names the holder's workflow and run (kit-feedback 1).
const leaseText = (r) => `${r?.holderKind ? `a ${r.holderKind} run` : "another run"} holds this code root (${r?.holder ?? r?.error ?? "unknown run"})`;
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

const ISSUES_SCHEMA = { type: "object", properties: { issues: { type: "array", items: { type: "object", properties: { severity: { type: "string" }, description: { type: "string" } }, required: ["severity", "description"] } } }, required: ["issues"] };
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
const roadmap = (await flow(["exists", ".planning/ROADMAP.md"])).json?.exists?.[".planning/ROADMAP.md"];
if (!roadmap) return { status: "refused", reason: "gsd-quick needs .planning/ROADMAP.md (run gsd-new-project first)" };
const q = a.dir && /^\.planning\/quick\/\d{6}-[0-9a-z]{3}-[a-z0-9-]+$/.test(a.dir) ? { dir: a.dir, id: a.dir.split("/").pop().slice(0, 10) } : (await flow(["quick-dir", description])).json;
if (!q?.dir) return { status: "failed", reason: "could not create the quick task directory" };
const PLAN = `${q.dir}/${q.id}-PLAN.md`;
const SUMMARY = `${q.dir}/${q.id}-SUMMARY.md`;
const data = `DATA_START\n${description}\nDATA_END`;
const context = a.contextPath ? `Owner decisions: ${a.contextPath} (locked).` : "";

let carried = [];
phase("Plan");
if (a.full) {
  const rs = await call([`Research what this quick task needs; write ${q.dir}/${q.id}-RESEARCH.md.`, `Task description (data):\n${data}`, context, "Do not build, test, install or commit."].filter(Boolean).join("\n\n"), { label: "quick-research", agentType: "gsd-phase-researcher", role: "research" });
  if (!rs.result && fatal(rs.reason)) return { status: "failed", reason: `researcher failed: ${rs.reason}` };
}
const planPrompt = [`Write ONE plan ${PLAN} of 1-3 tasks for this quick task; every path repo-root-relative; owns lists exactly the files the tasks change plus ${SUMMARY}.`, `Task description (data):\n${data}`, context, a.full ? `Research: ${q.dir}/${q.id}-RESEARCH.md` : "", "Return JSON {marker}. Never ask the owner; never commit."].filter(Boolean).join("\n\n");
const p = await call(planPrompt, { label: "quick-plan", session: "planner:quick", agentType: "gsd-planner", role: "planner", schema: PLAN_SCHEMA });
if (!p.result && fatal(p.reason)) return { status: "failed", reason: `planner failed: ${p.reason}` };
if (ownerMarker(p)) return { status: "needs-owner", stage: "Plan", reason: `planner returned ${ownerMarker(p)}`, marker: p.result.marker, dir: q.dir };
let st = await gsd(["verify", "plan-structure", PLAN]);
if (st.code !== 0) return { status: "failed", reason: `quick plan invalid: ${(st.json?.errors ?? []).join("; ")}`, dir: q.dir };

if (a.full) {
  phase("Check");
  for (let i = 1; ; i++) {
    const c = await ask([`Check the quick plan ${PLAN} read-only.`, "Return JSON {issues: [{severity (blocker|warning|info), description}]}.", digestLine("plan", await fileSha(PLAN))].join("\n\n"), { label: `quick-check-${i}`, agentType: "gsd-plan-checker", role: "checker", readOnly: true, schema: ISSUES_SCHEMA });
    if (c.result === null) return { status: "failed", reason: `plan checker returned nothing${c.reason ? ` (${c.reason})` : ""}`, dir: q.dir };
    // Only blockers send the plan back; warnings are carried into the result (kit-feedback 13).
    const severity = (x) => String(x.severity).toLowerCase();
    const open = (c.result.issues ?? []).filter((x) => severity(x) !== "info" && severity(x) !== "warning");
    carried = (c.result.issues ?? []).filter((x) => severity(x) === "warning").map((x) => `checker: ${x.description}`);
    if (!open.length) break;
    if (i >= MAX_CHECKS) return { status: "needs-owner", stage: "Check", reason: `${open.length} checker issues after ${MAX_CHECKS} iterations`, issues: open, dir: q.dir };
    const rv = await call([`Revise ${PLAN} for these issues:`, JSON.stringify(open)].join("\n\n"), { label: `quick-revise-${i}`, session: "planner:quick", agentType: "gsd-planner", role: "planner", schema: PLAN_SCHEMA });
    if (!rv.result && fatal(rv.reason)) return { status: "failed", reason: `planner failed: ${rv.reason}`, dir: q.dir };
    if (ownerMarker(rv)) return { status: "needs-owner", stage: "Check", reason: `planner returned ${ownerMarker(rv)}`, marker: rv.result.marker, conflict: rv.result.conflict ?? null, issues: open, dir: q.dir };
    st = await gsd(["verify", "plan-structure", PLAN]);
    if (st.code !== 0) return { status: "failed", reason: "quick plan invalid after revision", dir: q.dir };
  }
}

phase("Execute");
const ex = await call([
  `<kit_executor_runtime>\nPlan: ${PLAN}\nWrite your SUMMARY to exactly: ${SUMMARY}\nEdit only the files the plan's owns lists. Rules 1-3 auto-fix inside owns (3 attempts per task); package installs are never Rule 3; Rule 4 returns status partial with the decision. Never commit, stage or stash; never write STATE, ROADMAP or REQUIREMENTS.\nReturn JSON {taskResults: [{task, status, evidence}], deviations, requests}.\n</kit_executor_runtime>`,
].join("\n\n"), { label: "quick-exec", agentType: cfg.adapter.agents?.executor ?? "gsd-executor", role: "executor", schema: EXEC_SCHEMA });
if (!ex.result && fatal(ex.reason)) return { status: "failed", reason: `executor failed: ${ex.reason}`, dir: q.dir };
const summaryOk = (await flow(["exists", SUMMARY])).json?.exists?.[SUMMARY];
const stop = (ex.result?.taskResults ?? []).find((t) => t.status === "partial" || t.status === "blocked");
if (stop) return { status: "needs-owner", stage: "Execute", reason: `task ${stop.task} ${stop.status}: ${stop.evidence ?? ""}`, dir: q.dir };
if (!summaryOk) return { status: "failed", reason: `executor wrote no ${SUMMARY}${ex.reason ? ` (${ex.reason})` : ""}`, dir: q.dir };

const VERIFY = `${q.dir}/${q.id}-VERIFICATION.md`;
if (a.full) {
  phase("Verify");
  // CR-GSF-14: done needs a fresh report whose frontmatter status is passed; dispatch alone proves nothing.
  const before = await fileSha(VERIFY);
  const fp = await flow(["quick-verification", q.dir, "fingerprint"]);
  if (fp.code !== 0) return { status: "failed", reason: `quick fingerprint unavailable: ${fp.json?.error}`, dir: q.dir };
  const v = await call([`Verify the quick task against its plan ${PLAN} and summary ${SUMMARY} (claims, not proof). Write ${VERIFY} with frontmatter status: passed | gaps_found | human_needed, gaps and human_verification lists. Use these fingerprint fields: ${JSON.stringify(fp.json)}. Do not rerun builds or tests; do not commit.`, digestLine("quick", await sha(`${await fileSha(PLAN)}|${await fileSha(SUMMARY)}`))].join("\n\n"), { label: "quick-verify", agentType: "gsd-verifier", role: "verifier" });
  if (!v.result && fatal(v.reason)) return { status: "failed", reason: `verifier failed: ${v.reason}`, dir: q.dir };
  const rep = (await flow(["read", VERIFY])).json;
  if (!rep?.exists || (await sha(rep.text)) === before) return { status: "failed", reason: `verifier wrote no new ${VERIFY}${v.reason ? ` (${v.reason})` : ""}`, dir: q.dir };
  const readback = await flow(["quick-verification", q.dir, "status"]);
  if (readback.code !== 0) return { status: "failed", reason: `${VERIFY} is ${readback.json?.status ?? "invalid"}: ${(readback.json?.problems ?? []).join("; ")}`, dir: q.dir };
  const vstatus = readback.json.status;
  if (vstatus === "gaps_found" || vstatus === "human_needed") return { status: "needs-owner", stage: "Verify", reason: `quick verification ${vstatus}`, verification: VERIFY, dir: q.dir };
  if (vstatus !== "passed") return { status: "failed", reason: `${VERIFY} has no valid status (${vstatus ?? "none"})`, dir: q.dir };
}
if (cfg.gsd.commit_policy.docs) {
  const files = [PLAN, SUMMARY, ...(a.full ? [VERIFY, `${q.dir}/${q.id}-RESEARCH.md`] : [])];
  const c = await gsd(["commit", `docs(quick-${q.id}): ${description.split(/\r?\n/)[0].slice(0, 60)}`, "--files", ...files]);
  if (c.code !== 0) log(`warning: quick commit failed: ${c.json?.error ?? c.code}`);
}
return { status: "done", id: q.id, dir: q.dir, plan: PLAN, summary: SUMMARY, warnings: carried };
