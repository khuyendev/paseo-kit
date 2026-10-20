# Paseo runtime — how a harness runs on Paseo agents

Every harness built with this skill runs its agents as **Paseo agents**, driven by one command-line tool. This
document is the runtime contract: what each Claude Code primitive of upstream Harness v2 became, the commands,
the workflow-script API, and the known limits. The method (phases 0-7, execution modes, team patterns, quality
patterns) does not change; only the runtime does.

`ph` below always means `node .agents/harness/ph.mjs`, run from the project root. Generated orchestrator skills
write the full command, not `ph`, so they can be copied and run as they are. `ph help` lists the commands and
`ph help <command>` prints one command's usage.

---

## Contents

1. [Requirements](#1-requirements)
2. [Primitive map](#2-primitive-map)
3. [Configuration and model tiers](#3-configuration-and-model-tiers)
4. [What ph adds to every agent prompt](#4-what-ph-adds-to-every-agent-prompt)
5. [Commands](#5-commands)
6. [Workflow scripts (mode A)](#6-workflow-scripts-mode-a)
7. [Shared task list (mode B)](#7-shared-task-list-mode-b)
8. [Artifact freeze](#8-artifact-freeze)
9. [Waiting for agents](#9-waiting-for-agents)
10. [Known limits](#10-known-limits)
11. [Self-compaction](#11-self-compaction)

---

## 1. Requirements

| Requirement | Why | Check |
| --- | --- | --- |
| The orchestrating session runs inside Paseo (env `PASEO_AGENT_ID` is set) | Every agent is created as the caller's subagent (label `paseo.parent-agent-id`) in the caller's workspace. Without a caller `ph` refuses to create agents, so no stray workspace or project is created. The caller must work inside the project root. | `ph doctor` |
| Paseo CLI installed with npm (`npm i -g @getpaseo/cli`) and the daemon running | `ph` loads the CLI's own daemon client; `ph doctor` prints the loaded CLI version next to the version the kit was tested with | `ph doctor` |
| Node.js 20.17 or newer with `path.matchesGlob` | runtime language; the file backend's glob search | `ph doctor` |
| Agents are Claude Code sessions (provider `circle`, workers on `circle-agent`) | the kit supports Claude Code only; tiers and `--model` name `circle/<model>` | `ph doctor` (tier lines) |
| Batch file tools: the `harness-files` mod (`mcp__harness-files__read_ranges`, `edit_multiple_files`, `write_multiple_files`) when the owner enabled it, else native Read/Edit/Write where owner restrictions permit | Agents read many files in one call and edit or write many files in one call. One tool call per file costs one model turn per file. | `ph doctor` (mod lines) |
| Main sessions orchestrate only through `ph` | the main provider denies the native `Agent` and `Workflow` tools (machine key `main_provider_disallowed_tools`); `SendMessage` is not denied there | `ph doctor` |

## 2. Primitive map

| Upstream (Claude Code) | Paseo edition | Notes |
| --- | --- | --- |
| `Workflow` tool with a script (`agent`, `pipeline`, `parallel`, `phase`, `log`, `args`, `budget`, `workflow`) | `ph workflow --script <file.js>` (or `--name <name>` for `.agents/workflows/<name>.js`): the same JavaScript API plus `shell()`, every `agent()` is one Paseo agent | section 6 |
| `agent(prompt, {schema})` returning a validated object | the agent's final message must be JSON matching the schema; the kit's own validator checks it (a documented JSON Schema subset) and on mismatch the same agent is asked again with the errors (config `schema_retries`) | `null` after the last retry |
| `opts.agentType` / `subagent_type: "{name}"` | `--type {name}` / `opts.agentType`: the body of `.agents/agents/{name}.md` is put in front of the prompt; its `model:` picks the tier | section 4 |
| `model: fable / opus / sonnet` | tier names `frontier` / `pro` / `standard`, mapped to real models by config `tiers` (the kit ships no upstream aliases; a project may add `tier_aliases`) | section 3 |
| `opts.effort` | Paseo thinking option (`off`, `low`, `medium`, `high`, `xhigh`, `max`); clamped to the nearest option the model supports | |
| (no upstream counterpart) | `--role R` / `opts.role`: a GSD role name; the project adapter's `gsd.roles` entry for it may set model and effort | section 3 |
| `opts.isolation: 'worktree'` | `git worktree add` under config `worktree_dir` (`.claude/worktrees`) on a new branch `harness/<name>`; the agent is told to work only there | needs a git repository; see section 10 (working directory) |
| `resumeFromRunId` | `ph workflow --script <file> --args-file <file> --resume <runId>` | section 6-6 |
| `Agent(name: "x", ...)` (persistent, named) | `ph spawn --name x ...` | the agent keeps its context |
| several `Agent(name: ...)` calls in one message (team launch) | `ph fanout --file F` without `--collect`: one persistent named agent per block, started in parallel | |
| `SendMessage({to: "x"}, ...)` | `ph send --prompt "..." x` (or `--prompt-file`) | delivered when `x` is idle (section 10) |
| completion notification of a named agent | `ph watch x ...` run under the Monitor tool, one line per agent | section 9 |
| one-shot `Agent` calls in one message | `ph fanout --file F --collect <dir>`: one agent per block, waits, writes each final reply to `<dir>/<name>.md` and its `ph result --json` object to `<dir>/<name>.json`, archives | or `ph spawn` + `ph watch` + `ph result` |
| return value of an `Agent` call | `ph result x [y ...]` (final reply); `--json` prints one JSON line per agent with status, usage, cost, duration, skills used | Paseo keeps this until the agent is archived |
| `total_tokens` of a finished subagent, budget accounting | the usage Paseo reports for every finished turn (`turn_completed` stream event), added up by `ph` from the moment it creates the agent | section 6-2 `budget`, section 10 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | `ph task add` / `update` / `list` / `get` on `<workspace>/tasks.json` | section 7 |
| `TaskStop` | `ph stop x` (interrupts the current turn) | |
| agents end by themselves | `ph archive x ...` or `ph archive --idle` when their work is closed | archived agents disappear from the Paseo sidebar |
| `Read` / `Edit` one file per call | the `harness-files` mod's batch tools when enabled; native tools otherwise | `AGENTS.md` file I/O rules |
| `general-purpose` type | no `--type`: an agent with all tools at the default tier | |
| `Explore` / `Plan` (read-only) types | no `--type` plus `--read-only` (section 10) | |
| `tools:` in an agent definition | advisory: a definition whose `tools:` lists none of the editing tools makes the agent read-only | section 10 |
| shell `shasum` for the freeze step | `ph freeze` (SHA-256, any OS) | section 8 |
| headless `claude -p` for trigger checks | `ph spawn` + `ph result --json` (field `skills`) or a workflow | skill-testing guide |

## 3. Configuration and model tiers

`.agents/harness.defaults.json` holds the kit defaults and is replaced when the kit is updated. Project settings
live in the overlay `.agents/harness.config.json`, which the kit never overwrites. `ph config` prints the effective
values with their sources. One loader (`.agents/harness/config.mjs`) serves `ph`, the hooks and the file backend;
it validates closed: an unknown key or a wrong type fails with `invalid harness config <key>: <reason>`.

Merge rules: `tiers`, `tier_aliases`, `platform_notes`, `context_guard`, `io_guard`, `read_limits`, `adapter` and
`gsd` merge per entry (an overlay entry adds an entry or replaces that whole entry, so a nested entry is written
whole); every other key replaces the kit value. Overlay keys starting with `_` are ignored. The machine keys
`agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env`, `main_provider_disallowed_tools` and the
kit's `first_prompt_note` are kit-owned: overlay values are ignored.

The shipped tiers are unconfigured (`"provider": ""`): creating an agent on an unconfigured tier fails and names
the key to set. The project adapter written by the harness skill (`references/kit-adapter.md`) sets them. A tier or
`--model` names `circle/<model>` (Claude Code through the Circle proxy; `agent_providers` maps `circle` to the
worker provider `circle-agent`).

| Key | Default | Meaning |
| --- | --- | --- |
| `tiers` | `frontier`, `pro`, `standard`, all unconfigured | each tier maps to `{"provider": "circle/<model>", "thinking": "<id>", "features": {"<feature id>": <value>}}`; `thinking` and `features` (Paseo agent features set at creation, e.g. `fast_mode`) are optional |
| `tier_aliases` | `{}` | other names accepted wherever a tier is |
| `default_tier` | `standard` | tier when neither the call, the role table nor the agent definition names one (upstream rule: when unsure, standard) |
| `mode` | `bypassPermissions` | Paseo session mode of every agent. Agents run unattended, so a mode that asks for permission stalls them. |
| `allowed_models` | `[]` (any) | if not empty, the only `provider/model` ids `ph` will start |
| `max_subagents` | `20` | most agents of this caller running at once (spawn refuses beyond it; workflows queue beyond it) |
| `max_live_subagents` | `40` | most live (running or idle, not archived) subagents of this caller; archive idle agents to free slots |
| `max_agents_per_workflow` | `1000` | runaway-loop backstop for one workflow run including nested workflows |
| `wait_timeout_s` | `3600` | longest single agent turn before the wait counts as failed |
| `schema_retries` | `2` | extra attempts in the same agent when its JSON does not match the schema |
| `prime_role` | `off` | `two-turn`: workflow agents with a type get the role block alone as their first message (reply READY), then the task (section 4) |
| `warmup` / `warmup_s` / `warmup_timeout_s` | `false` / `8` / `90` | the first agent of a run × type × model starts alone; the rest wait for its role turn (or `warmup_s`), at most `warmup_timeout_s` |
| `max_prompt_bytes` | `262144` | larger prompts are refused; pass a file path instead of inlining content |
| `project_prompt_note` | `""` | project text appended after the kit's first-prompt note |
| `compact_resume` | generic text | message `compact-self` sends after a confirmed compaction to wake the agent (section 11) |
| `context_guard` | `window_tokens` 1000000, `start_pct` 60, `step_pct` 5 | reminds the main conversation of its context use (section 11); `start_pct` is also the `ROTATE` threshold of `ph context` |
| `worktree_dir` | `.claude/worktrees` | where worktree isolation creates worktrees |
| `runs_keep` | `20` | finished runs `ph runs --prune` keeps |
| `adapter`, `gsd` | neutral | the project adapter (`references/kit-adapter.md`) |

`--model` and `opts.model` accept a tier name, an alias or an explicit `provider/model` id. Choose tiers with
`model-selection-guide.md`. Model and effort are chosen independently, each by the first layer that sets it: the
call (`--model`/`--effort`, a fanout block, `opts.model`/`opts.effort`), then the role table entry
`gsd.roles[<role>]` when the call names a role (`--role`, `role=`, `opts.role`), then the agent definition's
`model:` (its tier's thinking for effort), then `default_tier`. A role name that is neither a GSD role nor a key of
`gsd.roles` is an error.

Adding or switching a model: add it to the Paseo provider catalogue (Paseo's own configuration), set the tier's
`provider` in `.agents/harness.config.json`, and check the tier line of `ph doctor` (it reports a model the provider
does not offer).

## 4. What ph adds to every agent prompt

The prompt an agent receives is built in this order, parts joined by a `---` line:

1. With `--type {name}` / `opts.agentType`: `Your role ({name}), complete below:` followed by the definition body
   (front matter removed). The file path is not named: agents that saw it opened and read the file again. Files
   listed under `include:` in the front matter (repo-relative: the role's skill, its references, contracts) follow
   in full, after the line "These files are already loaded in full below; do not open them and do not call the
   Skill tool for them." Prompts and definitions then say "follow X (in your prompt)", never "read X first" (owner
   2026-10-03: every ux-designer called the Skill tool and read two references).
   **Role priming and warm-up** are available and off by default (`prime_role: "two-turn"`, `warmup: true`). A
   primed workflow worker first receives role, includes and the safety notes, and replies READY before receiving its
   task. Priming is an executable model turn, not inert preloading. Keep or change it only after measuring
   completed-task cost, cache fields and latency on the actual deployment. `ph spawn`/`fanout` are not primed.
2. The prompt itself.
3. Runtime notes, in this order:
   - workflow agents: "Your final message is the return value for the orchestrating script, not a message to a
     person: return only the data asked for."; all others: "Work silently: no narration, plans or commentary
     between tool calls (nobody reads them); only your final reply, in the format asked for."
   - persistent teammates (`ph spawn`, `ph fanout` without `--collect`) get their name, the leader, and the full
     `ph task` and `ph send` commands (with the `--ws` path when given; see section 7).
   - read-only roles: "Read-only role: do not create, edit, move or delete files, except output files this prompt
     names."
   - worktree isolation: the worktree path and branch, and "edit files only there"; else `--cwd` / `opts.cwd`:
     "Your working directory for this task is ..." (section 10 explains why this is an instruction).
   - the kit's first-prompt note (batch file tools, UTF-8 for files written by scripts, never message the main
     session from a worker, write long documents in parts), then config `project_prompt_note`, then the platform
     note for the machine's OS (`platform_notes`).
   - workflow agents: `Run <runId> #<n> (bookkeeping only; ignore).`, which ties transcripts to runs.

The file I/O rules live in the kit block of the project's `AGENTS.md`, which every session reads (Claude Code
through the `@AGENTS.md` import in `CLAUDE.md`), so agents and the orchestrating session share one text; agent
definitions, skills and workflow prompts must not repeat it. Task-specific reading rules belong to the role's
skill. Agents are Claude Code sessions, so they also load the project's `CLAUDE.md` and `.claude/skills/` on their
own; do not paste those into prompts.

## 5. Commands

`NAME|ID` accepts an agent title (exact, unique among the caller's live subagents, then the leader's), a full
agent id or a unique id prefix of at least 6 characters. Every command prints one line per item; a failing item
prints `failed <what>: <error>` and the others go on. Exit codes: `0` all good, `1` usage or configuration error
(`usage error: ...` / `failed: ...`, nothing done), `2` done with problems (some items failed).

| Command | Does | Prints |
| --- | --- | --- |
| `ph doctor` | checks Node, `PASEO_AGENT_ID`, the config, the Paseo CLI and daemon, every tier's model, the overlay, the file mod and the provider tool denies; continues past every problem | one `ok`/`problem`/`note` line per check |
| `ph config` | effective configuration with its sources | JSON |
| `ph spawn --name N (--prompt T \| --prompt-file F) [--count K] [--type T] [--role R] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--worktree]` | starts a persistent named agent (mode B) or K numbered ones (`N-1..N-K`); returns at once. Names are at most 60 characters and unique among live subagents. `--ws`: the team's workspace directory, written into the teammate note. `--worktree`: a new git worktree `<worktree_dir>/<name>-<stamp>` on branch `harness/<name>-<stamp>` for this agent. | `<id> <name>`, then the `next:` wait hint |
| `ph fanout --file F [--type T] [--role R] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--collect DIR] [--keep]` | one agent per block of F (format below). Without `--collect`: a team launch of persistent named agents; returns at once (refused beyond `max_subagents`). With `--collect`: one-shot agents (mode C), at most `max_subagents` running at once; waits for all, writes each final reply to `DIR/<name>.md` and its `ph result --json` object (usage, cost, durations, skills) to `DIR/<name>.json`, then archives them unless `--keep` (archived agents cannot be read again) | `<id> <name>`; with `--collect` also `collected <name> -> <file>` or `failed <name>: <reason>` |
| `ph send (--prompt T \| --prompt-file F) [--now] NAME\|ID...` | sends a follow-up message; an agent that is running gets it when its turn ends, so the command waits for that; `--now` interrupts the running turn first and delivers at once (the agent keeps its context). Batch follow-ups and send when the agent is idle. | `sent <name>`, then the `next:` wait hint |
| `ph watch NAME\|ID...` | waits until each agent is idle; run under Monitor | `idle <name> <id8> out_tokens=<n> context_tokens=<n> duration_s=<s>` (values of the turn that just finished; `?` when not reported) or `failed <name> <id8>: <reason>`, then `watch done: <k> idle, <m> failed` |
| `ph result [--json] NAME\|ID...` | each agent's final reply (the upstream `Agent` return value) | text (a `## <name>` header per agent when several), or one JSON line per agent `{id, name, status, model, final, usage, tokens, costUsd, reportedCostUsd, durationS, lastTurnS, skills}`; `tokens` = `{turns, input, cachedInput, output}` summed over every turn, only when this `ph` process followed the agent from its creation (`fanout --collect`, workflows), else `null`; `costUsd` comes from the project's `.agents/model-prices.json` (`null` without it) |
| `ph team` | the caller's live subagents | `<id8> <status> <context%> <provider>/<model> <name>` |
| `ph context [--self] [--rotate-pct N] [NAME\|ID...]` | context-window use of yourself (`--self`), the named agents, or all own subagents | `<id8> <pct>% <used>/<max> <status> <name>`, plus `ROTATE` at or above N % (default `context_guard.start_pct`) |
| `ph compact-self [--focus T] [--resume T] [--agent ID]` | arms a detached watcher that sends `/compact [T]` once the agent's current turn ends, confirms it, then sends the resume message (section 11); end your turn right after | `compact armed for <id8> ...` |
| `ph stop NAME\|ID...` | interrupts the running turn (upstream `TaskStop`) | `stopped <name>` |
| `ph archive NAME\|ID...` / `--idle [--name-prefix P]` / `--name-prefix P` / `--run RUNID [--runs-dir D]` | archives agents; `--idle` = own subagents not running; `--run` = stop that workflow's runner if alive, archive its agents, mark run.json stopped | `archived <k> of <n> agents` |
| `ph task ...` | shared task list (section 7) | |
| `ph freeze ...` | artifact freeze (section 8) | |
| `ph workflow (--script F \| --name N \| --resume RUNID) [--args JSON \| --args-file F] [--budget 500k] [--runs-dir D] [--detach]` | runs a workflow script (section 6); `--name N` = `.agents/workflows/N.js` | progress lines, then `workflow done <runId>: <file> (...)` or `workflow failed <runId>: <error>` |
| `ph watch-run RUNID... [--all] [--from-start] [--runs-dir D]` | follows the log of workflow runs and exits when every run has ended; run it under Monitor | `log` / `phase` / `agent done ... null` / `workflow` lines (`--all`: every line) |
| `ph run-stats RUNID... [--transcripts] [--runs-dir D]` | wall time, tokens, cost and per-agent seconds of finished runs; `--transcripts` adds tool-call counts per kind | a block per run |
| `ph runs [--prune] [--runs-dir D]` | lists runs newest first; `--prune` deletes finished runs beyond the newest `runs_keep`, never failed or running ones | `<runId> <status> <startedAt> <name>` |
| `ph worktrees [--prune] [--runs-dir D]` | the harness worktrees under `<repo>/<worktree_dir>` (branches `harness/*`) with owner and state; `--prune` removes only those whose owner is finished, with no uncommitted or untracked files and no commit missing from HEAD, plus records whose directory is gone; unmerged work is never deleted. An owner that cannot be checked keeps its worktree | `<state> <branch> <path> (<owner>)` |
| `ph harness lint [--all]` | checks the generated adapter and the assets it names (`references/kit-adapter.md`) | one finding per line |

`fanout` file format: an optional preamble (prepended to every prompt), then one block per agent starting with
`=== <name>`; optional `key=value` words after the name override the command options for that block:
`type=<agent type>`, `role=<role>`, `model=<tier or provider/model>`, `effort=<id>`, `read-only=true`.

```
Shared instructions for every agent ...
=== security-review type=reviewer model=pro
Review src/auth/ for ...
=== perf-review type=reviewer
Review src/db/ for ...
```

## 6. Workflow scripts (mode A)

Run a workflow only when the user asked for orchestration or invoked a skill or GSD command that names
`ph workflow`; that invocation counts as the request.

### 6-1. Script format

The script file is plain JavaScript (no TypeScript) and starts with a pure-literal `meta` (no variables, calls,
spreads or template interpolation):

```javascript
export const meta = {
  name: 'domain-run',                       // required
  description: 'one line',                  // required
  phases: [{ title: 'Collect', detail: '...' }, { title: 'Verify' }],   // optional
}
phase('Collect')
const found = await pipeline(args.items, item => agent(`... ${item} ...`, { schema: FINDINGS }))
return { found: found.filter(Boolean) }    // top-level await and return are allowed
```

The body runs in an async context. Available: the globals below and standard JavaScript built-ins; `console.log`
and friends map to `log`. Not available: files, network, `require`/`import`, `process`, and `Date.now()`, argless
`new Date()`, `Math.random()` (they throw, because they would break resume; pass timestamps through `args` and vary
prompts by index instead). Host commands run only through `shell()`.

### 6-2. Globals

| Global | Behaviour |
| --- | --- |
| `agent(prompt, opts?)` | starts one Paseo agent and resolves to its final reply as a string, or with `opts.schema` to the validated object. Resolves to `null` (never rejects) when the agent fails, times out, its output never matches the schema, or its type, includes or model cannot be resolved; the reason is journaled. Throws when the budget or the per-run agent cap is exhausted, the schema itself is invalid, or an option is unknown or unsupported (e.g. an isolation other than `"worktree"`); these are configuration errors: a direct `await` fails the workflow, while inside `parallel()`/`pipeline()` the combinator turns them into a `null` item. The agent is archived when the call ends unless `opts.keep` or `opts.session`. |
| `pipeline(items, stage1, stage2, ...)` | each item runs through all stages on its own, with no barrier between stages. Every stage gets `(previousResult, originalItem, index)`. A stage that throws turns that item into `null` and skips its remaining stages; a stage that returns `null` passes `null` to the next stage. Resolves to one result per item. Default for multi-stage work. |
| `parallel(thunks)` | runs `() => Promise` functions concurrently and waits for all (a barrier). A thunk that throws resolves to `null`; the call never rejects. Use only when the next step needs all results together. |
| `phase(title)` | starts a progress group; later `agent()` calls without `opts.phase` belong to it. A title missing from `meta.phases` is logged as a warning. |
| `log(message)` | prints a progress line `log <message>` |
| `args` | the value of `--args` / `--args-file`, verbatim JSON (`undefined` if none) |
| `budget` | `{total, spent(), remaining()}`. `total` is `null` without `--budget`. `spent()` = output tokens of every finished turn of this run's agents, plus the orchestrator's own turns that finish while the run is going. `remaining()` = `max(0, total - spent())`, or `Infinity` without a budget. Once spent reaches total, further `agent()` calls throw. |
| `workflow(nameOrRef, args?)` | runs another script inline and returns its return value. `nameOrRef` is a name (`.agents/workflows/<name>.js`) or `{scriptPath}`. The child shares the concurrency cap, agent counter, journal and budget. Nesting is one level: `workflow()` inside a child throws. |
| `shell(cmd, opts?)` | runs a host command: a string through the platform shell, or an argv array `[file, ...args]` without a shell (the form for adapter commands). Options `cwd`, `input`, `timeoutS` (default `wait_timeout_s`), `tailChars`. Resolves `{code, stdout, stderr, durationS}` and never rejects; `code` is -1 when the process could not start or timed out. Never cached: a resumed run reruns it. |

`agent()` options:

| Option | Meaning |
| --- | --- |
| `label` | display name; the agent title is `<meta.name>:<label>` |
| `phase` | progress group for this call (use inside `pipeline()`/`parallel()` stages instead of the global `phase()`) |
| `schema` | JSON Schema with `{type: 'object', properties: {...}}` at the root and `required` a subset of `properties`; supported keywords: `type`, `properties`, `required`, `additionalProperties` (boolean), `items`, `enum`, `const`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems` and the annotations `description`, `title`, `default`, `examples`; any other keyword throws |
| `agentType` | custom agent type, `.agents/agents/<name>.md` |
| `role` | GSD role name; selects the `gsd.roles` entry (section 3) |
| `model` | tier name or `provider/model`; default: the role entry, then the agent type's `model:`, else config `default_tier` |
| `effort` | thinking option: `off`, `low`, `medium`, `high`, `xhigh`, `max` |
| `isolation` | `'worktree'`: a fresh git worktree per agent, kept after the run for the orchestrator to merge (expensive; only for parallel file edits that would conflict); after merging, `ph worktrees --prune` removes the merged, clean ones |
| `readOnly` | `true` adds the read-only note |
| `cwd` | working directory for the task, given to the agent as an instruction (section 10); default: the project root |
| `keep` | `true` leaves the agent unarchived (for a follow-up with `ph send`) |
| `session` | a key: the first call creates the agent, later calls with the key send their prompt to the same agent; its type, role, read-only flag, cwd and isolation cannot change; run end archives it unless `keep` |

### 6-3. Concurrency and caps

At most config `max_subagents` agents of the caller are running at once, the run's own and the caller's other
subagents counted together; extra `agent()` calls queue (`log waiting for a free agent slot ...`). A call that
creates an agent also needs a live slot (`max_live_subagents`). One run (including nested workflows) starts at
most `max_agents_per_workflow` agents; one `parallel()`/`pipeline()` call takes at most 4096 items.

Limits learned on the owner's machine (2026-10-04, 32 GB RAM):

- Each agent is a Claude Code process, about 350 MB; 30 at once left 5 GB free and the runner died out of memory.
  Keep `max_subagents` at 20 unless RAM is free; agents of a killed runner stay alive (idle) until archived, so
  run `ph archive --run <runId>` after stopping a run.
- A prompt above `max_prompt_bytes` is refused (`null`): the daemon closes a client socket that falls behind its
  outbound high-water mark, and a 42 MB prompt triggered it.
- An agent's read tools fail on very large files (a 15 MB JSON broke every later read of that agent). Give agents
  per-item extracts (one brief per family, module or screen), not a whole corpus file.

### 6-4. Failures

An agent turn that ends in a transient error is continued in the same agent after a pause, except when the error
says the quota, authentication, credit, billing or permission is the cause: the same request would fail again and
only burn the remaining quota. Every `null` is written to the journal with its reason, and the progress line
`agent done ... null (<reason>)` shows it, so filter results with `.filter(Boolean)` and `log()` how many were
dropped.

Watchdog (workflow agents only; `watchdog_enabled`). Time is the agent's own model time since the last prompt the
runner sent it: tool execution time (from the moment a call's input is complete until it completes; overlapping
calls once) is subtracted, and each prompt resets it (the watchdog's own messages do not). Behaviour checks send one
specific message each per prompt: the same tool with the same input `watchdog_repeat_calls` (3) times (`loop`), one
file read `watchdog_same_file_reads` (3) times (`reread`), `watchdog_reads_without_write` (15) reads or searches
without a write (`piecemeal`). After `agent_nudge_s` (900) of model time the agent gets one steering message to
finish (`log watchdog: ... nudged`); after `agent_stop_s` (1800) it is archived and its `agent()` returns `null`
with reason `watchdog stopped the agent after <N> s`. Read the agent's activity before resuming: a stopped agent
usually needs a smaller task or a script, not a rerun. A single tool call that runs longer than
`agent_file_tool_stuck_s` (180, file tools) or `agent_tool_stuck_s` (900, shell and other tools) is interrupted
once with a retry message; a second hung call stops the agent. A loop count resets after every write
(check → fix → check is progress). `0` disables a limit.

The runner does not reconnect to the daemon. After the first `Transport closed`/`Transport not connected` error it
logs `runner lost the daemon connection` and every later `agent()` returns `null` at once (no orphan agents).
Archive the run's agents and resume the run.

### 6-5. Run directory

`--runs-dir` (default `_workspace/_runs`) holds one directory per run, `<runId>` = `wf_<yyyymmdd>-<hhmmss>_<4 hex>`:

| File | Content |
| --- | --- |
| `script.js`, `args.json` | the exact script and args of this run |
| `run.json` | runId, parent runId (resume), script, status (`running`, `done`, `failed`, `stopped`), start and end times, agent counts, runner pid |
| `journal.jsonl` | a `start` line when a call is admitted, then one line per finished `agent()` call: n, key, occ, label, phase, agentId, model, status (`ok`/`null`/`cached`), reason, result, tokens, usage, duration_s; plus `shell` lines |
| `log.txt` | every progress line |
| `result.json` | the script's return value |

Before diagnosing an empty or odd result, read `journal.jsonl`: it records what each agent really returned.

### 6-6. Resume

`ph workflow --script <file> --args-file <file> --resume <runId>` starts a new run whose `agent()` calls with unchanged
`(prompt, schema, agentType, model, effort, isolation, readOnly, cwd)`, unchanged role text (definition body and
included files) and the same resolved model and effort return the earlier run's result at once (the n-th identical
call maps to the n-th earlier one). Changed, new or earlier-`null` calls run live. The same script and args resume
to a 100 % cache hit. Edit the script file and resume to rerun only what changed. Without `--script`/`--name`, the
resumed run's own `script.js` is rerun; without `--args`/`--args-file`, its `args.json` is reused, so
`ph workflow --resume <runId>` alone repeats the earlier run (for example after quota came back).

### 6-7. Running a workflow from the orchestrator

A workflow can run for a long time, so start it detached and watch its log:

1. `ph workflow --script <file> --args-file <file> --detach` prints `workflow started <runId>: <runDir>/log.txt`
   and a `next:` line, and returns.
2. Watch with the Monitor tool (re-arm after its timeout; a Monitor timeout does not stop the workflow):
   `ph watch-run <runId> [<runId> ...]`, which prints the log, phase, failure and workflow lines and exits when every
   run has ended (a `tail -f` watcher never exits and keeps the Monitor alive until its timeout).
   Progress lines: `workflow start <runId> <runDir>`, `phase <title>`, `log <message>`,
   `agent start #<n> <label> <id8> <model>`, `agent done #<n> <label> ok|null (<reason>) tokens=<n> cost=<usd|?> <s>s`,
   `agent cached #<n> <label>`, `shell start|done #<n> ...`, and the final `workflow done <runId>:
   <runDir>/result.json (ok <k>, null <m>, cached <c>, tokens <t>, cost $<x>)` or `workflow failed <runId>: <error>`.
3. On `workflow done`, read `<runDir>/result.json`; on `workflow failed`, read `journal.jsonl` and `log.txt`.

Without `--detach` the command runs in the foreground and prints the same lines.

## 7. Shared task list (mode B)

`<workspace>/tasks.json` (normally `_workspace/tasks.json`) is changed only through `ph task` (a lock file keeps
parallel updates safe), by the leader and by teammates:

| Command | Prints |
| --- | --- |
| `ph task add --ws D --title T [--assignee NAME] [--depends-on 1,2] [--notes T] [--status S]` | `task <id> added` |
| `ph task update --ws D ID [--status S] [--assignee NAME] [--notes T] [--title T] [--depends-on 1,2 (replaces; "" clears)]` | `task <id> <status>` |
| `ph task list --ws D [--assignee NAME] [--status S]` | `<id> <status> <assignee> <title>` plus `after <ids>` and `READY` (pending, all dependencies completed) |
| `ph task get --ws D ID` | the task as JSON |

Statuses: `pending`, `in_progress`, `completed`, `blocked`. Teammates are told the workspace path and to update
their own tasks; the leader checks `ph task list` after each `ph watch` line.

Teammate messages: a teammate may message another teammate with `ph send --prompt "..." <teammate>`; names are
resolved among the caller's subagents, then the leader's. Upstream's default still applies: the leader relays
between teammates and the content travels in files.

## 8. Artifact freeze

`ph freeze --ws D --phase P` records the SHA-256 of every `D/P_*` file in `D/freeze_P.sha256`.
`ph freeze --check --ws D --phase P` recomputes them and prints `freeze ok P: <n> files` (exit 0) or
`freeze CHANGED P: modified <file>; missing <file>; new <file>` (exit 2). New version files such as
`P_<agent>_<artifact>_v2.md` show up as `new`.

## 9. Waiting for agents

`ph spawn`, `ph send` and `ph fanout` (without `--collect`) return at once and print a `next:` line: run that
`ph watch <names>` under the Monitor tool: each finished agent is one event line, and the command exits when all
are idle (Monitor timeout: re-arm; it does not affect the agents). `ph fanout --collect` runs in the foreground and
returns when every reply is collected. Do not poll `ph team` or a log in a sleep/grep loop. A Paseo agent that ends
its turn to wait for a background command is not woken when the command finishes, so subagents run their own
builds and tests in the foreground.

## 10. Known limits

- **Definition tools and read-only roles are advisory** unless the Paseo version accepts per-agent tool denies, in
  which case read-only agents are also created without the editing tools (`ph doctor` tells). The definition's
  `tools:` list does not grant tools or create a sandbox. Read-only means "change no files": such an agent may run
  non-mutating lint/tests/verifiers and delivers its report in its final reply, which the caller writes. Where
  reviewer writes would do harm, freeze inputs (`ph freeze`) and check them afterwards.
- **Workflow scripts are trusted code.** The script context is not a security boundary: a script can reach the
  harness process, `shell()` runs host commands on purpose, a busy loop hangs the runner (there is no body timeout),
  and calls the script does not await are awaited before "workflow done" and logged as a warning. Write scripts
  like code you run and await every `agent()`.
- **Resume reuses results by prompt, options, role text and resolved model.** Changing the config elsewhere (for
  example `mode` or the first-prompt notes) does not invalidate cached calls; start a new run after such changes.
- **Runner bookkeeping.** run.json records the runner's `pid`; `ph watch-run` ends with "workflow interrupted" when
  that process is gone without a terminal status, and `ph archive --run <runId>` stops a live runner, archives the
  run's agents and marks the run stopped. Every task message ends with the runtime note `Run <runId> #<n>` so
  `ph run-stats --transcripts` matches transcripts to runs exactly.
- **Working directory.** Paseo starts every subagent in the orchestrator's workspace directory and may ignore a
  requested cwd (verified 2026-10-03 on Paseo 0.10.0). `--cwd`, `opts.cwd` and worktree isolation therefore tell the
  agent its directory in the prompt (run shell commands there, use absolute paths), and `ph` still passes the cwd.
  Run the orchestrator from the project root; `ph` refuses a caller working outside it.
- **Token usage is live-only.** The daemon keeps only an agent's last turn and stores no per-turn history; the
  per-turn numbers exist only as `turn_completed` stream events. `ph` therefore subscribes when it creates an agent
  and adds every turn up. Turns that end in an error or are interrupted report no usage, so their tokens are not
  counted. `budget` is checked before each new `agent()` call, so agents already running can take `spent()` past
  `total`.
- **Messages wait for an idle agent.** `ph send` to a running agent waits until its turn ends, then delivers, so a
  message never interrupts work in progress; `ph send --now` (or `ph stop` then `ph send`) interrupts on purpose.
- **Workspace.** Agents join the orchestrator's Paseo workspace and run in the project root unless `--cwd`,
  `opts.cwd` or worktree isolation say otherwise.

## 11. Self-compaction

The orchestrator compacts itself instead of asking the owner to type `/compact` (owner 2026-10-02). Verified
2026-10-03 on a Luna agent: 46,056 -> 946 used tokens, the agent woke on the resume message and still knew its
earlier answer.

1. You do not have to remember to check: the kit's context-guard hook in `.claude/hooks/` reads the session's last
   usage and injects a reminder once the context passes config `context_guard.start_pct` (60 %) of `window_tokens`,
   then again every `step_pct` (5 %). It watches the main conversation; `ph` workers do not get it. `ph context
   --self` reports usage on demand. On a reminder, compact at the next natural break (no edit in progress), or
   earlier before a phase that would pass about 80 %.
2. Stop Monitors and background commands: a notification that arrives during the compaction cancels it.
3. Run `ph compact-self --focus "<what the summary must keep>"` and end the turn at once.
4. The detached watcher (log `<tmp>/ph-compact-<id8>.log`) waits until the turn ends, sends `/compact`, and counts
   it as done only when used tokens fall below half of the value before; then it sends `compact_resume` (or
   `--resume`). Otherwise it sends a "NOT confirmed" message and does not retry; decide yourself whether to run it
   again. `--agent ID` compacts a long-running subagent instead (fresh agents with a handoff are usually better).
   One watcher per agent: a second `compact-self` while one is armed is refused.
