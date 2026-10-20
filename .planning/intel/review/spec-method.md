# Spec review: MTD

## Verdict
REVISE; 8 BLOCKER, 18 MAJOR, 1 MINOR.

The traceability table enumerates the area's absorbed IDs, and the specification correctly restores the harness method under D-111, defers the supervised debug engine, and moves project-specific knowledge into adapter data. However, several rows claim coverage of only part of their behavior. More importantly, the default worktree execution cannot transfer uncommitted worker output, wave commits cannot be resolved by the specified scope/undo interfaces, batch review has mutually exclusive ordering rules, and the roadmapper is forbidden to produce its own required artifacts. Preservation tests would force edits to protected upstream text. Adapter command/evidence interfaces and restart identity also need concrete contracts before independent implementations can interoperate. Review included the full seven relevant maps, decisions, synthesis, ingest conflicts, owner memories, the three dependency specifications and the four upstream project-format templates; no old commands or upstream code were run.

## Findings

### SR-MTD-01 MAJOR coverage Snapshot validation is missing from build
- Severity: MAJOR.
- Category: coverage.
- Target: GSDC-45, GSDC-47; GSP-08 trace row.
- Evidence: GSP-08 requires `build` to verify the pin, every snapshot hash and extra files before generating anything. Its row points only to GSDC-47, which requires a later `check` to detect these defects. GSDC-45 permits generating outputs from a tampered snapshot.
- Fix: require `upstream build` to perform the strict snapshot validation before its first output write, including pin consistency, missing/extra files and LF hashes. Add tests asserting generated files remain unchanged on each failure; trace GSP-08 to that requirement as well as check.

### SR-MTD-02 MAJOR coverage Skeleton revisions can freeze stale wiring
- Severity: MAJOR.
- Category: coverage.
- Target: GSDF-22; GSP-50, HIS-45.
- Evidence: GSP-50 explicitly routes `target: both` to both writers, realigns existing WIRING after an outline revision even without wiring-target issues, creates wiring when a revision first introduces cross-plan edges, and adds an integration review blocker for the new contract. GSDF-22 specifies only routing outline-target and wiring-target issues; GSDF-20 describes initial admission, not these revision transitions.
- Fix: add all three revision transitions, conditioned on an adapter architect being available and `wiring` not being `never`; when absent, route the cross-plan contract back to integration review. Test an outline-only revision changing a declaration and a revision introducing the first consumes edge; neither may freeze an unreviewed/stale contract.

### SR-MTD-03 BLOCKER coverage Safe resume misses the normal uncommitted-worker failure
- Severity: BLOCKER.
- Category: coverage.
- Target: GSDF-38; GDB-05 trace row.
- Evidence: GDB-05 checks baseline-relative changed/untracked files, code-root and HEAD drift, unauthorized changes, multiply owned paths, and implementation changes without SUMMARY. GSDF-38 checks only commits. GSDF-42 explicitly forbids worker commits, so a worker killed after editing code but before SUMMARY leaves exactly the case this gate cannot detect. SYNTHESIS M10 requires incomplete plans with changes but no SUMMARY to stop; INV-44 requires reconciliation before redispatch.
- Fix: retain a lightweight execute baseline and reconcile working-tree deltas, not just commit subjects, before every initial/resumed dispatch. Stop with recovery details on changed owned code without SUMMARY, root/HEAD drift and unauthorized paths. This does not require the deferred debug snapshot engine. Test a killed executor leaving an uncommitted tracked edit and an untracked created file with no commit or SUMMARY; neither may be dispatched over silently.

### SR-MTD-04 MAJOR coverage UAT loses evidence reconciliation and resolved-gap handling
- Severity: MAJOR.
- Category: coverage.
- Target: GSDF-57; UPS-54 trace row.
- Evidence: UPS-54 adopts commit-claim reconciliation using declared commits/bounded before-after evidence, cold-start smoke injection for startup changes, and reconciliation of existing gaps with completed `gap_ids` plans. GSDF-57 covers conversational classification and blocked rows only; its later item defers browser/DOM, not these safeguards.
- Fix: add these retained non-browser behaviors with the wave-evidence equivalent of commit reconciliation. Test a fabricated completion claim, a startup-changing plan missing cold-start evidence, and a resumed UAT whose gap has already been resolved by a completed gap plan. Do not mark the full UPS-54 row covered solely by the blocked-row test.

### SR-MTD-05 MAJOR coverage Code review has no deterministic scope or report contract
- Severity: MAJOR.
- Category: coverage.
- Target: GSDF-46; UPS-58 trace row.
- Evidence: UPS-58's adopted lite contract retains explicit-files > SUMMARY > evaluation-scope selection, root-level/extensionless paths, SUMMARY-vs-commit cross-checks, depth and REVIEW.md. GSDF-46 merely says review the plan's changed files and specifies findings; neither the selection algorithm nor a persisted review report is required. GSDC-39 provides a resolver but no required consumer here.
- Fix: define the review scope precedence and exclusions, cross-check missing SUMMARY paths against actual changes, and persist the current review/findings and resolution evidence at a named path with a schema. Keep the one-pass D-56 gate rather than restoring upstream fix loops. Test `Dockerfile`, an explicit narrow file list, an omitted changed source file and unrelated interleaved commits.

### SR-MTD-06 MAJOR coverage Adopted execution controls disappear behind a partial trace
- Severity: MAJOR.
- Category: coverage.
- Target: ADPT-13, GSDF-39, GSDF-42; UPS-40, UPS-90.
- Evidence: UPS-90 retains parallelization settings, including an explicit sequential switch; D-94 changes only checkpoint skipping, not the ability to disable concurrency. ADPT-13 says its key set is exact and provides no parallelization control. UPS-40 maps only to the init payload although execute args/per-run state are also adopted; `--gaps-only` key validation from UPS-37 is absent.
- Fix: specify the retained execute argument surface and project concurrency/sequential controls, integrated with M6's global cap, plus the missing-`gap_closure` refusal for gaps-only filtering. Add sequential-dispatch and malformed-gap-selection tests. Explicitly identify upstream ephemeral auto-chain machinery as not used if it is replaced by the kit's chaining state rather than silently claiming it through init.

### SR-MTD-07 MAJOR coverage Method lint and test trace rows overclaim their targets
- Severity: MAJOR.
- Category: coverage.
- Target: HARN-05..10; MTH-14, MTH-46, MTH-49, MTH-50, MTH-54 trace rows.
- Evidence: MTH-46 requires mode-specific structure checks (phase/meta agreement, null handling, connected inputs/outputs and mixed-mode handoffs); HARN-05..07 check metadata, banned tokens and file existence only. MTH-49 concerns discriminating assertions/graders and MTH-50 preserves prior iterations, but both point only to HARN-10's trigger tests. MTH-14's role/output sections and Write-plus-Edit guidance are not checked by HARN-05. D-111 restores rather than drops this method.
- Fix: add offline lint checks for the mechanical retained rules and named manual checks for semantic ones; trace carried guidance to HARN-01 where unchanged carriage is the actual guarantee. Point assertion and iteration behaviors to preserved testing-guide content, not trigger testing, and test that a second optional eval iteration cannot overwrite the first. Do not make optional A/B testing mandatory.

### SR-MTD-08 MAJOR testability Adapter scripts have no interoperable request/response schemas
- Severity: MAJOR.
- Category: testability.
- Target: ADPT-02..06, ADPT-15, GSDF-51.
- Evidence: ADPT-15 says JSON on stdin and one JSON line out, but defines neither object. ADPT-03 permits only prefixes, although D-61/GSP-18 require kind parsers/resolvers; it does not specify how command/filter/target data reach an argv runner. GSDC-19 requires `pending_shared`, absent from ADPT-03's resolver enum. Attribution is mentioned but has no configuration key. `hook_timeout_s` has no location/default schema, and `[script]` does not say how a non-executable `.mjs` script runs on Windows. ADPT-05's declared lens shape omits its subsequently mentioned `stage` key.
- Fix: define closed, versioned input/output shapes for resolution, ownership predicate and attribution; exact argv invocation/interpreter and placeholder or stdin binding; `pending_shared` ownership; timeout key location; all lens fields and defaults. Add a fixture adapter whose own implementation consumes only this contract and is exercised by both planning and execution. Include path-with-spaces and malformed-response cases.

### SR-MTD-09 MAJOR testability Gate evidence cannot prove that an obligation actually ran
- Severity: MAJOR.
- Category: testability.
- Target: ADPT-02, ADPT-15, GSDF-44, GSDF-55, GSDF-67.
- Evidence: GSDF-44 and GSDF-67 require zero-executed tests/steps to fail (INV-53), while ADPT-02 specifies only argv, timeout and exit codes. No runner result schema, executed-target list/count, freshness binding, log path or validator extension point is supplied. HIS-82 explicitly keeps validators in core Verify even without the engine. GSDF-55 consumes undefined `evidence[]`, and there is no rule tying it to the exact post-fix code and requested obligation.
- Fix: specify a generic machine-readable gate-evidence contract with requested obligation identity, executed targets/counts, outcome, timeout/unavailable state, evaluated input identity and log paths; the project supplies parsing/validation where needed. Require invalid, stale, incomplete and zero-execution evidence never to certify green or close debug. Test exit-0-with-zero-tests, stale logs and evidence made before a fixer changed a covered file.

### SR-MTD-10 MAJOR testability The phase status ladder lists names but not predicates
- Severity: MAJOR.
- Category: testability.
- Target: GSDC-13, GSDC-36; interface to PANL-15.
- Evidence: UPS-70 requires one authoritative ladder and projections. GSDC-13 says statuses are computed from counts, verification and completion but gives no truth table; `completion` itself is undefined once ROADMAP checkboxes lose authority. Its single stale-report test cannot distinguish EXECUTED/NEEDS_REVIEW/COMPLETE predicates. GSDC-36 similarly uses `halted`, `blocked_by` and `ready` without defining the persisted halt input. The panel and router must independently consume these answers.
- Fix: define the complete precedence/truth table, including zero plans, partial summaries, all summaries, missing/invalid/stale reports, passed-but-not-bookkept and halted dependencies; define any completion/halt record and its writer. Test each row against CLI, router and panel output rather than only requiring the same labels.

### SR-MTD-11 MAJOR testability Research attempt identity confuses fresh runs with resume
- Severity: MAJOR.
- Category: testability.
- Target: GSDC-30, GSDF-12, GSDF-32.
- Evidence: D-67 says a new run never inherits an interrupted attempt. GSDF-12 weakens that to an interrupted attempt 'of other inputs'; its acceptance says 'rerunning' accepts a killed writer's report, without distinguishing a new invocation from `--resume`. It simultaneously requires different keys on two identical refreshes, while scripts cannot read randomness/clock. GSDC-30 gives no field meanings or identity source.
- Fix: define the host-provided invocation identity and explicit resume identity, and define `before/done/result` for each attempt kind. A fresh invocation on identical inputs must not adopt an unfinished earlier attempt; an explicit resume must preserve the attempt and its pre-dispatch report hash. Test both paths, including a crash after the report write before completion recording.

### SR-MTD-12 BLOCKER decision Preservation acceptance requires deleting protected upstream instructions
- Severity: BLOCKER.
- Category: decision.
- Target: GSDC-12, GSDC-45, GSDC-50, GSDF-01, GSDF-50, HARN-01..02.
- Evidence: D-111 requires unchanged upstream bodies/workflow prose/templates with overriding adapter instructions. GSDC-12 instead requires rendered prompts to contain no STATE/ROADMAP/REQUIREMENTS write instruction, and GSDF-01 scans shipped skills for no native delegation instruction. The preserved upstream method contains these overridden instructions (GSP-03/05/72; UPS-45/87). GSDF-50 similarly prohibits executor prompts listing build/test commands despite the verbatim deviation/verification prose. GSDC-50's global deny-list scan would also reject retained upstream references, while GSDC-04 explicitly tests an unavailable `todo.match-phase`. HARN-01 accepts any differing hunk if listed in NOTICE, without testing that it actually belongs to HARN-02's allowed adapter regions.
- Fix: scope ban checks to executable plumbing and authoritative kit overlays, not protected upstream text or negative/unavailable declarations. Require the unchanged bodies plus explicit, last-applied precedence overlays that suppress unsupported operations. Inventory and hash protected method regions; allow only enumerated adapter-region transformations, not an arbitrary NOTICE entry. Test a preserved upstream native spawn/state-write instruction overridden by the adapter without deleting it, and an unauthorized method edit that remains rejected even if someone adds it to NOTICE.

### SR-MTD-13 BLOCKER decision One gap attempt can execute multiple gap waves
- Severity: BLOCKER.
- Category: decision.
- Target: GSDF-30, GSDC-27.
- Evidence: D-73 and INV-37 cap gap closure at one wave, enforced in code. GSDF-30 only refuses a second attempt after a gap wave executed and allows `gap-w<k>` handoffs. Nothing prevents the first attempt containing plans in waves 1 and 2, or tracer splitting producing two execution waves.
- Fix: validate the final gap handoff has at most one execution wave before dispatch; multi-wave gap plans must return `needs-owner` rather than executing the first attempt wholesale. Persist and reuse the one-wave consumption state across crashes. Test a single gap attempt with two dependent waves and a tracer split, plus resume after that one wave has run.

### SR-MTD-14 BLOCKER decision Self-verifying fixers have no bound or stall escalation
- Severity: BLOCKER.
- Category: decision.
- Target: GSDF-49, GSDF-50, GSDF-67.
- Evidence: GSDF-50 requires fixer commands to run 'until green before returning'; calling one fixer once in batch mode does not bound that agent's internal build/fix loop. INV-37 requires every loop to have a bound, stall rule and named escalation. The M6 model-time watchdog excludes tool time and is not a build-attempt budget. GSDF-67 has a similar mismatch: one agent per invocation (GSDF-64), a max-turns check supposedly stopping a looping agent, and an owner answer that must not refill a budget, but no definition or persisted usage for those turns/minutes.
- Fix: specify an explicit finite attempt/time and no-progress policy for the self-verifying fixer, with a structured unresolved result allowed when red rather than an instruction never to return. For the plain debugger define which host-observable unit a turn means, enforce the deadline with the existing runtime, and persist remaining budget across checkpoint continuations without restoring the deferred supervisor engine. Test a fixer whose build repeatedly fails and a continued debug session with exhausted budget; both must stop and report evidence within their bounds.

### SR-MTD-15 BLOCKER consistency Default worktree execution merges branches with no worker changes
- Severity: BLOCKER.
- Category: consistency.
- Target: GSDF-41..43, GSDF-53, ADPT-13; dependencies PHCL-31, FLOW-27.
- Evidence: ADPT-13 defaults to worktree isolation. Workers are forbidden to stage/commit code by GSDF-42, while GSDF-41 requires merging their branches in plan order. A git merge transfers committed history, not the worker's dirty files/SUMMARY. No requirement has the orchestrator collect, validate and commit the dirty worktree before merge, and GSDF-53's final wave/per-plan commits occur without a defined transfer step. UPS-44/45 specifically protect against lost isolated output.
- Fix: define the orchestrator-owned transfer transaction: inspect worktree changes and SUMMARY, enforce owns/deletion scope, preserve unrelated dirty/index state, then transfer or commit the validated changes and integrate in plan order before the gate. Workers still never commit. Keep failed/uncertain worktrees recoverable. Add a real offline git fixture with two uncommitted worker outputs and SUMMARYs; main receives both and the green gate tests the integrated files, not unchanged branch tips.

### SR-MTD-16 BLOCKER consistency Default wave commits are invisible to scope resolution and undo
- Severity: BLOCKER.
- Category: consistency.
- Target: GSDF-53, GSDC-39, GSDC-40, GSDF-38, GSDF-62.
- Evidence: GSDF-53 defaults to `type(<phase>-w<k>)` and claims GSDC-39/40 can scope it. Those requirements match exact plan subjects `type(<phase>-<plan>)`, and phase undo accepts the phase or numbered-plan scopes, not wave scopes. UPS-74 and UPS-94 explicitly require adapting task-commit evidence to wave commits. A plan sharing one wave commit also cannot be safely undone in isolation merely by reverting that commit.
- Fix: define a durable mapping from execution wave commit to plan IDs and exact files/evidence, use it in evaluation scope/safe resume/phase undo, and specify plan-undo behavior when the commit also contains sibling plans (refuse/escalate to confirmed wave scope rather than silently reverting siblings). Test the default per-wave policy end to end, including decimal phases, interleaved unrelated commits and `--plan` undo of one member of a shared commit.

### SR-MTD-17 BLOCKER consistency Roadmapper output contradicts the single-writer rule
- Severity: BLOCKER.
- Category: consistency.
- Target: GSDF-07, GSDC-12, GSDC-45.
- Evidence: UPS-07's roadmapper writes ROADMAP/STATE before returning. GSDF-07 runs that generated agent and validates coverage 'before writing', but supplies no alternate draft/result contract. GSDC-12 says all shared planning files have only an orchestrator writer. Preserving the upstream roadmapper body without an explicit adapter redirect therefore either violates INV-38 or leaves new-project with no way to obtain its required files.
- Fix: add a roadmapper overlay and return/draft schema: worker writes only granted draft paths or returns structured proposals; orchestrator validates coverage, presents approval and writes final ROADMAP/STATE through the designated writers. Add a fake-worker fixture demonstrating no final shared file is modified before approval and a rejected roadmap leaves them unchanged. Keep the roadmapper method body intact.

### SR-MTD-18 BLOCKER consistency Batch review and green-gate ordering are mutually incompatible
- Severity: BLOCKER.
- Category: consistency.
- Target: GSDF-46, GSDF-47, GSDF-49, ADPT-13.
- Evidence: GSDF-49 allows per-wave review during code-only batch waves (`batch_review:true` by default) with no intermediate gate. GSDF-47 forbids any reviewer before the final build in batch mode; GSDF-46 requires a green wave before review. INGEST-CONFLICTS W-18 explicitly calls for configurable per-wave review and one phase-level review before the final build, but GSDF-49 omits that phase review entirely. These rules cannot all hold in the default configuration.
- Fix: publish one explicit stage sequence per mode using D-63/W-18 as the batch-specific exception to the normal built-code rule, with the phase-level review retained, and scope GSDF-46/47 accordingly. Distinguish code-only advisory review evidence from green verification evidence; define which findings the one final fixer receives. Add event-order fixtures for both values of `batch_review` and failed final builds; no implementation should have to choose which contradictory MUST to ignore.

### SR-MTD-19 MAJOR consistency Role fallback disagrees with M5 and several review roles cannot be configured
- Severity: MAJOR.
- Category: consistency.
- Target: ADPT-11, GSDF-18, GSDF-37; runtime PHCL-22, FLOW-04.
- Evidence: ADPT-11 explicitly falls back to the agent tier for a role absent from the table. PHCL-22 instead makes a missing role a usage error, including its acceptance test. FLOW-04 has no `role` option despite claiming PHCL-22 resolution. GSDF-37 introduces cheap finders, verifier and judge but ADPT-11's exact role enumeration supplies no finder/judge role; per-lane skeleton model/effort selection from GSP-43/49 is also not concretely represented.
- Fix: distinguish an invalid role name from a recognized role with no override, define where M10 resolves/passes role selections into `agent()`, and supply configurable model/effort entries for every dispatched review role and per-lane overrides. Add one cross-module resolution matrix including absent overrides, role-specific effort, per-run override and finder/judge dispatch.

### SR-MTD-20 MAJOR consistency Nested partial overlays do not receive the promised defaults
- Severity: MAJOR.
- Category: consistency.
- Target: ADPT-01, ADPT-14, ADPT-02, ADPT-11..13; platform CONF-04.
- Evidence: CONF-04 merges `adapter`/`gsd` one level per entry, replacing the entire nested entry. ADPT-14 says any omitted `gsd` or `adapter` key gets its default and adding a key changes only that key. For example, `{adapter:{commands:{test:[...]}}}` replaces the whole commands object and loses build timeouts/gates/verify; `{gsd:{plan_limits:{plans_per_phase:15}}}` loses task and wave defaults. Closed validation then fails a plausible generated differences-only adapter.
- Fix: state merge depth for each nested contract and align with M3. Either recursively merge these documented nested objects (with explicit map/array replacement rules) or require full replacement objects and narrow ADPT-14 accordingly. Add partial commands, role-entry, plan-limit, debug and commit-policy overlays to the shared loader contract tests.

### SR-MTD-21 MAJOR consistency Seed existence can make new-project refuse a freshly installed project
- Severity: MAJOR.
- Category: consistency.
- Target: GSDC-01, GSDF-08; platform INST-17, INST-30.
- Evidence: INST-17 delegates the exact `.planning/` seed set to GSDC. GSDC-01 enumerates an adopted tree but never says which files are created at install or how placeholders are recognized. GSDF-08 treats existence of PROJECT/REQUIREMENTS/ROADMAP/STATE as a complete project and refuses new-project. An implementation that seeds those four templates, as the install wording permits, breaks D-109's required install -> map -> harness -> new-project flow.
- Fix: define the exact install seed set and a machine-checkable initialization predicate distinct from mere file existence (or do not seed final project artifacts). Test the whole prescribed startup sequence from an empty installed repo, an interrupted initialization and a genuinely initialized project.

### SR-MTD-22 MAJOR consistency Forensics both forbids and requires a STATE write
- Severity: MAJOR.
- Category: consistency.
- Target: GSDF-63.
- Evidence: the requirement says the only file written is the forensic report, but its overlay says STATE gets one line when the active phase is involved. Its acceptance requires `git status` to show only the report. GDB-52 records this exception explicitly.
- Fix: make the active-phase orchestrator STATE session note the sole named exception to report-only output and test active/non-active investigations separately, including preservation of all other files. Do not let the forensic worker or upstream procedure bypass GSDC-12's writer rule.

### SR-MTD-23 MAJOR consistency Universal JSON/exit contract contradicts helper verbs
- Severity: MAJOR.
- Category: consistency.
- Target: GSDC-02, GSDC-31, GSDC-41, GSDF-03; runtime PHCL-01.
- Evidence: GSDC-02 requires every verb's final line to be JSON and exits only 0/1/66/69. `hash` prints a bare sha, and `run-with-timeout` inherits arbitrary child output and exit 124/child codes. `normalize-test-command` returns a command without a specified JSON envelope. GSDF-03's universal last-line JSON parser cannot safely consume these outputs, and M5's generic thrown-error handler must not collapse GSD statuses to 1.
- Fix: enumerate the raw/passthrough helper exceptions and give their exact output/exit shapes, or wrap them uniformly and adapt their callers. State the dispatch boundary preserving GSD exit codes. Test hash, a command ending in non-JSON text, child exit 3, timeout 124, missing input 66 and unavailable 69 through the actual `ph gsd` entry/helper.

### SR-MTD-24 MAJOR coverage Unchanged GSD workflow carriage is promised but not enumerated or checked
- Severity: MAJOR.
- Category: coverage.
- Target: GSDC-44..47, GSDF section introduction.
- Evidence: D-111 protects GSD agent bodies, workflow prose and templates. GSDC-45 enumerates agents but only discuss and forensics workflow text; GSDF's introduction claims every upstream-backed skill body is covered by GSDC-45. There is no build/source mapping for new-project, map-codebase, plan, execute, verify-work, quick, progress/next, pause/resume or undo, so these could be newly summarized implementations while all listed equality tests pass. D-62 permits kit-written scripts, not rewritten method prose.
- Fix: add a complete generated-skill/workflow/template inventory mapping installed path to pinned source path, transformations and overlay. Include every adopted method entry in reachability, equality and dangling-reference checks; explicitly identify kit-only wrappers such as standalone research. Test that a one-line method alteration in each generated workflow family fails check, while a permitted overlay change does not require editing upstream text.

### SR-MTD-25 MAJOR coverage Single-writer guard omits alternate shared-file mutators
- Severity: MAJOR.
- Category: coverage.
- Target: GSDC-10, GSDC-12, GSDC-31, GSDC-42.
- Evidence: GSDC-12's guarded verb list omits `health --repair`, which GSDC-42 expressly uses to rewrite STATE; GSDC-10 calls only `state` verbs the writers despite phase completion and repair also writing. `write <phaseDir> <NAME>` has a NAME regex but no phase-directory containment requirement; an arbitrary `.planning` argument with NAME STATE could bypass a verb-name-only restriction. INV-38 is about the files, not selected command names.
- Fix: centralize worker refusal and lock/derivation rules at shared planning-file mutation boundaries, cover repair/phase completion and constrain `write` to resolved phase artifacts. Add worker-env tests for every mutator and path-escape/arbitrary-directory tests proving no alternate route rewrites STATE/ROADMAP/REQUIREMENTS.

### SR-MTD-26 MINOR testability Skeleton acceptance has an impossible issue count and ambiguous pass result
- Severity: MINOR.
- Category: testability.
- Target: GSDF-22 acceptance.
- Evidence: it says '3 issues, 1 resolved per pass -> pass 3 with 2 open'. With resolutions in passes 2 and 3, one remains, not two; 'pass 3' also reads as successful gate completion despite unspecified remaining severities. GSP-50's illustrative test needs explicit intermediate counts rather than copying its shorthand.
- Fix: replace with a deterministic sequence: pass 1 opens three IDs, pass 2 resolves one (two remain), pass 3 resolves one (one remains); assert `needs-owner` for a blocker and passed-with-carried-warning for a warning. Add a separate 3 -> 2 -> 2 stall assertion.

### SR-MTD-27 MAJOR over-spec Adapter lint rejects unrelated project-owned content
- Severity: MAJOR.
- Category: over-spec.
- Target: HARN-05, HARN-06.
- Evidence: HARN-05 requires checking every project skill/agent and bans any `.claude/commands/` file; HARN-06 rejects token presence rather than invocation, including `SendMessage` and `broadcast`. MTH-46 checks harness-generated outputs, and SYNTHESIS M11 specifies generated-text lint. D-06 deliberately permits SendMessage in main sessions. A pre-existing owner command, a skill explaining a prohibited call, or a domain document using the word broadcast can make a perfectly valid generated adapter fail, although the kit neither owns nor generated those files.
- Fix: scope mandatory adapter lint to generated/adapter-referenced assets, classify operational native primitive calls separately from quoted examples/ban documentation, and treat unrelated owner content as advisory or outside scope. Do not change provider settings to satisfy lint. Test a clean generated adapter beside an unrelated owner command/skill, plus a generated executable native delegation instruction that must still fail.

## Traceability rows checked

The following 84 rows were checked against their map entries, not merely checked for an existing requirement ID. `ok` means the claimed row has the retained behavior after the overriding decisions; it does not exempt that requirement from an interface finding above. `wrong` includes partial coverage and an incorrect claimed destination.

| behavior ID | requirement claimed | ok / wrong (why) |
| --- | --- | --- |
| GSP-01 | GSDC-44 | ok — trimmed pin/hash snapshot and clone refusal retained under D-62. |
| GSP-02 | GSDC-44 | ok — HEAD read without running git in the untrusted clone. |
| GSP-03 | GSDC-45 | ok — frontmatter, precedence overlay and path-rewritten body retained. |
| GSP-04 | GSDC-45 | ok — the three rewrite families and exclusion example specified. |
| GSP-05 | GSDC-46, GSDF-42 | ok — verbatim executor blocks plus generic runtime departures. |
| GSP-06 | GSDC-46 | ok — named plan-contract anchors fail the build when absent. |
| GSP-07 | GSDC-45 | ok — discuss/forensics generated with method preserved. |
| GSP-08 | GSDC-47 | wrong — later check does not require build to refuse before output writes (SR-MTD-01). |
| GSP-09 | GSDC-47 | ok — drift, direct references and unmapped verbs checked. |
| GSP-10 | GSDC-48 | ok — deliberate offline bump/build/check workflow. |
| GSP-11 | GSDC-04 | ok — unavailable verbs have reasons and exit 69. |
| GSP-13 | GSDC-05 | ok — parser features, BOM/CRLF and conformance/error tests. |
| GSP-14 | GSDC-06 | ok — decimal phase resolution and outline exclusion. |
| GSP-16 | GSDC-09 | ok — table/bullets and configurable IDs follow D-69. |
| GSP-18 | GSDC-19, ADPT-03 | wrong — prefix-only vocabulary does not define the parser/runner binding (SR-MTD-08). |
| GSP-19 | GSDC-19, ADPT-15 | wrong — probe fields exist but adapter input/result schemas and status agreement are missing (SR-MTD-08). |
| GSP-20 | GSDC-20 | ok — placeholder blockers and restatement warnings retained. |
| GSP-22 | GSDC-22 | ok — requirements plus decisions gate, extra IDs advisory. |
| GSP-23 | GSDC-23, ADPT-04, GSDF-41 | ok — generic disjoint owns and adapter-defined shared rules replace engine paths. |
| GSP-24 | GSDC-24 | ok — outline marker, flexible columns and manifest. |
| GSP-27 | GSDC-26 | ok — wave dependency/overlap checks and subset dependencies. |
| GSP-28 | GSDC-27 | ok — executor-neutral handoff and mode-specific tracer split. |
| GSP-29 | GSDC-28, ADPT-07 | ok — owner-input invalidation and HEAD-only reporting follow D-75. |
| GSP-30 | GSDC-29 | ok — obsolete plans/SUMMARYs moved, never deleted. |
| GSP-31 | GSDC-30 | wrong — common attempt fields do not establish fresh/resume identity (SR-MTD-11). |
| GSP-33 | GSDC-32 | ok — metadata, final marker, required sections and stale/blocked readback. |
| GSP-34 | GSDC-33 | ok — upstream fragment rendered by values, optional paths omitted. |
| GSP-35 | GSDC-34 | ok — invalid versus stale distinction and fingerprint failure semantics retained. |
| GSP-38 | GSDF-15 | ok — 1..3 caps and nonempty lanes follow D-68. |
| GSP-40 | GSDF-81 (later) | ok — admission lease deferred by D-78/D-88. |
| GSP-41 | GSDF-16 | ok — Discuss/research gates, explicit skip reason, gaps policy. |
| GSP-42 | GSDF-14 | ok — approved research or explicit NONE in all planning consumer prompts. |
| GSP-43 | GSDF-18, ADPT-11 | wrong — missing-role fallback and per-lane resolution do not align with runtime (SR-MTD-19). |
| GSP-46 | GSDF-01, GSDF-27 | ok — first owner marker stops; no three-strike conflict rule. |
| GSP-47 | GSDF-19 | ok — regeneration cannot certify an old outline; bounded mechanical fixes. |
| GSP-48 | GSDF-20 | ok — initial wiring stage is conditional on a project architect per D-109. |
| GSP-49 | GSDF-21 | ok — fresh lanes and one retry on a missing lane result. |
| GSP-50 | GSDF-22 | wrong — missing both-target routing, realignment and newly introduced wiring (SR-MTD-02). |
| GSP-52 | GSDF-23 | ok — every gate outcome recorded; only passed freezes. |
| GSP-53 | GSDF-24 | ok — per-wave planners join before serial revision recording. |
| GSP-54 | GSDF-25 | ok — disk structure check and one fixer turn. |
| GSP-55 | GSDF-26 | ok — deterministic findings counted, cap/stall, fresh checker and checked revision. |
| GSP-57 | GSDF-30 | wrong — one attempt is not enforcement of one execution wave (SR-MTD-13). |
| GSP-61 | GSDF-12 | wrong — fresh invocation on unchanged inputs may inherit an interrupted attempt (SR-MTD-11). |
| GSP-64 | GSDF-55 | wrong — readback retained but gate evidence input/freshness contract incomplete (SR-MTD-09). |
| GSP-66 | not a requirement; generic contract in GSDC-27, GSDF-42, GSDF-44 | ok — code-wave is dropped under D-109; retained generic contracts named. |
| GSP-68 | not a requirement: project-specific packet gate dropped | ok — valid D-110 exclusion. |
| GSP-75 | GSDF-01, GSDF-28 | ok — reasoned override persists; conflict cannot be forced. |
| GSP-83 | not a requirement: documentation drift settled | ok — D-74/D-75 are valid reasons, not dropped live behavior. |
| GSP-86 | GSDF-49 | wrong — batch-review ordering conflicts with GSDF-47 and omits W-18 phase review (SR-MTD-18). |
| UPS-07 | GSDF-07 | wrong — no roadmapper draft contract compatible with the single writer (SR-MTD-17). |
| UPS-08 | GSDF-08 | wrong — seed completeness is undefined and can trigger the refusal on first use (SR-MTD-21). |
| UPS-09 | GSDF-09 | ok — SUMMARY self-heal only from a full document; no false done. |
| UPS-11 | GSDF-05 | ok — four mappers, seven docs, paths and pre-commit secrets gate. |
| UPS-31 | GSDF-36, GSDF-86 (later) | ok — bookkeeping adopted, gap table explicitly later. |
| UPS-33 | not a requirement: plan bounce dropped | ok — replaced by D-66 optional plan review. |
| UPS-40 | GSDC-17 | wrong — init alone does not cover adopted execute args/per-run controls (SR-MTD-06). |
| UPS-44 | GSDF-41 | wrong — ordered merge cannot transfer uncommitted worker outputs under the new contract (SR-MTD-15). |
| UPS-47 | GSDF-44, GSDC-41, ADPT-02 | ok — 300/600 timeouts and green-only tracking retained; evidence interface defect separately reported. |
| UPS-54 | GSDF-57, GSDC-16, GSDF-91 (later) | wrong — non-browser evidence/commit and completed-gap reconciliation missing (SR-MTD-04). |
| UPS-58 | GSDF-46 | wrong — deterministic scope/depth/report portion not specified (SR-MTD-05). |
| UPS-65 | not a requirement: compact variants dropped | ok — Claude-only carriage decision. |
| UPS-70 | GSDC-13, GSDC-08, GSDF-59 | wrong — status names without predicate/projection table do not define authoritative status (SR-MTD-10). |
| UPS-74 | GSDC-39, GSDF-53 | wrong — wave-commit adaptation missing (SR-MTD-16). |
| UPS-90 | GSDF-42 | wrong — owner checkpoint rule covered, retained sequential/parallel controls omitted (SR-MTD-06). |
| UPS-94 | GSDC-40, GSDF-62 | wrong — exact scope retained only for plan subjects, not default wave commits (SR-MTD-16). |
| GDB-04 | not a requirement: no v1 restore engine | ok — D-85 explicitly narrows the mtime lesson to restore mechanisms; undo uses git revert. |
| GDB-05 | GSDF-38 | wrong — uncommitted baseline-relative drift is absent (SR-MTD-03). |
| GDB-07 | GSDC-43 | ok — slug grammar and collision behavior retained. |
| GDB-10 | GSDC-43 | ok — signature reuse/reopen carries earlier fix evidence without engine state. |
| GDB-24 | GSDF-65, GSDC-43 | ok — untrusted-data boundaries and session indentation retained. |
| GDB-45 | GSDC-45 | ok — debugger body preserved with overlay. |
| GDB-52 | GSDF-63 | wrong — report-only check contradicts the active-phase STATE exception (SR-MTD-22). |
| GDB-55 | not a requirement: state.json not carried | ok — D-78/D-82 remove the second machine-state vocabulary. |
| MTH-02 | HARN-01 | ok — D-111 restores execution-mode method carriage. |
| MTH-19 | HARN-01 | ok — D-111 specifically retains the QA guide, rather than trimming its method examples. |
| MTH-46 | HARN-05, HARN-06, HARN-07 | wrong — selected lint checks do not cover mode-specific validation (SR-MTD-07). |
| MTH-49 | HARN-10 | wrong — trigger counts do not cover assertions/graders (SR-MTD-07). |
| MTH-50 | HARN-10 | wrong — trigger testing does not preserve eval iterations/workspaces (SR-MTD-07). |
| MTH-60 | HARN-13 | ok — five columns and date/cell lint follow D-60. |
| MTH-61 | HARN-17 | ok — D-111 restores ai-orchestrator with updated adapter wording. |
| HIS-52 | not a requirement: superseded by HIS-51 | ok — old review fix-loop configuration is not carried. |
| HOK-26 | ADPT-06 | ok — checker-per-extension contract; generic before/after shell belongs to M8. |
| WFL-46 | GSDF-46 | ok — D-56 replaces the old missing-verdict-as-confirmed defect with unverified blocking. |
