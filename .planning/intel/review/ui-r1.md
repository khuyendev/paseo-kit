# Review r1: UI

## Verdict

REVISE. 0 blocker, 4 major, 5 minor. The map is a real reading of both plugins: coverage of the in-scope tree is complete, backlog is correctly DROP, and the reuse list (envelopes, kit, markdown, tree, picker, split pane) matches the code. It is not safe to spec from yet. The file-ledger rule the map says to keep is wrong about out-of-order writes, the review-count bug is mis-stated so the suggested fix would still fail, the claim that `ph` stamps `paseo.parent-agent-id` cites the constant rather than the write, and two contracts a rewrite would copy (detail queries must ignore a previous id, `ph` cuts titles at 60 characters) are absent.

## Findings

### R1-UI-01 MAJOR accuracy Out-of-order writes still count as writers
- Severity: MAJOR
- Category: accuracy
- Map entry: UI-23 (also the ledger sentence in Invariants)
- Evidence: kit:paseo/plugins/swarm-plugin/server/files.ts:51-67. The comment at 51-52 says a touch older than the holder's is ignored. Line 60 updates `writers` before that check: an edit/write whose `at` is older than `last.at` still records that agent's latest write time, then line 61 returns without moving the holder or emitting a handoff.
- Fix: Split the rule. Holder and handoff ignore a touch with `at <= holder.at`. The writers map does not: keep the latest edit/write time per agent even when that touch loses the holder race. `holds()` then counts writers whose time is within 15 min of now (files.ts:82). Say the 5/15/30 min windows are not Windows-only; only `keyOf` (files.ts:36-38) is the Windows path rule. The invariant must say the same thing, not "ignore older touches" as a whole.

### R1-UI-02 MAJOR accuracy Review count regex eats both `\s` and `\d`
- Severity: MAJOR
- Category: accuracy
- Map entry: UI-31 (Concerns repeats it)
- Evidence: kit:paseo/plugins/swarm-plugin/server/runs.ts:77-80. The pattern is a template literal `` `^${signal}:\s*(\d+)` ``. In a template both `\s` and `\d` are identity escapes, so the RegExp source is `^OPEN-CRITICAL:s*(d+)`, not `^OPEN-CRITICAL:s*(\d+)`. Neither `OPEN-CRITICAL: 3` nor `OPEN-CRITICAL:3` matches. Only a line of optional `s` characters followed by one or more literal `d`s would.
- Fix: State that both escapes collapse, so counts are 0 for every documented `KEY: n` line, with or without a space. If the entry stays DROP, drop the "only `OPEN-CRITICAL:3` matches" sentence. If it is kept, the fix is a normal string or `\\s` and `\\d` (`new RegExp(\`^${signal}:\\\\s*(\\\\d+)\`)`), not `\\s` alone.

### R1-UI-03 MAJOR citation Parent label is not written at common.mjs:10
- Severity: MAJOR
- Category: citation
- Map entry: UI-13 (UI-58 and Cross-area repeat the same line)
- Evidence: kit:project/.agents/harness/runtime/common.mjs:10 only exports `PARENT_LABEL = "paseo.parent-agent-id"`. The write is kit:project/.agents/harness/runtime/daemon.mjs:127: `labels: { [PARENT_LABEL]: CALLER, ...labels }` inside `createAgent`. Because `labels` is spread after the parent key, a caller label of the same name replaces it. kit:project/.agents/skills/harness/references/paseo-runtime.md:33 does say every agent is created as the caller's subagent with that label; common.mjs:10 does not.
- Fix: Cite daemon.mjs:127 for the stamp, and note the override order. Keep paseo-runtime.md:33 as the doc that matches `ph`, not as proof of the write.

### R1-UI-04 MAJOR coverage Detail queries drop a previous id; ph titles are cut at 60
- Severity: MAJOR
- Category: coverage
- Map entry: missing (touches UI-07, UI-33, UI-73, UI-76, Cross-area)
- Evidence: kit:paseo/plugins/backlog-plugin/client/task-detail.tsx:255-262 and kit:paseo/plugins/backlog-plugin/client/doc-reader.tsx:68-75 set `placeholderData: keepPreviousData`, then show the body only when `result.task.id === props.taskId` or `result.doc.id === props.docId`. Without that check the previous task or doc stays on screen while the next id loads. Separately, kit:project/.agents/harness/runtime/daemon.mjs:123 sets `title: title.slice(0, 60)` on every `ph` create. UI-33's proposed `<role> <phase>-<plan>: <task>` convention is not told about that cut, so a long title is grouped on a truncated string.
- Fix: Add the id-equality guard to the reuse notes for task detail and the doc reader (and to the polling entry). In UI-33 and Cross-area, record that `ph` stores at most 60 characters of title, and that a grouping label (OPEN-5) is the way to avoid depending on the cut.

### R1-UI-05 MINOR accuracy Swarm poll is not the backlog reconnect pattern
- Severity: MINOR
- Category: accuracy
- Map entry: UI-07
- Evidence: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:393-405 has no `placeholderData` and no `isRefetchError`. A query error sets the subtitle to `offline` and the line `Snapshot failed:` (swarm-surface.tsx:575,594). `keepPreviousData` and `stale={query.isRefetchError}` rendering `Reconnecting` are backlog only (kit:paseo/plugins/backlog-plugin/client/panel.tsx:54-58,199; kit:paseo/plugins/backlog-plugin/client/toolbar.tsx:164).
- Fix: Say keepPreviousData and the Reconnecting dot are the backlog panel, docs list, doc reader, task detail, workspace list, and doc search. The swarm snapshot query does not keep data across a query-key change (age or Active 6h) and reports failure as `offline` / `Snapshot failed`.

### R1-UI-06 MINOR accuracy Closed parents are fetched in parallel
- Severity: MINOR
- Category: accuracy
- Map entry: UI-13
- Evidence: kit:paseo/plugins/swarm-plugin/server/snapshot.ts:28 says "fetched one by one". kit:paseo/plugins/swarm-plugin/server/snapshot.ts:136 is `Promise.all(missingParents.map(...))`. The 30 s cache, including cached null, is real (snapshot.ts:92-104).
- Fix: Say missing parents are refreshed concurrently, each cached 30 s, not serially.

### R1-UI-07 MINOR accuracy Boot stagger is agents only
- Severity: MINOR
- Category: accuracy
- Map entry: UI-36
- Evidence: kit:paseo/plugins/swarm-plugin/client/nodes.tsx:309-312 staggers agents with `min(bootIndex * 30, 900)` and uses spring only for `spawn`. Hub and brain calls are `useAppear(..., { durationMs: 600 })` and `{ durationMs: 700 }` with no delay (nodes.tsx:459,568). `bootIndex` is built only from `layout.agents` (swarm-surface.tsx:437).
- Fix: Limit the stagger sentence to agent nodes. Hubs and brains fade in once, unstaggered.

### R1-UI-08 MINOR accuracy Ghost "closed" does not happen; 35% is travel, not scale
- Severity: MINOR
- Category: accuracy
- Map entry: UI-43
- Evidence: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:509 sets reason `closed` from the previous layout's `p.agent.status`. Children come only from the live list, which excludes `closed` (kit:paseo/plugins/swarm-plugin/server/snapshot.ts:24-25,140-143), so a vanished agent node's last status is never `closed`. kit:paseo/plugins/swarm-plugin/client/nodes.tsx:702-729 runs 1700 ms, translates 35% of the way to the hub (`* 0.35`), and scales to 0.15, not "shrinks 35%".
- Fix: Mark `closed` as a branch that the listing rules make unreachable; the live reasons are `archived` (an archive event in this poll) or `gone`. Describe the motion as 35% of the hub vector plus scale to 0.15 over 1.7 s.

### R1-UI-09 MINOR accuracy Fit zoom caps at 1, not 1.6
- Severity: MINOR
- Category: accuracy
- Map entry: UI-38 (UI-48 is the correct one)
- Evidence: kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:561 clamps fit with `Math.min(1, (viewport.w - 8) / layout.width)` and `ZOOM_MIN` 0.4. `ZOOM_MAX` 1.6 applies only to the zoom-in button (swarm-surface.tsx:47,590).
- Fix: In UI-38, say fit-width is 0.4..1. Manual zoom is 0.4..1.6 in steps of 0.1. UI-48 already says this; make the two entries match.

## Citations checked

| map entry | citation | ok / wrong |
| :-- | :-- | :-- |
| UI-01 | kit:paseo/plugins/swarm-plugin/paseo-plugin.json:1-6 | ok (id, paseo >=0.10.0, no description) |
| UI-01 | kit:paseo/plugins/backlog-plugin/paseo-plugin.json:1-7 | ok (description present) |
| UI-01 | kit:paseo/plugins/swarm-plugin/package.json:1-27 | ok (private 0.0.0, files list, typecheck, pinned deps) |
| UI-02 | kit:paseo/plugins/swarm-plugin/index.server.ts:8-16 | ok (handle both RPCs, return stopRecording) |
| UI-02 | kit:paseo/plugins/backlog-plugin/index.client.tsx:8-34 | ok (surface, sidebar, workspace panel, command center) |
| UI-03 | kit:paseo/plugins/swarm-plugin/shared/swarm.ts:199-225 | ok (snapshot and agent-detail; input bounds match) |
| UI-03 | kit:paseo/plugins/swarm-plugin/README.md:85-86 | ok (name regex and theme-color gotcha) |
| UI-04 | kit:paseo/plugins/backlog-plugin/shared/backlog.ts:58-102 | ok (six codes, discriminated union) |
| UI-04 | kit:paseo/plugins/backlog-plugin/client/panel.tsx:100-164 | ok (transport error, no_backlog muted, empty, filter-empty) |
| UI-07 | kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:395-405 | wrong for the keepPreviousData / Reconnecting sentence; the 1 s poll itself is there (R1-UI-05) |
| UI-10 | kit:paseo/plugins/swarm-plugin/shared/swarm.ts:63-105,181-210 | ok (snapshot and SwarmAgent fields) |
| UI-12 | kit:paseo/plugins/swarm-plugin/server/snapshot.ts:42-64,76-90 | ok (toAgent and the 200 x 5 list) |
| UI-13 | kit:project/.agents/harness/runtime/common.mjs:10 | wrong as "written by ph"; it only exports the constant (R1-UI-03) |
| UI-13 | kit:paseo/plugins/swarm-plugin/server/snapshot.ts:92-105,134-144 | ok for cache and orphan bucket; "one by one" is the comment, not the call (R1-UI-06) |
| UI-16 | kit:paseo/plugins/swarm-plugin/server/activity.ts:19-26,227-241,253-288 | ok (eligibility, 1 s / 30 s, concurrency 8, in-flight dedupe) |
| UI-19 | kit:paseo/plugins/swarm-plugin/server/activity.ts:104-150 | ok (MCP regex, key order, batch paths before single-path kinds) |
| UI-20 | kit:paseo/plugins/swarm-plugin/server/file-input.ts:1-16 | ok |
| UI-20 | kit:tests/swarm-file-input.test.mjs:5-10 | ok (the four asserts) |
| UI-20 | kit:CHANGELOG.md:37 | ok (batch ranges and batch write/edit shapes) |
| UI-23 | kit:paseo/plugins/swarm-plugin/server/files.ts:51-52 | partial: the comment matches the map; line 60 does not (R1-UI-01) |
| UI-25 | kit:paseo/plugins/swarm-plugin/server/snapshot.ts:178-194 | ok (3 names, strongest op, first path) |
| UI-27 | kit:paseo/plugins/swarm-plugin/server/events.ts:41-67,83-104 | ok (15 s freshness, one 700 ms retry, stats by count) |
| UI-31 | kit:paseo/plugins/swarm-plugin/server/runs.ts:77-80 | wrong mechanism: both `\s` and `\d` collapse (R1-UI-02) |
| UI-33 | kit:paseo/plugins/swarm-plugin/server/group.ts:7-16 | ok (suffix, colon, first word, `(untitled)`) |
| UI-35 | kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:393-407,456-488 | ok (cursor, epoch reset, history not animated) |
| UI-38 | kit:paseo/plugins/swarm-plugin/client/geometry.ts:23-37,100-137 | ok for tiers, 70 deg, 172, 138, cooldown 4 s; fit max 1.6 is not in this file (R1-UI-09) |
| UI-39 | kit:paseo/plugins/swarm-plugin/client/palette.ts:83-88 | ok (permission, then error, then running/initializing, else sleep) |
| UI-45 | kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:296-379,515-521 | ok (budgets 8 and 60, handoffs first then newest, tool pop skipped when the activity already handed off) |
| UI-48 | kit:paseo/plugins/swarm-plugin/client/swarm-surface.tsx:561-591 | ok (fit max 1, step 0.1) |
| UI-56 | kit:paseo/plugins/swarm-plugin/client/nodes.tsx:15-16 | ok (`ROTATE_PCT = 50`) |
| UI-58 | kit:project/.agents/skills/harness/references/paseo-runtime.md:33 | ok that the line names the label and subagent creation; it does not by itself prove `paseo_tool.py` is absent |
| UI-61 | kit:paseo/plugins/backlog-plugin/server/backlog-cli.ts:27-50,75-123 | ok (PATH workaround, 20 s, 16 MiB stdout, code order) |
| UI-66 | kit:paseo/plugins/backlog-plugin/server/docs-parse.ts:35-62,111-116 | ok (frontmatter forms; missing doc exits 0) |
| UI-68 | kit:paseo/plugins/backlog-plugin/client/projects.ts:31-37,47-66 | ok (kind rank, archiving dropped, MRU is pushRecent) |
| UI-70 | kit:paseo/plugins/backlog-plugin/client/panel.tsx:42-98,199 | ok (split at 960, pane 380..480, trail, 30 s clock, Reconnecting) |
| UI-72 | kit:paseo/plugins/backlog-plugin/client/markdown.tsx:134-135,284 | ok for blocks and ballot boxes; the id regex also allows dotted segments the map's character class omits |
| UI-79 | kit:machine.mjs:31 | ok (`BACKLOG_PIN = '1.53.0'`) |
| UI-79 | kit:machine.mjs:8,165,178 | ok that plugins turn on only under the flag; the gate is machine.mjs:329 (`opts['enable-paseo-plugins'] ? applyPlugins`) |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| :-- | :-- | --: |
| paseo/plugins/swarm-plugin/.gitignore | yes | 0 |
| paseo/plugins/swarm-plugin/README.md | yes | 0 |
| paseo/plugins/swarm-plugin/index.client.tsx | yes | 0 |
| paseo/plugins/swarm-plugin/index.server.ts | yes | 0 |
| paseo/plugins/swarm-plugin/package.json | yes | 0 |
| paseo/plugins/swarm-plugin/paseo-plugin.json | yes | 0 |
| paseo/plugins/swarm-plugin/tsconfig.json | yes | 0 |
| paseo/plugins/swarm-plugin/shared/swarm.ts | yes | 0 |
| paseo/plugins/swarm-plugin/server/activity.ts | yes | 0 |
| paseo/plugins/swarm-plugin/server/events.ts | yes | 0 |
| paseo/plugins/swarm-plugin/server/file-input.ts | yes | 0 |
| paseo/plugins/swarm-plugin/server/files.ts | yes | 1 |
| paseo/plugins/swarm-plugin/server/group.ts | yes | 0 |
| paseo/plugins/swarm-plugin/server/runs.ts | yes | 0 (bug text wrong, not missing) |
| paseo/plugins/swarm-plugin/server/snapshot.ts | yes | 1 |
| paseo/plugins/swarm-plugin/client/anim.ts | yes | 0 |
| paseo/plugins/swarm-plugin/client/format.ts | yes | 0 |
| paseo/plugins/swarm-plugin/client/geometry.ts | yes | 0 |
| paseo/plugins/swarm-plugin/client/links.tsx | yes | 0 |
| paseo/plugins/swarm-plugin/client/nodes.tsx | yes | 2 |
| paseo/plugins/swarm-plugin/client/palette.ts | yes | 0 |
| paseo/plugins/swarm-plugin/client/panels.tsx | yes | 0 |
| paseo/plugins/swarm-plugin/client/ring.tsx | yes | 0 |
| paseo/plugins/swarm-plugin/client/swarm-surface.tsx | yes | 1 |
| paseo/plugins/backlog-plugin/index.client.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/index.server.ts | yes | 0 |
| paseo/plugins/backlog-plugin/package.json | yes | 0 |
| paseo/plugins/backlog-plugin/paseo-plugin.json | yes | 0 |
| paseo/plugins/backlog-plugin/tsconfig.json | yes | 0 |
| paseo/plugins/backlog-plugin/server/backlog-cli.ts | yes | 0 |
| paseo/plugins/backlog-plugin/server/backlog-handlers.ts | yes | 0 |
| paseo/plugins/backlog-plugin/server/backlog-normalize.ts | yes | 0 |
| paseo/plugins/backlog-plugin/server/docs-handlers.ts | yes | 0 |
| paseo/plugins/backlog-plugin/server/docs-parse.ts | yes | 0 |
| paseo/plugins/backlog-plugin/server/docs-paths.ts | yes | 0 |
| paseo/plugins/backlog-plugin/shared/backlog.ts | yes | 0 |
| paseo/plugins/backlog-plugin/shared/docs.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/board.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/color.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/doc-reader.tsx | yes | 1 |
| paseo/plugins/backlog-plugin/client/docs-data.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/docs-model.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/docs-view.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/format.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/kit.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/markdown.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/model.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/panel.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/project-picker.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/projects.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/section-tabs.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/stats-view.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/stats.ts | yes | 0 |
| paseo/plugins/backlog-plugin/client/surface.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/task-detail.tsx | yes | 1 |
| paseo/plugins/backlog-plugin/client/task-views.tsx | yes | 0 |
| paseo/plugins/backlog-plugin/client/toolbar.tsx | yes | 0 |
| tests/swarm-file-input.test.mjs | yes | 0 |

No in-scope file is absent from the Coverage table. `node_modules` and `package-lock.json` are excluded by the brief. Backlog has no README and no `.gitignore`. Line counts in the map are short by one on files that end with a trailing newline; the bodies were read. The title cap and the real parent-label write sit outside this area (`daemon.mjs`); they are missing from Cross-area, not from the file table.
