# Changelog

Every change to shipped prompt text (the AGENTS.md block, skill texts, agent definitions and overlays, workflow lenses
and overlays, watchdog steering texts) lands with an entry here that names the owner's approval and date, the decision
and the measured check (HARN-15). `node kit/release-check.mjs [<range>]` checks this file against `kit.json`.

## [Unreleased]

- Owner-authorized live adapter fix, 2026-10-20 (LA-01/02, D-111): kit-authored generation overlay now requires
  stable target identities and a positive/negative protocol self-check before readiness. Added an explicit
  opt-in adapter check using existing hook/coverage contracts; lint stays structural and protected method text
  stays unchanged. Measured checks and live requalification instructions: `.planning/integration/close-live-findings.md`.
  Offline regressions do not close HARN-04 / CR-HAR-09; fresh real generated adapters still require live testing.

## [0.0.1] - 2026-10-20

First release of the from-scratch kit (owner decisions D-109, D-110, D-111, approved 2026-10-20; specification
`.planning/REQUIREMENTS.md`). Measured check: `npm test` green offline (fake daemon, fake clock, temp projects).

- Install and update into a project (`kit.mjs install|update|status|pull|help`): digest-tracked kit parts, the
  AGENTS.md block, the `.gitignore` block, `CLAUDE.md` import, kit hook registrations, optional harness-files mod
  activation (`--enable-plugin`).
- Machine setup (`kit.mjs machine check|apply|export`): additive Paseo provider patch with the worker deny list and
  the main-session deny list (`Agent`, `Workflow`), kit Paseo plugins, `kit-init` user skill links.
- One config loader (`.agents/harness/config.mjs`): kit defaults plus the project overlay
  `.agents/harness.config.json`, closed validation, `adapter` and `gsd` sections; tiers ship unconfigured.
- `ph` CLI: doctor, spawn, fanout, send, watch, result, team, context, compact-self, stop, archive, task, freeze,
  worktrees, workflow, watch-run, run-stats, runs, gsd, harness lint, config.
- Workflow engine (`ph workflow`): deterministic scripts, journal and resume, budgets, admission, model-time
  watchdog, worktree isolation, session agents; agent options `detail` and `timeoutS` and the `runId` global for the
  GSD scripts.
- Harness-files mod (`read_ranges`, `edit_multiple_files`, `write_multiple_files`) with a manifest-verified backend.
- Hooks: context guard, io guard, adapter-driven syntax check, long-command guard.
- GSD core: vendored upstream snapshot (open-gsd/gsd-core `next` @ 274f8ca), generated agents and method texts with
  kit overlays, the ported `ph gsd` verbs, GSD skills and workflow scripts (map, new project, discuss, research, plan,
  plan review, execute, verify, quick, progress, pause, undo, forensics, debug).
- Harness method skills carried unchanged except inventoried adapter regions: `harness`, `harness-evolve`,
  `ai-orchestrator` (HARN-17, D-111).
- Paseo plugins (not installed into projects): swarm map and planning panel.
- Owner-authorized review/fix pass, 2026-10-20 (the approved specification and final-integration task): closed
  cross-area cleanup, pagination, byte-hashing, doctor, adapter evidence and roadmap-coverage defects; completed
  batch-worktree accepted-dependency seeding. Regressions exercise actual runtime consumers with offline fakes.
- Area fixes harden install containment and retirement, machine secret scrubbing and link rollback, file-tool
  recovery and alias handling, hook concurrency, workflow sessions/deadlines, GSD resume/review/commit gates,
  and read-only panel loading/aggregation. GSD research routing adapter wording now offers explicit refresh for
  stale/blocked reports (GSDF-13); protected harness method and vendored GSD bodies remain unchanged (D-111).
- Evidence: full offline `npm test`, all four former TODO tests activated, source-provenance and vanilla scans,
  plugin type/host-bundle checks and release check; details and manual-only acceptance still owed are recorded
  in `.planning/integration/code-final.md`. No live generator acceptance is claimed.
