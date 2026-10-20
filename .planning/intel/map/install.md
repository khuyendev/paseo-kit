# Map: install (INS)

Source roots: `kit:` = paseo-harness-kit @ ref-final, `wildera:` = WildEraV6 @ 89143da. Line numbers are those of the files as read.

## Coverage

| file | lines | read fully |
| --- | --- | --- |
| kit:install.mjs | 497 | yes |
| kit:machine.mjs | 381 | yes |
| kit:kit.json | 4 | yes |
| kit:.gitignore | 3 | yes |
| kit:README.md | 172 | yes (install/update/status/pull/links/plugin/machine sections used; the rest read for CONFLICT checks) |
| kit:blocks/AGENTS.md | 7 | yes |
| kit:templates/backlog-agents.md | 24 | yes |
| kit:templates/harness-history.md | 8 | yes |
| kit:templates/harness.config.json | 3 | yes |
| kit:templates/settings.hooks.json | 49 | yes |
| kit:user/skills/kit-init/SKILL.md | 76 | yes |
| kit:project/.agents/harness/runtime/skills_links.mjs | 132 | yes |
| kit:project/.agents/harness/runtime/provider_sync.mjs | 125 | yes |
| kit:project/.agents/skills/harness/scripts/sync_agent_provider.mjs | 9 | yes |
| kit:paseo/providers.json | 468 | yes |
| kit:tests/install-machine.test.mjs | 373 | yes |
| kit:tests/install-no-tests.test.mjs | 76 | yes |
| kit:tests/skills-links.test.mjs | 80 | yes |
| wildera:.agents/harness-kit.json | 57 | yes |
| wildera:.agents/harness-skills-links.json | 16 | yes |
| wildera:.gitignore | 58 | yes (kit block lines 1-16; rest is project content) |
| wildera:CLAUDE.md | 1 | yes |
| wildera:AGENTS.md | 36 | yes |
| wildera:.claude/settings.json | 82 | yes |

Also read for context (other areas own them): kit:project/.agents/harness/config.mjs:1-35,95-130 (MACHINE_KEYS, loadKitConfig, isClaudeProvider), kit:project/.agents/harness/platform.mjs:1-41 (Node/Claude gates, claude CLI lookup), kit:project/.agents/harness.defaults.json:30-64 (machine keys), kit:project/.agents/harness/runtime/commands.mjs:808-819 (`ph skills-sync`). `paseo/plugins/*` and `project/.claude/plugins/harness-files` exist but belong to other areas.

## Summary

Two scripts split the setup. `install.mjs` is the project half: it copies the kit-owned files (every file under `project/` except tests, plus marked blocks from `blocks/`) into a project and records a 16-hex sha256 digest of each in `.agents/harness-kit.json`. Three digests per part (project P, kit K, installed I) give six states (`same`, `missing`, `kit-newer`, `local`, `both`, `removed`/`removed-local`); update takes only what the project has not changed, pull promotes project changes back into the kit, `--force` is the only way to overwrite. Around the copy sit untracked wirings: hook registrations merged into `.claude/settings.json`, an `@AGENTS.md` import in `CLAUDE.md`, per-skill links, seeds created once, and opt-in plugin enabling through `claude plugin install`.

`machine.mjs` is the machine half (check read-only, apply additive, export scrubbed): it makes sure the Paseo providers (`circle`, `circle-agent`) exist with the kit's models, and delegates the deny-list/env policy to `provider_sync.mjs`, which never removes owner rules. Secrets never enter the kit (placeholders `{{secret:NAME}}`, `{{HOME}}`).

(`--force` is the only way to overwrite tracked file units that are `local`/`both`; it never clears skill-link conflicts, see INS-60.) Worth keeping in spirit: the three-digest ownership model with line-ending-insensitive digests, never overwriting owner changes without `--force`, exit code 2 = done but differences left, additive-only machine edits with a backup and no daemon restart, per-skill conflict isolation, a gitignore block the kit owns, and scrubbed secrets. Worth dropping: Backlog, MCP file servers, `machine.local.json`, non-Claude provider handling, the legacy migrations, the absolute kit path in the manifest, and the digest-by-reading-latin1 trick when a simpler hash will do.

## Behaviors

### INS-01 CLI surface and argument rules
- Behavior: `node install.mjs install|update|status <project> [--force] [--enable-plugin]` and `node install.mjs pull <project> [<part>...] [--force]`. Flags may appear anywhere after the command. Usage error (exit 1) when: unknown command, no project word, any unknown `--flag`, more than one positional for non-pull, or `--enable-plugin` with a command other than install/update. `<project>` is resolved with `path.resolve`. Exit codes: 0 done and in step, 1 usage/file error (message `failed: ...` for expected failures, `error: ...` for unexpected), 2 done with differences or conflicts left.
- Proposal: KEEP the three-valued exit contract and the verb set install/update/status/pull; CHANGE: drop `--enable-plugin` as a separate opt-in only if the new mod activation is decided otherwise (see INS-27).
- Source: kit:install.mjs:16-33, kit:install.mjs:477-497
- Why it exists: not stated beyond the header contract.
- Test idea: run each verb with bad args and assert exit 1 and a usage line on stderr; run update with a kept conflict and assert exit 2.

### INS-02 Refuse to install into the kit itself, require a folder, print platform line
- Behavior: three distinct failures, all exit 1: a path that does not exist makes `statSync` throw, printed as `error: ENOENT...` (not `failed:`); an existing non-directory prints `failed: <path> is not a folder`; a path equal to the kit root or whose resolved string starts with the resolved `<kit>/project` string (plain `startsWith`, no trailing separator, so a sibling such as `project-x` also matches) prints `failed: the project cannot be the kit itself`. For every command except `status` the first output line is `platform <os> <arch>, node <version>`.
- Proposal: KEEP.
- Source: kit:install.mjs:488-493
- Why it exists: not stated; protects kit sources from being used as a target.
- Test idea: `install <kit>` and `install <kit>/project/x` exit 1 and write nothing.

### INS-03 Kit-owned units: files and marked blocks
- Behavior: units = every file under `<kit>/project/` (walked recursively, sorted, forward-slash relative path = key) that passes `runtimePart`, plus one block unit per file in `<kit>/blocks/` keyed `<NAME>#paseo-harness-kit`. `runtimePart` excludes any path with a `tests/`, `__tests__/` or `node_modules/` segment and files named `test_*` or `*.test|spec.(mjs|cjs|js|ts|mts|cts|jsx|tsx)`. Test files stay in the kit.
- Proposal: KEEP the unit model (files + blocks, test filter); CHANGE the source layout to whatever the new kit ships (no `project/` mirror needed if a manifest lists shipped files).
- Source: kit:install.mjs:98-106, kit:install.mjs:131-159, kit:install.mjs:157-159, kit:tests/install-no-tests.test.mjs:23-41
- Why it exists: installed projects must not carry kit test files (test `installer ships runtime assets without test files`).
- Test idea: after install, the manifest has no key matching `test_` or `.test.` and `.claude/hooks/test_*.mjs` does not exist in the project.

### INS-04 Digest definition
- Behavior: digest = sha256 of the text with `\r\n` replaced by `\n`, hex, first 16 characters. File bytes are read as `latin1` text before hashing so non-UTF-8 bytes hash stably. A block's digest is the same function over the block body (text between the START line and END marker, normalised, trimmed). The kit side of a block is `blocks/NAME` normalised and trimmed. The skill-link code repeats the same function.
- Proposal: KEEP line-ending-insensitive digests (git may check out CRLF on one machine, LF on another); CHANGE: use a full or longer hash and one shared helper (the digest is duplicated in install.mjs and skills_links.mjs).
- Source: kit:install.mjs:79-82, kit:install.mjs:145-155, kit:project/.agents/harness/runtime/skills_links.mjs:7
- Why it exists: header: "Digests ignore line endings: git may check text out with CRLF on one machine and LF on another" (kit:install.mjs:30-31).
- Test idea: install, convert one installed file to CRLF, run status: `every kit part is the same`.

### INS-05 Manifest `.agents/harness-kit.json`
- Behavior: JSON, two-space indent, trailing newline: `_notes` (fixed text: written by install.mjs, do not edit, `NAME#paseo-harness-kit` = marked block), `kit` (absolute kit folder, forward slashes), `version` (from kit.json at write time), `installedAt` (ISO; kept across update/pull), `updatedAt` (ISO now), `files` (path -> digest, keys sorted with localeCompare). Written by install, update and pull. The wildera copy shows 47 file keys plus `AGENTS.md#paseo-harness-kit` (48 entries, lines 8-55); skill content of project-owned skills (code-wave, gsd-*) is not listed. `kit.json` holds only `name` and `version` (`0.1.0`).
- Proposal: CHANGE: keep the file name, `version`, `installedAt`, `updatedAt`, `files`; drop the absolute `kit` path (it breaks when the kit moves and leaks a machine path into a committed file; the runtime already reads `installedRoot` only for provenance).
- Source: kit:install.mjs:185-192, kit:install.mjs:48, kit:kit.json:1-4, wildera:.agents/harness-kit.json:1-57
- Why it exists: update/status must tell a kit change (`kit-newer`) from a project change (`local`) from both (kit:install.mjs:29-31). The `kit` path is read by `installedRoot` (kit:project/.agents/harness/config.mjs:19-22) and by machine MCP ownership proof (kit:machine.mjs:233-238).
- Test idea: install, then assert the manifest has version/installedAt/updatedAt/files and that update keeps `installedAt` while moving `updatedAt`.

### INS-06 Six-state classification
- Behavior: for each unit with project digest P (null if absent), kit digest K (null if the kit no longer ships it), installed digest I (manifest or null): K null -> `gone` (P null), `removed` (P == I), else `removed-local`; P null -> `missing`; P == K -> `same`; P == I -> `kit-newer`; K == I -> `local`; else `both`. Help text per state: missing = update adds it; kit-newer = update takes it; local = pull copies into kit, update --force replaces with kit version; both = merge by hand then pull --force or update --force; removed = update deletes it; removed-local = delete or keep by hand.
- Proposal: KEEP exactly (this is the core ownership contract).
- Source: kit:install.mjs:67-74, kit:install.mjs:161-172
- Why it exists: not stated; derived from the header contract.
- Test idea: table test over (P,K,I) triples asserting the six states and `same`/`gone`.

### INS-07 Manifest-tracked files the kit dropped are still considered
- Behavior: `states()` adds a file unit for every manifest key that is not a current unit and has no `#`, so a file removed from the kit is reported `removed` (deleted by update when unchanged) or `removed-local` (kept). Block entries absent from the kit are not tracked this way.
- Proposal: KEEP for files; OPEN for blocks (a retired block is never removed from a project).
- Source: kit:install.mjs:174-178, kit:tests/install-machine.test.mjs:266-283
- Why it exists: test `update migrates old .claude locations and prunes only unchanged retired assets`: an unchanged retired file is deleted, a locally modified one is kept.
- Test idea: add two fake manifest keys, one unchanged one edited, run `update --force`: first deleted, second kept, exit 2.

### INS-08 install
- Behavior: runs `migrate` first, then fails (exit 1) with `.agents/harness-kit.json exists: already installed; use update` if a manifest exists. For each unit: if the project already has a different version (P != K) and not `--force`, the part is kept and listed as a conflict (not recorded in the manifest); otherwise copied (`put`) and recorded with the kit digest. Then migrateConfig(null manifest), wire(), write manifest, print one `conflict <rel>: the project has a different version and kept it (install --force replaces it)` line per conflict, then `installed paseo-harness-kit <version>; machine setup (once per machine): node "<kit>/machine.mjs" check`. Exit 2 when any conflict, legacy-config conflict or blocked hook.
- Proposal: KEEP; CHANGE the closing hint to the new kit's machine command.
- Source: kit:install.mjs:403-421, kit:tests/install-no-tests.test.mjs:68-76
- Why it exists: test `install into a project with a conflicting skill copy still completes and records the install` (a conflict must not stop the manifest from being written).
- Test idea: hand-make `.claude/skills/harness/SKILL.md`, install: exit 2, manifest exists, a following `update` is not "not installed".

### INS-09 A conflict kept at install becomes `both` at the next update
- Behavior: a part kept at install is absent from the manifest (I null), so the next `update` classifies it `both` (P != K, K != I) and keeps it with `kept <rel> (both: ...)`; only `update --force` replaces it.
- Proposal: KEEP (derived from INS-06/08); document it.
- Source: kit:install.mjs:410, kit:install.mjs:162-171
- Why it exists: not stated; derived.
- Test idea: install with a pre-existing differing file, update: state `both`, exit 2; update --force: file equals kit.

### INS-10 update
- Behavior: `migrate`; fails if no manifest (`not installed; use install`); ensureBacklog; `linkSkills` first (converts verified old mirror copies before the legacy config and retired sources are removed); migrateConfig; then per state: `same` -> record K; `gone` -> drop key; `missing`, `kit-newer`, or (`--force` and `local`/`both`) -> copy kit version, record K, print `updated <rel>`; `removed` -> delete file, drop key, print `deleted <rel> (no longer in the kit)`; anything else (`local`, `both`, `removed-local`) -> `kept <rel> (<state>: <help>)` and counts as left. Then wire(), write manifest keeping `installedAt`, print `update: N part(s) changed, M kept; kit <version>`. `M` (`left`) = 1 if the legacy-config migration conflicted + one per kept unit + wire()'s return (blocked hook scripts + 1 when skills-sync exited 2), so `M` is not only kept units. The early `linkSkills(project)` call uses the default no-op reporter and ignores its return; its only job is to convert verified old mirror copies before retired sources are deleted, the visible skill lines come from the later `ph skills-sync`. Exit 2 when anything is left. The legacy config entry is dropped from the manifest only when its migration had no conflict.
- Proposal: KEEP; DROP ensureBacklog and legacy-config handling (INS-16, INS-17, INS-18, INS-19) in the new kit.
- Source: kit:install.mjs:423-450
- Why it exists: the linkSkills-first ordering is explained in the comment at kit:install.mjs:428-429.
- Test idea: edit an owned hook, update: file kept, exit 2; `update --force`: replaced.

### INS-11 status
- Behavior: fails if no manifest. Prints one line per unit whose state is neither `same` nor `gone`: `<state padded to 13> <rel>  (<help>)`, then `status: N part(s) differ; project on kit <installed>, kit now <kit>` or `status: every kit part is the same; project on kit <installed>, kit now <kit>` (one template, the version suffix is on both lines, kit:install.mjs:457). Exit 2 if any differ, else 0. Read-only.
- Proposal: KEEP.
- Source: kit:install.mjs:452-459
- Why it exists: header.
- Test idea: fresh install -> exit 0; edit a part -> exit 2 and one `local` line.

### INS-12 pull
- Behavior: `pull <project> [<part>...] [--force]`. Part names are forward-slashed with a leading `./` stripped; when given, only those units are considered, else all. `local` (and `both` with `--force`) is copied from the project into the kit (`take`; for a block, the project's block body plus newline overwrites `blocks/NAME`), the manifest records the project digest, `pulled <rel>`. `same` and `gone` are silent; `missing`, `kit-newer`, `removed`, `removed-local` and `both` without `--force` print `skipped <rel> (<state>: <help>)` and make the exit code 2. Manifest rewritten (installedAt kept). Closing line `pull: N part(s) copied into the kit` plus `; record them in the kit CHANGELOG.md and commit the kit, then update the other projects` when N>0. Exit 2 if something was skipped. A part name that matches no unit is silently ignored.
- Proposal: CHANGE: keep pull (project -> kit promotion of reusable changes, used by harness-evolve) but report unknown part names as an error.
- Source: kit:install.mjs:461-475, kit:tests/install-machine.test.mjs:111-123
- Why it exists: README: "`pull` remains available for promoting reusable project changes back into the kit" (kit:README.md:80-81); template history file says harness-evolve lessons.
- Test idea: edit an owned file in the project, `pull <rel>`: kit file equals project file, then `status` is `same`.

### INS-13 README vs code for pull and flags (CONFLICT)
- Behavior: README documents `pull <project> [<file>]` (one optional file); code accepts any number of part names and `--force`. README also says install "initializes Backlog when needed".
- Proposal: CONFLICT -> follow the code for pull; DROP the Backlog sentence.
- Source: kit:README.md:43-47, kit:README.md:49-50, kit:install.mjs:461-464
- Why it exists: not stated.
- Test idea: n/a (doc fix).

### INS-14 Marked block in a project file (AGENTS.md)
- Behavior: each file in `blocks/` is installed as a block in the project file of the same name between `<!-- PASEO-HARNESS-KIT START: managed by the paseo-harness-kit install.mjs; change it in the kit -->` and `<!-- PASEO-HARNESS-KIT END -->`, with a blank line inside each marker. Matching uses the prefix `<!-- PASEO-HARNESS-KIT START` and the END marker. An existing block is replaced in place (text outside kept); when absent it is inserted after the Backlog.md block if present, else at the top, followed by a blank line and the old content. The file's EOL (CRLF if the file has any CRLF) is preserved; the project-side digest is `null` when markers are missing or END precedes START. The only block today (`blocks/AGENTS.md`) is a 5-bullet `## File I/O` section (Grep/Glob, read sections, batch edits, no re-read to verify, correctness first).
- Proposal: KEEP the mechanism (marked block, replace in place, EOL preservation); CHANGE the insertion point (no Backlog anchor) and the block text (revisit File I/O bullets for the new kit's tools).
- Source: kit:install.mjs:51-53, kit:install.mjs:108-129, kit:install.mjs:145-155, kit:blocks/AGENTS.md:1-7
- Why it exists: header: "the rest of the file is the project's" (kit:install.mjs:9).
- Test idea: CRLF AGENTS.md with a block: update changes only the body, keeps CRLF, text before/after the block unchanged.

### INS-15 Observed drift: project text inside the kit block (WildEra)
- Behavior: wildera:AGENTS.md puts "Repository layout" and "C++ checks and builds" sections inside the START/END markers next to the kit's `## File I/O`. The installed block body hashes to 34365b3df3dae322 (recomputed read-only), the manifest and the kit block hash to 17d4aba4a3db90b5, so the part is `local`: update keeps it (exit 2 every time) and a `pull` would copy WildEra's project text into the kit's `blocks/AGENTS.md`.
- Proposal: CHANGE: new kit makes block ownership obvious (project text outside the block; `status` names the part) and warns on `pull` of a block; project rules live outside the block.
- Source: wildera:AGENTS.md:6-30, wildera:.agents/harness-kit.json:55, kit:blocks/AGENTS.md:1-7, kit:install.mjs:152
- Why it exists: not stated (likely a project author editing inside the markers); derived by digest comparison.
- Test idea: put text inside the block, run status: `local AGENTS.md#paseo-harness-kit`; pull of that part warns (new behavior).

### INS-16 Backlog init at install/update (what it did)
- Behavior: `ensureBacklog` ran on both install and update. If none of `backlog/config.yml`, `.backlog/config.yml`, `backlog.config.yml` existed it ran the npm-installed CLI: `backlog init <project-basename> --defaults --agent-instructions agents --integration-mode cli --check-branches false --include-remote false`, plus `--no-git` when the project has no `.git`; 120 s timeout, shell, empty stdin, node's folder first on PATH, CLI taken from the npm global folder (`%APPDATA%\npm\backlog.cmd` or node's folder on Windows). Failure only printed `note Backlog.md not initialised (...)` and returned (no exit-code effect). Success printed `initialised Backlog.md (backlog <args>)`; an existing setup printed `Backlog.md already set up`.
- Proposal: DROP (owner decision: Backlog dropped; planned work lives in `.planning/`). The new install must not touch `backlog/` and must not print Backlog lines.
- Source: kit:install.mjs:54-57, kit:install.mjs:87-96, kit:install.mjs:284-299
- Why it exists: not stated; the instruction block was tested against Backlog 1.53.0 (kit:machine.mjs:31).
- Test idea: install into an empty folder with no `backlog` CLI on PATH: exit 0 and no `backlog/` created.

### INS-17 Backlog instructions block at the top of AGENTS.md (what it did)
- Behavior: after init, if AGENTS.md lacked `<!-- BACKLOG.MD GUIDELINES START -->`, the template `templates/backlog-agents.md` (CRITICAL_INSTRUCTION: run `backlog instructions overview` at conversation start, read the task-creation/execution/finalization guides, use the CLI, never edit task markdown) was prepended with the file's EOL; printed `added the Backlog.md instructions to AGENTS.md`. Backlog owned that block; the kit block was inserted after it (INS-14). WildEra later replaced it by an owner-written `## Planning state` paragraph (Backlog legacy, state in `.planning/`).
- Proposal: DROP the block, the template and the `BACKLOG_*` anchors. The new kit's AGENTS content points at `.planning/` (GSD area owns that text).
- Source: kit:install.mjs:294-298, kit:install.mjs:54-55, kit:templates/backlog-agents.md:1-24, wildera:AGENTS.md:1-4
- Why it exists: not stated.
- Test idea: install: AGENTS.md contains no `BACKLOG.MD` markers.

### INS-18 Older-kit relocation (`migrate`)
- Behavior: before install/update, moves `.claude/harness-kit.json` -> `.agents/harness-kit.json`, `.claude/harness.config.json` -> `.agents/harness.config.json`, `.claude/harness-history.md` -> `.agents/harness-history.md` when the source exists and the target does not (`moved A -> B`); removes manifest entries under `.claude/skills/` (now links) and says so. The old import `@.claude/harness-io.md` is removed from CLAUDE.md (INS-23); the file itself is deleted by update when unchanged (a retired manifest key, INS-07).
- Proposal: DROP (history of an older layout; the rewrite starts from one layout). OPEN only if projects on kit 0.1.0 must be upgraded in place (see Open questions).
- Source: kit:install.mjs:49-50, kit:install.mjs:65-66, kit:install.mjs:196-210, kit:tests/install-machine.test.mjs:266-283
- Why it exists: the kit moved harness files from `.claude/` to `.agents/` (comment at kit:install.mjs:196-198).
- Test idea: n/a if dropped.

### INS-19 Legacy `scripts/config.json` -> overlay migration
- Behavior: if `.agents/skills/harness/scripts/config.json` exists, compute what the project changed against the exact recorded baseline (the shipped file when its digest equals the manifest digest, else the newest git revision of the kit whose content hashes to the manifest digest). Unchanged and recorded -> delete (`retired ...`). Changed but baseline unprovable -> `conflict ... cannot prove the old baseline`, everything kept, exit 2. Edits to machine keys, unknown keys or removed keys -> conflict, kept. Otherwise only differences go into `.agents/harness.config.json` (maps merged per entry; conflict when the overlay disagrees, for retired `context_guard|io_guard|read_limits` entries, for removed map entries), then the legacy file is deleted. A conflict also pins the manifest entry and forces exit 2 even with `--force`.
- Proposal: DROP (one-off migration of a retired file, ~60 lines plus git-history archaeology). Keep the lesson in Invariants.
- Source: kit:install.mjs:60, kit:install.mjs:212-271, kit:tests/install-machine.test.mjs:141-162, kit:tests/install-machine.test.mjs:285-293
- Why it exists: policy moved from a copied `config.json` to defaults + overlay; "Recover exactly the old installed baseline, not today's policy" (kit:install.mjs:212).
- Test idea: n/a if dropped.

### INS-20 Hook registration merge into `.claude/settings.json`
- Behavior: `mergeHooks` reads (or starts) project `.claude/settings.json`, loads `templates/settings.hooks.json`, and reconciles only the commands whose script is one of `subagent_file_tools.mjs`, `io_economy_guard.mjs`, `context_guard.mjs` (script identified by regex on `.claude/hooks/<name>.mjs` inside a `command` hook). All existing registrations of those three are removed from every group (empty groups dropped), then the template groups are appended per event, so other hooks in the same group stay and the result is idempotent. A managed script whose installed file exists and whose digest differs from the manifest is `blocked`: its existing registrations are kept, its template registrations are not added, and `conflict .claude/hooks/<name>: local script differs; its registrations were kept unchanged` is printed (exit 2). The file is rewritten (two-space JSON, trailing newline) only when the serialized settings changed. Other keys (`env`, `permissions`, `enabledPlugins`) are untouched. `subagent_file_tools.mjs` is managed only to retire its old registration; the template no longer registers it.
- Proposal: KEEP the reconcile-only-our-commands rule and the blocked-on-local-edit rule; CHANGE the managed list to the new kit's hooks and derive it from the template instead of a hard-coded array.
- Source: kit:install.mjs:301-328, kit:tests/install-machine.test.mjs:81-101, kit:tests/install-machine.test.mjs:125-139
- Why it exists: tests `old native-file blocker registration is removed without dropping unrelated hooks` and `install copies shared assets, preserves settings/seeds and remains idempotent`.
- Test idea: run update twice with a user hook in the same group: settings bytes identical, user hook present.

### INS-21 Hook template content
- Behavior: `templates/settings.hooks.json` registers (all `type: command`, `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<x>.mjs"`, timeout 10): PreToolUse `io_economy_guard` for matcher `Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|mcp__filesystem__.*|mcp__fsbatch__.*|mcp__harness-files__.*`; PostToolUse `context_guard` for `*`; PostToolUse `io_economy_guard` for `Read|Grep|Glob|mcp__filesystem__.*|mcp__fsbatch__.*|mcp__harness-files__.*`; UserPromptSubmit `context_guard` (no matcher).
- Proposal: CHANGE: matchers lose `mcp__filesystem__`/`mcp__fsbatch__` (non-Claude MCP adapters dropped); hook set follows the hooks area.
- Source: kit:templates/settings.hooks.json:1-49
- Why it exists: not stated; hook behavior belongs to the hooks area.
- Test idea: after install the settings contain exactly one registration per template entry.

### INS-22 Installed project shape observed (WildEra settings)
- Behavior: wildera:.claude/settings.json holds the kit registrations plus project-owned hooks (`syntax_check.mjs` PreToolUse+PostToolUse, timeout 90, matcher `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_.*|mcp__fsbatch__(edit|write)_.*|mcp__filesystem__(edit|write)_.*`; `bash_long_command.mjs` PreToolUse for `Bash`) and `enabledPlugins: {"harness-files@paseo-harness-kit": true}`. `.claude/hooks/subagent_file_tools.mjs` is still in the manifest and on disk although no longer registered. kit-init tells the agent to use a timeout of about 30 s and the matcher `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_.*`; WildEra uses timeout 90 and also matches `mcp__fsbatch__(edit|write)_.*|mcp__filesystem__(edit|write)_.*` (wildera:.claude/settings.json:15, 57).
- Proposal: KEEP the principle that kit hooks and project hooks coexist in one settings file; DROP the retired `subagent_file_tools.mjs` from the new kit.
- Source: wildera:.claude/settings.json:1-82, wildera:.agents/harness-kit.json:50, kit:user/skills/kit-init/SKILL.md:56-58
- Why it exists: not stated.
- Test idea: install into a project that already has a project hook: after update both registrations exist.

### INS-23 CLAUDE.md import line
- Behavior: `ensureImports` makes `CLAUDE.md` carry `@AGENTS.md`: lines equal to the old import `@.claude/harness-io.md` are dropped; a missing `@AGENTS.md` is inserted at the end of the leading run of `@` lines (top when none), with one blank line after it when the file starts with other text; file EOL preserved; a new file is the import plus EOL; nothing written when nothing changes. Prints `CLAUDE.md: added @AGENTS.md, removed N old kit import(s)` or `CLAUDE.md already imports AGENTS.md`. WildEra's CLAUDE.md is the single line `@AGENTS.md`.
- Proposal: KEEP (Claude Code reads CLAUDE.md, not AGENTS.md); drop the old-import removal.
- Source: kit:install.mjs:49-50, kit:install.mjs:372-385, kit:install.mjs:390-392, wildera:CLAUDE.md:1
- Why it exists: the older kit imported `.claude/harness-io.md`; its rules moved to the AGENTS.md block (kit:install.mjs:50).
- Test idea: CLAUDE.md with `@a` and text: result is `@a`, `@AGENTS.md`, blank, text; second run changes nothing.

### INS-24 Seeds created once, never overwritten
- Behavior: if missing, copies `templates/harness.config.json` -> `.agents/harness.config.json` and `templates/harness-history.md` -> `.agents/harness-history.md`, printing `created <rel>`. Existing files are never touched and are not in the manifest. The config template is only `_notes` (project-only differences over `.agents/harness.defaults.json`; machine keys `agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env`, `main_provider_disallowed_tools`, `agent_mcp` are ignored in the overlay). The history template: a header, a statement that CLAUDE.md does not import the file, and an empty table `| Date | Change | Scope | Reason |`.
- Proposal: KEEP seed-once for the project adapter config (GSD adapter, owner decision); CHANGE contents to the new adapter schema; OPEN whether `harness-history.md` survives (history area decides).
- Source: kit:install.mjs:58-59, kit:install.mjs:394-397, kit:templates/harness.config.json:1-3, kit:templates/harness-history.md:1-8, kit:project/.agents/harness/config.mjs:9
- Why it exists: "the project's own settings and change history" (kit:install.mjs:58).
- Test idea: pre-existing overlay `{max_subagents: 7}` is byte-identical after install and update.

### INS-25 wire(): fixed order of untracked steps
- Behavior: after the copy loop, `wire` does: mergeHooks (prints `reconciled kit hook registrations in .claude/settings.json (unrelated hooks preserved)`), enablePlugin, ensureImports, skills-sync (INS-26), seeds. It returns blocked-hook count plus skill-conflict count (skill conflicts count 1 in total), which feeds exit 2. The manifest is written after wire, so a failure thrown inside wire (skills-sync error, plugin install error) leaves the manifest unwritten and exits 1 without the `installed paseo-harness-kit` line.
- Proposal: KEEP the fail-before-manifest property (no false success claim); CHANGE: make the wiring steps a list the new kit can extend.
- Source: kit:install.mjs:387-399, kit:install.mjs:416-421, kit:tests/install-machine.test.mjs:103-109
- Why it exists: test `skills-sync failure propagates and does not claim installation success`.
- Test idea: fake skills-sync exits 9: install exits 1, stderr `skills-sync failed (9)`, stdout lacks `installed paseo-harness-kit`; a second install without the failure succeeds.

### INS-26 skills-sync call from the installer
- Behavior: spawns `node <project>/.agents/skills/harness/scripts/paseo_harness.mjs skills-sync` with cwd = project and `PASEO_HARNESS_ROOT=<project>`. Exit 0 = ok; exit 2 = skills kept as copies: the `conflict ...` lines are echoed plus the last output line, return 1 (counts toward exit 2); on exit 0 the last output line (the `skills-sync: ...` summary) is still printed; any other status or a spawn error throws `skills-sync failed (<status|spawn>): <last line>` (exit 1). `ph skills-sync` itself prints `skills-sync: N skill link(s) created, N already linked, N stale owned link(s) removed[, N kept as copies (conflicts above)][; .gitignore block updated]` and returns 2 when any conflict.
- Proposal: CHANGE: call `linkSkills` in-process (update already imports it); the child-process hop exists only because the project copy of ph owns the command.
- Source: kit:install.mjs:273-282, kit:project/.agents/harness/runtime/commands.mjs:808-819
- Why it exists: README: a conflict does not stop the install; any other link error fails it (kit:README.md:52-54).
- Test idea: link conflict -> install exit 2 with manifest written; a permission error -> exit 1.

### INS-27 Plugin enabling (`--enable-plugin`) through Claude Code's own CLI
- Behavior: plain copy never activates the mod. Without the flag, enablePlugin only reads project `.claude/settings.json` and prints either `Claude Code file mod copied; enabled in this project already (unchanged); ph doctor reports readiness` (when `enabledPlugins["harness-files@paseo-harness-kit"] === true`) or `... activation not changed or verified. To enable explicitly: install.mjs update <project> --enable-plugin (Claude Code >=2.1.296) ...`. With the flag (install or update only; also requires `nodeRuntimeReady`, checked before anything is written): (1) `claude --version` must succeed and be >= 2.1.296, else Fail `file mod requires Claude Code >=2.1.296; version check failed or unsupported`; (2) the project must contain `.claude/plugins/harness-files/.claude-plugin/plugin.json` and `.claude/plugins/.claude-plugin/marketplace.json`, else Fail `file mod/marketplace manifest missing`; (3) every file under `.claude/plugins/harness-files/` plus the marketplace.json must be in the manifest with an equal digest, else Fail `file mod has untracked or locally modified assets; resolve conflicts before enabling`; (4) run `claude plugin install harness-files --marketplace <project>/.claude/plugins --scope project` with cwd = project and the inherited environment (so `CLAUDE_CONFIG_DIR` decides which user config receives the marketplace registration); non-zero or spawn error -> Fail `plugin install failed (<status>): <output>`. The CLI itself edits `.claude/settings.json` (`enabledPlugins`); existing `env`, permissions and other plugin entries are preserved. Final line states that the marketplace is registered at user scope and current-session activation is not verified; no daemon reload/restart. Project settings `env` (`CLAUDE_CODE_PLUGIN_DIRS`) cannot load a plugin.
- Proposal: KEEP (explicit, fail-closed, uses the supported CLI, never edits `enabledPlugins` by hand); CHANGE: the new kit decides whether activation is default-on for the mod it ships (OPEN, see Open questions); keep the three preconditions (version, assets present, assets unmodified).
- Source: kit:install.mjs:25-27, kit:install.mjs:61-62, kit:install.mjs:340-370, kit:install.mjs:491, kit:tests/install-machine.test.mjs:164-177, kit:tests/install-machine.test.mjs:205-219, kit:tests/install-machine.test.mjs:339-359
- Why it exists: header and README: project settings env is not a plugin loader; activation must not be claimed after a plain copy (kit:README.md:66-78); tests `plugin activation fails closed on old versions, CLI failures and modified assets` and `missing path.matchesGlob ... blocks ... plugin enable before writes`.
- Test idea: fake claude CLI at 2.1.295 -> exit 1, no `plugin` call; modified mod asset -> exit 1 `locally modified assets`; success -> `enabledPlugins[...] === true`, args exactly as above, cwd = project, `CLAUDE_CONFIG_DIR` passed through, user settings keys unchanged.

### INS-28 Marketplace name is registered once per Claude config
- Behavior: before installing, `claude plugin marketplace list --json` is parsed (failure -> treated as none); the entry named `paseo-harness-kit` gives `path` (or `installLocation`). If it points at another folder than this project's `.claude/plugins` (case-insensitive compare on Windows), the two marketplace trees are compared by digest of every runtime file by relative path. Identical -> install with `claude plugin install harness-files@paseo-harness-kit --scope project` (no `--marketplace`), reusing the other project's folder (message names it: `the marketplace already registered from <path> (identical plugin files)`; the plugin finds and verifies this project's own backend at run time). Different -> Fail naming the folder, telling the owner to update that project to the current kit version or run `claude plugin marketplace remove paseo-harness-kit`; no install and no marketplace removal happen.
- Proposal: KEEP the rule (never replace another project's registration; reuse only when identical; stop otherwise); simplify if the new kit installs the mod from one user-level location (OPEN).
- Source: kit:install.mjs:333-338, kit:install.mjs:356-366, kit:install.mjs:330-331, kit:tests/install-machine.test.mjs:179-203
- Why it exists: "A marketplace name is registered once per Claude config, so a second project cannot add its own copy" (kit:install.mjs:360-361).
- Test idea: fake `marketplace list` returns an identical other copy -> install args without `--marketplace`; returns a differing copy -> exit 1 and no `plugin install` call.

### INS-29 Runtime gates: Node and Claude Code versions, Claude CLI lookup
- Behavior: `nodeRuntimeReady` = Node major >= 20 and `path.matchesGlob` is a function (requirement text: Node 20.17+ with path.matchesGlob; Node 24 LTS for the bundled tests). `MIN_CLAUDE_VERSION = 2.1.296`; `versionAtLeast(text)` parses the first `x.y.z` and returns true/false, or null when none. Claude CLI: `$CLAUDE_CLI`, else `~/.local/bin/claude(.exe)` when it exists, else `claude` on PATH; a `.js/.cjs/.mjs` CLI runs through the current node; on Windows anything not `.exe/.com` runs through cmd.exe as one quoted command line (npm `.cmd` shims, paths with spaces); The helper `claudeVersion` (10 s timeout) is NOT used by install or machine; both gates call `runClaude(['--version'])` with no timeout. Gates: install `--enable-plugin`: Node gate before any write (kit:install.mjs:491), but the Claude version check runs inside `enablePlugin` after units were copied and hooks merged, so a failure leaves copied files and merged hooks with the manifest unwritten; machine check reports `problem`; machine apply fails before any Paseo or `machine.local.json` write (kit:machine.mjs:325-327). `export` and install/update/status/pull without the flag run neither gate.
- Proposal: KEEP the min-Claude gate and one shared CLI lookup; CHANGE the Node gate to whatever the new kit actually uses (matchesGlob only if code needs it).
- Source: kit:project/.agents/harness/platform.mjs:7-41, kit:install.mjs:41, kit:install.mjs:491, kit:machine.mjs:263-268, kit:machine.mjs:325-327, kit:tests/install-machine.test.mjs:314-337
- Why it exists: tests `one Claude CLI lookup` and `shared Node capability gate retains capable Node 20/22 runtimes` (Node 20.16 and 22.4 lack matchesGlob).
- Test idea: the table in the shared-gate test (18.20.0/false -> false, 20.17.0/true -> true, 22.4.0/false -> false); `versionAtLeast('unknown') === null`.

### INS-30 Skill links: layout and scope
- Behavior: `.agents/skills/<name>/` is the only editable content tree; Claude Code reads `.claude/skills/<name>`, which is a per-skill link into `.agents/skills/<name>`. Skills = directories directly under `.agents/skills` (files ignored). Windows: a `junction` with the absolute target path; POSIX: a `dir` symlink with a relative target. Skills that exist only in `.claude/skills` are never touched. No `.agents/skills` folder -> nothing done (`{0,0,0,[]}`). If `.claude/skills` itself is a symlink: pointing at the real `.agents/skills` -> counted as already linked and only `/.claude/skills` is added to the .gitignore block; pointing elsewhere -> conflict `.claude/skills: an owner-selected link outside .agents/skills; kept, no skill linked`. Return value `{ linked, already, removed, conflicts, gitignore }`.
- Proposal: OPEN (see Open questions 11): the dual tree exists because `.agents/skills` is "the Agent Skills folder Codex, OpenCode and other harnesses read" and `.claude/skills` is the Claude Code link (kit:install.mjs:4-6, kit:project/.agents/harness/runtime/commands.mjs:811-813), harnesses the owner dropped. Options: keep per-skill links (CC reads one folder, edit another), or one tree under `.claude/skills` and drop junctions, the link record and the per-skill gitignore lines. DROP the whole-directory-symlink special case either way unless an owner uses it.
- Source: kit:project/.agents/harness/runtime/skills_links.mjs:1, kit:project/.agents/harness/runtime/skills_links.mjs:59-72, kit:project/.agents/harness/runtime/skills_links.mjs:105-108, kit:README.md:50-54, kit:tests/skills-links.test.mjs:16-27
- Why it exists: README: links rather than copies so edits show through; Claude-only skills survive (kit:README.md:80-81); test `skill links share one content tree, are idempotent and preserve Claude-only skills`.
- Test idea: create two skills, link, edit source, read via link; a Claude-only skill in `.claude/skills` is unchanged; second run reports `already`.

### INS-31 Skill link record `.agents/harness-skills-links.json`
- Behavior: `{ "version": 1, "links": { "<skill>": "<absolute source path>" } }` (two-space JSON, trailing newline, written via temp file + rename). It records which links the kit made so that (a) an old Windows junction whose absolute target moved can be recognised as owned and rebound, (b) a link whose source skill vanished can be removed. The record is validated first: `links` must be a plain object, names may not be `.`/`..` or contain a path separator, targets must be absolute strings, else the run throws `invalid generated skill-link record|entry` (exit 1 from the caller). The file is gitignored (INS-36). WildEra's record holds 11 skills with Windows backslash absolute paths.
- Proposal: KEEP the concept (only remove or rebind what the kit created); CHANGE: on POSIX relative links make the record unnecessary; keep it for Windows junctions.
- Source: kit:project/.agents/harness/runtime/skills_links.mjs:73-79, kit:project/.agents/harness/runtime/skills_links.mjs:125-128, wildera:.agents/harness-skills-links.json:1-16
- Why it exists: not stated; rebinding after a project move is exercised in kit:tests/skills-links.test.mjs:74-80.
- Test idea: record with a relative target or a `..` name -> run fails with `invalid generated skill-link`; moved project (Windows) rebinds all links.

### INS-32 Link-or-conflict decision per skill
- Behavior: for each skill `.claude/skills/<name>` (lstat): already a link to the source -> `already`, recorded; a link to something else -> owned only if its target equals the record's old target (an owned stale junction is replaced), otherwise Conflict `... is an owner-selected link`; a non-directory -> Conflict `... is not a skill folder`; a real directory (an old mirror copy) -> `verifiedCopy`: converted to a link only if provably the kit's mirror: every entry must be a regular file or directory (a nested symlink -> Conflict `skill copy contains an unowned nested link`, other types -> `non-regular entry`); a directory that does not exist in the source -> Conflict (delete or move into `.agents/skills`); a file is accepted if byte-equal to the source file, or its digest equals the installed manifest digest of `.agents/skills/<name>/<path>` (source changed since the copy); anything else -> Conflict (`differs from .agents/skills (edited in the copy, or the source changed since the last sync)` or `exists only in this copy (a retired file or one added under .claude)`). A Conflict keeps that skill as a copy, prints `conflict skill <name> kept as a copy, not linked: <why>`, and the other skills still link; nothing of the conflicting copy is changed. Non-Conflict errors abort the run.
- Proposal: DROP the mirror-copy verification (the new kit never created copies; it only existed to upgrade older installs); KEEP link-vs-owner-selected-link detection and "conflict is per skill, never fatal".
- Source: kit:project/.agents/harness/runtime/skills_links.mjs:10-11, kit:project/.agents/harness/runtime/skills_links.mjs:32-57, kit:project/.agents/harness/runtime/skills_links.mjs:80-100, kit:tests/skills-links.test.mjs:28-48
- Why it exists: tests `unchanged legacy copies become links; edited copies are not deleted` and `one conflicting skill is kept as a copy while the others still link`; README (kit:README.md:50-54, 80-81).
- Test idea: `.claude/skills/x` a hand-made directory: reported conflict, folder bytes unchanged, other skills linked, exit 2 via `ph skills-sync`.

### INS-33 Link replacement is preflighted and reversible
- Behavior: all decisions are made before any replacement. Each replacement renames the current entry to `<to>.link-backup-<uuid>`, creates the link, and on link failure renames the backup back and rethrows; after success the backup is unlinked (link) or removed recursively (directory). `.claude/skills` is created if missing. Each created link prints `linked <name>`.
- Proposal: KEEP rename-aside-then-restore for replacing an existing entry.
- Source: kit:project/.agents/harness/runtime/skills_links.mjs:101-117
- Why it exists: not stated; avoids losing a skill folder on a failed symlink creation.
- Test idea: make symlink creation fail (permissions) for one skill: the original folder is back in place.

### INS-34 Stale link removal
- Behavior: after linking, for each name in the old record that is neither relinked nor in conflict: if `.claude/skills/<name>` is a link whose target equals the recorded target it is unlinked (`removed stale skill link <name>`); anything else is left alone. A skill whose source folder was deleted therefore loses only its own link.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/skills_links.mjs:118-124, kit:tests/skills-links.test.mjs:68-73
- Why it exists: test `removed source skill removes its owned link, not unrelated skills`.
- Test idea: link, delete the source skill, rerun: link gone, a Claude-only skill intact, `removed` = 1.

### INS-35 Moving a project
- Behavior: Windows junctions hold an absolute target, so after the project folder moves the record's old target is the owned stale target and `skills-sync` rebinds every link; POSIX relative links keep working. README tells the owner to run `ph skills-sync` after moving a Windows project.
- Proposal: KEEP the documented step; CHANGE: install/status could detect dangling junctions and say so.
- Source: kit:project/.agents/harness/runtime/skills_links.mjs:85-88, kit:tests/skills-links.test.mjs:74-80, kit:README.md:80
- Why it exists: test `Windows moved projects rebind an owned old junction; POSIX relative links move naturally`.
- Test idea: rename the project folder, run sync, read a file through `.claude/skills/<name>`.

### INS-36 `.gitignore` block owned by the kit
- Behavior: `updateGitignore(root, linkedPaths)` keeps one block in the project's `.gitignore`, from `# >>> paseo-harness-kit: generated paths, kept by install.mjs and ph skills-sync (edit outside this block)` to `# <<< paseo-harness-kit`, containing `/_workspace/`, `/.claude/worktrees/`, `/.agents/harness-skills-links.json`, then each linked skill as `/.claude/skills/<name>` (sorted; the characters `\ [ * ?` in a name are backslash-escaped). The block is created at the end of the file (or the file is created) separated by a blank line, replaced in place when present (lines before and after are never touched), EOL follows the file (CRLF if present); no write when the text is unchanged. Skills kept as the owner's copies are not listed, so they stay tracked. The block is rewritten on every `linkSkills` run that reaches the record write or the whole-directory-link case; it is not touched when `.claude/skills` is an owner-selected link elsewhere. The kit's own `.gitignore` is separate: `node_modules/`, `*.tmp`, `machine.local.json`. Verified by git: ignored `_workspace/_runs/x`, `.claude/skills/<name>`, `.agents/harness-skills-links.json`, `.claude/worktrees/...`; not ignored `.agents/skills/harness/SKILL.md`, `.agents/harness-kit.json`, `.claude/settings.json`, `.gitignore`.
- Proposal: KEEP (junctions hold absolute paths so must not be committed; owner lines untouched); CHANGE: the block's entries follow the new kit's generated paths (`.planning/` stays tracked; confirm `_workspace/`).
- Source: kit:project/.agents/harness/runtime/skills_links.mjs:13-30, kit:project/.agents/harness/runtime/skills_links.mjs:129-130, kit:.gitignore:1-3, wildera:.gitignore:1-16, kit:tests/skills-links.test.mjs:49-67, kit:tests/install-no-tests.test.mjs:35-40
- Why it exists: comment at kit:project/.agents/harness/runtime/skills_links.mjs:13-15 (absolute junction must not be committed; copies are the owner's).
- Test idea: `.gitignore` of `node_modules/\r\n` + block + `dist/\r\n`: after a new skill, text before/after unchanged, one block, new line ends `\r\n`; `.gitignore` = `build` (no EOL) becomes `build\n\n# >>> paseo-harness-kit`.

### INS-37 machine.mjs CLI and exit codes
- Behavior: `node machine.mjs check | apply [--dirs C:/,D:/] [--fs-server F] [--remove-local <project>]... [--no-reload] [--enable-paseo-plugins] | export`. Boolean flags `--no-reload`, `--enable-paseo-plugins`; value flags `--dirs`, `--fs-server`, `--remove-local` (repeatable); anything else (including a value flag without value) -> `unknown argument <a>` exit 1; unknown command -> usage, exit 1. Exceptions: `failed: <msg>` for expected failures, `error: <msg>` otherwise, exit 1. `check` exits 0, or 2 when any `problem` was counted, or 1 when the Paseo config cannot be read; `export` exits 0 or 1; `apply` exits 1 on a gate/`Fail` or a sync status other than 0 or 2, 2 when the sync returns 2 (no follow-up check), and otherwise the follow-up check's code (so a successful write still exits 2 when check reports a problem, e.g. a missing Backlog CLI). Codes: kit:machine.mjs:321, 354-357.
- Proposal: CHANGE: keep `check|apply|export` and the `--no-reload` and `--enable-paseo-plugins` semantics where the feature survives; DROP `--dirs`, `--fs-server`, `--remove-local` with the MCP adapters.
- Source: kit:machine.mjs:321, kit:machine.mjs:354-357, kit:machine.mjs:360-381
- Why it exists: not stated.
- Test idea: `machine.mjs bogus` and `machine.mjs apply --nope` exit 1 with no file written.

### INS-38 machine check (read-only)
- Behavior: prints `ok <text>` or `problem <text>` lines (exit 2 if any problem, else 0). Order: node gate; platform line (always ok); `criticalVersion: Claude Code <x.y.z|unknown/unavailable>; direct file mod requires >=2.1.296`; a `note` that mod activation is project/session-local and copied files do not prove it (points at `install.mjs update <project> --enable-plugin` and `ph doctor`); per template provider: `Paseo provider <name> is missing from <file>` or `lacks the models <ids>` (else one ok line listing providers); legacy MCP lines (problem when kit-owned, ok when user-owned); the `machine.local.json` note only when `--dirs`/`--fs-server` was given or the file exists; Paseo plugin lines (problems only with `--enable-paseo-plugins`, else `note optional ...`); Backlog CLI version vs tested pin; then every line of `sync_agent_provider.mjs` (check mode) re-reported with its own ok/problem, `sync_agent_provider.mjs failed (...)` on spawn error or status other than 0/2, and `reports policy drift` if it exited 2 without a `problem ` line. It never writes Paseo config, never probes a model (no paid probes), never starts a daemon. A missing/unreadable Paseo config throws -> exit 1.
- Proposal: KEEP the contract (read-only, ok/problem lines, exit 2 on problems); DROP the MCP, `machine.local.json`, Backlog and Paseo-panel lines; keep the Claude-version and provider/model/policy lines.
- Source: kit:machine.mjs:292-322, kit:tests/install-machine.test.mjs:221-231, kit:tests/install-machine.test.mjs:339-359
- Why it exists: header "read-only readiness ..., never paid probes" (kit:machine.mjs:3).
- Test idea: byte-compare the Paseo config before and after `check`; Claude 2.1.295 -> exit 2 and a `criticalVersion` line; only `--version` calls reach the fake CLI.

### INS-39 machine apply
- Behavior: order: node gate (Fail before writes), Claude version gate (Fail before writes), load template rendered with the kit policy, add missing providers/models to the live Paseo config in memory (INS-41), optionally enable Paseo plugins (INS-47); only if this step added providers, models, `metadataGeneration` or plugin entries (`done` non-empty): copy the live config to `<config>.bak-<YYYY-MM-DD>-kit`, write the new config atomically (temp file + rename), print each change as `paseo: <what>` and `paseo: backup <path>`; else `paseo: every template provider/model is present; plugin enabling remains explicit`. Then (flag) npm ci for kit Paseo plugins, retire proven legacy MCP registrations (INS-46), write `machine.local.json` if out of date (INS-46), then run `sync_agent_provider.mjs --apply [--no-reload]` with inherited stdio; a non-zero status ends apply (returns 2 if the sync returned 2, else 1) without the follow-up check. On success prints that configuration was safely reloaded through provider sync (or that reload was skipped) with `no daemon restart performed`, then `--- check` and the full check output; exit code is the check's. The later policy sync (deny lists, env) rewrites the Paseo config with no backup, so the common case (providers present, only policy changes) leaves no `.bak-*-kit` file. Apply never restarts the daemon and never registers Claude file MCP servers.
- Proposal: KEEP (additive, backup, atomic write, explicit reload only, check at the end); CHANGE: reload through the Paseo CLI only (INS-53).
- Source: kit:machine.mjs:324-358, kit:tests/install-machine.test.mjs:233-253, kit:tests/install-machine.test.mjs:295-312
- Why it exists: header "never restarts the daemon" (kit:machine.mjs:5-6); tests `machine apply rejects old Claude before writes and propagates policy synchronization failures`, `... propagates safe configuration reload failures without any restart`.
- Test idea: fake Paseo config + fake sync that fails (exit 9): apply exits 1, no `--- check` in stdout; Claude 2.1.295: exit 1, config byte-identical, no `machine.local.json`.

### INS-40 Backup naming and atomic JSON write
- Behavior: backup file is `<paseo config>.bak-<date UTC>-kit` (same-day applies overwrite it; written only when the provider/plugin step changed something, INS-39); JSON writers use `<file>.<pid>.tmp` + rename, two-space indent, trailing newline. `.gitignore` ignores `*.tmp` in the kit. `PASEO_HOME` (default `~/.paseo`) holds `config.json`; providers are read from `agents.providers` (fallback `providers` in the sync code).
- Proposal: KEEP; CHANGE: timestamped (not date-only) backups so two applies on one day keep both.
- Source: kit:machine.mjs:40, kit:machine.mjs:51, kit:machine.mjs:331-333, kit:project/.agents/harness/runtime/provider_sync.mjs:9-10, kit:project/.agents/harness/runtime/provider_sync.mjs:93-97
- Why it exists: not stated.
- Test idea: two applies on the same day: two distinct backups exist and the first equals the original config.

### INS-41 Additive provider/model plan
- Behavior: for each provider in the rendered template: if absent in the live config -> add the whole provider (`added provider <name>`, with secrets filled, INS-43); if present -> append only models whose `id` is missing (`added to <name>: <ids>`), never edit or remove existing fields, models, credentials. `metadataGeneration` is copied from the template only if the live config has none. Existing entries are never changed.
- Proposal: KEEP.
- Source: kit:machine.mjs:82-92, kit:machine.mjs:104-115, kit:paseo/providers.json:2
- Why it exists: header "Existing provider credentials/catalogue entries are preserved" (kit:machine.mjs:7).
- Test idea: live config with `tools.user`, a user plugin and a provider with a custom model: after apply they are unchanged and only missing model ids were appended.

### INS-42 Policy rendered into the template
- Behavior: before check/apply, the template is rewritten in memory: for providers that are values of `agent_providers` (workers) `disallowedTools := agent_provider_disallowed_tools` and `env := template env + agent_provider_env`; for providers that are keys (mains) `disallowedTools := template list + main_provider_disallowed_tools` (deduplicated). Others untouched. Defaults today: `agent_providers {circle: circle-agent}`; worker denies Agent, AskUserQuestion, CronCreate/Delete/List, DesignSync, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, ListAgents, Monitor, PushNotification, ReportFindings, ScheduleWakeup, WebSearch, Workflow; worker env `ENABLE_TOOL_SEARCH=true`; main denies Agent, Workflow, SendMessage.
- Proposal: KEEP the machine-key mechanism (owner: `main_provider_disallowed_tools` carries the Agent/Workflow denial to other machines); CHANGE: re-derive the deny lists for the new kit (SendMessage was added to the main list after the owner note; confirm both).
- Source: kit:machine.mjs:94-102, kit:project/.agents/harness.defaults.json:33-63, kit:project/.agents/harness/config.mjs:9
- Why it exists: owner decision 2026-10-14 (memory main-session-no-native-subagents; kit:project/.agents/harness.defaults.json:58).
- Test idea: after apply on a fresh Paseo config, `circle` denies Agent+Workflow+SendMessage and `circle-agent` denies exactly the worker list.

### INS-43 Secrets: placeholders in the kit, values only at apply time
- Behavior: values that never enter the kit are any env value whose key matches `/TOKEN|KEY|SECRET|PASSWORD|BASE_URL/i`. Template syntax: `{{secret:NAME}}`, and `{{HOME}}` for a path under the user's home (case-insensitive prefix match, forward slashes). On apply a missing provider is built by `fromTemplate`: keys starting with `_` are dropped, `{{secret:NAME}}` is replaced from, in order: env `PASEO_KIT_<NAME>`; a live provider with the same `extends` that already has `env[NAME]` (so `circle-agent` reuses `circle`'s token); env `<NAME>`; otherwise Fail `no value for the secret NAME: set the environment variable PASEO_KIT_NAME` (nothing written). `{{HOME}}...` becomes `path.join(homedir, ...)`.
- Proposal: KEEP placeholders, the three-source lookup and fail-before-write; CHANGE the peer lookup to match the same `ANTHROPIC_BASE_URL` (see Concerns: code matches by `extends`, text says by base URL).
- Source: kit:machine.mjs:27-29, kit:machine.mjs:55-80, kit:paseo/providers.json:7-11 (placeholders; the `_notes` at kit:paseo/providers.json:2 says `$PASEO_KIT_NAME` or a live provider with the same base URL and omits `$NAME`, see C-9)
- Why it exists: the endpoint (base URL) is also treated as secret (history: endpoint was scrubbed from branch history, memory omp-migration-policy).
- Test idea: apply with a missing provider and no secret in any source: exit 1, live config unchanged; with `PASEO_KIT_ANTHROPIC_AUTH_TOKEN` set: provider added with the value.

### INS-44 machine export (live config -> scrubbed template)
- Behavior: reads the live Paseo config; provider names = all keys and values of `agent_providers`; missing live provider -> Fail. For each: strip live `disallowedTools`; collect its secret env values; convert via `toTemplate` (secret-keyed strings -> `{{secret:KEY}}`, home prefix -> `{{HOME}}`); additionally replace any occurrence of a secret value, and of its URL host if it is a URL, in every other string (e.g. a description naming the endpoint host) by the placeholder; workers get `disallowedTools` and env from the kit config, mains get live denies plus the main list. Output object has `_notes` (explaining placeholders, apply semantics, reload, no restart), `providers`, and `metadataGeneration` if the live config has one. Before writing it asserts that none of the collected secret values occurs in the text; otherwise Fail `a secret would be written into the template; not written`. Writes `paseo/providers.json`, prints `wrote <path>: providers ..., (secrets as {{secret:NAME}}, home folder as {{HOME}})`. Never changes the live config.
- Proposal: KEEP (including the post-render leak assertion and host scrub); CHANGE: write atomically; do not rely on value substring for very short values.
- Source: kit:machine.mjs:55-62, kit:machine.mjs:117-150, kit:tests/install-machine.test.mjs:361-373
- Why it exists: test `machine export renders canonical policy and scrubs credentials without changing live providers`; providers.json description once named the endpoint via placeholder (kit:paseo/providers.json:7).
- Test idea: live token `fixture-secret`: exported file does not contain it, has `{{secret:ANTHROPIC_AUTH_TOKEN}}`, live config byte-identical.

### INS-45 Shipped provider catalogue `paseo/providers.json`
- Behavior: two providers, both `extends: claude`. `circle` ("Claude Code (Circle)"): env `CLAUDE_CONFIG_DIR={{HOME}}/.claude-circle`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` as secret placeholders, `ANTHROPIC_DEFAULT_OPUS_MODEL=gpt-6-luna-fast[1m]`, `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5-5[1m]`, `ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5`, `API_TIMEOUT_MS=3000000`; `disallowedTools [Agent, Workflow]`. `circle-agent` ("Claude Code (Circle, harness agents)"): same env except `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5-5[1m]` and `ENABLE_TOOL_SEARCH=true`; no `disallowedTools` stored (rendered from config). Both list the same 9 models: `claude-opus-5-5[1m]`, `claude-sonnet-5-5[1m]` (default; thinking off..max, default high), `claude-haiku-4-5`, `gpt-6.1-sol[1m]`, `gpt-6.1-sol-fast[1m]`, `gpt-6-astra[1m]`, `gpt-6-astra-fast[1m]`, `gpt-6-luna-fast[1m]`, `gemini-3.8-flash-high[1m]` (thinking only high); thinking options low/medium(default)/high/xhigh/max for the GPT and Opus models. `metadataGeneration.providers = [{provider: circle, model: gemini-3.8-flash-high}]`. The circle-agent description records owner 2026-10-04: removed tools that agents never called, to shrink the per-turn tool schema; native Read/Edit/Write stay available.
- Proposal: KEEP as the template for owner-decided models (other-vendor models run inside Claude Code through `circle`); CHANGE: refresh ids/labels with the owner, regenerate through `export`, drop `_notes` text about harness-specific tools; OPEN: why `circle` maps the opus alias to luna-fast.
- Source: kit:paseo/providers.json:1-468
- Why it exists: description text kit:paseo/providers.json:236 and 2.
- Test idea: `export` on a machine with the same providers reproduces the file modulo ordering; apply on an empty Paseo config creates both providers with the nine models.

### INS-46 Legacy file-MCP registrations and `machine.local.json` (what they did)
- Behavior: `fsbatch` and `filesystem` MCP servers (kit `mcp/mcp_fs_batch.mjs`, `mcp_fs_proxy.mjs`, optional global `@modelcontextprotocol/server-filesystem` pinned 2026.8.31) were once registered in the Claude user config. `check` classified a registration kit-owned only if `command` equals this node and `args[0]` equals `<kit>/mcp/<script>` for this kit or any kit path recorded in manifests of projects known to `.claude.json`; a same-named server of the owner is preserved. `apply` retired kit-owned user-scope entries with `claude mcp remove --scope user <name>`, and local-scope entries only for projects named by `--remove-local` (nonexistent project -> message). No replacement is registered. `machine.local.json` (kit root, gitignored) held the MCP command lines for non-Claude agents, rewritten when out of date.
- Proposal: DROP both (owner: Claude Code only, non-Claude MCP adapters dropped). OPEN: whether the new `machine check` should still report/retire dangling old registrations on owner machines (see Open questions).
- Source: kit:machine.mjs:25-26, kit:machine.mjs:33, kit:machine.mjs:199-259, kit:machine.mjs:263-288, kit:machine.mjs:340-352, kit:tests/install-machine.test.mjs:233-253
- Why it exists: header: "retire ONLY inspected kit-owned old Claude MCP registrations" (kit:machine.mjs:4-5); memory omp-migration-policy notes the owner's user-scope MCP servers in ~/.claude-circle point at kit/mcp/*.mjs.
- Test idea: n/a if dropped; if kept: user-owned `filesystem` survives, proven `fsbatch` removed.

### INS-47 Paseo plugins (backlog/swarm panels) enabling
- Behavior: `paseo/plugins/*/paseo-plugin.json` (`backlog-plugin`, `swarm-plugin`) are Paseo plugins run from the kit folder. Only with `--enable-paseo-plugins`: `apply` sets `pluginsEnabled: true`, registers each as `{source: 'directory', path: <kit plugin dir>, enabled: true}` (an existing entry that points elsewhere is kept and reported `conflict Paseo plugin <id>: user entry kept`), runs `npm ci` in the plugin folder when `node_modules` is missing (600 s timeout), and hints `paseo plugin reload <id>`. `check` reports plugin lines as `problem` only with that flag, otherwise as optional notes.
- Proposal: DROP the backlog panel (Backlog dropped); OPEN for the swarm panel (ui area decides); if kept, KEEP explicit opt-in and the keep-user-entry rule.
- Source: kit:machine.mjs:30, kit:machine.mjs:152-197, kit:machine.mjs:310-313, kit:machine.mjs:337-339, kit:README.md:152
- Why it exists: README: enabling trusted global plugins is an explicit action (kit:README.md:152).
- Test idea: apply without the flag leaves `pluginsEnabled` and `plugins` byte-identical (the fixture's user plugin entry).

### INS-48 Backlog CLI check in machine check (what it did)
- Behavior: `check` ran `backlog --version` (npm global shim) and reported `Backlog.md CLI <v> (tested 1.53.0)` or `not found (npm i -g backlog.md@1.53.0)` as a problem.
- Proposal: DROP.
- Source: kit:machine.mjs:31, kit:machine.mjs:314-316
- Why it exists: Backlog dependency.
- Test idea: check on a machine without `backlog` exits 0 (given the rest ok).

### INS-49 Provider sync check: worker providers
- Behavior: `agentProviderLines(cfg, file)` returns `{ok, text}` lines. Fails (problem) when the defaults have no `agent_provider_disallowed_tools` list, the Paseo config cannot be read, or has no providers section (`agents.providers`, else `providers`). For each `source -> target` in `agent_providers`: target missing -> `agent provider <target> (copy of <source>) is missing ...; run sync_agent_provider.mjs --apply`; a present non-array `disallowedTools` -> owner review (absent or null is treated as `[]`, no rules yet, not a problem); missing required tools and env keys are listed; extra owner rules are counted as `owner extra rule(s) preserved` and are not a problem. Required tools = defaults list without any `mcp__paseo__*` entry. For Claude-type providers (`isClaudeProvider`: runtime/harness/type metadata, `extends` chain, or name `claude|circle[-agent]`) native file denies (`Read, Edit, MultiEdit, Write, NotebookEdit`) are a problem because they defeat the file mod and native fallback; the text says whether the list is the proven 0.0.2 kit policy (apply retires four file denies) or needs manual owner review.
- Proposal: KEEP missing-tool/env diagnostics with owner extras preserved; DROP the native-file-deny and 0.0.2 provenance branches (new kit starts clean); CHANGE: `isClaudeProvider` collapses to "every provider is Claude Code".
- Source: kit:project/.agents/harness/runtime/provider_sync.mjs:11, kit:project/.agents/harness/runtime/provider_sync.mjs:16-17, kit:project/.agents/harness/runtime/provider_sync.mjs:25-47, kit:project/.agents/harness/config.mjs:114-129
- Why it exists: the earlier kit denied native Edit/Write for workers; moving to a file mod made those denies harmful (kit:project/.agents/harness/runtime/provider_sync.mjs:40-43).
- Test idea: worker provider lacking one required tool -> `problem ... not disallowed: <tool>` and exit 2; adding an owner-only deny keeps ok and prints `owner extra`.

### INS-50 Provider sync check: main providers
- Behavior: for every key of `agent_providers` (the main sessions) when `main_provider_disallowed_tools` is non-empty: missing provider -> problem; non-array `disallowedTools` -> owner review; missing tools -> `main provider <name> lacks <tools> (main sessions orchestrate through Paseo, not native subagents); run sync_agent_provider.mjs --apply`; else ok `main provider <name>: <tools> disallowed (orchestration goes through Paseo)`.
- Proposal: KEEP.
- Source: kit:project/.agents/harness/runtime/provider_sync.mjs:13-15, kit:project/.agents/harness/runtime/provider_sync.mjs:48-57
- Why it exists: owner 2026-10-14, memory main-session-no-native-subagents.
- Test idea: `circle` without `Workflow` -> problem line; after apply -> ok.

### INS-51 Provider sync apply: patch rules
- Behavior: `patchAgentProviders(cfg, pc)` works on a deep copy. For each `source -> target`: `source === target` throws; a missing worker is cloned from the live source (deep copy, label `<label> (harness agents)`, description `Copy of <source> for harness agents; additive kit requirements managed by sync_agent_provider.mjs`), the source missing throws; a present non-array `disallowedTools` throws (absent/null is `[]`). Worker `disallowedTools` = union(existing owner rules, required tools) with duplicates removed (never removes owner rules), unless the list is an unproven native-file-deny list on a Claude provider (then nothing is added, the owner must migrate: adding to it could recreate the old fingerprint and make a later apply delete owner rules). Worker `env` = existing env + `agent_provider_env` (kit values win for its keys). After the workers (so a clone copies the source as the owner left it), each main provider gets `disallowedTools` = union(existing, `main_provider_disallowed_tools`). Other providers, Paseo tool/browser/skill selections and plugins are untouched.
- Proposal: KEEP union-only, clone-from-source and mains-after-workers ordering; DROP the unproven-native-file-deny branch.
- Source: kit:project/.agents/harness/runtime/provider_sync.mjs:59-92
- Why it exists: comments at kit:project/.agents/harness/runtime/provider_sync.mjs:71, 79-80, 84; owner rule: no kit overrides of another tool's settings (memory no-kit-overrides-of-tool-settings).
- Test idea: owner extra deny `Bash(rm *)`-style entry survives; running apply twice yields identical bytes.

### INS-52 Provenance-gated retirement of four obsolete file denies
- Behavior: a worker `disallowedTools` list whose sorted JSON SHA-256 equals `5ae422146f8be32a1e031e1340de6d04a84f3acb0842331ec6e6d3e9300a79ac` (the exact 0.0.2 kit policy) loses only `Edit, MultiEdit, Write, NotebookEdit`; any added, deleted or duplicated rule breaks the fingerprint, so owner-edited lists are never auto-migrated.
- Proposal: DROP (migration of a retired policy). Keep the idea "remove only what is proven to be ours" (INV-6).
- Source: kit:project/.agents/harness/runtime/provider_sync.mjs:16-24, kit:project/.agents/harness/runtime/provider_sync.mjs:75-78
- Why it exists: "Store provenance, not another defaults map" (kit:project/.agents/harness/runtime/provider_sync.mjs:19).
- Test idea: n/a if dropped.

### INS-53 Provider sync apply: write and reload
- Behavior: `applyAgentProviders` patches then writes `<config>.<pid>.tmp` and renames over the Paseo config (no backup here; machine apply backs up only when its own provider/plugin step changed the file, so a policy-only write has none). Reload: tries, in order, `$PASEO_CLI`, `paseo` on PATH, and on Windows `%APPDATA%\npm\paseo.cmd`, `%LOCALAPPDATA%\Programs\Paseo\resources\bin\paseo.cmd`, `%ProgramFiles%\Paseo\resources\bin\paseo.cmd` (absolute candidates are skipped when the file is missing) and runs `"<cli>" reload`; first success returns its trimmed output; if all fail it throws the joined errors (`paseo reload failed (...); run it yourself`, exit 1, config already written). `--no-reload` skips it. The kit never restarts the daemon.
- Proposal: KEEP (reload is a config reload only); CHANGE: shorter candidate list (CLI on PATH or `$PASEO_CLI`), a reload failure after a successful write should be exit 2 (applied, reload pending), not 1.
- Source: kit:project/.agents/harness/runtime/provider_sync.mjs:93-108, kit:project/.agents/harness/runtime/provider_sync.mjs:115-121, kit:tests/install-machine.test.mjs:306-312
- Why it exists: owner/README: never recommend restarting a live daemon (kit:machine.mjs:336).
- Test idea: fake reload that fails: apply exits non-zero with `paseo reload failed`, config already carries the denies; `--no-reload` makes zero reload calls.

### INS-54 `sync_agent_provider.mjs` CLI and exit codes
- Behavior: `sync_agent_provider.mjs [--apply [--no-reload]]`. Unknown argument -> message `unknown argument: ...` plus usage, exit 1. Defaults not loadable -> `cannot load harness defaults: ...` exit 1. With `--apply`: patch errors -> `not applied: <msg>` exit 1; success prints `merged required worker tools and env settings, and the main providers' denied tools, into <file>; only exact proven 0.0.2 kit policies shed four obsolete file denies; owner extras and Paseo selections preserved`, then reload (INS-53). Check lines `ok|problem <text>` are printed only when apply was not requested, or apply succeeded and reload succeeded or `--no-reload` was set; `--apply` returns 1 earlier on `not applied: ...` or on `paseo reload failed (...); run it yourself` (config already written). Exit 0 when all check lines are ok, else 2. `--no-reload` without `--apply` is accepted and is a plain check. The Paseo config path is `$PASEO_HOME/config.json` (default `~/.paseo/config.json`). The file in `.agents/skills/harness/scripts/` is a 9-line shim: it imports `runtime/provider_sync.mjs` through `sharedUrl(...)` (`shared_paths.mjs`, not read) and re-exports `paseoConfigPath, agentProviderLines, patchAgentProviders, applyAgentProviders, syncMain, LEGACY_002_POLICY_SHA256, isLegacyKitPolicy`, running `syncMain` only when invoked directly (so it works from the skill mirror).
- Proposal: KEEP the check-by-default / `--apply` explicit shape and ok/problem lines; CHANGE: drop the shim and expose the same function as a `ph` or kit subcommand.
- Source: kit:project/.agents/harness/runtime/provider_sync.mjs:109-125, kit:project/.agents/skills/harness/scripts/sync_agent_provider.mjs:1-9
- Why it exists: "Stable check/apply entry point, including execution from the skill mirror" (kit:project/.agents/skills/harness/scripts/sync_agent_provider.mjs:2).
- Test idea: no args never writes; `--bogus` exit 1; a clean config exits 0.

### INS-55 Installed project is self-contained
- Behavior: an installed project carries its own defaults (`.agents/harness.defaults.json`), loader and runtime; moving or renaming the kit folder does not break loading the project's config (`loadConfig(project)` returns the shipped defaults). Only provenance (`installedRoot`) and `pull` use the kit path.
- Proposal: KEEP.
- Source: kit:tests/install-machine.test.mjs:255-264, kit:README.md:24-26, kit:project/.agents/harness/config.mjs:19-22
- Why it exists: test `installed canonical config remains portable when central kit is moved`; memory omp-migration-policy: "a project carries everything it runs on, no kit path".
- Test idea: install, rename the kit folder, load the project's config from the project.

### INS-56 kit-init user skill
- Behavior: a user-level skill (`user/skills/kit-init`, linked not copied into the user's Claude skills folder, e.g. `New-Item -ItemType Junction -Path $env:USERPROFILE\.claude\skills\kit-init -Target <kit>\user\skills\kit-init`) so a project without the kit can be initialised. Trigger: init/initialize/set up/bootstrap a project (also Vietnamese phrases), `/kit-init`; not Claude Code's built-in `/init`. Target = cwd unless named. Kit root = realpath of the skill folder, up two levels; must contain `install.mjs` and `kit.json`. Steps, each reported in one line, ending with done/skipped/needs-owner summary: (1) Git: `git -C <project> rev-parse --show-toplevel`: fails -> ask before `git init`, no commit afterwards; prints a parent folder -> tell the owner, ask whether to continue there or make a separate repo; uncommitted changes are announced before install. (2) Requirements reported, nothing installed globally without asking: Node 20.17+, Claude Code 2.1.296+, Paseo CLI and running daemon, Backlog CLI. (3) `install` if `.agents/harness-kit.json` is missing else `update`, with `--enable-plugin`, under the intended `CLAUDE_CONFIG_DIR`; exit 2 = report conflicts, never add `--force` or `pull` without the owner's decision; then `install.mjs status` and `ph doctor`, report every `problem` line; new hooks/mod need a new Claude session. (4) Write a project-owned `.claude/hooks/syntax_check.mjs` (Node std lib, per language: TS `transpileModule`/`createSourceFile` of the edited file, JS `node --check`, JSON parse, C/C++ `-fsyntax-only` with flags from `compile_commands.json`, Python `py_compile`, others only if cheap) registered for PreToolUse and PostToolUse; rules: compare before/after via a tmp file keyed by session and `tool_use_id`, report only newly failing files, never block (PostToolUse `additionalContext`, exit 0 on any internal error), targets from `file_path`, `files[].path`, `path`; verify with a scratch file; the installer never manages this file. (5) Summary: git state, kit version, mod enabled, doctor problems, languages checked/skipped, owner waits. After `git init` only project language ignore entries are proposed, outside the kit block, and nothing is committed unless asked (kit:user/skills/kit-init/SKILL.md:19-22). The syntax-hook contract is INS-61.
- Proposal: KEEP the skill (bootstrap for a brand-new project) and the rule "never force/pull without the owner"; DROP the Backlog requirement; CHANGE: step 3 also initialises `.planning/` and the GSD adapter; OPEN whether the syntax-check hook generation belongs in the kit or stays project-owned (WildEra has it, hooks area).
- Source: kit:user/skills/kit-init/SKILL.md:1-76, kit:README.md:56-64, wildera:.claude/settings.json:14-23
- Why it exists: description and README: built-in `/init` only writes CLAUDE.md (kit:README.md:64).
- Test idea: run the skill in an empty folder: git question asked, install run, no `--force`, summary lists every step.

### INS-57 Test architecture of install/machine (what to reproduce)
- Behavior: fixtures build a throwaway kit and project in a temp dir whose names contain spaces; a fake Claude CLI (`CLAUDE_CLI`, a `.cjs`) logs every call (args, cwd, `CLAUDE_CONFIG_DIR`) and simulates `--version` (env `FAKE_CC_VERSION`), `plugin marketplace list` (`FAKE_MARKETPLACES`), `plugin install` (writes `enabledPlugins`; `FAKE_PLUGIN_EXIT`) and `mcp remove`; fake `paseo_harness.mjs skills-sync` (`FAKE_SYNC_EXIT`) and fake `sync_agent_provider.mjs` (`FAKE_POLICY_EXIT`, `FAKE_RELOAD_EXIT`) log calls; `PASEO_HOME` and `CLAUDE_CONFIG_DIR` point into the temp home; `PASEO_HARNESS_ROOT` is cleared. Asserted negatives: no `add`, `reload`, `restart` Claude calls; Paseo config byte-identical after check; no writes before a version gate fails. Separate tests cover real-kit install (no test files shipped, links created, git check-ignore results) and `linkSkills` unit behavior on both OSes.
- Proposal: KEEP the approach (fakes for external CLIs, tmp homes, spaces in paths, assert no side effects on gate failures); the new kit's tests should be re-derived from this spec rather than ported.
- Source: kit:tests/install-machine.test.mjs:18-79, kit:tests/install-no-tests.test.mjs:12-22, kit:tests/skills-links.test.mjs:8-15
- Why it exists: not stated.
- Test idea: n/a (this is the test plan).

### INS-58 README requirements and capability claims
- Behavior: README requires Node 20.17+ (24 LTS for bundled tests), Claude Code >= 2.1.296 for the direct file mod, Paseo CLI + running daemon, Backlog.md CLI, Git for worktree isolation, the filesystem MCP package only for the non-Claude adapter; macOS/Linux paths present but unverified; Pi unverified. It states the ownership table (defaults file kit-owned; overlay project-owned and created once; manifest generated; `machine.local.json` generated; Paseo `config.json` Paseo-owned) and that Paseo tool/browser/skill selections remain the owner's in Paseo; the kit does not toggle or hide them. It also says installation does not force Claude's main conversation to replace native `Agent` calls, while `main_provider_disallowed_tools` (README itself, lines 146-149) denies them on the main provider.
- Proposal: no conflict (revised r1): README 7-9 is about `install.mjs` (never edits Paseo providers); README 146-149 is about `machine.mjs apply`, and says "this branch does not apply it to the owner's live daemon". The new docs must keep that split. KEEP the ownership table idea; DROP Backlog, MCP and Pi lines.
- Source: kit:README.md:7-9, kit:README.md:11-26, kit:README.md:29-38, kit:README.md:146-152
- Why it exists: not stated.
- Test idea: n/a (doc).

### INS-59 What an installed project looks like (WildEra at 0.1.0)
- Behavior: kit-owned and tracked: `.agents/harness.defaults.json`, `.agents/harness/**` (config, platform, files backend, runtime), `.agents/skills/{harness,harness-evolve,ai-orchestrator}/**`, `.claude/hooks/{context_guard,io_economy_guard,subagent_file_tools}.mjs`, `.claude/plugins/.claude-plugin/marketplace.json`, `.claude/plugins/harness-files/**` (minus `register.test.ts`), and the AGENTS.md block. Untracked/wired: `.claude/settings.json` hooks and `enabledPlugins`, `CLAUDE.md` import, `.claude/skills/<name>` links (11 in WildEra, including project-owned `code-wave`, `gsd-*`, `ue-code`, `wireframe`), `.agents/harness-skills-links.json`, the `.gitignore` block, seeds `.agents/harness.config.json` and `.agents/harness-history.md`. Project-owned skills in `.agents/skills/` are linked but never copied, tracked or overwritten. Manifest `version` 0.1.0, `installedAt` 2026-10-13T16:07:14Z, `updatedAt` 16:23:46Z.
- Proposal: KEEP the split (kit-tracked parts vs. project-owned skills/hooks living beside them); the new kit adds the GSD core files and `.planning/` seed to the tracked/seeded sets.
- Source: wildera:.agents/harness-kit.json:1-57, wildera:.agents/harness-skills-links.json:1-16, wildera:.gitignore:1-16, wildera:.claude/settings.json:1-82, wildera:AGENTS.md:6-30, wildera:CLAUDE.md:1
- Why it exists: not stated.
- Test idea: a project-owned skill folder survives install, update and `update --force`, and gains a link.

### INS-60 What `--force` does not override
- Behavior: `--force` only changes the outcome for tracked file units in state `local` or `both` (update replaces with the kit version; install replaces a differing project part; pull also takes `both`). It does not: relink or delete an owner-selected link, a non-directory, or an unverified mirror copy under `.claude/skills` (`linkSkills` has no force argument; a Conflict keeps the copy, kit:project/.agents/harness/runtime/skills_links.mjs:60, 93-96; recovery is merge into `.agents/skills` or delete, then `ph skills-sync`, kit:README.md:80-81); resolve `removed-local` (kept); clear a legacy-config conflict (exit 2 even with `--force`, INS-19); overwrite seeds (created once); touch owner hooks/settings keys, CLAUDE.md lines or `.gitignore` lines outside the kit's own entries; or bypass a blocked hook script (INS-20) or the `--enable-plugin` preconditions (INS-27).
- Proposal: KEEP; state it in the new `--help`/docs.
- Source: kit:install.mjs:441, kit:install.mjs:410, kit:install.mjs:235, kit:install.mjs:309-312, kit:project/.agents/harness/runtime/skills_links.mjs:60, kit:project/.agents/harness/runtime/skills_links.mjs:93-96, kit:tests/install-no-tests.test.mjs:57-66
- Why it exists: not stated; derived (review r1).
- Test idea: `update --force` with a hand-made `.claude/skills/x` copy: still a copy, exit 2.

### INS-61 kit-init syntax-check hook contract (project-owned)
- Behavior: the skill makes the agent write `.claude/hooks/syntax_check.mjs` (Node std lib) and register it in `.claude/settings.json` for PreToolUse and PostToolUse with matcher exactly `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_.*`, timeout about 30 s, merged into existing settings, never replacing other hooks. Checker per language only if present: TS parse of the edited file with the project's `typescript` (no full `tsc`), JS `node --check`, JSON `JSON.parse`, C/C++ `-fsyntax-only` with flags from `compile_commands.json` (without it: ask for include paths or skip C/C++), Python `py_compile`, others only a cheap per-file check else skipped and said so. Rules: (1) PreToolUse checks each target and stores the result under `os.tmpdir()` keyed by session and `tool_use_id`, PostToolUse checks again and reports only a file that passed before and fails after, or a new file that fails; (2) because of that, files the checker never understood (JSONC such as `tsconfig.json`, JSX, unusual macros) stay silent, so `JSON.parse` is not applied to JSONC; (3) never block: report via PostToolUse `hookSpecificOutput.additionalContext` with file, line:column and the checker message (a few lines), exit 0 on any internal error or timeout; (4) targets: `file_path` of Edit/MultiEdit/Write, `files[].path` of `edit_multiple_files`/`write_multiple_files`, `path` of `edit_file`/`write_file`; extensions without a checker are skipped before spawning. Verify with a scratch file edited to a syntax error, then delete it. The installer never manages this file.
- Proposal: OPEN (hooks area): keep as a skill-driven recipe or ship a generic hook; the before/after-comparison and never-block rules are KEEP.
- Source: kit:user/skills/kit-init/SKILL.md:44-71
- Why it exists: the kit ships no syntax hook because each project has its own languages (kit:user/skills/kit-init/SKILL.md:46).
- Test idea: feed the hook a hand-made hook JSON for a file that already failed before the edit: no output; a file that newly fails: `additionalContext` with line:column.

### INS-62 Claude config dir used by machine, and the dropped adapter's defaults
- Behavior: `claudeConfigDir(tpl)` = the first template provider `env.CLAUDE_CONFIG_DIR` passed through `fromTemplate` (so `{{HOME}}/.claude-circle` becomes the home path), else `$CLAUDE_CONFIG_DIR`, else `~/.claude`. `mcpState` reads `<dir>/.claude.json` and apply's `claude mcp remove` runs with `CLAUDE_CONFIG_DIR` set to it. The non-Claude adapter roots: `--dirs` comma list, else `/` on non-Windows, else the existing drives `C:/`..`Z:/`; `machine.local.json` sets `alwaysLoad: true` only on `fsbatch`.
- Proposal: DROP the adapter parts; KEEP the rule that machine operations target the config dir of the template's provider, not the caller's default (it is what Open question 3 is about).
- Source: kit:machine.mjs:201-204, kit:machine.mjs:214-218, kit:machine.mjs:228-231, kit:machine.mjs:270-275, kit:machine.mjs:340-347
- Why it exists: not stated.
- Test idea: template with `CLAUDE_CONFIG_DIR={{HOME}}/.claude-circle` and a different `$CLAUDE_CONFIG_DIR`: the config under `~/.claude-circle` is inspected.

## Invariants and lessons

- INV-1 Never overwrite an owner change without `--force`; conflicts keep the project version, are listed, and give exit 2 (not a failure). Evidence: kit:install.mjs:16-19, 441-444; tests kit:tests/install-machine.test.mjs:111-123.
- INV-2 Ownership is decided by three digests (project, kit, installed), not by timestamps; digests ignore line endings and BOM-insensitive JSON reads are used for config. Evidence: kit:install.mjs:29-31, 64, 79-82, 161-172.
- INV-3 Recover only a provable old baseline; if not provable, preserve and ask (legacy config migration). Evidence: kit:install.mjs:212-213, 235; kit:tests/install-machine.test.mjs:285-293.
- INV-4 Fail before writing, narrowly: the Node gate (install only with `--enable-plugin`) runs before any write, and machine apply's Node and Claude gates run before any Paseo or `machine.local.json` write; the install-time Claude check runs after files were copied and hooks merged. A failed wiring step must not leave a manifest claiming success. Evidence: kit:install.mjs:491, kit:machine.mjs:325-327, kit:tests/install-machine.test.mjs:103-109, 295-304, 339-359.
- INV-5 The installer reconciles only its own hook commands in `.claude/settings.json`; unrelated hooks, `env`, permissions and other plugins are preserved; a locally modified hook script keeps its registration. Evidence: kit:install.mjs:301-328; kit:tests/install-machine.test.mjs:81-101, 125-139.
- INV-6 Remove only what is proven to be the kit's (stale skill links by recorded target, retired files by unchanged digest, legacy MCP by executable+script proof, legacy denies by fingerprint); same name is not proof of ownership. Evidence: kit:project/.agents/harness/runtime/skills_links.mjs:118-124, kit:install.mjs:443, kit:machine.mjs:231-245, kit:project/.agents/harness/runtime/provider_sync.mjs:18-24.
- INV-7 Machine changes are additive: add missing providers/models and missing denies, keep owner credentials, rules and selections, back up the Paseo config when the provider/plugin step changes it (the policy sync writes without a backup), write atomically, and never restart the daemon (reload config only, explicit `--no-reload` to skip). Evidence: kit:machine.mjs:1-12, 329-338; kit:project/.agents/harness/runtime/provider_sync.mjs:1, 81, 89.
- INV-8 No secret or endpoint enters the kit: placeholders only, filled at apply from `PASEO_KIT_<NAME>`, a peer provider, or `<NAME>`; export asserts the output holds no secret and scrubs a secret's URL host in descriptions. Evidence: kit:machine.mjs:27-29, 75-80, 128-145. Endpoint leak history: memory omp-migration-policy (history rewritten so no commit holds the Circle endpoint).
- INV-9 Do not override another tool's settings (Paseo skill selection, tool/browser selections, native autocompact); point to where the owner changes it. Exception requested by the owner: main-provider denial of Agent/Workflow via the kit machine key. Evidence: kit:README.md:7-9, memory no-kit-overrides-of-tool-settings, memory main-session-no-native-subagents.
- INV-10 A skill whose copy cannot be linked safely stays a copy and is reported; the other skills still link; the install still completes with exit 2. Evidence: kit:project/.agents/harness/runtime/skills_links.mjs:93-97; kit:tests/install-no-tests.test.mjs:57-76.
- INV-11 Generated paths (skill links with absolute junction targets, link record, `_workspace/`, `.claude/worktrees/`) stay out of git through a kit-owned `.gitignore` block that never touches the owner's lines and keeps the file's EOL. Evidence: kit:project/.agents/harness/runtime/skills_links.mjs:13-30; kit:tests/skills-links.test.mjs:49-67.
- INV-12 Installed projects must not carry kit test files; installed copies are deployment artifacts and the source kit is authoritative. Evidence: kit:install.mjs:157-159; kit:README.md:24-26.
- INV-13 Plain copying never activates a plugin or claims activation; activation uses Claude Code's `plugin install` under the intended `CLAUDE_CONFIG_DIR` and requires unmodified assets. Evidence: kit:install.mjs:25-27, 340-370.
- INV-14 Windows realities matter: cmd.exe shims for the Claude CLI, paths with spaces, CRLF checkouts, junctions with absolute targets (rebind after a move), case-insensitive path comparison. Evidence: kit:project/.agents/harness/platform.mjs:19-28, kit:install.mjs:86, kit:project/.agents/harness/runtime/skills_links.mjs:6, kit:tests/install-machine.test.mjs:18-26.

## Interfaces

CLI (install.mjs exits 0/1/2 as in INS-01; machine.mjs codes in INS-37):
- `node install.mjs install|update <project> [--force] [--enable-plugin]`; `status <project>`; `pull <project> [<part>...] [--force]`.
- `node machine.mjs check | apply [--dirs ..] [--fs-server ..] [--remove-local <project>]... [--no-reload] [--enable-paseo-plugins] | export`.
- `node .agents/skills/harness/scripts/sync_agent_provider.mjs [--apply [--no-reload]]`; `ph skills-sync` (project).
- User skill `/kit-init`.

Files and formats:
- `.agents/harness-kit.json`: `{_notes, kit, version, installedAt, updatedAt, files{path: digest16}}`; block keys `NAME#paseo-harness-kit`.
- `.agents/harness-skills-links.json`: `{version: 1, links{name: absolute source path}}`.
- Marked blocks: `<!-- PASEO-HARNESS-KIT START: ... -->` / `<!-- PASEO-HARNESS-KIT END -->`; `.gitignore` block `# >>> paseo-harness-kit: ...` / `# <<< paseo-harness-kit`.
- Seeds: `.agents/harness.config.json` (overlay, `_notes` only), `.agents/harness-history.md`.
- `paseo/providers.json`: `{_notes, providers{name{extends,label,description,env,models[],disallowedTools?}}, metadataGeneration}` with `{{HOME}}` and `{{secret:NAME}}`.
- Backup `<paseo config>.bak-YYYY-MM-DD-kit`; `machine.local.json` (kit root, gitignored, dropped).
- `kit.json`: `{name, version}` (0.1.0).

Config keys (machine-owned, in `.agents/harness.defaults.json`, ignored in the project overlay): `agent_providers` (default `{circle: circle-agent}`: main -> worker provider), `agent_provider_disallowed_tools` (17 worker denies), `agent_provider_env` (`ENABLE_TOOL_SEARCH=true`), `main_provider_disallowed_tools` (`Agent, Workflow, SendMessage`), `agent_mcp` (non-Claude MCP, dropped).

Environment: `PASEO_HOME` (default `~/.paseo`), `PASEO_CLI`, `PASEO_KIT_<NAME>` and `<NAME>` (secrets), `CLAUDE_CLI`, `CLAUDE_CONFIG_DIR` (decides which user config receives the marketplace), `PASEO_HARNESS_ROOT` (project root for the project-side scripts), `APPDATA` (Windows npm shims).

External commands called: `claude --version`, `claude plugin marketplace list --json`, `claude plugin install ...`, `claude mcp remove --scope user|local <name>` (dropped), `paseo reload`, `git` (legacy baseline, dropped), `backlog ...` and `npm ci` (dropped / plugin-only).

## Cross-area dependencies

- runtime: install calls `ph skills-sync` and relies on `config.mjs` (`MACHINE_KEYS`, `MERGED_KEYS`, `loadKitConfig`, `isClaudeProvider`) and `platform.mjs` (Node/Claude gates, CLI lookup); `ph doctor` reports mod/plugin readiness and provider lines (`agentProviderLines`); `shared_paths.mjs` (`sharedUrl`) resolves the shim; `ph worktrees` owns `.claude/worktrees/` which the gitignore block hides.
- files (harness-files mod): the mod ships under `.claude/plugins/harness-files` plus `.claude/plugins/.claude-plugin/marketplace.json` (name `paseo-harness-kit`, plugin `harness-files`); install enables it only on opt-in.
- hooks: the three managed hook scripts and their template matchers; project-owned hooks (syntax_check, bash_long_command) must coexist.
- workflow: `_workspace/` and `.claude/worktrees/` are generated paths ignored by the block; worker providers (`circle-agent`) and their denies are what workflows spawn into.
- method: `blocks/AGENTS.md` (File I/O rules) and the `@AGENTS.md` import; harness-evolve uses `pull` and `harness-history.md`.
- gsd-plan / gsd-debug / gsd-upstream: nothing in install creates `.planning/`; the new kit's seed set must add the GSD core and the adapter; WildEra's AGENTS.md shows the `## Planning state` text that replaces the Backlog block.
- ui: `paseo/plugins/{backlog-plugin,swarm-plugin}` enabled by `machine apply --enable-paseo-plugins` (not read here).
- history: `templates/harness-history.md`; `pull` asks to record in the kit CHANGELOG.md.
- install -> others: the manifest's `version` and digests are what status/doctor compare; the link record feeds `ph skills-sync`.

## Concerns

- C-1 `ensureBacklog` runs on every update and re-adds the Backlog block to AGENTS.md when the marker is missing; WildEra removed it (owner-written Planning state), so an update at 0.1.0 would re-inject it (and re-init `backlog/` if config files vanish). kit:install.mjs:284-299, 427; wildera:AGENTS.md:1-4.
- C-2 WildEra's kit block contains project sections, so the part is permanently `local` (exit 2 on every update) and `pull` could contaminate the kit. wildera:AGENTS.md:6-30 vs kit:blocks/AGENTS.md:1-7 (INS-15).
- C-3 Manifest, settings.json, AGENTS.md and CLAUDE.md are written with plain `writeFileSync` (not temp+rename), while the link record and Paseo config are atomic. kit:install.mjs:128, 188, 326, 383 vs kit:project/.agents/harness/runtime/skills_links.mjs:126-128.
- C-4 The manifest stores an absolute kit path (leaks machine paths into a committed file; breaks `pull`/MCP proof when the kit moves). kit:install.mjs:190; wildera:.agents/harness-kit.json:3.
- C-5 Digest/normalisation code is duplicated in install.mjs and skills_links.mjs; the managed-hook list is hard-coded separately from the template. kit:install.mjs:81-82, 307; kit:project/.agents/harness/runtime/skills_links.mjs:7.
- C-6 `pull` ignores part names that match nothing; `pull` of a block copies project text into the kit with no warning. kit:install.mjs:464-470.
- C-7 A conflict kept at install is not in the manifest, so it surfaces as `both` at update (confusing label for a never-installed file). kit:install.mjs:410, 168-170.
- C-8 `providers.json` is stale against the defaults: `circle` lists `[Agent, Workflow]`, defaults list `Agent, Workflow, SendMessage` (apply/export render the defaults, so the file only matters for a fresh machine before sync). CONFLICT: kit:paseo/providers.json:228-231 vs kit:project/.agents/harness.defaults.json:59-63; memory states only Agent+Workflow.
- C-9 `providers.json` `_notes` says secrets are filled from "a live provider with the same ANTHROPIC_BASE_URL" but `secretFor` matches any live provider with the same `extends` that has the variable (a Claude provider on another endpoint would lend its token). CONFLICT: kit:paseo/providers.json:2 vs kit:machine.mjs:75-77.
- C-10 `SECRET` regex `/TOKEN|KEY|SECRET|PASSWORD|BASE_URL/i` is applied to every property name in `toTemplate` (over-broad: any key containing KEY), and the leak assertion uses substring search (a very short secret value false-fails). kit:machine.mjs:28, 59, 145.
- C-11 Reload failure after a successful write returns exit 1 (indistinguishable from "nothing applied"). kit:project/.agents/harness/runtime/provider_sync.mjs:116-120.
- C-12 Same-day `apply` overwrites the single dated backup. kit:machine.mjs:331.
- C-13 `walk` treats directory symlinks inside `project/` as files (Dirent not a directory) and would fail on copy; not exercised. kit:install.mjs:98-106.
- C-14 `kit-init` and README link the user skill into `~/.claude/skills`, while the Circle provider runs with `CLAUDE_CONFIG_DIR={{HOME}}/.claude-circle`; sessions under `circle` may not see it (unverified on the owner's machine). kit:README.md:60-62, 74-75; kit:paseo/providers.json:9.
- C-15 Retired `subagent_file_tools.mjs` still ships and is tracked though unregistered (dead file); `mcp__fsbatch__`/`mcp__filesystem__` matchers remain in the template. kit:install.mjs:307, kit:templates/settings.hooks.json:5,27; wildera:.agents/harness-kit.json:50.
- C-16 `sort` with `localeCompare` for manifest keys can differ between locales (diff noise). kit:install.mjs:177, 186.
- C-17 README lists a stale `pull <file>` form and Backlog/Pi/MCP requirements (INS-13, INS-58). kit:README.md:34-38, 46.
- C-18 `update` records `same` parts with the kit digest, so a project file that happens to equal the new kit version silently becomes "installed" (benign but erases the earlier `local` history). kit:install.mjs:439.
- C-19 Over-engineering: legacy config migration (~60 lines + git archaeology), MCP ownership proof across foreign manifests, `.bak` of Paseo config via copy, and the child-process hop for skills-sync, all serving upgrades from retired layouts. kit:install.mjs:212-271, kit:machine.mjs:228-259.

## Open questions for the owner

1. Upgrade path for projects installed by kit 0.1.0 (WildEra): (a) no migration, reinstall by hand from the spec; (b) a one-time `adopt` command that reads the old manifest, deletes retired files whose digest equals the old record, removes the Backlog block only if unchanged, re-links skills; (c) keep the whole `migrate` family. Recommend (b), small and tested against WildEra, then delete it.
2. Mod activation: keep `--enable-plugin` as an explicit flag (current), or enable by default on install? Recommend keep explicit but make the `kit-init` skill always pass it, and keep the three preconditions (version, assets present, assets unmodified).
3. Old machine state: the owner's `~/.claude-circle` user config may still hold `fsbatch`/`filesystem` MCP entries that point at `kit/mcp/*.mjs` (memory omp-migration-policy). Options: (a) new `machine check` reports dangling registrations only; (b) `apply` retires them with the old executable+script proof; (c) document one `claude mcp remove` command and ship nothing. Recommend (c).
4. Manifest `kit` field: drop it (recommended; `pull` takes `--kit` or reads `PASEO_KIT`), or keep for provenance.
5. Block ownership: refuse/warn when a project edits text inside the kit block, and move the project's text out of the block in WildEra? Recommend warn in `status` and `pull`, and give projects a second, project-owned section.
6. `main_provider_disallowed_tools`: keep `SendMessage` as in defaults (added after the memory note, which names Agent and Workflow) or only Agent and Workflow? Recommend keep all three (the defaults note records owner 2026-10-14).
7. Where the `kit-init` user skill is linked: `~/.claude/skills` (README) or every `CLAUDE_CONFIG_DIR` of template providers (`~/.claude-circle`)? Recommend `machine apply` links it into each config dir named by the template providers, explicitly and reversibly.
8. Swarm/backlog Paseo panels (`machine apply --enable-paseo-plugins`): drop backlog (decided); keep swarm? Decided by the ui area; recommend carry only what the new UI uses.
9. Provider catalogue: which model ids, labels and the `circle` opus alias mapping (`gpt-6-luna-fast[1m]` for the main provider vs real opus for `circle-agent`) the new `paseo/providers.json` ships; recommend re-export from the owner's live config after the list is confirmed.
10. Exit code when apply wrote the Paseo config but reload failed: keep 1 or return 2 (applied, reload pending)? Recommend 2.
11. Skill trees (review r1, INS-30): keep `.agents/skills` as edit tree with per-skill links under `.claude/skills` (needed only for the dropped Codex/OpenCode readers), or a single tree under `.claude/skills` (no junctions, no link record, no per-skill gitignore lines)? Recommend the single tree if the project skills can live there; keep the links only if the owner wants non-Claude tools to read the same skills later.

## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
| --- | --- | --- |
| R1-INS-01 | accepted | INS-37 exit codes replaced (check 0/2/1, export 0/1, apply rule), source 321, 354-357 added; Interfaces CLI line narrowed. Verified kit:machine.mjs:354-357. |
| R1-INS-02 | accepted | INS-11 status lines carry both versions (kit:install.mjs:457). |
| R1-INS-03 | accepted | INS-39, INS-40, INS-53, INV-7: backup only when the provider/plugin step changed something (kit:machine.mjs:329-333; kit:project/.agents/harness/runtime/provider_sync.mjs:93-96). |
| R1-INS-04 | accepted | INS-29 and INV-4 rewritten: `claudeVersion` not used; untimed `runClaude`; Claude check after copy/merge on install (kit:install.mjs:348, kit:machine.mjs:263-264, kit:install.mjs:387-390). |
| R1-INS-05 | accepted | INS-54: check lines not always printed, early returns listed, `--no-reload` alone legal (provider_sync.mjs:110-124). |
| R1-INS-06 | accepted | New INS-61 (hook contract), INS-56 pointer and post-init gitignore rule, INS-22 matcher drift. |
| R1-INS-07 | accepted | New INS-60; Summary note. |
| R1-INS-08 | accepted | INS-12: `gone`/`same` silent, other states skipped (kit:install.mjs:469-470). |
| R1-INS-09 | accepted | INS-05: 47 file keys plus the block (wildera manifest lines 8-55 = 48 entries). |
| R1-INS-10 | accepted | INS-49, INS-51: absent/null `disallowedTools` is `[]` (provider_sync.mjs:34, 74). |
| R1-INS-11 | accepted | INS-02 split into three cases incl. the `startsWith` prefix quirk (kit:install.mjs:489-490, 494-496). |
| R1-INS-12 | accepted | INS-10 defines `M` and the silent early `linkSkills`; INS-26 notes the summary line on exit 0 (kit:install.mjs:278-280, 430, 433-448). |
| R1-INS-13 | accepted | INS-30 proposal changed to OPEN with the dropped-harness reason; Open question 11 added. |
| R1-INS-14 | accepted | INS-58 CONFLICT withdrawn; README 146-149 quote added (kit:README.md:7-9, 146-149). |
| R1-INS-15 | accepted | New INS-62 (config dir rule, default roots, `alwaysLoad`). |
| (checked citation) INS-43 providers.json:2 | accepted | INS-43 Source narrowed to the placeholder lines; `_notes` mismatch pointed to C-9. |


