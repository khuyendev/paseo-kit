# Requirements: office (M13 ui, milestone v1.1)

**Defined:** 2026-10-21
**Scope:** group `OFFC` of Phase 7 (Office). Proposed by the orchestrating session from `07-CONTEXT.md` (D-01..D-12, locked) and `07-RESEARCH.md`; ratified by the owner when the plan is approved.
**Test kinds:** `offline` = kit test under `tests/` with fakes (Paseo SDK fake, temp dirs with spaces), never the owner's live config or daemon (INV-57). `manual` = named manual check on the owner's real Paseo desktop app, result recorded in `07-SPIKE.md` or the phase verification.
**Supersedes:** PANL-45..54 (swarm-map UI) and, where they rest on file reads or heuristics, PANL-34, PANL-36 and PANL-55 (D-10). PANL-01..10, PANL-56, PANL-57 and PANL-61 keep holding for `office`. See OFFC-25.
**Conventions:** the plugin id and folder are `office` / `plugins/office/`. "The cap" means a named constant in `plugins/office/server/limits.ts` or `client/limits.ts` (PANL-56 style); every number in an acceptance below is that constant, never a literal in a call site.

## v1.1 Requirements

### OFFC-01 Plugin skeleton and pinned toolchain
- Requirement: `plugins/office/` is a self-contained Paseo plugin: `paseo-plugin.json` (id `office`, `requirements.paseo` equal to the tested Paseo version), `package.json` with the pinned toolchain copied from `swarm-map` (`@getpaseo/plugin` 0.11.2, `react` 19.1.0, `react-native` 0.81.5, `zod`, `typescript`), `package-lock.json` usable by `npm ci`, `tsconfig.json` (erasable syntax only, `.ts` import extensions), `index.client.tsx` registering the screen and the sidebar entry, and `index.server.ts` default-exporting `contribute(server)` that returns a disposer. No new runtime package is added; the toolchain installs with `npm install --ignore-scripts`.
- Acceptance: offline: the plugin gate test finds manifest id = folder name, the `files` listed in the manifest exist, the lock file exists, `tsc --noEmit` passes in the plugin folder, and the host's `compilePlugin` + `evaluateBundle` loads both entries (skipped with a note when the installed Paseo differs from the tested version).
- Source: D-02, PANL-01, PANL-02, PANL-09, PANL-10.
- Scope: v1.1

### OFFC-02 Retirement of swarm-map
- Requirement: `swarm-map` is removed with nothing dangling: the folder `plugins/swarm-map/`, its entry in `KIT_PLUGIN_FOLDERS` (`kit/machine/plugins.mjs`, replaced by `office`), its lines in `plugins/smoke.mjs`, its mentions in `README.md` and the docs, and its tests (`tests/ui/swarm-*.test.mjs`, the swarm-map cases of `tests/ui/plugin-gates.test.mjs`, `tests/machine/apply.test.mjs`, `tests/machine/check.test.mjs`) are deleted or migrated to `office`. Historical records under `.planning/integration/`, `.planning/intel/` and `.planning/requirements/tools.md` stay and are marked superseded by OFFC-25, not rewritten. README and CHANGELOG tell an operator to run `paseo plugin ls` and remove a stale `swarm-map` registration.
- Acceptance: offline: a grep of the repository outside `.planning/` and `CHANGELOG.md` finds no `swarm-map`; `kit machine apply --enable-paseo-plugins` against the fake Paseo registers `planning-panel` and `office` and no other kit plugin; the full suite stays green apart from the known FTOL-15 flake.
- Source: D-02.
- Scope: v1.1

### OFFC-03 RPC contracts and failure envelopes
- Requirement: every server call is a `defineRpc` contract with zod schemas in `shared/`; names match `^[a-z][a-z0-9._-]*$`; a handler never throws: any failure becomes a typed envelope `{ok:false, code, message}`; every input is a bounded, enumerated spec (kinds, seed, pose set, scale from a fixed list), never a path or free text; numeric fields are bounded by named constants.
- Acceptance: offline: a contract test parses each handler output with its schema, feeds each handler a malformed input, an oversized key list and a throwing dependency, and gets `ok:false` with a code every time; `shared/` imports no Node builtin and no React.
- Source: PANL-03, PANL-04, D-01.
- Scope: v1.1

### OFFC-04 Read-only observer and host-primitive gates
- Requirement: `office` is a read-only observer: no call that answers a permission, sends a message to an agent, opens a terminal, spawns, creates, archives or deletes anything, no file write, no subprocess, no sound. The client uses only the host's React Native primitives (`View`, `Text`, `Image`, `Pressable`, `Animated`, `ScrollView`); no DOM, canvas, SVG, iframe or webview. The existing PANL-05 and PANL-06 gates are extended with the plugin id `office` and the `Image` allowance; no ban is loosened.
- Acceptance: offline: the grep gates over `plugins/office/` find none of the forbidden write/send/spawn/archive patterns, no `child_process`, no `fs` write API, no `document`/`window.`/`<svg`/`canvas` in `client/`; a deliberate fixture containing each forbidden pattern makes the gate fail.
- Source: D-09, PANL-05, PANL-06.
- Scope: v1.1

### OFFC-05 Data from the official Paseo API only, pushed not polled
- Requirement: all office data comes from `PaseoApi` (`projects`, `workspaces`, `agents`, agent timelines, `observeEvents`) and the plugin context types, held by the client through `usePaseo()`. The client seeds from `list`/`refetch`, then applies pushed `upsert`/`remove` updates, and re-seeds on `subscription_restored` and on reconnect; timeline subscriptions are opened only for running agents and the selected agent, bounded by a cap; there is no server-side polling of the daemon. No file is read and no config is parsed to recover a datum the API does not give (the single exception is OFFC-18), and no name-based heuristic is applied; a datum the API lacks is simply not shown. A tool call whose detail type is `unknown` maps to the default work pose and nothing else.
- Acceptance: offline (extended fake Paseo with subscribe stubs): the reducer applies upsert and remove, re-seeds after a restore marker, and the disposer leaves zero live subscriptions; a grep gate finds no `setInterval`-driven daemon call and no `readFile`/`readdir` outside the OFFC-18 module; a test with an agent that lacks every label renders it normally.
- Source: D-03, D-05.
- Scope: v1.1

### OFFC-06 Building model: rooms, clusters, characters, caps
- Requirement: one building shows every project. Room = Paseo project (`projectId`, `projectDisplayName`). Desk cluster in the room = workspace (`PluginWorkspaceSnapshot`), carrying a sign and a status light from its `status` and `diffStat`. Character = agent (`PluginAgentSnapshot`). An agent without a parent is a main character at the cluster's main desk; an agent with a parent (the `paseo.parent-agent-id` label, defined locally) is a small character with a badge placed around its parent; a child whose parent is not in the listed set is seated at the cluster's main desk. Rooms and clusters grow with agent count; above the named caps (agents per cluster, clusters per room, rooms per building) the surplus is shown as one "+N agents" group instead of drawn, and N is exact.
- Acceptance: offline: a pure model function maps a fixture of 3 projects, 4 workspaces and 20 agents (with parents, orphans, an archived agent) to the expected tree; with one more agent than the cap the output contains a surplus group whose N equals the number of undrawn agents; a status table test covers all five workspace statuses.
- Source: D-04, PANL-56.
- Scope: v1.1

### OFFC-07 Pixel-art port into the plugin server
- Requirement: the code-generated art of habblaud (`marmottajr/habblaud`, MIT) is ported into `plugins/office/server/art/`: `core/{pixbuf,sprite,color}`, `character/{render,hair,appearance}` (without the editor half), `furniture/*`, `surfaces/{floor,rug,walls}`, `theme`, `seasonal`, `icons`, and `pixelfont` rewritten to write into a `PixelBuf`; the hash and appearance helpers that `appearanceFromSeed` needs are ported with them. Canvas-bound code (`art/index.ts`, `art/dynamic.ts`) is not ported as-is: screens, the todo board and the window view are re-created as static `PixelBuf` variants keyed by state. Ported files follow this repo's rules (explicit class fields, `.ts` import extensions, English one-line comments, a header naming the upstream path and commit SHA). Appearance is deterministic from the agent id. Habblaud's bitmap assets, the character editor, and its modules for permission replies, messages, terminal, Docker, Codex, World, dictation, deliveries and timelapse are not ported.
- Acceptance: offline: `tsc --noEmit` passes; a grep gate finds no parameter-property constructor, `enum` or `namespace` in `server/art/`; the same seed renders byte-identical buffers on two runs and different seeds differ; golden hashes of a few characters, one furniture piece and one floor tile are pinned; no excluded habblaud module name appears in the folder.
- Source: D-01, D-05, planner defaults (code-generated art only, no editor, modules excluded).
- Scope: v1.1

### OFFC-08 PNG delivery: sent once per key, cached, bounded
- Requirement: `server/png.ts` encodes RGBA to PNG with `node:zlib` only (signature, IHDR, IDAT, IEND, CRC32; integer nearest-neighbour upscale), no PNG package. The server answers sprite requests by key (kind, seed, pose set, scale from a fixed list), renders lazily one sheet per key, keeps an LRU bounded by a byte cap, and bounds keys per call. The client holds a `Map` by key and asks for a key at most once while the plugin stays loaded, handing each `Image` one stable `source` object. Payload sizes (first load and steady state) are recorded in the spike and kept under the thresholds fixed in OFFC-10.
- Acceptance: offline: the encoder output has a valid signature and chunk CRCs and inflates back to the exact RGBA input; an exact 3x upscale is checked pixel by pixel; the LRU evicts at its byte cap; a client-store test shows a repeated key causes one RPC; an over-cap key list is answered `ok:false`.
- Source: D-01, D-12.
- Scope: v1.1

### OFFC-09 Crisp pixel art when scaled
- Requirement: pixel art shows without smoothing at the zoom levels the screen offers. Sprites are pre-scaled on the server by integer factors and displayed at their natural pixel size, so no host smoothing flag is needed; the zoom levels offered are the integer factors for which the spike verified crispness on the owner's display. Characters animate by stepping frames inside a clipped sprite sheet with transforms over a stable image, driven by a small fixed set of shared clocks, not by one timer per sprite.
- Acceptance: manual (desktop app): the spike's one-pixel ruler sprite and a character screenshot show no intermediate colours on edges at each offered zoom level; offline: the zoom-level list is a named constant and every entry is an integer.
- Source: D-12, D-01.
- Scope: v1.1

### OFFC-10 Wave 0 spike with go/no-go gate
- Requirement: before any other wave, a minimal `office` plugin draws one room and at least 3 and up to the named cap of characters as `Image` data URIs, with the common areas of OFFC-13 included in the measured scene, and records the result in `.planning/phases/07-office/07-SPIKE.md` against numeric thresholds that the plan fixes before the spike runs (median frame cadence of the animation, animated characters at the cap, bytes on first load, bytes at steady state, crispness check of OFFC-09). Each threshold is written down before measuring and is not edited afterwards. A failed gate stops the phase and goes to the owner; the fallback then considered is a link-out to a separately running habblaud. Waves after Wave 0 (and OFFC-13 in particular) run only after a recorded pass.
- Acceptance: manual: `07-SPIKE.md` holds the threshold table dated before the measurements, the measured values, the host and display scale, and a one-line verdict; offline: the plan's wave 1+ tasks name the spike verdict file as a dependency, and a check fails if the verdict file is missing or says fail.
- Source: D-12, D-06.
- Scope: v1.1

### OFFC-11 Pose and appearance from agent state
- Requirement: a table maps agent facts to a pose, first match wins: pending permissions or `requiresAttention` with `attentionReason: permission` -> `raise_hand`; `status: error` -> `sulk`; `closed` -> `sleep` then leaves by the elevator; `running` with latest tool detail `edit`/`write` -> `type`, `read` -> `read`, `shell` -> `use`, reasoning or no tool yet -> `wait`; other tool details (including `unknown`) -> the default seated work pose; `idle` -> `stand` or `drink` with wandering per OFFC-13; `initializing` -> arrives by the elevator. Appearance comes from the agent id only.
- Acceptance: offline: a table test covers status x attention x tool-detail-type including `unknown`; the same agent id gives the same appearance across sessions and rooms.
- Source: D-05, D-03, 07-CONTEXT specifics.
- Scope: v1.1

### OFFC-12 Handoff walk to the parent
- Requirement: when a child agent finishes a turn and has a parent in the building, its character walks to the parent's desk along a path computed on the room grid (ported habblaud A*) and returns; walking is a transform animation, not per-frame React state. A child with no reachable parent does not walk.
- Acceptance: offline: path tests on a fixture room cover a clear path, a blocked path and no-parent; a store test shows a finished turn of a child enqueues exactly one handoff.
- Source: D-04.
- Scope: v1.1

### OFFC-13 Common areas, idle wandering and hangouts
- Requirement: the building has a lobby with elevators, a kitchen, a lounge and a hallway; idle characters wander and use hangouts (habblaud's social spots) in them. This requirement is built only after OFFC-10 records a pass that includes the common areas in the measured scene; if the spike shows the host cannot carry the image count and update rate, the planner stops and returns to the owner before building it.
- Acceptance: offline: layout tests build the building from the ported layout modules with the four area kinds present and every area reachable from every room; wander picks only free spots; manual: the spike verdict covers the common areas.
- Source: D-06, D-12.
- Scope: v1.1

### OFFC-14 Sidebar tree and camera
- Requirement: the sidebar entry keeps Paseo's tree (project, session/workspace, agent); selecting a node moves the camera to its room, cluster or character; the default view shows every project. Names and titles are rendered only as `Text`, never built into a URI or a style.
- Acceptance: offline: a view-model test maps each tree node to a camera target inside the building bounds; a grep gate finds no agent-provided string in a `uri` or style expression.
- Source: D-04.
- Scope: v1.1

### OFFC-15 Agent drawer
- Requirement: selecting an agent opens a drawer with its activity (state and latest tool kind), its todos from timeline `todo` items with their pending/in_progress/completed state, its child agents and its last error. It shows nothing else (no file contents, no prompts, no absolute paths).
- Acceptance: offline: a drawer view-model test from a fixture timeline yields the todo list in order with statuses, the child list from the parent label, and the last error text; with no todo item the todo section is empty, not guessed.
- Source: D-05, D-03.
- Scope: v1.1

### OFFC-16 Top-bar counters, context and the empty usage slot
- Requirement: the top bar shows counters by agent state and the context use of the selected or busiest agent from `lastUsage` (`contextWindowUsedTokens` / `contextWindowMaxTokens`), with a named warning level. It keeps one empty slot for provider usage windows (5h, weekly); `providers.listUsage()` is not called and no usage value is shown until the owner supplies the API.
- Acceptance: offline: counters and percentage are computed from fixtures, including missing `contextWindowMaxTokens` (shows nothing); a grep gate finds no `listUsage` in `plugins/office/`; the slot renders as an empty element.
- Source: D-05, D-07.
- Scope: v1.1

### OFFC-17 Day/night cycle and seasonal themes
- Requirement: the scene follows the local clock through day phases (ported habblaud `daylight` keys) and applies a seasonal theme (ported `seasonal`/`theme`). Tint is delivered as a small fixed number of pre-rendered variants cross-faded with opacity, and the number is set from the spike's payload measurement.
- Acceptance: offline: day-phase interpolation tests at fixed hours; season selection tests at fixed dates; the variant count is a named constant; manual: a day and a night screenshot.
- Source: D-05.
- Scope: v1.1

### OFFC-18 Wave and phase completion effects via harness.run
- Requirement: when a wave or phase of the kit's GSD run completes, the scene plays an effect. The link is the agent label `harness.run`, resolved by the carried-over `wave-link` module reading `<project>/_workspace/_runs/<runId>/run.json`, `args.json` and the phase's PLAN/SUMMARY files. This is the single, named, read-only exception to the no-file-read rule of OFFC-05 (D-05 asks for it explicitly). It keeps swarm-map's containment: `realpath` inside `.planning/phases` and `_workspace/_runs`, a run id that rejects separators and `..`, mtime-cached reads, no writes. An agent without the label is drawn normally and no effect plays.
- Acceptance: offline: the migrated wave-link fixtures (2 of 4 plans summarised) give the same counts; a run id with `..` or a path separator is rejected; a symlink escaping the root is refused; the PANL-05 gate names this one module as the only reader.
- Source: D-05, D-03, PANL-61, PANL-13.
- Scope: v1.1

### OFFC-19 One English strings table
- Requirement: all user-visible text is English and lives in one table `client/strings.ts` keyed by id, so a Vietnamese table can be added later without code changes. No component holds a literal user-visible string.
- Acceptance: offline: a grep gate finds no JSX text literal and no string literal in `Text` children outside `client/strings.ts`; every key used in code exists in the table.
- Source: D-08.
- Scope: v1.1

### OFFC-20 Licence and notice for the port
- Requirement: habblaud's MIT notice is added as `LICENSES/habblaud-MIT.txt` and named in `NOTICE.md` with the upstream repository and the commit SHA of the port; each ported file header names its upstream path.
- Acceptance: offline: the licence file exists and begins `MIT License` with the upstream copyright line; `NOTICE.md` names habblaud and the SHA; every file under `server/art/` has a header with an upstream path.
- Source: D-01, planner defaults (MIT notice).
- Scope: v1.1

### OFFC-21 Additional read-only signals from the API
- Requirement: beyond OFFC-06..16, the office may show other facts the official API already gives and the owner's phrase "take what more we can get" allows, for example the attention light and reason, `lastUserMessageAt` recency, provider and model of an agent, workspace `kind`, or project and workspace updates from `observeEvents`. Each must be a pure presentation of an API value, read-only (D-09), with no heuristic (D-03). The plan names the chosen set and defers the rest.
- Acceptance: offline: each added signal has a view-model test from a fixture and a test that absence of the value shows nothing; no new API call outside the read-only set.
- Source: D-05, D-03, D-09.
- Scope: v1.1

### OFFC-22 Offline tests for every pure module
- Requirement: every pure module of `office` (art, png, sprites, model, store reducer, poses, layout, path, daylight, wave-link, view-models) is imported and exercised by an offline test; the PANL-57 `named` map is migrated to `office`. Source-text gates normalise `\r\n`; golden checks compare buffer or PNG hashes, not source text.
- Acceptance: offline: the gate test fails when a pure module is not exercised by a test; `npm test` is green apart from the known FTOL-15 flake, which passes when run alone.
- Source: PANL-57, D-02.
- Scope: v1.1

### OFFC-23 Documentation, smoke script and changelog
- Requirement: README documents the `office` plugin (what it shows, what it reads, what it never does, the stale-registration note); `plugins/smoke.mjs` smoke-checks `planning-panel` and `office`; a CHANGELOG entry is added for the milestone only with the owner's approval and date.
- Acceptance: offline: smoke script exits 0 against the fake with `office` loaded; the CHANGELOG entry is present after the owner approves and carries the date.
- Source: D-02, HARN-15.
- Scope: v1.1

### OFFC-24 Host scope of the gate
- Requirement: the spike gate and the manual checks are defined for the desktop app (Electron/web) on the host the screen is opened on; mobile hosts (`layout.platform` ios/android) and multi-host views are out of v1 and reported as untested.
- Acceptance: manual: `07-SPIKE.md` and the phase verification state "desktop only; mobile not tested; one host".
- Source: D-12, D-04.
- Scope: v1.1

### OFFC-25 Superseded requirement ledger
- Requirement: the plans and the phase verification list PANL-45..54 as superseded by OFFC-06..19, and PANL-34, PANL-36 and PANL-55 as superseded where they rest on file reads or name heuristics (D-03). PANL-01..10, PANL-56, PANL-57 and PANL-61 are reported as kept (as OFFC-01..04, 06, 22 and 18). No historical record is deleted.
- Acceptance: offline: a check finds each superseded id listed once in this file's ledger below and `tools.md` unchanged.
- Source: D-10.
- Scope: v1.1

## Decision coverage

| Decision | Covered by |
|----------|------------|
| D-01 native port, server PNG, client `Image` | OFFC-03, 07, 08, 09, 20 |
| D-02 plugin id `office`, swarm-map retired | OFFC-01, 02, 22, 23 |
| D-03 official API only, subscriptions, no heuristics | OFFC-05, 11, 15, 21 |
| D-04 building model, sidebar, caps | OFFC-06, 12, 14, 24 |
| D-05 v1 scope (drawer, counters, day/night, seasons, wave effects, more from API) | OFFC-07, 11, 15, 16, 17, 18, 21 |
| D-06 common areas gated by the spike | OFFC-10, 13 |
| D-07 empty provider-usage slot | OFFC-16 |
| D-08 English strings table | OFFC-19 |
| D-09 read-only observer | OFFC-04, 21 |
| D-10 [informational] supersession | OFFC-25 |
| D-11 [informational] orchestration | none (process) |
| D-12 Wave 0 spike gate | OFFC-08, 09, 10, 13, 24 |

## Superseded ledger (D-10)

| Id | Status | Replaced by |
|----|--------|-------------|
| PANL-45..54 | superseded | OFFC-06..19 |
| PANL-34, PANL-36 | superseded where they rest on name heuristics or file reads | OFFC-05, 11 |
| PANL-55 | superseded where it reads project config | OFFC-16 |
| PANL-01..10 | kept | OFFC-01..04 |
| PANL-56, PANL-57 | kept | OFFC-06, 22 |
| PANL-61 | kept as the one file-read exception | OFFC-18 |
