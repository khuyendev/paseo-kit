---
phase: 07-office
plan: 09
subsystem: ui
tags: [react-native, daylight, tint-fade, confetti, habblaud-port]
requires:
  - phase: 07-office
    provides: "shared/tint.ts TINT_LEVELS (07-03); fakeHost with mountModule (07-01)"
provides:
  - "dayPhase, fadeLayers, tintPosition, ambientAt (ported day cycle) in client/daylight.ts"
  - "seasonFor and SEASONS in client/season.ts"
  - "effectFor, particlesFor, enqueueEffect, finishEffect in client/effects.ts"
  - "TintFade (client/atmosphere.tsx) and EffectLayer (client/effects.tsx)"
affects: [07-11]
actuals:
  tokens: 15000
  tasks: 3
  commits: 0
plan_head_before: n/a (orchestrator commits)
plan_head_after: n/a (orchestrator commits)
tech-stack:
  added: []
  patterns: ["pure functions of a Date argument", "one Animated.Value per burst, transform and opacity only", "caps in limits-atmosphere.ts"]
key-files:
  created:
    - plugins/office/client/limits-atmosphere.ts
    - plugins/office/client/daylight.ts
    - plugins/office/client/season.ts
    - plugins/office/client/effects.ts
    - plugins/office/client/atmosphere.tsx
    - plugins/office/client/effects.tsx
    - tests/ui/office-atmosphere.test.mjs
  modified: []
key-decisions:
  - "Pinned golden hash 0x3bc603f4 for the wave:07:1 burst, computed once from the implemented function"
requirements-completed: [OFFC-17, OFFC-18]
duration: n/a
completed: 2026-10-21
status: complete
---

# Phase 7 Plan 09: Atmosphere client Summary

**Ported habblaud day cycle and season rule, a two-image tint cross-fade, and seeded one-progress confetti/ring bursts with a pure wave/phase completion rule.**

## Accomplishments
- daylight.ts ports the 14 sky keys, light colours and phase limits; adds localHour, tintPosition, dayPhase (levels default `TINT_LEVELS`) and fadeLayers (at most base plus one overlay, nearest-loaded fallback).
- season.ts ports only the automatic `seasonalThemeFor` branch (halloween October, christmas Nov 1 to Dec 26).
- effects.ts: hostile-input-safe `effectFor`, deterministic `particlesFor` (FNV-1a seeded mulberry32), capped `enqueueEffect`/`finishEffect`.
- TintFade and EffectLayer render images and coloured squares only; no text, timer, clock or random source.
- Tests: 15 top-level tests in `tests/ui/office-atmosphere.test.mjs`.

## Task Commits
n/a (orchestrator commits). Files are left uncommitted in the worktree.

## Port provenance and fidelity check
Fetched with `gh api` at `faa1a012b5fbf632c66dc6801c5383e53a542406` into a `mktemp -d` directory; blob shas equal the pins.

| File | Blob sha (equals pin) | Fidelity result |
|------|-----------------------|-----------------|
| render/daylight.ts | 75bda3bff6afe203542eaf86b3eb26d62834717a | No key/colour literal missing from the port. Port-only literals are inline numbers turned into named constants (0.55, 24, 60, 3600, 1e-6, 0.005, 254, 5, 7, 17, 19). Limits 5, 7, 17, 19, 13.5, 22.5 present. Only the rule 4 departures differ. |
| api.ts (seasonalThemeFor) | 2efbcba2c44cfb291d8ebc23eeffee1df15f411b | 9, 10, 11, 26 present in both. |
| render/particles.ts | d51059b35d2e8c60df1937751d36ca4f0bfcf6fd | CONFETTI_COLORS and SPARKLE_COLORS equal. |
| daylight.test.ts, theme.test.ts | e93f3a01…, 1af60722… | Read only to translate assertions; also verified equal to the pins. |

## Deviations from Plan
- Tests were not run and tsc was not run (kit overlay: the orchestrator's post-wave gate runs them; also `plugins/office/node_modules` does not exist in this worktree). The golden hash was computed with a one-off `node` call that imports effects.ts, not by running the test suite.
- No per-task commits (kit overlay).
- Note: `TINT_LEVELS` is currently 2 (provisional, spike waived); dayPhase tests use explicit `levels` where they need 4.

## Awaiting the post-wave gate
- `node --test tests/ui/office-spike-gate.test.mjs`
- `node --test tests/ui/office-atmosphere.test.mjs`
- `node plugins/office/node_modules/typescript/bin/tsc --noEmit -p plugins/office`
- `node --test tests/ui/plugin-gates.test.mjs`

Possible gate risks to check first: the mounted-component tests rely on `mountModule` and the fake Animated of `tests/ui/office-host.mjs`, which are already present; `pointerEvents` is set inside `style` (RN 0.81 typing) and a tsc error there is the most likely type issue.

## Known Stubs
None.

## Self-Check
Files exist (git status shows the seven new files); fidelity script ran. Test and tsc results: not observed [UNVERIFIED].
