# Notice

This skill (`harness`, with `harness-evolve`) is a modified port of **Harness v2** by revfactory
(https://github.com/revfactory/harness, version 2.1.0, commit `92d9f1b29e7af81acebf51a9fcd1832e739a1414`,
2026-09-28), licensed under the Apache License 2.0 (see `LICENSE` in this folder).

Changes made in this port (2026-10-02):

- Translated from Korean to English.
- The runtime primitives were moved from Claude Code's in-session tools (`Workflow`, `Agent`, `SendMessage`,
  `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`, `TaskStop`) to Paseo agents driven by
  `scripts/paseo_harness.mjs` (`ph`). The method itself (phases 0-7, execution modes, team patterns, quality
  patterns, agent/skill/orchestrator structure, testing, evolution) is unchanged.
- Added `references/paseo-runtime.md` (the runtime contract) and `scripts/` (runtime, config, tests).
- The evolve skill is a project skill named `harness-evolve` (upstream: plugin skill `harness:evolve`).
- Output language (owner decision 2026-10-03): generated agents, skills, orchestrators and `CLAUDE.md` entries are
  written in English, not in the user's conversation language (upstream principle 6).
- Packaged as the paseo-harness-kit (2026-10-06): the project files are installed and updated by the kit's
  `install.mjs`, the per-project settings live in `.agents/harness.config.json`, and the MCP servers and Paseo
  providers are set up once per machine by the kit's `machine.mjs`.
