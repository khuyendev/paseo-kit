# Live adapter contract fix — 2026-10-20

## Status

Implementation fixed; offline validation passed. **HARN-04 / CR-HAR-09 remain open pending separate live requalification.** No agent was spawned, no main/teammate message was sent, no provider/credential/daemon change was made, and no commit was created by this fixer. Failed live fixtures/artifacts were not modified. This session used the provided Astra runtime; no model switch occurred.

## Diagnosis

LA-01 selected `test/service.test.mjs` through parse/resolve but reported only `health,missing` as executed. LA-02 accepted/documented `all` but reported only `greeting,usage`. These are two instances of a generated adapter switching identity domains between selection and evidence. The existing `executionProblem` correctly rejects both; passing runner exit and two executed tests cannot prove the differently named obligation.

The kit-authored overlay previously required each hook to be tested by hand with one request and required a nonzero execution count, but did not explicitly require canonical IDs across the whole protocol, explain where alias expansion fits the closed resolver shape, or require a complete positive/negative protocol check before readiness. Independent scripts could each look correct while their outputs did not connect. Structural lint and successful general build/test commands did not expose this mismatch.

## Changed files

- `ship/.claude/skills/harness/references/kit-adapter.md`: section 5 adds canonical target identity rules and mandatory readiness self-checks; section 10 requires the self-check results/log paths in the report. Parser normalization precedes execution; resolver validates IDs unchanged. Retained file/suite selectors need runner-derived membership AND completion proof. No request echoing, discovery-only execution claims or exit-code bypass for test coverage.
- `ship/.agents/harness/adapter/check.mjs`: small reusable `checkObligation` and explicit standalone CLI. Calls existing `gateObligation`, `invokeHook`, `runArgv`, adapter mutex and unchanged `executionProblem`. Requires `execute: true` / `--run`, retains a fresh transcript/log directory, stops on non-ok resolution, rejects empty concrete selections, failed runner/evidence and missing execution coverage. Lint is untouched.
- `tests/harness/adapter-identity.test.mjs`: 12 offline regressions using executable project-owned fixture adapters and real assertion functions. Covers normalized multi-test file, suite alias, exact single target, retained-file runner mapping, incomplete/partial mapping, both old mismatches, exact original live evidence payloads, zero execution, missing executed member, failed runner despite positive evidence, unknown selector, empty parse, lint non-execution and CLI opt-in/exit codes.
- `tests/harness/method-text.test.mjs`: readiness wording/NOTICE regression; existing protected-method/source-region checks remain intact.
- `ship/.claude/skills/harness/NOTICE.md`: enumerates the kit-authored overlay section 5/10 change and explicitly preserves source/region provenance. No source or region hash changed because no protected method region changed.
- `docs/INTERFACES.md`: documents identity semantics and the opt-in helper/CLI contract without introducing config or hook fields.
- `CHANGELOG.md`: owner authorization, date, adapter-only decision and qualification boundary.
- `kit.json`: refreshed with the existing units command; adds only `.agents/harness/adapter/check.mjs` (457 units). This manifest stores the shipped-unit list, not per-unit hashes; install derives digests using the existing implementation.
- `_workspace/live-fix/validate.mjs`: local reproducible validation driver, with logs and `validation.json` alongside it.
- `.planning/integration/close-live-findings.md`: this report.

No changes to `contract.mjs`, `evidence.mjs`, protected Harness/GSD method bodies, vendored upstream text, owner config, specs or preserved failed fixtures. Concurrent unrelated planning files observed in git status were left alone.

## Why this implementation

A standalone explicit check reuses the actual adapter boundary rather than duplicating gate acceptance rules in prose or inventing a new configuration ecosystem. It provides a concrete generation-time command and durable parse/resolution/runner/evidence diagnostics while keeping structural lint safe. It does not change the GSD execution gate or synthesize successful target identities.

In the existing protocol only parse can normalize the target set: resolve returns exactly one status for each requested target, not a replacement set. The instructions now make that distinction explicit. `{targets}` carries the normalized IDs to the runner. The alternative retained-selector fixture proves a file ID only after all known members actually complete and the runner's completion record is present; either missing proof keeps the file unproven.

The helper rejects invalid outcomes, but cannot know whether a project hook is lying or whether a parser expanded a suite incompletely. Mandatory project self-check assertions therefore use independently known expected IDs/counts, inspect raw runner records, and cover every advertised selector form. This is the smallest useful executable check plus the semantic obligations that cannot be inferred generically.

## Validation

Run from `C:/Users/fish/Desktop/paseo-kit` via `node _workspace/live-fix/validate.mjs`:

| Check | Result |
| --- | --- |
| `node --test "tests/harness/*.test.mjs"` | 70/70 passed; no skips |
| `node kit/install/units.mjs --write` | 457 shipped units; exit 0 |
| `npm test` | 901 passed / 903 total; 0 failures, 2 platform skips, 0 TODO |
| `ph gsd upstream check`, root explicitly set to `ship` | exit 0, 0 problems, 1 warning; 211 references, 103 verbs |
| `node --test tests/harness/method-text.test.mjs` | 11/11 passed, including source/region provenance |
| `node kit/release-check.mjs` | exit 0, release check ok |
| `git diff --check` | exit 0; Git emitted LF-to-CRLF notices only |

Full logs: `_workspace/live-fix/{focused,units,npm-test,upstream,provenance,release}.log`; argv/exit summary: `_workspace/live-fix/validation.json`.

The two full-suite skips are FTOL-09 broken symlink and FTOL-27 POSIX executable-mode tests on Windows. Explicit `gsd upstream check --verbose` identifies the warning as the reference absent at the existing upstream pin: `gsd-core/workflows/context-bridge.md` (depth 2). No upstream repair was attempted. Release validation without a revision range checks version/sections; there is no new commit for a commit-range prompt/changelog audit. Main must include CHANGELOG in the eventual commit and run the range check then.

An earlier focused run before adding the wording regression passed 69/69; the final focused run is 70/70. No failed validation run was hidden or repaired by weakening coverage.

## Exact live requalification instructions (separate tester)

1. Preserve `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/` and `_workspace/live-acceptance/adapters/` unchanged. Create fresh external fixture repos, not descendants of the kit, with the same real Node socket-service and compiled executable behavior. Use separate new roots/log directories; do not copy the failed generated adapters as the new result.
2. For each new fixture root `F`, run `node C:/Users/fish/Desktop/paseo-kit/kit.mjs install "F"`. Verify installed `.agents/harness/adapter/check.mjs` and the updated kit-adapter overlay. Run known baseline build/tests, preserving argv, cwd, versions and output. Prepare mappings/config only under the fixture, labeling tester-authored mapping input.
3. Main's separate tester must host a genuine parent at `F` through the public Paseo workspace/agent boundary before using installed new `ph`; confirm actual cwd/parentage. Request `circle/gpt-6-astra[1m]` with medium effort. Invoke the installed harness skill to generate a fresh adapter/stack skill and its mandatory self-check. Do not hand-repair the generated adapter. Preserve the generator request, tool telemetry and output; ensure actual installed skill discovery is evidenced, not inferred from the final answer.
4. From `F` (and `PASEO_HARNESS_ROOT=F`, if set), run:

   ```text
   node .agents/harness/ph.mjs config
   node .agents/harness/ph.mjs harness lint
   node .agents/harness/adapter/check.mjs --kind test --command "test: test/service.test.mjs" --run
   ```

   The last command is the Node LA-01 reproduction when that file selector is supported. Independently assert that the file resolves to both actual test IDs and evidence proves both, OR that completed runner records prove the retained file ID. Confirm count 2, runner exit 0 and expected real test effects. A mere exit 0 from the helper is insufficient without inspecting the actual mapping.
5. For the compiled fixture, run the same config/lint commands and:

   ```text
   node .agents/harness/adapter/check.mjs --kind test --command "test:all" --run
   node .agents/harness/adapter/check.mjs --kind test --command "test:greeting" --run
   ```

   Independently expect both real cases for `all` and exactly the greeting case for the single-target control. The suite may normalize to canonical qualified IDs, or supply genuine runner mapping proof for `all`. If fresh generation changes spelling, also run every documented selector verbatim and record the old spelling's supported/rejected status; do not quietly replace a documented failing alias with a working control.
6. Run the generated project's declared build/test commands verbatim as argv, and its generated self-check. Assert independent expected IDs/counts for all supported single/file/alias forms. Use a fresh isolated control copy for zero execution, one omitted executed member and failed runner, labeling controlled output synthetic. Each must be rejected even if the evidence text claims passed. An unknown selector and a missing resolution must be rejected before the runner starts (assert no runner marker/log). Preserve the positive workspace untouched by negative injection.
7. Save all `check-*/check.json` and raw runner logs, declared command results, the independently asserted target mappings and the generated self-check source/results. Inspect that `executed.targets` is derived from runner records, never copied from requested/discovered IDs. Record skipped/filtered cases and duplicate-name disambiguation if the stack permits them.
8. Repeat installed skill discovery/trigger qualification as required by the live acceptance owner using fresh agents; do not treat earlier trigger success or these offline tests as generation acceptance. Do not mark a full GSD gate run as tested unless one actually ran. Main decides closure only after independent live evidence passes for both newly generated adapters.

## Remaining limitations

- No fresh live generation, fixture requalification, trigger measurement or complete GSD lifecycle was run by this fixer. HARN-04 / CR-HAR-09 are not closed here.
- The checker is an explicitly authorized project-code executor, not a sandbox. It retains runner logs and protocol responses, not a cryptographic attestation of truthful project hooks or full GSD evidence/input snapshots.
- Parser/resolver failures, unknown selectors and runner evidence are checked only for the supplied obligations. Discovering every advertised selector and verifying the semantics of its expansion still require the generated independent self-check and tester audit.
- Stack-specific execution/discovery/mapping remains entirely in generated project adapters or test fixtures; none was added to the vanilla shipped helper.
