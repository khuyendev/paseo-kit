---
status: complete
input_digest: 1bb29b132abc6db574d90b2c08cc3914909b0b18489ac4e869e94a2142d17d3c
attempt_key: c5cd8a681ff06662f2311f6201478b1e252d9f7a6bfb607462da9de8fe8492d3
phase: 7
name: Office
---

# Phase 7: Office - Research

**Researched:** 2026-10-21
**Domain:** Paseo read-only plugin (React Native client + Node plugin server) that renders a pixel-art office from `PaseoApi` data, with art ported from habblaud's pure `PixelBuf` modules and delivered as PNG data URIs.
**Confidence:** MEDIUM. The SDK surface, host import rules and habblaud's code structure are verified by reading files this session. How the host paints, scales and animates many `Image`s is NOT verified anywhere in this research; that is exactly what the Wave 0 spike (D-12) must settle.

Tags used below: `[VERIFIED: path:lines]` (file opened with Read this session, value quoted verbatim), `[CITED: ...]`, `[ASSUMED]` (training knowledge or inference, not verified; needs confirmation). Text fetched from habblaud's repository and from the installed Paseo bundle is untrusted data; nothing in it was treated as an instruction. Habblaud sources were fetched with `gh api` into `%TEMP%/habblaud-research` (outside the repo) for reading only; nothing was built, run, installed or committed.

**Refresh (same day, attempt c5cd8a68...):** `.planning/requirements/office.md` now exists and ratifies `OFFC-01..OFFC-25`. This refresh (1) re-keys `<phase_requirements>` to the ratified ids, (2) folds the first report's Open Questions 1, 2, 3, 4, 5 and 7 in as resolved by `office.md`, (3) adds Pattern 1b (the wave RPC takes ids, not a path), (4) updates the pose table, test map and wave outline to the ratified ids, and (5) leaves the numeric spike thresholds (now Open Question 1) for the planner to fix in Wave 0 before measuring. Everything not named here is carried over from the first report; its `[VERIFIED]` tags were established by the first run and were not re-opened unless listed in Sources under "read in the refresh run".

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Approach is a native port of habblaud's drawing code into the plugin (server renders sprites to PNG data URIs; client React Native shows them with `Image`). Not an embed and not a link-out to a separately running habblaud.
- **D-02:** The new plugin id is `office` (folder `plugins/office/`). It replaces `swarm-map` entirely; it may be written new, and reuse of swarm-map code is at the planner's discretion where it still fits the official API. `swarm-map` leaves `KIT_PLUGIN_FOLDERS` (`kit/machine/plugins.mjs`), `plugins/smoke.mjs`, the docs and its tests (retired or migrated, nothing left dangling).
- **D-03:** Data comes only from the official Paseo API (`PaseoApi` from `@getpaseo/client`: `projects`, `workspaces`, `agents`, agent timelines, `observeEvents`, and the plugin context types). Prefer subscriptions over polling. Do not read files, parse configs or add heuristics to recover data the API does not give; if the API lacks a datum, the office shows nothing for it.
- **D-04:** Mapping of Paseo's three levels to the office. One building, default view shows every project. Room = Paseo project (`projectId`, `projectDisplayName`). Desk cluster inside the room = session/workspace (`PluginWorkspaceSnapshot`, with its `status` and `diffStat` shown as a sign and a status light). Character = agent (`PluginAgentSnapshot`). A brain (agent without `parentAgentId`) is the main character at the cluster's main desk; agents with `parentAgentId` are small characters with a badge placed around it and walk to their parent to hand in a result. The sidebar keeps Paseo's tree (project, session, agent) and selecting a node moves the camera there. Rooms and clusters grow with agent count; above a named cap (constant, in the style of PANL-56) the surplus is shown as a "+N agents" group instead of drawn.
- **D-05:** v1 scope: rooms and characters by agent state; agent drawer (activity, todos from timeline `todo` items, child agents, last error); counters and context from `lastUsage`; day/night cycle, seasonal themes, and effects when a wave or phase completes (linked to `.planning` through the `harness.run` label as swarm-map did, PANL-61); and whatever else the owner's phrase "take what more we can get" allows from the official API without breaking D-03 or D-09.
- **D-06:** Common areas (lobby with elevators, kitchen, lounge, hallway) and idle wandering and hangouts are in v1, gated by D-12: if the Wave 0 spike shows the plugin host cannot carry the image count and update rate they need, the planner stops and returns to the owner before building them.
- **D-07:** Provider usage windows (5h, weekly) are not read. The top bar keeps an empty slot for them; the owner will supply the API later. (Paseo exposes `providers.listUsage()`; do not use it until the owner says so.)
- **D-08:** UI text is English. Every user-visible string lives in one strings table so a Vietnamese table can be added later without code changes.
- **D-09:** The plugin stays a read-only observer (PANL-05, PANL-06 keep holding): no answering permissions, no sending messages to agents, no terminal, no spawning or archiving, no file writes, no subprocess. Sound is out of scope.
- **D-10 [informational]:** v1.0 is treated as delivered (kit 0.0.1). This phase opens milestone v1.1 as Phase 7. Requirements for it are a new group `OFFC` in `.planning/requirements/office.md`; it supersedes PANL-45..54 and, where they rest on file reads or heuristics, PANL-34, PANL-36 and PANL-55.
- **D-11 [informational]:** Orchestration follows the kit: `ph` in the install at `C:\Users\fish\Desktop\paseo-kit-office` (git worktree, branch `office-v1.1`), every tier mapped to `circle/claude-sonnet-5-5[1m]` (frontier and pro thinking high, standard medium). The owner asked for Sonnet 5.5 for all agents.
- **D-12:** Wave 0 is a spike with a go/no-go gate: a minimal plugin draws one room and at least 3 and up to the named cap of characters as `Image` data URIs. It must show crisp unsmoothed pixel art when scaled, hold the animation and update budget with the common areas included, and keep payloads small (sprites sent once per key, cached by the client). A failed gate stops the phase and goes to the owner (fallback considered then: link-out to a separately running habblaud).

### Claude's Discretion

CONTEXT.md has no `Claude's Discretion` section. Discretion given inside the decisions: reuse of swarm-map code (D-02); the named agent cap and other limits (D-04, "constant, in the style of PANL-56"); and the planner defaults below, which the owner has not yet confirmed.

Planner Defaults (not yet confirmed by the owner; change on request):
- Only code-generated art is ported (the `PixelBuf` modules); habblaud's bitmap assets are not copied.
- Habblaud's MIT notice is added to `LICENSES/habblaud-MIT.txt` and `NOTICE.md`.
- Habblaud modules for permission replies, messages, terminal, Docker, Codex, World, dictation, deliveries and timelapse are not ported.
- Character editor and renaming are not in v1.

### Deferred Ideas (OUT OF SCOPE)

- Provider usage windows (5h, weekly) from the owner's future API (D-07).
- Vietnamese strings table (D-08).
- Sound, permission answering, sending messages, terminal (D-09).
- Character editor, room renaming, timelapse, GitHub event effects, Habblaud World (online city).
</user_constraints>

## Project Constraints (from CLAUDE.md / AGENTS.md)

[VERIFIED: AGENTS.md as loaded in the session context] Directives the plan must honour:
- File I/O: Grep for content, Glob for names, batch reads and edits; do not re-read a file only to verify a write; write long documents in parts.
- Definition of Done is derived from the request and verified before reporting done; claims not observed are marked `[UNVERIFIED]`. Fix the product, not the fixture: never weaken a test, fixture or gate to make it pass (relevant: the PANL-05 read-only gate and PANL-06 client gate must keep passing for `office`, not be loosened; extend them with the new plugin id).
- Agents and waiting: no hand-rolled polling by agents; never retry quota/auth/permission failures; a worker never messages the main session; clean up only what you created.
- Planning state: `.planning/STATE.md` is read first on resume and is written by the GSD flows, not by hand.
- Kit overlay (this run): single writer for PROJECT/STATE/ROADMAP/REQUIREMENTS (workers report instead); no commits by workers; the package audit is not installed in this kit.

<phase_requirements>
## Phase Requirements

`.planning/requirements/office.md` exists and defines `OFFC-01..OFFC-25` [VERIFIED: .planning/requirements/office.md:1-188, read in the refresh run; header line 4: "Proposed by the orchestrating session from `07-CONTEXT.md` (D-01..D-12, locked) and `07-RESEARCH.md`; ratified by the owner when the plan is approved."]. The first report's OFFC-01..15 proposal used different numbering and is retired; plans cite only the ids below. The wording of each requirement is in `office.md`; the table names the research that supports it.

| ID | Title (office.md) | Research support |
|----|-------------------|------------------|
| OFFC-01 | Plugin skeleton and pinned toolchain | Standard Stack; Pitfall 1 (tsconfig, erasable syntax); Environment (lock-file fallback); Runtime State Inventory (build artifacts) |
| OFFC-02 | Retirement of swarm-map | Retirement inventory (re-grepped in the refresh: 11 files outside the plugin folder, all listed) |
| OFFC-03 | RPC contracts and failure envelopes | Don't Hand-Roll (`defineRpc`); Pattern 1b (wave RPC takes ids, never a path); Security V5 |
| OFFC-04 | Read-only observer and host-primitive gates | Security V4; Pattern 4 "Read-only gate fit"; Project Constraints |
| OFFC-05 | Data from the official Paseo API only, pushed not polled | Pattern 1 (subscriptions); Pitfalls 4, 7, 8; State of the Art; Open Questions (resolved table) |
| OFFC-06 | Building model: rooms, clusters, characters, caps | Pattern 1 (parent link by label); Pattern 2 (snapshot shapes); Pitfall 8 |
| OFFC-07 | Pixel-art port into the plugin server | Pattern 4 (port inventory); Pitfall 1; Don't Hand-Roll; upstream SHA recorded by the executor |
| OFFC-08 | PNG delivery: sent once per key, cached, bounded | Code Examples (PNG); Pattern 5; Pitfalls 3, 6 |
| OFFC-09 | Crisp pixel art when scaled | Pattern 5 item 3; Pitfall 2; A4 |
| OFFC-10 | Wave 0 spike with go/no-go gate | Suggested wave outline; Open Question 1 (thresholds, left to the planner); Pattern 5; Validation Architecture |
| OFFC-11 | Pose and appearance from agent state | Pattern 3 (table, now ratified); Don't Hand-Roll (`appearanceFromSeed`) |
| OFFC-12 | Handoff walk to the parent | Pattern 4 (`world/path/astar`, `grid`); Pitfall 8; A17 (how a finished turn is detected) |
| OFFC-13 | Common areas, idle wandering and hangouts | Pattern 4 (`world/layout/*`, social simulation not yet read); A18; gated by OFFC-10 |
| OFFC-14 | Sidebar tree and camera | Architecture Diagram (entry points, `addScreen`/`addSidebarHeaderItem`); Anti-Patterns (agent text only as `Text`); habblaud `camera.ts` is canvas code, so the camera is rewritten with RN transforms |
| OFFC-15 | Agent drawer | Pattern 2 (`AgentTaskItem`, `todo` item, `ToolCallDetail`); Pattern 1 (child list from the parent label); `lastError` is in the agent schema (Pattern 1 parent-link field list) |
| OFFC-16 | Top-bar counters, context and the empty usage slot | Pattern 2 (`AgentUsage`); A10; `providers.listUsage()` is not called (D-07) |
| OFFC-17 | Day/night cycle and seasonal themes | Pattern 4 (`daylight.ts`, `seasonal.ts`, `theme.ts`); Pitfall 5; A6 |
| OFFC-18 | Wave and phase completion effects via harness.run | Pattern 1b; `wave-link.ts` (read in full in the refresh); Security V12; PANL-14 byte-copy test of `frontmatter.ts` stays |
| OFFC-19 | One English strings table | Recommended Project Structure (`client/strings.ts`); grep gate in the test map |
| OFFC-20 | Licence and notice for the port | Security (licence row); existing `LICENSES/` files; SHA recorded by the executor |
| OFFC-21 | Additional read-only signals from the API | Pattern 1 field list (`attentionReason`, `lastUserMessageAt`, `provider`, `model`), Pattern 2 (workspace `kind`), `observeEvents` enum |
| OFFC-22 | Offline tests for every pure module | Validation Architecture; Pitfall 9; PANL-57 `named` map migrates to `office` |
| OFFC-23 | Documentation, smoke script and changelog | Retirement inventory (`plugins/smoke.mjs`, `README.md`); HARN-15 owner approval |
| OFFC-24 | Host scope of the gate | Environment Availability; first report's mobile finding (`layout.platform`); desktop only, one host |
| OFFC-25 | Superseded requirement ledger | `office.md` ledger; `tools.md` stays unchanged (Retirement inventory note) |
</phase_requirements>

## Summary

The phase is feasible on the data side and on the build side, and risky on the paint side. Verified feasible: `PaseoApi` gives everything D-04/D-05 need (projects, workspaces with `status`/`diffStat`, agents with `lastUsage`/`lastError`/`activeTurn`/`pendingPermissions`, timeline `todo` and `tool_call` items) and the **client** can subscribe to it directly (`usePaseo()` returns a `PaseoApi`; `agents.list({subscribe:{}})`, `agents.subscribe`, `workspaces.subscribe`, `projects.subscribe`, `agents.ref(id).timeline.subscribe`). Habblaud's core art (`core/pixbuf.ts`, `core/sprite.ts`, `core/color.ts`, `character/*`, `furniture/*`, `surfaces/*`, `theme.ts`, `seasonal.ts`, `icons.ts`, `pixelfont.ts`) is DOM-free and MIT; only `art/index.ts` (canvas wrapper) and `art/dynamic.ts` (canvas `ctx` drawing for screens, board, window view, clock) are DOM-bound. The host bundler lets the plugin **server** import `node:zlib` (so PNG encoding needs no package) and forbids Node builtins in the client, which forces the architecture the CONTEXT already chose (server renders, client shows).

What nobody has verified, and what this research cannot: whether the host's `Image` (react-native-web in Electron, native `Image` on iOS/Android via Hermes) draws pixel art without smoothing, how many data-URI images it carries at animation rates, and whether a plugin can hold 4-8 fps frame stepping for tens of characters. The recommended design keeps those costs low by construction (one pre-composited PNG per room layer, characters as clipped sprite-sheet windows moved with transforms, integer-pre-scaled sprites so no host smoothing flag is needed) but every number is a spike measurement, not a finding. The spike (D-12) must come first and its gate must be a mechanical, recorded result.

Both scope conflicts of the first report are resolved by the ratified requirements: the `.planning` wave link is the one named read-only exception (OFFC-18, cited by OFFC-05), and a tool call whose detail is `unknown` maps to the default work pose with no name table (OFFC-05, OFFC-11). Two consequences are new. First, OFFC-03 forbids a path in any RPC input while the carried `WaveLinker.link` takes a project directory, so the wave RPC must take `{workspaceId, runId}` and resolve the directory on the server (Pattern 1b). Second, OFFC-10 and D-12 put the common areas inside the measured spike scene, so Wave 0 must include the layout port and a few walking characters, not only one room.

**Primary recommendation:** Build Wave 0 as a throwaway-quality but real `plugins/office` skeleton: server `PixelBuf` -> PNG with `node:zlib`, one RPC returning keyed sprite sheets, client `Image`s with integer pre-scaling and sheet-window frame stepping, the common areas in the measured scene, plus a measurement panel; fix the numeric thresholds first (Open Question 1); plan the later waves only after a recorded pass (OFFC-10).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Live roster of projects, workspaces, agents | Plugin client (via `usePaseo()` `PaseoApi`) | Paseo daemon | Only the client side can subscribe and receive pushes; server plugin has request/response RPC only [VERIFIED: server/contracts.d.ts:24-29, quoted in Data flow] |
| Pose / activity of an agent | Plugin client | Paseo daemon (timeline stream) | Needs `tool_call` detail type from the timeline stream per running agent |
| Pixel-art generation and PNG encoding | Plugin server (Node plugin process) | none | Client bundle cannot import Node builtins; art must live in `server/`, not `shared/` [VERIFIED: compiler.js:266-267, checkSharedDependencies] |
| Sprite cache | Plugin client (Map by key) | Plugin server (LRU by key) | "Sprites sent once per key, cached by the client" (D-12) |
| Room layout, pathfinding, wandering, camera, animation clocks | Plugin client | none | Pure, DOM-free habblaud modules ported into `client/`; renders with RN `Animated` |
| Day/night, season | Plugin client (clock, tint level) | Plugin server (renders quantized tint variants of static layers) | Tint applied by choosing a pre-rendered variant or overlay; see Pitfall 5 |
| Wave/phase completion effect | Plugin server (`wave-link`, reads run + `.planning`) | Plugin client (effect) | Only filesystem-reading piece; contained by realpath checks (existing `wave-link.ts`) |
| Strings table, counters, drawer | Plugin client | none | Presentation |
| Provider usage slot | Plugin client (empty slot) | none | D-07: no API call |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@getpaseo/plugin` | 0.11.2 (pinned, devDependency) | Plugin SDK types, `defineRpc`, client hooks | [VERIFIED: plugins/swarm-map/package.json devDependencies `"@getpaseo/plugin": "0.11.2"`; installed CLI reports `0.11.2` via `paseo --version`] |
| `@getpaseo/client` (types via the plugin) | 0.11.2 | `PaseoApi` | [VERIFIED: plugins/planning-panel/node_modules/@getpaseo/client/package.json `"version": "0.11.2"`] |
| `react` | 19.1.0 | UI | [VERIFIED: swarm-map package.json `"react": "19.1.0"`] |
| `react-native` | 0.81.5 | `View`, `Image`, `Animated`, `Pressable`, `Text` | [VERIFIED: swarm-map package.json `"react-native": "0.81.5"`]; the host serves it to the client bundle [VERIFIED: compiler.js:336 `"react-native",` in the client `external` list] |
| `zod` | ^4.4.3 | RPC schemas in `shared/` | [VERIFIED: swarm-map package.json]; host-supplied (compiler.js `SERVER_HOST_MODULES = [...PLUGIN_SDK_SPECIFIERS, "zod"]`, line 7) |
| `typescript` | ^5.9.3 | `tsc --noEmit` gate | [VERIFIED: swarm-map package.json]; `Uint8ClampedArray<ArrayBuffer>` in habblaud's `PixelBuf` needs TS >= 5.7 `[ASSUMED]` |
| `node:zlib` | Node >= 24 (machine has v24.19.0) | PNG IDAT deflate + CRC32 (`zlib.crc32` is present in Node 24 `[ASSUMED]`; a 256-entry table CRC is the fallback) | Built in; server target is `platform: "node"` [VERIFIED: compiler.js:321] |
| `@tanstack/react-query`, `@types/react`, `@types/node` | as in swarm-map | already pinned toolchain (PANL-01) | Copy `package.json` / `tsconfig.json` / `package-lock.json` shape from swarm-map |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| habblaud art modules (MIT, ported source, not a dependency) | `main` at fetch time (repo pushed 2026-10-20) | `PixelBuf`, `renderCharacter`, furniture, surfaces, themes, seasonal props, icons, pixel font | Port into `plugins/office/server/art/`; record the upstream commit SHA in the port header/NOTICE (not captured here: fetched by `contents` API without resolving the SHA) |
| habblaud `world/layout/*`, `world/path/*`, `world/render/daylight.ts` (pure) | same | Room and building layout, A*, day-phase colour keys | Port into `client/` / `shared/` (types) at planner discretion; they are not listed in the CONTEXT canonical refs but are DOM-free (see Port inventory) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:zlib` PNG encoder | A PNG npm package | Adds a supply-chain surface and bundling weight for ~40 lines; PNG is signature + IHDR + IDAT(zlib) + IEND + CRC32. The package audit is not installed in this kit, so any new package would be `[ASSUMED]` and needs a human-verify checkpoint. Do not add one. |
| Server PNG encode (D-01, locked) | Client-side encode with "stored" (uncompressed) deflate blocks | Would avoid RPC round trips but D-01 locks server rendering; keep only as a fallback idea if RPC payloads prove the bottleneck. |
| Per-tile `Image`s | One composited PNG per room layer | Per-tile counts explode (a 16x12-tile room is 192 tiles); one image per layer is the recommended unit. |
| Link-out to running habblaud | (D-12 fallback) | Only if the gate fails and the owner agrees. |

**Installation:** none beyond the existing pinned toolchain; the executor creates `plugins/office/package.json` from swarm-map's and runs `npm install --ignore-scripts` to produce `package-lock.json` (PANL-01 requires a lock file for `npm ci`) [VERIFIED: tests/ui/plugin-gates.test.mjs PANL-01 test asserts `package-lock.json` exists].

**Version verification:** Versions above were read from files installed on this machine, not re-queried from the npm registry (no registry call was made; this is an offline-pinned toolchain copy, not a new dependency choice).

## Package Legitimacy Audit

The package audit and research cache are not installed in this kit; **the audit was not run**. This phase recommends **no new external package**: the toolchain is the already-pinned swarm-map set (re-used verbatim), PNG encoding uses `node:zlib`, and habblaud code is copied as source under MIT, not installed.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none new) | - | - | - | - | not run | No install proposed |

**Packages removed due to [SLOP] verdict:** none (audit not run).
**Packages flagged as suspicious [SUS]:** none (audit not run). If the planner adds any package beyond the pinned set, it is `[ASSUMED]` and needs a `checkpoint:human-verify` task before install.

## Architecture Patterns

### System Architecture Diagram

```
 Paseo daemon (official API only, D-03)
   |  agents / workspaces / projects / timelines / observeEvents
   v
 PLUGIN CLIENT (React Native bundle, Hermes/RN-web)                       PLUGIN SERVER (Node plugin process)
 +-----------------------------------------------------------+            +--------------------------------------+
 | usePaseo() -> PaseoApi                                    |            | handlers (request/response only)     |
 |  agents.list({subscribe:{}}) + agents.subscribe  -> store | --RPC----> | office.sprites(keys[]) -> PNG b64    |
 |  workspaces.list({subscribe:{}}) + .subscribe     -> store|  keys      |   PixelBuf art -> png.ts (node:zlib) |
 |  projects.list + .subscribe (+observeEvents)      -> store|            |   LRU by key, caps (named consts)    |
  |  per running agent: timeline.subscribe -> last tool/todo  | <-RPC----- | office.wave({workspaceId, runId})    |
 |                                                           |  result    |   wave-link.ts: run.json/args.json + |
 | model.ts (pure reducer): Building{rooms>clusters>chars}   |            |   .planning plans/SUMMARY (mtime     |
 | layout/path/wander (pure, ported)  -> positions per tick  |            |   cache, realpath containment)       |
 | scene.tsx: per room 1 static layer <Image> (+tint level)  |            +--------------------------------------+
 |   characters = clipped sheet window <Image> + transform   |
 |   effects/day-night/season, drawer, sidebar, top bar      |
 +-----------------------------------------------------------+
   shared/: zod RPC contracts + plain types (no Node, no React imports)
```

Entry points: client `index.client.tsx` registers the screen and a sidebar item (the swarm-map pattern is `client.addSurface` + `client.addSidebarItem`, both marked `@deprecated` in 0.11.2 in favour of `addScreen` and `addSidebarHeaderItem` [VERIFIED: client/contracts.d.ts:100-103 `/** @deprecated Use \`addScreen\`. */` and `/** @deprecated Use \`addSidebarHeaderItem\`. */`]); server `index.server.ts` default-exports `contribute(server)` returning a disposer (PANL-02) [VERIFIED: plugins/swarm-map/index.server.ts:11-25].

### Recommended Project Structure

```
plugins/office/
  paseo-plugin.json  package.json  package-lock.json  tsconfig.json  README.md
  index.client.tsx  index.server.ts
  shared/            # zod defineRpc contracts + plain types (art kinds, appearance, layout types); NO Node, NO React
  server/
    art/             # ported PixelBuf modules (core/, character/, furniture/, surfaces/, theme, seasonal, icons, pixelfont, hash)
    png.ts           # RGBA -> PNG (node:zlib) + integer nearest-neighbour upscale
    sprites.ts       # key -> sprite sheet render, LRU, size caps
     wave-link.ts     # carried from swarm-map with frontmatter.ts (byte copy of planning-panel's); the one file reader (OFFC-18)
    limits.ts        # every cap is a named constant (PANL-56 style)
  client/
    store.ts         # PaseoApi subscriptions -> normalized state (pure reducer + thin effect)
    model.ts         # state -> Building (project > workspace > agent), caps, "+N agents"
    layout/ path/    # ported pure habblaud modules (rooms, corridor, common areas, A*)
    poses.ts         # agent state + last tool kind -> pose (table)
    scene.tsx room.tsx character.tsx drawer.tsx sidebar.tsx topbar.tsx effects.ts daylight.ts clock.ts
    strings.ts       # the single English strings table (D-08)
```

Constraint behind this layout: Paseo compiles each plugin from its own folder, so nothing can be shared with other plugins (CONTEXT code_context), `shared/` may not import Node builtins or SDK-private modules (`checkSharedDependencies` rejects them) and the client may not import `server/` [VERIFIED: compiler.js:266-267 `else if (target !== "server" && (isBuiltin(specifier) || specifier === "@types/node"))` / `kind = "Node";`; compiler.js:285-307 `checkSharedDependencies` walks `shared` inputs and throws on a runtime-specifier error]. Hence the art code (which a PNG encoder needs `node:zlib` for) lives in `server/`, and anything the client needs to *place* things (kind names, sizes, layouts) is plain data in `shared/` or ported pure code in `client/`.

### Pattern 1: Push from the client, render on the server

**What:** The server cannot push: its context only offers `handle` (request/response), lifecycle `on`/`before`, settings, provider/usage registration [VERIFIED: server/contracts.d.ts:24-29: `export interface PluginServerContext extends PluginLifecycleRegistration {` ... `handle<InputSchema extends ZodType, OutputSchema extends ZodType>(contract: PluginRpcContract<InputSchema, OutputSchema>, handler: ...): void;` ... `registerProvider(...)`, `registerUsageSource(...)`]. The client holds the daemon connection: `usePaseo(): PaseoApi` [VERIFIED: client/paseo-context.d.ts:8 `export declare function usePaseo(): PaseoApi;`]. So "pushed rather than polled" (D-03) means client-side subscriptions; the RPC is used only for things the client cannot do (PNG rendering, the file-backed wave link), and those are cached, not polled.

**Subscription primitives** [VERIFIED: @getpaseo/client dist/index.d.ts]:
- Agents: `list(options: PaseoAgentListOptions & { subscribe: {}; }): Promise<PaseoAgentListResult & { subscriptionId: string; subscription: OwnedSubscription<PaseoAgentListResult>; }>` and `subscribe(handler: PaseoAgentUpdateHandler): () => void;` (index.d.ts:302-316). The doc comment says the local `subscribe` is a listener over "the low-level driver's agent_update stream" and "only removes this SDK listener", so the daemon stream is started by `list({subscribe:{}})`.
- `agent_update` payload is a discriminated union on `kind`; both `kind: z.ZodLiteral<"upsert">` (with `agent`) and `kind: z.ZodLiteral<"remove">` exist [VERIFIED: protocol messages.d.ts:9112-9118 (`type: z.ZodLiteral<"agent_update">`, `kind: z.ZodLiteral<"upsert">`) and a `kind: z.ZodLiteral<"remove">` branch found by grep ~line 9268].
- Workspaces: `list(options: ... & { subscribe: {}; })` and `subscribe(handler)`; the doc says "Call `workspaces.list({ subscribe: {} })` when the daemon should start streaming workspace directory updates" (index.d.ts:119-125, 131-148).
- Projects: `projects.list(options?)` and `projects.subscribe(handler)` (index.d.ts:127-130). `observeEvents(events: SessionEventSubscription[], ...)` exists on `PaseoApi` (index.d.ts:392) and its enum includes `"project.update"`, `agent_attention_required`, `agent_permission_request`, `agent_permission_resolved`, `workspace_setup_progress` ... [VERIFIED: protocol messages.d.ts:4450-4462]. Whether `projects.subscribe` receives updates without `observeEvents(["project.update"])` is `[ASSUMED]`: call both; the spike checks it.
- Timeline: `agents.ref(id).timeline.subscribe(handler)` delivers live events only; "After reconnect, `subscription_restored` precedes subsequent updates. History may have been missed; use refetch()"; "Await the returned unsubscribe function's `ready` promise before starting work that must be observed" (index.d.ts:242-257).

**Pattern:** one `store.ts` seeds from `list`/`refetch`, applies `upsert`/`remove`, and on every reconnect marker (`subscription_restored`, `replacement`) re-seeds. Timeline subscriptions are opened only for agents that are `running` (plus the drawer's selected agent) and bounded by a named constant, because one subscription per agent is the unbounded cost; an agent that is not subscribed is posed from its snapshot alone.

**Parent link:** the agent snapshot in the client SDK has no `parentAgentId`: the schema body at protocol `messages.d.ts:423-493` lists `id, provider, cwd, workspaceId, model, features, thinkingOptionId, effectiveThinkingOptionId, createdAt, updatedAt, lastUserMessageAt, status, activeTurn, capabilities, currentModeId, availableModes, pendingPermissions, persistence, runtimeInfo, lastUsage, lastError, title, labels, requiresAttention, attentionReason, attentionTimestamp, archivedAt, providerUnavailable` and no parent field. The parent is carried by the label: `export declare const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";` [VERIFIED: protocol agent-labels.d.ts:1], with helper `getParentAgentIdFromLabels(labels): string | null` (agent-labels.d.ts:7). `PluginAgentSnapshot.parentAgentId: string | null` exists on the host-provided snapshot [VERIFIED: plugin contracts.d.ts:51 `readonly parentAgentId: string | null;`] and `useAgent(agentId, selector)` reads it by id [VERIFIED: client/client-state.d.ts:10], but cannot enumerate; so enumerate from `agents.list` and read the label (swarm-map's `PARENT_LABEL` does this: snapshot.ts:15 and :48). Define the constant locally; do not import `@getpaseo/protocol` into the plugin bundle `[ASSUMED: it is not in the host externals list, so it would be bundled]`.

### Pattern 1b: The wave RPC takes ids, never a path (reconciles OFFC-03 with OFFC-18)

OFFC-03 requires every input to be "a bounded, enumerated spec ... never a path or free text" [VERIFIED: .planning/requirements/office.md OFFC-03]. The carried module's entry point takes a directory: `async link(project: string | null, runId: string | null): Promise<WaveLink | null>` [VERIFIED: plugins/swarm-map/server/wave-link.ts:78]. swarm-map obtained that directory on the server from a workspace id: `const ref = paseo.workspaces.ref(a.workspaceId);` ... `dir = ws?.workspaceDirectory ?? ref.directory ?? null;` [VERIFIED: plugins/swarm-map/server/snapshot.ts:117-119], and a server handler receives `paseo: PaseoApi` in its context [VERIFIED: @getpaseo/plugin dist/server/contracts.d.ts:9 `paseo: PaseoApi;`].

**Prescription:** `office.wave` input is `{ workspaceId, runId }` (strings bounded by named limits). The handler resolves the workspace directory itself with the read-only `workspaces.ref(id)` call, then calls `link(dir, runId)`. The client never sends a path. Drop swarm-map's fallback to the agent `cwd` when no workspace id exists (`if (!a.workspaceId) return a.cwd;`, snapshot.ts:112): an agent without a workspace id gets no effect, which is what OFFC-18 says for an agent without the label. `link` keeps its own containment (runId rejects `/[\\/]|^\.\.?$/`, realpath inside `_workspace/_runs` and `.planning/phases`, no writes) [VERIFIED: wave-link.ts:79-94]. The result shape to move into `shared/` is `{ phase, wave, plansDone, plansTotal, scope }` with `scope` `"complete"` or `"unreadable"` [VERIFIED: wave-link.ts:98 `const unreadable: WaveLink = { phase, wave: waveNo, plansDone: null, plansTotal: null, scope: "unreadable" };` and :125 `return { phase, wave: waveNo, plansDone: done, plansTotal: total, scope: "complete" };`]. The label key is `export const RUN_LABEL = "harness.run";` (wave-link.ts:13).

**Trigger without polling (A16):** the files change without any API push, so nothing in the API says "a wave finished". Recommend the client re-asks `office.wave` only on pushed agent updates for an agent that carries the label (status or `updatedAt` changed), debounced by a named minimum interval constant, never by `setInterval`; an effect plays when `plansDone` rises or first equals `plansTotal`. `[ASSUMED]` design, to be checked in Wave 0 against a real run's `agent_update` sequence.

### Pattern 2: Verified data shapes the model is built on

Quoted verbatim from `@getpaseo/plugin` 0.11.2 `dist/contracts.d.ts` (the plugin-context snapshots; the `PaseoApi` payloads carry the same facts with the differences above):

```ts
// contracts.d.ts:18-35 (PluginWorkspaceSnapshot, excerpt)
readonly projectId: string;
readonly projectDisplayName: string;
readonly kind: "directory" | "local_checkout" | "checkout" | "worktree";
readonly status: "needs_input" | "failed" | "running" | "attention" | "done";
readonly diffStat: { readonly additions: number; readonly deletions: number; } | null;
// contracts.d.ts:36-53 (PluginAgentSnapshot, excerpt)
readonly status: "initializing" | "idle" | "running" | "error" | "closed";
readonly requiresAttention: boolean;
readonly attentionReason: "finished" | "error" | "permission" | null;
readonly parentAgentId: string | null;
readonly labels: Readonly<Record<string, string>>;
```

From `@getpaseo/protocol` `agent-types.d.ts`:

```ts
// agent-types.d.ts:163-170
export interface AgentUsage { ... contextWindowMaxTokens?: number; contextWindowUsedTokens?: number; }
// agent-types.d.ts:300-322 (todo)
export interface AgentTaskItem { text: string; completed: boolean; id?: string; status?: "pending" | "in_progress" | "completed"; activeForm?: string; }
... | { type: "todo"; items: AgentTaskItem[]; } | { type: "error"; message: string; } | { type: "notification"; level: "info" | "warning" | "error"; message: string; } | CompactionTimelineItem | PluginTimelineItem;
// agent-types.d.ts:173-262 ToolCallDetail discriminants, in order
shell, read, edit, write, search, fetch, worktree_setup, sub_agent, plain_text, plan, unknown
```

Note against CONTEXT canonical refs: the CONTEXT lists timeline item types `tool_call`, `todo`, `reasoning`, `assistant_message`, `user_message`, `error`, `compaction`; the installed union also has `notification` and the `plugin` item (agent-types.d.ts:307-322 as quoted). The kit already smoke-tests an overlapping list in `plugins/smoke.mjs:14-15` (`TIMELINE_TYPES`, `DETAIL_TYPES`, which uses `"sub_agent"`, `"worktree_setup"`, `"plain_text"` consistent with the protocol).

`lastUsage` gives `contextWindowUsedTokens / contextWindowMaxTokens`; the kit's context-guard threshold is a project setting the plugin must not read (D-03 supersedes PANL-55). Use one named client constant for the warning level, set to the kit default 60 `[ASSUMED: value from runtime.md PHCL-16 text "kit default 60, D-48", read in a grep result; the constant is a presentation choice the owner can change]`.

### Pattern 3: Pose from state (table, no name heuristics)

Built from CONTEXT `<specifics>` and the verified enumerations above:

| Condition (latest first wins) | Pose | Basis |
|-------------------------------|------|-------|
| `pendingPermissions.length > 0` or (`requiresAttention` and `attentionReason === "permission"`) | `raise_hand` | CONTEXT specifics |
| `status === "error"` | `sulk` | CONTEXT specifics |
| `status === "closed"` | `sleep`, then leaves by elevator | CONTEXT specifics |
| `status === "running"`, last tool `detail.type` `edit` or `write` | `type` (seated) | CONTEXT specifics |
| `running`, `read` | `read` | CONTEXT specifics |
| `running`, `shell` | `use` | CONTEXT specifics |
| `running`, last item `reasoning` / no tool yet | `wait` | CONTEXT specifics ("thinking -> wait") |
| `running`, any other tool detail (`search`, `fetch`, `plan`, `sub_agent`, `worktree_setup`, `plain_text`, `unknown`) | the default seated work pose (recommend `type`) | OFFC-11 [VERIFIED: office.md OFFC-11 "other tool details (including `unknown`) -> the default seated work pose"]; which pose is the default is `[ASSUMED]` (A9). The first report's `sub_agent` -> `talk` proposal is withdrawn |
| `idle` | `stand` or `drink`; wanders in common areas (D-06) | CONTEXT specifics |
| `initializing` | arrives by the elevator | OFFC-11 [VERIFIED: office.md OFFC-11 "`initializing` -> arrives by the elevator"] |

Pose names and frame counts are verified from habblaud: `POSE_FRAMES` = stand 2, walk 4, run 4, sit 2, type 4, sleep 2, drink 2, use 2, raise_hand 2, talk 2, stretch 2, read 2, play 2, wait 2, cheer 2, laugh 2, game 2, rps 2, groom 2, sulk 2 (20 poses, 46 frames; render.ts:20-23), `CHAR_W = 24`, `CHAR_H = 34`, `CHAR_AX = 12`, `CHAR_AY = 31` (render.ts:10-13), directions `'down' | 'up' | 'left' | 'right'` (api.ts `Dir`). So a full character sheet is 46 frames x 4 directions = 184 frames of 24x34 px if all directions are rendered `[ASSUMED: direction count; left/right may be mirror-able, not checked]`.

### Pattern 4: Port inventory (what moves, what is rewritten)

Read this session from the habblaud repo (`marmottajr/habblaud`, `main`, license `MIT`, pushed 2026-10-20 [VERIFIED: `gh api repos/marmottajr/habblaud` output `{"license":"MIT","default":"main","pushed":"2026-10-20T06:54:56Z"}`]; `LICENSE` begins `MIT License` / `Copyright (c) 2026 Márcio Junior`).

| Habblaud module (lines) | DOM-free? | Port action |
|---|---|---|
| `art/core/pixbuf.ts` (303), `core/sprite.ts` (61), `core/color.ts` (216) | Yes: pixbuf.ts:1-4 "Buffer de pixels RGBA puro (sem DOM): toda a arte é composta aqui e só no fim vira canvas" | Port as-is after the syntax pass (Pitfall 1). `sprite.ts` imports `TILE` and types from `../api` |
| `art/character/{render 1624, hair 803, appearance 100}.ts` | Yes (grep for `document`, `window`, `localStorage`, `requestAnimationFrame`, `HTMLCanvas`, `getContext` found nothing in these) | Port. In `appearance.ts` drop the editor half (`editorOptions`, `editorConflict`, `fitToOptions`, imports of `tr` from `shared/i18n`); keep `appearanceKey` and the re-export of `appearanceFromSeed` |
| `art/furniture/{index 136, common 751, office 787, kit 465, wall 427}.ts`, `art/surfaces/{floor 292, rug 48, walls 158}.ts`, `theme.ts` (24), `seasonal.ts` (89), `icons.ts` (450) | Yes (same grep) | Port. `furniture/kit.ts` imports `mulberry32` from `shared/hash` |
| `shared/hash.ts`, `shared/appearance.ts`, `shared/world/appearance-flat.ts` | Yes | Port the parts `appearanceFromSeed` needs (`hash32`, `mulberry32`, part/colour tables, `SeedAppearance`). They sit OUTSIDE `client/src/art`, so a port limited to the CONTEXT canonical-ref list would not compile: `character/appearance.ts:4,19`, `furniture/kit.ts:4`, `index.ts:6-7`, `api.ts:25` import them |
| `art/api.ts` (377) | Types yes; `Sprite.canvas: HTMLCanvasElement` (api.ts:115) and `avatarCanvas(...): HTMLCanvasElement` (api.ts:376) no | Port the types (`TILE = 16`, `Dir`, `Pose`, `HeldItem`, `Appearance`, `FurnitureKind`, ...) into `shared/`, drop canvas members |
| `art/pixelfont.ts` (58) | **No**: `pixelText(ctx: CanvasRenderingContext2D, ...)` draws with `ctx.fillRect` (pixelfont.ts:41-48) | Rewrite `pixelText` to write into a `PixelBuf`; reuse the glyph table |
| `art/dynamic.ts` (785) | **No**: canvas `ctx` drawing every frame (`drawScreen(ctx, r, mode, t, seed)`, `drawBoard(ctx, r, items, t)`, `drawWindowView(ctx, r, hour, t, seed)`, `drawClock(ctx, r, date)`) | Do not port as-is. Re-create as static `PixelBuf` variants keyed by state (monitor mode, board progress from `todo` item statuses, sky by hour); `drawBoard`'s input type `{ status: 'pending' \| 'in_progress' \| 'completed' }[]` matches the verified `AgentTaskItem.status`, so a todo wall board is a natural fit |
| `art/index.ts` (333) | **No**: `toCanvas` uses `document.createElement('canvas')` / `ImageData` | Replace with `png.ts` (RGBA -> PNG); keep its `Cache` idea (bounded map that clears on overflow) and its `avatarCanvas` crop+nearest-neighbour upscale loop as the model for integer upscaling |
| `world/layout/{types,core,room,builder,building,corridor,geometry}.ts` (~1,000), `world/path/{astar,grid}.ts` (255), `world/render/daylight.ts` (185), `world/constants.ts` | Yes (no DOM names; imports only `../constants`, `../../art/api`, `../../../../shared/hash`) | Not in the CONTEXT canonical refs but recommended to port into `client/`: it already models `AreaKind = 'reception' \| 'restroom' \| 'cafe' \| 'lounge' \| 'room' \| 'corridor'` (layout/types.ts:5), rooms of 16x12 tiles (`COL_W = 16`, `ROOM_H = 12`, `CORRIDOR_H = 5`, `CORE_COLS = 2`, constants.ts) on both sides of a corridor, A*, and day-phase colour keys (`'madrugada' \| 'amanhecer' \| 'dia' \| 'entardecer' \| 'noite'`, daylight.ts:7). This is the D-04 "rooms along a hallway" and D-06 "common areas" structure |
| `world/render/particles.ts` (216), `world/render/overlay.ts`, `lighting.ts`, `camera.ts`, `input.ts`, `index.ts` | No (`particles.ts` matched the DOM grep; the others are canvas renderers) | Not ported; write RN equivalents (effects via `Animated`) |
| Social/hangout simulation (`client/src/world/social/`, per README "Social life": hangouts TV, video games, ping-pong, kitchen chat, rock-paper-scissors) | Not fetched | `[CITED: habblaud README.md, "How it works": "the hangouts, the personalities and the coins are a simulation in the browser (client/src/world/social/)"]`; read it in Wave 0 before scoping D-06 |

Size: the portable art tree is roughly 6,800 lines (the 8,287-line `art/` tree minus `api.ts` 377, `dynamic.ts` 785, `index.ts` 333) `[calculated from wc -l output this session]`. Habblaud's own test file `art/art.test.ts` (43,877 bytes) exists and is a source of assertions to translate into `node:test` golden checks (MIT).

House style: habblaud comments are in Portuguese; the kit's comments are English one-liners that cite requirement ids (see swarm-map sources). Translate comments while porting, keep a header per file naming the upstream path.

Read-only gate fit: a grep of the portable art, layout, path and daylight modules for the PANL-05 forbidden patterns (`writeFile`, `mkdir`, `rm(`, `.send(`, `.run(`, `.create(`, `.archive(` ...) and for `document`/`window`/`localStorage`/`requestAnimationFrame` returned **no hits** except the string literal `'window'` (a furniture kind), which the existing PANL-06 regex (`\bwindow\.`) does not match [VERIFIED: grep run this session on the fetched files].

### Pattern 5: Image strategy to test in the spike (design, unmeasured)

1. **Static layer per room**: floor, walls, furniture and rug of one room composited server-side into one PNG (native 256x192 px for a 16x12-tile room; at integer scale 3 it is 768x576). Day/night and season are handled by choosing among a few pre-rendered tint levels (quantized, see Pitfall 5) rather than recompositing per frame. One `Image` per room layer keeps the mounted image count near the room count, not the tile count.
2. **Characters as sheet windows**: one sheet per (appearance, set of poses actually used) laid out as a grid of 24x34 frames; the client shows a `View` of one frame size with `overflow: 'hidden'` containing the sheet `Image`, and steps frames by changing a `translateX/translateY` transform. This avoids swapping `source` (which may re-decode) and keeps animation to transform-only like PANL-50 [VERIFIED: tools.md:753 "all continuous motion derives from four shared clocks (flow 1.6 s, pulse 2.2 s, spin 9 s, blink 1 s), animating only transform and opacity"]. Pose durations are 95-1300 ms per frame (render.ts:25-28), so the fastest steps are `run` 95 ms, `type` 120 ms.
3. **Integer pre-scaling on the server** (nearest neighbour, as `avatarCanvas` does) at a small set of zoom levels; the client displays each image at its natural pixel size so correctness does not depend on any host smoothing flag. I could not find a pixelated/nearest-neighbour switch for `Image` in the host: the only `imageRendering` string in the 23 MB web bundle is the SVG attribute table entry `["imageRendering","image-rendering"]` [VERIFIED: grep of `_expo/static/js/web/index-35dfa9cf1abfa4f304ac50232f52b8f4.js`], and `pixelated` does not occur in it. Native `Image` on iOS/Android has no public nearest-neighbour prop `[ASSUMED from React Native docs knowledge]`. At fractional device-pixel ratios the browser may still resample a pre-scaled image; the spike must test the actual DPR of the owner's display.
4. **Characters move with transforms** (`translateX/Y`) from the shared clock, positions from the ported A*; no per-frame React state.

### Anti-Patterns to Avoid

- **Polling the daemon from the server** (swarm-map's 1 s `swarm.snapshot` poll, PANL-07): contradicts D-03 "prefer subscriptions".
- **One `Image` per tile or per character frame swap**: image count and decode churn scale with room area and agent count.
- **Copying habblaud source verbatim**: Portuguese comments, non-erasable syntax, extensionless imports and canvas code all fail this repo's gates.
- **Reading project config to recover context thresholds, tool classes or git data** (`rotate.ts`, `kit-defaults.json`, name heuristics): D-03.
- **Putting art code in `shared/`**: it would be pulled into the client bundle and the build rejects Node builtins there.
- **Free-form agent text into URIs or styles**: titles/labels/timeline text are untrusted data; show them only as `Text` content.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pixel art (characters, 14 hair styles, furniture, floors, walls, seasonal props, icons) | New sprites | Port habblaud `PixelBuf` modules (MIT) | 6,800 lines of tuned, deterministic art; D-01 |
| Deterministic look per agent | Own hash/appearance picker | `hash32` + `appearanceFromSeed(seed, opts)` (hash of the agent id) | Same agent looks the same everywhere (CONTEXT specifics) |
| Path finding in rooms | Own A* | Port `world/path/{astar,grid}.ts` | Already tied to the layout's `BLOCKED/FREE/SEAT` grid |
| Day phase interpolation | Own colour curve | Port `world/render/daylight.ts` KEYS table and `Ambient` | Pure and tested upstream `[ASSUMED: tests exist, `daylight.test.ts` listed 7,530 bytes]` |
| PNG container | A PNG package | `node:zlib` + 40 lines (signature, IHDR, IDAT, IEND, CRC32) | No dependency, audit not available |
| Wave progress from `.planning` | New reader | Carry `wave-link.ts` (+ `frontmatter.ts` byte copy) as OFFC-18 requires | 127 lines with realpath containment (PANL-13 discipline), mtime cache, tests exist; the entry point is fed ids per Pattern 1b |
| Frame clock | Per-sprite timers | Four-or-so shared clocks, `Animated` transform/opacity only (PANL-50 pattern from swarm-map `client/anim.ts`) | Bounded animated values regardless of agent count |
| RPC contracts and failure envelopes | Ad-hoc JSON | `defineRpc` + zod, `{ok:false, code, message, directory}` (PANL-03/04) | Existing, tested pattern; `defineRpc` verified in `rpc.d.ts:14` |

**Key insight:** every expensive thing here (art, layout, A*, daylight) already exists as pure TypeScript; the unsolved part is how the host paints it. Spend the first wave on that, not on re-deriving art.

## Runtime State Inventory

This phase retires a plugin (`swarm-map`) and introduces another, so the retirement is a rename-class change.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None: swarm-map keeps no store; its event log is in memory and "a plugin restart starts a new epoch" [VERIFIED: swarm-map/server/events.ts:2-3] | None |
| Live service config | Paseo daemon plugin registry. `paseo plugin ls` on this machine lists `backlog-plugin` and `swarm-plugin` from `C:\Users\fish\Desktop\paseo-harness-kit\paseo\plugins\...` and **no** `swarm-map` or `planning-panel` entry [VERIFIED: command output this session]. A machine that ran `kit machine apply --enable-paseo-plugins` would have a `plugins["swarm-map"]` entry with `source: directory` pointing at the kit folder (kit/machine/plugins.mjs:`patchPlugins`) | Code edit: `KIT_PLUGIN_FOLDERS = ["planning-panel", "office"]`. Data migration: none in v1 (D-01 of the project: no migration code); the README/CHANGELOG should tell an operator to run `paseo plugin ls` and remove a stale `swarm-map` entry. Note the owner's other plugin is named `swarm-plugin`, a different thing (do not touch) |
| OS-registered state | None found: plugins are registered in the Paseo config, not in Task Scheduler/launchd | None |
| Secrets/env vars | None: swarm-map reads kit defaults JSON (`server/kit-defaults.json`) and project config files, no secrets | Delete with the plugin (D-03) |
| Build artifacts | `plugins/swarm-map/node_modules` (present, with `tsc` in `.bin`), `package-lock.json`, `plugins/.gitignore` containing `node_modules/` [VERIFIED: file read and directory listing]; `plugins/office` needs its own `npm install --ignore-scripts` + lock | Remove the folder; create `office` toolchain; `apply --enable-paseo-plugins` runs `npm ci` when `node_modules` is missing (tests/machine/apply.test.mjs:241 and kit/machine/plugins.mjs `needsDeps`) |

### Retirement inventory (files that name `swarm-map`, found by grep this session)

`kit/machine/plugins.mjs:7` (`KIT_PLUGIN_FOLDERS`), `plugins/smoke.mjs` (lines 30 `for (const plugin of ["planning-panel", "swarm-map"])` and 84 reading `swarm-map/node_modules/@getpaseo/plugin/dist/server/lifecycle.d.ts`), `README.md:151,164`, `tests/machine/apply.test.mjs:235-267`, `tests/machine/check.test.mjs:89`, `tests/ui/plugin-gates.test.mjs` (`IDS`, the PANL-02 `want` map, the PANL-57 `named` map with 6 swarm-map entries, the PANL-14 byte-copy test of `frontmatter.ts`), five test files `tests/ui/swarm-{client,describe,ledger-events,rotate-wave,snapshot}.test.mjs`, and `plugins/swarm-map/` (3,569 lines in source + tests above). `.planning/integration/*`, `.planning/intel/*` and `.planning/requirements/tools.md` also mention it; they are historical records and the superseded PANL entries must be marked in the new `office.md`, not deleted. `tests/ui/fake-paseo.mjs` (105 lines) is reusable and needs `subscribe`/`list({subscribe})` stubs added.

Re-check in the refresh: a grep for `swarm-map` over the whole repo, excluding `.planning/`, `CHANGELOG.md`, the plugin folder, `node_modules` and `.git`, matched exactly 11 files (`kit/machine/plugins.mjs`, `plugins/smoke.mjs`, `README.md`, `tests/machine/{apply,check}.test.mjs`, `tests/ui/plugin-gates.test.mjs`, `tests/ui/swarm-{client,describe,ledger-events,rotate-wave,snapshot}.test.mjs`), all named above, so the inventory covers the OFFC-02 acceptance ("no `swarm-map` outside `.planning/` and `CHANGELOG.md`") once the folder itself is deleted.

## Common Pitfalls

### Pitfall 1: The port does not compile or load under this repo's TypeScript rules
**What goes wrong:** `tsc --noEmit` and the tests (which import `.ts` directly under Node 24) reject the copied source.
**Why it happens:** `plugins/planning-panel/tsconfig.json` sets `"erasableSyntaxOnly": true`, `"allowImportingTsExtensions": true`, `"verbatimModuleSyntax": true` [VERIFIED: file read this session]; swarm-map's tsconfig was not opened and is expected to match `[ASSUMED]`; `office` copies one of them. Habblaud's `PixelBuf` declares `constructor(\n    readonly w: number,\n    readonly h: number,\n  )` (pixbuf.ts:18-21), a parameter property, which is not erasable syntax; its relative imports have no `.ts` extension (`from './color'`). `Uint8ClampedArray<ArrayBuffer>` needs a recent TS.
**How to avoid:** a mechanical pass (explicit fields + assignment in constructors, `.ts` extensions) plus a gate that greps `server/art` for `constructor(` parameter properties, `enum`, `namespace`. Run `tsc --noEmit` in the plugin as in PANL-01.
**Warning signs:** TS error about syntax not allowed under `erasableSyntaxOnly` `[ASSUMED: error wording]`; `ERR_MODULE_NOT_FOUND` in node tests.

### Pitfall 2: Blurry pixel art
**What goes wrong:** sprites look smoothed when scaled; the D-12 gate fails on crispness.
**Why it happens:** no nearest-neighbour switch was found in the host's `Image` (see Pattern 5); fractional DPR resamples even integer-scaled PNGs.
**How to avoid:** integer pre-scale on the server; display at natural size; add a 1-px ruler sprite to the spike; test at the owner's real display scale.
**Warning signs:** intermediate colours on edges in a screenshot of the ruler sprite.

### Pitfall 3: Decode churn and unstable sources
**What goes wrong:** frame stepping stutters or memory climbs.
**Why it happens:** creating `{ uri }` objects on each render or swapping `source` per frame can make the host re-decode large data URIs `[ASSUMED: implementation-dependent]`.
**How to avoid:** memoize one `source` object per key; step frames with transforms over a stable sheet image; drop sheets of agents that left.

### Pitfall 4: Unbounded subscriptions and renders
**What goes wrong:** tens of agents each with a timeline subscription and a React state update per frame.
**How to avoid:** timeline subscriptions only for `running` agents and the selected one, under a named cap; animation clocks shared; position updates through `Animated` values, not state; coalesce `agent_update` bursts to one state commit per animation tick.

### Pitfall 5: Day/night tint
**What goes wrong:** a flat translucent overlay does not look like multiply lighting; `mixBlendMode` may be unsupported on some hosts `[ASSUMED]`.
**How to avoid:** pre-render a small fixed number of tint levels of each static layer on the server (cache key includes level and season) and cross-fade two `Image`s with opacity; characters get an overlay tint or the same variant approach. Measure payload before committing to the level count.

### Pitfall 6: Event-loop stalls in the plugin process
**What goes wrong:** rendering a 184-frame sheet or compositing a room synchronously blocks other RPCs.
**How to avoid:** render lazily per requested key, one sheet per RPC call, LRU with a byte cap, bounded keys per call (named constants); `[ASSUMED]` that the plugin runs in its own process (host files `plugin-process.js`, `internal-child.js` exist) so a stall hurts only this plugin.

### Pitfall 7: Stale state after reconnect or reload
**What goes wrong:** characters of archived agents stay, or the building freezes after a daemon restart.
**How to avoid:** handle `kind: "remove"` and `archivedAt`; re-seed from `list`/`refetch` on `subscription_restored` and `replacement`; every subscription's unsubscribe goes into the disposer (PANL-02 acceptance: disposer leaves zero subscriptions).

### Pitfall 8: Parent not in the listed set
**What goes wrong:** a child whose parent is closed or filtered out has nowhere to walk.
**How to avoid:** swarm-map fetched missing parents with `agents.ref(id).refresh()` (snapshot.ts:97-109); keep that read-only call, otherwise seat the child at the cluster's main desk.

### Pitfall 9: Text-matching tests and Windows line endings
**What goes wrong:** gates that match source text fail on CRLF checkouts. The last three commits fixed exactly this [VERIFIED: git log `Make three more text-matching tests independent of the checkout's line endings`].
**How to avoid:** new source-text gates normalize `\r\n`; golden checks compare PNG bytes or hashes of RGBA buffers, not source text.

## Code Examples

### PNG encoding with `node:zlib` (server, no package)

```ts
// Sketch for plugins/office/server/png.ts; the format is the PNG spec: 8-byte signature, IHDR, IDAT (zlib), IEND, CRC32 per chunk.
// Source: PNG specification (w3.org/TR/png) and node:zlib docs  [ASSUMED: written from knowledge, not run this session]
import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

// rgba: w*h*4 bytes (PixelBuf.data); scale: integer >= 1, nearest neighbour.
export function encodePng(rgba: Uint8ClampedArray, w: number, h: number, scale = 1): Buffer {
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H); // filter byte 0 per row
  for (let y = 0; y < H; y += 1) {
    const row = y * (W * 4 + 1);
    for (let x = 0; x < W; x += 1) {
      const s = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4;
      raw.set(rgba.subarray(s, s + 4), row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// crc32: node:zlib exposes crc32() in Node 24 [ASSUMED]; otherwise a 256-entry table (about 10 lines).
```

`data:image/png;base64,${png.toString("base64")}` is the `Image` `source.uri`. The upscale loop mirrors habblaud's `avatarCanvas` nearest-neighbour copy (index.ts:111-130, read this session).

### Client subscription seed (sketch)

```ts
// Source: shapes quoted from @getpaseo/client dist/index.d.ts:302-316, 127-148, 237-257 (read this session); handler wiring is [ASSUMED] until the spike runs it
const paseo = usePaseo();
const { subscription } = await paseo.agents.list({ filter: { includeArchived: false }, subscribe: {} });
const offAgents = paseo.agents.subscribe((u) => { if (u.kind === "upsert") store.upsert(u.agent); else store.remove(u /* id field not read */); });
const offWs = paseo.workspaces.subscribe((u) => store.workspace(u));
const offProj = paseo.projects.subscribe((u) => store.project(u));
// per running agent only, bounded:
const sub = paseo.agents.ref(id).timeline.subscribe((e) => store.timeline(id, e));
await sub.ready; // documented requirement before work that must be observed
```

The `remove` payload's id field and the exact `workspace_update` / `project.update` payload shapes were not read; the executor must read them from `protocol/dist/messages.d.ts` before coding the reducer.

### Server RPC registration (existing pattern)

```ts
// Source: plugins/swarm-map/index.server.ts:11-25 (first run); the wave handler follows Pattern 1b and is [ASSUMED] until written
export default function contribute(server: PluginServerContext) {
  server.handle(spritesRpc, (input) => sprites.render(input)); // art needs no paseo
  server.handle(waveRpc, async (input, { paseo }) => waves.link(await workspaceDir(paseo, input.workspaceId), input.runId)); // ids in, directory resolved here
  return () => { /* unsubscribe every hook */ };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| swarm-map: server polls `swarm.snapshot` every 1 s (PANL-07) | Client subscribes to `PaseoApi` streams; RPC only for sprites and wave link | This phase (D-03) | Lower latency and no snapshot payload cap; needs reconnect handling |
| `client.addSurface` / `addSidebarItem` | `addScreen` / `addSidebarHeaderItem` | Marked `@deprecated` in 0.11.2 [VERIFIED: client/contracts.d.ts:100-103] | `office` should register with the new calls; swarm-map and planning-panel still use the old ones (planning-panel was not re-checked) |
| Circle-and-ring SVG-free map | Pixel-art building from PNGs | This phase | New rendering risk (spike) |

**Deprecated/outdated:** swarm-map's `rotate.ts` (config-file reads), `kit-defaults.json`, tool-name heuristics (`describe.ts`, PANL-34/36), file-ledger/handoff-by-file (`files.ts`, PANL-37..39, 60: they parse file paths out of tool inputs); all conflict with D-03 and are not carried.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `zlib.crc32` exists in Node 24 | Standard Stack, Code Examples | None: a table CRC replaces it |
| A2 | `projects.subscribe` also needs `observeEvents(["project.update"])` to receive updates | Pattern 1 | Project renames/adds not pushed; call both and check in spike |
| A3 | `@getpaseo/protocol` would be bundled (not host-external) if imported by the plugin | Pattern 1 | Bundle size; define the label constant locally anyway |
| A4 | Host `Image` has no nearest-neighbour switch on any platform; fractional DPR may resample integer-scaled PNGs | Pattern 5, Pitfall 2 | If a switch exists the scaling plan simplifies; if resampling is visible the whole art approach fails the gate |
| A5 | Re-using one stable `source` object avoids re-decode; sheet-window stepping with transforms is cheaper than source swaps | Pitfall 3, Pattern 5 | Frame rate budget missed; fall back to technique (3) or fewer animated characters |
| A6 | Tint levels as pre-rendered variants + opacity cross-fade is acceptable; `mixBlendMode` unreliable | Pitfall 5 | More payload than planned |
| A7 | The plugin server runs in its own process, so a long synchronous render stalls only this plugin | Pitfall 6 | RPC latency for other callers |
| A8 | 184 frames per character sheet (46 frames x 4 directions); left/right may mirror | Pattern 3 | Sheet size/payload estimate off by about 2x |
| A9 | Which pose is the "default seated work pose" of OFFC-11: recommended `type`; the mapping table itself is ratified | Pattern 3 | Cosmetic; owner may change |
| A10 | Context warning level constant = 60 (kit default seen in the PHCL-16 text) | Pattern 2 | Cosmetic |
| A11 | PNG sizes: one character sheet in the 10-30 KB range, one room layer in the 10-20 KB range after deflate | Spike | Unmeasured guess; the spike records real bytes |
| A12 | (Resolved, no longer assumed) one host, desktop only: OFFC-24 | Open Questions | None |
| A13 | (Resolved as a decision, not a fact) `unknown` tool details map to the default pose: OFFC-05, OFFC-11. How often the kit's own tools arrive as `unknown` stays unobserved and only informs presentation | Open Questions | None for correctness |
| A14 | The error text for non-erasable syntax and `erasableSyntaxOnly` rejecting parameter properties | Pitfall 1 | Wording only |
| A15 | Directions 'down','up','left','right' all needed for characters | Pattern 3 | Payload |
| A16 | The client can learn that a wave finished by re-asking `office.wave` on pushed updates of agents carrying `harness.run`, debounced, without a timer | Pattern 1b | Effects late or missed; fall back to a coarse effect from agent state only |
| A17 | A child "finishes a turn" (OFFC-12) when its pushed status goes `running` -> `idle` or its `attentionReason` becomes `finished` | Port inventory / OFFC-12 | Handoff fires too often or never; verify against real `agent_update` sequences in Wave 0 |
| A18 | Habblaud's layout kinds `reception` and `cafe` correspond to OFFC-13's lobby and kitchen, and the layout/social modules contain the elevators and hangout spots the owner described (only `layout/types.ts:5` and the README line were read) | Port inventory | More layout code to write than estimated; read `layout/building.ts` and `world/social/` first in Wave 0 |

## Open Questions

### Resolved by the ratified `office.md`

| First-report question | Resolution | Source |
|-----------------------|------------|--------|
| 1. Who writes `office.md`, and the OFFC ids | The file exists with OFFC-01..25; plans cite those ids. Its header says the owner ratifies it when the plan is approved, so the ids are stable but the ratification is still pending | office.md:1-8 |
| 2. Is the `.planning` wave link an allowed read under D-03 | Yes, as the single named read-only exception; the PANL-05 gate names that one module as the only reader | OFFC-18, OFFC-05 |
| 3. Tool-kind classification without heuristics | `unknown` (and every non-listed detail) maps to the default work pose and nothing else; no name table | OFFC-05, OFFC-11 |
| 4. Mobile hosts | Out of v1, reported as untested | OFFC-24 |
| 5. Multi-host | Out of v1; the plugin shows the host the screen is opened on | OFFC-24 |
| 7. Upstream commit pin | Each ported file header and `NOTICE.md` name the upstream path and commit SHA; the executor resolves and records it (for example `gh api repos/marmottajr/habblaud/commits/main --jq .sha`; not run in this research) | OFFC-07, OFFC-20 |

### Still open

1. **Numeric gate thresholds** (was Question 6; deliberately left for the planner).
   - What we know: OFFC-10 names the dimensions (median frame cadence, animated characters at the cap, bytes on first load, bytes at steady state, the OFFC-09 crispness check) and requires each threshold to be written down before measuring and never edited afterwards.
   - What's unclear: the numbers. This research does not propose any, so none can be mistaken for a finding.
   - Recommendation: the planner fixes the table, dated, in Wave 0 before the first measurement; the scene it applies to includes the common areas and a few walking characters (OFFC-10, D-12).

2. **Event sequences for the handoff and wave triggers.**
   - What we know: A16 and A17 describe how "child finished a turn" and "wave finished" could be detected from pushed updates alone.
   - What's unclear: the real order and frequency of `agent_update` events for a kit run.
   - Recommendation: Wave 0 logs one real orchestrated run's updates and the planner locks the detection rule from that log.

3. **Payload shapes not yet read.** The `remove` payload's id field and the `workspace_update` / `project.update` bodies were not read in either run; the executor reads them from `protocol/dist/messages.d.ts` before coding the reducer (OFFC-05).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | server build/tests, type stripping | ✓ | v24.19.0 (`node --version`) | - |
| Paseo CLI / daemon | `paseo plugin install|reload|ls`, spike | ✓ | 0.11.2 (`paseo --version`); the plugin gates assert `requirements.paseo` equals `TESTED_PASEO_CLI` (value not read here) | - |
| Paseo desktop app (Electron + web bundle) | spike visual gate | ✓ | at `%LOCALAPPDATA%\Programs\Paseo` (resources/app-dist present) | - |
| `gh` CLI + network | fetching habblaud for the port | ✓ (used this session) | - | clone/zip into an empty temp dir |
| npm registry access | `npm install --ignore-scripts` for `plugins/office` lock file | not probed | - | copy `plugins/swarm-map/package-lock.json` as the starting lock (same devDependencies) |
| TypeScript compiler (`tsc`) | PANL-01 gate | ✓ in `plugins/swarm-map/node_modules` and `planning-panel/node_modules` | ^5.9.3 pinned | install in `plugins/office` |
| Mobile Paseo client | spike on ios/android | not probed | - | none needed: desktop-only gate (OFFC-24) |

**Missing dependencies with no fallback:** none found.
**Missing dependencies with fallback:** npm registry (not probed), mobile client (not probed).
Note: the machine's registered plugins are `backlog-plugin` and `swarm-plugin` from the owner's other checkout [VERIFIED: `paseo plugin ls`]; the kit's own `planning-panel` and `swarm-map` are not registered here, so the spike must register `office` with `paseo plugin install` (or `kit machine apply --enable-paseo-plugins`) in the owner's daemon, which changes the owner's Paseo config: an owner-facing action the orchestrator must confirm.

## Suggested wave outline (for the planner; the spike gate decides whether later waves run)

0. **Spike (OFFC-10, D-12, go/no-go):** minimal `plugins/office` (OFFC-01 manifest, toolchain, entries) + ported `PixelBuf` core + `png.ts` + one `office.sprites` RPC (OFFC-07 core part, OFFC-08). The measured scene includes the hallway, one project room and static lobby, kitchen and lounge layers, with characters up to the cap, a few of them walking by transform; plus a 1-px ruler sprite (OFFC-09) and counters for cadence and bytes. Thresholds are fixed and dated first (Open Question 1); results go to `07-SPIKE.md` with the host and display scale and the OFFC-24 statement "desktop only; mobile not tested; one host". Fail -> stop and report to the owner.
1. **Foundation:** full art port with English comments, syntax pass and golden tests (OFFC-07, OFFC-22); `shared/` contracts and failure envelopes (OFFC-03); licence files (OFFC-20); retire `swarm-map` everywhere in the inventory (OFFC-02, OFFC-25); update gates (`IDS`, PANL-02 `want`, PANL-57 `named`; keep the PANL-14 byte-copy test because `frontmatter.ts` is carried) (OFFC-04, OFFC-22); strings table skeleton (OFFC-19).
2. **Model and store:** subscriptions, reducer, caps and "+N agents", parent link, reconnect handling, one-RPC-per-key client cache (OFFC-05, OFFC-06, OFFC-08).
3. **Scene:** layout/path port, rooms along the hallway, clusters per workspace with status sign/light and `diffStat`, characters with the pose table, handoff walk (OFFC-06, OFFC-11, OFFC-12).
4. **Panels:** sidebar tree with camera jump, top bar counters and empty usage slot, agent drawer, extra API signals (OFFC-14, OFFC-15, OFFC-16, OFFC-21, OFFC-19).
5. **Atmosphere and links:** day/night, seasons, wave/phase completion effects with the id-based wave RPC (OFFC-17, OFFC-18).
6. **Common areas, idle wandering, hangouts** (only after a recorded pass, OFFC-13), docs, smoke script, CHANGELOG with owner approval and date (OFFC-23, HARN-15).

## Validation Architecture

`workflow.nyquist_validation` could not be read (settings come from the harness config, not a config.json under `.planning`); treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` on Node v24.19.0; tests are `.mjs` that import the plugin's `.ts` sources directly (Node type stripping) [VERIFIED: package.json `"test": "node --test \"tests/**/*.test.mjs\""`, `engines.node >=24`; tests/ui/plugin-gates.test.mjs imports and reads plugin sources] |
| Config file | none (`package.json` script) |
| Quick run command | `node --test tests/ui/office-*.test.mjs tests/ui/plugin-gates.test.mjs` |
| Full suite command | `npm test` (`node --test "tests/**/*.test.mjs"`) |
| Baseline | 905 of 908 passed, 2 skipped, 1 failed (FTOL-15, flaky under load, passes alone) per the owner note in ROADMAP.md [VERIFIED: ROADMAP.md:9] |

### Phase Requirements -> Test Map (ratified ids)
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OFFC-01 | manifest id = folder, tested Paseo version, `files` exist, lock file, `tsc --noEmit`, host `compilePlugin` + `evaluateBundle` | unit + spawn tsc | `node --test tests/ui/plugin-gates.test.mjs` | ✅ exists, edit for `office` |
| OFFC-02 | no `swarm-map` outside `.planning/` and `CHANGELOG.md`; `KIT_PLUGIN_FOLDERS` = planning-panel + office; apply registers exactly those | unit + grep | `node --test tests/machine/apply.test.mjs tests/machine/check.test.mjs tests/ui/plugin-gates.test.mjs` | ✅ exist, edit |
| OFFC-03 | every RPC name matches `^[a-z][a-z0-9._-]*$`; outputs parse; malformed, oversized and throwing inputs give `ok:false`; `shared/` has no Node or React import; `office.wave` input has no path | unit | `node --test tests/ui/office-server.test.mjs` | ❌ Wave 1 |
| OFFC-04 | forbidden write/spawn/send/archive/child_process absent; client has no DOM/canvas/SVG; fixture with each pattern fails the gate | grep gate | `node --test tests/ui/plugin-gates.test.mjs` | ✅ edit (add `office`, `Image`; keep every ban) |
| OFFC-05 | reducer applies `upsert`/`remove`; re-seed on restore; zero live subscriptions after disposer; no `setInterval` daemon call; agent without labels renders | unit with extended fake | `node --test tests/ui/office-model.test.mjs` | ❌ Wave 2 |
| OFFC-06 | fixture of 3 projects, 4 workspaces, 20 agents gives the expected tree; surplus group N exact; all five workspace statuses | unit | `node --test tests/ui/office-model.test.mjs` | ❌ Wave 2 |
| OFFC-07 | `tsc --noEmit`; no parameter-property constructor/`enum`/`namespace` in `server/art/`; same seed byte-identical, different seeds differ; golden hashes; no excluded module name | unit + grep | `node --test tests/ui/office-art.test.mjs` | ❌ Wave 0/1 |
| OFFC-08 | PNG signature and CRCs valid, inflates to input RGBA; exact 3x upscale; LRU evicts at byte cap; repeated key = one RPC; over-cap key list `ok:false` | unit | `node --test tests/ui/office-art.test.mjs tests/ui/office-server.test.mjs tests/ui/office-model.test.mjs` | ❌ Wave 0/1/2 |
| OFFC-09 | zoom list is a named constant of integers; crispness of the ruler sprite at each level | unit + manual (desktop app) | `node --test tests/ui/office-art.test.mjs`; screenshots in `07-SPIKE.md` | ❌ Wave 0 |
| OFFC-10 | `07-SPIKE.md` has the dated threshold table, measured values, host, display scale, verdict; a check fails if the verdict file is missing or says fail | manual + file check | review `07-SPIKE.md`; `node --test tests/ui/plugin-gates.test.mjs` | ❌ Wave 0 |
| OFFC-11 | table test over status x attention x tool-detail type including `unknown`; same agent id gives same appearance | table test | `node --test tests/ui/office-poses.test.mjs` | ❌ Wave 3 |
| OFFC-12 | A* on fixture room: clear, blocked, no-parent; a finished child turn enqueues exactly one handoff | unit | `node --test tests/ui/office-layout.test.mjs tests/ui/office-model.test.mjs` | ❌ Wave 3 |
| OFFC-13 | building has four area kinds, every area reachable from every room; wander picks only free spots; spike verdict covers common areas | unit + manual | `node --test tests/ui/office-layout.test.mjs`; review `07-SPIKE.md` | ❌ Wave 6 |
| OFFC-14 | each tree node maps to a camera target inside the bounds; no agent-provided string in a `uri` or style | unit + grep | `node --test tests/ui/office-client.test.mjs` | ❌ Wave 4 |
| OFFC-15 | drawer view-model: todos in order with statuses, children from the parent label, last error; empty todo section when no item | unit | `node --test tests/ui/office-client.test.mjs` | ❌ Wave 4 |
| OFFC-16 | counters and percentage from fixtures, missing max shows nothing; no `listUsage` in `plugins/office/`; empty slot renders | unit + grep | `node --test tests/ui/office-client.test.mjs` | ❌ Wave 4 |
| OFFC-17 | day-phase interpolation at fixed hours; season at fixed dates; variant count is a named constant | unit | `node --test tests/ui/office-atmosphere.test.mjs` | ❌ Wave 5 |
| OFFC-18 | migrated wave-link fixtures (2 of 4 plans summarised) give the same counts; runId with `..` or a separator rejected; escaping symlink refused; gate names this module as the only reader | unit + grep | `node --test tests/ui/office-wave.test.mjs tests/ui/plugin-gates.test.mjs` | ❌ Wave 5 (fixtures exist in `tests/ui/swarm-rotate-wave.test.mjs`) |
| OFFC-19 | no JSX text literal outside `client/strings.ts`; every used key exists | grep gate | `node --test tests/ui/plugin-gates.test.mjs` | ❌ Wave 1/4 |
| OFFC-20 | `LICENSES/habblaud-MIT.txt` begins `MIT License` with upstream copyright line; `NOTICE.md` names habblaud and the SHA; every `server/art/` file has a header with an upstream path | unit (file check) | `node --test tests/ui/plugin-gates.test.mjs` | ❌ Wave 1 |
| OFFC-21 | each added signal has a view-model test and an absent-value test; no new API call outside the read-only set | unit | `node --test tests/ui/office-client.test.mjs` | ❌ Wave 4 |
| OFFC-22 | gate fails when a pure module is not exercised by a test; suite green apart from the FTOL-15 flake | unit | `node --test tests/ui/plugin-gates.test.mjs`; `npm test` | ✅ edit `named` map |
| OFFC-23 | smoke script exits 0 against the fake with `office` loaded; CHANGELOG entry present after owner approval, dated | unit + manual | `plugins/smoke.mjs` against the fake [UNVERIFIED: how the repo's tests invoke it was not read]; owner approval | ✅ edit |
| OFFC-24 | `07-SPIKE.md` and the phase verification state "desktop only; mobile not tested; one host" | manual | review `07-SPIKE.md` | ❌ Wave 0 |
| OFFC-25 | each superseded id listed once in the ledger; `tools.md` unchanged | unit (file check) | `node --test tests/ui/plugin-gates.test.mjs` | ❌ Wave 1 |

Manual-only justification: whether the host `Image` draws crisp, cheap pixel art is a property of the running Paseo app; no offline test can observe it. The deployed-loading-path test (host `compilePlugin` + `evaluateBundle`, PANL-02) already compiles plugins offline with the installed Paseo compiler and skips when the CLI version differs [VERIFIED: tests/ui/plugin-gates.test.mjs hostCompiler and the PANL-02 test]; keep it for `office`, and it will additionally prove `node:zlib` and the ported modules bundle.

### Sampling Rate
- **Per task commit:** quick run command above.
- **Per wave merge:** `npm test`.
- **Phase gate:** full suite green (baseline flake FTOL-15 excepted and re-run alone) plus the recorded spike result before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/ui/office-art.test.mjs` - PNG validity, determinism, golden hashes (OFFC-06).
- [ ] Extend `tests/ui/fake-paseo.mjs` with `agents.list({subscribe})`, `agents.subscribe`, `workspaces.subscribe`, `projects.subscribe`, `timeline.subscribe` stubs and a `fakeHost` for the client registration check.
- [ ] `plugins/office/` skeleton + lock file so `tsc --noEmit` runs.
- [ ] A pre-fixed, dated numeric threshold table for the spike gate (Open Question 1; the planner owns it).

## Security Domain

`security_enforcement` could not be read from a config file; treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Plugin uses the host's already-authenticated `PaseoApi`; it handles no credentials |
| V3 Session Management | no | - |
| V4 Access Control | yes (read-only) | PANL-05 grep gate extended to `office`; D-09: no write SDK calls, no `child_process`, no fs write API |
| V5 Input Validation | yes | zod schemas for every RPC (`defineRpc`); sprite requests are an enumerated spec (kind, seed, pose set, scale from a fixed list), never a path or free text; numeric fields bounded by named constants |
| V6 Cryptography | no | CRC32 in PNG is integrity framing, not security |
| V12 Files and Resources | yes (wave link only) | `realpath` containment inside `.planning/phases` and `_workspace/_runs`, `runId` rejects separators and `..`, mtime-cached reads, no writes (existing `wave-link.ts` logic) |
| V14 Configuration / dependencies | yes | no new packages; MIT notice for ported code |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal through `harness.run` label or `args.json` `phaseDir` | Tampering / Info disclosure | Keep `wave-link.ts` containment: `isInside`, `realInside`, runId regex `/[\\/]\|^\.\.?$/` [VERIFIED: wave-link.ts:36-49, 79] |
| RPC input carrying a filesystem path | Tampering / Info disclosure | OFFC-03: inputs are enumerated specs or bounded ids; `office.wave` takes `{workspaceId, runId}` and resolves the directory server-side (Pattern 1b) |
| Resource exhaustion by many agents, sprite keys or timeline subscriptions | DoS | Named caps, LRU with byte limit, bounded keys per RPC, subscription cap, "+N agents" |
| Untrusted agent titles/labels/timeline text shown in the UI | Spoofing / Tampering | Render only as `Text`; no URI or style built from them; this is also an untrusted-input boundary for prompt text a drawer might display |
| Info disclosure of absolute paths or prompts in the drawer | Info disclosure | Show only what D-05 lists (activity, todos, children, last error); no file contents |
| Stale plugin entry after retiring `swarm-map` | Tampering (config drift) | README/CHANGELOG note; `kit machine check` reports a missing folder as a note (tests/machine/check.test.mjs:89) |
| Licence non-compliance of ported code | Legal | `LICENSES/habblaud-MIT.txt` + `NOTICE.md` (existing files `LICENSES/gsd-core-MIT.txt`, `harness-Apache-2.0.txt`, `NOTICE.md` [VERIFIED: directory listing]) |

## Sources

### Primary (HIGH confidence: files opened this session)
- `.planning/phases/07-office/07-CONTEXT.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` (grep), `.planning/requirements/tools.md` (PANL-01..10, 33..37, 45..61, lines 440-830), `.planning/requirements/` listing.
- Read in the refresh run: `.planning/requirements/office.md` (whole file, OFFC-01..25), `plugins/swarm-map/server/wave-link.ts` (whole file), `plugins/swarm-map/server/snapshot.ts:100-139`, `@getpaseo/plugin` `dist/server/contracts.d.ts` (grep: `paseo: PaseoApi;` at line 9), and a repo-wide grep for `swarm-map` (11 files outside `.planning/`, `CHANGELOG.md` and the plugin folder).
- `@getpaseo/plugin` 0.11.2 `dist/contracts.d.ts`, `client/{contracts,react-native,ui,index,paseo-context,client-state,host}.d.ts`, `server/{contracts,index,lifecycle}.d.ts`, `rpc.d.ts`.
- `@getpaseo/client` 0.11.2 `dist/index.d.ts` and `daemon-client.d.ts` (observe/fetch signatures); `@getpaseo/protocol` `dist/{messages,agent-types,agent-labels}.d.ts` (targeted ranges).
- Installed Paseo CLI plugin compiler: `@getpaseo/server/dist/server/server/plugins/{compiler,compiler-imports,plugin-sdk-specifiers}.js`; installed desktop app web bundle (grep for module allow-list and image rendering).
- Repo: `plugins/swarm-map/{index.server.ts,package.json,paseo-plugin.json,server/{events,wave-link,snapshot}.ts,client/register.ts,index.client.tsx}`, `plugins/planning-panel/{package.json,tsconfig.json}`, `plugins/smoke.mjs`, `kit/machine/plugins.mjs`, `tests/ui/{plugin-gates.test.mjs,fake-paseo.mjs}`, `package.json`.
- habblaud `marmottajr/habblaud` @ `main` (MIT) fetched with `gh api`: `client/src/art/**` (core, character, furniture, surfaces, theme, seasonal, icons, pixelfont, api, dynamic, index), `shared/{hash,appearance,world/appearance-flat}.ts`, `client/src/world/{constants,layout/*,path/*,render/daylight,particles}.ts`, `README.md` (states, themes, day/night, how it works), tree listing.

### Secondary (MEDIUM confidence)
- None used.

### Tertiary (LOW confidence / `[ASSUMED]`)
- PNG format details, `zlib.crc32` availability, React Native `Image` behaviours (no nearest-neighbour prop, decode behaviour, `mixBlendMode` support), `erasableSyntaxOnly` error wording. No web search, Context7 or registry query was made in this run (the research provider cache and package audit are not installed in this kit).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, copied from the repo's own pinned plugins and read from the installed SDK.
- Data flow and API shapes: HIGH for types and subscription methods; MEDIUM for runtime payload details (`remove`, `workspace_update`, `project.update` bodies not read).
- Architecture (client push, server render, host constraints): HIGH, from the compiler source and SDK types.
- Port inventory: HIGH for the DOM-free list (read and grepped); MEDIUM for effort (Portuguese comments, syntax pass sizes not measured).
- Rendering performance and crispness: LOW by design (nothing measured); decided by the Wave 0 spike.
- Pitfalls: MEDIUM.

**Research date:** 2026-10-21 (first report); refreshed the same day against the ratified `office.md`
**Valid until:** 2026-11-04 (14 days: Paseo 0.11.x and habblaud `main` both move quickly; re-verify the SDK ranges if Paseo is upgraded)

<!-- gsd:research-complete c5cd8a681ff06662f2311f6201478b1e252d9f7a6bfb607462da9de8fe8492d3 -->

