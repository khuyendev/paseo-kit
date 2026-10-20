# Review r1: method

## Verdict

REVISE. 0 blocker, 11 major, 8 minor. The map is a real reading of the harness method (line counts match `wc -l`, WildEra `ai-orchestrator` and `harness-evolve` are identical to the kit, and the large contracts — modes, freeze, quota/auth, English output, GSD split — are present and mostly cited). It is not safe to spec from yet: two source conflicts are collapsed into one rule (eval timing; QA read-only/`tools:`), several method rules are missing (composite patterns, omission follow-up, tool-missing fallback, non-Claude provider names), MTH-64 mixes a superseded re-review rule with the later gate and drops the “never send an unverified high to the fixer” step, and two citations do not exist (team-patterns consent line; commit `91c3239`).

## Findings

### R1-MTH-01 MAJOR citation MTH-03 consent cites the scaling paragraph
- Severity: MAJOR.
- Category: citation.
- Map entry: MTH-03.
- Evidence: kit:project/.agents/skills/harness/references/team-patterns.md:135 is the verification scaling principle (“check whether there are bugs” vs “audit thoroughly”, 3–5 verifiers), not consent to run `ph workflow`. Consent is kit:project/.agents/skills/harness/SKILL.md:75 (“thorough” or “exhaustive” only) and kit:project/.agents/skills/harness/references/orchestrator-template.md:28 (adds “all”, and default agent count `{N}`).
- Fix: Drop team-patterns.md:135 from MTH-03 (it already belongs in MTH-08). State that “all” is template-only, not in SKILL.md:75.

### R1-MTH-02 MAJOR accuracy eval timing presented as one rule
- Severity: MAJOR.
- Category: accuracy.
- Map entry: MTH-29.
- Evidence: kit:project/.agents/skills/harness/references/skill-writing-guide.md:223 says `ph result --json <agent>` shows `tokens` and durations for an agent that is not archived yet. kit:project/.agents/skills/harness/references/skill-testing-guide.md:90 says a `ph spawn` agent’s `ph result --json` has no `tokens` (use the last turn’s `usage`, or fanout/workflow), and that `total_duration_seconds` = `durationS`. MTH-29 cites both ranges and states only the testing-guide rule. It also omits `total_duration_seconds = durationS`.
- Fix: Mark CONFLICT. Record both sentences and the `total_duration_seconds` formula. Keep the proposal that the new runtime result schema decides the extraction.

### R1-MTH-03 MAJOR coverage team-patterns composites and omission follow-up
- Severity: MAJOR.
- Category: coverage.
- Map entry: missing (adjacent to MTH-07, MTH-08).
- Evidence: kit:project/.agents/skills/harness/references/team-patterns.md:139-149 names four composites (fan-out + producer-reviewer, pipeline + fan-out, supervisor + expert pool, exploration + adversarial verification + synthesis) and says each stage picks its mode by whether that stage’s control flow is codable. Line 132: an omission review’s new gaps are added to the next exploration task, not only listed. Line 70: a misclassifying expert-pool classifier never reaches the right expert. Line 54: fan-in quality depends on how results are combined. None of these are in MTH-07 or MTH-08 (MTH-08 stops at “asks only what is missing”).
- Fix: Add a behavior for the four composites (KEEP the “codable stage → workflow, else persistent” rule; the examples may stay short). Extend MTH-08 so omission review feeds the next exploration round. Add the classifier and fan-in cautions to MTH-07.

### R1-MTH-04 MAJOR coverage QA guide conflicts and checklist gaps
- Severity: MAJOR.
- Category: coverage.
- Map entry: MTH-17, MTH-19.
- Evidence: kit:project/.agents/skills/harness/SKILL.md:143 allows a read-only QA agent for non-mutating checks. kit:project/.agents/skills/harness/references/qa-agent-guide.md:87 says an Explore-style read-only agent cannot do QA, forbids `--read-only`, and says a `tools:` list must include Bash, Edit, and Write. The same file at line 214 says do not give `qa-inspector` a `tools:` list at all. Lines 195-198 add a priority order the map never states: integration coherence, then functional spec, then design quality (colors, fonts, responsive), then code quality (unused code, naming). Checklist items absent from MTH-19: type-assertion / `any` bypass (line 96), `{ items: [...] }` unwrapping (line 159; MTH-19 only has `.data`), dynamic-segment parameter values (line 167), and “status === X must be a reachable state” (line 173). Line 209 routes a fix two ways: `ph send` to a persistent teammate, or return findings to the orchestrator inside a workflow.
- Fix: Mark CONFLICT between SKILL.md:143, qa-agent-guide.md:87, and :214, and pick one rule for the rewrite (recommendation: no Explore type; `--read-only` only for a explicitly non-editing checker; the editable inspector has no `tools:` list). Add the priority order, the four checklist rows, and the two fix channels.

### R1-MTH-05 MAJOR coverage missing agent-definition recovery rules
- Severity: MAJOR.
- Category: coverage.
- Map entry: missing (adjacent to MTH-11, MTH-14).
- Evidence: kit:project/.agents/skills/harness/references/team-patterns.md:235: if a listed tool is missing, the orchestrator does that work (example: leader `ph task update`) or the `tools` restriction is removed. Line 257: if extending an agent would give it two or more roles, split it first. MTH-14 stops at “first report confirms `ph task` and lists usable tools”. MTH-11 stops at reuse/extend/separate plus caller update and a dry run.
- Fix: Add both rules to MTH-14 and MTH-11. KEEP them; they are the enforcement story once `tools:` is advisory.

### R1-MTH-06 MAJOR accuracy `project/.agents` prefix written as `.agents`
- Severity: MAJOR.
- Category: accuracy.
- Map entry: MTH-01, MTH-04, MTH-21, MTH-37, Interfaces.
- Evidence: kit:project/.agents/skills/harness/SKILL.md:14,27,102,150,154,387-388 and kit:project/.agents/skills/harness/references/team-examples.md:146-147 tell the agent to read and write `project/.agents/...` and `project/CLAUDE.md`. kit:project/.agents/skills/harness/references/team-patterns.md:266, kit:project/.agents/skills/harness-evolve/SKILL.md:24, and kit:templates/harness-history.md:3 say `.agents/` and `CLAUDE.md`. The map cites SKILL.md:3-14 and states only `.agents/agents/` and `CLAUDE.md`, with no CONFLICT.
- Fix: Record the CONFLICT. Proposal: CHANGE generated instructions to `.agents/` and `CLAUDE.md` (the `project/` prefix is the kit repo layout, and it is wrong once the skill is installed into a project).

### R1-MTH-07 MAJOR coverage non-Claude provider model names have no DROP
- Severity: MAJOR.
- Category: coverage.
- Map entry: missing (adjacent to MTH-12, MTH-21).
- Evidence: kit:project/.agents/skills/harness/SKILL.md:150: “Agents of any Paseo provider can run the harness: name `codex/<model>`, `opencode/<model>` and so on in a tier or `--model`”. kit:project/.agents/harness.defaults.json:2 repeats that a tier maps to `circle/...`, `codex/...`, or `opencode/...`. Owner decision 2026-10-20: Claude Code is the only harness; Codex/OpenCode/Pi support is dropped; other vendors run only through the `circle` provider. MTH-21 discusses dropping `.agents/skills` + `skills-sync` but never this instruction.
- Fix: Add a behavior with proposal DROP: tier and `--model` examples name only `circle/<model>` (or a tier), never `codex/` or `opencode/`.

### R1-MTH-08 MAJOR accuracy review-gate entry mixes superseded rules and drops the escalate step
- Severity: MAJOR.
- Category: accuracy.
- Map entry: MTH-64.
- Evidence: wildera:.agents/harness-history.md:19 (cited) says the re-reviewer checks each fix and reviews the whole change again for new defects. Line 42 (also cited) replaces that loop: resolution check of those findings only, no new findings. The entry states only the later rule while citing both. Line 43, not cited, is the actual “no verdict → `unverified`, still blocking, not `confirmed`” sentence the behavior attributes to the gate. Line 44, omitted, tightens it: retry the verifier once, then escalate, never send that high to the fixer. Line 40 sends non-blocking normal findings to a follow-up Backlog task (`deferredFindings`); Backlog.md is dropped (owner 2026-10-20), and the map never says where normals go.
- Fix: Split the entry. Mark line 19 superseded by line 42 (CONFLICT, later side wins). Cite line 43 for `unverified`. Add line 44 (retry once, then escalate, never to the fixer). For normals: DROP the Backlog task; say they are recorded and do not block (owner must pick the record: review-metrics style log vs `.planning/` note — OPEN if needed).

### R1-MTH-09 MAJOR proposal Agent/Workflow denial narrowed to the main session
- Severity: MAJOR.
- Category: proposal.
- Map entry: MTH-05.
- Evidence: The proposal says “only the main-session native `Agent`/`Workflow` are denied (owner)”. Memory `main-session-no-native-subagents` says workers on `circle-agent` already deny both, and the main provider was denied as well. kit:project/.agents/harness.defaults.json:37 and :53 put `Agent` and `Workflow` on `agent_provider_disallowed_tools` (workers). Lines 59-62 add `SendMessage` for the main provider only. The brief’s 2026-10-20 line names the main provider; it does not lift the worker denial.
- Fix: Keep the orchestrator grep (no `Agent(`, `Workflow`, `SendMessage`, `TaskCreate`). Delete “only the main session”. State that worker providers also deny `Agent` and `Workflow`, and the main provider also denies `SendMessage`.

### R1-MTH-10 MAJOR citation commit 91c3239 is not in the kit
- Severity: MAJOR.
- Category: citation.
- Map entry: MTH-63.
- Evidence: `git rev-parse 91c3239` and `git log --all --grep` find no such commit and no “Print the wait command” subject on any branch (main, omp, omp-pre-rewrite, rewrite/claude-mods). The incident itself is real: wildera:.agents/harness-history.md:9 (owner sleep/grep loop; `next:` / Waiting for agents). kit:project/.agents/skills/ai-orchestrator/SKILL.md:14-16 matches the rule.
- Fix: Remove `91c3239`. Keep history line 9 and the skill lines as the source.

### R1-MTH-11 MAJOR citation history claims not on the cited lines
- Severity: MAJOR.
- Category: citation.
- Map entry: MTH-60.
- Evidence: The source list is kit:templates/harness-history.md:1-8, wildera:.agents/harness-history.md:1-8, wildera:.agents/harness-history.md:46, and harness-evolve SKILL.md:66-72. “Kit tests 85/85 pass” is wildera:.agents/harness-history.md:9-10, which are not cited. The date span 2026-10-14..19 is the table body, not lines 1-8. Line 46 (list-price costing) puts Why inside Change and has no Scope cell and no Reason cell; the map says only “empty Reason”.
- Fix: Cite lines 9-10 for the test-count cells, and describe line 46 as a row with Date and Change only (Scope and Reason absent). Keep the 4-non-empty-cell lint.

### R1-MTH-12 MINOR coverage v1 token `broadcast` missing from the ban lists
- Severity: MINOR.
- Category: coverage.
- Map entry: MTH-05, MTH-46.
- Evidence: kit:project/.agents/skills/harness/references/orchestrator-template.md:278 forbids `TeamCreate`, `TeamDelete`, `team_name`, broadcast, and experimental flags. SKILL.md:330’s grep list has no broadcast. The map’s lint tokens follow the grep list only.
- Fix: Add broadcast to the v1 ban (writing rule), and note it is not in the step 6-1 grep.

### R1-MTH-13 MINOR accuracy output checklist counted as 16
- Severity: MINOR.
- Category: accuracy.
- Map entry: MTH-54.
- Evidence: kit:project/.agents/skills/harness/SKILL.md:387-403 is 17 checkbox lines. The map says “16 items” and then lists 17.
- Fix: Say 17.

### R1-MTH-14 MINOR accuracy not every orchestrator template has a composition table
- Severity: MINOR.
- Category: accuracy.
- Map entry: MTH-30.
- Evidence: Templates A and B have `## Agent composition` (orchestrator-template.md:30-35 and :113-118). Template C (lines 202-242) has only the Phase 2 fanout table (lines 223-226), no composition section. Lines 1-14 do not require a composition table.
- Fix: Say A and B have a composition table; C has a fanout input/deliverable table.

### R1-MTH-15 MINOR accuracy teammates do not discuss “only” through the leader
- Severity: MINOR.
- Category: accuracy.
- Map entry: MTH-32.
- Evidence: kit:project/.agents/skills/harness/references/orchestrator-template.md:143: “If teammates need to discuss findings, relay messages as the leader.” That is a fallback, not a ban on other `ph send` paths. Line 142 already has the leader send a review to teammate-2 and forward the reply.
- Fix: Replace “only via the leader” with the conditional relay rule.

### R1-MTH-16 MINOR accuracy quota resume command drops `--args-file`
- Severity: MINOR.
- Category: accuracy.
- Map entry: MTH-31, MTH-45.
- Evidence: orchestrator-template.md:48 resumes with `--script` and `--args-file`. Line 80, after a quota/auth/permission fix, resumes with `--script` and `--resume` and no `--args-file`. MTH-45 records the missing-`--script` trap and not this second shape.
- Fix: Note the two command shapes. The rewrite should use one resume invocation (script + args file + run id) everywhere.

### R1-MTH-17 MINOR coverage `ph workflow --name` and the “dozens of calls” workflow cue
- Severity: MINOR.
- Category: coverage.
- Map entry: missing (Interfaces; MTH-02).
- Evidence: kit:project/.agents/skills/harness/references/team-patterns.md:119: run scripts with `ph workflow --script <file.js>` or `--name <name>`. The Interfaces command list has `--script` and not `--name`. kit:project/.agents/skills/harness/SKILL.md:64 also selects workflow mode when the work needs dozens or more `agent()` calls, which MTH-02’s decision rule does not include. SKILL.md:217 requires generated templates to spell `node .agents/skills/harness/scripts/paseo_harness.mjs workflow ...` so the line can be copied; the map only says `ph`.
- Fix: Add `--name` to the command list. Add the “dozens of `agent()` calls” row to MTH-02. State that generated orchestrators print the full `node ... paseo_harness.mjs` command, with `ph` as the short name.

### R1-MTH-18 MINOR coverage ai-orchestrator speed objective
- Severity: MINOR.
- Category: coverage.
- Map entry: MTH-61.
- Evidence: kit:project/.agents/skills/ai-orchestrator/SKILL.md:8: coordinate up to `max_subagents` (text says currently 20) “as quickly as possible with high quality”. MTH-61 records the cap and the DoD, not the speed objective. kit:CHANGELOG.md:11 supports the DoD addition and does not mention the waiting section (that is history line 9).
- Fix: Add the speed-plus-quality sentence to the behavior. The drop-vs-rules proposal can stay.

### R1-MTH-19 MINOR proposal coding-tier resolution is narrower than the guide
- Severity: MINOR.
- Category: proposal.
- Map entry: MTH-13.
- Evidence: The CONFLICT itself is real: kit:project/.agents/skills/harness/SKILL.md:121 puts “code generation” under pro; kit:project/.agents/skills/harness/references/model-selection-guide.md:13 and :94 put general coding (functions, fixes, simple programs, explaining code, refactoring, tests, data scripts) under standard; lines 73-76 put multi-file, feature, and independent next-step coding under pro. The map’s resolution “bounded single-file = standard” is not what line 94 says (refactoring and tests need not be one file).
- Fix: Keep the CONFLICT. Resolve as: standard = everyday coding with a clear procedure; pro = multi-step coding that changes structure or spans files; do not invent a single-file cut.

## Citations checked

| map entry | citation | ok / wrong |
| --- | --- | --- |
| MTH-01 | SKILL.md:3-14 | wrong path: line 14 says `project/.agents/agents/`, not `.agents/agents/` |
| MTH-02 | SKILL.md:60-77 | ok (decision order). Omits the table’s “dozens or more `agent()` calls” at line 64 |
| MTH-03 | SKILL.md:75 | ok for consent; does not include the word “all” |
| MTH-03 | orchestrator-template.md:28 | ok (“thorough”, “exhaustive”, or “all”; default `{N}`) |
| MTH-03 | team-patterns.md:135 | wrong: scaling principle, not workflow consent |
| MTH-05 | SKILL.md:39,330-331 | ok (v1 strings and in-session grep) |
| MTH-05 | harness-evolve SKILL.md:39-40 | ok |
| MTH-07 | team-patterns.md:36,102,117 | ok (pipeline delay, supervisor bottleneck, depth cap) |
| MTH-08 | team-patterns.md:127-133 | ok (majority / more than half, `seen`, `log()` excluded count) |
| MTH-12 | model-selection-guide.md:13,115 | ok (standard includes general coding; one paper vs dozens) |
| MTH-12 | harness.defaults.json:28-32 | aliases exist but are not stated: `fable`→frontier, `opus`→pro, `sonnet`→standard. Line 2 only says the old names keep working |
| MTH-13 | SKILL.md:121-122 vs guide:73-76,94 | ok; CONFLICT is real |
| MTH-14 | team-patterns.md:234 | ok (Write without Edit rewrites the file or writes a side file) |
| MTH-16 | team-examples.md:94-113 | ok (`worktreePath` minLength 1, merge only `confirmed`, tests between merges) |
| MTH-20 | qa-agent-guide.md:143 | ok (`--args '{"boundaries":...}'`, not `--args-file`) |
| MTH-21 | SKILL.md:150 | partial: sync and Codex/OpenCode folder are there; `codex/<model>` / `opencode/<model>` is the same line and is not mapped |
| MTH-29 | skill-writing-guide.md:223 | wrong as used: that line says `ph result --json` shows tokens for a live agent |
| MTH-29 | skill-testing-guide.md:90 | ok for the spawn exception; also sets `total_duration_seconds = durationS` |
| MTH-31 | orchestrator-template.md:65 | ok (`workflow done` / `result.json`; failed → `journal.jsonl` and `log.txt`; re-arm only if Monitor times out) |
| MTH-33 | orchestrator-template.md:156-168 | ok (do not block cross-check; `_v2` file; `freeze` then `freeze --check`) |
| MTH-40 | SKILL.md:265-266 | ok (no retry of quota/auth/permission; do not guess a stopped agent’s judgment) |
| MTH-41 | harness.defaults.json:83 and :2 | ok (`max_subagents` 20; 30-agent run exhausted 32 GB RAM). The 1,000 cap is SKILL.md:278 and defaults key `max_agents_per_workflow` at line 84, which the map does not name |
| MTH-42 | SKILL.md:284-285 | ok (0 of 38 families, 2026-10-04) |
| MTH-43 | SKILL.md:287-289 | ok (57 of 112) |
| MTH-44 | harness.defaults.json:2 | ok (42 MB prompt dropped the runner socket). The limit value is line 108: `max_prompt_bytes` 262144, not stated in the map |
| MTH-45 | SKILL.md:317 | ok (`--resume` without `--script` reruns the stored copy) |
| MTH-52 | skill-testing-guide.md:254-260 | ok (60/40, five iterations, test-set selection, `skills` field, not `claude -p`) |
| MTH-55 | NOTICE.md:16-17 and SKILL.md:19 | ok (English, owner 2026-10-03) |
| MTH-60 | wildera harness-history.md:1-8 | ok for the header; does not contain “85/85” or the date rows |
| MTH-60 | wildera harness-history.md:46 | partial: Why is inside Change; Scope is missing too, not only Reason |
| MTH-61 | CHANGELOG.md:11 | ok for the DoD skill; waiting section is not in 0.1.0 |
| MTH-63 | ai-orchestrator SKILL.md:14-16 and history:9 | ok |
| MTH-63 | commit 91c3239 | wrong: not in this repository |
| MTH-64 | history:19 | contradicts the stated gate (that row still wants a full re-review for new defects) |
| MTH-64 | history:42 | ok for trigger, confidence >= 80, likelihood above theoretical, resolution check with no new findings |
| MTH-64 | history:43-44 | not cited; they are the `unverified` rule and the retry-once-then-escalate rule |
| MTH-65 | NOTICE.md:1-20 | ok (2.1.0, `92d9f1b`, 2026-09-28, Apache-2.0, port notes). “Folder contains LICENSE, …” is not in NOTICE; LICENSE is a sibling file, outside the mapper’s file list |

## Coverage check

| in-scope file | in map table | omitted behaviors found (count) |
| --- | --- | --- |
| kit:project/.agents/skills/harness/SKILL.md (wc 416; map 416; read) | yes | 3 (`project/` prefix, `codex/`/`opencode/` model names, “dozens of `agent()` calls” plus the full `node ... paseo_harness.mjs` command) |
| kit:project/.agents/skills/harness/NOTICE.md (wc 20) | yes | 1 (moved primitives also include `TaskUpdate`/`TaskList`/`TaskGet`/`TaskStop`, NOTICE.md:10-11; the grep list and MTH-65 do not) |
| kit:project/.agents/skills/harness/references/orchestrator-template.md (wc 289) | yes | 2 (broadcast; quota-resume command without `--args-file`) |
| kit:project/.agents/skills/harness/references/team-patterns.md (wc 278) | yes | 5 (four composites, omission-review follow-up, classifier caution, tool-missing fallback, `workflow --name`) |
| kit:project/.agents/skills/harness/references/team-examples.md (wc 150) | yes | 1 (example 1 synthesis: omission reviewer then more research if a perspective is missing, line 20; `project/.agents` counted under SKILL) |
| kit:project/.agents/skills/harness/references/qa-agent-guide.md (wc 229) | yes | 6 (Explore ban, tools-list conflict, priority order, four checklist rows, two fix channels; design-quality priority included in that set) |
| kit:project/.agents/skills/harness/references/skill-writing-guide.md (wc 261) | yes | 0 (timing sentence is mapped, but mapped wrong: see R1-MTH-02) |
| kit:project/.agents/skills/harness/references/skill-testing-guide.md (wc 283) | yes | 1 (`total_duration_seconds = durationS`) |
| kit:project/.agents/skills/harness/references/model-selection-guide.md (wc 122) | yes | 0 |
| kit:project/.agents/skills/harness-evolve/SKILL.md (wc 92) | yes | 0 |
| kit:project/.agents/skills/ai-orchestrator/SKILL.md (wc 16) | yes | 1 (speed-plus-quality objective) |
| wildera:.agents/skills/ai-orchestrator/SKILL.md | yes | 0 (`diff -q` against the kit copy is empty) |
| wildera:.agents/skills/harness-evolve/SKILL.md | yes | 0 (`diff -q` empty; reading the kit copy is fair) |
| wildera:.agents/harness-history.md (wc 47; format only, plus lessons the map chose to take) | yes | 2 format/lesson gaps (line 46 has no Scope cell; line 44 escalate-not-to-fixer). Other rows are WildEra product history and are out of this area’s format brief |

`read fully: yes` is credible for the files above: the map’s line counts match `wc -l`, and the contracts that are present match the lines. Out-of-scope files the map names (execution-modes.md, paseo-runtime.md, workflow-recipes.md, scripts/) were not required. kit:templates/harness-history.md is outside the mapper block and is labeled as such; its 8 lines match. LICENSE is not in the mapper’s file list.
