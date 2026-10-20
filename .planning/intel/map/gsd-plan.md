# Map: GSD plan/research/verify adapter (GSP)

Source roots: `wildera:` = C:/Users/fish/Desktop/WildEraV6 @89143da; `upstream:` = C:/Users/fish/ext-src/gsd-core @274f8ca; `kit:` not used in this area. Owner decisions of 2026-10-20 assumed (Claude Code only, no Backlog, GSD core ships in the kit, project adapter, no omp).

## Coverage

| file | lines | read fully |
|---|---|---|
| wildera:tools/gsd/gsd.mjs | 1070 | yes (the `tree/reconcile/debug` branch only delegates to debug.mjs, out of scope) |
| wildera:tools/gsd/port.mjs | 292 | yes |
| wildera:.agents/workflows/gsd-plan.js | 629 | yes |
| wildera:.agents/workflows/gsd-research.js | 105 | yes |
| wildera:.agents/workflows/gsd-verify.js | 94 | yes |
| wildera:.agents/workflows/code-wave.js | 361 | yes |
| wildera:.agents/workflows/review-gate.js | 67 | yes |
| wildera:.agents/skills/gsd-plan/SKILL.md | 85 | yes |
| wildera:.agents/skills/gsd-plan/NOTICE.md | 13 | yes |
| wildera:.agents/skills/gsd-plan/LICENSE | 21 | partial (MIT text, first 12 lines; license is standard MIT) |
| wildera:.agents/skills/gsd-plan/references/adapter.md | 76 | yes |
| wildera:.agents/skills/gsd-plan/references/compatibility.md | 107 | yes |
| wildera:.agents/skills/gsd-plan/references/manifest.md | 44 | yes |
| wildera:.agents/skills/gsd-plan/references/skeleton-review.md | 47 | yes |
| wildera:.agents/skills/gsd-plan/generated/executor-rules.md | 232 | partial: header+adapter preface read via port.mjs source (port.mjs:144-166) and lines 1-12; the rest is verbatim upstream gsd-executor blocks |
| wildera:.agents/skills/gsd-plan/generated/plan-phase-contracts.md | 115 | partial: lines 1-14 + port.mjs:167-189; rest verbatim upstream plan-phase.md blocks |
| wildera:.agents/skills/gsd-discuss/SKILL.md | 36 | yes |
| wildera:.agents/skills/gsd-discuss/generated/discuss-phase.md | 525 | partial: first lines; whole body machine-compared to rewrite(upstream workflows/discuss-phase.md) = identical |
| wildera:.agents/skills/gsd-research/SKILL.md | 61 | yes |
| wildera:.agents/skills/gsd-research/references/adapter.md | 37 | yes |
| wildera:.agents/skills/code-wave/SKILL.md | 92 | yes |
| wildera:.agents/skills/code-wave/references/architect-prompt.md | 29 | yes |
| wildera:.agents/skills/gsd-plan/upstream/** | 254 files | listed only; UPSTREAM.json lines 1-15 read (pin, sha256 table) |
| wildera:.agents/agents/gsd-planner.md | 1014 | partial: header 1-22 read; body machine-compared to rewrite(upstream agents/gsd-planner.md minus front matter) = identical |
| wildera:.agents/agents/gsd-plan-checker.md | 1086 | partial: same method, identical after rewrite |
| wildera:.agents/agents/gsd-verifier.md | 972 | partial: same method, identical after rewrite |
| wildera:.agents/agents/gsd-phase-researcher.md | 906 | partial: same method, identical after rewrite |
| wildera:.agents/agents/gsd-skeleton-reviewer.md | 23 | yes |
| wildera:.agents/agents/wiring-architect.md | 35 | yes |
| wildera:.agents/agents/finding-verifier.md | 19 | yes |
| wildera:.agents/agents/ue-coder.md | 27 | yes |
| wildera:.agents/agents/ue-reviewer.md | 31 | yes |
| wildera:_workspace/gsd-port/DESIGN.md | 181 | yes |
| wildera:.planning/STATE.md | 164 | yes (r1: lines 163-164 were missed in the first pass and are now read; line 164 is a non-empty owner execution rule) |
| wildera:.planning/ROADMAP.md | 73 | yes |
| wildera:.planning/REQUIREMENTS.md | 47 | yes |
| wildera:.planning/phases/01-m1-p0/01-CONTEXT.md | 137 | yes |
| wildera:.planning/phases/01-m1-p0/01-01-PLAN.md | 235 | yes |
| wildera:.planning/phases/01-m1-p0/01-OUTLINE-REVIEW.md | 62 | yes |
| wildera:.planning/phases/01-m1-p0/01-PLAN-OUTLINE.md | 213 | partial: 1-60 (header, 37-row table, packet text start) |
| wildera:.planning/phases/01-m1-p0/01-PLAN-OUTLINE.manifest.json | 244 | partial: 1-40 |
| wildera:.planning/phases/01-m1-p0/revisions.json | 1630 | partial: 1-30 (format sample) |
| wildera:.planning/phases/01-m1-p0/research-attempt.json, handoff/w1.args.json | 11 / 63 | yes / partial 1-50 |
| wildera:.planning/phases/01-m1-p0/ (84 entries: CONTEXT, DISCUSSION-LOG, RESEARCH, PLAN-OUTLINE(.manifest.json), WIRING, OUTLINE-REVIEW, 37 PLAN + SUMMARY, handoff/w1-w6, revisions.json, research-attempt.json) | n/a | listed. NO VERIFICATION.md exists (phase not yet verified); nearest equivalent read: upstream template `upstream/gsd-core/templates/verification-report.md` (349 lines, yes) |
| wildera:_workspace/gsd/ (01-m1-p0, 01.1-test-harness) | n/a | listed; plan.args.json, research.args.json, run_meta.json read as model-config evidence |

## Summary

The GSD port vendors a pinned snapshot of open-gsd/gsd-core (`next` @274f8ca) into `upstream/` (never edited, sha256 manifest), generates the four GSD agents + executor-rules + plan-contracts + discuss/forensics text from it by path rewrites only, and puts every harness-specific rule into one adapter file (`references/adapter.md`) that is `include:`d after each agent body and wins on conflict. Upstream `Task()` spawns became three Paseo workflow scripts (`gsd-research.js`, `gsd-plan.js`, `gsd-verify.js`); upstream `gsd-tools.cjs` verbs became `tools/gsd/gsd.mjs` (same verb names, JSON on stdout, exit 0/1/66/69). Agents are unattended: they return markers in a JSON schema, the workflow turns owner-needing markers into `status: needs-owner`.

Planning pipeline (workflow `gsd-plan`): Outline (planner, table + manifest) -> mechanical outline check -> Wiring contract (architect, only if plans consume each other) -> Skeleton review gate (1..N lens lanes, <=3 passes, resolution checks, stall) -> Freeze (revisions.json hash) -> per-plan planners in parallel per wave -> structure check -> plan-checker revision loop (<=3, stall) with deterministic probes -> coverage gates -> handoff files `handoff/w<k>.args.json` (tracer plan alone first). Mode `gaps` re-plans from VERIFICATION.md. `gsd-verify` runs a fresh verifier and reads the report status back from the file.

Worth keeping in spirit: files-are-the-contract (agent claim never trusted; readback via `gsd.mjs`), input-hash invalidation (`revisions.json`, digests in prompts so resume never reuses an answer for other inputs), attempt records written before dispatch, never "proceed anyway" on an open blocker, generated-not-edited agents with a `check` that fails on drift, deterministic probes handed to LLM checkers. Mostly WildEra-specific (must become the project adapter): the verify vocabulary (`test: WildEra.*`, `scenario:`), ownership model (`owns`, shared files, LAYOUT), UE build/Verify stage, spec-rule requirement IDs, wiring-architect/ue-* agent bodies, model names. Evidence from STATE.md: planning stages (skeleton review: 38 issues in pass 1) paid off, but the code-wave Verify/debug loops did not converge and the owner replaced them with a single fixer (STATE.md:124,131,148,151).

## Behaviors

### GSP-01 Pinned verbatim snapshot (`vendor`)
- Behavior: `port.mjs vendor --from <clone>` copies a fixed list (SNAPSHOT: LICENSE; 7 agent files: gsd-planner, gsd-plan-checker, gsd-verifier, gsd-executor, gsd-phase-researcher, gsd-debugger, gsd-debug-session-manager; workflows debug.md and forensics.md; also `execute-plan.md` and `plan-review-convergence.md`; debug workflows, research dispatch fragment, `gsd-core/{references,templates,contexts}/`, plan-phase/execute-phase/discuss-phase/review/quick-batch workflows+dirs, 3 docs) from a local clone into `.agents/skills/gsd-plan/upstream/`, deleting the old dir first; entries ending `/` copy recursively, regular files only, symlink = hard error; missing entry = error; writes `UPSTREAM.json` {repo, branch, commit, date, license, vendored, files{path: sha256 of LF-normalised text}}. Refuses unless the clone HEAD equals the pinned commit (a bump = edit PIN deliberately).
- Proposal: KEEP mechanism, CHANGE scope: vendor only files the kit core actually uses (WildEra snapshot has 254 files incl. quick-batch, review, execute-phase, debug) and make the pin a data file, not a code constant.
- Source: wildera:tools/gsd/port.mjs:19-35,71-86,98-112,196-197; wildera:.agents/skills/gsd-plan/upstream/UPSTREAM.json:1-9
- Note (r1): `build`/`check` also call `managerTemplates` (debug.mjs) on the vendored session-manager body; if its Step 2 / Step 3d anchors are gone the build fails (port.mjs:196-197). Belongs to the gsd-debug area but is a build-failure condition of this mechanism.
- Why it exists: upstream is untrusted data; work must be reproducible and diffable per bump (port.mjs:2,8; DESIGN.md:28-31).
- Test idea: vendor from a clone at another commit -> error naming both hashes; symlink in clone -> error; UPSTREAM.json hashes equal sha256 of every file.

### GSP-02 Clone HEAD read without running git
- Behavior: HEAD of the untrusted clone is read from `.git/HEAD` -> loose ref -> `packed-refs`; no git process is spawned inside the clone.
- Proposal: KEEP.
- Source: wildera:tools/gsd/port.mjs:87-96
- Why it exists: "the clone is untrusted data" (port.mjs:87); git hooks/config in a clone could execute code.
- Test idea: clone with a malicious `.git/config` hook; vendor must not trigger it.

### GSP-03 Generated agents = adapter front matter + precedence note + upstream body
- Behavior: for each of gsd-phase-researcher, gsd-debugger, gsd-planner, gsd-plan-checker, gsd-verifier, `build` writes `.agents/agents/<name>.md`: front matter (name, description, GENERATED comment, "Fallback only: workflows pass the model", `model: pro`, `tools: [...]` advisory, `include:` list), then a `<!-- GENERATED ... -->` line, a `<wildera_adapter_precedence>` block (body unchanged except paths; adapter wins), then the upstream body (front matter stripped) path-rewritten. Includes: all get `adapter.md`; planner also `manifest.md` + `generated/plan-phase-contracts.md`; researcher also `gsd-research/references/adapter.md`. Verified by me: bodies of the 4 gsd agents are byte-identical to rewrite(upstream body).
- Proposal: KEEP (generated, adapter-wins, include-after-body). CHANGE: drop gsd-debugger (gsd-debug is another area); rename `wildera_adapter_precedence` to a project-neutral tag; model is a tier name resolved by the kit.
- Source: wildera:tools/gsd/port.mjs:37-55,122-143; wildera:.agents/agents/gsd-planner.md:1-22
- Why it exists: "keep GSD's ideas intact; change only the adapter" (DESIGN.md:10-12).
- Test idea: `build` twice is idempotent; editing a generated agent makes `check` fail.

### GSP-04 Path rewrite rules
- Behavior: only three rewrites: `~/.claude/gsd-core/` and `@~/.claude/gsd-core/` -> vendored path (keeping `@`), `@gsd-core/` -> `@<vendored>`, and bare `gsd-core/(references|templates|workflows|contexts)/` (not preceded by word/`.`/`/`/`@`/`~`/`-`) -> vendored path. Nothing else in upstream text changes.
- Proposal: KEEP (rule list must be tested; lookbehind prevents double rewrite).
- Source: wildera:tools/gsd/port.mjs:64-69; wildera:_workspace/gsd-port/DESIGN.md:43-46
- Why it exists: agents read references from the vendored tree, not an installed `~/.claude/gsd-core`.
- Test idea: snapshot test with a text containing all three forms and a `foo/gsd-core/references/x` that must stay unchanged.

### GSP-05 executor-rules.md generated from gsd-executor
- Behavior: file = GENERATED line + adapter preface + verbatim `<deviation_rules>`, `<analysis_paralysis_guard>`, `<summary_creation>` blocks (path-rewritten). Preface rules: PLAN.md is the brief; no commits (write `n/a (wave commit)`, no durations/actuals not measured); no builds/tests (list every `<verify>` as `awaiting Verify`); deviation rules 1-3 bounded by `owns`, rule 4 never applied (status partial + notes); unattended checkpoints return partial with `## CHECKPOINT REACHED`; TDD unsupported; SUMMARY written to the task's `summary:` path from the summary template with Known Stubs/Threat Flags replacing windows ledger; never touch STATE/ROADMAP/REQUIREMENTS.
- Proposal: CHANGE: keep generation of the three verbatim blocks in kit core; the preface splits into a generic part (no commits/state, unattended checkpoints, SUMMARY path) and an adapter part (owns/contractRequests/sharedRequests, CompileFile, CODING.md threat model).
- Source: wildera:tools/gsd/port.mjs:144-166; wildera:.agents/skills/gsd-plan/generated/executor-rules.md:1-12
- Why it exists: coders never build/test/commit (DESIGN.md:13); one writer of shared state.
- Test idea: generated file contains the three block names verbatim and each preface bullet.

### GSP-06 plan-phase-contracts.md generated from plan-phase steps 8 and 12
- Behavior: extracts `<tracked_source_paths>`, `<failing_direction_contract>`, `<downstream_consumer>`, `<deep_work_rules>`, `<quality_gate>` after the "## 8. Spawn gsd-planner Agent" heading and the step-12 `<instructions>` block; any missing anchor throws (build fails). Included in every planner prompt; the workflow sends only situational `<planning_context>`/`<revision_context>`.
- Proposal: KEEP; anchors are the early-warning for upstream restructures.
- Source: wildera:tools/gsd/port.mjs:167-189; upstream:gsd-core/workflows/plan-phase.md:751 (step 8 heading), :1138 (step 12 heading)
- Why it exists: avoid copying the orchestrator prose while keeping the standing planner contract verbatim (DESIGN.md:50-52).
- Test idea: against a snapshot lacking `<deep_work_rules>`, `build` exits non-zero with `missing anchor`.

### GSP-07 discuss-phase and forensics text generated verbatim
- Behavior: `gsd-discuss/generated/discuss-phase.md` and `gsd-forensics/generated/forensics.md` = GENERATED line + rewrite(upstream workflow file). The discuss body equals rewrite(upstream) exactly (I checked). `check` also verifies bare `workflows/discuss-phase/*.md|json` lazy-load targets exist.
- Proposal: KEEP discuss (interactive method runs in the main session); forensics belongs to gsd-debug area.
- Source: wildera:tools/gsd/port.mjs:190-195,259-264
- Why it exists: "the interactive method is upstream text, not a second, shortened algorithm" (port.mjs:190).
- Test idea: `check` fails when a lazy-loaded discuss sub-file is removed from the snapshot.

### GSP-08 `build` refuses on a tampered snapshot
- Behavior: `build` first runs strict `verifySnapshot`: UPSTREAM.json commit must equal PIN; every listed file must exist and hash-match (LF-normalised); any file under `upstream/` not in UPSTREAM.json is a problem; problems throw. Then writes all generated files and prints the list.
- Proposal: KEEP.
- Source: wildera:tools/gsd/port.mjs:201-220
- Why it exists: snapshot is never edited; change the adapter (port.mjs:214 message).
- Test idea: change one byte of an upstream file -> `build` fails naming it; add a stray file -> `file not in UPSTREAM.json`.

### GSP-09 `check`: drift, dangling references, unmapped verbs
- Behavior: exit 1 if (a) snapshot problems, (b) a generated file is missing/stale/hand-edited (compared LF-normalised to a fresh `generate()`), (c) a file referenced directly by a generated file is missing from the snapshot (depth 1 = problem, deeper up to depth 3 = warning, shown by `--verbose`), (d) a `gsd_run [query] <verb>` found in generated files or in direct references (excluding workflow files, `gsd-run-resolver.md`, `loop-hook-dispatch.md`, prose words like `is/as/to`) is not a key of `VERBS` in gsd.mjs. `check <name>`/`windows <x>` are two-word verbs. The prose-word exclusion set is fixed: `is, as, to, the, a, and, or, on, in, function, launcher, call, calls, resolves, resolver` (port.mjs:230); verbs are collected only from generated files and depth-1 references (port.mjs:277). Exit semantics differ in gsd.mjs: an unknown `query` verb hits the default -> 69 (gsd.mjs:935), an unknown `check <sub>` throws exit 1 `unknown check` (gsd.mjs:981). Prints `check: N problems, M warnings; K references followed, V verbs mapped`.
- Proposal: KEEP; this is the upgrade safety net. CHANGE: verb scan scope should come from the kit's verb table, not a hard-coded exclusion list.
- Source: wildera:tools/gsd/port.mjs:222-285
- Why it exists: an upstream bump must not silently introduce a verb or reference the adapter cannot serve (port.mjs:8).
- Test idea: add a `gsd_run foo.bar` to a vendored reference -> `check` reports `unmapped gsd-tools verb "foo.bar"`.

### GSP-10 Taking an upstream update
- Behavior: documented procedure only: vendor from the new commit (update PIN), `build`, `check`, review the diff of `upstream/` and `generated/`. No automatic fetch/merge; no semver; the pin is the single source and is duplicated in port.mjs, UPSTREAM.json, NOTICE.md and DESIGN.md.
- Proposal: CHANGE: single pin file; one command `gsd upstream bump <clone>` that runs vendor+build+check and prints the diff stat; clone stays outside the repo.
- Source: wildera:tools/gsd/port.mjs:8,19-20; wildera:.agents/skills/gsd-plan/NOTICE.md:3; wildera:_workspace/gsd-port/DESIGN.md:28-31
- Why it exists: not stated beyond reproducibility.
- Test idea: bump to a fixture "v2" snapshot with a changed verb set -> command exits non-zero until the verb table is updated.

### GSP-11 Verb table with explicit "not ported" reasons
- Behavior: `VERBS` maps each upstream gsd-tools verb to `{ported:true}` or `{ported:false, reason}`. A non-ported verb (via `query <verb>`, `check <x>`, `windows <x>` or bare) prints `{status:"unavailable", verb, reason}` and exits 69; an unknown verb reaches `default` -> 69 `not ported ... continue without it`. Not-ported set includes: commit*, verify.commits, run-with-timeout, estimate-check, learnings.query, user-story.validate, task.is-behavior-adding, tdd-red-evidence, windows append, config-get, git.base-branch, dispatch-capacity, agent-skills, graphify, loop, resolve-model, resolve-dispatch-type, research-plan/store, classify-confidence, package-legitimacy, websearch, todo.match-phase, every `state.*` mutation, roadmap.update-plan-progress, requirements.mark-complete.
- Proposal: KEEP the mechanism (69 is never a pass; reason tells the agent what to do). CHANGE: drop todo.match-phase (Backlog gone), keep the rest as core defaults; adapter can add rows.
- Source: wildera:tools/gsd/gsd.mjs:36-75,935,957-959; wildera:.agents/skills/gsd-plan/references/adapter.md:24-27
- Why it exists: exit-code convention of upstream #5170: "could not look" is not a verdict (gsd.mjs:9-11).
- Test idea: `gsd query commit` -> exit 69 + reason; a `ported:false` verb never prints exit 0.

### GSP-12 `gsd_run` -> CLI mapping and exit-code contract
- Behavior: wherever upstream says `gsd_run <args>`, agents run `node tools/gsd/gsd.mjs <same args>` from the repo root; no resolver bootstrap, no `@file:` indirection. Exit: 0 ran and valid, 1 negative verdict (read JSON), 66 nothing in scope, 69 could not look/not ported. stdout is one JSON line (or the bare value with `--pick <key>`); errors print `{status:"error", error}` and exit `e.code` if integer else 1. `--root <dir>` (must contain `.git`) re-points ROOT to a worktree and resets caches; only `handoff`, `revisions record`, `attempt record`, `supersede`, `write` write files, all inside the phase dir.
- Proposal: KEEP contract; CHANGE: relocate to the kit CLI (`ph gsd ...` or kit-installed script) so projects do not carry the tool.
- Source: wildera:tools/gsd/gsd.mjs:1-11,939-957,1058-1069; wildera:.agents/skills/gsd-plan/references/adapter.md:22-24
- Why it exists: upstream compatibility so vendored agent text works unchanged.
- Test idea: each verb: exit code and JSON shape snapshot; `--pick status` prints the bare value + newline.

### GSP-13 Own YAML-subset frontmatter parser
- Behavior: parses block maps/sequences, flow `[..]`/`{..}`, quoted/plain scalars (null/true/false/int/float), `|` and `>` block scalars, comments (outside quotes), multi-line flow values; keys may be quoted; a quote opens only at a token start (so apostrophes in plain text are text). `frontmatter()` returns `{fm, body, present, error}`; BOM and CRLF tolerated; a parse error is reported, not thrown.
- Proposal: CHANGE: use a real YAML library only if the kit already depends on one; otherwise keep this (the kit has no npm deps) with a conformance test suite from the plan/summary/verification samples.
- Source: wildera:tools/gsd/gsd.mjs:77-212
- Why it exists: no external YAML dependency in the harness; plans nest `must_haves.artifacts[]`.
- Test idea: round-trip the 01-01 PLAN frontmatter (nested lists of maps, flow list `owns: [...]`) and verify exact JSON.

### GSP-14 Phase layout, ids and artifact kinds
- Behavior: phase dir `.planning/phases/<NN>-<slug>/` (also decimal `01.1-test-harness`); resolver accepts a path or number (`pad` zero-pads the integer part) and matches `<padded>` or `<padded>-*`. Artifact kinds by regex: plan `^\d+(\.\d+)?-\d+-PLAN.md`, `-SUMMARY.md`, `-RESEARCH.md`, `-CONTEXT.md`, `-VERIFICATION.md`, `-PLAN-OUTLINE.md`, `-WIRING.md`, `-UAT.md`; plan id = filename minus `-PLAN.md`.
- Proposal: KEEP (inserted decimal phases proved needed: Phase 1.1).
- Source: wildera:tools/gsd/gsd.mjs:214-237; wildera:.planning/ROADMAP.md:15,35
- Why it exists: upstream phase layout; owner inserted a decimal phase (ROADMAP.md:15,35).
- Test idea: `phase list 1.1` resolves `01.1-test-harness`; `01-PLAN-OUTLINE.md` not listed as a plan.

### GSP-15 ROADMAP.md format (parsed)
- Behavior: a phase is a heading `##`..`####` `Phase <N>[.<M>]: <name>` (separators `: — – -`); inside it `**Goal:**`, `**Depends on:**`, `**Requirements:**` (comma list; `none/tbd/-` ignored), `**Success Criteria**` followed by a numbered list. A heading of level 1-3 ends the section. `roadmap get-phase <id>` -> {found, phase_number, phase_name, goal, depends_on, requirements, success_criteria, section} (66 when absent); `roadmap analyze` -> per phase {plans, summaries, verification status or `missing`}. The ROADMAP section text is hashed into every revision key.
- Proposal: KEEP format (it is the upstream format) in core; the `Progress` table and checkbox list are orchestrator-written.
- Source: wildera:tools/gsd/gsd.mjs:239-259,271,910-921,696-699; wildera:.planning/ROADMAP.md:21-33 (phase heading, Requirements line 24, six Success Criteria 26-32, Plans 33),70-73 (Progress table)
- Why it exists: the requirements gate and goal text are read from ROADMAP, not from the prompt.
- Test idea: parse the WildEra ROADMAP: Phase 1 yields 32 requirement IDs and 6 success criteria.

### GSP-16 REQUIREMENTS.md format (parsed)
- Behavior: rows `| ID | Spec | Rule | Phase | Status |` (header/divider rows skipped) or bullets `- [ ] **ID**: text (spec: path)` -> map ID -> {spec, text}. IDs are project-defined (WildEra: `SW-NN`, `BUG-NNN`, `BW-*`, `HAR-NN`).
- Proposal: CONFLICT: adapter.md says IDs are `<SPEC-ID>:<rule>` (`UX-LIVE:R3`) but REQUIREMENTS.md uses short ids with the spec path in a column. KEEP the table format and the ID->spec lookup in core; the ID scheme is project adapter.
- Source: wildera:tools/gsd/gsd.mjs:260-270; wildera:.agents/skills/gsd-plan/references/adapter.md:35-37; wildera:.planning/REQUIREMENTS.md:1-12,38-45
- Why it exists: handoff derives each task's `specs` from requirement->spec rows (gsd.mjs:654).
- Test idea: a requirements table with backticked cells and a bullet form both parse to identical maps.

### GSP-17 `verify plan-structure` = upstream checks + adapter checks
- Behavior: errors: frontmatter parse failure; missing any of `phase, plan, type, wave, depends_on, files_modified, autonomous, must_haves`; no `<task>`; no task with an `<automated>` verify obligation; task without `<name>`; types `auto|tracer|manual` need `<action>` (error) and `<verify>/<done>/<files>` (warnings); `checkpoint:human-verify` needs what-built/how-to-verify/resume-signal; `checkpoint:decision` needs decision/options/resume-signal and `auto_select` must name an option id; `checkpoint:human-action` needs action/instructions/verification/resume-signal; checkpoint task in a plan whose `autonomous` is not false; truncation (write-continue sentinel, `<tasks>` without `</tasks>`, file ends inside a tag). Warnings: unknown task type, wave>1 with empty depends_on, one-way reversibility without an earlier `checkpoint:decision`. Adapter errors: `type: tdd`; missing `owns`; `files_modified` outside owns; `files_modified` is a shared file; unparseable owns. Adapter warning: `<automated>` not in the vocabulary. Output {valid, errors, warnings, task_count, tasks[], frontmatter_fields}; exit 1 if invalid. Task regex `/<task(\s[^>]{0,1000})?>((?:(?!<task[\s>])[\s\S])*?)<\/task>/g`.
- Proposal: CHANGE: split into core structure checks and a project hook for ownership/vocabulary; make "no task has an automated obligation" a core error (it is a harness departure, upstream only warns).
- Source: wildera:tools/gsd/gsd.mjs:273-339,897-901; wildera:_workspace/gsd-port/DESIGN.md:138-146
- Why it exists: planners wrote malformed/truncated files; the workflow re-checks on disk after every write (gsd-plan.js:163-170). An empty-task plan "would run an empty task" in code-wave (gsd.mjs:296).
- Test idea: 10 fixture plans, one per error/warning class, assert exact messages and `valid`; a plan cut mid-tag -> `Truncated: file ends inside a tag`.

### GSP-18 Verify-command vocabulary
- Behavior: `<automated>` text is classified: `MISSING...` = sentinel (Wave-0 placeholder), `test: <filter>`, `scenario: <args>` (ids from `-Scenario x` / `-Scenarios a,b` / bare id), `build`, `cmd: <read-only command>`, else `unknown`. Every `<automated>` must be followed by `<fails_when>`.
- Proposal: CHANGE: the vocabulary is a project-adapter extension point (kinds, parsers, resolvers); core only knows `automated`/`fails_when` and `sentinel`.
- Source: wildera:tools/gsd/gsd.mjs:341-355; wildera:.agents/skills/gsd-plan/references/adapter.md:48-57
- Why it exists: coders never run commands; each obligation must map to a Verify-stage runner (adapter.md:50).
- Test idea: adapter registers kind `cmd`; a plan using an unregistered kind yields a blocker in the probe.

### GSP-19 `check verify-command-paths` (resolvability probe)
- Behavior: per plan task `<automated>` returns {plan, task, command, kind, status, severity, detail?, target?}. build/sentinel -> ok. `test:` filters (split on `+`/`,`) must start with `WildEra.` and appear as `"<filter` in game C++ sources (scan `game/Source`, `game/Plugins/WildEraDev`, `.cpp/.h`, skipping Intermediate/Binaries/Saved/ThirdParty); missing but the plan modifies a `/Tests/` file -> `pending_creation` (severity none), else blocker. `scenario:` ids must be registered in source (`"id"` or `TEXT("id")`); missing but the plan modifies `WildEraDev/` -> pending_creation. `cmd:` containing Build/Test/Scenario/Smoke/Play/Server.ps1, UBT, RunUAT, UnrealEditor -> blocker (read-only only); otherwise the first path-like token must exist or be in files_modified; no path-like token -> warning `unresolvable`. No plans -> exit 69 `unresolvable`. An unknown kind is a probe blocker (gsd.mjs:374). Overall `{status: ok|issues, commands}` and exit 0 (the workflow, not the exit code, acts on severity).
- Proposal: CHANGE: core keeps the probe protocol (`pending_creation`, severities, exit semantics); resolution logic is adapter.
- Source: wildera:tools/gsd/gsd.mjs:356-396,963-967
- Why it exists: upstream #2401 "verify command path resolvability"; planners invented non-existent test names (gsd-plan.js:214-220).
- Test idea: plan referencing an unregistered scenario but creating it under WildEraDev -> `pending_creation`; without -> blocker.

### GSP-20 `check verify-failure-directions`
- Behavior: each non-sentinel `<automated>` must be immediately followed by `<fails_when>`; missing -> blocker; placeholder (`tbd/todo/n/a/none/unknown/?/-`) -> blocker `rejected`; bare "fails/failure/error" restatement -> warning; else stated. Output as GSP-19.
- Proposal: KEEP (core).
- Source: wildera:tools/gsd/gsd.mjs:397-417,968-972
- Why it exists: upstream #3172 failing-direction contract (gsd-plan.js:227-237).
- Test idea: `<fails_when>fails</fails_when>` -> severity warning `restatement`.

### GSP-21 Decision coverage (CONTEXT `<decisions>`)
- Behavior: parses `- **D-NN:** text` (also `D1-NN`, `D-NN [tags]`, `— ` forms) inside `<decisions>` blocks; `### ` headings set category; category "Claude's Discretion" and tags informational/folded/deferred make a decision non-trackable. An unparseable `**D..-` bullet makes coverage fail with a message to use `- **D-NN:** text`. A decision is covered when its id appears (word-boundaried) in a plan's objective/tasks/task/action/read_first/behavior/verify/acceptance_criteria/done bodies or in `must_haves`/`truths`/`objective` frontmatter. No CONTEXT or no trackable decision -> passed/skipped. `check.decision-coverage-verify` reports the same but never blocks (exit 0).
- Proposal: KEEP.
- Source: wildera:tools/gsd/gsd.mjs:419-457,931-933; wildera:.planning/phases/01-m1-p0/01-CONTEXT.md:15-59
- Why it exists: plan-phase gate 13a; decisions are locked and must not be silently dropped (DESIGN.md:169-170).
- Test idea: CONTEXT with D-01..D-03 where one is tagged `[informational]`; a plan citing only D-01 -> uncovered = [D-02]; message lists id|category|text.

### GSP-22 `check coverage` (requirements + decisions gate)
- Behavior: passed only if the phase has a ROADMAP entry, every ROADMAP requirement ID appears in some plan's `requirements`, and decision coverage passes. Output {passed, requirements{total, covered, uncovered, extra, roadmapEntry}, decisions}; exit 1 when not passed. `extra` (claimed but not on the ROADMAP line) is reported, not blocking.
- Proposal: KEEP.
- Source: wildera:tools/gsd/gsd.mjs:974-980; wildera:.agents/workflows/gsd-plan.js:303-307
- Why it exists: plan-phase gate 13 (DESIGN.md:169-170).
- Test idea: drop one requirement from all plans -> exit 1 and `uncovered` names it.

### GSP-23 Ownership model and shared files
- Behavior: plans carry frontmatter `owns` (`Module:Folder`, `Content:<path>`, `Path:<repo path>`; parsed by `ownedPrefixes` imported from `tools/ue/ownership_check.mjs`). Shared files are never owned or in files_modified: `*.Build.cs`, `*.Target.cs`, `.uproject`, `.uplugin`, any `.ini`, any `game/**/Config/` folder; detection is path-rule based plus a depth-5 scan of `game/` so an ancestor prefix covering an existing shared file is caught. Needed shared changes go in a `<shared_changes>` block (file, exact change, reason) that the orchestrator applies before the wave. `check owns <phase> [--plans a,b]` -> {passed, problems, plans}: no owns, owns equal to/covering a shared path, files_modified outside owns, shared file in files_modified, plus the wave overlap problems of GSP-27.
- Proposal: CHANGE: generic core = "a plan declares a disjoint write set per wave; some paths are orchestrator-only"; the owner-entry syntax, shared-file predicate and folder scan are project adapter (UE specific). Keep `<shared_changes>`.
- Source: wildera:tools/gsd/gsd.mjs:459-490,608-621,671,973; wildera:.agents/skills/gsd-plan/references/adapter.md:41-42
- Note (r1): the depth-5 `game/` scan does not enter Intermediate, Binaries, Saved, Content, Private, Public, DerivedDataCache (gsd.mjs:470-476), so a `Path:` prefix that covers a shared file only under those directories is caught by the path rules (`*.Build.cs`, `*.ini`, `Config/`) but not by the scan. The verify source walk (GSP-19) skips Intermediate, Binaries, Saved, ThirdParty (gsd.mjs:362).
- Why it exists: parallel coders share one working tree (no worktrees); disjoint ownership is the safety net (compatibility.md:32).
- Test idea: two same-wave plans owning `Path:a/` and `Path:a/b.cpp` -> `overlapping owns`; an owns covering `Config/` -> shared-file problem.

### GSP-24 Outline format and `outline parse`
- Behavior: `<NN>-PLAN-OUTLINE.md` is a markdown table whose header cell contains `Plan ID`, then columns matched by prefix `objective`, `wave`, `depends`, `requirements`; rows -> {id, objective, wave, depends_on[], requirements[]}; `none/-/—` = empty. `complete` is true when any line is exactly `## OUTLINE COMPLETE` (`/^## OUTLINE COMPLETE\s*$/m`, gsd.mjs:512); the planner prompt, not the parser, asks for it to be the last line (gsd-plan.js:382-383). Sibling `<NN>-PLAN-OUTLINE.manifest.json`. `outline parse` -> {file, manifestFile, exists, complete, rows, manifest, manifestError} (exit 66 if the file is absent). Plan IDs must be `<NN>-<MM>` (>=2 digits).
- Proposal: KEEP (upstream chunked-planning contract + manifest).
- Source: wildera:tools/gsd/gsd.mjs:492-513,985; wildera:.agents/skills/gsd-plan/references/manifest.md:3
- Why it exists: upstream 8.5.1 resume check greps the marker (gsd-plan.js:382).
- Test idea: table with different column order and backticked ids parses; file without the final marker -> `complete:false`.

### GSP-25 `outline check` (mechanical skeleton check)
- Behavior: errors: no outline; no `## OUTLINE COMPLETE`; no rows; duplicate id; id not `<NN>-NN`; empty objective; depends on unknown plan; dependency in the same or later wave; ROADMAP requirement not assigned to any row; missing/unparseable manifest; manifest without an entry for a row or an entry not in the outline; empty manifest owns; owns invalid/shared; consumes from an unknown plan or a later wave; two same-wave plans with overlapping owns. Warnings: claimed id not on the ROADMAP line; no ROADMAP entry; manifest requirements differ from the row; consumed symbol not in the producer's `produces`; verify obligation outside vocabulary. Output also {crossPlan[{consumer, producer, symbol, sameWave}], needsWiring (any cross-plan edge), waves, rows}. `--tracer false` disables tracer rules (default true).
- Proposal: KEEP; owns/vocabulary parts via adapter hooks.
- Source: wildera:tools/gsd/gsd.mjs:514-568,581,986; wildera:.agents/skills/gsd-plan/references/manifest.md:29
- Why it exists: errors are caught before a reviewer is spent (SKILL.md:85); compatibility.md:55 "checked mechanically before planning".
- Test idea: fixture outlines for each error class; `needsWiring` true iff a manifest `consumes` exists.

### GSP-26 Tracer rules (TRACER_MODE)
- Behavior: with tracer mode on: at least one manifest plan has `tracer.is`; every tracer plan is in wave 1, `consumes` nothing, has `tracer.outcome`, and names `tracer.scenario` (`none: <reason>` allowed with a warning). The tracer plan's first task has `type="tracer"`; handoff treats a plan as tracer when any task has that type.
- Proposal: KEEP; scenario becomes "an end-to-end proof command from the adapter vocabulary".
- Source: wildera:tools/gsd/gsd.mjs:569-580,636; wildera:.agents/skills/gsd-plan/references/adapter.md:59-61
- Why it exists: a self-contained slice proves the layers before expansion; coders cannot verify between tasks, so the tracer runs alone (adapter.md:61).
- Test idea: tracer plan in wave 2, or consuming another plan -> distinct errors.

### GSP-27 Waves
- Behavior: `waves <phase> [--plans ids]` groups plans by frontmatter `wave` (default 1); errors: frontmatter parse errors; unknown `depends_on`; dependency not in an earlier wave; same-wave plans both modifying one file or with overlapping owns. Warning: wave>1 with empty depends_on. Output {waves[{wave, plans[]}], errors, warnings}; exit 1 on errors. With `--plans`, dependencies on plans not in the subset but on disk are allowed (gap mode).
- Proposal: KEEP.
- Source: wildera:tools/gsd/gsd.mjs:584-607,988-991
- Why it exists: waves from `depends_on` (compatibility.md:18).
- Test idea: a gap-mode subset depending on an executed plan passes.

### GSP-28 `handoff`: plans -> execution args, tracer first
- Behavior: refuses (exit 1) if waves or ownership have errors, or if a tracer plan depends on/consumes anything. Splits so tracer plan(s) run alone as the first execution wave; the rest of that plan wave follows as the next execution wave; other plan waves one each. For each segment writes `<phaseDir>/handoff/[<prefix>-]w<k>.args.json` = `{...base (stdin JSON minus tasks/waveIdPrefix), wave:"full", waveId:"<prefix|gsd-<phase>>-w<k>", gsdPhase, planWave, planRevision (sha256 of all plan texts), tasks[]}`; each task: `key plan-<id>`, `owns` = plan owns + `Path:<phaseDir>/<id>-SUMMARY.md` (that exact file only), `specs` (requirement->spec rows + frontmatter specs), `requirements`, `plan`, `summary`, `planHash` (12 hex), `brief` ("GSD plan <id> ... Your PLAN.md is the brief..."), `tests` (test: filters), `scenarios`, `verify[{task, kind, command, target}]`, `tracer`. Returns {planRevision, waves[{executionWave, planWave, waveId, argsFile, tasks, tracer}], sharedChanges[{source, text}]}. `--prefix` (lower-case/digits/dashes) names gap handoffs (`gap-w<k>`); `--plans` restricts to a subset.
- Proposal: CHANGE: handoff format is the contract between planning and execution; keep it but executor-neutral (core defines the wave-args schema; adapter adds owns/tests/scenarios fields).
- Source: wildera:tools/gsd/gsd.mjs:622-673,992-996; wildera:.planning/phases/01-m1-p0/handoff/w1.args.json:1-50
- Why it exists: coders cannot run a verify between tasks, so a red tracer must stop expansion (gsd.mjs:634-635).
- Test idea: tracer plan + two wave-1 siblings -> w1 (tracer alone), w2 (siblings), w3...; a tracer that depends on another plan -> exit 1.

### GSP-29 `revisions.json`: input hashes that invalidate dependents
- Behavior: `revisions record|check|hash|show <phaseDir> [key]`. Keys and covered files: `research` (CONTEXT, REQUIREMENTS, PROJECT.md, specs of the phase's requirement IDs, files in CONTEXT `<canonical_refs>` backticks, AGENTS.md, CODING/LAYOUT, researcher agent + both adapters + research dispatch fragment; excludes the report); `inputs` (sources + RESEARCH.md + research-attempt.json); `freeze` (outline, manifest, WIRING, inputs); `plan:<id>` (freeze + that plan); `plans`/`checked`/`handoff` (freeze + all plans). Every key also hashes the phase's ROADMAP section. Hash = sha256 of `path\0sha(content)` lines + roadmap. `record` stores {hash, files[], at, head=git HEAD}; `check` exit 0 same, 1 changed, 66 never recorded; reports `headChanged` (a code change alone does not invalidate a kept plan, it is only reported). Atomic write (tmp + rename). `hash` prints the current hash without recording.
- Proposal: KEEP the invalidation model; CHANGE: the file list per key must not be stored in full (revisions.json is 1630 lines for one phase); store hash + list once; source-file set (`AGENTS.md`, `game/CODING.md`, `game/LAYOUT.md`) comes from the adapter.
- Source: wildera:tools/gsd/gsd.mjs:675-704,997-1015; wildera:.agents/skills/gsd-plan/references/manifest.md:31-44; wildera:.planning/phases/01-m1-p0/revisions.json:1-30
- Why it exists: a changed owner decision/outline/wiring must re-run the stages built on it, while resume skips unchanged work (manifest.md:44). DESIGN.md:84-88 planned a baseline-commit hash too; the code does not include it (CONFLICT, doc stale).
- Test idea: record freeze; edit CONTEXT -> `check freeze` exit 1; edit only ROADMAP of another phase -> still 0; edit ROADMAP section of this phase -> 1.

### GSP-30 `supersede`: plans outside the approved outline are moved, never deleted
- Behavior: `supersede <phaseDir> --keep id,id` (required) moves every `*-PLAN.md` and matching `*-SUMMARY.md` not in the keep set to `<phaseDir>/superseded/` (suffix `.N` on collision); returns {moved[]}.
- Proposal: KEEP.
- Source: wildera:tools/gsd/gsd.mjs:1016-1032; wildera:.agents/workflows/gsd-plan.js:564-569; wildera:.agents/skills/gsd-plan/references/compatibility.md:44
- Why it exists: a leftover plan from an earlier outline must not reach a check, gate or handoff.
- Test idea: outline shrinks from 5 to 4 rows -> old plan file in `superseded/`, `phase list-plans` omits it.

### GSP-31 Attempt records written before dispatch
- Behavior: `attempt record|show <phaseDir> --kind gap|verify|research` stores/reads `<phaseDir>/<kind>-attempt.json` (stdin JSON + `at`; atomic). `show` exit 66 if none. Used so a workflow that dies mid-attempt resumes that attempt: gap = {source report path+sha, plans before, plans written}; verify = {key (input hash), prev report sha/status/path, done, reportSha}; research = {key, invocationId, signature, sequence, inputDigest, prevSha, done, blocked, reportSha}.
- Proposal: KEEP, simplify: three kinds share one small schema {key, before, done, result}.
- Source: wildera:tools/gsd/gsd.mjs:1033-1046; wildera:.agents/skills/gsd-plan/references/compatibility.md:59; wildera:.planning/phases/01-m1-p0/research-attempt.json:1-11
- Why it exists: a report written by an interrupted verifier/researcher must be accepted on resume, not compared with itself; a gap planner that crashed leaves plans to reconcile.
- Test idea: kill the verifier after it wrote the report; rerun -> accepted without a second agent run.

### GSP-32 `write` and `hash` helpers
- Behavior: `write <phaseDir> <NAME>` (NAME upper-case letters/dashes) atomically writes stdin to `<phaseDir>/<NN>-<NAME>.md` (used for OUTLINE-REVIEW); `hash` prints sha256 of stdin (LF-normalised).
- Proposal: KEEP (workflow scripts cannot write files).
- Source: wildera:tools/gsd/gsd.mjs:1047-1054; wildera:.agents/workflows/gsd-plan.js:551
- Why it exists: workflow scripts have no fs access (gsd-plan.js:65, DESIGN.md:178).
- Test idea: `write p OUTLINE-REVIEW` with bad NAME `foo` -> exit 1.

### GSP-33 `research.status`: the report, not the agent's claim
- Behavior: reads `<phaseDir>/<NN>-RESEARCH.md`: 66 `missing`; invalid (exit 1) if front matter fails, `status` not complete|blocked, `input_digest`/`attempt_key` not 64-hex, write-continue sentinel present, for complete: no final line `<!-- gsd:research-complete <attempt_key> -->`, missing sections Summary / Standard Stack / Architecture Patterns / Don't Hand-Roll / Common Pitfalls / Sources, no provenance tags `[VERIFIED:|CITED:|ASSUMED]`, no `<user_constraints>` when a CONTEXT exists, a ROADMAP requirement id absent from `<phase_requirements>`; blocked needs `<research_blockers>`. Valid + `input_digest` != current `revisions hash research` -> `stale` (exit 1); a later attempt on the same inputs that blocked/did not accept -> `blocked`/`incomplete` (exit 1) so an older complete report is not exposed. Else exit 0 with status.
- Proposal: KEEP (core), required-section list from the upstream researcher output contract.
- Source: wildera:tools/gsd/gsd.mjs:706-738; wildera:.agents/skills/gsd-research/references/adapter.md:9-20
- Why it exists: a null agent result plus an old file, a truncated write, or a blocked report must never count as researched (gsd-research/SKILL.md:61).
- Test idea: truncate the report before the marker -> status invalid; change CONTEXT -> status stale.

### GSP-34 `research.prompt`
- Behavior: renders upstream `capabilities/research/fragments/plan-pre.md` with phase values (phase number/name/description, req ids, phase dir, context/requirements/state paths; lines whose optional path is absent are dropped; `${AGENT_SKILLS_RESEARCHER}` blank); returns {prompt, inputDigest (= revisions hash research), path}.
- Proposal: KEEP.
- Source: wildera:tools/gsd/gsd.mjs:739-749
- Why it exists: dispatch text stays upstream's; only values are filled.
- Test idea: no CONTEXT -> prompt has no `context_path` line.

### GSP-35 Verification fingerprint and `verification.status`
- Behavior (r1: `verification.status` returns exit 0 with `status: stale` when the recomputed digest differs OR the recompute itself fails, e.g. a covered file is now missing (gsd.mjs:778-781); only invalid reports exit 1 with `VERIFICATION.md invalid: ...` on stderr (gsd.mjs:774-776); exit 69 `unresolvable` belongs to the `verification.fingerprint` verb (gsd.mjs:755); so gsd-verify returns `stale`, not `failed`, to its caller): `verification.fingerprint <phaseDir> <files...>` -> covered_files (given files + all plans + all summaries, minus VERIFICATION, sorted) and `covered_digest = gsdport1:sha256:<sha of path\0sha(content)>`; exit 69 `unresolvable` if any covered file is missing. `verification.status` finds `<NN>-VERIFICATION.md` (66 if none) and exit 1 `invalid` unless: front matter parses, `status` in passed|gaps_found|human_needed, passed implies no gaps/human_verification/`behavior_unverified`, gaps_found has gaps, human_needed has human items or behavior_unverified, `covered_files` + `covered_digest` present. If valid, recomputes the fingerprint (non-plan/summary files) and reports `stale` when it differs. Output {status (stale overrides), written_status, score, gaps, human_verification, behavior_unverified, path, sha, stale}.
- Proposal: KEEP; digest prefix is the kit's own (do not reuse upstream `v3:`).
- Source: wildera:tools/gsd/gsd.mjs:751-782; wildera:.agents/skills/gsd-plan/upstream/gsd-core/templates/verification-report.md:10-30
- Why it exists: upstream #4155 (fingerprint) and #5118 (status must agree with the lists) (gsd.mjs:766).
- Test idea: passed report with a non-empty gaps list -> invalid; edit a covered source file -> `stale`.

### GSP-36 `verify artifacts` / `verify key-links` (upstream ports)
- Behavior: artifacts: from `must_haves.artifacts[{path, provides, min_lines, contains, exports}]`; none -> 66; each: path inside root (else rejected), exists, not a directory, min_lines, `contains` substring, `exports` substrings; `all_passed` needs >=1 checked. key-links: from `must_haves.key_links[{from, to, via, pattern}]`; none -> 66; source missing but promised in files_modified of a same-or-later-wave plan -> `pending`; `pattern` regex (<=500 chars, no lookaround/backrefs; unsafe -> `pattern_neutralized`, not verified) tested on source then target; without pattern, source must contain `to`; `all_verified` = results>0 and no hard failures.
- Proposal: KEEP.
- Source: wildera:tools/gsd/gsd.mjs:784-851
- Why it exists: DESIGN.md:147-151 (port of cmdVerifyArtifacts/cmdVerifyKeyLinks); path escape and ReDoS guards are additions (gsd.mjs:785-791).
- Test idea: `from: ../outside` -> `Path rejected`; pattern with lookahead -> neutralized.

### GSP-37 `init.*`, `state.load`, `history-digest`, list/find verbs
- Behavior: `init.plan-phase|phase-op|execute-phase <phase>` -> one JSON of paths/flags: phase_found (ROADMAP entry exists), padded phase, name, slug, dir, `has_discuss_checkpoint` (`<NN>-DISCUSS-CHECKPOINT.json` exists), phase_req_ids, phase_goal, context/research/wiring/verification paths, plan list/count, roadmap/state/requirements paths and has_* flags, `commit_docs:false`, `research_enabled:true`, `plan_checker_enabled:true`. `state.load` {exists, path, content}. `history-digest` per phase summary front-matter (subsystem, provides, affects, tech-stack, patterns-established, key-decisions, key-files). `frontmatter.validate --schema plan|plan-gap-closure|summary|verification` (plan schemas also require `owns` and type execute; gap needs `gap_closure: true`), `frontmatter.get <file> [key]`, `plan.task-structure`, `phase.list-plans`, `phase.list-artifacts [--type]` (66 if none), `find-phase`, `summary-extract <globs> --fields`, `init.debug`.
- Proposal: KEEP; drop `init.debug` here (gsd-debug area); config flags (commit_docs, research_enabled, plan_checker_enabled) become kit config, not hard-coded.
- Source: wildera:tools/gsd/gsd.mjs:854-934,872-873
- Why it exists: agents' vendored text calls these verbs; models/modes come from the prompt, not a GSD config (gsd.mjs:869).
- Test idea: init output for a missing phase dir -> exit 69 `phase not found`; discuss checkpoint file present -> flag true.

### GSP-38 gsd-plan.js argument validation and limits
- Behavior: `args.phaseDir` required (`.planning/phases/<NN>-<slug>`); `mode` plan (default) | gaps; `tracer` default true; `maxSkeletonPasses` and `maxCheckIterations` default 3, integers 1..3 only (a larger value is a hard failure, "owner: at most 3"); `skeletonLanes` default `[{lens:fidelity},{lens:integration}]`, each needs a non-empty `lens`, at least one lane ("the skeleton gate never passes unreviewed"); `skipResearch` boolean. Other args: `reversibilityGates` (true), `granularity` (standard), `wiring` auto|always|never, `replan`, `commitDocs` (off), `codeWave` base args merged into handoff. Return `{status: planned|needs-owner|failed|refused, reason, ...report}`.
- Proposal: KEEP; lane lenses and per-lane model/effort stay config; the 3-cap becomes a documented default with the owner able to change it in project config (owner 2026-10-18 fixed 3).
- Source: wildera:.agents/workflows/gsd-plan.js:51-64,75-77; wildera:.agents/skills/gsd-plan/SKILL.md:52
- Why it exists: owner: "Tối đa 3 vòng" (DESIGN.md:16-17).
- Test idea: `maxCheckIterations: 4` -> status failed with reason; empty `skeletonLanes: []` -> failed.

### GSP-39 Workflow `gsd()` helper and input digests in prompts
- Behavior: every deterministic step runs `node tools/gsd/gsd.mjs <cmd>` through `shell()` (timeout 600 s, tail 4 MB, stdin optional), parses the LAST stdout line as JSON, returns {code, json, stderr tail 2000}. Prompts to agents end with `Input digest (<key>): <revisions hash>`; a resumed run reuses an agent answer only for an identical prompt, so a changed input never reuses a stale answer.
- Proposal: KEEP both; replace the shell round trip with a library call if the kit core is in-process.
- Source: wildera:.agents/workflows/gsd-plan.js:65-74; wildera:.agents/workflows/gsd-research.js:28-33
- Why it exists: workflow scripts have no fs/require (DESIGN.md:178); resume cache is keyed by prompt text (gsd-plan.js:72-73).
- Test idea: change CONTEXT between two runs of the same args -> planner prompt differs, cached answer not reused.

### GSP-40 Admission lease check
- Behavior: at start `gsd debug lock check` (exit != 0) -> `status: refused` with the holder's slug/code root; same check in code-wave before any wave.
- Proposal: OPEN: depends on whether gsd-debug is carried (separate area). If gsd-debug is dropped, delete.
- Source: wildera:.agents/workflows/gsd-plan.js:78-80; wildera:.agents/workflows/code-wave.js:105-111
- Why it exists: a debug session owns the code root while it runs (compatibility.md:92).
- Test idea: with a held lease, `gsd-plan` returns refused and spawns no agent.

### GSP-41 Preconditions: Discuss checkpoint and Research gate
- Behavior: `init.plan-phase` must return `phase_dir`; an unfinished Discuss (`has_discuss_checkpoint`) -> `needs-owner` stage Discuss. In plan mode: `research.status` must be `complete`; otherwise `needs-owner` stage Research unless `skipResearch:true` AND a non-empty `researchSkipReason` (then the report path is nulled and logged). In gaps mode research is used only if currently complete. Missing ROADMAP requirement IDs only log a warning (the coverage gate later stops).
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:81-103; wildera:.agents/skills/gsd-plan/SKILL.md:25
- Why it exists: an explicit skip excludes an unusable report, it never pretends it is current (SKILL.md:25).
- Test idea: stale RESEARCH.md, no skip -> needs-owner; with skip but empty reason -> needs-owner.

### GSP-42 Research input policy block
- Behavior: every planner/checker/architect/reviewer prompt gets `<research_input_policy>`: either `Approved research: <path>. Read and use only this report.` or `Approved research: NONE. Do not read or use any RESEARCH.md on disk ...`; it overrides upstream filesystem discovery. A role never infers approval from file existence.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:100,108,411,439; wildera:.agents/skills/gsd-plan/references/adapter.md:15
- Why it exists: otherwise a skipped/blocked report on disk leaks back in through upstream discovery.
- Test idea: skip research with an old report on disk; planner prompt contains NONE and the policy text.

### GSP-43 Planner invocation: sessions, models, effort
- Behavior: planner agent type `gsd-planner`, schema PLANNER {marker enum, files, summary, changes[{issue, change}], conflict{...}, question}. Session `planner:outline` for outline + its revisions + phase-level plan revisions; `planner:<planId>` per plan; `planner:gaps` for gap plans, so revisions continue the same agent context. Model = `outlineModel` (outline session only) ?? `plannerModel` ?? tier `pro`; effort `outlineEffort` ?? `plannerEffort` ?? `high`. Checker `checkerModel`/`checkerEffort` (pro/high), architect `architectModel/Effort` (pro/high, session `architect`), reviewers `reviewerModel` (default `circle/gpt-6.1-sol-fast[1m]`)/`reviewerEffort` (medium) per lane override, verifier `verifierModel/Effort`, researcher `researcherModel/Effort`.
- Proposal: CHANGE: model-per-role table lives in project config (role -> model, effort) with kit defaults; workflow args override per run. Provider names (`circle/...`) are the Claude Code provider route, keep as opaque strings.
- Source: wildera:.agents/workflows/gsd-plan.js:105-110,411-412,439-440,258-259; wildera:.agents/workflows/gsd-verify.js:82; wildera:.agents/workflows/gsd-research.js:47,84; wildera:.agents/skills/gsd-plan/SKILL.md:52
- Why it exists: owner picks models by role and quota (STATE.md:32-36,140,151); outline matters most (STATE.md:36).
- Test idea: args with `outlineModel` differing from `plannerModel` -> outline agent call carries the former, plan agents the latter.

### GSP-44 `<planning_context>` prompt (upstream step 8)
- Behavior: `<planning_context>` with Phase, Mode (standard|gap_closure), `<required_reading>` (STATE if present, ROADMAP, REQUIREMENTS, CONTEXT path as USER DECISIONS, RESEARCH if approved, extras), research input line, phase requirement IDs ("every ID MUST appear in a plan's requirements"), project instructions and skills (AGENTS.md, CODING, LAYOUT, ue-code and code-wave skills), TRACER_MODE, REVERSIBILITY_GATES, MVP_MODE false, WALKING_SKELETON false, Granularity. Standing contracts come from the planner's `include`.
- Proposal: CHANGE: project-instruction/skills lines come from the adapter; MVP_MODE/WALKING_SKELETON stay off.
- Source: wildera:.agents/workflows/gsd-plan.js:114-138
- Why it exists: reproduces upstream plan-phase step 8 context (gsd-plan.js:118).
- Test idea: snapshot of the prompt for a fixture phase.

### GSP-45 `<revision_context>` prompt (upstream step 12)
- Behavior: revision prompt = Phase, Mode revision, required_reading (existing plan(s) + extras + CONTEXT), `Checker issues: <JSON>`, `<instructions>` (apply step-12 revision instructions and planner-revision.md; scope sentence; "Do NOT replan from scratch unless fundamental"; return REVISION COMPLETE with one `changes` entry per issue, or REVISION_CONFLICT).
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:139-155
- Why it exists: upstream revision contract.
- Test idea: revision output with fewer `changes` than issues is reported.

### GSP-46 Owner-needing markers stop the run
- Behavior: planner markers list OUTLINE/PLAN/PLANNING/REVISION COMPLETE, REVISION_CONFLICT, PHASE SPLIT RECOMMENDED, SOURCE AUDIT, CHECKPOINT REACHED, PLANNING INCONCLUSIVE; the last five are OWNER_MARKERS -> `ownerStop` = `needs-owner` with stage, `question` (or summary), `conflict`. The agent never asks anything; `confirm_breakdown` auto-approves. adapter.md maps each upstream interactive return to a marker.
- Proposal: KEEP; this is the unattended-agent contract.
- Source: wildera:.agents/workflows/gsd-plan.js:14-17,111-112; wildera:.agents/skills/gsd-plan/references/adapter.md:5-9
- Why it exists: workflow agents cannot ask (adapter.md:7); upstream interactive points become owner stops.
- Test idea: planner returns REVISION_CONFLICT in Check -> result.status needs-owner with the conflict object, no further revisions.

### GSP-47 Outline stage (resume, regenerate, mechanical fix loop)
- Behavior: the outline-only planner (`gsd-planner`, session `planner:outline`) writes `<NN>-PLAN-OUTLINE.md` (table `Plan ID | Objective | Wave | Depends On | Requirements`, final line `## OUTLINE COMPLETE` written to disk, not only returned) and the manifest (one entry per row: owns, requirements, produces, consumes, tracer, verify). Plan ids `<NN>-01...`; instructions: read spec rules behind requirement IDs and LAYOUT first; one plan per capability folder set; owns disjoint within a wave; shared files never owned; tracer plan = first wave-1 row, consuming nothing. The outline is reused when it ends with the marker AND `revisions check inputs` is unchanged AND no `replan`; otherwise regenerated (if the regeneration returns nothing while an outline existed -> failed: an old marker cannot acknowledge new inputs; if no prior outline, the files on disk are used). Then `outline check`; on failure up to 2 fix turns (same session, mechanical issues as blockers); still failing -> failed. Passing: warnings logged, `revisions record inputs`.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:364-405; wildera:.agents/skills/gsd-plan/SKILL.md:45
- Why it exists: a null regeneration must not certify an old outline for new inputs (compatibility.md:62); fail before any reviewer is spent (SKILL.md:85).
- Test idea: planner returns null on regenerate with changed CONTEXT -> failed, not reuse; two failing fix turns -> failed with the outline errors.

### GSP-48 Wiring contract stage
- Behavior: `wiring-architect` (session `architect`) runs when `wiring=always`, or not `never` and (the outline check found cross-plan edges or a WIRING.md already exists). It writes only `<NN>-WIRING.md` (end-to-end call sequence; per-plan sections with exact declarations, single named caller, trusted context; dev fakes; trial values; shared changes for the orchestrator; outline changes it needs) and returns {status complete|conflict, path, sharedChanges[], outlineChanges[], conflicts[], notes}. `conflict` -> `needs-owner` (conflicts with locked decisions). Missing file -> failed. `outlineChanges` become blocker issues `W-<tag>-<n>` (dimension wiring_feasibility, target outline) for the skeleton review. Not run again once the skeleton is frozen; on resume it is re-run until freeze is recorded even if the outline inputs record exists.
- Proposal: KEEP stage and the wiring contract as a generic "cross-plan interface contract"; architect body is project adapter (UE/C++/Online specifics).
- Source: wildera:.agents/workflows/gsd-plan.js:407-435; wildera:.agents/agents/wiring-architect.md:12-35; wildera:.agents/skills/code-wave/references/architect-prompt.md:1-29
- Why it exists: coders confined to their own folders cannot agree on cross-capability calls: wave w04 left 8 of 17 tasks partial; with a plan w05 passed review first time for 12 of 14 (wiring-architect.md:14; code-wave SKILL.md:42).
- Test idea: outline with a `consumes` edge triggers the architect; one without does not; architect returns `conflict` -> needs-owner.

### GSP-49 Skeleton review gate: lanes and pass 1
- Behavior: lanes `[{lens, model?, effort?}]` get ids L1..Ln; each runs `gsd-skeleton-reviewer` fresh, read-only, in parallel; prompt names the lens, phase, goal, frozen snapshot file list (outline, manifest, wiring, CONTEXT, REQUIREMENTS, ROADMAP section), requirement IDs, TRACER_MODE, mechanical-check warnings and cross-plan edges. A lane that returns nothing is retried once, still nothing -> failed (the gate never passes unreviewed). Issues are plan-checker format {plan, dimension, severity blocker|warning|info, required_property, description, evidence, task, fix_hint, target outline|wiring|both}; ids `L<n>-<k>`; info goes to advisories; the rest are open. Wiring-architect outline requests are added as open issues owned by the integration lane (or the first lane).
- Proposal: KEEP; default lanes fidelity+integration, more lanes by config (owner ran four on Phase 1.1: fidelity, integration, runtime-feasibility, test-integrity).
- Source: wildera:.agents/workflows/gsd-plan.js:436-463; wildera:.agents/skills/gsd-plan/references/skeleton-review.md:5-20; wildera:.planning/STATE.md:162
- Why it exists: owner: "if the outline is right, the phase comes out right"; most failures are a wrong decomposition or an unowned cross-plan call (skeleton-review.md:3). Phase 01 evidence: 38 open after pass 1, 4 after pass 2, 0 after pass 3 (01-OUTLINE-REVIEW.md:5).
- Test idea: one lane returns null twice -> failed; info issues never block.

### GSP-50 Skeleton review: revision passes, resolution checks, stall, caps
- Behavior: for pass 2..maxPasses while open issues remain: partition (r1): `forOutline` = issues whose target is not `wiring` OR wiring is unused (so target `both` goes to the outline planner and, when wiring is in use, also to the architect); `forWiring` = target `wiring`/`both` when wiring is used (gsd-plan.js:465-466). Realign rule: after an outline revision the architect also runs when wiring is in use even with `forWiring` empty, unless wiring was just created this pass (`!added.length`); its prompt says to bring WIRING in line with the revised outline (gsd-plan.js:491-492). Issues targeting the outline (or wiring when wiring unused) go to the outline planner session (revision prompt, outline-only scope) then the mechanical check reruns (one more fix turn, else failed); issues targeting wiring/both go to the architect (which may answer conflict -> needs-owner, or request further outline changes as new blockers). If the revised outline gained cross-plan edges and wiring was unused, the architect writes WIRING now and a blocker `W-<pass>-review` asks the integration lane to review all of it (unless `wiring: never`). Then each lane (fresh) runs a RESOLUTION CHECK on only its own open issue ids: resolved:boolean + evidence, nothing new. Unanswered = unresolved. Stall: if open count after the pass is not lower than before it -> `needs-owner` ("stalled"). After the cap: open blockers (anything not `warning`, unknown severity = blocker) -> `needs-owner`; only warnings -> pass, carried to the plan-checker and to the matching plan's planner prompt. REVISION_CONFLICT from a planner -> needs-owner. Never "proceed anyway".
- Proposal: KEEP. Note: the stall rule ignores issues added by the architect in that pass (compared before adding).
- Source: wildera:.agents/workflows/gsd-plan.js:464-523 (esp. 465-466, 491-492); wildera:.agents/skills/gsd-plan/references/skeleton-review.md:37-47
- Why it exists: cheap fixes at the skeleton level; bounded loop (owner 3 passes, DESIGN.md:16-17).
- Test idea: scripted reviewers: pass1 3 issues, resolution resolves 1 -> pass 3 with 2 open; if still 2 -> stalled needs-owner.

### GSP-51 Skeleton lens definitions, blocking rules, issue format
- Behavior: `fidelity` (checker dimensions 1, 7, 7b, 11): every requirement/trackable decision maps to a plan that delivers it; no scope reduction; no guessed owner decision; success criteria reachable. `integration` (dimensions 3, 3b, 5, 9 + ownership): disjoint owners, no shared file, wave/dependency correctness, every cross-plan call has one producer + exact declaration + named caller, trusted context established by an owner, tracer reaches every layer, every verify has a runner, plan balance (about 6 screens / 3 subsystems max). Blocker examples: requirement/decision with no plan or only in name, scope reduction, guessed owner decision, overlapping owners/shared file owned/plan without LAYOUT owner, same-or-later-wave dependency or cycle, missing tracer, unrunnable verify. Warning: oversize, split seam, fragile order, weak verify. Not an issue: style, alternative decomposition without a defect, speculation, anything decided in CONTEXT or its Discretion. Evidence bar instead of trigger/likelihood: a blocker names requirement/decision/rule/owner/declaration.
- Proposal: CHANGE: lens text splits into generic (requirements, decisions, tracer, wiring, balance) and project (LAYOUT owners, shared files, Verify runners); reviewer agent body is generic with project includes.
- Source: wildera:.agents/skills/gsd-plan/references/skeleton-review.md:9-35; wildera:.agents/agents/gsd-skeleton-reviewer.md:13-23
- Why it exists: not stated beyond owner request (DESIGN.md:15-17).
- Test idea: reviewer given a fixture skeleton with an uncovered requirement returns a blocker naming the id.

### GSP-52 `OUTLINE-REVIEW.md` and the freeze
- Behavior: after the gate the workflow writes `<NN>-OUTLINE-REVIEW.md` (status line, lanes with models, per-pass open counts, Open / Resolved tables with evidence cut at 300 chars, Advisories, full report JSON) via `gsd write`, in every outcome (passed, needs-owner). Only `passed` records `revisions freeze` and (if `commitDocs`) commits outline, manifest, wiring and review as `docs(<N>): phase skeleton`. If `freeze` already matches (and not `replan`) the review is skipped ("skeleton unchanged since its review passed").
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:413,525-560; wildera:.planning/phases/01-m1-p0/01-OUTLINE-REVIEW.md:1-62
- Why it exists: audit record of what the reviewers found and how it resolved; resume skip when nothing changed.
- Test idea: rerun with unchanged inputs -> no reviewer agents spawned.

### GSP-53 Per-plan planning stage
- Behavior: re-parse the frozen outline; `supersede --keep <row ids>`; for each outline wave in ascending order: rows whose `revisions check plan:<id>` still matches AND whose plan passes `plan-structure` are kept (unless `replan`; log notes a code change since); the others run `gsd-planner` single-plan prompts in parallel (session `planner:<id>`): "Chunked mode: single-plan. Write exactly ONE plan file ...; Plan to write, Wave, Depends on, Phase requirement IDs to cover; Return ## PLAN COMPLETE", plus the frozen manifest entry (frontmatter owns repeats it exactly; files_modified inside; shared needs in `<shared_changes>`), quotes cross-plan declarations from WIRING (never changes one: REVISION_CONFLICT), and open skeleton warnings for that plan. A planner returning nothing -> disk check. After the join (single writer of revisions.json), in row order: `revisions record plan:<id>`, report entry, optional doc commit. Owner marker -> needs-owner; any not-ok plan -> failed with errors. A later wave starts only after the current wave is on disk.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:561-617
- Why it exists: upstream 8.5.2 chunked mode; parallel within a wave by default (upstream `chunked_parallel` default false) (compatibility.md:12).
- Test idea: kill after wave 1; rerun -> wave-1 plans kept, wave 2 planned; edit outline -> all plans rewritten.

### GSP-54 Structure check with one fixer turn
- Behavior: after a plan is written/revised: `verify.plan-structure`; on errors the same planner session gets a "VERIFY DISK" prompt with the errors, fixes in place with Edit, reruns the verb until exit 0, returns PLAN COMPLETE; the workflow rechecks once more; still invalid -> failed.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:163-170
- Why it exists: upstream plan-phase 8.5.2 step 6 (planner validate_plan).
- Test idea: malformed plan -> fixer prompt contains the exact error list.

### GSP-55 Plan-checker revision loop with deterministic probes
- Behavior: each iteration: run the three probes (`verify-command-paths`, `verify-failure-directions`, `owns`; exit 0 and 69 tolerated for the first two, 0/1 for owns, else failed); probe findings are turned into code-counted issues (severity blocker/warning from the probe, ownership problems = blocker, an exit-69 probe = warning); the `gsd-plan-checker` (fresh, read-only, effort high) receives the probes' JSON inside `<verify_command_path_probe>`, `<failing_direction_probe>`, `<ownership_probe>` with instructions not to re-derive them, requirement IDs, project instructions, wiring contract rule, and `<expected_output>` `## VERIFICATION PASSED | ## ISSUES FOUND`; one retry if it returns nothing, then failed. Counted = non-info issues + probe issues (unknown severity = blocker). 0 counted -> pass (info kept as advisories). `iteration >= maxChecks` -> `needs-owner` with options [force proceed (record the override in STATE.md), provide guidance and retry, abandon]. `counted >= previous` -> `needs-owner` stalled (options: adjust approach, abandon). Otherwise group issues by plan: per-plan issues to that plan's planner session (sessions in parallel, plans sharing a session sequentially), phase-level issues (`*`) to the outline session after the per-plan ones (never two agents on one file); REVISION_CONFLICT etc -> needs-owner; each touched plan is re-structure-checked and (plan mode) its `plan:<id>` revision re-recorded. `revisions record checked` is written once, after a passing checker loop in plan mode only (gsd-plan.js:619-627); gap mode never records `checked` and the loop does not record per iteration. If `checked` is unchanged on resume the checker is skipped.
- Proposal: KEEP; adapter supplies probe set and extra checker-prompt sections. Add an actual `forceProceed` arg (see GSP-75).
- Source: wildera:.agents/workflows/gsd-plan.js:172-301,619-628
- Why it exists: upstream steps 10-12 (DESIGN.md:159-163); deterministic blockers counted in code, "not only through the checker's reading of the probes" (gsd-plan.js:186-187).
- Test idea: checker returns 5 issues, revision leaves 5 -> stalled needs-owner; 2 info only -> passed with advisories.

### GSP-56 Handoff stage and result
- Behavior: `check coverage` fails -> `needs-owner` stage Handoff with options [re-plan to include missing requirements/decisions (recommended), move them to a later phase, tag a decision [informational]]; else `handoff` (stdin = `args.codeWave`, `waveIdPrefix` extended with the gap prefix), failure -> failed; `revisions record handoff`; accumulates `sharedChanges`; returns `planned` with coverage, waves[], planRevision. The plan-mode shared changes come from the wiring architect (source `wiring`) and plans' `<shared_changes>`.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-plan.js:303-316
- Why it exists: plan-phase gates 13/13a; the orchestrator must apply shared changes before the first wave (SKILL.md:63).
- Test idea: uncovered decision -> needs-owner with the three options; passing set -> w1..wN args files exist.

### GSP-57 Gap-closure mode (`mode: gaps`)
- Behavior: requires `verification.status` `gaps_found` (or, when resuming the recorded gap attempt for the same report sha, the written status gaps_found); records a gap attempt {source path+sha, plans before, plans} BEFORE the planner runs; resume continues with plans the attempt recorded or the new plan files a crashed planner left. Planner `planner:gaps` (planning_context mode gap_closure, VERIFICATION path + wiring as reading) writes one plan per gap group, numbered after existing plans, frontmatter `gap_closure: true` (schema plan-gap-closure) and `owns` taken from the original plans that own the gaps' files; returns PLANNING COMPLETE. Each new plan passes structure check; checker loop runs with mode gap_closure and ownership probe scoped to new plans (revisions go to `planner:gaps`); optional doc commit; handoff for only the new plans with prefix `gap` -> `handoff/gap-w<k>.args.json`. Scope (r1, corrected): only the ownership probe (`check owns --plans`), the handoff file set and the doc commit are limited to the new gap plans; `check coverage` (requirements + decisions) and the two verify probes (`verify-command-paths`, `verify-failure-directions`) still see every plan of the phase, so a pre-existing unresolved `scenario:` can stop gap closure (gsd-plan.js:179-181,305,356-360; gsd.mjs:974-979). No cap of one gap wave inside the workflow.
- Proposal: KEEP; CONFLICT: DESIGN/SKILL say "at most one gap-fix wave" but enforcement is only in SKILL.md prose (SKILL.md:72), not in `gsd-plan.js`; enforce in core (attempt counter).
- Source: wildera:.agents/workflows/gsd-plan.js:318-361; wildera:.agents/skills/gsd-plan/SKILL.md:72; wildera:.agents/skills/gsd-plan/references/compatibility.md:35
- Why it exists: upstream `plan-phase --gaps`; unbounded loops do not converge (breadth frozen).
- Test idea: crash planner after writing 1 of 2 gap plans; rerun resumes that attempt and reuses the plan on disk.

### GSP-58 Optional doc commits
- Behavior: with `args.commitDocs` each plan (`docs(<N>): plan <id> (chunked)`), the skeleton set (`docs(<N>): phase skeleton`) and gap plans are `git add` + `git commit -m ... -- paths` by the workflow; failure is logged, not fatal. Default off: orchestrator commits. Agents never commit.
- Proposal: CHANGE: commit policy is a kit/project setting; command interpolation (`"${message}"`) should avoid shell quoting.
- Source: wildera:.agents/workflows/gsd-plan.js:157-162,559,611,359; wildera:.agents/skills/gsd-plan/references/adapter.md:31-33
- Why it exists: no commit unless the owner asks; resume relies on files + revisions.json (compatibility.md:43).
- Test idea: commitDocs true commits exactly the named paths; false commits nothing.

### GSP-59 Planner / checker / verifier content contracts (upstream, unchanged)
- Behavior: planner: plan frontmatter, tasks (`type auto|tracer|manual|checkpoint:*`, `<name> <files> <read_first> <action> <verify><automated>+<fails_when> <acceptance_criteria> <done>`), must_haves (truths/artifacts/key_links), `<interfaces>`, `<threat_model>`, objective/context/output; tracer-first; reversibility gates; goal-backward must_haves; source audit. Checker: dimensions (requirement coverage, task completeness, dependency correctness, key links, scope sanity, must_haves derivation, context compliance 7/7b, Nyquist/verify paths 8, cross-plan data contracts 9, claude.md compliance, ...) and issue format {plan, dimension, severity, required_property, description, task, fix_hint}. Verifier: truths/artifacts/key-links/requirements, statuses passed|gaps_found|human_needed, `PRESENT_BEHAVIOR_UNVERIFIED`, re-verification mode. Bodies are byte-identical to upstream after path rewrite.
- Proposal: KEEP verbatim (generated); do not reimplement.
- Source: wildera:.agents/agents/gsd-planner.md:13-1014; wildera:.agents/agents/gsd-plan-checker.md:13-1086; wildera:.agents/agents/gsd-verifier.md:13-972 (equality checked by script, not read line by line)
- Why it exists: "keep GSD's ideas intact; change only the adapter" (DESIGN.md:10).
- Test idea: the generated agent equals rewrite(upstream) in CI.

### GSP-60 Example plan (01-01) and plan size policy
- Behavior (r1): size policy source split: CONTEXT D-14 = at most 2-3 tasks, short targeted `read_first`, few files modified, disjoint owns, about 100k-token coder; it does NOT state a 5-file cap (01-CONTEXT.md:56-57). The ">5 file modifications" / ">5 files total, CONSIDER splitting" figures are upstream planner heuristics in `upstream/gsd-core/references/context-budget.md:119,123`, not a `gsd.mjs` lint; the real checker complaints seen were a 13-file warning and a 14-file blocker (STATE.md:44). D-14 is superseded as the last word by the plan-count cap of GSP-84. A real plan: frontmatter (phase, plan, type execute, wave, depends_on, `owns`, files_modified, autonomous, requirements, specs, must_haves{truths, artifacts[path, provides, contains], key_links[from,to,via,pattern], prohibitions[statement,status,verification]}), `<objective>`, `<execution_context>` (@ue-code skill, @executor-rules), `<context>` (@STATE, ROADMAP, REQUIREMENTS, CONTEXT, WIRING + approved research sections), `<interfaces>` (frozen wiring declarations), 2 tasks (tracer, auto tdd="true") with read_first lists of exact functions, `<automated>` + `<fails_when>`, `<shared_changes>` (4 numbered orchestrator items), artifact list, multi-source coverage audit table, `<threat_model>` table, validation notes, `<verification>`, `<success_criteria>`, `<output>` naming the SUMMARY. Project policy D-14: every plan executable by a small-context coder (about 100k tokens): at most 2-3 tasks, short targeted read_first, few files, disjoint owns, cross-plan calls fixed in WIRING.
- Proposal: KEEP format; plan-size limits become project config (context budget per coder model).
- Source: wildera:.planning/phases/01-m1-p0/01-01-PLAN.md:1-235; wildera:.planning/phases/01-m1-p0/01-CONTEXT.md:56-57
- Why it exists: owner wanted GSD plans that let many cheap small-context agents code in parallel (CONTEXT D-14).
- Test idea: lint: plan with 4 tasks -> warning from the size policy (a per-task file limit only if the kit adopts the upstream context-budget figure and cites it).

### GSP-61 `gsd-research` workflow
- Behavior: args `phaseDir` (regex `.planning/phases/<NN>[.<M>]-<slug>`, because the path goes through cmd.exe), booleans `refresh`/`view`, string `focus`, `invocationId` (UUID, required unless `view`), `researcherModel/Effort`. `view`: returns `{status:'view', path, reportStatus, problems}` without an agent (failed if no report). Discuss checkpoint present -> needs-owner. Renders the upstream prompt (GSP-34); `signature = hash(inputDigest + controls{focus, model, effort})`; reads the research attempt. A previously blocked attempt with the same signature and no `refresh` -> needs-owner. Existing report and not resumed and not `refresh`: complete+valid -> `reused` (with `headChanged`), otherwise needs-owner (blocked/stale/invalid). New attempt: `sequence+1`, `key = hash(invocationId, signature, sequence, prevSha)`, record BEFORE dispatch. One `gsd-phase-researcher` writes only the report path with `inputDigest`+`attemptKey` in a `<runtime_adapter>` block (never build/test/install/commit/message). Readback: `RESEARCH BLOCKED` -> record blocked, needs-owner; report whose `attempt_key`/`input_digest` do not match -> failed ("do not reuse an old or partial file"); non-complete -> blocked; null agent result but valid current report -> accepted with a log. Success records the attempt done + reportSha, `revisions record research`, returns `researched`.
- Proposal: KEEP behavior, CHANGE: the invocation-UUID + signature + sequence + key machinery is heavy; keep the guarantee (a new run cannot inherit an interrupted attempt; readback checks current-attempt metadata and the terminal marker) with one attempt record.
- Source: wildera:.agents/workflows/gsd-research.js:1-105; wildera:.agents/skills/gsd-research/SKILL.md:29-55
- Why it exists: "Signatures alone cannot distinguish a refresh from a retry" (gsd-research.js:23); a stale/truncated/blocked report must never count as researched.
- Test idea: run twice with refresh and identical inputs -> different attempt keys; kill after the agent wrote -> resume accepts the report.

### GSP-62 `gsd-research` skill routing
- Behavior: modes from upstream plan-phase section 5 / research-only steps: `--view` (no agent), refresh/`--research`/supplement (fresh researcher even with a report; inspect old, preserve still-valid findings; focus text), default (reuse valid current research and stop; missing -> research now; invalid/blocked/stale -> report and offer refresh). Standalone research never continues to outline/plan. One active writer per phase. New UUID per invocation via `node -e randomUUID`; keep only on `--resume`. The main session summarizes findings, surfaces open questions and `[ASSUMED]` items; never turns ASSUMED into a locked decision; STATE gets `researched` only when planning-ready.
- Proposal: KEEP.
- Source: wildera:.agents/skills/gsd-research/SKILL.md:12-55
- Why it exists: GSD has research only inside plan-phase; exposed as its own skill by the owner.
- Test idea: `--view` with no file -> error, no agent.

### GSP-63 Researcher adapter: output contract and provenance
- Behavior: researcher writes only the RESEARCH.md path; YAML frontmatter `status: complete|blocked`, `input_digest`, `attempt_key`; complete reports end with `<!-- gsd:research-complete <attemptKey> -->` as final non-whitespace line (removed first on an incremental rewrite; blocked reports have none); `<user_constraints>` first when CONTEXT exists; `<phase_requirements>` covers every requirement id; blocked needs `<research_blockers>`; returns JSON {marker RESEARCH COMPLETE|BLOCKED, summary, confidence, keyFindings, openQuestions}. Uses available doc tools (Context7 if present), WebSearch/WebFetch; keeps HIGH/MEDIUM/LOW and `[VERIFIED|CITED|ASSUMED]`; provider router/cache/classifier/package-audit verbs are not installed: classify by upstream provenance definitions, never fabricate an `OK` for the package gate; no private code to external services; Validation Architecture maps to the verify vocabulary.
- Proposal: KEEP contract; doc-tool names and engine-specific text (UE-native comparison) are project adapter.
- Source: wildera:.agents/skills/gsd-research/references/adapter.md:5-37
- Why it exists: completion must be verifiable from the file (GSP-33).
- Test idea: report missing the marker -> `research.status` invalid.

### GSP-64 `gsd-verify` workflow
- Behavior: args `phaseDir`, `baseline` (commit before execution; required), `evidence[]` (per-wave verify summaries), `evidenceFiles[]` (code-wave result.json paths), `verifierModel/Effort`. Computes an attempt key = hash(checked-revision hash, baseline, evidence, evidenceFiles); records {key, previous report sha/status/path} before the verifier (resume only if same key and not done). Re-verification mode when the previous status is gaps_found|stale|human_needed. One fresh `gsd-verifier` gets `<verification_context>` (phase, goal, mode, required_reading: plans, summaries ("claims to check, not proof"), ROADMAP, REQUIREMENTS, CONTEXT, WIRING, previous VERIFICATION, evidence files), requirement IDs, baseline, `<verify_stage_evidence>` ("do not rerun anything"), instructions to write `<NN>-VERIFICATION.md` with the fingerprint, self-check with `verification.status --pick status`, not commit. After it: `verification.status` must be exit 0 (else failed); a report whose sha equals the previous one -> failed (an earlier verification); a null agent result is accepted if the new file passes; **the file's status wins** over the returned one; `stale` is logged. Returns {status passed|gaps_found|human_needed|stale, path, score, gaps, humanVerification, reverification}.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-verify.js:1-94; wildera:.agents/skills/gsd-plan/references/adapter.md:71-76
- Why it exists: upstream self-check #5118; a verifier must not be credited with an old report; the machine runs one build at a time so the verifier reads Verify evidence instead of running tests (adapter.md:73).
- Test idea: verifier returns passed but file says gaps_found -> result gaps_found with a log line; no new file -> failed.

### GSP-65 VERIFICATION.md format and gap objects
- Behavior: frontmatter `phase, verified, status, score "N/M must-haves verified", covered_files[], covered_digest, behavior_unverified, behavior_unverified_items[], coincidental_reliance_items[], gaps[{truth, status, reason, artifacts[{path, issue}], missing[]}], human_verification[{test, steps, expected}]`; body: Observable Truths table (`✓ VERIFIED | ✗ FAILED | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | ? UNCERTAIN`), Required Artifacts, Key Link Verification, Requirements Coverage, Anti-Patterns, Human Verification Required, Gaps Summary (critical / non-critical), Recommended Fix Plans (<=3 tasks each), Metadata. Overall status precedence: gaps_found > human_needed > passed; PRESENT_BEHAVIOR_UNVERIFIED alone routes to human_needed. No VERIFICATION.md exists for WildEra Phase 01 yet (not yet verified), so the sample is the upstream template.
- Proposal: KEEP the upstream template; the Concerns note it is large.
- Source: wildera:.agents/skills/gsd-plan/upstream/gsd-core/templates/verification-report.md:9-30,181-193; wildera:tools/gsd/gsd.mjs:758-782
- Why it exists: upstream.
- Test idea: template-conformant sample passes `verification.status`.

### GSP-66 code-wave GSD extension (handoff consumer)
- Behavior: task `brief` = `TASK <key> (wave, waveId, GSD phase <dir>)`, owns, specs, `plan: <file> (revision <planHash>)`, `summary`, `requirements`, brief; coder prompt adds `Follow the ue-code skill and its "GSD plan tasks" section`; coder result schema RESULT_GSD adds `taskResults[{task, status implemented|partial|blocked|skipped, evidence}]` and `deviations[{rule, description, files}]` (non-GSD tasks keep RESULT so cached calls still match); coder session `coder:<key>` persists across fix rounds; each Verify round also checks every plan obligation (`test:` filter must match an executed test name, `cmd:` is run with a 900 s limit; unmet = that task's failure `verify obligation not met (plan task ..)`); a finding with no verifier verdict after one retry is `unverified` (blocking, escalated to orchestrator, never sent to the fixer). Result includes per-task `obligations`. r1: all obligation checks run only when the integrated build is ok (code-wave.js:200) and are skipped entirely under `verify:false` (GSP-85).
- Proposal: CHANGE: belongs to the execution area (workflow/files); GSD-specific fields (`plan`, `summary`, `requirements`, `verify[]`, `taskResults`, `deviations`, `obligations`) stay as the executor-neutral wave-args/result contract.
- Source: wildera:.agents/workflows/code-wave.js:31-37,68-71,82-86,196-214,296-299,345; wildera:.agents/skills/code-wave/SKILL.md:72-80
- Why it exists: DESIGN.md:113-118 (departures: executor-run verify -> Verify stage with attributable result; missing verdict labelled unverified, still blocking).
- Test idea: handoff task with a `test:` filter matching nothing -> task failure routed to its coder, result lists obligation `failed`.

### GSP-67 code-wave review gate and fix flow (summary for cross-area)
- Behavior: order Code -> Verify until green (<= `maxVerifyRounds` 4, stall after 2 non-dropping rounds) -> one review per dirty task -> Confirm (separate `finding-verifier`) -> one Fix pass -> Verify -> resolution check. A high finding gates only with concrete trigger, confidence >= 80 (`minConfidence`), likelihood != theoretical; others deferred, minor dropped. Run-level failure signatures send integration failures to gsd-debug at once, localized ones after one coder round. Root-cause rule text (never weaken assertion/tolerance/wait). Lease admission. Owner: gate 2026-10-17.
- Proposal: OPEN: owned by the workflow/gsd-debug areas; this map only records the GSD seams (GSP-66, GSP-28).
- Source: wildera:.agents/workflows/code-wave.js:72-80,264-335; wildera:.agents/skills/code-wave/SKILL.md:53
- Why it exists: review-fix-re-review loops kept producing new findings and reviewers are wrong too (code-wave.js:72-76).
- Test idea: n/a here (workflow area).

### GSP-68 `review-gate.js` for non-UE packets
- Behavior: standalone bounded review (modes review/resolve) of packets, finding-verifier confirm. r1: the gate matches code-wave on confidence/likelihood/trigger but NOT on a missing verdict: review-gate defaults `vd?.verdict ?? 'confirmed'` with no retry (review-gate.js:54), code-wave retries once and then marks `unverified` and escalates (code-wave.js:291-296).
- Proposal: DROP from this area (Go backend packet, WildEra-specific); gate logic lives with code-wave.
- Source: wildera:.agents/workflows/review-gate.js:1-67
- Why it exists: "Same gate as code-wave.js (owner 2026-10-17)" (review-gate.js:9).
- Test idea: n/a.

### GSP-69 Agent definitions: which are generic and which are project
- Behavior: `gsd-skeleton-reviewer` (read-only; Read/Grep/Glob/Bash; includes skeleton-review.md, manifest.md, LAYOUT; principles: verify coverage not intent, read real headers before calling a call unowned, evidence-only issues, one pass, resolution-check mode, no builds), `wiring-architect` (Read/Grep/Glob/Bash/Write/Edit; writes only WIRING.md; includes CODING+LAYOUT), `finding-verifier` (confirmed/refuted/uncertain by tracing the trigger; read-only; never builds), `ue-coder` (one capability task, owns-only edits, no build/test/commit, results in `contractRequests`/`sharedRequests`/`openInputs`), `ue-reviewer` (7-point checklist, finding format trigger/likelihood/confidence/impact, High gates at confidence >= 80). Front matter keys: name, description, model (tier fallback), tools (advisory), include (inlined after body).
- Proposal: CHANGE: kit core ships generic `skeleton-reviewer`, `wiring-architect` (interface-contract architect), `finding-verifier`, and the four generated GSD agents; `ue-coder`/`ue-reviewer` and the UE specifics are the project's own agents declared in the adapter.
- Source: wildera:.agents/agents/gsd-skeleton-reviewer.md:1-23; wildera:.agents/agents/wiring-architect.md:1-35; wildera:.agents/agents/finding-verifier.md:1-19; wildera:.agents/agents/ue-coder.md:1-27; wildera:.agents/agents/ue-reviewer.md:1-31
- Why it exists: not stated beyond role separation (reviewers fresh/independent, coders persistent).
- Test idea: reviewer agent invoked with a write tool request is refused (read-only).

### GSP-70 `gsd-discuss` skill (main-session interactive)
- Behavior: runs the generated upstream discuss-phase in the main session (never delegated): resolves the phase against ROADMAP (stop if undefined; create the dir only for an existing entry), loads default+text modes and optional `--all`, `--batch[=N]`, `--analyze`; numbered plain-text questions, stop and wait for the answer (empty input is not approval); language of the conversation, artifacts in English; unported modes (`--power`, `--auto`, `--chain`, advisor, `--ws`) are refused, never simulated; resume/update asks update/view/skip or resume/start fresh; preserves D-NN ids (new ids appended); writes `<NN>-DISCUSS-CHECKPOINT.json` BEFORE the first question and after every answer; CONTEXT sections `<domain>`, `<decisions>` (D-NN, discretion), `<canonical_refs>`, `<code_context>`, `<specifics>`, `<deferred>`; on completion writes CONTEXT + DISCUSSION-LOG, removes the checkpoint, updates STATE (single writer), no git. Standalone Discuss stops; offers research then plan. DISCUSSION-LOG is audit only, not agent input. Changed CONTEXT invalidates research/plans through hashes.
- Proposal: KEEP; the interactive Q&A is a main-session skill (no workflow).
- Source: wildera:.agents/skills/gsd-discuss/SKILL.md:6-31; wildera:.agents/skills/gsd-plan/references/compatibility.md:9,39-40
- Why it exists: the earlier shortened interview was rejected; upstream method kept intact (port.mjs:190).
- Test idea: kill mid-discussion; checkpoint exists with active_area/pending question; `gsd-plan` returns needs-owner stage Discuss.

### GSP-71 `gsd-plan` skill: the one-command chain
- Behavior: Steps 0-5: (0) read STATE+ROADMAP, create them from upstream templates if missing, inspect phase dir/`revisions show`/run_meta, continue from the first undone step, tree must be clean or planning-only; (1) phase setup by the main session: ROADMAP entry (Goal as outcome, Depends on, Requirements, numbered Success Criteria), REQUIREMENTS rows from specs, Discuss (never fabricate CONTEXT; no open decision may be planned), Research decision (missing + owner has not chosen -> ask in plain text with a recommendation), STATE `planning` only after gates; (2) write `_workspace/gsd/<phase>/plan.args.json` with a file tool, run `ph workflow --name gsd-plan --args-file ... --detach`, watch, record runId in `run_meta.json`; (3) result: planned / needs-owner (plain-text stage, reason, issues, options; record the answer in CONTEXT/ROADMAP/REQUIREMENTS; start a NEW run with the same args file - hashes keep unchanged steps; `--resume <runId>` only for a run that died with no input change) / failed (read journal/log, fix cause, rerun; never hand-edit plans to pass the checker); (4) execute: apply shared changes, clean baseline commit, run each `handoff/w<k>.args.json` through code-wave in order, tracer wave green before the next; keep evidence; a plan without SUMMARY or with an unmet obligation is not done; (5) verify (`gsd-verify`), passed -> mark phase complete in ROADMAP/STATE and requirements done; gaps_found -> `mode: gaps` + one gap-fix wave + re-verify, leftovers to the owner; human_needed -> exact checks to the owner, never marked done; history row. `--plan-only` stops after Step 3; the chain stops at the first needs-owner/failed. Quota/auth/permission errors are not retried.
- Proposal: KEEP the lifecycle; CHANGE: Step 4 execution depends on the project's executor (see Open question 3).
- Source: wildera:.agents/skills/gsd-plan/SKILL.md:8-80; wildera:_workspace/gsd-port/DESIGN.md:8-11,109-112
- Why it exists: owner decision 2026-10-18: one command chains plan -> execute, continuing only when planning passed (DESIGN.md:8-10).
- Test idea: needs-owner result -> chain stops and prints stage/reason/options; rerun with same args after a CONTEXT edit redoes only invalidated stages.

### GSP-72 STATE.md / ROADMAP.md / REQUIREMENTS.md: single writer
- Behavior: the main session (orchestrator) is the only writer; agents and the planner's `update_roadmap` step are skipped; all `state.*` mutation verbs answer "not ported". STATE.md: YAML frontmatter `gsd_state_version, status, progress{total_phases, completed_phases, total_plans, completed_plans, percent}`; sections Project Reference, Current Position (Phase/Plan/Status/Last activity), Decisions (owner), Models, Owner rules captured during execution, Overrides, Wave log, Session Continuity (append-only dated notes). ROADMAP: Overview, Phases checklist, Phase Details, Progress table. REQUIREMENTS: header text + table.
- Proposal: KEEP single-writer rule; CHANGE: give the orchestrator a small CLI/library to update STATE (position, wave log, decision, override) instead of free-form prose.
- Source: wildera:.agents/skills/gsd-plan/references/adapter.md:33; wildera:tools/gsd/gsd.mjs:70-74; wildera:.planning/STATE.md:1-164; wildera:.planning/ROADMAP.md:14-73
- Why it exists: upstream single-writer invariant, made strict for parallel agents (compatibility.md:41).
- Test idea: a planner prompt never contains a STATE write instruction; `gsd state record-wave` appends a Wave log line.

### GSP-73 `.planning/` file set per phase
- Behavior: `.planning/{ROADMAP,STATE,REQUIREMENTS}.md`, optional `PROJECT.md`; `phases/<NN>-<slug>/`: `<NN>-CONTEXT.md` (owner decisions, `<decisions>` with D-NN), `-RESEARCH.md`, `-DISCUSSION-LOG.md` (audit only), `-DISCUSS-CHECKPOINT.json` (unfinished discussion), `-PLAN-OUTLINE.md` + `.manifest.json`, `-WIRING.md` (frozen contract), `-OUTLINE-REVIEW.md`, `<NN>-<MM>-PLAN.md`, `-SUMMARY.md`, `-VERIFICATION.md`, `revisions.json`, `research-attempt.json`/`gap-attempt.json`/`verify-attempt.json`, `handoff/`, `superseded/`. Not used: `.planning/codebase/`, `config.json`, RETROSPECTIVE, LEARNINGS, knowledge graph, intel. Phase 01 holds 84 entries (37 PLAN + 37 SUMMARY + the above).
- Proposal: KEEP; the run records (`revisions.json`, `*-attempt.json`, `handoff/`) are machine state: consider `.planning/phases/<p>/.run/` and gitignore of regenerable handoff.
- Source: wildera:.agents/skills/gsd-plan/references/adapter.md:17-20; wildera:.planning/phases/01-m1-p0 (listing)
- Why it exists: upstream layout plus harness records.
- Test idea: layout lint on a completed phase directory.

### GSP-74 Outline manifest JSON
- Behavior: `{phase, plans:[{id, owns[], requirements[], produces[{symbol, kind, header}], consumes[{plan, symbol}], tracer{is, outcome, scenario}, verify[]}]}`; one entry per outline row; plus optional top-level fields the Phase 01 manifest used: `input_digest`, `research_input`, `revision_freeze`, `previous_revision_freeze`, `wiring_*_freeze`, `symbol_status`, `integration_cohorts[{wave, plans, order}]`, `shared_changes[{owner, before_wave, file, declarations, writer, consumer, reason}]`, `shared_owner`, per-plan `task_partition`, `product_host`, `z_scope`. A producer is in an earlier wave, or in the same wave only when the wiring contract fixes the declaration (same-wave edges make the workflow run the architect; table Depends On denotes earlier waves only).
- Proposal: KEEP the five core fields; the extra fields are ad-hoc planner output (CONCERN) - either specify them (integration_cohorts, shared_changes) or drop.
- Source: wildera:.agents/skills/gsd-plan/references/manifest.md:5-27; wildera:.planning/phases/01-m1-p0/01-PLAN-OUTLINE.manifest.json:1-40; wildera:.planning/phases/01-m1-p0/01-PLAN-OUTLINE.md:57
- Why it exists: ownership, cross-plan edges, tracer, verify obligations must be machine-checkable before any plan exists.
- Test idea: manifest missing a row's entry -> outline check error.

### GSP-75 Owner-decision handling and the missing force-proceed
- Behavior: every owner-needing event is a `needs-owner` result with {stage, reason, issues|conflict|question, options}. Stages: Discuss (unfinished checkpoint), Research (missing/unusable, skip needs a reason), Outline/Skeleton/Plan/Check owner markers, Skeleton (stall or open blocker after 3 passes), Wiring (conflict with locked decisions), Check (cap/stall), Handoff (coverage gap). The main session explains in plain text, the owner answers, the answer is recorded where it belongs (a new `D-NN` in CONTEXT, a scope change in ROADMAP/REQUIREMENTS, an override in STATE), then a NEW run starts with the same args. At the checker cap the options are force proceed / guidance and retry / abandon, but the workflow has no arg to proceed; in Phase 01 the orchestrator recorded an override in STATE.md and went to handoff by hand. Locked decisions are non-negotiable; recommendations are not decisions until adopted; "Claude's Discretion" lists what the owner delegated; owner delegation of a list of decisions is recorded as D-NN with the delegation noted.
- Proposal: CHANGE: add `forceProceed: {reason}` to the workflow (records override into the result and STATE, still runs coverage + handoff); keep everything else.
- Source: wildera:.agents/workflows/gsd-plan.js:269-272; wildera:.planning/STATE.md:42-44; wildera:.agents/skills/gsd-plan/SKILL.md:58; wildera:.planning/phases/01-m1-p0/01-CONTEXT.md:44-46
- Why it exists: Phase 01 stopped needs-owner at Check iteration 1 (REVISION_CONFLICT from 01-01) and proceeded by override, with remaining issues listed (STATE.md:44).
- Test idea: cap reached + `forceProceed` -> status planned with `override` field naming the remaining issues.

### GSP-76 Resume semantics
- Behavior: three layers: (a) file-based: `revisions.json` skips unchanged outline, wiring/skeleton (freeze), plans (`plan:<id>`), checker pass (`checked`); (b) `ph workflow --resume <runId>` for a run that died with no input change (answers cached by identical prompt; digests in prompts); (c) attempt records for gap/verify/research. A new run is the normal answer to an owner decision. run IDs/stage IDs are kept in `_workspace/gsd/<phase>/run_meta.json` (researchRunId, planRunId, planRuns[], per-wave runId/baseline/commit); `researchRunId` must be preserved when other stages are recorded.
- Proposal: KEEP; run_meta becomes a kit-owned record.
- Source: wildera:.agents/skills/gsd-plan/SKILL.md:17,26,58; wildera:_workspace/gsd/01-m1-p0/run_meta.json:1-40; wildera:.agents/skills/gsd-plan/references/manifest.md:33-44
- Why it exists: Phase 01 needed 3 plan runs for one phase (run_meta.json planRuns).
- Test idea: kill the workflow after skeleton review; rerun without changes -> no reviewer or planner spawned.

### GSP-77 Backlog.md references in this area
- Behavior: `todo.match-phase` verb answers not ported (Backlog is legacy); specs and Backlog tasks are read-only context when cited; discuss never creates Backlog tasks; code-wave's brief prints `backlog <task>` when not a GSD phase; code-wave SKILL step 7 writes wave summaries into STATE.md for GSD phases (legacy: `backlog` CLI); the DESIGN replaced the Backlog CRITICAL block in AGENTS.md; requirement spec paths point under `backlog/docs/spec-minimal/specs/` (specs live inside the Backlog dir tree).
- Proposal: DROP all Backlog code paths; KEEP spec paths as project data (relocate if the project drops the `backlog/` folder - OPEN).
- Source: wildera:tools/gsd/gsd.mjs:53; wildera:.agents/skills/gsd-plan/references/adapter.md:14; wildera:.agents/workflows/code-wave.js:68; wildera:.agents/skills/code-wave/SKILL.md:70; wildera:_workspace/gsd-port/DESIGN.md:19-21,119-120
- Why it exists: owner 2026-10-18 dropped the per-task ritual; new planned work keeps state in `.planning/` (DESIGN.md:19-21).
- Test idea: grep of the new kit for `backlog` in the GSD core returns nothing.

### GSP-78 Documented departures from upstream (harness rules win)
- Behavior: per-task atomic commits -> one commit per wave by the orchestrator; executor-run verify -> Verify stage with attributable result; tracer verified between plans, not tasks; no worktree per executor (shared tree + disjoint owns); TDD plans unsupported; code review capability -> bounded review gate; gap closure capped at one wave; persistent coder sessions; questions inside agents -> markers + needs-owner; research provider/cache/package audit not installed (never fabricate OK); discuss advanced modes not enabled; discuss commit step performed without git; single writer of STATE/ROADMAP/REQUIREMENTS; free-form requirement IDs -> spec rule IDs; planning docs commit optional; replan moves stale plans to `superseded/`; coder writes only its SUMMARY; high finding with no verdict -> `unverified` blocking; estimate/calibration, graph, learnings, intel, capability framework, MVP mode, UI/AI-spec gates, plan bounce, cross-AI review not ported; verifier reads evidence, no probes; Rule 4 -> partial + notes. Added: manifest + outline check, wiring contract, skeleton review, revisions invalidation + digests, attempt records, research metadata/marker, discuss checkpoint at first question, outline regeneration acknowledgement, verification-report consistency, `owns` + verify vocabulary.
- Proposal: KEEP as the kit's compatibility checklist (each row = a test or a documented exception); drop rows made moot by the owner decisions (Backlog, omp).
- Source: wildera:.agents/skills/gsd-plan/references/compatibility.md:5-64; wildera:_workspace/gsd-port/DESIGN.md:123-134
- Why it exists: owner 2026-10-18: change only the adapter; document every departure (DESIGN.md:10-12).
- Test idea: each "Kept" row has an automated check listed next to it.

### GSP-79 Models per role as configured in practice
- Behavior: kit tier names `pro` / `standard` in agent front matter are fallbacks only; the workflow args carry concrete model ids. Phase 01 args: planners + architect Sol (`circle/gpt-6.1-sol[1m]`, high), checker + skeleton lanes Sonnet 5.5, coders Haiku 5.5 (`circle/claude-haiku-5-5`, medium; engine-lifecycle plans Sol), code reviewers/verifier Sol; Phase 2 plan: research + architect Sol, outline Astra (`outlineModel`), planners Haiku, review lanes + checker Sonnet; Phase 1.1: outline Opus, planners/research Opus, reviewers/checker Grok, extra plan-review pass Grok find/judge then one Opus revise; owner: "Chat luong den tu viec them buoc review" (quality comes from adding review steps).
- Proposal: CHANGE: one `roles` table in project config (planner, outline, architect, checker, skeleton lanes, researcher, verifier, coder, reviewer, finding-verifier) with model + effort; the run records the effective table in run_meta/result.
- Source: wildera:_workspace/gsd/01-m1-p0/plan.args.json:7-32; wildera:.planning/STATE.md:32-36,136,140,151; wildera:.agents/skills/gsd-plan/SKILL.md:35-36
- Why it exists: owner picks models by quota usage (STATE.md:32).
- Test idea: change `roles.checker` in project config -> checker agent call carries the new model without editing workflow args.

### GSP-80 The "extra plan-review pass" is manual, not in the workflow
- Behavior: for Phase 01 W5/W6 and Phase 1.1 the owner added a review beyond skeleton review + checker: many cheap finders per plan x lens, 2 verifiers + 1 judge per issue, cross-plan dedupers, then ONE strong model edits all plans in one pass, then structure check and handoff regeneration (`mkwave.mjs`). Run by hand from the main session; produced 61 judged issues, 60 applied for W5/W6.
- Proposal: OPEN: codify as an optional workflow stage `plan-review` between Check and Handoff, or keep manual.
- Source: wildera:.planning/STATE.md:106,113,136; wildera:_workspace/gsd/01-m1-p0 (mkwave.mjs, overlap.mjs listed)
- Why it exists: owner: quality comes from the added review step (STATE.md:136).
- Test idea: n/a until decided.

### GSP-81 Execution stage evidence: loops that did not converge were replaced
- Behavior: Phase 01 execution through code-wave Verify rounds + gsd-debug stalled (about nine rounds on one scenario step); the owner stopped the debug flow (STATE.md:68), then ruled: no code-wave Verify loops, no gsd-debug; one strong model fixes all failures per integration point with its own build/test (STATE.md:124,129,151); the final gap fix is one strong model, not a workflow (STATE.md:131). Planning products (outline, wiring, plans, handoff) were still the input. Cost/metrics file and EFFECTIVENESS.md exist under `_workspace/gsd/01-m1-p0/` (listed, not read).
- Proposal: CONFLICT with the documented design (SKILL.md Steps 4-5 still describe code-wave + gap-fix wave). Core ships planning, handoff, verify; the execution loop design is an Open question.
- Source: wildera:.planning/STATE.md:68,124,129,131,148,151; wildera:.agents/skills/gsd-plan/SKILL.md:61-73
- Why it exists: not stated beyond owner statements.
- Test idea: n/a (design decision).

### GSP-82 `--root`, tree/reconcile/debug delegation
- Behavior: `--root <dir>` (a git checkout/worktree) re-points all phase paths, git calls and digests (waves run in worktrees: Phase 01 executed in `WildEraV6-w3`); `tree`, `reconcile`, `debug` commands delegate to debug.mjs with {ROOT, HARNESS, frontmatter, ownedPrefixes, isShared}. `HARNESS` (this checkout: upstream text, adapters, run records) differs from `ROOT` (code root).
- Proposal: KEEP `--root` and the HARNESS/ROOT split in core; the debug commands belong to the gsd-debug area.
- Source: wildera:tools/gsd/gsd.mjs:20-23,945-954; wildera:.planning/STATE.md:45
- Why it exists: the main checkout's backend refused (ACL), so execution ran in a worktree (STATE.md:45).
- Test idea: `--root` pointing at a worktree reads that tree's plans and writes handoff there.

### GSP-83 Doc vs code disagreements
- Behavior: (1) DESIGN lists 3 generated agents and "Deferred: separate researcher agent"; port.mjs generates 5 including `gsd-phase-researcher`, `gsd-debugger` and NOTICE.md says research is a skill. (2) DESIGN names `maxSkeletonCycles`; code arg is `maxSkeletonPasses`. (3) DESIGN revisions include baseline commit; code stores HEAD but does not hash it. (4) SKILL.md `commitDocs` text reads "false: commit planning docs per plan as upstream does"; code commits only when truthy. (5) adapter.md `<SPEC-ID>:<rule>` ids vs short ids in REQUIREMENTS.md. (6) DESIGN "Fix the stale 'No backend exists' line in architect-prompt.md" is done (architect-prompt.md:14 now describes the Go backend). (7) SKILL.md says gap closure capped at one wave; not enforced in code. (8) skeleton-review.md says stall "as many open issues as the pass before", code compares with the count at the start of the same pass. (9) DESIGN.md:161-162 says "REVISION_CONFLICT does not spend an iteration, the third conflict escalates"; gsd-plan.js:289-291 returns `needs-owner` on the first owner marker including REVISION_CONFLICT. Spec from the code: one conflict stops the run; do not carry a three-strike rule. (10) STATE.md:163 (D-16, granularity coarse) supersedes the D-14 "prefer more, smaller plans" guidance (GSP-84).
- Proposal: CONFLICT: rewrite the spec once from code behavior where noted; the new docs must be derived from tests, not hand-kept.
- Source: wildera:_workspace/gsd-port/DESIGN.md:14,43-46,84-88,102; wildera:tools/gsd/port.mjs:37-55; wildera:.agents/skills/gsd-plan/NOTICE.md:11; wildera:.agents/workflows/gsd-plan.js:55-57,160; wildera:.agents/skills/gsd-plan/SKILL.md:52; wildera:.agents/skills/gsd-plan/references/skeleton-review.md:44
- Why it exists: DESIGN.md is a working note "for continuing after a compaction" (DESIGN.md:3), not maintained as spec.
- Test idea: n/a.

### GSP-84 Plan-count cap and granularity (owner correction after D-14)
- Behavior: `granularity` is a planner-context value passed through `<planning_context>`; values seen: `standard` (gsd-plan.js default, :137), `fine` (Phase 01 args), `coarse` (Phase 1.1 replan). 2026-10-20 the owner called the 85-plan/8-wave Phase 1.1 outline "overthinking"; the run (wf_20261020-134305_58c0) stopped at Plan after 4 plans; CONTEXT D-16 was added (about 15-20 plans, at most 4 waves, scope unchanged); a tiny research refresh added a grouping note; replan with `granularity: coarse` and 4 skeleton lanes, the integration lens carrying D-16. The outline/wiring/review of the 85-plan attempt were backed up under `_workspace/gsd/01.1-test-harness/outline-85plans/`. Do not specify "prefer more, smaller plans" as the final rule.
- Proposal: CHANGE: plan-count and wave ceilings (and granularity) are project/phase config checked mechanically by `outline check` (warning or error above the ceiling), set per phase from CONTEXT; kit default conservative.
- Source: wildera:.planning/STATE.md:163; wildera:.planning/phases/01-m1-p0/01-CONTEXT.md:56-57; wildera:.agents/workflows/gsd-plan.js:137; wildera:_workspace/gsd/01-m1-p0/plan.args.json:3-4
- Why it exists: 85 plans in 8 waves was over-decomposition for a phase that is "tiny code" (STATE.md:163).
- Test idea: outline with 21 rows or 5 waves under a ceiling of 20/4 -> `outline check` reports it.

### GSP-85 Code-wave `verify:false` mode (handoff consumer)
- Behavior: `args.verify === false` makes the Verify stage return `{build:'ok', green:true, failures:{}, unassigned:[]}` at once: no build, no scenarios, no `test:`/`cmd:` obligation checks, synthetic green; Review/Confirm still run on dirty tasks. Used for code-only waves (Phase 01 W6 with `verify:false`, STATE.md:123 region; code-wave SKILL.md:55). Obligation checks otherwise run only when `v.build === 'ok'`.
- Proposal: KEEP as an explicit, loudly-labelled mode; the wave result must record `verify: skipped` so verification never reads synthetic green as evidence.
- Source: wildera:.agents/workflows/code-wave.js:199-217; wildera:.agents/skills/code-wave/SKILL.md:55; wildera:.planning/STATE.md:123
- Why it exists: owner moved to code-only waves followed by one combined verify (STATE.md:123-124).
- Test idea: `verify:false` run -> result says verify skipped, obligations empty; gsd-verify evidence flags it.

### GSP-86 Phase 1.1 execution rule: 4 waves back to back, one final fix
- Behavior: owner 2026-10-20: run the 4 handoff waves back to back, code-only (`verify:false`, Grok review kept, no fix loops, no per-wave integration points, tracer not gated alone), then ONE orchestrator build + full suite + phase matrix, and ONE strong-model (Opus) fixer that fixes every failure and self-verifies; spike no-go outcomes surface only in that final pass and the fixer applies the plans' stated no-go routes. This overrides gsd-plan SKILL Step 4 (tracer alone and green before expansion) for that phase.
- Proposal: CONFLICT with SKILL.md Step 4 and GSP-28/GSP-26 (tracer-first gating); OPEN whether tracer-first remains default (Open question 3).
- Source: wildera:.planning/STATE.md:164; wildera:.agents/skills/gsd-plan/SKILL.md:65
- Why it exists: loops against runtime failures did not converge (GSP-81); owner prefers one combined verify and a single fixer.
- Test idea: n/a until the execution design is decided.

## Invariants and lessons

- The file is the contract, never the agent's claim: research (`research.status`), verification (`verification.status`), structure (`verify.plan-structure`) are read back from disk after every agent; a null agent result is accepted only if the new file passes readback and differs from the old one. (gsd-verify.js:84-88; gsd-research.js:92-100; gsd-plan.js:163-170; compatibility.md:63)
- Upstream is untrusted data and the vendored snapshot is never edited; generated agents are never hand-edited; `check` fails on edit/drift/dangling reference/unmapped verb. Read the clone's HEAD without running git inside it. (port.mjs:87,214,250-252; NOTICE.md:5-6)
- Exit 69 (could not look / not ported) is never a pass; a verb not ported answers with its reason. (adapter.md:24; gsd.mjs:957-959)
- Never "proceed anyway": an open skeleton blocker, a REVISION_CONFLICT or an unresolved wiring conflict stops with needs-owner; a skeleton gate with zero lanes or an unanswered lane fails instead of passing. (skeleton-review.md:45; gsd-plan.js:76-77,451-453)
- Prompts carry input digests; a resumed run never reuses an agent answer produced for other inputs. (gsd-plan.js:72-74)
- Attempt records are written BEFORE dispatching an agent so an interrupted attempt is resumed, and the accepted report must be the one this attempt wrote (a report equal to the previous sha is rejected). (gsd-verify.js:38-46,87; compatibility.md:59)
- A changed owner input (CONTEXT, REQUIREMENTS, outline, wiring, specs, ROADMAP section) invalidates what was built on it; a code change alone does not invalidate a kept plan, it is reported (`headChanged`). (manifest.md:44; gsd.mjs:1012)
- Single writer: STATE/ROADMAP/REQUIREMENTS only by the orchestrator; revisions.json is recorded serially after parallel planners join; each file is edited by one agent at a time (phase-level revisions run after per-plan ones). (adapter.md:33; gsd-plan.js:286,607)
- Coders never build, test or commit; every `<verify>` is run by the Verify stage and is attributable to a task; an unmet obligation is that task's failure; the tracer plan runs alone and must be green before expansion. (adapter.md:50,61; gsd.mjs:634-635)
- Plans are executable by small-context agents: <= 3 tasks, exact read_first, disjoint owns, cross-plan calls frozen in WIRING (CONTEXT D-14); a plan never changes a frozen declaration (REVISION_CONFLICT instead). (01-CONTEXT.md:56-57; adapter.md:65)
- Research input policy: only the approved report path (or NONE) may be read by any role. (adapter.md:15)
- Deterministic findings are counted in code, not only through the LLM checker; severity unknown = blocker. (gsd-plan.js:186-187,264)
- Generated files are compared LF-normalised (CRLF checkout on Windows must not make `check` fail). (port.mjs:57-58,252)
- Lesson from execution: loops that retry coders against runtime failures did not converge (nine rounds on one scenario step); bound loops and escalate; do not let a workflow spin. (code-wave SKILL.md:53; STATE.md:124,151)
- Lesson from planning: most phase failures are decomposition/ownership/wiring defects; reviewing the skeleton before writing plans found 38 issues in pass 1 for 37 plans. (skeleton-review.md:3; 01-OUTLINE-REVIEW.md:5)
- Lesson: write long agent output in parts (STATE / research focus text asks for <=300-line tool calls). (research.args.json focus text)

## Interfaces

**CLI `gsd.mjs`** (all output one JSON line, `--pick <key>` bare value, `--root <dir>`): `query <verb> ...` (init.plan-phase|phase-op|execute-phase, init.debug, state.load, history-digest, frontmatter.validate|get, verify.plan-structure|artifacts|key-links, plan.task-structure, phase.list-plans|list-artifacts, find-phase, roadmap.get-phase|analyze, summary-extract, verification.fingerprint|status, check.decision-coverage-plan|verify, research.status|prompt); `check verify-command-paths|verify-failure-directions|owns|coverage|decision-coverage-plan <phase>`; `outline parse|check <phase> [--tracer false]`; `waves <phase> [--plans a,b]`; `handoff <phase> [--plans] [--prefix]` (stdin JSON base args); `revisions record|check|hash|show <phase> [key]`; `supersede <phase> --keep ids`; `attempt record|show <phase> --kind gap|verify|research`; `write <phase> NAME`; `hash`; exit 0/1/66/69.

**CLI `port.mjs`**: `vendor --from <clone>`, `build`, `check [--verbose]`.

**Workflow args**: gsd-plan: `phaseDir*`, `mode` plan|gaps, `tracer`, `reversibilityGates`, `granularity`, `wiring` auto|always|never, `skeletonLanes[{lens, model?, effort?}]`, `maxSkeletonPasses` (3, 1..3), `maxCheckIterations` (3, 1..3), `replan`, `commitDocs` (off), `skipResearch`+`researchSkipReason`, models/efforts `plannerModel/Effort`, `outlineModel/Effort`, `checkerModel/Effort`, `architectModel/Effort`, `reviewerModel` (default circle/gpt-6.1-sol-fast[1m])/`reviewerEffort` (medium), `codeWave{...}` merged into handoff. gsd-research: `phaseDir*`, `invocationId*`, `refresh`, `view`, `focus`, `researcherModel/Effort`. gsd-verify: `phaseDir*`, `baseline*`, `evidence[]`, `evidenceFiles[]`, `verifierModel/Effort`. Results: `{status, reason, stage?, issues?, options?, ...report}`; statuses planned|needs-owner|failed|refused (plan), researched|reused|view|needs-owner|failed (research), passed|gaps_found|human_needed|stale|failed (verify).

**Files**: see GSP-14/15/16/24/29/31/35/73/74; agent definition front matter `name, description, model(tier), tools(advisory), include[]`; handoff args (GSP-28); planner/checker/skeleton JSON schemas (gsd-plan.js:18-49).

**Config today**: none (no `.planning/config.json`); every setting is a workflow arg or hard-coded in gsd.mjs (WildEra paths, vocabulary, shared-file rules, `circle/gpt-6.1-sol[1m]` debug model). The new kit needs a project adapter file for: verify vocabulary + resolvers, owns syntax + shared-file predicate, source roots for resolution scans, project-instruction files (AGENTS.md etc.), spec/requirement ID scheme, role->model table, plan-size limits, coder/reviewer agent names and their wave-args fields.

## Cross-area dependencies

- install: ships `upstream/` snapshot, generated agents/skills, `tools/gsd` (or kit CLI), NOTICE/LICENSE; generated agents must be regenerated on kit update and project adapter changes; `port.mjs check` as an install/doctor check.
- runtime: workflow scripts rely on `agent(...)` options (label, phase, schema, agentType, model, effort, readOnly, session, cwd), `parallel`, `shell` (`{code, stdout, stderr}` never rejects, stdin `input`, `timeoutS`, `tailChars`), `phase`, `log`, `args`; `ph workflow --name ... --args-file ... --detach`, `watch-run`, `--resume`; sessions persisted across calls; resume cache keyed by prompt text.
- workflow: `code-wave` (execution of handoff args, ROOT rule, review gate, Verify obligations), `review-gate`; `gsd-plan` skill chain calls `ph workflow`.
- files / hooks: workflow scripts have no file access (all writes via `gsd.mjs` or agents); agents' `tools` list advisory; read-only roles use `readOnly:true`; no hooks used in this area.
- method: AGENTS.md rules (agents unattended, no commits, English artifacts, owner language in discussion), harness principle 6.
- gsd-debug: `debug lock check` admission in gsd-plan/code-wave; `needsDebug` signatures; `init.debug`; generated `gsd-debugger`; `--root`, `tree`, `reconcile`.
- gsd-upstream: this area IS the vendoring/port mechanism for the other GSD skills (discuss, debug, forensics) - one pin, one snapshot, one `check`.
- ui: none directly (plain-text owner questions through the main session).
- history: `.agents/harness-history.md` row after the first real phases (SKILL.md:74); EFFECTIVENESS.md/METRICS-PLAN.md per phase under `_workspace/gsd/<phase>/` (listed only).

## Concerns

- gsd.mjs is a 1070-line mix of generic and WildEra-specific code: UE source scan roots, `READONLY_CMD` (Build/Test/Scenario.ps1, UBT), `WildEra.` filter prefix, shared-file regexes and `game/` scan, `AGENTS.md`/`game/CODING.md`/`game/LAYOUT.md` hard-coded in `revisionFiles`, `circle/gpt-6.1-sol[1m]` in `init.debug`, import of `../ue/ownership_check.mjs` (gsd.mjs:17,341-396,463-478,684,873).
- Own YAML parser is ~130 lines of tricky code (flow values, comment stripping, quote heuristics); no tests in scope; a misparse silently drops fields (gsd.mjs:77-212). `scalar(inMap ? t : t)` is a no-op ternary (gsd.mjs:135).
- `revisions.json` stores the full file list per key (1630 lines for one phase) and a 244-line manifest plus 1315-line WIRING.md for one phase: artifacts are very large for small-context agents (revisions.json; WIRING 1315 lines per wildera listing).
- STATE.md grew to 164 lines of free-form prose (session continuity) and its frontmatter went stale (`percent: 0` with 16 of 37 plans complete; ROADMAP `Plans: TBD`, Progress `0/TBD`) because the orchestrator writes it by hand (STATE.md:1-10; ROADMAP.md:33,70).
- No workflow arg to force-proceed past the checker cap; no enforcement of the one-gap-wave cap (gsd-plan.js:269-272, 318-361).
- `shell()` string interpolation: phase paths and commit messages are interpolated into a cmd.exe command line; research validates the path with a regex because of it, plan/verify do not (gsd-research.js:17-20; gsd-plan.js:66-67,160).
- Skeleton stall check compares open counts before architect-added issues; a pass that swaps one issue for a new one counts as progress (gsd-plan.js:509-517).
- Skeleton reviewer retry on null: one retry, then hard failure of the whole run; checker the same (gsd-plan.js:451-453,260-262).
- Duplicated pin (port.mjs, UPSTREAM.json, NOTICE, DESIGN) and 254 vendored files of which many (quick-batch, review, execute-phase) are not used by any generated file (port.mjs:22-35).
- `gsd-plan.js` is 629 lines with stage logic, prompt text and report assembly interleaved; closures share mutable `oc`, `useWiring`, `report` (gsd-plan.js:395-560).
- DESIGN.md is stale in places (GSP-83); compatibility.md mixes planning and debug tables.
- Two parallel naming schemes for the same artifact: wildera `Plan ID 01-01` vs `NN-MM-PLAN.md`; handoff keys `plan-01-01`.
- 4,000,000-char `tailChars` on every gsd() call (gsd-plan.js:67) is a magic number.
- Phase 01 reached `needs-owner` at Check iteration 1 on a REVISION_CONFLICT whose cause was the path probe: scenario ids that only the integrator creates cannot resolve at planning time (STATE.md:44; 01-01-PLAN.md:176,220): the probe protocol needs a "created by shared change" state.
- Plans embed large orchestrator-only work (`<shared_changes>` with a 4-item gate) because the planner cannot own shared files; the plan grows to 235 lines (01-01-PLAN.md:167-177).

## Open questions for the owner

1. **Core vs adapter split of `gsd.mjs`.** Options: (a) core = parser, structure, outline/waves/handoff/revisions/attempt/research/verification verbs, adapter hooks for vocabulary, ownership, shared-file rule, source roots; (b) keep one file and let projects fork it. Recommend (a).
2. **How upstream is carried.** Options: vendor a trimmed snapshot (only files reachable from generated agents, ~150 files) + pin file in the kit; or fetch at `kit update` from the pinned commit into a gitignored dir. Recommend the trimmed vendored snapshot committed in the kit (offline, reviewable diffs).
3. **Execution stage in the new kit.** The documented chain executes plans through code-wave Verify loops; Phase 01 abandoned them for a single fixer per integration point (STATE.md:124,131,151). Options: (a) kit core stops at handoff + verify and the project adapter provides the executor; (b) keep a minimal wave executor in core (code, one integration build, bounded fix, review gate); (c) single-fixer flow as the default. Recommend (a) with (b) as a documented default executor, loops capped.
4. **Force-proceed at the checker cap.** Add `forceProceed {reason}` to gsd-plan (records override in result and STATE)? Recommend yes.
5. **Codify the extra plan-review pass** (many cheap finders/judges, one strong editor) as an optional stage? Owner said quality comes from added review steps. Recommend optional stage `planReview` off by default, lenses and models in config.
6. **Research stage weight.** Keep the invocation-UUID/signature/attempt-key/terminal-marker machinery or simplify to {attempt record + marker + input digest}? Recommend simplify, keep marker + digest + attempt record.
7. **Skeleton review defaults.** Keep two default lanes (fidelity, integration), max 3 passes (owner-fixed), allow any number of lanes and project-defined lenses (owner ran 4). Confirm the 3-pass cap stays a hard ceiling or becomes a configurable default.
8. **Requirement ID scheme and spec location.** Free-form IDs with a Spec column (REQUIREMENTS.md reality) vs `<SPEC-ID>:<rule>` (adapter.md): choose; and whether the project's specs stay under `backlog/docs/...` now that Backlog is dropped.
9. **gsd-debug and the admission lease** in gsd-plan/code-wave: carried or dropped (affects GSP-40, `--root`, `needsDebug`). Recommend decide in the gsd-debug area first; keep lease check as an optional hook.
10. **Plan-size policy** (D-14: <=3 tasks, <=5 files/task, ~100k-token coder) as kit default or project config? Recommend project config with a conservative kit default and a lint.
11. **Planning-time resolvability for integrator-created targets** (Concern, Phase 01 Check stop): add a `pending_shared` probe status for targets a plan's `<shared_changes>` creates? Recommend yes.
12. **State writing.** Replace hand-written STATE.md prose by a small `gsd state` CLI (position, wave log, decision, override) so frontmatter stays true? Recommend yes.

## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
|---|---|---|
| R1-GSP-01 | accepted | Verified STATE.md has 164 lines; line 163 (85-plan outline called overthinking, D-16, granularity coarse) and line 164 (4 waves back to back, one final fix; non-empty, contrary to the reviewer's "empty") now read. Coverage row corrected; new GSP-84 (plan-count cap and granularity values) and GSP-86 (Phase 1.1 execution rule); GSP-60 no longer treats "smaller plans" as final; GSP-83 item (10). |
| R1-GSP-02 | accepted | ROADMAP.md has 73 lines (`wc`); heading at 21, Requirements 24, criteria 26-32, Plans 33, decimal phase 15/35, Progress 70-73. Citations fixed in GSP-14, GSP-15, GSP-72 and Concerns. (File is 73 lines, not the reviewer's 74; conclusion unchanged.) |
| R1-GSP-03 | accepted | Verified 01-CONTEXT.md:56-57 has no 5-file cap and context-budget.md:119,123 holds the ">5 files" figure. GSP-60 split and the 6-file test idea removed. |
| R1-GSP-04 | accepted | gsd-plan.js:179-181,305,356-360 and gsd.mjs:974-979 confirm; GSP-57 corrected (probes and coverage see all plans). |
| R1-GSP-05 | accepted | gsd-plan.js:465-466,491-492 confirm the realign rule and `both` partition; GSP-50. |
| R1-GSP-06 | accepted | port.mjs:22-35 lists 7 agent files plus execute-plan.md and plan-review-convergence.md; managerTemplates check at 196-197; GSP-01. |
| R1-GSP-07 | accepted | DESIGN.md:161-162 vs gsd-plan.js:289-291; GSP-83 item (9). |
| R1-GSP-08 | accepted | code-wave.js:216-217 confirms; new GSP-85, note in GSP-66. |
| R1-GSP-09 | accepted | gsd.mjs:512 regex is any exact line; GSP-24. |
| R1-GSP-10 | accepted | review-gate.js:54 vs code-wave.js:291-296; GSP-68 behavior text (proposal DROP unchanged). |
| R1-GSP-11 | accepted | gsd.mjs:470-476 skip list; note in GSP-23 (GSP-19 already had the verify-walk list). |
| R1-GSP-12 | accepted | gsd-plan.js:619-627; GSP-55 (record once, plan mode only). |
| R1-GSP-13 | accepted | port.mjs:230,277 and gsd.mjs:935,981; GSP-09. |
| R1-GSP-14 | accepted | gsd.mjs:774-781; GSP-35 (stale is exit 0, fingerprint verb owns 69). |
