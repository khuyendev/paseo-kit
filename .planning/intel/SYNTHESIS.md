# Synthesis

Single input to the paseo-kit specification (PROJECT.md, REQUIREMENTS.md, ROADMAP.md). Built from the eleven maps in `map/` (IDs `INS`, `RUN`, `WFL`, `FIL`, `HOK`, `MTH`, `GSP`, `GDB`, `UPS`, `UI`, `HIS`), with every resolved decision of `DECISIONS.md` applied (`D-NN`). The owner answered every escalated decision on 2026-10-20 (D-07, D-15, D-39, D-62, D-77, D-78, D-107) and added the vanilla principle D-110: nothing specific to one project (WildEraV6), Unreal or games is in the kit; such sources are evidence of lessons only. Changes made for D-110 are listed in the last section, "D-110 vanilla sweep". Every statement cites the map IDs it comes from; the maps cite source lines.

Behavior tally after all decisions (767 mapped behaviors): kept 464, changed 160, dropped 143 (dropped includes 12 upstream capabilities marked LATER, the 31 method behaviors D-109 drops, and the supervised debug engine D-78 puts LATER: 44 gsd-debug behaviors plus HIS-79..82 and GSP-40). Convention: KEEP/ADOPT = kept, CHANGE = changed, DROP/LATER = dropped; OPEN/CONFLICT entries counted by the decision that settles them.

## Scope and principles

### Goals
- G1 A from-scratch kit `paseo-kit` (C:/Users/fish/Desktop/paseo-kit) that installs into a project and runs multi-agent work through Paseo and `ph`, with Claude Code as the only agent harness (main session and workers) and other vendors' models running inside Claude Code through the Paseo provider `circle` (brief; HIS-75).
- G2 The GSD core ships in the kit: lifecycle discuss -> research -> plan -> plan review -> execute in waves -> verify, the `.planning/` format and the generic role agents; a project supplies only an adapter (build/verify commands, review lenses, models per role, its own agents) (brief; GSP-61..79, UPS-01..03, HIS-42, HIS-44).
- G3 Keep every incident-driven rule of the old kit and of the earlier GSD port, generalized (section Invariants), not the old mechanisms where a simpler one keeps the rule (section Simplifications).
- G4 Projects carry everything they run on; a kit change reaches a project only through `update` (INS-55, HIS-31).
- G5 The harness method is the adapter generator (owner D-109, superseding MTH-62/D-52): after map-codebase it writes the project's adapter (commands, verify vocabulary, review lenses, models per role, a stack skill, project agents only where a GSD agent is not enough); `harness-evolve` records lessons and updates the adapter after phases. Project flow: kit-init -> map-codebase -> harness (adapter) -> new-project -> GSD phases -> harness-evolve.

### Non-goals
- Codex, OpenCode, Pi and every non-Claude harness path; the non-Claude MCP file adapters (`mcp/*`, `machine.local.json`, `agent_mcp`) (brief; RUN-17, RUN-18, RUN-62, INS-46, FIL-44, FIL-45).
- Backlog.md in any form: CLI integration, AGENTS block, backlog-plugin, per-task ritual; planned work keeps state in `.planning/` (brief; INS-16, INS-17, INS-48, UI-60..79, GSP-77, HIS-40).
- The omp variant (brief; HIS-37).
- Native `Agent`/`Workflow` orchestration in the main session (denied on the main provider; D-06; HIS-25).
- Upstream GSD's 16-runtime installer, capability registry, host-integration interface, workstreams, todo/seed/thread parking, cross-AI review CLIs (UPS-36, UPS-63, UPS-65, UPS-80, UPS-85, UPS-86).
- Copying old kit code (brief: old code is reference only).
- Generic team building and orchestrator generation for non-GSD workflows (team patterns, execution-mode choice, orchestrator templates, ai-orchestrator), and code-wave as a kit concept (owner D-109; MTH-02..09, MTH-16..20, MTH-30..41, MTH-61, GSP-66..68).

### Design principles
- P1 One orchestration path: Paseo + `ph`; every agent is a subagent of the calling Paseo agent (RUN-28, HIS-25, D-06).
- P2 One place per setting: the kit never overrides another tool's settings (Paseo skill/tool selection, native autocompact, `metadataGeneration`); the only owner-requested exception is the main-provider deny list carried by a kit machine key (memory no-kit-overrides, memory main-session-no-native-subagents; HIS-27, INS-51).
- P3 One defaults file, one project overlay, one loader with closed validation used by runtime, hooks, file backend and GSD tools (RUN-01, RUN-06, HIS-32, D-77).
- P4 Fail closed and say why: unknown key, missing caller, unverifiable evidence and unknown severity all stop with a named reason; "could not look" is never "pass" (RUN-06, RUN-28, UPS-73, GSP-11).
- P5 Files are the contract: agents' claims are read back from disk (GSP invariants, UPS-46).
- P6 Bounded loops with stall detection and a named escalation; never "proceed anyway" on an open blocker (GSP-50, GSP-55, UPS-28, HIS invariant 4).
- P7 Advisory guidance never blocks: hooks and reminders exit 0 and never deny a tool (HOK invariants).
- P8 Output contract of every CLI: one line per item, `failed <what>: <err>` for item errors, exit 0 done / 1 usage-or-file error / 2 done with differences, conflicts or problems (INS-01, RUN-34, INS-37).
- P9 Vanilla kit (owner D-110): nothing specific to one project, engine or domain (no game or Unreal vocabulary, build scripts, path rules, agents, phases or migration steps) is in the kit; a mechanism learned in a project is generalized with an explicit adapter input, or dropped (HIS-78, GSP-23, HOK-27, D-110).
- P10 Every shipped prompt line earns its tokens; shipped prompt text changes only with owner review and evidence (HIS-09, HIS-39, D-35).
- P11 Offline fixture tests; no live owner config or daemon touched by tests; fakes for external CLIs (INS-57, HIS-65).
- P12 Owner decisions recorded verbatim and dated (HIS-69); generated harness files in English, owner-facing deliverables in the owner's language (MTH-55, HIS-68).

## Target architecture

Thirteen modules. Each lists responsibility, the map IDs it absorbs, and its interfaces.

| # | module | responsibility | absorbs | interfaces |
| --- | --- | --- | --- | --- |
| M1 | install | Copy kit-owned units into a project, track ownership, wire settings, seeds | INS-01..29, INS-36, INS-55..61, HOK-02, HOK-29, HIS-31..36, HIS-88, D-01..D-05, D-10..D-12, D-14 | CLI `kit install|update|status|pull`; writes `.agents/harness-kit.json`, `.claude/settings.json` (own hook entries), `CLAUDE.md` import, AGENTS.md block, `.gitignore` block, seeds; calls M2 nothing; calls `claude plugin install` (M7 activation) |
| M2 | machine | Machine readiness and Paseo provider setup: check/apply/export, provider policy sync, secrets, kit-init user skill | INS-37..54, INS-56, INS-62, RUN-03..05, HIS-25, HIS-27, HIS-30, HIS-76, HIS-90, D-06..D-09, D-13, D-15 | CLI `kit machine check|apply|export` (+ `ph doctor` reuses its check lines); reads/writes `~/.paseo/config.json` (additive), `paseo/providers.json`; calls `paseo reload` |
| M3 | config | Defaults + overlay merge, closed validation, machine keys, provenance | RUN-01..10, RUN-63, HOK-10, HOK-22, HOK-37, FIL-18, HIS-32, D-77 | `loadConfig(root)`, `loadKitConfig()`, `configProvenance(root)`; files `.agents/harness.defaults.json`, `.agents/harness.config.json` |
| M4 | paseo-client | The only module that talks to the Paseo daemon: connect, create, send, wait, usage, permissions, lookup, labels | RUN-12, RUN-25..33, RUN-30, WFL-26, WFL-53, HIS-15, HIS-17, HIS-29, UI-80, D-17, D-100 | `connect()`, `createAgent()`, `sendPrompt()`, `waitTurn()`, `UsageTracker`, `listAgents()`, `resolveTargets()`, `archive()`, `cancel()`; version gate for `ph doctor` |
| M5 | ph | Agent CLI and prompt assembly: doctor, config, spawn, fanout, send, watch, result, team, context, compact-self, stop, archive, task, freeze, worktrees, runs; models/tiers/roles; capacity | RUN-11, RUN-13..24, RUN-34..56, RUN-60, RUN-61, RUN-65, RUN-66, HIS-12..14, HIS-18, HIS-22, HIS-24, HIS-28, D-16, D-18..D-21, D-23, D-26, D-37, D-38 | CLI `ph <command>`; uses M3, M4; files `<ws>/tasks.json`, `freeze_*.sha256`, `.claude/worktrees/` |
| M6 | workflow | Script engine, runner, journal/resume, sessions, `shell()`, schema validation, watchdog, `watch-run`, `run-stats`, run pruning | WFL-01..53, RUN-58, RUN-59, RUN-64, RUN-67..70, HIS-01..03, HIS-16, HIS-17, HIS-23, HIS-83, HIS-89, D-22, D-24, D-25, D-27..D-35 | `ph workflow|watch-run|run-stats|runs`; runner interface `runner(spec) -> {status,result,reason,agentId,model,tokens,durationS}`; run dir `_workspace/_runs/<runId>/` |
| M7 | files | harness-files Claude Code mod + trusted backend: `read_ranges`, `edit_multiple_files`, `write_multiple_files` | FIL-01..50, HIS-05..09, HIS-91, D-39, D-40..D-44 | tools `mcp__harness-files__{read_ranges,edit_multiple_files,write_multiple_files}`; plugin files under `.claude/plugins/`; config `read_limits` (M3) |
| M8 | hooks | Context guard (with `ph compact-self`), io economy guard, syntax-check shell, Windows long-command rescue, registration template | HOK-01..37, HIS-04, HIS-10, HIS-11, D-45..D-51 | `.claude/hooks/*.mjs`, `templates/settings.hooks.json`; config `context_guard`, `io_guard`; adapter `syntax` section |
| M9 | gsd-core | `.planning/` formats, parsers, the `gsd` verb set (state, roadmap, requirements, phase, plan structure, checks, outline, waves, handoff, revisions, attempts, research/verification status), upstream vendoring and generation | GSP-01..37, GSP-72..79, GSP-82..85, UPS-03..05, UPS-16, UPS-25, UPS-41, UPS-42, UPS-51, UPS-66..77, UPS-81, UPS-83, UPS-94, HIS-42, HIS-43, HIS-47..49, D-61, D-62 [pending], D-67, D-69..D-75 | CLI `ph gsd <verb>` (JSON last line, `--pick`, exit 0/1/66/69, `--root`); library calls from M10 scripts |
| M10 | gsd-flows | Skills and workflow scripts of the lifecycle: map-codebase, new-project, discuss, research, plan (outline, wiring stage when the adapter has an architect, skeleton review, per-plan, checker, coverage, handoff, gaps), optional plan review, execute (GSD agents executor, code-reviewer, code-fixer, verifier; bounded review gate rules), verify, quick, progress/next, phase complete, undo, forensics, debugger | GSP-38..71, GSP-80, GSP-81, GSP-86, UPS-06..15, UPS-17..24, UPS-26..40, UPS-43..50, UPS-52..62, UPS-88..94, GDB-*, WFL-46, HIS-44..63, HIS-79..86, D-56, D-58, D-63..D-66, D-68, D-73, D-76, D-78 [pending], D-84, D-87..D-95 | `.claude/skills/gsd-*`, `.agents/workflows/*.js`, `.agents/agents/*.md`; uses M6, M9, M12 |
| M11 | harness (adapter generator) | `harness` skill: reads the codebase map and generates the project adapter (M12); `harness-evolve`: after phases records lessons in the history table and updates the adapter; skill writing/testing rules, role-vs-skill split, model-tier choice; always-loaded rules block (File I/O, Definition of Done, waiting rule, root-cause rule); adapter linter | MTH-01, MTH-04, MTH-10..15, MTH-21..29, MTH-40, MTH-42..44, MTH-46..55, MTH-57..60, MTH-62..65, MTH-69, MTH-71, MTH-72, HIS-38, HIS-39, HIS-55, HIS-66..70, D-109, D-54, D-57, D-59, D-60 | `.claude/skills/{harness,harness-evolve}`; reads `.planning/codebase/*.md` (M10 map-codebase); writes the adapter section (D-77) and project skills/agents; AGENTS.md block (M1); `.agents/harness-history.md` |
| M12 | adapter | The project adapter contract, generated by M11 and evolved by `harness-evolve`: settings section plus project-owned files the core calls by name (stack skill, optional project agents such as an interface architect, checker scripts) | GSP-18..23, GSP-43, GSP-79, HOK-26, HOK-27, HIS-19, HIS-54, HIS-59..62, HIS-74, D-16, D-45, D-64, D-70, D-77, D-110 | config section `adapter` + `gsd` (D-77); project agents in `.agents/agents/`, project skills in `.claude/skills/`, project scripts referenced by path |
| M13 | ui | Paseo plugins: read-only `.planning` panel, trimmed swarm map | UI-01..81, INS-47, HIS-77, D-96..D-104 | `plugins/planning-panel`, `plugins/swarm-map`; RPCs `planning.*`, `swarm.snapshot`, `swarm.agent-detail`; enabled by `machine apply --enable-paseo-plugins` |

Dependency direction: M3 <- (M1, M2, M4..M10); M4 <- M5 <- M6 <- M10; M9 <- M10; M12 is data read by M8, M9, M10; M13 reads `.planning/` and Paseo only. M7 and M8 depend only on M3 at run time.

### Proposed repository layout (kit)

```
paseo-kit/
  kit.json                    name, version, list of shipped units (no project/ mirror; INS-03)
  kit.mjs                     install | update | status | pull | machine check|apply|export (INS-01, INS-37)
  CHANGELOG.md  README.md  NOTICE.md  LICENSES/   (Apache-2.0 for Harness-derived text D-54; MIT notice for vendored GSD text D-62)
  paseo/providers.json        provider template with {{secret:NAME}} / {{HOME}} (INS-45, D-08)
  user/skills/kit-init/       user-level bootstrap skill (INS-56)
  ship/                       everything installed into a project (tests never shipped, INS-03)
    .agents/
      harness.defaults.json
      harness/                config.mjs, platform.mjs, ph.mjs (single entry), paseo-client/, runtime/, workflow/, files/, gsd/
      agents/                 generic GSD roles (gsd-planner, gsd-plan-checker, gsd-phase-researcher, gsd-executor, gsd-code-reviewer, gsd-code-fixer, gsd-verifier, gsd-codebase-mapper, gsd-roadmapper, skeleton-reviewer, finding-verifier, gsd-debugger, ...); no stack-specific or interface-architect agent (a project adapter adds one if needed, D-109, D-110)
      workflows/              gsd-map-codebase.js, gsd-research.js, gsd-plan.js, gsd-plan-review.js (D-66), gsd-execute.js, gsd-verify.js
      gsd/upstream/           pinned trimmed snapshot + UPSTREAM.json, pin data file (D-62)
    .claude/
      skills/                 ph (runtime reference), harness (adapter generator), harness-evolve, gsd-map-codebase, gsd-new-project, gsd-discuss, gsd-research, gsd-plan, gsd-execute, gsd-verify, gsd-quick, gsd-progress, gsd-forensics, gsd-debug
      hooks/                  context_guard.mjs, io_guard.mjs, syntax_check.mjs (shell), bash_long_command.mjs
      plugins/                .claude-plugin/marketplace.json, harness-files/ (mod)
    blocks/AGENTS.md          marked block text (File I/O, DoD, wait rule, root-cause rule, Planning state pointer)
    templates/                settings.hooks.json, harness.config.json seed, harness-history.md seed, .planning seeds
  plugins/                    planning-panel/, swarm-map/ (Paseo plugins, not installed into projects)
  tests/                      offline fixtures and fakes (never shipped)
```

Installed project layout: kit-tracked `.agents/harness.defaults.json`, `.agents/harness/**`, `.agents/agents/<kit roles>`, `.agents/workflows/<kit scripts>`, `.claude/skills/<kit skills>`, `.claude/hooks/<kit hooks>`, `.claude/plugins/**`, the AGENTS.md block; untracked/wired: `.claude/settings.json` entries, `CLAUDE.md` `@AGENTS.md`, `.gitignore` block, seeds (`.agents/harness.config.json`, `.agents/harness-history.md`, `.planning/` seeds); project-owned files beside them are never tracked (INS-59, D-10). Agent definitions stay in `.agents/agents/` (not `.claude/agents/`): they are `ph` role prompts with a non-native `include:` key, and native `Agent` is denied on both providers (INGEST-CONFLICTS W-02).

### Project flow (owner D-109)

1. `kit-init` (user skill) or `kit install --enable-plugin`: git check, install, mod activation, `ph doctor`, `.planning/` seed (INS-56, D-02).
2. `gsd-map-codebase`: four parallel mapper workers write `.planning/codebase/*.md` with `last_mapped_commit` stamps (UPS-11, UPS-12).
3. `harness` (adapter generator): reads the codebase map and writes the adapter: build/test/verify commands and verify vocabulary, review lenses, roles -> models, a project stack skill, project agents only where a GSD agent is not enough, syntax checkers per extension (D-109, D-16, D-45, D-63).
4. `gsd-new-project`: questioning, PROJECT/REQUIREMENTS/ROADMAP/STATE (UPS-07, UPS-08).
5. GSD phases: discuss -> research -> plan (+ skeleton review, checker, optional plan review) -> execute in waves -> verify (UPS-01, GSP-71, HIS-44).
6. `harness-evolve` after phases: history rows, adapter updates (MTH-57..60, D-60, D-109).

## Capabilities

Concise contracts per module, deduplicated across maps. "Dropped" lines give the reason.

### M1 install
- CLI `kit install|update|status <project> [--force] [--enable-plugin]`, `kit pull <project> [<part>...] [--force] [--kit DIR]`; flags anywhere; usage error exit 1; done-with-differences exit 2; `install`/`update`/`pull` print a platform line first (INS-01, INS-02, D-04, D-14).
- Refuse the kit itself or a path inside the kit source (fix the plain `startsWith` sibling bug) and a non-folder (INS-02).
- Units = shipped files (listed in `kit.json`, tests excluded) + marked blocks; digest = sha256 of text with CRLF->LF, one shared helper, longer than 16 hex (INS-03, INS-04, INV-12 of install).
- Manifest `.agents/harness-kit.json`: `version`, `installedAt` (kept), `updatedAt`, `files{path: digest}`; no kit path; keys sorted by code point (INS-05, D-04, install C-16).
- Six-state classification over (project P, kit K, installed I): `same`, `missing`, `kit-newer`, `local`, `both`, `removed`, `removed-local`, `gone`, with one help text per state (INS-06); retired files and retired blocks: unchanged -> deleted, changed -> kept (INS-07, D-11).
- `install`: a differing existing part is kept and listed as a conflict, the manifest is still written, exit 2; the next `update` reports it as `both` (INS-08, INS-09). `update`: takes `missing`/`kit-newer`, `--force` also takes `local`/`both`, deletes `removed`, keeps the rest with the state reason; summary `update: N changed, M kept` (INS-10). `status` read-only, one line per differing unit (INS-11). `pull` copies `local` (and `both` with `--force`) into the kit, warns on a block, unknown part names are errors, reminds to record the CHANGELOG (INS-12, D-05, D-14).
- Marked block in AGENTS.md between `<!-- PASEO-HARNESS-KIT START ... -->` and `END`; replaced in place, inserted at the top when absent, file EOL preserved; project text belongs outside the block; `status`/`pull` warn when the block body differs (INS-14, INS-15, D-05, HIS-88).
- Hook registrations: reconcile only kit hook commands (derived from the template, not a hard-coded list) in `.claude/settings.json`; unrelated hooks, env, permissions and plugins preserved; a locally edited kit hook keeps its registration and is reported (exit 2); write only when the JSON changed (INS-20, INS-21, HOK-02, HOK-29).
- `CLAUDE.md` carries `@AGENTS.md` inserted after leading `@` lines, EOL kept, idempotent (INS-23).
- Seeds created once and never overwritten: `.agents/harness.config.json` (`adapter` and `gsd` sections, D-77), `.agents/harness-history.md` (D-60), `.planning/` seeds (UPS-03) (INS-24).
- Wiring steps run in a fixed list before the manifest is written; any failure leaves no success claim (INS-25).
- `.gitignore` block `# >>> paseo-harness-kit ...` / `# <<<`: `/_workspace/`, `/.claude/worktrees/`, and other generated paths only (no per-skill lines after D-10); owner lines untouched, EOL kept, no write when unchanged (INS-36, HIS-34).
- Mod activation only with `--enable-plugin`: Node gate, Claude Code version gate, mod assets present and unmodified, then `claude plugin install harness-files --marketplace <project>/.claude/plugins --scope project` under the intended `CLAUDE_CONFIG_DIR`; reuse an identical marketplace registered by another project, stop on a different one (INS-27, INS-28, D-02, D-12, FIL-48).
- `--force` never overrides: owner skill folders, `removed-local`, seeds, owner settings, blocked hooks, plugin preconditions (INS-60).
- Upgrade note: no migration code in v1. A project on kit 0.1.0 upgrades by installing the new kit into it (differing files surface as `install` conflicts, exit 2); a generic `kit adopt` for 0.1.0 manifests (retired files by digest, skills moved into `.claude/skills/`) is LATER and only if needed; moving a particular project is that project's own task (D-01, D-110).
- Runtime gates: Node major and the capabilities the code really uses; Claude Code >= the mod's minimum; one shared Claude CLI lookup (`$CLAUDE_CLI`, `~/.local/bin/claude`, PATH; `.cmd` shims through cmd.exe) (INS-29, RUN-60).
- `kit-init` user skill: git check (ask before `git init`, no commit), requirements report, install/update with `--enable-plugin`, `status` + `ph doctor`, then point to map-codebase and the adapter generator (D-109); never `--force` or `pull` without the owner (INS-56). Linked into the user's Claude config dirs by `kit machine apply --link-user-skills` (D-07).
- Dropped: Backlog init/block/CLI check (owner); `migrate` relocation and legacy `scripts/config.json` migration (one-off, INS-18, INS-19, D-01); skill links, link record, mirror-copy verification, stale-link removal, rename-aside link replacement, Windows rebinding (single skill tree D-10; INS-26, INS-30..35); manifest kit path (D-04); `subagent_file_tools.mjs` (retired stub, HOK-25).

### M2 machine
- `kit machine check` (read-only; `ok|problem|note` lines; exit 0/2; 1 when the Paseo config is unreadable), `apply [--no-reload] [--enable-paseo-plugins] [--link-user-skills]`, `export` (INS-37, INS-38, INS-39, INS-44).
- `--link-user-skills`: links the `kit-init` user skill into every `CLAUDE_CONFIG_DIR` named by the template providers (e.g. `{{HOME}}/.claude-circle`); `check` reports each link (present, missing, pointing elsewhere); a link made by the kit is removable by the kit, an owner's own entry is never touched (D-07, install C-14).
- Check lines: Node, platform, Claude Code version for the mod, mod activation note, template providers and models present, provider policy (worker denies incl. SendMessage and env; main denies Agent and Workflow only, SendMessage never required on a main provider; owner extras counted not flagged), optional Paseo plugin lines, `note` lines for model ids present in a kit provider but no longer shipped by the template (left for the owner to remove in Paseo); never probes a model, never starts a daemon (INS-38, INS-49, INS-50, D-15, HIS-90).
- Apply: gates before any write; add missing providers (cloned from the live source provider for workers) and missing models, additive only, never removing a model (D-15); `metadataGeneration` only if absent; backup `<config>.bak-<timestamp>-kit` when the provider step changed something; atomic write; union-only deny lists and kit env keys; mains after workers; reload via `paseo reload` (`$PASEO_CLI` or PATH), `--no-reload` to skip; reload failure after a write exits 2; never restarts the daemon; then runs check (INS-39..42, INS-51, INS-53, D-09).
- Machine keys in the defaults (not project-overridable): `agent_providers` `{circle: circle-agent}`, `agent_provider_disallowed_tools` (the 17 old worker denies + `SendMessage`), `agent_provider_env` `{ENABLE_TOOL_SEARCH: "true"}`, `main_provider_disallowed_tools` `[Agent, Workflow]` (SendMessage allowed on main providers) (RUN-03..05, INS-42, D-06).
- Secrets: env keys matching the secret pattern never enter the kit; `{{secret:NAME}}` filled from `PASEO_KIT_<NAME>`, a live provider with the identical endpoint, env `<NAME>`, else fail before writing; `{{HOME}}` for home paths (INS-43, D-13, HIS-30).
- Export: live config -> scrubbed template, host of secret URLs scrubbed in all strings, assert no secret in the output, atomic write, live config untouched (INS-44, D-08).
- Shipped template `paseo/providers.json`: `circle` (main sessions) and `circle-agent` (workers), both `extends: claude`, `CLAUDE_CONFIG_DIR={{HOME}}/.claude-circle`, the owner's model list re-exported after confirmation (INS-45, D-08, HIS-75).
- Paseo plugin enabling only with `--enable-paseo-plugins`, keeping a user entry that points elsewhere (INS-47, D-96).
- Machine operations target the config dir of the template provider, not the caller's default (INS-62).
- Dropped: MCP registration retirement and `machine.local.json` (non-Claude adapters; D-03 documents the manual removal), `--dirs`/`--fs-server`/`--remove-local`, Backlog CLI check, native-file-deny branches and the 0.0.2 fingerprint retirement (INS-46, INS-48, INS-49, INS-52), the `sync_agent_provider.mjs` shim (INS-54: same function as a subcommand).

### M3 config
- Effective config = `.agents/harness.defaults.json` (kit, `_` keys stripped) + `.agents/harness.config.json` overlay (project); root = `$PASEO_HARNESS_ROOT` else cwd; BOM stripped on every JSON read; `__proto__`-style keys rejected; machine keys and `_` keys in the overlay ignored (RUN-01, RUN-03, runtime Concerns BOM list).
- Merge: per-entry for `tiers`, `tier_aliases`, `platform_notes`, `context_guard`, `io_guard`, `read_limits` and the `adapter`/`gsd` sections; replace for everything else (RUN-02, D-77).
- Closed validation on defaults alone and on the merged result: unknown or missing key fails with `invalid harness config <key>: <msg>`; typed checks for integers, thinking levels, tiers (`provider/model`), aliases, nested tables (RUN-06).
- Blast radius: an invalid overlay fails every command except `ph doctor`, which reports it and continues with defaults, also for unparsable JSON (RUN-07); a file-tool call fails with the message while tool registration keeps working (FIL-18).
- `ph config` prints the effective config plus `_provenance` (RUN-08).
- Shipped values (starting points): tiers frontier/pro/standard, `default_tier` standard, `mode` bypassPermissions, `allowed_models` [] matched on a normalized key (provider mapping applied, `[1m]` stripped), `max_subagents` 20, live-agent cap (new, D-20), `max_agents_per_workflow` 1000, `wait_timeout_s` 3600, `schema_retries` 2, `prime_role` off and `warmup` false (D-24), `max_prompt_bytes` 262144, watchdog 900/1800/900/180 s and 3/3/15 counts with a real `enabled:false` switch, `context_guard` 1000000/60/5, `io_guard` 2/2/2/2, `read_limits` per D-41, `compact_resume` (RUN-10, RUN-14, RUN-65, D-41, D-48).
- Prompt notes: kit base `first_prompt_note` plus an appended project note (no copy of kit text into projects) plus `platform_notes[win32]` (PowerShell re-encoding warning) (RUN-23).
- Dropped: `.claude/harness.config.json` fallback, `modes`, `provider_features`, `agent_mcp`, `isClaudeProvider`, `context_guard.model_pattern` deprecation (RUN-02, RUN-17, RUN-18, RUN-62, HOK-37).

### M4 paseo-client
- One adapter module imports the npm Paseo CLI client (`connectToDaemon`) and helpers; locates the CLI by `$PASEO_CLI_DIR`, PATH, npm global dirs; daemon by `$PASEO_HOST`, else `daemon.listen` of the Paseo config, never `paseo.pid`; `ph doctor` prints the CLI version against the tested version (RUN-25, HIS-29, D-17).
- `createAgent`: size check first, caller required (`PASEO_AGENT_ID`), thinking clamped, `callerAgentId`, title cut to 60 with names validated up front, `modeId`, tier `features`, env `{PASEO_HARNESS_LEADER, PASEO_HARNESS_ROOT, PASEO_HARNESS_ROLE: worker}` + mod env, labels `{...extra, harness.name, harness.run, ph.swarm, paseo.parent-agent-id}` with the parent label written last; usage tracking subscribed at creation, archive on tracking failure (RUN-26, RUN-28, UI-80, D-100).
- Thinking clamp: exact match, else nearest supported level (ties high), never `off` implicitly; catalogue miss never blocks creation (RUN-15).
- `waitTurn`: idle -> structured reply; provider error turns and provider-error reply texts continued in the same agent after 30, 60, 120, 240, 300 s (5 times), never for quota/credit/billing/auth/permission errors; AskUserQuestion denied up to 3 times with the "nobody answers" text; other permission -> error; timeout `no reply within N s` (RUN-31, RUN-32, HIS-15, WFL-26, INGEST-CONFLICTS W-04).
- `sendPrompt` size-checks the fully rendered text (RUN-12, RUN-33).
- `UsageTracker`: per-agent sums from `turn_completed` events, dedup by turn id, baseline before the turn, late-event settle (RUN-27, WFL-53).
- `resolveTargets`: caller's live subagents, then the leader's; exact id, id prefix >= 6, exact title; ambiguity errors (RUN-30). The unfiltered 36-char uuid fallback is a spec decision (keep or restrict to own pools).
- Resumed session agents: model updated and read back before sending; refuse on active turn or provider mismatch; an agent the daemon forgot starts fresh with the full prompt (HIS-16, HIS-17).
- MOD env: `CLAUDE_CODE_PLUGIN_DIRS` added only when the mod is copied, not disabled and not natively registered (RUN-61).
- Dropped: legacy MCP attach for non-Claude agents (RUN-62).

### M5 ph
- Entry `node .agents/harness/ph.mjs <command>`; `help` exit 0, unknown command exit 1, `usage error:` / `failed:` exit 1, item failures `failed <what>: <err>` and exit 2; internal commands hidden; arguments `--key value` only (RUN-34, RUN-35, RUN-52).
- `--prompt` xor `--prompt-file` (BOM stripped) (RUN-36).
- `doctor`: node, caller, config, Paseo CLI/daemon, caller known, tier models offered, default tier, overlay, mod state, provider policy lines (from M2), adapter presence, agent types; continues past every problem (RUN-37, RUN-07).
- `spawn --name N [--count K] [--type] [--model] [--effort] [--read-only] [--cwd] [--ws] [--worktree]`: caller, capacity, unique names, parallel start, `<id> <name>` lines, `next:` watch hint (RUN-38, RUN-39, RUN-40).
- `fanout --file F` (`=== <name> [type= model= effort= read-only=true]` blocks, preamble, case-insensitive unique output names) with or without `--collect DIR` (semaphore of free slots, `.md` + `.json` written before archiving, archive in finally unless `--keep`) (RUN-41, RUN-42).
- `send [--now] NAME...`: waits for the running turn (cancel first with `--now`), delivers, polls until running, `sent <title>`, watch hint (RUN-43, D-38).
- `watch NAME...` under Monitor: one `idle ... out_tokens= context_tokens= duration_s=` line per agent, `watch done: k idle, m failed` (RUN-44).
- `result [--json]` with `tokens` only when tracked from creation, `costUsd` from the price table and `reportedCostUsd` (RUN-45, D-23, D-37).
- `team` (prints `no live subagents` when empty), `context [--self] [--rotate-pct N]` (non-numeric rejected) (RUN-46, RUN-47).
- `compact-self [--focus] [--resume] [--agent]`: one watcher per agent (lock with pid), detached watcher waits for idle, sends `/compact`, success only when used tokens fall below half, then the resume text (config `compact_resume`); otherwise a NOT-confirmed message; no retry; caller stops Monitors and ends its turn (RUN-48, RUN-49, HIS-12, HOK-12).
- `stop`, `archive NAME... | --idle | --name-prefix P | --run RUNID` (`--run` honours `--runs-dir`) (RUN-50, RUN-51, WFL-43).
- Models: tier or `provider/model`, `allowed_models`, `agent_providers` mapping to the worker provider, roles table from the adapter, precedence per D-16 (RUN-13, RUN-14, D-16).
- Capacity: running agents <= `max_subagents`, live agents <= the live cap, names <= 60 chars and unique (RUN-11, RUN-29, D-20).
- Prompt assembly: role block + includes (pasted, never "read X first", definition path and `tools:` never shown) + task + `Runtime notes:` (return-value or work-silently note, teammate note, read-only note, worktree/cwd note, first-prompt + platform note, `Run <runId> #<n>` tag); size-checked (RUN-19..24, WFL-22).
- Agent definitions: `.agents/agents/<type>.md`, front matter `name`, `description`, `tools` (advisory), `model` (tier), `include` (repo-relative files); type names sanitized; real YAML subset parser (RUN-19, RUN-20, D-19, INGEST-CONFLICTS W-02).
- Worktrees: `ph` creates `<repo>/.claude/worktrees/<name>` on branch `harness/<name>` (sanitized names, base dir configurable, created lazily or removed when agent creation fails); `ph worktrees [--prune]` removes only finished, clean, merged ones; `git worktree prune` limited to the listed entry; refuse to spawn when the caller is outside the project root (RUN-55, RUN-56, D-26, HIS-28).
- `ph task` and `ph freeze` stay small primitives (D-18, D-21 narrowed by D-109).
- Dropped: `skills-sync` (D-10), the `.agents/skills/harness/scripts` facades (RUN-52), dead usage tracking in `watch` (runtime Concerns).

### M6 workflow
- Script format: `export const meta = {...}` as the first statement, pure literal (no calls, templates, spreads), `name` and `description` required, `phases[{title}]` optional; body wrapped so top-level `await`/`return` work and line numbers are kept; BOM stripped (WFL-01, WFL-52).
- Determinism guards: `Math.random`, `Date()`, `new Date()`, `Date.now` throw; no require/import/fs/network; `console.log|info|warn|error` map to `log` (WFL-02, D-87).
- Globals: `agent(prompt, opts)`, `pipeline(items, ...stages)` (no barrier, per-item null), `parallel(thunks)` (barrier, never rejects), `phase(title)`, `log(m)`, `args`, `budget{total, spent(), remaining()}`, `workflow(nameOrRef, args)` (one level), `shell(cmd, {cwd, input, timeoutS, tailChars})` -> `{code, stdout, stderr, durationS}`, never rejects, journaled, not cached (WFL-03..10, HIS-23, INGEST-CONFLICTS W-03).
- `agent()` options: `label, phase, schema, agentType, model, effort, isolation:'worktree', readOnly, cwd, keep, session`; returns text, validated object or `null` with a journaled reason; configuration errors throw; 4096 items per call (WFL-03, WFL-04).
- Sessions: `agent({session})` creates and keeps one agent per session key, later calls send only their prompt; reviewers stay fresh; resume adopts the cached call's agent; run end archives session agents (HIS-16, GSP-43).
- Structured output: the kit's own validator, native `outputSchema` at creation when unprimed, `schema_retries` re-asks in the same agent, then `null` with the first three errors (WFL-11, D-30).
- Admission: semaphore `max_subagents`, `max_agents_per_workflow` cap, budget and cap checked before queueing and again after the semaphore; tokens charged before the slot is released; cached hits skip all three; rolling pool, not barriers (WFL-12, HIS-89).
- Resume: cache key = sha256 of prompt + `schema, agentType, model, effort, isolation, readOnly, cwd` + resolved role-text hash + resolved `provider/model`; occurrence index per key; `--resume RUNID` reruns the given or saved script with saved args (WFL-13, WFL-14, D-29).
- Journal `journal.jsonl` (append-only; add a start record per call so a killed runner's in-flight calls are visible) and run dir `script.js, args.json, run.json{runId,parent,script,status running|done|failed|stopped,startedAt,endedAt,agents,budget,pid,name,description,error}, journal.jsonl, log.txt, result.json`; created empty at start so a run without agents can resume; atomic writes (WFL-15, WFL-16, WFL-52).
- `ph workflow [--script F | --name N] [--args JSON | --args-file F] [--resume RUNID] [--budget 500k] [--runs-dir D] [--detach] [--run-id ID]`; exit 1 before the run dir exists, 2 for a failed run; `--detach` re-executes itself and prints the `watch-run` hint; run id `wf_<yyyymmdd>-<hhmmss>_<4hex>` (WFL-17..19).
- Log grammar: `workflow start|done|failed`, `phase`, `log`, `agent start #n <label> <id8> <model>`, `agent done #n <label> ok|null (<reason>) tokens=<n> cost=<usd> <s>s`, `agent cached #n`, `shell start|done #n` (WFL-20, HIS-18).
- Transport loss: no reconnect; later calls return `null` with the reason (WFL-27, D-34). Agents labelled `harness.run`/`harness.name`, archived unless `keep` (WFL-28).
- Priming (`two-turn`) and warm-up gate kept but off by default; when on, clear the fallback timer (WFL-23, WFL-24, D-24).
- Watchdog (workflow agents): model time = time since last prompt minus the union of tool spans; a call's clock starts when its input is complete (readiness table keyed on the kit's exact tool names: native Read/Write/Edit/Bash and the three mod tools); late `running` events ignored; one steering message per kind per prompt for loop (3 identical inputs), reread (3 reads of one file), piecemeal (15 reads without a write), counts reset on a write; nudge at 900 s and archive at 1800 s of model time; stuck file tool (180 s) or other tool (900 s) interrupted once with a retry message and the runner waits for the retry turn; a second hang archives with its real reason; messages size-checked and best effort; teammates get no automatic stop (WFL-30..40, HIS-01..03, D-27, D-28, D-35).
- `ph watch-run RUNID... [--all] [--from-start]`: follows `log.txt` appended bytes, prints `log`/`phase`/`workflow` lines and `agent done ... null` failures, resume summary instead of replay, ends on terminal line, non-running status, dead runner pid (3 checks), missing run dir (60 s) or a run dir without `run.json` (60 s) (WFL-41, HIS-14).
- `ph run-stats RUNID...` from `run.json` + journal (wall, agent seconds, tokens, cost); transcript tool counts optional, matched by the `Run <runId> #<n>` tag (WFL-42, D-31).
- `ph runs [--prune]` keeps failed and recent runs (D-33); `ph archive --run` (WFL-43).
- Authoring rules shipped with the `ph` skill: guard `null`, no needless barriers, per-item extracts instead of corpus files, read the journal first, keep scripts in files, recipes trimmed to the ones GSD scripts use (WFL-45, WFL-50, WFL-51).
- Dropped: facade `scripts/workflow_engine.mjs` (WFL-48), `.claude/workflows` fallback (WFL-10), shell-text and Codex tool-name heuristics of the watchdog where exact names suffice (WFL-33), the misleading stop reason (D-28).

### M7 files (D-39: keep the Claude Code mod, three tools, simpler ticket protocol)
- Three tools only, never deferred: `read_ranges {ranges:[{path, from?, to?}]}`, `edit_multiple_files {files:[{path, tag?, edits:[{oldText?|from,to?|after, newText}]}], fixes:[...], atomic?, dryRun?}`, `write_multiple_files {files:[{path, content}]}`; flat Messages-compatible schemas, validation with field-path messages in the backend (FIL-02, FIL-03, FIL-47, FIL-50).
- Mod (Claude Code engine API, minimum version re-verified): registers the tools at `session.start`, verifies the backend against the install manifest, runs real I/O through native `Bash` tickets so Claude Code's permission chain applies; permission checks fail closed (ask is never promoted); executed target set must equal the checked set; payload never in a command line (FIL-01, FIL-04..09, D-40).
- At-most-once mutation: a started ticket never runs twice; outcome recovered, unknown, or not executed are three distinct messages; completed receipts recoverable without rerun (FIL-14, FIL-15).
- Results never above the persistence threshold: page body about 40,000 chars with continuation for diagnostics; `read_limits` sized so a normal read is one page (FIL-16, D-41).
- Session-bound state (fix IDs, read tags, signatures, continuations) in a private 0700 directory per Claude session; session lock with stale recovery; sweep and budgets; whole stale session dirs removed (FIL-12, FIL-13, FIL-17).
- Paths: relative and Git Bash forms resolved against the session cwd; `~` expanded identically in plan and execution or rejected; containment case-folded only on Windows (FIL-19).
- `read_ranges`: per-entry independence, `ERROR` lines after good entries, header `===== <abs> lines F-T of N, tag <t>`, `to` clamped, `to >= from` validated, folder listing, binary refusal (NUL in first 8000 bytes, hint to native Read for images/PDF), per-entry and per-reply size caps with "lines a-b fit" hints, bounded-memory reader, unique missing-path guess read in place and announced, case-insensitive name matching (FIL-20..25, D-44).
- `write_multiple_files`: all paths checked first, duplicates refused, stage all temps, rename with Windows retry/back-off, rollback with `ROLLBACK INCOMPLETE` reporting; preserve mode bits where possible (FIL-27, FIL-28).
- `edit_multiple_files`: exact-once matching, CRLF files edited as LF and written back CRLF (mixed files refused or preserved per line), binary files refused; partial success with retained single-use fix IDs (500 / 8 MiB), suggestions (whitespace/case/look-alike, short stretch, occurrence list, "changed by an earlier edit"), already-applied detection by coverage and session signatures, atomic and dryRun, distinct result states, several entries per file, file-level failures retained for `{id, path}`, mutation targets never guessed (FIL-29..35).
- Line edits: read tags with per-line hashes (64 reads / 30,000 lines), placement in place, moved (unique hash run with +-2 context), or failure with suggestion/places/current lines and a new tag; never edits changed lines; bottom-up application, overlap failures (FIL-36..39, D-43).
- Classification of tool lists for the read-only note recognises the three mod tool names as writers/readers (FIL-46).
- Native Read/Edit/Write stay available; no impersonation; native subagent calls denied (cheap guard) (FIL-11, FIL-49).
- Dropped: the 14 filesystem-compat methods and directory-walk permission planning (native Glob/Grep/Bash cover them), `read_media_file` and the image-per-turn counter (D-42), the legacy MCP servers and proxy (owner), `INLINE_MAX_CHARS` (FIL-10, FIL-40..45).

### M8 hooks
- Registration template: PreToolUse io guard on native file tools and the three mod tools; PostToolUse io guard on Read/Grep/Glob/`read_ranges`; PostToolUse `*` and UserPromptSubmit context guard; all `command` hooks with `$CLAUDE_PROJECT_DIR`, timeout 10 s; PreToolUse `bash_long_command` on Bash (win32 only); the syntax shell on Edit/MultiEdit/Write and the two mod write tools (HOK-01, D-45, D-46).
- Context guard: main session only (no `agent_id/agentId/parent_agent_id`, no `PASEO_HARNESS_LEADER`, role not `worker`; `agent_type` is not identity); last main assistant usage from the transcript tail (1 MiB, sidechain/synthetic skipped); bands from `start_pct`/`step_pct` over the reported window, config window as fallback; one reminder per band through one atomic state update per session; the stored band lowered on any downward move; reminder text points to `ph compact-self --focus` at a natural break with no edit half-done and no Monitor running; any error -> one stderr line, exit 0 (HOK-03..12, D-48, D-50, HIS-10).
- io guard (all sessions): transcript rounds by assistant message id, in-flight rounds excluded; first-file-round planning reminder once per prompt unless already batching; lookup streak and edit streak reminders once per band per segment; re-read of a file edited in this prompt; empty or truncated Grep/Glob results; claims by exclusive-create files keyed by the full session hash, 24 h prune; texts name only tools that exist; never blocks (HOK-13..23, HOK-32, HOK-35, D-47).
- Syntax shell (kit) + checker per extension (adapter): Pre stores per-file status keyed by session and `tool_use_id`, Post reports only files that passed before and fail after (or new failing files) as `additionalContext` with `file:line:col`; hook-wide time budget below the hook timeout; per-checker slot cap and content-hash cache; checker resolved from the tree of the edited file (worktrees); targets from `file_path`, `files[].path`, `path`; never blocks (HOK-26, HOK-27, HOK-30, D-45, HIS-04).
- Windows long-command rescue: a Bash command longer than about 6000 chars (quote growth counted) or containing `\\` is written to a temp script and run with `source`; win32 only; never blocks (HOK-28, D-46).
- Hooks are project copies owned by digest and find the config by one documented env var or discovery function (HOK-31, D-49).
- Dropped: `subagent_file_tools.mjs` stub (HOK-25), `mcp__fsbatch__`/`mcp__filesystem__` vocabulary (HOK-13), heavy PID/mtime claim recovery (HOK-07, HOK-36).

### M9 gsd-core
- `.planning/` format (see Data formats) with the upstream file grammars: ROADMAP phase sections (`**Goal**`, `**Depends on**`, `**Requirements**`, `**Success Criteria**`), REQUIREMENTS table/bullets with free-form IDs and a Spec column, PLAN frontmatter and XML tasks with `<automated>` + `<fails_when>`, SUMMARY with `key-files`, VERIFICATION with `covered_files` + `covered_digest`, CONTEXT six sections with `D-NN` decisions, DISCUSS-CHECKPOINT (GSP-13..16, GSP-24, GSP-59, GSP-65, UPS-16, UPS-75, UPS-76, D-69).
- Phase ids: integer and decimal (`01.1`), dirs `NN-slug`; artifact kinds by filename (GSP-14, UPS-05).
- `ph gsd <verb>`: JSON on the last stdout line, `--pick key` (absent field exit 1), exit 0 ok / 1 negative verdict / 66 nothing in scope / 69 could not look or not ported; `--root <checkout>` re-points the code root (GSP-12, GSP-82, UPS-67, UPS-73).
- Verbs (re-implemented, no upstream code): `init.<workflow>` payloads, `state` (load, position, planned-phase, wave log, decision, override, session note; frontmatter derived from files; lock file), `roadmap get-phase|analyze|annotate-dependencies`, `requirements mark-complete|revert`, `phase add|insert|remove|complete|uat-passed`, `phase-plan-index`, `find-phase` (null counts when unresolved), `verify plan-structure|artifacts|key-links`, `verification status|fingerprint`, `check coverage|decision-coverage|verify-command-paths|verify-failure-directions|owns|evaluation-scope`, `outline parse|check`, `waves`, `handoff`, `revisions record|check|hash|show`, `supersede`, `attempt record|show`, `write`, `hash`, `research status|prompt`, `commit` (`--files` required, skip envelope), `select-revert-commits`, `run-with-timeout`, `normalize-test-command` (GSP-17..37, GSP-72, UPS-66, UPS-67, UPS-81, UPS-94, D-61, D-72).
- Verb table with explicit "not ported" reasons (exit 69, never a pass) for upstream verbs the kit does not serve (GSP-11).
- Plan structure: required frontmatter, at least one task with an automated obligation (core error), task-type rules, checkpoint shapes, truncation detection; ownership/vocabulary checks through adapter hooks (GSP-17, GSP-18, D-61).
- Probes: verify-command paths with `pending_creation` and the new `pending_shared` status; failure directions; owns; unknown kind = blocker (GSP-19, GSP-20, D-71).
- Coverage gates: every ROADMAP requirement ID in some plan, every trackable CONTEXT decision cited; blocking (GSP-21, GSP-22, UPS-30).
- Outline + manifest (`plans[{id, owns, requirements, produces, consumes, tracer, verify}]`), outline check (incl. tracer rules and the plan-count/wave ceiling of D-70), waves, handoff `handoff/[<prefix>-]w<k>.args.json` (tracer alone first in `per-wave` mode) as the executor-neutral contract (GSP-24..28, GSP-74, D-70).
- Revision hashes (`revisions.json`: key -> hash + file list stored once) over inputs incl. the phase's ROADMAP section; changed owner input invalidates dependents; a code change alone is reported (`headChanged`) (GSP-29, HIS-47).
- Readback verbs: `research status` (attempt key, digest, terminal marker, required sections, provenance tags) and `verification status` (closed enum, consistency of status with gap/human lists, fingerprint, `stale`) (GSP-33, GSP-35, UPS-72, D-67).
- Phase status ladder computed in one function from plan/summary counts, verification status and completion; ROADMAP checkboxes have no authority; scope tri-state on derived answers, null percentages when scope is not complete (UPS-70, UPS-71).
- Upstream carriage (D-62, option A; MIT notice ships): pinned trimmed snapshot (sha256 manifest, pin data file), clone read without running git, generated agents/skills = adapter front matter + precedence note + path-rewritten upstream body, verbatim contract blocks extracted by anchors, `check` fails on edited snapshot, stale/hand-edited output, dangling reference or unmapped verb, LF-normalised comparison (GSP-01..10, UPS-87, GDB-54, HIS-43).
- Dropped: Backlog `todo.match-phase`, project-specific scans/regexes/paths inside the core tool (a project's adapter supplies source roots, shared-file rules and resolvers, D-110), upstream state-write machinery (per-field preservation, rebuild log), capability/loop-hook/intel/graphify/learnings verbs (GSP-77, UPS-66, UPS-69, UPS-38).

### M10 gsd-flows
- Orchestration: main session or `ph workflow` scripts; workers are `ph` agents (native Task/Agent never); prompts pass paths, not contents; markers are the worker result contract; agents never ask, owner-needing markers become `needs-owner {stage, reason, issues|conflict|question, options}`; quota/auth errors never retried (UPS-02, UPS-27, GSP-46, GSP-75, HIS-21).
- map-codebase: 4 parallel mappers write 7 docs to `.planning/codebase/` and return confirmations; `--paths` incremental remap with path validation; secrets scan before commit; stamp `last_mapped_commit` by a shell step; warn-only drift gate at plan:pre (UPS-11, UPS-12). Its output is the input of the adapter generator (D-109).
- new-project: questioning, PROJECT.md, optional 4 researchers + synthesizer (orchestrator self-heals a SUMMARY.md the worker could not write), REQUIREMENTS by category, roadmapper with 100% v1 coverage, approval loop, STATE init; resume at the first missing artifact; no nested `git init` (UPS-07..09).
- discuss (main session, interactive, upstream text): phase-specific gray areas, numbered plain-text questions, checkpoint before the first question and after every answer, CONTEXT six sections with stable `D-NN`, deferred ideas, prior decisions not re-asked, unported modes refused, STATE single writer (GSP-70, UPS-15..17).
- research: `ph gsd research` view/reuse/refresh, one researcher writes only RESEARCH.md with input digest + attempt key + terminal marker, readback decides (blocked/stale/invalid never count), research input policy (only the approved report or NONE) in every later prompt (GSP-33, GSP-41, GSP-42, GSP-61..63, UPS-20, UPS-21, D-67).
- plan workflow: arg validation (`maxSkeletonPasses`/`maxCheckIterations` 1..3, at least one lane), Discuss and Research preconditions, outline (reuse when marker + inputs unchanged; regeneration failure never certifies an old outline; up to 2 mechanical fix turns), wiring-contract stage only when the adapter provides an architect agent, skeleton review (lanes from config, default fidelity + integration, resolution checks, stall, cap 3, open blockers -> needs-owner, warnings carried), OUTLINE-REVIEW.md + freeze, per-plan planners in parallel per wave (sessions `planner:<id>`, frozen manifest entry, wiring quotes), structure check with one fixer turn, plan-checker loop with deterministic probes counted in code (cap 3, stall, unknown severity = blocker, one REVISION_CONFLICT stops), `forceProceed {reason}`, coverage gate, handoff; `gaps` mode from VERIFICATION.md with one gap wave enforced; specless edge/prohibition prompt block; tracer-first and reversibility gates (GSP-38..58, GSP-84, UPS-18, UPS-25, UPS-28..30, UPS-37, UPS-39, UPS-88, D-65, D-68, D-73, D-74).
- optional plan review stage (off by default): finders per plan x lens, verifier/judge per issue, cross-plan dedupe, one strong editor, structure check, handoff regenerated; convergence stop rules (D-66; GSP-80, HIS-50, UPS-34, UPS-35 source grounding as a lens).
- execute (GSD execute path, D-63/D-109): safe-resume gate (incomplete plan with changes but no SUMMARY stops), plan index/readiness and the ordered all-filtered routing, overlap check forcing sequential plans, cwd/branch drift guard, executor dispatch per plan with `gsd-executor` following the adapter's stack skill (deviation rules 1-4 with the package-install exclusion and 3-attempt cap; no commits by workers; SUMMARY written to its granted path), artifacts reconciled before failure classification, failure classes (quota with retry-after, unknown), post-wave build/test gate with adapter commands (build 300 s, tests 600 s, tracking only when green), code review by `gsd-code-reviewer` with adapter lenses and the bounded gate rules (trigger + confidence >= 80, independent finding verification, unverified high blocks, one `gsd-code-fixer` pass, resolution check), modes `per-wave` and `batch`, `fixer_verifies_itself`, worktree or shared tree + disjoint `owns` per adapter, orchestrator commits (one per wave or per plan per policy) (UPS-40..49, UPS-89, GSP-66, GSP-67, GSP-85, GSP-86, HIS-51, HIS-53, HIS-54, HIS-59, D-26, D-56, D-63, D-64).
- verify: one fresh `gsd-verifier` per phase reads plans, summaries (claims, not proof) and wave evidence, writes VERIFICATION.md with the fingerprint; attempt record before dispatch; the file's status wins; a report equal to the previous one is rejected; `human_needed` writes UAT.md and never advances; `gaps_found` -> plan `--gaps` + one gap wave + re-verify (GSP-64, GSP-65, UPS-50, UPS-54, UPS-55).
- phase complete, transition, progress/next router (Route 0 first: unfinished plans anywhere), pause/resume handoff, quick (`.planning/quick/<id>-<slug>/`, `--full`), undo (`git revert --no-commit`, exact scope), health check of `.planning/` (UPS-51, UPS-56, UPS-57, UPS-60, UPS-63, UPS-83, UPS-94, D-89).
- forensics: main session, read-only, report `.planning/forensics/<date>-<slug>.md`, every hypothesis labelled forensic, redaction rules, GitHub step skipped (GDB-52, GDB-53, D-84).
- debug (D-78, option B): `gsd-debug` skill with a plain `gsd-debugger` agent: upstream session file `.planning/debug/<slug>.md` (Symptoms immutable, Evidence/Eliminated append-only, concrete `next_action`), one session per failure signature (reuse, reopen with earlier resolution), DATA_START/DATA_END for untrusted text, edit scope from the plan's owns, the root-cause rule, a bounded run/time budget, "a filter that ran nothing is not a pass", knowledge base on close; the old port's supervised engine (typed requests, lease, supervisor, snapshot/revert-and-reconfirm) is LATER and not part of the kit (GDB-06..12, GDB-22..24, GDB-32, GDB-45, GDB-46, GDB-48, GDB-58, HIS-55..57).
- Dropped: code-wave as a kit concept and its project-specific Verify mechanics (D-109, D-110; GSP-66..68: only the generic rules survive, in the execute step above), quick-batch (D-76), ship (D-90), autonomous milestone driver, spec-phase, UI/AI/eval gates, Nyquist, package-legitimacy gate, plan bounce, cross-AI review, workstreams (UPS LATER/DROP list), Backlog references (GSP-77).

### M11 harness (adapter generator) (owner D-109)
- `harness` skill, run after map-codebase: reads `.planning/codebase/*.md` (stack, architecture, conventions, testing, concerns) and writes the adapter (M12): build/test/verify commands and verify vocabulary with resolvers, review lenses, roles -> models/efforts by tier choice, syntax checker per extension, one project stack skill (how to code in this stack), project agents only where a GSD agent is not enough; reports what it wrote and asks the owner to confirm (D-109, MTH-04, MTH-10, MTH-11).
- Role-vs-skill split: an agent definition says who, a skill says how; reuse a GSD agent before creating one; overlap check before a new agent or skill (MTH-10, MTH-11, MTH-14, MTH-15, MTH-28).
- Model-tier choice by the work, not importance; tiers frontier/pro/standard; concrete models in the adapter roles table with a reason (MTH-12, MTH-13, D-16).
- Skill writing rules: description states what and when (assertive, exclusions, follow-up words), body < 500 lines, explain why, generalise, progressive disclosure, references with contents over 300 lines, scripts for repeated code, no README/CHANGELOG in a skill, output formats matching schemas, English (MTH-21..28, MTH-55).
- Skill testing: realistic prompts, with-skill vs baseline, assertions that discriminate, trigger test (10 should + 10 near-miss; 3+3 on evolve) required for generated project skills, A/B optional, eval schemas `eval_metadata.json`, `grading.json`, `timing.json` (MTH-29, MTH-47..52, D-57).
- Adapter linter (scripted): adapter section validates, every referenced skill/agent/script exists, generated skills pass the skill lint, no in-session primitives (`Agent(`, `Workflow`, `SendMessage`, `TaskCreate|Update|List|Get|Stop`, `TeamCreate`, `broadcast`) in generated text (MTH-46, MTH-54, MTH-72).
- `harness-evolve` after phases: reads history, git log, run records (`run.json`, `journal.jsonl` null reasons), review metrics and deferred findings; classifies feedback to the adapter part it touches; generalises, records the why, one change at a time, regression conflicts go to the owner; appends a history row; re-runs trigger tests when a description changed; kit-wide lessons go back to the kit through `kit pull` (MTH-53, MTH-57..60, D-58, D-60).
- Always-loaded rules (AGENTS.md block): File I/O (Grep/Glob, batch reads/edits, no re-read to verify, correctness first), Definition of Done before execution, waiting rule (no hand-rolled polling, follow the `next:` line), never retry quota/auth, never fabricate a stopped agent's judgment, fix the product not the fixture, preflight 2-3 items before a fan-out, scripts own bookkeeping, pass paths not content (HOK-24, MTH-40, MTH-42..44, MTH-61, MTH-63, HIS-55, D-53).
- History table `.agents/harness-history.md` (D-60); NOTICE/LICENSE for Harness-derived text (MTH-65, D-54).
- Dropped (D-109): execution-mode choice, team patterns, verification and QA patterns, orchestrator templates A/B/C/mixed, `CLAUDE.md` harness entry, `_workspace` conventions, data-transfer table, work-size table, team examples, ai-orchestrator skill, generic `ph workflow` invocation forms (MTH-02..09, MTH-16..20, MTH-30..39, MTH-41, MTH-45, MTH-56, MTH-61, MTH-66..68, MTH-73).

### M12 adapter (generated by M11)
- Settings (D-77: sections `adapter` and `gsd` of `.agents/harness.config.json`; no `.planning/config.json`): `adapter.commands` (build, test, verify per obligation kind; timeouts), `adapter.verify_vocabulary` (kinds, parser, resolver per kind), `adapter.ownership` (owns syntax, shared-file predicate, source roots), `adapter.review_lenses`, `adapter.syntax_checkers` (extension -> command), `adapter.instructions` (project instruction files hashed into revisions), `adapter.envelope` (optional configuration envelope for solution quality), `gsd.roles` (role -> tier or model + effort: research, outline, planner, checker, skeleton lanes, coder/executor, reviewer, finding-verifier, verifier, fixer, mapper), `gsd.granularity`, `gsd.plan_limits` (tasks per plan, plans and waves per phase), `gsd.execution_mode`, `gsd.fixer_verifies_itself`, `gsd.commit_policy`, `gsd.requirement_id_regex` (GSP-18..23, GSP-43, GSP-60, GSP-79, GSP-84, HIS-61, HIS-62, HIS-74, D-16, D-63, D-64, D-69, D-70).
- Project files: one stack skill in `.claude/skills/<stack>/`, optional project agents in `.agents/agents/` (e.g. an interface architect for the wiring stage), checker and verify scripts referenced by path; optional machine-wide mutex name for heavy tools (HIS-62).
- Acceptance: the generator produces linted adapters for fixture codebases of at least two different stacks; the kit ships no project's adapter (D-110).

### M13 ui
- Paseo plugin layout (`paseo-plugin.json`, `index.server.ts`, `index.client.tsx`, `shared/` zod contracts, `server/`, `client/`), RPC names `^[a-z][a-z0-9._-]*$`, handlers return typed `ok:false` envelopes, polling with cached server work, React Native primitives only, theme colours for text, read-only (UI-01..08, UI-55, D-101, D-102).
- `.planning` panel (first): workspace directory resolution, `.planning/` index by relative path with mtime cache, frontmatter + markdown rendering, file tree, phase/plan board by GSD status ladder, plan detail (tasks, must_haves, summary), stats tiles, project picker (main checkout default, worktree switcher), id-equality guard on detail queries, paths resolved inside `.planning/` (UI-60..81, D-96, D-98).
- Trimmed swarm map: `swarm.snapshot`/`swarm.agent-detail`, brain/hub/agent from the parent label, grouping by the `ph.swarm` label, activity eligibility and timeline tail cache, file ledger (holder, handoff, write conflict), event log with epoch, stable slots, shared animation clocks, ROTATE threshold from the kit's context settings (UI-10..28, UI-33..50, UI-52..54, D-97, D-100, D-103).
- Dropped: backlog plugin data path (CLI runner, parsers, config cache), temp-dir queue/review runs and their cards (incl. the `firstLineCount` regex bug), sim harness, `paseo_tool.py` references (UI-29..32, UI-51, UI-58, UI-60..67, UI-79, D-99, D-104).

## Invariants

Incident-driven rules that must survive, deduplicated. Format: rule - incident - IDs.

- INV-01 Owner edits to kit-owned files are never overwritten without `--force`; conflicts are kept, listed and exit 2 - data loss avoidance; a conflict at install must still write the manifest - INS-06, INS-08, INS-10, INS-60, HIS-33.
- INV-02 Ownership by three line-ending-insensitive digests, never timestamps - git checks out CRLF on one machine, LF on another - INS-04, INS-06.
- INV-03 Remove only what is proven kit-owned (recorded digest, record, fingerprint); a same name is no proof - retired files, stale links, legacy MCP and denies - INS-07, INS-34, INS-52, D-11.
- INV-04 Fail before writing; a failed wiring step never leaves a success claim - skills-sync failure test - INS-25, INS-29, INS-39.
- INV-05 The kit never overrides another tool's settings; the main-provider deny list is the only owner-requested exception and changes only through its kit key - `skills.ignoredSkills` trick rejected 2026-10-11 - memory no-kit-overrides, HIS-27, INS-51.
- INV-06 Main sessions orchestrate only through Paseo/`ph`: `Agent` and `Workflow` denied on the main provider (`SendMessage` stays allowed there); workers deny their own list, including `SendMessage` - owner 2026-10-14, corrected 2026-10-20 - HIS-25, RUN-04, D-06.
- INV-07 Machine changes are additive, backed up, atomic, never restart the daemon (reload only) - owner rule - INS-39..41, INS-53, D-15.
- INV-08 No secret or endpoint in tracked files; placeholders; export asserts no leak - public repo, history rewritten 2026-10-11 - INS-43, INS-44, HIS-30.
- INV-09 A project carries everything it runs on; no kit path at run time - "a new dev machine clones the project only" - INS-55, HIS-31, D-04.
- INV-10 Every agent is a subagent of the caller (`PASEO_AGENT_ID`, parent label written last); refuse without a caller and when the caller is outside the project root - stray workspaces; agents working in another folder - RUN-28, HIS-28, UI-80.
- INV-11 Every outbound message is size-checked on its fully rendered text before any daemon call - a 42 MB prompt dropped the runner socket (wf_20261004-153848_8eb7) - RUN-12, WFL-25.
- INV-12 Running agents bounded by RAM - 30 agents exhausted 32 GB (about 350 MB per agent) - RUN-11, WFL-12, D-20.
- INV-13 Never retry quota, credit, billing, auth or permission failures; transient provider errors are retried with growing pauses up to 5 times - a reviewer's reply "API Error" gave a null review; retries burn remaining quota - RUN-31, HIS-15, MTH-40.
- INV-14 Subagents never ask the owner; AskUserQuestion is denied with an instruction; blockers go into the structured result; owner questions become `needs-owner` - a fixer's SendMessage to main was lost - RUN-32, HIS-21, GSP-46.
- INV-15 Usage baseline before the turn; no double counting; collect replies and usage before archiving (archived agents are unreadable) - audit RUN-1/SPD-2 2026-10-04 - RUN-27, RUN-42, WFL-53.
- INV-16 Directory and worktree are prompt instructions as long as Paseo ignores a requested cwd (re-verify) - verified 2026-10-03 - RUN-39.
- INV-17 Agent names <= 60 characters, unique among live agents; id prefixes >= 6; ambiguity errors - lookup by truncated title (CMD-4) - RUN-29, RUN-30.
- INV-18 Non-blocking commands print the exact `next:` watch command; nobody hand-rolls sleep/grep polling; agents end their turn while waiting - owner 2026-10-14 - RUN-40, HIS-13, MTH-63.
- INV-19 Watchers end by themselves (terminal line, non-running status, dead pid, missing run) and never replay a whole log on re-arm - owner 2026-10-03/14, audit SIDE-6 - WFL-41, HIS-14.
- INV-20 A tool call's watchdog clock starts when its input is complete; a late `running` event never reopens a finished call; after a first-hang interrupt the runner waits for the retry turn; tool time is not model time - wf_20261015-011128_ecea lost 3 of 4 drafts; two false stops 2026-10-14 - WFL-30..37, HIS-01..03.
- INV-21 An `agent()` failure is a value (`null` + journaled reason), never a rejection; configuration errors throw - upstream parity - WFL-03, MTH-40.
- INV-22 Resume never reuses an answer or session for other inputs: no clock or randomness in scripts, content-hash keys incl. resolved role text and model, input digests in planning prompts, resumed session model read back, a forgotten session starts fresh with the full prompt - audit ENG-5; resumed fixers on the old model; EMFILE after restart - WFL-02, WFL-13, WFL-14, GSP-39, HIS-16, HIS-17, D-29.
- INV-23 A warm-up fallback timer is cleared when the gate opens - `ph workflow` lingered 90 s - WFL-24 (if priming is on, D-24).
- INV-24 Self-compaction succeeds only on a measured token drop, is never retried, one watcher per agent, Monitors stopped first, native autocompact untouched - cancelled compactions; four watchers on one agent (omp) - RUN-49, HOK-12, HIS-12.
- INV-25 Context reminders are decided by role identity, not model name, once per band - model-pattern guard replaced - HOK-03, HIS-10.
- INV-26 Hooks never block and never fail loudly (exit 0; one stderr line for config errors) - an advisory turned outage - HOK-09, HOK-21.
- INV-27 Syntax checks report only newly broken files, run within a budget below the hook timeout, cap machine-wide parallel checks, and resolve the checker from the edited file's tree - a batch edit held an agent 15 min; worktree edits skipped 2026-10-16 - HOK-26, HOK-27, HIS-04.
- INV-28 No tool result above Claude Code's persistence threshold; nothing lost silently; errors paged with their fix IDs - a 6.1 MB read was saved to a file - FIL-16, FIL-23, HIS-05.
- INV-29 A mutation executes at most once; an unknown outcome is reported with a recovery path, never retried blindly - FIL-14, FIL-15.
- INV-30 Mutation targets are never guessed; read guesses only when unique, permitted and announced - 346 failed reads in a week - FIL-20, FIL-21.
- INV-31 Batch tools: per-entry/per-file independence, partial success with single-use fix IDs, a resent applied edit is skipped (never doubled), changed lines never edited through a stale tag, dry runs leave no trace, no "nothing written" claim without a real rollback - resent edits failed or doubled; omp-io batches lost - FIL-22, FIL-29, FIL-33, FIL-37, HIS-06, HIS-07, HIS-91.
- INV-32 Text reads refuse binary files, read bounded memory, and agents never get whole corpus files - a 15 MB JSON closed an agent's MCP server - FIL-24, FIL-25, WFL-50.
- INV-33 Relative and Git Bash paths resolve against the session cwd - 208 of 346 failed reads - FIL-19.
- INV-34 Native Read/Edit/Write stay usable and are never impersonated or denied while an alternative is inactive - FIL-49, HOK-25.
- INV-35 The file is the contract: research, verification and plan structure are read back from disk; a null agent result counts only if a fresh, valid file exists; the accepted report must be the one this attempt wrote - GSP invariants, GSP-64, UPS-46.
- INV-36 "Could not look" is never "pass": exit 69, scope tri-state, null percentages, unknown severity = blocker - upstream #5170, #3180 - GSP-11, UPS-71, UPS-73.
- INV-37 Every loop is bounded with a stall rule and a named escalation (skeleton <= 3, checker <= 3, gap closure 1, fix rounds, provider retries 5); never "proceed anyway" on an open blocker or conflict - review/fix loops never converged; nine debug rounds on one step - GSP-50, GSP-55, UPS-28, HIS-46, HIS-52, HIS-79.
- INV-38 Single writer of STATE/ROADMAP/REQUIREMENTS (the orchestrator); revisions recorded serially after parallel planners join; one agent per file at a time - upstream #2070 last-merge-wins - GSP-72, UPS-69, HIS-49.
- INV-39 A changed owner input invalidates what was built on it; a code change alone is reported, not invalidating - GSP-29, HIS-47.
- INV-40 Upstream is untrusted data: read the clone's HEAD without running git there, never edit the snapshot, never hand-edit generated files, `check` fails on drift - GSP-01, GSP-02, GSP-08, GSP-09, D-62.
- INV-41 Review only built code; a high finding blocks only with a trigger, confidence >= 80 and above-theoretical likelihood; findings are verified independently; an unverified high still blocks; one fix pass plus a resolution check - reviewers wrong too; rounds kept adding findings (2026-10-17) - HIS-51, HIS-53, MTH-64, D-56.
- INV-42 Fix the product, not the fixture; a corrected test that exposes a product bug stays red; never weaken an assertion, tolerance or wait - debuggers changed fixtures and tolerances until a probe passed, hiding the real product bug (field evidence) - HIS-55, GDB-48.
- INV-43 Only a passing verification completes a phase; `human_needed` never advances; a ROADMAP checkbox has no authority - upstream #5118 - UPS-50, UPS-70.
- INV-44 Artifacts decide completion (SUMMARY + evidence/commits); an abnormal session end is reconciled before it is classified - upstream #4217 - UPS-46.
- INV-45 Worker prompts: never message the main/leader session; write long documents in parts (each tool call under about 300 lines) and keep the final reply short - owner 2026-10-18 and 2026-10-19 (output-cap stalls) - RUN-23.
- INV-46 Preflight 2-3 items through every stage before a large fan-out; scripts own mechanical bookkeeping - 0 of 38 families passed first check; 57 of 112 partition plans failed on IDs - MTH-42, MTH-43.
- INV-47 Fan-out admission is a rolling pool, never fixed batches - owner correction "20 concurrent rolling workers, not 20-job barriers" - HIS-89, WFL-05.
- INV-48 Owner decisions are recorded verbatim and dated in STATE.md so a compacted or restarted orchestrator recovers them - HIS-69, HIS-70.
- INV-49 Shipped prompt text changes only with the owner's review and evidence - memory omp-prompt-review-first - HIS-39, D-35.
- INV-50 Probe, smoke and A/B agents use `circle/gpt-6-luna-fast[1m]` unless the owner names another - memory test-model-luna-fast - HIS-20.
- INV-51 Generated harness files are English; owner-facing deliverables use the owner's language - owner 2026-10-03 - MTH-55, HIS-68.
- INV-52 Windows realities: npm `.cmd` shims through cmd.exe, paths with spaces, CRLF, case-insensitive path compare, long Bash command lines, PowerShell re-encoding of non-ASCII - INS INV-14, HOK-28, RUN-23, RUN-60.
- INV-53 A test filter or verify command that executed nothing is not a pass; "cannot verify" is never "pass" - GDB-17, GDB-31, HIS-81, HIS-84.
- INV-54 A restored file gets a later mtime (git whole-second stat cache) - same-size restore misread - GDB-04, HIS-57 (applies wherever the kit restores files).
- INV-55 `ph send` to a running agent waits for the turn end (or `--now` interrupts); orchestrators batch follow-ups - three quick sends interrupted a debugger - RUN-43, HIS-22, D-38.
- INV-56 Paseo plugins are read-only, poll cheaply, use valid RPC names, return typed envelopes and never depend on the user's PATH - failed plugin load; daemon PATH lacks npm - UI-03, UI-04, UI-55, UI-61.
- INV-57 Tests are offline fixtures with fakes for external CLIs, temp homes with spaces, and assertions of no side effect when a gate fails; no live owner config or daemon touched - INS-57, HIS-65.

## Data formats

### `.planning/` (owner: orchestrator writes shared files; agents write only their own artifacts)
| path | content | writer | source |
| --- | --- | --- | --- |
| `PROJECT.md` | what/why, Validated/Active/Out of Scope, Key Decisions, evolution footer | new-project, transition | UPS-07, UPS-51 |
| `REQUIREMENTS.md` | table `| ID | Spec | Rule | Phase | Status |` or v1/v2 bullets; free-form IDs (default `PREFIX-N`, adapter regex); traceability | new-project, orchestrator | GSP-16, UPS-75, D-69 |
| `ROADMAP.md` | phase sections (`Phase N[.M]: name`, Goal, Depends on, Requirements, Success Criteria, Plans), decimal phases INSERTED, Progress table | orchestrator (`gsd` verbs) | GSP-15, UPS-75 |
| `STATE.md` | frontmatter derived from files (`gsd_state_version`, status, milestone, active phase, progress, last_updated, state_head); body: Project Reference, Current Position, Decisions (owner, dated, verbatim), Models, Owner rules, Overrides, Wave log, one replaced current-state/continuity block | orchestrator via `gsd state` | GSP-72, UPS-68, HIS-49, HIS-69, HIS-70, D-72 |
| `codebase/*.md` | 7 mapper docs with `last_mapped_commit`/`last_mapped_at` | mappers + stamp step | UPS-11, UPS-12 |
| `research/` | project research + SUMMARY.md | new-project researchers | UPS-07 |
| `phases/<NN>-<slug>/` | `<NN>-CONTEXT.md` (`<domain>`, `<decisions>` D-NN, `<canonical_refs>`, `<code_context>`, `<specifics>`, `<deferred>`), `-DISCUSSION-LOG.md` (audit only), `-DISCUSS-CHECKPOINT.json`, `-RESEARCH.md` (frontmatter `status`, `input_digest`, `attempt_key`, terminal marker), `-PLAN-OUTLINE.md` + `.manifest.json`, `-WIRING.md` (when an architect exists), `-OUTLINE-REVIEW.md`, `<NN>-<MM>-PLAN.md`, `-SUMMARY.md`, `-VERIFICATION.md`, `-UAT.md`, `deferred.md`, `revisions.json`, `*-attempt.json`, `handoff/`, `superseded/` | per stage | GSP-14, GSP-24, GSP-29..31, GSP-65, GSP-73, GSP-74, UPS-16, UPS-17, UPS-76, D-58 |
| `quick/<YYMMDD-xxx>-<slug>/` | `<id>-PLAN.md`, `-SUMMARY.md` | quick | UPS-56, D-89 |
| `debug/` | `<slug>.md`, `resolved/<slug>.md`, `knowledge-base.md` | debugger, debug skill | GDB-06, D-78, D-82 |
| `forensics/<YYYY-MM-DD>-<slug>.md` | read-only investigation report | main session | GDB-52, D-84 |
| `.continue-here.md`, phase `.continue-here.md` | pause handoff; blocking anti-pattern rows | pause-work | UPS-63, UPS-91 |
Not used: `.planning/config.json` (D-77), todos/threads/seeds, workstreams, MILESTONES.md until milestone support lands (UPS-62, D-93).

### Kit and project configuration
| file | owner | content | source |
| --- | --- | --- | --- |
| `.agents/harness.defaults.json` | kit (tracked) | all shipped defaults incl. machine keys; `_notes` | RUN-01, RUN-10 |
| `.agents/harness.config.json` | project (seeded once) | overlay of differences; `adapter` and `gsd` sections (D-77) written by the adapter generator | RUN-01, D-77, D-109 |
| `.agents/harness-kit.json` | generated | `{_notes, version, installedAt, updatedAt, files{path: digest}}` | INS-05, D-04 |
| `.agents/model-prices.json` | project data | USD per 1M tokens per model key: `input, cachedInput, cacheWrite, output, longContext?`, `source`, `notes` | RUN-66, D-23 |
| `.agents/harness-history.md` | project | `Date | Change | Scope | Reason | Supersedes` | MTH-60, D-60 |
| `.agents/agents/<type>.md` | kit roles + project roles | front matter `name, description, tools (advisory), model (tier), include[]` | RUN-19, GSP-03 |
| `.claude/settings.json` | project; kit entries reconciled | hook registrations, `enabledPlugins` (via `claude plugin install`) | INS-20, INS-27 |
| `paseo/providers.json` (kit) | kit, regenerated by export | `{_notes, providers{name{extends,label,description,env,models[],disallowedTools?}}, metadataGeneration}` with placeholders | INS-45 |
| `~/.paseo/config.json` | Paseo | `agents.providers` (additive kit changes only) | INS-41, INS-51 |

Machine keys (defaults, not overridable by a project): `agent_providers` `{circle: circle-agent}`, `agent_provider_disallowed_tools` (Agent, AskUserQuestion, CronCreate, CronDelete, CronList, DesignSync, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, ListAgents, Monitor, PushNotification, ReportFindings, ScheduleWakeup, SendMessage, WebSearch, Workflow), `agent_provider_env` `{ENABLE_TOOL_SEARCH: "true"}`, `main_provider_disallowed_tools` `[Agent, Workflow]` (RUN-03..05, D-06).

Environment: `PASEO_AGENT_ID`, `PASEO_HARNESS_ROOT`, `PASEO_HARNESS_LEADER`, `PASEO_HARNESS_ROLE=worker`, `PASEO_HOME`, `PASEO_HOST`, `PASEO_CLI_DIR`, `PASEO_CLI`, `PASEO_KIT`, `PASEO_KIT_<NAME>`, `CLAUDE_CLI`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_DIRS`, `CLAUDE_PROJECT_DIR` (RUN Interfaces, INS Interfaces, HOK Interfaces, D-17).

### Journals and records
| path | content | owner | source |
| --- | --- | --- | --- |
| `_workspace/_runs/<runId>/` | `script.js, args.json, run.json, journal.jsonl, log.txt, result.json` | M6 | WFL-15, WFL-16 |
| `<ws>/tasks.json` + `.lock` | `{tasks:[{id,title,assignee,depends_on,status,notes,updated}]}` | `ph task` | RUN-53 |
| `<ws>/freeze_<phase>.sha256` | shasum-compatible lines | `ph freeze` | RUN-54 |
| `_workspace/review-metrics.jsonl` | per review run: confirmed/refuted/resolved/unverified, deferred fate | review step | HIS-51, D-58 |
| `<repo>/.claude/worktrees/<name>` on `harness/<name>` | agent worktrees | `ph` | RUN-55, D-26 |
| `<tmp>/ph-compact-<id8>.log` + lock | compact-self watcher | `ph` | RUN-48, HIS-12 |
| `<tmp>/ph-context-guard-*`, `<tmp>/ph-io-guard-*` | hook state and claims | M8 | HOK-06, HOK-20 |
| `<tmp>/paseo-harness-files-<uid>/<session>/` | mod private state (0700) | M7 | FIL-12 |
| `.gitignore` kit block | `/_workspace/`, `/.claude/worktrees/` | M1 | INS-36 |

## Simplifications

| # | the new kit does less | IDs | why it is safe |
| --- | --- | --- | --- |
| S-01 | No non-Claude harness paths: modes, provider features, MCP attach, `isClaudeProvider`, MCP file servers, `machine.local.json` | RUN-17, RUN-18, RUN-62, INS-46, FIL-44, FIL-45 | owner: Claude Code only |
| S-02 | One skill tree `.claude/skills`; no junctions, link record, `skills-sync`, facades, per-skill gitignore lines | INS-26, INS-30..35, RUN-52, RUN-57, WFL-48, D-10 | the second tree existed only for Codex/OpenCode readers |
| S-03 | No legacy migrations (relocation, legacy config, 0.0.2 deny fingerprint, `model_pattern`, `.claude/` dual lookups); no migration code in v1 | INS-18, INS-19, INS-52, RUN-02, HOK-37, D-01 | from-scratch layout; a 0.1.0 project upgrades by a fresh install, its own move is its own task (D-110) |
| S-04 | Three file tools instead of 17; no directory-walk permission planning; no media tool | FIL-02, FIL-10, FIL-40..43 | native Read/Glob/Grep/Bash cover the rest |
| S-05 | Read limits sized to one page | FIL-26, D-41 | the 200k/450k limits were for MCP inline output and produced 6-13 continuation calls |
| S-06 | Context guard: one atomic state update per band instead of PID/mtime claim recovery | HOK-07, HOK-36 | a lost reminder costs nothing; removes three defects |
| S-07 | Backlog removed from install, machine, plugins and GSD | INS-16, INS-17, INS-48, UI-60..79, GSP-77 | owner decision |
| S-08 | Harness method reduced to the adapter generator and harness-evolve; about 3000 lines of team-building prose and examples not carried | MTH-02..09, MTH-16..20, MTH-30..41, MTH-56, MTH-61, D-109 | owner D-109: generic team building is not a kit goal |
| S-09 | code-wave not carried; execution uses GSD agents and the adapter | GSP-66..68, D-63, D-109 | owner D-109, D-110; project-specific knowledge belongs to each project's adapter, not the kit |
| S-10 | GSD tool split into core verbs + adapter hooks; revisions store hash + list once | GSP-29, D-61 | project specifics are adapter data; revisions.json was 1630 lines per phase in the field |
| S-11 | Research attempt: one record + digest + marker | GSP-61, D-67 | the guarantees are kept; UUID/signature/sequence keys added nothing the record lacks |
| S-12 | STATE.md: small CLI, frontmatter derived, one current block; no upstream per-field preservation tables | UPS-69, GSP-72, D-72 | single writer makes concurrent-write machinery moot |
| S-13 | Upstream subset: no capability registry, installer, 16-runtime maps, workstreams, intel/graphify, cross-AI CLIs | UPS-36, UPS-38, UPS-63, UPS-65, UPS-80, UPS-85, UPS-86 | Claude-only, Paseo runtime |
| S-14 | Supervised debug engine deferred; forensics + plain debugger ship | GDB-13..44, D-78 | owner stopped the engine flow; its lessons stay invariants |
| S-15 | Priming and warm-up off by default | WFL-23, WFL-24, D-24 | savings unmeasured on the current proxy |
| S-16 | Provider sync without native-file-deny branches and shim | INS-49, INS-52, INS-54 | new kit never denied native file tools |
| S-17 | Prompt notes: kit base + appended project note | RUN-23 | projects stop copying kit text |
| S-18 | `allowed_models` matched on a normalized key | RUN-14 | one entry instead of `circle/` and `circle-agent/` duplicates |
| S-19 | Swarm map trimmed: no temp-dir runs, queue/review parsers, run cards | UI-29..32, UI-51 | `paseo_tool.py` does not exist in the kit |
| S-20 | skills-sync child-process hop and two `PH_CMD` definitions gone | INS-26, RUN-40 | one runtime location |

## Risks and unknowns

- R-01 The daemon client imports Paseo CLI internals ("tested with 0.10.0"; the omp branch ran 0.11.2); any Paseo release can break them; one adapter module and a doctor gate contain the risk (RUN-25, D-17).
- R-02 The mod relies on the Claude Code engine API and >= 2.1.296; the `claude-code` types module is not in the repo; whether a mod can hold session state in memory is unverified (FIL-04, D-39).
- R-03 Paseo may now honour a requested agent cwd; the prompt-instruction workaround must be re-verified (RUN-39).
- R-04 Hooks parse Claude Code transcripts (message ids, `isSidechain`, usage fields); only synthetic fixtures tested; schema must be checked on the current version (HOK-04, HOK-14).
- R-05 The workflow extensions the kit adopts (`session`, `shell()`, price-based cost, transient retries, model readback) are known from history rows and a grep of a project's locally extended runtime, not from a full map; the spec writer reads that source as evidence only (INGEST-CONFLICTS I-01).
- R-06 Projects on kit 0.1.0 have locally modified kit files and project text inside the kit block; without migration code in v1 their upgrade surfaces many conflicts (INS-15, D-01).
- R-07 The owner's current Claude sessions use `fsbatch`/`filesystem` MCP servers registered against the old kit folder; moving or deleting that folder breaks them (memory omp-migration-policy, D-03).
- R-08 Execution policy is not settled by evidence: in the field, per-wave Verify loops did not converge and a later phase ran in batch mode; the default mode may need to change after real use (GSP-81, GSP-86, D-63).
- R-09 The adapter generator is new (no old code): its quality decides whether a fresh project gets usable commands, lenses and a stack skill; trigger and fixture tests are the only guard (D-109, D-57).
- R-10 Model availability follows quota and changes often; nothing may hardcode a model (HIS-74, D-16).
- R-11 Upstream GSD `next` moves; the pin and `check` keep bumps reviewable (D-62).
- R-12 Permission modes of `circle` main sessions are unknown; fail-closed mod writes could be refused systematically (FIL Q2, D-40).
- R-13 Image-heavy GPT turns have no guard after D-42.
- R-14 Paseo plugin host versions and icon names must be re-checked against the installed Paseo; plugins need a pinned toolchain (UI-01, UI-52, D-102).
- R-15 macOS/Linux paths unverified (INS-58, HIS-64).
- R-16 The mod keeps the ticket protocol (D-39): the slimmer protocol must still guarantee at-most-once execution and receipt recovery (FIL-14, FIL-15).
- R-17 Claude fast mode is unavailable through Circle (HIS-73, D-106).

## D-110 vanilla sweep

Owner principle D-110 (2026-10-20): the kit is vanilla; nothing specific to WildEraV6, Unreal or games is kit content; project sources are evidence of lessons only. Changes made in the four intel files:

| # | item | before | after |
| --- | --- | --- | --- |
| 1 | SYNTHESIS opening paragraph | escalated decisions marked `[pending D-NN]` | owner answers recorded; D-110 stated; all `[pending]` markers removed (M2, M3, M7, M9, M10, M12, invariants, data formats, simplifications, risks) |
| 2 | G3 | rules "of the WildEra GSD port" | rules of the earlier GSD port, generalized |
| 3 | P9 | "no WildEra, Unreal or engine names in the core" | vanilla principle: no project, engine or domain specifics; generalize with a named adapter input or drop |
| 4 | M1 module row | "upgrade from 0.1.0", CLI `adopt` | install/update/status/pull only |
| 5 | layout `kit.mjs` | `adopt` subcommand | removed |
| 6 | M1 CLI bullet | `kit adopt <project>` | removed |
| 7 | M1 `adopt` bullet | one-time adopt tested against a WildEra copy | upgrade note: no migration code in v1; generic `kit adopt` LATER only if needed; moving a project is its own task |
| 8 | layout `agents/` | "no wiring-architect (adapter)" | no stack-specific or interface-architect agent; a project adapter adds one if needed |
| 9 | M12 module row | absorbed GDB-13/17/18/57 and D-79 (engine experiment kinds) | removed; D-110 added |
| 10 | M9 dropped line | "WildEra-specific scans/regexes/paths moved to the adapter" | project-specific scans/regexes/paths; the adapter supplies source roots, shared-file rules, resolvers |
| 11 | M10 dropped line | "Unreal Verify mechanics; Unreal parts to the WildEra adapter" | project-specific Verify mechanics; only the generic rules survive in the execute step |
| 12 | M10 debug bullet | engine LATER pending D-78 | old port's supervised engine LATER and not part of the kit (D-78) |
| 13 | M11 adapter generator | stack skill "the ue-code equivalent" | stack skill (generic) |
| 14 | M12 project files | experiment kinds for debug | optional machine-wide mutex name for heavy tools (generic, HIS-62) |
| 15 | M12 acceptance | WildEra adapter: Unreal commands, `test:/scenario:` vocabulary, `Module:/Content:` owns, Build.cs/.ini rules, cpp_check/layer_lint, ue-* and wiring-architect agents, engine mutex, FPS envelope | linted adapters for fixture codebases of two different stacks; the kit ships no project's adapter |
| 16 | data formats `debug/` row | engine `state.json` and `registry.json` | session file, resolved copies, knowledge base only |
| 17 | INV-42 incident | raised targets, widened spheres (fg2-w02) | debuggers changed fixtures and tolerances until a probe passed (field evidence) |
| 18 | INV-53 | "a test filter or scenario" | "a test filter or verify command" |
| 19 | S-03 | one `adopt` command; "only WildEra and test projects run 0.1.0" | no migration code in v1; a 0.1.0 project upgrades by a fresh install |
| 20 | S-09 reason | "Unreal knowledge moves to the WildEra adapter" | project knowledge belongs to each project's adapter |
| 21 | S-10 reason | "WildEra specifics are data" | project specifics are adapter data |
| 22 | R-05 | "WildEra's runtime extensions" | extensions found in a project's locally extended runtime, read as evidence only |
| 23 | R-06 | upgrading WildEra through `adopt` (11 skills, code-wave) | generic risk for any 0.1.0 project without migration code |
| 24 | R-08 | Phase 01 / Phase 1.1 | field evidence, no project phases named |
| 25 | DECISIONS D-01 | one-time `adopt` tested on a WildEra copy | no migration code in v1; generic adopt LATER; moving a project is its own task |
| 26 | DECISIONS D-05 | WildEra's sections move out during adopt | removed |
| 27 | DECISIONS D-22 | "WildEra's `session`/`shell()` extensions" | extensions found in a field-modified runtime, generalized |
| 28 | DECISIONS D-48 | "(WildEra does)" | removed |
| 29 | DECISIONS D-63 | `batch` = "the owner's Phase 1.1 rule" | `batch` with field evidence, no project named |
| 30 | DECISIONS D-69 | WildEra spec path note | removed |
| 31 | DECISIONS D-70 | "WildEra Phase 1.1: 15-20 plans, 4 waves, D-16" | generic split reasons (overlapping owns, ordering coupling, gating spike, context size) + field evidence |
| 32 | DECISIONS D-71 | "Phase 01 Check stop" | a checker stop on integrator-created targets |
| 33 | DECISIONS D-74 | "as the WildEra code does" | as the earlier port's code does |
| 34 | DECISIONS D-79 | experiment-kind table (Unreal build/test/scenario kinds) in the adapter | closed by D-78 |
| 35 | DECISIONS D-80, D-81, D-82, D-85, D-86, D-88 | engine hunks, engine mutex, `%LOCALAPPDATA%/WildEra` snapshot store, tree digest, admission lease | closed or narrowed by D-78 |
| 36 | DECISIONS D-109 wording | WildEra/Unreal skill and agent names, "Unreal knowledge becomes WildEra's adapter" | project-specific skills and agents in generic terms; project knowledge belongs to that project's adapter |
| 37 | PHASES-DRAFT P14 | "Adopt WildEra" phase (adopt command, WildEra adapter, one WildEra phase as acceptance) | removed; a note that a 0.1.0 project upgrades by fresh install, generic adopt LATER |
| 38 | PHASES-DRAFT areas | requirement area MIGR | removed |
| 39 | PHASES-DRAFT P1 | "M1 without `adopt`", config shapes blocked by D-77 | D-01 no migration code; D-77 settled |
| 40 | INGEST-CONFLICTS I-13 | "`adopt` must never touch the project's backlog" | no kit command may touch a project `backlog/` folder |
