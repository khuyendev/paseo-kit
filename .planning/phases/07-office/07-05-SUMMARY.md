---
phase: 07-office
plan: 05
subsystem: art
tags: [pixbuf, habblaud, furniture, rooms, tint]
status: halted
commits: 0
requirements-completed: []
---

# Phase 7 Plan 05: Scene art Summary

**Status: partial.** The art modules are written and render; the test file is a reduced set; nothing was run through the gate.

## Done
- Ported from habblaud @ pinned commit (every file fetched, blob sha matched): furniture (types, hash, kit, office, common, wall, index), surfaces (types, floor, rug, walls), theme, pixelfont, seasonal, variants, plus new tint.ts and rooms.ts. LICENSES/habblaud-MIT.txt and NOTICE.md entry added.
- Scratch smoke runs (not the suite): all 46 kinds render (88 variant/state combos), real 07-02 building renders in 3 themes, restroom equal across themes, night multiply 74/89/144, a visual check looked right.

## Not done / gaps
- `tests/ui/office-art-scene.test.mjs` is about 150 lines, not the 300 required. Missing tests: walls, pixelfont, variants, seasonal props/paint, room layer theme, limits and crop, real layout (PNG sizes not measured). The 6-kind equal-buffer test is included.
- Per the overlay, no `node --test`, tsc or plugin-gates run. All verify items await the post-wave gate. The new test file is unrun.
- Fidelity check (port rule 5) not run. Comments in ported files were stripped by script and replaced with one-line English comments; inline explanations are gone.
- The rooms.ts first-line header names only art/index.ts, so the source-rules header regex may need the scene/renderer paths (fixed in the same step if the follow-up edit applied).

## Deviations
- Plan claims refuted by pinned upstream: sprite anchors are not always inside the trimmed buffer (wall items sit at the baseboard line; some fronts and toilet_stall), and plant seeds only vary for some variants. Tests must assert the real invariants.
- screenVariant reduces show seeds mod 3 and game seeds mod 2 so the plan's seed-equality claims hold.
- Cobweb lines use Bresenham pixels instead of anti-aliased strokes; decoration lights are baked at the lit level; floorTint is accepted as an optional input.
- Plan 07-11 notes: corridors need crops of 16 tiles; sign anchors need area-name keys in the 07-10 strings table.
