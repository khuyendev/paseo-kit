# Phase 7: Office - Plan Outline

**Phase goal:** replace `swarm-map` with the read-only `office` plugin (`plugins/office/`): a pixel-art building of Paseo projects, workspaces and agents, art ported from habblaud (MIT) into the plugin server, shown by the client as PNG `Image`s, fed only by the official Paseo API.
**Inputs:** `07-CONTEXT.md` (D-01..D-12), `07-RESEARCH.md` (refreshed against `office.md`), `.planning/requirements/office.md` (OFFC-01..25).
**Shape:** 12 plans in 4 waves (limits: 3 tasks per plan, 12 plans, 4 waves). Waves 1 and 2 are the spike that CONTEXT calls "Wave 0": they end in a go/no-go gate (OFFC-10, D-12). Waves 3 and 4 run only after `07-SPIKE.md` records a pass; every plan of wave 3 and 4 (including `07-12`, which deletes `swarm-map`) depends on `07-03`, starts with the precondition that the spike gate check passes, and lists `tests/ui/office-spike-gate.test.mjs` first in its verify.

| Plan ID | Objective | Wave | Depends | Requirements |
|---------|-----------|------|---------|--------------|
| 07-01 | Tracer: `plugins/office` skeleton with pinned toolchain, a `PixelBuf` core, `node:zlib` PNG encoder, one `office.sprites` RPC with a frozen request/response envelope and the `SpriteKey` grammar (builder and parser), the `fakeHost` mount harness `tests/ui/office-host.mjs`, and a client that shows one server-rendered sprite end to end; the dated spike threshold table is written into `07-SPIKE.md` and into `07-SPIKE-THRESHOLDS.json` before anything is measured | 1 | none | OFFC-01, OFFC-03, OFFC-07, OFFC-08, OFFC-09, OFFC-10 |
| 07-02 | Port habblaud's pure layout (rooms along a hallway, lobby, kitchen, lounge, corridor) and A* path modules into `client/layout` and `client/path`, with layout and path tests | 1 | none | OFFC-10, OFFC-12 |
| 07-03 | Spike scene and gate: shared model types (`AgentView`, `WorkspaceView`, `OfficeSnapshot`, `BuildingModel`) that type the synthetic fixtures; spike-grade server drawing for one room, the common areas, 3 to the named cap of characters, a one-pixel ruler and tint variants of the room layer; client scene with sheet-window frame stepping on shared clocks, walkers, a measurement panel and an on-screen log of the agent updates of one real orchestrated run; owner measures on the desktop app; values, the chosen `ZOOM_LEVELS` and `TINT_LEVELS` with their justification, the update log and the verdict recorded in `07-SPIKE.md`; gate check test reading only `07-SPIKE.md` and the dated thresholds JSON | 2 | 07-01, 07-02 | OFFC-09, OFFC-10, OFFC-17, OFFC-24 |
| 07-04 | Port the character art: `character/{render,hair,appearance}`, hash and appearance tables, icons; deterministic per agent id; golden hashes | 3 | 07-01, 07-03 | OFFC-07, OFFC-11, OFFC-20 |
| 07-05 | Port the scene art: furniture, floor/wall/rug surfaces, theme, seasonal props, pixel font, static `PixelBuf` variants of screens, todo board and window view, room-layer composite, tint variants; habblaud MIT licence and NOTICE | 3 | 07-01, 07-03 | OFFC-07, OFFC-17, OFFC-20 |
| 07-06 | Client model layer: `PaseoApi` subscription store with reconnect re-seed that derives the `AgentView` fields (including the OFFC-21 set: attention, provider, model, workspace kind), building model with caps and exact "+N agents", pose table, handoff enqueue on a finished child turn (rule locked from the update log in `07-SPIKE.md`), client sprite cache (one RPC per key), subscribe stubs added to `fake-paseo.mjs` without breaking its other users | 3 | 07-01, 07-03 | OFFC-05, OFFC-06, OFFC-08, OFFC-11, OFFC-12, OFFC-21 |
| 07-07 | Server contracts: carry `wave-link.ts` and `frontmatter.ts` from swarm-map, id-based `office.wave` RPC, contract tests for every handler, failure envelopes, `shared/` purity | 3 | 07-01, 07-03 | OFFC-03, OFFC-18 |
| 07-08 | Motion and life: character component (clipped sheet window plus transforms on shared clocks), walk along A* paths, handoff walk, idle wander, hangouts, elevator arrival and departure | 3 | 07-01, 07-02, 07-03 | OFFC-09, OFFC-12, OFFC-13 |
| 07-09 | Atmosphere client: ported day-phase interpolation, season selection, tint cross-fade layer, wave and phase completion effect layer | 3 | 07-03 | OFFC-17, OFFC-18 |
| 07-10 | Panels: single English strings table, sidebar tree with camera targets, agent drawer (activity, todos, children, last error, plus presentation of the provider, model and attention fields of `AgentView`), top bar counters, context percentage and the empty usage slot; presents the derived fields, derives nothing | 3 | 07-02, 07-03 | OFFC-14, OFFC-15, OFFC-16, OFFC-19, OFFC-21 |
| 07-11 | Assembly: sprite registry wired to the real renderers (entries only, no change to the RPC shape), building scene (rooms, clusters, signs with workspace kind, status lights, "+N agents" groups), characters with pose from `poseFor`, handoff walk, idle wander and hangouts, camera with the zoom control offering `ZOOM_LEVELS`, office screen composing store, scene, panels, day-phase tint level into `TintFade`, season and wave trigger; spike scene retired; payload budget test with real art | 4 | 07-04, 07-05, 07-06, 07-07, 07-08, 07-09, 07-10 | OFFC-05, OFFC-06, OFFC-11, OFFC-12, OFFC-13, OFFC-14, OFFC-17, OFFC-18, OFFC-21 |
| 07-12 | After the recorded spike pass, retire swarm-map everywhere in the inventory; migrate and finish the gates for `office`: read-only (OFFC-04), host primitives, no `listUsage` (OFFC-16), no daemon-driven `setInterval` and no `readFile`/`readdir` outside the wave-link module (OFFC-05, OFFC-18), no agent-provided string in a `uri` or style (OFFC-14), strings table (OFFC-19), licence and header checks (OFFC-20), pure-module exercise (OFFC-22), ledger (OFFC-25); plugin README, smoke script, repository README and docs; final `checkpoint:human-verify` (blocking-human) for the owner's approval and date of the CHANGELOG entry | 4 | 07-03, 07-07 | OFFC-01, OFFC-02, OFFC-04, OFFC-05, OFFC-14, OFFC-16, OFFC-18, OFFC-19, OFFC-20, OFFC-22, OFFC-23, OFFC-24, OFFC-25 |

## Notes

**Gate.** `07-03` ends in a `checkpoint:human-verify` with `gate="blocking-human"` because the measurement needs the owner's Paseo desktop app and registering `office` in the owner's Paseo config. A recorded fail stops the phase and goes to the owner (fallback considered then: link-out to a running habblaud); nothing in waves 3 and 4 is replanned or run on a fail. The checkpoint also asks the owner to run one orchestrated kit run while the spike screen is open and report the on-screen update log (status transitions and `harness.run` label updates of each agent), which the continuation records in the `Update log` section of `07-SPIKE.md`. The plan keeps one checkpoint after its implementation tasks; a separate wave for the checkpoint would exceed the 4-wave limit, and the only work after the checkpoint is writing the measured values and verdict.

**Spike thresholds (proposed here, written and dated by `07-01` task 1 before any measurement, never edited afterwards):** (1) median interval of the shared animation tick at most 125 ms and 95th percentile at most 250 ms, over 30 s; (2) animated characters at the named cap `MAX_DRAWN_CHARACTERS` = 32, six of them walking, with threshold 1 holding; (3) bytes on first load (all data URIs, base64) at most 2,000,000; (4) bytes at steady state at most 50,000 over 60 s with no new key; (5) crispness: no intermediate colour on the edges of the one-pixel ruler and of one character at each of `ZOOM_CANDIDATES` = 2, 3, 4 on the owner's display scale. Two selection rules are written in the same table before measuring: `ZOOM_LEVELS` (shared/art-types.ts, owned by `07-03`) is the subset of `ZOOM_CANDIDATES` that passed threshold 5; `TINT_LEVELS` (shared/tint.ts) is the largest N in 2..5 whose measured first-load bytes, with N tint variants of every measured room layer, stay within threshold 3. The table is stored twice, in `07-SPIKE.md` and in `07-SPIKE-THRESHOLDS.json` (both written by `07-01` task 1); `office-spike-gate.test.mjs` fails if the two differ or if the JSON has more than one commit when git history is available. The test reads only these two files and imports no spike module, so retiring the spike code in `07-11` cannot break it. Scene measured: hallway, one project room, lobby, kitchen and lounge layers, and the characters above.

**Spike content.** The spike draws with spike-grade `PixelBuf` drawing (flat-colour silhouettes with the real sheet geometry 24x34, 46 frames, 4 directions), not the ported habblaud art: the gate dimensions (cadence, animated count, crispness) do not depend on the art, and the real art is ported only after the pass. Bytes are therefore re-checked with the real art by an offline budget test in `07-11` against the same thresholds (OFFC-08).

**Tracer.** `07-01` is the tracer (wave 1, consumes nothing): client asks `office.sprites` for a keyed sprite, the server renders `PixelBuf` to PNG with `node:zlib`, the client shows it as an `Image` data URI from a cache; verified by a fake-host test (harness `tests/ui/office-host.mjs`, owned by `07-01`, consumed by 07-03, 07-08, 07-10 and 07-11) that mounts the registered screen. Everything in later plans extends this path.

**Reversibility.** No newly surfaced one-way decision. The plugin id `office` is already settled by D-02 (rating kept `costly`, no checkpoint). RPC names, file layout and sprite kinds sit behind the plugin boundary and are `reversible`. Registering `office` in the owner's Paseo config is an owner-facing action and is gated inside `07-03` (blocking-human).

**Wave file ownership.** Plans of one wave own disjoint paths and none consumes a symbol from a plan of the same wave (the manifest lists only earlier-wave consumes). Files that several waves touch are owned by one plan per wave: `client/limits.ts` (07-03 creates, 07-06 extends), `index.client.tsx` and `client/register.ts` (07-01, 07-03, 07-11), `index.server.ts` (07-01, 07-07), `server/sprite-registry.ts`, `server/sprites.ts`, `shared/sprites-rpc.ts` (07-01, 07-03, 07-11), `shared/art-types.ts` (07-01 creates with `ZOOM_CANDIDATES`, 07-03 sets `ZOOM_LEVELS`), `tests/ui/plugin-gates.test.mjs` (07-01 adds `office` to `IDS` and the `Image` allowance, 07-12 finishes), `tests/ui/fake-paseo.mjs` (07-06 only: subscribe stubs, backward compatible; its other users are tests/machine/helpers.mjs, planning-server, plugin-gates and the swarm tests, all in the 07-06 verify). The sprite request and response envelope and the `SpriteKey` grammar are frozen by `07-01` and covered by a contract test in `office-png.test.mjs`; `07-03` and `07-11` may only add entries to the enumerated kind list and to the registry, never change the shape that 07-06, 07-08 and 07-11 rely on. Area limits live in `client/limits-<area>.ts` files next to their module (PANL-56 style); the agent, cluster, room and building caps are in `client/limits.ts`.

**Art port boundary.** `07-04` and `07-05` import only from `server/art/core` and `shared/art-types.ts`; each per-plan planner reads the upstream imports first and assigns a module imported across the two groups to the plan that owns its importer, so no plan of wave 3 imports another. Habblaud's social simulation (`client/src/world/social/`, not yet read) is read by `07-08` in its first task before hangouts are scoped.

**Wave 4 ordering.** `07-12` runs beside `07-11`, not after it (one wave of the 4 allowed). The checks that need the finished tree are kept out of its per-plan verify: `07-12` owns a separate file `tests/ui/office-tree-gates.test.mjs` holding the tree-wide rules (every `.ts` module under `plugins/office/{client,server,shared}` is imported by an `office-*` test, which replaces the PANL-57 named map; no JSX text literal outside `client/strings.ts` and every used key exists in it). That file, the full `plugin-gates.test.mjs` run over the whole office tree, `npm test` and the swarm-map grep over the repository run only at the wave 4 gate, after both plans have landed, and again as the phase gate. The per-plan verify of `07-12` is the spike gate, `plugin-gates.test.mjs` (per-plugin gates that read whatever files exist: read-only, host primitives, no `listUsage`, no daemon-driven `setInterval`, only-reader, uri/style, headers, licence, ledger) and the machine tests; none of them names a `07-11` file. `07-12` has three tasks: gates and tests, retirement with docs and smoke, and the final checkpoint; swarm-map is deleted only after the spike pass is recorded.

**Shared model types.** `shared/model-types.ts` (`AgentView`, `WorkspaceView`, `OfficeSnapshot`, `BuildingModel`, plain data, no Node or React import) is created by `07-03` before wave 3, so `07-06` (producer of the store and `buildModel`) and `07-10` (view-models and components) code against the same types without consuming each other.

**Sprite kinds.** The registry exposes `ruler` (07-01), `character-sheet` (`renderCharacterSheet`; `appearanceFromSeed`, `hash32` and `renderIcon` are internal to it), `room-layer` (`renderRoomLayer`; furniture, surfaces, `themeFor`, `seasonProps`, `pixelText` for static area labels and the screen, board and window variants are internal to it) and `room-layer` with a `tint` field (`tintBuf`). Requests carry only enumerated specs, never agent text. The manifest marks internal symbols with `internal_to`; any ported symbol a per-plan planner finds used directly by a panel becomes a new kind added to the registry by `07-11`.

**OFFC-21 chosen set** (names it so the rest is deferred): attention light and reason, provider and model in the drawer, workspace `kind` on the sign. `07-06` derives the fields into `AgentView`/`WorkspaceView`; `07-10` presents the drawer fields; `07-11` presents the sign. Deferred inside OFFC-21: `lastUserMessageAt` recency and event-only signals.

## Source audit

| Source | Item | Plan | Status |
|--------|------|------|--------|
| GOAL | read-only `office` plugin replaces swarm-map, one building, API-only, PNG art | 07-01..07-12 | COVERED |
| REQ | OFFC-01 | 07-01, 07-12 | COVERED |
| REQ | OFFC-02 | 07-12 | COVERED |
| REQ | OFFC-03 | 07-01, 07-07 | COVERED |
| REQ | OFFC-04 | 07-12 (gate extension started in 07-01) | COVERED |
| REQ | OFFC-05 | 07-06, 07-11, 07-12 (gates) | COVERED |
| REQ | OFFC-06 | 07-06, 07-11 | COVERED |
| REQ | OFFC-07 | 07-01, 07-04, 07-05 | COVERED |
| REQ | OFFC-08 | 07-01, 07-06 | COVERED |
| REQ | OFFC-09 | 07-01, 07-03 (sets ZOOM_LEVELS), 07-08, 07-11 (zoom control) | COVERED |
| REQ | OFFC-10 | 07-01, 07-02, 07-03 | COVERED |
| REQ | OFFC-11 | 07-04, 07-06, 07-11 | COVERED |
| REQ | OFFC-12 | 07-02, 07-06, 07-08, 07-11 | COVERED |
| REQ | OFFC-13 | 07-08, 07-11 (after the recorded pass) | COVERED |
| REQ | OFFC-14 | 07-10, 07-11, 07-12 (uri/style gate) | COVERED |
| REQ | OFFC-15 | 07-10 | COVERED |
| REQ | OFFC-16 | 07-10, 07-12 (listUsage gate) | COVERED |
| REQ | OFFC-17 | 07-03 (tint measurement), 07-05, 07-09, 07-11 | COVERED |
| REQ | OFFC-18 | 07-07, 07-09, 07-11, 07-12 (only-reader gate) | COVERED |
| REQ | OFFC-19 | 07-10, 07-12 | COVERED |
| REQ | OFFC-20 | 07-04, 07-05, 07-12 | COVERED |
| REQ | OFFC-21 | 07-06, 07-10, 07-11 | COVERED |
| REQ | OFFC-22 | 07-12 | COVERED |
| REQ | OFFC-23 | 07-12 | COVERED |
| REQ | OFFC-24 | 07-03, 07-12 | COVERED |
| REQ | OFFC-25 | 07-12 | COVERED |
| RESEARCH | Pattern 1 subscriptions, re-seed, timeline cap | 07-06 | COVERED |
| RESEARCH | Pattern 1b wave RPC takes ids, not a path | 07-07 | COVERED |
| RESEARCH | Pattern 3 pose table | 07-06 | COVERED |
| RESEARCH | Pattern 4 port inventory, syntax pass, headers with SHA | 07-01, 07-04, 07-05 | COVERED |
| RESEARCH | Pattern 5 image strategy (layer per room, sheet windows, integer pre-scale) | 07-03, 07-08, 07-11 | COVERED |
| RESEARCH | Pitfalls 1-9 (syntax, crispness, decode churn, subscriptions, tint variants, stalls, reconnect, orphan parent, CRLF) | 07-01..07-12 | COVERED |
| RESEARCH | Retirement inventory (11 files, folder, smoke, README) | 07-12 | COVERED |
| RESEARCH | Open Question 1 thresholds | 07-01 task 1 | COVERED |
| RESEARCH | Open Question 2 event sequences for handoff and wave trigger | 07-03 (on-screen update log, `Update log` section of `07-SPIKE.md`); 07-06 and 07-11 lock the rule from it | COVERED |
| RESEARCH | Open Question 3 payload shapes (`remove`, workspace and project updates) | 07-06 reads them before coding the reducer | COVERED |
| CONTEXT | D-01 native port, server PNG, client Image | 07-01, 07-04, 07-05 | COVERED |
| CONTEXT | D-02 id office, swarm-map retired | 07-01, 07-12 | COVERED |
| CONTEXT | D-03 API only, subscriptions, no heuristics | 07-06, 07-11 | COVERED |
| CONTEXT | D-04 building model, sidebar, caps | 07-06, 07-10, 07-11 | COVERED |
| CONTEXT | D-05 drawer, counters, day/night, seasons, wave effects, more from API | 07-09, 07-10, 07-11 | COVERED |
| CONTEXT | D-06 common areas gated by the spike | 07-03 (measured), 07-08, 07-11 | COVERED |
| CONTEXT | D-07 empty usage slot, no `listUsage` | 07-10 | COVERED |
| CONTEXT | D-08 English strings table | 07-10, 07-12 | COVERED |
| CONTEXT | D-09 read-only observer | 07-12 gates, all plans | COVERED |
| CONTEXT | D-12 spike gate | 07-01, 07-03 | COVERED |
| CONTEXT | D-10, D-11 informational | none (process) | COVERED |

Deferred ideas (usage windows, Vietnamese strings, sound, permission answering, messages, terminal, character editor, renaming, timelapse, GitHub events, Habblaud World) appear in no plan.

## OUTLINE COMPLETE
