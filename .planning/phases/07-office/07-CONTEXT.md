# Phase 7: Office - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning
**Owner:** answers given in the main session on 2026-10-21 (Vietnamese); all decisions below are the owner's unless listed under `<defaults>`.

<domain>
## Phase Boundary

Replace the `swarm-map` Paseo plugin with a new read-only plugin `office` (`plugins/office/`) that shows Paseo work as a pixel-art office ported from habblaud (https://github.com/marmottajr/habblaud, MIT). One building; a room per Paseo project; a desk cluster per session (Paseo's sidebar calls a session a workspace); a character per agent. Goal for the owner: track many agents more easily and with more fun. The owner runs several projects at once, 1-2 sessions per project, and orchestrates many agents inside one session with this kit.

The plugin host offers only React Native primitives (no iframe, webview, canvas or SVG), so habblaud cannot be embedded: its pure `PixelBuf` art code (RGBA buffers, no DOM) is ported into the plugin server, encoded to PNG there and shown by the client as images.
</domain>

<decisions>
## Implementation Decisions

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
</decisions>

<canonical_refs>
## Canonical References

- habblaud source (MIT): `client/src/art/core/pixbuf.ts`, `core/sprite.ts`, `core/color.ts`, `character/render.ts`, `character/hair.ts`, `character/appearance.ts`, `furniture/*`, `surfaces/{floor,walls,rug}.ts`, `theme.ts`, `seasonal.ts`, `icons.ts`, `pixelfont.ts`, `api.ts`; UI behavior in `client/src/ui/drawer.ts`, `model.ts`, `topbar.ts`, `feed.ts`; README sections "Overview", "Agent states" (idle behavior and hangouts), "Day/night", "Seasonal".
- Paseo SDK: `@getpaseo/plugin` 0.11.2 (`contracts.d.ts` `PluginWorkspaceSnapshot`, `PluginAgentSnapshot`; `client/ui.d.ts`, `client/react-native.d.ts`; `server/usage.d.ts` for the later usage slot) and `@getpaseo/client` (`PaseoApi`, `PaseoAgentHandle`, `PaseoProjectActions`, `PaseoWorkspaceActions`). Protocol timeline item types: `tool_call`, `todo`, `reasoning`, `assistant_message`, `user_message`, `error`, `compaction`.
- Kit: `.planning/REQUIREMENTS.md` PANL-01..61 (rules the office keeps: PANL-01..10, 56, 57), `plugins/planning-panel/` (shape of a working plugin, project picker), `plugins/swarm-map/` (what is replaced), `kit/machine/plugins.mjs`, `plugins/smoke.mjs`, `tests/ui/`, `CHANGELOG.md` (HARN-15 entry with owner approval and date), `LICENSES/`, `NOTICE.md`.
</canonical_refs>

<code_context>
## Existing Code Insights

- `plugins/swarm-map/` (about 3,350 lines): server `snapshot.ts`, `activity.ts`, `events.ts`, `files.ts`, `wave-link.ts` and client `swarm-surface.tsx`, `panels.tsx`, `state.ts`, `effects.ts`, `anim.ts`. Its RPC contract is `plugins/swarm-map/shared/swarm.ts`. The circle-and-ring UI (`ring.tsx`, `nodes.tsx`, `links.tsx`, `geometry.ts`) is replaced; `wave-link.ts` and the lifecycle event log are the likeliest reuse. `server/rotate.ts` (reads project config files) and `kit-defaults.json` conflict with D-03.
- Each Paseo plugin is compiled from its own folder, so code cannot be shared between plugins; `office` is self-contained.
- The host has no SVG (PANL-06); `swarm-map/client/ring.tsx` shows the existing workaround style.
- habblaud art is pure: `PixelBuf` composes everything in an RGBA array and only the last step creates a canvas. Sprite sizes: character 24x34 px with 20 poses (`POSE_FRAMES`, `POSE_DURATION` in `character/render.ts`). Port needs a PNG encoder (Node `zlib`) in the plugin server.
- habblaud's own PNG files (`client/public/assets/art`, `brand`) are not part of the port.
</code_context>

<specifics>
## Specific Ideas

- Pose mapping from agent state: running with `edit`/`write` tool -> `type`; `read` -> `read`; shell -> `use`; thinking -> `wait`; `requiresAttention` with `attentionReason: permission` -> `raise_hand`; `error` -> `sulk`; idle -> `stand` or `drink` and wandering in common areas (D-06); `closed` -> `sleep` then leaves by elevator.
- Appearance is deterministic from the agent id (habblaud `appearanceFromSeed`), so a character looks the same in every session.
- The kit's `ph.swarm` and `harness.run` labels are optional enrichments (cluster grouping, wave progress); an agent without them is drawn normally.
</specifics>

<defaults>
## Planner Defaults (not yet confirmed by the owner; change on request)

- Only code-generated art is ported (the `PixelBuf` modules); habblaud's bitmap assets are not copied.
- Habblaud's MIT notice is added to `LICENSES/habblaud-MIT.txt` and `NOTICE.md`.
- Habblaud modules for permission replies, messages, terminal, Docker, Codex, World, dictation, deliveries and timelapse are not ported.
- Character editor and renaming are not in v1.
</defaults>

<deferred>
## Deferred Ideas

- Provider usage windows (5h, weekly) from the owner's future API (D-07).
- Vietnamese strings table (D-08).
- Sound, permission answering, sending messages, terminal (D-09).
- Character editor, room renaming, timelapse, GitHub event effects, Habblaud World (online city).
</deferred>
