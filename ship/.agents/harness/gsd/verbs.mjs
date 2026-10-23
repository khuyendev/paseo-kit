// The ported verb handlers: verb -> {options (parseArgs spec, null = raw argv), run(g, args, opts)}.
import path from "node:path";
import { textDigest } from "../lib/hash.mjs";
import { isInside } from "../lib/paths.mjs";
import { done, fail, idList, none, unavailable } from "./common.mjs";
import { frontmatterGet, frontmatterValidate, historyDigest, initPayload, initProject, listArtifacts, researchPrompt, summaryExtract, supersede, verifyArtifacts, verifyKeyLinks, writeArtifact } from "./artifacts.mjs";
import { debugBudget, debugCheckpoint, debugClose, debugCreate, debugList, debugStatus } from "./debug.mjs";
import { commitVerb, evaluationScope, selectRevertCommits } from "./gitverbs.mjs";
import { haltClear } from "./halts.mjs";
import { handoff, outlineCheck, outlineParseVerb, wavesVerb } from "./outline.mjs";
import { checkOwns, coverage, decisionCoverage, failureDirections, planStructure, verifyCommandPaths } from "./plan-checks.mjs";
import { findPhaseVerb, phaseAdd, phaseComplete, phaseInsert, phaseRemove, planIndex, requirementsVerb, roadmapVerb, uatPassed } from "./phases.mjs";
import { normPlanId, planIds, readPlan, readPlans, requirePhase } from "./planning.mjs";
import { ATTEMPT_KINDS, readAttempt, recordAttempt, revisionsVerb } from "./revisions.mjs";
import { stateVerb } from "./state.mjs";
import { fingerprint, researchStatus, verificationStatusVerb } from "./status.mjs";
import { health, normalizeTestCommand, runWithTimeout } from "./tools.mjs";
import { upstreamVerb } from "./upstream.mjs";

const phaseOf = (g, args) => {
  if (!args[0]) throw fail(`${g.verb} needs a phase (number or .planning/phases/<dir>)`);
  return requirePhase(g.codeRoot, args[0]);
};
const subset = (opts, phase) => (opts.plans ? idList(opts.plans).map((id) => (/^\d+$/.test(id) ? `${phase.padded}-${id.padStart(2, "0")}` : normPlanId(id))) : undefined);
const json = (s) => {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw fail(`stdin is not valid JSON (${e.message})`);
  }
};
// verify artifacts|key-links scope. Upstream form: one PLAN file (also quick plans), as the generated verifier calls
// it; a PLAN that is missing, unreadable or unparseable could not be looked at (69), never "nothing declared" (66).
function planScope(g, a, o) {
  if (/-PLAN\.md$/i.test(a[0] ?? "")) {
    const file = path.resolve(g.codeRoot, a[0]);
    if (!isInside(file, g.codeRoot)) throw unavailable(`${a[0]} is outside the code root`);
    const id = path.basename(file).replace(/-PLAN\.md$/i, "");
    const home = { dir: path.dirname(file), padded: id.split("-")[0] };
    const plan = readPlan(home, id);
    if (!plan) throw unavailable(`plan file missing or unreadable: ${a[0]}`);
    if (plan.error) throw unavailable(`${a[0]}: frontmatter ${plan.error}`);
    const siblings = readPlans(home);
    return { plans: [plan], allPlans: siblings.some((p) => p.id === id) ? siblings : [...siblings, plan] };
  }
  const phase = phaseOf(g, a);
  const plans = readPlans(phase, subset(o, phase));
  const broken = plans.find((p) => p.error);
  if (broken) throw unavailable(`${broken.id}: frontmatter ${broken.error}`);
  return { plans, allPlans: readPlans(phase) };
}
const bool = (v, dflt) => (v === undefined ? dflt : !/^(false|0|no|off)$/i.test(String(v)));

// Multi-value options such as `--files a b c` (taken until the next --option).
function multi(args, names) {
  const out = Object.fromEntries(names.map((n) => [n, []]));
  const pos = [];
  let cur = null;
  for (const a of args) {
    if (a.startsWith("--")) {
      if (!names.includes(a.slice(2))) throw fail(`unknown option ${a}`);
      cur = a.slice(2);
    } else if (cur) out[cur].push(a);
    else pos.push(a);
  }
  return { ...out, pos };
}

const state = (sub, options = {}) => ({ options: { phase: "string", status: "string", plan: "string", activity: "string", plans: "string", name: "string", wave: "string", text: "string", "text-file": "string", by: "string", milestone: "string", ...options }, run: (g, a, o) => stateVerb(g, sub, o) });
const init = (workflow) => ({ options: {}, run: (g, a) => initPayload(g, workflow, a[0]) });
const revisions = (sub) => ({ options: {}, run: (g, a) => revisionsVerb(g, sub, phaseOf(g, a), a[1]) });

export const verbHandlers = {
  "init.project": { options: {}, run: (g) => initProject(g) },
  "init.plan-phase": init("plan-phase"),
  "init.phase-op": init("phase-op"),
  "init.execute-phase": init("execute-phase"),
  "init.verify": init("verify"),
  "state.load": state("load"),
  "state.init": state("init"),
  "state.position": state("position"),
  "state.planned-phase": state("planned-phase"),
  "state.wave": state("wave"),
  "state.decision": state("decision"),
  "state.override": state("override"),
  "state.session-note": state("session-note"),
  "state.rederive": state("rederive"),
  "roadmap.get-phase": { options: {}, run: (g, a) => roadmapVerb(g, "get-phase", a) },
  "roadmap.analyze": { options: {}, run: (g, a) => roadmapVerb(g, "analyze", a) },
  "roadmap.annotate-dependencies": { options: {}, run: (g, a) => roadmapVerb(g, "annotate-dependencies", a) },
  "roadmap.install-draft": { options: {}, run: (g, a) => roadmapVerb(g, "install-draft", a) },
  "requirements.list": { options: {}, run: (g, a) => requirementsVerb(g, "list", a) },
  "requirements.mark-complete": { options: {}, run: (g, a) => requirementsVerb(g, "mark-complete", a) },
  "requirements.revert": { options: {}, run: (g, a) => requirementsVerb(g, "revert", a) },
  "find-phase": { options: {}, run: (g, a) => findPhaseVerb(g, a[0]) },
  "phase.add": { options: { goal: "string" }, run: (g, a, o) => done(phaseAdd(g, a.join(" "), o)) },
  "phase.insert": { options: { goal: "string" }, run: (g, a, o) => done(phaseInsert(g, a[0], a.slice(1).join(" "), o)) },
  "phase.remove": { options: {}, run: (g, a) => done(phaseRemove(g, a[0])) },
  "phase.complete": { options: {}, run: (g, a) => done(phaseComplete(g, a[0])) },
  "phase.uat-passed": { options: { "require-verification": "bool", "uat-only": "bool" }, run: (g, a, o) => uatPassed(g, phaseOf(g, a), { requireVerification: o["require-verification"], uatOnly: o["uat-only"] }) },
  "phase.list-plans": { options: {}, run: (g, a) => done({ phase: phaseOf(g, a).number, plans: planIds(phaseOf(g, a)) }) },
  "phase.list-artifacts": { options: { type: "string" }, run: (g, a, o) => listArtifacts(g, phaseOf(g, a), o.type) },
  "phase-plan-index": { options: {}, run: (g, a) => planIndex(g, phaseOf(g, a)) },
  "halt.clear": { options: { plan: "string", reason: "string" }, run: (g, a, o) => haltClear(g, phaseOf(g, a), o.plan, o.reason) },
  "verify.plan-structure": {
    options: { plans: "string" },
    run: async (g, a, o) => {
      // Upstream form: one PLAN file (also quick plans outside a phase); else a phase with optional --plans.
      if (/-PLAN\.md$/i.test(a[0] ?? "")) {
        const file = path.resolve(g.codeRoot, a[0]);
        const id = path.basename(file).replace(/-PLAN\.md$/i, "");
        const plan = readPlan({ dir: path.dirname(file), padded: id.split("-")[0] }, id);
        if (!plan) throw none(`no plan file ${a[0]}`);
        const r = await planStructure(g, null, plan);
        return done(r, r.valid ? 0 : 1);
      }
      const phase = phaseOf(g, a);
      const plans = readPlans(phase, subset(o, phase));
      if (!plans.length) throw none(`no plans in ${phase.name}`);
      const results = [];
      for (const p of plans) results.push(await planStructure(g, phase, p));
      const valid = results.every((r) => r.valid);
      return done(results.length === 1 ? results[0] : { valid, plans: results }, valid ? 0 : 1);
    },
  },
  "verify.artifacts": { options: { plans: "string" }, run: (g, a, o) => verifyArtifacts(g, planScope(g, a, o).plans) },
  "verify.key-links": {
    options: { plans: "string" },
    run: (g, a, o) => {
      const s = planScope(g, a, o);
      return verifyKeyLinks(g, s.plans, s.allPlans);
    },
  },
  "verification.status": { options: {}, run: (g, a) => verificationStatusVerb(g.codeRoot, phaseOf(g, a)) },
  "verification.fingerprint": { options: {}, run: (g, a) => done(fingerprint(g.codeRoot, phaseOf(g, a), a.slice(1))) },
  "check.coverage": {
    options: {},
    run: (g, a) => {
      const r = coverage(g, phaseOf(g, a), readPlans(phaseOf(g, a)));
      return done(r, r.passed ? 0 : 1);
    },
  },
  "check.decision-coverage": { options: {}, run: (g, a) => decisionGate(g, a, true) },
  "check.decision-coverage-plan": { options: {}, run: (g, a) => decisionGate(g, a, true) },
  "check.decision-coverage-verify": { options: {}, run: (g, a) => decisionGate(g, a, false) },
  "check.verify-command-paths": { options: { plans: "string" }, run: async (g, a, o) => done(await verifyCommandPaths(g, phaseOf(g, a), readPlans(phaseOf(g, a), subset(o, phaseOf(g, a))))) },
  "check.verify-failure-directions": { options: { plans: "string" }, run: (g, a, o) => done(failureDirections(g, readPlans(phaseOf(g, a), subset(o, phaseOf(g, a))))) },
  "check.owns": { options: { plans: "string" }, run: (g, a, o) => checkOwns(g, phaseOf(g, a), subset(o, phaseOf(g, a))) },
  "check.evaluation-scope": {
    options: { phase: "string", plan: "string", quick: "string", since: "string", "commits-only": "bool", "max-commits": "string" },
    run: (g, a, o) => evaluationScope(g, { phase: o.phase, plan: o.plan, quick: o.quick, since: o.since, commitsOnly: o["commits-only"], maxCommits: o["max-commits"] ? Number(o["max-commits"]) : undefined }),
  },
  "outline.parse": { options: {}, run: (g, a) => outlineParseVerb(g, phaseOf(g, a)) },
  "outline.check": {
    options: { tracer: "string", "plans-per-phase": "string", "waves-per-phase": "string" },
    run: (g, a, o) => outlineCheck(g, phaseOf(g, a), { tracer: bool(o.tracer, true), plansPerPhase: Number(o["plans-per-phase"]) || undefined, wavesPerPhase: Number(o["waves-per-phase"]) || undefined }),
  },
  waves: { options: { plans: "string" }, run: (g, a, o) => wavesVerb(g, phaseOf(g, a), subset(o, phaseOf(g, a))) },
  handoff: { options: { plans: "string", prefix: "string", "no-tracer-split": "bool" }, run: (g, a, o) => handoff(g, phaseOf(g, a), { subset: subset(o, phaseOf(g, a)), prefix: o.prefix, noTracerSplit: o["no-tracer-split"] === true }) },
  "revisions.record": revisions("record"),
  "revisions.check": revisions("check"),
  "revisions.hash": revisions("hash"),
  "revisions.show": revisions("show"),
  supersede: {
    options: { keep: "string" },
    run: (g, a, o) => {
      if (o.keep === undefined) throw fail("supersede needs --keep <ids>");
      const phase = phaseOf(g, a);
      return supersede(g, phase, subset({ plans: o.keep }, phase));
    },
  },
  "attempt.record": {
    options: { kind: "string", "run-id": "string", "input-digest": "string", before: "string", done: "string", result: "string" },
    run: (g, a, o) => {
      const phase = phaseOf(g, a);
      const input = o["run-id"] ? { runId: o["run-id"], inputDigest: o["input-digest"], before: o.before, done: o.done === undefined ? undefined : bool(o.done, false), result: o.result === undefined ? undefined : parseMaybe(o.result) } : json(g.stdin());
      return done(recordAttempt(phase, o.kind, input));
    },
  },
  "attempt.show": {
    options: { kind: "string" },
    run: (g, a, o) => {
      if (!ATTEMPT_KINDS.has(o.kind)) throw fail("--kind must be gap, verify or research");
      const at = readAttempt(phaseOf(g, a), o.kind);
      if (!at) throw none(`no ${o.kind} attempt recorded`);
      return done(at);
    },
  },
  write: { options: {}, run: (g, a) => writeArtifact(g, a[0], a[1], g.stdin()) },
  hash: { options: {}, run: (g) => done({ hash: textDigest(g.stdin()) }) },
  "research.status": { options: {}, run: (g, a) => researchStatus(g, phaseOf(g, a)) },
  "research.prompt": { options: {}, run: (g, a) => researchPrompt(g, phaseOf(g, a)) },
  "frontmatter.get": { options: {}, run: (g, a) => frontmatterGet(g, a[0], a[1]) },
  "frontmatter.validate": { options: { schema: "string" }, run: (g, a, o) => frontmatterValidate(g, a[0], o.schema) },
  "summary-extract": {
    options: null,
    run: (g, a) => {
      const m = multi(a, ["fields"]);
      return summaryExtract(g, m.pos, m.fields.join(","));
    },
  },
  "history-digest": { options: {}, run: (g) => historyDigest(g) },
  commit: {
    options: null,
    run: (g, a) => {
      const m = multi(a, ["files", "files-removed"]);
      return commitVerb(g, m.pos.join(" "), m.files, m["files-removed"]);
    },
  },
  "select-revert-commits": { options: { phase: "string", plan: "string", range: "string" }, run: (g, a, o) => selectRevertCommits(g, o) },
  "run-with-timeout": {
    options: null,
    run: (g, a) => {
      const cut = a.indexOf("--");
      return runWithTimeout(g, a[0], cut < 0 ? a.slice(1) : a.slice(cut + 1));
    },
  },
  "normalize-test-command": { options: null, run: (g, a) => done({ command: normalizeTestCommand(a.join(" ")) }) },
  health: { options: { repair: "bool" }, run: (g, a, o) => health(g, o.repair) },
  "debug.create": { options: {}, run: (g) => debugCreate(g, json(g.stdin())) },
  "debug.status": { options: {}, run: (g, a) => debugStatus(g, a[0]) },
  "debug.list": { options: {}, run: (g) => debugList(g) },
  "debug.checkpoint": { options: {}, run: (g, a) => debugCheckpoint(g, a[0], json(g.stdin())) },
  "debug.budget": { options: {}, run: (g, a) => debugBudget(g, a[0], json(g.stdin())) },
  "debug.close": {
    // --evidence-stdin: stdin {evidence} (the verify rerun, ADPT-17) is appended to ## Evidence before closing.
    options: { outcome: "string", summary: "string", why: "string", guard: "string", "evidence-stdin": "bool" },
    run: (g, a, o) => debugClose(g, a[0], o.outcome, { ...o, ...(o["evidence-stdin"] ? { evidence: json(g.stdin()).evidence ?? null } : {}) }),
  },
  "upstream.vendor": { options: null, run: (g, a) => upstreamVerb(g, "vendor", a) },
  "upstream.build": { options: null, run: (g, a) => upstreamVerb(g, "build", a) },
  "upstream.check": { options: null, run: (g, a) => upstreamVerb(g, "check", a) },
  "upstream.bump": { options: null, run: (g, a) => upstreamVerb(g, "bump", a) },
  verbs: { options: {}, run: () => done({ ported: Object.keys(verbHandlers).sort() }) },
};

function decisionGate(g, a, blocking) {
  const phase = phaseOf(g, a);
  const r = decisionCoverage(phase, readPlans(phase));
  return done({ ...r, blocking }, blocking && !r.passed ? 1 : 0);
}

const parseMaybe = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
