export const meta = {
  name: "gsd-execute",
  description: "GSD phase execution: safe-resume gate, executors per handoff wave, green gate with bounded fix rounds, bounded code review, orchestrator commits",
  phases: [{ title: "Preconditions" }, { title: "Baseline" }, { title: "Wave" }, { title: "Smoke build" }, { title: "Gate" }, { title: "Review" }, { title: "Commit" }, { title: "Batch" }],
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
    taskResults: { type: "array", items: { type: "object", properties: { task: { type: "string" }, status: { type: "string", enum: ["implemented", "partial", "blocked", "skipped"] }, evidence: { type: "string" }, blockedBy: { type: "array", items: { type: "string" } } }, required: ["task", "status"] } },
    deviations: { type: "array" },
    kitNotes: { type: "array", items: { type: "string" } },
    resolvedRequests: { type: "array", items: { type: "string" } },
    requests: { type: "array", items: { type: "object", properties: { path: { type: "string" }, change: { type: "string" }, reason: { type: "string" }, via: { type: "string" }, outputs: { type: "array", items: { type: "string" } } }, required: ["path", "change"] } },
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
// Kit feedback 86: a request for a generated file names its generator; the agents are told which files are generated.
const regenerated = cfg.adapter.ownership?.regenerated ?? [];
const GENERATED_NOTE = regenerated.length ? `A file matching ${JSON.stringify(regenerated)} is generated: a change to it is made through its generator, so its request also names via (the generator command) and outputs (every file the generator rewrites, that file included); a request for it without them is refused.` : "";
const waveResults = [];
// Shared changes (requests no open plan owns, the plans' <shared_changes> of each execution wave) and cross-plan
// requests live in execute-progress.json, so a stopped run hands them to the next one (G074, G089). Both are views of the
// state the last state-* verb answered with (adopt).
let sharedChanges = [];
let pendingRequests = {};
const skipped = [];
const events = [];
const worktrees = {};
// Kit feedback 79: tasks accepted as done because a request the run routed is pending, and what executors observed about the kit.
const pendingTasks = [];
const kitNotes = [];
// Kit feedback 75: executor worktrees are removed after their plan's commit (discardLanded) and when a cleared halt is dispatched
// again; the result lists what went and what stays.
const discarded = [];
const keptTrees = {};
const seeds = {};
// Kit feedback 85, 83: requests closed without a resolvedRequests reply (basis: tree, shared change, resolver, owner) and the
// owner's answers (ph gsd shared clear, request clear) this run took; both are listed in the result.
const requestsClosed = [];
const ownerAnswers = [];
const ev = (e) => { events.push(e); log(`event ${e}`); };
// Kit feedback 68: plans, artifacts and owned files changed outside the flow since their last record, from `ph gsd hand-edit scan`.
let handEdits = null;
// Kit feedback 77, 80: paths of the main tree that no plan owns and that the run reports without stopping or committing them: outside
// adapter.ownership.source_roots (gsd.unowned_outside_roots), or tracked files whose only change is line endings.
const reported = { outsideRoots: new Set(), eolOnly: new Set() };
const treeReport = () => {
  const left = Object.entries(worktrees).filter(([plan]) => !discarded.includes(plan)).map(([plan, path]) => ({ plan, path, ...(keptTrees[plan] ? { why: keptTrees[plan] } : {}) }));
  return discarded.length || left.length ? { discarded, kept: left } : null;
};
const result = (status, extra = {}) => ({ status, phaseDir, mode: execMode, isolation: g.isolation, waves: waveResults, sharedChanges, ...(Object.keys(pendingRequests).length ? { requests: pendingRequests } : {}), ...(skipped.length ? { skipped } : {}), ...(treeReport() ? { worktrees: treeReport() } : {}), ...(handEdits ? { handEdits } : {}), ...(reported.outsideRoots.size ? { outsideRoots: [...reported.outsideRoots] } : {}), ...(reported.eolOnly.size ? { eolOnly: [...reported.eolOnly] } : {}), ...(pendingTasks.length ? { pendingRequestTasks: pendingTasks } : {}), ...(kitNotes.length ? { kitNotes } : {}), ...(ownerAnswers.length ? { ownerAnswers } : {}), ...(requestsClosed.length ? { requestsClosed } : {}), events, ...extra });
const owner = (stage, reason, extra = {}) => result("needs-owner", { stage, reason, ...extra });
// Kit feedback 83 F3, 87 (B3): every needs-owner stop names what answers it, `answer: {verb, command}`, and a rerun with the same
// args follows the answer. halt.clear, shared.clear, request.clear and grant record the owner's answer (owner-answers.json, grants);
// fix-and-rerun is a stop the rerun decides again from the tree; rerun is a call that could not run (quota, transport) or a record
// the rerun repairs; workflow names the workflow that answers it.
const ANSWER = {
  halt: (plan = "<id>") => ({ verb: "halt.clear", command: `ph gsd halt clear ${N} --plan ${plan} --reason <answer>` }),
  shared: (wave = "<wave>") => ({ verb: "shared.clear", command: `ph gsd shared clear ${N} ${wave} [--path <file>] --reason <what you did or accept>` }),
  request: (plan = "<id>", file = "<file>") => ({ verb: "request.clear", command: `ph gsd request clear ${N} --plan ${plan} --path ${file} --reason <why it is satisfied>` }),
  grant: (file, plan) => ({ verb: "grant", command: `ph gsd grant ${N} --path ${file}${plan ? ` --plan ${plan}` : ""}` }),
  tree: (what) => ({ verb: "fix-and-rerun", command: what }),
  rerun: (what = "rerun with the same args") => ({ verb: "rerun", command: what }),
  workflow: (what) => ({ verb: "workflow", command: what }),
};
const GATE_RED = ANSWER.tree("fix the failing files by hand (or give a fixer a file with ph gsd grant), then rerun with the same args");
const digestOf = async (input) => (await flow(["digest"], input)).json?.hash ?? "none";

// Kit feedback 64 (gsd.review_metrics, measurement only): executors and fixers may name the plan defects they met, the finding
// verifier tags each confirmed finding plan-catchable, and every executor halt, red gate and fixer call (per wave, or per plan
// and commit batch in the graph schedule) is recorded with its cause in prereview/execute-<runId>.json for `ph review-stats
// --stage`. No decision of this script reads any of it.
const metricsOn = g.review_metrics;
const PLAN_DEFECT_KINDS = ["wrong-api", "owns-reach", "missing-dependency", "other"];
const PLAN_DEFECTS_SCHEMA = { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: PLAN_DEFECT_KINDS }, evidence: { type: "string" } }, required: ["kind"] } };
const withDefects = (schema) => (metricsOn ? { ...schema, properties: { ...schema.properties, plan_defects: PLAN_DEFECTS_SCHEMA } } : schema);
// Kit feedback 79 (gsd.pending_request_tasks): a task done on the executor's side that passes only once a routed request is made.
const pendingOn = g.pending_request_tasks !== false;
const execBase = pendingOn ? { ...EXEC_SCHEMA, properties: { ...EXEC_SCHEMA.properties, taskResults: { ...EXEC_SCHEMA.properties.taskResults, items: { ...EXEC_SCHEMA.properties.taskResults.items, properties: { ...EXEC_SCHEMA.properties.taskResults.items.properties, status: { type: "string", enum: ["implemented", "pending-request", "partial", "blocked", "skipped"] } } } } } } : EXEC_SCHEMA;
const execSchema = withDefects(execBase);
const fixerSchema = withDefects(FIXER_SCHEMA);
const verdictItems = VERDICT_SCHEMA.properties.verdicts.items;
const verdictSchema = metricsOn ? { ...VERDICT_SCHEMA, properties: { verdicts: { ...VERDICT_SCHEMA.properties.verdicts, items: { ...verdictItems, properties: { ...verdictItems.properties, plan_catchable: { type: "string", enum: ["yes", "no"] }, catch_reason: { type: "string" } } } } } } : VERDICT_SCHEMA;
const DEFECT_NOTE = "Measurement only (it changes nothing in how your reply is judged): when the plan itself was wrong (it named an API, file or symbol that does not exist or behaves otherwise, its owns did not reach a file the work needed, or it missed a dependency), list each such plan defect in plan_defects [{kind: wrong-api|owns-reach|missing-dependency|other, evidence}]; an empty list otherwise.";
const CATCH_NOTE = "Measurement only (it changes nothing in how your verdict is used): for each finding you answer confirmed, also give plan_catchable yes when a review of the plan, before any code was written, could have caught it (the plan named a wrong API, file or behaviour, or missed a requirement, an owned path, a dependency or the edge case the defect hits), no when only the code shows it, with catch_reason in one sentence.";
const defectEvents = [];
let defectWrites = Promise.resolve();
// The plan defects a reply names, plus one owns-reach defect per request for a file outside the agent's owns.
const defectsOf = (res) => [
  ...(Array.isArray(res?.plan_defects) ? res.plan_defects : []).filter((d) => PLAN_DEFECT_KINDS.includes(d?.kind)).map((d) => ({ kind: d.kind, evidence: String(d.evidence ?? "").slice(0, 300) })),
  ...(Array.isArray(res?.requests) ? res.requests : []).filter((rq) => typeof rq?.path === "string" && rq.path.trim() && !isKitDoc(rq.path)).map((rq) => ({ kind: "owns-reach", evidence: `request for ${rq.path.trim().replace(/\\/g, "/")}` })),
];
// A resumed run keeps the first run's id and skips what it already committed, so it starts from that run's record: the events
// of skipped work stay, and a replayed event replaces its earlier copy. An event is known by its kind, wave, round, plan, fixer,
// label and reason, plus `occ`, its count among this run's events of that identity (a commit batch can run its fix rounds twice).
const eventBase = (e) => JSON.stringify([e.kind, e.wave ?? null, e.round ?? null, e.plan ?? null, e.label ?? null, e.fixer ?? null, e.reason ?? null]);
const eventOcc = new Map();
if (metricsOn) {
  const prior = await flow(["read", `${phaseDir}/prereview/execute-${runId}.json`]);
  try { if (prior.json?.exists) defectEvents.push(...(JSON.parse(prior.json.text).events ?? [])); } catch { log("warning: the plan-defect record of this run is unreadable; it is written again"); }
}
// Writes are chained, so the last write holds every event even when parallel plans halt at once. A measurement never changes
// the run: any error here is a logged warning.
async function defectEvent(kind, extra, defects) {
  if (!metricsOn) return;
  const event = { kind, ...extra, cause: defects.length ? "plan" : "other", defects };
  const base = eventBase(event);
  event.occ = (eventOcc.get(base) ?? 0) + 1;
  eventOcc.set(base, event.occ);
  const at = defectEvents.findIndex((x) => eventBase(x) === base && (x.occ ?? 1) === event.occ);
  if (at >= 0) defectEvents[at] = event;
  else defectEvents.push(event);
  defectWrites = defectWrites.then(async () => {
    const w = await flow(["prereview-record", phaseDir], { stage: "execute", runId, events: defectEvents });
    if (w.code !== 0) log(`warning: plan-defect record not written: ${(w.json?.errors ?? [w.json?.error ?? `exit ${w.code}`]).join("; ")}`);
  }).catch((e) => log(`warning: plan-defect record not written: ${e?.message ?? e}`));
  await defectWrites;
}
// kit-feedback 66: gsd.execute_schedule graph starts each plan when the plans it waits for are committed (per-wave only).
const schedule = g.execute_schedule ?? "waves";
if (schedule === "graph" && execMode !== "per-wave") return result("refused", { reason: `gsd.execute_schedule graph needs gsd.execution_mode per-wave (it is ${execMode})` });

// Calls run one at a time, in order; a failed call does not stop the next.
const serialize = () => {
  let last = Promise.resolve();
  return (fn) => {
    const run = last.then(() => fn());
    last = run.catch(() => {});
    return run;
  };
};
// At most n calls at once; the others wait in order.
function slots(n) {
  let free = n;
  const waiting = [];
  return async (fn) => {
    if (free > 0) free--;
    else await new Promise((go) => waiting.push(go));
    try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else free++; }
  };
}
// kit-feedback 66: the main tree has writers (shared-tree executors, transfers, main-tree fixers), which share it, and
// exclusive users (gates, stray and resume checks, smoke builds, a commit with its suite), which run alone. A waiting
// request is served before later ones, so neither kind starves. In the waves schedule nothing contends, so nothing waits.
const tree = { kind: null, n: 0, queue: [] };
function pumpTree() {
  while (tree.queue.length && (tree.n === 0 || (tree.kind === "write" && tree.queue[0].kind === "write"))) {
    const next = tree.queue.shift();
    tree.kind = next.kind;
    tree.n++;
    next.go();
  }
}
async function onTree(kind, fn) {
  if (tree.queue.length || (tree.n && !(tree.kind === "write" && kind === "write"))) await new Promise((go) => tree.queue.push({ kind, go }));
  else { tree.kind = kind; tree.n++; }
  try { return await fn(); } finally {
    if (--tree.n === 0) tree.kind = null;
    pumpTree();
  }
}
const writeTree = (fn) => onTree("write", fn);
const aloneOnTree = (fn) => onTree("alone", fn);

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
// Kit feedback 68 (gsd.review_metrics, measurement only): the hand edits since the last record are listed in the log and the result.
const handScan = g.review_metrics ? await gsd(["hand-edit", "scan", phaseDir]) : null;
if (handScan?.code === 0 && (handScan.json?.pending?.length || handScan.json?.candidates?.length)) {
  const { pending = [], candidates = [], ask } = handScan.json;
  handEdits = { pending, candidates, ...(ask ? { ask } : {}) };
  for (const e of pending) log(`hand edit ${e.id} (${e.key}): ${e.files.join(", ")}`);
  if (ask) log(`warning: ${pending.length} hand edits since the last record; ${ask}`);
  for (const c of candidates) log(`warning: ${c}`);
}
const anti = await flow(["anti-patterns", phaseDir]);
if (anti.code !== 0) return owner("Execute", `blocking anti-patterns need three written answers each in ${anti.json?.answersFile}: ${(anti.json?.unanswered ?? []).join(", ")}; run gsd-discuss ${N} to write them (it reads CONTEXT), or write them with node ${FLOW} write ${anti.json?.answersFile} (JSON on stdin)`, { answer: ANSWER.workflow(`gsd-discuss ${N} writes the answers in ${anti.json?.answersFile}`), rows: anti.json?.unanswered ?? [] });
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
// Kit feedback 83 F1, 87: the record is typed and has one writer, the state-* flow verbs (lib/flow-state.mjs), each checking its
// completion contract. The run decides from the state the last verb answered with, never from a list of its own; a record of an
// older kit is migrated when read. Kit feedback 78: the integration files of a stopped run (shared changes, integration fixers,
// grants) are part of it, so the commit check does not see the files an earlier run applied as changes outside every plan's owns.
let progress = { plans: {} };
const adopt = (st) => {
  if (!st || (Number.isInteger(progress.rev) && st.rev < progress.rev)) return;
  progress = st;
  pendingRequests = st.requests;
  sharedChanges = st.shared;
};
const stateRead = await flow(["state-read", phaseDir]);
if (stateRead.code !== 0 || !stateRead.json?.state) return result("failed", { reason: `${PROGRESS} is unreadable: ${stateRead.json?.error ?? `exit ${stateRead.code}`}` });
adopt(stateRead.json.state);
if (stateRead.json.migrated) log(`${PROGRESS} was written by an older kit; it is migrated on the next write`);
// One state verb. A refusal (the contract does not hold) is returned as {refused}; a verb that could not write is kept in
// stateError and stops the run at the next check (unsaved), as a failed write did before.
let stateError = null;
async function state(verb, input) {
  const r = await flow([`state-${verb}`, phaseDir], input);
  if (r.json?.state) adopt(r.json.state);
  if (r.json?.status === "ok") return r.json;
  if (r.json?.status === "refused") {
    log(`state-${verb} refused: ${r.json.reason}`);
    return { refused: r.json.reason, generated: r.json.generated === true };
  }
  stateError ??= `state-${verb}: ${r.json?.error ?? `exit ${r.code}`}`;
  return { failed: stateError };
}
const unsaved = (when) => (stateError ? result("failed", { reason: `${PROGRESS} could not be written ${when}: ${stateError}` }) : null);
const tracked = (id) => progress.plans[id]?.tracked === true;
const committedOnly = (id) => progress.plans[id]?.commit !== undefined && !tracked(id);
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
// kit-feedback 66: plans this run has dispatched and not committed yet (graph schedule); their changes are the run's own.
const inFlight = new Set();
const gatePlans = () => allTasks.map((t) => ({ id: t.plan, owns: t.owns ?? [], summary: t.summary, complete: Boolean(planInfo(t.plan).has_summary) || inFlight.has(t.plan) }));
const base = await flow(["baseline", phaseDir]);
if (base.code !== 0) return result("failed", { reason: `execute baseline could not be recorded: ${base.json?.error ?? base.code}` });
const resumeGate = () => aloneOnTree(resumeGateNow);
async function resumeGateNow() {
  idx = await index();
  const rg = await flow(["resume-gate", phaseDir], { plans: gatePlans() });
  if (rg.json?.status === "error") return result("failed", { reason: `safe-resume gate could not look: ${rg.json.error}` });
  if (rg.code !== 0) return owner("Execute", `safe-resume gate: ${rg.json.problems.map((p) => `${p.kind}${p.path ? ` ${p.path}` : ""}${p.plan ? ` (plan ${p.plan})` : ""}${p.detail ? ` ${p.detail}` : ""}`).join("; ")}`, { answer: ANSWER.tree("close out, re-execute or set aside what the gate names, then rerun with the same args"), recovery: { problems: rg.json.problems, head: rg.json.head }, options: ["close out manually", "re-execute from scratch", "mark and skip"] });
  for (const a of rg.json?.accepted ?? []) log(`resume gate: commit ${a.sha.slice(0, 7)} touches no plan-owned file (${a.files.slice(0, 5).join(", ")}); accepted`);
  // G054: a commit of this run whose commits.json record failed is reconciled; its plans are tracked, not re-run.
  for (const c of rg.json?.reconciled ?? []) {
    log(`resume gate: commit ${c.sha.slice(0, 7)} of plans ${c.plans.join(",")} was not in commits.json; reconciled`);
    for (const id of c.plans) if (progress.plans[id]?.commit === undefined) {
      const rec = await state("plan", { plan: id, stage: "committed", commit: c.sha, verify: execMode === "batch" ? "skipped" : "green", evidence: null });
      if (rec.refused) return result("failed", { reason: `the reconciled commit ${c.sha.slice(0, 7)} of ${id} was not recorded: ${rec.refused}` });
    }
  }
  const lostReconciled = unsaved("after reconciling commits");
  if (lostReconciled) return lostReconciled;
  // CR-GSF-01: only plans that still lack a SUMMARY now, not the list captured at start.
  for (const t of wanted.filter((x) => !tracked(x.plan) && !planInfo(x.plan).has_summary)) {
    const sc = await gsd(["check", "evaluation-scope", "--plan", t.plan, "--commits-only"]);
    if (!["resolved", "degraded"].includes(sc.json?.status)) return result("failed", { reason: `evaluation scope of ${t.plan} is ${sc.json?.status ?? `exit ${sc.code}`}: no executor started (fail-closed)` });
    if ((sc.json.commits ?? []).length) return owner("Execute", `plan ${t.plan} has commits (${sc.json.commits.slice(0, 3).map((c) => c.sha ?? c).join(", ")}) but no SUMMARY`, { answer: ANSWER.tree("close out the plan by hand or revert its commits, then rerun with the same args"), options: ["close out manually", "re-execute from scratch", "mark and skip"] });
  }
  return null;
}
const answersStop = await takeOwnerAnswers();
if (answersStop) return answersStop;
const stop0 = await resumeGate();
if (stop0) return stop0;

// ---- gap wave cap (GSDF-30, D-73): marked before the first executor; the run that started it may resume it ----
if (a.gapsOnly) {
  const at = await gsd(["attempt", "show", phaseDir, "--kind", "gap"]);
  if (at.code !== 0) return result("refused", { reason: "no gap attempt record; plan the gaps first" });
  const prior = at.json.result ?? {};
  if (prior.waveExecuted && prior.waveRunId !== runId) return owner("Gaps", "the gap wave of this phase already executed; gap closure is capped at one wave", { answer: ANSWER.workflow("gsd-verify again, or plan the leftovers as a new phase"), options: ["verify again", "plan the leftovers as a new phase"] });
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
  GENERATED_NOTE ? `- ${GENERATED_NOTE}` : null,
  pendingOn ? "- A task that is done on your side but whose test or check passes only once a request you returned is made (you may not run the tests): status pending-request with blockedBy [the request paths], not partial. partial is only for a decision the owner must make." : null,
  "- Observations about the kit, its tools or its wrappers (not about the project) go in kitNotes [string]; never in a request: a request for a kit-feedback document is refused.",
  "- Before you return, delete every file you created outside owns (your SUMMARY excepted): scratch files are cleanup, not a Rule-4 decision.",
  "- Never commit, stage or stash; never write STATE, ROADMAP or REQUIREMENTS.",
  "- The orchestrator's gate runs the build and the tests after the wave: do not run them yourself.",
  `Return JSON {taskResults: [{task, status: implemented|${pendingOn ? "pending-request|" : ""}partial|blocked|skipped, evidence${pendingOn ? ", blockedBy" : ""}}], deviations: [{rule, kind, note}], requests: [{path, change, reason}], kitNotes: [string]}.`,
  metricsOn ? DEFECT_NOTE : null,
  "</kit_executor_runtime>",
].filter(Boolean).join("\n");
// Every call of one executor session carries the same fixed options, worktree isolation included (CR-GSF-04).
function execOpts(t, label) {
  const o = { label, session: `executor:${t.plan}`, agentType: agentFor("executor", "gsd-executor"), role: "executor", schema: execSchema };
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
// `defects`: the plan defects behind the halt (kit feedback 64), recorded as a halt event.
async function halt(id, why, defects = [], extra = {}) {
  // The halted plan's worktree stays until the halt is cleared and the plan is dispatched again (kit feedback 75). `finished`
  // (kit feedback 79): the tree holds a complete executor result, so `ph gsd halt clear --resume` may transfer it.
  await flow(["write", haltPath(id)], JSON.stringify({ plan: id, reason: why, runId, ...(worktrees[id] ? { worktree: worktrees[id] } : {}), ...extra }, null, 2));
  await state("plan", { plan: id, stage: "halted", reason: String(why) });
  await defectEvent("halt", { plan: id, reason: String(why).slice(0, 300) }, defects);
  return { plan: id, halted: true, reason: why, ...(pendingRequests[id]?.length ? { requests: pendingRequests[id] } : {}) };
}
async function headNow(cwd) { return (await shell(["git", "rev-parse", "HEAD"], cwd ? { cwd } : {})).stdout.trim(); }
// The orchestrator's own commits of this run: in the graph schedule a commit of one plan lands while another plan's
// executor runs, and a worktree may start from it (kit-feedback 66).
const ownCommits = new Set();
const movedBy = (now, before) => now !== before && !ownCommits.has(now);
function slashPath(p) { return String(p).trim().replace(/\\/g, "/").replace(/^\.\//, ""); }
// Kit feedback 79: the project's kit-feedback document is the orchestrator's; a request against it is an observation about the kit.
function isKitDoc(p) { return /(^|\/)kit-feedback\.md$/i.test(String(p).trim().replace(/\\/g, "/")); }
// What an agent observed about the kit: logged, returned in the result, never a change to a project file.
function noteKit(plan, res) {
  const asked = (res?.requests ?? []).filter((rq) => rq && typeof rq.path === "string" && isKitDoc(rq.path));
  const notes = [...(Array.isArray(res?.kitNotes) ? res.kitNotes.filter((n) => typeof n === "string" && n.trim()).map((n) => ({ plan, note: n.trim() })) : []), ...asked.map((rq) => ({ plan, note: String(rq.change ?? rq.reason ?? "").trim(), from: "request", path: slashPath(rq.path) }))];
  for (const n of notes) {
    if (kitNotes.some((k) => k.plan === n.plan && k.note === n.note)) continue;
    kitNotes.push(n);
    log(`kit note ${plan}${n.from ? ` (a request for ${n.path} was refused)` : ""}: ${n.note}`);
  }
}
// G072: a request goes to the plan owning its path most specifically (adapter owns forms, path boundaries). G089: a
// path no open plan of the phase owns (no plan, or one already committed) is a shared change, applied before the next
// gate by the integration fixer and committed with the wave. Kit feedback 86: a request against a generated file
// (adapter.ownership.regenerated) names its generator (via) and every file it rewrites (outputs); without them state-request
// refuses it, and it is held as a refused shared change that only the owner clears (the shared step stops on it).
async function routeRequests(t, res) {
  noteKit(t.plan, res);
  const list = (res.requests ?? []).filter((rq) => rq && typeof rq.path === "string" && rq.path.trim() && !isKitDoc(rq.path)).map((rq) => ({ ...rq, path: slashPath(rq.path) }));
  if (!list.length) return;
  const others = allTasks.filter((x) => x.plan !== t.plan).map((x) => ({ id: x.plan, owns: x.owns ?? [], summary: x.summary }));
  const owners = (await flow(["owners"], { paths: list.map((rq) => rq.path), plans: others })).json?.owners ?? {};
  for (const rq of list) {
    const id = (owners[rq.path] ?? [])[0];
    const q = { from: t.plan, path: rq.path, change: rq.change ?? "", ...(rq.reason !== undefined ? { reason: rq.reason } : {}), ...(rq.via !== undefined ? { via: rq.via } : {}), ...(rq.outputs !== undefined ? { outputs: rq.outputs } : {}) };
    if (id && progress.plans[id]?.commit === undefined) {
      const routed = await state("request", { op: "route", plan: id, ...q, base: g.request_check !== "off" });
      if (!routed.refused) continue;
      log(`request of ${t.plan} for ${rq.path}: ${routed.refused}; held as a shared change`);
    }
    await state("shared", { op: "add", changes: [q] });
  }
}
// Kit feedback 79 (gsd.pending_request_tasks): the request paths the run holds for `plan` (queued for another plan's owner, or for
// the shared-change fixer), which are applied before the gate.
const routedBy = (plan) => new Set([...Object.values(pendingRequests).flat(), ...sharedChanges].filter((q) => q.from === plan && q.path).map((q) => slashPath(q.path)));
const PATH_TOKEN = /[\w.@-]+(?:\/[\w.@-]+)+/g;
// A task that waits only for requests the run routed: it names them in blockedBy, or (partial) its evidence names at least one of
// them and no other path. Returns the request paths, or null.
function waitsOnRouted(x, routed) {
  if (!pendingOn || !routed.size) return null;
  const named = (Array.isArray(x.blockedBy) ? x.blockedBy : []).map(slashPath).filter(Boolean);
  if (named.length) return named.every((p) => routed.has(p)) ? named : null;
  if (x.status !== "partial") return null;
  const text = slashPath(String(x.evidence ?? ""));
  const hit = [...routed].filter((p) => text.includes(p) || text.includes(p.split("/").pop()));
  if (!hit.length) return null;
  const others = (text.match(PATH_TOKEN) ?? []).filter((tok) => ![...routed].some((p) => p.endsWith(tok) || tok.endsWith(p)));
  return others.length ? null : hit;
}
// `plan`: whose routed requests excuse a partial task. The tasks accepted that way are kept in `pendingTasks`.
const ownerDecision = (res, plan = null) => {
  const dev = (res.deviations ?? []).find((x) => Number(x.rule) === 4 || x.kind === "checkpoint");
  if (dev) return dev;
  const routed = plan ? routedBy(plan) : new Set();
  for (const x of res.taskResults ?? []) {
    if (x.status !== "partial" && x.status !== "blocked" && x.status !== "pending-request") continue;
    const on = x.status === "blocked" ? null : waitsOnRouted(x, routed);
    if (on) {
      if (!pendingTasks.some((p) => p.plan === plan && p.task === x.task)) { pendingTasks.push({ plan, task: x.task, blockedBy: on, via: Array.isArray(x.blockedBy) && x.blockedBy.length ? "blockedBy" : "evidence" }); ev(`pending-request ${plan} ${x.task}`); }
      continue;
    }
    return x.status === "pending-request" ? { ...x, note: `task ${x.task} is pending-request but names no request this plan routed` } : x;
  }
  return null;
};
// The requests the owner plan names in resolvedRequests close with its reply.
async function clearResolved(id, res) {
  const named = (res?.resolvedRequests ?? []).map(slashPath);
  for (const q of [...(pendingRequests[id] ?? [])].filter((x) => named.includes(slashPath(x.path)))) await state("request", { op: "close", plan: id, from: q.from, path: q.path, change: q.change, by: "reply", why: "named in resolvedRequests" });
}
// Kit feedback 85: a request leaves pendingRequests when its owner names it in resolvedRequests (clearResolved) and also when
// the tree shows it done (the digest of its path at the request, progress.requestBase, differs and the gate after it is green),
// when a shared change to its path is applied or cleared, when the resolver finds it satisfied, or when the owner clears it
// (ph gsd request clear). state-request checks each closure and keeps it in execute-progress.json (closed); the result lists all
// but the replies.
function requestKey(plan, q) { return JSON.stringify([plan, q.from ?? null, slashPath(q.path), q.change ?? null]); }
function noteClosed(rows) {
  for (const row of rows ?? []) {
    if (row.by === "reply") continue;
    requestsClosed.push(row);
    ev(`request ${row.plan} ${row.path} closed by ${row.by}`);
  }
}
// The owner's typed answers (ph gsd shared clear, request clear) in owner-answers.json that an earlier run did not take yet. The
// answer verbs never write execute-progress.json; state-answer applies each one here and records it taken, in one write.
async function takeOwnerAnswers() {
  const r = await flow(["read", `${phaseDir}/owner-answers.json`]);
  let list = [];
  try { list = r.json?.exists ? JSON.parse(r.json.text) : []; } catch { list = []; }
  if (!Array.isArray(list)) return null;
  for (const x of list) {
    if (!x?.id || !["shared", "request"].includes(x.kind) || (progress.answered ?? []).includes(x.id)) continue;
    const took = await state("answer", { id: x.id, link: g.request_check !== "off" });
    if (!took.taken) {
      if (took.refused) log(`owner answer ${x.id} not taken: ${took.refused}`);
      continue;
    }
    noteClosed(took.closed);
    ownerAnswers.push(took.taken);
    ev(`answer ${x.id} ${x.kind}${x.path ? ` ${x.path}` : ""} (${took.taken.matched} cleared)`);
  }
  return unsaved("after the owner's answers");
}

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
// Kit feedback 75: a cleared halt (ph gsd halt clear keeps its worktree in halt-answers.json) that names a worktree of an earlier
// run is dispatched again, so the old tree is discarded unless its run still uses it. A resumed run keeps its own session tree.
async function discardHalted(id) {
  if (!worktreeMode) return;
  const a = await flow(["read", `${phaseDir}/halt-answers.json`]);
  let trees = [];
  try { trees = a.json?.exists ? JSON.parse(a.json.text).filter((x) => x.plan === id && x.haltWorktree && x.haltRunId !== runId).map((x) => x.haltWorktree) : []; } catch { trees = []; }
  for (const tree of new Set(trees)) {
    const r = await flow(["discard-worktree"], { plan: id, worktree: tree, reason: "halted" });
    log(`plan ${id}: worktree of the cleared halt ${tree}: ${r.json?.removed ? "discarded" : r.json?.gone ? "already gone" : `kept (${r.json?.why ?? r.json?.error ?? `exit ${r.code}`})`}`);
  }
}
// Kit feedback 79: `ph gsd halt clear --resume` marks the latest answer of a plan: the halted executor's finished worktree is
// transferred as it is. Returns that worktree, or null (no such answer, or the tree is gone: the plan is dispatched again).
async function resumableTree(t) {
  if (!worktreeMode) return null;
  const r = await flow(["read", `${phaseDir}/halt-answers.json`]);
  let last = null;
  try { last = r.json?.exists ? JSON.parse(r.json.text).filter((x) => x.plan === t.plan).at(-1) ?? null : null; } catch { last = null; }
  if (!last?.resume || !last.haltWorktree) return null;
  const wt = slashPath(last.haltWorktree);
  const dir = slashPath(cfg.worktree_dir);
  const summaryAt = `${wt}/${t.summary}`;
  if (!(`/${wt}`.includes(`/${dir}/`)) || wt.includes("..") || !(await flow(["exists", summaryAt])).json?.exists?.[summaryAt]) {
    log(`plan ${t.plan}: the worktree ${wt} of the cleared halt (--resume) is gone or holds no SUMMARY; the plan is dispatched again`);
    return null;
  }
  return wt;
}
async function dispatch(t, waveId) {
  const kept = await resumableTree(t);
  if (kept) {
    await flow(["remove", haltPath(t.plan)]);
    worktrees[t.plan] = kept;
    await state("plan", { plan: t.plan, stage: "executed", summary: t.summary, worktree: kept });
    ev(`resume ${waveId} ${t.plan}`);
    log(`plan ${t.plan}: halt cleared with --resume; the finished worktree ${kept} is transferred, no executor runs`);
    return { plan: t.plan, ok: true, wt: kept, resumed: true };
  }
  await discardHalted(t.plan);
  await flow(["remove", haltPath(t.plan)]);
  await state("plan", { plan: t.plan, stage: "dispatched" });
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
  const run = () => agent(prompt, { ...execOpts(t, `exec-${t.plan}`), detail: true });
  const d = await (worktreeMode ? run() : writeTree(run));
  const res = d?.result ?? null;
  const wt = d?.worktree ?? null;
  if (wt) worktrees[t.plan] = wt;
  ev(`code ${waveId} ${t.plan}`);
  // GSDF-42: workers never commit; a moved HEAD (main or the agent worktree) fails the plan.
  if (movedBy(await headNow(), before) || (wt && movedBy(await headNow(wt), before))) return { ...(await halt(t.plan, "executor committed (HEAD moved)")), failed: true };
  const summaryAt = wt ? `${wt}/${t.summary}` : t.summary;
  const hasSummary = Boolean((await flow(["exists", summaryAt])).json?.exists?.[summaryAt]);
  if (!res) {
    if (hasSummary) {
      log(`plan ${t.plan}: no normal completion but SUMMARY present; reconciled as complete`);
      await state("plan", { plan: t.plan, stage: "executed", summary: t.summary, ...(wt ? { worktree: wt } : {}) });
      return { plan: t.plan, ok: true, wt, reconciled: true };
    }
    const c = classify(d?.reason);
    return { ...(await halt(t.plan, `executor ended abnormally (${c.class}): ${d?.reason ?? "no reply"}`)), failure: c };
  }
  await routeRequests(t, res);
  await clearResolved(t.plan, res);
  const decision = ownerDecision(res, t.plan);
  if (decision) return { ...(await halt(t.plan, `owner decision needed: ${decision.note ?? decision.evidence ?? decision.status}`, defectsOf(res), { finished: hasSummary })), decision };
  // G058: one result per plan task; an empty list or a skipped task is no finished plan.
  const want = planInfo(t.plan).task_count;
  const got = (res.taskResults ?? []).length;
  if (!got || (Number.isInteger(want) && got < want)) return { ...(await halt(t.plan, `executor reported ${got} task result(s)${Number.isInteger(want) ? ` for ${want} task(s)` : ""}`, defectsOf(res))), failed: true };
  const skippedTask = res.taskResults.find((x) => x.status === "skipped");
  if (skippedTask) return { ...(await halt(t.plan, `owner decision needed: task ${skippedTask.task} was skipped${skippedTask.evidence ? ` (${skippedTask.evidence})` : ""}`, defectsOf(res), { finished: hasSummary })), decision: skippedTask };
  if (!hasSummary) return { ...(await halt(t.plan, `no SUMMARY at ${t.summary}`, defectsOf(res))), failed: true };
  await state("plan", { plan: t.plan, stage: "executed", summary: t.summary, ...(wt ? { worktree: wt } : {}) });
  return { plan: t.plan, ok: true, wt };
}
const integrate = (outcomes, tasks) => writeTree(() => integrateNow(outcomes, tasks));
async function integrateNow(outcomes, tasks) {
  for (const t of tasks) {
    const o = outcomes.find((x) => x?.plan === t.plan);
    if (!o?.ok) continue;
    if (worktreeMode && o.wt) {
      // CR-GSF-08: the deletion declaration comes from the validated handoff task (the index does not carry it).
      const tr = await flow(["transfer", phaseDir], { plan: t.plan, worktree: o.wt, owns: t.owns ?? [], summary: t.summary, files_deleted: t.files_deleted ?? [] });
      if (tr.code !== 0) { Object.assign(o, await halt(t.plan, `transfer refused: ${(tr.json?.refused ?? []).map((r) => `${r.path} (${r.reason})`).join(", ") || tr.json?.error}`, (tr.json?.refused ?? []).filter((r) => r.reason === "outside owns").map((r) => ({ kind: "owns-reach", evidence: `transfer refused: ${r.path} outside owns` }))), { ok: false }); continue; }
      await state("plan", { plan: t.plan, stage: "transferred" });
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
  if (quota) return owner(stage, `quota or rate limit: ${quota.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: quota.failure, halted: bad, options: [`rerun after the reset${quota.failure.retryAfterSeconds ? ` (about ${quota.failure.retryAfterSeconds} s)` : ""}`] });
  return owner(stage, bad.map((o) => `${o.plan}: ${o.reason}`).join("; "), { answer: ANSWER.halt(), halted: bad, options: [`answer each halt with ph gsd halt clear ${N} --plan <id> --reason <answer>, then rerun with the same args`, "stop"] });
};

// ---- green gate and bounded verify-fix rounds (GSDF-44, GSDF-49..52) ----
let testArgv = null;
if (cmds.test) {
  const joined = cmds.test.join(" ");
  const nt = (await gsd(["normalize-test-command", joined])).json?.command;
  testArgv = nt && nt !== joined && nt.startsWith(joined) ? [...cmds.test, ...nt.slice(joined.length).trim().split(/\s+/)] : cmds.test;
}
// extra (graph schedule): {suite: false} runs only the plans' obligations; obligations, a Set of plan ids, runs only those
// plans' obligations with the suite; context names other open plans, so a failure in their files is theirs.
const runGate = (waveId, tasks, extra) => aloneOnTree(() => gateNow(waveId, tasks, extra));
async function gateNow(waveId, tasks, { suite = true, obligations = null, context = [] } = {}) {
  const r = await flow(["gate", phaseDir], { waveId, plans: tasks.map((t) => ({ id: t.plan, owns: t.owns ?? [], verify: !obligations || obligations.has(t.plan) ? t.verify ?? [] : [] })), testArgv, ...(suite ? {} : { suite: false }), ...(context.length ? { context: context.map((t) => ({ id: t.plan, owns: t.owns ?? [] })) } : {}) });
  if (!r.json || r.json.status === "error") return { green: false, failureCount: 1, failures: [{ step: "gate", excerpt: r.json?.error ?? "gate failed to run" }], byPlan: {}, unplaced: [], blockedBy: {} };
  for (const n of r.json.notes ?? []) log(`gate: ${n}`);
  for (const tline of r.json.timedOut ?? []) log(`gate timeout: ${tline}`);
  ev(`gate ${waveId} ${r.json.green ? "green" : `red (${r.json.failureCount})`}`);
  return r.json;
}
// F57 (kit-feedback 57): the first wave that changes a file matching adapter.smoke_triggers builds adapter.commands.smoke_builds
// once per phase, before its gate, so a toolchain gap stops that wave instead of the end of the phase. A passed build is kept in
// execute-progress.json, so a resumed run does not build again; a failed one stops needs-owner and is built again on the rerun.
const smokeStop = (tasks, waveId, label) => (!cmds.smoke_builds?.length || progress.smoke ? null : aloneOnTree(() => smokeStopNow(tasks, waveId, label)));
async function smokeStopNow(tasks, waveId, label) {
  if (progress.smoke) return null;
  const pf = await planFiles(tasks);
  if (pf.stop) return pf.stop;
  const changed = [...Object.values(pf.files), ...Object.values(pf.removed), pf.integration].flat();
  const due = (await flow(["smoke-due"], { files: changed, globs: cfg.adapter.smoke_triggers ?? [] })).json;
  if (!due) return result("failed", { reason: "smoke trigger check could not run" });
  if (!due.due) return null;
  phase("Smoke build");
  const smoke = await gsd(["check", "smoke"]);
  if (smoke.code !== 0) return owner("Smoke build", `${label} changes ${due.matched.join(", ")}; ${smoke.json?.reason ?? `smoke build check exit ${smoke.code}`}`, { answer: ANSWER.tree("install the missing toolchain component or fix the build, then rerun with the same args"), builds: (smoke.json?.builds ?? []).filter((b) => b.status !== "passed"), options: ["install the missing toolchain component or fix the build, then rerun with the same args", "remove the target from adapter.commands.smoke_builds, then rerun with the same args", "abandon"] });
  await state("smoke", { wave: waveId, changed: due.matched });
  return unsaved("after the smoke build");
}
const failureText = (list) => list.map((f) => `- ${f.step}${f.plan ? ` (plan ${f.plan})` : ""}: ${f.outcome ?? "failed"}; full log ${f.log ?? "n/a"}\n${String(f.excerpt ?? "").split(/\r?\n/).map((l) => `    ${l}`).join("\n")}`).join("\n");
const fixerBlock = () => (g.fixer_verifies_itself
  ? `After your changes run the build (${JSON.stringify(cmds.build)}) and the tests (${JSON.stringify(testArgv)}) yourself, at most ${g.fixer.max_build_attempts} times and within ${g.fixer.minutes} minutes; stop early when two consecutive attempts do not reduce the failure count. If you edit after your last run, run the build and the tests once more on that edit before you answer, even past those limits. Judge yourself only on the failures and findings given to you: a failure in a file you do not own is not yours and does not make your status unresolved. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is verified (a build and test run followed your last edit), unverified (none did) or none (you made no edit).`
  : "Do not run the build or the tests: the orchestrator's gate verifies your changes. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is unverified (you edited) or none (you made no edit).");
// G070: an edit outside the owns is never a workaround; the fixer returns it as a request instead.
const fixerText = (owns, findings, failures) => [`<kit_fixer_runtime>\nYou own: ${JSON.stringify(owns)}. Fix the confirmed review findings and gate failures below, nothing else; a finding with instances is fixed at every instance. Never commit. A change needed in a file you do not own: do not make it (not even a rename or an import tweak to dodge a clash); return it in requests [{path, change, reason}].${GENERATED_NOTE ? ` ${GENERATED_NOTE}` : ""}\n${fixerBlock()}${metricsOn ? `\n${DEFECT_NOTE}` : ""}\n</kit_fixer_runtime>`, findings.length ? `Confirmed findings (JSON): ${JSON.stringify(findings.map(findingBrief))}` : "", failures.length ? `Gate failures:\n${failureText(failures)}` : ""].filter(Boolean).join("\n\n");
// The fixer repairs confirmed defects and failed checks in existing code, where more effort finds the edge cases its
// tests miss (owner decision 2026-10-22, after "Spending your effort"): it runs at FIXER_EFFORT on its own tier's
// model unless the project's gsd.roles.fixer sets an effort.
const FIXER_EFFORT = "high";
const fixerOpts = (label, extra = {}) => ({ label, agentType: agentFor("fixer", "gsd-code-fixer"), role: "fixer", ...(cfg.gsd.roles?.fixer?.effort ? {} : { effort: FIXER_EFFORT }), schema: fixerSchema, ...extra });
// Main-tree edits outside every plan's owns stop the run before the gate and the review are paid for, not at Commit
// (G070, kit-feedback 35).
// Kit feedback 77: committing the paths on their own is the first answer; the resume gate accepts a commit that touches no plan-owned file.
const UNOWNED_OPTIONS = ["commit them separately (git add and git commit of those paths only), then rerun with the same args", "move or revert them, then rerun with the same args", "add them to a plan's owns and replan"];
const strayStop = (tasks, stage) => aloneOnTree(() => strayStopNow(tasks, stage));
async function strayStopNow(tasks, stage) {
  const pf = await planFiles(tasks);
  if (pf.stop) return pf.stop;
  if (!pf.unowned.length) return null;
  return owner(stage, `changes outside every plan's owns: ${pf.unowned.slice(0, 10).join(", ")}`, { answer: ANSWER.tree(UNOWNED_OPTIONS[0]), paths: pf.unowned, options: UNOWNED_OPTIONS });
}
// G089, G083: shared changes (requests no open plan owns; the plans' <shared_changes> of this execution wave) are made
// by one integration fixer owning exactly their paths, before the gate; its files join the wave commit and
// commits.json, and the resume gate knows them from execute-progress.json.
const sharedTurn = serialize();
const applyShared = (waveId, label) => sharedTurn(() => applySharedNow(waveId, label));
// Kit feedback 82: the step is done when every requested change is present, whatever the fixer thinks of the rest of the tree.
// The fixer reports per change; verification belongs to the gate that follows, whose plan fixers repair what fails outside
// the shared files. An Integration stop is answered with ph gsd shared clear.
const SHARED_SCHEMA = { ...fixerSchema, properties: { ...fixerSchema.properties, changes: { type: "array", items: { type: "object", properties: { index: { type: "number" }, applied: { type: "boolean" }, evidence: { type: "string" } }, required: ["index", "applied"] } }, outside: { type: "string" } } };
const SHARED_NOTE = "Check only the shared files you changed (a syntax, format or analysis check of those files). Do not run other test files or whole suites: the gate that follows verifies the change, and a failure outside these files belongs to the plan fixers that gate runs. Name such a failure in outside, and still report your changes.";
const SHARED_REPORT = "Report per change. Return JSON {changes: [{index, applied, evidence}], status: fixed|unresolved, attempts, remaining_failures, evidence, outside}: applied is true when that change is present in its file (made by you or already there); status is unresolved only when a change could not be made.";
const sharedOptions = (waveId) => [`ph gsd shared clear ${N} ${waveId} [--path <file>] --reason "<what you did or accept>", then rerun with the same args`, "stop"];
// Kit feedback 86: a change to a generated file without its generator is held (refused); the step makes the others and then
// stops on it, answered with ph gsd shared clear once the owner ran the generator.
const generatedStop = (waveId, label, held) => owner("Integration", `shared changes of ${label} target generated files without their generator: ${held.map((s) => `${s.from ?? "declared"}: ${s.refused}`).join("; ")}`, { sharedChanges: held, answer: ANSWER.shared(waveId), options: [`run the generator, then ph gsd shared clear ${N} ${waveId} --path <file> --reason "<the generator command and the outputs it rewrote>", then rerun with the same args`, "stop"] });
async function applySharedNow(waveId, label) {
  if (!sharedChanges.some((s) => !s.applied)) return null;
  if (sharedChanges.some((s) => !s.applied && s.wave === undefined)) await state("shared", { op: "tag", wave: waveId });
  const lostTag = unsaved("before the shared changes");
  if (lostTag) return lostTag;
  const nameless = sharedChanges.filter((s) => !s.applied && !s.path);
  if (nameless.length) return owner("Integration", `shared changes of ${label} name no file, so no fixer can own them: ${nameless.map((s) => `${s.from}: ${String(s.change).slice(0, 120)}`).join("; ")}`, { sharedChanges: nameless, answer: ANSWER.shared(waveId), options: [...sharedOptions(waveId).slice(0, 1), "apply them by hand, commit them, then rerun with the same args", "name the file in the plan's <shared_changes> and regenerate the handoff"] });
  const held = sharedChanges.filter((s) => !s.applied && s.refused);
  const open = sharedChanges.filter((s) => !s.applied && !s.refused);
  if (!open.length) return generatedStop(waveId, label, held);
  // A change made through a generator owns every file the generator rewrites.
  const files = [...new Set(open.flatMap((s) => [s.path, ...(s.outputs ?? [])]))];
  await state("integration", { op: "add", files, why: `shared changes of ${waveId}` });
  const lostFiles = unsaved("before the shared changes");
  if (lostFiles) return lostFiles;
  const brief = open.map(({ from, path, change, reason, via, outputs }, index) => ({ index, from, path, change, reason, ...(via ? { via, outputs } : {}) }));
  const viaNote = open.some((s) => s.via) ? "A change with via is made by running that generator command (it rewrites every file in its outputs); never edit a generated file by hand." : "";
  const prompt = [`Shared changes for ${label}: no open plan of the phase owns these paths, so you make them. You own exactly these files: ${JSON.stringify(files)}. Make each change below and nothing else; never commit.`, `Changes (JSON): ${JSON.stringify(brief)}`, viaNote, SHARED_NOTE, SHARED_REPORT, digestLine(`shared:${waveId}`, await digestOf({ files }))].filter(Boolean).join("\n\n");
  const r = await writeTree(() => call(prompt, fixerOpts(`shared-${waveId}`, { schema: SHARED_SCHEMA })));
  if (r.result === null) return owner("Integration", `the shared-change fixer of ${label} returned nothing${r.reason ? ` (${r.reason})` : ""}`, { answer: ANSWER.shared(waveId), sharedChanges: open, options: sharedOptions(waveId), ...(fatal(r.reason) ? { failure: classify(r.reason) } : {}) });
  const rep = r.result;
  const entries = Array.isArray(rep.changes) && rep.changes.length ? rep.changes : null;
  const present = (i) => (entries ? entries.some((c) => Number(c?.index) === i && c.applied === true) : rep.status === "fixed");
  const made = open.filter((s, i) => present(i));
  if (made.length) noteClosed((await state("shared", { op: "applied", ids: made.map((s) => s.id), link: g.request_check !== "off" })).closed);
  if (rep.outside && String(rep.outside).trim()) log(`shared ${waveId}: the fixer saw a failure outside the shared files, left to the gate: ${String(rep.outside).trim().slice(0, 300)}`);
  if (made.length && rep.status !== "fixed") log(`shared ${waveId}: ${made.length} of ${open.length} change(s) reported present although the fixer answered ${rep.status}; the gate verifies them`);
  const lostMade = unsaved("after the shared changes");
  if (lostMade) return lostMade;
  const ids = open.map((s) => s.id);
  const left = sharedChanges.filter((s) => ids.includes(s.id) && !s.applied);
  if (left.length) return owner("Integration", `shared changes of ${label} not applied (${left.length} of ${open.length})${rep.evidence ? `: ${rep.evidence}` : ""}`, { sharedChanges: left, answer: ANSWER.shared(waveId), options: sharedOptions(waveId) });
  ev(`shared ${waveId} ${files.length}`);
  return held.length ? generatedStop(waveId, label, held) : null;
}
// CR-GSF-16: every fix result is inspected before the gate reruns. A quota or a call that could not run stops the round
// at once; a fixer that answers unresolved, or a fix call that returned nothing, is judged on a fresh gate (G066, G088,
// kit-feedback 28/30): the round stops red only while that fixer's own failures remain. An owner decision of a fixer
// (kit-feedback 51) waits for the transfer of every fixer's owned changes and the rerun, and stops the round only while
// its plan still fails. opts (graph schedule): gate() reruns the gate (default: the gate of these plans), done(gate) ends
// the rounds early (default: green).
async function fixRounds(waveId, tasks, first, label, tail, { gate = () => runGate(waveId, tasks), done = (x) => x.green } = {}) {
  let cur = first;
  let prev = first.failureCount;
  let noDrop = 0;
  for (let round = 1; !done(cur) && round <= g.max_verify_rounds; round++) {
    const red = (why, extra = {}) => ({ stop: owner("Gate", `${label} is red after fix round ${round}: ${why}${tail}`, { answer: GATE_RED, failures: cur.failures, evidence: cur.evidence, blockedBy: cur.blockedBy, ...extra }) });
    const placed = (cur.unplaced ?? []).filter((f) => (f.files ?? []).length);
    const fileless = (cur.unplaced ?? []).filter((f) => !(f.files ?? []).length);
    const fixes = Object.entries(cur.byPlan ?? {}).filter(([id]) => tasks.some((x) => x.plan === id)).map(([id, list]) => async () => {
      const t = tasks.find((x) => x.plan === id);
      if (!t) return { id, skipped: true };
      const reqs = pendingRequests[id] ?? [];
      const dg = digestLine(`fix:${id}`, await digestOf({ owns: t.owns ?? [] }));
      // A plan resumed without its worktree is repaired in the main tree: a new worktree would start from HEAD,
      // without the plan's integrated output.
      if (worktreeMode && !worktrees[id]) return { id, kind: "fixer", ...(await writeTree(() => call([fixerText(t.owns ?? [], [], list), reqs.length ? `Change requests from other plans of this wave (JSON): ${JSON.stringify(reqs)}` : "", dg].filter(Boolean).join("\n\n"), fixerOpts(`fix-${id}-${round}`)))) };
      const prompt = [`Fix round ${round} for plan ${id}: the gate failed on your owned files. Fix only inside your owns; do not run the build or the tests.`, failureText(list), reqs.length ? `Change requests from other plans of this wave (JSON): ${JSON.stringify(reqs)}` : "", `Evidence: ${cur.evidence}`, "Return the same JSON as before, with resolvedRequests listing only request paths you actually resolved.", dg].filter(Boolean).join("\n\n");
      const fix = () => call(prompt, execOpts(t, `fix-${id}-${round}`));
      return { id, kind: "executor", t, ...(await (worktreeMode ? fix() : writeTree(fix))) };
    });
    // G064: an integration fixer owns exactly the files its failures name; a failure naming no file has no owner.
    if (placed.length) {
      const files = [...new Set(placed.flatMap((f) => f.files ?? []))];
      // Kit feedback 83: written before the fixer runs, so a run that dies in it still knows the files it may have changed.
      await state("integration", { op: "add", files, why: `integration fix of ${waveId} round ${round}` });
      const lost = unsaved("before the integration fix");
      if (lost) return { stop: lost };
      fixes.push(async () => {
        const prompt = [`Integration fix: these gate failures belong to no plan. You own exactly these files: ${JSON.stringify(files)}.`, failureText(placed), "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.", digestLine("fix:integration", await digestOf({ files }))].join("\n\n");
        return { id: null, kind: "integration", ...(await writeTree(() => call(prompt, fixerOpts(`integration-fix-${round}`)))) };
      });
    }
    // Kit feedback 64: the red gate this round answers, for the plans of the wave (graph: the plan or the commit batch).
    const redGate = { wave: waveId, round, label, plans: tasks.map((t) => t.plan), failures: cur.failureCount ?? null };
    if (!fixes.length && !sharedChanges.some((s) => !s.applied)) {
      await defectEvent("gate-failure", redGate, []);
      return red(fileless.length ? `${fileless.length} gate failure(s) name no file of any plan, so no fixer can own them` : "no fixer owns the failing files");
    }
    const results = await parallel(fixes);
    // Each fix call of the round, then the red gate it answers, with the plan defects the fixers named.
    const roundDefects = [];
    for (const r of results) {
      if (!r || r.skipped) continue;
      const named = r.result ? defectsOf(r.result) : [];
      roundDefects.push(...named);
      await defectEvent("fix-round", { wave: waveId, round, label, plan: r.id ?? null, fixer: r.kind }, named);
    }
    await defectEvent("gate-failure", redGate, roundDefects);
    const soft = [];
    const decisions = [];
    for (const r of results) {
      if (!r) return red("a fix call failed to run");
      if (r.skipped) continue;
      const who = r.id ? `plan ${r.id}` : "the integration fixer";
      if (r.result === null) {
        if (fatal(r.reason)) return { stop: owner("Gate", `fix call of ${who} failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason), evidence: cur.evidence }) };
        soft.push({ id: r.id, why: `fix call of ${who} returned nothing${r.reason ? ` (${r.reason})` : ""}` });
        continue;
      }
      await routeRequests(r.t ?? { plan: r.id ?? "integration" }, r.result);
      if (stateError) return red("could not persist pending change requests");
      if (r.kind === "executor") {
        const decision = ownerDecision(r.result, r.id);
        if (decision) decisions.push({ id: r.id, decision });
      } else if (r.result.status !== "fixed") soft.push({ id: r.id, why: `${who} unresolved (${r.result.remaining_failures ?? "?"} failures remain)${r.result.evidence ? `: ${r.result.evidence}` : ""}` });
      if (r.id) await clearResolved(r.id, r.result);
    }
    if (stateError) return red("could not persist pending change requests");
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
    cur = await gate();
    // kit-feedback 51: a fixer's decision stops the round only while its plan still fails after the transfers and the rerun;
    // otherwise its failures were another fixer's to fix, and the answer is logged.
    const stuck = decisions.filter((d) => (cur.byPlan?.[d.id] ?? []).length > 0);
    for (const d of decisions.filter((x) => !stuck.includes(x))) log(`fix of ${d.id} reported "${d.decision.note ?? d.decision.evidence ?? d.decision.status}", but its failures are gone after the transfer and the rerun; not an owner decision`);
    if (stuck.length) return { stop: owner("Gate", stuck.map((d) => `owner decision needed in the fix of ${d.id}: ${d.decision.note ?? d.decision.evidence ?? d.decision.status}`).join("; "), { answer: ANSWER.tree("make the decision in the plan's files, then rerun with the same args"), decision: stuck[0].decision, evidence: cur.evidence }) };
    const still = soft.filter((s) => (s.id ? (cur.byPlan?.[s.id] ?? []).length > 0 : (cur.unplaced ?? []).some((f) => (f.files ?? []).length)));
    if (!done(cur) && still.length) return red(still.map((s) => s.why).join("; "));
    noDrop = cur.failureCount >= prev ? noDrop + 1 : 0;
    prev = cur.failureCount;
    if (!done(cur) && noDrop >= 2) return { stop: owner("Gate", `verify-fix stalled: ${cur.failureCount} failures did not drop over 2 rounds`, { answer: GATE_RED, failures: cur.failures, evidence: cur.evidence }) };
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
  // Kit feedback 64: the plan-catchable tag of the verifier whose verdict counts (measurement only).
  const catchable = {};
  const keepCatch = (v) => { if (metricsOn && ["yes", "no"].includes(v.plan_catchable)) catchable[v.id] = { tag: v.plan_catchable, reason: String(v.catch_reason ?? "").slice(0, 300) }; };
  const asked = metricsOn ? ["Return JSON {verdicts: [{id, verdict, evidence, plan_catchable, catch_reason}]}.", CATCH_NOTE] : ["Return JSON {verdicts: [{id, verdict, evidence}]}."];
  const dg = digestLine(`findings:${plan}`, await digestOf({ files: findingFiles(gated) }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = gated.filter((f) => !verdicts[f.id]);
    if (!missing.length) break;
    const r = await call([`Verify these review findings of plan ${plan} independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.`, `Findings (JSON): ${JSON.stringify(missing.map(findingBrief))}`, ...asked, dg].join("\n\n"), { label: `verify-findings-${plan}`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: verdictSchema });
    // GSDF-01: a quota, credit or auth failure is never retried.
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `finding verifier of ${plan} failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason), findings: gated.map(findingBrief) }) };
    for (const v of r.result?.verdicts ?? []) if (missing.some((f) => f.id === v.id)) { verdicts[v.id] = v.verdict; evidence[v.id] = v.evidence ?? ""; keepCatch(v); }
  }
  // A second, independent verifier decides what the first left uncertain, before the owner is asked; it does not see
  // the first verdict. Still uncertain stays unverified.
  const unsure = gated.filter((f) => verdicts[f.id] === "uncertain");
  if (unsure.length) {
    metrics.secondVerifier += unsure.length;
    const r = await call([`Verify these review findings of plan ${plan} independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.`, `Findings (JSON): ${JSON.stringify(unsure.map(findingBrief))}`, ...asked, dg].join("\n\n"), { label: `verify-findings-${plan}-second`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: verdictSchema });
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `second finding verifier of ${plan} failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason), findings: gated.map(findingBrief) }) };
    for (const v of r.result?.verdicts ?? []) if (unsure.some((f) => f.id === v.id)) {
      if (v.verdict !== "uncertain") { verdicts[v.id] = v.verdict; keepCatch(v); }
      evidence[v.id] = [evidence[v.id], v.evidence].filter(Boolean).join(" | second verifier: ");
    }
  }
  for (const f of gated) {
    f.verdict = verdicts[f.id] ?? "unverified";
    f.verdictEvidence = evidence[f.id] ?? (verdicts[f.id] ? "" : "no verifier answered");
    if (metricsOn && f.verdict === "confirmed") {
      f.planCatchable = catchable[f.id]?.tag ?? null;
      f.catchReason = catchable[f.id]?.reason ?? "";
    }
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
// built (graph schedule): what the reviewer is told about the build state instead of the wave's green gate.
async function reviewPlan(t, waveId, codeOnly, scopeOverride, built = "The wave is built and its tests are green.") {
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
      codeOnly ? "This code is not built yet (code-only review)." : built,
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
    if (empty >= 0) return { stop: owner("Review", `reviewer${reviewers.length > 1 ? ` ${empty + 1}` : ""} of ${t.plan} returned nothing${replies[empty]?.reason ? ` (${replies[empty].reason})` : ""}`, { answer: ANSWER.rerun() }) };
    const found = replies.flatMap((r, k) => (r.result.findings ?? []).map((f, i) => ({ ...f, id: `${k ? `R${k + 1}-` : ""}${f.id ?? `${t.plan}-F${i + 1}`}` })));
    // CR-GSF-17: an unknown severity is a named blocking error, never a silent downgrade to non-blocking.
    const unknown = found.filter((f) => !SEVERITIES.includes(String(f.severity).toLowerCase()));
    if (unknown.length) return { stop: owner("Review", `reviewer of ${t.plan} returned unknown severities (${[...new Set(unknown.map((f) => f.severity))].join(", ")}), expected ${SEVERITIES.join("|")}`, { answer: ANSWER.rerun(), findings: unknown }) };
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
  const fresh = list.filter((f) => !(progress.integration ?? []).includes(f));
  if (fresh.length) await state("integration", { op: "add", files: fresh, why: "granted (ph gsd grant)" });
  return list;
}
// The plans of the phase owning the files a fixer asked for (plan null: no plan owns the file).
async function askedOwners(requests) {
  const list = (requests ?? []).filter((rq) => rq && typeof rq.path === "string" && rq.path.trim() && !isKitDoc(rq.path)).map((rq) => ({ ...rq, path: slashPath(rq.path) }));
  if (!list.length) return [];
  const plans = allTasks.map((x) => ({ id: x.plan, owns: x.owns ?? [], summary: x.summary }));
  const owners = (await flow(["owners"], { paths: list.map((rq) => rq.path), plans })).json?.owners ?? {};
  return list.map((rq) => ({ ...rq, plan: (owners[rq.path] ?? [])[0] ?? null }));
}
const grantOption = (rq) => `ph gsd grant ${N} --path ${rq.path}${rq.plan ? ` --plan ${rq.plan}` : ""}, then rerun with the same args`;
async function fixer(label, findings, failures, owns) {
  const fixOwns = [...owns, ...(await grantedFiles())];
  const prompt = [fixerText(fixOwns, findings, failures), digestLine(`fix:${label}`, await digestOf({ owns: fixOwns, files: findingFiles(findings) }))].join("\n\n");
  const r = await writeTree(() => call(prompt, fixerOpts(label, { timeoutS: (g.fixer.minutes + 5) * 60 })));
  ev(`fixer ${label}`);
  await defectEvent("fix-round", { label, plan: null, fixer: findings.length ? "review" : "gate" }, r.result ? defectsOf(r.result) : []);
  // kit-feedback 55: an edit that no build or test run followed is named in the stop, so the owner runs the failing tests before any hand fix.
  const lastEdit = r.result ? r.result.lastEdit ?? "unverified" : null;
  if (!r.result || r.result.status !== "fixed") {
    // The files the fixer asked for and could not change are offered as grants: the owner grants them and reruns.
    const grantRequests = await askedOwners(r.result?.requests);
    return { stop: owner("Fix", r.result ? `fixer unresolved: ${r.result.remaining_failures ?? "?"} failures remain${lastEdit === "unverified" ? "; last edit unverified: run the failing tests before a hand fix" : ""}` : `fixer stopped or timed out${r.reason ? `: ${r.reason}` : ""}`, { answer: grantRequests.length ? ANSWER.grant(grantRequests[0].path, grantRequests[0].plan) : ANSWER.tree("fix the remaining failures by hand (run the failing tests first), then rerun with the same args"), evidence: r.result?.evidence ?? null, lastEdit, ...(grantRequests.length ? { grantRequests, options: [...grantRequests.map(grantOption), "stop"] } : {}) }) };
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
    if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `resolution check of ${rv.record.plan} failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason) }) };
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
      if (!again.green) return { stop: owner("Gate", `${opts.what} red after the review fix`, { answer: GATE_RED, failures: again.failures, evidence: again.evidence }) };
      evidence = again.evidence;
    }
    const rc = await resolutionCheck(open, waveId);
    if (rc.stop) return rc;
    if (!rc.unresolved.length) return { evidence };
    open = open.filter((r) => unresolvedOf(r.record).length);
    if (pass === 2) return { stop: owner("Review", `${rc.unresolved.length} confirmed findings unresolved after two fix passes`, { answer: ANSWER.tree("fix them by hand, then rerun with the same args (only the resolution check runs again)"), findings: rc.unresolved, options: ["fix them by hand, then rerun with the same args (only the resolution check runs again)", "stop"] }) };
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
  const oc = await flow(["owned-changes", phaseDir], { plans: tasks.map(asPlan), pending: later.map(asPlan), ignore: [cfg.worktree_dir] });
  if (oc.code !== 0 || !oc.json?.files) return { stop: result("failed", { reason: `commit scope could not be resolved: ${oc.json?.error ?? `exit ${oc.code}`}` }) };
  for (const [set, list, why] of [[reported.outsideRoots, oc.json.outside, "outside every plan's owns and outside adapter.ownership.source_roots"], [reported.eolOnly, oc.json.eolOnly, "owned by no plan and changed in line endings only"]]) {
    for (const p of list ?? []) if (!set.has(p)) { set.add(p); log(`warning: ${p} is ${why}; reported, not committed and not a stop`); }
  }
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
    return { stop: owner("Commit", `code commit of ${ids.join(",")} failed: ${c.json?.error ?? c.json?.reason ?? `exit ${c.code}`}; nothing tracked`, { answer: ANSWER.tree("fix the cause (hook, identity, index), then rerun with the same args"), recovery, options: ["fix the cause (hook, identity, index) and rerun with the same args", "stop"] }) };
  }
  ownCommits.add(c.json.hash);
  const entry = { sha: c.json.hash, phase: N, wave, plans: Object.fromEntries(ids.map((id) => [id, [...(pf.files[id] ?? []), ...(pf.removed[id] ?? [])]])) };
  if (withIntegration && pf.integration.length) entry.integration = pf.integration;
  const jp = await flow(["json-push", `${phaseDir}/commits.json`], entry);
  if (jp.code !== 0) return { stop: owner("Commit", `commit ${c.json.hash} made but ${phaseDir}/commits.json was not updated: ${jp.json?.error ?? `exit ${jp.code}`}`, { answer: ANSWER.rerun("rerun with the same args; the resume gate reconciles the commit"), recovery: { ...recovery, entry } }) };
  ev(`commit ${subject}`);
  return { sha: c.json.hash };
}
// Kit feedback 75: the plans of a recorded commit no longer need their executor worktrees; their deltas are in the main tree and
// in the commit. A plan this run did not dispatch (its SUMMARY was there already) is found by the worktree its transfer record names.
// The verb keeps a tree whose delta is not all in the transfer record, and a failure only leaves the tree.
async function discardLanded(ids) {
  if (!worktreeMode) return;
  for (const id of ids.filter((x) => !discarded.includes(x))) {
    if (!worktrees[id]) {
      const tr = (await flow(["read", `${phaseDir}/transfers/${id}.json`])).json;
      try { if (tr?.exists) worktrees[id] = JSON.parse(tr.text).worktree ?? undefined; } catch { /* no usable record */ }
      if (!worktrees[id]) continue;
    }
    const r = await flow(["discard-worktree"], { plan: id, worktree: worktrees[id], reason: "landed" });
    if (r.json?.removed || r.json?.gone) { discarded.push(id); delete keptTrees[id]; ev(`worktree ${id} discarded`); }
    else { keptTrees[id] = r.json?.why ?? r.json?.error ?? `exit ${r.code}`; log(`plan ${id}: worktree ${worktrees[id]} kept (${keptTrees[id]})`); }
  }
}
// Kit feedback 85: before Commit each open request of the committed plans is checked, deterministically where possible (the digest
// of its path changed since the request, and a green gate precedes every Commit) and by one read-only resolver call for the rest
// (gsd.request_check auto; tree = the deterministic check only; off = every open request stops the commit).
const RESOLVER_NOTE = "Cross-plan change requests were made while the plans of this phase ran. Decide read-only, for each request below, whether the current code already satisfies it: the change is present in the named file in this or an equivalent form that serves the request's reason. Read only the named files; raise nothing new.";
async function settleRequests(list) {
  const plans = list.flatMap((w) => w.tasks.map((t) => t.plan));
  const openNow = () => plans.flatMap((plan) => (pendingRequests[plan] ?? []).map((q) => ({ plan, q })));
  if (!openNow().length) return null;
  const mode = g.request_check ?? "auto";
  if (mode !== "off") {
    for (const { plan, q } of openNow()) {
      const key = requestKey(plan, q);
      if (!progress.requestBase || !Object.hasOwn(progress.requestBase, key)) continue;
      const c = await state("request", { op: "close", plan, from: q.from, path: q.path, change: q.change, by: "tree", why: `${slashPath(q.path)} changed after the request, and the gate after the change is green` });
      if (c.closed) noteClosed([c.closed]);
    }
  }
  let note = "";
  const rest = openNow();
  if (mode === "auto" && rest.length) {
    const items = rest.map(({ plan, q }, n) => ({ id: `R${n + 1}`, plan, from: q.from ?? null, path: slashPath(q.path), change: q.change, reason: q.reason ?? null }));
    const ids = [...new Set(rest.map((x) => x.plan))].join("+");
    const prompt = [RESOLVER_NOTE, `Requests (JSON): ${JSON.stringify(items)}`, "Return JSON {resolution: [{id, resolved, evidence}]}.", digestLine(`requests:${ids}`, await digestOf({ files: items.map((x) => x.path) }))].join("\n\n");
    const r = await call(prompt, { label: `resolve-requests-${ids}`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: RESOLUTION_SCHEMA });
    if (r.result === null) {
      if (fatal(r.reason)) return owner("Commit", `the resolver of the open cross-plan requests failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason), requests: rest.map((x) => x.q) });
      note = `; the resolver returned nothing${r.reason ? ` (${r.reason})` : ""}`;
    } else {
      for (const x of r.result.resolution ?? []) {
        const at = items.findIndex((it) => it.id === x.id);
        if (at < 0 || x.resolved !== true) continue;
        const { plan, q } = rest[at];
        const c = await state("request", { op: "close", plan, from: q.from, path: q.path, change: q.change, by: "resolver", why: x.evidence || "the resolver found the change present" });
        if (c.closed) noteClosed([c.closed]);
      }
    }
  }
  const lostClosed = unsaved("after closing requests");
  if (lostClosed) return lostClosed;
  const left = openNow();
  if (!left.length) return null;
  return owner("Commit", `cross-plan change requests lack acknowledged resolution${note}`, { answer: ANSWER.request(left[0].plan, slashPath(left[0].q.path)), requests: left.map((x) => x.q), options: [...left.map(({ plan, q }) => `ph gsd request clear ${N} --plan ${plan} --path ${slashPath(q.path)} --reason "<why it is satisfied>", then rerun with the same args`), "make the change in the file, then rerun with the same args"] });
}
async function commitWaves(list, verify, evidence) {
  phase("Commit");
  const requestStop = await settleRequests(list);
  if (requestStop) return { stop: requestStop };
  const pf = await planFiles(list.flatMap((d) => d.tasks));
  if (pf.stop) return pf;
  if (pf.unowned.length) return { stop: owner("Commit", `changes outside every plan's owns: ${pf.unowned.slice(0, 10).join(", ")}`, { answer: ANSWER.tree(UNOWNED_OPTIONS[0]), paths: pf.unowned, options: UNOWNED_OPTIONS }) };
  let withIntegration = true;
  for (const { w, tasks } of list) {
    const ids = tasks.map((t) => t.plan);
    const units = g.commit_policy.code === "per-plan" ? ids.map((id) => [`feat(${id}): phase ${N} plan ${id}`, [id]]) : [[`feat(${N}-w${w.k}): phase ${N} wave ${w.k}`, ids]];
    for (const [subject, unit] of units) {
      const c = await commitOne(subject, unit, w.k, pf, withIntegration);
      if (c.stop) return c;
      withIntegration = false;
      for (const id of unit) {
        const rec = await state("plan", { plan: id, stage: "committed", commit: c.sha, verify, evidence });
        if (rec.refused) return { stop: result("failed", { reason: `commit ${c.sha} of ${id} was not recorded: ${rec.refused}` }) };
      }
      const lost = unsaved(`after commit ${c.sha}`);
      if (lost) return { stop: lost };
      await discardLanded(unit);
    }
  }
  return {};
}
async function track(w, tasks, verify, evidence) {
  const st = await gsd(["state", "wave", "--phase", N, "--wave", String(w.k)], { plans: tasks.map((t) => t.plan), verify, evidence });
  if (st.code !== 0) return { stop: owner("Commit", `wave ${w.k} committed but STATE was not updated: ${st.json?.error ?? `exit ${st.code}`}`, { answer: ANSWER.rerun(), options: ["rerun with the same args"] }) };
  waveResults.push({ wave: w.k, waveId: w.waveId, plans: tasks.map((t) => t.plan), verify, evidence });
  for (const t of tasks) {
    const rec = await state("plan", { plan: t.plan, stage: "tracked" });
    if (rec.refused) return { stop: result("failed", { reason: `wave ${w.k} tracking of ${t.plan} was not recorded: ${rec.refused}` }) };
  }
  const lost = unsaved(`after tracking wave ${w.k}`);
  return lost ? { stop: lost } : {};
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
  if (haltedCoded.length) return { stop: owner("Execute", `plans with a SUMMARY and a halt record: ${haltedCoded.join(", ")}; resolve the halt first (ph gsd halt clear ${N} --plan <id> --reason <answer>)`, { answer: ANSWER.halt(), halted: haltedCoded }) };
  // G069: a transfer that started and never finished left a partial copy; the plan does not rejoin as if complete.
  const partial = ((await flow(["pending-transfers", phaseDir])).json?.pending ?? []).filter((p) => open.some((t) => t.plan === p.plan));
  if (partial.length) return { stop: owner("Execute", `the transfer of ${partial.map((p) => p.plan).join(", ")} did not finish: the main tree holds part of it (the worktree ${partial[0].worktree} is kept)`, { answer: ANSWER.tree("finish or revert the transfer by hand, then rerun with the same args"), partial, options: ["copy the rest from the worktree by hand and delete the transfers-pending record", "revert the copied paths, delete the SUMMARY and the record, then rerun to re-execute"] }) };
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
    await state("shared", { op: "add", changes: declared(key, s) });
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
    if (dirty.code !== 0) return { stop: owner("Execute", dirty.json?.dirty ? `owned files edited before the execute baseline are not in an executor worktree (it starts from HEAD): ${dirty.json.dirty.map((d) => `${d.path} (${d.plan})`).join(", ")}` : `owned-file check failed: ${dirty.json?.error}`, { answer: ANSWER.tree("commit or stash those edits, then rerun with the same args"), dirty: dirty.json?.dirty ?? [], options: ["commit or stash those edits, then rerun with the same args", "set gsd.isolation shared"] }) };
  }
  const stop = await resumeGate();
  if (stop) return { stop };
  const outcomes = [];
  for (const group of overlapGroups(toRun)) outcomes.push(...(await pool(group, limit, (t) => dispatch(t, w.waveId))));
  for (const o of outcomes) if (o?.wt) worktrees[o.plan] = o.wt;
  await integrate(outcomes, toRun);
  if (stateError) return { stop: result("failed", { reason: `could not persist pending change requests: ${stateError}` }) };
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
// The changes of a plan's <shared_changes> entry (G083), one per path (none: one change naming no file).
const declared = (key, s) => (s.paths?.length ? s.paths : [null]).map((p) => ({ key, from: s.source, path: p, change: s.text, reason: "declared in the plan's <shared_changes>", ...(s.via ? { via: s.via, outputs: s.outputs } : {}) }));
const isTracer = (w) => w.tasks.some((t) => t.tracer === true || t.tracer?.is === true);
const metricsLine = (wave) => flow(["append", "_workspace/review-metrics.jsonl"], JSON.stringify({ phase: N, wave, ...metrics }));

// A run that skipped halted or blocked plans says so in its result; shared changes left unapplied stop it.
const finish = async (extra = {}) => {
  const left = sharedChanges.filter((s) => !s.applied);
  if (left.length) return owner("Integration", `${left.length} shared change(s) were never applied`, { answer: ANSWER.shared(left[0].wave ?? "<wave>"), sharedChanges: left, options: sharedOptions(left[0].wave ?? "<wave>") });
  // Kit feedback 75: harness worktrees of finished runs that are still there (the transferred ones go with ph worktrees --prune).
  const old = worktreeMode ? (await flow(["leftover-worktrees"])).json : null;
  if (old?.total) log(`${old.total} leftover harness worktree(s) of finished runs (${old.removable} removable): ph worktrees --prune removes the removable ones`);
  return result("executed", { ...extra, ...(old?.total ? { leftoverWorktrees: { total: old.total, removable: old.removable, hint: "ph worktrees --prune" } } : {}), ...(skipped.length ? { reason: `executed except ${skipped.map((s) => `${s.plan} (${s.why})`).join(", ")}`, next: `answer the halts (ph gsd halt clear ${N} --plan <id> --reason <answer>) and rerun with the same args` } : {}) });
};

// kit-feedback 58: one gate over every plan of the run, after the last commit. A wave's gate goes stale once a later
// wave edits the same files, so verify reads only this evidence. A red phase gate stops the run; its plans stay tracked.
async function phaseGate(extra = {}) {
  const phaseTasks = wanted.filter((t) => !skipped.some((s) => s.plan === t.plan));
  if (!phaseTasks.length) return finish({ evidence: [], ...extra });
  phase("Gate");
  const pg = await runGate(`${prefix}batch`, phaseTasks);
  if (!pg.green) return owner("Gate", `the phase gate is red over ${phaseTasks.length} plans; the waves are committed and tracked`, { answer: GATE_RED, failures: pg.failures, evidence: pg.evidence, ...extra });
  return finish({ evidence: [pg.evidence], ...extra });
}

// ---- graph schedule (kit-feedback 66): a plan starts when the plans it waits for are committed ----
// Each plan is its own stream: executor and transfer, its own obligations with fix rounds, its review, fix and
// resolution check. Then it joins the commit queue: one batch at a time runs the repo-wide suite (adapter gates, build,
// tests) and commits on green. A stop settles its plan and the plans waiting for it; the others run on to their commit.
const BUILT = "The plan's own verify obligations are green; the repo-wide build and tests run before its commit.";
async function graphRun() {
  phase("Wave");
  idx = await index();
  const waveOf = new Map(handoff.flatMap((w) => w.tasks.map((t) => [t.plan, w])));
  const sg = await flow(["schedule-graph"], { plans: allTasks.map((t) => ({ id: t.plan, wave: waveOf.get(t.plan).k, depends_on: planInfo(t.plan).depends_on ?? [], owns: t.owns ?? [], files_modified: planInfo(t.plan).files_modified ?? [], tracer: t.tracer === true || t.tracer?.is === true })) });
  if (!sg.json?.deps) return { stop: result("failed", { reason: `the execution graph could not be built: ${sg.json?.error ?? `exit ${sg.code}`}` }) };
  if (sg.json.cycle) return { stop: result("refused", { reason: `the plans wait for each other in a cycle (${sg.json.cycle.join(" -> ")}); fix depends_on and regenerate the handoff with gsd-plan`, cycle: sg.json.cycle }) };
  const deps = sg.json.deps;
  // Plans committed by an earlier run but not tracked are only tracked (CR-GSF-02).
  for (const w of waves) {
    const committed = w.tasks.filter(selectedTask).filter((t) => committedOnly(t.plan));
    if (!committed.length) continue;
    const p0 = progress.plans[committed[0].plan];
    const tr = await track(w, committed, p0.verify ?? "green", p0.evidence ?? null);
    if (tr.stop) return tr;
  }
  const units = waves.flatMap((w) => w.tasks.filter(selectedTask).filter((t) => !tracked(t.plan)));
  const inRun = new Set(units.map((t) => t.plan));
  const isCommitted = (id) => progress.plans[id]?.commit !== undefined;
  const execSlot = slots(limit);
  const reviewSlot = slots(reviewLimit);
  const order = [];
  const stops = [];
  let draining = null;
  // A settled plan is committed, stopped, skipped or interrupted (the run drained before it got there).
  const settled = new Map();
  const waiters = new Map();
  let pokes = 0;
  let kick = null;
  const poke = () => { pokes++; const k = kick; kick = null; k?.(); };
  const settledOf = (id) => settled.get(id) ?? (isCommitted(id) ? { state: "committed" } : null);
  const settle = (id, outcome) => {
    if (settled.has(id)) return;
    settled.set(id, outcome);
    for (const go of waiters.get(id) ?? []) go(outcome);
    waiters.delete(id);
    poke();
  };
  const whenSettled = (id) => (settledOf(id) ? Promise.resolve(settledOf(id)) : new Promise((go) => waiters.set(id, [...(waiters.get(id) ?? []), go])));
  // A stop that is no owner decision about one plan (a quota, a call that cannot run, a failed or refused step, a resume
  // gate problem) drains the run: nothing new starts, and the plans not committed yet are interrupted.
  const stopPlans = (ids, stop, drain = false) => {
    stops.push({ plans: ids, stop });
    if (drain || stop.status !== "needs-owner" || stop.failure) draining ??= `${ids.join(", ")}: ${stop.reason}`;
    for (const id of ids) settle(id, { state: "stopped", stop });
  };
  const skip = (t, why) => {
    if (!skipped.some((s) => s.plan === t.plan)) skipped.push({ plan: t.plan, wave: waveOf.get(t.plan).k, why });
    log(`warning: plan ${t.plan} skipped (${why}); answer a halt with ph gsd halt clear ${N} --plan <id> --reason <answer>`);
    settle(t.plan, { state: "skipped", why });
  };
  const interrupt = (t) => settle(t.plan, { state: "interrupted" });
  // A gate red in the given plans' own files (or in files of no open plan), not only in files of other open plans.
  const ownRed = (x, ids) => !x.green && ((x.unplaced ?? []).length > 0 || !Object.keys(x.byPlan ?? {}).length || ids.some((id) => (x.byPlan[id] ?? []).length > 0));
  const othersOpen = (ids) => units.filter((x) => !ids.includes(x.plan) && inFlight.has(x.plan) && !isCommitted(x.plan));
  // Plans whose obligations failed only in files of other open plans: the suite of their commit runs those obligations too.
  const recheck = new Set();
  const queue = [];

  async function unit(t) {
    const w = waveOf.get(t.plan);
    const label = `plan ${t.plan}`;
    const missing = deps[t.plan].filter((d) => !inRun.has(d) && !isCommitted(d));
    if (missing.length) return skip(t, `waits for ${missing.join(", ")}, which is not committed and not in this run`);
    const before = await Promise.all(deps[t.plan].map(whenSettled));
    const blocked = deps[t.plan].filter((d, i) => ["stopped", "skipped"].includes(before[i].state));
    if (blocked.length) return skip(t, `blocked by ${blocked.join(", ")}`);
    if (draining || before.some((o) => o.state !== "committed")) return interrupt(t);
    idx = await index();
    const p = planInfo(t.plan);
    if (p.has_summary && p.halted) return stopPlans([t.plan], owner("Execute", `plans with a SUMMARY and a halt record: ${t.plan}; resolve the halt first (ph gsd halt clear ${N} --plan <id> --reason <answer>)`, { answer: ANSWER.halt(t.plan), halted: [t.plan] }));
    if (!p.has_summary && (p.halted || p.error)) return skip(t, p.halted ? "halted" : `frontmatter ${p.error}`);
    const partial = ((await flow(["pending-transfers", phaseDir])).json?.pending ?? []).filter((x) => x.plan === t.plan);
    if (partial.length) return stopPlans([t.plan], owner("Execute", `the transfer of ${t.plan} did not finish: the main tree holds part of it (the worktree ${partial[0].worktree} is kept)`, { answer: ANSWER.tree("finish or revert the transfer by hand, then rerun with the same args"), partial, options: ["copy the rest from the worktree by hand and delete the transfers-pending record", "revert the copied paths, delete the SUMMARY and the record, then rerun to re-execute"] }));
    order.push(`start ${t.plan}`);
    if (p.has_summary) {
      inFlight.add(t.plan);
      log(`plan ${t.plan}: SUMMARY present but not committed; it rejoins its checks, review and commit`);
    } else {
      if (worktreeMode) {
        const dirty = await flow(["dirty-owned", phaseDir], { plans: [{ id: t.plan, owns: t.owns ?? [] }] });
        if (dirty.code !== 0) return stopPlans([t.plan], owner("Execute", dirty.json?.dirty ? `owned files edited before the execute baseline are not in an executor worktree (it starts from HEAD): ${dirty.json.dirty.map((d) => `${d.path} (${d.plan})`).join(", ")}` : `owned-file check failed: ${dirty.json?.error}`, { answer: ANSWER.tree("commit or stash those edits, then rerun with the same args"), dirty: dirty.json?.dirty ?? [], options: ["commit or stash those edits, then rerun with the same args", "set gsd.isolation shared"] }));
      }
      const gateStop = await resumeGate();
      if (gateStop) return stopPlans([t.plan], gateStop, true);
      const o = await execSlot(async () => {
        if (draining) return null;
        inFlight.add(t.plan);
        return dispatch(t, w.waveId);
      });
      if (!o) return interrupt(t);
      if (o.wt) worktrees[t.plan] = o.wt;
      await integrate([o], [t]);
      if (stateError) return stopPlans([t.plan], result("failed", { reason: `could not persist pending change requests: ${stateError}` }));
      const hs = haltStop([o], "Execute");
      if (hs) return stopPlans([t.plan], hs);
      if (!worktreeMode) {
        const stray = await strayStop([t], "Execute");
        if (stray) return stopPlans([t.plan], stray);
      }
    }
    if (draining) return interrupt(t);
    // G083: the plan's <shared_changes> are made once its own code is in the main tree.
    for (const s of (w.sharedChanges ?? []).filter((x) => x.source === t.plan)) {
      const key = `${w.waveId}:${s.source}:${s.text}`;
      if (sharedChanges.some((x) => x.key === key)) continue;
      await state("shared", { op: "add", changes: declared(key, s) });
    }
    const sh = await applyShared(w.waveId, label);
    if (sh) return stopPlans([t.plan], sh);
    // The plan's own obligations; a failure only in files of other open plans is left to the suite of the commit queue.
    const checkId = `${w.waveId}-${t.plan}`;
    const check = async () => {
      if (!(t.verify ?? []).length) return { green: true, evidence: null, failures: [], failureCount: 0, byPlan: {}, unplaced: [] };
      const x = await runGate(checkId, [t], { suite: false, context: othersOpen([t.plan]) });
      if (x.green || ownRed(x, [t.plan])) {
        recheck.delete(t.plan);
        return x;
      }
      recheck.add(t.plan);
      return { ...x, green: true, foreign: Object.keys(x.byPlan) };
    };
    phase("Gate");
    let cur = await check();
    if (!cur.green) {
      const fr = await fixRounds(checkId, [t], cur, label, "", { gate: check });
      if (fr.stop) return stopPlans([t.plan], fr.stop);
      if (!fr.gate.green) return stopPlans([t.plan], owner("Gate", `${label} is red after ${g.max_verify_rounds} fix rounds`, { answer: GATE_RED, failures: fr.gate.failures, evidence: fr.gate.evidence, blockedBy: fr.gate.blockedBy }));
      cur = fr.gate;
    }
    if (cur.foreign) log(`plan ${t.plan}: its obligations fail only in files of open plans ${cur.foreign.join(", ")}; the suite of the commit queue judges them together`);
    if (draining) return interrupt(t);
    phase("Review");
    const rv = await reviewSlot(() => (draining ? null : reviewPlan(t, w.waveId, false, undefined, BUILT)));
    if (!rv) return interrupt(t);
    if (rv.stop) return stopPlans([t.plan], rv.stop);
    if (rv.unverified.length) return stopPlans([t.plan], owner("Review", `${rv.unverified.length} blocking findings of ${t.plan} could not be verified`, { answer: ANSWER.rerun("rerun with the same args; the unverified findings are verified again"), findings: rv.unverified.map((f) => ({ ...findingBrief(f), verdict: f.verdict, evidence: f.verdictEvidence ?? "" })) }));
    if (unresolvedOf(rv.record).length) {
      const fx = await fixAndResolve(w.waveId, [rv], { label: `fix-review-${checkId}`, owns: t.owns ?? [], tasks: [t], what: label, gate: check });
      await metricsLine(checkId);
      if (fx.stop) return stopPlans([t.plan], fx.stop);
    } else await metricsLine(checkId);
    if (draining) return interrupt(t);
    queue.push(t);
    poke();
    await whenSettled(t.plan);
  }

  // The commit of a batch whose suite is green: the plans' commits, commits.json and the STATE wave log, per handoff wave.
  async function commitNow(batch, evidence) {
    const groups = waves.map((w) => ({ w, tasks: batch.filter((t) => waveOf.get(t.plan) === w) })).filter((x) => x.tasks.length);
    const cm = await commitWaves(groups, "green", evidence);
    if (cm.stop) return cm;
    for (const x of groups) {
      const tr = await track(x.w, x.tasks, "green", evidence);
      if (tr.stop) return tr;
    }
    order.push(`commit ${batch.map((t) => t.plan).join(",")}`);
    return { committed: true };
  }
  // One batch of the commit queue: the smoke build when due, then the repo-wide suite and the commit in one turn of the main
  // tree. Failures of the batch (or of no open plan) go to fix rounds over the batch; failures only in files of other open
  // plans make the batch wait for them ({wait: [ids]}).
  async function commitBatch(batch) {
    const ids = batch.map((t) => t.plan);
    const label = `the commit of ${ids.join(", ")}`;
    const joinId = `${prefix}join`;
    const sm = await smokeStop(batch, joinId, label);
    if (sm) return { stop: sm };
    phase("Commit");
    const obligations = new Set(ids.filter((id) => recheck.has(id)));
    const suite = () => runGate(joinId, batch, { obligations, context: othersOpen(ids) });
    const foreignOf = (x) => Object.keys(x.byPlan ?? {}).filter((id) => !ids.includes(id));
    for (let attempt = 1; attempt <= 2; attempt++) {
      const c = await aloneOnTree(async () => {
        const x = await gateNow(joinId, batch, { obligations, context: othersOpen(ids) });
        return x.green ? { gate: x, ...(await commitNow(batch, x.evidence)) } : { gate: x };
      });
      if (c.stop || c.committed) return c;
      if (!ownRed(c.gate, ids)) return { wait: foreignOf(c.gate), gate: c.gate };
      const fr = await fixRounds(joinId, batch, c.gate, `the suite before ${label}`, "", { gate: suite, done: (x) => !ownRed(x, ids) });
      if (fr.stop) return fr;
      if (ownRed(fr.gate, ids)) return { stop: owner("Gate", `the suite before ${label} is red after ${g.max_verify_rounds} fix rounds`, { answer: GATE_RED, failures: fr.gate.failures, evidence: fr.gate.evidence, blockedBy: fr.gate.blockedBy }) };
      if (!fr.gate.green) return { wait: foreignOf(fr.gate), gate: fr.gate };
      // The green suite of the last fix round is reused while its inputs are unchanged.
      const again = await aloneOnTree(async () => {
        const ec = await flow(["evidence-check", fr.gate.evidence], { plans: batch.map((t) => ({ id: t.plan, owns: t.owns ?? [], verify: obligations.has(t.plan) ? t.verify ?? [] : [] })) });
        return ec.json?.status === "current" ? commitNow(batch, fr.gate.evidence) : {};
      });
      if (again.stop || again.committed) return again;
    }
    return { stop: owner("Gate", `the suite before ${label} turned red again after its fix rounds`, { answer: ANSWER.rerun(), options: ["rerun with the same args", "stop"] }) };
  }
  // A plan the batch waits for can still help while it runs, or when it will start without the batch; a stopped plan, or
  // one that waits for the batch itself, never can.
  const waitsForBatch = (id, ids, seen = new Set()) => !inFlight.has(id) && deps[id].some((d) => ids.includes(d) || (!settledOf(d) && !seen.has(d) && (seen.add(d), waitsForBatch(d, ids, seen))));
  async function committer() {
    let seen = -1;
    let waitOn = null;
    for (;;) {
      if (seen === pokes) await new Promise((go) => { kick = go; });
      seen = pokes;
      if (!queue.length) {
        if (units.every((t) => settledOf(t.plan))) return;
        continue;
      }
      if (draining) {
        for (const t of queue.splice(0)) interrupt(t);
        continue;
      }
      if (waitOn && !waitOn.some((id) => queue.some((x) => x.plan === id) || settledOf(id))) continue;
      waitOn = null;
      const batch = queue.splice(0);
      const ids = batch.map((t) => t.plan);
      const r = await commitBatch(batch);
      if (r.committed) {
        for (const id of ids) { inFlight.delete(id); settle(id, { state: "committed" }); }
        continue;
      }
      if (r.stop) {
        stopPlans(ids, r.stop);
        continue;
      }
      const lost = r.wait.filter((id) => (settledOf(id) && settledOf(id).state !== "committed") || waitsForBatch(id, ids));
      if (!r.wait.length || lost.length === r.wait.length) {
        stopPlans(ids, owner("Gate", `the suite before the commit of ${ids.join(", ")} fails only in files of ${r.wait.join(", ")}, which stopped or wait for this commit`, { answer: ANSWER.tree("resolve the stop of those plans, then rerun with the same args"), failures: r.gate.failures, evidence: r.gate.evidence, blockedBy: r.gate.blockedBy, options: ["resolve the stop of those plans, then rerun with the same args", "stop"] }));
        continue;
      }
      log(`commit queue: the suite fails only in files of open plans ${r.wait.join(", ")}; ${ids.join(", ")} wait for them to join the queue`);
      queue.unshift(...batch);
      waitOn = r.wait;
    }
  }

  await parallel([
    async () => {
      try { await committer(); } catch (e) {
        stopPlans(queue.splice(0).map((t) => t.plan), result("failed", { reason: `commit queue: ${e.message}` }));
      }
    },
    ...units.map((t) => async () => {
      try { await unit(t); } catch (e) {
        stopPlans([t.plan], result("failed", { reason: `plan ${t.plan}: ${e.message}` }));
      }
    }),
  ]);
  const by = (state) => units.filter((t) => settled.get(t.plan)?.state === state).map((t) => t.plan);
  const info = { schedule: "graph", order, committed: by("committed"), ...(by("interrupted").length ? { interrupted: by("interrupted") } : {}) };
  if (!stops.length) return { info };
  return { stop: { ...stops[0].stop, ...info, stopped: stops.map(({ plans, stop }) => ({ plans, status: stop.status, stage: stop.stage ?? null, reason: stop.reason })), ...(skipped.length ? { skipped } : {}) } };
}

if (schedule === "graph") {
  const gr = await graphRun();
  if (gr.stop) return gr.stop;
  return phaseGate(gr.info);
}

if (execMode === "per-wave") {
  for (const w of waves) {
    const cw = await codeWave(w);
    if (cw.stop) return cw.stop;
    if (!cw.tasks.length) continue;
    const label = isTracer(w) ? "tracer wave" : `wave ${w.k}`;
    const tail = isTracer(w) ? "; no later wave starts" : "";
    const sh = await applyShared(w.waveId, label);
    if (sh) return sh;
    const sm = await smokeStop(cw.tasks, w.waveId, label);
    if (sm) return sm;
    phase("Gate");
    const fr = await fixRounds(w.waveId, cw.tasks, await runGate(w.waveId, cw.tasks), label, tail);
    if (fr.stop) return fr.stop;
    // GSDF-47: no reviewer before the wave is green; a red tracer starts no later wave.
    if (!fr.gate.green) return owner("Gate", `${label} is red after ${g.max_verify_rounds} fix rounds${tail}`, { answer: GATE_RED, failures: fr.gate.failures, evidence: fr.gate.evidence, blockedBy: fr.gate.blockedBy });
    phase("Review");
    const rv = await reviewAll(cw.tasks, w.waveId, false);
    if (rv.stop) return rv.stop;
    if (rv.unverified.length) return owner("Review", `${rv.unverified.length} blocking findings could not be verified`, { answer: ANSWER.rerun("rerun with the same args; the unverified findings are verified again"), findings: rv.unverified.map((f) => ({ ...findingBrief(f), verdict: f.verdict, evidence: f.verdictEvidence ?? "" })) });
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
  return phaseGate();
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
if (!done.length) return finish({ evidence: [] });
phase("Batch");
const doneTasks = done.flatMap((d) => d.tasks);
// CR-GSF-10: the phase review covers the actual changes of every executed plan, with or without per-wave reviews.
const phaseFiles = await planFiles(doneTasks);
if (phaseFiles.stop) return phaseFiles.stop;
// G070: an edit outside every plan's owns stops before the phase review is paid for.
if (phaseFiles.unowned.length) return owner("Commit", `changes outside every plan's owns: ${phaseFiles.unowned.slice(0, 10).join(", ")}`, { answer: ANSWER.tree(UNOWNED_OPTIONS[0]), paths: phaseFiles.unowned, options: UNOWNED_OPTIONS });
const phaseScope = [...new Set([...Object.values(phaseFiles.files).flat(), ...phaseFiles.integration])].filter((f) => !f.startsWith(".planning/")).sort();
if (!phaseScope.length) log("phase review: the phase diff holds no code changes");
// G071: the phase review covers the whole phase diff; an explicit files list scopes only the per-wave reviews.
if (Array.isArray(a.files) && a.files.length) log(`phase review: the files argument scopes only the per-wave reviews${g.batch_review ? "" : " (none run: batch_review is off)"}; the phase review covers the phase diff`);
const phaseReview = await reviewPlan({ plan: `${nn}-phase`, summary: null }, "phase", true, phaseScope);
if (phaseReview.stop) return phaseReview.stop;
allReviews.push(phaseReview);
const unverified = allReviews.flatMap((r) => r.unverified);
if (unverified.length) return owner("Review", `${unverified.length} blocking findings could not be verified`, { answer: ANSWER.rerun("rerun with the same args; the unverified findings are verified again"), findings: unverified.map((f) => ({ ...findingBrief(f), verdict: f.verdict, evidence: f.verdictEvidence ?? "" })) });
const batchId = `${prefix}batch`;
const batchGate = () => runGate(batchId, doneTasks);
const shB = await applyShared(batchId, "the batch");
if (shB) return shB;
const smB = await smokeStop(doneTasks, batchId, "the batch");
if (smB) return smB;
let final = await batchGate();
// G064: failures in files no executed plan owns go to an integration fixer owning exactly those files; the batch fixer
// gets only the failures of the executed plans; a failure naming no file has no fixer.
if (!final.green) {
  const placed = (final.unplaced ?? []).filter((f) => (f.files ?? []).length);
  // Kit feedback 64: in batch mode the cause of the red gate is what the integration fixer names; the batch fixer's own
  // defects are recorded with its fix call.
  const batchRed = { wave: batchId, round: 1, label: "the batch", plans: doneTasks.map((t) => t.plan), failures: final.failureCount ?? null };
  if (!placed.length) await defectEvent("gate-failure", batchRed, []);
  if (placed.length) {
    const files = [...new Set(placed.flatMap((f) => f.files))];
    await state("integration", { op: "add", files, why: "integration fix of the batch" });
    const lost = unsaved("before the integration fix");
    if (lost) return lost;

    const r = await call([`Integration fix: these gate failures belong to no plan. You own exactly these files: ${JSON.stringify(files)}.`, failureText(placed), "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.", digestLine("fix:integration", await digestOf({ files }))].join("\n\n"), fixerOpts("integration-fix-batch"));
    const named = r.result ? defectsOf(r.result) : [];
    await defectEvent("fix-round", { wave: batchId, round: 1, label: "the batch", plan: null, fixer: "integration" }, named);
    await defectEvent("gate-failure", batchRed, named);
    if (!r.result || r.result.status !== "fixed") return owner("Gate", `the integration fixer of the batch ${r.result ? "answered unresolved" : `returned nothing${r.reason ? ` (${r.reason})` : ""}`}`, { answer: fatal(r.reason) ? ANSWER.rerun("rerun after the reset") : GATE_RED, failures: placed, evidence: final.evidence, ...(fatal(r.reason) ? { failure: classify(r.reason) } : {}) });
    final = await batchGate();
  }
}
const batchFailures = [...new Set(Object.entries(final.byPlan ?? {}).filter(([id]) => doneTasks.some((t) => t.plan === id)).flatMap(([, list]) => list))];
if (!final.green && !batchFailures.length) return owner("Gate", `batch gate red: ${final.failureCount} failure(s) that no executed plan owns${(final.unplaced ?? []).some((f) => !(f.files ?? []).length) ? " (some name no file)" : ""}`, { answer: GATE_RED, failures: final.failures, evidence: final.evidence });
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
return finish({ evidence: [finalEvidence], finalGate: finalEvidence });
} finally {
  await flow(["unlock", "debug", lease.json.token]);
  await flow(["unlock", `phase-${nn}`, phaseLease.json.token]);
}
