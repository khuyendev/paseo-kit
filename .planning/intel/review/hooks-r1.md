# Review r1: hooks

## Verdict

REVISE. 0 blocker, 5 major, 8 minor. The map is unusually complete: every in-scope file is in the coverage table, the three kit hooks are byte-identical to the WildEra copies (SHA-256), and the registration template, role identity, band math, tool sets, message shapes, and both CONFLICT entries match the sources. It still cannot be specified from as written. Four behavior statements contradict the code (neutral rounds versus edit streaks, `io_guard` start validation, which syntax limits bind `layer_lint`, and whether child transcript lines are excluded), and one concurrency claim is pinned to a comment about a different thing. Proposals line up with the owner decisions (Claude Code only, drop the non-Claude adapters and the stub, keep role identity, treat WildEra syntax as adapter material). Required sections are present, IDs are unique, and HOK-30 and HOK-33 show both sides.

## Findings

### R1-HOK-01 MAJOR accuracy Neutral rounds do not "count for nothing"

- Severity: MAJOR
- Category: accuracy
- Map entry: HOK-14
- Evidence: kit:project/.claude/hooks/io_economy_guard.mjs:144-159
- Fix: `lookupStreak` skips a finished round that is neither lookup nor mutating. `editStreak` stops on that same round (`if (!previous[i].mutating || previous[i].lookup) break`). HOK-17 already says a Bash round ends the edit run. Change HOK-14 so neutral rounds are not "count for nothing" for both streaks; say they are skipped by the lookup streak and they break the edit streak.

### R1-HOK-02 MAJOR accuracy `io_guard` starts reject negatives and 0 does not speak every call

- Severity: MAJOR
- Category: accuracy
- Map entry: HOK-22
- Evidence: kit:project/.agents/harness/config.mjs:43-44, 55-56, 80-83, 92; kit:project/.claude/hooks/io_economy_guard.mjs:162
- Fix: All four `io_guard` fields are nonnegative safe integers. A negative fails at the integer check (`invalid harness config io_guard.<key>: expected a nonnegative safe integer`), so it never reaches `bandOf`. Only `step_rounds` and `edit_step_rounds` have the extra `>= 1` check, so `0` is legal for the two starts. With start 0 and step 2, bands are 0, 1, 1, 2, … not a reminder on every call. Rewrite the Concerns bullet that cites config.mjs:92 the same way. Also say an unknown nested key fails (`unknown key`), which HOK-10 states for `context_guard` and HOK-22 omits for `io_guard`.

### R1-HOK-03 MAJOR accuracy `layer_lint` is outside the C++ slot, cache, and 10s gate

- Severity: MAJOR
- Category: accuracy
- Map entry: HOK-27
- Evidence: wildera:.claude/hooks/syntax_check.mjs:34-60, 91-98
- Fix: Split the limits. `check` / `withSlot` / the SHA-1 cache / the 10s remainder / `MAX_PARALLEL` 3 / 180s stale locks / 20s wait apply only to `cpp_check.checkFile`. `layer_lint.mjs` is a `spawnSync` outside the slot and the cache. It runs when the file exists and `remaining() > 1000`, with `timeout` = remaining budget and `maxBuffer` 4 MiB, and it reports only when `!layer.error && layer.status === 1 && layer.stdout` contains `|`. A spawn timeout is therefore silent. Do not feed the generic shell in HOK-26 a single limit list that covers both tools.

### R1-HOK-04 MAJOR accuracy The I/O guard does not drop `agentId` lines

- Severity: MAJOR
- Category: accuracy
- Map entry: HOK-32
- Evidence: kit:project/.claude/hooks/io_economy_guard.mjs:118; kit:project/.claude/hooks/context_guard.mjs:29
- Fix: Delete "so a native child's own calls inside the parent's transcript do not count toward the parent's streaks." `scanTranscript` skips only `isSidechain` and `isMeta`. Unlike `lastUsage`, it never reads `agentId`. A child line without those two flags counts toward streaks. Keep the next sentence: the sources do not show whether a native child's own hook run sees the child's transcript.

### R1-HOK-05 MAJOR citation Parallel-round comment is not cross-hook concurrency

- Severity: MAJOR
- Category: citation
- Map entry: HOK-29
- Evidence: kit:project/.claude/hooks/io_economy_guard.mjs:18-19; wildera:.claude/settings.json:4-33, 35-65
- Fix: Lines 18-19 say the hooks of one parallel tool round (several processes of this same script) run concurrently and must speak once. That is HOK-20, not a claim that distinct hook commands on one tool call run concurrently. HOK-29 should say only that one call can match more than one settings group (Grep matches both `io_economy_guard` and `context_guard`; an edit matches `io_economy_guard` and `syntax_check`). Do not specify cross-hook order or concurrency from that comment.

### R1-HOK-06 MINOR citation Off-by lines and citations that miss the supporting statement

- Severity: MINOR
- Category: citation
- Map entry: HOK-02, HOK-03, HOK-08, HOK-12
- Evidence: kit:project/.agents/harness/runtime/common.mjs:9; kit:project/.agents/harness/runtime/daemon.mjs:126; kit:project/.agents/skills/harness/references/paseo-runtime.md:413-416; kit:install.mjs:325-328, 387-398, 446-449; kit:project/.agents/harness/runtime/commands.mjs:355, 421-422, 426-441, 447-448
- Fix: `common.mjs:9` reads `PASEO_HARNESS_LEADER` into `LEADER`; it does not set worker env. The set is `daemon.mjs:126` only. HOK-08's owner sentence is paseo-runtime.md:415-416, not 413-414 (heading and blank line). HOK-02's rewrite is install.mjs:325-326 (2-space JSON, trailing newline, only when `JSON.stringify` of the object changes); `wire` returns `blocked.size + skillConflicts` at 398. Both `install` (420) and `update` (449) return exit 2; `status` and `pull` never call `mergeHooks`. HOK-12's commands.mjs:421-422 is the wait-failed text ("`/compact` was NOT sent"); 447-448 is "compaction NOT confirmed". The half-ratio is 355 and 439, the send is 428, and success uses Paseo `lastUsage.contextWindowUsedTokens`, not the transcript sum in HOK-04.

### R1-HOK-07 MINOR accuracy Warning channel, per-call cost, and the in-flight sum

- Severity: MINOR
- Category: accuracy
- Map entry: HOK-10, HOK-11, HOK-15
- Evidence: kit:project/.agents/harness/config.mjs:29, 104-111; kit:project/.agents/harness/runtime/commands.mjs:60-62, 89; kit:project/.claude/hooks/context_guard.mjs:49-58; kit:project/.claude/hooks/io_economy_guard.mjs:140-141, 189-192
- Fix: `loadConfig` strips `context_guard.model_pattern` and does not print the warning. `configProvenance` builds it; `ph doctor` prints `note <warning>` and `ph config` embeds `_provenance`. The hook stays silent. HOK-11's transcript tail and state read run only after `isMainAgent` and `transcript_path` pass; other sessions pay node startup and the stdin parse only. HOK-15's suppression is `inFlightFileCalls < 2`, the sum of `fileCalls` over every unfinished round, not one round.

### R1-HOK-08 MINOR coverage I/O-guard contracts the entries skip

- Severity: MINOR
- Category: coverage
- Map entry: HOK-20, HOK-21
- Evidence: kit:project/.claude/hooks/io_economy_guard.mjs:164-171, 182-214, 242, 253; kit:project/.claude/hooks/test_io_economy_guard.mjs:198-204
- Fix: Add three contracts. `preMessages` can push several strings, in order first, lookup streak, edit streak, reread, joined with `\n`. With the defaults, first and streak do not co-occur; streak and reread can. `claim()` has no PID or mtime recovery: a process that dies after `wx` succeeds leaves that key silent until the 24h prune or a new key. A PreToolUse input with no `transcript_path` is a silent exit, not the outer catch. The outer catch (exit 0, no stderr) is bad JSON or a path that throws, which is what the test uses.

### R1-HOK-09 MINOR coverage Context-guard failure paths

- Severity: MINOR
- Category: coverage
- Map entry: HOK-06, HOK-07
- Evidence: kit:project/.claude/hooks/context_guard.mjs:59-61, 71-78, 85-97
- Fix: Add three paths. The below-threshold reset is outside the claim lock. If `unlinkSync(claim)` throws after the state write, the function throws, the script writes `context guard unavailable` and prints no reminder, and the stored band has already advanced. A claim that parses as JSON but whose `pid` is not a positive safe integer is never abandoned and never uses the 60s mtime path; that path runs only when the read or `JSON.parse` throws.

### R1-HOK-10 MINOR coverage `syntax_check` edges and the legacy overlay

- Severity: MINOR
- Category: coverage
- Map entry: HOK-26, HOK-27, Interfaces
- Evidence: wildera:.claude/hooks/syntax_check.mjs:31, 72-83; kit:user/skills/kit-init/SKILL.md:69-70; kit:project/.agents/harness/config.mjs:16-18
- Fix: Any `hook_event_name` other than exactly `PreToolUse` takes the Post path. The checker repo is `repoOf(files[0])` only. The `.cpp`/`.h` and `game` segment tests are case-insensitive, and targets are deduped. kit-init verification may be a real edit or a hand-made hook JSON on stdin; HOK-26's behavior mentions only the scratch file. `overlayPath` prefers `.agents/harness.config.json` and falls back to `.claude/harness.config.json` when only the legacy file exists; Interfaces names only the first.

### R1-HOK-11 MINOR accuracy When a kit hook registration is blocked

- Severity: MINOR
- Category: accuracy
- Map entry: HOK-02
- Evidence: kit:install.mjs:309-311, 324, 389
- Fix: A managed script is blocked when the file exists and `installed[rel] !== digest(file)`. That is also true when the manifest has no digest for it, not only when a recorded digest differs. `say` prints the reconciled line even when the file bytes did not change and even when conflict lines were printed in the same run.

### R1-HOK-12 MINOR citation Installer recognizes only `type: command`

- Severity: MINOR
- Category: citation
- Map entry: HOK-02
- Evidence: kit:install.mjs:308
- Fix: State the identifier: `nameOf` returns a name only for `type === "command"` whose command matches `/(?:^|[\\/])\.claude[\\/]hooks[\\/]([\w.-]+\.mjs)(?:["'\s]|$)/`. Any other spelling is treated as project-owned, and the template group is appended beside it.

### R1-HOK-13 MINOR coverage `bash_long_command` edges

- Severity: MINOR
- Category: coverage
- Map entry: HOK-28
- Evidence: wildera:.claude/hooks/bash_long_command.mjs:20-38
- Fix: The Behavior's opening "On Windows" is the comment's scenario; the script has no `process.platform` check (the proposal already says so; put the absence in the Behavior, not only the proposal). Also: a non-string `tool_input.command` exits 0 the same way a non-Bash tool does; `hookEventName` is hardcoded `PreToolUse`; the `source` path is not quote-escaped.

## Citations checked

| map entry | citation | result |
| --- | --- | --- |
| HOK-01 | kit:templates/settings.hooks.json:3-47 | ok. Four command hooks, timeout 10, matchers and $CLAUDE_PROJECT_DIR quoting as written. No subagent_file_tools entry. |
| HOK-02 | kit:install.mjs:301-324 | ok for the filter, blocked set, conflict text, and append. The rewrite itself is 325-326, outside this range (R1-HOK-06). |
| HOK-02 | kit:install.mjs:380-392 | partial. 380-385 is ensureImports, not hooks. 387-389 calls mergeHooks and prints the reconciled line. return blocked + skillConflicts is 398. |
| HOK-02 | kit:install.mjs:416-420 | ok that install returns 2 when hookConflicts is truthy. update does the same at 449. Not only hook blocks (skill conflicts count too). |
| HOK-03 | kit:project/.claude/hooks/context_guard.mjs:12-16 | ok. agent_type ignored; falsy agent_id / agentId / parent_agent_id; no leader env; role not worker. |
| HOK-03 | kit:project/.claude/hooks/test_context_guard.mjs:20-26 | ok. The six identity asserts match. |
| HOK-03 | kit:project/.agents/harness/runtime/daemon.mjs:126 | ok. Worker env is PASEO_HARNESS_LEADER, PASEO_HARNESS_ROOT, PASEO_HARNESS_ROLE worker. |
| HOK-03 | kit:project/.agents/harness/runtime/common.mjs:9 | wrong as "env set". Line 9 reads PASEO_HARNESS_LEADER into LEADER. |
| HOK-03 | kit:CHANGELOG.md:33 | ok. Reminders no longer match model names; native child and ph worker suppress them; output stays additionalContext. |
| HOK-03 | kit:project/.agents/harness/config.mjs:29, 110-111 | ok that the overlay key is stripped and configProvenance has the warning string. The hook does not print it (R1-HOK-07). |
| HOK-04 | kit:project/.claude/hooks/context_guard.mjs:10, 18-36 | ok. 1 MiB tail, usage filter, assistant / not sidechain / no agentId / not synthetic, three token fields, window field names, null if none. |
| HOK-04 | kit:project/.claude/hooks/test_context_guard.mjs:47-50 | ok. Newer sidechain line ignored (used 600000); contextWindowMaxTokens 200000 yields 120000/200000. |
| HOK-05 | kit:project/.claude/hooks/context_guard.mjs:38-46 | ok. Throw text, reported window if finite and greater than 0, band formula. |
| HOK-05 | kit:project/.claude/hooks/test_context_guard.mjs:27-32 | ok. 599999 to -1, 600000 to 0, 650000 to 1, 120000/200000 to 0, step_pct 0 throws. |
| HOK-05 | kit:project/.agents/harness.defaults.json:97-101 | ok. 1000000 / 60 / 5. |
| HOK-06 | kit:project/.claude/hooks/context_guard.mjs:55-63, 86-88 | ok. SHA-256 key 24 hex, band and pct, reset only from a non -1 previous when band is below 0, no write when band is between 0 and prev. |
| HOK-06 | kit:project/.claude/hooks/test_context_guard.mjs:33-44 | ok. Once, again silent, 65 percent, reset at 1000, remind again at 600000. |
| HOK-07 | kit:project/.claude/hooks/context_guard.mjs:64-92 | ok. wx, two attempts, ESRCH, 60s mtime only after parse or read failure, re-read state, unlink in finally. |
| HOK-07 | kit:project/.claude/hooks/test_context_guard.mjs:51-62 | ok. Live pid silent; dead pid and empty claim older than 120s both speak. |
| HOK-08 | kit:project/.claude/hooks/context_guard.mjs:93-97 | ok. Message text and hookSpecificOutput shape match, including the compact-self command. |
| HOK-08 | kit:README.md:118-130 | ok. Main conversation, not a notification, not forced compaction, reported window, separate autocompact. README sample focus text is "what to preserve", not the hook placeholder. |
| HOK-08 | kit:project/.agents/skills/harness/references/paseo-runtime.md:413-414 | wrong lines. 413-414 are the heading and a blank line. The 2026-10-02 sentence is 415-416. |
| HOK-09 | kit:project/.claude/hooks/context_guard.mjs:48-52, 100-108 | ok. Script guard via argv[1], null when not main or no transcript, root order, stderr text, no process.exit (process then ends 0). |
| HOK-09 | kit:project/.claude/hooks/test_context_guard.mjs:63-66 | ok for the native-child spawn (status 0, empty stdout). The file has no broken-overlay case. |
| HOK-10 | kit:project/.agents/harness/config.mjs:12, 43, 88-91 | ok. Merged key; three integer fields; window_tokens at least 1; start_pct and step_pct each 1..100; missing and unknown nested keys fail. |
| HOK-12 | kit:project/.agents/skills/harness/references/paseo-runtime.md:413-440 | ok. 60/5, natural break, stop Monitors, half-drop, compact_resume or --resume, no retry, NOT confirmed. |
| HOK-12 | kit:project/.agents/harness.defaults.json:96 | ok. compact_resume is the long re-arm any Monitor string. |
| HOK-12 | kit:project/.agents/harness/runtime/commands.mjs:421-422, 447-448 | lines exist but do not carry the half-ratio or the /compact send (R1-HOK-06). 421-422 is wait-failed; 447-448 is NOT confirmed. |
| HOK-13 | kit:project/.claude/hooks/io_economy_guard.mjs:30-46, 237 | ok. LOOKUP, MUTATING, and RESULT sets match, including no fsbatch search. Other tool names exit 0. |
| HOK-14 | kit:project/.claude/hooks/io_economy_guard.mjs:13-17, 95-142 | ok for the round model, prompt clear, message.id fallback, in-flight exclusion, and summed fileCalls. "Count for nothing" is wrong for edit streaks (R1-HOK-01). |
| HOK-14 | kit:project/.claude/hooks/test_io_economy_guard.mjs:111-116, 131-134 | ok. In-flight siblings do not raise the round number; sidechain and meta reads do not. |
| HOK-15 | kit:project/.claude/hooks/io_economy_guard.mjs:189-192 | ok that the first-prompt claim is taken before the under-2 check, and prune runs only then. The under-2 test is a sum (R1-HOK-07). |
| HOK-15 | kit:project/.claude/hooks/test_io_economy_guard.mjs:75-98 | ok. Once per prompt, again on the next prompt, six parallel speakers, in-flight Grep+Glob silent, first edit text. |
| HOK-16 | kit:project/.claude/hooks/io_economy_guard.mjs:144-151, 194-199 | ok. Mutating round breaks the lookup walk; claim key uses prompt, segment, and band; segment is the count of mutating finished rounds. |
| HOK-16 | kit:project/.agents/harness.defaults.json:102-107 | ok. 2/2/2/2. |
| HOK-17 | kit:project/.claude/hooks/io_economy_guard.mjs:153-160, 201-207 | ok. Directly preceding edit-only rounds; Bash or a lookup breaks; claim uses previous.length minus run. |
| HOK-17 | kit:project/.claude/hooks/test_io_economy_guard.mjs:135-153 | ok. Names round ESTART; Bash and lookup break it; one speak per band. |
| HOK-18 | kit:project/.claude/hooks/io_economy_guard.mjs:56, 63-93, 209-213 | ok. Path shapes, limit === 1 only for native Read, harness-files names remapped, lowercased posix normalize, reread text. |
| HOK-18 | kit:blocks/AGENTS.md:6 | ok. Do not re-read solely to verify; run the checks. |
| HOK-19 | kit:project/.claude/hooks/io_economy_guard.mjs:57-61, 217-233 | ok. Truncated before empty, last 600 chars, numFiles === 0 rule, text under 200 plus the empty regex, no claim. |
| HOK-19 | kit:project/.claude/hooks/test_io_economy_guard.mjs:176-197 | ok. String empty, numFiles 0 with empty filenames, content-mode with numLines 1 silent, truncated Glob, Read post silent. |
| HOK-20 | kit:project/.claude/hooks/io_economy_guard.mjs:18-20, 31, 164-180, 249 | ok. Dir is session id slice 0..8 or x; SHA-1 16 hex; wx; any error does not speak; prune 24h. |
| HOK-21 | kit:project/.claude/hooks/io_economy_guard.mjs:5-6, 22, 235-257 | ok. Event default, Post needs no config, config error stderr and exit 0, other errors exit 0 with no stderr, fd 1 JSON, no permission decision. |
| HOK-22 | kit:project/.agents/harness/config.mjs:92 | partial. That line checks only the two steps are at least 1. It does not show that negatives are accepted (R1-HOK-02). |
| HOK-23 | kit:project/.claude/hooks/io_economy_guard.mjs:48-59 | ok. Prefix and the seven texts; BATCH_HOW names harness-files tools whether or not the mod is on. |
| HOK-24 | kit:blocks/AGENTS.md:1-7 | ok. Five bullets, ending with correctness over fewer calls. |
| HOK-24 | kit:CHANGELOG.md:25 | ok. Writing Principles, Applying the principles, and Dependencies blocks removed. |
| HOK-25 | kit:project/.claude/hooks/subagent_file_tools.mjs:1-6 | ok. Comment plus process.stdin.resume() only. |
| HOK-25 | kit:project/.claude/hooks/test_subagent_file_tools.mjs:1-20 | ok. Six tools, with and without PASEO_HARNESS_LEADER, status 0, empty stdout and stderr. |
| HOK-25 | kit:install.mjs:307 | ok. subagent_file_tools.mjs is in the managed list. |
| HOK-26 | kit:user/skills/kit-init/SKILL.md:44-71 | ok. No kit syntax hook; checker list; matcher and about 30 s; four rules; installer leaves project hooks alone. Scratch-file verify is 69-70 and also allows hand-made JSON. |
| HOK-26 | kit:README.md:56-58 | ok. kit-init writes a project-owned syntax hook; the kit ships none. |
| HOK-26 | kit:CHANGELOG.md:9 | ok. Same, including before/after and non-blocking. |
| HOK-27 | wildera:.claude/hooks/syntax_check.mjs:1-106 | ok on targets, repo walk, pre/post state, first 6 errors, 75s budget, 15-minute comment, and 2026-10-16 worktree comment. The limits paragraph over-attributes slot, cache, and 10s to layer_lint (R1-HOK-03). |
| HOK-28 | wildera:.claude/hooks/bash_long_command.mjs:1-40 | ok. 8191 comment, limit 6000, length plus 3 per quote, backslash pair, CRLF to LF, sha1-pid file, source with forward slashes, exit 0. No platform check. |
| HOK-28 | wildera:.claude/settings.json:24-33 | ok. PreToolUse matcher Bash, timeout 10. |
| HOK-29 | wildera:.claude/settings.json:1-82 | ok. Template registrations plus syntax timeout 90 and the broader matcher, bash hook, enabledPlugins harness-files. Stub is not registered. |
| HOK-29 | kit:project/.claude/hooks/io_economy_guard.mjs:18-19 | wrong for this claim. See R1-HOK-05. |
| HOK-30 | kit:user/skills/kit-init/SKILL.md:57-58; wildera:.claude/settings.json:15-22, 57-64; wildera:.claude/hooks/syntax_check.mjs:16-18 | ok. About 30s and the narrower matcher versus timeout 90 and the fsbatch/filesystem alternatives, with an internal 75s budget. |
| HOK-31 | kit:project/.claude/hooks/context_guard.mjs:8; io_economy_guard.mjs:28 | ok. Both import ../../.agents/harness/config.mjs. |
| HOK-31 | kit:README.md:50; kit:CHANGELOG.md:27 | ok. Test files stay in the kit. The filter is install.mjs:157-158 (test_* and *.test.*). |
| HOK-32 | kit:project/.claude/hooks/io_economy_guard.mjs:20, 118 | line 20-21 does say every session including harness agents. Line 118 skips only sidechain and meta, which does not support the child-line conclusion (R1-HOK-04). |
| HOK-32 | kit:project/.agents/harness.defaults.json:91, 115-117 | ok. first_prompt_note is the bulk-read line (not the same sentences as the guard). Watchdog counters are 3 / 3 / 15. |
| HOK-33 | kit:project/.agents/harness.defaults.json:58-63 | ok. Executable list is Agent, Workflow, SendMessage, with the note on line 58. |
| HOK-33 | kit:README.md:146-149; kit:CHANGELOG.md:15 | ok. Both name Agent and Workflow only. |
| HOK-33 | memory/main-session-no-native-subagents.md:11-16 | ok. Agent and Workflow on provider circle; no SendMessage. |
| HOK-34 | kit:project/.claude/hooks/test_context_guard.mjs:1-70; test_io_economy_guard.mjs:1-221; test_subagent_file_tools.mjs:1-20; kit:README.md:156-163, 165-167 | ok. Four model names at 600000; 32 test() calls; ok/FAIL; exit 1 if any failed; README commands match. |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| --- | --- | --- |
| kit:project/.claude/hooks/context_guard.mjs | yes (108, read) | 3 (R1-HOK-09: unlocked reset, unlink-after-write, claim JSON with a bad pid) |
| kit:project/.claude/hooks/io_economy_guard.mjs | yes (257, read) | 3 (R1-HOK-08: stacked pre messages, no claim recovery, absent transcript_path). Neutral-round and agentId issues are wrong statements, not gaps. |
| kit:project/.claude/hooks/subagent_file_tools.mjs | yes (6, read) | 0 |
| kit:project/.claude/hooks/test_context_guard.mjs | yes (70, read) | 0 |
| kit:project/.claude/hooks/test_io_economy_guard.mjs | yes (221, read) | 0 (32 tests; thresholds come from loadKitConfig(), not from a project config.json as the file comment says) |
| kit:project/.claude/hooks/test_subagent_file_tools.mjs | yes (20, read) | 0 |
| kit:templates/settings.hooks.json | yes (49, read) | 0 |
| kit:project/.agents/harness.defaults.json | yes (124, read; keys in scope) | 0 for context_guard and io_guard |
| kit:blocks/AGENTS.md | yes (7, read) | 0 |
| kit:README.md | yes (172, read; section 113-130) | 0 in that section |
| kit:user/skills/kit-init/SKILL.md | yes (76, read; syntax part 44-71) | 1 (hand-made stdin JSON as a verify path; R1-HOK-10) |
| wildera:.claude/settings.json | yes (82, read) | 0 |
| wildera:.claude/hooks/context_guard.mjs | yes (identical hash to kit) | 0 beyond the kit file |
| wildera:.claude/hooks/io_economy_guard.mjs | yes (identical hash to kit) | 0 beyond the kit file |
| wildera:.claude/hooks/subagent_file_tools.mjs | yes (identical hash to kit) | 0 |
| wildera:.claude/hooks/bash_long_command.mjs | yes (40, read) | 2 (non-string command; unescaped source path; R1-HOK-13). The missing win32 guard is only in the proposal, not in the Behavior. |
| wildera:.claude/hooks/syntax_check.mjs | yes (106, read) | 4 (non-Pre treated as Post, files[0] only, case-insensitive filters, deduped targets; R1-HOK-10). layer_lint limits are mis-stated, not missing. |

No in-scope path is absent from the Coverage table. wildera:.claude/hooks/ has exactly those five files.