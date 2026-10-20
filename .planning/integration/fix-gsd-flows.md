# fix-gsd-flows

## Outcome

Continued the interrupted working-tree fixes, verified the findings against the implementation, and completed the owned-area changes. No findings were rejected. **18 findings are fully fixed; CR-GSF-03 and CR-GSF-13 have local fixes and explicit cross-area integration work still pending.** These two are not counted as fully fixed in the final reply. No commits, live agents, daemon operations or owner configuration changes were made.

The CONF-12 failure reported on continuation is fixed without changing the lint: gate configuration identity now hashes the effective `adapter`/`gsd` returned by `loadConfig`, rather than opening configuration files by filename. Configuration changes during or after a gate invalidate its evidence.

## Findings

| Finding ID | Disposition | What changed / verification |
| --- | --- | --- |
| CR-GSF-01 | fixed | Re-read the plan index before each scope check and check only plans still lacking SUMMARY. Two waves complete using the real evaluation-scope verb, producing two commits. |
| CR-GSF-02 | fixed | `execute-progress.json` distinguishes committed/tracked plans from coding-only SUMMARYs. Interrupted coding-complete plans rejoin gate, review, resolution and commit; partial-success waves retain the successful plan in those stages. A failure after commit but before STATE tracking resumes tracking rather than recoding. Recovery conservatively reruns gates/reviews rather than trusting an interrupted intermediate judgment. |
| CR-GSF-03 | fixed locally; integration pending | Worktree prompts use content-addressed immutable planning/skill/configuration snapshots. Owned pre-baseline dirty files are refused before dispatch and again at transfer. A later batch worktree is refused before dispatch when HEAD lacks earlier uncommitted output. Tests prove snapshots retain the uncommitted PLAN, owner edits remain intact, and wave two does not run on the wrong base. Runtime-owned dependency seeding is still needed to support that batch/worktree combination, requested below. |
| CR-GSF-04 | fixed | Executor continuations reuse fixed session options including isolation, model and effort. Failed continuations or transfers stop the round. A real-engine/fake-runner test uses real GSD verbs and a real worktree, fails the integrated test, repairs through the same executor session and commits the repaired file. |
| CR-GSF-05 | fixed | Phase branch selection and handoff checkout validation precede baseline capture. The branching fixture now asserts executed status, executor dispatch and a recorded commit, not just branch creation. |
| CR-GSF-06 | fixed | Required code-commit failures, skipped code commits and failed commits.json writes stop before STATE tracking and return recovery details. Rejected-commit and failed-record tests verify no tracking advancement. STATE write failures also stop. |
| CR-GSF-07 | fixed | Commit manifests use actual main-tree changes assigned by transfer claims/ownership, including fixer-created files and explicit integration scope. Unowned product changes block committing. A worktree review-fixer regression validates the added file via `git show` of the committed tree and commits.json. |
| CR-GSF-08 | fixed | Transfers consume `files_deleted` from the handoff task, not the index. Removed files stay in per-plan staging sets and commits.json entries. Separate-deletion regression verifies each commit deletes only its plan's file. |
| CR-GSF-09 | fixed | Finder/verifier/judge replies are required; eligible nulls get one retry, fatal failures get none. Every issue requires exactly one verdict/decision, and duplicate merges must point to a kept representative. Independent null/quota tests cover all three roles; incomplete verdicts cannot converge. |
| CR-GSF-10 | fixed | Mandatory batch phase review derives scope from actual integrated plan changes independently of optional wave reviews. With batch_review disabled, a real reviewer call receives both plans' files. |
| CR-GSF-11 | fixed | Gate writer/readback use the shared adapter obligation preparation, requested-step derivation, executed-target checks and evidence validator. Evidence records pre-run inputs, missing-file identities, scope patterns and effective configuration identity; post-run changes fail the gate and readback rescans scopes. Null build/test are not_configured steps. Parser faults fail closed. Tests cover absent/malformed steps, zero execution, newly owned files, mutation during gates, shared schema compatibility and configuration invalidation. |
| CR-GSF-12 | fixed | Verification retrieves the existing attempt before choosing its before hash, preserves that hash on resume, checks completed report identity and checks the attempt acceptance write. Real attempt-verb tests simulate a crash after report write and resume both before and after completion without another verifier. |
| CR-GSF-13 | fixed locally; integration pending | v1 parsing retains nested category headings, accepts bullets and table rows, and rejects an empty expected set. Tests name an entirely unmapped category. The direct core install-draft verb still needs the same exact-coverage validation inside its single-writer boundary; requested below rather than editing another area's file. |
| CR-GSF-14 | fixed | Quick full mode fails closed on absent checker replies, preserves owner planner/revision markers and requires a fresh verification artifact. Quick readback reuses core fingerprint/status validation instead of a status regex. Missing, contradictory, gaps and human-needed reports cannot return done. |
| CR-GSF-15 | fixed | Gap attempt result persists waveRunId before execution. The same wave identity may resume its partial execution; a fresh run is refused. A real attempt-verb test resumes the missing second executor without redispatching the first plan. |
| CR-GSF-16 | fixed | Fix results are inspected before another gate; fatal failures and owner decisions stop immediately, integration-fixer unresolved outcomes stop, and fatal finding-verifier failures never retry. Pending cross-plan requests persist in execute-progress and require explicit resolvedRequests acknowledgement before commit; a merely nonnull fix reply cannot clear them. Tests cover fatal verification and quota/partial repair paths with pending-request preservation. |
| CR-GSF-17 | fixed | Review severity is a closed enum, with an explicit fail-closed guard, and every review-record write is checked. Unknown-severity and record-write-failure tests assert zero commits. |
| CR-GSF-18 | fixed | Debug, plan and execute share an exclusive root-writer lock. A short exclusive transition claim serializes acquire/reap/release; live holders cannot be stolen even with the same run id, and release needs the owner token. Liveness uses the host pid rather than a hardcoded runs directory. Concurrent-process, dead-holder resume, wrong-token and plan/execute admission tests pass. An interrupted transition claim fails closed and may require manual recovery. |
| CR-GSF-19 | fixed | Current stage digests include actual current code/planning files, adapter instructions and effective settings immediately before reviewer/checker/fixer calls; research policy is present and the digest ends the prompt. Skeleton uses freeze inputs and the checker includes current PLAN inputs. Real-engine cache tests prove unchanged inputs hit cache and edited PLAN/source inputs dispatch fresh judgments. |
| CR-GSF-20 | fixed | Default research distinguishes missing from stale/blocked/invalid/incomplete reports and offers explicit refresh for existing unusable reports. Only the same unfinished attempt on unchanged inputs may resume. Four executable routing tests assert no dispatch or attempt write. |

## Files changed

- Workflow scripts: `ship/.agents/workflows/gsd-debug.js`, `gsd-execute.js`, `gsd-plan-review.js`, `gsd-plan.js`, `gsd-quick.js`, `gsd-research.js`, `gsd-verify.js`.
- Workflow helpers: `ship/.agents/workflows/lib/flow-execute.mjs`, `flow-files.mjs`, `flow-gate.mjs`, `flow-project.mjs`, `gsd-flow.mjs`.
- Kit-authored wrapper: `ship/.claude/skills/gsd-research/SKILL.md`. No vendored/generated upstream method body was changed.
- Existing fixtures/tests corrected: `tests/gsd-flows/exec-world.mjs`, `execute-review.test.mjs`, `execute.test.mjs`, `flow-gate.test.mjs`, `host.mjs`, `misc.test.mjs`, `research-verify.test.mjs`, `world.mjs`.
- New regressions: `tests/gsd-flows/review-execute-fixes.test.mjs`, `review-contract-fixes.test.mjs`, `review-engine-fixes.test.mjs`, `review-recovery-fixes.test.mjs`.
- Integration requests appended to `.planning/integration/requests.md`.

## Tests run

All runs were foreground/offline, using temporary projects and fake agents.

| Command | Total | Pass | Fail | Skip | Todo | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `node --test "tests/gsd-flows/*.test.mjs" "tests/e2e/*.test.mjs"` | 141 | 141 | 0 | 0 | 0 | 0 |
| `npm test` (final completed run) | 884 | 878 | 0 | 2 | 4 | 0 |

Earlier iterations exposed and repaired a generated string-literal syntax error, real-engine fixture omissions, the shared-helper identity assertion, and the reported CONF-12 lint failure. The final full-suite result above has no ordinary failures.

The two skips are FTOL-09 broken-symlink and FTOL-27 POSIX executable-mode cases on Windows. The four existing TODOs are ADPT-02/03 real-gate integration tests (both now pass their assertions), PHCL-04 project-owned-agent integrity test, and INST-04 byte-digest handling. **The INST-04 TODO still raises its known assertion** (hash.mjs decodes invalid UTF-8 before hashing); Node counts it as TODO, not fail, and exits 0. No TODO or skip was added or weakened by these flow fixes.

## Requests and remaining limits

Four `fix-gsd-flows -> integrator` requests were appended:

1. **CR-GSF-13:** `ship/.agents/harness/gsd/phases.mjs` installDraft must revalidate categorized v1 exact coverage and criteria before shared-file writes. Flow-side validation is fixed; direct CLI enforcement remains pending.
2. **CR-GSF-03:** runtime/workflow-owned worktree creation must seed accepted uncommitted dependency output and record the seed baseline before batch workers start. Until then, later batch/worktree waves fail closed; use shared isolation or per-wave execution. This is a remaining availability restriction, not a claim that batch worktrees are fully implemented.
3. `CHANGELOG.md` / `docs/INTERFACES.md`: record the authorized review fixes, snapshot/lock/request contracts, async evidenceCheck and additive evidence input identity fields.
4. `tests/harness/adapter-review.test.mjs`: remove obsolete ADPT-02/03 TODO markers after checking the now-applied flow consumer fixes. This file is outside GSF ownership. The requested CR-GSC-01 state wave/override exit checks are also applied in the owned flows.

The full-suite INST-04 TODO remains covered by fix-install's existing integration request; it was not changed here. No claim is made about live Paseo behavior or real project builds.
