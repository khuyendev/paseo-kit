# Review r1: workflow

## Verdict

REVISE. 0 blocker, 12 major, 10 minor.

The engine API, journal, resume key, model-time watchdog, and the input-complete incident are largely right and cited from code that was actually read. The map still drops two incident rules in section 6 and section 10, mis-states several contracts a reimplementation would get wrong (loop accounting, stuck-clock restart, archive path, exit codes, worktree removal, the sample log), and points two claims at the wrong daemon lines.

## Findings

### R1-WFL-01 MAJOR coverage 15 MB read incident omitted
- Severity: MAJOR
- Category: coverage
- Map entry: missing
- Evidence: kit:project/.agents/skills/harness/references/paseo-runtime.md:276-278
- Fix: Add a behavior (and an invariant). A very large file read (recorded: a 15 MB JSON) closed the MCP server; every later read of that agent failed with "Connection closed". Authoring rule: give agents per-item extracts, not a whole corpus file. Proposal KEEP.

### R1-WFL-02 MAJOR coverage read-only and tools are advisory, not a sandbox
- Severity: MAJOR
- Category: coverage
- Map entry: missing
- Evidence: kit:project/.agents/skills/harness/references/paseo-runtime.md:382-386; kit:project/.agents/skills/harness/references/workflow-recipes.md:204
- Fix: Add the section 10 contract the coverage table says was mapped. A definition `tools:` list and `readOnly` / `--read-only` do not grant tools or create a sandbox; permissions come from the provider and host. Read-only means change no files; non-mutating lint/tests are allowed; artifact-writing checks need an editing role. Where reviewer writes would do harm, freeze inputs (`ph freeze`) and check afterwards. Proposal KEEP that rule. DROP the recipes sentence that other providers use MCP file adapters (owner: non-Claude MCP adapters are not carried).

### R1-WFL-03 MAJOR accuracy a write clears the loop counter before it is counted
- Severity: MAJOR
- Category: accuracy
- Map entry: WFL-34
- Evidence: kit:project/.agents/harness/runtime/watchdog.mjs:86-95
- Fix: State the order. On a completed call, a write-kind tool first clears `readsSinceWrite`, `fileReads`, and `repeats`; only then is this call's input key stored, so it becomes count 1. Identical Edit/Write/shell-write calls therefore never reach `watchdog_repeat_calls` by themselves. A write does not clear `signals`, so a `loop` already sent in this prompt does not fire again after the write. Concern 5 covers false shell classification only; this is the true write path too.

### R1-WFL-04 MAJOR accuracy inputAt does not restart on every key change
- Severity: MAJOR
- Category: accuracy
- Map entry: WFL-31
- Evidence: kit:project/.agents/harness/runtime/watchdog.mjs:75-78
- Fix: Replace "restarts whenever the input key changes". On `running`, if the input key changed, store it and set `inputAt = now` only when `inputReady` is true. If the key is unchanged, set `inputAt` only when it is still null and the input is now ready. A key change to a not-ready payload leaves the previous `inputAt` in place (it is not cleared and not moved to now).

### R1-WFL-05 MAJOR accuracy read-only detection is wider than Edit/Write
- Severity: MAJOR
- Category: accuracy
- Map entry: WFL-22
- Evidence: kit:project/.agents/harness/runtime/prompts.mjs:25-27, 46-49
- Fix: `definitionReadOnly` is true only when `tools` is non-empty and matches neither `\b(Edit|Write|MultiEdit|NotebookEdit)\b` nor `edit_multiple_files|write_multiple_files|edit_file|write_file|move_file|create_directory`. The runner passes `readOnly: opts.readOnly === true || def.readOnly` (kit:project/.agents/harness/runtime/commands.mjs:657). Include files are pasted under `===== <repo-relative path> =====`; only the agent-definition path is unnamed. `opts.readOnly` other than strict `true` does not add the note by itself.

### R1-WFL-06 MAJOR accuracy archive --run ignores --runs-dir
- Severity: MAJOR
- Category: accuracy
- Map entry: WFL-43
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:469-474
- Fix: `ph archive --run` always reads `<project>/_workspace/_runs/<runId>/run.json`. It does not take `--runs-dir` (unlike `ph workflow` and `ph worktrees`). A run started with another `--runs-dir` is "no run". Kill is `process.kill(pid)` (default signal) only when `pid` is alive and `status === "running"`; status is then rewritten `stopped` even if the kill throws. Zero matching agents prints `archived 0 of 0 agents` and exits 0.

### R1-WFL-07 MAJOR accuracy worktree prune rules are incomplete
- Severity: MAJOR
- Category: accuracy
- Map entry: WFL-29
- Evidence: kit:project/.agents/harness/runtime/worktrees.mjs:42-71; kit:project/.agents/harness/runtime/commands.mjs:844-855
- Fix: A workflow worktree is in use only when `run.json` exists and `status === "running"` and `pid` is alive. A killed runner whose status is still `running` is not in use (comment at worktrees.mjs:50). Missing `run.json` is "owner unknown" and kept. A git record marked `prunable` is state `directory missing` and removable even if the owner is in use. Daemon fetch failure prints `note daemon not reachable (...): worktrees of spawned agents are kept` and those owners stay unknown. Removal is `git worktree remove` (or `git worktree prune` if the directory is already gone), then `git branch -d`; if `-d` fails the worktree is still gone and the branch is kept. A failed removal increments a failure count and the command exits 2. Not a git repo: usage error. Empty list: `no harness worktrees`.

### R1-WFL-08 MAJOR accuracy missing caller or daemon is exit 2, after a running record
- Severity: MAJOR
- Category: accuracy
- Map entry: WFL-18
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:742-768, 778-805, 883-887; kit:project/.agents/harness/runtime/daemon.mjs:90-91
- Fix: Exit 1 is only for throws that escape `cmdWorkflow` before its try: bad flags, missing script/name/resume, resume journal missing, both `--args` and `--args-file`, `parseScript` failure, `JSON.parse` of args, `parseBudget`. Those print `usage error:` only for `UsageError`; a syntax error prints `failed:` and still exits 1. `paseo()` and `requireCaller()` run after `run.json` is written `status: running` and `workflow start` is logged. No `PASEO_AGENT_ID`, or daemon/CLI failure, rewrites `status: failed` and returns 2. `--detach` returns 0 without calling either; the child hits this path. Also state that a failed run does not write `result.json` or `name`/`description`.

### R1-WFL-09 MAJOR accuracy sample log has three Write interrupts, not two
- Severity: MAJOR
- Category: accuracy
- Map entry: WFL-47
- Evidence: wildera:_workspace/_runs/wf_20261015-011128_ecea/log.txt:3-12; wildera:_workspace/_runs/wf_20261015-011128_ecea/journal.jsonl:1-2
- Fix: Rewrite the sample. Starts are #2, #4, #1, #3 (not in `n` order): two `circle-agent/gpt-6.1-sol-fast[1m]`, two `circle-agent/claude-opus-5-5[1m]`. Then a `reread` on #4, then three interrupts: #2 Write 187 s, #4 Write 189 s, #3 Write 186 s. Only #2 and #4 reach `agent done ... null (finished without a reply) tokens=0` (393 s and 463 s) and those are the only journal rows (`n` 2 and 4). #3 is interrupted with no done line and no journal row. #1 (`Draft:evolutionary`) has neither a watchdog line nor a done line. That is the changelog's "3 of 4 interrupted"; the runner then died and `ph archive --run` set `stopped` with `agents: null` and `pid` kept (13320). `run.json` lines 1-11 and the model pair are right; the "two interrupts" sentence is not.

### R1-WFL-10 MAJOR coverage settleTurn drops the next usage event
- Severity: MAJOR
- Category: coverage
- Map entry: WFL-09
- Evidence: kit:project/.agents/harness/runtime/daemon.mjs:62-79
- Fix: Specify the dedup. `UsageTracker` sums `inputTokens`, `cachedInputTokens`, `outputTokens`, and the last numeric `totalCostUsd`, keyed so a repeated `turnId`/`seq` is ignored. `settleTurn` polls up to 2 s. If `turns` is still the pre-wait count and `lastUsage` exists, it adds `lastUsage` and increments `late`; the next `turn_completed` with usage for that agent is then discarded. Budget and journal tokens use `output` only. The code does not look for the word "interrupted"; a turn is uncounted only when no `turn_completed` usage arrives and `lastUsage` is not applied. Also note `createAgent` archives the new agent and throws if `track()` fails (daemon.mjs:129-130); `workflowRunner` turns that into `null`.

### R1-WFL-11 MAJOR coverage watcher hangs when the run directory exists without run.json
- Severity: MAJOR
- Category: coverage
- Map entry: WFL-41
- Evidence: kit:project/.agents/skills/harness/scripts/watch_run.mjs:55-62; kit:project/.agents/harness/runtime/commands.mjs:756-768
- Fix: The 60 s `workflow not found` path runs only when the run directory is absent. `--detach` creates that directory and `script.js`, prints `workflow started`, and returns before the child writes `run.json`. If the child never writes `run.json` and never writes a `workflow done|failed` line, `watch_run` polls forever. Also: `deadChecks` is not reset when the pid is alive again (watch_run.mjs:60), and every ended run, including `workflow failed` and `workflow interrupted`, exits 0.

### R1-WFL-12 MAJOR citation title and env are not at the cited daemon lines
- Severity: MAJOR
- Category: citation
- Map entry: WFL-04, WFL-28
- Evidence: kit:project/.agents/harness/runtime/daemon.mjs:121-127
- Fix: Line 121 is `clampThinking`, not title truncation. `title.slice(0, 60)` is line 123. Worker env `PASEO_HARNESS_LEADER` / `PASEO_HARNESS_ROOT` / `PASEO_HARNESS_ROLE=worker` is line 126; labels (`PARENT_LABEL` plus the caller's `harness.run` / `harness.name`) are line 127. WFL-28's range `daemon.mjs:112-123` stops before both. Retarget. The clamp claim in WFL-04 can cite 121; the title claim cannot.

### R1-WFL-13 MINOR accuracy phase membership is `phases[].title`
- Severity: MINOR
- Category: accuracy
- Map entry: WFL-01, WFL-07
- Evidence: kit:project/.agents/harness/runtime/workflow_engine.mjs:219-228
- Fix: The warning fires only when `meta.phases` is present and no element's `.title` equals the string. `detail` is not validated. An array of bare strings never matches, so every `phase()` warns. Say that in WFL-01/07.

### R1-WFL-14 MINOR accuracy runner failures are nulls, not engine throws
- Severity: MINOR
- Category: accuracy
- Map entry: WFL-03, WFL-29
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:647-652, 710-716; kit:project/.agents/harness/runtime/prompts.mjs:31, 85-88
- Fix: Unknown `agentType`, a missing include, `resolveModel` failure, and `isolation: 'worktree'` outside a git repo are caught inside `workflowRunner` and become `{status:'null'}` with that message. They do not reject `agent()` and do not fail the run. Engine throws remain only: unknown option, bad schema, isolation other than `'worktree'`, budget, cap. WFL-29 should say the git error is a null reason, not an uncaught throw.

### R1-WFL-15 MINOR accuracy concern 21 mis-states what detach writes
- Severity: MINOR
- Category: accuracy
- Map entry: Concerns 21
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:757-776
- Fix: The parent writes `script.js` only, then spawns. It does not write `args.json` or `run.json`. The child writes `script.js` again, then `args.json` and `run.json`, and emits `workflow start`.

### R1-WFL-16 MINOR coverage review-gate prompt disagrees with the gate
- Severity: MINOR
- Category: coverage
- Map entry: WFL-46
- Evidence: wildera:.agents/workflows/review-gate.js:27-28, 33-35, 39, 54
- Fix: Record both sides. `FORMAT` says a theoretical finding is at most normal unless it is data loss or a security hole; `gated()` rejects every `likelihood === 'theoretical'`. Missing `confidence` is 0. Reviewer effort defaults to `medium` as well as the verifier. Resolve with an empty `open` list returns `{key, findings: []}` and calls no agent. A null verifier result confirms every candidate (`vd?.verdict ?? 'confirmed'`), not only a missing index.

### R1-WFL-17 MINOR accuracy run_stats matching gaps
- Severity: MINOR
- Category: accuracy
- Map entry: WFL-42
- Evidence: kit:project/.agents/skills/harness/scripts/run_stats.mjs:8-10, 34-43
- Fix: `agent cached` lines and `agent done` lines whose duration is `?s` are absent from agent seconds. Another run is excluded only when the file matches `Run wf_\S+ #\d+ (bookkeeping`, not merely `Run wf_… #`. The fallback timestamp is the first `"timestamp"` in the first 4000 characters. The header comment (lines 8-10) still says overlapping runs are counted together; the tag check contradicts it. Median is `secs[floor(n/2)]`, not the average of the two middle values.

### R1-WFL-18 MINOR coverage small host and run-file contracts
- Severity: MINOR
- Category: coverage
- Map entry: WFL-02, WFL-15, WFL-16
- Evidence: kit:project/.agents/harness/runtime/workflow_engine.mjs:151-152, 262-278; kit:project/.agents/harness/runtime/commands.mjs:622, 732-733; kit:project/.agents/harness/runtime/daemon.mjs:151-155
- Fix: Add: `workflowSource` strips one leading BOM. `console` has only `log`/`info`/`warn`/`error` (anything else throws). Budget and cap throws happen after `n` is allocated, so a later `agent done` number can skip, and those calls write no journal line. A successful run that never calls `agent()` never creates `journal.jsonl`, so `--resume` of it fails `cannot resume`. AskUserQuestion denies are counted once per permission status (all asks in that status together), max 3; any other pending permission throws immediately. A watchdog stop archives from the tick and `workflowRunner`'s `finally` archives again unless `keep`.

### R1-WFL-19 MINOR accuracy section 6-4 still has a third stale sentence
- Severity: MINOR
- Category: accuracy
- Map entry: WFL-36
- Evidence: kit:project/.agents/skills/harness/references/paseo-runtime.md:289-296; kit:project/.agents/harness.defaults.json:2
- Fix: Besides the 300/900 numbers and the single-stop rule, section 6-4 says tool time starts "when a call's input stops growing" and the null reason is `watchdog stopped the agent` with no `after N s`. Code reason is `watchdog stopped the agent after <agent_stop_s> s` (commands.mjs:702) for both model-time stop and the second hung tool. Defaults `_notes` (line 2) still describes only nudge/stop/repeat and points at section 6-4; `_watchdog_note` and `_tool_stuck_note` are the lines that match the code. Add those two doc strings to the CONFLICT entry.

### R1-WFL-20 MINOR proposal recipes still carry non-Claude MCP adapters
- Severity: MINOR
- Category: proposal
- Map entry: WFL-45
- Evidence: kit:project/.agents/skills/harness/references/workflow-recipes.md:204
- Fix: WFL-45 says KEEP the authoring guide. Add DROP for the sentence that other providers use MCP compatibility adapters, and for execution-modes.md section 5-2 rows that exist only to map Codex/OpenCode/Pi. Owner decision: Claude Code only; those adapters are not carried. Concern 20 already drops the v1 migration section; extend it to this sentence.

### R1-WFL-21 MINOR structure interfaces omit prompt notes; coverage counts are stale
- Severity: MINOR
- Category: structure
- Map entry: Interfaces, Coverage
- Evidence: kit:project/.agents/harness.defaults.json:91-94; wildera:_workspace/_runs (186 directories on 2026-10-20; newest `wf_20261020-144238_db14`)
- Fix: Interfaces should list `first_prompt_note` and `platform_notes.win32` (WFL-22 depends on them) and that `prime_role` validates only `two-turn` or `off` (kit:project/.agents/harness/config.mjs:74). Refresh the coverage row: the tree now has 186 run directories, newest `wf_20261020-144238_db14`, not 185 and not `wf_20261020-134305_58c0`. Several "lines" figures are the last non-blank line (workflow_engine 320, watchdog 151, watch_run 65, review-gate 68, paseo-runtime 433, runtime_regression.test.mjs 469). The bodies were read; fix the table so "read fully" is checkable. `wildera:_workspace/review-gate/p1-entry-gate1-resolve.json` is a resolve-mode args sample (mode, open, evidence) and was not read; one line in Coverage is enough.

### R1-WFL-22 MINOR accuracy permission and config edges left vague
- Severity: MINOR
- Category: accuracy
- Map entry: WFL-26, WFL-12
- Evidence: kit:project/.agents/harness/runtime/daemon.mjs:14, 151-157; kit:project/.agents/harness/config.mjs:56-64
- Fix: `NON_RETRYABLE` is case-insensitive and includes `billing` and `invalid api key` (WFL-26's word list matches; say the match is on `st.error` only, one continue). Watchdog integer keys must be nonnegative safe integers, so `0` disables and negatives fail config load; `max_subagents`, `max_agents_per_workflow`, `wait_timeout_s`, and `max_prompt_bytes` must be >= 1. The engine still clamps the semaphore with `Math.max(1, maxConcurrent)`.

## Citations checked

| map entry | citation | ok / wrong |
| --- | --- | --- |
| WFL-01 | kit:RT/workflow_engine.mjs:20-76, 248-249 | ok: meta regex, pure-literal check, 1000 ms vm, required name/description, phases array, blank-out meta, async wrap, lineOffset -1 |
| WFL-01 | kit:REF/paseo-runtime.md:215-233 | ok: plain JS, literal meta, no Date.now/Math.random/argless Date |
| WFL-02 | kit:RT/workflow_engine.mjs:129-152 | ok: Math.random, Date, Date.now, console log/info/warn/error |
| WFL-03 | kit:RT/workflow_engine.mjs:153-157, 253-301 | ok: null not reject; runner exception to `runner error:`; throws on bad option/schema/isolation/budget/cap |
| WFL-04 | kit:RT/workflow_engine.mjs:13-16, 254-264 | ok: option set and label default |
| WFL-04 | kit:RT/daemon.mjs:121 | wrong: line 121 is `clampThinking`; `title.slice(0, 60)` is line 123 (R1-WFL-12) |
| WFL-05 | kit:RT/workflow_engine.mjs:165-176 | ok: per-item stages, throw to null, returned null continues, 4096 via checkItems |
| WFL-07 | kit:RT/workflow_engine.mjs:221-229 | partial: warning exists, but membership is `p.title`, not "title in the array" (R1-WFL-13) |
| WFL-09 | kit:RT/commands.mjs:643, 785-791 | ok: budget is output tokens plus caller `extraSpent` |
| WFL-09 | kit:RT/daemon.mjs:51-79 | partial: sums and 2 s settle are there; the `late` drop is lines 67-68 and is not in the behavior (R1-WFL-10) |
| WFL-10 | kit:RT/commands.mjs:613-623 | ok: `.agents` then `.claude`, `.js` then `.mjs`, error text names only `.agents/workflows/` |
| WFL-11 | kit:RT/commands.mjs:679-709, 715 | ok: native schema only at create; primed path uses `P.structured`; first 3 validation errors |
| WFL-12 | kit:RT/workflow_engine.mjs:275-292 | ok: check, queue, recheck, charge, then release |
| WFL-13 | kit:RT/workflow_engine.mjs:97-114, 259-274 | ok: sha256 32 hex; label/phase/keep excluded; only ok/cached loaded |
| WFL-14 | kit:REF/paseo-runtime.md:390-392 | ok: definition, includes, and model mapping do not invalidate |
| WFL-16 | kit:RT/commands.mjs:775-805 | ok for the success path; failed runs omit result.json (R1-WFL-08) |
| WFL-18 | kit:RT/commands.mjs:726-806 | partial: flags and done/failed lines match; exit 1 vs 2 split is not what the behavior says (R1-WFL-08) |
| WFL-19 | kit:RT/commands.mjs:757-773 | ok: detach, log fd, `PASEO_HARNESS_LOG_IS_STDOUT`, watch hint |
| WFL-22 | kit:RT/prompts.mjs:7-9, 45-59, 72-84 | partial: return note, Run tag, and safety notes match; read-only predicate and include headers do not (R1-WFL-05) |
| WFL-23 | kit:RT/commands.mjs:653-661, 682-692 | ok: two-turn only, READY wait, then task; spawn is not in this function |
| WFL-25 | kit:RT/prompts.mjs:60-64 | ok: UTF-8 byte message |
| WFL-26 | kit:RT/daemon.mjs:12-15, 138-160 | ok: one continue, non-retryable regex, 3 question denies, empty reply is not here (that is commands.mjs:703) |
| WFL-27 | kit:RT/commands.mjs:632-635, 645, 710-716 | ok: one transport failure nulls later calls |
| WFL-28 | kit:RT/daemon.mjs:112-123 | wrong for env and labels: those are 126-127 (R1-WFL-12) |
| WFL-31 | kit:RT/watchdog.mjs:45-65 | ok: readiness table and the 15 KB Write comment |
| WFL-31 | kit:RT/watchdog.mjs:75-78 | wrong as cited by the "restarts whenever" sentence (R1-WFL-04) |
| WFL-32 | kit:RT/watchdog.mjs:70-72 | ok: late running of a finished call id is ignored |
| WFL-34 | kit:RT/watchdog.mjs:86-98 | partial: thresholds match; write clears repeats before the increment (R1-WFL-03) |
| WFL-35 | kit:project/.agents/harness.defaults.json:109-111 | ok: note plus nudge 900 and stop 1800 |
| WFL-36 | kit:REF/paseo-runtime.md:294-301 vs defaults 109-114 vs watchdog.mjs:122-138 | ok as a conflict on numbers and the two-step stop; more stale sentences in R1-WFL-19 |
| WFL-37 | kit:RT/commands.mjs:693-702 | ok: retry wait, then the same stop reason for every watchdog stop |
| WFL-41 | kit:SK/scripts/watch_run.mjs:1-64 | ok that line 64 is the 1 s loop and exit 0; the 60 s rule is directory-absent only (R1-WFL-11) |
| WFL-42 | kit:SK/scripts/run_stats.mjs:1-59 | partial: three-line format and kinds match; matching gaps in R1-WFL-17 |
| WFL-43 | kit:RT/commands.mjs:461-488 | partial: archive counts and exit 0/2 match; path is hard-coded (R1-WFL-06) |
| WFL-46 | wildera:.agents/workflows/review-gate.js:1-67 | partial: gate, schemas, and default-confirmed match; file continues to line 68; prompt/code clash in R1-WFL-16 |
| WFL-47 | wildera:_workspace/_runs/wf_20261015-011128_ecea/log.txt:1-13 | wrong count: three Write interrupts, not two (R1-WFL-09) |
| WFL-47 | same run.json:1-11 and journal.jsonl:1-2 | ok: stopped, agents null, pid kept; two journal rows |
| WFL-48 | kit:SK/scripts/workflow_engine.mjs:1-5 | ok: re-exports the named engine symbols |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| --- | --- | --- |
| kit:RT/workflow_engine.mjs | yes (319; file 320) | 2: phase match is `.title`; budget/cap consume `n` with no journal line; console is four methods only. Counted as part of R1-WFL-13 and R1-WFL-18 |
| kit:RT/watchdog.mjs | yes (150; file 151) | 2: write-before-count loop; inputAt not restarted when the new key is not ready (R1-WFL-03, R1-WFL-04) |
| kit:SK/scripts/workflow_engine.mjs | yes | 0 |
| kit:SK/scripts/watch_run.mjs | yes (64; file 65) | 2: hang when the directory exists without run.json; deadChecks not reset (R1-WFL-11) |
| kit:SK/scripts/run_stats.mjs | yes (59; file 60) | 4 matching gaps (R1-WFL-17) |
| kit:SK/scripts/runtime_regression.test.mjs | yes, workflow tests only | 0 beyond what those tests already support. The file also holds provider, MOD, and doctor tests the map correctly leaves to other areas |
| kit:REF/paseo-runtime.md §6 and workflow parts of §2, §4, §5, §9, §10 | yes | 2 incident/limit blocks not mapped: 15 MB read (276-278) and advisory tools/read-only (382-386) |
| kit:REF/workflow-recipes.md | yes | 1: non-Claude MCP adapter sentence left as KEEP (R1-WFL-20) |
| kit:REF/execution-modes.md | yes | 0 new; concern 20 already drops §5. Ask-first vs ph-only is WFL-44 and matches the owner memory |
| kit:CHANGELOG.md Unreleased and 0.1.0 workflow lines | yes | 0. The Unreleased clock rule is mapped. Concern 18's changelog vs test split is real; shipped defaults are `Agent`, `Workflow`, `SendMessage` (harness.defaults.json:59-63), which the concern does not cite |
| wildera:.agents/workflows/review-gate.js | yes (67; file 68) | 3: theoretical-vs-FORMAT, empty open, null verifier confirms all (R1-WFL-16) |
| wildera:_workspace/_runs sample | yes, one run | the cited run was read; the directory count and newest id in the table are stale (R1-WFL-21). Log prose undercounts interrupts (R1-WFL-09) |

Extra files the map used (commands.mjs workflow/archive/worktrees, prompts.mjs, daemon.mjs wait/usage/create, harness.defaults.json, worktrees.mjs) were checked at the cited ranges. Omissions found there are R1-WFL-05 through R1-WFL-08, R1-WFL-10, and R1-WFL-12, not missing scope rows.
