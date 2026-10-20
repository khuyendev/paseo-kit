# code-integrate report

## Result

- `npm test`: 736 tests, 734 pass, 0 fail, 2 skipped (POSIX-only file-tool tests on Windows: FTOL-09 broken symlink,
  FTOL-27 executable mode), 0 todo. Before integration: 715 tests, 4 failing, 1 todo.
- v1 requirements: 453. Every v1 ID except HARN-04 has at least one test named with it (checked by script over all
  `tests/**/*.test.mjs` titles). Unimplemented v1: 1 (HARN-04, below).

## Requests (`requests.md`, each line now carries a `status:` line)

42 requests: 39 done, 1 rejected (optional `syntaxCheckerFor` in the hooks), 1 partly rejected (full plan-phase /
execute-phase / debug method texts not generated; reason in the file), 1 decided by the integrator (ai-orchestrator
carried, D-111 overrides D-53). Done by the integrator (the module coders had left them open):
`Session.setLabels` and `Session.findAgents` (paseo-client; fake daemon gains `updateAgent`), shared
`lib/provider-policy.mjs`, `kit.mjs help`, `NODE_RUNTIME` gate table, units regeneration (454 units), mod asset gate
and `copied` check with `scripts/discover.mjs`, ai-orchestrator, CHANGELOG + `kit/release-check.mjs`, INTERFACES
section 6/7/8 updates, CONF-07 lint scope, `gsd upstream check` in `ph doctor`, workflow `runId` / `detail` /
`timeoutS`, the GSD verb fixes and new verbs, overlay includes, AGENTS.md rule 1, removal of every `TODO(integration)`.

## Fixes per module

- foundation: `platform.mjs` gate table (`NODE_RUNTIME`, `nodeRuntimeProblem`; `nodeRuntimeReady` removed);
  `paseo-client` `findAgents`, `setLabels`, `copied` needs all four mod assets; `lib/provider-policy.mjs`; `kit.mjs`
  help verb; CONF-07 lint excludes upstream GSD text (spec: D-111 forbids editing it); CONF-12 lint ignores the
  `TRUSTED_FIXED` integrity lists (FTOL-05 requires the defaults file in them; they hash, never load, it).
- install: mod asset gate lists `hooks/hooks.json`, `hooks/register.ts`, `scripts/discover.mjs`; Node gate through
  `nodeRuntimeProblem`; AGENTS.md block gets HOOK-24 rule 1 (`Use Grep for content and Glob for file names`).
- machine: `policyLines` re-exported from the shared lib; Node gate text from `nodeRuntimeProblem`; `USAGE` exported.
- ph (runtime): doctor uses the shared policy lib and runs `gsd upstream check`; `worktrees` asks the whole daemon
  (another orchestrator's live agent keeps its worktree); `commands.mjs` re-exports removed.
- workflow: agent options `detail` (`{result, reason, agentId, worktree, durationS}`) and `timeoutS` (whole-call
  deadline), script global `runId` (first run of a resume chain, `run.json.attemptRunId`); adopted session agents get
  their `harness.run` label moved (FLOW-48). FLOW-04 lists exactly twelve options; the two extra ones are a
  documented extension the GSD requirements need.
- files: BOM-safe reads (`private.mjs` uses `readJson`; `discover.mjs` a local BOM-aware `readText`, since it may
  load nothing unverified).
- hooks: BOM-safe state/stdin reads through `readTextFile`/`readJsonFile`; `syntax_check` takes `OVERLAY_REL` from
  the project's `config.mjs` instead of naming the file.
- gsd-core: `verify plan-structure <PLAN file>` (upstream form, also quick plans); handoff tasks carry the plan id in
  `plan` plus `planPath` (the execute script used `plan` as an id); `handoff --no-tracer-split`; fixed the handoff
  cleanup regex (`\d` inside a template literal matched `d`); new `roadmap install-draft`, `debug budget`; `debug
  checkpoint` sets/clears `pending_checkpoint`; `debug status` returns the frontmatter; `debug close
  --evidence-stdin`; frontmatter objects written as flow maps; inventory includes the flow overlays of
  gsd-debugger, gsd-phase-researcher, gsd-roadmapper (rebuilt with `ph gsd upstream build`).
- gsd-flows: skills point at `.agents/gsd/generated/...` (the named `.agents/gsd/workflows/` never existed);
  checker probes read the real `commands` items; verify resume uses `abandonedNow` (an empty `abandoned` array is
  truthy); research blocked result recorded as `{status: "blocked"}` (what `research status` reads); gate uses the
  adapter's `invokeHook` and `withMutex` (its own mutex used another lock file, so one `adapter.mutex` gave two
  locks); the fake world now returns the real `attempt`/`outline check` shapes; roster test compares the shipped
  agents.
- harness: ai-orchestrator carried (source copy, PROVENANCE file and region, NOTICE, HARN-17 test).

## End-to-end (tests/e2e/, offline)

- `tracer.test.mjs`: `kit.mjs install` into a temp git project, then the installed `ph` (not the kit's ship/):
  unconfigured-tier refusal (CONF-11), `ph doctor` all ok with a Paseo config and model catalogue (incl. `gsd
  upstream check`), `spawn`/`watch`/`result` round on the fake daemon, a workflow with `parallel` + `shell` + `runId`,
  `run-stats`, `kit status` exit 0; `ph gsd` verbs on a seeded `.planning/` (find-phase, roadmap analyze, state init,
  verify plan-structure, phase-plan-index, handoff, research status 66, unknown verb 69); D-109 flow: adapter written
  into the overlay, `ph config` shows it, `ph harness lint` exit 0, `gsd-research.js` run through the real engine with
  a fake researcher writing the contract report -> `researched`, rerun -> `reused` without a second agent; shared
  policy check; `kit.mjs help`.
- `release-check.test.mjs`: HARN-15 version/section checks and the prompt-commit rule on a temp git repo.
- Not covered offline: the live daemon, real Claude Code sessions, plan/execute/verify scripts through the real engine
  (they run through the gsd-flows fake host against the now-aligned verb shapes).

## Vanilla (D-110) and D-111 checks

- Grep of `ship/`, `kit/`, `plugins/`, `user/` for project/engine/game terms (WildEra, Unreal, UE4/5, uproject,
  uasset, Blueprint, Unity, Godot, game, webtoon, Next.js, novel, shader): no hit in kit-authored text. Hits only in
  carried text: upstream GSD agents (Next.js / games / shaders as generic examples) and the harness method's
  generic examples (webtoon, novel, Next.js), both carried unchanged by D-111. ADPT-16's deny-list test passes.
- Harness text: every fixture in `tests/harness/fixtures/method-source/` equals paseo-harness-kit `ref-final`
  (CRLF-normalised compare of all 15 files); HARN-01 diff test passes, every difference is an inventoried region
  listed in the skill NOTICE. The old `scripts/*.mjs` are replaced by `ph` (adapter layer).
- GSD text: all 246 snapshot files equal the upstream clone at 274f8ca; `ph gsd upstream check` reports 0 problems
  (1 warning: `context-bridge.md` absent upstream at the pin, recorded in UPSTREAM.json).

## Written by the integrator

README.md, CHANGELOG.md, NOTICE.md, kit/release-check.mjs, tests/e2e/{world,tracer.test,release-check.test}.mjs,
tests/workflow/gsd-options.test.mjs, tests/gsd-core/flow-verbs.test.mjs, ship/.agents/harness/lib/provider-policy.mjs,
ship/.claude/skills/ai-orchestrator/{SKILL,NOTICE}.md, tests/harness/fixtures/method-source/ai-orchestrator/SKILL.md;
edits listed above.

## Remaining gaps

- HARN-04 (v1, unimplemented): live smoke of the harness generating adapters for two fixture stacks with real
  agents; cannot run offline.
- Manual checks owed (implemented, offline parts tested): FTOL-01/04/10 (real Claude Code session with the mod),
  PHCL-06 MC-02 and PHCL-27 MC-03 (installed Paseo), HOOK-07/14/19 shapes on the installed Claude Code, HOOK-12 p95 on
  the owner's machine, HOOK-30 real heredoc, PANL-01/07/10/34/48/49 (live daemon, visual), INST-30 kit-init with a live
  agent, `claude plugin validate ship/.claude/plugins/harness-files`.
- FLOW-04's "exactly twelve options" now has two more (`detail`, `timeoutS`); spec text should be updated.
- gsd-core keeps its own vocabulary/ownership helpers beside `adapter/contract.mjs` (same semantics).
- `NODE_RUNTIME.minVersion` 20.17.0 is the declared floor; the release qualification run on that Node was not done
  (only Node 24 on this machine).
