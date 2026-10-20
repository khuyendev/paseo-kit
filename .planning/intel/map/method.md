# Map: method (harness method, orchestrator skills, QA, skill writing/testing, model tiers, harness evolution)

AREA code: MTH. Path prefixes: `kit:` = C:/Users/fish/Desktop/paseo-harness-kit (ref-final), `wildera:` = C:/Users/fish/Desktop/WildEraV6 (89143da). Upstream gsd-core was not in my scope and not read; GSD ownership proposals below rest on the owner decisions in the task block.

Provenance note: the upstream Harness v2 source (revfactory/harness 2.1.0) is NOT on disk (searched ext-src and the home folder), so "upstream vs kit addition" is inferred from `NOTICE.md` (what the port changed) plus dated or Paseo-specific text. Labels used: [UP] = upstream method per NOTICE ("method itself unchanged", translated, primitives swapped to `ph`); [KIT] = kit addition evident from a date, an incident or Paseo-only content; [UP?] = probably upstream, cannot prove.

## Coverage

| file | lines | read fully |
| --- | --- | --- |
| kit:project/.agents/skills/harness/SKILL.md | 416 | yes |
| kit:project/.agents/skills/harness/NOTICE.md | 20 | yes |
| kit:project/.agents/skills/harness/references/orchestrator-template.md | 289 | yes |
| kit:project/.agents/skills/harness/references/team-patterns.md | 278 | yes |
| kit:project/.agents/skills/harness/references/team-examples.md | 150 | yes |
| kit:project/.agents/skills/harness/references/qa-agent-guide.md | 229 | yes |
| kit:project/.agents/skills/harness/references/skill-writing-guide.md | 261 | yes |
| kit:project/.agents/skills/harness/references/skill-testing-guide.md | 283 | yes |
| kit:project/.agents/skills/harness/references/model-selection-guide.md | 122 | yes |
| kit:project/.agents/skills/harness-evolve/SKILL.md | 92 | yes |
| kit:project/.agents/skills/ai-orchestrator/SKILL.md | 16 | yes |
| wildera:.agents/skills/ai-orchestrator/SKILL.md | 16 | yes; byte-identical to the kit copy (`diff` empty) |
| wildera:.agents/skills/harness-evolve/SKILL.md | 92 | diffed against the kit copy (`diff` empty), so read through the kit copy |
| wildera:.agents/harness-history.md | 47 | yes (record format only) |
| kit:templates/harness-history.md (seed, outside scope, read for the format) | 8 | yes |

Out of scope but cited for context only (not mapped here): `references/execution-modes.md`, `paseo-runtime.md`, `workflow-recipes.md`, `scripts/` (runtime/workflow areas).

WildEraV6 differences: none in `ai-orchestrator` and `harness-evolve` (identical to kit). The WildEra `harness` skill and `harness-history.md` are out of this diff; `harness-history.md` is a populated instance of the kit seed (rows 2026-10-14..19), see MTH-60.

## Summary

- The area is the kit's method layer: a modified port of revfactory Harness v2.1.0 (Apache-2.0, `NOTICE.md`) with the runtime primitives swapped from Claude Code in-session tools to Paseo agents driven by `ph`. Two skills (`harness` = design/extend/audit, `harness-evolve` = retrospective) plus a kit-original thin skill `ai-orchestrator` (Definition of Done + waiting rule).
- Shape of the method: Step 0 inspect -> 1 analyze work -> 2 choose execution mode (workflow / persistent agents / subagent fanout / hybrid) and team pattern -> 3 agent definitions -> 4 skills -> 5 orchestrator skill + data transfer + errors + sizing + `CLAUDE.md` entry + follow-up handling -> 6 validation/testing -> 7 operate/evolve. Reference docs hold templates (3 orchestrator templates + mixed), 6 team patterns + 7 verification patterns, QA design, skill writing and testing (with-skill vs baseline, blind A/B workflow, assertions, trigger sets), model tiers.
- Kit additions to the upstream method (all small, mostly in `SKILL.md` step 5): English-only output, consent rule for `ph workflow`, "preflight a fan-out", "scripts own bookkeeping", prompt/input size limits, advisory `tools:`, freeze procedure wording with `ph freeze`, `harness-history.md`, `skills-sync`, kit pull step in evolve.
- Worth keeping in spirit: explain-why skill writing, generalize-don't-overfit feedback, role-vs-procedure split (agent vs skill), mode selection by "can code define the flow", adversarial verification, QA by reading both sides of a boundary, incremental QA, tier choice by work not by importance, history table as the evolution record, never retry quota/auth failures, orchestrator must never fabricate a stopped agent's judgment.
- Overlap with GSD: both are methods. Proposal: GSD owns the phase lifecycle, `.planning/` state, plan/verify agents; the harness method (slimmed) owns how to build teams, agent/skill/orchestrator files, execution-mode choice, QA/testing of skills and evolution of the harness itself. The generic `ai-orchestrator` DoD rule and the wait rule move to the runtime/rules layer, not a skill.
- Heaviest over-engineering: 3000+ lines of reference prose of which much is Korean-origin domain examples (webtoon, novel, Next.js QA), v1 migration material, and a Paseo restatement of Claude Code semantics; the new kit should keep roughly the decision tables and the lessons, not the prose.

## Behaviors

### MTH-01 Harness skill scope and file placement
- Behavior: The `harness` skill designs, extends and audits a project harness = agent definitions in `.agents/agents/`, skills in `.agents/skills/`, orchestrator skills, and a `CLAUDE.md` entry. Agent definition says who does the work; skill says how. Retrospectives go to `harness-evolve`. `ph` = `node .agents/skills/harness/scripts/paseo_harness.mjs` run from the project root; `references/paseo-runtime.md` must be read before running or generating an orchestrator.
- Proposal: CONFLICT on the path prefix (MTH-69); KEEP the role/procedure split and placement; CHANGE the entry skill to a short `team-design` skill (agents, skills, orchestrators only), because the phase lifecycle moves to GSD (see MTH-62).
- Source: kit:project/.agents/skills/harness/SKILL.md:3-14; kit:project/.agents/skills/harness/SKILL.md:105-106
- Why it exists: not stated beyond upstream design [UP].
- Test idea: a freshly generated harness has agents only under `.agents/agents/`, skills only under `.agents/skills/`, and no "how-to" body text inside any agent file.

### MTH-02 Three execution modes and the decision order
- Behavior: Modes: workflow orchestration (`ph workflow --script F --args-file F`), persistent agent collaboration (`ph spawn/send/task/watch/result`), subagent delegation (`ph fanout --file F --collect DIR` or spawn/watch/result). Decide in order: (1) workflow if item list, validation criteria and repetition can be expressed in code (the SKILL.md:64 table row adds: structured results are required, or the work needs dozens or more `agent()` calls), so a repeatable flow is not left to ad hoc model judgment; (2) persistent agents if hard to code and agents must talk or remember; (3) subagents if only a result is needed; (4) hybrid when stages differ, each stage labelled `**Execution mode:**`.
- Proposal: KEEP (the decision rule is the core of the method). CHANGE names to the new kit's command surface (`ph` stays per owner decision).
- Source: kit:project/.agents/skills/harness/SKILL.md:60-77; kit:project/.agents/skills/harness/SKILL.md:242; kit:project/.agents/skills/harness/references/orchestrator-template.md:246-264
- Why it exists: not stated; upstream three-mode design [UP], commands rewritten [KIT].
- Test idea: given three sample task descriptions (known item list; two experts needing back-and-forth; one-shot research) a design run picks workflow / persistent / subagent respectively and states the mode per stage for a mixed task.

### MTH-03 Consent and default scale for `ph workflow`
- Behavior: Run `ph workflow` only when the user asked for orchestration or invoked an orchestrator skill that runs it (either is consent). Default run uses a few agents; scale up only on "thorough"/"exhaustive" (SKILL.md:75); "all" appears only in Template A (orchestrator-template:28). Concurrency and caps follow runtime contract 6-3. Template A repeats: invoking the orchestrator skill counts as agreeing to a workflow; default agent count `{N}`.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:75; kit:project/.agents/skills/harness/references/orchestrator-template.md:28
- Why it exists: not stated; cost control. [KIT wording: "Treat either as consent"]
- Test idea: a request that merely mentions research does not start a workflow; invoking the orchestrator skill does, with the default small agent count.

### MTH-04 Step 0: inspect current state and route
- Behavior: On load read `.agents/agents/`, `.agents/skills/`, `CLAUDE.md`; route to: build from scratch (dirs missing/empty -> steps 1-6), extend (only needed steps per table: add agent = 3 required, 4 if dedicated skill, 5 modify orchestrator, 6 required; add/modify skill = 4 and 6, 5 if connections change; change structure/mode = 2,5,6 required, 3/4 for affected), operate/maintain (step 7). Compare actual agent/skill lists with `CLAUDE.md` entries for inconsistencies; report the findings and plan to the user and get confirmation before acting.
- Proposal: KEEP (routing table); CHANGE the `CLAUDE.md` consistency check to match the new invocation-entry location (MTH-37).
- Source: kit:project/.agents/skills/harness/SKILL.md:23-41
- Why it exists: not stated [UP].
- Test idea: on a repo with agents but a missing orchestrator, the skill proposes only the steps in the "Add an agent" row and asks for confirmation.

### MTH-05 v1 artifact and in-session primitive detection
- Behavior: An orchestrator containing `TeamCreate`, `TeamDelete` or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is a v1 artifact that does not work; propose porting (execution-modes.md "Migrating from v1 to v2"). An orchestrator using Claude Code in-session primitives (`Workflow` tool, `Agent(`, `SendMessage`, `TaskCreate`) is a "Claude-Code-native v2" harness; propose migrating to the `ph` counterparts (execution-modes.md section 5). Validation step 6-1 greps outputs for both groups; `harness-evolve` flags both as evolution signals.
- Proposal: CHANGE: keep the second check but invert it for the new kit's semantics: native `Agent` and `Workflow` are denied for the main provider and also for the worker provider (kit:project/.agents/harness.defaults.json:37,53,59-61), and `SendMessage` for the main provider (line 62), so the check is "orchestrator skills generated for Paseo contain no native Agent/Workflow/SendMessage/TaskCreate"; DROP the v1 TeamCreate material (no v1 harnesses exist in the new kit).
- Source: kit:project/.agents/skills/harness/SKILL.md:39; kit:project/.agents/skills/harness/SKILL.md:330-331; kit:project/.agents/skills/harness-evolve/SKILL.md:39-40; kit:project/.agents/skills/harness/references/orchestrator-template.md:278; kit:project/.agents/harness.defaults.json:37,53,59-62; kit:project/.agents/skills/harness/NOTICE.md:10-11
- Why it exists: v1 teams do not run in the current runtime; Paseo runtime replaced Claude Code primitives (NOTICE 10-13).
- Test idea: a lint over generated orchestrator skills fails on the strings `TeamCreate`, `TeamDelete`, `team_name`, `Agent(`, `SendMessage`, `TaskCreate`.

### MTH-06 Step 1: analyze field and work
- Behavior: Identify field/goal; split work into types (generation, validation, editing, analysis); ask four mode-deciding questions (can items be listed in advance; validate-then-fix cycle; opinion exchange helps; same expert needed within a session); find overlap with existing agents/skills; inspect the codebase stack/data model/modules; match explanation difficulty to the user (explain "assertion", "JSON Schema" to non-coders).
- Proposal: KEEP, compress to a checklist.
- Source: kit:project/.agents/skills/harness/SKILL.md:43-54
- Why it exists: not stated [UP].
- Test idea: design transcript contains the four mode questions answered for the task before a mode is chosen.

### MTH-07 Six team patterns
- Behavior: Patterns and recommended v2 mode: Pipeline (workflow `pipeline()`; per-item flow without stage barriers; human-review between stages -> sequential subagents), Fan-out/fan-in (workflow `pipeline` first, `parallel()` only when a full barrier is needed to dedupe; 2-4 researchers sharing findings may be persistent), Expert pool (subagent once; give a name -> persistent for follow-up), Producer-reviewer / Generate-and-verify (max 2-3 retries; workflow if criteria are codable, else named persistent pair with `ph send`), Supervisor (persistent; leader uses `ph task add/update`, `ph send` on `ph watch` completion lines; becomes workflow if task list is fixed), Hierarchical delegation (max two levels; nested workflow one level via `workflow(nameOrRef,args)`, or flatten with `phase()`). SKILL.md lists "Generate and verify" where team-patterns calls it "Producer-reviewer" (naming drift). Cautions: an expert-pool classifier that misclassifies never reaches the right expert (team-patterns:70); fan-in quality depends on how results are combined (team-patterns:54). Composite patterns: MTH-66.
- Proposal: KEEP the six with the mode mapping; CHANGE to one canonical name for producer-reviewer.
- Source: kit:project/.agents/skills/harness/SKILL.md:79-88; kit:project/.agents/skills/harness/references/team-patterns.md:22-119
- Why it exists: pipeline caution: a delayed stage delays all; supervisor caution: tiny tasks make the supervisor a bottleneck; hierarchy >3 levels slows and loses context (team-patterns 36,102,117).
- Test idea: for each of six pattern prompts the generated orchestrator names the pattern and the matching mode, and a hierarchy request produces at most 2 levels.

### MTH-08 Quality verification patterns
- Behavior: Adversarial verification (N independent verifiers per finding; pass only findings a majority judge `confirmed` with sufficient evidence; `refuted` and `uncertain` never count as passing); perspective-diverse verification (different lenses per verifier: correctness/security/reproducibility); jury panel (N proposals judged in parallel, final = best plus strengths of others); loop-until-dry (stop after K consecutive rounds with zero new findings; record rejected findings in `seen` to avoid re-proposing); explore by multiple criteria (container/content/entity/time); omission reviewer (final agent asks only what is missing: criteria unused, claims unverified, sources unread; newly found omissions are added to the next exploration task, team-patterns:132); report the number of excluded items with `log()` whenever top-N or sampling limits scope. Scaling principle: size matches the request ("check for bugs" = few explorers + one verifier; "audit thoroughly" = more explorers, 3-5 verifiers per finding; unclear scope -> thorough for research/review/audit, small for quick checks).
- Proposal: KEEP (quality patterns are method-level and independent of GSD); CHANGE the verifier vocabulary to align with the review gate lessons (trigger + confidence, see MTH-64) rather than a bare majority vote.
- Source: kit:project/.agents/skills/harness/SKILL.md:89-94; kit:project/.agents/skills/harness/references/team-patterns.md:121-137
- Why it exists: filter results that look correct but are wrong (team-patterns 123). WildEra later found reviewers wrong too and added a bounded gate (wildera:.agents/harness-history.md:42).
- Test idea: a verification workflow drops `uncertain` findings, logs the excluded count, and ends exploration only after K empty rounds.

### MTH-09 Criteria for splitting agents
- Behavior: Split by expertise (different responsibility areas), parallelism, information volume (one agent processing a lot), reusability across teams; combine when areas overlap, work is sequential, information small, or only this team uses it.
- Proposal: KEEP as a 4-row table.
- Source: kit:project/.agents/skills/harness/SKILL.md:96-98; kit:project/.agents/skills/harness/references/team-patterns.md:237-244
- Why it exists: not stated [UP].
- Test idea: n/a (guidance); review checks any proposal lists the criterion used for each split.

### MTH-10 Reusable agent definitions in files; no definition for one-offs
- Behavior: A specialist role reused across sessions is a file `.agents/agents/{name}.md`, called with `--type {name}` (`ph spawn/fanout`) or `opts.agentType` in a workflow. One-off work gets no file: a general agent (no `--type`) or a read-only one (`--read-only`, advisory); these are the Paseo counterparts of the built-ins `general-purpose`, `Explore`, `Plan` (which do not exist as types in the runtime). Define in advance what agents exchange so collaboration results stay stable. Never put a reusable role only in a command prompt.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:100-108; kit:project/.agents/skills/harness/references/team-patterns.md:152-180; kit:project/.agents/skills/harness/references/orchestrator-template.md:37,120,228
- Why it exists: Paseo has no built-in types; templates must not name `Explore`/`general-purpose` [KIT adaptation].
- Test idea: an orchestrator referencing `agentType: X` fails validation unless `.agents/agents/X.md` exists or X is omitted.

### MTH-11 Overlap check before creating an agent
- Behavior: Before creating an agent file compare roles with existing `.agents/agents/` even when step 1 is skipped. Table: existing agent covers all -> reuse; partial overlap and generalizing covers it -> extend existing; overlap but intentional domain specialization -> separate; no overlap -> new. Extending an agent can change every orchestrator calling it: identify callers, update its `description`, re-run a dry run (step 6-5). If extending would give the agent two or more roles, consider splitting it first (team-patterns:257; MTH-68).
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:110-112; kit:project/.agents/skills/harness/references/team-patterns.md:246-259
- Why it exists: repeated harness builds accumulate same-role agents under different names (team-patterns:248).
- Test idea: adding an agent whose description overlaps an existing one yields a recorded reuse/extend/separate decision.

### MTH-12 Model tiers frontier / pro / standard
- Behavior: Pick per agent by complexity, duration, autonomy, response speed. frontier = hardest long-horizon planning/coordination (plan changes with earlier results, agent coordination, integrating extensive material, vague idea -> specifics); pro = bounded specialist deep reasoning (design/architecture, code generation, complex analysis, cross-checking, methodology critique, creative); standard = routine with clear procedure and the default when unsure (log analysis, format conversion, static-file checks, running deploy scripts, simple collection, general writing/summaries; the guide also lists general coding/research under standard). Tier set in agent YAML `model:`, `--model`, or workflow `opts.model`; reason left as a comment. Tiers map to real Paseo models in `.agents/harness.defaults.json` (project overlay `.agents/harness.config.json`), runtime contract section 3. Frontier vs pro: pro deeply critiques one paper; frontier reviews dozens, builds strategy and report.
- Proposal: CHANGE: keep the three tier names and the work-based criteria; the mapping to concrete models belongs to the project adapter (owner: models per role live in the adapter), not to method prose. See MTH-13 for a conflict.
- Source: kit:project/.agents/skills/harness/SKILL.md:114-129; kit:project/.agents/skills/harness/references/model-selection-guide.md:3-14,15-115; kit:project/.agents/skills/harness/references/team-patterns.md:182; kit:project/.agents/harness.defaults.json:2
- Why it exists: not stated. Concept [UP]; tier-to-model mapping and `tier_aliases` fable->frontier, opus->pro, sonnet->standard (kit:project/.agents/harness.defaults.json:28-32) [KIT].
- Test idea: an agent definition with `model: pro` resolves to the adapter's configured model; an unknown tier fails loudly.

### MTH-13 Model selection rules for harness design
- Behavior: (1) judge by the work, not agent importance; (2) never assign the same model to all agents without reason (cost); (3) the coordination layer may be frontier while its workers are chosen individually; (4) per-stage models in workflows via `opts.model` (standard for repetitive collection/conversion, pro for verification/review/design, frontier for long planning stages). Tiers are not distinct models. Output checklist: record the reason in a comment.
- Proposal: KEEP rules 1-4. CONFLICT: SKILL.md puts "code generation" under pro, the model guide puts "General coding work" under standard and "multi-step independent coding" under pro. Resolve in the new text: standard = everyday coding with a clear procedure (functions, fixes, refactoring, tests, data scripts: guide:94); pro = multi-step coding that changes structure, spans files and decides its next steps itself (guide:73-76); do not invent a single-file cut.
- Source: kit:project/.agents/skills/harness/references/model-selection-guide.md:117-122; kit:project/.agents/skills/harness/SKILL.md:124-127; kit:project/.agents/skills/harness/SKILL.md:121-122; kit:project/.agents/skills/harness/references/model-selection-guide.md:13,73-76,94
- Why it exists: not stated [UP].
- Test idea: a generated team of 5 agents shows at least two distinct tiers and a reason comment on each.

### MTH-14 Agent definition content and advisory `tools:`
- Behavior: YAML front matter requires `name` and `description`; optional `tools` and `model`. Body: core role, working principles (with reasons), input/output rules, error handling, collaboration; persistent agents add `## Communication rules` (first report confirms `ph task` works and lists the tools actually usable; whom to `ph send`; shared task use) and "When called again" (read previous outputs, revise only the criticized part); workflow-only agents replace communication rules with "Structured output" (JSON structure; final text is return data, not a message to the user). `tools:` is advisory (filesystem batch tools always present); agents that modify outputs get both Write and Edit, because Write-only forces whole-file rewrites and the agent may give up or write a side file, leaving the original unfixed. Read-only roles are advisory, never presented as permissions. If a listed tool turns out to be missing, the orchestrator does that work itself (example: the leader runs `ph task update`) or the `tools` restriction is removed (team-patterns:235; MTH-68).
- Proposal: KEEP; CHANGE tool names to Claude Code's real tool set. The "filesystem MCP always present" statement is tied to the MCP adapters and the harness-files mod; re-verify in the files/install areas.
- Source: kit:project/.agents/skills/harness/SKILL.md:131-139; kit:project/.agents/skills/harness/references/team-patterns.md:184-235
- Why it exists: Write-without-Edit failure mode (team-patterns:234); `tools:` advisory because Paseo agents always have all tools [KIT].
- Test idea: lint: agent file has name+description; a persistent-agent file has the communication section; a workflow-only agent has the structured-output section.

### MTH-15 Connecting skills to agents
- Behavior: One agent may use several skills; a skill may be shared. Three methods: Skill tool call (stated in the agent prompt; independent skill, user may call it directly, or several agents share it), include text in the agent prompt (skill <= 50 lines, one agent only), load a `references/` file on demand with the file read tool (large skill, needed under specific conditions). Agents are Claude Code sessions with the Skill tool.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:201-205; kit:project/.agents/skills/harness/references/team-patterns.md:261-278
- Why it exists: not stated [UP]; Paseo wording [KIT].
- Test idea: a skill used by 2+ agents is referenced via a Skill-tool instruction, not copied into prompts.

### MTH-16 Worktree isolation for parallel edits
- Behavior: Parallel editors of the same files use a custom type plus `opts.isolation: 'worktree'`; creation has a cost so use only for parallel edits. In migrations the workflow returns `worktreePath` and `changedFiles`; the verifier is given the worktree path; the main agent merges only `confirmed` results, resolving conflicts before the next merge and applying the next changes only after integration tests pass; `refuted`/`uncertain` are reported, not merged. Persistent-supervisor variant: leader registers batches with `ph task add --depends-on`, spawns `migrator-N` (`--count`), watches, reassigns failures with `task update --assignee`.
- Proposal: KEEP as a pattern; CHANGE to the new runtime's worktree contract (runtime area).
- Source: kit:project/.agents/skills/harness/references/team-patterns.md:178; kit:project/.agents/skills/harness/references/team-examples.md:85-123
- Why it exists: prevent edit conflicts between agents (team-patterns:178).
- Test idea: a migration workflow returns a non-empty `worktreePath` per batch (schema `minLength: 1`) and the merge step skips non-confirmed batches.

### MTH-17 QA agent rules (build harnesses)
- Behavior: Include a QA agent in build harnesses. It may stay read-only only when it runs non-mutating checks (lint/tests/verification scripts; read-only is an instruction, every agent has a shell); give an editing role when checks write artifacts, naming those artifacts. QA template: no `tools:` list and no `--read-only`. Compare API responses with consumer hook structures, never only file existence. Run QA incrementally as each module completes, not once at the end (bugs and early contract mismatches accumulate). Reports separate passed, failed and unverified; send specific fix requests (file:line + fix) to the responsible agent and notify both owners of a boundary problem.
- Proposal: CONFLICT between SKILL.md:143, qa-agent-guide:87 and :214 (read-only allowed vs forbidden; `tools:` list required to include Bash/Edit/Write vs no `tools:` list), see MTH-67; KEEP the generic rules; the web-app (Next.js) checklist belongs to a project adapter or example pack, not core.
- Source: kit:project/.agents/skills/harness/SKILL.md:141-146; kit:project/.agents/skills/harness/references/qa-agent-guide.md:83-104,181-214
- Why it exists: "real cases" table (qa-agent-guide:218-228): `projects?.filter is not a function`, 404 dashboard links, `thumbnailUrl`/`thumbnail_url`, API without hook, missing final-state transition, immediate-vs-final response, route prefix mismatch [UP].
- Test idea: generated QA agent definition contains a verify -> report -> request-fix procedure and no `--read-only` when it writes artifacts.

### MTH-18 Boundary-mismatch defect taxonomy
- Behavior: Six miss patterns at component boundaries: API response -> frontend hook; field-name casing -> type; file path -> link `href`; state-transition map -> actual status update; API endpoint -> hook; immediate response -> async result. Static review fails because generics (`fetchJson<T>`), assertions and `any` compile but fail at runtime, and "API exists" differs from "API response matches the caller".
- Proposal: KEEP as a short reference table (generalize beyond web).
- Source: kit:project/.agents/skills/harness/references/qa-agent-guide.md:20-39
- Why it exists: defects in real projects (qa-agent-guide:5).
- Test idea: QA checklist template contains one comparison item per class, not an existence item.

### MTH-19 Integration-coherence procedures
- Behavior: Four procedures reading producer and consumer together: response structure vs hook type (wrapper `.data`, pagination as array, snake/camel conversion, 202 vs final shape); route files vs `href=`/`router.push(`/`redirect(` (strip `(group)`, `[param]` dynamic); state-transition map vs all status-updating code (no disallowed transitions, no unused transitions, intermediate -> final not missing); endpoint list by HTTP method vs client fetch URLs (uncalled endpoint = admin API or missing hook). Checklist groups: API/frontend, routing, state machine, data flow (DB field vs API vs type; null handling of optionals).
- Proposal: KEEP as an example/reference pack; DROP from the core method (Next.js specific). Checklist rows missing here are in MTH-67.
- Source: kit:project/.agents/skills/harness/references/qa-agent-guide.md:41-81,150-179
- Why it exists: see MTH-17.
- Test idea: adapter-level: a sample web project's QA run reports each of the four classes.

### MTH-20 Workflow-based QA
- Behavior: When boundaries can be listed, QA is a workflow `qa-coherence` saved as `.agents/workflows/qa-coherence.js`: `pipeline(boundaries, inspect with agentType qa-inspector, schema FINDINGS -> parallel opposing-perspective re-verification, schema VERDICT)`, keep only `confirmed`; `meta` has phases Inspection and Re-verification; run `ph workflow --script ... --args '{"boundaries":[...]}'`. `qa-inspector` must exist in `.agents/agents/`. The example uses `--args` while SKILL.md and templates use `--args-file`: CONFLICT to settle with the runtime map.
- Proposal: KEEP the pattern; use the flag the new runtime has.
- Source: kit:project/.agents/skills/harness/references/qa-agent-guide.md:106-148
- Why it exists: filter claims that sound plausible but are not real problems (qa-agent-guide:148).
- Test idea: the example script runs under the workflow engine with a 2-boundary args file and returns only confirmed findings.

### MTH-21 Skill directory structure and sync
- Behavior: Skills live in `.agents/skills/{name}/SKILL.md` (YAML `name`+`description` required) with optional `scripts/`, `references/`, `assets/`. After creating a skill run `ph skills-sync` so Claude Code (reads only `.claude/skills/`) sees it; edits to an already linked skill show through the link. A sync failure or conflict = report the blocker, do not claim the skill was tested. No command files in `.claude/commands/`.
- Proposal: CHANGE: with Claude Code as the only harness the `.agents/skills` + sync step is a cross-harness workaround; decide in install area whether the new kit authors directly in `.claude/skills/` (OPEN Q1).
- Source: kit:project/.agents/skills/harness/SKILL.md:148-166; kit:project/.agents/skills/harness/SKILL.md:329; kit:project/.agents/skills/harness-evolve/SKILL.md:74
- Why it exists: `.agents/skills` is the folder "Codex, OpenCode and other harnesses read" (SKILL.md:150), now dropped.
- Test idea: a newly authored skill is visible to a fresh Claude Code worker session without manual copying.

### MTH-22 Writing the `description` (invocation conditions)
- Behavior: Agents select skills by `name` + `description` only. The description states what the skill does and the situations where it must be used, plus exclusions for look-alikes; it is written somewhat assertively because agents invoke conservatively and often skip skills for simple tasks; coordination skills include follow-up words (rerun, revise, refine, improve previous results). Metadata about 100 words.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:168-174,190-193; kit:project/.agents/skills/harness/references/skill-writing-guide.md:23-52
- Why it exists: not stated [UP].
- Test idea: skill lint: description contains a "use when" trigger and, for orchestrators, at least one follow-up phrase.

### MTH-23 Body writing principles
- Behavior: Explain the reason before the rule; keep SKILL.md under 500 lines; generalize (not "Q4 revenue" but quantity-like column names); imperative style; put code that several agents rewrote into `scripts/`; reduce context: delete what the agent already knows, keep what prevents mistakes, replace long explanation with one example.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:176-184; kit:project/.agents/skills/harness/references/skill-writing-guide.md:54-94,116-132
- Why it exists: models decide better in exceptions when they know why (skill-writing-guide:60).
- Test idea: skill lint: SKILL.md <= 500 lines (hard check).

### MTH-24 Progressive disclosure and loading stages
- Behavior: Load metadata always (about 100 words), SKILL.md body when the skill loads (< 500 lines), `references/` on need, `scripts/` run without reading. Near 500 lines move detail to `references/` and say when to read each; add a table of contents to any reference over 300 lines; split references by field/framework so only one is read.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:186-199; kit:project/.agents/skills/harness/references/skill-writing-guide.md:134-161
- Why it exists: context window is limited (skill-writing-guide:90).
- Test idea: lint: any `references/*.md` over 300 lines has a contents list.

### MTH-25 Output-format definitions
- Behavior: Where deliverable format matters, give a short template plus a real example. If the next workflow step consumes the deliverable in code, specify JSON (not a Markdown template) and state that the final text is return data; the workflow `schema` option enforces it, so skill structure and script schema must match.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/references/skill-writing-guide.md:96-114
- Why it exists: schema enforced by the runtime (skill-writing-guide:114).
- Test idea: an agent definition's JSON structure equals the `schema` of the workflow `agent()` call that uses it.

### MTH-26 Script bundling criteria
- Behavior: Bundle when test runs repeat: same helper script written in all three runs -> `scripts/`; same install command -> install step in the skill; same multi-step procedure -> skill body; same workaround after the same error -> known issue + solution. Run and verify every bundled script.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/references/skill-writing-guide.md:163-176; kit:project/.agents/skills/harness/references/skill-testing-guide.md:211
- Why it exists: not stated [UP].
- Test idea: each bundled script has been executed at least once in a recorded test.

### MTH-27 What not to put in a skill
- Behavior: No README/CHANGELOG/INSTALLATION_GUIDE, no creation-time info (test results, revision history), no user manuals, no general knowledge, no v1 items (`TeamCreate`/`TeamDelete`, experimental flags, uniform `model`).
- Proposal: KEEP (drop the v1 item).
- Source: kit:project/.agents/skills/harness/references/skill-writing-guide.md:225-233
- Why it exists: skills are AI instructions, not documents.
- Test idea: skill lint flags README.md/CHANGELOG.md inside a skill folder.

### MTH-28 Designing skills for reuse
- Behavior: Same four-row table as agents (reuse / extend by generalizing / separate if intentionally specialized / new); generalize only to the responsibility boundary (fintech risk assessment PDF -> assessment results PDF; stop there; never generalize a specialized domain); extending a skill can change every agent using it, so check users and widen `description`. Checked before creating a skill (step 4-0); one role per skill.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:152-154; kit:project/.agents/skills/harness/references/skill-writing-guide.md:235-261
- Why it exists: repeated builds accumulate same-function skills (skill-writing-guide:237).
- Test idea: adding a skill whose function overlaps an existing one yields a recorded decision.

### MTH-29 Data schema standards for evals
- Behavior: Shared JSON shapes: `eval_metadata.json` {eval_id, eval_name, prompt, assertions[]}; `grading.json` {expectations[{text, passed, evidence}], summary{passed, failed, total, pass_rate}} with exactly `text`/`passed`/`evidence` (not `name`/`met`/`details`); `timing.json` {total_tokens, duration_ms, total_duration_seconds}. Timing is saved right after each run: `ph fanout --collect` writes `<dir>/<name>.json` before archiving the agent; `total_tokens = tokens.input + tokens.cachedInput + tokens.output`; `duration_ms = durationS x 1000`; `total_duration_seconds = durationS` (skill-testing-guide:90); archived agents cannot be read again. CONFLICT on `ph result --json`: skill-writing-guide:223 says it shows tokens and durations for an agent that is not archived yet; skill-testing-guide:90 says that for a `ph spawn` agent it has no `tokens` (no `ph` process followed it from creation), so use the last turn's `usage` or run the cases with fanout/workflow.
- Proposal: CONFLICT (two sentences above); KEEP the three schemas; CHANGE the timing extraction to whatever the new runtime's result schema really provides (runtime area decides) and state one rule.
- Source: kit:project/.agents/skills/harness/references/skill-writing-guide.md:178-223; kit:project/.agents/skills/harness/references/skill-testing-guide.md:88-90 (conflicting sentence: skill-writing-guide:223)
- Why it exists: exact field names so graders and viewers interoperate (skill-writing-guide:211).
- Test idea: a schema check validates sample grading.json/timing.json; field-name variants fail.

### MTH-30 Orchestrator is a skill; extend instead of duplicating
- Behavior: An orchestrator is a skill that combines agents and skills into one workflow (who, when, order). When extending a harness edit the existing orchestrator; when adding agents reflect them in composition, task assignment and data-transfer order and add their trigger phrases to `description`. Every template: front matter `name: {domain}-orchestrator` and a `description` with initial triggers plus follow-up phrases; states execution mode at the top; agent composition table in Templates A and B (role, agentType/`--type`, skill, deliverable; Template C has only its Phase 2 fanout input/deliverable table, orchestrator-template:223-226); Phase 0 existing-work check; error handling; test scenarios; deliverable locations.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:207-211; kit:project/.agents/skills/harness/references/orchestrator-template.md:1-14,268-278
- Why it exists: without follow-up phrases the orchestrator may not be selected again after its first run (orchestrator-template:289).
- Test idea: lint a generated orchestrator for the nine writing principles at orchestrator-template:270-278 (mode statement, table, paths, dependencies, errors, scenarios, no v1 items).

### MTH-31 Template A: workflow orchestration
- Behavior: Phase 0 checks `_workspace/`: absent -> fresh; present + partial fix -> rerun only that part; present + new input -> move to `_workspace_{ts}/` and start fresh. Partial rerun with `runId` in `_workspace/run_meta.json`: edit the script, resume with `ph workflow --script F --args-file F --resume <runId>` (unchanged `agent()` calls return cached results). Phase 1 main agent finalizes the work list and passes it as `args`. Phase 2 script: `meta` {name: '{domain}-run', phases}, collection `pipeline(args.items, item => agent(..., {schema}))`, adversarial verification, `.filter(Boolean)`, `return` structured results; run with `--detach`; record the printed `workflow started <runId>` in `_workspace/run_meta.json`; watch under Monitor with `watch_run.mjs <runId>` (exits at run end; re-arm only if the Monitor times out while the run is still going); on `workflow done` read `<runDir>/result.json`, on `workflow failed` read `journal.jsonl` and `log.txt`; never state or assume a result before the `workflow done` line. Phase 3: report excluded/omitted items, final deliverable to `{output-path}/{filename}`, keep intermediates and `run_meta.json` under `_workspace/`. Error table: single `agent()` null -> exclude + `log()` count + state in report; whole failure -> read `journal.jsonl`, edit failed phase, resume; non-improving failure (quota, auth, permission) -> do not retry/resume until cause fixed, read journal and partials, record omissions in `_workspace/`, state quota reset time, continue with `--resume` after the fix (this resume line has `--script` + `--resume` and no `--args-file`, while line 48 has `--args-file`: two shapes, see MTH-73); empty result is not success; conflicting data side by side with sources.
- Proposal: KEEP; CHANGE: `run_meta.json` bookkeeping and the monitor/result-file contract move to whatever the runtime area keeps; GSD owns phase state for planned work, `run_meta.json` stays only for ad hoc orchestrators.
- Source: kit:project/.agents/skills/harness/references/orchestrator-template.md:16-95; kit:project/.agents/skills/harness/SKILL.md:215-224,308-318
- Why it exists: monitor wording avoids replaying/guessing results (see WildEra row on watch-run replay, wildera:.agents/harness-history.md:10); do not retry quota/auth failures because retries only burn remaining quota (orchestrator-template:80).
- Test idea: scripted template test: a run with 2 null agent results reports "2 excluded" via `log()` and the final report names them.

### MTH-32 Template B: persistent agent collaboration
- Behavior: No explicit team object; named agents started with `ph spawn`/fanout belong to one group. Phase 0 as in A, with previous deliverable paths included in agent prompts for partial reruns. Phase 1 creates `_workspace/` and saves input under `_workspace/00_input/`. Phase 2: one fanout file with a block per agent (`=== {name} type={type}` + role, task, output path), started in parallel with `ph fanout --file F --ws _workspace` and no `--collect`; block name = the agent's name for `ph send`. Register tasks: `ph task add --ws _workspace --title ... --assignee ...`, `--depends-on <id>`, 3-6 tasks per teammate. Phase 3: watch with `ph watch <names>` under Monitor, `ph task list`, review via `ph send --prompt` and relay the reply to the author; if teammates need to discuss findings the leader relays messages (a fallback, orchestrator-template:143; the leader also sends a review to a teammate and forwards the reply, line 142); deliverables always in files at `_workspace/{phase}_{name}_{artifact}.md`; use the filesystem batch tools to read/edit. Phase 5: confirm all tasks done, integrate, run `freeze --check`, write final output. Phase 6: keep `_workspace/`, report, `ph archive` the team when closed (`ph stop` only to interrupt a running turn). Error table: unresponsive -> `ph team` status, resend, else spawn the same type under a new name (e.g. `{name}b`) with the task context; quota/auth/permission stop -> no resend, no replacement, inspect partials, record omissions, state reset time, leader uses only directly verified facts; more than half the teammates fail -> tell the user and ask; time limit exceeded -> continue with received results and name unfinished areas; data conflict -> side by side; stale task status -> `task list` then `task update --status`.
- Proposal: KEEP the pattern; CHANGE: the cross-agent coordination uses `ph send`/tasks as owner decision says (Paseo + ph); drop "filesystem MCP" wording.
- Source: kit:project/.agents/skills/harness/references/orchestrator-template.md:99-198
- Why it exists: not stated beyond error table; "leader relays" because there is no team object in the Paseo runtime.
- Test idea: scripted run: a teammate that never responds is replaced by `{name}b` and the final report states "some work was redone".

### MTH-33 Deliverable freeze at phase boundaries (persistent mode)
- Behavior: Named agents still accept messages after reporting done, so a late cross-check answer may revise a file the next phase already reads. Cross-check messages are NOT blocked; instead at every phase boundary: confirm all responsible teammates reported done (`task list`, `watch` completion lines); send them a freeze notice (do not edit existing files; write `{phase}_{teammate}_{artifact}_v2.md` and notify the leader); record hashes with `ph freeze --ws _workspace --phase {phase}`; pass artifact paths and freeze info to next-phase agents; before the final deliverable run `ph freeze --check --ws _workspace --phase {phase}`; on a hash difference or new `_v2` file decide whether to rerun phases that read the old version. `tools:`/`--read-only` are advisory, so freeze plus check is the enforcement.
- Proposal: KEEP (non-obvious incident-driven rule). Needs a `freeze` command or equivalent in the runtime area.
- Source: kit:project/.agents/skills/harness/references/orchestrator-template.md:154-169; kit:project/.agents/skills/harness/references/skill-testing-guide.md:79
- Why it exists: late messages revise deliverables after the next phase started (orchestrator-template:156); advisory read-only can't prevent it.
- Test idea: modify a frozen file after `freeze`; `freeze --check` exits non-zero and names the changed path.

### MTH-34 Template C: subagent delegation
- Behavior: Phase 0 workspace check; Phase 1 prepare `_workspace/`; Phase 2 `ph fanout --file F --collect DIR`: one agent per block, waits for all, writes each final reply, archives them unless `--keep`; table of agent / block `type=` / input / deliverable; custom type name or omitted for general (`read-only=true` for read-only); prompts and names in `--file` blocks, `--type` for a shared type; main agent does not repeat searches already assigned. Phase 3 integrate returned values and files; Phase 4 keep `_workspace/` and report. Errors: one agent fails -> retry once, then state what is missing and continue; do not retry quota/auth/permission; more than half fail -> ask the user. One-shot agents are archived after collection and cannot take follow-ups; name agents (persistent) from the start if a follow-up is possible.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/references/orchestrator-template.md:202-242; kit:project/.agents/skills/harness/references/team-examples.md:41-47
- Why it exists: archived one-shot agents cannot continue (team-examples:47).
- Test idea: fanout of 3 blocks with `--collect` yields 3 reply files plus `<name>.json` and archives the agents.

### MTH-35 Mixed mode and mode transitions
- Behavior: Orchestrator header `## Execution mode: Mixed` plus a table (phase, mode, reason); `**Execution mode:**` at the top of every phase. Transitions must state the handoff path: workflow -> persistent: save returned structured data under `_workspace/` and pass the file path in the agents' prompts; persistent -> workflow: freeze team deliverables (MTH-33) then put the file path list in `args`.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/references/orchestrator-template.md:246-264; kit:project/.agents/skills/harness/SKILL.md:242
- Why it exists: results of earlier phases must not be lost at a mode change (orchestrator-template:264).
- Test idea: every stage of a mixed orchestrator has a mode label and a stated input/output file path.

### MTH-36 Follow-up phrases and re-invocation
- Behavior: Orchestrator `description` includes rerun/run again/update/revise/add, "redo only {part} of {domain}", "based on previous results", "improve the results", and everyday domain words. Agent definitions state how to be re-invoked: read the previous output file; if feedback is given revise only that part.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:308-319; kit:project/.agents/skills/harness/references/orchestrator-template.md:280-289
- Why it exists: otherwise the orchestrator is not selected after the first run (orchestrator-template:289).
- Test idea: trigger test (MTH-52) includes at least three follow-up phrasings that must select the orchestrator.

### MTH-37 `CLAUDE.md` harness entry
- Behavior: After configuring, `CLAUDE.md` gets only `## Harness: {domain}`, `**Goal:**` one line, `**Invocation conditions:**` "When asked to do work related to {domain}, use the `{orchestrator-skill-name}` skill. You may answer simple questions directly." No agent/skill lists, directory structure or execution rules (read in every session). First configuration and every later change go in `.agents/harness-history.md` (columns Date, Change, Scope with repo-relative paths, Reason). Step 0 and the final check compare `CLAUDE.md` with the real files.
- Proposal: KEEP the minimal entry; CHANGE the carrier: where this entry lives in the new kit (CLAUDE.md vs a kit block) is an install-area decision. Note the kit also has a common `AGENTS.md` block; do not triple-bookkeep.
- Source: kit:project/.agents/skills/harness/SKILL.md:294-306; kit:project/.agents/skills/harness/SKILL.md:17,40,377
- Why it exists: `CLAUDE.md` is read every session; detail there costs tokens every time (SKILL.md:296).
- Test idea: lint: the harness section in `CLAUDE.md` has no more than the three fields and names an existing orchestrator skill.

### MTH-38 Data transfer methods
- Behavior: Five methods: structured return value (workflow `agent(prompt,{schema})` returns validated JSON; next stage in code), ordinary return value (`ph result NAME` final reply, subagents), message (`ph send`, persistent agents), shared task list (`ph task add/update/list`, persistent agents: progress, dependencies, dynamic assignment), file (all modes; large data or later inspection).
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:244-252
- Why it exists: not stated [UP], commands swapped [KIT].
- Test idea: each stage of a generated orchestrator names its transfer method from the five.

### MTH-39 File conventions in `_workspace/`
- Behavior: Intermediate outputs under `_workspace/` of the working directory; filename `{phase}_{agent}_{artifact}.{ext}` (e.g. `01_analyst_requirements.md`); final outputs only at the user-specified path; keep `_workspace/` for post-run verification (never delete). A new input moves the old `_workspace/` to a timestamped directory.
- Proposal: KEEP for ad hoc harnesses; GSD planned work keeps state in `.planning/` instead (no overlap if each owns its tree).
- Source: kit:project/.agents/skills/harness/SKILL.md:254-258,314-316; kit:project/.agents/skills/harness/references/team-examples.md:144-149
- Why it exists: post-run verification and harness-evolve read these traces (harness-evolve SKILL:26-29).
- Test idea: after a run every intermediate file name matches the regex `^\d+_[a-z0-9-]+_[a-z0-9_-]+\.[a-z]+$` or sits under a known subfolder.

### MTH-40 Error-handling policy for orchestrators
- Behavior: Retry once; if it fails again continue without that result and note the omission in the final report; never delete conflicting data, keep it with sources. Do NOT retry failures that repeat identically (usage limit, expired auth, denied permission): retrying only burns the remaining limit; open partial outputs to see real progress, record the omission in a file, report to the user, state the reset time for usage limits. When the orchestrator fills a gap left by a stopped agent it includes only directly verified facts and never guesses the agent's judgment (e.g. why it excluded a source): a guess would falsify the record needed for post-run verification. A failed/skipped workflow `agent()` returns `null`; `parallel()` does not throw, so `.filter(Boolean)` and `log()` the missing count. A silent persistent agent: check status, re-instruct with `ph send`, then spawn the same custom type under a new name.
- Proposal: KEEP (strong, incident-flavored rules).
- Source: kit:project/.agents/skills/harness/SKILL.md:260-270; kit:project/.agents/skills/harness/references/orchestrator-template.md:74-83,176-185,238-241
- Why it exists: stated in text: retrying consumes remaining limit; guessing falsifies verification record (SKILL.md:265-266). Nothing dated.
- Test idea: a mock agent failing with a quota error is not retried and the report states the reset time field.

### MTH-41 Work-size table
- Behavior: Small (<10 tasks): 2-3 persistent agents, 2-5 workflow `agent()` calls; medium (10-20): 3-5 persistent, about 10 (calls queue automatically above the concurrency limit); large (>20): supervisor + 3-5 workers, dozens to hundreds, overall limit 1,000 agents (config key `max_agents_per_workflow` 1000, kit:project/.agents/harness.defaults.json:84). More agents = more management overhead; keep default small. A user token budget such as `+500k` is honored by checking `budget.remaining()` in the script.
- Proposal: KEEP (numbers re-check against the new runtime's `max_subagents`, which is 20 in WildEra/kit defaults: kit:project/.agents/harness.defaults.json:83).
- Source: kit:project/.agents/skills/harness/SKILL.md:272-280,292; kit:project/.agents/harness.defaults.json:83
- Why it exists: not stated for the table [UP?]; the 20 cap is a RAM incident (kit:project/.agents/harness.defaults.json:2, 30-agent partition run exhausted 32 GB).
- Test idea: a workflow with 25 `agent()` calls never runs more than `max_subagents` at once.

### MTH-42 Preflight a fan-out
- Behavior: Before a workflow over many items run 2-3 representative items through every stage end to end, including the scripted stages after the agents (apply, check, activate, publish), and fix what fails. Systemic defects (missing contract field, tool bug, wrong path in the prompt) otherwise fail every item at once.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:281-285
- Why it exists: spec scaffold, 2026-10-04: 0 of 38 approved families passed their first check (SKILL.md:284-285) [KIT].
- Test idea: orchestrator template for N>=10 items contains a preflight step that runs on a 2-3 item sample before the full run.

### MTH-43 Scripts own bookkeeping; agents own judgement
- Behavior: For outputs with mechanical invariants (every input item placed exactly once, exact schemas, ordering, derived fields, digests) write a script that produces or repairs them; agents decide only semantic choices.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:286-289
- Why it exists: low-effort models fail long lists of exact IDs: 57 of 112 partition plans failed validation on bookkeeping alone; a repair script fixed all 57 in seconds (SKILL.md:287-289) [KIT].
- Test idea: a partition output with a deliberately missing item is repaired by the script and passes validation without an agent call.

### MTH-44 Keep prompts and inputs small
- Behavior: Pass paths, not content (`max_prompt_bytes` 262144, kit:project/.agents/harness.defaults.json:108); give per-item extracts of large data; measured limits (RAM per agent, prompt size, file size) live in `paseo-runtime.md` 6-3 (runtime area; not read here).
- Proposal: KEEP; limits belong to runtime area.
- Source: kit:project/.agents/skills/harness/SKILL.md:290-291; kit:project/.agents/harness.defaults.json:2 (max_prompt_bytes)
- Why it exists: a 42 MB prompt made the daemon drop the runner socket (kit:project/.agents/harness.defaults.json:2).
- Test idea: an orchestrator prompt-builder passes file paths; a prompt over `max_prompt_bytes` is refused.

### MTH-45 Follow-up, partial rerun and workflow resume
- Behavior: Orchestrator step 0 distinguishes: `_workspace/` present + partial change -> rerun only that stage/agent; present + new input -> move old dir to a timestamped dir and start again; absent -> start fresh; previous workflow `runId` known -> edit the script file and resume with `ph workflow --script F --args-file F --resume <runId>`. `--resume <runId>` WITHOUT `--script` reruns the earlier run's own copy and skips edits (use only to repeat an unchanged run). `runId` stored in `_workspace/run_meta.json`. The quota-recovery resume in Template A (orchestrator-template:80) omits `--args-file`, which line 48 includes (MTH-73).
- Proposal: KEEP; the resume-needs-the-edited-script note is a trap worth keeping.
- Source: kit:project/.agents/skills/harness/SKILL.md:310-319; kit:project/.agents/skills/harness/references/orchestrator-template.md:47-49
- Why it exists: a resume of an unedited copy silently ignores edits (SKILL.md:317) [KIT].
- Test idea: edit a script then resume with `--script`; the changed phase reruns while unchanged cached calls return immediately.

### MTH-46 Structure validation checks (step 6-1/6-2)
- Behavior: Check every agent file location; skill YAML has `name`+`description`; cross-referenced agent names match; no files in `.claude/commands/`; no v1 mechanisms (`TeamCreate`, `TeamDelete`, `team_name`, experimental flags; `broadcast` is also banned by orchestrator-template:278 but is not in the step 6-1 grep list, SKILL.md:330); no in-session primitives. By mode: workflow -> `meta` is a literal, no `Date.now()`/`Math.random()`, `parallel()` only when waiting for all results, `.filter(Boolean)` present, `phase()` titles match `meta.phases`; persistent -> `ph send` sender/receiver paths, task dependencies, agent count; subagent -> each agent's input/output connect, parallel calls grouped in one `ph fanout` file, all results collected; hybrid -> every stage states its mode and data does not break at boundaries.
- Proposal: KEEP and turn into a scripted linter (the new kit should ship it; the old kit has checks only as prose in SKILL.md).
- Source: kit:project/.agents/skills/harness/SKILL.md:320-338
- Why it exists: not stated; `Date.now()`/`Math.random()` break resume caching [UP?] (inference; the file does not say why).
- Test idea: linter fixtures: a workflow with `Date.now()` in `meta` fails; one with mismatched `phase()` title fails.

### MTH-47 Skill test: with-skill vs baseline runs
- Behavior: For each of 2-3 realistic test prompts (one core, one edge, optionally multi-task; natural wording, mixed formal/casual, with specifics like paths and column names, some typos) run two Paseo agents concurrently in one `ph fanout --collect`: with-skill (reads the skill; output to `_workspace/iteration-N/eval-{id}/with_skill/outputs/`) and baseline (no skill; `.../without_skill/outputs/`). Baseline: new skill = no skill; improving a skill = a preserved copy of the pre-change skill. Qualitative (user reads) for style/creative skills; quantitative (assertions) for objectively checkable skills. Fix problems with generalizable principles, retest, repeat until diminishing returns.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:340-346; kit:project/.agents/skills/harness/references/skill-testing-guide.md:25-91
- Why it exists: not stated [UP].
- Test idea: running the procedure on a toy skill produces both output folders and a timing.json per run.

### MTH-48 Blind A/B workflow
- Behavior: With >= 3 cases or repeated validation (and only after the user agrees to run tests), run a workflow `skill-ab-test`: per eval, `parallel` a with-skill agent and a baseline agent, each saving to its labelled folder and to a neutral `blind/A|B/outputs/` (slot assigned by `withSkillSlot`, alternated A/B per case by the main agent); schema RUN_RESULT {saved, files>=2}; grading skipped (with `log()`) unless both runs completed and saved >= 2 files; grader agent sees only `blind/A` and `blind/B`, must verify both exist, must not open `eval_metadata.json`, `with_skill/` or `without_skill/`, returns per-slot expectations/summary and `comparison.preferred` (A|B|tie); the script maps slots back to `with_skill`/`baseline`/`tie`; mapped results saved to each run's `grading.json`; grading starts per case as it finishes; after editing the skill, rerun with `--resume <runId>` so unchanged cases use cached results. The upstream `Workflow` tool and its `resumeFromRunId` are not runtime operations here.
- Proposal: KEEP as an optional reference recipe (not core).
- Source: kit:project/.agents/skills/harness/references/skill-testing-guide.md:94-170; kit:project/.agents/skills/harness/SKILL.md:343
- Why it exists: graders must not know which run used the skill (skill-testing-guide:170).
- Test idea: grader prompt contains no `with_skill`/`without_skill` path; slot mapping inverts correctly when `withSkillSlot` is B.

### MTH-49 Assertions and graders
- Behavior: Good assertions are objectively true/false, clear from wording, and measure an outcome that improves with the skill; bad: always pass without the skill ("output exists") or subjective ("well written"). Code-checkable assertions get scripts reused every iteration. Assertions passing 100% in both with-skill and baseline do not discriminate: delete or tighten. Specialist roles: grader (every iteration: pass/fail + evidence, cross-check factual claims, critique the assertions), anonymous comparator (shuffled A/B, rigor check that a new version is better), analyzer (after >= 3 iterations: non-discriminating assertions, high-variance evals, time/token tradeoffs). Roles run as Paseo agents via fanout or the A/B workflow; freeze and check inputs when a reviewer must not change them.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/references/skill-testing-guide.md:174-200
- Why it exists: not stated [UP].
- Test idea: an assertion-lint step flags assertions with equal pass rate across both arms.

### MTH-50 Iteration procedure and test workspace layout
- Behavior: Principles: generalize feedback, remove instructions that do not help (read work logs), explain the reason, bundle repeated helpers into `scripts/`. Sequence: edit skill -> rerun all cases into a new `iteration-{N+1}/` -> show results compared to the previous iteration -> feedback -> repeat; stop when the user is satisfied, there is no feedback, or no meaningful improvement. Re-read the draft as a fresh reviewer. Layout: `_workspace/iteration-N/eval-<descriptive-name>/{eval_metadata.json, with_skill/, without_skill/, blind/}`, `benchmark.json`, `_workspace/evals/evals.json`; descriptive eval names (not numbers); never overwrite an earlier iteration; never delete `_workspace/`.
- Proposal: KEEP the iteration rules and layout; the quantity of ceremony (benchmark.json, evals.json) is optional.
- Source: kit:project/.agents/skills/harness/references/skill-testing-guide.md:204-283
- Why it exists: post-hoc verification and change tracking (skill-testing-guide:283).
- Test idea: running iteration 2 never writes into `iteration-1/`.

### MTH-51 Dry run and test scenarios section
- Behavior: Dry run checks: stage order is logical; data-transfer paths do not break midway; each agent's input equals the previous stage's output; fallback procedures can actually run. The orchestrator skill gets a `## Test scenarios` section with at least one normal-flow and one error-flow scenario.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness/SKILL.md:355-364
- Why it exists: not stated [UP].
- Test idea: lint: orchestrator has `## Test scenarios` with both flows.

### MTH-52 Trigger (description) validation
- Behavior: Per skill: 10 should-trigger requests (varied wording and explicitness, rarely-used cases, no file type specified, overlapping with another skill but should select this one) and 10 should-NOT-trigger near misses (similar wording, better served by another tool/skill; obvious unrelated requests are worthless; e.g. for an image skill: "extract the chart in this Excel file as a PNG" not "write a Fibonacci function"); concrete details in requests. Check conflicts with existing skills by collecting all descriptions and sharpening scope/exclusions. Evolve phase uses at least 3+3. Optional optimization: 60/40 train/test split, up to 5 iterations, choose the description by the TEST set (training selection overfits). Mechanics: run each request in a fresh Paseo agent, `ph result --json` and read its `skills` field; do not use headless `claude -p`; expensive, final step after the skill is stable.
- Proposal: KEEP; CHANGE the mechanism to the new runtime's per-agent skills-used result (keep the "no headless `claude -p`" rule only if still true).
- Source: kit:project/.agents/skills/harness/SKILL.md:348-353,394; kit:project/.agents/skills/harness/references/skill-testing-guide.md:228-260; kit:project/.agents/skills/harness-evolve/SKILL.md:76
- Why it exists: not stated why `claude -p` is excluded (inference: it bypasses Paseo and the provider); mark UNVERIFIED.
- Test idea: script feeds 20 labelled requests to fresh agents and reports trigger precision/recall from the `skills` field.

### MTH-53 Operate and maintain an existing harness
- Behavior: Compare `.agents/agents/`, `.agents/skills/` and the orchestrator and list inconsistencies for the user; change one item at a time and validate immediately; record date/change/scope/reason in `.agents/harness-history.md`; validate structure, run invocation tests if triggers changed, run execution tests and a dry run for broad changes, finally check `CLAUDE.md` matches the files. Propose `harness-evolve` when the same feedback appears at least twice, agents fail repeatedly for the same reason, or the user keeps doing the work manually instead of using the orchestrator.
- Proposal: KEEP; the three evolve triggers are cheap and testable.
- Source: kit:project/.agents/skills/harness/SKILL.md:366-383
- Why it exists: "a harness is not an output you create once" (SKILL.md:368).
- Test idea: n/a (guidance); the audit step produces an inconsistency list with file paths.

### MTH-54 Output checklist
- Behavior: Final checklist (17 items): agent files for reusable types only; SKILL.md + references; one orchestrator skill with data-transfer, errors and test scenarios; modes stated and hybrid stages labelled; model per agent with reason comment and no blanket top tier; no v1 mechanisms; workflow scripts use `.filter(Boolean)`, literal-only `meta`, `parallel()` only when needed; trigger checks via `ph spawn` + `ph result --json` or a workflow, not `claude -p`; nothing in `.claude/commands/`; overlap check done; outputs in English; description carries triggers and follow-up phrases; SKILL.md < 500 lines; 2-3 realistic test runs; trigger validation with positive and boundary cases; `CLAUDE.md` holds only invocation conditions and history lives in `.agents/harness-history.md`; step 0 handles first/follow-up/partial runs and workflow resume.
- Proposal: KEEP as an automated gate rather than prose where possible.
- Source: kit:project/.agents/skills/harness/SKILL.md:385-403
- Why it exists: consolidates earlier rules.
- Test idea: checklist items 1-8 and 10-13 are encoded as lint rules and pass on a generated sample harness.

### MTH-55 Generated artifacts are written in English
- Behavior: Agent definitions, skills, orchestrators and `CLAUDE.md` entries are written in English whatever language the user chats in; replies to the user stay in the user's language; another language only when the user explicitly asks for these files. `harness-evolve` repeats it and requires translating a still-non-English target file in the same change rather than mixing languages.
- Proposal: KEEP (owner decision stands).
- Source: kit:project/.agents/skills/harness/SKILL.md:19,397; kit:project/.agents/skills/harness-evolve/SKILL.md:62; kit:project/.agents/skills/harness/NOTICE.md:16-17
- Why it exists: owner decision 2026-10-03; upstream wrote outputs in the conversation language [KIT].
- Test idea: generate a harness from a prompt in another language; all generated files are English.

### MTH-56 Illustrative team examples
- Behavior: Five worked examples with composition and a "why this mode": (1) research team: workflow, fan-out + adversarial verification, researcher/fact-checker agents with rebuttal-first principle, conflicting info kept with sources; (2) sci-fi writing: mixed (persistent worldbuilder/character/plot agents via `spawn --name`, `--count`; one-shot stylist; parallel one-shot reviewers; stylist must be named from the start to take follow-ups); (3) code review: workflow `pipeline` where each perspective's findings are verified as soon as that review finishes (no barrier), or gather all first and verify behind a barrier when cross-comparison is needed; (4) large migration: workflow if batches are known in advance, else persistent supervisor (see MTH-16); (5) webtoon: persistent artist + one-shot reviewer, PASS/FIX/REDO, at most two revision rounds, if 50% or more panels are REDO suggest revising the prompt, unresolved items reported with reasons. Artifact storage rules repeat MTH-39.
- Proposal: DROP the domain-specific narrative (novel, webtoon) and keep two compact examples (workflow code review with verification; persistent-pair producer/reviewer with retry cap) as test fixtures for the linter.
- Source: kit:project/.agents/skills/harness/references/team-examples.md:9-150
- Why it exists: teaching examples [UP]; v1 note that findings were shared with `SendMessage` (team-examples:83).
- Test idea: the retained examples pass the MTH-46 linter.

### MTH-57 harness-evolve Phase 1: collect the delta
- Behavior: Read `.agents/agents/`, `.agents/skills/`, `CLAUDE.md` (invocation conditions only) and `.agents/harness-history.md`. In a git repo inspect `git log --oneline -- .agents/ .claude/ AGENTS.md CLAUDE.md`; without git the history file is the only record. Inspect `_workspace/` artifacts from recent runs: do they exist at the orchestrator's paths (else the workflow was bypassed or has dead code), do they follow the skill's quality/format requirements, for workflow runs read `_workspace/_runs/*/run.json` (status, agent counts) and `journal.jsonl` (each agent's return value and the reason of every `null`; repeated reasons = failure pattern). Ask the user for feedback unless already given; do not pressure when there is none, but propose improvements when signals are present. Signals: same revision request 2+ times; agents repeatedly failing/retrying; user bypassed the orchestrator (suspected trigger failure -> widen description); v1 artifacts; in-session primitives instead of `ph`.
- Proposal: KEEP; CHANGE paths of run records to the new runtime's run directory layout.
- Source: kit:project/.agents/skills/harness-evolve/SKILL.md:20-40
- Why it exists: not stated [UP], run-record reading is [KIT] (refers to paseo-runtime 6-5).
- Test idea: given a fixture repo with two identical revision requests in history, the skill proposes an evolution without user feedback.

### MTH-58 harness-evolve Phase 2: classify feedback and map targets
- Behavior: Mapping: output quality -> the agent's skill; agent role -> agent definition (adding/deleting agents or redesign is NOT done here: direct to the `harness` skill, step 0 extension path); workflow order -> orchestrator skill; team composition -> orchestrator + agents; missing trigger -> skill description; unsuitable execution mode -> orchestrator (e.g. repeated same fan-out is slow -> workflow mode); scale/cost -> orchestrator (reduce default scale, add budget integration). Evolve adjusts existing configuration only.
- Proposal: KEEP.
- Source: kit:project/.agents/skills/harness-evolve/SKILL.md:42-54
- Why it exists: separation of adjust (evolve) from redesign (harness).
- Test idea: feedback "security review also needed" yields a hand-off to the design skill, not an edit by evolve.

### MTH-59 harness-evolve Phases 3-5: generalize, record, verify, report
- Behavior: Generalize feedback (do not turn "intro too long in this report" into "intro < 10%"; find why: no length-allocation guidance, fix the principle); record the why next to the changed instruction; apply one change at a time and run Phase 4 after each; prevent regression: if a change would undo an earlier history entry, tell the user and confirm (find a criterion satisfying both); write in English. Phase 4: append a row to `.agents/harness-history.md` (never `CLAUDE.md`); if a skill folder was added run `skills-sync` before testing; verify structure; if a description changed validate triggers (>= 3 should-trigger + 3 near-miss); final `CLAUDE.md` consistency check; when a change touches runtime/these two skills/hooks/kit AGENTS block that apply to every project, tell the user it can go back to the kit (`install.mjs status <project>`, `install.mjs pull <project>`); project-only settings belong in `.agents/harness.config.json` which the kit never overwrites. Phase 5 report: delta summary, changes + generalization basis, feedback not applied and why, expected next-run improvements. Principles: the delta is an asset (never erase history); do not apply without generalizing; one change at a time.
- Proposal: KEEP phases 3-5 and principles; DROP the kit pull step into the install area (it is a maintainer workflow, not a method).
- Source: kit:project/.agents/skills/harness-evolve/SKILL.md:56-92
- Why it exists: overfitting (a pile of single-case rules) and ambiguity from batched changes (SKILL principles 90-92).
- Test idea: two contradictory feedbacks in history/feedback produce a conflict notice, not a silent edit.

### MTH-60 `harness-history.md` record format
- Behavior: File `.agents/harness-history.md`, seeded by the installer from the kit template (not overwritten): header explaining that it records agents, skills, orchestrators and runtime scripts, that `CLAUDE.md` does not import it, and that only `harness` and `harness-evolve` read it; "One row per change, newest last. Scope lists repo-relative paths. Reason says why the change was made, not what it is." Table `| Date | Change | Scope | Reason |`. WildEra instance: 47 lines, rows 2026-10-14..2026-10-19, ISO dates, long free-text Change and Reason cells naming incidents (e.g. owner feedback, run ids, measurements), Scope as comma-separated repo paths or directories; the 2026-10-14 rows carry verification claims ("Kit tests 85/85 pass", lines 9-10); the 2026-10-19 list-price costing row (line 46) has only Date and Change cells, its "Why" sits inside Change and Scope and Reason are absent. Skill spec example row uses `skills/content-creator` without the `.agents/` prefix (not a repo-relative path).
- Proposal: KEEP the 4-column table; CHANGE: keep rows short and move long narratives to linked notes; fix the Reason-in-Change drift with a lint (4 non-empty cells).
- Source: kit:templates/harness-history.md:1-8; wildera:.agents/harness-history.md:1-8; wildera:.agents/harness-history.md:9-10,46; wildera:.agents/harness-history.md:9-47 (rows); kit:project/.agents/skills/harness-evolve/SKILL.md:66-72
- Why it exists: the delta is an asset (harness-evolve:90).
- Test idea: a table-lint over a history file requires 4 non-empty cells per row and ISO dates in non-decreasing order.

### MTH-61 `ai-orchestrator` skill: Definition of Done
- Behavior: Skill `ai-orchestrator` (description: coordinate AI agents when asked to delegate work or complete a task using multiple agents). Body: up to `max_subagents` agents at once, text says "currently 20" (hard-coded copy of the config value `max_subagents` 20) through the existing harness; choose coordination "to complete the task as quickly as possible with high quality" (SKILL.md:8); derive a verifiable Definition of Done (DoD) from the request BEFORE execution; the orchestrator is responsible that the final integrated result passes verification against the DoD before declaring completion; failed checks guide corrections within the affected scope. The skill has no mode selection or procedure: it is a prompt-level rule set.
- Proposal: CHANGE: fold the DoD rule into the new kit's orchestration rules (the harness `team-design` skill plus GSD verification); do not ship a separate generic skill unless trigger tests (MTH-52) show it fires for "delegate/complete using multiple agents". Read `max_subagents` from config, do not hard-code 20.
- Source: kit:project/.agents/skills/ai-orchestrator/SKILL.md:1-12; wildera:.agents/skills/ai-orchestrator/SKILL.md:1-12; kit:project/.agents/harness.defaults.json:83; kit:CHANGELOG.md:11
- Why it exists: kit 0.1.0 added it as a new skill (kit:CHANGELOG.md:11); WildEra copy is byte-identical. Reason otherwise not stated.
- Test idea: given a delegated task with no stated criteria, the first orchestrator output lists DoD checks; completion is declared only after each check is reported.

### MTH-62 Overlap with GSD: ownership split (method vs GSD)
- Behavior: Today the harness skill describes a generic 7-step lifecycle (inspect, analyze, design mode/team, agents, skills, orchestrator, validate, operate) for building teams, while WildEra layers GSD (`gsd-plan`, `gsd-discuss`, `gsd-research`, `gsd-verify`, `gsd-debug`) and `code-wave` on top (wildera:.agents/harness-history.md:43-47). The two overlap in: phased execution, plan/verify loops, `_workspace/` vs `.planning/` state, review gates, test scenarios vs verify obligations, history rows vs summaries.
- Proposal: CHANGE. GSD owns: phase lifecycle (discuss -> research -> plan -> plan review -> execute in waves -> verify), `.planning/` state, planner/checker/verifier/debugger agents, verification obligations, gap closure. Harness method owns: choosing execution mode and team pattern (MTH-02, 07), building agent/skill/orchestrator files (MTH-10..30), QA/verification patterns (MTH-08, 17), model tiers as role vocabulary (MTH-12, 13; concrete models in the adapter), skill writing/testing (MTH-22..29, 47..52), and harness evolution (MTH-57..60). The generated orchestrators used by a project (code-wave type) are produced by the method and invoked by GSD execute. `_workspace/` stays for ad hoc orchestrations only; planned work never writes state outside `.planning/`.
- Source: kit:project/.agents/skills/harness/SKILL.md:21-31,207-211; wildera:.agents/harness-history.md:43-47
- Why it exists: owner decision 2026-10-20 (task block): GSD core ships in the kit; adapter supplies project specifics.
- Test idea: grep shows no lifecycle phase definitions in the method skills and no agent-building rules in GSD skills.

### MTH-63 `ai-orchestrator` waiting rule
- Behavior: Never wait with a self-written sleep/grep polling loop. For a batch use `ph fanout --file F --collect DIR` in the foreground (returns when every reply is collected). For agents started without `--collect` (`ph spawn`, `ph send`, `ph fanout`) and for `ph workflow --detach`, follow the `next:` line those commands print: `ph watch <names>` or `ph watch-run <runId>` under Monitor.
- Proposal: KEEP the rule; place it in the runtime/workflow area's operator guidance (it is about `ph` output, not method) and keep the `next:` line contract in `ph`.
- Source: kit:project/.agents/skills/ai-orchestrator/SKILL.md:14-16; wildera:.agents/skills/ai-orchestrator/SKILL.md:14-16; wildera:.agents/harness-history.md:9
- Why it exists: owner saw the orchestrator background a `fanout --collect` and poll its output with a hand-written sleep/grep loop (wildera:.agents/harness-history.md:9); WildEraV6 commit 91c3239 "Print the wait command after ph launches agents" (git log of the WildEraV6 skill folder; its `git show --stat` lists harness-history.md, runtime/commands.mjs and ai-orchestrator/SKILL.md; it is not a commit of the kit repo).
- Test idea: `ph spawn`, `ph send`, `ph fanout` without `--collect`, and `ph workflow --detach` each print a `next:` line naming the exact watch command.

### MTH-64 WildEra method evolutions the new kit should absorb (review gate, session reuse)
- Behavior: Lessons from WildEra history that change the generic method and are not in the kit's harness skill: (a) bounded review gate instead of review/fix/re-review loops: Verify until green -> one review pass where each finding has trigger, likelihood %, confidence 0-100, impact -> a finding blocks only with a trigger, confidence >= 80 and above theoretical likelihood -> independent finding-verifier agent confirms/refutes/uncertain by tracing the trigger -> one fix pass -> resolution check of those findings only (no new findings) -> unresolved escalate; a high with no finding-verifier verdict is `unverified` and still blocks, instead of counting as `confirmed` (history:43), is retried once and then escalated, never sent to the fixer (history:44); normal findings do not block and were collected per task (`deferredFindings`) for a follow-up Backlog task (history:40; Backlog is dropped, see MTH-71 and OPEN Q9); the earlier rule that a re-reviewer reviews the whole change again for new defects (history:19) is superseded by the resolution-check-only rule (history:42), CONFLICT, later side wins; (b) fixer keeps the coder's session, reviewer is fresh and independent (workflow `session` option); (c) review only built code (code -> verify -> review -> fix -> verify -> re-review); (d) non-converging loops stop early (maxFixRounds 4, maxStalledRounds 2); (e) never `ph send` to a mid-turn agent: batch follow-ups, send when idle; (f) transient provider errors retried in the same agent with pauses 30/60/120/240/300 s up to 5; quota/auth/credit/permission stop at once; (g) scripts own mechanical verification (cf. MTH-43).
- Proposal: CHANGE: adopt (a),(b),(c),(e) as method patterns replacing the bare majority-vote adversarial pattern in MTH-08 as default for code review; (d),(f) belong to the workflow/runtime areas.
- Source: wildera:.agents/harness-history.md:17,18,19,22,25,34,40,42,43,44,20
- Why it exists: stated per row (e.g. reviewers wrong too and review rounds kept producing new findings, row 42; re-reviews found 8-16 new normal findings per round and never converged, row 40; 3 quick sends interrupted a working debugger, row 17).
- Test idea: a review-gate fixture where a high finding lacks a trigger is downgraded and does not block.

### MTH-65 Attribution, license and port provenance
- Behavior: `harness` and `harness-evolve` are a modified port of Harness v2 by revfactory (https://github.com/revfactory/harness, version 2.1.0, commit 92d9f1b29e7af81acebf51a9fcd1832e739a1414, 2026-09-28), Apache-2.0, with `LICENSE` in the skill folder. Declared changes (2026-10-02): translated Korean -> English; primitives moved to Paseo/`ph`; added `references/paseo-runtime.md` and `scripts/`; evolve is a project skill `harness-evolve` (upstream plugin skill `harness:evolve`); English output decision (2026-10-03); packaged as the kit (2026-10-06) with `install.mjs`, `.agents/harness.config.json`, `machine.mjs`. NOTICE.md:5 names a `LICENSE` in the folder (a directory listing also showed it, with SKILL.md, references and scripts). NOTICE.md:10-11 lists the moved primitives: `Workflow`, `Agent`, `SendMessage`, `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`, `TaskStop`.
- Proposal: KEEP NOTICE and LICENSE for any retained upstream-derived text (Apache-2.0 requires notice of modifications); if the new kit rewrites the method from scratch, say so and keep attribution for ideas that survive (OPEN Q4).
- Source: kit:project/.agents/skills/harness/NOTICE.md:1-20
- Why it exists: license compliance.
- Test idea: install check asserts `NOTICE.md` and `LICENSE` exist in the method skill folder.

### MTH-66 Composite patterns
- Behavior: Real tasks combine patterns: fan-out/fan-in + producer-reviewer (produce several proposals, review each; example four-language translation with native reviewers); pipeline + fan-out/fan-in (sequential analysis, parallel implementation, sequential integration test); supervisor + expert pool (supervisor classifies, assigns the right expert; customer support); exploration + adversarial verification + synthesis (explore by multiple criteria, verify each finding, review omissions, write the report; code audit, in-depth research). Each stage of a composite picks its own mode by whether that stage's control flow can be defined in code in advance (mixed-mode design).
- Proposal: KEEP the "codable stage -> workflow, else persistent/subagent" rule; keep the four composites as one table, examples short.
- Source: kit:project/.agents/skills/harness/references/team-patterns.md:139-150
- Why it exists: not stated [UP].
- Test idea: a design for a composite task labels each stage with a mode and a one-line reason about codability.

### MTH-67 QA guide: read-only conflict, priorities, checklist rows, fix channels
- Behavior: (a) CONFLICT on QA tool rules: SKILL.md:143 lets a QA agent that only runs non-mutating checks stay read-only; qa-agent-guide:87 says an `Explore`-type (read-only) agent cannot do QA, forbids `--read-only`, and says a `tools:` field, if present, must include Bash, Edit and Write; qa-agent-guide:214 says the `qa-inspector` gets no `tools:` list and no `--read-only`. (b) Verification priorities in the QA template: 1 integration coherence (highest), 2 functional specification compliance (APIs, state machines, data models), 3 design quality (colors, fonts, responsive behavior), 4 code quality (unused code, naming). (c) Checklist/comparison rows not in MTH-19: a type-assertion or `any` bypass of type safety (line 96); hooks unwrap object-wrapped responses such as `{ items: [...] }` (line 159); dynamic segments (`[id]`) receive correct parameter values (line 167); a frontend branch on `status === "X"` must test a state that can actually be reached (line 173). (d) Two fix channels: a persistent teammate gets `ph send --prompt` with file:line and the fix; inside a workflow the findings are returned to the orchestrator, which routes the request (line 209).
- Proposal: CONFLICT resolved in the rewrite as: no `Explore`-like type; `--read-only` only for a checker that is explicitly non-editing; the editable inspector has no `tools:` list. KEEP (b), (c), (d).
- Source: kit:project/.agents/skills/harness/SKILL.md:143; kit:project/.agents/skills/harness/references/qa-agent-guide.md:87,96,159,167,173,195-198,209,214
- Why it exists: QA that cannot run scripts or edit cannot compare both sides (qa-agent-guide:87).
- Test idea: lint: a QA agent file has neither `--read-only` use nor a `tools:` list; the template names the four priorities in order.

### MTH-68 Agent-definition recovery and split rules
- Behavior: If a tool listed in a definition is missing for an agent, the orchestrator does that work (example: the leader updates task status with `ph task update`) or the `tools` restriction is removed from the definition. If extending an existing agent would give it two or more roles, consider splitting it first.
- Proposal: KEEP both (the recovery path is the enforcement story once `tools:` is advisory).
- Source: kit:project/.agents/skills/harness/references/team-patterns.md:235,257
- Why it exists: persistent agents confirm usable tools in their first reply (team-patterns:213,235); one role per agent keeps reuse easy (team-patterns:257).
- Test idea: a persistent agent whose first reply reports `ph task` unusable makes the leader take over status updates.

### MTH-69 `project/` path prefix in generated instructions
- Behavior: SKILL.md tells the agent to read and write `project/.agents/agents/`, `project/.agents/skills/` and `project/CLAUDE.md` (lines 14, 27, 102, 150, 154, 387-388) and team-examples:146-147 says `project/.agents/agents/{name}.md`; team-patterns:266, harness-evolve:24 and the seed `harness-history.md:3` use `.agents/` and `CLAUDE.md`. CONFLICT: `project/` is the kit repo layout (files installed into a project live under `project/`), wrong once the skill runs inside an installed project.
- Proposal: CHANGE: generated and method text use `.agents/` and `CLAUDE.md` only.
- Source: kit:project/.agents/skills/harness/SKILL.md:14,27,102,150,154,387-388; kit:project/.agents/skills/harness/references/team-examples.md:146-147; kit:project/.agents/skills/harness/references/team-patterns.md:266; kit:project/.agents/skills/harness-evolve/SKILL.md:24; kit:templates/harness-history.md:3
- Why it exists: not stated; upstream layout leaked into the port.
- Test idea: grep of the method skill text finds no `project/.agents` or `project/CLAUDE.md`.

### MTH-70 Non-Claude provider model names
- Behavior: The harness skill says agents of any Paseo provider can run the harness: name `codex/<model>`, `opencode/<model>` and so on in a tier or `--model`; the defaults note repeats that a tier maps to `circle/...`, `codex/...` or `opencode/...`.
- Proposal: DROP the `codex/` and `opencode/` examples (owner 2026-10-20: Claude Code is the only harness); tier and `--model` examples name only a tier or `circle/<model>`.
- Source: kit:project/.agents/skills/harness/SKILL.md:150; kit:project/.agents/harness.defaults.json:2
- Why it exists: the kit was harness-neutral in 0.0.1 (kit:CHANGELOG.md:53).
- Test idea: grep of the method text finds no `codex/` or `opencode/`.

### MTH-71 Where non-blocking review findings go (Backlog dropped)
- Behavior: In the WildEra gate normal findings are collected per task (`deferredFindings`) for a follow-up backlog task, and `tools/review-metrics.mjs` later reports their fate. Backlog.md is dropped in the new kit (owner 2026-10-20), so the record target is undefined.
- Proposal: OPEN: DROP the Backlog task; record deferred findings in a review log and/or a `.planning/` note (Q9).
- Source: wildera:.agents/harness-history.md:40,42
- Why it exists: re-reviews found 8-16 new normal findings per round and never converged (wildera:.agents/harness-history.md:40).
- Test idea: a gate run with two normal findings leaves them in the chosen record and the wave still passes.

### MTH-72 Moved in-session primitives and the v1 ban list
- Behavior: NOTICE lists the primitives moved off Claude Code in-session tools: `Workflow`, `Agent`, `SendMessage`, `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`, `TaskStop`. The writing rule for orchestrators bans `TeamCreate`, `TeamDelete`, `team_name`, broadcast and experimental flags; the step 6-1 grep list (`TeamCreate`, `TeamDelete`, `team_name`, experimental flags) lacks broadcast, and the in-session grep (`Workflow` tool call, `Agent(`, `SendMessage`, `TaskCreate`) lacks `TaskUpdate`/`TaskList`/`TaskGet`/`TaskStop`.
- Proposal: CHANGE: the lint token list is the union of NOTICE:10-11 and orchestrator-template:278.
- Source: kit:project/.agents/skills/harness/NOTICE.md:10-11; kit:project/.agents/skills/harness/references/orchestrator-template.md:278; kit:project/.agents/skills/harness/SKILL.md:330-331
- Why it exists: not stated.
- Test idea: a fixture orchestrator containing `broadcast` or `TaskList` fails the lint.

### MTH-73 Workflow invocation forms (`--name`, full command, resume shapes)
- Behavior: Workflows run with `ph workflow --script <file.js>` or `--name <name>` (team-patterns:119). Generated orchestrator templates spell the full command `node .agents/skills/harness/scripts/paseo_harness.mjs workflow --script <file> --args-file <file>` so it can be copied and run as is (SKILL.md:217), with `ph` only as the short name in method text. Resume has two shapes in template A: with `--args-file` (orchestrator-template:48) and without it after a quota fix (line 80).
- Proposal: CHANGE: one resume invocation everywhere (script + args file + run id); keep `--name` in the command list.
- Source: kit:project/.agents/skills/harness/references/team-patterns.md:119; kit:project/.agents/skills/harness/SKILL.md:217; kit:project/.agents/skills/harness/references/orchestrator-template.md:48,80
- Why it exists: copy-paste-ready commands (SKILL.md:217).
- Test idea: lint: every `workflow` command in generated skills starts with the full `node .../paseo_harness.mjs` path and resume lines carry `--script`, `--args-file` and `--resume`.

## Invariants and lessons

- Never retry a failure that will repeat (quota, expired auth, denied permission): retries burn the remaining limit; read partial outputs, record omissions in a file, report the reset time. Source: kit:project/.agents/skills/harness/SKILL.md:265; kit:project/.agents/skills/harness/references/orchestrator-template.md:80.
- The orchestrator may write only facts it verified itself when filling a stopped agent's gap; guessing an agent's judgment falsifies the record needed for post-run verification. Source: kit:project/.agents/skills/harness/SKILL.md:266.
- Do not state or assume any workflow result before the `workflow done` line arrives. Source: kit:project/.agents/skills/harness/references/orchestrator-template.md:65.
- Resume with the edited `--script`; `--resume <runId>` alone reruns the old copy and skips edits. Source: kit:project/.agents/skills/harness/SKILL.md:317.
- A failed workflow `agent()` is `null` and `parallel()` does not throw: always `.filter(Boolean)` and `log()` the missing count; report excluded counts for any sampling or top-N. Source: kit:project/.agents/skills/harness/SKILL.md:267; kit:project/.agents/skills/harness/references/team-patterns.md:133.
- Freeze deliverables at phase boundaries and re-check before the final deliverable, because named agents answer late messages and may revise files. Source: kit:project/.agents/skills/harness/references/orchestrator-template.md:156.
- `tools:` lists and `--read-only` are advisory; never present them as permissions; enforce by freeze/check. Source: kit:project/.agents/skills/harness/SKILL.md:135; kit:project/.agents/skills/harness/references/orchestrator-template.md:156.
- Agents that edit outputs need Edit as well as Write (Write-only agents rewrite whole files, then give up or write a side file). Source: kit:project/.agents/skills/harness/references/team-patterns.md:234.
- Preflight 2-3 items through every stage before a big fan-out (0/38 families passed first check, 2026-10-04); scripts own bookkeeping (57/112 partition plans failed on exact IDs). Source: kit:project/.agents/skills/harness/SKILL.md:281-289.
- Keep prompts small and pass paths not content (a 42 MB prompt dropped the runner socket). Source: kit:project/.agents/skills/harness/SKILL.md:290-291; kit:project/.agents/harness.defaults.json:2.
- `max_subagents` 20 (RAM: 30 agents exhausted 32 GB, 2026-10-04). Source: kit:project/.agents/harness.defaults.json:2,83.
- Name agents from the start if a follow-up is possible: one-shot (fanout --collect) agents are archived and cannot continue. Source: kit:project/.agents/skills/harness/references/team-examples.md:43-47.
- Choose the model by the work, not importance; the coordination layer's tier does not propagate to workers. Source: kit:project/.agents/skills/harness/references/model-selection-guide.md:117-122.
- Generalize feedback and record why; one change at a time; history is never erased; a regression conflict with a past change needs user confirmation. Source: kit:project/.agents/skills/harness-evolve/SKILL.md:58-61,88-92.
- Output language of generated harness files is English (owner 2026-10-03). Source: kit:project/.agents/skills/harness/SKILL.md:19.
- Never `ph send` to a mid-turn agent; batch follow-ups and send when idle (3 quick sends interrupted a working debugger, 2026-10-16). Source: wildera:.agents/harness-history.md:17.
- Reviewers are wrong too: require trigger + confidence before a finding blocks; verify independently; do not loop on non-converging reviews. Source: wildera:.agents/harness-history.md:40,42.
- Main session orchestrates through Paseo/`ph` only; native `Agent` and `Workflow` are denied (owner 2026-10-14), so method text must not tell the main session to use them. Source: kit:CHANGELOG.md:15; memory main-session-no-native-subagents.
- The orchestrator never polls with its own sleep/grep loop. Source: kit:project/.agents/skills/ai-orchestrator/SKILL.md:16; wildera:.agents/harness-history.md:9.

## Interfaces

Files and formats owned by this area:

| Item | Shape |
| --- | --- |
| Agent definition `.agents/agents/{name}.md` | YAML `name`, `description` (required); `tools` (advisory), `model` (tier, optional); body sections: Core responsibilities, Working principles, Input and output rules, Communication rules (persistent) or Structured output (workflow-only), When called again, Error handling, Collaboration (kit:project/.agents/skills/harness/references/team-patterns.md:186-228) |
| Skill `.agents/skills/{name}/SKILL.md` | YAML `name`, `description`; body < 500 lines; optional `scripts/`, `references/`, `assets/` (kit:project/.agents/skills/harness/SKILL.md:158-166) |
| Orchestrator skill `{domain}-orchestrator` | Templates A/B/C/mixed: front matter, execution mode, agent composition table, Phase 0..N, Error handling table, Test scenarios (kit:project/.agents/skills/harness/references/orchestrator-template.md) |
| `CLAUDE.md` harness section | `## Harness: {domain}`, `**Goal:**`, `**Invocation conditions:**` (kit:project/.agents/skills/harness/SKILL.md:298-304) |
| `.agents/harness-history.md` | Table with columns Date, Change, Scope, Reason; newest last (kit:templates/harness-history.md:5-8) |
| `_workspace/` | `{phase}_{agent}_{artifact}.{ext}`; `00_input/`; `run_meta.json` (runId); `_workspace_{ts}/` archives; `iteration-N/eval-<name>/` with `eval_metadata.json`, `with_skill/`, `without_skill/`, `blind/A` and `blind/B`; `benchmark.json`; `evals/evals.json` |
| Schemas | FINDINGS {findings[{title,file,evidence}]}, VERDICT {status: confirmed/refuted/uncertain, reason}, RUN_RESULT, GRADE, `eval_metadata.json`, `grading.json`, `timing.json` (MTH-29, MTH-48) |
| Fanout block | `=== {name} type={type}` + prompt; option `read-only=true`; `ph fanout --file F [--ws DIR] [--collect DIR] [--keep] [--type T] [--model M]` (runtime area owns) |
| Workflow script | `meta` literal {name, description, phases[{title}]}, `phase()`, `pipeline()`, `parallel()`, `agent(prompt,{agentType, model, phase, label, schema, isolation, readOnly})`, `log()`, `args`, `budget.remaining()`, `workflow(nameOrRef,args)` (runtime area owns) |
| `ph` commands used by the method | `workflow --script|--name --args-file [--detach] [--resume runId]`, `spawn --name --count --type --model --prompt --read-only`, `send --prompt NAME`, `fanout`, `watch`, `watch-run` / `watch_run.mjs`, `result [--json]`, `task add/update/list [--ws --title --assignee --depends-on --status]`, `freeze [--check] --ws --phase`, `team`, `archive`, `stop`, `skills-sync` |
| Config keys cited by the method | `.agents/harness.defaults.json` tiers (`frontier`/`pro`/`standard` -> provider/model), `tier_aliases` (`fable`, `opus`, `sonnet`), `max_subagents` 20, `max_prompt_bytes`; project overlay `.agents/harness.config.json` (kit:project/.agents/harness.defaults.json:2,83) |

## Cross-area dependencies

- install: owns seeding `harness-history.md` and `harness.config.json`, `skills-sync`, the kit `AGENTS.md` block, `install.mjs status/pull` (cited from evolve). MTH-21, MTH-37, MTH-59, MTH-60 need decisions there.
- runtime: all `ph` commands, the workflow API, `freeze`, `task`, `team`, run records (`run.json`, `journal.jsonl`, `result.json`, `log.txt`), `watch_run.mjs`, limits (RAM, prompt, file), the `session` option, resume semantics. The method only calls them.
- workflow: `.agents/workflows/*.js` scripts (qa-coherence, code-wave) and `workflow-recipes.md`; MTH-20, MTH-31, MTH-46.
- files: the statements that batch filesystem tools are always present in agent and template text must follow the files-area outcome (harness-files mod for Claude Code only).
- hooks: none directly; hook reminders (context guard, io guard) are not part of the method.
- method: this area.
- gsd-plan / gsd-debug / gsd-upstream: ownership split in MTH-62; the method's verification patterns (MTH-08, MTH-64) feed code-wave and gsd-verify; the `gsd-plan` handoff to `code-wave` uses an orchestrator produced under this method.
- ui: none.
- history: `harness-history.md` is the record; WildEra's populated instance is the format reference (MTH-60).

## Concerns

- Prose volume: about 3000 lines across harness SKILL and references, with large domain-narrative parts (webtoon, sci-fi writing, Next.js QA) unrelated to this owner's projects (kit:project/.agents/skills/harness/references/team-examples.md:28-47,125-140; kit:project/.agents/skills/harness/references/qa-agent-guide.md:41-81). Cost: tokens when loaded, drift.
- Upstream vs kit text cannot be separated mechanically; no upstream copy on disk and `NOTICE.md` declares only categories of change (kit:project/.agents/skills/harness/NOTICE.md:7-20). A rewrite loses the ability to diff against upstream 2.1.0.
- Naming drift: 'Generate and verify' vs 'Producer-reviewer' for the same pattern (kit:project/.agents/skills/harness/SKILL.md:86 vs kit:project/.agents/skills/harness/references/team-patterns.md:74).
- Model tier text conflict: coding under pro (kit:project/.agents/skills/harness/SKILL.md:121-122) vs standard (kit:project/.agents/skills/harness/references/model-selection-guide.md:13,94). The tier definitions are restated four times (SKILL.md:116-129, team-patterns.md:182, model guide, defaults notes).
- CLI flag drift: `--args` (kit:project/.agents/skills/harness/references/qa-agent-guide.md:143) vs `--args-file` everywhere else.
- Built-in type stubs: the `--type Explore` / `--type Plan` rows say the types are not available and then recommend them anyway (kit:project/.agents/skills/harness/references/team-patterns.md:161-162,174-175); leftover from upstream.
- `skill-testing-guide.md:79` and `:200` assert that agents always have the batch file tools; this is a runtime claim that will be wrong when the filesystem MCP is dropped (kit:project/.agents/skills/harness/references/skill-testing-guide.md:79,200).
- Hard-coded 'currently 20' in `ai-orchestrator` duplicates the config value (kit:project/.agents/skills/ai-orchestrator/SKILL.md:8; kit:project/.agents/harness.defaults.json:83); its description (delegate work or complete a task using multiple agents) is generic enough to collide with `harness` and any orchestrator skill trigger (kit:project/.agents/skills/ai-orchestrator/SKILL.md:3).
- `ai-orchestrator` has no mode, no error handling and no tie to `_workspace/`: only a DoD rule and a wait rule; the WildEra history shows it was extended only for the wait problem (wildera:.agents/harness-history.md:9).
- kit README still presents `ai-orchestrator` next to the Backlog integration (kit:README.md:4, found by grep, line not read in full); Backlog is dropped, so that text goes.
- Many rules are prose with no executable check: validation 6-1/6-2 and the 16-item checklist are manual (kit:project/.agents/skills/harness/SKILL.md:320-338,385-403). Candidates for a linter.
- `skills-sync` and `.agents/skills` as source exist to serve Codex/OpenCode (kit:project/.agents/skills/harness/SKILL.md:150) and add a link layer Claude-only does not need.
- `harness-history.md` rows in WildEra often have 600-3000-character cells, and one row puts the Reason in Change (wildera:.agents/harness-history.md:46-47); the file doubles as a project changelog beyond its stated purpose (wildera:.agents/harness-history.md:3).
- Steps 6-3 and 6-4 expect 2-3 test runs plus 10+10 trigger prompts per skill: heavy for a one-person owner; no stated threshold for when to skip (kit:project/.agents/skills/harness/SKILL.md:340-353).
- The A/B recipe is about 70 lines of script embedded in prose (kit:project/.agents/skills/harness/references/skill-testing-guide.md:98-168); I found no test of it in the files in scope.
- Evolve reads `_workspace/_runs/*/run.json`; that layout belongs to the runtime area and was not verified here (kit:project/.agents/skills/harness-evolve/SKILL.md:29).

## Open questions for the owner

1. Q1 (MTH-21). Where does the new kit author skills? Options: (a) `.claude/skills/` directly, dropping `.agents/skills` and `skills-sync` (Claude Code is the only harness); (b) keep `.agents/skills` as source plus links. Recommendation: (a), fewer moving parts; needs an install-area ruling because of Paseo's own skill selection (memory: no-kit-overrides-of-tool-settings).
2. Q2 (MTH-62). Should the harness method stay a separate pair of skills (`harness`, `harness-evolve`) or fold into GSD as role/team-building references? Options: (a) keep two slim skills (team-design, harness-evolve) beside GSD; (b) merge into the GSD adapter docs. Recommendation: (a), since the method also serves ad hoc orchestration outside planned work.
3. Q3 (MTH-61). Keep `ai-orchestrator` as a skill? Options: (a) drop it and put the DoD and wait rules in the kit's rules block; (b) keep it as a thin skill that reads `max_subagents` from config. Recommendation: (a) unless a trigger test (MTH-52) shows the skill fires for delegation requests.
4. Q4 (MTH-65). Provenance: rewrite from scratch or keep upstream-derived text. If any Harness v2 prose survives, the Apache-2.0 notice and LICENSE must remain. Options: (a) full rewrite plus a short credit; (b) keep NOTICE and LICENSE. Recommendation: (b) while any sentence is derived; decide after the rewrite.
5. Q5 (MTH-12, MTH-13). Where do tier names live? Options: (a) keep frontier/pro/standard in method text and map them in the adapter; (b) role names (planner, coder, reviewer) in method text. Recommendation: (a) for continuity with agent files, plus the adapter's per-role model table from the owner decisions.
6. Q6 (MTH-56, MTH-19). Domain examples (novel, webtoon, Next.js QA): keep as an optional examples pack or drop? Recommendation: drop the narratives, keep two compact fixtures for the linter.
7. Q7 (MTH-08, MTH-64). Make the WildEra bounded review gate (trigger, confidence, verifier agent) the default verification pattern, replacing the majority-vote adversarial pattern? Recommendation: yes for code review; keep majority vote for research and audit claims.
8. Q8 (MTH-52). Trigger validation (10+10) and A/B skill tests: required for every skill, or only for orchestrators and skills the owner marks critical? Recommendation: required for orchestrators, optional otherwise.
9. Q9 (MTH-71). Where do non-blocking (normal) review findings go now that Backlog is dropped? Options: (a) an append-only review log file (review-metrics style) only; (b) a `.planning/` note per phase; (c) both. Recommendation: (c) log for metrics, `.planning/` note for follow-up work.

## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
| --- | --- | --- |
| R1-MTH-01 | accepted | MTH-03: dropped team-patterns.md:135 (scaling principle, already in MTH-08); stated that "all" is only in Template A (orchestrator-template:28), SKILL.md:75 names thorough/exhaustive only. |
| R1-MTH-02 | accepted | MTH-29: marked CONFLICT between skill-writing-guide:223 and skill-testing-guide:90 on `ph result --json` tokens; added `total_duration_seconds = durationS`. |
| R1-MTH-03 | accepted | New MTH-66 (four composites, codable-stage rule); MTH-08 omission findings feed the next exploration round; MTH-07 classifier and fan-in cautions. |
| R1-MTH-04 | accepted | MTH-17 proposal now CONFLICT (SKILL.md:143 vs qa-agent-guide:87 vs :214); new MTH-67 (priority order, four checklist rows, two fix channels, chosen rule); MTH-19 points to it. |
| R1-MTH-05 | accepted | New MTH-68 (tool-missing fallback, split-before-extend); same sentences added to MTH-14 and MTH-11. |
| R1-MTH-06 | accepted | New MTH-69 (CONFLICT `project/.agents` vs `.agents`, proposal CHANGE to `.agents/` and `CLAUDE.md`); MTH-01 proposal flags it. |
| R1-MTH-07 | accepted | New MTH-70 (DROP `codex/<model>`, `opencode/<model>` examples). |
| R1-MTH-08 | accepted | MTH-64 split: history:19 marked superseded by :42 (CONFLICT), `unverified` cited to :43, retry once then escalate never to the fixer cited to :44, normals' Backlog task flagged; new MTH-71 and OPEN Q9 for where normal findings go. |
| R1-MTH-09 | accepted | MTH-05 proposal: removed "only the main session"; Agent and Workflow are denied for main and worker providers, SendMessage for main (harness.defaults.json:37,53,59-62, lines checked by me). |
| R1-MTH-10 | accepted (with correction) | Commit 91c3239 is not in the kit, as the reviewer says; I took it from `git log` of the WildEraV6 repo, so MTH-63 now calls it a WildEraV6 commit and no longer a kit commit. The history:9 and ai-orchestrator:14-16 sources stay. |
| R1-MTH-11 | accepted | MTH-60: cited history:9-10 for "Kit tests 85/85 pass" and 9-47 for the rows; line 46 described as Date and Change cells only (Why inside Change, Scope and Reason absent). |
| R1-MTH-12 | accepted | MTH-46 notes `broadcast` (orchestrator-template:278) is missing from the step 6-1 grep (SKILL.md:330); new MTH-72 carries the union list and the NOTICE:10-11 primitives. |
| R1-MTH-13 | accepted | MTH-54: 16 items -> 17 (SKILL.md:387-403). |
| R1-MTH-14 | accepted | MTH-30: composition table is in Templates A and B; Template C has only the fanout table (orchestrator-template:223-226). |
| R1-MTH-15 | accepted | MTH-32: "only via the leader" replaced by the conditional relay rule (orchestrator-template:142-143). |
| R1-MTH-16 | accepted | MTH-31, MTH-45 note the two resume shapes (lines 48 and 80); new MTH-73 proposes one invocation. |
| R1-MTH-17 | accepted | New MTH-73 (`--name`, full `node ...` command, "dozens of agent() calls" cue added to MTH-02); `--name` added to the Interfaces command list. |
| R1-MTH-18 | accepted | MTH-61: added the "as quickly as possible with high quality" objective (ai-orchestrator SKILL.md:8). |
| R1-MTH-19 | accepted | MTH-13: coding-tier resolution rewritten per model-selection-guide:94 and :73-76 without a single-file cut. |
| Citation-table notes (no ID) | accepted | MTH-12 alias mapping with harness.defaults.json:28-32 (lines read); MTH-41 `max_agents_per_workflow` 1000 (line 84); MTH-44 `max_prompt_bytes` 262144 (line 108); MTH-65 LICENSE now cited to NOTICE.md:5 and the NOTICE:10-11 primitive list added. |
