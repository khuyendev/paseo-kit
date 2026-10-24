# Changelog

Every change to shipped prompt text (the AGENTS.md block, skill texts, agent definitions and overlays, workflow lenses
and overlays, watchdog steering texts) lands with an entry here that names the owner's approval and date, the decision
and the measured check (HARN-15). `node kit/release-check.mjs [<range>]` checks this file against `kit.json`.

## [Unreleased]

- Role text A + B, kit feedback 117 follow-up (owner 2026-10-24: keep the role text as upstream GSD and skills as
  upstream; "Ok làm A thôi. Giữ đúng stream. Làm B cũng dc, theo config project"; graphify "bỏ cho gọn"; one Grok 4.7
  agent, note kit-bughunt/fb11/design/RAB.md). Measured on the 2026-10-24 transcripts: the planner ran
  load_graph_context (graphify / gsd-tools, not in the kit) in 32 of 59 runs and opened the PLAN template's
  `@execute-plan.md` and `@summary.md` (50 KB) in 29 of 59. A: `ph gsd upstream.build` drops the steps that need an
  upstream tool the kit does not ship (planner load_graph_context, history_digest, inject_global_learnings,
  validate_plan; phase-researcher graph step, research_plan_seam, commit_research; project-researcher
  research_plan_seam; plan-checker, verifier and code-reviewer gsd-tools launchers); graphify is always dropped. Inside
  the planner's PLAN.md template `@path` lines become backticked paths, so the plan still names them and the planner no
  longer opens them. B: optional `gsd.tdd_mode` / `gsd.mvp_mode` (absent = false, the kit runs neither) keep the TDD and
  MVP sections; off, the build drops them; `gsd.validation_strategy: false` also drops the Nyquist sections. Generated
  roles carry a config stamp and `upstream.check` / `ph doctor` report roles built for another config (rebuild with
  `ph gsd upstream build`). Prompt sizes: planner 59.3 -> 55.2 KB, verifier 51.9 -> 49.4, phase-researcher 40.1 -> 37.3,
  code-reviewer 24.7 -> 22.2, debugger 41.5 -> 39.9, executor 31.3 -> 30.2; everything else stays upstream text.
- Kit feedback 110-117 and WildEraV6 4-7 (owner 2026-10-24: "Tiếp tục lấy feedback đi, có vụ prompt truyền vào vớ vẩn
  đấy", then "agent nạp đúng thứ cần thiết để làm việc thôi"; six Grok 4.7 agents, notes kit-bughunt/fb10/design/<ID>.md,
  verification kit-bughunt/fb10/VERIFY.md). Role prompts (117, WildEraV6 7): the inventory declares per role the
  upstream sections the kit overlay or runtime replaces (commit protocol, final commit, STATE/ROADMAP updates, worktree
  metadata, checkpoint/continuation return formats, project-state loading, agent-skills bootstrap, doc lookup) and
  `ph gsd upstream.build` drops them, leaving one `<!-- kit: <id> replaced by the kit overlay -->` line; every other
  line stays upstream text and `upstream.check` proves it (D-111). executor-rules.md no longer repeats the role's
  sections (12.3 KB -> 0.3 KB) and the executor runtime block no longer restates overlay rules. Sizes: gsd-executor
  47.8 -> 28.5 KB, gsd-code-fixer 43.4 -> 17.6 KB, debugger 47.7 -> 38.8 KB, phase-researcher 46.6 -> 38.5 KB.
  Optional `adapter.doc_tools` keeps documentation_lookup; `ph gsd upstream size` (printed by `ph doctor`) shows each
  role's size and dropped bytes; the run log names each agent's first-prompt size. WildEraV6 6: the code-review, fixer
  and finding-verifier prompts name the stack skill. WildEraV6 4: the workflow config load keeps the whole JSON
  (tailChars). WildEraV6 5: a one-shot call's reply is journaled before its agent is archived; per-agent memory note
  700 MB and `ph doctor` suggests max_live_subagents (an MCP filter per role is not possible in the current runtime).
  110: a gap-closure wave commits as `fix(<N>-gap<k>): phase <N> gap wave <k>` and its record lists `gaps`. 111: `ph gsd
  evidence refresh <N>` reruns the phase's batch gate on HEAD; gsd-verify stops needs-owner with that verb when every
  evidence file is stale. 112: a step whose output holds a runtime crash signature (out of memory, DumpStackTrace, ...;
  optional `adapter.crash_signatures`) is `crashed`, not a hang, blocks no other step and stops with `rerun`; steps
  record free memory and commit; `ph doctor` notes low commit. 113: `hand-edit.record --amend` keeps a `history`; the
  usage names the 300-character limit. 114: contract drift ignores spans qualified by another type or naming another
  produced symbol, and names it. 115: plans marked for re-planning after their planner ran are re-planned before the
  checker (bounded), the checker does not start with an open mark, and each plan gets a threat-ID range T-NN-MMxx.
  116: the gate's signature note accepts equivalent declarations (body, parameter names, `this.`/`super.` field
  formals, multi-name fields).
- Kit feedback 102 F4, 103, 105-109 and WildEraV6 1-3 (owner 2026-10-24: "Lấy feedback từ wilderav6 và paseo kit về
  kiểm tra rồi fix", then "Bỏ opus dùng grok đi": six Grok 4.7 agents, notes kit-bughunt/fb9/design/<ID>.md, verification
  kit-bughunt/fb9/VERIFY.md). 104 was already fixed by 91. Fix rounds (102 F4, 108): the gate log's failing files include
  a Flutter `[E]` block's test path, bare paths and `path line:col` stack lines, and every next round dispatches the
  owner of each; a request a fixer routes to a same-wave plan dispatches that plan's fixer in the same round (once);
  identical requests from several fixers merge (`requesters`); a failing test file no wave plan owns, whose breaking
  change a shared change or owner answer of the phase names, stops at Gate before the fix rounds with `ph gsd grant`
  (`unownedTests`). Fixer test runs (109, 107 F1/F3): new verb `ph gsd test-run <files>` (module gsd/test-run.mjs) runs
  owned failing files one at a time under a project test lock (adapter.mutex, else one per git common dir), with the
  per-test timeout arg, kills the runner tree at a whole-file bound and writes the full log to a file; the fixer
  prompts use it and read failures from that file; the run allowance is `max(gsd.fixer attempts, failing files + 2)`;
  an unverified last edit goes to the next gate instead of an owner decision (an explicit owner ask still stops); new
  optional `adapter.commands.test_file_timeout_s` (absent = test_timeout_s). Shared changes (105, 107 F2): a
  `<shared_changes>` block reading None/n/a (prose after it) is no change, and `check owns` flags a pathless entry
  (`shared-path`); `ph gsd shared clear` without `--path` clears only fileless entries and refuses while a wave entry
  with a file is unapplied; a fixer request for a build output or a check rerun is a gate kit note, not a shared
  change. Transfers (106): a status-modified file with an empty `--ignore-cr-at-eol` diff is unchanged (dropped and
  reported); a fix-round transfer refusal records the fixer worktree with `finished: true` so `halt clear --resume`
  takes it; the adapter writer seeds Flutter's plugin registrants in `adapter.ownership.regenerated` (never over a
  project value). Checks (103): an adapter command that keeps its old argv and only adds strictness flags (timeout,
  fail-fast, reporter/output, verbosity; optional `adapter.commands.non_weakening_flags`) is a note, not a weakening
  (the baseline also stores `gateConfigBody`); a manifest signature on a JSON catalog (or `adapter.catalogs` globs) is
  checked by key path. WildEraV6: `ph fanout --collect` re-reads the running count under the cap lock at each
  admission and waits (polling, up to wait_timeout_s) for a freed slot instead of fixing the pool size at start; a C++
  /UE check-weakening stack (UE Test* macros, AddExpectedError, UTEST_*, gtest, Catch2; narrowed automation-test flags
  and a wider TestNearlyEqual tolerance are weakenings); a name clash names the agent ids and `ph result` / `ph
  archive`. No behaviour switch: each old behaviour was the bug.
- Kit feedback 102 (owner 2026-10-24: "Check feed back"; one Opus agent, note kit-bughunt/fb8/design/W102.md): hung
  tests and gate fixers. A gate step that times out names its hung test files (from its argv, else its last output
  line naming one); later steps of the same gate run that would run them are failed `blocked by hang` without running,
  and the result lists `hung`; the failure goes to the owner of the hung file. Optional
  `adapter.commands.test_case_timeout_s` with `test_case_timeout_arg` (argv template, `{s}` = seconds; e.g. flutter/dart
  `["--timeout","{s}s"]`, jest/vitest `["--testTimeout={s}000"]`, pytest `["--timeout={s}"]`, go `["-timeout","{s}s"]`)
  is added to every test command the gate and the fixers run, so a hang fails one test in seconds; new flow verb
  `test-command`. With `gsd.fixer_verifies_itself` (default true) a gate fixer and the integration fixer may run the
  failing test files they own with that timeout (bounded like the review fixer); off keeps the old "do not run tests".
  Prompt text: executor-fix and integration-fix templates. Measured check: tests/fb8/, full offline suite 2438: 2425
  pass, 0 fail, 13 skipped; not run on a live phase.

- Kit step library for execute (thin composition stage 3, part S1; owner 2026-10-24 "Ok tách"; design
  kit-bughunt/thin/STAGE3.md, one Opus agent). The steps the waves, graph and batch schedules share moved verbatim into
  `harness/workflow/steps.mjs`, which the engine binds per run as the global `executeSteps(...)`: preconditions, dispatch
  and integration, the wave step, shared changes, gate and fix rounds, smoke and stray stops, code review with finding
  verification, fixer and resolution check, the commit transaction, tracking, pause and phase gate. The composition
  passes every policy as a value (no step reads a composition policy key) and gets every stop back with its answer; it
  keeps the argument and policy reads, the order of the preconditions, the graph schedule, the wave loop and the batch
  tail. gsd-execute.js 1461 -> 441 lines (budget test at 441). Parity over all 875 fake-host runs: agent calls, shell
  calls and their order, logs and results identical; a run started by the previous script resumes under the new one.
  Measured check: tests/thin/TS1*, full offline suite 2431: 2417 pass, 1 known load flake (F02, passes alone), 13
  skipped; not run on a live phase.

- Kit feedback 89-101 from the first live runs on the reworked kit (owner 2026-10-24: "Có feedback, làm đi"; one Opus
  agent per area, notes in kit-bughunt/fb7/design/). Execute: `state-plan` stores an absolute worktree path inside the
  project root-relative, so `halt clear --resume` works (91), and a halt of an older kit finds its worktree from the
  journal or the worktree list (90); a refused state write is a result warning; `ph gsd commit adopt <N> <sha>
  --reason` records an owner commit so the resume gate accepts it, and the head-moved problem names the files no
  trailer plan owns (94); a wave's shared changes are made before its executors start, already-satisfied ones are
  marked applied without a fixer (95); checker issues accepted by forceProceed are records (`ph gsd accepted
  list|confirm|resolve`) that stop the affected plans before dispatch and reach their executors' briefs (89); log and
  result fixes (96 b, c). Checks: skip markers count only against a file's base content, `adapter.checks.skip_guards`
  names environment guards, the stop names file and line (92). Hand edits: the first scan after an update takes the
  tree as the baseline and files the flow wrote are not hand edits (93). Evidence: each verify command of a task has
  its own step name and a changed command makes only that obligation stale (97); `ph harness lint` warns on empty
  `smoke_builds` when the stack names a build target and `kit.mjs update` lists keys left at their default (96 a).
  Planning: a contract issue goes only to the side that must change, the contract check reruns before a
  REVISION_CONFLICT is acted on, a passing re-check answers `rerun` (100); an outline revision must keep the manifest
  contract in step, and a conflict carrying contract_changes answers `contracts change` (98); an owner answer is a
  decision record (`ph gsd decide <N> --text ... --plans|--outline|--question`) that re-plans only what it names
  instead of a CONTEXT edit that invalidates research and every planner, research Open Questions about scope are asked
  before the outline (stage Discuss), a contract change marks the plans that use it for re-planning, a conflict about
  one plan re-plans only it (`replanPlans`) (99, 101 F3); `outline check` lists test files a verify command runs that
  no plan owns (101). Prompt text: executor, shared-change, planner and checker templates, gsd-plan and gsd-execute
  skills, kit-adapter.md. Measured check: tests/fb7/, full offline suite 2426 (2 V5A assertions updated to the merged
  `decide` answer); not run on a live phase.

- Thinner default composition (follow-up of the 87 rework; owner 2026-10-24: the goal "workflow mặc định mỏng, logic
  nằm trong verb" was only partly met; design kit-bughunt/thin/THIN.md, one Opus agent per stage). The workflow engine
  provides the helpers every gsd script used to copy (`flow`, `gsd`, `run`, `loadCfg`, `call`, `sha`, ..., plus `pool`,
  `slots`, `serialize`, `turnLock` and `renderPrompt`) as globals; the copied block is gone from all nine scripts (a
  script that still defines one keeps its own). Agent prompt texts are kit-owned templates
  `.agents/workflows/prompts/<name>.md` (shipped prompt text; project templates in `prompts/project/`), rendered by the
  flow verb `prompt` (missing variable = error; `{{#x}}`/`{{^x}}` optional parts) and `plan-prompt <kind>`. Deterministic
  decisions moved to pure flow verbs: `exec-*` (args, setup, handoff, records, branch, verdict, request and fixer
  routing, fix-round end and stall rule, review scope, findings, pause, overlap groups) and `plan-*` (args, prompts,
  skeleton issue book, probes, linked plans, reallocation diff, validation). gsd-execute.js 1887 -> 1465 lines,
  gsd-plan.js 1549 -> 1018; tests hold each at its size (the 700-line budget tests stay skipped). Parity: every
  fake-host run (826 for execute, all plan runs) gives the same agent prompts, options, logs and results, except the
  order of concurrent steps of different plans in 13 execute runs (each plan's own order is unchanged); a run started
  by an old script resumes under the new one. Measured check: tests/thin/, full offline suite 2348: 2334 pass, 1 known
  load flake (F02 lock test, passes alone), 13 skipped; not run on a live phase.

- Kit feedback 88 (owner 2026-10-24: "làm cái pause stop luôn đi"; one Opus agent, note kit-bughunt/r87/design/R88.md):
  a clean stop at a wave boundary. Runtime: `ph workflow stop <runId> [--at wave-boundary] [--reason <text>]` writes
  `<runDir>/stop.json` and kills nothing; `ph runs` shows a pending request; a script that returns `paused` ends the run
  with the new status `paused` (run.json, log `next:` line, watch, metrics; `--prune` keeps it). Flow verb
  `stop-requested [runId]`. Default composition: gsd-execute checks before each wave with work left (graph schedule:
  before each plan start; started plans still commit) and takes `stopAfterWave: N`; gsd-plan checks between planner
  waves and before checker rounds 2+; the paused result says the wave reached and answers `rerun`. Batch mode refuses
  `stopAfterWave`; the streams checker join and review streams run to their end. Prompt text: ph, gsd-execute and
  gsd-plan skills. Measured check: tests/r87/R88*, full offline suite; not run on a live phase.

- Kit rework after feedback 87, plus 86 (owner 2026-10-23/24: "Ok mày làm luôn abc đi, cần subagent thì dùng
  opus"; design kit-bughunt/r87/DESIGN.md; one Opus agent per part, notes in kit-bughunt/r87/design/). The kit owns the
  runtime, the verbs and the invariants; each project owns its workflow composition. Composition (A): kit.json lists
  the nine `.agents/workflows/gsd-*.js` scripts as `composition`; update takes the new kit default only for a copy the
  project has not edited and keeps an edited one even with `--force` (status shows it, with the diff command; pull
  still offers it back); `kit.mjs update`, `ph doctor` and `ph harness lint` check that every flow and gsd verb a
  composition calls exists; INTERFACES.md lists the kit verbs as the stable API; `update --force` without
  `--enable-plugin` says the file mod stays unselected. The gsd-* skills are a kit block plus a project section that
  follows the script; `gsd.*` settings are classified as kit settings or composition policies (INTERFACES 4.3) and
  `ph doctor` notes a policy the project's own script no longer reads. Execute state (B, 83 F1/F3, 86):
  `execute-progress.json` has one writer, the `state-*` flow verbs (plan stages, shared changes, requests, integration
  files, answers, smoke), each checking its contract; raw writes are refused; gsd-execute calls them; every needs-owner
  stop carries `answer: {verb, command}`; a request or shared change against a file in `adapter.ownership.regenerated`
  must name its generator (`via`) and every output. Planning state (B for gsd-plan): `plan-progress.json` and the
  `plan-*` verbs hold the checker, contract, reallocation and recheck bookkeeping; every gsd-plan stop names its
  answer; resume per stage. Invariants (C): `check-weakening` runs inside every gate: a deleted test file, fewer test
  declarations, fewer assertions, an added skip or a changed gate command since the base stops the run at stage
  `Checks` unless the plan declares it in `<check_changes>` or the owner answers `ph gsd allow <phase> --path <p>
  --reason <r>` (`adapter.checks`, on by default, stack defaults for Dart, TS/JS, Python, Go, Rust, Java). Self-repair
  boundary (`self_repair`, on by default): agents a workflow run started cannot write `.agents/`, `.claude/`,
  `AGENTS.md`, `CLAUDE.md`, and nobody edits a composition script or the overlay while a run of the project is live;
  harness-evolve has the composition-evolution procedure (evidence, review, lint, history row `composition`, kit pull
  candidate). Item map (D): docs/ITEM-MAP.md maps items 1-87 to the kit test or composition choice that covers them,
  pinned by a test. Prompt text: gsd-* skills, gsd-planner/executor/code-reviewer overlays (check_changes, loosened
  assertion = high finding), harness and harness-evolve skills, kit-adapter.md, ph skill. Measured check: tests/r87/,
  full offline suite on the merge; not run on a live phase.

- Kit feedback 77-85 from the Flutter port, phase 3 execute waves 1-2 (owner 2026-10-23: "coi feedback xong fix
  tiếp"; every item verified against 41b7117 first, kit-bughunt/fb6/VERIFY.md; one Sonnet 5.5 agent per area, design
  notes in kit-bughunt/fb6/design/). Resume (78, 83 F2): gsd-execute seeds its integration files from
  execute-progress.json, saves them before the integration fixer runs, and the resume gate reconciles an unrecorded wave
  commit holding integration files; one resume test per stop point (after code, transfer, shared, gate, review).
  Unowned paths (77, 80; `gsd.unowned_outside_roots`, default `report`, `stop` is the old rule): a main-tree change
  outside every plan's owns and outside `adapter.ownership.source_roots` is listed in `outsideRoots`, left out of the
  wave commit and no longer stops the run; a path inside the roots still stops, with "commit them separately" as the
  first option; an ownerless tracked file whose only change is line endings is listed in `eolOnly`, never a stop or a
  commit; kit-adapter.md states the EOL contract. Executor (79; `gsd.pending_request_tasks`, default true): task status
  `pending-request` with `blockedBy`, accepted when every path is a request the plan routed; a partial task waiting
  only for routed requests is no owner decision; `ph gsd halt clear --resume` transfers a halted plan's finished
  worktree instead of re-dispatching it; executor observations about the kit go to `kitNotes`, and a request against
  a kit-feedback document is refused into a kit note. Shared step and requests (82, 85, 83 F3; `gsd.request_check`
  auto|tree|off, default `auto`): the shared fixer reports per change and a change it reports applied counts whatever
  the status, its brief bounds checks to the shared files and leaves other failures to the gate; before Commit an open
  request closes when its path changed since the request, when a shared change to that path was applied or cleared,
  or when one read-only resolver finds it present; new verbs `ph gsd shared.clear` and `ph gsd request.clear`, and
  every owner answer (halt, shared, request) goes to owner-answers.json, is logged by the next run and counted by
  `ph review-stats`. Hooks (84): `ph doctor` reports a problem per registered batch-writer MCP server while the file mod
  is off, `kit.mjs install|update` without `--enable-plugin` print that and the hook consequence, and syntax_check
  matches any `mcp__*__(edit|write)_multiple_files`. Stack commands (81; `adapter.command_probes`, default []):
  kit-adapter.md requires every command the stack skill prescribes to be an `adapter.commands` entry or a real wrapper
  subcommand, one sanctioned invocation per tool sharing one pinned SDK; `ph harness lint` runs the probes (fails on a
  rejected command) and warns for a prescribed `node <wrapper> <sub>` no probe or command covers. Prompt text:
  gsd-executor overlay, gsd-execute executor/shared/fixer/resolver prompts, skills gsd-execute, harness reference
  kit-adapter.md, hook syntax_check. Measured check: tests/fb6/ (each test fails before its change), full offline
  suite 2167: 2156 pass, 0 fail, 11 skipped; not run on a live phase.

- Kit feedback 67-76 from the Flutter port, phase 3 planning and wave 1 (owner 2026-10-23: "verify bug rồi sửa lại kit
  cho phù hợp", "giao cho con sonnet 5.5 fix"; every item verified against 0709747 first, kit-bughunt/fb5/VERIFY.md;
  one Sonnet 5.5 agent per area, design notes in kit-bughunt/fb5/design/). Contracts (67, 76 F1; `gsd.contract_check`,
  default true): manifest `produces` may be structured `{symbol, kind, file, signature}` (free text still parses, with a
  warning); `ph gsd verify contracts <phase>` checks that producers write the manifest signature, consumers quote it,
  superseded signatures are gone, consumes edges resolve and every `key_links` `requires` (ancestor widget, provider
  override, registration) is provided by a plan of the same or an earlier wave; gsd-plan runs it after each planner
  wave, after the checker and plan review and at handoff, outside the checker cap; revisers see their manifest entry
  and the consumers of each produced symbol and answer a signature change with CONTRACT_CHANGE, which updates the
  manifest and revises the consumers; each execute gate checks produced symbols exist at their declared file. Hand
  edits (68): `ph gsd hand-edit scan|record|list`; gsd-plan and gsd-execute list plans, artifacts and owned files
  changed outside the flow in `handEdits`; `ph review-stats` counts hand fixes per cause and names a cause seen twice
  as a kit defect candidate. File count (69): `gsd.files_per_plan` (default null: today's 10/15 rule); `outline check`
  applies it to manifest owns before skeleton review; `gsd.checker_reallocate` (default 0) sends plans the checker
  finds too large back to the outline stage. VALIDATION.md (70; `gsd.validation_strategy`, default true): gsd-plan
  renders `<NN>-VALIDATION.md` from the upstream template and the research's Validation Architecture section (upstream
  plan-phase step 5.5, dropped in the port) and tells the checker when Dimension 8 is skipped. forceProceed (71) takes
  `issues: [{plan, dimension}]`; other issues are still revised and accepted ones go to STATE one per line; the old
  `{reason}` form keeps its meaning with a warning. Plan review (72; `gsd.plan_review_check`, default `resolve`, `fresh`
  is the old cycle): after an edit a resolution check of the open issues plus a finder bounded to the changed text; the
  stop counts fixed, still-open and new issues separately. `revisions record` without `--settings` (73) reuses the
  key's earlier settings digest. Owns (74): one grammar for checker, transfer, gate and resume gate; globs are matched
  (a literal path beats a glob, a glob beats a directory); globs in files_modified and unbalanced globs are blockers.
  Worktrees (75): transfer records carry the worktree hash; a worktree whose changes all landed is `transferred` and
  removed after its plan's commit and by `ph worktrees --prune`; a halted plan's worktree stays until it is
  re-dispatched; every removal unlinks all links and junctions inside the tree without following them and refuses
  when one cannot be unlinked; execute and `ph doctor` report leftovers. Re-check (76 F2; `gsd.checker_recheck`,
  default `full`): `incremental` runs the checker agent only on changed and linked plans and none after an
  owns/files-only edit. Prompt text: gsd-planner overlay, gsd-plan planner/outline/reviser prompts, plan-review
  prompts, skills gsd-plan, gsd-execute, ph, harness references kit-adapter.md and paseo-runtime.md. Measured check:
  tests/fb5/ (each test fails before its change), full offline suite on the merge; not run on a live phase.

- Kit feedback 64-67 from the Flutter port: independent and parallel flows, each behind a `gsd` switch whose default
  keeps today's behaviour (owner 2026-10-23; one Opus agent per area, design notes in kit-bughunt/fb4/design/).
  `gsd.plan_flow: streams` (65, 67; default `staged`): each plan gets its own review stream (per-plan lenses, judge,
  edit, a resolution check of only its findings) as soon as its planner finishes, streams run in parallel under
  `max_subagents`, a clean plan is frozen, the next outline wave is planned on reviewed plans, one phase-wide checker on
  the frozen set is the join and sends cross-plan issues only to the plans they name, and a revised plan whose declared
  interface changed re-checks the plans that depend on it. `gsd.execute_schedule: graph` (66.1-2; default `waves`,
  per-wave mode only): a plan starts when the plans it depends on (depends_on, owns or file overlap, earlier tracers)
  are committed, its own obligations gate, review, fix and resolution run per plan, the repo-wide suite and commits go
  through one queue. `gsd.map_mode: per-focus` (66.3; default `whole`): each map focus checks, reviews, fixes and stamps
  on its own; a failing focus reruns alone; one docs commit joins them. `gsd.verify_mode: per-criterion` (66.4; default
  `phase`): one verifier per success criterion plus a phase unit, merged by `ph gsd verification merge`; only criteria
  that need a human go to UAT. `gsd.research_ahead` (66.5; default false): research of a later phase may run while the
  current phase executes; it is `provisional` until the phases it is ahead of complete, then `code-stale` asks for
  `refresh: "code"` of its `## Code APIs` part. `gsd.review_metrics` (64; default true, records only): skeleton review,
  plan review and checker findings are recorded with class and fate per run (`<phaseDir>/prereview/`), confirmed code
  findings carry `plan-catchable`, plan-defect halts, gate failures and fixer rounds are counted, and `ph review-stats
  --stage skeleton|plan|code` prints cost per confirmed finding and escapes per stage. Prompt text: finding-verifier,
  gsd-plan-checker and gsd-verifier overlays, skills gsd-plan, gsd-execute, gsd-map-codebase, gsd-verify, gsd-research,
  gsd-discuss, ph, harness references. Measured check: tests/fb4/ (main path, failure and resume per mode; defaults
  unchanged), full offline suite; no mode run on a live phase yet.

- Kit feedback 57-63 from the Flutter port, phase 2 verify, map and evolve (owner 2026-10-23). Verify (58, a bug since
  the 2026-10-20 integration, narrowed but not closed by G076): per-wave execute ends with one more gate over every
  plan of the run (`batch-<n>.json`), the only evidence it returns, because a wave's gate goes stale once a later wave
  edits the same files; a red phase gate stops with the waves still tracked. Gate evidence hashes only
  `adapter.commands` and `adapter.verify_vocabulary`, so a kit update or another adapter key no longer stales it; an
  owned file edited after the gate still does. Smoke build at execute (57): the first wave that changes a file matching
  `adapter.smoke_triggers` (default: dependency manifests and lock files of common stacks) builds
  `adapter.commands.smoke_builds` once per phase before its gate. Map (59-61): map-check's message names a `## Checked,
  Not Bugs` section for refuted claims; a review fix reply must name every doc with a finding and nothing outside its
  focus (the project hotfix, made the kit's rule); review round 2 checks only the round-1 findings, an incremental map
  reviews only its paths, new claims go to a findings list instead of blocking the stamp, the round-2 prompt carries
  the docs' digest; the ph skill says a hotfixed workflow script resumes with `--resume <run> --name <workflow>`.
  Update safety (62): `kit.mjs update` and `ph doctor` run the gsd workflow argument checks (skeleton lane lenses) on
  the merged overlay. Item 63 (synthesis) is covered by 54-56 (already in), 58, 60 and 61. Measured check:
  tests/fb3/ (each failing before its change; F58 also pins that an edit after the phase gate is stale), full offline
  suite 1905 pass / 0 fail / 11 skipped; not run on a live phase.

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
