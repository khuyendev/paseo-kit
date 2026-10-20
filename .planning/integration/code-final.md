# code-final — final integration, 2026-10-20

## Result

- Full offline suite: **890 tests; 888 pass, 0 fail, 2 skipped, 0 todo, 0 cancelled** (Node 24.19.0, Windows).
- Reviewed all 11 `fix-*.md` reports and all 11 `intel/review/code-*.md` reviews: **85 BLOCKER/MAJOR findings accounted for; 84 closed, 1 open manual-only finding** (CR-HAR-09).
- **1 verified unimplemented v1 requirement: HARN-04**, the named live two-stack generator acceptance. No live/model acceptance is inferred from documentation or manually authored fixtures.
- All **18 open fixer `-> integrator` requests** are marked DONE individually in `requests.md`; none rejected. Historical pre-review request dispositions are unchanged.
- No commits, spawned agents, daemon contact, real-project changes, or owner Paseo/Claude configuration changes.

## Requests applied and findings closed here

| Area / finding | Final integration |
| --- | --- |
| CR-FND-02 | `startAgent` removes a failed creation's new worktree only when no worker identity exists or archive is confirmed. Workflow runner preserves the returned identity, worktree and live-cap accounting; an archive failure retains that identity. New real-runtime/fake-daemon tests cover simultaneous subscription and archive failure for spawn and workflow, and refusal of a second allocation at the live cap. |
| CR-FND-03 / CR-WFL-05 integration | Verified absolute deadline propagation and late-result refusal from the fixers. Changed the per-wait timeout argument to the original whole-call allowance capped by config, rather than a shrinking remaining-seconds diagnostic. Structured errors, deadline-capped usage settling and shim transport are documented. |
| CR-INS-05 / INST-04 | Shared ownership digest and self-contained pre-trust mod discovery normalize CRLF as bytes without UTF-8 decoding. Invalid bytes remain distinct; existing valid-text manifest hashes stay compatible. The failing byte-hash TODO is active and passing. |
| CR-PHC-03 | Shared `Session.findAgents` exhausts pagination, retains label filtering, deduplicates identities and rejects incomplete/missing/repeated cursor listings or page failures. `listAgents` delegates. Worktree liveness no longer calls the raw daemon client outside paseo-client. Tests cover a later-page target, repeating cursor and lost later page; existing prune-safety tests pass. |
| CR-PHC-04 / CR-GSC-08 | Verified the GSD fix allowing project-owned roles beside managed roles; activated the project-agent doctor test. |
| CR-PHC-06 | Added config-independent async `checkTarget(target)` and switched doctor to it. Invalid overlays no longer suppress integrity checking. Tests verify both clean and hand-edited GSD installs with a broken overlay; diagnostic boundaries keep running. |
| CR-GSC-01 | Verified the flow fixer's state-wave and state-override exit checks; failed writes stop rather than acknowledging tracking/proceeding. |
| CR-HAR-01/02/03 and CR-GSF-11 | Verified real-gate use of not_configured steps, `gateObligation`, placeholder substitution, `executionProblem`, `requiredSteps`, shared names and evidence validator. Activated both integrated ADPT TODO tests. Documented async evidence readback, pre-run inputs, scope rescanning and effective-config identity. |
| CR-GSF-13 / GSDF-95 | Added one core draft validator shared by flow preflight and direct roadmap installation. Inside the shared-file writer lock, installation re-reads/validates categorized v1 requirements and the draft before final writes. Empty sets, omitted categories, extra IDs, duplicate roadmap IDs, phase mismatch, malformed requirement lines and criteria outside 2–5 fail closed. STATE initialization uses the already-held writer boundary. Direct-verb tests assert unchanged final files on refusal. |
| CR-GSF-03 / GSDF-41/94 | Implemented runtime-owned accepted-dependency seeding. Batch flows derive `{head, files}` from earlier accepted transfers. New worktrees validate contained non-link paths, HEAD and hashes before copying; a seed record is persisted in the worktree's git directory before dispatch. Transfer ignores unchanged seeds but detects modified/deleted seeds and restoration to HEAD, then applies ordinary ownership/deletion checks. Failed seeding removes only the newly created tree. Seeds participate in workflow cache identity. Two-wave batch test proves the second worker sees the first worker's accepted bytes and does not retransfer them. A real workflow-runner/fake-worker test verifies the runner-to-runtime option boundary. |
| Interface/documentation requests | Updated INTERFACES for cmdShim, error cause/archiveError, deadlines, pagination, independent integrity check, mutex ownership, closed hook shapes, adapter exports, evidence fields, snapshots, root locks, request acknowledgements and worktreeSeed. README describes changed recovery/failure behavior. CHANGELOG 0.0.1 describes the kit and the owner-authorized review/fix pass. Refreshed kit.json to 456 file units. |

The other findings have explicit fixed dispositions and regressions in their fixer reports. Coverage audit found **zero finding IDs absent from their corresponding fixer report**:

| Review prefix | Findings | Final disposition |
| --- | ---: | --- |
| FND | 3 | closed (caller integration completed here) |
| INS | 5 | closed (byte hashing completed here) |
| MAC | 3 | closed by fixer |
| PHC | 7 | closed (shared listing and independent doctor integration completed here) |
| WFL | 6 | closed, with transport/deadline limitation below |
| FIL | 6 | closed by fixer |
| HOK | 3 | closed by fixer |
| GSC | 12 | closed (flow caller checks verified) |
| GSF | 20 | closed (draft writer boundary and batch dependency seeding completed here) |
| HAR | 9 | 8 closed; CR-HAR-09 open for live acceptance |
| PNL | 11 | closed by fixer; visual acceptance remains manual |

## Tests and changes to tests

Run from `C:/Users/fish/Desktop/paseo-kit`:

```text
npm test
node --test tests/e2e/final-integration.test.mjs tests/gsd-flows/review-recovery-fixes.test.mjs
node kit/release-check.mjs
```

| Run | Total | Pass | Fail | Skipped | Todo | Cancelled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Final full npm test | 890 | 888 | 0 | 2 | 0 | 0 |
| Focused final cross-area regressions | 11 | 11 | 0 | 0 | 0 | 0 |

Logs: `code-final-test.log` and `code-final-focused.log` in this directory (local ignored test logs).

Skipped tests, **not counted as verified**:
- FTOL-09 broken-symlink case: POSIX-only fixture, skipped on Windows.
- FTOL-27 executable mode preservation: POSIX-only filesystem behavior, skipped on Windows.

All four former TODOs are active: INST-04 invalid-byte digest, PHCL-04 project-owned GSD-side agent, ADPT-02 null gate commands, ADPT-03 obligation placeholder/parser behavior. No failing TODO remains hidden behind Node's success exit code.

No test was deleted or weakened. Two obsolete expectations were replaced because they tested interim limitations rather than the approved specification:
- Doctor with a broken overlay now must perform integrity checking (including detecting stale generated text), not report it skipped (CONF-08/PHCL-04).
- Batch worktree wave two now must execute with accepted dependency bytes, not refuse the supported mode (GSDF-41/49). The fake script host now delegates worktree creation to the real runtime and takes the engine's option registry; assertions verify transferred file scope as well as execution success.

Early integration runs exposed doctor diagnostic punctuation mismatches, the obsolete batch-refusal test, and mistakes in new test fixture wiring (project.git returns text; workflow observes caller usage before worker creation). These were corrected at their actual boundaries; final totals above supersede those runs. The initially reported CONF-12 failure was already fixed by the GSD-flow fixer and remains green without relaxing its lint.

## D-110, D-111 and release checks

- D-110 scan of `ship/`, `kit/`, `plugins/`, `user/`: **548 text/code files scanned; zero kit-authored hits** for the project/engine/game deny vocabulary. Excluded dependency directories and lockfile package metadata. The 17 files with generic example hits are protected carried method/upstream files, not kit project-specific adapters; retaining them is required by D-111.
- D-111 harness provenance: **15 source fixtures** match `git show ref-final:project/.agents/skills/...` from the read-only old kit after CRLF normalization. Full-suite HARN-01 tests reconstruct every protected shipped method file from source plus exactly the inventoried NOTICE/PROVENANCE adapter replacements; no other hunks allowed.
- D-111 GSD provenance: **246 snapshot files** match both UPSTREAM.json and the supplied local upstream clone's corresponding text at the pin. Only file reads were used on the upstream clone; no git, import, require, install or execution there.
- Config-independent GSD check: **0 problems, 1 warning, 211 references followed, 103 verbs mapped**. Warning is the already-recorded depth-2 `gsd-core/workflows/context-bridge.md` reference absent upstream at the pin; not edited or fabricated.
- Audit details: `code-final-checks.json` records scan counts, all protected hits and integrity result.
- `node kit/release-check.mjs`: **release check: ok**; top released CHANGELOG section equals kit.json 0.0.1, Unreleased retained. No commit range was supplied because the orchestrator owns committing; same-commit prompt/changelog enforcement is covered by its fixture tests and should run against the eventual release range.
- `git diff --check`: passed (only Git's expected LF-to-CRLF notices). Both plugin TypeScript checks and the installed offline host compiler/evaluator test executed and passed in the full suite; they were not skipped.

## Files written or edited by code-final

- `ship/.agents/harness/lib/hash.mjs`; `ship/.claude/plugins/harness-files/scripts/discover.mjs`.
- `ship/.agents/harness/paseo-client/index.mjs`.
- `ship/.agents/harness/runtime/{start,doctor,cmd-worktrees,worktrees}.mjs`; new `runtime/worktree-seed.mjs`.
- `ship/.agents/harness/workflow/{runner,engine,journal,runtime-bridge}.mjs`.
- `ship/.agents/harness/gsd/{upstream,phases,state}.mjs`; new `gsd/draft.mjs`.
- `ship/.agents/workflows/gsd-execute.js`; `ship/.agents/workflows/lib/{flow-execute,flow-project,gsd-flow}.mjs`.
- `tests/install/units.test.mjs`, `tests/ph/doctor.test.mjs`, `tests/harness/adapter-review.test.mjs`, `tests/gsd-flows/{host,review-recovery-fixes.test}.mjs`; new `tests/e2e/final-integration.test.mjs`.
- `kit.json`, `docs/INTERFACES.md`, `README.md`, `CHANGELOG.md`, `.planning/integration/requests.md`, this report and the check JSON/local logs.

All other review/fixer changes were preserved; unrelated orchestration files already in the dirty working tree were not edited.

## Remaining gaps and manual checks owed

**Open finding CR-HAR-09 / unimplemented v1 HARN-04:** run the real harness generator on an interpreted web service and a compiled CLI fixture using the owner-approved test model, retain generated adapters/skills and run records outside ship, execute their commands/resolvers, record lint and trigger results. This task explicitly forbade spawning agents; substituting hand-authored adapters would not fulfill the requirement. It is neither rejected nor counted verified.

Other manual acceptance is **not verified**, even where the code and offline tests exist:
- HARN-03/10/11/12/18: real generation, 10+10 triggers and evolve 3+3 triggers, output language, evolve history/conflict behavior and semantic workflow dry runs.
- INST-23: release qualification on the candidate minimum Node runtime; only Node 24 was tested here. The advertised 20.17 + capability gate remains a declared, unqualified floor. INST-28 owner README review; INST-30 real kit-init approval flow.
- PCLI-03 MC-01 actual daemon connectivity; PHCL-06 MC-02 actual cwd behavior; PHCL-27 MC-03 real per-agent denies/advisory behavior.
- FTOL-01/04/10: actual Claude Code session tool loading, supported engine API/permission modes and end-to-end native permission path; plugin validation with the real Claude CLI was not run.
- HOOK-07/14/19 actual transcript/response shapes, HOOK-12 p95 on the owner's machine, HOOK-30 real heredoc path.
- GSDF-07/10/13/57: live new-project/discuss/research-routing/UAT interaction; no real project build/test or lifecycle agent smoke performed.
- PANL-01/07/10/34/48/49 and detail-pane navigation/reconnect: live host and visual behavior; offline compile/evaluate and state/helper tests do not prove mounted UI interaction.
- POSIX platform execution, including the two skipped cases above.

Implementation limits recorded by fixers remain explicit: a transport RPC already in flight depends on the client timeout/completion; warm-up/creation are not forcibly cancelled by the whole-call deadline (late responses cannot succeed). Interrupted lock-reclamation transition claims can require manual recovery and fail closed. Plugin ladder/parser/default copies have drift/parity tests; swarm rotation currently validates its context subset rather than every unrelated overlay entry. These are not claimed live-qualified.
