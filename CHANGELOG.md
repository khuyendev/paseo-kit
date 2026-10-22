# Changelog

Every change to shipped prompt text (the AGENTS.md block, skill texts, agent definitions and overlays, workflow lenses
and overlays, watchdog steering texts) lands with an entry here that names the owner's approval and date, the decision
and the measured check (HARN-15). `node kit/release-check.mjs [<range>]` checks this file against `kit.json`.

## [Unreleased]

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
