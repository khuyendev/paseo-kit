// THIN.md stage 2 (TE, kit feedback 87): the agent prompts of gsd-execute are kit templates. A template's optional parts are
// sections ({{#name}} kept when set, {{^name}} when not); every execute template renders byte-identical to the prompt the script
// built inline before the move (04e008f), so the journal keys a resumed run replays do not change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, renderPrompt } from "../../ship/.agents/workflows/lib/flow-prompt.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

const root = makeTempDir("te prompt ");
const render = (name, vars) => renderPrompt(root, name, vars).text;
// Every combination of the given flags, as objects.
const combos = (names) => Array.from({ length: 2 ** names.length }, (_, n) => Object.fromEntries(names.map((k, i) => [k, Boolean(n & (1 << i))])));

test("TE template sections: {{#x}} kept when set, {{^x}} when not; a tag alone on its line takes its line break", () => {
  const t = "a\n{{#x}}\nX {{v}}\n{{/x}}\n{{^x}}\nnot x\n{{/x}}\nb {{#y}}Y{{/y}}{{^y}}N{{/y}} c";
  assert.equal(fillTemplate(t, { x: true, v: 1, y: "s" }).text, "a\nX 1\nb Y c");
  assert.equal(fillTemplate(t, { x: false, y: "" }).text, "a\nnot x\nb N c");
  assert.equal(fillTemplate(t, { x: 0, y: 2 }).text, "a\nnot x\nb Y c");
  // A variable only a dropped section names needs no value; the section variable always does.
  assert.deepEqual(fillTemplate(t, { x: false, y: "", v: 9 }).unused, ["v"]);
  assert.throws(() => fillTemplate(t, { y: "" }), /no value for \{\{#x\}\}/);
  assert.throws(() => fillTemplate(t, { x: ["a"], y: "" }), /\{\{#x\}\} must be a string, number or boolean/);
  assert.throws(() => fillTemplate("{{#x}}\n{{v}}\n{{/x}}", { x: true }), /no value for \{\{v\}\}/);
  // Values are never read as template text.
  assert.equal(fillTemplate("{{v}}", { v: "{{#x}}a{{/x}}" }).text, "{{#x}}a{{/x}}");
  // Without sections a template renders as before.
  assert.equal(fillTemplate("p {{a}}\n\nq", { a: "1" }).text, "p 1\n\nq");
});

// ---- the inline prompts of gsd-execute 04e008f (copied) ----
const GEN = (regenerated) => `A file matching ${JSON.stringify(regenerated)} is generated: a change to it is made through its generator, so its request also names via (the generator command) and outputs (every file the generator rewrites, that file included); a request for it without them is refused.`;
const DEFECT_NOTE = "Measurement only (it changes nothing in how your reply is judged): when the plan itself was wrong (it named an API, file or symbol that does not exist or behaves otherwise, its owns did not reach a file the work needed, or it missed a dependency), list each such plan defect in plan_defects [{kind: wrong-api|owns-reach|missing-dependency|other, evidence}]; an empty list otherwise.";
const CATCH_NOTE = "Measurement only (it changes nothing in how your verdict is used): for each finding you answer confirmed, also give plan_catchable yes when a review of the plan, before any code was written, could have caught it (the plan named a wrong API, file or behaviour, or missed a requirement, an owned path, a dependency or the edge case the defect hits), no when only the code shows it, with catch_reason in one sentence.";
function oldExecutor({ planFile, mainRoot, summary, owns, stackSkill, generated, pendingOn, metricsOn, answers, notes, reqs, digest }) {
  const runtime = [
    "<kit_executor_runtime>",
    `Plan: ${planFile}`,
    mainRoot ? `Planning inputs (.planning/ files, the stack skill) are read, read-only, from the immutable input snapshot ${mainRoot}: they may not be committed into your worktree. Write code and your SUMMARY only in your worktree.` : null,
    `Write your SUMMARY to exactly: ${summary}`,
    `You may edit only these paths (owns): ${JSON.stringify(owns)}`,
    `Stack skill to follow: ${stackSkill}`,
    "Deviation rules (the kit adapter of the rules in your role text):",
    "- Rules 1-3 (bugs, missing critical functionality, blockers): fix automatically, only inside owns; at most 3 auto-fix attempts per task, then list it under Deferred Issues in the SUMMARY.",
    "- Rule 3 never covers package installs: a needed install, or one that fails, returns a blocking human checkpoint (task status blocked, deviation {rule: 3, kind: checkpoint}).",
    "- Rule 4 (architectural change): stop the task and return status partial with the decision needed in the deviation notes ({rule: 4, note}).",
    "- A change needed in a file you do not own: do not edit it; return it in requests [{path, change, reason}].",
    generated ? `- ${generated}` : null,
    pendingOn ? "- A task that is done on your side but whose test or check passes only once a request you returned is made (you may not run the tests): status pending-request with blockedBy [the request paths], not partial. partial is only for a decision the owner must make." : null,
    "- Observations about the kit, its tools or its wrappers (not about the project) go in kitNotes [string]; never in a request: a request for a kit-feedback document is refused.",
    "- Before you return, delete every file you created outside owns (your SUMMARY excepted): scratch files are cleanup, not a Rule-4 decision.",
    "- Never commit, stage or stash; never write STATE, ROADMAP or REQUIREMENTS.",
    "- The orchestrator's gate runs the build and the tests after the wave: do not run them yourself.",
    `Return JSON {taskResults: [{task, status: implemented|${pendingOn ? "pending-request|" : ""}partial|blocked|skipped, evidence${pendingOn ? ", blockedBy" : ""}}], deviations: [{rule, kind, note}], requests: [{path, change, reason}], kitNotes: [string]}.`,
    metricsOn ? DEFECT_NOTE : null,
    "</kit_executor_runtime>",
  ].filter(Boolean).join("\n");
  return [
    runtime,
    answers.length ? `Owner answers to earlier halts of this plan (JSON); follow them: ${JSON.stringify(answers)}` : "",
    notes.length ? `Plan-review notes for this plan (medium or low, not blocking; act on each one inside your owns, else say why in your SUMMARY): ${JSON.stringify(notes)}` : "",
    reqs.length ? `Change requests from other plans for files you own (JSON): ${JSON.stringify(reqs)}. Make them inside your owns and list each request path you resolved in resolvedRequests.` : "",
    digest,
  ].filter(Boolean).join("\n\n");
}
const failureText = (list) => list.map((f) => `- ${f.step}${f.plan ? ` (plan ${f.plan})` : ""}: ${f.outcome ?? "failed"}; full log ${f.log ?? "n/a"}\n${String(f.excerpt ?? "").split(/\r?\n/).map((l) => `    ${l}`).join("\n")}`).join("\n");
function oldFixer({ owns, generated, verifies, build, testArgv, attempts, minutes, metricsOn, findings, failures, reqs, digest }) {
  const block = verifies
    ? `After your changes run the build (${JSON.stringify(build)}) and the tests through \`ph gsd test-run\` at most ${attempts} times and within ${minutes} minutes; a run counts only for the failing files named to you (this allowance is at least the number of failing files plus 2). Stop early when two consecutive attempts do not reduce the failure count. If you edit after your last run, run the build and the tests once more on that edit before you answer, even past those limits. The verb takes the project test lock, passes the per-test timeout, bounds each file and writes the full output to a file; read failures from that file, never from a truncated terminal. The suite command is ${JSON.stringify(testArgv)}. Judge yourself only on the failures and findings given to you: a failure in a file you do not own is not yours and does not make your status unresolved. An unverified last edit is not an owner decision: the next gate verifies it. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is verified (a build and test run followed your last edit), unverified (none did) or none (you made no edit).`
    : "Do not run the build or the tests: the orchestrator's gate verifies your changes. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is unverified (you edited) or none (you made no edit).";
  const text = [`<kit_fixer_runtime>\nYou own: ${JSON.stringify(owns)}. Fix the confirmed review findings and gate failures below, nothing else; a finding with instances is fixed at every instance. Never commit. A change needed in a file you do not own: do not make it (not even a rename or an import tweak to dodge a clash); return it in requests [{path, change, reason}].${generated ? ` ${generated}` : ""}\n${block}${metricsOn ? `\n${DEFECT_NOTE}` : ""}\n</kit_fixer_runtime>`, findings.length ? `Confirmed findings (JSON): ${JSON.stringify(findings)}` : "", failures.length ? `Gate failures:\n${failureText(failures)}` : ""].filter(Boolean).join("\n\n");
  return [text, reqs.length ? `Change requests from other plans of this wave (JSON): ${JSON.stringify(reqs)}` : "", digest].filter(Boolean).join("\n\n");
}
const FAILS = [{ step: "test", plan: "01-01", outcome: "failed", log: "e/1.log", excerpt: "line a\r\nline b" }, { step: "build", excerpt: "x" }];
const FINDINGS = [{ id: "F1", file: "src/a.js", line: 3, trigger: "t", description: "d", class: "c", instances: [{ file: "src/b.js", line: 1 }] }];
const REQS = [{ from: "01-02", path: "src/01-01/a.js", change: "export x" }];

test("TE the executor template renders the inline executor brief byte for byte (every optional part on and off)", () => {
  for (const c of combos(["snapshot", "generated", "pending", "metrics", "answers", "notes", "reqs"])) {
    const v = {
      planFile: c.snapshot ? "C:/snap/.planning/phases/01-core/01-01-PLAN.md" : ".planning/phases/01-core/01-01-PLAN.md", mainRoot: c.snapshot ? "C:/snap" : null,
      summary: ".planning/phases/01-core/01-01-SUMMARY.md", owns: ["Path:src/01-01/", "x.md"], stackSkill: c.snapshot ? "C:/snap/.claude/skills/s/SKILL.md" : "none",
      generated: c.generated ? GEN(["lib/**/*.g.dart"]) : "", pendingOn: c.pending, metricsOn: c.metrics,
      answers: c.answers ? [{ halt: "h", answer: "a" }] : [], notes: c.notes ? [{ severity: "low", description: "n" }] : [], reqs: c.reqs ? REQS : [], digest: "Input digest (plan:01-01): h-01-01",
    };
    // accepted (kit feedback 89) is empty: the inline brief had no such part, and an empty one adds no byte.
    const got = render("executor", { plan: v.planFile, snapshot: v.mainRoot ?? "", summary: v.summary, owns: JSON.stringify(v.owns), stackSkill: v.stackSkill, generated: c.generated ? JSON.stringify(["lib/**/*.g.dart"]) : "", pending: v.pendingOn, metrics: v.metricsOn, answers: v.answers.length ? JSON.stringify(v.answers) : "", notes: v.notes.length ? JSON.stringify(v.notes) : "", accepted: "", requests: v.reqs.length ? JSON.stringify(v.reqs) : "", digest: v.digest });
    assert.equal(got, oldExecutor(v), JSON.stringify(c));
  }
});

test("TE the fixer template renders the inline fixer prompt byte for byte (verifying itself or not, findings, failures, requests)", () => {
  for (const c of combos(["generated", "verifies", "metrics", "findings", "failures", "reqs"])) {
    const v = { owns: ["Path:src/"], generated: c.generated ? GEN(["a.g"]) : "", verifies: c.verifies, build: ["npm", "run", "build"], testArgv: null, attempts: 3, minutes: 20, metricsOn: c.metrics, findings: c.findings ? FINDINGS : [], failures: c.failures ? FAILS : [], reqs: c.reqs ? REQS : [], digest: "Input digest (fix:w1): x" };
    const got = render("fixer", { owns: JSON.stringify(v.owns), generated: c.generated ? JSON.stringify(["a.g"]) : "", stackSkill: "", verifies: v.verifies, build: String(JSON.stringify(v.build)), tests: String(JSON.stringify(v.testArgv)), attempts: String(v.attempts), minutes: String(v.minutes), metrics: v.metricsOn, findings: v.findings.length ? JSON.stringify(v.findings) : "", failures: failureText(v.failures), requests: v.reqs.length ? JSON.stringify(v.reqs) : "", digest: v.digest });
    assert.equal(got, oldFixer(v), JSON.stringify(c));
  }
});

test("TE the fix-round, integration, shared-change, review, verifier, resolution and resolver templates match their inline prompts", () => {
  for (const c of combos(["failures", "reqs"])) {
    const old = [`Fix round 2 for plan 01-01: the gate failed on your owned files. Fix only inside your owns; do not run the build or the tests.`, failureText(c.failures ? FAILS : []), c.reqs ? `Change requests from other plans of this wave (JSON): ${JSON.stringify(REQS)}` : "", "Evidence: undefined", "Return the same JSON as before, with resolvedRequests listing only request paths you actually resolved.", "D"].filter(Boolean).join("\n\n");
    assert.equal(render("executor-fix", { round: 2, plan: "01-01", failures: failureText(c.failures ? FAILS : []), requests: c.reqs ? JSON.stringify(REQS) : "", evidence: String(undefined), tests: "", digest: "D" }), old);
  }
  assert.equal(render("integration-fix", { files: JSON.stringify(["a", "b"]), failures: failureText(FAILS), tests: "", digest: "D" }), [`Integration fix: these gate failures belong to no plan. You own exactly these files: ${JSON.stringify(["a", "b"])}.`, failureText(FAILS), "Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.", "D"].join("\n\n"));
  const SHARED_NOTE = "Check only the shared files you changed (a syntax, format or analysis check of those files). Do not run other test files or whole suites: the gate that follows verifies the change, and a failure outside these files belongs to the plan fixers that gate runs. Name such a failure in outside, and still report your changes.";
  const SHARED_REPORT = "Report per change. Return JSON {changes: [{index, applied, evidence}], status: fixed|unresolved, attempts, remaining_failures, evidence, outside}: applied is true when that change is present in its file (made by you or already there); status is unresolved only when a change could not be made.";
  for (const via of [true, false]) {
    const old = [`Shared changes for wave 1: no open plan of the phase owns these paths, so you make them. You own exactly these files: ["s.js"]. Make each change below and nothing else; never commit.`, `Changes (JSON): [{"index":0}]`, via ? "A change with via is made by running that generator command (it rewrites every file in its outputs); never edit a generated file by hand." : "", SHARED_NOTE, SHARED_REPORT, "D"].filter(Boolean).join("\n\n");
    assert.equal(render("shared-changes", { label: "wave 1", files: '["s.js"]', changes: '[{"index":0}]', via, digest: "D" }), old);
  }
  for (const codeOnly of [true, false]) {
    const old = [
      "Review plan 01-01 (.planning/phases/01-core/01-01-PLAN.md) at depth standard. Review only these files: a.js, b.js.",
      "Lines this plan changed:\n- a.js: 1-3\n- b.js: all (new file)",
      codeOnly ? "This code is not built yet (code-only review)." : "The wave is built and its tests are green.",
      "Lenses:\n- correctness: Follow the lens text in .agents/workflows/lenses/correctness.md.",
      "Every finding carries trigger (the concrete input or sequence that makes it fail), likelihood (likely|possible|theoretical), confidence 0-100, impact, file and line.",
      "Set introduced true when this plan's change causes the defect, also on an unchanged line (a caller broken by a changed signature); false when the defect was there before the change. A defect outside the changed lines that the change did not cause is recorded as pre-existing and does not block.",
      "Report one defect once: when the same defect occurs in several places, give it a class (a short name of the defect kind) and list every other place in the reviewed files as instances [{file, line}], so one fix covers all of them.",
      `Return JSON {findings: [{id, severity (critical|high|medium|low|info), trigger, likelihood, confidence, impact, file, line, description, introduced, class, instances}]}; an empty findings list when nothing needs fixing.`,
      "D",
    ].join("\n\n");
    assert.equal(render("code-review", { plan: "01-01", planPath: ".planning/phases/01-core/01-01-PLAN.md", depth: "standard", scope: "a.js, b.js", lines: "- a.js: 1-3\n- b.js: all (new file)", codeOnly, built: "The wave is built and its tests are green.", lenses: "- correctness: Follow the lens text in .agents/workflows/lenses/correctness.md.", stackSkill: "", digest: "D" }), old);
  }
  for (const metricsOn of [true, false]) {
    const asked = metricsOn ? ["Return JSON {verdicts: [{id, verdict, evidence, plan_catchable, catch_reason}]}.", CATCH_NOTE] : ["Return JSON {verdicts: [{id, verdict, evidence}]}."];
    const old = [`Verify these review findings of plan 01-01 independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.`, `Findings (JSON): ${JSON.stringify(FINDINGS)}`, ...asked, "D"].join("\n\n");
    assert.equal(render("finding-verifier", { plan: "01-01", findings: JSON.stringify(FINDINGS), stackSkill: "", metrics: metricsOn, digest: "D" }), old);
  }
  assert.equal(render("resolution-check", { plan: "01-01", findings: JSON.stringify(FINDINGS), digest: "D" }), [`Resolution check of plan 01-01: decide for each finding below whether the current code resolves it; a finding with instances is resolved only when every instance is. Review only these findings; raise no new ones.`, `Findings (JSON): ${JSON.stringify(FINDINGS)}`, "Return JSON {resolution: [{id, resolved, evidence}]}.", "D"].join("\n\n"));
  const RESOLVER_NOTE = "Cross-plan change requests were made while the plans of this phase ran. Decide read-only, for each request below, whether the current code already satisfies it: the change is present in the named file in this or an equivalent form that serves the request's reason. Read only the named files; raise nothing new.";
  assert.equal(render("request-resolver", { requests: '[{"id":"R1"}]', digest: "D" }), [RESOLVER_NOTE, 'Requests (JSON): [{"id":"R1"}]', "Return JSON {resolution: [{id, resolved, evidence}]}.", "D"].join("\n\n"));
});
