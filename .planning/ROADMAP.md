# Roadmap: paseo-kit

## Overview

paseo-kit v1.0 is built bottom-up along the dependency direction of `.planning/intel/SYNTHESIS.md` (M3 <- M1, M2, M4..M10; M4 <- M5 <- M6 <- M10; M9 <- M10; M12 is data read by M8, M9, M10; M13 reads `.planning/` and Paseo only) in six coarse phases, each holding many plans executed in waves. Phase 1 lays the foundation and builds the tracer slice of `.planning/intel/PHASES-DRAFT.md` first (install -> `ph doctor` -> `ph workflow` -> `ph gsd roadmap get-phase`), before any module is built out; Phase 2 completes the runtime; Phase 3 completes install, machine setup, hooks and file tools; Phase 4 builds the GSD core and the project start (map-codebase, adapter generator, new-project); Phase 5 builds the GSD lifecycle through harness-evolve; Phase 6 adds the read-only Paseo panels. The kit stays vanilla throughout (D-110); harness and GSD skill text is carried unchanged, only the adapter layer changes (D-111). Milestone: **v1.0**.

> Owner 2026-10-20: 6 phases, coarse granularity.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation and tracer** - repo skeleton, test harness, config, minimal install, paseo-client, `ph spawn`/`watch`/`result`, the tracer slice end to end
- [ ] **Phase 2: Full runtime** - every `ph` command, the workflow engine, watchdog, worktrees, run tools
- [ ] **Phase 3: Agent tools and machine** - full install/update/status/pull, machine check/apply/export, hooks, file tools
- [ ] **Phase 4: GSD core and project start** - `.planning/` data layer and `ph gsd` verbs, upstream vendoring and generation, map-codebase, adapter generator, new-project
- [ ] **Phase 5: GSD lifecycle** - discuss, research, plan, execute, verify, forensics, plain debugger, harness-evolve
- [ ] **Phase 6: Paseo UI panels** - read-only `.planning` panel and trimmed swarm map

## Phase Details

### Phase 1: Foundation and tracer
**Goal**: The kit repository exists with its layout (`kit.json` shipped-unit list, `ship/`, `tests/`), one platform module and an offline test runner with fakes for the Claude CLI, the Paseo CLI/daemon client and `paseo reload` in temp homes with spaces (INV-57); the one config loader with closed validation, merge rules, provenance and the complete key table serves every consumer; a minimal install writes the manifest and the `@AGENTS.md` import; the single Paseo daemon adapter module is complete; `ph` provides doctor, config, spawn, watch and result with argument parsing, prompt assembly and model/role resolution. The tracer slice is built first inside this phase and is green before the rest of the phase is built out: `kit install` of a minimal set into a scratch project -> `ph doctor` -> `ph workflow --name hello` running one `agent()` on `circle/gpt-6-luna-fast[1m]` (INV-50) followed by `ph watch-run` -> `ph gsd roadmap get-phase 1` on a fixture ROADMAP.
**Depends on**: Nothing (first phase)
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06, CONF-07, CONF-08, CONF-10, CONF-11, CONF-12, CONF-13, CONF-14, FLOW-01, FLOW-17, FLOW-18, FLOW-19, FLOW-20, FLOW-40, FLOW-43, GSDC-02, GSDC-07, INST-03, INST-05, INST-16, INST-23, PCLI-01, PCLI-02, PCLI-03, PCLI-04, PCLI-05, PCLI-06, PCLI-07, PCLI-08, PCLI-09, PCLI-10, PCLI-11, PCLI-12, PCLI-13, PCLI-14, PCLI-15, PCLI-16, PHCL-01, PHCL-02, PHCL-03, PHCL-04, PHCL-05, PHCL-06, PHCL-07, PHCL-12, PHCL-13, PHCL-21, PHCL-22, PHCL-25, PHCL-26, PHCL-27, PHCL-28, PHCL-29, PHCL-33, PHCL-34
**Success Criteria** (what must be TRUE):
  1. One scripted run on Windows performs the four tracer steps in order and exits 0: install into a scratch project, `ph doctor` with `ok` lines for config, Paseo CLI, daemon and caller, `ph workflow --name hello` ending `workflow done <runId>` (model set through a fixture overlay tier or the run argument, since tiers ship unconfigured) and followed to the end by `ph watch-run`, and `ph gsd roadmap get-phase 1` printing JSON with `found: true` and exit 0 (an absent phase exits 66).
  2. The hello run directory holds `script.js`, `args.json`, `run.json` (`status: done`), `journal.jsonl` (one start and one finish record), `log.txt` and `result.json`; the engine runs the same script against a fake runner with no Paseo import.
  3. The offline runner passes with `HOME`/`USERPROFILE` in a temp folder with spaces and no network; a guard fails any test touching the real home; the kit self-check fails on a `kit.json` listing a test file or a missing file.
  4. The manifest holds exactly `_notes`, `version`, `installedAt`, `updatedAt`, `files` and no kit or project path; `CLAUDE.md` carries `@AGENTS.md` and a second install leaves its bytes unchanged.
  5. The closed schema's key list equals the specified table; an overlay with an unknown or machine key fails every consumer with `invalid harness config <key>: <msg>` while `ph doctor` still runs and reports it; `ph config` prints merged values with `_provenance`.
  6. Only `paseo-client/` imports `@getpaseo/cli`; against the fake daemon, a spawn without caller, from outside the project root or with an oversize prompt is refused before any daemon call, and a quota or auth error is never retried while transient errors are retried with growing pauses.
  7. `ph spawn`, `ph watch` and `ph result` print one line per item under the 0/1/2 exit contract; model and effort resolve from an explicit role with precedence run arg > role > agent `model:` > `default_tier`, and a model not allowed is refused.
  8. `versionAtLeast` returns true/false/null as specified and a fake `claude.cmd` in a folder with spaces runs through cmd.exe on Windows.
**Plans**: TBD

Note: the `gsd.roles` lookup PHCL-22 performs reads only config data validated by the Phase 1 loader; the ADPT-11 contract that fills those roles is written in Phase 4.

### Phase 2: Full runtime
**Goal**: Every remaining `ph` command works (fanout, send, team, context, compact-self, stop, archive, task, freeze, worktrees, cost, capacity caps, teammate note), and the deterministic workflow engine is complete: determinism guards, `agent/pipeline/parallel/phase/log/args/budget/workflow/shell`, sessions with fixed invariants and session worktrees, adopted session agents, the kit's schema validator subset, caller-wide admission, content-hash resume, detached runs, progress grammar, transport loss, worktree isolation, the watchdog on model time with input-complete tool clocks, `run-stats`, `runs --prune`, the authoring guide with the trusted-code limits and the consent rule.
**Depends on**: Phase 1
**Requirements**: FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06, FLOW-07, FLOW-08, FLOW-09, FLOW-10, FLOW-11, FLOW-12, FLOW-13, FLOW-14, FLOW-15, FLOW-16, FLOW-21, FLOW-22, FLOW-23, FLOW-24, FLOW-25, FLOW-26, FLOW-27, FLOW-28, FLOW-29, FLOW-30, FLOW-31, FLOW-32, FLOW-33, FLOW-34, FLOW-35, FLOW-36, FLOW-37, FLOW-38, FLOW-39, FLOW-41, FLOW-42, FLOW-44, FLOW-45, FLOW-46, FLOW-47, FLOW-48, FLOW-49, PHCL-08, PHCL-09, PHCL-10, PHCL-11, PHCL-14, PHCL-15, PHCL-16, PHCL-17, PHCL-18, PHCL-19, PHCL-20, PHCL-23, PHCL-24, PHCL-30, PHCL-31, PHCL-32, PHCL-35, PHCL-36
**Success Criteria** (what must be TRUE):
  1. Against the fake daemon, `ph fanout --collect`, `ph send`, `ph team`, `ph context`, `ph stop`, `ph archive`, `ph task` and `ph freeze` print one line per item under the 0/1/2 exit contract; the running-agent cap and the live-agent cap (new-agent allocations only) refuse the next spawn with a clear line.
  2. `ph compact-self` arms one watcher per agent (a second arm is refused by the lock) and reports success only when used tokens drop below half.
  3. Inside a script `Math.random()`, `Date.now()` and argument-less `Date()` throw with the guidance message; un-awaited `agent()` calls are awaited by the host and logged; nested `workflow()`, `pipeline()`, `parallel()` and `shell()` run against fake runners.
  4. `ph workflow --resume <runId>` reuses cached results only for calls whose prompt, role, model and effort hashes are unchanged; a resumed run records adopted session agents in `run.json.adopted` and `ph archive --run` archives them.
  5. `ph workflow --detach` prints `workflow started <runId>` and the detached child is followed by `ph watch-run` and `ph run-stats`, also for a non-default `--runs-dir`; `ph runs --prune` removes only `done`/`stopped` runs beyond `runs_keep`.
  6. The watchdog counts model time only, starts a tool clock when the input is complete, steers on loops, interrupts a stuck tool once and then stops it with the real reason.
  7. The kit validator accepts exactly its keyword subset (a schema with `oneOf` throws; every shipped workflow schema passes the scan); a session key changing a fixed property throws before any create; a session with worktree isolation keeps one worktree across calls and resume.
  8. `ph spawn --worktree` creates `<worktree_dir>/<name>` on branch `harness/<name>`, and `ph worktrees --prune` removes only the targeted registrations.
**Plans**: TBD

### Phase 3: Agent tools and machine
**Goal**: `kit install|update|status|pull` are complete (three-digest ownership, six-state classification, retired parts, marked AGENTS.md and `.gitignore` blocks, seeds created once, record policy, prospective ownership record, hook-registration reconcile, mod activation with `--enable-plugin`, older manifests refused, upgrade by fresh install); `kit machine check|apply|export` manage the owner's Paseo provider config additively with backup, atomic write and `paseo reload`, opt-in plugins and the `kit-init` user skill; the kit hooks (context guard, io guard, syntax-check shell, Windows long-command rescue) are registered from one template and never block; the harness-files mod ships its three batch tools over a permission-gated, at-most-once backend.
**Depends on**: Phase 1, Phase 2
**Requirements**: ADPT-06, CONF-09, FTOL-01, FTOL-02, FTOL-03, FTOL-04, FTOL-05, FTOL-06, FTOL-07, FTOL-08, FTOL-09, FTOL-10, FTOL-11, FTOL-12, FTOL-13, FTOL-14, FTOL-15, FTOL-16, FTOL-17, FTOL-18, FTOL-19, FTOL-20, FTOL-21, FTOL-22, FTOL-23, FTOL-24, FTOL-25, FTOL-26, FTOL-27, FTOL-28, FTOL-29, FTOL-30, FTOL-31, FTOL-32, FTOL-33, FTOL-34, FTOL-35, FTOL-36, FTOL-37, FTOL-38, FTOL-39, FTOL-40, HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, HOOK-06, HOOK-07, HOOK-08, HOOK-09, HOOK-10, HOOK-11, HOOK-12, HOOK-13, HOOK-14, HOOK-15, HOOK-16, HOOK-17, HOOK-18, HOOK-19, HOOK-20, HOOK-21, HOOK-22, HOOK-23, HOOK-24, HOOK-25, HOOK-26, HOOK-27, HOOK-28, HOOK-29, HOOK-30, HOOK-31, INST-01, INST-02, INST-04, INST-06, INST-07, INST-08, INST-09, INST-10, INST-11, INST-12, INST-13, INST-14, INST-15, INST-17, INST-18, INST-19, INST-20, INST-21, INST-22, INST-24, INST-25, INST-26, INST-28, INST-29, INST-30, INST-31, INST-32, INST-33, MACH-01, MACH-02, MACH-03, MACH-04, MACH-05, MACH-06, MACH-07, MACH-08, MACH-09, MACH-10, MACH-11, MACH-12, MACH-13, MACH-14, MACH-15, MACH-16, MACH-17, MACH-18, MACH-19
**Success Criteria** (what must be TRUE):
  1. Every bad-argument case of every `kit` verb exits 1 with a usage line and an unchanged project tree; local edits, kit changes and retirements produce the six states, and across `update` and `pull <part>` the records of kept parts stay unchanged.
  2. On a fixture 0.1.0 project every `kit` verb exits 1 with the `written by an older kit; move it aside` message; after the owner renames the manifest, `install` exits 2 listing the differing kit files and writes a current-format manifest; a run whose wiring step fails leaves the old manifest unchanged.
  3. An installed project runs `ph config`, `ph doctor`, a kit hook, the file backend and a `ph gsd` read verb with the kit folder renamed away, and no project file contains the kit path.
  4. `kit machine check` is read-only; `kit machine apply` adds missing providers, models and deny entries, never removes an owner model, backs up, writes atomically and calls the fake `paseo reload` once (no `restart`); an export -> render -> apply -> check round trip reports no difference and the export carries placeholders instead of secrets.
  5. `apply --link-user-skills` links `kit-init` into each provider config dir and records it in `~/.paseo-kit/user-links.json`, re-pointing only recorded links; Paseo plugins are registered only with `--enable-paseo-plugins`.
  6. After install into a project without settings, `.claude/settings.json` holds exactly one registration per template entry; every hook exits 0 on malformed input or a thrown error; the context guard emits one reminder per band naming `ph compact-self`; the syntax-check shell runs the adapter's checker for the edited file's tree and reports only newly broken files.
  7. A Claude Code session with the mod activated lists exactly the three `mcp__harness-files__*` tools; a resent edit is never doubled; a failed edit returns a fix ID that a one-ID retry applies; line edits refuse changed lines; oversized reads return the `fit` / `not read in this call` texts.
  8. `kit install` without `--enable-plugin` never claims activation; a file-tool call from a native subagent is refused with the unavailable message.
**Plans**: TBD

Note: CONF-09 (per-request config in the file-tool backend) moved here from the config work of Phase 1, to sit with the backend it configures. ADPT-06 (`adapter.syntax_checkers` contract) moved here from the adapter work of Phase 4, because M12 is data read by M8 and the syntax-check shell (HOOK-26..28) consumes it. INST-15 (registered kit hooks) sits with the hooks it registers.

### Phase 4: GSD core and project start
**Goal**: The `.planning/` formats, the YAML-subset parser and every `ph gsd` verb (state, roadmap, requirements, phase, plan structure, probes, coverage, owns, outline, waves, handoff, revisions, attempts, research and verification status, commit, revert selection, health, debug sessions) work under the JSON-last-line and 0/1/66/69 exit contract with the phase status ladder; the trimmed pinned upstream snapshot is vendored, inventoried, generated with the adapter overlay and checked (D-62); the adapter contract is complete; and the start of the owner's project flow works (D-109): GSD orchestration plumbing and agent roster, `gsd-map-codebase` with stamp and drift gate, the harness method carried unchanged (D-111) generating the project adapter with lints, trigger tests, always-loaded rules and `ai-orchestrator`, and `gsd-new-project` with the roadmapper draft contract.
**Depends on**: Phase 2, Phase 3
**Requirements**: ADPT-01, ADPT-02, ADPT-03, ADPT-04, ADPT-05, ADPT-07, ADPT-08, ADPT-09, ADPT-10, ADPT-11, ADPT-12, ADPT-13, ADPT-14, ADPT-15, ADPT-16, GSDC-01, GSDC-03, GSDC-04, GSDC-05, GSDC-06, GSDC-08, GSDC-09, GSDC-10, GSDC-11, GSDC-12, GSDC-13, GSDC-14, GSDC-15, GSDC-16, GSDC-17, GSDC-18, GSDC-19, GSDC-20, GSDC-21, GSDC-22, GSDC-23, GSDC-24, GSDC-25, GSDC-26, GSDC-27, GSDC-28, GSDC-29, GSDC-30, GSDC-31, GSDC-32, GSDC-33, GSDC-34, GSDC-35, GSDC-36, GSDC-37, GSDC-38, GSDC-39, GSDC-40, GSDC-41, GSDC-42, GSDC-43, GSDC-44, GSDC-45, GSDC-46, GSDC-47, GSDC-48, GSDC-49, GSDC-50, GSDC-53, GSDF-01, GSDF-02, GSDF-03, GSDF-04, GSDF-05, GSDF-06, GSDF-07, GSDF-08, GSDF-09, GSDF-95, HARN-01, HARN-02, HARN-03, HARN-04, HARN-05, HARN-06, HARN-07, HARN-08, HARN-09, HARN-10, HARN-11, HARN-14, HARN-15, HARN-16, HARN-17, HARN-18
**Success Criteria** (what must be TRUE):
  1. Every write verb run against a fixture project leaves only the adopted `.planning/` paths and never creates `.planning/config.json`; every verb's exit code and JSON shape match its fixture snapshot, and a verb not ported exits 69 with its reason.
  2. The frontmatter parser reads the PLAN, SUMMARY, VERIFICATION and CONTEXT conformance fixtures exactly and names the line of each malformed case; the status ladder truth table holds through find-phase, `roadmap analyze` and the router.
  3. `check coverage`, `check owns`, `outline check`, `waves` and `handoff` give the expected verdicts on passing and failing fixtures; an adapter hook script that times out makes its check `unresolvable` (exit 69), never a pass.
  4. `ph gsd upstream check` reports no drift, fails naming the file on a one-line alteration of any inventoried method text, and an installed GSD method file missing from `.agents/gsd/inventory.json` fails the test; the MIT notice and the departures list are present.
  5. `gsd-map-codebase` on a fixture codebase runs 4 mapper workers through `ph` and leaves the 7 docs in `.planning/codebase/` with a stamp; a drifted tree is flagged.
  6. On two fixture codebases of different stacks the harness generates adapters whose commands run, whose verify vocabulary resolves the fixture tests and which pass `ph harness lint`, including the mechanical checks of generated workflows and orchestrators; the shipped tree holds no project adapter, stack skill or project agent.
  7. A diff of shipped harness and GSD skill text against its sources shows only changes inside inventoried adapter regions with recorded replacements.
  8. `gsd-new-project` on a fixture produces PROJECT, REQUIREMENTS, ROADMAP and STATE that the `ph gsd` verbs parse; the roadmapper writes only `.planning/drafts/` and the planning files stay unchanged until the owner approves.
**Plans**: TBD

Note: GSDC-43 (debug session verbs) is built here with the other `ph gsd` verbs of the M9 data layer; the debug flow that uses it is in Phase 5.

### Phase 5: GSD lifecycle
**Goal**: The GSD lifecycle runs through `ph` workflows end to end: discuss (checkpointed, anti-pattern gate); research (view/reuse/refresh, readback); the plan workflow (outline, wiring stage when the adapter has an architect, skeleton review with freeze, per-plan planners, structure fixer, checker loop with probes, REVISION_CONFLICT, `forceProceed`, coverage and handoff, gap-closure mode, resume layers) with the optional full-plan review; execute in `per-wave` (default) and `batch` modes (D-63) with safe-resume, worktree transfer, post-wave gate with gate evidence, bounded code-review gate with review records, commits and branching; verify with fingerprint, routing and UAT; phase completion, progress/next, pause/resume, quick and undo; read-only forensics and the plain `gsd-debugger` (no supervised engine, D-78); and `harness-evolve` updating the adapter one change at a time with history rows.
**Depends on**: Phase 4
**Requirements**: ADPT-17, GSDF-10, GSDF-11, GSDF-12, GSDF-13, GSDF-14, GSDF-15, GSDF-16, GSDF-17, GSDF-18, GSDF-19, GSDF-20, GSDF-21, GSDF-22, GSDF-23, GSDF-24, GSDF-25, GSDF-26, GSDF-27, GSDF-28, GSDF-29, GSDF-30, GSDF-31, GSDF-32, GSDF-33, GSDF-34, GSDF-35, GSDF-36, GSDF-37, GSDF-38, GSDF-39, GSDF-40, GSDF-41, GSDF-42, GSDF-43, GSDF-44, GSDF-45, GSDF-46, GSDF-47, GSDF-48, GSDF-49, GSDF-50, GSDF-51, GSDF-52, GSDF-53, GSDF-54, GSDF-55, GSDF-56, GSDF-57, GSDF-58, GSDF-59, GSDF-60, GSDF-61, GSDF-62, GSDF-63, GSDF-64, GSDF-65, GSDF-66, GSDF-67, GSDF-92, GSDF-93, GSDF-94, HARN-12, HARN-13
**Success Criteria** (what must be TRUE):
  1. On a fixture project, discuss writes the phase CONTEXT, research writes and reads back the research file, and the plan workflow produces an outline, an `OUTLINE-REVIEW.md` freeze, PLAN files passing `verify plan-structure`, a passing coverage gate and a handoff, with the checker loop bounded by its cap.
  2. One REVISION_CONFLICT stops a planning run with `needs-owner` (D-74); gap-closure mode plans exactly one wave; a planning run killed mid-way resumes without re-asking finished planners; the plan-review stage runs only when enabled.
  3. Execute in `per-wave` mode runs each wave, the green gate and the review gate and reconciles summaries against disk; `batch` mode runs all waves code-only, then one build and full test, then one fixer; `parallelization.enabled: false` runs one executor at a time.
  4. Every gate run writes an evidence file; a `test: null` adapter is reported `not configured` and never green; a runner that exits 0 after executing 0 tests fails its obligation; evidence whose inputs differ from the tree is stale.
  5. With worktree isolation, executor outputs are transferred into the main tree in plan order with transfer records; an out-of-owns file is refused with the worktree kept and unrelated dirty files stay byte-identical.
  6. A high review finding blocks only with a trigger, confidence >= 80 and a non-theoretical likelihood, and blocking findings are confirmed or refuted by `finding-verifier`; `gsd-verify` writes `<NN>-VERIFICATION.md` with a fingerprint and `phase complete` advances the ladder only after verification passes.
  7. `progress`/`next` name the next command from disk state; `undo` reverts only the named phase's or plan's commits and refuses a partial revert of a shared wave commit; `gsd-forensics` starts no agent, build or test; `gsd-debug` runs one `gsd-debugger` per invocation within its budget and never counts a test run that executed nothing as a pass.
  8. `harness-evolve` on a fixture project applies one adapter change, appends one history row with Date, Change, Scope, Reason and Supersedes, stops for the owner on a conflict with an earlier row, and re-runs the affected trigger tests.
**Plans**: TBD

Note: ADPT-17 (gate-evidence contract) is placed here rather than with the rest of the adapter contract in Phase 4, because its producer (the post-wave gate, GSDF-44) and its consumers (GSDF-55, GSDF-67) are all in this phase.

### Phase 6: Paseo UI panels
**Goal**: Two read-only Paseo plugins ship: the `.planning` panel (picker, tree, markdown, phase/plan board by the GSD status ladder, plan detail, stats), then the trimmed swarm map grouped by the `ph.swarm` label (activity, file ledger ingested on every read, events, inspector, hubs linked to `.planning` wave progress through the `harness.run` label); they are enabled only by `kit machine apply --enable-paseo-plugins` (D-96).
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: PANL-01, PANL-02, PANL-03, PANL-04, PANL-05, PANL-06, PANL-07, PANL-08, PANL-09, PANL-10, PANL-11, PANL-12, PANL-13, PANL-14, PANL-15, PANL-16, PANL-17, PANL-18, PANL-19, PANL-20, PANL-21, PANL-22, PANL-23, PANL-24, PANL-25, PANL-26, PANL-27, PANL-28, PANL-29, PANL-30, PANL-31, PANL-32, PANL-33, PANL-34, PANL-35, PANL-36, PANL-37, PANL-38, PANL-39, PANL-40, PANL-41, PANL-42, PANL-43, PANL-44, PANL-45, PANL-46, PANL-47, PANL-48, PANL-49, PANL-50, PANL-51, PANL-52, PANL-53, PANL-54, PANL-55, PANL-56, PANL-57, PANL-60, PANL-61
**Success Criteria** (what must be TRUE):
  1. With plugins enabled on a fixture Paseo home, the `.planning` panel shows a fixture project's phases and plans in the status-ladder columns and renders their markdown; paths outside `.planning/` are refused and percentages are withheld when the scope is not complete.
  2. The swarm map groups fixture agents by `ph.swarm`, counts standalone agents without drawing them, and shows activity, file holds and events for the active-6h set.
  3. A group labelled `harness.run=<runId>` shows its wave progress from the run's `args.json` and the phase SUMMARYs; an unlinked group or a missing run directory shows none.
  4. An agent's first timeline read seeds file holds without emitting events, and a call first seen without paths and later with paths adds them exactly once.
  5. Neither plugin sends prompts, spawns, archives, writes files or runs a subprocess; a partial daemon failure is reported through typed failure envelopes.
  6. The unit tests of the pure modules pass offline, and the plugins are absent from Paseo unless `--enable-paseo-plugins` was passed.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6. Phase 6 depends on Phases 2, 3 and 4 only and may run alongside Phase 5.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and tracer | 0/TBD | Not started | - |
| 2. Full runtime | 0/TBD | Not started | - |
| 3. Agent tools and machine | 0/TBD | Not started | - |
| 4. GSD core and project start | 0/TBD | Not started | - |
| 5. GSD lifecycle | 0/TBD | Not started | - |
| 6. Paseo UI panels | 0/TBD | Not started | - |

## Coverage

v1 requirements: 453 (REQUIREMENTS.md after revision r1, scope `v1`); placed: 453, each in exactly one phase. Withdrawn items (INST-27, replaced by INST-31; PANL-59, replaced by PANL-61) and later-scope items (FTOL-41..43, HOOK-32, PANL-58, GSDC-51..52, GSDF-68..91 and the unnumbered later items) are not placed.

| Requirement prefix | Count | Phases |
|--------------------|-------|--------|
| INST | 32 | 1 (4), 3 (28) |
| MACH | 19 | 3 (19) |
| CONF | 14 | 1 (13), 3 (1) |
| PCLI | 16 | 1 (16) |
| PHCL | 36 | 1 (18), 2 (18) |
| FLOW | 49 | 1 (7), 2 (42) |
| FTOL | 40 | 3 (40) |
| HOOK | 31 | 3 (31) |
| GSDC | 51 | 1 (2), 4 (49) |
| GSDF | 71 | 4 (10), 5 (61) |
| HARN | 18 | 4 (16), 5 (2) |
| ADPT | 17 | 3 (1), 4 (15), 5 (1) |
| PANL | 59 | 6 (59) |
| **Total** | **453** | 6 phases (60, 60, 120, 90, 64, 59) |

### Unplaced v1 requirements

None.

---
*Roadmap created: 2026-10-20 from REQUIREMENTS.md, PHASES-DRAFT.md, SYNTHESIS.md and DECISIONS.md (D-109, D-110, D-111); updated for requirements revision r1; restructured into 6 phases per owner decision 2026-10-20*

