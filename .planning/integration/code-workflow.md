# code-workflow report (M6 workflow, FLOW)

## Files written
`ship/.agents/harness/workflow/`:
- `commands.mjs`: registry entries `workflow`, `watch-run`, `run-stats`, `runs`.
- `script.mjs`: `parseScript` (first-statement pure-literal meta, BOM, line-preserving body), script context prelude with the determinism guards, `runBody`.
- `schema.mjs`: the kit validator (`checkSchema`, `validate`, `parseReply`), closed keyword subset.
- `engine.mjs`: `runWorkflow` (agent/pipeline/parallel/phase/log/args/budget/workflow/shell, semaphore, budget and cap checks before and after queueing, cache, journal, session invariants, un-awaited calls). No Paseo import.
- `journal.mjs`: cache key, journal writer/reader, resume cache, run ids, `--budget` parsing, runs-dir helpers.
- `shell.mjs`: `shell()` string form (platform shell) and argv form (no shell), tree kill on timeout.
- `tools.mjs`: exact-name tool kinds, input readiness, input keys, read paths.
- `watchdog.mjs`: model-time watchdog (spans union, input-complete clock, late running guard, loop/reread/piecemeal, nudge/stop, stuck interrupt then stop, reset, best-effort messages, one ticker on the injected clock).
- `admission.mjs`: caller-wide running capacity and live cap (serialized count-then-reserve, 5 s recount or own completion, named null when no live slot can free).
- `runner.mjs`: Paseo host (identity, admission, adoption, live runner: prompt assembly, priming, warm-up gate, native/text schema, schema retries, watchdog retry wait, transport loss, archive rules, session agents, worktrees, per-call usage and cost).
- `runtime-bridge.mjs`: the single adapter onto code-ph's `runtime/index.mjs` exports (never `commands.mjs`, which the foundation tests replace with a probe) (loadAgentDef, checkRole, selectModel, composePrompt, roleParts and notes, createWorktree, discardWorktree, loadPrices/costUsd, checkCallerRoot) plus the FLOW-28 priming texts.
- `cmd-workflow.mjs`, `cmd-watch-run.mjs`, `cmd-run-stats.mjs`, `cmd-runs.mjs`.

`tests/workflow/`: `helpers.mjs`, `script`, `schema`, `engine`, `resume`, `command`, `runner`, `watchdog`, `run-tools`, `skill-doc` (`*.test.mjs`).

## Requirement IDs implemented
FLOW-01 .. FLOW-43, FLOW-46, FLOW-47, FLOW-48 in code. FLOW-22 (doc part), FLOW-38 (doc numbers), FLOW-44, FLOW-45, FLOW-49 are ph-skill text owned by code-ph; my `skill-doc.test.mjs` checks them against `ship/.claude/skills/ph/` and passes on the current skill.
Total: 49/49 v1 IDs have code or a passing check; 44 implemented in this module's code, 5 are documentation checked here.

## v1 IDs not implemented and why
- None missing. Partial: FLOW-48 "updates its `harness.run` label when the client supports label updates": the Session has no label update, so adoption is recorded only in `run.json.adopted` (which code-ph's `ph archive --run` already reads). Request filed to code-foundation.

## Requests filed
- code-workflow -> code-ph: ph skill documents the FLOW-22 grammar, FLOW-38 numbers, FLOW-44/45/49 (now satisfied; my tests pass against the current skill).
- code-workflow -> code-foundation: optional `Session.setLabels` for FLOW-48 label moves.
- Two earlier requests to code-ph (a `runtime/index.mjs` export set and `archive --run` reading `adopted`) were withdrawn: code-ph's `runtime/index.mjs` exports already cover them and `archive --run` reads `adopted`.

## Spec decisions taken
- Engine host contract: `identify({prompt, opts})` (synchronous; `{roleHash, model, effort, provider}` or `{error}`; throws configuration errors such as an invalid role), `admit(spec)` -> `{release, created, keep}` or `{reason}`, `adopt(entry, spec)`, `runner(spec)` with `spec.identity` and `spec.admission`.
- Identity failures (unknown type, missing include, model resolution) are journaled as a `null` call without a `start` record; a live-cap null likewise. `n` is allocated only when such a call or a started call is recorded, so numbers stay gap-free; throwing calls get none.
- Schema failure reason: `reply did not match the schema after <k> replies: #<reply> <path>: <err>; ...` (first 3 errors over all replies).
- Schema prompt text (session/primed agents) and retry wrapper are new kit text in `runner.mjs` (`schemaInstruction`, `schemaRetryPrompt`).
- `shell()` numbers its calls separately from agents (`shell start #<n>`).
- An adopted session agent the earlier run already archived starts fresh with the full prompt and a `log warning:` line (like PCLI-16's forgotten agent).
- `ph runs --prune` keeps the newest `runs_keep` among done/stopped runs (matches the FLOW-42 acceptance numbers).
- `run-stats --transcripts` attributes each assistant turn to the run of the last `Run <id> #<n>` tag seen in a user message; kinds `read, write, shell, other`.

## How to run the tests
`node --test "tests/workflow/*.test.mjs"` from the kit root (98 tests, offline: FDC, FCLOCK, temp projects with spaces; some FLOW-27/47 tests create temp git repos; FLOW-11 spawns short node processes).
The workflow tests call the workflow and runtime command definitions directly (`helpers.mjs` `runOwn`, same option parsing, config modes and exit mapping as `ph`), because at hand-off `ph` itself fails to load: `gsd/commands.mjs` imports a missing `gsd/verb-table.mjs` (code-gsd-core, in progress). That also fails the foundation PHCL-01/02 entry tests at the moment; not caused by this module.

## Known gaps
- The end-to-end `ph workflow` path through `ph.mjs` main is not exercised while the gsd module breaks the registry; re-run with `runPh` once it loads.
- No cross-process admission lock (LATER in the spec): two `ph` processes can race the caller-wide counts.
- `maxContext` per call is taken from the turn usage (`contextWindowUsedTokens`, else input + cached input); the field names of real Paseo usage are unverified (MC run).
- The detached-run test uses an injected spawn (a trivial child) rather than a real detached `ph workflow` child, to stay away from the real Paseo CLI.
