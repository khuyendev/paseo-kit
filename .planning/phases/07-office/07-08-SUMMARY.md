---
phase: 07-office
plan: 08
subsystem: ui
tags: [react-native, animated, sheet-window, walk, journey, wander, hangout]
requires:
  - phase: 07-office
    provides: layout, path, art-types, fakeHost (07-01 to 07-03)
provides:
  - CharacterSprite and useClock (shared clocks), life/* pure modules, tests/ui/office-life.test.mjs
affects: [07-11]
actuals:
  tokens: 30000
  tasks: 3
  commits: 0
  note: orchestrator commits; no commit made by this executor
plan_head_before: 7d8355b63568cf4096a6a0b54cf7b315339b9309
plan_head_after: 7d8355b63568cf4096a6a0b54cf7b315339b9309
requirements-completed: [OFFC-09, OFFC-12, OFFC-13]
duration: n/a
completed: 2026-10-21
status: complete
---

# Phase 7 Plan 08: Character motion and life Summary

**Clipped sheet-window CharacterSprite on four shared clocks, timed walk plans and journeys, and pure wander and hangout rules ported from habblaud @ faa1a012b5fbf632c66dc6801c5383e53a542406.**

## Verification status
Per the kit overlay no build or test suite was run; all `<verify>` obligations (office-life tests, tsc, plugin-gates, office-layout, spike gate) await the post-wave gate. `plugins/office/node_modules` is absent in this worktree. Only throwaway smoke scripts exercised the pure modules (ramps, window, origin, walk, handoff, elevator schedule, wander over 300 seeds, hangouts): outputs matched the plan's pinned numbers. Component tests (Tests 10, 14-19) were not run.

## Readings (Task 1)
- POSE_DURATION pinned in frames.ts and the test (fidelity: SAME).
- WALK_SPEED/RUN_SPEED are world px per second; step time = round(TILE*1000/speed) = 313 ms walk, 167 ms run. Foot pixel = tile*TILE + FOOT_DX/FOOT_DY (matches 07-02).
- Elevator: HOLD 650 and STAGGER 520 literal (SAME); door derived 4/9 s = 444 ms, plan constant 450 kept.
- HANDOFF_PAUSE_MS 1200 is a design constant (no upstream hand-in pause).

## Fidelity per table
POSE_DURATION, IDLE_WEIGHTS (kept subset), sit range 6000-20000, nearest-three, gathering KINDS min/max and BASE weights of kept kinds, stay literals of planOuting: no difference outside departures.

## Scoping
- Kept activities: coffee 18, water 12, lounge 12, window 7, shelf 6, arcade 5, snack 5, phone 6. Dropped: bathroom, mirror (restroom), stretch (at desk), pingpong and talk (handled as hangouts).
- Kept hangout kinds: pingpong (2-4, w9, lounge group "pingpong"), kitchen (2-4, w12, cafe talk group), talk (2-2, w8), rps (2-4, w8). Dropped: tv, videogame (seat sets without a spot group, TV screen state), arcade (ungrouped spots), mirror (restroom). pingpong watchers (watch group) not used, so effective max is the group size (2).
- Every OFFC-13 area has life: lobby (water, talk), kitchen (coffee, snack, window, kitchen), lounge (lounge, arcade, shelf, pingpong), hallway (water, talk, bench via phone).
- Stays are upstream durations clamped into WANDER_STAY bounds (water/snack up to 4000, lounge/phone down to 12000).
- Poses used and sheet group (SHEET_POSE_GROUPS): move = stand, walk, run, sit, drink; work = type, read, use, wait, raise_hand, sulk, sleep; social = talk, play, game, rps, laugh, cheer. Wander uses drink, sit, stand, read, use; hangouts use play, stand, talk, rps; journeys use walk, run, stand and caller-chosen wait poses.

## Deviations
- [Rule 2 / project rule] `ElevatorSchedule` and `SharedClock` are factory functions plus interfaces, not classes (OFFC-25 Hermes gate bans class syntax); acceptance strings `export class ...` therefore do not match literally. `ElevatorSchedule(n)` is callable and throws RangeError as the constructor would.
- Handoff return leg is the reversed outbound plan (not a second findPath), so it works from a blocked start tile and ends exactly on the start pixel.
- reserveHangout checks isFree per member then reserves each for its own id (reserveAll takes one owner), still all or nothing.
- Hangout ledger `reserveAll(spotIds, by)` single-owner as in Test 20.

## Known stubs
None.

## Cross-plan notes for 07-11
Consume CharacterSheet, SHEET_POSE_GROUPS, groupOfPose, handoffJourney/arrivalJourney/departureJourney/roundTripJourney, ElevatorSchedule, SpotLedger, indexSpots, reserveHangout/releaseHangout, optional `sheetZoom` and `frameOrigin(foot, zoom, sheetZoom)`. 07-11 adds the character-sheet sprite kind. After a vanish journey the sprite stays hidden until the next journey.

## Commits
n/a (orchestrator commits)

## Self-Check: PASSED (files exist; tests not run, see Verification status)
