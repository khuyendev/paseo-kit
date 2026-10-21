---
phase: 07-office
plan: 04
subsystem: art
tags: [habblaud, pixel-art, character, sprite-sheet, oracle]
requires:
  - phase: 07-office
    provides: "07-01 core (PixelBuf, color, sprite, encodePng, caps) and 07-03 sheet layout (DIRS, canonicalPoses, sheetSize, sheetCell)"
provides:
  - "hash32/mulberry32, seeded appearance table, 20-pose procedural character renderer, hair templates, 24 icons"
  - "renderCharacterSheet: SpriteRenderer-compatible sheet renderer in the frozen layout"
affects: [07-08, 07-11, 07-12]
actuals:
  tokens: 55000
  tasks: 3
  commits: 0
plan_head_before: 717a87a9f3784024d427cc3e3f184675b1ba6af2
plan_head_after: 717a87a9f3784024d427cc3e3f184675b1ba6af2
tech-stack:
  added: []
  patterns: ["pinned-upstream oracle tables in the test file", "token-level port comparison"]
key-files:
  created:
    - plugins/office/server/art/hash.ts
    - plugins/office/server/art/icons.ts
    - plugins/office/server/art/character/parts.ts
    - plugins/office/server/art/character/types.ts
    - plugins/office/server/art/character/appearance.ts
    - plugins/office/server/art/character/hair.ts
    - plugins/office/server/art/character/render.ts
    - plugins/office/server/art/character/sheet.ts
    - tests/ui/office-art-character.test.mjs
  modified: []
key-decisions:
  - "render.ts, hair.ts, icons.ts were ported by a script (scratch, deleted) that copies the pinned upstream text and changes only imports, the removed shared constants and comments, so no coordinate was retyped"
  - "HeldItem has 16 members in the pinned api.ts (the plan said 17); the upstream union was ported unchanged"
requirements-completed: [OFFC-07, OFFC-11, OFFC-20]
status: complete
---

# Phase 07 Plan 04: Character art port Summary

**Habblaud's 20-pose chibi renderer, hair templates, seeded appearance and 24 icons ported byte-faithfully, plus `renderCharacterSheet` in the frozen 07-03 sheet layout, with a 640-entry upstream oracle in the tests.**

Commits: n/a (orchestrator commits). Build, tests and tsc were not run by the executor: every `<verify>` obligation below awaits the post-wave gate.

## Accomplishments
- Task 1: `hash.ts`, `parts.ts`, `types.ts`, `appearance.ts` ported (editor, World flattening, parts override, `tr` dropped); the 60-id, ALL and 3 option oracle entries are in the tests.
- Task 2: `hair.ts` and `render.ts` ported; CHAR_W/H/AX/AY and POSE_FRAMES now come from `shared/art-types.ts`.
- Task 3: `sheet.ts` (`renderCharacterSheet`, `SHEET_SEATED_POSES`, type-level `SpriteRenderer` check) and `icons.ts` (`IconName` moved in).
- Test file: 31 tests, 1539 lines (about 640 pinned hashes: 64 appearance, 24 icons, 240 poses, 48 seated, 32 costume, 60 held, 164 variants, plus the timing table).

## Verify obligations (awaiting the post-wave gate)
- `node --test tests/ui/office-spike-gate.test.mjs` (the precondition; run once before starting, 24 pass)
- `node --test tests/ui/office-art-character.test.mjs` (not run)
- `node plugins/planning-panel/node_modules/typescript/bin/tsc --noEmit -p plugins/office` (not run, so type-level edits forced by tsc are unknown: none were made)
- `node --test tests/ui/plugin-gates.test.mjs` (not run)

## Evidence gathered without running the gates
- Upstream fetched at faa1a012b5fbf632c66dc6801c5383e53a542406; all 11 blob SHAs verified with `git hash-object`.
- Oracle group counts from the unmodified upstream: G1 64 (60 + ALL + 3), G3 24, G4 240, G5 48, G6 32, G7 60, G8 164, G9 timing. sha256 of oracle.json: `f200485ceb56cf1fe2b23f5cf22700456b1bf15586edd88bed8dc0f6a1fd7231`.
- hash32 vectors (811c9dc5, e40c292c, bf9cf968) and the mulberry32 values 0.26642920868471265 / 0.0003297457005828619 / 0.2577907438389957 were reproduced from the port.
- Token-level comparison (TypeScript scanner, trivia skipped), upstream vs port:
  - hair.ts: 2136 vs 2136 tokens, 1 region: `'../api'` -> `'./types.ts'`.
  - render.ts: 17282 vs 17177 tokens, 5 regions: the import block, the four removed `export const CHAR_*` lines, the removed `POSE_FRAMES` table (97 tokens, moved to art-types). Nothing else.
  - icons.ts: 1809 vs 1853 tokens, 1 region: the `../api` import replaced by the moved `IconName` union.
  - hash.ts: 175 vs 175 tokens, 0 regions.
  - appearance.ts (vs appearance-flat.ts): 5 regions, all expected: imports/type aliases, the `parts` option and its tail, `<T,>` -> `<T>`, `const a` -> `return`, `flattenAppearance` dropped, `appearanceKey` appended.
- Hygiene scans by grep over all 8 source files: no non-ASCII character, no Portuguese stop word in a `//` comment, no `office-part-continues` marker, none of the banned DOM/Node/clock/random names.
- Measured once (informational): `renderCharacterSheet` for all 20 poses 20 ms, desk set 3 ms. PNG bytes at ZOOM_LEVELS (2, 3): desk set 15977 / 22389, stand+walk+drink 9136 / 13266. Zoom 4 (not a level) was not measured here; the test logs it.
- Both scratch directories (fetched upstream, oracle and tools) were deleted.

## Deviations from Plan

**1. [Info] HeldItem member count.** The plan says 17 members; the pinned `api.ts` union has 16 (none, coffee, water, papers, laptop, book, box, paddle, popcorn, controller, rock, paper, scissors, phone, lipstick, comb). Ported unchanged; the G7 oracle covers all 15 listed pairs.

**2. [Process] First write of four files went to the main checkout path.** `hash.ts`, `parts.ts`, `types.ts`, `appearance.ts` were first created under the primary working directory by a relative path, then copied into this worktree and removed from the main checkout (they were new untracked files created by this run; nothing else there was touched).

**3. [Process] Precondition run.** The precondition `node --test tests/ui/office-spike-gate.test.mjs` was run once (24 pass) because the plan names it as the read-only precondition.

No auto-fixes (Rules 1-3), no Rule 4 decisions.

## Hand-offs (no edit by this plan)
1. 07-11 registers `character-sheet`: add it to `SPRITE_KINDS` and `renderCharacterSheet` to `SPRITE_REGISTRY` (tsc proves it is a `SpriteRenderer`). Pose budget per PNG: 7 poses at zoom 4, 10 at zoom 3, 15 at zoom 2. The desk set (type, read, use, wait, raise_hand, sulk, sleep) fits every zoom in one sheet; free-standing poses go in a second sheet.
2. 07-08/07-11 sheet reading: one row per pose and direction, one column per frame, 24 x 34 cells, foot anchor (12, 31); read, raise_hand and sulk are drawn seated (4 px lower inside the cell); type, sit, sleep, wait are seated by the renderer; others stand. POSE_DURATION (ms per frame): stand 650, walk 140, run 95, sit 800, type 120, sleep 1000, drink 700, use 380, raise_hand 320, talk 280, stretch 800, read 1100, play 200, wait 480, cheer 260, laugh 190, game 150, rps 300, groom 420, sulk 1300 (pinned by the G9 oracle group); it cannot be imported from client/.
3. The lanyard (child badge, D-04) is supported by the renderer but never drawn by sheets; 07-11 draws it as a client overlay.
4. Icons are ported and tested (24 names) but are not part of `renderCharacterSheet`: the frozen layout has no icon cell. 07-11 may add an `icon` kind.
5. 07-12: OFFC-20 header check globs `server/art/core`, `server/art/character`, `server/art/hash.ts`, `server/art/icons.ts`; the OFFC-22 rule holds since the test imports all 8 modules.

## Known Stubs
None.

## Self-Check
Files exist (checked with `git status`): hash.ts, icons.ts, character/{parts,types,appearance,hair,render,sheet}.ts, tests/ui/office-art-character.test.mjs. Commits: none made (orchestrator). Gates not run: see "Verify obligations".
