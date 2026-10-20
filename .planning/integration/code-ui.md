# code-ui report (M13 ui, PANL)

## Files written

- `plugins/.gitignore` (`node_modules/`), `plugins/smoke.mjs` (manual live-daemon smoke, PANL-10).
- `plugins/swarm-map/`: `paseo-plugin.json`, `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`,
  `index.server.ts`, `index.client.tsx`;
  `shared/swarm.ts` (zod contracts, `swarm.snapshot`, `swarm.agent-detail`, envelopes);
  `server/` `limits.ts` (every cap), `text.ts`, `file-input.ts`, `describe.ts`, `files.ts` (ledger), `activity.ts`,
  `events.ts`, `group.ts`, `rotate.ts` (PANL-55), `wave-link.ts` (PANL-61), `snapshot.ts`;
  `client/` `format.ts`, `palette.ts` (+ legend), `state.ts`, `labels.ts`, `geometry.ts`, `effects.ts`,
  `register.ts`, `anim.ts`, `ring.tsx`, `links.tsx`, `nodes.tsx`, `panels.tsx`, `swarm-surface.tsx`.
- `plugins/planning-panel/`: same top-level files;
  `shared/planning.ts` (four RPCs, envelopes, ladder order, status -> tone map, tolerant PLAN schema, `summaryDone`);
  `server/` `common.ts` (workspace dir, envelopes, containment), `frontmatter.ts` (GSDC-05 port), `kinds.ts`,
  `indexer.ts`, `gsd-link.ts`, `board.ts`, `documents.ts`, `service.ts`;
  `client/` `format.ts`, `color.ts`, `tree.ts`, `markdown.ts`, `stats.ts`, `projects.ts`, `nav.ts`, `data.ts`,
  `register.ts`, `kit.tsx`, `markdown-view.tsx`, `views.tsx`, `details.tsx`, `panel.tsx`, `sidebar.tsx`.
- `tests/ui/`: `fake-paseo.mjs`, `planning-fixtures.mjs`, `swarm-describe`, `swarm-ledger-events`,
  `swarm-snapshot`, `swarm-rotate-wave`, `swarm-client`, `planning-server`, `planning-client`,
  `planning-frontmatter`, `plugin-gates` (`*.test.mjs`).

Both plugins are TypeScript with erasable syntax only and `.ts` import specifiers (`allowImportingTsExtensions`,
`erasableSyntaxOnly`, `verbatimModuleSyntax`), so the offline tests import the server and pure client modules
directly with Node 24 type stripping. React components (`.tsx`) are typechecked, not executed; their logic lives in
pure `.ts` modules (`state.ts`, `nav.ts`, `register.ts`, ...) that the tests drive. Dependencies were installed
with `npm install --ignore-scripts` in each plugin folder (pins: `@getpaseo/plugin` 0.11.2 = installed Paseo and
`TESTED_PASEO_CLI`, react 19.1.0, react-native 0.81.5, zod ^4.4.3, typescript ^5.9.3, `@types/node` ^24).

## Requirements

Implemented by me, each with at least one offline test (58 of 59 v1): PANL-01..08, PANL-10, PANL-11..57,
PANL-60, PANL-61. PANL-10 is `plugins/smoke.mjs` with an offline test of its scope; running it is manual.

Not fully verifiable offline (implemented, manual check still owed):
- PANL-10: run `node plugins/smoke.mjs` against the live daemon (it also checks every icon name against the
  Paseo desktop bundle, `--app-dir` to point at it).
- PANL-48, PANL-49: visual checks on the installed Paseo; offline tests cover the pure parts (ring values, wave
  line, boot stagger, NEW/ghost timings, appear-mode rule).
- PANL-34 golden fixture of a real `circle-agent` worker timeline (manual capture) was not captured: no daemon
  access from this task. The table tests cover the three harness-files tools and the native tools.
- PANL-07 recovery after a daemon restart, PANL-01 `paseo plugin install` + `ls` showing `running`.

v1 not counted as mine: PANL-09 is owned by M2 (`kit/machine/plugins.mjs`, MACH-15); my test only checks that its
`KIT_PLUGIN_FOLDERS` equals the two plugin folders and that each has a `package-lock.json` for `npm ci`.
Later/withdrawn: PANL-58 (later), PANL-59 (withdrawn).

## Decisions worth knowing

- Paseo 0.11.2 SDK: `addSurface`/`addSidebarItem` are deprecated aliases of `addScreen`/`addSidebarHeaderItem`
  but present; PANL-02 names surfaces and sidebar items, so the aliases are used. Switch when Paseo drops them.
- PANL-55: `rotatePct` per agent = `context_guard.start_pct` from `loadConfigLenient(root)` of the project's own
  installed `.agents/harness/config.mjs` (root found by the kit's `discoverConfigRoot(cwd, {})`), else
  `loadKitConfig()` of `ship/` beside the plugin; null (and one `rotate ...` snapshot error) when neither loads.
  The header chip shows the threshold when all drawn agents share it, else `ctx ≥ROTATE`.
- PANL-15: statuses come from gsd-core itself: `phaseStatus(codeRoot, findPhase(codeRoot, phaseDir)).status`
  (workspace `.agents/harness/gsd/` first, else kit `ship/`); the test compares the board with `analyze()` of
  `ph gsd roadmap analyze` on one phase per ladder state.
- PANL-14: the panel parser is a TypeScript port; the test checks it against gsd-core `yaml.mjs` `frontmatter()`
  (same data, same error line) on shared cases and on `tests/gsd-core/fixtures/frontmatter/*.md` if that folder
  appears. Scalars follow the kit parser (`plan: 01` -> 1). Error text is `line N: <msg>`; messages differ.
- PANL-56: the snapshot sends at most 2 files of an agent's current activity (`SNAPSHOT_ACTIVITY_FILES`; a node
  shows 2 chips); the cache, inspector and events keep up to 24 (PANL-35). Needed to stay under 150 KB with 100
  agents doing 40-file batch reads.
- Plan completion: a plan is done when its SUMMARY exists and its `status` is not `halted`/`failed` (absent status
  counts as done) - shared `summaryDone` in `shared/planning.ts`; the swarm map's wave link applies the same rule.
- PANL-61: the project of a group is the Paseo workspace directory of its first `harness.run`-labelled agent
  (`workspaces.ref(id).current() ?? refresh()`, cached 30 s), falling back to the agent's cwd without a workspace.
- `planning.index` also carries `phases[]` with ladder statuses and `statusError`, so `computeStats` stays pure;
  index entries carry plan `requirements` for id links in rendered markdown.

## Requests filed

In `.planning/integration/requests.md`, both marked resolved (code-gsd-core had already shipped the exports): keep
`phaseStatus`/`findPhase` (status.mjs, planning.mjs) and `frontmatter` (yaml.mjs) stable.

## How to run the tests

From the kit root (needs `npm install --ignore-scripts` done once in `plugins/planning-panel` and
`plugins/swarm-map`):

    node --test "tests/ui/*.test.mjs"

77 tests, all offline (fake SDK, temp dirs with spaces; the PANL-01 test runs `tsc --noEmit` in both plugins,
about 3 s). Typecheck alone: `node node_modules/typescript/bin/tsc --noEmit` inside a plugin folder.

## Known gaps

- Components are not rendered in tests (no React Native renderer offline); "component test" acceptances are met
  through the pure state modules and source assertions (PANL-44, 50, 51, 52, 54, 16 guard, 21).
- Whether Paseo's client bundler accepts `.ts` import specifiers is unverified until `paseo plugin install`; if it
  does not, drop the extensions (and `allowImportingTsExtensions`) and point the tests at a loader.
- The planning panel's Phase links (`Phase N` in prose) open ROADMAP.md, requirement ids open REQUIREMENTS.md
  (no anchor scrolling).
- `ph context` default threshold is read strictly by `ph`; the plugin uses the lenient loader, so with a broken
  overlay the ring falls back to the kit defaults while `ph context` errors.
