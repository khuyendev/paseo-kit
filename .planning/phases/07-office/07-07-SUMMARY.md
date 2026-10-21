---
phase: 07-office
plan: 07
subsystem: plugin-server
tags: [office, wave, rpc, frontmatter, containment]
requires:
  - phase: 07-office
    provides: 07-01 envelope style and createSpritesHandler; 07-03 spike gate (owner waiver)
provides:
  - office.wave defineRpc contract (workspaceId and runId only)
  - contained, bounded WaveLinker carried from swarm-map
  - never-throwing createWaveHandler resolving the directory through workspaces.ref
affects: [07-11, 07-12]
actuals:
  tokens: 14000
  tasks: 3
  commits: 0
plan_head_before: 7d8355b
plan_head_after: 7d8355b
tech-stack:
  added: []
  patterns: [id-only RPC input, typed error envelope, mtime file cache with oldest-first eviction]
key-files:
  created:
    - plugins/office/shared/wave-rpc.ts
    - plugins/office/server/frontmatter.ts
    - plugins/office/server/wave-link.ts
    - tests/ui/office-wave.test.mjs
    - tests/ui/office-server.test.mjs
  modified:
    - plugins/office/index.server.ts
key-decisions:
  - "A record without a directory gives ok with link null; no record and no directory gives not_found"
requirements-completed: [OFFC-03, OFFC-18]
duration: n/a
completed: 2026-10-21
status: complete
---

# Phase 07 Plan 07: office.wave Summary

**Id-only `office.wave` RPC backed by a contained, cache-bounded WaveLinker carried from swarm-map, served by a never-throwing handler that finds the workspace directory through the read-only `workspaces.ref`.**

## Accomplishments
- `shared/wave-rpc.ts`: `waveRpc`, `waveLinkSchema` (scope `complete|unreadable`), `WAVE_ERROR_CODES`, id limits, `RUN_LABEL`; no path field in any shape.
- `server/frontmatter.ts`: `cp` byte copy of the planning panel parser (`cmp` identical).
- `server/wave-link.ts`: swarm-map logic kept; added `WAVE_CACHE_MAX_ENTRIES` (256), `WAVE_PLANS_MAX` (64), bounded cache with `size` and `clear()`, `RangeError` on a bad `cacheMaxEntries`, BOM as `﻿`; handler validates ids by hand, never echoes input, never consults an agent cwd.
- `index.server.ts`: registers `office.sprites` and `office.wave`, no hook or timer, disposer clears the wave cache.
- Tests: 9 tests in `office-wave.test.mjs`; 10 in `office-server.test.mjs` (5 handler tests, 5 contract-suite tests).

## Task Commits
n/a (orchestrator commits). Nothing was staged or committed.

## Deviations from Plan
None - plan executed exactly as written.

## Verification status (awaiting the post-wave gate)
No `<verify>` was run, per the executor overlay (no build or tests by the executor), and `plugins/office/node_modules` is not installed in this worktree, so these obligations are open:
- `node --test tests/ui/office-spike-gate.test.mjs` (precondition; `07-SPIKE.md` records an owner waiver, not a measured pass: the orchestrator decides whether that satisfies the gate)
- `node --test tests/ui/office-wave.test.mjs tests/ui/office-server.test.mjs`
- `node plugins/planning-panel/node_modules/typescript/bin/tsc --noEmit -p plugins/office`
- `node --test tests/ui/plugin-gates.test.mjs`

## Deferred Issues
None.

## Known Stubs
None.

## Threat Flags
None.

## Self-Check
Files written and `cmp` of frontmatter.ts passed; tests not run.
