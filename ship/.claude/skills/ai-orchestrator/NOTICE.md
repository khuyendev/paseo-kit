# Notice

`ai-orchestrator` is kit-authored text carried from paseo-harness-kit (tag `ref-final`, commit
`4441a88e5083727a282a4a7efb5872b1d4dac777`, `project/.agents/skills/ai-orchestrator/SKILL.md`) unchanged except for
the adapter-layer edit below (HARN-17, D-111). It is not derived from Harness v2.

Region inventory (source line ranges of the carried file; each region is replaced by the stated number of lines):

- `SKILL.md` lines 8-8 -> 1 line(s): (f) the agent limit is read from `max_subagents` in the effective config instead of a fixed number

The kit test `tests/harness/method-text.test.mjs` checks the shipped file against the source copy in
`tests/harness/fixtures/method-source/` and the region inventory in `tests/harness/fixtures/PROVENANCE.json`.
