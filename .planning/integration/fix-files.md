# fix-files: review of area FIL applied

Review: `.planning/intel/review/code-files.md`. Every finding was checked against the code and reproduced with a test before the fix. With the six source files reverted, the new tests fail, and the CR-FIL-04 replay hangs the edit test file. With the fixes, they pass.

| Finding | Outcome | What changed |
|---|---|---|
| CR-FIL-01 | fixed | `commit.mjs`: each folder the call creates is recorded before `mkdirSync`. Rollback removes them deepest first with `rmdirSync`, never recursively, so a folder another writer filled in the meantime stays with its files. `mkdirSync` returns a `\\?\` long-path form on Windows, so its return value is not used. Test: `FTOL-27 a rollback leaves a folder another writer filled meanwhile...` covers a rename failure and a staging failure. |
| CR-FIL-02 | fixed | `targets.mjs`: new `fileKey(abs)`, the case-folded canonical path. `edit.mjs` keys per-file edit state by `fileKey`, so a second spelling continues from the same state and gives one staged replacement. The guard runs for every spelling. `writeMultiple` refuses aliased duplicates as "listed twice". `lines.mjs` accepts a read tag of another spelling of the same physical file. Permission checks are unchanged (plan.mjs already checks lexical and canonical paths). Tests: `FTOL-33 two spellings of one file through a junction...`, `FTOL-26 one file under two spellings through a junction...`. |
| CR-FIL-03 | fixed | `edit.mjs`: each call has a `reserved` set. A fix ID listed again in the same call is reported as skipped and does not apply again. Durable consumption still happens only on a committing call. Test: `FTOL-31 a fix ID listed twice in one call applies once`. |
| CR-FIL-04 | fixed | `tools.mjs`: `validateArgs` refuses an edit with no oldText, from, to or after, with a field-path message, before any state is written. `edit.mjs`: `attempt()` fails an empty oldText with a diagnosis, and the occurrence retry needs a nonempty oldText, so an empty oldText already retained can no longer loop. Tests: `FTOL-02 an edit with newText alone is refused...`, `FTOL-31 a retained empty oldText retried by ID fails with a diagnosis...`. |
| CR-FIL-05 | fixed | `edit.mjs`: when an atomic call fails, no IDs are consumed, even when no files were going to change. Non-atomic calls where every applicable fix was skipped still consume IDs, as before. Test: `FTOL-31 an atomic abort keeps a fix ID skipped as already applied` (checks the file bytes are unchanged and the ID is still kept). |
| CR-FIL-06 | fixed | `backend.mjs`: a page file holds only the text still to come and is never advanced or deleted when read. Retention and the budget sweep remove it. The next token is a sha256 derived from the current token, so repeating a token returns the same page and the same next token. No mod change was needed. Test: `FTOL-13 a continuation whose reply was lost gives the same page and next token again` (drops a stage reply and a collected reply, including on the last page). |

Fixed 6, rejected 0.

## Tests

- `node --test tests/files/*.test.mjs`: 91 tests, 89 pass, 0 fail, 2 skipped (POSIX-only).
- `npm test`: 786 tests, 782 pass, 2 skipped, 1 failed: `PHCL-04 GSDC-47 doctor ...`. That test is in tests/ph, which another fixer was editing during the run. Rerunning `node --test tests/ph/*.test.mjs` gave 75 tests and 0 failures, so my change did not cause it.

## Requests filed

None.

## Files written

`ship/.agents/harness/files/{backend,commit,edit,lines,targets,tools}.mjs`, `tests/files/{write,edit,transport}.test.mjs`.
