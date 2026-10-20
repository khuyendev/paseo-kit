# Map: UI (Paseo plugins: swarm-plugin, backlog-plugin)

Source roots: `kit:` = C:/Users/fish/Desktop/paseo-harness-kit at `ref-final`. All paths below are under `kit:` unless a prefix says otherwise.

## Coverage

| file | lines | read fully |
| :-- | --: | :-- |
| paseo/plugins/swarm-plugin/.gitignore | 1 | yes |
| paseo/plugins/swarm-plugin/README.md | 91 | yes |
| paseo/plugins/swarm-plugin/index.client.tsx | 8 | yes |
| paseo/plugins/swarm-plugin/index.server.ts | 16 | yes |
| paseo/plugins/swarm-plugin/package.json | 27 | yes |
| paseo/plugins/swarm-plugin/paseo-plugin.json | 6 | yes |
| paseo/plugins/swarm-plugin/tsconfig.json | 23 | yes |
| paseo/plugins/swarm-plugin/shared/swarm.ts | 225 | yes |
| paseo/plugins/swarm-plugin/server/activity.ts | 370 | yes |
| paseo/plugins/swarm-plugin/server/events.ts | 114 | yes |
| paseo/plugins/swarm-plugin/server/file-input.ts | 16 | yes |
| paseo/plugins/swarm-plugin/server/files.ts | 103 | yes |
| paseo/plugins/swarm-plugin/server/group.ts | 17 | yes |
| paseo/plugins/swarm-plugin/server/runs.ts | 162 | yes |
| paseo/plugins/swarm-plugin/server/snapshot.ts | 257 | yes |
| paseo/plugins/swarm-plugin/client/anim.ts | 115 | yes |
| paseo/plugins/swarm-plugin/client/format.ts | 74 | yes |
| paseo/plugins/swarm-plugin/client/geometry.ts | 280 | yes |
| paseo/plugins/swarm-plugin/client/links.tsx | 246 | yes |
| paseo/plugins/swarm-plugin/client/nodes.tsx | 757 | yes |
| paseo/plugins/swarm-plugin/client/palette.ts | 164 | yes |
| paseo/plugins/swarm-plugin/client/panels.tsx | 519 | yes |
| paseo/plugins/swarm-plugin/client/ring.tsx | 53 | yes |
| paseo/plugins/swarm-plugin/client/swarm-surface.tsx | 718 | yes |
| paseo/plugins/backlog-plugin/index.client.tsx | 34 | yes |
| paseo/plugins/backlog-plugin/index.server.ts | 14 | yes |
| paseo/plugins/backlog-plugin/package.json | 28 | yes |
| paseo/plugins/backlog-plugin/paseo-plugin.json | 7 | yes |
| paseo/plugins/backlog-plugin/tsconfig.json | 17 | yes |
| paseo/plugins/backlog-plugin/server/backlog-cli.ts | 133 | yes |
| paseo/plugins/backlog-plugin/server/backlog-handlers.ts | 107 | yes |
| paseo/plugins/backlog-plugin/server/backlog-normalize.ts | 138 | yes |
| paseo/plugins/backlog-plugin/server/docs-handlers.ts | 61 | yes |
| paseo/plugins/backlog-plugin/server/docs-parse.ts | 131 | yes |
| paseo/plugins/backlog-plugin/server/docs-paths.ts | 92 | yes |
| paseo/plugins/backlog-plugin/shared/backlog.ts | 102 | yes |
| paseo/plugins/backlog-plugin/shared/docs.ts | 61 | yes |
| paseo/plugins/backlog-plugin/client/board.tsx | 194 | yes |
| paseo/plugins/backlog-plugin/client/color.ts | 43 | yes |
| paseo/plugins/backlog-plugin/client/doc-reader.tsx | 194 | yes |
| paseo/plugins/backlog-plugin/client/docs-data.ts | 17 | yes |
| paseo/plugins/backlog-plugin/client/docs-model.ts | 130 | yes |
| paseo/plugins/backlog-plugin/client/docs-view.tsx | 354 | yes |
| paseo/plugins/backlog-plugin/client/format.ts | 66 | yes |
| paseo/plugins/backlog-plugin/client/kit.tsx | 414 | yes |
| paseo/plugins/backlog-plugin/client/markdown.tsx | 324 | yes |
| paseo/plugins/backlog-plugin/client/model.ts | 89 | yes |
| paseo/plugins/backlog-plugin/client/panel.tsx | 213 | yes |
| paseo/plugins/backlog-plugin/client/project-picker.tsx | 216 | yes |
| paseo/plugins/backlog-plugin/client/projects.ts | 114 | yes |
| paseo/plugins/backlog-plugin/client/section-tabs.tsx | 54 | yes |
| paseo/plugins/backlog-plugin/client/stats-view.tsx | 322 | yes |
| paseo/plugins/backlog-plugin/client/stats.ts | 176 | yes |
| paseo/plugins/backlog-plugin/client/surface.tsx | 87 | yes |
| paseo/plugins/backlog-plugin/client/task-detail.tsx | 338 | yes |
| paseo/plugins/backlog-plugin/client/task-views.tsx | 197 | yes |
| paseo/plugins/backlog-plugin/client/toolbar.tsx | 215 | yes |
| tests/swarm-file-input.test.mjs | 10 | yes |

Not in scope (excluded by rule): node_modules, package-lock.json. Context-only reads (not part of coverage): `kit:CHANGELOG.md:37,56`, `kit:machine.mjs:8,31,165,178` (grep lines), `kit:project/.agents/harness/runtime/common.mjs:10` (grep line).

## Summary

Two Paseo plugins ship in `paseo/plugins/`. **swarm-plugin** is a read-only, live, animated map of Paseo agent orchestration: brain (an agent with live subagents, linked by label `paseo.parent-agent-id`) -> swarm hubs (subagents grouped by title prefix) -> agents on C-shaped rings. It has no server push: the client polls the `swarm.snapshot` RPC every 1 s and `swarm.agent-detail` every 1.5 s. The daemon side builds the snapshot from `paseo.agents.list`, timeline tails per eligible agent (activity, last prompt/reply, file touches), an in-memory file ledger (holder, handoff, write conflict) and an in-memory event log fed by Paseo lifecycle hooks, and scans the OS temp dir for old `paseo_tool.py` queue/review run dirs. The client is React Native primitives only (no DOM, no SVG), so it runs on mobile; all continuous animation hangs on four shared Animated clocks.

**backlog-plugin** (DROP) shells out to the Backlog.md CLI and shows a board/list/stats view, task detail, a docs tree/reader with a markdown renderer, and a project picker. It is the better-engineered of the two as a UI kit: typed ok/failure RPC envelopes, tolerant zod parsing, cached workspace-directory resolution, a themed primitive set (`kit.tsx`), a block+inline markdown renderer, a frontmatter parser, a folder-tree model, MRU project picker. None of the Backlog-specific data path survives, but the plugin contracts, kit, markdown, docs tree/reader, picker, stats tiles and split-pane/trail navigation are reusable for a `.planning/` panel.

Worth keeping in spirit: read-only plugins; polling with cheap cached server work (eligibility windows, TTL caches, bounded caps); every limit a named constant; stable layout slots so the map does not jump; honest degradation (errors array in the snapshot, `ok:false` envelopes with codes); theme colours only for text. Worth dropping: everything keyed to `paseo_tool.py` (title formats, temp-dir run dirs, `paseo.md`), which does not exist in this kit (the README cites `tools/paseo/paseo_tool.py` and `paseo.md`; neither is in the tag, only `ph` is: `kit:project/.agents/skills/harness/references/paseo-runtime.md:33`).

## Behaviors

### UI-01 Plugin manifest and package layout
- Behavior: each plugin dir has `paseo-plugin.json` with `id` (= dir name) and `requirements.paseo` (`>=0.10.0`); swarm has no `description`, backlog has one. `package.json` is private v0.0.0, `files` lists `paseo-plugin.json`, `index.client.ts(x)`, `index.server.ts(x)`, `client/`, `server/`, `shared/`; dev deps pin `@getpaseo/plugin` 0.10.0, `react` 19.1.0, `react-native` 0.81.5, `@tanstack/react-query` ^5, `zod` ^4, `typescript` ^5.9; script `typecheck` = `tsc --noEmit`. tsconfig: ES2020/ESNext/Bundler, `types: [react,node]`, strict, noEmit, `jsx: react-jsx`. Layout convention: `shared/` (zod RPC contracts), `server/` (daemon), `client/` (UI), two entry files at the plugin root.
- Proposal: KEEP the layout and manifest shape for the new panel plugin; CHANGE the id/description; pin the version range against the Paseo CLI actually installed (verify, do not copy 0.10.0).
- Source: kit:paseo/plugins/swarm-plugin/paseo-plugin.json:1-6; kit:paseo/plugins/backlog-plugin/paseo-plugin.json:1-7; kit:paseo/plugins/swarm-plugin/package.json:1-27; kit:paseo/plugins/backlog-plugin/package.json:1-28; kit:paseo/plugins/swarm-plugin/tsconfig.json:1-23; kit:paseo/plugins/backlog-plugin/tsconfig.json:1-17
- Why it exists: Paseo plugin loader contract (files list, entry names); README states the requirement `Paseo >= 0.10.0` and `pluginsEnabled: true` (kit:paseo/plugins/swarm-plugin/README.md:73-74).
- Test idea: `paseo plugin install <dir>` then `paseo plugin ls` shows the plugin `running`; manifest id equals directory name.

### UI-02 Entry points
- Behavior: server entry `index.server.ts` default-exports `contribute(server: PluginServerContext)`, registers handlers with `server.handle(rpc, handler)` and lifecycle subscriptions with `server.on(event, cb)`, returns a disposer (swarm: unsubscribes hooks; backlog: no-op). Client entry `index.client.tsx` default-exports `contribute(client: PluginClientContext)`, registers UI with `client.addSurface(id, Component)`, `client.addSidebarItem({id,title,icon,surface})`, backlog additionally `client.addWorkspacePanel({id,title,icon,context:"workspace",Component})` and `client.addCommandCenterItem({id,title,icon,keywords,context:"workspace",onSelect({openPanel})})`; returns a no-op cleanup. Swarm registers surface `swarm` + sidebar item "Swarm" icon `Network`; backlog registers surface `backlog`, sidebar "Backlog" icon `ListChecks`, workspace panel `backlog`, command-center "Open Backlog" (keywords tasks, board, kanban, backlog.md).
- Proposal: KEEP the pattern. For `.planning/` register one sidebar surface (project picker + panel) and one workspace panel; keep the command-center item.
- Source: kit:paseo/plugins/swarm-plugin/index.server.ts:8-16; kit:paseo/plugins/swarm-plugin/index.client.tsx:4-8; kit:paseo/plugins/backlog-plugin/index.server.ts:7-14; kit:paseo/plugins/backlog-plugin/index.client.tsx:8-34
- Why it exists: Paseo plugin API surface (types imported from `@getpaseo/plugin/client|server`). Not stated beyond that.
- Test idea: after install the sidebar shows the item and the command center lists "Open ..." in a workspace context; disposing (reload) removes the hooks (no duplicate events after `paseo plugin reload`).

### UI-03 RPC contract (`defineRpc`)
- Behavior: contracts live in `shared/*.ts` as `defineRpc({name, input: zod, output: zod})`; the same object is used by `server.handle(rpc, fn)` and client `useRpc(rpc)` (returns an async function). Names must match `^[a-z][a-z0-9._-]*$` (no camelCase) or the plugin fails to load. Swarm: `swarm.snapshot`, `swarm.agent-detail`. Backlog: `backlog.tasks.list`, `backlog.tasks.view`, `backlog.docs.list`, `backlog.docs.view`, `backlog.docs.search`. Handler signature `(input, {paseo})`; types `RpcInput<typeof rpc>`. Input validation lives in zod (id regexes `TASK_ID_PATTERN`, `DOC_ID_PATTERN`, query min 1 / max 200, `runMaxAgeHours` 1..336).
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/shared/swarm.ts:199-225; kit:paseo/plugins/backlog-plugin/shared/backlog.ts:4,87-102; kit:paseo/plugins/backlog-plugin/shared/docs.ts:5,38-61; kit:paseo/plugins/swarm-plugin/README.md:85-86
- Why it exists: loader rule for RPC names (README gotcha, learned by a failed load).
- Test idea: a contract test asserts every RPC name matches the regex and every server handler output parses with its output schema.

### UI-04 Result envelope with error codes (backlog)
- Behavior: backlog RPC outputs are `z.discriminatedUnion("ok", [success, failure])` where failure = `{ok:false, code, message, directory}` and `code` in `no_backlog | cli_unavailable | timeout | invalid_output | not_found | failed`. Handlers never throw to the client: they catch and map via `failure(error, directory)` (a non-typed error becomes `failed`). The client renders each state: transport error, `ok:false` (special-case `no_backlog` as a muted "no project" state), loading, empty, filter-empty.
- Proposal: KEEP the envelope pattern; CHANGE codes to `.planning` ones (`no_planning`, `unreadable`, `parse_error`, `not_found`, `failed`).
- Source: kit:paseo/plugins/backlog-plugin/shared/backlog.ts:58-102; kit:paseo/plugins/backlog-plugin/server/backlog-handlers.ts:49-55,68-107; kit:paseo/plugins/backlog-plugin/client/panel.tsx:100-164
- Why it exists: not stated.
- Test idea: calling the list RPC in a workspace without `.planning/` returns `{ok:false, code:"no_planning"}` and the panel shows the empty-state hint, not an error toast.

### UI-05 Paseo SDK calls the plugins rely on
- Behavior: handler context `{paseo}` exposes: `paseo.agents.list({filter:{includeArchived,statuses}, sort:[{key,direction}], page:{limit,cursor}})` -> `{entries:[{agent, project}], pageInfo:{hasMore,nextCursor}}`; `paseo.agents.ref(id).timeline.refetch({direction:"tail", limit, projection:"projected"})` -> `{entries:[{item, timestamp, seqStart}]}`; `paseo.agents.ref(id).refresh()` -> `{agent, project}`; `paseo.workspaces.ref(id).current()/refresh()/directory` and `.workspaceDirectory`. Client: `usePaseo().workspaces.list()` -> `{entries:[RawWorkspace]}`. Timeline item types used: `tool_call` (detail types read/edit/write/shell/search/fetch/sub_agent/worktree_setup/plan/plain_text/unknown), `user_message`, `assistant_message`, `reasoning`, `compaction`, `todo`, `error`; notifications and plugin rows are ignored. Agent payload fields used: id, title, provider, model, thinkingOptionId, currentModeId, status, lastUsage.contextWindowUsedTokens/MaxTokens, pendingPermissions, requiresAttention, attentionReason, labels, createdAt, updatedAt, activeTurn.startedAt, archivedAt.
- Proposal: KEEP as the dependency list; the new kit must re-verify these against the installed Paseo version (types are inferred from the SDK, not declared locally).
- Source: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:15-18,42-64,76-105; kit:paseo/plugins/swarm-plugin/server/activity.ts:14-17,152-207,323-330; kit:paseo/plugins/backlog-plugin/server/backlog-handlers.ts:57-66; kit:paseo/plugins/backlog-plugin/client/surface.tsx:25-35; kit:paseo/plugins/backlog-plugin/client/projects.ts:5-14
- Why it exists: not stated.
- Test idea: a smoke script against a live daemon calls each listed SDK method once and asserts the fields above exist (guards SDK drift on Paseo upgrade).

### UI-06 Server lifecycle hooks
- Behavior: `server.on(name, cb)` returns an off function. Hooks used: `agent.created({agent})`, `agent.archived({agent})`, `agent.turn_started({agent}, {paseo})`, `agent.turn_ended({agent, outcome, timeline})` with `outcome.kind` = `completed | failed (error.message) | canceled (reason)`, `agent.permission_requested({agent, request:{title,name}})`, `agent.permission_resolved({agent})`. `agent` carries `id, parentAgentId, title`. Hooks run for every agent of the daemon (the client filters).
- Proposal: KEEP for the swarm map; for a `.planning` panel hooks are optional (could notify on plan-agent completion).
- Source: kit:paseo/plugins/swarm-plugin/server/events.ts:69-114; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:476
- Why it exists: README "Events" (kit:paseo/plugins/swarm-plugin/README.md:49-52).
- Test idea: spawn and archive a throwaway agent and assert the feed shows `spawned` then `archived` within 2 polls.

### UI-07 Polling instead of push
- Behavior: plugins have no server push. Client uses react-query `useQuery` with `refetchInterval`: swarm snapshot 1000 ms, agent detail 1500 ms (only while an agent is selected), backlog task list 5000 ms, task detail 5000 ms, workspaces list 15 000 ms, docs list 60 000 ms (stale 30 s), doc reader staleTime 30 s, doc search debounce 250 ms / min 2 chars / stale 30 s. Two different failure behaviours (r1): the backlog queries (task list, task detail, workspaces list, docs list, doc reader, doc search) use `placeholderData: keepPreviousData`, and the task-list panel shows a "Reconnecting" dot from `isRefetchError`; the swarm snapshot and agent-detail queries do NOT keep data across a query-key change (age choice or `Active 6h`) and report failure as header subtitle `offline` plus a `Snapshot failed: <msg>` line. Detail readers (task detail, doc reader) combine `keepPreviousData` with an id-equality guard, see UI-81.
- Proposal: KEEP the pattern; CHANGE intervals for `.planning` (files change slowly: 3-5 s list, ETag/mtime check server-side, see UI-65).
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:33,395-405; kit:paseo/plugins/swarm-plugin/client/panels.tsx:30,171-176; kit:paseo/plugins/backlog-plugin/client/panel.tsx:25,54-59; kit:paseo/plugins/backlog-plugin/client/task-detail.tsx:12,255-260; kit:paseo/plugins/backlog-plugin/client/surface.tsx:10,27-32; kit:paseo/plugins/backlog-plugin/client/docs-data.ts:5-16; kit:paseo/plugins/backlog-plugin/client/docs-view.tsx:23-24,124-130; kit:paseo/plugins/backlog-plugin/client/doc-reader.tsx:10,68-73; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:575,594 (offline / Snapshot failed); kit:paseo/plugins/backlog-plugin/client/panel.tsx:54-58,199; kit:paseo/plugins/backlog-plugin/client/toolbar.tsx:164 (Reconnecting)
- Why it exists: "plugins have no server push" (kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:6).
- Test idea: stop the daemon; the swarm surface shows `offline` / `Snapshot failed`, a backlog-style panel shows "Reconnecting"; both recover on daemon restart without a reload.

### UI-08 Client constraints (React Native only, theme-only text colours)
- Behavior: no HTML/DOM, no SVG in `client/`; only React Native primitives (View/Text/Pressable/Animated/ScrollView/FlatList) so it works on mobile; host-provided components come from `@getpaseo/plugin/client/react-native`: `Icon` (lucide names, checked against Paseo 0.10.0's set), `Modal`, `TextInput`, `FlatList`, `ScrollView`, `useToast`, `copyText`; `openExternalUrl` from `@getpaseo/plugin/client`; `usePaseo`, `useRpc`. Surface props: `{theme, layout:{compact}, host:{id}}`; workspace panel props add `workspaceId`. Text colours come only from `theme.colors` (`foreground, foregroundMuted, accent, accentForeground, surface0/1/2, border, statusSuccess/Warning/Danger`); decorative fixed hues are allowed for dots/rings/glows only. `compact` switches layouts (stacked vs side panel).
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/README.md:85-86; kit:paseo/plugins/swarm-plugin/client/palette.ts:1-4; kit:paseo/plugins/swarm-plugin/client/ring.tsx:1-3; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:63-70; kit:paseo/plugins/backlog-plugin/client/panel.tsx:30-36; kit:paseo/plugins/backlog-plugin/client/project-picker.tsx:1; kit:paseo/plugins/backlog-plugin/client/markdown.tsx:1
- Why it exists: README gotchas (kit:paseo/plugins/swarm-plugin/README.md:85-86).
- Test idea: lint rule / grep gate: no `<div>`, `<svg>`, `document.` and no hard-coded text colour in `client/`.

### UI-09 Develop / install workflow and enabling
- Behavior: README: `npm install` in the plugin dir; typecheck with `node node_modules/typescript/bin/tsc --noEmit` (`npm run typecheck` fails on the Windows shell); `paseo plugin install "<kit>/paseo/plugins/swarm-plugin"` once; `paseo plugin reload swarm-plugin` after edits; `paseo plugin ls` must show `running`; `paseo plugin logs swarm-plugin` for server errors. Requires daemon `config.json` `pluginsEnabled: true`. The kit's machine tool turns it on only with `--enable-paseo-plugins` (machine.mjs:8,165,178). A visual preview outside Paseo (react-native-web + esbuild + simulated swarm `sim.ts`) lived in `%TEMP%/swarm-preview`, deliberately not in the repo (its deps need documenting in the engineering standards first).
- Proposal: KEEP the workflow; DROP the sim harness unless the owner wants a preview (OPEN, see questions); install/enable belongs to the install area.
- Source: kit:paseo/plugins/swarm-plugin/README.md:71-91; kit:machine.mjs:8,165,178 (grep lines only)
- Why it exists: owner approval needed to enable plugins (README 73-74: "enabled 2026-10-02 with the owner's approval").
- Test idea: scripted `paseo plugin install` + `ls` in a clean profile reports `running` for the new plugin.

### UI-10 `swarm.snapshot` RPC: input and output
- Behavior: input `{runMaxAgeHours: number 1..336, recentHours: number >=0, afterSeq: int (-1 = first call), eventEpoch: string|null}`. Output `{generatedAt, tempDir, brains[], standaloneCount, runs[], eventEpoch, files[], events[], lastSeq, errors[]}`. `brains[] = {agent: SwarmAgent|null, groups: [{name, agents[], runIds[]}], runIds[]}`; `agent:null` = orphan bucket (parent archived/unknown). `SwarmAgent` = `{id,title,model:"provider/model",thinking,mode,status(initializing|idle|running|error|closed),contextPct,usedTokens,maxTokens,attention(finished|error|permission|null),parentId,project,createdAt,updatedAt,turnStartedAt,activity,heldFiles}`.
- Proposal: KEEP the shape as the baseline for any agent-swarm view; trim `runs`/`tempDir` if run dirs are dropped (UI-29).
- Source: kit:paseo/plugins/swarm-plugin/shared/swarm.ts:63-105,181-210; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:35-40,244-255
- Why it exists: one poll returns everything the screen draws; measured 66 ms first, ~30 ms per poll, 34 KB default (README 53-54).
- Test idea: snapshot output always parses with `snapshotSchema`; a poll with `afterSeq=lastSeq` returns `events: []`.

### UI-11 `swarm.agent-detail` RPC
- Behavior: input `{agentId}`; output `{recent: Activity[] (newest first, no reasoning, max 8), lastCommand: {text,at}|null, lastReply: {text,at}|null}`. Served from the activity cache; if the agent was never read, one timeline read happens (status `"unknown"`), and a read error is thrown to the client (shown in the inspector).
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/shared/swarm.ts:212-225; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:115-118; kit:paseo/plugins/swarm-plugin/server/activity.ts:290-297
- Why it exists: the inspector needs prompt/reply text without bloating the 1 s snapshot (README 44).
- Test idea: select an idle agent never read before; the inspector shows recent actions within one 1.5 s poll, or its error text if the timeline read fails.

### UI-12 Agent listing and mapping
- Behavior: `paseo.agents.list` with `includeArchived:false`, `statuses:[initializing,idle,running,error]` (closed excluded), sort `created_at asc`, page limit 200, at most 5 pages (1000 agents); entries with `archivedAt` skipped. `toAgent`: `title ?? id[0..8]`; `model = provider/(model ?? "?")`; `contextPct = round(used/max*100)` only if both known and `max>0`; `attention = "permission"` if any pending permission else `attentionReason` when `requiresAttention` else null; `parentId = labels["paseo.parent-agent-id"]`; `turnStartedAt` only while running; `project` = Paseo project name.
- Proposal: KEEP; CHANGE only the model display if circle model ids need different shortening (client `shortModel` strips the provider and turns `[1m]` into ` [1m]`, kit:paseo/plugins/swarm-plugin/client/format.ts:28-31).
- Source: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:20-25,42-64,76-90
- Why it exists: owner rule 2026-10-02, quoted in the source comment as a Vietnamese phrase meaning "once archived, hide it for good" (kit:paseo/plugins/swarm-plugin/server/snapshot.ts:4); the page cap bounds snapshot cost.
- Test idea: with 3 live agents, 1 archived, 1 closed: the snapshot has exactly the 3 live ones; `contextPct` is null for an agent that has not reported usage.

### UI-13 Brain / subagent linking, closed parents, orphans
- Behavior: a subagent is linked to its brain by label `paseo.parent-agent-id`. `ph` stamps it in `createAgent`: `labels: { [PARENT_LABEL]: CALLER, ...labels }` (kit:project/.agents/harness/runtime/daemon.mjs:127), so a caller-supplied label of the same name replaces it (the spread comes after); the constant itself is only exported at kit:project/.agents/harness/runtime/common.mjs:10 (grep line). Parents absent from the list (e.g. status `closed`) are refreshed concurrently (`Promise.all` over the missing ids, snapshot.ts:136; the comment at snapshot.ts:28 says "one by one" but the call is parallel) via `agents.ref(id).refresh()`, each cached 30 s (null results too); a missing/archived/erroring parent puts its children in the orphan bucket (`agent:null`, key `"orphans"`). A closed brain with live subagents is drawn (asleep) as their root. Brains = parents of at least one subagent; sort: brains with a running agent first, orphan bucket last.
- Proposal: KEEP; this is how orchestration trees are recovered, and `ph` already stamps the label.
- Source: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:28,92-105,134-144,223-242; kit:paseo/plugins/swarm-plugin/client/geometry.ts:92-94; kit:paseo/plugins/swarm-plugin/README.md:13-16; kit:project/.agents/harness/runtime/daemon.mjs:127 (the stamp); kit:project/.agents/skills/harness/references/paseo-runtime.md:33 (grep line: the doc that says every agent is created as the caller's subagent)
- Why it exists: README 13-14 (a closed brain whose subagents live is drawn asleep as their root).
- Test idea: archive the parent of two live subagents; the next snapshot shows them under `agent:null`; close (not archive) the parent: it is drawn asleep.

### UI-14 Standalone agents are not drawn
- Behavior: agents with no parent and no children are counted in `standaloneCount` (before the recent filter) and not drawn; the panel footer says "N agents without parent or subagents are not drawn".
- Proposal: KEEP (or OPEN: a flat list in a `.planning` panel).
- Source: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:146-147,248; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:663-667
- Why it exists: not stated.
- Test idea: a lone agent increments the footer count and has no node.

### UI-15 "Active 6h" recent-brain filter
- Behavior: when `recentHours>0` a brain (parent + children) is kept only if any member is running/initializing, has a pending permission, or `updatedAt` is younger than `recentHours`. The client sends `RECENT_HOURS=6` when the toggle `Active 6h` is on (default on) else 0. With the filter off, activity reads still use the default 6 h idle window (`DEFAULT_IDLE_WINDOW_MS`). Empty result: "No swarm is flying right now" with a hint to turn the filter off.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:32-33,149-160; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:33-34,385,396-401,586,605-613
- Why it exists: loading old idle timelines is slow (activity.ts:1-4).
- Test idea: a brain idle for 7 h disappears with the toggle on and reappears with it off.

### UI-16 Activity eligibility and refresh cadence
- Behavior: only drawn agents (brains and their subagents) that are "eligible" get a timeline read: live (running, initializing, or permission pending) or `updatedAt` within the idle window. Due rule per agent: no cache entry -> read; entry has error -> read if `updatedAt`/`status` changed or 30 s elapsed; live -> at most every 1 s; otherwise only when `updatedAt` or `status` changed. Reads run with concurrency 8; one in-flight read per agent (deduped). Cache entries of agents that left the list are deleted.
- Proposal: KEEP (the core of why polling stays cheap).
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:19-26,227-241,253-288,299-321
- Why it exists: "loading the timeline of an old idle session is slow (measured 2026-10-02: ~23 s for 25 brains across all projects)" (activity.ts:3-4).
- Test idea: 25 idle old brains cost no timeline reads after the first poll; a running agent is re-read every ~1 s.

### UI-17 Timeline tail reading and cache merge
- Behavior: the first read of an agent fetches the last 8 timeline items, later reads the last 4 (`projection:"projected"`, `direction:"tail"`), merged into the cache: items converted by `toActivity`, sorted by `at`, `recent` map keyed by activity id (excluding `think`), newest 8 kept; `lastCommand`/`lastReply` updated if `at >=` previous; `seen` id set capped at 300 (oldest dropped); `activity` = newest item or previous. A failed read keeps the previous entry, stores the error, and the error string goes to the snapshot only if it differs from the previous error (no repeating spam). Error text: `timeline <id[0..8]>: <message>`.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:21-26,299-321,323-369
- Why it exists: bounded cost per poll; new-only error reporting.
- Test idea: break the timeline call: one error string appears in `errors` once, not every poll; cached activity is still shown.

### UI-18 Timeline item -> activity kind mapping
- Behavior: kinds `read|edit|write|shell|search|fetch|agent|plan|think|command|reply|tool`. tool_call details: read/edit/write -> same kind with `files:[filePath]`; shell -> `shell` (label via `shellLabel`); search -> `search` (`web: <query>` when toolName is `web_search`); fetch -> `fetch` (URL without scheme); sub_agent -> `agent` (description/subAgentType/name); worktree_setup -> `shell` "worktree <branch>"; plan -> `plan` (first non-empty line); plain_text -> `tool`; unknown -> `describeUnknown`. user_message -> `command`, assistant_message -> `reply`, reasoning -> `think` "thinking", compaction -> `think` "compacting context", todo -> `plan` (label = in-progress activeForm or `done/total todos done`; detail `[x]/[ ]` lines), error -> `tool` with status failed. Other item types (notifications, plugin rows) are not drawn.
- Proposal: KEEP; re-verify against the Paseo timeline schema of the installed version.
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:152-207; kit:paseo/plugins/swarm-plugin/shared/swarm.ts:9-24
- Why it exists: not stated.
- Test idea: a table test feeding one item per type to `describeItem` and asserting kind/label/files.

### UI-19 Unknown-tool heuristics (MCP, PowerShell, streaming Read)
- Behavior: providers report MCP tools, PowerShell and a Read whose input still streams as detail type `unknown`. `describeUnknown(rawName, input)`: MCP name regex `^mcp__(.+?)__(.+)$` shown as `server: tool`; path from `file_path|filePath|path|notebook_path`; batch paths via `batchFilePaths`; order: command present or tool matches `bash|powershell|shell|exec|terminal` -> shell; batch paths -> `edit` if tool matches `edit|write` else `read` (label "N files: A, B, ...", detail newline-joined); `move*` -> `write` with source/destination; `agent|task` -> agent; `read|view|cat|get_file_info` -> read; `edit|replace|patch` -> edit; `write|create_file` -> write; `directory|list_allowed` -> search "dir/"; `grep|glob|search|find` -> search; `fetch|url|browse` -> fetch; else tool.
- Proposal: CHANGE: rebase the name tables on the tool names of the new kit (Claude Code native tools plus the harness-files mod tools), drop the `filesystem`/`fsbatch` MCP names the owner dropped (non-Claude MCP file adapters). Keep the structure (kind by name pattern + generic input keys).
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:104-150; kit:paseo/plugins/swarm-plugin/README.md:29-31
- Why it exists: "seen in timelines 2026-10-02" (activity.ts:105-107).
- Test idea: golden fixtures of real circle-provider worker timelines: every file-touching call yields non-empty `files`.

### UI-20 `batchFilePaths` (single and batch tool inputs)
- Behavior: collects distinct non-blank string paths from `input.paths[]` (strings) and `input.files[].path` / `input.ranges[].path` (object entries), in order, ignoring non-arrays, null, non-objects, non-string paths. Pure function, no transport names.
- Proposal: KEEP the function; CHANGE its key list to the batch input shapes of the harness-files mod (verify the real shapes; `files`+`ranges` match fsbatch `edit_multiple_files`/`read_ranges`).
- Source: kit:paseo/plugins/swarm-plugin/server/file-input.ts:1-16; kit:tests/swarm-file-input.test.mjs:5-10
- Why it exists: CHANGELOG: "Swarm file tracking recognizes batch ranges and batch write/edit input shapes" (kit:CHANGELOG.md:37, grep line).
- Test idea: the four assertions of the old test (ranges; files with a duplicate; paths with null/empty plus files; junk input -> []).

### UI-21 `toActivity` clipping and ids
- Behavior: `id` = tool `callId`, or `<itemType>:<seqStart>` for messages (stable while a call streams); `label` clipped 48 chars (whitespace collapsed, `…`), fallback = kind; `detail` clipped 300 chars (messages 280); `status` = tool status, `failed` for error items, else `completed`; `at` = entry timestamp; `files` deduped, max 24.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:27-31,67-70,209-225
- Why it exists: wire size; a stable id lets a streaming call update in place.
- Test idea: a 5 000-char command yields detail length <= 300 and ends with `…`.

### UI-22 Shell label shortening
- Behavior: from a command pick the first `&&`/`;`/`||` segment not starting with `cd|set|export`, replace every path with its last segment, clip 48 chars. Example `cd C:/x && python tools/paseo/paseo_tool.py queue-feed ...` -> `python paseo_tool.py queue-feed ...`.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:85-89
- Why it exists: readable node labels.
- Test idea: unit test with the commented example plus a Windows path in quotes.

### UI-23 File ledger: holder, handoff, write conflict
- Behavior: in-memory `FileLedger` keyed by lowercase path with `\` -> `/` (only `keyOf`, files.ts:36-38, is the Windows path rule; the time windows are not Windows-specific); entry = last touch `{agentId, op(read|edit|write), at}`, previous touch by another agent, and a `writers` map (agent -> time of its latest edit/write). `record(path, touch)`: new path -> entry, no handoff; for an edit/write the agent's writers time is raised when `touch.at` is newer than the stored one BEFORE the holder check (files.ts:60); then a touch with `at <= holder.at` returns without moving the holder and without a handoff (files.ts:61; "timelines of different agents are read in any order"), so an out-of-order older write still counts as a writer but cannot take the hold; same agent -> updates holder only; different agent -> `prev` set, and a handoff is returned only if `touch.at - before.at <= 15 min`. Time windows: hold 5 min (`FILE_HOLD_WINDOW_MS`), handoff/conflict 15 min (`HANDOFF_WINDOW_MS`), forget after 30 min (deleted lazily in `holds()`); `holds()` counts writers whose time is within 15 min of now (files.ts:82).
- Proposal: KEEP only if the swarm map is kept (OPEN-1). It is the one place the "one writer per file" rule becomes visible.
- Source: kit:paseo/plugins/swarm-plugin/server/files.ts:1-14,36-68
- Why it exists: "paseo.md asks for one writer per file at a time" (files.ts:3-4); replay 2026-10-02 over the last 60 agents: 468 file calls, 438 grouped handoffs, 0 conflicts (README 45-48).
- Test idea: agents A then B write `X.md` 1 min apart -> one handoff and `writers=2`; 20 min apart -> no handoff, `writers=1`; B's write at 10:00 recorded after A's write at 10:05 (A's timeline read first) -> `writers=2`, A stays holder, no handoff.

### UI-24 File holds sent in the snapshot
- Behavior: `holds(drawnAgentIds, nowMs)` returns entries whose holder is drawn and whose last touch is within 5 min, newest first, at most 4 per agent plus every file with `writers>=2`; each hold = `{path,name(basename),op,agentId,at,prevAgentId|null,prevOp|null,writers}`; `prev*` only when within 15 min of the last touch; `writers` counts agents that edited/wrote within 15 min of now. Also returns per-agent counts (`heldFiles`).
- Proposal: KEEP with UI-23.
- Source: kit:paseo/plugins/swarm-plugin/server/files.ts:70-102; kit:paseo/plugins/swarm-plugin/shared/swarm.ts:42-59
- Why it exists: bounds snapshot size; conflicts must never be truncated.
- Test idea: an agent touching 10 files yields 4 holds and `heldFiles=10`; a conflicted file beyond the 4 is still present.

### UI-25 Handoff events
- Behavior: for each file-op activity seen on a non-first read, files are grouped by previous holder (one group per tool call and previous agent); `onHandoff` pushes one `handoff` event per group: text = basename, or `N files: a, b, c, ...` (3 shown), `path` = first file, `peerId` = previous holder, `peerOp` = strongest previous op (write > edit > read, `OP_RANK`), `activity` attached. Client treats `isWriteConflict(prevOp, op)` = prev op is edit/write and current op is edit/write.
- Proposal: KEEP with UI-23.
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:347-355; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:30-31,178-194; kit:paseo/plugins/swarm-plugin/client/palette.ts:138-141
- Why it exists: a review start where ~20 agents read one bundle produces many handoffs (busiest minute 112, README 47-48), hence the grouping and the client budget (UI-45).
- Test idea: one batch read of 7 files previously touched by one agent yields 1 event with text `7 files: ...`.

### UI-26 Event log
- Behavior: `EventLog` in memory: `epoch = "<pid>-<base36 now>"` (changes on plugin restart), monotone `seq`, ring buffer of 500, event text clipped 200. `since(afterSeq, epoch)`: if `afterSeq<0` or the epoch differs -> the newest 40 events (history, not animated); else events with `seq>afterSeq`, at most the newest 200. `lastSeq` is returned every snapshot. Kinds: `spawn, archive, command, report, failed, canceled, permission, permission_resolved, tool, handoff`; fields `seq, at, kind, agentId, parentId, title, text, stats, activity, path, peerId, peerOp`.
- Proposal: KEEP (or DROP if the map is dropped).
- Source: kit:paseo/plugins/swarm-plugin/server/events.ts:8-39; kit:paseo/plugins/swarm-plugin/shared/swarm.ts:146-179
- Why it exists: events are recorded only while the plugin runs (README 58); the epoch lets the screen reset (shared/swarm.ts:187).
- Test idea: restart the plugin; the next snapshot has a new epoch and the client feed resets instead of merging.

### UI-27 Lifecycle recording: prompt capture and turn stats
- Behavior: `agent.created` -> `spawn`; `agent.archived` -> `archive`; `agent.turn_started` -> a `command` event recorded asynchronously (the hook returns immediately): read the last 4 timeline items, take the newest `user_message` if its timestamp >= hook time - 15 s, else retry once after 700 ms; on any error or miss the text is empty; `agent.turn_ended` -> `report`/`failed`/`canceled`; text = last non-empty assistant message / `error.message` / cancel `reason`; `stats` = `"12 read · 3 edit · 2 shell"` counted from the tool calls of the turn, sorted by count desc; `agent.permission_requested` -> `permission` with `request.title ?? request.name`; `permission_resolved` -> `permission_resolved`. Title fallback = id first 8 chars.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/server/events.ts:13-16,41-67,69-114
- Why it exists: the prompt text is not in the hook payload, so it is read from the timeline; the race is handled by a single retry.
- Test idea: send a prompt to an agent: the feed row "got prompt: <first 200 chars>" appears within 2 s.

### UI-28 Tool events on first sight
- Behavior: a tool-kind activity (read, edit, write, shell, search, fetch, agent) first seen in a timeline tail pushes a `tool` event (text = label, activity attached) unless it is on the agent's first read (`known` false). Very short tool calls between two polls can be missed (README 56-58). The client suppresses the extra pop when the same call already produced a handoff (UI-45).
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:34-35,339-346; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:163-177; kit:paseo/plugins/swarm-plugin/README.md:56-58
- Why it exists: README "Limits".
- Test idea: a new agent's first poll emits no `tool` events for its existing history; a new call afterwards emits one.

### UI-29 Run discovery in the OS temp dir (queue and review runs)
- Behavior: `discoverRuns(maxAgeMs, now)` walks `os.tmpdir()` to depth 3, skipping dirs named `node_modules, .git, bundle, paths, cross, fresh, out, inputs` and dot-dirs; a non-root dir with `queue.txt` is a `queue` run; with `PLAN.md` and `paths/` a `review` run; runs whose newest direct-child mtime is older than `runMaxAgeHours` are dropped (client choices 6/24/72 h, default 24 h). Run id = path relative to the temp dir, name = same with `/`. Unreadable dirs count as never modified. Result cached 4 s per `maxAgeMs`. Failures go to `errors` as `runs: <message>`.
- Proposal: DROP unless GSD runs expose comparable on-disk state; `.planning/` is the new state store, so a runs panel should read `.planning/` phases/plans instead (see UI-60+). The temp-dir scan depends on `paseo_tool.py`, absent from this kit.
- Source: kit:paseo/plugins/swarm-plugin/server/runs.ts:1-17,119-158; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:26-27,107-113,123-132; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:35-36
- Why it exists: README 33-34; `paseo.md` told brains to keep run state in `%TEMP%/<run>/` (runs.ts:2).
- Test idea: n/a if dropped; for the replacement, a fixture `.planning/` tree yields the expected phase list.

### UI-30 Queue run reading
- Behavior: files `queue.txt` (items; total = non-empty lines), `NEXT` (1-based number of the next unassigned item; handedOut = clamp(NEXT-1, 0, total), 0 if absent/unparseable), `log.txt` (worker ids = distinct UUIDs found), `failed.txt` (failed = non-empty lines), `config.json` (`title_prefix`, parse errors -> null).
- Proposal: DROP (queue-feed tooling of the old `paseo_tool.py`); if GSD wave progress is shown, model it from `.planning/` plan files.
- Source: kit:paseo/plugins/swarm-plugin/server/runs.ts:3-4,53-75
- Why it exists: not stated.
- Test idea: n/a (dropped).

### UI-31 Review run reading and the `firstLineCount` regex bug
- Behavior: review dir: counts `paths/*.md`; per round `-r<N>.md` in `cross/` (crossFiles, first-line `OPEN-CRITICAL: n` count) and `fresh/` (freshFiles, `NEW-CRITICAL: n`); `FINAL.md` existence; `SUMMARY.md`: `converged = !/NOT CONVERGED/i`, `summaryHead` = first 4 non-empty lines. BUG: `firstLineCount` builds the regex from a template literal `` `^${signal}:\s*(\d+)` ``; in a template literal both `\s` and `\d` are identity escapes, so the RegExp source is `^OPEN-CRITICAL:s*(d+)`. Neither `OPEN-CRITICAL: 3` nor `OPEN-CRITICAL:3` matches (only optional `s` characters followed by literal `d`s would), so every count is 0 in practice.
- Proposal: DROP with UI-29. If kept, fix both escapes (`\\s` and `\\d` inside the template, or a regex literal built per signal).
- Source: kit:paseo/plugins/swarm-plugin/server/runs.ts:77-117
- Why it exists: review-mode verifier convention ("NOT CONVERGED", runs.ts:113).
- Test idea: unit test `firstLineCount("OPEN-CRITICAL: 3\n", "OPEN-CRITICAL")` returns 3 (fails on the old code).

### UI-32 Run activity, brain linkage, ordering
- Behavior: queue run workers = agents named by `log.txt` UUIDs; review run workers = subagents whose `swarmName(title)` equals the run dir name. `brainId` = parent of the first worker whose parent is listed; `active` = any worker running OR run modified within 10 min. Runs sorted active first, then newest. A group's `runIds` = queue runs whose workers intersect the group or whose `title_prefix` equals the group name, or review runs whose dir name equals the group name; a brain's `runIds` = runs with its `brainId`.
- Proposal: DROP with UI-29.
- Source: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:200-221,237; kit:paseo/plugins/swarm-plugin/server/runs.ts:13,159-161
- Why it exists: README Limits: "a review run is tied to its swarm only when the agents carry the default title (run dir name)" (README 57-58).
- Test idea: n/a (dropped).

### UI-33 Swarm grouping by title
- Behavior: `swarmName(title)`: empty -> `(untitled)`; titles matching `^(.+?)\s+(?:#\d+|\d+|L\d+-\d+|fresh F\d+-r\d+|verifier)(?::.*)?$` group by the prefix (formats of `spawn --count` `"<title> #<i>"`, queue `"<prefix> <NN>: <item>"`, review `"<title> L<a>-<b>: <lens>"`, `fresh F<j>-r<n>`, `verifier`); otherwise the text before the first `:`; otherwise the first word (so `Fix SUR-VITALS` and `Fix SUR-DIET` share swarm "Fix").
- Proposal: CHANGE: define one title convention for the new kit's swarms (e.g. `<role> <phase>-<plan>: <task>`), generate it from `ph`, and group on that; keep the first-word fallback. The map must not depend on `paseo_tool.py` formats. Note `ph` stores at most 60 characters of the title (UI-80), so a long title is grouped on a truncated string; carry the swarm name in a label (OPEN-5) instead of depending on the cut.
- Source: kit:paseo/plugins/swarm-plugin/server/group.ts:1-17; kit:project/.agents/harness/runtime/daemon.mjs:123 (60-char cut)
- Why it exists: titles were the only grouping signal.
- Test idea: table test: each documented title format -> expected swarm name; `ph` default titles group correctly.

### UI-34 Snapshot partial-failure semantics
- Behavior: agents listing and run discovery run in parallel; each `.catch` appends `agents: <msg>` / `runs: <msg>` to `errors` and degrades to an empty list; timeline errors are appended; the screen shows the first 3 `errors` (one line each, danger colour) and `Snapshot failed: <msg>` when the RPC itself fails; the header subtitle shows `offline` / `connecting…` / `live · N brains · M swarms`.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:120-132,161-196; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:575,594-599
- Why it exists: not stated.
- Test idea: force `agents.list` to throw: the snapshot still returns with `errors:["agents: ..."]` and the UI shows it.

### UI-35 Client polling loop, cursor and epoch handling
- Behavior: `useQuery(['swarm-snapshot', ageH, recentOnly])` calls `swarm.snapshot` with `{runMaxAgeHours: ageH, recentHours: recentOnly ? 6 : 0, afterSeq: cursor.seq, eventEpoch: cursor.epoch}` every 1 s. Cursor starts `{seq:-1, epoch:null}`; after each response it becomes `{lastSeq, eventEpoch}`. `first` = cursor seq < 0 or epoch changed; `restarted` = epoch was set and changed (sequence numbers restart, so the feed is cleared, not merged). Events on `first` are shown in the feed but never animated (`liveFromSeq` = lastSeq at that point). `nowMs` = snapshot `generatedAt` (server clock), so relative times use the server's clock.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:393-407,456-488,515
- Why it exists: plugins have no push (swarm-surface.tsx:6).
- Test idea: restart the plugin while the screen is open: feed is cleared and refilled from the new epoch, no animation burst for the history.

### UI-36 Appearance bookkeeping (boot, spawn, NEW badge, view change)
- Behavior: on first load agent nodes fade in with a staggered delay (`min(bootIndex*30, 900)` ms, mode `boot`; `bootIndex` is built over `layout.agents` only); hubs (600 ms) and brains (700 ms) fade in once without stagger; an agent first seen later gets mode `spawn` (spring-in) and a `NEW` badge for 12 s (`born` map); toggling `Active 6h` (view key change) makes appearing agents `boot` instead of `spawn`, no NEW badge, and suppresses ghosts. The appear mode is decided at render time because a node mounts once. Per-agent `lastToolAt` entries older than 9 s are pruned.
- Proposal: KEEP only with the map (cosmetic).
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:38-41,409-447,456-475,489-490; kit:paseo/plugins/swarm-plugin/client/nodes.tsx:309-312,459,568
- Why it exists: not stated.
- Test idea: reload the screen: all nodes boot; spawn an agent: only it springs in with NEW for 12 s.

### UI-37 Activity feed state
- Behavior: the client keeps at most 80 events, newest first, deduped by `seq`; incoming events are filtered to agents already on the map (`known`) or whose `parentId` is known (hooks see every agent of the daemon). Rows animate in only if `seq > liveFromSeq`. The panel header shows `N actions/min` = `tool` events in the last 60 s.
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:37,476-488; kit:paseo/plugins/swarm-plugin/client/panels.tsx:365-367,398-432
- Why it exists: not stated.
- Test idea: an event of an agent outside any drawn brain never appears in the feed.

### UI-38 Galaxy layout with stable slots
- Behavior: brain at the left (x = 40 + 150), swarms as hubs to its right stacked vertically, agents on one ring (capacity <= 10) or two C-shaped rings (inner share 42% above 10 slots) whose opening of 70 degrees faces the brain; ring radius >= 172 and sized by 138 px of arc per slot; ring gap 118; cluster gap 24, system gap 90, pad 40. Slot capacity rounds up to tiers `[4,6,8,10,12,16,20,24,30,36,48,64,96,128]` (then multiples of 32) so positions move only when a swarm crosses a tier. `SlotBook` (kept across renders per hub): an agent keeps its slot while it lives; a freed slot cools down 4 s so a new agent does not land on an archived agent's ghost; if the max used slot exceeds the tier of the live count the swarm is renumbered by slot order to shrink. Layout size (`width`,`height`) feeds the zoom: default fit-width is clamped to 0.4..1 (never enlarges past 1); manual zoom is 0.4..1.6 in steps of 0.1 (UI-48).
- Proposal: KEEP only with the map; the slot-stability idea is the part worth reusing in any live layout.
- Source: kit:paseo/plugins/swarm-plugin/client/geometry.ts:1-5,13-37,100-138,145-170,191-236; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:46-49,561-562,588-591
- Why it exists: owner dropped the tree layout 2026-10-02 (README 8-10); stable slots so spawns/archives do not move other agents (geometry.ts:3-4).
- Test idea: spawn then archive one agent in a 6-agent swarm: coordinates of the other 5 do not change.

### UI-39 Agent state model and what is drawn
- Behavior: `agentState`: `waiting` if attention is `permission`; `error` if status `error` or attention `error`; `working` if status `running|initializing`; else `sleep` (idle, finished, closed brain root). Archived and closed agents are never drawn (an archived one fades into its hub once, then is gone). `sleep` nodes: 0.5 opacity, moon icon, drifting "z", label `sleeping 12m`, faded link; a brain is drawn asleep when neither it nor any child works. Status colours: waiting=statusWarning, error=statusDanger, working=statusSuccess, else muted. Header counters: running / sleep / waiting / error / `ctx >= 50%` / `write conflicts` (only if > 0).
- Proposal: KEEP.
- Source: kit:paseo/plugins/swarm-plugin/client/palette.ts:78-121; kit:paseo/plugins/swarm-plugin/client/nodes.tsx:20-22,304-306,572-577; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:578-583; kit:paseo/plugins/swarm-plugin/README.md:11-14
- Why it exists: owner 2026-10-02: an agent that is not doing anything is "sleep" (palette.ts:78).
- Test idea: table test over status/attention combinations for `agentState`.

### UI-40 Agent node rendering
- Behavior: circle of radius 26 with a context ring (progress = `contextPct/100`, accent, `statusWarning` from 50%), centre glyph, halo + spinning dashed ring while running, blinking orange ring while waiting for permission, white selection ring; badges: item badge top-right (from the title, `08`, `L1-2`, `F1-r2`), `NEW` top-left, permission shield / error X / `NN%` bottom-right. Centre glyph while running by activity kind: read/fetch = scan line, edit/write = wiggling pen, shell = blinking cursor, search = orbiting magnifier, others = breathing icon + typing dots; when not running it is the status icon. Label box 150x58: short title, a dot + `activityLine` (`reading X`, `ran X`, `prompt: ...`, `says: ...`; sleeping -> `sleeping 12m · <last activity>`), and up to 2 file chips (+N for the rest; chip red with a triangle when `writers>=2`). Accessibility label `<title>, <state>`.
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/nodes.tsx:174-254,256-435
- Why it exists: README 17-20.
- Test idea: snapshot (visual) test per state: running-read, waiting, error, sleeping, ctx 62%.

### UI-41 Hub (swarm) node
- Behavior: radius 42; centre icon `ListChecks` for a queue run, `ScanSearch` for a review run, else `Network`, plus agent count; ring progress = `handedOut/total` for a queue run, else `running/agents`; counters (running, sleep, waiting, error) with coloured dots; run line `queue 3/10 · 1 failed`, `review verified`, `review NOT CONVERGED`, `review r2 · crit N`, `review · N paths`; spinning rings when any agent runs.
- Proposal: CHANGE: progress from `.planning` wave/plan completion instead of queue runs; drop the review line.
- Source: kit:paseo/plugins/swarm-plugin/client/nodes.tsx:437-549
- Why it exists: not stated.
- Test idea: a hub with 2 of 4 agents running shows ring 50%.

### UI-42 Brain node
- Behavior: radius 62; Brain icon + `ctx N%`; dashed ghost circle with "Ghost" icon and `ORPHANS` badge for the orphan bucket (label "N subagents without a live brain", project text "parent archived or unknown"); when busy (brain or any child running): breathing halo, two spin rings, three orbiting electrons; label card shows `BRAIN` badge + project name, title (2 lines), state + `turn m:ss` + short model, activity line, and `N swarms · N agents · N running · N sleep`.
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/nodes.tsx:551-686
- Why it exists: README 15-20.
- Test idea: orphan bucket renders `ORPHANS` and no context ring percentage.

### UI-43 Ghosts of vanished agents
- Behavior: when an agent present in the previous layout is absent from the current one (and the view filter did not just change) a ghost plays for 1.7 s (`useOneShot(1700)`): a dashed Archive circle translates 35% of the vector toward its hub, rotates -120 degrees, scales to 0.15 and fades, with a tag `<reason> · <badge> <label>`. Reason = `archived` (an `archive` event for it arrived in this poll) or `gone` (filtered out, e.g. its brain went quiet); the code also has a `closed` branch (previous status `closed`) that the listing rules make unreachable, because children come only from the live list which excludes `closed` (snapshot.ts:24-25,140-143).
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:491-513; kit:paseo/plugins/swarm-plugin/client/nodes.tsx:688-757; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:24-25,140-143
- Why it exists: owner rule: archived agent "fades into its hub once, then is gone" (README 11-12).
- Test idea: archive a drawn agent: one ghost with reason `archived` for ~1.7 s, then nothing.

### UI-44 Links, flow particles and packets
- Behavior: links are polylines drawn as rotated Views (no SVG): active links get a wide faint underlay; dim links (sleeping) fade; running swarm edges carry 4 blue dots, running agent edges 2 dots; dots follow the shared `flow` clock, phase-shifted; the selected agent's brain->hub->agent path is highlighted. `Packet` (230 px pill or 26 px icon-only) flies along a polyline once with scale/opacity easing, then calls `onDone`; `Burst` expanding ring (0.9 s), `Sparks` 10 particles over 1.1 s.
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/links.tsx:1-246; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:192-214
- Why it exists: README 21-24.
- Test idea: n/a beyond visual smoke test.

### UI-45 Event -> animation mapping and budgets
- Behavior: `command` -> blue packet brain->hub->agent 1.8 s (brain-only: from 230 px above the brain 1.5 s) + arrival burst; `report`/`failed`/`canceled` -> burst on the agent + packet agent->brain (green, or red) 1.8 s; `spawn` -> violet sparks + rocket packet along the hub edge 0.9 s; `permission` -> orange burst + packet toward the brain 1.6 s; `tool` -> small icon packet, one per agent per 900 ms, direction by kind (read/fetch/search come in, edit/write go out up-right, shell up, agent up-left), skipped if the same activity id already produced a handoff; `handoff` -> an arc packet with the file text from the previous holder's file anchor to the new holder's (duration 0.9-2 s by distance; red + warning icon + burst at the source on a write conflict; `Files` icon when text starts with `N files:`), at most 8 per poll, handoffs sorted first then newest first so the latest survive the budget; source of a vanished agent uses its last known position. Not animated on the first call. At most 60 effects alive (oldest dropped).
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:38-45,54-61,272-380,444-454,515-523
- Why it exists: "a review start hands one bundle file to ~20 agents in a few seconds" (swarm-surface.tsx:44).
- Test idea: feed 30 handoff events in one poll: at most 8 packets, newest kept.

### UI-46 Shared animation clocks
- Behavior: four looping 0->1 `Animated.Value` clocks (flow 1.6 s, pulse 2.2 s, spin 9 s, blink 1 s) created once by `useClockSource`, provided by `ClockContext`; every continuous animation derives from them (phase shift, multiply, modulo), so the number of running loops is constant regardless of agent count. Only transform and opacity animate, so the native driver is on for iOS/Android and off on web. Helpers: `useAppear` (mount-only 0->1, optional spring), `useSmooth` (follow a number), `useOneShot` (one-shot with `onDone`).
- Proposal: KEEP only with the map; the single-clock design is the lesson.
- Source: kit:paseo/plugins/swarm-plugin/client/anim.ts:1-115
- Why it exists: bounded animation cost (anim.ts:1-3).
- Test idea: with 100 agents, the count of active Animated loops stays 4.

### UI-47 Ring component without SVG
- Behavior: circular progress drawn with two clipped half-rings (border colours on top/right, rotated by `360p-135`, right half for p<=0.5, left for the rest).
- Proposal: KEEP as a small utility if a progress ring is wanted; if the host later offers SVG, replace.
- Source: kit:paseo/plugins/swarm-plugin/client/ring.tsx:1-53
- Why it exists: "no SVG in the plugin host" (ring.tsx:1).
- Test idea: p=0, 0.25, 0.5, 0.75, 1 render the expected arc extents.

### UI-48 Header, toggles, zoom
- Behavior: header shows icon + `SWARM` + status text, stat chips (above), toggle `Active 6h`, zoom out / `NN%` / zoom in / fit-to-width buttons (zoom state null = fit; fit = clamp(viewport-8)/layout width between 0.4 and 1). Canvas is a two-axis `ScrollView` with a scaled and translated inner View (transform scale about the centre), grid background 48 px with 35%-opacity lines, faint nebula and dashed orbit rings per hub.
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:89-170,561-646
- Why it exists: README 8.
- Test idea: zoom in at fit 0.8 goes to 0.9 (rounded to 0.1) and the label shows 90%.

### UI-49 Inspector (brain / swarm / agent)
- Behavior: click toggles selection (same node again deselects); a selection whose node vanished closes the inspector. Agent inspector: ring + glyph, title with badge, state + turn timer, chips (model, thinking, mode, `ctx N% · used/max` with k/M formatting, short id, `created Xm ago`), a "Now/Last" box with full path/command (monospace, 4 lines), LAST PROMPT / LAST REPLY quotes (5 lines) from `swarm.agent-detail`, FILES HELD (name, op verb, `from <agent> (op)`, `N writers!`, age; "and N more"), RECENT ACTIONS (icon, verb+label, status icon, age; "No actions in the last timeline items."). Swarm inspector: stacked status bar, count chips, run cards, agent rows (badge+label, activity or sleeping, ctx%) selectable. Brain selection shows the brain as an agent.
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/panels.tsx:101-331; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:530-556,648-661
- Why it exists: README 32-34.
- Test idea: select an agent, close via X, press the same node twice: inspector closes both ways.

### UI-50 Live activity feed rows
- Behavior: row text per kind: `spawned`, `archived`, `got prompt: <text>` (or `got a prompt`), `reported: <text>` (or `finished its turn`), `turn failed: <text>`, `turn canceled[: reason]`, `needs permission: <title>`, `permission answered`, tool = `<past verb> <label>`, handoff = `<verb> <file> · from <peer> (<op>)` or on conflict `also <verb> <file>: <peer> wrote|edited it too (2 writers)`; title = basename-shortened agent title (40 chars), age, optional turn `stats` line; row click selects the agent; conflict rows red with a triangle.
- Proposal: KEEP only with the map.
- Source: kit:paseo/plugins/swarm-plugin/client/panels.tsx:333-396
- Why it exists: README 34.
- Test idea: n/a beyond text table tests of `eventText`.

### UI-51 Runs panel and run cards
- Behavior: section `Runs (N)` with age buttons 6h/24h/72h (default 24h; changing refetches because the query key includes `ageH`); a card per run: kind icon, name, live dot if active, age; queue card = animated progress bar `handedOut/total`, `N failed · N workers · prefix "..."`; review card = step chips `paths N > r1 crit N > fresh N > verified|NOT CONVERGED|verifier` with first 2 summary lines. Empty: "No queue or review run changed in the chosen time span."
- Proposal: DROP with UI-29 (a phase/plan progress card replaces it in the `.planning` panel).
- Source: kit:paseo/plugins/swarm-plugin/client/panels.tsx:76-99,436-519; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:35-36,661
- Why it exists: README 33-34.
- Test idea: n/a (dropped).

### UI-52 Legend, palette and icons
- Behavior: a legend lists 13 icon/colour meanings plus ring and hub-ring explanations. Fixed decorative hues: prompt blue `#7AA2F7`, spawn violet `#BB9AF7`, read sky `#7DCFFF`, search cyan `#2AC3DE`, edit gold `#E0AF68`, write orange `#FF9E64`, shell teal `#73DACA`, plan sand `#D4B062`; `statusWarning` is reserved for permission and context ROTATE, `statusDanger` for errors, `statusSuccess` for running work and reports. Icon names are lucide names resolved by the host `Icon` and checked against Paseo 0.10.0's icon set (an unknown name must be re-checked after Paseo upgrades). `MONO_FONT` Menlo on iOS, `monospace` otherwise.
- Proposal: KEEP the semantic colour rules; re-verify icon names against the installed Paseo.
- Source: kit:paseo/plugins/swarm-plugin/client/palette.ts:1-164; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:689-718
- Why it exists: palette.ts:1-3 (readable on light and dark themes).
- Test idea: a script resolves every icon name used against the host icon set.

### UI-53 Text helpers
- Behavior: `ago` (s/m/h/d), `clock` (m:ss or h:mm:ss), `tokens` (`?`, `1.5M`, `12k`), `shortModel`, `baseName`, `withBaseNames` (paths -> last segment), `shortTitle(title, swarm)` (strip the swarm prefix, leading `#n|n|Ln-m|Fn-rn` becomes the badge, paths shortened), `agentTag` (`CLEAN 08`), `firstLine`, `clip` (whitespace collapse, `…`).
- Proposal: KEEP; CHANGE `shortTitle`/`agentTag` regexes to the new title convention (UI-33).
- Source: kit:paseo/plugins/swarm-plugin/client/format.ts:1-74
- Why it exists: not stated.
- Test idea: unit tests per helper including the documented examples (format.ts:28,49,60).

### UI-54 Compact (mobile) layout and empty states
- Behavior: `layout.compact` stacks canvas (min height 420) above the panel inside one ScrollView; wide layout is canvas + 380 px side panel. Empty: telescope icon + "No swarm is flying right now". The panel hint "Click a brain, swarm or agent to inspect it: prompt, reply, recent file reads and edits." shows while nothing is selected.
- Proposal: KEEP the compact/wide split rule for any new panel.
- Source: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:50,603-613,648-686
- Why it exists: README 90 "works on mobile" via RN primitives.
- Test idea: compact=true renders no horizontal split.

### UI-55 Read-only guarantee
- Behavior: swarm never sends prompts, spawns, archives or writes files; server only fetches timelines, lists agents and reads temp files. Backlog plugin is also read-only (manifest description: "Read-only Backlog.md board, list and task detail"); its CLI calls are `task list/view`, `config get`, `doc list/view/search` only.
- Proposal: KEEP read-only as the rule for the new panel.
- Source: kit:paseo/plugins/swarm-plugin/README.md:3-4; kit:paseo/plugins/swarm-plugin/server/activity.ts:8; kit:paseo/plugins/backlog-plugin/paseo-plugin.json:3; kit:paseo/plugins/backlog-plugin/server/backlog-handlers.ts:76,102
- Why it exists: safety of the observer.
- Test idea: grep gate: no write/spawn/archive SDK calls in plugin sources.

### UI-56 Context-rotate threshold hard-coded
- Behavior: `ROTATE_PCT = 50` is a client constant ("context use at which `paseo_tool.py context` flags ROTATE"); orange ring/badge and the header chip `ctx >= 50%` use it.
- Proposal: CHANGE: read the threshold from the same place as the new kit's context guard (single source of truth) or make it a plugin setting; OPEN-2.
- Source: kit:paseo/plugins/swarm-plugin/client/nodes.tsx:15-16; kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:582
- Why it exists: mirror of an old tool threshold.
- Test idea: changing the configured threshold changes ring colour and chip count with no code edit.

### UI-57 Scale and cost caps (summary)
- Behavior: 5 pages x 200 agents; 8 parallel timeline reads; tail 8/4 items; 300 seen ids; 8 recent; 500 events kept, 40 history, 200 per call; 4 holds per agent; 24 files per activity; 80 feed rows; 60 effects; 8 handoff chips per poll; runs cached 4 s, parents 30 s. Measured 2026-10-02: first snapshot 66 ms, then ~30 ms per poll at 34 KB (default filters), 84 KB with all brains, 146 KB with closed agents.
- Proposal: KEEP the discipline (every cap a named constant); re-measure on the new kit.
- Source: kit:paseo/plugins/swarm-plugin/server/activity.ts:19-33; kit:paseo/plugins/swarm-plugin/server/events.ts:8-12; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:20-33; kit:paseo/plugins/swarm-plugin/README.md:53-54
- Why it exists: README measurements.
- Test idea: a load script with 100 fake agents keeps the poll under an agreed budget (OPEN).

### UI-58 Documentation dependency on non-existent tools
- Behavior: README, comments and `group.ts`/`runs.ts` cite `tools/paseo/paseo_tool.py`, `paseo.md` and `paseo.sh plugin reference`; none exists in the tag (only `ph` and `paseo-runtime.md`). CONFLICT: docs describe `paseo_tool.py` as the spawner of the label and titles, while `ph` now stamps `paseo.parent-agent-id` (write at kit:project/.agents/harness/runtime/daemon.mjs:127; paseo-runtime.md:33 is the doc that matches it, not proof of the write; it also does not by itself prove `paseo_tool.py` is absent: absence was checked with `git ls-tree` of the tag, which listed no `paseo_tool` or `paseo.md` file).
- Proposal: CHANGE: new docs describe `ph` only; the grouping and run conventions are re-specified (UI-33).
- Source: kit:paseo/plugins/swarm-plugin/README.md:3-4,15,62-69; kit:paseo/plugins/swarm-plugin/server/group.ts:1-4; kit:paseo/plugins/swarm-plugin/server/runs.ts:1-4; kit:project/.agents/skills/harness/references/paseo-runtime.md:33 (grep line)
- Why it exists: the plugin predates `ph`.
- Test idea: doc lint: no reference to a file that does not exist in the repo.

### UI-59 Test coverage of the UI area
- Behavior: only `batchFilePaths` has a test (`tests/swarm-file-input.test.mjs`, node:test, imports the `.ts` file directly, so it needs Node type stripping). No tests for ledger, event log, grouping, run parsing, geometry, `describeItem`.
- Proposal: CHANGE: pure modules (`describeItem`, `FileLedger`, `swarmName`, geometry slot assignment, markdown parser, frontmatter parser) get unit tests in the new kit.
- Source: kit:tests/swarm-file-input.test.mjs:1-10
- Why it exists: not stated.
- Test idea: the new kit's test run covers each pure module named above.

### UI-60 backlog-plugin as a whole (DROP) and what a `.planning/` panel can take from it
- Behavior: read-only Backlog.md board/list/stats + task detail + docs tree/reader, in three entry points: sidebar surface (with project picker), workspace panel, command-center item (UI-02). Everything data-related shells out to the `backlog` CLI.
- Proposal: DROP the plugin (owner: Backlog.md dropped entirely). Reuse map for a `.planning/` panel: server contracts UI-62/63/65/66; client kit UI-71, markdown UI-72, docs tree/reader UI-73, picker UI-68/69, split-pane/trail UI-70, stats tiles UI-75, section tabs UI-78, colour/format helpers UI-77, board/list adapted UI-74/76. Not reusable: CLI runner, CLI parsers, status/priority/assignee model, acceptance criteria.
- Source: kit:paseo/plugins/backlog-plugin/paseo-plugin.json:3; kit:paseo/plugins/backlog-plugin/index.client.tsx:8-34; kit:paseo/plugins/backlog-plugin/index.server.ts:7-14
- Why it exists: CHANGELOG line 56 lists both plugins as kit content (kit:CHANGELOG.md:56, grep line).
- Test idea: n/a.

### UI-61 Backlog CLI runner (DROP)
- Behavior: `runBacklog(cwd,args)` spawns the CLI with `NO_COLOR=1`, `ELECTRON_RUN_AS_NODE=1`, hidden window; timeout 20 s (kill, code `timeout`), stdout cap 16 MiB (kill, `invalid_output`), exit != 0 classified from stderr+stdout by regex: `no backlog.md project found` -> `no_backlog`; command-not-found/ENOENT -> `cli_unavailable` with an install hint; `not found` -> `not_found`; else `failed` (first 500 chars). Launcher: env `BACKLOG_BIN` override; on Windows, if `%APPDATA%/npm/node_modules/backlog.md/cli.js` exists run `node cli.js` directly (node from `BACKLOG_NODE`, `%APPDATA%/npm/node.exe`, Program Files, or `process.execPath`) because the daemon's PATH lacks npm and node and the `.cmd` shim needs both. `runBacklogJson` parses stdout JSON or `invalid_output`.
- Proposal: DROP. Lesson to keep: a daemon-side plugin must not rely on the user's PATH; for `.planning/` read files with `node:fs` (swarm `runs.ts` already does), no subprocess.
- Source: kit:paseo/plugins/backlog-plugin/server/backlog-cli.ts:1-133
- Why it exists: comment at backlog-cli.ts:27-28 (daemon Windows PATH often lacks npm global dir and node).
- Test idea: n/a (dropped); for the replacement, a unit test reads a fixture `.planning/` with no subprocess.

### UI-62 Workspace directory resolution (REUSE)
- Behavior: `workspaceDirectory(paseo, workspaceId)`: `handle = paseo.workspaces.ref(id)`; `snapshot = handle.current() ?? await handle.refresh()`; directory = `snapshot.workspaceDirectory ?? handle.directory`; throws `Workspace <id> has no directory` otherwise. Every handler wraps it in try/catch and returns the `ok:false` envelope with the directory it had resolved so far.
- Proposal: KEEP verbatim as the entry of every `.planning` RPC (input `{workspaceId}`).
- Source: kit:paseo/plugins/backlog-plugin/server/backlog-handlers.ts:57-66,68-93
- Why it exists: plugin RPCs are workspace-scoped and the daemon, not the client, knows the directory.
- Test idea: RPC with an unknown workspace id returns `ok:false` with a message, never throws.

### UI-63 Tolerant payload normalization (zod)
- Behavior: `.nullish().transform(v => v ?? default)` for every optional field; element shapes the CLI does not document are read from `unknown` by trying known string keys (`textOf(value, keys)`: string itself, else first non-empty string among keys; comments try body/text/content/message, author/user/name, createdAt/date/timestamp/created); malformed required fields fail the whole parse and surface as an `ok:false` `failed` envelope.
- Proposal: KEEP the pattern for parsing `.planning/` frontmatter and STATE files that hand-edited or agent-written files may have partially.
- Source: kit:paseo/plugins/backlog-plugin/server/backlog-normalize.ts:1-138
- Why it exists: "The CLI does not document the element shape of these lists" (backlog-normalize.ts:81).
- Test idea: a plan file with missing optional frontmatter keys still lists with defaults.

### UI-64 Project config cache (DROP)
- Behavior: `config get projectName` / `config get statuses` via CLI, cached 60 s per directory; statuses fall back to the distinct task statuses.
- Proposal: DROP; analogue: cache parsed `.planning/` metadata keyed by mtime.
- Source: kit:paseo/plugins/backlog-plugin/server/backlog-handlers.ts:13-47,75-89
- Why it exists: avoids two CLI spawns per 5 s poll.
- Test idea: n/a.

### UI-65 Docs directory discovery and id->path index (REUSE the approach)
- Behavior: `findDocsDirectory(start)`: from the workspace dir up to 4 parent levels, first existing `<dir>/backlog/docs` or `<dir>/.backlog/docs`. `listMarkdownFiles` walks it (iterative stack). `readDocumentId(file)` reads the first 4096 bytes, takes `id:` from the frontmatter (quotes stripped), else filename `doc-N - ...`. Ids resolve to paths relative to the docs dir with `/`; first path wins on duplicate ids; files read in batches of 48; result cached 10 s per directory.
- Proposal: CHANGE to `.planning/`: find `<workspace>/.planning` (and optionally parent levels), index phase/plan files by relative path; keep the bounded head-read and batch size idea.
- Source: kit:paseo/plugins/backlog-plugin/server/docs-paths.ts:1-92
- Why it exists: the CLI list output lacks paths, so folder structure had to be rebuilt from disk (kit:paseo/plugins/backlog-plugin/client/docs-view.tsx:322-326 warns when no docs directory is found).
- Test idea: 200 plan files index in under an agreed time and a second call within 10 s hits the cache.

### UI-66 Frontmatter + body parser (REUSE)
- Behavior: `splitFrontmatter`: normalise CRLF, require `---` first line and a closing `---`; supports `key: value`, quoted values (single with `''`, double with `\"`), inline lists `[a, b]`, and block lists (`key:` followed by `  - item`); keys `[A-Za-z0-9_.-]+`; body is the remainder. `parseDocView`: empty output or `Document ... not found` (CLI prints this on stderr with exit 0) -> `not_found`; reserved fields id/title/type/owner/depends_on are lifted, remaining fields shown as properties (max 12, empty ones skipped, lists joined by `, `); a leading `# Heading` line is stripped from the body.
- Proposal: KEEP the parser (needed for `.planning/*.md` frontmatter such as GSD plan/summary files); CHANGE reserved fields to the GSD frontmatter keys; the "missing doc exits 0" handling is CLI-specific (DROP).
- Source: kit:paseo/plugins/backlog-plugin/server/docs-parse.ts:1-131
- Why it exists: not stated; CLI quirk comment at docs-parse.ts:111.
- Test idea: parse fixtures with each value form (quoted, inline list, block list, CRLF, no frontmatter, unclosed `---`).

### UI-67 Doc list/search via CLI (DROP)
- Behavior: `backlog doc list --plain` lines `<id> - <title>` (skip `Showing ` lines, dedupe ids); `doc search --limit 50 -- <query>` with the query as one argv entry after `--` (no shell, cannot inject options); search line regex extracts id/title/path/type/tags/score; client uses remote search when the debounced query has >=2 chars, else a local token filter over id/title/path; results sorted naturally by id.
- Proposal: DROP the CLI parsing; KEEP the client-side token filter and natural sort for the file tree (UI-73).
- Source: kit:paseo/plugins/backlog-plugin/server/docs-parse.ts:4-6,80-109; kit:paseo/plugins/backlog-plugin/server/docs-handlers.ts:10-61; kit:paseo/plugins/backlog-plugin/client/docs-model.ts:122-130; kit:paseo/plugins/backlog-plugin/client/docs-view.tsx:120-150
- Why it exists: comment docs-handlers.ts:48.
- Test idea: filter `"plan 03"` matches path tokens in any order.

### UI-68 Project grouping, MRU and picker (REUSE)
- Behavior: `toProjects(workspaces)` drops workspaces with `archivingAt`, groups by `projectId`, picks one representative per project (kind rank `local_checkout < directory < checkout < worktree`, then pinned first, then name) because "the main checkout holds the canonical backlog; worktrees carry a branch-local copy"; projects sorted by name. `pushRecent` keeps the 5 most recent project ids (MRU, deduped). `buildRows`: with a query, token-AND filter over `name + rootPath` (flat); without, a `Recent` header + `All projects`. `ProjectPicker`: a bar with the current project and count, a modal with an autofocus search box (Enter picks the first match), list height clamp(55% of window, 300..520), empty state "No projects match". Rows show name, last two path segments (mono), `N workspaces` badge, check mark.
- Proposal: KEEP for `.planning` (the canonical `.planning/` also lives in the main checkout; GSD worktrees carry branch-local copies, which the kit may rather want shown): OPEN-3.
- Source: kit:paseo/plugins/backlog-plugin/client/projects.ts:1-114; kit:paseo/plugins/backlog-plugin/client/project-picker.tsx:1-216
- Why it exists: comment projects.ts:31.
- Test idea: two workspaces of one project (checkout + worktree) yield one entry with `workspaceCount 2` and the checkout as representative.

### UI-69 Sidebar surface behaviour (REUSE)
- Behavior: surface lists workspaces with `usePaseo().workspaces.list()` every 15 s (`keepPreviousData`); selected project = most recent in a module-level `recentByHost` Map (survives surface unmount/remount, keyed by host id) else the first project; states: error ("Could not list projects" + Retry), loading, none ("No projects on this host"); the picker is shown only when there is more than one project; the inner workspace view is re-keyed by `workspaceId` so state resets on project change.
- Proposal: KEEP.
- Source: kit:paseo/plugins/backlog-plugin/client/surface.tsx:1-87
- Why it exists: comment at surface.tsx:12.
- Test idea: switch project, leave the sidebar item, come back: the same project is selected.

### UI-70 Workspace panel: split pane, trail, sections (REUSE)
- Behavior: `BacklogWorkspace` keeps `trail` (stack of opened ids): select resets it to `[id]`, following a link pushes (no duplicate on top), back pops; split (list left, detail right, pane width clamp(40% of width, 380..480)) when not compact and width >= 960, else the detail replaces the list with a Back button; toolbar mode defaults to `list` on compact, `board` otherwise; a 30 s tick refreshes `nowMs` for relative times; refresh button with spinner and `stale` dot ("Live · HH:MM:SS" or "Reconnecting"); states for transport error, `ok:false`, loading, empty, filter-empty (with "Clear filters").
- Proposal: KEEP the interaction model for phases -> plans -> tasks drill-down.
- Source: kit:paseo/plugins/backlog-plugin/client/panel.tsx:1-213
- Why it exists: not stated.
- Test idea: open item A, follow link to B, Back returns to A, Close (wide) clears the trail.

### UI-71 UI kit primitives (REUSE)
- Behavior: `KitProvider/useKit` (`colors`, `compact`), `T` text (tones foreground/muted/accent/success/warning/danger/onAccent, mono, strike, upper, lines, selectable, line-height 1.45), `Press` (accessible button with hover style, pressed opacity, role button/link/tab, selected/disabled state), `Section` card, `MetaRow` (84 px label), `Dot`, `Badge` (tinted pill), `ProgressBar`, `SegmentedBar`, `Chip` (filter toggle), `IconButton` (spinner when busy), `ActionButton`, `AvatarStack` (initials; drop for `.planning`), `StatePanel` (icon tile, title, body, action, busy), `withAlpha(hex, a)` (3/4/6/8-digit hex -> rgba; non-hex passes through).
- Proposal: KEEP as the base component set; drop `AvatarStack`.
- Source: kit:paseo/plugins/backlog-plugin/client/kit.tsx:1-414; kit:paseo/plugins/backlog-plugin/client/color.ts:1-21
- Why it exists: not stated.
- Test idea: `withAlpha("#fff", 0.5)` -> `rgba(255, 255, 255, 0.500)`; non-hex input unchanged.

### UI-72 Markdown renderer (REUSE)
- Behavior: no library; `parseMarkdown` builds blocks: heading 1-6, paragraph, fenced code (``` or ~~~), bullet/numbered list with depth (2 spaces, max 3) and `[ ]`/`[x]` checkboxes (rendered as ballot-box glyphs) and wrapped continuation lines, blockquote, rule, table (pipe rows, separator row marks a header). Inline: code spans, `**bold**`/`__bold__`, `*italic*`, `[label](url)`, bare `http(s)` URLs, and ids of the form `\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\.[A-Z0-9]+(?:-[A-Z0-9]+)*)*\b` (dotted segments allowed, markdown.tsx:135) that appear in `knownIds` become tappable links (`onOpenId`); only `http(s)` links open, via `openExternalUrl`. Code in backticks that equals a known id is also a link. Text is selectable. No images, no nested emphasis, no HTML.
- Proposal: KEEP; CHANGE the id pattern and `knownIds` to phase/plan ids (e.g. `03-02`, `PLAN-...`) and make file-path references tappable.
- Source: kit:paseo/plugins/backlog-plugin/client/markdown.tsx:1-324
- Why it exists: not stated.
- Test idea: parser unit tests for each block; a known id inside prose becomes a link, an unknown one stays plain text.

### UI-73 File tree model, docs view and reader (REUSE)
- Behavior: `buildTree(docs, expansion)` builds folder/file rows from relative paths: folders sorted naturally (the `No folder` bucket last), single-child folder chains merged ("a/b"), counts per folder, files sorted naturally; default expansion = top-level folders; "Expand all / Collapse all"; opening or following a doc reveals its ancestor folders; search replaces the tree with a flat result list; list pane 360 px beside the reader when width >= 820 and not compact; reader: title, id, type/owner badges, Properties card, Depends-on cards (link when the id is known, "Not in this backlog" otherwise), markdown body (max width 820), copy-id button with toast; `not_found` shows "<id> no longer exists".
- Proposal: KEEP for a `.planning/` file browser (PROJECT/ROADMAP/STATE, phase dirs, plans, summaries); CHANGE labels and the Depends-on source to GSD frontmatter.
- Source: kit:paseo/plugins/backlog-plugin/client/docs-model.ts:1-130; kit:paseo/plugins/backlog-plugin/client/docs-view.tsx:1-354; kit:paseo/plugins/backlog-plugin/client/doc-reader.tsx:1-194; kit:paseo/plugins/backlog-plugin/client/docs-data.ts:1-17
- Why it exists: "as in VS Code" folder merge comment (docs-model.ts:63).
- Test idea: `buildTree` on `["a/b/c.md", "a/b/d.md", "e.md"]` yields folder `a/b` (count 2) then `e.md`.

### UI-74 Board, list, toolbar, filters (ADAPT)
- Behavior: tasks grouped by status columns (board columns 272..380 px, mobile 86% width; list view with collapsible groups); toolbar: project name, `N tasks`, `% done` (status matching `done|complete|closed`), segmented status bar, search (id/title/type/milestone/labels/assignees), chips Ready / priority / labels, "Clear · shown/total"; Board|List|Stats mode toggle; priority order high<medium<low; labels sorted by usage.
- Proposal: CHANGE: board columns become GSD states (e.g. discussed / researched / planned / executing / verified) and rows phases or plans; drop assignees, labels, priorities, ready.
- Source: kit:paseo/plugins/backlog-plugin/client/board.tsx:1-194; kit:paseo/plugins/backlog-plugin/client/toolbar.tsx:1-215; kit:paseo/plugins/backlog-plugin/client/model.ts:1-89; kit:paseo/plugins/backlog-plugin/client/task-views.tsx:1-197
- Why it exists: not stated.
- Test idea: `groupByStatus` keeps empty columns in the configured order.

### UI-75 Stats view (ADAPT)
- Behavior: tiles Total / Done / Ready / Blocked / Overdue / Unassigned / Criteria met; bars by status and priority; 14-day "updated per day" bar chart with hover/press readout; open work by assignee (top 8); top labels; "Needs attention" (overdue or blocked, top 6, tappable). `computeStats` is pure and takes `nowMs`.
- Proposal: CHANGE to phase progress, plans per wave, tasks done, last-updated per day from file mtimes, blocked = unmet dependency; keep the tile + bar + day-chart components.
- Source: kit:paseo/plugins/backlog-plugin/client/stats.ts:1-176; kit:paseo/plugins/backlog-plugin/client/stats-view.tsx:1-322
- Why it exists: not stated.
- Test idea: `computeStats` on a fixture with 2 done / 3 open phases returns done=2, open=3.

### UI-76 Task detail pane (ADAPT)
- Behavior: header with Back / id / copy id / copy file path / close; body sections Details (assignees, reporter, labels, milestone, parent link, due, created, updated), Description, Acceptance criteria and Definition of done (checklist with progress), Implementation plan / notes / Final summary (markdown), Subtasks, Depends on (warn border for blocking), References, Comments; polls 5 s; `not_found` -> "<id> no longer exists".
- Proposal: CHANGE to plan detail: goal, tasks with checkboxes, `must_haves`/verification, summary (SUMMARY.md), dependencies, wave, files touched; the header controls (copy id/path, back, close) and checklist component are reusable.
- Source: kit:paseo/plugins/backlog-plugin/client/task-detail.tsx:1-338
- Why it exists: not stated.
- Test idea: a plan with 3 of 5 checked tasks shows 3/5 and a 60% bar.

### UI-77 Date/colour helpers (REUSE)
- Behavior: `formatDate`, `formatShortDate` (date-only strings parsed as local dates), `formatRelative` (`just now`, `Nm ago`, `Nh ago`, `Nd ago` under 14 days, else a date), `formatClock`, `isOverdue` (end of the due day), `initialsOf`; `statusTone` maps status text by regex (done/complete/closed/shipped/finished -> success; block/hold/stuck/cancel -> danger; progress/doing/active/review/started/testing -> accent; else muted), `priorityTone`.
- Proposal: KEEP `format*` and the regex-to-tone idea; replace the status vocabulary with the GSD states (explicit map, not regex).
- Source: kit:paseo/plugins/backlog-plugin/client/format.ts:1-66; kit:paseo/plugins/backlog-plugin/client/color.ts:23-43
- Why it exists: not stated.
- Test idea: `formatRelative` boundary cases at 59 s, 60 s, 13 d, 14 d.

### UI-78 Section tabs (REUSE)
- Behavior: tab bar (role tab, selected state, accent underline, optional count) switching Tasks / Docs.
- Proposal: KEEP; sections become e.g. Roadmap / Phases / Files / Agents.
- Source: kit:paseo/plugins/backlog-plugin/client/section-tabs.tsx:1-54
- Why it exists: not stated.
- Test idea: n/a.

### UI-79 Backlog-specific install coupling (DROP)
- Behavior: `machine.mjs` pins the Backlog CLI version the plugin was tested with (`BACKLOG_PIN = '1.53.0'`) and enabling plugins is opt-in via `--enable-paseo-plugins`.
- Proposal: DROP the pin; KEEP the opt-in enabling rule (install area).
- Source: kit:machine.mjs:8,31,165,178 (grep lines); the flag gate is `opts['enable-paseo-plugins'] ? applyPlugins(live) : []` at kit:machine.mjs:329 (read via git show)
- Why it exists: CLI output format coupling (the plugin parses human-readable `--plain` output).
- Test idea: n/a.

### UI-80 `ph` title cut and the real label write (cross-area contract for grouping)
- Behavior: every agent created by `ph` gets `title: title.slice(0, 60)` and `labels: { [PARENT_LABEL]: CALLER, ...labels }` (the caller's labels are spread after, so they can override the parent label). The swarm map reads both (`title` for `swarmName`, the label for `parentId`), so a title longer than 60 characters is grouped on its first 60 characters, and a label override silently detaches the agent from its brain (it lands in the orphan bucket).
- Proposal: CHANGE: the new kit must (a) keep the cut known to the title convention (short role/phase prefix first), (b) carry the swarm name in a dedicated label (OPEN-5) so grouping does not depend on the cut, (c) decide whether `PARENT_LABEL` may be overridden (recommend: parent key written last, so it cannot be replaced).
- Source: kit:project/.agents/harness/runtime/daemon.mjs:123,127 (read via git show); kit:project/.agents/harness/runtime/common.mjs:10 (grep line); kit:paseo/plugins/swarm-plugin/server/group.ts:7-16; kit:paseo/plugins/swarm-plugin/server/snapshot.ts:58
- Why it exists: not stated.
- Test idea: spawn through `ph` with a 90-character title: the snapshot title has 60 characters and the group name is derived from them; spawn with a caller label `paseo.parent-agent-id=x`: assert the chosen policy.

### UI-81 Detail queries must ignore a previous id (keepPreviousData guard)
- Behavior: task detail and doc reader set `placeholderData: keepPreviousData` (so a refetch or id change does not blank the pane) but render the body only when the returned id equals the requested one (`result.task.id === props.taskId`, `result.doc.id === props.docId`); otherwise they fall through to the not-ok / error / loading states (loading shows the summary title or `Loading <id>`). Without the guard, selecting a second item would keep showing the first one until the new response arrives.
- Proposal: KEEP; mandatory in the `.planning` plan/file detail pane (UI-73, UI-76) and any future detail query with `keepPreviousData`.
- Source: kit:paseo/plugins/backlog-plugin/client/task-detail.tsx:255-262,301-309; kit:paseo/plugins/backlog-plugin/client/doc-reader.tsx:68-75,154-162
- Why it exists: not stated (the guard is the visible fix for stale data).
- Test idea: open item A, then B with B's response delayed: the pane shows the loading state for B, never A's body.

## Invariants and lessons

- A detail query that uses `keepPreviousData` must compare the returned id with the requested id before rendering (kit:paseo/plugins/backlog-plugin/client/task-detail.tsx:262; doc-reader.tsx:75). See UI-81.
- `ph` cuts titles to 60 characters and stamps the parent label with caller labels able to override it (kit:project/.agents/harness/runtime/daemon.mjs:123,127). See UI-80.

- RPC names must match `^[a-z][a-z0-9._-]*$`, or the plugin fails to load (kit:paseo/plugins/swarm-plugin/README.md:85-86). Contract-test every name.
- Plugins have no server push: poll, and make each poll cheap by caching and by reading only what changed (eligibility windows, TTL caches, per-agent in-flight dedupe). Timeline loads of old idle sessions cost ~23 s for 25 brains (kit:paseo/plugins/swarm-plugin/server/activity.ts:3-4).
- Archived and closed agents are never drawn, except a closed brain with live subagents (kit:paseo/plugins/swarm-plugin/server/snapshot.ts:4-5).
- Record file touches on every timeline read, not only the first sight of a call: paths of a streaming call appear later and repeats are no-ops in the ledger (kit:paseo/plugins/swarm-plugin/server/activity.ts:347). The ledger must be order-independent, but only for the holder: a touch older than the holder's never moves the holder and never emits a handoff (files.ts:51-52,61), while an older edit/write still updates that agent's writers time first (files.ts:60), so write conflicts are counted regardless of read order.
- Group handoffs per tool call and previous agent, and cap animation per poll (a review start fans one bundle file out to ~20 agents; busiest minute 112 handoffs, README 47-48; swarm-surface.tsx:44).
- The event log has an epoch; a client with another epoch or `afterSeq<0` gets history that is displayed but never animated (kit:paseo/plugins/swarm-plugin/server/events.ts:31-34).
- Prompt text is not in the `turn_started` hook payload: read it from the timeline asynchronously with one retry, never block the hook (kit:paseo/plugins/swarm-plugin/server/events.ts:83-98).
- Never repeat the same error to the client on every poll (kit:paseo/plugins/swarm-plugin/server/activity.ts:315).
- Text colours only from `theme.colors`; no DOM/SVG; RN primitives only (kit:paseo/plugins/swarm-plugin/README.md:85-86).
- Decide a node's appear mode at render time, because a node mounts once (kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:434-435).
- Keep a node's layout slot stable while it lives (kit:paseo/plugins/swarm-plugin/client/geometry.ts:3-4).
- Daemon-side code must not depend on the user's PATH or shell: no subprocess for reading `.planning/` (kit:paseo/plugins/backlog-plugin/server/backlog-cli.ts:27-28). If a subprocess is ever needed, pass user text after `--` as one argv entry (docs-handlers.ts:48).
- RPC handlers return typed `ok:false` envelopes instead of throwing (kit:paseo/plugins/backlog-plugin/server/backlog-handlers.ts:49-55).
- Plugins are read-only observers (kit:paseo/plugins/swarm-plugin/README.md:3-4). A `.planning` reader that takes a client-supplied path must resolve it inside `.planning/` and reject `..`; the old docs reader avoided the issue by taking ids, not paths (kit:paseo/plugins/backlog-plugin/shared/docs.ts:5).
- Icons are host-resolved lucide names; re-check them after a Paseo upgrade (kit:paseo/plugins/swarm-plugin/client/palette.ts:3).

## Interfaces

**Paseo plugin API used (all from `@getpaseo/plugin`)**

| API | Used for | Source |
| :-- | :-- | :-- |
| `defineRpc({name,input,output})`, `RpcInput<T>` | typed contracts in `shared/` | kit:paseo/plugins/swarm-plugin/shared/swarm.ts:3,199 |
| server `contribute(server)`: `server.handle(rpc, fn)`, `server.on(event, cb)` -> off | handlers, lifecycle hooks | kit:paseo/plugins/swarm-plugin/index.server.ts:8-16 |
| handler context `{paseo}`: `agents.list/ref().timeline.refetch/refresh`, `workspaces.ref().current/refresh/directory` | data loading | kit:paseo/plugins/swarm-plugin/server/snapshot.ts:76-105; kit:paseo/plugins/backlog-plugin/server/backlog-handlers.ts:57-66 |
| client `contribute(client)`: `addSurface`, `addSidebarItem`, `addWorkspacePanel`, `addCommandCenterItem` | UI registration | kit:paseo/plugins/backlog-plugin/index.client.tsx:8-34 |
| client hooks `useRpc(rpc)`, `usePaseo()`; `openExternalUrl` | calls | kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:8; kit:paseo/plugins/backlog-plugin/client/surface.tsx:1; kit:paseo/plugins/backlog-plugin/client/markdown.tsx:1 |
| `@getpaseo/plugin/client/react-native`: `Icon, Modal, TextInput, FlatList, ScrollView, useToast, copyText` | host components | kit:paseo/plugins/backlog-plugin/client/project-picker.tsx:1; kit:paseo/plugins/backlog-plugin/client/doc-reader.tsx:2 |
| props `PluginSurfaceProps {theme, layout:{compact}, host:{id}}`, `PluginWorkspacePanelProps (+workspaceId)`, `PluginTheme.colors`, `PluginWorkspaceSnapshot.kind` | UI inputs | kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:63; kit:paseo/plugins/backlog-plugin/client/panel.tsx:30; kit:paseo/plugins/backlog-plugin/client/projects.ts:1-3 |
| lifecycle events `agent.created|archived|turn_started|turn_ended|permission_requested|permission_resolved` | event log | kit:paseo/plugins/swarm-plugin/server/events.ts:80-109 |

**RPCs**

| name | input | output | poll |
| :-- | :-- | :-- | :-- |
| `swarm.snapshot` | `runMaxAgeHours` 1..336, `recentHours` >=0, `afterSeq` int, `eventEpoch` string/null | snapshot (UI-10) | 1 s |
| `swarm.agent-detail` | `agentId` | `recent`, `lastCommand`, `lastReply` | 1.5 s while selected |
| `backlog.tasks.list` | `workspaceId` | ok: `projectName, directory, statuses, tasks, fetchedAt` / failure | 5 s |
| `backlog.tasks.view` | `workspaceId, taskId` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) | ok: `task` / failure | 5 s |
| `backlog.docs.list` | `workspaceId` | ok: `docsDirectory, docs[{id,title,path}], fetchedAt` / failure | 60 s |
| `backlog.docs.view` | `workspaceId, docId` (`...{0,127}`) | ok: `doc` / failure | 30 s stale |
| `backlog.docs.search` | `workspaceId, query` (1..200) | ok: `hits[{id,title,path,type,tags,score}]` / failure | on demand |

**Failure envelope**: `{ok:false, code: no_backlog|cli_unavailable|timeout|invalid_output|not_found|failed, message, directory|null}` (kit:paseo/plugins/backlog-plugin/shared/backlog.ts:58-75).

**Config keys.** The plugins have no config file. Constants (name = default): `POLL_MS` 1000, `RECENT_HOURS` 6, `RUN_AGE_CHOICES_H` [6,24,72], `DEFAULT_RUN_AGE_H` 24, `FEED_MAX` 80, `NEW_BADGE_MS` 12000, `MAX_EFFECTS` 60, `TOOL_POP_GAP_MS` 900, `HANDOFF_CHIPS_PER_POLL` 8, `ZOOM_MIN/MAX/STEP` 0.4/1.6/0.1, `PANEL_W` 380 (swarm-surface.tsx:33-52); `DETAIL_POLL_MS` 1500 (panels.tsx:30); `ROTATE_PCT` 50 (nodes.tsx:16); server `RUNNING_REFRESH_MS` 1000, `ERROR_RETRY_MS` 30000, `FIRST_TAIL_LIMIT` 8, `TAIL_LIMIT` 4, `RECENT_MAX` 8, `SEEN_IDS_MAX` 300, `PARALLEL_FETCHES` 8, `DETAIL_MAX_CHARS` 300, `LABEL_MAX_CHARS` 48, `MESSAGE_MAX_CHARS` 280, `FILES_PER_ACTIVITY` 24 (activity.ts:19-31); `EVENT_LOG_MAX` 500, `EVENT_HISTORY` 40, `EVENTS_PER_CALL_MAX` 200, `TEXT_MAX_CHARS` 200, `PROMPT_FRESH_MS` 15000, `PROMPT_RETRY_MS` 700 (events.ts:8-16); `FILE_HOLD_WINDOW_MS` 5 min, `HANDOFF_WINDOW_MS` 15 min, `FORGET_MS` 30 min, `HOLDS_PER_AGENT` 4 (files.ts:8-14); `MAX_DEPTH` 3, `ACTIVE_WINDOW_MS` 10 min, `SUMMARY_HEAD_LINES` 4 (runs.ts:11-15); `PAGE_LIMIT` 200, `MAX_PAGES` 5, `RUNS_TTL_MS` 4000, `PARENT_TTL_MS` 30000, `DEFAULT_IDLE_WINDOW_MS` 6 h (snapshot.ts:22-33). Backlog (dropped): env `BACKLOG_BIN`, `BACKLOG_NODE`, `CLI_TIMEOUT_MS` 20000, `CLI_MAX_OUTPUT_BYTES` 16 MiB, `CONFIG_TTL_MS` 60000, `CACHE_TTL_MS` 10000 (backlog-cli.ts:6-7,36-47; backlog-handlers.ts:13; docs-paths.ts:8).

**Operator commands**: `paseo plugin install <dir>`, `paseo plugin reload <id>`, `paseo plugin ls`, `paseo plugin logs <id>`; daemon `config.json` `pluginsEnabled: true` (kit:paseo/plugins/swarm-plugin/README.md:73-83).

**Wire formats**: `Activity` (id, kind, label<=48, detail<=300, status running|completed|failed|canceled, at, files<=24), `FileHold`, `SwarmEvent`, `SwarmRun` (kit:paseo/plugins/swarm-plugin/shared/swarm.ts:26-196).

## Cross-area dependencies

- **install**: plugin install/reload and `pluginsEnabled` enabling are machine-level steps (`machine.mjs:8,165,178`); the plugin dir must ship in the kit and its `npm install` deps (UI-01) need the standards-spec approval the README mentions (README 90-91).
- **runtime**: the swarm map depends on `ph` stamping label `paseo.parent-agent-id` on every spawn (the write is `labels: { [PARENT_LABEL]: CALLER, ...labels }` at kit:project/.agents/harness/runtime/daemon.mjs:127, a caller label of the same name overrides it; the constant is exported at `common.mjs:10`) and on a title convention (UI-33); `ph` cuts every title to 60 characters (`title.slice(0, 60)`, daemon.mjs:123), so grouping by title sees a truncated string (UI-80); model strings come from the Paseo provider `circle` (e.g. `circle/gpt-6.1-sol[1m]`), displayed by `shortModel`. Agent `status`, `attention`, `lastUsage` come from the Paseo daemon, not from the kit.
- **workflow / gsd-plan / gsd-debug / gsd-upstream / method**: a `.planning/` panel must be specified against the GSD file formats (frontmatter keys, STATE/ROADMAP/phase dirs, plan/summary naming); the old queue/review run formats (UI-30, UI-31) have no GSD equivalent and should be replaced by wave/plan progress. Wave execution status could also be derived from agents (titles) + `.planning` files.
- **files**: file-touch tracking relies on tool names and input shapes (UI-19, UI-20); they must match the Claude Code + harness-files mod tools of the new kit.
- **hooks**: none; the plugins use Paseo lifecycle hooks, not Claude Code hooks.
- **ui**: this area; **history**: owner decisions in the README (2026-10-02 tree layout dropped, sleep semantics, archive hiding) are the history to record.

## Concerns

- Regex bug in `firstLineCount`: in the template literal both `\s` and `\d` collapse (source `^KEY:s*(d+)`), so review counts are always 0 for the documented `KEY: n` form, with or without a space (kit:paseo/plugins/swarm-plugin/server/runs.ts:77-80). See UI-31.
- The README "Develop" commands say `cd tools/paseo/swarm-plugin && npm install` while the install line uses `<kit>/paseo/plugins/swarm-plugin` (kit:paseo/plugins/swarm-plugin/README.md:77,79); README and code comments cite `paseo_tool.py`, `paseo.md` and `paseo.sh plugin reference`, none present in the tag.
- swarm `package.json` lacks `@types/node` while server code imports `node:fs/os/path` and tsconfig lists `types: [react,node]`; backlog declares it (kit:paseo/plugins/swarm-plugin/package.json:18-26; kit:paseo/plugins/backlog-plugin/package.json:21; kit:paseo/plugins/swarm-plugin/server/runs.ts:5-7).
- `package.json` `files` lists entry variants that do not exist (`index.client.ts`, `index.server.tsx`) (kit:paseo/plugins/swarm-plugin/package.json:6-10).
- The `command` event is pushed asynchronously after the hook returns, so its `seq` can land after `tool` events of the same turn and the feed order can differ from real order (kit:paseo/plugins/swarm-plugin/server/events.ts:85-98).
- The one big `useEffect` that reconciles bookkeeping, feed, ghosts and effects is ~70 lines of ref mutation with an `eslint-disable` for exhaustive deps; fragile to change (kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:456-528).
- Duplication: `clip`/`firstLine`/`baseName` exist in `server/activity.ts` and `files.ts` and `client/format.ts`; `isRunning` in three places (swarm-surface.tsx:72, nodes.tsx:20, panels.tsx:178,269); `Chip`, `Section`, `IconButton`, `LiveDot`/`Dot`, `MONO_FONT`, `Colors` type duplicated between the two plugins (panels.tsx:34-54, kit.tsx:144-313, palette.ts:8,164, color.ts:3).
- `ActivityCache.detail` seeds an entry with `updatedAt:""` and status `unknown` (activity.ts:293); harmless but means the first listed read repeats it.
- File-tool name tables are tied to MCP servers the owner dropped (`filesystem`, `fsbatch`) (activity.ts:104-108).
- Backlog: `listMarkdownFiles` recurses without symlink or count guards (docs-paths.ts:43-54); config/doc caches are module-global with TTL only (backlog-handlers.ts:20, docs-paths.ts:19); `docs-handlers` imports helpers from `backlog-handlers` (coupling); `docs-view` imports `SearchBox` from `toolbar` and `pathTail` from `projects` (docs-view.tsx:20-21).
- Markdown inline regex is single-pass: no nested emphasis, `*italic*` can match across punctuation (markdown.tsx:134).
- Only one unit test in the area (UI-59); the ledger, grouping and parsers are logic-heavy and untested.
- Over-engineering candidates if the map is kept: Electrons/SleepZ/typing-dot decorations (nodes.tsx:93-147,220-243) cost code for cosmetic gain.

## Open questions for the owner

1. **OPEN-1 Scope of the swarm map in the new kit.** Options: (a) keep a trimmed map (brain/hub/agent, inspector, feed; drop runs and, if not wanted, the file ledger); (b) keep everything except temp-dir runs; (c) drop the map and ship only the `.planning/` panel. Recommendation: (a) with the file ledger kept (parallel wave executors make write conflicts a real risk), runs replaced by `.planning` wave progress; build the `.planning` panel first.
2. **OPEN-2 Context-rotate threshold (50%).** Options: keep a client constant; read it from the kit's context-guard setting; plugin setting. Recommendation: one source of truth shared with the context guard (area: hooks/runtime), exposed to the plugin through the snapshot.
3. **OPEN-3 Which workspace represents a project in the `.planning` panel.** The old picker prefers the main checkout (canonical backlog). GSD executors may work in worktrees with their own `.planning/`. Options: main checkout only; a workspace switcher per project; show both. Recommendation: main checkout by default with a worktree switcher.
4. **OPEN-4 Preview/sim harness.** Old one lived outside the repo (`%TEMP%/swarm-preview`, react-native-web + esbuild). Options: leave out (rely on `paseo plugin reload`); add as a dev tool with documented deps. Recommendation: leave out until the first UI regression justifies it.
5. **OPEN-5 Agent title and label convention.** Grouping needs a defined title format emitted by `ph` (UI-33). Options: `<role> <phase>-<plan>: <task>`; or a dedicated label (e.g. `ph.swarm`) so titles no longer matter. Recommendation: a label, with title parsing only as a fallback.
6. **OPEN-6 Panel interactivity.** Options: strictly read-only plus copy-path/copy-id; or add safe actions (open plan in editor, dispatch `ph` commands). Recommendation: read-only plus copy (matches the old rule and the plugin API has no proven write path).
7. **OPEN-7 Plugin toolchain and dependencies.** Plugins need TypeScript + React Native + zod + react-query (versions pinned to Paseo's host). The README says repo additions need the dependency list in the engineering standards first. Options: approve the same pinned set; vendor nothing. Recommendation: approve the same set, pin to the installed Paseo version, and add `@types/node` to every plugin.




## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
| :-- | :-- | :-- |
| R1-UI-01 | accepted | Verified files.ts:60 updates `writers` before the holder check at :61. UI-23 rewritten (writers vs holder rule; windows not Windows-specific, only `keyOf` is; test idea added); Invariants ledger sentence corrected. |
| R1-UI-02 | accepted | Verified runs.ts:78: in a template literal `\s` and `\d` both collapse (`^KEY:s*(d+)`). UI-31 and Concerns corrected; fix now covers both escapes; the "only `OPEN-CRITICAL:3` matches" claim removed. |
| R1-UI-03 | accepted | Verified daemon.mjs:127 (`labels: { [PARENT_LABEL]: CALLER, ...labels }`) and common.mjs:10 (constant only). UI-13, UI-58 and Cross-area (runtime) now cite daemon.mjs:127 and the override order; paseo-runtime.md:33 kept as the matching doc. |
| R1-UI-04 | accepted | Verified task-detail.tsx:255-262, doc-reader.tsx:68-75 and daemon.mjs:123 (`title.slice(0, 60)`). New UI-81 (id-equality guard) and UI-80 (60-char cut, label write); UI-07, UI-33, Cross-area and Invariants updated. |
| R1-UI-05 | accepted | Verified swarm-surface.tsx:393-405 has no `placeholderData`/`isRefetchError`; UI-07 rewritten to separate swarm (`offline`/`Snapshot failed`) from backlog (`keepPreviousData`, Reconnecting) behaviour; test idea and sources fixed. |
| R1-UI-06 | accepted | Verified snapshot.ts:136 is `Promise.all`. UI-13 now says missing parents are refreshed concurrently, each cached 30 s (the :28 comment says "one by one" but the call is parallel). |
| R1-UI-07 | accepted | Verified nodes.tsx:309-312 (agents staggered), :459 and :568 (hub 600 ms, brain 700 ms, no delay), swarm-surface.tsx:437. UI-36 limited the stagger to agent nodes. |
| R1-UI-08 | accepted | Verified swarm-surface.tsx:509 and snapshot.ts:24-25,140-143 (closed excluded from children) and nodes.tsx:702-729 (0.35 travel, scale 0.15, 1.7 s). UI-43 rewritten: `closed` marked unreachable, motion described correctly. |
| R1-UI-09 | accepted | Verified swarm-surface.tsx:561 (`Math.min(1, ...)`) and :590 (ZOOM_MAX only for zoom-in). UI-38 now says fit-width 0.4..1, manual 0.4..1.6 step 0.1, matching UI-48. |
| Citation notes (reviewer table) | accepted | UI-72 id regex now shows the dotted-segment form (markdown.tsx:135); UI-79 cites the gate at machine.mjs:329 (confirmed via `git show`); UI-58 notes paseo-runtime.md:33 does not alone prove `paseo_tool.py` is absent (absence checked with `git ls-tree` of the tag). |
| Coverage-table line counts (reviewer note) | rejected as a defect | The counts in the Coverage table were taken from `wc -l` / the read tool and exclude the final empty line; every file body was read in full, so no content is missing. Left unchanged. |

New behaviors added: UI-80, UI-81 (after UI-79; no ID renumbered).
