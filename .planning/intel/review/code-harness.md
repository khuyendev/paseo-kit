# Code review: HAR — harness and project adapter

## Verdict

REVISE — 5 BLOCKER, 4 MAJOR, 0 MINOR. The carried method text and provenance compare successfully with `ref-final`: all 15 source fixtures match the tag after LF normalization, and the inventoried changes are adapter changes rather than method rewrites. The harness suite reports 38 passed, 0 failed; it does not establish the integrated ADPT behavior. Tracing the tested helpers into their actual consumers exposes false-green gates, incorrect verify argv, incomplete evidence accepted as proof, and resolver failures accepted as successful checks. The mutex also loses exclusion during stale recovery. Additional mandatory lint checks and the two-stack generator acceptance are missing. No live project, daemon or owner configuration was used; supplementary probes used in-memory filesystem/process fakes. The findings that cross into `flow-gate.mjs` concern the ADPT contracts and their disconnected tests in this review area, and should be coordinated with the GSDF fixes.

## Findings

### CR-HAR-01 BLOCKER correctness Null build/test commands still produce a green post-wave gate

- Severity: BLOCKER.
- Category: correctness.
- Where: `tests/harness/adapter.test.mjs:34-40`; `ship/.agents/harness/adapter/contract.mjs:78-83`; consumer `ship/.agents/workflows/lib/flow-gate.mjs:96-99,131-134` (ADPT-02).
- Evidence: The ADPT-02 test checks only the unused `commandFor()` helper and an isolated `runArgv()` call. The actual gate adds a note for each null command, but no failed/not-configured step. Its final green decision considers only existing steps. With the shipped neutral adapter and `{waveId:"w1",plans:[]}`, an in-memory execution of the actual gate returned `green:true`, `failureCount:0`, and notes saying both build and tests are not configured. A wave with passing obligations has the same omission. The requirement explicitly says null commands never count green and must block tracking.
- Fix: Use the shared command contract in the real gate; emit build and test steps with `outcome:"not_configured"` when null and include them in the red decision. Extend ADPT-02 to call the real gate with build-null, test-null and both-null fixtures and assert non-green evidence and no tracking advancement.

### CR-HAR-02 BLOCKER correctness The real verify runner ignores placeholder substitution and swallows parser failure

- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/adapter/contract.mjs:24-31,61-75`; `tests/harness/adapter.test.mjs:43-63`; consumer `ship/.agents/workflows/lib/flow-gate.mjs:105-112` (ADPT-03, ADPT-15; INV-36).
- Evidence: The helper correctly substitutes `{argument}` and expands `{targets}`, but the actual gate does not call it: it constructs `[...rc.argv, ...targets]`. The generated example at `ship/.claude/skills/harness/references/kit-adapter.md:85` therefore sends the literal `{targets}` to the test runner, followed by additional targets. A probe of the real gate observed `["node","runner","{argument}","{targets}","login flow"]`. In the same path, a failed parser response becomes `targets = pr.targets ?? targets`; execution continues instead of recording an unavailable obligation. With an exit-code-sufficient kind and a successful fake runner, the gate reported green despite the injected parser failure. The unit test proves the helper, not the invocation that users run.
- Fix: Build actual gate argv through `obligationCommand()`/`substitutePlaceholders()`, use the documented default parser when no parser is configured, and stop that obligation with an unavailable/unresolvable result when parsing fails. Add an integrated gate test that captures the exact runner argv for spaced targets and verifies that a parser failure does not spawn a runner or certify green.

### CR-HAR-03 BLOCKER correctness Gate evidence has a tested validator that production bypasses

- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/adapter/evidence.mjs:23-73`; `tests/harness/adapter.test.mjs:245-268`; consumer `ship/.agents/workflows/lib/flow-gate.mjs:74,128-134,156-169` (ADPT-17; INV-35, INV-36, INV-53).
- Evidence: `evidenceVerdict()` is referenced only by the harness test, not a shipped consumer. Production writes `executed:null` for ordinary steps, which this validator rejects because it expects `{count,targets}`. Production instead uses `evidenceCheck()`, which neither checks required step completeness nor executed targets nor HEAD equality, and permits a null log. A memory-only probe with `{v:1,steps:[],inputs:{head:"different",files:{}}}` returned `{valid:true,status:"current",code:0}`. Thus a truncated evidence file can certify a gate without build, test or obligation proof. The standalone validator also trusts a claimed `outcome:"passed"` without checking `exitCode`, including for an exit-code-sufficient obligation.
- Fix: Make the writer and every gate/verify/debug consumer use one ADPT-17 schema and validator. Derive the required step list and targets from current plans/config, not the evidence being checked; require valid logs, consistent exit status, current HEAD and input hashes, and actual target execution where required. Normalize `executed` to the contract shape. Replace helper-only acceptance with writer-to-reader tests for missing steps, empty steps, zero execution, contradictory exit codes, missing logs and changed inputs/HEAD.

### CR-HAR-04 BLOCKER correctness Stale mutex recovery can delete a new owner's lock

- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/adapter/mutex.mjs:13-28,37-45`; `tests/harness/adapter.test.mjs:123-142` (ADPT-10).
- Evidence: A contender reads a dead PID and then recursively removes the directory without atomically claiming recovery or checking that it is still the same lock. Two processes can both read the old PID; the first replaces it and enters the heavy command, and the second deletes that new lock and also enters. An in-memory interleaving of the actual `withMutex()` implementation reproduced two simultaneous heavy-command callbacks. Either callback's unconditional `finally` can then delete the other's lock. There is a second unrecoverable state: a process dying between `mkdirSync` and writing `pid` leaves an unreadable-PID directory that every future caller waits on forever. Command timeouts do not bound this wait.
- Fix: Use an ownership-token lock protocol with serialized stale recovery: a reaper must hold an exclusive recovery claim, re-read the owner before removal, and acquisition/release must verify ownership. Publish owner identity safely and provide bounded handling for an abandoned incomplete lock without stealing an active creator's lock. Add cross-process/barrier tests with two stale-lock contenders, a kill during initialization, and release after ownership changes; assert heavy commands never overlap.

### CR-HAR-05 BLOCKER correctness An incomplete resolver response makes planning report success

- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/adapter/hooks.mjs:14-32,52-73`; `tests/harness/adapter.test.mjs:205-225`; consumer `ship/.agents/harness/gsd/plan-checks.mjs:111-129` (ADPT-15, ADPT-03; INV-36).
- Evidence: `invokeHook()` accepts `{v:1,results:[]}` for a resolve request containing target `x`; the planner then emits no row for that obligation and returns `status:"ok"`. Responses need a result per requested target. The advertised closed shape is also not closed: extra fields and extra nonblank stdout lines are ignored. Moreover, `.find()` returns the invalid value itself, so `{v:1,results:[null]}` and `{v:1,assignments:[null]}` pass the `bad ? ... : null` check. Read-only probes confirmed acceptance of an omitted result, a null result, an extra field and trailing garbage after a valid JSON line. The ADPT-15 test has no malformed-shape or missing-target cases despite its title claiming closed-shape coverage.
- Fix: Validate exactly one nonblank JSON response line and closed, typed request/response objects (including nested records). Use `.some()`/`findIndex()` rather than the truthiness of an invalid value. For resolve, require exactly one result for every requested target and reject omissions, duplicates and unexpected targets as unresolvable; check corresponding request/response relationships for shared and attribution operations. Exercise each failure through `check verify-command-paths` and assert it cannot return ok.

### CR-HAR-06 MAJOR spec Mandatory lint does not follow all adapter script references

- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/harness/adapter/lint.mjs:17-52,143-147`; `ship/.agents/harness/adapter/lint-text.mjs:39-59` (HARN-05, HARN-07, ADPT-06).
- Evidence: The adapter asset list includes vocabulary hooks, the shared predicate and attribution, but omits scripts in syntax-checker argv and build/test/gate/verify argv. The reference scanner only produces agent and skill references, never script references from generated skills/workflows. A memory-only fixture whose sole adapter entry was `.js -> {argv:["node","tools/missing-checker.mjs"],timeout_s:1,max_parallel:1}` returned `{findings:[],checked:0}`. After an evolve row stops listing the original checker, even an existing checker is outside mandatory lint. This contradicts checking every script the adapter names and rejecting missing referenced scripts; a generated adapter can be announced lint-clean while its checker or runner does not exist.
- Fix: Centralize extraction of adapter-referenced assets, including identifiable repo-relative script operands in all command/checker argv and script paths referenced by generated workflow/orchestrator invocation forms. Check that each is a file and include it in mandatory scope, without treating ordinary data arguments or PATH executables as repo files. Add fixtures where the last history row names another asset and the checker/runner is missing or contains a forbidden primitive.

### CR-HAR-07 MAJOR spec Workflow and primitive validation silently skip explicit required cases

- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/harness/adapter/lint-assets.mjs:30-36`; `ship/.agents/harness/adapter/lint-scripts.mjs:65,70-78`; `ship/.agents/harness/adapter/lint-text.mjs:8-10,23-28` (HARN-06, HARN-18).
- Evidence: Workflow validation runs only when `looksLikeWorkflowScript()` already recognizes a leading `export const meta`. A generated `.agents/workflows/run.js` without meta therefore avoids both the required-meta check and clock/random checks. A probe of `lintTextFile()` with `const t = Date.now(); return await agent("x")` returned no findings. Separately, `scanPrimitives("Use Agent to implement the task.\nCall Workflow to execute the stages.")` returned `[]`: Agent/Workflow imperatives require backticks or the word `tool`, although HARN-06 explicitly includes lines starting Use/Call followed by those names. These are ordinary generation mistakes, not adversarial evasions.
- Fix: Classify workflow files from their location and explicit references as well as content, then always call the structural validator even if meta is absent or misplaced. Apply the specified imperative rule uniformly to every primitive while retaining warning-only treatment of non-operational mentions. Add negative tests through `ph harness lint` for missing/misplaced meta, no-meta clock use, and unquoted Agent/Workflow imperatives.

### CR-HAR-08 MAJOR correctness The method-text negative test edits the actual shipped file

- Severity: MAJOR.
- Category: correctness.
- Where: `tests/harness/method-text.test.mjs:48-57` (HARN-01; offline-fixture principle P11).
- Evidence: The test reads `ship/.claude/skills/harness/references/qa-agent-guide.md`, overwrites it with an intentional corruption and later restores the earlier bytes. It does not use a temporary fixture. Parallel test files and installer/packaging checks can observe the corrupted shipped content; two suite invocations can preserve the other's temporary corruption, and an interruption before `finally` leaves the shipping tree modified. Restoring the saved snapshot also discards an edit made by another process in that interval. The review run reported all 38 tests passed and the target has no resulting diff, but that does not make the shared-tree mutation safe.
- Fix: Refactor `checkFile()` to accept source/output roots or text arguments, copy the necessary data into a temporary fixture, and mutate only that fixture. Assert the real shipped file's bytes remain unchanged. Keep the positive provenance check read-only against `ship/`.

### CR-HAR-09 MAJOR spec The new adapter generator has no required two-stack acceptance evidence

- Severity: MAJOR.
- Category: spec.
- Where: `tests/harness/method-text.test.mjs:93-107`; `ship/.claude/skills/harness/references/kit-adapter.md:39-49,74-97`; `.planning/integration/code-harness.md:14-15,40-41`; `.planning/integration/code-integrate.md:87-90` (HARN-04, with HARN-03/10/11/12 live acceptance still unverified).
- Evidence: HARN-04 is a v1 requirement, not a later item. Both handoff reports explicitly state that it is unimplemented. The automated generator check asserts that documentation contains section names, paths and the word confirm; no generated interpreted-service and compiled-CLI adapters, working build/test commands, resolvable tests or attached live-run records establish that the kit's new core onboarding feature works. In particular, the disconnected command execution found above would not be detected by the current documentation checks. This review did not run live agents because the assignment forbids them.
- Fix: After correcting the runtime contracts, run the owner-authorized named smoke on both fixture stacks with the INV-50 model. Preserve generated adapter/skill files and run records outside `ship/`, record lint exit 0 and actual command/resolver results for each stack, and record trigger outcomes. Add offline revalidation of those generated fixtures through the real consumers; do not replace the live generator acceptance with manually authored example JSON or keyword assertions.
