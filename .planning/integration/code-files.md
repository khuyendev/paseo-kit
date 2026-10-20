# code-files integration report (M7 files, FTOL)

## Files written

Backend (`ship/.agents/harness/files/`, trusted set of FTOL-05):
- `backend.mjs`: CLI entry and transport (`describe`, `stage`, `collect`, `abandon` on stdin, protocol 1, 16 MiB cap), ticket runner (`--plan|--execute <session> <ticket>`, `.started` marker, receipts), pagination (`PAGE_CHARS` 40,000, `pageResult`), `TRUSTED_FIXED`, `SENTINEL`.
- `tools.mjs`: the three tool definitions (descriptions, flat schemas, `continuation`/`receipt`), `validateArgs` (field-path messages).
- `plan.mjs`: permission plan (`planRequest`: abs + canonical targets, unique read guess, retained fixes, parent-folder and missing-ancestor `Write {content:''}` checks) and `executeRequest` (plan recomputed and compared, per-target guard, `read_limits` per request through `discoverConfigRoot` + `loadConfig`).
- `private.mjs`: private state root `<tmpdir>/paseo-harness-files-<uid>/<sha256(session)>/` (0700, symlink/owner refusal), session lock with stale recovery, ticket sweep and budgets, stale-session removal.
- `store.mjs`: fix IDs (500 / 8 MiB, single use), read tags (64 reads / 30,000 lines, FNV-1a per line), committed-edit signatures (2,000).
- `reader.mjs`: `read_ranges` (bounded-memory two-pass reader, caps, binary refusal, folder listing, guess read in place).
- `edit.mjs`: `edit_multiple_files` (exact-once oldText, CRLF, mixed-ending/binary refusal, diagnosis and suggestions, fixes, resent-edit skips, atomic, dryRun, result states) and `write_multiple_files`.
- `lines.mjs`: line edits against read tags (in place, moved, occurrences, suggestion, shown lines with a fresh tag, overlaps, bottom-up), line fixes.
- `commit.mjs`: staging, rename with retry, rollback with INV-54 mtime bump, `ROLLBACK INCOMPLETE`, mode bits kept, created folders removed.
- `guess.mjs`, `targets.mjs`: missing-path guesses; path resolution (cwd, `/c/...`, `~`, canonical realpath, case folding on Windows only).

Mod (`ship/.claude/plugins/`):
- `.claude-plugin/marketplace.json` (marketplace `paseo-harness-kit`, plugin `harness-files`, source `./harness-files`; matches `FILE_PLUGIN_ID`).
- `harness-files/.claude-plugin/plugin.json`, `harness-files/hooks/hooks.json` (`{"modules":["./register.ts"]}`).
- `harness-files/hooks/register.ts`: engine-API-only mod (no Node import, no fs); registers the three tools at `session.start` with `isDeferred:false`, serves them with `tool.check` before staging and after the plan, native `Bash` tickets (120 s), fail-closed transport, at most one native execute, recovered / unknown / not-executed outcomes, native-subagent refusal, 44,000-char result ceiling.
- `harness-files/scripts/discover.mjs`: self-contained backend discovery (node: imports only) run by the mod through `$.process.run` on every call; manifest digest check of the trusted set, stamp cache (size + mtime) that skips digests only while nothing changed. Kept outside `register.ts` because the sandbox module has no fs and the backend may not verify itself.

Tests (`tests/files/`): `helpers.mjs` (in-process ticket driver), `fake-engine.mjs` (fake Claude Code engine wired to the real backend), `read.test.mjs`, `edit.test.mjs`, `lines.test.mjs`, `write.test.mjs`, `transport.test.mjs`, `discover.test.mjs`, `mod.test.mjs`.

## Requirements

v1 FTOL-01..FTOL-40 (40): all have offline tests named by ID.
- FTOL-38 (read-only role classification) is implemented by code-ph in `runtime/agents.mjs` (`isReadOnlyTools` over `READ_ONLY_DENIED_TOOLS`); `tests/files/mod.test.mjs` tests it against the FTOL-38 acceptance. No second classifier was written.
- Manual parts not run (need a real Claude Code session, which the rules forbid): FTOL-01 (fresh session lists the three schemas without ToolSearch), FTOL-04 (minimum-version session after `kit install --enable-plugin`), FTOL-10 (owner-approved scratch `circle` main session and a `ph spawn` worker). Their offline parts are tested.
- LATER items FTOL-41..43 not implemented.

## Requests filed (`.planning/integration/requests.md`)
- code-files -> code-install: `harness-files/scripts/discover.mjs` is a fourth mod asset: a shipped unit and part of the mod-assets gate.
- code-files -> code-foundation: `filePluginState(...).copied` should also require `scripts/discover.mjs`.
- (code-foundation -> code-files, CONF-09: done in `plan.mjs` via the relative `../config.mjs` import, which is inside the backend's own trusted tree and verified by discovery.)

## How to run
`node --test "tests/files/*.test.mjs"` (83 tests: 81 pass, 2 skipped on Windows: the POSIX broken-symlink plan test and the POSIX executable-mode test; on POSIX the Windows-only read-only-target test skips instead). The FTOL-07 quoting test needs `bash` on PATH (Git Bash on Windows) and skips without it. No test touches `~/.claude*`, `~/.paseo` or the daemon; state roots are temp dirs.

## Known gaps
- `register.ts` is not type-checked (no `tsc` on this machine) and not run through `claude plugin validate`/`claude plugin test`; Node's type stripping loads it in the fake-engine tests, so its syntax is erasable TS and its logic is covered. Run `claude plugin validate ship/.claude/plugins/harness-files` once before release.
- The engine API shapes (`$.tool.call({tool:'Bash', command, description, timeout})` result fields `text`/`deny`/`isError`/`result.stdout`; `on(...).catch`) follow the old kit's working mod and the 2.1.296 type file; re-verify with the manual FTOL-01/04 check.
- The FTOL-15 "live-pid lock fails after about 20 s" is tested with a 300 ms wait option (the 20 s constant is asserted separately) to keep the suite fast.
- FTOL-27's "read-only second file (Windows)" test returns early when Windows replaces a read-only target by rename (nothing to roll back then); the rollback path itself is covered by injected faults.
- With `PASEO_HARNESS_ROOT` set but holding no backend, discovery continues with the cwd ancestors (the requirement lists the roots as "then"); the old kit used the env root alone.
