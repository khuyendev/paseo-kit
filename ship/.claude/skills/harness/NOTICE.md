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

Kit-authored overlay update (2026-10-20, owner-authorized LA-01/02 fix):
`references/kit-adapter.md` section 5 now specifies canonical end-to-end target IDs, parser-only normalization
or runner-proven selector mapping, and a mandatory positive/negative dynamic protocol self-check using
`adapter/check.mjs`; section 10 requires reporting its evidence. This is adapter-only guidance, not a change
to any protected method region or upstream text. The source/region provenance inventory remains unchanged.

Kit-authored tier-policy update (2026-10-20, owner request): `references/kit-adapter.md` section 7 keeps model,
effort and `features.fast_mode` in one project tier and directs orchestrators to patch requested fields in one
batched edit, reference tier names by default and preserve unrelated settings. No protected method region or
source/region provenance entry changes; native feature support and per-call model exceptions remain explicit.

Region inventory (source line ranges of the carried file; each region is replaced by the stated number of lines):

- `SKILL.md` lines 10-10 -> 3 line(s): (c) (g)
- `SKILL.md` lines 14-14 -> 1 line(s): (a)
- `SKILL.md` lines 27-27 -> 1 line(s): (a)
- `SKILL.md` lines 102-102 -> 1 line(s): (a)
- `SKILL.md` lines 112-112 -> 1 line(s): (a)
- `SKILL.md` lines 116-116 -> 1 line(s): (f)
- `SKILL.md` lines 135-135 -> 1 line(s): (d)
- `SKILL.md` lines 150-150 -> 1 line(s): (a) (b) (d)
- `SKILL.md` lines 154-154 -> 1 line(s): (a)
- `SKILL.md` lines 217-217 -> 1 line(s): (c)
- `SKILL.md` lines 233-235 -> 3 line(s): (c)
- `SKILL.md` lines 306-306 -> 1 line(s): (b)
- `SKILL.md` lines 374-374 -> 1 line(s): (b)
- `SKILL.md` lines 387-388 -> 2 line(s): (a)
- `references/execution-modes.md` lines 3-3 -> 1 line(s): (c)
- `references/execution-modes.md` lines 152-152 -> 1 line(s): (c)
- `references/execution-modes.md` lines 174-179 -> 6 line(s): (c)
- `references/execution-modes.md` lines 181-182 -> 2 line(s): (c) (f)
- `references/execution-modes.md` lines 187-187 -> 1 line(s): (c)
- `references/model-selection-guide.md` lines 3-3 -> 1 line(s): (f)
- `references/model-selection-guide.md` lines 5-5 -> 1 line(s): (c)
- `references/model-selection-guide.md` lines 122-122 -> 1 line(s): (f)
- `references/team-patterns.md` lines 5-5 -> 1 line(s): (c)
- `references/team-patterns.md` lines 182-182 -> 1 line(s): (f)
- `references/team-patterns.md` lines 191-191 -> 1 line(s): (d)
- `references/team-patterns.md` lines 235-235 -> 1 line(s): (d)
- `references/team-patterns.md` lines 266-266 -> 1 line(s): (b)
- `references/team-patterns.md` lines 276-276 -> 1 line(s): (d)
- `references/team-patterns.md` lines 278-278 -> 1 line(s): (d)
- `references/workflow-recipes.md` lines 3-3 -> 1 line(s): (c)
- `references/workflow-recipes.md` lines 202-202 -> 1 line(s): (f)
- `references/workflow-recipes.md` lines 204-204 -> 1 line(s): (d)
- `references/orchestrator-template.md` lines 3-3 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 28-28 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 48-48 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 63-63 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 65-65 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 79-80 -> 2 line(s): (c)
- `references/orchestrator-template.md` lines 111-111 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 133-133 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 135-136 -> 2 line(s): (c)
- `references/orchestrator-template.md` lines 141-142 -> 2 line(s): (c)
- `references/orchestrator-template.md` lines 152-152 -> 1 line(s): (d)
- `references/orchestrator-template.md` lines 156-156 -> 1 line(s): (d)
- `references/orchestrator-template.md` lines 158-160 -> 3 line(s): (c)
- `references/orchestrator-template.md` lines 166-168 -> 3 line(s): (c) (d)
- `references/orchestrator-template.md` lines 174-174 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 180-180 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 185-185 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 196-196 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 221-221 -> 1 line(s): (c)
- `references/orchestrator-template.md` lines 272-272 -> 1 line(s): (d)
- `references/qa-agent-guide.md` lines 3-3 -> 1 line(s): (c)
- `references/qa-agent-guide.md` lines 87-87 -> 1 line(s): (d)
- `references/qa-agent-guide.md` lines 143-143 -> 1 line(s): (c)
- `references/qa-agent-guide.md` lines 209-209 -> 1 line(s): (c)
- `references/skill-writing-guide.md` lines 3-3 -> 1 line(s): (c)
- `references/skill-writing-guide.md` lines 237-237 -> 1 line(s): (b)
- `references/skill-testing-guide.md` lines 3-3 -> 1 line(s): (c)
- `references/skill-testing-guide.md` lines 76-76 -> 1 line(s): (c)
- `references/team-examples.md` lines 3-3 -> 1 line(s): (c)
- `references/team-examples.md` lines 35-36 -> 2 line(s): (c)
- `references/team-examples.md` lines 38-39 -> 2 line(s): (c)
- `references/team-examples.md` lines 41-43 -> 3 line(s): (c)
- `references/team-examples.md` lines 118-119 -> 2 line(s): (c)
- `references/team-examples.md` lines 121-121 -> 1 line(s): (c)
- `references/team-examples.md` lines 132-133 -> 2 line(s): (c)
- `references/team-examples.md` lines 135-135 -> 1 line(s): (c)
- `references/team-examples.md` lines 146-147 -> 2 line(s): (a)
- `references/paseo-runtime.md` lines 1-433 -> 425 line(s): (c) (d) (f)

`references/paseo-runtime.md` is rewritten as a whole for the new `ph` (category c, with d and f); it keeps the section
numbering the method text refers to. Kit-authored update (2026-10-23, bug-hunt fix G145, FIX1-BRIEF): section 6-6 and
the resume bullet of section 10 state the resume cache key as it now is (effective read-only mode and prompt-note digest
in, raw model spelling out; skill files not keyed). The region inventory above records the new line count.
