# Code review: GSD flows (GSF)

## Verdict

REVISE — 13 BLOCKER, 7 MAJOR, 0 MINOR. The lifecycle is not ready for normal use: multi-wave execution stops after its first commit, interrupted waves can bypass their remaining gates, worktree execution can lose pre-existing edits, and several review paths certify success after receiving no review. The offline flow/e2e suites pass (100 tests; `node --test --test-reporter=dot "tests/gsd-flows/*.test.mjs" "tests/e2e/*.test.mjs"`), but most flow tests replace both the engine and GSD verbs with permissive fakes. Read-only probes additionally reproduced a quota-failed plan finder returning `converged`, categorized v1 requirements parsing as an empty list, and verification resume rejecting its own completed report. The full repository suite and live services were not run.

## Findings

### CR-GSF-01 BLOCKER correctness Every later wave checks completed plans as if they still lacked SUMMARY
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:126`, `:148-151`, `:450-457` (GSDF-38, GSDF-49, GSDF-53).
- Evidence: `pendingPlans` is captured once before execution. Every subsequent `resumeGate()` iterates that original list, even after `idx` has been refreshed. After wave 1 commits, evaluation-scope finds its legitimate orchestrator commit and the script stops with “has commits ... but no SUMMARY,” although that SUMMARY exists. A normal two-wave per-wave phase cannot reach wave 2. The fake in `tests/gsd-flows/exec-world.mjs:45` always supplies an empty commit scope, hiding the defect.
- Fix: Recompute incomplete plans from the current index before every scope check; check only plans genuinely without SUMMARY, distinguishing recorded completed transfers/commits from interrupted work. Add a two-wave execution test using the real evaluation-scope verb and assert that wave 2 executes.

### CR-GSF-02 BLOCKER correctness Resume treats SUMMARY as completion of the entire wave transaction
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:126-136`, `:451`, `:473` (GSDF-38, GSDF-43, GSDF-44, GSDF-46, GSDF-53; INV-44).
- Evidence: Executors write SUMMARY before the build, review, fixes and commit. If the run dies or a gate/review fails after that write, a rerun filters those plans out. With all summaries present it immediately routes to phase verification; with later work outstanding it skips the unfinished earlier wave. Thus a red build or unresolved high review finding can be bypassed merely by restarting, and uncommitted code never receives its required commit. Partial successful plans in a failed wave are also omitted from that wave's later gates.
- Fix: Persist execution-stage progress per wave/plan and resume at the first incomplete stage. SUMMARY should reconcile the coding stage only; do not mark the execution transaction complete until integration, green evidence, review/resolution and commit are recorded. Exercise interruption after each stage, including one successful and one failed executor in the same wave.

### CR-GSF-03 BLOCKER correctness HEAD-only worktrees omit current inputs and can overwrite owner edits
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:189-225`; `ship/.agents/workflows/lib/flow-execute.mjs:158-180`; supporting `ship/.agents/harness/runtime/worktrees.mjs:41-48` (GSDF-41, GSDF-94; INV-22).
- Evidence: Worktrees are created from HEAD, while executor prompts use worktree-relative PLAN and stack-skill paths. The defaults combine `isolation: worktree` with `commit_policy.docs: false`, so newly generated plans need not exist in that worktree. Batch mode has the same problem for source produced by earlier uncommitted waves. More seriously, an owned tracked file dirty before execution is not copied into the worktree; transfer explicitly permits overwriting it when its current hash equals `baseDirty`. A worker editing the HEAD version therefore replaces the owner's unchanged local edits with a version that never contained them.
- Fix: Give executors an explicit immutable snapshot of the current planning/configuration inputs and a code base containing accepted dependency output. Either seed worktrees with allowed baseline dirty content and record that baseline, or refuse owned dirty files before dispatch. Never overwrite pre-existing edits on the strength of “unchanged since baseline” when the worker did not receive those edits. Test default uncommitted plans, batch wave dependencies, and an owned file with an owner edit before baseline.

### CR-GSF-04 BLOCKER correctness Worktree fix rounds violate the engine's session identity contract
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:221-225`, `:294-308`; `ship/.agents/harness/workflow/engine.mjs:80-85` (GSDF-18, GSDF-49, GSDF-51).
- Evidence: Initial executor calls set `isolation: "worktree"`; follow-up `executor:<id>` fix calls omit it. The real engine treats isolation as immutable and throws `session executor:<id> cannot change isolation`. `parallel(fixes)` converts the exception to a null, and the script ignores it and reruns the gate. Every attributed worktree repair therefore fails without dispatching a fixer. The fake host does not enforce session identity.
- Fix: Reuse all fixed session options, including worktree isolation, on every executor continuation. Treat a failed continuation or transfer as an explicit stopped fix round, not a successful repair. Add a real-engine/fake-runner test with a failing worktree obligation followed by a successful fix.

### CR-GSF-05 BLOCKER correctness Phase branching invalidates the baseline the script just recorded
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:143-169`, `:457`; `ship/.agents/workflows/lib/flow-execute.mjs:95-98` (GSDF-38, GSDF-54).
- Evidence: The execute baseline is recorded on the current branch before switching to `origin/<default>`. If the current HEAD is ahead of or diverged from that ref, the next pre-dispatch gate sees the intentional branch switch as an unauthorized HEAD move and refuses execution. `tests/gsd-flows/execute-review.test.mjs:140-155` checks the new branch/base and a log line but never checks that the run executed.
- Fix: Complete the approved branch selection and validate planning inputs in the resulting checkout before recording the execution baseline. Preserve an existing baseline only when it belongs to that checkout/branch transaction. Extend the test to assert `executed`, executor calls and commits, not just branch creation.

### CR-GSF-06 BLOCKER correctness Failed code commits still produce executed and green tracking
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:414-433`, `:492-495`, `:532-536` (GSDF-53; INV-04, INV-44).
- Evidence: `commitOne()` converts every unsuccessful commit into a warning and null. Neither `commitWave()` nor its callers check it; STATE is updated and the result is `executed` with no commit or commits.json entry. A failed git hook, identity error or index failure therefore leaves code uncommitted while telling the next skill to verify it. The nonfatal docs-commit exception in GSDF-31 does not apply to required code commits.
- Fix: Propagate code-commit failures as `failed`/`needs-owner`, preserve recovery details and do not advance tracking. Require the commit and its atomic commits.json record before acknowledging the transaction. Test a rejected git commit and a failed commit-record write.

### CR-GSF-07 BLOCKER correctness Fixer-created files are missing from worktree commit scopes
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:375-380`, `:397-411`, `:484-492`, `:524-534` (GSDF-46, GSDF-49, GSDF-53).
- Evidence: Review and batch fixers run in the integrated main tree, but worktree-mode `planFiles()` obtains its file list exclusively from the earlier executor transfer record. If the fixer creates a new owned source/test file, that file can make the rerun gate pass but is absent from the commit and commits.json. The returned green result then depends on an untracked file that another checkout will not have. Unowned integration-fixer files similarly have no commit assignment.
- Fix: Capture and validate each fixer's actual delta, assign every changed/added/deleted path to a plan or explicit integration scope, and update the eventual commit manifest before committing. Refuse to return executed with accepted product changes outside that manifest. Test a review fixer that adds a regression test/new helper, then validate the committed tree independently of the working tree.

### CR-GSF-08 MAJOR spec Declared worktree deletions are discarded at the consumer boundary
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/workflows/gsd-execute.js:254`; supporting `ship/.agents/harness/gsd/outline.mjs:249` and `ship/.agents/harness/gsd/phases.mjs:318` (GSDF-41, GSDF-94).
- Evidence: Handoff tasks contain `files_deleted`, but transfer gets `planInfo(t.plan).files_deleted ?? []`. The real phase-plan-index does not return that field, so even a properly declared deletion is rejected as undeclared. Additionally, worktree `planFiles()` accumulates deletions globally and supplies all of them to every per-plan commit, while omitting deleted paths from the per-plan commits.json lists (`:404-405`, `:428`).
- Fix: Pass the validated handoff task's deletion declaration (or expose it in the real index), and retain deletions in each plan's actual-change/commit scope. Stage only that plan's deletions for per-plan commits. Test two plans with separate declared deletions through real handoff, index, transfer and commit verbs.

### CR-GSF-09 BLOCKER correctness Optional plan review converges when its reviewers fail
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-plan-review.js:76-93` (GSDF-01, GSDF-37; INV-36).
- Evidence: A null finder is converted to `issues: []`; a null verifier removes all its issues; a null judge removes all verified issues. Every case can produce count zero and `status: "converged"`, including quota/auth failures. A read-only probe with one finder returning `NULL("agent error: quota exhausted")` returned `{"status":"converged","cycles":1,"planRevision":null}` after one call.
- Fix: Require complete valid responses at every review stage. Stop immediately on fatal reasons; bounded retry may handle eligible missing replies, but missing verdicts must remain unresolved and block convergence. Add null/quota tests independently for finder, verifier and judge.

### CR-GSF-10 BLOCKER correctness Batch review disabled also silently eliminates the mandatory phase review
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-execute.js:340-346`, `:505-516`; `tests/gsd-flows/execute-review.test.mjs:62-74` (GSDF-47, GSDF-49, GSDF-92).
- Evidence: With `batch_review: false`, `allReviews` and `phaseScope` are empty. The phase review falls back to evaluation-scope `--plan 01-phase`, which is not a plan id, and discards the error into an empty file list. `reviewPlan()` skips the reviewer when scope is empty, yet records a “review phase” event and later succeeds. The test only asserts that event, not an actual reviewer call or a whole-phase scope.
- Fix: Derive the phase scope from the union of actual integrated changes for all executed plans, independently of optional per-wave reviews; never use a synthetic phase label as a plan id. Fail closed if the scope cannot be resolved. Assert a real phase reviewer call with all expected files when `batch_review` is false.

### CR-GSF-11 BLOCKER correctness Gate evidence readback does not prove completeness or current execution
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/lib/flow-gate.mjs:69-74`, `:107`, `:128-134`, `:157-169` (GSDF-44, GSDF-55; INV-35, INV-53; ADPT-17).
- Evidence: The local readback accepts `{v:1, inputs:{files:{}}, steps:[]}` as current: it does not validate the full evidence schema, expected gates/obligations, execution counts or named targets. Writers use `executed: null`, which does not satisfy the shared ADPT-17 schema's `{count, targets}` shape. Verification supplies no plan scopes, so readback expands only previously recorded file names: a newly added file under an owned directory is invisible. Inputs are captured after all commands, so a file changed after an early test but before the final snapshot can also be certified without having been tested. Parser-hook errors are ignored via `pr.targets ?? targets`.
- Fix: Use one evidence writer/validator contract, with expected steps and requested targets supplied independently of the evidence being checked. Record scope patterns plus missing-file identities, capture inputs before execution and reject changes during the gate; rescan directories at readback. Fail on parser-hook errors. Add tests for absent steps, zero targets, new owned files, and mutation between test execution and evidence creation, and validate generated evidence with the shared adapter validator.

### CR-GSF-12 BLOCKER correctness Verification resume compares the report with itself
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-verify.js:70-90`; supporting `ship/.agents/harness/gsd/revisions.mjs:136-137` (GSDF-32, GSDF-55; INV-35).
- Evidence: On every invocation `before` is recomputed from the report currently on disk and written into the existing attempt. After a crash following the report write, this replaces the original pre-attempt report hash with the new report's hash. The resume shortcut cannot succeed (`st.json.sha !== before` is false), and readback rejects the already completed report as unchanged. A read-only probe preserving the same run/attempt with `attempt.before = old-report` and current disk status `new-report` dispatched another verifier and returned `failed: ... unchanged from the previous report`.
- Fix: Retrieve/resume the attempt before choosing `before`; preserve its original pre-dispatch hash immutably. Use that stored identity for all readbacks and record a current-attempt association for the accepted report. Test crashes immediately after report write and after attempt completion using the real attempt verb.

### CR-GSF-13 BLOCKER correctness Categorized v1 requirements disappear from roadmap coverage validation
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/lib/flow-project.mjs:17-25`, `:62-76`; `ship/.claude/skills/gsd-new-project/SKILL.md:24-25` (GSDF-07, GSDF-95).
- Evidence: Every heading resets `inV1` based solely on whether that heading contains “v1.” The prescribed format `## v1 Requirements` followed by `### Authentication` and `- [ ] **AUTH-01**: login` therefore yields no v1 IDs. A read-only call to `v1RequirementIds()` with that input returned `[]`. An empty traceability object and a draft omitting the entire category can pass. The final install verb checks that supplied trace entries name valid phases, not that all requirements were supplied. Tests flatten all v1 requirements directly beneath the v1 heading and miss normal categorized output.
- Fix: Track heading depth and retain the v1 section through its child headings, or reuse the core requirement parser. Validate a nonempty expected requirement set where appropriate and enforce exact coverage again at installation. Test categorized bullets and the supported table form, including an entirely unmapped category.

### CR-GSF-14 BLOCKER correctness Quick full mode reports done without a successful checker or verification report
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/workflows/gsd-quick.js:78-85`, `:97-106` (GSDF-01, GSDF-61; INV-35, INV-36).
- Evidence: A null checker becomes an empty issues list and exits the loop as passed. The verifier's response is ignored completely: no report existence, structure or status readback occurs. A verifier that fails with quota, writes nothing, or writes gaps still leads to `status: done`. The quick planner/revision path also does not stop on its owner markers. The current full-mode test covers only two explicit blocker lists, not missing or failed judgments.
- Fix: Fail closed on unavailable checker/verifier results, preserve owner markers, and require a fresh valid verification artifact with an explicitly acceptable status before returning done. Reuse the normal flow's contracts instead of treating dispatch itself as success. Test null/quota checker, missing report, gaps report and REVISION_CONFLICT.

### CR-GSF-15 MAJOR spec Gap execution cannot resume the single allowed wave
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/workflows/gsd-execute.js:180-184` (GSDF-30, GSDF-32; D-73).
- Evidence: `waveExecuted` is set before the first executor, then any invocation seeing true is refused without checking whether it is resuming that same execution. A crash after one of two gap plans thus permanently bars the remaining plan even on `--resume` of the original run. The existing test only proves that a fresh second execution is refused; it does not prove continuation of the first wave.
- Fix: Persist a gap-wave execution identity and per-plan/stage progress. Permit resumption of that same wave without consuming a second attempt, while rejecting a genuinely new gap wave. Add the specified partial-gap-execution crash/resume test.

### CR-GSF-16 MAJOR invariant Fix and finding-verification loops retry fatal failures and discard owner decisions
- Severity: MAJOR.
- Category: invariant.
- Where: `ship/.agents/workflows/gsd-execute.js:294-310`, `:330-338` (GSDF-01, GSDF-42, GSDF-46, GSDF-50, GSDF-52; INV-13, INV-14).
- Evidence: `fixRounds()` discards every result of `parallel(fixes)`, including quota/auth nulls, `partial`/`blocked` task statuses and an integration fixer's `unresolved`. It reruns the gate and can issue another repair call. `verifyFindings()` unconditionally makes its second call on a missing verdict even if the first failed for quota/auth. Initial executor/reviewer dispatch has fatal checks, but these continuations do not.
- Fix: Inspect every fix result before any new gate/agent call; immediately propagate fatal reasons and owner-needed task/deviation markers, and honor unresolved fixer outcomes. Retry finding verification only for eligible nonfatal missing replies. Preserve pending cross-plan requests until acknowledged resolution, not merely any nonnull result. Test fatal failures in each continuation path.

### CR-GSF-17 MAJOR invariant Unknown review severities are silently downgraded instead of blocking
- Severity: MAJOR.
- Category: invariant.
- Where: `ship/.agents/workflows/gsd-execute.js:55`, `:324-327`, `:351-359`; `ship/.agents/workflows/lib/flow-review.mjs:78` (GSDF-46, GSDF-92; INV-36).
- Evidence: The findings schema allows any severity string. `gateFinding()` treats everything other than `critical` and `high` as nonblocking, so `blocker` or a misspelled severity bypasses independent verification and fixing. The review-record validator rejects the unknown value, but the script ignores that write failure too and can still commit and return executed with no valid review record.
- Fix: Close the severity enum at response validation and make unknown values a named blocking error rather than a downgrade. Check every review-record write result before proceeding. Test an unknown severity and a refused record write and assert no commit/tracking advancement.

### CR-GSF-18 MAJOR correctness Debug serialization is not an exclusive lock and excludes no other writers
- Severity: MAJOR.
- Category: correctness.
- Where: `ship/.agents/workflows/lib/flow-files.mjs:60-68`; `ship/.agents/workflows/gsd-debug.js:65-70`; `ship/.agents/workflows/gsd-plan.js:120-128`; `ship/.agents/workflows/gsd-execute.js:98-103` (GSDF-64; INV-38).
- Evidence: The lock is a read-check followed by ordinary atomic replacement, not exclusive creation: two processes can both observe no holder and both proceed. Its stale check assumes `_workspace/_runs/<runId>` even though runs directories are configurable and the script's runId remains the first id on resume. Plan/execute never consult this lock, so they can write the same root while a debugger is active. The test preinstalls a lock sequentially and does not exercise concurrent acquisition or other writers.
- Fix: Use an exclusive cross-process root write lease with verified holder liveness and the actual run location/identity. Require debug and every planning/execution writer to acquire or check that same lease, and release only one's own token. Test concurrent acquisition, custom runs directories, resumed debug runs and execute/plan admission during debug.

### CR-GSF-19 MAJOR invariant Agent cache identity does not consistently include the files being judged
- Severity: MAJOR.
- Category: invariant.
- Where: `ship/.agents/workflows/gsd-plan.js:287-312`, `:515-523`; `ship/.agents/workflows/gsd-plan-review.js:69-88`; `ship/.agents/workflows/gsd-execute.js:335`, `:347-348`, `:387` (GSDF-03, GSDF-14, GSDF-32; INV-22, INV-39).
- Evidence: Skeleton review/resolution hashes `inputs`, which excludes the outline and wiring it reviews; the plan checker uses `freezeHash`, which excludes PLAN contents. Execute review, finding verification, fixer and resolution prompts have no input digest at all. Optional review computes one digest before its entire editing loop, and its verifier/judge prompts have neither a digest nor research policy. A resumed workflow can therefore reuse a judgment for changed code/plans when the prompt's paths and issue text are unchanged. The GSDF-03 static test merely checks that the shared helper contains the digest formatter.
- Fix: Hash the actual current stage inputs immediately before each agent call, including the files under review, relevant evidence and configuration; end every prompt with that digest. Recompute after edits and include the research policy on every required role path. Run resume tests through the real engine/cache that edit an outline, PLAN and reviewed source between attempts and assert fresh judgments.

### CR-GSF-20 MAJOR spec Default research silently refreshes stale or blocked reports
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/workflows/gsd-research.js:53-67`; `ship/.claude/skills/gsd-research/SKILL.md:12-16` (GSDF-13).
- Evidence: The documented default args go straight to the workflow. It only reuses exit-0 reports; every other non-view result falls through to recording an attempt and dispatching a researcher, without requiring `refresh`. Stale, invalid and blocked existing reports are consequently overwritten/researched automatically even though GSDF-13 requires reporting their status and offering an explicit refresh. The test for this requirement checks skill wording only.
- Fix: In the workflow, distinguish missing reports from existing stale/invalid/blocked reports. Without refresh, research only the missing case; return the existing status and refresh option for the others without creating an attempt or agent. Add executable routing tests for all statuses, not just text assertions.
