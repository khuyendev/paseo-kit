# Phases draft (build order for paseo-kit)

First cut for the roadmapper, not the roadmap. Module names M1..M13 and decisions D-NN refer to `SYNTHESIS.md` and `DECISIONS.md`. All escalated decisions are answered (2026-10-20); no phase is blocked. The kit is vanilla (D-110): no phase targets a particular project; moving an existing project onto the kit is that project's own task. Requirement areas (codes for REQUIREMENTS.md): TEST, CONF, INST, MACH, PASEO, PH, WFLO, HOOK, FILE, GSDC, ADPT (adapter + generator), PLAN, EXEC, VRFY, DBG, EVOL, UI.

Target project flow the phases build toward (owner D-109): kit-init -> map-codebase -> harness generates the adapter -> new-project -> GSD phases (discuss, research, plan, plan review, execute in waves, verify) -> harness-evolve.

## Tracer (build first)

The thinnest end-to-end slice through install, config, runtime, daemon, workflow and planning state:
1. `kit install <scratch project>` copies a minimal shipped set (defaults, config loader, `ph.mjs`, one workflow script, AGENTS block, `.planning/` seed), writes the manifest and the `@AGENTS.md` import (INST core of P1).
2. `ph doctor` in that project: config valid, Paseo CLI found, daemon reachable, caller known (P2 subset).
3. `ph workflow --name hello` runs one `agent()` on `circle/gpt-6-luna-fast[1m]` (INV-50) that writes one file, journals it and ends `workflow done`; `ph watch-run` follows it to the end (P3 subset).
4. `ph gsd roadmap get-phase 1` reads the seeded `.planning/ROADMAP.md` and returns JSON with exit 0 (P7 subset).
Acceptance: all four steps in one scripted run on Windows, plus `kit status` exit 0 and an offline test suite run with fakes.

## Phases

### P0 Repository skeleton and test harness
- Goal: kit repo layout (`kit.json` with the shipped-unit list, `ship/`, `tests/`), offline test runner, fakes for the Claude CLI, Paseo CLI/daemon client and `paseo reload`, temp homes with spaces in paths.
- Areas: TEST. Modules: all (infrastructure). Depends on: nothing.
- Invariants covered: INV-57.

### P1 Config and install core
- Goal: one config loader with closed validation and provenance; `kit install|update|status|pull` with three-digest ownership, marked blocks, `.gitignore` block, `CLAUDE.md` import, seeds, settings hook reconcile (from the template), exit 0/1/2 contract; runtime gates.
- Areas: CONF, INST. Modules: M3, M1 (without plugin activation). Depends on: P0.
- Decisions: D-01 (no migration code in v1), D-04, D-05, D-10, D-11, D-14, D-77 (sections `gsd` and `adapter` in `.agents/harness.config.json`).
- Tracer part: install minimal set, manifest, import.

### P2 Paseo client and `ph` agent commands
- Goal: the daemon adapter module (connect, create, send, wait with retries and permission denial, usage tracking, lookup) and the `ph` CLI: doctor, config, spawn, fanout, send, watch, result, team, context, stop, archive, task, freeze, worktrees; prompt assembly; tiers/roles/allowed models; capacity; compact-self with one watcher per agent.
- Areas: PASEO, PH. Modules: M4, M5. Depends on: P1.
- Decisions: D-16, D-17, D-18..D-21, D-23, D-26, D-37, D-38, D-100.

### P3 Workflow engine
- Goal: script engine (meta, guards, `agent/pipeline/parallel/phase/log/args/budget/workflow/shell`, sessions), runner with own schema validator, journal + resume with role/model hashing, run directory, detach, `watch-run`, `run-stats`, `runs --prune`, watchdog (model time, input-complete clock, steering, interrupt then stop).
- Areas: WFLO. Modules: M6. Depends on: P2.
- Decisions: D-22, D-24, D-25, D-27..D-35.

### P4 Machine setup
- Goal: `kit machine check|apply|export`, provider template, additive provider/model plan, worker deny list (incl. SendMessage) and main deny list (Agent, Workflow only; SendMessage allowed on main), env keys, secrets placeholders, backup + atomic write + reload, `kit-init` user skill linked with `--link-user-skills`, check notes for model ids the template no longer ships.
- Areas: MACH. Modules: M2. Depends on: P1 (parallel to P2/P3).
- Decisions: D-02, D-06, D-07, D-08, D-09, D-13, D-15.

### P5 Hooks
- Goal: context guard (role identity, bands, atomic state) wired to `ph compact-self`; io economy guard; syntax-check shell with adapter-supplied checkers; Windows long-command rescue; registration template and reconcile.
- Areas: HOOK. Modules: M8. Depends on: P1, P2 (compact-self).
- Decisions: D-45..D-51.

### P6 File tools
- Goal: the harness-files Claude Code mod and backend with the three batch tools and a simpler ticket protocol (at-most-once execution, receipt recovery), permission-gated execution, pagination, session state, line edits; mod activation in `kit install --enable-plugin`.
- Areas: FILE, INST (activation). Modules: M7, M1 (activation). Depends on: P1.
- Decisions: D-02, D-12, D-39, D-40..D-44.

### P7 GSD core data layer
- Goal: `.planning/` formats and seeds, YAML-subset parser, `ph gsd` verbs (state, roadmap, requirements, phase, plan structure, probes, coverage, outline, waves, handoff, revisions, attempts, research/verification status, commit, undo selection), verb table with not-ported reasons, phase status ladder, adapter hook interface; upstream vendoring, generation and `check`.
- Areas: GSDC. Modules: M9, M12 (interface). Depends on: P1. Vendoring per D-62 (trimmed pinned snapshot, generation, check, MIT notice); settings per D-77.
- Decisions: D-61, D-67, D-69..D-72, D-74, D-75.

### P8 Project start: map-codebase, adapter generator, new-project
- Goal: the start of the owner's project flow: `gsd-map-codebase` (4 mapper workers, stamp, drift gate), the `harness` adapter generator (reads the map, writes commands, verify vocabulary, review lenses, roles, syntax checkers, one stack skill, project agents only where needed; adapter linter; trigger tests for generated skills), `gsd-new-project` (questioning, PROJECT/REQUIREMENTS/ROADMAP/STATE, optional research, roadmapper, approval).
- Areas: ADPT, PLAN (new-project). Modules: M10 (map-codebase, new-project), M11, M12. Depends on: P3, P7.
- Decisions: D-109, D-16, D-45, D-54, D-57, D-59, D-63 (adapter inputs), D-77, D-110 (the kit ships no project's adapter).
- Acceptance: on two fixture codebases of different stacks, the generator produces adapters that pass the linter, and a fresh project reaches a valid ROADMAP.

### P9 GSD planning flows
- Goal: discuss (interactive, checkpointed), research (view/reuse/refresh, readback), plan workflow (outline, wiring stage when the adapter has an architect, skeleton review, per-plan planners, structure fixer, checker loop with probes, forceProceed, coverage, handoff, gaps mode), optional full-plan review stage.
- Areas: PLAN. Modules: M10. Depends on: P8.
- Decisions: D-65, D-66, D-68, D-70, D-71, D-73, D-74.

### P10 GSD execute and verify
- Goal: GSD execute path with `gsd-executor`, `gsd-code-reviewer` (adapter lenses, bounded gate rules, finding verification), `gsd-code-fixer`, post-wave build/test gate with adapter commands, modes `per-wave` and `batch`, `fixer_verifies_itself`, worktree or shared-tree execution, safe-resume and artifact reconciliation; `gsd-verifier` with fingerprint and readback; human_needed/UAT; gap closure (one wave); phase complete, progress/next, quick, undo, health.
- Areas: EXEC, VRFY. Modules: M10, M6, M9. Depends on: P9, P5 (syntax shell), P6 (file tools in worker prompts; can start on native tools if P6 is late).
- Decisions: D-26, D-56, D-58, D-63, D-64, D-89, D-91, D-94, D-95.

### P11 Forensics and debugging
- Goal: read-only `gsd-forensics`; `gsd-debug` with the plain `gsd-debugger` (upstream session file rules, signature reuse/reopen, root-cause rule, bounded budget, "a test that ran nothing is not a pass", knowledge base). No supervised debug engine (LATER, not part of the kit).
- Areas: DBG. Modules: M10. Depends on: P10.
- Decisions: D-78, D-82, D-83, D-84, D-87.

### P12 harness-evolve
- Goal: `harness-evolve` reading history, run records, review metrics and deferred findings; adapter updates one change at a time with history rows; trigger re-tests; kit-wide lessons sent back with `kit pull`.
- Areas: EVOL. Modules: M11, M1 (pull). Depends on: P10.
- Decisions: D-58, D-60, D-109.

### P13 UI
- Goal: read-only `.planning` panel (picker, tree, markdown, phase/plan board, plan detail, stats), then the trimmed swarm map (parent label, `ph.swarm` grouping, activity, file ledger, events); opt-in enabling via `machine apply`.
- Areas: UI. Modules: M13, M2 (enabling). Depends on: P7 (formats), P2 (labels). Can run in parallel with P9-P12.
- Decisions: D-96..D-104.

Note (no phase): a project on kit 0.1.0 upgrades by installing the new kit into it; conflicts are reported (exit 2). A generic `kit adopt` for 0.1.0 manifests is LATER and only if M1 needs it (D-01, D-110).

## Dependency summary

P0 -> P1 -> {P2 -> P3, P4, P5, P6, P7}; {P3, P7} -> P8 -> P9 -> P10 -> {P11, P12}; P13 after P7 and P2. The tracer cuts through P1, P2, P3 and P7 and should be green before any of them is built out.
