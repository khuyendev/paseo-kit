---
phase: 07-office
plan: 01
subsystem: ui
tags: [paseo-plugin, react-native, png, pixelbuf, rpc, node-test]
requires: []
provides:
  - plugins/office skeleton, pinned toolchain and tracer screen
  - office.sprites RPC contract, SpriteKey grammar, SPRITE_REGISTRY, encodePng, PixelBuf core port
  - tests/ui/office-host.mjs fake host (mountModule/render, hooks, fake Animated)
  - dated spike thresholds in 07-SPIKE.md and 07-SPIKE-THRESHOLDS.json
affects: [07-03, 07-04, 07-05, 07-06, 07-07, 07-08, 07-09, 07-10, 07-11, 07-12]
actuals:
  tokens: 65000
  tasks: 3
  commits: 0
plan_head_before: 5e2efc6eccf29d9f8fa633a6a0af908e732671bf
plan_head_after: 5e2efc6eccf29d9f8fa633a6a0af908e732671bf
tech-stack:
  added: []
  patterns: [closed key grammar with never-throwing handler, byte-bounded LRU, Node-side TS transpile fake host]
key-files:
  created:
    - plugins/office/paseo-plugin.json
    - plugins/office/package.json
    - plugins/office/package-lock.json
    - plugins/office/tsconfig.json
    - plugins/office/README.md
    - plugins/office/index.server.ts
    - plugins/office/index.client.tsx
    - plugins/office/client/register.ts
    - plugins/office/client/tracer-screen.tsx
    - plugins/office/shared/art-types.ts
    - plugins/office/shared/sprites-rpc.ts
    - plugins/office/server/limits.ts
    - plugins/office/server/png.ts
    - plugins/office/server/sprites.ts
    - plugins/office/server/sprite-registry.ts
    - plugins/office/server/art/core/pixbuf.ts
    - plugins/office/server/art/core/color.ts
    - plugins/office/server/art/core/sprite.ts
    - tests/ui/office-host.mjs
    - tests/ui/office-png.test.mjs
    - .planning/phases/07-office/07-SPIKE.md
    - .planning/phases/07-office/07-SPIKE-THRESHOLDS.json
  modified:
    - tests/ui/plugin-gates.test.mjs
key-decisions:
  - "Task 1 and Task 2 server files (png, sprites, limits) were written once in their final form; the Task 1 checkpoints were not run"
  - "fakeHost find(type) returns an array of nodes; tree is the single node, or an array for several top-level nodes"
  - "Animated.View/Text/Image/ScrollView are the strings Animated.View etc."
requirements-completed: [OFFC-01, OFFC-03, OFFC-07, OFFC-08, OFFC-09, OFFC-10]
duration: n/a
completed: 2026-10-21
status: complete
---

# Phase 7 Plan 01: Office tracer Summary

**plugins/office with a server-drawn ruler sprite delivered as a PNG data URI through a never-throwing `office.sprites` RPC, a byte-bounded LRU, a ported PixelBuf core, an offline fake host, and dated spike thresholds.**

## Status of verification

Nothing was run except `npm ci --ignore-scripts` (plan step 2) and `node --check` on the three `.mjs` files. The kit overlay forbids running the build or the test suite, so every `<verify>` obligation is **awaiting the post-wave gate**:

- `node --test tests/ui/office-png.test.mjs` (17 tests, including the 4 named in Task 1 and the 6 named in Task 2 acceptance)
- `node plugins/office/node_modules/typescript/bin/tsc --noEmit -p plugins/office`
- `node --test tests/ui/plugin-gates.test.mjs`

Nothing is claimed as passing. The ordered checkpoints of Task 1 step 10 were not run. If the gate is red, the likeliest places are the hand-written renderer and fake react-native in `tests/ui/office-host.mjs`, and strict typing in `plugins/office/server/sprites.ts` and `shared/sprites-rpc.ts`.

## Accomplishments

- Skeleton and toolchain: manifest (id `office`, paseo 0.11.2), `package.json`/`tsconfig.json`/`package-lock.json` copied from swarm-map (only the names changed), installed with `npm ci --ignore-scripts` from the registry (no fallback copy needed); `node_modules/typescript/bin/tsc` exists and is git-ignored.
- Contract: `office.sprites` with `SpriteKey` grammar `kind:seed:poses:scale:tint`, `spriteKey`/`parseSpriteKey` (never throws, round-trips), typed error code lists, `POSE_FRAMES` (20 poses, 46 frames) and `ZOOM_CANDIDATES = [2, 3, 4]`.
- Server: `encodePng` (own CRC table, integer upscale, caps applied before allocation), `ByteLru`, `renderSpriteKey`, `createSpritesHandler` (bad_input, too_many_keys, internal, per-key bad_key/unknown_kind/render_failed/too_large, duplicates rendered once), named caps in `limits.ts`.
- Core port from habblaud `faa1a012b5fbf632c66dc6801c5383e53a542406`: `pixbuf.ts`, `color.ts`, `sprite.ts` with a header naming path and commit, English one-line comments, explicit class fields (no parameter property), `.ts` import extensions; code unchanged otherwise.
- Client: `register.ts` (addScreen, addSidebarHeaderItem), `TracerScreen` (one request per key, one stable `{uri}` source per key, natural pixel size), `TracerSidebarItem`, `index.client.tsx`.
- Fake host: real server handler through `callPluginRpc` with JSON round trips, TS-to-CommonJS loader with a mapped import table (`unmapped import:` for anything else), hook-aware renderer (state, reducer, ref, memo, callback, three effect phases, context, id, imperative handle, external store, memo, forwardRef; `unsupported hook:` for the rest), `mountModule` with `render` alias, `screenProps`, fake Animated/Easing/Platform with a `host.animations` log.
- Gates: office added to IDS (PANL-01/02/05/06/08), `MACHINE_IDS` for PANL-09, PANL-57 named entries, plus `OFFC-04`, `OFFC-03` and `OFFC-01` tests; no ban removed (the 4 removed lines are the IDS, PANL-09 and PANL-02 assertion lines).
- Thresholds: 07-SPIKE.md and 07-SPIKE-THRESHOLDS.json written once at 2026-10-21T06:19:51Z by one script from one object; no measurement, no verdict line.

## Task Commits

n/a (orchestrator commits). `plan_head_before` equals `plan_head_after` because nothing was committed by this executor.

## Decisions Made

- Wrote `png.ts`, `sprites.ts` and `limits.ts` in their Task 2 form directly; Task 1's thin version would have been rewritten immediately.
- `find(type)` on a mount handle returns an array; later plans that expect a single node must index it.
- A timing with no `duration` counts as 500 ms (not 0), so it never finishes synchronously; a synchronous timing sets its `Value` to `toValue`.

## Deviations from Plan

- [Rule 3 - Blocking, tooling] `plugins/office/package.json` was written with LF line endings (swarm-map's is CRLF); the lock file kept CRLF. Content is identical apart from the name. Git normalises it under `core.autocrlf=true`.
- Ran `npm ci --ignore-scripts` as the plan's step 2 requires. No package was added.
- The Task 1 checkpoints (tsc, PNG tests, tracer test) and all `<verify>` commands were not run, per the kit overlay.

## Known Stubs

None.

## Deferred Issues

None.

## Requests

None. Every edit stayed inside `owns`.

## Threat Flags

None beyond the plan's threat model.

## Self-Check

Files exist on disk (verified with `git status`: `plugins/office/`, `tests/ui/office-host.mjs`, `tests/ui/office-png.test.mjs`, the two threshold files, and the modified `tests/ui/plugin-gates.test.mjs`). Behaviour is unverified until the gate runs.
