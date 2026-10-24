export const meta = {
  name: "gsd-execute",
  description: "GSD phase execution: safe-resume gate, executors per handoff wave, green gate with bounded fix rounds, bounded code review, orchestrator commits",
  phases: [{ title: "Preconditions" }, { title: "Baseline" }, { title: "Wave" }, { title: "Smoke build" }, { title: "Gate" }, { title: "Review" }, { title: "Commit" }, { title: "Batch" }],
};

// The default composition of a phase execution (kit feedback 87, THIN.md): step order, the steps each schedule runs, its stops
// and their answers, retry and round counts, policies. The steps are the kit's (THIN.md stage 3): `executeSteps` binds them to
// this run and takes the policies below as values; a step returns its stop (with its answer), the composition returns it or
// goes on. Decisions and contracts are kit verbs (lib/flow-exec.mjs and the state, gate, review and transfer verbs); agent
// prompts are kit templates (.agents/workflows/prompts/).

// ---- arguments (GSDF-93) and settings: validated and derived by exec-args and exec-setup (agent schemas included) ----
const a = (await flow(["exec-args"], { args: args ?? null })).json ?? {};
if (a.status !== "ok") return { status: "failed", reason: a.reason ?? a.error };
const phaseDir = a.phaseDir;
const cfg = await loadCfg();
const g = cfg.gsd;
// Policies of this composition: the schedule (kit-feedback 66), executors at once (GSDF-93, never above max_subagents), plans
// reviewed at once and the independent reviewers of each plan (gsd.code_review), pending-request tasks (kit feedback 79).
const schedule = g.execute_schedule ?? "waves";
const limit = g.parallelization.enabled ? Math.min(g.parallelization.max_concurrent ?? cfg.max_subagents, cfg.max_subagents) : 1;
const reviewLimit = Math.max(1, Math.min(g.code_review.max_concurrent, cfg.max_subagents));
const reviewers = g.code_review.reviewers.length ? g.code_review.reviewers : [{}];
const pendingOn = g.pending_request_tasks !== false;
const S = (await flow(["exec-setup"], { cfg, args: a, pending: pendingOn })).json ?? {};
if (S.status !== "ok") return { status: "failed", reason: `exec-setup: ${S.error ?? "no answer"}` };
const { N, prefix, mode: execMode, worktreeMode } = S;
// The run's steps with the policies they take: open requests checked before Commit (gsd.request_check: auto, tree or off), the
// review's depth, the fixer's own verification and limits (gsd.fixer_verifies_itself, gsd.fixer), the executor's own new tests (gsd.executor_verifies_itself), the files that trigger the
// smoke builds (adapter.smoke_triggers), the branches a commit warns about (gsd.branching none, gsd.protected_branches).
const R = executeSteps({ phaseDir, args: a, cfg, setup: S, policy: { pending: pendingOn, requestCheck: g.request_check ?? "auto", reviewLimit, reviewers, reviewDepth: g.review_depth, fixer: { verifies: Boolean(g.fixer_verifies_itself), attempts: g.fixer.max_build_attempts, minutes: g.fixer.minutes }, executorVerifies: Boolean(g.executor_verifies_itself), smokeTriggers: cfg.adapter.smoke_triggers ?? [], protectedBranches: g.branching === "none" ? g.protected_branches ?? [] : [] } });
const { result, owner, ANSWER, GATE_RED, state, unsaved, tracked, planInfo, index, selectedTask, skipped, worktrees, inFlight, defectEvent, call, integrationPrompt, fixerOpts, classify, aloneOnTree } = R;
const { dispatch, integrate, haltStop, haltedStop, partialStop, dirtyStop, seedTrees, acceptedStop, pendingTransfers, declareShared, codeWave, resumeTransfer, runGate, gateNow, smokeStop, strayStop, unownedStop, applyShared, fixRounds } = R;
const { reviewPlan, reviewAll, reviewFix, unverifiedStop, planFiles, commitWaves, track, trackCommitted, stopAsked, pauseBefore, paused, finish, phaseGate } = R;
if (S.metricsOn) await defectEvent(null);
// kit-feedback 66: the graph schedule needs per-wave commits; kit feedback 88: batch mode commits once, after the last wave, so
// stopAfterWave has no wave boundary to pause at.
if (schedule === "graph" && execMode !== "per-wave") return result("refused", { reason: `gsd.execute_schedule graph needs gsd.execution_mode per-wave (it is ${execMode})` });
if (a.stopAfterWave !== null && execMode !== "per-wave") return result("refused", { reason: `stopAfterWave needs gsd.execution_mode per-wave (it is ${execMode}: one commit after the last wave)` });

// ---- preconditions (GSDF-40, GSDF-11, GSDF-02, GSDF-39, GSDF-64): cwd guard and the leases, then each check in order ----
phase("Preconditions");
const locked = await R.lock();
if (locked) return locked;
try {
// Hand edits (measurement), anti-pattern answers, the handoff, plans and progress record with the run's selection, the phase
// branch (gsd.branching phase, GSDF-54: before the baseline, so the baseline belongs to the checkout that executes).
const pre = (await R.scanHandEdits()) ?? (await R.antiPatterns()) ?? (await R.load()) ?? (g.branching === "phase" ? await R.switchBranch() : null);
if (pre) return pre;
// ---- execute baseline, owner answers, safe-resume gate (GSDF-38), gap wave cap (GSDF-30), executor inputs ----
phase("Baseline");
const ready = (await R.baseline()) ?? (await R.takeOwnerAnswers()) ?? (await R.resumeGate()) ?? (a.gapsOnly ? await R.gapCap() : null) ?? (await R.executionInputs());
if (ready) return ready;
const { handoff, allTasks, waves } = R;

// ---- graph schedule (kit-feedback 66): a plan starts when the plans it waits for are committed ----
// Each plan is its own stream: executor and transfer, its own obligations with fix rounds, its review, fix and resolution
// check. Then it joins the commit queue: one batch at a time runs the repo-wide suite (adapter gates, build, tests) and commits
// on green. A stop settles its plan and the plans waiting for it; the others run on to their commit.
const BUILT = "The plan's own verify obligations are green; the repo-wide build and tests run before its commit.";
async function graphRun() {
  phase("Wave");
  await index();
  const waveOf = new Map(handoff.flatMap((w) => w.tasks.map((t) => [t.plan, w])));
  const sg = await flow(["schedule-graph"], { plans: allTasks.map((t) => ({ id: t.plan, wave: waveOf.get(t.plan).k, depends_on: planInfo(t.plan).depends_on ?? [], owns: t.owns ?? [], files_modified: planInfo(t.plan).files_modified ?? [], tracer: t.tracer === true || t.tracer?.is === true })) });
  if (!sg.json?.deps) return { stop: result("failed", { reason: `the execution graph could not be built: ${sg.json?.error ?? `exit ${sg.code}`}` }) };
  if (sg.json.cycle) return { stop: result("refused", { reason: `the plans wait for each other in a cycle (${sg.json.cycle.join(" -> ")}); fix depends_on and regenerate the handoff with gsd-plan`, cycle: sg.json.cycle }) };
  const deps = sg.json.deps;
  for (const w of waves) {
    const tc = await trackCommitted(w, w.tasks.filter(selectedTask));
    if (tc.stop) return tc;
  }
  const units = waves.flatMap((w) => w.tasks.filter(selectedTask).filter((t) => !tracked(t.plan)));
  const pausing = [];
  const inRun = new Set(units.map((t) => t.plan));
  const isCommitted = (id) => R.progress.plans[id]?.commit !== undefined;
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
  // A stop that is no owner decision about one plan (a quota, a call that cannot run, a failed or refused step, a resume gate
  // problem) drains the run: nothing new starts, and the plans not committed yet are interrupted.
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
    await index();
    const p = planInfo(t.plan);
    if (p.has_summary && p.halted) return stopPlans([t.plan], haltedStop([t.plan], t.plan));
    if (!p.has_summary && (p.halted || p.error)) return skip(t, p.halted ? "halted" : `frontmatter ${p.error}`);
    // Kit feedback 88: a stop (request or stopAfterWave) starts no new plan; the plans already started commit.
    const by = await pauseBefore(w.k);
    if (by) {
      pausing.push({ plan: t.plan, wave: w.k, by });
      return interrupt(t);
    }
    const partial = await pendingTransfers([t.plan]);
    if (partial.length) return stopPlans([t.plan], partialStop(partial));
    order.push(`start ${t.plan}`);
    await declareShared(w, [t.plan]);
    if (p.has_summary) {
      const landed = await resumeTransfer(t); if (landed?.stop) return stopPlans([t.plan], landed.stop);
      inFlight.add(t.plan); log(`plan ${t.plan}: SUMMARY present but not committed; it rejoins its checks, review and commit`);
    } else {
      if (worktreeMode) {
        const dirty = await flow(["dirty-owned", phaseDir], { plans: [{ id: t.plan, owns: t.owns ?? [] }] });
        if (dirty.code !== 0) return stopPlans([t.plan], dirtyStop(dirty));
      }
      const gateStop = await R.resumeGate();
      if (gateStop) return stopPlans([t.plan], gateStop, true);
      // Kit feedback 89, 95: an open accepted checker issue stops the plan; its declared shared changes are made before its executor,
      // whose worktree is seeded in its slot (with the shared files the main tree holds when the worktree is made).
      const pre = (await acceptedStop([t])) ?? (await applyShared(w.waveId, label, true));
      if (pre) return stopPlans([t.plan], pre);
      const o = await execSlot(async () => {
        if (draining) return null;
        const sd = worktreeMode ? await seedTrees([t]) : null;
        if (sd) return { plan: t.plan, seedStop: sd };
        inFlight.add(t.plan);
        return dispatch(t, w.waveId);
      });
      if (!o) return interrupt(t);
      if (o.seedStop) return stopPlans([t.plan], o.seedStop);
      if (o.wt) worktrees[t.plan] = o.wt;
      await integrate([o], [t]);
      if (R.stateError) return stopPlans([t.plan], result("failed", { reason: `could not persist pending change requests: ${R.stateError}` }));
      const hs = haltStop([o], "Execute");
      if (hs) return stopPlans([t.plan], hs);
      if (!worktreeMode) {
        const stray = await strayStop([t], "Execute");
        if (stray) return stopPlans([t.plan], stray);
      }
    }
    if (draining) return interrupt(t);
    // G083: the plan's shared changes left for after its code, and those its requests made, before its checks.
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
      const fr = await fixRounds(checkId, [t], cur, label, "", { rounds: g.max_verify_rounds, gate: check });
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
    const fx = await reviewFix(checkId, [rv], { label: `fix-review-${checkId}`, owns: t.owns ?? [], tasks: [t], what: label, gate: check }, ` of ${t.plan}`);
    if (fx.stop) return stopPlans([t.plan], fx.stop);
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
      const fr = await fixRounds(joinId, batch, c.gate, `the suite before ${label}`, "", { rounds: g.max_verify_rounds, gate: suite, done: (x) => !ownRed(x, ids) });
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
  // A plan the batch waits for can still help while it runs, or when it will start without the batch; a stopped plan, or one
  // that waits for the batch itself, never can.
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
  if (!stops.length && pausing.length) {
    const first = pausing.reduce((x, y) => (y.wave < x.wave ? y : x));
    return { pause: await paused(first.by, first.wave, { ...info, notStarted: pausing.map((x) => x.plan) }) };
  }
  if (!stops.length) return { info };
  return { stop: { ...stops[0].stop, ...info, stopped: stops.map(({ plans, stop }) => ({ plans, status: stop.status, stage: stop.stage ?? null, reason: stop.reason })), ...(skipped.length ? { skipped } : {}) } };
}

if (schedule === "graph") {
  const gr = await graphRun();
  if (gr.stop) return gr.stop;
  if (gr.pause) return gr.pause;
  return phaseGate(gr.info);
}

// ---- waves schedule, per-wave mode: each wave coded, its gate with fix rounds, review, fix and resolution, commit ----
const isTracer = (w) => w.tasks.some((t) => t.tracer === true || t.tracer?.is === true);
if (execMode === "per-wave") {
  for (const w of waves) {
    // Kit feedback 88: the wave boundary; every wave before this one is committed and tracked.
    if (w.tasks.filter(selectedTask).some((t) => !tracked(t.plan))) {
      const by = await pauseBefore(w.k);
      if (by) return paused(by, w.k);
    }
    const cw = await codeWave(w, { limit });
    if (cw.stop) return cw.stop;
    if (!cw.tasks.length) continue;
    const label = isTracer(w) ? "tracer wave" : `wave ${w.k}`;
    const tail = isTracer(w) ? "; no later wave starts" : "";
    const sh = await applyShared(w.waveId, label);
    if (sh) return sh;
    const sm = await smokeStop(cw.tasks, w.waveId, label);
    if (sm) return sm;
    phase("Gate");
    const fr = await fixRounds(w.waveId, cw.tasks, await runGate(w.waveId, cw.tasks), label, tail, { rounds: g.max_verify_rounds });
    if (fr.stop) return fr.stop;
    // GSDF-47: no reviewer before the wave is green; a red tracer starts no later wave.
    if (!fr.gate.green) return owner("Gate", `${label} is red after ${g.max_verify_rounds} fix rounds${tail}`, { answer: GATE_RED, failures: fr.gate.failures, evidence: fr.gate.evidence, blockedBy: fr.gate.blockedBy });
    phase("Review");
    const rv = await reviewAll(cw.tasks, w.waveId, false);
    if (rv.stop) return rv.stop;
    const fx = await reviewFix(w.waveId, rv.reviews, { label: `fix-review-${w.waveId}`, owns: cw.tasks.flatMap((t) => t.owns ?? []), tasks: cw.tasks, what: `wave ${w.k}`, gate: () => runGate(w.waveId, cw.tasks) });
    if (fx.stop) return fx.stop;
    const evidence = fx.evidence ?? fr.gate.evidence;
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
let batchStopNoted = false;
for (const w of waves) {
  if (!batchStopNoted && (await stopAsked())) {
    batchStopNoted = true;
    log("stop request not honoured: batch mode commits once after the last wave, so it has no wave boundary; the run goes on to its end");
  }
  // The stray check of a wave covers the waves coded before it: nothing is committed until the end.
  const cw = await codeWave(w, { limit, earlier: done.flatMap((d) => d.tasks) });
  if (cw.stop) return cw.stop;
  if (!cw.tasks.length) continue;
  done.push({ w, tasks: cw.tasks });
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
if (phaseFiles.unowned.length) return unownedStop("Commit", phaseFiles);
const phaseScope = [...new Set([...Object.values(phaseFiles.files).flat(), ...phaseFiles.integration])].filter((f) => !f.startsWith(".planning/")).sort();
if (!phaseScope.length) log("phase review: the phase diff holds no code changes");
// G071: the phase review covers the whole phase diff; an explicit files list scopes only the per-wave reviews.
if (Array.isArray(a.files) && a.files.length) log(`phase review: the files argument scopes only the per-wave reviews${g.batch_review ? "" : " (none run: batch_review is off)"}; the phase review covers the phase diff`);
const phaseReview = await reviewPlan({ plan: `${S.nn}-phase`, summary: null }, "phase", true, phaseScope);
if (phaseReview.stop) return phaseReview.stop;
allReviews.push(phaseReview);
const unverified = allReviews.flatMap((r) => r.unverified);
if (unverified.length) return unverifiedStop(unverified);
const batchId = `${prefix}batch`;
const batchGate = () => runGate(batchId, doneTasks);
const shB = await applyShared(batchId, "the batch");
if (shB) return shB;
const smB = await smokeStop(doneTasks, batchId, "the batch");
if (smB) return smB;
let final = await batchGate();
// G064, kit feedback 64: unplaced files go to the integration fixer; unresolved stops only when no executed plan still has a failure.
if (!final.green) {
  const placed = (final.unplaced ?? []).filter((f) => (f.files ?? []).length);
  const batchRed = { wave: batchId, round: 1, label: "the batch", plans: doneTasks.map((t) => t.plan), failures: final.failureCount ?? null };
  if (!placed.length) await defectEvent("gate-failure", batchRed);
  if (placed.length) {
    const files = [...new Set(placed.flatMap((f) => f.files))];
    await state("integration", { op: "add", files, why: "integration fix of the batch" });
    const lost = unsaved("before the integration fix");
    if (lost) return lost;
    const r = await call(await integrationPrompt(files, placed), fixerOpts("integration-fix-batch"));
    const named = await defectEvent("fix-round", { wave: batchId, round: 1, label: "the batch", plan: null, fixer: "integration" }, { reply: r.result });
    await defectEvent("gate-failure", batchRed, { defects: named });
    const ownedLeft = Object.entries(final.byPlan ?? {}).some(([id, list]) => (list ?? []).length && doneTasks.some((t) => t.plan === id));
    if ((!r.result || r.result.status !== "fixed") && !(r.result && r.result.status === "unresolved" && ownedLeft)) return owner("Gate", `the integration fixer of the batch ${r.result ? "answered unresolved" : `returned nothing${r.reason ? ` (${r.reason})` : ""}`}`, { answer: fatal(r.reason) ? ANSWER.rerun("rerun after the reset") : GATE_RED, failures: placed, evidence: final.evidence, ...(fatal(r.reason) ? { failure: classify(r.reason) } : {}) });
    if (r.result && r.result.status === "fixed") final = await batchGate();
    else if (ownedLeft) log("integration fixer of the batch answered unresolved; placed failures still have a fixer");
  }
}
const batchFailures = [...new Set(Object.entries(final.byPlan ?? {}).filter(([id]) => doneTasks.some((t) => t.plan === id)).flatMap(([, list]) => list))];
if (!final.green && !batchFailures.length) return owner("Gate", `batch gate red: ${final.failureCount} failure(s) that no executed plan owns${(final.unplaced ?? []).some((f) => !(f.files ?? []).length) ? " (some name no file)" : ""}`, { answer: GATE_RED, failures: final.failures, evidence: final.evidence });
const fx = await reviewFix(batchId, allReviews, { label: "batch-fixer", failures: final.green ? [] : batchFailures, owns: doneTasks.flatMap((t) => t.owns ?? []), tasks: doneTasks, what: "batch gate still", gate: batchGate });
if (fx.stop) return fx.stop;
const finalEvidence = fx.evidence ?? final.evidence;
const cm = await commitWaves(done, "skipped", finalEvidence);
if (cm.stop) return cm.stop;
for (const d of done) {
  const tr = await track(d.w, d.tasks, "skipped", finalEvidence);
  if (tr.stop) return tr.stop;
}
return finish({ evidence: [finalEvidence], finalGate: finalEvidence });
} finally {
  await R.unlock();
}
