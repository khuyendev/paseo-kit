---
phase: 07-office
plan: 02
subsystem: ui
tags: [office, layout, a-star, pathfinding, habblaud-port, pure-modules]

requires: []
provides:
  - "plugins/office/client/path: WalkGrid, BLOCKED/FREE/SEAT, MAX_GRID_CELLS, TilePoint, gridFromRows, gridOf, PathFinder, findPath"
  - "plugins/office/client/layout: constants, defs (46-kind FURNITURE geometry), types, rng, theme (roomThemeFor), geometry, builder, core, corridor, room, building (buildBuilding)"
  - "tests/ui/office-layout.test.mjs: path, layout, reachability, determinism (golden digest) and source-rule tests"
affects: [07-03, 07-05, 07-06, 07-08, 07-10, 07-11]

actuals:
  tokens: 24250
  tasks: 3
  commits: 0

key-files:
  created:
    - plugins/office/client/path/grid.ts
    - plugins/office/client/path/astar.ts
    - plugins/office/client/layout/constants.ts
    - plugins/office/client/layout/defs.ts
    - plugins/office/client/layout/types.ts
    - plugins/office/client/layout/rng.ts
    - plugins/office/client/layout/theme.ts
    - plugins/office/client/layout/geometry.ts
    - plugins/office/client/layout/builder.ts
    - plugins/office/client/layout/core.ts
    - plugins/office/client/layout/corridor.ts
    - plugins/office/client/layout/room.ts
    - plugins/office/client/layout/building.ts
    - tests/ui/office-layout.test.mjs
  modified: []

key-decisions:
  - "Upstream pin: marmottajr/habblaud @ faa1a012b5fbf632c66dc6801c5383e53a542406; all 13 fetched blobs matched the API blob sha"
  - "Room ids are opaque keys: area id = ROOM_ID_PREFIX + id, arrays/Set only, never an object keyed by id"
  - "buildBuilding validates the whole input (id string and unique, slot unique non-negative integer, seed finite) and the grid cap before building anything"

requirements-completed: [OFFC-10, OFFC-12]

duration: n/a
completed: 2026-10-21
status: complete
plan_head_before: n/a (orchestrator commits)
plan_head_after: n/a (orchestrator commits)
---

# Phase 7 Plan 02: Office layout and A* path finder Summary

**Pure habblaud office layout (core areas, corridor, 16x12 project rooms, 46-kind furniture geometry) and 4-direction A* walk grid ported to `client/layout` and `client/path`, with `buildBuilding(rooms)` and `findPath(grid, from, to)` as the frozen entry points.**

## Performance

- **Tasks:** 3 (all implemented)
- **Files created:** 14 (13 source modules, 1 test file of 576 lines)
- **Commits:** n/a (orchestrator commits)

## Accomplishments

- `findPath` answers the clear, blocked, out-of-bounds, disconnected and same-tile cases; one `PathFinder` per grid lives in a WeakMap, so interleaved grids never share search state.
- `WalkGrid` refuses sizes that are not positive integers or exceed `MAX_GRID_CELLS = 250000` (T-07-21).
- `buildBuilding` assembles reception over restroom and cafe over lounge, a `cols*16` by 5 corridor and one project room per input at `slotRect(slot)`; the grid is `cols*16` by 29.
- Room ids stay opaque (`room:` prefix, duplicates and bad slots refused with RangeError) (T-07-22).
- Source-rule test covers every file in both folders (header, `.ts` imports, closed import graph, PANL-05/06 patterns, no enum/namespace/parameter property) (T-07-23).

## Task Commits

n/a (orchestrator commits). Nothing was staged or committed by this executor.

## Fidelity check (port rule 5)

Method: a scratch script outside the repository and outside the fetch directory reads upstream and port as text, strips comments, and compares the sequence of numeric literals and quoted/template string literals (quote style ignored). Result per file; every remaining difference is a rule 4 departure or an import specifier:

| File | Upstream | Differences found | Verdict |
|------|----------|-------------------|---------|
| layout/constants.ts | world/constants.ts | TILE=16 added (from art/api); `../art/api` import gone; dropped EXT_*, ZOOM_*, BUILD_MS, DISMANTLE_*, COMPACT_DELAY_MS, MISSING_DEBOUNCE_MS values (4b) | only departures |
| path/grid.ts | world/path/grid.ts | MAX_GRID_CELLS, size validation, gridFromRows, gridOf (4e, 4f) | only departures |
| path/astar.ts | world/path/astar.ts | `./grid` to `./grid.ts` (x2 imports); findPath literals (4f) | only departures |
| layout/types.ts | world/layout/types.ts | import path; ExteriorProp kind strings removed (4b) | only departures |
| layout/defs.ts (FURNITURE) | art/api.ts | structural compare of all 46 rows (mount, footprint w/h, blocks, seat) against the upstream text: 0 differences; `variants` and `states` dropped (4c) | only departures |
| layout/rng.ts | shared/hash.ts | hash32 constants removed (subset) | only departures |
| layout/theme.ts | art/theme.ts | import path; one `0` in the non-finite seed guard | only departures |
| layout/geometry.ts | world/layout/geometry.ts | import specifiers only | none |
| layout/builder.ts | world/layout/builder.ts | import specifiers only | none |
| layout/core.ts | world/layout/core.ts | import specifiers; core:reception, core:restroom, core:cafe, talk:reception (x2), talk:cafe (x2) (4a) | only departures |
| layout/corridor.ts | world/layout/corridor.ts | import specifiers; core:corridor, talk:corridor:N (4a) | only departures |
| layout/room.ts | world/layout/room.ts | import specifiers only (713-token core and 509-token room sequences otherwise identical) | none |
| layout/building.ts | world/layout/building.ts | import specifiers; validation, ROOM_ID_PREFIX, buildBuilding, areas field (4d, 4f) | only departures |

Golden values computed from the port equal the plan's: `mulberry32(1)` gives 0.6270739405881613, 0.002735721180215478, 0.5274470399599522 and `mulberry32(0xdeadbeef)` gives 0.9413696140982211, 0.26719574979506433, 0.772033357527107.

## Departures applied (port rule 4)

- 4a: `core:recepcao`, `core:banheiros`, `core:copa`, `core:corredor` and the groups `talk:recepcao`, `talk:copa`, `talk:corredor:N` are English.
- 4b: `ExteriorProp`, `EXT_*`, `ZOOM_*`, `BUILD_MS`, `DISMANTLE_*`, `COMPACT_DELAY_MS`, `MISSING_DEBOUNCE_MS` not ported.
- 4c: `FurnitureDef` keeps `mount`, `footprint`, `blocks`, `seat`.
- 4d: `coreAreas()` builds fresh areas on every call.
- 4e: `WalkGrid` validates its size against `MAX_GRID_CELLS`.
- 4f: added `gridFromRows`, `gridOf`, `findPath`, `roomThemeFor`, `buildBuilding`, the `areas` field.
- Not in the rule list but required by it: `TILE` defined in `constants.ts` (upstream re-exports it from art/api).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Integer guard in findPath**
- **Found during:** Task 1
- **Issue:** The ported search indexes typed arrays with `y * w + x`; a fractional coordinate (inside the grid) would read `undefined` and count as walkable.
- **Fix:** `findPath` returns null unless all four coordinates are integers (NaN included); the ported search is unchanged. Covered by an added test.
- **Files modified:** plugins/office/client/path/astar.ts, tests/ui/office-layout.test.mjs

**2. [Rule 2 - Missing critical] Non-finite seeds refused or wrapped**
- **Found during:** Task 2 and Task 3
- **Issue:** `roomThemeFor(NaN)` would index the theme table with NaN and crash on spreading `undefined`; room seeds feed the PRNG and the digest.
- **Fix:** `roomThemeFor` counts a non-finite seed as 0; `buildBuilding` throws RangeError for a non-finite or non-number seed. Both are in added (4f) functions.
- **Files modified:** plugins/office/client/layout/theme.ts, plugins/office/client/layout/building.ts, tests/ui/office-layout.test.mjs

**3. [Rule 2 - Missing critical] Grid cap checked before rooms are built**
- **Found during:** Task 3
- **Issue:** A huge slot would build every room and then fail in the WalkGrid constructor.
- **Fix:** `buildBuilding` compares `cols * COL_W * BUILDING_H` with `MAX_GRID_CELLS` right after validation and throws RangeError.
- **Files modified:** plugins/office/client/layout/building.ts

**Total deviations:** 3 auto-fixed (all Rule 2, all inside `owns`, none changes ported upstream behaviour). No Rule 3 or Rule 4 item, no auth gate, no package install.

## Verification status

The overlay forbids running the build or the test suite, so every `<verify>` obligation below is **awaiting the post-wave gate**; the red phase of the TDD tasks was therefore not observed either. Not run by this executor:

- `node --test tests/ui/office-layout.test.mjs` (tasks 1, 2, 3)
- the `tsc --noEmit` command of the plan over the files `plugins/office/client/path/astar.ts`, `plugins/office/client/path/grid.ts` and the eleven `.ts` files named in the plan under `plugins/office/client/layout` (tasks 1, 2, 3); the plan's path `plugins/planning-panel/node_modules/typescript/bin/tsc` does not exist inside this worktree (no `npm install` was run there), it exists in the main checkout
- `tests/ui/plugin-gates.test.mjs` (PANL-01 tsc of `plugins/office`, PANL-05, PANL-06 now also scan the new files)

What was observed instead, with throw-away scripts kept outside the repository (they import the port as text-stripped `.ts` and assert nothing the test file does not):

- the fidelity table above, the 46-row FURNITURE structural comparison and the two mulberry32 sequences;
- `buildBuilding` for the empty list, the three-room fixture, a four-room fixture with ids `../x`, `__proto__`, `a b`, `core:reception`, a slots 0/5/6 fixture and a six-room fixture: every spot approach tile is walkable (0 failures), every area spot is reachable from every project room door, and every spot of a room reaches its own door (1116 and 417 path checks, 0 failures); 200 seeds x 2 rooms gave 0 unwalkable spot tiles;
- the one-turn L shape, the seat detour and the two interleaved grids of the path tests;
- the golden digest of the fixture `p-alpha/p-beta/p-gamma` at slots 0/1/2 and seeds 11/22/33 (`73ba81c451d29ee58860fef4b5a6be32e24e430566e212e6a066a93dd25535d0`) is pinned in the test, using the same canonical serialisation as the test's `canonical` function.

If the gate shows a failure, it is in a test assertion or a type I could not run; the code paths listed above were exercised.

## Issues Encountered

None beyond the verification limits above. The fetch directory (`mktemp -d`, outside the repository) and the scratch scripts were created by this run and live outside the worktree.

## Known Stubs

None. Nothing is wired to the UI yet (that is 07-03 and later); there is no placeholder data in these modules.

## Threat Flags

None. No network endpoint, auth path, file access or schema was added; the modules are pure and the source-rule test enforces it.

## Cross-plan notes for the orchestrator

1. 07-05 ports `art/theme.ts` into the server; 07-02 holds its own copy as `roomThemeFor` because the client cannot import `server/`. The two ten-entry tables must stay equal; a parity assertion belongs in 07-11.
2. The `FurnitureKind` list in `layout/defs.ts` (46 kinds, pinned by a test) must match the kinds 07-05's furniture renderer draws.
3. The upstream commit `faa1a012b5fbf632c66dc6801c5383e53a542406` should be the one the other port plans record in their headers and in `NOTICE.md`. Every header here names `LICENSES/habblaud-MIT.txt`, which 07-05 adds before 07-12 registers the plugin.
4. Orchestrator bookkeeping: `.planning/WINDOWS.md` was not touched (single-writer rule); the unrun `<verify>` items above are the `unrun-verify` entries if the ledger wants them.
5. Frozen signatures consumed later: `findPath(grid, from, to)` (07-08, 07-10, 07-11), `gridOf` (07-11), `AreaKind` and `buildBuilding(rooms, version)` with `BuildingLayout.areas` (07-03, 07-08, 07-10, 07-11).

## Self-Check: PASSED

- All 14 files exist (checked with `git status`: `plugins/office/client/layout/`, `plugins/office/client/path/`, `tests/ui/office-layout.test.mjs`, and this SUMMARY under `.planning/phases/07-office/`).
- No commit exists for this plan by design (`git log` still ends at c61b279).

---
*Phase: 07-office*
*Completed: 2026-10-21*
