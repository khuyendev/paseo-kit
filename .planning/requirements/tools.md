# Requirements: tools (M7 files, M8 hooks, M13 ui)

**Defined:** 2026-10-20
**Scope:** modules M7 files (prefix FTOL), M8 hooks (HOOK) and M13 ui (PANL) of `.planning/intel/SYNTHESIS.md`; decisions D-01..D-111 applied. Vanilla (D-110): nothing here is specific to a project, engine or game; where a mechanism needs project data, the project adapter supplies it (ADPT requirements own that contract).
**Test kinds:** `offline` = kit test under `tests/` with fakes (Claude Code mod engine stub, Paseo SDK fake, fake CLIs), temp homes and temp dirs with spaces, never the owner's live config or daemon (INV-57). `manual` = named manual check on a real Claude Code / Paseo install, result recorded in the phase verification; probe agents use `circle/gpt-6-luna-fast[1m]` (INV-50).
**Texts:** quoted model-facing texts fix the meaning and the key words tests match; their wording changes only with owner review (INV-49, D-35).

## v1 Requirements

## M7 files: harness-files mod and backend (FTOL)

### FTOL-01 Exactly three file tools, loaded upfront
- Requirement: The harness-files mod registers exactly `mcp__harness-files__read_ranges`, `mcp__harness-files__edit_multiple_files` and `mcp__harness-files__write_multiple_files` at `session.start`, each with `isDeferred: false`; `session.start` throws `Unexpected file tool registry` when the backend's `describe` list has a missing, extra or unknown name. No filesystem-compat, directory, media or single-file tool exists.
- Acceptance: offline (stub engine): `tool.register` is called three times with these names and `isDeferred:false`; a stub backend describing a fourth name makes `session.start` throw; manual: a fresh Claude Code session lists the three full schemas without a ToolSearch round.
- Source: FIL-02, FIL-47, FIL-40, FIL-42, HIS-08, D-39, S-04.
- Scope: v1

### FTOL-02 Flat schemas, backend validation with field paths
- Requirement: Every tool input schema is `type: object` with no root `anyOf/oneOf/allOf` and no `_meta`, plus optional strings `continuation` and `receipt`; the backend validates arguments before writing any state and fails with field-path messages (`<tool>.<path> is required`, `must be a nonempty array`, `must be a valid integer`, `has an invalid <type> value`, `must be one of ...`); `continuation` or `receipt` with any other key fails `supply only continuation OR receipt, not base arguments or both`; both values must be 64 lowercase hex. Malformed input is answered, never crashes the backend.
- Acceptance: offline: for each tool the schema rules hold; an empty `oldText`, a missing `files`, a non-integer `from`, a non-hex continuation and `{continuation, path}` each fail with the named message and leave the private session directory unchanged.
- Source: FIL-03, FIL-50, FIL-44 (lesson), P4.
- Scope: v1

### FTOL-03 Short descriptions naming only shipped tools
- Requirement: Each tool description is its source description (FIL-22, FIL-27, FIL-29) with references to unshipped tools removed as an adapter change (the write description drops the source's last sentence `Use instead of one write_file call per file.`), plus one shared suffix sentence about continuation/receipt; no description, error, hint or note of the mod or backend names a tool the kit does not ship (`read_media_file`, `read_file`, `read_text_file`, `read_multiple_files`, `write_file`, `edit_file`, `fsbatch`, the `filesystem` MCP server).
- Acceptance: offline: the write description equals `Create or overwrite several files in one call (all-or-nothing: if any path is invalid, nothing is written). Parent directories are created.` plus the suffix; a scan of the `describe` output and of every message template in the backend and mod sources finds none of the listed names.
- Source: HIS-09, FIL-03, FIL-24, FIL-43, P10, INV-49.
- Scope: v1

### FTOL-04 Mod packaging and Claude Code minimum
- Requirement: The kit ships `.claude/plugins/.claude-plugin/marketplace.json` (one plugin `harness-files`, source `./harness-files`), `harness-files/.claude-plugin/plugin.json` and `harness-files/hooks/hooks.json` = `{"modules":["./register.ts"]}`; `register.ts` uses only the Claude Code engine API (`session.start`, per-tool `tool.call`, `session.cwd/id`, `env.get`, `plugin.root`, `process.run`, `tool.register`, `tool.check`, `tool.call`), performs no target-file I/O itself, and the kit records the minimum Claude Code version (2.1.296 unless re-verification raises it) that `kit install --enable-plugin` gates on.
- Acceptance: offline: the three JSON files parse and reference each other consistently; a grep gate finds no `node:` import and no fs call in `register.ts`; manual: on the minimum Claude Code version, after `kit install --enable-plugin`, a new session lists and calls all three tools.
- Source: FIL-01, FIL-04, D-02, D-39, R-02.
- Scope: v1

### FTOL-05 Backend discovery checked against the install manifest
- Requirement: The mod finds the project backend by trying `$PASEO_HARNESS_ROOT`, then the session cwd and each parent, then `<plugin root>/../../..`; a root counts when `.agents/harness/files/backend.mjs` exists. When `.agents/harness-kit.json` exists it must parse with `version` and a `files` map (else `harness install marker unreadable`), and every file of the trusted set (the backend entry `.agents/harness/files/backend.mjs`, every other `.agents/harness/files/*.mjs` except tests, `.agents/harness/config.mjs` and the modules it imports, `.agents/harness.defaults.json`; the set is a constant exported by the backend and a kit test checks it equals the static imports) must be listed (else `harness backend file not in installed marker: <rel>`) and match its recorded digest (the kit's shared CRLF->LF sha256 helper; else `harness backend differs from installed marker: <rel>`); a root with a manifest never falls back to source-project trust; without a manifest the root is trusted only as the plugin's own source project, else `harness backend lacks trusted install marker`; with no backend: `harness-files backend not found: install project assets or set PASEO_HARNESS_ROOT`. The result is cached per plugin root, root and cwd and reused only while size and mtime of every trusted-set file are unchanged (checked on each call; any change reruns discovery and the digest checks); discovery times out after 30 s and fails closed on non-zero exit, truncated or empty output.
- Acceptance: offline: editing one backend file after install yields `differs from installed marker`; an empty `files` map, a manifest omitting `backend.mjs`, one omitting `config.mjs`, an untracked new `.agents/harness/files/extra.mjs`, and a modification after a successful discovery each fail before any target execution; a call from cwd `deep/child` finds the project backend; a project without backend yields the not-found text.
- Source: FIL-05, INV-02, D-04.
- Scope: v1

### FTOL-06 Versioned transport, fail closed
- Requirement: Backend requests travel as one JSON object on stdin (max 16 MiB of UTF-8 bytes, else `file request exceeds 16 MiB; split the call`) and replies carry `protocol: 1`; the mod reports a non-zero exit, truncated stdout/stderr or empty stdout as `File transport failed: <cause>` and any other protocol as `Harness file mod/backend protocol mismatch: update the installed project assets and plugin together`, both before any native execution.
- Acceptance: offline: a stub backend answering `protocol: 9` yields the mismatch text and zero native Bash calls; truncated and empty replies yield `File transport failed`.
- Source: FIL-06, P4.
- Scope: v1

### FTOL-07 Target I/O only through native Bash tickets
- Requirement: Target I/O runs only through native `Bash` calls `node '<backend>' --plan|--execute <64-hex session> <64-hex ticket>` (ids validated, else `Invalid backend ticket`), Bash timeout 120 s, so Claude Code's own permission and hook chain applies; the command never carries payload: its length is the quoted backend path plus a fixed overhead of at most 200 chars, independent of payload size; an execute counts as done only when its output contains `harness-files ticket completed`.
- Acceptance: offline: a 100 KB write produces Bash commands of the same length as a 10-byte write, containing no payload bytes; a backend path with spaces and a single quote is quoted and runs; an execute whose output lacks the sentinel is reported as an error.
- Source: FIL-01, FIL-07, D-39, D-40.
- Scope: v1

### FTOL-08 Permission checks fail closed, ask never promoted
- Requirement: Before staging, the mod runs `tool.check` for every supplied path (`Read` per path; `Write {file_path, content}` per written file; `Edit {file_path, old_string, new_string}` per edit, line edits with `old_string: ''`); after `--plan` it repeats the checks for every planned target, including canonical paths, a unique read guess, retained fixes, a `Write {content:''}` check on the first existing parent directory of every written or edited target (staged siblings and renames modify it, also for existing files) and one for each missing ancestor of a new path. Any verdict other than `allow` (or a present non-allow `ceiling`) ends the call with `<tool> permission <decision>: <reason or 'use the native tool for this path; this adapter fails closed on ask/deny'>`, without execution, and the staged ticket is withdrawn.
- Acceptance: offline: stub `tool.check` answering ask or deny before staging -> refusal text and zero stage/native calls; deny only on the guessed canonical path -> no execute and the ticket withdrawn; a write to `new/dir/f.txt` plans Write checks for both missing ancestors; an allowed Edit of an existing file whose parent-directory Write is denied starts no execution and leaves no temp file.
- Source: FIL-08, FIL-10, D-40, INV-34.
- Scope: v1

### FTOL-09 Executed target set equals checked set
- Requirement: `--execute` recomputes the plan from the stored request and fix state and aborts with `permission plan changed (paths, symlinks or retained fixes); nothing executed, retry the call` on any difference; during execution a path whose canonical path is not a planned one fails `unplanned or changed target: <abs>; nothing authorized for this path`; broken symlinks fail `broken symlink: <path>`.
- Acceptance: offline: plan a write through `link/a` (a junction on Windows), repoint the link, execute -> `plan changed`, both possible targets unchanged.
- Source: FIL-09, FIL-21, D-40.
- Scope: v1

### FTOL-10 Permission-mode compatibility check
- Requirement: The kit verifies, without changing any setting, whether mod writes are allowed in the owner's actual `circle` main-session permission mode and in the `mode` the kit sets for the workers it creates (`modeId`, default `bypassPermissions`); an ask/deny refusal keeps the fail-closed text of FTOL-08, which names the native tool as fallback; changing a permission setting another tool owns (Claude Code, Paseo provider) is an explicit owner action in that tool, never a kit repair.
- Acceptance: manual: in an owner-approved scratch `circle` main session in its current mode and in a `ph spawn` worker on `circle/gpt-6-luna-fast[1m]`, `write_multiple_files` then `edit_multiple_files` on a scratch file are tried and the outcome per session is recorded; offline: stub ask and deny verdicts yield the FTOL-08 refusal while the fixture Claude settings and Paseo provider files stay byte-identical.
- Source: D-40, R-12, INV-05, INV-50.
- Scope: v1

### FTOL-11 A mutation executes at most once
- Requirement: Each mutating call runs under a ticket that executes at most once: a `.started` marker is created exclusively before the handler runs; a second execute of a finished ticket is a successful no-op and of an unfinished one fails `execution ticket already started; outcome unknown, recover receipt or inspect targets; operation will not repeat`; a ticket withdrawn before execution can never execute; a completed result is recoverable by `{receipt: <ticket>}` on the same tool without rerunning (`receipt belongs to a different tool` otherwise).
- Acceptance: offline: execute a ticket, reset the target, execute again -> target unchanged; withdraw then execute -> refused; `{receipt}` returns the stored result while the target-write count stays 1.
- Source: FIL-14, HIS-06, INV-29, D-39, R-16.
- Scope: v1

### FTOL-12 Recovered, unknown and not-executed are distinct outcomes
- Requirement: The mod makes the native execute call at most once per tool call. After a failure past that call: a recoverable completed result is returned as `Recovered completed execution receipt; operation was not repeated.` plus the text; a started execution without an available receipt returns `EXECUTION OUTCOME UNKNOWN: target files may already have changed. Do not repeat the mutation blindly. Recover its result on this same tool with {"receipt":"<ticket>"} ...`; an execution that never started returns `Not executed; no target changed. <cause>`. Failures before the execute call return their permission or transport cause, never `Not executed`.
- Acceptance: offline (stub engine): the four cases of FIL-15 produce the four texts with native execute count 1, 1, 1 and 0.
- Source: FIL-15, INV-29.
- Scope: v1

### FTOL-13 Lossless pagination below the persistence threshold
- Requirement: Every result is paginated: page body at most 40,000 chars (`PAGE_CHARS`), never splitting a surrogate pair; every returned text (body, plus `ERROR (details/fix IDs are paginated, not discarded)` on every page of an error, plus the footer `CONTINUATION <64hex>: call mcp__harness-files__<tool> with {"continuation":"<token>"}; ...`) is at most 44,000 chars, below Claude Code's ~50,000-char persistence threshold, and the mod refuses a longer backend text; fix IDs are persisted before paging; a continuation is valid only on its tool and session (`continuation belongs to a different tool`; unknown or expired: `continuation unknown or expired (one-hour private retention/budget); read the needed range again`).
- Acceptance: offline: a 90,000-char error report with an emoji at a page boundary reassembles identical across pages; 600 failed edits page their report and keep 500 fix IDs; every page is <= 44,000 chars.
- Source: FIL-16, HIS-05, D-41, INV-28.
- Scope: v1

### FTOL-14 Session-bound private state
- Requirement: Mod state (tickets, fix IDs, read tags, signatures, continuations, receipts) lives in `<tmpdir>/paseo-harness-files-<uid>/<sha256(Claude session id)>/`, mode 0700; a state directory that is a symlink, resolves elsewhere, or (POSIX) has another owner or group/other bits is refused (`unsafe private state directory...`); private files are read only when regular, owned, private and <= 64 MiB; IDs, tags, continuations and receipts of another session are unknown.
- Acceptance: offline: a fix ID, a tag and a continuation from session A fail as unknown in session B; a symlinked state directory is refused.
- Source: FIL-12, INV-31.
- Scope: v1

### FTOL-15 Session lock with stale recovery
- Requirement: All backend actions of one session run under `session.lock` (exclusive create, content `{pid}`); a waiter polls up to 20 s (below the 30 s transport timeout) then fails `private session state locked by another running file operation; retry later`; a lock of a dead pid, or left unwritten for 10 s, is recovered atomically; a killed `--execute` never wedges the session.
- Acceptance: offline: a dead-pid lock and an empty lock older than 10 s are recovered; a live-pid lock fails after about 20 s; killing an execute mid-run leaves the next call working; 8 concurrent executes yield 8 distinct fix IDs.
- Source: FIL-13.
- Scope: v1

### FTOL-16 Retention, budgets and stale session cleanup
- Requirement: Each action first deletes the session's ticket files older than 1 h; when the session's ticket files reach 64 MiB or 384 files, completed results and pages are evicted oldest first; unfinished tickets are never evicted, and when they alone exceed the budget the call fails `private session transport budget reached by unfinished tickets; ...`; whole session directories untouched for 24 h are removed.
- Acceptance: offline: a request file aged 1 h + 1 ms is gone after the next call; 384 unfinished tickets make the next call fail with `transport budget`; a session directory last modified 25 h ago is removed by a call of another session.
- Source: FIL-17, HIS-06.
- Scope: v1

### FTOL-17 Per-request project config, registration unaffected
- Requirement: At execution the backend loads `read_limits` through the shared config loader (M3) with root `$PASEO_HARNESS_ROOT`, else the nearest ancestor of the request cwd holding `.agents/harness-kit.json` or `.agents/harness.config.json`, else the cwd; an invalid overlay fails that call with `invalid harness config <key>: <message>` while `describe` and tool registration keep working.
- Acceptance: offline: overlay `{read_limits:{fileMaxChars:100,replyMaxChars:200}}` refuses a 150-char file naming the 100-character limit; an overlay with `typo_key` fails a read with `typo_key: unknown key` while `describe` still lists three tools.
- Source: FIL-18, P3.
- Scope: v1

### FTOL-18 Path resolution
- Requirement: Paths resolve against the session cwd; the Git Bash form `/c/...` becomes `C:/...` on Windows; `~` and `~/x` expand to the home directory identically in plan and execution; containment uses a separator boundary and is case-folded only on Windows; existence and canonical checks use the realpath of the deepest existing ancestor.
- Acceptance: offline: a relative path and a `/c/...` path read the right file (Windows); `~/f` reads the temp-HOME file in plan and execute; on POSIX `A.txt` and `a.txt` stay distinct targets.
- Source: FIL-19, INV-33, INV-52.
- Scope: v1

### FTOL-19 Missing-path suggestion
- Requirement: For a missing path the backend searches its file name in the nearest existing folder, then one folder up at a time while inside the session cwd; the first folder with hits decides; `node_modules` and `.git` are skipped; at most 20,000 entries are visited; name matching is case-insensitive on every platform; one hit is unique; several are listed (at most 5) by shared leading segments, then length; with no hit, up to 5 look-alike names (Levenshtein <= max(2, floor(len/4))) of the nearest existing folder are listed.
- Acceptance: offline: `specs/20-species/X.md` missing with `specs/20-creature/X.md` present -> unique; two same-named files -> both listed nearest first; a name typo lists the look-alike; `x.MD` finds `X.md` on a POSIX fixture.
- Source: FIL-20, D-44.
- Scope: v1

### FTOL-20 Guesses only for reads, announced; mutation targets never guessed
- Requirement: `read_ranges` reads a unique guess that passes containment and permission in place, with header suffix `(read in place of <path>, which does not exist: the only file of that name nearby)`, else fails `<path>: file not found; did you mean: a | b`; `edit_multiple_files` never applies a guess: a missing path fails with a retained fix whose form carries `"path":<guess or "<corrected>">`; a folder given as edit path fails `is a folder, not a file`.
- Acceptance: offline: the wrong-folder read returns the real file with the note; the wrong-folder edit leaves the real file untouched and returns a fix form with the guessed path; sending that fix applies the edit.
- Source: FIL-21, INV-30.
- Scope: v1

### FTOL-21 read_ranges contract
- Requirement: Input `ranges: [{path, from?, to?}]` (at least one; 1-based inclusive; omitted `from` = 1, omitted `to` = last line); `to < from` fails the entry; `to` is clamped to the file length; `from` past the end fails `<path>: line <from> is past the end (<total> lines)`; entries are independent: good entries come first, separated by a blank line, then one `ERROR <message>` line per failed entry; a call where every entry failed fails with the messages. Entry header `===== <abs> lines <from>-<to> of <total>[, tag <tag>][<guess note>]`, then lines `<n padded to the last number's width>| <text>` with CR stripped; a folder answers `<path>: is a folder; it holds N entries: <first 30>[, ...]`; the line count is newlines + 1.
- Acceptance: offline: one call with a good range, a missing path, a folder, `from` past the end and `to < from` returns the good entry then four `ERROR` lines; lines 2-9 of a 4-line file give `lines 2-4 of 4`; a file `one\ntwo\nthree\n` reads as `lines 1-4 of 4`.
- Source: FIL-22.
- Scope: v1

### FTOL-22 Per-entry cap and per-reply budget
- Requirement: An entry whose rendered text exceeds `read_limits.fileMaxChars` is not read: `<path>: lines a-b have N characters, over the <fileMaxChars>-character limit for one entry; lines a-<fit> fit; read the part you need ...`, or, when line `a` alone is over the cap, the hint to extract the part with a script; an entry that would push the reply past `read_limits.replyMaxChars` is skipped with `<path> lines a-b: not read in this call: with it the reply would pass <replyMaxChars> characters; read it in another call` (its tag dropped) while later smaller entries are still read; path-level errors cost no budget.
- Acceptance: offline: an oversized file gives the `lines 1-K fit` text and reading 1..K succeeds; N files each at 0.9 of the cap give exactly one `not read in this call` and a later small file still reads.
- Source: FIL-23, HIS-05, INV-28.
- Scope: v1

### FTOL-23 Read limits sized to one page
- Requirement: `read_limits` holds exactly `fileMaxChars` and `replyMaxChars` (no media keys, no `INLINE_MAX_CHARS`), shipped defaults 36,000 and 38,000; the one config validator (M3) rejects non-positive or non-integer values, `fileMaxChars > replyMaxChars` and `replyMaxChars > 40,000` (`PAGE_CHARS`); this bound replaces the legacy `< 500000` rule (D-41 removed `INLINE_MAX_CHARS`), so CONF-06 must carry it and no second validator exists; a read within the limits returns in one page.
- Acceptance: offline: shared-loader tests: `replyMaxChars` 40,000 passes, 40,001 fails, `fileMaxChars > replyMaxChars` fails, each naming `read_limits.<key>`; the backend (FTOL-17) gets the same outcome for the same overlay; a read whose reply is 37,000 chars returns without a `CONTINUATION` footer.
- Source: FIL-26, HIS-05, D-41, S-05.
- Scope: v1

### FTOL-24 Binary files refused
- Requirement: A file whose first 8,000 bytes contain a NUL is not read as text: `<path>: not read: a binary file (<bytes> bytes), not text; open images and PDFs with the native Read tool; read other binary files with a script or a tool made for them`; an edit of such a file fails at file level; sibling entries are unaffected.
- Acceptance: offline: a PNG-header entry and a text entry in one read call yield the binary message plus the text entry; an edit of the PNG writes nothing and returns a file-level failure.
- Source: FIL-24, FIL-30, HIS-05, D-42, INV-32.
- Scope: v1

### FTOL-25 Bounded-memory reader
- Requirement: Range reads stream the file in bounded chunks and retain only what fits the reply budget; a line longer than the budget never becomes one JS string.
- Acceptance: offline: under `--max-old-space-size=32`, a file with a 48 MiB first line and a short line 2: reading line 2 succeeds and reading line 1 reports `line 1 alone has 50,331,648 characters`.
- Source: FIL-25, INV-32.
- Scope: v1

### FTOL-26 write_multiple_files contract
- Requirement: Input `files: [{path, content}]` (at least one); all paths are checked first; a path listed twice (case-folded on Windows) fails `<path>: listed twice`; any invalid entry means nothing is written and the result is `nothing written:` followed by the errors; parent directories are created; content is written as UTF-8 exactly as sent; the reply is one line per file `wrote <abs> (<N> chars)`.
- Acceptance: offline: two files including one in a new nested directory are written; a call with one invalid or one duplicated path writes none.
- Source: FIL-27.
- Scope: v1

### FTOL-27 All-or-nothing commit with honest rollback
- Requirement: Changed files are staged as temps beside their targets, then renamed over them (EPERM/EBUSY/EACCES retried 5 times with 40 ms x 2^i back-off); a failed staging removes every temp and reports `nothing written: staging <path> failed: <msg>`; a failed rename restores the already replaced files in reverse order and reports `nothing written: writing <path> failed (<msg>); <k> file(s) already replaced were restored`, or `ROLLBACK INCOMPLETE, these files may hold the new text: <list>` when a restore fails; no temp file remains; POSIX mode bits of a replaced file are kept; every restored existing file gets an mtime in a later whole second than both its pre-call mtime and the replacement's (INV-54), and a failure to set it is reported as `ROLLBACK INCOMPLETE` naming the file; no result claims "nothing written" unless the rollback completed.
- Acceptance: offline: `[a.txt, <path blocked by a directory>]` leaves `a.txt` unchanged and no temp; a read-only second file (Windows) gets the first restored; a fault injected into the restore yields `ROLLBACK INCOMPLETE` naming the file; an executable file keeps its mode (POSIX); in a scratch git repo a same-size replacement rolled back within one second leaves the original bytes and `git status` agrees with `git diff --no-index` against the original (no stale stat cache).
- Source: FIL-28, HIS-91, INV-31, INV-54.
- Scope: v1

### FTOL-28 edit_multiple_files contract and distinct result states
- Requirement: Input `files: [{path, tag?, edits: [{oldText? | from, to? | after, newText}]}]`, `fixes: [...]`, `atomic` (default false), `dryRun` (default false); at least one of files or fixes (`nothing written: give files, fixes or both`). Order: listed fixes, then `files` entries in order, then queued `{id, path}` file fixes; inside an entry, line edits before oldText edits, each edit seeing earlier output. By default matching edits commit and failures are retained. Result states are distinguishable: `edited <abs>: N edit(s)[ (k failed)], +/-d chars` or `nothing to change`; `PARTLY WRITTEN: X edit(s) written, Y failed and not written.`; `nothing written[ (atomic: true)]: N edit(s) failed. ...`; `would edit <path>: N edit(s), +d chars` and `DRY RUN, nothing written: X edit(s) would be written, Y would fail.`; report blocks `line edits whose lines had moved since their read:`, `skipped, already in the file:`, `failed:`. Replies are summaries, never diffs.
- Acceptance: offline: three edits with the middle one failing -> first and third written, reply starts `PARTLY WRITTEN: 2 edit(s) written, 1 failed`; `atomic` with one failure leaves every file unchanged; `dryRun` with one failure says `DRY RUN` and writes nothing; a successful edit of a file with 5,000-char lines replies in under 300 chars.
- Source: FIL-29, FIL-34, FIL-41 (lesson), HIS-91.
- Scope: v1

### FTOL-29 Exact-once matching and line endings
- Requirement: An oldText edit applies only when oldText (CRLF normalised to LF) occurs exactly once in the current text; a file whose line endings are all CRLF is edited as LF and written back CRLF; a file with mixed endings is refused at file level (`mixed line endings; use native Edit`) and never normalised; a missing file fails at file level (edits never create files).
- Acceptance: offline: a two-line LF oldText on a CRLF file applies and the file stays all-CRLF; a mixed-ending file stays byte-identical and is reported; a missing file returns a file-level fix ID.
- Source: FIL-30, FIL-35.
- Scope: v1

### FTOL-30 Failure diagnosis turns a failed edit into a one-ID retry
- Requirement: An oldText edit that does not match exactly once yields one line `<id> <path> edit <i> <oldText as JSON, cut at 60 chars>: <why> → fix: <form>` with, in order: the occurrence list `found N times (#1 line L, ...)` (form `{"id","occurrence":<1-N>}`); `the file had it before this call (line L), but an earlier edit of this call changed it; give oldText that matches the edited text`; a unique whitespace/case/look-alike match `SUGGESTED at line L, differing only in whitespace, letter case or look-alike characters: ...` or a short-stretch suggestion, both applied by `{"id"}`; else head/tail hints, plus `newText already occurs at line L: ...` when newText has >= 12 chars; otherwise the form `{"id","oldText":"<corrected>"}`.
- Acceptance: offline: whitespace, NBSP (shown as `U+00A0`), short-stretch, duplicate-line and earlier-edit-changed cases each give the stated reason and form; `{id}` on a suggestion applies it.
- Source: FIL-31, D-43.
- Scope: v1

### FTOL-31 Fix IDs: retained, bounded, single use
- Requirement: Fix IDs are `<2 letters><n>` per session; failed edits are retained in insertion order up to 500 entries and 8 MiB serialized, oldest evicted; a single failure over 8 MiB is `not retained: this replacement exceeds the 8 MiB failure-state budget; resend a smaller edit`; an ID is consumed when its fix applies or is skipped in a committing call and survives dryRun and aborted calls; forms `{id}`, `{id, occurrence}`, `{id, oldText}`, `{id, path}`, each with optional `newText`; a fix that no longer fits is diagnosed afresh; unknown, used or foreign IDs fail `<id>: unknown fix id (or expired); ...; resend the edit`.
- Acceptance: offline: fail an edit, `{id}` applies it, a second `{id}` is unknown; a dryRun fix keeps its ID; after 600 failures 500 remain; a failure with a 9 MiB newText is `not retained` and the state stays under 8 MiB.
- Source: FIL-32, HIS-06, INV-31.
- Scope: v1

### FTOL-32 Resent edits are skipped, never doubled
- Requirement: An edit whose newText already covers the only match of oldText is skipped as `already applied: newText already covers the only match (line L)`; signatures of the newest 2,000 committed edits per session make a resent edit whose oldText is gone a skip (`already applied: this session wrote this edit before`) while the file still holds newText (line edits: the new lines); signatures are recorded only after a real commit, never for dryRun or aborted/atomic-failed calls; an oldText the session never wrote still fails `found 0 times`.
- Acceptance: offline: `a` -> `a b` sent twice leaves `a b`; a resent `after: 0` insert is not doubled; a dryRun or atomic-aborted first send does not make a later real send look applied.
- Source: FIL-33, HIS-06, INV-31.
- Scope: v1

### FTOL-33 Per-file independence in a batch
- Requirement: Unless `atomic`, each file of an edit batch applies or fails on its own; a file listed in two entries continues from the first entry's text (key case-folded on Windows); a file with no applied edit is not rewritten; a file-level failure (outside containment, not found, folder, binary, mixed endings) reports `<id> <path>: <reason>[; did you mean: ...] (N edit(s) not written) → fix: {"id":..,"path":...}` and retains all its edits so `{id, path}` re-runs them on the corrected path.
- Acceptance: offline: a batch of 4 files with 2 invalid applies 2 and returns 2 IDs; two entries for one file both apply; an `{id, path}` fix applies the retained edits to the corrected file.
- Source: FIL-35, HIS-07, INV-31.
- Scope: v1

### FTOL-34 Read tags with per-line hashes
- Requirement: Each `read_ranges` entry that shows exactly `to-from+1` lines registers a session-bound tag `<run>t<n>` holding path, first line, total line count and an FNV-1a hash per shown line (CR stripped), printed in the header; the store keeps the newest 64 reads and at most 30,000 hashed lines, evicting oldest first but never the tag just issued; an entry deferred by the reply budget loses its new tag; an unknown tag fails `unknown tag <tag> (expired, or from an earlier server process); read the lines again with read_ranges`.
- Acceptance: offline: read, then a line edit with the header tag applies; the same tag from another session is unknown; a 65th read evicts the first tag.
- Source: FIL-36, HIS-06, D-43.
- Scope: v1

### FTOL-35 Line edits never edit changed lines
- Requirement: A line edit gives `from` (with `to >= from`) to replace or `after` (0 = top) to insert, with the read tag on the file entry or fix; it applies in place when the file still has the read-time line count and unchanged hashes over the read; else a resent edit is skipped; else it applies at the unique place where the edited lines plus up to 2 context lines each side match (reported as moved); several places fail with up to 10 listed and form `{id, occurrence}`; otherwise a unique suggestion, or the current lines (<= 20) with a fresh tag, or `<lines> changed since read <tag>; read them again`. Preconditions fail with the FIL-37 texts: oldText with line numbers, missing tag, tag of another file, bad numbers, lines outside the read, empty insert.
- Acceptance: offline, each asserting file bytes: replace + top insert + delete in one entry produce the expected file; a stale tag whose read range is unchanged applies in place; lines moved +2 change only at the matched place, and the reply reports the move; a block duplicated at two places writes nothing and returns `{id, occurrence}`, after which the chosen occurrence alone changes; a changed target line leaves the file byte-identical and returns a fix with the current lines and a new tag, after which `{id, from, to}` against the new tag applies; an out-of-read range, a tag of another file and a missing tag write nothing; with `atomic: false` a sibling valid edit in the same call is written, with `atomic: true` nothing is; a CRLF file stays CRLF.
- Source: FIL-37, INV-31, D-43.
- Scope: v1

### FTOL-36 Several line edits in one entry
- Requirement: All line edits of one entry are located against the same current text and applied bottom-up so each keeps its read numbering; at one line a replacement goes before inserts and list order is kept; an edit overlapping an earlier placed one fails `overlaps edit N <lines>; give one edit for these lines` while the earlier one is written; the same edit listed twice is skipped; moved edits are reported as `<label>: its lines had moved +k; applied from line L`.
- Acceptance: offline: edits (3-5), (5) and (after 3) in one entry: the first is written, the other two fail with `overlaps`.
- Source: FIL-38.
- Scope: v1

### FTOL-37 Fixes of line edits
- Requirement: A retained line failure keeps path, tag, lines, newText, places, suggestion and shown lines; `{id}` applies the suggestion; `{id, occurrence}` picks a place while the count is unchanged; `{id, from/to/after}` renumbers against the shown lines or the `tag` given in the fix; `{id, newText}` overrides the text; the first-sent edit is also recorded as an applied signature; a fix for a vanished file fails `file not found any more`.
- Acceptance: offline: a stale tag with changed context -> `{id}` applies the suggestion; a changed line -> `{id, from:2, to:2}` applies against the shown lines.
- Source: FIL-39.
- Scope: v1

### FTOL-38 Read-only role classification knows the mod tools
- Requirement: The read-only check of agent-definition tool lists (M5 prompt assembly) treats `mcp__harness-files__edit_multiple_files`, `mcp__harness-files__write_multiple_files`, `Edit`, `Write`, `MultiEdit` and `NotebookEdit` as writers and `mcp__harness-files__read_ranges` as a reader, on token boundaries; legacy `fsbatch`/`filesystem` names are not in the table; a definition without `tools` is not read-only.
- Acceptance: offline: `tools: Read, Grep, mcp__harness-files__read_ranges` -> read-only; adding `mcp__harness-files__edit_multiple_files`, also in JSON-array form -> writer; no `tools` -> not read-only.
- Source: FIL-46, D-19.
- Scope: v1

### FTOL-39 Native tools stay untouched
- Requirement: The mod registers no native tool name, installs `tool.call` handlers only for its three tools, never fabricates native results or read state, and never denies a native tool; no kit hook, setting or provider default denies Read, Edit or Write; images, PDFs and notebooks go through native Read.
- Acceptance: offline: the registered handler matchers are exactly the three mod names; a grep gate finds no deny of Read/Edit/Write in the mod, the hook template or the defaults.
- Source: FIL-49, FIL-43, HIS-08, D-42, INV-34.
- Scope: v1

### FTOL-40 Native-subagent guard
- Requirement: A `tool.call` event carrying `agentId` (a native Claude Code child) is refused before any check or staging with `Harness file backend is unavailable inside a native subagent: ... Use native Read/Edit/Write/Bash; these built-ins are unchanged.`; `ph` workers, which are their own sessions, use the mod normally.
- Acceptance: offline: an event with `agentId` returns the refusal and zero `process.run` calls; the same event without `agentId` proceeds.
- Source: FIL-11, INV-06.
- Scope: v1

### FTOL-41 Per-line ending preservation for mixed-ending files
- Source: FIL-30 (alternative to the v1 refusal in FTOL-29).
- Scope: later

### FTOL-42 Trim unused line-edit failure tiers after transcript measurement
- Source: D-43, FIL-31, FIL-37.
- Scope: later

### FTOL-43 Image-per-turn guard as a hook if image-heavy GPT sessions return
- Source: D-42, FIL-43, HIS-05, R-13.
- Scope: later

## M8 hooks (HOOK)

### HOOK-01 Registration template
- Requirement: `templates/settings.hooks.json` holds exactly these `type: command` entries, each `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<script>.mjs"`: PreToolUse `Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|mcp__harness-files__.*` -> `io_guard.mjs`; PostToolUse `Read|Grep|Glob|mcp__harness-files__read_ranges` -> `io_guard.mjs`; PostToolUse `*` -> `context_guard.mjs`; UserPromptSubmit (no matcher) -> `context_guard.mjs`; PreToolUse `Bash` -> `bash_long_command.mjs`; PreToolUse and PostToolUse `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_multiple_files` -> `syntax_check.mjs`. Timeouts: 10 s, except `syntax_check.mjs` 90 s. No matcher names a tool the kit does not ship (`mcp__fsbatch__`, `mcp__filesystem__`).
- Acceptance: offline: merging the template into an empty settings file yields exactly these seven entries with these matchers and timeouts; each command resolves to a shipped script under a `$CLAUDE_PROJECT_DIR` containing spaces.
- Source: HOK-01, HOK-30, D-45, D-46.
- Scope: v1

### HOOK-02 Template is the single list of kit hooks
- Requirement: Every script referenced by the template is a shipped `.claude/hooks/*.mjs` (tests excluded) and every shipped hook script is referenced; the installer (M1) derives its managed-hook set from the template, not from a hard-coded list; no `subagent_file_tools.mjs` stub ships.
- Acceptance: offline: the set of script names in the template equals the shipped hook scripts; adding a script to the template without shipping it fails the kit consistency test; `subagent_file_tools.mjs` is absent from `kit.json`.
- Source: HOK-02, HOK-25, INS-20 (M1 reconcile).
- Scope: v1

### HOOK-03 Project hooks coexist with kit hooks
- Requirement: Kit hooks are separate scripts identified by file name and digest; project hooks (registered by the project or its adapter) live in their own scripts and settings entries, the kit never writes, edits or removes them, and a tool call matching both a kit and a project entry runs both.
- Acceptance: offline: a fixture project with its own PreToolUse and PostToolUse hooks on the kit's matchers keeps them unchanged and unduplicated after `kit install` and `kit update`, beside one copy of each kit entry.
- Source: HOK-29, HOK-02.
- Scope: v1

### HOOK-04 Hooks find the config by one documented root rule
- Requirement: Every kit hook computes its root as `PASEO_HARNESS_ROOT || CLAUDE_PROJECT_DIR || <hook input cwd> || process.cwd()` and loads `<root>/.agents/harness/config.mjs` through one shared discovery function, not a relative import; the overlay is `.agents/harness.config.json` only (a `.claude/harness.config.json` is ignored).
- Acceptance: offline: an installed fixture project copied to another path runs both guards from an unrelated cwd with `CLAUDE_PROJECT_DIR` set; a project with only `.claude/harness.config.json` behaves as defaults.
- Source: HOK-31, HOK-37, HOK-09, D-49, INV-09.
- Scope: v1

### HOOK-05 Hooks never block and never fail loudly
- Requirement: Every kit hook exits 0 on every path and never emits a permission decision or `decision: block`; a configuration error writes exactly one stderr line `<hook name> unavailable: <message>` and no stdout; any other error (bad JSON, missing transcript) exits 0 silently; output, when present, is one JSON `{hookSpecificOutput:{hookEventName, additionalContext}}` (or `updatedInput` for `bash_long_command`).
- Acceptance: offline: each hook fed `{not json`, a nonexistent transcript path and a broken overlay exits 0; only the broken overlay produces one stderr line; no output of any test contains a permission decision.
- Source: HOK-09, HOK-21, INV-26, P7.
- Scope: v1

### HOOK-06 Context guard speaks only to the main session, by role identity
- Requirement: The context guard treats a session as main only when the hook input has none of `agent_id`, `agentId`, `parent_agent_id`, the env has no `PASEO_HARNESS_LEADER` and `PASEO_HARNESS_ROLE` is not `worker`; `agent_type` is not identity; the model name plays no part.
- Acceptance: offline: a table test over `{}`, `{agent_type}`, `{agent_id}`, `{agentId}`, `{parent_agent_id}`, env LEADER and env ROLE=worker gives main, main, not, not, not, not, not; one main case with an unknown model name reminds at `start_pct`.
- Source: HOK-03, HIS-10, INV-25.
- Scope: v1

### HOOK-07 Context usage from the transcript tail
- Requirement: The guard reads the last 1 MiB of `transcript_path`, walks lines from the end, and takes the newest entry with `type: assistant`, not `isSidechain`, no `agentId`, a `message.usage` and a model other than `<synthetic>`; used tokens = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (missing = 0; non-finite or negative skipped); window = the usage's reported context window field, else none; no such entry -> no reminder. The transcript field names are re-verified against the installed Claude Code version.
- Acceptance: offline: a transcript whose last line is a sidechain assistant with huge usage after a main line with 600,000 yields 600,000; a `<synthetic>` last line is skipped; manual: on the installed Claude Code a real transcript yields the usage `ph context --self` reports, within one turn.
- Source: HOK-04, R-04.
- Scope: v1

### HOOK-08 Band computation
- Requirement: Window size = the reported window when finite and > 0, else `context_guard.window_tokens`; `pct = 100 * used / size`; band = -1 below `start_pct`, else `floor((pct - start_pct) / step_pct)`; a non-positive size or step, or `start_pct` outside (0, 100], throws `context_guard needs a positive window and step, and start_pct between 0 and 100`.
- Acceptance: offline: with defaults 1,000,000/60/5: 599,999 -> -1, 600,000 -> 0, 650,000 -> 1; reported window 200,000 with 120,000 used -> 0; `step_pct: 0` throws.
- Source: HOK-05.
- Scope: v1

### HOOK-09 One reminder per band, decided atomically
- Requirement: Per session (key = sha256 of `session_id`, fallback `transcript_path`) the guard stores the last band; it reminds only when the current band is higher than the stored one, and the decision to remind is one atomic filesystem operation (exclusive create or rename), with no PID or mtime claim recovery; any downward move lowers the stored band (below `start_pct` resets it to -1), so a later climb reminds again; state files older than 24 h are pruned. A crash between decision and output loses at most that one reminder.
- Acceptance: offline: 6 concurrent hook processes at band 0 produce exactly one reminder; usage 650,000 -> reminder, again -> silent, 610,000 then 650,000 -> reminder again, 1,000 then 600,000 -> reminder again; a planted claim file containing `{"pid":"x"}` does not silence the next band.
- Source: HOK-06, HOK-07, HOK-36, D-50, S-06.
- Scope: v1

### HOOK-10 Reminder text points to self-compaction
- Requirement: The reminder is one `additionalContext` line, not a notification and never a forced compaction: `Context guard: this main session uses <pct>% of its context (<used>/<window> tokens; threshold <start_pct>%). At the next natural break (no edit half-done, no background job or Monitor still running), compact yourself: run \`node .agents/harness/ph.mjs compact-self --focus "<what to keep>"\` and end the turn. You will be reminded again at the next <step_pct>% step.`; the compaction itself, its success measure and the resume text are `ph compact-self` (M5); native autocompact is not touched.
- Acceptance: offline: at 650,000/1,000,000 the output matches `65%` and `650000/1000000` and contains `ph.mjs compact-self --focus`; with a reported window of 200,000 and 120,000 used it contains `120000/200000`; the command path in the text exists in an installed fixture project.
- Source: HOK-08, HOK-12, INV-24.
- Scope: v1

### HOOK-11 context_guard settings
- Requirement: `context_guard` (merged key) has exactly `window_tokens` (default 1,000,000, >= 1), `start_pct` (default 60, 1..100) and `step_pct` (default 5, 1..100), all integers; a project overlay may override single fields (e.g. `start_pct: 45`); no `model_pattern` key exists.
- Acceptance: offline: overlay `{context_guard:{start_pct:45}}` merges with the default step; `start_pct: 0` or `101` and `context_guard.model_pattern` fail validation naming the key.
- Source: HOK-10, HIS-11, D-48.
- Scope: v1

### HOOK-12 Context guard on every tool call stays cheap
- Requirement: With matcher `*`, the guard checks identity first and returns before reading config, transcript or state for any non-main session; the kit ships a benchmark that measures hook wall time over a 1 MiB transcript.
- Acceptance: offline: a worker-env and a child-input run perform no read of the transcript or the overlay (spy on the injected fs); the benchmark reports p50/p95 wall time and p95 stays under 1 s on the owner's Windows machine (manual record), far below the 10 s timeout.
- Source: HOK-11, D-51.
- Scope: v1

### HOOK-13 io guard tool sets
- Requirement: The io guard classifies tools as LOOKUP (`Read`, `Grep`, `Glob`, `mcp__harness-files__read_ranges`), MUTATING (`Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `mcp__harness-files__edit_multiple_files`, `mcp__harness-files__write_multiple_files`) and RESULT (`Grep`, `Glob`); one table holds the names and their path fields; any other tool exits 0 with no output.
- Acceptance: offline: calls of `Bash` and `mcp__fsbatch__read_ranges` give empty stdout and exit 0; each listed tool reaches its branch.
- Source: HOK-13.
- Scope: v1

### HOOK-14 Rounds read from the transcript
- Requirement: The io guard reads the last 1 MiB of the transcript, skips `isSidechain` and `isMeta` entries, starts a new prompt at each real user prompt (prompt key = `uuid ?? timestamp ?? line index`, initial `tail-start`), and groups the `tool_use` blocks of one assistant `message.id` into one round; a round is finished when every tool use has a result; unfinished (in-flight) rounds never count as previous rounds, but their file calls are summed; rounds with neither tool kind are skipped by the lookup streak and break the edit streak. The schema is re-verified on the installed Claude Code.
- Acceptance: offline: START-1 finished lookup rounds plus an in-flight round of 2 parallel calls report round START, not START+1; manual: on a real transcript of the installed version, parallel calls of one message form one round.
- Source: HOK-14, R-04.
- Scope: v1

### HOOK-15 First file round of a prompt
- Requirement: On PreToolUse, when no finished round of the current prompt has a lookup or mutating call, the guard claims `first|<promptKey>` and, unless 2 or more file calls are already in flight, speaks the first-lookup (planning) or first-edit text; said once per prompt.
- Acceptance: offline: the first Grep of a prompt gets the planning text once; a second run for the same prompt is silent; an in-flight round of Grep+Glob suppresses it; the next prompt speaks again.
- Source: HOK-15.
- Scope: v1

### HOOK-16 Lookup streak
- Requirement: For a lookup call, n = finished lookup rounds walking back to the first mutating round, + 1; band = -1 below `io_guard.start_rounds`, else `floor((n - start_rounds) / step_rounds)`; the guard speaks `this is lookup round <n> in a row with nothing edited in between` once per band per segment (segment = count of mutating rounds) through claim `lookup|<promptKey>|<segment>|<band>`.
- Acceptance: offline: START-1 prior lookup rounds -> text names round START; START-2 -> silent; one band is spoken once; an edit round or a new prompt resets.
- Source: HOK-16.
- Scope: v1

### HOOK-17 Edit streak
- Requirement: For a mutating call, n = directly preceding finished rounds that are mutating with no lookup, + 1 (any other round ends the run); band from `edit_start_rounds`/`edit_step_rounds`; the guard speaks `this is edit round <n> in a row with nothing looked up in between`, suggesting one batch edit/write call, once per band through claim `edit|<promptKey>|<run start>|<band>`.
- Acceptance: offline: ESTART-1 preceding edit rounds -> text names round ESTART; a Bash or lookup round in between breaks it.
- Source: HOK-17.
- Scope: v1

### HOOK-18 Re-read of a file edited in this prompt
- Requirement: For a lookup call, files edited by finished rounds of the current prompt (`file_path` of Edit/MultiEdit/Write, `notebook_path` of NotebookEdit, `files[].path` of the two mod write tools, plus every `edited <abs>` and `wrote <abs>` line of their tool results, which covers fix-only calls such as `fixes:[{id}]`) intersected with the files read (`file_path` of Read unless `limit` is 1, `ranges[].path` of `read_ranges`), paths normalised (backslashes, relative to hook cwd, dot segments, lower case), give the reread text once per file set: `<files> was edited earlier in this task. Edit and Write error when a change fails, so do not re-read the file to verify it; run the checks the task names. Read it again only for parts you have not seen yet.`; edits before the last user prompt do not count.
- Acceptance: offline: edit `C:\Work\Spec.md`, then Read `c:/work/spec.md` -> flagged; `limit: 1` -> silent; `./sub/../Spec.md` with cwd `C:\Work` -> flagged; a `read_ranges` of a file written by `write_multiple_files` -> flagged; a `read_ranges` of a file changed by a fix-only `edit_multiple_files` call (`fixes:[{id}]`) -> flagged.
- Source: HOK-18.
- Scope: v1

### HOOK-19 Empty or truncated search results
- Requirement: On PostToolUse of a RESULT tool the guard speaks `truncated` when the response has `truncated: true` or its last 600 chars match `(Showing N of M` / `more are not listed` / `with pagination = limit`, else `empty` when the response reports zero files with no content or a short text with `No files found`/`No matches found`; content-mode Grep with content is not empty; no claim (speaks on every such result); Read results are ignored; the response shapes are re-verified on the installed Claude Code.
- Acceptance: offline: `No matches found`, `{numFiles:0, filenames:[]}` -> empty; content-mode with content -> silent; a list ending `(Showing 100 of 257 ...)` -> truncated.
- Source: HOK-19, R-04.
- Scope: v1

### HOOK-20 Claims dedupe parallel hooks
- Requirement: A claim is an exclusive-create file named by a hash of the claim key in `<tmpdir>/ph-io-guard-<sha256(session_id) first 24 hex>/`; creating it is permission to speak, any error means silence; claims older than 24 h are pruned; a process that dies after claiming loses that one reminder (documented, no recovery).
- Acceptance: offline: 6 concurrent hook processes on the same payload produce exactly one non-empty output; two sessions whose ids share their first 8 chars do not silence each other.
- Source: HOK-20, HOK-35.
- Scope: v1

### HOOK-21 io guard dispatch and stacked output
- Requirement: Event = `hook_event_name`, else PostToolUse when `tool_response` is present, else PreToolUse; PostToolUse needs no transcript or config; PreToolUse without `transcript_path` exits 0 silently; PreToolUse messages are joined in the fixed order first-round, lookup streak, edit streak, reread into one `additionalContext`.
- Acceptance: offline: a lookup of a file edited earlier at round START yields the streak text then the reread text joined by a newline; a payload without `transcript_path` gives empty stdout and exit 0.
- Source: HOK-21, HOK-35.
- Scope: v1

### HOOK-22 io_guard settings
- Requirement: `io_guard` (merged key) has exactly `start_rounds`, `step_rounds`, `edit_start_rounds`, `edit_step_rounds`, defaults 2/2/2/2, all non-negative safe integers, the two steps >= 1; unknown nested keys fail.
- Acceptance: offline: overlay `{io_guard:{start_rounds:3}}` merges; `step_rounds: 0`, `start_rounds: -1` and `io_guard.foo` each fail naming the key; `start_rounds: 0` is accepted.
- Source: HOK-22.
- Scope: v1

### HOOK-23 Reminder texts name only shipped tools
- Requirement: Every io guard text starts with `File I/O (AGENTS.md): ` and is at most three sentences (the reread text of HOOK-18 is the longest); tool names in any hook text are only native Claude Code tools and the three `mcp__harness-files__` tools; the batch advice names the mod tools as "when the harness-files tools are available, else native Read/Edit".
- Acceptance: offline: each of the seven texts begins with the prefix, has at most three sentences, and every tool-like token it contains is in the allowed list.
- Source: HOK-23, INV-49.
- Scope: v1

### HOOK-24 io guard and the AGENTS.md File I/O rules agree
- Requirement: The kit AGENTS.md block carries the five File I/O rules (Grep for content and Glob for names, combined; read relevant parts and batch known targets; batch related edits, whole-file writes for new files; no re-read to verify a successful write; correctness over fewer calls) once; each io guard reminder kind restates one of them.
- Acceptance: offline: a fresh install has the five rules once in AGENTS.md and an update does not duplicate them; a test maps each reminder kind to its rule.
- Source: HOK-24.
- Scope: v1

### HOOK-25 io guard runs in all sessions
- Requirement: The io guard applies to main sessions, `ph` workers and any other session loading the project settings; it does no identity check.
- Acceptance: offline: the same synthetic transcript yields the same reminder with a main-session env and with `PASEO_HARNESS_ROLE=worker`.
- Source: HOK-32, D-47.
- Scope: v1

### HOOK-26 Syntax shell reports only newly broken files
- Requirement: `syntax_check.mjs` collects targets from `file_path`, `files[].path` and `path` of the tool input (resolved against the hook cwd, deduped) and, in PostToolUse of the two mod tools, from every `edited <abs>`/`wrote <abs>` line of `tool_response` (fix-only calls carry no paths in their input; the hook never reads M7 private state), skips extensions with no configured checker before spawning anything; PreToolUse checks each target and stores per-file status under the tmp dir keyed by session and `tool_use_id`; PostToolUse checks again and reports, as `additionalContext`, only files that passed before and fail after, or new files that fail, with up to 6 `file:line:col: message` lines each; a Post target without Pre status (fix-only call) that fails is reported marked `(not checked before this edit)`; it never blocks. Checker outcomes: exit 0 = pass; non-zero with at least one diagnostic line = fail; spawn error (missing executable), timeout, or non-zero without a diagnostic line = infrastructure error, never reported and never cached. The kit ships no checker.
- Acceptance: offline (fake checker): a file edited from valid to invalid is reported once; invalid before and after is silent; a new invalid file is reported; a fix-only `{id}` call that breaks a file is reported with the marker; a missing executable, a hanging checker and a checker exiting 2 without diagnostics are silent and the hook exits 0; an extension without a checker spawns nothing.
- Source: HOK-26, HIS-04, D-45, INV-27, D-110, ADPT-06.
- Scope: v1

### HOOK-27 Syntax shell budget, slots and cache
- Requirement: The shell has a hook-wide budget of 75 s from process start (below its 90 s registration timeout); a checker run starts only with at least 10 s left, leftover files are skipped; each checker run is bounded by min(its `timeout_s`, remaining budget) and its process tree is killed at the bound; each checker has a machine-wide slot cap (`max_parallel` of ADPT-06, default 3; slot locks stale after 180 s, wait up to 20 s or the remaining budget, busy -> skip silently); results are cached under a key of owning tree root, target path, checker identity (argv, `timeout_s`, the sha256 of the tree's `adapter.syntax_checkers` entry and the content of each argv entry that is a file inside the owning tree, such as the checker script or the config it names; files outside the tree are not read) and content hash, so a changed checker configuration or program invalidates its entries; only pass and fail are cached, never skips or infrastructure errors; a reclaim guard `<lock>.reclaim-<token>` older than the 180 s stale bound is taken over by one waiter, so a reclaimer that died cannot wedge its slot; Pre state files are removed in Post and pruned after 24 h. Not covered: files a checker reads without naming them in argv, and the version of the program behind argv[0] (an upgraded `node` keeps its entries).
- Acceptance: offline: two concurrent runs with slow fake checkers never exceed 3 running checks; a batch of 40 files returns before 75 s with the rest skipped; a second check of identical content in the same tree hits the cache; identical bytes in two worktrees with different fake checkers are checked by each; changing one tree's checker argv invalidates its cached result; replacing an in-tree checker script at the same argv invalidates its cached fail (`tests/bughunt/G172.test.mjs`); a reclaim guard older than 180 s does not wedge its slot, a fresh one leaves it alone (same file); a leftover Pre file older than 24 h is pruned.
- Source: HOK-27, HOK-30, INV-27.
- Scope: v1

### HOOK-28 Checker resolved from the edited file's tree
- Requirement: For each target the shell reads the checker for its extension from `adapter.syntax_checkers` of the config of the tree that holds the file (nearest ancestor with `.agents/harness.config.json`, e.g. a worktree), not the session cwd; targets in different trees use their own trees' checkers; the entry shape is ADPT-06 (`{<extension>: {argv, timeout_s, max_parallel}}`); the shell runs `argv` without a shell, with cwd = the owning tree root and the absolute file path appended as one argument (spaces kept), and parses diagnostics as `file:line:col: message` lines.
- Acceptance: offline: an edit inside a fixture worktree whose config names a different fake checker runs that checker while cwd is the main tree; a batch spanning two trees runs each tree's checker; a target path with spaces reaches the fake checker as one argument.
- Source: HOK-27, HIS-04, D-45, INV-27, ADPT-06.
- Scope: v1

### HOOK-29 Registration lint
- Requirement: A kit test fails when a registered hook's timeout is not larger than its internal budget, or when a matcher names a tool outside the native tools and the three mod tools.
- Acceptance: offline: the lint passes on the shipped template and fails on a copy with syntax timeout 60 s or with an `mcp__fsbatch__` matcher.
- Source: HOK-30.
- Scope: v1

### HOOK-30 Windows long-command rescue
- Requirement: `bash_long_command.mjs` acts only when `process.platform === 'win32'` and the tool is Bash with a string command; when `length + 3 x count(')` exceeds 6,000 or the command contains `\\`, it writes the command (CRLF -> LF, trailing newline) to `<tmpdir>/claude-bash-commands/<hash>-<pid>.sh`, prunes files older than 1 day and returns `updatedInput` with `command: source '<path>'` (forward slashes, quote-escaped), other input fields kept; otherwise no output; never blocks.
- Acceptance: offline (platform injected): a 9,000-char command and a command with `\\` are rewritten and the script equals the original; a short command and any non-win32 run give no output; manual: on Windows a 9,000-char heredoc command through Claude Code runs unaltered.
- Source: HOK-28, D-46, INV-52.
- Scope: v1

### HOOK-31 Hook tests offline
- Requirement: Hook tests use synthetic transcripts, injected env and state dirs, and real concurrent process spawns for dedupe; identity is tested by role with one model, not a model matrix; no test touches the owner's Claude config or tmp state of real sessions.
- Acceptance: offline: the hook suite runs under `tests/` with a temp `TMPDIR` and temp `CLAUDE_CONFIG_DIR` and passes; a grep gate finds no real home path in the tests.
- Source: HOK-34, INV-57.
- Scope: v1

### HOOK-32 Narrow the context guard matcher if measured cost demands
- Source: D-51, HOK-11.
- Scope: later

## M13 ui: Paseo plugins (PANL)

### PANL-01 Plugin layout, manifest and pinned toolchain
- Requirement: The kit ships two Paseo plugins in `plugins/planning-panel` and `plugins/swarm-map` (not installed into projects), each with `paseo-plugin.json` (`id` = directory name, `description`, `requirements.paseo` set to the Paseo version the kit was tested with), `package.json` whose `files` lists only existing entries, two entry files, `shared/` zod contracts, `server/`, `client/`, and dev dependencies pinned to the installed Paseo's toolchain (`@getpaseo/plugin`, react, react-native, `@tanstack/react-query`, zod, typescript, `@types/node`); tsconfig strict, noEmit.
- Acceptance: offline: a test checks id = directory, every `files` entry exists and `@types/node` is present in both; `tsc --noEmit` passes in both plugins; manual: `paseo plugin install` + `paseo plugin ls` show both `running`.
- Source: UI-01, D-102, R-14.
- Scope: v1

### PANL-02 Entry points
- Requirement: Each server entry default-exports `contribute(server)` that registers its handlers and lifecycle subscriptions and returns a disposer unsubscribing every hook; the planning panel's client registers one sidebar surface (project picker + panel), one workspace panel and one command-center item `Open Planning`; the swarm map's client registers surface `swarm` and a sidebar item.
- Acceptance: offline (fake host): the registrations happen with these ids; calling the disposer leaves zero subscriptions; manual: after `paseo plugin reload` the swarm feed shows no duplicate events.
- Source: UI-02, UI-06.
- Scope: v1

### PANL-03 RPC contracts
- Requirement: Every RPC is defined once in `shared/` with `defineRpc({name, input, output})` and zod schemas, used by both `server.handle` and client `useRpc`; names match `^[a-z][a-z0-9._-]*$`: `planning.index`, `planning.board`, `planning.plan`, `planning.file`, `swarm.snapshot`, `swarm.agent-detail`.
- Acceptance: offline: a contract test asserts every name matches the regex and every handler output on fixtures parses with its output schema.
- Source: UI-03, INV-56.
- Scope: v1

### PANL-04 Typed failure envelopes
- Requirement: Every RPC handler of both plugins returns `{ok:true, ...}` or `{ok:false, code, message, directory|null}` and never throws; `planning.*` codes are `no_planning | unreadable | parse_error | not_found | failed`, `swarm.*` codes are `not_found | failed` (recoverable partial snapshot errors stay in the success payload, PANL-43); an untyped error maps to `failed`; the client renders transport error, `ok:false` (`no_planning` as a muted empty state with a hint), loading, empty and filter-empty states.
- Acceptance: offline: `planning.index` in a workspace without `.planning/` returns `{ok:false, code:"no_planning"}`; a handler whose reader throws returns `failed` with the message; a `swarm.snapshot` whose SDK fake throws unexpectedly and a `swarm.agent-detail` whose timeline read fails both return parseable `ok:false` envelopes that the surface and the inspector render.
- Source: UI-04, UI-11, INV-56.
- Scope: v1

### PANL-05 Plugins are read-only observers
- Requirement: Neither plugin sends prompts, spawns, archives, cancels or changes agents, writes files or runs a subprocess; `.planning/` is read with `node:fs` only, so nothing depends on the daemon's PATH; the only client actions are navigation and copy id/path.
- Acceptance: offline: a grep gate over both plugins finds no write/spawn/archive/send SDK call, no fs write API and no `child_process`; manual: the panel works under a daemon whose PATH lacks npm and node.
- Source: UI-55, UI-61 (lesson), D-101, INV-56.
- Scope: v1

### PANL-06 React Native primitives, theme text colours
- Requirement: Client code uses only React Native primitives and host components from `@getpaseo/plugin/client/react-native` (no DOM elements, no SVG, no `document`); text colours come only from `theme.colors`; fixed hues only for decorative dots, rings and glows; progress rings are drawn without SVG.
- Acceptance: offline: a lint/grep gate over `client/` finds no `<div`, `<svg`, `document.` and no literal colour in a `Text` style.
- Source: UI-08, UI-47.
- Scope: v1

### PANL-07 Polling with cheap server work
- Requirement: Plugins poll (no push): `swarm.snapshot` every 1 s, `swarm.agent-detail` every 1.5 s while an agent is selected, `planning.*` lists every 5 s with server results cached by file mtime; planning queries keep previous data and show `Reconnecting` on refetch error; the swarm surface shows `offline` and `Snapshot failed: <msg>`; both recover after a daemon restart without a reload.
- Acceptance: offline: two `planning.index` calls with unchanged mtimes read no file body the second time; manual: stopping and restarting the daemon shows the failure states and then recovers.
- Source: UI-07, INV-56.
- Scope: v1

### PANL-08 Plugin docs describe `ph` only
- Requirement: Each plugin README gives the operator steps (`npm install`, typecheck by `node node_modules/typescript/bin/tsc --noEmit`, `paseo plugin install|reload|ls|logs`, `pluginsEnabled` set by `kit machine apply --enable-paseo-plugins`) and describes agents, labels and titles as stamped by `ph`; no doc or comment references `paseo_tool.py`, `paseo.md`, `paseo.sh`, temp-dir runs or a preview/sim harness.
- Acceptance: offline: a doc lint finds no reference to a file absent from the repo and none of the listed names.
- Source: UI-09, UI-58, D-99, D-104.
- Scope: v1

### PANL-09 Enabling only by explicit machine opt-in
- Requirement: The plugins are enabled only by `kit machine apply --enable-paseo-plugins` (M2): it sets `pluginsEnabled: true`, registers each plugin as `{source:'directory', path:<kit>/plugins/<id>, enabled:true}`, keeps a user entry that points elsewhere (reported `conflict Paseo plugin <id>: user entry kept`), installs dependencies when `node_modules` is missing, and prints `paseo plugin reload <id>` (MACH-15 owns the step); without the flag `pluginsEnabled` and `plugins` stay JSON-equal and no npm or plugin install runs, while the other machine steps proceed; no Backlog plugin, Backlog CLI pin or Backlog check ships.
- Acceptance: offline (fixture Paseo config needing a provider-policy update): apply without the flag makes the provider change, leaves `pluginsEnabled` and `plugins` JSON-equal and calls no fake npm; with the flag both entries are added and a user entry pointing elsewhere is kept with the conflict line.
- Source: INS-47, UI-79, HIS-77, D-96, MACH-15.
- Scope: v1

### PANL-10 Paseo SDK and icon dependencies re-verified
- Requirement: The SDK calls and fields the plugins use (`agents.list`, `agents.ref().timeline.refetch`, `agents.ref().refresh`, `workspaces.ref().current/refresh/directory`, client `workspaces.list`, the listed agent fields, timeline item types and lifecycle events) and every lucide icon name are checked against the installed Paseo by a smoke script.
- Acceptance: manual: the smoke script against a live daemon calls each method once and asserts the fields exist, and resolves every icon name used; it is re-run on each Paseo upgrade.
- Source: UI-05, UI-52, R-14.
- Scope: v1

### PANL-11 Workspace directory resolution
- Requirement: Every `planning.*` RPC takes `{workspaceId}` and resolves the directory as `current() ?? await refresh()`, then `workspaceDirectory ?? directory`, else `Workspace <id> has no directory`; failures return the envelope with the directory resolved so far.
- Acceptance: offline (fake SDK): an unknown workspace id returns `ok:false` with the message and never throws.
- Source: UI-62.
- Scope: v1

### PANL-12 `.planning/` index
- Requirement: `planning.index` finds `<workspace>/.planning` (absence -> `no_planning`), walks it without following symlinks, with a cap of 5,000 files, and indexes every file by its relative `/` path with kind (by GSD filename) and mtime; frontmatter is read from the first 4,096 bytes and, when the closing `---` is not there, onward up to 64 KiB (beyond: that file is `parse_error` `frontmatter over 64 KiB`); files are read in batches of 48; the listing is redone on every poll and only changed mtimes are reparsed. The index carries `scope` `complete | truncated | unreadable` (cap exceeded: `truncated` with the counted total; an unreadable file or directory: `unreadable` naming it).
- Acceptance: offline: a fixture `.planning/` with 200 plan files indexes all with correct kinds and `scope: complete`; a second call with unchanged mtimes rereads nothing; a file added and one deleted between polls are reflected; 5,001 files give `scope: truncated`; frontmatter ending after byte 4,096 parses; an unreadable phase directory gives `scope: unreadable`; a symlink loop is not followed.
- Source: UI-65, UI-64 (analogue), D-96, INV-36.
- Scope: v1

### PANL-13 Paths stay inside `.planning/`
- Requirement: A client-supplied path is resolved inside `<workspace>/.planning/`; an absolute path, a `..` segment or a symlink escaping the folder is refused with `not_found`.
- Acceptance: offline: `planning.file` with `../secret`, an absolute path and a symlink pointing outside each return `not_found` and read nothing outside `.planning/`.
- Source: UI-65, SYNTHESIS M13, INV-56.
- Scope: v1

### PANL-14 Frontmatter parser, tolerant normalization
- Requirement: The server parses frontmatter with the GSD grammar of GSDC-05 (block maps and sequences, flow collections, quoted and plain scalars, `|`/`>` blocks, comments, BOM/CRLF), as the same module or a port proven by GSDC-05's conformance fixtures; nested values (`must_haves.truths/artifacts/key_links`, `key-files.created/modified`, `requires`, `gaps`) reach detail responses intact; a parse error yields `parse_error` with its line for that file only, never a silent field drop; missing optional fields default via `nullish().transform`; other top-level fields are shown as properties (at most 12). The reader adapts to GSD files; GSD templates and method text are not changed for it (D-111).
- Acceptance: offline: the GSDC-05 fixtures (PLAN with nested `must_haves`, SUMMARY with `key-files` and a block scalar, VERIFICATION with `gaps[]`, malformed cases) parse to the same JSON as `ph gsd`; a plan missing optional keys still lists with defaults; one malformed file does not fail the index.
- Source: UI-66, UI-63, GSDC-05, D-111.
- Scope: v1

### PANL-15 Phase and plan board by the GSD status ladder
- Requirement: `planning.board` returns phases with status computed by the same ladder as `ph gsd` (plan/summary counts, verification status, completion; ROADMAP checkboxes carry no authority) and plans per wave with done counts (a plan is done when its SUMMARY exists, per its `status`); the board columns follow the ladder order (empty columns kept), and the per-phase wave progress replaces the dropped run cards; status tones come from an explicit status -> tone map; the board carries the index `scope`, and every percentage is `null` when scope is not `complete`.
- Acceptance: offline: on a fixture `.planning/` with one phase in each ladder state, the board statuses equal the statuses of `ph gsd roadmap analyze`; a phase with 2 of 4 plans summarised in wave 1 shows 2/4; with `scope: truncated` the board shows no percentage.
- Source: UI-74, UI-77, D-96, INV-43, INV-36.
- Scope: v1

### PANL-16 Plan detail
- Requirement: `planning.plan {workspaceId, planId}` returns goal, the tasks of the PLAN's `<task>` elements in order (name, type, files), `must_haves`, wave, dependencies, files touched and plan-level completion from its SUMMARY (absent -> not done; present -> its `status`, e.g. `complete` or `halted`, with the SUMMARY text and `key-files`); per-task completion is not invented: no artifact records it, so tasks carry no done state and no task percentage is shown; the pane has back, copy id, copy path and close; it renders a body only when the returned workspaceId, relative path and plan id all equal the requested ones (previous data kept while loading).
- Acceptance: offline: on artifacts produced by the M9 fixtures, a plan without SUMMARY shows not done, one with a `halted` SUMMARY shows halted, and no task percentage appears; component test: opening plan A then B with B delayed shows the loading state for B, never A's body; switching from the main checkout to a worktree with the same plan id and different content, with the second response delayed, never shows the old body.
- Source: UI-76, UI-81, GSDC-18.
- Scope: v1

### PANL-17 File tree and reader
- Requirement: The Files section builds a tree from relative paths (single-child folder chains merged, natural sort, folder counts, top-level expanded, expand/collapse all, opening a file reveals its ancestors), filters locally by AND-tokens over path and title, and reads a file through `planning.file` with frontmatter properties, markdown body and copy path; the reader applies the same workspaceId + path equality guard as PANL-16.
- Acceptance: offline: `buildTree(["a/b/c.md","a/b/d.md","e.md"])` yields folder `a/b` (2) then `e.md`; filter `plan 03` matches path tokens in any order.
- Source: UI-73, UI-67, UI-81.
- Scope: v1

### PANL-18 Markdown renderer
- Requirement: A library-free renderer supports headings 1-6, paragraphs, fenced code, nested bullet/numbered lists (depth <= 3) with checkboxes, blockquotes, rules and pipe tables; inline code, bold, italic, links and bare http(s) URLs; ids of phases, plans and requirements known in the index become tappable links; Markdown links and code spans holding a path open the in-panel reader when the path, resolved against the containing file's directory (or against the workspace root when it starts with `.planning/`), names an indexed file inside `.planning/` (PANL-13 containment), else stay plain text; only http(s) links open externally, via `openExternalUrl`; text is selectable; no HTML, no images.
- Acceptance: offline: parser unit tests per block type; a known plan id in prose becomes a link, an unknown id stays text; a `javascript:` link does not open; in a plan, `[s](01-01-SUMMARY.md)` opens the summary in the reader, a link to a missing file and `../../secret.md` stay plain text.
- Source: UI-72, UI-65.
- Scope: v1

### PANL-19 Stats tiles
- Requirement: A pure `computeStats(index, nowMs)` gives phase progress, plans per wave, plans with a SUMMARY by `status`, files updated per day over 14 days (from mtimes) and blocked plans (unmet dependency); no task-level count is derived; when the index `scope` is not `complete` every percentage is `null`; the view shows tiles, bars and the day chart.
- Acceptance: offline: a fixture with 2 complete and 3 open phases returns done 2, open 3; a plan depending on an unfinished plan counts as blocked; the same fixture with `scope: truncated` returns null percentages.
- Source: UI-75, INV-36.
- Scope: v1

### PANL-20 Project picker
- Requirement: Workspaces are grouped by project, archiving ones dropped; the representative is the main checkout (`local_checkout` < `directory` < `checkout` < `worktree`, then pinned, then name), with a switcher to the project's worktrees; the 5 most recent projects are kept (MRU) per host and survive surface remounts; the picker shows only with more than one project and searches name and root path by AND-tokens.
- Acceptance: offline: a checkout and a worktree of one project give one entry with 2 workspaces and the checkout as default; the switcher lists the worktree; leaving and returning to the sidebar keeps the selection.
- Source: UI-68, UI-69, D-98.
- Scope: v1

### PANL-21 Workspace panel navigation
- Requirement: The panel has section tabs (Roadmap, Phases, Files); a trail of opened items (select resets, link pushes without duplicate, back pops); split view (list + detail) when not compact and width >= 960, else detail replaces the list with Back; a 30 s tick for relative times; a refresh button with `Live · HH:MM:SS` or `Reconnecting`.
- Acceptance: component test: open A, follow a link to B, Back returns to A; Close in wide layout clears the trail; compact layout shows no split.
- Source: UI-70, UI-78, UI-54.
- Scope: v1

### PANL-22 UI kit primitives
- Requirement: The planning panel carries the kit primitives (`KitProvider/useKit`, text `T`, `Press`, `Section`, `MetaRow`, `Dot`, `Badge`, `ProgressBar`, `SegmentedBar`, `Chip`, `IconButton`, `ActionButton`, `StatePanel`, `withAlpha`), without `AvatarStack`.
- Acceptance: offline: `withAlpha("#fff", 0.5)` -> `rgba(255, 255, 255, 0.500)`; a non-hex input is returned unchanged.
- Source: UI-71.
- Scope: v1

### PANL-23 Format helpers
- Requirement: Shared helpers: `formatDate`, `formatShortDate` (date-only strings as local dates), `formatRelative` (`just now`, `Nm ago`, `Nh ago`, `Nd ago` under 14 days, else a date), `formatClock`, `ago`, `clock`, `tokens` (`?`, `1.5M`, `12k`), `shortModel` (provider stripped, `[1m]` -> ` [1m]`), `baseName`, `clip` (whitespace collapsed, `…`), and title helpers that take the swarm name from the `ph.swarm` label.
- Acceptance: offline: unit tests per helper, including `formatRelative` at 59 s, 60 s, 13 d and 14 d and `shortModel("circle/gpt-6.1-sol[1m]")`.
- Source: UI-77, UI-53.
- Scope: v1

### PANL-24 swarm.snapshot contract
- Requirement: Input `{recentHours >= 0, afterSeq int (-1 first), eventEpoch string|null}`; success output `{ok:true, generatedAt, brains[], standaloneCount, eventEpoch, files[], events[], lastSeq, errors[]}` (failure per PANL-04) with `brains[] = {agent|null, groups:[{name, agents[], wave|null}]}` (`wave` per PANL-61) and `SwarmAgent = {id, title, model, thinking, mode, status, contextPct, usedTokens, maxTokens, rotatePct, attention, parentId, swarm, project, createdAt, updatedAt, turnStartedAt, activity, heldFiles}` (`rotatePct` per PANL-55); no `runs`, `tempDir` or `runMaxAgeHours`.
- Acceptance: offline (fake SDK): every snapshot parses with the schema; a poll with `afterSeq = lastSeq` and the same epoch returns `events: []`; the client cursor reads `lastSeq` and `eventEpoch` only from `ok:true` responses.
- Source: UI-10, D-96, D-97.
- Scope: v1

### PANL-25 swarm.agent-detail
- Requirement: Input `{agentId}`; success output `{ok:true, recent: Activity[] (newest first, no reasoning, max 8), lastCommand: {text, at}|null, lastReply: {text, at}|null}` from the activity cache; an agent never read gets one timeline read; a read error returns `{ok:false, code:'failed', message}` and an unknown agent `{ok:false, code:'not_found', ...}`, both shown in the inspector; the handler never throws.
- Acceptance: offline: an idle agent never read before returns its recent actions after one timeline read; a failing timeline read surfaces its error text.
- Source: UI-11.
- Scope: v1

### PANL-26 Agent listing and mapping
- Requirement: Agents are listed with `includeArchived:false`, statuses initializing/idle/running/error, `created_at asc`, 200 per page, at most 5 pages; entries with `archivedAt` are skipped; title falls back to the id's first 8 chars; `model = provider/model`; `contextPct` only when used and max are known and max > 0; attention = `permission` when a permission is pending, else the attention reason when attention is required.
- Acceptance: offline: 3 live, 1 archived and 1 closed agent give exactly the 3 live ones; an agent without usage has `contextPct: null`.
- Source: UI-12.
- Scope: v1

### PANL-27 Brains, closed parents and orphans
- Requirement: A subagent links to its brain through label `paseo.parent-agent-id` (written last by `ph`, so a caller label cannot override it); parents missing from the live list are refreshed concurrently and cached 30 s (null results too); a missing, archived or failing parent puts its children in the orphan bucket (`agent: null`); a closed brain with live subagents is drawn asleep as their root; brains with a running member sort first, the orphan bucket last.
- Acceptance: offline: archiving the parent of two live subagents moves them to `agent: null`; a closed parent is drawn as a sleeping brain; a fake caller label `paseo.parent-agent-id=x` on a `ph`-created fixture agent is not what the snapshot uses.
- Source: UI-13, UI-80, D-100, INV-10.
- Scope: v1

### PANL-28 Grouping by the `ph.swarm` label
- Requirement: Subagents of a brain are grouped by the `ph.swarm` label stamped by `ph`; without it the fallback is `swarmName(title)`: `(untitled)` for empty, the prefix before a `#n`/`n` counter suffix, else the text before the first `:`, else the first word; grouping never depends on the 60-char title cut.
- Acceptance: offline: two agents with label `ph.swarm=planners` and different long titles share one group; label-less titles `Fix A`, `Fix B` share `Fix`; `review #3` groups as `review`.
- Source: UI-33, UI-80, D-100.
- Scope: v1

### PANL-29 Standalone agents counted, not drawn
- Requirement: Agents with no parent and no children are not drawn; their count (taken before the recent filter) is `standaloneCount` and the footer says `N agents without parent or subagents are not drawn`.
- Acceptance: offline: one lone agent increments `standaloneCount` and appears in no brain.
- Source: UI-14, D-103.
- Scope: v1

### PANL-30 Active-6h filter
- Requirement: With `recentHours > 0` a brain is kept only when a member is running/initializing, has a pending permission or was updated within `recentHours`; the client toggle `Active 6h` (default on) sends 6, off sends 0; an empty result shows `No swarm is flying right now` with a hint to turn the filter off.
- Acceptance: offline: a brain idle for 7 h is dropped with `recentHours: 6` and kept with 0.
- Source: UI-15.
- Scope: v1

### PANL-31 Activity eligibility and refresh cadence
- Requirement: Only drawn agents that are live (running, initializing, permission pending) or updated within the idle window (6 h) get timeline reads; per agent: no cache -> read; cached error -> read when `updatedAt`/status changed or after 30 s; live -> at most every 1 s; otherwise only when `updatedAt` or status changed; at most 8 reads in parallel, one in flight per agent; cache entries of agents that left the list are deleted.
- Acceptance: offline (fake SDK with a read counter): 25 old idle brains cost no reads after the first poll; a running agent is read about once per second; concurrent polls never issue two reads of one agent.
- Source: UI-16, INV-56.
- Scope: v1

### PANL-32 Timeline tail reading
- Requirement: The first read of an agent fetches the last 8 timeline items, later reads the last 4 (`direction: tail`, projected); items merge into the cache (recent by id excluding think, newest 8; last command and reply updated when not older; seen ids capped at 300); a failed read keeps the previous entry and adds `timeline <id8>: <message>` to `errors` only when it differs from the agent's previous error.
- Acceptance: offline: a timeline call failing on 5 polls yields its error string once; cached activity is still returned.
- Source: UI-17.
- Scope: v1

### PANL-33 Timeline item to activity kind
- Requirement: Kinds `read|edit|write|shell|search|fetch|agent|plan|think|command|reply|tool`: tool-call details read/edit/write keep their kind and file, shell -> shell, search -> search (`web: <query>` for web search), fetch -> fetch (URL without scheme), sub-agent -> agent, worktree setup -> shell `worktree <branch>`, plan -> plan (first line), plain text -> tool, unknown -> name heuristics (PANL-34); user message -> command, assistant message -> reply, reasoning -> think `thinking`, compaction -> think `compacting context`, todo -> plan, error -> tool with status failed; other item types are not drawn. The mapping is re-verified against the installed Paseo timeline schema.
- Acceptance: offline: a table test feeds one item per type and asserts kind, label and files.
- Source: UI-18, R-14.
- Scope: v1

### PANL-34 Tool-name heuristics on the kit's tools
- Requirement: Unknown-type tool calls are classified by name and input: `mcp__<server>__<tool>` shown as `server: tool`; command present or shell-like name -> shell; batch paths (`files[].path`, `ranges[].path`, `paths[]`, distinct non-blank strings in order) with label `N files: A, B, ...`, kind by tool before any generic rule: native `Write` and `mcp__harness-files__write_multiple_files` -> write, native `Edit`/`MultiEdit`/`NotebookEdit` and `mcp__harness-files__edit_multiple_files` (replacements, line edits, fixes) -> edit, `mcp__harness-files__read_ranges` -> read; other batch inputs: a `write` name -> write, an `edit` name -> edit, else read; then agent, read, edit, write, search, fetch by name patterns; else tool. The tables cover Claude Code native tools and the three `mcp__harness-files__` tools; no `fsbatch`/`filesystem` names.
- Acceptance: offline: `batchFilePaths` passes the four cases of the old test (ranges; files with a duplicate; paths with null/empty plus files; junk -> []); `mcp__harness-files__write_multiple_files` with two files yields kind write with both files, `edit_multiple_files` yields edit and `read_ranges` read, and the ledger op, activity verb and event text of each use that same kind; a golden fixture of a real `circle-agent` worker timeline gives non-empty `files` for every file-touching call (manual capture, offline replay).
- Source: UI-19, UI-20, HIS-77.
- Scope: v1

### PANL-35 Activity clipping and stable ids
- Requirement: Activity `id` = tool `callId`, or `<itemType>:<seqStart>` for messages; label clipped to 48 chars (whitespace collapsed, `…`), fallback the kind; detail clipped to 300 chars (messages 280); status from the tool, `failed` for errors, else `completed`; files deduped, at most 24.
- Acceptance: offline: a 5,000-char command yields a detail of at most 300 chars ending with `…`; a streaming call keeps its id across reads.
- Source: UI-21.
- Scope: v1

### PANL-36 Shell label shortening
- Requirement: A shell label is the first `&&`/`;`/`||` segment not starting with `cd`, `set` or `export`, with every path replaced by its last segment, clipped to 48 chars.
- Acceptance: offline: `cd C:/x && node tools/build/run.mjs --all` -> `node run.mjs --all`; a quoted Windows path is shortened to its last segment.
- Source: UI-22.
- Scope: v1

### PANL-37 File ledger
- Requirement: An in-memory ledger keyed by lower-case path with `/` keeps per file the last touch `{agentId, op, at}`, the previous touch by another agent and a writers map; an edit/write raises the agent's writer time before the holder check; a touch not newer than the holder's never moves the holder and never emits a handoff; a touch by another agent within 15 min emits a handoff; holds last 5 min, entries are forgotten after 30 min; writers count agents with an edit/write within 15 min of now.
- Acceptance: offline: A then B write `X.md` 1 min apart -> one handoff, writers 2; 20 min apart -> no handoff, writers 1; B's 10:00 write recorded after A's 10:05 write -> writers 2, A stays holder, no handoff.
- Source: UI-23, INV-38.
- Scope: v1

### PANL-38 File holds in the snapshot
- Requirement: `files[]` lists holds whose holder is drawn and whose last touch is within 5 min, newest first, at most 4 per agent, plus every file with writers >= 2 regardless of the cap; each hold has `path, name, op, agentId, at, prevAgentId|null, prevOp|null, writers`; per-agent counts go to `heldFiles`.
- Acceptance: offline: an agent touching 10 files yields 4 holds and `heldFiles: 10`; a conflicted file beyond the 4 is still present.
- Source: UI-24.
- Scope: v1

### PANL-39 Handoff events grouped per tool call
- Requirement: File operations seen on a non-first read are grouped by previous holder (one group per tool call and previous agent); each group emits one `handoff` event (text = basename or `N files: a, b, c, ...`, `path` = first file, `peerId`, `peerOp` = strongest previous op write > edit > read); the client treats previous edit/write followed by edit/write as a write conflict.
- Acceptance: offline: one batch read of 7 files previously touched by one agent yields 1 event with text `7 files: ...`.
- Source: UI-25.
- Scope: v1

### PANL-40 Event log with epoch
- Requirement: The server keeps events in a ring buffer of 500 with a monotone `seq` and an `epoch` (`<pid>-<base36 start time>`) that changes on plugin restart; text clipped to 200; `afterSeq < 0` or another epoch returns the newest 40 events as history, else events with `seq > afterSeq`, at most the newest 200; `lastSeq` is returned every snapshot.
- Acceptance: offline: after a simulated restart the next snapshot has a new epoch and returns history only; 600 events keep the newest 500.
- Source: UI-26.
- Scope: v1

### PANL-41 Lifecycle recording
- Requirement: `agent.created` -> `spawn`, `agent.archived` -> `archive`, `agent.turn_started` -> `command` recorded asynchronously (newest user message of the last 4 items if not older than hook time - 15 s, one retry after 700 ms, else empty text; the hook never blocks), `agent.turn_ended` -> `report`/`failed`/`canceled` with the last assistant text, error message or reason and `stats` (`12 read · 3 edit · 2 shell`), `agent.permission_requested` -> `permission`, `agent.permission_resolved` -> `permission_resolved`.
- Acceptance: offline (fake hooks and timeline): each lifecycle event produces its event kind and text; a user message arriving after the first lookup is caught by the retry; manual: a prompt sent with `ph send` appears as `got prompt: ...` within 2 s.
- Source: UI-27, UI-06.
- Scope: v1

### PANL-42 Tool events on first sight
- Requirement: A tool-kind activity first seen in a tail emits one `tool` event, except on an agent's first read (its existing history emits nothing); the client skips the tool pop when the same activity already produced a handoff.
- Acceptance: offline: a new agent's first poll emits no `tool` events; a later new call emits exactly one.
- Source: UI-28.
- Scope: v1

### PANL-43 Partial failure, honest degradation
- Requirement: Agent listing failures add `agents: <msg>` to `errors` and degrade to an empty list; timeline errors are added per PANL-32; the screen shows the first 3 errors and `Snapshot failed: <msg>` when the RPC fails; the header subtitle is `offline`, `connecting…` or `live · N brains · M swarms`.
- Acceptance: offline: a fake `agents.list` that throws still yields a snapshot with `errors: ["agents: ..."]`.
- Source: UI-34.
- Scope: v1

### PANL-44 Client cursor and epoch handling
- Requirement: The client sends `{recentHours, afterSeq, eventEpoch}` from its cursor (start `{-1, null}`, then `{lastSeq, eventEpoch}`); on the first response or an epoch change the feed is reset and filled with history that is shown but never animated; relative times use the snapshot's `generatedAt`.
- Acceptance: component test: a simulated epoch change clears the feed and refills it without animating history.
- Source: UI-35.
- Scope: v1

### PANL-45 Activity feed
- Requirement: The client keeps at most 80 events newest first, deduped by `seq`, filtered to agents on the map or whose parent is on the map; rows animate only above the live cursor; the header shows `N actions/min` from `tool` events of the last 60 s; row texts per kind (`spawned`, `archived`, `got prompt: ...`, `reported: ...`, `turn failed: ...`, `turn canceled`, `needs permission: ...`, `permission answered`, tool verbs, handoff and conflict texts); a row click selects the agent.
- Acceptance: offline: `eventText` table test per kind; an event of an agent outside every drawn brain never appears.
- Source: UI-37, UI-50.
- Scope: v1

### PANL-46 Layout with stable slots
- Requirement: Brain left, swarm hubs to its right, agents on one ring (<= 10 slots) or two C-shaped rings opening toward the brain; slot capacity rounds up to tiers `[4,6,8,10,12,16,20,24,30,36,48,64,96,128]` then multiples of 32; an agent keeps its slot while it lives, a freed slot cools down 4 s, and a swarm is renumbered only when its tier shrinks; fit-width zoom is clamped to 0.4..1.
- Acceptance: offline: spawning then archiving one agent in a 6-agent swarm leaves the other 5 coordinates unchanged.
- Source: UI-38.
- Scope: v1

### PANL-47 Agent state model
- Requirement: `waiting` when attention is permission; `error` on status or attention error; `working` when running or initializing; else `sleep`; archived and closed agents are never drawn (except a closed brain with live subagents); header counters running / sleep / waiting / error / `ctx >= <rotatePct>%` / `write conflicts` (only when > 0).
- Acceptance: offline: a table test over status and attention combinations for `agentState`.
- Source: UI-39.
- Scope: v1

### PANL-48 Node rendering
- Requirement: Agent nodes show a context ring (warning colour from `rotatePct`), a state glyph by activity kind while running, badges (item, `NEW`, permission, error, `NN%`), a label box with title, activity line and up to 2 file chips (red with a triangle when writers >= 2), accessibility label `<title>, <state>`; hub nodes show agent count, a ring of wave progress (`plansDone/plansTotal`, PANL-61) when linked, else running/agents, state counters and a wave line (`phase <N> wave <k> · <done>/<total> plans` or `unlinked`); brain nodes show `ctx N%`, project, title, state, turn timer, model and counts; the orphan bucket renders `ORPHANS` without a context ring.
- Acceptance: manual: a visual check of running-read, waiting, error, sleeping, ctx above `rotatePct`, a linked hub at 2 of 4 plans (ring 50%), an unlinked hub with 2 of 4 running (ring 50%) and the orphan bucket on the installed Paseo.
- Source: UI-40, UI-41, UI-42, UI-47.
- Scope: v1

### PANL-49 Appearance and ghosts
- Requirement: On first load agent nodes fade in staggered (`min(index*30, 900)` ms), hubs and brains once; an agent seen later springs in with a `NEW` badge for 12 s; a view-filter change appears as boot, without `NEW` and without ghosts; a drawn agent that vanishes plays one ghost for 1.7 s tagged `archived` (archive event this poll) or `gone`.
- Acceptance: manual: reload shows boot fade-in; a spawned agent alone gets `NEW`; archiving a drawn agent shows one `archived` ghost, then nothing.
- Source: UI-36, UI-43.
- Scope: v1

### PANL-50 Animations within fixed budgets
- Requirement: Links are rotated Views (no SVG) with flow dots on running edges; events map to packets, bursts and sparks (command brain->agent, report/failed/canceled agent->brain, spawn sparks, permission toward brain, tool pops at most one per agent per 900 ms, handoff arcs); at most 8 handoff packets per poll (newest kept), at most 60 live effects; nothing animates on the first call; all continuous motion derives from four shared clocks (flow 1.6 s, pulse 2.2 s, spin 9 s, blink 1 s), animating only transform and opacity.
- Acceptance: component test: 30 handoff events in one poll start at most 8 packets, newest kept; with 100 agents the number of looping Animated values is 4.
- Source: UI-44, UI-45, UI-46.
- Scope: v1

### PANL-51 Header, toggles and zoom
- Requirement: The header shows title, status text, stat chips, the `Active 6h` toggle and zoom controls (out, `NN%`, in, fit); manual zoom 0.4..1.6 in steps of 0.1; the canvas is a two-axis scroll view with a scaled inner view.
- Acceptance: component test: zoom in at fit 0.8 goes to 0.9 and shows `90%`.
- Source: UI-48.
- Scope: v1

### PANL-52 Inspector
- Requirement: Clicking a node toggles selection; a vanished selection closes the inspector; the agent inspector shows state, turn timer, model, thinking, mode, `ctx N% · used/max`, short id, age, the current path or command, LAST PROMPT and LAST REPLY from `swarm.agent-detail`, files held and recent actions; the swarm inspector shows a status bar, counts and selectable agent rows; a selected brain shows as an agent.
- Acceptance: component test: selecting an agent, closing by X, and pressing the same node twice each close the inspector as specified.
- Source: UI-49.
- Scope: v1

### PANL-53 Semantic colours and legend
- Requirement: `statusWarning` is reserved for permission and the context threshold, `statusDanger` for errors and write conflicts, `statusSuccess` for running work and reports; decorative fixed hues mark activity kinds; a legend lists every icon and colour meaning.
- Acceptance: offline: a test asserts each palette entry used for text comes from `theme.colors` and the legend covers every icon used.
- Source: UI-52.
- Scope: v1

### PANL-54 Compact layout and empty states
- Requirement: With `layout.compact` the canvas (min height 420) stacks above the panel in one scroll view; otherwise canvas plus a 380 px side panel; the empty map shows `No swarm is flying right now`; the panel hint shows while nothing is selected.
- Acceptance: component test: `compact: true` renders no horizontal split.
- Source: UI-54.
- Scope: v1

### PANL-55 Context threshold from the kit's settings
- Requirement: Each `SwarmAgent` carries `rotatePct` = the rotate threshold `ph context` uses for `ROTATE` (PHCL-16; key and default owned by M3/M5), resolved through the shared config loader of the project holding the agent's cwd (that project's installed defaults plus its overlay); an agent outside a kit project gets the value of the kit defaults shipped beside the plugin; ring colour, header chip and `ph context` therefore agree per agent; no threshold constant exists in client code.
- Acceptance: offline: two installed fixture projects with different overlay thresholds, and a source kit whose defaults differ from both installed defaults: each agent's `rotatePct` equals the default N `ph context` resolves in its project; an agent with a non-kit cwd gets the source-kit value; a grep finds no `ROTATE_PCT` constant.
- Source: UI-56, D-97, PHCL-16.
- Scope: v1

### PANL-56 Scale caps as named constants
- Requirement: Every limit is a named constant (pages 5 x 200 agents, 8 parallel reads, tail 8/4, seen ids 300, recent 8, events 500/40/200, holds 4 per agent, files 24 per activity, feed 80, effects 60, handoff packets 8 per poll, parent cache 30 s); a snapshot for 100 fake agents stays within the caps and under 150 KB.
- Acceptance: offline: a load test with a fake SDK of 100 agents asserts each cap and a serialized snapshot under 150 KB; manual: the first and steady-state poll times on the installed Paseo are recorded.
- Source: UI-57.
- Scope: v1

### PANL-57 Unit tests of the pure modules
- Requirement: The kit test suite covers `describeItem`, `batchFilePaths`, `FileLedger`, `swarmName`, slot assignment, `EventLog`, the frontmatter parser, the markdown parser, `buildTree`, `computeStats`, `withAlpha` and the format helpers, offline.
- Acceptance: offline: the suite runs each named module's tests with node:test and they pass.
- Source: UI-59, INV-57.
- Scope: v1

### PANL-58 `.planning` panel notifications from lifecycle hooks
- Source: UI-06 (optional for the panel).
- Scope: later

### PANL-59 Link swarm hubs to `.planning` waves on the map
- Source: D-96, UI-41.
- Scope: withdrawn — D-96 makes it v1; replaced by PANL-61.

### PANL-60 Ledger ingestion on every read
- Requirement: Every timeline read of an agent, the first included, records into the file ledger every path currently available on each file-operation activity (by callId), independently of seen-id, tool-event and handoff suppression; a call first seen without paths and later with paths under the same callId adds its paths then; the first read seeds holds and writer counts without emitting `tool` or `handoff` events; ingesting the same touch again is a no-op.
- Acceptance: offline: a call observed first with no input paths and then with two paths under the same callId yields holds for both and a write conflict with another agent's earlier write, with exactly one `tool` event in total; an agent's first read containing three past writes shows them as holds and emits no events.
- Source: UI-17, UI-23, UI-25, UI-28.
- Scope: v1

### PANL-61 Swarm hubs linked to `.planning` wave progress
- Requirement: A swarm group whose agents carry `harness.run=<runId>` (PCLI-08) is linked read-only to planning artifacts: the server reads `<project>/_workspace/_runs/<runId>/run.json` and `args.json` (project = the agent's Paseo workspace directory) and, when the args name a phase directory (`phaseDir`, as the GSD workflows take it) inside that project's `.planning/phases/` and optionally a `wave`, gives the group `wave: {phase, wave|null, plansDone, plansTotal, scope}` computed from that phase's plans and SUMMARY files as in PANL-15 (null counts unless scope is complete); a group without the label, with a missing or unreadable run directory, or without a phase link gets `wave: null` and is drawn `unlinked`; no title parsing and no temp-dir scan; reads are cached by mtime as in PANL-12.
- Acceptance: offline: fake agents labelled `harness.run=wf_x` and a fixture project whose `_workspace/_runs/wf_x/args.json` is `{"phaseDir": ".planning/phases/02-api", "wave": 1}` with 2 of 4 wave-1 plans summarised give `wave: {phase: "02", wave: 1, plansDone: 2, plansTotal: 4, scope: "complete"}`; a group without `harness.run` and one whose run directory is missing give `wave: null`.
- Source: D-96, UI-41, UI-29, UI-32, UI-51, PCLI-08.
- Scope: v1

## Out of Scope

| Item | Reason |
| --- | --- |
| 14 filesystem-compat tools, directory-walk permission planning, `read_media_file` | native Read/Glob/Grep/Bash cover them (S-04, D-39, D-42) |
| Legacy MCP servers `mcp_fs_batch`, `mcp_fs_proxy` | non-Claude adapters dropped (S-01) |
| `subagent_file_tools.mjs` stub, `mcp__fsbatch__`/`mcp__filesystem__` vocabulary, PID/mtime claim recovery | from-scratch kit (HOK-25, HOK-13, S-06) |
| A kit syntax checker for any language | adapter supplies checkers (D-45, D-110) |
| Backlog plugin, Backlog CLI runner and pin, temp-dir queue/review runs and run cards, preview/sim harness | owner drop of Backlog (S-07), `paseo_tool.py` absent (S-19), D-99 |
| Write actions in the panels | read-only plus copy (D-101) |

## Traceability

| behavior | requirement(s) |
| --- | --- |
| FIL-01 | FTOL-04, FTOL-07 |
| FIL-02 | FTOL-01 |
| FIL-03 | FTOL-02, FTOL-03 |
| FIL-04 | FTOL-04 |
| FIL-05 | FTOL-05 |
| FIL-06 | FTOL-06 |
| FIL-07 | FTOL-07 |
| FIL-08 | FTOL-08 |
| FIL-09 | FTOL-09 |
| FIL-10 | FTOL-08 (directory-walk planning dropped, S-04) |
| FIL-11 | FTOL-40 |
| FIL-12 | FTOL-14 |
| FIL-13 | FTOL-15 |
| FIL-14 | FTOL-11 |
| FIL-15 | FTOL-12 |
| FIL-16 | FTOL-13 |
| FIL-17 | FTOL-16 |
| FIL-18 | FTOL-17 |
| FIL-19 | FTOL-18 |
| FIL-20 | FTOL-19 |
| FIL-21 | FTOL-20, FTOL-09 |
| FIL-22 | FTOL-21 |
| FIL-23 | FTOL-22 |
| FIL-24 | FTOL-24 |
| FIL-25 | FTOL-25 |
| FIL-26 | FTOL-23 |
| FIL-27 | FTOL-26 |
| FIL-28 | FTOL-27 |
| FIL-29 | FTOL-28 |
| FIL-30 | FTOL-29, FTOL-24, FTOL-41 (later) |
| FIL-31 | FTOL-30, FTOL-42 (later) |
| FIL-32 | FTOL-31 |
| FIL-33 | FTOL-32 |
| FIL-34 | FTOL-28 |
| FIL-35 | FTOL-33 |
| FIL-36 | FTOL-34 |
| FIL-37 | FTOL-35 |
| FIL-38 | FTOL-36 |
| FIL-39 | FTOL-37 |
| FIL-40 | not a requirement: dropped (S-04, D-39); lessons in FTOL-22, FTOL-25; absence asserted by FTOL-01 |
| FIL-41 | not a requirement: dropped (S-04); terse-reply lesson in FTOL-28 |
| FIL-42 | not a requirement: dropped (S-04); absence asserted by FTOL-01 |
| FIL-43 | not a requirement: dropped (D-42); native Read guidance in FTOL-24, FTOL-39; guard is FTOL-43 (later) |
| FIL-44 | not a requirement: dropped (non-Claude adapter, S-01); malformed-input lesson in FTOL-02 |
| FIL-45 | not a requirement: dropped (S-01); its lessons are FTOL-13, FTOL-18, FTOL-19, FTOL-22, FTOL-24, FTOL-28 |
| FIL-46 | FTOL-38 |
| FIL-47 | FTOL-01 |
| FIL-48 | not a requirement here: activation belongs to M1 `kit install --enable-plugin` (D-02, D-12); the mod-side minimum version is FTOL-04 |
| FIL-49 | FTOL-39 |
| FIL-50 | FTOL-02 |
| HIS-05 | FTOL-22, FTOL-23, FTOL-24, FTOL-13 |
| HIS-06 | FTOL-31, FTOL-32, FTOL-34, FTOL-11, FTOL-16 |
| HIS-07 | FTOL-33 |
| HIS-08 | FTOL-01, FTOL-39 |
| HIS-09 | FTOL-03 |
| HIS-91 | FTOL-27, FTOL-28 |
| HOK-01 | HOOK-01 |
| HOK-02 | HOOK-02, HOOK-03 |
| HOK-03 | HOOK-06 |
| HOK-04 | HOOK-07 |
| HOK-05 | HOOK-08 |
| HOK-06 | HOOK-09 |
| HOK-07 | HOOK-09 |
| HOK-08 | HOOK-10 |
| HOK-09 | HOOK-05, HOOK-04 |
| HOK-10 | HOOK-11 |
| HOK-11 | HOOK-12, HOOK-32 (later) |
| HOK-12 | HOOK-10 |
| HOK-13 | HOOK-13 |
| HOK-14 | HOOK-14 |
| HOK-15 | HOOK-15 |
| HOK-16 | HOOK-16 |
| HOK-17 | HOOK-17 |
| HOK-18 | HOOK-18 |
| HOK-19 | HOOK-19 |
| HOK-20 | HOOK-20 |
| HOK-21 | HOOK-21, HOOK-05 |
| HOK-22 | HOOK-22 |
| HOK-23 | HOOK-23 |
| HOK-24 | HOOK-24 |
| HOK-25 | HOOK-02 (stub not shipped), FTOL-39 |
| HOK-26 | HOOK-26 |
| HOK-27 | HOOK-27, HOOK-28 |
| HOK-28 | HOOK-30 |
| HOK-29 | HOOK-03 |
| HOK-30 | HOOK-29, HOOK-01, HOOK-27 |
| HOK-31 | HOOK-04 |
| HOK-32 | HOOK-25 |
| HOK-33 | not a requirement: conflict resolved by D-06; the deny lists are M2/M3 data; identity checks are HOOK-06 |
| HOK-34 | HOOK-31 |
| HOK-35 | HOOK-20, HOOK-21 |
| HOK-36 | HOOK-09 |
| HOK-37 | HOOK-04 |
| HIS-04 | HOOK-26, HOOK-28 |
| HIS-10 | HOOK-06 |
| HIS-11 | HOOK-11 |
| UI-01 | PANL-01 |
| UI-02 | PANL-02 |
| UI-03 | PANL-03 |
| UI-04 | PANL-04 |
| UI-05 | PANL-10 |
| UI-06 | PANL-41, PANL-02, PANL-58 (later) |
| UI-07 | PANL-07 |
| UI-08 | PANL-06 |
| UI-09 | PANL-08 |
| UI-10 | PANL-24 |
| UI-11 | PANL-25, PANL-04 |
| UI-12 | PANL-26 |
| UI-13 | PANL-27 |
| UI-14 | PANL-29 |
| UI-15 | PANL-30 |
| UI-16 | PANL-31 |
| UI-17 | PANL-32, PANL-60 |
| UI-18 | PANL-33 |
| UI-19 | PANL-34 |
| UI-20 | PANL-34 |
| UI-21 | PANL-35 |
| UI-22 | PANL-36 |
| UI-23 | PANL-37 |
| UI-24 | PANL-38 |
| UI-25 | PANL-39, PANL-60 |
| UI-26 | PANL-40 |
| UI-27 | PANL-41 |
| UI-28 | PANL-42, PANL-60 |
| UI-29 | not a requirement: dropped (D-96, S-19); replaced by `.planning` wave progress in PANL-15 and the hub linkage PANL-61 |
| UI-30 | not a requirement: dropped with UI-29 (D-96) |
| UI-31 | not a requirement: dropped with UI-29 (D-96); the regex bug goes with the code |
| UI-32 | not a requirement: dropped with UI-29 (D-96); the new wave association is PANL-61 |
| UI-33 | PANL-28 |
| UI-34 | PANL-43 |
| UI-35 | PANL-44 |
| UI-36 | PANL-49 |
| UI-37 | PANL-45 |
| UI-38 | PANL-46 |
| UI-39 | PANL-47 |
| UI-40 | PANL-48 |
| UI-41 | PANL-48, PANL-61 |
| UI-42 | PANL-48 |
| UI-43 | PANL-49 |
| UI-44 | PANL-50 |
| UI-45 | PANL-50 |
| UI-46 | PANL-50 |
| UI-47 | PANL-48, PANL-06 |
| UI-48 | PANL-51 |
| UI-49 | PANL-52 |
| UI-50 | PANL-45 |
| UI-51 | not a requirement: dropped (D-96); wave progress is PANL-15 and PANL-61 |
| UI-52 | PANL-53, PANL-10 |
| UI-53 | PANL-23 |
| UI-54 | PANL-54, PANL-21 |
| UI-55 | PANL-05 |
| UI-56 | PANL-55 |
| UI-57 | PANL-56 |
| UI-58 | PANL-08 |
| UI-59 | PANL-57 |
| UI-60 | not a requirement: Backlog plugin dropped (S-07, D-96); its reusable parts are PANL-11..PANL-23 |
| UI-61 | not a requirement: dropped (S-07); no-PATH lesson in PANL-05 |
| UI-62 | PANL-11 |
| UI-63 | PANL-14 |
| UI-64 | not a requirement: dropped (S-07); mtime cache analogue in PANL-12 |
| UI-65 | PANL-12, PANL-13 |
| UI-66 | PANL-14 |
| UI-67 | PANL-17 (client filter and natural sort kept; CLI search dropped) |
| UI-68 | PANL-20 |
| UI-69 | PANL-20 |
| UI-70 | PANL-21 |
| UI-71 | PANL-22 |
| UI-72 | PANL-18 |
| UI-73 | PANL-17 |
| UI-74 | PANL-15 |
| UI-75 | PANL-19 |
| UI-76 | PANL-16 |
| UI-77 | PANL-23, PANL-15 |
| UI-78 | PANL-21 |
| UI-79 | PANL-09 (opt-in kept, Backlog pin dropped) |
| UI-80 | PANL-28, PANL-27 |
| UI-81 | PANL-16, PANL-17 |
| INS-47 | PANL-09 |
| HIS-77 | PANL-34, PANL-09 |

## Counts

| module | v1 requirements | later items | withdrawn | behaviors traced | not a requirement |
| --- | --- | --- | --- | --- | --- |
| M7 files (FTOL) | 40 | 3 | 0 | 56 | 7 |
| M8 hooks (HOOK) | 31 | 1 | 0 | 40 | 1 |
| M13 ui (PANL) | 59 | 1 | 1 | 83 | 8 |
| total | 130 | 5 | 1 | 179 | 16 |

## Revision log r1

| finding ID | accepted / rejected | what changed (requirement IDs) or why rejected |
| --- | --- | --- |
| SR-TLS-01 | accepted | Verified against the ui map invariant "record file touches on every timeline read". New PANL-60 (ledger ingestion on every read, first read seeds holds without events); UI-17, UI-25, UI-28 rows updated. |
| SR-TLS-02 | accepted | INV-54 applies wherever the kit restores files. FTOL-27: restored files get a later whole-second mtime, failure reported as `ROLLBACK INCOMPLETE`; scratch-git acceptance added. |
| SR-TLS-03 | accepted | GSDC-05 defines the nested grammar. PANL-14 now uses the GSDC-05 grammar and conformance fixtures, keeps nested values, errors with line; D-111 stated (no template changes). |
| SR-TLS-04 | accepted | PLAN tasks are XML `<task>` (GSDC-18); no artifact records per-task completion. PANL-16 shows tasks without done state and plan completion from SUMMARY `status` (incl. `halted`); PANL-19 counts plans by SUMMARY, no task count. |
| SR-TLS-05 | accepted | UI-72 asks for tappable file paths. PANL-18: local path links open the in-panel reader with PANL-13 containment; acceptance adds valid, missing and escaping links. |
| SR-TLS-06 | accepted | Fix-only calls carry no paths in their input. HOOK-18 and HOOK-26 take targets also from the `edited <abs>`/`wrote <abs>` result lines (FTOL-26/FTOL-28 contract); a Post target without Pre status is reported marked `(not checked before this edit)`; hooks never read M7 state. |
| SR-TLS-07 | accepted | FTOL-05: manifest structure required, the trusted set (backend entry, files modules, config loader and imports, defaults) must be listed, no source-trust fallback when a manifest exists, cache revalidated by size/mtime; negative tests added. |
| SR-TLS-08 | accepted | FTOL-35 acceptance rewritten with byte-state outcomes for changed, moved, ambiguous, foreign/missing/out-of-read tags, atomic vs non-atomic siblings and the retry against the new tag. |
| SR-TLS-09 | accepted | FTOL-10 rewritten as a compatibility check in the owner's actual mode; refusals keep the FTOL-08 fail-closed text with native fallback; changing another tool's permission setting is an owner action (INV-05); offline ask/deny test with byte-identical settings. |
| SR-TLS-10 | accepted | PANL-55: `rotatePct` per agent, resolved by the shared loader of the agent's project, equal to the value `ph context` uses (PHCL-16); PANL-24 moves it into `SwarmAgent`. Note for the leader: PHCL-16 ships the rotate threshold at 50 while `context_guard.start_pct` (HOOK-11, the main-session compaction reminder) is 60; these are two settings, and whether CONF merges them is for the M3/M5 writers; the panel follows whatever the loader resolves. |
| SR-TLS-11 | accepted | D-96 places wave progress in the trimmed swarm map. New v1 PANL-61 (hub linkage via `harness.run` label and run `args.json` `phaseDir`/`wave`, `unlinked` otherwise); PANL-48 hub ring uses it; PANL-59 withdrawn; UI-29, UI-32, UI-41, UI-51 rows updated. |
| SR-TLS-12 | accepted | FIL-10 checks the first existing parent for every writable target. FTOL-08 now requires the parent Write check for existing files too; acceptance adds a denied parent on an existing-file edit. |
| SR-TLS-13 | accepted | D-41 removed `INLINE_MAX_CHARS`, so the `< 500000` bound in CONF-06 is stale. FTOL-23 names M3 as the one validator carrying `replyMaxChars <= 40,000`, with 40,000/40,001 boundary tests; CONF-06 (platform.md) needs the matching change, outside this file. |
| SR-TLS-14 | accepted | INV-56 requires typed envelopes. PANL-04 covers both plugins (`swarm.*` codes `not_found`, `failed`); PANL-24, PANL-25 return envelopes; UI-11 row adds PANL-04. |
| SR-TLS-15 | accepted | MACH-15 keeps only `pluginsEnabled`/`plugins` unchanged without the flag. PANL-09 narrowed to those keys and no npm/plugin install; acceptance uses a fixture needing a provider update. |
| SR-TLS-16 | accepted | PANL-34 maps by tool first: write tools -> write, edit tools -> edit, `read_ranges` -> read, generic rule after; acceptance checks ledger op, verb and event text agree. |
| SR-TLS-17 | accepted | PANL-12: cap 5,000 files, `scope` complete/truncated/unreadable, frontmatter read past 4,096 bytes up to 64 KiB, listing redone each poll; PANL-15, PANL-19 withhold percentages when scope is not complete (INV-36). |
| SR-TLS-18 | accepted | HOOK-27 cache key = tree root, target path, checker identity (argv, timeout, config hash) and content; only pass/fail cached; cross-worktree and changed-config tests added. |
| SR-TLS-19 | accepted | PANL-16 and PANL-17 guard on workspaceId + relative path (+ plan id); acceptance adds main -> worktree with the same plan id. |
| SR-TLS-20 | accepted | ADPT-06 now exists (`{argv, timeout_s, max_parallel}`, `file:line:col: message`, non-zero on error). HOOK-26/27/28 reference it and define argv without shell, cwd = tree root, path as one argument, pass/fail/infrastructure-error outcomes, per-run timeout with process-tree kill; tests for spaces, missing executable, hang, no-diagnostic exit. |
| SR-TLS-21 | accepted | FTOL-03 drops the source sentence naming `write_file` as an adapter change and fixes the approved write description in the acceptance. |
| SR-TLS-22 | accepted | HOOK-23 cap raised to three sentences (the reread text is three, its wording changes only with owner review, INV-49); acceptance checks the cap. |
| SR-TLS-23 | accepted | FTOL-07: command length = quoted backend path + fixed overhead (<= 200 chars), independent of payload; acceptance compares 100 KB vs 10-byte writes and a path with spaces and a quote. |
