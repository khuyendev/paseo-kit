# Paseo runtime — how a harness runs on Paseo agents

Every harness built with this skill runs its agents as **Paseo agents**, driven by one command-line tool. This
document is the runtime contract: what each Claude Code primitive of upstream Harness v2 became, the commands,
the workflow-script API, and the known limits. The method (phases 0-7, execution modes, team patterns, quality
patterns) does not change; only the runtime does.

`ph` below always means `node .agents/skills/harness/scripts/paseo_harness.mjs`, run from the project root.
Generated orchestrator skills write the full command, not `ph`, so they can be copied and run as they are.

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
| The orchestrating session runs inside Paseo (env `PASEO_AGENT_ID` is set) | Every agent is created as the caller's subagent (label `paseo.parent-agent-id`) in the caller's workspace. Without a caller `ph` refuses to spawn, so no stray workspace or project is created. | `ph doctor` |
| Paseo CLI installed with npm (`npm i -g @getpaseo/cli`; tested with 0.10.0) and the daemon running | `ph` loads the CLI's own daemon client and its structured-output loop | `ph doctor` |
| Node.js 20.17 or newer with `path.matchesGlob` | runtime language; the file backend's glob search | `ph doctor` |
| Batch file tools are available to agents: in Claude Code the `harness-files` mod (`mcp__harness-files__read_ranges`, `edit_multiple_files`, `write_multiple_files`; enabled with `install.mjs update <project> --enable-plugin`), for other harnesses the legacy fsbatch/filesystem MCP servers that `ph` attaches from `<kit>/machine.local.json` (written by `node <kit>/machine.mjs apply`) | Agents read many files in one call and edit or write many files in one call. One tool call per file costs one model turn per file. | `ph doctor` (mod readiness, legacy adapter file) |

## 2. Primitive map

| Upstream (Claude Code) | Paseo edition | Notes |
| --- | --- | --- |
| `Workflow` tool with a script (`agent`, `pipeline`, `parallel`, `phase`, `log`, `args`, `budget`, `workflow`) | `ph workflow --script <file.js>`: the same JavaScript API, every `agent()` is one Paseo agent | section 6 |
| `agent(prompt, {schema})` returning a validated object | Paseo structured output: the agent's final message must be JSON matching the schema; it is validated (Ajv) and on mismatch the same agent is asked again with the errors (config `schema_retries`) | `null` after the last retry |
| `opts.agentType` / `subagent_type: "{name}"` | `--type {name}` / `opts.agentType`: the body of `.agents/agents/{name}.md` is put in front of the prompt; its `model:` picks the tier | section 4 |
| `model: fable / opus / sonnet` | harness-neutral tier names `frontier` / `pro` / `standard` (the upstream names still work: config `tier_aliases`), mapped to real Paseo provider/models by `.agents/harness.defaults.json` `tiers` | section 3 |
| `opts.effort` | Paseo thinking option (`low`, `medium`, `high`, `xhigh`, `max`); clamped to the nearest option the model supports | |
| `opts.isolation: 'worktree'` | `git worktree add` under `.claude/worktrees/` on a new branch; the agent is told to work only there | needs a git repository; see section 10 (working directory) |
| `resumeFromRunId` | `ph workflow --script <file> --args-file <file> --resume <runId>`, or `ph workflow --resume <runId>` alone to rerun that run's own script and args | section 6-6 |
| `Agent(name: "x", ...)` (persistent, named) | `ph spawn --name x ...` | the agent keeps its context |
| several `Agent(name: ...)` calls in one message (team launch) | `ph fanout --file F` without `--collect`: one persistent named agent per block, started in parallel | |
| `SendMessage({to: "x"}, ...)` | `ph send --prompt "..." x` (or `--prompt-file`) | delivered when `x` is idle (section 10) |
| completion notification of a named agent | `ph watch x ...` run under the Monitor tool, one line per agent | section 9 |
| one-shot `Agent` calls in one message | `ph fanout --file F --collect <dir>`: one agent per block, waits, writes each final reply to `<dir>/<name>.md` and its `ph result --json` object to `<dir>/<name>.json`, archives | or `ph spawn` + `ph watch` + `ph result` |
| return value of an `Agent` call | `ph result x [y ...]` (final reply); `--json` prints one JSON line per agent with status, usage, duration, skills used | Paseo keeps this until the agent is archived |
| `total_tokens` of a finished subagent, budget accounting | the usage Paseo reports for every finished turn (`turn_completed` stream event), added up by `ph` from the moment it creates the agent | section 6-2 `budget`, section 10 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | `ph task add` / `update` / `list` / `get` on `<workspace>/tasks.json` | section 7 |
| `TaskStop` | `ph stop x` (interrupts the current turn) | |
| agents end by themselves | `ph archive x ...` or `ph archive --idle` when their work is closed | archived agents disappear from the Paseo sidebar |
| `Read` / `Edit` one file per call | enabled direct file mod in Claude Code: batch ranges/edits/writes; other providers retain MCP compatibility adapters. Native tools remain available, subject to owner policy | AGENTS.md file I/O guidance |
| `general-purpose` type | no `--type`: an agent with all tools at the default tier | |
| `Explore` / `Plan` (read-only) types | no `--type` plus `--read-only` (advisory, section 10) | |
| `tools:` in an agent definition | advisory: listed in the prompt; a definition without `Edit` and `Write` makes the agent read-only (advisory) | section 10 |
| shell `shasum` for the freeze step | `ph freeze` (SHA-256, any OS) | section 8 |
| headless `claude -p` for trigger checks | `ph spawn` + `ph result --json` (field `skills`) or a workflow | skill-testing guide |

## 3. Configuration and model tiers

`.agents/harness.defaults.json` is the canonical shipped defaults file. Change project-specific values in
`.agents/harness.config.json`; `ph config` prints effective values and their sources.

The project overlay `.agents/harness.config.json` (paseo-harness-kit, 2026-10-06) holds the settings of one project
and is merged over `.agents/harness.defaults.json`, which holds the kit defaults and the machine settings and is replaced when
the kit is updated (`node <kit>/install.mjs update <project>`; the installer never overwrites the overlay). `tiers`,
`tier_aliases`, `modes`, `provider_features`, `platform_notes`, `context_guard`, `io_guard` and `read_limits` merge
per entry (an overlay tier adds a tier or replaces one); every other key replaces the kit value. Machine keys
`agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env`, `main_provider_disallowed_tools` and
`agent_mcp` are ignored in the overlay. `main_provider_disallowed_tools` (owner 2026-10-14: `Agent`, `Workflow`) is what
the main providers (the keys of `agent_providers`, e.g. `circle`) deny: Paseo and `ph` orchestrate, so a main session
spawns no native Claude subagents or workflows. `sync_agent_provider.mjs --apply` (run by `machine.mjs apply`) adds
missing entries without removing owner rules; `ph doctor` reports missing ones.
Runtime, hooks and file backends use `.agents/harness/config.mjs`, the one shared loader. Paseo credentials and
its tool/browser/skill selections remain in Paseo's own config; generated installation records are not policy.

**Any Paseo provider.** A tier or `--model` may name any Paseo provider: `circle/<model>` (Claude Code
through the Circle proxy, mapped to `circle-agent`), `codex/<model>`, `opencode/<model>`, `pi/<model>` or a custom
provider. Two keys make that work: `modes` maps a provider id to the Paseo session mode its agents start in (the ids
differ per harness; it must be a mode that never asks for permission; `mode` is the fallback), and the machine key
`agent_mcp` (`attach`, `skip_providers`) attaches the MCP servers in `<kit>/machine.local.json` (written by
`machine.mjs apply`: fsbatch and filesystem) to non-Claude agents. Claude agents use the enabled `harness-files`
mod rather than file MCP transport, with genuine native file tools retained as a fallback. Agent definitions
live in `.agents/agents/` (`.claude/agents/` is still read), skills in `.agents/skills/`; `ph skills-sync` links each
skill into `.claude/skills/` for Claude Code. Provider-specific parts (tool limits, hooks, transcript statistics)
are adapters: today only the Claude Code ones exist (`agent_provider_disallowed_tools`, `.claude/hooks/`,
`run_stats.mjs`).

| Key | Default | Meaning |
| --- | --- | --- |
| `tiers` | `frontier` and `pro` = Opus 5.5, thinking `high`; `standard` = GPT-6.1 Sol, thinking `low` (provider `circle`; any Paseo provider/model works); fast mode off unless a tier sets `features.fast_mode` |
| `tier_aliases` | `fable` -> `frontier`, `opus` -> `pro`, `sonnet` -> `standard` | other names accepted wherever a tier is |
| `platform_notes` | `win32`: the PowerShell encoding warning | added after `first_prompt_note` on a machine whose `process.platform` matches | each tier name maps to `{"provider": "<provider>/<model>", "thinking": "<id>", "features": {"<feature id>": <value>}}`; `features` (optional) are Paseo agent features set when the agent is created, e.g. `fast_mode`. Paseo has no Fable model, so `fable` uses the strongest available model. Verification, judging and design stages use the `opus` tier (`model-selection-guide.md`). |
| `default_tier` | `standard` | tier when neither the call nor the agent definition names one (upstream rule: when unsure, standard) |
| `mode` | `bypassPermissions` | Paseo session mode of every agent. Agents run unattended, so a mode that asks for permission stalls them. |
| `allowed_models` | `[]` (any) | if not empty, the only `provider/model` ids `ph` will start |
| `max_subagents` | `20` (2026-10-04: 30 at once exhausted 32 GB RAM, section 6-3) | most agents of this orchestrator running at once (spawn refuses beyond it; workflows queue beyond it) |
| `max_agents_per_workflow` | `1000` | runaway-loop backstop for one workflow run including nested workflows |
| `wait_timeout_s` | `3600` | longest single agent turn before the wait counts as failed |
| `schema_retries` | `2` | extra attempts in the same agent when its JSON does not match the schema |
| `prime_role` | `"two-turn"` | workflow agents with a type get the role block alone as their first message (reply READY), then the task; `"off"` pastes the role in front of the task (section 4) |
| `warmup` / `warmup_s` / `warmup_timeout_s` | `true` / `8` / `90` | the first agent of a run × type × model starts alone; the rest wait for its role turn (or `warmup_s` without priming), at most `warmup_timeout_s` |
| `first_prompt_note` | owner text | one line appended to every first prompt (a project replaces it in its overlay) |
| `compact_resume` | generic text | message `compact-self` sends after a confirmed compaction to wake the agent (section 11) |
| `context_guard` | `window_tokens` 1000000, `start_pct` 60, `step_pct` 5 | reminds the main conversation, independent of model; native child identity and `ph` worker environment suppress it (section 11) |

`--model` and `opts.model` accept a tier name or an explicit `provider/model` id. Choose tiers with
`model-selection-guide.md`.

Adding or switching a model (the Paseo provider catalogue in `~/.paseo/config.json`, `paseo daemon reload`, the probe,
and the resume-cache effect): follow the step list `_model_flow` at the top of `.agents/harness.defaults.json`; it is the single
place that describes the whole flow.

## 4. What ph adds to every agent prompt

The prompt an agent receives is built in this order:

1. With `--type {name}` / `opts.agentType`: `Your role ({name}), complete below:` followed by the definition body
   (front matter removed). The file path is not named: agents that saw it opened and read the file again. If the
   front matter has `tools:` without `Edit` and `Write`, the read-only note is added; the list itself is not shown
   (the file tools are named in the kit block of `AGENTS.md`). Files listed under `include:` in the front matter (repo-relative:
   the role's skill, its references, contracts such as HUB-CONV) follow in full, after the line "These files are
   already loaded in full below; do not open them and do not call the Skill tool for them." Prompts and definitions
   then say "follow X (in your prompt)", never "read X first" (owner 2026-10-03: every ux-designer called the Skill
   tool and read two references).
   **Role priming and warm-up** remain available (`prime_role: "two-turn"`, `warmup: true`). A typed workflow
   worker first receives role/includes plus scope and safety constraints, and replies READY before receiving its task.
   Each fully rendered role/task/schema message is size-checked before sending. Priming is an executable model turn,
   not inert preloading; constraints must already apply during that turn. The warm-up gate is per run/type/model,
   released after the first role turn or by the configured timeout. `ph spawn`/`fanout` are not primed.
   This behavior originated in 2026-10-04 cache experiments. Those historical savings are not a guarantee for current
   proxies/models; scope and worktree notes can differ between workers. Keep or change priming only after measuring
   completed-task cost, cache fields and latency on the actual deployment.
2. The prompt itself.
3. Runtime notes:
   - workflow agents: "Your final message is the return value for the orchestrating script, not a message to a
     person: return only the data asked for." With a schema, the JSON-schema instruction follows.
   - other agents: "Work silently: no narration between tool calls; only your final reply, in the format asked
     for."
   - persistent teammates (`ph spawn`, `ph fanout` without `--collect`) also get their name, the leader, the
     project root, and how to use `ph task` and `ph send` (with the `--ws` path when given; see section 7).
   - The file I/O rules are not a runtime note any more (owner 2026-10-04): they live in the "File I/O"
     kit block of the project's `AGENTS.md`, which every harness reads (Claude Code through the `@AGENTS.md` import in `CLAUDE.md`), so agents and the orchestrating session share one
     text, and agent definitions, skills and workflow prompts must not repeat it. Task-specific reading rules belong
     to the role's skill (e.g. ux-design critique and spec-review read the whole doc under review). The PreToolUse
     hook `.claude/hooks/io_economy_guard.mjs` (config `io_guard`: `start_rounds` 2, `step_rounds` 2, and the same
     for edit rounds) reminds any session after that many consecutive lookup-only or edit-only tool rounds.
   - file tools: in Claude Code, the explicitly enabled `harness-files` mod
     registers batch and filesystem tools directly, without filesystem MCP servers. Names retain the engine's
     `mcp__harness-files__` prefix. Native Read/Edit/Write remain available for native read-state, media and helper
     loops; the old file-blocking hook is a no-op compatibility entry point and is not registered by new installs.
     Non-Claude providers retain MCP adapters to the same file core. If the mod is inactive, `doctor` reports it
     and native tools remain usable. Owner-selected Paseo tool/browser/skill availability is not rewritten.
     Provider sync preserves owner-added rules; defaults no longer ship Paseo MCP filters or native file blockers.
     Config `agent_providers: {circle: circle-agent}` still maps `ph` tiers and explicit models to the worker provider.
     Delegation is not forced in a main session: use `ph` when requested or when an invoked project orchestrator
     requires it. Direct backend calls fail closed when they cannot preserve a native child loop's permission identity.
   - `--read-only`: "Read-only role: do not create, edit, move or delete files, except output files this prompt
     names."
   - worktree isolation: the worktree path and branch, and "edit only there"; `--cwd` / `opts.cwd`: "your working
     directory for this task is ..." (section 10 explains why this is an instruction).
   - config `first_prompt_note`.

Agents are Claude Code sessions (provider `circle`), so they also load the project's `CLAUDE.md` and
`.agents/skills/` on their own; do not paste those into prompts.

## 5. Commands

`NAME|ID` accepts an agent title (exact, unique among the orchestrator's live subagents), a full agent id or a
unique id prefix. Every command prints one line per item; a failing item prints `failed <what>: <error>` and
the others go on. Exit codes: `0` all good, `1` usage or configuration error, `2` some items failed.

| Command | Does | Prints |
| --- | --- | --- |
| `ph doctor` | checks Paseo CLI, daemon, `PASEO_AGENT_ID`, config models, and the agent provider's `disallowedTools` against config `agent_provider_disallowed_tools` | one `ok`/`problem` line per check |
| `ph config` | effective configuration | JSON |
| `ph spawn --name N (--prompt T \| --prompt-file F) [--type T] [--model M] [--effort E] [--read-only] [--ws D] [--cwd D] [--worktree] [--count K]` | starts a persistent named agent (mode B) or K numbered ones (`N-1..N-K`); returns at once. Names must be unique among live subagents. `--ws`: the team's workspace directory, written into the teammate note. `--worktree`: a new git worktree `.claude/worktrees/<name>-<stamp>` on branch `harness/<name>-<stamp>` for this agent. | `<id> <name>` |
| `ph fanout --file F [--type T] [--model M] [--effort E] [--read-only] [--ws D] [--collect DIR] [--keep]` | one agent per block of F (format below). Without `--collect`: a team launch of persistent named agents; returns at once (refused beyond `max_subagents`). With `--collect`: one-shot agents (mode C), at most `max_subagents` running at once; waits for all, writes each final reply to `DIR/<name>.md` and its `ph result --json` object (usage, durations, skills) to `DIR/<name>.json`, then archives them unless `--keep` (archived agents cannot be read again) | `<id> <name>`; with `--collect` also `collected <name> -> <file>` or `failed <name>: <reason>` |
| `ph send (--prompt T | --prompt-file F) [--now] NAME|ID...` | sends a follow-up message; an agent that is running gets it when its turn ends, so the command waits for that; `--now` interrupts the running turn first and delivers at once (the agent keeps its context) || --prompt-file F) NAME\|ID...` | sends a follow-up message; an agent that is running gets it when its turn ends | `sent <name>` |
| `ph watch NAME\|ID...` | waits until each agent is idle; run under Monitor | `idle <name> <id8> out_tokens=<n> context_tokens=<n> duration_s=<s>` (values of the turn that just finished; `?` when not reported) or `failed <name> <id8>: <reason>`, then `watch done: <k> idle, <m> failed` |
| `ph result [--json] NAME\|ID...` | each agent's final reply (the upstream `Agent` return value) | text (a `## <name>` header per agent when several), or one JSON line per agent `{id, name, status, model, final, usage, tokens, durationS, lastTurnS, skills}`; `usage` = the last turn's usage as the daemon keeps it (`inputTokens`, `cachedInputTokens`, `outputTokens`, `totalCostUsd` = the session's running cost, `contextWindowUsedTokens`); `tokens` = `{turns, input, cachedInput, output, costUsd}` summed over every turn, only when this `ph` process followed the agent from its creation (`fanout --collect`, workflows), else `null` |
| `ph team` | the orchestrator's live subagents | `<id8> <status> <context%> <model> <name>` |
| `ph context [--self] [--rotate-pct N] [NAME\|ID...]` | context-window use of yourself (`--self`), the named agents, or all own subagents | `<id8> <pct>% <used>/<max> <status> <name>`, plus `ROTATE` at or above N % (default 50) |
| `ph compact-self [--focus T] [--resume T] [--agent ID]` | arms a detached watcher that sends `/compact [T]` once the agent's current turn ends, confirms it, then sends the resume message (section 11); end your turn right after | `compact armed for <id8> ...` |
| `ph stop NAME\|ID...` | interrupts the running turn (upstream `TaskStop`) | `stopped <name>` |
| `ph archive NAME\|ID...` / `--idle [--name-prefix P]` / `--name-prefix P` / `--run RUNID` | archives agents; `--idle` = own subagents not running; `--run` = stop that workflow's runner if alive, archive its agents, mark run.json stopped. Agent names are at most 60 characters (Paseo keeps 60 of a title) | `archived <k> of <n> agents` |
| `ph task ...` | shared task list (section 7) | |
| `ph freeze ...` | artifact freeze (section 8) | |
| `ph workflow [--script F \| --name N] [--args JSON \| --args-file F] [--resume RUNID] [--budget 500k] [--runs-dir D] [--detach]` | runs a workflow script (section 6); `--name N` = `.agents/workflows/N.js`; needs `--script`, `--name` or `--resume` (section 6-6) | progress lines, then `workflow done <runId>: <file>` or `workflow failed <runId>: <error>` |
| `ph watch-run RUNID... [--all]` | follows the log of workflow runs and exits when every run has ended (same as `scripts/watch_run.mjs`; run it under Monitor) | `log` / `phase` / `agent failed` / `workflow` lines (`--all`: every line) |
| `ph run-stats RUNID...` | wall time, tokens, per-agent seconds and tool calls of finished runs (same as `scripts/run_stats.mjs`) | a table per run |
| `ph worktrees [--prune] [--runs-dir D]` | the harness worktrees under `<repo>/.claude/worktrees` (branches `harness/*`) with owner and state; `--prune` removes only those whose owner is finished (the workflow run is no longer running, the spawned agent is archived), with no uncommitted or untracked files and no commit missing from HEAD, plus records whose directory is gone; branches go with `git branch -d`, so unmerged work is never deleted. An owner that cannot be checked keeps its worktree | `<state> <branch> <path> (<owner>)`, then `worktrees: N listed, M removed` |

`fanout` file format: an optional preamble (prepended to every prompt), then one block per agent starting with
`=== <name>`; optional `key=value` words after the name override the command options for that block:
`type=<agent type>`, `model=<tier or provider/model>`, `effort=<id>`, `read-only=true`.

```
Shared instructions for every agent ...
=== security-review type=reviewer model=pro
Review src/auth/ for ...
=== perf-review type=reviewer
Review src/db/ for ...
```

## 6. Workflow scripts (mode A)

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

The body runs in an async context. Available: the globals below and standard JavaScript built-ins. Not
available: files, network, `require`/`import`, and `Date.now()`, argless `new Date()`, `Math.random()` (they throw,
because they would break resume; pass timestamps through `args` and vary prompts by index instead).

### 6-2. Globals

| Global | Behaviour |
| --- | --- |
| `agent(prompt, opts?)` | starts one Paseo agent and resolves to its final reply as a string, or with `opts.schema` to the validated object. Resolves to `null` (never rejects) when the agent fails after its retry, times out, or its output never matches the schema. Throws when the budget or the per-run agent cap is exhausted, the schema itself is invalid, or an option is unknown or unsupported (e.g. an isolation other than `"worktree"`); these are configuration errors: a direct `await` fails the workflow, while inside `parallel()`/`pipeline()` the combinator turns them into a `null` item. The agent is archived when the call ends unless `opts.keep`. |
| `pipeline(items, stage1, stage2, ...)` | each item runs through all stages on its own, with no barrier between stages. Every stage gets `(previousResult, originalItem, index)`. A stage that throws turns that item into `null` and skips its remaining stages; a stage that returns `null` passes `null` to the next stage. Resolves to one result per item. Default for multi-stage work. |
| `parallel(thunks)` | runs `() => Promise` functions concurrently and waits for all (a barrier). A thunk that throws resolves to `null`; the call never rejects. Use only when the next step needs all results together. |
| `phase(title)` | starts a progress group; later `agent()` calls without `opts.phase` belong to it. A title missing from `meta.phases` is logged as a warning. |
| `log(message)` | prints a progress line `log <message>` |
| `args` | the value of `--args` / `--args-file`, verbatim JSON (`undefined` if none) |
| `budget` | `{total, spent(), remaining()}`. `total` is `null` without `--budget`. `spent()` = output tokens of every finished turn of this run's agents, plus the orchestrator's own turns that finish while the run is going (upstream: one pool for the main loop and its workflows). The numbers are the usage Paseo reports per turn (`turn_completed`), which `ph` adds up from the moment it creates each agent. `remaining()` = `max(0, total - spent())`, or `Infinity` without a budget. Once spent reaches total, further `agent()` calls throw. |
| `workflow(nameOrRef, args?)` | runs another script inline and returns its return value. `nameOrRef` is a name (`.agents/workflows/<name>.js`) or `{scriptPath}`. The child shares the concurrency cap, agent counter, journal and budget. Nesting is one level: `workflow()` inside a child throws. |

`agent()` options:

| Option | Meaning |
| --- | --- |
| `label` | display name; the agent title is `<meta.name>:<label>` |
| `phase` | progress group for this call (use inside `pipeline()`/`parallel()` stages instead of the global `phase()`) |
| `schema` | JSON Schema with `{type: 'object', properties: {...}}` at the root and `required` a subset of `properties` |
| `agentType` | custom agent type, `.agents/agents/<name>.md` |
| `model` | tier name or `provider/model`; default: the agent type's `model:`, else config `default_tier` |
| `effort` | thinking option: `low`, `medium`, `high`, `xhigh`, `max` |
| `isolation` | `'worktree'`: a fresh git worktree per agent, kept after the run for the orchestrator to merge (expensive; only for parallel file edits that would conflict); after merging, `ph worktrees --prune` removes the merged, clean ones |
| `readOnly` | `true` adds the read-only note |
| `cwd` | working directory for the task, given to the agent as an instruction (section 10); default: the project root |
| `keep` | `true` leaves the agent unarchived (for a follow-up with `ph send`) |

### 6-3. Concurrency and caps

At most config `max_subagents` agents of the run are active at once; extra `agent()` calls queue. One run
(including nested workflows) starts at most `max_agents_per_workflow` agents; one `parallel()`/`pipeline()` call
takes at most 4096 items.

Limits learned on this machine (2026-10-04, 32 GB RAM):

- Each agent is a Claude Code process plus its MCP server processes, about 350 MB; 30 at once left 5 GB free and the
  runner died out of memory. Keep `max_subagents` at 20 unless RAM is free; agents of a killed runner stay alive
  (idle) until archived, so archive them (`paseo ls --json`, then `paseo archive <id>`) after stopping a run.
- A prompt above `max_prompt_bytes` is refused (`null`): the daemon closes a client socket that falls behind its
  outbound high-water mark, and a 42 MB prompt triggered it.
- An agent's read tools fail on very large files (a 15 MB JSON closed the MCP server: "Connection closed" on every
  later read of that agent). Give agents per-item extracts (one brief per family, module or screen), not a whole
  corpus file.

### 6-4. Failures

An agent turn that ends in an error is continued once in the same agent ("continue where you stopped"), except
when the error says the quota, authentication, credit or permission is the cause: the same request would fail
again and only burn the remaining quota. Every `null` is written to the journal with its reason, and the progress
line `agent done ... null (<reason>)` shows it, so filter results with `.filter(Boolean)` and `log()` how many
were dropped.

Watchdog (owner 2026-10-04). Time is the agent's own model time since the last prompt the runner sent it: tool
execution time (from the moment a call's input stops growing until it completes; overlapping calls once) is
subtracted, and each prompt resets it (the watchdog's own messages do not). Behaviour checks send one specific
message each per prompt: the same tool with the same input `watchdog_repeat_calls` (3) times (`loop`), one file read
`watchdog_same_file_reads` (3) times (`reread`), `watchdog_reads_without_write` (15) reads or searches without a
write (`piecemeal`); shell commands count as reads or writes by their command text. A workflow agent with
`agent_nudge_s` (300) of model time gets one steering message
to finish in bulk within 3 tool calls (`log watchdog: ... nudged`); after `agent_stop_s` (900) it is archived and its
`agent()` returns `null` with reason `watchdog stopped the agent` (`log watchdog: ... stopped`). Read the agent's
activity before resuming: a stopped agent usually needs a smaller task or a script, not a rerun. Because tool time
is excluded, a single tool call that runs longer than `agent_tool_stuck_s` (900) also stops the agent (`log watchdog:
... call ran N min without returning, stopped`): a hung call would otherwise hide forever (2026-10-04: one finder sat
30 min in one call and returned nothing). A watchdog loop count resets after every write (check → fix → check is
progress).

The runner does not reconnect to the daemon. After the first `Transport closed`/`Transport not connected` error it
logs `runner lost the daemon connection` and every later `agent()` returns `null` at once (no orphan agents). Find
the cause in `~/.paseo/daemon.log` (search `high-water`), archive the run's agents, and resume the run.

### 6-5. Run directory

`--runs-dir` (default `_workspace/_runs`) holds one directory per run, `<runId>` = `wf_<yyyymmdd-hhmmss>_<4 hex>`:

| File | Content |
| --- | --- |
| `script.js`, `args.json` | the exact script and args of this run |
| `run.json` | runId, parent runId (resume), script, status, start and end times, agent counts |
| `journal.jsonl` | one line per finished `agent()` call: n, key, occ, label, phase, agentId, model, status (`ok`/`null`/`cached`), reason, result, tokens (the agent's output tokens over all its turns), duration_s |
| `log.txt` | every progress line |
| `result.json` | the script's return value |

Before diagnosing an empty or odd result, read `journal.jsonl`: it records what each agent really returned.

### 6-6. Resume

`ph workflow --script <file> --args-file <file> --resume <runId>` starts a new run whose `agent()` calls with unchanged
`(prompt, schema, agentType, model, effort, isolation, readOnly, cwd)` return the earlier run's result at once (the
n-th identical call maps to the n-th earlier one). Changed, new or earlier-`null` calls run live. The same script
and args resume to a 100 % cache hit. Edit the script file and resume to rerun only what changed. Without
`--script`/`--name`, the resumed run's own `script.js` is rerun; without `--args`/`--args-file`, its `args.json` is
reused, so `ph workflow --resume <runId>` alone repeats the earlier run (for example after quota came back).

### 6-7. Running a workflow from the orchestrator

A workflow can run for a long time, so start it detached and watch its log:

1. `ph workflow --script <file> --args-file <file> --detach` prints `workflow started <runId>: <runDir>/log.txt`
   and returns.
2. Watch with the Monitor tool (re-arm after its timeout; a Monitor timeout does not stop the workflow):
   `node .agents/skills/harness/scripts/watch_run.mjs <runId> [<runId> ...]`, which prints the log, phase, failure and workflow lines and exits when every run has ended (a `tail -f` watcher never exits and keeps the Monitor alive until its timeout).
   Progress lines: `workflow start <runId> <runDir>`, `phase <title>`, `log <message>`,
   `agent start #<n> <label> <id8> <model>`, `agent done #<n> <label> ok|null (<reason>) tokens=<n> <s>s`,
   `agent cached #<n> <label>`, and the final `workflow done <runId>: <runDir>/result.json (ok <k>, null <m>,
   cached <c>, tokens <t>)` or `workflow failed <runId>: <error>`.
3. On `workflow done`, read `<runDir>/result.json`; on `workflow failed`, read `journal.jsonl` and `log.txt`.

Without `--detach` the command runs in the foreground and prints the same lines.

## 7. Shared task list (mode B)

`<workspace>/tasks.json` (normally `_workspace/tasks.json`) is changed only through `ph task` (a lock file keeps
parallel updates safe), by the leader and by teammates:

| Command | Prints |
| --- | --- |
| `ph task add --ws D --title T [--assignee NAME] [--depends-on 1,2] [--notes T]` | `task <id> added` |
| `ph task update --ws D ID [--status S] [--assignee NAME] [--notes T] [--title T] [--depends-on 1,2 (replaces; "" clears)]` | `task <id> <status>` |
| `ph task list --ws D [--assignee NAME] [--status S]` | `<id> <status> <assignee> <title>` plus `after <ids>` and `READY` (pending, all dependencies completed) |
| `ph task get --ws D ID` | the task as JSON |

Statuses: `pending`, `in_progress`, `completed`, `blocked`. Teammates are told the workspace path and to update
their own tasks; the leader checks `ph task list` after each `ph watch` line.

Teammate messages: a teammate may message another teammate with `ph send --prompt "..." <teammate>`; names are
resolved among the leader's subagents. Upstream's default still applies: the leader relays between teammates and
the content travels in files.

## 8. Artifact freeze

`ph freeze --ws D --phase P` records the SHA-256 of every `D/P_*` file in `D/freeze_P.sha256`.
`ph freeze --check --ws D --phase P` recomputes them and prints `freeze ok P: <n> files` (exit 0) or
`freeze CHANGED P: modified <file>; missing <file>; new <file>` (exit 2). New version files such as
`P_<agent>_<artifact>_v2.md` show up as `new`.

## 9. Waiting for agents

`ph spawn`, `ph send` and `ph fanout` (without `--collect`) return at once. Run `ph watch <names>` under the
Monitor tool: each finished agent is one event line, and the command exits when all are idle (Monitor timeout:
re-arm; it does not affect the agents). Do not poll `ph team` in a loop. A Paseo agent that ends its turn to wait
for a background command is not woken when the command finishes, so subagents run their own builds and tests in
the foreground.

## 10. Known limits

- **Definition tools and read-only roles are advisory.** The definition's `tools:` list and `--read-only` do not
  grant tools or create a sandbox. Actual availability and permissions come from the provider and host's owner
  settings; direct file checks can fail on native file denies. Read-only means "change no files": such an agent may
  run non-mutating lint/tests/verifiers, but artifact-writing checks need an editing role scoped to those files.
  Where reviewer writes would do harm, freeze inputs (`ph freeze`) and check them afterwards.
- **Workflow scripts are trusted code.** `node:vm` is not a security boundary: a script can reach the harness
  process through host objects, a busy loop hangs the runner, and calls the script does not await may still run after
  "workflow done" (audit 2026-10-04, ENG-2..4). Write scripts like code you run, await every `agent()`.
- **Resume reuses results by prompt and options only.** Changing an agent definition, its `include:` files or the
  model mapping in defaults/overlay does not invalidate cached calls; resume only over unchanged definitions and config,
  otherwise start a new run (audit ENG-5).
- **Runner bookkeeping.** run.json records the runner's `pid`; `watch_run.mjs` ends with "workflow interrupted" when
  that process is gone without a terminal status, and `ph archive --run <runId>` stops a live runner, archives the
  run's agents and marks the run stopped. Every task message ends with the runtime note `Run <runId> #<n>` so
  `run_stats.mjs` matches transcripts to runs exactly.
- **Working directory.** Paseo 0.10.0 starts every subagent in the orchestrator's workspace directory and ignores a
  requested cwd, even with an explicit workspace id (verified 2026-10-03). `--cwd`, `opts.cwd` and worktree
  isolation therefore tell the agent its directory in the prompt (run shell commands there, use absolute paths),
  and `ph` still passes the cwd in case a later Paseo version honours it. Run the orchestrator from the project
  root.
- **Token usage is live-only.** The daemon keeps only an agent's last turn (`lastUsage`, overwritten while the next
  turn streams and gone once the agent is archived) and stores no per-turn history; the per-turn numbers exist only as
  `turn_completed` stream events. `ph` therefore subscribes when it creates an agent and adds every turn up. Turns
  that end in an error or are interrupted report no usage, so their tokens are not counted. A turn that finished
  before `ph` subscribed is counted from `lastUsage` when `ph` waits for it. `budget` is checked before each new
  `agent()` call, so agents already running can take `spent()` past `total`.
- **Messages wait for an idle agent.** `ph send` to a running agent waits until its turn ends, then delivers, so a
  message never interrupts work in progress; `ph send --now` (or `ph stop` then `ph send`) interrupts on purpose.
- **Workspace.** Agents join the orchestrator's Paseo workspace and run in the project root unless `--cwd`,
  `opts.cwd` or worktree isolation say otherwise.

## 11. Self-compaction

Ported from an earlier Python tool (`paseo_tool.py compact-self`) (owner 2026-10-02: the orchestrator compacts itself
instead of asking the owner to type `/compact`). Verified 2026-10-03 on a Luna agent: 46,056 -> 946 used tokens, the
agent woke on the resume message and still knew its earlier answer.

1. You do not have to remember to check: the project hook `.claude/hooks/context_guard.mjs` (PostToolUse and
   UserPromptSubmit, registered in `.claude/settings.json`) reads the session transcript's last usage and injects a
   reminder once the context passes config `context_guard.start_pct` (60 %) of `window_tokens`, then again every
   `step_pct` (5 %). It watches the main conversation, not a particular model. Native `agent_id` and the `ph`
   worker environment suppress it; a main `--agent` session remains a main session. Reported window size takes
   precedence when available; configured `window_tokens` is the fallback. The output is a model-facing reminder,
   not a UI notification or forced autocompact. `ph context --self` reports runtime usage on demand. On a reminder,
   compact at the next natural break (no edit in progress), or earlier before a phase that would pass about 80 %.
2. Stop Monitors and background commands: a notification that arrives during the compaction cancels it.
3. Run `ph compact-self --focus "<what the summary must keep>"` and end the turn at once.
4. The detached watcher (log `%TEMP%/ph-compact-<id8>.log`) waits until the turn ends, sends `/compact`, and counts
   it as done only when used tokens fall below half of the value before; then it sends `compact_resume` (or
   `--resume`). Otherwise it sends a "NOT confirmed" message and does not retry; decide yourself whether to run it
   again. `--agent ID` compacts a long-running subagent instead (fresh agents with a handoff are usually better).
