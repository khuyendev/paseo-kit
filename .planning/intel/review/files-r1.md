# Review r1: files (FIL)

## Verdict

REVISE. 2 blocker, 6 major, 8 minor. The map is unusually complete: the 17-tool registry, ticket protocol, pagination, fix IDs, line-edit tiers, and the legacy-adapter lessons are really in the sources, and the DROP/KEEP split matches the owner decisions (Claude Code only, non-Claude MCP adapters dropped, Paseo/ph orchestration). It cannot be specified from as it stands, because two KEEP contracts are inverted (which failure string the mod returns, and the order path-fixes run in) and several other user-visible rules are wrong or missing.

## Findings

### R1-FIL-01 BLOCKER accuracy FIL-15 outcome strings are tied to the wrong conditions
- Severity: BLOCKER.
- Category: accuracy.
- Map entry: FIL-15.
- Evidence: kit:project/.claude/plugins/harness-files/hooks/register.ts:93-110. `executionStarted` is set only after the post-plan permission loop (line 87), immediately before `--execute`. On a throw: if that flag is set, one `collect` is tried and a result with `text.length < 39000` is returned as `Recovered completed execution receipt`. Otherwise `abandon` runs. `EXECUTION OUTCOME UNKNOWN` is returned only when `executionStarted && started !== false` (abandon throw leaves `started` true). `Not executed; no target changed` is returned only when `executionStarted && started === false` (Bash denied the execute, so the backend never created `.started`). Every failure before that flag, including a pre-stage ask/deny and a deny of the guessed canonical path, is `{deny: cause}` — the permission text, not `Not executed`. register.test.ts:42-46 and :47-51 expect `permission ask|deny`; the `Not executed` / `OUTCOME UNKNOWN` assertions are :52-61, which the map does not cite. A recovered body with length >= 39000 is not returned; `abandon` then sees `.result.json` (`backend.mjs:263`) and the mod reports `OUTCOME UNKNOWN` even though a receipt exists.
- Fix: Rewrite the three outcomes to the flags above, cite register.test.ts:52-61 and :77-82 (drop :47-51 from this entry; that test is FIL-08), and add the >= 39000 fall-through.

### R1-FIL-02 BLOCKER accuracy FIL-29 path-fixes do not run before file entries
- Severity: BLOCKER.
- Category: accuracy.
- Map entry: FIL-29.
- Evidence: kit:project/.agents/harness/files/batch.mjs:388-412. `queue` starts as `[...files]`. A retained file-level failure (`e.edits`, the `{id, path}` form in FIL-35) is `queue.push`ed and applied in the file loop, after every `files` entry. Text fixes and line fixes run immediately inside the fix loop, so they do run before `files`. A path-fix therefore sees text that earlier `files` entries in the same call already changed, and it does not "finish the earlier call" first.
- Fix: State the three orders: text fixes and line fixes in listed order, then `files` entries, then queued `{id, path}` fixes. Keep the within-entry rule (line edits before oldText).

### R1-FIL-03 MAJOR accuracy FIL-21 a changed guess fails as plan changed, not unplanned
- Severity: MAJOR.
- Category: accuracy.
- Map entry: FIL-21.
- Evidence: kit:project/.agents/harness/files/backend.mjs:145-150 adds the unique guess to the stored plan; :176-178 recomputes that plan and throws `permission plan changed (paths, symlinks or retained fixes); nothing executed, retry the call` before the handler. `unplanned or changed target` (`:183`) runs only when the handler touches a path the stored plan did not name. A guess that resolves to a different file between plan and execute changes the check set, so the caller sees `plan changed`.
- Fix: Replace "a changed guess is `unplanned`" with the signature error. Keep `unplanned` for a handler path whose realpath moved without changing the check set.

### R1-FIL-04 MAJOR accuracy FIL-06 empty backend stdout is not File transport failed
- Severity: MAJOR.
- Category: accuracy.
- Map entry: FIL-06.
- Evidence: kit:project/.claude/plugins/harness-files/hooks/register.ts:22-25. `File transport failed` / `incomplete backend output` is thrown only for a non-zero exit or truncated stdout/stderr. Empty stdout with exit 0 falls through to `JSON.parse` and becomes a deny of the parse error. The empty-stdout check is discovery only (`register.ts:14`, `Backend discovery failed`).
- Fix: Split the two checks. Transport: non-zero, truncation, then `protocol !== 1`. Discovery: non-zero, truncation, or empty stdout.

### R1-FIL-05 MAJOR accuracy FIL-10 directory permission walk is overstated
- Severity: MAJOR.
- Category: accuracy.
- Map entry: FIL-10.
- Evidence: kit:project/.agents/harness/files/backend.mjs:152-165. Only `directory_tree` and `search_files` recurse, honor `excludePatterns` (via `excluded`), and skip symlinks. `list_directory_with_sizes` is in the same `if` but every special case is `method !== 'list_directory_with_sizes'`: it does not recurse, does not apply `excludePatterns`, and does plan symlink children. `list_directory` is not in this `if`; it only checks the directory path (`:151`). The 20,000 cap and its message apply to all three. The filesystem handlers match this (`filesystem.mjs:160-174` vs `:219-222`).
- Fix: Restrict the walk sentence to `directory_tree` and `search_files`. Describe `list_directory_with_sizes` as direct children only, symlinks included, `excludePatterns` ignored. Quote the plan error in full, including ` (e.g. ["node_modules", ".git"])` (`backend.mjs:157`).

### R1-FIL-06 MAJOR coverage permission-check payloads for line edits and fixes
- Severity: MAJOR.
- Category: coverage.
- Map entry: FIL-10 (also FIL-08).
- Evidence: kit:project/.agents/harness/files/backend.mjs:127-138 and register.ts:39-41. A line edit has no `oldText`, so both rounds send `Edit` with `old_string: ''` and `new_string` equal to `newText`. A retained text fix uses `fix.oldText ?? (occurrence omitted ? retained.cand : undefined) ?? retained.oldText` and `fix.newText ?? retained.newText`: a `{id}` suggestion is checked against the suggested span (`cand`), not the original `oldText`; an occurrence fix is checked against the original `oldText`. A retained line failure stores `newText` under `.line` (`batch.mjs:346`) and has no top-level `oldText`/`newText`/`edits`, so the plan is `Edit` with both strings empty. File-level fixes (`retained.edits`) do plan each retained edit's real old/new, and only when `fix.path ?? retained.abs ?? retained.path` is set. A `{id}` fix with no `path` produces no pre-stage check (`register.ts:41`).
- Fix: Add those four payload rules to FIL-10. Do not describe every fix as "retained or overriding old/new text".

### R1-FIL-07 MAJOR accuracy FIL-30 empty oldText never reaches the quoted handler message on the mod path
- Severity: MAJOR.
- Category: accuracy.
- Map entry: FIL-30.
- Evidence: kit:project/.agents/harness/files/batch.mjs:36 (`oldText` `minLength: 1`) and backend.mjs:104. `stage` calls `validateArguments` (`backend.mjs:239`) before the handler. An empty string fails as `edit_multiple_files.files[0].edits[0].oldText has an invalid string value`. The message `oldText is empty (for a line edit give from/to or after...)` (`batch.mjs:266`) is reached only when the handler is called directly, which is the legacy stdio server (`mcp/mcp_fs_batch.mjs:27-28`, test_fs_batch.mjs:69-71). The no-hang rule (SIDE-2/3) is real for that long-lived process; it is not the mod's error text.
- Fix: Give both messages and which path emits them. Add the validation templates the mod actually returns: `${label}.${key} is required`, `must be an object`, `must be a nonempty array`, `must be a valid integer`, `has an invalid ${type} value`, `must be one of ...`, `unknown file method`, `file arguments must be an object`, `invalid transport identifier` (backend) versus `Invalid backend ticket` (mod, register.ts:18), `session ID required`, `absolute event-frame cwd required`, `backend cwd must be absolute`, `unknown transport action`, `unknown ticket action`, `path must be a nonempty string` (filesystem.mjs:30).

### R1-FIL-08 MAJOR coverage FIL-22 `to` past the end is clamped, not an error
- Severity: MAJOR.
- Category: coverage.
- Map entry: FIL-22.
- Evidence: kit:project/.agents/harness/files/read_limits.mjs:59-60 and batch.mjs:479-487. `to` becomes `min(file length, requested to)`, and only `from > total` is `line N is past the end`. A request for lines 2-9 of a 4-line file is a successful entry headed `lines 2-4 of 4`, and a tag is issued when the clamped span is fully shown. `from` and `to` are independently optional: omitted `from` is 1, omitted `to` is the last line (`batch.mjs:479`, `read_limits.mjs:59`).
- Fix: State the clamp, the past-end rule (from only), and that either bound may be omitted alone.

### R1-FIL-09 MINOR accuracy user-visible edit text is not ASCII
- Severity: MINOR.
- Category: accuracy.
- Map entry: FIL-31, FIL-34, FIL-37.
- Evidence: kit:project/.agents/harness/files/batch.mjs:262, :318, :106. Failure lines use `→` (U+2192), not `->`. The line-number error says `to ≥ from`. Over-long quotes use `…` (U+2026), and `quote()` JSON-stringifies the slice. The map writes `->`, `>=`, and a bare cut-at-60.
- Fix: Quote those three characters as the files emit them, and say the 60-character cut is a JSON string plus `…`.

### R1-FIL-10 MINOR accuracy FIL-18 loader message has a prefix
- Severity: MINOR.
- Category: accuracy.
- Map entry: FIL-18.
- Evidence: kit:project/.agents/harness/config.mjs:49 and :60. The thrown text is `invalid harness config typo_key: unknown key`. The test (`backend.test.mjs:286`) only matches the substring `typo_key: unknown key`. `read_limits` is merged field-wise (`config.mjs:30`, `MERGED_KEYS` at :12), which FIL-26 does say.
- Fix: Quote the full `invalid harness config <key>: <message>` form.

### R1-FIL-11 MINOR accuracy a finished ticket's second --execute still succeeds
- Severity: MINOR.
- Category: accuracy.
- Map entry: FIL-14.
- Evidence: kit:project/.agents/harness/files/backend.mjs:285 and :297-298. If `.result.json` exists, `runTicket` returns before any mutation, and the CLI still prints `harness-files ticket completed` and exits 0. The map says "returns silently", which is true inside `runTicket` but not at the process boundary the mod checks.
- Fix: Say the second `--execute` is a successful no-op (sentinel, exit 0), not a failure.

### R1-FIL-12 MINOR accuracy read-tag caps are not hard once a read is registered
- Severity: MINOR.
- Category: accuracy.
- Map entry: FIL-36.
- Evidence: kit:project/.agents/harness/files/batch.mjs:283-291 and :486-488. Eviction stops when it reaches the tag just issued, so one read can stay over 30,000 hashed lines. `register` runs before the reply-budget check; if the entry is then dropped, only the new tag is deleted (`readStore.delete(tag)`), after older tags were already evicted to make room for it.
- Fix: Note both exceptions next to the 64 / 30,000 limits.

### R1-FIL-13 MINOR accuracy two edit-state bounds are looser than the map
- Severity: MINOR.
- Category: accuracy.
- Map entry: FIL-32, FIL-33, FIL-37.
- Evidence: kit:project/.agents/harness/files/batch.mjs:225-227. The 8 MiB cap is `Buffer.byteLength(JSON.stringify([...fixStore]))`, not `state.json` (reads and written signatures sit outside it). At :327 a resent line deletion (`newText` empty, so `lines.length === 0`) is skipped whenever the signature was written; `findRun` of the new lines is not required. A non-empty resent line edit does require the new lines to occur.
- Fix: Narrow the 8 MiB sentence to the fix store, and state the empty-newText resend rule separately from "the new lines are present".

### R1-FIL-14 MINOR accuracy FIL-16 the 36,000 cap is the slice, not the tool result
- Severity: MINOR.
- Category: accuracy.
- Map entry: FIL-16.
- Evidence: kit:project/.agents/harness/files/backend.mjs:200-212. `PAGE_CHARS` bounds `text.slice` only. The returned string adds the `ERROR (details/fix IDs are paginated, not discarded)` prefix and the `CONTINUATION ...` footer, so a full page is longer than 36,000 and is what the mod compares to 40,000 (`register.ts:91`).
- Fix: Say 36,000 is the body budget; the tool result is body plus prefix and footer, and must stay <= 40,000.

### R1-FIL-15 MINOR structure CONFLICT form, coverage range, and two overstated notes
- Severity: MINOR.
- Category: structure.
- Map entry: FIL-20, FIL-04, Coverage, Q1.
- Evidence: The case-fold disagreement is real (`path_guess.mjs:5` says "ignoring case"; `:16` folds only on win32) and both sides are written, but Proposal is KEEP, not CONFLICT. Coverage lists `prompts.mjs` as lines 10-45, while FIL-46 cites line 54, which is the `NOTE_READONLY` push and matches the claim. Q1 quotes "No MCP (MCP only for services outside the machine)" with no citation; that sentence is the historical omp decision in the memory file `omp-migration-policy.md` (2026-10-11), not a current kit rule. README.md:31 says Node 24 LTS "is used for" the TypeScript fixture tests, not that they require it. The generic deny at `register.ts:112` is `.catch` on the value `on()` returns; handler failures are already the inner `catch` at :93-110.
- Fix: Mark FIL-20 Proposal CONFLICT (or drop the CONFLICT label). Extend the prompts coverage range through line 54. Cite the memory line and call the omp rule historical. Soften the Node 24 sentence to README's wording, and don't describe the outer `.catch` as the tool-handler failure path.

### R1-FIL-16 MINOR coverage three small contracts the rewrite would otherwise invent
- Severity: MINOR.
- Category: coverage.
- Map entry: FIL-19, FIL-44, FIL-45.
- Evidence: `inside()` (`batch.mjs:55-58`) allows a path only when it equals an allowed root or starts with that root plus a separator; a raw prefix is not enough, and the compare is lower-cased on every platform (Concern 2 has the case half only). `mcp_fs_batch.mjs:15` answers `-32700` only when `line.trim()` is non-empty; a blank line is ignored. `mcp_fs_proxy.mjs:160` skips the size pre-check for `read_text_file` / `read_file` when `head` or `tail` is set, which is how a large file is still head-read (`test_fs_proxy.mjs:73-74`).
- Fix: Add the separator boundary to FIL-19, the blank-line rule to FIL-44, and the head/tail exemption to FIL-45.

## Citations checked

| map entry | citation | result |
| --- | --- | --- |
| FIL-01 | register.ts:53 | ok — "Real native call: its hooks, shell permissions, classifier/dialog and execution remain intact" |
| FIL-01 | register.ts:66-92 | ok — order is stage, plan, collect plan, check, execute, collect result; continuation skips plan/execute |
| FIL-02 | backend.mjs:14-19 | ok — 17 tools, three not deferred, description suffix |
| FIL-03 | backend.mjs:85-93 | ok — continuation or receipt alone, 64 lowercase hex |
| FIL-03 | backend.test.mjs:35-39 | ok — no root combinator, no `_meta`, continuation and receipt present |
| FIL-04 | README.md:31-32 | ok — Node 20.17+ and `path.matchesGlob`; Claude Code 2.1.296 or later. "Node 24" is "used for", not "need" (see R1-FIL-15) |
| FIL-04 | register.ts:112 | wrong as a handler failure path — `.catch` is on `on()`'s return; the handler's own catch is :93-110 |
| FIL-05 | register.ts:7 | ok — marker fields, 16-hex sha256 of latin1 with CRLF normalized, the three error strings |
| FIL-05 | backend.test.mjs:298-310 | ok — nested cwd finds the backend; a local edit fails `differs from installed marker` |
| FIL-06 | backend.mjs:300-304 | ok — 16 MiB cap, `{protocol:1}`, stderr sliced to 2000, exit code 1 |
| FIL-06 | register.ts:22-25 | wrong on empty stdout — `File transport failed` is non-zero or truncation only (R1-FIL-04) |
| FIL-07 | register.ts:51-56 | ok — command is node, path, action, two 64-hex ids; timeout 120000; sentinel required |
| FIL-08 | register.ts:28-32 | ok — decision must be allow, and ceiling if present must be allow |
| FIL-08 | register.test.ts:42-51 | ok — ask/deny before any stage; canonical deny ends in abandon |
| FIL-09 | backend.mjs:169-184 | ok — sorted JSON signature of tool, input, abs, real; guard compares realpath |
| FIL-10 | backend.mjs:152-165 | wrong as a uniform tree walk — see R1-FIL-05 |
| FIL-11 | register.ts:70-72 | ok — `agentId` deny before checks; text matches the map |
| FIL-12 | backend.mjs:25-37 | ok — tmp dir, uid or `user`, mode 0700, symlink and POSIX owner checks, session dir is sha256 |
| FIL-13 | backend.mjs:56-83 | ok — EPERM counts alive, 10 s unwritten, 20 s wait, 20 ms poll, rename-aside recovery |
| FIL-14 | backend.mjs:285-292 | ok — existing result returns; `wx` started file; state written even after a handler error |
| FIL-15 | register.test.ts:47-51 | wrong for this entry — those lines expect `permission deny`, not `Not executed` (R1-FIL-01) |
| FIL-15 | register.ts:97-108 | wrong condition in the prose — `Not executed` requires `executionStarted && started === false` |
| FIL-16 | backend.mjs:200-212 | ok for the page text and surrogate split; 36,000 does not include prefix or footer (R1-FIL-14) |
| FIL-18 | read_limits.mjs:5-6 | ok — broken overlay fails that request |
| FIL-18 | backend.test.mjs:286 | partial — regex is the substring; full text has the `invalid harness config` prefix (R1-FIL-10) |
| FIL-19 | batch.mjs:55-61 | partial — lower-casing is there; the separator boundary is not in the map (R1-FIL-16) |
| FIL-19 | mcp_fs_proxy.mjs:9-11 | ok — 208 of 346, relative paths resolved against `C:/` |
| FIL-20 | path_guess.mjs:14-38 | ok — 20,000 entries, 5 listed, skip `node_modules` and `.git`, unique only inside root and within budget |
| FIL-21 | batch.mjs:466-471 | ok — unique guess read in place with the parenthetical note; inside() failure names the guess |
| FIL-21 | backend.mjs:176-178 | wrong error name in the map — signature mismatch, not `unplanned` (R1-FIL-03) |
| FIL-22 | batch.mjs:458-493 | ok for per-entry errors, `ERROR` prefix, and all-failed throw; `to` clamp is missing (R1-FIL-08) |
| FIL-23 | read_limits.mjs:4-8 | ok — 24 files, 6.1 MB, owner 2026-10-08 |
| FIL-24 | read_limits.mjs:27-37 | ok — NUL in the first 8,000 bytes; open failure returns null |
| FIL-25 | backend.test.mjs:198-210 | ok — 768×65536 bytes, `--max-old-space-size=32`, `line 1 alone has 50,331,648 characters` |
| FIL-26 | harness.defaults.json:118-122 | ok — 200000, 450000, 1, 1000 |
| FIL-26 | config.mjs:84,93-96 | ok — gap may be 0; `fileMaxChars <= replyMaxChars < 500000` |
| FIL-28 | batch.mjs:64-100 | ok — 5 retries, 40×2^i, EPERM/EBUSY/EACCES, rollback messages |
| FIL-29 | batch.mjs:386-428 | wrong on order — path-fixes are queued after `files` (R1-FIL-02) |
| FIL-30 | batch.mjs:266 | ok as the handler text; not the mod/backend text (R1-FIL-07) |
| FIL-31 | test_fs_batch.mjs:96-116 | ok — whitespace, earlier-edit, NBSP U+00A0, short stretch, occurrences |
| FIL-32 | batch.mjs:218-229 | ok — 500 then 8 MiB, oldest first; the byte cap is the fix store only (R1-FIL-13) |
| FIL-33 | CHANGELOG.md:21 | ok — resent `found 0 times`, edge insert would apply twice, newest 2,000 signatures |
| FIL-36 | batch.mjs:273-293 | ok — FNV-1a, `<RUN>t<n>`, 64 reads, 30,000 lines, with the exceptions in R1-FIL-12 |
| FIL-37 | batch.mjs:310-342 | ok for the placement tiers; empty-newText resend is looser (R1-FIL-13) |
| FIL-38 | test_fs_batch.mjs:168-169 | ok — overlaps, first edit written, `PARTLY WRITTEN: 1 edit` |
| FIL-41 | mcp_fs_proxy.mjs:14-18 | ok — 5.5k-character context lines, 7.4 M a week, summary only when every oldText matched once |
| FIL-43 | register.ts:77-80 | ok — native Read guidance, no stage, "legacy filesystem MCP" |
| FIL-44 | mcp_fs_batch.mjs:5-32 | ok — name, 1.6.0, usage exit 1, JSON-RPC codes; blank lines omitted (R1-FIL-16) |
| FIL-45 | mcp_fs_proxy.mjs:3-35 | ok — the eight rewrites and the cited incidents |
| FIL-46 | prompts.mjs:25-27,54 | ok — mutating-method regex and `NOTE_READONLY`; line 54 is outside the coverage range (R1-FIL-15) |
| FIL-46 | prompt-tool-classification.test.mjs:5-16 | ok — the writer and read-only names match |
| FIL-47 | CHANGELOG.md:25 | ok — nine initial schemas versus thirteen |
| FIL-48 | README.md:66-78 | ok — `--enable-plugin`, `CLAUDE_CONFIG_DIR`, reload, `CLAUDE_CODE_PLUGIN_DIRS` |
| FIL-48 | CHANGELOG.md:13 | ok — second project reuses the marketplace only when plugin files are identical |
| FIL-49 | README.md:103-111 | ok — native Read/Edit/Write stay; ask/deny/plan-mode must not become authorized |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| --- | --- | --- |
| kit:project/.agents/harness/files/backend.mjs | yes (305, matches) | 3 (fix/line-edit check payloads; guess change is `plan changed`; validation message templates) |
| kit:project/.agents/harness/files/batch.mjs | yes (500, matches) | 4 (path-fix order; `to` clamped; tag-eviction side effect; empty-newText resend) |
| kit:project/.agents/harness/files/filesystem.mjs | yes (230, matches) | 1 (`path must be a nonempty string`; otherwise the DROP summaries match the handlers) |
| kit:project/.agents/harness/files/path_guess.mjs | yes (75, matches) | 0 (win32-only fold is recorded, though not as Proposal CONFLICT) |
| kit:project/.agents/harness/files/read_limits.mjs | yes (107, matches) | 0 (`to` clamp counted under batch) |
| kit:project/.agents/harness/files/backend.test.mjs | yes (310, matches) | 0 |
| kit:project/.claude/plugins/.claude-plugin/marketplace.json | yes (7, matches) | 0 |
| kit:project/.claude/plugins/harness-files/.claude-plugin/plugin.json | yes (6, matches) | 0 |
| kit:project/.claude/plugins/harness-files/hooks/hooks.json | yes (3, matches) | 0 |
| kit:project/.claude/plugins/harness-files/hooks/register.ts | yes (114, matches) | 2 (outcome conditions; empty stdout is not transport failure) |
| kit:project/.claude/plugins/harness-files/hooks/register.test.ts | yes (87, matches) | 0 |
| kit:mcp/mcp_fs_batch.mjs | yes (34, matches) | 1 (blank line is not -32700) |
| kit:mcp/mcp_fs_proxy.mjs | yes (274, matches) | 1 (head/tail skips the size pre-check) |
| kit:mcp/path_guess.mjs | yes (2, re-export) | 0 |
| kit:mcp/read_limits.mjs | yes (2, re-export) | 0 |
| kit:mcp/test_fs_batch.mjs | yes (216, matches) | 0 |
| kit:mcp/test_fs_proxy.mjs | yes (90, matches) | 0 |
| kit:tests/prompt-tool-classification.test.mjs | yes (16, matches) | 0 |
| kit:README.md | yes (172; Direct file tools is 83-111) | 0 |
| kit:CHANGELOG.md | yes (56, matches) | 0 |
| kit:project/.agents/harness/runtime/prompts.mjs | partial, disclosed | 0 (cited line 54 is outside the stated range) |
| kit:project/.agents/harness/config.mjs | partial, disclosed | 0 (message prefix mis-quoted, not omitted) |
| kit:project/.agents/harness.defaults.json | partial, disclosed | 0 |

No in-scope file is missing from the Coverage table. `mcp/read_limits.json` is named in CHANGELOG.md:42 and is not in the tree; the live defaults are `harness.defaults.json`, which the map uses. Proposals do not keep Backlog, omp, or the non-Claude adapters, and they do not fight the memory rules (main session orchestrates through Paseo/ph; the kit does not hide another tool's settings).

