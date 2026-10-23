---
name: ph
description: "The ph command-line contract of the kit runtime - start, message, wait for, read and archive Paseo agents (spawn, fanout, send, watch, result, team, context, stop, archive), team task lists, artifact freeze, worktrees, self-compaction, doctor, and workflow scripts. Use whenever you orchestrate Paseo agents from a session or an agent, or when a skill or GSD command tells you to run ph. Trigger on: 'spawn agents', 'run a workflow', 'watch the run', 'chạy agent', 'giao cho agent', 'xem run'."
---

# ph: the agent runtime CLI

`ph` means `node .agents/harness/ph.mjs`, run from the project root (inside agents use the absolute form printed in
your runtime notes). One entry, no other script. `ph help` lists the commands, `ph help <command>` shows one usage.
`ph <command> -h` (or `--help`) prints the same usage and runs nothing; `ph gsd <verb> -h` prints that verb's usage.
A bare `--` ends the options, so a value such as `-h` can still be passed as data.

## Rules for orchestrators

- Main sessions orchestrate only through `ph`: native `Agent` and `Workflow` are denied on the main provider, so
  every subagent is a Paseo agent started by `ph`. Agents you start are your subagents (`PASEO_AGENT_ID` must be set:
  run `ph` from an agent inside Paseo) and are found by name, id or unique id prefix (6+ characters).
- A workflow (`ph workflow`) runs only when the owner asked for one, or when an invoked skill or GSD command names
  `ph workflow` (that invocation counts as the request). Otherwise use a team (`spawn`/`fanout` + `send`) or one-shot
  agents (`fanout --collect`).
- Wait with Monitor, never with polling loops: after `spawn`, `send` and `fanout` (without `--collect`) run the
  printed `next:` line, `ph watch <names>`, under the Monitor tool; it prints one line per idle agent and exits when
  all are idle. Do not write sleep/grep loops and do not poll `ph team`.
- Batch follow-ups: collect what you want to tell an agent and send it in one `ph send` when the agent is idle. A
  message to a running agent waits until its turn ends; `--now` interrupts the turn and should be rare.
- Run builds, tests and other long commands in the foreground: a Paseo agent that ends its turn to wait for a
  background command is not woken when it finishes.
- Archive agents when their work is closed (`ph archive <names>` or `ph archive --idle`); an archived agent's reply
  can no longer be read, so read results first.
- Keep at most `max_subagents` agents running (config, shipped 20; about 350 MB of RAM each) and at most
  `max_live_subagents` live (running + idle). `ph` refuses beyond either cap; a workflow queues instead.

## Commands

Output: one line per item; an item failure is `failed <what>: <err>` and makes the exit code 2. Exit 0 done, 1 usage
or config error (nothing done), 2 done with failed items or problems.

| command | does |
| --- | --- |
| `ph doctor` | checks node, `PASEO_AGENT_ID`, config, Paseo CLI and daemon, every tier's model, the default tier, the overlay, the harness-files mod, the provider policy, adapter files, agent types and RAM; `ok`/`problem`/`note` lines, exit 2 on a problem. Run it first when agents misbehave. |
| `ph config` | the effective config (kit defaults + `.agents/harness.config.json`) with file provenance. |
| `ph spawn --name N (--prompt T \| --prompt-file F) [--count K] [--type T] [--role R] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--worktree]` | starts persistent named teammates (`N-1..N-K` with `--count`), prints `<id> <name>` per agent and the `next:` wait line, returns at once. |
| `ph fanout --file F [--type] [--role] [--model] [--effort] [--read-only] [--cwd] [--ws]` | one teammate per `=== <name>` block of F, started together. |
| `ph fanout --file F --collect DIR [--keep]` | one-shot agents within the free slots; waits, writes `DIR/<name>.md` (final reply) and `DIR/<name>.json` (the `result --json` object), archives each agent unless `--keep`. Run it in the foreground; do not poll its output. |
| `ph send (--prompt T \| --prompt-file F) [--now] NAME...` | delivers a message between turns (`--now` interrupts), prints `sent <name>` and the wait line. |
| `ph watch NAME...` | under Monitor: `idle <name> <id8> out_tokens= context_tokens= duration_s=` per agent, then `watch done: k idle, m failed`. |
| `ph result [--json] NAME...` | final replies; `--json` adds status, model, usage, tokens (only for agents this process created), `costUsd` from `.agents/model-prices.json`, `reportedCostUsd`, durations and the skills the agent called. |
| `ph team` | your live subagents: `<id8> <status> <context%> <provider/model> <name>`. |
| `ph context [--self] [--rotate-pct N] [NAME...]` | context-window use, highest first; `ROTATE` at or above N (default `context_guard.start_pct`) marks the agent and changes nothing. To rotate it, start a fresh agent with a handoff, then `ph archive` the old one. |
| `ph stop NAME...` | cancels the running turn; agent and context stay. |
| `ph archive NAME... \| --idle [--name-prefix P] \| --name-prefix P \| --run RUNID [--runs-dir D]` | archives agents; `--run` also stops a running workflow runner and marks the run `stopped`. |
| `ph compact-self [--focus TEXT] [--resume TEXT] [--agent ID]` | compacts you after this turn (see below). |
| `ph task add\|update\|list\|get --ws D ...` | the team's shared task list `<ws>/tasks.json` (see below). |
| `ph freeze --ws D --phase P [--check]` | sha256 record of `<ws>/P_*` files; `--check` reports `modified`, `missing`, `new` (exit 2). |
| `ph worktrees [--prune] [--runs-dir D]` | harness git worktrees and their state; `--prune` removes only merged-and-clean ones and registrations whose directory is gone. |
| `ph workflow`, `ph watch-run`, `ph run-stats`, `ph evolve-stats`, `ph review-stats`, `ph runs` | workflow scripts (see the workflow section). |
| `ph gsd <verb>` | GSD state verbs used by the GSD skills. |

Options are `--key value` only; a value may itself start with `--`. Prompts: exactly one of `--prompt` and
`--prompt-file` (a path relative to the project root; prefer it for long text). An outbound message above
`max_prompt_bytes` is refused: pass a file path instead of inlining content.

## Models, roles and agent types

- `--model` takes a tier (`frontier`, `pro`, `standard`, or a project tier/alias from the config) or an explicit
  `provider/model`. The kit ships the tiers unconfigured; the project's mapping lives in `.agents/harness.config.json`
  (written by the harness adapter generator). `--effort off|low|medium|high|xhigh|max` overrides the tier's thinking
  level (clamped to what the model offers). `allowed_models`, when set, limits the usable ids.
- Keep a tier's model, effort and Fast toggle in `.agents/harness.config.json`: `tiers.<name>.provider`,
  `thinking`, `features.fast_mode: true|false`. Use tier names by default so an owner can change this mapping once.
  `--model pro` inherits `tiers.pro.features`; a direct `--model circle/<model>` does not. Fast does not change
  permission mode or model identity and requires provider/model support. Patch only requested tier fields,
  preserve other settings, and do not duplicate tiers merely for Fast on/off. Changes affect new agents/new
  workflow launches, not live agents or cached resume calls. The shipped tiers remain unconfigured.
- `--role R` (fanout `role=`, workflow `agent({role})`) names a GSD role; model and effort then follow
  `gsd.roles.<R>` of the adapter. Precedence, for model and effort separately: `--model`/`--effort` > role entry >
  the agent type's `model:` > `default_tier`. The role is never guessed from the agent type.
- `--type T` loads `.agents/agents/T.md`: its body and every `include:` file are pasted into the first prompt (the
  agent is told not to open them again); `model:` picks the default model. `tools:` grants nothing; a `tools:` list
  without an editing tool marks the role read-only.
- Read-only (`--read-only`, fanout `read-only=true`, a read-only type) adds a runtime note forbidding file changes
  except named output files. Where the installed Paseo accepts per-agent denies, the editing tools are also denied;
  otherwise the note is advisory: freeze the inputs a reviewer must not change (`ph freeze`) and verify them after
  the review with `ph freeze --check`. A read-only agent delivers its report in its final reply; the caller writes it
  (`fanout --collect` does). A role that must write named artifacts is not read-only.
- `--cwd D` gives the agent a working directory (as an instruction in its prompt and as the daemon cwd).
  `--worktree` (spawn only) creates `<repo>/.claude/worktrees/<name>-<stamp>` on branch `harness/<name>-<stamp>`; the
  agent edits only there. The adapter's `worktree_setup` paths (git-ignored dependency folders) are copied or linked in
  before the agent starts. Worktrees are kept for you to merge; `ph worktrees --prune` cleans up afterwards.

## What every first prompt carries

After the task, `ph` appends `Runtime notes:`: work silently and answer only in the final reply (workflow agents:
the final message is the return value); for teammates the team wiring (leader, task list and `ph send` commands);
the read-only note; the worktree or working-directory note; the kit's first-prompt note (batch file tools, UTF-8,
never message the leader session, write long documents in parts) plus the project's `project_prompt_note` and the
platform note. Do not repeat these in your prompts.

## Teams: send, task list, freeze

- Teammates (`spawn`, `fanout` without `--collect`) keep their context between your messages and end every turn
  with a reply to you. They reach each other with `ph send`.
- `ph task add --ws D --title T [--assignee A] [--depends-on 1,2] [--notes N] [--status S]` -> `task <id> added`;
  `ph task update ID --ws D [--status pending|in_progress|completed|blocked] [--assignee] [--notes] [--title]
  [--depends-on 1,2 | ""]`; `ph task list --ws D [--assignee A] [--status S]` marks `READY` the pending tasks whose
  dependencies are completed; `ph task get ID --ws D`. The file is locked per call; it is coordination for one
  team, not planning state (that is GSD's `.planning/`).
- `ph freeze --ws D --phase P` before handing inputs to reviewers; `ph freeze --check --ws D --phase P` after.

## Self-compaction

`ph compact-self [--focus "<what to keep>"] [--resume TEXT]` arms a detached watcher for you and returns at once.
Before calling it, stop your Monitors and background commands: a notification arriving during compaction cancels
it. Then end your turn immediately. The watcher waits for your turn to end, sends `/compact` once, and confirms
success only by a large drop in used tokens; then it sends the resume message (`--resume`, else config
`compact_resume`), which wakes you. If the drop does not come it tells you `compaction NOT confirmed`; it never
retries, you decide whether to call it again. One watcher per agent: a second call while one is armed is refused.
Native autocompact is never touched.

## Workflows (`ph workflow`)

Consent first (see the rules above). A workflow script is JavaScript run by `ph workflow`; every `agent()` call is
one Paseo agent created and archived by the runner. The method's recipes are in
`.claude/skills/harness/references/workflow-recipes.md` (fan-out with adversarial verification, judge panel, loop
until dry, budget-aware loop, custom type + schema + effort, tier choice).

- `ph workflow --script F | --name N [--args JSON | --args-file F] [--budget 500k] [--runs-dir D] [--detach]`;
  resume a run with `ph workflow --script F --args-file A --resume <runId>` or `ph workflow --resume <runId>`. A resume
  first archives the agents the killed run left running (journaled, never finished), so each call starts again with
  one live agent.
  `--detach` returns at once; follow it with `ph watch-run <runId> --quiet` under Monitor (one line when the run ends;
  without `--quiet` the watch also prints the log, phase and `agent done ... null` lines; `--all` prints every line).
- Run directory `_workspace/_runs/<runId>/`: `script.js`, `args.json` (only when the run got args), `run.json`, `journal.jsonl`, `log.txt`,
  `result.json`. `ph run-stats <runId>` sums time, tokens and cost; `ph runs [--prune]` lists and prunes runs;
  `ph archive --run <runId> [--reason "<why>"]` stops a run for good; the reason goes into `run.json` and the metrics
  ledger, so give one.
- Every ended run appends one line to `_workspace/harness-metrics.jsonl`, which pruning keeps. `ph evolve-stats
  [--agent A] [--workflow N] [--since YYYY-MM-DD]` prints it per agent version (agent, role-text hash, model,
  effort) and per workflow, with a suggested `--budget` (4 x the median output tokens of a run), then every project
  skill with the times the model invoked it (`_workspace/skill-usage.jsonl`); `--import [--runs-dir D]` first adds ended
  runs that are not in it yet. `harness-evolve`
  reads it (harness skill, `references/kit-adapter.md` section 11).
- `ph review-stats [--phase NN]` reports how the gsd-execute code review performed, from the phases'
  `review/*.json` records: findings by severity and gate status, verifier verdicts of gated findings, confirmed
  findings resolved at the resolution check, likelihood against findings judged real or false, and the later fate of
  non-blocking findings. Record that fate when a deferred finding is settled: `ph review-stats outcome PLAN:FINDING
  fixed|not-hold|duplicate|wont-fix [--note T]` (`_workspace/review-outcomes.jsonl`; the ids of `deferred.md`). A fate
  binds to that finding's content (id, file, line, class, description, trigger), so a rerun that reuses the id for
  another defect does not inherit it. When PLAN:FINDING names different findings in several records, the fate goes to
  the newest record's finding and the output says so. Outcome lines without that fingerprint (written before) are
  reported as not applied.

Authoring rules:
- Guard `null` per stage (an `agent()` call returns `null` with a journaled reason when it fails) and
  `.filter(Boolean)` before aggregating.
- No needless barriers: `pipeline` by default; `parallel` only where a stage needs every result.
- Pass `opts.phase` inside parallel stages, never the global `phase()`.
- Give agents per-item extracts and paths, never whole corpus files.
- Read `journal.jsonl` before diagnosing a run.
- Keep scripts in files (`--script` or `.agents/workflows/<name>.js`) so `--resume` works.
- Scripts never read the clock (`Date`, `Math.random` throw); the host passes times in `args`.

Trusted code, no sandbox:
- Workflow scripts are trusted project code: write scripts like code you run and await every `agent()`.
- The script context is not a security boundary: a script can reach the host process.
- `shell()` runs host commands on purpose.
- A busy loop in a script hangs the runner (there is no body timeout).
- Budget is checked before each new call, so agents already running can overshoot it.

Log lines (`log.txt`, the lines `ph watch-run` follows). `ph watch-run RUNID` prints only the `log`, `phase` and
`workflow` lines and the `agent done ... null` lines; `ph watch-run RUNID --all` prints every line below. `--quiet` prints
only the line that ends the watch. With several
run ids each line starts with `[<last 4 characters of the run id>] `. Filter with `--line-buffered` so the pipe does
not hold lines back, and match both forms: `ph watch-run RUNID --all | grep --line-buffered -E '(^|\] )(phase |agent (start|done) )'`.

| line | meaning |
| --- | --- |
| `workflow start <runId> <runDir>` | run started |
| `phase <title>` | the script called `phase()` |
| `log <message>` | the script's `log()`; also `log warning: ...`, `log nested workflow <path>`, `log watchdog: ...` |
| `agent start #<n> <label> <id8> <model>` | a call created its agent |
| `agent done #<n> <label> ok\|null (<reason>) tokens=<n> cost=<usd\|?> <s>s` | a call finished |
| `agent cached #<n> <label>` | a resumed run reused a recorded result |
| `shell start #<n> <command>` / `shell done #<n> code=<c> <s>s` | a `shell()` call |
| `workflow done <runId>: ...` / `workflow failed <runId>: ...` | the run ended |

Watchdog of workflow agents (config keys, shipped values; 0 disables a limit, `watchdog_enabled: false` arms none).
Time counts model time since the last prompt, tool time excluded. Teammates get no automatic stop.

| key | shipped | effect |
| --- | --- | --- |
| `agent_nudge_s` | 2700 | one steering message after this much model time |
| `agent_stop_s` | 5400 | the agent is stopped and the call returns `null` |
| `agent_tool_stuck_s` | 900 | a tool call open this long is interrupted once with a retry message |
| `agent_file_tool_stuck_s` | 180 | the same for the file tools |
| `watchdog_repeat_calls` | 3 | identical tool calls since the last prompt (not necessarily in a row; a write resets the count) before a loop warning |
| `watchdog_same_file_reads` | 6 | reads of one file before a reread warning |
| `watchdog_reads_without_write` | 40 | reads without a write before a piecemeal warning |

## When something is wrong

Run `ph doctor`. `PASEO_AGENT_ID is not set`: run `ph` from a Paseo agent. `tier <name> has no model`: the project
has not mapped its tiers yet (run the harness adapter generator, or set `tiers.<name>.provider` in
`.agents/harness.config.json`). A cap refusal: wait, `ph archive --idle`, or use a workflow (it queues). An agent
stopped for a permission it was not granted, or failing with an error, shows in `ph watch` as `failed <name> <id8>: ...`;
read it with `ph result <name>`.
