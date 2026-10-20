# Map: workflow (WFL) - workflow engine, run journal, watchdog, run tools

Source prefixes: `kit:` = C:/Users/fish/Desktop/paseo-harness-kit @ ref-final (4441a88); `wildera:` = C:/Users/fish/Desktop/WildEraV6 @ 89143da.
Paths under `kit:` are abbreviated: `RT` = `project/.agents/harness/runtime`, `SK` = `project/.agents/skills/harness`, `REF` = `project/.agents/skills/harness/references`. Line counts in the Coverage table are `wc -l` (newline count); the read tool shows one more line for the trailing empty line (workflow_engine.mjs 319 vs 320, watchdog.mjs 150 vs 151, watch_run.mjs 64 vs 65, run_stats.mjs 59 vs 60, runtime_regression.test.mjs 468 vs 469, paseo-runtime.md 432 vs 433, review-gate.js 67 vs 68); every body line was read.

## Coverage

| file | lines | read fully |
| --- | --- | --- |
| kit:RT/workflow_engine.mjs | 319 | yes |
| kit:RT/watchdog.mjs | 150 | yes |
| kit:SK/scripts/workflow_engine.mjs (facade) | 5 | yes |
| kit:SK/scripts/watch_run.mjs | 64 | yes |
| kit:SK/scripts/run_stats.mjs | 59 | yes |
| kit:SK/scripts/runtime_regression.test.mjs | 468 | yes (only the workflow/watchdog/run_stats/watch_run/worktree tests are mapped here; config, provider-sync, MOD and prompt tests belong to other areas) |
| kit:REF/paseo-runtime.md | 432 | yes (section 6 and workflow entries of sections 2, 3, 4, 5, 9, 10 mapped; sections 7, 8, 11 belong to other areas) |
| kit:REF/workflow-recipes.md | 226 | yes |
| kit:REF/execution-modes.md | 189 | yes |
| kit:CHANGELOG.md | 56 | yes (Unreleased watchdog entry, 0.1.0 workflow lines) |
| wildera:.agents/workflows/review-gate.js | 67 | yes |
| wildera:_workspace/_runs/ (187 run dirs at the r1 re-count on 2026-10-20, newest wf_20261020-144638_0d9c; first count was 185 / wf_20261020-134305_58c0; the tree grows while agents work) | - | sample only: wf_20261015-011128_ecea run.json, log.txt, journal.jsonl in full (args.json/script.js not read); wildera:_workspace/review-gate/p1-entry-gate1.json read in full as an args sample, and (r1) p1-entry-gate1-resolve.json read in full as the resolve-mode sample (same args plus `mode:'resolve'`, `open:{p1-entry:[confirmed finding with id/stage/severity/file/line/problem/trigger/likelihood/likelihoodPct/confidence/impact/fix/evidence]}`, `evidence` string) |
| Extra, read to ground behaviors the focus names but the engine delegates (not in assigned scope): kit:RT/commands.mjs 455-500 and 560-840 (workflowRunner, cmdWorkflow, cmdArchive --run, freeze), kit:RT/prompts.mjs (all), kit:RT/daemon.mjs 12-15 and 51-160 (waitTurn, UsageTracker, createAgent, sendPrompt), kit:project/.agents/harness.defaults.json 76-120 | - | partial, only the cited ranges |

## Summary

Mode A of the kit: `ph workflow` runs an upstream-Harness-style JavaScript script (`export const meta` literal + async body using `agent/pipeline/parallel/phase/log/args/budget/workflow`) inside a `node:vm` context. The engine (workflow_engine.mjs) is pure: it parses the script, enforces caps/budget/concurrency, keeps a journal and a resume cache, and hands every `agent()` call to an injected `runner`. The real runner (commands.mjs `workflowRunner`, outside this scope) creates one Paseo agent per call, primes its role in a first READY turn, validates structured output with retries, arms the watchdog and archives the agent.

Failure model: agent failures never reject; `agent()` resolves `null` with a reason in the journal. Configuration errors (unknown option, bad schema, budget exhausted, agent cap) throw, and `parallel`/`pipeline` convert a throwing item to `null`. Resume replays journal results by `(prompt+options)` key and occurrence index.

The watchdog (watchdog.mjs) measures an agent's own model time per prompt (union of tool spans subtracted, clock of a tool call starting when its input is complete), sends one targeted steering message per prompt for loop / reread / piecemeal behavior, nudges and stops by model time, and interrupts then stops hung tool calls. Most of its rules exist because of recorded incidents (false interrupts of agents still generating a Write, late running events, 42 MB prompt, 30 min hung call).

Support tools: `watch_run.mjs` (log follower that exits when the run ends, also on dead runner pid), `run_stats.mjs` (wall time, per-agent seconds, tool-call counts from Claude transcripts), `ph archive --run`, `ph worktrees`.

Worth keeping in spirit: pure engine + injected runner (offline-testable), null-not-reject agent contract, resume cache by content hash, model-time watchdog with input-complete timing, journal as ground truth, watchers that terminate on their own. Worth changing: doc/default drift (nudge/stop numbers), dead `agent failed` filter, the 4 hard-coded regexes for tool kinds, misleading stop reason, misc fragility listed in Concerns.

## Behaviors

### WFL-01 Script format and `meta` literal
- Behavior: a script has `export const meta = {...}` (regex `export\s+const\s+meta\s*=\s*`, found anywhere in the source, not only at the start). The literal must be an object literal; after stripping comments and string contents any `(`, `)`, backtick or `...` in it is rejected ("pure literal"). It is evaluated in an empty vm context with 1000 ms timeout and JSON-cloned. `meta.name` and `meta.description` are required non-empty strings; `meta.phases`, if present, must be an array. The meta statement (plus trailing spaces/tabs/`;`) is replaced by blanks keeping newlines so stack traces keep file line numbers; the body is wrapped in `(async () => {\n...\n})()` with `lineOffset -1`, so top-level `await` and `return` work. `matchBrace` skips strings, template literals and comments. The script must be plain JS (TypeScript syntax and other `import`/`export` fail at compile).
- Proposal: KEEP the contract (literal meta, line-preserving body); CHANGE the detection to an anchored first statement (the doc says "must begin with", the code accepts a match anywhere, including inside a comment before the real one).
- Source: kit:RT/workflow_engine.mjs:20-76, 248-249; kit:REF/paseo-runtime.md:215-233; kit:REF/workflow-recipes.md:210-214
- Why it exists: parity with the upstream Workflow tool (meta must be static so a runner can list phases without running); line numbers for error reports. Not stated further.
- Test idea: a script whose meta uses a template string or a call fails `parseScript` with "pure literal"; an error thrown on body line 12 reports line 12 of the file.

### WFL-02 Determinism guards in the vm
- Behavior: inside scripts `Math.random()` throws; `Date()` as a function throws, `new Date()` with no args throws, `Date.now()` throws; `new Date(x)`, `Date.UTC`, `Date.parse` work. Messages tell the author to pass timestamps through `args` and to vary prompts by index. No `require`, `import`, files or network (a fresh vm context). `console.log/info/warn/error` are mapped to `log`.
- Proposal: KEEP (resume cache correctness depends on it).
- Source: kit:RT/workflow_engine.mjs:129-152; kit:REF/paseo-runtime.md:231-233; kit:REF/workflow-recipes.md:48, 214
- Why it exists: "it would break resume" (kit:RT/workflow_engine.mjs:135, 139-146).
- Test idea: `Math.random()`, `Date.now()` and `new Date()` each make the workflow fail with the documented message; `new Date(0)` works.

### WFL-03 `agent(prompt, opts?)` contract
- Behavior: returns the final reply string, or with `opts.schema` the validated object, or `null` (never rejects) when the runner reports a null result (agent failed after retry, timeout, schema never matched, watchdog stop, runner exception). `String(prompt)` coercion; opts crosses the vm boundary as JSON. A runner exception is caught and turned into `null` with reason `runner error: <msg>`. Throws (configuration errors): unknown option, invalid schema, `isolation` other than `'worktree'`, budget exhausted, agent cap reached. Runner-side failures (unknown `agentType`, a missing `include:` file, model resolution error, worktree creation outside a git repo) are caught inside `workflowRunner` and become `null` with that message; they neither reject `agent()` nor fail the run (kit:RT/commands.mjs:646-652, 710-716; kit:RT/prompts.mjs:31, 85-88). A direct `await agent()` that throws fails the workflow; inside `parallel`/`pipeline` it becomes a `null` item with a logged warning.
- Proposal: KEEP.
- Source: kit:RT/workflow_engine.mjs:153-157, 253-301; kit:REF/paseo-runtime.md:239
- Why it exists: upstream parity (a failed agent returns null, scripts filter with `.filter(Boolean)`).
- Test idea: a fake runner returning `{status:'null'}` yields `null` in the script; an unknown option makes a direct `await agent()` fail the run but yields `null` inside `parallel`.

### WFL-04 `agent()` options
- Behavior: allowed keys `label, phase, schema, agentType, model, effort, isolation, readOnly, cwd, keep`. `label` defaults to `phase ?? currentPhase ?? "agent"`; `phase` defaults to the last global `phase()`. `model` = tier name or `provider/model` (default: agent type's `model:` else `default_tier`); `effort` = thinking option (`low..max`, clamped to the model's options); `readOnly:true` adds the read-only note; `cwd` is an instruction in the prompt (Paseo ignores a requested cwd); `keep:true` leaves the agent unarchived. Agent title = `<meta.name>:<label>` (title truncated to 60 chars by createAgent).
- Proposal: KEEP; DROP anything of `isolation` that is not needed once the owner decides worktrees (see WFL-28).
- Source: kit:RT/workflow_engine.mjs:13-16, 254-264; kit:REF/paseo-runtime.md:248-261; kit:RT/commands.mjs:647-652, 671-673; kit:RT/daemon.mjs:121 (thinking clamp), 123 (title.slice(0, 60))
- Why it exists: parity with upstream options; cwd-as-instruction because Paseo 0.10.0 ignored cwd (kit:REF/paseo-runtime.md:397-401).
- Test idea: `agent('x', {bogus:1})` throws `unknown option 'bogus'`; label defaults to the active phase title.

### WFL-05 `pipeline(items, ...stages)`
- Behavior: each item runs through all stages independently (no barrier); each stage gets `(previousResult, originalItem, index)`. A throwing stage makes that item `null` (warning `pipeline item <i> -> null: <msg>`) and skips its later stages; a stage that returns `null` passes `null` to the next stage. Non-array items throws TypeError. Max 4096 items per call. Result: one entry per item, order preserved. Default for multi-stage work.
- Proposal: KEEP.
- Source: kit:RT/workflow_engine.mjs:12, 165-176; kit:REF/paseo-runtime.md:240; kit:REF/workflow-recipes.md:46, 215
- Why it exists: avoid barriers so fast items do not wait for slow ones (kit:REF/workflow-recipes.md:216).
- Test idea: stage 2 of item A starts before stage 1 of item B ends; a throwing stage yields `null` for that item only.

### WFL-06 `parallel(thunks)`
- Behavior: runs an array of `() => Promise` concurrently and waits for all (barrier). A throwing thunk resolves `null` (warning `parallel item <i> -> null: <msg>`); the call never rejects. Non-array throws TypeError; max 4096 items.
- Proposal: KEEP.
- Source: kit:RT/workflow_engine.mjs:158-164; kit:REF/paseo-runtime.md:241
- Why it exists: not stated beyond upstream parity.
- Test idea: one thunk throws, the others return; result has `null` at that index and no rejection.

### WFL-07 `phase`, `log`, `console`
- Behavior: `phase(title)` sets the global current phase and prints `phase <title>`; if `meta.phases` exists and no element's `.title` equals the string (r1: `detail` is not validated; an array of bare strings never matches, so every `phase()` warns), prints `log warning: phase "<t>" has no entry in meta.phases`. `log(m)` prints `log <m>`. A global `phase()` inside parallel stages is racy; stages should pass `opts.phase`.
- Proposal: KEEP; CHANGE optional: make phase part of the agent call context rather than a global.
- Source: kit:RT/workflow_engine.mjs:149-152, 221-229; kit:REF/paseo-runtime.md:242-243; kit:REF/workflow-recipes.md:217-218
- Why it exists: progress grouping (upstream).
- Test idea: unknown phase title produces the warning line; `log('a')` produces `log a`.

### WFL-08 `args`
- Behavior: global `args` = the JSON of `--args`/`--args-file`, verbatim (`undefined` if none). Nested workflows get the JSON-cloned `args` they were called with. `--args` and `--args-file` together is a usage error. A resumed run reuses the old run's `args.json` when none is given.
- Proposal: KEEP.
- Source: kit:RT/workflow_engine.mjs:134, 222; kit:RT/commands.mjs:743-749; kit:REF/paseo-runtime.md:244, 327-328
- Why it exists: not stated.
- Test idea: `--args '{"a":1}'` reaches the script as `args.a === 1`; `--resume R` alone sees R's args.

### WFL-09 `budget` and token accounting
- Behavior: `budget = {total, spent(), remaining()}`; `total` is `null` without `--budget` (value parsed from `500000`, `500k`, `1.5m`, else error), `remaining()` = `max(0, total-spent())` or `Infinity`. `spent()` = output tokens of this run's agents (charged when each runner call returns) + `extraSpent()` (the orchestrator's own finished turns during the run: one pool, upstream rule). Once `spent >= total` new `agent()` calls throw; already running agents can overshoot. Runner tokens = output tokens summed over every finished turn, via `turn_completed` events subscribed from agent creation; turns that error/are interrupted report no usage and are not counted; a turn that finished before subscribing is added from `lastUsage` (`settleTurn`, waits up to 2 s; dedup and late-drop rules in WFL-53).
- Proposal: KEEP (budget as output-token pool incl. orchestrator); OPEN: whether output-only counting is the right metric for the circle provider (see Open questions).
- Source: kit:RT/workflow_engine.mjs:89-95, 177-181, 215, 235, 275-277, 290; kit:RT/commands.mjs:643, 750, 785-791; kit:RT/daemon.mjs:51-79; kit:REF/paseo-runtime.md:245, 402-407
- Why it exists: upstream "one pool for the main loop and its workflows" (kit:RT/commands.mjs:785-786); daemon keeps only last turn's usage (kit:REF/paseo-runtime.md:402-407).
- Test idea: `--budget 5` with 10-token agents and `maxConcurrent 1` starts exactly one agent (regression test "queued workflow calls recheck", kit:SK/scripts/runtime_regression.test.mjs:352-360).

### WFL-10 Nested `workflow(nameOrRef, args?)`
- Behavior: runs another script inline, returns its JSON-cloned return value (or `undefined`). `nameOrRef` is a name (resolved to `.agents/workflows/<name>.js|.mjs`, then `.claude/workflows/`) or `{scriptPath}` (relative to project root). The child shares the semaphore, agent counter, journal, budget and resume cache; it has its own `meta`, phase state and args. Nesting is one level (`depth >= 1` throws "workflow() nesting is one level only"); throws when no `resolveChild`; logs `log nested workflow <path>`. Unknown name: `no saved workflow '<name>' in .agents/workflows/`.
- Proposal: KEEP; the `.claude/workflows` fallback is legacy: CHANGE to a single location (`.agents/workflows`) unless the new kit keeps `.claude/`.
- Source: kit:RT/workflow_engine.mjs:182-185, 237-244; kit:RT/commands.mjs:613-623; kit:REF/paseo-runtime.md:246
- Why it exists: upstream parity.
- Test idea: a child called from a child throws; a child's agents count in the parent's `stats.started`.

### WFL-11 Structured output (`opts.schema`) and validation retries
- Behavior: schema root must be `{type:'object', properties:{...}}` and every `required` key must be in `properties` (else throws at call time). With a schema the agent's final message must be JSON; the runner calls `P.structured({caller, prompt, schema, maxRetries: schema_retries, schemaName:'Result'})` which validates (Ajv, Paseo CLI's loop) and on mismatch asks the same agent again with the errors; after `schema_retries` (default 2) extra attempts the result is `null` with reason `<error>: <first 3 validation errors>`. Schema is passed natively (`outputSchema`) only when the agent is created with the task as first message; a role-primed agent gets the schema as prompt text. The result is `JSON.stringify`-ed across the vm boundary and parsed back. The fully rendered schema/retry wrapper is size-checked before every send.
- Proposal: KEEP behavior; CHANGE implementation: the new kit cannot rely on `P.structured` from the Paseo CLI client unless that is kept as a dependency (OPEN: own validator vs Paseo's).
- Source: kit:RT/workflow_engine.mjs:78-87, 257, 265; kit:RT/commands.mjs:679-709, 715; kit:SK/scripts/runtime_regression.test.mjs:142-164; kit:REF/paseo-runtime.md:43, 107; kit:RT/prompts.mjs:60-64
- Why it exists: audit RUN-3 (native schema only at creation) - kit:RT/commands.mjs:679-681; oversize wrapper rejected before READY (test names).
- Test idea: a reply missing a required key triggers a retry turn in the same agent with the validation error; after retries exhausted `agent()` is `null` and the journal reason names the errors.

### WFL-12 Concurrency, caps and admission order
- Behavior: a counting semaphore of `max_subagents` (default 20, min 1) bounds active agents of the run (nested included); extra calls queue FIFO. `max_agents_per_workflow` (1000) bounds started agents per run incl. nested; exceeding throws `agent cap reached`. Both budget and cap are checked before queueing AND again after the semaphore is acquired (queued calls must recheck; only running agents can overshoot). Tokens of a finished call are charged before its slot is released so the next waiter sees the updated pool. Cached hits skip the budget, the cap and the semaphore. `parallel`/`pipeline` take at most 4096 items per call.
- Proposal: KEEP; the 20 default is machine-dependent (OPEN: derive from RAM, see Open questions).
- Source: kit:RT/workflow_engine.mjs:12, 116-126, 275-292; kit:RT/commands.mjs:793; kit:SK/scripts/runtime_regression.test.mjs:352-360; kit:REF/paseo-runtime.md:263-278
- Why it exists: 2026-10-04 30 agents exhausted 32 GB RAM, ~350 MB per Claude process (kit:REF/paseo-runtime.md:269-273; kit:project/.agents/harness.defaults.json:2 `_notes`, line 83).
- Test idea: 5 queued calls, budget 5 tokens, first call spends 10: only 1 runner call happens.

### WFL-13 Resume: cache key and occurrence matching
- Behavior: `cacheKey = sha256(JSON({prompt, schema, agentType, model, effort, isolation, readOnly, cwd} where defined)).slice(0,32)`; `label`, `phase`, `keep` are NOT part of the key. The n-th call with the same key in a run maps to the n-th earlier entry (`occ` counter assigned synchronously at call time, before any cache lookup). Only journal entries with status `ok` or `cached` and a key are loaded; earlier `null` calls run live. A cache hit returns the stored result, writes a new journal entry with status `cached`, tokens 0, duration 0, prints `agent cached #<n> <label>`, and does not count toward budget/cap/concurrency. The same script and args resume to a 100 % cache hit; edited prompts rerun only what changed. Unparseable journal lines are skipped. `--resume R` requires `R/journal.jsonl` ("cannot resume: ... not found"); without `--script/--name` it reruns `R/script.js`; without args reuses `R/args.json`.
- Proposal: KEEP.
- Source: kit:RT/workflow_engine.mjs:13-16, 97-114, 259-274; kit:RT/commands.mjs:731-752; kit:REF/paseo-runtime.md:321-328
- Why it exists: cost of rerunning part of a workflow (kit:REF/execution-modes.md:41).
- Test idea: run, then `--resume` with the same script: stats show `cached == started_earlier`, 0 runner calls; edit one prompt: only that call runs.

### WFL-14 Resume staleness limit
- Behavior: the key ignores the agent definition body, its `include:` files, and the tier-to-model mapping; changing them does not invalidate cached calls. Doc rule: resume only over unchanged definitions and config, else start a new run.
- Proposal: CHANGE: include a hash of the resolved role text (body + includes) and the resolved `provider/model` in the key, or record them and warn on mismatch.
- Source: kit:REF/paseo-runtime.md:390-392; kit:RT/workflow_engine.mjs:16
- Why it exists: audit ENG-5 (known, not fixed).
- Test idea: edit `.agents/agents/x.md`, resume: the call reruns (or warns).

### WFL-15 Journal format (`journal.jsonl`)
- Behavior: one JSON line appended per finished or cached `agent()` call (append-only, synchronous): `{n, key, occ, label, phase, agentId, model, status: ok|null|cached, reason, result, tokens, duration_s}`; `reason` is null for ok/cached, `unknown` default for null; `result` null for null status; cached entries copy the earlier agentId/model/result. `tokens` = the agent's output tokens over all its turns. Calls that throw before running (budget, cap, bad option) produce no journal line. Doc: read the journal before diagnosing an empty/odd result (it records what each agent really returned).
- Proposal: KEEP; CHANGE optional: also journal start events so a killed runner's in-flight calls are visible (the sample run lost 2 of 4 agents that never reached a journal line).
- Source: kit:RT/workflow_engine.mjs:213, 270-271, 295-297; kit:REF/paseo-runtime.md:315-319; wildera:_workspace/_runs/wf_20261015-011128_ecea/journal.jsonl:1-2
- Why it exists: diagnosing empty results; resume source.
- Test idea: after a mixed run the journal has one line per finished call with the listed fields.

### WFL-16 Run directory and `run.json` lifecycle
- Behavior: `--runs-dir` default `_workspace/_runs`; per run `<runId>/`: `script.js` (exact script), `args.json` (`null` when none), `run.json`, `journal.jsonl`, `log.txt`, `result.json`. `run.json` at start: `{runId, parent (resume source or null), script (absolute path), status:'running', startedAt, endedAt:null, agents:null, budget, pid}`; on success rewritten with `name, description, status:'done', endedAt, agents:{started,ok,null,cached,tokens}`; on exception `status:'failed', error, endedAt`; `ph archive --run` writes `status:'stopped'`. Written atomically (tmp file + rename). `result.json` = the script's return value (`null` if undefined).
- Proposal: KEEP; the layout is the integration point for watchers and stats.
- Source: kit:RT/commands.mjs:775-805; kit:RT/workflow_engine.mjs:314-319; kit:REF/paseo-runtime.md:307-319; wildera:_workspace/_runs/wf_20261015-011128_ecea/run.json:1-11
- Why it exists: `pid` for liveness checks (audit CMD-1/SIDE-6, kit:RT/commands.mjs:777).
- Test idea: a done run has all six files and `run.json.status == 'done'` with agent counts.

### WFL-17 Run id format
- Behavior: `wf_<yyyymmdd>-<hhmmss>_<4 hex>` from local time plus 2 random bytes; `--run-id` overrides (used by the detached child).
- Proposal: KEEP.
- Source: kit:RT/workflow_engine.mjs:308-312; kit:RT/commands.mjs:753
- Why it exists: sortable, collision-resistant ids. Not stated.
- Test idea: the id matches `^wf_\d{8}-\d{6}_[0-9a-f]{4}$`.

### WFL-18 `ph workflow` command surface
- Behavior: `ph workflow [--script F | --name N] [--args JSON | --args-file F] [--resume RUNID] [--budget 500k] [--runs-dir D] [--detach]`. `--script` and `--name` together is a usage error; one of `--script`/`--name`/`--resume` is required. `--name N` = `.agents/workflows/N.js|.mjs` (then `.claude/workflows`). The script's meta is parsed before anything starts (fail fast). Needs `PASEO_AGENT_ID` (caller) and a Paseo daemon. Exit codes (r1 correction): 1 only for errors thrown before the run's try block (bad/missing flags, `--script` with `--name`, both `--args` and `--args-file`, missing resume journal, `parseScript` failure, unparsable args JSON, bad `--budget`; printed `usage error:` for UsageError, else `failed:`). `run.json` (status running) is written and `workflow start` is logged BEFORE `paseo()` and `requireCaller()`; a missing `PASEO_AGENT_ID`, a daemon/CLI failure or any script error then rewrites `status:'failed'` with `error` and exits 2 (no `result.json`, no `name`/`description`). `--detach` exits 0 without calling either; the detached child takes this path. `loadConfig()` runs outside the try after the run directory exists, so a config error leaves a run directory without `run.json` (see WFL-41). Source: kit:RT/commands.mjs:742-768, 774-805, 883-887; kit:RT/daemon.mjs:90-91. Final lines: `workflow done <runId>: <runDir>/result.json (ok k, null m, cached c, tokens t)` or `workflow failed <runId>: <error>`.
- Proposal: KEEP.
- Source: kit:RT/commands.mjs:726-806; kit:REF/paseo-runtime.md:196
- Why it exists: not stated.
- Test idea: `ph workflow` with no flags exits 1 with the usage hint; a failing script exits 2 and writes `status:'failed'`.

### WFL-19 Detached runs
- Behavior: `--detach` writes `script.js`, spawns a detached child `ph workflow ...args --run-id <id>` with stdout/stderr appended to `log.txt` and env `PASEO_HARNESS_LOG_IS_STDOUT=1` (so lines are not written twice), prints `workflow started <runId>: <log.txt>` and a `next:` hint to watch with `ph watch-run <runId>` under Monitor and not to poll with sleep/grep. Foreground runs print and append to `log.txt` themselves.
- Proposal: KEEP.
- Source: kit:RT/commands.mjs:757-773; kit:REF/paseo-runtime.md:330-344
- Why it exists: long runs must not block the orchestrator; no poll loops.
- Test idea: detached start returns immediately and `log.txt` grows without duplicated lines.

### WFL-20 Progress line grammar
- Behavior: `workflow start <runId> <runDir>`, `phase <title>`, `log <message>` (also `log warning: ...`, `log nested workflow <path>`, `log watchdog: ...`, `log runner lost the daemon connection ...`), `agent start #<n> <label> <id8> <model>[ prime:two-turn]`, `agent done #<n> <label> ok|null (<reason>) tokens=<n> <s>s`, `agent cached #<n> <label>`, `workflow done|failed ...`. `n` is the 1-based call sequence number of the run (assigned at call time, so start order can differ from n).
- Proposal: KEEP as a stable, documented grammar (run_stats and watch_run parse it). CHANGE: also emit an explicit `agent failed #n ...` line or fix the watcher filter (see WFL-41).
- Source: kit:RT/workflow_engine.mjs:223-228, 241, 272, 298-299; kit:RT/commands.mjs:676, 713, 781, 799, 803; kit:REF/paseo-runtime.md:338-341; wildera:_workspace/_runs/wf_20261015-011128_ecea/log.txt:1-12
- Why it exists: consumed by watch_run and run_stats.
- Test idea: a run's log matches the grammar line by line (regex per line type).

### WFL-21 Script return value and failure semantics
- Behavior: the return value is JSON-round-tripped (`undefined` stays undefined; functions/undefined fields dropped). A thrown error in the body fails the run (`workflow failed`, `status:'failed'`, journal kept, resume possible). Un-awaited `agent()` calls may still run after "workflow done" (vm gives no isolation, known limit).
- Proposal: KEEP; CHANGE: track un-awaited agent promises and wait/cancel them at run end.
- Source: kit:RT/workflow_engine.mjs:250; kit:RT/commands.mjs:801-805; kit:REF/paseo-runtime.md:387-389
- Why it exists: audit 2026-10-04 ENG-2..4.
- Test idea: a script that fires `agent()` without awaiting does not leave a running agent after the run ends.

### WFL-22 Workflow agent prompt assembly (runtime notes)
- Behavior: for workflow agents the prompt = optional role block (`Your role (<type>), complete below:` + body; includes pasted in full after the line "These files are already loaded in full below; do not open them and do not call the Skill tool for them."; the definition's own path is not named, but each include is pasted under a `===== <repo-relative path> =====` header) + task + `Runtime notes:` list: "Your final message is the return value for the orchestrating script, not a message to a person: return only the data asked for."; read-only note when `opts.readOnly === true` (strict) or the definition is read-only (`definitionReadOnly`: `tools:` non-empty and matching neither `\b(Edit|Write|MultiEdit|NotebookEdit)\b` nor `edit_multiple_files|write_multiple_files|edit_file|write_file|move_file|create_directory`; the runner passes `opts.readOnly === true || def.readOnly`); worktree or cwd note; `first_prompt_note` + `platform_notes[platform]`; `Run <runId> #<n> (bookkeeping only; ignore).` The `Run ... #n` tag is what run_stats matches transcripts on. Prompts and definitions say "follow X (in your prompt)", never "read X first".
- Proposal: KEEP the Run-tag contract here; the exact note texts belong to the prompts/method area (cross-ref).
- Source: kit:RT/prompts.mjs:7-9, 25-27, 45-59, 72-84; kit:RT/commands.mjs:657-658; kit:REF/paseo-runtime.md:121-169
- Why it exists: owner 2026-10-03 (every ux-designer called Skill and read two references, kit:REF/paseo-runtime.md:131-132); run_stats exact match (audit SIDE-5, kit:SK/scripts/run_stats.mjs:40-42).
- Test idea: a workflow agent's first prompt ends with `Run <runId> #<n>` and contains the return-value note.

### WFL-23 Role priming ("two-turn") and READY handshake
- Behavior: config `prime_role` default `"two-turn"` (other value `"off"`): for a call with `agentType`, the first message is role block + safety notes + "This message only loads your role. Reply with the single word READY; your task comes in the next message."; the runner waits for that turn, then sends the task as a second message (task text starts `Task (your role, <type>, and its files are in the first message; do not open them again):`). Calls without a type are not primed. Safety constraints (read-only, worktree/cwd, first note) apply in the priming turn too. `ph spawn`/`fanout` are not primed. Log line gets ` prime:two-turn`.
- Proposal: OPEN: the doc says the 2026-10-04 cache savings are not guaranteed for current proxies/models; keep only after measuring completed-task cost, cache fields and latency (Open questions).
- Source: kit:RT/commands.mjs:653-661, 682-692; kit:RT/prompts.mjs:65-73; kit:REF/paseo-runtime.md:133-140; kit:project/.agents/harness.defaults.json:90
- Why it exists: sending role and task in one steer merged both into one model call and the Circle proxy did not cache at the end of the role block; 3 runs 2026-10-04: 15-16k uncached per agent vs 4-8k with two turns (kit:RT/commands.mjs:653-655).
- Test idea: with priming on, the daemon sees two prompts to the agent (role/READY, then task) and the first carries the read-only note.

### WFL-24 Warm-up gate
- Behavior: config `warmup` (true), `warmup_s` (8), `warmup_timeout_s` (90). Per `runId|agentType|model id|thinking` the first agent starts alone; later agents with the same key wait on its gate (or `warmup_timeout_s`, whichever first). The gate opens after the first agent's role turn (priming on) or `warmup_s` after its creation (priming off), and always in `finally` on failure. Only applies to calls with an agent type. The fallback timer is cleared when the gate opens (a pending timer kept `ph workflow` alive up to 90 s after done).
- Proposal: OPEN, decided together with WFL-23 (it only exists to get cache hits on the shared role prefix).
- Source: kit:RT/commands.mjs:625-630, 662-670, 677, 719; kit:project/.agents/harness.defaults.json:87-89; kit:REF/paseo-runtime.md:109
- Why it exists: a cache entry is usable only after the first response has begun; the 2026-10-03 audit burst had 14 of 36 cold first turns; timer leak owner 2026-10-04 (kit:RT/commands.mjs:625-629, 665-666).
- Test idea: 3 same-type calls: the 2nd and 3rd creations happen only after the 1st gate opens.

### WFL-25 Prompt size bound
- Behavior: `max_prompt_bytes` default 262144 (UTF-8 bytes of the final rendered text). Checked for the composed task prompt, the role prompt, includes, the schema/retry wrapper, every watchdog message, and in `createAgent`/`sendPrompt` before any daemon call. Oversize throws `prompt is N bytes > max_prompt_bytes L; pass a file path instead of inlining content`; the call becomes `null` with that reason and no agent is created.
- Proposal: KEEP.
- Source: kit:RT/prompts.mjs:60-64; kit:RT/daemon.mjs:107-108, 130-133; kit:RT/commands.mjs:684; kit:SK/scripts/runtime_regression.test.mjs:133-164; kit:project/.agents/harness.defaults.json:108
- Why it exists: a 42 MB prompt made the daemon drop the runner socket at its outbound high-water mark (run wf_20261004-153848_8eb7; kit:RT/commands.mjs:659-660, kit:REF/paseo-runtime.md:274-275).
- Test idea: a 300 KB prompt makes `agent()` return `null` with the byte message and zero `createAgent` calls.

### WFL-26 Turn waiting, one continue, permission questions
- Behavior: a turn is awaited up to `wait_timeout_s` (3600) (`no reply within N s`). A turn ending in an error is continued once in the same agent with "Your previous turn ended with an error. Continue the task from where you stopped." unless the error matches `quota|credit|billing|auth|unauthori[sz]ed|forbidden|permission|invalid api key`. An `AskUserQuestion` permission request is denied up to 3 times with a message telling the agent nobody answers and to record open decisions in its result; any other pending permission fails the call (`agent is waiting for a permission: ...`). A finished turn with an empty reply fails with `finished without a reply`.
- Proposal: KEEP.
- Source: kit:RT/daemon.mjs:12-15, 138-160; kit:RT/commands.mjs:703; kit:REF/paseo-runtime.md:280-286, 106
- Why it exists: do not burn remaining quota on a request that fails again (kit:REF/paseo-runtime.md:282-284).
- Test idea: an `error` status with "quota exceeded" fails at once; an "overloaded" error gets exactly one continue turn.

### WFL-27 Transport loss
- Behavior: after the first `Transport closed` / `Transport not connected` error the runner logs `log runner lost the daemon connection (<err>): remaining agent() calls return null; resume the run` and every later `agent()` returns `null` at once with reason `daemon connection lost earlier in this run (...)`; no reconnect, no orphan agents. Diagnose in the Paseo daemon log (search `high-water`), archive the run's agents, resume.
- Proposal: KEEP; OPEN whether the new runner reconnects.
- Source: kit:RT/commands.mjs:632-635, 645, 710-716; kit:REF/paseo-runtime.md:303-305
- Why it exists: avoid creating agents the runner cannot follow.
- Test idea: simulate a transport error on call 1; calls 2..n return `null` without `createAgent`.

### WFL-28 Agent lifecycle: labels, archive, keep
- Behavior: created agents carry labels `harness.run=<runId>`, `harness.name=<label>` plus the parent-agent label; title `<workflow>:<label>`; env `PASEO_HARNESS_ROLE=worker`, `PASEO_HARNESS_LEADER`, `PASEO_HARNESS_ROOT`. The watchdog is armed at creation and disarmed in `finally`. After the call the agent is archived unless `opts.keep`; an archive failure is logged `log warning: archive <id8> failed: ...`. Agents of a killed runner stay alive (idle) until archived (`ph archive --run`).
- Proposal: KEEP.
- Source: kit:RT/commands.mjs:671-678, 717-723; kit:RT/daemon.mjs:122-127 (title 123, worker env 126, labels 127: PARENT_LABEL plus the runner's harness.run/harness.name); kit:REF/paseo-runtime.md:260-261, 271-273
- Why it exists: orphan control; the `harness.run` label is how `archive --run` finds agents.
- Test idea: after a run no agent labelled `harness.run=<id>` is unarchived except `keep:true` ones.

### WFL-29 Worktree isolation and cwd instruction
- Behavior: `isolation:'worktree'` creates a git worktree `<repo>/.claude/worktrees/<runId>-<n>` on branch `harness/<runId>-<n>` per agent (needs a git repo, else `isolation 'worktree' needs a git repository`, which is caught in `workflowRunner` and becomes the `null` reason of that call, not an uncaught throw), kept after the run; the agent is told to edit only there. `opts.cwd` is resolved against the project root; because Paseo 0.10.0 ignored a requested cwd both are instructions in the prompt and the cwd is still passed to the daemon. `ph worktrees [--prune]` lists them with owner/state and prunes only finished-owner, clean, merged ones (branches by `git branch -d`; unknown owner kept). r1 detail: a workflow worktree is "in use" only when its `run.json` exists with `status == running` and a live `pid` (a killed runner still marked running is NOT in use); a missing `run.json` is "owner unknown" and kept; a spawned-agent owner is looked up by the `harness.name` label, and a daemon failure prints `note daemon not reachable (...): worktrees of spawned agents are kept`; a git record flagged `prunable` is state `directory missing` and removable even if the owner looks in use. Removal = `git worktree remove` (or `git worktree prune` when the directory is gone) then `git branch -d`; if `-d` refuses, the worktree is still gone and the line says the branch is kept; a failed removal counts as a failure and the command exits 2. Not a git repo: usage error; empty list: `no harness worktrees`. Source: kit:RT/worktrees.mjs:42-71; kit:RT/commands.mjs:829-857.
- Proposal: OPEN: keep worktree isolation or drop (cross-area with gsd execute waves); recheck whether current Paseo honours cwd/worktrees natively.
- Source: kit:RT/commands.mjs:650-652; kit:RT/prompts.mjs:52-56, 85-92; kit:SK/scripts/runtime_regression.test.mjs:436-468; kit:REF/paseo-runtime.md:199, 258, 397-401
- Why it exists: parallel file edits that would conflict; Paseo cwd limitation verified 2026-10-03.
- Test idea: two writers with `isolation:'worktree'` edit the same file name without conflict; `ph worktrees --prune` keeps the one with unmerged commits.

### WFL-30 Watchdog: model time since the last prompt
- Behavior: per agent, `modelMs = now - promptAt - union(tool spans)`. Tool spans are `[inputAt, completedAt]` of finished calls plus `[inputAt, now]` of open calls whose input is complete, each clipped to `[promptAt, now]`, sorted and merged so overlapping parallel calls count once. `promptAt` is set when the watchdog is armed and on every `reset()` (called by the runner before each prompt it sends; watchdog's own messages do not reset it). A 10 s shared interval (`unref`'d, started once per process) ticks every armed agent.
- Proposal: KEEP (the model-time basis is the point: tool time such as builds must not be charged as the agent's time).
- Source: kit:RT/watchdog.mjs:100-106, 108-122, 147-148; kit:RT/commands.mjs:692; kit:REF/paseo-runtime.md:288-293
- Why it exists: owner 2026-10-04; a plain wall-clock limit stopped agents running long builds.
- Test idea: two overlapping 60 s tool calls inside a 100 s window leave `modelMs` = window minus 60 s, not minus 120 s.

### WFL-31 Tool-call clock starts when the input is complete
- Behavior: Paseo reports a call `running` at block start (empty input) and again as each input value completes. The call's execution clock `inputAt` (r1 correction): on a `running` event, if the input key changed it is stored and `inputAt = now` only when `inputReady` is true; if the key is unchanged `inputAt = now` only when it is still null and the input is now ready. A key change to a not-ready payload leaves the earlier `inputAt` in place (neither cleared nor moved). Readiness: typed `write` needs `filePath`+`content`; `edit` needs `filePath` and `newString` or `unifiedDiff`; `shell` needs `command`; `read` needs `filePath`; for untyped `{input}` details: `write_multiple_files` needs a files array whose entries all have string `content`; `edit_multiple_files` needs files with non-empty `edits` or non-empty `fixes`; `*write_file` needs string `content`; `*edit_file` needs non-empty `edits`; any other tool needs a non-empty input. Time before readiness is model time (counts for nudge/stop). Input key = JSON of the input fields only (a completed detail also carries output, exit code, read content; those are stripped).
- Proposal: KEEP; CHANGE: the readiness table is keyed on tool names (kit file tools, harness-files MCP); re-derive for the new kit's tool set.
- Source: kit:RT/watchdog.mjs:33-65, 66-99; kit:SK/scripts/runtime_regression.test.mjs:320-350; kit:CHANGELOG.md:5
- Why it exists: wildera run wf_20261015-011128_ecea: 3 of 4 architecture drafts were interrupted and lost; a 15 KB Write had its path at once, its content 104 s later (the Circle proxy delivers a long string value in one piece after the model generated it), done 0.2 s after; the 180 s file-tool limit counted generation time (kit:CHANGELOG.md:5, kit:RT/watchdog.mjs:45-48; wildera:_workspace/_runs/wf_20261015-011128_ecea/log.txt:8-12).
- Test idea: Write running with path only, tick at +400 s: no cancel and `modelMs >= 399 s`; add content, tick at +181 s: one cancel (regression test, kit:SK/scripts/runtime_regression.test.mjs:320-341).

### WFL-32 Late `running` event guard
- Behavior: a `finished` set of call ids; a `running` event for a call that already completed is ignored (a fast tool can report completed before its running event). Only `timeline` events with `tool_call` items that have a `callId` are processed; terminal statuses: `completed|failed|error|canceled|cancelled`; a call already `done` is not processed twice.
- Proposal: KEEP.
- Source: kit:RT/watchdog.mjs:66-84
- Why it exists: 2026-10-14, two false stops of healthy agents (kit:RT/watchdog.mjs:70-72).
- Test idea: feed `completed` then `running` for one call id: no open call exists afterwards and the stuck check never fires.

### WFL-33 Tool kind classification
- Behavior: `write` for Edit/MultiEdit/Write/NotebookEdit/patch/apply_patch and file-MCP write/edit/create_directory/move_file tools (filesystem, fsbatch, harness-files prefixes, with or without `mcp__`); `read` for read/grep/glob/ls/list/view/read_file and file-MCP read/search/list/info/tree tools; shell tools (bash, powershell, shell, exec_command, local_shell) are classified by command text: write when it redirects (`>`, `>>` not `>&`) or contains writeFileSync/appendFileSync/Set-Content/Out-File/Add-Content/rm/mv/cp/mkdir/New-Item/Remove-Item/`--write`; read when it starts with cat/head/tail/sed -n/grep/rg/ls/find/Get-Content/Select-String/type or contains readFileSync; else `other`. Typed details (`{type:'read', filePath}` etc.) carry no `detail.input`, so the detail itself is the input (native Read/Write/Edit/Bash count since the Unreleased fix).
- Proposal: CHANGE: classify by a table of exact tool names of the new kit (Claude Code native + the kit file mod) rather than prefix regexes of dropped adapters (fsbatch, filesystem, Codex tool names); keep the shell-text heuristic only if needed.
- Source: kit:RT/watchdog.mjs:13-25, 33-35; kit:CHANGELOG.md:5
- Why it exists: owner wanted reread/repeat/piecemeal detection to see all agents' file access; typed-detail gap found 2026-10-15.
- Test idea: a native `Read` of `a.cpp` twice (typed detail) triggers `reread` at threshold 2 (kit:SK/scripts/runtime_regression.test.mjs:343-349).

### WFL-34 Behavior checks: loop, reread, piecemeal
- Behavior: evaluated on each completed call, one signal per kind per prompt (`signals` set; none after stop):
  - `loop`: same tool name + identical non-empty input key completed `watchdog_repeat_calls` (3) times since the last prompt/write.
  - `reread`: the same file path read `watchdog_same_file_reads` (3) times (only read-kind calls that are not directory/search tools: list_directory, directory_tree, search_files, glob, grep, ls, list; paths from `file_path`, `filePath`, `path`, `paths[]`, `ranges[].path`, normalised to `/` and made project-relative, case-insensitive prefix).
  - `piecemeal`: `watchdog_reads_without_write` (15) read-kind calls with no write between.
  -  Order on a completed call (r1 correction): a write-kind call FIRST clears `readsSinceWrite`, `fileReads` and `repeats`, and only then is this call's own input key stored, so it counts as 1; identical Edit/Write/shell-write calls therefore never reach `watchdog_repeat_calls` by themselves. A write does not clear `signals`, so a signal already sent in this prompt does not fire again after the write ("check -> fix -> check is progress"). A completed call with an empty input key is not counted for `loop`.
  Each signal logs `log watchdog: <label> <id8> <kind>: <json[0..160]>` and sends one steering prompt: loop ("same input N times ... that is a loop ... use the result you already have or change the approach ... not a reason to stop early or return an empty result"), reread ("Read a file once and keep what you need ... then finish the whole task"), piecemeal ("get everything you still need in one batched read (or one script), then produce the complete result").
- Proposal: KEEP behavior and thresholds as config; CHANGE message texts only via the prompts owner (OPEN with method area).
- Source: kit:RT/watchdog.mjs:7-11, 28-32, 85-98, 111-119; kit:REF/paseo-runtime.md:288-296, 300-301; kit:project/.agents/harness.defaults.json:115-117
- Why it exists: owner 2026-10-04 (agents rereading one file 3+ times, 15+ piecemeal reads); the "not a reason to stop early" clause prevents agents answering empty (kit:RT/watchdog.mjs:8).
- Test idea: three identical Grep inputs fire exactly one `loop` message; a write between reads resets the counts (kit:SK/scripts/runtime_regression.test.mjs:306-318).

### WFL-35 Nudge and stop by model time
- Behavior: when `modelMs` since the last prompt reaches `agent_nudge_s` (default 900) the agent gets one message once per prompt ("Harness watchdog: you have used N minutes of your own time since the last prompt (tool time not counted). Finish now: ... do the remaining work in bulk ... give your final answer within the next 3 tool calls. If something blocks you, answer now and state the blocker."), log `... nudged to finish`. At `agent_stop_s` (default 1800) the agent is archived, state removed, log `... used N min of model time since its last prompt, stopped`, and the runner returns `null` with reason `watchdog stopped the agent after <agent_stop_s> s`. `0` disables either limit. Doc: a stopped agent usually needs a smaller task or a script, not a rerun; read its activity before resuming.
- Proposal: KEEP; fix the doc/default conflict below.
- Source: kit:RT/watchdog.mjs:6, 139-146; kit:RT/commands.mjs:693, 702; kit:project/.agents/harness.defaults.json:109-111; kit:REF/paseo-runtime.md:294-297
- Why it exists: nudge raised 300 -> 900 s and stop 900 -> 1800 s by owner 2026-10-05 because 5 min was too short for long text-generating tasks such as spec writing (kit:project/.agents/harness.defaults.json:109).
- Test idea: with nudge 10 s / stop 20 s and a model-only agent, tick at +11 s sends exactly one nudge and tick at +21 s archives it.

### WFL-36 CONFLICT: documented vs shipped watchdog numbers and stuck rule
- Behavior: docs state nudge 300 s / stop 900 s and "a single tool call longer than `agent_tool_stuck_s` (900) stops the agent"; defaults ship nudge 900 / stop 1800 / tool_stuck 900 plus `agent_file_tool_stuck_s` 180 and the interrupt-then-stop two-step. The CHANGELOG Unreleased entry and the defaults `_tool_stuck_note` agree with the code, paseo-runtime.md 6-4 does not. r1 additions: section 6-4 also says tool time starts "from the moment a call's input stops growing" (code: when the input is complete and ready, WFL-31) and gives the null reason as `watchdog stopped the agent` without `after <agent_stop_s> s` (code, kit:RT/commands.mjs:702, uses the longer text for both the model-time stop and a second hung tool); the defaults `_notes` string (kit:project/.agents/harness.defaults.json:2) still describes only nudge/stop/repeat and points at section 6-4, while `_watchdog_note` (line 109) and `_tool_stuck_note` (line 113) match the code.
- Proposal: CONFLICT: code and defaults win (newer, owner 2026-10-05 and 2026-10-14); the new spec must be written from the code values, doc rewritten.
- Source: kit:REF/paseo-runtime.md:294-301 vs kit:project/.agents/harness.defaults.json:109-114 and kit:RT/watchdog.mjs:122-138
- Why it exists: doc not updated after the owner changes.
- Test idea: a doc-vs-defaults consistency check in the new kit's tests (numbers in docs generated from defaults).

### WFL-37 Stuck-tool handling: interrupt once, then stop
- Behavior: an open call with complete input (`inputAt` set) running longer than its limit is "stuck": limit = `agent_file_tool_stuck_s` (default 180, falls back to `agent_tool_stuck_s`) for read/write-kind non-shell tools, `agent_tool_stuck_s` (900) for shells and everything else; `0` disables. First hang: `stuckInterrupted=true`, open calls cleared, `cancelAgent(agentId)` then the message "Harness watchdog: your <tool> call did not return and was interrupted. Check what it already changed (re-read the affected files), then continue the task with smaller calls (at most 3 files per batch call)."; the promise is `st.retry`, and the runner (turn loop) when the interrupted turn ends without a reply awaits `retry` and then waits for the retry turn instead of failing `finished without a reply`. Second hang in the same agent: stopped (archived), log `... one <tool> call ran N min without returning, stopped`. `stuckInterrupted` survives prompt resets.
- Proposal: KEEP; CHANGE: surface the real reason in the null result (today a stuck-tool stop reports `watchdog stopped the agent after <agent_stop_s> s`, see Concerns).
- Source: kit:RT/watchdog.mjs:12, 122-138; kit:RT/commands.mjs:693-702; kit:project/.agents/harness.defaults.json:112-114; kit:CHANGELOG.md:5
- Why it exists: 2026-10-04 one finder sat 30 min in one call and returned nothing (kit:REF/paseo-runtime.md:298-300); 2026-10-14 file tools return in ~1 s so a longer open call is a hang while shells may run builds; first-hang interrupt so finished work is not lost.
- Test idea: file tool open 181 s after complete input: one cancel and one retry message; second hang: archive.

### WFL-38 Watchdog messages are size-bounded and best-effort
- Behavior: every steering message goes through `sendPrompt` (prompt bound). A send failure is logged as `log watchdog: message to <id8> failed: <err>` and does not throw; the signal counts as used for that prompt. `archiveAgent`/`cancelAgent` errors are swallowed.
- Proposal: KEEP.
- Source: kit:RT/watchdog.mjs:115-119, 132, 137; kit:SK/scripts/runtime_regression.test.mjs:306-318
- Why it exists: a reread message naming a 2000-char path must not itself exceed `max_prompt_bytes` (test fixture).
- Test idea: a 2000-char path with `max_prompt_bytes 1000` logs the failure and sends nothing.

### WFL-39 Watchdog reset semantics and cleanup
- Behavior: `reset()` (before each runner prompt) clears `nudged`, `promptAt`, tool intervals, read counter, signals, repeat and file-read maps; does not clear `stuckInterrupted`, open calls or `finished`. `disarm()` removes the state; armed once per agent after creation; the `agent_stream` listener is attached once per client. Config merge: `{...loadKitConfig(), ...cfg}` then keys `agent_nudge_s, agent_stop_s, watchdog_repeat_calls, watchdog_same_file_reads, watchdog_reads_without_write, agent_tool_stuck_s, agent_file_tool_stuck_s`.
- Proposal: KEEP.
- Source: kit:RT/watchdog.mjs:108-121
- Why it exists: "each prompt resets it" (kit:REF/paseo-runtime.md:289-290).
- Test idea: after `reset()` a `reread` can fire again for the same file.

### WFL-40 Watchdog scope
- Behavior: armed only for workflow agents (`workflowRunner`); `ph spawn`/`fanout` agents are not watched.
- Proposal: OPEN: whether persistent teammates should also be watched (they are interactive; stop-by-archive would destroy their context).
- Source: kit:RT/commands.mjs:675 (only call site of `armWatchdog` in commands.mjs); kit:REF/paseo-runtime.md:293-294
- Why it exists: not stated.
- Test idea: spawn a teammate and let it exceed nudge time: no watchdog message (if kept as is).

### WFL-41 `watch_run.mjs` (run follower)
- Behavior: `watch_run.mjs <runId>... [--all] [--from-start]`, cwd must be the project root (`_workspace/_runs/<id>/{log.txt,run.json}`). Polls every 1 s, reading only appended bytes (partial last line kept in `rest`, CR stripped). Prints lines starting `log `, `phase `, `agent failed`, `workflow ` (`--all`: every line), prefixed `[<last 4 of id>] ` when several runs are watched. A run ends at a `workflow done|failed` log line, or when `run.json.status` is not `running` (prints `workflow ended (run.json status <s>)`), or when the recorded `pid` is not alive for 3 consecutive checks (prints `workflow interrupted (runner pid N is gone; end it with: ph archive --run <id>)`; `EPERM` counts as alive), or when the run directory does not exist within 60 s (`workflow not found (no <dir>)`). Exits 0 when all runs ended. Attaching to a log that already has lines prints one `resuming <id>: skipped N earlier lines; current phase <p> (--from-start replays them)` summary plus any terminal line instead of replaying; `--from-start` replays. Usage error (no ids) exit 1. Node stdlib only. r1 additions: the 60 s `workflow not found` rule fires only when the run DIRECTORY is absent; if the directory exists but `run.json` never appears (a detached child that dies before writing it, e.g. on a `loadConfig` error, kit:RT/commands.mjs:774-780) and no `workflow done|failed` line is logged, the watcher polls forever; `deadChecks` is not reset when the pid is seen alive again; every ended run (done, failed, interrupted, stopped, not found) exits 0. Source: kit:SK/scripts/watch_run.mjs:55-62.
- Proposal: KEEP; fix the dead `agent failed` filter (CHANGE: match `agent done ... null` lines, which carry the failure reason; today a failed agent is invisible without `--all` apart from watchdog `log` lines).
- Source: kit:SK/scripts/watch_run.mjs:1-64; kit:SK/scripts/runtime_regression.test.mjs:425-434; kit:REF/paseo-runtime.md:197, 334-342
- Why it exists: owner 2026-10-03 (`tail -F | grep` never exits, every finished run left a watcher until its timeout and an "expired" notice); owner 2026-10-14 (every re-arm replayed the whole log); audit SIDE-6 2026-10-04 (killed runner never writes a terminal status; the watcher polled forever); 3 dead checks so a runner that just wrote its last line is not mistaken for dead (kit:SK/scripts/watch_run.mjs:3-14, 59).
- Test idea: run.json `{status:'stopped', pid: 99999999}` makes the watcher print `workflow ended ... stopped` and exit 0 within 5 s; a dead pid with status `running` ends after 3 polls.

### WFL-42 `run_stats.mjs` (run statistics)
- Behavior: `run_stats.mjs <runId>...` prints per run 3 lines: `<id> [<roles>] status <s>`; `wall <s> s; agents <n>: median <s> s, slowest <s> s; tokens <t|?>`; `transcripts <k>, assistant messages <m>; tool calls: <kind> <n>, ...; png via Read <p>`. Wall time from run.json `startedAt/endedAt` (now if open); agent seconds from `agent done #n <label> <status...> <s>s` lines; tokens from the first `tokens N)` in the log (the `workflow done` line); roles = label prefix before `:` of `agent start` lines. Tool calls are counted from Claude Code transcript `*.jsonl` in `<CLAUDE_CONFIG_DIR | ~/.claude-circle | ~/.claude>/projects/<cwd with every non-alphanumeric replaced by '-'>`: a transcript belongs to the run if it contains `Run <runId> #` (exact tag, since 2026-10-04) else, for older runs and only when not tagged for another run, if it starts within `[start-5 s, end]` and has `Runtime notes:`. Kinds: read whole (multi) `read_multiple_files`, read ranges, Read, grep (Grep/Glob), edit batch, edit one file (`edit_file`/Edit), write (`write_*file(s)`/Write), Bash, Skill; plus count of PNG Reads. No transcript folder: error exit 1. r1 gaps: `agent cached` lines and `agent done` lines whose duration is `?s` do not appear in agent seconds (regex needs digits); another run's transcript is excluded only when it matches `Run wf_\S+ #\d+ \(bookkeeping` and not this run's tag; the fallback start time is the first `"timestamp"` in the first 4000 characters; the median is `secs[floor(n/2)]` of the sorted list (not the mean of the two middle values); the header comment (lines 8-10) still says overlapping runs are counted together while the tag check contradicts it. Source: kit:SK/scripts/run_stats.mjs:8-10, 34-43, 55. Test: the file mods `mcp__harness-files__*`, `mcp__filesystem__*` and native names are all counted (`edit one file 3`, `read ranges 1`).
- Proposal: CHANGE: keep wall/agent seconds/tokens/tool-call counts as a stats tool but derive tool kinds from the new kit's tool names; drop PNG-read counter unless still useful; read the journal (has duration_s and tokens per agent) instead of regexing the log.
- Source: kit:SK/scripts/run_stats.mjs:1-59; kit:SK/scripts/runtime_regression.test.mjs:411-423; kit:CHANGELOG.md:32
- Why it exists: owner 2026-10-03 (measure every change to the agent prompts on the next run, including wall time); audit SIDE-5 (time windows mixed overlapping runs; `Run <runId> #<n>` tag).
- Test idea: fixture run with a tagged transcript yields the expected counts; an untagged transcript of another run is excluded.

### WFL-43 `ph archive --run RUNID`
- Behavior: requires a caller; reads `run.json` (error if missing); if `pid` alive and status `running` kills the runner process (`stopped runner pid N` / `could not stop ...`); archives every agent of the caller labelled `harness.run=<runId>`; if status was `running` rewrites run.json with `status:'stopped'`, `endedAt`. Prints `archived k of n agents`; exit 0 all, 2 some failed. r1 corrections: the run.json path is always `<project>/_workspace/_runs/<runId>/run.json` (`ph archive --run` takes no `--runs-dir`, unlike `ph workflow` and `ph worktrees`; a run started with another `--runs-dir` is reported "no run"); the kill is `process.kill(pid)` with the default signal; the status is rewritten `stopped` whenever it was `running`, even if the kill threw; zero matching agents prints `archived 0 of 0 agents` and exits 0.
- Proposal: KEEP.
- Source: kit:RT/commands.mjs:461-488; kit:REF/paseo-runtime.md:193, 393-396
- Why it exists: audit CMD-1: a killed runner leaves idle agents and no terminal state.
- Test idea: a run with a live runner pid and two agents: after the command, runner gone, agents archived, run.json `stopped`.

### WFL-44 Orchestrator rules for workflows (modes, permission to run)
- Behavior: Mode A (workflow) is for code-determined flow over a known list (fan-out, loop-until-dry, adversarial verification, migrations); Mode B persistent agents + shared task list; Mode C one-shot subagents. Decision tree: expressible in code in advance -> A; else needs exchange of results/context -> B; else C. "The user must ask first": use a workflow only if the user asked for a workflow/multi-agent orchestration or invoked a skill that calls `ph workflow`; keep the default agent count small; a `parallel` barrier does not prevent later edits (freeze artifacts at mode boundaries, `ph freeze`); list the items and confirm the task list before starting a workflow.
- Proposal: KEEP the A/B/C model and decision tree; CHANGE the "user must ask first" rule to the owner's Paseo-only orchestration rule (main session has native Agent/Workflow denied; `ph` is the only path) and decide whether GSD wave execution counts as a standing request.
- Source: kit:REF/execution-modes.md:19-56, 118-142; kit:REF/paseo-runtime.md:42; owner memory main-session-no-native-subagents (C:/Users/fish/.claude-circle/projects/C--Users-fish-Desktop-paseo-harness-kit/memory/main-session-no-native-subagents.md)
- Why it exists: avoid runaway agent counts (upstream rule); owner 2026-10-14 one orchestration path.
- Test idea: main provider config denies Agent and Workflow while `ph workflow` runs.

### WFL-45 Recipes and authoring cautions
- Behavior: documented patterns: basic template; fan-out + adversarial verification via `pipeline` (optionally 3 verifiers, pass at >= 2 confirmed, different criterion per verifier); judge panel (N drafts -> parallel judges -> average -> synthesise; barrier needed because drafts are compared); loop until dry (dedupe against `seen`, not `confirmed`, otherwise rejected findings reappear forever); budget-aware loop (`while (budget.total && budget.remaining() > 50_000)`; without a budget `remaining()` is Infinity); custom agent type + schema + effort; tier choice (standard for collection, pro for verification/judging/design, frontier for planning). Cautions table: literal-only meta; no TypeScript; no Date/Math.random; null guards (`pipeline` passes `null` to the next stage, so guard each stage with `review => review && verify(review)` and `.filter(Boolean)` before aggregating); no needless barrier; match phase titles to `meta.phases`; never global `phase()` inside parallel stages (use `opts.phase`); log how many items were not processed; check `journal.jsonl` before diagnosing; keep the script in a file (so `--resume` works).
- Proposal: KEEP as the workflow authoring guide (shortened; scripts live in `.agents/workflows/`); DROP the sentence in recipes section 6 that other providers use MCP compatibility adapters (owner: Claude Code only, non-Claude MCP adapters are not carried; kit:REF/workflow-recipes.md:204), keeping its last sentence (agent `tools:` and read-only are advisory, WFL-51).
- Source: kit:REF/workflow-recipes.md:21-223
- Why it exists: audit-found mistakes (infinite dedupe loop, null passthrough, barriers).
- Test idea: each recipe script parses with `parseScript` and runs against a fake runner.

### WFL-46 Practice: WildEra `review-gate.js`
- Behavior: a project workflow (`.agents/workflows/review-gate.js`) with args `{waveId, cwd?, common, tasks:[{key,scope}], mode?:'review'|'resolve', open?, evidence?, reviewerModel, reviewerEffort?, verifierModel, verifierEffort?, minConfidence?}`. `review` mode: one read-only fresh reviewer per packet (parallel over packets, structured REVIEW schema with pass/fix + findings); a finding is gated when `severity=='high' && confidence >= minConfidence (80) && likelihood != 'theoretical' && trigger non-empty`; gated findings go to a separate read-only `finding-verifier` agent (model `verifierModel`, effort default medium) returning confirmed/refuted/uncertain per index; ungated non-minor findings are recorded as `downgraded` (high) or `deferred`; minor are dropped; a missing verifier verdict defaults to `confirmed` ("verifier returned no verdict"). `resolve` mode: one reviewer per packet checks the given `open` confirmed findings are fixed at the root (RESOLVE schema); a missing result leaves `resolved:null`, counted unresolved. Output `{waveId, mode, tasks, reviewMetrics}` and one `log review-gate <mode> <waveId>: <metrics>` line. Fixes happen outside the script. r1 details: `FORMAT` tells reviewers a theoretical finding is at most normal unless it is data loss or a security hole, but `gated()` rejects EVERY `likelihood == 'theoretical'` so such a high finding is only `downgraded`; a missing `confidence` counts as 0; reviewer effort defaults to `medium` (as does the verifier's); resolve mode with an empty `open` list for a packet returns `{key, findings: []}` and calls no agent; a null verifier result (not only a missing index) confirms every candidate (`vd?.verdict ?? 'confirmed'`, with evidence `verifier returned no verdict`). Source: wildera:.agents/workflows/review-gate.js:24-28, 33-35, 38, 44, 53-54. Sample args (`wildera:_workspace/review-gate/p1-entry-gate1.json`): models `circle/grok-4.7[1m]` (reviewer) and `circle/gpt-6.1-sol[1m]` effort high (verifier).
- Proposal: KEEP the pattern as the model for a GSD plan-review/code-review gate adapter (cross-area gsd-plan/method); CHANGE: avoid calling global `phase()` inside the parallel thunks (racy), use `opts.phase` only.
- Source: wildera:.agents/workflows/review-gate.js:1-67; wildera:_workspace/review-gate/p1-entry-gate1.json:1-14
- Why it exists: "Same gate as code-wave.js (owner 2026-10-17)" - bounded review, one pass, separate verifier before anyone fixes (wildera:.agents/workflows/review-gate.js:9-10, 28).
- Test idea: with a fake runner, a high finding with confidence 70 ends as `downgraded`, one with confidence 90 and a trigger reaches the verifier and ends `confirmed|refuted|uncertain`.

### WFL-47 Practice: run journal layout in WildEra
- Behavior: `_workspace/_runs/` held 185 run directories at first count, 187 at the r1 re-count (2026-10-14 .. 2026-10-20), each as WFL-16 (sample: script.js, args.json, run.json, log.txt, journal.jsonl). Sample run wf_20261015-011128_ecea (r1 corrected): 4 parallel drafters started in order #2, #4, #1, #3 (two `circle-agent/gpt-6.1-sol-fast[1m]`, two `circle-agent/claude-opus-5-5[1m]`); the log shows a `reread` on #4, then THREE interrupts: #2 Write 187 s, #4 Write 189 s, #3 Write 186 s. Only #2 and #4 reach `agent done ... null (finished without a reply) tokens=0` (393 s and 463 s) and only they are journal rows (n 2 and 4); #3 was interrupted with no done line and no journal row; #1 (`Draft:evolutionary`) has neither a watchdog line nor a done line. This is the changelog's "3 of 4 interrupted". Then the runner died; `run.json` ended `status:'stopped'` (set by `ph archive --run`), `agents:null`, `pid` kept. This is the incident behind WFL-31 and the retry-wait in WFL-37.
- Proposal: KEEP the layout; DROP nothing; consider pruning policy for old run dirs (OPEN, files area).
- Source: wildera:_workspace/_runs/wf_20261015-011128_ecea/run.json:1-11; wildera:_workspace/_runs/wf_20261015-011128_ecea/log.txt:1-13; wildera:_workspace/_runs/wf_20261015-011128_ecea/journal.jsonl:1-2
- Why it exists: evidence of the real failure mode.
- Test idea: replay the sample event sequence into the new watchdog and expect no interrupt for the Write whose content arrives late.

### WFL-48 Facade and exports
- Behavior: `scripts/workflow_engine.mjs` re-exports `MAX_ITEMS_PER_CALL, parseScript, checkSchema, parseBudget, cacheKey, loadJournalCache, runWorkflow, newRunId, writeJson` from the shared runtime via `sharedUrl("runtime/workflow_engine.mjs")` so source skills and their mirrors resolve the same engine; a test asserts these exports exist (and `onWatchEvent, modelMs, armWatchdog` on the `ph` facade).
- Proposal: DROP the facade layer (single install location in the new kit; no skill mirrors).
- Source: kit:SK/scripts/workflow_engine.mjs:1-5; kit:SK/scripts/runtime_regression.test.mjs:362-368
- Why it exists: shared code between a skill and its `.claude/skills` mirror.
- Test idea: import the engine from its single path in tests.

### WFL-49 Engine testability via injected runner
- Behavior: `runWorkflow` takes `runner(spec) -> {status:'ok'|'null', result, reason, agentId, model, tokens, durationS}` and `out`, `extraSpent`, `resolveChild`, `cache`, `journalPath` as parameters; spec = `{n, runId, workflowName, label, phase, prompt, opts}`; no Paseo import. Returns `{result, meta, stats:{started, ok, null, cached, tokens}}`.
- Proposal: KEEP (core design to carry over).
- Source: kit:RT/workflow_engine.mjs:1-6, 188-206, 303-305
- Why it exists: offline tests with fake runners (kit:SK/scripts/runtime_regression.test.mjs:352-360).
- Test idea: engine unit tests run with a fake runner and no network.

### WFL-50 Very large files must not be given to agents
- Behavior: an agent's read tool on a very large file (recorded: a 15 MB JSON) closed the MCP server, and every later read of that agent failed with "Connection closed". Authoring rule: give agents per-item extracts (one brief per family, module or screen), never a whole corpus file; prompts carry paths and short summaries.
- Proposal: KEEP as an authoring rule and an invariant; the new kit's read limits (files area) should make the failure impossible rather than only documented.
- Source: kit:REF/paseo-runtime.md:276-278
- Why it exists: recorded failure on this machine (kit:REF/paseo-runtime.md:269-278).
- Test idea: a read of a file over the size limit returns a size/line-count notice instead of closing the tool server.

### WFL-51 Read-only roles and `tools:` are advisory, not a sandbox
- Behavior: a definition's `tools:` list and `readOnly` / `--read-only` grant no tools and create no sandbox; real availability and permissions come from the provider and host owner settings. Read-only means "change no files": the agent may run non-mutating lint/tests/verifiers; checks that write artifacts need an editing role scoped to those files. Where reviewer writes would do harm, freeze the inputs (`ph freeze`) and check afterwards.
- Proposal: KEEP the rule in the new docs; the read-only note text itself is a prompt (WFL-22).
- Source: kit:REF/paseo-runtime.md:382-386; kit:REF/workflow-recipes.md:204
- Why it exists: not stated beyond the limit itself; prompt-level enforcement only.
- Test idea: a read-only agent prompt contains the note; a documented post-run `freeze --check` detects a changed input.

### WFL-52 Small engine and run-file contracts
- Behavior: (a) `workflowSource` strips one leading BOM from the script. (b) The script `console` has only `log`, `info`, `warn`, `error`; any other method throws. (c) `n` is allocated before the budget and cap checks, so a throw there skips that number in later `agent done #n` lines and writes no journal line. (d) A successful run that never calls `agent()` never creates `journal.jsonl`, so `--resume` of it fails with `cannot resume`. (e) A watchdog stop archives the agent from the tick, and `workflowRunner`'s `finally` archives it again unless `keep` (errors swallowed or logged). (f) `AskUserQuestion` denies are counted once per permission status (all asks of that status together), at most 3 statuses; any other pending permission throws at once. (g) `NON_RETRYABLE` is case-insensitive and matched on `st.error` only; one continue per turn.
- Proposal: KEEP (a)(b)(f)(g); CHANGE (d) create an empty journal at run start; (c) keep numbering gap-free by allocating `n` only for calls that start.
- Source: kit:RT/commands.mjs:622, 732-733, 718-723; kit:RT/workflow_engine.mjs:151-152, 262-278; kit:RT/watchdog.mjs:136-142; kit:RT/daemon.mjs:14-15, 146-157
- Why it exists: not stated.
- Test idea: `--resume` of a run with zero agents works; a script using `console.table` fails clearly.

### WFL-53 Usage tracking: dedup and late-drop
- Behavior: `UsageTracker` sums `inputTokens`, `cachedInputTokens`, `outputTokens` per `turn_completed` event with usage and keeps the last numeric `totalCostUsd`; a repeated `turnId` (or `seq` when no turnId) for an agent is ignored. `settleTurn` polls up to 2 s for the turn count to rise; if it has not and `lastUsage` exists it adds `lastUsage` and increments `late`, and the next `turn_completed` with usage for that agent is then discarded (to avoid double counting). Budget and journal tokens use `output` only. A turn with no `turn_completed` usage and no applied `lastUsage` is simply uncounted (the code does not look for "interrupted"). If `track()` fails right after `createAgent`, the new agent is archived and the call throws `agent <id8> created but its usage tracking failed (archived)`, which `workflowRunner` turns into `null`.
- Proposal: KEEP; CHANGE: read usage from one source (stream or final) in the new runner.
- Source: kit:RT/daemon.mjs:51-79, 129-130; kit:RT/commands.mjs:710-716
- Why it exists: the daemon keeps only the last turn's usage (kit:REF/paseo-runtime.md:402-407).
- Test idea: replay a duplicated `turn_completed` event and a late-settled turn: totals count each turn once.

## Invariants and lessons

- An `agent()` failure is a value (`null` + journal reason), never a rejection; configuration errors throw. Scripts must guard `null` (kit:RT/workflow_engine.mjs:287, 300; kit:REF/workflow-recipes.md:215).
- The watchdog clock of a tool call starts when the call's input is complete; generation time is model time. Violating this killed 3 of 4 drafters in wf_20261015-011128_ecea (kit:CHANGELOG.md:5; wildera:_workspace/_runs/wf_20261015-011128_ecea/log.txt:8-12).
- A late `running` event for a finished call must not reopen the call (2 false stops, 2026-10-14) (kit:RT/watchdog.mjs:70-72).
- After a stuck-tool interrupt the runner must wait for the watchdog's retry message and the retry turn, not return `finished without a reply` (kit:CHANGELOG.md:5; kit:RT/commands.mjs:695-701).
- Queued calls recheck budget and agent cap after the semaphore is acquired; tokens are charged before the slot is released (kit:RT/workflow_engine.mjs:282-291).
- Every outbound message (role, task, schema/retry wrapper, watchdog) is size-checked before it reaches the daemon; a 42 MB prompt dropped the runner socket (kit:RT/prompts.mjs:60-64).
- Resume correctness depends on determinism: no `Date.now/Math.random`, content-hash keys, occurrence index per key (kit:RT/workflow_engine.mjs:97-101, 135-148).
- Watchers must end by themselves: on terminal log line, on non-running status, on a dead runner pid (3 checks), on a missing run dir (60 s) (kit:SK/scripts/watch_run.mjs:3-14).
- A re-armed watcher must not replay the whole log (owner 2026-10-14) (kit:SK/scripts/watch_run.mjs:8-9).
- Do not retry a failed turn when the cause is quota/auth/credit/permission (kit:RT/daemon.mjs:15, 146).
- The warm-up fallback timer must be cleared when the gate opens, else the process lingers up to 90 s after "workflow done" (kit:RT/commands.mjs:665-668).
- Runner does not reconnect: after transport loss all later `agent()` calls return `null` at once (no orphan agents) (kit:RT/commands.mjs:632-635).
- Stats must match transcripts by the exact `Run <runId> #<n>` tag; time windows mix overlapping runs (kit:SK/scripts/run_stats.mjs:40-42).
- Watchdog read/repeat counts reset on a write ("check -> fix -> check is progress") (kit:REF/paseo-runtime.md:300-301).
- Max active agents is bounded by RAM (~350 MB per Claude agent process; 30 agents exhausted 32 GB) (kit:REF/paseo-runtime.md:269-273).
- Read the journal, not the final result, before diagnosing an empty/odd run (kit:REF/paseo-runtime.md:319).
- Never hand an agent a very large file or corpus: a 15 MB JSON closed the agent's MCP server and every later read of that agent failed with "Connection closed"; give per-item extracts (WFL-50) (kit:REF/paseo-runtime.md:276-278).

## Interfaces

CLI (`ph` = node .agents/skills/harness/scripts/paseo_harness.mjs):
- `ph workflow [--script F | --name N] [--args JSON | --args-file F] [--resume RUNID] [--budget N|Nk|N.Nm] [--runs-dir D] [--detach] [--run-id ID]`, exit 0/1/2 (kit:RT/commands.mjs:726-806).
- `ph watch-run RUNID... [--all] [--from-start]` = `watch_run.mjs` (kit:SK/scripts/watch_run.mjs:6).
- `ph run-stats RUNID...` = `run_stats.mjs`; exit status passed through (kit:SK/scripts/runtime_regression.test.mjs:432-433).
- `ph archive --run RUNID`; `ph worktrees [--prune] [--runs-dir D]`.
- `ph workflow --resume RUNID` alone reruns that run's script and args.

Script API: `meta{name,description,phases?}`; globals `agent, pipeline, parallel, phase, log, console, args, budget{total,spent(),remaining()}, workflow`; agent opts `label phase schema agentType model effort isolation readOnly cwd keep`; limit 4096 items per call.

Files: `_workspace/_runs/<runId>/{script.js,args.json,run.json,journal.jsonl,log.txt,result.json}`; run.json keys `runId parent script status startedAt endedAt agents budget pid [name description error]`; status `running|done|failed|stopped`; journal keys `n key occ label phase agentId model status reason result tokens duration_s`; saved workflows `.agents/workflows/<name>.js|.mjs`.

Config keys (defaults in kit:project/.agents/harness.defaults.json): `max_subagents 20`; `max_agents_per_workflow 1000`; `wait_timeout_s 3600`; `schema_retries 2`; `prime_role "two-turn"`; `warmup true`; `warmup_s 8`; `warmup_timeout_s 90`; `max_prompt_bytes 262144`; `agent_nudge_s 900`; `agent_stop_s 1800`; `agent_tool_stuck_s 900`; `agent_file_tool_stuck_s 180`; `watchdog_repeat_calls 3`; `watchdog_same_file_reads 3`; `watchdog_reads_without_write 15`; `default_tier standard`; `mode bypassPermissions` (kit:project/.agents/harness.defaults.json:83-90, 108-117; kit:REF/paseo-runtime.md:96-111).

Env: `PASEO_AGENT_ID` (caller, required), `PASEO_HARNESS_LOG_IS_STDOUT` (detached child), `CLAUDE_CONFIG_DIR` (run_stats), `PASEO_HARNESS_ROLE/LEADER/ROOT` (set on worker agents).

Prompt-note config used by workflow agents (r1): `first_prompt_note` (owner text, one line appended to every first prompt) and `platform_notes` (`win32`: the PowerShell encoding warning) appended after it (kit:project/.agents/harness.defaults.json:91-95); `prime_role` is validated to `two-turn` or `off` only (kit:project/.agents/harness/config.mjs:74). Config validation (kit:project/.agents/harness/config.mjs:55-64): integer keys must be nonnegative safe integers (so `0` disables the watchdog limits and negatives fail config load); `max_subagents`, `max_agents_per_workflow`, `wait_timeout_s`, `max_prompt_bytes` must be >= 1; the engine additionally clamps the semaphore with `Math.max(1, maxConcurrent)` (kit:RT/workflow_engine.mjs:208).

Progress/log grammar: see WFL-20.

## Cross-area dependencies

- runtime: Paseo daemon client, `createAgent`/`sendPrompt`/`waitTurn`/`UsageTracker`, `loadConfig`, model tier resolution (`resolveModel`), prompt composition (`prompts.mjs`), `P.structured` (Paseo CLI Ajv loop). The new engine needs a runner interface over these.
- install: ships the engine, watchdog, scripts and `.agents/workflows/`; `.gitignore` entries for `_workspace/` and `.claude/worktrees/` (kit:CHANGELOG.md:13).
- hooks: the watchdog is not a Claude Code hook (it is a daemon stream listener in the runner); the io/context guard hooks are separate but share the "reminder after N lookup-only rounds" idea with `piecemeal`.
- files: the watchdog's tool classification and readiness table encode the file mod's tool names and input shapes (`read_ranges`, `edit_multiple_files`, `write_multiple_files` incl. `fixes`); changes to that tool set must update WFL-31/33.
- method: execution modes A/B/C, recipes, role/agent definitions (`.agents/agents/*.md` front matter `model`, `tools`, `include`), model-selection tiers, orchestrator templates, `ph freeze`.
- gsd-plan / gsd-upstream: execute-in-waves, plan review and verify stages are natural workflow scripts (review-gate pattern, WFL-46); state lives in `.planning/`, not in the run journal.
- gsd-debug: debug sessions may use workflows with `keep:true` agents; not verified in this scope.
- ui: `watch_run` output and `ph archive --run` are what an operator/Monitor sees.
- history: run dirs under `_workspace/_runs`; retention policy undecided.

## Concerns

1. Doc/code conflict on watchdog numbers and on the stuck-tool rule (WFL-36): kit:REF/paseo-runtime.md:294-301 vs kit:project/.agents/harness.defaults.json:109-114.
2. `watch_run.mjs` filters on `agent failed`, which no code emits; a failed agent shows only through `log watchdog` lines unless `--all` (kit:SK/scripts/watch_run.mjs:25 vs the emitted `agent done ... null`, kit:RT/workflow_engine.mjs:298). The paseo-runtime table repeats the claim (kit:REF/paseo-runtime.md:197).
3. A stuck-tool stop reports `watchdog stopped the agent after <agent_stop_s> s` regardless of cause (kit:RT/commands.mjs:693, 702), misleading when it was a second hung tool call.
4. `stuckInterrupted` is never reset, so a later unrelated hang in a long multi-prompt agent stops it at the first hang (kit:RT/watchdog.mjs:120, 127-137). Intended or not is unstated.
5. Shell write heuristic: `SHELL_WRITE` matches `>` in `=>` (arrow functions in `node -e`) and any `cp`/`mv`/`rm` word; such commands reset read/repeat counters and hide loops; a command that writes some other way is classed `other` (kit:RT/watchdog.mjs:17, 23).
6. `watchTimer` is module-global and never cleared; one process-wide `watchStates` map keyed by agent id (kit:RT/watchdog.mjs:19, 147-148).
7. `parseScript` finds `export const meta` anywhere, even inside a comment, though docs say "must begin with" (kit:RT/workflow_engine.mjs:52-53).
8. Script isolation: `vm` is no sandbox, busy loops hang the runner (no timeout on the body), un-awaited agents outlive "workflow done" (kit:REF/paseo-runtime.md:387-389; kit:RT/workflow_engine.mjs:249).
9. The journal records nothing for in-flight or thrown calls, so a killed runner leaves no trace of agents that were running (kit:RT/workflow_engine.mjs:295; sample run: wildera:_workspace/_runs/wf_20261015-011128_ecea/journal.jsonl:1-2 has 2 of 4 agents).
10. Cache key ignores role text and model mapping (WFL-14).
11. `occ` counts calls in invocation order; a script whose call order depends on timing can map a resumed call to the wrong earlier result with the same prompt (kit:RT/workflow_engine.mjs:260-262).
12. `phase` is one global; concurrent stages that call `phase()` mislabel agents; review-gate.js does exactly that inside `parallel` (wildera:.agents/workflows/review-gate.js:36, 42, 51).
13. review-gate.js defaults a missing verifier verdict to `confirmed` and a missing resolve result to unresolved; this is only documented in the code (wildera:.agents/workflows/review-gate.js:39, 54).
14. `run_stats.mjs` throws with a stack trace on a missing run.json/log.txt, exits 0 silently with no ids when a transcript folder exists (the regression test relies on the missing folder to get a non-zero exit), and rereads every transcript for every run id (kit:SK/scripts/run_stats.mjs:30-45; kit:SK/scripts/runtime_regression.test.mjs:432-433).
15. `run_stats` parses log text with regexes instead of the journal/run.json; its token regex takes the first `tokens N)` match (kit:SK/scripts/run_stats.mjs:34-35).
16. `warmGates` is process-global and never deleted (keyed by runId, so harmless per run) (kit:RT/commands.mjs:630).
17. Priming/warm-up savings are unmeasured on the current proxy per the doc itself (kit:REF/paseo-runtime.md:138-140).
18. CHANGELOG 0.1.0 says `main_provider_disallowed_tools` holds `Agent`, `Workflow` while the regression test expects `Agent`, `Workflow`, `SendMessage` (kit:CHANGELOG.md:15 vs kit:SK/scripts/runtime_regression.test.mjs:171; the shipped defaults list `Agent`, `Workflow`, `SendMessage`, kit:project/.agents/harness.defaults.json:59-63, whose note explains the SendMessage ban, line 58). Outside this area, but it governs whether the main session may run native workflows.
19. `workflowSource` also searches `.claude/workflows` and tries `.js` then `.mjs`; docs only mention `.agents/workflows/N.js` (kit:RT/commands.mjs:616; kit:REF/paseo-runtime.md:196).
20. execution-modes.md section 5 is a v1->v2 migration guide full of upstream artifacts (TeamCreate etc.) the new kit does not need (kit:REF/execution-modes.md:144-189). r1 note: a grep of execution-modes.md finds no Codex/OpenCode/Pi/MCP rows in section 5-2 (it only maps Claude Code in-session primitives to `ph`), so the non-Claude drop applies to workflow-recipes.md:204 only.
21. (r1 corrected) With `--detach` the parent writes only `script.js` (and creates the run dir and `log.txt`), then spawns; the child writes `script.js` again, then `args.json` and `run.json` and emits `workflow start`. The parent never writes `args.json` or `run.json`, which is the window behind the watcher hang in WFL-41 (kit:RT/commands.mjs:756-780).
22. paseo-runtime.md line 186 has a corrupted table row for `ph send` (two overlapping descriptions) (kit:REF/paseo-runtime.md:186).
23. `review-gate-sim/sim.mjs` and the other `_workspace/review-gate*` simulations in WildEra were not read; their relation to review-gate.js is unknown (wildera:_workspace listing).

## Open questions for the owner

1. Priming (`prime_role: two-turn`) and warm-up gate: keep, default off until measured, or drop? Options: (a) keep as shipped; (b) default `off`, measure cost/cache/latency with a fixed benchmark, then decide; (c) drop. Recommend (b): the doc says the savings are not guaranteed, and priming adds a model turn plus a gate map and two prompts per agent.
2. Concurrency default: fixed `max_subagents 20`, or derived from free RAM? Recommend the fixed documented default plus a RAM warning in doctor (the cap exists for a 32 GB incident).
3. Budget metric: output tokens only (as now) or also input/cached/cost from `turn_completed`? Recommend keep output tokens for upstream parity, report input and cost in run stats.
4. Worktree isolation (`isolation:'worktree'`, `ph worktrees`): keep, or leave to GSD wave execution / Paseo's own worktrees? Recommend keep a minimal option only if GSD execute waves need it, otherwise drop.
5. Watchdog scope: also watch persistent teammates (`spawn`/`fanout`)? Recommend no automatic stop for teammates; at most the stuck-tool interrupt without archive.
6. Second stuck-tool hang: archive (as now) or leave the agent to the orchestrator with a log line? Recommend keep archive for workflow agents (they return `null`, the run can be resumed) but report the real reason.
7. Resume staleness: hash the role text and resolved model into the cache key (WFL-14)? This means editing an agent definition invalidates cached calls. Recommend yes.
8. Schema validation: depend on the Paseo CLI `P.structured` loop, or ship an own validator inside the kit runner? Recommend an own small validator plus retry loop, so the kit does not depend on Paseo CLI internals.
9. Stats: keep `run_stats` transcript-based tool counts (Claude Code only) or reduce to journal-based wall/tokens/agent seconds? Recommend journal-based core plus optional transcript counts.
10. Is the "user must ask first" rule for workflows kept, and does an invoked GSD command (for example execute-phase) count as that request? Recommend: a GSD command that names `ph workflow` counts; otherwise the rule stays.
11. Run directory retention (185 dirs in WildEra): add `ph runs --prune` or leave manual? Recommend a prune command that keeps failed/recent runs.

## Revision log r1

All 22 findings checked against the cited lines (re-read worktrees.mjs, commands.mjs 840-894, daemon.mjs 86-135, config.mjs 50-80, harness.defaults.json 55-66, p1-entry-gate1-resolve.json). One finding is accepted only in part (R1-WFL-20). New behaviors: WFL-50, WFL-51, WFL-52, WFL-53.

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
| --- | --- | --- |
| R1-WFL-01 | accepted | New WFL-50 (15 MB read incident, authoring rule) plus an Invariants bullet. |
| R1-WFL-02 | accepted | New WFL-51 (advisory tools/read-only, freeze); the recipes MCP-adapter sentence is DROPped in WFL-45. |
| R1-WFL-03 | accepted | WFL-34 states write-clears-before-count order, signals not cleared, empty key not counted (kit:RT/watchdog.mjs:86-95). |
| R1-WFL-04 | accepted | WFL-31 inputAt rule rewritten (kit:RT/watchdog.mjs:75-78). |
| R1-WFL-05 | accepted | WFL-22: exact `definitionReadOnly` predicate, strict `opts.readOnly === true`, includes pasted under `===== path =====` headers (kit:RT/prompts.mjs:25-27, 46-49). |
| R1-WFL-06 | accepted | WFL-43: hard-coded runs dir, default-signal kill, status rewritten even if kill throws, `archived 0 of 0` (kit:RT/commands.mjs:469-474). |
| R1-WFL-07 | accepted | WFL-29: in-use rule, unknown owner, prunable, daemon note, removal and `branch -d` outcome, exit 2 (kit:RT/worktrees.mjs:42-71; kit:RT/commands.mjs:829-857). |
| R1-WFL-08 | accepted | WFL-18: exit-code split; run.json written and `workflow start` logged before `paseo()`/`requireCaller()`; failed run writes no result.json (kit:RT/commands.mjs:774-805, 883-887). |
| R1-WFL-09 | accepted | WFL-47 sample rewritten: start order #2,#4,#1,#3, three interrupts, only two done lines/journal rows (wildera log.txt:3-12). |
| R1-WFL-10 | accepted | New WFL-53 (dedup, `late` drop, 2 s settle, track-failure archive); WFL-09 points to it. |
| R1-WFL-11 | accepted | WFL-41 additions: directory-absent-only 60 s rule, hang when run.json never appears, deadChecks not reset, exit 0 for every end; Concern 21 ties the detach window to it. |
| R1-WFL-12 | accepted | WFL-04 now cites daemon.mjs:121 (clamp) and 123 (title); WFL-28 cites 122-127 (env 126, labels 127). Verified in daemon.mjs:121-127. |
| R1-WFL-13 | accepted | WFL-07 states `.title` membership, `detail` unvalidated, bare-string array always warns (kit:RT/workflow_engine.mjs:219-228). |
| R1-WFL-14 | accepted | WFL-03 and WFL-29: runner-side failures become `null` reasons, not throws. |
| R1-WFL-15 | accepted | Concern 21 corrected: parent writes only script.js. |
| R1-WFL-16 | accepted | WFL-46 gains FORMAT-vs-`gated()` theoretical clash, confidence 0, effort defaults, empty-open resolve, null verifier confirms all; Coverage lists the resolve sample. |
| R1-WFL-17 | accepted | WFL-42 gaps added (cached/`?s` lines, bookkeeping regex, 4000-char timestamp, median index, stale header comment). |
| R1-WFL-18 | accepted | New WFL-52 (BOM, console methods, n gaps, no journal without agents, double archive, deny counting). |
| R1-WFL-19 | accepted | WFL-36 gains the "input stops growing" sentence, the null-reason text difference and the stale `_notes` string vs `_watchdog_note`/`_tool_stuck_note`. |
| R1-WFL-20 | accepted in part | Recipes line 204 sentence is DROPped (WFL-45). Rejected for execution-modes.md 5-2: grep of that file finds no Codex/OpenCode/Pi/MCP text (kit:REF/execution-modes.md:170-183 maps only Claude Code in-session primitives), so there is nothing to drop; noted in Concern 20. |
| R1-WFL-21 | accepted | Interfaces list `first_prompt_note`, `platform_notes`, `prime_role` validation; Coverage counts refreshed (187 dirs, newest wf_20261020-144638_0d9c, `wc -l` vs read-tool line-count note) and the resolve args sample added. |
| R1-WFL-22 | accepted | WFL-52(f)(g) for permission/regex edges; Interfaces list config validation (nonnegative integers, >= 1 keys, engine `Math.max(1, ...)`) (kit:project/.agents/harness/config.mjs:55-64). |
