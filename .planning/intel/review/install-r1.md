# Review r1: install (INS)

## Verdict

REVISE. 0 blocker, 7 major, 8 minor.

The three-digest ownership model, skill-link conflict isolation, hook reconcile rules, and the additive provider sync are present, cited, and aligned with the owner decisions (Backlog and non-Claude MCP dropped; `main_provider_disallowed_tools` kept). Do not spec from the map until the machine exit code, the status line, the backup claim, the Claude version gate, the provider-sync success path, the kit-init hook rules, and the limit of `--force` are corrected. Those are wrong or missing contracts, not wording.

## Findings

### R1-INS-01 MAJOR accuracy Apply exit code is not "2 only when sync returns 2"
- Severity: MAJOR
- Category: accuracy
- Map entry: INS-37 (contradicts INS-39 and the Interfaces CLI note)
- Evidence: kit:machine.mjs:354-357. After a non-zero `sync_agent_provider.mjs`, apply returns 2 only when that status is 2, else 1, and skips the check. On status 0 it prints `--- check` and `return cmdCheck(opts)`, and `cmdCheck` returns 2 whenever any `problem` line was counted (kit:machine.mjs:293-321), including a missing Backlog CLI (kit:machine.mjs:314-316).
- Fix: Replace the INS-37 exit sentence with the INS-39 rule: `check` is 0, 2, or 1 if the Paseo config cannot be read; `export` is 0 or 1; `apply` is 1 on a gate/`Fail` or on a sync status other than 0 or 2, 2 when sync returns 2 (no follow-up check), and otherwise the follow-up check's code (so a successful write still exits 2 when check reports a problem). Drop "all exit 0/1/2 as in INS-01" for `machine.mjs`. The citation kit:machine.mjs:360-381 only parses argv; cite 354-357 and 321 for the codes.

### R1-INS-02 MAJOR accuracy Status line always carries both versions
- Severity: MAJOR
- Category: accuracy
- Map entry: INS-11
- Evidence: kit:install.mjs:457. One template: `status: ${diff.length ? N part(s) differ : every kit part is the same}; project on kit ${m.version}, kit now ${kitVersion()}`. The version suffix is not only on the in-step branch.
- Fix: State both lines as `status: N part(s) differ; project on kit <installed>, kit now <kit>` and `status: every kit part is the same; project on kit <installed>, kit now <kit>`.

### R1-INS-03 MAJOR accuracy Paseo backup does not cover policy-only apply
- Severity: MAJOR
- Category: accuracy
- Map entry: INS-39, INS-53, INV-7
- Evidence: kit:machine.mjs:329-333 backs up and writes only when `done.length` is non-zero (missing providers/models or, with the flag, plugin registration). kit:machine.mjs:353 then always runs `sync_agent_provider.mjs --apply`, and kit:project/.agents/harness/runtime/provider_sync.mjs:93-96 renames over the live config with no backup of its own. The common case (providers already present, only denies/env change) writes `~/.paseo/config.json` with no `.bak-*-kit` file.
- Fix: Say the dated backup happens only when apply adds providers, models, `metadataGeneration`, or plugin entries. Policy sync can rewrite the file with no backup. Do not write INV-7 as "back up the Paseo config first" without that condition. INS-53's "machine apply made its own backup earlier" is not always true.

### R1-INS-04 MAJOR accuracy Claude version gate is not the 10s helper and is not before install writes
- Severity: MAJOR
- Category: accuracy
- Map entry: INS-29, INV-4
- Evidence: kit:project/.agents/harness/platform.mjs:37-39. `claudeVersion()` uses a 10s timeout, but install and machine never call it. Enable uses `runClaude(['--version'], { encoding: 'utf8' })` with no timeout (kit:install.mjs:348), and so does `criticalVersion` (kit:machine.mjs:263-264). On `install`/`update --enable-plugin` the Node gate runs before any write (kit:install.mjs:491; test kit:tests/install-machine.test.mjs:349-353), but the Claude version check runs inside `enablePlugin` after units are copied and `mergeHooks` has written `.claude/settings.json` (kit:install.mjs:387-390, 408-416). Machine `apply` does reject an old Claude before Paseo and `machine.local.json` writes (kit:machine.mjs:325-327; test kit:tests/install-machine.test.mjs:295-300). `export` and plain install/update/status/pull do not run either gate.
- Fix: Split the helper from the gates. Spec the gates as untimed `runClaude(['--version'])`. State that only the Node gate (and only with `--enable-plugin`) is fail-before-write on install; the Claude check can leave copied files and merged hooks behind and then throw, with the manifest still unwritten. Narrow INV-4 to those two facts. Keep the machine-apply fail-before-write behavior as stated.

### R1-INS-05 MAJOR accuracy Provider sync does not always print check lines
- Severity: MAJOR
- Category: accuracy
- Map entry: INS-54
- Evidence: kit:project/.agents/harness/runtime/provider_sync.mjs:115-121. `--apply` returns 1 on `not applied: ...` or on `paseo reload failed (...); run it yourself` before kit:project/.agents/harness/runtime/provider_sync.mjs:122-124. Check lines run only when apply was not requested, apply succeeded and reload succeeded, or `--no-reload` was set. `--no-reload` alone (no `--apply`) is accepted and is a no-op check (kit:project/.agents/harness/runtime/provider_sync.mjs:110-111), not a usage error.
- Fix: Delete "Always ends by printing the check lines". List the early returns. Note `--no-reload` without `--apply` is legal. Keep the exit-1-after-write reload behavior already in INS-53.

### R1-INS-06 MAJOR coverage kit-init syntax hook is not re-implementable from INS-56
- Severity: MAJOR
- Category: coverage
- Map entry: INS-56 (INS-22 records only the 30s vs 90s timeout)
- Evidence: kit:user/skills/kit-init/SKILL.md:46-71. Omitted contracts: matcher is exactly `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_.*` (no `mcp__fsbatch__` / `mcp__filesystem__`; WildEra's settings add both, wildera:.claude/settings.json:15 and :57); report channel is PostToolUse `hookSpecificOutput.additionalContext`; rule 2 says JSONC, JSX, and unusual macros stay silent because they already failed before the edit (JSON is `JSON.parse`, and the skill points JSONC such as `tsconfig.json` at rule 2, not at a JSONC parser); without `compile_commands.json`, ask the owner or skip C/C++; merge into existing settings and never replace other hooks; after `git init`, propose language gitignore entries outside the kit block and do not commit unless asked (kit:user/skills/kit-init/SKILL.md:19-22).
- Fix: Add those rules to INS-56. Record the matcher drift versus WildEra next to the timeout drift in INS-22. The new kit must not treat "JSON parse" as applying to `tsconfig.json`.

### R1-INS-07 MAJOR coverage `--force` does not clear skill-link conflicts
- Severity: MAJOR
- Category: coverage
- Map entry: missing (summary says `--force` is the only overwrite; INS-10 limits force to `local`/`both` file units; INS-32 never says force is absent)
- Evidence: kit:project/.agents/harness/runtime/skills_links.mjs:60. `linkSkills(root, report)` has no force argument. A `Conflict` keeps the copy and continues (kit:project/.agents/harness/runtime/skills_links.mjs:93-96). `update --force` only changes unit states `local` and `both` (kit:install.mjs:441). README: an edited copy stays a copy until it is merged into `.agents/skills` or deleted, then `ph skills-sync` (kit:README.md:80-81). Tests: a conflicting skill stays a copy on update exit 2 (kit:tests/install-no-tests.test.mjs:57-66); nothing invokes linkSkills with force.
- Fix: State that `--force` does not relink or delete an owner-selected link, a non-directory, or an unverified mirror copy. Recovery is merge-or-delete, then sync. Also list the other non-force keeps already scattered in the map, in one sentence: `removed-local`, legacy-config conflicts, seeds, and owner lines in settings and `.gitignore`.

### R1-INS-08 MINOR accuracy `pull` does not print `gone`
- Severity: MINOR
- Category: accuracy
- Map entry: INS-12
- Evidence: kit:install.mjs:469-470. Skip lines are for states other than `local` (or `both` with `--force`), `same`, and `gone`. `gone` produces no line and does not increment `left`.
- Fix: Say `gone` and `same` are silent; `missing`, `kit-newer`, `removed`, `removed-local`, and `both` without `--force` are `skipped`.

### R1-INS-09 MINOR accuracy WildEra manifest count
- Severity: MINOR
- Category: accuracy
- Map entry: INS-05
- Evidence: wildera:.agents/harness-kit.json:7-55. `files` has 48 keys: 47 path keys and one `AGENTS.md#paseo-harness-kit`. Not 49 file keys plus the block.
- Fix: Change the count to 47 file keys plus the block key.

### R1-INS-10 MINOR accuracy Missing `disallowedTools` is an empty list
- Severity: MINOR
- Category: accuracy
- Map entry: INS-49, INS-51
- Evidence: kit:project/.agents/harness/runtime/provider_sync.mjs:34 and :74. The test is `Array.isArray(p.disallowedTools ?? [])`. `undefined` or `null` is treated as `[]` and is not "owner review" / throw. A present non-array (string, object) is.
- Fix: Say absent or null means no rules yet; only a present non-array fails the check or throws on apply.

### R1-INS-11 MINOR accuracy A missing project path is not a `Fail`
- Severity: MINOR
- Category: accuracy
- Map entry: INS-02
- Evidence: kit:install.mjs:489 and :494-496. `statSync` on a missing path throws a normal exception, printed as `error: ...` (exit 1). `failed: <path> is not a folder` is only when the path exists and is not a directory. The kit-root / `project/` rejection is `failed: the project cannot be the kit itself`, using `startsWith(path.resolve(SRC))` with no trailing separator (kit:install.mjs:490).
- Fix: Split the three cases. Note the prefix check can also match a sibling whose path starts with the `project` directory string.

### R1-INS-12 MINOR coverage Update "kept" count and skills-sync stdout
- Severity: MINOR
- Category: coverage
- Map entry: INS-10, INS-26
- Evidence: kit:install.mjs:433-448. `left` starts at 1 when legacy migration conflicts, increments per kept unit, then adds `wire()`'s return (blocked hook scripts plus 1 if skills-sync exited 2). That sum is the `M` in `update: N part(s) changed, M kept`. kit:install.mjs:278-280 echoes every `conflict ` line on skills-sync status 2, and echoes the last output line on any status including 0. kit:install.mjs:430 calls `linkSkills(project)` with the default no-op reporter and ignores the return; visible skill lines come only from the later `ph skills-sync`. An invalid link record throws `Error`, so the installer prints `error:` not `failed:` (kit:project/.agents/harness/runtime/skills_links.mjs:76-78, kit:install.mjs:494-496).
- Fix: Define `M`. State that a successful skills-sync summary is still printed. State that update's early `linkSkills` is silent and exists only so verified copies convert before retired sources are deleted.

### R1-INS-13 MINOR proposal Dual skill tree is justified by harnesses the owner dropped
- Severity: MINOR
- Category: proposal
- Map entry: INS-30
- Evidence: kit:install.mjs:4-6 and kit:project/.agents/harness/runtime/commands.mjs:811-813. `.agents/skills` is described as the folder Codex, OpenCode, and other harnesses read; `.claude/skills` is the Claude Code link. Owner decision: Claude Code only. The map KEEP is still a possible design (edit one tree, Claude reads another) but it never puts the dropped-harness reason in front of the owner.
- Fix: Add the Codex/OpenCode sentence and an option: one skills directory under `.claude/skills` (or `.agents/skills` if Claude Code discovers it) and drop junctions, the link record, and the per-skill gitignore lines. Do not silently KEEP the Windows junction machinery without that choice.

### R1-INS-14 MINOR accuracy README Agent lines are two commands, not a conflict
- Severity: MINOR
- Category: accuracy
- Map entry: INS-58
- Evidence: kit:README.md:7-9 says project installation does not force the main conversation off native `Agent`. kit:README.md:146-149 says `machine.mjs` carries `main_provider_disallowed_tools` (Agent and Workflow; SendMessage is not in this paragraph) and that "this branch does not apply it to the owner's live daemon." Both match the code: `install.mjs` never edits Paseo providers; `machine.mjs apply` does.
- Fix: Do not mark CONFLICT. Say the new docs must keep that split, and quote the "does not apply it to the owner's live daemon" sentence. SendMessage stays the C-8 / open-question-6 issue, which is real.

### R1-INS-15 MINOR coverage Which Claude config `machine.mjs` inspects
- Severity: MINOR
- Category: coverage
- Map entry: INS-46
- Evidence: kit:machine.mjs:201-204. `claudeConfigDir` is the first template provider `CLAUDE_CONFIG_DIR` passed through `fromTemplate` (so `{{HOME}}/.claude-circle` becomes the home path), else `$CLAUDE_CONFIG_DIR`, else `~/.claude`. Apply's `mcp remove` passes that directory as `CLAUDE_CONFIG_DIR` (kit:machine.mjs:340-347). Also omitted from the dropped adapter: default dirs are `--dirs` comma-separated, else `/` on non-Windows, else existing `C:/`..`Z:/` (kit:machine.mjs:214-218); `machine.local.json` sets `alwaysLoad: true` only on `fsbatch` (kit:machine.mjs:270-275).
- Fix: Add the directory rule (it is what open question 3 is about). One line for default roots and `alwaysLoad` is enough, since the adapter is DROP.

## Citations checked

| map entry | citation | result |
| --- | --- | --- |
| INS-01 | kit:install.mjs:16-33, 477-497 | ok. Verbs, flag positions, usage exit 1, `failed:` vs `error:`, exits 0/1/2. |
| INS-02 | kit:install.mjs:488-493 | ok for the directory and kit-root checks; see R1-INS-11 for a missing path. |
| INS-04 | kit:install.mjs:79-82, 30-31; skills_links.mjs:7 | ok. sha256, CRLF stripped, 16 hex chars, latin1 file read. |
| INS-05 | kit:install.mjs:185-192; kit.json:1-4; wildera manifest:1-57 | ok on shape and `installedAt` retention. Key count wrong (R1-INS-09). |
| INS-06 | kit:install.mjs:67-74, 161-172 | ok. Six states and help strings match. |
| INS-08 | kit:install.mjs:403-421 | ok. Manifest written after wire; conflict lines then the installed line. |
| INS-10 | kit:install.mjs:423-450, 428-429 | ok on state actions and linkSkills-before-delete. `M` is not only kept units (R1-INS-12). |
| INS-11 | kit:install.mjs:452-459 | wrong paraphrase. Line 457 puts the version suffix on both the differ and the same line (R1-INS-02). |
| INS-12 | kit:install.mjs:461-475 | ok except `gone` is not a skip line (R1-INS-08). |
| INS-13 | kit:README.md:43-47, 49-50 | ok. Docs show one `[<file>]` and no `--force`; line 50 says Backlog init. |
| INS-14 | kit:install.mjs:51-53, 108-129; blocks/AGENTS.md:1-7 | ok. Markers, in-place replace, Backlog anchor, five File I/O bullets. |
| INS-15 | wildera:AGENTS.md:6-30; manifest:55; blocks/AGENTS.md:1-7 | ok. Recomputed digests `34365b3df3dae322` (project body) and `17d4aba4a3db90b5` (kit block and manifest). |
| INS-16 | kit:install.mjs:284-299, 87-96; machine.mjs:31 | ok. Init args, 120s, note-and-return on failure, pin comment 1.53.0. |
| INS-19 | kit:install.mjs:212-271; tests 141-162, 285-293 | ok. Unprovable baseline, machine keys, overlay disagreement, `--force` still exit 2. |
| INS-20 | kit:install.mjs:301-328; tests 81-101, 125-139 | ok. Managed trio, blocked local script, user hook kept, second update byte-identical. |
| INS-21 | kit:templates/settings.hooks.json:1-49 | ok. Matchers, timeouts 10, UserPromptSubmit has no matcher. |
| INS-23 | kit:install.mjs:372-385; wildera:CLAUDE.md:1 | ok. `@AGENTS.md` insert, old import drop. WildEra file is that one line. |
| INS-26 | kit:install.mjs:273-282; commands.mjs:808-819 | ok on the ph summary string and exit 2. Installer also prints the last line on exit 0 (R1-INS-12). |
| INS-27 | kit:install.mjs:340-370; tests 164-177, 205-219 | ok. Args, cwd, `CLAUDE_CONFIG_DIR`, fail-closed on 2.1.295, CLI exit 7, modified assets. |
| INS-28 | kit:install.mjs:356-366; tests 179-203 | ok. Identical tree reuses `harness-files@paseo-harness-kit`; different tree stops with no install. |
| INS-29 | kit:project/.agents/harness/platform.mjs:7-41; tests 314-337 | partial. Node gate and `versionAtLeast` match the tests. The 10s timeout is only `claudeVersion()`, which install/machine do not call (R1-INS-04). |
| INS-32 | skills_links.mjs:32-57, 80-100; tests/skills-links.test.mjs:28-48 | ok. Byte-equal or manifest digest, per-skill conflict, others still link. |
| INS-36 | skills_links.mjs:13-30; wildera:.gitignore:1-16; tests 49-67 | ok. Markers, fixed paths, escaped names, owner lines and CRLF kept, copies not listed. |
| INS-37 | kit:machine.mjs:360-381 | unsupported for the apply exit-code sentence. Those lines parse flags and dispatch. Returns are 354-357 (R1-INS-01). |
| INS-38 | kit:machine.mjs:292-322; tests 221-231 | ok. Read-only, criticalVersion exit 2, only `--version` calls, no reload. |
| INS-39 | kit:machine.mjs:324-358; tests 295-312 | ok that success falls through to check and a sync failure skips it. Backup is conditional (R1-INS-03). |
| INS-42 | kit:machine.mjs:94-102; harness.defaults.json:33-63 | ok. 17 worker denies, env `ENABLE_TOOL_SEARCH=true`, main denies Agent, Workflow, SendMessage. |
| INS-43 | kit:machine.mjs:55-80 | ok for the code order `PASEO_KIT_NAME`, same-`extends` peer, then `NAME`. |
| INS-43 | kit:paseo/providers.json:2 | wrong as support for that lookup. The line says `$PASEO_KIT_NAME` or a live provider with the same `ANTHROPIC_BASE_URL`, and it omits `$NAME`. C-9 already records the clash. |
| INS-45 | kit:paseo/providers.json:1-468 | ok. Both providers, nine models, sonnet default with thinking `off..max` default high, opus/GPT thinking default medium, haiku has no thinking options, gemini high only, circle tools Agent+Workflow, circle-agent stores none, metadata model without `[1m]`. |
| INS-49 | provider_sync.mjs:25-47 | ok on missing tools, env value mismatch, native file denies, and the 0.0.2 branch. Absent `disallowedTools` is not a failure (R1-INS-10). |
| INS-51 | provider_sync.mjs:59-92 | ok. Source must differ, clone before main denies, legacy fingerprint strips four tools, unproven file denies block additions, env still merges. |
| INS-52 | provider_sync.mjs:16-24, 75-78 | ok. Hash and filter set match the entry. |
| INS-53 | provider_sync.mjs:93-108, 115-121; tests 306-312 | ok on reload candidates, exit 1 after a failed reload, config already written, no `--- check` in the stub test. |
| INS-54 | provider_sync.mjs:109-125; sync_agent_provider.mjs:1-9 | partial. Shim re-exports and calls `syncMain` when invoked directly. "Always" prints check lines is false (R1-INS-05). |
| INS-55 | tests/install-machine.test.mjs:255-264; config.mjs:19-22 | ok. `loadConfig` after the kit directory is renamed still returns defaults. `installedRoot` reads `manifest.kit`. |
| INS-58 | kit:README.md:7-9, 146-152 | lines ok; CONFLICT label is not (R1-INS-14). Line 152 is the explicit plugin opt-in. |
| INV-4 | kit:install.mjs:491; tests 339-359 | partial. Supports the Node gate before writes, not a Claude version gate before install writes (R1-INS-04). |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| --- | --- | --- |
| kit:install.mjs | yes | 4 (status suffix is mis-stated, not omitted; real gaps: `M` includes wiring, skills-sync stdout on exit 0, silent pre-loop `linkSkills`, `gone` not skipped) |
| kit:machine.mjs | yes | 2 (backup only when the provider/plugin plan is non-empty; `claudeConfigDir` / default MCP roots / `alwaysLoad`) |
| kit:kit.json | yes | 0 |
| kit:.gitignore | yes | 0 |
| kit:README.md | yes | 0 (Agent paragraphs mis-labeled CONFLICT; text itself is in INS-58) |
| kit:blocks/AGENTS.md | yes | 0 |
| kit:templates/backlog-agents.md | yes | 0 |
| kit:templates/harness-history.md | yes | 0 |
| kit:templates/harness.config.json | yes | 0 |
| kit:templates/settings.hooks.json | yes | 0 |
| kit:user/skills/kit-init/SKILL.md | yes | 5 (matcher, `hookSpecificOutput`, rule 2, no `compile_commands.json`, never replace other hooks) |
| kit:project/.agents/harness/runtime/skills_links.mjs | yes | 1 (`--force` does not exist) |
| kit:project/.agents/harness/runtime/provider_sync.mjs | yes | 2 (check lines skipped after a failed apply/reload; null `disallowedTools`) |
| kit:project/.agents/skills/harness/scripts/sync_agent_provider.mjs | yes | 0 |
| kit:paseo/providers.json | yes | 0 |
| kit:tests/install-machine.test.mjs | yes | 0 (assertions checked are already represented) |
| kit:tests/install-no-tests.test.mjs | yes | 0 |
| kit:tests/skills-links.test.mjs | yes | 0 |
| wildera:.agents/harness-kit.json | yes | 0 (count mis-stated) |
| wildera:.agents/harness-skills-links.json | yes | 0 (11 skills, Windows absolute paths) |
| wildera:.gitignore | yes | 0 (kit block is lines 1-16) |
| wildera:CLAUDE.md | yes | 0 |
| wildera:AGENTS.md | yes | 0 |
| wildera:.claude/settings.json | yes | 1 (syntax-check matcher drift versus kit-init, beside the timeout already noted) |
