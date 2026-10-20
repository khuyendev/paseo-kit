# Live acceptance summary — 2026-10-20

## Verdict: NOT fully accepted

The owner authorized live testing and committing the existing fixes, not further product changes. The committed code passes offline regression and bounded live runtime/mod/UI smokes, but the generated adapters fail two requested-target evidence checks. **HARN-04 / CR-HAR-09 remains open.** There is also a live worker-provider readiness mismatch. Neither the generated output nor the owner's configuration was repaired to turn these results green.

| Area | Named checks pass | Fail | Blocked | Scope |
| --- | ---: | ---: | ---: | --- |
| Adapters | 12 | 2 | 0 | Two actual generated adapters, real Node socket tests and compiled C# executable tests, lint, protocol execution, 40 fresh-agent trigger requests |
| Runtime | 9 | 1 | 0 | Installed public ph on real Paseo, cwd/nonce, send, schema workflow, resume/cache, expected schema failure, installed io hooks; fail is current machine readiness |
| File mod | 12 | 0 | 0 | Actual Claude Code, installer activation, fresh-session registration, batch read/tagged edit/write, native and mod permission-denial controls |
| UI | 23 | 0 | 0 | Actual isolated Paseo daemon and bundled web client, RPCs, Planning navigation, populated Astra parent/child swarm and inspector |

Counts are bounded named smoke checks, not coverage of every requirement. Detailed scope, exact commands, versions, cleanup and unrun scenarios: [adapters](live-adapters.md), [runtime](live-runtime.md), [mod](live-mod.md), [UI](live-ui.md).

## Unresolved observations

### LA-01 Generated Node adapter: file target becomes test-name evidence

- Fixture: `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/adapters/node-http`.
- Requested/resolved target: `test/service.test.mjs`.
- The actual runner executes two passing tests; the generated evidence parser reports `executed.targets: ["health", "missing"]`, omitting the requested file target.
- Independent protocol acceptance fails. Lint/build/test passing is not sufficient to certify that obligation. ADPT-17 requires requested-target coverage; a full GSD gate was not run, so no live full-gate failure is claimed.
- Evidence: `_workspace/live-acceptance/adapters/verification-node-http/checks.json`, parser/resolver/runner/evidence logs alongside it.

### LA-02 Generated compiled CLI adapter: suite alias not represented in evidence

- Fixture: `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/adapters/compiled-cli`.
- Generated skill documents `test:all`; resolver accepts target `all`.
- Actual executable-driving tests pass, but generated evidence lists only `greeting` and `usage`, not requested target `all`.
- Independent acceptance fails. Control `test:greeting` succeeds with exactly one executed target. The executable is compiled by stock Windows .NET Framework C# compiler, not transpiled JavaScript.
- Evidence: `_workspace/live-acceptance/adapters/verification-compiled-cli-all/checks.json`; successful control under `verification-compiled-cli/`.

LA-01/02 are generated-output defects, not yet proof of a core runtime bug. Their failing artifacts are preserved byte-identically; no acceptance-driven repair or regeneration was performed. Original generation used old-ph fallback with installed skill text after a tester placement mistake; actual installed Skill discovery was subsequently confirmed through legitimate fixture-hosted parents in read-only mode. End-to-end generation through a correctly placed new-ph parent is not claimed.

### LA-03 Live machine policy readiness

- Installed `ph doctor` exits 2: current `circle-agent` does not disallow `SendMessage`.
- Intended policy: main `circle` allows SendMessage and denies Agent/Workflow; worker `circle-agent` denies SendMessage.
- No machine apply, provider edit, daemon reload/restart or persistent permission change was performed against the owner's home. This is a readiness mismatch, not an established runtime implementation defect.

## Positive evidence independently checked by main

- Runtime child nonce has exact expected bytes; actual positive/resume run statuses are done; impossible-schema run is failed with no result.json; shell marker has exactly two lines. Resume used the cached agent while rerunning shell.
- Both generated stack skill trigger records have 20 requests (10 positive, 10 negative), no false positives or false negatives: precision and recall 1.0. Telemetry is actual collected Skill invocation metadata, corroborated by bounded own-agent timelines.
- Correct `Edit(path)` permission rules deny both native Write and mod batch write in separate fresh Claude sessions; both original sentinel hashes/bytes remain unchanged. An earlier tester case incorrectly used unsupported `Write(path)` syntax; it is preserved but excluded as an invalid test, not a product defect.
- A fresh session without `--plugin-dir` loads `harness-files@paseo-harness-kit` after public installer activation in isolated CLAUDE_CONFIG_DIR, then executes read_ranges.
- Main viewed Planning, plan detail, file reader and populated swarm inspector screenshots from the actual browser client. UI planning progress links used a labeled test-authored run fixture, not a claim of real GSD phase execution.

## Isolation, cleanup and commits

- Product root: `C:/Users/fish/Desktop/paseo-kit`, branch `release/vanilla-live-acceptance`.
- Existing review fixes committed as `3577d71`; release check on `773a001..3577d71` passed.
- Production files under ship/, kit/, plugins/, user/ remained unchanged during live acceptance (main git diff check against HEAD exited 0).
- External fixtures under `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/`; local scripts/raw logs/screenshots under `_workspace/live-acceptance/`. No credentials or endpoint literals copied into committed evidence. Existing endpoint/auth were inherited only in test process memory.
- No real project was changed. User machine config, live daemon and plugin/tool/skill selections were untouched. Tests used isolated homes/configs where configuration was needed.
- Own agents/workspaces archived; isolated UI daemon stopped and browser closed; test fixtures/raw evidence preserved. All four top-level test supervisors archived.
- Original installer-descendant and old-ph cwd failures were tester topology mistakes; actual external fixtures and properly hosted parents resolved them without disabling safeguards.

## Remaining qualification

A green offline suite is not full live acceptance. HARN-04 is not closed until generated adapter requested-target/evidence semantics pass. Other exhaustive requirements (full GSD lifecycle, all permission modes, all hooks/thresholds, scale/reconnect, POSIX, minimum Node floor) were outside this bounded smoke and are listed as unverified in area reports, not silently marked passed.

Next work, if authorized: correct the project-adapter generation/validation contract in the adapter layer (preserve Harness/GSD method text), regenerate on properly hosted fixtures and requalify; separately reconcile worker SendMessage policy only with permission to change the live machine.
