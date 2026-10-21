---
phase: 07-office
plan: 03
subsystem: office-spike
tags: [spike, sprites, png, animated, gate]
requires:
  - phase: 07-office
    provides: 07-01 sprite pipeline and fake host, 07-02 layout and findPath
provides:
  - sheetSize/sheetCell layout, zoom and tint selection rules, model types, MAX_DRAWN_CHARACTERS
  - spike-char and spike-room sprite kinds, spike HUD logic, spike view of the single registered screen
  - gate test that fails until the owner's recorded pass
affects: [07-04, 07-06, 07-08, 07-10, 07-11]
actuals:
  tokens: 60000
  tasks: 2
  commits: 0
plan_head_before: n/a (orchestrator commits)
plan_head_after: n/a (orchestrator commits)
key-files:
  created:
    - plugins/office/shared/tint.ts
    - plugins/office/shared/model-types.ts
    - plugins/office/client/limits.ts
    - plugins/office/client/spike-hud.ts
    - plugins/office/client/spike-screen.tsx
    - plugins/office/server/art/spike/palette.ts
    - plugins/office/server/art/spike/chars.ts
    - plugins/office/server/art/spike/rooms.ts
    - tests/ui/office-spike-gate.test.mjs
  modified:
    - plugins/office/shared/art-types.ts
    - plugins/office/shared/sprites-rpc.ts
    - plugins/office/server/sprite-registry.ts
    - plugins/office/index.client.tsx
    - .planning/phases/07-office/07-SPIKE.md
key-decisions:
  - "Sheet layout: one row per pose (POSE_NAMES order) times DIRS (down, up, left, right), one column per frame"
  - "Spike view is reached with params view=spike on the one registered screen; office without params still shows the tracer"
requirements-completed: []
duration: n/a
completed: 2026-10-21
status: halted
---

# Phase 7 Plan 03: Spike scene and gate Summary

**Tasks 1 and 2 are built and verified offline; Task 3 (owner measurement on the Paseo desktop app) is the blocking-human checkpoint and is not done, so no pass is recorded and the 7 record tests stay red by design.**

## Status

- Task 1 (contracts, spike renderers, gate test, smoothness rule): implemented.
- Task 2 (HUD logic, screen, OfficeEntry): implemented.
- Task 3: blocked at `checkpoint:human-verify` (gate blocking-human). `ZOOM_LEVELS`, `TINT_LEVELS`, SPIKE_MEASUREMENTS, SPIKE_VERDICT and SPIKE_UPDATE_LOG are not written.

## Verification observed (in this worktree, with a temporary node_modules junction, removed afterwards)

- `node --test --test-name-pattern="^OFFC-(09 (sheet|zoom)|17 tint|10 (limits|thresholds|spike))" tests/ui/office-spike-gate.test.mjs`: 15 pass, 0 fail.
- Full `tests/ui/office-spike-gate.test.mjs`: 15 pass, 7 fail; the 7 are the Test 8 record tests (record, verdict, scope, update log, surfaces, smoothness, levels), red until Task 3.
- `tsc --noEmit -p plugins/office`: exit 0.
- `tests/ui/office-png.test.mjs`, `tests/ui/office-layout.test.mjs`: pass; `plugin-gates.test.mjs`: the office gates pass; PANL-01 and PANL-02 fail only because planning-panel and swarm-map have no node_modules in this worktree (environment, not caused by this plan).
- 07-SPIKE-THRESHOLDS.json untouched; only `## SPIKE_SMOOTHNESS_RULE` (dated 2026-10-21T07:03:33Z) appended below the threshold sections.

## Deviations from Plan

None in code. Process notes:

- The worktree has no `plugins/office/node_modules`; a gitignored junction to the main checkout's install was used for the checks above and removed. The orchestrator gate needs the install (`npm ci --ignore-scripts` in plugins/office).
- `agents.list` is called with `{ subscribe: {} }` only (no extra filter), because the active-filter option shape could not be confirmed from the d.ts without guessing.
- The events surface counts `project.update` events delivered through `projects.subscribe` while `observeEvents(["project.update"])` is held, since `observeEvents` takes no handler.

## Requests

- `tests/ui/office-png.test.mjs` (owner 07-01): test `OFFC-10 thresholds: the markdown block equals the JSON file` asserts exactly one json fence in all of 07-SPIKE.md and no line starting `Verdict`. Task 3 appends a second json fence and `Verdict: pass`, which will break that test. It must read only the threshold section (text before the first appended heading).

## Known Stubs

None.

## Next

Owner runs the checkpoint of Task 3 (steps 1 to 7 of the plan), then a continuation records the sections and the two constants.

## Self-Check: PASSED (files exist, tests as listed above)
