# Review r1: runtime

## Verdict

REVISE. 1 blocker, 13 major, 7 minor.

The map is a real reading of `ph`: command shapes, config merge, prompt order, compact-self, worktree prune, and the non-Claude drops mostly match the code, and the recorded CONFLICTS (SendMessage, nudge/stop, teammate note, resume fallback) are real. It is not safe as the only spec input yet. The workflow runner inside `commands.mjs` (this area's file, not map-workflow's) is reduced to "prime/gate", so the audit RUN-3 schema split and the warmup-timer incident would not survive. Several KEEP contracts are stronger than the code: doctor does not always continue, full agent ids are not limited to live subagents, and a missing worktree directory is removed even when the owner is unknown.

## Findings

### R1-RUN-01 BLOCKER coverage Primed agents cannot use native outputSchema
- Severity: BLOCKER
- Category: coverage
- Map entry: RUN-58 (also RUN-21, RUN-22)
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:679-708; kit:project/.agents/skills/harness/references/paseo-runtime.md:43,107,239
- Fix: Add a behavior, not the word "prime/gate". Unprimed `createAgent` receives `outputSchema`. `prime_role: two-turn` creates the agent with the role prompt and `outputSchema` null, waits for READY, then sends the task. Paseo accepts a native schema only at creation (comment: audit RUN-3, not fixable through the client), so a primed task is validated by `P.structured` (`getStructuredAgentResponse`): schema text added to the prompt, `maxRetries` = `schema_retries`, `schemaName` `"Result"`. Doc: extra attempts, then the `agent()` result is `null` (not a throw) when the schema still fails. `composePrompt` itself never inserts the schema.

### R1-RUN-02 MAJOR coverage Warm-up gate and the 90s timer incident
- Severity: MAJOR
- Category: coverage
- Map entry: RUN-58
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:625-678
- Fix: Specify the gate. Key = `runId|type|resolvedModelId|thinking`. It runs only when `warmup` and the agent has a type. The first agent of that key starts alone and opens the gate when its role turn finishes, or `warmup_s` after create when not priming. Others wait on that promise or `warmup_timeout_s`, whichever is first. The fallback timer is cleared when the wait ends. The gate is opened in `finally` on failure. Incident (comment, owner 2026-10-04): a pending timer kept `ph workflow` alive up to 90s after `workflow done`, so the caller's background shell reported nothing.

### R1-RUN-03 MAJOR coverage Workflow command shell is too thin to re-implement
- Severity: MAJOR
- Category: coverage
- Map entry: RUN-58
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:122-123,645,693-723,757-773; kit:project/.agents/harness/runtime/daemon.mjs:123; kit:project/.agents/harness/runtime/commands.mjs:180-183
- Fix: Add these contracts. (1) Foreground `out()` prints the line and appends it to `log.txt`, unless `PASEO_HARNESS_LOG_IS_STDOUT=1` (the detach child), because that child's stdout is already the log. (2) The first error whose first line matches `Transport (closed|not connected)` sets a process flag, logs `runner lost the daemon connection (...)`, and every later `agent()` returns null with `daemon connection lost earlier in this run (...)` and does not create. (3) `--detach` does not call `requireCaller` and exits 0 after `workflow started`; a missing `PASEO_AGENT_ID` fails only in the child log. (4) Null reasons from the runner include `finished without a reply`, `watchdog stopped the agent after <agent_stop_s> s`, and up to three `validationErrors` joined after the message. (5) `checkNameLengths` (60) applies to spawn and fanout only. Workflow titles `${workflowName}:${label}` are sliced to 60 inside `createAgent` with no error, so CMD-4 still bites them silently.

### R1-RUN-04 MAJOR accuracy Doctor does not continue on every bad overlay
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-07
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:33-36,60-61; kit:project/.agents/harness/config.mjs:108-111
- Fix: Split the cases. A JSON object that fails `validate` is one `problem` line and the rest of doctor uses kit defaults (exit 2 if anything else is a problem). Invalid JSON, or any throw from `configProvenance` (it `readJson`s the overlay again, outside the try), leaves `cmdDoctor` and `main` prints `failed: ...` exit 1, so later checks do not run. Change the test idea, which currently says every corrupt overlay exits 2.

### R1-RUN-05 MAJOR accuracy Kit root without a manifest is three levels, not four
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-09
- Evidence: kit:project/.agents/harness/config.mjs:19-21; kit:project/.agents/skills/harness/scripts/shared_paths.mjs:5
- Fix: `installedRoot` with no manifest is `new URL("../../../")` from `project/.agents/harness/config.mjs`: the directory that contains `.agents` (the installed project, or `kit/project` in the kit checkout), not the git root and not four levels. Four levels is only `shared_paths.mjs`, because that file lives one directory deeper. RUN-52's "four levels above the script" is the one that is right.

### R1-RUN-06 MAJOR accuracy Full id bypasses live-subagent and archived filters
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-30
- Evidence: kit:project/.agents/harness/runtime/daemon.mjs:162-183
- Fix: Remove the blanket "Archived agents are excluded." Pools (caller, then leader) come from `listAgents`, which drops `archivedAt`. A reference of exactly 36 hex-or-dash characters that missed both pools is `fetchAgent`'d with no parent check and no archived check. That id can name any agent the daemon returns. Also state the priority that is only implied: the caller pool is finished before the leader pool is considered, so a title hit on the caller's agent wins over an id hit on the leader's.

### R1-RUN-07 MAJOR accuracy Doctor does not bypass allowed_models
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-14
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:57,63; kit:project/.agents/harness/runtime/models.mjs:22-29
- Fix: The only `checkAllowed=false` call is the later provider set used for legacy MCP and the file MOD. Per-tier lines never call `resolveModel` (they print `t.provider` and are not allowlist-gated). `default_tier <t> -> <id>` calls `resolveModel` with the default `checkAllowed=true`, so a default tier outside `allowed_models` is a `problem` line. Creation still enforces the list on the id before `agent_providers` mapping; that part of RUN-14 is right.

### R1-RUN-08 MAJOR accuracy Catalogue miss does not block create, and doctor asks the wrong provider
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-15
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:48-55; kit:project/.agents/harness/runtime/daemon.mjs:86-88,121-128
- Fix: Doctor splits `tier.provider` and calls `listProviderModels` on that prefix (`circle`), not the mapped worker provider (`circle-agent`). `createAgent` looks up the mapped provider. If the model is absent or the catalogue call throws, supported thinking ids are `[]`, `clampThinking` returns undefined, and the agent is still created with no `thinkingOptionId`. "Model not offered" is a doctor problem only.

### R1-RUN-09 MAJOR accuracy archive --run does not always rewrite run.json
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-51
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:472-474
- Fix: The runner is killed (`process.kill`, default signal) only when `pid` is set, `pidAlive` (EPERM counts as alive), and `status === "running"`. Kill failure prints `could not stop runner pid <p>: ...` and archiving continues. `run.json` is rewritten to `stopped` plus `endedAt` only when `status` was `running`. A `done` or `failed` run is left as it is. Agents archived are still only the caller's, labelled `harness.run`.

### R1-RUN-10 MAJOR accuracy A missing worktree directory is always removable
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-56
- Evidence: kit:project/.agents/harness/runtime/worktrees.mjs:3-5,57-58
- Fix: The header comment (owner finished, clean, merged; uncertainty keeps it) is not the missing-directory path. Porcelain `prunable` returns `directory missing` / `removable: true` before `inUse` is considered, including when the owner is in use or unknown. "Anything uncertain is kept" is true only while the directory is still there. Keep the separate concern that `git worktree prune` is repo-wide.

### R1-RUN-11 MAJOR accuracy ph send does not require the wait to end idle
- Severity: MAJOR
- Category: accuracy
- Map entry: RUN-43
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:254-264
- Fix: The pre-send wait is raw `waitForFinish`, not `waitTurn`, and its return value is ignored. A timeout or non-idle status does not by itself fail the item; delivery still happens unless `waitForFinish` throws. The following poll (500 ms, 15 s) for `status === "running"` also does not fail the item: when it times out the command still prints `sent`.

### R1-RUN-12 MAJOR accuracy In-scope tests are not only the four helpers
- Severity: MAJOR
- Category: accuracy
- Map entry: Invariants and lessons (the "Test the tests" bullet)
- Evidence: kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs:30-71,73-118,120-136
- Fix: That file also tests workflow `parseScript`, pipeline/parallel nulls, resume cache, budget ceiling, one-level `workflow()`, `Date.now` / `Math.random`, and watchdog read/write names for Claude Code, Codex and OpenCode (`armWatchdog` / `onWatchEvent`). Keep the true gap: doctor, `resolveTargets`, `parseFanout`, worktrees, compact-self, freeze, task locking, prompt assembly and `validate` have no test in this file. RUN-53's "test only covers readyTasks" should mention the watchdog test above it.

### R1-RUN-13 MAJOR coverage Section 10 limits that this map owns are missing
- Severity: MAJOR
- Category: coverage
- Map entry: missing
- Evidence: kit:project/.agents/skills/harness/references/paseo-runtime.md:387-392,407; kit:project/.agents/harness/runtime/workflow_engine.mjs:15-16
- Fix: Section 10 is in this map's brief (only section 6 is workflow's). Add: workflow scripts are trusted (`node:vm` is not a boundary; a busy loop hangs the runner; un-awaited calls can run after `workflow done`; audit ENG-2..4). Resume cache key is `schema, agentType, model, effort, isolation, readOnly, cwd` plus the prompt text, not the definition body, includes, or the resolved provider/model (ENG-5). RUN-16 must say the cached "model" is the option string (`args.model` / `opts.model`); changing a tier's `provider` in defaults does not invalidate. Budget is checked before `agent()` starts, so agents already running can take `spent()` past `total`.

### R1-RUN-14 MAJOR coverage Two doc-vs-code conflicts are not recorded
- Severity: MAJOR
- Category: coverage
- Map entry: missing
- Evidence: kit:project/.agents/skills/harness/references/paseo-runtime.md:62,127,163-164; kit:project/.agents/harness/runtime/prompts.mjs:72-83; kit:project/.agents/harness.defaults.json:58-63
- Fix: CONFLICT: the primitive table says a definition `tools:` list is "listed in the prompt"; section 4 and `composePrompt` do not insert it (section 4 says the list is not shown). CONFLICT: section 4 says "Delegation is not forced in a main session; use ph when requested." Defaults require the main provider to deny `Agent`, `Workflow` and `SendMessage`, and the 2026-10-20 owner decision denies Agent and Workflow on the main provider. RUN-04's SendMessage conflict stays; this sentence is a second one.

### R1-RUN-15 MINOR accuracy Daemon connect argument
- Severity: MINOR
- Category: accuracy
- Map entry: RUN-25
- Evidence: kit:project/.agents/harness/runtime/daemon.mjs:27-34,44
- Fix: `connectToDaemon` is called with `{ target: { kind: "instance", home } }`, not a flat `{kind, home}`. The structured-output module is resolved from `<cli>/node_modules/@getpaseo/server` or `<cli>/../server`, via package export `./agent-response`.

### R1-RUN-16 MINOR citation Budget unit and hang policy cite the wrong lines
- Severity: MINOR
- Category: citation
- Map entry: RUN-27, RUN-64
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:642-643,695-701; kit:project/.agents/harness.defaults.json:113; kit:project/.agents/skills/harness/references/paseo-runtime.md:245
- Fix: "Budget tokens = output tokens" is the comment at commands.mjs:642-643 and the `budget.spent()` paragraph at paseo-runtime.md:245, not `UsageTracker` (daemon.mjs:50-89). The file-tool hang (first interrupt, second archive) is defaults.json:113 plus the retry at commands.mjs:695-701; commands.mjs:662-677 is the warmup gate and `createAgent`.

### R1-RUN-17 MINOR coverage Exact notes and the skills field
- Severity: MINOR
- Category: coverage
- Map entry: RUN-20, RUN-45
- Evidence: kit:project/.agents/harness/runtime/prompts.mjs:9,56; kit:project/.agents/harness/runtime/commands.mjs:301-310
- Fix: Quote the notes. Read-only: `Read-only role: do not create, edit, move or delete files, except output files this prompt names.` Cwd: `Your working directory for this task is <dir>: run shell commands there and resolve relative paths against it.` `skills` is the set of timeline `tool_call`s in the last 1000 entries (`direction: "tail"`) whose name matches `/^skill$/i`, taking `input.skill ?? input.command ?? input.name ?? detail.label ?? detail.text ?? "?"`.

### R1-RUN-18 MINOR coverage BOM skips and writeJson shape
- Severity: MINOR
- Category: coverage
- Map entry: Concerns
- Evidence: kit:project/.agents/harness/runtime/commands.mjs:471,509,596,748; kit:project/.agents/harness/runtime/workflow_engine.mjs:314-318
- Fix: The concern names `kitManifest` and the doctor machine-file read. The same skip hits `ph archive --run`'s `run.json`, `tasks.json`, a resumed `args.json` (`--args-file` does strip BOM), and the freeze record. `writeJson` (fanout `.json`, `tasks.json`, `run.json`, `args.json`, `result.json`) is 2-space JSON, trailing newline, written via `<file>.tmp<pid>` then rename.

### R1-RUN-19 MINOR accuracy Run-id clock and zero stuck limits
- Severity: MINOR
- Category: accuracy
- Map entry: RUN-55, RUN-64
- Evidence: kit:project/.agents/harness/runtime/workflow_engine.mjs:308-311; kit:project/.agents/harness/runtime/watchdog.mjs:126,140-143
- Fix: `newRunId` (and therefore spawn worktree stamps, `slice(3)` of `wf_...`) uses local `getFullYear`/`getHours`, not UTC. `agent_tool_stuck_s` and `agent_file_tool_stuck_s` of 0 skip the hang check (`limitS > 0`), same as nudge/stop; RUN-64 mentions only nudge/stop.

### R1-RUN-20 MINOR structure Coverage line counts are one short
- Severity: MINOR
- Category: structure
- Map entry: Coverage
- Evidence: kit:project/.agents/harness.defaults.json:125; kit:project/.agents/harness/runtime/commands.mjs:894; kit:project/.agents/skills/harness/references/paseo-runtime.md:433; wildera:.agents/model-prices.json:158
- Fix: The table's line counts omit the trailing blank line (defaults 124 vs 125, commands 893 vs 894, runtime doc 432 vs 433, model-prices 157 vs 158, and the same pattern on the other kit files). The bodies were actually read; correct the numbers. No in-scope path is missing from the table.

### R1-RUN-21 MINOR accuracy Shortened silent note and a WildEra clause
- Severity: MINOR
- Category: accuracy
- Map entry: RUN-21, RUN-23
- Evidence: kit:project/.agents/harness/runtime/prompts.mjs:8; kit:project/.agents/skills/harness/references/paseo-runtime.md:145-146; wildera:.agents/harness.config.json:49
- Fix: Record the doc/code wording gap: the doc's silent note drops "plans or commentary" and "(nobody reads them)". WildEra's `first_prompt_note` also says "report only in your final reply of the turn", which RUN-23's summary of the 2026-10-18/19 append does not include.

## Citations checked

| map entry | citation | ok / wrong |
| --- | --- | --- |
| RUN-01 | kit:project/.agents/harness/config.mjs:7-8,13-17,23-33 | ok: overlay path, `_` and machine keys skipped, `__proto__` throws, per-entry merge |
| RUN-02 | kit:project/.agents/harness/config.mjs:12,26-32,108-112 | ok: `MERGED_KEYS` and `model_pattern` dropped with that warning |
| RUN-04 | kit:project/.agents/harness.defaults.json:58-63 | ok: Agent, Workflow, SendMessage |
| RUN-04 CONFLICT | kit:project/.agents/skills/harness/references/paseo-runtime.md:77-78 | ok: doc names only Agent, Workflow |
| RUN-06 | kit:project/.agents/harness/config.mjs:64-96 | ok: positive keys, tier shape, nested exact keys, `fileMaxChars <= replyMaxChars < 500000` |
| RUN-07 | kit:project/.agents/harness/runtime/commands.mjs:33-36,883-887 | partial: validate failures are caught; `configProvenance` at 60-61 is outside that try |
| RUN-09 | kit:project/.agents/harness/config.mjs:19-22 | wrong: `../../../` is three levels to the `.agents` parent, not four and not the git root |
| RUN-10 | kit:project/.agents/harness.defaults.json:109-114 | ok: nudge 900, stop 1800, file-tool hang note |
| RUN-10 CONFLICT | paseo-runtime.md:294-296 | ok: doc still says nudge 300 / stop 900 |
| RUN-12 | kit:project/.agents/harness/runtime/prompts.mjs:60-64 | ok: UTF-8 byte length, Error text as quoted |
| RUN-13 | kit:project/.agents/harness/runtime/models.mjs:23-33 | ok: alias if not a tier, then tier, then `/`, then allowlist, then provider map |
| RUN-14 | kit:project/.agents/harness/runtime/commands.mjs:63 | partial: that call passes false; line 57 does not |
| RUN-15 | kit:project/.agents/harness/runtime/models.mjs:4-16 | ok: nearest, ties high, `off` and unknown ids skipped |
| RUN-18 | kit:project/.agents/harness/config.mjs:119-129 | ok: identity regex, omp/codex/opencode/pi false, then `extends`, then name regex |
| RUN-20 | kit:project/.agents/harness/runtime/prompts.mjs:25-27 | ok: word tools plus mutating method names; no `tools` means not read-only |
| RUN-21 | kit:project/.agents/harness/runtime/prompts.mjs:72-83 | ok: note order silent/return, team, safety, tag |
| RUN-24 CONFLICT | paseo-runtime.md:147-148 vs prompts.mjs:78 | ok: doc says project root; the note has name, leader id8, task and send only |
| RUN-25 | kit:project/.agents/harness/runtime/daemon.mjs:44 | wrong paraphrase: argument is `{ target: { kind: "instance", home } }` |
| RUN-26 | kit:project/.agents/harness/runtime/daemon.mjs:109-131 | ok: bounds, caller, plugin env, clamp, labels, archive if tracking fails |
| RUN-27 | kit:project/.agents/harness/runtime/daemon.mjs:74-79 | ok for the 2s settle; does not say budget tokens are output tokens |
| RUN-30 | kit:project/.agents/harness/runtime/daemon.mjs:175-180 | wrong on the last sentence: uuid fetch does not drop archived agents |
| RUN-32 | kit:project/.agents/harness/runtime/daemon.mjs:13-14,151-157 | ok: deny text, max 3, then throw `agent is waiting for a permission` |
| RUN-34 | kit:project/.agents/harness/runtime/commands.mjs:876-890 | ok: help exit 0, unknown exit 1, UsageError vs `failed:` |
| RUN-38 | kit:project/.agents/harness/runtime/commands.mjs:110-138 | ok: count names, capacity, parallel, `failed spawn`, hint, exit 2 |
| RUN-42 | kit:project/.agents/harness/runtime/commands.mjs:202-236 | ok: no free slot refuses; collect queues; json before archive; `--keep` |
| RUN-43 | kit:project/.agents/harness/runtime/commands.mjs:256-264 | partial: wait is issued, but its status is not checked |
| RUN-48 CONFLICT | commands.mjs:356 vs defaults.json:96 | ok: fallback lacks the Monitor clause; config value is used when present |
| RUN-49 | kit:project/.agents/harness/runtime/commands.mjs:405-449 | ok: half-tokens, 3s / 15 min, no retry, NOT confirmed text |
| RUN-51 | kit:project/.agents/harness/runtime/commands.mjs:474 | partial: rewrite is inside `if (info.status === "running")` |
| RUN-56 | kit:project/.agents/harness/runtime/worktrees.mjs:58-63 | partial: clean+merged is removable; missing directory is removable earlier, at 58 |
| RUN-61 | kit:project/.agents/harness/runtime/plugins.mjs:36-45 | ok: env ignores Claude version; native enabled+registered adds nothing |
| RUN-65 | wildera:.agents/harness.config.json:36-38,49-73 | ok: haiku without `[1m]`, 18 allowlist entries, start_pct 45, watchdog numbers |
| RUN-66 | wildera:.agents/harness/runtime/pricing.mjs:25-31 | ok: null if no input/output price; long context when maxContext is over the threshold; 4-decimal rounding |
| Invariants tests | kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs:120-136 | wrong: watchdog classification is tested in this file |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| --- | --- | --- |
| kit:project/.agents/harness.defaults.json | yes | 0 (values and incident notes are in RUN-10/11/12/64; SendMessage conflict recorded) |
| kit:project/.agents/harness/config.mjs | yes | 1 (manifest fallback depth, RUN-09) |
| kit:project/.agents/harness/platform.mjs | yes | 0 |
| kit:project/.agents/harness/runtime/commands.mjs | yes | 8 (schema/prime, warmup timer, log routing, detach caller, send wait status, doctor JSON, archive rewrite condition, workflow title slice) |
| kit:project/.agents/harness/runtime/common.mjs | yes | 0 |
| kit:project/.agents/harness/runtime/daemon.mjs | yes | 2 (uuid not filtered; catalogue miss still creates) |
| kit:project/.agents/harness/runtime/models.mjs | yes | 0 |
| kit:project/.agents/harness/runtime/plugins.mjs | yes | 0 |
| kit:project/.agents/harness/runtime/prompts.mjs | yes | 1 (exact read-only and cwd sentences not quoted) |
| kit:project/.agents/harness/runtime/worktrees.mjs | yes | 1 (prunable directory skips the uncertainty rule) |
| kit:project/.agents/skills/harness/scripts/paseo_harness.mjs | yes | 0 |
| kit:project/.agents/skills/harness/scripts/shared_paths.mjs | yes | 0 |
| kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs | yes | 0 omitted product rules; the invariant mis-states what the file tests |
| kit:project/.agents/skills/harness/references/paseo-runtime.md | yes | 3 (ENG-2..5, budget can pass total, tools-list and delegation conflicts) |
| kit:templates/harness.config.json | yes | 0 |
| wildera:.agents/harness.config.json | yes | 1 (final-reply clause of `first_prompt_note`) |
| wildera:.agents/model-prices.json | yes | 0 (model set and the gemini `-high` note match RUN-66) |
