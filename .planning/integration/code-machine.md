# code-machine report (M2 machine, MACH)

## Files written
- kit/machine/index.mjs: `run(argv, io)`; CLI surface, usage/exit, `failed:` for expected failures (MACH-01).
- kit/machine/fail.mjs: `Fail` (expected failure).
- kit/machine/context.mjs: paths (template, defaults, plugins, kit-init skill, `$PASEO_HOME/config.json`, `~/.paseo-kit/user-links.json`), input loading, `claudeConfigDir` (MACH-17). `io.kitDir` is a test seam (temp kit copy); kit.mjs never passes it.
- kit/machine/template.mjs: secret pattern, `{{HOME}}`, `render`, `secretResolver` (MACH-10), `templateErrors` (template schema shared by export and the MACH-14 test).
- kit/machine/providers.mjs: `modelPlan`, `retiredModels` (D-15 notes), `policyLines` (MACH-04/05), `patchProviders` (MACH-08/09 additive + union-only, mains after workers).
- kit/machine/plugins.mjs: kit plugin folders `plugins/planning-panel`, `plugins/swarm-map` (id from `paseo-plugin.json`), check lines, patch (MACH-15).
- kit/machine/links.mjs: kit-init links, record `{version: 1, links: [{dest, target}]}`, rename-aside re-point (MACH-16).
- kit/machine/external.mjs: `paseo reload` (`$PASEO_CLI` else `paseo` on PATH, `.cmd` on Windows) and `npm ci` (`npm_execpath` when it is an npm CLI script, else `npm` on PATH).
- kit/machine/check.mjs, apply.mjs, export.mjs: the three verbs.
- paseo/providers.json: produced by `machine export` from the ref-final catalogue (9 models per provider, metadataGeneration kept); descriptions made neutral; worker without policy fields; circle denies exactly `[Agent, Workflow]`.
- user/skills/kit-init/SKILL.md and scripts/kit-root.mjs (INST-30).
- tests/machine/{helpers.mjs, check.test.mjs, apply.test.mjs, export.test.mjs, links.test.mjs, kit-init.test.mjs, fakes/fake-claude.mjs, fakes/fake-paseo.mjs, fakes/fake-npm-cli.mjs}.

## Requirements implemented (with tests)
MACH-01..MACH-19 (all 19 v1), plus INST-30 (the kit-init skill lives in my path; code-install owns the INST prefix otherwise).
MACH-06 is data owned by code-foundation (defaults and schema); tested here against `loadKitConfig()`.

## v1 IDs not implemented
None. INST-30's manual check (running the skill with a live agent) is not automated.

## Behavior choices worth knowing
- Backup name `<config>.bak-<YYYYMMDD-HHMMSS>-kit` in UTC; same-second collisions get `-2`, `-3`.
- A missing worker is cloned from the main only when the main existed before this apply; otherwise built from the template.
- Apply exit: 1 for any gate/secret/patch failure (nothing written); 2 when reload failed, a plugin conflict, an npm ci or link failure, or the follow-up check has a problem; else 0.
- `--link-user-skills` and `--unlink-user-skills` together are a usage error.
- Missing `paseo-plugin.json` in a kit plugin folder: check note/problem; apply with `--enable-paseo-plugins` fails before writing. The two plugin folders do not exist yet (code-ui), so check currently prints two `note kit Paseo plugin folder ...: no paseo-plugin.json` lines.

## Requests filed
- code-machine -> code-foundation: move `policyLines` into ship/.agents/harness/lib/ so ph doctor and machine check share it.
- code-machine -> code-ph: ph doctor policy lines must match machine check (SendMessage never required on a main).

## How to run the tests
`node --test "tests/machine/*.test.mjs"` (offline; temp kit copies and temp homes; fake Claude/Paseo/npm CLIs; ANTHROPIC_* env cleared).

## Known gaps
- The node gate failure path of apply is not tested (needs an old Node).
- MACH-14 secret scan covers kit JSON files on disk (not `git ls-files`, since nothing is committed by coders).
