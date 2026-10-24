// Decisions of the default execute composition (THIN.md stage 2, kit feedback 87): what gsd-execute.js decided inline is a
// flow verb here (`gsd-flow.mjs exec-<verb>`), JSON in and out, at most one record written (exec-defect: the plan-defect
// record). The composition keeps the step order, the stops and their answers, the agent calls and the retry counts.
import { spawnSync } from "node:child_process";
import * as files from "./flow-files.mjs";
import { digest } from "./flow-gate.mjs";
import { ownersOf } from "./flow-execute.mjs";
import { readState } from "./flow-state.mjs";
import { changedLines, reviewScope, writePrereview } from "./flow-review.mjs";
import { acceptedStatus } from "../../harness/gsd/accepted.mjs";
import { waitsForCode } from "../../harness/gsd/shared-changes.mjs";
import { errText } from "../../harness/lib/cli.mjs";
import { resolveInside } from "../../harness/lib/paths.mjs";
import { kitHelpers } from "../../harness/workflow/script.mjs";

const { PHASE_DIR_RE, phaseNumber } = kitHelpers({ shell: null, agent: null, parallel: null });
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
export const PLAN_DEFECT_KINDS = ["wrong-api", "owns-reach", "missing-dependency", "other"];
const slashPath = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "");
// Kit feedback 79: the project's kit-feedback document is the orchestrator's; a request against it is an observation about the kit.
export const isKitDoc = (p) => /(^|\/)kit-feedback\.md$/i.test(String(p).trim().replace(/\\/g, "/"));

// ---- agent reply schemas ----
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
export const INSTANCE_SCHEMA = { type: "object", properties: { file: { type: "string" }, line: { type: "number" } }, required: ["file"] };
// G056: the gate reads trigger, likelihood, confidence and file; a reply without them is re-asked by the schema retry instead of
// being recorded as a low-confidence (downgraded) finding.
export const FINDINGS_SCHEMA = { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { id: { type: "string" }, severity: { type: "string", enum: SEVERITIES }, trigger: { type: "string" }, likelihood: { type: "string" }, confidence: { type: "number" }, impact: { type: "string" }, file: { type: "string" }, line: { type: "number" }, description: { type: "string" }, introduced: { type: "boolean" }, class: { type: "string" }, instances: { type: "array", items: INSTANCE_SCHEMA } }, required: ["severity", "description", "trigger", "likelihood", "confidence", "file"] } } }, required: ["findings"] };
const VERDICT_SCHEMA = { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, verdict: { type: "string", enum: ["confirmed", "refuted", "uncertain"] }, evidence: { type: "string" } }, required: ["id", "verdict"] } } }, required: ["verdicts"] };
const RESOLUTION_SCHEMA = { type: "object", properties: { resolution: { type: "array", items: { type: "object", properties: { id: { type: "string" }, resolved: { type: "boolean" }, evidence: { type: "string" } }, required: ["id", "resolved"] } } }, required: ["resolution"] };
const FIXER_SCHEMA = { type: "object", properties: { resolvedRequests: { type: "array", items: { type: "string" } }, requests: EXEC_SCHEMA.properties.requests, status: { type: "string", enum: ["fixed", "unresolved"] }, attempts: { type: "number" }, remaining_failures: { type: "number" }, evidence: { type: "string" }, lastEdit: { type: "string", enum: ["verified", "unverified", "none"] } }, required: ["status"] };
const PLAN_DEFECTS_SCHEMA = { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: PLAN_DEFECT_KINDS }, evidence: { type: "string" } }, required: ["kind"] } };

// The schemas of one run. Kit feedback 64 (gsd.review_metrics): executors and fixers may name plan defects, the finding verifier
// tags confirmed findings plan-catchable. Kit feedback 79 (gsd.pending_request_tasks): a task may answer pending-request. Kit
// feedback 82: the shared-change fixer reports per change.
export function schemasOf({ metrics, pending }) {
  const withDefects = (schema) => (metrics ? { ...schema, properties: { ...schema.properties, plan_defects: PLAN_DEFECTS_SCHEMA } } : schema);
  const tr = EXEC_SCHEMA.properties.taskResults;
  const execBase = pending ? { ...EXEC_SCHEMA, properties: { ...EXEC_SCHEMA.properties, taskResults: { ...tr, items: { ...tr.items, properties: { ...tr.items.properties, status: { type: "string", enum: ["implemented", "pending-request", "partial", "blocked", "skipped"] } } } } } } : EXEC_SCHEMA;
  const fixer = withDefects(FIXER_SCHEMA);
  const vi = VERDICT_SCHEMA.properties.verdicts.items;
  const verdict = metrics ? { ...VERDICT_SCHEMA, properties: { verdicts: { ...VERDICT_SCHEMA.properties.verdicts, items: { ...vi, properties: { ...vi.properties, plan_catchable: { type: "string", enum: ["yes", "no"] }, catch_reason: { type: "string" } } } } } } : VERDICT_SCHEMA;
  const shared = { ...fixer, properties: { ...fixer.properties, changes: { type: "array", items: { type: "object", properties: { index: { type: "number" }, applied: { type: "boolean" }, evidence: { type: "string" } }, required: ["index", "applied"] } }, outside: { type: "string" } } };
  return { exec: withDefects(execBase), fixer, findings: FINDINGS_SCHEMA, verdict, resolution: RESOLUTION_SCHEMA, shared };
}

// exec-args (GSDF-93, kit feedback 88): {args} -> {status: ok, phaseDir, plans (null or ids), wave (null or n), stopAfterWave
// (null or n), gapsOnly, files?} or {status: failed, reason}.
export function execArgs({ args }) {
  const a = args ?? {};
  const failed = (reason) => ({ status: "failed", reason, code: 1 });
  if (typeof a.phaseDir !== "string" || !PHASE_DIR_RE.test(a.phaseDir)) return failed(`phaseDir must match ${PHASE_DIR_RE.source}`);
  const plans = a.plans ? (Array.isArray(a.plans) ? a.plans : String(a.plans).split(",")).map((s) => String(s).trim()).filter(Boolean) : null;
  if (plans && plans.some((id) => !/^\d+(\.\d+)?-\d+$/.test(id))) return failed("plans must be plan ids NN-MM");
  const wave = a.wave === undefined ? null : Number(a.wave);
  if (wave !== null && !(Number.isInteger(wave) && wave >= 1)) return failed("wave must be an integer >= 1");
  const stopAfterWave = a.stopAfterWave === undefined || a.stopAfterWave === null ? null : Number(a.stopAfterWave);
  if (stopAfterWave !== null && !(Number.isInteger(stopAfterWave) && stopAfterWave >= 1)) return failed("stopAfterWave must be an integer >= 1");
  return { status: "ok", phaseDir: a.phaseDir, plans, wave, stopAfterWave, gapsOnly: Boolean(a.gapsOnly), ...(a.files !== undefined ? { files: a.files } : {}) };
}

// exec-setup: {cfg, args (exec-args), pending (the composition's policy gsd.pending_request_tasks)} -> the settings of the run
// and its agent schemas.
export function execSetup({ cfg, args, pending = true }) {
  const g = cfg.gsd;
  const metricsOn = Boolean(g.review_metrics);
  const regenerated = cfg.adapter.ownership?.regenerated ?? [];
  return {
    status: "ok",
    N: phaseNumber(args.phaseDir),
    nn: args.phaseDir.split("/").pop().split("-")[0],
    prefix: args.gapsOnly ? "gap-" : "",
    mode: g.execution_mode,
    worktreeMode: g.isolation === "worktree",
    metricsOn,
    stackSkill: cfg.adapter.stack_skill ? `.claude/skills/${cfg.adapter.stack_skill}/SKILL.md` : null,
    // Kit feedback 86: the agents are told which files are generated (a request for one names its generator).
    generated: regenerated.length ? JSON.stringify(regenerated) : "",
    schemas: schemasOf({ metrics: metricsOn, pending }),
  };
}

// The plan defects a reply names, plus one owns-reach defect per request for a file outside the agent's owns (kit feedback 64).
export const defectsOf = (res) => [
  ...(Array.isArray(res?.plan_defects) ? res.plan_defects : []).filter((d) => PLAN_DEFECT_KINDS.includes(d?.kind)).map((d) => ({ kind: d.kind, evidence: String(d.evidence ?? "").slice(0, 300) })),
  ...(Array.isArray(res?.requests) ? res.requests : []).filter((rq) => typeof rq?.path === "string" && rq.path.trim() && !isKitDoc(rq.path)).map((rq) => ({ kind: "owns-reach", evidence: `request for ${rq.path.trim().replace(/\\/g, "/")}` })),
];
// A resumed run keeps the first run's id and starts from that run's record: the events of skipped work stay, and a replayed event
// replaces its earlier copy. An event is known by its kind, wave, round, plan, label, fixer and reason, plus `occ`, its count
// among this run's events of that identity (a commit batch can run its fix rounds twice).
const eventBase = (e) => JSON.stringify([e.kind, e.wave ?? null, e.round ?? null, e.plan ?? null, e.label ?? null, e.fixer ?? null, e.reason ?? null]);

// exec-defect <phaseDir> (kit feedback 64, measurement only): {runId, log: {events, occ} | null (read this run's record first),
// kind (null: only read), extra, reply?, defects?} -> {log, defects, warning?}; writes prereview/execute-<runId>.json.
export function execDefect(root, phaseDir, { runId, log = null, kind = null, extra = {}, reply = null, defects = [] }) {
  let warning = null;
  const state = log ?? { events: [], occ: {} };
  if (!log) {
    const prior = files.read(root, `${phaseDir}/prereview/execute-${runId}.json`);
    try { if (prior.exists) state.events.push(...(JSON.parse(prior.text).events ?? [])); } catch { warning = "the plan-defect record of this run is unreadable; it is written again"; }
  }
  if (!kind) return { log: state, defects: [], ...(warning ? { warning } : {}) };
  const found = [...defectsOf(reply), ...defects];
  const event = { kind, ...extra, cause: found.length ? "plan" : "other", defects: found };
  const base = eventBase(event);
  event.occ = (state.occ[base] ?? 0) + 1;
  state.occ[base] = event.occ;
  const at = state.events.findIndex((x) => eventBase(x) === base && (x.occ ?? 1) === event.occ);
  if (at >= 0) state.events[at] = event;
  else state.events.push(event);
  try {
    const w = writePrereview(root, phaseDir, { stage: "execute", runId, events: state.events });
    if (!w.ok) warning = `plan-defect record not written: ${w.errors.join("; ")}`;
  } catch (e) {
    warning = `plan-defect record not written: ${errText(e)}`;
  }
  return { log: state, defects: found, ...(warning ? { warning } : {}) };
}

// exec-handoff <phaseDir>: {prefix} -> {status: ok, waves: [{k, waveId, ...wave file}], manifest: {exists, value}} or {status:
// failed, reason} naming a malformed wave file (G098).
export function execHandoff(root, phaseDir, { prefix = "" }) {
  const waves = [];
  for (let k = 1; ; k++) {
    const file = `${phaseDir}/handoff/${prefix}w${k}.args.json`;
    let r;
    try { r = files.read(root, file); } catch { break; }
    if (!r.exists) break;
    let h;
    try { h = JSON.parse(r.text); } catch (e) { return { status: "failed", reason: `${file} is not valid handoff JSON: ${e.message}`, code: 1 }; }
    waves.push({ k, waveId: `${prefix}w${k}`, ...h });
  }
  const m = files.read(root, `${phaseDir}/handoff/${prefix}manifest.json`);
  let value = null;
  try { value = m.exists ? JSON.parse(m.text) : null; } catch { value = null; }
  return { status: "ok", waves, manifest: { exists: m.exists, value } };
}

// exec-records <phaseDir>: what the owner and earlier runs left for this run. {runId, plan?, summary?, worktrees?, worktreeDir?}
// -> {grants: [path], ownerAnswers: [answer] | null (not a list), accepted (kit feedback 89: without a plan the open accepted
// checker issues with the plans they affect ("*": every plan) and, with stopFor (plan ids), acceptedStop {reason, accepted, plans,
// options} or null; for a plan the confirmed ones it runs with), and for a plan:
// answers (its halt answers, G055), notes (its
// plan-review notes, G039), and with worktrees: discard (worktrees of cleared halts of earlier runs, kit feedback 75), resume
// (the finished worktree a `halt clear --resume` hands over, kit feedback 79) or resumeNote (why that tree is not used)}.
// The stop of the open accepted issues that affect the plans `ids` about to run (kit feedback 89), or null.
function acceptedStop(N, open, ids) {
  const hits = (x) => (id) => x.affects.includes("*") || x.affects.includes(id);
  const list = open.filter((x) => ids.some(hits(x)));
  if (!list.length) return null;
  const plans = ids.filter((id) => list.some((x) => hits(x)(id)));
  return {
    reason: `checker issues accepted by forceProceed at planning wait for the owner before ${plans.join(", ")} run: ${list.map((x) => `${x.id} ${x.plan ?? "phase"}${x.dimension ? ` [${x.dimension}]` : ""}: ${String(x.text).slice(0, 200)}`).join("; ")}`,
    accepted: list,
    plans,
    options: [`resolve the contract and replan with gsd-plan ${N} (a plan changed since the accept no longer stops), then rerun with the same args`, `ph gsd accepted confirm ${N} --id <AI-n> --reason "<why the plan runs with it>", then rerun with the same args (its executor gets the issue in its brief)`, `ph gsd accepted resolve ${N} --id <AI-n> --reason "<how it was resolved>", then rerun with the same args`],
  };
}

export function execRecords(root, phaseDir, { runId, plan = null, summary = null, worktrees = false, worktreeDir = "", stopFor = null }) {
  const read = (rel) => files.read(root, `${phaseDir}/${rel}`);
  const parsed = (rel, fn, fallback) => {
    try { const r = read(rel); return r.exists ? fn(JSON.parse(r.text)) : fallback; } catch { return fallback; }
  };
  const out = { grants: parsed("grants.json", (x) => x.map((g) => g.path), []) };
  const answers = parsed("owner-answers.json", (x) => x, []);
  out.ownerAnswers = Array.isArray(answers) ? answers.filter((x) => x?.id && ["shared", "request"].includes(x.kind)) : null;
  // Kit feedback 89: the checker issues forceProceed accepted; an unreadable record is an open issue of every plan (fail closed).
  let accepted;
  try { accepted = acceptedStatus(resolveInside(root, phaseDir)); } catch (e) { accepted = [{ id: "accepted-issues.json", status: "open", plan: null, plans: [], dimension: "record", text: `unreadable: ${errText(e)}`, affects: ["*"] }]; }
  const brief = ({ id, plan: p, plans, dimension, text, required_property: property, answer }) => ({ id, plan: p, plans, dimension, ...(property ? { required_property: property } : {}), text, ...(answer ? { owner: answer.reason } : {}) });
  if (plan === null) {
    const open = accepted.filter((x) => x.status === "open").map((x) => ({ ...brief(x), affects: x.affects, reason: x.reason ?? null }));
    if (open.length) out.accepted = open;
    if (stopFor) out.acceptedStop = acceptedStop(phaseNumber(phaseDir), open, stopFor);
    return out;
  }
  out.accepted = accepted.filter((x) => x.status === "confirmed" && x.affects.includes(plan)).map(brief);
  out.answers = parsed("halt-answers.json", (x) => x.filter((h) => h.plan === plan).map(({ halt, answer }) => ({ halt, answer })), []);
  out.notes = parsed("plan-review-notes.json", (x) => x.filter((n) => n.plan === plan).map(({ severity, description }) => ({ severity, description })), []);
  if (!worktrees) return out;
  out.discard = [...new Set(parsed("halt-answers.json", (x) => x.filter((h) => h.plan === plan && h.haltWorktree && h.haltRunId !== runId).map((h) => h.haltWorktree), []))];
  const last = parsed("halt-answers.json", (x) => x.filter((h) => h.plan === plan).at(-1) ?? null, null);
  if (last?.resume && last.haltWorktree) {
    const wt = slashPath(last.haltWorktree);
    const summaryAt = `${wt}/${summary}`;
    let there = false;
    try { there = files.exists(root, [summaryAt]).exists[summaryAt]; } catch { there = false; }
    if (`/${wt}`.includes(`/${slashPath(worktreeDir)}/`) && !wt.includes("..") && there) out.resume = wt;
    else out.resumeNote = `the worktree ${wt} of the cleared halt (--resume) is gone or holds no SUMMARY; the plan is dispatched again`;
  }
  return out;
}

// exec-select <phaseDir> (G075, GSDF-30): the handoff must still describe the plans on disk; then the plans of the run, or the
// route when nothing is left to run. {prefix, handoff, manifest, plans (phase-plan-index), state, filter: {plans, wave,
// gapsOnly}, verification?: {code, status}} -> {status: ok | stop (with {stop: {status, extra}}) | verification (call again with
// the verification status), warnings}.
export function execSelect(phaseDir, { prefix = "", handoff = [], manifest = null, plans = [], state = { plans: {} }, filter = {}, verification = null }) {
  const N = phaseNumber(phaseDir);
  const info = (id) => plans.find((p) => p.id === id) ?? {};
  const tracked = (id) => state.plans?.[id]?.tracked === true;
  const warnings = [];
  const stop = (status, extra) => ({ status: "stop", warnings, stop: { status, extra } });
  if (manifest?.exists) {
    const m = manifest.value;
    if (!m || m.waves !== handoff.length || handoff.some((w) => w.planRevision !== m.planRevision)) return stop("refused", { reason: `the handoff in ${phaseDir}/handoff/ is incomplete or mixed (${handoff.length} wave files, the manifest names ${m?.waves ?? "none"}); regenerate it with gsd-plan` });
  } else warnings.push(`${phaseDir}/handoff/ has no ${prefix}manifest.json (an older kit); the wave set is not checked`);
  // A plan edited, added or deleted after the handoff would run with stale owns, verify commands and plan set.
  const stale = [];
  for (const t of handoff.flatMap((w) => w.tasks).filter((x) => !tracked(x.plan))) {
    const p = plans.find((x) => x.id === t.plan);
    if (!p) stale.push(`${t.plan} no longer exists`);
    else if (p.plan_hash && t.planHash && p.plan_hash !== t.planHash) stale.push(`${t.plan} changed after the handoff`);
  }
  if (!prefix) for (const p of plans) if (p.plan_hash && !p.has_summary && p.gap_closure !== true && !handoff.some((w) => w.tasks.some((t) => t.plan === p.id))) stale.push(`${p.id} is in no handoff wave`);
  if (stale.length) return stop("refused", { reason: `the handoff does not match the plans: ${stale.join("; ")}; regenerate it with gsd-plan`, stale });
  if (filter.gapsOnly) {
    const lacking = plans.filter((p) => p.gap_closure === undefined || p.gap_closure === null).map((p) => p.id);
    if (lacking.length) return stop("refused", { reason: `--gaps-only needs a gap_closure key in every plan; missing in ${lacking.join(", ")}` });
  }
  const wave = filter.wave ?? null;
  const selected = (t) => (!filter.plans || filter.plans.includes(t.plan)) && (!filter.gapsOnly || info(t.plan).gap_closure === true);
  if (wave !== null) {
    const lower = handoff.filter((w) => w.k < wave).flatMap((w) => w.tasks).filter((t) => !tracked(t.plan)).map((t) => t.plan);
    if (lower.length) return stop("refused", { reason: `wave ${wave} refused: lower waves have incomplete plans ${[...new Set(lower)].join(", ")}` });
  }
  const wanted = handoff.filter((w) => wave === null || w.k === wave).flatMap((w) => w.tasks).filter(selected);
  const open = wanted.filter((t) => !tracked(t.plan));
  const pending = open.filter((t) => !info(t.plan).has_summary);
  if (pending.length !== open.length || pending.some((t) => info(t.plan).ready)) return { status: "ok", warnings };
  if ((filter.plans || wave !== null || filter.gapsOnly) && !wanted.length) return stop("nothing-to-run", { route: "none", reason: "no matching plans" });
  const stuck = plans.filter((p) => p.halted || (p.blocked_by ?? []).length);
  if (pending.length && stuck.length) return stop("nothing-to-run", { route: "stuck", reason: `phase stuck, resolve the halt: ${stuck.map((p) => p.id).join(", ")}; record the answer with ph gsd halt clear ${N} --plan <id> --reason <answer>, then rerun` });
  if (pending.length) return stop("nothing-to-run", { route: "waiting", reason: "plans not ready yet" });
  if (!verification) return { status: "verification", warnings };
  const vs = verification.code === 66 ? "missing" : verification.status;
  if (vs === "missing" || vs === "stale" || verification.code === 1) return stop("nothing-to-run", { route: "verify", reason: `all plans committed; verification ${vs ?? "invalid"}: run gsd-verify` });
  if (vs === "passed") return stop("nothing-to-run", { route: "complete", reason: "verification passed: run phase complete" });
  return stop("nothing-to-run", { route: vs === "gaps_found" ? "plan-gaps" : "uat", reason: `verification ${vs}` });
}

// exec-branch <phaseDir> (GSDF-54, gsd.branching phase): switches to gsd/phase-<N>-<slug>, created from origin/<default> (not
// HEAD) when missing. -> {status: ok, switched, branch, base?} or {status: failed, reason} (nothing created).
export function execBranch(root, phaseDir) {
  const run = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
  };
  const branch = `gsd/phase-${phaseNumber(phaseDir)}-${phaseDir.split("/").pop().replace(/^[\d.]+-/, "")}`;
  if (run("rev-parse", "--abbrev-ref", "HEAD").stdout.trim() === branch) return { status: "ok", switched: false, branch };
  const base = run("symbolic-ref", "--short", "refs/remotes/origin/HEAD").stdout.trim().replace(/^origin\//, "") || "main";
  const fetched = run("fetch", "origin", base).code === 0;
  const hasRef = run("rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`).code === 0;
  if (!fetched && !hasRef) return { status: "failed", reason: `branching phase: fetch of origin/${base} failed and no local origin/${base}; no branch created`, code: 1 };
  const exists = run("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).code === 0;
  const sw = exists ? run("switch", branch) : run("switch", "--no-track", "-c", branch, `origin/${base}`);
  if (sw.code !== 0) return { status: "failed", reason: `could not switch to ${branch}: ${sw.stderr.split(/\r?\n/)[0]}`, code: 1 };
  return { status: "ok", switched: true, branch, base };
}

// exec-route: the requests and kit notes of an agent reply. {from, reply, plans: [{id, owns, summary}], known (the run's notes)} ->
// {notes (kit feedback 79: kitNotes and requests for the kit-feedback document, none twice), routes: [{plan (the plan owning the path most specifically, G072,
// or null), q (the request as state-request and state-shared take it)}], asked: [{...request, path, plan}]}.
export function execRoute(root, { from = null, reply = null, plans = [], known = [] }) {
  const res = reply ?? {};
  const kitAsks = (res.requests ?? []).filter((rq) => rq && typeof rq.path === "string" && isKitDoc(rq.path));
  const all = [...(Array.isArray(res.kitNotes) ? res.kitNotes.filter((n) => typeof n === "string" && n.trim()).map((n) => ({ plan: from, note: n.trim() })) : []), ...kitAsks.map((rq) => ({ plan: from, note: String(rq.change ?? rq.reason ?? "").trim(), from: "request", path: slashPath(rq.path) }))];
  // A note the run already has (`known`, the same plan and text) is not repeated.
  const notes = all.filter((n, i) => ![...known, ...all.slice(0, i)].some((k) => k.plan === n.plan && k.note === n.note));
  const list = (res.requests ?? []).filter((rq) => rq && typeof rq.path === "string" && rq.path.trim() && !isKitDoc(rq.path)).map((rq) => ({ ...rq, path: slashPath(rq.path) }));
  let owners = {};
  if (list.length) try { owners = ownersOf(root, { paths: list.map((rq) => rq.path), plans }).owners; } catch { owners = {}; }
  const ownerOf = (rq) => (owners[rq.path] ?? [])[0] ?? null;
  const routes = list.map((rq) => ({ plan: ownerOf(rq), q: { from, path: rq.path, change: rq.change ?? "", ...(rq.reason !== undefined ? { reason: rq.reason } : {}), ...(rq.via !== undefined ? { via: rq.via } : {}), ...(rq.outputs !== undefined ? { outputs: rq.outputs } : {}) } }));
  return { notes, routes, asked: list.map((rq) => ({ ...rq, plan: ownerOf(rq) })) };
}

const PATH_TOKEN = /[\w.@-]+(?:\/[\w.@-]+)+/g;
// A task that waits only for requests the run routed: it names them in blockedBy, or (partial) its evidence names at least one
// of them and no other path. Returns the request paths, or null.
function waitsOnRouted(x, routed, pending) {
  if (!pending || !routed.size) return null;
  const named = (Array.isArray(x.blockedBy) ? x.blockedBy : []).map(slashPath).filter(Boolean);
  if (named.length) return named.every((p) => routed.has(p)) ? named : null;
  if (x.status !== "partial") return null;
  const text = slashPath(String(x.evidence ?? ""));
  const hit = [...routed].filter((p) => text.includes(p) || text.includes(p.split("/").pop()));
  if (!hit.length) return null;
  const others = (text.match(PATH_TOKEN) ?? []).filter((tok) => ![...routed].some((p) => p.endsWith(tok) || tok.endsWith(p)));
  return others.length ? null : hit;
}

// Kit feedback 109 F3: an unverified last edit is the next gate's to check, not an owner decision by itself. A Rule 4
// deviation, a checkpoint, or a reply that asks for an owner decision still is one.
const UNVERIFIED_MARK = /\[UNVERIFIED\]|\bUNVERIFIED\b/;
const EXPLICIT_ASK = /\b(?:owner decision|needs-owner|needs owner|rule\s*4|checkpoint)\b/i;
const replyText = (x) => `${x?.note ?? ""}\n${x?.evidence ?? ""}`;
export const explicitOwnerAsk = (x) => Boolean(x && typeof x === "object" && (Number(x.rule) === 4 || x.kind === "checkpoint" || EXPLICIT_ASK.test(replyText(x))));
export const unverifiedEdit = (x) => Boolean(x && typeof x === "object" && (x.lastEdit === "unverified" || UNVERIFIED_MARK.test(replyText(x))));
export const unverifiedOnly = (x) => unverifiedEdit(x) && !explicitOwnerAsk(x);

// exec-fix-allowance (kit feedback 109 F2): runs of the failing files a fixer may spend. {attempts (gsd.fixer.max_build_attempts),
// files} -> {runs: at least files.length + 2, and at least attempts, files}. A run of anything else does not count.
export function fixAllowance({ attempts, files } = {}) {
  const n = Array.isArray(files) ? files.filter((f) => typeof f === "string" && f.trim()).length : 0;
  const cap = Number(attempts);
  return { runs: Math.max(Number.isFinite(cap) ? cap : 0, n + 2), files: n };
}

// exec-fix-reply: how a fixer-schema reply treats its last edit. {reply} -> {unverified, explicit, unverifiedOnly}.
export const execFixReply = ({ reply } = {}) => ({ unverified: unverifiedEdit(reply), explicit: explicitOwnerAsk(reply), unverifiedOnly: unverifiedOnly(reply) });

// exec-verdict: the verdict on an executor reply. {reply, plan, requests, shared (the run's state), pending
// (gsd.pending_request_tasks), hasSummary?, taskCount?, summary?} -> {decision (Rule 4, a checkpoint, a partial, blocked or
// pending-request task that names no request this plan routed), pending: [tasks accepted because they wait only for routed
// requests, kit feedback 79], halt?: {why, decision?}}. With hasSummary also G058 (one result per plan task; a skipped task is
// no finished plan) and the SUMMARY. Kit feedback 109 F3: a partial or blocked task whose evidence is only an unverified edit
// is not a decision.
export function execVerdict({ reply, plan = null, requests = {}, shared = [], pending = true, ...checks }) {
  const res = reply ?? {};
  const out = { decision: null, pending: [] };
  const routed = plan ? new Set([...Object.values(requests).flat(), ...shared].filter((q) => q.from === plan && q.path).map((q) => slashPath(q.path))) : new Set();
  const dev = (res.deviations ?? []).find((x) => Number(x.rule) === 4 || x.kind === "checkpoint");
  if (dev) out.decision = dev;
  else for (const x of res.taskResults ?? []) {
    if (x.status !== "partial" && x.status !== "blocked" && x.status !== "pending-request") continue;
    if ((x.status === "partial" || x.status === "blocked") && unverifiedOnly(x)) continue;
    const on = x.status === "blocked" ? null : waitsOnRouted(x, routed, pending);
    if (on) {
      out.pending.push({ plan, task: x.task, blockedBy: on, via: Array.isArray(x.blockedBy) && x.blockedBy.length ? "blockedBy" : "evidence" });
      continue;
    }
    out.decision = x.status === "pending-request" ? { ...x, note: `task ${x.task} is pending-request but names no request this plan routed` } : x;
    break;
  }
  const d = out.decision;
  if (d) return { ...out, halt: { why: `owner decision needed: ${d.note ?? d.evidence ?? d.status}`, decision: d } };
  if (!Object.hasOwn(checks, "hasSummary")) return out;
  const want = checks.taskCount;
  const got = (res.taskResults ?? []).length;
  if (!got || (Number.isInteger(want) && got < want)) return { ...out, halt: { why: `executor reported ${got} task result(s)${Number.isInteger(want) ? ` for ${want} task(s)` : ""}` } };
  const skippedTask = res.taskResults.find((x) => x.status === "skipped");
  if (skippedTask) return { ...out, halt: { why: `owner decision needed: task ${skippedTask.task} was skipped${skippedTask.evidence ? ` (${skippedTask.evidence})` : ""}`, decision: skippedTask } };
  if (!checks.hasSummary) return { ...out, halt: { why: `no SUMMARY at ${checks.summary}` } };
  return out;
}

// exec-fixers: who fixes a red gate. {gate, plans (ids of the round), worktreeMode, trees (plans with an executor worktree),
// verifies (the composition's gsd.fixer_verifies_itself)} -> {plans: [{id, kind: executor | fixer (a plan resumed without its
// worktree is fixed in the main tree), failures, tests?}], placed (the failures no plan owns that name files, G064), files (theirs,
// for the integration fixer), tests, fileless (failures naming no file)}. Kit feedback 102 F3: tests are the test files of a
// fixer's failures it may run itself (the gate's failure tests); none when it does not verify itself.
export function execFixers({ gate, plans = [], worktreeMode = false, trees = [], verifies = false }) {
  const placed = (gate.unplaced ?? []).filter((f) => (f.files ?? []).length);
  const testsOf = (failures) => (verifies ? [...new Set(failures.flatMap((f) => f.tests ?? []))] : []);
  const withTests = (failures) => (testsOf(failures).length ? { tests: testsOf(failures) } : {});
  return {
    plans: Object.entries(gate.byPlan ?? {}).filter(([id]) => plans.includes(id)).map(([id, failures]) => ({ id, kind: worktreeMode && !trees.includes(id) ? "fixer" : "executor", failures, ...withTests(failures) })),
    placed,
    files: [...new Set(placed.flatMap((f) => f.files ?? []))],
    tests: testsOf(placed),
    fileless: (gate.unplaced ?? []).filter((f) => !(f.files ?? []).length).length,
  };
}

// exec-round-end: the end of a fix round on its fresh gate. kit-feedback 51: an owner decision of a fixer stops the round only
// while its plan still fails (stuck); G066: an unresolved or empty fix stops it while that fixer's own failures remain (still);
// the stall rule: two rounds in a row whose failure count did not drop stop the run (stalled). {decisions, soft, gate, done,
// stall: {prev, noDrop}} -> {logs, stuck?: {reason, decision}, still?: reason, stall, stalled}.
export function execRoundEnd({ decisions = [], soft = [], gate, done = false, stall = {} }) {
  const fails = (id) => (gate.byPlan?.[id] ?? []).length > 0;
  const said = (d) => d.decision.note ?? d.decision.evidence ?? d.decision.status;
  const stuck = decisions.filter((d) => fails(d.id));
  const logs = decisions.filter((d) => !fails(d.id)).map((d) => `fix of ${d.id} reported "${said(d)}", but its failures are gone after the transfer and the rerun; not an owner decision`);
  if (stuck.length) return { logs, stuck: { reason: stuck.map((d) => `owner decision needed in the fix of ${d.id}: ${said(d)}`).join("; "), decision: stuck[0].decision } };
  const still = soft.filter((s) => (s.id ? fails(s.id) : (gate.unplaced ?? []).some((f) => (f.files ?? []).length)));
  if (!done && still.length) return { logs, still: still.map((s) => s.why).join("; ") };
  const noDrop = gate.failureCount >= stall.prev ? (stall.noDrop ?? 0) + 1 : 0;
  return { logs, stall: { prev: gate.failureCount, noDrop }, stalled: !done && noDrop >= 2 };
}

// exec-verdicts: the finding verifiers' answers (G081: each verdict keeps its evidence). {seen (null at first), ids (the findings
// asked), reply, second (the second verifier decides only what the first left uncertain and adds its evidence), metrics (kit
// feedback 64: the plan-catchable tag of the verifier whose verdict counts)} -> {seen}; with final: {findings: [{verdict,
// verdictEvidence, planCatchable?, catchReason?}]} in the order of ids (no answer: unverified).
export function execVerdicts({ seen = null, ids = [], reply = null, second = false, metrics = false, final = false }) {
  const s = seen ?? { verdicts: {}, evidence: {}, catchable: {} };
  const keepCatch = (v) => { if (metrics && ["yes", "no"].includes(v.plan_catchable)) s.catchable[v.id] = { tag: v.plan_catchable, reason: String(v.catch_reason ?? "").slice(0, 300) }; };
  if (final) {
    return {
      seen: s,
      findings: ids.map((id) => {
        const verdict = s.verdicts[id] ?? "unverified";
        return { verdict, verdictEvidence: s.evidence[id] ?? (s.verdicts[id] ? "" : "no verifier answered"), ...(metrics && verdict === "confirmed" ? { planCatchable: s.catchable[id]?.tag ?? null, catchReason: s.catchable[id]?.reason ?? "" } : {}) };
      }),
    };
  }
  for (const v of reply?.verdicts ?? []) {
    if (!ids.includes(v.id)) continue;
    if (second) {
      if (v.verdict !== "uncertain") { s.verdicts[v.id] = v.verdict; keepCatch(v); }
      s.evidence[v.id] = [s.evidence[v.id], v.evidence].filter(Boolean).join(" | second verifier: ");
    } else {
      s.verdicts[v.id] = v.verdict;
      s.evidence[v.id] = v.evidence ?? "";
      keepCatch(v);
    }
  }
  return { seen: s };
}

const globRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
// The code-review lenses of adapter.review_lenses that apply to the scope; none: the correctness lens.
function lensesFor(lenses, scope) {
  const list = lenses.filter((l) => (l.stage ?? "code") === "code" && (!l.applies_to?.length || scope.some((f) => l.applies_to.some((gl) => globRe(gl).test(f)))));
  return list.length ? list.map((l) => ({ name: l.name, text: l.text })) : [{ name: "correctness", text: "Follow the lens text in .agents/workflows/lenses/correctness.md." }];
}
const rangeText = (ranges) => (ranges === "all" ? "all (new file)" : Array.isArray(ranges) ? ranges.map(([s, e]) => (s === e ? `${s}` : `${s}-${e}`)).join(", ") : "unknown");

// exec-review <phaseDir> (GSDF-92, G080, kit-feedback 33/34): one plan's review before the reviewers run. {waveId, plan, planHash,
// summarySha, files, filterExplicit, summary, evaluation, lenses (adapter.review_lenses), reviewers ([model, effort]), codeOnly}
// -> {log (review-scope), record (the new record: scope, lenses, key, stamp), and either replay: resolution (the recorded
// findings were fixed once: only the resolution check runs again) | review (the code is unchanged: the record is reused, openAt
// the findings to verify again) with prior, or for a scope to review: changed (lines per file), changedText, lensText}.
export function execReview(root, phaseDir, { waveId, plan, planHash = null, summarySha = null, files: explicit, filterExplicit = false, summary, evaluation = [], lenses = [], reviewers = [], codeOnly = false }) {
  let sc = {};
  try { const { code, ...rest } = reviewScope(root, phaseDir, { plan, files: explicit, filterExplicit, summary, evaluation }); sc = rest; } catch { sc = {}; }
  const scope = sc.scope ?? [];
  const lensList = lensesFor(lenses, scope);
  const key = { plan: planHash, summary: summarySha, lenses: lensList.map((l) => l.name), reviewers };
  const record = { plan, scope, excluded: sc.excluded ?? [], lenses: lensList.map((l) => l.name), codeOnly, findings: [], resolution: [], key, stamp: null, fixPass: 0 };
  if (scope.length) try { record.stamp = digest(root, { files: scope }).hash ?? "none"; } catch { record.stamp = "none"; }
  let prior = null;
  try { const r = files.read(root, `${phaseDir}/review/${waveId}-${plan}.json`); prior = r.exists ? JSON.parse(r.text) : null; } catch { prior = null; }
  const out = { status: "ok", log: sc.log ?? [], record };
  if (prior && JSON.stringify(prior.key) === JSON.stringify(key) && JSON.stringify(prior.scope) === JSON.stringify(record.scope)) {
    const openAt = prior.findings.map((f, i) => (f.status === "gated" && !["confirmed", "refuted"].includes(f.verdict) ? i : -1)).filter((i) => i >= 0);
    if (!openAt.length && (prior.fixPass ?? 0) >= 1) return { ...out, replay: "resolution", prior };
    if (prior.stamp === record.stamp && !(prior.fixPass ?? 0)) return { ...out, replay: "review", prior, openAt };
  }
  if (!scope.length) return out;
  let changed = {};
  try { changed = changedLines(root, phaseDir, { plan, files: scope }).files ?? {}; } catch { changed = {}; }
  return { ...out, changed, changedText: scope.map((p) => `- ${p}: ${rangeText(changed[p])}`).join("\n"), lensText: lensList.map((l) => `- ${l.name}: ${l.text}`).join("\n") };
}

// Pre-existing (owner decision 2026-10-22, after the Claude Code team's review write-up, where most repeat findings sat in code
// the change never touched): a finding whose line lies outside the lines the plan changed, by more than PRE_EXISTING_MARGIN, and
// that the reviewer does not say the change caused, is recorded and deferred, never blocking.
const PRE_EXISTING_MARGIN = 3;
const preExisting = (f, changed) => {
  const ranges = changed[f.file];
  if (!Array.isArray(ranges) || !Number.isInteger(f.line) || f.line < 1 || f.introduced === true) return false;
  return !ranges.some(([s, e]) => f.line >= s - PRE_EXISTING_MARGIN && f.line <= e + PRE_EXISTING_MARGIN);
};
const DEFER_REASON = { downgraded: "missing trigger, confidence < 80 or theoretical", deferred: "non-blocking severity", "pre-existing": "outside the lines this plan changed (pre-existing)" };
// G056: a blocking (critical or high) finding gates only with a trigger, confidence >= 80 and a likelihood other than theoretical.
const gateFinding = (f) => {
  const high = ["critical", "high"].includes(String(f.severity).toLowerCase());
  if (!high) return "deferred";
  return String(f.trigger ?? "").trim() && Number(f.confidence) >= 80 && String(f.likelihood).toLowerCase() !== "theoretical" ? "gated" : "downgraded";
};

// exec-findings: the reviewers' findings of one plan. {plan, replies: [[finding]] (one list per reviewer; ids of reviewer k > 1
// get R<k>-), changed} -> {unknown (CR-GSF-17: findings of an unknown severity, a blocking error), unknownSeverities, expected}
// or {unknown: [], findings (each with status gated | downgraded | deferred | pre-existing and verdict null), deferredLines
// (deferred.md), counts}.
export function execFindings({ plan, replies = [], changed = {} }) {
  const found = replies.flatMap((list, k) => (list ?? []).map((f, i) => ({ ...f, id: `${k ? `R${k + 1}-` : ""}${f.id ?? `${plan}-F${i + 1}`}` })));
  const unknown = found.filter((f) => !SEVERITIES.includes(String(f.severity).toLowerCase()));
  if (unknown.length) return { unknown, unknownSeverities: [...new Set(unknown.map((f) => f.severity))], expected: SEVERITIES.join("|") };
  const findings = found.map((f) => {
    const kept = { id: f.id, severity: String(f.severity).toLowerCase(), trigger: f.trigger ?? "", likelihood: f.likelihood ?? "", confidence: Number(f.confidence ?? 0), impact: f.impact ?? "", file: f.file ?? "", line: f.line ?? null, description: f.description ?? "", introduced: typeof f.introduced === "boolean" ? f.introduced : null, class: f.class ?? "", instances: Array.isArray(f.instances) ? f.instances.filter((x) => x && typeof x.file === "string") : [] };
    return { ...kept, status: preExisting(kept, changed) ? "pre-existing" : gateFinding(f), verdict: null };
  });
  const deferred = findings.filter((f) => f.status !== "gated");
  return {
    unknown: [],
    findings,
    deferredLines: deferred.map((f) => `- ${f.id} (${f.severity}, ${f.status}) plan ${plan} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.description} [reason: ${DEFER_REASON[f.status]}]`),
    counts: { deferred: deferred.length, downgraded: deferred.filter((f) => f.status === "downgraded").length, preExisting: deferred.filter((f) => f.status === "pre-existing").length },
  };
}

// exec-pause (kit feedback 88): the paused result of a stop at a wave boundary. {by: stopAfterWave | stop-request, nextWave,
// stopAfterWave, stop (the stop request seen), run (the run id), waves: [{k, plans}], state} -> {reason, pausedAt: {by, afterWave
// (the last wave whose plans, and those of every wave before it, are tracked or committed), nextWave}, answer}.
export function execPause({ by, nextWave, stopAfterWave = null, stop = null, run = null, waves = [], state = { plans: {} } }) {
  let afterWave = null;
  for (const w of waves) {
    if (w.plans.some((id) => state.plans?.[id]?.tracked !== true && state.plans?.[id]?.commit === undefined)) break;
    afterWave = w.k;
  }
  const reached = afterWave === null ? "before its first wave" : `after wave ${afterWave} (committed)`;
  const reason = by === "stopAfterWave" ? `stopAfterWave ${stopAfterWave}: paused ${reached}` : `stop requested${stop?.reason ? ` (${stop.reason})` : ""}: paused ${reached}`;
  const command = by === "stopAfterWave"
    ? `rerun with the same args without stopAfterWave (or a higher one); with stopAfterWave ${stopAfterWave} the run pauses again at once. The committed waves are tracked; the run goes on with wave ${nextWave}`
    : `rerun with the same args${run ? ` (or ph workflow --resume ${run})` : ""}; the committed waves are tracked and the run goes on with wave ${nextWave}`;
  return { reason, pausedAt: { by, afterWave, nextWave }, answer: { verb: "rerun", command } };
}

// exec-shared-before <phaseDir> (kit feedback 95 F1): the shared changes made before the executors of a wave start. {waveId, plans
// (every plan of the handoff: {id, owns, summary})} -> {ids, later}: ids are the declared changes of the wave in the execute state
// (their key starts with `<waveId>:`) not applied yet whose file and outputs no plan without a commit owns and whose lines for
// that file do not wait for the plan's code (gsd/shared-changes.mjs); later names the declared ones left to the turn after the
// code, with why.
export function execSharedBefore(root, phaseDir, { waveId, plans = [] }) {
  const st = readState(root, phaseDir);
  const open = plans.filter((p) => st.plans[p.id]?.commit === undefined);
  const mine = st.shared.filter((s) => !s.applied && typeof s.key === "string" && s.key.startsWith(`${waveId}:`));
  const files = [...new Set(mine.flatMap((s) => [s.path, ...(s.outputs ?? [])]).filter(Boolean))];
  let owners = {};
  if (files.length) try { owners = ownersOf(root, { paths: files, plans: open }).owners; } catch { owners = Object.fromEntries(files.map((f) => [f, ["?"]])); }
  const ids = [];
  const later = [];
  for (const s of mine) {
    const owned = [s.path, ...(s.outputs ?? [])].filter(Boolean).flatMap((f) => owners[f] ?? []);
    if (owned.length) later.push({ id: s.id, why: `an open plan owns its file (${[...new Set(owned)].join(", ")})` });
    else if (s.path && waitsForCode(s.change, s.path)) later.push({ id: s.id, why: "its text waits for the plan's code" });
    else ids.push(s.id);
  }
  return { ids, later };
}

// The outside text of a shared-change fixer names a failure unless it says there is none ("none", "n/a", "No failures outside
// the shared files were observed") without naming a file or a "but".
const NO_FAILURE = /^\s*(?:none\b|n\/a\b|nothing\b|no\b)/i;
const namesFailure = (text) => {
  const t = String(text ?? "").trim();
  return Boolean(t) && !(NO_FAILURE.test(t) && !/\bbut\b/i.test(t) && !(t.replace(/\bn\/a\b/gi, "").match(PATH_TOKEN) ?? []).length);
};
// exec-shared-reply (kit feedback 82, 96 b): the shared-change fixer's reply. {waveId, open: [{id}] (the changes asked, in index
// order), reply} -> {made: [ids reported present (per change, or every one when status fixed has no list)], logs}.
export function execSharedReply({ waveId, open = [], reply = {} }) {
  const rep = reply ?? {};
  const entries = Array.isArray(rep.changes) && rep.changes.length ? rep.changes : null;
  const made = open.filter((s, i) => (entries ? entries.some((c) => Number(c?.index) === i && c.applied === true) : rep.status === "fixed")).map((s) => s.id);
  const logs = [];
  if (namesFailure(rep.outside)) logs.push(`shared ${waveId}: the fixer saw a failure outside the shared files, left to the gate: ${String(rep.outside).trim().slice(0, 300)}`);
  if (made.length && rep.status !== "fixed") logs.push(`shared ${waveId}: ${made.length} of ${open.length} change(s) reported present although the fixer answered ${rep.status}; the gate verifies them`);
  return { made, logs };
}

// exec-groups (GSDF-40): plans of a wave sharing a files_modified entry never run at the same time; a later one moves to a later
// group. {tasks: [{plan, files}]} -> {groups: [[index into tasks]], defects: [plans moved (a planning defect)]}.
export function execGroups({ tasks = [] }) {
  const groups = [];
  const defects = [];
  tasks.forEach((t, i) => {
    const mine = new Set(t.files ?? []);
    let gi = 0;
    while (groups[gi]?.some((j) => (tasks[j].files ?? []).some((f) => mine.has(f)))) gi++;
    if (gi > 0) defects.push(t.plan);
    (groups[gi] ??= []).push(i);
  });
  return { groups, defects };
}
