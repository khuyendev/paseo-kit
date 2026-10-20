# Notice

`harness-evolve` is part of the modified port of **Harness v2** by revfactory
(https://github.com/revfactory/harness, version 2.1.0, commit `92d9f1b29e7af81acebf51a9fcd1832e739a1414`,
2026-09-28), licensed under the Apache License 2.0 (see `LICENSE` in this folder). The port's changes are listed
in `.claude/skills/harness/NOTICE.md`.

Adapter-layer edits made by the paseo-kit (2026-10-20, decisions D-109, D-110, D-111):

The method text of the port (tag `ref-final` of paseo-harness-kit, commit `4441a88e5083727a282a4a7efb5872b1d4dac777`) is carried unchanged.
The only edits are the adapter-layer edits below, in the categories of requirement HARN-02:

- (a) paths: .agents/agents/, .claude/skills/<name>/, CLAUDE.md (never project/...)
- (b) single skill tree: the ph skills-sync step and .agents/skills source wording removed (D-10)
- (c) runtime mapping: the new ph (node .agents/harness/ph.mjs, workflow resume shape, watch-run, run dir, kit CLI)
- (d) Claude Code only: no codex/ or opencode/ examples, no non-Claude MCP adapters; circle/<model> only
- (e) no Backlog wording
- (f) config key names and record formats of the new defaults
- (g) one line in each SKILL.md loading the kit overlay (HARN-03)
- (h) the D-59 reading of coding tiers, stated in the overlay only

Category (e) has no region: the carried text has no Backlog wording. Category (h) has no region in the method text: the tier reading lives in the kit overlay
`.claude/skills/harness/references/kit-adapter.md`, which is kit-authored text (not derived from Harness v2) and
states what the harness output is for in this kit (the project adapter, D-109). The kit test
`tests/harness/method-text.test.mjs` checks every shipped file against the source copy in
`tests/harness/fixtures/method-source/` and the region inventory in `tests/harness/fixtures/PROVENANCE.json`.

Region inventory (source line ranges of the carried file; each region is replaced by the stated number of lines):

- `SKILL.md` insertion before line 10 -> 2 line(s): (g)
- `SKILL.md` lines 24-24 -> 1 line(s): (b)
- `SKILL.md` lines 69-71 -> 3 line(s): (a) (f)
- `SKILL.md` lines 74-74 -> 1 line(s): (b)
- `SKILL.md` lines 78-78 -> 1 line(s): (c) (f)
