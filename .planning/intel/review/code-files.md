# Code review: files (FIL)

## Verdict

REVISE — 3 BLOCKER, 3 MAJOR, 0 MINOR. The permission-ticket architecture and normal read/edit flows are covered well, but mutation bookkeeping still permits lost edits, repeated replacements, and deletion of another writer's files during rollback. Recovery also has an unbounded retry path, consumes fix IDs on an atomic abort, and can silently skip a diagnostics page after transport loss. `node --test --test-reporter=spec "tests/files/*.test.mjs"` passed: 83 tests, 81 passed, 0 failed, 2 POSIX-only tests skipped on Windows. The additional reproductions below used memory-only filesystem doubles or read-only, dry-run calls; no project/config files were changed. Real Claude/Paseo checks were not run, as instructed; the already-reported FTOL-01/04/10 manual checks remain outstanding.

## Findings

### CR-FIL-01 BLOCKER correctness Rollback recursively deletes files belonging to another writer

- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/files/commit.mjs:34-38`, `:45-46`, `:59-62`, `:82-85` (FTOL-27; INV-31).
- Evidence: `mkdirSync(..., {recursive:true})` records the first directory it created. On staging failure or successful content rollback, `cleanDirs()` removes that directory recursively. Creation of a directory does not establish ownership of everything another process subsequently puts into it. For a batch writing `new/tool.txt` and an existing `block.txt`, let another agent create `new/owner.txt` before the second rename fails. Rollback removes `tool.txt`, then recursively removes `new`, including `owner.txt`, and nevertheless returns `nothing written: ... 1 file(s) already replaced were restored`. A fault-injected memory-only reproduction confirmed both the success-of-rollback text and disappearance of the unrelated sibling. `tests/files/write.test.mjs:100-104` tests only an otherwise empty new folder, so it does not catch this data loss.
- Fix: Track the individual directories created during staging and attempt to remove them deepest-first with an empty-directory-only operation (`rmdirSync`), never recursive removal. Leave a directory in place when it contains anything not removed as one of this transaction's own temps/targets. Add a rollback test that creates an unrelated sibling before an injected staging/rename failure and asserts that sibling survives.

### CR-FIL-02 BLOCKER correctness Two paths through a junction lose the first successful edit

- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/files/edit.mjs:189-204`, `:284-288`, `:324-332`; `ship/.agents/harness/files/plan.mjs:14-18` (FTOL-26, FTOL-33; INV-31, INV-52).
- Evidence: Permission planning discovers canonical paths, but edit state and write duplicate detection use only the lexical absolute path. If `alias` is a Windows junction to `real`, a batch editing `real/f.txt` and `alias/f.txt` loads two independent copies of the same original file. With original `alpha\nbeta\n`, replacing `alpha` with `ALPHA` through the first path and `beta` with `BETA` through the second produces two `edited ...: 1 edit(s)` success lines, but the final file is `alpha\nBETA\n`: the second staged replacement overwrites the first edit. A memory-only filesystem double with junction-equivalent resolution reproduced this result. The existing two-entry test at `tests/files/edit.test.mjs:128-145` uses the same spelling; the junction test at `tests/files/transport.test.mjs:72-84` only checks repointing between plan and execute.
- Fix: Use the canonical physical target, case-folded on Windows, as the per-file identity. Ordered edit entries for the same physical file must continue from one shared state and produce one staged replacement. Reject repeated physical targets in `write_multiple_files`, even when their lexical paths differ. Preserve permission checks for both lexical and canonical paths, including the parent actually used for staging/commit. Add a Windows-junction regression asserting that both edits survive and that aliased duplicate writes are refused.

### CR-FIL-03 BLOCKER correctness A retained occurrence fix can execute twice in the same batch

- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/files/edit.mjs:155-159`, `:210-240`, `:282`, `:291-308` (FTOL-31, FTOL-32; INV-31).
- Evidence: Applied fix IDs are only added to `run.used`; `retryFix()` continues to retrieve them from the store until the entire batch commits. Its occurrence branch also bypasses already-covered detection. Starting with `dup\ndup`, fail the ambiguous replacement `dup` -> `dup!`, then send `fixes:[{id,occurrence:1},{id,occurrence:1}]`. Both executions still see two occurrences of `dup`, so the second applies again at the first occurrence. The result is `dup!!\ndup`, reported as two successful edits. A memory-only reproduction confirmed this. The single-use test at `tests/files/edit.test.mjs:83-91` checks reuse only in a later call, not within one batch.
- Fix: Reserve each fix ID within the current transaction as soon as it applies, is skipped, or is queued as a file-level fix. A repeated ID in that batch must be skipped or diagnosed without applying again. Keep durable consumption deferred until a successful committing call so dry runs and atomic aborts preserve the ID. Add the repeated occurrence-fix example and assert that the replacement appears exactly once.

### CR-FIL-04 MAJOR correctness Retrying a malformed edit by ID hangs the backend

- Severity: MAJOR.
- Category: correctness.
- Where: `ship/.agents/harness/files/tools.mjs:28`, `:60-74`; `ship/.agents/harness/files/edit.mjs:17-20`, `:165`, `:240`, `:270` (FTOL-02, FTOL-30, FTOL-31).
- Evidence: Validation accepts an edit with only `newText`, because it requires neither `oldText` nor a line-edit selector. `editEntry()` converts that into a retained text failure with `oldText: ""`. If the caller then sends `{fixes:[{id}]}`, the fallback calls `attempt()` and `count(text, "")`. The count loop advances by `needle.length`, which is zero, so it never terminates. A read-only reproduction against README.md first issued the malformed edit with `dryRun:true`, then retried its ID with `dryRun:true`; the child printed that the empty oldText had been retained and was still stuck when the 1.5-second test timeout terminated it (`ETIMEDOUT`). In the normal ticket path this holds the session lock until Bash is interrupted/times out, instead of returning a bounded diagnostic. The malformed-input tests at `tests/files/transport.test.mjs:26-44` cover explicit empty oldText but omit the absent-selector case.
- Fix: Validate that every edit supplies exactly one valid selector form (nonempty oldText, from/to, or after), with a field-path error before staging. Independently make the matching/retry routines reject empty oldText, including failures already persisted by an earlier version, so an old retained ID can never enter a zero-progress loop. Test both malformed initial input and replay of a retained empty-oldText failure.

### CR-FIL-05 MAJOR invariant Atomic failure consumes skipped fix IDs

- Severity: MAJOR.
- Category: invariant.
- Where: `ship/.agents/harness/files/edit.mjs:291-299`; `ship/.agents/harness/files/lines.mjs:18-20` (FTOL-31; INV-31).
- Evidence: In the failure branch, `if (!plan.length && !dryRun) consume()` also runs when `atomic:true`. A fix skipped as already present is added to `run.used`; a sibling failure then makes the call an atomic abort, but the skipped ID is deleted anyway. For example, retain a suggestion replacing `hello  world` with `hello world!`; let another edit put `hello world!` in the file; then submit an atomic batch containing that ID and an unknown ID. The first fix is skipped as covered, the second fails, no mutation plan exists, and the first ID disappears despite the promise that IDs survive aborted calls. A memory-only reproduction of the equivalent already-written skip returned `nothing written: 1 edit(s) failed` with `hasFix(id) === false`. Current atomic/dry-run tests do not assert preservation in the skip-only-plus-failure branch.
- Fix: Do not consume any IDs when an atomic call has failures, regardless of whether its mutation plan is empty. Keep skip-only consumption for successful committing calls (and, if intended, non-atomic partial outcomes), and preserve all IDs on dry runs. Add an atomic skipped-fix-plus-failing-fix test that asserts both unchanged target bytes and retention of the original ID.

### CR-FIL-06 MAJOR correctness A lost continuation response silently discards a diagnostics page

- Severity: MAJOR.
- Category: correctness.
- Where: `ship/.agents/harness/files/backend.mjs:30-39`, `:64-75`; `ship/.claude/plugins/harness-files/hooks/register.ts:104`, `:117` (FTOL-13; INV-28).
- Evidence: Fetching a continuation advances the shared page token's stored offset (or deletes it on the last page) during `stage`, before the mod receives the generated result ticket. If that stage reply is lost, truncated, or interrupted, the mod has no ticket to recover and returns a transport denial. Retrying the continuation token now returns the following page, silently skipping the undelivered one. In a memory-only transport reproduction with pages A (40,000 chars), B (40,000), and C (10,000), discarding the first continuation-stage reply and retrying the same token returned C, not B. The B result existed only under the lost random ticket. This loses diagnostics and fix IDs precisely on the error path pagination is meant to protect. `tests/files/transport.test.mjs:119-151` tests lossless assembly only when every stage reply is delivered.
- Fix: Make continuation tokens identify immutable page positions. Repeating a token must return the same page and the same next-page token until retention expiry; reading must not advance or delete the current token. Alternatively, persist an idempotent token-to-result-ticket mapping that can be recovered using the original continuation token. Add dropped-stage-response and dropped-final-page-response tests, then retry the same token and verify byte-identical page recovery without target execution.
