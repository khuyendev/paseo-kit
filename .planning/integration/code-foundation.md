# code-foundation report

## Files written
- Root: `package.json` (type module, `npm test` = `node --test "tests/**/*.test.mjs"`, no dependencies), `kit.json` (name, version 0.0.1, `units: []` for code-install), `.gitignore`, `kit.mjs` (dispatch `install|update|status|pull` -> `kit/install/index.mjs`, `machine ...` -> `kit/machine/index.mjs`).
- Stubs for other owners: `kit/install/index.mjs`, `kit/machine/index.mjs` (`run(argv, io)` -> `failed: not implemented`, exit 1).
- `ship/.agents/harness.defaults.json` (every key of the closed schema, values per CONF-11 / ADPT-13 / ADPT-16).
- `ship/.agents/harness/config.mjs` (M3 loader), `ship/.agents/harness/platform.mjs`, `ship/.agents/harness/ph.mjs` (entry + registry + `help`/`config`).
- `ship/.agents/harness/lib/`: `io.mjs`, `cli.mjs`, `paths.mjs`, `hash.mjs`, `proc.mjs`, `config-schema.mjs`.
- `ship/.agents/harness/paseo-client/`: `index.mjs` (connect, Session), `locate.mjs`, `limits.mjs`, `usage.mjs`, `plugins.mjs`.
- `tests/fakes/fake-clock.mjs` (FCLOCK), `tests/fakes/fake-daemon.mjs` (FDC); `tests/helpers/{env,temp,run,assert}.mjs`.
- `tests/foundation/{config,paseo-client,paseo-turns,ph-entry,platform-lib}.test.mjs`.
- `docs/INTERFACES.md` (contracts, key table with owners, ownership table), `.planning/integration/requests.md` (created with header).

## Requirement IDs implemented
- CONF-01..CONF-14 (loader, schema, defaults, provenance, `ph config`).
- PCLI-01..PCLI-16 (paseo-client).
- Also, as owner of the files they live in: PHCL-01 and PHCL-02 (ph entry, registry, argument parsing), PHCL-34 (platform module), the single ph-command renderer of PHCL-07 (`phCommand()`), the digest helper of INST-04 (`lib/hash.mjs`).

## v1 IDs not fully implemented and why
All 30 CONF/PCLI requirements are implemented on the foundation side; these acceptance parts need consumer code from other coders (requests filed):
- CONF-08: `ph doctor` behavior (code-ph registers `doctor` with `config: "lenient"`; the lenient mode is implemented and tested with a probe command).
- CONF-09: the file backend's per-request load (code-files; `discoverConfigRoot` is implemented and tested).
- CONF-11: the unconfigured-tier error message and doctor problem lines are raised by `resolveModel` (code-ph).
- CONF-12 / CONF-14: the cross-consumer integration fixtures (hooks, file backend, gsd verb, prompt rendering) need those modules; lint tests already scan all of `ship/`.
- PCLI-04: the doctor `note` comparing `session.version` with `TESTED_PASEO_CLI` (code-ph).
- PHCL-34 `M1 and M2 use the same module` depends on code-install / code-machine importing `platform.mjs`.

## Spec decisions taken (documented in INTERFACES.md)
- No `adopt` verb in `kit.mjs` (D-110: generic adopt is LATER; INST-01 lists only install/update/status/pull), although the assignment text named it.
- `adapter.verify_vocabulary.<kind>.runner` may be `null` (= core built-in: `build` -> `commands.build`, `cmd` -> the argument as argv) so the default `{build, cmd}` vocabulary validates against an empty `commands.verify`.
- `gsd.roles` ships `{}` (agent definitions carry their tier); `adapter.review_lenses` ships `[]` (gsd-flows supplies the kit lens `correctness`).
- A partial nested entry names every missing key in one message: `<first key>: missing key (also missing: ...)` (ADPT-14).
- Daemon target: `$PASEO_HOST`, else `daemon.listen`; without either, a usage error (never the CLI's instance mode, which reads `paseo.pid`).
- Per-agent `disallowedTools` capability is false for the real 0.11 client (MC-03 re-checks); the fake can turn it on.
- `ph` writes `usage error:` / `failed:` lines to stderr, everything else to stdout; a command module file that does not exist yet is skipped by the registry.

## Requests filed
- code-foundation -> code-ph: unconfigured-tier message (CONF-11); doctor as a lenient command and version note (CONF-08, PCLI-04).
- code-foundation -> code-files: per-request config root and load (CONF-09).
- code-foundation -> code-hooks: config loaded only through `config.mjs` (CONF-12).

## How to run the tests
`npm test` (all suites) or `node --test "tests/foundation/*.test.mjs"` from the kit root. Offline: temp homes with spaces, FDC and FCLOCK; nothing under `~/.paseo` or `~/.claude*` is read or written.
Result at hand-off: 64 tests, 64 pass.

## Known gaps
- The real-daemon path (`loadRealDaemon`) is exercised only manually (MC-01): tests never load the npm CLI.
- `TESTED_PASEO_CLI` is `0.11.2` (the installed CLI on the owner's machine at writing time).
- The lint tests in `tests/foundation/` (no `@getpaseo` outside paseo-client, no whole-file `JSON.parse(readFileSync(...))` outside `lib/io.mjs`, no config file names outside `config.mjs`, no `.planning/config.json`) scan all of `ship/` and will flag other modules that break those rules.
