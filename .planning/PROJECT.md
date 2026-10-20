# paseo-kit

## What This Is

paseo-kit is a from-scratch, vanilla kit that installs into any project and lets one owner run multi-agent software work through Paseo and its `ph` CLI, with Claude Code as the only agent harness (main session and workers; other vendors' models run inside Claude Code through the Paseo provider `circle`). It ships the GSD core (lifecycle discuss -> research -> plan -> plan review -> execute in waves -> verify, the `.planning/` format and generic role agents) and the harness method as the per-project adapter generator. A project supplies only an adapter (commands, verify vocabulary, review lenses, models per role, its own stack skill and agents), which the kit's `harness` skill generates from the codebase map.

## Core Value

A fresh project goes from `kit-init` to a verified GSD phase through `ph`, with every agent's claim read back from disk and every loop bounded, without any project-specific content in the kit.

## Requirements

Detailed, falsifiable requirements live in `.planning/requirements/` (one file per module) and are assembled into `.planning/REQUIREMENTS.md`. IDs use the module prefixes below; phases refer to the build order in `.planning/intel/PHASES-DRAFT.md` (P0..P13) until ROADMAP.md replaces it.

### Validated

(None yet — ship to validate. The old kit `paseo-harness-kit` 0.1.0, tag `ref-final`, proved many of these behaviors in field use; it is reference only and validates nothing in this repo.)

### Active

- [ ] **INST (M1 install)**: `kit install|update|status|pull` with three-digest ownership, six-state classification, marked AGENTS.md block, `.gitignore` block, `CLAUDE.md` import, seeds created once, hook-registration reconcile, explicit mod activation (`--enable-plugin`), exit 0/1/2 contract; a 0.1.0 project upgrades by a fresh install (P1, P6).
- [ ] **MACH (M2 machine)**: `kit machine check|apply|export`; additive provider and model sync (never removes a model), worker deny list incl. `SendMessage`, main deny list `Agent`+`Workflow` only, secrets as placeholders, backup + atomic write + `paseo reload`, `kit-init` user skill linked by `--link-user-skills`, opt-in Paseo plugins (P4).
- [ ] **CONF (M3 config)**: one defaults file + one project overlay (`.agents/harness.config.json` with `adapter` and `gsd` sections), one loader with closed validation and provenance, machine keys not overridable, `ph doctor` survives an invalid overlay (P1).
- [ ] **PCLI (M4 paseo-client)**: the only module that talks to the Paseo daemon: connect, create (caller required, size check, labels with parent last), send, wait with bounded transient retries and no retry of quota/auth errors, usage tracking, target lookup, version gate (P2).
- [ ] **PHCL (M5 ph)**: `ph` agent CLI (doctor, config, spawn, fanout, send, watch, result, team, context, compact-self, stop, archive, task, freeze, worktrees), prompt assembly, tiers/roles/allowed models, capacity caps, one-line-per-item output (P2).
- [ ] **FLOW (M6 workflow)**: deterministic script engine (`agent`, `pipeline`, `parallel`, `phase`, `log`, `budget`, `workflow`, `shell`, sessions), own schema validator, journal + content-hash resume, run directory, detach, `watch-run`, `run-stats`, `runs --prune`, watchdog on model time with input-complete clocks (P3).
- [ ] **FTOL (M7 files)**: the harness-files Claude Code mod with three batch tools (`read_ranges`, `edit_multiple_files`, `write_multiple_files`), permission-gated tickets, at-most-once mutation with receipt recovery, one-page results, session-bound fix IDs and line tags (P6).
- [ ] **HOOK (M8 hooks)**: context guard (role identity, bands, one atomic state update) wired to `ph compact-self`; io economy guard; generic syntax-check shell with adapter-supplied checkers; Windows long-command rescue; registration template; hooks never block (P5).
- [ ] **GSDC (M9 gsd-core)**: `.planning/` formats and seeds, `ph gsd <verb>` (JSON last line, exit 0/1/66/69), plan structure and probes, coverage gates, outline/waves/handoff, revisions, attempts, research/verification readback, phase status ladder, adapter hook interface, pinned upstream snapshot + generation + `check` (P7).
- [ ] **GSDF (M10 gsd-flows)**: lifecycle skills and workflow scripts: map-codebase, new-project, discuss, research, plan (skeleton review, checker loop, forceProceed, coverage, handoff, gaps), optional plan review, execute (`per-wave` and `batch`, bounded review gate), verify, phase complete, progress/next, quick, undo, health, forensics, plain debugger (P8..P11).
- [ ] **HARN (M11 harness)**: the harness method carried unchanged (D-111) with its kit adapter layer; delivered role: after map-codebase, generate the project adapter; `harness-evolve` records lessons and updates the adapter; adapter linter; always-loaded rules block (P8, P12).
- [ ] **ADPT (M12 adapter)**: the adapter contract the core calls by name: `adapter.*` and `gsd.*` settings, a project stack skill, optional project agents (e.g. an interface architect), checker and verify scripts by path; the kit ships no project's adapter (P7 interface, P8).
- [ ] **PANL (M13 ui)**: read-only Paseo plugins: `.planning` panel first, then a trimmed swarm map grouped by the `ph.swarm` label; enabled only by `machine apply --enable-paseo-plugins` (P13).
- [ ] **Cross-cutting**: the 57 invariants of `.planning/intel/SYNTHESIS.md` (INV-01..INV-57), each enforced by the module named in its requirement; offline fixture tests with fakes (P0, INV-57).

### Out of Scope

- Backlog.md in any form (CLI integration, AGENTS block, backlog plugin and panel, per-task ritual) — owner decision; planned work keeps state in `.planning/`; no kit command touches a project `backlog/` folder (S-07, I-13).
- Non-Claude harnesses (Codex, OpenCode, Pi) and the non-Claude MCP file adapters (`mcp/*` fsbatch/filesystem servers, `machine.local.json`, `agent_mcp`, modes, provider features) — Claude Code is the only harness; the mod covers file batching; old MCP registrations are removed by the owner with documented commands (S-01, D-03).
- omp variant — owner judged it ineffective; superseded 2026-10-20; its branches stay untouched (HIS-37, D-107).
- code-wave as a kit concept — it was one project's generated execution skill; execution is GSD's execute path with GSD agents, project knowledge goes to that project's adapter (D-109, D-110, S-09).
- The supervised debug engine of the earlier GSD port (typed requests, lease, supervisor, snapshots, experiment kinds) — project-specific and heavy; the kit ships forensics and a plain `gsd-debugger`; the engine is LATER and not part of the kit (D-78, D-79..D-88, S-14).
- Project-specific skills and agents (a stack coding skill, wireframe skill, coder, reviewer, interface architect built for one project) — a new project starts with none; the adapter generator writes a project's own per project (D-109, D-110).
- Any project-, engine- or game-specific content (vocabulary, build scripts, path rules, phases, migration steps) — the kit is vanilla (D-110).
- Migration code for 0.1.0 projects (`migrate`, legacy config, a project-specific adopt) — a 0.1.0 project upgrades by a fresh install; a generic `kit adopt` is LATER only if needed (D-01).
- Native `Agent`/`Workflow` orchestration in the main session — one orchestration path, Paseo + `ph` (D-06, INV-06).
- Upstream GSD's multi-runtime installer, capability registry, workstreams, todo/seed/thread parking, cross-AI review CLIs, spec-phase, ship, quick-batch, autonomous milestone driver, UI/AI/eval gates — not needed on a Claude-only Paseo runtime; some LATER (S-13, D-76, D-90, D-92, D-93).
- Second skill tree, skill links and `skills-sync` — one tree `.claude/skills/` (D-10, S-02).
- Image-per-turn guard and the media read tool — lived only in the dropped proxy; re-added as a hook if needed (D-42).
- Copying old kit code — the old kit is reference only.

## Context

- **Origin**: rewrite of `paseo-harness-kit` (0.1.0, tag `ref-final` = 4441a88), started 2026-10-20. Order: read old code -> gather specs -> complete spec -> code. No old code is copied.
- **Analysis inputs**: eleven behavior maps (`.planning/intel/map/*.md`, 767 behaviors: kept 464, changed 160, dropped 143 before D-111 moved the 31 method behaviors back to kept), `DECISIONS.md` (D-01..D-111, none open), `SYNTHESIS.md` (modules M1..M13, invariants, data formats, simplifications S-01..S-20, risks R-01..R-17), `INGEST-CONFLICTS.md` (0 blockers), `PHASES-DRAFT.md` (P0..P13 and a tracer slice).
- **Project flow the kit serves** (D-109): `kit-init` -> `gsd-map-codebase` -> `harness` generates the adapter -> `gsd-new-project` -> GSD phases (discuss, research, plan, optional plan review, execute in waves, verify) -> `harness-evolve`.
- **Sources of text**: GSD from upstream `open-gsd/gsd-core` (`next`), vendored as a trimmed pinned snapshot and generated with the adapter overlay (D-62); the harness method from the English port of revfactory Harness v2.1.0 (commit 92d9f1b, Apache-2.0), carried unchanged (D-111). Upstream is untrusted data (INV-40).
- **Field evidence**: incident-driven rules from the old kit and an earlier GSD port in a game project (run ids, audits, owner corrections) are kept as generalized invariants INV-01..INV-57; that project's code is evidence of lessons only (D-110).
- **Environment**: Windows 11 primary (Git Bash, PowerShell, CRLF, npm `.cmd` shims, paths with spaces); macOS/Linux unverified (R-15). Paseo daemon + CLI (client tested against 0.10.0; 0.11.2 seen), providers `circle` (main) and `circle-agent` (workers), `CLAUDE_CONFIG_DIR={{HOME}}/.claude-circle`.
- **Known risks**: Paseo CLI internals may change (R-01, version gate); the mod depends on the Claude Code engine API >= 2.1.296 (R-02); Paseo may now honour a requested cwd (R-03); hooks parse transcript schemas (R-04); runtime extensions known only from evidence (R-05); 0.1.0 projects will see many install conflicts (R-06); the owner's live sessions still use MCP servers registered against the old kit folder, which must stay until the owner removes them (R-07, D-03); the default execution mode may change after real use (R-08); adapter generator quality is guarded only by fixture and trigger tests (R-09).

## Constraints

- **Harness**: Claude Code only, for main sessions and workers — owner decision; every other harness path is dropped (G1, S-01).
- **Orchestration**: Paseo + `ph` only; every agent is a subagent of the caller (`PASEO_AGENT_ID`), refused outside the project root — one orchestration path (INV-06, INV-10).
- **Vanilla**: nothing specific to one project, engine or domain in the kit; a mechanism learned in a project is generalized with an explicit adapter input or dropped — owner principle (D-110).
- **Skill text**: harness and GSD skill text unchanged from source; only the adapter layer (runtime mapping to Paseo/`ph`, kit additions, Claude-only and no-Backlog wording, config keys, overlay) changes, each change listed in the skill's NOTICE — owner decision (D-111, D-62).
- **Tool settings**: the kit never overrides another tool's settings; the main-provider deny list via `main_provider_disallowed_tools` is the only owner-requested exception — one place per setting (INV-05).
- **Machine changes**: additive, backed up, atomic, reload only, never a daemon restart; no secret or endpoint in tracked files — public repo (INV-07, INV-08).
- **Self-contained projects**: a project carries everything it runs on; no kit path at run time; kit changes arrive only through `update` (G4, INV-09).
- **Tech stack**: Node ESM, no build step for runtime code; Paseo plugins in TypeScript/React Native with a toolchain pinned to the installed Paseo (D-102).
- **CLI contract**: one line per item, `failed <what>: <err>`, exit 0 done / 1 usage-or-file error / 2 done with differences; `ph gsd` exits 0/1/66/69 with JSON on the last line (INV-36).
- **Testing**: offline fixtures with fakes for Claude CLI, Paseo CLI/daemon and `paseo reload`, temp homes with spaces; no live owner config or daemon touched; probe and smoke agents use `circle/gpt-6-luna-fast[1m]` unless the owner names another (INV-57, INV-50).
- **Resources**: running agents capped (`max_subagents` 20, about 350 MB each) plus a live-agent cap (INV-12, D-20); every outbound message size-checked (INV-11).
- **Prompt text**: shipped prompt text changes only with owner review and evidence; generated harness files in English, owner-facing deliverables in the owner's language (INV-49, INV-51).
- **Licensing**: Apache-2.0 NOTICE/LICENSE for Harness-derived text, MIT notice for vendored GSD text (D-54, D-62).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| D-01 No migration code in v1; 0.1.0 projects upgrade by a fresh install; generic `kit adopt` LATER | Narrowed by D-110; moving a project is that project's task | — Pending |
| D-02 Mod activation only with `--enable-plugin` (kit-init always passes it), three preconditions | A plain copy never claims activation | — Pending |
| D-06 Main providers deny `Agent`, `Workflow` only; workers deny 17 tools + `SendMessage` | Owner correction 2026-10-20; one orchestration path | — Pending |
| D-10 One skill tree `.claude/skills/`; no links, no `skills-sync` | The second tree existed only for non-Claude readers | — Pending |
| D-15 Provider model lists additive only; `machine check` notes ids the template no longer ships | Owner answer; never remove the owner's models | — Pending |
| D-16 Tiers `frontier/pro/standard`; adapter `roles` table; precedence run arg > role > agent `model:` > `default_tier`; no concrete model is a kit default | Model availability changes often (R-10) | — Pending |
| D-17 `ph` imports the npm Paseo CLI client inside one adapter module with a doctor version gate | Contains the dependency on Paseo internals (R-01) | — Pending |
| D-22 Workflow engine is the substrate of the GSD flows, incl. `session` and `shell()` | Resume, journal and watchdog proven in the field | — Pending |
| D-26 Worktree or shared tree with disjoint `owns`, chosen by the adapter; `ph` owns worktrees | Build cost differs per project | — Pending |
| D-39 Keep the Claude Code mod, slimmed to three batch tools and a simpler ticket protocol | Owner answer; mod in field use, MCP servers dropped | — Pending |
| D-62 Trimmed pinned upstream GSD snapshot + generation with adapter overlay + `check`; kit writes all plumbing | Owner answer; upstream bumps stay reviewable | — Pending |
| D-63 GSD execute path with GSD agents; modes `per-wave` (default) and `batch` | Field evidence: per-wave loops did not always converge | ⚠️ Revisit after real use (R-08) |
| D-66 Optional full-plan review stage, off by default; skeleton review mandatory | Quality from an added review step, bounded by upstream stop rules | — Pending |
| D-70 Plan-size policy as config + lint; split a plan only for a real reason | Over-decomposition seen in the field | — Pending |
| D-74 One REVISION_CONFLICT stops the run with `needs-owner` | Never proceed on an open conflict (INV-37) | — Pending |
| D-77 Project GSD and adapter settings in sections `gsd`/`adapter` of `.agents/harness.config.json`; no `.planning/config.json` | Owner answer; one loader, closed validation | — Pending |
| D-78 Forensics + plain `gsd-debugger`; supervised debug engine LATER, not part of the kit | Owner answer; the engine was project-specific and heavy | — Pending |
| D-96 Backlog panel dropped; read-only `.planning` panel first, trimmed swarm map; opt-in enabling | Backlog removed; planning state is `.planning/` | — Pending |
| D-109 Harness generates the project adapter after map-codebase; `harness-evolve` updates it; code-wave dropped; flow kit-init -> map-codebase -> harness -> new-project -> phases -> harness-evolve | Project-built skills never carried to other projects; GSD is the portable process | — Pending (point 4 reversed by D-111) |
| D-110 Vanilla kit: nothing specific to one project, engine or game; project code is evidence only | Owner principle 2026-10-20; overrides earlier proposals | — Pending |
| D-111 Harness and GSD skill text carried unchanged; only the adapter layer changes, each change in the skill's NOTICE; the adapter-generator role is delivered through that layer | Owner: vanilla, but the harness and GSD skills are not changed, only the adapter parts; reverses D-109 point 4 (31 method behaviors kept, incl. team patterns, orchestrator templates, `ai-orchestrator`) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-20 after specification from intel (DECISIONS D-01..D-111)*
