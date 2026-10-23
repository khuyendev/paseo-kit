# Changelog

Every change to shipped prompt text (the AGENTS.md block, skill texts, agent definitions and overlays, workflow lenses
and overlays, watchdog steering texts) lands with an entry here that names the owner's approval and date, the decision
and the measured check (HARN-15). `node kit/release-check.mjs [<range>]` checks this file against `kit.json`.

## [Unreleased]

- Live model switch (kit feedback 45, owner 2026-10-23: "đổi được hẳn model khi nó đang chạy giữa session"). While a
  workflow runs, its live agents follow their tier: the runner checks `.agents/harness.config.json` every 5 s and,
  when a tier resolves to another model of the same provider, switches each live agent of it through the daemon's
  `set_agent_model` (the Claude Code session keeps running; its next requests use the new model), plus the thinking
  level when the tier names one; it logs `retier <label> <agent>: <old> -> <new>` and the journal entry lists the
  switch. A tier moved to another provider leaves the running agent on its model (logged); a tier without a thinking
  level keeps the agent's thinking. New verb `ph model <agentId|runId> <tier|provider/model> [--thinking LEVEL]`
  switches one kit agent or every live agent of a run. Cost of a switched call is still priced at its start model.
  Prompt text: ph skill, kit-adapter.md section 7. Measured check: tests/fb2/F45B.test.mjs on the fake daemon; not run
  against the live daemon.

- Kit feedback 37-56 from the Flutter port (owner 2026-10-23: "check và sửa bug luôn"; one Haiku agent per item on
  main, merged by the main session). Plan: `gsd.tracer_extra_files` (default 0) raises the tracer plan's file line;
  phase-level checker issues get their revision before a per-plan REVISION_CONFLICT stops the run (37); a checker
  blocker stays open until a checker lists its id in `resolved`, carried into the next checker prompt as "still
  open?" (44); a changed revision input is named, and `forceProceed` is refused on plans the same run wrote (40;
  item 48's ROADMAP wave headers were already out of the hash, G053); plan review reports per-cycle counts (46) and
  records each edited plan that passes its structure check even when the review stops (47); `adapter.commands.
  smoke_builds` (default empty) with `ph gsd check smoke` builds each declared verification target before planning
  (50). Map: CONCERNS Known Bugs carry `Status: verified` with `Evidence:` or `Status: suspected`, map-check rejects
  others, and gsd-map-codebase runs a read-only map review (new agent `gsd-map-reviewer`) whose problems go back to
  the mapper once (41, 43); `ph gsd phase complete` proposes gsd-map-codebase and the harness pass when a phase
  shipped code and no map or no review lens exists (38, 42). Execute: a non-owner fixer's "blocked" no longer stops
  the round before the other fixers' owned changes are transferred and re-gated, and each fixer gets only the
  failures naming its files (51); `ph gsd grant <phase> --path <file> [--plan <id>]` lets a fixer change a committed
  earlier-wave plan's file, offered as a needs-owner option (53); the resume gate breaks an equal-depth owner tie by
  the latest transfer record, and `ph gsd execute adopt` re-records a transferred path after an owner hand fix (54,
  56); a fixer's stop says when its last edit was not followed by a test run (55). Runtime: a workflow `agent()`
  resolves its tier from the current overlay at each call and logs a tier change (45); the runner records its exit
  reason (signal, uncaught error, unsettled await) in run.json and log.txt, and watch-run prints the resume command
  (39); `ph doctor` and harness lint list git-ignored paths the adapter uses that `worktree_setup` does not set up
  under worktree isolation (49; `ph gsd halt clear` already existed); `ph context --self` prints the compact reminder
  threshold (52). Prompt text: gsd-codebase-mapper and gsd-plan-checker overlays, new kit agent gsd-map-reviewer,
  skills gsd-plan, gsd-execute, gsd-map-codebase, gsd-verify, ph, harness references. Measured check: tests/fb2/
  (each failing before its change), full offline suite 1872 pass / 0 fail / 11 skipped; not run on a live phase.

- Bug-hunt fix pass, all other areas (owner-approved 2026-10-23: fix every verified group, design groups per the
  owner's kit-feedback suggestions, GSD-related policy kept as upstream GSD does; kit-bughunt dedup/VERIFIED-ALL.json,
  one Haiku agent per group, merged on bughunt-fixes). 157 groups across plan, plan review, research, revisions,
  verify, quick, debug, map, new-project, workflow engine and CLI, ph verbs and help (`--help`/`-h` on every verb),
  Windows (`.cmd`/`.bat` and `.ps1` resolution through PATHEXT), hooks, installer, harness-files mod, pricing and the
  two plugins. Owner design choices: only blockers revise, stall or cap a checker, skeleton or quick loop, warnings are
  carried (feedback 13, 20); the file line scales with `plans_per_phase` (20); checker cap and stall count per plan
  (9); plan review converges on high, carries medium/low as advisories, caps by trend and re-reviews its last edit (16,
  17); delegated discuss mode (8); plan-review edits and each finished plan are recorded at once (18, 20); revision keys
  hash what each judgement reads (3, 14). Feedback 2: gsd-plan holds only its phase lease, execute, debug and quick keep
  the code-root lease, `ph gsd commit` takes a git writer lock, so planning phase N+1 overlaps executing phase N.
  Feedback 22: optional `adapter.dependency_probe` (argv, default unset) runs at handoff on the plans' structured
  `<path>: dependency <name> [<constraint>]` lines and stops needs-owner at Dependencies on failure. Feedback 26:
  `adapter.ownership.regenerated` globs (default empty) and line-ending-only changes outside owns are dropped at
  transfer with a log line; executors delete their scratch files. `ph gsd phase uat-passed` follows upstream GSD: a
  verified gap resolution and a skipped test with a reason no longer block (GSDC-16 wording updated). Kept as GSD does
  (owner 2026-10-23): research reuse does not hash STATE.md (G051), standalone plan review adds no deterministic size
  rule (G042), every UAT issue blocks (G099); kept as is: the skill-usage log is not rotated (G171). G144 (owner chose
  option 1): an `agent()` call without `timeoutS` under an armed watchdog waits in `wait_timeout_s` slices until the
  watchdog stop (`agent_stop_s` of model time), so a long turn is no longer nulled at 3600 s wall; unarmed waits and an
  explicit `timeoutS` keep the cap (paseo-runtime.md, INTERFACES.md). Prompt text: the
  gsd-plan-checker overlay (blocker-only gates, scaled file line, task limit, research questions answered in a plan),
  gsd-planner overlay (dependency lines), skills gsd-plan, gsd-quick, gsd-execute, gsd-debug, gsd-discuss, gsd-verify,
  gsd-research, gsd-map-codebase, ph, harness references, INTERFACES.md (role catalog 4.2, worktree_setup,
  code_review). Integration commits keep generated role files untouched (G026 rule moved to the overlay) and
  `.planning/requirements/tools.md` at its phase base (OFFC-25). Measured check: one regression test per group in
  tests/bughunt/ (failing before each fix), full offline suite 1806 pass / 0 fail / 11 skipped on Windows; not run on
  a live phase or in the Paseo app.

- Bug-hunt fix pass, execute flow (owner-approved fix brief 2026-10-23, kit-bughunt FIX-BRIEF; groups G054-G092, G006,
  G020, G126; kit-feedback 1, 19, 21, 23-36). Safe resume: a nested path belongs to the plan owning it most specifically
  (the hotfix of feedback 31, done on normalized owns); a commit of the run whose commits.json record failed is
  reconciled from its `Plans:` trailer; a commit between runs that touches no plan-owned file is accepted; new adapter key
  `adapter.ownership.ignore` (default empty) for notes kept during a run. `ph gsd halt clear <N> --plan <id> --reason`
  records the owner's answer; the rerun dispatches the plan with it, and skipped (halted, blocked) plans are listed in the
  result. Requests route by path boundary and owns forms; a request no open plan owns, and each plan's
  `<shared_changes>` (now `<path>: <change>` lines, carried per execution wave in the handoff), are made by one
  integration fixer owning exactly those paths before the gate and committed with the wave (feedback 21, 36; no
  trailer exemption). Fix rounds judge an unresolved fixer on a fresh gate (feedback 28, 30); a failure naming no file
  stops instead of an integration fixer owning nothing; batch mode gives unplaced failures to an integration fixer.
  Stray main-tree edits stop before the gate and the review (feedback 35); fixers return out-of-owns changes as
  requests. Review: records carry a stamp and are replayed on unchanged code, a rerun after a fix pass runs only the
  resolution check (feedback 33, 34), one more fixer pass covers findings still unresolved, a resolution call with no
  answer fails with a resume hint instead of an unresolved verdict (feedback 32), verifier evidence reaches the owner,
  deferred.md lines are written once; the agent-call digest leaves out HEAD and the run's own records. Gate evidence:
  a changed obligation command is stale, a gsd setting edit is not, numbers are taken exclusively, attribution hooks
  answer by failure id and their failures are noted, evidence parsers get stdout and stderr apart. Handoff writes a
  manifest last and execute refuses a stale or cut-short handoff. Also: executor task coverage (empty or skipped is not
  done), transfer intent record, `--end-of-options` for revision arguments, evaluation-scope walks the whole history
  (`truncated` when a cap is hit), named git commit timeouts, STATE wave line written once, lease refusals name the
  holder's workflow, a dead claim of the lease is reclaimed, gsd-flow verbs read stdin only when they take input, plan
  frontmatter errors are not runnable, review-record plan ids, junction-safe review scope, quoted SUMMARY key-files.
  gsd-plan stops at Discuss on unanswered blocking anti-patterns. Prompt text: the overlays of gsd-code-fixer (no
  worktree, out-of-owns requests), gsd-code-reviewer (workflow severity words), gsd-executor (no WINDOWS ledger,
  task coverage) and gsd-planner (`<path>: <change>`), finding-verifier (batched verdicts), the
  gsd-execute, gsd-plan and gsd-discuss skills, kit-adapter.md section 4. README: critical and high block (the code's
  rule). Changed tests: ADPT-17 fixture steps carry the requested argv; the exec test world ignores fail.flag; CONF-11
  and ADPT-16 golden tables gain `ownership.ignore`. Measured check: tests/gsd-flows/bughunt-execute.test.mjs and the
  full offline suite; not run on a live phase.

- planning-panel targets Paseo 0.12.0 (manifest requirement and `@getpaseo/plugin`), like office: the 0.12.0 daemon
  refuses a 0.11.2 plugin. PANL-01 pins both plugins to 0.12.0. Measured check: the full offline suite.

- Owner-approved code review switches, 2026-10-22 ("tùy dự án mà chủ quyết định"): gsd-execute reviewed the plans of a
  wave one after another with one reviewer, and no project setting could change that. New `gsd.code_review`
  `{max_concurrent, reviewers}`: `max_concurrent` plans are reviewed at once (finding verification and the resolution
  check included), `reviewers` adds independent reviewers of every plan, each with its own model and effort; their
  findings are kept apart (ids `R2-`, `R3-`). Review records and `deferred.md` are written one at a time, because
  review-record renders REVIEW.md from every record. The kit default `{max_concurrent: 1, reviewers: []}` keeps the
  old behaviour. The review-stats tests are renamed RVST-01..03 (REVW-01..03 already named review-rule tests).
  Prompt text: kit-adapter.md section 4. Measured check: REVW-07/08 and the full offline suite; not run on a live
  phase, so the wall-time gain is not measured.

- Owner-approved shipped price table and review measurement, 2026-10-22 ("1 2 luôn", after comparing WildEraV6's
  own tools with the kit): (1) the kit ships `.agents/model-prices.json`, the list prices of every model in
  `paseo/providers.json` plus the fast variants, each with its source page and check date (Claude models compared with
  the official pricing page on 2026-10-22, the others taken from the 2026-10-19 check of a live project). Prices belong
  to the providers, not to a project; without a table every `costUsd` was null, and the daemon's own estimate is wrong
  through the proxy. The file is kit-owned: `update` refreshes it unless the project edited it. (2) `ph review-stats
  [--phase NN]` reads every phase's `review/*.json` records (not `_workspace/review-metrics.jsonl`, which a resumed run
  appends again): findings by severity and gate status, verdicts of gated findings, confirmed findings resolved,
  likelihood against findings judged real or false, defect classes; `ph review-stats outcome PLAN:FINDING
  fixed|not-hold|duplicate|wont-fix` records the later fate of a finding. Prompt text: the ph skill, kit-adapter.md
  section 11. Measured check: PHCL-14, RVST-01..03, the full offline suite, and a read-only run on the office phase's 12
  records (68 findings, none gated).

- Worktree setup, 2026-10-22 (owner asked for it and approved copy as the default with link as an option: "ok làm
  đi"): `git worktree add` checks out tracked files only, so on the office phase executors in harness worktrees had no
  `plugins/office/node_modules` and could not typecheck or test; a `paseo.json` worktree setup never ran (Paseo does
  not create these worktrees) and a hand-run watcher copied the folder in. New adapter entry
  `adapter.worktree_setup` `{copy, link}` (default empty): every new worktree of `ph spawn --worktree` and workflow
  isolation gets these git-ignored paths from the checkout before its agent starts; any problem (malformed or
  overlapping path, missing in the checkout, a link, not git-ignored) removes the worktree and fails the start.
  `link` makes a directory junction (symlink on POSIX); removal through the kit drops the links first (git 2.55 on
  Windows also leaves the target alone, checked by hand). `ph doctor` and `ph harness lint` report the same
  problems. Prompt text: kit-adapter.md (section 4 row, section 8 lint list) and the ph skill. Measured check: the
  new PHCL-31/PHCL-04/HARN-07 tests and the full offline suite; not yet run on a live phase.

- Owner-approved watchdog thresholds, 2026-10-22 ("mở các ngưỡng lên"): both live projects had loosened or disabled
  the watchdog (one disabled it entirely on 2026-10-16; the office project raised the nudge to 45 min, piecemeal to 40,
  reread to 6), and 39 % of one project's piecemeal warnings hit read-only reviewers. Shipped defaults now:
  `agent_nudge_s` 2700 (was 900), `agent_stop_s` 5400 (was 1800, and must stay above the nudge: 1800 under a
  2700 nudge stopped agents before any nudge), `watchdog_same_file_reads` 6 (was 3), `watchdog_reads_without_write`
  40 (was 15). Unchanged: `watchdog_repeat_calls` 3 and the stuck-tool limits, which caught the only real hangs. The
  watchdog code and its messages are unchanged. Prompt text: the ph skill table and the numbers in
  `paseo-runtime.md` (kit region, digest updated). Measured check: FLOW-38, HARN-01, the watchdog tests (now with
  fixed small thresholds) and the full offline suite.

- Owner-approved run-mode pointer and stop reasons, 2026-10-22 (after reading WildEraV6's 250 runs: 37 stopped
  mid-phase with no reason recorded, and the new kit records none either): `ai-orchestrator` gains "Choosing how to
  run", which sends project work with `.planning/` to the GSD skills and other work to the existing execution-mode
  decision tree, team patterns and workflow recipes of the harness skill instead of a new table. `ph archive --run`
  takes `--reason`, writes `stopReason` into run.json and puts the stopped run into the metrics ledger at once (a killed
  runner never records itself); `ph evolve-stats` counts stopped runs per workflow by reason. Prompt text: the
  ai-orchestrator skill, the ph skill and kit-adapter.md section 11. Measured check: PHCL-20, EVOL-07, HARN-17 and the
  full offline suite.

- Owner-approved main-session skill and null counting, 2026-10-22: the owner states `ai-orchestrator` is their own
  skill, so it is no longer carried as protected method text (D-111): its PROVENANCE entries, source fixture and NOTICE
  are removed and HARN-17 checks the kit text. Its description now says when to trigger, with English and Vietnamese
  phrases ('tự lái', 'giao cho agent', 'chạy song song'), and a new section "Accepting an agent's work" (after the
  Opus 5.5 guide): check each agent's evidence before accepting it, confirm N results for N items, have a different
  agent confirm a deciding conclusion, an agent that stopped without a reply produced nothing. `ph evolve-stats`
  counts quota and rate-limit nulls, and an empty reply with no output tokens, as infra: on the office phase the
  executor's 7 nulls move from 4 agent / 3 infra to 0 agent / 7 infra. Measured check: HARN-17, EVOL-01, the full
  offline suite; the skill change is not yet observed in a live session.

- Owner-approved skill fixes, 2026-10-22 (owner request after the Claude Code team's skills write-up: "làm ngay sửa
  bug", "trigger cả tiếng anh các tiếng việt luôn"): the gsd-research description held an unquoted "Standalone: never",
  so its front matter was not YAML and Claude Code listed the skill without a description; it is quoted, and SKIL-01
  checks every shipped SKILL.md front matter. The 13 GSD skills and ph end their descriptions with trigger phrases in
  English and Vietnamese. New hook `skill_usage.mjs` (PreToolUse Skill) logs each skill the model invokes to
  `_workspace/skill-usage.jsonl`, and `ph evolve-stats` lists every project skill with its count. kit-adapter.md
  section 6: a `## Gotchas` section in the stack skill, trigger-style descriptions in the owner's wording, quoting.
  harness, harness-evolve and ai-orchestrator (protected method text) are unchanged. Measured check: SKIL-01..03, the
  hook registration tests and the full offline suite; the trigger phrases are not yet checked with live 3 + 3 trigger
  requests.

- Owner-approved kit rules, 2026-10-22 (owner request after reading the claude.dev posts on Opus 5.5, effort and agent
  automations; owner judged the AGENTS.md block outdated and approved the cut with "Gật"): the AGENTS.md block keeps only
  rules nothing else enforces. Added: report to the owner under **Blocked on me / Changed / Found**, mark unconfirmed
  claims `[UNVERIFIED]` with where you looked, say when an agent stopped without a reply. Kept: fix the product, not the
  fixture; clean up only what you created; state files are written by scripts. Removed, because code or another always
  present text already carries them: File I/O (io guard reminders, first_prompt_note), Definition of Done (plan
  must_haves and the gate), polling and next: lines (every ph command and the ph skill), quota retries (NEVER_RETRY),
  preflight (harness skill), paths not content (max_prompt_bytes), worker messaging (worker deny list); the io guard
  reminders now start with "File I/O: " instead of pointing at the removed AGENTS.md section. The code fixer
  of gsd-execute runs at effort `high` on its tier unless `gsd.roles.fixer.effort` is set (kit-adapter.md section 7).
  `ph evolve-stats` suggests a `--budget` of 4 x a workflow's median output tokens per run. Measured check: HARN-14,
  HOOK-24, EVOL-06, REVW-05 and the full offline suite; the effect on live runs is unmeasured.

- Owner-approved review rules, 2026-10-22 (owner request after reading the Claude Code team's code-review write-up,
  "chỉ làm review trước"): the code review of `gsd-execute` gets the lines each plan changed (new flow verb
  `changed-lines`: uncommitted hunks, all of a new file, or the plan's commit) and marks a finding outside them, by more
  than 3 lines, that the reviewer does not say the change caused (`introduced`) as `pre-existing`: recorded in
  `deferred.md`, never verified, fixed or blocking. A finding names its defect `class` and every `instances` place, and
  the verifier, the fixer and the resolution check see all of them. A second, independent `finding-verifier` decides
  findings the first left uncertain before the owner is asked. `review-metrics.jsonl` adds `preExisting` and
  `secondVerifier`. Prompt text: the reviewer prompt in `gsd-execute.js`, `finding-verifier.md`, the gsd-execute skill
  and lens-writing rules in `kit-adapter.md` (what failure looks like, skipped paths, file-and-line evidence, capped
  nits). Measured check: `tests/gsd-flows/review-rules.test.mjs` (6 tests) plus the full offline suite; not yet run on
  a live phase, so the effect on review rounds is unmeasured.

- Owner-approved Office plugin, 2026-10-21: `office` is a native port of habblaud's drawing code (MIT,
  `LICENSES/habblaud-MIT.txt`, commit in `NOTICE.md`) into a new read-only plugin, id `office`, that replaces
  swarm-map. Data comes only from the official Paseo API; the usage slot stays empty until the owner supplies the API;
  strings are English, in a strings table. swarm-map is removed and the machine plugin list is now planning-panel and
  office (`kit/machine/plugins.mjs`). The Paseo app compiles plugin client code with Hermes, which rejects class
  syntax: the office client is class-free and the OFFC-25 gate (`tests/ui/office-hermes.test.mjs`) fails on any class.
  The plugin is pinned to SDK `@getpaseo/plugin` 0.12.0 (manifest requirement paseo 0.12.0). Desktop only; mobile not
  tested. The D-12 spike measurement was waived by the owner on 2026-10-21 and is still owed (`07-SPIKE.md`
  SPIKE_WAIVER: provisional ZOOM_LEVELS [2, 3], TINT_LEVELS 2); this entry claims no measurement, no visual check in
  the app and no spike pass. Measured check: `tsc --noEmit -p plugins/office` exit 0; `node --test
  "tests/ui/*.test.mjs" "tests/machine/*.test.mjs"` 432 tests, 423 pass, 0 fail, 9 skipped (the retired OFFC-10 spike
  tests), exit 0. Operator: run `paseo plugin ls`; if it lists swarm-map, run `paseo plugin remove swarm-map`.
  Supersession ledger: `.planning/requirements/office.md` (OFFC-23, OFFC-25, HARN-15, D-10). The owner delegated the
  approval and the wording of this entry to the main session on 2026-10-21 ("Tự chốt").

- Owner-approved evolve metrics, 2026-10-21 (owner request after reviewing the eval/hillclimbing article: measured
  data for `harness-evolve`): workflow journals record each call's `agentType`, `role`, `roleHash` and `effort`;
  every ended run appends one line to `_workspace/harness-metrics.jsonl` (kept by `ph runs --prune`); new
  `ph evolve-stats` prints the ledger per agent version and per workflow, with `null` reasons split into agent,
  infra and other causes, and `--import` adds older runs. Kit-authored prompt text: `kit-adapter.md` section 11
  (sort failures by cause first, compare versions only with at least 5 runs each, judge on runs the change was not
  tuned on, cost at the same results, `measured:`/`not measured` in the history Reason) and the ph skill; protected
  Harness method text is unchanged. Measured check: `tests/workflow/evolve-stats.test.mjs` plus the full offline
  suite; not yet run on a live project.

- Owner-approved tier policy, 2026-10-20: kit-authored adapter/runtime guidance keeps model, thinking and native
  `features.fast_mode` in one project tier, batches owner-requested mapping updates and uses tier references by
  default instead of duplicate Fast tiers. Existing runtime feature forwarding is reused; protected Harness/GSD
  method text and neutral shipped model defaults remain unchanged. Tests cover on/off tier propagation and
  direct-model bypass. Bounded live evidence (`.planning/integration/tier-fast-mode-live.md`) confirms tier
  values reach Paseo but does not qualify effective Fast: the Opus ON response still reported standard speed.
  Direct native CLI loopback request capture emitted `speed:fast` for Opus 5.5, not Haiku/Sonnet 5.5 in the tested
  invocation (`.planning/integration/native-fast-request-evidence.json`); no upstream capability is inferred.

- Owner-authorized live adapter fix, 2026-10-20 (LA-01/02, D-111): kit-authored generation overlay now requires
  stable target identities and a positive/negative protocol self-check before readiness. Added an explicit
  opt-in adapter check using existing hook/coverage contracts; lint stays structural and protected method text
  stays unchanged. Measured checks and live requalification instructions: `.planning/integration/close-live-findings.md`.
  Offline regressions alone did not close HARN-04 / CR-HAR-09. Subsequent fresh Node HTTP and compiled C#
  generator runs invoked installed harness Skill and passed selector/evidence checks, negative controls,
  lint and 40 fresh trigger requests; bounded live qualification closed both items. Main independently reran
  the repaired selector checks. Evidence: `.planning/integration/requalify-adapters.md`.

## [0.0.1] - 2026-10-20

First release of the from-scratch kit (owner decisions D-109, D-110, D-111, approved 2026-10-20; specification
`.planning/REQUIREMENTS.md`). Measured check: `npm test` green offline (fake daemon, fake clock, temp projects).

- Install and update into a project (`kit.mjs install|update|status|pull|help`): digest-tracked kit parts, the
  AGENTS.md block, the `.gitignore` block, `CLAUDE.md` import, kit hook registrations, optional harness-files mod
  activation (`--enable-plugin`).
- Machine setup (`kit.mjs machine check|apply|export`): additive Paseo provider patch with the worker deny list and
  the main-session deny list (`Agent`, `Workflow`), kit Paseo plugins, `kit-init` user skill links.
- One config loader (`.agents/harness/config.mjs`): kit defaults plus the project overlay
  `.agents/harness.config.json`, closed validation, `adapter` and `gsd` sections; tiers ship unconfigured.
- `ph` CLI: doctor, spawn, fanout, send, watch, result, team, context, compact-self, stop, archive, task, freeze,
  worktrees, workflow, watch-run, run-stats, runs, gsd, harness lint, config.
- Workflow engine (`ph workflow`): deterministic scripts, journal and resume, budgets, admission, model-time
  watchdog, worktree isolation, session agents; agent options `detail` and `timeoutS` and the `runId` global for the
  GSD scripts.
- Harness-files mod (`read_ranges`, `edit_multiple_files`, `write_multiple_files`) with a manifest-verified backend.
- Hooks: context guard, io guard, adapter-driven syntax check, long-command guard.
- GSD core: vendored upstream snapshot (open-gsd/gsd-core `next` @ 274f8ca), generated agents and method texts with
  kit overlays, the ported `ph gsd` verbs, GSD skills and workflow scripts (map, new project, discuss, research, plan,
  plan review, execute, verify, quick, progress, pause, undo, forensics, debug).
- Harness method skills carried unchanged except inventoried adapter regions: `harness`, `harness-evolve`,
  `ai-orchestrator` (HARN-17, D-111).
- Paseo plugins (not installed into projects): swarm map and planning panel.
- Owner-authorized review/fix pass, 2026-10-20 (the approved specification and final-integration task): closed
  cross-area cleanup, pagination, byte-hashing, doctor, adapter evidence and roadmap-coverage defects; completed
  batch-worktree accepted-dependency seeding. Regressions exercise actual runtime consumers with offline fakes.
- Area fixes harden install containment and retirement, machine secret scrubbing and link rollback, file-tool
  recovery and alias handling, hook concurrency, workflow sessions/deadlines, GSD resume/review/commit gates,
  and read-only panel loading/aggregation. GSD research routing adapter wording now offers explicit refresh for
  stale/blocked reports (GSDF-13); protected harness method and vendored GSD bodies remain unchanged (D-111).
- Evidence: full offline `npm test`, all four former TODO tests activated, source-provenance and vanilla scans,
  plugin type/host-bundle checks and release check; details and manual-only acceptance still owed are recorded
  in `.planning/integration/code-final.md`. No live generator acceptance is claimed.
