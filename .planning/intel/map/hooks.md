# Map: hooks (Claude Code hooks, reminders, project-owned hook coexistence)

Area code: HOK. Sources: `kit:` = paseo-harness-kit @ ref-final, `wildera:` = WildEraV6 @ 89143da.

## Coverage

| file | lines | read fully |
| --- | --- | --- |
| kit:project/.claude/hooks/context_guard.mjs | 108 | yes |
| kit:project/.claude/hooks/io_economy_guard.mjs | 257 | yes |
| kit:project/.claude/hooks/subagent_file_tools.mjs | 6 | yes |
| kit:project/.claude/hooks/test_context_guard.mjs | 70 | yes |
| kit:project/.claude/hooks/test_io_economy_guard.mjs | 221 | yes |
| kit:project/.claude/hooks/test_subagent_file_tools.mjs | 20 | yes |
| kit:templates/settings.hooks.json | 49 | yes |
| kit:project/.agents/harness.defaults.json (keys context_guard, io_guard in scope; whole file read, other keys belong to other areas) | 124 | yes |
| kit:blocks/AGENTS.md | 7 | yes |
| kit:README.md | 172 | yes (section "Context reminders and self-compaction" is 113-130) |
| kit:user/skills/kit-init/SKILL.md | 76 | yes (syntax-check part is section 4, 44-71) |
| wildera:.claude/settings.json | 82 | yes |
| wildera:.claude/hooks/context_guard.mjs | 108 | byte-identical to the kit file (`cmp`), so the kit read covers it |
| wildera:.claude/hooks/io_economy_guard.mjs | 257 | byte-identical to the kit file (`cmp`) |
| wildera:.claude/hooks/subagent_file_tools.mjs | 6 | yes (read; identical to kit) |
| wildera:.claude/hooks/bash_long_command.mjs | 40 | yes |
| wildera:.claude/hooks/syntax_check.mjs | 106 | yes |

Read for context only (outside scope, cited where used): kit:install.mjs 296-330 and 380-392 (hook merge), kit:project/.agents/harness/config.mjs 80-115 (validation), kit:CHANGELOG.md 1-60, kit:project/.agents/skills/harness/references/paseo-runtime.md 413-440 (section 11), owner memories main-session-no-native-subagents and no-kit-overrides-of-tool-settings.

## Summary

The area is three kit hooks plus the settings registration that wires them, and the pattern by which a project adds its own hooks next to them.
`context_guard.mjs` (PostToolUse `*` and UserPromptSubmit) reads the last assistant usage from the session transcript and, only for the main conversation, injects an `additionalContext` reminder at `start_pct` of the window and every `step_pct`, telling the model to run `ph compact-self`. It never compacts by itself.
`io_economy_guard.mjs` (PreToolUse on file tools, PostToolUse on file-lookup tools) scans the transcript tail for "rounds" (one assistant message with parallel tool calls) and reminds any session (workers too) to batch lookups and edits, not to re-read a file it just edited, and to fix the query after an empty or truncated search.
`subagent_file_tools.mjs` is a no-op stub left so old registrations stay harmless; the installer removes its registration.
All hooks are advisory: they exit 0 on any error and never block a call. Identity (main vs native child vs `ph` worker) is decided by hook-input fields and two environment variables, never by model name.
Deduplication across concurrent hook processes uses exclusive-create files in `os.tmpdir()`.
Project-owned hooks (WildEra: `syntax_check.mjs`, `bash_long_command.mjs`) sit in the same `.claude/settings.json` groups-by-event; the installer manages only three named kit scripts by file name and digest and leaves everything else alone.
Worth keeping in spirit: identity by role not by model, advisory-only reminders with once-per-band dedup, transcript-derived (not hook-count) state, never-block failure semantics, per-project syntax checks with before/after comparison, and the Windows long-command rescue.
The model-facing texts name `mcp__harness-files__*`, `fsbatch` and `filesystem` tools; that vocabulary needs revisiting for the new kit (file tools decision belongs to another area).

## Behaviors

### HOK-01 Hook registration template
- Behavior: `templates/settings.hooks.json` registers three entries, all `type: command`, `timeout: 10` (s), command `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.mjs"`:
  - PreToolUse, matcher `Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|mcp__filesystem__.*|mcp__fsbatch__.*|mcp__harness-files__.*` -> `io_economy_guard.mjs`.
  - PostToolUse, matcher `*` -> `context_guard.mjs`; PostToolUse, matcher `Read|Grep|Glob|mcp__filesystem__.*|mcp__fsbatch__.*|mcp__harness-files__.*` -> `io_economy_guard.mjs` (no Write/Edit in the Post matcher).
  - UserPromptSubmit, no matcher -> `context_guard.mjs`.
  - No registration for `subagent_file_tools.mjs` (legacy).
- Proposal: CHANGE. Keep the three triggers (Pre for I/O streaks, Post for result quality, Post `*` + UserPromptSubmit for context). Drop the `mcp__filesystem__`/`mcp__fsbatch__` matcher alternatives (non-Claude adapters dropped) and decide the file-tool vocabulary with the files area; keep `$CLAUDE_PROJECT_DIR` quoting.
- Source: kit:templates/settings.hooks.json:3-47
- Why it exists: not stated (UserPromptSubmit lets the reminder fire on a turn with no tool call; documented as PostToolUse and UserPromptSubmit in kit:project/.agents/skills/harness/references/paseo-runtime.md:419-420).
- Test idea: merge the template into an empty settings file; assert exactly these four hook entries, timeouts 10, and that `node` resolves each script under `$CLAUDE_PROJECT_DIR`.

### HOK-02 Installer reconciles only kit-owned hook registrations
- Behavior: `mergeHooks` reads `.claude/settings.json` (or `{}`), takes the template as `want`, defines managed scripts `subagent_file_tools.mjs`, `io_economy_guard.mjs`, `context_guard.mjs`, and identifies a hook only when `type === 'command'` and the command matches `/(?:^|[\\/])\.claude[\\/]hooks[\\/]([\w.-]+\.mjs)(?:["'\s]|$)/` (file name captured); any other spelling is treated as project-owned and the template group is appended beside it. A managed script that exists in the project and whose digest differs from the recorded installed digest, or for which the manifest records no digest, is "blocked": its registrations are kept unchanged, the template's registrations for it are not added, and `conflict .claude/hooks/<n>: local script differs; its registrations were kept unchanged` is printed; `install` and `update` return exit 2 when any hook is blocked (`wire` returns `blocked + skillConflicts`, so skill conflicts count too); per grep only `wire` (called at install.mjs:416 and 446) calls `mergeHooks`, so `status` and `pull` never touch hook registrations. For unblocked managed scripts, every existing registration (in any group of any event) is removed and the template's groups are appended. Groups left with no hooks are dropped. Other hooks, even in the same group, are preserved. The file is rewritten (2-space JSON, trailing newline) only when `JSON.stringify` of the settings object changed (install.mjs:325-326). The message `reconciled kit hook registrations in .claude/settings.json (unrelated hooks preserved)` is printed by `wire` unconditionally, even when nothing changed and even after conflict lines.
- Proposal: KEEP (the contract: own only named scripts, never touch project hooks, report local divergence). CHANGE the mechanism if the new kit ships hooks as a plugin or generated settings; the managed list drops `subagent_file_tools.mjs` unless old projects must be cleaned.
- Source: kit:install.mjs:301-328, 387-398, 416-420, 446-449
- Why it exists: README promises "merges kit hooks without replacing unrelated settings" (kit:README.md:49); kit-init states "The installer manages only its own hook files, so this project-owned hook survives kit updates" (kit:user/skills/kit-init/SKILL.md:71).
- Test idea: settings with a project hook sharing a group with the kit hook, plus a locally edited `context_guard.mjs`; run update; assert project hook intact, local-edited script's registration unchanged, exit 2.

### HOK-03 Main-session identity (context guard)
- Behavior: `isMainAgent(input, env)` is true only when the hook input has none of `agent_id`, `agentId`, `parent_agent_id` AND env has no `PASEO_HARNESS_LEADER` AND `PASEO_HARNESS_ROLE !== 'worker'`. `agent_type` is deliberately not identity (a main session started with `--agent` carries it and is still main). So: native child (agent_id/agentId/parent_agent_id in input) -> not main; `ph` worker (env set by the daemon) -> not main; named `--agent` main session -> main. Model name plays no part.
- Proposal: KEEP.
- Source: kit:project/.claude/hooks/context_guard.mjs:12-16; kit:project/.claude/hooks/test_context_guard.mjs:20-26; env set for workers at kit:project/.agents/harness/runtime/daemon.mjs:126 (grep line, `PASEO_HARNESS_LEADER: CALLER, PASEO_HARNESS_ROOT: ROOT, PASEO_HARNESS_ROLE: "worker"`); `kit:project/.agents/harness/runtime/common.mjs:9` only reads `PASEO_HARNESS_LEADER` into `LEADER` (the worker env is set only at daemon.mjs:126)
- Why it exists: a model-name regex (`context_guard.model_pattern`) was replaced because it did not describe the role; the loader now ignores that key with a warning (kit:CHANGELOG.md:33; kit:project/.agents/harness/config.mjs:29, 110-111).
- Test idea: table test over `{}`, `{agent_type}`, `{agent_id}`, `{agentId}`, `{parent_agent_id}`, env LEADER, env ROLE=worker, asserting main/not-main as above.

### HOK-04 Context usage read from the transcript
- Behavior: `lastUsage(transcriptPath)` reads the last 1 MiB (`TAIL_BYTES`) of the transcript, splits on newline, walks from the end, considers only lines containing the substring `"usage"`, parses each (parse error -> skip), and accepts the first entry with `type === 'assistant'`, not `isSidechain`, no `agentId`, a `message.usage`, and `message.model !== '<synthetic>'`. `used = input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (missing = 0; output tokens are not counted); a non-finite or negative sum is skipped. Window = `usage.context_window ?? usage.contextWindowMaxTokens ?? null`. Returns `null` when none found (hook then does nothing). A sidechain line newer than the main line is ignored.
- Proposal: KEEP; re-verify the real transcript field names for the window in the new Claude Code version (the sources only prove the test fixture and these two names).
- Source: kit:project/.claude/hooks/context_guard.mjs:10, 18-36; kit:project/.claude/hooks/test_context_guard.mjs:47-50
- Why it exists: sidechain/synthetic usage would report a child's or a placeholder's size as the main context; stated in the code only as the filters (no incident cited).
- Test idea: transcript whose last line is a sidechain assistant with huge usage and an earlier main line with 600000; assert `used` is 600000; a `<synthetic>` last line is skipped.

### HOK-05 Band computation and validation
- Behavior: `contextBand(used, cfg, window)`: size = reported window if finite and > 0, else `cfg.window_tokens`. Throws `context_guard needs a positive window and step, and start_pct between 0 and 100` when size is not positive/finite, `start_pct` not finite or <= 0 or > 100, or `step_pct` not finite or <= 0. `pct = 100*used/size`; `band = -1` if `pct < start_pct`, else `floor((pct - start_pct)/step_pct)`. Defaults 1,000,000 / 60 / 5: 599,999 -> -1; 600,000 -> 0; 650,000 -> 1; with a reported window 200,000, 120,000 -> band 0.
- Proposal: KEEP.
- Source: kit:project/.claude/hooks/context_guard.mjs:38-46; kit:project/.claude/hooks/test_context_guard.mjs:27-32; kit:project/.agents/harness.defaults.json:97-101
- Why it exists: Claude Code sessions run different windows (the model ids carry `[1m]`); reported window wins, config is only the fallback (kit:README.md:119-120).
- Test idea: the five numeric cases above plus `step_pct: 0` throwing.

### HOK-06 Per-session band state and reset
- Behavior: state file `<tmpdir>/ph-context-guard-<key>.json`, key = first 24 hex chars of SHA-256 of `session_id` (fallback `transcript_path`). Content `{band, pct}`. Previous band read (missing/corrupt -> -1). If current band < 0: rewrite state to `{band:-1,pct}` only when previous was not -1, emit nothing (so the next crossing of the threshold reminds again, e.g. after compaction). If `band <= prev` emit nothing. Otherwise (after the claim, HOK-07) write `{band, pct}` and emit. A band that falls but stays >= 0 does not lower the stored band (a compaction that lands at 62% after a reminder at band 3 stays silent until band 4).
- Proposal: KEEP the once-per-band semantics; CHANGE (consider) lowering the stored band on any downward move so a partial compaction re-arms the reminder. Also prune old state files (never cleaned).
- Source: kit:project/.claude/hooks/context_guard.mjs:55-63, 86-88; kit:project/.claude/hooks/test_context_guard.mjs:33-44
- Why it exists: avoid repeating the reminder on every tool call; reset so a later growth is reminded again (test "reset", test line 67).
- Test idea: usage 600000 -> reminder; again -> silent; 650000 -> reminder (65%); 1000 -> silent and state reset; 600000 -> reminder again.

### HOK-07 Claim lock against parallel hook processes
- Behavior: before issuing a reminder, create `<stateFile>.claim` with `openSync(...,'wx')` (up to 2 attempts). On EEXIST: read the claim's `pid`; if it is a positive safe integer and `process.kill(pid,0)` throws ESRCH the claim is abandoned; if the claim is unreadable/not JSON, it is abandoned when its mtime is older than 60 s; an abandoned claim is unlinked and retried; a live/fresh claim -> return null (stay silent). Winner writes `{pid}` into the claim, re-reads the state (another process may have written the band meanwhile), returns null if `band <= prev`, else writes state; in `finally` closes and unlinks the claim. If no fd obtained, null. Any non-EEXIST error propagates (-> stderr, exit 0).
- Proposal: KEEP the guarantee (one reminder per band even with parallel PostToolUse hooks); CHANGE the mechanism to something simpler if desired (a single atomic state write via `wx` plus rename), since the PID/mtime recovery is heavy.
- Source: kit:project/.claude/hooks/context_guard.mjs:64-92; kit:project/.claude/hooks/test_context_guard.mjs:51-62
- Why it exists: comment "Parallel PostToolUse hooks must not issue the same reminder twice." (context_guard.mjs:64). Crashed-claim recovery covered by tests (live pid, exited pid, empty claim older than 120 s).
- Test idea: spawn 6 hook processes concurrently at band 0; exactly one outputs a reminder; plant a claim with a dead pid and one with an active pid and assert recover/silence.

### HOK-08 Context reminder text and output shape
- Behavior: message (single line): `Context guard: this main session uses <round(pct)>% of its context (<used>/<window> tokens; threshold <start_pct>%). At the next natural break (no edit half-done, no background job or Monitor still running), compact yourself: run \`node .agents/skills/harness/scripts/paseo_harness.mjs compact-self --focus "<what to keep>"\` and end the turn. You will be reminded again at the next <step_pct>% step.` Output JSON on stdout: `{hookSpecificOutput:{hookEventName: input.hook_event_name || 'PostToolUse', additionalContext: msg}}`. Not a notification, not forced compaction.
- Proposal: CHANGE text to the new kit's compaction command (`ph compact-self` path) and to the single approved orchestration vocabulary; keep "no edit half-done, no background job/Monitor running" (see HOK-12).
- Source: kit:project/.claude/hooks/context_guard.mjs:93-97; kit:README.md:118-130
- Why it exists: owner 2026-10-02 "the orchestrator compacts itself instead of asking the owner to type /compact" (kit:project/.agents/skills/harness/references/paseo-runtime.md:415-416).
- Test idea: at 650000/1,000,000 the message matches `/65%/` and `/650000\/1000000/`; with a reported window of 200000 and usage 120000 it contains `120000/200000`.

### HOK-09 Context guard failure behavior and root resolution
- Behavior: executed as a script only when `process.argv[1]` equals the module path; reads stdin JSON, calls `runGuard`, writes JSON only if a result exists. Any exception (bad JSON, missing/unreadable transcript, invalid config) is caught: writes `context guard unavailable: <message>` to stderr, exit 0, no stdout. `runGuard` returns null when not main or no `transcript_path`. Config root = `PASEO_HARNESS_ROOT || CLAUDE_PROJECT_DIR || input.cwd || process.cwd()`; config `context_guard` from the shared loader (defaults + project overlay).
- Proposal: KEEP (never block; make misconfiguration visible on stderr).
- Source: kit:project/.claude/hooks/context_guard.mjs:48-52, 100-108; kit:project/.claude/hooks/test_context_guard.mjs:63-66
- Why it exists: comment "Nonblocking, but configuration/installation failures are observable in hook logs." (context_guard.mjs:105).
- Test idea: run the script with an agent_id input -> status 0, empty stdout; run with a broken overlay -> status 0, stderr contains `context guard unavailable`.

### HOK-10 Context guard config keys
- Behavior: `context_guard` in `.agents/harness.defaults.json`: `window_tokens` 1000000 (fallback window), `start_pct` 60, `step_pct` 5. The object is a merged key (project overlay overrides single fields). The old overlay key `context_guard.model_pattern` is stripped on load and silently ignored by `loadConfig`; the warning `context_guard.model_pattern is deprecated and ignored; main/worker identity controls compaction reminders` is built by `configProvenance` and printed only by `ph doctor` (`note <warning>`) and embedded in `ph config` (`_provenance`); the hook never prints it. Validation (loader): all three integers; `window_tokens >= 1`; `start_pct` and `step_pct` each 1..100; unknown or missing keys fail.
- Proposal: KEEP the three keys and defaults (the 1M default matches the `[1m]` models); DROP `model_pattern` handling (no migration needed in a from-scratch kit).
- Source: kit:project/.agents/harness.defaults.json:97-101; kit:project/.agents/harness/config.mjs:12, 29, 43, 88-91, 104-111; kit:project/.agents/harness/runtime/commands.mjs:60-62, 89
- Why it exists: see HOK-03.
- Test idea: overlay `{context_guard:{start_pct:50}}` merges with the default step; `start_pct: 0` or 101 fails validation naming `context_guard.start_pct`.

### HOK-11 Context guard runs on every tool call
- Behavior: registered with matcher `*` on PostToolUse, so a node process starts after every tool call of every session (main, native child, worker) and exits quietly unless the session is main and crosses a band; it also runs on UserPromptSubmit. Cost per call: node start and stdin parse for every session; the identity check comes first, so only main sessions with a `transcript_path` pay the config load, the transcript tail read (<= 1 MiB) and the state read.
- Proposal: OPEN: keep as is, or reduce the cost (narrow the matcher, or check cheap identity first before opening the transcript; identity is already checked first in `runGuard`, so only node startup remains). Decided with the files/install areas.
- Source: kit:templates/settings.hooks.json:15-25, 37-46; kit:project/.claude/hooks/context_guard.mjs:48-52
- Why it exists: PostToolUse sees growth during a long tool loop, UserPromptSubmit catches idle growth (not stated explicitly beyond paseo-runtime.md:419-420).
- Test idea: measure hook wall time over a 1 MiB transcript; assert under the 10 s timeout by a wide margin.

### HOK-12 What the context reminder is for (self-compaction flow)
- Behavior: the reminder asks the model to call `ph compact-self --focus "<what to keep>"` at a natural break and end its turn. The detached watcher then waits until the turn ends, sends `/compact [focus]` once, counts success only when used tokens fall below half of the value before, then sends `compact_resume` (default `Compaction done. Continue where you left off; re-arm any Monitor you stopped.`) or `--resume`; otherwise sends a "NOT confirmed" message and does not retry. Rules the reminder inherits: stop Monitors and background commands first (a notification arriving during compaction cancels it); compact earlier before a phase that would pass about 80%; `ph context --self` reports usage on demand; Claude Code's native autocompact is a separate setting not overridden. Success is measured on Paseo's `lastUsage.contextWindowUsedTokens` (before vs after), not on the transcript sum of HOK-04; the resume text is `--resume`, else config `compact_resume`, else the built-in constant `Compaction done. Continue where you left off.`
- Proposal: KEEP the reminder-plus-self-compaction pair (owner's use: main orchestrator with a 1M window). Implementation of `compact-self` belongs to the runtime area.
- Source: kit:project/.agents/skills/harness/references/paseo-runtime.md:413-440; kit:README.md:122-130; kit:project/.agents/harness.defaults.json:96; kit:project/.agents/harness/runtime/commands.mjs:355 (half ratio), 386-398 (arming; resume fallback chain at 393), 421-422 (wait-failed text, `/compact` NOT sent), 426-428 (usage before, `/compact` send), 437-441 (done when used < 0.5 x before, then resume), 447-448 (NOT confirmed)
- Why it exists: owner 2026-10-02; verified 2026-10-03 on a Luna agent, 46,056 -> 946 used tokens (paseo-runtime.md:413-416).
- Test idea: end-to-end with a fake agent: reminder -> compact-self -> resume message appears after usage drops; failure path sends the NOT-confirmed message.

### HOK-13 io guard: which tools count
- Behavior: three sets.
  - LOOKUP: native `Read`, `Grep`, `Glob`; `mcp__fsbatch__read_ranges`; `mcp__harness-files__{read_ranges, read_file, read_text_file, read_multiple_files, read_media_file, list_directory, list_directory_with_sizes, directory_tree, search_files, get_file_info}`; `mcp__filesystem__{read_text_file, read_file, read_media_file, read_multiple_files, list_directory, list_directory_with_sizes, directory_tree, search_files, get_file_info}`.
  - MUTATING: `Edit`, `MultiEdit`, `Write`, `NotebookEdit`; `mcp__fsbatch__{edit_multiple_files, write_multiple_files}`; `mcp__harness-files__{edit_multiple_files, write_multiple_files, edit_file, write_file, move_file, create_directory}`; `mcp__filesystem__{edit_file, write_file, move_file, create_directory}`.
  - RESULT (post checks): `Grep`, `Glob`, `mcp__filesystem__search_files`, `mcp__harness-files__search_files` (not fsbatch).
  Any other tool name exits 0 at once (no output).
- Proposal: CHANGE to `Read/Grep/Glob/Edit/MultiEdit/Write/NotebookEdit` plus whatever batch tools the new kit ships (harness-files family only if kept); DROP `mcp__fsbatch__*` and `mcp__filesystem__*` (non-Claude adapters dropped by owner).
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:30-46, 237
- Why it exists: not stated beyond the owner request that created the hook (HOK-14 header).
- Test idea: a call to `Bash` or `mcp__filesystem__list_allowed_directories` yields empty stdout and exit 0.

### HOK-14 io guard: transcript rounds model
- Behavior: reads the last 1 MiB of the transcript (`tailLines`; the first, possibly cut, line fails JSON parse and is skipped). Skips entries with `isSidechain` or `isMeta`. A `user` entry that is a real prompt (string content non-empty, or non-empty array content with no `tool_result` block) clears all rounds and sets `promptKey` = `uuid ?? timestamp ?? line<i>`; initial `promptKey` is `tail-start`. Other `user` entries record `tool_result` ids. An `assistant` entry's `tool_use` blocks are grouped into one round by `message.id` (fallback entry `uuid`); a round tracks tool_use ids, `lookup`, `mutating`, `fileCalls` (+1 per lookup or mutating call) and edited paths. A round is finished when every tool_use id has a result; unfinished rounds are "in-flight" and never counted in streaks, but their `fileCalls` are summed. Rounds with neither tool kind (Bash, Agent) are skipped by the lookup streak but they break the edit streak (HOK-16, HOK-17). Context: a round = one assistant message, its parallel calls share the id.
- Proposal: KEEP the model (transcript-derived rounds, in-flight exclusion); re-verify the transcript schema of the target Claude Code version (one line per content block, shared message id, `isSidechain`, `isMeta`).
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:13-17, 95-142; kit:project/.claude/hooks/test_io_economy_guard.mjs:1-5, 111-116, 131-134
- Why it exists: parallel siblings must not count each other as earlier rounds (header comment 15-16; test "in-flight sibling calls do not count as a previous round"). Transcript "may lag behind the hook" (line 7), best effort.
- Test idea: transcript with START-1 finished lookup rounds plus an in-flight round of 2 parallel calls; the reported round number equals START, not START+1.

### HOK-15 io guard: first file round of a prompt
- Behavior: on PreToolUse, when no finished round of the current prompt holds a lookup or mutating call, claim `first|<promptKey>`. The claim is consumed even if nothing is said. The prune of old claims runs only here. If the claim succeeded and `inFlightFileCalls < 2`, emit `firstLookup` (current tool is a lookup) else `firstEdit`. When `inFlightFileCalls` (the sum of `fileCalls` over every unfinished round, not one round) is 2 or more (model already batching) it stays silent. Said once per prompt; the next prompt (new `promptKey`) says it again.
- Proposal: KEEP.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:7-9, 140-141, 189-192; kit:project/.claude/hooks/test_io_economy_guard.mjs:75-98
- Why it exists: nudge the model to plan the whole lookup set / all edits in one turn (owner requests 2026-10-04, header lines 2-3).
- Test idea: first Grep of a prompt gets the planning text once; the second hook run for the same prompt is silent; an in-flight round of Grep+Glob suppresses it.

### HOK-16 io guard: lookup streak
- Behavior: for a lookup-tool call, `n = lookupStreak(previous) + 1` where lookupStreak counts finished rounds containing a lookup, walking back from the newest and stopping at the first round that is mutating (also when it mixes lookups); rounds with neither tool kind are skipped. `band = n < start_rounds ? -1 : floor((n - start_rounds)/step_rounds)`. Speaks `lookupStreak(n)` when band >= 0 and the claim `lookup|<promptKey>|<segment>|<band>` is new, where `segment` = number of mutating finished rounds. So once per band per segment between edits. Defaults start 2, step 2: speaks on lookup rounds 2, 4, 6...
- Proposal: KEEP; CHANGE only the batching vocabulary in the text.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:144-151, 162, 194-199; kit:project/.agents/harness.defaults.json:102-107
- Why it exists: stop one-small-read-per-turn loops (the first_prompt_note and watchdog `watchdog_reads_without_write` target the same habit, kit:project/.agents/harness.defaults.json:91, 117).
- Test idea: START-1 prior lookup rounds -> text names round START; START-2 -> silent; one band spoken once; an Edit round or a new prompt resets.

### HOK-17 io guard: edit streak
- Behavior: for a mutating-tool call, `run = editStreak(previous)` = number of directly preceding finished rounds that are mutating and contain no lookup (any other round, including Bash or a mixed round, ends the run); `n = run + 1`; band from `edit_start_rounds`/`edit_step_rounds`; claim `edit|<promptKey>|<previous.length - run>|<band>`. Speaks `editStreak(n)` suggesting one call to the batch edit/write tools. Defaults start 2, step 2.
- Proposal: KEEP.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:153-160, 201-207; kit:project/.claude/hooks/test_io_economy_guard.mjs:135-153
- Why it exists: one edit call per round wastes turns; same owner request.
- Test idea: ESTART-1 preceding edit rounds -> text `edit round ESTART in a row`; a Bash or lookup round in between breaks it.

### HOK-18 io guard: re-read of an edited file
- Behavior: for a lookup call, collect the files edited by finished rounds of the current prompt (`editedPaths`) and the files this call reads (`readPaths`); intersection -> claim `reread|<promptKey>|<paths joined>` -> emit `reread(files)`: `<files> was edited earlier in this task. Edit and Write error when a change fails, so do not re-read the file to verify it; run the checks the task names. Read it again only for parts you have not seen yet.`
  - Edited paths: Edit/MultiEdit/Write `file_path`; NotebookEdit `notebook_path`; batch edit/write tools `files[].path`; single edit/write `path`; move_file `destination`; harness-files names are mapped onto the fsbatch/filesystem shapes. `create_directory` counts as mutating but yields no path.
  - Read paths: `Read` `file_path` (a Read with `limit === 1` is exempt); `read_ranges` `ranges[].path`; read_text_file/read_file/read_media_file `path`; read_multiple_files `paths`. Grep/Glob/list tools yield none.
  - Path normalization: backslashes to `/`, relative paths joined to the hook `cwd`, `posix.normalize` (dot segments), lowercased, so case and slash direction do not matter.
  Edits from before the last user prompt do not count.
- Proposal: KEEP (the rule, "Edit/Write error on failure, do not re-read to verify", is the same as the AGENTS.md block); lowercasing is a tolerated false-positive on case-sensitive systems (Windows owner).
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:56, 63-93, 209-213; kit:project/.claude/hooks/test_io_economy_guard.mjs:154-175, 207-212
- Why it exists: avoid tokens spent re-reading to verify a successful edit (kit:blocks/AGENTS.md:6).
- Test idea: edit `C:\Work\Spec.md`, then Read `c:/work/spec.md` -> flagged; `limit: 1` -> silent; relative `./sub/../Spec.md` with cwd `C:\Work` -> flagged.

### HOK-19 io guard: empty or truncated search result (PostToolUse)
- Behavior: only for RESULT tools. `tool_response` r; text = r if string else `JSON.stringify(r ?? '')`. Truncated first: `r.truncated === true` or the last 600 chars of text match `/\(Showing \d+ of \d+|more are not listed|with pagination = limit/i` -> message `truncated`: narrow path/pattern or set head_limit and offset on Grep in the next batched call, do not repeat the same wide listing. Else empty: object with `numFiles === 0` and no non-blank string `content`, no `filenames`, and not `numLines > 0` (a content-mode Grep with real content is not empty), or text shorter than 200 chars matching `/\b(No files found|No matches found)\b/i` -> message `empty`: suspect the query before concluding the target does not exist (glob syntax one brace group no nesting no spaces, search root, case, regex escaping) and fix it inside the next batched call. No claim: it speaks on every such result. No streak messages in PostToolUse. Read results are ignored.
- Proposal: KEEP; the glob advice ("one brace group, no nesting, no spaces") is a Claude Code Glob behavior to re-verify; add the response shape of the target version.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:57-61, 217-233; kit:project/.claude/hooks/test_io_economy_guard.mjs:176-197
- Why it exists: not stated (rationale in the messages: avoid concluding absence from a bad query, avoid repeated wide listings).
- Test idea: `No matches found` string, `{numFiles:0,filenames:[]}`, content-mode with content (silent), a 100-line list ending `(Showing 100 of 257 ...)` (truncated).

### HOK-20 io guard: claim files, session directory, pruning
- Behavior: dir `<tmpdir>/ph-io-guard-<first 8 chars of session_id (default 'x')>`; a claim = file named by the first 16 hex chars of SHA-1 of the claim key, created with flag `wx`; creation success = permission to speak; any error = no speak. Parallel hooks of one round therefore speak once. `prune` deletes files older than 24 h (`CLAIM_MAX_AGE_MS`), run only when the first-round claim succeeds.
- Proposal: KEEP the exclusive-create dedupe; CHANGE the 8-char session prefix (collision risk between sessions with equal prefix; use the full id hash like context_guard).
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:18-20, 31, 164-180, 249
- Why it exists: hooks of one parallel round run concurrently (header 18-19; tests "the parallel hooks of one round speak once", test lines 84-91).
- Test idea: 6 concurrent hook processes on the same payload -> exactly one non-empty output.

### HOK-21 io guard: event dispatch, output and failure behavior
- Behavior: reads stdin JSON. Exit 0 silently for any tool outside LOOKUP and MUTATING. Event = `hook_event_name`, else `PostToolUse` if the input has `tool_response`, else `PreToolUse`. PostToolUse -> `postMessages` (needs no transcript or config). PreToolUse -> only when `transcript_path` exists: load `io_guard` config with root `PASEO_HARNESS_ROOT || CLAUDE_PROJECT_DIR || input.cwd || process.cwd()`; a config error writes `io economy guard unavailable: <message>` to stderr and exits 0; then `preMessages`. Output when there are messages: one JSON on fd 1 `{hookSpecificOutput:{hookEventName: event, additionalContext: messages.join('\n')}}`. Any other exception (bad JSON, missing transcript) -> exit 0, no output, no stderr. In PreToolUse the context reaches the model together with that call's result. The hook never returns a permission decision and never blocks.
- Proposal: KEEP.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:5-6, 22, 235-257; kit:project/.claude/hooks/test_io_economy_guard.mjs:198-205
- Why it exists: "Never blocks a tool call: any error exits 0 without output" (header line 22).
- Test idea: `{not json` and a nonexistent transcript path both give status 0 and empty stdout.

### HOK-22 io guard config keys
- Behavior: `io_guard` in `.agents/harness.defaults.json`: `start_rounds` 2 (lookup rounds in a row before the first reminder), `step_rounds` 2 (then every step), `edit_start_rounds` 2, `edit_step_rounds` 2. Merged key (overlay may override single fields); all four required, unknown nested keys fail (`unknown key`); every field must be a nonnegative safe integer (a negative fails with `expected a nonnegative safe integer`, so it never reaches the band math); only `step_rounds` and `edit_step_rounds` have the extra `>= 1` check, so 0 is legal for the two starts. With start 0 and step 2 the bands are 0, 1, 1, 2 for n = 1, 2, 3, 4 (speaks at n = 1, 2, 4, 6...), not on every call.
- Proposal: KEEP keys and defaults; decide whether a start of 0 (reminder from the first round) is allowed and validate accordingly.
- Source: kit:project/.agents/harness.defaults.json:102-107, 2 (`_notes` io_guard text); kit:project/.agents/harness/config.mjs:12, 44, 55-56, 80-86, 92; kit:project/.claude/hooks/io_economy_guard.mjs:162
- Why it exists: owner request 2026-10-04 (io_economy_guard.mjs:2-3).
- Test idea: overlay `{io_guard:{start_rounds:3}}` merges; `step_rounds: 0` fails naming `io_guard.step_rounds`; `start_rounds: -1` fails the integer check; an unknown `io_guard.foo` fails.

### HOK-23 io guard message texts and their vocabulary
- Behavior: every message starts with `File I/O (AGENTS.md): `. Texts: `firstLookup` (list everything the task needs, cover it in as few rounds as possible, add a round only for targets the results make necessary), `firstEdit` (think through every change first, apply all in one turn), `lookupStreak(n)` (`this is lookup round <n> in a row with nothing edited in between`), `editStreak(n)` (`this is edit round <n> in a row with nothing looked up in between`), `reread(files)` (HOK-18), `empty`, `truncated` (HOK-19). The batching advice `BATCH_HOW` is fixed text: one Grep with alternation, one Glob with a single brace group (no nested braces, no spaces), `mcp__harness-files__read_ranges` or `read_multiple_files` for several files when the direct file mod is enabled, otherwise native Read; edit advice names `mcp__harness-files__edit_multiple_files` and `write_multiple_files`. The text does not check whether the mod is actually enabled.
- Proposal: CHANGE: rewrite texts for Claude Code native tools plus the new kit's batch tools only; keep the prefix, the "fix the query inside the next batched call" idea and "Correctness over fewer calls" (see HOK-24). Texts are model-facing and cost tokens: keep each one sentence-short.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:48-59
- Why it exists: they restate the AGENTS.md File I/O block as just-in-time reminders (header line 2-3).
- Test idea: assert each message begins with the prefix and mentions only tools that exist in the new kit's tool list.

### HOK-24 AGENTS.md "File I/O" block
- Behavior: a five-bullet kit block in AGENTS.md: (1) Grep for content, Glob for filenames, combine independent lookups; (2) read relevant functions or sections, batch known targets, more discovery rounds when needed; (3) prefer batch edits for related changes, whole-file writes for new files or substantial rewrites; (4) do not re-read solely to verify a successful write, run the relevant checks, re-read when context or native-tool prerequisites require; (5) correctness takes priority over fewer tool calls.
- Proposal: KEEP (adapt tool names); it is the policy the io guard enforces. DROP nothing from it; the kit's other earlier blocks (Writing Principles, Dependencies) were already removed.
- Source: kit:blocks/AGENTS.md:1-7; kit:CHANGELOG.md:25
- Why it exists: owner requests 2026-10-04 (io_economy_guard.mjs:2-3); bullet 4 prevents the re-read-to-verify waste that HOK-18 flags.
- Test idea: install into a fresh project; AGENTS.md contains the block once and an update does not duplicate it.

### HOK-25 Legacy `subagent_file_tools.mjs` stub
- Behavior: the file only calls `process.stdin.resume()` and ends when stdin closes: no output, no stderr, exit 0, for any tool, main or worker (`PASEO_HARNESS_LEADER` set or not). Comment: kept as compatibility entry for older project settings; native file tools keep Claude Code permissions, read state, media support and cancellation; the installer removes only this kit-owned registration; do not deny native tools while the direct file mod is inactive or a native helper cannot use it. Earlier versions evidently redirected sub-agents to non-native file tools (inferred from the comment and the test title; the old body is not in the scope).
- Proposal: DROP (no legacy projects in a from-scratch kit; the new kit must not block native file tools).
- Source: kit:project/.claude/hooks/subagent_file_tools.mjs:1-6; kit:project/.claude/hooks/test_subagent_file_tools.mjs:1-20; kit:install.mjs:307; wildera:.claude/hooks/subagent_file_tools.mjs:1-6
- Why it exists: a registration left in already-installed projects must stay harmless until the installer removes it.
- Test idea: n/a (absent in the new kit); assert no hook in the template can deny `Read/Edit/Write`.

### HOK-26 Project-owned syntax-check hook, as specified by kit-init
- Behavior: the kit ships no syntax hook. The `kit-init` skill makes the agent write `.claude/hooks/syntax_check.mjs` (Node stdlib) for the project's own languages and register it on PreToolUse and PostToolUse, matcher `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_.*`, timeout about 30 s, merged into existing settings without replacing other hooks. Checker choices: TypeScript parse of the edited file only (`ts.transpileModule` or `createSourceFile`, no full `tsc`), JS `node --check`, JSON `JSON.parse`, C/C++ `clang -fsyntax-only`/`g++ -fsyntax-only` with flags from `compile_commands.json` (else ask or skip), Python `py_compile`, others only if the toolchain checks one file cheaply. Rules: (1) compare before/after: Pre checks each target and stores the result under `os.tmpdir()` keyed by session and `tool_use_id`, Post checks again and reports only a file that passed before and fails after, or a new file that fails; (2) hence files the checker never understood (JSONC, JSX, odd macros) stay silent; (3) never block: report via PostToolUse `hookSpecificOutput.additionalContext` with file, line:column and message (a few lines); exit 0 on any internal error or timeout; (4) targets: `file_path` of Edit/MultiEdit/Write, `files[].path` of `edit_multiple_files`/`write_multiple_files`, `path` of `edit_file`/`write_file`; skip extensions without a checker before spawning anything. Verify with a scratch file edited into a syntax error through a real tool call in a new session, or by feeding the hook a hand-made hook JSON on stdin, then delete the scratch file (SKILL.md:69-70).
- Proposal: OPEN: keep as a skill-generated project hook (old way), or ship a generic kit hook shell (before/after compare, never-block, budget, cache, slot limit as in HOK-27) with the checker command supplied by the project adapter. Recommendation: ship the shell, adapter supplies the checker per extension.
- Source: kit:user/skills/kit-init/SKILL.md:44-71; kit:README.md:56-58; kit:CHANGELOG.md:9
- Why it exists: each project has different languages and tools, so a kit-wide checker is wrong; rule 1 avoids reporting pre-existing failures.
- Test idea: hook fed a hand-made Pre then Post JSON for a file edited from valid to invalid reports once; a file invalid before and after is silent; a checker crash exits 0.

### HOK-27 WildEra syntax_check.mjs (the realized project hook)
- Behavior: targets = `file_path`, `path`, `files[].path` of the tool input, resolved against `input.cwd`, kept only when the extension is `.cpp` or `.h` and the path has a `game/` directory segment; none -> exit 0. The owning repo of the first file = nearest ancestor holding `game/WildEra.uproject` and `tools/ue/cpp_check.mjs` (fallback cwd); the checker module is imported from that repo (an edit inside a git worktree must use the worktree's tools; 2026-10-16: every W3 worktree edit was skipped as "not in a WildEra module"). PreToolUse: check each file (`status` per file) and write `pre-<session_id>-<tool_use_id>.json` (default `x`) to `<tmpdir>/wildera-syntax-check`. PostToolUse: read and delete that file; for each file whose before-status was not `error`, check again; `status === 'error'` -> report the first 6 errors as `file:line:col: message`. Then, even if the C++ check failed before, run `tools/ue/layer_lint.mjs --file <f>` (a bare `spawnSync` outside the slot and the cache, run only when the file exists and `remaining() > 1000`, timeout = remaining budget, 4 MiB buffer); reported only when `!layer.error && status === 1` and stdout contains `|` (a spawn timeout or error is silent) as `Layer check found new findings:` plus stdout (baseline identities already distinguish new layer findings). Output: PostToolUse `additionalContext` `C++ / layer check found new errors after this edit:\n<reports>`. Limits: total budget `BUDGET_MS` 75000 from process start, shared by both tools (some agent runtimes do not enforce the hook timeout and a batch edit of many files once blocked an agent 15 minutes; leftover files are skipped, not checked); the following slot, cache and 10 s rules apply only to the C++ checker (`cpp_check.checkFile` through `check`/`withSlot`), not to `layer_lint`: a C++ check starts only if >= 10 s remain; results cached by SHA-1 of file content as `<sha>.json` (status `skip` is never cached); at most `MAX_PARALLEL` 3 checks machine-wide through `slot-<i>.lock` files (stale after 180 s, wait up to 20 s or the remaining budget, busy -> skip silently). A missing file has status `absent`. Any `hook_event_name` other than exactly `PreToolUse` takes the Post path; the checker repo comes from `repoOf(files[0])` only (a batch spanning two repos uses the first one's tools); the `.cpp`/`.h` and `game` segment tests are case-insensitive; targets are deduped. Everything is wrapped so an error exits 0.
- Proposal: CHANGE: this is adapter material (UE C++ specifics: cpp_check, layer_lint, `game/` path) and stays in the project; the generic mechanics (before/after state, budget, machine-wide slots, content-hash cache, worktree-owner resolution) feed the generic shell proposed in HOK-26 (the budget is hook-wide; the slot cap and the content cache belong to the per-extension checker, not to every tool the hook spawns).
- Source: wildera:.claude/hooks/syntax_check.mjs:1-106
- Why it exists: stated in comments at lines 5-6, 16-18, 41, 67-68, 91-92.
- Test idea: two concurrent hook runs with MAX_PARALLEL 3 and slow checkers: never more than 3 running; a batch of 40 files returns before 75 s; an edit inside a worktree uses that worktree's checker.

### HOK-28 WildEra bash_long_command.mjs (Windows long-command rescue)
- Behavior: PreToolUse hook for `Bash`. The script has no `process.platform` check (it acts on any OS); the scenario in its comment is Windows, where Claude Code passes the command through a command line capped near 8191 chars (each `'` grows to `'\''`) and `\\` becomes `\` on that path; a longer command is cut off ("unexpected EOF while looking for matching"), a `\\` command runs altered. The hook input still has the command as written, so when `len + 3 * count(')` > 6000 or the command contains `\\`, it writes the command (CRLF -> LF, trailing newline) to `<tmpdir>/claude-bash-commands/<sha1[0..16]>-<pid>.sh`, prunes files older than 1 day, and returns `hookSpecificOutput.updatedInput` with `command: source '<path with forward slashes>'` (other tool_input fields kept). The command thus runs unchanged in the same shell/cwd/env and no tokens are spent regenerating it. Never blocks; exits 0 on any error; non-Bash input exits 0. A non-string `tool_input.command` exits 0 like a non-Bash tool; `hookEventName` is hardcoded `PreToolUse`; the path inside `source '<path>'` is not quote-escaped. Registered on PreToolUse matcher `Bash`, timeout 10.
- Proposal: OPEN: promote to a kit hook (generic, Windows is the owner's platform), guarded to run only when `process.platform === 'win32'`; the project hook lacks that guard. Recommendation: KEEP in the kit as an optional Windows hook.
- Source: wildera:.claude/hooks/bash_long_command.mjs:1-40; wildera:.claude/settings.json:24-33
- Why it exists: header comment lines 1-6 (limit and `\\` handling); 6000 leaves room for Claude Code's wrapper (line 12).
- Test idea: a 9000-char command and a command with `\\` are rewritten to `source '<file>'` whose file content equals the original; a short command passes with no output.

### HOK-29 How a project's own hooks sit next to the kit hooks
- Behavior: WildEra's `.claude/settings.json` holds the three kit registrations exactly as in the template (same matchers, timeout 10) plus its own: PreToolUse and PostToolUse `syntax_check.mjs` (timeout 90) with matcher `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_.*|mcp__fsbatch__(edit|write)_.*|mcp__filesystem__(edit|write)_.*`, PreToolUse `bash_long_command.mjs` (matcher `Bash`, timeout 10), and `enabledPlugins: {"harness-files@paseo-harness-kit": true}`. One call can match more than one settings group (a Grep matches both `io_economy_guard` and `context_guard`; an edit matches `io_economy_guard` and `syntax_check`); the sources specify no cross-hook order or concurrency (io_economy_guard.mjs:18-19 is about several processes of the same script, HOK-20); hook files are separate scripts so the installer can tell kit-owned from project-owned by file name (HOK-02). The kit-registered `subagent_file_tools.mjs` is not registered here although the stub file is installed.
- Proposal: KEEP the coexistence model (separate scripts, additive settings, installer touches only named kit hooks); the adapter owns project hooks and their registration.
- Source: wildera:.claude/settings.json:1-82
- Why it exists: kit-init rule "Merge into existing settings; never replace other hooks" (kit:user/skills/kit-init/SKILL.md:57-58).
- Test idea: install on a project with its own Pre/Post hooks on the same matchers; after update both kit and project hooks remain and none is duplicated.

### HOK-30 CONFLICT: syntax-hook registration, kit-init text versus WildEra
- Behavior: kit-init says matcher `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_.*` and timeout about 30 s. WildEra registers the broader matcher (adds fsbatch and filesystem edit/write) and timeout 90, with an internal 75 s budget (above).
- Proposal: CONFLICT: both recorded; the new kit should define one rule: hook timeout > internal budget, matcher limited to tools that exist (Edit/MultiEdit/Write plus the kit's batch tools); 90/75 is the field-tested value for slow C++ checks, 30 s was never exercised in the sources.
- Source: kit:user/skills/kit-init/SKILL.md:57-58; wildera:.claude/settings.json:15-22, 57-64; wildera:.claude/hooks/syntax_check.mjs:16-18
- Why it exists: not stated for the 30 s.
- Test idea: a registration lint that fails when a hook's configured timeout is not larger than its declared internal budget.

### HOK-31 Hooks are copied into projects and import the project's loader
- Behavior: kit hooks live in the project as `.claude/hooks/*.mjs` (tests are not installed: README line 50, CHANGELOG line 27) and both guards import `../../.agents/harness/config.mjs` by relative path, so they work only in an installed project layout; WildEra's copies of the three kit hooks are byte-identical to the kit's (`cmp`), i.e. no project edits. A locally edited kit hook marks its registration as a conflict (HOK-02).
- Proposal: CHANGE/OPEN: decide where hooks live in the new kit (project copy as now, or shipped by a plugin/user-level path with the config path passed by env). Recommendation: keep project copies owned by digest, but resolve config via one documented env var or discovery function, not a hard-coded relative path.
- Source: kit:project/.claude/hooks/context_guard.mjs:8; kit:project/.claude/hooks/io_economy_guard.mjs:28; kit:README.md:50; kit:CHANGELOG.md:27; wildera:.claude/hooks/context_guard.mjs:1-108 (cmp result)
- Why it exists: "Installed projects carry their own versioned defaults and runtime, so moving a project does not require reaching the source kit" (kit:README.md:24-25).
- Test idea: move an installed project to another path; both hooks still load config and run.

### HOK-32 io guard has no identity gating
- Behavior: `io_economy_guard.mjs` does not call `isMainAgent`; it applies to main sessions, `ph` workers and any other session loading the project settings ("Applies to every session, harness agents included"). Workers also get the same advice in `first_prompt_note` ("Read in bulk ... Use the available batch file tools"). Only `isSidechain`/`isMeta` transcript entries are skipped; unlike `lastUsage` (context_guard.mjs:29), `scanTranscript` never reads `agentId`, so a child line lacking those two flags would count toward streaks. Whether a native child's hook run gets the child's own transcript is not shown in the sources.
- Proposal: KEEP the all-sessions scope (workers are the biggest sources of one-file-per-turn loops, see the watchdog read thresholds); OPEN only if worker prompt noise should be reduced.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:20, 118; kit:project/.claude/hooks/context_guard.mjs:29; kit:project/.agents/harness.defaults.json:91, 115-117
- Why it exists: header comment line 20; the watchdog (`watchdog_reads_without_write` 15, `watchdog_same_file_reads` 3) is the hard backstop for workers.
- Test idea: the same synthetic transcript yields the same reminder for a main-session env and a `PASEO_HARNESS_ROLE=worker` env.

### HOK-33 CONFLICT: which tools the main provider denies
- Behavior: the main providers' denied native tools are `Agent`, `Workflow`, `SendMessage` in the defaults file (with a note citing owner 2026-10-14), but `Agent`, `Workflow` only in the owner memory, README and CHANGELOG. Consequence for hooks: on the `circle` main provider a native child cannot be started, so the `agent_id`/`agentId`/`parent_agent_id` checks in `isMainAgent` guard only sessions on other providers or an owner who lifted the deny.
- Proposal: CONFLICT recorded; the new kit should denote one list (defaults file is the executable source; memory predates the `SendMessage` addition). Keep the identity checks (cheap, role-based, protect the main window from child usage).
- Source: kit:project/.agents/harness.defaults.json:58-63; kit:README.md:146-149; kit:CHANGELOG.md:15; C:/Users/fish/.claude-circle/projects/C--Users-fish-Desktop-paseo-harness-kit/memory/main-session-no-native-subagents.md:11-16
- Why it exists: owner 2026-10-14, one orchestration path (Paseo/ph).
- Test idea: config check reports exactly the new kit's one list for the main provider; hook identity tests (HOK-03) stay green.

### HOK-34 Test approach for the hooks
- Behavior: `test_context_guard.mjs` calls exported functions with injected `env` and `stateDir` (temp dir), with models gpt-6.1-sol, gpt-6-luna-fast, claude-opus-5-5, claude-sonnet-5-5 at 600000 tokens (reminds once each) and also spawns the script for a native-child input. `test_io_economy_guard.mjs` spawns the hook with synthetic transcripts (one assistant line per content block, tool results as user lines with `tool_use_id`), thresholds read from `loadKitConfig().io_guard` (the file's own comment says `config.json`; the code uses the kit defaults loader), sessions `iotest01..` with tmp dirs cleaned before and after, runs parallel spawns for dedupe, prints `ok`/`FAIL` per test and exits 1 on any failure (32 tests). `test_subagent_file_tools.mjs` checks the stub is silent for 6 tools with and without `PASEO_HARNESS_LEADER`. Commands in README: `node project/.claude/hooks/test_context_guard.mjs`, `test_io_economy_guard.mjs`, `test_subagent_file_tools.mjs`.
- Proposal: KEEP the approach (synthetic transcripts, injected env/state dir, real process spawns for concurrency); DROP the stub test; drop vendor-model matrix (model names are irrelevant to identity, keep one case).
- Source: kit:project/.claude/hooks/test_context_guard.mjs:1-70; kit:project/.claude/hooks/test_io_economy_guard.mjs:1-221; kit:project/.claude/hooks/test_subagent_file_tools.mjs:1-20; kit:README.md:156-163
- Why it exists: offline fixtures establish contracts and regressions (kit:README.md:165-167).
- Test idea: n/a (these are the tests); port the cases named in HOK-04..HOK-20 first.

### HOK-35 io guard: stacked messages, claim failure, absent transcript path
- Behavior: `preMessages` can return several strings in a fixed order: first-round, lookup streak, edit streak, reread; `out.join('\n')` is one `additionalContext`. A tool is either lookup or mutating, so lookup and edit streak never co-occur; with the defaults first-round and streak do not co-occur either (first-round needs no previous file round, so n = 1 < start 2); streak and reread can. `claim()` has no PID or mtime recovery: if a process dies after `wx` succeeded, that key stays silent until the 24 h prune or a new key (new prompt, segment or band). A PreToolUse input with no `transcript_path` is a silent exit by the `else if` at line 242, not by the outer catch; the outer catch (exit 0, no stderr) handles bad JSON and any throwing path such as a missing transcript file (test lines 198-204).
- Proposal: KEEP the stacking order; keep claim files without crash recovery (a lost reminder costs nothing) but document it.
- Source: kit:project/.claude/hooks/io_economy_guard.mjs:164-171, 182-214, 242, 253; kit:project/.claude/hooks/test_io_economy_guard.mjs:198-204
- Why it exists: not stated.
- Test idea: lookup call after an edit of the same file at round START yields streak text then reread text, joined by a newline; a payload without `transcript_path` gives empty stdout and status 0.

### HOK-36 Context guard: unlocked reset, throw after state write, claim with a bad pid
- Behavior: (1) The below-threshold reset (`band < 0`) writes the state file outside the claim lock. (2) If `fs.unlinkSync(claim)` in the `finally` throws after the state write at line 88, `runGuard` throws: the script prints `context guard unavailable: <message>` on stderr and no reminder, while the stored band has already advanced, so that band's reminder is lost. (3) A claim file that parses as JSON but whose `pid` is not a positive safe integer is never treated as abandoned and never uses the 60 s mtime path (that path runs only when the read or `JSON.parse` throws): the guard stays silent as long as that file exists.
- Proposal: CHANGE: in the new kit treat all three as defects of the heavy claim protocol; one atomic state update (write then rename, or a single `wx` per band) removes them.
- Source: kit:project/.claude/hooks/context_guard.mjs:59-61, 71-78, 85-97
- Why it exists: not stated; side effects of the claim recovery code in HOK-07.
- Test idea: plant a claim containing `{"pid":"x"}` and assert the reminder still arrives after the new design (fails against the old one, which stays silent).

### HOK-37 Overlay discovery for the hooks' config
- Behavior: `overlayPath(root)` returns the first existing of `<root>/.agents/harness.config.json`, then `<root>/.claude/harness.config.json` (legacy); none -> kit defaults only. Both guards read `context_guard` / `io_guard` through `loadConfig(root)`, i.e. defaults, then overlay merge (merged keys merge per field; keys starting with `_` and machine keys in the overlay are ignored), then validation.
- Proposal: KEEP `.agents/harness.config.json` only; DROP the legacy `.claude` path (no legacy projects in the new kit).
- Source: kit:project/.agents/harness/config.mjs:8-9, 16-18, 23-33, 104-107
- Why it exists: legacy location kept for migration (not stated).
- Test idea: with only `.claude/harness.config.json` present the old kit reads it; the new kit must either ignore it or fail loudly (decide and test).

## Invariants and lessons

- Hooks never block and never fail loudly: every path ends in exit 0; a broken configuration may only write one stderr line. Reason: a guard that blocks tool calls turns an advisory into an outage (kit:project/.claude/hooks/io_economy_guard.mjs:22; kit:project/.claude/hooks/context_guard.mjs:105; wildera:.claude/hooks/syntax_check.mjs:105).
- Identity is by role (hook-input ids plus `PASEO_HARNESS_LEADER`/`PASEO_HARNESS_ROLE=worker`), never by model name, and `agent_type` is not identity (kit:project/.claude/hooks/context_guard.mjs:13-15; kit:CHANGELOG.md:33).
- The in-flight round is never counted as a previous round, and parallel hooks of one round must speak once; dedupe by exclusive-create files, not by in-process state (hooks are separate processes) (kit:project/.claude/hooks/io_economy_guard.mjs:15-19; kit:project/.claude/hooks/context_guard.mjs:64).
- Each reminder speaks once per band (and per streak segment), and the context state resets when usage falls below the threshold so a later climb reminds again (kit:project/.claude/hooks/context_guard.mjs:59-63; kit:project/.claude/hooks/io_economy_guard.mjs:197-198).
- Window size comes from the session's reported usage when present; the configured `window_tokens` is only a fallback (kit:README.md:119-120).
- Reminders are model-facing `additionalContext`, not UI notifications and not forced compaction; a compaction must be confirmed by a usage drop, failure is reported, never assumed (kit:README.md:118-130; kit:project/.agents/skills/harness/references/paseo-runtime.md:430-440).
- Compaction must not start with a Monitor or background job running (a notification cancels it) and not with an edit half-done (kit:project/.claude/hooks/context_guard.mjs:94; paseo-runtime.md:427-428 in section 11 item 2).
- Syntax checks compare before/after and report only newly broken files, within a hard time budget that is lower than the hook timeout and with a machine-wide concurrency cap: a 75 s budget exists because a batch edit once held an agent for 15 minutes and some runtimes ignore hook timeouts (wildera:.claude/hooks/syntax_check.mjs:5-6, 16-18).
- A syntax or lint hook must resolve its checker from the tree that owns the edited file, not from the session cwd, because agents edit git worktrees (2026-10-16 incident, wildera:.claude/hooks/syntax_check.mjs:67-68).
- Kit hooks are identified in settings by script file name and by digest; an installer must touch only those, keep other hooks even in the same group, and report local divergence instead of overwriting (kit:install.mjs:301-324).
- Windows command-line limits: long Bash commands and `\\` are rescued by writing the command to a script and sourcing it (wildera:.claude/hooks/bash_long_command.mjs:1-6).
- Do not deny native file tools while an alternative is inactive; native tools keep permissions, read state, media and cancellation (kit:project/.claude/hooks/subagent_file_tools.mjs:2-5).
- Do not re-read a file to verify a successful Edit/Write; run the named checks (kit:blocks/AGENTS.md:6; kit:project/.claude/hooks/io_economy_guard.mjs:56).

## Interfaces

Hook stdin (JSON, fields the hooks read): `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response` (Post), `tool_use_id` (syntax hook), `agent_id`/`agentId`/`parent_agent_id` (identity).
Hook stdout (JSON, only when speaking): `{hookSpecificOutput:{hookEventName, additionalContext}}`; WildEra's Bash hook returns `hookSpecificOutput.updatedInput` instead. Exit code always 0.
Environment read: `PASEO_HARNESS_LEADER`, `PASEO_HARNESS_ROLE` (`worker`), `PASEO_HARNESS_ROOT`, `CLAUDE_PROJECT_DIR`; `$CLAUDE_PROJECT_DIR` in the registered command.

| Config key (in `.agents/harness.defaults.json`; overlay `.agents/harness.config.json`, else legacy `.claude/harness.config.json` when only that exists, HOK-37) | Default | Meaning |
| --- | --- | --- |
| `context_guard.window_tokens` | 1000000 | fallback window when usage reports none |
| `context_guard.start_pct` | 60 | first reminder at this percent of the window (1..100) |
| `context_guard.step_pct` | 5 | reminder every further step (1..100) |
| `io_guard.start_rounds` | 2 | consecutive lookup rounds before the first reminder |
| `io_guard.step_rounds` | 2 | then every step (>= 1) |
| `io_guard.edit_start_rounds` | 2 | consecutive edit-only rounds before the first reminder |
| `io_guard.edit_step_rounds` | 2 | then every step (>= 1) |
| `compact_resume` (runtime, referenced by the reminder flow) | `Compaction done. Continue where you left off; re-arm any Monitor you stopped.` | wake message after a confirmed compaction |

Temp files (all under `os.tmpdir()`): `ph-context-guard-<sha256[0..24]>.json` and `.claim`; `ph-io-guard-<session[0..8]>/<sha1[0..16]>` claims (pruned after 24 h); `claude-bash-commands/<sha1>-<pid>.sh` (WildEra, pruned after 1 day); `wildera-syntax-check/{<sha>.json, pre-<session>-<tool_use_id>.json, slot-<i>.lock}`.
Settings registration shape: see HOK-01. Reminder command text: `node .agents/skills/harness/scripts/paseo_harness.mjs compact-self --focus "<what to keep>"`.

## Cross-area dependencies

- install: copies `.claude/hooks/*`, merges `templates/settings.hooks.json` (HOK-02), excludes test files, reports hook conflicts with exit 2; the AGENTS.md File I/O block is inserted by the installer (block content in HOK-24).
- runtime: `ph compact-self` / `ph context --self` (HOK-12); the daemon sets `PASEO_HARNESS_LEADER`, `PASEO_HARNESS_ROOT`, `PASEO_HARNESS_ROLE=worker` on workers (kit:project/.agents/harness/runtime/daemon.mjs:126, grep line); the watchdog thresholds back up the io guard for workers (HOK-32).
- files (file tools/mod): the io guard's tool names and its messages name the file tools (HOK-13, HOK-23); `harness-files` plugin enablement in settings (HOK-29).
- config (part of install/runtime): the shared loader `.agents/harness/config.mjs` validates `context_guard`, `io_guard`, ignores `model_pattern` (HOK-10, HOK-22).
- method/gsd-plan: compaction reminders matter for long orchestrator sessions and GSD waves; the project adapter may add hooks (syntax, lint, layer checks) and must register them itself (HOK-26, HOK-29).
- workflow: workers' first prompt carries the same batching advice (`first_prompt_note`).
- ui: none; reminders are model-facing only.
- history: tag `ref-final` is the frozen reference; hook files are byte-identical in WildEra's installed copy.

## Concerns

- `context_guard` stored band is never lowered by a partial compaction (usage falling from band 3 to band 0 stays silent until band 4); and the state files in `os.tmpdir()` are never pruned (kit:project/.claude/hooks/context_guard.mjs:59-63, 88).
- `context_guard` runs a node process after every tool call of every session (matcher `*`), including workers that it ignores after the identity check (kit:templates/settings.hooks.json:15-25).
- io guard claim directory keys on only the first 8 characters of the session id; two sessions sharing a prefix share claims and could silence each other (kit:project/.claude/hooks/io_economy_guard.mjs:249).
- io guard claim is consumed by the first-round check even when `inFlightFileCalls >= 2` suppressed the message, so the second chance never comes in that prompt (kit:project/.claude/hooks/io_economy_guard.mjs:189-192).
- Transcript tail is 1 MiB: a long single prompt with huge tool results can push the user-prompt line out of the tail, giving `promptKey` `tail-start` and a streak that spans the cut (kit:project/.claude/hooks/io_economy_guard.mjs:95-102, 113).
- `start_rounds` and `edit_start_rounds` have no `>= 1` check (0 is legal and makes the first lookup/edit round speak; negatives are rejected by the integer check) (kit:project/.agents/harness/config.mjs:55-56, 92).
- Round grouping falls back to the entry `uuid` when `message.id` is absent, which would split one round into several; correctness depends on the transcript schema of the installed Claude Code (kit:project/.claude/hooks/io_economy_guard.mjs:125).
- The "lag" noted in the header (transcript may trail the hook) means the first-round and streak counts are best effort; tests use only synthetic transcripts, never a real Claude Code transcript (kit:project/.claude/hooks/io_economy_guard.mjs:7; kit:project/.claude/hooks/test_io_economy_guard.mjs:1-5).
- Reminder texts hard-code the harness-files/fsbatch/filesystem tool names whether or not the mod is enabled, so a session without the mod is told to use tools it does not have (kit:project/.claude/hooks/io_economy_guard.mjs:49-50, 55).
- `context_guard` claim-lock recovery (PID liveness, 60 s mtime) is more machinery than a single atomic write would need (kit:project/.claude/hooks/context_guard.mjs:64-92).
- Duplicate edge handling: `readPaths` for `harness-files` names maps by string manipulation onto fsbatch/filesystem shapes; adding a tool to one set and not to the path functions silently breaks the re-read reminder (kit:project/.claude/hooks/io_economy_guard.mjs:72-93).
- Dead/legacy: `subagent_file_tools.mjs` and its test, the `mcp__filesystem__`/`mcp__fsbatch__` names (kit:project/.claude/hooks/subagent_file_tools.mjs:1-6).
- WildEra syntax hook: Pre and Post state files keyed `pre-<session>-<tool_use_id>` (default `x`) are removed only in Post, so a denied or failed edit leaves one behind and the directory is never pruned; the tool-use id absence collapses keys (wildera:.claude/hooks/syntax_check.mjs:74-83).
- WildEra syntax hook imports checker code from the edited repo at hook time (`import(...)`), i.e. executes project code on every edit, outside the kit's trust model (wildera:.claude/hooks/syntax_check.mjs:73).
- `bash_long_command.mjs` has no platform guard, and `source` of the script changes semantics for commands that `exit` or use `$0`/`BASH_SOURCE`; not tested in the sources (wildera:.claude/hooks/bash_long_command.mjs:20-38).
- Docs vs code: README says the reminder is on PostToolUse and UserPromptSubmit, consistent with the template; the defaults `_notes` describe `context_guard` as matching "a model matches main-agent identity" (loose wording); `main_provider_disallowed_tools` lists differ across documents (HOK-33) (kit:project/.agents/harness.defaults.json:2, 58-63).

## Open questions for the owner

1. Who ships a syntax-check hook? Options: (a) keep the kit-init skill generating a project-owned hook per project (old way); (b) kit ships a generic hook shell (before/after compare, never-block, time budget, slot cap, content cache) and the adapter supplies per-extension checker commands; (c) both. Recommendation: (b), with WildEra's `syntax_check.mjs` mechanics as the base and the UE C++ checker kept in the WildEra adapter (HOK-26, HOK-27).
2. Promote `bash_long_command.mjs` into the kit (Windows-only guard)? Options: ship it by default on win32, ship it as optional, leave it project-owned. Recommendation: ship by default on win32; the long-command failure is silent data loss otherwise (HOK-28).
3. Should `io_economy_guard` keep running in all sessions (workers included) and keep three kinds of streak reminders, or be reduced to the first-round plus re-read reminders? Options: keep all; keep all for main only; trim. Recommendation: keep all, since the File I/O policy and the watchdog thresholds target the same habit and the reminders are one-shot per band (HOK-16, HOK-32).
4. Context guard defaults for the new kit: 60% start / 5% step on a 1M window fit the owner's `[1m]` circle models; confirm, or set per-model windows? Recommendation: keep the defaults and rely on the reported window.
5. Where hooks live (project copies by digest as now, or a plugin / user-level location with env-provided config path) (HOK-31). Recommendation: project copies, with config discovery through one environment variable instead of a relative import.
6. Which tools the main provider denies: `Agent`, `Workflow` only, or also `SendMessage` (HOK-33)? Recommendation: all three, matching the defaults file, since `ph send` is the message path.
7. Re-arming policy for a partial compaction (HOK-06): lower the stored band on any downward move, or only on dropping below `start_pct`. Recommendation: lower on any downward move.

## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
| --- | --- | --- |
| R1-HOK-01 | accepted | HOK-14: neutral rounds are skipped by the lookup streak and break the edit streak (verified io_economy_guard.mjs:144-159). |
| R1-HOK-02 | accepted | HOK-22 and the Concerns bullet: nonnegative safe integer check (config.mjs:55-56), unknown nested key fails (82), only the two steps need >= 1 (92); start 0 gives bands 0,1,1,2 (io_economy_guard.mjs:162), not every call. Added test cases. |
| R1-HOK-03 | accepted | HOK-27: slot, cache and 10 s gate bound only the C++ checker; `layer_lint` is a bare `spawnSync` gated by `remaining() > 1000`, silent on error or timeout (syntax_check.mjs:34-60, 91-98); proposal now keeps slot/cache per checker, budget hook-wide. |
| R1-HOK-04 | accepted | HOK-32: removed the claim that child lines are excluded; `scanTranscript` skips only `isSidechain`/`isMeta` (io_economy_guard.mjs:118) and never reads `agentId` (cf. context_guard.mjs:29). |
| R1-HOK-05 | accepted | HOK-29: lines 18-19 of io_economy_guard.mjs concern several processes of the same script (HOK-20); the entry now says only that a call can match several groups and specifies no cross-hook concurrency; citation removed. |
| R1-HOK-06 | accepted | HOK-03 (common.mjs:9 only reads `LEADER`; daemon.mjs:126 sets the env), HOK-08 (owner sentence at paseo-runtime.md:415-416), HOK-02 (rewrite at install.mjs:325-326, `wire` returns `blocked + skillConflicts` at 398, install 416-420 and update 446-449 return 2; per grep only `wire` calls `mergeHooks`, so status/pull do not), HOK-12 (commands.mjs 355, 393, 421-422, 428, 437-441, 447-448; success measured on Paseo `lastUsage.contextWindowUsedTokens`). |
| R1-HOK-07 | accepted | HOK-10 (warning built by `configProvenance`, printed by `ph doctor` and `ph config`, never by the hook; config.mjs:104-111, commands.mjs:60-62, 89), HOK-11 (config load, transcript and state read run only after the identity check; context_guard.mjs:49-58), HOK-15 (`inFlightFileCalls` is the sum over all unfinished rounds; io_economy_guard.mjs:140-141). |
| R1-HOK-08 | accepted | New HOK-35: stacked message order, `claim()` without crash recovery, absent `transcript_path` silent exit versus outer catch. |
| R1-HOK-09 | accepted | New HOK-36: unlocked reset, throw after state write loses that band's reminder, claim JSON with a bad `pid` never abandoned. |
| R1-HOK-10 | accepted | HOK-27 (non-Pre events take the Post path, `repoOf(files[0])` only, case-insensitive filters, deduped targets; syntax_check.mjs:31, 72-83), HOK-26 (hand-made stdin JSON as verify path; SKILL.md:69-70), new HOK-37 and the Interfaces table header (legacy `.claude/harness.config.json` fallback; config.mjs:16-18). |
| R1-HOK-11 | accepted | HOK-02: blocked also when the manifest has no digest (install.mjs:311); the reconciled line is printed unconditionally (389). |
| R1-HOK-12 | accepted | HOK-02: states the `nameOf` rule (`type === 'command'`, regex on `.claude/hooks/<name>.mjs`; install.mjs:308); other spellings are project-owned and the template group is appended beside them. |
| R1-HOK-13 | accepted | HOK-28: the absence of a platform check is now in the Behavior; non-string command exits 0, `hookEventName` hardcoded, `source` path not quote-escaped (bash_long_command.mjs:20-38). |

Notes: the reviewer's side remark that the test file's comment names `config.json` while the code uses `loadKitConfig()` was added to HOK-34. While verifying R1-HOK-06 I found that `compact_resume` is read by `compact-self` at arm time (commands.mjs:393) with the constant only as fallback, so there is no config/constant conflict; recorded in HOK-12. One edit in my own revision pass failed to apply (a stray no-op) and changed nothing.
