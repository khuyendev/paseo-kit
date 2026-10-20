# Review r1: History

## Verdict
REVISE. 1 blocker, 8 major, 7 minor. The map is a real reading of the changelog, the omp branch, harness-history, DESIGN.md and the memory files: most citations that were checked resolve, the CONFLICT entries show both sides, and the 2026-10-20 decisions (Claude Code only, no Backlog, no omp, GSD core plus an adapter) are applied rather than fought. It is not safe to spec from yet. The gsd-debug review invariants in harness-history row 47 are only partly lifted, so a rewrite that kept the engine would lose contracts that exist nowhere else, and the STATE.md record is taken from a dirty working tree past commit 89143da while the newest owner planning-size decision on that tree is still absent.

## Findings

### R1-HIS-01 BLOCKER coverage Debug-engine invariants in row 47 are only partly extracted
- Map entry: HIS-56, HIS-57
- Evidence: wildera:.agents/harness-history.md:47. HIS-56 already has the engine sketch (tree digest, replay-safe typed requests with process-tree kill, budgets, detached deadline supervisor, snapshot outside the worktree, lease with writer quiescence, reconcile, forensics on the main session, admission refused under a lease). HIS-57 already has eight review lessons (durable revert targets, transactional revert/reapply with a per-path conflict guard, deadline-with-live-workers keeps the lease, supervisor waits until workers are gone, digest-bound acceptance reusable after an interrupted close, obligation red only on a fresh complete run, a filter that ran nothing is not a pass, later mtime after a same-size restore). The same sentence still contains contracts in neither entry.
- Fix: add entries (or extend HIS-57) for the rest of row 47, each still valid if gsd-debug ships: (1) needsDebug is two-tier — integration signatures at once, localized signatures only after one coder round; (2) verifyLoop bounds must not reset when a review fix hands the failure to debug; (3) a replacement debugger inherits a durable log (row 17 introduced it; row 47's hand-written debugger kept none — not stated in HIS-55); (4) detached engine wrapper with a durable running record; (5) writer detection from run.json `script`, and the lease is always released; (6) signature-specific revert-red; (7) per-target build provenance and coverage merge on reuse; (8) the deadline is invocation-bound; (9) code-wave failure signatures clear only on a passed rerun; (10) typed reruns, or `debuggable: false`; (11) every crash-reason line is matched; (12) Verify's scenario and automation validators. Do not collapse these into the existing one-line sketches.

### R1-HIS-02 MAJOR coverage Planning incident rules and DESIGN owner bullets are missing
- Map entry: missing (nearest HIS-42, HIS-47, HIS-48, HIS-58)
- Evidence: wildera:.agents/harness-history.md:43 (taskResults/deviations live in a separate schema so non-GSD cached calls still match); wildera:.agents/harness-history.md:44 (every GSD verify obligation is checked each Verify round: `test` filters must match executed tests, `cmd` runs; probe blockers count in code; shared files by path, including plugin Config and a new Build.cs); wildera:.agents/harness-history.md:45 (provider/cache and unported advanced-mode departures documented — not in the HIS-42 departure list); wildera:_workspace/gsd-port/DESIGN.md:14 (quick-batch and a separate researcher deferred; the researcher was later added, history:45); wildera:_workspace/gsd-port/DESIGN.md:24-25 (`ph send` may still deliver to an archived agent); wildera:_workspace/gsd-port/DESIGN.md:97 (shared files are never owned); wildera:_workspace/gsd-port/DESIGN.md:120 (never edit the PASEO-HARNESS-KIT block).
- Fix: one behavior per rule, with the owning area. Mark quick-batch as still deferred and the researcher as deferred-then-reversed in the ledger's 2026-10-18 row. The archived-agent send belongs next to HIS-22. The schema split is the reason cached non-GSD calls must keep matching.

### R1-HIS-03 MAJOR coverage Rolling concurrency, not barrier batches
- Map entry: missing
- Evidence: wildera:.planning/STATE.md:74 (in the pinned file, which ends at line 160): "Audit scheduler corrected per owner: 20 concurrent rolling workers, not 20-job barriers." The same paragraph requires Sol/Grok stages to use rolling scheduling with the same cap. HIS-60 records the 20-agent cap and nothing about barriers versus a rolling pool.
- Fix: add a behavior: fan-out admission is a rolling pool at the configured concurrency, not N-sized barriers that wait for the slowest job. Owner area: workflow. This is independent of the Unreal test-audit story.

### R1-HIS-04 MAJOR citation STATE.md citations are not at the pinned commit
- Map entry: HIS-45, HIS-73, HIS-74, Coverage
- Evidence: `git show 89143da:.planning/STATE.md` is 160 lines and ends on the "Next (owner): Phase 1.1 gsd-plan…" bullet. `git status` shows `.planning/STATE.md` modified; `git diff --stat 89143da` is 3 insertions. The map's coverage row says 162 lines, read fully. wildera:.planning/STATE.md:161 (fast mode, HIS-73) and :162 (4 Grok lanes, HIS-45 and HIS-74) exist only in that dirty working tree.
- Fix: cite the pin for lines 1-160. Mark the fast-mode decision and the 4-lane choice as uncommitted working-tree text, with the wording quoted, and do not number them as if they were in 89143da. DESIGN.md is not in 89143da (`_workspace` is gitignored); say that in the coverage row so a later reader does not look for it in the commit.

### R1-HIS-05 MAJOR coverage Latest planning-size decision is absent
- Map entry: missing
- Evidence: wildera:.planning/STATE.md:163 (working tree, third uncommitted line, not in 89143da and not in the map's 162-line snapshot): owner on an 85-plan/8-wave outline, "overthinking, có tý code mà"; run stopped at Plan after 4 plans; CONTEXT D-16 is about 15-20 plans and at most 4 waves, scope unchanged; replan at coarse granularity (Phase 01 had used "fine"); the integration lens carries D-16.
- Fix: add a behavior and a ledger row. The rule that would otherwise be lost: a phase outline is coarse, on the order of 15-20 plans and at most 4 waves, unless the owner raises the cap. Note it is post-pin. HIS-45's "1..N lanes" does not carry this cap.

### R1-HIS-06 MAJOR accuracy HIS-29 merges two different daemon failures
- Map entry: HIS-29
- Evidence: kit@omp:CHANGELOG.md:49-51 (CLI 0.11.2: `paseo daemon status` says localDaemon stopped while `paseo.pid` names the running Desktop process; `--host` works). kit@omp:CHANGELOG.md:199-200 (earlier: `paseo.pid` names a gone process; reach it through the listen address). The behavior says the pid "can name a gone process" and cites both ranges for that one failure.
- Fix: two sentences. Do not read `paseo.pid`. Address is `$PASEO_HOST`, else `daemon.listen`. The 0.2.1 incident is a live pid that instance lookup still misses; the earlier incident is a stale pid. The "do not trust the pid file" rule covers both, but the spec must not describe only the gone-process case.

### R1-HIS-07 MAJOR accuracy One-watcher lock is omp-only; the cited README line states a different rule
- Map entry: HIS-12
- Evidence: kit:README.md:122-130 is the compact-self protocol (end the turn, watcher waits for idle, sends `/compact`, checks a context reduction, failure is not success) and, at line 130, "Claude Code's native autocompact is a separate setting and is not overridden by this reminder." No lock. The lock and the four-watcher incident are kit@omp:CHANGELOG.md:219-220 and kit-git:158-159. The proposal says KEEP and "verify it exists on main" inside the same line.
- Fix: split the entry. KEEP the README protocol, including "do not override native autocompact." State the one-watcher lock as an omp incident to re-implement on the Claude Code watcher, not as a behavior already on main. If main has not been checked, the proposal is OPEN, not KEEP-with-a-parenthetical.

### R1-HIS-08 MAJOR accuracy File-scoped re-review is kept after the loop it belonged to was replaced
- Map entry: HIS-51, HIS-52
- Evidence: wildera:.agents/harness-history.md:40 (re-review checks only files the fixer touched — this is the old loop). wildera:.agents/harness-history.md:42 (the bounded gate "replaces the review/fix/re-review loop"; resolution check is of those findings only, no new findings; it does not say the check is limited to files the fixer touched). HIS-52 drops rows 19 and 22 as superseded and leaves row 40's file scope inside HIS-51 as current.
- Fix: move the file-scope sentence out of the current gate, or cite a later line that still imposes it. The current gate's check rule is "those findings only, no new findings," plus the unverified-high retry from row 44.

### R1-HIS-09 MAJOR coverage Two omp incidents still apply to provider sync and batch edits
- Map entry: missing (nearest HIS-07, HIS-27, HIS-37)
- Evidence: kit@omp:CHANGELOG.md:70-71 (provider `models` used to be only appended, which left stale `anthropic/` ids; they are now replaced to match the template). kit@omp:CHANGELOG.md:121-124 (with `fixes`, a register op is refused when a fix fails to resolve; the failure text must not promise that nothing was written, because the native edit writes files in order and a later write error can leave earlier files written).
- Fix: add both as rules that survive dropping omp. Model-list sync is a replace, not an append. A batch write/edit failure must not claim a clean rollback unless the tool actually rolled back. HIS-37's DROP of the omp variant does not retire these.

### R1-HIS-10 MINOR accuracy Swarm cross-reference points at the skeleton gate
- Map entry: HIS-35
- Evidence: the proposal says "swarm panel see HIS-45". HIS-45 is the skeleton review gate. The swarm panel is HIS-77.
- Fix: change the pointer to HIS-77.

### R1-HIS-11 MINOR accuracy "47 rows" is the file length
- Map entry: HIS-66
- Evidence: wildera:.agents/harness-history.md is 47 lines (`wc -l`); data rows are lines 9-47, which is 39 rows. dino is 42 lines, and those 42 bytes-lines match WildEra's prefix exactly (checked), so "rows :9-:42 identical, nothing newer" is right. The "47 rows" count is not.
- Fix: say 39 data rows, 2026-10-14 through 2026-10-19, file length 47.

### R1-HIS-12 MINOR accuracy "Current debug run" is repeated four times, not five
- Map entry: Concerns
- Evidence: wildera:.planning/STATE.md:60, :62, :64, :66. Four headings. No fifth.
- Fix: say four.

### R1-HIS-13 MINOR accuracy Bash 400 s is a simulation hang, not a limit
- Map entry: HIS-02
- Evidence: wildera:.agents/harness-history.md:14 Reason column: "Bash 400 s untouched" is one simulated event. The configured limits in that row are `agent_tool_stuck_s` 900 and `agent_file_tool_stuck_s` 180. A 400 s Bash hang is untouched because it is under 900 and Bash is not a file tool.
- Fix: say that. Do not write it as a third budget.

### R1-HIS-14 MINOR citation README:103-105 is not the read-limit contract
- Map entry: HIS-05
- Evidence: kit:CHANGELOG.md:42-49 does state `fileMaxChars` 200,000, `replyMaxChars` 450,000, binary refusal, `mediaPerTurn` 1, and the single nearby-file hint. kit:README.md:103-105 is native Read, the media alias, and legacy audio/resource delivery. The limits are not in those lines.
- Fix: drop README:103-105 from HIS-05, or move it to HIS-08, which is the entry that talks about native Read.

### R1-HIS-15 MINOR citation kit-git:52-75 is the 0.1.2 commit, not the history rewrite
- Map entry: HIS-30
- Evidence: kit-git:46-47 is "Point commit references at the rewritten history (bench Claude Code variant: 7e45154)". kit-git:52-75 is the 0.1.2 message (endpoint becomes `{{secret:ANTHROPIC_BASE_URL}}`), duplicated on `omp-pre-rewrite` and on the rewritten history. The rewrite claim is mem:omp-migration-policy.md:13. The pre-rewrite vs omp changelog diff is only the 0.2.0/0.2.1 insertion plus `5a3647e` to `7e45154` (one hunk); that coverage claim is right.
- Fix: cite kit-git:46-47 for the rewrite, and 52-75 only for the secret-template commit message. kit@omp:CHANGELOG.md:35 is `disabledProviders`; the secret fill is lines 36-37.

### R1-HIS-16 MINOR accuracy Small wording gaps that would be copied into the spec
- Map entry: HIS-36, HIS-41, HIS-43, HIS-60, ledger 2026-10-12
- Evidence: kit:README.md:64 says "init project này"; the map drops the diacritic. wildera:.planning/STATE.md:49 puts deferred findings in `_workspace/gsd/01-m1-p0/deferred.md`, not in `<phaseDir>/deferred.md`. wildera:_workspace/gsd-port/DESIGN.md:43-46 generates adapter front matter plus a GENERATED line plus a path-rewritten body; HIS-43 says "path rewrites only". wildera:.agents/harness-history.md:15 item (5) has content-restore rules for `kind: diagnostic` tasks; HIS-60 has `editorRuns` and not the restore. mem:omp-migration-policy.md:11 says the owner "reports that omp is ineffective and intends to abandon it later"; the ledger quotes a shorter sentence as owner wording.
- Fix: restore the diacritic; cite the observed deferred.md path as an example, not as `<phaseDir>`; say generation adds front matter; add content-restore to HIS-60 or to HIS-57; mark the 2026-10-12 ledger cell as a paraphrase.

## Citations checked

| map entry | citation | result |
| --- | --- | --- |
| HIS-01 | kit:CHANGELOG.md:5 | ok. Clock starts when input is complete; 15 KB Write, path immediate, content 104 s later, done 0.2 s after; readiness list; runner waits for the retry turn. |
| HIS-02 | wildera:.agents/harness-history.md:14 | ok for 900/180 and the two-strike rule. "Bash 400 s" is a simulated hang (see R1-HIS-13). |
| HIS-05 | kit:CHANGELOG.md:42-49 | ok. Limits, binary refusal, one nearby name, mediaPerTurn 1, the 6.1 MB and API 400 incidents. |
| HIS-05 | kit:README.md:103-105 | wrong for those limits. Those lines are native Read and the media alias (R1-HIS-14). |
| HIS-07 | kit@omp:CHANGELOG.md:81-86 | ok. A rejected header fails that file alone; two agents lost a batch of four on `[path#]`. |
| HIS-07 | kit@omp:CHANGELOG.md:97-100 | ok. Cost 0.043 to 0.038 USD; worker turns 13/7/10 to 7/7/10. |
| HIS-10 | kit-git:100 | ok. `context guard model_pattern "." (every model)`. |
| HIS-12 | kit:README.md:122-130 | partial. Protocol matches; no lock; line 130 is "do not override native autocompact" (R1-HIS-07). |
| HIS-12 | kit@omp:CHANGELOG.md:219-220 | ok. Lock file with pid; four watchers, resume message four times. |
| HIS-12 | kit@omp:CHANGELOG.md:39-41 | ok. Without the session file a success stayed unconfirmed for 15 minutes. |
| HIS-12 | kit-git:158-159 | ok. "A lock file allows one watcher per agent." |
| HIS-13 | kit@omp:CHANGELOG.md:13-16 | ok. `wait` removed because an orchestrator blocked its turn on it. |
| HIS-13 | kit@omp:CHANGELOG.md:76-79 | ok. omp wakes the agent; the doc had said the opposite, "true of Claude Code". |
| HIS-18 | wildera:.agents/harness-history.md:46 | ok. List price vs daemon `totalCostUsd` (1.13 vs 0.23); journal fields named. |
| HIS-26 | kit:README.md:7-9 | ok. Install does not force the main conversation off native `Agent`. |
| HIS-26 | kit:README.md:146-149 | ok. Main provider denies `Agent` and `Workflow`. Also "this branch does not apply" to the live daemon. |
| HIS-29 | kit@omp:CHANGELOG.md:47-52 | partial. Address rule is here, but the pid names the running process while status says stopped (R1-HIS-06). |
| HIS-29 | kit@omp:CHANGELOG.md:199-200 | ok. Pid names a gone process; use the listen address. Line 201 is blank. |
| HIS-29 | kit-git:201 | ok. Same stale-pid sentence as the 4f1a4af message. |
| HIS-30 | kit@omp:CHANGELOG.md:127-130 | ok. Public repo; `{{secret:ANTHROPIC_BASE_URL}}`; rendered models.yml gitignored. |
| HIS-30 | kit@omp:CHANGELOG.md:35-36 | partial. Line 35 is `disabledProviders`; secret fill is 36-37 (R1-HIS-15). |
| HIS-30 | kit-git:52-75 | wrong for "history was rewritten". That is the 0.1.2 body on both branches. Rewrite pointer is kit-git:46-47 (R1-HIS-15). |
| HIS-38 | kit@omp:CHANGELOG.md:20-29 | ok. Cleanup, context-guard exception, end the turn, one `paths` read, `[UNVERIFIED]`, LaTeX/allocation removed. |
| HIS-38 | kit@omp:CHANGELOG.md:208-211 | ok. Three bench runs removed a line a task script had added. |
| HIS-45 | wildera:.planning/STATE.md:162 | not in commit 89143da (file ends at line 160). Text is dirty working tree (R1-HIS-04). |
| HIS-46 | wildera:_workspace/gsd-port/DESIGN.md:159-163 | ok. Blocker+warning, unknown severity is blocker, max 3, stall, third REVISION_CONFLICT escalates, owner chooses at the cap. |
| HIS-50 | wildera:.planning/STATE.md:106,113,136 | ok at the pin. 72 finder jobs; 61 judged, 60 applied; "Chất lượng đến từ việc thêm bước review kìa". |
| HIS-54 | wildera:_workspace/gsd-port/DESIGN.md:13 | ok. Coders never build, test or commit. |
| HIS-54 | wildera:.planning/STATE.md:119 | ok. Fixers self-verify; `ph send` waits; `--now` interrupts. |
| HIS-71 | wildera:.planning/STATE.md:131,156 | ok. Both merge quotes are on those lines. |
| HIS-73 | wildera:.planning/STATE.md:161 | not in 89143da. Same defect as HIS-45 (R1-HIS-04). Fast-mode wording itself matches the dirty line. |
| Coverage | omp vs omp-pre-rewrite CHANGELOG | ok. Diff is the 0.2.0/0.2.1 insert plus `5a3647e` to `7e45154`. |
| HIS-66 | dino vs wildera history | ok that the shared prefix matches. dino is 42 lines, byte-identical to WildEra lines 1-42. |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| --- | --- | --- |
| kit:CHANGELOG.md (56 lines, matches `wc`) | yes, read-fully claim holds | 0 beyond what HIS-01..08 already carry. Legacy stdio signature lifetime (line 21) is MCP and correctly left to the DROP of adapters. |
| kit:README.md (172) | yes | 1. Native autocompact must not be overridden (line 130), cited by HIS-12 and not stated (R1-HIS-07). |
| kit-git log --all (226 lines, 20 commits) | yes | 0 separate from the changelog findings. kit-git:46-47 (history rewrite) is mis-cited as 52-75 (R1-HIS-15). |
| kit@omp:CHANGELOG.md (239) | yes | 2 still-valid rules: model list is replaced not appended (70-71); do not promise a clean failed write (121-124) (R1-HIS-09). |
| kit@omp-pre-rewrite:CHANGELOG.md (140) | yes | 0. The "only the hash differs outside 0.2.x" claim was checked and holds. |
| wildera:.agents/harness-history.md (47, clean at 89143da) | yes | Row 47 review invariants and the two-tier needsDebug rule (R1-HIS-01). Rows 43-45 schema split, obligation filter match, probe blockers, shared-file path rule (R1-HIS-02). Diagnostic content-restore (R1-HIS-16). |
| wildera:.planning/STATE.md | yes, but the row says 162 lines | Pin 89143da is 160 lines. Dirty tree is 163. Missing: rolling pool not barriers (line 74, R1-HIS-03); plan-size cap (line 163, R1-HIS-05). Lines 161-162 are real decisions cited at the wrong revision (R1-HIS-04). |
| wildera:_workspace/gsd-port/DESIGN.md (181; not in 89143da) | yes, line count matches `wc` | 4. quick-batch still deferred; `ph send` to an archived agent; shared files never owned; never edit the kit AGENTS block (R1-HIS-02). |
| dino:.agents/harness-history.md (42) | yes | 0. Prefix matches WildEra. |
| ktp:.agents/harness-history.md (8) | yes | 0. Header only; `.claude/skills/harness/` drift is correctly noted. |
| god-vibe-code:.agents/harness-history.md | yes, as absent | 0. Confirmed not on disk. |
| mem:MEMORY.md and the five notes | yes, line counts match | 0 rules missed. The two omp-prompt open questions (verify-own-slice, lsp MUST) are moot once SYSTEM_TEMPLATE is dropped; worth one clause on HIS-39, not a separate behavior. |
