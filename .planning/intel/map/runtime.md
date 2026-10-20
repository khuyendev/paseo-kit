# Map: runtime (ph CLI, config, models, prompts, worktrees, daemon client)

Area code RUN. Sources: `kit:` = paseo-harness-kit at ref-final, `wildera:` = WildEraV6 89143da. Line numbers are 1-based and taken from the files as read.

## Coverage

| file | lines | read fully |
| --- | --- | --- |
| kit:project/.agents/harness.defaults.json | 125 | yes |
| kit:project/.agents/harness/config.mjs | 130 | yes |
| kit:project/.agents/harness/platform.mjs | 41 | yes |
| kit:project/.agents/harness/runtime/commands.mjs | 894 | yes (workflow/watchdog parts read for the ph-facing contract only; engine internals belong to map-workflow) |
| kit:project/.agents/harness/runtime/common.mjs | 40 | yes |
| kit:project/.agents/harness/runtime/daemon.mjs | 193 | yes |
| kit:project/.agents/harness/runtime/models.mjs | 36 | yes |
| kit:project/.agents/harness/runtime/plugins.mjs | 57 | yes |
| kit:project/.agents/harness/runtime/prompts.mjs | 93 | yes |
| kit:project/.agents/harness/runtime/worktrees.mjs | 73 | yes |
| kit:project/.agents/skills/harness/scripts/paseo_harness.mjs | 11 | yes |
| kit:project/.agents/skills/harness/scripts/shared_paths.mjs | 20 | yes |
| kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs | 137 | yes |
| kit:project/.agents/skills/harness/references/paseo-runtime.md | 433 | yes (sections 1-5, 7-11 mapped; section 6 read but owned by map-workflow, cited only where it conflicts with config) |
| kit:templates/harness.config.json | 4 | yes |
| wildera:.agents/harness.config.json | 75 | yes |
| wildera:.agents/model-prices.json | 158 | yes |
| wildera:.agents/harness/runtime/pricing.mjs (outside scope, read to understand model-prices.json) | 33 | yes |

Not read (other areas): kit runtime/provider_sync.mjs, skills_links.mjs, watchdog.mjs, workflow_engine.mjs, scripts watch_run/run_stats/runtime_regression.test.

## Summary

`ph` (`paseo_harness.mjs`) is a Node CLI that turns the Paseo daemon into the agent runtime of the harness. It does not call a `paseo` binary: `daemon.mjs` imports the npm-installed Paseo CLI's own client (`connectToDaemon`) and structured-output helpers and drives the daemon in-process. Every agent is created as a subagent of the calling Paseo agent (`PASEO_AGENT_ID`, label `paseo.parent-agent-id`), so agents are found by label, title or id prefix.

Config is two JSON layers: kit-owned `harness.defaults.json` (policy plus machine keys) and a per-project overlay `harness.config.json` (merged per entry for some map keys, replaced for the rest, machine keys ignored), validated by a type schema that fails closed (unknown or missing key = every ph command, hook and file tool fails). Model choice is tier names (frontier/pro/standard + aliases) or explicit `provider/model`, mapped to the worker provider `circle-agent`, gated by `allowed_models`, with thinking effort clamped to what the model offers.

Prompt assembly is deterministic text composition: role body + included files, the task, then a `Runtime notes` bullet list (silent/return-value, team wiring, read-only, worktree/cwd, first_prompt_note + platform note, run tag), with a hard byte limit.

Commands are small and uniform: one output line per item, `failed <what>: <err>` for item errors, exit 0/1/2. Long waits are delegated to `ph watch` under Monitor (a printed `next:` hint stops models from writing polling loops). Self-compaction is a detached watcher process that confirms success only by a token drop.

Worth keeping in spirit: caller-owned subagents with label lookup; fail-closed validated config; one-line-per-item output and 0/1/2 exit codes; the byte limit; deterministic prompt text; baseline-before-turn usage accounting; worktrees removed only when provably merged and clean; the watch hint. Drop: every non-Claude provider path (modes, provider_features, agent_mcp, MCP attach, isClaudeProvider heuristics), the `.claude`/`.agents` dual lookup, the skills mirror.

## Behaviors

### RUN-01 Config layering: defaults file + project overlay
- Behavior: Effective config = `harness.defaults.json` (kit-owned, `_`-prefixed keys stripped) merged with the project overlay. Overlay file is `.agents/harness.config.json`, else `.claude/harness.config.json`; absent overlay = defaults only. Root is `$PASEO_HARNESS_ROOT` else cwd. BOM stripped on read. Overlay must be a JSON object. Overlay keys starting `_` are ignored; machine keys are ignored; keys `__proto__`/`constructor`/`prototype` throw `invalid harness key`. The installer creates the overlay once and never overwrites it.
- Proposal: KEEP (single overlay path `.agents/harness.config.json` or the new kit's equivalent; drop the `.claude/` fallback).
- Source: kit:project/.agents/harness/config.mjs:7-8,13-17,23-33,99-107; kit:templates/harness.config.json:2
- Why it exists: kit update must replace defaults without touching project choices (kit:project/.agents/skills/harness/references/paseo-runtime.md:71-74).
- Test idea: overlay with `_notes`, an `agent_providers` key and `__proto__`: first two ignored, third throws; defaults object not mutated (kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs:106-118).

### RUN-02 Merge rule: per-entry for map keys, replace for the rest
- Behavior: Keys `tiers, tier_aliases, modes, provider_features, platform_notes, context_guard, io_guard, read_limits` shallow-merge per entry when the overlay value is an object (an overlay tier replaces that whole tier, not its fields); every other key is replaced wholesale (arrays like `allowed_models`, strings like `first_prompt_note`). `context_guard.model_pattern` is silently dropped from the overlay and provenance emits warning `context_guard.model_pattern is deprecated and ignored; main/worker identity controls compaction reminders` (shown by doctor as `note ...`).
- Proposal: CHANGE: keep per-entry merge for `tiers`, `tier_aliases`, `context_guard`, `io_guard`, `read_limits`; drop `modes`, `provider_features` (non-Claude); drop the `model_pattern` deprecation (new kit has no legacy). Consider deep-merging tier fields.
- Source: kit:project/.agents/harness/config.mjs:12,26-32,108-112; kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs:106-118
- Why it exists: not stated for the replace rule; model_pattern was replaced by main/worker identity (config.mjs:111).
- Test idea: overlay `io_guard: {step_rounds: 3}` leaves `start_rounds` at the default; overlay `allowed_models` replaces, not unions.

### RUN-03 Machine keys are central, not overlay-settable
- Behavior: `agent_providers, agent_provider_disallowed_tools, agent_provider_env, main_provider_disallowed_tools, agent_mcp` describe the one `~/.paseo/config.json` of the machine; the overlay cannot change them (dropped silently). `ph doctor` checks the Paseo-side values against them (via provider_sync, owned by another area); `sync_agent_provider.mjs --apply` adds missing entries and never removes owner rules.
- Proposal: KEEP `agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env`, `main_provider_disallowed_tools` as machine keys; DROP `agent_mcp` (non-Claude MCP adapters dropped).
- Source: kit:project/.agents/harness/config.mjs:9,27; kit:project/.agents/harness.defaults.json:2,33-63,77-81; kit:project/.agents/skills/harness/references/paseo-runtime.md:75-80
- Why it exists: a Paseo reinstall resets the provider's disallowedTools, so the kit keeps the requirement list and re-applies it (defaults:2); owner 2026-10-14 `main_provider_disallowed_tools` (memory main-session-no-native-subagents).
- Test idea: overlay setting `main_provider_disallowed_tools: []` does not change the loaded value.

### RUN-04 main_provider_disallowed_tools content
- Behavior: Default list is `Agent, Workflow, SendMessage`. Applied to the main providers (keys of `agent_providers`, i.e. `circle`) so a main session spawns no native subagents/workflows and sends no SendMessage; Paseo agents are reached with `ph send`.
- Proposal: KEEP (owner decision 2026-10-14; consistent with the 2026-10-20 decisions). CONFLICT noted below.
- Source: kit:project/.agents/harness.defaults.json:58-63
- Why it exists: one orchestration path (memory main-session-no-native-subagents).
- Test idea: loaded defaults contain exactly those three; doctor reports a missing one as `problem`.
- CONFLICT: the runtime doc lists only `Agent, Workflow` (kit:project/.agents/skills/harness/references/paseo-runtime.md:77-78) while defaults add `SendMessage` (defaults:62); the memory file also says Agent+Workflow only. Code/defaults win: three tools.

### RUN-05 agent_provider_disallowed_tools and agent_provider_env (worker provider)
- Behavior: Worker provider (`circle-agent`) must deny: Agent, AskUserQuestion, CronCreate, CronDelete, CronList, DesignSync, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, ListAgents, Monitor, PushNotification, ReportFindings, ScheduleWakeup, WebSearch, Workflow. Env added to the worker provider: `ENABLE_TOOL_SEARCH=true` (Claude Code tool search through the Circle proxy; file tools beyond the three batch tools, SendMessage, TaskStop, WebFetch are loaded on demand via ToolSearch).
- Proposal: KEEP (re-derive the list against the new kit's worker needs; note `Monitor` is denied for workers while the main session uses it).
- Source: kit:project/.agents/harness.defaults.json:36-57
- Why it exists: owner 2026-10-04 non-file worker restrictions kept in the kit because a Paseo reinstall would lose them (defaults:2).
- Test idea: doctor against a Paseo config lacking one entry prints a `problem` line naming it.

### RUN-06 Validation: closed schema, fail loudly
- Behavior: After merge, `validate` throws `invalid harness config <key>: <msg>` when: a key is not in the type table (`unknown key`), a table key is missing (`missing key`), type mismatch (object / string / strings = array of strings / boolean / integer = nonnegative safe integer). Extra rules: `max_subagents, max_agents_per_workflow, wait_timeout_s, max_prompt_bytes` > 0; each tier is an object with `provider` matching `^[^/]+/.+$` and only keys `provider, thinking, features`; `thinking` in `off|low|medium|high|xhigh|max`; `features` object; `default_tier` names a tier, an alias to a tier/model, or `provider/model`; `prime_role` is `two-turn|off`; map values string (`tier_aliases, modes, platform_notes, agent_providers, agent_provider_env`); every alias target is a tier or `provider/model`; `provider_features.*` objects; nested tables (`context_guard, io_guard, agent_mcp, read_limits`) have exactly their known keys with types; `context_guard.window_tokens` >= 1 and `start_pct`/`step_pct` in 1..100; `io_guard.step_rounds, edit_step_rounds` >= 1; `read_limits.*` >= 1 except `mediaTurnGapMs`; `fileMaxChars <= replyMaxChars < 500000`. The same validation runs on the kit defaults alone (`loadKitConfig`) and on the merged result.
- Proposal: KEEP the fail-closed idea and messages; CHANGE the table to the new key set (drop modes, provider_features, agent_mcp, warmup/prime if workflow drops them).
- Source: kit:project/.agents/harness/config.mjs:10-11,35-98,100-107
- Why it exists: comment says it is a type schema, "not a second default-value map" (config.mjs:34); 500000 is Claude Code's hard ceiling for `_meta["anthropic/maxResultSizeChars"]` (config.mjs:10-11).
- Test idea: each of unknown key, missing key, negative integer, bad thinking value, `fileMaxChars > replyMaxChars` throws the named message.

### RUN-07 Invalid config blast radius
- Behavior: An invalid overlay makes every ph command, hook and file tool call fail (loadConfig throws; `main` prints `failed: <msg>` exit 1). `ph doctor` only partly escapes this. (a) A JSON object that fails `validate` (unknown key, bad type, ...) is reported as one `problem` line and the rest of doctor runs with kit defaults (exit 2 if anything is a problem). (b) Invalid JSON is also caught by the same try/catch (the `problem` line is printed), but `configProvenance(ROOT)` at commands.mjs:60 re-reads the overlay with `readJson` outside any try, so doctor then aborts: `main` prints `failed: <JSON error>` and exits 1; the later checks do not run.
- Proposal: KEEP (a); CHANGE (b): doctor should survive an unparsable overlay and still print its remaining checks.
- Source: kit:project/.agents/harness/runtime/commands.mjs:33-36,59-61,883-887; kit:project/.agents/harness/config.mjs:104-112
- Why it exists: stated in the doctor message at commands.mjs:36.
- Test idea: overlay with an unknown key: `ph config` exits 1; `ph doctor` exits 2 and prints later checks. Overlay with broken JSON: today doctor exits 1 after one `problem` line (the new kit should keep going).
- Revised r1 (R1-RUN-04).

### RUN-08 ph config
- Behavior: prints the effective merged config as 2-space JSON plus `_provenance: {defaults, overlay, installedRoot, warnings}`; exit 0. Provenance is file-level only (no per-key source).
- Proposal: KEEP; optional CHANGE: per-key source tags (the doc claims "effective values and their sources").
- Source: kit:project/.agents/harness/runtime/commands.mjs:88-91; kit:project/.agents/harness/config.mjs:108-113; kit:project/.agents/skills/harness/references/paseo-runtime.md:68-69
- Why it exists: not stated.
- Test idea: output parses as JSON and `_provenance.overlay` equals the overlay path or null.

### RUN-09 Kit root / manifest resolution
- Behavior: `installedRoot(root)` reads `kit` from `.agents/harness-kit.json` (else `.claude/harness-kit.json`); with no manifest it is `new URL("../../../")` relative to `config.mjs` (three directories above `.agents/harness/`): the kit root when the runtime runs from the kit checkout (`<kit>/project/.agents/harness/`), and the PARENT directory of the project when run from an installed copy (meaningless there; the manifest normally exists). `shared_paths.mjs` is one directory deeper and goes four up, which lands on the project (RUN-52). (r1: the first draft said four levels; the reviewer's "directory that contains .agents" is also wrong, three `../` from `harness/` reach the parent of `project/` or of the installed project.) `kitManifest()` returns the manifest plus its `file`. Doctor prints `ok paseo-harness-kit <version> from <kit>, installed <installedAt> (differences: ...)` or `note no .agents/harness-kit.json: ...`.
- Proposal: CHANGE: whatever the new install writes; the runtime should not need a kit path at run time (see RUN-52).
- Source: kit:project/.agents/harness/config.mjs:19-22; kit:project/.agents/harness/runtime/daemon.mjs:93-96; kit:project/.agents/harness/runtime/commands.mjs:73-76
- Why it exists: not stated.
- Test idea: project without a manifest: doctor prints the `note` line.

### RUN-10 Shipped default values
- Behavior: `tiers`: frontier and pro = `circle/claude-opus-5-5[1m]` thinking high; standard = `circle/gpt-6.1-sol[1m]` thinking low. `tier_aliases`: fable->frontier, opus->pro, sonnet->standard. `agent_providers`: circle->circle-agent. `default_tier` standard; `mode` bypassPermissions; `allowed_models` []; `max_subagents` 20; `max_agents_per_workflow` 1000; `wait_timeout_s` 3600; `schema_retries` 2; `warmup` true, `warmup_s` 8, `warmup_timeout_s` 90; `prime_role` two-turn; `compact_resume` "Compaction done. Continue where you left off; re-arm any Monitor you stopped."; `context_guard` window_tokens 1000000, start_pct 60, step_pct 5; `io_guard` start_rounds 2, edit_start_rounds 2, edit_step_rounds 2, step_rounds 2; `max_prompt_bytes` 262144; `agent_nudge_s` 900; `agent_stop_s` 1800; `agent_tool_stuck_s` 900; `agent_file_tool_stuck_s` 180; `watchdog_repeat_calls` 3; `watchdog_same_file_reads` 3; `watchdog_reads_without_write` 15; `read_limits` fileMaxChars 200000, replyMaxChars 450000, mediaPerTurn 1, mediaTurnGapMs 1000.
- Proposal: KEEP the numbers as starting points; re-decide model ids per owner; workflow/watchdog/warmup keys follow map-workflow's decision.
- Source: kit:project/.agents/harness.defaults.json:13-35,64-123
- Why it exists: see RUN-11, RUN-12 for the incident-driven ones; watchdog values: owner 2026-10-05 (nudge 300->900 because 5 min was too short for long text-generating tasks such as spec writing; stop 900->1800) (defaults:109); file-tool hang threshold 2026-10-14 (defaults:113).
- Test idea: loadKitConfig() equals these values (guard against silent default drift).
- CONFLICT: runtime doc says nudge 300 / stop 900 (kit:project/.agents/skills/harness/references/paseo-runtime.md:294-296); defaults say 900 / 1800 (defaults:110-111). Defaults win; doc stale.

### RUN-11 max_subagents = 20
- Behavior: Most agents of one orchestrator running at once. Lowered from the owner's 30 to 20 after a 30-agent partition run exhausted 32 GB RAM (about 54 claude processes, 12 GB, workflow runner out of memory). Each agent is about 350 MB (Claude Code process + MCP processes). Raise only with free RAM. Agents of a killed runner stay alive (idle) until archived.
- Proposal: KEEP 20 as default; see RUN-29 for what is counted.
- Source: kit:project/.agents/harness.defaults.json:2; kit:project/.agents/skills/harness/references/paseo-runtime.md:104,269-273
- Why it exists: 2026-10-04 OOM incident (above).
- Test idea: spawning 21 agents with 0 running fails with the max_subagents message and starts none.

### RUN-12 max_prompt_bytes = 262144
- Behavior: Any prompt above the limit is refused with `prompt is <bytes> bytes > max_prompt_bytes <limit>; pass a file path instead of inlining content`. Checked on the fully rendered text: in `createAgent` (before the model catalogue request), `sendPrompt`, `ph send` (before connecting), and on every workflow turn including schema/retry wrappers. UTF-8 byte length.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/prompts.mjs:60-64; kit:project/.agents/harness/runtime/daemon.mjs:109-110,133-135; kit:project/.agents/harness/runtime/commands.mjs:243-248,682-684; kit:project/.agents/harness.defaults.json:108
- Why it exists: a 42 MB prompt (a plan summary with mojibake) made the daemon drop the runner socket at its outbound high-water mark (run wf_20261004-153848_8eb7) (commands.mjs:659-660; paseo-runtime.md:274-275).
- Test idea: a 300 KB prompt to `ph spawn` and to `ph send` exits non-zero without creating an agent.
- Note: the error is a plain Error, not UsageError, so `ph send` prints `failed: ...` exit 1, while `spawn` catches it per agent as `failed spawn <name>: ...` exit 2.

### RUN-13 Tiers, aliases and resolveModel
- Behavior: `resolveModel(cfg, spec, effort, checkAllowed=true)`: (1) if `spec` is an alias and not also a tier name, replace by its target; (2) if a tier, take its `provider` (`provider/model` id), `thinking`, `features`; (3) else if it contains `/`, use as explicit id; (4) else `UsageError: unknown model tier '<x>' (tiers: a, b; or provider/model)`. If `allowed_models` is non-empty and the id (before provider mapping) is not in it: `model <id> is not in config allowed_models`. `effort` must be off/low/medium/high/xhigh/max else `unknown effort '<e>'`. Then the provider part is mapped through `agent_providers` (circle -> circle-agent). Result `{id, provider, model, thinking: effort ?? tier.thinking, features}`. Selection order for an agent: `--model` / `opts.model`, else the agent definition's `model:` (not `inherit`), else `default_tier`.
- Proposal: KEEP tiers + explicit ids; CHANGE aliases (fable/opus/sonnet): keep only if GSD agent definitions use upstream names, else DROP; see OPEN-1.
- Source: kit:project/.agents/harness/runtime/models.mjs:18-34; kit:project/.agents/harness/runtime/commands.mjs:94-96,648; kit:project/.agents/harness/runtime/prompts.mjs:34; kit:project/.agents/harness.defaults.json:27-35
- Why it exists: tiers are harness-neutral names; aliases keep upstream names working (defaults:2,27).
- Test idea: `--model opus` resolves to the `pro` tier; `--model circle/x[1m]` passes through and maps to `circle-agent/x[1m]`; an unknown word errors with the tier list.

### RUN-14 allowed_models
- Behavior: Empty = any model. Non-empty = exact-string allowlist of `provider/model` ids as written in the tier or `--model` (before `agent_providers` mapping); creation always enforces it, on the id before provider mapping. In `ph doctor` the per-tier lines never call `resolveModel` (they print `tier.provider` and are not allowlist-gated); `default_tier <t> -> <id>` calls it with `checkAllowed=true`, so a default tier outside the list is a `problem` line; only the later provider set used for the legacy MCP and file-MOD checks passes `checkAllowed=false`. WildEra lists both `circle/<id>` and `circle-agent/<id>` forms for every model, with the literal `[1m]` suffix, because matching is exact.
- Proposal: CHANGE: match on a normalized key (provider mapping applied, `[1m]` stripped) so one entry covers both prefixes.
- Source: kit:project/.agents/harness/runtime/models.mjs:22-29; wildera:.agents/harness.config.json:51-70; kit:project/.agents/harness/runtime/commands.mjs:48-57,63
- Why it exists: owner restricts which proxy models agents may use; the doubled entries are a workaround for exact matching (inferred, not stated).
- Test idea: allowlist `circle/gpt-6.1-sol[1m]` accepts tier standard and explicit `circle-agent/gpt-6.1-sol[1m]`, rejects `circle/other`.

### RUN-15 Thinking-effort clamping
- Behavior: `clampThinking(requested, supported)`: undefined if no request or the model lists no options; exact match if supported; if the requested value is not in the order off<low<medium<high<xhigh<max, undefined; otherwise the nearest supported level by index distance, ties to the higher level; `off` is never chosen implicitly (skipped unless it was the exact request); unknown option ids (e.g. `none`) are skipped, giving undefined. Supported ids come from `listProviderModels(provider)` -> model `thinkingOptions[].id`, cached per provider in the process; a failing catalogue call yields `[]` and thus no `thinkingOptionId`. The result goes to `createAgent` as `thinkingOptionId`. A catalogue miss (model absent, or the call throws) never blocks creation: the agent is still created with no `thinkingOptionId`. Doctor looks the model up under the tier's own provider prefix (`circle`), whereas `createAgent` uses the mapped worker provider (`circle-agent`); `model not offered by the provider` is a doctor `problem` only, and shows `thinking <clamped|default>` per tier.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/models.mjs:2-17; kit:project/.agents/harness/runtime/daemon.mjs:86-89,121-128; kit:project/.agents/harness/runtime/commands.mjs:48-55; kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs:73-80
- Why it exists: "never implicitly switch reasoning off" (models.mjs:3); a daemon catalogue that was not reloaded silently drops thinking (defaults:7).
- Test idea: `xhigh` over `[high]` -> high; `low` over `[off,medium,high]` -> medium; `medium` over `[low,high]` -> high; over `[none]` -> undefined.

### RUN-16 Adding or switching a model (operational flow)
- Behavior: Documented 7-step flow: chain (opts/--model/definition -> tier -> `circle` mapped to `circle-agent` -> daemon starts Claude Code with that model id); a Paseo provider only knows models listed in `~/.paseo/config.json` `agents.providers.<provider>.models`, so the new id must be added to BOTH `circle` (app sessions) and `circle-agent` (harness agents) as `<id>[1m]` with label and thinkingOptions (back up first); `paseo daemon reload` is required (else the app shows the default label and thinking is not applied, `thinkingOptionId` null); probe with `spawn --name probe --model circle/<id>[1m] --effort low --prompt 'Reply with exactly: OK'` and check `paseo ls --json` for provider `circle-agent/<id>[1m]` and the thinking; a self-report is no proof, the proxy answers Fast variants with base names; a running run keeps its model; the model OPTION as the script wrote it (`opts.model` / `args.model`) is part of the workflow resume cache key (changing it reruns every cached call), but changing a tier's `provider` in defaults or overlay does not invalidate cached calls (RUN-70); record the owner decision in memory.
- Proposal: KEEP as documentation (kit docs / `ph doctor` hint); the tier list itself moves to the project adapter.
- Source: kit:project/.agents/harness.defaults.json:3-12
- Why it exists: learned 2026-10-04 adding GPT-6 Astra Fast (defaults:4).
- Test idea: `ph doctor` reports `model not offered by the provider` for a tier whose model is missing from the catalogue.

### RUN-17 Session mode, provider features
- Behavior: Agents are created with `modeId = modes[provider] ?? mode` (`bypassPermissions`, because agents run unattended); `modes` has codex `full-access`, opencode `build`. `provider_features[provider]` is merged under the tier's `features` and passed as `featureValues` (OpenCode needs `auto_accept`). A tier's `features` (e.g. `fast_mode`) pass through; fast mode is off unless a tier sets it.
- Proposal: CHANGE: keep `mode` and tier `features`; DROP `modes` and `provider_features` (Codex/OpenCode dropped).
- Source: kit:project/.agents/harness/runtime/models.mjs:35; kit:project/.agents/harness/runtime/daemon.mjs:120,124-125; kit:project/.agents/harness.defaults.json:64-76
- Why it exists: a permission-asking mode stalls unattended agents (defaults:66).
- Test idea: tier with `features: {fast_mode: true}` yields `featureValues` in the create call.

### RUN-18 isClaudeProvider (provider identity heuristics)
- Behavior: Decides whether a Paseo provider id is Claude-based by reading `~/.paseo/config.json` (`$PASEO_HOME`) `agents.providers` (or `providers`): identity strings (runtime, harness, type, provider, command, executable) matching claude/circle -> true; codex/opencode/pi/omp -> false; follows `extends`; fallback name regex `^(claude|circle)(-agent)?$`. Used to skip MCP attach and to decide the MOD env.
- Proposal: DROP (Claude Code is the only harness); keep a small `paseoProviders()` reader only if env inheritance (RUN-26) needs it.
- Source: kit:project/.agents/harness/config.mjs:114-129; kit:project/.agents/harness/runtime/daemon.mjs:105,119
- Why it exists: "custom provider ids commonly inherit claude" (config.mjs:118).
- Test idea: n/a (dropped); the new `createAgent` always applies the MOD env.

### RUN-19 Agent definition loading and front matter
- Behavior: `loadAgentDef(type)` looks for `<root>/.agents/agents/<type>.md`, else `<root>/.claude/agents/<type>.md`; missing -> `UsageError: agent type '<type>' not found: <both paths>`. Front matter is parsed by a minimal parser: block between `---` lines; per line a trailing ` # comment` is stripped; `key: value` (surrounding quotes removed); `- item` lines append to the last key as a list; no multiline scalars. Fields used: `tools` (list joined with `, ` or string), `model` (`inherit` or empty = none), `include` (list or comma-separated repo-relative paths). Each include must exist (`agent type '<t>' includes a missing file: <rel>`); its text is pasted with its own front matter removed and trimmed. Result `{type, body (trimmed), tools, model, includes, readOnly}`.
- Proposal: KEEP the contract (type -> markdown with `tools`, `model`, `include`); CHANGE: one directory only (`.claude/agents`, since Claude Code is the only harness and it reads it natively), sanitize `type` (reject path separators), use a real YAML parser or document the subset.
- Source: kit:project/.agents/harness/runtime/prompts.mjs:10-44
- Why it exists: owner 2026-10-03: prompts say "follow X (in your prompt)", never "read X first", because every ux-designer called the Skill tool and read two references (kit:project/.agents/skills/harness/references/paseo-runtime.md:129-132).
- Test idea: definition with `include:` list and a `# comment` line loads with the body and included text without front matter; missing include errors with the path.

### RUN-20 Read-only derivation from `tools:`
- Behavior: a definition is read-only when it has a `tools` value that contains none of the words Edit, Write, MultiEdit, NotebookEdit and none of the mutating file-method names `edit_multiple_files, write_multiple_files, edit_file, write_file, move_file, create_directory` (matched as separate tokens, so `mcp__fsbatch__edit_multiple_files` counts). No `tools:` = not read-only. Read-only is advisory: it adds the NOTE_READONLY runtime note only; it grants and restricts no tools. Spawn/fanout `--read-only`, fanout block `read-only=true` and workflow `opts.readOnly` add the same note.
- Exact note text: `Read-only role: do not create, edit, move or delete files, except output files this prompt names.` (prompts.mjs:9).
- Proposal: CHANGE: keep the note; recognise the harness-files tool names of the new kit (`mcp__harness-files__edit_multiple_files`, `write_multiple_files`) and drop fsbatch/filesystem method names. Enforcement (disallowedTools per agent) is a possible improvement; OPEN-4 covers whether to enforce.
- Source: kit:project/.agents/harness/runtime/prompts.mjs:25-27,45-59; kit:project/.agents/skills/harness/references/paseo-runtime.md:382-386
- Why it exists: "Definition tools and read-only roles are advisory" (paseo-runtime.md:382).
- Test idea: `tools: Read, Grep` -> read-only note present; `tools: Read, mcp__harness-files__edit_multiple_files` -> absent.

### RUN-21 Prompt assembly order (composePrompt)
- Behavior: Final prompt = [role block, includes block] (when a definition exists and the role is not pre-primed) + task prompt (trimmed), joined by `\n\n---\n\n`, then `\n\n---\nRuntime notes:\n- <note>...`. Role block: `Your role (<type>), complete below:\n\n<body>`. Includes block: `These files are already loaded in full below; do not open them and do not call the Skill tool for them.\n\n` then `===== <rel> =====\n<text>` per file separated by blank lines. Pre-primed variant replaces the role parts with `Task (your role, <type>, and its files are in the first message; do not open them again):`. Notes, in order: (1) workflow kind -> `Your final message is the return value for the orchestrating script, not a message to a person: return only the data asked for.`; every other kind -> `Work silently: no narration, plans or commentary between tool calls (nobody reads them); only your final reply, in the format asked for.`; (2) team kind: teammate note (RUN-24); (3) read-only note if read-only; (4) worktree note, else working-directory note; (5) `first_prompt_note` + platform note; (6) `Run <runId> #<n> (bookkeeping only; ignore).` when a run tag is given. Result passes the byte limit (RUN-12). The agent definition's file path is deliberately not named, nor its `tools` list. Exact notes: working directory `Your working directory for this task is <dir>: run shell commands there and resolve relative paths against it.`; worktree as in RUN-55. Wording gap: the doc quotes the silent note shortened (`Work silently: no narration between tool calls; only your final reply, in the format asked for.`, paseo-runtime.md:145-146) whereas the code says `Work silently: no narration, plans or commentary between tool calls (nobody reads them); only your final reply, in the format asked for.` (prompts.mjs:8); the code is the contract.
- Proposal: KEEP the structure and the notes; wording is owner-reviewed text, so changes need owner say (cf. memory omp-prompt-review-first for the analogous rule).
- Source: kit:project/.agents/harness/runtime/prompts.mjs:7-9,45-59,72-84; kit:project/.agents/skills/harness/references/paseo-runtime.md:123-169
- Why it exists: agents that saw the file path opened and read it again (paseo-runtime.md:125-127); the run tag lets run_stats match transcripts to runs (paseo-runtime.md:395-396).
- Test idea: golden-string test of composePrompt for (no def, def with includes, team, read-only, worktree, tag).

### RUN-22 Role priming prompt (rolePrompt)
- Behavior: `rolePrompt(def, cfg, {readOnly, worktree, workdir})` = role + includes blocks, optional `Runtime notes:` with safety notes only (read-only, worktree/cwd, first note), and the final line `This message only loads your role. Reply with the single word READY; your task comes in the next message.`, joined by `---` separators and size-checked. Safety notes are in the priming message because constraints must already apply during the READY turn. Used only by workflow agents with a type when `prime_role` is `two-turn`; `ph spawn`/`fanout` are never primed.
- Proposal: OPEN: belongs to map-workflow (caching experiment); doc itself says priming savings are not guaranteed on current proxies.
- Source: kit:project/.agents/harness/runtime/prompts.mjs:65-71; kit:project/.agents/harness/runtime/commands.mjs:653-661; kit:project/.agents/skills/harness/references/paseo-runtime.md:133-140
- Why it exists: 2026-10-04 cache experiments: sending the task right behind the role message ("steer") merged both into one model call and the Circle proxy saved nothing; two turns: 4-8k uncached tokens per agent vs 15-16k (3 runs) (commands.mjs:653-656).
- Test idea: priming prompt ends with the READY sentence and contains the read-only note for a read-only def.

### RUN-23 first_prompt_note and platform_notes
- Behavior: Every first prompt gets `first_prompt_note` (one line from config) followed by `platform_notes[process.platform]` joined by a space; both optional. Default note: batch-read rule, harness-files MOD vs native Read/Edit/Write, legacy fsbatch/filesystem mention, UTF-8 for scripts. `win32` note: never round-trip text files through PowerShell Get-Content/Set-Content (re-encodes non-ASCII). A project overlay REPLACES the note (not merge); WildEra's replacement repeats the kit text and appends: never send messages to the main/leader session (no SendMessage or cross-session messages, owner 2026-10-18) and an output-per-response cap rule (owner 2026-10-19: write long documents in parts, each tool call under about 300 lines, short final reply). The 2026-10-18 clause also says to `report only in your final reply of the turn`.
- Proposal: CHANGE: drop the legacy-harness sentences; split into a kit base note and a project `first_prompt_note` appended (so a project does not copy kit text); keep platform_notes.
- Source: kit:project/.agents/harness/runtime/prompts.mjs:45; kit:project/.agents/harness.defaults.json:91-95; wildera:.agents/harness.config.json:49
- Why it exists: output-cap stall incident and SendMessage-to-leader rule from owner (wildera config:49); encoding rule from the Windows round-trip problem (defaults:94).
- Test idea: project note is present after the kit base note; on win32 the platform note follows it.

### RUN-24 Teammate (kind=team) note
- Behavior: Agents started by `ph spawn` and non-collect `ph fanout` get: `You are the teammate "<name>" of a Paseo agent team led by agent <leader id8>. The leader sends you follow-up messages and you keep your context between them; end every turn with your reply to the leader. Shared task list: \`<PH> task list --ws <ws>\` and \`<PH> task update --ws <ws> <id> --status <status>\`; message a teammate: \`<PH> send --prompt "..." <teammate>\`.` where `<PH>` = `node "<absolute path of paseo_harness.mjs with forward slashes>"`, `<ws>` = `--ws <dir>` or the literal `--ws <workspace>` when none was given.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/prompts.mjs:76-80; kit:project/.agents/harness/runtime/common.mjs:6-7
- Why it exists: teammates must be able to use the task list and reach siblings with ph (paseo-runtime.md:361-363).
- Test idea: spawned prompt contains the teammate name, leader id8 and a runnable ph path.
- CONFLICT: the doc says the note also carries the project root (kit:project/.agents/skills/harness/references/paseo-runtime.md:147-148); the code note has no project root (prompts.mjs:78). Code wins.

### RUN-25 Daemon client acquisition
- Behavior: `paseo()` (once per process) finds the npm-installed Paseo CLI dir: `$PASEO_CLI_DIR`, else for each PATH dir that holds `paseo`/`paseo.cmd` its `node_modules/@getpaseo/cli` and `../lib/node_modules/@getpaseo/cli`, else `%APPDATA%/npm/node_modules/@getpaseo/cli`, `/usr/local/lib/...`, `/usr/lib/...`; the first with `dist/utils/client.js`; none -> `UsageError: the npm-installed Paseo CLI was not found (npm i -g @getpaseo/cli, or set PASEO_CLI_DIR)`. It imports `dist/utils/client.js` (`connectToDaemon`), `dist/commands/agent/run.js` (`resolveStructuredResponseMessage` as `reply`) and the `./agent-response` package export of `@getpaseo/server` (`getStructuredAgentResponse` as `structured`), located at `<cli>/node_modules/@getpaseo/server` or `<cli>/../server` (neither found -> `@getpaseo/server (structured output) not found next to the Paseo CLI`, UsageError). Connects with `connectToDaemon({ target: { kind: "instance", home } })`, `home` = `$PASEO_HOME || ~/.paseo`; records the CLI version; `closePaseo()` closes the client in `main`'s finally. `ph doctor` prints `paseo cli <version> at <dir> (tested with 0.10.0); daemon reachable`.
- Proposal: OPEN (OPEN-2): this depends on the CLI's internal file layout, which can change between Paseo releases; the choice is to keep the in-process import, spawn the public `paseo` CLI with `--json`, or use a published client package. Whatever is chosen, isolate it in one adapter module with a version check in doctor.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:16-49; kit:project/.agents/harness/runtime/commands.mjs:38-43
- Why it exists: the structured-output loop and the client are only available inside the CLI package (not stated explicitly).
- Test idea: with `PASEO_CLI_DIR` pointing to a dir lacking `dist/utils/client.js` the error message above is shown and exit code is 1.

### RUN-26 createAgent: what is sent to the daemon
- Behavior: Order: size check -> requireCaller -> (provider env + MOD env) -> thinking clamp -> `client.createAgent({provider, model, cwd, callerAgentId: PASEO_AGENT_ID, title: name.slice(0,60), modeId, thinkingOptionId, initialPrompt, outputSchema, mcpServers?, featureValues?, env, labels})`. `env` = `{CLAUDE_CODE_PLUGIN_DIRS (MOD, see RUN-61), PASEO_HARNESS_LEADER: <caller>, PASEO_HARNESS_ROOT: <root>, PASEO_HARNESS_ROLE: "worker"}`; `labels` = `{paseo.parent-agent-id: <caller>, ...extra}` (spawn/fanout add `harness.name`; workflows add `harness.run` and `harness.name`). The provider's own env (following `extends`) is used only as the base when deciding MOD env. After creation the usage tracker subscribes; if that fails the agent is archived and `agent <id8> created but its usage tracking failed (archived): <err>` is thrown. Titles are limited to 60 chars by Paseo.
- Proposal: KEEP; DROP `mcpServers`. The three `PASEO_HARNESS_*` env vars and the labels are the identity contract with hooks and ph lookups.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:109-132; kit:project/.agents/harness/runtime/commands.mjs:104,672-673; kit:project/.agents/harness/runtime/common.mjs:5-10
- Why it exists: workers are recognised by hooks (context_guard suppression for `ph` worker env; paseo-runtime.md:422-424) and found by label.
- Test idea: fake client records the create call: callerAgentId, labels and the three env vars are present; archive-on-tracking-failure path.

### RUN-27 Usage accounting (UsageTracker)
- Behavior: Subscribes to `agent_stream` events and `observeTimeline(ids)` at agent creation; per agent sums `turn_completed.usage` (input, cachedInput, output, turns) and keeps `costUsd` = last reported `totalCostUsd` (a session running cost, not summed). Events are de-duplicated by `turnId`, else `seq`. `waitTurn` takes a baseline turn count BEFORE the turn starts; after an idle result it waits up to 2000 ms (100 ms poll) for the turn's event and, if none came, adds the final `lastUsage` itself and marks one later event as `late` to skip it (no double count). Turns that end in error/interrupt report no usage and are not counted. Workflow budget tokens = output tokens of every finished turn of the agent (a use of these totals, not part of the tracker itself).
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:50-89,137-145; kit:project/.agents/harness/runtime/commands.mjs:642-643; kit:project/.agents/skills/harness/references/paseo-runtime.md:245; kit:project/.agents/skills/harness/scripts/paseo_harness.test.mjs:82-103; kit:project/.agents/skills/harness/references/paseo-runtime.md:402-407
- Why it exists: audit RUN-1/SPD-2 2026-10-04: a short turn whose `turn_completed` arrived before waitTurn began was counted twice after a 2 s wait; the daemon keeps only the last turn (`lastUsage`), so per-turn numbers exist only as stream events (paseo-runtime.md:402-405).
- Test idea: the existing test (kit test:84-103): early event, baseline 0 -> no wait, output 7, turns 1; next turn adds 3.

### RUN-28 Caller identity and subagent ownership
- Behavior: `CALLER = $PASEO_AGENT_ID`, `LEADER = $PASEO_HARNESS_LEADER`. Commands that create agents (`spawn`, `fanout`, `workflow`, `team`, `context`, `archive` without names) call `requireCaller`: `PASEO_AGENT_ID is not set: run ph from an agent inside Paseo, so every agent is created as its subagent` (exit 1). Rationale: without a caller `ph` would create a stray workspace/project. Doctor reports the caller line and whether the daemon knows the agent (`caller agent found: <title>`).
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/common.mjs:8-10; kit:project/.agents/harness/runtime/daemon.mjs:90-92; kit:project/.agents/harness/runtime/commands.mjs:44-47; kit:project/.agents/skills/harness/references/paseo-runtime.md:33
- Why it exists: "so no stray workspace or project is created" (paseo-runtime.md:33).
- Test idea: `ph spawn` without `PASEO_AGENT_ID` exits 1 with that message and creates nothing.

### RUN-29 Capacity and unique-name checks
- Behavior: `checkCapacity(P,cfg,extra)`: counts the caller's live (non-archived) subagents whose status is `running`; if running + extra > `max_subagents` -> `UsageError: <r> subagents running + <n> new > max_subagents <m> (harness config); wait, archive, or use a workflow (it queues)`. Idle agents are NOT counted. `checkNamesFree`: a live subagent of the caller (any status) with the same title -> `a live subagent already has the name <names> (names must be unique)`. Names must be at most 60 chars (`names longer than 60 characters: ...`) because Paseo keeps 60 characters of a title and agents are looked up by title (audit CMD-4).
- Proposal: CHANGE (OPEN-5): decide whether idle agents count toward RAM-based limits; the 2026-10-04 OOM was about processes, and idle agents are processes too. Check-then-create is racy between two ph processes.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:185-192; kit:project/.agents/harness/runtime/commands.mjs:175-183
- Why it exists: OOM incident (RUN-11); CMD-4 (commands.mjs:177-178).
- Test idea: 19 running + spawn 2 refused; two live agents with the same title refused; a 61-char name refused before any agent starts.

### RUN-30 Resolving agent references (resolveTargets)
- Behavior: `NAME|ID` args are resolved against the caller's live subagents first, then the leader's (when `PASEO_HARNESS_LEADER` differs), so a teammate can address siblings and the leader's other children. Match: exact id, or id prefix when the reference has at least 6 characters (id matches win over title matches), or exact title. More than one match -> `UsageError: '<ref>' matches <n> agents; use the id`. Fallback: a 36-char uuid is fetched from the daemon directly. No match -> `no live subagent named or id '<ref>'`. No refs -> `name at least one agent (title, id or unique id prefix)`. The two pools come from `listAgents`, which drops archived agents and agents without the parent label. Priority: the caller's pool is searched to completion before the leader's, so a title hit on the caller's agent wins over an id hit on the leader's. The 36-char fallback is NOT filtered: a reference of exactly 36 hex-or-dash characters that missed both pools is `fetchAgent`'d with no parent check and no archived check, so it can name any agent the daemon returns, including an archived one or one of another orchestrator.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:162-184
- Why it exists: not stated.
- Test idea: prefix of 5 chars does not match by id; ambiguous title errors; leader's child reachable from a teammate; a full uuid of an archived or foreign agent is accepted (decide whether the new kit keeps this).
- Revised r1 (R1-RUN-06).

### RUN-31 waitTurn: retry, permission and error semantics
- Behavior: Waits `waitForFinish(agent, timeout)`. `idle` -> returns `{text (structured reply via resolveStructuredResponseMessage), usage: lastUsage, agent}`. `error` -> if not yet retried and the error text does not match `quota|credit|billing|auth|unauthori[sz]ed|forbidden|permission|invalid api key` (case-insensitive), sends once `Your previous turn ended with an error. Continue the task from where you stopped.` and waits again; otherwise throws `agent error: <first line, 300 chars>`. `timeout` -> `no reply within <s> s`. `permission` -> see RUN-32. Other status -> `agent status <s>`.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:12-15,138-161
- Why it exists: a repeat of a quota/auth error only burns more quota (paseo-runtime.md:282-285).
- Test idea: error `rate limited` -> one continue prompt sent; error `quota exceeded` -> no continue prompt.

### RUN-32 Subagents cannot ask the owner
- Behavior: When an agent stops on a permission request of kind AskUserQuestion, `waitTurn` denies it with `Nobody answers questions from subagents. Do not ask: decide from the material you were given if it settles the point; otherwise record the decision as open in your result the way your instructions say (for example a skipped item with needs_owner and the options), and finish the rest of your task.` up to 3 times per wait; any other permission request, or a fourth question, throws `agent is waiting for a permission: <name|kind>`. (`AskUserQuestion` is also in the worker disallowedTools, RUN-05.)
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:13-14,151-158; kit:project/.agents/harness.defaults.json:38
- Why it exists: not stated; unattended agents would otherwise wait forever.
- Test idea: a fake daemon raising AskUserQuestion twice then idle: both denied with the message, turn completes.

### RUN-33 sendPrompt wrapper
- Behavior: `sendPrompt(P, agent, text, cfg)` = size check then `client.sendAgentMessage(agent, text)`. Used by `ph send`, the error-continue prompt, compaction reports and workflow turns.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/daemon.mjs:133-136
- Why it exists: size check must cover wrappers added by Paseo (daemon.mjs:134).
- Test idea: oversize text is rejected before the daemon call.

### RUN-34 CLI entry, usage and exit codes
- Behavior: `node .../paseo_harness.mjs <command> ...`. No command, `--help` or `help` prints `usage: node .agents/skills/harness/scripts/paseo_harness.mjs <command> ...` and `commands: <all keys of COMMANDS, including _compact-run>  (manual: ...)` and exits 0; an unknown command prints the same and exits 1. A thrown `UsageError` prints `usage error: <first line, <=300 chars>` exit 1; any other thrown error prints `failed: <msg>` exit 1; the daemon client is closed in finally. Item-level failures inside a command print `failed <what>: <err>` and the command continues, ending with exit 2. Doctor exits 2 when any `problem` line was printed. The facade also exports `OVERLAY_FILE, mergeOverlay, clampThinking, UsageTracker, modeFor, agentMcpServers, turnsOf, waitTurn, parseFanout, readyTasks, onWatchEvent, modelMs, armWatchdog, COMMANDS, main, startAgent, workflowRunner` and runs `main` only when it is the process entry.
- Proposal: KEEP codes 0/1/2 and one-line-per-item output; DROP the `_compact-run` entry from the public command list (hide internal commands); trim the facade exports to what tests need.
- Source: kit:project/.agents/harness/runtime/commands.mjs:869-891; kit:project/.agents/harness/runtime/common.mjs:11-15; kit:project/.agents/skills/harness/scripts/paseo_harness.mjs:7-10; kit:project/.agents/skills/harness/references/paseo-runtime.md:176-178
- Why it exists: so a failing item never hides the others; callers (models) read one line per item.
- Test idea: unknown command exit 1; `ph` with no args exit 0; failing second item still prints the first item's line and exits 2.

### RUN-35 Argument parsing
- Behavior: `parseArgs(argv, spec)`: only `--key value` form (no `--key=value`, no short flags); `spec[key]` is `"string"` or `"bool"`; unknown option -> `UsageError: unknown option --<key>`; a string option at the end -> `--<key> needs a value`; a string option always consumes the next token even if it starts with `--`; every non-`--` token is positional (`rest`).
- Proposal: KEEP behavior; the new CLI may use a standard parser provided these error texts/exit code stay.
- Source: kit:project/.agents/harness/runtime/common.mjs:18-32
- Why it exists: not stated.
- Test idea: `--prompt "--x"` passes the text; `--bogus` exits 1 with `unknown option --bogus`.

### RUN-36 Prompt input: --prompt xor --prompt-file
- Behavior: exactly one of `--prompt T` / `--prompt-file F` (both -> `use --prompt or --prompt-file, not both`; none -> `--prompt or --prompt-file is required`); the file path resolves against the root; a leading BOM is removed; text is used as given (the task prompt is trimmed later in composePrompt).
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/common.mjs:33-39
- Why it exists: avoids shell-quoting problems with long prompts.
- Test idea: both flags -> exit 1; file with BOM yields text without BOM.

### RUN-37 ph doctor
- Behavior: Prints one line per check, prefix `ok` / `problem` / `note`, exit 2 if any `problem`. Checks in order: node version vs `NODE_REQUIREMENT`; `PASEO_AGENT_ID` set; config validity (invalid -> problem + continue with kit defaults); Paseo CLI found and daemon reachable (`paseo cli <v> at <dir> (tested with 0.10.0); daemon reachable`); caller agent exists on the daemon; per tier (skipped when the daemon is unreachable): `tier <name> -> <provider/model> thinking <clamped|default>[ features k=v] [(model not offered by the provider)]`; `default_tier <t> -> <resolved id>`; project overlay path or `none (...; kit defaults apply)`; canonical defaults path and installed kit root; deprecation warnings as `note`; legacy MCP availability line (needed only for non-Claude tier providers); when any tier provider is Claude: the four file-MOD lines (RUN-61); kit manifest version line or `note no .agents/harness-kit.json`; agent-provider disallowedTools lines from `provider_sync.agentProviderLines(cfg)` (other area); platform and tier aliases; agent types found in the agent dirs; final `note this check does not verify tools loaded into a running session ...`.
- Proposal: CHANGE: keep all Claude-relevant checks (node, caller, config, daemon, caller known, tier models offered, default tier, overlay, MOD, provider disallowed tools, main-provider denies, agent types); drop legacy MCP line and non-Claude provider branches; add a check that GSD adapter files exist.
- Source: kit:project/.agents/harness/runtime/commands.mjs:28-86; kit:project/.agents/skills/harness/references/paseo-runtime.md:182
- Why it exists: first diagnostic when agents misbehave; model flow probe depends on it (defaults:8).
- Test idea: with daemon down doctor prints `problem paseo: ...`, skips tier lines, still exits 2 and prints overlay/defaults lines.
- Note: doctor reads the machine MCP file without BOM strip (commands.mjs:67) while other JSON reads strip it.

### RUN-38 ph spawn
- Behavior: `ph spawn --name N (--prompt T | --prompt-file F) [--type T] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--worktree] [--count K]`. `--name` required; `--count K` (positive integer) starts K agents named `N-1..N-K`; names <= 60 chars. Order: load config, connect, `requireCaller`, `checkCapacity(K)`, `checkNamesFree`, then all agents start in parallel with kind `team`. Output per agent `<full agent id> <name>`; failure `failed spawn <name>: <err>`; then the wait hint (RUN-40) listing the started names; exit 2 if any failed. Returns immediately (does not wait for the turn).
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:108-139; kit:project/.agents/skills/harness/references/paseo-runtime.md:184
- Why it exists: persistent named teammate (upstream `Agent(name:...)`), paseo-runtime.md:49.
- Test idea: `--count 3` yields `x-1..x-3` lines; duplicate live name refused before any start.

### RUN-39 startAgent: model, cwd and worktree for one agent
- Behavior: loads the definition (if `--type`), resolves the model (RUN-13), directory = `--cwd` resolved against the root (default root); with `--worktree` creates a worktree named `<name>-<stamp>` and uses it as directory; composes the prompt (kind team/oneshot, read-only = flag or definition) with a worktree note or a working-directory note when the directory differs from the root; creates the agent with title = name, label `harness.name` = name, `cwd` = directory. Paseo 0.10.0 starts every subagent in the caller's workspace directory and ignores a requested cwd (verified 2026-10-03), so the directory is given as an instruction in the prompt; cwd is still passed in case a later Paseo honours it.
- Proposal: KEEP (re-verify the cwd limitation on the Paseo version in use; if cwd is honoured the instruction can go).
- Source: kit:project/.agents/harness/runtime/commands.mjs:93-106; kit:project/.agents/skills/harness/references/paseo-runtime.md:397-401
- Why it exists: the cwd limitation above.
- Test idea: `--cwd sub` puts `Your working directory for this task is <abs>` in the prompt and passes cwd to the create call.

### RUN-40 Wait hint after non-blocking commands
- Behavior: `spawn`, `send` and non-collect `fanout` end with `next: wait with Monitor running \`node <path relative to root>/paseo_harness.mjs watch <names>\` (one event per idle agent, exits when all are idle); do not poll with sleep/grep loops` (names quoted with `"` when they contain characters outside `[\w.-]`); printed only if at least one agent started. Workflow `--detach` prints the analogous hint with `watch-run <runId>`.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:141-148,767
- Why it exists: owner feedback 2026-10-14: the calling model wrote its own sleep/grep polling loops (commands.mjs:141-142).
- Test idea: after spawn, stdout's last line starts with `next: wait with Monitor`.
- Note: the relative `PH_CMD` here (commands.mjs:143) differs from the absolute `PH_CMD` in common.mjs:7 used inside agent prompts.

### RUN-41 Fanout file format
- Behavior: Optional preamble (text before the first block, prepended to every prompt with a blank line), then blocks starting with a line `=== <name> [key=value ...]`. Trailing words of the form `^[a-z-]+=` are peeled off as block options while more than one word remains; the rest (spaces allowed) is the name. Allowed options: `type`, `model`, `effort`, `read-only` (only the string `true` enables it); an unknown option -> `block '<name>': unknown option <k>=`. Block body = following lines, trimmed. No blocks -> `<file> has no '=== <name>' blocks`.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:150-173; kit:project/.agents/skills/harness/references/paseo-runtime.md:201-211
- Why it exists: launch a team in one command (upstream: several Agent calls in one message).
- Test idea: parseFanout on the doc example returns two blocks with opts `{type:'reviewer', model:'pro'}` and `{type:'reviewer'}`.

### RUN-42 ph fanout
- Behavior: `ph fanout --file F [--type T] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--collect DIR] [--keep]` (block options override the command options). Validation: block names unique; output file names (`name` with runs of characters outside `[\w.-]` replaced by `_`) distinct case-insensitively; names <= 60 chars; names free among live subagents. WITHOUT `--collect`: kind `team`; `checkCapacity(all blocks)` refuses beyond `max_subagents`; prints `<id> <name>` per agent, the wait hint, returns at once. WITH `--collect`: kind `oneshot`; creates DIR; refuses with `<n> subagents running, max_subagents <m>: no free slot; wait or archive` when no slot is free; runs at most the free slots in parallel (a semaphore; the rest queue); prints first `waiting for <n> agent(s): this command returns when every reply is collected; run it in the foreground and do not poll its output`; per block: `<id> <name>`, waits for the turn (`wait_timeout_s`), writes `DIR/<safe name>.md` (final reply + newline) and `DIR/<safe name>.json` (the `result --json` object, read BEFORE archiving), prints `collected <name> -> <file>.md`; errors print `failed <name>: <err>`; every started agent is archived in `finally` (also after a failure) unless `--keep`; archive failure prints `failed archive <name>: <err>`. Exit 2 if any block failed. Fanout has no `--worktree`.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:175-241; kit:project/.agents/skills/harness/references/paseo-runtime.md:185
- Why it exists: audit CMD-2 (file names compared case-insensitively as on Windows), CMD-3 (no free slot: refuse instead of starting one more than max_subagents), CMD-4 (60-char names) (commands.mjs:175-179,203); archived agents cannot be read, so usage is collected first (commands.mjs:226).
- Test idea: two blocks `A` and `a` rejected; with max_subagents=1 and 2 blocks only one agent runs at a time and both files are written.

### RUN-43 ph send
- Behavior: `ph send (--prompt T | --prompt-file F) [--now] NAME|ID...`. Size check before connecting. For each target in parallel: if the agent is `running`, with `--now` the turn is cancelled first, then wait for it to finish (60 s with `--now`, else `wait_timeout_s`); then send the message; then poll every 500 ms for up to 15 s until the agent reports `running` (so a `ph watch` started right after does not see the stale idle state). Output `sent <title>`; failure `failed send <title>: <err>`; wait hint for those sent; exit 2 on any failure. A message therefore never interrupts work unless `--now`. Precision (r1): the pre-send wait is a raw `waitForFinish`, not `waitTurn`, and its returned status is ignored, so a timeout or non-idle status does not by itself fail the item (only a throw does) and delivery still happens; the following 15 s poll for `running` also never fails the item: on timeout the command still prints `sent <title>`.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:20,243-273; kit:project/.agents/skills/harness/references/paseo-runtime.md:186,408-409
- Why it exists: deliver between turns; stale-idle race for `watch` (commands.mjs:254-256,261).
- Test idea: send to a running fake agent waits for idle before delivering; with `--now` cancel is called first.
- Concern: the docs table row for `ph send` is garbled (duplicated text, kit:project/.agents/skills/harness/references/paseo-runtime.md:186).

### RUN-44 ph watch
- Behavior: `ph watch NAME|ID...` waits per agent (`wait_timeout_s`) in parallel; on idle prints `idle <title> <id8> out_tokens=<n|?> context_tokens=<n|?> duration_s=<s|?>` (usage of the turn that just finished: `lastUsage.outputTokens`, `contextWindowUsedTokens`; duration = `updatedAt - lastUserMessageAt`); a non-idle end prints `failed <title> <id8>: error: <err>` or the status; finally `watch done: <k> idle, <m> failed`; exit 2 if any failed. Designed to run under the Monitor tool (one event line per agent, exits when all are idle).
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:275-299; kit:project/.agents/skills/harness/references/paseo-runtime.md:187,372-378
- Why it exists: replace polling (RUN-40). Also: a Paseo agent that ends its turn to wait for a background command is not woken when it finishes, so subagents run builds/tests in the foreground (paseo-runtime.md:376-378).
- Test idea: watch on two fake agents prints two `idle` lines then `watch done: 2 idle, 0 failed`.
- Concern: `watch` subscribes a usage tracker (commands.mjs:280-281) whose numbers it never prints (dead work).

### RUN-45 ph result
- Behavior: `ph result [--json] NAME|ID...`. Text mode: the agent's final reply (structured-response resolver on the last message), with a `## <title>` header per agent when several. `--json`: one JSON line per agent `{id, name, status, model: "<provider>/<model>", final, usage (last-turn usage as the daemon keeps it), tokens ({turns,input,cachedInput,output,costUsd} only when this process followed the agent from creation, else null), durationS (createdAt..updatedAt), lastTurnS (lastUserMessageAt..updatedAt), skills (set of `tool_call` items in the last 1000 timeline entries, `direction: "tail"`, whose name matches `/^skill$/i`, each reported as `input.skill ?? input.command ?? input.name ?? detail.label ?? detail.text ?? "?"`)}`. Exit 0 (no per-item failure handling).
- Proposal: KEEP; CHANGE: `costUsd` from Claude Code through the Circle proxy prices every model at Opus rates, so cost should come from the project price table (RUN-66).
- Source: kit:project/.agents/harness/runtime/commands.mjs:301-337; kit:project/.agents/skills/harness/references/paseo-runtime.md:188; wildera:.agents/harness/runtime/pricing.mjs:1-3
- Why it exists: replaces the return value of an upstream Agent call; `skills` field replaces headless `claude -p` trigger checks (paseo-runtime.md:64).
- Test idea: `result --json` on an archived-before-read agent fails (documented); on a live one returns all keys.

### RUN-46 ph team
- Behavior: requires a caller; prints for every live subagent of the caller `<id8> <status> <context%|?%> <provider>/<model> <title>`, where context % = `contextWindowUsedTokens / contextWindowMaxTokens`. Prints nothing when there are none (unlike `context`). Exit 0.
- Proposal: KEEP; CHANGE: print `no live subagents` when empty.
- Source: kit:project/.agents/harness/runtime/commands.mjs:339-349
- Why it exists: not stated; docs say never poll it in a loop (paseo-runtime.md:376).
- Test idea: two fake agents give two lines in the documented column order.

### RUN-47 ph context
- Behavior: `ph context [--self] [--rotate-pct N] [NAME|ID...]`: context-window use of the caller (`--self`), the named agents, or all own subagents, sorted by use descending (unknown last); line `<id8> <pct padded to 4>% <used>/<max> <status> <title>` (`  n/a` when unknown) plus the suffix `  ROTATE` at or above N % (default 50); `no live subagents` when empty. Requires a caller. `--self` ignores named agents.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:358-379; kit:project/.agents/skills/harness/references/paseo-runtime.md:190
- Why it exists: ported from an earlier Python tool (commands.mjs:351); ROTATE tells the orchestrator to replace a fat agent by a fresh one with a handoff.
- Test idea: an agent at 60 % prints `ROTATE`; one at 40 % does not.
- Concern: a non-numeric `--rotate-pct` becomes NaN and silently disables ROTATE (commands.mjs:366).

### RUN-48 ph compact-self (arming)
- Behavior: `ph compact-self [--focus TEXT] [--resume TEXT] [--agent ID]`. Target = `--agent` else the caller (else `PASEO_AGENT_ID is not set: pass --agent or run inside a Paseo agent`). Verifies the agent exists, takes the resume text from `--resume`, else config `compact_resume`, else a built-in short text, then spawns a DETACHED child `node paseo_harness.mjs _compact-run <id> --focus <text> --resume <text>` (cwd root, windowsHide, stdout/stderr to `<tmp>/ph-compact-<id8>.log`, overwritten) and returns at once with `compact armed for <id8> (context <pct>%|n/a); it starts when the turn ends and the resume message follows when it is done (log <path>). End your turn now`. The caller must end its turn; before calling, stop Monitors/background commands because a notification arriving during compaction cancels it.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:351-403; kit:project/.agents/skills/harness/references/paseo-runtime.md:413-432
- Why it exists: owner 2026-10-02: the orchestrator compacts itself instead of asking the owner to type /compact; verified 2026-10-03 on a Luna agent: 46,056 -> 946 used tokens and the agent woke on the resume message and still knew its earlier answer (paseo-runtime.md:413-417).
- Test idea: arming returns exit 0 within seconds and the log file exists; the detached process outlives the parent.
- CONFLICT: the built-in fallback resume text `Compaction done. Continue where you left off.` (commands.mjs:356) differs from the config default `...; re-arm any Monitor you stopped.` (defaults:96); the doc calls it "generic text" (paseo-runtime.md:111). Config value wins in practice.

### RUN-49 compact-self watcher (_compact-run)
- Behavior: Waits for the target to become idle (`wait_timeout_s`); if it does not -> reports to the agent `compact-self: waiting for your turn to end failed, so /compact was NOT sent...` exit 2. Reads used tokens (`before`), sends `/compact[ <focus>]` once; on send failure reports and exits 2. Polls every 3 s up to 15 min: while `running` it notes it; when not running and used tokens < 50 % of `before` -> `compaction done: used before -> after`, sends the resume text to the agent (waking it), exit 0; if it ran and stopped without the drop, or on timeout -> sends `compact-self: compaction NOT confirmed (used tokens <b> -> <a>); it may have been cancelled by an incoming notification. Your context is probably not compacted. Decide yourself whether and when to call compact-self again.` exit 2. No retry. Every stage logs a `HH:MM:SS` stamped line. If `before` is null/0 success can never be confirmed.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:353-356,405-450
- Why it exists: the only reliable success signal is a large token drop, because a notification arriving mid-compaction can cancel it and the agent then goes idle without having compacted (commands.mjs:406-409).
- Test idea: fake agent whose used tokens fall from 400k to 20k after /compact gets the resume message; one that stays at 400k gets the NOT confirmed message.

### RUN-50 ph stop
- Behavior: `ph stop NAME|ID...` cancels the running turn of each (`cancelAgent`); output `stopped <title>` / `failed stop <title>: <err>`; exit 2 on failure. Agent and context are kept.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/commands.mjs:452-459
- Why it exists: replaces upstream TaskStop (paseo-runtime.md:57).
- Test idea: stop on a running fake agent calls cancel once and prints `stopped <title>`.

### RUN-51 ph archive
- Behavior: `ph archive NAME|ID...` | `--idle [--name-prefix P]` | `--name-prefix P` | `--run RUNID`. `--idle` selects own subagents whose status is not `running`; `--name-prefix` selects own subagents whose title starts with P; neither flag nor names -> `name agents, or use --idle / --name-prefix`. `--run <id>`: requires a caller and `_workspace/_runs/<id>/run.json` (`no run <id> (<path>)`); kills the runner (`process.kill`, default signal) only when `pid` is set, `pidAlive` (EPERM counts as alive) and `status === "running"` (`stopped runner pid <p>`; a failed kill prints `could not stop runner pid <p>: <err>` and archiving continues), archives every OWN agent (the caller's) labelled `harness.run=<id>`, and rewrites run.json with `status: stopped, endedAt` only when `status` was `running`; a `done` or `failed` run is left as it is. Output `archived <ok> of <n> agents` (+ `failed archive <title>: <err>`); exit 0 only when all succeeded (also 0 for 0 of 0). Archiving removes the agent from the Paseo sidebar and makes its reply unreadable.
- Proposal: KEEP; the `--run` branch follows map-workflow's decision on the run directory.
- Source: kit:project/.agents/harness/runtime/commands.mjs:461-488; kit:project/.agents/skills/harness/references/paseo-runtime.md:193
- Why it exists: audit CMD-1: end a workflow run for good so watchers and resumes see a terminal state (commands.mjs:466-467).
- Test idea: `--idle` skips a running agent; `--run` on a nonexistent run exits 1.

### RUN-52 Stable facade and shared runtime resolution
- Behavior: The skill script `paseo_harness.mjs` is only a facade: it imports `runtime/commands.mjs` through `sharedUrl()`. `sharedUrl(rel)` tries `<project>/.agents/harness/<rel>` (project = 4 levels above the script), then for each of `$PASEO_HARNESS_ROOT`, the project, cwd: the `kit` path from `.agents/harness-kit.json` or `.claude/harness-kit.json` -> `<kit>/project/.agents/harness/<rel>`; none exists -> `shared harness asset <rel> not found; update this project from its installed kit`. This lets the `.claude/skills` mirror of the skill resolve the one canonical runtime instead of a copy.
- Proposal: CHANGE: one canonical runtime location installed into the project (no fallback to the kit checkout, no mirror); the facade is unnecessary when skills are not mirrored.
- Source: kit:project/.agents/skills/harness/scripts/shared_paths.mjs:5-19; kit:project/.agents/skills/harness/scripts/paseo_harness.mjs:1-10
- Why it exists: skills are edited in `.agents/skills` and linked into `.claude/skills` (RUN-57); the resolver avoids duplicate implementations.
- Test idea: running the CLI from a linked skill path and from the canonical path gives the same output.
- Concern: `sharedUrl` duplicates `installedRoot()` logic (config.mjs:19-22) and lets a project execute code from a kit path named in a JSON file.

### RUN-53 ph task (shared team task list)
- Behavior: `<ws>/tasks.json` = `{tasks: [{id, title, assignee|null, depends_on: [ids], status, notes, updated}]}`, `ws` resolved against the root and created if missing. All access goes through a lock file `tasks.json.lock` created with `wx`; waits up to 10 s (100 ms steps), steals a lock older than 30 s, else `task list locked: <lock>`; the file is rewritten only if changed. `--ws` is required. Statuses `pending|in_progress|completed|blocked` (`--status must be one of ...`). `add --title T [--assignee A] [--depends-on 1,2] [--notes N] [--status S]` -> `task <id> added`, id = max id + 1, unknown dependency -> `unknown dependency <ids>`. `update ID [--status] [--assignee] [--notes] [--title] [--depends-on list (replaces; "" clears)]` -> `task <id> <status>`; a dependency on itself or an unknown id -> `invalid dependency ...`; unknown task -> `no task <id>`. `list [--assignee A] [--status S]` -> `<id> <status> <assignee|-> <title>[ after 1,2][ READY]`; READY = pending and all dependencies completed. `get ID` -> task JSON. Other subcommand -> `task add | update | list | get`. No delete.
- Proposal: OPEN (OPEN-3): small and used by teammate prompts; but planned work state is now GSD `.planning/`. Recommend KEEP as the ephemeral team coordination file, not as planning state.
- Source: kit:project/.agents/harness/runtime/commands.mjs:490-578; kit:project/.agents/skills/harness/references/paseo-runtime.md:346-363
- Why it exists: upstream TaskCreate/TaskUpdate/TaskList/TaskGet replacement; `--depends-on` on update was accepted and silently ignored before (audit CMD-5, commands.mjs:553).
- Test idea: add 3 tasks with dependencies; `list` marks only the ready one `READY`; parallel `update` calls from two processes lose no write.
- Concern: no cycle detection beyond self; `add --depends-on "1, "` yields id 0 -> error; lock steal after 30 s can still double-write; tests: only `readyTasks` (kit test:73-80) covers the task list; the watchdog read/write classification test (kit test:120-136) is unrelated to it.

### RUN-54 ph freeze
- Behavior: `ph freeze --ws D --phase P` writes `D/freeze_P.sha256` with `<sha256>  <file>` lines (two spaces, shasum-compatible) for every regular file named `P_*` directly in D, sorted; none -> `no P_* files in D`; prints `frozen P: <n> files -> <record>`. `ph freeze --check --ws D --phase P` recomputes; prints `freeze ok P: <n> files` exit 0, or `freeze CHANGED P: modified f; missing f; new f` exit 2; missing record -> `no freeze record <path>` exit 1. New version files such as `P_<agent>_<artifact>_v2.md` show as `new`.
- Proposal: OPEN (OPEN-6): belongs to the harness method (read-only reviewers + frozen inputs); with GSD the plan-review/verify steps may need it or may replace it.
- Source: kit:project/.agents/harness/runtime/commands.mjs:580-609; kit:project/.agents/skills/harness/references/paseo-runtime.md:365-370,385-386
- Why it exists: replaces shell `shasum` (any OS) and covers advisory read-only roles: where reviewer writes would do harm, freeze inputs and check afterwards (paseo-runtime.md:63,385-386).
- Test idea: freeze, edit one file, check -> exit 2 with `modified`; add a file -> `new`.

### RUN-55 Worktree isolation (creation)
- Behavior: `createWorktree(name)`: top level of the root's git repo (`git rev-parse --show-toplevel`; failure -> `isolation 'worktree' needs a git repository`), then `git worktree add <top>/.claude/worktrees/<name> -b harness/<name>` (from the repo's current HEAD). Names: `ph spawn --worktree` -> `<agent name>-<run-id-without-wf_>` (stamp `yyyymmdd-hhmmss_xxxx` from `newRunId`, which uses the machine's LOCAL time, not UTC: workflow_engine.mjs:308-311); workflow `isolation: 'worktree'` -> `<runId>-<n>`. The agent is told `You work in the git worktree <path> (branch <branch>): edit files only there, run git and shell commands with that directory as their working directory, and use absolute paths.` Worktrees are kept after the run for the orchestrator to merge. Expensive; meant only for parallel file edits that would conflict.
- Proposal: KEEP; CHANGE: sanitize the name used in path and branch, create the worktree lazily or remove it if agent creation fails, make the base directory configurable (`.claude/worktrees` is hard-coded).
- Source: kit:project/.agents/harness/runtime/prompts.mjs:85-92; kit:project/.agents/harness/runtime/commands.mjs:101,652; kit:project/.agents/skills/harness/references/paseo-runtime.md:47,258
- Why it exists: upstream `isolation: 'worktree'` equivalent.
- Test idea: in a temp git repo, spawn with `--worktree` creates the directory and branch `harness/<name>-<stamp>`; outside git -> the git-repository error.

### RUN-56 ph worktrees (list and prune)
- Behavior: `ph worktrees [--prune] [--runs-dir D]` (default runs dir `_workspace/_runs`). Lists git worktrees under `<top>/.claude/worktrees` on `harness/*` branches (case-insensitive path compare on Windows); not in a git repo -> `<root> is not in a git repository; harness worktrees live under <repo>/.claude/worktrees` exit 1; none -> `no harness worktrees`. Owner from the name: `wf_<stamp>_<hex>-<n>` = run (in use when run.json is `running` with a live pid; a runner killed without terminal status no longer uses it), `<name>-<stamp>` = spawned agent (in use when any non-archived agent with label `harness.name=<name>` exists, any orchestrator; daemon unreachable -> `note daemon not reachable (...): worktrees of spawned agents are kept`), anything else unknown. State: `directory missing` (removable), `owner unknown`, `in use`, `uncommitted changes` (status incl. untracked), `<n> commit(s) not in HEAD`, `merged and clean` (removable). Line `<state padded 22> <branch> <path> (<owner>)`; with `--prune` removable ones are removed via `git worktree remove` (git itself refuses dirty ones) or `git worktree prune` for missing directories, then `git branch -d` (kept with the reason if unmerged): `removed <name> and branch <b>` / `removed <name>; branch <b> kept (...)`. Summary `worktrees: <n> listed, <k> removed` or `; --prune removes the <m> merged and clean one(s)`. Exit 2 if a removal failed. "Anything uncertain is kept" holds only while the directory exists: a worktree whose directory is gone (porcelain `prunable`) is classified `directory missing` / removable BEFORE the owner is considered, so it is removed even when its owner is in use or unknown (worktrees.mjs:57-58). (r1 R1-RUN-10)
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/worktrees.mjs:1-72; kit:project/.agents/harness/runtime/commands.mjs:822-857; kit:project/.agents/skills/harness/references/paseo-runtime.md:199
- Why it exists: kept worktrees pile up; removal must never lose work (worktrees.mjs:3-5).
- Test idea: temp repo with a merged clean, a dirty, and an ahead worktree: prune removes only the first.
- Concern: `git worktree prune` for a missing directory prunes every stale record in the repo, not just the listed one (worktrees.mjs:68).

### RUN-57 ph skills-sync
- Behavior: `linkSkills(root, say)` (skills_links.mjs, other area) mirrors skills from `.agents/skills` as per-skill links in `.claude/skills`; verified legacy copies migrate to links, owner-edited copies and Claude-only skills are preserved. ph prints `skills-sync: <n> skill link(s) created, <m> already linked, <k> stale owned link(s) removed[, <c> kept as copies (conflicts above)][; .gitignore block updated]`; exit 2 on conflicts.
- Proposal: DROP if the new kit installs skills straight into `.claude/skills` (Codex/OpenCode dropped, so no second consumer of `.agents/skills`); otherwise KEEP. Decided by map-install.
- Source: kit:project/.agents/harness/runtime/commands.mjs:808-820; kit:project/.agents/skills/harness/references/paseo-runtime.md:91-92
- Why it exists: skills live in the harness-neutral `.agents/skills`, Claude Code discovers `.claude/skills` (commands.mjs:811-813).
- Test idea: n/a if dropped.

### RUN-58 ph workflow (command shell; engine owned by map-workflow)
- Behavior: `ph workflow [--script F | --name N] [--args JSON | --args-file F] [--resume RUNID] [--budget 500k] [--runs-dir D] [--detach] [--run-id ID]`. `--script`+`--name` both -> error; `--name N` -> `.agents/workflows/N.js|.mjs` (else `.claude/workflows`); resume without script reuses the old `script.js`, without args reuses `args.json`; `--resume` needs `journal.jsonl`. Run dir `<runs-dir>/<runId>/` (`script.js, args.json, run.json {runId,parent,script,status running|done|failed|stopped,startedAt,endedAt,agents,budget,pid}, journal.jsonl, log.txt, result.json`). `--detach` re-executes itself as a detached child with `PASEO_HARNESS_LOG_IS_STDOUT=1`, prints `workflow started <runId>: <log>` and the `watch-run` hint, exit 0. Foreground prints `workflow start/done/failed ...`; failure exit 2 and run.json status failed. The orchestrator's own output tokens count toward `--budget`. Runner per `agent()` call: resolve model/definition, worktree, prime/gate, `createAgent` with `harness.run` + `harness.name` labels, watchdog, turns via `waitTurn`, archive unless `keep`; after the first `Transport closed|not connected` error all later calls return null (no orphan agents).
- Detail added in r1: schema/priming split RUN-67, warm-up gate RUN-68, shell contracts RUN-69, limits RUN-70.
- Proposal: OPEN (OPEN-7): whether `ph workflow` survives or the GSD wave executor replaces it is decided by map-workflow/gsd-plan; if it survives the command shell needs no change.
- Source: kit:project/.agents/harness/runtime/commands.mjs:611-806; kit:project/.agents/skills/harness/references/paseo-runtime.md:196,307-344
- Why it exists: see map-workflow.
- Test idea: map-workflow's.

### RUN-59 watch-run and run-stats delegation
- Behavior: `ph watch-run` and `ph run-stats` run `watch_run.mjs` / `run_stats.mjs` (siblings of the facade) with the same argv, cwd root, inherited stdio, and their exit status (`1` when none).
- Proposal: follows RUN-58.
- Source: kit:project/.agents/harness/runtime/commands.mjs:859-865,873
- Why it exists: not stated.
- Test idea: map-workflow's.

### RUN-60 Platform capability checks
- Behavior: `nodeRuntimeReady()` = major >= 20 and `path.matchesGlob` present (message `Node 20.17+ with path.matchesGlob (Node 24 LTS for the bundled test suite)`). `MIN_CLAUDE_VERSION = 2.1.296`. `claudeCli()` = `$CLAUDE_CLI`, else `~/.local/bin/claude(.exe)` if present, else `claude` on PATH. `runClaude(args)` starts it: a `.js/.cjs/.mjs` CLI through this node; on Windows anything that is not `.exe/.com` through cmd.exe with a single quoted command line (CreateProcess cannot start the npm `.cmd` shim); otherwise direct. `claudeVersion()` runs `--version` (10 s timeout) -> trimmed stdout or null. `versionAtLeast(text, min)` -> true/false, null if no `x.y.z` in the text.
- Proposal: KEEP (Windows is the owner's platform); the version gate only if the MOD keeps its minimum version.
- Source: kit:project/.agents/harness/platform.mjs:7-40
- Why it exists: a shell started by Node may lack `~/.local/bin` on PATH; npm `.cmd` shims cannot be spawned directly (platform.mjs:13-22).
- Test idea: versionAtLeast('2.1.296 (Claude Code)') true, '2.1.295' false, 'none' null.

### RUN-61 harness-files MOD state, env and doctor lines
- Behavior: plugin id `harness-files@paseo-harness-kit`. Owner selection = last wins over `<CLAUDE_CONFIG_DIR|~/.claude>/settings.json`, `<root>/.claude/settings.json`, `<root>/.claude/settings.local.json` `enabledPlugins[id]` (true enabled, false disabled). State: copied (`.claude/plugins/harness-files/.claude-plugin/plugin.json` and `hooks/register.ts` exist), natively registered (`installed_plugins.json` entry with scope user or this project), direct (`CLAUDE_CODE_PLUGIN_DIRS` contains the plugin dir; case-insensitive on Windows), supported (Claude >= 2.1.296). `filePluginEnv`: `{}` unless copied, not disabled and (enabled or direct); `{}` also when natively enabled+registered and not direct (a second direct dir would register the tools twice); otherwise `CLAUDE_CODE_PLUGIN_DIRS` = existing dirs + the plugin dir. Applied to every worker at creation. Doctor lines: `file MOD copied|missing: <dir>`; `Claude Code MOD runtime <v> (needs >=2.1.296; version check only, no model call)`; owner selection (disabled|enabled|direct process env|inactive; native registration; true process env, with a conflict warning when disabled but direct env forces it); `file MOD eligible for ph worker launch ...` or `inactive or unsupported ... native Read/Edit/Write fallback applies only where owner restrictions permit it`. The kit never enables/disables plugins.
- Proposal: KEEP in spirit (the owner-selected file MOD is part of the Claude Code worker setup); owned together with the files area.
- Source: kit:project/.agents/harness/runtime/plugins.mjs:1-56; kit:project/.agents/harness/runtime/daemon.mjs:119
- Why it exists: the MOD enable decision stays the owner's native setting; avoid double registration (plugins.mjs:39-41).
- Test idea: with enabledPlugins true and the plugin copied, a spawned worker's env contains the plugin dir; with false it does not.

### RUN-62 Legacy MCP attach for non-Claude agents
- Behavior: for non-Claude providers (unless `agent_mcp.attach` false or provider in `skip_providers`) createAgent passes `mcpServers` from `machine.local.json` (`$PASEO_HARNESS_MACHINE` or `<kit>/machine.local.json`) written by `machine.mjs apply`; Claude agents get none. Doctor warns when a non-Claude tier lacks the file.
- Proposal: DROP (non-Claude harnesses and MCP file adapters are dropped by the owner decision).
- Source: kit:project/.agents/harness/runtime/daemon.mjs:97-108; kit:project/.agents/harness.defaults.json:77-81; kit:project/.agents/harness/runtime/commands.mjs:63-68
- Why it exists: Codex/OpenCode agents had no MOD.
- Test idea: n/a.

### RUN-63 Config keys owned here but consumed by hooks / file backend
- Behavior: `context_guard {window_tokens 1000000, start_pct 60, step_pct 5}` drives the context-guard hook (reminder once past start_pct of the window, then every step_pct; window size reported by the session wins over the config); `io_guard {start_rounds, edit_start_rounds, edit_step_rounds, step_rounds}` drives the io_economy hook (reminder after N consecutive lookup-only / edit-only tool rounds); `read_limits {fileMaxChars 200000, replyMaxChars 450000, mediaPerTurn 1, mediaTurnGapMs 1000}` caps the file backend reads (a 15 MB JSON closed an MCP server: "Connection closed" on every later read). `compact_resume` is used only by compact-self. Hooks read config through the same loader (`config.mjs`).
- Proposal: KEEP the loader as the one shared reader; semantics belong to map-hooks and map-files.
- Source: kit:project/.agents/harness.defaults.json:96-107,118-123; kit:project/.agents/harness/config.mjs:1,42-47,88-96; kit:project/.agents/skills/harness/references/paseo-runtime.md:112,276-278,419-426
- Why it exists: defaults:2 and paseo-runtime.md:419-426.
- Test idea: hook and ph load identical values from one loader call.

### RUN-64 Watchdog/warm-up/prime config keys (consumers elsewhere)
- Behavior: `agent_nudge_s, agent_stop_s, agent_tool_stuck_s, agent_file_tool_stuck_s, watchdog_repeat_calls, watchdog_same_file_reads, watchdog_reads_without_write` (0 disables nudge, stop and, per `limitS > 0` in the tick, the two stuck-call limits `agent_tool_stuck_s` / `agent_file_tool_stuck_s`: watchdog.mjs:126,140-143), `warmup, warmup_s, warmup_timeout_s, prime_role`, `schema_retries`, `max_agents_per_workflow`, `wait_timeout_s` are validated here and consumed by the workflow runner. The watchdog is armed only on workflow agents (not spawn/fanout). File-tool hang: the first call open longer than the limit cancels the turn and sends a retry-with-smaller-calls message (the runner then waits on that retry, commands.mjs:695-701); a second hang archives the agent (watchdog.mjs:127-138; defaults:113).
- Proposal: OPEN with RUN-58 (workflow).
- Source: kit:project/.agents/harness.defaults.json:2,86-90,109-117; kit:project/.agents/harness/runtime/commands.mjs:625-678,693-702; kit:project/.agents/harness/runtime/watchdog.mjs:122-148
- Why it exists: see map-workflow.
- Test idea: map-workflow's.

### RUN-65 WildEra overlay (project adapter pattern)
- Behavior: A real project overlay: tiers `frontier`, `pro`, `standard` re-pointed to `circle/gpt-6.1-sol[1m]` (high, high, low) plus project tiers `sol` (low), `opus-medium` (circle/claude-opus-5-5[1m], medium), `astra-fast` (gpt-6-astra-fast, low), `astra` (gpt-6-astra, medium), `grok` (grok-4.7, high), `haiku` (claude-haiku-5-5 without `[1m]`, low); `default_tier` `sol`; an 18-entry `allowed_models`; `context_guard.start_pct` 45; extended `first_prompt_note` (RUN-23); watchdog thresholds raised to 86400/172800 s and 100000 counts (owner 2026-10-16: watchdog temporarily disabled; "restore by deleting these keys"). Its `_notes` text lists only four machine keys (predates `main_provider_disallowed_tools`; harmless since machine keys are ignored in code).
- Proposal: KEEP as the model for what a project adapter supplies: tiers, default tier, allowed models, thresholds, extra prompt note. CHANGE: a real `enabled: false`/0 for the watchdog instead of huge numbers (needs map-workflow).
- Source: wildera:.agents/harness.config.json:2-73; kit:project/.agents/harness/config.mjs:27
- Why it exists: owner chose non-Claude models through the Circle proxy; watchdog disabled by owner 2026-10-16 (wildera config:43).
- Test idea: loading the overlay validates and `resolveModel(cfg,'grok')` yields `circle-agent/grok-4.7[1m]`.

### RUN-66 Project model price table and cost
- Behavior: `.agents/model-prices.json` (WildEra) = list prices in USD per 1M tokens, checked 2026-10-19 by a Gemini 3.8 Flash agent from provider pages: per model key (id after the provider prefix, `[1m]` dropped) `input, cachedInput, cacheWrite, output`, optional `longContext {thresholdTokens, input, output}`, `source`, `notes`; models: claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5 (+ -fast), gpt-6.1-sol (+ -fast), gpt-6-astra (+ -fast), gpt-6-luna (+ -fast), grok-4.7 (+ build-fast), gemini-3.8-flash-high. The project-local `pricing.mjs` computes USD: key = model id minus `provider/` prefix and `[...]` suffix; null for unknown model or missing input/output price; long-context rates when the largest context used exceeded the threshold; cached rate scales with the long-context factor; cache writes are charged as input; rounded to 4 decimals. The daemon-reported `totalCostUsd` is kept only for reference because through the Circle proxy Claude Code prices every model at Opus rates (2026-10-19: a Gemini 3.8 Flash agent reported $1.13, list price $0.23).
- Proposal: OPEN (OPEN-8): ship price lookup in the kit core (data file stays per project) or leave it a WildEra extra. Recommend core, since the wrong proxy estimate affects every non-Claude model.
- Source: wildera:.agents/model-prices.json:2-157; wildera:.agents/harness/runtime/pricing.mjs:1-32
- Why it exists: pricing.mjs:1-3.
- Test idea: costUsd('circle-agent/gpt-6.1-sol[1m]', {input:1e6, output:1e6, maxContext:1000}) = 12.
- Concern: prices are scraped by an LLM agent and one note says the official id has no `-high` variant (model-prices.json:154); refresh is manual (`_note`, line 2). `gpt-6-luna-fast` is in `allowed_models` but `gpt-6-luna` is priced and only luna-fast is allowed (wildera config:62-63).

### RUN-67 Structured output (schema) versus role priming (added r1)
- Behavior: In the workflow runner (`commands.mjs`), when `opts.schema` is set the whole call goes through `P.structured({caller: turn, prompt, schema, maxRetries: cfg.schema_retries, schemaName: "Result"})` (Paseo's `getStructuredAgentResponse`): it appends the schema instruction to the prompt text, validates the reply (Ajv) and re-asks the same agent with the errors up to `schema_retries` extra times; after the last failure the `agent()` result is `null` with up to three `validationErrors` appended to the reason (not a throw). Native `outputSchema` can be given to Paseo only when the agent is created: an UNPRIMED agent is created with `outputSchema` = the schema on its first (task) turn. With `prime_role: "two-turn"` and a typed agent, the agent is created first with the role prompt and `outputSchema` null, waits for READY (`waitTurn`), and only then the task (with the schema as text) is sent, so a primed task is validated by `P.structured` alone. `composePrompt` itself never inserts the schema. Every rendered turn is size-checked (RUN-12) after Paseo's wrapper is added.
- Proposal: OPEN with RUN-58/RUN-22 (keep only if priming is kept); if the new kit drops priming, native `outputSchema` at creation plus the retry loop is the whole mechanism.
- Source: kit:project/.agents/harness/runtime/commands.mjs:679-708,715; kit:project/.agents/skills/harness/references/paseo-runtime.md:43,107,239
- Why it exists: audit RUN-3: Paseo takes a native schema only at creation and this is not fixable through the daemon client (commands.mjs:679-681).
- Test idea: a primed agent with a schema gets no `outputSchema` at create and still returns a validated object; a reply that never matches yields `null` after `schema_retries` retries.

### RUN-68 Warm-up gate (added r1)
- Behavior: Runs only when `cfg.warmup` and the agent has a type. Gate key = `<runId>|<type>|<resolved model id>|<thinking or "">`, kept in a module-level map. The first agent of a key starts alone and opens the gate when its role turn (READY) has finished with priming, or `warmup_s` after its creation when not priming (unref'd timer). Every other agent of that key waits for the gate promise or `warmup_timeout_s`, whichever is first; the fallback timer is cleared as soon as the wait ends. The gate is also opened in `finally` when the first agent fails, so others are never stuck. Incident (owner 2026-10-04): a pending fallback timer kept `ph workflow` alive up to 90 s after `workflow done`, so the caller's background shell reported nothing. Motivation: a cache entry is usable only once the first response has begun, so a burst of identical starts all pays uncached (audit burst 2026-10-03: 14 of 36 cold first turns).
- Proposal: OPEN with RUN-58 (map-workflow); if kept, keep the clear-timer rule.
- Source: kit:project/.agents/harness/runtime/commands.mjs:625-631,662-678,717-719
- Why it exists: lines 625-629, 665-667.
- Test idea: 5 agents of one type: the first create happens before any other; after the run the process exits promptly (no 90 s timer).

### RUN-69 Workflow command shell contracts (added r1)
- Behavior: (1) Foreground `out(line)` prints the line and appends it to `log.txt`, unless `PASEO_HARNESS_LOG_IS_STDOUT=1` (set for the detached child, whose stdout already is the log). (2) The first runner error whose first line matches `Transport (closed|not connected)` sets a process flag and logs `log runner lost the daemon connection (<err>): remaining agent() calls return null; resume the run`; every later `agent()` returns `{status:"null", reason:"daemon connection lost earlier in this run (<err>); resume the run"}` without creating an agent. (3) `--detach` does not call `requireCaller` and returns exit 0 after printing `workflow started <runId>: <log>`; a missing `PASEO_AGENT_ID` surfaces only in the child's log (`workflow failed ...`). (4) Null reasons from the runner: `finished without a reply`, `watchdog stopped the agent after <agent_stop_s> s`, the error text (first line, 300 chars), plus `: ` and up to three `validationErrors` joined by `; `. (5) The agent is archived in `finally` unless `opts.keep`; a failed archive logs `log warning: archive <id8> failed: ...`. (6) Budget includes the orchestrator's own output tokens (`extraSpent`).
- Proposal: OPEN with RUN-58; if the workflow command survives, these are the contracts to preserve.
- Source: kit:project/.agents/harness/runtime/commands.mjs:635,645,693-723,757-773,782-796; kit:project/.agents/harness/runtime/daemon.mjs:123
- Why it exists: the runner does not reconnect, so later calls would create orphans it cannot follow (commands.mjs:632-634).
- Test idea: simulate `Transport closed` on call 1: calls 2..n return null and create no agent; detached start without `PASEO_AGENT_ID` exits 0.

### RUN-70 Limits of the runtime from doc section 10 (added r1)
- Behavior: (a) Workflow scripts are trusted code: `node:vm` is not a security boundary (a script can reach the host process), a busy loop hangs the runner, and calls the script does not await may still run after `workflow done` (audit 2026-10-04 ENG-2..4); write scripts like code you run and await every `agent()`. (b) Resume reuses results by prompt text plus the options `schema, agentType, model, effort, isolation, readOnly, cwd` only (`label`, `phase`, `keep` are not part of the key); changing an agent definition body, its `include:` files, or the tier-to-model mapping in defaults/overlay does NOT invalidate cached calls, because `model` in the key is the option string as the script wrote it, not the resolved provider/model (audit ENG-5); resume only over unchanged definitions and config, otherwise start a new run. (c) Budget is checked before each new `agent()` call, so agents already running can take `spent()` past `total`. (d) Turns that end in error or interrupt report no usage and are not counted; token usage exists only as live `turn_completed` events (RUN-27). (e) Definition `tools:` and `--read-only` are advisory (RUN-20).
- Proposal: KEEP as documented limits; (b) is a candidate to fix in the new kit by hashing the resolved model and the definition text into the cache key (OPEN with map-workflow).
- Source: kit:project/.agents/skills/harness/references/paseo-runtime.md:382-407; kit:project/.agents/harness/runtime/workflow_engine.mjs:15-16
- Why it exists: audit 2026-10-04 ENG-2..5 (paseo-runtime.md:387-392).
- Test idea: change a tier's provider and resume: cached calls are still returned (document or fix); `Date.now()` in a script throws.

### RUN-71 Doc-versus-code conflicts not recorded elsewhere (added r1)
- Behavior: CONFLICT 1: the primitive table says a definition's `tools:` list is "advisory: listed in the prompt" (paseo-runtime.md:62), while section 4 says the list itself is not shown (paseo-runtime.md:127-128) and `composePrompt` never inserts it (prompts.mjs:72-83). Code wins: not shown; only the read-only note derives from it. CONFLICT 2: section 4 says "Delegation is not forced in a main session: use `ph` when requested or when an invoked project orchestrator requires it" (paseo-runtime.md:163-164), while the defaults deny `Agent`, `Workflow` and `SendMessage` on the main provider (defaults:58-63) and the owner decision of 2026-10-20 keeps native Agent/Workflow denied on the main provider. Defaults/owner win: delegation to native subagents is not possible; `ph`/Paseo is the only route.
- Proposal: KEEP the defaults behavior; rewrite the doc sentences.
- Source: kit:project/.agents/skills/harness/references/paseo-runtime.md:62,127-128,163-164; kit:project/.agents/harness/runtime/prompts.mjs:72-83; kit:project/.agents/harness.defaults.json:58-63
- Why it exists: stale documentation.
- Test idea: n/a (documentation); a rendered typed prompt contains no `tools:` text.

## Invariants and lessons

- Every agent is a subagent of the calling Paseo agent (label `paseo.parent-agent-id`); ph refuses to create agents without `PASEO_AGENT_ID` so no stray workspace/project appears (kit:project/.agents/harness/runtime/daemon.mjs:90-92,127; paseo-runtime.md:33).
- Config is validated closed (unknown AND missing keys fail), and the shipped values are read only from the one defaults file, never duplicated in code (config.mjs:34-98).
- Machine keys are not overridable by a project; a Paseo reinstall resets provider tool rules, so the kit keeps and re-checks them (defaults:2; config.mjs:9,27).
- Main sessions deny `Agent`, `Workflow`, `SendMessage`; Paseo/ph is the only orchestrator (defaults:58-63; memory main-session-no-native-subagents).
- Prompt size is checked on the fully rendered message, including wrappers added by Paseo, before any daemon call; 42 MB killed the runner socket (prompts.mjs:60-64; daemon.mjs:109-110,134; commands.mjs:659-660).
- Max running agents is bounded by RAM (about 350 MB each); 30 at once crashed a 32 GB machine; idle agents stay alive until archived (defaults:2; paseo-runtime.md:269-273).
- Never switch reasoning off implicitly; clamp to the nearest supported level, ties high (models.mjs:3-17).
- Never retry an error caused by quota, credit, billing, auth or permission; retry other errors once (daemon.mjs:15,146-148).
- Subagents never ask the owner: AskUserQuestion is denied with an instruction to decide or record the point as open (daemon.mjs:13,153-155).
- Usage baseline is taken before the turn starts; late events are neither dropped nor double-counted (daemon.mjs:74-79,138-145; test kit:paseo_harness.test.mjs:82-103).
- Archived agents cannot be read: collect replies and usage before archiving (commands.mjs:226).
- Paseo ignores a requested cwd for subagents: directory and worktree are given as prompt instructions (commands.mjs:97-99; paseo-runtime.md:397-401).
- Agent titles are limited to 60 characters and agents are found by title, so longer names are refused up front (commands.mjs:177-183).
- Names must be unique among live subagents; id prefixes need at least 6 characters; ambiguous references fail instead of guessing (daemon.mjs:166-191).
- A worktree is removed only when its owner is provably finished, it is clean and its branch is merged; any uncertainty keeps it (worktrees.mjs:3-5,42-64).
- compact-self counts success only by a large drop in used tokens, never retries, and always tells the agent the outcome; the caller must end its turn and stop Monitors first (commands.mjs:405-449; paseo-runtime.md:427-432).
- Non-blocking commands print a `next: wait with Monitor running ph watch ...` hint so models do not write polling loops (commands.mjs:141-148; owner feedback 2026-10-14).
- Output contract: one line per item, `failed <what>: <err>` for item errors, exit 0/1/2 (paseo-runtime.md:176-178).
- File I/O rules live in the project AGENTS.md block, not in runtime notes; agent definitions and prompts must not repeat them (paseo-runtime.md:149-153). Prompts say "follow X (in your prompt)", never "read X first" (paseo-runtime.md:129-132).
- Read-only roles and `tools:` lists are advisory; where a reviewer write would do harm, freeze inputs and check afterwards (paseo-runtime.md:382-386).
- A model added to `~/.paseo/config.json` needs `paseo daemon reload`, and must be added to both the session provider and the worker provider (defaults:6-7).
- Test the tests: kit:paseo_harness.test.mjs covers mergeOverlay, clampThinking, readyTasks, waitTurn/UsageTracker (lines 73-118), the workflow engine (parseScript, pipeline/parallel nulls, resume cache, budget ceiling, one-level `workflow()`, `Date.now`/`Math.random` throw: lines 30-71) and the watchdog's read/write classification by tool names of Claude Code, Codex and OpenCode (lines 120-136). Untested in that file: doctor, resolveTargets, parseFanout, worktrees, compact-self, freeze, task locking, prompt assembly and `validate`; the new kit should cover them. (r1 R1-RUN-12)

## Interfaces

CLI (`node .agents/skills/harness/scripts/paseo_harness.mjs <command>`; exit 0 ok, 1 usage/config error, 2 some items failed or doctor problem):

| command | flags | stdout lines |
| --- | --- | --- |
| doctor | none | `ok|problem|note <text>` |
| config | none | JSON + `_provenance` |
| spawn | `--name N`, `--prompt T`/`--prompt-file F`, `--type`, `--model`, `--effort`, `--read-only`, `--cwd`, `--ws`, `--worktree`, `--count K` | `<id> <name>`, `failed spawn <name>: ...`, `next: ...` |
| fanout | `--file F`, `--type`, `--model`, `--effort`, `--read-only`, `--cwd`, `--ws`, `--collect DIR`, `--keep` | `<id> <name>`, `collected <name> -> <file>`, `failed <name>: ...`, `next: ...` |
| send | `--prompt`/`--prompt-file`, `--now`, `NAME|ID...` | `sent <title>`, `failed send <title>: ...`, `next: ...` |
| watch | `NAME|ID...` | `idle <title> <id8> out_tokens= context_tokens= duration_s=`, `failed <title> <id8>: ...`, `watch done: k idle, m failed` |
| result | `--json`, `NAME|ID...` | reply text (`## <title>` when several) or JSON line |
| team | none | `<id8> <status> <pct> <provider/model> <title>` |
| context | `--self`, `--rotate-pct N`, `NAME|ID...` | `<id8> <pct>% <used>/<max> <status> <title>[  ROTATE]` |
| compact-self | `--focus`, `--resume`, `--agent ID` | `compact armed for ...` |
| stop | `NAME|ID...` | `stopped <title>` |
| archive | `NAME|ID...`, `--idle`, `--name-prefix P`, `--run RUNID` | `archived k of n agents` |
| task | `add|update|list|get`, `--ws D`, `--title`, `--assignee`, `--depends-on`, `--notes`, `--status`, `ID` | `task <id> added`, `task <id> <status>`, list lines, JSON |
| freeze | `--ws D --phase P [--check]` | `frozen ...`, `freeze ok ...`, `freeze CHANGED ...` |
| worktrees | `--prune`, `--runs-dir D` | `<state> <branch> <path> (<owner>)`, `worktrees: ...` |
| skills-sync | none | `skills-sync: ...` |
| workflow, watch-run, run-stats, _compact-run | see RUN-58, RUN-49, RUN-59 | |

Environment: `PASEO_AGENT_ID` (caller), `PASEO_HARNESS_ROOT` (root, default cwd), `PASEO_HARNESS_LEADER`, `PASEO_HARNESS_ROLE=worker` (set on workers), `PASEO_HOME` (default `~/.paseo`), `PASEO_CLI_DIR`, `PASEO_HARNESS_MACHINE`, `PASEO_HARNESS_LOG_IS_STDOUT` (internal), `CLAUDE_CLI`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_DIRS`.

Labels: `paseo.parent-agent-id`, `harness.name`, `harness.run`. Titles: `<name>` (spawn/fanout), `<workflow>:<label>` (workflow).

Files: `.agents/harness.defaults.json` (kit), `.agents/harness.config.json` (overlay), `.agents/harness-kit.json` (manifest: `kit`, `version`, `installedAt`), `.agents/agents/<type>.md` (front matter `tools`, `model`, `include`), `<ws>/tasks.json` + `.lock`, `<ws>/freeze_<phase>.sha256`, `<repo>/.claude/worktrees/<name>` on branch `harness/<name>`, `_workspace/_runs/<runId>/...`, `<tmp>/ph-compact-<id8>.log`, `.agents/model-prices.json` (WildEra), `~/.paseo/config.json` (read for providers).

Config keys: see RUN-10 (all defaults), RUN-06 (validation), RUN-02 (merge sets), RUN-03 (machine keys). Tier shape: `{provider: "<provider>/<model>", thinking?: off|low|medium|high|xhigh|max, features?: {}}`.

## Cross-area dependencies

- install: writes the overlay once, `.agents/harness-kit.json`, machine key sync (`sync_agent_provider.mjs`, `machine.mjs`), skills links, runtime location (RUN-52, RUN-57); needs `provider_sync.agentProviderLines` for doctor.
- runtime (other mappers of this area): `provider_sync.mjs`, `skills_links.mjs` are called from `commands.mjs` but were not in this scope.
- workflow: `ph workflow`, `workflowRunner`, `watchdog.mjs`, `workflow_engine.mjs` (newRunId, writeJson, journal), warm-up, priming, watch_run/run_stats; they use `createAgent`, `waitTurn`, `UsageTracker`, `composePrompt`, `rolePrompt`, `createWorktree`, `resolveModel`, labels and the config keys of RUN-64.
- files: `read_limits`, the harness-files MOD (RUN-61), batch file tools named in the first prompt note, `first_prompt_note` rules.
- hooks: `context_guard`/`io_guard` keys, `PASEO_HARNESS_ROLE`/`PASEO_HARNESS_LEADER` worker env, the loader `config.mjs` imported by hooks; compaction reminder points to `ph compact-self`.
- method: agent definitions (`type`, `include`, `tools`, `model` tier names), freeze (RUN-54), read-only semantics, `ph task` for teams.
- gsd-plan / gsd-debug / gsd-upstream: need `ph spawn/fanout/send/watch/result` to run planner/executor/verifier agents in waves, role-to-tier mapping from the adapter (RUN-13), per-role model overrides, worktrees for parallel executors (RUN-55/56), `.planning/` paths passed by file reference (prompt size limit RUN-12).
- ui / history: none found in this scope.

## Concerns

- `daemon.mjs:16-48` imports internal files (`dist/utils/client.js`, `dist/commands/agent/run.js`, `@getpaseo/server` export) of the npm CLI; any Paseo release can break it; only "tested with 0.10.0" (commands.mjs:40).
- `parseFrontMatter` strips ` #...` from any value (prompts.mjs:17); no multiline values; agent `type` and include paths are joined into paths without traversal checks (prompts.mjs:29,38).
- `createWorktree` uses unsanitized names in path and branch (prompts.mjs:89-90); the worktree is created before the agent and left behind if `createAgent` fails (commands.mjs:101-104); base dir `.claude/worktrees` hard-coded (prompts.mjs:89).
- `removeWorktree` for a missing directory runs `git worktree prune` for the whole repo (worktrees.mjs:68).
- Capacity check is check-then-act and counts only running agents (daemon.mjs:185-188).
- `cmdWatch` tracks usage it never reports (commands.mjs:280-281); `cmdTeam` prints nothing when empty (commands.mjs:341-347); `context --rotate-pct abc` silently disables ROTATE (commands.mjs:366).
- Two different `PH_CMD` definitions (common.mjs:7 absolute with quotes; commands.mjs:143 relative) and imports in the middle of `commands.mjs` (lines 23, 636); `commands.mjs` mixes agents, tasks, freeze, workflow, worktrees in 893 lines.
- BOM handling is inconsistent: `kitManifest()` (daemon.mjs:95), the doctor machine-file read (commands.mjs:67), `ph archive --run`'s `run.json` (commands.mjs:471), `tasks.json` (commands.mjs:509), a resumed `args.json` (commands.mjs:748) and the freeze record (commands.mjs:596) do not strip a BOM, while `readJson` (config.mjs:15), `readText` (so `--args-file`, `--prompt-file`, fanout file) do. `writeJson` (fanout `.json`, `tasks.json`, `run.json`, `args.json`, `result.json`) writes 2-space JSON with a trailing newline via `<file>.tmp<pid>` then rename (workflow_engine.mjs:314-319).
- Workflow agent titles `<workflowName>:<label>` are cut to 60 characters inside `createAgent` with no error (daemon.mjs:123), so the CMD-4 lookup problem still bites them silently; `checkNameLengths` only guards spawn and fanout (commands.mjs:118,194).
- `allowed_models` exact-string match forces duplicate `circle/` and `circle-agent/` entries (wildera config:51-70; models.mjs:29).
- Overlay `first_prompt_note` replaces the kit text, so projects copy and drift (wildera config:49 vs defaults:91).
- Runtime doc has broken tables: duplicated garbled `ph send` row (paseo-runtime.md:186) and the `platform_notes` row merged with the tiers text (paseo-runtime.md:98-100); stale watchdog numbers (paseo-runtime.md:294-296) and teammate-note description (paseo-runtime.md:147-148); `main_provider_disallowed_tools` described without `SendMessage` (paseo-runtime.md:77).
- Dead/legacy: `.claude/` dual lookups (config.mjs:17,20; prompts.mjs:10; commands.mjs:616), `modes`, `provider_features`, `agent_mcp`, `isClaudeProvider`, `MIN_CLAUDE_VERSION` gate only for the MOD, `skills-sync`, `shared_paths.mjs`.
- `ph task` has no cycle detection and no delete; lock stealing after 30 s (commands.mjs:493-507).
- Doctor's final `note` and tested-version message hard-code `0.10.0` (commands.mjs:40,84); owner memory records other CLI versions on other branches, so the number goes stale.
- Cost fields from the daemon are wrong for non-Claude models via the Circle proxy (wildera pricing.mjs:1-3) but `ph result --json` still emits `usage.totalCostUsd`/`tokens.costUsd` (daemon.mjs:72, commands.mjs:317-318).

## Open questions for the owner

- OPEN-1 Tier vocabulary. Options: (a) keep frontier/pro/standard + aliases fable/opus/sonnet; (b) keep tiers, drop the upstream aliases and let the GSD adapter map roles (planner, executor, verifier, ...) to tiers; (c) map GSD roles directly to `provider/model`. Recommendation: (b): tiers stay the only indirection, the adapter owns role->tier, aliases are added by a project only if its agent files use them.
- OPEN-2 Daemon client strategy. Options: (a) keep importing the npm CLI's internal client; (b) call the public `paseo` CLI with `--json`; (c) a stable client package if Paseo publishes one. Recommendation: (a) behind a single adapter module with a doctor version gate, until Paseo documents (c).
- OPEN-3 `ph task` shared team task list. Options: keep as ephemeral team coordination; fold into GSD `.planning/`; drop. Recommendation: keep, separate from planning state (it lives in `_workspace`).
- OPEN-4 Read-only enforcement. Options: advisory note only (today); additionally pass a per-agent disallowedTools for Edit/Write/MCP write tools when `--read-only`. Recommendation: enforce if Paseo's createAgent can take per-agent tool denies; otherwise keep advisory plus freeze check.
- OPEN-5 Capacity semantics. Options: count only running agents (today); count all live (running + idle) agents; add a separate RAM-based cap. Recommendation: count live agents against a higher default or add a separate idle cap, because the OOM was about processes.
- OPEN-6 `ph freeze`. Options: keep generic command; replace by GSD artifact checks; drop. Recommendation: keep (small, generic) unless GSD plan-review already gives frozen inputs.
- OPEN-7 Workflow scripts. Options: keep `ph workflow` (JS scripts, journal, resume, warm-up, priming, watchdog); keep only a thin wave executor driven by GSD plans; drop. Decision belongs with map-workflow/gsd-plan; this area only needs `createAgent`/`waitTurn` either way.
- OPEN-8 Price table and cost in the kit core. Options: ship `model-prices` lookup and cost fields in `ph result --json` (data per project); leave to projects; drop cost fields. Recommendation: ship in core, because the proxy's own cost is wrong for non-Claude models.

## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
| --- | --- | --- |
| R1-RUN-01 | accepted | New RUN-67 (schema vs priming); RUN-58 points to it. Verified commands.mjs:679-708. |
| R1-RUN-02 | accepted | New RUN-68 (warm-up gate, key, timer incident). Verified commands.mjs:625-678. |
| R1-RUN-03 | accepted | New RUN-69 (log routing, transport flag, detach without caller, null reasons, archive); title-slice concern added to Concerns (daemon.mjs:123; commands.mjs:118,194). |
| R1-RUN-04 | accepted | RUN-07 rewritten: validate failure continues, invalid JSON aborts via `configProvenance` (commands.mjs:60), test idea changed. |
| R1-RUN-05 | accepted with correction | RUN-09: not four levels; `../../../` from `config.mjs` reaches the kit root in a kit checkout and the parent of the project when installed. The reviewer's "directory that contains .agents" is itself off by one (verified config.mjs:21, shared_paths.mjs:5); RUN-52's four levels stays. |
| R1-RUN-06 | accepted | RUN-30: archived exclusion limited to the pools, uuid fallback unfiltered, caller-pool-first priority; test idea extended. |
| R1-RUN-07 | accepted | RUN-14: doctor bypass only on the later provider set (commands.mjs:63); `default_tier` line is allowlist-gated (57); proposal and source updated. |
| R1-RUN-08 | accepted | RUN-15: catalogue miss still creates; doctor uses the tier's own provider prefix, `createAgent` the mapped one. |
| R1-RUN-09 | accepted | RUN-51: kill conditions, kill failure message, rewrite only when `running`, own agents only. |
| R1-RUN-10 | accepted | RUN-56: `directory missing` is removable before owner check (worktrees.mjs:57-58); repo-wide prune concern kept. |
| R1-RUN-11 | accepted | RUN-43: raw `waitForFinish`, status ignored, 15 s poll never fails the item. |
| R1-RUN-12 | accepted | Invariants test bullet rewritten with what the file covers; RUN-53 test note mentions the watchdog test (kit test:30-71,120-136). |
| R1-RUN-13 | accepted | New RUN-70 (trusted scripts, resume key by option string, budget overshoot); RUN-16 now says the cached model is the option string. |
| R1-RUN-14 | accepted | New RUN-71 (tools-list and delegation conflicts); RUN-04 SendMessage conflict unchanged. |
| R1-RUN-15 | accepted | RUN-25: `{ target: { kind: "instance", home } }`, server module lookup paths. |
| R1-RUN-16 | accepted | RUN-27 Source now cites commands.mjs:642-643 and paseo-runtime.md:245 for output-token budget; RUN-64 hang policy cites defaults:113, commands.mjs:695-701, watchdog.mjs:127-138; warm-up lines re-cited to 625-678. |
| R1-RUN-17 | accepted | RUN-20 exact read-only note, RUN-21 exact cwd note, RUN-45 `skills` extraction rule. |
| R1-RUN-18 | accepted | Concerns: full list of BOM-skipping reads and `writeJson` shape. |
| R1-RUN-19 | accepted | RUN-55 local-time stamp; RUN-64 zero disables the stuck limits too (watchdog.mjs:126). |
| R1-RUN-20 | accepted | Coverage line counts corrected to include the trailing blank line (pricing.mjs row left at 33: the read reported 33 of 33). |
| R1-RUN-21 | accepted | RUN-21 records the doc's shortened silent note; RUN-23 adds "report only in your final reply of the turn". |
