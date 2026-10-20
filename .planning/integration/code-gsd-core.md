# code-gsd-core integration report (M9 gsd-core, GSDC)

## Files written

Runtime (`ship/.agents/harness/gsd/`, registered as the `gsd` command through `commands.mjs`):
- `commands.mjs`: the `gsd` command (`config: "none"`, raw argv), dispatcher (`query x.y`, `x.y`, `x y`, `x`), global `--pick` and `--root`, JSON last line, exit 0/1/66/69, `VERBS` table, library entry `runGsd(argv, {env, root, stdin, out, err, write, errWrite})` -> exit code.
- `verbs.mjs` (ported handlers), `verb-table.mjs` (`NOT_PORTED`: upstream verbs named by the vendored text, each with a reason; exit 69).
- `common.mjs`, `yaml.mjs` (YAML subset, GSDC-05), `planning.mjs` (tree, phase ids, artifact kinds, plans/tasks), `roadmap.mjs`, `requirements.mjs`, `state.mjs` (STATE format, lock, single writer `writeShared`), `status.mjs` (fingerprint, verification/research status, `phaseStatus` ladder), `revisions.mjs` (revisions + attempts), `plan-checks.mjs`, `adapter-hooks.mjs` (vocabulary, ownership, ADPT-15 calls through code-harness's `adapter/hooks.mjs` `invokeHook`), `outline.mjs` (outline, waves, handoff), `phases.mjs`, `artifacts.mjs`, `gitverbs.mjs`, `git.mjs`, `tools.mjs` (run-with-timeout, normalize-test-command, health), `debug.mjs`, `upstream.mjs` (vendor/build/check/bump).

Method text (`ship/.agents/`):
- `gsd/upstream/` + `UPSTREAM.json`: snapshot of open-gsd/gsd-core `next` @ 274f8cae13d03ad80e18959b135b0e51b33329e8, 246 files (the inventory sources plus every file they reach to depth 3), vendored with `ph gsd upstream vendor --from C:/Users/fish/ext-src/gsd-core --commit 274f8ca...` (no process run in the clone; HEAD read from `.git`).
- `gsd/inventory.json` (GSDC-53), `gsd/overlays/*.md` (kit-core + one per role), `gsd/generated/` (15 method workflow texts, `executor-rules.md`, `plan-phase-contracts.md`, `debug-prompts.md`), `gsd/NOTICE.md` (GSDC-49 departures). Note: these sit in `ship/.agents/gsd/` beside the assigned `upstream/`; nobody else owns that folder.
- `agents/`: 12 generated GSD agents (kit front matter + GENERATED line + `<kit_adapter_precedence>` + upstream body with the three path rewrites; `include:` = kit-core overlay, role overlay, contract file where needed) and the kit-authored `gsd-skeleton-reviewer.md`, `finding-verifier.md` (GSDF-04 roster).
- `LICENSES/gsd-core-MIT.txt` (= vendored LICENSE).

Tests: `tests/gsd-core/` (`fixture.mjs`, `yaml`, `planning`, `state`, `checks`, `records`, `git`, `upstream` test files).

## Requirements implemented (51 of 51 v1)

GSDC-01..50 and GSDC-53, each with at least one test named by its ID. GSDC-51 and GSDC-52 are `later`.

## Not implemented / partial (v1)

None missing. Parts that belong to other modules: GSDC-13's "progress router" and GSDC-30's workflow kill/resume scenario are exercised here at the verb level only (the workflow side is code-gsd-flows); GSDC-47 "runs in ph doctor" needs code-ph (request filed).

## Contracts other modules use

- Verbs: `ph gsd verbs` lists the ported set. Phase arguments accept a number (`1`, `01.1`) or `.planning/phases/<dir>`; a missing phase exits 66 (`init.*` exits 69 per GSDC-17).
- Attempt records: `attempt record <phase> --kind gap|verify|research --run-id R --input-digest D [--before sha] [--done true] [--result <json>]` or the same fields as stdin JSON. A blocked research attempt is recorded with `--result '{"status":"blocked"}'` (research status then answers `blocked`).
- Revisions keys: `research`, `inputs`, `freeze`, `plan:<id>`, `plans`, `checked`, `handoff`; harness role text is hashed from the invoking checkout as `harness:<path>`.
- Handoff task fields add `agent` (`adapter.agents.executor` or `gsd-executor`) and `files_deleted` to the GSDC-27 list.
- Phase completion record: `<phaseDir>/complete.json` `{phase, verification, verification_sha, at}`; halt records `<NN>-<MM>-HALT.json` (any JSON) are written by the execute orchestrator.
- commits.json (GSDF-53): array of `{sha, phase, wave, plans: {<plan id>: [files]}}` in the phase dir.
- STATE writers: `state init|position|planned-phase|wave|decision|override|session-note|rederive|load`; status words exactly GSDC-11.
- Debug: `debug create` (stdin JSON), `status <slug>`, `list`, `checkpoint <slug>` (stdin `{question, answer}`, fenced as data), `close <slug> --outcome resolved|diagnosed [--summary --why --guard]`.
- Upstream: `ph gsd upstream vendor --from <clone> [--commit sha] | build | check [--verbose] | bump --from <clone> --commit <sha>`, each with optional `--target <dir>` (default: the install root holding `.agents/`, i.e. `ship/` in the kit). Extra not-ported rows can be added in `inventory.json` `extra_verbs`.
- Adapter hook scripts are resolved relative to the code root (as code-harness's `invokeHook` does).

## Requests filed (`.planning/integration/requests.md`)

- -> code-foundation: CONF-07 lint must exclude the vendored snapshot and generated upstream texts (they mention `.planning/config.json`; D-111 forbids editing them). This is the only foundation test my files make fail.
- -> code-ph: run `gsd upstream check` in `ph doctor` (GSDC-47).
- -> code-gsd-flows (info): paths of the generated method texts and contract files; `runGsd` library entry; send skill-wrapper paths for inventory rows.
- -> integrator: NOTICE.md should point to `ship/.agents/gsd/NOTICE.md` and `LICENSES/gsd-core-MIT.txt`.
- Taken from code-harness's request: ADPT-15 calls go through `adapter/hooks.mjs` `invokeHook`. The other helpers it offered (`contract.mjs` classify/owns) are not used yet: the core keeps its own small vocabulary/ownership functions (same semantics); merging them is a cleanup for the integrator.

## How to run the tests

`node --test "tests/gsd-core/*.test.mjs"` (offline; temp projects with spaces; git required). Result: 53 tests, 53 pass. `node ship/.agents/harness/ph.mjs gsd upstream check` on the kit prints `check: 0 problems, 1 warnings` (the warning: upstream references `gsd-core/workflows/context-bridge.md`, which does not exist at the pin; recorded in `UPSTREAM.json` `absent_upstream`).

## Known gaps

- The snapshot is 246 files / 3.4 MB because the closure follows references to depth 3 (so check has no dangling-reference warnings beyond the one absent upstream).
- `gsd_run` verb scanning uses a small prose stop-word list plus "group words" (prefixes of dotted verbs) to tell a sub-verb from an argument.
- `phase remove` renumbers later phases (dirs, file prefixes, `Phase N` mentions in ROADMAP and REQUIREMENTS) but refuses when a later phase has started work.
- Dates in STATE/ROADMAP come from the system clock (verbs, not workflow scripts).
