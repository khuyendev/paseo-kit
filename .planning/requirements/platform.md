# Requirements: platform (M1 install, M2 machine, M3 config)

**Defined:** 2026-10-20
**Inputs:** `.planning/intel/SYNTHESIS.md` (modules M1, M2, M3), `DECISIONS.md` (D-01..D-111), `INGEST-CONFLICTS.md`, `PHASES-DRAFT.md`, maps `install.md`, `runtime.md`, `hooks.md`, `files.md`, `history.md`.

Conventions: `kit.mjs` is the kit CLI (`node <kit>/kit.mjs <verb>`); "project" is the install target; P/K/I are the project, kit and installed (manifest) digests. Exit codes follow P8: 0 done, 1 usage or file error, 2 done with differences, conflicts or problems. Every acceptance runs offline with fakes (INST-29) unless it names a manual check. The kit is vanilla (D-110): nothing here names a project, engine or game; project data comes from the adapter (ADPT requirements). Hook behavior is specified in HOOK, file-tool behavior in FTOL, `ph` behavior in PHCL; this file specifies only what install, machine and config enforce.

## v1 Requirements

## INST: install (M1)

### INST-01 CLI surface and exit contract
- Requirement: `kit.mjs install|update|status <project> [--force] [--enable-plugin]` and `kit.mjs pull <project> [<part>...] [--force] [--kit DIR]` accept flags anywhere after the verb; an unknown verb, a missing `<project>`, an unknown `--flag`, a second positional for a verb other than `pull`, or `--enable-plugin` with `status`/`pull` exits 1 with a usage line on stderr and writes nothing; expected failures print `failed: <msg>`, unexpected ones `error: <msg>` (exit 1); exit 2 means done with conflicts, kept parts or blocked hooks left; `install`, `update` and `pull` print `platform <os> <arch>, node <version>` as the first stdout line, `status` does not.
- Acceptance: offline test runs every bad-argument case per verb: exit 1, usage line on stderr, project tree hash unchanged; an `update` with one kept part exits 2; the first stdout line of `install` matches `^platform \S+ \S+, node v?\d`.
- Source: INS-01, INS-02, D-14, P8.
- Scope: v1

### INST-02 Target refusal
- Requirement: the target is refused with exit 1 and no write when it does not exist (`failed: <path> does not exist`), is not a folder (`failed: <path> is not a folder`), or equals the kit root or lies inside it by path-segment comparison, case-insensitive on Windows (`failed: the project cannot be the kit itself`); a sibling whose name merely starts with the kit folder name (e.g. `paseo-kit-x`) is accepted.
- Acceptance: four fixture targets (missing, file, `<kit>/ship/x`, sibling `<kit>-x`): first three exit 1 with the named message and leave kit and target unchanged; the sibling installs with exit 0.
- Source: INS-02, INV-04, INV-52.
- Scope: v1

### INST-03 Shipped units
- Requirement: the units are the files `kit.json` lists as shipped (keyed by forward-slash path relative to `ship/`) plus one block unit per file in `ship/blocks/`, keyed `<NAME>#paseo-harness-kit`; a path with a `tests/`, `__tests__/` or `node_modules/` segment, a file named `test_*`, or `*.test|spec.(mjs|cjs|js|ts|mts|cts|jsx|tsx)` is never a unit; a kit self-check fails when `kit.json` lists such a file or a file that does not exist.
- Acceptance: after install the manifest keys equal the `kit.json` list plus the block keys; no key and no installed file matches the test patterns; the self-check test fails on a fixture `kit.json` listing `x.test.mjs` or a missing file.
- Source: INS-03, install INV-12, D-10.
- Scope: v1

### INST-04 Line-ending-insensitive digest
- Requirement: one shared helper computes every digest as the full 64-char lowercase hex sha256 of the bytes with CRLF replaced by LF; a block digest is the same function over the body between its markers, trimmed; ownership decisions use digests only, never timestamps.
- Acceptance: unit test: LF and CRLF variants give equal 64-char digests, non-UTF-8 bytes hash stably; install, convert one installed file to CRLF and touch its mtime: `status` exits 0 with `status: every kit part is the same ...`; grep finds one digest implementation in `ship/`.
- Source: INS-04, INV-02, install C-5.
- Scope: v1

### INST-05 Manifest format
- Requirement: `install`, `update` and `pull` write `.agents/harness-kit.json` as 2-space JSON with a trailing newline holding exactly `_notes`, `version` (from `kit.json` at write time), `installedAt` (set by install, preserved by update and pull), `updatedAt` (ISO time of the write) and `files` (unit key -> digest, keys sorted by code point); it holds no kit path and no absolute path; `status` never writes it.
- Acceptance: install then update: top-level keys are exactly the five; `installedAt` unchanged, `updatedAt` changed; `files` key order equals a code-point sort (fixture keys `B.md`, `a.md`); the manifest text contains neither the kit path nor the project path in any slash form.
- Source: INS-05, D-04, install C-4, install C-16, INV-09.
- Scope: v1

### INST-06 Six-state classification
- Requirement: for every current unit and every manifest file key the kit no longer ships, with P, K, I null when absent, the state is: K null -> `gone` (P null), `removed` (P == I), else `removed-local`; else P null -> `missing`; P == K -> `same`; P == I -> `kit-newer`; K == I -> `local`; else `both`. Fixed help texts: missing "update adds it"; kit-newer "update takes it"; local "pull copies it into the kit; update --force replaces it with the kit version"; both "merge by hand, then pull --force or update --force"; removed "update deletes it"; removed-local "delete or keep it by hand".
- Acceptance: table test over every (P, K, I) equality pattern returns the state and help text above; `status` prints the help text verbatim.
- Source: INS-06, INV-01, INV-02.
- Scope: v1

### INST-07 Retired files and blocks
- Requirement: `update` deletes a recorded file, or removes a recorded block with its markers, that the kit no longer ships only in state `removed` (project digest equals the recorded one), printing `deleted <rel> (no longer in the kit)`; a `removed-local` part is kept and listed and counts toward exit 2, also with `--force`; a file of the same name without a manifest record is never deleted.
- Acceptance: fixture manifest with one unchanged and one edited retired file and one unchanged retired block: `update --force` deletes the first and the block (AGENTS.md text outside the markers byte-identical), keeps the second, exits 2; an unrecorded same-named file survives.
- Source: INS-07, D-11, INV-03.
- Scope: v1

### INST-08 install
- Requirement: `install` fails with `failed: .agents/harness-kit.json exists: already installed; use update` (exit 1) when a current-format manifest exists (an older-format one is handled by INST-31); otherwise a unit whose project version differs from the kit is kept, not recorded, and listed as `conflict <rel>: the project has a different version and kept it (install --force replaces it)`; other units are copied and recorded; wiring runs (INST-18); the manifest is written even when conflicts exist; the last line is `installed paseo-kit <version>; machine setup (once per machine): node "<kit>/kit.mjs" machine check`; exit 2 when any conflict or blocked hook, else 0. A conflict kept at install is reported as `both` by the next `update`.
- Acceptance: pre-existing differing copy of a kit skill file: install exits 2, manifest written without that key, file byte-identical; `update` prints `kept <rel> (both: ...)` and exits 2; `update --force` makes it equal to the kit; a second `install` exits 1 with the message.
- Source: INS-08, INS-09, INV-01, HIS-33.
- Scope: v1

### INST-09 update
- Requirement: `update` fails with `failed: not installed; use install` (exit 1) without a manifest and refuses an older-format manifest (INST-31); manifest records follow INST-32; per state: `same` records K silently; `gone` drops the key; `missing`, `kit-newer`, and with `--force` `local`/`both`, copy the kit version, record K and print `updated <rel>`; `removed` deletes (INST-07); every other part prints `kept <rel> (<state>: <help>)`; then wiring, then the manifest; summary `update: N part(s) changed, M kept; kit <version>` where M counts kept parts plus blocked hooks; exit 2 when M > 0, else 0.
- Acceptance: edit an installed kit hook: `update` keeps it, prints `kept .claude/hooks/<x> (local: ...)`, exits 2; `update --force` replaces it; a following plain `update` prints `0 kept` and exits 0.
- Source: INS-10, INV-01.
- Scope: v1

### INST-10 status
- Requirement: `status` is read-only, fails exit 1 without a manifest, prints one line `<state padded to 13> <rel>  (<help>)` per part not `same`/`gone`, then `status: N part(s) differ; project on kit <installed>, kit now <kit>` or `status: every kit part is the same; project on kit <installed>, kit now <kit>`; exit 2 when any part differs, else 0.
- Acceptance: fresh install -> exit 0 and the "every kit part" line; one edited unit -> exit 2 and one `local` line; project tree hash and mtimes identical before and after.
- Source: INS-11.
- Scope: v1

### INST-11 pull
- Requirement: `pull` resolves the kit folder from `--kit DIR`, else `$PASEO_KIT`, else the folder of the running `kit.mjs`; normalizes part names (backslash to `/`, leading `./` stripped) and validates all of them first: a name matching no unit prints `failed pull <part>: not a kit part` and exits 1 before any copy; it copies `local` parts (and `both` with `--force`) from the project into the kit (a block part overwrites `ship/blocks/<NAME>` with the project block body), records the project digest, prints `pulled <rel>`; `missing`, `kit-newer`, `removed`, `removed-local` and `both` without `--force` print `skipped <rel> (<state>: <help>)` and give exit 2; the closing line is `pull: N part(s) copied into the kit`, plus `; record them in the kit CHANGELOG.md and commit the kit, then update the other projects` when N > 0.
- Acceptance: edit an owned file, `pull <project> <rel> --kit <tmpkit>`: the tmp kit file equals the project file, `status` then reports `same`, the closing line carries the CHANGELOG reminder; `pull <project> nope.md` exits 1 and the kit tree is unchanged.
- Source: INS-12, INS-13, D-04, D-14, install C-6.
- Scope: v1

### INST-12 Marked AGENTS.md block
- Requirement: each block unit lives in the project file of the same name between a line starting `<!-- PASEO-HARNESS-KIT START` and `<!-- PASEO-HARNESS-KIT END -->`; an existing block body is replaced in place with every byte outside the markers unchanged; an absent block is inserted at the top, followed by a blank line and the old content; a missing file is created; the file keeps CRLF when it has any CRLF, else LF; malformed markers (END before START, or more than one START) are reported as `conflict <file>#paseo-harness-kit: malformed kit block markers; fix by hand`, the file is not written, exit 2. The block text itself is specified by the HARN requirements (always-loaded rules).
- Acceptance: CRLF AGENTS.md with text before and after the block and a changed kit block: `update` changes only the body bytes and keeps CRLF; no AGENTS.md -> created with the block; AGENTS.md without markers -> block, blank line, old text; malformed fixture -> exit 2, file byte-identical.
- Source: INS-14, HIS-88, D-05, INV-01.
- Scope: v1

### INST-13 Project text inside the kit block is flagged
- Requirement: whenever the project block body differs from the shipped block body (whatever its three-digest state, recorded or not), `status` prints, besides the state line, `warning AGENTS.md#paseo-harness-kit: text inside the kit block; project text belongs outside the markers`, and `pull` of that block part prints the same warning; the warning changes neither the state (INST-06) nor the update, `--force` and pull rules (a `both` block still needs `--force` to be pulled or replaced).
- Acceptance: three fixtures: `local` block (kit unchanged), `both` block (kit and project changed), differing unrecorded block: `status` prints the state line (`local`, `both`, `both`) and the warning each time; `update` keeps all three byte-identical; `pull <project> AGENTS.md#paseo-harness-kit` copies the `local` one, skips the `both` one without `--force` (exit 2) and prints the warning in every case.
- Source: INS-15, D-05, HIS-88, install C-2.
- Scope: v1

### INST-14 Hook registration reconcile
- Requirement: `install` and `update` reconcile `.claude/settings.json` against `ship/templates/settings.hooks.json`: the managed scripts are those the template names (a `command` hook whose command references `.claude/hooks/<name>.mjs`); for each managed script that is not blocked, every existing registration is removed from every event and group and the template groups are appended; empty groups are dropped; hooks of other scripts (also in the same group), `env`, `permissions`, `enabledPlugins` and every other key are preserved; a managed script whose project file differs from its digest in the prospective ownership record (INST-33), or has no entry there, is blocked: its registrations stay as they are, the template ones are not added, `conflict .claude/hooks/<name>.mjs: local script differs; its registrations were kept unchanged` is printed and the exit is 2; the file is written (2-space JSON, trailing newline) only when the serialized JSON changed; `status` and `pull` never touch settings.
- Acceptance: settings with a project hook in the same group as a kit hook and an edited kit hook script: `update` keeps the project hook and the edited script's registrations unchanged, exits 2; two clean `update` runs: the second leaves settings bytes and mtime unchanged; adding a hook to a fixture template is reconciled with no code change; on a fresh install and on a clean kit-version update every kit hook is registered (none blocked).
- Source: INS-20, INS-22, HOK-02, HOK-29, INV-01, INV-05.
- Scope: v1

### INST-15 Registered kit hooks and matchers
- Requirement: after install into a project without settings, `.claude/settings.json` holds exactly one registration per template entry; the template registers only kit hooks (context guard, io guard, syntax-check shell, Windows long-command rescue; their behavior is HOOK's) and its matchers name only tools that exist (native tools and `mcp__harness-files__*`), never `mcp__fsbatch__`, `mcp__filesystem__` or `subagent_file_tools.mjs`; the kit no longer asks a project to write its own syntax hook: the shell is a kit hook and the per-extension checkers come from the adapter (D-45).
- Acceptance: parse settings: registrations per (event, matcher, command) equal the template; grep of the template and the installed settings for `fsbatch|mcp__filesystem__|subagent_file_tools` finds nothing; `user/skills/kit-init/SKILL.md` contains no step that writes `.claude/hooks/syntax_check.mjs`.
- Source: INS-21, INS-22, INS-61, HOK-29, D-45, D-46.
- Scope: v1

### INST-16 CLAUDE.md imports AGENTS.md
- Requirement: `install` and `update` make `CLAUDE.md` carry `@AGENTS.md`: inserted after the leading run of `@` lines (at the top when none), followed by a blank line when other text follows; the file's EOL is kept; a missing file becomes the import plus EOL; nothing is written when the import is present; the run prints `CLAUDE.md: added @AGENTS.md` or `CLAUDE.md already imports AGENTS.md`.
- Acceptance: `@a\ntext` becomes `@a\n@AGENTS.md\n\ntext`; a second run leaves bytes and mtime unchanged; a CRLF file stays CRLF.
- Source: INS-23.
- Scope: v1

### INST-17 Seeds created once
- Requirement: `install` and `update` create, only where missing, `.agents/harness.config.json` (a seed with `_notes` and the `adapter` and `gsd` sections that passes config validation, D-77), `.agents/harness-history.md` (header plus the empty table `| Date | Change | Scope | Reason | Supersedes |`, D-60) and the `.planning/` folder itself (no file inside it: `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` and every other lifecycle artifact are written only by the GSD flows, so a seed can never make new-project resume skip a stage), printing `created <rel>`; an existing seed is never read for ownership, never recorded in the manifest and never overwritten, also with `--force`.
- Acceptance: pre-existing overlay `{"max_subagents": 7}` is byte-identical after `install`, `update` and `update --force`; on a fresh install `loadConfig(project)` succeeds and the history file's table header line is exact; the manifest has no seed key; a fresh install leaves `.planning/` empty, and in a project with existing `.planning/` files every one is byte-identical after `install` and `update`.
- Source: INS-24, HIS-32, D-60, D-77, D-109.
- Scope: v1

### INST-18 Wiring before the manifest; no false success
- Requirement: after copying, `install` and `update` run the wiring steps, which read ownership from the prospective record (INST-33), from one ordered list (hook reconcile, mod activation when `--enable-plugin`, CLAUDE.md import, `.gitignore` block, seeds) before the manifest is written; a step that throws ends the command with `failed: <step>: <msg>` (exit 1), the manifest is neither written nor updated, and no `installed ...` or `update: ...` summary line is printed; the next run without the fault succeeds.
- Acceptance: fake `claude plugin install` exiting 9 under `install --enable-plugin`: exit 1, stderr names the step, no manifest file, stdout lacks `installed paseo-kit`; rerun with the fake exiting 0 succeeds with exit 0.
- Source: INS-25, INV-04.
- Scope: v1

### INST-19 Kit-owned .gitignore block
- Requirement: `install` and `update` keep one block in the project `.gitignore` from `# >>> paseo-harness-kit: generated paths (edit outside this block)` to `# <<< paseo-harness-kit` holding `/_workspace/` and `/.claude/worktrees/` and no line other than kit-generated paths (no per-skill lines, never `.planning/`); the block is appended after a blank line (or the file created) when absent, replaced in place when present; owner lines are untouched; EOL follows the file; nothing is written when the text is unchanged.
- Acceptance: `.gitignore` = `node_modules/\r\n` + an old block + `dist/\r\n`: text outside unchanged, one block, CRLF lines; `build` without EOL becomes `build\n\n# >>> paseo-harness-kit...`; second run no write; `git check-ignore` ignores `_workspace/_runs/x` and `.claude/worktrees/a`, not `.planning/STATE.md`, `.agents/harness-kit.json` or `.claude/settings.json`.
- Source: INS-36, HIS-34, D-10, INV-52.
- Scope: v1

### INST-20 harness-files mod activation only with --enable-plugin
- Requirement: without `--enable-plugin`, `install`/`update` never call `claude plugin` and print one note saying whether project settings already enable the mod, never claiming activation; with it: the Node gate and the Claude Code version gate (>= the mod minimum, INST-23) run before any write; after the copy the mod assets (`.claude/plugins/harness-files/.claude-plugin/plugin.json`, `.claude/plugins/.claude-plugin/marketplace.json`) must exist and every file under `.claude/plugins/` must equal its digest in the prospective ownership record (INST-33), else `failed: file mod has untracked or locally modified assets; resolve conflicts before enabling`; then `claude plugin install harness-files --marketplace <project>/.claude/plugins --scope project` runs with cwd = project and the inherited environment (so `CLAUDE_CONFIG_DIR` decides the user config); the kit never edits `enabledPlugins` itself; the last line says current-session activation is not verified.
- Acceptance: fake CLI reporting the minimum minus one: exit 1, project tree unchanged, the fake logged only `--version`; a kept local edit of a mod file: exit 1 with the assets message, no `plugin install` call; success: logged args exactly as above, cwd = project, logged `CLAUDE_CONFIG_DIR` equals the caller's; no flag: zero `plugin` calls; fresh `install --enable-plugin` and a clean kit-version `update --enable-plugin` both reach `plugin install`.
- Source: INS-27, INS-29, D-02, HIS-35, INV-04, FIL-48.
- Scope: v1

### INST-21 Marketplace registered once per Claude config
- Requirement: before `plugin install`, `claude plugin marketplace list --json` is read (a failure counts as no entries); an entry with the mod's marketplace name at another folder (case-insensitive compare on Windows) whose runtime files are identical by digest makes the install use `harness-files@<marketplace> --scope project` without `--marketplace` and print the reused folder; a differing one fails naming the folder and the two fixes (update that project to this kit version, or `claude plugin marketplace remove <marketplace>`), with no install and no removal.
- Acceptance: fake list returning an identical copy -> logged args lack `--marketplace`; a differing copy -> exit 1, no `plugin install` and no `marketplace remove` call.
- Source: INS-28, D-12, HIS-35.
- Scope: v1

### INST-22 What --force never overrides
- Requirement: `--force` changes only the outcome of tracked units in state `local`/`both` (and of a differing part at `install`); it never deletes or overwrites `removed-local` parts, seeds, project-owned skills, agents or hooks, settings keys and hooks other than kit registrations, `CLAUDE.md` lines, `.gitignore` lines outside the kit block or any user-scope Claude config, and never skips a version gate; `--force` grants no extra permission on user config: the only user-scope effect of install is the marketplace registration made by Claude Code's own CLI under explicit `--enable-plugin` (INST-20, INST-21).
- Acceptance: fixture with a project skill folder, a project hook registration, a seed, a `removed-local` file and owner `.gitignore` lines: `update --force` leaves all byte-identical and exits 2 for the `removed-local` part; `install --enable-plugin --force` with the fake CLI below the minimum still exits 1 before any write.
- Source: INS-60, INV-01.
- Scope: v1

### INST-23 Runtime gates and one Claude CLI lookup
- Requirement: one platform module provides the Node gate from one exported table `NODE_RUNTIME = {minVersion, capabilities[]}` (minimum `x.y.z` the shipped runtime needs, and every Node API it uses beyond that version's baseline, each with a presence probe), filled by the release qualification check that runs the shipped suites on the candidate minimum and records the result; the failure names the version or the missing capability; the test-runner floor (Node for `tests/`) is stated separately in README and is not a runtime gate; `kit.mjs machine` and `ph doctor` report this same gate; one `MIN_CLAUDE_VERSION` constant (the mod's minimum, re-verified per FTOL), `versionAtLeast(text, min)` returning true/false, or null when the text has no `x.y.z`, and the Claude CLI lookup `$CLAUDE_CLI`, else `~/.local/bin/claude(.exe)` when present, else `claude` on PATH; a `.js/.cjs/.mjs` CLI runs through the current node; on Windows anything not `.exe/.com` runs through cmd.exe as one quoted command line; the version probe times out after 10 s; `kit.mjs` and `ph doctor` start Claude only through this module.
- Acceptance: `versionAtLeast('2.1.296 (Claude Code)', '2.1.296')` true, `'2.1.295'` false, `'unknown'` null; a fake `.cmd` CLI in a folder with spaces runs on Windows; boundary tests driven by `NODE_RUNTIME`: exactly `minVersion` passes, the next lower patch fails naming the version, each capability removed in turn fails naming it; lint: no other shipped module spawns `claude` and no other module compares Node versions.
- Source: INS-29, RUN-60, INV-52.
- Scope: v1

### INST-24 One skill tree; project skills untouched
- Requirement: kit skills ship as tracked units under `.claude/skills/<kit skill>/`; a skill folder not listed in `kit.json` is project-owned and is never copied, recorded, linked, deleted or overwritten by any verb, also with `--force`; inside an installed project the kit creates no junction or symlink, no `.agents/harness-skills-links.json`, no `.agents/skills/` tree, and has no `ph skills-sync` command; the only link the kit makes anywhere is the user-level bootstrap link of MACH-16.
- Acceptance: project skill `.claude/skills/mine/` is byte-identical and absent from the manifest after `install`, `update`, `update --force`; after install no link exists under `.claude/skills` and `.agents/skills` does not exist; `ph skills-sync` exits 1 as an unknown command.
- Source: D-10, INS-26, INS-30..35 (dropped), INS-59, HIS-33, S-02.
- Scope: v1

### INST-25 Installed project is self-contained
- Requirement: an installed project runs with the kit folder absent: every file its runtime, hooks, file tools and GSD tools load is a shipped unit or a project file; no installed or generated project file contains the kit path; a kit change reaches the project only through `update`.
- Acceptance: install into a temp project, rename the kit folder, then with fakes for the Paseo CLI/daemon and Claude CLI and a file-access trace: `ph config` prints values equal to the shipped defaults; `ph doctor` prints its config, overlay, adapter and provider-policy lines with no `cannot find`/`missing module` problem; the io guard given a fixture transcript with a re-read of an edited file prints its reminder (expected non-empty output, no config or import error on stderr); a file-backend `read_ranges` request resolves the project root by discovery, verifies its backend against the manifest and returns the file; `ph gsd roadmap analyze` on a fixture `.planning/` returns JSON with exit 0; the trace shows no path under the old kit location; grep of the project tree for the kit's absolute path in both slash forms finds nothing.
- Source: INS-55, INS-59, HIS-31, INV-09, D-04.
- Scope: v1

### INST-26 No Backlog and no legacy migration
- Requirement: no verb reads, creates or edits `backlog/`, `.backlog/` or `backlog.config.yml`, runs a `backlog` CLI, prints a Backlog line or writes `BACKLOG.MD` markers; no verb reads or moves `.claude/harness-kit.json`, `.claude/harness.config.json`, `.claude/harness-history.md` or `.agents/skills/harness/scripts/config.json`.
- Acceptance: project holding `backlog/tasks/x.md` and `.claude/harness.config.json`: `install` and `update` leave both byte-identical; stdout has no `backlog` (case-insensitive); a fake `backlog` on PATH logs zero calls.
- Source: INS-16, INS-17, INS-18, INS-19 (all dropped), D-01, I-13, S-03, S-07.
- Scope: v1

### INST-27 Upgrade from kit 0.1.0 without migration code
- Scope: withdrawn — reinterpreting old manifest records during `update` is migration code, contrary to D-01/D-110; replaced by INST-31 (refusal plus a documented fresh install).
- Requirement: `update` on a project whose manifest has 0.1.0 entries (16-hex digests, a `kit` key) runs with no migration code: a recorded digest that is not 64 hex chars counts as I = null, so parts equal to the kit become `same`, differing ones `both` and retired 0.1.0 files `removed-local`, all kept and listed (exit 2), nothing overwritten without `--force` and nothing deleted; the rewritten manifest drops `kit` and holds only 64-hex digests.
- Acceptance: fixture 0.1.0 manifest with an absolute `kit` path, 16-hex digests, a retired `.agents/skills/harness/SKILL.md` and `.claude/hooks/subagent_file_tools.mjs`: `update` exits 2, no file deleted, both listed as kept, new manifest without `kit` and with 64-hex digests only.
- Source: D-01, D-110, INS-05, R-06, INV-01, INV-03.

### INST-28 Documentation of install and machine
- Requirement: README and `kit.mjs help` state: the verbs and flags as implemented (pull with several parts and `--kit`); requirements (Node per the gate, Claude Code >= the mod minimum, Paseo CLI with a running daemon, Git); the ownership table (defaults and runtime kit-owned; overlay, history and `.planning/` project-owned and seeded once; manifest generated; `.claude/settings.json` shared with reconciled kit entries; Paseo config Paseo-owned); what `--force` never overrides (INST-22); that `install` never edits Paseo settings and `machine apply` carries the deny rules; the upgrade of a kit 0.1.0 project by fresh install (INST-31: move the old manifest aside, run `install`, resolve the listed conflicts, delete retired files by hand); and one `claude mcp remove --scope user <name>` command per old `fsbatch`/`filesystem` server for the owner to run when ready.
- Acceptance: offline doc test greps README and `kit.mjs help` for each item; README names no `Backlog`, `Codex`, `OpenCode` or Pi requirement and mentions `fsbatch`/`filesystem` only in the removal note; owner reads the README once (manual check).
- Source: INS-13, INS-58, INS-60, D-03, D-14, D-108.
- Scope: v1

### INST-29 Offline install and machine tests
- Requirement: the install and machine test suites use only temp kit, project and home folders whose names contain spaces, a fake Claude CLI (`CLAUDE_CLI`; logs args, cwd and `CLAUDE_CONFIG_DIR`; simulates `--version`, `plugin marketplace list`, `plugin install` and failure codes) and a fake Paseo CLI (`PASEO_CLI`; logs `reload`), with `PASEO_HOME` and `CLAUDE_CONFIG_DIR` in the temp home and `PASEO_HARNESS_ROOT` cleared; every gate-failure test asserts no side effect; no test reads or writes the owner's live Paseo or Claude config or reaches a daemon.
- Acceptance: suite passes with `HOME`/`USERPROFILE` pointed at a temp folder and no network; a guard fails the run if any test resolves a path under the real home; fake logs contain no `restart`, `mcp` or model call.
- Source: INS-57, INV-57, HIS-76, P11.
- Scope: v1

### INST-30 kit-init user skill
- Requirement: the kit ships `user/skills/kit-init/` whose description triggers on init/initialize/set up/bootstrap a project (also Vietnamese phrases) and `/kit-init` and excludes Claude Code's built-in `/init`; the kit root is printed by the shipped script `user/skills/kit-init/scripts/kit-root.mjs`, which takes its own realpath and walks up to the first ancestor holding both `kit.mjs` and `kit.json` (for the shipped layout: three levels above the `kit-init` folder), failing with `failed: no paseo-kit root above <path>` otherwise; the skill uses only that output; steps, each reported in one line, ending with a done/skipped/needs-owner summary: (1) git: no repository -> ask before `git init`, no commit; a parent repository -> ask; uncommitted changes announced; (2) report requirements (Node, Claude Code, Paseo CLI and daemon) without installing anything globally; (3) `install` when no manifest else `update`, always with `--enable-plugin`, under the intended `CLAUDE_CONFIG_DIR`; exit 2 -> report conflicts, never add `--force` or run `pull` without the owner; (4) `kit status` and `ph doctor`, report every `problem` line, say hooks and the mod need a new Claude session; (5) point to `gsd-map-codebase` and then the `harness` adapter generator. No Backlog requirement and no syntax-hook writing step.
- Acceptance: filesystem test: `kit-root.mjs` reached through a Windows junction and through a POSIX directory symlink to `<kit>/user/skills/kit-init` prints `<kit>`; a copy outside any kit fails with the message; skill lint checks the description triggers and exclusion, the five steps and the never-force/never-pull rule; manual check: run the skill in an empty temp folder with `circle/gpt-6-luna-fast[1m]`: it asks before `git init`, runs `install --enable-plugin` without `--force`, the summary lists every step.
- Source: INS-56, HIS-36 (kit-init part), D-02, D-07, D-109, INV-50.
- Scope: v1

### INST-31 Older manifest refused; upgrade by fresh install
- Requirement: a manifest that is not in the current format (a digest that is not 64 hex chars, a `kit` key, or missing `version`/`files`) is never read for ownership nor rewritten: `install`, `update`, `status` and `pull` exit 1 with `failed: .agents/harness-kit.json was written by an older kit; move it aside (e.g. to .agents/harness-kit.old.json) and run install` and change nothing; after the owner moves it aside, `install` runs as on any project (INST-08): differing files surface as `conflict` lines (exit 2), files the kit no longer ships are left untouched; the kit never reads or deletes the moved-aside file.
- Acceptance: fixture 0.1.0 project (absolute `kit` path, 16-hex digests, a retired `.agents/skills/harness/SKILL.md`, `.claude/hooks/subagent_file_tools.mjs`): each verb exits 1 with the message and the tree hash is unchanged; after renaming the manifest, `install` exits 2 listing the differing kit files, both retired files and the renamed manifest are byte-identical, the new manifest is current-format.
- Source: D-01, D-110, INS-05, INS-08, R-06, INV-01, INV-03.
- Scope: v1

### INST-32 Manifest record policy
- Requirement: a manifest write starts from the previous records and changes only these: a unit copied from the kit (or found `same`) records K; a part pulled into the kit records P; a `gone` part and a deleted `removed` part lose their key; every other recorded unit (kept `local`, `both`, `removed-local`, skipped by `pull`, or not selected by `pull <part>`) keeps its previous I unchanged; a conflict kept at `install` stays unrecorded until a later copy takes it; P is never recorded for a part that was not copied in either direction.
- Acceptance: install, then edit file A (local), edit file B while the kit changes B (both), retire file C after editing it (removed-local); run `update` twice and `pull <project> D` for an unrelated `local` part D: after each run the manifest values of A, B, C equal the values before it and their states stay `local`, `both`, `removed-local`; only D's record becomes its project digest.
- Source: INS-10, INS-12, INS-06, INV-01, INV-02.
- Scope: v1

### INST-33 Prospective ownership record during wiring
- Requirement: `install` and `update` build the new ownership record in memory before wiring (previous records updated per INST-32 for every copy just made); hook reconcile (INST-14) and mod activation (INST-20) decide "unmodified kit file" from this prospective record, never from the previous file on disk; the record is persisted as the manifest only after every wiring step succeeded (INST-18); kept conflicts keep their old evidence in it.
- Acceptance: fresh `install --enable-plugin` registers every kit hook and reaches `plugin install`; a clean kit-version `update` (kit hook and mod files changed, project untouched) registers the new hooks and activates; `update --force` over a locally edited hook registers it; a run whose plugin step fails leaves the old manifest unchanged and the rerun succeeds; a locally edited, not forced hook is still blocked.
- Source: INS-20, INS-25, INS-27, HOK-02, HIS-35, INV-04.
- Scope: v1

## MACH: machine (M2)

### MACH-01 machine CLI surface
- Requirement: `kit.mjs machine check | apply [--no-reload] [--enable-paseo-plugins] [--link-user-skills] [--unlink-user-skills] | export`; an unknown subcommand or argument (including the retired `--dirs`, `--fs-server`, `--remove-local`) prints usage and exits 1 with nothing written; expected failures print `failed: <msg>`, unexpected `error: <msg>` (exit 1); the provider-policy check and apply are part of `check` and `apply`, with no separate sync script or shim.
- Acceptance: `machine bogus` and `machine apply --dirs C:/` exit 1 and leave the temp Paseo config and Claude config dirs byte-identical; the kit tree has no `sync_agent_provider.mjs`.
- Source: INS-37, INS-54, D-07.
- Scope: v1

### MACH-02 machine check is read-only
- Requirement: `machine check` prints only `ok <text>`, `problem <text>` and `note <text>` lines; exit 0 when no `problem`, 2 when any, 1 when the Paseo config (`$PASEO_HOME/config.json`, default `~/.paseo/config.json`) is missing or unparsable; it writes no file, calls no model, never starts, stops or restarts a daemon, and its only external call is `claude --version`.
- Acceptance: Paseo config and temp Claude config dir bytes and mtimes identical before and after; fake Claude CLI log holds only `--version`; fake Paseo CLI log is empty; a missing config gives exit 1.
- Source: INS-38, HIS-76, INV-07, P4.
- Scope: v1

### MACH-03 machine check lines
- Requirement: `check` prints, in order: the Node gate; the platform (`ok`); the Claude Code version against the mod minimum (`problem` when lower or unknown); a `note` that mod activation is per project (verify with `kit install|update --enable-plugin` and `ph doctor`); per template provider whether it exists and which template model ids it lacks (`problem`); the worker and main policy lines (MACH-04, MACH-05); one `note` per model id present in a kit provider but no longer in the template ("left for the owner to remove in Paseo"); Paseo plugin lines (`note` unless the run enables plugins, MACH-15); one line per user-skill link target (MACH-16). It prints no MCP-server, `machine.local.json` or Backlog line.
- Acceptance: golden test over fixture Paseo configs reproduces the line set; stdout matches no `backlog|mcp|machine.local` (case-insensitive); a live provider with an extra model `old-x` gives exactly one `note` naming it and does not change the exit code.
- Source: INS-38, INS-46, INS-48, INS-47, D-07, D-15, HIS-90.
- Scope: v1

### MACH-04 Worker provider policy check
- Requirement: for each `main -> worker` pair of `agent_providers`: a missing worker provider is a `problem` naming `kit.mjs machine apply`; a present `disallowedTools` that is not an array is a `problem` (owner review), absent or null counts as `[]`; every entry of `agent_provider_disallowed_tools` the worker lacks is listed in one `problem`; every `agent_provider_env` key missing or different is listed in one `problem`; denies beyond the required list are counted in `ok ... N owner extra rule(s) preserved`, never a problem; there is no native-file-deny or legacy-fingerprint logic (every provider is Claude Code).
- Acceptance: worker lacking `SendMessage` -> `problem` naming it, exit 2; adding an owner deny `Bash(rm *)` -> `ok` with `1 owner extra rule(s) preserved`; `disallowedTools: "x"` -> `problem`; a worker that also denies `Read` gets no special line beyond the extra count.
- Source: INS-49, RUN-05, D-06, S-16.
- Scope: v1

### MACH-05 Main provider policy check
- Requirement: for each key of `agent_providers`: a missing provider or a non-array `disallowedTools` is a `problem`; a provider lacking any `main_provider_disallowed_tools` entry gives `problem main provider <name> lacks <tools> (main sessions orchestrate through Paseo, not native subagents); run kit.mjs machine apply`; otherwise `ok main provider <name>: Agent, Workflow disallowed (orchestration goes through Paseo)`; whether `SendMessage` is denied or allowed on a main provider never yields a `problem`.
- Acceptance: `circle` without `Workflow` -> `problem`, exit 2; `circle` denying `[Agent, Workflow]` only -> `ok`, exit 0; `circle` denying `[Agent, Workflow, SendMessage]` -> the same `ok` line.
- Source: INS-50, HIS-25, D-06, INV-06.
- Scope: v1

### MACH-06 Machine keys in the defaults
- Requirement: the shipped defaults hold `agent_providers` `{circle: circle-agent}`; `agent_provider_disallowed_tools` exactly `Agent, AskUserQuestion, CronCreate, CronDelete, CronList, DesignSync, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, ListAgents, Monitor, PushNotification, ReportFindings, ScheduleWakeup, SendMessage, WebSearch, Workflow`; `agent_provider_env` `{ENABLE_TOOL_SEARCH: "true"}`; `main_provider_disallowed_tools` exactly `[Agent, Workflow]`; no `agent_mcp` key; a mapping whose main equals its worker fails validation.
- Acceptance: `loadKitConfig()` deep-equals these four values; `SendMessage` is in the worker list and not in the main list; a defaults fixture with `{circle: circle}` fails with `invalid harness config agent_providers.circle: ...`.
- Source: RUN-03, RUN-04, RUN-05, INS-42, D-06, INV-06.
- Scope: v1

### MACH-07 apply gates before any write
- Requirement: `machine apply` runs the Node gate, the Claude Code version gate, the Paseo config read and parse, secret resolution (MACH-10) and the full in-memory patch (MACH-08, MACH-09) before writing the Paseo config, a backup or a user-skill link; any failure exits 1 with nothing written.
- Acceptance: fake Claude CLI below the minimum -> exit 1, Paseo config byte-identical, no backup file, no link; an unresolvable secret -> same; a non-array worker `disallowedTools` -> same.
- Source: INS-39, INS-29, INV-04.
- Scope: v1

### MACH-08 Additive provider and model plan
- Requirement: against the rendered template (template plus machine keys), `apply` adds a missing main provider from the template (secrets filled, `_` keys dropped, `{{HOME}}` expanded) and prints `paseo: added provider <name>`; a missing worker is a deep copy of the live main provider when it exists (label `<label> (harness agents)`, description naming its source), else built from the template; for a present provider only template model entries whose `id` is missing are appended (`paseo: added to <name>: <ids>`); existing models, fields and credentials are never edited or removed; `metadataGeneration` is written only when absent; model ids the template no longer ships are reported by `check` (MACH-03), never removed.
- Acceptance: live config with a custom model, an owner-only provider and a `metadataGeneration`: after apply those are JSON-equal to before and only missing ids were appended; empty `agents.providers` -> both providers created with the template models; a second apply writes nothing.
- Source: INS-41, INS-51, D-15, HIS-90 (superseded by D-15), INV-07.
- Scope: v1

### MACH-09 Union-only policy apply
- Requirement: each worker's `disallowedTools` becomes its existing list plus the missing required entries (existing order kept, duplicates removed, nothing removed); each worker's `env` gets every `agent_provider_env` key (kit values win for those keys only); main providers are patched after the workers (a worker clone copies the main as the owner left it) with `disallowedTools` = existing plus missing `main_provider_disallowed_tools`; apply is idempotent.
- Acceptance: an owner deny survives; fixture defaults whose main list holds `KitMainOnly` (absent from the worker list) and a live main that already denies the owner rule `OwnerOnMain`, with the worker missing: after apply the new worker denies `OwnerOnMain` (inherited by the deep copy) and does not deny `KitMainOnly` (added to the main only after cloning), while the main denies both; a second apply leaves the file bytes and mtime unchanged.
- Source: INS-51, INS-42, INV-05, INV-07.
- Scope: v1

### MACH-10 Secrets stay out of the kit
- Requirement: env values whose key matches `/TOKEN|KEY|SECRET|PASSWORD|BASE_URL/i` appear in kit files only as `{{secret:NAME}}`; at apply, the endpoint `ANTHROPIC_BASE_URL` is resolved first from `PASEO_KIT_ANTHROPIC_BASE_URL`, else env `ANTHROPIC_BASE_URL`; any other `{{secret:NAME}}` is filled from `PASEO_KIT_<NAME>`, else from a live provider whose resolved `ANTHROPIC_BASE_URL` is identical and that holds `env[NAME]`, else env `<NAME>`; otherwise `failed: no value for the secret NAME: set the environment variable PASEO_KIT_NAME` and nothing is written; a provider with the same `extends` on another endpoint never lends a value; `{{HOME}}` expands to the home folder.
- Acceptance: missing main provider with no source -> exit 1, config byte-identical; `PASEO_KIT_ANTHROPIC_AUTH_TOKEN` set -> its value used; a live peer on the same endpoint with a token -> reused; a peer on another endpoint -> not used (exit 1 when no other source).
- Source: INS-43, D-13, HIS-30, INV-08.
- Scope: v1

### MACH-11 Backup and atomic write
- Requirement: every apply that changes the Paseo config first copies it to `<config>.bak-<YYYYMMDD-HHMMSS>-kit` (a same-second collision gets a numeric suffix), then writes through a temp file and rename (2-space JSON, trailing newline); it prints one `paseo: <change>` line per change and `paseo: backup <path>`; an apply with no change writes nothing and prints `paseo: every template provider, model and policy entry is present`.
- Acceptance: two changing applies give two distinct backups, the first byte-equal to the original; a no-change apply creates no backup and leaves the mtime; an injected rename failure leaves the original config byte-identical.
- Source: INS-40, INS-39, INV-07, D-15.
- Scope: v1

### MACH-12 Reload, never restart; apply exit codes
- Requirement: after a write, unless `--no-reload`, apply runs `<cli> reload` with `<cli>` = `$PASEO_CLI`, else `paseo` on PATH (Windows `.cmd` through cmd.exe); it never runs a daemon start, stop or restart; a reload failure prints `paseo reload failed (<reason>); run it yourself: paseo reload`; then `--- check` and the full check output; exit 1 on any gate, secret or patch failure (nothing written), else 2 when the reload failed or the check reports a problem, else 0; no reload runs when nothing was written.
- Acceptance: fake Paseo CLI exiting 1 -> apply exits 2, the config already holds the change, the reload hint and `--- check` are printed; `--no-reload` -> zero fake calls; the fake log never holds `restart`, `start` or `stop`.
- Source: INS-53, INS-39, D-09, INV-07.
- Scope: v1

### MACH-13 export writes a scrubbed template
- Requirement: `machine export` reads the live config; the provider set is every key and value of `agent_providers` (a missing one fails, exit 1); per provider, every env field whose key matches the secret pattern is replaced structurally by `{{secret:KEY}}`, a home-folder prefix becomes `{{HOME}}`; in other string values (labels, descriptions) a secret value of at least 8 characters, and the host of a secret URL, is replaced only as a whole token (bounded by start/end or a non-alphanumeric character), shorter values are never substituted; the output uses the canonical template representation of MACH-14 (worker: no `disallowedTools`, no kit `agent_provider_env` keys; main: its live denies plus the main list); `metadataGeneration` is copied when present; `_notes` explains placeholders, apply and reload; before writing it checks that every secret-keyed env field is a placeholder and that no secret value of at least 8 characters and no secret host occurs as a whole token, else `failed: a secret would be written into the template; not written`; `paseo/providers.json` is written atomically; the live config is never changed.
- Acceptance: live token `fixture-secret` and endpoint `https://proxy.example.test/v1` also named in a description: output lacks the token, URL and host, has the placeholders and parses as JSON; a 1-char secret `a` and overlapping secrets (`abcdefgh`, `abcdefgh-2`) give valid JSON with secret fields as placeholders, non-secret strings and property names intact; live config byte-identical; a forced-leak fixture exits 1 and leaves the old template unchanged; round trip: export -> render -> apply on an empty config -> check exits 0, including a live main with an owner extra deny.
- Source: INS-44, D-08, HIS-30, INV-08, install C-10.
- Scope: v1

### MACH-14 Shipped provider template
- Requirement: `paseo/providers.json` holds `circle` (main sessions) and `circle-agent` (workers), both `extends: "claude"`, env `CLAUDE_CONFIG_DIR: "{{HOME}}/.claude-circle"` and `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` as `{{secret:...}}`; canonical policy representation (shared with MACH-13): a worker stores no `disallowedTools` and none of the kit `agent_provider_env` keys (rendered from the defaults at apply/check), a main stores `disallowedTools` = its exported owner denies plus `main_provider_disallowed_tools` (the shipped release file: exactly `[Agent, Workflow]`, never `SendMessage`); the file is produced by `machine export` and passes the template schema check without hand editing; the model list is the owner-confirmed export; no tracked kit file holds a secret value, the endpoint host or an absolute home path; the kit takes no position on per-provider alias mappings.
- Acceptance: test parses the file and checks it with the same template schema `export` uses (shape, both `extends`, placeholders, no worker policy fields, `circle` deny list); a test scans tracked files for env values under secret-pattern keys that are not placeholders; manual check before release: the owner confirms the model list and greps the repository for the endpoint host locally.
- Source: INS-45, D-06, D-08, HIS-30, HIS-75, INV-08.
- Scope: v1

### MACH-15 Paseo plugins only on request
- Requirement: only with `--enable-paseo-plugins`, apply sets `pluginsEnabled: true`, registers the kit's `plugins/planning-panel` and `plugins/swarm-map` as `{source: "directory", path: <absolute plugin dir>, enabled: true}`, runs `npm ci` in a plugin folder without `node_modules` (600 s timeout) and prints `paseo plugin reload <id>`; a user entry with the same id pointing elsewhere is kept and reported `conflict Paseo plugin <id>: user entry kept` (exit 2); in that run `check` reports a missing or disabled kit plugin as `problem`, otherwise as `note`; without the flag `pluginsEnabled` and `plugins` stay byte-identical; no backlog plugin exists.
- Acceptance: fixture with a user plugin entry: apply without the flag leaves both keys JSON-equal; with the flag the two kit entries are added and the user entry is unchanged; the fake npm is called once per plugin folder lacking `node_modules`.
- Source: INS-47, D-96, INV-05.
- Scope: v1

### MACH-16 kit-init linked into the provider config dirs
- Requirement: `apply --link-user-skills` creates, for each distinct rendered `CLAUDE_CONFIG_DIR` of the template providers, `<dir>/skills/kit-init` as a link (junction on Windows, directory symlink elsewhere) to `<kit>/user/skills/kit-init` and records `{dest, target}` in the machine record `~/.paseo-kit/user-links.json` (`{version: 1, links: [...]}`, atomic write, outside any repository); a link is kit-made only when the record holds its `dest` and the link on disk still points at the recorded `target`; only such a link is re-pointed (rename aside, create the new link, restore the old one if creation fails, then delete the aside copy) or, with `apply --unlink-user-skills`, removed with its record entry; anything else at `dest` (a real folder, a file, an unrecorded link even with a matching path suffix, a recorded link the owner re-pointed) is the owner's and is never touched (`note <path>: owner entry kept`); `check` prints per dir `ok` (kit link here), `note` (missing) or `note` (owner entry).
- Acceptance: temp home with config dirs A-E: A empty -> link created and recorded; B owner-made link to another checkout's `user/skills/kit-init` (unrecorded) -> untouched; C recorded link that the owner re-pointed -> untouched; D recorded link to an old kit path -> re-pointed; E owner folder -> byte-identical; injected link-creation failure on D leaves the old link in place; unlink removes only A's and D's links and their records; `check` lines match per dir.
- Source: D-07, INS-56, install C-14, INV-03.
- Scope: v1

### MACH-17 Machine operations target the template's config dirs
- Requirement: the Claude config dir used by machine operations is the first template provider's rendered `CLAUDE_CONFIG_DIR`, else `$CLAUDE_CONFIG_DIR`, else `~/.claude`; link operations use every template provider's dir; the Paseo config is `$PASEO_HOME/config.json` (default `~/.paseo/config.json`).
- Acceptance: template `{{HOME}}/.claude-circle` with a different `$CLAUDE_CONFIG_DIR`: every logged fake Claude CLI call carries `CLAUDE_CONFIG_DIR=<temp home>/.claude-circle`; `PASEO_HOME` pointing at a temp folder is the only Paseo config read.
- Source: INS-62.
- Scope: v1

### MACH-18 No override of another tool's settings
- Requirement: apply changes only `agents.providers` entries of the providers named by `agent_providers`, plus `pluginsEnabled`/`plugins` under MACH-15 and an absent `metadataGeneration`; `agents.skills.selection`, tool and browser selections, other providers, owner plugin entries and every other key stay unchanged; the main deny list is the only kit-forced setting on a main provider.
- Acceptance: fixture with custom skill, tool and browser selections and an owner provider: a JSON diff of before and after touches only the allowed paths.
- Source: HIS-27, HIS-76, INV-05, P2.
- Scope: v1

### MACH-19 No MCP file-server handling
- Requirement: `machine` never runs `claude mcp`, never reads or writes `machine.local.json` and registers no MCP server; removing old `fsbatch`/`filesystem` registrations is the owner's step documented in INST-28.
- Acceptance: fake Claude CLI logs no `mcp` call across `check`, `apply` and `export`; no `machine.local.json` appears; the kit tree has no `mcp/` folder.
- Source: INS-46, D-03, S-01.
- Scope: v1

## CONF: config (M3)

### CONF-01 Defaults plus one project overlay
- Requirement: the effective config is `.agents/harness.defaults.json` (kit-owned, `_`-prefixed keys stripped) merged with `.agents/harness.config.json` (project-owned) when that file exists; the root is `$PASEO_HARNESS_ROOT`, else cwd; no overlay means defaults only; an overlay that is not a JSON object fails with `invalid harness config overlay: expected an object`; overlay keys starting with `_` are ignored; the defaults object is never mutated by a load.
- Acceptance: overlay with `_notes` loads equal to defaults; no overlay -> equals defaults; overlay `[]` -> the message; `PASEO_HARNESS_ROOT` pointing at another fixture root loads that root's overlay; two loads with different overlays in one process return independent results.
- Source: RUN-01, HIS-32, D-77, P3.
- Scope: v1

### CONF-02 Safe JSON reading
- Requirement: one `readText` helper strips a leading UTF-8 BOM and is used by every kit module that reads a kit or project text record (including the shasum-format `freeze_*.sha256` lines, which keep their format, and JSONL journals read line by line); one `readJson` helper layered on it parses whole-file JSON (defaults, overlay, manifest, `run.json`, `args.json`, `tasks.json`, Paseo config); overlay keys `__proto__`, `constructor` or `prototype` at any depth fail with `invalid harness key <key>`.
- Acceptance: a BOM-prefixed overlay and manifest load; a BOM-prefixed freeze file verifies as shasum lines (not parsed as JSON); a nested `{"tiers": {"__proto__": {}}}` fails with the message; lint: no shipped module calls `JSON.parse` on a whole file read outside `readJson` and no module reads a text record without `readText` (JSONL line parsing allowed).
- Source: RUN-01, runtime Concerns (BOM list), INV-52.
- Scope: v1

### CONF-03 Machine keys cannot be set by a project
- Requirement: overlay values for `agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env` and `main_provider_disallowed_tools` are ignored; the loaded values always equal the defaults.
- Acceptance: overlay `{"main_provider_disallowed_tools": []}` loads `[Agent, Workflow]`; overlay `{"agent_providers": {"x": "y"}}` loads `{circle: circle-agent}`.
- Source: RUN-03, INV-05, INV-06.
- Scope: v1

### CONF-04 Merge rules
- Requirement: `tiers`, `tier_aliases`, `platform_notes`, `context_guard`, `io_guard`, `read_limits`, `adapter` and `gsd` merge one level per entry (an overlay entry replaces that whole entry, e.g. a whole tier object); every other key is replaced wholesale (arrays are never unioned).
- Acceptance: overlay `io_guard: {step_rounds: 3}` keeps the other three defaults; `allowed_models: ["circle/x"]` replaces the default list; `tiers: {pro: {...}}` keeps `frontier` and `standard` and replaces `pro` wholly; `adapter: {review_lenses: [...]}` keeps the other `adapter` defaults.
- Source: RUN-02, HOK-10, HOK-22, D-77.
- Scope: v1

### CONF-05 Closed validation
- Requirement: the same validation runs on the defaults alone (`loadKitConfig()`) and on the merged result (`loadConfig(root)`); an unknown key fails with `invalid harness config <dotted.path>: unknown key`, a missing one with `missing key`, a type mismatch with `expected <type>`; the schema holds types and rules only, never default values (values live only in the defaults file).
- Acceptance: one fixture each for an unknown top-level key, an unknown nested `io_guard.foo`, a key deleted from a defaults fixture and a wrong type, each failing with the exact message; a test asserts the schema module exports no default value.
- Source: RUN-06, P3, P4.
- Scope: v1

### CONF-06 Typed rules
- Requirement: integers are nonnegative safe integers; `max_subagents`, the live-agent cap, `max_agents_per_workflow`, `wait_timeout_s` and `max_prompt_bytes` are > 0; a tier is an object with only `provider` (matching `^[^/]+/.+$`), optional `thinking` (`off|low|medium|high|xhigh|max`) and optional `features` (object); `default_tier` names a tier, an alias or a `provider/model`; every `tier_aliases` target is a tier or a `provider/model`; `prime_role` is `two-turn|off`; `tier_aliases`, `platform_notes`, `agent_providers` and `agent_provider_env` are string maps; `context_guard.window_tokens` >= 1 and `start_pct`, `step_pct` in 1..100; `io_guard.step_rounds` and `edit_step_rounds` >= 1, the two start keys >= 0; `read_limits` holds exactly `fileMaxChars` and `replyMaxChars`, positive integers with `fileMaxChars <= replyMaxChars <= 40000` (the page size, FTOL-23); `max_live_subagents >= max_subagents`; an unconfigured tier (`provider: ""`, CONF-11) is valid; an `agent_providers` entry whose main equals its worker fails.
- Acceptance: one failing overlay per rule; each message names the dotted key (e.g. `context_guard.start_pct`, `io_guard.step_rounds`, `read_limits.fileMaxChars`); `io_guard.start_rounds: 0` passes; the overlay `read_limits {fileMaxChars: 200000, replyMaxChars: 450000}` is rejected identically by `ph config`, a hook run (one stderr line) and a file-backend request; a 37,000-char reply under the defaults returns in one page without continuation.
- Source: RUN-06, HOK-10, HOK-22, D-06, D-20, D-41, FIL-26.
- Scope: v1

### CONF-07 adapter and gsd sections; no .planning/config.json
- Requirement: the project's adapter and GSD settings live only in the `adapter` and `gsd` sections of `.agents/harness.config.json` (the defaults ship their schema and kit default values; the key set and per-key rules are the ADPT requirements) and pass the same closed validation; no shipped module reads `.planning/config.json`, and such a file has no effect.
- Acceptance: overlay `adapter.unknown_x` fails with `invalid harness config adapter.unknown_x: unknown key`; a garbage `.planning/config.json` leaves `loadConfig` unchanged; grep of `ship/` for `.planning/config.json` finds nothing.
- Source: D-77, HIS-32, INS-24.
- Scope: v1

### CONF-08 Invalid overlay blast radius
- Requirement: an invalid overlay (failed validation or unparsable JSON) makes every `ph` command except `help` and `doctor` print `failed: invalid harness config ...` and exit 1; `ph doctor` prints one `problem` line with the message, runs every remaining check with the kit defaults and exits 2.
- Acceptance: overlay with an unknown key: `ph config` exits 1 with the message; `ph doctor` exits 2 and prints the checks after the config line; the same for an overlay holding `{` (not exit 1).
- Source: RUN-07, P4.
- Scope: v1

### CONF-09 File-tool backend reads config per request
- Requirement: the file-tool backend resolves the config root per request as `$PASEO_HARNESS_ROOT`, else the nearest ancestor of the request cwd holding `.agents/harness-kit.json` or `.agents/harness.config.json`, else the cwd, and applies that root's `read_limits` to that request only; an invalid config fails that call with `invalid harness config <key>: <msg>` while tool registration and descriptions keep working, and the next call after a fix succeeds without a new session.
- Acceptance: project overlay `read_limits {fileMaxChars: 100, replyMaxChars: 200}`: reading a 150-char file is refused naming the 100-character limit; overlay with `typo_key`: the read fails with `typo_key: unknown key`, the tool list is still registered; removing the key makes the next read succeed.
- Source: FIL-18, RUN-63, D-41.
- Scope: v1

### CONF-10 ph config shows effective values and file provenance
- Requirement: `ph config` prints the merged config as 2-space JSON with `_provenance: {defaults: <abs path>, overlay: <abs path|null>, manifest: {version, installedAt, updatedAt}|null, warnings: []}` and exits 0; nothing in it depends on or shows a kit path.
- Acceptance: output parses as JSON; `_provenance.overlay` is null without an overlay; with the kit folder renamed the output is unchanged and holds no kit path.
- Source: RUN-08, RUN-09, D-04, INV-09.
- Scope: v1

### CONF-11 Shipped default values
- Requirement: the defaults ship: tiers `frontier`, `pro`, `standard` unconfigured (`provider: ""`, no concrete model id anywhere in the defaults or the seed overlay; example mappings appear only as text in `_notes` and in the provider template, D-16); a project's usable mappings are written into its overlay by the `harness` adapter generator (D-109) or by the owner; resolving an unconfigured tier fails with `tier <name> has no model; set tiers.<name>.provider in .agents/harness.config.json (the harness adapter generator writes it)` and creates nothing, and `ph doctor` reports each unconfigured tier as a `problem`; `tier_aliases` `{}`; `default_tier` `standard`; `mode` `bypassPermissions`; `allowed_models` `[]`; `max_subagents` 20; `max_live_subagents` 40; `max_agents_per_workflow` 1000; `wait_timeout_s` 3600; `schema_retries` 2; `prime_role` `off`; `warmup` false, `warmup_s` 8, `warmup_timeout_s` 90; `max_prompt_bytes` 262144; watchdog `agent_nudge_s` 900, `agent_stop_s` 1800, `agent_tool_stuck_s` 900, `agent_file_tool_stuck_s` 180, `watchdog_repeat_calls` 3, `watchdog_same_file_reads` 3, `watchdog_reads_without_write` 15, `watchdog_enabled` true; `context_guard` 1000000/60/5; `io_guard` 2/2/2/2; `read_limits` `fileMaxChars` 36000, `replyMaxChars` 38000 (FTOL-23); `worktree_dir` `.claude/worktrees`; `runs_keep` 20; `compact_resume` `Compaction done. Continue where you left off; re-arm any Monitor you stopped.`; `platform_notes.win32` carrying the PowerShell re-encoding warning; the kit base `first_prompt_note` (text per PHCL-29) and `project_prompt_note` `""` (CONF-14); the four machine keys (MACH-06); `adapter` and `gsd` defaults (ADPT).
- Acceptance: a drift test compares `loadKitConfig()` with a golden table kept in the test; changing a default without updating the table fails the test; grep of the shipped defaults and seed overlay finds no `provider/model` id outside `_notes`; on an untouched install `ph spawn --name a` fails with the unconfigured-tier message and creates no agent; writing `tiers.standard.provider` in the overlay makes it resolve with no kit or script edit.
- Source: RUN-10, D-16, D-20, D-24, D-36, D-41, D-48, D-109, HIS-74, R-10.
- Scope: v1

### CONF-12 One loader for every consumer
- Requirement: one module `.agents/harness/config.mjs` exports `loadConfig(root)`, `loadKitConfig()` and `configProvenance(root)`; `ph`, the hooks, the file-tool backend, the `ph gsd` tools and `kit.mjs` load config only through it; no consumer embeds default values or reads `harness.defaults.json`/`harness.config.json` itself; hooks locate it as the HOOK requirements state (D-49).
- Acceptance: one fixture overlay change is seen identically by `ph config`, a context-guard hook run, a file-tool request and a `ph gsd` verb; lint: no other shipped module opens either config file by name.
- Source: RUN-63, HIS-32, HOK-37, P3.
- Scope: v1

### CONF-13 Dropped config locations and keys
- Requirement: `.claude/harness.config.json` is never read (a project holding only that file loads the defaults); `modes`, `provider_features`, `agent_mcp`, `context_guard.model_pattern` and the media keys of `read_limits` (`mediaPerTurn`, `mediaTurnGapMs`) are unknown keys that fail validation; the loader emits no deprecation warnings.
- Acceptance: `.claude/harness.config.json` with `{"max_subagents": 1}` -> loaded 20; overlay `{"context_guard": {"model_pattern": "."}}` -> `invalid harness config context_guard.model_pattern: unknown key`; overlay `{"agent_mcp": {}}` -> `unknown key`.
- Source: HOK-37, HOK-10, RUN-02, RUN-06, D-41, S-01, S-03.
- Scope: v1

### CONF-14 Complete key table; kit and project prompt notes
- Requirement: the closed schema holds exactly these top-level keys (types and rules CONF-06, shipped values CONF-11, merge CONF-04): `tiers`, `tier_aliases`, `default_tier`, `mode`, `allowed_models`, `agent_providers`, `agent_provider_disallowed_tools`, `agent_provider_env`, `main_provider_disallowed_tools`, `max_subagents`, `max_live_subagents`, `max_agents_per_workflow`, `wait_timeout_s`, `schema_retries`, `prime_role`, `warmup`, `warmup_s`, `warmup_timeout_s`, `max_prompt_bytes`, `agent_nudge_s`, `agent_stop_s`, `agent_tool_stuck_s`, `agent_file_tool_stuck_s`, `watchdog_repeat_calls`, `watchdog_same_file_reads`, `watchdog_reads_without_write`, `watchdog_enabled`, `compact_resume`, `context_guard`, `io_guard`, `read_limits`, `worktree_dir`, `runs_keep`, `first_prompt_note`, `project_prompt_note`, `platform_notes`, `adapter`, `gsd`; a key another module needs is added here first. `first_prompt_note` is kit-owned like the machine keys: an overlay value is ignored; the project's text goes in `project_prompt_note` (string, shipped `""`), which consumers append after the kit note (PHCL-29) and which can never replace it.
- Acceptance: schema key list equals the list above (test); an overlay `first_prompt_note: "x"` loads the kit text unchanged; one integration fixture overlay sets `max_live_subagents`, `watchdog_enabled: false`, `warmup: true` with `warmup_s` and `project_prompt_note`, and each is seen through the loader by its consumer (live cap refusal, no watchdog line, warm-up gate, rendered prompt with the kit note followed by the project note).
- Source: RUN-10, RUN-02, RUN-06, RUN-63, D-20, D-24, D-36, S-17, P3.
- Scope: v1

## Later

- Generic `kit adopt` for 0.1.0 manifests (retire files only on digest match, move skills into `.claude/skills/`, never touch project data), only if needed. Source: D-01, D-110, INS-18.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Backlog init, block, CLI check, panel | owner: Backlog dropped (S-07) |
| MCP file servers, `machine.local.json`, `agent_mcp`, `--dirs`/`--fs-server`/`--remove-local` | Claude Code only (S-01, D-03) |
| `.agents/skills` tree, skill links, link record, `ph skills-sync` | single skill tree (D-10, S-02) |
| Legacy relocation, legacy `scripts/config.json` migration, 0.0.2 deny fingerprint, `model_pattern` deprecation | from-scratch layout (D-01, S-03, S-16) |
| Replacing provider model lists | additive only (D-15) |
| Moving a particular project onto the kit | that project's own task (D-110) |

## Traceability

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

## Counts

- v1 requirements: 65 (INST 32, MACH 19, CONF 14); withdrawn: 1 (INST-27)
- later items: 1
- behaviors traced: 91 (85 absorbed by M1..M3 plus INS-30..35)
- behaviors not a requirement: 7 (INS-30..35, INS-52)

## Revision log r1

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
