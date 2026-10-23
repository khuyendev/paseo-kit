# Requirements: paseo-kit v1.0

Generated from `.planning/requirements/{platform,runtime,tools,method}.md` by `intel/runs/assemble-requirements.sh`; edit the group files, not this file.
Requirement IDs: INST, MACH, CONF (platform), PCLI, PHCL, FLOW (runtime), FTOL, HOOK, PANL (tools), GSDC, GSDF, HARN, ADPT (method).

---

## Requirements: platform (M1 install, M2 machine, M3 config)

**Defined:** 2026-10-20
**Inputs:** `.planning/intel/SYNTHESIS.md` (modules M1, M2, M3), `DECISIONS.md` (D-01..D-111), `INGEST-CONFLICTS.md`, `PHASES-DRAFT.md`, maps `install.md`, `runtime.md`, `hooks.md`, `files.md`, `history.md`.

Conventions: `kit.mjs` is the kit CLI (`node <kit>/kit.mjs <verb>`); "project" is the install target; P/K/I are the project, kit and installed (manifest) digests. Exit codes follow P8: 0 done, 1 usage or file error, 2 done with differences, conflicts or problems. Every acceptance runs offline with fakes (INST-29) unless it names a manual check. The kit is vanilla (D-110): nothing here names a project, engine or game; project data comes from the adapter (ADPT requirements). Hook behavior is specified in HOOK, file-tool behavior in FTOL, `ph` behavior in PHCL; this file specifies only what install, machine and config enforce.

### v1 Requirements

### INST: install (M1)

#### INST-01 CLI surface and exit contract
- Requirement: `kit.mjs install|update|status <project> [--force] [--enable-plugin]` and `kit.mjs pull <project> [<part>...] [--force] [--kit DIR]` accept flags anywhere after the verb; an unknown verb, a missing `<project>`, an unknown `--flag`, a second positional for a verb other than `pull`, or `--enable-plugin` with `status`/`pull` exits 1 with a usage line on stderr and writes nothing; expected failures print `failed: <msg>`, unexpected ones `error: <msg>` (exit 1); exit 2 means done with conflicts, kept parts or blocked hooks left; `install`, `update` and `pull` print `platform <os> <arch>, node <version>` as the first stdout line, `status` does not.
- Acceptance: offline test runs every bad-argument case per verb: exit 1, usage line on stderr, project tree hash unchanged; an `update` with one kept part exits 2; the first stdout line of `install` matches `^platform \S+ \S+, node v?\d`.
- Source: INS-01, INS-02, D-14, P8.
- Scope: v1

#### INST-02 Target refusal
- Requirement: the target is refused with exit 1 and no write when it does not exist (`failed: <path> does not exist`), is not a folder (`failed: <path> is not a folder`), or equals the kit root or lies inside it by path-segment comparison, case-insensitive on Windows (`failed: the project cannot be the kit itself`); a sibling whose name merely starts with the kit folder name (e.g. `paseo-kit-x`) is accepted.
- Acceptance: four fixture targets (missing, file, `<kit>/ship/x`, sibling `<kit>-x`): first three exit 1 with the named message and leave kit and target unchanged; the sibling installs with exit 0.
- Source: INS-02, INV-04, INV-52.
- Scope: v1

#### INST-03 Shipped units
- Requirement: the units are the files `kit.json` lists as shipped (keyed by forward-slash path relative to `ship/`) plus one block unit per file in `ship/blocks/`, keyed `<NAME>#paseo-harness-kit`; a path with a `tests/`, `__tests__/` or `node_modules/` segment, a file named `test_*`, or `*.test|spec.(mjs|cjs|js|ts|mts|cts|jsx|tsx)` is never a unit; a kit self-check fails when `kit.json` lists such a file or a file that does not exist.
- Acceptance: after install the manifest keys equal the `kit.json` list plus the block keys; no key and no installed file matches the test patterns; the self-check test fails on a fixture `kit.json` listing `x.test.mjs` or a missing file.
- Source: INS-03, install INV-12, D-10.
- Scope: v1

#### INST-04 Line-ending-insensitive digest
- Requirement: one shared helper computes every digest as the full 64-char lowercase hex sha256 of the bytes with CRLF replaced by LF; a block digest is the same function over the body between its markers, trimmed; ownership decisions use digests only, never timestamps.
- Acceptance: unit test: LF and CRLF variants give equal 64-char digests, non-UTF-8 bytes hash stably; install, convert one installed file to CRLF and touch its mtime: `status` exits 0 with `status: every kit part is the same ...`; grep finds one digest implementation in `ship/`.
- Source: INS-04, INV-02, install C-5.
- Scope: v1

#### INST-05 Manifest format
- Requirement: `install`, `update` and `pull` write `.agents/harness-kit.json` as 2-space JSON with a trailing newline holding exactly `_notes`, `version` (from `kit.json` at write time), `installedAt` (set by install, preserved by update and pull), `updatedAt` (ISO time of the write) and `files` (unit key -> digest, keys sorted by code point); it holds no kit path and no absolute path; `status` never writes it.
- Acceptance: install then update: top-level keys are exactly the five; `installedAt` unchanged, `updatedAt` changed; `files` key order equals a code-point sort (fixture keys `B.md`, `a.md`); the manifest text contains neither the kit path nor the project path in any slash form.
- Source: INS-05, D-04, install C-4, install C-16, INV-09.
- Scope: v1

#### INST-06 Six-state classification
- Requirement: for every current unit and every manifest file key the kit no longer ships, with P, K, I null when absent, the state is: K null -> `gone` (P null), `removed` (P == I), else `removed-local`; else P null -> `missing`; P == K -> `same`; P == I -> `kit-newer`; K == I -> `local`; else `both`. Fixed help texts: missing "update adds it"; kit-newer "update takes it"; local "pull copies it into the kit; update --force replaces it with the kit version"; both "merge by hand, then pull --force or update --force"; removed "update deletes it"; removed-local "delete or keep it by hand".
- Acceptance: table test over every (P, K, I) equality pattern returns the state and help text above; `status` prints the help text verbatim.
- Source: INS-06, INV-01, INV-02.
- Scope: v1

#### INST-07 Retired files and blocks
- Requirement: `update` deletes a recorded file, or removes a recorded block with its markers, that the kit no longer ships only in state `removed` (project digest equals the recorded one), printing `deleted <rel> (no longer in the kit)`; a `removed-local` part is kept and listed and counts toward exit 2, also with `--force`; a file of the same name without a manifest record is never deleted.
- Acceptance: fixture manifest with one unchanged and one edited retired file and one unchanged retired block: `update --force` deletes the first and the block (AGENTS.md text outside the markers byte-identical), keeps the second, exits 2; an unrecorded same-named file survives.
- Source: INS-07, D-11, INV-03.
- Scope: v1

#### INST-08 install
- Requirement: `install` fails with `failed: .agents/harness-kit.json exists: already installed; use update` (exit 1) when a current-format manifest exists (an older-format one is handled by INST-31); otherwise a unit whose project version differs from the kit is kept, not recorded, and listed as `conflict <rel>: the project has a different version and kept it (install --force replaces it)`; other units are copied and recorded; wiring runs (INST-18); the manifest is written even when conflicts exist; the last line is `installed paseo-kit <version>; machine setup (once per machine): node "<kit>/kit.mjs" machine check`; exit 2 when any conflict or blocked hook, else 0. A conflict kept at install is reported as `both` by the next `update`.
- Acceptance: pre-existing differing copy of a kit skill file: install exits 2, manifest written without that key, file byte-identical; `update` prints `kept <rel> (both: ...)` and exits 2; `update --force` makes it equal to the kit; a second `install` exits 1 with the message.
- Source: INS-08, INS-09, INV-01, HIS-33.
- Scope: v1

#### INST-09 update
- Requirement: `update` fails with `failed: not installed; use install` (exit 1) without a manifest and refuses an older-format manifest (INST-31); manifest records follow INST-32; per state: `same` records K silently; `gone` drops the key; `missing`, `kit-newer`, and with `--force` `local`/`both`, copy the kit version, record K and print `updated <rel>`; `removed` deletes (INST-07); every other part prints `kept <rel> (<state>: <help>)`; then wiring, then the manifest; summary `update: N part(s) changed, M kept; kit <version>` where M counts kept parts plus blocked hooks; exit 2 when M > 0, else 0.
- Acceptance: edit an installed kit hook: `update` keeps it, prints `kept .claude/hooks/<x> (local: ...)`, exits 2; `update --force` replaces it; a following plain `update` prints `0 kept` and exits 0.
- Source: INS-10, INV-01.
- Scope: v1

#### INST-10 status
- Requirement: `status` is read-only, fails exit 1 without a manifest, prints one line `<state padded to 13> <rel>  (<help>)` per part not `same`/`gone`, then `status: N part(s) differ; project on kit <installed>, kit now <kit>` or `status: every kit part is the same; project on kit <installed>, kit now <kit>`; exit 2 when any part differs, else 0.
- Acceptance: fresh install -> exit 0 and the "every kit part" line; one edited unit -> exit 2 and one `local` line; project tree hash and mtimes identical before and after.
- Source: INS-11.
- Scope: v1

#### INST-11 pull
- Requirement: `pull` resolves the kit folder from `--kit DIR`, else `$PASEO_KIT`, else the folder of the running `kit.mjs`; normalizes part names (backslash to `/`, leading `./` stripped) and validates all of them first: a name matching no unit prints `failed pull <part>: not a kit part` and exits 1 before any copy; it copies `local` parts (and `both` with `--force`) from the project into the kit (a block part overwrites `ship/blocks/<NAME>` with the project block body), records the project digest, prints `pulled <rel>`; `missing`, `kit-newer`, `removed`, `removed-local` and `both` without `--force` print `skipped <rel> (<state>: <help>)` and give exit 2; the closing line is `pull: N part(s) copied into the kit`, plus `; record them in the kit CHANGELOG.md and commit the kit, then update the other projects` when N > 0.
- Acceptance: edit an owned file, `pull <project> <rel> --kit <tmpkit>`: the tmp kit file equals the project file, `status` then reports `same`, the closing line carries the CHANGELOG reminder; `pull <project> nope.md` exits 1 and the kit tree is unchanged.
- Source: INS-12, INS-13, D-04, D-14, install C-6.
- Scope: v1

#### INST-12 Marked AGENTS.md block
- Requirement: each block unit lives in the project file of the same name between a line starting `<!-- PASEO-HARNESS-KIT START` and `<!-- PASEO-HARNESS-KIT END -->`; an existing block body is replaced in place with every byte outside the markers unchanged; an absent block is inserted at the top, followed by a blank line and the old content; a missing file is created; the file keeps CRLF when it has any CRLF, else LF; malformed markers (END before START, or more than one START) are reported as `conflict <file>#paseo-harness-kit: malformed kit block markers; fix by hand`, the file is not written, exit 2. The block text itself is specified by the HARN requirements (always-loaded rules).
- Acceptance: CRLF AGENTS.md with text before and after the block and a changed kit block: `update` changes only the body bytes and keeps CRLF; no AGENTS.md -> created with the block; AGENTS.md without markers -> block, blank line, old text; malformed fixture -> exit 2, file byte-identical.
- Source: INS-14, HIS-88, D-05, INV-01.
- Scope: v1

#### INST-13 Project text inside the kit block is flagged
- Requirement: whenever the project block body differs from the shipped block body (whatever its three-digest state, recorded or not), `status` prints, besides the state line, `warning AGENTS.md#paseo-harness-kit: text inside the kit block; project text belongs outside the markers`, and `pull` of that block part prints the same warning; the warning changes neither the state (INST-06) nor the update, `--force` and pull rules (a `both` block still needs `--force` to be pulled or replaced).
- Acceptance: three fixtures: `local` block (kit unchanged), `both` block (kit and project changed), differing unrecorded block: `status` prints the state line (`local`, `both`, `both`) and the warning each time; `update` keeps all three byte-identical; `pull <project> AGENTS.md#paseo-harness-kit` copies the `local` one, skips the `both` one without `--force` (exit 2) and prints the warning in every case.
- Source: INS-15, D-05, HIS-88, install C-2.
- Scope: v1

#### INST-14 Hook registration reconcile
- Requirement: `install` and `update` reconcile `.claude/settings.json` against `ship/templates/settings.hooks.json`: the managed scripts are those the template names (a `command` hook whose command references `.claude/hooks/<name>.mjs`); for each managed script that is not blocked, every existing registration is removed from every event and group and the template groups are appended; empty groups are dropped; hooks of other scripts (also in the same group), `env`, `permissions`, `enabledPlugins` and every other key are preserved; a managed script whose project file differs from its digest in the prospective ownership record (INST-33), or has no entry there, is blocked: its registrations stay as they are, the template ones are not added, `conflict .claude/hooks/<name>.mjs: local script differs; its registrations were kept unchanged` is printed and the exit is 2; the file is written (2-space JSON, trailing newline) only when the serialized JSON changed; `status` and `pull` never touch settings.
- Acceptance: settings with a project hook in the same group as a kit hook and an edited kit hook script: `update` keeps the project hook and the edited script's registrations unchanged, exits 2; two clean `update` runs: the second leaves settings bytes and mtime unchanged; adding a hook to a fixture template is reconciled with no code change; on a fresh install and on a clean kit-version update every kit hook is registered (none blocked).
- Source: INS-20, INS-22, HOK-02, HOK-29, INV-01, INV-05.
- Scope: v1

#### INST-15 Registered kit hooks and matchers
- Requirement: after install into a project without settings, `.claude/settings.json` holds exactly one registration per template entry; the template registers only kit hooks (context guard, io guard, syntax-check shell, Windows long-command rescue; their behavior is HOOK's) and its matchers name only tools that exist (native tools and `mcp__harness-files__*`), never `mcp__fsbatch__`, `mcp__filesystem__` or `subagent_file_tools.mjs`; the kit no longer asks a project to write its own syntax hook: the shell is a kit hook and the per-extension checkers come from the adapter (D-45).
- Acceptance: parse settings: registrations per (event, matcher, command) equal the template; grep of the template and the installed settings for `fsbatch|mcp__filesystem__|subagent_file_tools` finds nothing; `user/skills/kit-init/SKILL.md` contains no step that writes `.claude/hooks/syntax_check.mjs`.
- Source: INS-21, INS-22, INS-61, HOK-29, D-45, D-46.
- Scope: v1

#### INST-16 CLAUDE.md imports AGENTS.md
- Requirement: `install` and `update` make `CLAUDE.md` carry `@AGENTS.md`: inserted after the leading run of `@` lines (at the top when none), followed by a blank line when other text follows; the file's EOL is kept; a missing file becomes the import plus EOL; nothing is written when the import is present; the run prints `CLAUDE.md: added @AGENTS.md` or `CLAUDE.md already imports AGENTS.md`.
- Acceptance: `@a\ntext` becomes `@a\n@AGENTS.md\n\ntext`; a second run leaves bytes and mtime unchanged; a CRLF file stays CRLF.
- Source: INS-23.
- Scope: v1

#### INST-17 Seeds created once
- Requirement: `install` and `update` create, only where missing, `.agents/harness.config.json` (a seed with `_notes` and the `adapter` and `gsd` sections that passes config validation, D-77), `.agents/harness-history.md` (header plus the empty table `| Date | Change | Scope | Reason | Supersedes |`, D-60) and the `.planning/` folder itself (no file inside it: `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` and every other lifecycle artifact are written only by the GSD flows, so a seed can never make new-project resume skip a stage), printing `created <rel>`; an existing seed is never read for ownership, never recorded in the manifest and never overwritten, also with `--force`.
- Acceptance: pre-existing overlay `{"max_subagents": 7}` is byte-identical after `install`, `update` and `update --force`; on a fresh install `loadConfig(project)` succeeds and the history file's table header line is exact; the manifest has no seed key; a fresh install leaves `.planning/` empty, and in a project with existing `.planning/` files every one is byte-identical after `install` and `update`.
- Source: INS-24, HIS-32, D-60, D-77, D-109.
- Scope: v1

#### INST-18 Wiring before the manifest; no false success
- Requirement: after copying, `install` and `update` run the wiring steps, which read ownership from the prospective record (INST-33), from one ordered list (hook reconcile, mod activation when `--enable-plugin`, CLAUDE.md import, `.gitignore` block, seeds) before the manifest is written; a step that throws ends the command with `failed: <step>: <msg>` (exit 1), the manifest is neither written nor updated, and no `installed ...` or `update: ...` summary line is printed; the next run without the fault succeeds.
- Acceptance: fake `claude plugin install` exiting 9 under `install --enable-plugin`: exit 1, stderr names the step, no manifest file, stdout lacks `installed paseo-kit`; rerun with the fake exiting 0 succeeds with exit 0.
- Source: INS-25, INV-04.
- Scope: v1

#### INST-19 Kit-owned .gitignore block
- Requirement: `install` and `update` keep one block in the project `.gitignore` from `# >>> paseo-harness-kit: generated paths (edit outside this block)` to `# <<< paseo-harness-kit` holding `/_workspace/` and `/.claude/worktrees/` and no line other than kit-generated paths (no per-skill lines, never `.planning/`); the block is appended after a blank line (or the file created) when absent, replaced in place when present; owner lines are untouched; EOL follows the file; nothing is written when the text is unchanged.
- Acceptance: `.gitignore` = `node_modules/\r\n` + an old block + `dist/\r\n`: text outside unchanged, one block, CRLF lines; `build` without EOL becomes `build\n\n# >>> paseo-harness-kit...`; second run no write; `git check-ignore` ignores `_workspace/_runs/x` and `.claude/worktrees/a`, not `.planning/STATE.md`, `.agents/harness-kit.json` or `.claude/settings.json`.
- Source: INS-36, HIS-34, D-10, INV-52.
- Scope: v1

#### INST-20 harness-files mod activation only with --enable-plugin
- Requirement: without `--enable-plugin`, `install`/`update` never call `claude plugin` and print one note saying whether project settings already enable the mod, never claiming activation; with it: the Node gate and the Claude Code version gate (>= the mod minimum, INST-23) run before any write; after the copy the mod assets (`.claude/plugins/harness-files/.claude-plugin/plugin.json`, `.claude/plugins/.claude-plugin/marketplace.json`) must exist and every file under `.claude/plugins/` must equal its digest in the prospective ownership record (INST-33), else `failed: file mod has untracked or locally modified assets; resolve conflicts before enabling`; then `claude plugin install harness-files --marketplace <project>/.claude/plugins --scope project` runs with cwd = project and the inherited environment (so `CLAUDE_CONFIG_DIR` decides the user config); the kit never edits `enabledPlugins` itself; the last line says current-session activation is not verified.
- Acceptance: fake CLI reporting the minimum minus one: exit 1, project tree unchanged, the fake logged only `--version`; a kept local edit of a mod file: exit 1 with the assets message, no `plugin install` call; success: logged args exactly as above, cwd = project, logged `CLAUDE_CONFIG_DIR` equals the caller's; no flag: zero `plugin` calls; fresh `install --enable-plugin` and a clean kit-version `update --enable-plugin` both reach `plugin install`.
- Source: INS-27, INS-29, D-02, HIS-35, INV-04, FIL-48.
- Scope: v1

#### INST-21 Marketplace registered once per Claude config
- Requirement: before `plugin install`, `claude plugin marketplace list --json` is read (a failure counts as no entries); an entry with the mod's marketplace name at another folder (case-insensitive compare on Windows) whose runtime files are identical by digest makes the install use `harness-files@<marketplace> --scope project` without `--marketplace` and print the reused folder; a differing one fails naming the folder and the two fixes (update that project to this kit version, or `claude plugin marketplace remove <marketplace>`), with no install and no removal.
- Acceptance: fake list returning an identical copy -> logged args lack `--marketplace`; a differing copy -> exit 1, no `plugin install` and no `marketplace remove` call.
- Source: INS-28, D-12, HIS-35.
- Scope: v1

#### INST-22 What --force never overrides
- Requirement: `--force` changes only the outcome of tracked units in state `local`/`both` (and of a differing part at `install`); it never deletes or overwrites `removed-local` parts, seeds, project-owned skills, agents or hooks, settings keys and hooks other than kit registrations, `CLAUDE.md` lines, `.gitignore` lines outside the kit block or any user-scope Claude config, and never skips a version gate; `--force` grants no extra permission on user config: the only user-scope effect of install is the marketplace registration made by Claude Code's own CLI under explicit `--enable-plugin` (INST-20, INST-21).
- Acceptance: fixture with a project skill folder, a project hook registration, a seed, a `removed-local` file and owner `.gitignore` lines: `update --force` leaves all byte-identical and exits 2 for the `removed-local` part; `install --enable-plugin --force` with the fake CLI below the minimum still exits 1 before any write.
- Source: INS-60, INV-01.
- Scope: v1

#### INST-23 Runtime gates and one Claude CLI lookup
- Requirement: one platform module provides the Node gate from one exported table `NODE_RUNTIME = {minVersion, capabilities[]}` (minimum `x.y.z` the shipped runtime needs, and every Node API it uses beyond that version's baseline, each with a presence probe), filled by the release qualification check that runs the shipped suites on the candidate minimum and records the result; the failure names the version or the missing capability; the test-runner floor (Node for `tests/`) is stated separately in README and is not a runtime gate; `kit.mjs machine` and `ph doctor` report this same gate; one `MIN_CLAUDE_VERSION` constant (the mod's minimum, re-verified per FTOL), `versionAtLeast(text, min)` returning true/false, or null when the text has no `x.y.z`, and the Claude CLI lookup `$CLAUDE_CLI`, else `~/.local/bin/claude(.exe)` when present, else `claude` on PATH; a `.js/.cjs/.mjs` CLI runs through the current node; on Windows anything not `.exe/.com` runs through cmd.exe as one quoted command line; the version probe times out after 10 s; `kit.mjs` and `ph doctor` start Claude only through this module.
- Acceptance: `versionAtLeast('2.1.296 (Claude Code)', '2.1.296')` true, `'2.1.295'` false, `'unknown'` null; a fake `.cmd` CLI in a folder with spaces runs on Windows; boundary tests driven by `NODE_RUNTIME`: exactly `minVersion` passes, the next lower patch fails naming the version, each capability removed in turn fails naming it; lint: no other shipped module spawns `claude` and no other module compares Node versions.
- Source: INS-29, RUN-60, INV-52.
- Scope: v1

#### INST-24 One skill tree; project skills untouched
- Requirement: kit skills ship as tracked units under `.claude/skills/<kit skill>/`; a skill folder not listed in `kit.json` is project-owned and is never copied, recorded, linked, deleted or overwritten by any verb, also with `--force`; inside an installed project the kit creates no junction or symlink, no `.agents/harness-skills-links.json`, no `.agents/skills/` tree, and has no `ph skills-sync` command; the only link the kit makes anywhere is the user-level bootstrap link of MACH-16.
- Acceptance: project skill `.claude/skills/mine/` is byte-identical and absent from the manifest after `install`, `update`, `update --force`; after install no link exists under `.claude/skills` and `.agents/skills` does not exist; `ph skills-sync` exits 1 as an unknown command.
- Source: D-10, INS-26, INS-30..35 (dropped), INS-59, HIS-33, S-02.
- Scope: v1

#### INST-25 Installed project is self-contained
- Requirement: an installed project runs with the kit folder absent: every file its runtime, hooks, file tools and GSD tools load is a shipped unit or a project file; no installed or generated project file contains the kit path; a kit change reaches the project only through `update`.
- Acceptance: install into a temp project, rename the kit folder, then with fakes for the Paseo CLI/daemon and Claude CLI and a file-access trace: `ph config` prints values equal to the shipped defaults; `ph doctor` prints its config, overlay, adapter and provider-policy lines with no `cannot find`/`missing module` problem; the io guard given a fixture transcript with a re-read of an edited file prints its reminder (expected non-empty output, no config or import error on stderr); a file-backend `read_ranges` request resolves the project root by discovery, verifies its backend against the manifest and returns the file; `ph gsd roadmap analyze` on a fixture `.planning/` returns JSON with exit 0; the trace shows no path under the old kit location; grep of the project tree for the kit's absolute path in both slash forms finds nothing.
- Source: INS-55, INS-59, HIS-31, INV-09, D-04.
- Scope: v1

#### INST-26 No Backlog and no legacy migration
- Requirement: no verb reads, creates or edits `backlog/`, `.backlog/` or `backlog.config.yml`, runs a `backlog` CLI, prints a Backlog line or writes `BACKLOG.MD` markers; no verb reads or moves `.claude/harness-kit.json`, `.claude/harness.config.json`, `.claude/harness-history.md` or `.agents/skills/harness/scripts/config.json`.
- Acceptance: project holding `backlog/tasks/x.md` and `.claude/harness.config.json`: `install` and `update` leave both byte-identical; stdout has no `backlog` (case-insensitive); a fake `backlog` on PATH logs zero calls.
- Source: INS-16, INS-17, INS-18, INS-19 (all dropped), D-01, I-13, S-03, S-07.
- Scope: v1

#### INST-27 Upgrade from kit 0.1.0 without migration code
- Scope: withdrawn — reinterpreting old manifest records during `update` is migration code, contrary to D-01/D-110; replaced by INST-31 (refusal plus a documented fresh install).
- Requirement: `update` on a project whose manifest has 0.1.0 entries (16-hex digests, a `kit` key) runs with no migration code: a recorded digest that is not 64 hex chars counts as I = null, so parts equal to the kit become `same`, differing ones `both` and retired 0.1.0 files `removed-local`, all kept and listed (exit 2), nothing overwritten without `--force` and nothing deleted; the rewritten manifest drops `kit` and holds only 64-hex digests.
- Acceptance: fixture 0.1.0 manifest with an absolute `kit` path, 16-hex digests, a retired `.agents/skills/harness/SKILL.md` and `.claude/hooks/subagent_file_tools.mjs`: `update` exits 2, no file deleted, both listed as kept, new manifest without `kit` and with 64-hex digests only.
- Source: D-01, D-110, INS-05, R-06, INV-01, INV-03.

#### INST-28 Documentation of install and machine
- Requirement: README and `kit.mjs help` state: the verbs and flags as implemented (pull with several parts and `--kit`); requirements (Node per the gate, Claude Code >= the mod minimum, Paseo CLI with a running daemon, Git); the ownership table (defaults and runtime kit-owned; overlay, history and `.planning/` project-owned and seeded once; manifest generated; `.claude/settings.json` shared with reconciled kit entries; Paseo config Paseo-owned); what `--force` never overrides (INST-22); that `install` never edits Paseo settings and `machine apply` carries the deny rules; the upgrade of a kit 0.1.0 project by fresh install (INST-31: move the old manifest aside, run `install`, resolve the listed conflicts, delete retired files by hand); and one `claude mcp remove --scope user <name>` command per old `fsbatch`/`filesystem` server for the owner to run when ready.
- Acceptance: offline doc test greps README and `kit.mjs help` for each item; README names no `Backlog`, `Codex`, `OpenCode` or Pi requirement and mentions `fsbatch`/`filesystem` only in the removal note; owner reads the README once (manual check).
- Source: INS-13, INS-58, INS-60, D-03, D-14, D-108.
- Scope: v1

#### INST-29 Offline install and machine tests
- Requirement: the install and machine test suites use only temp kit, project and home folders whose names contain spaces, a fake Claude CLI (`CLAUDE_CLI`; logs args, cwd and `CLAUDE_CONFIG_DIR`; simulates `--version`, `plugin marketplace list`, `plugin install` and failure codes) and a fake Paseo CLI (`PASEO_CLI`; logs `reload`), with `PASEO_HOME` and `CLAUDE_CONFIG_DIR` in the temp home and `PASEO_HARNESS_ROOT` cleared; every gate-failure test asserts no side effect; no test reads or writes the owner's live Paseo or Claude config or reaches a daemon.
- Acceptance: suite passes with `HOME`/`USERPROFILE` pointed at a temp folder and no network; a guard fails the run if any test resolves a path under the real home; fake logs contain no `restart`, `mcp` or model call.
- Source: INS-57, INV-57, HIS-76, P11.
- Scope: v1

#### INST-30 kit-init user skill
- Requirement: the kit ships `user/skills/kit-init/` whose description triggers on init/initialize/set up/bootstrap a project (also Vietnamese phrases) and `/kit-init` and excludes Claude Code's built-in `/init`; the kit root is printed by the shipped script `user/skills/kit-init/scripts/kit-root.mjs`, which takes its own realpath and walks up to the first ancestor holding both `kit.mjs` and `kit.json` (for the shipped layout: three levels above the `kit-init` folder), failing with `failed: no paseo-kit root above <path>` otherwise; the skill uses only that output; steps, each reported in one line, ending with a done/skipped/needs-owner summary: (1) git: no repository -> ask before `git init`, no commit; a parent repository -> ask; uncommitted changes announced; (2) report requirements (Node, Claude Code, Paseo CLI and daemon) without installing anything globally; (3) `install` when no manifest else `update`, always with `--enable-plugin`, under the intended `CLAUDE_CONFIG_DIR`; exit 2 -> report conflicts, never add `--force` or run `pull` without the owner; (4) `kit status` and `ph doctor`, report every `problem` line, say hooks and the mod need a new Claude session; (5) point to `gsd-map-codebase` and then the `harness` adapter generator. No Backlog requirement and no syntax-hook writing step.
- Acceptance: filesystem test: `kit-root.mjs` reached through a Windows junction and through a POSIX directory symlink to `<kit>/user/skills/kit-init` prints `<kit>`; a copy outside any kit fails with the message; skill lint checks the description triggers and exclusion, the five steps and the never-force/never-pull rule; manual check: run the skill in an empty temp folder with `circle/gpt-6-luna-fast[1m]`: it asks before `git init`, runs `install --enable-plugin` without `--force`, the summary lists every step.
- Source: INS-56, HIS-36 (kit-init part), D-02, D-07, D-109, INV-50.
- Scope: v1

#### INST-31 Older manifest refused; upgrade by fresh install
- Requirement: a manifest that is not in the current format (a digest that is not 64 hex chars, a `kit` key, or missing `version`/`files`) is never read for ownership nor rewritten: `install`, `update`, `status` and `pull` exit 1 with `failed: .agents/harness-kit.json was written by an older kit; move it aside (e.g. to .agents/harness-kit.old.json) and run install` and change nothing; after the owner moves it aside, `install` runs as on any project (INST-08): differing files surface as `conflict` lines (exit 2), files the kit no longer ships are left untouched; the kit never reads or deletes the moved-aside file.
- Acceptance: fixture 0.1.0 project (absolute `kit` path, 16-hex digests, a retired `.agents/skills/harness/SKILL.md`, `.claude/hooks/subagent_file_tools.mjs`): each verb exits 1 with the message and the tree hash is unchanged; after renaming the manifest, `install` exits 2 listing the differing kit files, both retired files and the renamed manifest are byte-identical, the new manifest is current-format.
- Source: D-01, D-110, INS-05, INS-08, R-06, INV-01, INV-03.
- Scope: v1

#### INST-32 Manifest record policy
- Requirement: a manifest write starts from the previous records and changes only these: a unit copied from the kit (or found `same`) records K; a part pulled into the kit records P; a `gone` part and a deleted `removed` part lose their key; every other recorded unit (kept `local`, `both`, `removed-local`, skipped by `pull`, or not selected by `pull <part>`) keeps its previous I unchanged; a conflict kept at `install` stays unrecorded until a later copy takes it; P is never recorded for a part that was not copied in either direction.
- Acceptance: install, then edit file A (local), edit file B while the kit changes B (both), retire file C after editing it (removed-local); run `update` twice and `pull <project> D` for an unrelated `local` part D: after each run the manifest values of A, B, C equal the values before it and their states stay `local`, `both`, `removed-local`; only D's record becomes its project digest.
- Source: INS-10, INS-12, INS-06, INV-01, INV-02.
- Scope: v1

#### INST-33 Prospective ownership record during wiring
- Requirement: `install` and `update` build the new ownership record in memory before wiring (previous records updated per INST-32 for every copy just made); hook reconcile (INST-14) and mod activation (INST-20) decide "unmodified kit file" from this prospective record, never from the previous file on disk; the record is persisted as the manifest only after every wiring step succeeded (INST-18); kept conflicts keep their old evidence in it.
- Acceptance: fresh `install --enable-plugin` registers every kit hook and reaches `plugin install`; a clean kit-version `update` (kit hook and mod files changed, project untouched) registers the new hooks and activates; `update --force` over a locally edited hook registers it; a run whose plugin step fails leaves the old manifest unchanged and the rerun succeeds; a locally edited, not forced hook is still blocked.
- Source: INS-20, INS-25, INS-27, HOK-02, HIS-35, INV-04.
- Scope: v1

### MACH: machine (M2)

#### MACH-01 machine CLI surface
- Requirement: `kit.mjs machine check | apply [--no-reload] [--enable-paseo-plugins] [--link-user-skills] [--unlink-user-skills] | export`; an unknown subcommand or argument (including the retired `--dirs`, `--fs-server`, `--remove-local`) prints usage and exits 1 with nothing written; expected failures print `failed: <msg>`, unexpected `error: <msg>` (exit 1); the provider-policy check and apply are part of `check` and `apply`, with no separate sync script or shim.
- Acceptance: `machine bogus` and `machine apply --dirs C:/` exit 1 and leave the temp Paseo config and Claude config dirs byte-identical; the kit tree has no `sync_agent_provider.mjs`.
- Source: INS-37, INS-54, D-07.
- Scope: v1

#### MACH-02 machine check is read-only
- Requirement: `machine check` prints only `ok <text>`, `problem <text>` and `note <text>` lines; exit 0 when no `problem`, 2 when any, 1 when the Paseo config (`$PASEO_HOME/config.json`, default `~/.paseo/config.json`) is missing or unparsable; it writes no file, calls no model, never starts, stops or restarts a daemon, and its only external call is `claude --version`.
- Acceptance: Paseo config and temp Claude config dir bytes and mtimes identical before and after; fake Claude CLI log holds only `--version`; fake Paseo CLI log is empty; a missing config gives exit 1.
- Source: INS-38, HIS-76, INV-07, P4.
- Scope: v1

#### MACH-03 machine check lines
- Requirement: `check` prints, in order: the Node gate; the platform (`ok`); the Claude Code version against the mod minimum (`problem` when lower or unknown); a `note` that mod activation is per project (verify with `kit install|update --enable-plugin` and `ph doctor`); per template provider whether it exists and which template model ids it lacks (`problem`); the worker and main policy lines (MACH-04, MACH-05); one `note` per model id present in a kit provider but no longer in the template ("left for the owner to remove in Paseo"); Paseo plugin lines (`note` unless the run enables plugins, MACH-15); one line per user-skill link target (MACH-16). It prints no MCP-server, `machine.local.json` or Backlog line.
- Acceptance: golden test over fixture Paseo configs reproduces the line set; stdout matches no `backlog|mcp|machine.local` (case-insensitive); a live provider with an extra model `old-x` gives exactly one `note` naming it and does not change the exit code.
- Source: INS-38, INS-46, INS-48, INS-47, D-07, D-15, HIS-90.
- Scope: v1

#### MACH-04 Worker provider policy check
- Requirement: for each `main -> worker` pair of `agent_providers`: a missing worker provider is a `problem` naming `kit.mjs machine apply`; a present `disallowedTools` that is not an array is a `problem` (owner review), absent or null counts as `[]`; every entry of `agent_provider_disallowed_tools` the worker lacks is listed in one `problem`; every `agent_provider_env` key missing or different is listed in one `problem`; denies beyond the required list are counted in `ok ... N owner extra rule(s) preserved`, never a problem; there is no native-file-deny or legacy-fingerprint logic (every provider is Claude Code).
- Acceptance: worker lacking `SendMessage` -> `problem` naming it, exit 2; adding an owner deny `Bash(rm *)` -> `ok` with `1 owner extra rule(s) preserved`; `disallowedTools: "x"` -> `problem`; a worker that also denies `Read` gets no special line beyond the extra count.
- Source: INS-49, RUN-05, D-06, S-16.
- Scope: v1

#### MACH-05 Main provider policy check
- Requirement: for each key of `agent_providers`: a missing provider or a non-array `disallowedTools` is a `problem`; a provider lacking any `main_provider_disallowed_tools` entry gives `problem main provider <name> lacks <tools> (main sessions orchestrate through Paseo, not native subagents); run kit.mjs machine apply`; otherwise `ok main provider <name>: Agent, Workflow disallowed (orchestration goes through Paseo)`; whether `SendMessage` is denied or allowed on a main provider never yields a `problem`.
- Acceptance: `circle` without `Workflow` -> `problem`, exit 2; `circle` denying `[Agent, Workflow]` only -> `ok`, exit 0; `circle` denying `[Agent, Workflow, SendMessage]` -> the same `ok` line.
- Source: INS-50, HIS-25, D-06, INV-06.
- Scope: v1

#### MACH-06 Machine keys in the defaults
- Requirement: the shipped defaults hold `agent_providers` `{circle: circle-agent}`; `agent_provider_disallowed_tools` exactly `Agent, AskUserQuestion, CronCreate, CronDelete, CronList, DesignSync, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, ListAgents, Monitor, PushNotification, ReportFindings, ScheduleWakeup, SendMessage, WebSearch, Workflow`; `agent_provider_env` `{ENABLE_TOOL_SEARCH: "true"}`; `main_provider_disallowed_tools` exactly `[Agent, Workflow]`; no `agent_mcp` key; a mapping whose main equals its worker fails validation.
- Acceptance: `loadKitConfig()` deep-equals these four values; `SendMessage` is in the worker list and not in the main list; a defaults fixture with `{circle: circle}` fails with `invalid harness config agent_providers.circle: ...`.
- Source: RUN-03, RUN-04, RUN-05, INS-42, D-06, INV-06.
- Scope: v1

#### MACH-07 apply gates before any write
- Requirement: `machine apply` runs the Node gate, the Claude Code version gate, the Paseo config read and parse, secret resolution (MACH-10) and the full in-memory patch (MACH-08, MACH-09) before writing the Paseo config, a backup or a user-skill link; any failure exits 1 with nothing written.
- Acceptance: fake Claude CLI below the minimum -> exit 1, Paseo config byte-identical, no backup file, no link; an unresolvable secret -> same; a non-array worker `disallowedTools` -> same.
- Source: INS-39, INS-29, INV-04.
- Scope: v1

#### MACH-08 Additive provider and model plan
- Requirement: against the rendered template (template plus machine keys), `apply` adds a missing main provider from the template (secrets filled, `_` keys dropped, `{{HOME}}` expanded) and prints `paseo: added provider <name>`; a missing worker is a deep copy of the live main provider when it exists (label `<label> (harness agents)`, description naming its source), else built from the template; for a present provider only template model entries whose `id` is missing are appended (`paseo: added to <name>: <ids>`); existing models, fields and credentials are never edited or removed; `metadataGeneration` is written only when absent; model ids the template no longer ships are reported by `check` (MACH-03), never removed.
- Acceptance: live config with a custom model, an owner-only provider and a `metadataGeneration`: after apply those are JSON-equal to before and only missing ids were appended; empty `agents.providers` -> both providers created with the template models; a second apply writes nothing.
- Source: INS-41, INS-51, D-15, HIS-90 (superseded by D-15), INV-07.
- Scope: v1

#### MACH-09 Union-only policy apply
- Requirement: each worker's `disallowedTools` becomes its existing list plus the missing required entries (existing order kept, duplicates removed, nothing removed); each worker's `env` gets every `agent_provider_env` key (kit values win for those keys only); main providers are patched after the workers (a worker clone copies the main as the owner left it) with `disallowedTools` = existing plus missing `main_provider_disallowed_tools`; apply is idempotent.
- Acceptance: an owner deny survives; fixture defaults whose main list holds `KitMainOnly` (absent from the worker list) and a live main that already denies the owner rule `OwnerOnMain`, with the worker missing: after apply the new worker denies `OwnerOnMain` (inherited by the deep copy) and does not deny `KitMainOnly` (added to the main only after cloning), while the main denies both; a second apply leaves the file bytes and mtime unchanged.
- Source: INS-51, INS-42, INV-05, INV-07.
- Scope: v1

#### MACH-10 Secrets stay out of the kit
- Requirement: env values whose key matches `/TOKEN|KEY|SECRET|PASSWORD|BASE_URL/i` appear in kit files only as `{{secret:NAME}}`; at apply, the endpoint `ANTHROPIC_BASE_URL` is resolved first from `PASEO_KIT_ANTHROPIC_BASE_URL`, else env `ANTHROPIC_BASE_URL`; any other `{{secret:NAME}}` is filled from `PASEO_KIT_<NAME>`, else from a live provider whose resolved `ANTHROPIC_BASE_URL` is identical and that holds `env[NAME]`, else env `<NAME>`; otherwise `failed: no value for the secret NAME: set the environment variable PASEO_KIT_NAME` and nothing is written; a provider with the same `extends` on another endpoint never lends a value; `{{HOME}}` expands to the home folder.
- Acceptance: missing main provider with no source -> exit 1, config byte-identical; `PASEO_KIT_ANTHROPIC_AUTH_TOKEN` set -> its value used; a live peer on the same endpoint with a token -> reused; a peer on another endpoint -> not used (exit 1 when no other source).
- Source: INS-43, D-13, HIS-30, INV-08.
- Scope: v1

#### MACH-11 Backup and atomic write
- Requirement: every apply that changes the Paseo config first copies it to `<config>.bak-<YYYYMMDD-HHMMSS>-kit` (a same-second collision gets a numeric suffix), then writes through a temp file and rename (2-space JSON, trailing newline); it prints one `paseo: <change>` line per change and `paseo: backup <path>`; an apply with no change writes nothing and prints `paseo: every template provider, model and policy entry is present`.
- Acceptance: two changing applies give two distinct backups, the first byte-equal to the original; a no-change apply creates no backup and leaves the mtime; an injected rename failure leaves the original config byte-identical.
- Source: INS-40, INS-39, INV-07, D-15.
- Scope: v1

#### MACH-12 Reload, never restart; apply exit codes
- Requirement: after a write, unless `--no-reload`, apply runs `<cli> reload` with `<cli>` = `$PASEO_CLI`, else `paseo` on PATH (Windows `.cmd` through cmd.exe); it never runs a daemon start, stop or restart; a reload failure prints `paseo reload failed (<reason>); run it yourself: paseo reload`; then `--- check` and the full check output; exit 1 on any gate, secret or patch failure (nothing written), else 2 when the reload failed or the check reports a problem, else 0; no reload runs when nothing was written.
- Acceptance: fake Paseo CLI exiting 1 -> apply exits 2, the config already holds the change, the reload hint and `--- check` are printed; `--no-reload` -> zero fake calls; the fake log never holds `restart`, `start` or `stop`.
- Source: INS-53, INS-39, D-09, INV-07.
- Scope: v1

#### MACH-13 export writes a scrubbed template
- Requirement: `machine export` reads the live config; the provider set is every key and value of `agent_providers` (a missing one fails, exit 1); per provider, every env field whose key matches the secret pattern is replaced structurally by `{{secret:KEY}}`, a home-folder prefix becomes `{{HOME}}`; in other string values (labels, descriptions) a secret value of at least 8 characters, and the host of a secret URL, is replaced only as a whole token (bounded by start/end or a non-alphanumeric character), shorter values are never substituted; the output uses the canonical template representation of MACH-14 (worker: no `disallowedTools`, no kit `agent_provider_env` keys; main: its live denies plus the main list); `metadataGeneration` is copied when present; `_notes` explains placeholders, apply and reload; before writing it checks that every secret-keyed env field is a placeholder and that no secret value of at least 8 characters and no secret host occurs as a whole token, else `failed: a secret would be written into the template; not written`; `paseo/providers.json` is written atomically; the live config is never changed.
- Acceptance: live token `fixture-secret` and endpoint `https://proxy.example.test/v1` also named in a description: output lacks the token, URL and host, has the placeholders and parses as JSON; a 1-char secret `a` and overlapping secrets (`abcdefgh`, `abcdefgh-2`) give valid JSON with secret fields as placeholders, non-secret strings and property names intact; live config byte-identical; a forced-leak fixture exits 1 and leaves the old template unchanged; round trip: export -> render -> apply on an empty config -> check exits 0, including a live main with an owner extra deny.
- Source: INS-44, D-08, HIS-30, INV-08, install C-10.
- Scope: v1

#### MACH-14 Shipped provider template
- Requirement: `paseo/providers.json` holds `circle` (main sessions) and `circle-agent` (workers), both `extends: "claude"`, env `CLAUDE_CONFIG_DIR: "{{HOME}}/.claude-circle"` and `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` as `{{secret:...}}`; canonical policy representation (shared with MACH-13): a worker stores no `disallowedTools` and none of the kit `agent_provider_env` keys (rendered from the defaults at apply/check), a main stores `disallowedTools` = its exported owner denies plus `main_provider_disallowed_tools` (the shipped release file: exactly `[Agent, Workflow]`, never `SendMessage`); the file is produced by `machine export` and passes the template schema check without hand editing; the model list is the owner-confirmed export; no tracked kit file holds a secret value, the endpoint host or an absolute home path; the kit takes no position on per-provider alias mappings.
- Acceptance: test parses the file and checks it with the same template schema `export` uses (shape, both `extends`, placeholders, no worker policy fields, `circle` deny list); a test scans tracked files for env values under secret-pattern keys that are not placeholders; manual check before release: the owner confirms the model list and greps the repository for the endpoint host locally.
- Source: INS-45, D-06, D-08, HIS-30, HIS-75, INV-08.
- Scope: v1

#### MACH-15 Paseo plugins only on request
- Requirement: only with `--enable-paseo-plugins`, apply sets `pluginsEnabled: true`, registers the kit's `plugins/planning-panel` and `plugins/swarm-map` as `{source: "directory", path: <absolute plugin dir>, enabled: true}`, runs `npm ci` in a plugin folder without `node_modules` (600 s timeout) and prints `paseo plugin reload <id>`; a user entry with the same id pointing elsewhere is kept and reported `conflict Paseo plugin <id>: user entry kept` (exit 2); in that run `check` reports a missing or disabled kit plugin as `problem`, otherwise as `note`; without the flag `pluginsEnabled` and `plugins` stay byte-identical; no backlog plugin exists.
- Acceptance: fixture with a user plugin entry: apply without the flag leaves both keys JSON-equal; with the flag the two kit entries are added and the user entry is unchanged; the fake npm is called once per plugin folder lacking `node_modules`.
- Source: INS-47, D-96, INV-05.
- Scope: v1

#### MACH-16 kit-init linked into the provider config dirs
- Requirement: `apply --link-user-skills` creates, for each distinct rendered `CLAUDE_CONFIG_DIR` of the template providers, `<dir>/skills/kit-init` as a link (junction on Windows, directory symlink elsewhere) to `<kit>/user/skills/kit-init` and records `{dest, target}` in the machine record `~/.paseo-kit/user-links.json` (`{version: 1, links: [...]}`, atomic write, outside any repository); a link is kit-made only when the record holds its `dest` and the link on disk still points at the recorded `target`; only such a link is re-pointed (rename aside, create the new link, restore the old one if creation fails, then delete the aside copy) or, with `apply --unlink-user-skills`, removed with its record entry; anything else at `dest` (a real folder, a file, an unrecorded link even with a matching path suffix, a recorded link the owner re-pointed) is the owner's and is never touched (`note <path>: owner entry kept`); `check` prints per dir `ok` (kit link here), `note` (missing) or `note` (owner entry).
- Acceptance: temp home with config dirs A-E: A empty -> link created and recorded; B owner-made link to another checkout's `user/skills/kit-init` (unrecorded) -> untouched; C recorded link that the owner re-pointed -> untouched; D recorded link to an old kit path -> re-pointed; E owner folder -> byte-identical; injected link-creation failure on D leaves the old link in place; unlink removes only A's and D's links and their records; `check` lines match per dir.
- Source: D-07, INS-56, install C-14, INV-03.
- Scope: v1

#### MACH-17 Machine operations target the template's config dirs
- Requirement: the Claude config dir used by machine operations is the first template provider's rendered `CLAUDE_CONFIG_DIR`, else `$CLAUDE_CONFIG_DIR`, else `~/.claude`; link operations use every template provider's dir; the Paseo config is `$PASEO_HOME/config.json` (default `~/.paseo/config.json`).
- Acceptance: template `{{HOME}}/.claude-circle` with a different `$CLAUDE_CONFIG_DIR`: every logged fake Claude CLI call carries `CLAUDE_CONFIG_DIR=<temp home>/.claude-circle`; `PASEO_HOME` pointing at a temp folder is the only Paseo config read.
- Source: INS-62.
- Scope: v1

#### MACH-18 No override of another tool's settings
- Requirement: apply changes only `agents.providers` entries of the providers named by `agent_providers`, plus `pluginsEnabled`/`plugins` under MACH-15 and an absent `metadataGeneration`; `agents.skills.selection`, tool and browser selections, other providers, owner plugin entries and every other key stay unchanged; the main deny list is the only kit-forced setting on a main provider.
- Acceptance: fixture with custom skill, tool and browser selections and an owner provider: a JSON diff of before and after touches only the allowed paths.
- Source: HIS-27, HIS-76, INV-05, P2.
- Scope: v1

#### MACH-19 No MCP file-server handling
- Requirement: `machine` never runs `claude mcp`, never reads or writes `machine.local.json` and registers no MCP server; removing old `fsbatch`/`filesystem` registrations is the owner's step documented in INST-28.
- Acceptance: fake Claude CLI logs no `mcp` call across `check`, `apply` and `export`; no `machine.local.json` appears; the kit tree has no `mcp/` folder.
- Source: INS-46, D-03, S-01.
- Scope: v1

### CONF: config (M3)

#### CONF-01 Defaults plus one project overlay
- Requirement: the effective config is `.agents/harness.defaults.json` (kit-owned, `_`-prefixed keys stripped) merged with `.agents/harness.config.json` (project-owned) when that file exists; the root is `$PASEO_HARNESS_ROOT`, else cwd; no overlay means defaults only; an overlay that is not a JSON object fails with `invalid harness config overlay: expected an object`; overlay keys starting with `_` are ignored; the defaults object is never mutated by a load.
- Acceptance: overlay with `_notes` loads equal to defaults; no overlay -> equals defaults; overlay `[]` -> the message; `PASEO_HARNESS_ROOT` pointing at another fixture root loads that root's overlay; two loads with different overlays in one process return independent results.
- Source: RUN-01, HIS-32, D-77, P3.
- Scope: v1

#### CONF-02 Safe JSON reading
- Requirement: one `readText` helper strips a leading UTF-8 BOM and is used by every kit module that reads a kit or project text record (including the shasum-format `freeze_*.sha256` lines, which keep their format, and JSONL journals read line by line); one `readJson` helper layered on it parses whole-file JSON (defaults, overlay, manifest, `run.json`, `args.json`, `tasks.json`, Paseo config); overlay keys `__proto__`, `constructor` or `prototype` at any depth fail with `invalid harness key <key>`.
- Acceptance: a BOM-prefixed overlay and manifest load; a BOM-prefixed freeze file verifies as shasum lines (not parsed as JSON); a nested `{"tiers": {"__proto__": {}}}` fails with the message; lint: no shipped module calls `JSON.parse` on a whole file read outside `readJson` and no module reads a text record without `readText` (JSONL line parsing allowed).
- Source: RUN-01, runtime Concerns (BOM list), INV-52.
- Scope: v1

#### CONF-03 Machine keys cannot be set by a project
- Requirement: overlay values for `agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env` and `main_provider_disallowed_tools` are ignored; the loaded values always equal the defaults.
- Acceptance: overlay `{"main_provider_disallowed_tools": []}` loads `[Agent, Workflow]`; overlay `{"agent_providers": {"x": "y"}}` loads `{circle: circle-agent}`.
- Source: RUN-03, INV-05, INV-06.
- Scope: v1

#### CONF-04 Merge rules
- Requirement: `tiers`, `tier_aliases`, `platform_notes`, `context_guard`, `io_guard`, `read_limits`, `adapter` and `gsd` merge one level per entry (an overlay entry replaces that whole entry, e.g. a whole tier object); every other key is replaced wholesale (arrays are never unioned).
- Acceptance: overlay `io_guard: {step_rounds: 3}` keeps the other three defaults; `allowed_models: ["circle/x"]` replaces the default list; `tiers: {pro: {...}}` keeps `frontier` and `standard` and replaces `pro` wholly; `adapter: {review_lenses: [...]}` keeps the other `adapter` defaults.
- Source: RUN-02, HOK-10, HOK-22, D-77.
- Scope: v1

#### CONF-05 Closed validation
- Requirement: the same validation runs on the defaults alone (`loadKitConfig()`) and on the merged result (`loadConfig(root)`); an unknown key fails with `invalid harness config <dotted.path>: unknown key`, a missing one with `missing key`, a type mismatch with `expected <type>`; the schema holds types and rules only, never default values (values live only in the defaults file).
- Acceptance: one fixture each for an unknown top-level key, an unknown nested `io_guard.foo`, a key deleted from a defaults fixture and a wrong type, each failing with the exact message; a test asserts the schema module exports no default value.
- Source: RUN-06, P3, P4.
- Scope: v1

#### CONF-06 Typed rules
- Requirement: integers are nonnegative safe integers; `max_subagents`, the live-agent cap, `max_agents_per_workflow`, `wait_timeout_s` and `max_prompt_bytes` are > 0; a tier is an object with only `provider` (matching `^[^/]+/.+$`), optional `thinking` (`off|low|medium|high|xhigh|max`) and optional `features` (object); `default_tier` names a tier, an alias or a `provider/model`; every `tier_aliases` target is a tier or a `provider/model`; `prime_role` is `two-turn|off`; `tier_aliases`, `platform_notes`, `agent_providers` and `agent_provider_env` are string maps; `context_guard.window_tokens` >= 1 and `start_pct`, `step_pct` in 1..100; `io_guard.step_rounds` and `edit_step_rounds` >= 1, the two start keys >= 0; `read_limits` holds exactly `fileMaxChars` and `replyMaxChars`, positive integers with `fileMaxChars <= replyMaxChars <= 40000` (the page size, FTOL-23); `max_live_subagents >= max_subagents`; an unconfigured tier (`provider: ""`, CONF-11) is valid; an `agent_providers` entry whose main equals its worker fails.
- Acceptance: one failing overlay per rule; each message names the dotted key (e.g. `context_guard.start_pct`, `io_guard.step_rounds`, `read_limits.fileMaxChars`); `io_guard.start_rounds: 0` passes; the overlay `read_limits {fileMaxChars: 200000, replyMaxChars: 450000}` is rejected identically by `ph config`, a hook run (one stderr line) and a file-backend request; a 37,000-char reply under the defaults returns in one page without continuation.
- Source: RUN-06, HOK-10, HOK-22, D-06, D-20, D-41, FIL-26.
- Scope: v1

#### CONF-07 adapter and gsd sections; no .planning/config.json
- Requirement: the project's adapter and GSD settings live only in the `adapter` and `gsd` sections of `.agents/harness.config.json` (the defaults ship their schema and kit default values; the key set and per-key rules are the ADPT requirements) and pass the same closed validation; no shipped module reads `.planning/config.json`, and such a file has no effect.
- Acceptance: overlay `adapter.unknown_x` fails with `invalid harness config adapter.unknown_x: unknown key`; a garbage `.planning/config.json` leaves `loadConfig` unchanged; grep of `ship/` for `.planning/config.json` finds nothing.
- Source: D-77, HIS-32, INS-24.
- Scope: v1

#### CONF-08 Invalid overlay blast radius
- Requirement: an invalid overlay (failed validation or unparsable JSON) makes every `ph` command except `help` and `doctor` print `failed: invalid harness config ...` and exit 1; `ph doctor` prints one `problem` line with the message, runs every remaining check with the kit defaults and exits 2.
- Acceptance: overlay with an unknown key: `ph config` exits 1 with the message; `ph doctor` exits 2 and prints the checks after the config line; the same for an overlay holding `{` (not exit 1).
- Source: RUN-07, P4.
- Scope: v1

#### CONF-09 File-tool backend reads config per request
- Requirement: the file-tool backend resolves the config root per request as `$PASEO_HARNESS_ROOT`, else the nearest ancestor of the request cwd holding `.agents/harness-kit.json` or `.agents/harness.config.json`, else the cwd, and applies that root's `read_limits` to that request only; an invalid config fails that call with `invalid harness config <key>: <msg>` while tool registration and descriptions keep working, and the next call after a fix succeeds without a new session.
- Acceptance: project overlay `read_limits {fileMaxChars: 100, replyMaxChars: 200}`: reading a 150-char file is refused naming the 100-character limit; overlay with `typo_key`: the read fails with `typo_key: unknown key`, the tool list is still registered; removing the key makes the next read succeed.
- Source: FIL-18, RUN-63, D-41.
- Scope: v1

#### CONF-10 ph config shows effective values and file provenance
- Requirement: `ph config` prints the merged config as 2-space JSON with `_provenance: {defaults: <abs path>, overlay: <abs path|null>, manifest: {version, installedAt, updatedAt}|null, warnings: []}` and exits 0; nothing in it depends on or shows a kit path.
- Acceptance: output parses as JSON; `_provenance.overlay` is null without an overlay; with the kit folder renamed the output is unchanged and holds no kit path.
- Source: RUN-08, RUN-09, D-04, INV-09.
- Scope: v1

#### CONF-11 Shipped default values
- Requirement: the defaults ship: tiers `frontier`, `pro`, `standard` unconfigured (`provider: ""`, no concrete model id anywhere in the defaults or the seed overlay; example mappings appear only as text in `_notes` and in the provider template, D-16); a project's usable mappings are written into its overlay by the `harness` adapter generator (D-109) or by the owner; resolving an unconfigured tier fails with `tier <name> has no model; set tiers.<name>.provider in .agents/harness.config.json (the harness adapter generator writes it)` and creates nothing, and `ph doctor` reports each unconfigured tier as a `problem`; `tier_aliases` `{}`; `default_tier` `standard`; `mode` `bypassPermissions`; `allowed_models` `[]`; `max_subagents` 20; `max_live_subagents` 40; `max_agents_per_workflow` 1000; `wait_timeout_s` 3600; `schema_retries` 2; `prime_role` `off`; `warmup` false, `warmup_s` 8, `warmup_timeout_s` 90; `max_prompt_bytes` 262144; watchdog `agent_nudge_s` 900, `agent_stop_s` 1800, `agent_tool_stuck_s` 900, `agent_file_tool_stuck_s` 180, `watchdog_repeat_calls` 3, `watchdog_same_file_reads` 3, `watchdog_reads_without_write` 15, `watchdog_enabled` true; `context_guard` 1000000/60/5; `io_guard` 2/2/2/2; `read_limits` `fileMaxChars` 36000, `replyMaxChars` 38000 (FTOL-23); `worktree_dir` `.claude/worktrees`; `runs_keep` 20; `compact_resume` `Compaction done. Continue where you left off; re-arm any Monitor you stopped.`; `platform_notes.win32` carrying the PowerShell re-encoding warning; the kit base `first_prompt_note` (text per PHCL-29) and `project_prompt_note` `""` (CONF-14); the four machine keys (MACH-06); `adapter` and `gsd` defaults (ADPT).
- Acceptance: a drift test compares `loadKitConfig()` with a golden table kept in the test; changing a default without updating the table fails the test; grep of the shipped defaults and seed overlay finds no `provider/model` id outside `_notes`; on an untouched install `ph spawn --name a` fails with the unconfigured-tier message and creates no agent; writing `tiers.standard.provider` in the overlay makes it resolve with no kit or script edit.
- Source: RUN-10, D-16, D-20, D-24, D-36, D-41, D-48, D-109, HIS-74, R-10.
- Scope: v1

#### CONF-12 One loader for every consumer
- Requirement: one module `.agents/harness/config.mjs` exports `loadConfig(root)`, `loadKitConfig()` and `configProvenance(root)`; `ph`, the hooks, the file-tool backend, the `ph gsd` tools and `kit.mjs` load config only through it; no consumer embeds default values or reads `harness.defaults.json`/`harness.config.json` itself; hooks locate it as the HOOK requirements state (D-49).
- Acceptance: one fixture overlay change is seen identically by `ph config`, a context-guard hook run, a file-tool request and a `ph gsd` verb; lint: no other shipped module opens either config file by name.
- Source: RUN-63, HIS-32, HOK-37, P3.
- Scope: v1

#### CONF-13 Dropped config locations and keys
- Requirement: `.claude/harness.config.json` is never read (a project holding only that file loads the defaults); `modes`, `provider_features`, `agent_mcp`, `context_guard.model_pattern` and the media keys of `read_limits` (`mediaPerTurn`, `mediaTurnGapMs`) are unknown keys that fail validation; the loader emits no deprecation warnings.
- Acceptance: `.claude/harness.config.json` with `{"max_subagents": 1}` -> loaded 20; overlay `{"context_guard": {"model_pattern": "."}}` -> `invalid harness config context_guard.model_pattern: unknown key`; overlay `{"agent_mcp": {}}` -> `unknown key`.
- Source: HOK-37, HOK-10, RUN-02, RUN-06, D-41, S-01, S-03.
- Scope: v1

#### CONF-14 Complete key table; kit and project prompt notes
- Requirement: the closed schema holds exactly these top-level keys (types and rules CONF-06, shipped values CONF-11, merge CONF-04): `tiers`, `tier_aliases`, `default_tier`, `mode`, `allowed_models`, `agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env`, `main_provider_disallowed_tools`, `max_subagents`, `max_live_subagents`, `max_agents_per_workflow`, `wait_timeout_s`, `schema_retries`, `prime_role`, `warmup`, `warmup_s`, `warmup_timeout_s`, `max_prompt_bytes`, `agent_nudge_s`, `agent_stop_s`, `agent_tool_stuck_s`, `agent_file_tool_stuck_s`, `watchdog_repeat_calls`, `watchdog_same_file_reads`, `watchdog_reads_without_write`, `watchdog_enabled`, `compact_resume`, `context_guard`, `io_guard`, `read_limits`, `worktree_dir`, `runs_keep`, `first_prompt_note`, `project_prompt_note`, `platform_notes`, `adapter`, `gsd`; a key another module needs is added here first. `first_prompt_note` is kit-owned like the machine keys: an overlay value is ignored; the project's text goes in `project_prompt_note` (string, shipped `""`), which consumers append after the kit note (PHCL-29) and which can never replace it.
- Acceptance: schema key list equals the list above (test); an overlay `first_prompt_note: "x"` loads the kit text unchanged; one integration fixture overlay sets `max_live_subagents`, `watchdog_enabled: false`, `warmup: true` with `warmup_s` and `project_prompt_note`, and each is seen through the loader by its consumer (live cap refusal, no watchdog line, warm-up gate, rendered prompt with the kit note followed by the project note).
- Source: RUN-10, RUN-02, RUN-06, RUN-63, D-20, D-24, D-36, S-17, P3.
- Scope: v1

### Later

- Generic `kit adopt` for 0.1.0 manifests (retire files only on digest match, move skills into `.claude/skills/`, never touch project data), only if needed. Source: D-01, D-110, INS-18.

### Out of Scope

| Feature | Reason |
| --- | --- |
| Backlog init, block, CLI check, panel | owner: Backlog dropped (S-07) |
| MCP file servers, `machine.local.json`, `agent_mcp`, `--dirs`/`--fs-server`/`--remove-local` | Claude Code only (S-01, D-03) |
| `.agents/skills` tree, skill links, link record, `ph skills-sync` | single skill tree (D-10, S-02) |
| Legacy relocation, legacy `scripts/config.json` migration, 0.0.2 deny fingerprint, `model_pattern` deprecation | from-scratch layout (D-01, S-03, S-16) |
| Replacing provider model lists | additive only (D-15) |
| Moving a particular project onto the kit | that project's own task (D-110) |

### Traceability

Every behavior M1, M2 and M3 absorb in the SYNTHESIS module table, once each. INS-56, RUN-03..05 and HIS-32 are absorbed by two of these modules and listed once. INS-30..35 are not in any module's absorb list; they are listed here because M1's dropped line and S-02 settle them.

| map behavior ID | requirement ID(s) or not a requirement |
| --- | --- |
| INS-01 | INST-01 |
| INS-02 | INST-01, INST-02 |
| INS-03 | INST-03 |
| INS-04 | INST-04 |
| INS-05 | INST-05, INST-31 (INST-27 withdrawn) |
| INS-06 | INST-06 |
| INS-07 | INST-07 |
| INS-08 | INST-08 |
| INS-09 | INST-08 |
| INS-10 | INST-09, INST-32 |
| INS-11 | INST-10 |
| INS-12 | INST-11, INST-32 |
| INS-13 | INST-11, INST-28 |
| INS-14 | INST-12 |
| INS-15 | INST-13 |
| INS-16 | INST-26 (dropped; absence tested) |
| INS-17 | INST-26 (dropped; absence tested) |
| INS-18 | INST-26 (dropped; absence tested); later: generic adopt |
| INS-19 | INST-26 (dropped; absence tested) |
| INS-20 | INST-14, INST-33 |
| INS-21 | INST-15 |
| INS-22 | INST-14, INST-15 |
| INS-23 | INST-16 |
| INS-24 | INST-17, CONF-07 |
| INS-25 | INST-18, INST-33 |
| INS-26 | INST-24 (skills-sync dropped, D-10) |
| INS-27 | INST-20, INST-33 |
| INS-28 | INST-21 |
| INS-29 | INST-20, INST-23, MACH-07 |
| INS-30 | not a requirement: dropped (D-10, S-02); replaced by INST-24 |
| INS-31 | not a requirement: dropped (D-10, S-02); replaced by INST-24 |
| INS-32 | not a requirement: dropped (D-10, S-02); replaced by INST-24 |
| INS-33 | not a requirement: dropped (D-10, S-02); replaced by INST-24 |
| INS-34 | not a requirement: dropped (D-10, S-02); replaced by INST-24 |
| INS-35 | not a requirement: dropped (D-10, S-02); replaced by INST-24 |
| INS-36 | INST-19 |
| INS-37 | MACH-01 |
| INS-38 | MACH-02, MACH-03 |
| INS-39 | MACH-07, MACH-11, MACH-12 |
| INS-40 | MACH-11 |
| INS-41 | MACH-08 |
| INS-42 | MACH-06, MACH-09 |
| INS-43 | MACH-10 |
| INS-44 | MACH-13 |
| INS-45 | MACH-14 |
| INS-46 | MACH-19, MACH-03 (dropped; absence tested) |
| INS-47 | MACH-15 |
| INS-48 | MACH-03 (dropped; absence tested) |
| INS-49 | MACH-04 |
| INS-50 | MACH-05 |
| INS-51 | MACH-08, MACH-09 |
| INS-52 | not a requirement: dropped (S-16, no 0.0.2 policy in the new kit) |
| INS-53 | MACH-12 |
| INS-54 | MACH-01 (shim dropped; function in `machine check` and `machine apply`) |
| INS-55 | INST-25 |
| INS-56 | INST-30, MACH-16 |
| INS-57 | INST-29 |
| INS-58 | INST-28 |
| INS-59 | INST-24, INST-25 |
| INS-60 | INST-22, INST-28 |
| INS-61 | INST-15 (shell is a kit hook, D-45; checker contract in HOOK) |
| INS-62 | MACH-17 |
| HOK-02 | INST-14, INST-33 |
| HOK-29 | INST-14, INST-15 |
| HIS-25 | MACH-05, MACH-06 |
| HIS-27 | MACH-18 |
| HIS-30 | MACH-10, MACH-13, MACH-14 |
| HIS-31 | INST-25 |
| HIS-32 | CONF-01, CONF-12, INST-17 |
| HIS-33 | INST-08, INST-24 |
| HIS-34 | INST-19 |
| HIS-35 | INST-20, INST-21, INST-33 |
| HIS-36 | INST-30 (kit-init part; the ai-orchestrator part is M11's) |
| HIS-76 | MACH-02, MACH-18, INST-29 |
| HIS-88 | INST-12, INST-13 |
| HIS-90 | MACH-08, MACH-03 (superseded by D-15: additive plus notes) |
| RUN-01 | CONF-01, CONF-02 |
| RUN-02 | CONF-04, CONF-13, CONF-14 |
| RUN-03 | CONF-03, MACH-06 |
| RUN-04 | MACH-06 (list corrected by D-06: Agent, Workflow) |
| RUN-05 | MACH-06, MACH-04 |
| RUN-06 | CONF-05, CONF-06, CONF-14 |
| RUN-07 | CONF-08 |
| RUN-08 | CONF-10 |
| RUN-09 | CONF-10 |
| RUN-10 | CONF-11, CONF-14 |
| RUN-63 | CONF-09, CONF-12 |
| HOK-10 | CONF-06, CONF-13 |
| HOK-22 | CONF-06 |
| HOK-37 | CONF-12, CONF-13 |
| FIL-18 | CONF-09 |

### Counts

- v1 requirements: 65 (INST 32, MACH 19, CONF 14); withdrawn: 1 (INST-27)
- later items: 1
- behaviors traced: 91 (85 absorbed by M1..M3 plus INS-30..35)
- behaviors not a requirement: 7 (INS-30..35, INS-52)

### Revision log r1

| finding ID | accepted / rejected | what changed (requirement IDs) or why rejected |
| --- | --- | --- |
| SR-PLT-01 | accepted | MACH-13: structural replacement of secret env fields, whole-token scrub only for values >= 8 chars and secret hosts, structural leak check; short and overlapping secret fixtures; source adds install C-10 (INS-44 proposal verified). |
| SR-PLT-02 | accepted | New INST-32 (record policy: previous I kept for kept, skipped and unselected parts; P only for pulled parts); INST-09 references it; trace INS-10, INS-12. |
| SR-PLT-03 | accepted | INST-25 acceptance: ph config, ph doctor, io-guard output, file-backend discovery and manifest check, `ph gsd` read verb, access trace with the kit renamed. |
| SR-PLT-04 | accepted | INST-23: `NODE_RUNTIME {minVersion, capabilities}` table set by a release qualification check, boundary tests, test-runner floor separate; machine and doctor report the same gate. |
| SR-PLT-05 | accepted | INST-27 withdrawn (old-record reinterpretation is migration code, D-01/D-110); new INST-31: older manifest refused, owner moves it aside, fresh install surfaces conflicts; INST-08, INST-09, INST-28 reference it. |
| SR-PLT-06 | accepted | MACH-16: kit-made proven only by a record `{dest, target}` in `~/.paseo-kit/user-links.json` still matching the disk link; rename-aside replacement; owner, suffix-matching and re-pointed links untouched; fixtures A-E. |
| SR-PLT-07 | accepted | CONF-11: tiers ship unconfigured (`provider: ""`), examples only in `_notes`/template; mappings written by the adapter generator or owner; unconfigured tier fails with a named diagnostic, doctor problem; CONF-06 accepts the unconfigured state. Note for PHCL-22: its "outside the tier table" exception no longer applies. |
| SR-PLT-08 | accepted | New INST-33 (prospective in-memory ownership record used by wiring, persisted only after success); INST-14, INST-18, INST-20 reference it; fresh-install and clean-update acceptance added. |
| SR-PLT-09 | accepted | INST-13: warning condition independent of state; state and force/pull rules unchanged; local, both and unrecorded fixtures. |
| SR-PLT-10 | accepted | MACH-09 acceptance rewritten: owner rule on the live main is inherited by the clone, a main-only kit entry added after cloning is not. |
| SR-PLT-11 | accepted | MACH-13 and MACH-14 share one canonical representation (worker without policy fields, main = owner denies plus main list; release file exactly `[Agent, Workflow]`); export -> render -> apply -> check round trip with a main extra. |
| SR-PLT-12 | accepted | CONF-06: `read_limits` exactly two keys, `fileMaxChars <= replyMaxChars <= 40000`; CONF-11 defaults 36000/38000 per FTOL-23; cross-consumer rejection and one-page read acceptance. |
| SR-PLT-13 | accepted | New CONF-14 (complete top-level key table incl. `max_live_subagents`, `watchdog_enabled`, `warmup_s`, `warmup_timeout_s`, `worktree_dir`, `runs_keep`, `project_prompt_note`; `first_prompt_note` kit-owned); CONF-06, CONF-11 values aligned with PHCL-24, FLOW-28, FLOW-38, PHCL-29. |
| SR-PLT-14 | accepted | INST-17: install seeds only the empty `.planning/` folder, never a lifecycle artifact, so new-project resume cannot be misled; existing `.planning/` files untouched. The new-project routing test itself belongs to GSDF. |
| SR-PLT-15 | accepted | INST-30: shipped `scripts/kit-root.mjs` walks up from its realpath to the folder holding `kit.mjs` and `kit.json` (three levels above `kit-init`); junction and symlink filesystem test. |
| SR-PLT-16 | accepted | CONF-02: `readText` (BOM-aware) for text records incl. shasum freeze files and JSONL; `readJson` layered on it for whole-file JSON; lint narrowed. |
| SR-PLT-17 | accepted | INST-24 scopes the no-link rule to installed projects and names MACH-16 as the only link; INST-22 states `--force` grants no user-config permission, the marketplace registration under `--enable-plugin` is Claude Code's own. |

---

## Requirements: runtime (M4 paseo-client, M5 ph, M6 workflow)

**Defined:** 2026-10-20
**Modules:** M4 paseo-client (PCLI), M5 ph (PHCL), M6 workflow (FLOW), per `.planning/intel/SYNTHESIS.md`.
**Inputs:** SYNTHESIS (M4..M6 capabilities, INV-NN), DECISIONS D-01..D-111, INGEST-CONFLICTS (W-03, W-04, W-14, W-15), maps `runtime.md` (RUN), `workflow.md` (WFL), `history.md` (HIS), `ui.md` (UI-80).

### Conventions

- `ph` = `node .agents/harness/ph.mjs` in an installed project (single entry, no facade).
- FDC = the fake daemon client used by offline tests: implements the M4 interface (`connect, createAgent, sendPrompt, waitTurn, listAgents, fetchAgent, archive, cancel, stream events`) in memory, records every call, and scripts agent states, permission requests, errors and `turn_completed` events. FCLOCK = injectable clock/timer used by retry, watchdog and watcher tests. Tests never touch the owner's Paseo config or daemon (INV-57).
- "Output contract" (P8): one line per item; item errors `failed <what>: <err>`; exit 0 done, 1 usage/config/file error, 2 done with failed items or problems.
- Config keys are read through the one M3 loader; a key named here and not yet in the M3 table is a requirement on M3 to add it with closed validation.
- Manual checks (named MC-NN) run once per Paseo or Claude Code version bump, with probe agents on `circle/gpt-6-luna-fast[1m]` (INV-50).
- Vanilla (D-110): nothing below names a project, engine or game; project data (roles -> models, price table, prompt note, thresholds) comes from the project overlay / adapter (M12).
- Shipped prompt text (runtime notes, watchdog messages, denial text) is carried verbatim from the old kit code quoted in the maps; it changes only with owner review (D-35, INV-49).

### v1 Requirements: M4 paseo-client (PCLI)

#### PCLI-01 Single daemon adapter module
- Requirement: exactly one module (`.agents/harness/paseo-client/`) imports the npm Paseo CLI client (`connectToDaemon`) and helpers; no other module of the installed runtime (M4..M10: `.agents/harness/**`, `.claude/hooks/**`, `.agents/workflows/**`) imports `@getpaseo/cli`, `@getpaseo/server` or any daemon-client path, or talks to the daemon; the M13 Paseo plugins (`plugins/`, never installed into projects) use the host-provided plugin SDK (`@getpaseo/plugin`) and are outside this rule; the module exposes `connect(), createAgent(), sendPrompt(), waitTurn(), UsageTracker, listAgents(), resolveTargets(), archive(), cancel()` and accepts an injected client so FDC can replace it.
- Acceptance: import scan over `ship/` finds `@getpaseo/*` imports only under `paseo-client/`; the scan over `plugins/` accepts `@getpaseo/plugin` and fails on `@getpaseo/cli` or `@getpaseo/server`; the PCLI/PHCL/FLOW test suites run green against FDC with no network.
- Source: RUN-25, D-17, R-01, P11, UI-01.
- Scope: v1

#### PCLI-02 Paseo CLI location
- Requirement: the CLI directory is the first of `$PASEO_CLI_DIR`, then for each PATH directory holding `paseo`/`paseo.cmd` its `node_modules/@getpaseo/cli` and `../lib/node_modules/@getpaseo/cli`, then the npm global dirs (`%APPDATA%/npm/node_modules/@getpaseo/cli`, `/usr/local/lib/...`, `/usr/lib/...`) that contains `dist/utils/client.js`; none found -> usage error `the npm-installed Paseo CLI was not found (npm i -g @getpaseo/cli, or set PASEO_CLI_DIR)`, exit 1. The structured-output helper of `@getpaseo/server` is not imported (FLOW-13 owns validation, D-30).
- Acceptance: temp dir fixtures: `PASEO_CLI_DIR` pointing at a dir without `dist/utils/client.js` -> that message, exit 1; a PATH dir with a fake `paseo.cmd` and sibling `node_modules/@getpaseo/cli/dist/utils/client.js` is found; paths with spaces work.
- Source: RUN-25, D-17, D-30, INV-52.
- Scope: v1

#### PCLI-03 Daemon address
- Requirement: the client connects to `$PASEO_HOST` when set, else to `daemon.listen` of the Paseo config (`$PASEO_HOME` or `~/.paseo`, `config.json`, BOM stripped); it never reads `paseo.pid`.
- Acceptance: FDC connect spy: with `PASEO_HOST=h:1` the target is `h:1`; unset, with a temp Paseo home whose config has `daemon.listen` and a stale `paseo.pid`, the target is the listen address and the pid file is never opened (fs spy). MC-01: on the owner's Desktop-managed daemon `ph doctor` prints `daemon reachable`.
- Source: HIS-29, D-17, W-15.
- Scope: v1

#### PCLI-04 CLI version gate data
- Requirement: the module records the loaded CLI version and exports one constant `TESTED_PASEO_CLI` (no hard-coded version string elsewhere); `ph doctor` uses both (PHCL-04).
- Acceptance: grep finds the tested version literal only in the constant; doctor test with a fake CLI `package.json` version different from the constant prints a `note` naming both versions.
- Source: RUN-25, D-17, R-01, RUN concern "hard-coded 0.10.0".
- Scope: v1

#### PCLI-05 Size check before any daemon call
- Requirement: `createAgent` and `sendPrompt` measure the UTF-8 byte length of the fully rendered outbound text (task, role, includes, notes, schema/retry wrapper, watchdog messages, compaction reports) before any daemon request and refuse above `max_prompt_bytes` with `prompt is <bytes> bytes > max_prompt_bytes <limit>; pass a file path instead of inlining content`; in `createAgent` the check precedes the model-catalogue request.
- Acceptance: FDC: a 300 KB prompt through `createAgent` and through `sendPrompt` throws the message and FDC records zero calls of any kind; a 2-byte-per-char string is measured in bytes.
- Source: RUN-12, RUN-33, WFL-25, INV-11.
- Scope: v1

#### PCLI-06 Caller required
- Requirement: every agent-creating call requires `PASEO_AGENT_ID`; when unset it throws `PASEO_AGENT_ID is not set: run ph from an agent inside Paseo, so every agent is created as its subagent` before connecting, and creates nothing.
- Acceptance: FDC: `createAgent` with the env var unset -> that message, zero FDC calls.
- Source: RUN-28, INV-10.
- Scope: v1

#### PCLI-07 createAgent payload
- Requirement: `createAgent` sends `{provider, model, cwd, callerAgentId: PASEO_AGENT_ID, title, modeId: cfg.mode, thinkingOptionId?, initialPrompt, outputSchema?, featureValues?: tier.features, disallowedTools? (PHCL-27, only when the client supports per-agent denies), env, labels}`; no `mcpServers` key ever; order: size check, caller check, env, thinking clamp, create.
- Acceptance: FDC records one create call per agent; snapshot test of its keys for a tier with `features: {fast_mode: true}` (featureValues present) and without (absent); no `mcpServers` key.
- Source: RUN-26, RUN-17, RUN-62 (dropped part), S-01.
- Scope: v1

#### PCLI-08 Labels and title
- Requirement: labels = `{...extra, harness.name, harness.run?, ph.swarm, paseo.parent-agent-id: <caller>}` with the parent label written last so no caller label can replace it; `ph.swarm` carries the group name (the spawn/fanout name prefix or the workflow name) so grouping never depends on the title; titles are cut to 60 characters only for workflow agents (`<workflow>:<label>`), while spawn/fanout names over 60 characters are refused up front (PHCL-25).
- Acceptance: FDC: extra label `paseo.parent-agent-id=x` -> stored value is the caller id; a workflow label of 90 chars yields a 60-char title and an intact `ph.swarm` label.
- Source: UI-80, D-100, RUN-26, RUN-29.
- Scope: v1

#### PCLI-09 Worker env and mod env
- Requirement: env = `{PASEO_HARNESS_LEADER: <caller>, PASEO_HARNESS_ROOT: <root>, PASEO_HARNESS_ROLE: "worker"}` plus `CLAUDE_CODE_PLUGIN_DIRS` (existing dirs + the mod's plugin dir, no duplicate) only when all of: (a) the mod is copied (`.claude/plugins/harness-files/.claude-plugin/plugin.json` and `hooks/register.ts` present); (b) the owner's last-wins selection `enabledPlugins["harness-files@paseo-harness-kit"]` over `<worker CLAUDE_CONFIG_DIR>/settings.json`, project `.claude/settings.json`, `.claude/settings.local.json` is not `false`; (c) the mod is affirmatively selected: either the selection is `true` and the plugin is not natively registered (`installed_plugins.json` entry with scope user or this project; a native registration already loads it and a second direct dir would register the tools twice), or the plugin dir is already in the worker's effective `CLAUDE_CODE_PLUGIN_DIRS` (direct). A copied mod with no selection and no direct entry stays inactive (D-02). The worker's `CLAUDE_CONFIG_DIR` and existing `CLAUDE_CODE_PLUGIN_DIRS` come from the worker provider's effective env in the Paseo config (`agents.providers.<worker>.env`, following `extends`), else the invoking process env. The kit never writes or toggles any plugin setting.
- Acceptance: fixture matrix (copied / missing `plugin.json` / missing `register.ts`) x (unset / false / true) x (registered / unregistered) x (direct / not direct): the plugin dir is in the FDC env only for (copied, true, unregistered) and (copied, not false, direct); copied + unset + not direct -> absent; a worker provider whose env names a `CLAUDE_CONFIG_DIR` different from the process -> settings are read from that dir; fs spy: no settings file written; the three `PASEO_HARNESS_*` keys always present; paths compared case-insensitively on win32.
- Source: RUN-26, RUN-61, INV-05, D-02, memory no-kit-overrides-of-tool-settings.
- Scope: v1

#### PCLI-10 Thinking clamp
- Requirement: `clampThinking(requested, supported)` returns the exact level if supported, else the nearest supported level in `off<low<medium<high<xhigh<max` by index distance with ties to the higher level, never `off` unless `off` was the exact request, `undefined` for no request, no options, an unknown requested value or only unknown option ids; supported ids come from the worker provider's catalogue (cached per provider per process); a catalogue failure gives `[]` and creation proceeds without `thinkingOptionId`.
- Acceptance: unit: `xhigh/[high]`->high; `low/[off,medium,high]`->medium; `medium/[low,high]`->high; `medium/[none]`->undefined; `off/[off,low]`->off; FDC catalogue throws -> agent still created, no `thinkingOptionId`.
- Source: RUN-15.
- Scope: v1

#### PCLI-11 Usage tracking from creation
- Requirement: `UsageTracker` subscribes at agent creation; per agent it sums `input, cachedInput, output, turns` from `turn_completed` events with usage, dedups by `turnId` (else `seq`), keeps the last reported `totalCostUsd` as `reportedCostUsd`; `waitTurn` takes a baseline turn count before the turn starts and after idle settles up to 2000 ms (100 ms poll), adding `lastUsage` itself and dropping the next late event when none arrived; error/interrupted turns are not counted; a subscription failure archives the new agent and throws `agent <id8> created but its usage tracking failed (archived): <err>`.
- Acceptance: FDC replay: early event with baseline 0 counted once (output 7, turns 1); duplicated `turnId` counted once; late-settled turn then its late event -> counted once; subscription error -> one archive call and the message.
- Source: RUN-26, RUN-27, WFL-53, INV-15.
- Scope: v1

#### PCLI-12 waitTurn outcomes
- Requirement: `waitTurn(agent, timeoutS)` returns `{text, usage, agent}` on idle (text = structured reply resolved from the last message); an idle turn with empty text fails `finished without a reply`; timeout fails `no reply within <N> s`; any other terminal status fails `agent status <s>`; an unretried or exhausted error fails `agent error: <first line, 300 chars>`.
- Acceptance: FDC scripted states idle/empty/timeout(FCLOCK)/`closed` -> the four results with exact texts.
- Source: RUN-31, WFL-26.
- Scope: v1

#### PCLI-13 Transient provider errors retried with growing pauses
- Requirement: an error turn, or an idle reply whose trimmed text starts with `API Error` or is one line under 300 chars matching `overloaded|rate limit|\b5\d\d\b|\b429\b` (case-insensitive), is continued in the same agent with `Your previous turn ended with an error. Continue the task from where you stopped.` after 30, 60, 120, 240, 300 s, at most 5 times per wait; an error whose text matches `quota|credit|billing|auth|unauthori[sz]ed|forbidden|permission|invalid api key` (case-insensitive, on the error text) is never continued and fails at once.
- Acceptance: FDC + FCLOCK: reply `API Error: overloaded` x6 -> 5 continue prompts at the listed offsets, then `agent error`; `quota exceeded` -> 0 continue prompts, immediate failure; `rate limited` error then idle -> 1 continue, success.
- Source: HIS-15, RUN-31, WFL-26, WFL-52(g), W-04, INV-13.
- Scope: v1

#### PCLI-14 AskUserQuestion denied, other permissions fail
- Requirement: a pending `AskUserQuestion` permission is denied with the text `Nobody answers questions from subagents. Do not ask: decide from the material you were given if it settles the point; otherwise record the decision as open in your result the way your instructions say (for example a skipped item with needs_owner and the options), and finish the rest of your task.`, counted once per permission status, at most 3 per wait; any other pending permission, or a fourth question, fails `agent stopped: permission <name|kind> was not granted` (the agent is then archived, FLOW-25).
- Acceptance: FDC: two questions then idle -> 2 denials with the exact text, success; four questions -> failure on the fourth; an `Edit` permission -> immediate failure naming it.
- Source: RUN-32, WFL-26, WFL-52(f), INV-14.
- Scope: v1

#### PCLI-15 Target resolution restricted to own pools
- Requirement: `resolveTargets(refs)` searches the caller's live (non-archived, parent-labelled) subagents to completion, then the leader's (`PASEO_HARNESS_LEADER`, when it differs); a ref matches by exact id, id prefix of at least 6 characters (id matches win over title matches within a pool) or exact title; more than one match -> `'<ref>' matches <n> agents; use the id`; no match -> `no live subagent named or id '<ref>'`; no refs -> `name at least one agent (title, id or unique id prefix)`. Spec decision (SYNTHESIS M4): the unfiltered 36-char uuid fallback is not carried; a full uuid outside both pools is "no live subagent".
- Acceptance: FDC: 5-char prefix does not match; 6-char unique prefix matches; duplicate title -> ambiguity error; a teammate (leader set) reaches the leader's other child; the full uuid of an archived or foreign agent -> no match.
- Source: RUN-30, INV-17, INV-10.
- Scope: v1

#### PCLI-16 Resumed session agents: model readback, refusal, forgotten agent
- Requirement: before sending to an existing (session or adopted) agent with a requested model, the client updates the agent's model and reads it back, failing when the read-back model differs; it refuses to send when the agent has an active turn or its provider differs from the resolved worker provider; an agent the daemon reports not found is replaced by a fresh agent created with the full prompt (role, includes, notes) and a warning is returned for the log, never a null turn.
- Acceptance: FDC: resume with a different model -> update then read-back call precede the send; FDC read-back returns the old model -> failure `model readback <want> != <got>`; active turn -> refusal; `not found` -> one new create call whose prompt contains the role block, plus the warning.
- Source: HIS-17, HIS-16, INV-22.
- Scope: v1

### v1 Requirements: M5 ph (PHCL)

#### PHCL-01 Single entry and command surface
- Requirement: `ph` is one entry `.agents/harness/ph.mjs` that imports only from `.agents/harness/` (never a kit checkout or a path read from a manifest); no command, `help` or `--help` prints the usage and the public command list (internal commands such as the compact watcher hidden) and exits 0; an unknown command prints the same and exits 1; a usage error prints `usage error: <first line, <=300 chars>` exit 1; any other thrown error prints `failed: <msg>` exit 1; the daemon client is closed in `finally`.
- Acceptance: subprocess tests: no args -> exit 0 and the list lacks the internal watcher name; `ph bogus` -> exit 1; a project copy moved to another path with no kit present runs `ph help` and `ph config`; grep: no manifest `kit`-path lookup in runtime code.
- Source: RUN-34, RUN-52, INV-09, D-04, S-02.
- Scope: v1

#### PHCL-02 Argument parsing
- Requirement: options only in `--key value` form (`bool` options take no value); a string option consumes the next token even if it starts with `--`; an unknown option -> usage error `unknown option --<key>`; a string option without value -> `--<key> needs a value`; other tokens are positional.
- Acceptance: `ph send --prompt "--x" a` passes the text `--x`; `ph team --bogus` -> exit 1 `unknown option --bogus`; `ph spawn --name` -> `--name needs a value`.
- Source: RUN-35.
- Scope: v1

#### PHCL-03 Prompt input
- Requirement: commands that take a prompt require exactly one of `--prompt T` / `--prompt-file F` (`use --prompt or --prompt-file, not both`; `--prompt or --prompt-file is required`); the file resolves against the root and one leading BOM is stripped.
- Acceptance: both flags -> exit 1; neither -> exit 1; a BOM-prefixed file reaches FDC without the BOM.
- Source: RUN-36.
- Scope: v1

#### PHCL-04 ph doctor
- Requirement: prints one `ok|problem|note <text>` line per check and continues past every problem; exit 2 if any `problem`, else 0. Checks in order: Node gate (PHCL-34); `PASEO_AGENT_ID` set; config validity (an invalid overlay, also unparsable JSON, gives one `problem` and the remaining checks run with kit defaults, M3); Paseo CLI found and daemon reachable as `paseo cli <v> at <dir> (tested with <TESTED_PASEO_CLI>); daemon reachable`, `note` when the versions differ; caller known to the daemon; per tier (skipped when the daemon is unreachable) `tier <name> -> <provider/model> thinking <clamped|default>[ features k=v][ (model not offered by the provider)]`, `problem` for a model not offered; `default_tier <t> -> <id>` (allowlist-gated, `problem` when outside `allowed_models`); overlay path or `none (kit defaults apply)`; harness-files mod lines (copied/missing, Claude Code version vs minimum, owner selection, eligibility for worker launch); provider policy lines from M2 (worker denies incl. `SendMessage` and env; main denies `Agent`, `Workflow` only, never requiring `SendMessage` on a main provider); adapter presence (`adapter`/`gsd` sections and every file they name exist); agent types found in `.agents/agents/`; a `note` when free RAM is below `max_subagents` x 350 MB; a final `note` that tools loaded into a running session are not verified. It never probes a model and never starts a daemon.
- Acceptance: FDC daemon down -> `problem paseo: ...`, tier lines absent, overlay/defaults lines present, exit 2; overlay with broken JSON -> one `problem`, later lines printed, exit 2; FDC catalogue missing a tier model -> that tier's `problem`; a main provider lacking `SendMessage` in its denies produces no line about it; low-RAM stub -> the `note`.
- Source: RUN-37, RUN-07, RUN-14, RUN-15, RUN-16, RUN-61, D-06, D-17, D-20, W-01, INV-06.
- Scope: v1

#### PHCL-05 ph spawn
- Requirement: `ph spawn --name N (--prompt T | --prompt-file F) [--count K] [--type T] [--role R] [--model M] [--effort E] [--read-only] [--cwd D] [--ws D] [--worktree]` loads config, connects, requires a caller, checks capacity (PHCL-23, PHCL-24) and names (PHCL-25) for all K agents before starting any, then starts them in parallel (kind `team`); `--count K` (positive integer) names them `N-1..N-K`; prints `<full agent id> <name>` per agent, `failed spawn <name>: <err>` per failure, then the wait hint (PHCL-07); returns without waiting for turns; exit 2 if any failed.
- Acceptance: FDC: `--count 3 --name x` -> lines for `x-1..x-3` then a `next:` line; a duplicate live name -> refused with zero creates; one create failing -> its `failed spawn` line, the others' lines, exit 2.
- Source: RUN-38.
- Scope: v1

#### PHCL-06 Directory as a prompt instruction
- Requirement: `--cwd D` resolves against the root; when the directory differs from the root the prompt carries `Your working directory for this task is <dir>: run shell commands there and resolve relative paths against it.` and the directory is also passed as `cwd` to the daemon; with `--worktree` the worktree note (PHCL-31) replaces it.
- Acceptance: FDC: `--cwd sub` -> the note with the absolute path in the prompt and `cwd` in the create call. MC-02: a probe agent on the installed Paseo reports its working directory; if Paseo honours `cwd`, record it for a later removal of the note (R-03).
- Source: RUN-39, INV-16, R-03.
- Scope: v1

#### PHCL-07 Wait hint after non-blocking commands
- Requirement: `spawn`, `send` and `fanout` without `--collect` end with ``next: wait with Monitor running `<ph> watch <names>` (one event per idle agent, exits when all are idle); do not poll with sleep/grep loops`` (names quoted when they contain characters outside `[\w.-]`), printed only when at least one agent started or was sent to; `<ph>` is rendered by the same single function that renders the teammate note's ph command (S-20).
- Acceptance: the last stdout line of a successful spawn starts with `next: wait with Monitor`; a name with a space is quoted; all creates failing -> no hint; grep finds one ph-command renderer.
- Source: RUN-40, HIS-13, INV-18, S-20.
- Scope: v1

#### PHCL-08 Fanout file format
- Requirement: a fanout file is an optional preamble (prepended with a blank line to every prompt) then blocks opened by `=== <name> [key=value ...]`; trailing `^[a-z-]+=` words are peeled as options while more than one word remains; options `type, role, model, effort, read-only` (only `read-only=true` enables it); unknown option -> `block '<name>': unknown option <k>=`; no blocks -> `<file> has no '=== <name>' blocks`; block bodies trimmed.
- Acceptance: unit `parseFanout` on a two-block fixture returns `{type:'reviewer', model:'pro'}` and `{type:'reviewer'}` and the preamble in both prompts; `=== a bogus=1` -> the error.
- Source: RUN-41.
- Scope: v1

#### PHCL-09 ph fanout without --collect
- Requirement: `ph fanout --file F [--type] [--role] [--model] [--effort] [--read-only] [--cwd] [--ws]` (block options override command options) validates before starting: unique block names, output-safe names (runs outside `[\w.-]` -> `_`) distinct case-insensitively, names <= 60, names free among live subagents, capacity for all blocks; then starts all (kind `team`), prints `<id> <name>` per agent and the wait hint, and returns at once; exit 2 on any failure. Fanout has no `--worktree`.
- Acceptance: FDC: blocks `A` and `a` -> refused before any create; 21 blocks with `max_subagents` 20 -> refused, zero creates.
- Source: RUN-42.
- Scope: v1

#### PHCL-10 ph fanout --collect
- Requirement: with `--collect DIR [--keep]` agents run as kind `oneshot` under a semaphore of the free running slots, each admission also needing a free live slot (PHCL-24; a block that finds none after the running blocks finished fails `failed <name>: live agent cap reached (<l> of <m>)`) (refused with `<n> subagents running, max_subagents <m>: no free slot; wait or archive` when none); first line `waiting for <n> agent(s): this command returns when every reply is collected; run it in the foreground and do not poll its output`; per block: `<id> <name>`, wait `wait_timeout_s`, write `DIR/<safe>.md` (final reply + newline) and `DIR/<safe>.json` (the `result --json` object) before archiving, print `collected <name> -> <file>.md`; errors `failed <name>: <err>`; every started agent archived in `finally` unless `--keep` (`failed archive <name>: <err>`); exit 2 if any block failed.
- Acceptance: FDC with `max_subagents` 1 and 2 blocks: at most one agent running at any time, both `.md` and `.json` written, the result read precedes the archive call, both archived; an erroring block is still archived.
- Source: RUN-42, INV-15.
- Scope: v1

#### PHCL-11 ph send
- Requirement: `ph send (--prompt T | --prompt-file F) [--now] NAME|ID...` size-checks before connecting; per target in parallel: a running agent is awaited until its turn ends (`wait_timeout_s`; with `--now` the turn is cancelled first and awaited up to 60 s), then the message is delivered, then the agent is polled every 500 ms up to 15 s until it reports `running`; prints `sent <title>` (also when that poll times out) or `failed send <title>: <err>`, then the wait hint; exit 2 on any failure. The `ph` skill tells orchestrators to batch follow-ups and send when idle.
- Acceptance: FDC: send to a running agent -> the send call comes after the turn end; `--now` -> cancel precedes the send; oversize prompt -> exit 1 and zero FDC calls; skill text lint finds the batch-follow-ups rule.
- Source: RUN-43, HIS-22, D-38, INV-55.
- Scope: v1

#### PHCL-12 ph watch
- Requirement: `ph watch NAME|ID...` waits per agent in parallel (`wait_timeout_s`); on idle prints `idle <title> <id8> out_tokens=<n|?> context_tokens=<n|?> duration_s=<s|?>` (last-turn output, context used, `updatedAt - lastUserMessageAt`); otherwise `failed <title> <id8>: <error or status>`; finally `watch done: <k> idle, <m> failed`; exit 2 if any failed; it subscribes no usage tracker.
- Acceptance: FDC two agents going idle -> two `idle` lines then `watch done: 2 idle, 0 failed`; FDC spy: no tracker subscription.
- Source: RUN-44.
- Scope: v1

#### PHCL-13 ph result
- Requirement: `ph result [--json] NAME|ID...`: text mode prints the final reply (`## <title>` header per agent when several); `--json` prints one JSON line per agent `{id, name, status, model, final, usage, tokens, costUsd, reportedCostUsd, durationS, lastTurnS, skills}` where `tokens` is `{turns,input,cachedInput,output}` only when this process tracked the agent from creation, else `null`; `skills` lists Skill tool calls found in the last 1000 timeline entries.
- Acceptance: FDC: an agent created by another process -> `tokens: null`; one created in-process (fanout `--collect`) -> numeric tokens; the JSON has every listed key.
- Source: RUN-45, D-37.
- Scope: v1

#### PHCL-14 List-price cost
- Requirement: `costUsd` comes from the project data file `.agents/model-prices.json` (USD per 1M tokens per model key = id without `provider/` prefix and `[...]` suffix: `input, cachedInput, cacheWrite, output`, optional `longContext {thresholdTokens, input, output}`); long-context rates apply when the largest context used exceeded the threshold, the cached rate scales with the long-context factor, cache writes are charged as input, results rounded to 4 decimals; unknown model, missing input/output price or missing file -> `costUsd: null`; the daemon's estimate is reported only as `reportedCostUsd`. The kit ships no price data (project data, D-110).
- Acceptance: unit: fixture prices input 2 / output 10 per 1M, usage 1e6 input + 1e6 output, small context -> 12; key derivation strips `circle-agent/` and `[1m]`; no file -> null; `ship/` holds no `model-prices.json`.
- Source: RUN-66, HIS-18, D-23.
- Scope: v1

#### PHCL-15 ph team
- Requirement: `ph team` requires a caller and prints for each live subagent `<id8> <status> <context%|?%> <provider>/<model> <title>`; prints `no live subagents` when there are none; exit 0.
- Acceptance: FDC two agents -> two lines in that column order; none -> `no live subagents`.
- Source: RUN-46.
- Scope: v1

#### PHCL-16 ph context
- Requirement: `ph context [--self] [--rotate-pct N] [NAME|ID...]` requires a caller; prints `<id8> <pct padded to 4>% <used>/<max> <status> <title>` (`  n/a` when unknown) sorted by use descending (unknown last), suffix `  ROTATE` at or above N; N defaults to `context_guard.start_pct` of the effective config (kit default 60, D-48; a project overlay value applies), the one context threshold that the swarm map's `rotatePct` also takes (PANL-55); there is no separate rotate key or constant; a non-numeric or out-of-range N is a usage error; `--self` reports the caller only; `no live subagents` when empty.
- Acceptance: shared fixture defaults with `start_pct` 60: agents at 59 %, 60 %, 61 % -> `ROTATE` on 60 and 61 only; overlay `context_guard.start_pct: 45` -> an agent at 50 % shows `ROTATE`; `--rotate-pct abc` -> exit 1; grep finds no rotate default constant.
- Source: RUN-47, D-97, D-48.
- Scope: v1

#### PHCL-17 compact-self arming, one watcher per agent
- Requirement: `ph compact-self [--focus TEXT] [--resume TEXT] [--agent ID]` targets `--agent` else the caller (`PASEO_AGENT_ID is not set: pass --agent or run inside a Paseo agent`), verifies the agent exists, takes the resume text from `--resume` else config `compact_resume` (no second built-in text), takes an exclusive lock `<tmp>/ph-compact-<id8>.lock` holding the watcher pid (a lock whose pid is dead is replaced; a live one refuses with `compact already armed for <id8> (watcher pid <p>)`, exit 1), spawns a detached hidden watcher (stdout/stderr to `<tmp>/ph-compact-<id8>.log`) and returns at once with `compact armed for <id8> (context <pct>%|n/a); it starts when the turn ends and the resume message follows when it is done (log <path>). End your turn now`; the `ph` skill tells the caller to stop Monitors/background commands first and end its turn. Native autocompact is never touched.
- Acceptance: arming twice for one FDC agent -> second call exit 1 with the refusal, one watcher process; a lock file with a dead pid -> arming succeeds; arming returns within 2 s and the log file exists; grep: no autocompact setting written.
- Source: RUN-48, HIS-12, W-14, D-36, INV-24.
- Scope: v1

#### PHCL-18 compact-self watcher
- Requirement: the watcher waits for the target to go idle (`wait_timeout_s`; failure -> sends `compact-self: waiting for your turn to end failed, so /compact was NOT sent...`, exit 2), reads used tokens (`before`), sends `/compact[ <focus>]` once, polls every 3 s up to 15 min; success only when the agent is not running and used tokens < 0.5 x `before` -> logs `compaction done: used <before> -> <after>` and sends the resume text; otherwise (no drop, timeout, `before` null or 0) sends `compact-self: compaction NOT confirmed (used tokens <b> -> <a>); it may have been cancelled by an incoming notification. Your context is probably not compacted. Decide yourself whether and when to call compact-self again.` and exits 2; never retries; every stage logs an `HH:MM:SS` line; the lock is released on every exit path.
- Acceptance: FDC + FCLOCK: 400k -> 20k after `/compact` -> one resume message, lock gone; 400k -> 400k -> the NOT-confirmed message, exactly one `/compact` sent, lock gone.
- Source: RUN-49, HIS-12, INV-24.
- Scope: v1

#### PHCL-19 ph stop
- Requirement: `ph stop NAME|ID...` cancels each target's running turn, keeping agent and context; prints `stopped <title>` or `failed stop <title>: <err>`; exit 2 on failure.
- Acceptance: FDC running agent -> one cancel call and `stopped <title>`.
- Source: RUN-50.
- Scope: v1

#### PHCL-20 ph archive
- Requirement: `ph archive NAME|ID... | --idle [--name-prefix P] | --name-prefix P | --run RUNID [--runs-dir D]` requires a caller; `--idle` selects own non-running subagents, `--name-prefix` own subagents whose title starts with P; nothing selected by flag or name -> usage error `name agents, or use --idle / --name-prefix`. `--run`: reads `<runs-dir>/<id>/run.json` (default `_workspace/_runs`; BOM stripped; missing -> `no run <id> (<path>)` exit 1); when `pid` is alive (EPERM counts as alive) and status is `running` it kills the runner (`stopped runner pid <p>` / `could not stop runner pid <p>: <err>`, archiving continues); archives every own agent labelled `harness.run=<id>`; rewrites `run.json` `status: stopped, endedAt` only when it was `running`. Prints `archived <ok> of <n> agents` (+ `failed archive <title>: <err>`); exit 0 only when all succeeded (0 of 0 included).
- Acceptance: FDC: `--idle` skips a running agent; `--run` on a missing run -> exit 1; a run with a live fake runner pid and two labelled agents -> runner killed, both archived, `status: stopped`; a `done` run keeps `done`; `--runs-dir` alt dir is honoured.
- Source: RUN-51, WFL-43.
- Scope: v1

#### PHCL-21 Model resolution and allowed models
- Requirement: `resolveModel(cfg, spec, effort)`: an alias that is not also a tier name is replaced by its target; a tier gives its `provider` (`provider/model`), `thinking`, `features`; a spec containing `/` is an explicit id; otherwise usage error `unknown model tier '<x>' (tiers: <list>; or provider/model)`; `effort` must be one of `off|low|medium|high|xhigh|max` (`unknown effort '<e>'`) and overrides the tier's thinking; the provider part is mapped through `agent_providers` (`circle` -> `circle-agent`); when `allowed_models` is non-empty the id must match an entry on a normalized key (provider mapping applied to both sides, `[...]` suffix stripped), else `model <id> is not in config allowed_models`. The kit defaults ship no upstream aliases (D-16).
- Acceptance: unit: explicit `circle/x[1m]` -> `circle-agent/x[1m]`; allowlist `circle/gpt-a[1m]` accepts explicit `circle-agent/gpt-a[1m]` and a tier pointing at `circle/gpt-a`, rejects `circle/other`; an unknown word lists the tiers; shipped defaults have empty `tier_aliases`.
- Source: RUN-13, RUN-14, D-16.
- Scope: v1

#### PHCL-22 Model precedence and roles
- Requirement: one function `selectModel({explicit, role, definition})` decides model and effort for every agent `ph` or the workflow runner creates; the role input is `--role R` (spawn/fanout), fanout `role=` and `agent({role})` (FLOW-04), never inferred from the agent type; model and effort are resolved independently, each by the precedence per-run argument (`--model`/`--effort`, fanout block, `agent({model, effort})`) > adapter role entry (`gsd.roles[<role>].model` / `.effort`) > agent definition `model:` (not `inherit`; effort: the tier's thinking) > `default_tier`; a valid role is a role name of ADPT-11 or a key present in `gsd.roles`; a valid role with no entry (or an entry without model or effort) falls back to the next layer (ADPT-11); an invalid role name is a usage error (`ph`) or a configuration throw (`agent()`) naming the valid roles; the kit defaults hold no concrete model id outside the tier table.
- Acceptance: unit matrix over the four layers for model and for effort separately; overlay `gsd.roles.outline = {model:'pro'}`, `gsd.roles.planner = {model:'standard', effort:'high'}`: two workflow calls with the same `agentType` and roles `outline`/`planner` get pro and standard@high; a project replacement agent type with role `planner` still gets standard@high; role `checker` with no entry falls back to the definition's `model:`; an explicit `model` overrides the role; `--role nosuch` -> exit 1.
- Source: D-16, HIS-74 (via D-16), RUN-65 (adapter pattern), R-10, ADPT-11, GSDF-18.
- Scope: v1

#### PHCL-23 Running-agent cap
- Requirement: before creating N agents, `ph` counts the caller's live subagents whose status is `running`; running + N > `max_subagents` (shipped 20) -> usage error `<r> subagents running + <n> new > max_subagents <m> (harness config); wait, archive, or use a workflow (it queues)`, and nothing starts.
- Acceptance: FDC 19 running + `spawn --count 2` -> refused, zero creates; 18 running + 2 -> both start.
- Source: RUN-11, RUN-29, D-20, INV-12.
- Scope: v1

#### PHCL-24 Live-agent cap
- Requirement: a second cap `max_live_subagents` (shipped 40, validated >= `max_subagents`) bounds the caller's live (running + idle, non-archived) subagents; live + N > cap -> usage error `<l> live subagents + <n> new > max_live_subagents <m>; archive idle agents (ph archive --idle)`, nothing starts. The cap counts allocations of new agents only: sending to an existing agent (session reuse, `ph send`) never needs a live slot. `fanout --collect` admits a block only when both a running and a live slot are free (agents kept with `--keep` stay counted); when no live slot is free at the start it refuses like the no-free-slot case (`<l> live subagents, max_live_subagents <m>: no free slot; archive idle agents`). Workflow creation follows FLOW-14 (bounded wait, then a named null).
- Acceptance: FDC 39 idle + `spawn` 2 -> refused; 40 live + `ph send` to one of them -> delivered; `fanout --collect --keep` with 39 live and 3 blocks -> one block runs, the other two report `failed <name>: live agent cap reached ...`; config with `max_live_subagents` < `max_subagents` fails validation.
- Source: D-20, RUN-29, INV-12.
- Scope: v1

#### PHCL-25 Agent names
- Requirement: spawn/fanout names longer than 60 characters are refused before any agent starts (`names longer than 60 characters: <names>`); a name equal to the title of any live subagent of the caller is refused (`a live subagent already has the name <names> (names must be unique)`).
- Acceptance: FDC: a 61-char name -> refused, zero creates; a live agent titled `rev` + `spawn --name rev` -> refused.
- Source: RUN-29, INV-17.
- Scope: v1

#### PHCL-26 Agent definitions
- Requirement: `--type T` loads `.agents/agents/<T>.md` only (no `.claude/agents` fallback); a type containing a path separator, `..` or characters outside `[A-Za-z0-9._-]` is a usage error; a missing file -> `agent type '<T>' not found: <path>`; front matter is parsed by a documented YAML subset (scalars with quotes, lists by `- item` or flow `[a, b]`, `#` comments only at line start or after whitespace outside quotes) with fields `name, description, tools` (advisory), `model` (tier or `provider/model`; `inherit`/empty = none), `include` (repo-relative files, resolved inside the root); a missing or escaping include -> `agent type '<T>' includes a missing file: <rel>`.
- Acceptance: unit: a definition with an `include:` list and a comment line loads body and includes without their front matter; `--type ../x` -> usage error; a quoted value containing ` # ` keeps it; an include `../../etc` -> error.
- Source: RUN-19, W-02, D-19, RUN concern "front matter parser / traversal".
- Scope: v1

#### PHCL-27 Read-only roles
- Requirement: a definition is read-only when it has a `tools` value containing none of `Edit, Write, MultiEdit, NotebookEdit, mcp__harness-files__edit_multiple_files, mcp__harness-files__write_multiple_files` (token match); read-only definitions, `--read-only`, fanout `read-only=true` and `agent({readOnly:true})` add `Read-only role: do not create, edit, move or delete files, except output files this prompt names.`; when the Paseo client accepts per-agent disallowed tools (recorded by MC-03 per Paseo version), read-only agents are also created with those six tools denied (`disallowedTools`, PCLI-07); otherwise the note stays advisory and the `ph` skill points to `ph freeze --check` for inputs a reviewer must not change. Report path under enforcement: a read-only agent delivers its report in its final reply (or structured result) and the caller writes it (`fanout --collect` writes `DIR/<name>.md`; workflow scripts and GSD flows write the returned text); a role that must itself write named artifacts is not read-only and uses an editing role scoped to those files (WFL-51). The runtime note text is unchanged (D-35). `tools:` grants nothing and is never shown in a prompt.
- Acceptance: unit: `tools: Read, Grep` -> note present; `tools: Read, mcp__harness-files__edit_multiple_files` -> absent; FDC with the per-agent-deny capability flag on -> the create call carries the six denies, off -> none; FDC `fanout --collect --read-only` with enforcement on: the agent's reply is written to `DIR/<name>.md` while its scripted `Edit` of an input is refused. MC-03: create a read-only probe on the installed Paseo, confirm an `Edit` is refused and its reply still reaches the collect file, or record "advisory".
- Source: RUN-20, WFL-51, FIL-46, D-19, RUN-71.
- Scope: v1

#### PHCL-28 Prompt assembly
- Requirement: the first prompt is `[Your role (<type>), complete below:\n\n<body>]` + `[These files are already loaded in full below; do not open them and do not call the Skill tool for them.\n\n===== <rel> =====\n<text>...]` (only with a definition) + the trimmed task, joined by `\n\n---\n\n`, then `\n\n---\nRuntime notes:\n- <note>` lines in this order: (1) workflow agents `Your final message is the return value for the orchestrating script, not a message to a person: return only the data asked for.`, all others `Work silently: no narration, plans or commentary between tool calls (nobody reads them); only your final reply, in the format asked for.`; (2) teammate note for kind `team` (PHCL-30); (3) read-only note; (4) worktree note, else working-directory note; (5) first-prompt note + platform note (PHCL-29); (6) `Run <runId> #<n> (bookkeeping only; ignore).` for workflow agents. The definition path and its `tools:` list never appear; included files are never referred to as "read X first". The assembled text is size-checked (PCLI-05).
- Acceptance: golden-string tests for: no definition; definition with includes; team; read-only; worktree; workflow with run tag; a rendered typed prompt contains no `tools:` and no `.agents/agents/` path.
- Source: RUN-21, WFL-22, RUN-71, D-36.
- Scope: v1

#### PHCL-29 First-prompt and platform notes
- Requirement: note (5) = the kit-owned `first_prompt_note` (an overlay value is ignored, CONF-14) + the project's `project_prompt_note` (string, overlay, shipped `""`; empty adds nothing) + `platform_notes[process.platform]`, space-joined in that order, each appearing once. The kit base note states: batch reads/edits with the harness-files mod tools when enabled, else native Read/Edit/Write where owner restrictions permit; scripts that write files use UTF-8; never send messages to the main/leader session, report only in the final reply of the turn; output per response is capped, so write long documents in parts (each tool call under about 300 lines) and keep the final reply short. `platform_notes.win32`: never round-trip text files through PowerShell Get-Content/Set-Content (they re-encode non-ASCII text). No fsbatch/filesystem or other legacy tool names.
- Acceptance: integration through `loadConfig` and the real prompt assembly: overlay `project_prompt_note: "P"` and `first_prompt_note: "X"` -> the rendered prompt has the kit note exactly once, then `P`, and no `X`; on win32 the platform note follows; grep of shipped defaults finds no `fsbatch`/`mcp__filesystem`; the base note contains the leader and 300-line clauses.
- Source: RUN-23, INV-45, INV-52, S-17, D-35, CONF-14.
- Scope: v1

#### PHCL-30 Teammate note
- Requirement: agents of kind `team` (spawn, fanout without `--collect`) get `You are the teammate "<name>" of a Paseo agent team led by agent <leader id8>. The leader sends you follow-up messages and you keep your context between them; end every turn with your reply to the leader. Shared task list: \`<PH> task list --ws <ws>\` and \`<PH> task update --ws <ws> <id> --status <status>\`; message a teammate: \`<PH> send --prompt "..." <teammate>\`.` where `<PH>` = `node "<absolute ph.mjs path, forward slashes>"` and `<ws>` = the `--ws` dir or the literal `<workspace>`; no project root in the note.
- Acceptance: FDC spawn prompt contains the name, the leader id8 and a ph path that runs (`node <path> help` exit 0 in the test).
- Source: RUN-24, D-36.
- Scope: v1

#### PHCL-31 Worktree creation
- Requirement: `ph spawn --worktree` and workflow `isolation:'worktree'` create `<repo top>/<worktree_dir>/<name>` (config `worktree_dir`, shipped `.claude/worktrees`) on branch `harness/<name>` from HEAD, with `<name>` sanitized to `[A-Za-z0-9._-]` (spawn: `<agent name>-<stamp>`, workflow: `<runId>-<n>`); not in a git repo -> `isolation 'worktree' needs a git repository`; when agent creation fails the new worktree and branch are removed; the agent gets `You work in the git worktree <path> (branch <branch>): edit files only there, run git and shell commands with that directory as their working directory, and use absolute paths.`; worktrees are kept after the run for the orchestrator to merge.
- Acceptance: temp git repo (path with spaces): spawn `--worktree --name "a b"` -> directory and branch with a sanitized name; FDC create failure -> no worktree or branch left; outside git -> the error, zero creates.
- Source: RUN-55, D-26.
- Scope: v1

#### PHCL-32 ph worktrees list and prune
- Requirement: `ph worktrees [--prune] [--runs-dir D]` lists git worktrees under `<top>/<worktree_dir>` on `harness/*` branches (case-insensitive path compare on win32) as `<state padded 22> <branch> <path> (<owner>)`; owner: `wf_<stamp>_<hex>-<n>` = run (in use only when its `run.json` is `running` with a live pid), `<name>-<stamp>` = spawned agent (in use when a non-archived agent labelled `harness.name=<name>` exists; daemon unreachable -> `note daemon not reachable (...): worktrees of spawned agents are kept`), else unknown; states `directory missing`, `owner unknown`, `in use`, `uncommitted changes`, `<n> commit(s) not in HEAD`, `merged and clean`; `--prune` removes only `merged and clean` and `directory missing` entries: `git worktree remove` for an existing directory; for a missing directory only that entry's registration is removed by a supported targeted mechanism, and the repo-wide `git worktree prune` is never run; when no targeted removal is possible the entry is kept and reported (`kept <name>: registration of a missing directory cannot be removed without touching others`); then `git branch -d` (`removed <name> and branch <b>` / `removed <name>; branch <b> kept (...)`); summary `worktrees: <n> listed, <k> removed`; not a git repo -> exit 1; none -> `no harness worktrees`; a failed removal -> exit 2.
- Acceptance: temp repo with a merged clean, a dirty, an ahead, and a missing-directory worktree plus an unrelated stale worktree record: `--prune` removes the merged clean one, removes the missing one or keeps it with the `kept` line, and touches nothing else; the unrelated stale record stays in `git worktree list --porcelain`; a command spy shows no argument-less `git worktree prune`.
- Source: RUN-56, HIS-24, WFL-29, D-26.
- Scope: v1

#### PHCL-33 Refuse a caller outside the project root
- Requirement: agent-creating commands (`spawn`, `fanout`, `workflow`) refuse when the caller agent's working directory reported by the daemon is not inside the project root (case-insensitive on win32), with `caller <id8> works in <dir>, outside the project root <root>; run ph from an agent of this project`, exit 1, nothing created.
- Acceptance: FDC caller with cwd `C:/other` -> exit 1 and zero creates; cwd `<root>/sub` -> allowed.
- Source: HIS-28, D-26, INV-10.
- Scope: v1

#### PHCL-34 Platform gates and Claude CLI lookup
- Requirement: one shared platform module: Node gate = major and the capabilities the code really uses (shipped check: Node >= 20.17 with `path.matchesGlob`); Claude CLI = `$CLAUDE_CLI`, else `~/.local/bin/claude(.exe)` when present, else `claude` on PATH; `.js/.cjs/.mjs` CLIs run through the current node, on win32 any non-`.exe/.com` through cmd.exe with one quoted command line; `claudeVersion()` runs `--version` (10 s timeout) -> trimmed stdout or null; `versionAtLeast(text, min)` -> true/false, null without `x.y.z`. M1 and M2 use the same module.
- Acceptance: unit: `versionAtLeast('2.1.296 (Claude Code)','2.1.296')` true, `'2.1.295'` false, `'none'` null; win32 test with a fake `claude.cmd` in a path with spaces runs through cmd.exe and returns its version.
- Source: RUN-60, INV-52.
- Scope: v1

#### PHCL-35 ph task
- Requirement: `ph task add|update|list|get --ws D` keeps `<ws>/tasks.json` `{tasks:[{id,title,assignee,depends_on,status,notes,updated}]}` (BOM stripped on read, atomic write, written only when changed) under an exclusive lock `tasks.json.lock` (wait up to 10 s in 100 ms steps, steal a lock older than 30 s, else `task list locked: <lock>`); statuses `pending|in_progress|completed|blocked`; `add --title T [--assignee] [--depends-on 1,2] [--notes] [--status]` -> `task <id> added` (id = max + 1; unknown dependency -> error); `update ID [...]` -> `task <id> <status>` (`--depends-on` replaces, `""` clears; self, unknown or cyclic dependency -> `invalid dependency ...`; unknown task -> `no task <id>`); `list [--assignee] [--status]` -> `<id> <status> <assignee|-> <title>[ after 1,2][ READY]` (READY = pending with all dependencies completed); `get ID` -> task JSON. It is ephemeral team coordination in the workspace dir, never planning state.
- Acceptance: three tasks with dependencies -> only the ready one marked READY; a 1->2->1 cycle -> `invalid dependency`; two processes updating in parallel 20 times lose no write.
- Source: RUN-53, D-18.
- Scope: v1

#### PHCL-36 ph freeze
- Requirement: `ph freeze --ws D --phase P` writes `D/freeze_P.sha256` with `<sha256>  <file>` lines for every regular file `P_*` directly in D, sorted (`no P_* files in D` when none) and prints `frozen P: <n> files -> <record>`; `--check` recomputes and prints `freeze ok P: <n> files` exit 0, or `freeze CHANGED P: modified f; missing f; new f` exit 2; a missing record -> `no freeze record <path>` exit 1.
- Acceptance: freeze, edit one file, add one -> `--check` exit 2 naming `modified` and `new`; the record verifies with `sha256sum -c` where available.
- Source: RUN-54, D-21, WFL-51.
- Scope: v1

### v1 Requirements: M6 workflow (FLOW)

#### FLOW-01 Script format
- Requirement: a script's first statement (after one stripped BOM, whitespace and comments) is `export const meta = {...}`; the literal is rejected when, after stripping comments and string contents, it contains `(`, `)`, a backtick or `...` ("pure literal"); it is evaluated in an empty context (1000 ms) and JSON-cloned; `meta.name` and `meta.description` are required non-empty strings, `meta.phases` optional array of `{title}`; the meta statement is blanked keeping newlines and the body is wrapped so top-level `await`/`return` work and thrown errors report the file's own line numbers.
- Acceptance: unit `parseScript`: meta with a template string or a call -> "pure literal" error; a commented-out `export const meta` before code -> rejected (not first statement); missing `description` -> error; an error thrown on body line 12 reports line 12; a BOM-prefixed script parses.
- Source: WFL-01, WFL-52(a).
- Scope: v1

#### FLOW-02 Determinism guards
- Requirement: inside scripts `Math.random()`, `Date()`, `new Date()` without arguments and `Date.now()` throw with a message telling the author to pass times through `args` and vary prompts by index (`new Date(x)`, `Date.UTC`, `Date.parse` work); the script context offers no ambient `require`, `import`, `process`, file or network API; host commands run only through `shell()` (FLOW-11), which intentionally executes them; these guards serve determinism and are not a security sandbox (FLOW-49); `console.log|info|warn|error` map to `log`, any other console method throws.
- Acceptance: each of the four calls fails the run with the message; `new Date(0)` works; `console.table` fails clearly; `require` is undefined.
- Source: WFL-02, WFL-52(b), D-87, INV-22.
- Scope: v1

#### FLOW-03 agent() returns a value, configuration errors throw
- Requirement: `agent(prompt, opts?)` resolves the reply string, the validated object (with `schema`) or `null` with a journaled reason, and never rejects for agent-side failures (runner exception -> `null` with `runner error: <msg>`; unknown `agentType`, missing include, model resolution error, worktree outside git -> `null` with that message); it throws for configuration errors (unknown option, invalid schema, `isolation` other than `'worktree'`, budget exhausted, agent cap reached); inside `parallel`/`pipeline` a throw becomes a `null` item with a logged warning.
- Acceptance: fake runner `{status:'null'}` -> `null` in the script; unknown option -> a direct `await agent()` fails the run, the same call inside `parallel` yields `null` and a `log warning:` line.
- Source: WFL-03, INV-21.
- Scope: v1

#### FLOW-04 agent() options
- Requirement: allowed options are exactly `label, phase, schema, agentType, role, model, effort, isolation, readOnly, cwd, keep, session`; `role` is the role input of PHCL-22; `label` defaults to `phase ?? current phase ?? "agent"`; `phase` defaults to the last global `phase()`; `model`/`effort` follow PHCL-22; `readOnly:true` adds the read-only note; `cwd` resolves against the root and is a prompt instruction plus the daemon `cwd`; `keep:true` leaves the agent unarchived; title = `<meta.name>:<label>`.
- Acceptance: `agent('x', {bogus:1})` throws `unknown option 'bogus'`; label defaults to the active phase title; FDC title equals `<name>:<label>` (cut at 60, PCLI-08).
- Source: WFL-04, W-03.
- Scope: v1

#### FLOW-05 pipeline()
- Requirement: `pipeline(items, ...stages)` runs every item through all stages independently (no barrier; stage gets `(previous, item, index)`); a throwing stage makes that item `null` (`log warning: pipeline item <i> -> null: <msg>`) and skips its later stages; a stage returning `null` passes `null` on; non-array -> TypeError; more than 4096 items -> error; results keep item order.
- Acceptance: with a fake runner, stage 2 of item A starts before stage 1 of item B ends; a throwing stage yields `null` for that item only.
- Source: WFL-05.
- Scope: v1

#### FLOW-06 parallel()
- Requirement: `parallel(thunks)` runs all thunks concurrently and waits for all; a throwing thunk resolves `null` (`log warning: parallel item <i> -> null: <msg>`); the call never rejects; non-array -> TypeError; more than 4096 items -> error.
- Acceptance: one of three thunks throws -> result `[a, null, c]`, no rejection.
- Source: WFL-06.
- Scope: v1

#### FLOW-07 phase() and log()
- Requirement: `phase(title)` sets the current phase and prints `phase <title>`; when `meta.phases` exists and no entry's `title` equals it, prints `log warning: phase "<t>" has no entry in meta.phases`; `log(m)` prints `log <m>`.
- Acceptance: unknown phase -> the warning line; `log('a')` -> `log a`.
- Source: WFL-07.
- Scope: v1

#### FLOW-08 args
- Requirement: the global `args` is the JSON of `--args` or `--args-file` (BOM stripped) verbatim, `undefined` when none; both flags -> usage error; a nested workflow gets the JSON-cloned args it was called with; a resumed run without args reuses the saved `args.json`.
- Acceptance: `--args '{"a":1}'` -> `args.a === 1`; `--resume R` alone sees R's args; both flags -> exit 1.
- Source: WFL-08.
- Scope: v1

#### FLOW-09 budget
- Requirement: `budget = {total, spent(), remaining()}`; `total` from `--budget` (`500000`, `500k`, `1.5m`; else usage error) or `null`; `remaining()` = `max(0, total - spent())` or `Infinity`; `spent()` = output tokens of the run's agents (charged when each call returns) + the orchestrator's own output tokens during the run; once `spent >= total` new `agent()` calls throw; agents already running may overshoot (documented in the `ph` skill).
- Acceptance: `--budget 5`, fake runner charging 10 tokens, 5 queued calls with concurrency 1 -> exactly one runner call; `--budget 2x` -> exit 1.
- Source: WFL-09, D-25, RUN-70(c).
- Scope: v1

#### FLOW-10 Nested workflow()
- Requirement: `workflow(nameOrRef, args?)` runs `.agents/workflows/<name>.js|.mjs` (only location) or `{scriptPath}` (relative to the root) inline and returns its JSON-cloned return value; the child shares semaphore, agent counter, journal, budget and cache, and has its own meta, phase and args; one level only (`workflow() nesting is one level only`); logs `log nested workflow <path>`; unknown name -> `no saved workflow '<name>' in .agents/workflows/`.
- Acceptance: a grandchild call throws the nesting error; a child's agents count in the parent's `started`; no `.claude/workflows` lookup (fs spy).
- Source: WFL-10.
- Scope: v1

#### FLOW-11 shell()
- Requirement: `shell(cmd, {cwd, input, timeoutS, tailChars})` accepts two forms: a string, run by the platform shell exactly as Node's `child_process` shell option does (`/bin/sh -c` on POSIX, `cmd.exe /d /s /c` on win32; quoting is that shell's), or an argv array (`[file, ...args]`), run without any shell (each element one argument; on win32 a `.cmd/.bat` target goes through cmd.exe with one quoted command line, PHCL-34) — the argv form is the path for adapter commands (ADPT-02); cwd resolves against the root, `input` goes to stdin, timeout defaults to `wait_timeout_s`, output tails default to 20000 chars; it resolves `{code, stdout, stderr, durationS}` and never rejects: code = the process exit code (a launched shell reporting command-not-found is its own nonzero code, e.g. 127 or 1); -1 only when the process could not be launched (error in `stderr`) or timed out (the whole process tree is killed, stderr ends with `[timed out after <N> s]`); every call logs `shell start #<n> <cmd first 80 chars>` and `shell done #<n> code=<c> <s>s` and is journaled (kind `shell`); results are never cached (a resumed run reruns it).
- Acceptance: `shell('exit 3')` -> code 3; string with spaces and metacharacters (`echo "a b" && echo c`) -> stdout `a b` and `c`; argv `['node','-e','process.exit(4)']` -> 4, argv element `a;b` arrives as one argument; `input:'x'` read by the child; a string naming a missing binary -> the shell's nonzero code; argv naming a missing file -> -1 with the launch error; `timeoutS:1` on a command that spawns a sleeping grandchild -> resolves within 2 s and the grandchild pid is gone; resume reruns the shell call; the journal has a `shell` record.
- Source: HIS-23, W-03, D-22, ADPT-02.
- Scope: v1

#### FLOW-12 Sessions
- Requirement: `agent({session: key})` creates one agent for the first call with that key and keeps it; later calls with the key send only their prompt to the same agent (per-call token accounting); a failed session call archives its agent and the next call starts a new one; run end (done, failed or stopped by the runner) archives every session agent unless `keep`; on resume a cached session call adopts its recorded agent so the next live call continues it (model readback and forgotten-agent rule: PCLI-16; ownership and attribution: FLOW-48); property compatibility and worktree reuse: FLOW-47; `session` is not part of the cache key.
- Acceptance: FDC: two calls with `session:'coder:a'` -> one create, two prompts; a fresh call without session -> new agent; resume after a cached first call -> the second call goes to the recorded agent id; run end -> archive call for the session agent.
- Source: HIS-16, W-03, D-22, GSP-43.
- Scope: v1

#### FLOW-13 Structured output with the kit's own validator
- Requirement: `schema` must be `{type:'object', properties:{...}}` with every `required` key in `properties` and only the keywords of the kit's subset (FLOW-46) (else throw); the kit's own validator (FLOW-46; no Paseo `getStructuredAgentResponse`, no dependency on Paseo internals) checks the final message parsed as JSON (unparsable JSON is a validation error and gets a retry); on mismatch the same agent is asked again with the errors up to `schema_retries` (shipped 2) extra times; then `null` with reason `<error>: <first 3 validation errors joined by "; ">`; an unprimed non-session agent also gets the same schema object as native `outputSchema` at creation (session agents never get a native schema, FLOW-47); every retry wrapper is size-checked.
- Acceptance: FDC reply missing a required key -> one retry prompt in the same agent naming the error; three bad replies with `schema_retries` 2 -> `null` with three errors in the journal reason; schema with `required:['x']` and no `x` property -> throw.
- Source: WFL-11, RUN-67, D-30.
- Scope: v1

#### FLOW-14 Admission: rolling pool, caps, budget
- Requirement: a counting semaphore of `max_subagents` (min 1) bounds active agents of the run including nested ones, queued FIFO and refilled as each call finishes (no batches); in addition each live call needs caller-wide running capacity: before a turn starts the host counts the caller's running subagents (teammates, other runs) plus this run's reserved calls, admits only while that total < `max_subagents`, holds the reservation until the call's tokens are charged, and re-counts on every own completion and at most every 5 s while calls wait (logging `log waiting for a free agent slot (<r> running of <m>)` once per wait); `max_agents_per_workflow` (shipped 1000) bounds started agents (`agent cap reached`); a call that needs a new agent (no reusable session agent) also needs a live slot (PHCL-24): it waits for one up to `wait_timeout_s`, but returns `null` at once when every live agent of the caller beyond the running ones is retained by this run (sessions, `keep`) and so cannot free, the reason being `live agent cap reached (<l> of <m>); end sessions or archive idle agents`; reuse of an existing session agent needs no live slot; budget and caps are checked before queueing and again after admission; a finished call's tokens are charged before its slot is released; cached hits skip budget, caps and semaphore.
- Acceptance: fake runner with 40 calls of unequal durations and cap 20: at every completion instant 20 are running until fewer than 20 remain; FDC with 19 running teammates and 5 queued calls: at most one call runs until a teammate goes idle, then a second starts; the budget recheck test of FLOW-09 passes; 10 cached calls produce zero runner calls and no semaphore waits; `max_live_subagents` 40 and 41 distinct session keys in sequence -> call 41 is `null` with the live-cap reason without waiting; a 42nd call reusing session 1 still runs.
- Source: WFL-12, HIS-89, INV-47, INV-12, D-20, RUN-11, RUN-29.
- Scope: v1

#### FLOW-15 Resume cache key
- Requirement: cache key = sha256 over JSON of `{prompt, schema, agentType, effort, isolation, readOnly, cwd, worktreeSeed}` (defined fields only) + sha256 of the resolved role text (definition body + included files) + the resolved `provider/model` and resolved effort (after PHCL-22, so a role-table change invalidates) + the effective read-only mode (the call's `readOnly` or the definition's `tools:`) + a digest of the prompt notes (kit, project and platform notes, and the fixed notes); the raw `model` spelling is not keyed, so `pro` and the `provider/model` it resolves to share an entry; `role` itself is not hashed separately; `label`, `phase`, `keep`, `session` are not in it; the n-th call with a key maps to the n-th earlier entry (occurrence counter assigned synchronously at call time); only `ok`/`cached` journal entries with a key are loaded; a hit returns the stored result, journals a `cached` entry (tokens 0, duration 0), prints `agent cached #<n> <label>`; unparsable journal lines are skipped.
- Acceptance: run, then resume with the same script: 100 % cached, zero runner calls; edit one prompt -> only that call runs; edit `.agents/agents/x.md` or the tier's provider in the overlay -> calls of that type rerun; edit that definition's `tools:` so its read-only mode changes -> that type's calls rerun; changing a prompt note -> the calls that carry it rerun; changing `gsd.roles.<role>.effort` reruns the calls with that role; adding a call with a new schema elsewhere in the script leaves the other calls cached; editing a skill file a prompt reads is not keyed (start a fresh run).
- Source: WFL-13, WFL-14, RUN-70(b), HIS-83, D-29, INV-22.
- Scope: v1

#### FLOW-16 Resume command
- Requirement: `--resume RUNID` requires `<runs-dir>/RUNID/journal.jsonl` (`cannot resume: <path> not found`); without `--script`/`--name` it reruns the saved `script.js`, without args the saved `args.json`; the new run records `parent: RUNID`; because every run creates an empty `journal.jsonl` at start, a run that never called `agent()` can be resumed.
- Acceptance: resume of a zero-agent run succeeds; resume of a missing id -> exit 1; the new `run.json.parent` equals RUNID.
- Source: WFL-13, WFL-52(d).
- Scope: v1

#### FLOW-17 Journal
- Requirement: `journal.jsonl` is append-only, one JSON line per event: a `start` record when a call passes admission (`{n, kind:'agent', key, occ, label, phase, status:'start'}`), then a finish record `{n, key, occ, label, phase, agentId, model, status: ok|null|cached, reason, result, tokens, usage{input,cachedInput,output,maxContext,costUsd,reportedCostUsd}, duration_s}`, plus `shell` records; `n` is allocated only for calls that start, so numbers have no gaps; calls that throw before running write nothing.
- Acceptance: a mixed run's journal has one start and one finish per started call; killing the runner with two calls in flight leaves their two `start` records; `n` values are 1..k with no gap after a budget throw.
- Source: WFL-15, WFL-52(c), HIS-18.
- Scope: v1

#### FLOW-18 Run directory and run.json
- Requirement: per run `<runs-dir>/<runId>/` (default `_workspace/_runs`) holds `script.js` (exact script), `args.json` (`null` when none), `run.json`, `journal.jsonl`, `log.txt`, `result.json`; `run.json` = `{runId, parent, script, status: running|done|failed|stopped, startedAt, endedAt, agents, budget, pid, name, description, error?}` written at start (status `running`) and rewritten at the end (done: `agents{started,ok,null,cached,tokens,costUsd}`; failed: `error`); `result.json` = the script's return value (`null` when undefined); every JSON write is atomic (temp + rename) with 2-space JSON and a trailing newline.
- Acceptance: a done run has all six files and `status: done` with counts; a failed script -> `status: failed`, `error` set, no `result.json`.
- Source: WFL-16, WFL-52.
- Scope: v1

#### FLOW-19 Run id
- Requirement: run ids are `wf_<yyyymmdd>-<hhmmss>_<4 hex>` (local time + 2 random bytes, generated by the host, never by the script); `--run-id` overrides.
- Acceptance: id matches `^wf_\d{8}-\d{6}_[0-9a-f]{4}$`; `--run-id wf_x` is used verbatim.
- Source: WFL-17.
- Scope: v1

#### FLOW-20 ph workflow command and exit codes
- Requirement: `ph workflow [--script F | --name N] [--args JSON | --args-file F] [--resume RUNID] [--budget N] [--runs-dir D] [--detach] [--run-id ID]`; one of `--script`/`--name`/`--resume` required, `--script` with `--name` is a usage error; config load, caller check (PCLI-06), caller-root check (PHCL-33), argument and budget parsing and `parseScript` all run before the run directory exists and fail with exit 1; afterwards a missing daemon/CLI or a script error rewrites `run.json` to `failed` and exits 2; success prints `workflow done <runId>: <runDir>/result.json (ok k, null m, cached c, tokens t, cost $x)` and exits 0.
- Acceptance: no flags -> exit 1, no run dir; invalid overlay -> exit 1, no run dir; script throwing -> exit 2 with `status: failed`; FDC success -> exit 0 and the final line.
- Source: WFL-18, RUN-58, INV-10, P4.
- Scope: v1

#### FLOW-21 Detached runs
- Requirement: `--detach` performs every exit-1 check of FLOW-20 in the parent, then creates the run directory with `script.js`, `args.json` and `run.json` (status `running`, pid of the child), spawns a detached hidden child (`--run-id <id>`, stdout/stderr appended to `log.txt`, `PASEO_HARNESS_LOG_IS_STDOUT=1` so lines are not written twice), prints `workflow started <runId>: <log.txt>` and ``next: wait with Monitor running `<ph> watch-run <runId>[ --runs-dir <D>]`; do not poll with sleep/grep loops`` (`--runs-dir` included whenever the run is not under the default directory), and exits 0; foreground runs print each line and append it to `log.txt`.
- Acceptance: detached start without `PASEO_AGENT_ID` -> exit 1, no run dir; with FDC -> returns under 2 s, `run.json` exists before the parent exits, `log.txt` has no duplicated lines; a detached run with `--runs-dir <tmp>/runs` outside `_workspace/_runs`: the printed hint command follows it to its end, `ph run-stats <id> --runs-dir <tmp>/runs` reads it and `ph archive --run <id> --runs-dir <tmp>/runs` addresses it.
- Source: WFL-19, RUN-69(1), RUN-69(3), WFL-41, INV-18.
- Scope: v1

#### FLOW-22 Progress line grammar
- Requirement: log lines follow exactly: `workflow start <runId> <runDir>`, `phase <title>`, `log <message>` (incl. `log warning: ...`, `log nested workflow <path>`, `log watchdog: ...`), `agent start #<n> <label> <id8> <model>`, `agent done #<n> <label> ok|null (<reason>) tokens=<n> cost=<usd|?> <s>s`, `agent cached #<n> <label>`, `shell start|done #<n> ...`, `workflow done|failed <runId>: ...`; the `ph` skill documents the grammar.
- Acceptance: a fixture run's `log.txt` matches one regex per line type, every line; skill doc lists the same line types (lint).
- Source: WFL-20, HIS-18.
- Scope: v1

#### FLOW-23 Return value and un-awaited calls
- Requirement: the script's return value is JSON-round-tripped into `result.json`; a thrown error fails the run with the journal kept; calls the script started without awaiting are awaited by the host before `workflow done` is written, and their count is logged as `log warning: <k> agent() call(s) were not awaited by the script`.
- Acceptance: a script firing `agent()` without `await` -> the `workflow done` line comes after that call's `agent done` line, the warning names 1, no unarchived agent remains.
- Source: WFL-21, RUN-70(a).
- Scope: v1

#### FLOW-24 Transport loss
- Requirement: after the first runner error whose first line matches `Transport (closed|not connected)` the runner logs `log runner lost the daemon connection (<err>): remaining agent() calls return null; resume the run` and every later `agent()` returns `null` at once with reason `daemon connection lost earlier in this run (<err>); resume the run`, creating no agent; there is no reconnect.
- Acceptance: FDC throws `Transport closed` on call 1 -> calls 2..5 return `null` with the reason and FDC records no further create.
- Source: WFL-27, RUN-69(2), D-34.
- Scope: v1

#### FLOW-25 Agent lifecycle in runs
- Requirement: workflow agents carry labels `harness.run=<runId>`, `harness.name=<label>`, `ph.swarm=<workflow name>` and the parent label (PCLI-08) and the worker env (PCLI-09); the watchdog is armed at creation and disarmed in `finally`; every non-session agent is archived after its call unless `keep`, once (an agent already archived by the watchdog is not archived again); an archive failure logs `log warning: archive <id8> failed: <err>`.
- Acceptance: after an FDC run no agent labelled `harness.run=<id>` is unarchived except `keep:true` ones; a watchdog stop produces exactly one archive call for that agent.
- Source: WFL-28, RUN-69(5), WFL-52(e).
- Scope: v1

#### FLOW-26 Null reason vocabulary
- Requirement: `null` results carry one of: `finished without a reply`, `no reply within <N> s`, `watchdog stopped the agent after <agent_stop_s> s`, `watchdog stopped the agent: second hung <tool> call`, `daemon connection lost earlier in this run (...)`, `runner error: <msg>`, `prompt is <bytes> bytes > max_prompt_bytes ...`, `agent error: <first line, 300 chars>`, a permission failure (PCLI-14), or a schema failure with up to three validation errors (FLOW-13); the reason is in the journal and the `agent done` line.
- Acceptance: one fixture per reason produces the exact text in both places.
- Source: RUN-69(4), D-28.
- Scope: v1

#### FLOW-27 Worktree isolation for workflow agents
- Requirement: `isolation:'worktree'` creates the worktree of PHCL-31 named `<runId>-<n>` per call that creates a new agent and gives the worktree note; a reused session agent keeps its session's worktree and no new worktree is created (FLOW-47); a creation failure is that call's `null` reason; worktrees are kept for the orchestrator and pruned only through `ph worktrees --prune` (PHCL-32).
- Acceptance: temp repo: two calls with isolation create two worktrees on `harness/<runId>-1`/`-2`; outside git -> `null` with `isolation 'worktree' needs a git repository`.
- Source: WFL-29, D-26.
- Scope: v1

#### FLOW-28 Role priming and warm-up gate, off by default
- Requirement: `prime_role` (`two-turn|off`, shipped `off`) and `warmup` (shipped `false`, `warmup_s` 8, `warmup_timeout_s` 90) keep their mechanisms: with priming on, a typed call first sends the role block + safety notes (read-only, worktree/cwd, first-prompt note) + `This message only loads your role. Reply with the single word READY; your task comes in the next message.`, waits for that turn, then sends the task prefixed `Task (your role, <type>, and its files are in the first message; do not open them again):` with the schema as text (no native `outputSchema`), and the `agent start` line gets ` prime:two-turn`; with warm-up on, the first agent per `runId|type|model|thinking` starts alone and the others wait for its gate (opened after its role turn, or `warmup_s` after creation, or in `finally` on failure) or `warmup_timeout_s`; the fallback timer is cleared when the wait ends. Spawn/fanout are never primed.
- Acceptance: defaults -> one prompt per agent, no gate; priming on -> FDC sees READY prompt then task, the first carries the read-only note; warm-up on with 3 same-type calls -> creates 2 and 3 happen after the gate; the `ph workflow` process exits within 1 s of `workflow done` (no lingering timer).
- Source: WFL-23, WFL-24, RUN-22, RUN-68, D-24, INV-23, S-15.
- Scope: v1

#### FLOW-29 Watchdog: model time
- Requirement: for each workflow agent the watchdog computes `modelMs = now - promptAt - union(tool spans)`, where spans are `[inputAt, completedAt]` of finished calls and `[inputAt, now]` of open calls with complete input, clipped to `[promptAt, now]` and merged so overlapping calls count once; `promptAt` is set at arming and on every runner prompt (not on the watchdog's own messages); one process-wide 10 s unref'd ticker evaluates all armed agents and is cleared when none remain.
- Acceptance: FCLOCK: two overlapping 60 s tool calls in a 100 s window -> `modelMs` = 40 s; after the last disarm the ticker is cleared (process exits).
- Source: WFL-30, INV-20.
- Scope: v1

#### FLOW-30 Tool clock starts when the input is complete
- Requirement: on a `running` event the call's input key (JSON of input fields only) is stored; `inputAt = now` only when the input is ready and either the key changed or `inputAt` is still null; a key change to a not-ready input leaves `inputAt` unchanged; readiness, keyed on exact tool names: `Write` needs `file_path`+`content`; `Edit` needs `file_path` and `new_string`; `MultiEdit` needs non-empty `edits`; `Bash` needs `command`; `Read` needs `file_path`; `mcp__harness-files__write_multiple_files` needs `files` whose entries all have string `content`; `mcp__harness-files__edit_multiple_files` needs `files` with non-empty `edits` or non-empty `fixes`; `mcp__harness-files__read_ranges` needs non-empty `ranges`; any other tool a non-empty input; Paseo typed details (`{type:'write', filePath, content}` etc.) are mapped to these shapes; time before readiness is model time.
- Acceptance: FCLOCK replay of the recorded incident (Write path at 0 s, content at 104 s, done at 104.2 s, file limit 180 s) -> no interrupt; Write running with path only, tick at +400 s -> no cancel and `modelMs >= 399 s`; add content, tick +181 s -> one cancel.
- Source: WFL-31, HIS-01, WFL-47, INV-20.
- Scope: v1

#### FLOW-31 Finished calls stay finished
- Requirement: the watchdog keeps the ids of completed calls; a `running` event for a completed call id is ignored; only `tool_call` timeline items with a `callId` are processed; terminal statuses are `completed|failed|error|canceled|cancelled`; a completed call is processed once.
- Acceptance: feed `completed` then `running` for one id -> no open call afterwards and no stuck interrupt at +900 s.
- Source: WFL-32, HIS-02, INV-20.
- Scope: v1

#### FLOW-32 Tool kinds by exact name
- Requirement: kinds come from a table of exact tool names: write = `Write, Edit, MultiEdit, NotebookEdit, mcp__harness-files__write_multiple_files, mcp__harness-files__edit_multiple_files`; read = `Read, Grep, Glob, mcp__harness-files__read_ranges`; shell = `Bash` (and `PowerShell` where present); everything else `other`; for `Bash` only a command that redirects to a file (`>`/`>>` outside `=>`/`>&`) or calls `writeFileSync|appendFileSync|Set-Content|Out-File|Add-Content` counts as write; no prefix regexes for dropped adapters (fsbatch, filesystem, Codex names).
- Acceptance: unit: table lookups for each listed name; `node -e "a=>a"` is not a write; typed native `Read` details counted as reads; `mcp__fsbatch__read_ranges` -> `other`.
- Source: WFL-33, S-01.
- Scope: v1

#### FLOW-33 Steering on loop, reread, piecemeal
- Requirement: on each completed call, at most one message per kind per prompt: `loop` = same tool + identical non-empty input key completed `watchdog_repeat_calls` (3) times since the last prompt or write; `reread` = one file path read `watchdog_same_file_reads` (3) times by read-kind non-search tools (paths from `file_path`, `filePath`, `path`, `paths[]`, `ranges[].path`, normalised to `/`, project-relative, case-insensitive); `piecemeal` = `watchdog_reads_without_write` (15) read-kind calls with no write between; a write-kind call first clears read, file-read and repeat counters and then counts itself once; sent signals are not cleared by a write; each signal logs `log watchdog: <label> <id8> <kind>: <json first 160 chars>` and sends the shipped steering text for that kind unchanged (D-35).
- Acceptance: three identical Grep inputs -> exactly one `loop` message; Read a, Write b, Read a, Read a -> no reread; three Reads of one path via `read_ranges` ranges -> one reread; 15 reads -> one piecemeal.
- Source: WFL-34, D-35.
- Scope: v1

#### FLOW-34 Nudge and stop by model time
- Requirement: at `agent_nudge_s` (shipped 900) of model time since the last prompt the agent gets the shipped nudge text once per prompt (`log watchdog: ... nudged to finish`); at `agent_stop_s` (shipped 1800) it is archived, logged `... used <N> min of model time since its last prompt, stopped`, and the call returns `null` with `watchdog stopped the agent after <agent_stop_s> s`; 0 disables either limit.
- Acceptance: FCLOCK nudge 10 / stop 20, model-only agent: tick +11 s -> one nudge; +21 s -> one archive and the null reason; with nudge 0 no nudge is sent.
- Source: WFL-35, RUN-64.
- Scope: v1

#### FLOW-35 Stuck tool: interrupt once, then stop with the real reason
- Requirement: an open call with complete input running longer than its limit is stuck; the limit depends on the tool's origin, not its activity kind: `agent_file_tool_stuck_s` (shipped 180) for read/write-kind non-shell tools, `agent_tool_stuck_s` (shipped 900) for every shell tool (`Bash`, `PowerShell`) even when FLOW-32 classifies its command as a write, and for all other tools; 0 disables; first hang: open calls cleared, the turn cancelled, the shipped retry text sent (`Harness watchdog: your <tool> call did not return and was interrupted. Check what it already changed (re-read the affected files), then continue the task with smaller calls (at most 3 files per batch call).`), and the runner waits for that retry turn instead of returning `finished without a reply`; a second hang in the same agent archives it with reason `watchdog stopped the agent: second hung <tool> call` and log `... one <tool> call ran <N> min without returning, stopped`.
- Acceptance: FCLOCK: file tool open 181 s after complete input -> one cancel + one retry message, the call's result is the retry turn's reply; a second hang -> archive with that reason; a `Bash` open 400 s -> untouched; a `Bash` `build > build.log` open 400 s -> read/repeat counters reset as a write, no interrupt; a `Write` open 181 s -> interrupted.
- Source: WFL-37, HIS-02, HIS-03, D-28, INV-20.
- Scope: v1

#### FLOW-36 Watchdog messages bounded and best effort
- Requirement: every watchdog message goes through `sendPrompt` (PCLI-05); a send failure logs `log watchdog: message to <id8> failed: <err>`, does not throw, and counts as the signal for that prompt; cancel/archive errors are logged, never thrown.
- Acceptance: a 2000-char path with `max_prompt_bytes` 1000 -> the failure log line, no FDC send, run continues.
- Source: WFL-38, INV-11.
- Scope: v1

#### FLOW-37 Watchdog reset
- Requirement: each runner prompt resets nudge flag, `promptAt`, tool spans, read counters, signals, repeat and file-read maps; it keeps the stuck-interrupt flag, open calls and finished ids; disarm removes the agent's state.
- Acceptance: after a reset a `reread` fires again for the same file; a second hang after a reset still stops the agent.
- Source: WFL-39.
- Scope: v1

#### FLOW-38 Watchdog configuration
- Requirement: the watchdog reads `agent_nudge_s, agent_stop_s, agent_tool_stuck_s, agent_file_tool_stuck_s, watchdog_repeat_calls, watchdog_same_file_reads, watchdog_reads_without_write` and a real on/off switch (`watchdog_enabled`, shipped true; false arms nothing) through the M3 loader (project overlay may change them, D-110: no project values shipped); the numbers in the `ph` skill's tables are generated from `harness.defaults.json`.
- Acceptance: overlay `watchdog_enabled: false` -> no `log watchdog` line and no FDC cancel in a 2000 s FCLOCK run; doc-vs-defaults test: every watchdog number in the skill equals the defaults value.
- Source: RUN-64, RUN-65, RUN-10, WFL-36, D-36.
- Scope: v1

#### FLOW-39 Watchdog scope
- Requirement: the watchdog arms only for workflow agents; `ph spawn`/`fanout` teammates are never nudged, interrupted, stopped or archived by it.
- Acceptance: FDC spawned agent exceeding all limits under FCLOCK -> no watchdog message or cancel.
- Source: WFL-40, D-27.
- Scope: v1

#### FLOW-40 ph watch-run
- Requirement: `ph watch-run RUNID... [--all] [--from-start] [--runs-dir D]` (default `_workspace/_runs`) follows `<runs-dir>/<id>/log.txt` by appended bytes every 1 s (partial last line held, CR stripped) and prints `log`, `phase`, `workflow` lines and `agent done ... null (...)` lines (`--all`: every line), prefixed `[<last 4 of id>] ` when several runs; attaching to a log with lines prints `resuming <id>: skipped <N> earlier lines; current phase <p> (--from-start replays them)` plus any terminal line instead of replaying; a run ends on a `workflow done|failed` line, on `run.json.status` not `running` (`workflow ended (run.json status <s>)`), on a dead runner pid for 3 consecutive checks, reset when seen alive (`workflow interrupted (runner pid <N> is gone; end it with: ph archive --run <id>)`, EPERM = alive), on a missing run dir for 60 s (`workflow not found (no <dir>)`) or a run dir without `run.json` for 60 s (`workflow not started (no run.json in <dir>)`); exit 0 when all ended; no ids -> exit 1.
- Acceptance: fixtures: `status: stopped` + dead pid -> ends within 5 s; dead pid with `running` -> ends after 3 polls; a log of 500 lines -> one resume summary; a `null` agent line is shown without `--all`; a dir without `run.json` -> ends after 60 s (FCLOCK).
- Source: WFL-41, HIS-14, RUN-59, INV-19.
- Scope: v1

#### FLOW-41 ph run-stats
- Requirement: `ph run-stats RUNID... [--transcripts] [--runs-dir D]` (default `_workspace/_runs`) prints per run from `run.json` + `journal.jsonl` (agents adopted from an earlier run count for this run, FLOW-48): `<id> [<role> <model>, ...] status <s>` (one entry per distinct role and model, model `-` when none was recorded); `wall <s> s; agents <n>: median <s> s, slowest <s> s; tokens in <i> cached <c> out <o>; cost $<x|?>`; with `--transcripts` also tool-call counts per kind (FLOW-32 table) from Claude Code transcripts under `<CLAUDE_CONFIG_DIR|~/.claude>/projects/<cwd slug>` matched only by the exact `Run <runId> #<n>` tag; a missing run or journal -> `failed <id>: <reason>` and exit 2 (no stack trace).
- Acceptance: fixture run: numbers equal the journal sums; a tagged transcript counted, an untagged transcript of the same time window not; missing run -> exit 2 with one `failed` line.
- Source: WFL-42, RUN-59, D-25, D-31.
- Scope: v1

#### FLOW-42 ph runs and pruning
- Requirement: `ph runs [--runs-dir D]` lists `<runId> <status> <startedAt> <name>` newest first; `--prune` deletes `done` and `stopped` run directories beyond the newest `runs_keep` (shipped 20), never `failed` or `running` ones and never a run with a live pid, printing `removed <runId>` per run and `runs: <n> listed, <k> removed`.
- Acceptance: fixture with 25 done, 2 failed, 1 running -> `--prune` removes the 5 oldest done only.
- Source: D-33, WFL-47.
- Scope: v1

#### FLOW-43 Engine with an injected runner
- Requirement: the engine `runWorkflow({...})` imports no Paseo code and receives from the host: the script and args; the run id; the limits (`maxConcurrent`, `maxAgents`, budget total) taken from config; the journal path and loaded cache; output, clock and child-script resolution; the orchestrator's extra spend; and host functions for (a) resolving a call's identity before the cache lookup (resolved role-text hash, `provider/model`, effort, FLOW-15), (b) admission beyond the run semaphore (caller-wide running and live capacity, FLOW-14), (c) adopting the recorded agent of a cached session call (FLOW-12, FLOW-48), and (d) running a live call: `runner(spec) -> {status:'ok'|'null', result, reason, agentId, model, tokens, usage, durationS}` with `spec = {n, runId, workflowName, label, phase, prompt, opts}`; it returns `{result, meta, stats:{started, ok, null, cached, tokens}}`; the Paseo-backed host (PCLI, PHCL prompt assembly, watchdog) is a separate module. Names of the host functions are an implementation choice.
- Acceptance: the FLOW-01..FLOW-17 tests run against fake hosts with no network; a pure-engine test with non-default limits (`maxConcurrent` 2, `maxAgents` 3) enforces them; a host spy shows a cached session hit calls the adoption function with the recorded agent id and never the runner; grep: engine file imports nothing from `paseo-client/`.
- Source: WFL-49, P11.
- Scope: v1

#### FLOW-44 Workflow authoring guide in the ph skill
- Requirement: the workflow recipes reference (`workflow-recipes.md`) is carried with its method content unchanged (all recipes and the cautions table: fan-out + adversarial verification, judge panel, loop until dry, budget-aware loop, custom type + schema + effort, tier choice), edited only in the adapter layer listed in its NOTICE (HARN-02: runtime paths and `ph` command forms, config key names, removal of the non-Claude MCP-adapter sentence); the `ph` skill (kit adapter layer, D-111) adds a short index linking to it and states the kit authoring rules: guard `null` per stage and `.filter(Boolean)` before aggregating; no needless barriers (`pipeline` by default); pass `opts.phase` inside parallel stages, never global `phase()`; give agents per-item extracts and paths, never whole corpus files; read `journal.jsonl` before diagnosing; keep scripts in files so `--resume` works; scripts never read the clock (host passes times in `args`).
- Acceptance: HARN-01's source-diff test covers `workflow-recipes.md` and every differing hunk is a NOTICE entry; skill lint finds each kit rule; every recipe script parses with `parseScript` and runs against a fake runner; grep finds no `fsbatch`/MCP-adapter sentence.
- Source: WFL-45, WFL-46, WFL-50, D-87, D-111, HARN-01, HARN-02.
- Scope: v1

#### FLOW-45 Workflow consent rule
- Requirement: the `ph` skill states that a workflow runs only when the owner asked for one or an invoked skill or GSD command names `ph workflow` (that invocation counts as the request), and that main sessions orchestrate only through `ph` (native Agent/Workflow denied on the main provider); the method's execution modes (A workflow / B persistent team / C one-shot) and decision tree stay in the carried method text unchanged (HARN-01), only their runtime mapping to `ph` is adapter text (HARN-02).
- Acceptance: skill lint finds the rule and the deny statement; the statement does not mention `SendMessage` as denied on main; HARN-01's diff test covers `execution-modes.md`.
- Source: WFL-44, D-32, D-06, INV-06, D-111, HARN-01, HARN-02.
- Scope: v1

#### FLOW-46 Schema subset of the kit validator
- Requirement: the kit validator supports exactly: `type` (`object, array, string, number, integer, boolean, null`, or an array of these), `properties`, `required`, `additionalProperties` (boolean), `items` (one schema), `enum`, `const`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, plus annotations `description`, `title`, `default`, `examples` (ignored); validation is recursive through `properties` and `items`; `integer` rejects non-integral numbers; a schema containing any other keyword (`$ref`, `oneOf`, `anyOf`, `allOf`, `pattern`, `format`, ...) is rejected when `agent()` is called (configuration throw, fail closed), never silently ignored; errors carry the JSON path (`/plans/2/id: expected string`); the native `outputSchema` sent at creation is the same schema object, so both checks give one meaning.
- Acceptance: per keyword one valid and one invalid fixture, nested object-in-array cases, an extra property under `additionalProperties:false`, a float under `integer`, unparsable JSON; a schema with `oneOf` throws at call time; a scan of every schema in the shipped workflow scripts (`.agents/workflows/*.js`) passes the subset check.
- Source: WFL-11, RUN-67, D-30.
- Scope: v1

#### FLOW-47 Session invariants and session worktrees
- Requirement: a session key fixes, at its first live call, `agentType` with its resolved role-text hash, `role`, `readOnly`, `cwd`, `isolation` and the worker provider; a later call with the same key that changes any of them throws a configuration error `session <key> cannot change <property>; use a new session key`, before anything is created; `model` and `effort` may change and are applied through PCLI-16 (update + readback); session agents get no native `outputSchema`: every call's schema (none, the same or a different one) is validated per call by FLOW-13/FLOW-46 with the schema given as prompt text; with `isolation:'worktree'` the worktree is created once, on the session's first call, recorded in the journal with the session key, reused by every later call and by an adopted agent on resume (missing directory -> that call's `null` reason `session worktree <path> is gone`), and never created for a reused agent.
- Acceptance: FDC two-call fixtures changing each fixed property -> the throw and zero extra creates; a writable call after a read-only one with the same key -> throw; two calls with different schemas -> both validated by their own schema, no `outputSchema` in the create call; temp git repo: a coder session with isolation, two calls and a resumed third call -> one worktree, all three prompts name the same path, `git worktree list` shows no extra tree.
- Source: HIS-16, HIS-17, WFL-29, INV-22, D-26.
- Scope: v1

#### FLOW-48 Ownership and attribution of adopted session agents
- Requirement: when a run adopts an agent recorded by an earlier run (cached session call, FLOW-12), the host records it in the run's `run.json` `adopted: [{agentId, session, fromRun}]` before the next live call and updates its `harness.run` label to the new run id when the client supports label updates; `ph archive --run <newRun>` archives own agents labelled with the run or listed in `adopted`; run end archives adopted session agents like its own; every prompt sent to a session agent after its first carries the line `Run <runId> #<n> (bookkeeping only; ignore).` of the current call, so `ph run-stats --transcripts` attributes those turns to the current run.
- Acceptance: FDC: run 1 with a session call, resume as run 2 with a cached first call and a live continuation -> `run.json.adopted` lists the agent, the continuation prompt ends with `Run <run2> #<n>`, `ph archive --run <run2>` archives it; a fixture transcript of that turn is counted by run-stats for run 2; with label updates unsupported the archive still finds it through `adopted`.
- Source: HIS-16, WFL-22, WFL-28, WFL-42, WFL-43.
- Scope: v1

#### FLOW-49 Trusted-code limits stated in the ph skill
- Requirement: the `ph` skill's runtime guide states: workflow scripts are trusted project code; the script context is not a security boundary (a script can reach the host process); `shell()` runs host commands on purpose; a busy loop in a script hangs the runner (no body timeout); budget is checked before each new call so running agents can overshoot; write scripts like code you run and await every `agent()`. No sandbox is required.
- Acceptance: skill lint finds each of the five statements.
- Source: RUN-70, WFL-02, WFL-21.
- Scope: v1

### Later

- Stuck-tool interrupt (without archive) for persistent teammates (D-27 "at most"; WFL-40).
- Turn priming and warm-up on by default after a fixed benchmark of completed-task cost, cache fields and latency (D-24; WFL-23, WFL-24).
- Cross-process admission lock for `ph` capacity checks (check-then-create race between two `ph` processes; RUN-29 concern).
- Removal of the cwd/worktree prompt instruction once MC-02 shows Paseo honours a requested cwd (R-03; RUN-39).
- Trim of unused watchdog steering kinds or tool-kind entries after transcript measurement (D-43 analogue for the watchdog; WFL-33).

### Out of scope (dropped)

| item | reason |
| --- | --- |
| `isClaudeProvider`, `modes`, `provider_features`, MCP attach for non-Claude agents | S-01, owner: Claude Code only (RUN-17 part, RUN-18, RUN-62) |
| `.claude/agents`, `.claude/workflows`, `.claude/harness.config.json` fallbacks | S-02, W-02 |
| skill facades `.agents/skills/harness/scripts/*`, `shared_paths.mjs`, `workflow_engine.mjs` facade | S-02, D-10 (RUN-52, WFL-48) |
| Paseo CLI `getStructuredAgentResponse` dependency | D-30 |
| watchdog shell-text and Codex tool-name heuristics beyond the exact-name table | WFL-33 |
| project tiers, allowlists, thresholds, price data, prompt notes of any project | D-110 (RUN-65, RUN-66 data) |

### Traceability

| behavior | requirement(s) |
| --- | --- |
| RUN-11 | PHCL-23 |
| RUN-12 | PCLI-05 |
| RUN-13 | PHCL-21 |
| RUN-14 | PHCL-21, PHCL-04 |
| RUN-15 | PCLI-10, PHCL-04 |
| RUN-16 | PHCL-04 (doctor model-offered check); the add-a-model flow is documentation only |
| RUN-17 | PCLI-07 (`mode`, tier `features`); `modes`/`provider_features` dropped (S-01) |
| RUN-18 | not a requirement: dropped (S-01, Claude Code only) |
| RUN-19 | PHCL-26 |
| RUN-20 | PHCL-27 |
| RUN-21 | PHCL-28 |
| RUN-22 | FLOW-28 |
| RUN-23 | PHCL-29 |
| RUN-24 | PHCL-30 |
| RUN-25 | PCLI-01, PCLI-02, PCLI-04 |
| RUN-26 | PCLI-07, PCLI-08, PCLI-09, PCLI-11 |
| RUN-27 | PCLI-11 |
| RUN-28 | PCLI-06 |
| RUN-29 | PHCL-23, PHCL-24, PHCL-25 |
| RUN-30 | PCLI-15 |
| RUN-31 | PCLI-12, PCLI-13 |
| RUN-32 | PCLI-14 |
| RUN-33 | PCLI-05 |
| RUN-34 | PHCL-01 |
| RUN-35 | PHCL-02 |
| RUN-36 | PHCL-03 |
| RUN-37 | PHCL-04 |
| RUN-38 | PHCL-05 |
| RUN-39 | PHCL-06 |
| RUN-40 | PHCL-07 |
| RUN-41 | PHCL-08 |
| RUN-42 | PHCL-09, PHCL-10 |
| RUN-43 | PHCL-11 |
| RUN-44 | PHCL-12 |
| RUN-45 | PHCL-13 |
| RUN-46 | PHCL-15 |
| RUN-47 | PHCL-16 |
| RUN-48 | PHCL-17 |
| RUN-49 | PHCL-18 |
| RUN-50 | PHCL-19 |
| RUN-51 | PHCL-20 |
| RUN-52 | PHCL-01 (single entry; facade dropped, S-02) |
| RUN-53 | PHCL-35 |
| RUN-54 | PHCL-36 |
| RUN-55 | PHCL-31 |
| RUN-56 | PHCL-32 |
| RUN-58 | FLOW-20 |
| RUN-59 | FLOW-40, FLOW-41 |
| RUN-60 | PHCL-34 |
| RUN-61 | PCLI-09, PHCL-04 |
| RUN-64 | FLOW-34, FLOW-38 |
| RUN-65 | FLOW-38 (real watchdog switch), PHCL-22 (roles/tiers as adapter data); project values not carried (D-110) |
| RUN-66 | PHCL-14 |
| RUN-67 | FLOW-13, FLOW-46 |
| RUN-68 | FLOW-28 |
| RUN-69 | FLOW-21, FLOW-24, FLOW-25, FLOW-26 |
| RUN-70 | FLOW-09, FLOW-15, FLOW-23, FLOW-49 |
| WFL-01 | FLOW-01 |
| WFL-02 | FLOW-02, FLOW-49 |
| WFL-03 | FLOW-03 |
| WFL-04 | FLOW-04 |
| WFL-05 | FLOW-05 |
| WFL-06 | FLOW-06 |
| WFL-07 | FLOW-07 |
| WFL-08 | FLOW-08 |
| WFL-09 | FLOW-09 |
| WFL-10 | FLOW-10 |
| WFL-11 | FLOW-13, FLOW-46 |
| WFL-12 | FLOW-14 |
| WFL-13 | FLOW-15, FLOW-16 |
| WFL-14 | FLOW-15 |
| WFL-15 | FLOW-17 |
| WFL-16 | FLOW-18 |
| WFL-17 | FLOW-19 |
| WFL-18 | FLOW-20 |
| WFL-19 | FLOW-21 |
| WFL-20 | FLOW-22 |
| WFL-21 | FLOW-23, FLOW-49 |
| WFL-22 | PHCL-28 |
| WFL-23 | FLOW-28 |
| WFL-24 | FLOW-28 |
| WFL-25 | PCLI-05 |
| WFL-26 | PCLI-12, PCLI-13, PCLI-14 |
| WFL-27 | FLOW-24 |
| WFL-28 | FLOW-25 |
| WFL-29 | FLOW-27, FLOW-47, PHCL-32 |
| WFL-30 | FLOW-29 |
| WFL-31 | FLOW-30 |
| WFL-32 | FLOW-31 |
| WFL-33 | FLOW-32 |
| WFL-34 | FLOW-33 |
| WFL-35 | FLOW-34 |
| WFL-36 | FLOW-38 |
| WFL-37 | FLOW-35 |
| WFL-38 | FLOW-36 |
| WFL-39 | FLOW-37 |
| WFL-40 | FLOW-39 |
| WFL-41 | FLOW-40 |
| WFL-42 | FLOW-41, FLOW-48 |
| WFL-43 | PHCL-20, FLOW-48 |
| WFL-44 | FLOW-45; A/B/C method text carried unchanged by HARN-01, HARN-02 |
| WFL-45 | FLOW-44; recipes carried unchanged by HARN-01, HARN-02 |
| WFL-46 | FLOW-44 (`opts.phase` rule); the review-gate pattern itself is M10 code review (D-56) |
| WFL-47 | FLOW-30 (incident replay fixture), FLOW-42 |
| WFL-48 | not a requirement: dropped (S-02, single install location) |
| WFL-49 | FLOW-43 |
| WFL-50 | FLOW-44 |
| WFL-51 | PHCL-27, PHCL-36 |
| WFL-52 | FLOW-01, FLOW-02, FLOW-16, FLOW-17, FLOW-25, PCLI-13, PCLI-14 |
| WFL-53 | PCLI-11 |
| HIS-01 | FLOW-30 |
| HIS-02 | FLOW-31, FLOW-35 |
| HIS-03 | FLOW-35 |
| HIS-12 | PHCL-17, PHCL-18 |
| HIS-13 | PHCL-07 |
| HIS-14 | FLOW-40 |
| HIS-15 | PCLI-13 |
| HIS-16 | FLOW-12, FLOW-47, FLOW-48, PCLI-16 |
| HIS-17 | PCLI-16 |
| HIS-18 | PHCL-14, FLOW-17, FLOW-22 |
| HIS-22 | PHCL-11 |
| HIS-23 | FLOW-11, FLOW-02 |
| HIS-24 | PHCL-32 |
| HIS-28 | PHCL-33 |
| HIS-29 | PCLI-03 |
| HIS-83 | FLOW-15 |
| HIS-89 | FLOW-14 |
| UI-80 | PCLI-08 |

### Counts

- v1 requirements: 101 (PCLI 16, PHCL 36, FLOW 49)
- later items: 5
- behaviors traced: 128
- behaviors not a requirement: 2 (RUN-18, WFL-48)

### Revision log r1

| finding ID | accepted / rejected | what changed (requirement IDs) or why rejected |
| --- | --- | --- |
| SR-RTM-01 | accepted | RUN-70(a) keeps the trusted-code limits (map runtime.md:546). FLOW-02 now says no ambient API, `shell()` intentional, guards are not a sandbox; new FLOW-49 (trusted-code statements in the `ph` skill); RUN-70, WFL-02, WFL-21 traced to FLOW-49. |
| SR-RTM-02 | accepted | D-30 replaces Ajv, not the obligation. New FLOW-46 (keyword subset, recursion, fail-closed on unknown keywords, same schema for native `outputSchema`, scan of shipped schemas); FLOW-13 points to it and treats unparsable JSON as a retryable validation error. |
| SR-RTM-03 | accepted | FLOW-11: string form via Node's platform shell, argv form without a shell (the ADPT-02 path), -1 only for launch failure or timeout, process-tree kill asserted on a grandchild. |
| SR-RTM-04 | accepted | RUN-61 (map runtime.md:482) requires `enabled or direct`; SYNTHESIS's shorter wording dropped that condition. PCLI-09 restored the affirmative selection, effective worker-provider env (`extends`) as base, new matrix incl. unset, missing assets, other config dir, no settings write. |
| SR-RTM-05 | accepted | D-111 restores method references unchanged. FLOW-44 no longer trims recipes: carried unchanged with HARN-02 adapter edits plus a `ph` index; FLOW-45 notes A/B/C modes carried by HARN-01; WFL-44/WFL-45 rows cross-reference HARN-01/HARN-02. |
| SR-RTM-06 | accepted | FLOW-14 adds caller-wide running capacity (teammates and other runs counted, reservation until tokens are charged, re-count on completion and every 5 s) with a 19-running-teammates test. |
| SR-RTM-07 | accepted | PHCL-24: live cap counts new-agent allocations only; send/session reuse needs no slot; collect-mode `--keep` rule. PHCL-10: live slot per admission. FLOW-14: bounded wait (`wait_timeout_s`), immediate named `null` when all retained agents belong to the run; 41-session test. |
| SR-RTM-08 | accepted | FLOW-04 adds option `role`; PHCL-22 rewritten: explicit role input, model and effort resolved independently, valid role without entry falls back (ADPT-11), invalid role errors; FLOW-15 hashes the resolved effort; outline/planner split test. |
| SR-RTM-09 | accepted | CONF-14 (platform.md) now names `project_prompt_note` and makes `first_prompt_note` kit-owned; PHCL-29 uses those keys and its acceptance runs through `loadConfig` and real assembly. |
| SR-RTM-10 | accepted | D-97 wants one source; PANL-55 uses `context_guard.start_pct`. PHCL-16 default is now the effective `context_guard.start_pct` (60, overlay applies), no rotate constant; shared-fixture test below/at/above and with an overlay. The panel's choice of kit defaults stays as PANL-55 states it. |
| SR-RTM-11 | accepted | New FLOW-47: session worktree created once, reused by later and adopted calls, never created for a reused agent; FLOW-27 limited to calls creating a new agent. |
| SR-RTM-12 | accepted | FLOW-47: fixed session properties (type + role-text hash, role, readOnly, cwd, isolation, provider) throw on change; model/effort through PCLI-16; session agents get no native schema, per-call validation; FLOW-13 updated. |
| SR-RTM-13 | accepted | New FLOW-48: `run.json.adopted`, label update when supported, `archive --run` and run end cover adopted agents, run tag on every later session prompt; FLOW-41 counts adopted agents; WFL-42/WFL-43 traced. |
| SR-RTM-14 | accepted | `--runs-dir D` added to FLOW-40 and FLOW-41; FLOW-21 hint carries it for non-default dirs; test of a detached run outside `_workspace/_runs` through watch-run, run-stats and archive. |
| SR-RTM-15 | accepted | WFL-37 limits the 180 s limit to non-shell tools. FLOW-35 picks the limit by tool origin (shells always `agent_tool_stuck_s`); redirected 400 s Bash test added. |
| SR-RTM-16 | accepted | FLOW-43 lists the host inputs (run id, limits, journal/cache) and host functions (pre-cache identity, caller-wide admission, cached-session adoption, live runner) without fixing names; pure-engine tests with non-default limits and an adoption spy. |
| SR-RTM-17 | accepted | PCLI-01 scoped to the installed runtime (M4..M10); M13 plugins use `@getpaseo/plugin`; import scan distinguishes the SDK from `@getpaseo/cli`/`@getpaseo/server`. |
| SR-RTM-18 | accepted | PHCL-27: under enforcement a read-only agent returns its report and the caller writes it; roles that write artifacts use a scoped editing role (WFL-51); note text unchanged (D-35); PCLI-07 payload has `disallowedTools?`; collect test and MC-03 check the report path. |
| SR-RTM-19 | accepted | PHCL-32 states the observable contract (only that registration removed, no argument-less `git worktree prune`, keep and report when no targeted removal exists). |

---

## Requirements: tools (M7 files, M8 hooks, M13 ui)

**Defined:** 2026-10-20
**Scope:** modules M7 files (prefix FTOL), M8 hooks (HOOK) and M13 ui (PANL) of `.planning/intel/SYNTHESIS.md`; decisions D-01..D-111 applied. Vanilla (D-110): nothing here is specific to a project, engine or game; where a mechanism needs project data, the project adapter supplies it (ADPT requirements own that contract).
**Test kinds:** `offline` = kit test under `tests/` with fakes (Claude Code mod engine stub, Paseo SDK fake, fake CLIs), temp homes and temp dirs with spaces, never the owner's live config or daemon (INV-57). `manual` = named manual check on a real Claude Code / Paseo install, result recorded in the phase verification; probe agents use `circle/gpt-6-luna-fast[1m]` (INV-50).
**Texts:** quoted model-facing texts fix the meaning and the key words tests match; their wording changes only with owner review (INV-49, D-35).

### v1 Requirements

### M7 files: harness-files mod and backend (FTOL)

#### FTOL-01 Exactly three file tools, loaded upfront
- Requirement: The harness-files mod registers exactly `mcp__harness-files__read_ranges`, `mcp__harness-files__edit_multiple_files` and `mcp__harness-files__write_multiple_files` at `session.start`, each with `isDeferred: false`; `session.start` throws `Unexpected file tool registry` when the backend's `describe` list has a missing, extra or unknown name. No filesystem-compat, directory, media or single-file tool exists.
- Acceptance: offline (stub engine): `tool.register` is called three times with these names and `isDeferred:false`; a stub backend describing a fourth name makes `session.start` throw; manual: a fresh Claude Code session lists the three full schemas without a ToolSearch round.
- Source: FIL-02, FIL-47, FIL-40, FIL-42, HIS-08, D-39, S-04.
- Scope: v1

#### FTOL-02 Flat schemas, backend validation with field paths
- Requirement: Every tool input schema is `type: object` with no root `anyOf/oneOf/allOf` and no `_meta`, plus optional strings `continuation` and `receipt`; the backend validates arguments before writing any state and fails with field-path messages (`<tool>.<path> is required`, `must be a nonempty array`, `must be a valid integer`, `has an invalid <type> value`, `must be one of ...`); `continuation` or `receipt` with any other key fails `supply only continuation OR receipt, not base arguments or both`; both values must be 64 lowercase hex. Malformed input is answered, never crashes the backend.
- Acceptance: offline: for each tool the schema rules hold; an empty `oldText`, a missing `files`, a non-integer `from`, a non-hex continuation and `{continuation, path}` each fail with the named message and leave the private session directory unchanged.
- Source: FIL-03, FIL-50, FIL-44 (lesson), P4.
- Scope: v1

#### FTOL-03 Short descriptions naming only shipped tools
- Requirement: Each tool description is its source description (FIL-22, FIL-27, FIL-29) with references to unshipped tools removed as an adapter change (the write description drops the source's last sentence `Use instead of one write_file call per file.`), plus one shared suffix sentence about continuation/receipt; no description, error, hint or note of the mod or backend names a tool the kit does not ship (`read_media_file`, `read_file`, `read_text_file`, `read_multiple_files`, `write_file`, `edit_file`, `fsbatch`, the `filesystem` MCP server).
- Acceptance: offline: the write description equals `Create or overwrite several files in one call (all-or-nothing: if any path is invalid, nothing is written). Parent directories are created.` plus the suffix; a scan of the `describe` output and of every message template in the backend and mod sources finds none of the listed names.
- Source: HIS-09, FIL-03, FIL-24, FIL-43, P10, INV-49.
- Scope: v1

#### FTOL-04 Mod packaging and Claude Code minimum
- Requirement: The kit ships `.claude/plugins/.claude-plugin/marketplace.json` (one plugin `harness-files`, source `./harness-files`), `harness-files/.claude-plugin/plugin.json` and `harness-files/hooks/hooks.json` = `{"modules":["./register.ts"]}`; `register.ts` uses only the Claude Code engine API (`session.start`, per-tool `tool.call`, `session.cwd/id`, `env.get`, `plugin.root`, `process.run`, `tool.register`, `tool.check`, `tool.call`), performs no target-file I/O itself, and the kit records the minimum Claude Code version (2.1.296 unless re-verification raises it) that `kit install --enable-plugin` gates on.
- Acceptance: offline: the three JSON files parse and reference each other consistently; a grep gate finds no `node:` import and no fs call in `register.ts`; manual: on the minimum Claude Code version, after `kit install --enable-plugin`, a new session lists and calls all three tools.
- Source: FIL-01, FIL-04, D-02, D-39, R-02.
- Scope: v1

#### FTOL-05 Backend discovery checked against the install manifest
- Requirement: The mod finds the project backend by trying `$PASEO_HARNESS_ROOT`, then the session cwd and each parent, then `<plugin root>/../../..`; a root counts when `.agents/harness/files/backend.mjs` exists. When `.agents/harness-kit.json` exists it must parse with `version` and a `files` map (else `harness install marker unreadable`), and every file of the trusted set (the backend entry `.agents/harness/files/backend.mjs`, every other `.agents/harness/files/*.mjs` except tests, `.agents/harness/config.mjs` and the modules it imports, `.agents/harness.defaults.json`; the set is a constant exported by the backend and a kit test checks it equals the static imports) must be listed (else `harness backend file not in installed marker: <rel>`) and match its recorded digest (the kit's shared CRLF->LF sha256 helper; else `harness backend differs from installed marker: <rel>`); a root with a manifest never falls back to source-project trust; without a manifest the root is trusted only as the plugin's own source project, else `harness backend lacks trusted install marker`; with no backend: `harness-files backend not found: install project assets or set PASEO_HARNESS_ROOT`. Nothing is cached: every call reads the manifest and digests every trusted-set file, so a file whose size and mtime were restored after an edit is still rejected; discovery times out after 30 s and fails closed on non-zero exit, truncated or empty output.
- Acceptance: offline: editing one backend file after install yields `differs from installed marker`; an empty `files` map, a manifest omitting `backend.mjs`, one omitting `config.mjs`, an untracked new `.agents/harness/files/extra.mjs`, and a modification after a successful discovery each fail before any target execution; a call from cwd `deep/child` finds the project backend; a project without backend yields the not-found text.
- Source: FIL-05, INV-02, D-04.
- Scope: v1

#### FTOL-06 Versioned transport, fail closed
- Requirement: Backend requests travel as one JSON object on stdin (max 16 MiB of UTF-8 bytes, else `file request exceeds 16 MiB; split the call`) and replies carry `protocol: 1`; the mod reports a non-zero exit, truncated stdout/stderr or empty stdout as `File transport failed: <cause>` and any other protocol as `Harness file mod/backend protocol mismatch: update the installed project assets and plugin together`, both before any native execution.
- Acceptance: offline: a stub backend answering `protocol: 9` yields the mismatch text and zero native Bash calls; truncated and empty replies yield `File transport failed`.
- Source: FIL-06, P4.
- Scope: v1

#### FTOL-07 Target I/O only through native Bash tickets
- Requirement: Target I/O runs only through native `Bash` calls `node '<backend>' --plan|--execute <64-hex session> <64-hex ticket>` (ids validated, else `Invalid backend ticket`), Bash timeout 120 s, so Claude Code's own permission and hook chain applies; the command never carries payload: its length is the quoted backend path plus a fixed overhead of at most 200 chars, independent of payload size; an execute counts as done only when its output contains `harness-files ticket completed`.
- Acceptance: offline: a 100 KB write produces Bash commands of the same length as a 10-byte write, containing no payload bytes; a backend path with spaces and a single quote is quoted and runs; an execute whose output lacks the sentinel is reported as an error.
- Source: FIL-01, FIL-07, D-39, D-40.
- Scope: v1

#### FTOL-08 Permission checks fail closed, ask never promoted
- Requirement: Before staging, the mod runs `tool.check` for every supplied path (`Read` per path; `Write {file_path, content}` per written file; `Edit {file_path, old_string, new_string}` per edit, line edits with `old_string: ''`); after `--plan` it repeats the checks for every planned target, including canonical paths, a unique read guess, retained fixes, a `Write {content:''}` check on the first existing parent directory of every written or edited target (staged siblings and renames modify it, also for existing files) and one for each missing ancestor of a new path. Any verdict other than `allow` (or a present non-allow `ceiling`) ends the call with `<tool> permission <decision>: <reason or 'use the native tool for this path; this adapter fails closed on ask/deny'>`, without execution, and the staged ticket is withdrawn.
- Acceptance: offline: stub `tool.check` answering ask or deny before staging -> refusal text and zero stage/native calls; deny only on the guessed canonical path -> no execute and the ticket withdrawn; a write to `new/dir/f.txt` plans Write checks for both missing ancestors; an allowed Edit of an existing file whose parent-directory Write is denied starts no execution and leaves no temp file.
- Source: FIL-08, FIL-10, D-40, INV-34.
- Scope: v1

#### FTOL-09 Executed target set equals checked set
- Requirement: `--execute` recomputes the plan from the stored request and fix state and aborts with `permission plan changed (paths, symlinks or retained fixes); nothing executed, retry the call` on any difference; during execution a path whose canonical path is not a planned one fails `unplanned or changed target: <abs>; nothing authorized for this path`; broken symlinks fail `broken symlink: <path>`.
- Acceptance: offline: plan a write through `link/a` (a junction on Windows), repoint the link, execute -> `plan changed`, both possible targets unchanged.
- Source: FIL-09, FIL-21, D-40.
- Scope: v1

#### FTOL-10 Permission-mode compatibility check
- Requirement: The kit verifies, without changing any setting, whether mod writes are allowed in the owner's actual `circle` main-session permission mode and in the `mode` the kit sets for the workers it creates (`modeId`, default `bypassPermissions`); an ask/deny refusal keeps the fail-closed text of FTOL-08, which names the native tool as fallback; changing a permission setting another tool owns (Claude Code, Paseo provider) is an explicit owner action in that tool, never a kit repair.
- Acceptance: manual: in an owner-approved scratch `circle` main session in its current mode and in a `ph spawn` worker on `circle/gpt-6-luna-fast[1m]`, `write_multiple_files` then `edit_multiple_files` on a scratch file are tried and the outcome per session is recorded; offline: stub ask and deny verdicts yield the FTOL-08 refusal while the fixture Claude settings and Paseo provider files stay byte-identical.
- Source: D-40, R-12, INV-05, INV-50.
- Scope: v1

#### FTOL-11 A mutation executes at most once
- Requirement: Each mutating call runs under a ticket that executes at most once: a `.started` marker is created exclusively before the handler runs; a second execute of a finished ticket is a successful no-op and of an unfinished one fails `execution ticket already started; outcome unknown, recover receipt or inspect targets; operation will not repeat`; a ticket withdrawn before execution can never execute; a completed result is recoverable by `{receipt: <ticket>}` on the same tool without rerunning (`receipt belongs to a different tool` otherwise).
- Acceptance: offline: execute a ticket, reset the target, execute again -> target unchanged; withdraw then execute -> refused; `{receipt}` returns the stored result while the target-write count stays 1.
- Source: FIL-14, HIS-06, INV-29, D-39, R-16.
- Scope: v1

#### FTOL-12 Recovered, unknown and not-executed are distinct outcomes
- Requirement: The mod makes the native execute call at most once per tool call. After a failure past that call: a recoverable completed result is returned as `Recovered completed execution receipt; operation was not repeated.` plus the text; a started execution without an available receipt returns `EXECUTION OUTCOME UNKNOWN: target files may already have changed. Do not repeat the mutation blindly. Recover its result on this same tool with {"receipt":"<ticket>"} ...`; an execution that never started returns `Not executed; no target changed. <cause>`. Failures before the execute call return their permission or transport cause, never `Not executed`.
- Acceptance: offline (stub engine): the four cases of FIL-15 produce the four texts with native execute count 1, 1, 1 and 0.
- Source: FIL-15, INV-29.
- Scope: v1

#### FTOL-13 Lossless pagination below the persistence threshold
- Requirement: Every result is paginated: page body at most 40,000 chars (`PAGE_CHARS`), never splitting a surrogate pair; every returned text (body, plus `ERROR (details/fix IDs are paginated, not discarded)` on every page of an error, plus the footer `CONTINUATION <64hex>: call mcp__harness-files__<tool> with {"continuation":"<token>"}; ...`) is at most 44,000 chars, below Claude Code's ~50,000-char persistence threshold, and the mod refuses a longer backend text; fix IDs are persisted before paging; a continuation is valid only on its tool and session (`continuation belongs to a different tool`; unknown or expired: `continuation unknown or expired (one-hour private retention/budget); read the needed range again`).
- Acceptance: offline: a 90,000-char error report with an emoji at a page boundary reassembles identical across pages; 600 failed edits page their report and keep 500 fix IDs; every page is <= 44,000 chars.
- Source: FIL-16, HIS-05, D-41, INV-28.
- Scope: v1

#### FTOL-14 Session-bound private state
- Requirement: Mod state (tickets, fix IDs, read tags, signatures, continuations, receipts) lives in `<tmpdir>/paseo-harness-files-<uid>/<sha256(Claude session id)>/`, mode 0700; a state directory that is a symlink, resolves elsewhere, or (POSIX) has another owner or group/other bits is refused (`unsafe private state directory...`); private files are read only when regular, owned, private and <= 64 MiB; IDs, tags, continuations and receipts of another session are unknown.
- Acceptance: offline: a fix ID, a tag and a continuation from session A fail as unknown in session B; a symlinked state directory is refused.
- Source: FIL-12, INV-31.
- Scope: v1

#### FTOL-15 Session lock with stale recovery
- Requirement: All backend actions of one session run under `session.lock` (exclusive create, content `{pid}`); a waiter polls up to 20 s (below the 30 s transport timeout) then fails `private session state locked by another running file operation; retry later`; a lock of a dead pid, or left unwritten for 10 s, is recovered atomically; a killed `--execute` never wedges the session. A call that writes files also takes a target lock per canonical file path (case-folded on Windows), kept in the shared state root so every session sees it: the locks are taken in sorted path order before the ticket starts and held through the commit and any rollback, so two sessions cannot overwrite each other's edits of one file; a wait that times out writes nothing, and the rollback of an interrupted batch takes the same locks.
- Acceptance: offline: a dead-pid lock and an empty lock older than 10 s are recovered; a live-pid lock fails after about 20 s; killing an execute mid-run leaves the next call working; 8 concurrent executes yield 8 distinct fix IDs; an edit of session B that lands during session A's commit of the same file is refused or kept, never reported written and then dropped, while an edit of another file is not delayed.
- Source: FIL-13.
- Scope: v1

#### FTOL-16 Retention, budgets and stale session cleanup
- Requirement: Each action first deletes the session's ticket files older than 1 h; when the session's ticket files reach 64 MiB or 384 files, completed results and pages are evicted oldest first; unfinished tickets are never evicted, and when they alone exceed the budget the call fails `private session transport budget reached by unfinished tickets; ...`; whole session directories untouched for 24 h are removed.
- Acceptance: offline: a request file aged 1 h + 1 ms is gone after the next call; 384 unfinished tickets make the next call fail with `transport budget`; a session directory last modified 25 h ago is removed by a call of another session.
- Source: FIL-17, HIS-06.
- Scope: v1

#### FTOL-17 Per-request project config, registration unaffected
- Requirement: At execution the backend loads `read_limits` through the shared config loader (M3) with root `$PASEO_HARNESS_ROOT`, else the nearest ancestor of the request cwd holding `.agents/harness-kit.json` or `.agents/harness.config.json`, else the cwd; an invalid overlay fails that call with `invalid harness config <key>: <message>` while `describe` and tool registration keep working.
- Acceptance: offline: overlay `{read_limits:{fileMaxChars:100,replyMaxChars:200}}` refuses a 150-char file naming the 100-character limit; an overlay with `typo_key` fails a read with `typo_key: unknown key` while `describe` still lists three tools.
- Source: FIL-18, P3.
- Scope: v1

#### FTOL-18 Path resolution
- Requirement: Paths resolve against the session cwd; the Git Bash form `/c/...` becomes `C:/...` on Windows; `~` and `~/x` expand to the home directory identically in plan and execution; containment uses a separator boundary and is case-folded only on Windows; existence and canonical checks use the realpath of the deepest existing ancestor.
- Acceptance: offline: a relative path and a `/c/...` path read the right file (Windows); `~/f` reads the temp-HOME file in plan and execute; on POSIX `A.txt` and `a.txt` stay distinct targets.
- Source: FIL-19, INV-33, INV-52.
- Scope: v1

#### FTOL-19 Missing-path suggestion
- Requirement: For a missing path the backend searches its file name in the nearest existing folder, then one folder up at a time while inside the session cwd; the first folder with hits decides; `node_modules` and `.git` are skipped; at most 20,000 entries are visited; name matching is case-insensitive on every platform; one hit is unique; several are listed (at most 5) by shared leading segments, then length; with no hit, up to 5 look-alike names (Levenshtein <= max(2, floor(len/4))) of the nearest existing folder are listed.
- Acceptance: offline: `specs/20-species/X.md` missing with `specs/20-creature/X.md` present -> unique; two same-named files -> both listed nearest first; a name typo lists the look-alike; `x.MD` finds `X.md` on a POSIX fixture.
- Source: FIL-20, D-44.
- Scope: v1

#### FTOL-20 Guesses only for reads, announced; mutation targets never guessed
- Requirement: `read_ranges` reads a unique guess that passes containment and permission in place, with header suffix `(read in place of <path>, which does not exist: the only file of that name nearby)`, else fails `<path>: file not found; did you mean: a | b`; `edit_multiple_files` never applies a guess: a missing path fails with a retained fix whose form carries `"path":<guess or "<corrected>">`; a folder given as edit path fails `is a folder, not a file`.
- Acceptance: offline: the wrong-folder read returns the real file with the note; the wrong-folder edit leaves the real file untouched and returns a fix form with the guessed path; sending that fix applies the edit.
- Source: FIL-21, INV-30.
- Scope: v1

#### FTOL-21 read_ranges contract
- Requirement: Input `ranges: [{path, from?, to?}]` (at least one; 1-based inclusive; omitted `from` = 1, omitted `to` = last line); `to < from` fails the entry; `to` is clamped to the file length; `from` past the end fails `<path>: line <from> is past the end (<total> lines)`; entries are independent: good entries come first, separated by a blank line, then one `ERROR <message>` line per failed entry; a call where every entry failed fails with the messages. Entry header `===== <abs> lines <from>-<to> of <total>[, tag <tag>][<guess note>]`, then lines `<n padded to the last number's width>| <text>` with CR stripped; a folder answers `<path>: is a folder; it holds N entries: <first 30>[, ...]`; the line count is newlines + 1.
- Acceptance: offline: one call with a good range, a missing path, a folder, `from` past the end and `to < from` returns the good entry then four `ERROR` lines; lines 2-9 of a 4-line file give `lines 2-4 of 4`; a file `one\ntwo\nthree\n` reads as `lines 1-4 of 4`.
- Source: FIL-22.
- Scope: v1

#### FTOL-22 Per-entry cap and per-reply budget
- Requirement: An entry whose rendered text exceeds `read_limits.fileMaxChars` is not read: `<path>: lines a-b have N characters, over the <fileMaxChars>-character limit for one entry; lines a-<fit> fit; read the part you need ...`, or, when line `a` alone is over the cap, the hint to extract the part with a script; an entry that would push the reply past `read_limits.replyMaxChars` is skipped with `<path> lines a-b: not read in this call: with it the reply would pass <replyMaxChars> characters; read it in another call` (its tag dropped) while later smaller entries are still read; path-level errors cost no budget.
- Acceptance: offline: an oversized file gives the `lines 1-K fit` text and reading 1..K succeeds; N files each at 0.9 of the cap give exactly one `not read in this call` and a later small file still reads.
- Source: FIL-23, HIS-05, INV-28.
- Scope: v1

#### FTOL-23 Read limits sized to one page
- Requirement: `read_limits` holds exactly `fileMaxChars` and `replyMaxChars` (no media keys, no `INLINE_MAX_CHARS`), shipped defaults 36,000 and 38,000; the one config validator (M3) rejects non-positive or non-integer values, `fileMaxChars > replyMaxChars` and `replyMaxChars > 40,000` (`PAGE_CHARS`); this bound replaces the legacy `< 500000` rule (D-41 removed `INLINE_MAX_CHARS`), so CONF-06 must carry it and no second validator exists; a read within the limits returns in one page.
- Acceptance: offline: shared-loader tests: `replyMaxChars` 40,000 passes, 40,001 fails, `fileMaxChars > replyMaxChars` fails, each naming `read_limits.<key>`; the backend (FTOL-17) gets the same outcome for the same overlay; a read whose reply is 37,000 chars returns without a `CONTINUATION` footer.
- Source: FIL-26, HIS-05, D-41, S-05.
- Scope: v1

#### FTOL-24 Binary files refused
- Requirement: A file whose first 8,000 bytes contain a NUL is not read as text: `<path>: not read: a binary file (<bytes> bytes), not text; open images and PDFs with the native Read tool; read other binary files with a script or a tool made for them`; an edit of such a file fails at file level; sibling entries are unaffected.
- Acceptance: offline: a PNG-header entry and a text entry in one read call yield the binary message plus the text entry; an edit of the PNG writes nothing and returns a file-level failure.
- Source: FIL-24, FIL-30, HIS-05, D-42, INV-32.
- Scope: v1

#### FTOL-25 Bounded-memory reader
- Requirement: Range reads stream the file in bounded chunks and retain only what fits the reply budget; a line longer than the budget never becomes one JS string.
- Acceptance: offline: under `--max-old-space-size=32`, a file with a 48 MiB first line and a short line 2: reading line 2 succeeds and reading line 1 reports `line 1 alone has 50,331,648 characters`.
- Source: FIL-25, INV-32.
- Scope: v1

#### FTOL-26 write_multiple_files contract
- Requirement: Input `files: [{path, content}]` (at least one); all paths are checked first; a path listed twice (case-folded on Windows) fails `<path>: listed twice`; any invalid entry means nothing is written and the result is `nothing written:` followed by the errors; parent directories are created; content is written as UTF-8 exactly as sent; the reply is one line per file `wrote <abs> (<N> chars)`.
- Acceptance: offline: two files including one in a new nested directory are written; a call with one invalid or one duplicated path writes none.
- Source: FIL-27.
- Scope: v1

#### FTOL-27 All-or-nothing commit with honest rollback
- Requirement: Changed files are staged as temps beside their targets, then renamed over them (EPERM/EBUSY/EACCES retried 5 times with 40 ms x 2^i back-off); a failed staging removes every temp and reports `nothing written: staging <path> failed: <msg>`; a failed rename restores the already replaced files in reverse order and reports `nothing written: writing <path> failed (<msg>); <k> file(s) already replaced were restored`, or `ROLLBACK INCOMPLETE, these files may hold the new text: <list>` when a restore fails; no temp file remains; POSIX mode bits of a replaced file are kept; every restored existing file gets an mtime in a later whole second than both its pre-call mtime and the replacement's (INV-54), and a failure to set it is reported as `ROLLBACK INCOMPLETE` naming the file; no result claims "nothing written" unless the rollback completed.
- Acceptance: offline: `[a.txt, <path blocked by a directory>]` leaves `a.txt` unchanged and no temp; a read-only second file (Windows) gets the first restored; a fault injected into the restore yields `ROLLBACK INCOMPLETE` naming the file; an executable file keeps its mode (POSIX); in a scratch git repo a same-size replacement rolled back within one second leaves the original bytes and `git status` agrees with `git diff --no-index` against the original (no stale stat cache).
- Source: FIL-28, HIS-91, INV-31, INV-54.
- Scope: v1

#### FTOL-28 edit_multiple_files contract and distinct result states
- Requirement: Input `files: [{path, tag?, edits: [{oldText? | from, to? | after, newText}]}]`, `fixes: [...]`, `atomic` (default false), `dryRun` (default false); at least one of files or fixes (`nothing written: give files, fixes or both`). Order: listed fixes, then `files` entries in order, then queued `{id, path}` file fixes; inside an entry, line edits before oldText edits, each edit seeing earlier output. By default matching edits commit and failures are retained. Result states are distinguishable: `edited <abs>: N edit(s)[ (k failed)], +/-d chars` or `nothing to change`; `PARTLY WRITTEN: X edit(s) written, Y failed and not written.`; `nothing written[ (atomic: true)]: N edit(s) failed. ...`; `would edit <path>: N edit(s), +d chars` and `DRY RUN, nothing written: X edit(s) would be written, Y would fail.`; report blocks `line edits whose lines had moved since their read:`, `skipped, already in the file:`, `failed:`. Replies are summaries, never diffs.
- Acceptance: offline: three edits with the middle one failing -> first and third written, reply starts `PARTLY WRITTEN: 2 edit(s) written, 1 failed`; `atomic` with one failure leaves every file unchanged; `dryRun` with one failure says `DRY RUN` and writes nothing; a successful edit of a file with 5,000-char lines replies in under 300 chars.
- Source: FIL-29, FIL-34, FIL-41 (lesson), HIS-91.
- Scope: v1

#### FTOL-29 Exact-once matching and line endings
- Requirement: An oldText edit applies only when oldText (CRLF normalised to LF) occurs exactly once in the current text; a file whose line endings are all CRLF is edited as LF and written back CRLF; a file with mixed endings is refused at file level (`mixed line endings; use native Edit`) and never normalised; a missing file fails at file level (edits never create files).
- Acceptance: offline: a two-line LF oldText on a CRLF file applies and the file stays all-CRLF; a mixed-ending file stays byte-identical and is reported; a missing file returns a file-level fix ID.
- Source: FIL-30, FIL-35.
- Scope: v1

#### FTOL-30 Failure diagnosis turns a failed edit into a one-ID retry
- Requirement: An oldText edit that does not match exactly once yields one line `<id> <path> edit <i> <oldText as JSON, cut at 60 chars>: <why> → fix: <form>` with, in order: the occurrence list `found N times (#1 line L, ...)` (form `{"id","occurrence":<1-N>}`); `the file had it before this call (line L), but an earlier edit of this call changed it; give oldText that matches the edited text`; a unique whitespace/case/look-alike match `SUGGESTED at line L, differing only in whitespace, letter case or look-alike characters: ...` or a short-stretch suggestion, both applied by `{"id"}`; else head/tail hints, plus `newText already occurs at line L: ...` when newText has >= 12 chars; otherwise the form `{"id","oldText":"<corrected>"}`.
- Acceptance: offline: whitespace, NBSP (shown as `U+00A0`), short-stretch, duplicate-line and earlier-edit-changed cases each give the stated reason and form; `{id}` on a suggestion applies it.
- Source: FIL-31, D-43.
- Scope: v1

#### FTOL-31 Fix IDs: retained, bounded, single use
- Requirement: Fix IDs are `<2 letters><n>` per session; failed edits are retained in insertion order up to 500 entries and 8 MiB serialized, oldest evicted; a single failure over 8 MiB is `not retained: this replacement exceeds the 8 MiB failure-state budget; resend a smaller edit`; an ID is consumed when its fix applies or is skipped in a committing call and survives dryRun and aborted calls; forms `{id}`, `{id, occurrence}`, `{id, oldText}`, `{id, path}`, each with optional `newText`; a fix that no longer fits is diagnosed afresh; unknown, used or foreign IDs fail `<id>: unknown fix id (or expired); ...; resend the edit`.
- Acceptance: offline: fail an edit, `{id}` applies it, a second `{id}` is unknown; a dryRun fix keeps its ID; after 600 failures 500 remain; a failure with a 9 MiB newText is `not retained` and the state stays under 8 MiB.
- Source: FIL-32, HIS-06, INV-31.
- Scope: v1

#### FTOL-32 Resent edits are skipped, never doubled
- Requirement: An edit whose newText already covers the only match of oldText is skipped as `already applied: newText already covers the only match (line L)`; signatures of the newest 2,000 committed edits per session make a resent edit whose oldText is gone a skip (`already applied: this session wrote this edit before`) while the file still holds newText (line edits: the new lines); signatures are recorded only after a real commit, never for dryRun or aborted/atomic-failed calls; an oldText the session never wrote still fails `found 0 times`.
- Acceptance: offline: `a` -> `a b` sent twice leaves `a b`; a resent `after: 0` insert is not doubled; a dryRun or atomic-aborted first send does not make a later real send look applied.
- Source: FIL-33, HIS-06, INV-31.
- Scope: v1

#### FTOL-33 Per-file independence in a batch
- Requirement: Unless `atomic`, each file of an edit batch applies or fails on its own; a file listed in two entries continues from the first entry's text (key case-folded on Windows); a file with no applied edit is not rewritten; a file-level failure (outside containment, not found, folder, binary, mixed endings) reports `<id> <path>: <reason>[; did you mean: ...] (N edit(s) not written) → fix: {"id":..,"path":...}` and retains all its edits so `{id, path}` re-runs them on the corrected path.
- Acceptance: offline: a batch of 4 files with 2 invalid applies 2 and returns 2 IDs; two entries for one file both apply; an `{id, path}` fix applies the retained edits to the corrected file.
- Source: FIL-35, HIS-07, INV-31.
- Scope: v1

#### FTOL-34 Read tags with per-line hashes
- Requirement: Each `read_ranges` entry that shows exactly `to-from+1` lines registers a session-bound tag `<run>t<n>` holding path, first line, total line count and an FNV-1a hash per shown line (CR stripped), printed in the header; the store keeps the newest 64 reads and at most 30,000 hashed lines, evicting oldest first but never the tag just issued; an entry deferred by the reply budget loses its new tag; an unknown tag fails `unknown tag <tag> (expired, or from an earlier server process); read the lines again with read_ranges`.
- Acceptance: offline: read, then a line edit with the header tag applies; the same tag from another session is unknown; a 65th read evicts the first tag.
- Source: FIL-36, HIS-06, D-43.
- Scope: v1

#### FTOL-35 Line edits never edit changed lines
- Requirement: A line edit gives `from` (with `to >= from`) to replace or `after` (0 = top) to insert, with the read tag on the file entry or fix; it applies in place when the file still has the read-time line count and unchanged hashes over the read; else a resent edit is skipped; else it applies at the unique place where the edited lines plus up to 2 context lines each side match (reported as moved); several places fail with up to 10 listed and form `{id, occurrence}`; otherwise a unique suggestion, or the current lines (<= 20) with a fresh tag, or `<lines> changed since read <tag>; read them again`. Preconditions fail with the FIL-37 texts: oldText with line numbers, missing tag, tag of another file, bad numbers, lines outside the read, empty insert.
- Acceptance: offline, each asserting file bytes: replace + top insert + delete in one entry produce the expected file; a stale tag whose read range is unchanged applies in place; lines moved +2 change only at the matched place, and the reply reports the move; a block duplicated at two places writes nothing and returns `{id, occurrence}`, after which the chosen occurrence alone changes; a changed target line leaves the file byte-identical and returns a fix with the current lines and a new tag, after which `{id, from, to}` against the new tag applies; an out-of-read range, a tag of another file and a missing tag write nothing; with `atomic: false` a sibling valid edit in the same call is written, with `atomic: true` nothing is; a CRLF file stays CRLF.
- Source: FIL-37, INV-31, D-43.
- Scope: v1

#### FTOL-36 Several line edits in one entry
- Requirement: All line edits of one entry are located against the same current text and applied bottom-up so each keeps its read numbering; at one line a replacement goes before inserts and list order is kept; an edit overlapping an earlier placed one fails `overlaps edit N <lines>; give one edit for these lines` while the earlier one is written; the same edit listed twice is skipped; moved edits are reported as `<label>: its lines had moved +k; applied from line L`.
- Acceptance: offline: edits (3-5), (5) and (after 3) in one entry: the first is written, the other two fail with `overlaps`.
- Source: FIL-38.
- Scope: v1

#### FTOL-37 Fixes of line edits
- Requirement: A retained line failure keeps path, tag, lines, newText, places, suggestion and shown lines; `{id}` applies the suggestion; `{id, occurrence}` picks a place while the count is unchanged; `{id, from/to/after}` renumbers against the shown lines or the `tag` given in the fix; `{id, newText}` overrides the text; the first-sent edit is also recorded as an applied signature; a fix for a vanished file fails `file not found any more`.
- Acceptance: offline: a stale tag with changed context -> `{id}` applies the suggestion; a changed line -> `{id, from:2, to:2}` applies against the shown lines.
- Source: FIL-39.
- Scope: v1

#### FTOL-38 Read-only role classification knows the mod tools
- Requirement: The read-only check of agent-definition tool lists (M5 prompt assembly) treats `mcp__harness-files__edit_multiple_files`, `mcp__harness-files__write_multiple_files`, `Edit`, `Write`, `MultiEdit` and `NotebookEdit` as writers and `mcp__harness-files__read_ranges` as a reader, on token boundaries; legacy `fsbatch`/`filesystem` names are not in the table; a definition without `tools` is not read-only.
- Acceptance: offline: `tools: Read, Grep, mcp__harness-files__read_ranges` -> read-only; adding `mcp__harness-files__edit_multiple_files`, also in JSON-array form -> writer; no `tools` -> not read-only.
- Source: FIL-46, D-19.
- Scope: v1

#### FTOL-39 Native tools stay untouched
- Requirement: The mod registers no native tool name, installs `tool.call` handlers only for its three tools, never fabricates native results or read state, and never denies a native tool; no kit hook, setting or provider default denies Read, Edit or Write; images, PDFs and notebooks go through native Read.
- Acceptance: offline: the registered handler matchers are exactly the three mod names; a grep gate finds no deny of Read/Edit/Write in the mod, the hook template or the defaults.
- Source: FIL-49, FIL-43, HIS-08, D-42, INV-34.
- Scope: v1

#### FTOL-40 Native-subagent guard
- Requirement: A `tool.call` event carrying `agentId` (a native Claude Code child) is refused before any check or staging with `Harness file backend is unavailable inside a native subagent: ... Use native Read/Edit/Write/Bash; these built-ins are unchanged.`; `ph` workers, which are their own sessions, use the mod normally.
- Acceptance: offline: an event with `agentId` returns the refusal and zero `process.run` calls; the same event without `agentId` proceeds.
- Source: FIL-11, INV-06.
- Scope: v1

#### FTOL-41 Per-line ending preservation for mixed-ending files
- Source: FIL-30 (alternative to the v1 refusal in FTOL-29).
- Scope: later

#### FTOL-42 Trim unused line-edit failure tiers after transcript measurement
- Source: D-43, FIL-31, FIL-37.
- Scope: later

#### FTOL-43 Image-per-turn guard as a hook if image-heavy GPT sessions return
- Source: D-42, FIL-43, HIS-05, R-13.
- Scope: later

### M8 hooks (HOOK)

#### HOOK-01 Registration template
- Requirement: `templates/settings.hooks.json` holds exactly these `type: command` entries, each `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<script>.mjs"`: PreToolUse `Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|mcp__harness-files__.*` -> `io_guard.mjs`; PostToolUse `Read|Grep|Glob|mcp__harness-files__read_ranges` -> `io_guard.mjs`; PostToolUse `*` -> `context_guard.mjs`; UserPromptSubmit (no matcher) -> `context_guard.mjs`; PreToolUse `Bash` -> `bash_long_command.mjs`; PreToolUse and PostToolUse `Edit|MultiEdit|Write|mcp__harness-files__(edit|write)_multiple_files` -> `syntax_check.mjs`. Timeouts: 10 s, except `syntax_check.mjs` 90 s. No matcher names a tool the kit does not ship (`mcp__fsbatch__`, `mcp__filesystem__`).
- Acceptance: offline: merging the template into an empty settings file yields exactly these seven entries with these matchers and timeouts; each command resolves to a shipped script under a `$CLAUDE_PROJECT_DIR` containing spaces.
- Source: HOK-01, HOK-30, D-45, D-46.
- Scope: v1

#### HOOK-02 Template is the single list of kit hooks
- Requirement: Every script referenced by the template is a shipped `.claude/hooks/*.mjs` (tests excluded) and every shipped hook script is referenced; the installer (M1) derives its managed-hook set from the template, not from a hard-coded list; no `subagent_file_tools.mjs` stub ships.
- Acceptance: offline: the set of script names in the template equals the shipped hook scripts; adding a script to the template without shipping it fails the kit consistency test; `subagent_file_tools.mjs` is absent from `kit.json`.
- Source: HOK-02, HOK-25, INS-20 (M1 reconcile).
- Scope: v1

#### HOOK-03 Project hooks coexist with kit hooks
- Requirement: Kit hooks are separate scripts identified by file name and digest; project hooks (registered by the project or its adapter) live in their own scripts and settings entries, the kit never writes, edits or removes them, and a tool call matching both a kit and a project entry runs both.
- Acceptance: offline: a fixture project with its own PreToolUse and PostToolUse hooks on the kit's matchers keeps them unchanged and unduplicated after `kit install` and `kit update`, beside one copy of each kit entry.
- Source: HOK-29, HOK-02.
- Scope: v1

#### HOOK-04 Hooks find the config by one documented root rule
- Requirement: Every kit hook computes its root as `PASEO_HARNESS_ROOT || CLAUDE_PROJECT_DIR || <hook input cwd> || process.cwd()` and loads `<root>/.agents/harness/config.mjs` through one shared discovery function, not a relative import; the overlay is `.agents/harness.config.json` only (a `.claude/harness.config.json` is ignored).
- Acceptance: offline: an installed fixture project copied to another path runs both guards from an unrelated cwd with `CLAUDE_PROJECT_DIR` set; a project with only `.claude/harness.config.json` behaves as defaults.
- Source: HOK-31, HOK-37, HOK-09, D-49, INV-09.
- Scope: v1

#### HOOK-05 Hooks never block and never fail loudly
- Requirement: Every kit hook exits 0 on every path and never emits a permission decision or `decision: block`; a configuration error writes exactly one stderr line `<hook name> unavailable: <message>` and no stdout; any other error (bad JSON, missing transcript) exits 0 silently; output, when present, is one JSON `{hookSpecificOutput:{hookEventName, additionalContext}}` (or `updatedInput` for `bash_long_command`).
- Acceptance: offline: each hook fed `{not json`, a nonexistent transcript path and a broken overlay exits 0; only the broken overlay produces one stderr line; no output of any test contains a permission decision.
- Source: HOK-09, HOK-21, INV-26, P7.
- Scope: v1

#### HOOK-06 Context guard speaks only to the main session, by role identity
- Requirement: The context guard treats a session as main only when the hook input has none of `agent_id`, `agentId`, `parent_agent_id`, the env has no `PASEO_HARNESS_LEADER` and `PASEO_HARNESS_ROLE` is not `worker`; `agent_type` is not identity; the model name plays no part.
- Acceptance: offline: a table test over `{}`, `{agent_type}`, `{agent_id}`, `{agentId}`, `{parent_agent_id}`, env LEADER and env ROLE=worker gives main, main, not, not, not, not, not; one main case with an unknown model name reminds at `start_pct`.
- Source: HOK-03, HIS-10, INV-25.
- Scope: v1

#### HOOK-07 Context usage from the transcript tail
- Requirement: The guard reads the last 1 MiB of `transcript_path`, walks lines from the end, and takes the newest entry with `type: assistant`, not `isSidechain`, no `agentId`, a `message.usage` and a model other than `<synthetic>`; used tokens = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (missing = 0; non-finite or negative skipped); window = the usage's reported context window field, else none; no such entry -> no reminder. The transcript field names are re-verified against the installed Claude Code version.
- Acceptance: offline: a transcript whose last line is a sidechain assistant with huge usage after a main line with 600,000 yields 600,000; a `<synthetic>` last line is skipped; manual: on the installed Claude Code a real transcript yields the usage `ph context --self` reports, within one turn.
- Source: HOK-04, R-04.
- Scope: v1

#### HOOK-08 Band computation
- Requirement: Window size = the reported window when finite and > 0, else `context_guard.window_tokens`; `pct = 100 * used / size`; band = -1 below `start_pct`, else `floor((pct - start_pct) / step_pct)`; a non-positive size or step, or `start_pct` outside (0, 100], throws `context_guard needs a positive window and step, and start_pct between 0 and 100`.
- Acceptance: offline: with defaults 1,000,000/60/5: 599,999 -> -1, 600,000 -> 0, 650,000 -> 1; reported window 200,000 with 120,000 used -> 0; `step_pct: 0` throws.
- Source: HOK-05.
- Scope: v1

#### HOOK-09 One reminder per band, decided atomically
- Requirement: Per session (key = sha256 of `session_id`, fallback `transcript_path`) the guard stores the last band; it reminds only when the current band is higher than the stored one, and the decision to remind is one atomic filesystem operation (exclusive create or rename), with no PID or mtime claim recovery; any downward move lowers the stored band (below `start_pct` resets it to -1), so a later climb reminds again; state files older than 24 h are pruned. A crash between decision and output loses at most that one reminder.
- Acceptance: offline: 6 concurrent hook processes at band 0 produce exactly one reminder; usage 650,000 -> reminder, again -> silent, 610,000 then 650,000 -> reminder again, 1,000 then 600,000 -> reminder again; a planted claim file containing `{"pid":"x"}` does not silence the next band.
- Source: HOK-06, HOK-07, HOK-36, D-50, S-06.
- Scope: v1

#### HOOK-10 Reminder text points to self-compaction
- Requirement: The reminder is one `additionalContext` line, not a notification and never a forced compaction: `Context guard: this main session uses <pct>% of its context (<used>/<window> tokens; threshold <start_pct>%). At the next natural break (no edit half-done, no background job or Monitor still running), compact yourself: run \`node .agents/harness/ph.mjs compact-self --focus "<what to keep>"\` and end the turn. You will be reminded again at the next <step_pct>% step.`; the compaction itself, its success measure and the resume text are `ph compact-self` (M5); native autocompact is not touched.
- Acceptance: offline: at 650,000/1,000,000 the output matches `65%` and `650000/1000000` and contains `ph.mjs compact-self --focus`; with a reported window of 200,000 and 120,000 used it contains `120000/200000`; the command path in the text exists in an installed fixture project.
- Source: HOK-08, HOK-12, INV-24.
- Scope: v1

#### HOOK-11 context_guard settings
- Requirement: `context_guard` (merged key) has exactly `window_tokens` (default 1,000,000, >= 1), `start_pct` (default 60, 1..100) and `step_pct` (default 5, 1..100), all integers; a project overlay may override single fields (e.g. `start_pct: 45`); no `model_pattern` key exists.
- Acceptance: offline: overlay `{context_guard:{start_pct:45}}` merges with the default step; `start_pct: 0` or `101` and `context_guard.model_pattern` fail validation naming the key.
- Source: HOK-10, HIS-11, D-48.
- Scope: v1

#### HOOK-12 Context guard on every tool call stays cheap
- Requirement: With matcher `*`, the guard checks identity first and returns before reading config, transcript or state for any non-main session; the kit ships a benchmark that measures hook wall time over a 1 MiB transcript.
- Acceptance: offline: a worker-env and a child-input run perform no read of the transcript or the overlay (spy on the injected fs); the benchmark reports p50/p95 wall time and p95 stays under 1 s on the owner's Windows machine (manual record), far below the 10 s timeout.
- Source: HOK-11, D-51.
- Scope: v1

#### HOOK-13 io guard tool sets
- Requirement: The io guard classifies tools as LOOKUP (`Read`, `Grep`, `Glob`, `mcp__harness-files__read_ranges`), MUTATING (`Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `mcp__harness-files__edit_multiple_files`, `mcp__harness-files__write_multiple_files`) and RESULT (`Grep`, `Glob`); one table holds the names and their path fields; any other tool exits 0 with no output.
- Acceptance: offline: calls of `Bash` and `mcp__fsbatch__read_ranges` give empty stdout and exit 0; each listed tool reaches its branch.
- Source: HOK-13.
- Scope: v1

#### HOOK-14 Rounds read from the transcript
- Requirement: The io guard reads the last 1 MiB of the transcript, skips `isSidechain` and `isMeta` entries, starts a new prompt at each real user prompt (prompt key = `uuid ?? timestamp ?? line index`, initial `tail-start`), and groups the `tool_use` blocks of one assistant `message.id` into one round; a round is finished when every tool use has a result; unfinished (in-flight) rounds never count as previous rounds, but their file calls are summed; rounds with neither tool kind are skipped by the lookup streak and break the edit streak. The schema is re-verified on the installed Claude Code.
- Acceptance: offline: START-1 finished lookup rounds plus an in-flight round of 2 parallel calls report round START, not START+1; manual: on a real transcript of the installed version, parallel calls of one message form one round.
- Source: HOK-14, R-04.
- Scope: v1

#### HOOK-15 First file round of a prompt
- Requirement: On PreToolUse, when no finished round of the current prompt has a lookup or mutating call, the guard claims `first|<promptKey>` and, unless 2 or more file calls are already in flight, speaks the first-lookup (planning) or first-edit text; said once per prompt.
- Acceptance: offline: the first Grep of a prompt gets the planning text once; a second run for the same prompt is silent; an in-flight round of Grep+Glob suppresses it; the next prompt speaks again.
- Source: HOK-15.
- Scope: v1

#### HOOK-16 Lookup streak
- Requirement: For a lookup call, n = finished lookup rounds walking back to the first mutating round, + 1; band = -1 below `io_guard.start_rounds`, else `floor((n - start_rounds) / step_rounds)`; the guard speaks `this is lookup round <n> in a row with nothing edited in between` once per band per segment (segment = count of mutating rounds) through claim `lookup|<promptKey>|<segment>|<band>`.
- Acceptance: offline: START-1 prior lookup rounds -> text names round START; START-2 -> silent; one band is spoken once; an edit round or a new prompt resets.
- Source: HOK-16.
- Scope: v1

#### HOOK-17 Edit streak
- Requirement: For a mutating call, n = directly preceding finished rounds that are mutating with no lookup, + 1 (any other round ends the run); band from `edit_start_rounds`/`edit_step_rounds`; the guard speaks `this is edit round <n> in a row with nothing looked up in between`, suggesting one batch edit/write call, once per band through claim `edit|<promptKey>|<run start>|<band>`.
- Acceptance: offline: ESTART-1 preceding edit rounds -> text names round ESTART; a Bash or lookup round in between breaks it.
- Source: HOK-17.
- Scope: v1

#### HOOK-18 Re-read of a file edited in this prompt
- Requirement: For a lookup call, files edited by finished rounds of the current prompt (`file_path` of Edit/MultiEdit/Write, `notebook_path` of NotebookEdit, `files[].path` of the two mod write tools, plus every `edited <abs>` and `wrote <abs>` line of their tool results, which covers fix-only calls such as `fixes:[{id}]`) intersected with the files read (`file_path` of Read unless `limit` is 1, `ranges[].path` of `read_ranges`), paths normalised (backslashes, relative to hook cwd, dot segments, lower case), give the reread text once per file set: `<files> was edited earlier in this task. Edit and Write error when a change fails, so do not re-read the file to verify it; run the checks the task names. Read it again only for parts you have not seen yet.`; edits before the last user prompt do not count.
- Acceptance: offline: edit `C:\Work\Spec.md`, then Read `c:/work/spec.md` -> flagged; `limit: 1` -> silent; `./sub/../Spec.md` with cwd `C:\Work` -> flagged; a `read_ranges` of a file written by `write_multiple_files` -> flagged; a `read_ranges` of a file changed by a fix-only `edit_multiple_files` call (`fixes:[{id}]`) -> flagged.
- Source: HOK-18.
- Scope: v1

#### HOOK-19 Empty or truncated search results
- Requirement: On PostToolUse of a RESULT tool the guard speaks `truncated` when the response has `truncated: true` or its last 600 chars match `(Showing N of M` / `more are not listed` / `with pagination = limit`, else `empty` when the response reports zero files with no content or a short text with `No files found`/`No matches found`; content-mode Grep with content is not empty; no claim (speaks on every such result); Read results are ignored; the response shapes are re-verified on the installed Claude Code.
- Acceptance: offline: `No matches found`, `{numFiles:0, filenames:[]}` -> empty; content-mode with content -> silent; a list ending `(Showing 100 of 257 ...)` -> truncated.
- Source: HOK-19, R-04.
- Scope: v1

#### HOOK-20 Claims dedupe parallel hooks
- Requirement: A claim is an exclusive-create file named by a hash of the claim key in `<tmpdir>/ph-io-guard-<sha256(session_id) first 24 hex>/`; creating it is permission to speak, any error means silence; claims older than 24 h are pruned; a process that dies after claiming loses that one reminder (documented, no recovery).
- Acceptance: offline: 6 concurrent hook processes on the same payload produce exactly one non-empty output; two sessions whose ids share their first 8 chars do not silence each other.
- Source: HOK-20, HOK-35.
- Scope: v1

#### HOOK-21 io guard dispatch and stacked output
- Requirement: Event = `hook_event_name`, else PostToolUse when `tool_response` is present, else PreToolUse; PostToolUse needs no transcript or config; PreToolUse without `transcript_path` exits 0 silently; PreToolUse messages are joined in the fixed order first-round, lookup streak, edit streak, reread into one `additionalContext`.
- Acceptance: offline: a lookup of a file edited earlier at round START yields the streak text then the reread text joined by a newline; a payload without `transcript_path` gives empty stdout and exit 0.
- Source: HOK-21, HOK-35.
- Scope: v1

#### HOOK-22 io_guard settings
- Requirement: `io_guard` (merged key) has exactly `start_rounds`, `step_rounds`, `edit_start_rounds`, `edit_step_rounds`, defaults 2/2/2/2, all non-negative safe integers, the two steps >= 1; unknown nested keys fail.
- Acceptance: offline: overlay `{io_guard:{start_rounds:3}}` merges; `step_rounds: 0`, `start_rounds: -1` and `io_guard.foo` each fail naming the key; `start_rounds: 0` is accepted.
- Source: HOK-22.
- Scope: v1

#### HOOK-23 Reminder texts name only shipped tools
- Requirement: Every io guard text starts with `File I/O (AGENTS.md): ` and is at most three sentences (the reread text of HOOK-18 is the longest); tool names in any hook text are only native Claude Code tools and the three `mcp__harness-files__` tools; the batch advice names the mod tools as "when the harness-files tools are available, else native Read/Edit".
- Acceptance: offline: each of the seven texts begins with the prefix, has at most three sentences, and every tool-like token it contains is in the allowed list.
- Source: HOK-23, INV-49.
- Scope: v1

#### HOOK-24 io guard and the AGENTS.md File I/O rules agree
- Requirement: The kit AGENTS.md block carries the five File I/O rules (Grep for content and Glob for names, combined; read relevant parts and batch known targets; batch related edits, whole-file writes for new files; no re-read to verify a successful write; correctness over fewer calls) once; each io guard reminder kind restates one of them.
- Acceptance: offline: a fresh install has the five rules once in AGENTS.md and an update does not duplicate them; a test maps each reminder kind to its rule.
- Source: HOK-24.
- Scope: v1

#### HOOK-25 io guard runs in all sessions
- Requirement: The io guard applies to main sessions, `ph` workers and any other session loading the project settings; it does no identity check.
- Acceptance: offline: the same synthetic transcript yields the same reminder with a main-session env and with `PASEO_HARNESS_ROLE=worker`.
- Source: HOK-32, D-47.
- Scope: v1

#### HOOK-26 Syntax shell reports only newly broken files
- Requirement: `syntax_check.mjs` collects targets from `file_path`, `files[].path` and `path` of the tool input (resolved against the hook cwd, deduped) and, in PostToolUse of the two mod tools, from every `edited <abs>`/`wrote <abs>` line of `tool_response` (fix-only calls carry no paths in their input; the hook never reads M7 private state), skips extensions with no configured checker before spawning anything; PreToolUse checks each target and stores per-file status under the tmp dir keyed by session and `tool_use_id`; PostToolUse checks again and reports, as `additionalContext`, only files that passed before and fail after, or new files that fail, with up to 6 `file:line:col: message` lines each; a Post target without Pre status (fix-only call) that fails is reported marked `(not checked before this edit)`; it never blocks. Checker outcomes: exit 0 = pass; non-zero with at least one diagnostic line = fail; spawn error (missing executable), timeout, or non-zero without a diagnostic line = infrastructure error, never reported and never cached. The kit ships no checker.
- Acceptance: offline (fake checker): a file edited from valid to invalid is reported once; invalid before and after is silent; a new invalid file is reported; a fix-only `{id}` call that breaks a file is reported with the marker; a missing executable, a hanging checker and a checker exiting 2 without diagnostics are silent and the hook exits 0; an extension without a checker spawns nothing.
- Source: HOK-26, HIS-04, D-45, INV-27, D-110, ADPT-06.
- Scope: v1

#### HOOK-27 Syntax shell budget, slots and cache
- Requirement: The shell has a hook-wide budget of 75 s from process start (below its 90 s registration timeout); a checker run starts only with at least 10 s left, leftover files are skipped; each checker run is bounded by min(its `timeout_s`, remaining budget) and its process tree is killed at the bound; each checker has a machine-wide slot cap (`max_parallel` of ADPT-06, default 3; slot locks stale after 180 s, wait up to 20 s or the remaining budget, busy -> skip silently); results are cached under a key of owning tree root, target path, checker identity (argv, `timeout_s` and the sha256 of the tree's `adapter.syntax_checkers` entry) and content hash, so a changed checker configuration invalidates its entries; only pass and fail are cached, never skips or infrastructure errors; Pre state files are removed in Post and pruned after 24 h.
- Acceptance: offline: two concurrent runs with slow fake checkers never exceed 3 running checks; a batch of 40 files returns before 75 s with the rest skipped; a second check of identical content in the same tree hits the cache; identical bytes in two worktrees with different fake checkers are checked by each; changing one tree's checker argv invalidates its cached result; a leftover Pre file older than 24 h is pruned.
- Source: HOK-27, HOK-30, INV-27.
- Scope: v1

#### HOOK-28 Checker resolved from the edited file's tree
- Requirement: For each target the shell reads the checker for its extension from `adapter.syntax_checkers` of the config of the tree that holds the file (nearest ancestor with `.agents/harness.config.json`, e.g. a worktree), not the session cwd; targets in different trees use their own trees' checkers; the entry shape is ADPT-06 (`{<extension>: {argv, timeout_s, max_parallel}}`); the shell runs `argv` without a shell, with cwd = the owning tree root and the absolute file path appended as one argument (spaces kept), and parses diagnostics as `file:line:col: message` lines.
- Acceptance: offline: an edit inside a fixture worktree whose config names a different fake checker runs that checker while cwd is the main tree; a batch spanning two trees runs each tree's checker; a target path with spaces reaches the fake checker as one argument.
- Source: HOK-27, HIS-04, D-45, INV-27, ADPT-06.
- Scope: v1

#### HOOK-29 Registration lint
- Requirement: A kit test fails when a registered hook's timeout is not larger than its internal budget, or when a matcher names a tool outside the native tools and the three mod tools.
- Acceptance: offline: the lint passes on the shipped template and fails on a copy with syntax timeout 60 s or with an `mcp__fsbatch__` matcher.
- Source: HOK-30.
- Scope: v1

#### HOOK-30 Windows long-command rescue
- Requirement: `bash_long_command.mjs` acts only when `process.platform === 'win32'` and the tool is Bash with a string command; when `length + 3 x count(')` exceeds 6,000 or the command contains `\\`, it writes the command (CRLF -> LF, trailing newline) to `<tmpdir>/claude-bash-commands/<hash>-<pid>.sh`, prunes files older than 1 day and returns `updatedInput` with `command: source '<path>'` (forward slashes, quote-escaped), other input fields kept; otherwise no output; never blocks.
- Acceptance: offline (platform injected): a 9,000-char command and a command with `\\` are rewritten and the script equals the original; a short command and any non-win32 run give no output; manual: on Windows a 9,000-char heredoc command through Claude Code runs unaltered.
- Source: HOK-28, D-46, INV-52.
- Scope: v1

#### HOOK-31 Hook tests offline
- Requirement: Hook tests use synthetic transcripts, injected env and state dirs, and real concurrent process spawns for dedupe; identity is tested by role with one model, not a model matrix; no test touches the owner's Claude config or tmp state of real sessions.
- Acceptance: offline: the hook suite runs under `tests/` with a temp `TMPDIR` and temp `CLAUDE_CONFIG_DIR` and passes; a grep gate finds no real home path in the tests.
- Source: HOK-34, INV-57.
- Scope: v1

#### HOOK-32 Narrow the context guard matcher if measured cost demands
- Source: D-51, HOK-11.
- Scope: later

### M13 ui: Paseo plugins (PANL)

#### PANL-01 Plugin layout, manifest and pinned toolchain
- Requirement: The kit ships two Paseo plugins in `plugins/planning-panel` and `plugins/swarm-map` (not installed into projects), each with `paseo-plugin.json` (`id` = directory name, `description`, `requirements.paseo` set to the Paseo version the kit was tested with), `package.json` whose `files` lists only existing entries, two entry files, `shared/` zod contracts, `server/`, `client/`, and dev dependencies pinned to the installed Paseo's toolchain (`@getpaseo/plugin`, react, react-native, `@tanstack/react-query`, zod, typescript, `@types/node`); tsconfig strict, noEmit.
- Acceptance: offline: a test checks id = directory, every `files` entry exists and `@types/node` is present in both; `tsc --noEmit` passes in both plugins; manual: `paseo plugin install` + `paseo plugin ls` show both `running`.
- Source: UI-01, D-102, R-14.
- Scope: v1

#### PANL-02 Entry points
- Requirement: Each server entry default-exports `contribute(server)` that registers its handlers and lifecycle subscriptions and returns a disposer unsubscribing every hook; the planning panel's client registers one sidebar surface (project picker + panel), one workspace panel and one command-center item `Open Planning`; the swarm map's client registers surface `swarm` and a sidebar item.
- Acceptance: offline (fake host): the registrations happen with these ids; calling the disposer leaves zero subscriptions; manual: after `paseo plugin reload` the swarm feed shows no duplicate events.
- Source: UI-02, UI-06.
- Scope: v1

#### PANL-03 RPC contracts
- Requirement: Every RPC is defined once in `shared/` with `defineRpc({name, input, output})` and zod schemas, used by both `server.handle` and client `useRpc`; names match `^[a-z][a-z0-9._-]*$`: `planning.index`, `planning.board`, `planning.plan`, `planning.file`, `swarm.snapshot`, `swarm.agent-detail`.
- Acceptance: offline: a contract test asserts every name matches the regex and every handler output on fixtures parses with its output schema.
- Source: UI-03, INV-56.
- Scope: v1

#### PANL-04 Typed failure envelopes
- Requirement: Every RPC handler of both plugins returns `{ok:true, ...}` or `{ok:false, code, message, directory|null}` and never throws; `planning.*` codes are `no_planning | unreadable | parse_error | not_found | failed`, `swarm.*` codes are `not_found | failed` (recoverable partial snapshot errors stay in the success payload, PANL-43); an untyped error maps to `failed`; the client renders transport error, `ok:false` (`no_planning` as a muted empty state with a hint), loading, empty and filter-empty states.
- Acceptance: offline: `planning.index` in a workspace without `.planning/` returns `{ok:false, code:"no_planning"}`; a handler whose reader throws returns `failed` with the message; a `swarm.snapshot` whose SDK fake throws unexpectedly and a `swarm.agent-detail` whose timeline read fails both return parseable `ok:false` envelopes that the surface and the inspector render.
- Source: UI-04, UI-11, INV-56.
- Scope: v1

#### PANL-05 Plugins are read-only observers
- Requirement: Neither plugin sends prompts, spawns, archives, cancels or changes agents, writes files or runs a subprocess; `.planning/` is read with `node:fs` only, so nothing depends on the daemon's PATH; the only client actions are navigation and copy id/path.
- Acceptance: offline: a grep gate over both plugins finds no write/spawn/archive/send SDK call, no fs write API and no `child_process`; manual: the panel works under a daemon whose PATH lacks npm and node.
- Source: UI-55, UI-61 (lesson), D-101, INV-56.
- Scope: v1

#### PANL-06 React Native primitives, theme text colours
- Requirement: Client code uses only React Native primitives and host components from `@getpaseo/plugin/client/react-native` (no DOM elements, no SVG, no `document`); text colours come only from `theme.colors`; fixed hues only for decorative dots, rings and glows; progress rings are drawn without SVG.
- Acceptance: offline: a lint/grep gate over `client/` finds no `<div`, `<svg`, `document.` and no literal colour in a `Text` style.
- Source: UI-08, UI-47.
- Scope: v1

#### PANL-07 Polling with cheap server work
- Requirement: Plugins poll (no push): `swarm.snapshot` every 1 s, `swarm.agent-detail` every 1.5 s while an agent is selected, `planning.*` lists every 5 s with server results cached by file mtime; planning queries keep previous data and show `Reconnecting` on refetch error; the swarm surface shows `offline` and `Snapshot failed: <msg>`; both recover after a daemon restart without a reload.
- Acceptance: offline: two `planning.index` calls with unchanged mtimes read no file body the second time; manual: stopping and restarting the daemon shows the failure states and then recovers.
- Source: UI-07, INV-56.
- Scope: v1

#### PANL-08 Plugin docs describe `ph` only
- Requirement: Each plugin README gives the operator steps (`npm install`, typecheck by `node node_modules/typescript/bin/tsc --noEmit`, `paseo plugin install|reload|ls|logs`, `pluginsEnabled` set by `kit machine apply --enable-paseo-plugins`) and describes agents, labels and titles as stamped by `ph`; no doc or comment references `paseo_tool.py`, `paseo.md`, `paseo.sh`, temp-dir runs or a preview/sim harness.
- Acceptance: offline: a doc lint finds no reference to a file absent from the repo and none of the listed names.
- Source: UI-09, UI-58, D-99, D-104.
- Scope: v1

#### PANL-09 Enabling only by explicit machine opt-in
- Requirement: The plugins are enabled only by `kit machine apply --enable-paseo-plugins` (M2): it sets `pluginsEnabled: true`, registers each plugin as `{source:'directory', path:<kit>/plugins/<id>, enabled:true}`, keeps a user entry that points elsewhere (reported `conflict Paseo plugin <id>: user entry kept`), installs dependencies when `node_modules` is missing, and prints `paseo plugin reload <id>` (MACH-15 owns the step); without the flag `pluginsEnabled` and `plugins` stay JSON-equal and no npm or plugin install runs, while the other machine steps proceed; no Backlog plugin, Backlog CLI pin or Backlog check ships.
- Acceptance: offline (fixture Paseo config needing a provider-policy update): apply without the flag makes the provider change, leaves `pluginsEnabled` and `plugins` JSON-equal and calls no fake npm; with the flag both entries are added and a user entry pointing elsewhere is kept with the conflict line.
- Source: INS-47, UI-79, HIS-77, D-96, MACH-15.
- Scope: v1

#### PANL-10 Paseo SDK and icon dependencies re-verified
- Requirement: The SDK calls and fields the plugins use (`agents.list`, `agents.ref().timeline.refetch`, `agents.ref().refresh`, `workspaces.ref().current/refresh/directory`, client `workspaces.list`, the listed agent fields, timeline item types and lifecycle events) and every lucide icon name are checked against the installed Paseo by a smoke script.
- Acceptance: manual: the smoke script against a live daemon calls each method once and asserts the fields exist, and resolves every icon name used; it is re-run on each Paseo upgrade.
- Source: UI-05, UI-52, R-14.
- Scope: v1

#### PANL-11 Workspace directory resolution
- Requirement: Every `planning.*` RPC takes `{workspaceId}` and resolves the directory as `current() ?? await refresh()`, then `workspaceDirectory ?? directory`, else `Workspace <id> has no directory`; failures return the envelope with the directory resolved so far.
- Acceptance: offline (fake SDK): an unknown workspace id returns `ok:false` with the message and never throws.
- Source: UI-62.
- Scope: v1

#### PANL-12 `.planning/` index
- Requirement: `planning.index` finds `<workspace>/.planning` (absence -> `no_planning`), walks it without following symlinks, with a cap of 5,000 files, and indexes every file by its relative `/` path with kind (by GSD filename) and mtime; frontmatter is read from the first 4,096 bytes and, when the closing `---` is not there, onward up to 64 KiB (beyond: that file is `parse_error` `frontmatter over 64 KiB`); files are read in batches of 48; the listing is redone on every poll and only changed mtimes are reparsed. The index carries `scope` `complete | truncated | unreadable` (cap exceeded: `truncated` with the counted total; an unreadable file or directory: `unreadable` naming it).
- Acceptance: offline: a fixture `.planning/` with 200 plan files indexes all with correct kinds and `scope: complete`; a second call with unchanged mtimes rereads nothing; a file added and one deleted between polls are reflected; 5,001 files give `scope: truncated`; frontmatter ending after byte 4,096 parses; an unreadable phase directory gives `scope: unreadable`; a symlink loop is not followed.
- Source: UI-65, UI-64 (analogue), D-96, INV-36.
- Scope: v1

#### PANL-13 Paths stay inside `.planning/`
- Requirement: A client-supplied path is resolved inside `<workspace>/.planning/`; an absolute path, a `..` segment or a symlink escaping the folder is refused with `not_found`.
- Acceptance: offline: `planning.file` with `../secret`, an absolute path and a symlink pointing outside each return `not_found` and read nothing outside `.planning/`.
- Source: UI-65, SYNTHESIS M13, INV-56.
- Scope: v1

#### PANL-14 Frontmatter parser, tolerant normalization
- Requirement: The server parses frontmatter with the GSD grammar of GSDC-05 (block maps and sequences, flow collections, quoted and plain scalars, `|`/`>` blocks, comments, BOM/CRLF), as the same module or a port proven by GSDC-05's conformance fixtures; nested values (`must_haves.truths/artifacts/key_links`, `key-files.created/modified`, `requires`, `gaps`) reach detail responses intact; a parse error yields `parse_error` with its line for that file only, never a silent field drop; missing optional fields default via `nullish().transform`; other top-level fields are shown as properties (at most 12). The reader adapts to GSD files; GSD templates and method text are not changed for it (D-111).
- Acceptance: offline: the GSDC-05 fixtures (PLAN with nested `must_haves`, SUMMARY with `key-files` and a block scalar, VERIFICATION with `gaps[]`, malformed cases) parse to the same JSON as `ph gsd`; a plan missing optional keys still lists with defaults; one malformed file does not fail the index.
- Source: UI-66, UI-63, GSDC-05, D-111.
- Scope: v1

#### PANL-15 Phase and plan board by the GSD status ladder
- Requirement: `planning.board` returns phases with status computed by the same ladder as `ph gsd` (plan/summary counts, verification status, completion; ROADMAP checkboxes carry no authority) and plans per wave with done counts (a plan is done when its SUMMARY exists, per its `status`); the board columns follow the ladder order (empty columns kept), and the per-phase wave progress replaces the dropped run cards; status tones come from an explicit status -> tone map; the board carries the index `scope`, and every percentage is `null` when scope is not `complete`.
- Acceptance: offline: on a fixture `.planning/` with one phase in each ladder state, the board statuses equal the statuses of `ph gsd roadmap analyze`; a phase with 2 of 4 plans summarised in wave 1 shows 2/4; with `scope: truncated` the board shows no percentage.
- Source: UI-74, UI-77, D-96, INV-43, INV-36.
- Scope: v1

#### PANL-16 Plan detail
- Requirement: `planning.plan {workspaceId, planId}` returns goal, the tasks of the PLAN's `<task>` elements in order (name, type, files), `must_haves`, wave, dependencies, files touched and plan-level completion from its SUMMARY (absent -> not done; present -> its `status`, e.g. `complete` or `halted`, with the SUMMARY text and `key-files`); per-task completion is not invented: no artifact records it, so tasks carry no done state and no task percentage is shown; the pane has back, copy id, copy path and close; it renders a body only when the returned workspaceId, relative path and plan id all equal the requested ones (previous data kept while loading).
- Acceptance: offline: on artifacts produced by the M9 fixtures, a plan without SUMMARY shows not done, one with a `halted` SUMMARY shows halted, and no task percentage appears; component test: opening plan A then B with B delayed shows the loading state for B, never A's body; switching from the main checkout to a worktree with the same plan id and different content, with the second response delayed, never shows the old body.
- Source: UI-76, UI-81, GSDC-18.
- Scope: v1

#### PANL-17 File tree and reader
- Requirement: The Files section builds a tree from relative paths (single-child folder chains merged, natural sort, folder counts, top-level expanded, expand/collapse all, opening a file reveals its ancestors), filters locally by AND-tokens over path and title, and reads a file through `planning.file` with frontmatter properties, markdown body and copy path; the reader applies the same workspaceId + path equality guard as PANL-16.
- Acceptance: offline: `buildTree(["a/b/c.md","a/b/d.md","e.md"])` yields folder `a/b` (2) then `e.md`; filter `plan 03` matches path tokens in any order.
- Source: UI-73, UI-67, UI-81.
- Scope: v1

#### PANL-18 Markdown renderer
- Requirement: A library-free renderer supports headings 1-6, paragraphs, fenced code, nested bullet/numbered lists (depth <= 3) with checkboxes, blockquotes, rules and pipe tables; inline code, bold, italic, links and bare http(s) URLs; ids of phases, plans and requirements known in the index become tappable links; Markdown links and code spans holding a path open the in-panel reader when the path, resolved against the containing file's directory (or against the workspace root when it starts with `.planning/`), names an indexed file inside `.planning/` (PANL-13 containment), else stay plain text; only http(s) links open externally, via `openExternalUrl`; text is selectable; no HTML, no images.
- Acceptance: offline: parser unit tests per block type; a known plan id in prose becomes a link, an unknown id stays text; a `javascript:` link does not open; in a plan, `[s](01-01-SUMMARY.md)` opens the summary in the reader, a link to a missing file and `../../secret.md` stay plain text.
- Source: UI-72, UI-65.
- Scope: v1

#### PANL-19 Stats tiles
- Requirement: A pure `computeStats(index, nowMs)` gives phase progress, plans per wave, plans with a SUMMARY by `status`, files updated per day over 14 days (from mtimes) and blocked plans (unmet dependency); no task-level count is derived; when the index `scope` is not `complete` every percentage is `null`; the view shows tiles, bars and the day chart.
- Acceptance: offline: a fixture with 2 complete and 3 open phases returns done 2, open 3; a plan depending on an unfinished plan counts as blocked; the same fixture with `scope: truncated` returns null percentages.
- Source: UI-75, INV-36.
- Scope: v1

#### PANL-20 Project picker
- Requirement: Workspaces are grouped by project, archiving ones dropped; the representative is the main checkout (`local_checkout` < `directory` < `checkout` < `worktree`, then pinned, then name), with a switcher to the project's worktrees; the 5 most recent projects are kept (MRU) per host and survive surface remounts; the picker shows only with more than one project and searches name and root path by AND-tokens.
- Acceptance: offline: a checkout and a worktree of one project give one entry with 2 workspaces and the checkout as default; the switcher lists the worktree; leaving and returning to the sidebar keeps the selection.
- Source: UI-68, UI-69, D-98.
- Scope: v1

#### PANL-21 Workspace panel navigation
- Requirement: The panel has section tabs (Roadmap, Phases, Files); a trail of opened items (select resets, link pushes without duplicate, back pops); split view (list + detail) when not compact and width >= 960, else detail replaces the list with Back; a 30 s tick for relative times; a refresh button with `Live · HH:MM:SS` or `Reconnecting`.
- Acceptance: component test: open A, follow a link to B, Back returns to A; Close in wide layout clears the trail; compact layout shows no split.
- Source: UI-70, UI-78, UI-54.
- Scope: v1

#### PANL-22 UI kit primitives
- Requirement: The planning panel carries the kit primitives (`KitProvider/useKit`, text `T`, `Press`, `Section`, `MetaRow`, `Dot`, `Badge`, `ProgressBar`, `SegmentedBar`, `Chip`, `IconButton`, `ActionButton`, `StatePanel`, `withAlpha`), without `AvatarStack`.
- Acceptance: offline: `withAlpha("#fff", 0.5)` -> `rgba(255, 255, 255, 0.500)`; a non-hex input is returned unchanged.
- Source: UI-71.
- Scope: v1

#### PANL-23 Format helpers
- Requirement: Shared helpers: `formatDate`, `formatShortDate` (date-only strings as local dates), `formatRelative` (`just now`, `Nm ago`, `Nh ago`, `Nd ago` under 14 days, else a date), `formatClock`, `ago`, `clock`, `tokens` (`?`, `1.5M`, `12k`), `shortModel` (provider stripped, `[1m]` -> ` [1m]`), `baseName`, `clip` (whitespace collapsed, `…`), and title helpers that take the swarm name from the `ph.swarm` label.
- Acceptance: offline: unit tests per helper, including `formatRelative` at 59 s, 60 s, 13 d and 14 d and `shortModel("circle/gpt-6.1-sol[1m]")`.
- Source: UI-77, UI-53.
- Scope: v1

#### PANL-24 swarm.snapshot contract
- Requirement: Input `{recentHours >= 0, afterSeq int (-1 first), eventEpoch string|null}`; success output `{ok:true, generatedAt, brains[], standaloneCount, eventEpoch, files[], events[], lastSeq, errors[]}` (failure per PANL-04) with `brains[] = {agent|null, groups:[{name, agents[], wave|null}]}` (`wave` per PANL-61) and `SwarmAgent = {id, title, model, thinking, mode, status, contextPct, usedTokens, maxTokens, rotatePct, attention, parentId, swarm, project, createdAt, updatedAt, turnStartedAt, activity, heldFiles}` (`rotatePct` per PANL-55); no `runs`, `tempDir` or `runMaxAgeHours`.
- Acceptance: offline (fake SDK): every snapshot parses with the schema; a poll with `afterSeq = lastSeq` and the same epoch returns `events: []`; the client cursor reads `lastSeq` and `eventEpoch` only from `ok:true` responses.
- Source: UI-10, D-96, D-97.
- Scope: v1

#### PANL-25 swarm.agent-detail
- Requirement: Input `{agentId}`; success output `{ok:true, recent: Activity[] (newest first, no reasoning, max 8), lastCommand: {text, at}|null, lastReply: {text, at}|null}` from the activity cache; an agent never read gets one timeline read; a read error returns `{ok:false, code:'failed', message}` and an unknown agent `{ok:false, code:'not_found', ...}`, both shown in the inspector; the handler never throws.
- Acceptance: offline: an idle agent never read before returns its recent actions after one timeline read; a failing timeline read surfaces its error text.
- Source: UI-11.
- Scope: v1

#### PANL-26 Agent listing and mapping
- Requirement: Agents are listed with `includeArchived:false`, statuses initializing/idle/running/error, `created_at asc`, 200 per page, at most 5 pages; entries with `archivedAt` are skipped; title falls back to the id's first 8 chars; `model = provider/model`; `contextPct` only when used and max are known and max > 0; attention = `permission` when a permission is pending, else the attention reason when attention is required.
- Acceptance: offline: 3 live, 1 archived and 1 closed agent give exactly the 3 live ones; an agent without usage has `contextPct: null`.
- Source: UI-12.
- Scope: v1

#### PANL-27 Brains, closed parents and orphans
- Requirement: A subagent links to its brain through label `paseo.parent-agent-id` (written last by `ph`, so a caller label cannot override it); parents missing from the live list are refreshed concurrently and cached 30 s (null results too); a missing, archived or failing parent puts its children in the orphan bucket (`agent: null`); a closed brain with live subagents is drawn asleep as their root; brains with a running member sort first, the orphan bucket last.
- Acceptance: offline: archiving the parent of two live subagents moves them to `agent: null`; a closed parent is drawn as a sleeping brain; a fake caller label `paseo.parent-agent-id=x` on a `ph`-created fixture agent is not what the snapshot uses.
- Source: UI-13, UI-80, D-100, INV-10.
- Scope: v1

#### PANL-28 Grouping by the `ph.swarm` label
- Requirement: Subagents of a brain are grouped by the `ph.swarm` label stamped by `ph`; without it the fallback is `swarmName(title)`: `(untitled)` for empty, the prefix before a `#n`/`n` counter suffix, else the text before the first `:`, else the first word; grouping never depends on the 60-char title cut.
- Acceptance: offline: two agents with label `ph.swarm=planners` and different long titles share one group; label-less titles `Fix A`, `Fix B` share `Fix`; `review #3` groups as `review`.
- Source: UI-33, UI-80, D-100.
- Scope: v1

#### PANL-29 Standalone agents counted, not drawn
- Requirement: Agents with no parent and no children are not drawn; their count (taken before the recent filter) is `standaloneCount` and the footer says `N agents without parent or subagents are not drawn`.
- Acceptance: offline: one lone agent increments `standaloneCount` and appears in no brain.
- Source: UI-14, D-103.
- Scope: v1

#### PANL-30 Active-6h filter
- Requirement: With `recentHours > 0` a brain is kept only when a member is running/initializing, has a pending permission or was updated within `recentHours`; the client toggle `Active 6h` (default on) sends 6, off sends 0; an empty result shows `No swarm is flying right now` with a hint to turn the filter off.
- Acceptance: offline: a brain idle for 7 h is dropped with `recentHours: 6` and kept with 0.
- Source: UI-15.
- Scope: v1

#### PANL-31 Activity eligibility and refresh cadence
- Requirement: Only drawn agents that are live (running, initializing, permission pending) or updated within the idle window (6 h) get timeline reads; per agent: no cache -> read; cached error -> read when `updatedAt`/status changed or after 30 s; live -> at most every 1 s; otherwise only when `updatedAt` or status changed; at most 8 reads in parallel, one in flight per agent; cache entries of agents that left the list are deleted.
- Acceptance: offline (fake SDK with a read counter): 25 old idle brains cost no reads after the first poll; a running agent is read about once per second; concurrent polls never issue two reads of one agent.
- Source: UI-16, INV-56.
- Scope: v1

#### PANL-32 Timeline tail reading
- Requirement: The first read of an agent fetches the last 8 timeline items, later reads the last 4 (`direction: tail`, projected); items merge into the cache (recent by id excluding think, newest 8; last command and reply updated when not older; seen ids capped at 300); a failed read keeps the previous entry and adds `timeline <id8>: <message>` to `errors` only when it differs from the agent's previous error.
- Acceptance: offline: a timeline call failing on 5 polls yields its error string once; cached activity is still returned.
- Source: UI-17.
- Scope: v1

#### PANL-33 Timeline item to activity kind
- Requirement: Kinds `read|edit|write|shell|search|fetch|agent|plan|think|command|reply|tool`: tool-call details read/edit/write keep their kind and file, shell -> shell, search -> search (`web: <query>` for web search), fetch -> fetch (URL without scheme), sub-agent -> agent, worktree setup -> shell `worktree <branch>`, plan -> plan (first line), plain text -> tool, unknown -> name heuristics (PANL-34); user message -> command, assistant message -> reply, reasoning -> think `thinking`, compaction -> think `compacting context`, todo -> plan, error -> tool with status failed; other item types are not drawn. The mapping is re-verified against the installed Paseo timeline schema.
- Acceptance: offline: a table test feeds one item per type and asserts kind, label and files.
- Source: UI-18, R-14.
- Scope: v1

#### PANL-34 Tool-name heuristics on the kit's tools
- Requirement: Unknown-type tool calls are classified by name and input: `mcp__<server>__<tool>` shown as `server: tool`; command present or shell-like name -> shell; batch paths (`files[].path`, `ranges[].path`, `paths[]`, distinct non-blank strings in order) with label `N files: A, B, ...`, kind by tool before any generic rule: native `Write` and `mcp__harness-files__write_multiple_files` -> write, native `Edit`/`MultiEdit`/`NotebookEdit` and `mcp__harness-files__edit_multiple_files` (replacements, line edits, fixes) -> edit, `mcp__harness-files__read_ranges` -> read; other batch inputs: a `write` name -> write, an `edit` name -> edit, else read; then agent, read, edit, write, search, fetch by name patterns; else tool. The tables cover Claude Code native tools and the three `mcp__harness-files__` tools; no `fsbatch`/`filesystem` names.
- Acceptance: offline: `batchFilePaths` passes the four cases of the old test (ranges; files with a duplicate; paths with null/empty plus files; junk -> []); `mcp__harness-files__write_multiple_files` with two files yields kind write with both files, `edit_multiple_files` yields edit and `read_ranges` read, and the ledger op, activity verb and event text of each use that same kind; a golden fixture of a real `circle-agent` worker timeline gives non-empty `files` for every file-touching call (manual capture, offline replay).
- Source: UI-19, UI-20, HIS-77.
- Scope: v1

#### PANL-35 Activity clipping and stable ids
- Requirement: Activity `id` = tool `callId`, or `<itemType>:<seqStart>` for messages; label clipped to 48 chars (whitespace collapsed, `…`), fallback the kind; detail clipped to 300 chars (messages 280); status from the tool, `failed` for errors, else `completed`; files deduped, at most 24.
- Acceptance: offline: a 5,000-char command yields a detail of at most 300 chars ending with `…`; a streaming call keeps its id across reads.
- Source: UI-21.
- Scope: v1

#### PANL-36 Shell label shortening
- Requirement: A shell label is the first `&&`/`;`/`||` segment not starting with `cd`, `set` or `export`, with every path replaced by its last segment, clipped to 48 chars.
- Acceptance: offline: `cd C:/x && node tools/build/run.mjs --all` -> `node run.mjs --all`; a quoted Windows path is shortened to its last segment.
- Source: UI-22.
- Scope: v1

#### PANL-37 File ledger
- Requirement: An in-memory ledger keyed by lower-case path with `/` keeps per file the last touch `{agentId, op, at}`, the previous touch by another agent and a writers map; an edit/write raises the agent's writer time before the holder check; a touch not newer than the holder's never moves the holder and never emits a handoff; a touch by another agent within 15 min emits a handoff; holds last 5 min, entries are forgotten after 30 min; writers count agents with an edit/write within 15 min of now.
- Acceptance: offline: A then B write `X.md` 1 min apart -> one handoff, writers 2; 20 min apart -> no handoff, writers 1; B's 10:00 write recorded after A's 10:05 write -> writers 2, A stays holder, no handoff.
- Source: UI-23, INV-38.
- Scope: v1

#### PANL-38 File holds in the snapshot
- Requirement: `files[]` lists holds whose holder is drawn and whose last touch is within 5 min, newest first, at most 4 per agent, plus every file with writers >= 2 regardless of the cap; each hold has `path, name, op, agentId, at, prevAgentId|null, prevOp|null, writers`; per-agent counts go to `heldFiles`.
- Acceptance: offline: an agent touching 10 files yields 4 holds and `heldFiles: 10`; a conflicted file beyond the 4 is still present.
- Source: UI-24.
- Scope: v1

#### PANL-39 Handoff events grouped per tool call
- Requirement: File operations seen on a non-first read are grouped by previous holder (one group per tool call and previous agent); each group emits one `handoff` event (text = basename or `N files: a, b, c, ...`, `path` = first file, `peerId`, `peerOp` = strongest previous op write > edit > read); the client treats previous edit/write followed by edit/write as a write conflict.
- Acceptance: offline: one batch read of 7 files previously touched by one agent yields 1 event with text `7 files: ...`.
- Source: UI-25.
- Scope: v1

#### PANL-40 Event log with epoch
- Requirement: The server keeps events in a ring buffer of 500 with a monotone `seq` and an `epoch` (`<pid>-<base36 start time>`) that changes on plugin restart; text clipped to 200; `afterSeq < 0` or another epoch returns the newest 40 events as history, else events with `seq > afterSeq`, at most the newest 200; `lastSeq` is returned every snapshot.
- Acceptance: offline: after a simulated restart the next snapshot has a new epoch and returns history only; 600 events keep the newest 500.
- Source: UI-26.
- Scope: v1

#### PANL-41 Lifecycle recording
- Requirement: `agent.created` -> `spawn`, `agent.archived` -> `archive`, `agent.turn_started` -> `command` recorded asynchronously (newest user message of the last 4 items if not older than hook time - 15 s, one retry after 700 ms, else empty text; the hook never blocks), `agent.turn_ended` -> `report`/`failed`/`canceled` with the last assistant text, error message or reason and `stats` (`12 read · 3 edit · 2 shell`), `agent.permission_requested` -> `permission`, `agent.permission_resolved` -> `permission_resolved`.
- Acceptance: offline (fake hooks and timeline): each lifecycle event produces its event kind and text; a user message arriving after the first lookup is caught by the retry; manual: a prompt sent with `ph send` appears as `got prompt: ...` within 2 s.
- Source: UI-27, UI-06.
- Scope: v1

#### PANL-42 Tool events on first sight
- Requirement: A tool-kind activity first seen in a tail emits one `tool` event, except on an agent's first read (its existing history emits nothing); the client skips the tool pop when the same activity already produced a handoff.
- Acceptance: offline: a new agent's first poll emits no `tool` events; a later new call emits exactly one.
- Source: UI-28.
- Scope: v1

#### PANL-43 Partial failure, honest degradation
- Requirement: Agent listing failures add `agents: <msg>` to `errors` and degrade to an empty list; timeline errors are added per PANL-32; the screen shows the first 3 errors and `Snapshot failed: <msg>` when the RPC fails; the header subtitle is `offline`, `connecting…` or `live · N brains · M swarms`.
- Acceptance: offline: a fake `agents.list` that throws still yields a snapshot with `errors: ["agents: ..."]`.
- Source: UI-34.
- Scope: v1

#### PANL-44 Client cursor and epoch handling
- Requirement: The client sends `{recentHours, afterSeq, eventEpoch}` from its cursor (start `{-1, null}`, then `{lastSeq, eventEpoch}`); on the first response or an epoch change the feed is reset and filled with history that is shown but never animated; relative times use the snapshot's `generatedAt`.
- Acceptance: component test: a simulated epoch change clears the feed and refills it without animating history.
- Source: UI-35.
- Scope: v1

#### PANL-45 Activity feed
- Requirement: The client keeps at most 80 events newest first, deduped by `seq`, filtered to agents on the map or whose parent is on the map; rows animate only above the live cursor; the header shows `N actions/min` from `tool` events of the last 60 s; row texts per kind (`spawned`, `archived`, `got prompt: ...`, `reported: ...`, `turn failed: ...`, `turn canceled`, `needs permission: ...`, `permission answered`, tool verbs, handoff and conflict texts); a row click selects the agent.
- Acceptance: offline: `eventText` table test per kind; an event of an agent outside every drawn brain never appears.
- Source: UI-37, UI-50.
- Scope: v1

#### PANL-46 Layout with stable slots
- Requirement: Brain left, swarm hubs to its right, agents on one ring (<= 10 slots) or two C-shaped rings opening toward the brain; slot capacity rounds up to tiers `[4,6,8,10,12,16,20,24,30,36,48,64,96,128]` then multiples of 32; an agent keeps its slot while it lives, a freed slot cools down 4 s, and a swarm is renumbered only when its tier shrinks; fit-width zoom is clamped to 0.4..1.
- Acceptance: offline: spawning then archiving one agent in a 6-agent swarm leaves the other 5 coordinates unchanged.
- Source: UI-38.
- Scope: v1

#### PANL-47 Agent state model
- Requirement: `waiting` when attention is permission; `error` on status or attention error; `working` when running or initializing; else `sleep`; archived and closed agents are never drawn (except a closed brain with live subagents); header counters running / sleep / waiting / error / `ctx >= <rotatePct>%` / `write conflicts` (only when > 0).
- Acceptance: offline: a table test over status and attention combinations for `agentState`.
- Source: UI-39.
- Scope: v1

#### PANL-48 Node rendering
- Requirement: Agent nodes show a context ring (warning colour from `rotatePct`), a state glyph by activity kind while running, badges (item, `NEW`, permission, error, `NN%`), a label box with title, activity line and up to 2 file chips (red with a triangle when writers >= 2), accessibility label `<title>, <state>`; hub nodes show agent count, a ring of wave progress (`plansDone/plansTotal`, PANL-61) when linked, else running/agents, state counters and a wave line (`phase <N> wave <k> · <done>/<total> plans` or `unlinked`); brain nodes show `ctx N%`, project, title, state, turn timer, model and counts; the orphan bucket renders `ORPHANS` without a context ring.
- Acceptance: manual: a visual check of running-read, waiting, error, sleeping, ctx above `rotatePct`, a linked hub at 2 of 4 plans (ring 50%), an unlinked hub with 2 of 4 running (ring 50%) and the orphan bucket on the installed Paseo.
- Source: UI-40, UI-41, UI-42, UI-47.
- Scope: v1

#### PANL-49 Appearance and ghosts
- Requirement: On first load agent nodes fade in staggered (`min(index*30, 900)` ms), hubs and brains once; an agent seen later springs in with a `NEW` badge for 12 s; a view-filter change appears as boot, without `NEW` and without ghosts; a drawn agent that vanishes plays one ghost for 1.7 s tagged `archived` (archive event this poll) or `gone`.
- Acceptance: manual: reload shows boot fade-in; a spawned agent alone gets `NEW`; archiving a drawn agent shows one `archived` ghost, then nothing.
- Source: UI-36, UI-43.
- Scope: v1

#### PANL-50 Animations within fixed budgets
- Requirement: Links are rotated Views (no SVG) with flow dots on running edges; events map to packets, bursts and sparks (command brain->agent, report/failed/canceled agent->brain, spawn sparks, permission toward brain, tool pops at most one per agent per 900 ms, handoff arcs); at most 8 handoff packets per poll (newest kept), at most 60 live effects; nothing animates on the first call; all continuous motion derives from four shared clocks (flow 1.6 s, pulse 2.2 s, spin 9 s, blink 1 s), animating only transform and opacity.
- Acceptance: component test: 30 handoff events in one poll start at most 8 packets, newest kept; with 100 agents the number of looping Animated values is 4.
- Source: UI-44, UI-45, UI-46.
- Scope: v1

#### PANL-51 Header, toggles and zoom
- Requirement: The header shows title, status text, stat chips, the `Active 6h` toggle and zoom controls (out, `NN%`, in, fit); manual zoom 0.4..1.6 in steps of 0.1; the canvas is a two-axis scroll view with a scaled inner view.
- Acceptance: component test: zoom in at fit 0.8 goes to 0.9 and shows `90%`.
- Source: UI-48.
- Scope: v1

#### PANL-52 Inspector
- Requirement: Clicking a node toggles selection; a vanished selection closes the inspector; the agent inspector shows state, turn timer, model, thinking, mode, `ctx N% · used/max`, short id, age, the current path or command, LAST PROMPT and LAST REPLY from `swarm.agent-detail`, files held and recent actions; the swarm inspector shows a status bar, counts and selectable agent rows; a selected brain shows as an agent.
- Acceptance: component test: selecting an agent, closing by X, and pressing the same node twice each close the inspector as specified.
- Source: UI-49.
- Scope: v1

#### PANL-53 Semantic colours and legend
- Requirement: `statusWarning` is reserved for permission and the context threshold, `statusDanger` for errors and write conflicts, `statusSuccess` for running work and reports; decorative fixed hues mark activity kinds; a legend lists every icon and colour meaning.
- Acceptance: offline: a test asserts each palette entry used for text comes from `theme.colors` and the legend covers every icon used.
- Source: UI-52.
- Scope: v1

#### PANL-54 Compact layout and empty states
- Requirement: With `layout.compact` the canvas (min height 420) stacks above the panel in one scroll view; otherwise canvas plus a 380 px side panel; the empty map shows `No swarm is flying right now`; the panel hint shows while nothing is selected.
- Acceptance: component test: `compact: true` renders no horizontal split.
- Source: UI-54.
- Scope: v1

#### PANL-55 Context threshold from the kit's settings
- Requirement: Each `SwarmAgent` carries `rotatePct` = the rotate threshold `ph context` uses for `ROTATE` (PHCL-16; key and default owned by M3/M5), resolved through the shared config loader of the project holding the agent's cwd (that project's installed defaults plus its overlay); an agent outside a kit project gets the value of the kit defaults shipped beside the plugin; ring colour, header chip and `ph context` therefore agree per agent; no threshold constant exists in client code.
- Acceptance: offline: two installed fixture projects with different overlay thresholds, and a source kit whose defaults differ from both installed defaults: each agent's `rotatePct` equals the default N `ph context` resolves in its project; an agent with a non-kit cwd gets the source-kit value; a grep finds no `ROTATE_PCT` constant.
- Source: UI-56, D-97, PHCL-16.
- Scope: v1

#### PANL-56 Scale caps as named constants
- Requirement: Every limit is a named constant (pages 5 x 200 agents, 8 parallel reads, tail 8/4, seen ids 300, recent 8, events 500/40/200, holds 4 per agent, files 24 per activity, feed 80, effects 60, handoff packets 8 per poll, parent cache 30 s); a snapshot for 100 fake agents stays within the caps and under 150 KB.
- Acceptance: offline: a load test with a fake SDK of 100 agents asserts each cap and a serialized snapshot under 150 KB; manual: the first and steady-state poll times on the installed Paseo are recorded.
- Source: UI-57.
- Scope: v1

#### PANL-57 Unit tests of the pure modules
- Requirement: The kit test suite covers `describeItem`, `batchFilePaths`, `FileLedger`, `swarmName`, slot assignment, `EventLog`, the frontmatter parser, the markdown parser, `buildTree`, `computeStats`, `withAlpha` and the format helpers, offline.
- Acceptance: offline: the suite runs each named module's tests with node:test and they pass.
- Source: UI-59, INV-57.
- Scope: v1

#### PANL-58 `.planning` panel notifications from lifecycle hooks
- Source: UI-06 (optional for the panel).
- Scope: later

#### PANL-59 Link swarm hubs to `.planning` waves on the map
- Source: D-96, UI-41.
- Scope: withdrawn — D-96 makes it v1; replaced by PANL-61.

#### PANL-60 Ledger ingestion on every read
- Requirement: Every timeline read of an agent, the first included, records into the file ledger every path currently available on each file-operation activity (by callId), independently of seen-id, tool-event and handoff suppression; a call first seen without paths and later with paths under the same callId adds its paths then; the first read seeds holds and writer counts without emitting `tool` or `handoff` events; ingesting the same touch again is a no-op.
- Acceptance: offline: a call observed first with no input paths and then with two paths under the same callId yields holds for both and a write conflict with another agent's earlier write, with exactly one `tool` event in total; an agent's first read containing three past writes shows them as holds and emits no events.
- Source: UI-17, UI-23, UI-25, UI-28.
- Scope: v1

#### PANL-61 Swarm hubs linked to `.planning` wave progress
- Requirement: A swarm group whose agents carry `harness.run=<runId>` (PCLI-08) is linked read-only to planning artifacts: the server reads `<project>/_workspace/_runs/<runId>/run.json` and `args.json` (project = the agent's Paseo workspace directory) and, when the args name a phase directory (`phaseDir`, as the GSD workflows take it) inside that project's `.planning/phases/` and optionally a `wave`, gives the group `wave: {phase, wave|null, plansDone, plansTotal, scope}` computed from that phase's plans and SUMMARY files as in PANL-15 (null counts unless scope is complete); a group without the label, with a missing or unreadable run directory, or without a phase link gets `wave: null` and is drawn `unlinked`; no title parsing and no temp-dir scan; reads are cached by mtime as in PANL-12.
- Acceptance: offline: fake agents labelled `harness.run=wf_x` and a fixture project whose `_workspace/_runs/wf_x/args.json` is `{"phaseDir": ".planning/phases/02-api", "wave": 1}` with 2 of 4 wave-1 plans summarised give `wave: {phase: "02", wave: 1, plansDone: 2, plansTotal: 4, scope: "complete"}`; a group without `harness.run` and one whose run directory is missing give `wave: null`.
- Source: D-96, UI-41, UI-29, UI-32, UI-51, PCLI-08.
- Scope: v1

### Out of Scope

| Item | Reason |
| --- | --- |
| 14 filesystem-compat tools, directory-walk permission planning, `read_media_file` | native Read/Glob/Grep/Bash cover them (S-04, D-39, D-42) |
| Legacy MCP servers `mcp_fs_batch`, `mcp_fs_proxy` | non-Claude adapters dropped (S-01) |
| `subagent_file_tools.mjs` stub, `mcp__fsbatch__`/`mcp__filesystem__` vocabulary, PID/mtime claim recovery | from-scratch kit (HOK-25, HOK-13, S-06) |
| A kit syntax checker for any language | adapter supplies checkers (D-45, D-110) |
| Backlog plugin, Backlog CLI runner and pin, temp-dir queue/review runs and run cards, preview/sim harness | owner drop of Backlog (S-07), `paseo_tool.py` absent (S-19), D-99 |
| Write actions in the panels | read-only plus copy (D-101) |

### Traceability

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

### Counts

| module | v1 requirements | later items | withdrawn | behaviors traced | not a requirement |
| --- | --- | --- | --- | --- | --- |
| M7 files (FTOL) | 40 | 3 | 0 | 56 | 7 |
| M8 hooks (HOOK) | 31 | 1 | 0 | 40 | 1 |
| M13 ui (PANL) | 59 | 1 | 1 | 83 | 8 |
| total | 130 | 5 | 1 | 179 | 16 |

### Revision log r1

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

---

## Requirements: method (M9 gsd-core, M10 gsd-flows, M11 harness, M12 adapter)

Scope: the GSD lifecycle and `.planning/` formats (M9, M10), the vendoring of upstream GSD text (D-62), the harness skill carried unchanged with its adapter layer (D-111), the adapter generator role (D-109 through D-111 point 4) and the adapter contract (D-77 sections `adapter` and `gsd`). Inputs: `intel/SYNTHESIS.md`, `intel/DECISIONS.md` (D-109, D-110, D-111 override older rows), `intel/INGEST-CONFLICTS.md`, maps `gsd-plan`, `gsd-upstream`, `gsd-debug`, `method`, `history` (HIS-19, HIS-38..39, HIS-42..63, HIS-66..70, HIS-74, HIS-79..86), `hooks` (HOK-26, HOK-27), `workflow` (WFL-46).

Conventions used below:
- `ph gsd <verb>` = `node .agents/harness/ph.mjs gsd <verb>` run from the project root; workflow scripts call the same verbs as a library (M6 `shell()` or in-process).
- "Fixture test" = offline test under the kit's `tests/` (never shipped) with temp project dirs (paths with spaces), fake Paseo/Claude CLIs, no live daemon or owner config (INV-57).
- "Live smoke" = named manual check run by the owner or the maintainer through `ph` on `circle/gpt-6-luna-fast[1m]` (INV-50).
- Vanilla (D-110): no project, engine or game vocabulary in any requirement; project data comes from the adapter (ADPT requirements).
- Skill text (D-111): harness method text and vendored GSD text are carried unchanged; each requirement that touches them names the adapter-layer part the kit changes.

### M9 gsd-core (GSDC)

#### GSDC-01 `.planning/` file set
- Requirement: install seeds only the empty `.planning/` folder (INST-17); every `ph gsd` writer and GSD flow uses only the adopted tree: `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `drafts/` (roadmapper drafts, GSDF-95), `codebase/`, `research/`, `phases/<NN>-<slug>/`, `quick/`, `debug/` (`<slug>.md`, `resolved/`, `knowledge-base.md`), `forensics/`, `.continue-here.md`; no verb creates `.planning/config.json`, `todos/`, `threads/`, `seeds/`, `workstreams/` or `MILESTONES.md`; a project is initialized iff PROJECT, REQUIREMENTS, ROADMAP and STATE all exist and STATE frontmatter carries `gsd_state_version` (one predicate, `ph gsd init.project` returns `{initialized, missing[]}`).
- Acceptance: fixture test runs every write verb against a project started from an empty `.planning/`; the resulting tree contains only the adopted paths; a grep of shipped `ph gsd` code finds no `config.json` path under `.planning`; `init.project` on an empty `.planning/` returns `initialized:false` with all four missing, and on a project with a STATE lacking `gsd_state_version` returns `initialized:false`.
- Source: UPS-03, UPS-08, GSP-73, D-77, D-82, D-89, D-93, D-109.
- Scope: v1

#### GSDC-02 `ph gsd` output and exit contract
- Requirement: every verb prints one JSON document as the last stdout line; `--pick a.b[-1].c` prints the field as a bare value (null or empty string prints an empty line, exit 0), an absent field or non-object root prints nothing on stdout, names the available keys on stderr and exits 1 (`pick_field_absent`); exit codes are 0 ok, 1 negative verdict (JSON on stdout) or usage/error (`{status:"error", error}`), 66 nothing in scope, 69 could not look or not ported; the only exception is `run-with-timeout` (GSDC-41), which passes the child's output through and then prints its own JSON last line, exiting with the child's code or 124; `hash` and `normalize-test-command` follow the JSON rule (`{hash}`, `{command}`); the `ph` dispatcher returns the verb's exit code unchanged (never collapses 66 or 69 to 1).
- Acceptance: fixture test per verb through the real `node .agents/harness/ph.mjs gsd` entry snapshots exit code and JSON shape; `--pick missing` exits 1 with empty stdout; `--pick` on a null field prints `\n` and exits 0; `hash` prints `{"hash":...}`; `run-with-timeout 5 -- node -e "console.log('x');process.exit(3)"` prints `x` then a JSON line and exits 3; a missing phase exits 66 and an unavailable verb 69 through `ph`.
- Source: GSP-12, UPS-66, UPS-67, UPS-73, GDB-56, INV-36, P8.
- Scope: v1

#### GSDC-03 `--root` code-root re-pointing
- Requirement: `--root <dir>` re-points phase paths, git calls and digests to another checkout or worktree of the project; a dir without `.git` (file or folder) is refused with exit 69; harness files (vendored text, adapter, run records) are still read from the invoking checkout.
- Acceptance: fixture test with a git worktree: `ph gsd waves 1 --root <wt>` reads the worktree's plans; `--root` on a plain folder exits 69.
- Source: GSP-82, D-26.
- Scope: v1

#### GSDC-04 Verb table with "not ported" reasons
- Requirement: `ph gsd` holds one verb table mapping every upstream gsd-tools verb named by vendored text to `ported` or `{ported:false, reason}`; a non-ported or unknown verb prints `{status:"unavailable", verb, reason}` and exits 69, never 0.
- Acceptance: fixture test: `ph gsd query todo.match-phase` exits 69 with a reason; a scan of the table asserts no `ported:false` verb path returns 0.
- Source: GSP-11, UPS-66, INV-36, D-61.
- Scope: v1

#### GSDC-05 Frontmatter parser
- Requirement: the kit's YAML-subset parser reads block maps and sequences, flow `[..]`/`{..}` (also multi-line), quoted and plain scalars (null, booleans, integers, floats), `|` and `>` blocks and comments outside quotes; BOM and CRLF are tolerated; a parse error is returned as `{error}` with the line, never thrown and never a silent field drop.
- Acceptance: conformance fixtures (PLAN with nested `must_haves`, SUMMARY with `key-files`, VERIFICATION with `gaps[]`, CONTEXT, malformed cases) parse to exact expected JSON; each malformed case yields an error naming its line.
- Source: GSP-13, D-61.
- Scope: v1

#### GSDC-06 Phase ids, directories and artifact kinds
- Requirement: phase ids are integers or decimals (`1`, `01.1`, `2.1`), resolved to `.planning/phases/<padded>[-<slug>]`; artifact kinds come from filenames (`<NN>-<MM>-PLAN.md`, `-SUMMARY.md`, `-CONTEXT.md`, `-RESEARCH.md`, `-VERIFICATION.md`, `-UAT.md`, `-PLAN-OUTLINE.md`, `-WIRING.md`, `-OUTLINE-REVIEW.md`); `<NN>-PLAN-OUTLINE.md` is never listed as a plan; no `999.*` backlog sentinel exists.
- Acceptance: fixture test: `ph gsd find-phase 1.1` resolves `01.1-x`; `phase list-plans 1` omits the outline file.
- Source: GSP-14, UPS-05.
- Scope: v1

#### GSDC-07 ROADMAP grammar and `roadmap get-phase`
- Requirement: a phase is a `##`..`####` heading `Phase <N>[.<M>]: <name>` holding `**Goal**`, `**Depends on**`, `**Requirements**` and `**Success Criteria**` (numbered list); `roadmap get-phase <id>` returns `{found, phase_number, phase_name, goal, depends_on, requirements, success_criteria, section}` or exits 66; the Requirements line splits on commas and whitespace, `TBD`/`None` are declared-empty, and a malformed token yields a warning of kind `req-line-misparse`, `req-line-range-reading` or `req-line-unverified` instead of a silent drop.
- Acceptance: fixture ROADMAP from the upstream template parses to expected JSON; `**Requirements**: REQ-01; REQ-02` warns naming `REQ-02`.
- Source: GSP-15, UPS-75.
- Scope: v1

#### GSDC-08 `roadmap analyze` and `roadmap annotate-dependencies`
- Requirement: `roadmap analyze` derives per phase plan count, summary count, verification status (or `missing`), current/next/completed phases from disk, `checkbox_conflict[]` and a `scope` field; `roadmap annotate-dependencies <N>` adds wave headers and a cross-cutting-constraints block and is idempotent.
- Acceptance: fixture test: a checked ROADMAP box with no passing VERIFICATION appears in `checkbox_conflict`; a second annotate run changes no bytes.
- Source: UPS-31, UPS-70, UPS-75.
- Scope: v1

#### GSDC-09 REQUIREMENTS grammar and requirement marks
- Requirement: REQUIREMENTS parses both the table `| ID | Spec | Rule | Phase | Status |` and the bullet form `- [ ] **ID**: text`; IDs are free-form strings, valid when they match `gsd.requirement_id_regex` (default `^[A-Z][A-Z0-9]*-\d+$`); `requirements mark-complete <ids>` (comma, space or `[..]` list) and `requirements revert <phase>` update the status cells and traceability rows; an unknown ID is reported, never invented.
- Acceptance: fixture test: table and bullet forms of the same requirements parse to identical maps; with an adapter regex `^[a-z]+:R\d+$` such IDs validate; `mark-complete X-99` (absent) exits 1 naming it.
- Source: GSP-16, UPS-75, D-69.
- Scope: v1

#### GSDC-10 STATE.md format and `gsd state`
- Requirement: STATE.md has frontmatter `gsd_state_version, status, milestone, active_phase, progress{total_phases, completed_phases, total_plans, completed_plans, percent}, last_updated, state_head` derived from disk on every write, and body sections Project Reference, Current Position, Decisions (owner, dated, verbatim), Models, Owner rules, Overrides, Wave log, and one replaced Current state block; `ph gsd state position|planned-phase|wave|decision|override|session-note` are the only writers; each write takes `STATE.md.lock` (exclusive create, stale after 10 s) and returns `updated[]` naming the fields whose persisted value changed.
- Acceptance: fixture test: after writing plans and summaries, frontmatter counts equal disk counts; `state decision --text-file f` appends a dated verbatim entry; two concurrent writes both land; a session note replaces the Current state block instead of appending.
- Source: GSP-72, UPS-68, UPS-69, HIS-49, HIS-69, HIS-70, D-72, INV-48.
- Scope: v1

#### GSDC-11 STATE status vocabulary
- Requirement: STATE `status` takes only the exact lifecycle words (`Ready to plan`, `Planning`, `Ready to execute`, `In progress`, `Verifying`, `Phase complete`, `All phases complete`); completing the last phase writes `All phases complete`, never a milestone-complete word; any other value fails `ph gsd health` with a coded diagnostic.
- Acceptance: fixture test completing the last phase of a two-phase roadmap reads `All phases complete`; a hand-written `status: done` is reported by `health`.
- Source: UPS-68, D-93.
- Scope: v1

#### GSDC-12 Single writer of shared planning files
- Requirement: one write function guards every `ph gsd` mutation of PROJECT, STATE, ROADMAP or REQUIREMENTS (`state *`, `roadmap annotate-dependencies`, `requirements *`, `phase add|insert|remove|complete`, `health --repair`, roadmapper draft install, any other verb that resolves to those paths): it refuses with exit 1 `single writer: orchestrator only` when `PASEO_HARNESS_ROLE=worker`, takes the STATE lock and re-derives STATE frontmatter; `write` (GSDC-31) cannot reach those files; the generated agents keep their upstream bodies (which may mention such writes) and the kit overlay of every GSD role, applied after the body, states that the orchestrator is the single writer and the role must not write them (D-111).
- Acceptance: fixture test runs each mutator, including `health --repair` and `phase complete`, with `PASEO_HARNESS_ROLE=worker` (exit 1, files byte-identical); `write .planning STATE` and `write .planning/phases/../ STATE` are refused; kit test asserts each generated GSD agent has the single-writer overlay after its body and that the upstream body is unchanged.
- Source: GSP-72, HIS-49, UPS-69, INV-38, D-111.
- Scope: v1

#### GSDC-13 Phase status ladder
- Requirement: one function `phaseStatus(phase)` computes, first matching row wins: (1) `COMPLETE` = completion record `<phaseDir>/complete.json` (written only by `phase complete`, holding the verification sha) exists and the current VERIFICATION is `passed`, not stale, with that sha; (2) `NOT_STARTED` = no live PLAN; (3) `IN_PROGRESS` = 0 < live summaries < live plans, or any plan halt record `<phaseDir>/<NN>-<MM>-HALT.json` (written by the execute orchestrator when a plan ends `needs-owner` or `failed`, removed when the plan is redispatched) exists; (4) `PLANNED` = live plans > 0 and summaries = 0; (5) with summaries = plans: `NEEDS_REVIEW` when VERIFICATION is `stale`, `gaps_found` or `human_needed`, `EXECUTED` when it is missing, invalid or `passed` without a completion record (next action: complete); every display, router, `roadmap analyze`, the UI panel and `find-phase` use this function; a ROADMAP checkbox never changes it; `find-phase` returns `plan_count`, `summary_count`, `plan_count_all` as `null` (never 0) when the phase cannot be resolved.
- Acceptance: fixture truth-table test, one phase per row: no plans; plans without summaries; partial summaries; a halt record with all other plans summarised; all summaries with missing, invalid, stale, gaps_found, human_needed, passed-without-record and passed-with-record reports; each yields the expected status through `find-phase`, `roadmap analyze` and the progress router; `find-phase 9` on a 3-phase roadmap returns null counts.
- Source: UPS-70, INV-43, INV-36.
- Scope: v1

#### GSDC-14 Scope tri-state and withheld percentages
- Requirement: `roadmap analyze`, `progress` and phase listings return `scope` `complete|truncated|unscoped|unreadable`; when scope is not `complete`, every percentage is `null` and `state` writes no progress percentage (stderr warning).
- Acceptance: fixture ROADMAP whose phase list cannot be fully read yields `scope: truncated` and `progress_percent: null`.
- Source: UPS-71, INV-36.
- Scope: v1

#### GSDC-15 Phase add, insert, remove, complete
- Requirement: `phase add` appends the next integer phase; `phase insert <after>` creates the next decimal phase marked `(INSERTED)`; `phase remove <N>` deletes only an unstarted future phase and renumbers later ones; `phase complete <N>` requires `verification status` `passed`, marks the ROADMAP checkbox with the date and progress row, marks the phase's requirements complete, advances STATE, and reports SUMMARY file claims that do not exist as advisory `warnings[]` (never blocking).
- Acceptance: fixture tests: insert after 2 creates `02.1-*` and a ROADMAP entry; remove of a phase with a PLAN exits 1; complete with `gaps_found` exits 1 and changes nothing; complete with `passed` updates ROADMAP, REQUIREMENTS and STATE in one call.
- Source: UPS-51, UPS-63, UPS-66, INV-43.
- Scope: v1

#### GSDC-16 `phase uat-passed` predicate
- Requirement: `phase uat-passed <N> [--require-verification|--uat-only]` returns `{passed, uat_files, verification_files, checks, blockers}` and exits 0 only when a UAT test passed and none is pending, blocked, skipped without a reason, or an issue that is not a verified gap resolution (every `## Gaps` entry of the test `resolved`, `resolved_by` naming a plan of the phase with its SUMMARY; upstream GSD rule) (and, with `--require-verification`, VERIFICATION is `passed`); otherwise exit 1 with named blockers.
- Acceptance: fixture UAT with 0 pass, 0 issue, 3 blocked exits 1 naming the three tests.
- Source: UPS-55, UPS-54.
- Scope: v1

#### GSDC-17 `init.<workflow>` payloads
- Requirement: `init.plan-phase|phase-op|execute-phase|verify <phase>` return one JSON of paths and flags (never file contents): phase found, padded id, name, slug, dir, requirement ids, goal, context/research/wiring/verification paths, plan list and counts, `has_discuss_checkpoint`, and the `gsd` settings in force; a phase absent from ROADMAP exits 69 `phase not found`.
- Acceptance: fixture test snapshots each payload; a payload never contains a PLAN body; `init.plan-phase 7` on a 3-phase roadmap exits 69.
- Source: GSP-37, UPS-18, UPS-40, UPS-02.
- Scope: v1

#### GSDC-18 `verify plan-structure`
- Requirement: the verb reports errors (frontmatter parse failure; missing `phase, plan, type, wave, depends_on, files_modified, autonomous, requirements, must_haves`; no `<task>`; no task with an `<automated>` obligation; task without `<name>`; `auto|tracer` task without `<action>`; checkpoint task shapes; checkpoint task with `autonomous` not false; truncation: write-continue sentinel, unclosed `<tasks>`, file ending inside a tag) and warnings (missing `<verify>/<done>/<files>`, unknown task type, wave > 1 with empty `depends_on`, one-way reversibility without an earlier `checkpoint:decision`), then calls the adapter's ownership and vocabulary hooks (ADPT-04, ADPT-03); output `{valid, errors, warnings, task_count, tasks, frontmatter_fields}`, exit 1 when invalid.
- Acceptance: ten fixture plans, one per error or warning class, produce the exact message and `valid` value; a plan cut mid-tag reports `Truncated: file ends inside a tag`.
- Source: GSP-17, UPS-76, HIS-48, D-61.
- Scope: v1

#### GSDC-19 `check verify-command-paths` probe protocol
- Requirement: for each task `<automated>` the probe returns `{plan, task, command, kind, status, severity, detail, target}`; the kit core classifies only the `MISSING...` sentinel and `build`; every other kind is resolved by the adapter resolver named in `adapter.verify_vocabulary` (ADPT-03); statuses `ok`, `pending_creation` (target created by this plan), `pending_shared` (target created by a plan's `<shared_changes>`), `unresolvable` (warning), `missing` (blocker); an unregistered kind is a blocker; no plans exits 69.
- Acceptance: fixture adapter with kind `cmd` and a resolver script: a missing target created by the plan's own files is `pending_creation`; one created only in `<shared_changes>` is `pending_shared` severity none; kind `foo` not registered yields a blocker.
- Source: GSP-18, GSP-19, HIS-84, D-71, D-61.
- Scope: v1

#### GSDC-20 `check verify-failure-directions`
- Requirement: every non-sentinel `<automated>` must be followed immediately by `<fails_when>`; missing or a placeholder (`tbd, todo, n/a, none, unknown, ?, -`) is a blocker; a bare restatement (`fails`, `failure`, `error`) is a warning.
- Acceptance: fixture plan with `<fails_when>fails</fails_when>` yields severity warning `restatement`; one without `<fails_when>` yields a blocker.
- Source: GSP-20, UPS-25.
- Scope: v1

#### GSDC-21 Decision coverage
- Requirement: decisions are parsed from CONTEXT `<decisions>` bullets `- **D-NN:** text` (also `D-NN [tags]`); "Claude's Discretion" and tags `informational`, `folded`, `deferred` are non-trackable; an unparseable `**D..` bullet fails with the expected form; a decision is covered when its id appears word-bounded in a plan's objective, tasks, `must_haves` or `truths`; `check decision-coverage-verify` reports the same but always exits 0.
- Acceptance: fixture CONTEXT with D-01..D-03 (D-03 `[informational]`) and plans citing only D-01 reports `uncovered: [D-02]` with id, category and text.
- Source: GSP-21, UPS-16, UPS-30.
- Scope: v1

#### GSDC-22 `check coverage` gate
- Requirement: `check coverage <phase>` passes only when the phase has a ROADMAP entry, every ROADMAP requirement ID of the phase is in some plan's `requirements`, and decision coverage passes; output `{passed, requirements{total, covered, uncovered, extra, roadmapEntry}, decisions}`; `extra` IDs are reported, not blocking; exit 1 when not passed.
- Acceptance: fixture test removing one requirement from every plan exits 1 with that ID in `uncovered`.
- Source: GSP-22, UPS-30.
- Scope: v1

#### GSDC-23 `check owns` (disjoint write sets)
- Requirement: `check owns <phase> [--plans ids]` reports plans without `owns`, `owns` covering a shared path, `files_modified` outside `owns`, a shared file in `files_modified`, and overlapping `owns` or `files_modified` between plans of one wave; owns syntax, shared-file predicate and source roots come from `adapter.ownership` (ADPT-04); needed shared changes are declared in a plan's `<shared_changes>` block.
- Acceptance: fixture adapter with owns prefixes `Path:`: two wave-1 plans owning `Path:a/` and `Path:a/b.txt` report `overlapping owns`; a plan listing a shared-predicate path in `files_modified` reports it.
- Source: GSP-23, HIS-85, D-61, D-26.
- Scope: v1

#### GSDC-24 Outline and manifest formats, `outline parse`
- Requirement: `<NN>-PLAN-OUTLINE.md` is a markdown table with columns matched by prefix (`Plan ID`, `Objective`, `Wave`, `Depends`, `Requirements`) and is complete when a line is exactly `## OUTLINE COMPLETE`; the sibling `<NN>-PLAN-OUTLINE.manifest.json` is `{phase, plans:[{id, owns[], requirements[], produces[{symbol, kind, header}], consumes[{plan, symbol}], tracer{is, outcome, scenario}, verify[]}]}`; `outline parse` returns `{exists, complete, rows, manifest, manifestError}` or exits 66 when the file is absent.
- Acceptance: fixture outlines with reordered columns and backticked ids parse; a file without the marker returns `complete:false`.
- Source: GSP-24, GSP-74.
- Scope: v1

#### GSDC-25 `outline check`
- Requirement: `outline check <phase> [--tracer false]` errors on: no outline or marker, no rows, duplicate or malformed id (`<NN>-<MM>`), empty objective, dependency on an unknown plan or a same-or-later wave, ROADMAP requirement assigned to no row, manifest missing/unparseable/out of sync with rows, empty or invalid `owns`, shared path owned, `consumes` from an unknown or later-wave plan, overlapping `owns` in one wave, plan count or wave count above `gsd.plan_limits` (per-phase override from the plan args); with tracer mode: no manifest plan with `tracer.is`, a tracer plan outside wave 1, consuming anything, or lacking `tracer.outcome`; warnings: claimed id not on the ROADMAP line, manifest requirements differing from the row, consumed symbol not in the producer's `produces`, verify obligation outside the vocabulary, `tracer.scenario` of the form `none: <reason>`; output adds `crossPlan[]`, `needsWiring`, `waves`, `rows`.
- Acceptance: one fixture outline per error class yields its message; with `plan_limits {plans_per_phase: 20, waves_per_phase: 4}` an outline of 21 rows or 5 waves fails; `needsWiring` is true iff a `consumes` edge exists.
- Source: GSP-25, GSP-26, GSP-84, GSP-60, UPS-39, D-70.
- Scope: v1

#### GSDC-26 `waves`
- Requirement: `waves <phase> [--plans ids]` groups plans by frontmatter `wave` (default 1) and errors on unknown `depends_on`, a dependency not in an earlier wave, and same-wave plans sharing a modified file or overlapping `owns`; with `--plans`, dependencies on plans outside the subset that exist on disk are allowed; exit 1 on errors.
- Acceptance: fixture gap subset depending on an already executed plan passes; two wave-2 plans modifying one file exit 1.
- Source: GSP-27.
- Scope: v1

#### GSDC-27 `handoff` (executor-neutral wave contract)
- Requirement: `handoff <phase> [--plans ids] [--prefix p]` refuses (exit 1) when waves or ownership have errors or a tracer plan depends on or consumes anything; in `per-wave` mode the tracer plan(s) form execution wave 1 alone; it writes `<phaseDir>/handoff/[<prefix>-]w<k>.args.json` = `{wave, waveId, gsdPhase, planWave, planRevision, executionMode, tasks[]}` where each task carries `key`, `plan`, `planHash`, `summary` (granted path), `owns` (plan owns plus that SUMMARY path), `requirements`, `specs`, `verify[{task, kind, command, target}]`, `tracer`, `role`, `model`, `effort` (from `gsd.roles`, ADPT-11); it returns `{planRevision, waves[], sharedChanges[]}`.
- Acceptance: fixture with a tracer plan and two wave-1 siblings writes w1 (tracer only), w2 (siblings), w3 (next plan wave); a tracer depending on another plan exits 1; `executionMode: batch` keeps plan waves unsplit.
- Source: GSP-28, GSP-26, D-63, D-70, INGEST-CONFLICTS I-02.
- Scope: v1

#### GSDC-28 Revision hashes (`revisions.json`)
- Requirement: `revisions record|check|hash|show <phaseDir> [key]` over keys `research` (CONTEXT, PROJECT, the phase's own requirement entries and their specs, `<canonical_refs>` files, `adapter.instructions` files, researcher role text), `inputs` (research + RESEARCH.md without its attempt key and completion marker), `freeze` (outline, manifest, WIRING, inputs), `plan:<id>`, `plans`, `checked`, `handoff`; every key also hashes the phase's ROADMAP section without its generated dependency block; `revisions.json` stores each key's hash and file list once (no duplicated lists); `check` exits 0 same, 1 changed, 66 never recorded and reports `headChanged` without invalidating; writes are atomic.
- Acceptance: fixture: record `freeze`; editing CONTEXT makes `check freeze` exit 1; editing another phase's ROADMAP section keeps 0; editing this phase's section exits 1; a code-only commit keeps 0 with `headChanged:true`.
- Source: GSP-29, HIS-47, D-75, INV-39.
- Scope: v1

#### GSDC-29 `supersede`
- Requirement: `supersede <phaseDir> --keep ids` (required) moves every PLAN and its SUMMARY not in the keep set to `<phaseDir>/superseded/` (suffix `.N` on collision), never deletes, and returns `{moved[]}`.
- Acceptance: fixture outline shrinking from 5 to 4 rows moves the fifth plan; `phase list-plans` no longer lists it.
- Source: GSP-30.
- Scope: v1

#### GSDC-30 Attempt records
- Requirement: `attempt record|show <phaseDir> --kind gap|verify|research` stores one schema `{key, runId, inputDigest, before, done, result, at}` in `<phaseDir>/<kind>-attempt.json` (atomic); `key` = sha256(kind, inputDigest, runId) where `runId` is the `ph workflow` run id the host gives the script (kept by `--resume`, new for every fresh run; no UUID, clock or randomness in the script, D-67, D-87); `before` = the sha of the existing report (research, verify) or the plan list (gap) before dispatch; `done` = false until the readback accepted the result; `result` = the accepted report sha (research, verify) or the written plan ids and, for gap, `waveExecuted` (GSDF-30); a workflow records the attempt before dispatching its agent; a fresh run finding an unfinished attempt with another `runId` marks it `abandoned` and never adopts its output; `show` exits 66 when none.
- Acceptance: fixture: a fake verifier killed after writing the report, then `ph workflow --resume <runId>` accepts the report without a second agent call; the same kill followed by a fresh run (new runId, identical inputs) marks the old attempt abandoned, dispatches a new agent and rejects the old report because its sha equals `before` of the new attempt.
- Source: GSP-31, HIS-48, D-67, D-87, INV-35.
- Scope: v1

#### GSDC-31 `write` and `hash`
- Requirement: `write <phaseDir> <NAME>` (NAME `^[A-Z][A-Z-]*$`) atomically writes stdin to `<phaseDir>/<NN>-<NAME>.md`, where `<phaseDir>` must resolve (after `..` and symlink resolution) to an existing `.planning/phases/<NN>-<slug>` directory; `hash` prints `{hash}`, the sha256 of stdin after CRLF to LF.
- Acceptance: fixture: `write <phase> OUTLINE-REVIEW` creates the file; NAME `foo` exits 1; `write .planning STATE` and a phaseDir escaping through `..` exit 1 and write nothing; `hash` of CRLF and LF text is equal.
- Source: GSP-32.
- Scope: v1

#### GSDC-32 `research status`
- Requirement: reads `<NN>-RESEARCH.md`: exit 66 missing; exit 1 `invalid` when frontmatter fails, `status` is not `complete|blocked`, `input_digest` or `attempt_key` is not 64 hex, a write-continue sentinel is present, a complete report lacks the final line `<!-- gsd:research-complete <attempt_key> -->`, the upstream required sections, provenance tags, `<user_constraints>` (when CONTEXT exists) or a phase requirement in `<phase_requirements>`, or a blocked report lacks `<research_blockers>`; exit 1 `stale` when `input_digest` differs from `revisions hash research`; exit 1 `blocked|incomplete` when the current attempt on the same inputs blocked or did not finish; else exit 0.
- Acceptance: fixture reports: truncated before the marker is invalid; CONTEXT edited after research is stale; an older complete report under a newer blocked attempt is `blocked`.
- Source: GSP-33, D-67, INV-35.
- Scope: v1

#### GSDC-33 `research prompt`
- Requirement: renders the vendored upstream research dispatch fragment with phase values only (number, name, description, requirement ids, phase dir, context/requirements/state paths; lines whose optional path is absent dropped) and returns `{prompt, inputDigest, path}`.
- Acceptance: fixture without CONTEXT renders no `context_path` line; the fragment text outside placeholders equals the vendored file.
- Source: GSP-34, D-62.
- Scope: v1

#### GSDC-34 Verification fingerprint and `verification status`
- Requirement: `verification fingerprint <phaseDir> <files...>` returns `covered_files` (given files + all plans + all summaries, sorted) and `covered_digest` with the kit's own prefix, exit 69 when a covered file is missing; `verification status` reads `<NN>-VERIFICATION.md` (66 none), exits 1 `invalid` unless `status` is exactly `passed|gaps_found|human_needed` (no case folding), `passed` has no gaps, human items or `behavior_unverified`, `gaps_found` has gaps, `human_needed` has human items or `behavior_unverified`, and the fingerprint fields exist; a valid report whose recomputed digest differs, or cannot be recomputed, returns `status: stale` with exit 0; output `{status, written_status, score, gaps, human_verification, behavior_unverified, path, sha, stale}`.
- Acceptance: fixture `passed` report with a gap is invalid; `status: Passed` is invalid; editing a covered source file yields `stale`.
- Source: GSP-35, GSP-65, UPS-72, INV-43.
- Scope: v1

#### GSDC-35 `verify artifacts` and `verify key-links`
- Requirement: `verify artifacts` checks `must_haves.artifacts[{path, provides, min_lines, contains, exports}]` (path inside the code root, exists, not a directory, line count, substrings; 66 when none); `verify key-links` checks `must_haves.key_links[{from, to, via, pattern}]`: a source missing but promised by a same-or-later-wave plan is `pending`; a pattern over 500 chars or with lookaround or backreferences is `pattern_neutralized` (not verified); paths outside the root are `path_rejected`.
- Acceptance: fixture `from: ../outside` reports `path_rejected`; a lookahead pattern reports `pattern_neutralized`.
- Source: GSP-36, UPS-73.
- Scope: v1

#### GSDC-36 `phase-plan-index`
- Requirement: returns plans with `wave, depends_on, files_modified, has_summary, halted, blocked_by, ready, gap_closure`, plus `waves`, `incomplete`, `runnable` and warnings naming any unresolved `depends_on` token; `halted` = a halt record exists (GSDC-13); `blocked_by` = depends_on plans that are halted or have no SUMMARY; `ready` = no SUMMARY, not halted, `blocked_by` empty.
- Acceptance: fixture with three plans, one with a halt record and two dependents, reports the dependents `blocked_by` the halted plan and `runnable: []`; removing the halt record makes the halted plan runnable.
- Source: UPS-42.
- Scope: v1

#### GSDC-37 Read verbs
- Requirement: `frontmatter get <file> [key]`, `frontmatter validate --schema plan|plan-gap-closure|summary|verification`, `phase list-plans`, `phase list-artifacts [--type]` (66 when none), `summary-extract <globs> --fields`, `history-digest` and `state load` read files and never write.
- Acceptance: fixture test asserts byte-identical `.planning/` before and after each verb; `validate --schema plan-gap-closure` fails a plan without `gap_closure: true`.
- Source: GSP-37, UPS-66.
- Scope: v1

#### GSDC-38 `commit`
- Requirement: `commit <msg> --files <paths...>` (required) stages only the named files and commits them; `--files-removed` stages declared deletions; the result is `{committed, hash}` or the skip envelope `{committed:false, skipped:true, hash:null, reason}` with `reason` in `skipped_commit_docs_false|skipped_gitignored` and exit 0; the message reaches git as an argument, never through shell interpolation.
- Acceptance: fixture repo: `commit_docs:false` returns the skip envelope; a message containing `"; rm -rf x` is committed verbatim; an unrelated dirty file stays unstaged.
- Source: UPS-81, GSP-58, D-77.
- Scope: v1

#### GSDC-39 `check evaluation-scope`
- Requirement: `check evaluation-scope (--phase P [--since sha] | --plan NN-MM | --quick id) [--commits-only] [--max-commits N]` returns `{status resolved|degraded|unresolvable, source, commits, files, outsideUnion, unreachable}`: scope is the union of the unit's own commits (subject scope `type(<phase>-<plan>)` or `type(<phase>-w<k>)` matched exactly, zero-pad and decimal tolerant, `03-01` never matching `03-010`), reachable from HEAD only; a wave commit belongs to a plan through the commit map `<phaseDir>/commits.json` (GSDF-53), and for a plan scope only that plan's mapped files of the wave commit count; an empty phase union degrades to the phase-directory range and says so; a plan with no match is `resolved` with `reason: no-matching-commits`; an unreadable repo or a git timeout is `unresolvable` (exit 69).
- Acceptance: fixture repo with an unrelated commit between two phase commits excludes it; `--plan 03-01` does not match a `03-010` commit; with the default per-wave policy and decimal phase `02.1`, `--plan 02.1-02` resolves the `feat(02.1-w1)` commit and lists only plan 02's mapped files.
- Source: UPS-74, UPS-41, GSDF-53.
- Scope: v1

#### GSDC-40 `select-revert-commits`
- Requirement: `select-revert-commits (--phase P | --plan NN-MM) --range R` returns the commits whose declared conventional-commit scope matches exactly (phase mode also accepts `NN-MM` and `NN-w<k>` scopes of that phase), newest first; in plan mode a wave commit mapped (commits.json) to that plan and to sibling plans is returned with `shared: true` and the sibling plan ids, never silently as the plan's own commit.
- Acceptance: fixture repo: `--plan 03-02` excludes `03-020`-scoped commits; with one `feat(03-w1)` commit for plans 03-01 and 03-02, `--plan 03-02` returns it with `shared: true, siblings: [03-01]`.
- Source: UPS-94, UPS-66.
- Scope: v1

#### GSDC-41 `run-with-timeout` and `normalize-test-command`
- Requirement: `run-with-timeout <secs> -- <argv...>` runs the command with a process-tree kill at the deadline, passes its output through, then prints `{code, timedOut, durationS}` as the last line and exits 124 on timeout, else the child's code; `normalize-test-command <cmd>` prints `{command}` with known watch-mode test runners rewritten to their one-shot form and other commands unchanged.
- Acceptance: fixture: a sleeping child under `run-with-timeout 1` exits 124 with `timedOut:true` and leaves no child process; `vitest` normalizes to `{"command":"vitest run"}`.
- Source: UPS-47, UPS-66, D-95.
- Scope: v1

#### GSDC-42 `health` of `.planning/`
- Requirement: `ph gsd health [--repair]` reports coded diagnostics `{code, message, fix, repairable}` for: phase numbering gaps, ROADMAP phase without directory and directory without ROADMAP entry, orphan SUMMARY, plan without `wave`, invalid VERIFICATION status, invalid STATE status, STATE frontmatter disagreeing with disk; `--repair` only rewrites STATE frontmatter from disk.
- Acceptance: fixture ROADMAP phase without a directory yields its code; `--repair` fixes stale STATE counts and touches no other file.
- Source: UPS-83, UPS-63.
- Scope: v1

#### GSDC-43 Debug session verbs
- Requirement: `ph gsd debug create|status|list|close` manage `.planning/debug/`: `create` (JSON on stdin: signature `{kind, key, label}`, symptoms, owns, files, goal `find_and_fix|find_root_cause_only`) derives the slug (`^[a-z0-9][a-z0-9-]{0,29}$`, collisions `-2`, `-3`), stores `signature_id = sha256(kind, key)` and the Symptoms hash in the session frontmatter, and builds the session from the vendored upstream DEBUG template; a known unresolved signature reuses its session and appends an Evidence entry; a resolved one moves back from `resolved/` with an Evidence entry carrying the earlier root cause and fix; `status` exits 1 when frontmatter fails, `status` is outside the upstream set, `## Current Focus` or `## Symptoms` is missing, `next_action` is vague, or Symptoms changed since create; `list` excludes `knowledge-base.md` and `resolved/`, exit 66 when none; `close --outcome resolved|diagnosed` moves a resolved session to `resolved/<slug>.md` and appends one knowledge-base entry (`## <slug> — <one line>`, Error patterns, Root cause, Fix, Files changed, Why not caught, Recurrence guard); `diagnosed` stays active; untrusted text the verbs write into the session (owner answers, checkpoint questions) is wrapped in DATA_START/DATA_END and indented 4 spaces.
- Acceptance: fixture: label `Login Fails S30!!` gives `login-fails-s30`; the same signature twice returns the same slug with `reused:true`; `next_action: continue investigating` fails `status`; close resolved then create again reopens with the earlier fix in Evidence and the KB keeps both entries; a checkpoint question containing `## X` still parses all sections.
- Source: GDB-07..12, GDB-32, GDB-58, D-78, D-82.
- Scope: v1

#### GSDC-44 Upstream snapshot (vendoring)
- Requirement: `.agents/gsd/upstream/` holds a trimmed snapshot of open-gsd/gsd-core at the commit named in one pin data file `UPSTREAM.json` `{repo, branch, commit, date, license, files{path: sha256 of LF text}}`; the snapshot holds only files reachable from generated agents and skills; `gsd upstream vendor --from <clone>` refuses a clone whose HEAD differs from the pin (message names both hashes), a symlink or a missing entry, and reads HEAD from `.git/HEAD`, loose refs and `packed-refs` without running git in the clone.
- Acceptance: fixture clones: wrong commit exits 1 naming both hashes; a symlink exits 1; a clone with a git hook and an `fsmonitor` config is vendored without either running (marker file absent); every UPSTREAM.json hash equals the file's LF sha256.
- Source: GSP-01, GSP-02, UPS-87, HIS-43, D-62, INV-40.
- Scope: v1

#### GSDC-45 Generated agents and skill texts
- Requirement: `gsd upstream build` writes each generated GSD agent (`gsd-planner`, `gsd-plan-checker`, `gsd-phase-researcher`, `gsd-executor`, `gsd-verifier`, `gsd-debugger`, `gsd-codebase-mapper`, `gsd-project-researcher`, `gsd-research-synthesizer`, `gsd-roadmapper`, `gsd-code-reviewer`, `gsd-code-fixer`) as kit front matter (`name, description, model` tier fallback, advisory `tools`, `include`) + a `<!-- GENERATED -->` line + a `<kit_adapter_precedence>` block (adapter wins on conflict, method unchanged) + the upstream body with only three path rewrites (`~/.claude/gsd-core/` and `@~/.claude/gsd-core/`, `@gsd-core/`, bare `gsd-core/(references|templates|workflows|contexts)/` not preceded by a word char, `.`, `/`, `@`, `~` or `-`) to the vendored path; the method workflow texts listed in the inventory (GSDC-53) are generated the same way; before its first output write the build validates the snapshot strictly (UPSTREAM.json commit equals the pin, every listed file present with matching LF sha256, no unlisted file under the snapshot) and on any problem exits 1 naming it with no generated file written or changed; the build is idempotent.
- Acceptance: fixture: two builds produce identical bytes; a changed byte, a missing file, an extra file and a pin mismatch each make the build exit 1 and leave every generated file byte-identical; each generated body equals rewrite(upstream body) byte for byte; `foo/gsd-core/references/x` stays unchanged.
- Source: GSP-03, GSP-04, GSP-07, GSP-08, GSP-59, GDB-45, UPS-64, D-62, D-111.
- Scope: v1

#### GSDC-46 Verbatim contract blocks by anchor
- Requirement: the build extracts verbatim the executor's `<deviation_rules>`, `<analysis_paralysis_guard>`, `<summary_creation>` blocks, the plan-phase step 8 contracts (`<tracked_source_paths>`, `<failing_direction_contract>`, `<downstream_consumer>`, `<deep_work_rules>`, `<quality_gate>`), the step 12 revision `<instructions>`, and the debug session manager's Step 2 and Step 3d prompt blocks; a missing anchor or placeholder fails the build naming it.
- Acceptance: fixture snapshot without `<deep_work_rules>` makes the build exit 1 with `missing anchor <deep_work_rules>`.
- Source: GSP-05, GSP-06, GDB-22, D-62.
- Scope: v1

#### GSDC-47 `gsd upstream check`
- Requirement: `check` exits 1 when the snapshot differs from UPSTREAM.json (edited, missing or extra file), a generated file is missing, stale or hand-edited (LF-normalised compare with a fresh build), a file referenced directly by a generated file is absent from the snapshot (depth 1 problem, depth 2-3 warning with `--verbose`), or a `gsd_run <verb>` in generated text or its direct references is not in the verb table (GSDC-04); it prints `check: N problems, M warnings; K references followed, V verbs mapped`; it runs in the kit test suite and in `ph doctor`.
- Acceptance: fixture edits (one byte in a snapshot file, a hand edit in a generated agent, an added `gsd_run foo.bar` in a reference) each make check exit 1 naming the cause; a CRLF checkout passes.
- Source: GSP-08, GSP-09, GDB-54, HIS-43, INV-40.
- Scope: v1

#### GSDC-48 `gsd upstream bump`
- Requirement: `gsd upstream bump --from <clone> --commit <sha>` updates the pin, vendors, builds and checks in one run, prints the diff stat of the snapshot and generated files, and exits 1 (pin left changed for review) until check passes; no network fetch.
- Acceptance: fixture "v2" snapshot adding an unmapped verb: bump exits 1 naming the verb; after the verb row is added, bump exits 0.
- Source: GSP-10, D-62, R-11.
- Scope: v1

#### GSDC-49 Licence notice and departures list
- Requirement: the kit ships the upstream MIT licence and a NOTICE naming repo and commit and listing every adapter-layer departure from upstream (orchestrator-only commits, markers instead of in-agent questions, single writer, verify obligations run by the post-wave gate, gap closure capped at one wave, disjoint `owns` when the adapter uses a shared tree, research provider/cache and package audit not installed, unported verbs and modes); each departure row names the requirement that enforces it.
- Acceptance: kit test asserts the licence equals the vendored `LICENSE` and every NOTICE departure row cites an existing requirement ID of this file.
- Source: GSP-78, HIS-42, HIS-86, D-62, D-111.
- Scope: v1

#### GSDC-50 Vanilla GSD core
- Requirement: kit-authored GSD files (core code, workflow scripts, kit agents, kit overlays, kit skill wrappers) contain no Backlog code path and no project-, engine- or game-specific vocabulary, path rule, verify kind or agent; project specifics reach the core only through adapter hooks (ADPT-15); the scan excludes the vendored snapshot and generated upstream bodies (protected by D-111 and GSDC-47) and the verb table's not-ported declarations.
- Acceptance: kit test greps kit-authored GSD files (the inventory's kit-authored entries, GSDC-53) for a deny list (`backlog`, project and engine names recorded in the test) and finds none, while the verb table may declare `todo.match-phase` unavailable; the GSD fixture suite passes with two different fixture adapters.
- Source: GSP-77, D-110, D-61, P9.
- Scope: v1

#### GSDC-53 Method text inventory
- Requirement: `.agents/gsd/inventory.json` lists every installed GSD method file with `{installed path, kind agent|skill-workflow|template|reference, source path in the snapshot or "kit-authored", transformations (path rewrite, anchor extraction), overlay path}`; it covers the agents of GSDC-45, the method workflow texts the GSD skills carry (map-codebase, new-project, discuss-phase, plan-phase contracts, execute-plan, verify-work, quick, progress, next, pause-work, resume-project, transition, undo, health, forensics, debug session manager), the templates used by GSD verbs, and marks kit-authored wrappers and plumbing (workflow scripts, standalone research skill, overlays); `gsd upstream build` and `check` (GSDC-47) use it for reachability, equality and dangling-reference checks; an overlay change never requires editing upstream text.
- Acceptance: kit test: a one-line alteration in the generated text of each skill-workflow family makes `check` fail naming the file; editing an overlay passes `check` with the upstream-derived text byte-identical; an installed GSD method file absent from the inventory fails the test.
- Source: D-62, D-111, UPS-87, GSP-07.
- Scope: v1

### M10 gsd-flows (GSDF)

Skills live in `.claude/skills/gsd-*`, workflow scripts in `.agents/workflows/gsd-*.js`, agents in `.agents/agents/`. Interactive stages (discuss, UAT, owner questions) run in the main session; every worker is a `ph` agent (D-06). Where upstream has a method text for a flow, the skill carries it generated and unchanged (inventory GSDC-53, build GSDC-45); the workflow scripts and `ph gsd` are kit plumbing (D-62); the kit adds only the adapter overlay named per requirement, applied after the upstream text and winning on conflict (D-111).

#### GSDF-01 Orchestration contract for GSD workers
- Requirement: GSD flows start workers only through `ph` (spawn, fanout or `ph workflow`), never native Agent, Task or Workflow; prompts pass file paths, not contents; a worker's result is a marker in a JSON schema; workers never ask the owner; owner-needing markers become a run result `needs-owner {stage, reason, issues|conflict|question, options}`; a worker failure classed quota, credit, billing, auth or permission is never retried.
- Acceptance: fixture runs of the plan, research and verify scripts with a fake runner: no prompt embeds a PLAN body; a fake planner returning `## PHASE SPLIT RECOMMENDED` yields `status: needs-owner` with stage and options; a fake quota error yields `failed` after one call; a scan of kit-authored GSD files (inventory GSDC-53) finds no instruction to call native Agent, Task or Workflow, and every generated skill carrying upstream spawn instructions has the overlay mapping them to `ph` (upstream text left unchanged).
- Source: UPS-02, UPS-27, GSP-46, GSP-75, INV-13, INV-14, D-06.
- Scope: v1

#### GSDF-02 Lifecycle and chaining
- Requirement: each phase runs discuss -> research -> plan (outline, skeleton review, per-plan planning, checker, optional plan review) -> execute in waves -> verify; `gsd-plan` chains plan -> execute -> verify and stops at the first `needs-owner` or `failed` result; `--plan-only` stops after the handoff; execute refuses a phase without handoff files; a phase is complete only through GSDC-15.
- Acceptance: fixture chain with a fake planner returning an open skeleton blocker never starts execute; `--plan-only` leaves no execute run directory; execute on a phase without `handoff/` exits 1.
- Source: UPS-01, HIS-44, GSP-71.
- Scope: v1

#### GSDF-03 Workflow plumbing for GSD scripts
- Requirement: GSD workflow scripts call `ph gsd` verbs through one helper that parses the last stdout line as JSON and returns `{code, json, stderr}`; every agent prompt ends with `Input digest (<key>): <revisions hash>` so a resumed run never reuses an answer for changed inputs; only validated values (phase dir regex `^\.planning/phases/\d+(\.\d+)?-[a-z0-9-]+$`, slugs, ids) reach a command line, JSON goes on stdin; scripts read no clock and no randomness; long-running planner and checker agents are supervised by the M6 watchdog, never by host wake or sleep tools.
- Acceptance: fixture: changing CONTEXT between two runs with the same args changes the planner prompt and misses the cache; a phase dir containing `&` is refused before any shell call; a static scan of `.agents/workflows/gsd-*.js` finds no `Date`, `Math.random` or `ScheduleWakeup`.
- Source: GSP-39, UPS-32, INV-22, D-87.
- Scope: v1

#### GSDF-04 Shipped GSD agent roster
- Requirement: the kit ships in `.agents/agents/` the generated GSD agents (GSDC-45) and the kit-authored generic agents `gsd-skeleton-reviewer` (read-only, lens-driven) and `finding-verifier` (read-only, confirmed/refuted/uncertain by tracing the trigger); no stack-specific, project or interface-architect agent ships; front matter keys are `name, description, tools` (advisory), `model` (tier), `include`.
- Acceptance: kit test lists `ship/.agents/agents/` and compares with the roster; every file's front matter parses with exactly the allowed keys; no file name or text matches the vanilla deny list (GSDC-50).
- Source: GSP-69, UPS-64, D-109, D-110, INGEST-CONFLICTS W-02, W-22.
- Scope: v1

#### GSDF-05 map-codebase
- Requirement: `gsd-map-codebase` runs 4 parallel `gsd-codebase-mapper` workers (tech, arch, quality, concerns) that write 7 docs to `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS) and return only confirmations; an existing map offers refresh, update (pick docs) or skip; `--paths p1,p2` remaps incrementally and rejects `..`, leading `/` and shell metacharacters; the orchestrator verifies 7 docs of at least 20 lines and runs a secrets scan (key prefixes, private keys, JWT) that pauses before any commit.
- Acceptance: fixture with fake mappers: 7 docs present; `--paths "../x;rm"` is rejected; a doc containing an `AKIA...` key pauses with the finding and commits nothing.
- Source: UPS-11, D-109.
- Scope: v1

#### GSDF-06 Map stamp and drift gate
- Requirement: a shell step (not the mapper) writes `last_mapped_commit` and `last_mapped_at` into each codebase doc's frontmatter; a warn-only drift check counts new directories outside mapped territory and changed files inside mapped dirs since `last_mapped_commit` and warns at plan start above `gsd.drift_threshold` (default 3); no baseline reports `skipped`, never drift; an internal failure reports `skipped`.
- Acceptance: fixture repo with a stamped map and 3 new directories warns; an unstamped map reports `skipped`; the gate never blocks planning.
- Source: UPS-12.
- Scope: v1

#### GSDF-07 new-project
- Requirement: `gsd-new-project` (main session) runs the upstream questioning flow, writes PROJECT.md (What, Core Value, Requirements Validated/Active/Out of Scope, Key Decisions, evolution footer), asks workflow preferences and writes them into the `gsd` section of `.agents/harness.config.json` (granularity, toggles), optionally runs 4 project researchers plus a synthesizer, writes REQUIREMENTS by category with v1/v2/out of scope, runs `gsd-roadmapper` under the draft contract of GSDF-95 (every v1 requirement mapped to exactly one phase, 2-5 success criteria per phase), loops on owner approval (approve, adjust, review), then the orchestrator installs ROADMAP and the REQUIREMENTS traceability and initialises STATE through the single writer (GSDC-12); PROJECT.md and REQUIREMENTS are written by the main session itself.
- Acceptance: live smoke on a fixture repo produces the four files; fixture test with a fake roadmapper leaving one v1 ID unmapped blocks the install and names it.
- Source: UPS-07, UPS-06, UPS-10, D-77.
- Scope: v1

#### GSDF-08 new-project resume and init guards
- Requirement: new-project decides by the initialization predicate (GSDC-01), never by `.planning/` existing: an empty `.planning/` starts from questioning; a partly initialized project resumes at the first missing artifact; an initialized project refuses with "use progress"; `git init` is never run inside an existing work tree.
- Acceptance: fixture of the prescribed flow from a fresh install (empty `.planning/`, then `.planning/codebase/` from map-codebase and an adapter from the harness) starts new-project at questioning; PROJECT.md only resumes at REQUIREMENTS; an initialized project refuses; running in a subfolder of a repo creates no nested `.git`.
- Source: UPS-08.
- Scope: v1

#### GSDF-09 Research synthesizer self-heal
- Requirement: after the synthesizer returns, the orchestrator checks `.planning/research/SUMMARY.md` exists, is non-empty and has no write-continue sentinel; when it does not but the reply holds the full document (its upstream section markers), the orchestrator writes the file and logs a self-heal line; a brief confirmation without the file fails and the roadmapper is not started.
- Acceptance: fixture fake synthesizer returning the document inline without writing: SUMMARY.md exists afterwards and the log has the self-heal line; one returning "done" without a file fails.
- Source: UPS-09.
- Scope: v1

#### GSDF-10 discuss
- Requirement: `gsd-discuss` runs the generated upstream discuss-phase text in the main session: resolves the phase against ROADMAP (stops if undefined), finds phase-specific gray areas, asks numbered plain-text questions and waits (empty input is not approval), does not re-ask decisions of the last 3 CONTEXT files, routes scope creep to `<deferred>`, writes `<NN>-DISCUSS-CHECKPOINT.json` before the first question and after every answer, writes CONTEXT with `<domain>`, `<decisions>` (stable `D-NN`, new ids appended), `<canonical_refs>`, `<code_context>`, `<specifics>`, `<deferred>`, plus DISCUSSION-LOG (audit only, never agent input), removes the checkpoint, and updates STATE through `gsd state`; unported modes (`--power`, `--auto`, `--chain`, advisor, `--ws`, `--batch`, `--analyze`) are refused with a message. Adapter overlay: conversation in the owner's language, artifacts in English, no git step.
- Acceptance: live smoke: interrupted discussion leaves a checkpoint naming the pending question and `gsd-plan` then returns `needs-owner` stage Discuss; fixture CONTEXT produced by a scripted session parses with `check decision-coverage`.
- Source: GSP-70, UPS-15, UPS-16, UPS-17, HIS-86, D-111.
- Scope: v1

#### GSDF-11 Blocking anti-pattern gate
- Requirement: before discuss and before execute, a `.continue-here.md` in the phase directory with "Critical Anti-Patterns" rows of severity `blocking` stops the flow until each row has three written answers (what it is, how it manifested, which structural mechanism prevents it); no file or no blocking row proceeds.
- Acceptance: fixture phase with one blocking row: execute returns `needs-owner` stage Execute naming the row; with three answers written it proceeds.
- Source: UPS-91, UPS-15.
- Scope: v1

#### GSDF-12 research workflow
- Requirement: `gsd-research.js` (args `phaseDir`, `refresh`, `view`, `focus`) with `view` returns the report status without an agent; an unfinished Discuss returns `needs-owner`; a valid current report without `refresh` returns `reused` (with `headChanged`); otherwise it records the attempt (GSDC-30, keyed by the run id) before dispatch, runs one `gsd-phase-researcher` that writes only the RESEARCH.md path with `input_digest`, `attempt_key` and the terminal marker, then decides by `research status`: blocked records and returns `needs-owner`, a report whose key or digest is not this attempt's fails, a null agent result with a valid current report is accepted; success records the attempt done, `revisions record research`, and returns `researched`; a fresh run never inherits an unfinished attempt (even on identical inputs) while `--resume` of the same run continues it. Adapter overlay in the researcher's include: no build, test, install or commit; provenance tags kept; package audit not installed (never fabricate OK).
- Acceptance: fixture runs: two fresh refresh runs on identical inputs get different attempt keys; killing after the report write then `--resume` accepts it with no second agent, while a fresh run after the same kill dispatches a new researcher; a report carrying an old attempt key fails.
- Source: GSP-61, GSP-63, UPS-20, HIS-86, D-67, INV-35.
- Scope: v1

#### GSDF-13 research skill routing
- Requirement: `gsd-research` supports `--view` (no agent), `--refresh` (fresh researcher, keeps still-valid findings, optional focus) and default (reuse valid current research; missing -> research now; invalid, blocked or stale -> report and offer refresh); standalone research never continues to planning; the main session summarizes findings and open questions and never turns an `[ASSUMED]` item into a locked decision.
- Acceptance: fixture `--view` with no report exits with an error and no agent call; live smoke: a default run on a phase with a stale report offers refresh instead of researching.
- Source: GSP-62, UPS-21.
- Scope: v1

#### GSDF-14 Research input policy
- Requirement: every planner, checker, architect and reviewer prompt contains `<research_input_policy>` with either `Approved research: <path>. Read and use only this report.` or `Approved research: NONE. Do not read or use any RESEARCH.md on disk.`; approval is never inferred from file existence.
- Acceptance: fixture plan run with `skipResearch` and an old report on disk renders NONE in every role prompt.
- Source: GSP-42.
- Scope: v1

#### GSDF-15 Plan workflow arguments
- Requirement: `gsd-plan.js` requires `phaseDir`; `mode` `plan` (default) or `gaps`; `tracer` default true; `reversibilityGates` default true; `maxSkeletonPasses` and `maxCheckIterations` default from `gsd` config (3) and only integers 1..3 (4 fails the run before any agent); `skeletonLanes` default `[{lens:fidelity},{lens:integration}]`, at least one lane with a non-empty lens; `wiring` `auto|always|never`; `replan`; `skipResearch` with `researchSkipReason`; `forceProceed {reason}`; `planReview` (default from `gsd`, off); per-run role overrides; returns `{status planned|needs-owner|failed|refused, reason, ...}`.
- Acceptance: fixture: `maxCheckIterations: 4` fails with reason and zero agents; `skeletonLanes: []` fails; defaults resolve from the overlay.
- Source: GSP-38, D-68, D-65, D-66.
- Scope: v1

#### GSDF-16 Plan preconditions
- Requirement: an unfinished Discuss returns `needs-owner` stage Discuss; in plan mode research must be `complete` unless `skipResearch:true` with a non-empty `researchSkipReason` (then the report path is nulled and the skip logged), else `needs-owner` stage Research; in gaps mode research is used only if currently complete; missing ROADMAP requirement IDs only warn (the coverage gate stops later).
- Acceptance: fixture: stale research without skip -> `needs-owner`; skip with empty reason -> `needs-owner`; skip with reason -> proceeds with NONE policy.
- Source: GSP-41.
- Scope: v1

#### GSDF-17 Planner prompts
- Requirement: planner prompts reproduce upstream step 8 `<planning_context>` (phase, mode, required reading: STATE, ROADMAP, REQUIREMENTS, CONTEXT as user decisions, approved research, phase requirement IDs, project instruction files and the stack skill from the adapter, `TRACER_MODE`, `REVERSIBILITY_GATES`, `MVP_MODE false`, `WALKING_SKELETON false`, granularity) and step 12 `<revision_context>` (existing plans, checker issues JSON, revision instructions, one `changes` entry per issue or REVISION_CONFLICT); with no SPEC edge or prohibition sections the prompt carries the specless block asking the planner to list edge cases into `must_haves.truths` and must-not items into `must_haves.prohibitions`, or a recorded skip reason, never neither; the standing contracts come from the planner's `include` (GSDC-46).
- Acceptance: fixture prompt snapshots for plan, revision and gap modes; the specless block or a skip reason is present in every plan-mode prompt.
- Source: GSP-44, GSP-45, UPS-25, UPS-39, UPS-88.
- Scope: v1

#### GSDF-18 Planner sessions and role resolution
- Requirement: the outline, its revisions and phase-level revisions run in session `planner:outline`; each plan in `planner:<planId>`; gap plans in `planner:gaps`; reviewers, checker and verifier run fresh; every agent call passes its role name as `agent({role})` (FLOW-04) so model and effort resolve by D-16 precedence (ADPT-11, PHCL-22), skeleton lanes pass their per-lane `model`/`effort` as per-run overrides, and the run's `result.json` records the effective role table.
- Acceptance: fixture: with roles `outline` and `planner` set to different models, the outline call carries the first and plan calls the second; a resumed run adopts the cached session agent.
- Source: GSP-43, HIS-19, D-16.
- Scope: v1

#### GSDF-19 Outline stage
- Requirement: the outline planner writes `<NN>-PLAN-OUTLINE.md` ending with `## OUTLINE COMPLETE` on disk and the manifest; the outline is reused only when it has the marker, `revisions check inputs` is unchanged and `replan` is off; a regeneration that returns nothing while an old outline exists fails the run (an old marker never acknowledges new inputs); `outline check` runs next with at most 2 mechanical fix turns in the same session, then fails; a passing outline logs warnings and records `revisions inputs`.
- Acceptance: fixture: fake planner returning null on regeneration after a CONTEXT edit -> `failed`; two failing fix turns -> `failed` listing the outline errors.
- Source: GSP-47.
- Scope: v1

#### GSDF-20 Wiring-contract stage (adapter architect only)
- Requirement: the wiring stage runs only when `adapter.agents.architect` names an existing agent and (`wiring: always`, or not `never` and the outline check found cross-plan edges or a WIRING.md exists); the architect writes only `<NN>-WIRING.md` and returns `{status complete|conflict, sharedChanges, outlineChanges, conflicts}`; `conflict` -> `needs-owner`; a missing file -> `failed`; `outlineChanges` become blocker issues for the skeleton review; without an architect agent cross-plan edges are reviewed by the integration lane only and the stage is logged as skipped.
- Acceptance: fixture adapter with an architect: a `consumes` edge triggers it, no edge does not; fixture adapter without one: run proceeds and logs `wiring: no architect agent`.
- Source: GSP-48, HIS-60, D-109, INGEST-CONFLICTS W-22.
- Scope: v1

#### GSDF-21 Skeleton review, pass 1
- Requirement: lanes get ids L1..Ln and run `gsd-skeleton-reviewer` fresh, read-only, in parallel, with the lens, phase, goal, frozen snapshot file list, requirement IDs, tracer mode, mechanical warnings and cross-plan edges; issues use the checker format `{plan, dimension, severity, required_property, description, evidence, fix_hint, target outline|wiring|both}`; info issues become advisories; a lane returning nothing is retried once, then the run fails (the gate never passes unreviewed); generic lens texts (`fidelity`, `integration`) ship in the kit, further lenses come from config.
- Acceptance: fixture: one lane null twice -> `failed`; info-only issues pass with advisories.
- Source: GSP-49, GSP-51, HIS-45, D-68.
- Scope: v1

#### GSDF-22 Skeleton review, passes 2..N
- Requirement: while open blockers remain and the pass count is below `maxSkeletonPasses`: issues with target `outline`, `both`, or `wiring` when no wiring is in use go to `planner:outline` (then the mechanical check reruns, one fix turn); when wiring is in use (architect present, `wiring` not `never`), issues with target `wiring` or `both` go to the architect, and after any outline revision the architect also realigns WIRING.md with the revised outline even with no wiring issue (unless it wrote WIRING in this pass); when a revision introduces the first cross-plan edge, the architect (if present and `wiring` not `never`) writes WIRING now and a blocker asks the integration lane to review all of it; without an architect the new edges become blocker issues of the integration lane; architect `conflict` -> `needs-owner`; each lane then runs a resolution check on only its own open ids (resolved + evidence, no new issues, unanswered = unresolved); the loop runs while open blockers remain (warnings neither drive revisions nor stall); a pass whose open blocker count is not lower than at its start -> `needs-owner` stalled (its issues: the open blockers); after the cap open blockers (unknown severity = blocker) -> `needs-owner`; only warnings -> pass, carried to the checker and to the matching planner prompt; REVISION_CONFLICT -> `needs-owner`; never proceed on an open blocker.
- Acceptance: scripted reviewers: pass 1 opens three ids, pass 2 resolves one (two open), pass 3 resolves one (one open): a remaining blocker ends `needs-owner`, a remaining warning ends passed with the warning carried; a 3 -> 2 -> 2 sequence ends `needs-owner` stalled at pass 3; an outline-only revision changing a consumed declaration triggers the architect realignment; a revision adding the first `consumes` edge writes WIRING and adds the integration blocker; neither case freezes before the integration lane resolved it.
- Source: GSP-50, HIS-45, INV-37.
- Scope: v1

#### GSDF-23 OUTLINE-REVIEW.md and freeze
- Requirement: after the gate, in every outcome, the workflow writes `<NN>-OUTLINE-REVIEW.md` (status, lanes with models, per-pass open counts, Open and Resolved tables with evidence cut at 300 chars, Advisories, report JSON) through `gsd write`; only `passed` records `revisions freeze` (and commits per `gsd.commit_policy`); a matching `freeze` without `replan` skips the review.
- Acceptance: fixture rerun with unchanged inputs spawns no reviewer and logs `skeleton unchanged since its review passed`.
- Source: GSP-52.
- Scope: v1

#### GSDF-24 Per-plan planning
- Requirement: after the freeze the workflow runs `supersede --keep <outline ids>`, then per outline wave in order keeps plans whose `revisions check plan:<id>` matches and whose structure passes, and runs single-plan planners in parallel for the rest (frozen manifest entry, `owns` repeated exactly, WIRING declarations quoted, open skeleton warnings for that plan); after the join it records `plan:<id>` serially in row order; a later wave starts only after the current wave is on disk.
- Acceptance: fixture: kill after wave 1 -> rerun keeps wave-1 plans and plans wave 2; an outline edit rewrites all plans.
- Source: GSP-53, UPS-26, INV-38.
- Scope: v1

#### GSDF-25 Structure check with one fixer turn
- Requirement: after each plan write or revision `verify plan-structure` runs; on errors the same planner session gets the error list once to fix in place; still invalid -> `failed`.
- Acceptance: fixture malformed plan: the fixer prompt contains the exact error list; a second failure ends `failed`.
- Source: GSP-54.
- Scope: v1

#### GSDF-26 Plan-checker loop with probes
- Requirement: each iteration runs `verify-command-paths`, `verify-failure-directions` and `check owns`, counts probe findings in code (blocker/warning by probe, ownership problems blocker, exit-69 probe warning), runs a fresh read-only `gsd-plan-checker` with the probe JSON and instructions not to re-derive it (one retry on null, then `failed`), counts non-info issues plus probe issues (unknown severity = blocker); 0 -> pass with advisories; iteration at `maxCheckIterations` -> `needs-owner` with options force proceed, guidance and retry, abandon; count not below the previous -> `needs-owner` stalled; else per-plan issues go to their planner sessions in parallel and phase-level issues to `planner:outline` afterwards; touched plans are re-checked and re-recorded; `revisions record checked` once after a passing loop in plan mode; an unchanged `checked` skips the checker.
- Acceptance: fixture: checker returning 5 issues twice -> stalled; 2 info only -> passed with advisories; a probe blocker counts even when the checker reports none.
- Source: GSP-55, UPS-28, HIS-46, INV-37.
- Scope: v1

#### GSDF-27 Owner markers and REVISION_CONFLICT
- Requirement: planner markers `REVISION_CONFLICT`, `PHASE SPLIT RECOMMENDED`, `SOURCE AUDIT`, `CHECKPOINT REACHED`, `PLANNING INCONCLUSIVE` stop the run with `needs-owner` at the first occurrence (no three-strike rule); the result carries stage, question or summary and the conflict object.
- Acceptance: fixture planner returning REVISION_CONFLICT in the checker loop -> `needs-owner` with the conflict, no further revision call.
- Source: GSP-46, UPS-29, D-74, INGEST-CONFLICTS W-05.
- Scope: v1

#### GSDF-28 `forceProceed` at the checker cap
- Requirement: with `forceProceed: {reason}` (non-empty) a run reaching the checker cap or stall records the override with the reason and the remaining issues in the result and in STATE (`gsd state override`) and continues to coverage and handoff; an open REVISION_CONFLICT is never forced.
- Acceptance: fixture cap reached with `forceProceed` -> `planned` with an `override` field naming the remaining issues and a STATE Overrides entry; with an open conflict -> `needs-owner`.
- Source: GSP-75, HIS-46, D-65.
- Scope: v1

#### GSDF-29 Coverage gate and handoff stage
- Requirement: `check coverage` failure -> `needs-owner` stage Handoff with options re-plan (recommended), move to a later phase, tag the decision informational; otherwise `handoff` writes the wave args, `revisions record handoff`, and the result is `planned` with coverage, waves, planRevision and the shared changes (from the architect and plans' `<shared_changes>`) the orchestrator applies before the first wave.
- Acceptance: fixture uncovered decision -> `needs-owner` with the three options; a passing set writes `handoff/w1..wN.args.json`.
- Source: GSP-56, UPS-30.
- Scope: v1

#### GSDF-30 Gap-closure mode capped at one wave
- Requirement: `mode: gaps` requires `verification status` `gaps_found`, records a gap attempt (source report path and sha, plans before) before the planner, runs `planner:gaps` writing one plan per gap group numbered after existing plans with `gap_closure: true` and owns from the plans owning the gaps' files, structure-checks and checker-loops them (ownership probe scoped to new plans), and hands off only new plans as `handoff/gap-w<k>.args.json`; the gap handoff is written without tracer splitting and must contain exactly one execution wave: gap plans in more than one wave, or any dependency between them, return `needs-owner` before dispatch; executing that wave sets `waveExecuted` in the gap attempt record (GSDC-30) before the first executor starts; a second gap attempt on the same phase after one gap wave executed returns `needs-owner` (cap enforced in code, not prose).
- Acceptance: fixture: crash after 1 of 2 gap plans -> `--resume` resumes the attempt and reuses the plan on disk; a gap attempt producing two dependent waves -> `needs-owner`, nothing dispatched; a gap plan marked tracer still yields one execution wave; a crash after the gap wave started followed by a fresh gap run -> `needs-owner`.
- Source: GSP-57, UPS-37, HIS-42, D-73, INV-37.
- Scope: v1

#### GSDF-31 Planning document commits
- Requirement: planning docs are committed only per `gsd.commit_policy.docs` (default off) through `gsd commit` with the exact paths (`docs(<N>): ...`); a commit failure is logged, not fatal; agents never commit.
- Acceptance: fixture with docs commits on commits exactly the named paths; off commits nothing.
- Source: GSP-58, UPS-81.
- Scope: v1

#### GSDF-32 Resume layers
- Requirement: a rerun with the same args skips unchanged outline, freeze, plans and checker pass through `revisions.json`; `ph workflow --resume <runId>` serves a run that died without input change; attempt records resume gap, verify and research attempts; the normal answer to an owner decision is a new run with the same args file; GSD run ids per phase are recorded in the phase's run record kept by the kit.
- Acceptance: fixture: kill after the skeleton review, rerun unchanged -> no reviewer or planner agent spawned.
- Source: GSP-76, HIS-48.
- Scope: v1

#### GSDF-33 Closed-phase gate
- Requirement: planning a phase whose status is `COMPLETE` exits 1 pointing at its VERIFICATION unless `--force`, which prints a warning banner; other statuses replan normally.
- Acceptance: fixture complete phase: plan without `--force` exits 1 and spawns nothing.
- Source: UPS-19.
- Scope: v1

#### GSDF-34 Planner reply fallback by disk state
- Requirement: when a planner returns no recognised marker, the workflow counts plan files on disk: some plans present -> structure check decides acceptance; none -> `needs-owner` stage Plan `inconclusive`.
- Acceptance: fixture planner returning garbage with valid plans on disk -> plans accepted after structure check; with none -> `needs-owner`.
- Source: UPS-27.
- Scope: v1

#### GSDF-35 Phase auto-detect and separate roles
- Requirement: `gsd-plan` without a phase picks the first phase whose status is `NOT_STARTED` or discussed/researched, else asks; researcher, planner and checker are always separate agents; planning never creates, renames or switches git branches.
- Acceptance: fixture with phase 1 complete and phase 2 discussed picks 2; a scan of the plan script finds no git branch command.
- Source: UPS-18.
- Scope: v1

#### GSDF-36 Post-planning bookkeeping
- Requirement: a `planned` result is followed by `gsd state planned-phase --phase N --plans C` (status `Ready to execute`) and `roadmap annotate-dependencies N`, written by the orchestrator.
- Acceptance: fixture planned run updates STATE status and plan count and adds wave headers to ROADMAP; a second run changes no bytes.
- Source: UPS-31.
- Scope: v1

#### GSDF-37 Optional plan-review stage
- Requirement: with `planReview` on (default off), after the checker passes: cheap finders run per plan x lens (lenses from config; a source-grounding lens that resolves every cited symbol and path against the code root ships in the kit), a verifier and a judge decide each issue, cross-plan duplicates merge, ONE editor (role `plan_editor`) revises all plans in one pass, structure check reruns and handoff is regenerated; cycles stop when current high plus actionable issues reach 0, `needs-owner` when the count does not drop, at most 3 cycles, never proceed with an open revision conflict; the skeleton review stays mandatory regardless.
- Acceptance: fixture with scripted finders: two cycles with non-dropping counts -> `needs-owner`; converged run regenerates handoff with a new planRevision; a cited symbol absent from the code root is reported MISSING by the grounding lens.
- Source: GSP-80, HIS-50, UPS-34, UPS-35, D-66.
- Scope: v1

#### GSDF-38 Execute safe-resume gate
- Requirement: at execute start the orchestrator records an execute baseline in `<phaseDir>/execute-baseline.json` `{codeRoot, head, dirty[{path, sha256|deleted}], untracked[]}` (git status and content hashes, no snapshot copies); before every initial or resumed dispatch it compares the code root with the baseline plus the recorded transfers of completed plans and stops with `needs-owner` (recovery details: paths, owning plan, HEAD) when: a plan without SUMMARY has changed or new files inside its `owns` (tracked or untracked); a changed path is owned by no plan or by more than one plan of the wave; the code root or HEAD moved outside the orchestrator's own commits; or an incomplete plan has commits in its evaluation scope (GSDC-39) and no SUMMARY (options close out manually, re-execute from scratch, mark and skip); any resolver status other than resolved or degraded stops the gate fail-closed (exit 1, no executor).
- Acceptance: fixture repo: a killed executor that left an uncommitted edit to a tracked owned file and an untracked created file, with no commit and no SUMMARY, makes the resumed execute stop before any dispatch and name both paths; a `feat(03-02)` commit without `03-02-SUMMARY.md` spawns no executor; an unrelated file changed after the baseline stops with `unauthorized path`; an unreadable repo exits 1.
- Source: UPS-41, GDB-05, INV-44.
- Scope: v1

#### GSDF-39 Plan readiness and all-filtered routing
- Requirement: execute dispatches only plans `phase-plan-index` marks runnable; `--wave N` refuses while lower waves have incomplete plans; when everything is filtered it answers in order: filter active -> "no matching plans"; blocked plans -> "phase stuck, resolve the halt" (never done); not ready -> waiting; all summarised -> route by verification status (missing or stale -> verify; passed and not complete -> phase complete; gaps or human -> next command).
- Acceptance: fixture with one halted plan and two blocked dependents reports "stuck" and starts no verify.
- Source: UPS-42.
- Scope: v1

#### GSDF-40 Wave overlap check and cwd/branch drift guard
- Requirement: before each wave, two plans sharing a `files_modified` entry run sequentially and the overlap is logged as a planning defect; execute refuses to start when the orchestrator's cwd is inside a `ph` agent worktree or on a `harness/*` branch, printing stranded commits and dirty files.
- Acceptance: fixture wave with overlapping files runs the two plans one after the other; orchestrator cwd in `.claude/worktrees/x` exits 1 with the report.
- Source: UPS-43, D-26.
- Scope: v1

#### GSDF-41 Worktree or shared-tree execution per adapter
- Requirement: `gsd.isolation` `worktree` gives each executor a `ph` worktree (created one at a time) whose uncommitted output the orchestrator integrates through the transfer transaction of GSDF-94 in plan order, never completion order; a deletion not declared in the plan's `files_deleted` is refused; `shared` runs executors in one tree and requires disjoint `owns` per wave (GSDC-23); recovery of a refused transfer never edits the main tree by default and keeps the worktree.
- Acceptance: fixture with `isolation: worktree` and two plans integrates in plan order regardless of finish order; an undeclared deletion is refused while the other plan is integrated; `shared` with overlapping owns refuses the wave.
- Source: UPS-44, GSP-23, D-26.
- Scope: v1

#### GSDF-42 Executor dispatch contract
- Requirement: each plan runs one `gsd-executor` (or the adapter's executor agent, ADPT-09) with paths only: its PLAN, the granted SUMMARY path, its owns, the adapter stack skill to follow, the verbatim deviation rules (Rule 1-3 auto-fix bounded by owns, package installs excluded from Rule 3 and a failed install returns a blocking human checkpoint, Rule 4 returns `partial` with the decision in notes, 3 auto-fix attempts per task then Deferred Issues); the executor never commits, never writes STATE, ROADMAP or REQUIREMENTS, writes its SUMMARY to the granted path, and returns `{taskResults[{task, status implemented|partial|blocked|skipped, evidence}], deviations[], requests[]}`; a checkpoint or Rule-4 result becomes `needs-owner` whatever any parallelization flag says.
- Acceptance: fixture executor prompt contains the four rule blocks and the stack skill name; a fake executor returning a Rule-4 partial yields `needs-owner`; a fake that commits is detected by a HEAD comparison and fails the plan.
- Source: UPS-45, UPS-49, UPS-89, UPS-90, GSP-05, D-63, D-94.
- Scope: v1

#### GSDF-43 Completion reconciliation
- Requirement: when an executor returns no normal completion or its agent ends abnormally, the orchestrator first reconciles artifacts (SUMMARY present at the granted path and changes inside owns = complete, not re-dispatched) and only then classifies the failure; it spot-checks each SUMMARY's first two `key-files` paths exist.
- Acceptance: fixture executor killed after writing SUMMARY and code is classified complete; a SUMMARY naming a missing created file fails the spot-check.
- Source: UPS-46, INV-44.
- Scope: v1

#### GSDF-44 Post-wave build, test and obligation gate
- Requirement: after each wave (per-wave mode) or after the last wave (batch mode) the orchestrator runs `adapter.commands.build` under `run-with-timeout` (`build_timeout_s`, default 300) and `adapter.commands.test` after `normalize-test-command` (`test_timeout_s`, default 600), then every plan `<automated>` obligation through the adapter's runner for its kind, and writes one gate-evidence file per gate run (ADPT-17); a timeout (124) is reported, never silently ignored, and never counts as green; plan tracking (ROADMAP progress, STATE) is updated only when build, tests and obligations are green by valid, current evidence; evidence that is invalid, stale (inputs changed after it was produced), incomplete or shows zero executed targets for an obligation that names targets is a failure; heavy commands take `adapter.mutex` when set.
- Acceptance: fixture adapter with fake commands: failing tests leave plans in progress and ROADMAP unchanged; a `test:` obligation whose runner exits 0 with 0 tests executed fails that task; evidence produced before a fixer changed a covered file is rejected as stale; a build timeout prints the timeout message and blocks tracking.
- Source: UPS-47, HIS-84, HIS-82, D-95, INV-53.
- Scope: v1

#### GSDF-45 Failure classification
- Requirement: an executor failure body is classified `quota` (sentinels such as `usage limit`, `rate limit`, `429`, `too many requests`, `RESOURCE_EXHAUSTED`, with `retryAfterSeconds` when present) or `unknown`; quota never offers retry-now and reports the reset time; unknown asks continue or stop through `needs-owner`.
- Acceptance: fixture body containing `429` -> class quota with the retry hint and no re-dispatch.
- Source: UPS-48, INV-13.
- Scope: v1

#### GSDF-46 Bounded code-review gate
- Requirement: at the review point of the execution mode (GSDF-49: after the wave is green in `per-wave`; code-only reviews in `batch`), one fresh `gsd-code-reviewer` per plan reviews the plan's review scope (GSDF-92) with the lenses in `adapter.review_lenses`; each finding carries `trigger`, `likelihood`, `confidence` (0-100), `impact`; a high finding blocks only with a non-empty trigger, confidence >= 80 and likelihood not theoretical (else downgraded); blocking findings go to a separate read-only `finding-verifier` (confirmed, refuted, uncertain); a missing verdict is retried once, then `unverified` (still blocking, escalated to the owner, never sent to the fixer); in `per-wave` mode confirmed findings get ONE `gsd-code-fixer` pass, then the green gate reruns and a resolution check reviews only those findings (no new findings); in `batch` mode confirmed findings go to the one final fixer with the gate failures (GSDF-49); unresolved ones go to the owner; every review, verdict and resolution is persisted in the review record (GSDF-92).
- Acceptance: fixture review run: a high without trigger is downgraded; confidence 70 is downgraded; a null verifier twice yields `unverified` and `needs-owner`; the resolution-check prompt lists only the confirmed findings.
- Source: HIS-51, WFL-46, MTH-64, UPS-58, D-56, INV-41.
- Scope: v1

#### GSDF-47 Review only built code
- Requirement: in `per-wave` mode no reviewer runs before the integrated build and tests of the wave are green; a plan blocked only by another plan's failure is reviewed with the failure attached; `batch` mode is the D-63 exception: its reviews run on unbuilt code, are recorded as `code-only` evidence (never green evidence), and the resolution check runs only after the final gate is green.
- Acceptance: fixture per-wave run with a failing build: zero reviewer calls; fixture batch run: review records carry `code-only` and no resolution check runs before the final green gate.
- Source: HIS-53, INV-41.
- Scope: v1

#### GSDF-48 Non-blocking findings
- Requirement: downgraded and normal findings never block; they are appended to `.planning/phases/<NN>-<slug>/deferred.md` (finding, plan, file, reason) and each review run appends one line to `_workspace/review-metrics.jsonl` (confirmed, refuted, unverified, resolved counts, deferred count).
- Acceptance: fixture run with two normal findings passes the wave, writes both to `deferred.md` and one metrics line.
- Source: MTH-71, HIS-51, D-58.
- Scope: v1

#### GSDF-49 Execution modes `per-wave` and `batch`
- Requirement: `gsd.execution_mode` `per-wave` (default) runs, per execution wave: code -> green gate (GSDF-44) with bounded verify-fix rounds (`gsd.max_verify_rounds`, default 4, stall after 2 rounds whose failure count does not drop -> `needs-owner`) -> review (GSDF-46) -> one fix pass -> green gate -> resolution check -> commit; the tracer wave runs alone and a red tracer starts no later wave; `batch` runs: all waves code-only, each followed by a code-only review when `gsd.batch_review` is true (no review when false) -> one phase-level code-only review of the whole phase diff -> one orchestrator build plus full test suite plus all obligations -> when red or with confirmed findings, ONE fixer (role `fixer`, GSDF-50) receiving all gate failures and all confirmed findings -> green gate -> resolution check of those findings -> commit; a wave run without the gate records `verify: skipped` in its result and the verifier evidence flags it.
- Acceptance: event-order fixtures with a fake runner: `batch` with `batch_review` true logs code, review per wave, phase review, gate, fixer, gate, resolution; with false the per-wave reviews are absent and the phase review stays; a failed final build still reaches the fixer once; the wave results carry `verify: skipped`; per-wave run with a red tracer starts no second wave.
- Source: GSP-81, GSP-85, GSP-86, D-63, INGEST-CONFLICTS W-07, W-18, R-08.
- Scope: v1

#### GSDF-50 Who builds and tests
- Requirement: with `gsd.fixer_verifies_itself` true (default) the fixer's runtime block tells it to run the adapter build and test commands after its changes, at most `gsd.fixer.max_build_attempts` times (default 3) and within `gsd.fixer.minutes` (default 60), stopping early when two consecutive attempts do not reduce the failure count, and to return `{status fixed|unresolved, attempts, remaining_failures, evidence}`; the orchestrator waits at most `gsd.fixer.minutes` plus a margin, then stops and archives the fixer; `unresolved` or a timeout ends with `needs-owner` and the evidence; the kit's runtime block for parallel executors says the gate runs build and tests and they must not (the upstream executor body is left unchanged, D-111); with the flag false fixers also leave verification to the gate.
- Acceptance: fixture prompt snapshots of the kit runtime block for both flag values; a fake fixer whose build fails every time returns `unresolved` after 3 attempts and the run ends `needs-owner`; a fake fixer that never returns is stopped at the deadline.
- Source: HIS-54, D-64, INGEST-CONFLICTS W-08.
- Scope: v1

#### GSDF-51 Failure attribution
- Requirement: gate failures are attributed to plans by file path within `owns` (and by adapter-supplied attribution output when present); failures the path rule cannot place are passed to `adapter.attribution` (ADPT-15 `attribute`) when set; failures still unplaced go to one integration fixer that owns exactly those files; gate checks listed first in `adapter.commands.gates` run first and, while one fails, later obligations are skipped and reported as not executed; excerpts put error lines before warnings and link complete logs; a failure raised in another plan's files marks the observing plan `blockedBy`.
- Acceptance: fixture gate output with 5 failures in one plan's file and 1 in an unowned file: one call to that plan's executor session, one to the integration fixer; dependent plans are `blockedBy`.
- Source: HIS-59.
- Scope: v1

#### GSDF-52 Cross-plan change requests
- Requirement: an executor result `requests[{path, change, reason}]` for a path owned by another plan of the same wave is delivered to that plan's executor session in the next fix round; a path no plan owns goes to the orchestrator as a shared change; requests survive a failed fix turn.
- Acceptance: fixture: plan A requests a change in plan B's file -> B's next prompt carries it; an unowned path appears in the run's `sharedChanges`.
- Source: HIS-58.
- Scope: v1

#### GSDF-53 Orchestrator commits
- Requirement: only the orchestrator commits code, per `gsd.commit_policy.code` `per-wave` (default) or `per-plan`, with subjects `type(<phase>-<plan>): ...` (per-plan) or `type(<phase>-w<k>): ...` (per-wave) and a `Plans: <id,...>` trailer; after each commit it appends `{sha, phase, wave, plans: {<plan>: [files]}}` to `<phaseDir>/commits.json` (single writer, atomic), which GSDC-39, GSDC-40 and GSDF-38 use to scope wave commits to plans; commits include the plans' SUMMARY files.
- Acceptance: fixture per-wave run creates one commit per wave with the expected subject and trailer and a commits.json entry listing each plan's files; per-plan creates one per plan.
- Source: GSP-78, UPS-74, D-63.
- Scope: v1

#### GSDF-54 Branching strategy
- Requirement: `gsd.branching` `none` (default) never creates branches and warns when committing to a protected branch listed in config; `phase` creates `gsd/phase-<N>-<slug>` from `origin/<default>` with `--no-track` (never from the current HEAD) and aborts when the fetch fails and no local `origin/<default>` exists.
- Acceptance: fixture repo with `phase`: the branch's base is `origin/main`, not HEAD; failed fetch without the ref aborts with no branch created.
- Source: UPS-52, D-91.
- Scope: v1

#### GSDF-55 verify workflow
- Requirement: `gsd-verify.js` (args `phaseDir`, `baseline`, `evidence[]` = paths of gate-evidence files, ADPT-17) refuses evidence that is invalid or stale against the current code (it is listed to the verifier as stale, never as proof), computes an attempt key from the `checked` revision, baseline and evidence and records the attempt with the previous report sha before dispatch; one fresh `gsd-verifier` reads plans, summaries (claims, not proof), ROADMAP, REQUIREMENTS, CONTEXT, WIRING, the previous report and the gate evidence ("do not rerun anything"), writes `<NN>-VERIFICATION.md` with the fingerprint and does not commit; afterwards `verification status` must exit 0, a report equal to the previous sha fails, a null agent result is accepted when the new file passes, and the file's status wins over the returned one; result `{status passed|gaps_found|human_needed|stale, path, score, gaps, humanVerification}`.
- Acceptance: fixture verifier returning `passed` while its file says `gaps_found` -> result `gaps_found` with a log line; no new file -> `failed`; an unchanged previous report -> `failed`; an evidence file whose input identity no longer matches the code is passed to the verifier marked stale.
- Source: GSP-64, HIS-48, INV-35, INV-53.
- Scope: v1

#### GSDF-56 Verification routing
- Requirement: `passed` -> `phase complete` (GSDC-15); `human_needed` -> writes `<NN>-UAT.md` (one test per human item, status testing) and stops without advancing; `gaps_found` -> reverts the phase's requirement marks, then plan `mode: gaps`, one gap wave, re-verify; leftovers after the gap wave go to the owner; `stale` -> verify again after execution evidence is current.
- Acceptance: fixture `human_needed` report never flips a ROADMAP checkbox and writes UAT.md; `gaps_found` routes to gaps mode once and then `needs-owner`.
- Source: UPS-50, D-73, INV-43.
- Scope: v1

#### GSDF-57 UAT conversation
- Requirement: the main session presents UAT tests one at a time in plain text; answers classify as pass (empty, yes, y, ok, next), skip, blocked (with an inferred `blocked_by` tag) or issue (severity inferred, never asked); deferred follow-ups never become gaps; UAT.md is written after each issue, every 5 passes and at completion; zero unresolved issues plus `phase uat-passed` -> verification canonicalised to passed and phase complete; issues -> gaps planning; non-browser safeguards: a SUMMARY completion claim counts only when its plan's commits.json entry and gate evidence (ADPT-17) confirm it, else the test row is a blocker issue; when a phase plan changed files matching `adapter.startup_globs` and no cold-start smoke test exists, one is injected as the first test; on resume, gaps whose `gap_ids` are covered by a completed gap plan with passing evidence are marked resolved, never re-asked as issues.
- Acceptance: live smoke on a fixture UAT; fixture tests: 0 pass, 0 issue, 3 blocked never canonicalises to passed; a SUMMARY claiming a commit absent from commits.json yields a blocker row; a plan changing a startup glob gets an injected cold-start test; a resumed UAT whose gap was closed by a completed gap plan shows it resolved.
- Source: UPS-54, UPS-55.
- Scope: v1

#### GSDF-58 Phase completion and transition
- Requirement: after `phase complete` the transition step evolves PROJECT.md (move shipped items to Validated, update Key Decisions, last-updated footer) and points to the next phase; it never closes milestones.
- Acceptance: fixture transition moves a completed Active requirement to Validated and stamps the footer.
- Source: UPS-51, UPS-63.
- Scope: v1

#### GSDF-59 progress and next router
- Requirement: `gsd-progress` (read-only) renders position, recent summaries, decisions and blockers and routes: Route 0 first scans all phases lowest first and routes any phase with plans > summaries to execute (a scan whose scope is not complete is reported as failed, not clean); then for the current phase UAT partial -> UAT, gaps -> plan gaps, summaries < plans -> execute, verification not passed -> its next command, no plans -> discuss or plan, complete -> next phase; `next` adds hard stops (unresolved `.planning/.continue-here.md`, STATE status error, VERIFICATION invalid) and runs the chosen step.
- Acceptance: fixture with STATE on phase 4 and a phase-2 plan without SUMMARY routes to execute phase 2.
- Source: UPS-60, UPS-70.
- Scope: v1

#### GSDF-60 Pause and resume handoff
- Requirement: `gsd-pause` writes `.planning/.continue-here.md` (position, open items, uncommitted files, next action) and a STATE session note; resume reads it, reports, and removes it after the owner confirms the next action.
- Acceptance: fixture pause then resume restores the next action from files only.
- Source: UPS-63, HIS-70.
- Scope: v1

#### GSDF-61 quick
- Requirement: `gsd-quick [--full] <desc>` requires a ROADMAP, creates `.planning/quick/<YYMMDD-xxx>-<slug>/` (slug <= 40 chars), plans ONE plan of 1-3 tasks (paths repo-root-relative), executes it through the executor contract (GSDF-42), and with `--full` adds discuss, research, a checker loop of at most 2 iterations and a verifier; the orchestrator does one `docs(quick-<id>)` commit per policy; no STATE table row (quick tasks are listed from the directory); trivial one-line fixes are done inline by the main session without a plan.
- Acceptance: fixture `quick "fix a | b"` creates the directory with PLAN and SUMMARY and leaves STATE parseable; `--full` checker stops after 2 iterations.
- Source: UPS-56, UPS-57, D-89.
- Scope: v1

#### GSDF-62 undo
- Requirement: `gsd-undo --last N | --phase NN | --plan NN-MM` selects commits with `select-revert-commits`, shows dependent phases or plans, asks a hard confirmation, then runs `git revert --no-commit` (never `git reset`); a `--plan` selection containing a shared wave commit is refused and the owner is offered the confirmed wave scope (all sibling plans named) instead of a silent partial revert; no or invalid argument prints usage and exits 1.
- Acceptance: fixture repo: per-plan commits: `--plan 03-02` reverts only its commits and leaves history intact; default per-wave commits: `--plan 03-02` of a shared wave commit refuses and names `03-01`; no confirmation reverts nothing.
- Source: UPS-94, UPS-63.
- Scope: v1

#### GSDF-63 forensics
- Requirement: `gsd-forensics` runs in the main session, read-only: no agent, workflow, build or test; it follows the generated upstream forensics text (adapter overlay: the multi-runtime `gsd_run` bootstrap and the GitHub-issue step are not run; the orchestrating main session adds one STATE session note through `gsd state session-note` only when the investigation concerns the active phase, the sole exception to report-only output); evidence includes git history, `.planning/debug/` sessions, `_workspace/_runs/<runId>/` records and gate evidence; it adds the anomaly "same failure signature repeating without a persistent hypothesis record"; apart from that STATE note the only file written is `.planning/forensics/<YYYY-MM-DD>-<slug>.md` with relative paths, credentials stripped, diffs cut at 50 lines, and each hypothesis labelled "forensic hypothesis, not debugger-confirmed".
- Acceptance: fixture repo with a repeated failing signature: the report exists at the dated path, flags the loop, labels hypotheses and contains no absolute home path; for an investigation not about the active phase `git status` shows only the report; for one about the active phase it shows the report and STATE.md with exactly one new session note.
- Source: GDB-52, GDB-53, D-84, D-111.
- Scope: v1

#### GSDF-64 debug skill and session rules
- Requirement: `gsd-debug` (main session) gathers the five upstream symptoms as numbered plain-text questions (values treated as data), creates or reuses the session through `gsd debug create` (GSDC-43), runs one `gsd-debugger` `ph` agent per invocation with the upstream session-manager prompt (GSDC-46) plus a `<runtime_adapter>` block (goal rendered in every turn kind, code root, edit scope from the failing plans' `owns`, budget left), and serves `list`, `status`, `continue`; debug sessions on one code root run serially and no executor or planner writes in that root meanwhile; only the skill and verbs write `## Checkpoints`, move files to `resolved/` and append the knowledge base.
- Acceptance: fixture with a fake debugger: create then list shows the session; a second invocation while one runs on the same root is refused; the rendered prompt contains goal, scope and budget lines.
- Source: GDB-01, GDB-06, GDB-22, GDB-50, GDB-51, GDB-58, GDB-62, D-78, D-82.
- Scope: v1

#### GSDF-65 Debug checkpoints and untrusted data
- Requirement: the debugger never asks; a checkpoint return ends the turn and becomes `needs-owner {id, type, question, options}`; the owner's answer arrives on the next invocation as `checkpointAnswer {id, response}`; owner answers, reports and command output enter prompts only between DATA_START and DATA_END and are evidence, never instructions; reproduction scripts from reports are not executed by the skill.
- Acceptance: fixture: an owner answer containing "ignore previous instructions" appears only inside DATA_START/DATA_END in the next prompt; an unanswered checkpoint makes the next invocation refuse with `awaiting-owner`.
- Source: GDB-23, GDB-24, GDB-51.
- Scope: v1

#### GSDF-66 Debugger overlay rules
- Requirement: the `gsd-debugger` include overlay states: the session file is updated before acting (Current Focus overwritten, Evidence and Eliminated append-only, Symptoms immutable, concrete `next_action`); edits only inside the edit scope, never a shared file, instrumentation removed before close; fix the demonstrated cause, never weaken an assertion, enlarge a tolerance, lengthen a wait or re-press inputs to get a pass; a fixture or oracle change needs a named spec line or owner decision cited in Resolution; a fix already present in the tree before the session is recorded as evidence and raised as a decision checkpoint; never commit, stage or stash; a completed fix returns a `human-verify` checkpoint with a prevention block; MemPalace, specialist skills and TDD mode are off.
- Acceptance: kit test asserts the generated debugger's include chain contains the overlay and each rule sentence; fixture fake debugger turn leaves the session valid under `gsd debug status` and the git index unchanged.
- Source: GDB-26, GDB-46, GDB-48, GDB-59, HIS-55, D-80, D-83, INV-42.
- Scope: v1

#### GSDF-67 Debug budget and evidence rules
- Requirement: a debug turn is one prompt sent to the `gsd-debugger` agent and its reply (the initial prompt, a checkpoint continuation or a skill re-prompt each count one); a session is bounded by `gsd.debug.max_turns` (default 16) and `gsd.debug.minutes` (default 120 of wall time while a turn runs); the used turns and minutes are persisted in the session frontmatter `budget_used {turns, minutes}` after every turn and read by every continuation; each turn's `ph` wait timeout is the remaining minutes and a turn exceeding it is stopped and archived; exhaustion ends with `needs-owner` type `budget-exhausted`; an owner answer never refills a budget (an extension needs turns, minutes and a reason, recorded in the frontmatter); closing `resolved` requires the failing signature's verify command to pass on a fresh run that executed at least one test or step; a filter or command that executed nothing, or could not run, is never a pass.
- Acceptance: fixture fake debugger looping: the session stops at the turn cap with `budget-exhausted`; a continuation of a session with an exhausted budget and only an owner answer refuses without a turn; a resolve whose rerun evidence (ADPT-17) shows 0 executed tests is refused.
- Source: GDB-31, HIS-57, HIS-81, D-78, INV-37, INV-53.
- Scope: v1

#### GSDF-92 Code-review scope and review record
- Requirement: a plan's review scope is chosen in this order: an explicit file list in the run args (used alone, never widened); else the plan SUMMARY `key-files` created and modified (root-level and extensionless files kept, `~/` expanded, paths outside the code root dropped and named); else the plan's evaluation scope (GSDC-39); SUMMARY paths are cross-checked with the plan's actual changes (transfer record or commits.json), adding changed files the SUMMARY omitted and naming listed files that did not change; planning artifacts, lockfiles and deleted files are excluded (deleted files named); the review depth is `gsd.review_depth` (`standard` default); each review writes `<phaseDir>/review/<waveId>-<plan>.json` `{plan, scope[], excluded[], lenses[], codeOnly, findings[{id, severity, trigger, likelihood, confidence, impact, file, line, status gated|downgraded|deferred, verdict confirmed|refuted|uncertain|unverified|null}], resolution[{id, resolved, evidence}]}` and the phase keeps `<NN>-REVIEW.md` rendered from those records.
- Acceptance: fixture: a SUMMARY listing only `Dockerfile` reviews `Dockerfile`; an explicit narrow list is not widened; a changed source file missing from the SUMMARY is added and logged; an unrelated commit interleaved in the wave range is not in scope; the record validates against the schema.
- Source: UPS-58, HIS-51, D-56, D-58.
- Scope: v1

#### GSDF-93 Execute arguments and concurrency
- Requirement: `gsd-execute` accepts `--phase N`, `--wave N`, `--plans ids`, `--gaps-only`; `--gaps-only` selects plans with `gap_closure: true` and refuses (exit 1, naming them) when any plan of the phase lacks a `gap_closure` key; `gsd.parallelization.enabled` false runs the plans of a wave one at a time; `max_concurrent` (null = the M6 `max_subagents` cap) limits concurrent executors and never exceeds that cap; per-run state lives in the `ph workflow` run directory and the phase's execute records (baseline, transfers, commits.json, halt records), not in git-dir handoff files; upstream's ephemeral auto-chain flag is not used (chaining is the `gsd-plan` run result, GSDF-02).
- Acceptance: fixture: `parallelization.enabled: false` with a 3-plan wave shows at most one executor running at any time; `max_concurrent: 2` never exceeds 2; `--gaps-only` over plans with a missing `gap_closure` key exits 1 naming them.
- Source: UPS-40, UPS-90, UPS-37, D-94.
- Scope: v1

#### GSDF-94 Worktree transfer transaction
- Requirement: for `isolation: worktree`, after an executor ends the orchestrator, in plan order: reads the worktree's changes against its base (tracked edits, untracked files, deletions) and the SUMMARY at the granted path; refuses paths outside the plan's `owns` plus its SUMMARY and deletions not in `files_deleted`; verifies the main tree's paths to be written are unchanged since the execute baseline (unrelated dirty files and the index of the main tree stay untouched); copies the validated files into the main tree atomically per file and records `<phaseDir>/transfers/<plan>.json` `{plan, worktree, base, files[{path, sha256|deleted}]}`; only then is the worktree eligible for pruning; a refused or failed transfer leaves the worktree and branch intact and halts the plan (GSDC-13 halt record); workers never commit; the green gate runs on the integrated main tree.
- Acceptance: offline git fixture with two executors leaving uncommitted outputs and SUMMARYs in their worktrees: main receives both in plan order, transfer records exist, the gate's fake test reads the integrated files; an out-of-owns file is refused with the worktree kept; an unrelated dirty file in main is byte-identical afterwards.
- Source: UPS-44, UPS-45, D-26, INV-44.
- Scope: v1

#### GSDF-95 Roadmapper draft contract
- Requirement: the generated `gsd-roadmapper` keeps its upstream body; its kit overlay redirects its outputs to `.planning/drafts/ROADMAP.md` and `.planning/drafts/traceability.json` (`{requirement: phase}`) and forbids writing ROADMAP, STATE or REQUIREMENTS; the orchestrator validates the draft (every v1 requirement in exactly one phase, 2-5 success criteria per phase, ROADMAP grammar GSDC-07), presents it for approval, and on approval installs ROADMAP, updates REQUIREMENTS traceability and initialises STATE through the single writer (GSDC-12); a rejected or adjusted draft leaves the final files unchanged.
- Acceptance: fixture fake roadmapper: before approval ROADMAP, STATE and REQUIREMENTS are byte-identical (or absent); after rejection they are unchanged; after approval they exist and parse; kit test asserts the roadmapper body equals upstream and the overlay follows it.
- Source: UPS-07, GSP-72, D-111, INV-38.
- Scope: v1

### M11 harness (HARN)

The harness method is the English port of revfactory Harness v2.1.0 (commit 92d9f1b, Apache-2.0) as found in the old kit at tag `ref-final` (`project/.agents/skills/harness/`, `harness-evolve/`, `ai-orchestrator/`). D-111: its text is carried as it is; the kit changes only the adapter layer listed in HARN-02. The D-109 role (generate the project adapter) is delivered by the kit overlay (HARN-03), not by editing the method.

#### HARN-01 Method text carried unchanged
- Requirement: the kit ships `.claude/skills/harness/` (SKILL.md and references: execution modes, team patterns, team examples, orchestrator template, QA agent guide, skill writing guide, skill testing guide, model selection guide), `.claude/skills/harness-evolve/` and `.claude/skills/ai-orchestrator/` with the method text of the source unchanged: not trimmed, rewritten or restructured; every difference from the source is one of the adapter-layer edits of HARN-02.
- Acceptance: kit test diffs each shipped file against the source copy kept in `tests/fixtures/method-source/` (sha256 recorded in `PROVENANCE.json` with repo, tag `ref-final`, path); `PROVENANCE.json` also inventories every permitted adapter region as `{file, source line range, HARN-02 category (a)-(h), sha256 of the replacement}`; a differing hunk passes only when it lies inside an inventoried region and equals its recorded replacement; any other hunk fails even if a NOTICE entry describes it; every inventoried region is listed in NOTICE.
- Source: MTH-01..09, MTH-11, MTH-15..20, MTH-25, MTH-26, MTH-28, MTH-30..39, MTH-41, MTH-45, MTH-51, MTH-53, MTH-56, MTH-66..68, D-111, D-54.
- Scope: v1

#### HARN-02 Adapter-layer edits to the method text
- Requirement: the only edits to carried method text are: (a) paths: `.agents/agents/`, `.claude/skills/<name>/`, `CLAUDE.md` (never `project/...`); (b) single skill tree: the `ph skills-sync` step and `.agents/skills` source wording removed (D-10); (c) runtime mapping: `references/paseo-runtime.md` and the runtime notes inside the skills describe the new `ph` (entry `node .agents/harness/ph.mjs`, `ph workflow --script|--name --args-file [--resume runId]` as the one resume shape, `ph watch-run`, run dir `_workspace/_runs/<runId>/`, `max_subagents` read from config); (d) Claude Code only: no `codex/` or `opencode/` model examples, tiers or `circle/<model>` only; (e) no Backlog wording; (f) config key names of the new defaults; (g) one line in each SKILL.md loading the kit overlay (HARN-03); (h) the D-59 reading of coding tiers stated in the overlay (standard = clear-procedure coding, pro = multi-step structural coding), not in the method text; each edit is listed in the skill's NOTICE.
- Acceptance: kit test greps shipped method text: no `project/.agents`, `project/CLAUDE.md`, `skills-sync`, `codex/`, `opencode/`, `backlog`, `paseo_harness.mjs`; the NOTICE lists entries (a)-(h); HARN-01's diff test passes.
- Source: MTH-12, MTH-13, MTH-21, MTH-69, MTH-70, MTH-73, D-10, D-59, D-111, INGEST-CONFLICTS W-02.
- Scope: v1

#### HARN-03 Kit overlay: the harness generates the project adapter
- Requirement: the kit overlay `references/kit-adapter.md` of the harness skill states: run after `gsd-map-codebase`; read `.planning/codebase/*.md`; write the project adapter (ADPT): `adapter` and `gsd` sections of `.agents/harness.config.json` (commands, verify vocabulary with resolvers, ownership, review lenses, syntax checkers, instructions, optional envelope and mutex, roles with models, efforts and reasons), one stack skill in `.claude/skills/<stack>/`, project agents in `.agents/agents/` only where a GSD agent is not enough; run `ph harness lint`; report what was written and ask the owner to confirm; record a history row; the kit's GSD agents are reused before any new agent (role-vs-skill split and overlap check of the method).
- Acceptance: kit test asserts the overlay exists, is loaded by the SKILL.md overlay line and names each adapter section of ADPT-01..13; live smoke: on a fixture repo after map-codebase the harness writes an adapter that `ph harness lint` accepts.
- Source: D-109, D-111, MTH-04, MTH-10, MTH-11, MTH-62, G5.
- Scope: v1

#### HARN-04 Generated adapters for two different stacks
- Requirement: the harness skill with the overlay produces, for fixture codebases of at least two different stacks (one interpreted-language web service, one compiled-language CLI), adapters whose commands run on the fixture, whose verify vocabulary resolves the fixture's tests, and which pass `ph harness lint`; the kit ships neither fixture's adapter.
- Acceptance: named live smoke recorded in the kit's test log: both fixtures, generated adapter files attached, lint exit 0, `adapter.commands.test` exits 0 on each fixture; `ship/` contains no file from either adapter.
- Source: D-109, D-110, R-09, SYNTHESIS M12 acceptance.
- Scope: v1

#### HARN-05 Skill lint
- Requirement: `ph harness lint` checks the generated or adapter-referenced assets (files the latest generator or evolve history row lists in Scope, plus every skill, agent and script the adapter names); other owner content is outside the mandatory check (`--all` reports it as advisory warnings, exit 0): SKILL.md front matter has `name` and `description` (description states what and when, at least one "use when" trigger), SKILL.md <= 500 lines, any `references/*.md` over 300 lines has a contents list, no README, CHANGELOG or INSTALLATION file in a skill folder, no generated file under `.claude/commands/`, agent front matter has `name` and `description` and only the allowed keys, an agent whose `tools:` lists Write also lists Edit (warning); findings print one line each and exit 2, usage errors exit 1.
- Acceptance: lint fixtures: a generated 501-line SKILL.md, a 301-line reference without contents, a README in a generated skill, a generated agent without description: each yields its finding and exit 2; a clean generated adapter beside an unrelated owner command and an unrelated owner skill exits 0.
- Source: MTH-14, MTH-22, MTH-23, MTH-24, MTH-27, MTH-46, MTH-54, P8.
- Scope: v1

#### HARN-06 In-session primitive lint
- Requirement: within the HARN-05 scope lint fails an operational use of an in-session or v1 primitive: a call form (`Agent(`, `Workflow(`, `SendMessage(`, `TaskCreate(`, `TaskUpdate(`, `TaskList(`, `TaskGet(`, `TaskStop(`, `TeamCreate(`, `TeamDelete(`), one of those names in an agent's `tools:` list, `team_name`/`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` set in config or env, or an imperative instruction line starting with `Use`/`Call` followed by one of those names; a bare mention (e.g. a ban explanation or the word `broadcast`) is a warning only; workflow scripts with `Date.now()`, `Math.random()` or a non-literal `meta` fail; provider settings are never changed to satisfy lint (SendMessage stays allowed on main providers, D-06).
- Acceptance: lint fixtures: a generated agent with `SendMessage(` in its body and one with `TaskList` in `tools:` fail; a generated skill sentence "never use SendMessage" and a document using the word broadcast only warn; a script with `Date.now()` fails.
- Source: MTH-05, MTH-46, MTH-72, INV-06.
- Scope: v1

#### HARN-07 Reference lint
- Requirement: lint fails when a generated skill, workflow script or the adapter names an agent type without `.agents/agents/<name>.md`, a skill without `.claude/skills/<name>/SKILL.md`, or a script path that does not exist, and when the adapter section fails closed validation (M3).
- Acceptance: lint fixture with `agentType: qa-inspector` and no definition fails naming it; an adapter resolver path that does not exist fails.
- Source: MTH-10, MTH-46, D-77.
- Scope: v1

#### HARN-08 Model tiers and roles
- Requirement: generated agent files name only a tier (`frontier`, `pro`, `standard`) in `model:`; concrete model ids appear only in `gsd.roles` entries `{model, effort, reason}` with a non-empty reason; lint flags a concrete id in an agent file and a role without reason.
- Acceptance: lint fixtures: `model: circle/x` in an agent fails; a role entry without `reason` fails.
- Source: MTH-12, MTH-13, HIS-19, D-16, R-10.
- Scope: v1

#### HARN-09 Eval data schemas
- Requirement: the kit validates skill-test records against exact schemas: `eval_metadata.json {eval_id, eval_name, prompt, assertions[]}`, `grading.json {expectations[{text, passed, evidence}], summary{passed, failed, total, pass_rate}}`, `timing.json {total_tokens, duration_ms, total_duration_seconds}`; timing comes from `ph fanout --collect` JSON or workflow records (tokens only when tracked from creation).
- Acceptance: fixture `grading.json` using `name/met/details` fails; a valid one passes.
- Source: MTH-29, D-37.
- Scope: v1

#### HARN-10 Trigger tests for generated project skills
- Requirement: every project skill the harness generates gets a trigger test (10 should-trigger and 10 near-miss requests, each run in a fresh `ph` agent, on the INV-50 test model unless the owner names another), recorded with precision and recall in the history row; `harness-evolve` re-runs at least 3 + 3 when a description changes; with-skill versus baseline runs and the blind A/B workflow remain optional.
- Acceptance: named live smoke on a fixture adapter's stack skill: the trigger record exists with 20 requests and results; lint warns when a generated skill has no trigger record.
- Source: MTH-47..52, D-57, INV-50.
- Scope: v1

#### HARN-11 Output language
- Requirement: agent definitions, skills, adapter files and history rows the harness writes are English whatever language the owner uses; replies and owner-facing deliverables stay in the owner's language.
- Acceptance: named live smoke: a generator run prompted in Vietnamese yields English adapter, skill and agent files and a Vietnamese summary to the owner.
- Source: MTH-55, HIS-68, INV-51.
- Scope: v1

#### HARN-12 harness-evolve
- Requirement: `harness-evolve` (method text carried) reads `.agents/harness-history.md`, `git log` of `.agents/`, `.claude/`, AGENTS.md, CLAUDE.md, run records (`_workspace/_runs/*/run.json`, `journal.jsonl` null reasons), `_workspace/review-metrics.jsonl` and phase `deferred.md`; maps feedback to the adapter part it touches; generalises, records the why, applies one change at a time, asks the owner on a regression conflict with an earlier row; appends a history row; re-runs trigger tests when a description changed; names kit-wide lessons for `kit pull <project> --kit <dir>`. Adapter-layer edits only: run-record paths, the `kit pull` command form, project settings in `.agents/harness.config.json`.
- Acceptance: kit test greps the shipped skill for the new run-record paths and the `kit pull` form; named live smoke on a fixture repo with two identical revision requests in history proposes an adapter change and appends one row.
- Source: MTH-57, MTH-58, MTH-59, D-58, D-60, D-111.
- Scope: v1

#### HARN-13 History table
- Requirement: `.agents/harness-history.md` has the table `| Date | Change | Scope | Reason | Supersedes |`, one row per change, newest last; lint requires Date, Change, Scope and Reason non-empty, ISO dates in non-decreasing order, Scope as repo-relative paths.
- Acceptance: lint fixtures: a row with empty Reason fails; dates out of order fail; a valid file passes.
- Source: MTH-60, HIS-66, D-60, INGEST-CONFLICTS W-11.
- Scope: v1

#### HARN-14 Always-loaded rules in the AGENTS.md block
- Requirement: the kit's marked AGENTS.md block (installed by M1) carries these rules: batch reads and edits with the available file tools, no re-read to verify a write, correctness first; derive a Definition of Done before execution and verify against it; never hand-roll polling, follow the printed `next:` command, end the turn while waiting; never retry quota, credit, billing, auth or permission failures; never fabricate a stopped agent's judgment, use only verified facts; fix the product, not the fixture; preflight 2-3 items through every stage before a fan-out; scripts own mechanical bookkeeping; pass paths, not content; clean up only what the agent created; mark unobserved claims `[UNVERIFIED]`; write long documents in parts and never message the main session from a worker.
- Acceptance: kit test asserts the shipped block contains each rule's anchor sentence; block length stays under the size recorded in the test.
- Source: MTH-40, MTH-42, MTH-43, MTH-44, MTH-63, HIS-38, HIS-55, D-53, INV-18, INV-42, INV-45, INV-46.
- Scope: v1

#### HARN-15 Shipped prompt-text changes and changelog
- Requirement: a change to shipped prompt text (AGENTS.md block, skill texts, agent overlays, watchdog steering texts) lands only with a CHANGELOG entry that names the owner's approval and date and the evidence; CHANGELOG entries are dated, name the decision and the measured check, keep an Unreleased section, and the top released section matches `kit.json` version.
- Acceptance: release check script fails when `kit.json` version and the top CHANGELOG section differ, and when a commit touching shipped prompt files has no CHANGELOG line in the same commit.
- Source: HIS-39, HIS-67, D-35, INV-49.
- Scope: v1

#### HARN-16 Harness licence and notice
- Requirement: `.claude/skills/harness/` ships `LICENSE` (Apache-2.0) and `NOTICE.md` (upstream repo, version 2.1.0, commit, the port's changes and the kit's adapter-layer edits) while any Harness-derived text ships.
- Acceptance: install check asserts both files exist in an installed project.
- Source: MTH-65, D-54.
- Scope: v1

#### HARN-17 ai-orchestrator skill
- Requirement: `.claude/skills/ai-orchestrator/` ships with its method text (Definition of Done, waiting rule) carried; adapter-layer edits only: the agent limit reads `max_subagents` from config instead of a fixed number, and Backlog wording is removed.
- Acceptance: HARN-01 diff test passes for the skill; grep finds no literal `20` agent limit and no `backlog`.
- Source: MTH-61, MTH-63, D-111, D-53.
- Scope: v1

#### HARN-18 Mechanical structure checks of generated workflows and orchestrators
- Requirement: within the HARN-05 scope lint checks generated workflow scripts and orchestrator skills mechanically: `meta` is a literal with `name` and `description`; every `phase()` title appears in `meta.phases`; every `agentType` resolves (HARN-07); a value from `agent()` or `parallel()` that is used as an array is guarded against `null` (`.filter(Boolean)` or an explicit check; warning when unguarded); an orchestrator skill states its execution mode at the top, each stage of a mixed one is labelled, and it has a `## Test scenarios` section with a normal and an error flow; semantic checks of the method (connected stage inputs and outputs, mode handoffs, dry run) stay a named manual check recorded in the history row.
- Acceptance: lint fixtures: a `phase('Build')` absent from `meta.phases` fails; a mixed orchestrator with an unlabelled stage fails; a missing `## Test scenarios` fails; an unguarded `parallel()` result warns.
- Source: MTH-46, MTH-51, MTH-54, MTH-35.
- Scope: v1

### M12 adapter (ADPT)

The adapter is project data: written by the harness (HARN-03), evolved by `harness-evolve` (HARN-12), read by M8, M9 and M10. The kit defines its contract and ships neutral defaults only (D-110).

#### ADPT-01 Location and loading
- Requirement: the adapter lives in the sections `adapter` and `gsd` of `.agents/harness.config.json` (project overlay) with kit defaults in `.agents/harness.defaults.json`, merged per entry and validated closed by the one M3 loader (unknown key: `invalid harness config <key>: <msg>`); no GSD code reads `.planning/config.json`.
- Acceptance: fixture overlay with `adapter.unknown_key` makes every `ph gsd` verb fail with the message (except `ph doctor`, which reports it); a `.planning/config.json` with different values has no effect.
- Source: D-77, UPS-77, UPS-03, RUN-06.
- Scope: v1

#### ADPT-02 `adapter.commands`
- Requirement: `adapter.commands` = `{build: argv|null, test: argv|null, build_timeout_s: 300, test_timeout_s: 600, gates: [{name, argv}], verify: {<kind>: {argv, timeout_s}}}`; commands are argv arrays run without a shell, from the code root; a null build or test is reported by the gate as `not configured` and never counted green.
- Acceptance: fixture adapter with `test: null`: the post-wave gate reports `test not configured` and blocks tracking; argv containing `;` is passed as one argument.
- Source: UPS-47, GSP-18, D-63, D-95.
- Scope: v1

#### ADPT-03 `adapter.verify_vocabulary`
- Requirement: `adapter.verify_vocabulary` = `{<kind>: {prefix, parser: path|null, resolver: path|null, runner: <commands.verify key>, evidence_parser: path|null, exit_code_sufficient: bool}}`; `<automated>` text starting with a registered prefix has that kind; the text after the prefix is the obligation `argument`; the parser (ADPT-15 `parse` request) turns it into `targets[]` (default: one target, the trimmed argument); the resolver (ADPT-15 `resolve` request) answers per target `ok|pending_creation|missing|unresolvable`, and the core itself sets `pending_shared` when a missing target is created by a plan's `<shared_changes>`; the runner is the `commands.verify` argv in which the placeholders `{argument}` and `{targets}` (each target one argv element) are substituted, no shell; `evidence_parser` (ADPT-15 `evidence` request) turns runner output into the ADPT-17 executed list; a kind with `exit_code_sufficient: true` (default only for `build` and `cmd`) may certify by exit code alone; the default vocabulary is `{build, cmd}` with `cmd` resolving the first path-like token against the code root.
- Acceptance: fixture adapter adding kind `test:` with parser, resolver and evidence parser scripts: a filter the resolver cannot find is `missing`; a target created in `<shared_changes>` is `pending_shared`; a target containing spaces reaches the runner as one argv element; with the default vocabulary only `build` and `cmd:` validate and `test:` is a blocker.
- Source: GSP-18, GSP-19, HIS-84, D-61.
- Scope: v1

#### ADPT-04 `adapter.ownership`
- Requirement: `adapter.ownership` = `{owns_forms: [{prefix, maps_to: path-glob}], shared: {globs[], predicate: path|null}, source_roots[]}`; default `owns_forms` is `[{prefix: "Path:", maps_to: "<path>"}]` with no shared globs; `check owns`, `outline check` and `plan-structure` use only this section for owns syntax and shared files.
- Acceptance: fixture adapter with `shared.globs: ["**/*.lock"]`: a plan owning `Path:pkg/` that covers `pkg/a.lock` reports a shared-file problem; with defaults it does not.
- Source: GSP-23, HIS-85, D-61, D-110.
- Scope: v1

#### ADPT-05 `adapter.review_lenses`
- Requirement: `adapter.review_lenses` = `[{name, text, stage: skeleton|plan_review|code (default code), applies_to: globs (default all files)}]` supplies the code-review lenses (GSDF-46) and may add skeleton or plan-review lenses (`stage: skeleton|plan_review|code`); with no project lens the code review uses one kit lens `correctness`.
- Acceptance: fixture adapter with lenses `security` and `perf` renders both into reviewer prompts for matching files only.
- Source: D-56, D-63, D-68, HIS-51.
- Scope: v1

#### ADPT-06 `adapter.syntax_checkers`
- Requirement: `adapter.syntax_checkers` = `{<extension>: {argv, timeout_s, max_parallel}}` is read by the kit syntax-check hook shell (M8) from the tree of the edited file; an extension without a checker is skipped before anything is spawned; the checker command must print `file:line:col: message` lines and exit non-zero on a syntax error.
- Acceptance: fixture adapter with `.json` -> a node one-liner checker: an edit that breaks a JSON file is reported once by the hook; a `.txt` edit spawns no process.
- Source: HOK-26, HOK-27, D-45, INV-27.
- Scope: v1

#### ADPT-07 `adapter.instructions`
- Requirement: `adapter.instructions` lists repo-relative project instruction files (coding rules, layout); they appear in planner, checker and executor required reading and are hashed into the `research` and `freeze` revision keys.
- Acceptance: fixture: editing a listed file makes `revisions check freeze` exit 1; the file path appears in the planner prompt.
- Source: GSP-29, GSP-44, D-61.
- Scope: v1

#### ADPT-08 `adapter.envelope`
- Requirement: optional `adapter.envelope` = `[{axis, values|range, source}]`; when present, executor briefs list the axes and the code-review prompt adds the rule "judge a fix against the declared envelope, not one sample point"; when absent both are omitted.
- Acceptance: fixture prompts with and without an envelope differ exactly by the axes block and the rule line.
- Source: HIS-61.
- Scope: v1

#### ADPT-09 Project agents and stack skill
- Requirement: `adapter.stack_skill` names one project skill in `.claude/skills/<stack>/` that executor and fixer prompts tell the agent to follow; `adapter.agents` maps GSD roles to project agent types that replace the generic agent for that role (`architect` enables the wiring stage, GSDF-20; `executor`, `reviewer`, `fixer` optional); every named skill and agent must exist (HARN-07).
- Acceptance: fixture adapter with `stack_skill: web-stack` renders "Follow the web-stack skill" in executor prompts; `agents.executor: my-coder` makes the execute run spawn `--type my-coder`; a missing agent file fails lint.
- Source: D-109, D-63, GSP-69, INGEST-CONFLICTS W-22.
- Scope: v1

#### ADPT-10 `adapter.mutex`
- Requirement: optional `adapter.mutex` names a machine-wide lock; gate commands and fixer builds take it before running heavy commands so only one runs at a time across worktrees; waiting is reported in the run log.
- Acceptance: fixture: two concurrent gate runs with a mutex and a 2 s fake command finish in at least 4 s with one `waiting for mutex` line.
- Source: HIS-62, D-81.
- Scope: v1

#### ADPT-11 `gsd.roles` and model precedence
- Requirement: `gsd.roles` maps roles (`research`, `project_researcher`, `synthesizer`, `outline`, `planner`, `checker`, `skeleton_lane`, `architect`, `plan_finder`, `plan_verifier`, `plan_judge`, `plan_editor`, `executor`, `reviewer`, `finding_verifier`, `fixer`, `verifier`, `mapper`, `roadmapper`, `debugger`) to `{model: tier|provider/model, effort, reason}`; every GSD flow passes the role name with each agent call (GSDF-18) and resolution follows PHCL-22: per-run argument > role table > agent `model:` > `default_tier`, model and effort independently; a role name outside this list and the table is invalid (usage error or configuration throw); a listed role with no entry falls back to the next layer; skeleton lanes may carry their own `model`/`effort` in `gsd.skeleton_lanes[]`, applied as per-run arguments; the kit defaults name tiers only, never a concrete model id.
- Acceptance: cross-module resolution matrix: role entry present, absent, effort-only; per-run override; per-lane override; plan-review finder and judge dispatch carry roles `plan_finder` and `plan_judge`; setting `roles.checker.model` changes the checker's model with no script edit; an unknown role name is rejected; a scan of the defaults finds no `provider/model` id in `gsd.roles`.
- Source: GSP-43, GSP-79, HIS-19, HIS-74, UPS-78, D-16, R-10.
- Scope: v1

#### ADPT-12 `gsd.granularity` and `gsd.plan_limits`
- Requirement: `gsd.granularity` `coarse|standard|fine` (default `standard`) is passed to planners; `gsd.plan_limits` = `{tasks_per_plan: 3, plans_per_phase: 12, waves_per_phase: 4}` (conservative defaults) is enforced by `outline check` (plan and wave ceilings) and `plan-structure` (task count, error; `handoff` refuses a plan over it); a phase may override limits through the plan args recorded from its CONTEXT; the kit text gives split reasons (overlapping owns in one wave, an ordering coupling, a gating spike, a plan too big for one coder context), not "prefer more, smaller plans".
- Acceptance: fixture plan with 4 tasks fails `plan-structure` and `handoff` refuses it; an outline of 13 plans fails under defaults and passes with a per-phase override of 15.
- Source: GSP-60, GSP-84, D-70, INGEST-CONFLICTS I-02.
- Scope: v1

#### ADPT-13 `gsd` section keys and defaults
- Requirement: the `gsd` section holds exactly: `roles`, `granularity`, `plan_limits`, `execution_mode` (`per-wave`), `batch_review` (true), `isolation` (`shared`|`worktree`, default `worktree`), `fixer_verifies_itself` (true), `max_verify_rounds` (4), `commit_policy {docs: false, code: per-wave}`, `branching` (`none`), `protected_branches` ([]), `requirement_id_regex`, `research` (true; false makes plan mode treat research as skipped with reason `gsd.research off`), `plan_review` (false), `skeleton_lanes` ([{lens, model?, effort?}]), `max_skeleton_passes` (3), `max_check_iterations` (3), `drift_threshold` (3), `debug {max_turns: 16, minutes: 120}`, `fixer {max_build_attempts: 3, minutes: 60}`, `parallelization {enabled: true, max_concurrent: null}` (GSDF-93), `review_depth` (`standard`, GSDF-92); the `adapter` section additionally holds `startup_globs` ([], GSDF-57), `hook_timeout_s` (30) and `attribution` (path|null) (ADPT-15); ranges are validated (passes and iterations 1..3).
- Acceptance: fixture overlay with `max_check_iterations: 4` fails validation; `ph config` shows every key with its provenance.
- Source: UPS-10, UPS-77, D-63, D-64, D-66, D-68, D-69, D-70, D-73, D-91.
- Scope: v1

#### ADPT-14 Absent keys take the defaults
- Requirement: merge depth follows CONF-04: an overlay that omits a top-level `gsd` or `adapter` entry gets the kit default for that entry (so a new gate shipped default-on applies without a project edit); an entry the overlay sets replaces the default entry wholly, so a nested object (`commands`, `plan_limits`, `commit_policy`, `debug`, `fixer`, `parallelization`, a role entry) must be written whole; closed validation names any missing nested key; the harness generator and new-project write whole entries.
- Acceptance: fixture with an empty overlay resolves every documented default; overlay `gsd.plan_limits: {plans_per_phase: 15}` fails validation naming `tasks_per_plan` and `waves_per_phase`; a whole `plan_limits` entry changes only that entry; partial `commands`, `debug`, `fixer` and `commit_policy` overlays fail with the missing key named.
- Source: UPS-04, D-77.
- Scope: v1

#### ADPT-15 Adapter hook invocation contract
- Requirement: adapter scripts are invoked without a shell: a `.mjs`/`.js` path as `[process.execPath, <abs script>]`, any other path as `[<abs script>]`; cwd = code root; timeout `adapter.hook_timeout_s` (default 30); stdin one JSON request `{v: 1, op, codeRoot, phaseDir?, ...}`; stdout one JSON line response `{v: 1, ...}`; the closed request/response shapes are: `parse` `{kind, argument}` -> `{targets: [string]}`; `resolve` `{kind, targets, plan, filesModified}` -> `{results: [{target, status: ok|pending_creation|missing|unresolvable, detail?}]}`; `shared` `{paths}` -> `{shared: [path]}` (ownership predicate, `adapter.ownership.shared.predicate`); `evidence` `{kind, argument, targets, exitCode, stdoutPath, stderrPath}` -> `{executed: {count, targets: [string]}, failed: [string], outcome: passed|failed|unavailable}`; `attribute` `{failures: [{text, file?}], plans: [{id, owns}]}` -> `{assignments: [{failure, plan|null}]}` (`adapter.attribution`); a non-zero exit, timeout, a response with another `v`, missing fields or unparsable output makes the calling check `unresolvable` (exit 69 for a verb, a failure for a gate), never a pass.
- Acceptance: a fixture adapter implemented only from this contract is exercised by planning (`parse`, `resolve`, `shared`) and execution (`evidence`, `attribute`), with the code root path containing spaces; a resolver that sleeps past the timeout, one that prints garbage and one returning `v: 2` all make `check verify-command-paths` report `unresolvable` and the checker loop count it as a warning, not ok.
- Source: D-61, GSP-19, INV-36.
- Scope: v1

#### ADPT-16 The kit ships no project adapter
- Requirement: shipped defaults carry a neutral adapter (`commands` null, default vocabulary, default ownership, no lenses beyond `correctness`, no checkers, no envelope, no mutex, no stack skill, no project agents); no project's adapter, stack skill or project agent ships.
- Acceptance: kit test compares the shipped `adapter` section with the neutral form and greps `ship/` for the vanilla deny list (GSDC-50).
- Source: D-110, P9, SYNTHESIS M12 acceptance.
- Scope: v1

#### ADPT-17 Gate-evidence contract
- Requirement: every gate run (GSDF-44) writes `<phaseDir>/evidence/<waveId>-<n>.json` `{v: 1, waveId, at, inputs: {head, files: {<path>: sha256}} (owned files of the wave's plans and adapter instructions at run time), steps: [{name build|test|<obligation id>, plan?, task?, kind?, argv, outcome passed|failed|timeout|unavailable|not_configured, exitCode, executed: {count|null, targets[]}, log}]}`; an obligation step's `executed` comes from the kind's `evidence_parser` or, for `exit_code_sufficient` kinds, is `null` with the exit code deciding; evidence certifies green only when it parses, every requested step is present, no step is timeout, unavailable or not_configured, every obligation that names targets executed at least one and no named target is missing, and `inputs` equals the current code; otherwise it is invalid, incomplete or stale and never certifies green, closes a debug session or counts as verify proof.
- Acceptance: fixture: a test runner that exits 0 after executing 0 tests yields a failed obligation; evidence whose `inputs` differ from the tree after a fixer edit is stale for the gate, the verifier and debug close; a log path that does not exist makes the evidence invalid.
- Source: HIS-82, HIS-84, UPS-47, INV-53, D-61.
- Scope: v1

### Later

Listed without acceptance; not in v1.

- GSDC-51 Planning snapshot verb and best-effort `.planning/state.json` publish (null, never guessed) - Source: UPS-82 - Scope: later
- GSDC-52 Cross-phase verification-debt audits `audit-uat`, `audit-open` - Source: UPS-55 - Scope: later
- GSDF-68 spec-phase ambiguity gate - Source: UPS-14, D-92 - Scope: later
- GSDF-69 ingest-docs (ADR/PRD import with conflict report) - Source: UPS-13 - Scope: later
- GSDF-70 Nyquist validation strategy and threat-model ASVS gate - Source: UPS-22 - Scope: later
- GSDF-71 UI design contract gate - Source: UPS-23 - Scope: later
- GSDF-72 Pattern mapper before planning - Source: UPS-24 - Scope: later
- GSDF-73 TDD gate - Source: UPS-53 - Scope: later
- GSDF-74 Autonomous milestone driver (single gap retry, retry ceiling 3, deferred rows) - Source: UPS-59 - Scope: later
- GSDF-75 `ph ship` through GitHub PRs (adapter flag) - Source: UPS-61, D-90 - Scope: later
- GSDF-76 Milestone lifecycle (audit, complete with dry-run default, new milestone, cleanup) - Source: UPS-62, D-93 - Scope: later
- GSDF-77 Dynamic routing with soft-failure tier escalation - Source: UPS-79 - Scope: later
- GSDF-78 Workstreams, workspaces, multi-repo - Source: UPS-85, D-93 - Scope: later
- GSDF-79 assumption-delta and API-coverage planning gates (fail closed on unresolvable scope) - Source: UPS-92 - Scope: later
- GSDF-80 Package legitimacy gate with registry thresholds - Source: UPS-93, UPS-20 - Scope: later
- GSDF-81 Supervised debug engine (tree digest, typed requests, budgets per run, deadline supervisor, snapshot revert/reapply, acceptance transactions, lease) - not part of the kit per D-78 - Source: GDB-02, GDB-03, GDB-13..21, GDB-25, GDB-27..30, GDB-33..44, GDB-47, GDB-49, GDB-57, GDB-60, GDB-61, GDB-63..68, HIS-56, HIS-79..82, GSP-40, D-78, D-79..D-88 - Scope: later
- GSDF-82 quick-batch - Source: D-76 - Scope: later
- GSDF-83 Discuss modes batch, analyze, all, auto, chain - Source: UPS-15 - Scope: later
- GSDF-84 Codebase drift auto-remap - Source: UPS-12 - Scope: later
- GSDF-85 Execute `--interactive` inline mode - Source: UPS-91 - Scope: later
- GSDF-86 Non-blocking post-planning gap table - Source: UPS-31 - Scope: later
- GSDF-87 Cross-model reviewer lanes as `ph` workers on other `circle` models - Source: UPS-36 - Scope: later
- GSDF-88 Fact-drift review axis (STATE vs ROADMAP vs PLAN consistency) - Source: UPS-35 - Scope: later
- GSDF-89 Utility workflows: node-repair, stats, session-report, validate-phase, secure-phase, add-tests, extract-learnings, docs-update, analyze-dependencies, scan - Source: UPS-63 - Scope: later
- GSDF-90 Symbol-to-owns plan check (tests using a changed symbol join the plan's owns) - Source: HIS-63 - Scope: later
- GSDF-91 Browser/DOM UAT branches - Source: UPS-54 - Scope: later

### Traceability

One row per behavior absorbed by M9..M12 (SYNTHESIS module table), plus the upstream (UPS), method (MTH) and debug (GDB) behaviors no other module absorbs.

| map behavior ID | requirement ID(s) |
| --- | --- |
| UPS-01 | GSDF-02 |
| UPS-02 | GSDF-01, GSDC-17 |
| UPS-03 | GSDC-01, ADPT-01 |
| UPS-04 | ADPT-14 |
| UPS-05 | GSDC-06 |
| UPS-06 | GSDF-07 |
| UPS-07 | GSDF-07, GSDF-95 |
| UPS-08 | GSDF-08, GSDC-01 |
| UPS-09 | GSDF-09 |
| UPS-10 | GSDF-07, ADPT-13 |
| UPS-11 | GSDF-05 |
| UPS-12 | GSDF-06, GSDF-84 (later) |
| UPS-13 | GSDF-69 (later) |
| UPS-14 | GSDF-68 (later) |
| UPS-15 | GSDF-10, GSDF-11, GSDF-83 (later) |
| UPS-16 | GSDC-21, GSDF-10 |
| UPS-17 | GSDF-10 |
| UPS-18 | GSDF-35, GSDC-17 |
| UPS-19 | GSDF-33 |
| UPS-20 | GSDF-12, GSDF-80 (later) |
| UPS-21 | GSDF-13 |
| UPS-22 | GSDF-70 (later) |
| UPS-23 | GSDF-71 (later) |
| UPS-24 | GSDF-72 (later) |
| UPS-25 | GSDF-17, GSDC-20 |
| UPS-26 | GSDF-24 |
| UPS-27 | GSDF-34, GSDF-01 |
| UPS-28 | GSDF-26 |
| UPS-29 | GSDF-27 |
| UPS-30 | GSDC-22, GSDF-29 |
| UPS-31 | GSDF-36, GSDF-86 (later) |
| UPS-32 | GSDF-03 |
| UPS-33 | not a requirement: dropped (plan bounce replaced by the plan-review stage, D-66) |
| UPS-34 | GSDF-37 |
| UPS-35 | GSDF-37, GSDF-88 (later) |
| UPS-36 | not a requirement: external review CLIs dropped (Claude Code only); cross-model lanes are GSDF-87 (later) |
| UPS-37 | GSDF-30, GSDF-93 |
| UPS-38 | not a requirement: capability/loop-hook system dropped (SYNTHESIS M9 dropped list) |
| UPS-39 | GSDC-25, GSDF-17 |
| UPS-40 | GSDC-17, GSDF-93 |
| UPS-41 | GSDF-38, GSDC-39 |
| UPS-42 | GSDC-36, GSDF-39 |
| UPS-43 | GSDF-40 |
| UPS-44 | GSDF-41, GSDF-94 |
| UPS-45 | GSDF-42, GSDF-94 |
| UPS-46 | GSDF-43 |
| UPS-47 | GSDF-44, GSDC-41, ADPT-02 |
| UPS-48 | GSDF-45 |
| UPS-49 | GSDF-42 |
| UPS-50 | GSDF-56 |
| UPS-51 | GSDC-15, GSDF-58 |
| UPS-52 | GSDF-54 |
| UPS-53 | GSDF-73 (later) |
| UPS-54 | GSDF-57, GSDC-16, GSDF-91 (later) |
| UPS-55 | GSDC-16, GSDF-57, GSDC-52 (later) |
| UPS-56 | GSDF-61 |
| UPS-57 | GSDF-61 |
| UPS-58 | GSDF-46, GSDF-92 |
| UPS-59 | GSDF-74 (later) |
| UPS-60 | GSDF-59 |
| UPS-61 | GSDF-75 (later) |
| UPS-62 | GSDF-76 (later) |
| UPS-63 | GSDF-58, GSDF-60, GSDF-62, GSDC-15, GSDC-42, GSDF-89 (later) |
| UPS-64 | GSDF-04, GSDC-45 |
| UPS-65 | not a requirement: dropped (compact variants never reach Claude Code agents) |
| UPS-66 | GSDC-04, GSDC-37, GSDC-40, GSDC-41 |
| UPS-67 | GSDC-02 |
| UPS-68 | GSDC-10, GSDC-11 |
| UPS-69 | GSDC-10, GSDC-12 |
| UPS-70 | GSDC-13, GSDC-08, GSDF-59 |
| UPS-71 | GSDC-14 |
| UPS-72 | GSDC-34 |
| UPS-73 | GSDC-02, GSDC-35 |
| UPS-74 | GSDC-39, GSDF-53 |
| UPS-75 | GSDC-07, GSDC-09 |
| UPS-76 | GSDC-18 |
| UPS-77 | ADPT-01, ADPT-13 |
| UPS-78 | ADPT-11 |
| UPS-79 | GSDF-77 (later) |
| UPS-80 | not a requirement: dropped (multi-runtime tier maps; per-role models in ADPT-11) |
| UPS-81 | GSDC-38, GSDF-31 |
| UPS-82 | GSDC-51 (later) |
| UPS-83 | GSDC-42 |
| UPS-84 | not a requirement: hooks area (M8 context guard replaces the upstream monitor) |
| UPS-85 | GSDF-78 (later) |
| UPS-86 | not a requirement: dropped (host interface, capabilities, installer; owner Claude-only) |
| UPS-87 | GSDC-44, GSDC-53 |
| UPS-88 | GSDF-17 |
| UPS-89 | GSDF-42 |
| UPS-90 | GSDF-42, GSDF-93 |
| UPS-91 | GSDF-11, GSDF-85 (later) |
| UPS-92 | GSDF-79 (later) |
| UPS-93 | GSDF-80 (later) |
| UPS-94 | GSDC-40, GSDF-62 |
| GSP-01 | GSDC-44 |
| GSP-02 | GSDC-44 |
| GSP-03 | GSDC-45 |
| GSP-04 | GSDC-45 |
| GSP-05 | GSDC-46, GSDF-42 |
| GSP-06 | GSDC-46 |
| GSP-07 | GSDC-45 |
| GSP-08 | GSDC-45, GSDC-47 |
| GSP-09 | GSDC-47 |
| GSP-10 | GSDC-48 |
| GSP-11 | GSDC-04 |
| GSP-12 | GSDC-02 |
| GSP-13 | GSDC-05 |
| GSP-14 | GSDC-06 |
| GSP-15 | GSDC-07 |
| GSP-16 | GSDC-09 |
| GSP-17 | GSDC-18 |
| GSP-18 | GSDC-19, ADPT-03 |
| GSP-19 | GSDC-19, ADPT-15 |
| GSP-20 | GSDC-20 |
| GSP-21 | GSDC-21 |
| GSP-22 | GSDC-22 |
| GSP-23 | GSDC-23, ADPT-04, GSDF-41 |
| GSP-24 | GSDC-24 |
| GSP-25 | GSDC-25 |
| GSP-26 | GSDC-25, GSDC-27 |
| GSP-27 | GSDC-26 |
| GSP-28 | GSDC-27 |
| GSP-29 | GSDC-28, ADPT-07 |
| GSP-30 | GSDC-29 |
| GSP-31 | GSDC-30 |
| GSP-32 | GSDC-31 |
| GSP-33 | GSDC-32 |
| GSP-34 | GSDC-33 |
| GSP-35 | GSDC-34 |
| GSP-36 | GSDC-35 |
| GSP-37 | GSDC-17, GSDC-37 |
| GSP-38 | GSDF-15 |
| GSP-39 | GSDF-03 |
| GSP-40 | GSDF-81 (later; D-88 closed by D-78) |
| GSP-41 | GSDF-16 |
| GSP-42 | GSDF-14 |
| GSP-43 | GSDF-18, ADPT-11 |
| GSP-44 | GSDF-17, ADPT-07 |
| GSP-45 | GSDF-17 |
| GSP-46 | GSDF-01, GSDF-27 |
| GSP-47 | GSDF-19 |
| GSP-48 | GSDF-20 |
| GSP-49 | GSDF-21 |
| GSP-50 | GSDF-22 |
| GSP-51 | GSDF-21 |
| GSP-52 | GSDF-23 |
| GSP-53 | GSDF-24 |
| GSP-54 | GSDF-25 |
| GSP-55 | GSDF-26 |
| GSP-56 | GSDF-29 |
| GSP-57 | GSDF-30 |
| GSP-58 | GSDF-31, GSDC-38 |
| GSP-59 | GSDC-45 |
| GSP-60 | ADPT-12, GSDC-25 |
| GSP-61 | GSDF-12 |
| GSP-62 | GSDF-13 |
| GSP-63 | GSDF-12 |
| GSP-64 | GSDF-55 |
| GSP-65 | GSDC-34 |
| GSP-66 | not a requirement: code-wave dropped (D-109); its generic contract is in GSDC-27, GSDF-42, GSDF-44 |
| GSP-67 | not a requirement: code-wave dropped (D-109); the gate rules are GSDF-46 |
| GSP-68 | not a requirement: dropped (project-specific packet gate; D-110) |
| GSP-69 | GSDF-04 |
| GSP-70 | GSDF-10 |
| GSP-71 | GSDF-02 |
| GSP-72 | GSDC-10, GSDC-12 |
| GSP-73 | GSDC-01 |
| GSP-74 | GSDC-24 |
| GSP-75 | GSDF-01, GSDF-28 |
| GSP-76 | GSDF-32 |
| GSP-77 | GSDC-50 |
| GSP-78 | GSDC-49, GSDF-53 |
| GSP-79 | ADPT-11 |
| GSP-80 | GSDF-37 |
| GSP-81 | GSDF-49 |
| GSP-82 | GSDC-03 |
| GSP-83 | not a requirement: documentation drift settled by D-74, D-75 (applied in GSDF-15, GSDF-27, GSDC-28) |
| GSP-84 | GSDC-25, ADPT-12 |
| GSP-85 | GSDF-49 |
| GSP-86 | GSDF-49 |
| GDB-01 | GSDF-64 |
| GDB-02 | GSDF-81 (later, D-78, D-85) |
| GDB-03 | GSDF-81 (later, D-78, D-85) |
| GDB-04 | not a requirement: closed by D-85; INV-54 applies only where the kit restores files, none in M9-M12 v1 (undo uses `git revert`) |
| GDB-05 | GSDF-38 |
| GDB-06 | GSDF-64, GSDC-01 |
| GDB-07 | GSDC-43 |
| GDB-08 | GSDC-43 |
| GDB-09 | GSDC-43 |
| GDB-10 | GSDC-43 |
| GDB-11 | GSDC-43 |
| GDB-12 | GSDC-43 |
| GDB-13 | GSDF-81 (later, D-78, D-79) |
| GDB-14 | GSDF-81 (later, D-78) |
| GDB-15 | GSDF-81 (later, D-78) |
| GDB-16 | GSDF-81 (later, D-78) |
| GDB-17 | GSDF-81 (later, D-78) |
| GDB-18 | GSDF-81 (later, D-78) |
| GDB-19 | GSDF-81 (later, D-78) |
| GDB-20 | GSDF-81 (later, D-78) |
| GDB-21 | GSDF-81 (later, D-78) |
| GDB-22 | GSDF-64, GSDC-46 |
| GDB-23 | GSDF-65 |
| GDB-24 | GSDF-65, GSDC-43 |
| GDB-25 | GSDF-81 (later, D-78) |
| GDB-26 | GSDF-66 |
| GDB-27 | GSDF-81 (later, D-78, D-86) |
| GDB-28 | GSDF-81 (later, D-78) |
| GDB-29 | GSDF-81 (later, D-78) |
| GDB-30 | GSDF-81 (later, D-78) |
| GDB-31 | GSDF-67 |
| GDB-32 | GSDC-43 |
| GDB-33 | GSDF-81 (later, D-78, D-81) |
| GDB-34 | GSDF-81 (later, D-78) |
| GDB-35 | GSDF-81 (later, D-78) |
| GDB-36 | GSDF-81 (later, D-78) |
| GDB-37 | GSDF-81 (later, D-78) |
| GDB-38 | GSDF-81 (later, D-78) |
| GDB-39 | GSDF-81 (later, D-78) |
| GDB-40 | GSDF-81 (later, D-78) |
| GDB-41 | GSDF-81 (later, D-78) |
| GDB-42 | GSDF-81 (later, D-78) |
| GDB-43 | GSDF-81 (later, D-78) |
| GDB-44 | GSDF-81 (later, D-78) |
| GDB-45 | GSDC-45 |
| GDB-46 | GSDF-66 |
| GDB-47 | GSDF-81 (later, D-78) |
| GDB-48 | GSDF-66 |
| GDB-49 | GSDF-81 (later, D-78, D-79) |
| GDB-50 | GSDF-64 |
| GDB-51 | GSDF-64, GSDF-65 |
| GDB-52 | GSDF-63 |
| GDB-53 | GSDF-63 |
| GDB-54 | GSDC-47 |
| GDB-55 | not a requirement: `state.json` is not carried (D-82); one status vocabulary in the session file |
| GDB-56 | GSDC-02 |
| GDB-57 | GSDF-81 (later, D-78) |
| GDB-58 | GSDC-43, GSDF-64 |
| GDB-59 | GSDF-66 |
| GDB-60 | GSDF-81 (later, D-78) |
| GDB-61 | GSDF-81 (later, D-78) |
| GDB-62 | GSDF-64 |
| GDB-63 | GSDF-81 (later, D-78) |
| GDB-64 | GSDF-81 (later, D-78) |
| GDB-65 | GSDF-81 (later, D-78) |
| GDB-66 | GSDF-81 (later, D-78) |
| GDB-67 | GSDF-81 (later, D-78) |
| GDB-68 | GSDF-81 (later, D-78) |
| MTH-01 | HARN-01, HARN-02 |
| MTH-02 | HARN-01 |
| MTH-03 | HARN-01 |
| MTH-04 | HARN-01, HARN-03 |
| MTH-05 | HARN-01, HARN-06 |
| MTH-06 | HARN-01 |
| MTH-07 | HARN-01 |
| MTH-08 | HARN-01 |
| MTH-09 | HARN-01 |
| MTH-10 | HARN-07, HARN-03 |
| MTH-11 | HARN-01, HARN-03 |
| MTH-12 | HARN-08, HARN-02 |
| MTH-13 | HARN-08, HARN-02 |
| MTH-14 | HARN-01, HARN-05 |
| MTH-15 | HARN-01 |
| MTH-16 | HARN-01 |
| MTH-17 | HARN-01 |
| MTH-18 | HARN-01 |
| MTH-19 | HARN-01 |
| MTH-20 | HARN-01 |
| MTH-21 | HARN-02 |
| MTH-22 | HARN-05 |
| MTH-23 | HARN-05 |
| MTH-24 | HARN-05 |
| MTH-25 | HARN-01 |
| MTH-26 | HARN-01 |
| MTH-27 | HARN-05 |
| MTH-28 | HARN-01 |
| MTH-29 | HARN-09 |
| MTH-30 | HARN-01 |
| MTH-31 | HARN-01 |
| MTH-32 | HARN-01 |
| MTH-33 | HARN-01 |
| MTH-34 | HARN-01 |
| MTH-35 | HARN-01 |
| MTH-36 | HARN-01 |
| MTH-37 | HARN-01 |
| MTH-38 | HARN-01 |
| MTH-39 | HARN-01 |
| MTH-40 | HARN-14 |
| MTH-41 | HARN-01 |
| MTH-42 | HARN-14 |
| MTH-43 | HARN-14 |
| MTH-44 | HARN-14 |
| MTH-45 | HARN-01 |
| MTH-46 | HARN-05, HARN-06, HARN-07, HARN-18 |
| MTH-47 | HARN-10 |
| MTH-48 | HARN-10 |
| MTH-49 | HARN-01 |
| MTH-50 | HARN-01 |
| MTH-51 | HARN-01 |
| MTH-52 | HARN-10 |
| MTH-53 | HARN-01 |
| MTH-54 | HARN-05, HARN-18 |
| MTH-55 | HARN-11 |
| MTH-56 | HARN-01 |
| MTH-57 | HARN-12 |
| MTH-58 | HARN-12 |
| MTH-59 | HARN-12 |
| MTH-60 | HARN-13 |
| MTH-61 | HARN-17 |
| MTH-62 | HARN-03 |
| MTH-63 | HARN-14, HARN-17 |
| MTH-64 | GSDF-46 |
| MTH-65 | HARN-16 |
| MTH-66 | HARN-01 |
| MTH-67 | HARN-01 |
| MTH-68 | HARN-01 |
| MTH-69 | HARN-02 |
| MTH-70 | HARN-02 |
| MTH-71 | GSDF-48 |
| MTH-72 | HARN-06 |
| MTH-73 | HARN-02 |
| HIS-19 | ADPT-11, GSDF-18 |
| HIS-38 | HARN-14 |
| HIS-39 | HARN-15 |
| HIS-42 | GSDC-49 |
| HIS-43 | GSDC-44, GSDC-47 |
| HIS-44 | GSDF-02 |
| HIS-45 | GSDF-21, GSDF-22 |
| HIS-46 | GSDF-26, GSDF-28 |
| HIS-47 | GSDC-28 |
| HIS-48 | GSDF-32, GSDC-30 |
| HIS-49 | GSDC-10, GSDC-12 |
| HIS-50 | GSDF-37 |
| HIS-51 | GSDF-46, GSDF-48 |
| HIS-52 | not a requirement: superseded by HIS-51 (no review fix-round key in config) |
| HIS-53 | GSDF-47 |
| HIS-54 | GSDF-50 |
| HIS-55 | GSDF-66, HARN-14 |
| HIS-56 | GSDF-81 (later, D-78) |
| HIS-57 | GSDF-67 (engine lessons later in GSDF-81) |
| HIS-58 | GSDF-52 |
| HIS-59 | GSDF-51 |
| HIS-60 | GSDF-20, GSDC-27 |
| HIS-61 | ADPT-08 |
| HIS-62 | ADPT-10 |
| HIS-63 | GSDF-90 (later; project parts dropped, D-110) |
| HIS-66 | HARN-13 |
| HIS-67 | HARN-15 |
| HIS-68 | HARN-11 |
| HIS-69 | GSDC-10 |
| HIS-70 | GSDC-10, GSDF-60 |
| HIS-74 | ADPT-11 |
| HIS-79 | GSDF-81 (later, D-78) |
| HIS-80 | GSDF-81 (later, D-78) |
| HIS-81 | GSDF-67 (engine contracts later in GSDF-81) |
| HIS-82 | GSDF-44, ADPT-17 (validators; engine later in GSDF-81) |
| HIS-83 | not a requirement: code-wave result schema dropped (D-109); cache-key rule owned by M6 (D-29) |
| HIS-84 | GSDF-44, ADPT-17 |
| HIS-85 | GSDC-23, ADPT-04 |
| HIS-86 | GSDC-49, GSDF-10, GSDF-12 |
| HOK-26 | ADPT-06 |
| HOK-27 | ADPT-06 |
| WFL-46 | GSDF-46 |

### Counts

| item | count |
| --- | --- |
| v1 requirements | 157 (GSDC 51, GSDF 71, HARN 18, ADPT 17) |
| later items | 26 (GSDC 2, GSDF 24) |
| behaviors traced | 363 (UPS 94, GSP 86, GDB 68, MTH 73, HIS 39, HOK 2, WFL 1) |
| behaviors traced to a v1 requirement | 290 |
| behaviors traced only to later items | 58 |
| behaviors not a requirement | 15 |

### Revision log r1

| finding ID | accepted / rejected | what changed (requirement IDs) or why rejected |
| --- | --- | --- |
| SR-MTD-01 | accepted | GSDC-45: strict snapshot validation before the first output write, failure leaves generated files unchanged; GSP-08 traced to GSDC-45 and GSDC-47. |
| SR-MTD-02 | accepted | GSDF-22: `both` routing, architect realignment after outline revisions, first-edge wiring creation plus integration blocker, no-architect fallback; new acceptance cases. |
| SR-MTD-03 | accepted | GSDF-38: execute baseline file and working-tree reconciliation (uncommitted owned edits, untracked files, unauthorized paths, root/HEAD drift) before every dispatch; no snapshot engine (D-78 kept). |
| SR-MTD-04 | accepted | GSDF-57: claim reconciliation through commits.json and gate evidence, cold-start test injection by `adapter.startup_globs`, resolved-gap reconciliation on resume; ADPT-13 key. |
| SR-MTD-05 | accepted | New GSDF-92 (scope precedence, SUMMARY cross-check, exclusions, review record schema, `<NN>-REVIEW.md`); GSDF-46 references it; one-pass D-56 gate kept; UPS-58 traced to GSDF-46, GSDF-92. |
| SR-MTD-06 | accepted | New GSDF-93 (execute args, `--gaps-only` key refusal, `gsd.parallelization`, per-run state, auto-chain flag not used); ADPT-13 keys; UPS-37, UPS-40, UPS-90 traces. |
| SR-MTD-07 | accepted | New HARN-18 (mechanical workflow/orchestrator checks; semantic checks a named manual check); HARN-05 Write-without-Edit warning; MTH-49, MTH-50 traced to HARN-01 (carried testing guide); MTH-14, MTH-46, MTH-54 traces updated; A/B stays optional. The proposed iteration-overwrite test is not added: iterations are an agent procedure in carried method text, not kit code. |
| SR-MTD-08 | accepted | ADPT-15 rewritten with invocation (no shell, interpreter rule), versioned closed request/response shapes (`parse`, `resolve`, `shared`, `evidence`, `attribute`), timeout key; ADPT-03 parser/runner/placeholder binding and core-set `pending_shared`; ADPT-05 `stage` and defaults; ADPT-13 `hook_timeout_s`, `attribution`; GSDF-51 uses `attribute`. |
| SR-MTD-09 | accepted | New ADPT-17 gate-evidence contract (inputs identity, steps, executed counts, outcome, logs, certification rule); GSDF-44, GSDF-55, GSDF-67 consume it; HIS-82, HIS-84 traced. |
| SR-MTD-10 | accepted | GSDC-13: ordered truth table with completion record `complete.json` and plan halt records and their writers; truth-table acceptance through find-phase, roadmap analyze and router; GSDC-36 defines `halted`, `blocked_by`, `ready`. |
| SR-MTD-11 | accepted | GSDC-30: field meanings and key from the host-given `ph workflow` run id (resume keeps it, fresh run gets a new one; no UUID machinery, consistent with D-67/D-87); GSDF-12 fresh-versus-resume rule and tests. |
| SR-MTD-12 | accepted | GSDC-12, GSDF-01, GSDF-50, GSDC-50: bans scoped to kit-authored files and runtime blocks, upstream bodies unchanged with last-applied overlays; HARN-01: inventoried adapter regions with recorded replacements, NOTICE alone does not admit a hunk. |
| SR-MTD-13 | accepted | GSDF-30: gap handoff without tracer split and exactly one execution wave, multi-wave -> needs-owner before dispatch, `waveExecuted` persisted in the attempt (GSDC-30). |
| SR-MTD-14 | accepted | GSDF-50: fixer attempt/time/no-progress bounds, structured unresolved result, orchestrator deadline; GSDF-67: turn defined, budget persisted in session frontmatter, per-turn wait timeout; ADPT-13 `fixer` keys. |
| SR-MTD-15 | accepted | New GSDF-94 worktree transfer transaction; GSDF-41 integrates through it; workers still never commit. |
| SR-MTD-16 | accepted | GSDF-53 `Plans:` trailer and `commits.json`; GSDC-39 wave scopes and per-plan file mapping; GSDC-40 `shared` marking; GSDF-62 refuses a partial revert of a shared wave commit. |
| SR-MTD-17 | accepted | New GSDF-95 roadmapper draft contract (overlay redirect to `.planning/drafts/`, orchestrator install after approval); GSDF-07 and GSDC-01 updated; UPS-07 traced. |
| SR-MTD-18 | accepted | GSDF-49 one stage sequence per mode with the W-18 phase-level review; GSDF-47 per-wave only, batch reviews recorded code-only; GSDF-46 routes batch findings to the final fixer. |
| SR-MTD-19 | accepted | ADPT-11 aligned with PHCL-22 (invalid name vs listed role without entry), roles added for plan-review finder/verifier/judge and new-project researchers, per-lane overrides; GSDF-18 passes `agent({role})`. |
| SR-MTD-20 | accepted | ADPT-14 narrowed to CONF-04 one-level merge: set nested entries are written whole, validation names missing nested keys; tests for partial overlays. |
| SR-MTD-21 | accepted | GSDC-01: install seeds only the empty `.planning/` (INST-17) and one initialization predicate `init.project`; GSDF-08 uses it; startup-flow acceptance. |
| SR-MTD-22 | accepted | GSDF-63: the active-phase STATE session note by the orchestrator is the sole exception; separate acceptance for active and non-active investigations. |
| SR-MTD-23 | accepted | GSDC-02 names `run-with-timeout` as the only passthrough (JSON last line), `hash`/`normalize-test-command` return JSON, dispatcher preserves exit codes; GSDC-31, GSDC-41 output shapes. |
| SR-MTD-24 | accepted | New GSDC-53 method text inventory used by build and check; GSDC-45 and the GSDF introduction refer to it; UPS-87 traced. |
| SR-MTD-25 | accepted | GSDC-12 guards every mutator of PROJECT/STATE/ROADMAP/REQUIREMENTS including `health --repair`; GSDC-31 confines `write` to a resolved phase directory. |
| SR-MTD-26 | accepted | GSDF-22 acceptance replaced with the deterministic 3 -> 2 -> 1 and 3 -> 2 -> 2 sequences. |
| SR-MTD-27 | accepted | HARN-05 scoped to generated or adapter-referenced assets (owner content advisory with `--all`); HARN-06 fails operational uses only, bare mentions warn, provider settings untouched (D-06). |
