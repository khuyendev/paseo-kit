# code-install report (M1 install)

## Files written
- `kit/install/index.mjs`: `run(argv, io)` for `install|update|status|pull`: argument parsing, target refusal, platform line, `failed:` / `error:` mapping. `io.kitDir` and `io.now` are test-only hooks (the running kit folder and the manifest clock).
- `kit/install/units.mjs`: kit loading and self-check (kit.json units + one block unit per `ship/blocks/*`; test-path rule; every template hook script must be a listed unit), `listShipFiles`, template script extraction. Run as `node kit/install/units.mjs [--write]` to list or rewrite kit.json `units`.
- `kit/install/manifest.mjs`: `.agents/harness-kit.json` read (older-format refusal) and write (five keys, code-point sorted files).
- `kit/install/state.mjs`: six-state classification and help texts.
- `kit/install/parts.mjs`: project/kit digests per part, copy kit -> project (bytes rewritten, fresh mtime), copy project -> kit (pull), retired-part deletion.
- `kit/install/text.mjs`: AGENTS.md marked block (find/put/drop), `.gitignore` block, CLAUDE.md import.
- `kit/install/hooks.mjs`: settings reconcile (pure `reconcileSettings` + wiring step with blocked scripts).
- `kit/install/mod.mjs`: `--enable-plugin` gates (Node, Claude version), asset check against the prospective record, marketplace reuse/stop, `claude plugin install`, the no-flag note.
- `kit/install/wiring.mjs`: ordered wiring list (hook reconcile, mod activation, CLAUDE.md import, .gitignore block, seeds) and `wire()`.
- `kit/install/verbs.mjs`: install, update, status, pull.
- `kit/install/help.mjs`: `HELP` lines for `kit.mjs help` (INST-28).
- `kit/install/failure.mjs`: `KitFailure` (expected failure).
- `ship/templates/settings.hooks.json` (HOOK-01 seven entries), `ship/templates/harness.config.json` (seed: `_notes`, `adapter: {}`, `gsd: {}`; passes `loadConfig`), `ship/templates/harness-history.md` (D-60 table with Supersedes).
- `ship/blocks/AGENTS.md`: the always-loaded rules block (HARN-14 rules: File I/O, Definition of Done, agents and waiting, planning-state pointer).
- `kit.json`: only the `units` list (snapshot, 106 files at hand-off).
- Tests: `tests/install/{helpers,fake-claude}.mjs`, `tests/install/{cli,units,lifecycle,blocks,ownership,wiring,mod,real-kit}.test.mjs`.

## Requirement IDs implemented
INST-01..INST-22, INST-24..INST-26, INST-29, INST-31..INST-33 (29 of 32 v1 IDs; INST-27 is withdrawn).
Partially: INST-23 (Claude gate and lookup used through `platform.mjs`; the `NODE_RUNTIME` table is foundation's, requested), INST-28 (help text written and tested; wiring into `kit.mjs help` is foundation's and README is the integrator's, requested).
Installer parts of other prefixes, tested here: HOOK-01 (template content), HOOK-02 (managed set derived from the template; template script outside kit.json fails the self-check; shipped hook scripts == template scripts), HOOK-03 (project hooks coexist), HARN-14 (block anchors and size).

## v1 IDs not implemented and why
- INST-30 kit-init user skill: `user/skills/kit-init/` belongs to code-machine (ownership table).
- INST-23 / INST-28: see partial above (pieces live in files other coders own).

## Requests filed
- code-install -> code-foundation: `kit.mjs help` / `--help` printing `kit/install/help.mjs` HELP (INST-28).
- code-install -> code-foundation: `NODE_RUNTIME` table in `platform.mjs` (INST-23).
- code-install -> integrator: rerun `node kit/install/units.mjs --write` after all modules land; README INST-28 items.

## Decisions taken
- Output: per-file lines only for changes (`updated`, `deleted`, `kept`, `conflict`, `pulled`, `skipped`); install prints nothing for plain copies. `failed pull <part>: not a kit part` goes to stderr.
- A step failure prints `failed: <step>: <msg>`, e.g. `failed: mod activation: file mod has untracked or locally modified assets; resolve conflicts before enabling` (INST-18 + INST-20 combined).
- Malformed block markers: `conflict ...` in install/update (counts as kept), a `malformed` line in status, `skipped` in pull; never written.
- `status` accepts `--force` (ignored), as INST-01's usage line lists it.
- Marketplace name and plugin name come from `FILE_PLUGIN_ID` (`harness-files@paseo-harness-kit`); the marketplace list entry folder is `path` or `installLocation`; an unreadable listing counts as none.
- `pull` writes the manifest with the target kit's version (INST-05 literal reading).
- The AGENTS.md block text is written here (ship/blocks is this module's path); code-harness owns HARN-14 wording and may request edits.

## How to run the tests
`node --test "tests/install/*.test.mjs"` from the kit root. Offline: temp kit/project/home folders with spaces, fake Claude CLI (`tests/install/fake-claude.mjs` via `CLAUDE_CLI`, log in `FAKE_CLAUDE_LOG`), a Windows `.cmd` shim test, no daemon, no live config. Result at hand-off: 48 tests, 48 pass.

## Known gaps
- `kit.json` units is a snapshot; other coders' later files are not shipped until the list is regenerated. `INST-03 the shipped kit.json passes its self-check` and the INST-25 test use the real list, so a file removed after the snapshot fails them until the regen.
- INST-25 covers `ph config`, an unknown `ph skills-sync` and the kit-path grep with the kit folder deleted; the io guard, file backend and `ph gsd roadmap analyze` parts of its acceptance need those modules and belong in the integrator's cross-module run.
- The Node gate (`nodeRuntimeReady`) cannot be faked from the CLI, so its failure branch has no test.
- `tests/foundation` CONF-02/CONF-12 lints currently flag files of code-files and code-hooks (not install).
