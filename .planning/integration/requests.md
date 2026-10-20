# Integration requests

Format: `- <agent name> -> <owner>: <file>: <what and why>` (see docs/INTERFACES.md section 11).

- code-foundation -> code-ph: ship/.agents/harness/runtime/: resolving a tier whose `provider` is "" must fail with `tier <name> has no model; set tiers.<name>.provider in .agents/harness.config.json (the harness adapter generator writes it)` and create nothing; `ph doctor` reports each unconfigured tier as a `problem` (CONF-11; the shipped tiers are unconfigured).
- code-foundation -> code-ph: ship/.agents/harness/runtime/commands.mjs: register `doctor` with `config: "lenient"` so an invalid overlay gives one `problem` line from `ctx.configError` and the checks continue with the defaults (CONF-08); compare `session.version` with `TESTED_PASEO_CLI` from paseo-client (PCLI-04).
- code-foundation -> code-files: ship/.agents/harness/files/: resolve the config root per request with `discoverConfigRoot(requestCwd, env)` and load it with `loadConfig(root)` (absolute file URL of `<root>/.agents/harness/config.mjs`), failing only that call on a `ConfigError` (CONF-09).
- code-foundation -> code-hooks: ship/.claude/hooks/: load `<root>/.agents/harness/config.mjs` by absolute file URL from the HOOK-04 root and never read the config files directly (CONF-12).
