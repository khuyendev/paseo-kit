# Map: GSD upstream capability catalogue (UPS)

Roots: `upstream:` = C:/Users/fish/ext-src/gsd-core (open-gsd/gsd-core, branch next, 274f8ca; untrusted data, read only). `wildera:` = C:/Users/fish/Desktop/WildEraV6 @ 89143da. `kit:` = old paseo-harness-kit @ ref-final.
Proposal vocabulary: capabilities use ADOPT (kit core now) / LATER / DROP; re-implemented mechanics use KEEP / CHANGE / DROP; OPEN where the owner decides.

## Coverage

| file | lines | read fully |
|---|---|---|
| upstream:README.md | 129 | yes |
| upstream:CONTEXT.md | 1103 (527 KB, repo-engineering glossary of upstream modules + CI/process rules) | partial: lines 1-70, 130-150, 176-184, 330-352 (domain modules for phase status, gates, STATE, config, model resolver). The rest is upstream repo process (test rules, release notes, PR discipline, k320 rules) with no kit relevance |
| upstream:docs/README.md | 138 | yes |
| upstream:docs/explanation/the-phase-loop.md | 130 | yes |
| upstream:docs/explanation/context-engineering.md | 134 | yes |
| upstream:docs/explanation/multi-agent-orchestration.md | 235 | yes |
| upstream:docs/explanation/claude-orchestration-capability.md | 115 | yes |
| upstream:docs/explanation/embeddable-orchestration-system.md | 184 | yes |
| upstream:docs/explanation/interface-versioning-policy.md | 60 | yes |
| upstream:docs/explanation/live-dom-uat-capability.md | 106 | yes |
| upstream:docs/explanation/security-model.md | 470 lines | partial (r1): lines 50-80 and 102-110 read (package legitimacy gate, thresholds, degradation); the rest (prompt-injection hooks, trust boundaries) not read |
| upstream:docs/explanation/capability-trust-model.md, capability-overlay-model.md | 29 KB, 16.7 KB | NOT read (context limit); README one-liners only (docs/README.md:123-124). Capability system is DROP so low risk |
| upstream:gsd-core/workflows/execute-phase/steps/post-merge-gate.md | 165 | partial (r1): lines 60-165 (build/test gate); other steps/*.md still not read |
| upstream:agents/gsd-executor.md | 900 | partial (r1): lines 181-273 (deviation rules); frontmatter read earlier; rest not read |
| upstream:gsd-core/workflows/undo.md | 633 | partial (r1): lines 1-47 (modes) |
| upstream:docs/workflow-discuss-mode.md | 76 | yes |
| upstream:docs/ARCHITECTURE.md | 1148 | yes |
| upstream:docs/CLI-TOOLS.md | 1609 | yes |
| upstream:docs/CONFIGURATION.md | 2425 | partial: 1-270, 486-720, 1227-1400, 1543-1800, 2006-2340 (schema, workflow toggles, git, gates, security, model profiles, policy, env, exit contract). Not read: integration/search keys, reviewer lanes, hooks, agent-skills, capability trust, MemPalace, graphify |
| upstream:docs/FEATURES.md, COMMANDS.md, AGENTS.md, USER-GUIDE.md, INVENTORY.md | 4707, 2499, 906, 1163, 838 | NOT read (superseded by docs/features/*, workflows and agents read directly). Agent roster taken from agents/*.md frontmatter |
| upstream:docs/features/*.md (about 205 files) | 4-60 lines each | titles of all (directory listing); in full: phase-discussion, phase-planning, phase-execution, quick-mode, autonomous-mode, codebase-mapping, project-initialization, work-verification, code-review-pipeline, ship, milestone-management, multi-repo-workspace-support, workstream-namespacing, settings-management, model-profiles, per-phase-type-model-selection, plan-checking, auto-advance-next, single-phase-autonomous, statemd-consistency-gates, machine-readable-state-contract, plan-import, quick-batch, safe-undo, smart-entry-launcher, hard-stop-safety-gates, session-management. Not read: the other titles |
| upstream:docs/adr/*, how-to/*, reference/*, tutorials/*, design, research, security, skills, i18n dirs | many | NOT read; index only (docs/README.md) |
| upstream:gsd-core/workflows/*.md (about 100 files) | 26-1570 | catalogue: first `<purpose>` line of every file (grep). In full: new-project (1248), map-codebase (506), ingest-docs (384), spec-phase (563), discuss-phase (525), plan-phase (1571), execute-phase (1416), verify-work (943), quick (794), code-review (971), plan-review-convergence (624), autonomous (856), next (369), progress (715), ship (621) |
| upstream:gsd-core/workflows/*/steps, detail, modes, templates subdirs | many | NOT read (names only via UPSTREAM.json list); spines state when each is read |
| upstream:agents/*.md (33 agents + 27 .compact.md) | 2-49 KB | frontmatter (name/description/tools) of all; bodies not read; one compact variant head read |
| upstream:commands/gsd/*.md (72) | n/a | structure only: file list plus head of progress.md |
| upstream:gsd-core/bin/gsd-tools.cjs (5704), bin/lib, bin/shared, src/*.cts (249) | n/a | header comment (verb list, lines 1-247) and directory listings; shared/model-catalog.json head. Not read line by line |
| upstream:gsd-core/templates: project, requirements, roadmap, state, phase-prompt (PLAN), config.json | 204, 232, 203, 206, 616, 55 | yes |
| upstream:gsd-core/templates (others), references/*, contexts/* | n/a | file lists only; compact-content-gate.md read 1-80 |
| wildera:.agents/skills/gsd-plan/upstream/UPSTREAM.json | 263 | yes |
| wildera:.agents/skills/gsd-plan/SKILL.md, NOTICE.md, references/compatibility.md | 85, 13, 107 | yes |

## Summary

GSD Core is a context-engineering framework: a thin orchestrator (markdown workflow) loads state from `.planning/` through `gsd-tools` (init/state/roadmap/phase/verify/config/resolve-model), spawns fresh-context role agents (researcher, planner, checker, executor, verifier, mapper, reviewer, debugger), and writes the results back as Markdown/JSON artifacts. The loop is discuss, (UI), plan, execute in waves, verify, ship, per milestone. [upstream:docs/explanation/the-phase-loop.md:9-59]

What the kit needs from it: (1) the lifecycle and artifact formats (PROJECT, REQUIREMENTS, ROADMAP, STATE, CONTEXT, RESEARCH, PLAN, SUMMARY, VERIFICATION, UAT); (2) the generic role agents with their verification vocabulary (passed/gaps_found/human_needed, goal-backward must_haves); (3) a small deterministic state/gate tool layer (phase locate, wave index, verification status, coverage gates, STATE writes) that agents must not re-derive by hand.

How upstream is built: about 100 workflows (the largest are 1200-1570 lines), 33 agents, 72 slash commands, a 5700-line CJS CLI over 249 TypeScript modules, plus a capability/registry/EoS layer, 16-runtime installer, hooks, graphify/intel/mempalace. Most of that is runtime plumbing and optional capabilities that the owner decisions drop (non-Claude runtimes, installer, capability registry, host-integration interface, Backlog-like todo/seed/thread parking).

Worth keeping in spirit: absent-equals-enabled config; "could not look" is never "pass" (exit 69, scope tri-state, null percentages); orchestrator is the single writer of shared state; verification status is a closed enum with one routing table; coverage gates (requirements, decisions) that block planning; plan-checker revision loop capped at 3 with stall detection; completion reconciliation by artifacts (SUMMARY plus commits) instead of trusting agent return; worktree/base guards; every hard-won incident rule (see Invariants).

The WildEra port already took: planner, plan-checker, verifier, executor, phase-researcher, debugger, debug-session-manager agents; plan-phase, execute-phase, execute-plan, discuss-phase, review, quick-batch, debug, forensics, plan-review-convergence workflows and their step files; templates and most references; three explanation docs. It did NOT take new-project, map-codebase, spec-phase, verify-work, ship, progress/next, autonomous, code-review, quick, milestone workflows. [wildera:.agents/skills/gsd-plan/upstream/UPSTREAM.json:7-263; wildera:.agents/skills/gsd-plan/NOTICE.md]

## Behaviors

### UPS-01 Phase loop (discuss, plan, execute, verify, ship) per phase within a milestone
- Behavior: work is a repeating cycle Discuss -> (UI design) -> Plan -> Execute -> Verify -> Ship; each step guards one failure class (wrong assumptions, broken design, missed brief). Discuss output = CONTEXT.md; Plan = RESEARCH.md + PLAN.md files checked by a plan-checker; Execute = executors in waves committing per task + SUMMARY.md; Verify = VERIFICATION.md (requirement coverage, decision coverage, goal alignment); Ship = PR and STATE update. Lighter primitives (`quick`, `fast`) exist for work below the loop threshold.
- Proposal: ADOPT - matches the owner's lifecycle (discuss, research, plan, plan review, execute in waves, verify). Add the owner's explicit "plan review" step (UPS-34).
- Source: upstream:docs/explanation/the-phase-loop.md:9-59, 108-116; upstream:README.md:30-36
- Why it exists: each step prevents a failure that is expensive to find later. [the-phase-loop.md:108-114]
- Test idea: a fixture phase cannot enter Execute without PLAN files and cannot be marked complete without a passing VERIFICATION status.

### UPS-02 Thin orchestrator + fresh-context role agents
- Behavior: orchestrator (workflow file) never writes domain code: it loads one init payload, resolves model per agent, spawns a role agent with a scoped prompt (paths, not contents), collects the result, updates shared state. Agent definitions declare minimal tools. Large `init` output over ~50 KB is spilled to a temp file returned as `@file:<path>`.
- Proposal: CHANGE - spawn through Paseo/`ph` workers (native Agent/Task/Workflow denied on the main provider); keep "paths not contents" and minimal-tool agents.
- Source: upstream:docs/explanation/multi-agent-orchestration.md:30-60, 78-84; upstream:docs/CLI-TOOLS.md:1145-1150; upstream:docs/ARCHITECTURE.md:544-564
- Why it exists: context rot; orchestrator context grows slowly. [context-engineering.md:26-41]
- Test idea: orchestrator spawn prompts contain file paths only; a unit test fails if a prompt embeds a whole PLAN body.

### UPS-03 Spec-driven artifacts as the shared substrate (`.planning/`)
- Behavior: every durable fact lives in Markdown/JSON under `.planning/` so agents in fresh contexts read prior artifacts, not conversation. Layout: PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json, MILESTONES.md, research/, codebase/, phases/XX-name/{XX-CONTEXT, XX-RESEARCH, XX-YY-PLAN, XX-YY-SUMMARY, XX-VERIFICATION, XX-VALIDATION, XX-UI-SPEC, XX-UAT}.md, quick/YYMMDD-xxx-slug/{PLAN,SUMMARY}.md, debug/, todos/, threads/, seeds/, continue-here.md.
- Proposal: ADOPT core files (PROJECT, REQUIREMENTS, ROADMAP, STATE, config.json, MILESTONES, research/, codebase/, phases/*, quick/, debug/, continue-here); DROP todos/, threads/, seeds/ (Backlog-like parking, owner dropped Backlog).
- Source: upstream:docs/ARCHITECTURE.md:778-827; upstream:docs/explanation/context-engineering.md:57-65
- Why it exists: restart/clear survival; inspectable plain text. [ARCHITECTURE.md:85-91]
- Test idea: kit init scaffolding creates exactly the adopted tree and nothing from the dropped list.

### UPS-04 Absent = enabled flag semantics
- Behavior: workflow toggles default to true when the key is missing; users disable explicitly. Exceptions are documented default-off keys (`auto_advance`, `plan_bounce`, `plan_review_convergence`, `tdd_mode`, `live_dom_uat`, `compact_content`, `context_drift` block mode, and, in the same table, `plan_chunked`, `mvp_mode`, `text_mode`, `research_before_questions`, `worktree_skip_hooks`, `cross_ai_execution`, `auto_prune_state`, `ui_interaction_capture`; the list is illustrative). Gate modules honour only nested `workflow.*` keys: a top-level `context_coverage_gate`, `auto_advance` or `_auto_chain_active` does not count (#4978), and gate config honours `GSD_WORKSTREAM`.
- Proposal: KEEP.
- Source: upstream:docs/ARCHITECTURE.md:93-95, 331-335; upstream:docs/CONFIGURATION.md:492-494, 1398 (same rule for `context_coverage_gate`, loader warns)
- Why it exists: new gates ship on by default without migration. [CONFIGURATION.md:1398]
- Test idea: empty config.json resolves every documented default; a top-level key shadowing a nested gate is ignored with a warning.

### UPS-05 Phase and milestone model, numbering, sentinels
- Behavior: milestone = releasable version cycle; phase = bounded unit with goal, requirements, plans. Integer phases are planned work, decimal phases (2.1) are urgent insertions marked INSERTED, ordered numerically; numbering continues across milestones. Directory `NN-slug` (optional project_code prefix). Sentinel phases `0-*` (pre-milestone) and `999.*` (backlog) are excluded from listings, clears and archives. Phase id grammar: digits, optional single uppercase letter, dotted segments (`12A`, `23.1.2`).
- Proposal: KEEP integer + decimal + two-digit dirs; DROP the `999.*` backlog sentinel (Backlog dropped) and bracket/milestone-prefixed ID conventions; keep the `0-*` guard only if the kit has pre-milestone dirs.
- Source: upstream:gsd-core/templates/roadmap.md:14-27, 93-103, 123-127; upstream:docs/CLI-TOOLS.md:204-222; upstream:gsd-core/workflows/code-review.md:67-73; upstream:docs/CONFIGURATION.md:243
- Why it exists: `phases clear` once destroyed `0-*` directories on an irreversible path. [CLI-TOOLS.md:217-222]
- Test idea: `phases clear` leaves `0-*` untouched; `12A` and `23.1.2` parse whole.

### UPS-06 Phase scope guidance (when to split)
- Behavior: a good phase has a one-sentence non-trivial goal, bounded research, a handful of non-overlapping plans, and a testable definition of done; "when in doubt, split"; below the threshold use quick.
- Proposal: KEEP as planner/roadmapper guidance text.
- Source: upstream:docs/explanation/the-phase-loop.md:75-92
- Why it exists: too-large phases stall waves; too-small ones drown in overhead. [the-phase-loop.md:79-81]
- Test idea: n/a (prompt guidance).

### UPS-07 new-project workflow (questioning, research, requirements, roadmap)
- Behavior: stages: setup + init payload; brownfield offer (codebase map); deep freeform questioning ("What do you want to build?" then follow threads, decision gate "Ready? Create PROJECT.md"); write PROJECT.md (Validated/Active/Out of Scope, Key Decisions, Evolution section, "Last updated" footer) and commit; workflow preferences into config.json via `config-new-project`; optional sub-repo detection; research decision (4 parallel project researchers: Stack, Features, Architecture, Pitfalls, then one synthesizer to SUMMARY.md); requirements by category with REQ-IDs `[CAT]-NN` (specific, user-centric, atomic, independent) scoped v1/v2/out; roadmapper spawn (every v1 requirement mapped to exactly one phase, 2-5 success criteria per phase, 100% coverage, files written before return); roadmap approval loop (Approve / Adjust / Review) before commit; STATE.md initialised; next step discuss-phase 1. Commits after each artifact so context loss is survivable.
- Proposal: ADOPT (trimmed): questioning, PROJECT/REQUIREMENTS/ROADMAP/STATE, optional 4-researcher+synth, approval gate. LATER: `--auto @doc`, spike/sketch findings detection, PR-body onboarding, sub-repo detection (OPEN if multi-repo needed). DROP: runtime/instruction-file derivation (`generate-claude-md`), TEXT_MODE for non-Claude runtimes.
- Source: upstream:gsd-core/workflows/new-project.md:28-47, 111-193, 195-300, 684-788, 790-940, 957-1122, 1124-1203
- Why it exists: "most leveraged moment in any project". [new-project.md:2]
- Test idea: with a stub roadmapper, an unmapped v1 REQ-ID blocks the commit; re-run on a project with PROJECT.md only resumes at REQUIREMENTS.

### UPS-08 new-project resume and init guards
- Behavior: `project_exists && init_incomplete` (PROJECT.md without all of REQUIREMENTS/ROADMAP/STATE) resumes at the first missing artifact, never errors and never routes to progress (loop bug #4040); `project_exists && !init_incomplete` errors "use progress"; `git init` is skipped when already inside a worktree (never nest `.git`, #3491), with a warning in a nested subdir. progress routes `init_incomplete` to new-project recovery, but a missing ROADMAP with MILESTONES.md present is "between milestones" (Route F).
- Proposal: KEEP.
- Source: upstream:gsd-core/workflows/new-project.md:101-109; upstream:gsd-core/workflows/progress.md:34-70
- Why it exists: #4040 routing loop; #3491 nested git. [new-project.md:101, 105]
- Test idea: partial `.planning/` (PROJECT.md only) routes to resume; running in a subfolder of a repo does not create a nested `.git`.

### UPS-09 Synthesizer SUMMARY.md write self-heal
- Behavior: after the synthesizer returns, verify `.planning/research/SUMMARY.md` exists, is non-empty and has no `<!-- gsd:write-continue -->` sentinel (`verify-summary` JSON `passed`; exit code is always 0). Claude Code refuses a subagent `Write` to the exact basenames SUMMARY.md/REPORT.md/FINDINGS.md/ANALYSIS.md (case-insensitive; prefixed names like `01-01-SUMMARY.md` are fine) and models sometimes fabricate a write restriction; if the return holds the full document (markers `# Project Research Summary`, `## Key Findings`, `## Implications for Roadmap`, `## Sources`) the orchestrator writes the file and commits all research artifacts; if only a brief confirmation, fail and do not spawn the roadmapper.
- Proposal: KEEP (relevant on Claude Code workers).
- Source: upstream:gsd-core/workflows/new-project.md:764-770
- Why it exists: issue #222 plus the observed Claude Code 2.1.301 refusal. [new-project.md:764]
- Test idea: a worker returning the full SUMMARY inline without writing yields a persisted file and a logged self-heal line.

### UPS-10 Workflow preferences, config bootstrap, global defaults
- Behavior: asks mode (yolo/interactive), granularity (coarse 3-5 phases / standard 5-8 / fine 8-12), parallelization, commit_docs, research / plan_check / verifier toggles, model profile (adaptive | standard tier quality/balanced/budget | inherit; a two-question split because of a 4-option UI cap), PR body sections; offers saved global defaults (`~/.gsd/defaults.json`: use as-is / modify / fresh). `config-new-project '<json>'` writes `.planning/config.json` with remaining defaults filled; `nyquist_validation` false when granularity is coarse. `commit_docs=false` adds `.planning/` to .gitignore.
- Proposal: CHANGE - kit gets a project adapter (build/verify commands, review lenses, models per role); keep mode/granularity/toggles; drop the UI-cap workaround and PR body sections (LATER); the global defaults file becomes the kit machine config.
- Source: upstream:gsd-core/workflows/new-project.md:302-643; upstream:docs/CONFIGURATION.md:2326-2336
- Why it exists: not stated beyond UX.
- Test idea: `config-new-project` with partial JSON yields full defaults; coarse granularity sets nyquist_validation false.

### UPS-11 map-codebase (brownfield mapping)
- Behavior: 4 parallel `gsd-codebase-mapper` agents (tech -> STACK, INTEGRATIONS; arch -> ARCHITECTURE, STRUCTURE; quality -> CONVENTIONS, TESTING; concerns -> CONCERNS) write 7 docs directly to `.planning/codebase/` and return only confirmation + line counts; an existing map offers Refresh / Update (pick docs) / Skip; `--paths p1,p2` scopes an incremental remap (reject `..`, leading `/`, shell metacharacters; all-invalid falls back to full); every doc gets today's date stamps; verify 7 docs, none under 20 lines; secrets regex scan before commit (sk-, ghp_, AKIA, private keys, JWT) with an explicit "safe to proceed" gate; commit `docs: map existing codebase`.
- Proposal: ADOPT (4 workers via ph; the map feeds discuss/plan/drift gate). DROP the inline sequential fallback and the `browser_subagent` warning.
- Source: upstream:gsd-core/workflows/map-codebase.md:6-9, 32-69, 89-129, 160-283, 319-369, 405-448
- Why it exists: fresh context per domain; agents write directly so the orchestrator stays small. [map-codebase.md:16-21]
- Test idea: `--paths "../x;rm"` is rejected; a doc containing `AKIA...` pauses the commit.

### UPS-12 map stamp step and codebase-drift gate
- Behavior: `stamp-codebase-map [--files a.md,b.md]` (a shell step, not the agent) writes `last_mapped_commit` and `last_mapped_at` into each doc's frontmatter, because the mapper restamps human date markers unconditionally and a date-only rewrite would look fresh. `verify codebase-drift` diffs `last_mapped_commit..HEAD`, counts new dirs outside mapped territory (a dir is mapped if its path appears in any of the 7 docs), barrel exports, migrations, route modules, plus modified/deleted files inside mapped dirs; `workflow.drift_threshold` (default 3), `drift_action` warn|auto-remap; absent baseline = `skipped` (`no-mapped-commit`), never drift; `.planning/` excluded; paths pass an ASCII allowlist, unsafe ones are withheld and counted; the gate is warn-only (an internal failure returns `skipped`). Runs at plan:pre (warn only) and execute:wave:post.
- Proposal: ADOPT stamp + warn-only gate; LATER auto-remap.
- Source: upstream:gsd-core/workflows/map-codebase.md:371-403; upstream:docs/ARCHITECTURE.md:829-867; upstream:docs/CLI-TOOLS.md:865-901; upstream:docs/CONFIGURATION.md:551-553
- Why it exists: a confident agent can skip a prompt instruction; a shell step cannot be skipped. [map-codebase.md:384-391]
- Test idea: a map with `last_mapped_commit` plus 3 new directories reports `action_required`; no baseline reports `skipped`, not drift.

### UPS-13 ingest-docs (ADR/PRD/SPEC import)
- Behavior: scans a path (cap 50 docs, `--manifest` YAML overrides heuristics, path containment checks), classifies each doc in parallel (`gsd-doc-classifier`), synthesizes with precedence and a three-bucket conflict report (`INGEST-CONFLICTS.md`: BLOCKERS/WARNINGS/INFO); BLOCKERS halt before any PROJECT/REQUIREMENTS/ROADMAP/STATE write; a routing gate asks before creating the scaffold (#3827); `--mode new|merge`.
- Proposal: LATER (useful for brownfield owners with ADRs).
- Source: upstream:gsd-core/workflows/ingest-docs.md:1-384
- Why it exists: approval to classify is not approval to write the scaffold (#3827). [ingest-docs.md:269]
- Test idea: a LOCKED-vs-LOCKED ADR contradiction produces no planning files.

### UPS-14 spec-phase (Socratic requirements, ambiguity score)
- Behavior: scores four dimensions 0-1 (goal 35% min .75, boundary 25% min .70, constraint 20% min .65, acceptance 20% min .70); ambiguity = 1 - weighted sum, gate <= 0.20 and all minimums; scouts the codebase first; max 6 rounds of 2-3 questions rotating perspectives (researcher, simplifier, boundary keeper, failure analyst, seed closer); writes `{phase}-SPEC.md` with falsifiable requirements, explicit in/out scope and pass/fail checkboxes; `--auto` never auto-dismisses edge or prohibition findings; an existing SPEC is reused under `--auto`. Edge-completeness probe (compiled `edge-probe.cjs`, fails closed exit 2) and prohibition probe (LLM-only two-stage recall/precision, canon items referred to secure-phase).
- Proposal: LATER (kit core = discuss); if adopted keep the ambiguity gate and CHANGE the compiled probes to a prompt-only edge list. NOTE: plan-phase has its own default-on specless edge/prohibition fallback that is core (UPS-88), independent of spec-phase.
- Source: upstream:gsd-core/workflows/spec-phase.md:8-52, 56-192, 194-385, 387-481, 483-562
- Why it exists: the planner must not silently guess WHAT; discuss owns HOW. [spec-phase.md:1-6]
- Test idea: a spec with boundary clarity .5 cannot be written without the explicit "write anyway - flag gaps" choice.

### UPS-15 discuss-phase (implementation decisions, CONTEXT.md)
- Behavior: identifies phase-specific gray areas (not generic categories), the user multi-selects areas, deep-dive each (default 4 single-question turns), scope-creep ideas go to a Deferred section; reads at most 3 prior CONTEXT.md files (or DECISIONS-INDEX.md) so decided questions are not re-asked; scouts 2-3 codebase maps; refuses to proceed past blocking anti-patterns in `.continue-here.md` until three questions (what, how it manifested, structural prevention) are answered; honours SPEC.md as locked requirements; empty-answer validation; commits CONTEXT.md + DISCUSSION-LOG.md; records the session in STATE.md; text/batch/analyze/all/auto/chain/power/advisor overlays.
- Proposal: ADOPT default interactive flow + canonical_refs + deferred ideas + checkpoint; LATER batch/analyze/all/auto/chain; DROP power (HTML UI) and advisor/USER-PROFILE adaptation.
- Source: upstream:gsd-core/workflows/discuss-phase.md:8-110, 164-298, 307-391, 387-499; upstream:docs/workflow-discuss-mode.md:7-68
- Why it exists: user = visionary, agent = builder; capture decisions the planner must not guess. [discuss-phase.md:52-60]
- Test idea: a prior CONTEXT decision suppresses the matching gray area; scope-creep input lands in Deferred, not `<decisions>`.

### UPS-16 CONTEXT.md format and decision IDs
- Behavior: sections `<domain>` (phase boundary), `<decisions>` (locked), `<canonical_refs>` (full relative paths, mandatory), `<code_context>`, `<specifics>`, `<deferred>`, optional `<spec_lock>`. Decisions carry stable IDs (D-NN) consumed by the decision-coverage gates; an `[informational]` tag or "Claude's Discretion" exempts a decision from tracking. Assumptions mode produces the same file from codebase-first analysis with confidence (Confident/Likely/Unclear).
- Proposal: ADOPT.
- Source: upstream:docs/workflow-discuss-mode.md:17-68; upstream:gsd-core/workflows/plan-phase.md:1386-1411
- Why it exists: downstream agents must read one format regardless of discussion mode. [workflow-discuss-mode.md:68]
- Test idea: a CONTEXT without `<canonical_refs>` fails the discuss commit check.

### UPS-17 Discuss checkpoint, resume and audit log
- Behavior: after each area, `{padded_phase}-DISCUSS-CHECKPOINT.json` (structured state: decisions, areas_completed); on start, an existing checkpoint offers Resume / Start fresh; the checkpoint is deleted after CONTEXT.md is committed; DISCUSSION-LOG.md (options, selections) is human-only, never read by downstream agents. WildEra tightened this: checkpoint before the first question and after each answer.
- Proposal: KEEP.
- Source: upstream:gsd-core/workflows/discuss-phase.md:224-228, 383-384, 456-478; wildera:.agents/skills/gsd-plan/references/compatibility.md:61
- Why it exists: interrupted discussions lost answers.
- Test idea: kill mid-discussion, restart offers resume with completed areas skipped.

### UPS-18 plan-phase: one init payload, flags, phase auto-detect
- Behavior: `init.plan-phase <phase>` returns paths (never contents): researcher/planner/checker models, `research_enabled`, `plan_checker_enabled`, `has_research/context/reviews/plans`, `plan_count`, `phase_status`, `phase_req_ids`, `granularity`, `prior_verify_commands` (array of {phase, plan, task, command}, always emitted at any context window), `threat_id_duplicates`. Flags: `--research`, `--skip-research`, `--gaps`, `--skip-verify`, `--reviews`, `--chunked`, `--research-phase N`, `--prd`, `--ingest`, `--bounce`, `--mvp`, `--tdd`, `--granularity coarse|standard|fine`, `--force`, `--text`, `--ws`, plus `--skip-ui`, `--skip-bounce` (always wins over bounce), `--no-tracer`, `--no-reversibility-gates`, `--ingest-format auto|nygard|madr|narrative`, `--view` (research-only, UPS-21). No phase number: `roadmap analyze` `next_phase` (first phase whose disk_status is no_directory/empty/discussed/researched) else ask. Branch invariant: plan-phase never creates, renames or switches git branches. Roles are always separate agents; `--auto/--chain` suppress prompts only, never authorise collapsing researcher/planner/checker into the orchestrator.
- Proposal: ADOPT with CHANGE: kit flags `--research/--skip-research/--gaps/--reviews/--skip-verify/--granularity`; DROP `--prd/--ingest/--bounce/--mvp/--tdd/--ws` for core (LATER).
- Source: upstream:gsd-core/workflows/plan-phase.md:30-56, 60-116, 122-219
- Why it exists: orchestrator context stays small; independent agent contexts make the checker gate meaningful. [plan-phase.md:49-55]
- Test idea: planning with no phase argument picks the first unplanned phase; spawn of researcher/planner/checker is separate per role.

### UPS-19 Closed-phase gate
- Behavior: `phase_status == Complete` hard-stops replanning: `--reviews` on a closed phase is never overridable (exit 1); otherwise replanning needs `--force` (else exit 1 pointing at the verification report), with a WARNING banner. Only Complete is gated; Executed / Needs Review are legitimate replans.
- Proposal: KEEP.
- Source: upstream:gsd-core/workflows/plan-phase.md:118-120
- Why it exists: issue #3569 (replanning shipped work). [plan-phase.md:118]
- Test idea: replan of a Complete phase exits 1 without `--force`.

### UPS-20 Phase research (gsd-phase-researcher)
- Behavior: skipped for `--gaps/--skip-research/--reviews`; reuse existing RESEARCH.md unless `--research`; otherwise ask (research first recommended for new features/integrations, skip for bug fixes); `--auto` with research disabled skips silently; spawn researcher with CONTEXT.md + requirements; return markers `## RESEARCH COMPLETE` / `## RESEARCH BLOCKED` (offer provide context / skip / abort). Warn when agent-teams is enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`): completion may not route to the orchestrator. Researcher writes a Package Legitimacy Audit (registry verdicts OK/SUS/SLOP, `[SLOP]` stripped, `[ASSUMED]/[SUS]` -> `checkpoint:human-verify` before install tasks, `T-{phase}-SC` threat row); research gate blocks plan when RESEARCH.md has unresolved open questions.
- Proposal: ADOPT research step and RESEARCH.md; LATER package-legitimacy registry gate (deliberately deferred; thresholds recorded in UPS-93 so the gate can be rebuilt; the executor install-failure stop is NOT deferred, UPS-89); DROP provider waterfall/cache (Context7/Exa/Tavily). Teams warning: KEEP as a check in `ph doctor` if the kit ever runs with agent-teams on.
- Source: upstream:gsd-core/workflows/plan-phase.md:350-445; upstream:docs/ARCHITECTURE.md:394-423, 689-699, 981-999
- Why it exists: slopsquatting supply-chain risk (~20% of AI package references hallucinated). [ARCHITECTURE.md:985]
- Test idea: a RESEARCH.md with an unresolved open question blocks planning; an `[ASSUMED]` package yields a human-verify checkpoint task.

### UPS-21 Research-only mode (`--research-phase N`)
- Behavior: sets RESEARCH_ONLY: planner, checker, gaps and bounce blocks all skip; `--research` force-refreshes, `--view` prints the existing RESEARCH.md without spawning (error if missing). Replaces a removed `research-phase` command. WildEra exposes this as a separate `gsd-research` skill.
- Proposal: ADOPT as `ph research <phase> [--view|--refresh]`.
- Source: upstream:gsd-core/workflows/plan-phase.md:126-147, 358-361; wildera:.agents/skills/gsd-plan/NOTICE.md:11
- Why it exists: cross-phase research and correction loops without replanning. [plan-phase.md:126]
- Test idea: `--view` never spawns a worker.

### UPS-22 Validation strategy (Nyquist) and security threat gate
- Behavior: when `nyquist_validation` and research are on, a `## Validation Architecture` section in RESEARCH.md produces `{phase}-VALIDATION.md` from a template (stop if the write fails); skipped when research disabled and none exists. Security: planner must include `<threat_model>` per plan (ASVS level 1-3, block_on severity), threat IDs `T-{phase}-NN` unique within a phase, new registers continue after the highest; execute-phase hard-stops on duplicates (#4683).
- Proposal: LATER (Nyquist, ASVS). KEEP the threat-ID uniqueness rule only if threat models are adopted.
- Source: upstream:gsd-core/workflows/plan-phase.md:447-505; upstream:gsd-core/workflows/execute-phase.md:103
- Why it exists: #4683 cross-plan ID collisions.
- Test idea: two plans claiming `T-03-01` abort execute before dispatch.

### UPS-23 UI design contract gate (plan:pre)
- Behavior: `check ui-plan-gate` reports `frontend`, `hasUiSpec`, `block`; exit 69 (could not look) stops; no frontend: continue; UI-SPEC exists: pass path to planner; `--skip-ui`; in auto-chain run `ui-phase` skill, in manual mode block and print the `/gsd:ui-phase` recommendation. `workflow.ui_phase` gates generation, `ui_safety_gate` gates the block.
- Proposal: LATER (kit is not UI-first; per-project adapter may add a lens).
- Source: upstream:gsd-core/workflows/plan-phase.md:507-590; upstream:docs/explanation/the-phase-loop.md:31-33
- Why it exists: ambiguity in UI design diverges implementations. [the-phase-loop.md:33]
- Test idea: n/a (LATER).

### UPS-24 Pattern mapper and API-surface hint (optional pre-planning)
- Behavior: `gsd-pattern-mapper` (read-only) maps new files to closest analogs into PATTERNS.md; non-blocking on error; reused if present. With intel enabled `intel api-surface` renders API-SURFACE.md as a HINT only ("absent means unknown, not nonexistent").
- Proposal: LATER (pattern mapper); DROP intel API surface.
- Source: upstream:gsd-core/workflows/plan-phase.md:676-731, 803-807
- Why it exists: planners invented symbols; analogs ground them.
- Test idea: n/a.

### UPS-25 Planner contract (prompt obligations)
- Behavior: planner prompt carries paths for state, roadmap, requirements, CONTEXT, RESEARCH, PATTERNS, VERIFICATION/UAT (gaps), REVIEWS, AI-SPEC, UI-SPEC, SPEC, spike/sketch findings; 1M-context enrichment adds the 3 latest completed phases' CONTEXT/SUMMARY/LEARNINGS plus `Depends on:` phases. Mandatory per task: `<read_first>` (incl. the modified file), `<acceptance_criteria>` checkable by grep/test/CLI (no subjective words), `<action>` with concrete identifiers and no full implementations; every runnable `<automated>` verify followed by `<fails_when>` naming an observable failure signal (TBD/N/A/none rejected; `MISSING - Wave 0` sentinel exempt); plan paths must be git-tracked source (`git ls-files`), never gitignored mirrors; a mandatory "Artifacts this phase produces" section; frontmatter wave/depends_on/files_modified/autonomous/requirements/must_haves; SPEC `## Edge Coverage` and `## Prohibitions` lifted into `must_haves.truths` / `must_haves.prohibitions`. Reuse `prior_verify_commands` verbatim.
- Proposal: ADOPT (core planner quality contract); CHANGE the SPEC/edge/prohibition lifting to LATER with spec-phase.
- Source: upstream:gsd-core/workflows/plan-phase.md:760-959, 104-106; upstream:gsd-core/templates/phase-prompt.md:14-38, 70-93
- Why it exists: vague actions yield shallow one-line changes; untracked mirror paths die on next sync (#3645); unrunnable verify paths (#2401); verify with no failure mode (#3172). [plan-phase.md:822-858, 939]
- Test idea: a plan whose `<automated>` lacks `<fails_when>` fails the checker probe.

### UPS-26 Chunked planning (outline then per-plan planners)
- Behavior: `workflow.plan_chunked` / `--chunked` splits one long planner Task into an outline Task plus N short per-plan Tasks (~3-5 min), each plan committed individually, resumable after a hang; `planning.chunked_parallel` dispatches same-Wave plans together only when dispatch capacity > 1.
- Proposal: ADOPT (WildEra already runs it; fits ph workers; parallel within a wave by default).
- Source: upstream:docs/CONFIGURATION.md:530, 660-708; upstream:gsd-core/workflows/plan-phase.md:961-984; wildera:.agents/skills/gsd-plan/SKILL.md:45-48
- Why it exists: long-lived planner Tasks hang on Windows stdio. [CONFIGURATION.md:530]
- Test idea: kill the run after plan 2 of 4, resume plans 3-4 only.

### UPS-27 Planner return handling and filesystem fallback
- Behavior: markers `## PLANNING COMPLETE`, `## PHASE SPLIT RECOMMENDED` (split via insert-phase / proceed degraded / prioritize), `## Source Audit: Unplanned Items Found` (add plan / split / defer into CONTEXT deferred), `## CHECKPOINT REACHED`, `## PLANNING INCONCLUSIVE`; no recognized marker (empty/truncated): count `plan_count_all` on disk; >0 offers Accept / Retry / Stop (known Windows stdio hang), 0 = inconclusive.
- Proposal: ADOPT (markers as the worker result contract; fallback by disk state).
- Source: upstream:gsd-core/workflows/plan-phase.md:986-1011
- Why it exists: planner wrote plans but return never arrived. [plan-phase.md:1003]
- Test idea: a worker returning garbage with 3 plan files on disk offers Accept.

### UPS-28 Plan checker, deterministic probes, revision loop
- Behavior: before the checker runs, two deterministic probes run (`check verify-command-paths`, `check verify-failure-directions`) and their JSON is handed over; exit 69 = "could not look", handed unchanged, never read as "all resolved"; any other non-zero = stop. Checker returns `## VERIFICATION PASSED` or `## ISSUES FOUND` (YAML issues with severity). Loop: max 3 iterations; count BLOCKER+WARNING; missing/unknown severity counts as BLOCKER (fail closed); INFO-only passes with advisories; stall = issue count not below previous: ask Proceed anyway / Adjust approach (re-enter planner, `stall_reentry_count` capped at 2, then Proceed / Abandon); at 3 iterations Force / Guidance+retry / Abandon. The revision prompt says `required_property`+evidence+severity BIND, `fix_hint` is one non-binding route. Checker dimensions include requirement coverage, task atomicity, dependency ordering, file scope, verify commands, context fit, gap detection, Nyquist, scope reduction (7b), cross-plan data contracts (9), same-wave coupling (3b, exempt via `coupling_justified`).
- Proposal: ADOPT (WildEra kept it verbatim).
- Source: upstream:gsd-core/workflows/plan-phase.md:1013-1136, 1138-1216, 1289-1295; upstream:docs/features/plan-checking.md:1-13; upstream:docs/features/phase-planning.md:76-84; upstream:gsd-core/templates/phase-prompt.md:22-28
- Why it exists: #3724 INFO must not enter the loop; stalled loops waste cycles. [plan-phase.md:1146, 1291]
- Test idea: checker returning 3 warnings then 3 warnings stalls and asks; unknown severity counts as blocker.

### UPS-29 REVISION_CONFLICT protocol
- Behavior: if a checker `fix_hint` contradicts a locked decision, capability guidance or existing plan constraint, the planner returns `## REVISION_CONFLICT` with alternatives instead of applying it. The conflict does not consume `iteration_count`; the checker is not re-spawned; escalate on the same `required_property` twice or on the THIRD conflict of the loop. With convergence enabled the conflict is recorded in REVIEWS.md under a writer-owned delimited slot (`<!-- gsd:plan-revision-conflicts:begin/end -->`) as `- [ ] REVISION_CONFLICT ...` and flipped to `- [x]` when resolved; sanitised via `awk ENVIRON` not `-v`; only plan-phase mutates the slot.
- Proposal: KEEP the protocol; CHANGE storage to a small JSON/markdown record owned by the orchestrator (WildEra: `revisions.json`).
- Source: upstream:gsd-core/workflows/plan-phase.md:1187-1260; upstream:gsd-core/workflows/plan-review-convergence.md:428-487; wildera:.agents/skills/gsd-plan/SKILL.md:58
- Why it exists: #3771 a success banner must not paper over an unresolved conflict; reviewer text must not forge blocking state.
- Test idea: reviewer text containing a forged conflict line does not count; an open conflict blocks "converged".

### UPS-30 Requirements and decision coverage gates (blocking)
- Behavior: after the checker, every `phase_req_ids` ID must appear in some plan's `requirements`/`requirements_addressed` (skip if none mapped); uncovered IDs and CONTEXT features missing from plan objectives are reported with options Re-plan / Move to next phase / Proceed. Decision gate (`check.decision-coverage-plan`, `workflow.context_coverage_gate`, default on): every trackable CONTEXT `<decisions>` item must be cited in a plan's `must_haves`/truths; blocking exit 1; "Proceed anyway" records the override in STATE.md; exit 69 stops. Verify-phase counterpart is non-blocking by design.
- Proposal: ADOPT (WildEra: `gsd.mjs check coverage`).
- Source: upstream:gsd-core/workflows/plan-phase.md:1303-1416; upstream:docs/CONFIGURATION.md:1390-1398; upstream:docs/ARCHITECTURE.md:696-698, 709
- Why it exists: issue #2492 decisions silently dropped; failing here is cheap. [plan-phase.md:1413-1416]
- Test idea: a decision D-02 not cited in any plan blocks the planned state.

### UPS-31 Post-planning bookkeeping
- Behavior: `state.planned-phase --phase N --name S --plans C` sets status Ready to execute, plan count, last activity; `roadmap.annotate-dependencies N` adds wave headers ("Wave 2 (blocked on Wave 1)") and "Cross-cutting constraints" (truths in 2+ plans), idempotent; commit PLAN files + STATE + ROADMAP when `commit_docs`; non-blocking post-planning gap table (`workflow.post_planning_gaps`, REQ-IDs and decisions vs plans, word-boundary REQ-1 vs REQ-10, natural sort).
- Proposal: ADOPT planned-phase state write and annotate; LATER gap table.
- Source: upstream:gsd-core/workflows/plan-phase.md:1418-1500; upstream:docs/CONFIGURATION.md:528
- Why it exists: #2493 unified gap report.
- Test idea: second annotate run changes no bytes.

### UPS-32 Planner/checker watchdog (stall detection)
- Behavior: planner and checker dispatched with background completion; helper `gsd_stall_watch` polls `*-PLAN.md` mtimes and the output file for completion markers every `planner.stall_detect_interval_minutes` (5), stalled after `planner.stall_threshold_minutes` (10) without marker or fresh plan activity -> choice Accept plans / Retry / Stop; `planner.stall_detection_enabled=false` awaits native completion. Never call ScheduleWakeup or any host wake tool to literalise a wait (#4079; plan-phase.md:436, 705).
- Proposal: CHANGE: use the kit watchdog / `ph` wait semantics (disk-activity based), keep thresholds as config.
- Source: upstream:docs/CONFIGURATION.md:545-549; upstream:gsd-core/workflows/plan-phase.md:436, 705, 745-749, 961-980, 1112-1117; upstream:CONTEXT.md:333 (stall-detection flag default true only)
- Why it exists: #2650 silent planner hang; #4079 partial-args wake error.
- Test idea: no plan file change for 10 minutes surfaces the recovery choice.

### UPS-33 Plan bounce (external refinement)
- Behavior: `workflow.plan_bounce` runs `plan_bounce_script` on each PLAN (backup `*-PLAN.pre-bounce.md`, restore on broken frontmatter or non-zero exit, re-check with checker, commit survivors).
- Proposal: DROP (plan review replaces it, UPS-34).
- Source: upstream:gsd-core/workflows/plan-phase.md:1297-1301; upstream:docs/CONFIGURATION.md:525-527
- Why it exists: not stated.
- Test idea: n/a.

### UPS-34 Plan review convergence loop (plan -> review -> replan)
- Behavior: config-gated (`workflow.plan_review_convergence`, default false; `--override-gate` only from autonomous `--converge`); plan-phase and replan (`--reviews --skip-research`) run INLINE in the orchestrator (a depth-1 agent has no Agent tool, bug #936); each cycle spawns an isolated review agent that must end with `CYCLE_SUMMARY: current_high=<N> current_actionable=<M>` plus `## Current HIGH Concerns` and `## Current Actionable Non-HIGH Concerns` (absent/malformed = abort; never count by grepping REVIEWS.md because history inflates it). Counting: include new, partially resolved and unresolved HIGHs; exclude fully resolved, history tables and MEDIUM/LOW already incorporated into PLAN.md (task, acceptance, verify, must_haves, threat model) or explicitly deferred/rejected. Consensus gate (only with 2+ reviewers): existence-class HIGH from one reviewer counts only if source-grounded or corroborated; judgment-class counts unless that reviewer's section opens with `[reviewed-without-source-citations]`/`[reviewed-without-repo-access]` or it is a diff-only lane; fail open when every reviewer is discounted; suppressed HIGHs stay listed `(single-reviewer, unconfirmed)`. Converged = HIGH 0, actionable 0, open conflicts 0 -> `state planned-phase`. Stall when unresolved count does not drop; at `--max-cycles` (default 3) offer Proceed anyway / Manual review (Proceed is NEVER offered with open revision conflicts). Reviewer flags come from the declared lane roster; bare invocation honours `review.default_reviewers` (#2315), else `--codex`.
- Proposal: CHANGE: the owner's plan-review step is a lens-based review by ph workers (WildEra's skeleton review: reviewer lanes fidelity + integration, at most 3 passes, `needs-owner` on stall) instead of external CLIs; KEEP the CYCLE_SUMMARY counting contract, the actionable-vs-HIGH split, stall detection, the never-proceed-on-open-conflict rule. OPEN: whether the kit runs a skeleton review (outline) or a full-plan convergence (see Open questions).
- Source: upstream:gsd-core/workflows/plan-review-convergence.md:19-139, 171-199, 212-299, 386-426, 428-519, 521-602; wildera:.agents/skills/gsd-plan/SKILL.md:47; wildera:.agents/skills/gsd-plan/references/compatibility.md:57
- Why it exists: bug #936 (replan wrapped in Agent could not spawn sub-agents); #2315 hard-coded --codex overrode configured reviewers; #3771; consensus gate added so a lone diff-only HIGH cannot block convergence.
- Test idea: a review return without CYCLE_SUMMARY aborts; a cycle with 2 unresolved then 2 unresolved reports a stall.

### UPS-35 Source-grounding and fact-drift passes in review
- Behavior: unless `plan_review.source_grounding` is false, every symbol the plan cites (decorators, Class.method, functions, CLI flags, file paths, fields) is resolved against source (grep or intel authority) with verdicts VERIFIED/MISSING/AMBIGUOUS/UNCHECKABLE; symbols under "Artifacts this phase produces" are excluded; severity via `drift-guard severity` (hardBlock for HIGH at lsp/scip authority; MEDIUM ambiguous; INFO uncheckable); a "Verification coverage" block lists every unchecked symbol. A second advisory axis (`drift-guard phase-status`: STATE.md vs ROADMAP status verdict consistent|lag|drifted|uncheckable; completeness is terminal) flags contradicting facts across ROADMAP/PLAN/STATE/CONTEXT; never sets hardBlock and never feeds the convergence counts.
- Proposal: ADOPT source grounding as a reviewer lens (cheap, catches hallucinated symbols); LATER fact-drift axis; DROP authority adapters other than grep.
- Source: upstream:gsd-core/workflows/plan-review-convergence.md:301-370; upstream:docs/ARCHITECTURE.md:919-921
- Why it exists: hallucinated symbols found at execution time cost whole waves; a clean review must never mean "nothing was checked". [plan-review-convergence.md:325]
- Test idea: a plan citing `Foo.bar` that does not exist gets MISSING and an UNCHECKABLE entry appears in the coverage block for a non-JS file.

### UPS-36 Cross-AI review, reviewer lanes (`review`, `review.models`)
- Behavior: `/gsd:review --phase N <lane flags>` invokes external AI CLIs (codex, agy, opencode, claude, gemini, coderabbit, ollama, lm-studio, llama.cpp, ...) over plans, writing REVIEWS.md with a Consensus Summary; `review.default_reviewers`, `review.reviewer_instances`, `review.models.<cli>`, per-lane timeout/effort, optional parallel lanes; lane output is untrusted evidence.
- Proposal: DROP external CLIs (owner: Claude Code is the only harness; other vendors run as Paseo `circle` models inside Claude Code); LATER: reviewers as ph workers on different `circle/*` models.
- Source: upstream:docs/CONFIGURATION.md:286-299, 386-443 (headings only); upstream:docs/ARCHITECTURE.md:390-392; upstream:gsd-core/workflows/code-review.md:572-700
- Why it exists: independent second opinions.
- Test idea: n/a.

### UPS-37 plan-phase modes: gaps and reviews
- Behavior: `--gaps` plans from VERIFICATION.md/UAT gaps creating plans with `gap_closure: true` (and `gap_ids`), skipping research; handoff points at `execute-phase --gaps-only`; `--reviews` replans from REVIEWS.md and every actionable finding must be incorporated into PLAN.md or recorded in a Review Dispositions Ledger inside the plan; `execute-phase --gaps-only` refuses to filter if plans lack a `gap_closure` key (#4924).
- Proposal: ADOPT gaps (one gap-fix wave then owner, as WildEra); KEEP the `gap_closure` key check.
- Source: upstream:gsd-core/workflows/plan-phase.md:810-818, 1515-1537; upstream:gsd-core/workflows/execute-phase.md:355, 1273; wildera:.agents/skills/gsd-plan/references/compatibility.md:35
- Why it exists: #3297 handoff must target gap scope; #4924 empty selection masked a missing key.
- Test idea: gaps-only run over plans with no `gap_closure` key stops with an error.

### UPS-38 Capability/loop-hook dispatch (`loop render-hooks`)
- Behavior: workflows call `gsd_run loop render-hooks <point>` (points discuss/plan/execute/verify/ship :pre/:post, execute:wave:pre/post) to fetch active capability hooks (step, gate, contribution kinds); gates carry `blocking`, `onError` halt|skip; third-party `check` values are validated before shell use; capability code loads from an overlay with consent ledger.
- Proposal: DROP the registry/overlay/consent system (owner: generic core + project adapter). CHANGE the useful part: fixed named extension points the project adapter can bind (plan:pre, execute:wave:post, verify:pre) with the same two-step gate contract (command failure per onError, then `block` flag).
- Source: upstream:gsd-core/workflows/plan-phase.md:477-590, 1452-1500; upstream:gsd-core/workflows/execute-phase.md:975-991; upstream:docs/ARCHITECTURE.md:381-388
- Why it exists: extensibility without editing workflows.
- Test idea: a gate hook with onError=skip and a crashing check continues; with halt it stops.

### UPS-39 Tracer-first and MVP decomposition
- Behavior: planner defaults to a leading `type="tracer"` slice (`--no-tracer` opts out) and reversibility gates (`<reversibility>` rating: one-way inserts a `checkpoint:decision`; `--no-reversibility-gates` opts out); MVP mode (flag > ROADMAP `**Mode:** mvp` > `workflow.mvp_mode` > false) plans vertical slices; Walking Skeleton for phase 01 of a new project.
- Proposal: ADOPT tracer-first (WildEra requires it in wave 1 and runs it alone first); LATER MVP/skeleton/reversibility.
- Source: upstream:gsd-core/workflows/plan-phase.md:153-190, 868-878; upstream:docs/features/phase-planning.md:53; wildera:.agents/skills/gsd-plan/SKILL.md:65
- Why it exists: verify the thinnest end-to-end slice before expansion.
- Test idea: an outline without a tracer in wave 1 fails `outline check`.

### UPS-40 execute-phase: init, args, per-run state
- Behavior: parse `PHASE_ARG`, `--wave N`, `--gaps-only`, `--cross-ai/--no-cross-ai`, `--interactive`, `--no-transition`; `init.execute-phase` returns executor/verifier models, `parallelization`, branching_strategy, plans, incomplete_plans, `section_manifest`, `threat_id_duplicate_count`; `executor_model == inherit` means omit the model argument; wave-failure tally reset per run via a handoff file under the git dir (fenced bash blocks are separate shells); a manual run (no `--auto`) clears the ephemeral `workflow._auto_chain_active` flag from interrupted chains; context window < 200k thins prompts, >= 500k adds prior-wave SUMMARYs and CONTEXT/RESEARCH.
- Note: the `.continue-here.md` blocking anti-pattern check and `--interactive` mode are specified in UPS-91; parallelization/`skip_checkpoints` in UPS-90.
- Proposal: ADOPT args/init; CHANGE per-run state to `ph` run state instead of git-dir handoff files; KEEP the stale-chain-flag clear rule.
- Source: upstream:gsd-core/workflows/execute-phase.md:72-118, 155-209
- Why it exists: stale `_auto_chain_active` caused unwanted auto-advance; #4915 cross-shell tally loss. [execute-phase.md:186, 111]
- Test idea: a manual run after an interrupted auto chain leaves auto_advance untouched but clears the chain flag.

### UPS-41 Safe-resume gate
- Behavior: before dispatching, for the active incomplete plan, resolve its commits (`check evaluation-scope --plan P-NN --commits-only --milestone-bound --max-commits 30`); production commits present and SUMMARY missing (and no `.planning/async-jobs/*.json` deferral) = stop and offer close out manually / re-execute from scratch / mark-and-skip; any non-zero from the resolver (including 69 "could not look") makes the gate print an explanation and `exit 1` (fail closed, no executor dispatched; it does not re-exit 69).
- Proposal: KEEP.
- Source: upstream:gsd-core/workflows/execute-phase.md:213-234
- Why it exists: continuing risks duplicate work and stale STATE/ROADMAP progress.
- Test idea: commits exist for plan 03-02 with no SUMMARY: executor is not spawned.

### UPS-42 Plan index, waves, readiness, filtering
- Behavior: `phase-plan-index` returns plans with wave, depends_on, files_modified, `has_summary`, `blocked_by`, `ready`, `gap_closure`, `waves`, `incomplete`, `runnable`, warnings (unresolved `depends_on` token named with escaped value, wave-mismatch warning suppressed when an edge was dropped). Dispatch skips plans with a summary, with non-empty `blocked_by` (reported by name), or `ready:false`; `--wave N` refuses when lower waves still have matching incomplete plans. If everything is filtered, evaluate in order: filter active -> "no matching plans"; blocked plans -> "phase stuck, resolve the halt" (never "done"); not-ready -> waiting; all summarised -> route by verification status (missing/stale -> resume at the verification gates; passed + not marked -> update_roadmap; gaps/human -> show next command).
- Proposal: ADOPT; KEEP the ordered all-filtered logic (#2868, #2830, #3684, #4628).
- Source: upstream:gsd-core/workflows/execute-phase.md:346-435; upstream:docs/CLI-TOOLS.md:272-302
- Why it exists: #2868 phase finished between last SUMMARY and verification looked complete; blocked-and-incomplete must not read as finished.
- Test idea: 3 plans, one halted, two blocked dependents: run reports "stuck", exit without verifying.

### UPS-43 Wave execution core: overlap check, heartbeats, cwd-drift guard
- Behavior: before each wave, any two plans sharing a `files_modified` entry force that wave sequential (flag as a planning defect); emit literal `[checkpoint] phase N wave a/b ...` heartbeat lines (no tool call) at wave/plan boundaries to prevent the SSE "Stream idle timeout" at ~200K cache_read (#2410); at `execute_waves` entry refuse when the orchestrator's cwd/branch is an agent worktree (branch namespace `agent-`/`worktree-agent-`/`worktree-wf_`, not the path), printing a handoff report of stranded commits and dirty files (#48, #1856).
- Proposal: KEEP overlap check and cwd-drift guard (equivalent on `ph` worktree roots); CHANGE heartbeats to whatever keeps `ph` waits alive (kit watchdog).
- Source: upstream:gsd-core/workflows/execute-phase.md:445-540, 548-580
- Why it exists: a wrong-base merge nearly shipped ~1000 files (#48).
- Test idea: orchestrator started inside `agent-*` branch refuses and lists stranded work.

### UPS-44 Worktree isolation, base check, manifest, cleanup-wave
- Behavior: `ISOLATION` (harness-worktree | orchestrator-worktree | none) is the only fan-out branch point; `use_worktrees=false` forces none; per-plan decision drops isolation for plans touching git submodule paths; fork-base mismatch (HEAD vs origin/HEAD, `worktree base-check`, `worktree.baseRef:"head"` in `.claude/settings.local.json`) auto-degrades to sequential; dispatch worktree agents ONE AT A TIME with background (parallel `worktree add` races on `.git/config.lock`); each agent recorded in a wave manifest via `worktree record-agent` (branch must match `^(worktree-)?agent-[A-Za-z0-9._/-]+$`, `--files`, `--deletions`); `worktree cleanup-wave` merges in order, blocks undeclared deletions, advisory scope-conformance warnings, merge timeout 10 min, residue restore after a killed merge; recovery of a rejected isolated run never defaults to editing main (#1292).
- Proposal: CHANGE - kit owns worktrees through `ph`; re-implement only the contract (base check, per-agent branch namespace, manifest, ordered merge, deletion guard, fail-safe recovery). OPEN: who owns worktree creation in the kit (see Open questions).
- Source: upstream:gsd-core/workflows/execute-phase.md:120-153, 608-612, 660-668, 761-767, 842-928; upstream:docs/CLI-TOOLS.md:1418-1522
- Why it exists: base mismatch (exit 42 guard), mass-deletion accidents (#3003), lost merges on killed hooks (#4721), recovery editing main (#1292).
- Test idea: branch deleting an undeclared file is blocked while other wave entries merge.

### UPS-45 Executor dispatch prompt contract
- Behavior: prompt passes paths only; includes `[gsd:dispatch phase= plan=]` with the exact plan id (guard hooks compare it verbatim to the isolation sentinel); tells the executor not to touch STATE.md/ROADMAP.md in worktree mode (orchestrator is the single writer after merge); SUMMARY.md MUST be committed before return (write -> commit -> only then narration; uncommitted SUMMARY is lost when the worktree is force-removed, #2070); hooks run by default, `--no-verify` only when `workflow.worktree_skip_hooks=true` (#2924); orchestrator build-time embeds the execution context files (`@path` never expands inside an Agent prompt, #3324) and the branch-check fragment; sequential mode adds a project-root pin guard (#4254) and lets the executor update STATE/ROADMAP itself; `agent_hint` frontmatter routes a plan to a specialist agent (`workflow.agent_hint_routing`).
- Proposal: ADOPT contract; CHANGE embeds to the ph prompt builder (no `@` includes); DROP `agent_hint` routing (LATER).
- Source: upstream:gsd-core/workflows/execute-phase.md:631-801; upstream:docs/CONFIGURATION.md:518, 520
- Why it exists: #2070 lost SUMMARYs; #3324 literal `@` includes; #2924 silent hook bypass.
- Test idea: a prompt builder test fails if the prompt contains a literal `@~/` include.

### UPS-46 Completion reconciliation and stall surveillance
- Behavior: if an executor returns no normal completion or its session ends abnormally (interrupted, aborted, killed, timed out, `turn_aborted`), reconcile artifacts FIRST (SUMMARY present AND matching recent commits = complete, do not re-dispatch), classify failure SECOND. Every `executor.stall_detect_interval_minutes` (5) inspect `git log <branch> --since=<dispatch>`; no completion/SUMMARY/commits for `executor.stall_threshold_minutes` (10) offers continue waiting / kill and retry / kill and switch to inline; a working executor is never steered (progress policy, #4218). Spot-check each SUMMARY after a wave: first two `key-files.created` exist, `evaluation-scope --plan ... --commits-only` returns >= 1 commit on THIS branch (exit 69 = fail), no `## Self-Check: FAILED`.
- Proposal: KEEP (artifacts decide; matches kit watchdog "input-complete fix" lineage, see other areas).
- Source: upstream:gsd-core/workflows/execute-phase.md:37-40, 802-828, 1032-1059
- Why it exists: #4217 Codex sessions end abnormally after work is committed; never block indefinitely on a missing signal.
- Test idea: worker killed after SUMMARY+commit is classified complete.

### UPS-47 Post-merge build and test gate
- Behavior: after merging a wave (or after the last serial plan) run build then tests. Build: `workflow.build_command` or auto-detect (Xcode/make/just/cargo/go/python/npm), run as `run-with-timeout 300` (HARDCODED 5 minutes); exit 124 logs a warning, is non-blocking, does NOT add a wave-failure line and does not skip the test gate; non-zero adds one line to the cumulative wave-failure handoff file. Tests: `workflow.test_command` or auto-detect, passed through `query normalize-test-command` (one-shot form, defeats vitest/jest watch mode) then `run-with-timeout workflow.test_gate_timeout` (default 600 s); exit 124 is non-blocking for the gate, adds no wave-failure line, but prints the watch-mode/raise-timeout message and is never silently ignored; non-124 failure adds a line; > 1 cumulative failures strongly recommend "Fix now". Tracking (ROADMAP plan progress + STATE) is updated ONLY when `TEST_EXIT` is 0, so a timeout leaves plans in progress. Hooks post-wave only when `worktree_skip_hooks`.
- CONFLICT: upstream:docs/CONFIGURATION.md:556-557 says both gates run "with a 5-minute timeout"; the step file uses 300 s for build and `test_gate_timeout` (600 s) for tests (CONFIGURATION.md:539 agrees with the step). Trust the step file.
- Proposal: ADOPT; build/test commands come from the project adapter (owner decision), keep the green-only tracking rule; kit needs `run-with-timeout` and `normalize-test-command` helpers.
- Source: upstream:gsd-core/workflows/execute-phase/steps/post-merge-gate.md:64-87, 137-160; upstream:gsd-core/workflows/execute-phase.md:930-1030, 947-953; upstream:docs/CONFIGURATION.md:539, 556-557
- Why it exists: per-agent self-checks pass in isolation; merges can silently drop code (add/add conflicts). [execute-phase.md:1027-1030]
- Test idea: failing tests after merge leave plans in-progress and ROADMAP unchanged.

### UPS-48 Failure classification and recovery
- Behavior: `agent classify-failure` on the return body yields class quota-exceeded (sentinels `usage limit`, `rate limit`, `429`, `too many requests`, `RESOURCE_EXHAUSTED`, `usage_limit_reached`, with `retryAfterSeconds`), classify-handoff-bug (`classifyHandoffIfNeeded is not defined`, a Claude Code runtime bug: spot-check and treat as success if SUMMARY+commits exist) or unknown-failure (ask Continue/Stop). Quota: wait for reset or, with `dynamic_routing.provider_escalation` (ordered model ids, capped by `max_escalations`), re-resolve to the next provider model and log the switch; ladder opt-in; other classes never use it.
- Proposal: ADOPT classification; CHANGE provider escalation to the Paseo `circle` provider/model fallback list in the adapter.
- Source: upstream:gsd-core/workflows/execute-phase.md:1061-1078, 1402-1409; upstream:docs/CONFIGURATION.md:1753-1783
- Why it exists: #3095 quota failures must not offer retry-now.
- Test idea: a body containing `429` routes to quota-exceeded with the retry hint.

### UPS-49 Checkpoints and continuation
- Behavior: tasks of type `auto`, `checkpoint:human-verify`, `checkpoint:decision`, `checkpoint:human-action`; plans with `autonomous:false` return structured state (completed tasks table, current task, awaited input); orchestrator presents it, then spawns a FRESH continuation agent (not resume: resume breaks with parallel tool calls). In auto-mode human-verify auto-approves and decision auto-selects when `auto_select` exists; human-action is always presented; `blocking-human` gates and package-verification checkpoints are never auto-approved. `workflow.human_verify_mode` default `end-of-phase` suppresses human-verify tasks into `<human-check>` blocks.
- Proposal: ADOPT with CHANGE: checkpoint = worker returns marker, orchestrator reports `needs-owner`, no in-agent questions (WildEra departure).
- Source: upstream:gsd-core/workflows/execute-phase.md:1085-1128; upstream:gsd-core/templates/phase-prompt.md:292-306; upstream:docs/CONFIGURATION.md:534; wildera:.agents/skills/gsd-plan/references/compatibility.md:37
- Why it exists: fresh agents with explicit state are more reliable than resume. [execute-phase.md:1125]
- Test idea: a blocking-human gate in auto-mode still stops.

### UPS-50 Verify-phase-goal, status routing, human_needed and gap closure
- Behavior: shared verification step (also used by verify-work): verify:post dispatch + SECURITY threats-open gate, code review gate, parent-artifact close for gap plans, regression gate (prior phases' tests, `state:has-prior-phases`), verifier, fingerprint, then `verification status` read (closed enum). `passed` -> update_roadmap; `human_needed` -> write `{phase}-UAT.md` (status testing, one test per human_verification item) and STOP (phase advancement happens after verify-work passes); `gaps_found` -> revert requirement marks, show gaps and `/plan-phase N --gaps`, then `execute-phase --gaps-only` and re-verify. Never advance the phase from the human_needed branch.
- Proposal: ADOPT.
- Source: upstream:gsd-core/workflows/execute-phase.md:1130-1177, 1179-1273; upstream:docs/CLI-TOOLS.md:903-929
- Why it exists: #5118 one owner for the verification verdict.
- Test idea: a `human_needed` report never produces a ROADMAP checkbox flip.

### UPS-51 Phase completion bookkeeping and transition
- Behavior: `phase.complete N` marks the roadmap checkbox with date, progress row Complete, final plan count, advances STATE to the next phase, marks REQUIREMENTS traceability, scans verification debt into `warnings[]`. The SUMMARY file scan is ADVISORY only (never blocks; the completion gate is the VERIFICATION status): paths are recovered heuristically from the SUMMARY BODY (backticked paths, `Created:`/`Modified:`-style lines); globs, URLs, bare hostnames and paths outside the project are skipped; the `key-files:` frontmatter block is NOT read (a summary whose only file claims are there yields no findings); commit hashes are not resolved; no cap on paths checked. The standalone `verify-summary` verb is a different check (first two files by default, exit 0, trust JSON `passed`), as is the execute-phase spot-check of the first two `key-files.created`. REQ-line warnings use kinds `req-line-misparse|range-reading|unverified`; then commit; optional global learnings extraction; todos whose `resolves_phase` matches are moved pending->completed; delegate to `transition.md` in post-completion mode (evolve PROJECT.md, offer next phase) starting at `evolve_project`.
- Proposal: ADOPT (`ph phase complete`); DROP todo closing and global learnings; KEEP PROJECT.md evolution rules.
- Source: upstream:gsd-core/workflows/execute-phase.md:1042, 1287-1388; upstream:docs/CLI-TOOLS.md:247-270, 304-432; upstream:gsd-core/templates/project.md:143-163
- Why it exists: #2433 todos auto-closed; REQ-line parsing silently lost requirements. [CLI-TOOLS.md:339-345]
- Test idea: ROADMAP `**Requirements**: REQ-01; REQ-02` marks both or warns with the dropped ID.

### UPS-52 Branching strategy and protected branches
- Behavior: `git.branching_strategy` none|phase|milestone with templates `gsd/phase-{phase}-{slug}`, `gsd/{milestone}-{slug}`; new branches fork from `origin/<default>` with `--no-track` (never from current HEAD: #2916, #2498), fetch failure with no local copy aborts, existing branch reused; strategy none checks the protected-branch list (resolved base + `git.protected_branches`, exact names) and warns; `git.allow_default_branch_commits` escape hatch.
- Proposal: CHANGE: kit branches are owned by ph/project workflow; keep the "fork from origin default with --no-track" rule if phase branches are used. OPEN.
- Source: upstream:gsd-core/workflows/execute-phase.md:296-332; upstream:docs/CONFIGURATION.md:1258-1313
- Why it exists: #2916 consecutive phases compounded unpushed; #2498 autoSetupMerge pushed to the default branch.
- Test idea: branch creation with failed fetch and no `origin/main` aborts.

### UPS-53 TDD gate
- Behavior: with `workflow.tdd_mode`, before each behavior-adding task (`task.is-behavior-adding`) a RED commit (test-pattern pathspecs across languages) must exist in the plan's commit scope or the run trips (`last_gate_trip` in STATE); exempt doc/config/test-only tasks; decision keys on TDD_MODE alone (not MVP, #4011).
- Proposal: LATER (WildEra rejects `type: tdd` because coders never commit).
- Source: upstream:gsd-core/workflows/execute-phase.md:236-263; upstream:docs/features/phase-execution.md:1-45
- Why it exists: #4011 gate was inert on non-MVP phases.
- Test idea: n/a.

### UPS-54 verify-work (conversational UAT)
- Behavior: finds SUMMARY deliverables, builds `{phase}-UAT.md` (frontmatter status/phase/source/started/updated; Current Test; Tests with `result: [pending]|pass|issue|skipped|blocked`; Summary counts; Gaps), presents one test at a time through `uat render-checkpoint` byte-for-byte; response classification (pass: empty/yes/y/ok/next; skip; blocked with inferred `blocked_by` tag server|physical-device|release-build|third-party|prior-phase|other; deferred follow-up never becomes a gap (#1921); anything else = issue with inferred severity blocker/major/minor/cosmetic, never asked); coverage-aware auto-pass for SUMMARY `coverage:` blocks; cold-start smoke test injected when server/db/seed/startup/Docker files changed; commit-claim reconciliation (`commits:`, `plan_head_before/after` bounded window; mismatch = BLOCKER, legacy = WARNING; unbounded `base..HEAD` never evidence); writes batched (issue, every 5 passes, completion); resume reconciles gaps against completed `gap_ids` plans; completion via `uat.complete-session` (changed:false = nothing written); zero unresolved issues -> verify:post + security gate -> canonicalize VERIFICATION status to passed only if `phase uat-passed --uat-only` -> `phase uat-passed --require-verification` -> transition; issues -> parallel debug agents (diagnose-issues) -> gsd-planner `--gaps` -> checker -> revision loop (max 3) -> "execute --gaps-only".
- Proposal: ADOPT (owner decision lists verify); CHANGE UAT conversation to the main session text flow, keep status vocabulary and gap YAML; DROP the Playwright/DOM branches (LATER).
- Source: upstream:gsd-core/workflows/verify-work.md:8-28, 171-215, 217-303, 305-399, 401-508, 510-525, 527-748, 782-893; upstream:docs/features/work-verification.md:1-19
- Why it exists: #3968/#4670 executor commit claims were unverified; #4663 zero issues is not pass evidence when rows are blocked; #4983 verified gap resolutions are not unresolved issues.
- Test idea: 0 passed / 0 issues / 3 blocked must not flip VERIFICATION to passed.

### UPS-55 UAT predicate and verification-debt audit
- Behavior: `phase uat-passed [--require-verification|--uat-only]` returns `{passed, uat_files, verification_files, checks, blockers, policy}`; exit 0 passed, 1 not passed; `audit-uat` and `audit-open` scan all phases for pending/skipped/blocked/human_needed items (milestone-scoped plus archived marked `archived_milestone`; parse gaps counted); progress shows "Verification Debt" without blocking routing.
- Proposal: ADOPT predicate; LATER audit-uat/audit-open cross-phase audits.
- Source: upstream:docs/CLI-TOOLS.md:188-192, 1338-1349; upstream:gsd-core/workflows/progress.md:274-316; upstream:docs/features/uat-passed-predicate.md (title only)
- Why it exists: #3782 archived debt must remain visible.
- Test idea: pending UAT row blocks `uat-passed` with a named blocker.

### UPS-56 quick (ad-hoc tasks with GSD guarantees)
- Behavior: `quick [--full|--validate|--discuss|--research] <desc>`; `--full` = discuss+research+validate (normalised: all three flags = full); validate = plan-checker (max 2 iterations) + post-execution verifier; requires ROADMAP.md (can run mid-phase); id `YYMMDD-xxx` (2 s Base36), slug <= 40 chars, dir `.planning/quick/<id>-<slug>/` with `<id>-PLAN.md`, `-SUMMARY.md` (frontmatter `status: complete`), optional CONTEXT/RESEARCH/VERIFICATION/REVIEW/deferred-items; planner in quick/quick-full mode: ONE plan with 1-3 tasks; plan paths are repo-root-relative (#4767); mutable-scope authority rule (only live observations authorise file scope, #3786); executor submodule commit guard; with `research_before_questions` research runs before discussion (#3894); startup orphan-worktree sweep; base-check auto-degrade to sequential (#1941); full mode runs a quick-depth code review over the evaluation-scope files; STATE.md "Quick Tasks Completed" row appended through `quick-tasks-append` (schema-backed escaping so `|` in a description cannot rag the table), executor must NOT commit docs artifacts (orchestrator does one `docs(quick-<id>)` commit honouring `commit_docs`).
- Proposal: ADOPT (quick and `--full`); LATER `--discuss/--research` separately; DROP the STATE table row (CHANGE: list quick tasks from the directory) unless the owner wants the table; quick-batch LATER.
- Source: upstream:gsd-core/workflows/quick.md:1-13, 30-64, 117-248, 299-368, 383-573, 577-636, 638-775; upstream:docs/features/quick-mode.md:1-20; upstream:docs/features/quick-batch.md:1-23
- Why it exists: #4767 absolute paths pinned verify to the main tree; #2133/#4736 raw table rows broke on `|`.
- Test idea: `quick "fix a | b"` leaves STATE.md table parseable; the executor commit excludes `.planning/` docs.

### UPS-57 fast (inline trivial task)
- Behavior: no PLAN.md, no subagent; executes inline; records via `quick-tasks-append --task` alone.
- Proposal: ADOPT as "main session edits directly" guidance; no workflow needed.
- Source: upstream:gsd-core/workflows/fast.md (purpose line only); upstream:docs/CLI-TOOLS.md:1265-1281
- Why it exists: avoid loop overhead for one-line fixes.
- Test idea: n/a.

### UPS-58 code-review workflow
- Behavior: gated by `workflow.code_review` (default true; independent of `code_review_point` execute:post|execute:wave:post); flags parsed by `code-review-flags` (`--fix`, `--all`/`--auto` imply fix, `--depth`, `--files`); input sanitisation of padded phase; three-tier file scope: `--files` (path-contained, existence checked) > SUMMARY `key_files` created/modified (extractor accepts root files and extensionless build files, `~/` expanded) > `evaluation-scope --phase` union of task commits (reachable from HEAD, planning artifacts and lockfiles excluded; `outsideUnion`, `unreachable`, `missingOnDisk` named, not counted); later tiers narrowed by `--since LAST_REVIEW_COMMIT` (#3661); SUMMARY-vs-scope cross-check adds missed files; filter planning artifacts, deleted files (named), dedupe, sort; warn > 50 files; depth resolver (flag > strongest matching `code_review_depth_overrides` rule > config > standard; invalid rule = halt, never silent fallback; deep downgraded to standard on large scope); empty scope = skip unless `--fix` with an existing REVIEW.md; spawn `gsd-code-reviewer` writing `{NN}-REVIEW.md` (frontmatter `status`, `files_reviewed`, severity counts; findings CR-/BL-/WR- ids), orchestrator validates frontmatter then commits; failure never leaves a partial REVIEW.md; `--fix` delegates to code-review-fix (gsd-code-fixer, one atomic commit per fix, `--auto` loop capped at 3, `REVIEW-FIX.md`); in-phase gate writes `<NN>-REVIEW-DISPOSITION.md` (open|fixed|skipped|deferred, carried rows).
- Proposal: ADOPT lite as the project-adapter "review lenses" gate (scope tiers, depth, REVIEW.md, one bounded fix pass); DROP fallow structural pre-pass, external reviewer lanes, disposition ledger (LATER). WildEra replaced it with code-wave's bounded review gate.
- Source: upstream:gsd-core/workflows/code-review.md:18-531, 533-600, 702-938; upstream:docs/features/code-review-pipeline.md:1-60 (config table and disposition ledger prose); wildera:.agents/skills/gsd-plan/references/compatibility.md:34
- Why it exists: #2666 SUMMARY extractor dropped root-level files; #4460 `--files` overridden by phase scope; #5164 union of task commits instead of a range (range held 23/194/602 files vs 9/42/69). [upstream:docs/ARCHITECTURE.md:361]
- Test idea: a SUMMARY listing only `Dockerfile` still yields it in scope; `--files` never appends phase scope.

### UPS-59 autonomous (milestone driver)
- Behavior: drives remaining phases (`--from N`, `--to N`, `--only N`, `--interactive`, `--converge/--cross-ai`): per phase smart-discuss (batch table proposals; or minimal CONTEXT when `workflow.skip_discuss`) -> UI design contract -> plan -> execute `--no-transition` -> code review + `--fix --auto` (non-blocking) -> read `verification status`: passed -> transition and loop; human_needed -> validate now or defer (records `## Deferred Verification` row `verification_deferred_human`, stops); gaps_found -> exactly ONE gap-closure attempt then ask; handle_blocker options Fix and retry / Skip / Stop with a retry ceiling of 3 then terminal `needs_human` row in STATE; re-reads ROADMAP/STATE after every phase (inserted phases, blockers); deferred phases skipped on re-entry; `--only` and partial runs skip lifecycle; full run ends with audit-milestone -> complete-milestone -> cleanup; discuss is single-pass (never loops).
- Proposal: LATER (kit core = main session drives steps by hand; autonomous = a `ph workflow` later). KEEP the rules for the later build: single gap-closure retry, retry ceiling 3, deferred-state rows, re-read ROADMAP each phase.
- Source: upstream:gsd-core/workflows/autonomous.md:17-148, 152-238, 240-568, 584-636, 638-768, 770-799; upstream:docs/features/autonomous-mode.md; upstream:docs/features/single-phase-autonomous.md
- Why it exists: #3210 needs_human ceiling; #1708 background dispatch only where nesting works.
- Test idea: a phase failing 3 retries writes `needs_human` and stops.

### UPS-60 next / progress / smart-entry routing
- Behavior: `progress` loads `init.progress`, `roadmap analyze`, `state-snapshot`, renders bar/recent work (`summary-extract --fields one_liner`)/position/decisions/blockers/debug sessions, then routes. Route 0 (all phases scanned lowest first): any phase with plans > summaries routes to `execute-phase` before anything else (state `current_phase` may have advanced past unfinished work; scan is treated as FAILED when `roadmap analyze` scope != complete, #3184); then counts for the current phase: UAT partial -> verify-work; UAT gaps diagnosed -> plan --gaps; summaries < plans -> execute; verification not passed -> owner's `next_command`; plans = 0 -> discuss or plan; complete with more phases -> discuss next; all phases -> complete-milestone; missing ROADMAP + PROJECT -> new-milestone. `next` adds hard-stop gates (unresolved `.planning/.continue-here.md`, STATE `status: error|failed`, unresolved VERIFICATION FAIL), `--force` skips gates, `--no-resume` skips Route 0, prior-phase completeness prompt (Continue+defer to backlog / Stop / Force), spike/sketch notice, invokes the chosen command without confirmation, `--auto` chains until milestone complete, blocker or error; `--converge` routes planning through convergence. `smart-entry --json` classifies situations (no project, paused, blocked, verify failed, needs first phase, planning, executing, verify pending, idle stranded, complete, unknown) read-only; consecutive same-step calls trigger a hard-stop gate.
- Proposal: ADOPT `progress` and `next` as one `ph next`/`ph status` read-only router over the phase status ladder (UPS-70); DROP backlog deferral (CHANGE: record deferral in STATE blockers), `--do` freeform dispatcher, spike/sketch notice.
- Source: upstream:gsd-core/workflows/progress.md:13-71, 189-345, 349-687; upstream:gsd-core/workflows/next.md:14-268, 270-346; upstream:docs/CLI-TOOLS.md:150-159; upstream:docs/features/smart-entry-launcher.md:1-22; upstream:docs/features/hard-stop-safety-gates-in-gsd-progress-next.md
- Why it exists: #160 session dies mid-execution and `current_phase` advances past unfinished work; #3218 `.plans` arrays never existed in `roadmap.analyze`; #3165 truncated window read as clean.
- Test idea: STATE says phase 4 but phase 2 has a plan without SUMMARY: router returns execute-phase 2.

### UPS-61 ship (PR creation)
- Behavior: preflight: `verification status` must be `passed` (any other status blocks with `PHASE_VERIFICATION_INCOMPLETE`; message fields read only on the blocking path), clean tree, protected-branch warning (offer branch if strategy none), origin remote, `gh` authenticated, `ship:pre` gates (security SECURITY.md `threats_open == 0` strictly, broken-windows ledger open_count == 0, else generic gate evaluation; unreadable = fail closed); push (set upstream on failure); PR body from planning artifacts (Summary, Changes per SUMMARY, Requirements Addressed, Verification, Key Decisions, append-only `ship.pr_body_sections`, TDD Audit table from `gate-status:` trailers only when a real value exists, aggregate trailer last); `gh pr create --body-file` temp file; optional external review command (`workflow.code_review_command`, 120 s timeout, JSON verdict) then manual review choice; track shipping in STATE and push the ship-note with `[ci skip]`, with recovery empty commit when the PR is BLOCKED with zero checks (#2783); ship:post agents (MemPalace) best-effort.
- Proposal: ADOPT lite (`ph ship`: verification gate, clean tree, push, PR body from artifacts); LATER configured PR sections, TDD audit; DROP broken-windows/security/MemPalace hooks. OPEN: does the kit use GitHub PRs at all.
- Source: upstream:gsd-core/workflows/ship.md:23-193, 195-208, 210-363, 365-383, 386-477, 479-530, 532-579; upstream:docs/features/ship.md:1-23
- Why it exists: #2138 ship-note stayed local and was discarded on branch delete; #2783 `[ci skip]` wedged required checks.
- Test idea: ship refuses when VERIFICATION is `human_needed`.

### UPS-62 Milestone lifecycle (audit, complete, new, summary, cleanup)
- Behavior: `audit-milestone` aggregates phase verifications + cross-phase integration + requirements coverage into `v{X}-MILESTONE-AUDIT.md` (status passed|gaps_found|tech_debt); `complete-milestone` archives ROADMAP/REQUIREMENTS, writes MILESTONES.md entry, PROJECT.md full evolution review, tag `v[X.Y]` (`git.create_tag`), merge options (squash/no-ff/delete/keep); `milestone complete <v> (--confirm|--dry-run)` is irreversible so refuses without `--confirm`, guards unstarted phases (`--force --confirm`), refuses a `truncated` milestone window, never moves sentinel dirs; `new-milestone` repeats the new-project flow without resetting config; `cleanup` archives phase dirs to `milestones/vX-phases/`.
- Proposal: ADOPT archive/complete/new-milestone minimal (CHANGE: no gsd-tools; `ph milestone complete` with dry-run default); LATER audit with integration checker.
- Source: upstream:docs/CLI-TOOLS.md:1154-1195, 573-585; upstream:docs/features/milestone-management.md:1-15; upstream:gsd-core/workflows/autonomous.md:667-752
- Why it exists: #3726 irreversible archive; #2946 STATE milestone mismatch warning.
- Test idea: `milestone complete v1` without `--confirm` exits 1 and changes nothing.

### UPS-63 Workflow catalogue: other lifecycle and utility workflows
- Behavior: debug, diagnose-issues, forensics, node-repair (autonomous repair of failed task verification, `node_repair_budget` 2), execute-plan (executor's own workflow), transition, pause-work (`HANDOFF.json` + `.continue-here.md`), resume-project, add-phase/insert-phase/remove-phase/edit-phase, analyze-dependencies, list-phase-assumptions, health (validate `.planning/`, `--repair`), stats, session-report, undo (see UPS-94), pr-branch (filter `.planning/` out of PR branches), extract-learnings, add-tests, validate-phase, secure-phase, audit-fix, audit-uat, import, new-workspace/list/remove, manager (dashboard), do (freeform router), settings (+advanced, integrations), help, update/reapply-patches, sync-skills, thread, plant-seed/list-seeds/add-backlog/note/add-todo/check-todos, sketch/spike (+wrap-up), explore, onboard, scan, ai-integration-phase, eval-review, ui-phase, ui-review, docs-update, mvp-phase, ultraplan-phase, quick-batch, graduation, inbox, profile-user, milestone-summary.
- Proposal: ADOPT: execute-plan (executor contract), transition, pause-work/resume, health, add/insert/remove-phase, debug/forensics (already separate area), undo (safe revert), node-repair (LATER). LATER: stats, session-report, validate-phase, secure-phase, add-tests, extract-learnings, docs-update, workspaces, analyze-dependencies, scan/onboard. DROP: add-backlog, add-todo, check-todos, plant-seed, list-seeds, note, thread, inbox (Backlog-like parking), update/reapply-patches/sync-skills/help (installer concerns), profile-user, ui-*, ai-*, eval-review, sketch/spike, explore, ultraplan, mvp-phase, graduation, manager, do, import (LATER if plan import wanted).
- Source: upstream:gsd-core/workflows/*.md (first purpose line of each, grep over the directory); upstream:docs/README.md:93-130
- Purpose lines (r1 R1-UPS-15; from each file's first `<purpose>` line, read via grep): add-phase = append an integer phase at the end of the milestone, compute next number, create dir, update roadmap; add-tests = generate unit/E2E tests for a completed phase from SUMMARY/CONTEXT, classify files TDD/E2E/Skip, user-approved plan; analyze-dependencies = detect file overlap and semantic API/data-flow dependencies between ROADMAP phases and suggest `Depends on`; audit-fix = autonomous audit-to-fix pipeline; audit-milestone/audit-uat = see UPS-62/UPS-55; check-todos = list/select pending todos; cleanup = archive completed milestones' phase dirs to `milestones/vX-phases/` after dry-run; code-review-fix = auto-fix REVIEW.md findings via gsd-code-fixer, `--auto` loop capped at 3, REVIEW-FIX.md; diagnose-issues = parallel debug agents for UAT gaps; edit-phase = edit any ROADMAP phase field in place (guarded for in-progress/complete unless `--force`, validates `depends_on`); execute-plan = executor's workflow for one PLAN; explore = Socratic ideation; extract-learnings = decisions/lessons/patterns/surprises into LEARNINGS.md; fast = inline trivial task, no PLAN/subagent; health = validate `.planning/` integrity, optional repair; insert-phase = decimal phase for urgent work; list-phase-assumptions = surface the agent's assumptions before planning; manager = interactive milestone dashboard command center; mvp-phase = user-story + SPIDR split then plan-phase in MVP mode; new-workspace/list-workspaces/remove-workspace = isolated workspace dirs with worktree/clone copies and own `.planning/`; node-repair = autonomous repair of a failed task verification before escalation; note = zero-friction idea capture; pause-work = `HANDOFF.json` + `.continue-here.md`; pr-branch = clean PR branch filtering `.planning/` paths; remove-phase = delete an unstarted future phase and renumber; resume-project = restore full context ("Where were we?"); scan = lightweight single-focus codebase assessment (one mapper); secure-phase = verify PLAN threat-register mitigations, update SECURITY.md; session-report = SESSION_REPORT.md summary of work and resource use; settings(-advanced/-integrations) = interactive config; sketch/spike (+wrap-up) = throwaway HTML mockups / experiments packaged into a project skill; smart-entry = state-aware front door dispatching one command; stats = project statistics; transition = mark phase complete, advance, PROJECT.md evolution; ui-phase/ui-review = UI-SPEC contract / 6-pillar visual audit; undo = UPS-94; update = npm update with changelog; validate-phase = audit Nyquist validation gaps, generate missing tests, update VALIDATION.md. Workflows with no `<purpose>` line (purpose not stored): debug, forensics, graduation, import, ingest-docs (see UPS-13), onboard, milestone-summary, reapply-patches, sync-skills, thread, ultraplan-phase, add-backlog.
- Why it exists: breadth of one framework serving 16 runtimes.
- Test idea: n/a.

### UPS-64 Agent roster and what is generic
- Behavior: 35 canonical agent files plus 29 `.compact.md` siblings (no compact sibling for debugger, executor, phase-researcher, plan-checker, planner, verifier; ARCHITECTURE.md:215 says 33, the directory is larger). Frontmatter `name/description/tools/color`; roster: researchers (project, phase, ui, advisor, ai, domain), synthesizer (research, doc), planner, roadmapper, plan-checker, ui-checker, integration-checker, nyquist-auditor, executor, verifier, dom-verifier, codebase-mapper, pattern-mapper, intel-updater, debugger, debug-session-manager, code-reviewer, code-fixer, ui-auditor, security-auditor, eval-planner, eval-auditor, framework-selector, doc-classifier, doc-writer, doc-verifier, assumptions-analyzer, user-profiler, mempalace-curator. Agent tool grants are minimal (verifier: Read, Write, Bash, Grep, Glob, Skill; plan-checker has no Write; executor tools: Read, Write, Edit, Bash, Grep, Glob, Skill plus the context7 MCP globs as its only MCP access (agents/gsd-executor.md:4); browser tools confined to dom-verifier). Typical parallelism: 4 researchers, 4 mappers, executors parallel within a wave, checker loop <= 3.
- Proposal: ADOPT generic core: planner, plan-checker, executor, verifier, phase-researcher, project-researcher, research-synthesizer, roadmapper, codebase-mapper, code-reviewer, code-fixer, debugger (+ session manager already in the debug area), integration-checker (milestone). LATER: pattern-mapper, assumptions-analyzer, doc-* family, advisor-researcher. DROP: ui-*, ai-*, eval-*, framework-selector, dom-verifier, intel-updater, mempalace-curator, user-profiler, security-auditor (LATER via adapter lens), nyquist-auditor (LATER).
- Source: upstream:agents/*.md frontmatter (name/description/tools lines 1-14 of each); upstream:docs/explanation/multi-agent-orchestration.md:62-84; upstream:docs/explanation/live-dom-uat-capability.md:19-63
- Why it exists: the executor's tool surface is deliberately static: a browser MCP configured for other work must not reach it. [live-dom-uat-capability.md:25-46]
- Test idea: a lint asserts each kit agent's tool list equals its declared minimal set.

### UPS-65 `.compact.md` agent/template variants and compact_content
- Behavior: `workflow.compact_content` (default false) selects terser prompt content: Stream 1 spine+detail (spine reads its `detail/elaboration.md` unless on); Streams 1b/4 `.compact.md` siblings of lazily-read fragments/templates; Stream 2 `agents/<name>.compact.md` served only by the `agent-skills` CLI in the non-Claude persona fallback (a missing sibling is disclosed in the payload). 29 compact agent files exist; the canonical agent is what Claude Code dispatches.
- Proposal: DROP (Claude-only, named-agent dispatch; compact variants never reach Claude Code subagents).
- Source: upstream:gsd-core/references/compact-content-gate.md:1-80; upstream:docs/CONFIGURATION.md:519; upstream:agents/gsd-advisor-researcher.compact.md:1-30
- Why it exists: token budgeting for runtimes with small instruction caps (Codex 32 KiB).
- Test idea: n/a.

### UPS-66 gsd-tools: structure and verb families
- Behavior: one CLI (`gsd-tools.cjs <command> [args] [--raw] [--cwd] [--ws] [--pick field]`, 5704 lines) over `bin/lib/*.cjs` generated from 249 TypeScript modules. Verb families: `state` (load, json, get, update, patch, begin-phase, advance-plan, planned-phase, record-metric, update-progress, add-decision, add-blocker, resolve-blocker, record-session, signal-waiting/resume, validate, sync, rebuild), `phase` (next-decimal, add, insert, remove, complete, uat-passed), `phases` (list, clear), `find-phase`, `phase-plan-index`, `roadmap` (get-phase, analyze, update-plan-progress, annotate-dependencies, validate, upgrade), `requirements` (mark-complete, ready-ids, revert-phase), `milestone` (complete, archive-quick), `verify` (plan-structure, phase-completeness, references, commits, artifacts, key-links, schema-drift, codebase-drift), `verification status`, `validate` (consistency, health, agents, context), `check <gate>` modules, `frontmatter` (get/set/merge/validate), `template fill` (summary|plan|verification), `scaffold`, `init <workflow>` (compound context loaders), `config-ensure-section/-set/-get/-set-model-profile`, `resolve-model`, `resolve-execution`, `commit`, `commit-to-subrepo`, `worktree`, `planning inspect`, `smart-entry`, `progress`, `stats`, `history-digest`, `summary-extract`, `todo`, `audit-uat`, `audit-open`, `uat`, `intel`, `graphify`, `learnings`, `drift-guard`, `loop render-hooks`, `capability`, `from-gsd2`, `stamp-codebase-map`, `quick-tasks-append/-migrate`, `list-todos/-seeds`, `websearch`, `generate-slug`, `current-timestamp`.
- Proposal: CHANGE: the kit core re-implements on `ph` only the verbs the adopted workflows call: state (begin-phase, planned-phase, advance-plan, update, add-decision, add-blocker, record-session, validate/sync), phase (add, insert, remove, complete, next-decimal, uat-passed), phase-plan-index, find-phase, roadmap (analyze, get-phase, update-plan-progress, annotate-dependencies), requirements mark-complete/revert, verify (plan-structure, phase-completeness, artifacts, key-links, commits), verification status, check gates (coverage, verify-command-paths, failure-directions, evaluation-scope), frontmatter, template fill, init payload per workflow, config get/set, resolve-model, commit, milestone complete/archive. ALSO ADOPT (r1 R1-UPS-15): `verify-summary <path> [--check-count N]` (exit 0 always, trust JSON `passed`; used by new-project), `verify-path-exists`, `state-snapshot` (structured STATE parse), `select-revert-commits (--phase P | --plan NN-MM) --range R` (exact declared conventional-commit scope, used by undo, #4661), `user-story validate` (LATER with MVP), `commit-docs-guard enable|disable` (LATER), `run-with-timeout <secs> -- cmd` (exit 124 on timeout) and `normalize-test-command` (UPS-47). DROP: capability, loop render-hooks, intel, graphify, learnings, websearch, from-gsd2, profile, runtime-identity, capability, quick-tasks table verbs (unless owner wants the table), todo/seeds.
- Source: upstream:gsd-core/bin/gsd-tools.cjs:1-247; upstream:docs/CLI-TOOLS.md:1551-1580; upstream:docs/ARCHITECTURE.md:492-538
- Why it exists: centralises ~50 repeated inline bash patterns across workflows/agents. [gsd-tools.cjs:5-6]
- Test idea: every `gsd_run`-equivalent verb called by an adopted workflow resolves in the kit CLI (a port-style check, like WildEra's `port.mjs check` "unmapped gsd_run verb").

### UPS-67 CLI output contract: --raw, --pick, @file
- Behavior: `--pick a.b[-1].c` extracts one field of JSON stdout; present -> value as string, exit 0 (null or empty string is a real answer); field absent or non-object root -> empty stdout, diagnostic on stderr, exit 1 `pick_field_absent`; non-JSON output (including `--raw`) -> exit 1 `pick_output_not_json`; `--raw` and `--pick` are mutually exclusive in practice. Outputs > ~50 KB spill to a temp file returned as `@file:<path>`. Failure channels: faults on stderr exit 1; degraded results on stdout exit 0 (`GSD_EXIT_CONTRACT=v2` projects degraded to a registered non-zero code, opt-in).
- Proposal: KEEP `--pick` semantics (absence is exit 1, shell `|| default` idiom works); CHANGE spill threshold to ph's own large-output rule; DROP v1/v2 exit-contract switch (single contract in a new kit).
- Source: upstream:docs/CLI-TOOLS.md:25-69, 1145-1150; upstream:docs/CONFIGURATION.md:2286-2322
- Why it exists: #3884 an absent field printed an empty string at exit 0, indistinguishable from null. [CLI-TOOLS.md:58-60]
- Test idea: `--pick missing` exits 1 with the available keys on stderr; `--pick` of `null` prints an empty line exit 0.

### UPS-68 STATE.md document and status lifecycle
- Behavior: STATE.md = YAML frontmatter (gsd_state_version, status, milestone, progress{total_phases, completed_phases, total_plans, completed_plans, percent}, state_head sha, active_phase, next_action, next_phases, last_updated) + body (Project Reference, Current Position `Phase X of Y / Plan A of B / Status / Last activity`, Progress bar, Performance Metrics, Accumulated Context: Decisions, Pending Todos, Blockers/Concerns, Deferred Items, Session Continuity). Body is authoritative; every write re-derives frontmatter from the body. Status lifecycle: `Ready to plan` -> ... -> `All phases complete` (written by phase completion on the last phase) -> `<version> milestone complete` (terminal, only by milestone-close) -> `Awaiting next milestone`; status normalised by an exact vocabulary (no substring scan, #4186). STATE.md target < 100 lines (digest, not archive). `state advance-plan` declines with `plan_position_unreadable` plus exact lines to restore when `## Current Position` drifted to prose; `state begin-phase` starts Current Plan at the first plan without a summary on gap re-entry.
- Proposal: CHANGE: keep body-authoritative STATE.md with a small frontmatter (status, milestone, active phase, progress, last_updated, state_head) and the status lifecycle; drop nested-schema/projection tables (UPS-69). Text file inputs to `add-decision/add-blocker` (<= 256 KiB, regular files only) KEEP.
- Source: upstream:gsd-core/templates/state.md:14-100, 195-205; upstream:CONTEXT.md:134-144; upstream:docs/CLI-TOOLS.md:73-138; upstream:docs/CONFIGURATION.md:1243-1254
- Why it exists: ADR-2207 decoupled phase-level writes from milestone termination (a bare `Milestone complete` was overloaded, #2204).
- Test idea: completing the last phase writes `All phases complete`, never `Milestone complete`.

### UPS-69 STATE.md write path (lock, preservation, honest reporting)
- Behavior: every STATE.md write takes `STATE.md.lock` created with `O_EXCL`, stale after 10 s, spin-wait with jitter. A per-field classification declares how a re-derived value is reconciled with the pre-write frontmatter snapshot: `preserve-when-unchanged`, `preserve-always` (never overwrite unless the caller names the field), `preserve-if-placeholder`, `derive`; an absent snapshot is a construction failure, not a skip. Derived progress totals that are all zero/absent are an unmeasured scan and do not overwrite curated ones; the body `Progress:` line is reconciled with frontmatter `progress.percent` on every write. `updated[]` in every `state.*` result = fields whose persisted value actually changed versus the pre-write snapshot at dotted-leaf granularity (`last_updated` excluded because it changes every write; `state_head` not excluded). Exactly two direct writers bypass preservation on purpose: `state sync` (body wins) and the health `REGENERATE_STATE` factory reset. `state rebuild` re-derives Current Position and By-Phase table from disk, keeps Session/Decisions verbatim, dedups session archive (keep 3), appends a Rebuild Log; idempotent. `state_head` freshness: tri-state `commit_stale` (null unknown, false fresh, true moved); a freshness PROXY that must never gate.
- Proposal: CHANGE to a much smaller mechanism: single orchestrator writer (WildEra keeps this invariant) + the lockfile + "report what changed from a snapshot" + `state sync` rebuild from disk; DROP per-field classification tables, transaction types, rebuild log, ADR enforcement guards (over-engineered for a single-writer kit).
- Source: upstream:docs/ARCHITECTURE.md:616-645; upstream:CONTEXT.md:135-142; upstream:docs/explanation/multi-agent-orchestration.md:121-135
- Why it exists: curated `progress:` erased by unrelated verbs (#3242/#1972); `updated[]` under-reported (#3351/#3345); `Status:` swallowed the next line (#3696).
- Test idea: two concurrent `state update` calls both land; a verb that does not name `progress` leaves a curated progress block intact.

### UPS-70 Phase status ladder and disk status
- Behavior: single owner of "what state is phase P in": closed ladder NOT_STARTED, PLANNED, IN_PROGRESS, EXECUTED, NEEDS_REVIEW, COMPLETE composed from plan/summary counts, completion (`isPhaseComplete`) and verification status; display, wire (`complete|in_progress|pending`), completion (`complete|executed|incomplete`), progress and disk (`complete|executed|partial|planned|researched|discussed|empty|no_directory`) are projections. A ROADMAP checkbox is a human annotation with no authority; `roadmap analyze` derives current/next/completed from disk and reports `checkbox_conflict[]`. `find-phase` returns live `plan_count`/`summary_count` (superseded plans excluded) and physical `plan_count_all`; all three `null` when the phase cannot be resolved (never 0).
- Proposal: KEEP ladder + projections as one function in ph; KEEP checkbox-has-no-authority; KEEP null-not-zero.
- Source: upstream:CONTEXT.md:33-36; upstream:docs/CLI-TOOLS.md:224-245, 457-488
- Why it exists: three hand-rolled ladders disagreed, one reported a stale-but-passed phase as Complete (ADR-5057).
- Test idea: a passed report older than a source change reads EXECUTED/NEEDS_REVIEW, not COMPLETE.

### UPS-71 Scope tri-state and withheld percentages
- Behavior: every derived `.planning/` answer carries `scope` COMPLETE | TRUNCATED | UNSCOPED | UNREADABLE; COMPLETE with zero items is a real answer, the other three with zero items are non-answers. When scope != complete, percentages (`roadmap analyze progress_percent`, `stats percent`, `progress percent`, `state json progress.percent`) are `null`/omitted and `state update-progress` writes nothing (stderr WARNING); `progress_scope` governs the percentage separately from the roadmap window `scope`. Milestone identity (version/name) comes from STATE `milestone:` first, heading heuristics second, and is reported absent rather than invented.
- Proposal: KEEP the principle (never fabricate 0/100/version); implement as a small `scope` field on a few verbs (roadmap analyze, progress, phases list).
- Source: upstream:docs/CLI-TOOLS.md:490-585; upstream:CONTEXT.md:183
- Why it exists: a truncated milestone window returned `phase_count: 0` indistinguishable from a new milestone (#3180); `milestone complete` would have archived every phase dir.
- Test idea: ROADMAP with a closed-milestone heading before the phases yields scope `truncated` and a null percent.

### UPS-72 Verification status: closed enum and one routing table
- Behavior: `verification status <phase-dir>` reads `*-VERIFICATION.md` frontmatter and returns `status` in `passed | gaps_found | human_needed | stale | missing | unparseable | phase_dir_not_found` plus `next_action`, `next_command`, bare `route` (`""` | plan-phase --gaps | verify-work | execute-phase) from one table. `stale` = covered input fingerprint no longer current (also v1/v2 reports missing current plan/summary in `covered_files`); a report may only carry `passed|gaps_found|human_needed`; any other value (`verified`, `Passed`, `stale`, numbers) fails every reader with `verification_status_invalid` (stdout empty, names file, quoted value, accepted values); no case folding; writers validate every report BEFORE their first write; recovery: fix `status:` or delete the report. Reports and UAT files must resolve inside the phase directory (symlink escape reads as missing). `unknown` no longer exists.
- Proposal: KEEP (WildEra ported `verification.status`, `verification.fingerprint`, and added consistency checks: status vs gaps/human lists, fingerprint required).
- Source: upstream:docs/CLI-TOOLS.md:903-929; wildera:.agents/skills/gsd-plan/references/compatibility.md:63
- Why it exists: #5118 every workflow re-read the report and invented its own status words; #4682 stale verification.
- Test idea: `status: Passed` fails with `verification_status_invalid`; a covered file changed after the verifier ran reads `stale` and routes to execute-phase.

### UPS-73 Gate verdicts, evidence and exit codes ("could not look" is not pass)
- Behavior: every `check <gate>` returns `{outcome, block, payload}` or a usage failure; evidence is found | none | unreadable (never coerced to ''/false/[]); `unreadable` -> exit 69 UNAVAILABLE in both modes. Payload-mode gates deliver the verdict on stdout `.block` and exit 0 even when blocking (non-zero means could not run); status-mode verbs (`phase uat-passed`, `verify artifacts|plan-structure|phase-completeness|references|commits|key-links`) exit 0 positive, 1 negative, 66 NO_INPUT (declared scope empty), 69 UNAVAILABLE. Callers capture status under `set -e` (`X=$(cmd) && EXIT=0 || EXIT=$?`) and split four ways: `0` = delivered verdict (payload mode includes a blocking `.block`); `1` with JSON on stdout = negative verdict; `1` with EMPTY stdout = usage/`error()` failure (could not run); `66` = the evidence was read and the declared scope is genuinely empty (NOT unavailable, status mode only); `69` and any other code = could not look / could not run (the call site decides: plan-phase stops, safe-resume exits 1, see UPS-41). (r1 R1-UPS-01) Gate config read only from nested `workflow.*` (quiet, `GSD_WORKSTREAM` aware); malformed config = absent key. `verify key-links` confines `from/to` to the project dir (`path_rejected`), a rejected link fails independently.
- Proposal: KEEP the 0/1/66/69 convention and the found/none/unreadable evidence type in the kit's check library; DROP the typed-module/ESLint boundaries (ADR-5057) as process.
- Source: upstream:docs/CLI-TOOLS.md:843-863; upstream:CONTEXT.md:39-66; upstream:docs/ARCHITECTURE.md:323-341
- Why it exists: #5170 gates read "could not look" as "nothing there" and passed over unseen content.
- Test idea: a gate pointed at an unreadable directory exits 69, never 0.

### UPS-74 Evaluation-scope resolver (which commits/files a gate evaluates)
- Behavior: `check evaluation-scope (--phase P [--since sha] | --plan P-NN | --quick id) [--commits-only --max-commits N --milestone-bound --pathspec g --include-files]` returns status resolved | degraded | unresolvable, source task-commits | plan-subjects | quick-subjects | phase-range | none, commits, changedFiles/files/missingOnDisk, `outsideUnion`, `unreachable`, `rangeBase`. Scope = UNION of the unit's own commits (phase: the `## Task Commits` backtick-anchored sha rows of its SUMMARYs; plan: commit subject `<type>(<phase>-<plan>):` anchored, zero-pad and decimal tolerant, `03-01` never matches `03-010`; merge commits diff against first parent), only commits reachable from the evaluated ref, never `git log --all`, `HEAD~N` or a range. For a PHASE, an empty union (no SUMMARY, no task rows, no reachable task commits, planning paths only) degrades to the phase-directory range and says so (`degraded` + reason); for a PLAN or QUICK unit that matches nothing the answer is `resolved` with `reason: no-matching-commits` (or `empty-after-exclusions` when its commits touched only excluded paths) and the verb reports it as `advisory`, never `pass` and never a phase-range fallback; unreadable repo/phase or a git timeout is `unresolvable` (files empty, "could not look"). (r1 R1-UPS-02; upstream:docs/ARCHITECTURE.md:351, 363) Every git call bounded. It is a resolver, never a policy (`block:false`).
- Proposal: KEEP (kit commit convention must keep `type(phase-plan):` subjects; with one commit per wave, CHANGE task-commit rows to wave commits); WildEra evidence per wave replaces task commits.
- Source: upstream:docs/ARCHITECTURE.md:343-379; upstream:CONTEXT.md:45-48; wildera:.agents/skills/gsd-plan/references/compatibility.md:29
- Why it exists: a range held 23/194/602 files where the union held 9/42/69 (9,676-commit repo).
- Test idea: an interleaved unrelated commit between two phase commits is not in scope.

### UPS-75 ROADMAP.md and REQUIREMENTS.md grammar
- Behavior: ROADMAP: `## Phases` checklist `- [ ] **Phase N: Name** - desc`; `### Phase N: Name` detail with `**Goal**:`, `**Depends on**:`, `**Requirements**:`, `**Success Criteria**` (numbered observable truths), `**Plans**:` and a `Plans:` checklist `- [ ] NN-MM:`; decimal phases marked `(INSERTED)`; `## Progress` table `| Phase | Plans Complete | Status | Completed |` (statuses Not started | In progress | Complete | Deferred); completed milestones collapsed in `<details>`; continuous numbering. `**Requirements**:` line: comma list of `PREFIX-N` (brackets optional, case-insensitive, split on commas and whitespace), no range expansion, `TBD`/`None` are the declared-empty tokens; other empty wording warns with kinds `req-line-misparse` (`;`/`:`/invisible glued to an ID), `req-line-range-reading`, `req-line-unverified` (token > 2048 chars). `requirements mark-complete` accepts `REQ-01,REQ-02`, space list or `[..]`. REQUIREMENTS: v1 checkboxes `- [ ] **CAT-NN**: ...`, v2, Out of Scope table, Traceability table `| Requirement | Phase | Status |` (Pending | In Progress | Complete | Blocked) with coverage counts; each v1 requirement maps to exactly one phase. `roadmap update-plan-progress` declines with `missing_phase_details` and leaves the file byte-identical when no writable entry exists.
- Proposal: ADOPT (WildEra uses `**Requirements:**` with spec rule IDs `<SPEC-ID>:<rule>` instead of free-form `AUTH-01`: keep the REQ-ID shape configurable); KEEP the warn-not-silently-drop rule for the Requirements line.
- Source: upstream:gsd-core/templates/roadmap.md:14-134; upstream:gsd-core/templates/requirements.md:13-130; upstream:docs/CLI-TOOLS.md:304-432, 451-455; wildera:.agents/skills/gsd-plan/SKILL.md:21-22
- Why it exists: `phase complete` reported `requirements_updated: true` while silently under-selecting IDs (#3697).
- Test idea: `**Requirements**: REQ-01; REQ-02` produces a warning naming the dropped ID.

### UPS-76 PLAN.md, SUMMARY.md and VERIFICATION.md formats
- Behavior: PLAN frontmatter `phase, plan, type (execute|tdd), wave (precomputed), depends_on, files_modified, files_deleted (optional; exact paths, lets cleanup-wave merge a deleting branch), coupling_justified (optional "plan-id: reason" strings exempting same-wave coupling advisory), autonomous, requirements (REQUIRED, non-empty), user_setup, must_haves {truths[], artifacts[{path, provides, min_lines, exports, contains}], key_links[{from, to, via, pattern}]}`; body XML: `<objective>`, `<execution_context>`, `<context>`, `<tasks>` with `<task type="auto|checkpoint:*">` (`<name>`, `<files>`, `<read_first>`, `<action>`, `<verify>`, `<acceptance_criteria>`, `<done>`), `<verification>`, `<success_criteria>`, `<output>`. Plan sizing 2-3 tasks, ~50% context; vertical slices over horizontal layers; do not reflexively chain `depends_on`/SUMMARY refs. SUMMARY frontmatter carries `key-files.created/modified`, `commits`, `plan_head_before/after`, `status: complete`, optional `coverage:` block; `## Task Commits` rows. `user_setup` holds only what the agent cannot do (accounts, secrets, dashboards). `verify plan-structure` flags `! grep -q 'LIT' f` negative gates whose literal also appears in the action.
- Proposal: ADOPT (WildEra adds `owns` and rejects `type: tdd`).
- Source: upstream:gsd-core/templates/phase-prompt.md:14-156, 252-290, 520-616; upstream:docs/CLI-TOOLS.md:272-302, 863; wildera:.agents/skills/gsd-plan/references/compatibility.md:64
- Why it exists: goal-backward verification needs `must_haves`; task completion is not goal achievement. [phase-prompt.md:604-607]
- Test idea: a plan without `requirements` fails `verify plan-structure`.

### UPS-77 Config: schema, loader, defaults, errors
- Behavior: `.planning/config.json` keys (mode, granularity, model_profile, model_overrides, agent_tools, models, dynamic_routing, planning{commit_docs, search_gitignored, sub_repos, pr_strict, chunked_parallel}, planner{stall_*}, workflow{research, plan_check, verifier, auto_advance, nyquist_validation, ui_*, node_repair(_budget), research_before_questions, discuss_mode, max_discuss_passes, skip_discuss, human_verify_mode, tdd_mode, text_mode, use_worktrees, code_review*, plan_bounce*, plan_chunked, cross_ai_*, test_gate_timeout, security_*, post_planning_gaps, build_command, test_command, context_coverage_gate, context_guard_mode, drift_*, pattern_mapper, subagent_timeout, smart_zone_tokens ...}, executor{stall_*}, parallelization{enabled, plan_level, task_level, skip_checkpoints, max_concurrent_agents (3), min_plans_for_parallel (2)}, git{branching_strategy, base_branch, protected_branches, create_tag, *_branch_template}, gates{execute_next_plan, confirm_transition, confirm_milestone_scope}, security, hooks, review, ship, project_code, agent_skills, response_language, context_window (200000), context_profile, claude_md_path). Loader: defaults merged under parsed config; legacy keys (`depth`->granularity) normalised and WRITTEN BACK on ordinary reads unless `persist:false`; non-object destination sections block their own migration; invalid JSON or unreadable file = built-in defaults + warning once per file ("settings were NOT applied"); precedence project > `$GSD_HOME/.gsd/defaults.json`; `config-set` rejects unknown keys (dynamic key patterns allowed: `agent_skills.<type>`, `phase_commit_docs.<id>`, `models.<phase_type>`); API keys masked `****<last4>` in output; `gates.*` apply only in interactive mode (yolo auto-approves).
- Proposal: CHANGE: kit config = a small typed schema covering the adopted keys (mode, granularity, workflow toggles, planning.commit_docs, parallelization, git.*, gates, plan review/coverage gate toggles, build/test commands owned by the project adapter, models per role); KEEP warn-when-config-unreadable, absent=default, reject unknown keys on set, no write-back on read; DROP legacy-key migration, federated capability slices, secrets for search APIs, claude_md_path.
- Source: upstream:docs/CONFIGURATION.md:13-140, 144-164, 219-262, 492-557, 660-668, 1227-1239, 1258-1269, 1353-1364; upstream:CONTEXT.md:180, 331; upstream:docs/CLI-TOOLS.md:1596-1598
- Why it exists: #1880 a trailing comma silently replaced the user's whole config; reads that write are surprising (#3648).
- Test idea: invalid JSON config prints the NOT applied warning once and uses defaults.

### UPS-78 Model profiles and resolution chain
- Behavior: profiles `quality | balanced | budget | adaptive | inherit`; per-agent tier table (e.g. planner Opus/Opus/Sonnet/Opus; executor Opus/Sonnet/Sonnet/Sonnet; verifier Sonnet/Sonnet/Haiku/Sonnet; codebase-mapper Sonnet/Haiku/Haiku/Haiku; checkers Sonnet/Sonnet/Haiku/Haiku; `inherit` = session model); adaptive maps agent default tiers heavy/standard/light to opus/sonnet/haiku (light: mapper, checkers, synthesizer, intel; standard: executor, researchers, verifier, reviewer, fixer; heavy: planner, roadmapper, debugger, assumptions-analyzer, security-auditor). Resolution precedence (high to low): `model_overrides[agent]` (full ids accepted) > `dynamic_routing.tier_models[tier]` (when enabled) > `models[phase_type]` (planning/discuss/research/execution/verification/completion; tier aliases only) > `model_profile` column > runtime default. `resolve-model <agent>` returns model id (empty/`inherit` => caller omits the `model=` parameter, #2517) plus `tier` ("unknown"/"inherit" mean cannot tell, never adequate); `resolve-execution` adds effort and fast_mode. Resolution once per orchestration, not per spawn; `config-set-model-profile` is programmatic.
- Proposal: CHANGE: kit core models role -> model through the project adapter ("models per role") with the same precedence idea: per-role override > per-phase-type > profile > default; tiers map to Paseo `circle/...` ids (e.g. `circle/gpt-6.1-sol[1m]`); keep "empty/inherit means omit the parameter". DROP runtime tier maps for non-Claude runtimes, `resolve_model_ids`, Codex effort tables.
- Source: upstream:docs/CONFIGURATION.md:1543-1598, 1600-1682, 1684-1735, 2006-2030; upstream:docs/CLI-TOOLS.md:802-812; upstream:docs/features/model-profiles.md:1-40; upstream:docs/features/per-phase-type-model-selection.md:1-40; upstream:CONTEXT.md:344-348
- Why it exists: cost control per role; non-Anthropic providers need `inherit` to avoid unexpected costs (REQ-MODEL-04a). [upstream:docs/features/model-profiles.md:16]
- Test idea: a per-role override beats the phase-type default; `inherit` produces no model parameter in the spawn call.

### UPS-79 Dynamic routing with failure-tier escalation, provider escalation
- Behavior: `dynamic_routing.enabled` (default false): first attempt at `tier_models[default_tier]`; an orchestrator-detected SOFT failure (verification inconclusive, plan-check FLAG) re-spawns at the next tier up (light -> standard -> heavy, capped by `max_escalations` default 1, `escalate_on_failure` kill-switch); hard failures (exception/crash) bypass escalation; `provider_escalation` is a separate ordered fallback model-id list used only for quota/rate-limit deaths.
- Proposal: LATER (cost lever) - keep the soft-vs-hard distinction when built.
- Source: upstream:docs/CONFIGURATION.md:1684-1796
- Why it exists: pay the strong tier only for hard cases; a heavier tier on a throttled account is still throttled. [CONFIGURATION.md:1755-1757]
- Test idea: n/a (LATER).

### UPS-80 Runtime tier maps, model_policy, effort, fast mode
- Behavior: built-in tier maps per runtime (claude, codex gpt-5.6-sol/terra/luna, qwen, opencode, copilot, hermes, kilo, pi; others null), `model_profile_overrides.<runtime>.<tier>`, `model_policy` provider presets (openai, anthropic, anthropic-fable, google, qwen, generic) with budget high/medium/low, `reasoning_effort` forwarded only to runtimes that support it, effort control and fast mode (`workflow` keys, `effort` sync into agent frontmatter), `resolve_model_ids` false|true|"omit", `runtime` precedence GSD_RUNTIME > config.runtime > install marker > claude.
- Proposal: DROP (multi-runtime); the equivalent in the kit is the per-role `circle` model/effort pair in the adapter.
- Source: upstream:docs/CONFIGURATION.md:2032-2268; upstream:CONTEXT.md:68, 347-350
- Why it exists: one config across 16 runtimes.
- Test idea: n/a.

### UPS-81 Planning commit gate (`commit_docs`) and `commit` semantics
- Behavior: `commit_docs` resolves: explicit value (top-level or `planning.commit_docs`) > auto false when `.planning/` is gitignored > default true; per-phase override `phase_commit_docs.<phase-id>`. `commit <msg> --files ...` is the ONLY sanctioned writer; skip envelope `{committed:false, skipped:true, hash:null, reason}` with reason `skipped_commit_docs_false | skipped_gitignored | skipped_commit_docs_phase_false` (additive-only contract agents pattern-match on). Every shipped `commit` declares `--files`; `--files` runs `git add` per file (skips missing); `--files-removed` stages declared deletions (absent tracked file; unmerged/skip-worktree/gitlink entries never staged); `--respect-staged` commits only the existing index within the pathspec; `--no-verify` only for parallel executors; `commit-docs-guard enable|disable` installs an opt-in pre-commit hook (marker line, refuses foreign hooks and `core.hooksPath`). `planning.pr_strict` + `pr-branch` filter keeps `.planning/` out of PR branches (PLANNING_DELETIONS must be 0).
- Proposal: KEEP envelope semantics and `--files` requirement in `ph commit`; KEEP `commit_docs` on/off; LATER pr_strict/pr-branch and the hook installer.
- Source: upstream:CONTEXT.md:335-341; upstream:docs/CLI-TOOLS.md:1354-1361; upstream:docs/CONFIGURATION.md:660-668
- Why it exists: #3678 agents improvised raw git when a skip was not a first-class result; #2971 filter step contradicted its own verification.
- Test idea: with `commit_docs:false`, `ph commit` returns the skipped envelope with reason and exit 0.

### UPS-82 Planning snapshot and `state.json` contract
- Behavior: `planning inspect` (no arguments; strays are usage errors) emits `schema_version: 1` JSON with always-present keys (generated_from, milestone, active{phase, plan, status}, phases[] with verification/roadmap_acceptance/uat side by side, orphan_phase_dirs, requirements[], progress{accepted_phases, completed_plans}, diagnostics[]); unknown = null/"unknown" plus a coded diagnostic; task file provenance task_scoped|plan_scoped|absent, conflicting lists emitted verbatim; consumers must reject a different `schema_version`. A separate push artifact `.planning/state.json` (`contract` semver 1.0.0, flavor, milestone, phases[{number string, name, status complete|in_progress|pending}], next, updated_at) is written best-effort at each step boundary and never affects exit code or stdout.
- Proposal: LATER (UI/dashboards); KEEP the null-not-guess rule and the best-effort invisible publish if the kit adds a status file.
- Source: upstream:docs/CLI-TOOLS.md:960-1052; upstream:docs/features/machine-readable-state-contract-planningstatejson.md:1-30
- Why it exists: external tools parsed STATE/ROADMAP heuristically and drifted.
- Test idea: n/a (LATER).

### UPS-83 Health and consistency validation
- Behavior: `validate consistency` (phase numbering gaps C001-C004, ROADMAP vs disk W006/W007, orphan SUMMARYs, plans missing `wave`); `validate health [--repair]` coded diagnostics `{code, message, fix, repairable}` (E/W codes incl. W024 state_head freshness, W030 verification_status_invalid, W025 worktree config), repair can regenerate STATE (factory reset); `validate context` utilisation ok/warn/critical at 60/70%; `state validate [--strict]` detects drift vs filesystem and unparsable `Last activity`.
- Proposal: ADOPT a trimmed `ph doctor planning` (consistency + health codes for adopted files; `--repair` only for STATE).
- Source: upstream:docs/CLI-TOOLS.md:933-956; upstream:docs/features/statemd-consistency-gates.md:1-27
- Why it exists: stale STATE.md cascades errors.
- Test idea: ROADMAP phase without a directory reports a coded warning.

### UPS-84 Executor safety hooks and context monitor (cross-area)
- Behavior: hooks (Claude Code): statusline; `gsd-context-monitor` (PostToolUse, warn at <= 35% remaining, critical <= 25%, 5-tool-use debounce, escalation bypasses debounce, ignores metrics older than 60 s, advisory only; `hooks.context_warning_threshold` config); prompt guard (writes under `.planning/`), read-injection scanner (Read/WebFetch/WebSearch; blocks only HIGH and only with `security.injection_blocking`), workflow guard (opt-in), secret-read guard (hard-blocks `.env*` reads), read-before-edit guard, worktree path guard, validate-commit (conventional commits), phase-boundary, session state; every hook terminates through `allow/deny/crash` with a declared ON_CRASH policy; all wrapped in try/catch and exit silently, 3 s stdin timeout.
- Proposal: CHANGE: owned by the hooks area; adopt the policy ideas (declared crash policy, advisory vs blocking, stale-metrics ignore); the kit's context guard replaces gsd-context-monitor.
- Source: upstream:docs/ARCHITECTURE.md:283-315, 956-1031
- Why it exists: unobservable fail-open/fail-closed stance made hook failures ambiguous (ADR-3889).
- Test idea: a crashing hook with ON_CRASH=ALLOW exits 0, with DENY exits 2.

### UPS-85 Workstreams, workspaces, multi-repo
- Behavior: `.planning/workstreams/<name>/` isolated state (names alphanumeric+hyphen, no traversal), `--ws`/`GSD_WORKSTREAM` active pointer, subcommands list/create/switch/status/progress/complete/resume; `new-workspace` creates `~/gsd-workspaces/...` with worktree/clone copies and independent `.planning/`; `planning.sub_repos` + project-root walk-up (<= 10 levels, never above $HOME); executor records per-repo commit hashes.
- Proposal: LATER (parallel milestones); DROP for core.
- Source: upstream:docs/features/workstream-namespacing.md:1-24; upstream:docs/features/multi-repo-workspace-support.md:1-14; upstream:docs/CONFIGURATION.md:710-719
- Why it exists: concurrent lines of work.
- Test idea: n/a.

### UPS-86 Embeddable Orchestration System, capabilities, Claude Workflow-tool capability, installer
- Behavior: EoS = versioned host-integration interface (6 interface points, 8 negotiated axes, PROTOCOL_VERSION handshake, `undocumented` fail-closed sentinel) for 16 runtimes; capability system = manifests with loop extension points, trust/consent ledger, first-party-wins overlay; `claude-orchestration` capability (default off, Claude-only) emits a Workflow-tool script (wave = parallel stage, plan = agent with worktree isolation) gated by `enabled`, runtime, `execution_backend`, host `dispatch.nested+background`, Agent SDK >= 0.3.149; installer (`bin/install.js`, ~10.7k lines) deploys commands/skills/agents/hooks per runtime with manifests, migrations and path rewriting.
- Proposal: DROP all (owner decisions: Claude Code only, Paseo runtime, native Workflow tool denied on the main provider, no installer). The wave-to-parallel-stage mapping and fail-closed gating idea are covered by `ph` workflows.
- Source: upstream:docs/explanation/embeddable-orchestration-system.md:13-135; upstream:docs/explanation/claude-orchestration-capability.md:29-97; upstream:docs/ARCHITECTURE.md:871-921, 1035-1138
- Why it exists: scaling one engine across many hosts. [embeddable-orchestration-system.md:157-175]
- Test idea: n/a.

### UPS-87 What the WildEra port took, changed and added
- Behavior: vendored verbatim (never edited, sha256 pinned in UPSTREAM.json): agents planner, plan-checker, verifier, executor, phase-researcher, debugger, debug-session-manager; workflows debug, forensics, plan-phase (+steps/detail), execute-phase (+steps), execute-plan, discuss-phase (+modes/templates), plan-review-convergence, review, quick-batch (+steps); ~110 references; templates (all); contexts; the research capability fragment; 3 explanation docs. `tools/gsd/port.mjs` generates agents/`generated/` with path rewrites + adapter front matter; `check` fails on edited snapshot, stale generated files, dangling references or unmapped `gsd_run` verbs; runtime = Paseo workflow scripts (`gsd-research.js`, `gsd-plan.js`, `gsd-verify.js`, `gsd-debug.js`) + `tools/gsd/gsd.mjs` (ported verbs, same names). Kept: discuss, research, chunked planning, checker loop (<=3), coverage gates, waves, executor deviation rules, tracer-first, goal-backward verification, gap closure, human_needed never done. Departures: orchestrator-only commits (one per wave), verify commands run by the Verify stage not the coder, no worktrees (disjoint `owns`), no TDD plans, agents return markers and workflows stop `needs-owner`, single STATE/ROADMAP/REQUIREMENTS writer, planning docs not committed by default, superseded plans moved not deleted, at most one gap-fix wave. Added: outline manifest + `outline check`, wiring contract, skeleton review gate (<=3 passes), `revisions.json` input-digest invalidation, attempt records, verification report consistency. Not ported: new-project, map-codebase, spec-phase, verify-work (partly in gsd-verify), ship, progress/next, autonomous, code-review, quick, milestones, estimation/calibration, graphify/intel/learnings, capability framework, MVP, UI/AI gates, plan bounce, cross-AI.
- Proposal: OPEN (revised r1) - whether the new kit vendors upstream GSD text as WildEra did is an owner decision not yet made. Option A: vendor a pinned verbatim snapshot (sha256 manifest) plus generated adapters and a `check` that fails on drift/unmapped verbs. Option B: write the kit's GSD core from scratch from this spec (no upstream text copied), keeping only the `check` idea as a kit test over the kit's own contracts/adapters. Not forbidden either way. Independent of the choice: the generic parts of the departures table become kit defaults, the Unreal-specific ones (build mutex, `owns`) stay in the adapter.
- Source: wildera:.agents/skills/gsd-plan/upstream/UPSTREAM.json:1-263; wildera:.agents/skills/gsd-plan/NOTICE.md:1-13; wildera:.agents/skills/gsd-plan/references/compatibility.md:5-66; wildera:.agents/skills/gsd-plan/SKILL.md:14-85
- Why it exists: reuse upstream method, keep harness rules (owner confirmed 2026-10-18).
- Test idea: `port check` equivalent fails when a vendored file's sha256 differs from the manifest.

### UPS-88 Specless edge/prohibition probe fallback (core plan-phase step 7.95)
- Behavior: when the phase SPEC did not supply `## Edge Coverage` and/or `## Prohibitions`, plan-phase itself (not spec-phase) runs `references/specless-probe-fallback.md` between the SPEC resolution (step 7) and the planner spawn (step 8): a default-ON toggle with per-section absence detection (`spec-section` helper), a VISIBLE skip when disabled or when there are no requirement IDs (the disabled reason is recorded in the plan, never silent), a deterministic edge probe producing `$COVERAGE` when edges are absent, and prohibition recall left to the planner. `$COVERAGE` and `$SPECLESS_FALLBACK_DISABLED` are passed into the planner prompt; the planner lifts resolved edges into `must_haves.truths` (backstop edges as `{statement, verification: backstop}`) and authors recalled prohibitions descriptor-less into `must_haves.prohibitions`, never auto-dismissing; a SPEC-supplied section is never re-run. The spine calls this core workflow substrate, not a capability rail.
- Proposal: ADOPT a prompt-only version (planner lists edge cases and must-NOT items into `must_haves`, skip is visible); LATER the compiled edge engine; SPEC-lift variant stays LATER with spec-phase (UPS-14).
- Source: upstream:gsd-core/workflows/plan-phase.md:733-743, 880-893, 897-905
- Why it exists: edge cases and must-NOT constraints were silently dropped when no spec phase ran (#1110 family). [plan-phase.md:735-738]
- Test idea: with no SPEC, the planner prompt contains the coverage/probe block or a recorded skip reason, never neither.

### UPS-89 Executor deviation rules (gsd-executor contract)
- Behavior: while executing a task the executor applies, without asking: RULE 1 auto-fix bugs (broken behavior, wrong queries, logic/type errors, validation, security holes, races); RULE 2 auto-add missing critical functionality (error handling, input validation, authz, CSRF/CORS, rate limiting, indexes, logging; plan `<threat_model>` `mitigate` dispositions for this task's files are correctness requirements); RULE 3 auto-fix blocking issues (wrong types, broken imports, missing env var, build config, missing referenced file, circular dependency). EXCLUDED from Rule 3: package-manager installs (`npm install`, `pip install`, `cargo add`, equivalents): on failure do NOT install a similarly named alternative, do NOT retry another name, return `<task type="checkpoint:human-verify" gate="blocking-human">` ("Package install failed - human verification required") which auto-mode never approves. RULE 4: architectural change (new table, schema change, new service layer, library/framework switch, auth approach, infrastructure, breaking API) = STOP and return a checkpoint with what was found, proposed change, why, impact, alternatives. Priority: Rule 4 first; genuinely unsure = Rule 4; "affects correctness, security or ability to complete the task?" yes = Rules 1-3, maybe = Rule 4. Scope boundary: only auto-fix issues DIRECTLY caused by the current task; pre-existing warnings/lint/unrelated failures are logged to `deferred-items.md` in the phase directory and not fixed; do not re-run builds hoping they resolve. Attempt cap: after 3 auto-fix attempts on one task stop fixing, record "Deferred Issues" in SUMMARY.md and continue (or return a checkpoint if blocked). Shared process: fix inline, add/update tests, verify, continue, track as `[Rule N - Type] description`.
- Proposal: ADOPT (core executor contract; WildEra maps Rule 4 to "status partial, decision in notes, orchestrator escalates"); keep the install exclusion even though the registry gate is LATER.
- Source: upstream:agents/gsd-executor.md:181-273; upstream:docs/explanation/security-model.md:76-79; wildera:.agents/skills/gsd-plan/references/compatibility.md:19, 49
- Why it exists: a failed install may be a slopsquatted or hallucinated name; auto-substituting could install something more dangerous. [gsd-executor.md:219]
- Test idea: a worker prompt contains all four rules; a simulated failed `npm install foo` yields a blocking-human checkpoint, not a different install.

### UPS-90 Parallelization switches and checkpoint skipping
- Behavior: config `parallelization.enabled` (true), `plan_level` (true), `task_level` (false: parallel tasks within a plan), `skip_checkpoints` (true: "skip checkpoints during parallel execution"), `max_concurrent_agents` (3), `min_plans_for_parallel` (2); `parallelization false` is shorthand for `enabled: false` (disables parallel execution without changing other sub-keys); with parallelization on, executors commit with `--no-verify` and the orchestrator validates hooks once per wave, STATE.md writes are lock-protected; to run hooks per commit set `parallelization.enabled: false`. The exact runtime effect of `skip_checkpoints` is not specified in the sources read (the execute-phase spine routes checkpoint plans with `autonomous:false` between waves, UPS-49).
- Proposal: KEEP the keys and defaults; CHANGE semantics to the kit's rule: plans that need an owner decision always stop with `needs-owner` regardless of `skip_checkpoints` (OPEN: confirm). 
- Source: upstream:gsd-core/templates/config.json:35-41; upstream:docs/CONFIGURATION.md:1227-1239; upstream:docs/features/phase-execution.md:1-45
- Why it exists: build-lock contention between parallel agents. [CONFIGURATION.md:1239]
- Test idea: `parallelization false` leaves other sub-keys untouched and forces sequential plans per wave.

### UPS-91 execute-phase blocking-handoff gate and --interactive mode
- Behavior: first, before any other work, a `.continue-here.md` in the PHASE directory (distinct from `.planning/.continue-here.md` checked by next/UPS-60) is parsed for "Critical Anti-Patterns" rows with severity `blocking`; each one must be answered inline with three answers (what is it, how it manifested, what structural mechanism - not acknowledgment - prevents it) or the run stops and asks the user; no file or no blocking rows = proceed. `--interactive`: plans run sequentially INLINE (no executor spawn, wave grouping ignored, `execute-plan.md` read directly); once per plan (not per task) a 4-option menu (execute / review-first / skip / stop) is shown, then tasks run one at a time with only a brief pause; after all plans, verification proceeds normally.
- Proposal: KEEP the blocking-anti-pattern gate (cheap handoff safety, also in discuss UPS-15); LATER `--interactive`.
- Source: upstream:gsd-core/workflows/execute-phase.md:266-294; upstream:gsd-core/workflows/discuss-phase.md:164-183
- Why it exists: a recorded anti-pattern must be prevented structurally, not merely acknowledged. [execute-phase.md:283]
- Test idea: a phase `.continue-here.md` with a blocking row stops the run until three answers are written.

### UPS-92 assumption_delta and api_coverage_gate (default-on planning gates)
- Behavior: `workflow.assumption_delta` (default true): advisory, non-blocking planning checkpoint that fires only on a detected signal - a phase making something plural, optional or chosen that was singular, required or derived (second auth method, required field becoming optional, constant becoming a parameter) - prompting the planner to re-ask whether the primary key/identity model still names the right thing; bare "or" excluded; `query assumption-delta scan <phase>`; an unresolvable phase section returns `{"skipped":true,"reason":"phase_unresolved"}` rather than a fabricated `detected:false` (#3909). `workflow.api_coverage_gate` (default true): a phase that integrates an external API/SDK/service must produce a `COVERAGE.md` matrix (full coverage by default, every opt-out reasoned) at plan:pre; verify:pre fails the seal unless the matrix is complete; a phase whose scope cannot be established (no plan body and no roadmap section) is HELD with `scope_unavailable`, never passed (#1562, #3909).
- Proposal: LATER; when built keep the fail-closed `phase_unresolved` / `scope_unavailable` rule.
- Source: upstream:docs/CONFIGURATION.md:505, 541
- Why it exists: #3909 "nothing to report" must not look like "could not look".
- Test idea: an unresolvable phase returns skipped with reason, not detected:false.

### UPS-93 Package legitimacy thresholds (rebuildable spec for the LATER gate)
- Behavior: research runs `package-legitimacy check --ecosystem npm|pypi|crates <pkgs>` against live registry APIs; verdict OK|SUS|SLOP from `{ minAgeDays: 30, minWeeklyDownloads: 1000, requireRepo: true }` plus terminal short-circuits for non-existence and a suspicious `postinstall`; results in a `## Package Legitimacy Audit` table; `[SLOP]` packages are stripped from RESEARCH.md before it is saved; `[SUS]` (new, low downloads, no repo, name near a popular package) and `[ASSUMED]` (any name sourced from WebSearch, even if `npm view` succeeds) make the planner insert a `checkpoint:human-verify` before the install task with the registry link and checks (maintainer history, issue activity, install scripts); each registry adapter has a 5-second timeout and returns all-null signals on failure (`unknown-age` / `unknown-downloads`) which push to `[SUS]` (fail toward human review); `slopcheck` is an optional escalate-only adapter. A `T-{phase}-SC` STRIDE supply-chain row is added to install-bearing plans.
- Proposal: LATER (UPS-20 defers it deliberately).
- Source: upstream:docs/explanation/security-model.md:52-79, 104-110; upstream:docs/ARCHITECTURE.md:981-999
- Why it exists: slopsquatting. [ARCHITECTURE.md:985]
- Test idea: a registry timeout yields SUS with `unknown-age`, never OK and never a thrown error.

### UPS-94 undo (safe revert)
- Behavior: modes `--last N` (default 10; show last N GSD commits for interactive selection), `--phase NN` (revert all commits for the phase), `--plan NN-MM`; uses `git revert --no-commit`, NEVER `git reset`, to preserve history; commits selected within the phase directory's own commit window (`select-revert-commits (--phase P | --plan NN-MM) --range R` matches the exact DECLARED conventional-commit scope; phase mode also accepts NN-MM-scoped commits); dependency check for dependent phases/plans and a hard confirmation gate before any revert; no/invalid argument prints usage and exits.
- Proposal: ADOPT as `ph undo` (WildEra needs commit-per-wave scope instead of per-task).
- Source: upstream:gsd-core/workflows/undo.md:1-47; upstream:gsd-core/bin/gsd-tools.cjs:11-18; upstream:docs/features/safe-undo.md:1-16
- Why it exists: roll back without losing history (#4661 exact scope selection).
- Test idea: `undo --plan 03-02` never matches `03-020`-scoped commits and leaves history intact.

## Invariants and lessons

- Orchestrator is the single writer of STATE.md/ROADMAP.md/REQUIREMENTS.md while workers run in parallel; workers write only their own SUMMARY (plus code). Upstream: executors in worktrees skip shared files and the orchestrator updates them after merge (#2070, last-merge-wins overwrites). [upstream:gsd-core/workflows/execute-phase.md:701-713, 943-973; wildera:.agents/skills/gsd-plan/references/compatibility.md:41]
- "Could not look" is never "pass": gates exit 69 not 0, evidence is found/none/unreadable, scope is complete/truncated/unscoped/unreadable, percentages are null when scope is not complete, a missing/malformed report is not clean. (#5170, #3180, #3217) [upstream:docs/CLI-TOOLS.md:512-541, 843-863]
- Artifacts decide completion, not the agent's return: SUMMARY present AND matching commits = complete; abnormal session end reconciles first, classifies second (#4217); no signal is waited on indefinitely. [upstream:gsd-core/workflows/execute-phase.md:37-40, 814-816]
- Only a passing verification report completes a phase; a ROADMAP checkbox has no authority; `human_needed` never advances the phase (#5118, #2957). [upstream:docs/CLI-TOOLS.md:462-488, 903-929; upstream:gsd-core/workflows/execute-phase.md:1245]
- Fail closed on unknown severity, unknown status, ambiguous trailer values, missing `gap_closure` key, unreadable depth override config. (#3724, #5118, #4924) [upstream:gsd-core/workflows/plan-phase.md:1146; upstream:gsd-core/workflows/code-review.md:449-530]
- Never infer a requirement, version, name or percentage that evidence does not carry; a dropped `REQ-ID` must warn. [upstream:docs/CLI-TOOLS.md:339-345, 562-571]
- Subagent write restrictions: Claude Code refuses subagent `Write` to SUMMARY.md/REPORT.md/FINDINGS.md/ANALYSIS.md (exact basenames); recover the inline return instead of re-dispatching (#222). [upstream:gsd-core/workflows/new-project.md:764]
- An agent prompt never relies on `@path` includes (they do not expand inside an Agent prompt string, #3324); the orchestrator embeds files at build time and passes paths for the rest. [upstream:gsd-core/workflows/execute-phase.md:715-723]
- Fan-out race: create agent worktrees ONE AT A TIME (`.git/config.lock`), run in background; merge in deterministic wave order, never completion order. [upstream:gsd-core/workflows/execute-phase.md:660-668; upstream:docs/features/quick-batch.md:20]
- Plan-checker and replan must run at depth 0 with Agent available; wrapping them in an agent removes the ability to spawn sub-agents (bug #936). Kit equivalent: the main session or a ph workflow, never a worker that itself must spawn workers. [upstream:gsd-core/workflows/plan-review-convergence.md:183, 600]
- Branches fork from `origin/<default>` with `--no-track`, never from the current HEAD; fetch failure with no local copy aborts (#2916, #2498). [upstream:gsd-core/workflows/execute-phase.md:296-332]
- Hooks run on every executor commit unless explicitly opted out; no silent `--no-verify` (#2924). [upstream:gsd-core/workflows/execute-phase.md:697-700]
- Retry ceilings: planner/checker revision loop 3, gap-closure 1 attempt, autonomous fix-and-retry 3 then `needs_human`, code-review fix loop 3, quick checker loop 2, convergence cycles 3. Stalls end loops early. [upstream:gsd-core/workflows/plan-phase.md:1138-1166; upstream:gsd-core/workflows/autonomous.md:783; upstream:gsd-core/workflows/quick.md:6]
- A plan file edit does not retroactively validate: replan after CONTEXT changes (context-drift pre-check compares artifact times with CONTEXT.md; `warn` default, `block` opt-in). [upstream:docs/CONFIGURATION.md:554-555]
- Worktree/branch drift: a prior isolated dispatch can leave the orchestrator cwd inside an agent worktree; detect by the per-agent branch namespace, not the path (#48). [upstream:gsd-core/workflows/execute-phase.md:448-520]
- WildEra finding to carry: the same failure repeating through coders; run-level failure signatures and a debug hand-off were needed. [wildera:.agents/skills/gsd-plan/references/compatibility.md:97]

## Interfaces

CLI surface (upstream, for re-implementation on `ph`): see UPS-66 verb list; headline contracts: `--raw`, `--pick` (UPS-67), `--ws`, exit codes 0/1/66/69 (UPS-73), `@file:` spill (UPS-67).

File formats owned (kit core must define): PROJECT.md, REQUIREMENTS.md, ROADMAP.md (UPS-75), STATE.md (UPS-68), CONTEXT.md six sections (UPS-16), RESEARCH.md (`## Validation Architecture`, Package Legitimacy Audit), PLAN.md/SUMMARY.md/VERIFICATION.md/UAT.md (UPS-54, UPS-76), REVIEW.md frontmatter `status/files_reviewed/findings{critical|blocker,warning,info,total}` (UPS-58), REVIEWS.md with writer-owned conflicts slot (UPS-29), DISCUSS-CHECKPOINT.json (UPS-17), `.planning/quick/<id>-<slug>/` (UPS-56), codebase/*.md with `last_mapped_commit` frontmatter (UPS-12), HANDOFF.json + `.continue-here.md` (UPS-63), `.planning/debug/*.md`.

Config keys (name, default, meaning; owned by this area):

| key | default | meaning |
|---|---|---|
| mode | interactive | yolo auto-approves gates |
| granularity | standard | coarse 3-5 / standard 5-8 / fine 8-12 phases |
| model_profile | balanced | tier column per agent |
| model_overrides / models.<phase_type> / dynamic_routing | {} / unset / off | precedence overrides (UPS-78) |
| workflow.research / plan_check / verifier | true | step toggles |
| workflow.auto_advance | false | chain discuss -> plan -> execute |
| workflow.plan_chunked / planning.chunked_parallel | false / false | chunked planning, concurrent planners |
| workflow.plan_review_convergence | false | enable convergence loop |
| workflow.context_coverage_gate | true | decision coverage gates (nested key only) |
| workflow.post_planning_gaps | true | non-blocking gap table |
| workflow.use_worktrees | true | isolation for parallel executors |
| workflow.worktree_skip_hooks | false | executors pass --no-verify, hooks run post-wave |
| workflow.build_command / test_command | null | post-merge gate commands (autodetect if null) |
| workflow.test_gate_timeout | 600 | seconds; watch-mode runners aborted |
| workflow.code_review / code_review_point / code_review_depth / code_review_depth_overrides | true / execute:post / standard / [] | review gate |
| workflow.human_verify_mode | end-of-phase | or mid-flight |
| workflow.context_guard_mode | warn | warn / auto (pause-work) / off at POOR tier 70%+ |
| workflow.drift_threshold / drift_action / plan_drift_precheck / context_drift_precheck / context_drift_action | 3 / warn / true / true / warn | drift gates |
| workflow.node_repair / node_repair_budget | true / 2 | autonomous task repair |
| executor.stall_detect_interval_minutes / stall_threshold_minutes | 5 / 10 | executor stall surveillance |
| planner.stall_detection_enabled / stall_detect_interval_minutes / stall_threshold_minutes | true / 5 / 10 | planner watchdog |
| workflow.subagent_timeout | 300000 | ms, parallel subagent tasks |
| workflow.skip_discuss / max_discuss_passes / discuss_mode / research_before_questions | false / 3 / discuss / false | discuss controls |
| parallelization.enabled / plan_level / task_level / skip_checkpoints | true / true / false / true | fan-out switches; `skip_checkpoints` skips checkpoints during parallel execution (UPS-90) |
| parallelization.max_concurrent_agents / min_plans_for_parallel | 3 / 2 | fan-out |
| workflow.security_enforcement / security_asvs_level / security_block_on | true / 1 / "high" | threat-model gate, ASVS level 1-3, minimum blocking severity (critical/high/medium/low/none); in the shipped template |
| workflow.assumption_delta / api_coverage_gate | true / true | advisory architecture checkpoint; COVERAGE.md matrix gate (UPS-92) |
| git.branching_strategy / base_branch / protected_branches / allow_default_branch_commits / create_tag | none / main / unset / false / true | branching |
| gates.execute_next_plan / confirm_transition / confirm_milestone_scope | true | interactive-mode confirmations |
| planning.commit_docs / planning.pr_strict | true / false | planning commit gate |
| context_window | 200000 | >= 500000 enables enrichment |
| workflow.smart_zone_tokens | 100000 | advisory phase-size flag |
| response_language | unset | language for user-facing text |

[source: upstream:docs/CONFIGURATION.md:13-140, 492-557, 559-668, 1227-1239, 1258-1364, 1390-1398; upstream:gsd-core/templates/config.json:1-54]

## Cross-area dependencies

- install: the kit scaffolds `.planning/` and the config defaults; upstream installer/runtime abstraction is dropped (UPS-86). Needs a `kit init` that creates the adopted tree (UPS-03).
- runtime: workers spawn via `ph`/Paseo (UPS-02); wait/stall policy from the watchdog (UPS-32, UPS-46); worktrees (UPS-44); circle model ids (UPS-78); needs a result-marker contract (`## PLANNING COMPLETE`, `## VERIFICATION PASSED`, `needs-owner`).
- workflow: the `ph workflow` scripts replace orchestrator markdown (UPS-87); the main session is the single writer of shared state.
- files: ph commit semantics (UPS-81); large-output handling (UPS-67); batch file read tools for the main session.
- hooks: UPS-84 (context monitor, guards, crash policy), project-owned syntax hook.
- method: AGENTS/CLAUDE rules the executor must follow; deviation rules 1-4 inside the executor agent (body not read).
- gsd-plan: planning workflow, skeleton review, coverage gates (UPS-25..UPS-39).
- gsd-debug: debug, diagnose-issues, node-repair, forensics (UPS-63); verify-work gap diagnosis spawns debug agents (UPS-54).
- ui: statusline/context bar, `progress` rendering, `state.json` consumers (UPS-82).
- history: harness-history rows (WildEra) and incident rules above.
- gsd-upstream (this area): vendoring and sync (UPS-87).

## Concerns

- Upstream bulk: 249 TypeScript modules, ADR-driven enforcement (lint rules for exit codes, state writes, evaluation scope drift) and a 100-workflow surface; re-implementing mechanics 1:1 would reproduce complexity the kit does not need (UPS-69, UPS-73). [upstream:CONTEXT.md:138, 141; upstream:docs/ARCHITECTURE.md:323-341]
- Workflow spines are 600-1570 lines of mixed prose and bash with a 3 KB `gsd_run` resolver preamble copied into every workflow; runtime branching (Codex/Copilot/Kimi) is interleaved with the core logic. Extractable core is perhaps a third. [upstream:gsd-core/workflows/plan-phase.md:77; upstream:gsd-core/workflows/execute-phase.md:20-41]
- Same-named different things: "Review Dispositions Ledger" (inside PLAN.md) vs `REVIEW-DISPOSITION.md`; "gate" for hooks, checks and probes. [upstream:docs/features/code-review-pipeline.md (ledger vs reviews-mode paragraph)]
- Disposition ledger has a documented lost-update window (no lock). [upstream:docs/features/code-review-pipeline.md (concurrency paragraph)]
- Workflows still say `/gsd:` while docs say `/gsd-`; paths mix `~/.claude/gsd-core` and `gsd-core/`: porting must normalise.
- `roadmap analyze` once emitted counts while progress.md read nonexistent `.plans` arrays, silently disabling the resume invariant (#3218): readers of JSON shapes need contract tests. [upstream:gsd-core/workflows/progress.md:211-218]
- Many "advisory only" gates (codebase drift, fact drift, test-report adapters) have severities that never block; easy to ship dead gates.
- CONTEXT.md in upstream is a 527 KB engineering glossary with predicates, not project context; do not confuse with the per-phase CONTEXT.md format.
- Docs and workflows disagree in places: agents count (ARCHITECTURE says 33; agents/ has 35 base files plus 29 compact); model catalog names (balanced planner Opus in docs table vs `adaptive`). Prefer workflow text when they differ. [upstream:docs/ARCHITECTURE.md:215; upstream:docs/CONFIGURATION.md:1547-1568]
- plan-phase.md consults `loop render-hooks` for core steps (research, pattern mapper) so the "core" research dispatch actually lives in a capability fragment (`capabilities/research/fragments/plan-pre.md`, vendored by WildEra). [upstream:gsd-core/workflows/plan-phase.md:413-433; wildera:.agents/skills/gsd-plan/upstream/UPSTREAM.json:19]

## Open questions for the owner

1. Plan review shape. Options: (a) WildEra skeleton review on the outline (cheaper, outline-first, <=3 passes); (b) upstream convergence loop over full plans with CYCLE_SUMMARY counting; (c) both (outline gate then optional convergence for high-risk phases). Recommendation: (c) with (a) mandatory and (b) behind `workflow.plan_review_convergence` using ph reviewer workers on different circle models. (UPS-34)
2. Worktrees and commits. Options: (a) one worktree per executor with ordered merge (upstream); (b) shared tree with disjoint `owns` and one commit per wave (WildEra); (c) per-project adapter choice. Recommendation: (c), default (a) for source trees that build quickly and (b) for engines with expensive builds. (UPS-44, UPS-87)
3. Is the STATE.md "Quick Tasks Completed" table kept? Recommendation: drop it; derive from `.planning/quick/`. (UPS-56)
4. PRs: does the kit ship through GitHub PRs (`ship`) or local merge? Recommendation: include `ship` as optional (adapter flag) later. (UPS-61)
5. Branching strategy default (`none`/`phase`/`milestone`) and who owns branch creation (ph vs workflow). Recommendation: `none` default; ph owns creation when `phase`. (UPS-52)
6. Requirement ID shape: upstream `CAT-NN` vs WildEra `<SPEC-ID>:<rule>`. Recommendation: free-form string with `PREFIX-N` default and an adapter regex. (UPS-75)
7. Adopt spec-phase (ambiguity gate) in the core or leave as LATER? Recommendation: LATER; discuss plus a short WHAT/HOW check first. (UPS-14)
8. Multi-repo/workstreams: needed for the owner's projects? Recommendation: no; LATER. (UPS-85, UPS-07)
9. Upstream text: does the new kit vendor a pinned verbatim snapshot of upstream GSD text plus generated adapters and a drift `check` (WildEra way, option A), or write its GSD core from scratch from this spec and keep only a `check` over its own contracts (option B)? Neither is forbidden. Recommendation: B for workflows/orchestration (they are plumbing for a different runtime), A only for the role-agent bodies and reference prose that carry the method (planner, plan-checker, verifier, executor deviation rules) if the owner accepts the MIT notice. (UPS-87)


## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
|---|---|---|
| R1-UPS-01 | accepted | UPS-73: four-way exit split (0 / 1+JSON / 1+empty / 66 empty scope / 69 and others); verified against upstream:docs/CLI-TOOLS.md:851-861 |
| R1-UPS-02 | accepted | UPS-74: phase empty union degrades to range; plan/quick no match = resolved + advisory (`no-matching-commits`, `empty-after-exclusions`); verified at upstream:docs/ARCHITECTURE.md:351, 363 |
| R1-UPS-03 | accepted | UPS-47: build 300 s hardcoded, test `test_gate_timeout` 600 s after `normalize-test-command`, 124 adds no wave failure but blocks tracking; CONFLICT recorded vs CONFIGURATION.md:556-557; verified at post-merge-gate.md:64-87, 137-160 |
| R1-UPS-04 | accepted | New UPS-88 (specless fallback is core plan-phase); UPS-14 and UPS-25 cross-reference it; verified at plan-phase.md:733-743 |
| R1-UPS-05 | accepted | New UPS-89 (deviation rules 1-4, install exclusion, scope boundary, 3-attempt cap); verified at gsd-executor.md:181-273 |
| R1-UPS-06 | accepted | New UPS-90 (parallelization keys and `skip_checkpoints`; runtime effect not stated in sources read, marked OPEN); Interfaces table gained the four parallelization keys and the three `workflow.security_*` template keys |
| R1-UPS-07 | accepted | New UPS-91 (phase-dir `.continue-here.md` blocking gate in execute-phase; `--interactive`); UPS-40 points to it; verified at execute-phase.md:266-294 |
| R1-UPS-08 | accepted | New UPS-92 (`assumption_delta`, `api_coverage_gate` with `phase_unresolved` / `scope_unavailable`); Interfaces table rows added; verified at CONFIGURATION.md:505, 541 |
| R1-UPS-09 | accepted (partly) | New UPS-93 (legitimacy thresholds, 5 s adapter timeout, SUS degrade); UPS-20 points to it and keeps the executor install stop (UPS-89). Read security-model.md:50-80, 102-110 only; the whole file and the two capability docs are still not read: Coverage table updated honestly (partial / not read) |
| R1-UPS-10 | accepted, reframed per orchestrator note | UPS-87 proposal changed from KEEP to OPEN with options A (vendor pinned snapshot + drift check) and B (write from scratch, keep only a check over kit files); Open question 9 rewritten; neither option forbidden |
| R1-UPS-11 | accepted | UPS-51: SUMMARY scan advisory, body-only heuristics, `key-files:` frontmatter not read, no cap, distinct from `verify-summary` and the spot-check; verified at CLI-TOOLS.md:247-270 |
| R1-UPS-12 | accepted | UPS-32: #4079 ScheduleWakeup rule cited at plan-phase.md:436, 705; CONTEXT.md:333 kept only for the stall flag; verified at plan-phase.md:436 |
| R1-UPS-13 | accepted | UPS-04: nested-key rule cited at ARCHITECTURE.md:331-335; exception list extended and marked illustrative |
| R1-UPS-14 | accepted | UPS-64 and Concerns: 35 canonical agents, 29 compact siblings, six without a compact file (verified by `ls`: debugger, executor, phase-researcher, plan-checker, planner, verifier); UPS-65: 29 compact files; executor tool list stated in full |
| R1-UPS-15 | accepted | UPS-66: added verify-summary, verify-path-exists, state-snapshot, select-revert-commits, user-story validate, commit-docs-guard, run-with-timeout, normalize-test-command; new UPS-94 (undo modes, never reset); UPS-63 gained purpose lines for every workflow that has a `<purpose>` line and lists those without one |
| R1-UPS-16 | accepted | UPS-41: any non-zero resolver status makes the gate `exit 1` (does not re-exit 69); UPS-18: missing flags added; verified at execute-phase.md:223-225 and plan-phase.md:124 |

New behaviors: UPS-88 through UPS-94 (7). Updated open count: the Open questions section lists 9; UPS-87 (vendoring, option A/B) and UPS-90 (`skip_checkpoints` effect) carry OPEN proposals.
