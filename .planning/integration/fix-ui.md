# fix-ui report (area PNL: plugins/, tests/ui/)

Review applied: `.planning/intel/review/code-ui.md`. Every finding was checked against the code first. CR-PNL-01 was reproduced with the installed Paseo 0.11.2 compiler and evaluator on a HEAD copy (planning-panel: `The "path" argument must be of type string ... Received undefined`). The compiler (`compiler.js` `directoryTarget`) also refuses any import from outside the plugin folder. The plugin child process is not given its folder either. Together these mean a plugin cannot reach kit files at run time, so the trusted readers are now bundled inside each plugin.

| Finding | Result | What changed or why rejected |
|---|---|---|
| CR-PNL-01 BLOCKER: bundles fail in the host evaluator | fixed | No `import.meta`, no dynamic import, no import from outside the plugin folder. Planning panel: new `server/ladder.ts` mirrors the GSDC-13 ladder of `ship/.agents/harness/gsd/status.mjs` (`phaseStatus`, `readVerification`, `fingerprint`) and the `roadmap analyze` roster, read-only with node:fs. Parity is tested against the kit's live `analyze`. `server/gsd-link.ts` is now `LadderStatusSource`. Swarm map: `server/rotate.ts` reads defaults and overlay as JSON (it mirrors `discoverConfigRoot`, `mergeOverlay` and the lenient fallback for `context_guard.start_pct`). Kit defaults for agents outside a project are bundled as `server/kit-defaults.json`, a byte copy of `ship/.agents/harness.defaults.json`; a test keeps them equal. New gate `PANL-02 both plugins compile and load through the Paseo host bundler...` compiles and evaluates both entries with the installed host compiler (offline, no daemon) and asserts the registered handlers. It skips when the CLI is absent or not the tested version. |
| CR-PNL-02 BLOCKER: observers import project modules | fixed | Follows from the CR-PNL-01 change: no workspace or project module is imported any more, and project files are read only as data. Tests: `PANL-05 polling never imports modules from the workspace` (sentinel `status.mjs`/`planning.mjs` in the workspace) and `PANL-55 rotate never imports the project's modules` (sentinel `config.mjs`). |
| CR-PNL-03 MAJOR: status cache misses covered-file changes | fixed | The phase-status cache keyed on phase-directory mtimes is gone. The ladder is recomputed on every poll. Polls stay cheap (PANL-07) because `DigestCache` caches each covered file's digest by mtime and size, so an unchanged file is only stat'ed. Test: `PANL-15 a changed covered source file turns COMPLETE into NEEDS_REVIEW on the next poll` (checked against the kit's analyze). |
| CR-PNL-04 MAJOR: roadmap-only and empty phases disappear | fixed | `phaseRoster` lists every ROADMAP phase (with `dir: null` when it has no directory, status NOT_STARTED), then the phase directories ROADMAP does not list. It reads the phases directory, so an empty directory counts. `IndexPhase.dir` and `BoardPhase.dir` are now nullable; the cards and the Phases view handle null. Test: `PANL-15 roster: roadmap-only and empty phases are on the board with the statuses of roadmap analyze`. |
| CR-PNL-05 MAJOR: superseded artifacts used as live state | fixed | `classify` sets `planId` only for direct children of a phase directory. Files under `superseded/` keep their kind and stay browsable in Files, but no board, stat or plan lookup counts them. The plan detail resolves its SUMMARY as the exact sibling path. Tests: `PANL-15 superseded plans and summaries are not live inventory`, plus a retired SUMMARY in the CR-PNL-06 stats test. |
| CR-PNL-06 MAJOR: unparseable summaries count as done | fixed | New `planCompletion` (done/open/unknown) in `shared/planning.ts`. Board, stats and the Phases view never count an errored SUMMARY as done. Percentages are withheld when any plan's state is unknown. `BoardPhase.unparsed` lists the affected files and the card shows them. The wave reader uses the conformant parser (`swarm-map/server/frontmatter.ts`, a byte copy of the planning panel's parser, kept equal by a test) and tells ENOENT apart from read and parse failures (scope `unreadable`, null counts). Tests: `PANL-15 an unparseable SUMMARY is neither done nor a percentage`, `PANL-19 an unparseable SUMMARY is not done...`, and `PANL-61 an unfinished, malformed or unreadable SUMMARY withholds the counts`. |
| CR-PNL-07 MAJOR: ledger merges projects and splits aliases | fixed | `ActivityTarget` carries the agent's `cwd`. New `resolveTouchPath` keeps absolute paths, maps Git-Bash `/c/x` to `C:/x` for a Windows cwd, resolves relative paths against the cwd and normalizes `.` and `..`. A relative path with no cwd is kept per agent (ledger `scope`). Tests: `PANL-37 relative paths resolve against each agent's cwd: two projects never share a file` and `PANL-37 relative, absolute and Git-Bash spellings of one file are one ledger entry`. |
| CR-PNL-08 MAJOR: detail panes hide failures and never refresh | fixed | Plan and file queries poll every `LIST_POLL_MS`. New `detailView` in `nav.ts` decides the pane state: an initial rejection shows "Daemon not reachable" with a Retry button; a refetch rejection keeps the body with a "Reconnecting · showing what was read at HH:MM" note and Retry. The panel's Refresh also refetches the active plan and file queries. Tests: `PANL-16 detail panes: failure, unreachable with no data, stale body after a failed refetch, loading` and `PANL-17 open details poll and Refresh rereads them`. A mounted-pane render test is not possible offline (no React Native renderer in the suite); the state logic is pure and tested. |
| CR-PNL-09 MAJOR: phase card sends a directory to the file reader | fixed | The card action is now "Show the plans of phase N": it switches to the Phases section focused on that phase (`phasesShown`, with an "All phases" link back). No directory is ever sent to `planning.file`. Test: `PANL-21 a board card shows its phase's plans, never sends a folder to the file reader` (helper plus a source check; no offline renderer). |
| CR-PNL-10 MAJOR: appearance bookkeeping kills boot and spawn animations | fixed | New pure `appearance(book, ids, viewKey)` in `client/state.ts` computes the modes of a response before its ids enter the book. The surface stores the modes with the snapshot (`setModes` and `setData` in the same effect), so the render that first mounts a node sees `boot` or `spawn`. `AppearMode` moved to `state.ts`. The regex-only test was replaced by `PANL-49 the response that first draws a node carries its appearance: boot, then spawn, filter change boots`. |
| CR-PNL-11 MAJOR: wave linking follows junctions out of the project | fixed | Run directory, phases root, phase directory and every artifact are checked with `realpath` against the real project roots before reading; an escape means no link (run or phase) or scope `unreadable` (artifact). Test: `PANL-61 junctions out of the project are never followed` (linked phase and linked run as junctions; a linked artifact file when the OS allows file symlinks). |

11 fixed, 0 rejected.

## Files changed

- `plugins/planning-panel/server/`: `ladder.ts` (new), `gsd-link.ts`, `board.ts`, `service.ts`, `kinds.ts`
- `plugins/planning-panel/shared/planning.ts`: nullable phase `dir`, `unparsed`, `planCompletion`
- `plugins/planning-panel/client/`: `nav.ts`, `data.ts`, `details.tsx`, `views.tsx`, `panel.tsx`, `stats.ts`
- `plugins/planning-panel/README.md`
- `plugins/swarm-map/server/`: `rotate.ts`, `wave-link.ts`, `files.ts`, `activity.ts`, plus new `frontmatter.ts` (copy) and `kit-defaults.json` (copy)
- `plugins/swarm-map/client/`: `state.ts`, `swarm-surface.tsx`, `nodes.tsx`
- `plugins/swarm-map/tsconfig.json` (`resolveJsonModule`), `plugins/swarm-map/README.md`
- `tests/ui/`: `planning-ladder.test.mjs` (new), `swarm-rotate-wave.test.mjs` (rewritten), `planning-client.test.mjs`, `swarm-client.test.mjs`, `swarm-snapshot.test.mjs`, `plugin-gates.test.mjs`

## Known gaps

- The bundled ladder is a mirror of the kit's ladder, not the kit module itself. The host makes importing the kit module impossible. `tests/ui/planning-ladder.test.mjs` and the existing PANL-15 parity test compare the two on every ladder state, so a change to `status.mjs` that the mirror misses fails those tests.
- `rotate.ts` mirrors the lenient fallback only for `context_guard`. An overlay that is invalid in some other key makes `ph context` fall back to the installed defaults, while the map still uses the overlay's valid `start_pct`.
- `kit-defaults.json` and the swarm map's `frontmatter.ts` are copies. Their drift tests tell the developer to copy again after a change.

## Tests

- `node --test "tests/ui/*.test.mjs"`: 95/95 pass, including both `tsc --noEmit` checks and the host-compiler gate.
- Full `npm test`: 838 tests, 832 pass, 0 fail, 2 skipped.
- An earlier full run had 4 failing GSDF tests in `tests/gsd-flows/`. That is another area, which other fixers were editing at the same time. Those tests passed when rerun alone and in the final full run.

## Requests filed

None.
