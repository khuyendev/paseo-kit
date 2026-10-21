# Phase 07 outline review

Status: passed

## Lanes

| lane | lens | model | effort |
| --- | --- | --- | --- |
| L1 | fidelity | agent default | agent default |
| L2 | integration | agent default | agent default |

## Passes

- pass 1: 15 open
- pass 2: 1 open
- pass 3: 0 open

## Open

| id | lane | plan | severity | target | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |

## Resolved

| id | lane | description | evidence |
| --- | --- | --- | --- |
| L1-1 | L1 | The 07-11 objective lists rooms, clusters, signs, lights, '+N agents' groups, camera, screen, panels, atmosphere and wave trigger. It does not name characters, the handoff walk or hangouts. Its requirements are OFFC-05/06/13/14/17/18/21, so OFFC-11 and OFFC-12 are not on it. The source audit lists O | The 07-11 objective now reads 'characters with pose from `poseFor`, handoff walk, idle wander and hangouts' and 'day-phase tint level into `TintFade`'. Its requirements row now includes OFFC-11 and OFFC-12. The manifest consumes for 07-11 now include `pickHangout` (07-08), `dayPhase` (07-09) and `wa |
| L1-2 | L1 | The 07-12 objective lists read-only, host primitives, strings, licence, ledger and pure-module exercise gates. It names none of the listUsage, file-read-exception, daemon-polling or uri/style gates. OFFC-05, OFFC-14 and OFFC-16 are not on its requirements row, and no other plan owns tests/ui/plugin- | The 07-12 objective now names 'no `listUsage` (OFFC-16), no daemon-driven `setInterval` and no `readFile`/`readdir` outside the wave-link module (OFFC-05, OFFC-18), no agent-provided string in a `uri` or style (OFFC-14)'. Its requirements row and manifest requirements now include OFFC-05, OFFC-14 an |
| L1-3 | L1 | The Shape paragraph says every plan of waves 3 and 4 depends on 07-03 and starts with the spike gate check. 07-12 lists Depends as 07-07 only, and its verify omits tests/ui/office-spike-gate.test.mjs. It is the plan that deletes plugins/swarm-map, and it would do so even after a recorded fail. The d | The Depends column for 07-12 now reads '07-03, 07-07'. The Shape paragraph says every wave 3 and 4 plan 'including `07-12`, which deletes `swarm-map`' depends on 07-03 and starts with the spike gate precondition. The first 07-12 verify command in the manifest is `node --test tests/ui/office-spike-ga |
| L1-4 | L1 | The 07-12 objective says 'CHANGELOG entry with the owner's approval and date'. The Notes name only one human checkpoint (07-03). Nothing says where approval is obtained, and 07-12's verify is all cmd: checks. The approval step is not reachable as planned without a checkpoint. | The 07-12 objective ends with 'final `checkpoint:human-verify` (blocking-human) for the owner's approval and date of the CHANGELOG entry'. The Wave 4 note says '`07-12` has three tasks: gates and tests, retirement with docs and smoke, and the final checkpoint'. |
| L1-5 | L1 | 07-03 produces TINT_LEVELS in shared/tint.ts, but its objective does not mention tint. The spike thresholds and the measured scene cover no tint variants, so no measurement informs the count. The OFFC-17 clause is met only by assertion. | The 07-03 objective now includes 'tint variants of the room layer' and 'the chosen `ZOOM_LEVELS` and `TINT_LEVELS` with their justification' recorded in `07-SPIKE.md`. The thresholds note defines the selection rule 'TINT_LEVELS is the largest N in 2..5 whose measured first-load bytes, with N tint va |
| L1-6 | L1 | The source audit says 07-03 logs one real run's updates. The 07-03 objective and its owns list contain no such logging task or file (spike-hud.ts is for measurement). The handoff rule (OFFC-12, 'exactly one handoff') and the wave trigger rule in 07-06 and 07-11 would be locked without that log. | The 07-03 objective now includes 'an on-screen log of the agent updates of one real orchestrated run' and records 'the update log' in `07-SPIKE.md`. The Gate note adds the owner checkpoint step that reports the on-screen update log, recorded in an `Update log` section. The manifest has `spike-hud.ts |
| L1-7 | L1 | ZOOM_LEVELS = 2, 3, 4 is fixed in 07-01 (shared/art-types.ts) and the spike thresholds assume it. No plan is named to narrow it after the verdict: 07-03 does not own art-types.ts, and no later plan edits it. No plan names the zoom control that offers these levels (07-11 lists only 'camera'). | The 07-03 manifest owns `plugins/office/shared/art-types.ts` and produces `ZOOM_LEVELS`. The thresholds note says 'ZOOM_LEVELS (shared/art-types.ts, owned by `07-03`) is the subset of `ZOOM_CANDIDATES` that passed threshold 5'. The 07-11 objective says 'camera with the zoom control offering `ZOOM_LE |
| L2-8 | L2 | The tracer scenario says 'A fake-host test mounts the registered office screen', so 07-01 needs a mount harness. tests/ui/fake-paseo.mjs has no fakeHost: it exports iso, T_START, agentPayload, toolEntry, messageEntry, fakePaseo, fakeServer and flush. Only 07-06 (wave 3) owns that file, and the resea | 07-01 owns `Path:tests/ui/office-host.mjs` and produces `fakeHost`. 07-03, 07-08, 07-10 and 07-11 each have a `fakeHost` consumes edge in the manifest. The outline limits `tests/ui/fake-paseo.mjs` to 07-06 'subscribe stubs, backward compatible' and lists its other users in the 07-06 verify. The Trac |
| L2-9 | L2 | 07-06 produces buildModel and createStore (building model, caps, exact '+N agents'). 07-10 produces sidebarTree, drawerModel and topbarModel, which read the same agent, workspace and project data. They are in the same wave, so 07-10 cannot consume 07-06 symbols, and it declares only a buildBuilding  | 07-03 owns `shared/model-types.ts` and produces `AgentView`, `WorkspaceView`, `OfficeSnapshot` and `BuildingModel`. 07-06 consumes all four. 07-10 consumes `AgentView`, `OfficeSnapshot` and `BuildingModel`, all from 07-03. The 'OFFC-21 chosen set' note says 07-06 derives the fields, 07-10 presents t |
| L2-10 | L2 | 07-11 composes the layout, camera, scene, hangouts, clocks, day phase, drawer and top bar, but its 20 consumes edges leave out symbols it must use. The scene is built from the building layout, which is 07-02 buildBuilding, AreaKind and gridOf. It also needs POSE_FRAMES, ZOOM_LEVELS, spritesRpc and S | The 07-11 manifest now consumes `buildBuilding`, `AreaKind`, `gridOf`, `findPath`, `POSE_FRAMES`, `spritesRpc`, `SPRITE_REGISTRY`, `MAX_DRAWN_CHARACTERS`, `TINT_LEVELS`, `ZOOM_LEVELS`, `useClock`, `pickHangout`, `dayPhase`, `drawerModel` and `topbarModel`. These cover every symbol the issue listed. |
| L2-11 | L2 | 07-11 owns sprite-registry.ts and wires the real renderers, but it consumes only renderCharacterSheet, renderRoomLayer and tintBuf. Other produced symbols have no consumer: renderIcon, screenVariant, pixelText, themeFor, seasonProps, appearanceFromSeed and hash32 (07-04 and 07-05). The outline lists | The outline 'Sprite kinds' paragraph names the registry kinds: `ruler`, `character-sheet`, `room-layer` and `room-layer` with a `tint` field. It says `appearanceFromSeed`, `hash32`, `renderIcon`, furniture, surfaces, `themeFor`, `seasonProps`, `pixelText` and the screen/board/window variants are int |
| L2-12 | L2 | shared/sprites-rpc.ts and server/sprite-registry.ts are changed by 07-01, 07-03 and 07-11. Meanwhile 07-06 (createSpriteStore, 'one RPC per key') and 07-08 (CharacterSprite, sheet windows) build keys and read responses in wave 3. The key grammar and response shape that wave 3 relies on are not a pro | 07-01 produces `SpriteKey`, `spriteKey` and `parseSpriteKey` in `shared/sprites-rpc.ts`. 07-06 and 07-08 consume `SpriteKey` and `spriteKey`, and 07-11 consumes all three. The outline says the envelope and key grammar are frozen by 07-01 and covered by a contract test in `office-png.test.mjs`. It al |
| L2-13 | L2 | The outline says the 07-12 gates are tree-wide rules that 'pass only once both plans have landed' (for example every module is imported by an office-* test, and no JSX text literal outside strings.ts), and that its per-plan checks use only subsets that do not depend on 07-11. The manifest verify for | The 07-12 verify in `07-PLAN-OUTLINE.manifest.json` (lines 1002-1006) is now three commands: `office-spike-gate.test.mjs`, `plugin-gates.test.mjs`, and the apply and check machine tests. It no longer lists `npm test`, and it does not name `tests/ui/office-tree-gates.test.mjs`. The tree-wide rules mo |
| L2-14 | L2 | The Shape paragraph says every plan of wave 3 and 4 depends on 07-03 and starts with the precondition that the spike gate check passes. 07-04 to 07-11 do run office-spike-gate.test.mjs in verify. 07-12, which deletes plugins/swarm-map and migrates the repository gates, does not: its Depends column i | The 07-12 Depends column is now '07-03, 07-07', and the Shape paragraph names 07-12 explicitly. The first 07-12 verify entry in the manifest is `cmd:node --test tests/ui/office-spike-gate.test.mjs`. |
| L2-15 | L2 | 07-11 retires server/art/spike, spike-screen.tsx and spike-hud.ts. office-spike-gate.test.mjs (owned by 07-03) is in the verify of 07-04 to 07-11. If that test imports spike modules, such as the HUD, it breaks when 07-11 deletes them, and neither plan states that the test reads only 07-SPIKE.md. Sep | The outline says the spike gate test 'reads only these two files and imports no spike module, so retiring the spike code in 07-11 cannot break it'. The 07-03 manifest adds consumes edges for `SPIKE_THRESHOLDS` and `SPIKE_THRESHOLDS_JSON`. The JSON is owned by 07-01, not 07-03. The test fails if `07- |

## Advisories

- L1 07-02: That test lives in tests/ui/office-layout.test.mjs, owned by 07-02. 07-02's requirements are OFFC-10 and OFFC-12, and the source audit puts OFFC-13 only on 07-08 and 07-11.
- L1 07-01: The tracer's observable outcome is a fake-host unit test. It proves RPC, PNG and cache, but not that the real host paints a data-URI Image. That real-host risk is the one the phase gates on, and it is first exercised in 07-03 (wave 2). This is acceptable because nothing expensive is built in between
- L1 07-05: 07-01 ports server/art/core in wave 1. LICENSES/habblaud-MIT.txt and NOTICE.md are created only by 07-05 in wave 3, and OFFC-20 is not on 07-01's requirements. Headers are required by Pattern 4, but the licence file lands two waves later.
- L2 07-03: The outline names server/sprites.ts as shared across 07-01, 07-03 and 07-11. The 07-03 manifest owns list has server/sprite-registry.ts and shared/sprites-rpc.ts but not server/sprites.ts. Spike kinds can go through the registry only, but the two documents disagree.

## Report

```json
{"status":"passed","passes":[15,1,0],"open":[],"resolved":["L1-1","L1-2","L1-3","L1-4","L1-5","L1-6","L1-7","L2-8","L2-9","L2-10","L2-11","L2-12","L2-13","L2-14","L2-15"]}
```
