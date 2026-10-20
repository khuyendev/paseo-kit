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

const MAX_CYCLES = 3;
const FIND_SCHEMA = { type: "object", properties: { issues: { type: "array", items: { type: "object", properties: { plan: { type: "string" }, severity: { type: "string" }, actionable: { type: "boolean" }, description: { type: "string" }, evidence: { type: "string" } }, required: ["severity", "description"] } } }, required: ["issues"] };
const VERIFY_SCHEMA = { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, valid: { type: "boolean" }, evidence: { type: "string" } }, required: ["id", "valid"] } } }, required: ["verdicts"] };
const JUDGE_SCHEMA = { type: "object", properties: { decisions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, keep: { type: "boolean" }, duplicate_of: { type: "string" } }, required: ["id", "keep"] } } }, required: ["decisions"] };
const EDITOR_SCHEMA = { type: "object", properties: { marker: { type: "string" }, conflict: { type: "object" } }, required: ["marker"] };

const a = args ?? {};
const phaseDir = a.phaseDir;
if (typeof phaseDir !== "string" || !PHASE_DIR_RE.test(phaseDir)) return { status: "failed", reason: `phaseDir must match ${PHASE_DIR_RE.source}` };
const plans = Array.isArray(a.plans) ? a.plans.filter((p) => /^\d+(\.\d+)?-\d+$/.test(p)) : [];
if (!plans.length) return { status: "failed", reason: "plans must list the plan ids to review" };
const cfg = await loadCfg();
const N = phaseNumber(phaseDir);
const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
const policy = policyBlock(a.researchPath ?? null);
const roles = a.roles ?? {};
const ro = (role) => ({ role, ...(roles[role]?.model ? { model: roles[role].model } : {}), ...(roles[role]?.effort ? { effort: roles[role].effort } : {}) });
// GSDF-37: config lenses of stage plan_review plus the kit's source-grounding lens.
const lenses = [
  ...(cfg.adapter.review_lenses ?? []).filter((l) => l.stage === "plan_review").map((l) => ({ name: l.name, text: l.text })),
  { name: "source-grounding", text: "Follow the lens text in .agents/workflows/lenses/source-grounding.md." },
];
const counted = (list) => list.filter((i) => String(i.severity).toLowerCase() === "high" || i.actionable === true).length;
const digest = (await gsd(["revisions", "hash", phaseDir, "checked"])).json?.hash ?? "none";

let prev = Infinity;
let planRevision = null;
for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
  phase("Find");
  const pairs = plans.flatMap((p) => lenses.map((l) => ({ p, l })));
  const found = await parallel(pairs.map(({ p, l }) => () => call([`Review ${planPath(p)} read-only through one lens.`, `Lens ${l.name}: ${l.text}`, "Return JSON {issues: [{plan, severity (high|medium|low), actionable, description, evidence}]}.", policy, digestLine("checked", digest)].join("\n\n"), { label: `find-${p}-${l.name}`, readOnly: true, schema: FIND_SCHEMA, ...ro("plan_finder") })));
  const issues = found.flatMap((r, i) => (r?.result?.issues ?? []).map((x, k) => ({ ...x, plan: x.plan ?? pairs[i].p, id: `C${cycle}-${i + 1}-${k + 1}` })));
  phase("Judge");
  const verdicts = await parallel(plans.map((p) => async () => {
    const mine = issues.filter((x) => x.plan === p);
    if (!mine.length) return [];
    const r = await call([`Verify these plan-review issues of ${planPath(p)} against the plan and the code, read-only.`, `Issues (JSON): ${JSON.stringify(mine)}`, "Return JSON {verdicts: [{id, valid, evidence}]}."].join("\n\n"), { label: `verify-${p}`, readOnly: true, schema: VERIFY_SCHEMA, ...ro("plan_verifier") });
    return r.result?.verdicts ?? [];
  }));
  const valid = issues.filter((x) => verdicts.flat().some((v) => v.id === x.id && v.valid));
  let kept = [];
  if (valid.length) {
    const j = await call(["Judge these verified plan-review issues across all plans: keep the real ones and merge cross-plan duplicates (duplicate_of names the kept id).", `Issues (JSON): ${JSON.stringify(valid)}`, "Return JSON {decisions: [{id, keep, duplicate_of}]}."].join("\n\n"), { label: `judge-${cycle}`, readOnly: true, schema: JUDGE_SCHEMA, ...ro("plan_judge") });
    kept = valid.filter((x) => (j.result?.decisions ?? []).some((d) => d.id === x.id && d.keep && !d.duplicate_of));
  }
  const count = counted(kept);
  log(`plan review cycle ${cycle}: ${count} high or actionable issues`);
  if (count === 0) return { status: "converged", cycles: cycle, planRevision };
  if (count >= prev) return { status: "needs-owner", reason: `plan review not converging: ${count} issues, not below ${prev}`, issues: kept };
  prev = count;
  phase("Edit");
  const ed = await call([`Revise these plans in one pass so the issues below are resolved: ${plans.map(planPath).join(", ")}.`, `Issues (JSON): ${JSON.stringify(kept)}`, "Return JSON {marker: REVISION COMPLETE | REVISION_CONFLICT, conflict?}. Never ask the owner; never commit.", policy, digestLine("checked", digest)].join("\n\n"), { label: `editor-${cycle}`, agentType: "gsd-planner", schema: EDITOR_SCHEMA, ...ro("plan_editor") });
  if (String(ed.result?.marker ?? "").includes("REVISION_CONFLICT")) return { status: "needs-owner", reason: "plan editor returned REVISION_CONFLICT", conflict: ed.result.conflict ?? null, issues: kept };
  if (!ed.result) return { status: "failed", reason: `plan editor returned nothing${ed.reason ? ` (${ed.reason})` : ""}` };
  for (const p of plans) {
    const st = await gsd(["verify", "plan-structure", planPath(p)]);
    if (st.code !== 0) return { status: "failed", reason: `plan ${p} fails verify plan-structure after the edit`, errors: st.json?.errors ?? [] };
  }
  const h = await gsd(["handoff", N]);
  if (h.code !== 0) return { status: "failed", reason: "handoff refused after the plan-review edit", errors: h.json?.errors ?? [] };
  planRevision = h.json?.planRevision ?? null;
}
return { status: "needs-owner", reason: `plan review did not converge in ${MAX_CYCLES} cycles` };
