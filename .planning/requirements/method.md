# Requirements: method (M9 gsd-core, M10 gsd-flows, M11 harness, M12 adapter)

Scope: the GSD lifecycle and `.planning/` formats (M9, M10), the vendoring of upstream GSD text (D-62), the harness skill carried unchanged with its adapter layer (D-111), the adapter generator role (D-109 through D-111 point 4) and the adapter contract (D-77 sections `adapter` and `gsd`). Inputs: `intel/SYNTHESIS.md`, `intel/DECISIONS.md` (D-109, D-110, D-111 override older rows), `intel/INGEST-CONFLICTS.md`, maps `gsd-plan`, `gsd-upstream`, `gsd-debug`, `method`, `history` (HIS-19, HIS-38..39, HIS-42..63, HIS-66..70, HIS-74, HIS-79..86), `hooks` (HOK-26, HOK-27), `workflow` (WFL-46).

Conventions used below:
- `ph gsd <verb>` = `node .agents/harness/ph.mjs gsd <verb>` run from the project root; workflow scripts call the same verbs as a library (M6 `shell()` or in-process).
- "Fixture test" = offline test under the kit's `tests/` (never shipped) with temp project dirs (paths with spaces), fake Paseo/Claude CLIs, no live daemon or owner config (INV-57).
- "Live smoke" = named manual check run by the owner or the maintainer through `ph` on `circle/gpt-6-luna-fast[1m]` (INV-50).
- Vanilla (D-110): no project, engine or game vocabulary in any requirement; project data comes from the adapter (ADPT requirements).
- Skill text (D-111): harness method text and vendored GSD text are carried unchanged; each requirement that touches them names the adapter-layer part the kit changes.

## M9 gsd-core (GSDC)

### GSDC-01 `.planning/` file set
- Requirement: install seeds only the empty `.planning/` folder (INST-17); every `ph gsd` writer and GSD flow uses only the adopted tree: `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `drafts/` (roadmapper drafts, GSDF-95), `codebase/`, `research/`, `phases/<NN>-<slug>/`, `quick/`, `debug/` (`<slug>.md`, `resolved/`, `knowledge-base.md`), `forensics/`, `.continue-here.md`; no verb creates `.planning/config.json`, `todos/`, `threads/`, `seeds/`, `workstreams/` or `MILESTONES.md`; a project is initialized iff PROJECT, REQUIREMENTS, ROADMAP and STATE all exist and STATE frontmatter carries `gsd_state_version` (one predicate, `ph gsd init.project` returns `{initialized, missing[]}`).
- Acceptance: fixture test runs every write verb against a project started from an empty `.planning/`; the resulting tree contains only the adopted paths; a grep of shipped `ph gsd` code finds no `config.json` path under `.planning`; `init.project` on an empty `.planning/` returns `initialized:false` with all four missing, and on a project with a STATE lacking `gsd_state_version` returns `initialized:false`.
- Source: UPS-03, UPS-08, GSP-73, D-77, D-82, D-89, D-93, D-109.
- Scope: v1

### GSDC-02 `ph gsd` output and exit contract
- Requirement: every verb prints one JSON document as the last stdout line; `--pick a.b[-1].c` prints the field as a bare value (null or empty string prints an empty line, exit 0), an absent field or non-object root prints nothing on stdout, names the available keys on stderr and exits 1 (`pick_field_absent`); exit codes are 0 ok, 1 negative verdict (JSON on stdout) or usage/error (`{status:"error", error}`), 66 nothing in scope, 69 could not look or not ported; the only exception is `run-with-timeout` (GSDC-41), which passes the child's output through and then prints its own JSON last line, exiting with the child's code or 124; `hash` and `normalize-test-command` follow the JSON rule (`{hash}`, `{command}`); the `ph` dispatcher returns the verb's exit code unchanged (never collapses 66 or 69 to 1).
- Acceptance: fixture test per verb through the real `node .agents/harness/ph.mjs gsd` entry snapshots exit code and JSON shape; `--pick missing` exits 1 with empty stdout; `--pick` on a null field prints `\n` and exits 0; `hash` prints `{"hash":...}`; `run-with-timeout 5 -- node -e "console.log('x');process.exit(3)"` prints `x` then a JSON line and exits 3; a missing phase exits 66 and an unavailable verb 69 through `ph`.
- Source: GSP-12, UPS-66, UPS-67, UPS-73, GDB-56, INV-36, P8.
- Scope: v1

### GSDC-03 `--root` code-root re-pointing
- Requirement: `--root <dir>` re-points phase paths, git calls and digests to another checkout or worktree of the project; a dir without `.git` (file or folder) is refused with exit 69; harness files (vendored text, adapter, run records) are still read from the invoking checkout.
- Acceptance: fixture test with a git worktree: `ph gsd waves 1 --root <wt>` reads the worktree's plans; `--root` on a plain folder exits 69.
- Source: GSP-82, D-26.
- Scope: v1

### GSDC-04 Verb table with "not ported" reasons
- Requirement: `ph gsd` holds one verb table mapping every upstream gsd-tools verb named by vendored text to `ported` or `{ported:false, reason}`; a non-ported or unknown verb prints `{status:"unavailable", verb, reason}` and exits 69, never 0.
- Acceptance: fixture test: `ph gsd query todo.match-phase` exits 69 with a reason; a scan of the table asserts no `ported:false` verb path returns 0.
- Source: GSP-11, UPS-66, INV-36, D-61.
- Scope: v1

### GSDC-05 Frontmatter parser
- Requirement: the kit's YAML-subset parser reads block maps and sequences, flow `[..]`/`{..}` (also multi-line), quoted and plain scalars (null, booleans, integers, floats), `|` and `>` blocks and comments outside quotes; BOM and CRLF are tolerated; a parse error is returned as `{error}` with the line, never thrown and never a silent field drop.
- Acceptance: conformance fixtures (PLAN with nested `must_haves`, SUMMARY with `key-files`, VERIFICATION with `gaps[]`, CONTEXT, malformed cases) parse to exact expected JSON; each malformed case yields an error naming its line.
- Source: GSP-13, D-61.
- Scope: v1

### GSDC-06 Phase ids, directories and artifact kinds
- Requirement: phase ids are integers or decimals (`1`, `01.1`, `2.1`), resolved to `.planning/phases/<padded>[-<slug>]`; artifact kinds come from filenames (`<NN>-<MM>-PLAN.md`, `-SUMMARY.md`, `-CONTEXT.md`, `-RESEARCH.md`, `-VERIFICATION.md`, `-UAT.md`, `-PLAN-OUTLINE.md`, `-WIRING.md`, `-OUTLINE-REVIEW.md`); `<NN>-PLAN-OUTLINE.md` is never listed as a plan; no `999.*` backlog sentinel exists.
- Acceptance: fixture test: `ph gsd find-phase 1.1` resolves `01.1-x`; `phase list-plans 1` omits the outline file.
- Source: GSP-14, UPS-05.
- Scope: v1

### GSDC-07 ROADMAP grammar and `roadmap get-phase`
- Requirement: a phase is a `##`..`####` heading `Phase <N>[.<M>]: <name>` holding `**Goal**`, `**Depends on**`, `**Requirements**` and `**Success Criteria**` (numbered list); `roadmap get-phase <id>` returns `{found, phase_number, phase_name, goal, depends_on, requirements, success_criteria, section}` or exits 66; the Requirements line splits on commas and whitespace, `TBD`/`None` are declared-empty, and a malformed token yields a warning of kind `req-line-misparse`, `req-line-range-reading` or `req-line-unverified` instead of a silent drop.
- Acceptance: fixture ROADMAP from the upstream template parses to expected JSON; `**Requirements**: REQ-01; REQ-02` warns naming `REQ-02`.
- Source: GSP-15, UPS-75.
- Scope: v1

### GSDC-08 `roadmap analyze` and `roadmap annotate-dependencies`
- Requirement: `roadmap analyze` derives per phase plan count, summary count, verification status (or `missing`), current/next/completed phases from disk, `checkbox_conflict[]` and a `scope` field; `roadmap annotate-dependencies <N>` adds wave headers and a cross-cutting-constraints block and is idempotent.
- Acceptance: fixture test: a checked ROADMAP box with no passing VERIFICATION appears in `checkbox_conflict`; a second annotate run changes no bytes.
- Source: UPS-31, UPS-70, UPS-75.
- Scope: v1

### GSDC-09 REQUIREMENTS grammar and requirement marks
- Requirement: REQUIREMENTS parses both the table `| ID | Spec | Rule | Phase | Status |` and the bullet form `- [ ] **ID**: text`; IDs are free-form strings, valid when they match `gsd.requirement_id_regex` (default `^[A-Z][A-Z0-9]*-\d+$`); `requirements mark-complete <ids>` (comma, space or `[..]` list) and `requirements revert <phase>` update the status cells and traceability rows; an unknown ID is reported, never invented.
- Acceptance: fixture test: table and bullet forms of the same requirements parse to identical maps; with an adapter regex `^[a-z]+:R\d+$` such IDs validate; `mark-complete X-99` (absent) exits 1 naming it.
- Source: GSP-16, UPS-75, D-69.
- Scope: v1

### GSDC-10 STATE.md format and `gsd state`
- Requirement: STATE.md has frontmatter `gsd_state_version, status, milestone, active_phase, progress{total_phases, completed_phases, total_plans, completed_plans, percent}, last_updated, state_head` derived from disk on every write, and body sections Project Reference, Current Position, Decisions (owner, dated, verbatim), Models, Owner rules, Overrides, Wave log, and one replaced Current state block; `ph gsd state position|planned-phase|wave|decision|override|session-note` are the only writers; each write takes `STATE.md.lock` (exclusive create, stale after 10 s) and returns `updated[]` naming the fields whose persisted value changed.
- Acceptance: fixture test: after writing plans and summaries, frontmatter counts equal disk counts; `state decision --text-file f` appends a dated verbatim entry; two concurrent writes both land; a session note replaces the Current state block instead of appending.
- Source: GSP-72, UPS-68, UPS-69, HIS-49, HIS-69, HIS-70, D-72, INV-48.
- Scope: v1

### GSDC-11 STATE status vocabulary
- Requirement: STATE `status` takes only the exact lifecycle words (`Ready to plan`, `Planning`, `Ready to execute`, `In progress`, `Verifying`, `Phase complete`, `All phases complete`); completing the last phase writes `All phases complete`, never a milestone-complete word; any other value fails `ph gsd health` with a coded diagnostic.
- Acceptance: fixture test completing the last phase of a two-phase roadmap reads `All phases complete`; a hand-written `status: done` is reported by `health`.
- Source: UPS-68, D-93.
- Scope: v1

### GSDC-12 Single writer of shared planning files
- Requirement: one write function guards every `ph gsd` mutation of PROJECT, STATE, ROADMAP or REQUIREMENTS (`state *`, `roadmap annotate-dependencies`, `requirements *`, `phase add|insert|remove|complete`, `health --repair`, roadmapper draft install, any other verb that resolves to those paths): it refuses with exit 1 `single writer: orchestrator only` when `PASEO_HARNESS_ROLE=worker`, takes the STATE lock and re-derives STATE frontmatter; `write` (GSDC-31) cannot reach those files; the generated agents keep their upstream bodies (which may mention such writes) and the kit overlay of every GSD role, applied after the body, states that the orchestrator is the single writer and the role must not write them (D-111).
- Acceptance: fixture test runs each mutator, including `health --repair` and `phase complete`, with `PASEO_HARNESS_ROLE=worker` (exit 1, files byte-identical); `write .planning STATE` and `write .planning/phases/../ STATE` are refused; kit test asserts each generated GSD agent has the single-writer overlay after its body and that the upstream body is unchanged.
- Source: GSP-72, HIS-49, UPS-69, INV-38, D-111.
- Scope: v1

### GSDC-13 Phase status ladder
- Requirement: one function `phaseStatus(phase)` computes, first matching row wins: (1) `COMPLETE` = completion record `<phaseDir>/complete.json` (written only by `phase complete`, holding the verification sha) exists and the current VERIFICATION is `passed`, not stale, with that sha; (2) `NOT_STARTED` = no live PLAN; (3) `IN_PROGRESS` = 0 < live summaries < live plans, or any plan halt record `<phaseDir>/<NN>-<MM>-HALT.json` (written by the execute orchestrator when a plan ends `needs-owner` or `failed`, removed when the plan is redispatched) exists; (4) `PLANNED` = live plans > 0 and summaries = 0; (5) with summaries = plans: `NEEDS_REVIEW` when VERIFICATION is `stale`, `gaps_found` or `human_needed`, `EXECUTED` when it is missing, invalid or `passed` without a completion record (next action: complete); every display, router, `roadmap analyze`, the UI panel and `find-phase` use this function; a ROADMAP checkbox never changes it; `find-phase` returns `plan_count`, `summary_count`, `plan_count_all` as `null` (never 0) when the phase cannot be resolved.
- Acceptance: fixture truth-table test, one phase per row: no plans; plans without summaries; partial summaries; a halt record with all other plans summarised; all summaries with missing, invalid, stale, gaps_found, human_needed, passed-without-record and passed-with-record reports; each yields the expected status through `find-phase`, `roadmap analyze` and the progress router; `find-phase 9` on a 3-phase roadmap returns null counts.
- Source: UPS-70, INV-43, INV-36.
- Scope: v1

### GSDC-14 Scope tri-state and withheld percentages
- Requirement: `roadmap analyze`, `progress` and phase listings return `scope` `complete|truncated|unscoped|unreadable`; when scope is not `complete`, every percentage is `null` and `state` writes no progress percentage (stderr warning).
- Acceptance: fixture ROADMAP whose phase list cannot be fully read yields `scope: truncated` and `progress_percent: null`.
- Source: UPS-71, INV-36.
- Scope: v1

### GSDC-15 Phase add, insert, remove, complete
- Requirement: `phase add` appends the next integer phase; `phase insert <after>` creates the next decimal phase marked `(INSERTED)`; `phase remove <N>` deletes only an unstarted future phase and renumbers later ones; `phase complete <N>` requires `verification status` `passed`, marks the ROADMAP checkbox with the date and progress row, marks the phase's requirements complete, advances STATE, and reports SUMMARY file claims that do not exist as advisory `warnings[]` (never blocking).
- Acceptance: fixture tests: insert after 2 creates `02.1-*` and a ROADMAP entry; remove of a phase with a PLAN exits 1; complete with `gaps_found` exits 1 and changes nothing; complete with `passed` updates ROADMAP, REQUIREMENTS and STATE in one call.
- Source: UPS-51, UPS-63, UPS-66, INV-43.
- Scope: v1

### GSDC-16 `phase uat-passed` predicate
- Requirement: `phase uat-passed <N> [--require-verification|--uat-only]` returns `{passed, uat_files, verification_files, checks, blockers}` and exits 0 only when no UAT test is pending, issue, skipped or blocked (and, with `--require-verification`, VERIFICATION is `passed`); otherwise exit 1 with named blockers.
- Acceptance: fixture UAT with 0 pass, 0 issue, 3 blocked exits 1 naming the three tests.
- Source: UPS-55, UPS-54.
- Scope: v1

### GSDC-17 `init.<workflow>` payloads
- Requirement: `init.plan-phase|phase-op|execute-phase|verify <phase>` return one JSON of paths and flags (never file contents): phase found, padded id, name, slug, dir, requirement ids, goal, context/research/wiring/verification paths, plan list and counts, `has_discuss_checkpoint`, and the `gsd` settings in force; a phase absent from ROADMAP exits 69 `phase not found`.
- Acceptance: fixture test snapshots each payload; a payload never contains a PLAN body; `init.plan-phase 7` on a 3-phase roadmap exits 69.
- Source: GSP-37, UPS-18, UPS-40, UPS-02.
- Scope: v1

### GSDC-18 `verify plan-structure`
- Requirement: the verb reports errors (frontmatter parse failure; missing `phase, plan, type, wave, depends_on, files_modified, autonomous, requirements, must_haves`; no `<task>`; no task with an `<automated>` obligation; task without `<name>`; `auto|tracer` task without `<action>`; checkpoint task shapes; checkpoint task with `autonomous` not false; truncation: write-continue sentinel, unclosed `<tasks>`, file ending inside a tag) and warnings (missing `<verify>/<done>/<files>`, unknown task type, wave > 1 with empty `depends_on`, one-way reversibility without an earlier `checkpoint:decision`), then calls the adapter's ownership and vocabulary hooks (ADPT-04, ADPT-03); output `{valid, errors, warnings, task_count, tasks, frontmatter_fields}`, exit 1 when invalid.
- Acceptance: ten fixture plans, one per error or warning class, produce the exact message and `valid` value; a plan cut mid-tag reports `Truncated: file ends inside a tag`.
- Source: GSP-17, UPS-76, HIS-48, D-61.
- Scope: v1

### GSDC-19 `check verify-command-paths` probe protocol
- Requirement: for each task `<automated>` the probe returns `{plan, task, command, kind, status, severity, detail, target}`; the kit core classifies only the `MISSING...` sentinel and `build`; every other kind is resolved by the adapter resolver named in `adapter.verify_vocabulary` (ADPT-03); statuses `ok`, `pending_creation` (target created by this plan), `pending_shared` (target created by a plan's `<shared_changes>`), `unresolvable` (warning), `missing` (blocker); an unregistered kind is a blocker; no plans exits 69.
- Acceptance: fixture adapter with kind `cmd` and a resolver script: a missing target created by the plan's own files is `pending_creation`; one created only in `<shared_changes>` is `pending_shared` severity none; kind `foo` not registered yields a blocker.
- Source: GSP-18, GSP-19, HIS-84, D-71, D-61.
- Scope: v1

### GSDC-20 `check verify-failure-directions`
- Requirement: every non-sentinel `<automated>` must be followed immediately by `<fails_when>`; missing or a placeholder (`tbd, todo, n/a, none, unknown, ?, -`) is a blocker; a bare restatement (`fails`, `failure`, `error`) is a warning.
- Acceptance: fixture plan with `<fails_when>fails</fails_when>` yields severity warning `restatement`; one without `<fails_when>` yields a blocker.
- Source: GSP-20, UPS-25.
- Scope: v1

### GSDC-21 Decision coverage
- Requirement: decisions are parsed from CONTEXT `<decisions>` bullets `- **D-NN:** text` (also `D-NN [tags]`); "Claude's Discretion" and tags `informational`, `folded`, `deferred` are non-trackable; an unparseable `**D..` bullet fails with the expected form; a decision is covered when its id appears word-bounded in a plan's objective, tasks, `must_haves` or `truths`; `check decision-coverage-verify` reports the same but always exits 0.
- Acceptance: fixture CONTEXT with D-01..D-03 (D-03 `[informational]`) and plans citing only D-01 reports `uncovered: [D-02]` with id, category and text.
- Source: GSP-21, UPS-16, UPS-30.
- Scope: v1

### GSDC-22 `check coverage` gate
- Requirement: `check coverage <phase>` passes only when the phase has a ROADMAP entry, every ROADMAP requirement ID of the phase is in some plan's `requirements`, and decision coverage passes; output `{passed, requirements{total, covered, uncovered, extra, roadmapEntry}, decisions}`; `extra` IDs are reported, not blocking; exit 1 when not passed.
- Acceptance: fixture test removing one requirement from every plan exits 1 with that ID in `uncovered`.
- Source: GSP-22, UPS-30.
- Scope: v1

### GSDC-23 `check owns` (disjoint write sets)
- Requirement: `check owns <phase> [--plans ids]` reports plans without `owns`, `owns` covering a shared path, `files_modified` outside `owns`, a shared file in `files_modified`, and overlapping `owns` or `files_modified` between plans of one wave; owns syntax, shared-file predicate and source roots come from `adapter.ownership` (ADPT-04); needed shared changes are declared in a plan's `<shared_changes>` block.
- Acceptance: fixture adapter with owns prefixes `Path:`: two wave-1 plans owning `Path:a/` and `Path:a/b.txt` report `overlapping owns`; a plan listing a shared-predicate path in `files_modified` reports it.
- Source: GSP-23, HIS-85, D-61, D-26.
- Scope: v1

### GSDC-24 Outline and manifest formats, `outline parse`
- Requirement: `<NN>-PLAN-OUTLINE.md` is a markdown table with columns matched by prefix (`Plan ID`, `Objective`, `Wave`, `Depends`, `Requirements`) and is complete when a line is exactly `## OUTLINE COMPLETE`; the sibling `<NN>-PLAN-OUTLINE.manifest.json` is `{phase, plans:[{id, owns[], requirements[], produces[{symbol, kind, header}], consumes[{plan, symbol}], tracer{is, outcome, scenario}, verify[]}]}`; `outline parse` returns `{exists, complete, rows, manifest, manifestError}` or exits 66 when the file is absent.
- Acceptance: fixture outlines with reordered columns and backticked ids parse; a file without the marker returns `complete:false`.
- Source: GSP-24, GSP-74.
- Scope: v1

### GSDC-25 `outline check`
- Requirement: `outline check <phase> [--tracer false]` errors on: no outline or marker, no rows, duplicate or malformed id (`<NN>-<MM>`), empty objective, dependency on an unknown plan or a same-or-later wave, ROADMAP requirement assigned to no row, manifest missing/unparseable/out of sync with rows, empty or invalid `owns`, shared path owned, `consumes` from an unknown or later-wave plan, overlapping `owns` in one wave, plan count or wave count above `gsd.plan_limits` (per-phase override from the plan args); with tracer mode: no manifest plan with `tracer.is`, a tracer plan outside wave 1, consuming anything, or lacking `tracer.outcome`; warnings: claimed id not on the ROADMAP line, manifest requirements differing from the row, consumed symbol not in the producer's `produces`, verify obligation outside the vocabulary, `tracer.scenario` of the form `none: <reason>`; output adds `crossPlan[]`, `needsWiring`, `waves`, `rows`.
- Acceptance: one fixture outline per error class yields its message; with `plan_limits {plans_per_phase: 20, waves_per_phase: 4}` an outline of 21 rows or 5 waves fails; `needsWiring` is true iff a `consumes` edge exists.
- Source: GSP-25, GSP-26, GSP-84, GSP-60, UPS-39, D-70.
- Scope: v1

### GSDC-26 `waves`
- Requirement: `waves <phase> [--plans ids]` groups plans by frontmatter `wave` (default 1) and errors on unknown `depends_on`, a dependency not in an earlier wave, and same-wave plans sharing a modified file or overlapping `owns`; with `--plans`, dependencies on plans outside the subset that exist on disk are allowed; exit 1 on errors.
- Acceptance: fixture gap subset depending on an already executed plan passes; two wave-2 plans modifying one file exit 1.
- Source: GSP-27.
- Scope: v1

### GSDC-27 `handoff` (executor-neutral wave contract)
- Requirement: `handoff <phase> [--plans ids] [--prefix p]` refuses (exit 1) when waves or ownership have errors or a tracer plan depends on or consumes anything; in `per-wave` mode the tracer plan(s) form execution wave 1 alone; it writes `<phaseDir>/handoff/[<prefix>-]w<k>.args.json` = `{wave, waveId, gsdPhase, planWave, planRevision, executionMode, tasks[]}` where each task carries `key`, `plan`, `planHash`, `summary` (granted path), `owns` (plan owns plus that SUMMARY path), `requirements`, `specs`, `verify[{task, kind, command, target}]`, `tracer`, `role`, `model`, `effort` (from `gsd.roles`, ADPT-11); it returns `{planRevision, waves[], sharedChanges[]}`.
- Acceptance: fixture with a tracer plan and two wave-1 siblings writes w1 (tracer only), w2 (siblings), w3 (next plan wave); a tracer depending on another plan exits 1; `executionMode: batch` keeps plan waves unsplit.
- Source: GSP-28, GSP-26, D-63, D-70, INGEST-CONFLICTS I-02.
- Scope: v1

### GSDC-28 Revision hashes (`revisions.json`)
- Requirement: `revisions record|check|hash|show <phaseDir> [key]` over keys `research` (CONTEXT, REQUIREMENTS, PROJECT, specs of the phase's requirements, `<canonical_refs>` files, `adapter.instructions` files, researcher role text), `inputs` (research + RESEARCH.md + research attempt), `freeze` (outline, manifest, WIRING, inputs), `plan:<id>`, `plans`, `checked`, `handoff`; every key also hashes the phase's ROADMAP section; `revisions.json` stores each key's hash and file list once (no duplicated lists); `check` exits 0 same, 1 changed, 66 never recorded and reports `headChanged` without invalidating; writes are atomic.
- Acceptance: fixture: record `freeze`; editing CONTEXT makes `check freeze` exit 1; editing another phase's ROADMAP section keeps 0; editing this phase's section exits 1; a code-only commit keeps 0 with `headChanged:true`.
- Source: GSP-29, HIS-47, D-75, INV-39.
- Scope: v1

### GSDC-29 `supersede`
- Requirement: `supersede <phaseDir> --keep ids` (required) moves every PLAN and its SUMMARY not in the keep set to `<phaseDir>/superseded/` (suffix `.N` on collision), never deletes, and returns `{moved[]}`.
- Acceptance: fixture outline shrinking from 5 to 4 rows moves the fifth plan; `phase list-plans` no longer lists it.
- Source: GSP-30.
- Scope: v1

### GSDC-30 Attempt records
- Requirement: `attempt record|show <phaseDir> --kind gap|verify|research` stores one schema `{key, runId, inputDigest, before, done, result, at}` in `<phaseDir>/<kind>-attempt.json` (atomic); `key` = sha256(kind, inputDigest, runId) where `runId` is the `ph workflow` run id the host gives the script (kept by `--resume`, new for every fresh run; no UUID, clock or randomness in the script, D-67, D-87); `before` = the sha of the existing report (research, verify) or the plan list (gap) before dispatch; `done` = false until the readback accepted the result; `result` = the accepted report sha (research, verify) or the written plan ids and, for gap, `waveExecuted` (GSDF-30); a workflow records the attempt before dispatching its agent; a fresh run finding an unfinished attempt with another `runId` marks it `abandoned` and never adopts its output; `show` exits 66 when none.
- Acceptance: fixture: a fake verifier killed after writing the report, then `ph workflow --resume <runId>` accepts the report without a second agent call; the same kill followed by a fresh run (new runId, identical inputs) marks the old attempt abandoned, dispatches a new agent and rejects the old report because its sha equals `before` of the new attempt.
- Source: GSP-31, HIS-48, D-67, D-87, INV-35.
- Scope: v1

### GSDC-31 `write` and `hash`
- Requirement: `write <phaseDir> <NAME>` (NAME `^[A-Z][A-Z-]*$`) atomically writes stdin to `<phaseDir>/<NN>-<NAME>.md`, where `<phaseDir>` must resolve (after `..` and symlink resolution) to an existing `.planning/phases/<NN>-<slug>` directory; `hash` prints `{hash}`, the sha256 of stdin after CRLF to LF.
- Acceptance: fixture: `write <phase> OUTLINE-REVIEW` creates the file; NAME `foo` exits 1; `write .planning STATE` and a phaseDir escaping through `..` exit 1 and write nothing; `hash` of CRLF and LF text is equal.
- Source: GSP-32.
- Scope: v1

### GSDC-32 `research status`
- Requirement: reads `<NN>-RESEARCH.md`: exit 66 missing; exit 1 `invalid` when frontmatter fails, `status` is not `complete|blocked`, `input_digest` or `attempt_key` is not 64 hex, a write-continue sentinel is present, a complete report lacks the final line `<!-- gsd:research-complete <attempt_key> -->`, the upstream required sections, provenance tags, `<user_constraints>` (when CONTEXT exists) or a phase requirement in `<phase_requirements>`, or a blocked report lacks `<research_blockers>`; exit 1 `stale` when `input_digest` differs from `revisions hash research`; exit 1 `blocked|incomplete` when the current attempt on the same inputs blocked or did not finish; else exit 0.
- Acceptance: fixture reports: truncated before the marker is invalid; CONTEXT edited after research is stale; an older complete report under a newer blocked attempt is `blocked`.
- Source: GSP-33, D-67, INV-35.
- Scope: v1

### GSDC-33 `research prompt`
- Requirement: renders the vendored upstream research dispatch fragment with phase values only (number, name, description, requirement ids, phase dir, context/requirements/state paths; lines whose optional path is absent dropped) and returns `{prompt, inputDigest, path}`.
- Acceptance: fixture without CONTEXT renders no `context_path` line; the fragment text outside placeholders equals the vendored file.
- Source: GSP-34, D-62.
- Scope: v1

### GSDC-34 Verification fingerprint and `verification status`
- Requirement: `verification fingerprint <phaseDir> <files...>` returns `covered_files` (given files + all plans + all summaries, sorted) and `covered_digest` with the kit's own prefix, exit 69 when a covered file is missing; `verification status` reads `<NN>-VERIFICATION.md` (66 none), exits 1 `invalid` unless `status` is exactly `passed|gaps_found|human_needed` (no case folding), `passed` has no gaps, human items or `behavior_unverified`, `gaps_found` has gaps, `human_needed` has human items or `behavior_unverified`, and the fingerprint fields exist; a valid report whose recomputed digest differs, or cannot be recomputed, returns `status: stale` with exit 0; output `{status, written_status, score, gaps, human_verification, behavior_unverified, path, sha, stale}`.
- Acceptance: fixture `passed` report with a gap is invalid; `status: Passed` is invalid; editing a covered source file yields `stale`.
- Source: GSP-35, GSP-65, UPS-72, INV-43.
- Scope: v1

### GSDC-35 `verify artifacts` and `verify key-links`
- Requirement: `verify artifacts` checks `must_haves.artifacts[{path, provides, min_lines, contains, exports}]` (path inside the code root, exists, not a directory, line count, substrings; 66 when none); `verify key-links` checks `must_haves.key_links[{from, to, via, pattern}]`: a source missing but promised by a same-or-later-wave plan is `pending`; a pattern over 500 chars or with lookaround or backreferences is `pattern_neutralized` (not verified); paths outside the root are `path_rejected`.
- Acceptance: fixture `from: ../outside` reports `path_rejected`; a lookahead pattern reports `pattern_neutralized`.
- Source: GSP-36, UPS-73.
- Scope: v1

### GSDC-36 `phase-plan-index`
- Requirement: returns plans with `wave, depends_on, files_modified, has_summary, halted, blocked_by, ready, gap_closure`, plus `waves`, `incomplete`, `runnable` and warnings naming any unresolved `depends_on` token; `halted` = a halt record exists (GSDC-13); `blocked_by` = depends_on plans that are halted or have no SUMMARY; `ready` = no SUMMARY, not halted, `blocked_by` empty.
- Acceptance: fixture with three plans, one with a halt record and two dependents, reports the dependents `blocked_by` the halted plan and `runnable: []`; removing the halt record makes the halted plan runnable.
- Source: UPS-42.
- Scope: v1

### GSDC-37 Read verbs
- Requirement: `frontmatter get <file> [key]`, `frontmatter validate --schema plan|plan-gap-closure|summary|verification`, `phase list-plans`, `phase list-artifacts [--type]` (66 when none), `summary-extract <globs> --fields`, `history-digest` and `state load` read files and never write.
- Acceptance: fixture test asserts byte-identical `.planning/` before and after each verb; `validate --schema plan-gap-closure` fails a plan without `gap_closure: true`.
- Source: GSP-37, UPS-66.
- Scope: v1

### GSDC-38 `commit`
- Requirement: `commit <msg> --files <paths...>` (required) stages only the named files and commits them; `--files-removed` stages declared deletions; the result is `{committed, hash}` or the skip envelope `{committed:false, skipped:true, hash:null, reason}` with `reason` in `skipped_commit_docs_false|skipped_gitignored` and exit 0; the message reaches git as an argument, never through shell interpolation.
- Acceptance: fixture repo: `commit_docs:false` returns the skip envelope; a message containing `"; rm -rf x` is committed verbatim; an unrelated dirty file stays unstaged.
- Source: UPS-81, GSP-58, D-77.
- Scope: v1

### GSDC-39 `check evaluation-scope`
- Requirement: `check evaluation-scope (--phase P [--since sha] | --plan NN-MM | --quick id) [--commits-only] [--max-commits N]` returns `{status resolved|degraded|unresolvable, source, commits, files, outsideUnion, unreachable}`: scope is the union of the unit's own commits (subject scope `type(<phase>-<plan>)` or `type(<phase>-w<k>)` matched exactly, zero-pad and decimal tolerant, `03-01` never matching `03-010`), reachable from HEAD only; a wave commit belongs to a plan through the commit map `<phaseDir>/commits.json` (GSDF-53), and for a plan scope only that plan's mapped files of the wave commit count; an empty phase union degrades to the phase-directory range and says so; a plan with no match is `resolved` with `reason: no-matching-commits`; an unreadable repo or a git timeout is `unresolvable` (exit 69).
- Acceptance: fixture repo with an unrelated commit between two phase commits excludes it; `--plan 03-01` does not match a `03-010` commit; with the default per-wave policy and decimal phase `02.1`, `--plan 02.1-02` resolves the `feat(02.1-w1)` commit and lists only plan 02's mapped files.
- Source: UPS-74, UPS-41, GSDF-53.
- Scope: v1

### GSDC-40 `select-revert-commits`
- Requirement: `select-revert-commits (--phase P | --plan NN-MM) --range R` returns the commits whose declared conventional-commit scope matches exactly (phase mode also accepts `NN-MM` and `NN-w<k>` scopes of that phase), newest first; in plan mode a wave commit mapped (commits.json) to that plan and to sibling plans is returned with `shared: true` and the sibling plan ids, never silently as the plan's own commit.
- Acceptance: fixture repo: `--plan 03-02` excludes `03-020`-scoped commits; with one `feat(03-w1)` commit for plans 03-01 and 03-02, `--plan 03-02` returns it with `shared: true, siblings: [03-01]`.
- Source: UPS-94, UPS-66.
- Scope: v1

### GSDC-41 `run-with-timeout` and `normalize-test-command`
- Requirement: `run-with-timeout <secs> -- <argv...>` runs the command with a process-tree kill at the deadline, passes its output through, then prints `{code, timedOut, durationS}` as the last line and exits 124 on timeout, else the child's code; `normalize-test-command <cmd>` prints `{command}` with known watch-mode test runners rewritten to their one-shot form and other commands unchanged.
- Acceptance: fixture: a sleeping child under `run-with-timeout 1` exits 124 with `timedOut:true` and leaves no child process; `vitest` normalizes to `{"command":"vitest run"}`.
- Source: UPS-47, UPS-66, D-95.
- Scope: v1

### GSDC-42 `health` of `.planning/`
- Requirement: `ph gsd health [--repair]` reports coded diagnostics `{code, message, fix, repairable}` for: phase numbering gaps, ROADMAP phase without directory and directory without ROADMAP entry, orphan SUMMARY, plan without `wave`, invalid VERIFICATION status, invalid STATE status, STATE frontmatter disagreeing with disk; `--repair` only rewrites STATE frontmatter from disk.
- Acceptance: fixture ROADMAP phase without a directory yields its code; `--repair` fixes stale STATE counts and touches no other file.
- Source: UPS-83, UPS-63.
- Scope: v1

### GSDC-43 Debug session verbs
- Requirement: `ph gsd debug create|status|list|close` manage `.planning/debug/`: `create` (JSON on stdin: signature `{kind, key, label}`, symptoms, owns, files, goal `find_and_fix|find_root_cause_only`) derives the slug (`^[a-z0-9][a-z0-9-]{0,29}$`, collisions `-2`, `-3`), stores `signature_id = sha256(kind, key)` and the Symptoms hash in the session frontmatter, and builds the session from the vendored upstream DEBUG template; a known unresolved signature reuses its session and appends an Evidence entry; a resolved one moves back from `resolved/` with an Evidence entry carrying the earlier root cause and fix; `status` exits 1 when frontmatter fails, `status` is outside the upstream set, `## Current Focus` or `## Symptoms` is missing, `next_action` is vague, or Symptoms changed since create; `list` excludes `knowledge-base.md` and `resolved/`, exit 66 when none; `close --outcome resolved|diagnosed` moves a resolved session to `resolved/<slug>.md` and appends one knowledge-base entry (`## <slug> — <one line>`, Error patterns, Root cause, Fix, Files changed, Why not caught, Recurrence guard); `diagnosed` stays active; untrusted text the verbs write into the session (owner answers, checkpoint questions) is wrapped in DATA_START/DATA_END and indented 4 spaces.
- Acceptance: fixture: label `Login Fails S30!!` gives `login-fails-s30`; the same signature twice returns the same slug with `reused:true`; `next_action: continue investigating` fails `status`; close resolved then create again reopens with the earlier fix in Evidence and the KB keeps both entries; a checkpoint question containing `## X` still parses all sections.
- Source: GDB-07..12, GDB-32, GDB-58, D-78, D-82.
- Scope: v1

### GSDC-44 Upstream snapshot (vendoring)
- Requirement: `.agents/gsd/upstream/` holds a trimmed snapshot of open-gsd/gsd-core at the commit named in one pin data file `UPSTREAM.json` `{repo, branch, commit, date, license, files{path: sha256 of LF text}}`; the snapshot holds only files reachable from generated agents and skills; `gsd upstream vendor --from <clone>` refuses a clone whose HEAD differs from the pin (message names both hashes), a symlink or a missing entry, and reads HEAD from `.git/HEAD`, loose refs and `packed-refs` without running git in the clone.
- Acceptance: fixture clones: wrong commit exits 1 naming both hashes; a symlink exits 1; a clone with a git hook and an `fsmonitor` config is vendored without either running (marker file absent); every UPSTREAM.json hash equals the file's LF sha256.
- Source: GSP-01, GSP-02, UPS-87, HIS-43, D-62, INV-40.
- Scope: v1

### GSDC-45 Generated agents and skill texts
- Requirement: `gsd upstream build` writes each generated GSD agent (`gsd-planner`, `gsd-plan-checker`, `gsd-phase-researcher`, `gsd-executor`, `gsd-verifier`, `gsd-debugger`, `gsd-codebase-mapper`, `gsd-project-researcher`, `gsd-research-synthesizer`, `gsd-roadmapper`, `gsd-code-reviewer`, `gsd-code-fixer`) as kit front matter (`name, description, model` tier fallback, advisory `tools`, `include`) + a `<!-- GENERATED -->` line + a `<kit_adapter_precedence>` block (adapter wins on conflict, method unchanged) + the upstream body with only three path rewrites (`~/.claude/gsd-core/` and `@~/.claude/gsd-core/`, `@gsd-core/`, bare `gsd-core/(references|templates|workflows|contexts)/` not preceded by a word char, `.`, `/`, `@`, `~` or `-`) to the vendored path; the method workflow texts listed in the inventory (GSDC-53) are generated the same way; before its first output write the build validates the snapshot strictly (UPSTREAM.json commit equals the pin, every listed file present with matching LF sha256, no unlisted file under the snapshot) and on any problem exits 1 naming it with no generated file written or changed; the build is idempotent.
- Acceptance: fixture: two builds produce identical bytes; a changed byte, a missing file, an extra file and a pin mismatch each make the build exit 1 and leave every generated file byte-identical; each generated body equals rewrite(upstream body) byte for byte; `foo/gsd-core/references/x` stays unchanged.
- Source: GSP-03, GSP-04, GSP-07, GSP-08, GSP-59, GDB-45, UPS-64, D-62, D-111.
- Scope: v1

### GSDC-46 Verbatim contract blocks by anchor
- Requirement: the build extracts verbatim the executor's `<deviation_rules>`, `<analysis_paralysis_guard>`, `<summary_creation>` blocks, the plan-phase step 8 contracts (`<tracked_source_paths>`, `<failing_direction_contract>`, `<downstream_consumer>`, `<deep_work_rules>`, `<quality_gate>`), the step 12 revision `<instructions>`, and the debug session manager's Step 2 and Step 3d prompt blocks; a missing anchor or placeholder fails the build naming it.
- Acceptance: fixture snapshot without `<deep_work_rules>` makes the build exit 1 with `missing anchor <deep_work_rules>`.
- Source: GSP-05, GSP-06, GDB-22, D-62.
- Scope: v1

### GSDC-47 `gsd upstream check`
- Requirement: `check` exits 1 when the snapshot differs from UPSTREAM.json (edited, missing or extra file), a generated file is missing, stale or hand-edited (LF-normalised compare with a fresh build), a file referenced directly by a generated file is absent from the snapshot (depth 1 problem, depth 2-3 warning with `--verbose`), or a `gsd_run <verb>` in generated text or its direct references is not in the verb table (GSDC-04); it prints `check: N problems, M warnings; K references followed, V verbs mapped`; it runs in the kit test suite and in `ph doctor`.
- Acceptance: fixture edits (one byte in a snapshot file, a hand edit in a generated agent, an added `gsd_run foo.bar` in a reference) each make check exit 1 naming the cause; a CRLF checkout passes.
- Source: GSP-08, GSP-09, GDB-54, HIS-43, INV-40.
- Scope: v1

### GSDC-48 `gsd upstream bump`
- Requirement: `gsd upstream bump --from <clone> --commit <sha>` updates the pin, vendors, builds and checks in one run, prints the diff stat of the snapshot and generated files, and exits 1 (pin left changed for review) until check passes; no network fetch.
- Acceptance: fixture "v2" snapshot adding an unmapped verb: bump exits 1 naming the verb; after the verb row is added, bump exits 0.
- Source: GSP-10, D-62, R-11.
- Scope: v1

### GSDC-49 Licence notice and departures list
- Requirement: the kit ships the upstream MIT licence and a NOTICE naming repo and commit and listing every adapter-layer departure from upstream (orchestrator-only commits, markers instead of in-agent questions, single writer, verify obligations run by the post-wave gate, gap closure capped at one wave, disjoint `owns` when the adapter uses a shared tree, research provider/cache and package audit not installed, unported verbs and modes); each departure row names the requirement that enforces it.
- Acceptance: kit test asserts the licence equals the vendored `LICENSE` and every NOTICE departure row cites an existing requirement ID of this file.
- Source: GSP-78, HIS-42, HIS-86, D-62, D-111.
- Scope: v1

### GSDC-50 Vanilla GSD core
- Requirement: kit-authored GSD files (core code, workflow scripts, kit agents, kit overlays, kit skill wrappers) contain no Backlog code path and no project-, engine- or game-specific vocabulary, path rule, verify kind or agent; project specifics reach the core only through adapter hooks (ADPT-15); the scan excludes the vendored snapshot and generated upstream bodies (protected by D-111 and GSDC-47) and the verb table's not-ported declarations.
- Acceptance: kit test greps kit-authored GSD files (the inventory's kit-authored entries, GSDC-53) for a deny list (`backlog`, project and engine names recorded in the test) and finds none, while the verb table may declare `todo.match-phase` unavailable; the GSD fixture suite passes with two different fixture adapters.
- Source: GSP-77, D-110, D-61, P9.
- Scope: v1

### GSDC-53 Method text inventory
- Requirement: `.agents/gsd/inventory.json` lists every installed GSD method file with `{installed path, kind agent|skill-workflow|template|reference, source path in the snapshot or "kit-authored", transformations (path rewrite, anchor extraction), overlay path}`; it covers the agents of GSDC-45, the method workflow texts the GSD skills carry (map-codebase, new-project, discuss-phase, plan-phase contracts, execute-plan, verify-work, quick, progress, next, pause-work, resume-project, transition, undo, health, forensics, debug session manager), the templates used by GSD verbs, and marks kit-authored wrappers and plumbing (workflow scripts, standalone research skill, overlays); `gsd upstream build` and `check` (GSDC-47) use it for reachability, equality and dangling-reference checks; an overlay change never requires editing upstream text.
- Acceptance: kit test: a one-line alteration in the generated text of each skill-workflow family makes `check` fail naming the file; editing an overlay passes `check` with the upstream-derived text byte-identical; an installed GSD method file absent from the inventory fails the test.
- Source: D-62, D-111, UPS-87, GSP-07.
- Scope: v1

## M10 gsd-flows (GSDF)

Skills live in `.claude/skills/gsd-*`, workflow scripts in `.agents/workflows/gsd-*.js`, agents in `.agents/agents/`. Interactive stages (discuss, UAT, owner questions) run in the main session; every worker is a `ph` agent (D-06). Where upstream has a method text for a flow, the skill carries it generated and unchanged (inventory GSDC-53, build GSDC-45); the workflow scripts and `ph gsd` are kit plumbing (D-62); the kit adds only the adapter overlay named per requirement, applied after the upstream text and winning on conflict (D-111).

### GSDF-01 Orchestration contract for GSD workers
- Requirement: GSD flows start workers only through `ph` (spawn, fanout or `ph workflow`), never native Agent, Task or Workflow; prompts pass file paths, not contents; a worker's result is a marker in a JSON schema; workers never ask the owner; owner-needing markers become a run result `needs-owner {stage, reason, issues|conflict|question, options}`; a worker failure classed quota, credit, billing, auth or permission is never retried.
- Acceptance: fixture runs of the plan, research and verify scripts with a fake runner: no prompt embeds a PLAN body; a fake planner returning `## PHASE SPLIT RECOMMENDED` yields `status: needs-owner` with stage and options; a fake quota error yields `failed` after one call; a scan of kit-authored GSD files (inventory GSDC-53) finds no instruction to call native Agent, Task or Workflow, and every generated skill carrying upstream spawn instructions has the overlay mapping them to `ph` (upstream text left unchanged).
- Source: UPS-02, UPS-27, GSP-46, GSP-75, INV-13, INV-14, D-06.
- Scope: v1

### GSDF-02 Lifecycle and chaining
- Requirement: each phase runs discuss -> research -> plan (outline, skeleton review, per-plan planning, checker, optional plan review) -> execute in waves -> verify; `gsd-plan` chains plan -> execute -> verify and stops at the first `needs-owner` or `failed` result; `--plan-only` stops after the handoff; execute refuses a phase without handoff files; a phase is complete only through GSDC-15.
- Acceptance: fixture chain with a fake planner returning an open skeleton blocker never starts execute; `--plan-only` leaves no execute run directory; execute on a phase without `handoff/` exits 1.
- Source: UPS-01, HIS-44, GSP-71.
- Scope: v1

### GSDF-03 Workflow plumbing for GSD scripts
- Requirement: GSD workflow scripts call `ph gsd` verbs through one helper that parses the last stdout line as JSON and returns `{code, json, stderr}`; every agent prompt ends with `Input digest (<key>): <revisions hash>` so a resumed run never reuses an answer for changed inputs; only validated values (phase dir regex `^\.planning/phases/\d+(\.\d+)?-[a-z0-9-]+$`, slugs, ids) reach a command line, JSON goes on stdin; scripts read no clock and no randomness; long-running planner and checker agents are supervised by the M6 watchdog, never by host wake or sleep tools.
- Acceptance: fixture: changing CONTEXT between two runs with the same args changes the planner prompt and misses the cache; a phase dir containing `&` is refused before any shell call; a static scan of `.agents/workflows/gsd-*.js` finds no `Date`, `Math.random` or `ScheduleWakeup`.
- Source: GSP-39, UPS-32, INV-22, D-87.
- Scope: v1

### GSDF-04 Shipped GSD agent roster
- Requirement: the kit ships in `.agents/agents/` the generated GSD agents (GSDC-45) and the kit-authored generic agents `gsd-skeleton-reviewer` (read-only, lens-driven) and `finding-verifier` (read-only, confirmed/refuted/uncertain by tracing the trigger); no stack-specific, project or interface-architect agent ships; front matter keys are `name, description, tools` (advisory), `model` (tier), `include`.
- Acceptance: kit test lists `ship/.agents/agents/` and compares with the roster; every file's front matter parses with exactly the allowed keys; no file name or text matches the vanilla deny list (GSDC-50).
- Source: GSP-69, UPS-64, D-109, D-110, INGEST-CONFLICTS W-02, W-22.
- Scope: v1

### GSDF-05 map-codebase
- Requirement: `gsd-map-codebase` runs 4 parallel `gsd-codebase-mapper` workers (tech, arch, quality, concerns) that write 7 docs to `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS) and return only confirmations; an existing map offers refresh, update (pick docs) or skip; `--paths p1,p2` remaps incrementally and rejects `..`, leading `/` and shell metacharacters; the orchestrator verifies 7 docs of at least 20 lines and runs a secrets scan (key prefixes, private keys, JWT) that pauses before any commit.
- Acceptance: fixture with fake mappers: 7 docs present; `--paths "../x;rm"` is rejected; a doc containing an `AKIA...` key pauses with the finding and commits nothing.
- Source: UPS-11, D-109.
- Scope: v1

### GSDF-06 Map stamp and drift gate
- Requirement: a shell step (not the mapper) writes `last_mapped_commit` and `last_mapped_at` into each codebase doc's frontmatter; a warn-only drift check counts new directories outside mapped territory and changed files inside mapped dirs since `last_mapped_commit` and warns at plan start above `gsd.drift_threshold` (default 3); no baseline reports `skipped`, never drift; an internal failure reports `skipped`.
- Acceptance: fixture repo with a stamped map and 3 new directories warns; an unstamped map reports `skipped`; the gate never blocks planning.
- Source: UPS-12.
- Scope: v1

### GSDF-07 new-project
- Requirement: `gsd-new-project` (main session) runs the upstream questioning flow, writes PROJECT.md (What, Core Value, Requirements Validated/Active/Out of Scope, Key Decisions, evolution footer), asks workflow preferences and writes them into the `gsd` section of `.agents/harness.config.json` (granularity, toggles), optionally runs 4 project researchers plus a synthesizer, writes REQUIREMENTS by category with v1/v2/out of scope, runs `gsd-roadmapper` under the draft contract of GSDF-95 (every v1 requirement mapped to exactly one phase, 2-5 success criteria per phase), loops on owner approval (approve, adjust, review), then the orchestrator installs ROADMAP and the REQUIREMENTS traceability and initialises STATE through the single writer (GSDC-12); PROJECT.md and REQUIREMENTS are written by the main session itself.
- Acceptance: live smoke on a fixture repo produces the four files; fixture test with a fake roadmapper leaving one v1 ID unmapped blocks the install and names it.
- Source: UPS-07, UPS-06, UPS-10, D-77.
- Scope: v1

### GSDF-08 new-project resume and init guards
- Requirement: new-project decides by the initialization predicate (GSDC-01), never by `.planning/` existing: an empty `.planning/` starts from questioning; a partly initialized project resumes at the first missing artifact; an initialized project refuses with "use progress"; `git init` is never run inside an existing work tree.
- Acceptance: fixture of the prescribed flow from a fresh install (empty `.planning/`, then `.planning/codebase/` from map-codebase and an adapter from the harness) starts new-project at questioning; PROJECT.md only resumes at REQUIREMENTS; an initialized project refuses; running in a subfolder of a repo creates no nested `.git`.
- Source: UPS-08.
- Scope: v1

### GSDF-09 Research synthesizer self-heal
- Requirement: after the synthesizer returns, the orchestrator checks `.planning/research/SUMMARY.md` exists, is non-empty and has no write-continue sentinel; when it does not but the reply holds the full document (its upstream section markers), the orchestrator writes the file and logs a self-heal line; a brief confirmation without the file fails and the roadmapper is not started.
- Acceptance: fixture fake synthesizer returning the document inline without writing: SUMMARY.md exists afterwards and the log has the self-heal line; one returning "done" without a file fails.
- Source: UPS-09.
- Scope: v1

### GSDF-10 discuss
- Requirement: `gsd-discuss` runs the generated upstream discuss-phase text in the main session: resolves the phase against ROADMAP (stops if undefined), finds phase-specific gray areas, asks numbered plain-text questions and waits (empty input is not approval), does not re-ask decisions of the last 3 CONTEXT files, routes scope creep to `<deferred>`, writes `<NN>-DISCUSS-CHECKPOINT.json` before the first question and after every answer, writes CONTEXT with `<domain>`, `<decisions>` (stable `D-NN`, new ids appended), `<canonical_refs>`, `<code_context>`, `<specifics>`, `<deferred>`, plus DISCUSSION-LOG (audit only, never agent input), removes the checkpoint, and updates STATE through `gsd state`; unported modes (`--power`, `--auto`, `--chain`, advisor, `--ws`, `--batch`, `--analyze`) are refused with a message. Adapter overlay: conversation in the owner's language, artifacts in English, no git step.
- Acceptance: live smoke: interrupted discussion leaves a checkpoint naming the pending question and `gsd-plan` then returns `needs-owner` stage Discuss; fixture CONTEXT produced by a scripted session parses with `check decision-coverage`.
- Source: GSP-70, UPS-15, UPS-16, UPS-17, HIS-86, D-111.
- Scope: v1

### GSDF-11 Blocking anti-pattern gate
- Requirement: before discuss and before execute, a `.continue-here.md` in the phase directory with "Critical Anti-Patterns" rows of severity `blocking` stops the flow until each row has three written answers (what it is, how it manifested, which structural mechanism prevents it); no file or no blocking row proceeds.
- Acceptance: fixture phase with one blocking row: execute returns `needs-owner` stage Execute naming the row; with three answers written it proceeds.
- Source: UPS-91, UPS-15.
- Scope: v1

### GSDF-12 research workflow
- Requirement: `gsd-research.js` (args `phaseDir`, `refresh`, `view`, `focus`) with `view` returns the report status without an agent; an unfinished Discuss returns `needs-owner`; a valid current report without `refresh` returns `reused` (with `headChanged`); otherwise it records the attempt (GSDC-30, keyed by the run id) before dispatch, runs one `gsd-phase-researcher` that writes only the RESEARCH.md path with `input_digest`, `attempt_key` and the terminal marker, then decides by `research status`: blocked records and returns `needs-owner`, a report whose key or digest is not this attempt's fails, a null agent result with a valid current report is accepted; success records the attempt done, `revisions record research`, and returns `researched`; a fresh run never inherits an unfinished attempt (even on identical inputs) while `--resume` of the same run continues it. Adapter overlay in the researcher's include: no build, test, install or commit; provenance tags kept; package audit not installed (never fabricate OK).
- Acceptance: fixture runs: two fresh refresh runs on identical inputs get different attempt keys; killing after the report write then `--resume` accepts it with no second agent, while a fresh run after the same kill dispatches a new researcher; a report carrying an old attempt key fails.
- Source: GSP-61, GSP-63, UPS-20, HIS-86, D-67, INV-35.
- Scope: v1

### GSDF-13 research skill routing
- Requirement: `gsd-research` supports `--view` (no agent), `--refresh` (fresh researcher, keeps still-valid findings, optional focus) and default (reuse valid current research; missing -> research now; invalid, blocked or stale -> report and offer refresh); standalone research never continues to planning; the main session summarizes findings and open questions and never turns an `[ASSUMED]` item into a locked decision.
- Acceptance: fixture `--view` with no report exits with an error and no agent call; live smoke: a default run on a phase with a stale report offers refresh instead of researching.
- Source: GSP-62, UPS-21.
- Scope: v1

### GSDF-14 Research input policy
- Requirement: every planner, checker, architect and reviewer prompt contains `<research_input_policy>` with either `Approved research: <path>. Read and use only this report.` or `Approved research: NONE. Do not read or use any RESEARCH.md on disk.`; approval is never inferred from file existence.
- Acceptance: fixture plan run with `skipResearch` and an old report on disk renders NONE in every role prompt.
- Source: GSP-42.
- Scope: v1

### GSDF-15 Plan workflow arguments
- Requirement: `gsd-plan.js` requires `phaseDir`; `mode` `plan` (default) or `gaps`; `tracer` default true; `reversibilityGates` default true; `maxSkeletonPasses` and `maxCheckIterations` default from `gsd` config (3) and only integers 1..3 (4 fails the run before any agent); `skeletonLanes` default `[{lens:fidelity},{lens:integration}]`, at least one lane with a non-empty lens; `wiring` `auto|always|never`; `replan`; `skipResearch` with `researchSkipReason`; `forceProceed {reason}`; `planReview` (default from `gsd`, off); per-run role overrides; returns `{status planned|needs-owner|failed|refused, reason, ...}`.
- Acceptance: fixture: `maxCheckIterations: 4` fails with reason and zero agents; `skeletonLanes: []` fails; defaults resolve from the overlay.
- Source: GSP-38, D-68, D-65, D-66.
- Scope: v1

### GSDF-16 Plan preconditions
- Requirement: an unfinished Discuss returns `needs-owner` stage Discuss; in plan mode research must be `complete` unless `skipResearch:true` with a non-empty `researchSkipReason` (then the report path is nulled and the skip logged), else `needs-owner` stage Research; in gaps mode research is used only if currently complete; missing ROADMAP requirement IDs only warn (the coverage gate stops later).
- Acceptance: fixture: stale research without skip -> `needs-owner`; skip with empty reason -> `needs-owner`; skip with reason -> proceeds with NONE policy.
- Source: GSP-41.
- Scope: v1

### GSDF-17 Planner prompts
- Requirement: planner prompts reproduce upstream step 8 `<planning_context>` (phase, mode, required reading: STATE, ROADMAP, REQUIREMENTS, CONTEXT as user decisions, approved research, phase requirement IDs, project instruction files and the stack skill from the adapter, `TRACER_MODE`, `REVERSIBILITY_GATES`, `MVP_MODE false`, `WALKING_SKELETON false`, granularity) and step 12 `<revision_context>` (existing plans, checker issues JSON, revision instructions, one `changes` entry per issue or REVISION_CONFLICT); with no SPEC edge or prohibition sections the prompt carries the specless block asking the planner to list edge cases into `must_haves.truths` and must-not items into `must_haves.prohibitions`, or a recorded skip reason, never neither; the standing contracts come from the planner's `include` (GSDC-46).
- Acceptance: fixture prompt snapshots for plan, revision and gap modes; the specless block or a skip reason is present in every plan-mode prompt.
- Source: GSP-44, GSP-45, UPS-25, UPS-39, UPS-88.
- Scope: v1

### GSDF-18 Planner sessions and role resolution
- Requirement: the outline, its revisions and phase-level revisions run in session `planner:outline`; each plan in `planner:<planId>`; gap plans in `planner:gaps`; reviewers, checker and verifier run fresh; every agent call passes its role name as `agent({role})` (FLOW-04) so model and effort resolve by D-16 precedence (ADPT-11, PHCL-22), skeleton lanes pass their per-lane `model`/`effort` as per-run overrides, and the run's `result.json` records the effective role table.
- Acceptance: fixture: with roles `outline` and `planner` set to different models, the outline call carries the first and plan calls the second; a resumed run adopts the cached session agent.
- Source: GSP-43, HIS-19, D-16.
- Scope: v1

### GSDF-19 Outline stage
- Requirement: the outline planner writes `<NN>-PLAN-OUTLINE.md` ending with `## OUTLINE COMPLETE` on disk and the manifest; the outline is reused only when it has the marker, `revisions check inputs` is unchanged and `replan` is off; a regeneration that returns nothing while an old outline exists fails the run (an old marker never acknowledges new inputs); `outline check` runs next with at most 2 mechanical fix turns in the same session, then fails; a passing outline logs warnings and records `revisions inputs`.
- Acceptance: fixture: fake planner returning null on regeneration after a CONTEXT edit -> `failed`; two failing fix turns -> `failed` listing the outline errors.
- Source: GSP-47.
- Scope: v1

### GSDF-20 Wiring-contract stage (adapter architect only)
- Requirement: the wiring stage runs only when `adapter.agents.architect` names an existing agent and (`wiring: always`, or not `never` and the outline check found cross-plan edges or a WIRING.md exists); the architect writes only `<NN>-WIRING.md` and returns `{status complete|conflict, sharedChanges, outlineChanges, conflicts}`; `conflict` -> `needs-owner`; a missing file -> `failed`; `outlineChanges` become blocker issues for the skeleton review; without an architect agent cross-plan edges are reviewed by the integration lane only and the stage is logged as skipped.
- Acceptance: fixture adapter with an architect: a `consumes` edge triggers it, no edge does not; fixture adapter without one: run proceeds and logs `wiring: no architect agent`.
- Source: GSP-48, HIS-60, D-109, INGEST-CONFLICTS W-22.
- Scope: v1

### GSDF-21 Skeleton review, pass 1
- Requirement: lanes get ids L1..Ln and run `gsd-skeleton-reviewer` fresh, read-only, in parallel, with the lens, phase, goal, frozen snapshot file list, requirement IDs, tracer mode, mechanical warnings and cross-plan edges; issues use the checker format `{plan, dimension, severity, required_property, description, evidence, fix_hint, target outline|wiring|both}`; info issues become advisories; a lane returning nothing is retried once, then the run fails (the gate never passes unreviewed); generic lens texts (`fidelity`, `integration`) ship in the kit, further lenses come from config.
- Acceptance: fixture: one lane null twice -> `failed`; info-only issues pass with advisories.
- Source: GSP-49, GSP-51, HIS-45, D-68.
- Scope: v1

### GSDF-22 Skeleton review, passes 2..N
- Requirement: while open issues remain and the pass count is below `maxSkeletonPasses`: issues with target `outline`, `both`, or `wiring` when no wiring is in use go to `planner:outline` (then the mechanical check reruns, one fix turn); when wiring is in use (architect present, `wiring` not `never`), issues with target `wiring` or `both` go to the architect, and after any outline revision the architect also realigns WIRING.md with the revised outline even with no wiring issue (unless it wrote WIRING in this pass); when a revision introduces the first cross-plan edge, the architect (if present and `wiring` not `never`) writes WIRING now and a blocker asks the integration lane to review all of it; without an architect the new edges become blocker issues of the integration lane; architect `conflict` -> `needs-owner`; each lane then runs a resolution check on only its own open ids (resolved + evidence, no new issues, unanswered = unresolved); a pass whose open count is not lower than at its start -> `needs-owner` stalled; after the cap open blockers (unknown severity = blocker) -> `needs-owner`; only warnings -> pass, carried to the checker and to the matching planner prompt; REVISION_CONFLICT -> `needs-owner`; never proceed on an open blocker.
- Acceptance: scripted reviewers: pass 1 opens three ids, pass 2 resolves one (two open), pass 3 resolves one (one open): a remaining blocker ends `needs-owner`, a remaining warning ends passed with the warning carried; a 3 -> 2 -> 2 sequence ends `needs-owner` stalled at pass 3; an outline-only revision changing a consumed declaration triggers the architect realignment; a revision adding the first `consumes` edge writes WIRING and adds the integration blocker; neither case freezes before the integration lane resolved it.
- Source: GSP-50, HIS-45, INV-37.
- Scope: v1

### GSDF-23 OUTLINE-REVIEW.md and freeze
- Requirement: after the gate, in every outcome, the workflow writes `<NN>-OUTLINE-REVIEW.md` (status, lanes with models, per-pass open counts, Open and Resolved tables with evidence cut at 300 chars, Advisories, report JSON) through `gsd write`; only `passed` records `revisions freeze` (and commits per `gsd.commit_policy`); a matching `freeze` without `replan` skips the review.
- Acceptance: fixture rerun with unchanged inputs spawns no reviewer and logs `skeleton unchanged since its review passed`.
- Source: GSP-52.
- Scope: v1

### GSDF-24 Per-plan planning
- Requirement: after the freeze the workflow runs `supersede --keep <outline ids>`, then per outline wave in order keeps plans whose `revisions check plan:<id>` matches and whose structure passes, and runs single-plan planners in parallel for the rest (frozen manifest entry, `owns` repeated exactly, WIRING declarations quoted, open skeleton warnings for that plan); after the join it records `plan:<id>` serially in row order; a later wave starts only after the current wave is on disk.
- Acceptance: fixture: kill after wave 1 -> rerun keeps wave-1 plans and plans wave 2; an outline edit rewrites all plans.
- Source: GSP-53, UPS-26, INV-38.
- Scope: v1

### GSDF-25 Structure check with one fixer turn
- Requirement: after each plan write or revision `verify plan-structure` runs; on errors the same planner session gets the error list once to fix in place; still invalid -> `failed`.
- Acceptance: fixture malformed plan: the fixer prompt contains the exact error list; a second failure ends `failed`.
- Source: GSP-54.
- Scope: v1

### GSDF-26 Plan-checker loop with probes
- Requirement: each iteration runs `verify-command-paths`, `verify-failure-directions` and `check owns`, counts probe findings in code (blocker/warning by probe, ownership problems blocker, exit-69 probe warning), runs a fresh read-only `gsd-plan-checker` with the probe JSON and instructions not to re-derive it (one retry on null, then `failed`), counts non-info issues plus probe issues (unknown severity = blocker); 0 -> pass with advisories; iteration at `maxCheckIterations` -> `needs-owner` with options force proceed, guidance and retry, abandon; count not below the previous -> `needs-owner` stalled; else per-plan issues go to their planner sessions in parallel and phase-level issues to `planner:outline` afterwards; touched plans are re-checked and re-recorded; `revisions record checked` once after a passing loop in plan mode; an unchanged `checked` skips the checker.
- Acceptance: fixture: checker returning 5 issues twice -> stalled; 2 info only -> passed with advisories; a probe blocker counts even when the checker reports none.
- Source: GSP-55, UPS-28, HIS-46, INV-37.
- Scope: v1

### GSDF-27 Owner markers and REVISION_CONFLICT
- Requirement: planner markers `REVISION_CONFLICT`, `PHASE SPLIT RECOMMENDED`, `SOURCE AUDIT`, `CHECKPOINT REACHED`, `PLANNING INCONCLUSIVE` stop the run with `needs-owner` at the first occurrence (no three-strike rule); the result carries stage, question or summary and the conflict object.
- Acceptance: fixture planner returning REVISION_CONFLICT in the checker loop -> `needs-owner` with the conflict, no further revision call.
- Source: GSP-46, UPS-29, D-74, INGEST-CONFLICTS W-05.
- Scope: v1

### GSDF-28 `forceProceed` at the checker cap
- Requirement: with `forceProceed: {reason}` (non-empty) a run reaching the checker cap or stall records the override with the reason and the remaining issues in the result and in STATE (`gsd state override`) and continues to coverage and handoff; an open REVISION_CONFLICT is never forced.
- Acceptance: fixture cap reached with `forceProceed` -> `planned` with an `override` field naming the remaining issues and a STATE Overrides entry; with an open conflict -> `needs-owner`.
- Source: GSP-75, HIS-46, D-65.
- Scope: v1

### GSDF-29 Coverage gate and handoff stage
- Requirement: `check coverage` failure -> `needs-owner` stage Handoff with options re-plan (recommended), move to a later phase, tag the decision informational; otherwise `handoff` writes the wave args, `revisions record handoff`, and the result is `planned` with coverage, waves, planRevision and the shared changes (from the architect and plans' `<shared_changes>`) the orchestrator applies before the first wave.
- Acceptance: fixture uncovered decision -> `needs-owner` with the three options; a passing set writes `handoff/w1..wN.args.json`.
- Source: GSP-56, UPS-30.
- Scope: v1

### GSDF-30 Gap-closure mode capped at one wave
- Requirement: `mode: gaps` requires `verification status` `gaps_found`, records a gap attempt (source report path and sha, plans before) before the planner, runs `planner:gaps` writing one plan per gap group numbered after existing plans with `gap_closure: true` and owns from the plans owning the gaps' files, structure-checks and checker-loops them (ownership probe scoped to new plans), and hands off only new plans as `handoff/gap-w<k>.args.json`; the gap handoff is written without tracer splitting and must contain exactly one execution wave: gap plans in more than one wave, or any dependency between them, return `needs-owner` before dispatch; executing that wave sets `waveExecuted` in the gap attempt record (GSDC-30) before the first executor starts; a second gap attempt on the same phase after one gap wave executed returns `needs-owner` (cap enforced in code, not prose).
- Acceptance: fixture: crash after 1 of 2 gap plans -> `--resume` resumes the attempt and reuses the plan on disk; a gap attempt producing two dependent waves -> `needs-owner`, nothing dispatched; a gap plan marked tracer still yields one execution wave; a crash after the gap wave started followed by a fresh gap run -> `needs-owner`.
- Source: GSP-57, UPS-37, HIS-42, D-73, INV-37.
- Scope: v1

### GSDF-31 Planning document commits
- Requirement: planning docs are committed only per `gsd.commit_policy.docs` (default off) through `gsd commit` with the exact paths (`docs(<N>): ...`); a commit failure is logged, not fatal; agents never commit.
- Acceptance: fixture with docs commits on commits exactly the named paths; off commits nothing.
- Source: GSP-58, UPS-81.
- Scope: v1

### GSDF-32 Resume layers
- Requirement: a rerun with the same args skips unchanged outline, freeze, plans and checker pass through `revisions.json`; `ph workflow --resume <runId>` serves a run that died without input change; attempt records resume gap, verify and research attempts; the normal answer to an owner decision is a new run with the same args file; GSD run ids per phase are recorded in the phase's run record kept by the kit.
- Acceptance: fixture: kill after the skeleton review, rerun unchanged -> no reviewer or planner agent spawned.
- Source: GSP-76, HIS-48.
- Scope: v1

### GSDF-33 Closed-phase gate
- Requirement: planning a phase whose status is `COMPLETE` exits 1 pointing at its VERIFICATION unless `--force`, which prints a warning banner; other statuses replan normally.
- Acceptance: fixture complete phase: plan without `--force` exits 1 and spawns nothing.
- Source: UPS-19.
- Scope: v1

### GSDF-34 Planner reply fallback by disk state
- Requirement: when a planner returns no recognised marker, the workflow counts plan files on disk: some plans present -> structure check decides acceptance; none -> `needs-owner` stage Plan `inconclusive`.
- Acceptance: fixture planner returning garbage with valid plans on disk -> plans accepted after structure check; with none -> `needs-owner`.
- Source: UPS-27.
- Scope: v1

### GSDF-35 Phase auto-detect and separate roles
- Requirement: `gsd-plan` without a phase picks the first phase whose status is `NOT_STARTED` or discussed/researched, else asks; researcher, planner and checker are always separate agents; planning never creates, renames or switches git branches.
- Acceptance: fixture with phase 1 complete and phase 2 discussed picks 2; a scan of the plan script finds no git branch command.
- Source: UPS-18.
- Scope: v1

### GSDF-36 Post-planning bookkeeping
- Requirement: a `planned` result is followed by `gsd state planned-phase --phase N --plans C` (status `Ready to execute`) and `roadmap annotate-dependencies N`, written by the orchestrator.
- Acceptance: fixture planned run updates STATE status and plan count and adds wave headers to ROADMAP; a second run changes no bytes.
- Source: UPS-31.
- Scope: v1

### GSDF-37 Optional plan-review stage
- Requirement: with `planReview` on (default off), after the checker passes: cheap finders run per plan x lens (lenses from config; a source-grounding lens that resolves every cited symbol and path against the code root ships in the kit), a verifier and a judge decide each issue, cross-plan duplicates merge, ONE editor (role `plan_editor`) revises all plans in one pass, structure check reruns and handoff is regenerated; cycles stop when current high plus actionable issues reach 0, `needs-owner` when the count does not drop, at most 3 cycles, never proceed with an open revision conflict; the skeleton review stays mandatory regardless.
- Acceptance: fixture with scripted finders: two cycles with non-dropping counts -> `needs-owner`; converged run regenerates handoff with a new planRevision; a cited symbol absent from the code root is reported MISSING by the grounding lens.
- Source: GSP-80, HIS-50, UPS-34, UPS-35, D-66.
- Scope: v1

### GSDF-38 Execute safe-resume gate
- Requirement: at execute start the orchestrator records an execute baseline in `<phaseDir>/execute-baseline.json` `{codeRoot, head, dirty[{path, sha256|deleted}], untracked[]}` (git status and content hashes, no snapshot copies); before every initial or resumed dispatch it compares the code root with the baseline plus the recorded transfers of completed plans and stops with `needs-owner` (recovery details: paths, owning plan, HEAD) when: a plan without SUMMARY has changed or new files inside its `owns` (tracked or untracked); a changed path is owned by no plan or by more than one plan of the wave; the code root or HEAD moved outside the orchestrator's own commits; or an incomplete plan has commits in its evaluation scope (GSDC-39) and no SUMMARY (options close out manually, re-execute from scratch, mark and skip); any resolver status other than resolved or degraded stops the gate fail-closed (exit 1, no executor).
- Acceptance: fixture repo: a killed executor that left an uncommitted edit to a tracked owned file and an untracked created file, with no commit and no SUMMARY, makes the resumed execute stop before any dispatch and name both paths; a `feat(03-02)` commit without `03-02-SUMMARY.md` spawns no executor; an unrelated file changed after the baseline stops with `unauthorized path`; an unreadable repo exits 1.
- Source: UPS-41, GDB-05, INV-44.
- Scope: v1

### GSDF-39 Plan readiness and all-filtered routing
- Requirement: execute dispatches only plans `phase-plan-index` marks runnable; `--wave N` refuses while lower waves have incomplete plans; when everything is filtered it answers in order: filter active -> "no matching plans"; blocked plans -> "phase stuck, resolve the halt" (never done); not ready -> waiting; all summarised -> route by verification status (missing or stale -> verify; passed and not complete -> phase complete; gaps or human -> next command).
- Acceptance: fixture with one halted plan and two blocked dependents reports "stuck" and starts no verify.
- Source: UPS-42.
- Scope: v1

### GSDF-40 Wave overlap check and cwd/branch drift guard
- Requirement: before each wave, two plans sharing a `files_modified` entry run sequentially and the overlap is logged as a planning defect; execute refuses to start when the orchestrator's cwd is inside a `ph` agent worktree or on a `harness/*` branch, printing stranded commits and dirty files.
- Acceptance: fixture wave with overlapping files runs the two plans one after the other; orchestrator cwd in `.claude/worktrees/x` exits 1 with the report.
- Source: UPS-43, D-26.
- Scope: v1

### GSDF-41 Worktree or shared-tree execution per adapter
- Requirement: `gsd.isolation` `worktree` gives each executor a `ph` worktree (created one at a time) whose uncommitted output the orchestrator integrates through the transfer transaction of GSDF-94 in plan order, never completion order; a deletion not declared in the plan's `files_deleted` is refused; `shared` runs executors in one tree and requires disjoint `owns` per wave (GSDC-23); recovery of a refused transfer never edits the main tree by default and keeps the worktree.
- Acceptance: fixture with `isolation: worktree` and two plans integrates in plan order regardless of finish order; an undeclared deletion is refused while the other plan is integrated; `shared` with overlapping owns refuses the wave.
- Source: UPS-44, GSP-23, D-26.
- Scope: v1

### GSDF-42 Executor dispatch contract
- Requirement: each plan runs one `gsd-executor` (or the adapter's executor agent, ADPT-09) with paths only: its PLAN, the granted SUMMARY path, its owns, the adapter stack skill to follow, the verbatim deviation rules (Rule 1-3 auto-fix bounded by owns, package installs excluded from Rule 3 and a failed install returns a blocking human checkpoint, Rule 4 returns `partial` with the decision in notes, 3 auto-fix attempts per task then Deferred Issues); the executor never commits, never writes STATE, ROADMAP or REQUIREMENTS, writes its SUMMARY to the granted path, and returns `{taskResults[{task, status implemented|partial|blocked|skipped, evidence}], deviations[], requests[]}`; a checkpoint or Rule-4 result becomes `needs-owner` whatever any parallelization flag says.
- Acceptance: fixture executor prompt contains the four rule blocks and the stack skill name; a fake executor returning a Rule-4 partial yields `needs-owner`; a fake that commits is detected by a HEAD comparison and fails the plan.
- Source: UPS-45, UPS-49, UPS-89, UPS-90, GSP-05, D-63, D-94.
- Scope: v1

### GSDF-43 Completion reconciliation
- Requirement: when an executor returns no normal completion or its agent ends abnormally, the orchestrator first reconciles artifacts (SUMMARY present at the granted path and changes inside owns = complete, not re-dispatched) and only then classifies the failure; it spot-checks each SUMMARY's first two `key-files` paths exist.
- Acceptance: fixture executor killed after writing SUMMARY and code is classified complete; a SUMMARY naming a missing created file fails the spot-check.
- Source: UPS-46, INV-44.
- Scope: v1

### GSDF-44 Post-wave build, test and obligation gate
- Requirement: after each wave (per-wave mode) or after the last wave (batch mode) the orchestrator runs `adapter.commands.build` under `run-with-timeout` (`build_timeout_s`, default 300) and `adapter.commands.test` after `normalize-test-command` (`test_timeout_s`, default 600), then every plan `<automated>` obligation through the adapter's runner for its kind, and writes one gate-evidence file per gate run (ADPT-17); a timeout (124) is reported, never silently ignored, and never counts as green; plan tracking (ROADMAP progress, STATE) is updated only when build, tests and obligations are green by valid, current evidence; evidence that is invalid, stale (inputs changed after it was produced), incomplete or shows zero executed targets for an obligation that names targets is a failure; heavy commands take `adapter.mutex` when set.
- Acceptance: fixture adapter with fake commands: failing tests leave plans in progress and ROADMAP unchanged; a `test:` obligation whose runner exits 0 with 0 tests executed fails that task; evidence produced before a fixer changed a covered file is rejected as stale; a build timeout prints the timeout message and blocks tracking.
- Source: UPS-47, HIS-84, HIS-82, D-95, INV-53.
- Scope: v1

### GSDF-45 Failure classification
- Requirement: an executor failure body is classified `quota` (sentinels such as `usage limit`, `rate limit`, `429`, `too many requests`, `RESOURCE_EXHAUSTED`, with `retryAfterSeconds` when present) or `unknown`; quota never offers retry-now and reports the reset time; unknown asks continue or stop through `needs-owner`.
- Acceptance: fixture body containing `429` -> class quota with the retry hint and no re-dispatch.
- Source: UPS-48, INV-13.
- Scope: v1

### GSDF-46 Bounded code-review gate
- Requirement: at the review point of the execution mode (GSDF-49: after the wave is green in `per-wave`; code-only reviews in `batch`), one fresh `gsd-code-reviewer` per plan reviews the plan's review scope (GSDF-92) with the lenses in `adapter.review_lenses`; each finding carries `trigger`, `likelihood`, `confidence` (0-100), `impact`; a high finding blocks only with a non-empty trigger, confidence >= 80 and likelihood not theoretical (else downgraded); blocking findings go to a separate read-only `finding-verifier` (confirmed, refuted, uncertain); a missing verdict is retried once, then `unverified` (still blocking, escalated to the owner, never sent to the fixer); in `per-wave` mode confirmed findings get ONE `gsd-code-fixer` pass, then the green gate reruns and a resolution check reviews only those findings (no new findings); in `batch` mode confirmed findings go to the one final fixer with the gate failures (GSDF-49); unresolved ones go to the owner; every review, verdict and resolution is persisted in the review record (GSDF-92).
- Acceptance: fixture review run: a high without trigger is downgraded; confidence 70 is downgraded; a null verifier twice yields `unverified` and `needs-owner`; the resolution-check prompt lists only the confirmed findings.
- Source: HIS-51, WFL-46, MTH-64, UPS-58, D-56, INV-41.
- Scope: v1

### GSDF-47 Review only built code
- Requirement: in `per-wave` mode no reviewer runs before the integrated build and tests of the wave are green; a plan blocked only by another plan's failure is reviewed with the failure attached; `batch` mode is the D-63 exception: its reviews run on unbuilt code, are recorded as `code-only` evidence (never green evidence), and the resolution check runs only after the final gate is green.
- Acceptance: fixture per-wave run with a failing build: zero reviewer calls; fixture batch run: review records carry `code-only` and no resolution check runs before the final green gate.
- Source: HIS-53, INV-41.
- Scope: v1

### GSDF-48 Non-blocking findings
- Requirement: downgraded and normal findings never block; they are appended to `.planning/phases/<NN>-<slug>/deferred.md` (finding, plan, file, reason) and each review run appends one line to `_workspace/review-metrics.jsonl` (confirmed, refuted, unverified, resolved counts, deferred count).
- Acceptance: fixture run with two normal findings passes the wave, writes both to `deferred.md` and one metrics line.
- Source: MTH-71, HIS-51, D-58.
- Scope: v1

### GSDF-49 Execution modes `per-wave` and `batch`
- Requirement: `gsd.execution_mode` `per-wave` (default) runs, per execution wave: code -> green gate (GSDF-44) with bounded verify-fix rounds (`gsd.max_verify_rounds`, default 4, stall after 2 rounds whose failure count does not drop -> `needs-owner`) -> review (GSDF-46) -> one fix pass -> green gate -> resolution check -> commit; the tracer wave runs alone and a red tracer starts no later wave; `batch` runs: all waves code-only, each followed by a code-only review when `gsd.batch_review` is true (no review when false) -> one phase-level code-only review of the whole phase diff -> one orchestrator build plus full test suite plus all obligations -> when red or with confirmed findings, ONE fixer (role `fixer`, GSDF-50) receiving all gate failures and all confirmed findings -> green gate -> resolution check of those findings -> commit; a wave run without the gate records `verify: skipped` in its result and the verifier evidence flags it.
- Acceptance: event-order fixtures with a fake runner: `batch` with `batch_review` true logs code, review per wave, phase review, gate, fixer, gate, resolution; with false the per-wave reviews are absent and the phase review stays; a failed final build still reaches the fixer once; the wave results carry `verify: skipped`; per-wave run with a red tracer starts no second wave.
- Source: GSP-81, GSP-85, GSP-86, D-63, INGEST-CONFLICTS W-07, W-18, R-08.
- Scope: v1

### GSDF-50 Who builds and tests
- Requirement: with `gsd.fixer_verifies_itself` true (default) the fixer's runtime block tells it to run the adapter build and test commands after its changes, at most `gsd.fixer.max_build_attempts` times (default 3) and within `gsd.fixer.minutes` (default 60), stopping early when two consecutive attempts do not reduce the failure count, and to return `{status fixed|unresolved, attempts, remaining_failures, evidence}`; the orchestrator waits at most `gsd.fixer.minutes` plus a margin, then stops and archives the fixer; `unresolved` or a timeout ends with `needs-owner` and the evidence; the kit's runtime block for parallel executors says the gate runs build and tests and they must not (the upstream executor body is left unchanged, D-111); with the flag false fixers also leave verification to the gate.
- Acceptance: fixture prompt snapshots of the kit runtime block for both flag values; a fake fixer whose build fails every time returns `unresolved` after 3 attempts and the run ends `needs-owner`; a fake fixer that never returns is stopped at the deadline.
- Source: HIS-54, D-64, INGEST-CONFLICTS W-08.
- Scope: v1

### GSDF-51 Failure attribution
- Requirement: gate failures are attributed to plans by file path within `owns` (and by adapter-supplied attribution output when present); failures the path rule cannot place are passed to `adapter.attribution` (ADPT-15 `attribute`) when set; failures still unplaced go to one integration fixer that owns exactly those files; gate checks listed first in `adapter.commands.gates` run first and, while one fails, later obligations are skipped and reported as not executed; excerpts put error lines before warnings and link complete logs; a failure raised in another plan's files marks the observing plan `blockedBy`.
- Acceptance: fixture gate output with 5 failures in one plan's file and 1 in an unowned file: one call to that plan's executor session, one to the integration fixer; dependent plans are `blockedBy`.
- Source: HIS-59.
- Scope: v1

### GSDF-52 Cross-plan change requests
- Requirement: an executor result `requests[{path, change, reason}]` for a path owned by another plan of the same wave is delivered to that plan's executor session in the next fix round; a path no plan owns goes to the orchestrator as a shared change; requests survive a failed fix turn.
- Acceptance: fixture: plan A requests a change in plan B's file -> B's next prompt carries it; an unowned path appears in the run's `sharedChanges`.
- Source: HIS-58.
- Scope: v1

### GSDF-53 Orchestrator commits
- Requirement: only the orchestrator commits code, per `gsd.commit_policy.code` `per-wave` (default) or `per-plan`, with subjects `type(<phase>-<plan>): ...` (per-plan) or `type(<phase>-w<k>): ...` (per-wave) and a `Plans: <id,...>` trailer; after each commit it appends `{sha, phase, wave, plans: {<plan>: [files]}}` to `<phaseDir>/commits.json` (single writer, atomic), which GSDC-39, GSDC-40 and GSDF-38 use to scope wave commits to plans; commits include the plans' SUMMARY files.
- Acceptance: fixture per-wave run creates one commit per wave with the expected subject and trailer and a commits.json entry listing each plan's files; per-plan creates one per plan.
- Source: GSP-78, UPS-74, D-63.
- Scope: v1

### GSDF-54 Branching strategy
- Requirement: `gsd.branching` `none` (default) never creates branches and warns when committing to a protected branch listed in config; `phase` creates `gsd/phase-<N>-<slug>` from `origin/<default>` with `--no-track` (never from the current HEAD) and aborts when the fetch fails and no local `origin/<default>` exists.
- Acceptance: fixture repo with `phase`: the branch's base is `origin/main`, not HEAD; failed fetch without the ref aborts with no branch created.
- Source: UPS-52, D-91.
- Scope: v1

### GSDF-55 verify workflow
- Requirement: `gsd-verify.js` (args `phaseDir`, `baseline`, `evidence[]` = paths of gate-evidence files, ADPT-17) refuses evidence that is invalid or stale against the current code (it is listed to the verifier as stale, never as proof), computes an attempt key from the `checked` revision, baseline and evidence and records the attempt with the previous report sha before dispatch; one fresh `gsd-verifier` reads plans, summaries (claims, not proof), ROADMAP, REQUIREMENTS, CONTEXT, WIRING, the previous report and the gate evidence ("do not rerun anything"), writes `<NN>-VERIFICATION.md` with the fingerprint and does not commit; afterwards `verification status` must exit 0, a report equal to the previous sha fails, a null agent result is accepted when the new file passes, and the file's status wins over the returned one; result `{status passed|gaps_found|human_needed|stale, path, score, gaps, humanVerification}`.
- Acceptance: fixture verifier returning `passed` while its file says `gaps_found` -> result `gaps_found` with a log line; no new file -> `failed`; an unchanged previous report -> `failed`; an evidence file whose input identity no longer matches the code is passed to the verifier marked stale.
- Source: GSP-64, HIS-48, INV-35, INV-53.
- Scope: v1

### GSDF-56 Verification routing
- Requirement: `passed` -> `phase complete` (GSDC-15); `human_needed` -> writes `<NN>-UAT.md` (one test per human item, status testing) and stops without advancing; `gaps_found` -> reverts the phase's requirement marks, then plan `mode: gaps`, one gap wave, re-verify; leftovers after the gap wave go to the owner; `stale` -> verify again after execution evidence is current.
- Acceptance: fixture `human_needed` report never flips a ROADMAP checkbox and writes UAT.md; `gaps_found` routes to gaps mode once and then `needs-owner`.
- Source: UPS-50, D-73, INV-43.
- Scope: v1

### GSDF-57 UAT conversation
- Requirement: the main session presents UAT tests one at a time in plain text; answers classify as pass (empty, yes, y, ok, next), skip, blocked (with an inferred `blocked_by` tag) or issue (severity inferred, never asked); deferred follow-ups never become gaps; UAT.md is written after each issue, every 5 passes and at completion; zero unresolved issues plus `phase uat-passed` -> verification canonicalised to passed and phase complete; issues -> gaps planning; non-browser safeguards: a SUMMARY completion claim counts only when its plan's commits.json entry and gate evidence (ADPT-17) confirm it, else the test row is a blocker issue; when a phase plan changed files matching `adapter.startup_globs` and no cold-start smoke test exists, one is injected as the first test; on resume, gaps whose `gap_ids` are covered by a completed gap plan with passing evidence are marked resolved, never re-asked as issues.
- Acceptance: live smoke on a fixture UAT; fixture tests: 0 pass, 0 issue, 3 blocked never canonicalises to passed; a SUMMARY claiming a commit absent from commits.json yields a blocker row; a plan changing a startup glob gets an injected cold-start test; a resumed UAT whose gap was closed by a completed gap plan shows it resolved.
- Source: UPS-54, UPS-55.
- Scope: v1

### GSDF-58 Phase completion and transition
- Requirement: after `phase complete` the transition step evolves PROJECT.md (move shipped items to Validated, update Key Decisions, last-updated footer) and points to the next phase; it never closes milestones.
- Acceptance: fixture transition moves a completed Active requirement to Validated and stamps the footer.
- Source: UPS-51, UPS-63.
- Scope: v1

### GSDF-59 progress and next router
- Requirement: `gsd-progress` (read-only) renders position, recent summaries, decisions and blockers and routes: Route 0 first scans all phases lowest first and routes any phase with plans > summaries to execute (a scan whose scope is not complete is reported as failed, not clean); then for the current phase UAT partial -> UAT, gaps -> plan gaps, summaries < plans -> execute, verification not passed -> its next command, no plans -> discuss or plan, complete -> next phase; `next` adds hard stops (unresolved `.planning/.continue-here.md`, STATE status error, VERIFICATION invalid) and runs the chosen step.
- Acceptance: fixture with STATE on phase 4 and a phase-2 plan without SUMMARY routes to execute phase 2.
- Source: UPS-60, UPS-70.
- Scope: v1

### GSDF-60 Pause and resume handoff
- Requirement: `gsd-pause` writes `.planning/.continue-here.md` (position, open items, uncommitted files, next action) and a STATE session note; resume reads it, reports, and removes it after the owner confirms the next action.
- Acceptance: fixture pause then resume restores the next action from files only.
- Source: UPS-63, HIS-70.
- Scope: v1

### GSDF-61 quick
- Requirement: `gsd-quick [--full] <desc>` requires a ROADMAP, creates `.planning/quick/<YYMMDD-xxx>-<slug>/` (slug <= 40 chars), plans ONE plan of 1-3 tasks (paths repo-root-relative), executes it through the executor contract (GSDF-42), and with `--full` adds discuss, research, a checker loop of at most 2 iterations and a verifier; the orchestrator does one `docs(quick-<id>)` commit per policy; no STATE table row (quick tasks are listed from the directory); trivial one-line fixes are done inline by the main session without a plan.
- Acceptance: fixture `quick "fix a | b"` creates the directory with PLAN and SUMMARY and leaves STATE parseable; `--full` checker stops after 2 iterations.
- Source: UPS-56, UPS-57, D-89.
- Scope: v1

### GSDF-62 undo
- Requirement: `gsd-undo --last N | --phase NN | --plan NN-MM` selects commits with `select-revert-commits`, shows dependent phases or plans, asks a hard confirmation, then runs `git revert --no-commit` (never `git reset`); a `--plan` selection containing a shared wave commit is refused and the owner is offered the confirmed wave scope (all sibling plans named) instead of a silent partial revert; no or invalid argument prints usage and exits 1.
- Acceptance: fixture repo: per-plan commits: `--plan 03-02` reverts only its commits and leaves history intact; default per-wave commits: `--plan 03-02` of a shared wave commit refuses and names `03-01`; no confirmation reverts nothing.
- Source: UPS-94, UPS-63.
- Scope: v1

### GSDF-63 forensics
- Requirement: `gsd-forensics` runs in the main session, read-only: no agent, workflow, build or test; it follows the generated upstream forensics text (adapter overlay: the multi-runtime `gsd_run` bootstrap and the GitHub-issue step are not run; the orchestrating main session adds one STATE session note through `gsd state session-note` only when the investigation concerns the active phase, the sole exception to report-only output); evidence includes git history, `.planning/debug/` sessions, `_workspace/_runs/<runId>/` records and gate evidence; it adds the anomaly "same failure signature repeating without a persistent hypothesis record"; apart from that STATE note the only file written is `.planning/forensics/<YYYY-MM-DD>-<slug>.md` with relative paths, credentials stripped, diffs cut at 50 lines, and each hypothesis labelled "forensic hypothesis, not debugger-confirmed".
- Acceptance: fixture repo with a repeated failing signature: the report exists at the dated path, flags the loop, labels hypotheses and contains no absolute home path; for an investigation not about the active phase `git status` shows only the report; for one about the active phase it shows the report and STATE.md with exactly one new session note.
- Source: GDB-52, GDB-53, D-84, D-111.
- Scope: v1

### GSDF-64 debug skill and session rules
- Requirement: `gsd-debug` (main session) gathers the five upstream symptoms as numbered plain-text questions (values treated as data), creates or reuses the session through `gsd debug create` (GSDC-43), runs one `gsd-debugger` `ph` agent per invocation with the upstream session-manager prompt (GSDC-46) plus a `<runtime_adapter>` block (goal rendered in every turn kind, code root, edit scope from the failing plans' `owns`, budget left), and serves `list`, `status`, `continue`; debug sessions on one code root run serially and no executor or planner writes in that root meanwhile; only the skill and verbs write `## Checkpoints`, move files to `resolved/` and append the knowledge base.
- Acceptance: fixture with a fake debugger: create then list shows the session; a second invocation while one runs on the same root is refused; the rendered prompt contains goal, scope and budget lines.
- Source: GDB-01, GDB-06, GDB-22, GDB-50, GDB-51, GDB-58, GDB-62, D-78, D-82.
- Scope: v1

### GSDF-65 Debug checkpoints and untrusted data
- Requirement: the debugger never asks; a checkpoint return ends the turn and becomes `needs-owner {id, type, question, options}`; the owner's answer arrives on the next invocation as `checkpointAnswer {id, response}`; owner answers, reports and command output enter prompts only between DATA_START and DATA_END and are evidence, never instructions; reproduction scripts from reports are not executed by the skill.
- Acceptance: fixture: an owner answer containing "ignore previous instructions" appears only inside DATA_START/DATA_END in the next prompt; an unanswered checkpoint makes the next invocation refuse with `awaiting-owner`.
- Source: GDB-23, GDB-24, GDB-51.
- Scope: v1

### GSDF-66 Debugger overlay rules
- Requirement: the `gsd-debugger` include overlay states: the session file is updated before acting (Current Focus overwritten, Evidence and Eliminated append-only, Symptoms immutable, concrete `next_action`); edits only inside the edit scope, never a shared file, instrumentation removed before close; fix the demonstrated cause, never weaken an assertion, enlarge a tolerance, lengthen a wait or re-press inputs to get a pass; a fixture or oracle change needs a named spec line or owner decision cited in Resolution; a fix already present in the tree before the session is recorded as evidence and raised as a decision checkpoint; never commit, stage or stash; a completed fix returns a `human-verify` checkpoint with a prevention block; MemPalace, specialist skills and TDD mode are off.
- Acceptance: kit test asserts the generated debugger's include chain contains the overlay and each rule sentence; fixture fake debugger turn leaves the session valid under `gsd debug status` and the git index unchanged.
- Source: GDB-26, GDB-46, GDB-48, GDB-59, HIS-55, D-80, D-83, INV-42.
- Scope: v1

### GSDF-67 Debug budget and evidence rules
- Requirement: a debug turn is one prompt sent to the `gsd-debugger` agent and its reply (the initial prompt, a checkpoint continuation or a skill re-prompt each count one); a session is bounded by `gsd.debug.max_turns` (default 16) and `gsd.debug.minutes` (default 120 of wall time while a turn runs); the used turns and minutes are persisted in the session frontmatter `budget_used {turns, minutes}` after every turn and read by every continuation; each turn's `ph` wait timeout is the remaining minutes and a turn exceeding it is stopped and archived; exhaustion ends with `needs-owner` type `budget-exhausted`; an owner answer never refills a budget (an extension needs turns, minutes and a reason, recorded in the frontmatter); closing `resolved` requires the failing signature's verify command to pass on a fresh run that executed at least one test or step; a filter or command that executed nothing, or could not run, is never a pass.
- Acceptance: fixture fake debugger looping: the session stops at the turn cap with `budget-exhausted`; a continuation of a session with an exhausted budget and only an owner answer refuses without a turn; a resolve whose rerun evidence (ADPT-17) shows 0 executed tests is refused.
- Source: GDB-31, HIS-57, HIS-81, D-78, INV-37, INV-53.
- Scope: v1

### GSDF-92 Code-review scope and review record
- Requirement: a plan's review scope is chosen in this order: an explicit file list in the run args (used alone, never widened); else the plan SUMMARY `key-files` created and modified (root-level and extensionless files kept, `~/` expanded, paths outside the code root dropped and named); else the plan's evaluation scope (GSDC-39); SUMMARY paths are cross-checked with the plan's actual changes (transfer record or commits.json), adding changed files the SUMMARY omitted and naming listed files that did not change; planning artifacts, lockfiles and deleted files are excluded (deleted files named); the review depth is `gsd.review_depth` (`standard` default); each review writes `<phaseDir>/review/<waveId>-<plan>.json` `{plan, scope[], excluded[], lenses[], codeOnly, findings[{id, severity, trigger, likelihood, confidence, impact, file, line, status gated|downgraded|deferred, verdict confirmed|refuted|uncertain|unverified|null}], resolution[{id, resolved, evidence}]}` and the phase keeps `<NN>-REVIEW.md` rendered from those records.
- Acceptance: fixture: a SUMMARY listing only `Dockerfile` reviews `Dockerfile`; an explicit narrow list is not widened; a changed source file missing from the SUMMARY is added and logged; an unrelated commit interleaved in the wave range is not in scope; the record validates against the schema.
- Source: UPS-58, HIS-51, D-56, D-58.
- Scope: v1

### GSDF-93 Execute arguments and concurrency
- Requirement: `gsd-execute` accepts `--phase N`, `--wave N`, `--plans ids`, `--gaps-only`; `--gaps-only` selects plans with `gap_closure: true` and refuses (exit 1, naming them) when any plan of the phase lacks a `gap_closure` key; `gsd.parallelization.enabled` false runs the plans of a wave one at a time; `max_concurrent` (null = the M6 `max_subagents` cap) limits concurrent executors and never exceeds that cap; per-run state lives in the `ph workflow` run directory and the phase's execute records (baseline, transfers, commits.json, halt records), not in git-dir handoff files; upstream's ephemeral auto-chain flag is not used (chaining is the `gsd-plan` run result, GSDF-02).
- Acceptance: fixture: `parallelization.enabled: false` with a 3-plan wave shows at most one executor running at any time; `max_concurrent: 2` never exceeds 2; `--gaps-only` over plans with a missing `gap_closure` key exits 1 naming them.
- Source: UPS-40, UPS-90, UPS-37, D-94.
- Scope: v1

### GSDF-94 Worktree transfer transaction
- Requirement: for `isolation: worktree`, after an executor ends the orchestrator, in plan order: reads the worktree's changes against its base (tracked edits, untracked files, deletions) and the SUMMARY at the granted path; refuses paths outside the plan's `owns` plus its SUMMARY and deletions not in `files_deleted`; verifies the main tree's paths to be written are unchanged since the execute baseline (unrelated dirty files and the index of the main tree stay untouched); copies the validated files into the main tree atomically per file and records `<phaseDir>/transfers/<plan>.json` `{plan, worktree, base, files[{path, sha256|deleted}]}`; only then is the worktree eligible for pruning; a refused or failed transfer leaves the worktree and branch intact and halts the plan (GSDC-13 halt record); workers never commit; the green gate runs on the integrated main tree.
- Acceptance: offline git fixture with two executors leaving uncommitted outputs and SUMMARYs in their worktrees: main receives both in plan order, transfer records exist, the gate's fake test reads the integrated files; an out-of-owns file is refused with the worktree kept; an unrelated dirty file in main is byte-identical afterwards.
- Source: UPS-44, UPS-45, D-26, INV-44.
- Scope: v1

### GSDF-95 Roadmapper draft contract
- Requirement: the generated `gsd-roadmapper` keeps its upstream body; its kit overlay redirects its outputs to `.planning/drafts/ROADMAP.md` and `.planning/drafts/traceability.json` (`{requirement: phase}`) and forbids writing ROADMAP, STATE or REQUIREMENTS; the orchestrator validates the draft (every v1 requirement in exactly one phase, 2-5 success criteria per phase, ROADMAP grammar GSDC-07), presents it for approval, and on approval installs ROADMAP, updates REQUIREMENTS traceability and initialises STATE through the single writer (GSDC-12); a rejected or adjusted draft leaves the final files unchanged.
- Acceptance: fixture fake roadmapper: before approval ROADMAP, STATE and REQUIREMENTS are byte-identical (or absent); after rejection they are unchanged; after approval they exist and parse; kit test asserts the roadmapper body equals upstream and the overlay follows it.
- Source: UPS-07, GSP-72, D-111, INV-38.
- Scope: v1

## M11 harness (HARN)

The harness method is the English port of revfactory Harness v2.1.0 (commit 92d9f1b, Apache-2.0) as found in the old kit at tag `ref-final` (`project/.agents/skills/harness/`, `harness-evolve/`, `ai-orchestrator/`). D-111: its text is carried as it is; the kit changes only the adapter layer listed in HARN-02. The D-109 role (generate the project adapter) is delivered by the kit overlay (HARN-03), not by editing the method.

### HARN-01 Method text carried unchanged
- Requirement: the kit ships `.claude/skills/harness/` (SKILL.md and references: execution modes, team patterns, team examples, orchestrator template, QA agent guide, skill writing guide, skill testing guide, model selection guide), `.claude/skills/harness-evolve/` and `.claude/skills/ai-orchestrator/` with the method text of the source unchanged: not trimmed, rewritten or restructured; every difference from the source is one of the adapter-layer edits of HARN-02.
- Acceptance: kit test diffs each shipped file against the source copy kept in `tests/fixtures/method-source/` (sha256 recorded in `PROVENANCE.json` with repo, tag `ref-final`, path); `PROVENANCE.json` also inventories every permitted adapter region as `{file, source line range, HARN-02 category (a)-(h), sha256 of the replacement}`; a differing hunk passes only when it lies inside an inventoried region and equals its recorded replacement; any other hunk fails even if a NOTICE entry describes it; every inventoried region is listed in NOTICE.
- Source: MTH-01..09, MTH-11, MTH-15..20, MTH-25, MTH-26, MTH-28, MTH-30..39, MTH-41, MTH-45, MTH-51, MTH-53, MTH-56, MTH-66..68, D-111, D-54.
- Scope: v1

### HARN-02 Adapter-layer edits to the method text
- Requirement: the only edits to carried method text are: (a) paths: `.agents/agents/`, `.claude/skills/<name>/`, `CLAUDE.md` (never `project/...`); (b) single skill tree: the `ph skills-sync` step and `.agents/skills` source wording removed (D-10); (c) runtime mapping: `references/paseo-runtime.md` and the runtime notes inside the skills describe the new `ph` (entry `node .agents/harness/ph.mjs`, `ph workflow --script|--name --args-file [--resume runId]` as the one resume shape, `ph watch-run`, run dir `_workspace/_runs/<runId>/`, `max_subagents` read from config); (d) Claude Code only: no `codex/` or `opencode/` model examples, tiers or `circle/<model>` only; (e) no Backlog wording; (f) config key names of the new defaults; (g) one line in each SKILL.md loading the kit overlay (HARN-03); (h) the D-59 reading of coding tiers stated in the overlay (standard = clear-procedure coding, pro = multi-step structural coding), not in the method text; each edit is listed in the skill's NOTICE.
- Acceptance: kit test greps shipped method text: no `project/.agents`, `project/CLAUDE.md`, `skills-sync`, `codex/`, `opencode/`, `backlog`, `paseo_harness.mjs`; the NOTICE lists entries (a)-(h); HARN-01's diff test passes.
- Source: MTH-12, MTH-13, MTH-21, MTH-69, MTH-70, MTH-73, D-10, D-59, D-111, INGEST-CONFLICTS W-02.
- Scope: v1

### HARN-03 Kit overlay: the harness generates the project adapter
- Requirement: the kit overlay `references/kit-adapter.md` of the harness skill states: run after `gsd-map-codebase`; read `.planning/codebase/*.md`; write the project adapter (ADPT): `adapter` and `gsd` sections of `.agents/harness.config.json` (commands, verify vocabulary with resolvers, ownership, review lenses, syntax checkers, instructions, optional envelope and mutex, roles with models, efforts and reasons), one stack skill in `.claude/skills/<stack>/`, project agents in `.agents/agents/` only where a GSD agent is not enough; run `ph harness lint`; report what was written and ask the owner to confirm; record a history row; the kit's GSD agents are reused before any new agent (role-vs-skill split and overlap check of the method).
- Acceptance: kit test asserts the overlay exists, is loaded by the SKILL.md overlay line and names each adapter section of ADPT-01..13; live smoke: on a fixture repo after map-codebase the harness writes an adapter that `ph harness lint` accepts.
- Source: D-109, D-111, MTH-04, MTH-10, MTH-11, MTH-62, G5.
- Scope: v1

### HARN-04 Generated adapters for two different stacks
- Requirement: the harness skill with the overlay produces, for fixture codebases of at least two different stacks (one interpreted-language web service, one compiled-language CLI), adapters whose commands run on the fixture, whose verify vocabulary resolves the fixture's tests, and which pass `ph harness lint`; the kit ships neither fixture's adapter.
- Acceptance: named live smoke recorded in the kit's test log: both fixtures, generated adapter files attached, lint exit 0, `adapter.commands.test` exits 0 on each fixture; `ship/` contains no file from either adapter.
- Source: D-109, D-110, R-09, SYNTHESIS M12 acceptance.
- Scope: v1

### HARN-05 Skill lint
- Requirement: `ph harness lint` checks the generated or adapter-referenced assets (files the latest generator or evolve history row lists in Scope, plus every skill, agent and script the adapter names); other owner content is outside the mandatory check (`--all` reports it as advisory warnings, exit 0): SKILL.md front matter has `name` and `description` (description states what and when, at least one "use when" trigger), SKILL.md <= 500 lines, any `references/*.md` over 300 lines has a contents list, no README, CHANGELOG or INSTALLATION file in a skill folder, no generated file under `.claude/commands/`, agent front matter has `name` and `description` and only the allowed keys, an agent whose `tools:` lists Write also lists Edit (warning); findings print one line each and exit 2, usage errors exit 1.
- Acceptance: lint fixtures: a generated 501-line SKILL.md, a 301-line reference without contents, a README in a generated skill, a generated agent without description: each yields its finding and exit 2; a clean generated adapter beside an unrelated owner command and an unrelated owner skill exits 0.
- Source: MTH-14, MTH-22, MTH-23, MTH-24, MTH-27, MTH-46, MTH-54, P8.
- Scope: v1

### HARN-06 In-session primitive lint
- Requirement: within the HARN-05 scope lint fails an operational use of an in-session or v1 primitive: a call form (`Agent(`, `Workflow(`, `SendMessage(`, `TaskCreate(`, `TaskUpdate(`, `TaskList(`, `TaskGet(`, `TaskStop(`, `TeamCreate(`, `TeamDelete(`), one of those names in an agent's `tools:` list, `team_name`/`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` set in config or env, or an imperative instruction line starting with `Use`/`Call` followed by one of those names; a bare mention (e.g. a ban explanation or the word `broadcast`) is a warning only; workflow scripts with `Date.now()`, `Math.random()` or a non-literal `meta` fail; provider settings are never changed to satisfy lint (SendMessage stays allowed on main providers, D-06).
- Acceptance: lint fixtures: a generated agent with `SendMessage(` in its body and one with `TaskList` in `tools:` fail; a generated skill sentence "never use SendMessage" and a document using the word broadcast only warn; a script with `Date.now()` fails.
- Source: MTH-05, MTH-46, MTH-72, INV-06.
- Scope: v1

### HARN-07 Reference lint
- Requirement: lint fails when a generated skill, workflow script or the adapter names an agent type without `.agents/agents/<name>.md`, a skill without `.claude/skills/<name>/SKILL.md`, or a script path that does not exist, and when the adapter section fails closed validation (M3).
- Acceptance: lint fixture with `agentType: qa-inspector` and no definition fails naming it; an adapter resolver path that does not exist fails.
- Source: MTH-10, MTH-46, D-77.
- Scope: v1

### HARN-08 Model tiers and roles
- Requirement: generated agent files name only a tier (`frontier`, `pro`, `standard`) in `model:`; concrete model ids appear only in `gsd.roles` entries `{model, effort, reason}` with a non-empty reason; lint flags a concrete id in an agent file and a role without reason.
- Acceptance: lint fixtures: `model: circle/x` in an agent fails; a role entry without `reason` fails.
- Source: MTH-12, MTH-13, HIS-19, D-16, R-10.
- Scope: v1

### HARN-09 Eval data schemas
- Requirement: the kit validates skill-test records against exact schemas: `eval_metadata.json {eval_id, eval_name, prompt, assertions[]}`, `grading.json {expectations[{text, passed, evidence}], summary{passed, failed, total, pass_rate}}`, `timing.json {total_tokens, duration_ms, total_duration_seconds}`; timing comes from `ph fanout --collect` JSON or workflow records (tokens only when tracked from creation).
- Acceptance: fixture `grading.json` using `name/met/details` fails; a valid one passes.
- Source: MTH-29, D-37.
- Scope: v1

### HARN-10 Trigger tests for generated project skills
- Requirement: every project skill the harness generates gets a trigger test (10 should-trigger and 10 near-miss requests, each run in a fresh `ph` agent, on the INV-50 test model unless the owner names another), recorded with precision and recall in the history row; `harness-evolve` re-runs at least 3 + 3 when a description changes; with-skill versus baseline runs and the blind A/B workflow remain optional.
- Acceptance: named live smoke on a fixture adapter's stack skill: the trigger record exists with 20 requests and results; lint warns when a generated skill has no trigger record.
- Source: MTH-47..52, D-57, INV-50.
- Scope: v1

### HARN-11 Output language
- Requirement: agent definitions, skills, adapter files and history rows the harness writes are English whatever language the owner uses; replies and owner-facing deliverables stay in the owner's language.
- Acceptance: named live smoke: a generator run prompted in Vietnamese yields English adapter, skill and agent files and a Vietnamese summary to the owner.
- Source: MTH-55, HIS-68, INV-51.
- Scope: v1

### HARN-12 harness-evolve
- Requirement: `harness-evolve` (method text carried) reads `.agents/harness-history.md`, `git log` of `.agents/`, `.claude/`, AGENTS.md, CLAUDE.md, run records (`_workspace/_runs/*/run.json`, `journal.jsonl` null reasons), `_workspace/review-metrics.jsonl` and phase `deferred.md`; maps feedback to the adapter part it touches; generalises, records the why, applies one change at a time, asks the owner on a regression conflict with an earlier row; appends a history row; re-runs trigger tests when a description changed; names kit-wide lessons for `kit pull <project> --kit <dir>`. Adapter-layer edits only: run-record paths, the `kit pull` command form, project settings in `.agents/harness.config.json`.
- Acceptance: kit test greps the shipped skill for the new run-record paths and the `kit pull` form; named live smoke on a fixture repo with two identical revision requests in history proposes an adapter change and appends one row.
- Source: MTH-57, MTH-58, MTH-59, D-58, D-60, D-111.
- Scope: v1

### HARN-13 History table
- Requirement: `.agents/harness-history.md` has the table `| Date | Change | Scope | Reason | Supersedes |`, one row per change, newest last; lint requires Date, Change, Scope and Reason non-empty, ISO dates in non-decreasing order, Scope as repo-relative paths.
- Acceptance: lint fixtures: a row with empty Reason fails; dates out of order fail; a valid file passes.
- Source: MTH-60, HIS-66, D-60, INGEST-CONFLICTS W-11.
- Scope: v1

### HARN-14 Always-loaded rules in the AGENTS.md block
- Requirement: the kit's marked AGENTS.md block (installed by M1) carries these rules: batch reads and edits with the available file tools, no re-read to verify a write, correctness first; derive a Definition of Done before execution and verify against it; never hand-roll polling, follow the printed `next:` command, end the turn while waiting; never retry quota, credit, billing, auth or permission failures; never fabricate a stopped agent's judgment, use only verified facts; fix the product, not the fixture; preflight 2-3 items through every stage before a fan-out; scripts own mechanical bookkeeping; pass paths, not content; clean up only what the agent created; mark unobserved claims `[UNVERIFIED]`; write long documents in parts and never message the main session from a worker.
- Acceptance: kit test asserts the shipped block contains each rule's anchor sentence; block length stays under the size recorded in the test.
- Source: MTH-40, MTH-42, MTH-43, MTH-44, MTH-63, HIS-38, HIS-55, D-53, INV-18, INV-42, INV-45, INV-46.
- Scope: v1

### HARN-15 Shipped prompt-text changes and changelog
- Requirement: a change to shipped prompt text (AGENTS.md block, skill texts, agent overlays, watchdog steering texts) lands only with a CHANGELOG entry that names the owner's approval and date and the evidence; CHANGELOG entries are dated, name the decision and the measured check, keep an Unreleased section, and the top released section matches `kit.json` version.
- Acceptance: release check script fails when `kit.json` version and the top CHANGELOG section differ, and when a commit touching shipped prompt files has no CHANGELOG line in the same commit.
- Source: HIS-39, HIS-67, D-35, INV-49.
- Scope: v1

### HARN-16 Harness licence and notice
- Requirement: `.claude/skills/harness/` ships `LICENSE` (Apache-2.0) and `NOTICE.md` (upstream repo, version 2.1.0, commit, the port's changes and the kit's adapter-layer edits) while any Harness-derived text ships.
- Acceptance: install check asserts both files exist in an installed project.
- Source: MTH-65, D-54.
- Scope: v1

### HARN-17 ai-orchestrator skill
- Requirement: `.claude/skills/ai-orchestrator/` ships with its method text (Definition of Done, waiting rule) carried; adapter-layer edits only: the agent limit reads `max_subagents` from config instead of a fixed number, and Backlog wording is removed.
- Acceptance: HARN-01 diff test passes for the skill; grep finds no literal `20` agent limit and no `backlog`.
- Source: MTH-61, MTH-63, D-111, D-53.
- Scope: v1

### HARN-18 Mechanical structure checks of generated workflows and orchestrators
- Requirement: within the HARN-05 scope lint checks generated workflow scripts and orchestrator skills mechanically: `meta` is a literal with `name` and `description`; every `phase()` title appears in `meta.phases`; every `agentType` resolves (HARN-07); a value from `agent()` or `parallel()` that is used as an array is guarded against `null` (`.filter(Boolean)` or an explicit check; warning when unguarded); an orchestrator skill states its execution mode at the top, each stage of a mixed one is labelled, and it has a `## Test scenarios` section with a normal and an error flow; semantic checks of the method (connected stage inputs and outputs, mode handoffs, dry run) stay a named manual check recorded in the history row.
- Acceptance: lint fixtures: a `phase('Build')` absent from `meta.phases` fails; a mixed orchestrator with an unlabelled stage fails; a missing `## Test scenarios` fails; an unguarded `parallel()` result warns.
- Source: MTH-46, MTH-51, MTH-54, MTH-35.
- Scope: v1

## M12 adapter (ADPT)

The adapter is project data: written by the harness (HARN-03), evolved by `harness-evolve` (HARN-12), read by M8, M9 and M10. The kit defines its contract and ships neutral defaults only (D-110).

### ADPT-01 Location and loading
- Requirement: the adapter lives in the sections `adapter` and `gsd` of `.agents/harness.config.json` (project overlay) with kit defaults in `.agents/harness.defaults.json`, merged per entry and validated closed by the one M3 loader (unknown key: `invalid harness config <key>: <msg>`); no GSD code reads `.planning/config.json`.
- Acceptance: fixture overlay with `adapter.unknown_key` makes every `ph gsd` verb fail with the message (except `ph doctor`, which reports it); a `.planning/config.json` with different values has no effect.
- Source: D-77, UPS-77, UPS-03, RUN-06.
- Scope: v1

### ADPT-02 `adapter.commands`
- Requirement: `adapter.commands` = `{build: argv|null, test: argv|null, build_timeout_s: 300, test_timeout_s: 600, gates: [{name, argv}], verify: {<kind>: {argv, timeout_s}}}`; commands are argv arrays run without a shell, from the code root; a null build or test is reported by the gate as `not configured` and never counted green.
- Acceptance: fixture adapter with `test: null`: the post-wave gate reports `test not configured` and blocks tracking; argv containing `;` is passed as one argument.
- Source: UPS-47, GSP-18, D-63, D-95.
- Scope: v1

### ADPT-03 `adapter.verify_vocabulary`
- Requirement: `adapter.verify_vocabulary` = `{<kind>: {prefix, parser: path|null, resolver: path|null, runner: <commands.verify key>, evidence_parser: path|null, exit_code_sufficient: bool}}`; `<automated>` text starting with a registered prefix has that kind; the text after the prefix is the obligation `argument`; the parser (ADPT-15 `parse` request) turns it into `targets[]` (default: one target, the trimmed argument); the resolver (ADPT-15 `resolve` request) answers per target `ok|pending_creation|missing|unresolvable`, and the core itself sets `pending_shared` when a missing target is created by a plan's `<shared_changes>`; the runner is the `commands.verify` argv in which the placeholders `{argument}` and `{targets}` (each target one argv element) are substituted, no shell; `evidence_parser` (ADPT-15 `evidence` request) turns runner output into the ADPT-17 executed list; a kind with `exit_code_sufficient: true` (default only for `build` and `cmd`) may certify by exit code alone; the default vocabulary is `{build, cmd}` with `cmd` resolving the first path-like token against the code root.
- Acceptance: fixture adapter adding kind `test:` with parser, resolver and evidence parser scripts: a filter the resolver cannot find is `missing`; a target created in `<shared_changes>` is `pending_shared`; a target containing spaces reaches the runner as one argv element; with the default vocabulary only `build` and `cmd:` validate and `test:` is a blocker.
- Source: GSP-18, GSP-19, HIS-84, D-61.
- Scope: v1

### ADPT-04 `adapter.ownership`
- Requirement: `adapter.ownership` = `{owns_forms: [{prefix, maps_to: path-glob}], shared: {globs[], predicate: path|null}, source_roots[]}`; default `owns_forms` is `[{prefix: "Path:", maps_to: "<path>"}]` with no shared globs; `check owns`, `outline check` and `plan-structure` use only this section for owns syntax and shared files.
- Acceptance: fixture adapter with `shared.globs: ["**/*.lock"]`: a plan owning `Path:pkg/` that covers `pkg/a.lock` reports a shared-file problem; with defaults it does not.
- Source: GSP-23, HIS-85, D-61, D-110.
- Scope: v1

### ADPT-05 `adapter.review_lenses`
- Requirement: `adapter.review_lenses` = `[{name, text, stage: skeleton|plan_review|code (default code), applies_to: globs (default all files)}]` supplies the code-review lenses (GSDF-46) and may add skeleton or plan-review lenses (`stage: skeleton|plan_review|code`); with no project lens the code review uses one kit lens `correctness`.
- Acceptance: fixture adapter with lenses `security` and `perf` renders both into reviewer prompts for matching files only.
- Source: D-56, D-63, D-68, HIS-51.
- Scope: v1

### ADPT-06 `adapter.syntax_checkers`
- Requirement: `adapter.syntax_checkers` = `{<extension>: {argv, timeout_s, max_parallel}}` is read by the kit syntax-check hook shell (M8) from the tree of the edited file; an extension without a checker is skipped before anything is spawned; the checker command must print `file:line:col: message` lines and exit non-zero on a syntax error.
- Acceptance: fixture adapter with `.json` -> a node one-liner checker: an edit that breaks a JSON file is reported once by the hook; a `.txt` edit spawns no process.
- Source: HOK-26, HOK-27, D-45, INV-27.
- Scope: v1

### ADPT-07 `adapter.instructions`
- Requirement: `adapter.instructions` lists repo-relative project instruction files (coding rules, layout); they appear in planner, checker and executor required reading and are hashed into the `research` and `freeze` revision keys.
- Acceptance: fixture: editing a listed file makes `revisions check freeze` exit 1; the file path appears in the planner prompt.
- Source: GSP-29, GSP-44, D-61.
- Scope: v1

### ADPT-08 `adapter.envelope`
- Requirement: optional `adapter.envelope` = `[{axis, values|range, source}]`; when present, executor briefs list the axes and the code-review prompt adds the rule "judge a fix against the declared envelope, not one sample point"; when absent both are omitted.
- Acceptance: fixture prompts with and without an envelope differ exactly by the axes block and the rule line.
- Source: HIS-61.
- Scope: v1

### ADPT-09 Project agents and stack skill
- Requirement: `adapter.stack_skill` names one project skill in `.claude/skills/<stack>/` that executor and fixer prompts tell the agent to follow; `adapter.agents` maps GSD roles to project agent types that replace the generic agent for that role (`architect` enables the wiring stage, GSDF-20; `executor`, `reviewer`, `fixer` optional); every named skill and agent must exist (HARN-07).
- Acceptance: fixture adapter with `stack_skill: web-stack` renders "Follow the web-stack skill" in executor prompts; `agents.executor: my-coder` makes the execute run spawn `--type my-coder`; a missing agent file fails lint.
- Source: D-109, D-63, GSP-69, INGEST-CONFLICTS W-22.
- Scope: v1

### ADPT-10 `adapter.mutex`
- Requirement: optional `adapter.mutex` names a machine-wide lock; gate commands and fixer builds take it before running heavy commands so only one runs at a time across worktrees; waiting is reported in the run log.
- Acceptance: fixture: two concurrent gate runs with a mutex and a 2 s fake command finish in at least 4 s with one `waiting for mutex` line.
- Source: HIS-62, D-81.
- Scope: v1

### ADPT-11 `gsd.roles` and model precedence
- Requirement: `gsd.roles` maps roles (`research`, `project_researcher`, `synthesizer`, `outline`, `planner`, `checker`, `skeleton_lane`, `architect`, `plan_finder`, `plan_verifier`, `plan_judge`, `plan_editor`, `executor`, `reviewer`, `finding_verifier`, `fixer`, `verifier`, `mapper`, `roadmapper`, `debugger`) to `{model: tier|provider/model, effort, reason}`; every GSD flow passes the role name with each agent call (GSDF-18) and resolution follows PHCL-22: per-run argument > role table > agent `model:` > `default_tier`, model and effort independently; a role name outside this list and the table is invalid (usage error or configuration throw); a listed role with no entry falls back to the next layer; skeleton lanes may carry their own `model`/`effort` in `gsd.skeleton_lanes[]`, applied as per-run arguments; the kit defaults name tiers only, never a concrete model id.
- Acceptance: cross-module resolution matrix: role entry present, absent, effort-only; per-run override; per-lane override; plan-review finder and judge dispatch carry roles `plan_finder` and `plan_judge`; setting `roles.checker.model` changes the checker's model with no script edit; an unknown role name is rejected; a scan of the defaults finds no `provider/model` id in `gsd.roles`.
- Source: GSP-43, GSP-79, HIS-19, HIS-74, UPS-78, D-16, R-10.
- Scope: v1

### ADPT-12 `gsd.granularity` and `gsd.plan_limits`
- Requirement: `gsd.granularity` `coarse|standard|fine` (default `standard`) is passed to planners; `gsd.plan_limits` = `{tasks_per_plan: 3, plans_per_phase: 12, waves_per_phase: 4}` (conservative defaults) is enforced by `outline check` (plan and wave ceilings) and `plan-structure` (task count, warning); a phase may override limits through the plan args recorded from its CONTEXT; the kit text gives split reasons (overlapping owns in one wave, an ordering coupling, a gating spike, a plan too big for one coder context), not "prefer more, smaller plans".
- Acceptance: fixture plan with 4 tasks warns; an outline of 13 plans fails under defaults and passes with a per-phase override of 15.
- Source: GSP-60, GSP-84, D-70, INGEST-CONFLICTS I-02.
- Scope: v1

### ADPT-13 `gsd` section keys and defaults
- Requirement: the `gsd` section holds exactly: `roles`, `granularity`, `plan_limits`, `execution_mode` (`per-wave`), `batch_review` (true), `isolation` (`shared`|`worktree`, default `worktree`), `fixer_verifies_itself` (true), `max_verify_rounds` (4), `commit_policy {docs: false, code: per-wave}`, `branching` (`none`), `protected_branches` ([]), `requirement_id_regex`, `research` (true; false makes plan mode treat research as skipped with reason `gsd.research off`), `plan_review` (false), `skeleton_lanes` ([{lens, model?, effort?}]), `max_skeleton_passes` (3), `max_check_iterations` (3), `drift_threshold` (3), `debug {max_turns: 16, minutes: 120}`, `fixer {max_build_attempts: 3, minutes: 60}`, `parallelization {enabled: true, max_concurrent: null}` (GSDF-93), `review_depth` (`standard`, GSDF-92); the `adapter` section additionally holds `startup_globs` ([], GSDF-57), `hook_timeout_s` (30) and `attribution` (path|null) (ADPT-15); ranges are validated (passes and iterations 1..3).
- Acceptance: fixture overlay with `max_check_iterations: 4` fails validation; `ph config` shows every key with its provenance.
- Source: UPS-10, UPS-77, D-63, D-64, D-66, D-68, D-69, D-70, D-73, D-91.
- Scope: v1

### ADPT-14 Absent keys take the defaults
- Requirement: merge depth follows CONF-04: an overlay that omits a top-level `gsd` or `adapter` entry gets the kit default for that entry (so a new gate shipped default-on applies without a project edit); an entry the overlay sets replaces the default entry wholly, so a nested object (`commands`, `plan_limits`, `commit_policy`, `debug`, `fixer`, `parallelization`, a role entry) must be written whole; closed validation names any missing nested key; the harness generator and new-project write whole entries.
- Acceptance: fixture with an empty overlay resolves every documented default; overlay `gsd.plan_limits: {plans_per_phase: 15}` fails validation naming `tasks_per_plan` and `waves_per_phase`; a whole `plan_limits` entry changes only that entry; partial `commands`, `debug`, `fixer` and `commit_policy` overlays fail with the missing key named.
- Source: UPS-04, D-77.
- Scope: v1

### ADPT-15 Adapter hook invocation contract
- Requirement: adapter scripts are invoked without a shell: a `.mjs`/`.js` path as `[process.execPath, <abs script>]`, any other path as `[<abs script>]`; cwd = code root; timeout `adapter.hook_timeout_s` (default 30); stdin one JSON request `{v: 1, op, codeRoot, phaseDir?, ...}`; stdout one JSON line response `{v: 1, ...}`; the closed request/response shapes are: `parse` `{kind, argument}` -> `{targets: [string]}`; `resolve` `{kind, targets, plan, filesModified}` -> `{results: [{target, status: ok|pending_creation|missing|unresolvable, detail?}]}`; `shared` `{paths}` -> `{shared: [path]}` (ownership predicate, `adapter.ownership.shared.predicate`); `evidence` `{kind, argument, targets, exitCode, stdoutPath, stderrPath}` -> `{executed: {count, targets: [string]}, failed: [string], outcome: passed|failed|unavailable}`; `attribute` `{failures: [{text, file?}], plans: [{id, owns}]}` -> `{assignments: [{failure, plan|null}]}` (`adapter.attribution`); a non-zero exit, timeout, a response with another `v`, missing fields or unparsable output makes the calling check `unresolvable` (exit 69 for a verb, a failure for a gate), never a pass.
- Acceptance: a fixture adapter implemented only from this contract is exercised by planning (`parse`, `resolve`, `shared`) and execution (`evidence`, `attribute`), with the code root path containing spaces; a resolver that sleeps past the timeout, one that prints garbage and one returning `v: 2` all make `check verify-command-paths` report `unresolvable` and the checker loop count it as a warning, not ok.
- Source: D-61, GSP-19, INV-36.
- Scope: v1

### ADPT-16 The kit ships no project adapter
- Requirement: shipped defaults carry a neutral adapter (`commands` null, default vocabulary, default ownership, no lenses beyond `correctness`, no checkers, no envelope, no mutex, no stack skill, no project agents); no project's adapter, stack skill or project agent ships.
- Acceptance: kit test compares the shipped `adapter` section with the neutral form and greps `ship/` for the vanilla deny list (GSDC-50).
- Source: D-110, P9, SYNTHESIS M12 acceptance.
- Scope: v1

### ADPT-17 Gate-evidence contract
- Requirement: every gate run (GSDF-44) writes `<phaseDir>/evidence/<waveId>-<n>.json` `{v: 1, waveId, at, inputs: {head, files: {<path>: sha256}} (owned files of the wave's plans and adapter instructions at run time), steps: [{name build|test|<obligation id>, plan?, task?, kind?, argv, outcome passed|failed|timeout|unavailable|not_configured, exitCode, executed: {count|null, targets[]}, log}]}`; an obligation step's `executed` comes from the kind's `evidence_parser` or, for `exit_code_sufficient` kinds, is `null` with the exit code deciding; evidence certifies green only when it parses, every requested step is present, no step is timeout, unavailable or not_configured, every obligation that names targets executed at least one and no named target is missing, and `inputs` equals the current code; otherwise it is invalid, incomplete or stale and never certifies green, closes a debug session or counts as verify proof.
- Acceptance: fixture: a test runner that exits 0 after executing 0 tests yields a failed obligation; evidence whose `inputs` differ from the tree after a fixer edit is stale for the gate, the verifier and debug close; a log path that does not exist makes the evidence invalid.
- Source: HIS-82, HIS-84, UPS-47, INV-53, D-61.
- Scope: v1

## Later

Listed without acceptance; not in v1.

- GSDC-51 Planning snapshot verb and best-effort `.planning/state.json` publish (null, never guessed) - Source: UPS-82 - Scope: later
- GSDC-52 Cross-phase verification-debt audits `audit-uat`, `audit-open` - Source: UPS-55 - Scope: later
- GSDF-68 spec-phase ambiguity gate - Source: UPS-14, D-92 - Scope: later
- GSDF-69 ingest-docs (ADR/PRD import with conflict report) - Source: UPS-13 - Scope: later
- GSDF-70 Nyquist validation strategy and threat-model ASVS gate - Source: UPS-22 - Scope: later
- GSDF-71 UI design contract gate - Source: UPS-23 - Scope: later
- GSDF-72 Pattern mapper before planning - Source: UPS-24 - Scope: later
- GSDF-73 TDD gate - Source: UPS-53 - Scope: later
- GSDF-74 Autonomous milestone driver (single gap retry, retry ceiling 3, deferred rows) - Source: UPS-59 - Scope: later
- GSDF-75 `ph ship` through GitHub PRs (adapter flag) - Source: UPS-61, D-90 - Scope: later
- GSDF-76 Milestone lifecycle (audit, complete with dry-run default, new milestone, cleanup) - Source: UPS-62, D-93 - Scope: later
- GSDF-77 Dynamic routing with soft-failure tier escalation - Source: UPS-79 - Scope: later
- GSDF-78 Workstreams, workspaces, multi-repo - Source: UPS-85, D-93 - Scope: later
- GSDF-79 assumption-delta and API-coverage planning gates (fail closed on unresolvable scope) - Source: UPS-92 - Scope: later
- GSDF-80 Package legitimacy gate with registry thresholds - Source: UPS-93, UPS-20 - Scope: later
- GSDF-81 Supervised debug engine (tree digest, typed requests, budgets per run, deadline supervisor, snapshot revert/reapply, acceptance transactions, lease) - not part of the kit per D-78 - Source: GDB-02, GDB-03, GDB-13..21, GDB-25, GDB-27..30, GDB-33..44, GDB-47, GDB-49, GDB-57, GDB-60, GDB-61, GDB-63..68, HIS-56, HIS-79..82, GSP-40, D-78, D-79..D-88 - Scope: later
- GSDF-82 quick-batch - Source: D-76 - Scope: later
- GSDF-83 Discuss modes batch, analyze, all, auto, chain - Source: UPS-15 - Scope: later
- GSDF-84 Codebase drift auto-remap - Source: UPS-12 - Scope: later
- GSDF-85 Execute `--interactive` inline mode - Source: UPS-91 - Scope: later
- GSDF-86 Non-blocking post-planning gap table - Source: UPS-31 - Scope: later
- GSDF-87 Cross-model reviewer lanes as `ph` workers on other `circle` models - Source: UPS-36 - Scope: later
- GSDF-88 Fact-drift review axis (STATE vs ROADMAP vs PLAN consistency) - Source: UPS-35 - Scope: later
- GSDF-89 Utility workflows: node-repair, stats, session-report, validate-phase, secure-phase, add-tests, extract-learnings, docs-update, analyze-dependencies, scan - Source: UPS-63 - Scope: later
- GSDF-90 Symbol-to-owns plan check (tests using a changed symbol join the plan's owns) - Source: HIS-63 - Scope: later
- GSDF-91 Browser/DOM UAT branches - Source: UPS-54 - Scope: later

## Traceability

One row per behavior absorbed by M9..M12 (SYNTHESIS module table), plus the upstream (UPS), method (MTH) and debug (GDB) behaviors no other module absorbs.

| map behavior ID | requirement ID(s) |
| --- | --- |
| UPS-01 | GSDF-02 |
| UPS-02 | GSDF-01, GSDC-17 |
| UPS-03 | GSDC-01, ADPT-01 |
| UPS-04 | ADPT-14 |
| UPS-05 | GSDC-06 |
| UPS-06 | GSDF-07 |
| UPS-07 | GSDF-07, GSDF-95 |
| UPS-08 | GSDF-08, GSDC-01 |
| UPS-09 | GSDF-09 |
| UPS-10 | GSDF-07, ADPT-13 |
| UPS-11 | GSDF-05 |
| UPS-12 | GSDF-06, GSDF-84 (later) |
| UPS-13 | GSDF-69 (later) |
| UPS-14 | GSDF-68 (later) |
| UPS-15 | GSDF-10, GSDF-11, GSDF-83 (later) |
| UPS-16 | GSDC-21, GSDF-10 |
| UPS-17 | GSDF-10 |
| UPS-18 | GSDF-35, GSDC-17 |
| UPS-19 | GSDF-33 |
| UPS-20 | GSDF-12, GSDF-80 (later) |
| UPS-21 | GSDF-13 |
| UPS-22 | GSDF-70 (later) |
| UPS-23 | GSDF-71 (later) |
| UPS-24 | GSDF-72 (later) |
| UPS-25 | GSDF-17, GSDC-20 |
| UPS-26 | GSDF-24 |
| UPS-27 | GSDF-34, GSDF-01 |
| UPS-28 | GSDF-26 |
| UPS-29 | GSDF-27 |
| UPS-30 | GSDC-22, GSDF-29 |
| UPS-31 | GSDF-36, GSDF-86 (later) |
| UPS-32 | GSDF-03 |
| UPS-33 | not a requirement: dropped (plan bounce replaced by the plan-review stage, D-66) |
| UPS-34 | GSDF-37 |
| UPS-35 | GSDF-37, GSDF-88 (later) |
| UPS-36 | not a requirement: external review CLIs dropped (Claude Code only); cross-model lanes are GSDF-87 (later) |
| UPS-37 | GSDF-30, GSDF-93 |
| UPS-38 | not a requirement: capability/loop-hook system dropped (SYNTHESIS M9 dropped list) |
| UPS-39 | GSDC-25, GSDF-17 |
| UPS-40 | GSDC-17, GSDF-93 |
| UPS-41 | GSDF-38, GSDC-39 |
| UPS-42 | GSDC-36, GSDF-39 |
| UPS-43 | GSDF-40 |
| UPS-44 | GSDF-41, GSDF-94 |
| UPS-45 | GSDF-42, GSDF-94 |
| UPS-46 | GSDF-43 |
| UPS-47 | GSDF-44, GSDC-41, ADPT-02 |
| UPS-48 | GSDF-45 |
| UPS-49 | GSDF-42 |
| UPS-50 | GSDF-56 |
| UPS-51 | GSDC-15, GSDF-58 |
| UPS-52 | GSDF-54 |
| UPS-53 | GSDF-73 (later) |
| UPS-54 | GSDF-57, GSDC-16, GSDF-91 (later) |
| UPS-55 | GSDC-16, GSDF-57, GSDC-52 (later) |
| UPS-56 | GSDF-61 |
| UPS-57 | GSDF-61 |
| UPS-58 | GSDF-46, GSDF-92 |
| UPS-59 | GSDF-74 (later) |
| UPS-60 | GSDF-59 |
| UPS-61 | GSDF-75 (later) |
| UPS-62 | GSDF-76 (later) |
| UPS-63 | GSDF-58, GSDF-60, GSDF-62, GSDC-15, GSDC-42, GSDF-89 (later) |
| UPS-64 | GSDF-04, GSDC-45 |
| UPS-65 | not a requirement: dropped (compact variants never reach Claude Code agents) |
| UPS-66 | GSDC-04, GSDC-37, GSDC-40, GSDC-41 |
| UPS-67 | GSDC-02 |
| UPS-68 | GSDC-10, GSDC-11 |
| UPS-69 | GSDC-10, GSDC-12 |
| UPS-70 | GSDC-13, GSDC-08, GSDF-59 |
| UPS-71 | GSDC-14 |
| UPS-72 | GSDC-34 |
| UPS-73 | GSDC-02, GSDC-35 |
| UPS-74 | GSDC-39, GSDF-53 |
| UPS-75 | GSDC-07, GSDC-09 |
| UPS-76 | GSDC-18 |
| UPS-77 | ADPT-01, ADPT-13 |
| UPS-78 | ADPT-11 |
| UPS-79 | GSDF-77 (later) |
| UPS-80 | not a requirement: dropped (multi-runtime tier maps; per-role models in ADPT-11) |
| UPS-81 | GSDC-38, GSDF-31 |
| UPS-82 | GSDC-51 (later) |
| UPS-83 | GSDC-42 |
| UPS-84 | not a requirement: hooks area (M8 context guard replaces the upstream monitor) |
| UPS-85 | GSDF-78 (later) |
| UPS-86 | not a requirement: dropped (host interface, capabilities, installer; owner Claude-only) |
| UPS-87 | GSDC-44, GSDC-53 |
| UPS-88 | GSDF-17 |
| UPS-89 | GSDF-42 |
| UPS-90 | GSDF-42, GSDF-93 |
| UPS-91 | GSDF-11, GSDF-85 (later) |
| UPS-92 | GSDF-79 (later) |
| UPS-93 | GSDF-80 (later) |
| UPS-94 | GSDC-40, GSDF-62 |
| GSP-01 | GSDC-44 |
| GSP-02 | GSDC-44 |
| GSP-03 | GSDC-45 |
| GSP-04 | GSDC-45 |
| GSP-05 | GSDC-46, GSDF-42 |
| GSP-06 | GSDC-46 |
| GSP-07 | GSDC-45 |
| GSP-08 | GSDC-45, GSDC-47 |
| GSP-09 | GSDC-47 |
| GSP-10 | GSDC-48 |
| GSP-11 | GSDC-04 |
| GSP-12 | GSDC-02 |
| GSP-13 | GSDC-05 |
| GSP-14 | GSDC-06 |
| GSP-15 | GSDC-07 |
| GSP-16 | GSDC-09 |
| GSP-17 | GSDC-18 |
| GSP-18 | GSDC-19, ADPT-03 |
| GSP-19 | GSDC-19, ADPT-15 |
| GSP-20 | GSDC-20 |
| GSP-21 | GSDC-21 |
| GSP-22 | GSDC-22 |
| GSP-23 | GSDC-23, ADPT-04, GSDF-41 |
| GSP-24 | GSDC-24 |
| GSP-25 | GSDC-25 |
| GSP-26 | GSDC-25, GSDC-27 |
| GSP-27 | GSDC-26 |
| GSP-28 | GSDC-27 |
| GSP-29 | GSDC-28, ADPT-07 |
| GSP-30 | GSDC-29 |
| GSP-31 | GSDC-30 |
| GSP-32 | GSDC-31 |
| GSP-33 | GSDC-32 |
| GSP-34 | GSDC-33 |
| GSP-35 | GSDC-34 |
| GSP-36 | GSDC-35 |
| GSP-37 | GSDC-17, GSDC-37 |
| GSP-38 | GSDF-15 |
| GSP-39 | GSDF-03 |
| GSP-40 | GSDF-81 (later; D-88 closed by D-78) |
| GSP-41 | GSDF-16 |
| GSP-42 | GSDF-14 |
| GSP-43 | GSDF-18, ADPT-11 |
| GSP-44 | GSDF-17, ADPT-07 |
| GSP-45 | GSDF-17 |
| GSP-46 | GSDF-01, GSDF-27 |
| GSP-47 | GSDF-19 |
| GSP-48 | GSDF-20 |
| GSP-49 | GSDF-21 |
| GSP-50 | GSDF-22 |
| GSP-51 | GSDF-21 |
| GSP-52 | GSDF-23 |
| GSP-53 | GSDF-24 |
| GSP-54 | GSDF-25 |
| GSP-55 | GSDF-26 |
| GSP-56 | GSDF-29 |
| GSP-57 | GSDF-30 |
| GSP-58 | GSDF-31, GSDC-38 |
| GSP-59 | GSDC-45 |
| GSP-60 | ADPT-12, GSDC-25 |
| GSP-61 | GSDF-12 |
| GSP-62 | GSDF-13 |
| GSP-63 | GSDF-12 |
| GSP-64 | GSDF-55 |
| GSP-65 | GSDC-34 |
| GSP-66 | not a requirement: code-wave dropped (D-109); its generic contract is in GSDC-27, GSDF-42, GSDF-44 |
| GSP-67 | not a requirement: code-wave dropped (D-109); the gate rules are GSDF-46 |
| GSP-68 | not a requirement: dropped (project-specific packet gate; D-110) |
| GSP-69 | GSDF-04 |
| GSP-70 | GSDF-10 |
| GSP-71 | GSDF-02 |
| GSP-72 | GSDC-10, GSDC-12 |
| GSP-73 | GSDC-01 |
| GSP-74 | GSDC-24 |
| GSP-75 | GSDF-01, GSDF-28 |
| GSP-76 | GSDF-32 |
| GSP-77 | GSDC-50 |
| GSP-78 | GSDC-49, GSDF-53 |
| GSP-79 | ADPT-11 |
| GSP-80 | GSDF-37 |
| GSP-81 | GSDF-49 |
| GSP-82 | GSDC-03 |
| GSP-83 | not a requirement: documentation drift settled by D-74, D-75 (applied in GSDF-15, GSDF-27, GSDC-28) |
| GSP-84 | GSDC-25, ADPT-12 |
| GSP-85 | GSDF-49 |
| GSP-86 | GSDF-49 |
| GDB-01 | GSDF-64 |
| GDB-02 | GSDF-81 (later, D-78, D-85) |
| GDB-03 | GSDF-81 (later, D-78, D-85) |
| GDB-04 | not a requirement: closed by D-85; INV-54 applies only where the kit restores files, none in M9-M12 v1 (undo uses `git revert`) |
| GDB-05 | GSDF-38 |
| GDB-06 | GSDF-64, GSDC-01 |
| GDB-07 | GSDC-43 |
| GDB-08 | GSDC-43 |
| GDB-09 | GSDC-43 |
| GDB-10 | GSDC-43 |
| GDB-11 | GSDC-43 |
| GDB-12 | GSDC-43 |
| GDB-13 | GSDF-81 (later, D-78, D-79) |
| GDB-14 | GSDF-81 (later, D-78) |
| GDB-15 | GSDF-81 (later, D-78) |
| GDB-16 | GSDF-81 (later, D-78) |
| GDB-17 | GSDF-81 (later, D-78) |
| GDB-18 | GSDF-81 (later, D-78) |
| GDB-19 | GSDF-81 (later, D-78) |
| GDB-20 | GSDF-81 (later, D-78) |
| GDB-21 | GSDF-81 (later, D-78) |
| GDB-22 | GSDF-64, GSDC-46 |
| GDB-23 | GSDF-65 |
| GDB-24 | GSDF-65, GSDC-43 |
| GDB-25 | GSDF-81 (later, D-78) |
| GDB-26 | GSDF-66 |
| GDB-27 | GSDF-81 (later, D-78, D-86) |
| GDB-28 | GSDF-81 (later, D-78) |
| GDB-29 | GSDF-81 (later, D-78) |
| GDB-30 | GSDF-81 (later, D-78) |
| GDB-31 | GSDF-67 |
| GDB-32 | GSDC-43 |
| GDB-33 | GSDF-81 (later, D-78, D-81) |
| GDB-34 | GSDF-81 (later, D-78) |
| GDB-35 | GSDF-81 (later, D-78) |
| GDB-36 | GSDF-81 (later, D-78) |
| GDB-37 | GSDF-81 (later, D-78) |
| GDB-38 | GSDF-81 (later, D-78) |
| GDB-39 | GSDF-81 (later, D-78) |
| GDB-40 | GSDF-81 (later, D-78) |
| GDB-41 | GSDF-81 (later, D-78) |
| GDB-42 | GSDF-81 (later, D-78) |
| GDB-43 | GSDF-81 (later, D-78) |
| GDB-44 | GSDF-81 (later, D-78) |
| GDB-45 | GSDC-45 |
| GDB-46 | GSDF-66 |
| GDB-47 | GSDF-81 (later, D-78) |
| GDB-48 | GSDF-66 |
| GDB-49 | GSDF-81 (later, D-78, D-79) |
| GDB-50 | GSDF-64 |
| GDB-51 | GSDF-64, GSDF-65 |
| GDB-52 | GSDF-63 |
| GDB-53 | GSDF-63 |
| GDB-54 | GSDC-47 |
| GDB-55 | not a requirement: `state.json` is not carried (D-82); one status vocabulary in the session file |
| GDB-56 | GSDC-02 |
| GDB-57 | GSDF-81 (later, D-78) |
| GDB-58 | GSDC-43, GSDF-64 |
| GDB-59 | GSDF-66 |
| GDB-60 | GSDF-81 (later, D-78) |
| GDB-61 | GSDF-81 (later, D-78) |
| GDB-62 | GSDF-64 |
| GDB-63 | GSDF-81 (later, D-78) |
| GDB-64 | GSDF-81 (later, D-78) |
| GDB-65 | GSDF-81 (later, D-78) |
| GDB-66 | GSDF-81 (later, D-78) |
| GDB-67 | GSDF-81 (later, D-78) |
| GDB-68 | GSDF-81 (later, D-78) |
| MTH-01 | HARN-01, HARN-02 |
| MTH-02 | HARN-01 |
| MTH-03 | HARN-01 |
| MTH-04 | HARN-01, HARN-03 |
| MTH-05 | HARN-01, HARN-06 |
| MTH-06 | HARN-01 |
| MTH-07 | HARN-01 |
| MTH-08 | HARN-01 |
| MTH-09 | HARN-01 |
| MTH-10 | HARN-07, HARN-03 |
| MTH-11 | HARN-01, HARN-03 |
| MTH-12 | HARN-08, HARN-02 |
| MTH-13 | HARN-08, HARN-02 |
| MTH-14 | HARN-01, HARN-05 |
| MTH-15 | HARN-01 |
| MTH-16 | HARN-01 |
| MTH-17 | HARN-01 |
| MTH-18 | HARN-01 |
| MTH-19 | HARN-01 |
| MTH-20 | HARN-01 |
| MTH-21 | HARN-02 |
| MTH-22 | HARN-05 |
| MTH-23 | HARN-05 |
| MTH-24 | HARN-05 |
| MTH-25 | HARN-01 |
| MTH-26 | HARN-01 |
| MTH-27 | HARN-05 |
| MTH-28 | HARN-01 |
| MTH-29 | HARN-09 |
| MTH-30 | HARN-01 |
| MTH-31 | HARN-01 |
| MTH-32 | HARN-01 |
| MTH-33 | HARN-01 |
| MTH-34 | HARN-01 |
| MTH-35 | HARN-01 |
| MTH-36 | HARN-01 |
| MTH-37 | HARN-01 |
| MTH-38 | HARN-01 |
| MTH-39 | HARN-01 |
| MTH-40 | HARN-14 |
| MTH-41 | HARN-01 |
| MTH-42 | HARN-14 |
| MTH-43 | HARN-14 |
| MTH-44 | HARN-14 |
| MTH-45 | HARN-01 |
| MTH-46 | HARN-05, HARN-06, HARN-07, HARN-18 |
| MTH-47 | HARN-10 |
| MTH-48 | HARN-10 |
| MTH-49 | HARN-01 |
| MTH-50 | HARN-01 |
| MTH-51 | HARN-01 |
| MTH-52 | HARN-10 |
| MTH-53 | HARN-01 |
| MTH-54 | HARN-05, HARN-18 |
| MTH-55 | HARN-11 |
| MTH-56 | HARN-01 |
| MTH-57 | HARN-12 |
| MTH-58 | HARN-12 |
| MTH-59 | HARN-12 |
| MTH-60 | HARN-13 |
| MTH-61 | HARN-17 |
| MTH-62 | HARN-03 |
| MTH-63 | HARN-14, HARN-17 |
| MTH-64 | GSDF-46 |
| MTH-65 | HARN-16 |
| MTH-66 | HARN-01 |
| MTH-67 | HARN-01 |
| MTH-68 | HARN-01 |
| MTH-69 | HARN-02 |
| MTH-70 | HARN-02 |
| MTH-71 | GSDF-48 |
| MTH-72 | HARN-06 |
| MTH-73 | HARN-02 |
| HIS-19 | ADPT-11, GSDF-18 |
| HIS-38 | HARN-14 |
| HIS-39 | HARN-15 |
| HIS-42 | GSDC-49 |
| HIS-43 | GSDC-44, GSDC-47 |
| HIS-44 | GSDF-02 |
| HIS-45 | GSDF-21, GSDF-22 |
| HIS-46 | GSDF-26, GSDF-28 |
| HIS-47 | GSDC-28 |
| HIS-48 | GSDF-32, GSDC-30 |
| HIS-49 | GSDC-10, GSDC-12 |
| HIS-50 | GSDF-37 |
| HIS-51 | GSDF-46, GSDF-48 |
| HIS-52 | not a requirement: superseded by HIS-51 (no review fix-round key in config) |
| HIS-53 | GSDF-47 |
| HIS-54 | GSDF-50 |
| HIS-55 | GSDF-66, HARN-14 |
| HIS-56 | GSDF-81 (later, D-78) |
| HIS-57 | GSDF-67 (engine lessons later in GSDF-81) |
| HIS-58 | GSDF-52 |
| HIS-59 | GSDF-51 |
| HIS-60 | GSDF-20, GSDC-27 |
| HIS-61 | ADPT-08 |
| HIS-62 | ADPT-10 |
| HIS-63 | GSDF-90 (later; project parts dropped, D-110) |
| HIS-66 | HARN-13 |
| HIS-67 | HARN-15 |
| HIS-68 | HARN-11 |
| HIS-69 | GSDC-10 |
| HIS-70 | GSDC-10, GSDF-60 |
| HIS-74 | ADPT-11 |
| HIS-79 | GSDF-81 (later, D-78) |
| HIS-80 | GSDF-81 (later, D-78) |
| HIS-81 | GSDF-67 (engine contracts later in GSDF-81) |
| HIS-82 | GSDF-44, ADPT-17 (validators; engine later in GSDF-81) |
| HIS-83 | not a requirement: code-wave result schema dropped (D-109); cache-key rule owned by M6 (D-29) |
| HIS-84 | GSDF-44, ADPT-17 |
| HIS-85 | GSDC-23, ADPT-04 |
| HIS-86 | GSDC-49, GSDF-10, GSDF-12 |
| HOK-26 | ADPT-06 |
| HOK-27 | ADPT-06 |
| WFL-46 | GSDF-46 |

## Counts

| item | count |
| --- | --- |
| v1 requirements | 157 (GSDC 51, GSDF 71, HARN 18, ADPT 17) |
| later items | 26 (GSDC 2, GSDF 24) |
| behaviors traced | 363 (UPS 94, GSP 86, GDB 68, MTH 73, HIS 39, HOK 2, WFL 1) |
| behaviors traced to a v1 requirement | 290 |
| behaviors traced only to later items | 58 |
| behaviors not a requirement | 15 |

## Revision log r1

| finding ID | accepted / rejected | what changed (requirement IDs) or why rejected |
| --- | --- | --- |
| SR-MTD-01 | accepted | GSDC-45: strict snapshot validation before the first output write, failure leaves generated files unchanged; GSP-08 traced to GSDC-45 and GSDC-47. |
| SR-MTD-02 | accepted | GSDF-22: `both` routing, architect realignment after outline revisions, first-edge wiring creation plus integration blocker, no-architect fallback; new acceptance cases. |
| SR-MTD-03 | accepted | GSDF-38: execute baseline file and working-tree reconciliation (uncommitted owned edits, untracked files, unauthorized paths, root/HEAD drift) before every dispatch; no snapshot engine (D-78 kept). |
| SR-MTD-04 | accepted | GSDF-57: claim reconciliation through commits.json and gate evidence, cold-start test injection by `adapter.startup_globs`, resolved-gap reconciliation on resume; ADPT-13 key. |
| SR-MTD-05 | accepted | New GSDF-92 (scope precedence, SUMMARY cross-check, exclusions, review record schema, `<NN>-REVIEW.md`); GSDF-46 references it; one-pass D-56 gate kept; UPS-58 traced to GSDF-46, GSDF-92. |
| SR-MTD-06 | accepted | New GSDF-93 (execute args, `--gaps-only` key refusal, `gsd.parallelization`, per-run state, auto-chain flag not used); ADPT-13 keys; UPS-37, UPS-40, UPS-90 traces. |
| SR-MTD-07 | accepted | New HARN-18 (mechanical workflow/orchestrator checks; semantic checks a named manual check); HARN-05 Write-without-Edit warning; MTH-49, MTH-50 traced to HARN-01 (carried testing guide); MTH-14, MTH-46, MTH-54 traces updated; A/B stays optional. The proposed iteration-overwrite test is not added: iterations are an agent procedure in carried method text, not kit code. |
| SR-MTD-08 | accepted | ADPT-15 rewritten with invocation (no shell, interpreter rule), versioned closed request/response shapes (`parse`, `resolve`, `shared`, `evidence`, `attribute`), timeout key; ADPT-03 parser/runner/placeholder binding and core-set `pending_shared`; ADPT-05 `stage` and defaults; ADPT-13 `hook_timeout_s`, `attribution`; GSDF-51 uses `attribute`. |
| SR-MTD-09 | accepted | New ADPT-17 gate-evidence contract (inputs identity, steps, executed counts, outcome, logs, certification rule); GSDF-44, GSDF-55, GSDF-67 consume it; HIS-82, HIS-84 traced. |
| SR-MTD-10 | accepted | GSDC-13: ordered truth table with completion record `complete.json` and plan halt records and their writers; truth-table acceptance through find-phase, roadmap analyze and router; GSDC-36 defines `halted`, `blocked_by`, `ready`. |
| SR-MTD-11 | accepted | GSDC-30: field meanings and key from the host-given `ph workflow` run id (resume keeps it, fresh run gets a new one; no UUID machinery, consistent with D-67/D-87); GSDF-12 fresh-versus-resume rule and tests. |
| SR-MTD-12 | accepted | GSDC-12, GSDF-01, GSDF-50, GSDC-50: bans scoped to kit-authored files and runtime blocks, upstream bodies unchanged with last-applied overlays; HARN-01: inventoried adapter regions with recorded replacements, NOTICE alone does not admit a hunk. |
| SR-MTD-13 | accepted | GSDF-30: gap handoff without tracer split and exactly one execution wave, multi-wave -> needs-owner before dispatch, `waveExecuted` persisted in the attempt (GSDC-30). |
| SR-MTD-14 | accepted | GSDF-50: fixer attempt/time/no-progress bounds, structured unresolved result, orchestrator deadline; GSDF-67: turn defined, budget persisted in session frontmatter, per-turn wait timeout; ADPT-13 `fixer` keys. |
| SR-MTD-15 | accepted | New GSDF-94 worktree transfer transaction; GSDF-41 integrates through it; workers still never commit. |
| SR-MTD-16 | accepted | GSDF-53 `Plans:` trailer and `commits.json`; GSDC-39 wave scopes and per-plan file mapping; GSDC-40 `shared` marking; GSDF-62 refuses a partial revert of a shared wave commit. |
| SR-MTD-17 | accepted | New GSDF-95 roadmapper draft contract (overlay redirect to `.planning/drafts/`, orchestrator install after approval); GSDF-07 and GSDC-01 updated; UPS-07 traced. |
| SR-MTD-18 | accepted | GSDF-49 one stage sequence per mode with the W-18 phase-level review; GSDF-47 per-wave only, batch reviews recorded code-only; GSDF-46 routes batch findings to the final fixer. |
| SR-MTD-19 | accepted | ADPT-11 aligned with PHCL-22 (invalid name vs listed role without entry), roles added for plan-review finder/verifier/judge and new-project researchers, per-lane overrides; GSDF-18 passes `agent({role})`. |
| SR-MTD-20 | accepted | ADPT-14 narrowed to CONF-04 one-level merge: set nested entries are written whole, validation names missing nested keys; tests for partial overlays. |
| SR-MTD-21 | accepted | GSDC-01: install seeds only the empty `.planning/` (INST-17) and one initialization predicate `init.project`; GSDF-08 uses it; startup-flow acceptance. |
| SR-MTD-22 | accepted | GSDF-63: the active-phase STATE session note by the orchestrator is the sole exception; separate acceptance for active and non-active investigations. |
| SR-MTD-23 | accepted | GSDC-02 names `run-with-timeout` as the only passthrough (JSON last line), `hash`/`normalize-test-command` return JSON, dispatcher preserves exit codes; GSDC-31, GSDC-41 output shapes. |
| SR-MTD-24 | accepted | New GSDC-53 method text inventory used by build and check; GSDC-45 and the GSDF introduction refer to it; UPS-87 traced. |
| SR-MTD-25 | accepted | GSDC-12 guards every mutator of PROJECT/STATE/ROADMAP/REQUIREMENTS including `health --repair`; GSDC-31 confines `write` to a resolved phase directory. |
| SR-MTD-26 | accepted | GSDF-22 acceptance replaced with the deterministic 3 -> 2 -> 1 and 3 -> 2 -> 2 sequences. |
| SR-MTD-27 | accepted | HARN-05 scoped to generated or adapter-referenced assets (owner content advisory with `--all`); HARN-06 fails operational uses only, bare mentions warn, provider settings untouched (D-06). |
