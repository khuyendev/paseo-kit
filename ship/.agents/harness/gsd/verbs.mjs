// The ported verb handlers: verb -> {options (parseArgs spec, null = raw argv), usage (the -h text), help (false: -h and
// --help are the command's own), run(g, args, opts)}.
import path from "node:path";
import { textDigest } from "../lib/hash.mjs";
import { isInside } from "../lib/paths.mjs";
import { done, fail, idList, none, unavailable } from "./common.mjs";
import { frontmatterGet, frontmatterValidate, historyDigest, initPayload, initProject, listArtifacts, researchPrompt, summaryExtract, supersede, verifyArtifacts, verifyKeyLinks, writeArtifact } from "./artifacts.mjs";
import { contractsChange, contractsShow, verifyContractsVerb } from "./contracts.mjs";
import { debugBudget, debugCheckpoint, debugClose, debugCreate, debugExtend, debugList, debugStatus } from "./debug.mjs";
import { commitVerb, evaluationScope, selectRevertCommits } from "./gitverbs.mjs";
import { allowVerb } from "./allow.mjs";
import { grantPath } from "./grants.mjs";
import { haltClear } from "./halts.mjs";
import { requestClear, sharedClear } from "./owner-answers.mjs";
import { handoff, outlineCheck, outlineParseVerb, wavesVerb } from "./outline.mjs";
import { checkDependencies, checkOwns, checkSmokeBuilds, coverage, decisionCoverage, failureDirections, planStructure, verifyCommandPaths } from "./plan-checks.mjs";
import { findPhaseVerb, phaseAdd, phaseComplete, phaseInsert, phaseRemove, planIndex, requirementsVerb, roadmapVerb, uatPassed } from "./phases.mjs";
import { normPlanId, planIds, readPlan, readPlans, requirePhase } from "./planning.mjs";
import { ATTEMPT_KINDS, readAttempt, recordAttempt, revisionsVerb } from "./revisions.mjs";
import { captureBeforeRecord, listHandEdits, recordHandEdit, scanHandEdits } from "./hand-edits.mjs";
import { stateVerb } from "./state.mjs";
import { fingerprint, researchStatus, verificationParts, verificationStatusVerb } from "./status.mjs";
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

// Multi-value options such as `--files a b c` (taken until the next --option); after a bare `--` every token is positional.
function multi(args, names) {
  const out = Object.fromEntries(names.map((n) => [n, []]));
  const pos = [];
  let cur = null;
  let end = false;
  for (const a of args) {
    if (end) pos.push(a);
    else if (a === "--") end = true;
    else if (a.startsWith("--")) {
      if (!names.includes(a.slice(2))) throw fail(`unknown option ${a}`);
      cur = a.slice(2);
    } else if (cur) out[cur].push(a);
    else pos.push(a);
  }
  return { ...out, pos };
}

const state = (sub, usage, options = {}) => ({ usage, options: { phase: "string", status: "string", plan: "string", activity: "string", plans: "string", name: "string", wave: "string", text: "string", "text-file": "string", by: "string", milestone: "string", ...options }, run: (g, a, o) => stateVerb(g, sub, o) });
const init = (workflow) => ({ usage: `ph gsd init.${workflow} <phase>`, options: {}, run: (g, a) => initPayload(g, workflow, a[0]) });
// `--settings <digest>`: the effective settings of the key's judgments (the workflow's digest; absent = files only).
// Without --settings a record of a key the workflow checks with settings reuses the earlier digest (kit feedback 73). A record made
// by hand (outside a workflow run) first keeps what changed in the key's plans and artifacts as hand edits (kit feedback 68).
const revisions = (sub) => ({
  usage: `ph gsd revisions.${sub} <phase> <key> [--settings <digest>]`,
  options: { settings: "string" },
  run: (g, a, o) => {
    const phase = phaseOf(g, a);
    if (sub === "record" && a[1]) captureBeforeRecord(g, phase, a[1]);
    return revisionsVerb(g, sub, phase, a[1], o.settings ?? null);
  },
});

export const verbHandlers = {
  "init.project": { usage: "ph gsd init.project", options: {}, run: (g) => initProject(g) },
  "init.plan-phase": init("plan-phase"),
  "init.phase-op": init("phase-op"),
  "init.execute-phase": init("execute-phase"),
  "init.verify": init("verify"),
  "state.load": state("load", "ph gsd state.load"),
  "state.init": state("init", "ph gsd state.init [--milestone <name>]"),
  "state.position": state("position", "ph gsd state.position [--phase <N>] [--plan <NN-MM>] [--status <text>] [--activity <text>]"),
  "state.planned-phase": state("planned-phase", "ph gsd state.planned-phase --phase <N> --plans <ids> [--name <text>]"),
  "state.wave": state("wave", "ph gsd state.wave --phase <N> --wave <k> (--text <text> | --text-file <file> | stdin JSON {plans, verify, evidence})"),
  "state.decision": state("decision", "ph gsd state.decision (--text <text> | --text-file <file>) [--by <who>]"),
  "state.override": state("override", "ph gsd state.override (--text <text> | --text-file <file> | stdin JSON {reason, issues})"),
  "state.session-note": state("session-note", "ph gsd state.session-note (--text <text> | --text-file <file>)"),
  "state.rederive": state("rederive", "ph gsd state.rederive"),
  "roadmap.get-phase": { usage: "ph gsd roadmap.get-phase <N>", options: {}, run: (g, a) => roadmapVerb(g, "get-phase", a) },
  "roadmap.analyze": { usage: "ph gsd roadmap.analyze", options: {}, run: (g, a) => roadmapVerb(g, "analyze", a) },
  "roadmap.annotate-dependencies": { usage: "ph gsd roadmap.annotate-dependencies <N>", options: {}, run: (g, a) => roadmapVerb(g, "annotate-dependencies", a) },
  "roadmap.install-draft": { usage: "ph gsd roadmap.install-draft", options: {}, run: (g, a) => roadmapVerb(g, "install-draft", a) },
  "requirements.list": { usage: "ph gsd requirements.list", options: {}, run: (g, a) => requirementsVerb(g, "list", a) },
  "requirements.mark-complete": { usage: "ph gsd requirements.mark-complete <ids...>", options: {}, run: (g, a) => requirementsVerb(g, "mark-complete", a) },
  "requirements.revert": { usage: "ph gsd requirements.revert <N>", options: {}, run: (g, a) => requirementsVerb(g, "revert", a) },
  "find-phase": { usage: "ph gsd find-phase <ref>", options: {}, run: (g, a) => findPhaseVerb(g, a[0]) },
  "phase.add": { usage: "ph gsd phase.add <name...> [--goal <text>]", options: { goal: "string" }, run: (g, a, o) => done(phaseAdd(g, a.join(" "), o)) },
  "phase.insert": { usage: "ph gsd phase.insert <after> <name...> [--goal <text>]", options: { goal: "string" }, run: (g, a, o) => done(phaseInsert(g, a[0], a.slice(1).join(" "), o)) },
  "phase.remove": { usage: "ph gsd phase.remove <phase>", options: {}, run: (g, a) => done(phaseRemove(g, a[0])) },
  "phase.complete": { usage: "ph gsd phase.complete <phase>", options: {}, run: (g, a) => done(phaseComplete(g, a[0])) },
  "phase.uat-passed": { usage: "ph gsd phase.uat-passed <phase> [--require-verification] [--uat-only]", options: { "require-verification": "bool", "uat-only": "bool" }, run: (g, a, o) => uatPassed(g, phaseOf(g, a), { requireVerification: o["require-verification"], uatOnly: o["uat-only"] }) },
  "phase.list-plans": { usage: "ph gsd phase.list-plans <phase>", options: {}, run: (g, a) => done({ phase: phaseOf(g, a).number, plans: planIds(phaseOf(g, a)) }) },
  "phase.list-artifacts": { usage: "ph gsd phase.list-artifacts <phase> [--type <kind>]", options: { type: "string" }, run: (g, a, o) => listArtifacts(g, phaseOf(g, a), o.type) },
  "phase-plan-index": { usage: "ph gsd phase-plan-index <phase>", options: {}, run: (g, a) => planIndex(g, phaseOf(g, a)) },
  "halt.clear": { usage: "ph gsd halt.clear <phase> [--plan <NN-MM>] [--reason <text>] [--resume]", options: { plan: "string", reason: "string", resume: "bool" }, run: (g, a, o) => haltClear(g, phaseOf(g, a), o.plan, o.reason, o.resume === true) },
  "shared.clear": { usage: "ph gsd shared.clear <phase> <wave> [--path <file>] --reason <text>", options: { path: "string", reason: "string" }, run: (g, a, o) => sharedClear(g, phaseOf(g, a), a[1], o) },
  "request.clear": { usage: "ph gsd request.clear <phase> --plan <NN-MM> --path <file> --reason <text>", options: { plan: "string", path: "string", reason: "string" }, run: (g, a, o) => requestClear(g, phaseOf(g, a), o.plan, o) },
  grant: { usage: "ph gsd grant <phase> --path <file> [--plan <NN-MM>]", options: { path: "string", plan: "string" }, run: (g, a, o) => grantPath(g, phaseOf(g, a), o.path, o.plan) },
  allow: { usage: "ph gsd allow <phase | debug> --path <file> --reason <text>", options: { path: "string", reason: "string" }, run: (g, a, o) => allowVerb(g, a[0], o) },
  "verify.plan-structure": {
    usage: "ph gsd verify.plan-structure <phase | path/NN-MM-PLAN.md> [--plans <ids>]",
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
  // Kit feedback 67, 76: the cross-plan contracts of the manifest against the plans (and, for 'contracts change', the one writer).
  "verify.contracts": {
    usage: "ph gsd verify.contracts <phase> [--plans <ids>] [--complete]",
    options: { plans: "string", complete: "bool" },
    run: (g, a, o) => {
      const phase = phaseOf(g, a);
      return verifyContractsVerb(g, phase, { plans: subset(o, phase), complete: bool(o.complete, false) });
    },
  },
  "contracts.show": { usage: "ph gsd contracts.show <phase> --plan <NN-MM>", options: { plan: "string" }, run: (g, a, o) => {
    if (!o.plan) throw fail("contracts show needs --plan <NN-MM>");
    return contractsShow(g, phaseOf(g, a), normPlanId(o.plan));
  } },
  "contracts.change": { usage: "ph gsd contracts.change <phase> (stdin JSON {plan, symbol, old, new, reason})", options: {}, run: (g, a) => contractsChange(g, phaseOf(g, a), json(g.stdin())) },
  "verify.artifacts": { usage: "ph gsd verify.artifacts <phase | path/NN-MM-PLAN.md> [--plans <ids>]", options: { plans: "string" }, run: (g, a, o) => verifyArtifacts(g, planScope(g, a, o).plans) },
  "verify.key-links": {
    usage: "ph gsd verify.key-links <phase | path/NN-MM-PLAN.md> [--plans <ids>]",
    options: { plans: "string" },
    run: (g, a, o) => {
      const s = planScope(g, a, o);
      return verifyKeyLinks(g, s.plans, s.allPlans);
    },
  },
  "verification.status": { usage: "ph gsd verification.status <phase>", options: {}, run: (g, a) => verificationStatusVerb(g.codeRoot, phaseOf(g, a)) },
  "verification.fingerprint": { usage: "ph gsd verification.fingerprint <phase> [extra files...]", options: {}, run: (g, a) => done(fingerprint(g.codeRoot, phaseOf(g, a), a.slice(1))) },
  // Kit feedback 66: the parts of a per-criterion verify, checked (parts) or merged into the report (merge).
  "verification.parts": { usage: "ph gsd verification.parts <phase> (stdin JSON {attemptKey, parts: [{id: SC-<k>|phase, path, text}]})", options: {}, run: (g, a) => verificationParts(g.codeRoot, phaseOf(g, a), json(g.stdin()), false) },
  "verification.merge": { usage: "ph gsd verification.merge <phase> (stdin JSON {attemptKey, parts: [{id: SC-<k>|phase, path, text}]})", options: {}, run: (g, a) => verificationParts(g.codeRoot, phaseOf(g, a), json(g.stdin()), true) },
  "check.coverage": {
    usage: "ph gsd check.coverage <phase>",
    options: {},
    run: (g, a) => {
      const r = coverage(g, phaseOf(g, a), readPlans(phaseOf(g, a)));
      return done(r, r.passed ? 0 : 1);
    },
  },
  "check.decision-coverage": { usage: "ph gsd check.decision-coverage <phase>", options: {}, run: (g, a) => decisionGate(g, a, true) },
  "check.decision-coverage-plan": { usage: "ph gsd check.decision-coverage-plan <phase>", options: {}, run: (g, a) => decisionGate(g, a, true) },
  "check.decision-coverage-verify": { usage: "ph gsd check.decision-coverage-verify <phase>", options: {}, run: (g, a) => decisionGate(g, a, false) },
  "check.verify-command-paths": { usage: "ph gsd check.verify-command-paths <phase> [--plans <ids>]", options: { plans: "string" }, run: async (g, a, o) => done(await verifyCommandPaths(g, phaseOf(g, a), readPlans(phaseOf(g, a), subset(o, phaseOf(g, a))))) },
  "check.verify-failure-directions": { usage: "ph gsd check.verify-failure-directions <phase> [--plans <ids>]", options: { plans: "string" }, run: (g, a, o) => done(failureDirections(g, readPlans(phaseOf(g, a), subset(o, phaseOf(g, a))))) },
  "check.owns": { usage: "ph gsd check.owns <phase> [--plans <ids>]", options: { plans: "string" }, run: (g, a, o) => checkOwns(g, phaseOf(g, a), subset(o, phaseOf(g, a))) },
  "check.dependencies": { usage: "ph gsd check.dependencies <phase> [--plans <ids>]", options: { plans: "string" }, run: (g, a, o) => checkDependencies(g, phaseOf(g, a), readPlans(phaseOf(g, a), subset(o, phaseOf(g, a)))) },
  "check.smoke": { usage: "ph gsd check.smoke", options: {}, run: (g) => checkSmokeBuilds(g) },
  "check.evaluation-scope": {
    usage: "ph gsd check.evaluation-scope (--phase <N> | --plan <NN-MM> | --quick <id>) [--since <rev>] [--commits-only] [--max-commits <n>]",
    options: { phase: "string", plan: "string", quick: "string", since: "string", "commits-only": "bool", "max-commits": "string" },
    run: (g, a, o) => evaluationScope(g, { phase: o.phase, plan: o.plan, quick: o.quick, since: o.since, commitsOnly: o["commits-only"], maxCommits: o["max-commits"] ? Number(o["max-commits"]) : undefined }),
  },
  "outline.parse": { usage: "ph gsd outline.parse <phase>", options: {}, run: (g, a) => outlineParseVerb(g, phaseOf(g, a)) },
  "outline.check": {
    usage: "ph gsd outline.check <phase> [--tracer <bool>] [--plans-per-phase <n>] [--waves-per-phase <n>] [--files-per-plan error|warn]",
    options: { tracer: "string", "plans-per-phase": "string", "waves-per-phase": "string", "files-per-plan": "string" },
    run: (g, a, o) => {
      if (o["files-per-plan"] !== undefined && !["error", "warn"].includes(o["files-per-plan"])) throw fail("--files-per-plan takes error or warn");
      return outlineCheck(g, phaseOf(g, a), { tracer: bool(o.tracer, true), plansPerPhase: Number(o["plans-per-phase"]) || undefined, wavesPerPhase: Number(o["waves-per-phase"]) || undefined, filesPerPlan: o["files-per-plan"] });
    },
  },
  waves: { usage: "ph gsd waves <phase> [--plans <ids>]", options: { plans: "string" }, run: (g, a, o) => wavesVerb(g, phaseOf(g, a), subset(o, phaseOf(g, a))) },
  handoff: { usage: "ph gsd handoff <phase> [--plans <ids>] [--prefix <text>] [--no-tracer-split]", options: { plans: "string", prefix: "string", "no-tracer-split": "bool" }, run: (g, a, o) => handoff(g, phaseOf(g, a), { subset: subset(o, phaseOf(g, a)), prefix: o.prefix, noTracerSplit: o["no-tracer-split"] === true }) },
  "hand-edit.scan": { usage: "ph gsd hand-edit.scan <phase>", options: {}, run: (g, a) => scanHandEdits(g, phaseOf(g, a)) },
  "hand-edit.record": {
    usage: "ph gsd hand-edit.record <phase> <HE-n|plan:<id>|file> --category <contract-drift|wrong-api|owns-reach|test-fixture|other> --note <one line>",
    options: { category: "string", note: "string" },
    run: (g, a, o) => recordHandEdit(g, phaseOf(g, a), a[1], { category: o.category, note: o.note }),
  },
  "hand-edit.list": { usage: "ph gsd hand-edit.list <phase>", options: {}, run: (g, a) => listHandEdits(g, phaseOf(g, a)) },
  "revisions.record": revisions("record"),
  "revisions.check": revisions("check"),
  "revisions.hash": revisions("hash"),
  "revisions.show": revisions("show"),
  supersede: {
    usage: "ph gsd supersede <phase> --keep <ids>",
    options: { keep: "string" },
    run: (g, a, o) => {
      if (o.keep === undefined) throw fail("supersede needs --keep <ids>");
      const phase = phaseOf(g, a);
      return supersede(g, phase, subset({ plans: o.keep }, phase));
    },
  },
  "attempt.record": {
    usage: "ph gsd attempt.record <phase> --kind <gap|verify|research> (--run-id <id> [--input-digest <d>] [--before <text>] [--done <bool>] [--result <json>] | stdin JSON)",
    options: { kind: "string", "run-id": "string", "input-digest": "string", before: "string", done: "string", result: "string" },
    run: (g, a, o) => {
      const phase = phaseOf(g, a);
      const input = o["run-id"] ? { runId: o["run-id"], inputDigest: o["input-digest"], before: o.before, done: o.done === undefined ? undefined : bool(o.done, false), result: o.result === undefined ? undefined : parseMaybe(o.result) } : json(g.stdin());
      return done(recordAttempt(phase, o.kind, input));
    },
  },
  "attempt.show": {
    usage: "ph gsd attempt.show <phase> --kind <gap|verify|research>",
    options: { kind: "string" },
    run: (g, a, o) => {
      if (!ATTEMPT_KINDS.has(o.kind)) throw fail("--kind must be gap, verify or research");
      const at = readAttempt(phaseOf(g, a), o.kind);
      if (!at) throw none(`no ${o.kind} attempt recorded`);
      return done(at);
    },
  },
  write: { usage: "ph gsd write <phase> <NAME> (text on stdin)", options: {}, run: (g, a) => writeArtifact(g, a[0], a[1], g.stdin()) },
  hash: { usage: "ph gsd hash (text on stdin)", options: {}, run: (g) => done({ hash: textDigest(g.stdin()) }) },
  "research.status": { usage: "ph gsd research.status <phase>", options: {}, run: (g, a) => researchStatus(g, phaseOf(g, a)) },
  "research.prompt": { usage: "ph gsd research.prompt <phase>", options: {}, run: (g, a) => researchPrompt(g, phaseOf(g, a)) },
  "frontmatter.get": { usage: "ph gsd frontmatter.get <file> <key>", options: {}, run: (g, a) => frontmatterGet(g, a[0], a[1]) },
  "frontmatter.validate": { usage: "ph gsd frontmatter.validate <file> --schema <name>", options: { schema: "string" }, run: (g, a, o) => frontmatterValidate(g, a[0], o.schema) },
  "summary-extract": {
    usage: "ph gsd summary-extract <glob...> [--fields <a,b>]",
    options: null,
    run: (g, a) => {
      const m = multi(a, ["fields"]);
      return summaryExtract(g, m.pos, m.fields.join(","));
    },
  },
  "history-digest": { usage: "ph gsd history-digest", options: {}, run: (g) => historyDigest(g) },
  commit: {
    usage: "ph gsd commit <message...> --files <paths...> [--files-removed <paths...>]",
    options: null,
    run: (g, a) => {
      const m = multi(a, ["files", "files-removed"]);
      return commitVerb(g, m.pos.join(" "), m.files, m["files-removed"]);
    },
  },
  "select-revert-commits": { usage: "ph gsd select-revert-commits (--phase <N> | --plan <NN-MM>) --range <revs>", options: { phase: "string", plan: "string", range: "string" }, run: (g, a, o) => selectRevertCommits(g, o) },
  "run-with-timeout": {
    usage: "ph gsd run-with-timeout <seconds> -- <command...>",
    // The wrapped command owns its -h and --help: without a `--`, `run-with-timeout 30 npm test --help` must still run it.
    help: false,
    options: null,
    run: (g, a) => {
      const cut = a.indexOf("--");
      return runWithTimeout(g, a[0], cut < 0 ? a.slice(1) : a.slice(cut + 1));
    },
  },
  "normalize-test-command": { usage: "ph gsd normalize-test-command <command...>", help: false, options: null, run: (g, a) => done({ command: normalizeTestCommand(a.join(" ")) }) },
  health: { usage: "ph gsd health [--repair]", options: { repair: "bool" }, run: (g, a, o) => health(g, o.repair) },
  "debug.create": { usage: "ph gsd debug.create (stdin JSON)", options: {}, run: (g) => debugCreate(g, json(g.stdin())) },
  "debug.status": { usage: "ph gsd debug.status <slug>", options: {}, run: (g, a) => debugStatus(g, a[0]) },
  "debug.list": { usage: "ph gsd debug.list", options: {}, run: (g) => debugList(g) },
  "debug.checkpoint": { usage: "ph gsd debug.checkpoint <slug> (stdin JSON)", options: {}, run: (g, a) => debugCheckpoint(g, a[0], json(g.stdin())) },
  "debug.budget": { usage: "ph gsd debug.budget <slug> (stdin JSON)", options: {}, run: (g, a) => debugBudget(g, a[0], json(g.stdin())) },
  "debug.extend": { usage: "ph gsd debug.extend <slug> (stdin JSON {turns, minutes, reason})", options: {}, run: (g, a) => debugExtend(g, a[0], json(g.stdin())) },
  "debug.close": {
    // --evidence-stdin: stdin {evidence} (the verify rerun, ADPT-17) is appended to ## Evidence before closing.
    usage: "ph gsd debug.close <slug> --outcome <text> [--summary <text>] [--why <text>] [--guard <text>] [--evidence-stdin]",
    options: { outcome: "string", summary: "string", why: "string", guard: "string", "evidence-stdin": "bool" },
    run: (g, a, o) => debugClose(g, a[0], o.outcome, { ...o, ...(o["evidence-stdin"] ? { evidence: json(g.stdin()).evidence ?? null } : {}) }),
  },
  "upstream.vendor": { usage: "ph gsd upstream.vendor --from <clone> [--commit <sha>] [--target <checkout>]", options: null, run: (g, a) => upstreamVerb(g, "vendor", a) },
  "upstream.build": { usage: "ph gsd upstream.build [--target <checkout>]", options: null, run: (g, a) => upstreamVerb(g, "build", a) },
  "upstream.check": { usage: "ph gsd upstream.check [--target <checkout>] [--verbose]", options: null, run: (g, a) => upstreamVerb(g, "check", a) },
  "upstream.bump": { usage: "ph gsd upstream.bump --from <clone> --commit <sha> [--target <checkout>] [--verbose]", options: null, run: (g, a) => upstreamVerb(g, "bump", a) },
  verbs: { usage: "ph gsd verbs", options: {}, run: () => done({ ported: Object.keys(verbHandlers).sort() }) },
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
