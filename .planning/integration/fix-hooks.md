# fix-hooks: review code-hooks.md (area HOK)

| Finding | Result | What changed |
|---|---|---|
| CR-HOK-01 | fixed | `context_guard.mjs`: the claim file + mutable `state.json` became one chain of immutable records `<seq>.json` ({band}). Every band change, up or down, is one exclusive publish of `seq+1` (`publishExclusive`: temp write + hard link, so records are whole and only one writer wins a seq). The winner of an upward change reminds; a loser re-reads the record that beat it and retries. A crash after the publish loses only that reminder; the next downward record re-arms. No PID/mtime recovery. Records are not pruned inside the chain (a freed seq could be won twice); the session dir still goes after 24 h. Tests: `HOOK-09 a crash after the decision ...`, `HOOK-09 a reset racing a climb ...` (the stale-read seam is `claimBand(dir, band, head)`). |
| CR-HOK-02 | fixed | `syntax_check.mjs`: targets are resolved with the file tools' own exported rule `absolutePath` from the installed `.agents/harness/files/targets.mjs` (FTOL-18: `~`, Git Bash `/c/...`, cwd), loaded by `harnessModule` like `config.mjs`. Nothing private to the backend is read. Raw path collection (`targetPaths`) still runs first, so a call with no paths loads nothing. Test: `HOOK-26 a Git Bash path and its native spelling name the same target in Pre and Post` (Windows only): a pre-existing failure stays silent, a new failure is reported without the marker, and only the intended files are checked. |
| CR-HOK-03 | fixed | `syntax_check.mjs`: each slot lock is published whole and holds a unique acquisition token. A lock is removed only by the winner of `<lock>.reclaim-<token>` (wx). That is the owner on release, or anyone when the lock is stale, with the token and the staleness re-checked while the guard is held. Tokens never recur, so a reclaim based on an old look, or a late release, never frees the successor's slot. Tests: `HOOK-27 reclaiming an abandoned slot cannot free the slot its new owner took`, `HOOK-27 releasing an old acquisition cannot free its successor's slot`. |

Shared helper added: `publishExclusive(file, text)` in `ship/.claude/hooks/lib/hook_common.mjs`.

## Tests
- `node --test "tests/hooks/*.test.mjs"`: 58/58 pass.
- `npm test`: 774 tests, 771 pass, 0 fail; 2 skipped, 1 todo (INST-04, CR-INS-05, another area).

## Requests filed
None.

## Known gaps
- If a process is killed between creating a reclaim guard and removing the lock (a few synchronous fs calls), that slot stays held. Capacity drops by one, but the cap is never exceeded.
- The context-guard tests force the reset-versus-climb and crash interleavings in-process through the `head` seam. The real six-process test covers concurrent climbs.
- Hard links need a filesystem that supports them in the temp dir (NTFS and POSIX filesystems do).
