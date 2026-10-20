# code-ph report (M5 ph, PHCL)

## Files written
- `ship/.agents/harness/runtime/`
  - `commands.mjs`: the `commands` array registered by `ph.mjs` (doctor, spawn, fanout, send, watch, result, team, context, stop, archive, compact-self + hidden `compact-run`, task, freeze, worktrees). It re-exports `index.mjs` for now (TODO(integration), see requests).
  - `index.mjs`: the runtime API for other modules (below).
  - `models.mjs` (resolveModel, selectModel, roles), `agents.mjs` (definitions, front-matter subset, read-only), `prompts.mjs` (composePrompt, notes), `start.mjs` (prompt input, caps, names, caller-root check, startAgent, wait hint), `fanout.mjs`, `cmd-start.mjs` (spawn, fanout, collect), `cmd-agents.mjs` (send, watch, result, team, context, stop, archive), `result.mjs`, `pricing.mjs`, `compact.mjs`, `doctor.mjs`, `tasks.mjs`, `freeze.mjs`, `worktrees.mjs`, `cmd-worktrees.mjs`.
- `ship/.claude/skills/ph/SKILL.md`: the CLI contract for orchestrators and agents (rules, commands, models/roles/types, runtime notes, teams, compaction, workflow consent, authoring rules, trusted-code limits, log grammar, watchdog table, diagnosis).
- `tests/ph/`: `setup.mjs` (fixtures), `models-prompts`, `spawn-fanout`, `agents`, `compact`, `tasks-freeze`, `worktrees`, `doctor`, `lint` (`*.test.mjs`).

## Runtime API (`runtime/index.mjs`) for workflow / gsd
`loadAgentDef(root, type)` -> `{type, name, description, tools, model, body, includes:[{rel,text}], readOnly, roleHash}`; `isReadOnlyTools`, `listAgentTypes`; `selectModel({cfg, explicit:{model,effort}, role, definition})` and `resolveModel(cfg, spec, effort)` -> `{id, provider, model, thinking, features}`; `checkRole`, `validRoles`, `modelKey`; `composePrompt({cfg, root, task, def, kind: team|oneshot|workflow, name, leader, ws, readOnly, worktree:{path,branch}, workdir, runTag:{runId,n}, platform})` (size-checked); `firstPromptNote`, `roleParts`, `worktreeNote`, `workdirNote`, `NOTE_READ_ONLY`; `createWorktree(root, cfg, name)` -> `{top, path, branch, name}`, `discardWorktree(wt)`, `repoTop`; `loadPrices(root)`, `costUsd(prices, model, {input, cachedInput, output, maxContext})`, `priceKey`; `resultJson(session, agent)`; `checkCallerRoot(session)`; `runningCount(live)`.

## Requirement IDs implemented
PHCL-03 .. PHCL-33, PHCL-35, PHCL-36 (33). PHCL-01, PHCL-02 (entry, parsing) and PHCL-34 (platform) are code-foundation's; my tests also cover PHCL-01/02 from the command side (help lists the runtime commands, the watcher is hidden, option parsing through `send`/`team`/`spawn`). Also served from foundation requests: CONF-11 (unconfigured tier message and doctor problem), CONF-08 (doctor is `lenient`), PCLI-04 (doctor version note).

## v1 IDs not implemented / partial
- PHCL-06 MC-02 and PHCL-27 MC-03 are manual checks on the installed Paseo (not run: no daemon contact allowed).
- PHCL-27 acceptance "a scripted Edit of an input is refused": the fake daemon does not simulate tool denial; the test asserts the six denies in the create call and the collect file.
- PHCL-32 "in use when a non-archived agent labelled harness.name=<name> exists": only the caller's and the leader's agents are consulted until paseo-client offers a cross-orchestrator lookup (request filed).
- PHCL-04 provider policy lines duplicate the texts of `kit/machine/providers.mjs` `policyLines` (ship code cannot import kit/); switch to the shared lib once code-foundation hosts it (code-machine's request).

## Decisions taken
- `ph result --json` `costUsd` is computed only from tracked totals (`tokens` non-null); untracked agents get `null` rather than a last-turn guess. Price file shape `{models: {<key>: {...}}}` (as the reference project's file).
- `--rotate-pct` accepts a number above 0 and at most 100.
- The compact watcher is the hidden command `compact-run` (registry names allow no underscore). The lock holds the arming pid until the watcher pid is written; the watcher removes the lock on every exit when it holds its pid. A turn that ended without the token drop (status or `updatedAt` changed) stops polling early.
- A missing directory's registration is removed with `git worktree remove --force <path>` (targeted; git 2.55 verified); `git worktree prune` is never run. The `kept ...` line is printed when that fails.
- Doctor reports a missing harness-files mod as `problem`, an unknown Claude Code version as `note`; tier lines (incl. unconfigured-tier problems) are skipped when the daemon is down, per the acceptance.
- `fanout` sets `ph.swarm` to the fanout file's base name; `spawn` to `--name`.

## Requests filed
- code-ph -> code-workflow: import the runtime API from `runtime/index.mjs` (foundation ph-entry tests overwrite `runtime/commands.mjs` with a probe; 6 foundation tests fail until then). Also sent to code-workflow with `send`.
- code-ph -> code-foundation: `Session.findAgents(labels)` for PHCL-32.
- code-ph -> code-install: kit.json units `.agents/harness/runtime/index.mjs` and `.claude/skills/ph/SKILL.md` (INST-25 fails until added).

## Requests answered (from others)
- code-foundation (CONF-11, CONF-08, PCLI-04): done in `models.mjs` / `doctor.mjs`.
- code-workflow (archive `--run` with `adopted`; skill documents log grammar, watchdog numbers, authoring rules, consent, trusted-code statements): done; the watchdog table numbers are tested against the defaults in `tests/ph/lint.test.mjs`.
- code-hooks (compact-self accepts `--focus`): done.
- code-machine (doctor policy texts equal `kit machine check`, never require SendMessage on main): done.

## How to run the tests
`node --test "tests/ph/*.test.mjs"` from the kit root (64 tests, all pass; offline: fake daemon and clock, temp homes and projects; the compact test spawns a harmless detached `node -e` sleeper instead of the real watcher, which would contact a daemon).

## Known gaps
- Full suite at hand-off: the foundation ph-entry failures (runtime/commands.mjs probe vs workflow import) and INST-25 (kit.json units) depend on the requests above; CONF-02/CONF-12 lint failures are in files of code-files and code-hooks; FLOW-22 is code-workflow's.
- `ph send` polls with the session clock for up to 15 s when an agent never reports `running` (by design, PHCL-11).
