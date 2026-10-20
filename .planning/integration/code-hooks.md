# code-hooks report (M8 hooks, HOOK)

## Files written

- `ship/.claude/hooks/lib/hook_common.mjs`: shared hook plumbing. HOOK-04 root rule (`hookRoot`), config loading by absolute file URL of `<root>/.agents/harness/config.mjs` (`configLoader`, `loadHookConfig`, `harnessModule`), the never-block wrapper `runHook` (HOOK-05), transcript tail reader, tool-result text, and the parser for mod reply lines (`edited <abs>: N edit(s)`, `wrote <abs> (N chars)`).
- `ship/.claude/hooks/context_guard.mjs`: HOOK-06..12. The band decision is one exclusive create of `claim-e<epoch>-b<band>` in `<tmp>/ph-context-guard-<sha256(session)[:24]>/`. Any downward move lowers the stored band and opens a new epoch. State older than 24 h is pruned. There is no PID or mtime recovery.
- `ship/.claude/hooks/io_guard.mjs`: HOOK-13..23 and HOOK-25. One `TOOLS` table holds the tools and their path fields. Edited files also come from mod reply lines, which covers fix-only calls. Claims live in `<tmp>/ph-io-guard-<sha256(session)[:24]>/`.
- `ship/.claude/hooks/syntax_check.mjs`: HOOK-26..28. Checkers come from `adapter.syntax_checkers` of the tree that holds the file. The hook has a 75 s budget and starts a checker only with at least 10 s left. Each checker has a machine-wide slot cap (`max_parallel`, default 3). Results are cached by tree, path, checker identity and content hash. Pre state lives in `<tmp>/ph-syntax-check/`. Checkers run through `lib/proc.mjs` `runArgv`, loaded from the root by file URL.
- `ship/.claude/hooks/bash_long_command.mjs`: HOOK-30.
- Tests in `tests/hooks/`: `helpers.mjs`, `fixtures/fake_checker.mjs`, `registration-lint.mjs` (HOOK-29 lint and HOOK-02 consistency), `bench_context_guard.mjs` (HOOK-12 benchmark), and `context_guard`, `io_guard`, `syntax_check`, `bash_long_command`, `failures`, `registration` and `agents_rules` `.test.mjs`.

## Requirements

- Implemented and tested: HOOK-01..23 and HOOK-25..31 (30 of 31 v1).
  - HOOK-01 and HOOK-29 check code-install's `ship/templates/settings.hooks.json`, which already matches.
  - HOOK-03 runs the real `kit.mjs install` and `update` in a temp project.
- Partly done, waiting on another coder: HOOK-24.
  - The reminder-to-rule mapping is tested and passes.
  - The install check of the five rules is marked `todo`, because `ship/blocks/AGENTS.md` lacks rule 1 ("Grep for content and Glob for names"). A request is filed with code-install.
- Not v1: HOOK-32 (later).
- Manual checks still open:
  - HOOK-07, HOOK-14, HOOK-19: re-verify the transcript and response shapes on the installed Claude Code.
  - HOOK-12: record p95 on the owner's machine. Locally `node tests/hooks/bench_context_guard.mjs 10` gave p50 46 ms, p95 62 ms.
  - HOOK-30: run a real 9,000-char heredoc on Windows.

## Requests filed (requests.md)

- code-install, `ship/blocks/AGENTS.md`: add rule 1 of HOOK-24 as its own statement.
- code-install, `ship/.claude/hooks/lib/hook_common.mjs`: this is a kit unit but not a registered hook, so template-versus-hooks checks must compare top-level `.claude/hooks/*.mjs` only. kit.json already lists it.
- code-ph: `compact-self` must accept `--focus`, which the HOOK-10 reminder text uses.

## Running the tests

`node --test "tests/hooks/*.test.mjs"` gives 53 tests: 52 pass, 0 fail, and 1 `todo` (the HOOK-24 install check above). The tests run offline. Hook processes get a temp `TEMP`/`TMP`/`TMPDIR`, a temp home and a temp `CLAUDE_CONFIG_DIR`, and in-process tests inject their own state directories.

## Known gaps

- The syntax shell takes the config loader from the HOOK-04 root and calls `loadConfig(tree)` for each owning tree. A worktree therefore uses its own overlay but the session's kit defaults.
- A broken overlay in one tree gives one `syntax check unavailable:` line, and the hook still checks targets in other trees.
- If the Pre status was `skip` or an infrastructure error, a file that fails in Post is reported with the `(not checked before this edit)` marker.
- The syntax hook budget starts at process start (`process.uptime`). Tests inject `limits` and `startedAt`.
