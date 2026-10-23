# Requirements: runtime (M4 paseo-client, M5 ph, M6 workflow)

**Defined:** 2026-10-20
**Modules:** M4 paseo-client (PCLI), M5 ph (PHCL), M6 workflow (FLOW), per `.planning/intel/SYNTHESIS.md`.
**Inputs:** SYNTHESIS (M4..M6 capabilities, INV-NN), DECISIONS D-01..D-111, INGEST-CONFLICTS (W-03, W-04, W-14, W-15), maps `runtime.md` (RUN), `workflow.md` (WFL), `history.md` (HIS), `ui.md` (UI-80).

## Conventions

- `ph` = `node .agents/harness/ph.mjs` in an installed project (single entry, no facade).
- FDC = the fake daemon client used by offline tests: implements the M4 interface (`connect, createAgent, sendPrompt, waitTurn, listAgents, fetchAgent, archive, cancel, stream events`) in memory, records every call, and scripts agent states, permission requests, errors and `turn_completed` events. FCLOCK = injectable clock/timer used by retry, watchdog and watcher tests. Tests never touch the owner's Paseo config or daemon (INV-57).
- "Output contract" (P8): one line per item; item errors `failed <what>: <err>`; exit 0 done, 1 usage/config/file error, 2 done with failed items or problems.
- Config keys are read through the one M3 loader; a key named here and not yet in the M3 table is a requirement on M3 to add it with closed validation.
- Manual checks (named MC-NN) run once per Paseo or Claude Code version bump, with probe agents on `circle/gpt-6-luna-fast[1m]` (INV-50).
- Vanilla (D-110): nothing below names a project, engine or game; project data (roles -> models, price table, prompt note, thresholds) comes from the project overlay / adapter (M12).
- Shipped prompt text (runtime notes, watchdog messages, denial text) is carried verbatim from the old kit code quoted in the maps; it changes only with owner review (D-35, INV-49).

## v1 Requirements: M4 paseo-client (PCLI)

### PCLI-01 Single daemon adapter module
- Requirement: exactly one module (`.agents/harness/paseo-client/`) imports the npm Paseo CLI client (`connectToDaemon`) and helpers; no other module of the installed runtime (M4..M10: `.agents/harness/**`, `.claude/hooks/**`, `.agents/workflows/**`) imports `@getpaseo/cli`, `@getpaseo/server` or any daemon-client path, or talks to the daemon; the M13 Paseo plugins (`plugins/`, never installed into projects) use the host-provided plugin SDK (`@getpaseo/plugin`) and are outside this rule; the module exposes `connect(), createAgent(), sendPrompt(), waitTurn(), UsageTracker, listAgents(), resolveTargets(), archive(), cancel()` and accepts an injected client so FDC can replace it.
- Acceptance: import scan over `ship/` finds `@getpaseo/*` imports only under `paseo-client/`; the scan over `plugins/` accepts `@getpaseo/plugin` and fails on `@getpaseo/cli` or `@getpaseo/server`; the PCLI/PHCL/FLOW test suites run green against FDC with no network.
- Source: RUN-25, D-17, R-01, P11, UI-01.
- Scope: v1

### PCLI-02 Paseo CLI location
- Requirement: the CLI directory is the first of `$PASEO_CLI_DIR`, then for each PATH directory holding `paseo`/`paseo.cmd` its `node_modules/@getpaseo/cli` and `../lib/node_modules/@getpaseo/cli`, then the npm global dirs (`%APPDATA%/npm/node_modules/@getpaseo/cli`, `/usr/local/lib/...`, `/usr/lib/...`) that contains `dist/utils/client.js`; none found -> usage error `the npm-installed Paseo CLI was not found (npm i -g @getpaseo/cli, or set PASEO_CLI_DIR)`, exit 1. The structured-output helper of `@getpaseo/server` is not imported (FLOW-13 owns validation, D-30).
- Acceptance: temp dir fixtures: `PASEO_CLI_DIR` pointing at a dir without `dist/utils/client.js` -> that message, exit 1; a PATH dir with a fake `paseo.cmd` and sibling `node_modules/@getpaseo/cli/dist/utils/client.js` is found; paths with spaces work.
- Source: RUN-25, D-17, D-30, INV-52.
- Scope: v1

### PCLI-03 Daemon address
- Requirement: the client connects to `$PASEO_HOST` when set, else to `daemon.listen` of the Paseo config (`$PASEO_HOME` or `~/.paseo`, `config.json`, BOM stripped); it never reads `paseo.pid`.
- Acceptance: FDC connect spy: with `PASEO_HOST=h:1` the target is `h:1`; unset, with a temp Paseo home whose config has `daemon.listen` and a stale `paseo.pid`, the target is the listen address and the pid file is never opened (fs spy). MC-01: on the owner's Desktop-managed daemon `ph doctor` prints `daemon reachable`.
- Source: HIS-29, D-17, W-15.
- Scope: v1

### PCLI-04 CLI version gate data
- Requirement: the module records the loaded CLI version and exports one constant `TESTED_PASEO_CLI` (no hard-coded version string elsewhere); `ph doctor` uses both (PHCL-04).
- Acceptance: grep finds the tested version literal only in the constant; doctor test with a fake CLI `package.json` version different from the constant prints a `note` naming both versions.
- Source: RUN-25, D-17, R-01, RUN concern "hard-coded 0.10.0".
- Scope: v1

### PCLI-05 Size check before any daemon call
- Requirement: `createAgent` and `sendPrompt` measure the UTF-8 byte length of the fully rendered outbound text (task, role, includes, notes, schema/retry wrapper, watchdog messages, compaction reports) before any daemon request and refuse above `max_prompt_bytes` with `prompt is <bytes> bytes > max_prompt_bytes <limit>; pass a file path instead of inlining content`; in `createAgent` the check precedes the model-catalogue request.
- Acceptance: FDC: a 300 KB prompt through `createAgent` and through `sendPrompt` throws the message and FDC records zero calls of any kind; a 2-byte-per-char string is measured in bytes.
- Source: RUN-12, RUN-33, WFL-25, INV-11.
- Scope: v1

### PCLI-06 Caller required
- Requirement: every agent-creating call requires `PASEO_AGENT_ID`; when unset it throws `PASEO_AGENT_ID is not set: run ph from an agent inside Paseo, so every agent is created as its subagent` before connecting, and creates nothing.
- Acceptance: FDC: `createAgent` with the env var unset -> that message, zero FDC calls.
- Source: RUN-28, INV-10.
- Scope: v1

### PCLI-07 createAgent payload
- Requirement: `createAgent` sends `{provider, model, cwd, callerAgentId: PASEO_AGENT_ID, title, modeId: cfg.mode, thinkingOptionId?, initialPrompt, outputSchema?, featureValues?: tier.features, disallowedTools? (PHCL-27, only when the client supports per-agent denies), env, labels}`; no `mcpServers` key ever; order: size check, caller check, env, thinking clamp, create.
- Acceptance: FDC records one create call per agent; snapshot test of its keys for a tier with `features: {fast_mode: true}` (featureValues present) and without (absent); no `mcpServers` key.
- Source: RUN-26, RUN-17, RUN-62 (dropped part), S-01.
- Scope: v1

### PCLI-08 Labels and title
- Requirement: labels = `{...extra, harness.name, harness.run?, ph.swarm, paseo.parent-agent-id: <caller>}` with the parent label written last so no caller label can replace it; `ph.swarm` carries the group name (the spawn/fanout name prefix or the workflow name) so grouping never depends on the title; titles are cut to 60 characters only for workflow agents (`<workflow>:<label>`), while spawn/fanout names over 60 characters are refused up front (PHCL-25).
- Acceptance: FDC: extra label `paseo.parent-agent-id=x` -> stored value is the caller id; a workflow label of 90 chars yields a 60-char title and an intact `ph.swarm` label.
- Source: UI-80, D-100, RUN-26, RUN-29.
- Scope: v1

### PCLI-09 Worker env and mod env
- Requirement: env = `{PASEO_HARNESS_LEADER: <caller>, PASEO_HARNESS_ROOT: <root>, PASEO_HARNESS_ROLE: "worker"}` plus `CLAUDE_CODE_PLUGIN_DIRS` (existing dirs + the mod's plugin dir, no duplicate) only when all of: (a) the mod is copied (`.claude/plugins/harness-files/.claude-plugin/plugin.json` and `hooks/register.ts` present); (b) the owner's last-wins selection `enabledPlugins["harness-files@paseo-harness-kit"]` over `<worker CLAUDE_CONFIG_DIR>/settings.json`, project `.claude/settings.json`, `.claude/settings.local.json` is not `false`; (c) the mod is affirmatively selected: either the selection is `true` and the plugin is not natively registered (`installed_plugins.json` entry with scope user or this project; a native registration already loads it and a second direct dir would register the tools twice), or the plugin dir is already in the worker's effective `CLAUDE_CODE_PLUGIN_DIRS` (direct). A copied mod with no selection and no direct entry stays inactive (D-02). The worker's `CLAUDE_CONFIG_DIR` and existing `CLAUDE_CODE_PLUGIN_DIRS` come from the worker provider's effective env in the Paseo config (`agents.providers.<worker>.env`, following `extends`), else the invoking process env. The kit never writes or toggles any plugin setting.
- Acceptance: fixture matrix (copied / missing `plugin.json` / missing `register.ts`) x (unset / false / true) x (registered / unregistered) x (direct / not direct): the plugin dir is in the FDC env only for (copied, true, unregistered) and (copied, not false, direct); copied + unset + not direct -> absent; a worker provider whose env names a `CLAUDE_CONFIG_DIR` different from the process -> settings are read from that dir; fs spy: no settings file written; the three `PASEO_HARNESS_*` keys always present; paths compared case-insensitively on win32.
- Source: RUN-26, RUN-61, INV-05, D-02, memory no-kit-overrides-of-tool-settings.
- Scope: v1

### PCLI-10 Thinking clamp
- Requirement: `clampThinking(requested, supported)` returns the exact level if supported, else the nearest supported level in `off<low<medium<high<xhigh<max` by index distance with ties to the higher level, never `off` unless `off` was the exact request, `undefined` for no request, no options, an unknown requested value or only unknown option ids; supported ids come from the worker provider's catalogue (cached per provider per process); a catalogue failure gives `[]` and creation proceeds without `thinkingOptionId`.
- Acceptance: unit: `xhigh/[high]`->high; `low/[off,medium,high]`->medium; `medium/[low,high]`->high; `medium/[none]`->undefined; `off/[off,low]`->off; FDC catalogue throws -> agent still created, no `thinkingOptionId`.
- Source: RUN-15.
- Scope: v1

### PCLI-11 Usage tracking from creation
- Requirement: `UsageTracker` subscribes at agent creation; per agent it sums `input, cachedInput, output, turns` from `turn_completed` events with usage, dedups by `turnId` (else `seq`), keeps the last reported `totalCostUsd` as `reportedCostUsd`; `waitTurn` takes a baseline turn count before the turn starts and after idle settles up to 2000 ms (100 ms poll), adding `lastUsage` itself and dropping the next late event when none arrived; error/interrupted turns are not counted; a subscription failure archives the new agent and throws `agent <id8> created but its usage tracking failed (archived): <err>`.
- Acceptance: FDC replay: early event with baseline 0 counted once (output 7, turns 1); duplicated `turnId` counted once; late-settled turn then its late event -> counted once; subscription error -> one archive call and the message.
- Source: RUN-26, RUN-27, WFL-53, INV-15.
- Scope: v1

### PCLI-12 waitTurn outcomes
- Requirement: `waitTurn(agent, timeoutS)` returns `{text, usage, agent}` on idle (text = structured reply resolved from the last message); an idle turn with empty text fails `finished without a reply`; timeout fails `no reply within <N> s`; any other terminal status fails `agent status <s>`; an unretried or exhausted error fails `agent error: <first line, 300 chars>`.
- Acceptance: FDC scripted states idle/empty/timeout(FCLOCK)/`closed` -> the four results with exact texts.
- Source: RUN-31, WFL-26.
- Scope: v1

### PCLI-13 Transient provider errors retried with growing pauses
- Requirement: an error turn, or an idle reply whose trimmed text starts with `API Error` or is one line under 300 chars matching `overloaded|rate limit|\b5\d\d\b|\b429\b` (case-insensitive), is continued in the same agent with `Your previous turn ended with an error. Continue the task from where you stopped.` after 30, 60, 120, 240, 300 s, at most 5 times per wait; an error whose text matches `quota|credit|billing|auth|unauthori[sz]ed|forbidden|permission|invalid api key` (case-insensitive, on the error text) is never continued and fails at once.
- Acceptance: FDC + FCLOCK: reply `API Error: overloaded` x6 -> 5 continue prompts at the listed offsets, then `agent error`; `quota exceeded` -> 0 continue prompts, immediate failure; `rate limited` error then idle -> 1 continue, success.
- Source: HIS-15, RUN-31, WFL-26, WFL-52(g), W-04, INV-13.
- Scope: v1

### PCLI-14 AskUserQuestion denied, other permissions fail
- Requirement: a pending `AskUserQuestion` permission is denied with the text `Nobody answers questions from subagents. Do not ask: decide from the material you were given if it settles the point; otherwise record the decision as open in your result the way your instructions say (for example a skipped item with needs_owner and the options), and finish the rest of your task.`, counted once per permission status, at most 3 per wait; any other pending permission, or a fourth question, fails `agent stopped: permission <name|kind> was not granted` (the agent is then archived, FLOW-25).
- Acceptance: FDC: two questions then idle -> 2 denials with the exact text, success; four questions -> failure on the fourth; an `Edit` permission -> immediate failure naming it.
- Source: RUN-32, WFL-26, WFL-52(f), INV-14.
- Scope: v1

### PCLI-15 Target resolution restricted to own pools
- Requirement: `resolveTargets(refs)` searches the caller's live (non-archived, parent-labelled) subagents to completion, then the leader's (`PASEO_HARNESS_LEADER`, when it differs); a ref matches by exact id, id prefix of at least 6 characters (id matches win over title matches within a pool) or exact title; more than one match -> `'<ref>' matches <n> agents; use the id`; no match -> `no live subagent named or id '<ref>'`; no refs -> `name at least one agent (title, id or unique id prefix)`. Spec decision (SYNTHESIS M4): the unfiltered 36-char uuid fallback is not carried; a full uuid outside both pools is "no live subagent".
- Acceptance: FDC: 5-char prefix does not match; 6-char unique prefix matches; duplicate title -> ambiguity error; a teammate (leader set) reaches the leader's other child; the full uuid of an archived or foreign agent -> no match.
- Source: RUN-30, INV-17, INV-10.
- Scope: v1

### PCLI-16 Resumed session agents: model readback, refusal, forgotten agent
- Requirement: before sending to an existing (session or adopted) agent with a requested model, the client updates the agent's model and reads it back, failing when the read-back model differs; it refuses to send when the agent has an active turn or its provider differs from the resolved worker provider; an agent the daemon reports not found is replaced by a fresh agent created with the full prompt (role, includes, notes) and a warning is returned for the log, never a null turn.
- Acceptance: FDC: resume with a different model -> update then read-back call precede the send; FDC read-back returns the old model -> failure `model readback <want> != <got>`; active turn -> refusal; `not found` -> one new create call whose prompt contains the role block, plus the warning.
- Source: HIS-17, HIS-16, INV-22.
- Scope: v1

## v1 Requirements: M5 ph (PHCL)

### PHCL-01 Single entry and command surface
- Requirement: `ph` is one entry `.agents/harness/ph.mjs` that imports only from `.agents/harness/` (never a kit checkout or a path read from a manifest); no command, `help` or `--help` prints the usage and the public command list (internal commands such as the compact watcher hidden) and exits 0; an unknown command prints the same and exits 1; a usage error prints `usage error: <first line, <=300 chars>` exit 1; any other thrown error prints `failed: <msg>` exit 1; the daemon client is closed in `finally`.
- Acceptance: subprocess tests: no args -> exit 0 and the list lacks the internal watcher name; `ph bogus` -> exit 1; a project copy moved to another path with no kit present runs `ph help` and `ph config`; grep: no manifest `kit`-path lookup in runtime code.
- Source: RUN-34, RUN-52, INV-09, D-04, S-02.
- Scope: v1

### PHCL-02 Argument parsing
- Requirement: options only in `--key value` form (`bool` options take no value); a string option consumes the next token even if it starts with `--`; an unknown option -> usage error `unknown option --<key>`; a string option without value -> `--<key> needs a value`; other tokens are positional.
- Acceptance: `ph send --prompt "--x" a` passes the text `--x`; `ph team --bogus` -> exit 1 `unknown option --bogus`; `ph spawn --name` -> `--name needs a value`.
- Source: RUN-35.
- Scope: v1

### PHCL-03 Prompt input
- Requirement: commands that take a prompt require exactly one of `--prompt T` / `--prompt-file F` (`use --prompt or --prompt-file, not both`; `--prompt or --prompt-file is required`); the file resolves against the root and one leading BOM is stripped.
- Acceptance: both flags -> exit 1; neither -> exit 1; a BOM-prefixed file reaches FDC without the BOM.
- Source: RUN-36.
- Scope: v1

### PHCL-04 ph doctor
- Requirement: prints one `ok|problem|note <text>` line per check and continues past every problem; exit 2 if any `problem`, else 0. Checks in order: Node gate (PHCL-34); `PASEO_AGENT_ID` set; config validity (an invalid overlay, also unparsable JSON, gives one `problem` and the remaining checks run with kit defaults, M3); Paseo CLI found and daemon reachable as `paseo cli <v> at <dir> (tested with <TESTED_PASEO_CLI>); daemon reachable`, `note` when the versions differ; caller known to the daemon; per tier (skipped when the daemon is unreachable) `tier <name> -> <provider/model> thinking <clamped|default>[ features k=v][ (model not offered by the provider)]`, `problem` for a model not offered; `default_tier <t> -> <id>` (allowlist-gated, `problem` when outside `allowed_models`); overlay path or `none (kit defaults apply)`; harness-files mod lines (copied/missing, Claude Code version vs minimum, owner selection, eligibility for worker launch); provider policy lines from M2 (worker denies incl. `SendMessage` and env; main denies `Agent`, `Workflow` only, never requiring `SendMessage` on a main provider); adapter presence (`adapter`/`gsd` sections and every file they name exist); agent types found in `.agents/agents/`; a `note` when free RAM is below `max_subagents` x 350 MB; a final `note` that tools loaded into a running session are not verified. It never probes a model and never starts a daemon.
- Acceptance: FDC daemon down -> `problem paseo: ...`, tier lines absent, overlay/defaults lines present, exit 2; overlay with broken JSON -> one `problem`, later lines printed, exit 2; FDC catalogue missing a tier model -> that tier's `problem`; a main provider lacking `SendMessage` in its denies produces no line about it; low-RAM stub -> the `note`.
- Source: RUN-37, RUN-07, RUN-14, RUN-15, RUN-16, RUN-61, D-06, D-17, D-20, W-01, INV-06.
- Scope: v1

### PHCL-05 ph spawn
- Requirement: `ph spawn --name N (--prompt T | --prompt-file F) [--count K] [--type T] [--role R] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--worktree]` loads config, connects, requires a caller, checks capacity (PHCL-23, PHCL-24) and names (PHCL-25) for all K agents before starting any, then starts them in parallel (kind `team`); `--count K` (positive integer) names them `N-1..N-K`; prints `<full agent id> <name>` per agent, `failed spawn <name>: <err>` per failure, then the wait hint (PHCL-07); returns without waiting for turns; exit 2 if any failed.
- Acceptance: FDC: `--count 3 --name x` -> lines for `x-1..x-3` then a `next:` line; a duplicate live name -> refused with zero creates; one create failing -> its `failed spawn` line, the others' lines, exit 2.
- Source: RUN-38.
- Scope: v1

### PHCL-06 Directory as a prompt instruction
- Requirement: `--cwd D` resolves against the root; when the directory differs from the root the prompt carries `Your working directory for this task is <dir>: run shell commands there and resolve relative paths against it.` and the directory is also passed as `cwd` to the daemon; with `--worktree` the worktree note (PHCL-31) replaces it.
- Acceptance: FDC: `--cwd sub` -> the note with the absolute path in the prompt and `cwd` in the create call. MC-02: a probe agent on the installed Paseo reports its working directory; if Paseo honours `cwd`, record it for a later removal of the note (R-03).
- Source: RUN-39, INV-16, R-03.
- Scope: v1

### PHCL-07 Wait hint after non-blocking commands
- Requirement: `spawn`, `send` and `fanout` without `--collect` end with ``next: wait with Monitor running `<ph> watch <names>` (one event per idle agent, exits when all are idle); do not poll with sleep/grep loops`` (names quoted when they contain characters outside `[\w.-]`), printed only when at least one agent started or was sent to; `<ph>` is rendered by the same single function that renders the teammate note's ph command (S-20).
- Acceptance: the last stdout line of a successful spawn starts with `next: wait with Monitor`; a name with a space is quoted; all creates failing -> no hint; grep finds one ph-command renderer.
- Source: RUN-40, HIS-13, INV-18, S-20.
- Scope: v1

### PHCL-08 Fanout file format
- Requirement: a fanout file is an optional preamble (prepended with a blank line to every prompt) then blocks opened by `=== <name> [key=value ...]`; trailing `^[a-z-]+=` words are peeled as options while more than one word remains; options `type, role, model, effort, read-only` (only `read-only=true` enables it); unknown option -> `block '<name>': unknown option <k>=`; no blocks -> `<file> has no '=== <name>' blocks`; block bodies trimmed.
- Acceptance: unit `parseFanout` on a two-block fixture returns `{type:'reviewer', model:'pro'}` and `{type:'reviewer'}` and the preamble in both prompts; `=== a bogus=1` -> the error.
- Source: RUN-41.
- Scope: v1

### PHCL-09 ph fanout without --collect
- Requirement: `ph fanout --file F [--type] [--role] [--model] [--effort] [--read-only] [--cwd] [--ws]` (block options override command options) validates before starting: unique block names, output-safe names (runs outside `[\w.-]` -> `_`) distinct case-insensitively, names <= 60, names free among live subagents, capacity for all blocks; then starts all (kind `team`), prints `<id> <name>` per agent and the wait hint, and returns at once; exit 2 on any failure. Fanout has no `--worktree`.
- Acceptance: FDC: blocks `A` and `a` -> refused before any create; 21 blocks with `max_subagents` 20 -> refused, zero creates.
- Source: RUN-42.
- Scope: v1

### PHCL-10 ph fanout --collect
- Requirement: with `--collect DIR [--keep]` agents run as kind `oneshot` under a semaphore of the free running slots, each admission also needing a free live slot (PHCL-24; a block that finds none after the running blocks finished fails `failed <name>: live agent cap reached (<l> of <m>)`) (refused with `<n> subagents running, max_subagents <m>: no free slot; wait or archive` when none); first line `waiting for <n> agent(s): this command returns when every reply is collected; run it in the foreground and do not poll its output`; per block: `<id> <name>`, wait `wait_timeout_s`, write `DIR/<safe>.md` (final reply + newline) and `DIR/<safe>.json` (the `result --json` object) before archiving, print `collected <name> -> <file>.md`; errors `failed <name>: <err>`; every started agent archived in `finally` unless `--keep` (`failed archive <name>: <err>`); exit 2 if any block failed.
- Acceptance: FDC with `max_subagents` 1 and 2 blocks: at most one agent running at any time, both `.md` and `.json` written, the result read precedes the archive call, both archived; an erroring block is still archived.
- Source: RUN-42, INV-15.
- Scope: v1

### PHCL-11 ph send
- Requirement: `ph send (--prompt T | --prompt-file F) [--now] NAME|ID...` size-checks before connecting; per target in parallel: a running agent is awaited until its turn ends (`wait_timeout_s`; with `--now` the turn is cancelled first and awaited up to 60 s), then the message is delivered, then the agent is polled every 500 ms up to 15 s until it reports `running`; prints `sent <title>` (also when that poll times out) or `failed send <title>: <err>`, then the wait hint; exit 2 on any failure. The `ph` skill tells orchestrators to batch follow-ups and send when idle.
- Acceptance: FDC: send to a running agent -> the send call comes after the turn end; `--now` -> cancel precedes the send; oversize prompt -> exit 1 and zero FDC calls; skill text lint finds the batch-follow-ups rule.
- Source: RUN-43, HIS-22, D-38, INV-55.
- Scope: v1

### PHCL-12 ph watch
- Requirement: `ph watch NAME|ID...` waits per agent in parallel (`wait_timeout_s`); on idle prints `idle <title> <id8> out_tokens=<n|?> context_tokens=<n|?> duration_s=<s|?>` (last-turn output, context used, `updatedAt - lastUserMessageAt`); otherwise `failed <title> <id8>: <error or status>`; finally `watch done: <k> idle, <m> failed`; exit 2 if any failed; it subscribes no usage tracker.
- Acceptance: FDC two agents going idle -> two `idle` lines then `watch done: 2 idle, 0 failed`; FDC spy: no tracker subscription.
- Source: RUN-44.
- Scope: v1

### PHCL-13 ph result
- Requirement: `ph result [--json] NAME|ID...`: text mode prints the final reply (`## <title>` header per agent when several); `--json` prints one JSON line per agent `{id, name, status, model, final, usage, tokens, costUsd, reportedCostUsd, durationS, lastTurnS, skills}` where `tokens` is `{turns,input,cachedInput,output}` only when this process tracked the agent from creation, else `null`; `skills` lists Skill tool calls found in the last 1000 timeline entries.
- Acceptance: FDC: an agent created by another process -> `tokens: null`; one created in-process (fanout `--collect`) -> numeric tokens; the JSON has every listed key.
- Source: RUN-45, D-37.
- Scope: v1

### PHCL-14 List-price cost
- Requirement: `costUsd` comes from the project data file `.agents/model-prices.json` (USD per 1M tokens per model key = id without `provider/` prefix and `[...]` suffix: `input, cachedInput, cacheWrite, output`, optional `longContext {thresholdTokens, input, output}`); long-context rates apply when the largest context used exceeded the threshold, the cached rate scales with the long-context factor, cache writes are charged as input, results rounded to 4 decimals; unknown model, missing input/output price or missing file -> `costUsd: null`; the daemon's estimate is reported only as `reportedCostUsd`. The kit ships no price data (project data, D-110).
- Acceptance: unit: fixture prices input 2 / output 10 per 1M, usage 1e6 input + 1e6 output, small context -> 12; key derivation strips `circle-agent/` and `[1m]`; no file -> null; `ship/` holds no `model-prices.json`.
- Source: RUN-66, HIS-18, D-23.
- Scope: v1

### PHCL-15 ph team
- Requirement: `ph team` requires a caller and prints for each live subagent `<id8> <status> <context%|?%> <provider>/<model> <title>`; prints `no live subagents` when there are none; exit 0.
- Acceptance: FDC two agents -> two lines in that column order; none -> `no live subagents`.
- Source: RUN-46.
- Scope: v1

### PHCL-16 ph context
- Requirement: `ph context [--self] [--rotate-pct N] [NAME|ID...]` requires a caller; prints `<id8> <pct padded to 4>% <used>/<max> <status> <title>` (`  n/a` when unknown) sorted by use descending (unknown last), suffix `  ROTATE` at or above N; N defaults to `context_guard.start_pct` of the effective config (kit default 60, D-48; a project overlay value applies), the one context threshold that the swarm map's `rotatePct` also takes (PANL-55); there is no separate rotate key or constant; a non-numeric or out-of-range N is a usage error; `--self` reports the caller only; `no live subagents` when empty.
- Acceptance: shared fixture defaults with `start_pct` 60: agents at 59 %, 60 %, 61 % -> `ROTATE` on 60 and 61 only; overlay `context_guard.start_pct: 45` -> an agent at 50 % shows `ROTATE`; `--rotate-pct abc` -> exit 1; grep finds no rotate default constant.
- Source: RUN-47, D-97, D-48.
- Scope: v1

### PHCL-17 compact-self arming, one watcher per agent
- Requirement: `ph compact-self [--focus TEXT] [--resume TEXT] [--agent ID]` targets `--agent` else the caller (`PASEO_AGENT_ID is not set: pass --agent or run inside a Paseo agent`), verifies the agent exists, takes the resume text from `--resume` else config `compact_resume` (no second built-in text), takes an exclusive lock `<tmp>/ph-compact-<id8>.lock` holding the watcher pid (a lock whose pid is dead is replaced; a live one refuses with `compact already armed for <id8> (watcher pid <p>)`, exit 1), spawns a detached hidden watcher (stdout/stderr to `<tmp>/ph-compact-<id8>.log`) and returns at once with `compact armed for <id8> (context <pct>%|n/a); it starts when the turn ends and the resume message follows when it is done (log <path>). End your turn now`; the `ph` skill tells the caller to stop Monitors/background commands first and end its turn. Native autocompact is never touched.
- Acceptance: arming twice for one FDC agent -> second call exit 1 with the refusal, one watcher process; a lock file with a dead pid -> arming succeeds; arming returns within 2 s and the log file exists; grep: no autocompact setting written.
- Source: RUN-48, HIS-12, W-14, D-36, INV-24.
- Scope: v1

### PHCL-18 compact-self watcher
- Requirement: the watcher waits for the target to go idle (`wait_timeout_s`; failure -> sends `compact-self: waiting for your turn to end failed, so /compact was NOT sent...`, exit 2), reads used tokens (`before`), sends `/compact[ <focus>]` once, polls every 3 s up to 15 min; success only when the agent is not running and used tokens < 0.5 x `before` -> logs `compaction done: used <before> -> <after>` and sends the resume text; otherwise (no drop, timeout, `before` null or 0) sends `compact-self: compaction NOT confirmed (used tokens <b> -> <a>); it may have been cancelled by an incoming notification. Your context is probably not compacted. Decide yourself whether and when to call compact-self again.` and exits 2; never retries; every stage logs an `HH:MM:SS` line; the lock is released on every exit path.
- Acceptance: FDC + FCLOCK: 400k -> 20k after `/compact` -> one resume message, lock gone; 400k -> 400k -> the NOT-confirmed message, exactly one `/compact` sent, lock gone.
- Source: RUN-49, HIS-12, INV-24.
- Scope: v1

### PHCL-19 ph stop
- Requirement: `ph stop NAME|ID...` cancels each target's running turn, keeping agent and context; prints `stopped <title>` or `failed stop <title>: <err>`; exit 2 on failure.
- Acceptance: FDC running agent -> one cancel call and `stopped <title>`.
- Source: RUN-50.
- Scope: v1

### PHCL-20 ph archive
- Requirement: `ph archive NAME|ID... | --idle [--name-prefix P] | --name-prefix P | --run RUNID [--runs-dir D]` requires a caller; `--idle` selects own non-running subagents, `--name-prefix` own subagents whose title starts with P; nothing selected by flag or name -> usage error `name agents, or use --idle / --name-prefix`. `--run`: reads `<runs-dir>/<id>/run.json` (default `_workspace/_runs`; BOM stripped; missing -> `no run <id> (<path>)` exit 1); when `pid` is alive (EPERM counts as alive) and status is `running` it kills the runner (`stopped runner pid <p>` / `could not stop runner pid <p>: <err>`, archiving continues); archives every own agent labelled `harness.run=<id>`; rewrites `run.json` `status: stopped, endedAt` only when it was `running`. Prints `archived <ok> of <n> agents` (+ `failed archive <title>: <err>`); exit 0 only when all succeeded (0 of 0 included).
- Acceptance: FDC: `--idle` skips a running agent; `--run` on a missing run -> exit 1; a run with a live fake runner pid and two labelled agents -> runner killed, both archived, `status: stopped`; a `done` run keeps `done`; `--runs-dir` alt dir is honoured.
- Source: RUN-51, WFL-43.
- Scope: v1

### PHCL-21 Model resolution and allowed models
- Requirement: `resolveModel(cfg, spec, effort)`: an alias that is not also a tier name is replaced by its target; a tier gives its `provider` (`provider/model`), `thinking`, `features`; a spec containing `/` is an explicit id; otherwise usage error `unknown model tier '<x>' (tiers: <list>; or provider/model)`; `effort` must be one of `off|low|medium|high|xhigh|max` (`unknown effort '<e>'`) and overrides the tier's thinking; the provider part is mapped through `agent_providers` (`circle` -> `circle-agent`); when `allowed_models` is non-empty the id must match an entry on a normalized key (provider mapping applied to both sides, `[...]` suffix stripped), else `model <id> is not in config allowed_models`. The kit defaults ship no upstream aliases (D-16).
- Acceptance: unit: explicit `circle/x[1m]` -> `circle-agent/x[1m]`; allowlist `circle/gpt-a[1m]` accepts explicit `circle-agent/gpt-a[1m]` and a tier pointing at `circle/gpt-a`, rejects `circle/other`; an unknown word lists the tiers; shipped defaults have empty `tier_aliases`.
- Source: RUN-13, RUN-14, D-16.
- Scope: v1

### PHCL-22 Model precedence and roles
- Requirement: one function `selectModel({explicit, role, definition})` decides model and effort for every agent `ph` or the workflow runner creates; the role input is `--role R` (spawn/fanout), fanout `role=` and `agent({role})` (FLOW-04), never inferred from the agent type; model and effort are resolved independently, each by the precedence per-run argument (`--model`/`--effort`, fanout block, `agent({model, effort})`) > adapter role entry (`gsd.roles[<role>].model` / `.effort`) > agent definition `model:` (not `inherit`; effort: the tier's thinking) > `default_tier`; a valid role is a role name of ADPT-11 or a key present in `gsd.roles`; a valid role with no entry (or an entry without model or effort) falls back to the next layer (ADPT-11); an invalid role name is a usage error (`ph`) or a configuration throw (`agent()`) naming the valid roles; the kit defaults hold no concrete model id outside the tier table.
- Acceptance: unit matrix over the four layers for model and for effort separately; overlay `gsd.roles.outline = {model:'pro'}`, `gsd.roles.planner = {model:'standard', effort:'high'}`: two workflow calls with the same `agentType` and roles `outline`/`planner` get pro and standard@high; a project replacement agent type with role `planner` still gets standard@high; role `checker` with no entry falls back to the definition's `model:`; an explicit `model` overrides the role; `--role nosuch` -> exit 1.
- Source: D-16, HIS-74 (via D-16), RUN-65 (adapter pattern), R-10, ADPT-11, GSDF-18.
- Scope: v1

### PHCL-23 Running-agent cap
- Requirement: before creating N agents, `ph` counts the caller's live subagents whose status is `running`; running + N > `max_subagents` (shipped 20) -> usage error `<r> subagents running + <n> new > max_subagents <m> (harness config); wait, archive, or use a workflow (it queues)`, and nothing starts.
- Acceptance: FDC 19 running + `spawn --count 2` -> refused, zero creates; 18 running + 2 -> both start.
- Source: RUN-11, RUN-29, D-20, INV-12.
- Scope: v1

### PHCL-24 Live-agent cap
- Requirement: a second cap `max_live_subagents` (shipped 40, validated >= `max_subagents`) bounds the caller's live (running + idle, non-archived) subagents; live + N > cap -> usage error `<l> live subagents + <n> new > max_live_subagents <m>; archive idle agents (ph archive --idle)`, nothing starts. The cap counts allocations of new agents only: sending to an existing agent (session reuse, `ph send`) never needs a live slot. `fanout --collect` admits a block only when both a running and a live slot are free (agents kept with `--keep` stay counted); when no live slot is free at the start it refuses like the no-free-slot case (`<l> live subagents, max_live_subagents <m>: no free slot; archive idle agents`). Workflow creation follows FLOW-14 (bounded wait, then a named null).
- Acceptance: FDC 39 idle + `spawn` 2 -> refused; 40 live + `ph send` to one of them -> delivered; `fanout --collect --keep` with 39 live and 3 blocks -> one block runs, the other two report `failed <name>: live agent cap reached ...`; config with `max_live_subagents` < `max_subagents` fails validation.
- Source: D-20, RUN-29, INV-12.
- Scope: v1

### PHCL-25 Agent names
- Requirement: spawn/fanout names longer than 60 characters are refused before any agent starts (`names longer than 60 characters: <names>`); a name equal to the title of any live subagent of the caller is refused (`a live subagent already has the name <names> (names must be unique)`).
- Acceptance: FDC: a 61-char name -> refused, zero creates; a live agent titled `rev` + `spawn --name rev` -> refused.
- Source: RUN-29, INV-17.
- Scope: v1

### PHCL-26 Agent definitions
- Requirement: `--type T` loads `.agents/agents/<T>.md` only (no `.claude/agents` fallback); a type containing a path separator, `..` or characters outside `[A-Za-z0-9._-]` is a usage error; a missing file -> `agent type '<T>' not found: <path>`; front matter is parsed by a documented YAML subset (scalars with quotes, lists by `- item` or flow `[a, b]`, `#` comments only at line start or after whitespace outside quotes) with fields `name, description, tools` (advisory), `model` (tier or `provider/model`; `inherit`/empty = none), `include` (repo-relative files, resolved inside the root); a missing or escaping include -> `agent type '<T>' includes a missing file: <rel>`.
- Acceptance: unit: a definition with an `include:` list and a comment line loads body and includes without their front matter; `--type ../x` -> usage error; a quoted value containing ` # ` keeps it; an include `../../etc` -> error.
- Source: RUN-19, W-02, D-19, RUN concern "front matter parser / traversal".
- Scope: v1

### PHCL-27 Read-only roles
- Requirement: a definition is read-only when it has a `tools` value containing none of `Edit, Write, MultiEdit, NotebookEdit, mcp__harness-files__edit_multiple_files, mcp__harness-files__write_multiple_files` (token match); read-only definitions, `--read-only`, fanout `read-only=true` and `agent({readOnly:true})` add `Read-only role: do not create, edit, move or delete files, except output files this prompt names.`; when the Paseo client accepts per-agent disallowed tools (recorded by MC-03 per Paseo version), read-only agents are also created with those six tools denied (`disallowedTools`, PCLI-07); otherwise the note stays advisory and the `ph` skill points to `ph freeze --check` for inputs a reviewer must not change. Report path under enforcement: a read-only agent delivers its report in its final reply (or structured result) and the caller writes it (`fanout --collect` writes `DIR/<name>.md`; workflow scripts and GSD flows write the returned text); a role that must itself write named artifacts is not read-only and uses an editing role scoped to those files (WFL-51). The runtime note text is unchanged (D-35). `tools:` grants nothing and is never shown in a prompt.
- Acceptance: unit: `tools: Read, Grep` -> note present; `tools: Read, mcp__harness-files__edit_multiple_files` -> absent; FDC with the per-agent-deny capability flag on -> the create call carries the six denies, off -> none; FDC `fanout --collect --read-only` with enforcement on: the agent's reply is written to `DIR/<name>.md` while its scripted `Edit` of an input is refused. MC-03: create a read-only probe on the installed Paseo, confirm an `Edit` is refused and its reply still reaches the collect file, or record "advisory".
- Source: RUN-20, WFL-51, FIL-46, D-19, RUN-71.
- Scope: v1

### PHCL-28 Prompt assembly
- Requirement: the first prompt is `[Your role (<type>), complete below:\n\n<body>]` + `[These files are already loaded in full below; do not open them and do not call the Skill tool for them.\n\n===== <rel> =====\n<text>...]` (only with a definition) + the trimmed task, joined by `\n\n---\n\n`, then `\n\n---\nRuntime notes:\n- <note>` lines in this order: (1) workflow agents `Your final message is the return value for the orchestrating script, not a message to a person: return only the data asked for.`, all others `Work silently: no narration, plans or commentary between tool calls (nobody reads them); only your final reply, in the format asked for.`; (2) teammate note for kind `team` (PHCL-30); (3) read-only note; (4) worktree note, else working-directory note; (5) first-prompt note + platform note (PHCL-29); (6) `Run <runId> #<n> (bookkeeping only; ignore).` for workflow agents. The definition path and its `tools:` list never appear; included files are never referred to as "read X first". The assembled text is size-checked (PCLI-05).
- Acceptance: golden-string tests for: no definition; definition with includes; team; read-only; worktree; workflow with run tag; a rendered typed prompt contains no `tools:` and no `.agents/agents/` path.
- Source: RUN-21, WFL-22, RUN-71, D-36.
- Scope: v1

### PHCL-29 First-prompt and platform notes
- Requirement: note (5) = the kit-owned `first_prompt_note` (an overlay value is ignored, CONF-14) + the project's `project_prompt_note` (string, overlay, shipped `""`; empty adds nothing) + `platform_notes[process.platform]`, space-joined in that order, each appearing once. The kit base note states: batch reads/edits with the harness-files mod tools when enabled, else native Read/Edit/Write where owner restrictions permit; scripts that write files use UTF-8; never send messages to the main/leader session, report only in the final reply of the turn; output per response is capped, so write long documents in parts (each tool call under about 300 lines) and keep the final reply short. `platform_notes.win32`: never round-trip text files through PowerShell Get-Content/Set-Content (they re-encode non-ASCII text). No fsbatch/filesystem or other legacy tool names.
- Acceptance: integration through `loadConfig` and the real prompt assembly: overlay `project_prompt_note: "P"` and `first_prompt_note: "X"` -> the rendered prompt has the kit note exactly once, then `P`, and no `X`; on win32 the platform note follows; grep of shipped defaults finds no `fsbatch`/`mcp__filesystem`; the base note contains the leader and 300-line clauses.
- Source: RUN-23, INV-45, INV-52, S-17, D-35, CONF-14.
- Scope: v1

### PHCL-30 Teammate note
- Requirement: agents of kind `team` (spawn, fanout without `--collect`) get `You are the teammate "<name>" of a Paseo agent team led by agent <leader id8>. The leader sends you follow-up messages and you keep your context between them; end every turn with your reply to the leader. Shared task list: \`<PH> task list --ws <ws>\` and \`<PH> task update --ws <ws> <id> --status <status>\`; message a teammate: \`<PH> send --prompt "..." <teammate>\`.` where `<PH>` = `node "<absolute ph.mjs path, forward slashes>"` and `<ws>` = the `--ws` dir or the literal `<workspace>`; no project root in the note.
- Acceptance: FDC spawn prompt contains the name, the leader id8 and a ph path that runs (`node <path> help` exit 0 in the test).
- Source: RUN-24, D-36.
- Scope: v1

### PHCL-31 Worktree creation
- Requirement: `ph spawn --worktree` and workflow `isolation:'worktree'` create `<repo top>/<worktree_dir>/<name>` (config `worktree_dir`, shipped `.claude/worktrees`) on branch `harness/<name>` from HEAD, with `<name>` sanitized to `[A-Za-z0-9._-]` (spawn: `<agent name>-<stamp>`, workflow: `<runId>-<n>`); not in a git repo -> `isolation 'worktree' needs a git repository`; when agent creation fails the new worktree and branch are removed; the agent gets `You work in the git worktree <path> (branch <branch>): edit files only there, run git and shell commands with that directory as their working directory, and use absolute paths.`; worktrees are kept after the run for the orchestrator to merge.
- Acceptance: temp git repo (path with spaces): spawn `--worktree --name "a b"` -> directory and branch with a sanitized name; FDC create failure -> no worktree or branch left; outside git -> the error, zero creates.
- Source: RUN-55, D-26.
- Scope: v1

### PHCL-32 ph worktrees list and prune
- Requirement: `ph worktrees [--prune] [--runs-dir D]` lists git worktrees under `<top>/<worktree_dir>` on `harness/*` branches (case-insensitive path compare on win32) as `<state padded 22> <branch> <path> (<owner>)`; owner: `wf_<stamp>_<hex>-<n>` = run (in use only when its `run.json` is `running` with a live pid), `<name>-<stamp>` = spawned agent (in use when a non-archived agent labelled `harness.name=<name>` exists; daemon unreachable -> `note daemon not reachable (...): worktrees of spawned agents are kept`), else unknown; states `directory missing`, `owner unknown`, `in use`, `uncommitted changes`, `<n> commit(s) not in HEAD`, `merged and clean`; `--prune` removes only `merged and clean` and `directory missing` entries: `git worktree remove` for an existing directory; for a missing directory only that entry's registration is removed by a supported targeted mechanism, and the repo-wide `git worktree prune` is never run; when no targeted removal is possible the entry is kept and reported (`kept <name>: registration of a missing directory cannot be removed without touching others`); then `git branch -d` (`removed <name> and branch <b>` / `removed <name>; branch <b> kept (...)`); summary `worktrees: <n> listed, <k> removed`; not a git repo -> exit 1; none -> `no harness worktrees`; a failed removal -> exit 2.
- Acceptance: temp repo with a merged clean, a dirty, an ahead, and a missing-directory worktree plus an unrelated stale worktree record: `--prune` removes the merged clean one, removes the missing one or keeps it with the `kept` line, and touches nothing else; the unrelated stale record stays in `git worktree list --porcelain`; a command spy shows no argument-less `git worktree prune`.
- Source: RUN-56, HIS-24, WFL-29, D-26.
- Scope: v1

### PHCL-33 Refuse a caller outside the project root
- Requirement: agent-creating commands (`spawn`, `fanout`, `workflow`) refuse when the caller agent's working directory reported by the daemon is not inside the project root (case-insensitive on win32), with `caller <id8> works in <dir>, outside the project root <root>; run ph from an agent of this project`, exit 1, nothing created.
- Acceptance: FDC caller with cwd `C:/other` -> exit 1 and zero creates; cwd `<root>/sub` -> allowed.
- Source: HIS-28, D-26, INV-10.
- Scope: v1

### PHCL-34 Platform gates and Claude CLI lookup
- Requirement: one shared platform module: Node gate = major and the capabilities the code really uses (shipped check: Node >= 20.17 with `path.matchesGlob`); Claude CLI = `$CLAUDE_CLI`, else `~/.local/bin/claude(.exe)` when present, else `claude` on PATH; `.js/.cjs/.mjs` CLIs run through the current node, on win32 any non-`.exe/.com` through cmd.exe with one quoted command line; `claudeVersion()` runs `--version` (10 s timeout) -> trimmed stdout or null; `versionAtLeast(text, min)` -> true/false, null without `x.y.z`. M1 and M2 use the same module.
- Acceptance: unit: `versionAtLeast('2.1.296 (Claude Code)','2.1.296')` true, `'2.1.295'` false, `'none'` null; win32 test with a fake `claude.cmd` in a path with spaces runs through cmd.exe and returns its version.
- Source: RUN-60, INV-52.
- Scope: v1

### PHCL-35 ph task
- Requirement: `ph task add|update|list|get --ws D` keeps `<ws>/tasks.json` `{tasks:[{id,title,assignee,depends_on,status,notes,updated}]}` (BOM stripped on read, atomic write, written only when changed) under an exclusive lock `tasks.json.lock` (wait up to 10 s in 100 ms steps, steal a lock older than 30 s, else `task list locked: <lock>`); statuses `pending|in_progress|completed|blocked`; `add --title T [--assignee] [--depends-on 1,2] [--notes] [--status]` -> `task <id> added` (id = max + 1; unknown dependency -> error); `update ID [...]` -> `task <id> <status>` (`--depends-on` replaces, `""` clears; self, unknown or cyclic dependency -> `invalid dependency ...`; unknown task -> `no task <id>`); `list [--assignee] [--status]` -> `<id> <status> <assignee|-> <title>[ after 1,2][ READY]` (READY = pending with all dependencies completed); `get ID` -> task JSON. It is ephemeral team coordination in the workspace dir, never planning state.
- Acceptance: three tasks with dependencies -> only the ready one marked READY; a 1->2->1 cycle -> `invalid dependency`; two processes updating in parallel 20 times lose no write.
- Source: RUN-53, D-18.
- Scope: v1

### PHCL-36 ph freeze
- Requirement: `ph freeze --ws D --phase P` writes `D/freeze_P.sha256` with `<sha256>  <file>` lines for every regular file `P_*` directly in D, sorted (`no P_* files in D` when none) and prints `frozen P: <n> files -> <record>`; `--check` recomputes and prints `freeze ok P: <n> files` exit 0, or `freeze CHANGED P: modified f; missing f; new f` exit 2; a missing record -> `no freeze record <path>` exit 1.
- Acceptance: freeze, edit one file, add one -> `--check` exit 2 naming `modified` and `new`; the record verifies with `sha256sum -c` where available.
- Source: RUN-54, D-21, WFL-51.
- Scope: v1

## v1 Requirements: M6 workflow (FLOW)

### FLOW-01 Script format
- Requirement: a script's first statement (after one stripped BOM, whitespace and comments) is `export const meta = {...}`; the literal is rejected when, after stripping comments and string contents, it contains `(`, `)`, a backtick or `...` ("pure literal"); it is evaluated in an empty context (1000 ms) and JSON-cloned; `meta.name` and `meta.description` are required non-empty strings, `meta.phases` optional array of `{title}`; the meta statement is blanked keeping newlines and the body is wrapped so top-level `await`/`return` work and thrown errors report the file's own line numbers.
- Acceptance: unit `parseScript`: meta with a template string or a call -> "pure literal" error; a commented-out `export const meta` before code -> rejected (not first statement); missing `description` -> error; an error thrown on body line 12 reports line 12; a BOM-prefixed script parses.
- Source: WFL-01, WFL-52(a).
- Scope: v1

### FLOW-02 Determinism guards
- Requirement: inside scripts `Math.random()`, `Date()`, `new Date()` without arguments and `Date.now()` throw with a message telling the author to pass times through `args` and vary prompts by index (`new Date(x)`, `Date.UTC`, `Date.parse` work); the script context offers no ambient `require`, `import`, `process`, file or network API; host commands run only through `shell()` (FLOW-11), which intentionally executes them; these guards serve determinism and are not a security sandbox (FLOW-49); `console.log|info|warn|error` map to `log`, any other console method throws.
- Acceptance: each of the four calls fails the run with the message; `new Date(0)` works; `console.table` fails clearly; `require` is undefined.
- Source: WFL-02, WFL-52(b), D-87, INV-22.
- Scope: v1

### FLOW-03 agent() returns a value, configuration errors throw
- Requirement: `agent(prompt, opts?)` resolves the reply string, the validated object (with `schema`) or `null` with a journaled reason, and never rejects for agent-side failures (runner exception -> `null` with `runner error: <msg>`; unknown `agentType`, missing include, model resolution error, worktree outside git -> `null` with that message); it throws for configuration errors (unknown option, invalid schema, `isolation` other than `'worktree'`, budget exhausted, agent cap reached); inside `parallel`/`pipeline` a throw becomes a `null` item with a logged warning.
- Acceptance: fake runner `{status:'null'}` -> `null` in the script; unknown option -> a direct `await agent()` fails the run, the same call inside `parallel` yields `null` and a `log warning:` line.
- Source: WFL-03, INV-21.
- Scope: v1

### FLOW-04 agent() options
- Requirement: allowed options are exactly `label, phase, schema, agentType, role, model, effort, isolation, readOnly, cwd, keep, session`; `role` is the role input of PHCL-22; `label` defaults to `phase ?? current phase ?? "agent"`; `phase` defaults to the last global `phase()`; `model`/`effort` follow PHCL-22; `readOnly:true` adds the read-only note; `cwd` resolves against the root and is a prompt instruction plus the daemon `cwd`; `keep:true` leaves the agent unarchived; title = `<meta.name>:<label>`.
- Acceptance: `agent('x', {bogus:1})` throws `unknown option 'bogus'`; label defaults to the active phase title; FDC title equals `<name>:<label>` (cut at 60, PCLI-08).
- Source: WFL-04, W-03.
- Scope: v1

### FLOW-05 pipeline()
- Requirement: `pipeline(items, ...stages)` runs every item through all stages independently (no barrier; stage gets `(previous, item, index)`); a throwing stage makes that item `null` (`log warning: pipeline item <i> -> null: <msg>`) and skips its later stages; a stage returning `null` passes `null` on; non-array -> TypeError; more than 4096 items -> error; results keep item order.
- Acceptance: with a fake runner, stage 2 of item A starts before stage 1 of item B ends; a throwing stage yields `null` for that item only.
- Source: WFL-05.
- Scope: v1

### FLOW-06 parallel()
- Requirement: `parallel(thunks)` runs all thunks concurrently and waits for all; a throwing thunk resolves `null` (`log warning: parallel item <i> -> null: <msg>`); the call never rejects; non-array -> TypeError; more than 4096 items -> error.
- Acceptance: one of three thunks throws -> result `[a, null, c]`, no rejection.
- Source: WFL-06.
- Scope: v1

### FLOW-07 phase() and log()
- Requirement: `phase(title)` sets the current phase and prints `phase <title>`; when `meta.phases` exists and no entry's `title` equals it, prints `log warning: phase "<t>" has no entry in meta.phases`; `log(m)` prints `log <m>`.
- Acceptance: unknown phase -> the warning line; `log('a')` -> `log a`.
- Source: WFL-07.
- Scope: v1

### FLOW-08 args
- Requirement: the global `args` is the JSON of `--args` or `--args-file` (BOM stripped) verbatim, `undefined` when none; both flags -> usage error; a nested workflow gets the JSON-cloned args it was called with; a resumed run without args reuses the saved `args.json`.
- Acceptance: `--args '{"a":1}'` -> `args.a === 1`; `--resume R` alone sees R's args; both flags -> exit 1.
- Source: WFL-08.
- Scope: v1

### FLOW-09 budget
- Requirement: `budget = {total, spent(), remaining()}`; `total` from `--budget` (`500000`, `500k`, `1.5m`; else usage error) or `null`; `remaining()` = `max(0, total - spent())` or `Infinity`; `spent()` = output tokens of the run's agents (charged when each call returns) + the orchestrator's own output tokens during the run; once `spent >= total` new `agent()` calls throw; agents already running may overshoot (documented in the `ph` skill).
- Acceptance: `--budget 5`, fake runner charging 10 tokens, 5 queued calls with concurrency 1 -> exactly one runner call; `--budget 2x` -> exit 1.
- Source: WFL-09, D-25, RUN-70(c).
- Scope: v1

### FLOW-10 Nested workflow()
- Requirement: `workflow(nameOrRef, args?)` runs `.agents/workflows/<name>.js|.mjs` (only location) or `{scriptPath}` (relative to the root) inline and returns its JSON-cloned return value; the child shares semaphore, agent counter, journal, budget and cache, and has its own meta, phase and args; one level only (`workflow() nesting is one level only`); logs `log nested workflow <path>`; unknown name -> `no saved workflow '<name>' in .agents/workflows/`.
- Acceptance: a grandchild call throws the nesting error; a child's agents count in the parent's `started`; no `.claude/workflows` lookup (fs spy).
- Source: WFL-10.
- Scope: v1

### FLOW-11 shell()
- Requirement: `shell(cmd, {cwd, input, timeoutS, tailChars})` accepts two forms: a string, run by the platform shell exactly as Node's `child_process` shell option does (`/bin/sh -c` on POSIX, `cmd.exe /d /s /c` on win32; quoting is that shell's), or an argv array (`[file, ...args]`), run without any shell (each element one argument; on win32 a `.cmd/.bat` target goes through cmd.exe with one quoted command line, PHCL-34) — the argv form is the path for adapter commands (ADPT-02); cwd resolves against the root, `input` goes to stdin, timeout defaults to `wait_timeout_s`, output tails default to 20000 chars; it resolves `{code, stdout, stderr, durationS}` and never rejects: code = the process exit code (a launched shell reporting command-not-found is its own nonzero code, e.g. 127 or 1); -1 only when the process could not be launched (error in `stderr`) or timed out (the whole process tree is killed, stderr ends with `[timed out after <N> s]`); every call logs `shell start #<n> <cmd first 80 chars>` and `shell done #<n> code=<c> <s>s` and is journaled (kind `shell`); results are never cached (a resumed run reruns it).
- Acceptance: `shell('exit 3')` -> code 3; string with spaces and metacharacters (`echo "a b" && echo c`) -> stdout `a b` and `c`; argv `['node','-e','process.exit(4)']` -> 4, argv element `a;b` arrives as one argument; `input:'x'` read by the child; a string naming a missing binary -> the shell's nonzero code; argv naming a missing file -> -1 with the launch error; `timeoutS:1` on a command that spawns a sleeping grandchild -> resolves within 2 s and the grandchild pid is gone; resume reruns the shell call; the journal has a `shell` record.
- Source: HIS-23, W-03, D-22, ADPT-02.
- Scope: v1

### FLOW-12 Sessions
- Requirement: `agent({session: key})` creates one agent for the first call with that key and keeps it; later calls with the key send only their prompt to the same agent (per-call token accounting); a failed session call archives its agent and the next call starts a new one; run end (done, failed or stopped by the runner) archives every session agent unless `keep`; on resume a cached session call adopts its recorded agent so the next live call continues it (model readback and forgotten-agent rule: PCLI-16; ownership and attribution: FLOW-48); property compatibility and worktree reuse: FLOW-47; `session` is not part of the cache key.
- Acceptance: FDC: two calls with `session:'coder:a'` -> one create, two prompts; a fresh call without session -> new agent; resume after a cached first call -> the second call goes to the recorded agent id; run end -> archive call for the session agent.
- Source: HIS-16, W-03, D-22, GSP-43.
- Scope: v1

### FLOW-13 Structured output with the kit's own validator
- Requirement: `schema` must be `{type:'object', properties:{...}}` with every `required` key in `properties` and only the keywords of the kit's subset (FLOW-46) (else throw); the kit's own validator (FLOW-46; no Paseo `getStructuredAgentResponse`, no dependency on Paseo internals) checks the final message parsed as JSON (unparsable JSON is a validation error and gets a retry); on mismatch the same agent is asked again with the errors up to `schema_retries` (shipped 2) extra times; then `null` with reason `<error>: <first 3 validation errors joined by "; ">`; an unprimed non-session agent also gets the same schema object as native `outputSchema` at creation (session agents never get a native schema, FLOW-47); every retry wrapper is size-checked.
- Acceptance: FDC reply missing a required key -> one retry prompt in the same agent naming the error; three bad replies with `schema_retries` 2 -> `null` with three errors in the journal reason; schema with `required:['x']` and no `x` property -> throw.
- Source: WFL-11, RUN-67, D-30.
- Scope: v1

### FLOW-14 Admission: rolling pool, caps, budget
- Requirement: a counting semaphore of `max_subagents` (min 1) bounds active agents of the run including nested ones, queued FIFO and refilled as each call finishes (no batches); in addition each live call needs caller-wide running capacity: before a turn starts the host counts the caller's running subagents (teammates, other runs) plus this run's reserved calls, admits only while that total < `max_subagents`, holds the reservation until the call's tokens are charged, and re-counts on every own completion and at most every 5 s while calls wait (logging `log waiting for a free agent slot (<r> running of <m>)` once per wait); `max_agents_per_workflow` (shipped 1000) bounds started agents (`agent cap reached`); a call that needs a new agent (no reusable session agent) also needs a live slot (PHCL-24): it waits for one up to `wait_timeout_s`, but returns `null` at once when every live agent of the caller beyond the running ones is retained by this run (sessions, `keep`) and so cannot free, the reason being `live agent cap reached (<l> of <m>); end sessions or archive idle agents`; reuse of an existing session agent needs no live slot; budget and caps are checked before queueing and again after admission; a finished call's tokens are charged before its slot is released; cached hits skip budget, caps and semaphore.
- Acceptance: fake runner with 40 calls of unequal durations and cap 20: at every completion instant 20 are running until fewer than 20 remain; FDC with 19 running teammates and 5 queued calls: at most one call runs until a teammate goes idle, then a second starts; the budget recheck test of FLOW-09 passes; 10 cached calls produce zero runner calls and no semaphore waits; `max_live_subagents` 40 and 41 distinct session keys in sequence -> call 41 is `null` with the live-cap reason without waiting; a 42nd call reusing session 1 still runs.
- Source: WFL-12, HIS-89, INV-47, INV-12, D-20, RUN-11, RUN-29.
- Scope: v1

### FLOW-15 Resume cache key
- Requirement: cache key = sha256 over JSON of `{prompt, schema, agentType, model, effort, isolation, readOnly, cwd}` (defined fields only) + sha256 of the resolved role text (definition body + included files) + the resolved `provider/model` and resolved effort (after PHCL-22, so a role-table change invalidates); `role` itself is not hashed separately; `label`, `phase`, `keep`, `session` are not in it; the n-th call with a key maps to the n-th earlier entry (occurrence counter assigned synchronously at call time); only `ok`/`cached` journal entries with a key are loaded; a hit returns the stored result, journals a `cached` entry (tokens 0, duration 0), prints `agent cached #<n> <label>`; unparsable journal lines are skipped.
- Acceptance: run, then resume with the same script: 100 % cached, zero runner calls; edit one prompt -> only that call runs; edit `.agents/agents/x.md` or the tier's provider in the overlay -> calls of that type rerun; changing `gsd.roles.<role>.effort` reruns the calls with that role; adding a call with a new schema elsewhere in the script leaves the other calls cached.
- Source: WFL-13, WFL-14, RUN-70(b), HIS-83, D-29, INV-22.
- Scope: v1

### FLOW-16 Resume command
- Requirement: `--resume RUNID` requires `<runs-dir>/RUNID/journal.jsonl` (`cannot resume: <path> not found`); without `--script`/`--name` it reruns the saved `script.js`, without args the saved `args.json`; the new run records `parent: RUNID`; because every run creates an empty `journal.jsonl` at start, a run that never called `agent()` can be resumed.
- Acceptance: resume of a zero-agent run succeeds; resume of a missing id -> exit 1; the new `run.json.parent` equals RUNID.
- Source: WFL-13, WFL-52(d).
- Scope: v1

### FLOW-17 Journal
- Requirement: `journal.jsonl` is append-only, one JSON line per event: a `start` record when a call passes admission (`{n, kind:'agent', key, occ, label, phase, status:'start'}`), then a finish record `{n, key, occ, label, phase, agentId, model, status: ok|null|cached, reason, result, tokens, usage{input,cachedInput,output,maxContext,costUsd,reportedCostUsd}, duration_s}`, plus `shell` records; `n` is allocated only for calls that start, so numbers have no gaps; calls that throw before running write nothing.
- Acceptance: a mixed run's journal has one start and one finish per started call; killing the runner with two calls in flight leaves their two `start` records; `n` values are 1..k with no gap after a budget throw.
- Source: WFL-15, WFL-52(c), HIS-18.
- Scope: v1

### FLOW-18 Run directory and run.json
- Requirement: per run `<runs-dir>/<runId>/` (default `_workspace/_runs`) holds `script.js` (exact script), `args.json` (`null` when none), `run.json`, `journal.jsonl`, `log.txt`, `result.json`; `run.json` = `{runId, parent, script, status: running|done|failed|stopped, startedAt, endedAt, agents, budget, pid, name, description, error?}` written at start (status `running`) and rewritten at the end (done: `agents{started,ok,null,cached,tokens,costUsd}`; failed: `error`); `result.json` = the script's return value (`null` when undefined); every JSON write is atomic (temp + rename) with 2-space JSON and a trailing newline.
- Acceptance: a done run has all six files and `status: done` with counts; a failed script -> `status: failed`, `error` set, no `result.json`.
- Source: WFL-16, WFL-52.
- Scope: v1

### FLOW-19 Run id
- Requirement: run ids are `wf_<yyyymmdd>-<hhmmss>_<4 hex>` (local time + 2 random bytes, generated by the host, never by the script); `--run-id` overrides.
- Acceptance: id matches `^wf_\d{8}-\d{6}_[0-9a-f]{4}$`; `--run-id wf_x` is used verbatim.
- Source: WFL-17.
- Scope: v1

### FLOW-20 ph workflow command and exit codes
- Requirement: `ph workflow [--script F | --name N] [--args JSON | --args-file F] [--resume RUNID] [--budget N] [--runs-dir D] [--detach] [--run-id ID]`; one of `--script`/`--name`/`--resume` required, `--script` with `--name` is a usage error; config load, caller check (PCLI-06), caller-root check (PHCL-33), argument and budget parsing and `parseScript` all run before the run directory exists and fail with exit 1; afterwards a missing daemon/CLI or a script error rewrites `run.json` to `failed` and exits 2; success prints `workflow done <runId>: <runDir>/result.json (ok k, null m, cached c, tokens t, cost $x)` and exits 0.
- Acceptance: no flags -> exit 1, no run dir; invalid overlay -> exit 1, no run dir; script throwing -> exit 2 with `status: failed`; FDC success -> exit 0 and the final line.
- Source: WFL-18, RUN-58, INV-10, P4.
- Scope: v1

### FLOW-21 Detached runs
- Requirement: `--detach` performs every exit-1 check of FLOW-20 in the parent, then creates the run directory with `script.js`, `args.json` and `run.json` (status `running`, pid of the child), spawns a detached hidden child (`--run-id <id>`, stdout/stderr appended to `log.txt`, `PASEO_HARNESS_LOG_IS_STDOUT=1` so lines are not written twice), prints `workflow started <runId>: <log.txt>` and ``next: wait with Monitor running `<ph> watch-run <runId>[ --runs-dir <D>]`; do not poll with sleep/grep loops`` (`--runs-dir` included whenever the run is not under the default directory), and exits 0; foreground runs print each line and append it to `log.txt`.
- Acceptance: detached start without `PASEO_AGENT_ID` -> exit 1, no run dir; with FDC -> returns under 2 s, `run.json` exists before the parent exits, `log.txt` has no duplicated lines; a detached run with `--runs-dir <tmp>/runs` outside `_workspace/_runs`: the printed hint command follows it to its end, `ph run-stats <id> --runs-dir <tmp>/runs` reads it and `ph archive --run <id> --runs-dir <tmp>/runs` addresses it.
- Source: WFL-19, RUN-69(1), RUN-69(3), WFL-41, INV-18.
- Scope: v1

### FLOW-22 Progress line grammar
- Requirement: log lines follow exactly: `workflow start <runId> <runDir>`, `phase <title>`, `log <message>` (incl. `log warning: ...`, `log nested workflow <path>`, `log watchdog: ...`), `agent start #<n> <label> <id8> <model>`, `agent done #<n> <label> ok|null (<reason>) tokens=<n> cost=<usd|?> <s>s`, `agent cached #<n> <label>`, `shell start|done #<n> ...`, `workflow done|failed <runId>: ...`; the `ph` skill documents the grammar.
- Acceptance: a fixture run's `log.txt` matches one regex per line type, every line; skill doc lists the same line types (lint).
- Source: WFL-20, HIS-18.
- Scope: v1

### FLOW-23 Return value and un-awaited calls
- Requirement: the script's return value is JSON-round-tripped into `result.json`; a thrown error fails the run with the journal kept; calls the script started without awaiting are awaited by the host before `workflow done` is written, and their count is logged as `log warning: <k> agent() call(s) were not awaited by the script`.
- Acceptance: a script firing `agent()` without `await` -> the `workflow done` line comes after that call's `agent done` line, the warning names 1, no unarchived agent remains.
- Source: WFL-21, RUN-70(a).
- Scope: v1

### FLOW-24 Transport loss
- Requirement: after the first runner error whose first line matches `Transport (closed|not connected)` the runner logs `log runner lost the daemon connection (<err>): remaining agent() calls return null; resume the run` and every later `agent()` returns `null` at once with reason `daemon connection lost earlier in this run (<err>); resume the run`, creating no agent; there is no reconnect.
- Acceptance: FDC throws `Transport closed` on call 1 -> calls 2..5 return `null` with the reason and FDC records no further create.
- Source: WFL-27, RUN-69(2), D-34.
- Scope: v1

### FLOW-25 Agent lifecycle in runs
- Requirement: workflow agents carry labels `harness.run=<runId>`, `harness.name=<label>`, `ph.swarm=<workflow name>` and the parent label (PCLI-08) and the worker env (PCLI-09); the watchdog is armed at creation and disarmed in `finally`; every non-session agent is archived after its call unless `keep`, once (an agent already archived by the watchdog is not archived again); an archive failure logs `log warning: archive <id8> failed: <err>`.
- Acceptance: after an FDC run no agent labelled `harness.run=<id>` is unarchived except `keep:true` ones; a watchdog stop produces exactly one archive call for that agent.
- Source: WFL-28, RUN-69(5), WFL-52(e).
- Scope: v1

### FLOW-26 Null reason vocabulary
- Requirement: `null` results carry one of: `finished without a reply`, `no reply within <N> s`, `watchdog stopped the agent after <agent_stop_s> s`, `watchdog stopped the agent: second hung <tool> call`, `daemon connection lost earlier in this run (...)`, `runner error: <msg>`, `prompt is <bytes> bytes > max_prompt_bytes ...`, `agent error: <first line, 300 chars>`, a permission failure (PCLI-14), or a schema failure with up to three validation errors (FLOW-13); the reason is in the journal and the `agent done` line.
- Acceptance: one fixture per reason produces the exact text in both places.
- Source: RUN-69(4), D-28.
- Scope: v1

### FLOW-27 Worktree isolation for workflow agents
- Requirement: `isolation:'worktree'` creates the worktree of PHCL-31 named `<runId>-<n>` per call that creates a new agent and gives the worktree note; a reused session agent keeps its session's worktree and no new worktree is created (FLOW-47); a creation failure is that call's `null` reason; worktrees are kept for the orchestrator and pruned only through `ph worktrees --prune` (PHCL-32).
- Acceptance: temp repo: two calls with isolation create two worktrees on `harness/<runId>-1`/`-2`; outside git -> `null` with `isolation 'worktree' needs a git repository`.
- Source: WFL-29, D-26.
- Scope: v1

### FLOW-28 Role priming and warm-up gate, off by default
- Requirement: `prime_role` (`two-turn|off`, shipped `off`) and `warmup` (shipped `false`, `warmup_s` 8, `warmup_timeout_s` 90) keep their mechanisms: with priming on, a typed call first sends the role block + safety notes (read-only, worktree/cwd, first-prompt note) + `This message only loads your role. Reply with the single word READY; your task comes in the next message.`, waits for that turn, then sends the task prefixed `Task (your role, <type>, and its files are in the first message; do not open them again):` with the schema as text (no native `outputSchema`), and the `agent start` line gets ` prime:two-turn`; with warm-up on, the first agent per `runId|type|model|thinking` starts alone and the others wait for its gate (opened after its role turn, or `warmup_s` after creation, or in `finally` on failure) or `warmup_timeout_s`; the fallback timer is cleared when the wait ends. Spawn/fanout are never primed.
- Acceptance: defaults -> one prompt per agent, no gate; priming on -> FDC sees READY prompt then task, the first carries the read-only note; warm-up on with 3 same-type calls -> creates 2 and 3 happen after the gate; the `ph workflow` process exits within 1 s of `workflow done` (no lingering timer).
- Source: WFL-23, WFL-24, RUN-22, RUN-68, D-24, INV-23, S-15.
- Scope: v1

### FLOW-29 Watchdog: model time
- Requirement: for each workflow agent the watchdog computes `modelMs = now - promptAt - union(tool spans)`, where spans are `[inputAt, completedAt]` of finished calls and `[inputAt, now]` of open calls with complete input, clipped to `[promptAt, now]` and merged so overlapping calls count once; `promptAt` is set at arming and on every runner prompt (not on the watchdog's own messages); one process-wide 10 s unref'd ticker evaluates all armed agents and is cleared when none remain.
- Acceptance: FCLOCK: two overlapping 60 s tool calls in a 100 s window -> `modelMs` = 40 s; after the last disarm the ticker is cleared (process exits).
- Source: WFL-30, INV-20.
- Scope: v1

### FLOW-30 Tool clock starts when the input is complete
- Requirement: on a `running` event the call's input key (JSON of input fields only) is stored; `inputAt = now` only when the input is ready and either the key changed or `inputAt` is still null; a key change to a not-ready input leaves `inputAt` unchanged; readiness, keyed on exact tool names: `Write` needs `file_path`+`content`; `Edit` needs `file_path` and `new_string`; `MultiEdit` needs non-empty `edits`; `Bash` needs `command`; `Read` needs `file_path`; `mcp__harness-files__write_multiple_files` needs `files` whose entries all have string `content`; `mcp__harness-files__edit_multiple_files` needs `files` with non-empty `edits` or non-empty `fixes`; `mcp__harness-files__read_ranges` needs non-empty `ranges`; any other tool a non-empty input; Paseo typed details (`{type:'write', filePath, content}` etc.) are mapped to these shapes; time before readiness is model time.
- Acceptance: FCLOCK replay of the recorded incident (Write path at 0 s, content at 104 s, done at 104.2 s, file limit 180 s) -> no interrupt; Write running with path only, tick at +400 s -> no cancel and `modelMs >= 399 s`; add content, tick +181 s -> one cancel.
- Source: WFL-31, HIS-01, WFL-47, INV-20.
- Scope: v1

### FLOW-31 Finished calls stay finished
- Requirement: the watchdog keeps the ids of completed calls; a `running` event for a completed call id is ignored; only `tool_call` timeline items with a `callId` are processed; terminal statuses are `completed|failed|error|canceled|cancelled`; a completed call is processed once.
- Acceptance: feed `completed` then `running` for one id -> no open call afterwards and no stuck interrupt at +900 s.
- Source: WFL-32, HIS-02, INV-20.
- Scope: v1

### FLOW-32 Tool kinds by exact name
- Requirement: kinds come from a table of exact tool names: write = `Write, Edit, MultiEdit, NotebookEdit, mcp__harness-files__write_multiple_files, mcp__harness-files__edit_multiple_files`; read = `Read, Grep, Glob, mcp__harness-files__read_ranges`; shell = `Bash` (and `PowerShell` where present); everything else `other`; for `Bash` only a command that redirects to a file (`>`/`>>` outside `=>`/`>&`) or calls `writeFileSync|appendFileSync|Set-Content|Out-File|Add-Content` counts as write; no prefix regexes for dropped adapters (fsbatch, filesystem, Codex names).
- Acceptance: unit: table lookups for each listed name; `node -e "a=>a"` is not a write; typed native `Read` details counted as reads; `mcp__fsbatch__read_ranges` -> `other`.
- Source: WFL-33, S-01.
- Scope: v1

### FLOW-33 Steering on loop, reread, piecemeal
- Requirement: on each completed call, at most one message per kind per prompt: `loop` = same tool + identical non-empty input key completed `watchdog_repeat_calls` (3) times since the last prompt or write; `reread` = one file path read `watchdog_same_file_reads` (3) times by read-kind non-search tools (paths from `file_path`, `filePath`, `path`, `paths[]`, `ranges[].path`, normalised to `/`, project-relative, case-insensitive); `piecemeal` = `watchdog_reads_without_write` (15) read-kind calls with no write between; a write-kind call first clears read, file-read and repeat counters and then counts itself once; sent signals are not cleared by a write; each signal logs `log watchdog: <label> <id8> <kind>: <json first 160 chars>` and sends the shipped steering text for that kind unchanged (D-35).
- Acceptance: three identical Grep inputs -> exactly one `loop` message; Read a, Write b, Read a, Read a -> no reread; three Reads of one path via `read_ranges` ranges -> one reread; 15 reads -> one piecemeal.
- Source: WFL-34, D-35.
- Scope: v1

### FLOW-34 Nudge and stop by model time
- Requirement: at `agent_nudge_s` (shipped 900) of model time since the last prompt the agent gets the shipped nudge text once per prompt (`log watchdog: ... nudged to finish`); at `agent_stop_s` (shipped 1800) it is archived, logged `... used <N> min of model time since its last prompt, stopped`, and the call returns `null` with `watchdog stopped the agent after <agent_stop_s> s`; 0 disables either limit.
- Acceptance: FCLOCK nudge 10 / stop 20, model-only agent: tick +11 s -> one nudge; +21 s -> one archive and the null reason; with nudge 0 no nudge is sent.
- Source: WFL-35, RUN-64.
- Scope: v1

### FLOW-35 Stuck tool: interrupt once, then stop with the real reason
- Requirement: an open call with complete input running longer than its limit is stuck; the limit depends on the tool's origin, not its activity kind: `agent_file_tool_stuck_s` (shipped 180) for read/write-kind non-shell tools, `agent_tool_stuck_s` (shipped 900) for every shell tool (`Bash`, `PowerShell`) even when FLOW-32 classifies its command as a write, and for all other tools; 0 disables; first hang: open calls cleared, the turn cancelled, the shipped retry text sent (`Harness watchdog: your <tool> call did not return and was interrupted. Check what it already changed (re-read the affected files), then continue the task with smaller calls (at most 3 files per batch call).`), and the runner waits for that retry turn instead of returning `finished without a reply`; a second hang in the same agent archives it with reason `watchdog stopped the agent: second hung <tool> call` and log `... one <tool> call ran <N> min without returning, stopped`.
- Acceptance: FCLOCK: file tool open 181 s after complete input -> one cancel + one retry message, the call's result is the retry turn's reply; a second hang -> archive with that reason; a `Bash` open 400 s -> untouched; a `Bash` `build > build.log` open 400 s -> read/repeat counters reset as a write, no interrupt; a `Write` open 181 s -> interrupted.
- Source: WFL-37, HIS-02, HIS-03, D-28, INV-20.
- Scope: v1

### FLOW-36 Watchdog messages bounded and best effort
- Requirement: every watchdog message goes through `sendPrompt` (PCLI-05); a send failure logs `log watchdog: message to <id8> failed: <err>`, does not throw, and counts as the signal for that prompt; cancel/archive errors are logged, never thrown.
- Acceptance: a 2000-char path with `max_prompt_bytes` 1000 -> the failure log line, no FDC send, run continues.
- Source: WFL-38, INV-11.
- Scope: v1

### FLOW-37 Watchdog reset
- Requirement: each runner prompt resets nudge flag, `promptAt`, tool spans, read counters, signals, repeat and file-read maps; it keeps the stuck-interrupt flag, open calls and finished ids; disarm removes the agent's state.
- Acceptance: after a reset a `reread` fires again for the same file; a second hang after a reset still stops the agent.
- Source: WFL-39.
- Scope: v1

### FLOW-38 Watchdog configuration
- Requirement: the watchdog reads `agent_nudge_s, agent_stop_s, agent_tool_stuck_s, agent_file_tool_stuck_s, watchdog_repeat_calls, watchdog_same_file_reads, watchdog_reads_without_write` and a real on/off switch (`watchdog_enabled`, shipped true; false arms nothing) through the M3 loader (project overlay may change them, D-110: no project values shipped); the numbers in the `ph` skill's tables are generated from `harness.defaults.json`.
- Acceptance: overlay `watchdog_enabled: false` -> no `log watchdog` line and no FDC cancel in a 2000 s FCLOCK run; doc-vs-defaults test: every watchdog number in the skill equals the defaults value.
- Source: RUN-64, RUN-65, RUN-10, WFL-36, D-36.
- Scope: v1

### FLOW-39 Watchdog scope
- Requirement: the watchdog arms only for workflow agents; `ph spawn`/`fanout` teammates are never nudged, interrupted, stopped or archived by it.
- Acceptance: FDC spawned agent exceeding all limits under FCLOCK -> no watchdog message or cancel.
- Source: WFL-40, D-27.
- Scope: v1

### FLOW-40 ph watch-run
- Requirement: `ph watch-run RUNID... [--all] [--from-start] [--runs-dir D]` (default `_workspace/_runs`) follows `<runs-dir>/<id>/log.txt` by appended bytes every 1 s (partial last line held, CR stripped) and prints `log`, `phase`, `workflow` lines and `agent done ... null (...)` lines (`--all`: every line), prefixed `[<last 4 of id>] ` when several runs; attaching to a log with lines prints `resuming <id>: skipped <N> earlier lines; current phase <p> (--from-start replays them)` plus any terminal line instead of replaying; a run ends on a `workflow done|failed` line, on `run.json.status` not `running` (`workflow ended (run.json status <s>)`), on a dead runner pid for 3 consecutive checks, reset when seen alive (`workflow interrupted (runner pid <N> is gone; end it with: ph archive --run <id>)`, EPERM = alive), on a missing run dir for 60 s (`workflow not found (no <dir>)`) or a run dir without `run.json` for 60 s (`workflow not started (no run.json in <dir>)`); exit 0 when all ended; no ids -> exit 1.
- Acceptance: fixtures: `status: stopped` + dead pid -> ends within 5 s; dead pid with `running` -> ends after 3 polls; a log of 500 lines -> one resume summary; a `null` agent line is shown without `--all`; a dir without `run.json` -> ends after 60 s (FCLOCK).
- Source: WFL-41, HIS-14, RUN-59, INV-19.
- Scope: v1

### FLOW-41 ph run-stats
- Requirement: `ph run-stats RUNID... [--transcripts] [--runs-dir D]` (default `_workspace/_runs`) prints per run from `run.json` + `journal.jsonl` (agents adopted from an earlier run count for this run, FLOW-48): `<id> [<roles>] status <s>`; `wall <s> s; agents <n>: median <s> s, slowest <s> s; tokens in <i> cached <c> out <o>; cost $<x|?>`; with `--transcripts` also tool-call counts per kind (FLOW-32 table) from Claude Code transcripts under `<CLAUDE_CONFIG_DIR|~/.claude>/projects/<cwd slug>` matched only by the exact `Run <runId> #<n>` tag; a missing run or journal -> `failed <id>: <reason>` and exit 2 (no stack trace).
- Acceptance: fixture run: numbers equal the journal sums; a tagged transcript counted, an untagged transcript of the same time window not; missing run -> exit 2 with one `failed` line.
- Source: WFL-42, RUN-59, D-25, D-31.
- Scope: v1

### FLOW-42 ph runs and pruning
- Requirement: `ph runs [--runs-dir D]` lists `<runId> <status> <startedAt> <name>` newest first; `--prune` deletes `done` and `stopped` run directories beyond the newest `runs_keep` (shipped 20), never `failed` or `running` ones and never a run with a live pid, printing `removed <runId>` per run and `runs: <n> listed, <k> removed`.
- Acceptance: fixture with 25 done, 2 failed, 1 running -> `--prune` removes the 5 oldest done only.
- Source: D-33, WFL-47.
- Scope: v1

### FLOW-43 Engine with an injected runner
- Requirement: the engine `runWorkflow({...})` imports no Paseo code and receives from the host: the script and args; the run id; the limits (`maxConcurrent`, `maxAgents`, budget total) taken from config; the journal path and loaded cache; output, clock and child-script resolution; the orchestrator's extra spend; and host functions for (a) resolving a call's identity before the cache lookup (resolved role-text hash, `provider/model`, effort, FLOW-15), (b) admission beyond the run semaphore (caller-wide running and live capacity, FLOW-14), (c) adopting the recorded agent of a cached session call (FLOW-12, FLOW-48), and (d) running a live call: `runner(spec) -> {status:'ok'|'null', result, reason, agentId, model, tokens, usage, durationS}` with `spec = {n, runId, workflowName, label, phase, prompt, opts}`; it returns `{result, meta, stats:{started, ok, null, cached, tokens}}`; the Paseo-backed host (PCLI, PHCL prompt assembly, watchdog) is a separate module. Names of the host functions are an implementation choice.
- Acceptance: the FLOW-01..FLOW-17 tests run against fake hosts with no network; a pure-engine test with non-default limits (`maxConcurrent` 2, `maxAgents` 3) enforces them; a host spy shows a cached session hit calls the adoption function with the recorded agent id and never the runner; grep: engine file imports nothing from `paseo-client/`.
- Source: WFL-49, P11.
- Scope: v1

### FLOW-44 Workflow authoring guide in the ph skill
- Requirement: the workflow recipes reference (`workflow-recipes.md`) is carried with its method content unchanged (all recipes and the cautions table: fan-out + adversarial verification, judge panel, loop until dry, budget-aware loop, custom type + schema + effort, tier choice), edited only in the adapter layer listed in its NOTICE (HARN-02: runtime paths and `ph` command forms, config key names, removal of the non-Claude MCP-adapter sentence); the `ph` skill (kit adapter layer, D-111) adds a short index linking to it and states the kit authoring rules: guard `null` per stage and `.filter(Boolean)` before aggregating; no needless barriers (`pipeline` by default); pass `opts.phase` inside parallel stages, never global `phase()`; give agents per-item extracts and paths, never whole corpus files; read `journal.jsonl` before diagnosing; keep scripts in files so `--resume` works; scripts never read the clock (host passes times in `args`).
- Acceptance: HARN-01's source-diff test covers `workflow-recipes.md` and every differing hunk is a NOTICE entry; skill lint finds each kit rule; every recipe script parses with `parseScript` and runs against a fake runner; grep finds no `fsbatch`/MCP-adapter sentence.
- Source: WFL-45, WFL-46, WFL-50, D-87, D-111, HARN-01, HARN-02.
- Scope: v1

### FLOW-45 Workflow consent rule
- Requirement: the `ph` skill states that a workflow runs only when the owner asked for one or an invoked skill or GSD command names `ph workflow` (that invocation counts as the request), and that main sessions orchestrate only through `ph` (native Agent/Workflow denied on the main provider); the method's execution modes (A workflow / B persistent team / C one-shot) and decision tree stay in the carried method text unchanged (HARN-01), only their runtime mapping to `ph` is adapter text (HARN-02).
- Acceptance: skill lint finds the rule and the deny statement; the statement does not mention `SendMessage` as denied on main; HARN-01's diff test covers `execution-modes.md`.
- Source: WFL-44, D-32, D-06, INV-06, D-111, HARN-01, HARN-02.
- Scope: v1

### FLOW-46 Schema subset of the kit validator
- Requirement: the kit validator supports exactly: `type` (`object, array, string, number, integer, boolean, null`, or an array of these), `properties`, `required`, `additionalProperties` (boolean), `items` (one schema), `enum`, `const`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, plus annotations `description`, `title`, `default`, `examples` (ignored); validation is recursive through `properties` and `items`; `integer` rejects non-integral numbers; a schema containing any other keyword (`$ref`, `oneOf`, `anyOf`, `allOf`, `pattern`, `format`, ...) is rejected when `agent()` is called (configuration throw, fail closed), never silently ignored; errors carry the JSON path (`/plans/2/id: expected string`); the native `outputSchema` sent at creation is the same schema object, so both checks give one meaning.
- Acceptance: per keyword one valid and one invalid fixture, nested object-in-array cases, an extra property under `additionalProperties:false`, a float under `integer`, unparsable JSON; a schema with `oneOf` throws at call time; a scan of every schema in the shipped workflow scripts (`.agents/workflows/*.js`) passes the subset check.
- Source: WFL-11, RUN-67, D-30.
- Scope: v1

### FLOW-47 Session invariants and session worktrees
- Requirement: a session key fixes, at its first live call, `agentType` with its resolved role-text hash, `role`, `readOnly`, `cwd`, `isolation` and the worker provider; a later call with the same key that changes any of them throws a configuration error `session <key> cannot change <property>; use a new session key`, before anything is created; `model` and `effort` may change and are applied through PCLI-16 (update + readback); session agents get no native `outputSchema`: every call's schema (none, the same or a different one) is validated per call by FLOW-13/FLOW-46 with the schema given as prompt text; with `isolation:'worktree'` the worktree is created once, on the session's first call, recorded in the journal with the session key, reused by every later call and by an adopted agent on resume (missing directory -> that call's `null` reason `session worktree <path> is gone`), and never created for a reused agent.
- Acceptance: FDC two-call fixtures changing each fixed property -> the throw and zero extra creates; a writable call after a read-only one with the same key -> throw; two calls with different schemas -> both validated by their own schema, no `outputSchema` in the create call; temp git repo: a coder session with isolation, two calls and a resumed third call -> one worktree, all three prompts name the same path, `git worktree list` shows no extra tree.
- Source: HIS-16, HIS-17, WFL-29, INV-22, D-26.
- Scope: v1

### FLOW-48 Ownership and attribution of adopted session agents
- Requirement: when a run adopts an agent recorded by an earlier run (cached session call, FLOW-12), the host records it in the run's `run.json` `adopted: [{agentId, session, fromRun}]` before the next live call and updates its `harness.run` label to the new run id when the client supports label updates; `ph archive --run <newRun>` archives own agents labelled with the run or listed in `adopted`; run end archives adopted session agents like its own; every prompt sent to a session agent after its first carries the line `Run <runId> #<n> (bookkeeping only; ignore).` of the current call, so `ph run-stats --transcripts` attributes those turns to the current run.
- Acceptance: FDC: run 1 with a session call, resume as run 2 with a cached first call and a live continuation -> `run.json.adopted` lists the agent, the continuation prompt ends with `Run <run2> #<n>`, `ph archive --run <run2>` archives it; a fixture transcript of that turn is counted by run-stats for run 2; with label updates unsupported the archive still finds it through `adopted`.
- Source: HIS-16, WFL-22, WFL-28, WFL-42, WFL-43.
- Scope: v1

### FLOW-49 Trusted-code limits stated in the ph skill
- Requirement: the `ph` skill's runtime guide states: workflow scripts are trusted project code; the script context is not a security boundary (a script can reach the host process); `shell()` runs host commands on purpose; a busy loop in a script hangs the runner (no body timeout); budget is checked before each new call so running agents can overshoot; write scripts like code you run and await every `agent()`. No sandbox is required.
- Acceptance: skill lint finds each of the five statements.
- Source: RUN-70, WFL-02, WFL-21.
- Scope: v1

## Later

- Stuck-tool interrupt (without archive) for persistent teammates (D-27 "at most"; WFL-40).
- Turn priming and warm-up on by default after a fixed benchmark of completed-task cost, cache fields and latency (D-24; WFL-23, WFL-24).
- Cross-process admission lock for `ph` capacity checks (check-then-create race between two `ph` processes; RUN-29 concern).
- Removal of the cwd/worktree prompt instruction once MC-02 shows Paseo honours a requested cwd (R-03; RUN-39).
- Trim of unused watchdog steering kinds or tool-kind entries after transcript measurement (D-43 analogue for the watchdog; WFL-33).

## Out of scope (dropped)

| item | reason |
| --- | --- |
| `isClaudeProvider`, `modes`, `provider_features`, MCP attach for non-Claude agents | S-01, owner: Claude Code only (RUN-17 part, RUN-18, RUN-62) |
| `.claude/agents`, `.claude/workflows`, `.claude/harness.config.json` fallbacks | S-02, W-02 |
| skill facades `.agents/skills/harness/scripts/*`, `shared_paths.mjs`, `workflow_engine.mjs` facade | S-02, D-10 (RUN-52, WFL-48) |
| Paseo CLI `getStructuredAgentResponse` dependency | D-30 |
| watchdog shell-text and Codex tool-name heuristics beyond the exact-name table | WFL-33 |
| project tiers, allowlists, thresholds, price data, prompt notes of any project | D-110 (RUN-65, RUN-66 data) |

## Traceability

| behavior | requirement(s) |
| --- | --- |
| RUN-11 | PHCL-23 |
| RUN-12 | PCLI-05 |
| RUN-13 | PHCL-21 |
| RUN-14 | PHCL-21, PHCL-04 |
| RUN-15 | PCLI-10, PHCL-04 |
| RUN-16 | PHCL-04 (doctor model-offered check); the add-a-model flow is documentation only |
| RUN-17 | PCLI-07 (`mode`, tier `features`); `modes`/`provider_features` dropped (S-01) |
| RUN-18 | not a requirement: dropped (S-01, Claude Code only) |
| RUN-19 | PHCL-26 |
| RUN-20 | PHCL-27 |
| RUN-21 | PHCL-28 |
| RUN-22 | FLOW-28 |
| RUN-23 | PHCL-29 |
| RUN-24 | PHCL-30 |
| RUN-25 | PCLI-01, PCLI-02, PCLI-04 |
| RUN-26 | PCLI-07, PCLI-08, PCLI-09, PCLI-11 |
| RUN-27 | PCLI-11 |
| RUN-28 | PCLI-06 |
| RUN-29 | PHCL-23, PHCL-24, PHCL-25 |
| RUN-30 | PCLI-15 |
| RUN-31 | PCLI-12, PCLI-13 |
| RUN-32 | PCLI-14 |
| RUN-33 | PCLI-05 |
| RUN-34 | PHCL-01 |
| RUN-35 | PHCL-02 |
| RUN-36 | PHCL-03 |
| RUN-37 | PHCL-04 |
| RUN-38 | PHCL-05 |
| RUN-39 | PHCL-06 |
| RUN-40 | PHCL-07 |
| RUN-41 | PHCL-08 |
| RUN-42 | PHCL-09, PHCL-10 |
| RUN-43 | PHCL-11 |
| RUN-44 | PHCL-12 |
| RUN-45 | PHCL-13 |
| RUN-46 | PHCL-15 |
| RUN-47 | PHCL-16 |
| RUN-48 | PHCL-17 |
| RUN-49 | PHCL-18 |
| RUN-50 | PHCL-19 |
| RUN-51 | PHCL-20 |
| RUN-52 | PHCL-01 (single entry; facade dropped, S-02) |
| RUN-53 | PHCL-35 |
| RUN-54 | PHCL-36 |
| RUN-55 | PHCL-31 |
| RUN-56 | PHCL-32 |
| RUN-58 | FLOW-20 |
| RUN-59 | FLOW-40, FLOW-41 |
| RUN-60 | PHCL-34 |
| RUN-61 | PCLI-09, PHCL-04 |
| RUN-64 | FLOW-34, FLOW-38 |
| RUN-65 | FLOW-38 (real watchdog switch), PHCL-22 (roles/tiers as adapter data); project values not carried (D-110) |
| RUN-66 | PHCL-14 |
| RUN-67 | FLOW-13, FLOW-46 |
| RUN-68 | FLOW-28 |
| RUN-69 | FLOW-21, FLOW-24, FLOW-25, FLOW-26 |
| RUN-70 | FLOW-09, FLOW-15, FLOW-23, FLOW-49 |
| WFL-01 | FLOW-01 |
| WFL-02 | FLOW-02, FLOW-49 |
| WFL-03 | FLOW-03 |
| WFL-04 | FLOW-04 |
| WFL-05 | FLOW-05 |
| WFL-06 | FLOW-06 |
| WFL-07 | FLOW-07 |
| WFL-08 | FLOW-08 |
| WFL-09 | FLOW-09 |
| WFL-10 | FLOW-10 |
| WFL-11 | FLOW-13, FLOW-46 |
| WFL-12 | FLOW-14 |
| WFL-13 | FLOW-15, FLOW-16 |
| WFL-14 | FLOW-15 |
| WFL-15 | FLOW-17 |
| WFL-16 | FLOW-18 |
| WFL-17 | FLOW-19 |
| WFL-18 | FLOW-20 |
| WFL-19 | FLOW-21 |
| WFL-20 | FLOW-22 |
| WFL-21 | FLOW-23, FLOW-49 |
| WFL-22 | PHCL-28 |
| WFL-23 | FLOW-28 |
| WFL-24 | FLOW-28 |
| WFL-25 | PCLI-05 |
| WFL-26 | PCLI-12, PCLI-13, PCLI-14 |
| WFL-27 | FLOW-24 |
| WFL-28 | FLOW-25 |
| WFL-29 | FLOW-27, FLOW-47, PHCL-32 |
| WFL-30 | FLOW-29 |
| WFL-31 | FLOW-30 |
| WFL-32 | FLOW-31 |
| WFL-33 | FLOW-32 |
| WFL-34 | FLOW-33 |
| WFL-35 | FLOW-34 |
| WFL-36 | FLOW-38 |
| WFL-37 | FLOW-35 |
| WFL-38 | FLOW-36 |
| WFL-39 | FLOW-37 |
| WFL-40 | FLOW-39 |
| WFL-41 | FLOW-40 |
| WFL-42 | FLOW-41, FLOW-48 |
| WFL-43 | PHCL-20, FLOW-48 |
| WFL-44 | FLOW-45; A/B/C method text carried unchanged by HARN-01, HARN-02 |
| WFL-45 | FLOW-44; recipes carried unchanged by HARN-01, HARN-02 |
| WFL-46 | FLOW-44 (`opts.phase` rule); the review-gate pattern itself is M10 code review (D-56) |
| WFL-47 | FLOW-30 (incident replay fixture), FLOW-42 |
| WFL-48 | not a requirement: dropped (S-02, single install location) |
| WFL-49 | FLOW-43 |
| WFL-50 | FLOW-44 |
| WFL-51 | PHCL-27, PHCL-36 |
| WFL-52 | FLOW-01, FLOW-02, FLOW-16, FLOW-17, FLOW-25, PCLI-13, PCLI-14 |
| WFL-53 | PCLI-11 |
| HIS-01 | FLOW-30 |
| HIS-02 | FLOW-31, FLOW-35 |
| HIS-03 | FLOW-35 |
| HIS-12 | PHCL-17, PHCL-18 |
| HIS-13 | PHCL-07 |
| HIS-14 | FLOW-40 |
| HIS-15 | PCLI-13 |
| HIS-16 | FLOW-12, FLOW-47, FLOW-48, PCLI-16 |
| HIS-17 | PCLI-16 |
| HIS-18 | PHCL-14, FLOW-17, FLOW-22 |
| HIS-22 | PHCL-11 |
| HIS-23 | FLOW-11, FLOW-02 |
| HIS-24 | PHCL-32 |
| HIS-28 | PHCL-33 |
| HIS-29 | PCLI-03 |
| HIS-83 | FLOW-15 |
| HIS-89 | FLOW-14 |
| UI-80 | PCLI-08 |

## Counts

- v1 requirements: 101 (PCLI 16, PHCL 36, FLOW 49)
- later items: 5
- behaviors traced: 128
- behaviors not a requirement: 2 (RUN-18, WFL-48)

## Revision log r1

| finding ID | accepted / rejected | what changed (requirement IDs) or why rejected |
| --- | --- | --- |
| SR-RTM-01 | accepted | RUN-70(a) keeps the trusted-code limits (map runtime.md:546). FLOW-02 now says no ambient API, `shell()` intentional, guards are not a sandbox; new FLOW-49 (trusted-code statements in the `ph` skill); RUN-70, WFL-02, WFL-21 traced to FLOW-49. |
| SR-RTM-02 | accepted | D-30 replaces Ajv, not the obligation. New FLOW-46 (keyword subset, recursion, fail-closed on unknown keywords, same schema for native `outputSchema`, scan of shipped schemas); FLOW-13 points to it and treats unparsable JSON as a retryable validation error. |
| SR-RTM-03 | accepted | FLOW-11: string form via Node's platform shell, argv form without a shell (the ADPT-02 path), -1 only for launch failure or timeout, process-tree kill asserted on a grandchild. |
| SR-RTM-04 | accepted | RUN-61 (map runtime.md:482) requires `enabled or direct`; SYNTHESIS's shorter wording dropped that condition. PCLI-09 restored the affirmative selection, effective worker-provider env (`extends`) as base, new matrix incl. unset, missing assets, other config dir, no settings write. |
| SR-RTM-05 | accepted | D-111 restores method references unchanged. FLOW-44 no longer trims recipes: carried unchanged with HARN-02 adapter edits plus a `ph` index; FLOW-45 notes A/B/C modes carried by HARN-01; WFL-44/WFL-45 rows cross-reference HARN-01/HARN-02. |
| SR-RTM-06 | accepted | FLOW-14 adds caller-wide running capacity (teammates and other runs counted, reservation until tokens are charged, re-count on completion and every 5 s) with a 19-running-teammates test. |
| SR-RTM-07 | accepted | PHCL-24: live cap counts new-agent allocations only; send/session reuse needs no slot; collect-mode `--keep` rule. PHCL-10: live slot per admission. FLOW-14: bounded wait (`wait_timeout_s`), immediate named `null` when all retained agents belong to the run; 41-session test. |
| SR-RTM-08 | accepted | FLOW-04 adds option `role`; PHCL-22 rewritten: explicit role input, model and effort resolved independently, valid role without entry falls back (ADPT-11), invalid role errors; FLOW-15 hashes the resolved effort; outline/planner split test. |
| SR-RTM-09 | accepted | CONF-14 (platform.md) now names `project_prompt_note` and makes `first_prompt_note` kit-owned; PHCL-29 uses those keys and its acceptance runs through `loadConfig` and real assembly. |
| SR-RTM-10 | accepted | D-97 wants one source; PANL-55 uses `context_guard.start_pct`. PHCL-16 default is now the effective `context_guard.start_pct` (60, overlay applies), no rotate constant; shared-fixture test below/at/above and with an overlay. The panel's choice of kit defaults stays as PANL-55 states it. |
| SR-RTM-11 | accepted | New FLOW-47: session worktree created once, reused by later and adopted calls, never created for a reused agent; FLOW-27 limited to calls creating a new agent. |
| SR-RTM-12 | accepted | FLOW-47: fixed session properties (type + role-text hash, role, readOnly, cwd, isolation, provider) throw on change; model/effort through PCLI-16; session agents get no native schema, per-call validation; FLOW-13 updated. |
| SR-RTM-13 | accepted | New FLOW-48: `run.json.adopted`, label update when supported, `archive --run` and run end cover adopted agents, run tag on every later session prompt; FLOW-41 counts adopted agents; WFL-42/WFL-43 traced. |
| SR-RTM-14 | accepted | `--runs-dir D` added to FLOW-40 and FLOW-41; FLOW-21 hint carries it for non-default dirs; test of a detached run outside `_workspace/_runs` through watch-run, run-stats and archive. |
| SR-RTM-15 | accepted | WFL-37 limits the 180 s limit to non-shell tools. FLOW-35 picks the limit by tool origin (shells always `agent_tool_stuck_s`); redirected 400 s Bash test added. |
| SR-RTM-16 | accepted | FLOW-43 lists the host inputs (run id, limits, journal/cache) and host functions (pre-cache identity, caller-wide admission, cached-session adoption, live runner) without fixing names; pure-engine tests with non-default limits and an adoption spy. |
| SR-RTM-17 | accepted | PCLI-01 scoped to the installed runtime (M4..M10); M13 plugins use `@getpaseo/plugin`; import scan distinguishes the SDK from `@getpaseo/cli`/`@getpaseo/server`. |
| SR-RTM-18 | accepted | PHCL-27: under enforcement a read-only agent returns its report and the caller writes it; roles that write artifacts use a scoped editing role (WFL-51); note text unchanged (D-35); PCLI-07 payload has `disallowedTools?`; collect test and MC-03 check the report path. |
| SR-RTM-19 | accepted | PHCL-32 states the observable contract (only that registration removed, no argument-less `git worktree prune`, keep and report when no targeted removal exists). |
