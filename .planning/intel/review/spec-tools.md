# Spec review: TLS

## Verdict

REVISE — 3 BLOCKER, 17 MAJOR, 3 MINOR. The traceability table contains all 179 absorbed behavior IDs once, and its 128 v1 / 6 later counts reconcile, but several rows claim incomplete contracts. The main build risks are inconsistent permission/configuration rules, a planning panel specified against a weaker grammar and an undefined task-completion source, and incomplete integration between retained file fixes, hooks and streaming activity tracking. D-96 wave progress and D-97 shared context thresholds are not delivered as decided. No direct harness/GSD method-text rewrite is required by this area; the planning-reader fixes below must preserve D-111 rather than modifying GSD templates to fit the panel. The review is static: no old kit command, agent, live configuration or daemon was used. Cross-module checks used platform.md, runtime.md and the available method.md; at review time method.md ended after HARN-17 and defined no ADPT requirements.

## Findings

### SR-TLS-01 MAJOR coverage Streaming file touches can disappear from the ledger
- Severity: MAJOR.
- Category: coverage.
- Target: missing (UI-17, UI-25, UI-28); PANL-32, PANL-37, PANL-39, PANL-42.
- Evidence: map/ui.md, Invariants: record file touches on **every** timeline read, not only first sight, because streaming input supplies paths later; source cited there is `kit:paseo/plugins/swarm-plugin/server/activity.ts:347`. PANL-42 specifies first-sight event deduplication but no requirement separates it from ledger ingestion. PANL-39 describes operations on non-first reads, leaving first-poll ledger seeding unspecified.
- Fix: Require every refresh, including the initial refresh, to ingest all currently available paths into the ledger, independently of seen-ID/event suppression. Seed initial holds without historical tool/handoff animations. Test a call first observed without paths, then observed with paths under the same callId: its holds and writer conflicts must appear, with no duplicate tool event.

### SR-TLS-02 MAJOR coverage Rollback omits the restored-file mtime invariant
- Severity: MAJOR.
- Category: coverage.
- Target: FTOL-27; missing INV-54 enforcement.
- Evidence: SYNTHESIS INV-54 explicitly applies wherever the kit restores files; HIS-57 records Git's whole-second stat-cache miss on a same-size restore. FTOL-27 tests bytes, modes and rollback diagnostics, not the restoration timestamp.
- Fix: Require restored existing files to receive a sufficiently later mtime to invalidate Git's stat-cache assumption, without silently ignoring a failure to establish the required restore state. Add a scratch-repo regression with same-size contents and restoration inside one timestamp tick; assert both restored bytes and that Git notices the restored change relative to its cached index state.

### SR-TLS-03 MAJOR coverage The planning parser cannot represent required GSD metadata
- Severity: MAJOR.
- Category: coverage.
- Target: PANL-14, PANL-16; UI-63, UI-66.
- Evidence: PANL-14 specifies only scalars and lists while promising to lift `must_haves` and `key-files`. GSDC-05 requires nested maps/sequences, flow objects and block scalars; GSDC-35 consumes nested `must_haves.artifacts` and `key_links`. The upstream `templates/summary.md` has `key-files.created/modified`, nested `requires`, `actuals` and `coverage` objects. A parser satisfying PANL-14 can silently flatten or discard the fields the pane needs.
- Fix: Make the panel conform to the adopted GSD frontmatter grammar and error semantics, using the same conformance fixtures as M9. Explicitly require nested metadata to survive into detail responses. Include real PLAN/SUMMARY/VERIFICATION fixtures with nested values and block scalars. Keep the reader read-only and do not rewrite upstream templates or method text to accommodate its parser (D-111).

### SR-TLS-04 MAJOR coverage Task completion has no producer in the adopted format
- Severity: MAJOR.
- Category: coverage.
- Target: PANL-16, PANL-19; UI-75, UI-76.
- Evidence: Both requirements depend on checked tasks, but GSDC-18 and the upstream planner-subagent-prompt.md:36-42 specify XML tasks, not a mutable Markdown task checklist. SUMMARY is the completion artifact; its template also allows `status: halted` with tasks intentionally unfinished. The fabricated “3 of 5 tasks checked” fixture does not establish how real GSD output produces that state.
- Fix: Define the authoritative, already-produced artifact fields from which task completion is derived, including stable task identity, partial/halted summaries, missing evidence and unknown progress. If current artifacts cannot establish per-task completion, display unknown rather than invented 0%/100% and retain provable plan-level progress. Replace the acceptance fixture with artifacts actually emitted by M9/M10; do not add checkbox-writing instructions to GSD method text.

### SR-TLS-05 MAJOR coverage File-path links were lost in the Markdown adaptation
- Severity: MAJOR.
- Category: coverage.
- Target: PANL-18; missing UI-72 file-path navigation.
- Evidence: UI-72 CHANGE explicitly calls for phase/plan IDs **and file-path references** to become tappable. PANL-18 includes known IDs and external HTTP(S) URLs only; PANL-17 reveals ancestors when opening a file but never requires links from Markdown to resolve file references.
- Fix: Add read-only navigation for known `.planning/` file-path references, define their resolution base, and apply PANL-13 containment. Test a relative link from a plan to its summary, a missing file, and an escaping path; only the valid local link opens the in-panel reader.

### SR-TLS-06 MAJOR coverage Retained-fix edits bypass syntax checking and edited-path tracking
- Severity: MAJOR.
- Category: coverage.
- Target: HOOK-18, HOOK-26; FTOL-31, FTOL-37 integration.
- Evidence: FIL-29/FIL-32/FIL-39 retain mutations invoked solely as `fixes:[{id}]`, including line fixes. HOOK-26 extracts only `file_path`, `files[].path` and `path`; HOOK-18 likewise takes only `files[].path` for mod writes. A successful fix-only call supplies none of those paths. Native Bash ticket execution does not satisfy the syntax hook's Edit/Write matcher.
- Fix: Specify how the mod adapter exposes the resolved mutation targets to the hook layer before and after a fix-only operation, without executing it twice or exposing private replacement payloads. If the host cannot deliver those targets, specify an equivalent adapter-side before/after check and document the capability check. Add tests for `{id}`, `{id,path}` and line fixes: newly broken files are reported and a later reread is recognized. Do not have hooks independently guess targets or directly mutate M7 private state.

### SR-TLS-07 MAJOR coverage Backend trust can pass with missing manifest coverage
- Severity: MAJOR.
- Category: coverage.
- Target: FTOL-05.
- Evidence: FIL-05 CHANGE requires tamper detection tied to the new install record; D-39 retains a trusted backend and P4 requires fail-closed behavior. FTOL-05 checks “every backend file it [the manifest] lists,” which is vacuously true for an empty/partial `files` map. It does not require the executable backend and its loaded dependencies to be listed. Its cache also has no stated integrity invalidation rule.
- Fix: Require valid manifest structure and digest coverage for the backend entry and its executable/configuration dependency set; an installed candidate with missing coverage must fail, not fall through to source-project trust. State when cached integrity is invalidated. Add negative tests for an empty manifest, omitted backend/config dependency, untracked executable dependency, and modification after a successful discovery; all must fail before target execution when integrity is no longer established.

### SR-TLS-08 MAJOR testability The stale-line acceptance does not prove the safety guarantee
- Severity: MAJOR.
- Category: testability.
- Target: FTOL-35 acceptance.
- Evidence: INV-31 and FIL-37 require that changed lines are never edited through a stale tag. FTOL-35's Acceptance is a parenthesized list of scenario names, not expected outcomes or file assertions. “A changed line shown with a new tag” could pass even if the tool also wrote the stale replacement.
- Fix: Replace the scenario list with explicit outcome and byte-state assertions: changed target lines leave the file unchanged and retain a fix/new tag; uniquely moved unchanged lines are changed only at the matched location; ambiguous placements write nothing until an occurrence is chosen; out-of-range, foreign-file and missing tags write nothing. Include atomic and non-atomic sibling behavior and successful explicit retry against the newly shown lines.

### SR-TLS-09 BLOCKER decision Permission verification must not become a mandate to loosen owner policy
- Severity: BLOCKER.
- Category: decision.
- Target: FTOL-10.
- Evidence: D-40 asks the spec to verify actual main/worker permission modes while retaining fail-closed ask/deny. INV-05 and owner memory no-kit-overrides-of-tool-settings leave another tool's settings to the owner. FTOL-10 instead says the kit configures the mode of `circle` main sessions and that a refusal “is fixed in the provider or config settings.” Runtime PCLI-07 only sets modeId on agents the kit creates; MACH-18 permits no main-session mode override.
- Fix: Specify a compatibility check in an owner-approved scratch session using its actual permission mode, not guaranteed authorization in every owner configuration. Unexpected refusals must produce a named diagnostic and native-tool fallback; changing owner-controlled permissions is an explicit owner action in the owning tool, never a kit repair. Keep the positive test in an already-authorized mode and add negative ask/deny tests with byte-identical provider and Claude settings.

### SR-TLS-10 BLOCKER decision Three different context thresholds violate D-97
- Severity: BLOCKER.
- Category: decision.
- Target: PANL-55, PANL-24; interface with HOOK-11 and runtime PHCL-16.
- Evidence: D-97 requires one source of truth shared with kit context settings. PANL-55 reads only the source kit defaults; HOOK-11 honors project overrides such as 45; PHCL-16 separately specifies a rotate threshold shipped at 50. A project reminding at 45 can therefore show orange at 60 while `ph context` reports ROTATE at 50. A single snapshot-wide number also cannot represent different project overlays simultaneously.
- Fix: Define one effective threshold resolution contract shared by context reporting, hooks and the panel, honoring installed project defaults/overlay and defining fallback for non-kit agents. Carry the effective value per agent/project when a snapshot spans projects (or explicitly scope the snapshot). Test two installed projects with different overrides and a source-kit version differing from their installed defaults; all three consumers must agree for each agent.

### SR-TLS-11 BLOCKER decision Swarm wave progress is deferred despite the v1 decision
- Severity: BLOCKER.
- Category: decision.
- Target: PANL-48, PANL-59; UI-41 trace row.
- Evidence: D-96 keeps a trimmed swarm map “with temp-dir runs replaced by `.planning` wave progress”; UI-41 CHANGE explicitly replaces hub queue progress with wave/plan completion. PANL-48 instead requires running/agents progress with no run line; PANL-59 moves linking swarm hubs to planning waves to later. PANL-15 shows a separate planning board, not the decided swarm replacement.
- Fix: Move the wave-link/progress contract into v1. Define the read-only correlation from the labels/run metadata emitted by M4–M6 to project/phase/wave artifacts, including unknown/unlinked groups. Specify hub progress from those artifacts and a fixture that proves association without title parsing or temp scans. Update the UI-41 trace and counts; do not silently substitute the planning board for the swarm capability.

### SR-TLS-12 MAJOR coverage Existing-file mutations lost their parent-directory permission check
- Severity: MAJOR.
- Category: coverage.
- Target: FTOL-08; FIL-10 trace row.
- Evidence: FIL-10 requires a Write check on the first existing parent because staging siblings and renaming also modify that directory. FTOL-08 restricts ancestor/parent checks to “a new file”; FTOL-27 stages temps and renames for existing files too. Consequently an existing-file edit can execute without the parent check that the row claims to preserve.
- Fix: Require the applicable parent-directory Write check for every staged/renamed mutation, not just file creation, plus missing-ancestor checks for new paths. Test an allowed existing-file Edit/Write with denied parent Write: execution must not start and no temp file may be created.

### SR-TLS-13 MAJOR consistency Read-limit validation disagrees with the sole config loader
- Severity: MAJOR.
- Category: consistency.
- Target: FTOL-23; platform CONF-06.
- Evidence: FTOL-23 rejects `replyMaxChars > 40,000`; CONF-06 permits `fileMaxChars <= replyMaxChars < 500000`. Both claim D-41, and CONF-12/P3 require one validator. An overlay of `{fileMaxChars:100000,replyMaxChars:200000}` must both pass and fail under these specifications.
- Fix: Make M3's authoritative schema use the D-41 one-page bound and explicitly cross-reference it from FTOL-23 instead of maintaining two definitions. Add shared-loader boundary tests at 40,000 and 40,001 and a runtime/backend test that receives the same validation outcome.

### SR-TLS-14 MAJOR consistency Typed failure envelopes cover only half the RPC surface
- Severity: MAJOR.
- Category: consistency.
- Target: PANL-04, PANL-24, PANL-25, PANL-43.
- Evidence: SYNTHESIS M13 and INV-56 require handlers to return typed envelopes. PANL-04 limits this to `planning.*`; PANL-24 and PANL-25 expose raw success objects, and detail errors are merely “returned to the client,” with no typed failure shape. UI-11's old thrown-error behavior cannot override the synthesized envelope rule.
- Fix: Define typed success/failure unions for both swarm RPCs as well as planning RPCs, keeping recoverable partial snapshot errors in the success payload. Test an unexpected snapshot exception and a detail timeline failure: neither handler throws, both responses parse, and the inspector/surface renders the corresponding error. Update every client cursor reference for the envelope shape.

### SR-TLS-15 MAJOR consistency Plugin opt-in incorrectly freezes all machine configuration
- Severity: MAJOR.
- Category: consistency.
- Target: PANL-09.
- Evidence: INS-47's test and MACH-15 preserve only `pluginsEnabled` and `plugins` without the flag. PANL-09 requires the entire Paseo config/file to remain byte-identical on apply without `--enable-paseo-plugins`, contradicting MACH-08/09 provider/model/policy updates.
- Fix: Restrict the no-flag assertion to plugin keys and plugin installation side effects, and reference MACH-15 as the owner of enabling. Test a fixture needing a provider-policy update without the flag: provider changes occur, plugin keys remain JSON-equal, and npm/plugin installation is not called.

### SR-TLS-16 MAJOR consistency Batch writes are specified as edit and tested as write
- Severity: MAJOR.
- Category: consistency.
- Target: PANL-34.
- Evidence: The Requirement maps any batch name matching `edit|write` to `edit`; its Acceptance requires `mcp__harness-files__write_multiple_files` to produce `write`. UI-19 documents the historical combined heuristic, but the new acceptance and distinct UI-18 kinds are incompatible with it.
- Fix: Choose and state one mapping: native/mod writes -> `write`, replacements/line edits -> `edit`, range reads -> `read`, before generic fallback. Add table tests for all three tools and ensure ledger op, activity verbs and event text receive the same kind.

### SR-TLS-17 MAJOR testability Index limits can produce silently false progress
- Severity: MAJOR.
- Category: testability.
- Target: PANL-12, PANL-14, PANL-15, PANL-19.
- Evidence: PANL-12 leaves the file-count cap unspecified and reads only 4,096 bytes of frontmatter, with no outcome when either limit is exceeded. GSD metadata can exceed that head read. INV-36 and GSDC-14 require incomplete scope to be explicit and percentages withheld; PANL-19 can compute definitive progress from a truncated index. The 200-file fixture proves neither boundary behavior nor detection of additions/deletions.
- Fix: Name the cap and its overflow response; distinguish a truncated head probe from malformed frontmatter and use a bounded complete metadata read when required. Propagate incomplete/unreadable scope to board/stats and withhold affected percentages. Test cap+1 files, frontmatter ending after byte 4,096, an unreadable phase, and added/deleted files between polls; none may appear as an authoritative complete index.

### SR-TLS-18 MAJOR consistency Syntax cache identity is not tree/checker aware
- Severity: MAJOR.
- Category: consistency.
- Target: HOOK-27, HOOK-28.
- Evidence: HOOK-27 caches results “by content hash”; HOOK-28 requires each tree's checker. Identical text in two files or worktrees can have different validity because checker commands, configuration, relative imports and build flags differ. A content-only hit can suppress a newly broken file and defeat D-45/INV-27 even while the specified single-tree cache test passes.
- Fix: Define the cache namespace/key to include owning tree, target identity and effective checker/configuration identity as well as content; state invalidation when checker inputs change. Test identical bytes in two worktrees with different fake checkers and a changed checker configuration in one tree: results must not be reused across those contexts. Keep skipped/failed infrastructure checks distinct from a cached pass.

### SR-TLS-19 MAJOR consistency Detail equality must include workspace identity
- Severity: MAJOR.
- Category: consistency.
- Target: PANL-16, PANL-17, PANL-20.
- Evidence: UI-81 protects keepPreviousData from rendering another item's body. `planId` and relative file paths are only unique within a workspace; main checkout and worktrees routinely contain the same `01-01` and `STATE.md`. PANL-16 guards only plan id and PANL-17 only id/path, so switching workspaces can show the old checkout's body as the new one while a request is delayed.
- Fix: Key and validate detail identity by workspaceId plus canonical relative artifact path (and plan id where applicable), or require a remount that provides the same guarantee on every workspace switch. Test main -> worktree with the same plan id/path but different content and delayed second response: the old body must never be displayed under the new workspace.

### SR-TLS-20 MAJOR consistency Syntax checker adapter boundary has no concrete contract
- Severity: MAJOR.
- Category: consistency.
- Target: HOOK-26..HOOK-28; missing referenced ADPT syntax-checker interface.
- Evidence: HOOK-28 delegates command shape and output format to “the ADPT contract” without a requirement ID. The method.md available during review ends at HARN-17, with no ADPT definitions. The only local rule is exit 0 = pass; it does not define a syntax-error result versus unsupported/skipped, timeout or checker crash, nor command cwd/argument encoding. HOOK-26 promises silent checker crashes and file:line:col diagnostics, which cannot be implemented consistently from that boundary.
- Fix: Add or reference an actual ADPT requirement defining extension mapping, command/argv and cwd, absolute-file argument handling, diagnostics schema and pass/fail/skip/infrastructure-error outcomes. Specify hard remaining-budget enforcement and child cleanup in the shell. Add shared conformance tests with paths containing spaces, a syntax failure, unsupported input, missing executable and a hanging checker; only a newly introduced syntax failure is reported.

### SR-TLS-21 MINOR consistency Literal source description contains a forbidden tool name
- Severity: MINOR.
- Category: consistency.
- Target: FTOL-03.
- Evidence: FTOL-03 requires the source descriptions unchanged plus a suffix and also forbids `write_file`. FIL-27's quoted description ends “Use instead of one write_file call per file.” Both cannot pass its scan.
- Fix: Name removal/replacement of obsolete tool references as an allowed adapter-description change and specify the final approved write description. Test that exact approved description and the forbidden-name scan together.

### SR-TLS-22 MINOR consistency Two-sentence rule contradicts the required reread text
- Severity: MINOR.
- Category: consistency.
- Target: HOOK-18, HOOK-23.
- Evidence: HOOK-23 caps every reminder at two sentences; HOOK-18 mandates three: edited earlier; do not reread to verify; read again only for unseen parts. The seven-text acceptance does not check its own sentence bound.
- Fix: Either exempt the preserved reread wording from the cap or provide one owner-approved two-sentence text with the same native-tool/context exceptions as HOK-24. Make both requirements and the text test reference that one approved template.

### SR-TLS-23 MINOR over-spec A test fixture's command length became a production path limit
- Severity: MINOR.
- Category: over-spec.
- Target: FTOL-07.
- Evidence: FIL-07 requires no payload in argv and its mock checks a command under 500 characters for its fixture path. FTOL-07 generalizes this to every absolute backend path; a valid sufficiently deep project path alone can exceed the limit. The value is not a platform limit or an authorization requirement.
- Fix: Require command size to be independent of payload size and bounded by the quoted backend path plus fixed ticket/protocol overhead. Keep the 100 KB payload test, add a long path with spaces/quotes, and retain applicable platform command-length handling rather than imposing an unexplained 500-character project-path ceiling.

## Traceability rows checked

All 179 rows were checked against the maps and overriding decisions. “Wrong” includes a partial trace: the cited requirement exists but does not completely preserve the surviving contract. Dropped behavior rows below are valid only for their expressly dropped portion; cross-module handoffs name the actual enforcing requirements where available.

| behavior ID | requirement claimed | ok / wrong (why) |
| --- | --- | --- |
| FIL-01 | FTOL-04, FTOL-07 | ok — mod/backend and native-ticket boundary retained under D-39. |
| FIL-02 | FTOL-01 | ok — registry reduced to three tools. |
| FIL-03 | FTOL-02, FTOL-03 | wrong — literal-description and forbidden-name requirements conflict (SR-TLS-21). |
| FIL-04 | FTOL-04 | ok — packaging, engine API and version verification covered. |
| FIL-05 | FTOL-05 | wrong — manifest membership/completeness and cached trust are insufficiently constrained (SR-TLS-07). |
| FIL-06 | FTOL-06 | ok — stdin, protocol, size and truncation discipline retained; empty-output diagnosis improved. |
| FIL-07 | FTOL-07 | ok — native permission chain and sentinel retained; production 500-char rule is excessive (SR-TLS-23). |
| FIL-08 | FTOL-08 | ok — ask/deny remain fail-closed in this requirement; FTOL-10 conflicts with the policy (SR-TLS-09). |
| FIL-09 | FTOL-09 | ok — plan recomputation and canonical-path change refusal covered. |
| FIL-10 | FTOL-08 | wrong — existing-file parent Write check omitted (SR-TLS-12); directory walking validly dropped. |
| FIL-11 | FTOL-40 | ok — cheap native-child guard retained. |
| FIL-12 | FTOL-14 | ok — private session isolation covered. |
| FIL-13 | FTOL-15 | ok — stale recovery and lock/transport timeout relation retained. |
| FIL-14 | FTOL-11 | ok — one-shot mutation, withdrawal and receipt recovery retained. |
| FIL-15 | FTOL-12 | ok — recovered/unknown/not-executed and pre-execute failure distinguished. |
| FIL-16 | FTOL-13 | ok — total page bound, surrogate integrity and retained diagnostics covered. |
| FIL-17 | FTOL-16 | ok — retention/budgets plus stale-session-directory cleanup specified. |
| FIL-18 | FTOL-17 | ok — per-request config and registration independence match CONF-09. |
| FIL-19 | FTOL-18 | ok — cwd/Git Bash paths, consistent home expansion and platform case handling covered. |
| FIL-20 | FTOL-19 | ok — bounded suggestions and D-44 case policy retained. |
| FIL-21 | FTOL-20, FTOL-09 | ok — announced unique reads and never-guessed mutations retained. |
| FIL-22 | FTOL-21 | ok — clamping, independent entries, output and inverted-range refusal covered. |
| FIL-23 | FTOL-22 | ok — per-entry/per-reply refusal and later-small-entry admission retained. |
| FIL-24 | FTOL-24 | ok — NUL probe, refusal and native-media guidance retained. |
| FIL-25 | FTOL-25 | ok — bounded-memory regression specifies the large-line fixture. |
| FIL-26 | FTOL-23 | wrong — D-41 intent is here but disagrees with M3 validation (SR-TLS-13). |
| FIL-27 | FTOL-26 | ok — prevalidation, duplicate refusal, UTF-8 writes and summary retained. |
| FIL-28 | FTOL-27 | ok — rollback, retry and mode behavior covered; cross-cutting restore invariant missing (SR-TLS-02). |
| FIL-29 | FTOL-28 | ok — fix/file ordering, partial default and distinct states covered. |
| FIL-30 | FTOL-29, FTOL-24, FTOL-41 later | ok — exact matching, CRLF, mixed-file refusal and binary guard covered. |
| FIL-31 | FTOL-30, FTOL-42 later | ok — diagnostic/fix tiers retained; later trimming follows D-43. |
| FIL-32 | FTOL-31 | ok — retained bounds, single use and committing-call semantics covered. |
| FIL-33 | FTOL-32 | ok — coverage/signature dedup and no dry-run signature covered. |
| FIL-34 | FTOL-28 | ok — atomic/dry-run/partial/done states distinct. |
| FIL-35 | FTOL-33 | ok — repeated-file entries and corrected-path fixes covered. |
| FIL-36 | FTOL-34 | ok — tags, hashes, session binding and eviction covered. |
| FIL-37 | FTOL-35 | wrong — safety behavior stated but acceptance lacks negative byte-state assertions (SR-TLS-08). |
| FIL-38 | FTOL-36 | ok — common positioning, bottom-up edits and overlap failures covered. |
| FIL-39 | FTOL-37 | ok — retained line-fix forms covered; hook integration absent (SR-TLS-06). |
| FIL-40 | not a requirement: dropped | ok — compatibility text tools dropped by D-39; limits/streaming lessons retained. |
| FIL-41 | not a requirement: dropped | ok — single-file compatibility editing dropped; summary-not-diff lesson retained. |
| FIL-42 | not a requirement: dropped | ok — compatibility filesystem methods dropped by D-39. |
| FIL-43 | not a requirement: dropped; FTOL-43 later | ok — media tool/guard dropped by D-42; native Read guidance remains. |
| FIL-44 | not a requirement: dropped | ok — legacy stdio transport dropped; malformed-input lesson retained. |
| FIL-45 | not a requirement: dropped | ok — proxy dropped; surviving lessons point to batch-tool requirements. |
| FIL-46 | FTOL-38 | ok — writer classification agrees with PHCL-27. |
| FIL-47 | FTOL-01 | ok — three upfront schemas, no search round. |
| FIL-48 | not a requirement here: M1 activation | ok — actual enforcing requirements are INST-20, INST-21; cross-area deferral is legitimate. |
| FIL-49 | FTOL-39 | ok — native tools and genuine media/read state remain untouched. |
| FIL-50 | FTOL-02 | ok — field-path validation before state mutation covered. |
| HIS-05 | FTOL-22, FTOL-23, FTOL-24, FTOL-13 | ok — incident lessons retained under D-41/D-42; shared-config conflict noted in SR-TLS-13. |
| HIS-06 | FTOL-31, FTOL-32, FTOL-34, FTOL-11, FTOL-16 | ok — fix/signature/tag/ticket bounds and isolation retained. |
| HIS-07 | FTOL-33 | ok — per-file edit isolation covered; all-or-nothing writes intentionally retain FIL-27. |
| HIS-08 | FTOL-01, FTOL-39 | ok — direct three-tool mod and native coexistence covered. |
| HIS-09 | FTOL-03 | wrong — description token discipline claimed with an impossible literal/name scan (SR-TLS-21); outbound prompt limits belong to PCLI-05. |
| HIS-91 | FTOL-27, FTOL-28 | ok — honest partial/rollback messages covered. |
| HOK-01 | HOOK-01 | ok — intended triggers and new tool vocabulary covered. |
| HOK-02 | HOOK-02, HOOK-03 | ok — template ownership/coexistence; detailed conflict handling in INST-14. |
| HOK-03 | HOOK-06 | ok — role identity, not model, preserved. |
| HOK-04 | HOOK-07 | ok — bounded transcript tail and identity filters; real-schema check named. |
| HOK-05 | HOOK-08 | ok — window precedence and band computation covered. |
| HOK-06 | HOOK-09 | ok — D-50 downward rearming and stale-state pruning included. |
| HOK-07 | HOOK-09 | ok — dedup guarantee retained; PID/mtime machinery dropped per decision. |
| HOK-08 | HOOK-10 | ok — new command path and safe-break reminder covered. |
| HOK-09 | HOOK-05, HOOK-04 | ok — advisory error handling and root discovery covered. |
| HOK-10 | HOOK-11 | ok — merged fields/defaults and dropped model_pattern covered. |
| HOK-11 | HOOK-12, HOOK-32 later | ok — identity first, matcher retained, measured narrowing only later. |
| HOK-12 | HOOK-10 | ok — reminder side here; PHCL-17/18 own measured self-compaction. |
| HOK-13 | HOOK-13 | ok — reduced native/mod classification covered. |
| HOK-14 | HOOK-14 | ok — message rounds, unfinished exclusion and neutral-round distinction retained. |
| HOK-15 | HOOK-15 | ok — once-per-prompt first-file-round reminder covered. |
| HOK-16 | HOOK-16 | ok — lookup streak bands/segments retained. |
| HOK-17 | HOOK-17 | ok — contiguous edit streak and break conditions retained. |
| HOK-18 | HOOK-18 | ok — mapped input-path behavior retained; new fix-only integration gap in SR-TLS-06. |
| HOK-19 | HOOK-19 | ok — empty/truncated result detection and repeat semantics covered. |
| HOK-20 | HOOK-20 | ok — exclusive-create claims and session-hash collision fix covered. |
| HOK-21 | HOOK-21, HOOK-05 | ok — event dispatch, stacked context and advisory failure behavior covered. |
| HOK-22 | HOOK-22 | ok — nonnegative starts and positive steps match M3. |
| HOK-23 | HOOK-23 | wrong — sentence cap contradicts HOOK-18's mandatory text (SR-TLS-22). |
| HOK-24 | HOOK-24 | ok — five rules and install-once requirement retained. |
| HOK-25 | HOOK-02, FTOL-39 | ok — stub dropped; native-tools lesson retained. |
| HOK-26 | HOOK-26 | wrong — no resolved-target path for retained fixes and no concrete checker protocol (SR-TLS-06, SR-TLS-20). |
| HOK-27 | HOOK-27, HOOK-28 | wrong — generalized cache is unsafe across checker/tree contexts (SR-TLS-18). |
| HOK-28 | HOOK-30 | ok — D-46 default rescue with Windows guard and escaped source path retained. |
| HOK-29 | HOOK-03 | ok — separate project hooks and additive coexistence retained. |
| HOK-30 | HOOK-29, HOOK-01, HOOK-27 | ok — concrete timeout exceeds internal budget and matcher lint covered. |
| HOK-31 | HOOK-04 | ok — movable project copies and explicit discovery rule retained. |
| HOK-32 | HOOK-25 | ok — io guard intentionally applies to all sessions. |
| HOK-33 | not a requirement: D-06 / M2-M3 | ok — actual list enforcement is MACH-05/06, CONF-03; role guard remains HOOK-06. |
| HOK-34 | HOOK-31 | ok — fixtures, concurrency tests and role-based identity covered. |
| HOK-35 | HOOK-20, HOOK-21 | ok — stacked ordering and acceptable lost-reminder semantics retained. |
| HOK-36 | HOOK-09 | ok — old heavy-claim defects explicitly excluded. |
| HOK-37 | HOOK-04 | ok — sole overlay location agrees with CONF-13. |
| HIS-04 | HOOK-26, HOOK-28 | wrong — intended tree-aware checks can be defeated by the content-only cache and unspecified protocol (SR-TLS-18, SR-TLS-20). |
| HIS-10 | HOOK-06 | ok — role/child identity retained; native-child file guard also FTOL-40. |
| HIS-11 | HOOK-11 | ok — D-48 default 60 with project override retained. |
| UI-01 | PANL-01 | ok — manifest/toolchain/layout and missing-package fixes covered. |
| UI-02 | PANL-02 | ok — sidebar/workspace/command-center registrations and disposal covered. |
| UI-03 | PANL-03 | ok — shared zod contracts and legal RPC names covered. |
| UI-04 | PANL-04 | ok — planning failure envelopes adapted; all-plugin invariant gap in SR-TLS-14. |
| UI-05 | PANL-10 | ok — SDK/version smoke dependency check named. |
| UI-06 | PANL-41, PANL-02, PANL-58 later | ok — swarm lifecycle retained; planning notifications genuinely optional. |
| UI-07 | PANL-07 | ok — polling/cached work and distinct reconnect displays retained. |
| UI-08 | PANL-06 | ok — native primitives, theme text and no SVG/DOM retained. |
| UI-09 | PANL-08 | ok — operator workflow retained, preview dropped by D-99. |
| UI-10 | PANL-24 | ok — trimmed snapshot retained; threshold and envelope defects separately identified. |
| UI-11 | PANL-25 | wrong — raw/unspecified detail failure contradicts the synthesized typed-envelope rule (SR-TLS-14). |
| UI-12 | PANL-26 | ok — bounded live listing and usage mapping retained. |
| UI-13 | PANL-27 | ok — parent lookup, cached orphans and closed-parent exception retained. |
| UI-14 | PANL-29 | ok — standalone count without drawing matches D-103. |
| UI-15 | PANL-30 | ok — active filter/default and off semantics retained. |
| UI-16 | PANL-31 | ok — eligibility, cadence, concurrency and in-flight dedup retained. |
| UI-17 | PANL-32 | wrong — merge/dedup covered, but late-path ledger ingestion not guaranteed (SR-TLS-01). |
| UI-18 | PANL-33 | ok — typed timeline activity mapping retained. |
| UI-19 | PANL-34 | wrong — batch write classification contradicts its acceptance (SR-TLS-16). |
| UI-20 | PANL-34 | ok — ordered distinct batch-path extraction covered. |
| UI-21 | PANL-35 | ok — clipping and streaming-stable IDs retained. |
| UI-22 | PANL-36 | ok — shortened shell labels generalized. |
| UI-23 | PANL-37 | ok — out-of-order writer accounting and holder behavior retained. |
| UI-24 | PANL-38 | ok — holds/counts plus uncapped conflict visibility retained. |
| UI-25 | PANL-39 | wrong — grouping covered but ingestion of repeated streaming calls is unspecified (SR-TLS-01). |
| UI-26 | PANL-40 | ok — sequence, epoch, retention and history/live bounds retained. |
| UI-27 | PANL-41 | ok — asynchronous prompt capture, retry and lifecycle events covered. |
| UI-28 | PANL-42 | ok — initial history suppressed and first-sight tool events covered; must stay separate from ledger ingestion. |
| UI-29 | not a requirement: dropped; PANL-15 replacement | ok — temp scan dropped; swarm replacement is incomplete under D-96 (SR-TLS-11). |
| UI-30 | not a requirement: dropped | ok — queue files have no surviving data contract. |
| UI-31 | not a requirement: dropped | ok — review parser and its regex bug are not carried. |
| UI-32 | not a requirement: dropped | ok — old temp-run linkage dropped; new wave association still required by D-96. |
| UI-33 | PANL-28 | ok — dedicated label with fallback follows D-100. |
| UI-34 | PANL-43 | ok — list failure degrades honestly; handler-level envelope gap remains SR-TLS-14. |
| UI-35 | PANL-44 | ok — cursor/epoch history reset and no animation covered. |
| UI-36 | PANL-49 | ok — boot versus spawn/view change and NEW behavior retained. |
| UI-37 | PANL-45 | ok — bounded/deduped filtered feed and live cursor covered. |
| UI-38 | PANL-46 | ok — stable slots, shrink and fit zoom retained. |
| UI-39 | PANL-47 | ok — state precedence and closed-parent exception retained. |
| UI-40 | PANL-48 | ok — state/context/file node information retained. |
| UI-41 | PANL-48, PANL-59 later | wrong — wave/plan hub progress moved out of v1 (SR-TLS-11). |
| UI-42 | PANL-48 | ok — brain metadata and orphan rendering retained. |
| UI-43 | PANL-49 | ok — one transient vanished-node ghost retained. |
| UI-44 | PANL-50 | ok — no-SVG links and event effects retained. |
| UI-45 | PANL-50 | ok — effect/packet caps and no initial animation retained. |
| UI-46 | PANL-50 | ok — constant shared-clock animation cost retained. |
| UI-47 | PANL-48, PANL-06 | ok — non-SVG context/progress rings retained. |
| UI-48 | PANL-51 | ok — zoom controls and scrolling retained. |
| UI-49 | PANL-52 | ok — inspector selection and useful fields retained; obsolete run cards dropped. |
| UI-50 | PANL-45 | ok — feed semantics, conflict text and selection retained. |
| UI-51 | not a requirement: dropped; PANL-15 replacement | ok — old run cards validly dropped; planning board is present. |
| UI-52 | PANL-53, PANL-10 | ok — semantic colours/legend and host icon check retained. |
| UI-53 | PANL-23 | ok — generalized formatting and label-derived titles covered. |
| UI-54 | PANL-54, PANL-21 | ok — compact/wide behavior and empty states retained. |
| UI-55 | PANL-05 | ok — read-only observers and copy/navigation-only actions covered. |
| UI-56 | PANL-55 | wrong — defaults-only threshold differs from effective context settings (SR-TLS-10). |
| UI-57 | PANL-56 | ok — named cost caps and measurement retained. |
| UI-58 | PANL-08 | ok — nonexistent tooling references replaced by ph docs. |
| UI-59 | PANL-57 | ok — expanded pure-module test coverage specified. |
| UI-60 | not a requirement: Backlog dropped | ok — reusable UI pieces separately traced; Backlog data path removed. |
| UI-61 | not a requirement: dropped; PANL-05 lesson | ok — no CLI/PATH dependency remains. |
| UI-62 | PANL-11 | ok — workspace-scoped directory resolution and failures covered. |
| UI-63 | PANL-14 | wrong — tolerant shape adaptation insufficient for actual nested GSD fields (SR-TLS-03). |
| UI-64 | not a requirement: dropped; PANL-12 analogue | ok — Backlog CLI cache removed; file cache substituted. |
| UI-65 | PANL-12, PANL-13 | wrong — traversal protections present but cap/head truncation outcomes missing (SR-TLS-17). |
| UI-66 | PANL-14 | wrong — old flat parser grammar cannot serve required GSD detail fields (SR-TLS-03). |
| UI-67 | PANL-17 | ok — local AND filter/natural sort kept, CLI search dropped. |
| UI-68 | PANL-20 | ok — project grouping, main default, MRU and worktree switcher retained. |
| UI-69 | PANL-20 | ok — host-scoped selection survival covered; detail isolation needs SR-TLS-19. |
| UI-70 | PANL-21 | ok — trail and split/compact navigation retained. |
| UI-71 | PANL-22 | ok — reusable primitive set retained without AvatarStack. |
| UI-72 | PANL-18 | wrong — local file-path references never become navigation links (SR-TLS-05). |
| UI-73 | PANL-17 | ok — merged tree, expansion and reader covered. |
| UI-74 | PANL-15 | ok — GSD ladder board replaces Backlog statuses; scope handling still missing (SR-TLS-17). |
| UI-75 | PANL-19 | wrong — task-done source and incomplete-scope percentages undefined (SR-TLS-04, SR-TLS-17). |
| UI-76 | PANL-16 | wrong — checkbox fixture is not an adopted GSD task-completion contract (SR-TLS-04). |
| UI-77 | PANL-23, PANL-15 | ok — date helpers and explicit GSD status tones retained. |
| UI-78 | PANL-21 | ok — section tabs adapted to planning. |
| UI-79 | PANL-09 | wrong — no-flag behavior expanded from plugin keys to the whole config (SR-TLS-15). |
| UI-80 | PANL-28, PANL-27 | ok — parent/group label interface matches PCLI-08. |
| UI-81 | PANL-16, PANL-17 | wrong — equality ignores workspace identity with repeated IDs/paths (SR-TLS-19). |
| INS-47 | PANL-09 | wrong — contradicts both the map and MACH-15 about no-flag writes (SR-TLS-15). |
| HIS-77 | PANL-34, PANL-09 | wrong — tool-kind inconsistency and overbroad plugin opt-in assertion (SR-TLS-16, SR-TLS-15). |
