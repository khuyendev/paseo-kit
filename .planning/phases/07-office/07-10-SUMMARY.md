---
phase: 07-office
plan: 10
subsystem: ui
tags: [react-native, view-model, i18n-table, sidebar, drawer, topbar]
requires:
  - phase: 07-02
    provides: buildBuilding, BuildingLayout, ROOM_ID_PREFIX, TileRect
  - phase: 07-03
    provides: AgentView, WorkspaceView, OfficeSnapshot, BuildingModel and the status unions
provides:
  - STRINGS table with text and clipText and six key maps (OFFC-19)
  - sidebarTree, sidebarRows, initialExpanded with a camera target for every node (OFFC-14)
  - drawerModel (OFFC-15, OFFC-21) and topbarModel (OFFC-16)
  - stateless Sidebar, Drawer and TopBar components
affects: [07-11]
actuals:
  commits: 0
status: partial
---

# Phase 7 Plan 10: Panels Summary

**One English strings table, a sidebar tree with a camera target inside the building for every node, drawer and top bar view-models, and three stateless read-only components; written but not yet run (verification awaits the post-wave gate).**

## Task status

Per the kit overlay the orchestrator commits (`n/a (orchestrator commits)`) and the build and test suite were not run by this executor. Only the precondition (`node --test tests/ui/office-spike-gate.test.mjs`, 24 pass, the spike is recorded as waived by the owner) and `node --check` on the new test file were run.

1. Task 1: `limits-panels.ts`, `strings.ts`, `sidebar-model.ts` plus tests (strings, key maps, tree, camera targets, drawn flag, rows, edge) written.
2. Task 2: `drawer-model.ts`, `topbar-model.ts` plus tests (drawer, empty sections, children, bounds, attention, information bound, counters, context, usage slot) written.
3. Task 3: `sidebar.tsx`, `drawer.tsx`, `topbar.tsx` plus render tests and the four source gates (JSX literal, key, uri and style, read-only and imports), each with a fixture proving the checker can fail, written.

## Awaiting the post-wave gate

- `node --test tests/ui/office-client.test.mjs`
- `node plugins/office/node_modules/typescript/bin/tsc --noEmit -p plugins/office`
- `node --test tests/ui/plugin-gates.test.mjs`
- `node --test tests/ui/office-spike-gate.test.mjs` (already passed as the precondition)

The code was reviewed by reading only. The first run may expose type errors or test typos; none are known.

## Decisions

- `PanelColors` is exported from `sidebar.tsx` and imported as a type by `drawer.tsx` and `topbar.tsx` (one local type, picked from the theme colours).
- Sidebar rows use `testID` values `office-sidebar-row`, `office-sidebar-toggle`, `office-drawer-close` and `office-usage-slot` (fixed strings, no agent data).
- Camera targets: a node whose project has no room area gets scope `building` with the building rect but keeps its project, workspace and agent ids; 07-11 `cameraFor` refines workspace and agent targets.
- Unplaced group has node id `unplaced`, label null (the component shows `sidebarUnplaced`), and exists only when it has children.

## Deviations from Plan

None in the plan's scope. One process incident: my first batch write used relative paths and landed `limits-panels.ts` and `strings.ts` in the main checkout (`C:\Users\fish\Desktop\paseo-kit-office`). I confirmed both were untracked and created seconds earlier by that call, deleted them there, and rewrote them with absolute worktree paths. The main checkout has no other change from this run.

## Known Stubs

None. The usage slot is an intentionally empty `View` (D-07), not a stub.

## Hand-off for 07-11

- Strings `sceneSurplus`, `sceneDiff`, `sceneZoomIn`, `sceneZoomOut`, `sceneZoomLevel`, `screenLoading`, `screenFailed` exist; `sidebarEmpty` covers the empty state.
- Sidebar props: `{rows, hidden, selectedId, colors, onSelect(node), onToggle(nodeId)}`; Drawer: `{model, colors, onClose}`; TopBar: `{model, colors}`.
- Compose with `sidebarRows(tree, expanded, SIDEBAR_MAX_ROWS)`, `drawerModel(snapshot, selectedAgentId)` and `topbarModel(snapshot, selectedAgentId)`.

## Self-Check

Files exist in the worktree: limits-panels.ts, strings.ts, sidebar-model.ts, drawer-model.ts, topbar-model.ts, sidebar.tsx, drawer.tsx, topbar.tsx, tests/ui/office-client.test.mjs. Tests and tsc unrun, so this check is existence only.
