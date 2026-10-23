export const meta = {
  name: "gsd-plan-review",
  description: "Optional GSD plan review: cheap finders per plan and lens, a verifier and a judge per issue, one editor pass, structure check and handoff regeneration",
  phases: [{ title: "Find" }, { title: "Judge" }, { title: "Edit" }],
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

const FIND_SCHEMA = { type: "object", properties: { issues: { type: "array", items: { type: "object", properties: { plan: { type: "string" }, severity: { type: "string" }, actionable: { type: "boolean" }, description: { type: "string" }, evidence: { type: "string" } }, required: ["severity", "description"] } } }, required: ["issues"] };
const VERIFY_SCHEMA = { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, valid: { type: "boolean" }, evidence: { type: "string" } }, required: ["id", "valid"] } } }, required: ["verdicts"] };
const JUDGE_SCHEMA = { type: "object", properties: { decisions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, keep: { type: "boolean" }, duplicate_of: { type: "string" } }, required: ["id", "keep"] } } }, required: ["decisions"] };
const EDITOR_SCHEMA = { type: "object", properties: { marker: { type: "string" }, conflict: { type: "object" } }, required: ["marker"] };

const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const plans = Array.isArray(a.plans) ? a.plans.filter((p) => /^\d+(\.\d+)?-\d+$/.test(p)) : [];
if (!plans.length) return { status: "failed", reason: "plans must list the plan ids to review" };
const guidance = a.guidance ?? null;
if (guidance !== null && (typeof guidance !== "string" || !guidance.trim())) return { status: "failed", reason: "guidance must be non-empty text when given" };
// G017: gsd-plan passes the settings digest of its plan key, so a plan recorded here is keyed the way gsd-plan checks it.
const planSettings = typeof a.planSettings === "string" && a.planSettings ? a.planSettings : null;
const cfg = await loadCfg();
// The finder, verifier and judge have no generic agent type: they run the default tier unless the adapter maps one.
const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
const N = phaseNumber(phaseDir);
const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
// G125: a review call judges the plan files it names and the owned paths their frontmatter declares.
const planOwns = async (id) => (await gsd(["frontmatter", "get", planPath(id), "owns"])).json?.value ?? [];
const plansJudges = async (ids) => ({ files: ids.map(planPath), owns: (await Promise.all(ids.map(planOwns))).flat() });
// G039: the medium and low notes of the converged review, read by gsd-execute into the brief of their plan.
const notesPath = `${phaseDir}/plan-review-notes.json`;
// The owner's answer to an earlier needs-owner stop (gsd-plan reviewGuidance) and CONTEXT.md are locked decisions for every
// review prompt, so the finder, verifier, judge and editor all work from them.
const lockedDecisions = [`Locked user decisions: ${phaseDir}/${N}-CONTEXT.md. A plan that follows them is not an issue; never revise a plan against them.`, ...(guidance ? [`<owner_guidance>\n${guidance.trim()}\n</owner_guidance>`] : [])];
const policy = policyBlock(a.researchPath ?? null);
const roles = a.roles ?? {};
const ro = (role) => ({ role, ...(roles[role]?.model ? { model: roles[role].model } : {}), ...(roles[role]?.effort ? { effort: roles[role].effort } : {}) });
// GSDF-37: config lenses of stage plan_review plus the kit's source-grounding lens.
const lenses = [
  ...(cfg.adapter.review_lenses ?? []).filter((l) => l.stage === "plan_review").map((l) => ({ name: l.name, text: l.text })),
  { name: "source-grounding", text: "Follow the lens text in .agents/workflows/lenses/source-grounding.md." },
];
// G039: only a high issue blocks convergence; medium and low notes are carried to the execute brief instead.
const isBlocking = (i) => String(i.severity).toLowerCase() === "high";
// CR-GSF-09: every review stage needs a reply; a missing one is retried once unless fatal (GSDF-01), then the run
// fails instead of converging on silence.
async function ask(prompt, opts, what) {
  let r = await call(prompt, opts);
  if (r.result === null && !fatal(r.reason)) r = await call(prompt, opts);
  return r.result === null ? { fail: { status: "failed", reason: `${what} returned nothing${r.reason ? ` (${r.reason})` : ""}` } } : r;
}

// G036: a failed stop keeps the issues of the units that answered (gsd-plan forwards them) and names the resume command;
// the journal replays those units on --resume. The run id is the one `ph workflow` printed when the run started.
const stopWith = (stop, issues) => ({ ...stop, reason: `${stop.reason}; resume the run with ph workflow --resume <run id> to reuse the units that finished`, issues });

// G041: a reply that answers an issue zero or two times gets one repair call for those issues only, with the prior reply
// in view. Its answers for other ids are dropped; the count checks after the stage still decide what is left.
async function repair(reply, items, flag, list, prompt, opts, what) {
  const answers = reply.result[list] ?? [];
  const open = items.filter((x) => answers.filter((v) => v.id === x.id && typeof v[flag] === "boolean").length !== 1);
  if (!open.length) return reply;
  const again = await ask(prompt(open, reply.result), opts, what);
  if (again.fail) return again;
  const openIds = open.map((x) => x.id);
  return { result: { [list]: [...answers.filter((v) => !openIds.includes(v.id)), ...(again.result[list] ?? []).filter((v) => openIds.includes(v.id))] } };
}
const conflicted = (reply) => String(reply.result?.marker ?? "").includes("REVISION_CONFLICT");
// G041: each plan's verify plan-structure result: its errors when it fails, and its warnings either way.
async function checkPlans() {
  const out = [];
  for (const p of plans) {
    const st = await gsd(["verify", "plan-structure", planPath(p)]);
    out.push({ plan: p, ok: st.code === 0, errors: st.code === 0 ? [] : st.json?.errors ?? [st.json?.error ?? `exit ${st.code}`], warnings: st.json?.warnings ?? [] });
  }
  return out;
}

let prev = Infinity;
let planRevision = null;
let structure = [];
// The high and medium/low counts of every cycle (kit-feedback 46), returned with the converged and needs-owner results.
const counts = [];
// The notes of an earlier converged review never outlive this run.
await flow(["remove", notesPath]);
// A plan whose last pass kept no issue is not re-found until its file changes; an edit by the editor re-opens it.
const clean = new Set();
// G039: the cycle count follows the trend. A cycle that continues has fewer high issues than the one before (the stall
// check below), and a count cannot fall forever, so the loop ends without a fixed cycle cap.
for (let cycle = 1; ; cycle++) {
  // Recomputed every cycle: the editor changes the plans being judged (CR-GSF-19).
  const digest = (await gsd(["revisions", "hash", phaseDir, "checked"])).json?.hash ?? "none";
  const judges = await plansJudges(plans);
  phase("Find");
  const reviewed = plans.filter((p) => !clean.has(p));
  if (reviewed.length < plans.length) log(`plan review cycle ${cycle}: clean, not re-found: ${plans.filter((p) => clean.has(p)).join(", ")}`);
  const pairs = reviewed.flatMap((p) => lenses.map((l) => ({ p, l })));
  const found = await parallel(pairs.map(({ p, l }) => () => ask([`Review ${planPath(p)} read-only through one lens.`, `Lens ${l.name}: ${l.text}`, "Return JSON {issues: [{plan, severity (high|medium|low), actionable, description, evidence}]}.", ...lockedDecisions, policy, digestLine("checked", digest)].join("\n\n"), { label: `find-${p}-${l.name}`, agentType: agentFor("plan_finder"), readOnly: true, schema: FIND_SCHEMA, judges, ...ro("plan_finder") }, `plan finder ${p} (${l.name})`)));
  // The finder reviewed one plan; its issues belong to that plan's verifier whatever plan id the finder wrote.
  const issues = found.flatMap((r, i) => (r?.result?.issues ?? []).map((x, k) => ({ ...x, plan: pairs[i].p, id: `C${cycle}-${i + 1}-${k + 1}` })));
  const badFind = found.findIndex((r) => !r || r.fail);
  if (badFind !== -1) return stopWith(found[badFind]?.fail ?? { status: "failed", reason: `plan finder ${pairs[badFind].p} (${pairs[badFind].l.name}) failed to run` }, issues);
  phase("Judge");
  const verdicts = await parallel(plans.map((p) => async () => {
    const mine = issues.filter((x) => x.plan === p);
    if (!mine.length) return { result: { verdicts: [] } };
    const first = await ask([`Verify these plan-review issues of ${planPath(p)} against the plan and the code, read-only.`, `Issues (JSON): ${JSON.stringify(mine)}`, "Return JSON {verdicts: [{id, valid, evidence}]}.", ...lockedDecisions, policy, digestLine("checked", digest)].join("\n\n"), { label: `verify-${p}`, agentType: agentFor("plan_verifier"), readOnly: true, schema: VERIFY_SCHEMA, judges, ...ro("plan_verifier") }, `plan verifier ${p}`);
    if (first.fail) return first;
    return repair(first, mine, "valid", "verdicts", (open, prior) => [`Your last reply did not give each plan-review issue of ${planPath(p)} exactly one boolean verdict. Verify only the issues below against the plan and the code, read-only.`, `Issues still needing a verdict (JSON): ${JSON.stringify(open)}`, `Prior reply (JSON): ${JSON.stringify(prior)}`, "Return JSON {verdicts: [{id, valid, evidence}]} with one entry per issue above.", ...lockedDecisions, policy, digestLine("checked", digest)].join("\n\n"), { label: `verify-${p}-repair`, agentType: agentFor("plan_verifier"), readOnly: true, schema: VERIFY_SCHEMA, judges, ...ro("plan_verifier") }, `plan verifier ${p} repair`);
  }));
  const badVerify = verdicts.findIndex((r) => !r || r.fail);
  if (badVerify !== -1) {
    const answered = plans.filter((_p, i) => verdicts[i]?.result);
    return stopWith(verdicts[badVerify]?.fail ?? { status: "failed", reason: `plan verifier ${plans[badVerify]} failed to run` }, issues.filter((x) => answered.includes(x.plan)));
  }
  const allVerdicts = verdicts.flatMap((r) => r.result.verdicts ?? []);
  if (issues.some((x) => allVerdicts.filter((v) => v.id === x.id && typeof v.valid === "boolean").length !== 1)) return { status: "failed", reason: "plan verifier did not answer every issue exactly once", issues };
  // Only an explicit invalid verdict drops an issue.
  const valid = issues.filter((x) => allVerdicts.find((v) => v.id === x.id)?.valid !== false);
  let kept = [];
  if (valid.length) {
    const j = await ask(["Judge these verified plan-review issues across all plans: keep the real ones and merge cross-plan duplicates (duplicate_of names the kept id).", `Issues (JSON): ${JSON.stringify(valid)}`, "Return JSON {decisions: [{id, keep, duplicate_of}]}.", ...lockedDecisions, policy, digestLine("checked", digest)].join("\n\n"), { label: `judge-${cycle}`, agentType: agentFor("plan_judge"), readOnly: true, schema: JUDGE_SCHEMA, judges, ...ro("plan_judge") }, "plan judge");
    if (j.fail) return j.fail;
    const judged = await repair(j, valid, "keep", "decisions", (open, prior) => ["Your last reply did not give each verified plan-review issue exactly one boolean keep decision. Decide only the issues below: keep the real ones and merge cross-plan duplicates (duplicate_of names the kept id).", `Issues still needing a decision (JSON): ${JSON.stringify(open)}`, `Prior reply (JSON): ${JSON.stringify(prior)}`, "Return JSON {decisions: [{id, keep, duplicate_of}]} with one entry per issue above.", ...lockedDecisions, policy, digestLine("checked", digest)].join("\n\n"), { label: `judge-${cycle}-repair`, agentType: agentFor("plan_judge"), readOnly: true, schema: JUDGE_SCHEMA, judges, ...ro("plan_judge") }, "plan judge repair");
    if (judged.fail) return judged.fail;
    const decisions = judged.result.decisions ?? [];
    if (valid.some((x) => decisions.filter((d) => d.id === x.id && typeof d.keep === "boolean").length !== 1)) return { status: "failed", reason: "plan judge did not answer every issue exactly once", issues: valid };
    if (decisions.some((d) => d.duplicate_of && !decisions.some((other) => other.id === d.duplicate_of && other.keep && !other.duplicate_of))) return { status: "failed", reason: "plan judge merged an issue without a kept representative", issues: valid };
    kept = valid.filter((x) => { const d = decisions.find((y) => y.id === x.id); return d.keep && !d.duplicate_of; });
  }
  // Every plan, reviewed or not: a plan that kept no issue this pass is left out of later finder passes.
  for (const p of plans) if (kept.some((x) => x.plan === p)) clean.delete(p); else clean.add(p);
  const blocking = kept.filter(isBlocking);
  const count = blocking.length;
  log(`plan review cycle ${cycle}: ${count} high issues, ${kept.length - count} medium or low`);
  counts.push({ cycle, high: count, mediumOrLow: kept.length - count });
  if (count === 0) {
    await flow(["write", notesPath], JSON.stringify(kept.map(({ plan, severity, description }) => ({ plan, severity, description })), null, 2));
    // Kept issues that do not count are advisories too: returned here, never sent to the editor.
    return { status: "converged", cycles: cycle, planRevision, structure, issues: kept, counts };
  }
  if (count >= prev) return { status: "needs-owner", reason: `plan review not converging: ${count} high issues, not below ${prev}`, issues: kept, counts };
  prev = count;
  phase("Edit");
  const before = new Map(await Promise.all(plans.map(async (p) => [p, await fileSha(planPath(p))])));
  const ed = await ask([`Revise these plans in one pass so the issues below are resolved: ${plans.map(planPath).join(", ")}.`, `Issues (JSON): ${JSON.stringify(blocking)}`, "Return JSON {marker: REVISION COMPLETE | REVISION_CONFLICT, conflict?}. Never ask the owner; never commit.", "Before you reply, run verify plan-structure on each plan you revise and fix what it reports.", ...lockedDecisions, policy, digestLine("checked", digest)].join("\n\n"), { label: `editor-${cycle}`, agentType: agentFor("plan_editor", "gsd-planner"), schema: EDITOR_SCHEMA, judges, ...ro("plan_editor") }, "plan editor");
  if (ed.fail) return ed.fail;
  if (conflicted(ed)) return { status: "needs-owner", reason: "plan editor returned REVISION_CONFLICT", conflict: ed.result.conflict ?? null, issues: kept, counts };
  // G041: plans that fail verify plan-structure after the edit get one editor repair, as gsd-plan's structureFix gives a planner.
  let checks = await checkPlans();
  if (checks.some((c) => !c.ok)) {
    const failing = checks.filter((c) => !c.ok);
    const fix = await ask([`Fix these plans in place: ${failing.map((c) => planPath(c.plan)).join(", ")}. verify plan-structure reported exactly these errors:`, ...failing.flatMap((c) => c.errors.map((e) => `- ${c.plan}: ${typeof e === "string" ? e : JSON.stringify(e)}`)), "Return JSON {marker: REVISION COMPLETE | REVISION_CONFLICT, conflict?}. Never ask the owner; never commit.", ...lockedDecisions, policy, digestLine("checked", digest)].join("\n\n"), { label: `editor-${cycle}-fix`, agentType: agentFor("plan_editor", "gsd-planner"), schema: EDITOR_SCHEMA, judges, ...ro("plan_editor") }, "plan editor repair");
    if (fix.fail) return fix.fail;
    if (conflicted(fix)) return { status: "needs-owner", reason: "plan editor returned REVISION_CONFLICT", conflict: fix.result.conflict ?? null, issues: kept, counts };
    checks = await checkPlans();
  }
  const edited = [];
  for (const p of plans) if ((await fileSha(planPath(p))) !== before.get(p)) edited.push(p);
  for (const p of edited) clean.delete(p);
  // Each edited plan that passes the structure check is recorded, as the checker's revision loop records its revisions (G015),
  // so the next gsd-plan run keeps it instead of planning it again (kit-feedback 47); a plan that fails does not drop its siblings.
  for (const c of checks) if (c.ok && edited.includes(c.plan)) await gsd(["revisions", "record", phaseDir, `plan:${c.plan}`, ...(planSettings ? ["--settings", planSettings] : [])]);
  const broken = checks.find((c) => !c.ok);
  if (broken) return { status: "failed", reason: `plan ${broken.plan} fails verify plan-structure after the edit`, errors: broken.errors };
  // The warnings of this check are the plans' warnings now; gsd-plan replaces the earlier ones with them (G019).
  structure = checks.map((c) => ({ plan: c.plan, warnings: c.warnings }));
  const h = await gsd(["handoff", N]);
  if (h.code !== 0) return { status: "failed", reason: "handoff refused after the plan-review edit", errors: h.json?.errors ?? [] };
  planRevision = h.json?.planRevision ?? null;
}
