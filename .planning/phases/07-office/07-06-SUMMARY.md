---
phase: 07-office
plan: 06
subsystem: ui
tags: [store, model, poses, sprite-store, fake-paseo]
requires:
  - phase: 07-office
    provides: shared/model-types.ts, sprites-rpc.ts, art-types.ts, client/limits.ts
provides:
  - createStore over the read-only Paseo API, buildModel, poseFor/appearanceSeed, createSpriteStore
status: partial
commits: 0
---

# Phase 7 Plan 06: Office client model layer Summary

**Store, building model, pose table and sprite cache written; nothing was run (overlay forbids build/tests), so every verify is awaiting the post-wave gate.**

Commits: n/a (orchestrator commits).

## Files
- `plugins/office/client/limits.ts` (caps appended), `store.ts`, `model.ts`, `poses.ts`, `sprite-store.ts`
- `tests/ui/fake-paseo.mjs` (additions only plus `calls.push` in existing members), `tests/ui/office-model.test.mjs`, `tests/ui/office-poses.test.mjs`

## Decisions
- HANDOFF_SIGNAL = "status": evidence none observed (07-SPIKE.md SPIKE_WAIVER: "Update log: not captured").
- appearanceSeed = "a" + 8 hex FNV-1a digits (9 chars), keeping sheet keys at most 87 chars.
- Store state uses Maps copied on write; snapshot cache keyed on agents/derived/workspaces/projects maps so taking handoffs does not change the snapshot reference.
- StorePaseo uses `any` parameters (method syntax) so tsc can prove the real PaseoApi is assignable.

## Awaiting post-wave gate (not run)
All `<verify>` commands: office-model/office-poses tests, the four existing fake users plus plugin-gates, `tsc --noEmit -p plugins/office`, office-spike-gate. Known risks: untested TypeScript assignability of `asStorePaseo`; the new tests were never executed and may need fixes; sprite-store imports `sprites-rpc.ts`, which pulls `@getpaseo/plugin` at runtime transitively.

## Deviations
None by rule. Note: the SUMMARY `commits: 0` is correct because the orchestrator commits.

## Hand-off notes
07-11: `createStore(asStorePaseo(usePaseo()))` in one effect with dispose as cleanup; `useSyncExternalStore` on getSnapshot; `buildModel(snapshot)`; `takeHandoffs` then `resolveHandoff`; sprite seeds via `appearanceSeed(agentId)`; sheet poses = POSES_RETURNED plus walk. 07-10 reads AgentView fields only.

## Self-Check: NOT RUN
