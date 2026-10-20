# code-harness report (M11 harness, M12 adapter)

## Files written
- `ship/.claude/skills/harness/`: `SKILL.md`, `references/{execution-modes, team-patterns, team-examples, orchestrator-template, qa-agent-guide, skill-writing-guide, skill-testing-guide, model-selection-guide, workflow-recipes}.md` (method text carried from paseo-harness-kit tag `ref-final`, HARN-02 adapter edits only), `references/paseo-runtime.md` (rewritten for the new `ph`, section numbering kept), `references/kit-adapter.md` (new kit overlay: D-109 adapter generation, D-59 tier reading, lint, trigger records, history row, evolve sources), `NOTICE.md` (port notice + kit adapter-edit categories + region inventory), `LICENSE` (Apache-2.0).
- `ship/.claude/skills/harness-evolve/`: `SKILL.md` (carried, adapter edits only), `NOTICE.md`, `LICENSE`.
- `LICENSES/harness-Apache-2.0.txt`.
- `ship/.agents/harness/adapter/`: `contract.mjs` (helpers the core calls by name, ADPT-02..09), `hooks.mjs` (ADPT-15 invocation and closed response shapes), `mutex.mjs` (ADPT-10), `evidence.mjs` (ADPT-17 verdict and current inputs), `frontmatter.mjs`, `records.mjs` (history table, eval and trigger records), `lint-text.mjs`, `lint-scripts.mjs`, `lint-assets.mjs`, `lint.mjs`, `commands.mjs` (`ph harness lint [--all]`).
- `tests/harness/`: `method-text.test.mjs`, `lint.test.mjs`, `adapter.test.mjs`, `fixtures/method-source/` (source copies of the carried files, the old NOTICE and LICENSE), `fixtures/PROVENANCE.json` (repo, tag, commit, per-file sha256, 75 inventoried regions `{file, from, to, lines, categories, sha256}`).

## Requirement IDs implemented (31 of 35 v1)
- HARN-01 (harness + harness-evolve; ai-orchestrator see below), HARN-02, HARN-03, HARN-05, HARN-06, HARN-07, HARN-08, HARN-09, HARN-10, HARN-11, HARN-12, HARN-13, HARN-16, HARN-18.
- ADPT-01..ADPT-17 on the adapter side: the contract helpers, hook protocol, mutex, evidence verdict, the linter's adapter checks, and tests of the M3 validation behaviour the adapter relies on (ADPT-01/11..14 are enforced by code-foundation's schema; tested here from the adapter's point of view).

## v1 IDs not implemented and why
- HARN-04 (generated adapters for two stacks): a live smoke with real agents; not runnable offline. The kit-side part (ship/ carries no project adapter) is tested in ADPT-16.
- HARN-14 (AGENTS.md block rules): the block lives in `ship/blocks/` (code-install). Request filed.
- HARN-15 (CHANGELOG and release check): integrator. Request filed.
- HARN-17 (ai-orchestrator): no coder owns `ship/.claude/skills/ai-orchestrator/`, and D-53 drops the skill while HARN-17/HARN-01 keep it. Request filed to the integrator; the carry is a 10-minute job with the same PROVENANCE mechanism.

## Requests filed (`.planning/integration/requests.md`)
- integrator: ai-orchestrator ownership/decision (HARN-17); CHANGELOG + release check (HARN-15).
- code-install: HARN-14 block rules; HARN-16 install check; shipping the two skill units.
- code-foundation: INTERFACES section 8 names the command `harness` (HARN-05 says `ph harness lint`), not `adapter`.
- code-gsd-core, code-gsd-flows, code-hooks: use the adapter helpers (hooks, contract, evidence, mutex) instead of re-implementing ADPT-03/04/05/08/09/10/15/17.
- code-ph: the `ph` skill index links `references/workflow-recipes.md` and `references/paseo-runtime.md`; report command-form differences.

## Spec decisions taken
- Command name `ph harness lint` (requirement text) with `--all`; findings print `fail|warn <file>[:<line>]: <msg>`, then `lint: <f> failed, <w> warnings (<n> files checked)`; exit 2 on any fail, 0 otherwise, 1 for usage errors.
- Lint scope = Scope paths of the last row of `.agents/harness-history.md` (directories expand) + the adapter's stack skill folder, mapped agents and scripts. `--all` adds every other skill, agent and `.claude/commands/` file as `advisory:` warnings.
- Primitive lint: call forms, imperative `Use/Call <name>` lines and `team_name`/`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` assignments fail; `Agent`/`Workflow` count only as call forms or explicit tool uses (they are ordinary words); bare mentions of the other names and `broadcast` warn.
- Trigger records live at `.agents/skill-tests/<skill>/triggers.json` (`{skill, date, model, requests[{text, should_trigger, triggered}], precision, recall}`, >= 10 + 10); stated in the overlay.
- PROVENANCE regions carry a list of categories (one region can need two, e.g. `(b) (d)` for the removed skills-sync and Codex sentence). `paseo-runtime.md` is one whole-file region (c, d, f).
- `harness-evolve` gets its own `NOTICE.md` and `LICENSE` (derived text ships there too).
- The history-table example in harness-evolve gained the D-60 `Supersedes` column and a repo-relative Scope (categories a, f).
- Evidence inputs hash file bytes (sha256), `currentInputs` is the one helper for writers and readers.

## How to run the tests
`node --test "tests/harness/*.test.mjs"` from the kit root (offline; temp projects with spaces in their paths). Result at hand-off: 37 tests, 37 pass.

## Known gaps
- Live smokes of HARN-03, HARN-04, HARN-10, HARN-11, HARN-12 are not run (they need real agents).
- `paseo-runtime.md` documents the `ph` surface from the requirements (PHCL/FLOW); it is not cross-checked against code-ph/code-workflow code, which was in progress.
- The front matter parser duplicates the PHCL-26 subset that code-ph also implements; one shared module would be better (no shared lib exists for it).
- ADPT-16's deny-list scan covers all of `ship/` (except the vendored GSD upstream) and will flag any coder's file that names a project or engine.
- To regenerate PROVENANCE after a deliberate method-text edit, compute the line diff of each shipped file against `tests/harness/fixtures/method-source/` and record the changed source ranges with the sha256 (`textDigest`) of their replacement lines; the one-off build script used here was not kept in the repo.
