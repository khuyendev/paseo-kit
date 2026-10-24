// The kit step library of a phase execution (THIN.md stage 3 S1, kit feedback 87): the steps the execute schedules (waves,
// graph, batch) share, once. The engine evaluates `executeSteps` inside each script context on top of the kit helpers and
// the runtime (as kitHelpers in script.mjs: only its parameters and JavaScript built-ins, its values belong to the script's
// realm) and gives compositions the global `executeSteps(run)`. `run` is {phaseDir, args (exec-args), cfg, setup
// (exec-setup), policy}: the composition reads its policies (docs/INTERFACES.md 4.3; no kit module reads them) and passes
// the values. The returned object is the run: its record, `result`, `owner`, `ANSWER` and the steps. A step never decides a
// stop for the composition: it returns it (`{stop}` or the stop result, always with its `answer`), and the composition
// returns it or goes on.
export function executeSteps(kit, run) {
  const { shell, agent, parallel, log, phase, runId, flow, gsd, call: rawCall, renderPrompt, digestLine, policyBlock, fatal, leaseText, fileSha, pool, serialize, turnLock, FLOW } = kit;
  // policy: pending (gsd.pending_request_tasks), requestCheck, reviewLimit and reviewers (gsd.code_review), reviewDepth,
  // fixer {verifies, attempts, minutes}, smokeTriggers, protectedBranches (gsd.branching none + gsd.protected_branches).
  const { phaseDir, args: a, cfg, setup: S, policy: P } = run;
  const { N, nn, prefix, mode: execMode, worktreeMode, metricsOn, schemas } = S;
  const cmds = cfg.adapter.commands;
  const pendingOn = P.pending;

  // GSDF-03: bind judgments and repairs to the files and owned paths the call judges (`judges`) and to the adapter settings.
  async function call(prompt, { judges = {}, ...opts } = {}) {
    const identity = await flow(["digest"], judges);
    if (identity.code !== 0 || !identity.json?.hash) throw new Error("agent input digest unavailable");
    const researchPolicy = prompt.includes("<research_input_policy>") ? "" : policyBlock(null);
    prompt = [prompt, researchPolicy, digestLine("stage", identity.json.hash)].filter(Boolean).join("\n\n");
    return rawCall(prompt, opts);
  }

  const planPath = (id) => `${phaseDir}/${id}-PLAN.md`;
  const haltPath = (id) => `${phaseDir}/${id}-HALT.json`;
  const PROGRESS = `${phaseDir}/execute-progress.json`;
  const agentFor = (role, fallback) => cfg.adapter.agents?.[role] ?? fallback;
  // The run's record, all of it in the result: the tracked waves; shared changes and cross-plan requests (views of the state
  // the last state-* verb answered with, G074, G089); skipped plans; events; executor worktrees (kit feedback 75: discarded
  // after their plan's commit, kept with the reason); tasks accepted as pending-request and kit notes (79); requests closed
  // without a reply and the owner's answers taken (85, 83); hand edits (68); paths reported, never committed (77, 80); refused
  // state writes (91 F3).
  const [waveResults, warnings, skipped, events, pendingTasks, kitNotes, discarded, requestsClosed, ownerAnswers] = [[], [], [], [], [], [], [], [], []];
  const [worktrees, keptTrees, seeds] = [{}, {}, {}];
  let sharedChanges = [];
  let pendingRequests = {};
  let handEdits = null;
  const reported = { outsideRoots: new Set(), eolOnly: new Set() };
  const ev = (e) => { events.push(e); log(`event ${e}`); };
  const treeReport = (left = Object.entries(worktrees).filter(([plan]) => !discarded.includes(plan)).map(([plan, path]) => ({ plan, path, ...(keptTrees[plan] ? { why: keptTrees[plan] } : {}) }))) => (discarded.length || left.length ? { discarded, kept: left } : null);
  const result = (status, extra = {}) => ({ status, phaseDir, mode: execMode, isolation: cfg.gsd.isolation, waves: waveResults, sharedChanges, ...(Object.keys(pendingRequests).length ? { requests: pendingRequests } : {}), ...(skipped.length ? { skipped } : {}), ...(treeReport() ? { worktrees: treeReport() } : {}), ...(handEdits ? { handEdits } : {}), ...(reported.outsideRoots.size ? { outsideRoots: [...reported.outsideRoots] } : {}), ...(reported.eolOnly.size ? { eolOnly: [...reported.eolOnly] } : {}), ...(pendingTasks.some((p) => !p.commit) ? { pendingRequestTasks: pendingTasks.filter((p) => !p.commit) } : {}), ...(pendingTasks.some((p) => p.commit) ? { pendingSettled: pendingTasks.filter((p) => p.commit) } : {}), ...(kitNotes.length ? { kitNotes } : {}), ...(ownerAnswers.length ? { ownerAnswers } : {}), ...(requestsClosed.length ? { requestsClosed } : {}), ...(warnings.length ? { warnings } : {}), events, ...extra });
  // Kit feedback 87 C1: a red gate whose failures hold the gate's check-weakening step stops at stage Checks with its answers (ph gsd allow).
  const owner = (stage, reason, extra = {}) => {
    const ck = stage === "Gate" ? (extra.failures ?? []).find((f) => f.needsOwner?.stage === "Checks") : null;
    return ck ? result("needs-owner", { ...extra, stage: "Checks", reason: `${ck.needsOwner.reason} (${reason})`, options: ck.needsOwner.options, answer: { verb: "allow", command: `ph gsd allow ${N} --path <file> --reason <why the check may change>` } }) : result("needs-owner", { stage, reason, ...extra });
  };
  // Kit feedback 83 F3, 87 (B3): every needs-owner stop names what answers it, `answer: {verb, command}`, and a rerun with the same
  // args follows the answer. halt.clear, shared.clear, request.clear and grant record the owner's answer (owner-answers.json, grants);
  // fix-and-rerun is a stop the rerun decides again from the tree; rerun is a call that could not run (quota, transport) or a record
  // the rerun repairs; workflow names the workflow that answers it; gate is the answer the resume-gate verb names (94 F3: commit.adopt
  // for an owner commit, ph gsd commit adopt, or fix-and-rerun with the action).
  const ANSWER = {
    halt: (plan = "<id>") => ({ verb: "halt.clear", command: `ph gsd halt clear ${N} --plan ${plan} --reason <answer>` }),
    // Kit feedback 106 F2: a fix-round transfer refusal. The fixer worktree holds the finished fix; --resume transfers it
    // after the problem the refusal names is answered.
    haltResume: () => ({ verb: "halt.clear", command: `ph gsd halt clear ${N} --plan <id> --resume --reason <answer>` }),
    shared: (wave = "<wave>") => ({ verb: "shared.clear", command: `ph gsd shared clear ${N} ${wave} [--path <file>] --reason <what you did or accept>` }),
    request: (plan = "<id>", file = "<file>") => ({ verb: "request.clear", command: `ph gsd request clear ${N} --plan ${plan} --path ${file} --reason <why it is satisfied>` }),
    grant: (file, plan) => ({ verb: "grant", command: `ph gsd grant ${N} --path ${file}${plan ? ` --plan ${plan}` : ""}` }),
    tree: (what) => ({ verb: "fix-and-rerun", command: what }),
    rerun: (what = "rerun with the same args") => ({ verb: "rerun", command: what }),
    workflow: (what) => ({ verb: "workflow", command: what }),
    gate: (answer) => answer ?? ANSWER.tree("close out, re-execute or set aside what the gate names, then rerun with the same args"),
    accepted: (id = "<AI-n>") => ({ verb: "accepted.confirm", command: `ph gsd accepted confirm ${N} --id ${id} --reason <why the plan may run with it>` }),
  };
  const GATE_RED = ANSWER.tree("fix the failing files by hand (or give a fixer a file with ph gsd grant), then rerun with the same args");
  const digestOf = async (input) => (await flow(["digest"], input)).json?.hash ?? "none";

  // Kit feedback 64 (gsd.review_metrics, measurement only): every executor halt, red gate and fixer call is recorded with its
  // cause and the plan defects its agents named in prereview/execute-<runId>.json (exec-defect, which also starts from the record
  // of a resumed run), for `ph review-stats --stage`. No decision reads it; writes are chained, a failed one is a warning.
  let defectLog = null;
  let defectWrites = Promise.resolve();
  async function defectEvent(kind, extra = {}, found = {}) {
    if (!metricsOn) return [];
    defectWrites = defectWrites.then(async () => {
      const r = await flow(["exec-defect", phaseDir], { runId, log: defectLog, kind, extra, ...found });
      if (r.json?.log) defectLog = r.json.log;
      if (r.json?.warning) log(`warning: ${r.json.warning}`);
      return r.json?.defects ?? [];
    }).catch((e) => { log(`warning: plan-defect record not written: ${e?.message ?? e}`); return []; });
    return await defectWrites;
  }

  // kit-feedback 66: the main tree has writers (shared-tree executors, transfers, main-tree fixers), which share it, and
  // exclusive users (gates, stray and resume checks, smoke builds, a commit with its suite), which run alone; a waiting request
  // is served before later ones (engine turnLock). In the waves schedule nothing contends, so nothing waits.
  const mainTree = turnLock();
  const writeTree = (fn) => mainTree.shared(fn);
  const aloneOnTree = (fn) => mainTree.exclusive(fn);

  // ---- preconditions (GSDF-40, GSDF-11, GSDF-02, GSDF-39, GSDF-64): one step each, in the composition's order ----
  // kit-feedback 2: execute writes the code root and its phase directory, so it holds the phase lease and the root writer lease
  // for the whole run (unlock() releases both). Planning of another phase may run meanwhile; another plan of this phase, a debug
  // or a quick run may not.
  let phaseLease = null;
  let lease = null;
  async function lock() {
    const guard = await flow(["cwd-guard", cfg.worktree_dir]);
    if (guard.code !== 0) return result("refused", { reason: (guard.json?.problems ?? ["cwd guard failed"]).join("; "), stranded: guard.json?.stranded ?? [], dirty: guard.json?.dirty ?? [] });
    phaseLease = await flow(["lock", `phase-${nn}`, runId, "gsd-execute"]);
    if (phaseLease.code !== 0) return result("refused", { reason: `${leaseText(phaseLease.json, `phase ${N}`)}; execute starts after it ends` });
    lease = await flow(["lock", "debug", runId, "gsd-execute"]);
    if (lease.code !== 0) {
      await flow(["unlock", `phase-${nn}`, phaseLease.json.token]);
      return result("refused", { reason: `${leaseText(lease.json)}; execute starts after it ends` });
    }
    return null;
  }
  async function unlock() {
    await flow(["unlock", "debug", lease.json.token]);
    await flow(["unlock", `phase-${nn}`, phaseLease.json.token]);
  }
  // Kit feedback 68 (gsd.review_metrics, measurement only): the hand edits since the last record are listed in the log and the result.
  async function scanHandEdits() {
    const handScan = cfg.gsd.review_metrics ? await gsd(["hand-edit", "scan", phaseDir]) : null;
    if (handScan?.code === 0 && (handScan.json?.pending?.length || handScan.json?.candidates?.length)) {
      const { pending = [], candidates = [], ask } = handScan.json;
      handEdits = { pending, candidates, ...(ask ? { ask } : {}) };
      for (const e of pending) log(`hand edit ${e.id} (${e.key}): ${e.files.join(", ")}`);
      if (ask) log(`warning: ${pending.length} hand edits since the last record; ${ask}`);
      for (const c of candidates) log(`warning: ${c}`);
    }
    return null;
  }
  async function antiPatterns() {
    const anti = await flow(["anti-patterns", phaseDir]);
    if (anti.code !== 0) return owner("Execute", `blocking anti-patterns need three written answers each in ${anti.json?.answersFile}: ${(anti.json?.unanswered ?? []).join(", ")}; run gsd-discuss ${N} to write them (it reads CONTEXT), or write them with node ${FLOW} write ${anti.json?.answersFile} (JSON on stdin)`, { answer: ANSWER.workflow(`gsd-discuss ${N} writes the answers in ${anti.json?.answersFile}`), rows: anti.json?.unanswered ?? [] });
    return null;
  }
  // The handoff waves and their manifest (exec-handoff); a malformed handoff file is a failed status naming the file (G098).
  const readHandoff = async () => (await flow(["exec-handoff", phaseDir], { prefix })).json ?? {};
  let hr = null;
  let handoff = [];
  let allTasks = [];
  let waves = [];
  let wanted = [];
  let idx = { plans: [] };
  const index = async () => (idx = (await gsd(["phase-plan-index", N])).json ?? { plans: [] });
  const planInfo = (id) => idx.plans.find((p) => p.id === id) ?? {};
  // CR-GSF-02: a SUMMARY ends only the coding stage; a plan is done when its commit is tracked in execute-progress.json. Kit
  // feedback 83 F1, 87: the record is typed and has one writer, the state-* flow verbs, each checking its completion contract; the
  // run decides from the state the last verb answered with (adopt), never from a list of its own. Kit feedback 78: the integration
  // files of a stopped run (shared changes, integration fixers, grants) are part of it.
  let progress = { plans: {} };
  const adopt = (st) => {
    if (!st || (Number.isInteger(progress.rev) && st.rev < progress.rev)) return;
    progress = st;
    pendingRequests = st.requests;
    sharedChanges = st.shared;
  };
  // One state verb. A refusal (the contract does not hold) is returned as {refused} and, but for a request route or close (an
  // attempt the caller handles), listed in the result's warnings (kit feedback 91 F3); a verb that could not write is kept in
  // stateError and stops the run at the next check (unsaved).
  let stateError = null;
  async function state(verb, input) {
    const r = await flow([`state-${verb}`, phaseDir], input);
    if (r.json?.state) adopt(r.json.state);
    if (r.json?.status === "ok") return r.json;
    if (r.json?.status === "refused") {
      log(`state-${verb} refused: ${r.json.reason}`);
      if (verb !== "request") warnings.push(`state-${verb} refused: ${r.json.reason}`);
      return { refused: r.json.reason, generated: r.json.generated === true };
    }
    stateError ??= `state-${verb}: ${r.json?.error ?? `exit ${r.code}`}`;
    return { failed: stateError };
  }
  const unsaved = (when) => (stateError ? result("failed", { reason: `${PROGRESS} could not be written ${when}: ${stateError}` }) : null);
  const tracked = (id) => progress.plans[id]?.tracked === true;
  const committedOnly = (id) => progress.plans[id]?.commit !== undefined && !tracked(id);
  // What the owner and earlier runs left for this run (exec-records): grants, owner answers not taken yet, and for a plan its halt
  // answers (G055), plan-review notes (G039), the worktrees of cleared halts to discard and the one `halt clear --resume` hands over.
  const records = async (t = null, stopFor = null) => (await flow(["exec-records", phaseDir], { runId, ...(t ? { plan: t.plan, summary: t.summary, worktrees: worktreeMode, worktreeDir: cfg.worktree_dir } : {}), ...(stopFor ? { stopFor } : {}) })).json ?? {};
  // G075: the handoff must still describe the plans on disk; then the plans this run selects, or the route when none is left.
  const select = async (verification) => (await flow(["exec-select", phaseDir], { prefix, handoff, manifest: hr.manifest, plans: idx.plans, state: progress, filter: { plans: a.plans, wave: a.wave, gapsOnly: a.gapsOnly }, ...(verification ? { verification } : {}) })).json ?? {};
  const selectedTask = (t) => (!a.plans || a.plans.includes(t.plan)) && (!a.gapsOnly || planInfo(t.plan).gap_closure === true);
  // The handoff, the plan index, the progress record, the owner's grants (kit-feedback 53: a granted file is integration output
  // from the start of the run, for the resume gate and the wave commit) and the plans this run selects.
  async function load() {
    hr = await readHandoff();
    if (hr.status !== "ok") return result("failed", { reason: hr.reason ?? hr.error });
    handoff = hr.waves;
    if (!handoff.length) return result("refused", { reason: `no handoff files in ${phaseDir}/handoff/ (${prefix}w1.args.json); plan the phase first` });
    await index();
    const stateRead = await flow(["state-read", phaseDir]);
    if (stateRead.code !== 0 || !stateRead.json?.state) return result("failed", { reason: `${PROGRESS} is unreadable: ${stateRead.json?.error ?? `exit ${stateRead.code}`}` });
    adopt(stateRead.json.state);
    if (stateRead.json.migrated) log(`${PROGRESS} was written by an older kit; it is migrated on the next write`);
    await grantedFiles();
    let sel = await select();
    for (const w of sel.warnings ?? []) log(`warning: ${w}`);
    if (sel.status === "verification") {
      const ver = await gsd(["verification", "status", phaseDir]);
      sel = await select({ code: ver.code, status: ver.json?.status ?? null });
    }
    if (sel.status !== "ok") return result(sel.stop?.status ?? "failed", sel.stop?.extra ?? { reason: `exec-select: ${sel.error ?? "no answer"}` });
    waves = handoff.filter((w) => a.wave === null || w.k === a.wave);
    wanted = waves.flatMap((w) => w.tasks).filter(selectedTask);
    allTasks = handoff.flatMap((w) => w.tasks);
    return null;
  }
  // Branching (GSDF-54, gsd.branching phase): before the baseline, so the baseline belongs to the checkout that executes (CR-GSF-05).
  async function switchBranch() {
    const br = (await flow(["exec-branch", phaseDir])).json ?? {};
    if (br.status !== "ok") return result("failed", { reason: br.reason ?? br.error });
    if (br.switched) {
      log(`branch ${br.branch} from origin/${br.base}`);
      const again = await readHandoff();
      if (again.status !== "ok") return result("failed", { reason: again.reason ?? again.error });
      if (JSON.stringify(again.waves) !== JSON.stringify(handoff)) return result("refused", { reason: `the handoff files differ on ${br.branch}; plan the phase on that branch` });
      await index();
    }
    return null;
  }
  async function warnProtected() {
    const cur = (await shell(["git", "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    if (P.protectedBranches.includes(cur)) log(`warning: committing to protected branch ${cur}`);
  }

  // ---- execute baseline and safe-resume gate (GSDF-38) ----
  const asPlan = (t) => ({ id: t.plan, owns: t.owns ?? [], summary: t.summary });
  // kit-feedback 66: plans this run has dispatched and not committed yet (graph schedule); their changes are the run's own.
  const inFlight = new Set();
  const gatePlans = () => allTasks.map((t) => ({ ...asPlan(t), complete: Boolean(planInfo(t.plan).has_summary) || inFlight.has(t.plan) }));
  let base = null;
  async function baseline() {
    base = await flow(["baseline", phaseDir]);
    if (base.code !== 0) return result("failed", { reason: `execute baseline could not be recorded: ${base.json?.error ?? base.code}` });
    return null;
  }
  const resumeGate = () => aloneOnTree(resumeGateNow);
  async function resumeGateNow() {
    await index();
    const rg = await flow(["resume-gate", phaseDir], { plans: gatePlans() });
    if (rg.json?.status === "error") return result("failed", { reason: `safe-resume gate could not look: ${rg.json.error}` });
    if (rg.code !== 0) return owner("Execute", `safe-resume gate: ${rg.json.reason}`, { answer: ANSWER.gate(rg.json.answer), recovery: { problems: rg.json.problems, head: rg.json.head }, options: rg.json.options });
    for (const x of rg.json?.accepted ?? []) log(`resume gate: commit ${x.sha.slice(0, 7)} touches no plan-owned file (${x.files.slice(0, 5).join(", ")}); accepted`);
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
      if ((sc.json.commits ?? []).length) return owner("Execute", `plan ${t.plan} has commits (${sc.json.commits.slice(0, 3).map((c) => c.sha ?? c).join(", ")}) but no SUMMARY`, { answer: ANSWER.tree("close out the plan by hand or revert its commits, then rerun with the same args"), options: [`close out by hand: write ${t.summary} from those commits, then rerun with the same args`, `re-execute: git revert the commits that ph gsd select-revert-commits --plan ${t.plan} --range ${base.json?.baseline?.head ?? "<baseline>"}..HEAD lists, then rerun with the same args`] });
    }
    return null;
  }
  // The gap wave cap (GSDF-30, D-73): marked before the first executor; the run that started it may resume it.
  async function gapCap() {
    const at = await gsd(["attempt", "show", phaseDir, "--kind", "gap"]);
    if (at.code !== 0) return result("refused", { reason: "no gap attempt record; plan the gaps first" });
    const prior = at.json.result ?? {};
    if (prior.waveExecuted && prior.waveRunId !== runId) return owner("Gaps", "the gap wave of this phase already executed; gap closure is capped at one wave", { answer: ANSWER.workflow("gsd-verify again, or plan the leftovers as a new phase"), options: ["verify again", "plan the leftovers as a new phase"] });
    if (!prior.waveExecuted) {
      const rec = await gsd(["attempt", "record", phaseDir, "--kind", "gap"], { runId: at.json.runId, inputDigest: at.json.inputDigest, before: at.json.before, done: true, result: { ...prior, waveExecuted: true, waveRunId: runId } });
      if (rec.code !== 0) return result("failed", { reason: `gap attempt could not be marked: ${rec.json?.error ?? rec.code}` });
    } else log(`resuming the gap wave started by this run (${runId})`);
    return null;
  }
  // CR-GSF-03: an executor worktree starts from HEAD; uncommitted planning inputs are read from the main checkout. Then the
  // test command the gate runs.
  let mainRoot = null;
  let testArgv = null;
  // Kit feedback 102 F2: the test command the gate runs (test-command: with the per-test timeout when declared), the one fixers run.
  let testCommand = null;
  async function executionInputs() {
    const snapshot = worktreeMode ? await flow(["execution-inputs"]) : null;
    if (snapshot && snapshot.code !== 0) return result("failed", { reason: `execution inputs unavailable: ${snapshot.json?.error}` });
    mainRoot = snapshot?.json?.root ?? null;
    if (cmds.test) {
      const joined = cmds.test.join(" ");
      const nt = (await gsd(["normalize-test-command", joined])).json?.command;
      testArgv = nt && nt !== joined && nt.startsWith(joined) ? [...cmds.test, ...nt.slice(joined.length).trim().split(/\s+/)] : cmds.test;
      testCommand = (await flow(["test-command"], { testArgv })).json?.argv ?? null;
    }
    return null;
  }
  const fromMain = (rel) => (mainRoot ? `${mainRoot}/${rel}` : rel);

  // ---- executors (GSDF-41..43, GSDF-45, GSDF-52) ----
  // Every call of one executor session carries the same fixed options, worktree isolation included (CR-GSF-04).
  function execOpts(t, label) {
    const o = { label, session: `executor:${t.plan}`, agentType: agentFor("executor", "gsd-executor"), role: "executor", schema: schemas.exec };
    if (t.model) o.model = t.model;
    if (t.effort) o.effort = t.effort;
    if (worktreeMode) {
      o.isolation = "worktree";
      if (seeds[t.plan]) o.worktreeSeed = seeds[t.plan];
    }
    return o;
  }
  const QUOTA = /usage limit|rate limit|\b429\b|too many requests|RESOURCE_EXHAUSTED|quota/i;
  const classify = (reason) => (reason && QUOTA.test(reason) ? { class: "quota", retryAfterSeconds: ((m) => (m ? Number(m[1]) : null))(/retry[- ]?after\D{0,20}(\d+)/i.exec(reason)) } : { class: "unknown" });
  // `found` ({reply} or {defects}): the plan defects behind the halt, recorded as a halt event (kit feedback 64).
  async function halt(id, why, found = {}, extra = {}) {
    // The halted plan's worktree stays until the halt is cleared and the plan is dispatched again (kit feedback 75). `finished`
    // (kit feedback 79): the tree holds a complete executor result, so `ph gsd halt clear --resume` may transfer it.
    await flow(["write", haltPath(id)], JSON.stringify({ plan: id, reason: why, runId, ...(worktrees[id] ? { worktree: worktrees[id] } : {}), ...extra }, null, 2));
    await state("plan", { plan: id, stage: "halted", reason: String(why) });
    await defectEvent("halt", { plan: id, reason: String(why).slice(0, 300) }, found);
    return { plan: id, halted: true, reason: why, ...(pendingRequests[id]?.length ? { requests: pendingRequests[id] } : {}) };
  }
  async function headNow(cwd) { return (await shell(["git", "rev-parse", "HEAD"], cwd ? { cwd } : {})).stdout.trim(); }
  // The orchestrator's own commits of this run and the files they hold (kit feedback 96 c): in the graph schedule a commit of one plan
  // lands while another plan's executor runs, and a worktree may start from it (kit-feedback 66).
  const ownCommits = new Set();
  const landed = new Set();
  const movedBy = (now, before) => now !== before && !ownCommits.has(now);
  const slashPath = (p) => String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "");
  // Requests of a reply (exec-route): G072 to the open plan owning the path most specifically, G089 a shared change when no open
  // plan owns it, kit feedback 86 a refused route (a generated file without its generator) held as a shared change only the
  // owner clears; kit feedback 79: a request for the kit-feedback document is a kit note, logged and in the result.
  async function routeRequests(t, res) {
    const r = (await flow(["exec-route"], { from: t.plan, reply: res, plans: allTasks.filter((x) => x.plan !== t.plan).map(asPlan), known: kitNotes })).json ?? {};
    for (const n of r.notes ?? []) { kitNotes.push(n); log(`kit note ${n.plan}${n.from ? ` (a request for ${n.path} was refused)` : ""}: ${n.note}`); }
    for (const { plan, q } of r.routes ?? []) {
      if (plan && progress.plans[plan]?.commit === undefined) {
        const routed = await state("request", { op: "route", plan, ...q, base: P.requestCheck !== "off" });
        if (!routed.refused) continue;
        log(`request of ${t.plan} for ${q.path}: ${routed.refused}; held as a shared change`);
      }
      await state("shared", { op: "add", changes: [q] });
    }
  }
  // The verdict on an executor reply (exec-verdict): an owner decision (Rule 4, a checkpoint, a partial, blocked or skipped task;
  // kit feedback 79, gsd.pending_request_tasks: a task that waits only for requests this plan routed is accepted and listed),
  // and with `checks` one result per plan task (G058) and the SUMMARY.
  async function verdict(res, plan, checks = {}) {
    const v = (await flow(["exec-verdict"], { reply: res, plan, requests: pendingRequests, shared: sharedChanges, pending: pendingOn, ...checks })).json ?? {};
    for (const p of v.pending ?? []) if (!pendingTasks.some((x) => x.plan === p.plan && x.task === p.task)) { pendingTasks.push(p); ev(`pending-request ${p.plan} ${p.task}`); }
    return v;
  }
  // The requests the owner plan names in resolvedRequests close with its reply.
  async function clearResolved(id, res) {
    const named = (res?.resolvedRequests ?? []).map(slashPath);
    for (const q of [...(pendingRequests[id] ?? [])].filter((x) => named.includes(slashPath(x.path)))) await state("request", { op: "close", plan: id, from: q.from, path: q.path, change: q.change, by: "reply", why: "named in resolvedRequests" });
  }
  // Kit feedback 85: a request also closes when the tree shows it done, a shared change to its path is applied or cleared, the
  // resolver finds it satisfied, or the owner clears it; state-request checks each closure. The result lists all but the replies.
  function noteClosed(rows) {
    for (const row of (rows ?? []).filter((x) => x.by !== "reply")) { requestsClosed.push(row); ev(`request ${row.plan} ${row.path} closed by ${row.by}`); }
  }
  // The owner's typed answers (ph gsd shared clear, request clear) an earlier run did not take: state-answer applies each one.
  async function takeOwnerAnswers() {
    const list = (await records()).ownerAnswers;
    if (!list) return null;
    for (const x of list) {
      if ((progress.answered ?? []).includes(x.id)) continue;
      const took = await state("answer", { id: x.id, link: P.requestCheck !== "off" });
      if (!took.taken) { if (took.refused) log(`owner answer ${x.id} not taken: ${took.refused}`); continue; }
      noteClosed(took.closed);
      ownerAnswers.push(took.taken);
      ev(`answer ${x.id} ${x.kind}${x.path ? ` ${x.path}` : ""} (${took.taken.matched} cleared)`);
    }
    return unsaved("after the owner's answers");
  }
  // One executor: the brief, the call and the verdict on its reply; {plan, ok, wt} or a halt.
  async function dispatch(t, waveId) {
    const rec = await records(t);
    if (rec.resumeNote) log(`plan ${t.plan}: ${rec.resumeNote}`);
    if (rec.resume) {
      await flow(["remove", haltPath(t.plan)]);
      worktrees[t.plan] = rec.resume;
      await state("plan", { plan: t.plan, stage: "executed", summary: t.summary, worktree: rec.resume });
      ev(`resume ${waveId} ${t.plan}`);
      log(`plan ${t.plan}: halt cleared with --resume; the finished worktree ${rec.resume} is transferred, no executor runs`);
      return { plan: t.plan, ok: true, wt: rec.resume, resumed: true };
    }
    for (const tree of rec.discard ?? []) {
      const r = await flow(["discard-worktree"], { plan: t.plan, worktree: tree, reason: "halted" });
      log(`plan ${t.plan}: worktree of the cleared halt ${tree}: ${r.json?.removed ? "discarded" : r.json?.gone ? "already gone" : `kept (${r.json?.why ?? r.json?.error ?? `exit ${r.code}`})`}`);
    }
    await flow(["remove", haltPath(t.plan)]);
    await state("plan", { plan: t.plan, stage: "dispatched" });
    const before = await headNow();
    const reqs = pendingRequests[t.plan] ?? [];
    const prompt = await renderPrompt("executor", { plan: fromMain(planPath(t.plan)), snapshot: mainRoot ?? "", summary: String(t.summary), owns: JSON.stringify(t.owns ?? []), stackSkill: S.stackSkill ? fromMain(S.stackSkill) : "none", generated: S.generated, pending: pendingOn, metrics: metricsOn, answers: rec.answers?.length ? JSON.stringify(rec.answers) : "", notes: rec.notes?.length ? JSON.stringify(rec.notes) : "", accepted: rec.accepted?.length ? JSON.stringify(rec.accepted) : "", requests: reqs.length ? JSON.stringify(reqs) : "", digest: digestLine(`plan:${t.plan}`, t.planHash ?? "none") });
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
    const v = await verdict(res, t.plan, { taskCount: planInfo(t.plan).task_count ?? null, hasSummary, summary: t.summary });
    if (v.halt?.decision) return { ...(await halt(t.plan, v.halt.why, { reply: res }, { finished: hasSummary })), decision: v.halt.decision };
    if (v.halt) return { ...(await halt(t.plan, v.halt.why, { reply: res })), failed: true };
    await state("plan", { plan: t.plan, stage: "executed", summary: t.summary, ...(wt ? { worktree: wt } : {}) });
    return { plan: t.plan, ok: true, wt };
  }
  // The transfer of the executors' worktrees (CR-GSF-08) and the SUMMARY spot-check; a refusal halts the plan.
  // resume (kit feedback 106 F2, a fix round only): the fixer already finished, so the halt is `finished: true` with that
  // worktree and the stop names `ph gsd halt clear --resume`. The Execute transfer does not: that plan is dispatched again.
  const integrate = (outcomes, tasks, resume = false) => writeTree(() => integrateNow(outcomes, tasks, resume));
  async function integrateNow(outcomes, tasks, resume = false) {
    for (const t of tasks) {
      const o = outcomes.find((x) => x?.plan === t.plan);
      if (!o?.ok) continue;
      if (worktreeMode && o.wt) {
        // CR-GSF-08: the deletion declaration comes from the validated handoff task (the index does not carry it).
        const tr = await flow(["transfer", phaseDir], { plan: t.plan, worktree: o.wt, owns: t.owns ?? [], summary: t.summary, files_deleted: t.files_deleted ?? [] });
        if (tr.code !== 0) {
          if (resume && o.wt) worktrees[t.plan] = o.wt;
          Object.assign(o, await halt(t.plan, `transfer refused: ${(tr.json?.refused ?? []).map((r) => `${r.path} (${r.reason})`).join(", ") || tr.json?.error}`, { defects: (tr.json?.refused ?? []).filter((r) => r.reason === "outside owns").map((r) => ({ kind: "owns-reach", evidence: `transfer refused: ${r.path} outside owns` })) }, resume ? { finished: true } : {}), { ok: false, ...(resume ? { resume: true } : {}) });
          continue;
        }
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
    // Kit feedback 106 F2: every halt of this stop is a fix-round transfer refusal whose worktree holds the finished fix.
    const resumable = bad.every((o) => o.resume);
    const listed = bad.map((o) => `${o.plan}: ${o.reason}`).join("; ");
    if (resumable) return owner(stage, `${listed}; the fixer worktree holds the finished fix, so after the problem is answered: ${ANSWER.haltResume().command}`, { answer: ANSWER.haltResume(), halted: bad, options: [`answer the transfer problem, then ${ANSWER.haltResume().command}, then rerun with the same args`, "stop"] });
    return owner(stage, listed, { answer: ANSWER.halt(), halted: bad, options: [`answer each halt with ph gsd halt clear ${N} --plan <id> --reason <answer>, then rerun with the same args`, "stop"] });
  };
  // The stops a wave and a graph plan share before their executors run.
  const haltedStop = (ids, plan) => owner("Execute", `plans with a SUMMARY and a halt record: ${ids.join(", ")}; resolve the halt first (ph gsd halt clear ${N} --plan <id> --reason <answer>)`, { answer: ANSWER.halt(plan), halted: ids });
  // G069: a transfer that started and never finished left a partial copy; the plan does not rejoin as if complete.
  const partialStop = (partial) => owner("Execute", `the transfer of ${partial.map((p) => p.plan).join(", ")} did not finish: the main tree holds part of it (the worktree ${partial[0].worktree} is kept)`, { answer: ANSWER.tree("finish or revert the transfer by hand, then rerun with the same args"), partial, options: ["copy the rest from the worktree by hand and delete the transfers-pending record", "revert the copied paths, delete the SUMMARY and the record, then rerun to re-execute"] });
  const dirtyStop = (dirty) => owner("Execute", dirty.json?.dirty ? `owned files edited before the execute baseline are not in an executor worktree (it starts from HEAD): ${dirty.json.dirty.map((d) => `${d.path} (${d.plan})`).join(", ")}` : `owned-file check failed: ${dirty.json?.error}`, { answer: ANSWER.tree("commit or stash those edits, then rerun with the same args"), dirty: dirty.json?.dirty ?? [], options: ["commit or stash those edits, then rerun with the same args", "set gsd.isolation shared"] });
  // CR-GSF-03, kit feedback 95: a worktree starts from HEAD, so it is seeded with the earlier plans' accepted transfers and the files of
  // the applied shared changes that differ from HEAD (dependency-seed); without earlier plans a seed is set only when it holds files.
  async function seedTrees(tasks, earlier = []) {
    const seed = await flow(["dependency-seed", phaseDir], { plans: earlier, shared: true });
    for (const t of seed.code === 0 && (earlier.length || seed.json.files.length) ? tasks : []) seeds[t.plan] = seed.json;
    return seed.code === 0 ? null : result("refused", { reason: `dependency seed unavailable: ${seed.json?.error}` });
  }
  // Kit feedback 89: a checker issue forceProceed accepted at planning, neither confirmed nor resolved, stops the run before the executors
  // of the plans it affects (exec-records names it and the stop); the waves before them run and commit.
  async function acceptedStop(tasks) {
    const x = (await records(null, tasks.map((t) => t.plan))).acceptedStop;
    return x ? owner("Execute", x.reason, { answer: ANSWER.accepted(x.accepted[0].id), accepted: x.accepted, options: x.options }) : null;
  }
  const pendingTransfers = async (ids) => ((await flow(["pending-transfers", phaseDir])).json?.pending ?? []).filter((p) => ids.includes(p.plan));
  // G083: the plans' <shared_changes> of an execution wave, declared once for the plans `ids` (one change per path).
  async function declareShared(w, ids) {
    for (const s of (w.sharedChanges ?? []).filter((x) => ids.includes(x.source))) {
      const key = `${w.waveId}:${s.source}:${s.text}`;
      if (sharedChanges.some((x) => x.key === key)) continue;
      await state("shared", { op: "add", changes: (s.paths?.length ? s.paths : [null]).map((p) => ({ key, from: s.source, path: p, change: s.text, reason: "declared in the plan's <shared_changes>", ...(s.via ? { via: s.via, outputs: s.outputs } : {}) })) });
    }
  }

  // ---- green gate and bounded verify-fix rounds (GSDF-44, GSDF-49..52) ----
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
  // F57 (kit-feedback 57): the first wave that changes a file matching the smoke triggers builds adapter.commands.smoke_builds
  // once per phase, before its gate. A passed build is kept in execute-progress.json, so a resumed run does not build again; a
  // failed one stops needs-owner and is built again on the rerun.
  const smokeStop = (tasks, waveId, label) => (!cmds.smoke_builds?.length || progress.smoke ? null : aloneOnTree(() => smokeStopNow(tasks, waveId, label)));
  async function smokeStopNow(tasks, waveId, label) {
    if (progress.smoke) return null;
    const pf = await planFiles(tasks);
    if (pf.stop) return pf.stop;
    const changed = [...Object.values(pf.files), ...Object.values(pf.removed), pf.integration].flat();
    const due = (await flow(["smoke-due"], { files: changed, globs: P.smokeTriggers })).json;
    if (!due) return result("failed", { reason: "smoke trigger check could not run" });
    if (!due.due) return null;
    phase("Smoke build");
    const smoke = await gsd(["check", "smoke"]);
    if (smoke.code !== 0) return owner("Smoke build", `${label} changes ${due.matched.join(", ")}; ${smoke.json?.reason ?? `smoke build check exit ${smoke.code}`}`, { answer: ANSWER.tree("install the missing toolchain component or fix the build, then rerun with the same args"), builds: (smoke.json?.builds ?? []).filter((b) => b.status !== "passed"), options: ["install the missing toolchain component or fix the build, then rerun with the same args", "remove the target from adapter.commands.smoke_builds, then rerun with the same args", "abandon"] });
    await state("smoke", { wave: waveId, changed: due.matched });
    return unsaved("after the smoke build");
  }
  const failureText = (list) => list.map((f) => `- ${f.step}${f.plan ? ` (plan ${f.plan})` : ""}: ${f.outcome ?? "failed"}; full log ${f.log ?? "n/a"}\n${String(f.excerpt ?? "").split(/\r?\n/).map((l) => `    ${l}`).join("\n")}`).join("\n");
  // The fixer prompt (template fixer): G070, an edit outside the owns is never a workaround but a request; the fixer policy
  // (gsd.fixer_verifies_itself) lets it run the build and tests within the gsd.fixer limits.
  const fixerPrompt = (owns, findings, failures, requests, digest) => renderPrompt("fixer", { owns: JSON.stringify(owns), generated: S.generated, verifies: P.fixer.verifies, build: String(JSON.stringify(cmds.build)), tests: String(JSON.stringify(testCommand ?? testArgv)), attempts: String(P.fixer.attempts), minutes: String(P.fixer.minutes), metrics: metricsOn, findings: findings.length ? JSON.stringify(findings.map(findingBrief)) : "", failures: failureText(failures), requests: requests.length ? JSON.stringify(requests) : "", digest });
  // The fixer repairs confirmed defects and failed checks in existing code, where more effort finds the edge cases its tests miss
  // (owner decision 2026-10-22): it runs at FIXER_EFFORT on its own tier's model unless gsd.roles.fixer sets an effort.
  const FIXER_EFFORT = "high";
  const fixerOpts = (label, extra = {}) => ({ label, agentType: agentFor("fixer", "gsd-code-fixer"), role: "fixer", ...(cfg.gsd.roles?.fixer?.effort ? {} : { effort: FIXER_EFFORT }), schema: schemas.fixer, ...extra });
  // Main-tree edits outside every plan's owns stop the run before the gate and the review are paid for, not at Commit (G070,
  // kit-feedback 35). Kit feedback 77: committing the paths on their own is the first answer (the resume gate accepts it).
  const UNOWNED_OPTIONS = ["commit them separately (git add and git commit of those paths only), then rerun with the same args", "move or revert them, then rerun with the same args", "add them to a plan's owns and replan"];
  const unownedStop = (stage, pf) => owner(stage, `changes outside every plan's owns: ${pf.unowned.slice(0, 10).join(", ")}`, { answer: ANSWER.tree(UNOWNED_OPTIONS[0]), paths: pf.unowned, options: UNOWNED_OPTIONS });
  const strayStop = (tasks, stage) => aloneOnTree(async () => {
    const pf = await planFiles(tasks);
    return pf.stop ?? (pf.unowned.length ? unownedStop(stage, pf) : null);
  });
  // G089, G083: shared changes are made by one integration fixer owning exactly their paths, before the gate; its files join the
  // wave commit. Kit feedback 82: the step is done when every requested change is present (the fixer reports per change); the gate
  // that follows verifies them. Kit feedback 86: a change to a generated file without its generator is held; the step makes the
  // others and then stops on it. An Integration stop is answered with ph gsd shared clear.
  // Kit feedback 95: `before` (the step before a wave's executors) makes only the declared changes exec-shared-before picks (no open
  // plan owns their file, their text does not wait for the plan's code); a change the tree holds at HEAD needs no fixer (state-shared present).
  const sharedTurn = serialize();
  const applyShared = (waveId, label, before = false) => sharedTurn(() => applySharedNow(waveId, label, before));
  const sharedOptions = (waveId) => [`ph gsd shared clear ${N} ${waveId} [--path <file>] --reason "<what you did or accept>", then rerun with the same args`, "stop"];
  const generatedStop = (waveId, label, held) => owner("Integration", `shared changes of ${label} target generated files without their generator: ${held.map((s) => `${s.from ?? "declared"}: ${s.refused}`).join("; ")}`, { sharedChanges: held, answer: ANSWER.shared(waveId), options: [`run the generator, then ph gsd shared clear ${N} ${waveId} --path <file> --reason "<the generator command and the outputs it rewrote>", then rerun with the same args`, "stop"] });
  async function applySharedNow(waveId, label, before) {
    const ids = before ? (await flow(["exec-shared-before", phaseDir], { waveId, plans: allTasks.map(asPlan) })).json?.ids ?? [] : null;
    const due = (s) => !s.applied && (!ids || ids.includes(s.id));
    if (!sharedChanges.some(due)) return null;
    if (sharedChanges.some((s) => !s.applied && s.wave === undefined)) await state("shared", { op: "tag", wave: waveId });
    const pr = await state("shared", { op: "present", ids: sharedChanges.filter((s) => due(s) && s.path && !s.refused).map((s) => s.id), link: P.requestCheck !== "off" });
    noteClosed(pr.closed);
    for (const s of pr.present ?? []) log(`shared ${waveId}: ${s.path} holds the change already (${s.evidence}); applied without a fixer`);
    const lostTag = unsaved("before the shared changes");
    if (lostTag) return lostTag;
    const nameless = sharedChanges.filter((s) => due(s) && !s.path);
    if (nameless.length) return owner("Integration", `shared changes of ${label} name no file, so no fixer can own them: ${nameless.map((s) => `${s.from}: ${String(s.change).slice(0, 120)}`).join("; ")}`, { sharedChanges: nameless, answer: ANSWER.shared(waveId), options: [...sharedOptions(waveId).slice(0, 1), "apply them by hand, commit them, then rerun with the same args", "name the file in the plan's <shared_changes> and regenerate the handoff"] });
    const held = sharedChanges.filter((s) => due(s) && s.refused);
    const open = sharedChanges.filter((s) => due(s) && !s.refused);
    if (!open.length) return held.length ? generatedStop(waveId, label, held) : null;
    // A change made through a generator owns every file the generator rewrites.
    const files = [...new Set(open.flatMap((s) => [s.path, ...(s.outputs ?? [])]))];
    await state("integration", { op: "add", files, why: `shared changes of ${waveId}` });
    const lostFiles = unsaved("before the shared changes");
    if (lostFiles) return lostFiles;
    const changes = open.map(({ from, path, change, reason, via, outputs }, index) => ({ index, from, path, change, reason, ...(via ? { via, outputs } : {}) }));
    const prompt = await renderPrompt("shared-changes", { label, files: JSON.stringify(files), changes: JSON.stringify(changes), via: open.some((s) => s.via), digest: digestLine(`shared:${waveId}`, await digestOf({ files })) });
    const r = await writeTree(() => call(prompt, fixerOpts(`shared-${waveId}`, { schema: schemas.shared })));
    if (r.result === null) return owner("Integration", `the shared-change fixer of ${label} returned nothing${r.reason ? ` (${r.reason})` : ""}`, { answer: ANSWER.shared(waveId), sharedChanges: open, options: sharedOptions(waveId), ...(fatal(r.reason) ? { failure: classify(r.reason) } : {}) });
    // The changes the fixer reported present and the log lines of its reply (exec-shared-reply, kit feedback 82, 96 b).
    const sr = (await flow(["exec-shared-reply"], { waveId, open: open.map((s) => ({ id: s.id })), reply: r.result })).json;
    if (sr.made.length) noteClosed((await state("shared", { op: "applied", ids: sr.made, link: P.requestCheck !== "off" })).closed);
    for (const l of sr.logs) log(l);
    const lostMade = unsaved("after the shared changes");
    if (lostMade) return lostMade;
    const left = sharedChanges.filter((s) => open.some((o) => o.id === s.id) && !s.applied);
    if (left.length) return owner("Integration", `shared changes of ${label} not applied (${left.length} of ${open.length})${r.result.evidence ? `: ${r.result.evidence}` : ""}`, { sharedChanges: left, answer: ANSWER.shared(waveId), options: sharedOptions(waveId) });
    ev(`shared ${waveId} ${files.length}`);
    return held.length ? generatedStop(waveId, label, held) : null;
  }
  // Kit feedback 102 F3: a gate fixer that verifies itself (gsd.fixer_verifies_itself) may run the failing test files of its
  // failures (exec-fixers tests) with the gate's test command, within the gsd.fixer limits; none listed, the prompt is as before.
  const fixRuntime = (tests = []) => ({ tests: tests.length ? JSON.stringify(tests) : "", command: String(JSON.stringify(testCommand ?? testArgv)), attempts: String(P.fixer.attempts), minutes: String(P.fixer.minutes) });
  // The integration fixer's prompt (template integration-fix, G064): it owns exactly `files`, the files of the `placed` failures.
  async function integrationPrompt(files, placed, tests) {
    const own = tests ?? (await flow(["exec-fixers"], { gate: { unplaced: placed }, verifies: P.fixer.verifies })).json?.tests ?? [];
    return renderPrompt("integration-fix", { files: JSON.stringify(files), failures: failureText(placed), ...fixRuntime(own), digest: digestLine("fix:integration", await digestOf({ files })) });
  }
  // CR-GSF-16: every fix result is inspected before the gate reruns. A quota or a call that could not run stops the round at once;
  // a fixer that answers unresolved, or a fix call that returned nothing, is judged on a fresh gate (G066, G088, kit-feedback
  // 28/30); an owner decision of a fixer (kit-feedback 51) waits for the transfers and the rerun (exec-round-end, with the stall
  // rule). opts: rounds (the composition's bound, gsd.max_verify_rounds); graph schedule: gate() reruns the gate (default: these
  // plans), done(gate) ends the rounds early (default: green).
  async function fixRounds(waveId, tasks, first, label, tail, { rounds, gate = () => runGate(waveId, tasks), done = (x) => x.green } = {}) {
    let cur = first;
    let stall = { prev: first.failureCount, noDrop: 0 };
    for (let round = 1; !done(cur) && round <= rounds; round++) {
      const red = (why, extra = {}) => ({ stop: owner("Gate", `${label} is red after fix round ${round}: ${why}${tail}`, { answer: GATE_RED, failures: cur.failures, evidence: cur.evidence, blockedBy: cur.blockedBy, ...extra }) });
      // Fixer routing (exec-fixers): a plan's failures go to its executor session, or to a main-tree fixer when the plan resumed
      // without its worktree (a new one would start from HEAD); G064: an integration fixer owns exactly the files of the failures
      // no plan owns; a failure naming no file has no owner.
      const route = (await flow(["exec-fixers"], { gate: cur, plans: tasks.map((t) => t.plan), worktreeMode, trees: Object.keys(worktrees).filter((id) => worktrees[id]), verifies: P.fixer.verifies })).json;
      const fixes = route.plans.map(({ id, kind, failures, tests }) => async () => {
        const t = tasks.find((x) => x.plan === id);
        const reqs = pendingRequests[id] ?? [];
        const dg = digestLine(`fix:${id}`, await digestOf({ owns: t.owns ?? [] }));
        if (kind === "fixer") {
          const prompt = await fixerPrompt(t.owns ?? [], [], failures, reqs, dg);
          return { id, kind, ...(await writeTree(() => call(prompt, fixerOpts(`fix-${id}-${round}`)))) };
        }
        const prompt = await renderPrompt("executor-fix", { round, plan: id, failures: failureText(failures), requests: reqs.length ? JSON.stringify(reqs) : "", evidence: String(cur.evidence), ...fixRuntime(tests), digest: dg });
        const fix = () => call(prompt, execOpts(t, `fix-${id}-${round}`));
        return { id, kind, t, ...(await (worktreeMode ? fix() : writeTree(fix))) };
      });
      if (route.files.length) {
        // Kit feedback 83: written before the fixer runs, so a run that dies in it still knows the files it may have changed.
        await state("integration", { op: "add", files: route.files, why: `integration fix of ${waveId} round ${round}` });
        const lost = unsaved("before the integration fix");
        if (lost) return { stop: lost };
        fixes.push(async () => {
          const prompt = await integrationPrompt(route.files, route.placed, route.tests);
          return { id: null, kind: "integration", ...(await writeTree(() => call(prompt, fixerOpts(`integration-fix-${round}`)))) };
        });
      }
      // Kit feedback 64: the red gate this round answers, for the plans of the wave (graph: the plan or the commit batch).
      const redGate = { wave: waveId, round, label, plans: tasks.map((t) => t.plan), failures: cur.failureCount ?? null };
      if (!fixes.length && !sharedChanges.some((s) => !s.applied)) {
        await defectEvent("gate-failure", redGate);
        return red(route.fileless ? `${route.fileless} gate failure(s) name no file of any plan, so no fixer can own them` : "no fixer owns the failing files");
      }
      const results = await parallel(fixes);
      const roundDefects = [];
      for (const r of results) if (r) roundDefects.push(...(await defectEvent("fix-round", { wave: waveId, round, label, plan: r.id ?? null, fixer: r.kind }, { reply: r.result })));
      await defectEvent("gate-failure", redGate, { defects: roundDefects });
      const soft = [];
      const decisions = [];
      for (const r of results) {
        if (!r) return red("a fix call failed to run");
        const who = r.id ? `plan ${r.id}` : "the integration fixer";
        if (r.result === null) {
          if (fatal(r.reason)) return { stop: owner("Gate", `fix call of ${who} failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason), evidence: cur.evidence }) };
          soft.push({ id: r.id, why: `fix call of ${who} returned nothing${r.reason ? ` (${r.reason})` : ""}` });
          continue;
        }
        await routeRequests(r.t ?? { plan: r.id ?? "integration" }, r.result);
        if (stateError) return red("could not persist pending change requests");
        if (r.kind === "executor") {
          const { decision } = await verdict(r.result, r.id);
          if (decision) decisions.push({ id: r.id, decision });
        } else if (r.result.status !== "fixed") soft.push({ id: r.id, why: `${who} unresolved (${r.result.remaining_failures ?? "?"} failures remain)${r.result.evidence ? `: ${r.result.evidence}` : ""}` });
        if (r.id) await clearResolved(r.id, r.result);
      }
      if (stateError) return red("could not persist pending change requests");
      if (worktreeMode) {
        const live = tasks.filter((t) => cur.byPlan?.[t.plan] && worktrees[t.plan]);
        const hs = haltStop(await integrate(live.map((t) => ({ plan: t.plan, ok: true, wt: worktrees[t.plan] })), live, true), "Gate");
        if (hs) return { stop: hs };
      }
      const stray = await strayStop(tasks, "Gate");
      if (stray) return { stop: stray };
      const sh = await applyShared(waveId, label);
      if (sh) return { stop: sh };
      ev(`fix ${waveId} round ${round}`);
      cur = await gate();
      const end = (await flow(["exec-round-end"], { decisions, soft, gate: cur, done: done(cur), stall })).json;
      for (const l of end.logs) log(l);
      if (end.stuck) return { stop: owner("Gate", end.stuck.reason, { answer: ANSWER.tree("make the decision in the plan's files, then rerun with the same args"), decision: end.stuck.decision, evidence: cur.evidence }) };
      if (end.still) return red(end.still);
      stall = end.stall;
      if (end.stalled) return { stop: owner("Gate", `verify-fix stalled: ${cur.failureCount} failures did not drop over 2 rounds`, { answer: GATE_RED, failures: cur.failures, evidence: cur.evidence }) };
    }
    return { gate: cur };
  }

  // ---- bounded code review (GSDF-46..48, GSDF-92) ----
  // A finding as the verifier, the fixer and the resolution check see it: one defect, every place it occurs.
  const findingBrief = ({ id, file, line, trigger, description, class: kind, instances }) => ({ id, file, line, trigger, description, ...(kind ? { class: kind } : {}), ...(instances?.length ? { instances } : {}) });
  const findingFiles = (list) => [...new Set(list.flatMap((f) => [f.file, ...(f.instances ?? []).map((x) => x.file)]).filter(Boolean))];
  const metrics = { confirmed: 0, refuted: 0, unverified: 0, resolved: 0, deferred: 0, downgraded: 0, preExisting: 0, secondVerifier: 0 };
  // Two attempts for the findings without a verdict, then a second, independent verifier for what the first left uncertain (it
  // does not see the first verdict; still uncertain stays unverified). Each verdict keeps its evidence on the finding (G081).
  async function verifyFindings(gated, plan) {
    let seen = null;
    const dg = digestLine(`findings:${plan}`, await digestOf({ files: findingFiles(gated) }));
    const ask = async (list, label, second = false) => {
      const prompt = await renderPrompt("finding-verifier", { plan, findings: JSON.stringify(list.map(findingBrief)), metrics: metricsOn, digest: dg });
      const r = await call(prompt, { label, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: schemas.verdict });
      // GSDF-01: a quota, credit or auth failure is never retried.
      if (r.result === null && fatal(r.reason)) return { stop: owner("Review", `${second ? "second " : ""}finding verifier of ${plan} failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason), findings: gated.map(findingBrief) }) };
      seen = (await flow(["exec-verdicts"], { seen, ids: list.map((f) => f.id), reply: r.result, second, metrics: metricsOn })).json.seen;
      return {};
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const missing = gated.filter((f) => !seen?.verdicts[f.id]);
      if (!missing.length) break;
      const vf = await ask(missing, `verify-findings-${plan}`);
      if (vf.stop) return vf;
    }
    const unsure = gated.filter((f) => seen?.verdicts[f.id] === "uncertain");
    if (unsure.length) {
      metrics.secondVerifier += unsure.length;
      const vf = await ask(unsure, `verify-findings-${plan}-second`, true);
      if (vf.stop) return vf;
    }
    const out = (await flow(["exec-verdicts"], { seen, ids: gated.map((f) => f.id), metrics: metricsOn, final: true })).json.findings;
    gated.forEach((f, i) => Object.assign(f, out[i]));
    return {};
  }
  // Review records and deferred.md are written one at a time: review-record renders REVIEW.md from every record, and two
  // renders at once could each miss the other's record. deferred.md lines are appended once per finding (G081).
  let reviewWrites = Promise.resolve();
  const reviewWrite = (fn) => (reviewWrites = reviewWrites.then(fn, fn));
  async function writeRecord(waveId, record) {
    const wr = await reviewWrite(() => flow(["review-record", phaseDir], { waveId, record }));
    return wr.code === 0 ? null : result("failed", { reason: `review record of ${record.plan} refused: ${(wr.json?.errors ?? [wr.json?.error ?? `exit ${wr.code}`]).join("; ")}` });
  }
  const appendDeferred = (lines) => (lines.length ? reviewWrite(() => flow(["append-new", `${phaseDir}/deferred.md`], { lines })) : null);
  const confirmedOf = (record) => record.findings.filter((f) => f.verdict === "confirmed");
  const resolvedIds = (record) => new Set((record.resolution ?? []).filter((x) => x.resolved === true).map((x) => x.id));
  const unresolvedOf = (record) => confirmedOf(record).filter((f) => !resolvedIds(record).has(f.id));
  const asReview = (record, replay = null) => ({ record, replay, confirmed: confirmedOf(record), unverified: record.findings.filter((f) => f.verdict === "unverified" || f.verdict === "uncertain") });
  // The code review of one plan: finders, finding verification, the record. built (graph schedule): what the reviewer is told
  // about the build state instead of the wave's green gate.
  async function reviewPlan(t, waveId, codeOnly, scopeOverride, built = "The wave is built and its tests are green.") {
    const evScope = scopeOverride ? null : await gsd(["check", "evaluation-scope", "--plan", t.plan]);
    const summarySha = t.summary ? await fileSha(t.summary) : null;
    // Scope, lenses and the record (exec-review). A record is reused for the same work (plan text, SUMMARY, lenses, reviewers):
    // unchanged code replays its findings, after a fix pass only the resolution check runs again (G080, kit-feedback 33/34), and
    // findings left unverified are verified again.
    const p = (await flow(["exec-review", phaseDir], { waveId, plan: t.plan, planHash: t.planHash ?? null, summarySha, files: scopeOverride ?? a.files, filterExplicit: Boolean(scopeOverride), summary: t.summary, evaluation: evScope?.json?.files ?? [], lenses: cfg.adapter.review_lenses ?? [], reviewers: P.reviewers.map((rv) => [rv.model ?? null, rv.effort ?? null]), codeOnly })).json;
    for (const l of p.log ?? []) log(`review scope ${t.plan}: ${l}`);
    if (p.replay === "resolution") {
      log(`review ${t.plan}: the recorded findings were fixed once; only the resolution check runs again`);
      return asReview(p.prior, "resolution");
    }
    if (p.replay === "review") {
      const open = p.openAt.map((i) => p.prior.findings[i]);
      log(`review ${t.plan}: the recorded review of this code is reused${open.length ? `; ${open.length} finding(s) are verified again` : ""}`);
      if (open.length) {
        const vf = await verifyFindings(open, t.plan);
        const bad = await writeRecord(waveId, p.prior);
        if (bad) return { stop: bad };
        if (vf.stop) return vf;
      }
      return asReview(p.prior, "review");
    }
    const record = p.record;
    if (record.scope.length) {
      const prompt = await renderPrompt("code-review", { plan: t.plan, planPath: planPath(t.plan), depth: String(P.reviewDepth), scope: record.scope.join(", "), lines: p.changedText, codeOnly, built, lenses: p.lensText, digest: digestLine(`review:${t.plan}`, record.stamp) });
      // Each reviewer reviews the plan on its own; their findings are kept apart (ids R2-, R3-, ...), not merged.
      const replies = await parallel(P.reviewers.map((rv, k) => async () => {
        const opts = { label: `review-${t.plan}${k ? `-r${k + 1}` : ""}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: schemas.findings, ...(rv.model ? { model: rv.model } : {}), ...(rv.effort ? { effort: rv.effort } : {}) };
        const first = await call(prompt, opts);
        return first.result === null && !fatal(first.reason) ? call(prompt, opts) : first;
      }));
      // parallel() turns a thrown call into a null item.
      const empty = replies.findIndex((r) => !r || r.result === null);
      if (empty >= 0) return { stop: owner("Review", `reviewer${P.reviewers.length > 1 ? ` ${empty + 1}` : ""} of ${t.plan} returned nothing${replies[empty]?.reason ? ` (${replies[empty].reason})` : ""}`, { answer: ANSWER.rerun() }) };
      // CR-GSF-17: an unknown severity is a named blocking error, never a silent downgrade. Each finding is gated (high, with a
      // trigger, confidence >= 80, not theoretical: G056), downgraded, deferred or pre-existing (outside the lines the plan
      // changed and not caused by it: owner decision 2026-10-22), by exec-findings.
      const fd = (await flow(["exec-findings"], { plan: t.plan, replies: replies.map((r) => r.result.findings ?? []), changed: p.changed })).json;
      if (fd.unknown.length) return { stop: owner("Review", `reviewer of ${t.plan} returned unknown severities (${fd.unknownSeverities.join(", ")}), expected ${fd.expected}`, { answer: ANSWER.rerun(), findings: fd.unknown }) };
      record.findings = fd.findings;
      const gated = record.findings.filter((f) => f.status === "gated");
      if (gated.length) {
        const vf = await verifyFindings(gated, t.plan);
        if (vf.stop) {
          // G081: what came back is kept, so the owner sees the findings and a rerun does not pay for them again.
          const bad = await writeRecord(waveId, record);
          return bad ? { stop: bad } : vf;
        }
      }
      await appendDeferred(fd.deferredLines);
      for (const k of ["deferred", "downgraded", "preExisting"]) metrics[k] += fd.counts[k];
    }
    for (const f of record.findings) if (f.verdict) metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] = (metrics[f.verdict === "uncertain" ? "unverified" : f.verdict] ?? 0) + 1;
    const bad = await writeRecord(waveId, record);
    if (bad) return { stop: bad };
    ev(`review ${waveId} ${t.plan}${codeOnly ? " code-only" : ""}`);
    return asReview(record);
  }
  // Runs fn over items, gsd.code_review.max_concurrent (policy reviewLimit) at a time, in order; after the first stop no new item starts.
  async function reviewPool(items, fn) {
    let stopped = null;
    const out = await pool(items, P.reviewLimit, async (item) => {
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
    return { reviews: done.out, confirmed: done.out.flatMap((r) => r.confirmed), unverified: done.out.flatMap((r) => r.unverified) };
  }
  const unverifiedStop = (list, what = "") => owner("Review", `${list.length} blocking findings${what} could not be verified`, { answer: ANSWER.rerun("rerun with the same args; the unverified findings are verified again"), findings: list.map((f) => ({ ...findingBrief(f), verdict: f.verdict, evidence: f.verdictEvidence ?? "" })) });
  // kit-feedback 53: the owner's grants (ph gsd grant) are files the phase's fixers may change; a granted file is integration output.
  async function grantedFiles() {
    const list = (await records()).grants ?? [];
    const fresh = list.filter((f) => !(progress.integration ?? []).includes(f));
    if (fresh.length) await state("integration", { op: "add", files: fresh, why: "granted (ph gsd grant)" });
    return list;
  }
  async function fixer(label, findings, failures, owns) {
    const fixOwns = [...owns, ...(await grantedFiles())];
    const prompt = await fixerPrompt(fixOwns, findings, failures, [], digestLine(`fix:${label}`, await digestOf({ owns: fixOwns, files: findingFiles(findings) })));
    const r = await writeTree(() => call(prompt, fixerOpts(label, { timeoutS: (P.fixer.minutes + 5) * 60 })));
    ev(`fixer ${label}`);
    await defectEvent("fix-round", { label, plan: null, fixer: findings.length ? "review" : "gate" }, { reply: r.result });
    // kit-feedback 55: an edit that no build or test run followed is named in the stop, so the owner runs the failing tests before any hand fix.
    const lastEdit = r.result ? r.result.lastEdit ?? "unverified" : null;
    if (!r.result || r.result.status !== "fixed") {
      // The files the fixer asked for and could not change are offered as grants: the owner grants them and reruns.
      const grantRequests = (await flow(["exec-route"], { reply: { requests: r.result?.requests }, plans: allTasks.map(asPlan) })).json?.asked ?? [];
      return { stop: owner("Fix", r.result ? `fixer unresolved: ${r.result.remaining_failures ?? "?"} failures remain${lastEdit === "unverified" ? "; last edit unverified: run the failing tests before a hand fix" : ""}` : `fixer stopped or timed out${r.reason ? `: ${r.reason}` : ""}`, { answer: grantRequests.length ? ANSWER.grant(grantRequests[0].path, grantRequests[0].plan) : ANSWER.tree("fix the remaining failures by hand (run the failing tests first), then rerun with the same args"), evidence: r.result?.evidence ?? null, lastEdit, ...(grantRequests.length ? { grantRequests, options: [...grantRequests.map((rq) => `ph gsd grant ${N} --path ${rq.path}${rq.plan ? ` --plan ${rq.plan}` : ""}, then rerun with the same args`), "stop"] } : {}) }) };
    }
    await routeRequests({ plan: "fixer" }, r.result);
    return { ok: true };
  }
  // Checks the confirmed findings still unresolved; findings resolved earlier keep their answer. A resolution call that returns
  // nothing (a dead caller, a lost transport) is no verdict: the run fails with a resume hint (G126, kit-feedback 32).
  async function resolutionCheck(reviews, waveId) {
    const unresolved = [];
    const done = await reviewPool(reviews, async (rv) => {
      const open = unresolvedOf(rv.record);
      if (!open.length) return null;
      const prompt = await renderPrompt("resolution-check", { plan: rv.record.plan, findings: JSON.stringify(open.map(findingBrief)), digest: digestLine(`resolve:${rv.record.plan}`, await digestOf({ files: [...new Set([...rv.record.scope, ...findingFiles(open)])] })) });
      const r = await call(prompt, { label: `resolve-${rv.record.plan}`, agentType: agentFor("reviewer", "gsd-code-reviewer"), role: "reviewer", readOnly: true, schema: schemas.resolution });
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
  // The fix of confirmed findings: one fixer pass, the gate, the resolution check; findings still unresolved get one more fixer
  // pass limited to them (G080). A replayed review whose first pass already ran goes straight to the check.
  // opts: {label (first fixer label), failures (gate failures for the first pass), owns, tasks, what, gate() -> gate result}.
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
  const metricsLine = (wave) => flow(["append", "_workspace/review-metrics.jsonl"], JSON.stringify({ phase: N, wave, ...metrics }));
  // The review step of a green wave, graph plan or batch: unverified findings stop it; confirmed ones go to fixAndResolve.
  async function reviewFix(waveId, reviews, opts, what = "") {
    const unverified = reviews.flatMap((r) => r.unverified);
    if (unverified.length) return { stop: unverifiedStop(unverified, what) };
    if (!reviews.some((r) => unresolvedOf(r.record).length) && !(opts.failures ?? []).length) {
      await metricsLine(waveId);
      return {};
    }
    const fx = await fixAndResolve(waveId, reviews, opts);
    await metricsLine(waveId);
    return fx;
  }

  // ---- orchestrator commits (GSDF-53) and tracking ----
  // The manifest is every change of the main tree since the baseline (fixer deltas included, CR-GSF-07), assigned to plans by
  // transfer claim or owns; unowned changes stop the commit.
  async function planFiles(tasks) {
    const ids = new Set(tasks.map((t) => t.plan));
    const later = allTasks.filter((t) => !ids.has(t.plan) && progress.plans[t.plan]?.commit === undefined);
    // With worktrees the files a plan claims are the ones its transfer record names (owned-changes claims).
    const oc = await flow(["owned-changes", phaseDir], { plans: tasks.map(asPlan), pending: later.map((t) => ({ ...asPlan(t), claimed: [] })), ignore: [cfg.worktree_dir], claims: worktreeMode });
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
    if (!c.json?.committed) return { stop: owner("Commit", `code commit of ${ids.join(",")} failed: ${c.json?.error ?? c.json?.reason ?? `exit ${c.code}`}; nothing tracked`, { answer: ANSWER.tree("fix the cause (hook, identity, index), then rerun with the same args"), recovery, options: ["fix the cause (hook, identity, index) and rerun with the same args", "stop"] }) };
    ownCommits.add(c.json.hash);
    const entry = { sha: c.json.hash, phase: N, wave, plans: Object.fromEntries(ids.map((id) => [id, [...(pf.files[id] ?? []), ...(pf.removed[id] ?? [])]])) };
    if (withIntegration && pf.integration.length) entry.integration = pf.integration;
    const jp = await flow(["json-push", `${phaseDir}/commits.json`], entry);
    if (jp.code !== 0) return { stop: owner("Commit", `commit ${c.json.hash} made but ${phaseDir}/commits.json was not updated: ${jp.json?.error ?? `exit ${jp.code}`}`, { answer: ANSWER.rerun("rerun with the same args; the resume gate reconciles the commit"), recovery: { ...recovery, entry } }) };
    ev(`commit ${subject}`);
    // Kit feedback 96 c: a pending-request task whose blocking paths the run's commits (each after a green gate) hold is settled.
    for (const f of files) landed.add(f);
    for (const p of pendingTasks.filter((x) => !x.commit && x.blockedBy.every((b) => landed.has(slashPath(b))))) { p.commit = c.json.hash; ev(`pending-request ${p.plan} ${p.task} settled ${c.json.hash.slice(0, 7)}`); }
    return { sha: c.json.hash };
  }
  // Kit feedback 75: the plans of a recorded commit no longer need their executor worktrees. A plan this run did not dispatch is
  // found by the worktree its transfer record names; the verb keeps a tree whose delta is not all in the record.
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
  // Kit feedback 85: before Commit each open request of the committed plans is checked: deterministically when its path changed
  // since the request (a green gate precedes every Commit), by one read-only resolver call for the rest (policy requestCheck,
  // gsd.request_check: auto; tree = the deterministic check only; off = every open request stops the commit).
  async function settleRequests(list) {
    const plans = list.flatMap((w) => w.tasks.map((t) => t.plan));
    const openNow = () => plans.flatMap((plan) => (pendingRequests[plan] ?? []).map((q) => ({ plan, q })));
    if (!openNow().length) return null;
    const mode = P.requestCheck;
    if (mode !== "off") for (const { plan, q } of openNow()) {
      if (!progress.requestBase || !Object.hasOwn(progress.requestBase, JSON.stringify([plan, q.from ?? null, slashPath(q.path), q.change ?? null]))) continue;
      const c = await state("request", { op: "close", plan, from: q.from, path: q.path, change: q.change, by: "tree", why: `${slashPath(q.path)} changed after the request, and the gate after the change is green` });
      if (c.closed) noteClosed([c.closed]);
    }
    let note = "";
    const rest = openNow();
    if (mode === "auto" && rest.length) {
      const items = rest.map(({ plan, q }, n) => ({ id: `R${n + 1}`, plan, from: q.from ?? null, path: slashPath(q.path), change: q.change, reason: q.reason ?? null }));
      const ids = [...new Set(rest.map((x) => x.plan))].join("+");
      const prompt = await renderPrompt("request-resolver", { requests: JSON.stringify(items), digest: digestLine(`requests:${ids}`, await digestOf({ files: items.map((x) => x.path) })) });
      const r = await call(prompt, { label: `resolve-requests-${ids}`, agentType: agentFor("finding_verifier", "finding-verifier"), role: "finding_verifier", readOnly: true, schema: schemas.resolution });
      if (r.result === null) {
        if (fatal(r.reason)) return owner("Commit", `the resolver of the open cross-plan requests failed: ${r.reason}`, { answer: ANSWER.rerun("rerun after the reset"), failure: classify(r.reason), requests: rest.map((x) => x.q) });
        note = `; the resolver returned nothing${r.reason ? ` (${r.reason})` : ""}`;
      } else for (const x of r.result.resolution ?? []) {
        const at = items.findIndex((it) => it.id === x.id);
        if (at < 0 || x.resolved !== true) continue;
        const { plan, q } = rest[at];
        const c = await state("request", { op: "close", plan, from: q.from, path: q.path, change: q.change, by: "resolver", why: x.evidence || "the resolver found the change present" });
        if (c.closed) noteClosed([c.closed]);
      }
    }
    const lostClosed = unsaved("after closing requests");
    if (lostClosed) return lostClosed;
    const left = openNow();
    if (!left.length) return null;
    return owner("Commit", `cross-plan change requests lack acknowledged resolution${note}`, { answer: ANSWER.request(left[0].plan, slashPath(left[0].q.path)), requests: left.map((x) => x.q), options: [...left.map(({ plan, q }) => `ph gsd request clear ${N} --plan ${plan} --path ${slashPath(q.path)} --reason "<why it is satisfied>", then rerun with the same args`), "make the change in the file, then rerun with the same args"] });
  }
  // The commit transaction of waves [{w, tasks}]: open requests settled, the manifest, a commit per wave or plan (gsd.commit_policy),
  // commits.json, the plans recorded committed, their landed worktrees discarded.
  async function commitWaves(list, verify, evidence) {
    phase("Commit");
    const requestStop = await settleRequests(list);
    if (requestStop) return { stop: requestStop };
    const pf = await planFiles(list.flatMap((d) => d.tasks));
    if (pf.stop) return pf;
    if (pf.unowned.length) return { stop: unownedStop("Commit", pf) };
    let withIntegration = true;
    for (const { w, tasks } of list) {
      const ids = tasks.map((t) => t.plan);
      const units = cfg.gsd.commit_policy.code === "per-plan" ? ids.map((id) => [`feat(${id}): phase ${N} plan ${id}`, [id]]) : [[`feat(${N}-w${w.k}): phase ${N} wave ${w.k}`, ids]];
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
  // Plans committed by an earlier run but not tracked are only tracked (CR-GSF-02).
  async function trackCommitted(w, tasks) {
    const committed = tasks.filter((t) => committedOnly(t.plan));
    if (!committed.length) return { committed };
    const p0 = progress.plans[committed[0].plan];
    return { committed, ...(await track(w, committed, p0.verify ?? "green", p0.evidence ?? null)) };
  }

  // ---- clean stop at a wave boundary (kit feedback 88) ----
  // `ph workflow stop <runId>` leaves a stop request the verb stop-requested reads; stopAfterWave is the same stop, set in the args.
  // Both are checked only where every started wave is committed and tracked: before a wave that has work left (waves schedule),
  // before a plan starts (graph schedule: started plans run on to their commit). The run then ends paused: nothing is killed.
  let stopSeen = null;
  let currentRun = null;
  async function stopAsked() {
    if (stopSeen) return stopSeen;
    const r = await flow(["stop-requested"]);
    currentRun = r.json?.runId ?? currentRun;
    if (r.json?.stop) {
      stopSeen = r.json;
      log(`stop request of run ${r.json.runId} (${r.json.at}) seen${r.json.reason ? `: ${r.json.reason}` : ""}`);
    }
    return stopSeen;
  }
  // Why the run pauses before work of wave k, or null.
  const pauseBefore = async (k) => (a.stopAfterWave !== null && k > a.stopAfterWave ? "stopAfterWave" : (await stopAsked()) ? "stop-request" : null);
  // The paused result (exec-pause names the last wave reached, the reason and the answer).
  async function paused(by, nextWave, extra = {}) {
    const p = (await flow(["exec-pause"], { by, nextWave, stopAfterWave: a.stopAfterWave, stop: stopSeen, run: currentRun, waves: waves.map((w) => ({ k: w.k, plans: w.tasks.filter(selectedTask).map((t) => t.plan) })), state: progress })).json;
    ev(`paused ${by} before wave ${nextWave}`);
    return result("paused", { stage: "Wave", reason: p.reason, pausedAt: p.pausedAt, answer: p.answer, ...extra });
  }

  // A plan whose SUMMARY is already on main, and whose halt was cleared with --resume (kit feedback 106 F2: a fix-round
  // transfer refusal). The fixer worktree still holds the finished fix; transfer it. No such answer: nothing, and the plan
  // rejoins the gate as before. A refusal halts it again, still finished, so --resume stays the answer.
  async function resumeTransfer(t) {
    if (!worktreeMode) return {};
    const rec = await records(t);
    if (!rec.resume) return {};
    worktrees[t.plan] = rec.resume;
    log(`plan ${t.plan}: halt cleared with --resume; the finished worktree ${rec.resume} is transferred`);
    const hs = haltStop(await integrate([{ plan: t.plan, ok: true, wt: rec.resume }], [t], true), "Execute");
    return hs ? { stop: hs } : {};
  }
  // One wave's coding stage (waves schedule and batch mode). Plans already committed are only tracked; plans with a SUMMARY but
  // no commit (an interrupted transaction, CR-GSF-02) rejoin the wave's gate, review and commit without a new executor. opts:
  // limit (executors at once, the composition's gsd.parallelization), earlier (batch: the tasks of the waves coded before, so
  // the stray check covers the whole uncommitted batch).
  async function codeWave(w, { limit, earlier } = {}) {
    phase("Wave");
    await index();
    let open = w.tasks.filter(selectedTask).filter((t) => !tracked(t.plan));
    const tc = await trackCommitted(w, open);
    if (tc.stop) return tc;
    open = open.filter((t) => !tc.committed.includes(t));
    const coded = open.filter((t) => planInfo(t.plan).has_summary);
    const haltedCoded = coded.filter((t) => planInfo(t.plan).halted).map((t) => t.plan);
    if (haltedCoded.length) return { stop: haltedStop(haltedCoded) };
    const partial = await pendingTransfers(open.map((t) => t.plan));
    if (partial.length) return { stop: partialStop(partial) };
    for (const t of coded) {
      // Kit feedback 106 F2: the SUMMARY is already on main (the executor transferred) but the fixer's tree was refused.
      // halt clear --resume names that tree; transfer it before the plan rejoins the gate. No resume: the log below, as before.
      const landed = await resumeTransfer(t);
      if (landed.stop) return { stop: landed.stop };
      log(`plan ${t.plan}: SUMMARY present but not committed; it rejoins the gate, review and commit of wave ${w.k}`);
    }
    const toRun = open.filter((t) => !planInfo(t.plan).has_summary && planInfo(t.plan).ready !== false);
    // G055: a halted or blocked plan is reported, never skipped in silence while the rest of the wave commits.
    for (const t of open.filter((x) => !planInfo(x.plan).has_summary && planInfo(x.plan).ready === false)) {
      const p = planInfo(t.plan);
      const why = p.halted ? "halted" : p.error ? `frontmatter ${p.error}` : `blocked by ${(p.blocked_by ?? []).join(", ") || "an unfinished plan"}`;
      if (!skipped.some((s) => s.plan === t.plan)) skipped.push({ plan: t.plan, wave: w.k, why });
      log(`warning: plan ${t.plan} skipped (${why}); answer a halt with ph gsd halt clear ${N} --plan ${t.plan} --reason <answer>`);
    }
    const tasks = w.tasks.filter((t) => coded.includes(t) || toRun.includes(t));
    await declareShared(w, tasks.map((t) => t.plan));
    if (!tasks.length) return { tasks };
    if (toRun.length && !worktreeMode) {
      const ow = await gsd(["check", "owns", N, "--plans", tasks.map((t) => t.plan).join(",")]);
      if (ow.code !== 0) return { stop: result("refused", { reason: `shared tree needs disjoint owns in wave ${w.k}: ${JSON.stringify(ow.json?.problems ?? ow.json?.errors ?? [])}` }) };
    }
    if (toRun.length && worktreeMode) {
      // CR-GSF-03: a worktree starts from HEAD, so it must already hold the owner's edits to the plans' owned files.
      const dirty = await flow(["dirty-owned", phaseDir], { plans: toRun.map((t) => ({ id: t.plan, owns: t.owns ?? [] })) });
      if (dirty.code !== 0) return { stop: dirtyStop(dirty) };
    }
    // Kit feedback 89, 95: an open accepted checker issue of a plan to run stops the wave; its declared shared changes are made first.
    const stop = (toRun.length ? await acceptedStop(toRun) : null) ?? (await resumeGate()) ?? (toRun.length ? await applyShared(w.waveId, `wave ${w.k}`, true) : null);
    if (stop) return { stop };
    const sd = toRun.length && worktreeMode ? await seedTrees(toRun, handoff.filter((x) => x.k < w.k).flatMap((x) => x.tasks).filter((t) => !tracked(t.plan) && planInfo(t.plan).has_summary).map((t) => t.plan)) : null;
    if (sd) return { stop: sd };
    // GSDF-40: plans sharing a files_modified entry never run at the same time; later ones run in a later group (exec-groups).
    const og = (await flow(["exec-groups"], { tasks: toRun.map((t) => ({ plan: t.plan, files: planInfo(t.plan).files_modified ?? [] })) })).json;
    for (const id of og.defects) log(`planning defect: ${id} shares files_modified with an earlier plan of the wave; running it after them`);
    const outcomes = [];
    for (const group of og.groups) outcomes.push(...(await pool(group.map((i) => toRun[i]), limit, (t) => dispatch(t, w.waveId))));
    for (const o of outcomes) if (o?.wt) worktrees[o.plan] = o.wt;
    await integrate(outcomes, toRun);
    if (stateError) return { stop: result("failed", { reason: `could not persist pending change requests: ${stateError}` }) };
    const hs = haltStop(outcomes, "Execute");
    if (hs) return { stop: hs };
    // G070: shared-tree executors write the main tree; an edit outside the owns stops here, before gate and review.
    if (toRun.length && !worktreeMode) {
      const stray = await strayStop(earlier ? [...earlier, ...tasks] : tasks, "Execute");
      if (stray) return { stop: stray };
    }
    return { tasks };
  }

  // A run that skipped halted or blocked plans says so in its result; shared changes left unapplied stop it.
  const finish = async (extra = {}) => {
    const left = sharedChanges.filter((s) => !s.applied);
    if (left.length) return owner("Integration", `${left.length} shared change(s) were never applied`, { answer: ANSWER.shared(left[0].wave ?? "<wave>"), sharedChanges: left, options: sharedOptions(left[0].wave ?? "<wave>") });
    // Kit feedback 75: harness worktrees of finished runs that are still there (the transferred ones go with ph worktrees --prune).
    const old = worktreeMode ? (await flow(["leftover-worktrees"])).json : null;
    if (old?.total) log(`${old.total} leftover harness worktree(s) of finished runs (${old.removable} removable): ph worktrees --prune removes the removable ones`);
    return result("executed", { ...extra, ...(old?.total ? { leftoverWorktrees: { total: old.total, removable: old.removable, hint: "ph worktrees --prune" } } : {}), ...(skipped.length ? { reason: `executed except ${skipped.map((s) => `${s.plan} (${s.why})`).join(", ")}`, next: `answer the halts (ph gsd halt clear ${N} --plan <id> --reason <answer>) and rerun with the same args` } : {}) });
  };
  // kit-feedback 58: one gate over every plan of the run, after the last commit. A wave's gate goes stale once a later wave edits
  // the same files, so verify reads only this evidence. A red phase gate stops the run; its plans stay tracked.
  async function phaseGate(extra = {}) {
    const phaseTasks = wanted.filter((t) => !skipped.some((s) => s.plan === t.plan));
    if (!phaseTasks.length) return finish({ evidence: [], ...extra });
    phase("Gate");
    const pg = await runGate(`${prefix}batch`, phaseTasks);
    if (!pg.green) return owner("Gate", `the phase gate is red over ${phaseTasks.length} plans; the waves are committed and tracked`, { answer: GATE_RED, failures: pg.failures, evidence: pg.evidence, ...extra });
    return finish({ evidence: [pg.evidence], ...extra });
  }

  return {
    // the record and its answers
    result, owner, ANSWER, GATE_RED, state, unsaved, tracked, planInfo, index, selectedTask, skipped, worktrees, inFlight, defectEvent,
    get progress() { return progress; },
    get stateError() { return stateError; },
    get handoff() { return handoff; },
    get allTasks() { return allTasks; },
    get waves() { return waves; },
    // agent calls and their parts
    call, digestOf, failureText, fixerOpts, classify, integrationPrompt,
    // preconditions
    lock, unlock, scanHandEdits, antiPatterns, load, switchBranch, baseline, takeOwnerAnswers, resumeGate, gapCap, executionInputs,
    // the main tree
    aloneOnTree, writeTree,
    // executors
    dispatch, integrate, haltStop, haltedStop, partialStop, dirtyStop, seedTrees, acceptedStop, pendingTransfers, declareShared, codeWave, resumeTransfer,
    // gate, shared changes, fix rounds
    runGate, gateNow, smokeStop, strayStop, unownedStop, applyShared, fixRounds,
    // review and fix
    reviewPlan, reviewAll, reviewFix, unverifiedStop,
    // commit and track
    planFiles, commitWaves, track, trackCommitted,
    // stop request, the end of a run
    stopAsked, pauseBefore, paused, finish, phaseGate,
  };
}

// The names a run of executeSteps returns (the budget test flags a composition that defines one at top level).
export const EXECUTE_STEP_NAMES = Object.freeze(Object.keys(executeSteps(new Proxy({}, { get: () => () => ({}) }), { args: {}, cfg: { gsd: {}, adapter: {} }, setup: {}, policy: {} })));
