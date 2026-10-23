# Kit feedback item map (items 1-87)

The regression list for later kit changes (kit feedback #87, DESIGN part D). Every owner feedback item from the Flutter
port (`docs/kit-feedback.md` of that project, items 1-87) is mapped to what covers it in the kit and the tests that pin
it. Before a kit change that touches a module named here, run the tests of its rows; a change that makes one of them
fail reopens that item. Base: kit main 3c00968 (items 1-85 fixed, CHANGELOG [Unreleased]).

## How to read a row

- **Status**:
  - `covered`: a kit verb, invariant, runtime part, installer/doctor check or kit prompt text holds the fix, and a test
    pins it.
  - `composition`: the fix is a step or a `gsd.*` switch of a shipped workflow script (`.agents/workflows/gsd-*.js`).
    The tests run the kit's default script, so they pin the kit default only; a project that edits its copy of that
    script owns keeping the behaviour (see Gaps, "Fixes that live only in a composition").
  - `partial`: part is covered (tests named), the rest is open and named in the notes and under Gaps.
  - `open`: nothing in the kit covers it yet; the notes name the r87 part that works on it.
  - `superseded`: replaced by the item or rule the notes name.
  - `synthesis`: an analysis item; covered by the items it names.
- **Layer**: `verb` (a `ph gsd` verb or a `gsd-flow.mjs` flow verb and its record), `invariant` (a rule no composition
  can switch off: resume gate, owns grammar, gate evidence, hooks), `runtime` (`ph workflow` engine, runner, `ph`
  commands), `install` (`kit.mjs`, `ph doctor`, `ph harness lint`), `prompt` (kit agent definitions, overlays, skills),
  `composition` (workflow script step or switch).
- **Tests**: `` `tests/<file>.test.mjs:<tag>` ``, where `<tag>` is part of the title of the test(s) that pin the item;
  no tag means the whole file is about the item. `tests/r87/RD-item-map.test.mjs` fails when a named file is missing,
  a tag matches no test title of its file, an item is missing or doubled, or a covered row names no test.

## Map

| # | Item | Status | Layer: kit part | Tests | Notes |
|---|---|---|---|---|---|
| 1 | Lock refusal blames a "debug session" | covered | runtime: `workflows/lib/flow-files.mjs` lease records the holder's workflow; refusals name it | `tests/gsd-flows/bughunt-execute.test.mjs:G020`, `tests/bughunt/F02.test.mjs:refusal names` | Lease names kept (`debug` = code root, `phase-NN`); the message names the holder kind instead of a rename. |
| 2 | No pipelining across phases | covered | runtime + composition: gsd-plan holds only `phase-NN`; execute holds `phase-NN` + code root; `ph gsd commit` takes the git writer lock | `tests/bughunt/F02.test.mjs` | |
| 3 | Instruction-file edit invalidates all research | covered | verb: `harness/gsd/revisions.mjs` keys hash what each judgement reads (G053) | `tests/bughunt/G053.test.mjs` | Owner decision 2026-10-23: PROJECT.md and adapter instruction edits still change research, as GSD does (test "adapter instruction edits still change research"); warn/accept-stale not built. |
| 4 | Researcher output rejected after the paid run | covered | verb + prompt: `ph gsd research status` self-check the researcher runs before replying; blockers and reasons reach the owner | `tests/bughunt/G049.test.mjs` | |
| 5 | Hidden role names | covered | prompt/docs: role catalog INTERFACES.md 4.2, linked from the gsd-plan and ph skills, checked against the workflows' role literals | `tests/bughunt/G207.test.mjs` | `ph config --roles` was not built (catalog chosen, G207 fix note); see Gaps. |
| 6 | Run result `roles` table incomplete | covered | runtime: engine lists every role with resolved model/effort, lanes apart | `tests/bughunt/G139.test.mjs` | |
| 7 | Lanes added later skip a passed skeleton | covered | verb: skeleton revision keyed on the lane set and lens texts | `tests/bughunt/G009.test.mjs` | |
| 8 | Discuss is interactive-only | covered | prompt: delegated discuss mode in the gsd-discuss skill and workflow overlay | `tests/bughunt/G202.test.mjs` | Doc tests only (the mode is orchestrator behaviour). |
| 9 | One plan's checker cap stops the phase | composition | gsd-plan.js checker loop: cap, stall and override per plan | `tests/bughunt/G013.test.mjs` | |
| 10 | `ph gsd commit --help` rejected | covered | runtime: `--help`/`-h` on every ph and gsd verb | `tests/bughunt/G153.test.mjs` | |
| 11 | Windows `.bat`/`.cmd` adapter commands need a wrapper | covered | runtime: `harness/lib/proc.mjs` runArgv resolves PATHEXT (`.cmd`/`.bat`, `.ps1` hooks); kit-adapter.md section 4 line | `tests/bughunt/G164.test.mjs` | Three of its tests run on win32 only. |
| 12 | Monitor filter `^...` saw no lines [UNVERIFIED] | covered | runtime + prompt: watch-run line set and `[last4] ` run prefix documented in the ph skill; stop reasons reach the watch line | `tests/bughunt/G159.test.mjs` | The original report was unverified; the docs now state the prefix that broke `^`. |
| 13 | A warning-only checker issue stops the phase | composition | gsd-plan.js / gsd-quick.js: only blockers revise, stall or cap; warnings carried | `tests/bughunt/G004.test.mjs` | |
| 14 | Reviser edited RESEARCH.md for a RESOLVED marker | covered | prompt + verb: checker dimension 11 lets a plan resolve a research question (gsd-plan-checker); RESEARCH provenance out of the inputs key | `tests/bughunt/G026.test.mjs`, `tests/bughunt/G053.test.mjs:research attempt record` | |
| 15 | No completion signal to the caller | partial | runtime: `ph watch-run --quiet` prints only the ending line (the documented quiet wait) | `tests/bughunt/G127.test.mjs` | `ph workflow --detach --notify` (one message to the caller) not built; see Gaps. |
| 16 | Plan review out of cycles drops its last findings | composition | gsd-plan-review.js: last edit re-found, stop returns kept issues and per-cycle counts | `tests/bughunt/G040.test.mjs`, `tests/fb2/F46.test.mjs` | |
| 17 | Plan review convergence zero-tolerance | composition | gsd-plan-review.js converges on high only, carries medium/low, cap by trend; `gsd.plan_review_check` (default `resolve`) | `tests/bughunt/G038.test.mjs`, `tests/bughunt/G039.test.mjs`, `tests/fb5/P72.test.mjs` | |
| 18 | Plan-review edits not recorded, next run re-plans | composition | gsd-plan-review.js records `plan:<id>` through `ph gsd revisions record` after the structure check | `tests/bughunt/G031.test.mjs`, `tests/fb2/F47.test.mjs` | |
| 19 | No settled-decision exemption for one-way tasks | partial | verb: `harness/gsd/plan-checks.mjs` accepts `decision="D-NN"` settled in CONTEXT; composition: forceProceed `{issues}` | `tests/bughunt/G007.test.mjs`, `tests/fb5/P69-flow.test.mjs:forceProceed` | The item's second point is open: the gsd-plan planner stop offers "answer and rerun with the same args" with no answer channel; see Gaps. |
| 20 | Checker revisions lost on interruption; scope_sanity recurs | composition | gsd-plan.js records each plan when its reviser returns; warnings carried; verb: file line scales (plan-checks.mjs), `gsd.files_per_plan` | `tests/bughunt/G015.test.mjs`, `tests/bughunt/G004.test.mjs`, `tests/bughunt/G005.test.mjs`, `tests/fb5/P69-verbs.test.mjs` | |
| 21 | Shared-change timing in plan waves | covered | verb: `ph gsd handoff` carries each plan's `<shared_changes>` in its execution wave; composition: one integration fixer per wave before the gate | `tests/gsd-flows/bughunt-execute.test.mjs:G083`, `tests/gsd-flows/bughunt-execute.test.mjs:G089` | |
| 22 | Pinned package versions not resolvable together | covered | verb: optional `adapter.dependency_probe` over structured dependency lines; composition: gsd-plan stops at Dependencies | `tests/bughunt/G022.test.mjs` | Off unless the project sets a probe. |
| 23 | Orchestrator note blocks the execute commit | covered | invariant: `adapter.ownership.ignore` paths are no plan output (owned-changes, resume gate) | `tests/gsd-flows/bughunt-execute.test.mjs:G085`, `tests/fb6/Q77-unowned.test.mjs:F77` | Item 77 adds the source-roots rule. |
| 24 | Orchestrator commit between runs trips safe-resume | covered | invariant: resume gate accepts a commit touching no plan-owned file | `tests/gsd-flows/bughunt-execute.test.mjs:G085` | |
| 25 | Red project-wide gate fixed by every plan's fixer | composition | verb: `flow-gate.mjs` attributes a failure to the plan owning the file it is reported at; composition: fixers get only their failures, unplaced failures go to an integration fixer | `tests/fb2/F51.test.mjs`, `tests/gsd-flows/bughunt-execute.test.mjs:G064` | G064 pins batch mode; F51 pins the per-wave case. |
| 26 | Tool-regenerated and scratch files halt the transfer | covered | verb: transfer drops `adapter.ownership.regenerated` and line-ending-only changes outside owns; prompt: executors delete scratch files | `tests/bughunt/G090.test.mjs` | |
| 27 | A HALT record can never clear itself | covered | verb: `ph gsd halt clear <N> --plan --reason` (+ `--resume`, item 79) | `tests/gsd-flows/bughunt-execute.test.mjs:G055`, `tests/fb6/Q79.test.mjs:Q79 F3` | |
| 28 | Gate result stale when the run stops; `remove` reads stdin | composition | gsd-execute fix rounds judge an unresolved fixer on a fresh gate; verb: flow verbs read stdin only when they take input | `tests/gsd-flows/bughunt-execute.test.mjs:G088` | |
| 29 | Nested owns make reruns ambiguous | covered | invariant: resume gate picks the most specific owner (`flow-owns.mjs` specificOwners); verb `gsd-flow adopt` | `tests/gsd-flows/bughunt-execute.test.mjs:G079`, `tests/fb2/F54.test.mjs` | |
| 30 | Main-tree fixer fails the wave for others' failures | composition | gsd-execute fix rounds: fresh gate before stopping; fixer gets only its own failures | `tests/gsd-flows/bughunt-execute.test.mjs:G066`, `tests/fb2/F51.test.mjs:only the failures` | |
| 31 | KIT HOTFIX: resumeGate most-specific owner | superseded | invariant: the hotfix became the kit rule (G079) on normalized owns; item 74 made one owns grammar | `tests/gsd-flows/bughunt-execute.test.mjs:G079`, `tests/fb5/P74.test.mjs:specificity` | |
| 32 | Dead orchestrator turns a resolution check into "unresolved" | partial | composition: a resolution call that returns nothing fails with a resume hint, never a verdict | `tests/gsd-flows/bughunt-execute.test.mjs:G126` | "A detached run should not depend on the launching agent staying alive" is open; see Gaps. |
| 33 | `--resume` after a Review stop pays for the whole review | composition | verb: review records stamped and replayed, stage digest ignores the run's records and HEAD; composition: rerun runs only the resolution check | `tests/gsd-flows/bughunt-execute.test.mjs:G080`, `tests/fb6/Q77-resume.test.mjs:stop after the review` | |
| 34 | Partly-fixed Review stop has no cheap close-out | composition | gsd-execute: one more fixer pass limited to unresolved findings; after a hand fix the rerun runs only the resolution check | `tests/gsd-flows/bughunt-execute.test.mjs:G080` | |
| 35 | Owns violation found only at Commit | composition | gsd-execute: owned-changes check after transfer, before gate and review; prompt: fixers return out-of-owns edits as requests | `tests/gsd-flows/bughunt-execute.test.mjs:G070`, `tests/gsd-flows/bughunt-execute.test.mjs:G060` | |
| 36 | No path for a sharedChange raised mid-phase (hotfix) | partial | composition: requests no open plan owns and `<shared_changes>` are made by the integration fixer and committed with the wave (no trailer exemption); verb `ph gsd shared clear` | `tests/gsd-flows/bughunt-execute.test.mjs:G089`, `tests/fb6/Q82.test.mjs:Q82 F3` | The plan-time check "a whole-project obligation in a plan whose owns cannot reach its files" is not in the kit (the project's own `ownership-reach` lens does it); see Gaps. |
| 37 | 15-file line hits every tracer plan | composition | `gsd.tracer_extra_files`; gsd-plan.js runs phase-level revisions before a per-plan REVISION_CONFLICT stop | `tests/fb2/F37.test.mjs`, `tests/fb5/P69-verbs.test.mjs:tracer` | |
| 38 | Greenfield project never gets a codebase map | covered | verb: `ph gsd phase complete` proposes gsd-map-codebase (and harness) | `tests/fb2/F38.test.mjs` | |
| 39 | Detached runners die silently | partial | runtime: runner records its exit reason in run.json and log.txt; watch-run prints the resume command | `tests/fb2/F39.test.mjs` | Root cause of the silent Windows `--detach` deaths not found (external kill suspected, F39 notes) [UNVERIFIED]; see Gaps. |
| 40 | Re-outline with no visible input change | covered | verb: `revisions check` names the changed part; composition: forceProceed refused on plans the same run wrote | `tests/fb2/F40.test.mjs` | |
| 41 | Map states bugs it did not check | covered | verb: map-check needs `Status: verified` + Evidence or `suspected` | `tests/fb2/F41.test.mjs:map check rejects`, `tests/fb3/FMAP.test.mjs:FMAP-59` | |
| 42 | First adapter had no stack review lens | covered | verb: `phase complete` proposes the harness pass while no review lens exists | `tests/fb2/F38.test.mjs:review lens` | |
| 43 | gsd-map-codebase never checks what mappers wrote | composition | gsd-map-codebase.js review stage (agent `gsd-map-reviewer`, read-only), findings back to the mapper once | `tests/fb2/F41.test.mjs:review:` | |
| 44 | Checker not repeatable; cap loses blockers | composition | gsd-plan.js carries still-open blockers ("still open?") until a checker resolves them | `tests/fb2/F44.test.mjs` | |
| 45 | Owner wants to change models during a run | covered | runtime: tier resolved at each `agent()` call; live retier of running agents; `ph model` | `tests/fb2/F45.test.mjs`, `tests/fb2/F45B.test.mjs` | F45B runs on the fake daemon only. |
| 46 | "Did not converge" when the last cycle fixed everything | composition | gsd-plan-review.js: post-edit pass, per-cycle counts; `gsd.plan_review_check` resolve | `tests/fb2/F46.test.mjs`, `tests/bughunt/G038.test.mjs`, `tests/fb5/P72.test.mjs` | |
| 47 | Plan review edits not recorded | composition | gsd-plan-review.js records each edited plan that passes plan-structure | `tests/fb2/F47.test.mjs`, `tests/bughunt/G031.test.mjs` | Same fix as 18. |
| 48 | Inputs hash includes ROADMAP wave headers | covered | verb: `revisions.mjs` hashes the ROADMAP section without the `gsd:dependencies` block | `tests/bughunt/G053.test.mjs:dependency block` | |
| 49 | Executor worktrees lack git-ignored inputs | covered | install: `ph doctor` and `ph harness lint` list git-ignored paths the adapter uses that `worktree_setup` misses; verb `halt clear` | `tests/fb2/F49.test.mjs`, `tests/gsd-flows/bughunt-execute.test.mjs:G055` | |
| 50 | Verification target never smoke-built | covered | verb `ph gsd check smoke` over `adapter.commands.smoke_builds`; composition: gsd-plan Smoke build stage | `tests/fb2/F50.test.mjs` | Off unless the project declares targets. |
| 51 | Owner's fix stranded when a non-owner fixer blocks | composition | gsd-execute transfers every fixer's owned changes and re-gates before an owner decision; verb: per-file failure attribution | `tests/fb2/F51.test.mjs` | |
| 52 | Compact reminder threshold not visible | covered | runtime: `ph context --self` prints the reminder threshold and distance | `tests/fb2/F52.test.mjs` | |
| 53 | Review finding needs a committed plan's file | covered | verb `ph gsd grant`; composition: the Fix stop offers the grant | `tests/fb2/F53.test.mjs` | The fixer-cap half is item 55. |
| 54 | Hand fix to a multi-owner file: "ambiguous owner" | covered | invariant: resume gate tie-break by the latest transfer record; verb `gsd-flow adopt` | `tests/fb2/F54.test.mjs:kit-feedback 54` | |
| 55 | Fixer stops "unresolved" without rerunning its last edit | composition | gsd-execute fixer prompt (one more run past the cap) and `lastEdit` in the stop | `tests/fb2/F55.test.mjs` | |
| 56 | Run's own review fixer makes the run unresumable | covered | invariant: resume gate tie-break by the latest transfer record | `tests/fb2/F54.test.mjs:kit-feedback 56` | |
| 57 | Release target first built after the last wave | composition | gsd-execute smoke build on the first wave changing `adapter.smoke_triggers`; verb `check smoke` | `tests/fb3/F57.test.mjs` | |
| 58 | Verify never sees current evidence | covered | invariant: evidence config hash covers `adapter.commands` + `verify_vocabulary` only; composition: execute ends with one phase-wide gate | `tests/fb3/F58.test.mjs`, `tests/gsd-flows/bughunt-execute.test.mjs:G076` | |
| 59 | Map check rejects the old refuted-bug format | covered | verb: map-check message names `## Checked, Not Bugs`; prompt: mapper overlay | `tests/fb3/FMAP.test.mjs:FMAP-59` | |
| 60 | Map review fix rejects a correct partial fix (hotfix) | composition | gsd-map-codebase.js: a fix reply names the docs with findings; prompt: ph skill `--resume <run> --name` | `tests/fb3/FMAP.test.mjs:FMAP-60` | The project hotfix became the kit rule. |
| 61 | Map review does not converge | composition | gsd-map-codebase.js: round 2 = resolution check, new claims to a findings list, incremental paths, doc digest in the prompt | `tests/fb3/FMAP.test.mjs:FMAP-61` | |
| 62 | Kit update leaves overlay values the new kit rejects | covered | install: `kit.mjs update` and `ph doctor` run the workflow argument checks; CHANGELOG-named overlay keys listed | `tests/fb3/F62.test.mjs` | |
| 63 | Synthesis after phase 2 | synthesis | covered by 53, 54-56, 58, 60, 61, 62 (and the answer verbs of 82, 85) | `tests/fb2/F54.test.mjs`, `tests/fb3/F58.test.mjs`, `tests/fb3/FMAP.test.mjs`, `tests/fb3/F62.test.mjs` | |
| 64 | Pre-code reviews unmeasured | composition | `gsd.review_metrics` (default true, records only); verbs `prereview-record`, `ph review-stats --stage` | `tests/fb4/O64.test.mjs`, `tests/fb4/O64-streams.test.mjs` | |
| 65 | Independent review-and-fix stream per plan | composition | `gsd.plan_flow: streams` (default `staged`) | `tests/fb4/O65.test.mjs`, `tests/fb4/O65-67.test.mjs` | Default off. |
| 66 | Other flows independent and parallel | composition | `gsd.execute_schedule: graph` (66.1-2), `gsd.map_mode: per-focus` (66.3), `gsd.verify_mode: per-criterion` (66.4), `gsd.research_ahead` (66.5) | `tests/fb4/O66A.test.mjs`, `tests/fb4/O66B.test.mjs`, `tests/fb4/O66C.test.mjs`, `tests/fb4/O66D.test.mjs` | All default off. |
| 67 | Cross-plan contracts drift | covered | verbs `ph gsd verify contracts`, `contracts change` (one writer); composition: gsd-plan runs the gate after each step (`gsd.contract_check`, default true); F4 under `plan_flow: streams`; F5 in the wave gate | `tests/fb5/P67.test.mjs`, `tests/fb5/P67-flow.test.mjs`, `tests/fb4/O65-67.test.mjs` | |
| 68 | Orchestrator hand edits invisible to the kit | covered | verbs `ph gsd hand-edit scan, record, list`; `ph review-stats` hand-fix counts; composition lists them in the result | `tests/fb5/P68.test.mjs:hand` | |
| 69 | File-count blocker after the allocation is frozen | covered | verb: `outline check` applies `gsd.files_per_plan`; composition: `gsd.checker_reallocate` (default 0) | `tests/fb5/P69-verbs.test.mjs`, `tests/fb5/P69-flow.test.mjs:checker_reallocate` | |
| 70 | gsd-plan never writes VALIDATION.md | covered | flow verb `validation-strategy` (single writer); composition step (`gsd.validation_strategy`, default true); port check | `tests/fb5/P70.test.mjs`, `tests/fb5/P70-port.test.mjs` | |
| 71 | forceProceed accepts every stuck issue | composition | gsd-plan.js forceProceed `{reason, issues}`; others still revised; accepted ones to STATE | `tests/fb5/P69-flow.test.mjs:forceProceed` | |
| 72 | Plan review judges convergence by counts | composition | `gsd.plan_review_check: resolve` (default): resolution check + bounded finder | `tests/fb5/P72.test.mjs` | |
| 73 | `revisions record` misses the settings digest | covered | verb: `revisions record` without `--settings` reuses the key's earlier digest | `tests/fb5/P68.test.mjs:settings digest` | |
| 74 | A glob in owns passes checks, then refuses its transfer | covered | invariant: one owns grammar (`flow-owns.mjs`) for checker, transfer, owned-changes, gate and resume gate | `tests/fb5/P74.test.mjs` | |
| 75 | Executor worktrees never removed | covered | runtime + verb: landed records, `discard-worktree`, `ph worktrees --prune`, link-safe removal, doctor leftovers | `tests/fb5/P75.test.mjs` | |
| 76 | Full fresh checker after any edit; preconditions | composition | F1 verb: `key_links` `requires` in `verify contracts`; F2 `gsd.checker_recheck: incremental` (default `full`); link walk never enters a reparse point | `tests/fb5/P67.test.mjs:76 F1`, `tests/fb5/P69-flow.test.mjs:incremental`, `tests/fb5/P75.test.mjs:F4` | F2 is off by default. |
| 77 | Orchestrator note outside source roots stops the wave | composition | `gsd.unowned_outside_roots` (default `report`) with `adapter.ownership.source_roots` | `tests/fb6/Q77-unowned.test.mjs:F77` | Without `source_roots` (kit default) every unowned path still stops. |
| 78 | Resumed execute forgets integration files | composition | gsd-execute.js seeds integration files from execute-progress.json | `tests/fb6/Q77-resume.test.mjs:F78` | Moves into the typed state verbs of part B (`state-read`). Recurrence in 86 ran on the older kit. |
| 79 | Partial task on a routed request halts the wave | composition | prompt + composition (gsd-execute.js ownerDecision): `pending-request` task status (`gsd.pending_request_tasks`, default true), kitNotes; verb `halt clear --resume` | `tests/fb6/Q79.test.mjs` | |
| 80 | Fixture generation makes EOL-only changes | covered | verb: owned-changes lists `eolOnly` (never a stop or commit), transfer drops them (G090); kit-adapter.md EOL contract | `tests/fb6/Q77-unowned.test.mjs:F80`, `tests/bughunt/G090.test.mjs:line-endings` | The generator's write policy is project code. |
| 81 | Stack skill promises Dart commands through a Flutter-only wrapper | covered | install: `adapter.command_probes`, `ph harness lint` runs probes and warns on uncovered prescribed commands | `tests/fb6/Q81.test.mjs` | The wrapper itself is project code. |
| 82 | Shared-change step stops on a failure it does not own | composition | gsd-execute applies per reported change, bounds the brief; verb `ph gsd shared clear` | `tests/fb6/Q82.test.mjs:Q82 F1`, `tests/fb6/Q82.test.mjs:Q82 F2`, `tests/fb6/Q82.test.mjs:Q82 F3` | Moves into `state-shared` in part B. |
| 83 | Synthesis, phase 3 execute (F1-F3) | partial | F2: one resume test per stop point; F3: typed answer verbs for halt, shared, request and owner-answers.json | `tests/fb6/Q77-resume.test.mjs:F83`, `tests/fb6/Q82.test.mjs:83 F3` | F1 (completion contracts as verbs) is open in part B; F3 is open for the stops without an answer path; see Gaps. |
| 84 | Hooks bypassed when the file mod is off | covered | install: doctor problem per registered batch-writer server, install/update warning; invariant: syntax_check matches any `*_multiple_files` writer | `tests/fb6/Q84.test.mjs` | Addendum in 86 is open (part A). |
| 85 | Satisfied cross-plan requests deadlock the commit | composition | gsd-execute request check before Commit (`gsd.request_check`, default `auto`); verb `ph gsd request clear` | `tests/fb6/Q82.test.mjs:Q82 85` | Moves into `state-request` in part B. |
| 86 | Follow-ups to 78, 79, 84; requests against generated files | partial | 78 and 79 recurrences: covered by Q77/Q79 (the runs used the kit installed 2026-10-23T10:01Z, before 3c00968) | `tests/fb6/Q77-resume.test.mjs:F78`, `tests/fb6/Q79.test.mjs:Q79 F1` | Open: `via`/`outputs` on requests and shared changes against generated files (part B); `update --force` without `--enable-plugin` says the mod stays unselected (part A). |
| 87 | Kit = verbs and invariants, project = composition | open | r87 parts A (composition parts, verb check), B (typed execute state verbs), C1 (check-weakening), C2 (self-repair boundary); D is this map | `tests/r87/RD-item-map.test.mjs` | The other parts' tests are added to these rows when they merge. |

## Gaps

Items, or parts of items, that no kit test pins, and defects found while mapping. Evidence is at base 3c00968.

1. **Needs-owner stops without an answer path (83 F3, DESIGN B3).** `gsd-execute.js` has 45 needs-owner stop sites;
   21 of them carry no `options` and name no answer verb in their text: lines 823, 873, 901, 906 (Gate), 952, 961,
   1054, 1058, 1148 (Review), 1183 (Gate), 1230, 1275 (Commit), 1421, 1557 (Gate), 1566 (Review), 1612, 1703 (Gate),
   1707, 1754 (Review), 1779, 1784 (Gate). Some are "fix the tree and rerun" by nature (a red gate), but the stop does
   not say so, and no test checks that every stop has an answer path. Open in part B (B3).
2. **The gsd-plan planner stop has no answer channel (19, second point).** `gsd-plan.js:359` (`ownerStop`, used for
   REVISION_CONFLICT, CHECKPOINT REACHED and the other planner markers) offers "answer and rerun with the same args",
   but gsd-plan reads no answer: its arguments are `phaseDir, plan, mode, replan, force, forceProceed,
   reviewGuidance, skipResearch, researchSkipReason, ...` and it reads no answers file for planner markers (only the
   discuss anti-pattern answers). The owner's real channels are a CONTEXT decision or `forceProceed {issues}`; the
   first option names neither. DESIGN B3 and C3 cover gsd-execute only. No test.
3. **Requests and shared changes against generated files (86).** No `via`/`outputs` in the request or shared-change
   schema; the shared step does not refuse a generated target. Open in part B.
4. **`update --force` without `--enable-plugin` (84/86 addendum).** Q84 F2 prints the doctor line and the hook
   consequence; the plain "the mod stays (or becomes) unselected" line of the addendum is open in part A.
5. **Fixes that live only in a composition.** Rows marked `composition` (9, 13, 16, 17, 18, 20, 25, 28, 30, 33, 34,
   35, 37, 43, 44, 46, 47, 51, 55, 57, 60, 61, 64, 65, 66, 71, 72, 76, 77, 78, 79, 82, 85), the composition parts of
   the partial rows 32 and 36, and the composition halves of 2, 21, 22, 40, 50, 53, 58 and 67-70 are pinned by tests that run the kit's default `gsd-*.js`. Once part A lets a project
   keep an edited composition, these tests say nothing about the project's copy: an evolve edit can drop such a fix,
   and the A3 verb check only catches unknown verbs, not a lost step. Part B moves 78, 82 and 85 (and the other
   execute bookkeeping) into verbs, which closes it for them; the plan-side rows stay composition. A way to run these
   tests against a project's composition copy does not exist.
6. **Detached run tied to the launching agent (32).** A resolution call whose caller agent is gone now fails the run
   with a resume hint instead of a false verdict, but the run still fails; nothing makes a detached run independent
   of the session that started it.
7. **Silent deaths of detached runners on Windows (39).** The runner records every JS-level exit; five owner runs
   died with no line, which points at an external kill or a native crash (F39 notes). Not reproduced; needs one
   detached run in the owner's environment. [UNVERIFIED]
8. **Completion notice to the caller (15).** `--notify` (one message with status and result path when a detached run
   ends) was not built; the quiet `watch-run --quiet` under Monitor is the documented wait.
9. **`ph config --roles` (5).** Not built; the role catalog in INTERFACES.md 4.2 and the G207 consistency test cover
   the need.
10. **Plan-time reach check for whole-project obligations (36, last suggestion).** No kit plan check flags a plan whose
    obligation (plain analyze) covers files its owns cannot reach; at execute time such failures go to the integration
    fixer (`flow-gate.mjs:281`). The Flutter project covers it with its own `ownership-reach` plan-review lens.
11. **Item 87 parts A, B, C1, C2.** In progress on the r87 branches; their rows (87, 83, 86, 84 addendum) move to
    `covered` with their test files when they merge.
