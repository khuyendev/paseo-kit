# Map: History (incident-driven rules and owner decisions)

Citation prefixes: `kit:` `wildera:` as given. Extra short forms used here: `kit@omp:CHANGELOG.md:N` = `git show omp:CHANGELOG.md` line N; `kit@omp-pre-rewrite:CHANGELOG.md:N` likewise; `kit-git:N` = line N of the output of `git -C <kit> log --all --format="%h %ad %D%n%B" --date=short` (226 lines, 20 commits); `dino:` = C:/Users/fish/Desktop/WildEraV6-dino; `ktp:` = C:/Users/fish/Desktop/kit-test-project; `mem:` = C:/Users/fish/.claude-circle/projects/C--Users-fish-Desktop-paseo-harness-kit/memory.

## Coverage
| file | lines | read fully |
| --- | --- | --- |
| kit:CHANGELOG.md | 56 | yes |
| kit:README.md | 172 | yes (Requirements :29-38 and all stated limits) |
| kit-git (git log --all, 20 commits: main, omp, omp-pre-rewrite, rewrite/claude-mods) | 226 | yes |
| kit@omp:CHANGELOG.md | 239 | yes |
| kit@omp-pre-rewrite:CHANGELOG.md | 140 | yes (it equals the omp file minus the 0.2.0 and 0.2.1 sections; only difference besides that: a commit hash in the 0.1.0 text, 5a3647e vs 7e45154 after the history rewrite; checked with diff) |
| wildera:.agents/harness-history.md | 47 | yes |
| wildera:.planning/STATE.md | 162 read (pin 89143da has 160 lines; lines 161-162, and a line 163 seen only in a later re-read, are uncommitted working-tree text and are marked as such where cited) | yes (whole file, not only decision sections) |
| wildera:_workspace/gsd-port/DESIGN.md | 181 | yes (whole file; `_workspace/` is gitignored, so the file is not in commit 89143da, it exists only on disk) |
| dino:.agents/harness-history.md | 42 | yes; rows :9-:42 are identical to wildera rows :9-:42 (2026-10-14..2026-10-17); no later rows |
| ktp:.agents/harness-history.md | 8 | yes; header only, zero rows |
| C:/Users/fish/Desktop/god-vibe-code/.agents/harness-history.md | - | file does not exist (wc: No such file) |
| mem:MEMORY.md | 5 | yes |
| mem:main-session-no-native-subagents.md | 21 | yes |
| mem:no-kit-overrides-of-tool-settings.md | 14 | yes |
| mem:omp-migration-policy.md | 27 | yes |
| mem:omp-prompt-review-first.md | 14 | yes |
| mem:test-model-luna-fast.md | 11 | yes |

No source file was skipped. This map owns only the rule, its date, its validity and the owning area; mechanism detail lives in the other maps.

## Summary
The history is three layers: (1) the kit CHANGELOG (0.0.1 -> 0.1.0 on main, plus the unreleased watchdog fix) and the omp branch changelog (0.1.0-0.2.1, 2026-10-11, now abandoned); (2) the per-project `harness-history.md` table (one row per change, "Reason" says why) from WildEraV6, whose rows are mostly code-wave/Verify/review lessons learned in real Unreal waves; (3) the owner's decisions, recorded in STATE.md, DESIGN.md and the memory files.
Most rules were learned from a concrete failure: a watchdog that stopped healthy agents, review loops that never converged, resumes that lost context, models that silently stayed on the old session model, and debug fixes that changed fixtures instead of the product. The rewrite should keep the rules, not the Unreal mechanisms (those belong to a project adapter).
Owner decisions of 2026-10-20 supersede the omp line (not carried), Backlog (dropped) and "GSD as a WildEra port" (GSD core ships in the kit). The ledger below marks each decision in force or superseded.
Worth keeping in spirit: reason-first change rows; owner wording recorded verbatim with date; one place per setting (never override another tool's config); bounded loops with stall detection and a named escalation; evidence-first review (trigger, confidence, verifier); root-cause-not-fixture fixes; recovery that never silently reuses stale state (digests, fingerprints, readback of the actual model).
Sources disagree in several places (README native Agent text, coder-builds rule, reviewer model, send-to-mid-turn rule); each is flagged CONFLICT in its entry.

## Behaviors

### HIS-01 Watchdog times a tool call from its complete input
- Behavior: a tool call's stuck clock starts when its input is complete, not at tool_use block start. Readiness: Write needs `content`; Edit `newString` or `unifiedDiff`; shell `command`; batch write/edit tools their payloads (`write_multiple_files`, `edit_multiple_files`, `write_file`, `edit_file`); other tools a non-empty input. Generation time before readiness counts as model time (nudge/stop path), not tool time. Reads Paseo typed details (`{type:"write",filePath,content}`, `{type:"shell",command}`, no `detail.input`) so native Read/Write/Edit/Bash count for reread/repeat/piecemeal checks.
- Proposal: KEEP (owner area: runtime; payload names for non-Claude MCP tools can shrink to the Claude/mod tool names).
- Source: kit:CHANGELOG.md:5
- Why it exists: workflow wf_20261015-011128_ecea lost 3 of 4 architecture drafts; the Circle proxy delivered a 15 KB Write's content 104 s after its path, so the 180 s file-tool limit interrupted active agents (kit:CHANGELOG.md:5).
- Test idea: replay events path-at-0s, content-at-104s, done-at-104.2s with a 180 s file limit: no interrupt ("watchdog times a call from its complete input").

### HIS-02 Watchdog remembers finished calls; file-tool limit; two-strike policy
- Behavior: a tool completion that arrives before its running event must not open a call that never closes; the watchdog keeps finished call ids. General stuck limit `agent_tool_stuck_s` 900 s; file tools `agent_file_tool_stuck_s` 180 s; the first real hang interrupts the turn and asks the agent to retry with smaller calls; the second archives it. The history row's simulation left a 400 s Bash hang untouched (it is under 900 s and Bash is not a file tool); 400 s is a test event, not a third limit.
- Proposal: KEEP (limits as config defaults 900/180).
- Source: wildera:.agents/harness-history.md:14; dino:.agents/harness-history.md:14
- Why it exists: a late running event opened a call that never closed; after 900 s the watchdog archived a healthy agent although every batch file call returned in under 1 s (wildera:.agents/harness-history.md:14). Earlier symptom: coders stopped after 15 min (wildera:.agents/harness-history.md:13).
- Test idea: simulate completed-before-running (no stop), file hang 200 s (interrupt), Bash 400 s (untouched), second hang (archive) - the recorded simulation set.

### HIS-03 Workflow runner waits for the watchdog's retry turn
- Behavior: after a first-hang interrupt the workflow runner waits for the watchdog's retry message and the retry turn instead of returning `finished without a reply`.
- Proposal: KEEP
- Source: kit:CHANGELOG.md:5
- Why it exists: same incident as HIS-01 (interrupted agents returned empty).
- Test idea: interrupt a workflow agent once; the run result is the retry turn's reply, not "finished without a reply".

### HIS-04 Per-edit syntax check is project-owned, tree-aware, non-blocking
- Behavior: the kit ships no syntax hook; `kit-init` writes a project-owned one that compares each edited file before and after the edit and reports without blocking. It resolves checker and build flags from the tree that holds the edited file, not the agent's cwd. The C++ hook got a 75 s total budget "as a precaution" (the real cause was HIS-02).
- Proposal: CHANGE (hook stays project-owned via kit-init; keep tree-of-the-edited-file and report-don't-block rules; the 75 s budget is a project-adapter value).
- Source: kit:CHANGELOG.md:9; wildera:.agents/harness-history.md:13,21
- Why it exists: worktree coders were started in the main tree, so per-edit C++ checks skipped their files ("not in a WildEra module") and CompileFile compiled the main tree; 154 compile errors after review (wildera:.agents/harness-history.md:21).
- Test idea: edit a file in a git worktree while cwd is the main tree: the hook checks it with the worktree's config.

### HIS-05 File read limits
- Behavior: a file over `fileMaxChars` 200,000 is not read whole (entry gives size, line count and how to read part); one reply over `replyMaxChars` 450,000 defers files to another call; text reads refuse binary files; at most `mediaPerTurn` 1 image per turn on the media read; a failed `edit_file` names the single same-named nearby file.
- Proposal: KEEP limits and binary refusal in the file backend (files area); image cap only if a media path is kept; native Read handles images/PDFs/notebooks.
- Source: kit:CHANGELOG.md:42-49 (native Read for images/PDFs/notebooks is HIS-08, kit:README.md:103-105)
- Why it exists: one `read_multiple_files` of 24 files returned 6.1 MB that Claude Code saved to a file the agent re-read in pieces; GPT agents that opened 5-7 render PNGs in one turn got API error 400 (input over the context window) (kit:CHANGELOG.md:45-49).
- Test idea: read 24 x 300 KB files in one call: reply bounded, remaining files listed as deferred; one 300 KB file returns size, lines, how-to.

### HIS-06 Batch edit semantics: fix IDs, resent edits, line edits, bounds
- Behavior: `edit_multiple_files` partial success with retained fix IDs; a resent already-applied edit is skipped (signatures of the newest 2,000 edits per session; not for dryRun or aborted calls; an `oldText` the session never wrote still fails). `read_ranges` headers carry a tag; line edits `{from,to,newText}` / `{after,newText}` use per-line hashes of the newest 64 reads (max 30,000 lines); a stale tag applies in place if the range is unchanged, else at the one place where its lines plus two around still match (reported as moved); changed lines are never edited. Retained fixes bounded 500 IDs / 8 MiB; transport tickets expire after 1 h; state per session; backend operations serialized; expired state reported, not silently executed; receipts recover uncertain outcomes without rerunning.
- Proposal: KEEP intent (files area sets numbers); CHANGE: Claude mod tools only, no MCP transport.
- Source: kit:CHANGELOG.md:19,21; kit:README.md:88-101
- Why it exists: a resent replacement whose oldText was gone failed `found 0 times` with a new fix ID; a resent insert at a read edge would have been inserted twice (kit:CHANGELOG.md:21). Line edits save the output tokens of quoted old text (kit:CHANGELOG.md:19).
- Test idea: apply `return 1`->`return 2`, resend it: reported skipped as already applied; resend an `after:0` insert: no duplicate.

### HIS-07 Per-file failure isolation in batch edits (lesson from omp-io)
- Behavior: in a batch, a malformed or rejected section fails that file alone with a retained id while other files apply.
- Proposal: KEEP as a principle for `edit_multiple_files` / `write_multiple_files` (mod already has partial success; `atomic` opts out).
- Source: kit@omp:CHANGELOG.md:81-86,97-100
- Why it exists: two agents lost a batch of four for two new files written `[path#]`; after the fix worker turns fell 13/7/10 -> 7/7/10 and cost 0.043 -> 0.038 USD (kit@omp:CHANGELOG.md:84-86,97-100).
- Test idea: batch of 4 files with 2 invalid: 2 applied, 2 failed with ids, call not aborted (unless atomic).

### HIS-08 Direct mod tools replace MCP; only three batch tools load upfront
- Behavior: the `harness-files` mod registers read_ranges/edit_multiple_files/write_multiple_files directly; names keep the `mcp__harness-files__<method>` prefix but no stdio MCP process runs. Only these three load upfront, other helpers via ToolSearch (9 initial full schemas versus 13 before, measured with a loopback fake model). Native Read/Edit/Write stay usable; the mod never fabricates native Read state; large results are paginated, not relying on MCP `maxResultSizeChars`. Fail-closed path permission checks; denied/ask/plan-mode operations must not become authorized; a trusted mod is not a sandbox.
- Proposal: KEEP; DROP MCP adapters, `machine.local.json`, official filesystem MCP requirement (owner: non-Claude MCP file adapters dropped).
- Source: kit:CHANGELOG.md:25,34-35; kit:README.md:36,83-111
- Why it exists: prompt/tool-loading cost; MCP output metadata unreliable on mod tools (kit:README.md:101).
- Test idea: start a session with the mod: exactly 3 batch schemas load upfront; a permission-denied path stays denied.

### HIS-09 Prompt and message size discipline
- Behavior: tool descriptions shortened while keeping exact matching, partial success, fix forms, atomic/dryRun and path/size behaviour; the kit's Writing Principles / "Applying the principles to code" / Dependencies blocks removed; all outbound startup/role/task messages enforce prompt size limits; queued workflow calls recheck budget at admission.
- Proposal: KEEP in spirit (every shipped prompt line earns its tokens; outbound prompt size limit enforced).
- Source: kit:CHANGELOG.md:23-25,32
- Why it exists: token cost; omp first request 17,385 -> 5,408 input tokens after trimming (kit@omp:CHANGELOG.md:197).
- Test idea: a message over the prompt limit is refused with the limit named.

### HIS-10 Child identity and reminder suppression
- Behavior: main-session context reminders do not match model names; native child identity and the `ph` worker env suppress them; a named main `--agent` session is still main; output stays `additionalContext` (no forced autocompaction, no UI notification). A native child loop whose permission identity cannot be preserved is directed to native tools instead of running under the parent's identity.
- Proposal: KEEP (hooks area).
- Source: kit:CHANGELOG.md:33; kit:README.md:106-107,115-120
- Why it exists: the earlier guard matched model names (the omp guard was set to `model_pattern "."`, every model, kit-git:100; kit@omp:CHANGELOG.md:132-133).
- Test idea: worker env set -> no reminder; main session with an unknown model name -> reminder at start_pct.

### HIS-11 Context guard thresholds
- Behavior: reminder at `start_pct` (default 60) then every `step_pct` (default 5); uses reported window size else `window_tokens`. WildEra overlay sets start_pct 45.
- Proposal: OPEN (default 60 vs 45) - see open questions.
- Source: kit:README.md:118-121; wildera:.agents/harness-history.md:41
- Why it exists: owner "compact earlier" during long GSD sessions (wildera:.agents/harness-history.md:41).
- Test idea: crossing start_pct injects one reminder, then one per step.

### HIS-12 compact-self protocol and one watcher per agent
- Behavior: the agent runs `compact-self --focus "..."` at a safe break and ends its turn; a detached watcher waits for idle, sends `/compact`, verifies a context reduction, sends the resume message; failure/cancel is reported, not treated as confirmed. Native autocompact is a separate setting and is not overridden by the reminder (kit:README.md:130). Lesson from the omp branch, not present on main: exactly one watcher per agent (lock file with pid). Main at ref-final has no such lock: `cmdCompactSelf` spawns a detached `_compact-run` each time and success is a used-token drop below 0.5 x the pre-compact value, 900 s timeout, 3 s polling, no retry (kit:project/.agents/harness/runtime/commands.mjs:353-356,386-441 at ref-final).
- Proposal: KEEP the protocol including "do not override native autocompact"; CHANGE: add the one-watcher-per-agent lock to the Claude Code watcher (omp incident to re-implement, not an existing main behavior); omp session-file confirmation DROP.
- Source: kit:README.md:122-130; kit@omp:CHANGELOG.md:217-221,36-41; kit-git:158-159
- Why it exists: an agent that kept working after arming had armed four watchers and received the resume message four times (kit@omp:CHANGELOG.md:219-221); omp success went unconfirmed for 15 minutes without the session file (kit@omp:CHANGELOG.md:39-41).
- Test idea: arm twice for one agent: second call refused or no-op; resume message sent once.

### HIS-13 Waiting for agents: print the exact watch command; never hand-roll poll loops
- Behavior: `ph spawn/send/fanout` (no --collect) and `workflow --detach` print the exact `watch`/`watch-run` command to run under Monitor; `fanout --collect` states it blocks in the foreground; `ai-orchestrator` has a "Waiting for agents" section. Agents end their turn while waiting on background commands or agents (no blocking wait tool).
- Proposal: KEEP
- Source: wildera:.agents/harness-history.md:9; kit@omp:CHANGELOG.md:13-16; kit@omp:CHANGELOG.md:76-79
- Why it exists: owner saw the orchestrator background a `fanout --collect` and poll its output with a hand-written sleep/grep loop (wildera:.agents/harness-history.md:9); an omp orchestrator blocked its turn on `wait` while a workflow ran (kit@omp:CHANGELOG.md:15-16). The omp note that background commands wake the agent is omp-specific (kit@omp:CHANGELOG.md:76-79, "true of Claude Code" the opposite).
- Test idea: `ph spawn` stdout contains a runnable `watch` line; `fanout --collect` help says it blocks.

### HIS-14 watch-run resume summary
- Behavior: `ph watch-run` attached to a run with existing log lines prints one "resuming ... skipped N lines; current phase ..." summary (plus any terminal line) instead of replaying the log; `--from-start` replays.
- Proposal: KEEP
- Source: wildera:.agents/harness-history.md:10
- Why it exists: re-arming a Monitor after its 30-minute expiry replayed the whole run log as one event.
- Test idea: attach to a run with 500 log lines: output is one summary line plus terminal state; with `--from-start` all lines.

### HIS-15 Transient provider errors are retried
- Behavior: an error turn, or a reply whose text is a provider error (API Error, overloaded, 5xx, 429), is continued in the same agent after pauses 30, 60, 120, 240, 300 s, up to 5 times. Quota, auth, credit and permission errors stop at once.
- Proposal: KEEP (runtime; schedule is a config default)
- Source: wildera:.agents/harness-history.md:20
- Why it exists: a W3 reviewer's final reply was "API Error: ..." and its task got a null review (wf_20261016-141025_c6f4); before, error replies were not retried and an error turn was continued once.
- Test idea: reply text "API Error: overloaded" -> 5 continuations with the listed pauses; "quota exceeded" -> immediate stop.

### HIS-16 Workflow agent sessions
- Behavior: `agent({session})`: the first call creates and keeps the agent; later calls with the same session send only their prompt (per-call token accounting); a failed call archives the agent; run end archives every session agent. Coder and fixer calls use `session: coder:<task>`; reviewers stay fresh (independence). A resumed run adopts the agent of each cached session call, so the next call continues the archived agent with its context. A session agent the daemon no longer knows ("not found") starts a fresh agent with the full prompt and logs a warning, never a null "returned nothing" turn.
- Proposal: KEEP
- Source: wildera:.agents/harness-history.md:18,27,39
- Why it exists: every fix round started a fresh coder that re-read task, plan and its code (wildera:.agents/harness-history.md:18); resume started every fixer fresh (:27); after a machine restart the Paseo daemon hit EMFILE loading ~/.paseo/agents and skipped every pre-restart agent, so resumed fixers returned nothing (:39).
- Test idea: smoke workflow: session call recalls a code word, a fresh agent does not; resume recalls it; delete the agent in the daemon: next call starts fresh with full prompt.

### HIS-17 Resumed session model readback
- Behavior: a resumed session agent has its model updated and read back before sending; refuse on active turn or provider mismatch; `cachedCodeModel` preserves only previous Code cache identities and never authorizes an old-model live cache miss.
- Proposal: KEEP
- Source: wildera:.agents/harness-history.md:38
- Why it exists: resumed workflow turns changed only the logged/requested model, leaving the actual session on its original model (wildera:.agents/harness-history.md:38).
- Test idea: resume with a different model: the session reports the new model before the prompt is sent; active-turn resume refuses.

### HIS-18 List-price costing
- Behavior: `.agents/model-prices.json` (USD per 1M tokens, checked from official pages) and `pricing.mjs`; each workflow agent call journals `usage {input, cachedInput, output, maxContext, costUsd, reportedCostUsd}`; `agent done` and `workflow done` print list cost; `ph result --json` tokens carry `costUsd` (list) and `reportedCostUsd`.
- Proposal: KEEP (runtime; price file is a data file the owner maintains)
- Source: wildera:.agents/harness-history.md:46
- Why it exists: the daemon's totalCostUsd is Claude Code's estimate and priced a Gemini 3.8 Flash agent at Opus rates (1.13 vs 0.23 USD list); workflow `tokens` counted output only.
- Test idea: journal an agent call with a known model: costUsd equals tokens x price file rate.

### HIS-19 Models are decided by args/config, not scripts or agent front matter
- Behavior: coder/reviewer model and effort come from workflow args with tier fallback; agent front-matter models are fallbacks; the SKILL records the current owner choice; a provider outage must not need a script edit. A project dispatch allowlist can block models. Owner picks models by quota, and the policy changed repeatedly (see CONFLICT in the ledger).
- Proposal: CHANGE (models per role live in the project adapter; the kit hardcodes no model besides defaults)
- Source: wildera:.agents/harness-history.md:15,38; wildera:.planning/STATE.md:32,36,126,140,151
- Why it exists: a provider outage needed a script edit to change models (wildera:.agents/harness-history.md:15); owner decisions follow quota (wildera:.planning/STATE.md:32).
- Test idea: change the coder model in the adapter only; a run uses it with no script edit.

### HIS-20 Probe/test agents use Luna Fast
- Behavior: probe, smoke and A/B trial agents run `circle/gpt-6-luna-fast[1m]` unless the owner names another model; model probes need a separate approved budget; offline fixtures set contracts, not paid end-to-end behaviour.
- Proposal: KEEP
- Source: mem:test-model-luna-fast.md:8-11; kit:README.md:165-167
- Why it exists: owner asked 2026-10-11 to test cheaply.
- Test idea: the kit's probe helper defaults to the Luna Fast model id.

### HIS-21 Worker agents run unattended
- Behavior: coders never SendMessage or ask; blockers go into `contractRequests`/`openInputs`/`notes` of the structured result; `needs-owner` is a workflow status, not a question.
- Proposal: KEEP (agent prompt rule in the core agents)
- Source: wildera:.agents/harness-history.md:29; wildera:_workspace/gsd-port/DESIGN.md:131-132
- Why it exists: the observation fixer tried SendMessage to "main" about another owner's contract; the call failed and the question was lost.
- Test idea: coder prompt forbids SendMessage; result schema has the blocker fields.

### HIS-22 Do not `ph send` to a mid-turn agent
- Behavior: batch follow-ups and send when idle. Later note: `ph send` to a running agent waits for its turn end; `--now` interrupts.
- Proposal: CONFLICT (history row says never send mid-turn; STATE says send queues, `--now` interrupts; DESIGN.md:24-25 adds that `ph send` may still deliver to an archived agent per a paseo-runtime 6-2 session note) - runtime area decides actual semantics; keep "batch follow-ups, send when idle" as guidance.
- Source: wildera:.agents/harness-history.md:17; wildera:.planning/STATE.md:119
- Why it exists: 3 quick orchestrator sends interrupted a working debugger's turn (wildera:.agents/harness-history.md:17).
- Test idea: `ph send` to a busy agent: documented outcome (queued) and `--now` interrupts.

### HIS-23 Workflow `shell()` and workflow script sandbox
- Behavior: workflow scripts have no fs/require/import/Date.now/Math.random; globals agent, parallel, pipeline, phase, log, args, budget, shell, workflow; agent opts label, phase, schema, agentType, model, effort, readOnly, cwd, keep, session; `shell()` returns `{code, stdout, stderr, durationS}` and never rejects. Args files are written by file or node, never through shell interpolation.
- Proposal: KEEP (workflow area)
- Source: wildera:_workspace/gsd-port/DESIGN.md:178-180; wildera:.agents/harness-history.md:15,23
- Why it exists: shell interpolation dropped fixContext text (wildera:.agents/harness-history.md:15); `shell()` added so Verify runs in the workflow (:23).
- Test idea: a script using `Date.now` is rejected; `shell()` on a failing command resolves with code != 0.

### HIS-24 Worktrees: listing, prune, ownership
- Behavior: `ph worktrees [--prune]` lists harness worktrees with owner and state and removes only finished, clean, merged ones (branches via `git branch -d`); anything uncertain is kept. Mutating agents get disjoint files; read-only role notes are advisory, not isolation. install gitignores `.claude/worktrees/` and `_workspace/`.
- Proposal: KEEP
- Source: kit:CHANGELOG.md:13,17; kit:README.md:141-144
- Why it exists: not stated beyond clean-up safety.
- Test idea: dirty or unmerged worktree survives `--prune`; finished clean merged one is removed with `git branch -d`.

### HIS-25 Main session orchestrates only through Paseo/ph
- Behavior: `Agent` and `Workflow` are denied on the Paseo provider `circle` (workers on `circle-agent` already deny both). Carried by kit machine key `main_provider_disallowed_tools` (default `Agent`, `Workflow`) in `.agents/harness.defaults.json`, added additively to the main providers (keys of `agent_providers`) by provider sync / `machine.mjs apply`, never removing owner rules; reported by `check` and `ph doctor`; rendered into `paseo/providers.json` by `machine.mjs export`.
- Proposal: KEEP (owner decision restated 2026-10-20: native Agent/Workflow denied on the main provider).
- Source: mem:main-session-no-native-subagents.md:11-19; kit:CHANGELOG.md:15; kit:README.md:146-149
- Why it exists: one orchestration path (Paseo/`ph`), same logic on every machine (mem:main-session-no-native-subagents.md:18).
- Test idea: sync on a provider config lacking the key adds both entries and keeps an owner entry; `ph doctor` flags a missing one.

### HIS-26 README text contradicts the deny rule
- Behavior: README:7-9 says installation does not force Claude Code's main conversation to replace native `Agent` calls and that delegation is explicit; README:146-149 and CHANGELOG say the main provider denies them.
- Proposal: CONFLICT -> the deny rule (owner 2026-10-14, mem) wins; the new README must state: install does not edit Paseo settings by itself, `machine.mjs apply` carries the deny rule.
- Source: kit:README.md:7-9,146-149; kit:CHANGELOG.md:15; mem:main-session-no-native-subagents.md:11
- Why it exists: not stated (the README intro predates the 2026-10-14 decision).
- Test idea: doc lint: no sentence in the new README contradicts the deny rule.

### HIS-27 The kit never overrides another tool's settings
- Behavior: machine operations preserve owner server registrations and never toggle Paseo tool/browser/skill selections; Paseo's six skills (paseo, paseo-advisor, paseo-committee, paseo-handoff, paseo-help, paseo-plugin) come from `agents.skills.selection` in ~/.paseo/config.json and are switched in the Paseo app; a hiding workaround (`skills.ignoredSkills`) was rejected and reverted. Claude Code's own config decides what it offers. `metadataGeneration` (model for commit messages/PR texts/branch names) is left to Paseo: the provider template does not carry it.
- Proposal: KEEP; the only owner-requested exception is HIS-25 (changed through its kit key, not by hand).
- Source: mem:no-kit-overrides-of-tool-settings.md:11-14; kit:CHANGELOG.md:36; kit:README.md:8-9,22; kit@omp:CHANGELOG.md:5-11,31-35
- Why it exists: the owner wants one place per setting and no kit workarounds over other tools' settings.
- Test idea: `machine.mjs apply` on a config with custom skill selection leaves `agents.skills.selection` and `metadataGeneration` byte-identical.

### HIS-28 Paseo starts agents in the caller's directory; no kit workaround
- Behavior: on the omp branch `ph` refused per-agent directory (`--cwd`, `--worktree`, workflow `cwd`/`isolation`) with the reason, and refused to spawn when the caller ran outside the project root; parallel editors get disjoint files. The main branch keeps worktree isolation (HIS-24).
- Proposal: OPEN (runtime area: keep worktree isolation of main, but keep "fail loudly, no workaround" for a caller outside the project root).
- Source: kit@omp:CHANGELOG.md:31-35,74-76; mem:omp-migration-policy.md:17
- Why it exists: Paseo starts every subagent in the caller's directory, so they would work in and read `.omp/` of another folder (seen from the kit folder) (kit@omp:CHANGELOG.md:74-76).
- Test idea: `ph spawn` from outside the project root exits non-zero with the reason.

### HIS-29 Daemon address and stale paseo.pid
- Behavior: `ph` and provider scripts reach the daemon at `$PASEO_HOST`, else `daemon.listen` of the Paseo config; they do not read `paseo.pid`. Two separate incidents back the rule. (a) Earlier (omp commit 4f1a4af): a Desktop-managed daemon's `paseo.pid` named a gone process, so the pid file was stale and the listen address was used (kit@omp:CHANGELOG.md:199-200). (b) Later (CLI 0.11.2, 0.2.1): `paseo.pid` named the running Paseo process, yet `paseo daemon status` said localDaemon stopped on Windows, i.e. the CLI's own instance lookup missed a live Desktop-managed daemon; `--host` finds it and `configuredListen` is the same setting (kit@omp:CHANGELOG.md:47-51).
- Proposal: OPEN (install/runtime: recommend KEEP the address rule; verify it is present on main, where the omp commit 4f1a4af introduced the listen-address fallback).
- Source: kit@omp:CHANGELOG.md:47-52,199-200; kit-git:201
- Why it exists: stale `paseo.pid` (kit@omp:CHANGELOG.md:199-201); owner 2026-10-11.
- Test idea: with `PASEO_HOST` unset and a stale pid file, `ph doctor` reaches the daemon via `daemon.listen`.

### HIS-30 No Circle endpoint or secret in tracked files
- Behavior: the Circle endpoint (ANTHROPIC_BASE_URL) is not stored in the repo; provider template carries secrets as placeholders; a secret is filled from `PASEO_KIT_<NAME>` or the provider's own value, never from another provider; history was rewritten so no commit holds the endpoint.
- Proposal: KEEP
- Source: kit@omp:CHANGELOG.md:36-37,127-130; mem:omp-migration-policy.md:13 (history rewritten 2026-10-11, no commit holds the endpoint); kit-git:46-47 (commit pointing at the rewritten history); kit-git:52-75 (0.1.2 message: `{{secret:ANTHROPIC_BASE_URL}}` template, same text on the omp and omp-pre-rewrite branches)
- Why it exists: the GitHub repo is public (owner 2026-10-11) (kit@omp:CHANGELOG.md:127-128); `omp-pre-rewrite` must never be pushed (mem:omp-migration-policy.md:13).
- Test idea: a grep of tracked files for the endpoint host finds nothing; secret fill order test.

### HIS-31 Project carries everything it runs on
- Behavior: installed projects carry their own versioned defaults and runtime; no kit path in project files or providers; a kit change reaches projects only through `install update`; the source kit is authoritative for shipped files; installed copies are deployment artifacts.
- Proposal: KEEP (install area)
- Source: kit:README.md:24-26; kit@omp:CHANGELOG.md:56-58; mem:omp-migration-policy.md:17
- Why it exists: owner 2026-10-11: "no kit path in a project, a new dev machine clones the project only" (kit@omp:CHANGELOG.md:56-57).
- Test idea: move a project to another path: `ph config` and `ph doctor` work without the kit present.

### HIS-32 One defaults file and one loader; overlay is differences-only
- Behavior: `.agents/harness.defaults.json` (kit-owned) and one shared loader for runtime, hooks and file backend; `.agents/harness.config.json` project-owned, created once, never overwritten by update; `harness-kit.json` generated record, not a settings file; legacy `scripts/config.json` migrated with ownership/conflict checks, not silently discarded; `ph config` shows effective config.
- Proposal: KEEP (install/runtime)
- Source: kit:CHANGELOG.md:31; kit:README.md:13-27
- Why it exists: defaults used to be embedded in each consumer (kit:README.md:13).
- Test idea: change a default in the overlay only: all three consumers see it; update leaves the overlay untouched.

### HIS-33 Installer ownership and skill links
- Behavior: copies owned files, merges kit hooks without replacing unrelated settings, adds `@AGENTS.md` to CLAUDE.md, preserves locally modified owned files and project-only skills; `.claude/skills/<name>` is a per-skill junction (Windows) or relative symlink (POSIX) into `.agents/skills/<name>`; owner-edited old copies stay copies and are reported as conflicts (exit 2) while other skills link; any other skill-link error fails the install; `ph skills-sync` links new skills and rebinds junctions after a project move; test files are not installed and only unchanged previously owned tests are removed on update; `pull` promotes project changes back; resolve `local`/`both` conflicts before forcing an update.
- Proposal: KEEP (install area)
- Source: kit:CHANGELOG.md:27,37; kit:README.md:49-54,80-81
- Why it exists: not stated beyond data-loss avoidance for owner edits.
- Test idea: owner-edited skill copy: exit 2, others linked; unchanged copy migrates to a link.

### HIS-34 Marked .gitignore block
- Behavior: install, update and `skills-sync` keep a marked `paseo-harness-kit` block in .gitignore (created when missing, replaced in place, owner lines untouched) with `_workspace/`, `.claude/worktrees/`, `.agents/harness-skills-links.json` and each skill link; skills kept as owner copies stay tracked.
- Proposal: KEEP
- Source: kit:CHANGELOG.md:13; kit:README.md:50-52; kit@omp:CHANGELOG.md:138-145
- Why it exists: run outputs, task list and agent worktrees stay out of git (owner 2026-10-11); tested with CRLF and no final newline (kit@omp:CHANGELOG.md:138-145).
- Test idea: run install twice on a CRLF .gitignore without final newline: one block, no duplicates, owner lines kept.

### HIS-35 Explicit plugin enablement
- Behavior: `--enable-plugin` uses Claude Code's supported local-marketplace + project-scope plugin install; a second project reuses the `paseo-harness-kit` marketplace if the plugin files are identical, else stops without touching it; run under the intended `CLAUDE_CONFIG_DIR` (normally ~/.claude-circle); installed/enabled is not proof a running session reloaded it; project settings `env` cannot activate `CLAUDE_CODE_PLUGIN_DIRS`.
- Proposal: KEEP (install; the mod is the only plugin in scope; swarm panel see HIS-77)
- Source: kit:CHANGELOG.md:13,36; kit:README.md:66-78
- Why it exists: not stated.
- Test idea: install with the flag in two projects with identical plugin files: marketplace registered once.

### HIS-36 kit-init and ai-orchestrator skills
- Behavior: user-level `kit-init` (linked into the user's Claude skills folder) sets up git, kit install with the mod, `ph doctor` and a project-owned syntax-check hook, on request ("init project này", kit:README.md:64); `ai-orchestrator` derives a verifiable Definition of Done from the request before execution, verifies the integrated result against it and uses failed checks to guide corrections within the affected scope.
- Proposal: KEEP both (kit-init may need the GSD adapter step added).
- Source: kit:CHANGELOG.md:9,11; kit:README.md:56-64
- Why it exists: a brand-new project without the kit must see the skill (kit:README.md:58).
- Test idea: fresh dir: kit-init produces git repo, installed kit, passing `ph doctor`.

### HIS-37 omp variant: not carried
- Behavior: omp-io extension, tool-trim (wait tool off), context-guard.ts, circle-models.ts, SYSTEM_TEMPLATE.md, `.omp/` setup, providers `omp-kit`/`omp-agent`, bench, todo-off, Gemini web search through Circle, 9-model provider list - none are carried.
- Proposal: DROP (owner 2026-10-20: omp not carried; omp ineffective per 2026-10-12; memory notes are not deletion authorization of branches).
- Source: mem:omp-migration-policy.md:11-24; kit@omp:CHANGELOG.md:153-172; kit-git:106-114
- Why it exists: omp was an A/B harness; bench GPT-6 Luna 3 runs each: omp-io 11/12 correct 0.0279 USD, omp-native 10/12 0.0413, Claude Code 12/12 0.0468 (kit@omp:CHANGELOG.md:208-211).
- Test idea: grep of the new kit for `omp` finds only history.

### HIS-38 Lessons from the omp prompt review that apply to any base prompt
- Behavior: cleanup removes only what the agent created, never what the task or user created; a context-guard reminder is the exception to "never consider session limits"; waiting is not actionable work (end the turn); read all needed files in one batched call; new tests follow the project's AGENTS.md; tests that pin wording or implementation are flagged, deleted only with owner approval; unobserved claims are marked `[UNVERIFIED]`.
- Proposal: CHANGE (apply to the kit's AGENTS.md block / agent prompts; the SYSTEM_TEMPLATE itself is dropped). Prompt changes still go through the owner with evidence.
- Source: kit@omp:CHANGELOG.md:20-29; mem:omp-prompt-review-first.md:11-14; kit@omp:CHANGELOG.md:208-211
- Why it exists: three bench runs wrote files right then removed a line a task script had added; suspected cause the "remove scaffolds/throwaway scripts" line (kit@omp:CHANGELOG.md:208-211).
- Test idea: prompt lint: the cleanup rule says "created by the agent".

### HIS-39 Owner approves base-prompt changes
- Behavior: changes to the kit's base prompt text go through the owner: propose with evidence (bench run, session excerpt) and wait; experiments needing another prompt run in a throwaway copy.
- Proposal: KEEP as process rule for the kit's shipped prompt text (AGENTS.md block, skill prompts, agent prompts).
- Source: mem:omp-prompt-review-first.md:11-14
- Why it exists: the owner wants to see and decide every change to the base prompt. The two open prompt-review questions (whether ph agents verify their own slice; the lsp MUST line without a language server) belong to the dropped omp template and are moot (mem:omp-prompt-review-first.md:14).
- Test idea: n/a (process).

### HIS-40 Backlog.md dropped; state lives in .planning/
- Behavior: no "create a Backlog task for every piece of work" rule, no per-session ritual, no Backlog CLI/AGENTS block/backlog-plugin; new planned work keeps its state in `.planning/`. WildEra history: first Backlog became legacy-readable (2026-10-18), full retirement left for later; now decided (2026-10-20).
- Proposal: DROP (owner 2026-10-20: dropped entirely); drop the README Requirement "Backlog.md CLI" and the `backlog-plugin`.
- Source: wildera:_workspace/gsd-port/DESIGN.md:19-21,119-120; wildera:.agents/harness-history.md:43; kit:README.md:34,152; kit:CHANGELOG.md:56
- Why it exists: Backlog was redundant: a task per item would mean about 10k tasks and the harness already keeps the context (wildera:.agents/harness-history.md:43).
- Test idea: new kit install writes no Backlog config and no AGENTS.md Backlog block.

### HIS-41 Deferred findings leave no Backlog task
- Behavior: normal review findings are collected per task (`deferredFindings`) for a follow-up task; the Backlog destination no longer exists.
- Proposal: CHANGE (deferred findings go to `.planning/` e.g. a `deferred.md` per phase; WildEra's observed path is `_workspace/gsd/01-m1-p0/deferred.md`, wildera:.planning/STATE.md:49).
- Source: wildera:.agents/harness-history.md:40; wildera:.planning/STATE.md:49
- Why it exists: W3 re-reviews found 8-16 new normal findings every round and never converged (wildera:.agents/harness-history.md:40).
- Test idea: a run with normal findings writes `<phaseDir>/deferred.md`, not a task.

### HIS-42 GSD: keep ideas, change only the adapter; departures documented
- Behavior: where harness rules conflict with upstream, harness rules win and the departure is written to `NOTICE.md` + `references/compatibility.md`. Listed departures: per-task atomic commits -> wave commits + per-task evidence; executor-run verify -> a Verify stage mapped per obligation; per-executor worktrees -> shared tree + disjoint `owns`; TDD RED->GREEN unsupported; skeleton review gate + frozen wiring authority added; bounded code review instead of GSD's capability; gap closure capped at one wave; persistent coder sessions; no questions inside agents; research agent off by default (later re-added); centralized single-writer state; REQUIREMENTS = spec rule IDs; estimate/graphify/learnings/intel/capability framework not ported; verifier runs no tests.
- Proposal: CHANGE (core departures stay; Unreal-specific ones (spec rule IDs, `owns` forms) move to the adapter; owner 2026-10-20: GSD core ships in the kit).
- Source: wildera:_workspace/gsd-port/DESIGN.md:8-12,123-134; wildera:.agents/harness-history.md:43
- Why it exists: owner "keep GSD's ideas and change only the adapter" (wildera:_workspace/gsd-port/DESIGN.md:11-12).
- Test idea: `port check`-style integrity: departures file lists every adapter rewrite; vendored snapshot hash unchanged.

### HIS-43 Upstream pin and generation integrity
- Behavior: upstream open-gsd/gsd-core branch `next` commit 274f8cae13d03ad80e18959b135b0e51b33329e8 (2026-10-18, MIT) is vendored verbatim (never edited) with `UPSTREAM.json` (repo, branch, commit, date, file sha256); agents are generated with adapter front matter (name, description, model tier, tools, `include:`) plus a `<!-- GENERATED ... -->` line plus an upstream body changed by path rewrites only (wildera:_workspace/gsd-port/DESIGN.md:43-46); `check` fails on an edited snapshot, stale output, dangling direct references, unmapped `gsd_run` verbs; clone is untrusted: read/copy only, never run.
- Proposal: KEEP integrity checks; OPEN how the new kit vendors (gsd-upstream area).
- Source: wildera:_workspace/gsd-port/DESIGN.md:28-52; wildera:.agents/harness-history.md:43
- Why it exists: keep upstream recognizable and updatable; Astra critique "document every departure" (wildera:.agents/harness-history.md:43).
- Test idea: edit one byte of the snapshot: check exits non-zero.

### HIS-44 Lifecycle and chaining
- Behavior: every phase runs Discuss -> Research -> Plan -> plan review (skeleton review + checker) -> Execute -> Verify; one phase per priority, later phases planned after the earlier one is verified; one command chains plan -> execute only when planning passed (stops on unresolved owner decisions, exhausted checker revisions, open conflicts, human checkpoints); `--plan-only` stops after planning. Decimal phases may be inserted (Phase 1.1 "INSERTED").
- Proposal: KEEP
- Source: wildera:.planning/STATE.md:26-30,135; wildera:_workspace/gsd-port/DESIGN.md:8-10
- Why it exists: owner decisions 2026-10-18/19.
- Test idea: a plan with an open blocker never reaches execute; `--plan-only` leaves no execution run.

### HIS-45 Skeleton review gate
- Behavior: reviews outline + draft wiring contract together because "if the outline is right, the phase comes out right"; 1..N reviewer lanes (lens list configurable, e.g. fidelity, integration, runtime-feasibility, test-integrity); at most 3 cycles; stall when unresolved ids do not drop; REVISION_CONFLICT or an open conflict escalates to the owner - never "proceed anyway"; integration architect (wiring contract) stays its own step between Outline and review; outline re-parsed after revisions and a wiring contract written when a revision adds cross-plan calls.
- Proposal: KEEP (gsd-plan area)
- Source: wildera:_workspace/gsd-port/DESIGN.md:14-19,99-106; wildera:.agents/harness-history.md:43-44; wildera:.planning/STATE.md:162 (uncommitted working-tree text, not in pin 89143da, whose STATE.md ends at line 160)
- Why it exists: owner request; two independent Astra critiques shaped it; owner chose 4 Grok lanes for Phase 1.1: "Phase 1.1 skeleton review with 4 Grok lanes (fidelity, integration, runtime-feasibility, test-integrity)" (wildera:.planning/STATE.md:162, working tree only).
- Test idea: reviewer reports unresolved ids [a,b] twice -> stall -> needs-owner.

### HIS-46 Checker loop and force-proceed
- Behavior: plan-checker blocker + warning counted (unknown severity = blocker); INFO-only passes; max 3 iterations; stall when issue_count >= previous; REVISION_CONFLICT does not spend an iteration, third conflict escalates; at the cap the owner chooses (force proceed / guidance and retry / abandon). A force-proceed is recorded as an "Override" in STATE.md with the remaining issues and the reason.
- Proposal: KEEP
- Source: wildera:_workspace/gsd-port/DESIGN.md:159-163; wildera:.planning/STATE.md:42-45
- Why it exists: upstream behaviour kept; the Phase 01 override was delegated to the orchestrator (wildera:.planning/STATE.md:42-44).
- Test idea: three revision iterations with non-dropping issues end `needs-owner`.

### HIS-47 Input digests and revision hashes
- Behavior: `revisions.json` records sha256 of baseline commit, REQUIREMENTS, CONTEXT, outline, manifest, WIRING and each PLAN; approvals reference hashes; a changed input invalidates what depends on it (contract -> dependent plans; code -> verification); every GSD prompt carries input digests; resume never reuses an answer for other inputs; research joins the revision hashes; plans outside the approved outline move to `superseded/`.
- Proposal: KEEP
- Source: wildera:_workspace/gsd-port/DESIGN.md:84-88; wildera:.agents/harness-history.md:44-45
- Why it exists: GSD port code review (two Astra reviewers, both "not ready") (wildera:.agents/harness-history.md:44).
- Test idea: change CONTEXT.md after the outline: dependent plans are marked stale and replanned.

### HIS-48 Resume-safety rules for planning workflows
- Behavior: gap and verify attempt records written before the agent runs (resume continues an interrupted attempt; a finished one is marked done); invocation-scoped research attempts; terminal report marker; explicit research policy for every consumer; initial/in-progress Discuss checkpoint; gap-mode discussion gate; fail-closed outline and wiring regeneration until skeleton freeze; gsd-verify accepts only the report its own attempt wrote and rejects reports without a fingerprint or whose status contradicts their gaps/human lists; plans with no task or no automated obligation are invalid; serial atomic revisions; ROADMAP covered by every revision key; lane and limit validation.
- Proposal: KEEP (gsd-plan area)
- Source: wildera:.agents/harness-history.md:44-45
- Why it exists: seven resume/input-gate defects found in the Astra extension review, all resolved in a source-only check (wildera:.agents/harness-history.md:45).
- Test idea: kill the run mid-attempt: resume continues that attempt, not a new one.

### HIS-49 Planning-state ownership
- Behavior: ROADMAP.md and STATE.md are written only by the orchestrator (single writer); agents never commit; the workflow commits planning docs; plan SUMMARY path is granted in the plan's `owns`; STATE.md has YAML frontmatter (`gsd_state_version`, `status`, `progress{total_phases,completed_phases,total_plans,completed_plans,percent}`) then sections Project Reference, Current Position, Decisions (owner, dated), Models, Owner rules captured during execution, Overrides, Wave log, Session Continuity, resume instructions.
- Proposal: KEEP single-writer; CHANGE: fix the frontmatter progress (see Concerns).
- Source: wildera:_workspace/gsd-port/DESIGN.md:73,132; wildera:.planning/STATE.md:1-162; wildera:.agents/harness-history.md:44
- Why it exists: centralized state avoids concurrent writers (DESIGN.md:132).
- Test idea: STATE.md frontmatter counts equal the counts derived from plan/summary files.

### HIS-50 Plan review pass beyond skeleton + checker
- Behavior: the owner adds an extra full plan-review pass: finders (many lenses) -> per-plan verifiers -> judge -> cross-plan deduplication -> ONE editor revises all plans in one pass -> `verify.plan-structure` -> regenerate handoff. Phase 01 W5/W6: 72 finder jobs, 61 judged issues, 60 applied.
- Proposal: OPEN (gsd-plan: optional stage `plan_review_pass`; owner wording "Chất lượng đến từ việc thêm bước review kìa" (quality comes from the added review step)).
- Source: wildera:.planning/STATE.md:106,113,136
- Why it exists: owner conviction that review passes yield quality (wildera:.planning/STATE.md:136); plans written before W1-W4 reality had to be reconciled (:106).
- Test idea: pass produces a revision report and all plans still pass the structure check.

### HIS-51 Bounded review gate
- Behavior: Verify until green -> one review pass (each finding: trigger, likelihood + %, confidence 0-100, impact) -> high blocks only with a trigger, confidence >= 80 and likelihood above theoretical -> a `finding-verifier` agent (default the coder model) confirms/refutes/uncertain by tracing the trigger -> one fix pass (a test that drives the trigger where possible) -> Verify -> resolution check of those findings only, no new findings -> unresolved escalate. A high with no verifier verdict is `unverified` (still blocking, never `confirmed`), retried once, then escalated, never sent to the fixer. Only high findings block; normal findings are deferred. ("Re-review checks only the files the fixer touched", wildera:.agents/harness-history.md:40, belonged to the old review/fix/re-review loop that this gate replaced; the gate's own check is "those findings only, no new findings", :42.) `review-metrics` records each run (`_workspace/review-metrics.jsonl`) with confirmed/refuted/resolved/unverified rates and the later fate of deferred findings.
- Proposal: KEEP (method/workflow); the model names in rows are not kit defaults.
- Source: wildera:.agents/harness-history.md:40,42-44; wildera:_workspace/gsd-port/DESIGN.md:117-118,177
- Why it exists: reviewers are wrong too and rounds kept producing new findings; two reviewers rated the same bug high and normal; the trigger field made a new high checkable in minutes. Modelled on Anthropic /code-review (confidence >= 80, no auto-fix loop), Cursor Bugbot, Codex review (wildera:.agents/harness-history.md:42).
- Test idea: reviewer high without trigger -> demoted; verifier silent -> status `unverified` and blocks.

### HIS-52 Superseded review loop rules
- Behavior: default maxFixRounds 4 with early stop after 2 stalled reviews (2026-10-16); re-review prompt that gives the fixer's report to the re-reviewer (2026-10-16); both replaced by HIS-51 on 2026-10-17.
- Proposal: DROP (superseded)
- Source: wildera:.agents/harness-history.md:19,22,42
- Why it exists: one fix round left half the tasks open; loops never converged.
- Test idea: none (ensure no `maxFixRounds` key in the new config).

### HIS-53 Code -> Verify -> Review order
- Behavior: Code -> Verify (build must succeed) -> Review -> Fix -> Verify -> resolution check; nothing is reviewed before the integrated build succeeds; a task is reviewed only when it builds and none of its own failures remain (blocked-by-others tasks are reviewed; non-converging ones go with failures attached). Verify = one build + full suite + task scenarios; failures are attributed per task and fed to each coder session; bounds `maxVerifyRounds` 4 and stall. One Verify round cost about 2 min in Unreal.
- Proposal: KEEP order; the build/test command is adapter-owned.
- Source: wildera:.agents/harness-history.md:23,25,34
- Why it exists: owner "review only built code"; coders not seeing build/test results was the bottleneck: a W3 static wave on 26 failing tests left 17 (wildera:.agents/harness-history.md:23).
- Test idea: failing build -> zero reviewer calls.

### HIS-54 Who builds and tests: coders or the Verify stage
- Behavior: Oct 18: coders never build, test or commit; one Verify build per wave; orchestrator commits once per wave. Oct 19-20: free fix agents build/test/scenario themselves until green and hand off once (owner: no orchestrator round-trips); one Opus fixes all failures of an integration point and builds/tests once; parallel cluster fixers rejected; fixer runs scenarios at 30 FPS only, 240 FPS / 32:9 once in the orchestrator's final pass.
- Proposal: CONFLICT (DESIGN.md:13 vs STATE.md:119,129-132) -> make it an adapter setting `fixer_verifies_itself`; default per owner's latest = fix agents self-verify, wave Verify remains.
- Source: wildera:_workspace/gsd-port/DESIGN.md:13; wildera:.planning/STATE.md:119,124,129,132
- Why it exists: round-trips through the orchestrator cost time; parallel fixers in one tree collide (wildera:.planning/STATE.md:129,151).
- Test idea: adapter flag toggles whether coder prompts permit build commands.

### HIS-55 Root-cause rule: fix the product, not the fixture
- Behavior: a failing runtime check is fixed in the product; a fixture/oracle change needs a spec line; fixture hacks stay open findings; FPS-only failures are product bugs; the orchestrator vets any "pass" that came from a fixture change; reviewers treat fixture-only passes as Normal findings; a corrected test that exposes a product bug stays red and is never weakened; do not lower test expectations.
- Proposal: KEEP (method; core agent prompts)
- Source: wildera:.agents/harness-history.md:17,47; wildera:.planning/STATE.md:82,94
- Why it exists: fg2-w02 integration took ~8.5 h and 6 debugger replacements; debuggers made combat/interaction/feeding pass by raising a target 80 cm, widening a sphere to 4 m and re-pressing until a probe passed (the real bug was an FPS-dependent hold cancel) (wildera:.agents/harness-history.md:17); Phase 01 feeding-drink: MeadowPool 100 cm above ground (:47).
- Test idea: a review fixture where the diff only widens a tolerance in a test is flagged Normal.

### HIS-56 gsd-debug: ported, then stopped by the owner
- Behavior: 2026-10-19 `gsd-debug` (generated `gsd-debugger`; workflow `gsd-debug.js`; `tools/gsd/debug.mjs`: tree digest, session/registry/state, replay-safe typed engine requests with process-tree kill, budgets, detached deadline supervisor, snapshot outside the worktree with delta revert/reapply, acceptance/close, machine-wide lease with writer quiescence, reconcile) and `gsd-forensics` (main session) were added; code-wave run-level failure signatures, integration signatures to `needsDebug`, admission refused under a debug lease. 2026-10-19/20 the owner stopped the gsd-debug flow (lease released), had direct Astra/Opus writers fix instead, and set "No code-wave Verify loops, no gsd-debug" for the combined verify.
- Proposal: OPEN (gsd-debug area; owner decides whether the supervised debug engine ships or only forensics + a plain debug agent).
- Source: wildera:.agents/harness-history.md:47; wildera:.planning/STATE.md:60-68,124,131
- Why it exists: feeding-drink step 30 failed ~9 times; the hand-written debugger kept no log, verifyLoop bounds reset after the review fix, Step 3.6 allowed an unbounded debugger (wildera:.agents/harness-history.md:47). Why the owner stopped it: not stated (STATE.md:68 only "Owner override").
- Test idea: n/a until decided.

### HIS-57 Debug-engine lessons that survive any design
- Behavior: revert targets durable before any write; transactional revert/reapply with per-path conflict guard; deadline with live workers keeps the lease; supervisor finalizes a dead runner only after its workers are gone; acceptance is a digest-bound transaction reusable after an interrupted close; obligation "red" only on a fresh complete run over all its filters; a test filter that ran nothing is not a pass; restored files get a later mtime because git's whole-second stat cache missed a same-size restore.
- Proposal: KEEP as lessons for gsd-debug if kept.
- Source: wildera:.agents/harness-history.md:47
- Why it exists: Astra code review (14 findings), then 7 resolved/7 partly/3 new, then 3 partly + 2 new; scratch-repo rerun found the stat-cache miss (wildera:.agents/harness-history.md:47).
- Test idea: restore a same-size file within one second: git sees it modified.

### HIS-58 Cross-owner contract requests routed inside Verify
- Behavior: `contractRequests` whose owner is another wave task go to that task's coder in the next fix round; routed inside each Verify iteration, including producers with no direct runtime failure; inbox kept on a failed fix turn; reverify after producer changes before review; `args.grants` adds `owns` after Code (cache-safe) for a contract no wave task owns; plans carry `owns` and `files_modified` must fall inside it; a plan SUMMARY path is granted.
- Proposal: KEEP (workflow/gsd-plan)
- Source: wildera:.agents/harness-history.md:31,36,44
- Why it exists: consumers repeatedly returned blocked because requests were delivered only after the outer review (:36); requests sat in results and tasks stayed partial (:31).
- Test idea: consumer requests a symbol from a sibling task: the producer gets it in the same Verify iteration.

### HIS-59 Failure attribution in Verify
- Behavior: failures are attributed per task by file, test name, assertion file, callstack frame and log category; build errors in files no task owns go to one integration fixer (`coder:integration`) that owns exactly those files with the smallest compiling change; errors attributed through compiler `note:` files; warning-only categories excluded; unfinished tests and unexecuted gate scenarios reported explicitly; error/assertion lines come before warning context in bounded excerpts (complete logs attached); a failure raised in another task's class goes to that task and the scenario's own task is `blockedBy`; gate scenarios (e.g. entry-movement) run first and while one fails no other scenario runs.
- Proposal: CHANGE (generic parts - unassigned goes to an integration fixer, gates first, blockedBy, error-before-warning excerpts - stay in core; the Unreal log/class parsing is the adapter's `verify` command).
- Source: wildera:.agents/harness-history.md:26,28,30,32,33,35,37
- Why it exists: integ4: one missing `Super::OnWorldBeginPlay` failed 19 scenarios of 8 tasks (:28); character creation failure made 8 tasks chase one cause (:32); a struct redefinition in a shared header was unassigned (:26); text-style warnings hid the real error (:37).
- Test idea: 19 scenario failures with one root cause yield one fix call, others `blockedBy`.

### HIS-60 Contract-wave stubs, integration architect, task sizing
- Behavior: cross-capability wiring is planned by one integration-architect agent (pro, high effort) between the contract and implement waves so parallel coders code against one set of signatures; task-size balance rule; per-task coder `effort` override; `owns` accepts `Path:<repo path>`; tracer plan runs alone as execution wave 1 and must be green before expansion; `kind: diagnostic` tasks with a bounded `editorRuns` budget and content-restore rules (the row names the rules but not their text; wildera:.agents/harness-history.md:15 item 5). Stub rules (engine `unimplemented()`, never define a function named `unimplemented`, minimal real bodies for engine-called functions, no shadowing parameters) are Unreal specific.
- Proposal: KEEP architect + tracer + sizing in core; DROP the stub rules from the core (adapter/ue-code only).
- Source: wildera:.agents/harness-history.md:12-15,43-44
- Why it exists: w05 14 tasks, 12 passed first review after the architect; w02 self-defined `unimplemented` collided with the engine macro (94 errors) (:12); w04 integration found 15 unexported symbols and a double world init crash (:13).
- Test idea: two parallel plans consuming one symbol see the same wiring signature.

### HIS-61 Solution-quality envelope
- Behavior: the project defines a configuration envelope from its specs (the game: 30 Hz simulation, 30-240 FPS and Unlimited, 1280x720-4K, 16:9-32:9, KBM/gamepad, network limits, T2 hardware); coders choose among alternatives for the whole envelope and sweep its boundaries in tests; reviewers treat one-sample-point fixes, presentation that steps with the simulation, and spec-drifted config as Normal findings; briefs name the envelope axes; the orchestrator checks shared config against the specs before dispatch.
- Proposal: CHANGE (generic rule "judge a fix against the declared envelope, not one sample point" in core; the envelope content is the project adapter).
- Source: wildera:.agents/harness-history.md:16
- Why it exists: the TASK-5 camera fix was judged at 144 FPS over a 60 Hz tick; the project also ran Mover at 60 Hz against the approved 30 Hz.
- Test idea: adapter without an envelope: the rule is skipped; with one, briefs list its axes.

### HIS-62 Machine-wide exclusive lock for heavy tools
- Behavior: one build/test/scenario at a time across worktrees via a named machine mutex (`Global\WildEraUE`), not by rule only; related: orphaned process cleanup after a dead parent; GPU state check (nvidia-smi P0) before heavy runs.
- Proposal: CHANGE (adapter-provided lock name; core offers the mutex helper or documents it).
- Source: wildera:.agents/harness-history.md:24; wildera:.planning/STATE.md:108,124,149
- Why it exists: parallel worktrees ran engine tasks concurrently; a stuck GPU (P5) slowed runs (wildera:.planning/STATE.md:108).
- Test idea: two concurrent heavy commands serialize.

### HIS-63 Cheap-first tooling: scenarios in warm batches, shared oracle library, owns-from-symbols
- Behavior: approved harness pass after Phase 01: scenario matrix in warm batches (`-Scenarios a,b,c -KeepAlive`); a shared tested scenario-step library for timing-sensitive reads; a gsd-plan check that greps tests/fixtures using every changed symbol and adds them to the changing task's `owns`; tests in a real world, gameplay scenarios from a Dev-only server-authoritative test entry (no faked gameplay results); full UI entry path e2e only in few main-flow scenarios; Phase 1.1 "Test harness" with HAR-01..07.
- Proposal: CHANGE (the gsd-plan symbol-to-owns check is a core candidate; the rest is WildEra project work).
- Source: wildera:.planning/STATE.md:133-135,139,141
- Why it exists: each scenario run was a cold boot; oracles hand-rolled timing; tests using a changed symbol were missed by ownership (wildera:.planning/STATE.md:133).
- Test idea: plan that changes a symbol used by a test file not in `owns` is flagged.

### HIS-64 Requirements and platform limits
- Behavior: Node.js 20.17+ with `path.matchesGlob` (Node 24 LTS used for bundled TypeScript fixture tests; developed on Node 24 and Windows 11); Claude Code 2.1.296 or later for the direct file mod; Paseo CLI and a running daemon for `ph` agent operations; Git for worktree isolation. macOS/Linux code paths exist but are not verified on real machines. Dropped requirements: Backlog.md CLI, official filesystem MCP package (non-Claude adapter), Pi/Codex/OpenCode.
- Proposal: KEEP the first four (re-verify the numbers for the rewrite); DROP the others.
- Source: kit:README.md:29-38
- Why it exists: not stated; 0.0.1 verified Claude Code, Codex and OpenCode agents, Pi untested (kit:CHANGELOG.md:53-54).
- Test idea: `ph doctor` fails with a clear message on Node < 20.17 and Claude Code < 2.1.296.

### HIS-65 Tests are offline fixtures
- Behavior: offline fixtures cover configuration, migration/ownership, reminders, workflow admission, filesystem/backend operations and mod contracts; they establish contracts and regressions, not paid end-to-end behaviour; no live owner project or daemon configuration is changed by source tests. Test counts are recorded in change rows ("Kit tests 85/85", "Runtime regression tests 23/23").
- Proposal: KEEP
- Source: kit:CHANGELOG.md:38; kit:README.md:154-167; wildera:.agents/harness-history.md:9,18,20
- Why it exists: not stated.
- Test idea: CI runs the suite without daemon or network.

### HIS-66 Change-history file convention
- Behavior: `.agents/harness-history.md` is a per-project table `Date | Change | Scope | Reason`, one row per change, newest last; Scope lists repo-relative paths; Reason says why the change was made, not what it is; CLAUDE.md does not import it; only `harness` and `harness-evolve` read it when auditing or evolving the harness. Observed use: WildEra 39 data rows (file lines 9-47; file length 47) dated 2026-10-14..19; WildEraV6-dino copy has the same first 34 rows (:9-42) and nothing newer; kit-test-project has the header only; god-vibe-code has no file. kit-test-project's header names `.claude/skills/harness/` while WildEra's names `.agents/skills/harness/` (layout drift).
- Proposal: CHANGE (keep the table and the reason-first rule; decide whether it stays a separate file or merges with `.planning/` records) - see open questions.
- Source: wildera:.agents/harness-history.md:3-7; dino:.agents/harness-history.md:3-42; ktp:.agents/harness-history.md:3-9
- Why it exists: a reader auditing the harness needs the incident behind each rule (the rows' Reason column).
- Test idea: new-kit schema check: every row has a non-empty Reason that is not a restatement of Change.

### HIS-67 Changelog conventions
- Behavior: kit CHANGELOG entries are dated, name the owner decision with its date, name the cause and the measured check ("Checked: unit tests 45; ..."), and keep an "Unreleased" section until the next version; every regression fix names a regression test in quotes.
- Proposal: KEEP
- Source: kit:CHANGELOG.md:3-5; kit@omp:CHANGELOG.md:91-100
- Why it exists: not stated.
- Test idea: release check: CHANGELOG top section matches `kit.json` version.

### HIS-68 Language rule
- Behavior: the owner talks to agents in Vietnamese; every generated harness file is English ("harness principle 6"); EFFECTIVENESS.md at phase close is written in Vietnamese with lessons and the owner's human-verify list.
- Proposal: KEEP (deliverables for the owner in the owner's language, harness files in English).
- Source: wildera:_workspace/gsd-port/DESIGN.md:3-4; wildera:.planning/STATE.md:131
- Why it exists: owner preference.
- Test idea: n/a (convention).

### HIS-69 Owner wording and decisions are recorded verbatim and dated
- Behavior: STATE.md keeps a dated "Decisions (owner)" list, "Owner rules captured during execution" with the owner's quoted words (Vietnamese) and the derived rule, "Overrides (orchestrator, owner-delegated)" with what was overridden and why. Delegated decisions are marked as such (8 owner decisions delegated to the orchestrator).
- Proposal: KEEP
- Source: wildera:.planning/STATE.md:26-45,133-142,144,154
- Why it exists: a compacted or restarted orchestrator must recover owner intent exactly (wildera:.planning/STATE.md:108-109).
- Test idea: after context loss, the orchestrator resumes from STATE.md alone without re-asking a decided question.

### HIS-70 Session continuity and restart recovery
- Behavior: STATE.md carries "Stopped at", "Resume file", a RESUME AFTER MACHINE RESTART block (agents archived, what is uncommitted, ordered open items, working rules learned), and dated pre-compact state blocks; recovery after restart relies on persisted state, not on live agents (HIS-16).
- Proposal: KEEP; CHANGE: write one replaced "current state" block, not an ever-growing log (see Concerns).
- Source: wildera:.planning/STATE.md:53-66,108-119,121-126,147-154
- Why it exists: the PC was restarted after agents finished (GPU stuck in P5), all agents archived (wildera:.planning/STATE.md:108).
- Test idea: kill all agents; a fresh orchestrator reads STATE.md and names the next action.

### HIS-71 Merge before phase close is an owner override
- Behavior: owner chose to merge the phase branch (`fg2-w3`) into master right after the fixer, before goal-backward verify, the 240 FPS / 32:9 confirmation, EFFECTIVENESS.md and the gap fix; those run afterward on master. Phase 01 was merged "not closed" with open items listed.
- Proposal: OPEN (the core lifecycle verifies before closing; merge-first is a recorded owner exception, not a default).
- Source: wildera:.planning/STATE.md:131,153,156-160
- Why it exists: owner "Thôi mợt main đi, làm 1.1" (wildera:.planning/STATE.md:156); the file also quotes "Mợt vào master luôn, tao check sau" (:131).
- Test idea: the lifecycle allows a recorded `merge_before_verify` override and lists the skipped steps.

### HIS-72 Shared tree vs worktree execution
- Behavior: parallel coders share one tree with disjoint `owns`; execution may run in a separate git worktree (`WildEraV6-w3`) when the main checkout's backend setup refuses (input_acl_unsafe from sandbox ACEs; ACLs are not changed); worktree-aware checks (HIS-04) keep tools aimed at the right tree; the main checkout's binaries go stale after a merge until the next build.
- Proposal: KEEP (worktree support), adapter for engine details.
- Source: wildera:.planning/STATE.md:45,157; wildera:_workspace/gsd-port/DESIGN.md:127-128
- Why it exists: GSD forces mutating concurrency 1 without isolation; this harness relies on contract waves, ownership_check and the integration build (DESIGN.md:127-128).
- Test idea: ownership check fails when two plans in a wave own the same path.

### HIS-73 Fast mode through Circle
- Behavior: owner asked for Claude fast mode on agents; a probe with Claude Code `--settings fastMode:true` through Circle stayed `speed=standard` (Claude Code enables fast mode only on the direct Anthropic API); no Paseo flag found; proceed without, enable later if a Paseo switch is found.
- Proposal: OPEN (decided by whether Paseo/Circle gains a switch; do not add a kit workaround, HIS-27).
- Source: wildera:.planning/STATE.md:161 (uncommitted working-tree text, not in pin 89143da; wording: "Owner: proceed without; enable later if a Paseo switch is found.")
- Why it exists: owner request 2026-10-20 13:09.
- Test idea: n/a.

### HIS-74 Model policy history (CONFLICT across sources)
- Behavior: 2026-10-17 non-fast Sol for subagents, Grok independent reviewers, Astra reserved for main, allowlist blocks Astra/fast/Opus (wildera:.agents/harness-history.md:38); 2026-10-18 reviewer default `circle/gpt-6.1-sol-fast[1m]` (DESIGN.md:18); 2026-10-19 planners/architect/researcher Sol, plan review Sonnet, coders Haiku (STATE.md:32); Phase 2 outline Astra, planners Haiku (STATE.md:36); 2026-10-20 Astra and Sol out of quota -> Sonnet execution, Grok review, Opus verify fixers (STATE.md:126); then "all former-Sonnet roles now Opus, reviewers stay Grok" (STATE.md:140); Grok quota exhausted -> Haiku for light side work (STATE.md:119); Opus allowed again (STATE.md:106). Phase 1.1: outline/planners/research Opus `circle-agent/claude-opus-5-5[1m]`, skeleton review + checker Grok `circle-agent/grok-4.7[1m]`.
- Proposal: CONFLICT -> no model is a kit default; roles (`research`, `outline`, `planner`, `checker`, `skeleton_lane`, `coder`, `reviewer`, `verifier`, `fixer`) are adapter config keys with fallback tiers.
- Source: wildera:.agents/harness-history.md:38; wildera:_workspace/gsd-port/DESIGN.md:18; wildera:.planning/STATE.md:32,36,106,119,126,140 (the 4-Grok-lane / skeleton-review model line is :162, working tree only, not in pin 89143da)
- Why it exists: the owner assigns models by remaining quota and cost.
- Test idea: removing a model from the adapter falls back to a tier, never to a hardcoded id.

### HIS-75 Provider/account facts the rewrite depends on
- Behavior: Paseo provider `circle` (main session) and `circle-agent` (workers) route non-Anthropic models through Claude Code, e.g. `circle/gpt-6.1-sol[1m]`, `circle/claude-sonnet-5-5[1m]`, `circle/claude-haiku-5-5`, `circle/gpt-6-astra[1m]`, `circle-agent/claude-opus-5-5[1m]`, `circle-agent/grok-4.7[1m]`; the `[1m]` suffix selects the 1M context; `CLAUDE_CONFIG_DIR` for Circle is normally `~/.claude-circle`.
- Proposal: KEEP as documentation of the provider contract; ids are examples, not defaults.
- Source: wildera:.planning/STATE.md:32,36,135,162; mem:test-model-luna-fast.md:8; kit:README.md:74-75
- Why it exists: not stated.
- Test idea: `ph doctor` resolves each configured model id against the provider catalog.

### HIS-76 Machine-level (kit `machine.mjs`) behaviour
- Behavior: `check|apply|export` is the machine setup; `apply` is an explicit machine operation, never run implicitly or against the owner's live daemon from source work; preserves owner server registrations; only inspected kit-owned legacy registrations may be retired; similarly named owner servers are preserved; Paseo plugin settings and enabling trusted global plugins are explicit actions.
- Proposal: KEEP (install area); CHANGE: drop MCP registration logic and Codex/OpenCode notes.
- Source: kit:README.md:146-152; kit:CHANGELOG.md:36
- Why it exists: not stated beyond ownership safety.
- Test idea: `check` on a machine with a similarly named owner server reports and does not remove it.

### HIS-77 Swarm plugin and panels
- Behavior: the backlog/swarm panels remain Paseo plugins; swarm file tracking recognizes batch ranges and batch write/edit input shapes.
- Proposal: OPEN (ui area): backlog panel DROP (Backlog dropped); swarm plugin keep or drop - needs owner/ui decision.
- Source: kit:README.md:152; kit:CHANGELOG.md:37,56
- Why it exists: not stated.
- Test idea: swarm tracking recognizes a `write_multiple_files` input.

### HIS-78 Project-specific lessons that must not enter the core
- Behavior: Unreal rules (WILDERAPURE_API exports, unity-build lint, CreateWorld fixtures, UBT -SingleFile handoff, drinking-while-swimming and hold rules, input-focus rules, attack phase-boundary presentation, 250 ms R3 intent-age gate scope, contact-audio policies) belong to WildEra's adapter and specs.
- Proposal: DROP from the kit (project adapter content)
- Source: wildera:.agents/harness-history.md:11-16,21; wildera:.planning/STATE.md:40,137-138,142,144,154
- Why it exists: they describe the game, not the harness.
- Test idea: grep of the new kit core for `WildEra`/`UE`/`Unreal` finds nothing outside examples.

### HIS-79 Debug handoff from code-wave: two-tier needsDebug and bounded loops
- Behavior: code-wave records run-level failure signatures; integration signatures go to `needsDebug` at once; localized signatures only after one coder round; admission is refused while a debug lease is held; one corrected root-cause rule is shared by fixers, the resolution check, the reviewer and the debugger (HIS-55); Step 3.6 is rewritten and `references/debugger-prompt.md` retired. Signatures are cleared only by a passed rerun; reruns are typed, or the failure is marked `debuggable: false`. A debug handoff must not reset the Verify loop's bounds (the row names the reset after the review fix as a cause of the unbounded run) and the debugger itself must be bounded (budgets).
- Proposal: OPEN with HIS-56 (applies only if gsd-debug ships; then KEEP all of it).
- Source: wildera:.agents/harness-history.md:47
- Why it exists: Phase 01 wave 3 `feeding-drink` step 30 failed about nine times in a row; "the verifyLoop bounds reset after the review fix, Step 3.6 allowed an unbounded debugger" (wildera:.agents/harness-history.md:47).
- Test idea: a localized failure after round 1 goes to debug, an integration signature goes at once; after a review fix the round counter is not zero; a signature stays until a passed typed rerun.

### HIS-80 Debug engine: durable log, running record, writer detection, lease release
- Behavior: a replacement debugger inherits a durable debugger log (introduced 2026-10-16; the hand-written debugger of the 2026-10-19 incident kept none); the engine runs in a detached wrapper that writes a durable running record; a writer is detected from the `script` field of run.json; the lease is always released (guaranteed release); the supervisor finalizes a dead runner only after its workers are gone; a deadline with live workers keeps the lease; the machine-wide lease waits for writer quiescence.
- Proposal: OPEN with HIS-56 (KEEP if the engine ships).
- Source: wildera:.agents/harness-history.md:17,47
- Why it exists: fg2-w02 integration took ~8.5 h and 6 debugger replacements, each losing context (wildera:.agents/harness-history.md:17); Astra code review of batch 1, 14 findings (:47).
- Test idea: kill the runner mid-run: the running record survives, the supervisor waits for workers, then releases the lease exactly once.

### HIS-81 Debug engine: revert, red and provenance contracts
- Behavior: revert targets are stored durably before any write; revert/reapply is transactional with a per-path conflict guard; acceptance is a digest-bound transaction reused after an interrupted close; revert-red is signature-specific (the row gives no more detail); obligation red counts only on a fresh complete run over all its filters; a test filter that ran nothing is not a pass; build provenance is recorded per target; coverage is merged on reuse; the deadline is bound to the invocation; every crash-reason line is matched; restored files get a later mtime (HIS-57).
- Proposal: OPEN with HIS-56 (KEEP if the engine ships).
- Source: wildera:.agents/harness-history.md:47
- Why it exists: second Astra check (3 partly + 2 new): obligation red credited without a complete run, recovery blocked by a crash before target hashes were stored (wildera:.agents/harness-history.md:47).
- Test idea: crash between target hashing and the first write: recovery still reverts; a red credited by a partial run is refused.

### HIS-82 Debug engine and Verify validators; scratch-repo checks
- Behavior: Verify has scenario and automation validators (the row names them without detail; HIS-81 states the related rule that a filter that ran nothing is not a pass); the engine CLI was checked on a scratch git repo: snapshot/delta/revert/reapply, typed request refusal, a 6 s run-cap kill, replay, reopen, reconcile baseline/check; the snapshot lives outside the worktree; engine requests are typed and run with a process-tree kill.
- Proposal: OPEN with HIS-56 (validators KEEP in core Verify either way).
- Source: wildera:.agents/harness-history.md:47
- Why it exists: stated in the same row (14-finding review, then two resolution checks); nothing more on validators.
- Test idea: a Verify run in which a requested scenario executed zero steps does not pass; an untyped engine request is refused.

### HIS-83 Task result schema split keeps non-GSD cache hits
- Behavior: code-wave tasks may carry `plan` and `summary`; `taskResults` and `deviations` live in a separate result schema so cached calls from non-GSD runs still match; a verifier verdict missing becomes `unverified` (HIS-51).
- Proposal: KEEP the principle (adding GSD fields must not invalidate cached non-GSD calls); workflow area.
- Source: wildera:.agents/harness-history.md:43; wildera:_workspace/gsd-port/DESIGN.md:113-118
- Why it exists: workflow cache keys include the schema; a shared schema would have invalidated non-GSD runs (wildera:.agents/harness-history.md:43 states the separation, not the cache mechanism).
- Test idea: a pre-GSD cached call still hits after the GSD fields exist.

### HIS-84 Every GSD verify obligation is checked each Verify round
- Behavior: code-wave checks every verify obligation of a GSD plan each Verify round: `test:` filters must match executed tests; `cmd:` entries are run; probe blockers count as failures in code; plans with no task or no automated obligation are invalid.
- Proposal: KEEP (gsd-plan/workflow); the vocabulary (`test`, `scenario`, `build`, `cmd`) is adapter data.
- Source: wildera:.agents/harness-history.md:44; wildera:_workspace/gsd-port/DESIGN.md:76-79
- Why it exists: GSD port code review, two Astra reviewers, "not ready", 13 and 14 findings (wildera:.agents/harness-history.md:44).
- Test idea: a plan whose `test:` filter matches nothing fails Verify.

### HIS-85 Shared files are owned by path rule, never by a plan
- Behavior: files shared across plans (including plugin Config and a new Build.cs) are classified by a path rule and are never listed in a plan's `owns`; an integrator task (Z) applies each wave's shared changes; the outline check requires owners disjoint per wave and inside the layout, shared files never owned.
- Proposal: KEEP (gsd-plan; path rules are adapter data)
- Source: wildera:.agents/harness-history.md:44; wildera:_workspace/gsd-port/DESIGN.md:95-98; wildera:.planning/STATE.md:44
- Why it exists: part of the 13/14-finding port review; Phase 01 scenario registration became an integrator (Z) shared change (wildera:.planning/STATE.md:44).
- Test idea: a plan that lists a shared file in `owns` fails the outline check.

### HIS-86 Departures documented beyond the first list; research workflow shape
- Behavior: `references/compatibility.md` also records provider/cache departures and unported advanced-mode departures; the research skill runs a research-only workflow with view/reuse/refresh, blocked routing and report readback, using the generated upstream phase researcher and its exact capability dispatch fragment; discuss uses a generated copy of the pinned discuss-phase workflow in interactive text mode with prior-decision and code scout, context/log/checkpoints.
- Proposal: KEEP (gsd-plan, gsd-upstream); extends HIS-42.
- Source: wildera:.agents/harness-history.md:45
- Why it exists: owner asked for two skills taken from GSD itself, not a newly designed replacement.
- Test idea: compatibility.md lists every departure the port-integrity check cannot derive.

### HIS-87 Deferred GSD scope and reversals
- Behavior: on 2026-10-18 the owner deferred quick-batch (still not ported), full Backlog retirement (done 2026-10-20) and a separate researcher agent (reversed 2026-10-19: `gsd-research` and `gsd-phase-researcher` were added).
- Proposal: OPEN for quick-batch (gsd-plan: ship or leave out); the others are settled.
- Source: wildera:_workspace/gsd-port/DESIGN.md:14; wildera:.agents/harness-history.md:45
- Why it exists: owner decision 2026-10-18, revised 2026-10-19.
- Test idea: n/a.

### HIS-88 Never edit the kit's marked AGENTS.md block
- Behavior: AGENTS.md carries a `PASEO-HARNESS-KIT` marked block owned by the kit; project changes (planning-state note, invocation entry) go outside it; the GSD port replaced WildEra's Backlog block with a "Planning state" note and added the gsd-plan invocation to the Harness section.
- Proposal: KEEP (install)
- Source: wildera:_workspace/gsd-port/DESIGN.md:119-120; wildera:.agents/harness-history.md:43
- Why it exists: update would overwrite owner edits inside the block (not stated explicitly; the rule is the design instruction).
- Test idea: update rewrites only the marked block and leaves the rest of AGENTS.md.

### HIS-89 Fan-out admission is a rolling pool, not barriers
- Behavior: bounded fan-out (e.g. 20 concurrent) keeps the pool full as jobs finish; it must not run N-job batches that wait for the slowest job. Later stages (consolidation, verification) use the same rolling scheduling with the same maximum concurrency. Owner area: workflow.
- Proposal: KEEP
- Source: wildera:.planning/STATE.md:74; wildera:.planning/STATE.md:106
- Why it exists: "Audit scheduler corrected per owner: 20 concurrent rolling workers, not 20-job barriers."; the plan-review run used "max 19 concurrent rolling" (wildera:.planning/STATE.md:106).
- Test idea: 40 jobs of unequal duration with cap 20: at no time are fewer than 20 running until fewer than 20 remain.

### HIS-90 Model lists are replaced to match the template, never only appended
- Behavior: when a provider's `models` list changes in the template, sync replaces the stored list; it must not only add entries (stale ids such as old `anthropic/` ones stayed).
- Proposal: KEEP (install `machine.mjs`/provider sync, survives the omp DROP)
- Source: kit@omp:CHANGELOG.md:70-71
- Why it exists: models "were only ever added, which would have left the old `anthropic/` ids" (kit@omp:CHANGELOG.md:70-71).
- Test idea: template removes a model: `apply` removes it from the provider and keeps owner-added providers.

### HIS-91 Batch failure messages must not promise a clean rollback
- Behavior: a batch write/edit failure text and tool descriptions must not say "nothing was written" unless the tool rolled back; the native edit checks all sections first but writes files in order, so a later system write error can leave earlier files written. Only an `atomic`/transactional path with real rollback may claim all-or-nothing.
- Proposal: KEEP (files area; README:92 "staged multi-file writes and rollback diagnostics")
- Source: kit@omp:CHANGELOG.md:121-124; kit:README.md:92
- Why it exists: found in the fourth omp-io review round.
- Test idea: inject a write error on file 2 of 3: the result lists file 1 as written.

### HIS-92 Phase outline size cap
- Behavior: a phase outline is coarse: about 15-20 plans and at most 4 waves, scope unchanged, unless the owner raises the cap (CONTEXT D-16); gsd-plan granularity `coarse` (Phase 01 had used `fine`); the integration lens carries D-16; a 85-plan/8-wave outline was stopped at Plan (4 plans written) and backed up.
- Proposal: KEEP as an adapter/plan-args default and a skeleton-review check (gsd-plan)
- Source: wildera:.planning/STATE.md:163 (uncommitted working-tree text, not in pin 89143da, which ends at line 160)
- Why it exists: owner on the 85-plan outline: "overthinking, có tý code mà" (wildera:.planning/STATE.md:163).
- Test idea: an outline with 30 plans or 6 waves is flagged by the integration lens unless the cap is raised.

## Invariants and lessons
1. Never time a tool call from its block start; start the clock when the input is complete (kit:CHANGELOG.md:5). Never let a late "running" event open a call that already finished (wildera:.agents/harness-history.md:14).
2. Resume must never reuse an answer or session for other inputs: digests/hashes in every planning prompt, readback of the actual model, fresh agent with the full prompt when the daemon forgot the session (wildera:.agents/harness-history.md:38-39,44).
3. A batch tool's per-item failure must not fail siblings, and a resent applied edit is skipped (kit:CHANGELOG.md:21; kit@omp:CHANGELOG.md:81-86).
4. Bound every loop with a count and a stall rule and name the escalation (skeleton <= 3, checker <= 3, verify rounds 4, provider retries 5); never "proceed anyway" on an open blocker (wildera:_workspace/gsd-port/DESIGN.md:14-17,159-163; wildera:.agents/harness-history.md:20,23).
5. Review only built code; high findings block only with trigger + confidence >= 80; an unverified high still blocks (wildera:.agents/harness-history.md:25,42-43).
6. Fix the product, not the fixture; a corrected test that exposes a product bug stays red (wildera:.agents/harness-history.md:17; wildera:.planning/STATE.md:82).
7. One orchestration path: main session uses Paseo/`ph`; Agent and Workflow denied on the main provider (mem:main-session-no-native-subagents.md:18).
8. Never override another tool's setting from the kit; point the owner to that tool's setting (mem:no-kit-overrides-of-tool-settings.md:14).
9. Workers run unattended and report blockers in their result (wildera:.agents/harness-history.md:29).
10. Print the exact wait command; never hand-roll sleep/grep polling; end the turn while waiting (wildera:.agents/harness-history.md:9; kit@omp:CHANGELOG.md:13-16).
11. Do not send to a mid-turn agent without knowing the semantics (wildera:.agents/harness-history.md:17; wildera:.planning/STATE.md:119).
12. No secret/endpoint in tracked files (kit@omp:CHANGELOG.md:127-130).
13. Provider-reported cost is not list price; price from the owner's price file (wildera:.agents/harness-history.md:46).
14. Owner edits to owned files survive update; conflicts are reported (exit 2), not overwritten (kit:README.md:50-54,80-81).
15. Hooks/checks resolve paths from the tree of the edited file, not the cwd (wildera:.agents/harness-history.md:21).
16. Quote owner decisions verbatim with date; a compacted orchestrator must recover them from `.planning/STATE.md` (wildera:.planning/STATE.md:26-45,108-109).
17. A restored file needs a later mtime (git whole-second stat cache) (wildera:.agents/harness-history.md:47).
18. Probe and test agents use the cheap model unless the owner names another (mem:test-model-luna-fast.md:11).

## Interfaces
Owned here (the rest is in other maps):
- File: `.agents/harness-history.md` table `Date | Change | Scope | Reason` (wildera:.agents/harness-history.md:3-7).
- File: `CHANGELOG.md` (dated sections, `Unreleased` on top) and `kit.json` version (kit:README.md:5).
- File: `.planning/STATE.md` frontmatter keys `gsd_state_version` ('1.0'), `status` (executing), `progress.total_phases|completed_phases|total_plans|completed_plans|percent` (wildera:.planning/STATE.md:1-10); sections listed in HIS-49.
- Memory-derived kit key: `main_provider_disallowed_tools` default `["Agent","Workflow"]` in `.agents/harness.defaults.json` (mem:main-session-no-native-subagents.md:13-16).
- Config keys that come from incident rules (defaults, owner area in HIS entries): `agent_tool_stuck_s` 900; `agent_file_tool_stuck_s` 180 (wildera:.agents/harness-history.md:14); `context_guard.start_pct` 60 / `step_pct` 5 / `window_tokens` fallback (kit:README.md:118-121); `fileMaxChars` 200,000; `replyMaxChars` 450,000; `mediaPerTurn` 1 (kit:CHANGELOG.md:42-49); retained fixes 500 IDs / 8 MiB, ticket expiry 1 h (kit:README.md:99-100); edit signatures 2,000; line-edit reads 64 / 30,000 lines (kit:CHANGELOG.md:19,21); provider-error retry pauses 30,60,120,240,300 s x5 (wildera:.agents/harness-history.md:20); gsd-plan `maxSkeletonCycles` 3, checker iterations 3, `maxVerifyRounds` 4, `maxStalledRounds` 2 (superseded), `outlineModel`/`outlineEffort`, `verifierModel` (wildera:_workspace/gsd-port/DESIGN.md:100-104; wildera:.agents/harness-history.md:22-23,42,46).
- Data file: `.agents/model-prices.json` (USD per 1M tokens) (wildera:.agents/harness-history.md:46).
- Review metrics: `_workspace/review-metrics.jsonl` (wildera:.agents/harness-history.md:42).
- CLI facts recorded in history: `ph worktrees [--prune]`, `watch-run`, `run-stats`, `compact-self --focus`, `doctor`, `config`, `skills-sync`, `ph <command> --help` (omp branch), `ph send --now` (kit:CHANGELOG.md:17; kit:README.md:140-141; wildera:.planning/STATE.md:119).

## Owner decisions ledger
| date | decision | owner wording if quoted | status |
| --- | --- | --- | --- |
| 2026-10-06 | First version: harness-neutral, Backlog setup, MCP file servers, backlog/swarm plugins | not quoted | Backlog, MCP, non-Claude harnesses superseded 2026-10-20 (kit:CHANGELOG.md:51-56) |
| 2026-10-08 | Read size limits for file servers | not quoted | in force as backend limits (HIS-05) |
| 2026-10-11 | omp only; Claude Code edition stays on `main` | "omp only" (kit@omp:CHANGELOG.md:155) | superseded 2026-10-12, then 2026-10-20 (omp not carried) |
| 2026-10-11 | A project carries everything it runs on, no kit path | "no kit path in a project, a new dev machine clones the project only" (kit@omp:CHANGELOG.md:56-57) | in force in spirit (HIS-31) |
| 2026-10-11 | Circle endpoint out of the kit (public repo) | "the GitHub repo is public" (kit@omp:CHANGELOG.md:127-128) | in force (HIS-30) |
| 2026-10-11 | `_workspace/` gitignored on install | not quoted (kit@omp:CHANGELOG.md:138-139) | in force (HIS-34) |
| 2026-10-11 | ast_grep/ast_edit/lsp back for omp agents; 9-model provider list; todo off | not quoted (kit@omp:CHANGELOG.md:146-151,213-214) | superseded (omp dropped) |
| 2026-10-11 | omp `wait` tool off; ends turn instead | "a background command's result reaches the agent by itself" (kit@omp:CHANGELOG.md:13-14) | superseded as omp-only; the end-turn-while-waiting rule stays (HIS-13) |
| 2026-10-11 | No kit tricks over other tools' behaviour or settings; skills.ignoredSkills reverted | "no kit tricks over other tools' behaviour or settings" (kit@omp:CHANGELOG.md:31-32) | in force (HIS-27) |
| 2026-10-11 | metadataGeneration left to Paseo | not quoted (kit@omp:CHANGELOG.md:5-6) | in force (HIS-27) |
| 2026-10-11 | Paseo daemon address from `$PASEO_HOST`/`daemon.listen`, not `paseo.pid` | not quoted (kit@omp:CHANGELOG.md:47-48) | OPEN (HIS-29) |
| 2026-10-11 | omp base prompt reviewed; further edits only with the owner | "owner decides" (mem:omp-prompt-review-first.md:11-14) | process rule in force (HIS-39); the omp template itself dropped |
| 2026-10-11 | Probe/test agents use `gpt-6-luna-fast` | "owner asked to test cheaply" (mem:test-model-luna-fast.md:11) | in force (HIS-20) |
| 2026-10-11 | Web search through Gemini via Circle (omp); context guard kept with `ph compact-self` | not quoted (mem:omp-migration-policy.md:19-20) | superseded (omp) / compact-self in force |
| 2026-10-12 | Focus on Claude Code `main`; omp ineffective, abandon later; not deletion authorization | paraphrase, memory wording: the owner "reports that `omp` is ineffective and intends to abandon it later" (mem:omp-migration-policy.md:11) | superseded by 2026-10-20 "omp variant not carried" (task decision); branch deletion still not authorized |
| 2026-10-13 | kit-init, ai-orchestrator, harness-files mod, plugin install interface | not quoted | in force |
| 2026-10-14 | Main session: Agent and Workflow denied; Paseo/ph only; carried by `main_provider_disallowed_tools` | "Paseo is the orchestrator" (mem:main-session-no-native-subagents.md:11) | in force; restated 2026-10-20 |
| 2026-10-14 | Parallel coding up to the 20-agent cap in one shared tree, per-capability ownership, independent review, one integration build per wave | not quoted (wildera:.agents/harness-history.md:11) | in force as method (HIS-60,72) |
| 2026-10-14 | Solution quality = whole configuration envelope | owner feedback on TASK-5 (wildera:.agents/harness-history.md:16) | in force as a generic rule (HIS-61) |
| 2026-10-16 | Fixer keeps the coder's session; reviewer fresh | "the fixer should keep the coder's context; only the reviewer needs a fresh, independent context" (wildera:.agents/harness-history.md:18) | in force (HIS-16) |
| 2026-10-16 | Retry API errors | "retry API errors" (wildera:.agents/harness-history.md:20) | in force (HIS-15) |
| 2026-10-16 | Review only built code; fix until clean but no non-converging loops | "review only built code" (wildera:.agents/harness-history.md:22,25) | in force (HIS-53); fix-loop caps superseded (HIS-52) |
| 2026-10-17 | Non-fast Sol subagents, Grok reviewers, Astra for main, model allowlist | "Explicit owner model change" (wildera:.agents/harness-history.md:38) | superseded by later quota-driven choices (HIS-74) |
| 2026-10-17 | Compact reminder at 45% for WildEra | "compact earlier" (wildera:.agents/harness-history.md:41) | project overlay; kit default OPEN (HIS-11) |
| 2026-10-17 | Only high findings block; bounded review gate with verifier | "reviewers are wrong too, and review rounds kept producing new findings" (wildera:.agents/harness-history.md:42) | in force (HIS-51) |
| 2026-10-17 | Verify gates, test failures loop back to coders before review | "reviewing code whose tests still fail is wasted" (wildera:.agents/harness-history.md:34) | in force (HIS-53,59) |
| 2026-10-18 | GSD port: gsd-plan + code-wave, one chaining command, `--plan-only`; keep GSD's ideas, change only the adapter; skeleton review max 3 cycles; coders never build; no tests/mock/pilot; Backlog rule dropped, full retirement later; reviewer default Sol fast; quick-batch and full Backlog retirement deferred (quick-batch still not ported); a separate researcher agent deferred (reversed 2026-10-19, wildera:.agents/harness-history.md:45) | "keep GSD's ideas intact; change only the adapter", "Tối đa 3 vòng", "tao sửa được", "ko cần thử gì cả" (wildera:_workspace/gsd-port/DESIGN.md:8-26) | ideas in force; coders-never-build changed 2026-10-19/20 (HIS-54); Backlog fully dropped 2026-10-20; reviewer default superseded |
| 2026-10-19 | Real GSD discuss and research skills; list-price costing | "two skills taken from GSD itself" (wildera:.agents/harness-history.md:45) | in force |
| 2026-10-19 | gsd-debug and forensics first; machine-evidence resolution (a) | "port GSD debug + forensics first; choice (a)" (wildera:.agents/harness-history.md:47) | gsd-debug flow stopped by owner (HIS-56): OPEN |
| 2026-10-19 | One phase per priority; Discuss->Research->Plan->plan review->Execute->Verify; models per role; drink rule | Vietnamese rule quoted at wildera:.planning/STATE.md:40 | lifecycle in force; models superseded; drink rule project-only |
| 2026-10-19 | Phase 2 models: Sol brain steps, outline Astra, checker Sonnet | "giữ sol cho bước não", "outline tao muốn astra", "checker review tao vẫn muốn sonnet" (wildera:.planning/STATE.md:36) | superseded 2026-10-20 (quota) |
| 2026-10-19/20 | Free fix agents self-verify; one fixer per integration point; no orchestrator round-trips | "owner: no orchestrator round-trips" (wildera:.planning/STATE.md:119,129) | in force; conflicts with 2026-10-18 coders-never-build (HIS-54) |
| 2026-10-20 | Extra plan-review pass; all former-Sonnet roles Opus; reviewers Grok | "Chất lượng đến từ việc thêm bước review kìa"; "Từ sau thay sonnet bằng opus, đang lắm quota" (wildera:.planning/STATE.md:136,140) | in force per project; models are adapter data |
| 2026-10-20 | Merge phase into master before close | "Thôi mợt main đi, làm 1.1"; "Mợt vào master luôn, tao check sau" (wildera:.planning/STATE.md:131,156) | recorded exception (HIS-71) |
| 2026-10-20 | Claude fast mode: proceed without | "Owner: proceed without; enable later if a Paseo switch is found." (wildera:.planning/STATE.md:161, working tree only, not in pin 89143da) | OPEN (HIS-73) |
| 2026-10-20 | Phase 1.1 skeleton review with 4 Grok lanes (fidelity, integration, runtime-feasibility, test-integrity) | not quoted (wildera:.planning/STATE.md:162, working tree only) | in force per project; lens list is adapter data |
| 2026-10-20 | Outline size cap: coarse, about 15-20 plans, at most 4 waves, scope unchanged (CONTEXT D-16) after an 85-plan/8-wave outline | "overthinking, có tý code mà" (wildera:.planning/STATE.md:163, working tree only, not in pin 89143da) | in force (HIS-92) |
| 2026-10-20 | New kit `paseo-kit`: from scratch, Claude Code only, circle models inside it, non-Claude MCP adapters dropped, Backlog dropped entirely, GSD core ships (lifecycle, `.planning/`, generic agents; project supplies an adapter), Paseo stays runtime, omp not carried | task decision list of this mapping assignment | in force |

## Cross-area dependencies
- runtime: HIS-01..03, 10..12, 15..18, 22, 24, 28, 29, 62 (watchdog, retries, sessions, costing, compact-self, daemon address, worktrees, machine lock).
- files: HIS-05..09 (limits, batch edit semantics, mod tools, prompt size).
- hooks: HIS-04, 10, 11 (context guard, syntax hook, identity).
- install: HIS-25..27, 30..36, 64, 76 (deny key, ownership, gitignore, plugin, requirements, machine).
- workflow: HIS-16, 17, 21, 23, 51..54, 58..60 (sessions, scripts, review gate, Verify, attribution).
- method: HIS-38, 39, 44, 55, 61, 66..70 (prompts, lifecycle, root-cause, history, owner records).
- gsd-plan: HIS-42..50, 63 (departures, pin, skeleton review, checker, digests, resume).
- gsd-debug: HIS-55..57.
- gsd-upstream: HIS-42, 43.
- ui: HIS-77.
- files/history input: this map supplies the ledger for every area; each area map should cite its HIS IDs rather than restate incidents.

## Concerns
- README intro contradicts the deny rule (kit:README.md:7-9 vs :146-149).
- CHANGELOG "Unreleased" holds the watchdog fix although the tag commit says `0.1.0 + watchdog input-complete fix` (kit:CHANGELOG.md:3-7; kit-git:2); the version of the fix is unlabeled.
- README test list still names MCP tests (`mcp/test_fs_batch.mjs`, `mcp/test_fs_proxy.mjs`) and a Backlog requirement (kit:README.md:34,161-162); stale under the new decisions.
- STATE.md frontmatter says `percent: 0`, `completed_plans: 16` of 37 and `completed_phases: 0` while the body logs waves done (wildera:.planning/STATE.md:5-9,49-51); the progress block is not derived from files.
- STATE.md grows by appended dated paragraphs ("Current debug run:" repeated four times, wildera:.planning/STATE.md:60,62,64,66; two pre-compact blocks, :121 and :147) instead of replacing a current state; costs context on every resume.
- Five harness-history rows overlap in subject (14 vs 13; 17 vs 47; 22 vs 40/42 are superseded but remain), so a reader cannot tell which rule is current without the Reason column (wildera:.agents/harness-history.md:13-14,17,22,40,42,47).
- dino and WildEra copies of the history diverge only by missing newer rows; kit copies were "synced, uncommitted" at write time (wildera:.agents/harness-history.md:14) - drift risk when the history file is copied per project.
- kit-test-project's history header uses the old `.claude/skills/harness/` path while newer projects use `.agents/skills/harness/` (ktp:.agents/harness-history.md:3; wildera:.agents/harness-history.md:3).
- DESIGN.md says coders never build; STATE.md says fixers build themselves (wildera:_workspace/gsd-port/DESIGN.md:13; wildera:.planning/STATE.md:119) - docs not updated.
- DESIGN.md says reviewer default `sol-fast`; history says the allowlist blocks fast models (wildera:_workspace/gsd-port/DESIGN.md:18; wildera:.agents/harness-history.md:38).
- `ph send` semantics stated two ways (HIS-22).
- Memory files for omp (`omp-migration-policy`, `omp-prompt-review-first`) describe a direction the 2026-10-20 decisions replaced; MEMORY.md index still lists them as current (mem:MEMORY.md:1,3).
- Several history rows are bundled (row 15 holds six changes; row 47 holds a debug engine plus many review rounds), which hides which behaviour is covered by which test (wildera:.agents/harness-history.md:15,47).
- The debug engine (`tools/gsd/debug.mjs`) accumulated three review rounds with 14+5 findings, and the owner stopped using it: over-engineering risk (wildera:.agents/harness-history.md:47; wildera:.planning/STATE.md:68).
- God-vibe-code history path from the assignment does not exist; nothing to map.

## Open questions for the owner
1. Default `context_guard.start_pct`: 60 (kit now) or 45 (WildEra overlay, owner "compact earlier")? Options: keep 60 with overlay; set 45. Recommend 45 for GSD-heavy projects via adapter, kit default 60 until measured.
2. Do coders/fixers build and test themselves (STATE.md:119) or only the Verify stage (DESIGN.md:13)? Options: adapter flag `fixer_verifies_itself`; fixed rule. Recommend adapter flag, default true for fixers, false for parallel coders.
3. Does the supervised `gsd-debug` engine ship in the core? Options: ship fully; ship forensics + a plain debug agent with the root-cause rule (HIS-55); ship nothing. Recommend the second.
4. Is the extra plan-review pass (finders, verifiers, judge, one reviser) a core optional stage? Options: core stage `plan_review_pass`; project-only. Recommend core, off by default.
5. Does `harness-history.md` stay as a separate per-project file? Options: keep as is; fold reasons into `.planning/` and CHANGELOG; keep but mark superseded rows. Recommend keep, one row per change, with a `Supersedes` column.
6. Is the daemon-address rule (`$PASEO_HOST` else `daemon.listen`) required on main (HIS-29)? Recommend yes.
7. Keep the swarm plugin/panel (HIS-77) or drop with the backlog panel? Recommend decide in the ui map; default drop unless used.
8. Merge-before-verify (HIS-71): a documented override only, or a lifecycle option? Recommend override only, recorded in STATE.md.
9. Fast mode (HIS-73): wait for a Paseo switch; no kit workaround. Confirm.
10. Should the two omp memory notes be updated or archived now that the omp variant is not carried (they are not deletion authorization for the branch)? Recommend archive notes, keep the branches until the owner says.
11. Worktree isolation vs refusal outside the project root (HIS-28): keep both? Recommend keep worktrees, refuse spawn outside the root.
12. Quick-batch (HIS-87): port it with the core or leave it out? Recommend leave out until a project asks.

## Revision log r1
New behaviors HIS-79..HIS-92 are part of the Behaviors list (placed after HIS-78). Cross-area: HIS-79..82 -> gsd-debug (with HIS-55..57); HIS-83..86 -> gsd-plan/workflow/gsd-upstream; HIS-88 -> install; HIS-89 -> workflow; HIS-90 -> install; HIS-91 -> files; HIS-92 -> gsd-plan.

| finding ID | accepted / rejected | what changed or why rejected |
| --- | --- | --- |
| R1-HIS-01 | accepted | Checked against wildera:.agents/harness-history.md:47: all twelve items are in the row. Added HIS-79 (two-tier needsDebug, bounds not reset, signatures cleared only by passed rerun, typed reruns / `debuggable: false`), HIS-80 (durable log, detached wrapper with running record, writer detection from run.json `script`, guaranteed lease release), HIS-81 (revert-red, per-target provenance, coverage merge, invocation-bound deadline, every crash-reason line), HIS-82 (Verify validators, scratch-repo checks). Where the row gives no detail (validators, revert-red) the entries say so; HIS-56/57 left as sketches. |
| R1-HIS-02 | accepted | Rows 43-45 and DESIGN.md verified. Added HIS-83 (schema split), HIS-84 (obligations each round, probe blockers), HIS-85 (shared files by path, never owned; DESIGN.md:95-98), HIS-86 (provider/cache and unported-advanced departures; research and discuss workflow shape), HIS-87 (quick-batch still deferred, researcher deferred then reversed), HIS-88 (never edit the kit AGENTS.md block, DESIGN.md:119-120). Archived-agent send added to HIS-22 (DESIGN.md:24-25). Ledger 2026-10-18 row updated with the deferrals. New open question 12. |
| R1-HIS-03 | accepted | wildera:.planning/STATE.md:74 reads "20 concurrent rolling workers, not 20-job barriers" and requires Sol/Grok stages to follow. Added HIS-89. |
| R1-HIS-04 | accepted | `git show 89143da:.planning/STATE.md` has 160 lines; `git diff 89143da` adds three lines (161-163) to STATE.md. Coverage row corrected; HIS-45, HIS-73, HIS-74 and the ledger fast-mode and 4-lane rows now mark :161/:162 as uncommitted working-tree text with the wording quoted. Coverage row for DESIGN.md says `_workspace/` is gitignored (`git check-ignore`: .gitignore:2), so it is not in the commit. |
| R1-HIS-05 | accepted | STATE.md:163 (working tree) read: "overthinking, có tý code mà", D-16 about 15-20 plans, at most 4 waves, coarse granularity. Added HIS-92 and a ledger row, both marked post-pin. |
| R1-HIS-06 | accepted | HIS-29 now describes two incidents: stale pid naming a gone process (kit@omp:CHANGELOG.md:199-200) and live pid with the CLI's instance lookup missing the daemon (:47-51). Cite 201 dropped (blank line). |
| R1-HIS-07 | accepted | HIS-12 split: README protocol and "do not override native autocompact" (kit:README.md:130) KEEP; the one-watcher lock is an omp incident, absent on main (checked kit commands.mjs at ref-final lines 386-441: no lock, success by token drop below 0.5, 900 s timeout), proposal CHANGE (add the lock to the Claude Code watcher). |
| R1-HIS-08 | accepted | wildera:.agents/harness-history.md:42 says the gate replaces the review/fix/re-review loop and its check is "those findings only, no new findings"; the file scope came from row 40 (old loop). HIS-51 rewritten; HIS-52 unchanged. |
| R1-HIS-09 | accepted | kit@omp:CHANGELOG.md:70-71 and 121-124 verified. Added HIS-90 (replace, not append) and HIS-91 (no clean-rollback promise). The register-op refusal in 121-124 is omp-io specific and left out. |
| R1-HIS-10 | accepted | HIS-35 pointer changed from HIS-45 to HIS-77. |
| R1-HIS-11 | accepted | wildera history is 47 lines, rows are lines 9-47 = 39 rows. HIS-66 corrected. dino "34 rows" (lines 9-42) stands. |
| R1-HIS-12 | accepted | STATE.md:60,62,64,66: four "Current debug run:" headings. Concerns corrected. While checking, the "four pre-compact blocks" claim was also wrong (two: STATE.md:121,147); corrected too. |
| R1-HIS-13 | accepted | HIS-02 now says the 400 s Bash hang is a simulated test event, under 900 s and not a file tool, not a third limit. |
| R1-HIS-14 | accepted | kit:README.md:103-105 removed from HIS-05's citation (native Read/media alias; covered by HIS-08's :83-111). |
| R1-HIS-15 | accepted | HIS-30 now cites kit-git:46-47 for the history rewrite, kit-git:52-75 for the secret-template message only, kit@omp:CHANGELOG.md:36-37 for the secret fill. |
| R1-HIS-16 | accepted | Diacritic restored ("init project này", kit:README.md:64); HIS-41 gives `_workspace/gsd/01-m1-p0/deferred.md` as an observed example; HIS-43 says generation adds front matter and a GENERATED line (DESIGN.md:43-46); HIS-60 mentions the content-restore rules (row names them without text); ledger 2026-10-12 cell marked as paraphrase with the memory wording. Reviewer's closing note on the two moot omp-prompt questions added to HIS-39. |
