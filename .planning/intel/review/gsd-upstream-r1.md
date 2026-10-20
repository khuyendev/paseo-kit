# Review r1: GSD upstream capability catalogue (UPS)

## Verdict

REVISE. 2 BLOCKER, 9 MAJOR, 5 MINOR. The catalogue is broad and most checked citations match the workflows, but two KEEP contracts (gate exits, evaluation scope) are stated wrongly enough to specify the opposite behavior, and several contracts inside files marked read in full (post-merge timeouts, the specless edge probe, parallel `skip_checkpoints`, execute-phase resume gates, the executor deviation rules) are missing or flattened. UPS-87 also recommends vendoring upstream text, which the rewrite brief forbids.

## Findings

### R1-UPS-01 BLOCKER accuracy Exit 66 treated as "could not run"
- Severity: BLOCKER.
- Category: accuracy.
- Map entry: UPS-73.
- Evidence: `upstream:docs/CLI-TOOLS.md:851-861`. Exit `66` is `NO_INPUT`: the evidence was read and the declared scope is empty (status mode). Exit `69` is `UNAVAILABLE` ("could not look"). Exit `1` with empty stdout is a usage/`error()` failure; exit `1` with JSON is a negative verdict. Payload-mode `check` verbs stay exit `0` when blocking and use `69` only when they could not look.
- Fix: Replace "treat >1 or 1-with-empty-stdout as could not run" with the four-way split: `0` delivered verdict (payload mode includes a blocking `.block`), `1` plus JSON = negative, `1` plus empty stdout = usage/error, `66` = read and genuinely empty (not unavailable), `69` and any other code = could not run. The capture idiom `X=$(cmd) && EXIT=0 || EXIT=$?` can stay.

### R1-UPS-02 BLOCKER accuracy Empty plan/quick scope is not a widened phase range
- Severity: BLOCKER.
- Category: accuracy.
- Map entry: UPS-74.
- Evidence: `upstream:docs/ARCHITECTURE.md:351-365`. A phase with an empty task-commit union degrades to the phase-directory range and says so. A plan or quick unit that matches nothing is `status: resolved` with `reason: no-matching-commits` (or `empty-after-exclusions`), and the verb reports that as `advisory`, not `pass` and not a widened range. `unresolvable` is only when git or the phase could not be read, including a git timeout.
- Fix: Split the empty-union sentence by unit. Keep the phase degrade-to-range rule. Add the plan/quick rule: resolved + advisory, never pass, never a phase-range fallback. Keep `block: false`.

### R1-UPS-03 MAJOR accuracy Post-merge timeouts are two different budgets
- Severity: MAJOR.
- Category: accuracy.
- Map entry: UPS-47.
- Evidence: `upstream:gsd-core/workflows/execute-phase/steps/post-merge-gate.md:64-87` hardcodes the build gate at `run-with-timeout 300` (5 minutes). Build exit `124` logs a warning, does not append a wave-failure line, and continues to the test gate. `post-merge-gate.md:137-160`: the test command is passed through `query normalize-test-command` (one-shot; defeat vitest/jest watch mode), then `workflow.test_gate_timeout` default `600` seconds. Test exit `124` does not append a wave-failure line and the step calls it non-blocking. A non-124 test failure does append. `execute-phase.md:947-953` still refuses the ROADMAP/STATE tracking update unless `TEST_EXIT` is `0`, so a timeout leaves plans in progress. `upstream:docs/CONFIGURATION.md:539` says 600 seconds for the verification test gate; `CONFIGURATION.md:556-557` says both build and test "run with a 5-minute timeout", which the step file does not do for tests.
- Fix: Record a CONFLICT. Build: 300s hardcoded, 124 does not count as a wave failure and does not skip tests. Tests: `test_gate_timeout` default 600s after `normalize-test-command`, 124 does not increment `WAVE_FAILURE_COUNT` but does block the tracking update. Do not write "5-minute timeouts (`test_gate_timeout` 600)". Add `normalize-test-command` and `run-with-timeout` to the verb list the gate needs.

### R1-UPS-04 MAJOR coverage Specless edge/prohibition probe is core plan-phase, not spec-phase
- Severity: MAJOR.
- Category: coverage.
- Map entry: UPS-25 (and UPS-14).
- Evidence: `upstream:gsd-core/workflows/plan-phase.md:735-743`. When SPEC.md did not supply `## Edge Coverage` / `## Prohibitions`, plan-phase itself runs `references/specless-probe-fallback.md` (default-ON) and writes the predicates into PLAN.md `must_haves`. The spine calls this core workflow substrate, not a capability rail. It runs after step 7 and before the planner spawn.
- Fix: Do not send this to LATER with spec-phase. Add a behavior: default-on specless fallback, visible skip when disabled or when there are no requirement IDs, edge probe then prohibition recall, results passed into the planner prompt. Spec-phase lifting can stay LATER.

### R1-UPS-05 MAJOR coverage Executor deviation rules are named but not specified
- Severity: MAJOR.
- Category: coverage.
- Map entry: missing (cross-area only says "deviation rules 1-4", body not read).
- Evidence: `upstream:agents/gsd-executor.md:181-273`. Rules 1-3 auto-fix with no user permission (bug; missing critical correctness/security; blocking issue). Rule 3 excludes package-manager installs: do not substitute another name, return `checkpoint:human-verify` with `gate="blocking-human"`. Rule 4 stops for architectural change. Priority: Rule 4 over 1-3; unsure means Rule 4. Only fix issues caused by the current task; other findings go to `deferred-items.md`. Cap: 3 auto-fix attempts per task, then document and continue. `upstream:docs/explanation/security-model.md:76-79` points at this same Rule 3 exclusion.
- Fix: Add an ADOPT entry with those four rules, the install exclusion, the scope boundary, and the attempt cap. This is the executor contract the kit core has to re-implement; a name in the cross-area list is not enough.

### R1-UPS-06 MAJOR coverage Parallel execution skips checkpoints by default
- Severity: MAJOR.
- Category: coverage.
- Map entry: missing (interfaces table lists only `max_concurrent_agents` / `min_plans_for_parallel`).
- Evidence: `upstream:gsd-core/templates/config.json:35-41` and `upstream:docs/CONFIGURATION.md:1235`. `parallelization.enabled` true, `plan_level` true, `task_level` false, `skip_checkpoints` true ("Skip checkpoints during parallel execution"). The template was marked read in full; the config section 1227-1400 was marked read.
- Fix: Add the four keys and defaults to the interfaces table, and a behavior: when plan-level parallelization is on, checkpoints are skipped unless `skip_checkpoints` is set false. Also add template keys the table drops that are not merely LATER noise: `workflow.security_enforcement` true, `security_asvs_level` 1, `security_block_on` "high" (`config.json:10-12`).

### R1-UPS-07 MAJOR coverage Execute-phase blocking handoff and --interactive
- Severity: MAJOR.
- Category: coverage.
- Map entry: UPS-40 names `--interactive` and does not say what it does. The continue-here gate is only under discuss (UPS-15) and next (UPS-60).
- Evidence: `upstream:gsd-core/workflows/execute-phase.md:266-287`: before other work, a phase-directory `.continue-here.md` with `blocking` rows requires three inline answers (what, how it manifested, structural prevention) or a stop. `execute-phase.md:290-291`: `--interactive` runs plans sequentially inline (no executor spawn, wave grouping ignored) and shows a 4-option menu (execute / review-first / skip / stop) once per plan, not per task.
- Fix: Add both contracts to the execute-phase entries. Do not treat the discuss-phase check as covering execute. Note the path: the phase directory's `.continue-here.md`, which is not the same file as `.planning/.continue-here.md` in UPS-60.

### R1-UPS-08 MAJOR coverage Two default-on planning gates absent from the catalogue
- Severity: MAJOR.
- Category: coverage.
- Map entry: missing.
- Evidence: `upstream:docs/CONFIGURATION.md:505` `workflow.assumption_delta` default true: advisory only, fires when a phase makes something plural/optional/chosen that used to be singular/required/derived; an unresolved phase returns `{"skipped":true,"reason":"phase_unresolved"}` rather than a fabricated `detected:false` (#3909). `CONFIGURATION.md:541` `workflow.api_coverage_gate` default true: a phase that integrates an external API/SDK/service must produce a `COVERAGE.md` matrix at plan:pre; verify:pre fails the seal unless the matrix is complete; a phase whose scope cannot be established is held as `scope_unavailable`, not passed (#1562, #3909).
- Fix: Catalogue both. Recommendation consistent with the rest of the map: LATER, but state the fail-closed `phase_unresolved` / `scope_unavailable` rule so it is not lost. They are not UI or multi-runtime features.

### R1-UPS-09 MAJOR coverage Security explanation was in scope and holds the legitimacy thresholds
- Severity: MAJOR.
- Category: coverage.
- Map entry: UPS-20 (LATER, verdict names only). Coverage table marks `docs/explanation/security-model.md`, `capability-trust-model.md`, and `capability-overlay-model.md` NOT read. The brief requires every explanation document in full.
- Evidence: `upstream:docs/explanation/security-model.md:52-79` and `:104-109`. Research calls `package-legitimacy check` for npm/pypi/crates. Verdicts use `{ minAgeDays: 30, minWeeklyDownloads: 1000, requireRepo: true }` plus short-circuits for a missing package and a suspicious `postinstall`. `[SLOP]` is stripped before RESEARCH.md is saved. `[SUS]` and `[ASSUMED]` (any WebSearch-sourced name, even if `npm view` succeeds) become a human-verify checkpoint before install. Registry adapters time out at 5 seconds and degrade to `[SUS]` (`unknown-age` / `unknown-downloads`), they do not throw.
- Fix: Read the three explanation docs and either fold these thresholds into UPS-20 or say the LATER entry deliberately defers them and quote the threshold object so the spec can rebuild the gate without re-reading upstream. The install-failure stop is the executor rule in R1-UPS-05; do not drop it because the registry gate is LATER.

### R1-UPS-10 MAJOR proposal Vendoring contradicts a from-scratch kit
- Severity: MAJOR.
- Category: proposal.
- Map entry: UPS-87. Open question 9 recommends the same thing.
- Evidence: The mapper brief (`map-fanout.txt:3-4`) fixes "written from scratch" and "old code is reference only: nothing will be copied". Owner decisions in that preamble also say the GSD core ships as lifecycle, `.planning/` format, and generic agents, with a project adapter. `wildera:.agents/skills/gsd-plan/NOTICE.md:5-6` describes the port's sha256 pin and `port.mjs check`, which is a port mechanism, not the rewrite rule.
- Fix: Change the proposal from KEEP vendoring to DROP verbatim snapshots as the kit's source of behavior. The `check` idea (fail if a generated adapter drifts from a written contract) can stay as a kit test, pointed at the kit's own files. Leave "pin and re-vendor upstream" as an option the owner would have to explicitly reopen, not the recommendation.

### R1-UPS-11 MAJOR accuracy Phase-complete file scan does not read key-files and does not block
- Severity: MAJOR.
- Category: accuracy.
- Map entry: UPS-51.
- Evidence: `upstream:docs/CLI-TOOLS.md:247-270`. On `phase complete`, SUMMARY bodies are scanned heuristically (backticked paths and Created/Modified-style lines). Globs, URLs, bare hostnames, and paths outside the project are skipped. The `key-files:` frontmatter block is not read, so a summary whose only file claims live there produces no findings. There is no cap. Findings go to `warnings[]` and never block completion; the completion gate is VERIFICATION status. The standalone `verify-summary` verb still checks only the first two created files by default (`CLI-TOOLS.md:269-270`), which is a different check from this scan and from the execute-phase spot-check of the first two `key-files.created` (`execute-phase.md:1042`).
- Fix: State advisory-only, the body-scan limits, and that key-files frontmatter is invisible to this warning. Keep the REQ-line warning behavior, which matches `CLI-TOOLS.md:304-345` as summarized.

### R1-UPS-12 MINOR citation ScheduleWakeup rule is cited at the wrong lines
- Severity: MINOR.
- Category: citation.
- Map entry: UPS-32.
- Evidence: The "never call ScheduleWakeup" sentence (#4079) is at `upstream:gsd-core/workflows/plan-phase.md:436` and `:705`. `plan-phase.md:745-749` only tells the orchestrator to read `stall-detection-helpers.md`. `upstream:CONTEXT.md:333` is the `planner.stall_detection_enabled` default-on projection, not the wake-tool ban.
- Fix: Cite `plan-phase.md:436` (and `:705`) for #4079. Keep CONTEXT.md:333 only for the stall-detection flag.

### R1-UPS-13 MINOR citation Nested workflow-key rule is not at the lines UPS-04 cites for it
- Severity: MINOR.
- Category: citation.
- Map entry: UPS-04.
- Evidence: `upstream:docs/ARCHITECTURE.md:93-95` and `upstream:docs/CONFIGURATION.md:492-494` are only "absent = enabled". The general "gates honor only nested `workflow.*` keys" rule is `upstream:docs/ARCHITECTURE.md:331-335` (top-level `context_coverage_gate`, `auto_advance`, and `_auto_chain_active` do not count, #4978). `CONFIGURATION.md:1398` is the same rule for `context_coverage_gate` only, including the loader warning.
- Fix: Point the nested-key sentence at ARCHITECTURE.md:331-335. The absent=enabled cites can stay. The exception list should also name other documented default-off booleans in that same table (`plan_chunked`, `mvp_mode`, `text_mode`, `research_before_questions`, `worktree_skip_hooks`, `cross_ai_execution`, `auto_prune_state`, `ui_interaction_capture`), or say the list is illustrative.

### R1-UPS-14 MINOR accuracy Agent and compact counts
- Severity: MINOR.
- Category: accuracy.
- Map entry: UPS-64. Concerns repeats the same count.
- Evidence: `upstream:agents/*.md` frontmatter `name:` lines. 35 canonical agent files. 29 `.compact.md` siblings. No compact sibling for debugger, executor, phase-researcher, plan-checker, planner, verifier. ARCHITECTURE.md:215's "33" is what the map measured against; the directory is larger. The category list in UPS-64 does include domain-researcher and doc-synthesizer, so this is a count error, not a missing agent in the proposal.
- Fix: Say 35 agents and 29 compact siblings, and that six canonical agents have no compact file. Plan-checker tools (`Read, Bash, Glob, Grep, Skill`, no Write) and verifier tools match the frontmatter that was checked. "Executor has MCP context7 only" is true only as "the only MCP globs are context7"; the tool list also includes Read, Write, Edit, Bash, Grep, Glob, Skill (`agents/gsd-executor.md:4`). Say that.

### R1-UPS-15 MINOR coverage Verb checklist and workflow catalogue are thinner than the sources
- Severity: MINOR.
- Category: coverage.
- Map entry: UPS-63, UPS-66.
- Evidence: `upstream:gsd-core/bin/gsd-tools.cjs:11-46` and `:95-98` document `verify-summary`, `select-revert-commits` (#4661, exact conventional-commit scope, used by undo), `commit-docs-guard`, `verify-path-exists`, `user-story validate`, and `state-snapshot`. UPS-66's re-implementation list omits them. `verify-summary` is used by new-project (`new-project.md:766`), which is ADOPT. `undo.md:1-47` is `git revert --no-commit` (never reset) with `--last N | --phase NN | --plan NN-MM` and a confirmation gate; UPS-63 only says "undo (safe revert)". The brief asked for one purpose line per workflow; UPS-63 is a name list plus a bucket, not those lines.
- Fix: Add the adopted verbs to UPS-66, especially `verify-summary` (exit 0, trust JSON `passed`). Give undo its three modes and the never-reset rule. Paste the purpose line for each workflow into the catalogue, or attach it to the bucket so a later spec can see what `validate-phase`, `graduation`, `scan`, and `import` actually are.

### R1-UPS-16 MINOR structure Safe-resume exit and a few flag lists are slightly off
- Severity: MINOR.
- Category: accuracy.
- Map entry: UPS-41, UPS-18.
- Evidence: `upstream:gsd-core/workflows/execute-phase.md:223-225`: any non-zero from `evaluation-scope` makes the safe-resume gate exit 1. The comment says exit 69 means could not look; the gate does not re-exit 69. `plan-phase.md:124` also parses `--skip-ui`, `--skip-bounce`, `--no-tracer`, `--no-reversibility-gates`, `--ingest-format`, and `--view` (the last is described in UPS-21). UPS-18's flag list omits those. `--skip-bounce` matters because bounce is skipped when it is set (`plan-phase.md:1299`).
- Fix: Say the safe-resume gate fails closed with exit 1 when the resolver is non-zero, including 69. Add the missing plan-phase flags to UPS-18 or point at the entries that already define them.

## Citations checked

| map entry | citation | ok / wrong |
|---|---|---|
| UPS-08 | new-project.md:101-109 | ok: resume when `init_incomplete`, else error to progress; git init skipped inside a worktree, warn if nested (#4040, #3491) |
| UPS-08 | progress.md:34-70 | ok: `init_incomplete` routes to new-project; missing ROADMAP with `init_incomplete` false is Route F |
| UPS-09 | new-project.md:764-770 | ok: `verify-summary` exits 0, trust JSON `passed`; basename refusal list; inline recovery or stop |
| UPS-19 | plan-phase.md:118-120 | ok: Complete is the only gated status; `--reviews` never overridable; else `--force` or exit 1 |
| UPS-18 | plan-phase.md:104-108 | ok: `prior_verify_commands` emitted at every context window |
| UPS-21 | plan-phase.md:126-147 | ok: RESEARCH_ONLY, `--research` refresh, `--view` does not spawn |
| UPS-28 | plan-phase.md:1146 and :1291 | ok: missing/unknown severity counts as BLOCKER; INFO-only proceeds (#3724) |
| UPS-32 | CONTEXT.md:333 | wrong for #4079: this line is `planner.stall_detection_enabled` default true. See R1-UPS-12 |
| UPS-32 | plan-phase.md:745-749 | wrong for ScheduleWakeup: those lines only include the stall-helper step. The ban is at :436 and :705 |
| UPS-34 | plan-review-convergence.md:183 and :600 | ok: plan-phase and replan run inline; wrapping in Agent() removes the Agent tool at depth 1 (#936) |
| UPS-41 | execute-phase.md:213-234 | partial: commits without SUMMARY stop the dispatch; non-zero resolver exits 1, not 69. See R1-UPS-16 |
| UPS-46 | execute-phase.md:37-40 | ok: SUMMARY plus commits = complete; do not wait forever on the return signal |
| UPS-47 | CONFIGURATION.md:539, 556-557 | wrong as equated: 600s is the test-gate key; 556-557's "5-minute" disagrees with the step. See R1-UPS-03 |
| UPS-50 | execute-phase.md:1245 | ok: human_needed does not advance the phase |
| UPS-52 | execute-phase.md:296-328 | ok: fork `origin/<default>` with `--no-track`; fetch failure with no local copy aborts |
| UPS-56 | quick.md:1-39 and :783 | ok: `--discuss --research --validate` normalizes to full; checker max 2; id form `YYMMDD-xxx`, "2s Base36 precision" is the success-criteria wording |
| UPS-64 | agents/gsd-plan-checker.md:4 | ok: no Write |
| UPS-64 | agents/gsd-executor.md:4 | partial: context7 is the only MCP, not the only tool. See R1-UPS-14 |
| UPS-64 | agents/gsd-verifier.md:4 | ok: Read, Write, Bash, Grep, Glob, Skill |
| UPS-67 | CLI-TOOLS.md:46-69 | ok: absent field exit 1; null or `''` prints empty and exits 0; `--raw` plus `--pick` is `pick_output_not_json` |
| UPS-68 | CONTEXT.md:143-144 | ok: last phase writes `All phases complete`, never a bare milestone-complete; exact vocabulary, no substring scan |
| UPS-69 | CONTEXT.md:137-138 | ok: lock/preservation story matches; exactly two sanctioned bypass writers (`state sync`, `REGENERATE_STATE`); `updated[]` is dotted-leaf vs the pre-write snapshot; `last_updated` excluded, `state_head` not |
| UPS-71 | CLI-TOOLS.md:512-527 | ok: non-complete scope withholds the percentage; `state json` omits `progress.percent` rather than writing 0 |
| UPS-73 | CLI-TOOLS.md:843-863 | wrong on the caller rule: 66 is a real empty-scope verdict. See R1-UPS-01 |
| UPS-74 | ARCHITECTURE.md:343-377 | partial: phase empty-union degrade, reachability, subject match, and `block: false` are right; plan/quick empty match is not a degrade. See R1-UPS-02 |
| UPS-04 | ARCHITECTURE.md:93-95 | ok for absent=enabled only; does not support the nested-key sentence. See R1-UPS-13 |
| UPS-05 | CLI-TOOLS.md:217-222 | ok: `phases clear` excludes `0-*` and `999.*` |
| UPS-75 | roadmap.md:14-32 | ok: integer vs decimal INSERTED; `**Requirements**:` brackets optional |
| UPS-81 | CONTEXT.md:338-339 | ok: skip envelope reasons `skipped_commit_docs_false`, `skipped_gitignored`, `skipped_commit_docs_phase_false`; `commit` is the sanctioned writer |
| UPS-87 | UPSTREAM.json:1-19 and NOTICE.md:5-12 | ok as a description of the WildEra pin (planner, checker, verifier, executor, researcher, debugger, session manager, plan-phase research fragment). The KEEP-vendoring proposal is the defect, not the citation. See R1-UPS-10 |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
|---|---|---|
| upstream:README.md | yes, read fully | 0 (not re-read end to end) |
| upstream:CONTEXT.md | partial, disclosed | 0 new beyond UPS-68/69/71/81, which match the sections read (134-144, 331-348) |
| upstream:docs/explanation/the-phase-loop.md, context-engineering.md, multi-agent-orchestration.md, claude-orchestration-capability.md, embeddable-orchestration-system.md, interface-versioning-policy.md, live-dom-uat-capability.md | yes | 0 checked against the claims that cite them |
| upstream:docs/explanation/security-model.md, capability-trust-model.md, capability-overlay-model.md | listed as NOT read | security-model: legitimacy thresholds, degrade-to-SUS, WebSearch always ASSUMED (R1-UPS-09). Trust and overlay models not read in this review |
| upstream:docs/ARCHITECTURE.md | yes | evaluation-scope plan/quick case omitted (R1-UPS-02); gate nested-key rule at 331 not cited (R1-UPS-13) |
| upstream:docs/CLI-TOOLS.md | yes | phase-complete scan limits (R1-UPS-11); exit 66 (R1-UPS-01) |
| upstream:docs/CONFIGURATION.md (claimed ranges) | partial | `skip_checkpoints` (R1-UPS-06); `assumption_delta`, `api_coverage_gate` (R1-UPS-08); test vs build timeout wording (R1-UPS-03) |
| upstream:docs/features (phase lifecycle, quick, autonomous, map, verify, review, ship, milestones, workspaces, settings, models) | grouped; many marked read, spec-phase feature files and phase-management / phase-lifecycle-status-line / phase-dependency-analysis not in the "in full" list | not re-read file by file; the gates above are already in CONFIGURATION |
| upstream:gsd-core/workflows/new-project.md | yes | 0 in the ranges read |
| upstream:gsd-core/workflows/plan-phase.md | yes | specless probe (R1-UPS-04); ScheduleWakeup cite (R1-UPS-12); flag list (R1-UPS-16) |
| upstream:gsd-core/workflows/execute-phase.md | yes | continue-here and `--interactive` (R1-UPS-07); safe-resume exit (R1-UPS-16) |
| upstream:gsd-core/workflows/execute-phase/steps/post-merge-gate.md | steps marked NOT read; UPS-47 still states the gate | timeout split (R1-UPS-03). The spine delegates the contract here, so "read the spine in full" did not capture it |
| upstream:gsd-core/workflows/plan-review-convergence.md | yes | 0 in the ranges read (inline Skill, never-proceed on open conflicts, CYCLE_SUMMARY) |
| upstream:gsd-core/workflows/quick.md | yes | 0 against UPS-56 in the ranges read |
| upstream:gsd-core/workflows/progress.md | yes | 0 against UPS-08 in lines 34-70 |
| upstream:gsd-core/workflows/undo.md | catalogue only | modes and never-reset (R1-UPS-15) |
| upstream:gsd-core/workflows/*.md (other) | one grouped row; purposes not stored | purpose lines missing (R1-UPS-15) |
| upstream:agents/gsd-executor.md | frontmatter only, as the brief allowed | deviation rules 1-4 (R1-UPS-05). Still required for a kit that ADOPTs the executor |
| upstream:agents/*.md | frontmatter claimed | count 35/29 not 33/27 (R1-UPS-14). Plan-checker and verifier frontmatter match |
| upstream:gsd-core/bin/gsd-tools.cjs header | yes, lines 1-247 | verbs omitted from UPS-66 (R1-UPS-15). File is 5705 lines, not 5704 |
| upstream:gsd-core/templates/config.json, roadmap.md, state.md | yes | config.json parallelization and security defaults (R1-UPS-06). roadmap.md:14-32 matches UPS-75. state.md frontmatter starts at `status: planning`; the lifecycle in UPS-68 matches CONTEXT.md, not this placeholder |
| wildera:UPSTREAM.json, NOTICE.md, compatibility.md, SKILL.md | yes | description of the port matches; the KEEP-vendoring proposal does not match the rewrite brief (R1-UPS-10) |
