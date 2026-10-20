# code-gsd-flows report (M10 GSDF)

## Files written

Skills (`ship/.claude/skills/`, each = pointer to the generated upstream method text + the common overlay + a kit overlay): `gsd-map-codebase`, `gsd-new-project`, `gsd-discuss`, `gsd-research` (kit-authored wrapper), `gsd-plan`, `gsd-execute`, `gsd-verify` (incl. UAT and transition), `gsd-quick`, `gsd-progress` (incl. next), `gsd-pause` (pause and resume), `gsd-undo`, `gsd-forensics`, `gsd-debug`.

Workflow scripts (`ship/.agents/workflows/`): `gsd-map-codebase.js`, `gsd-research.js`, `gsd-plan.js`, `gsd-plan-review.js`, `gsd-execute.js`, `gsd-verify.js`, `gsd-new-project.js` (stages research, roadmap, install), `gsd-quick.js`, `gsd-debug.js`. All carry one identical shared helper block (scripts cannot import): the `ph gsd` verb helper (last stdout line as JSON, `{code, json, stderr}`), phase-dir regex, `Input digest (<key>): <hash>` line, research input policy block.

Kit text (`ship/.agents/workflows/`): `gsd-overlay.md` (common adapter overlay of all GSD skills), `lenses/{fidelity,integration,correctness,source-grounding}.md`, `overlays/{gsd-debugger,gsd-phase-researcher,gsd-roadmapper}.md` (agent include overlays, see requests).

Shell-side helper (`ship/.agents/workflows/lib/`, run as `node .agents/workflows/lib/gsd-flow.mjs <cmd>`; JSON last line; scripts have no file/git API): `gsd-flow.mjs` (dispatch), `flow-files.mjs` (read/exists/guarded write/append/json-push/remove/run-scoped lock; refuses PROJECT/STATE/ROADMAP/REQUIREMENTS), `flow-git.mjs`, `flow-map.mjs` (7-doc check, secrets scan, stamp, drift gate), `flow-project.mjs` (roadmapper draft check, SUMMARY self-heal, quick dir, forensics path), `flow-owns.mjs`, `flow-execute.mjs` (anti-pattern gate, cwd/branch guard, execute baseline, safe-resume gate, owned changes, worktree transfer transaction, SUMMARY spot-check), `flow-gate.mjs` (adapter gates/build/test/obligations with timeouts and `adapter.mutex`, ADPT-17 evidence files, attribution by owns + ADPT-15 `attribute` hook, evidence readback), `flow-review.mjs` (review scope, review records, `<NN>-REVIEW.md`).

Tests (`tests/gsd-flows/`): `host.mjs` (fake workflow host: evaluates a script with the FLOW globals, determinism guards, scripted agent responder, fake `ph gsd`, real gsd-flow and git), `world.mjs` / `exec-world.mjs` (file-backed fake `ph gsd` on temp git projects), and `static`, `flow-tool`, `flow-gate`, `plan`, `research-verify`, `execute`, `execute-review`, `misc` test files.

## Requirements implemented

All 71 v1 GSDF IDs have code or text and at least one test named with the ID: GSDF-01..67, GSDF-92..95.
Main-session requirements are skill text checked by text tests (no runnable code path in this module): GSDF-07 (questioning part), 08, 10, 13, 57, 58, 59, 60, 62, 63 (their verbs are code-gsd-core's). GSDF-04 is checked on the script side (only roster agent names; a shipped `.agents/agents/` must match the roster once code-gsd-core writes it).

## v1 IDs not implemented

None. Partial: GSDF-50 fixer deadline and GSDF-67 per-turn timeout depend on the requested `timeoutS` agent option; GSDF-30/42/94 worktree paths and GSDF-01/45 null reasons depend on the requested `detail` option; attempt keys depend on the requested `runId` global (all three to code-workflow).

## Requests filed (`.planning/integration/requests.md`)

- code-workflow: script global `runId`; agent options `detail: true` and `timeoutS` (code carries `TODO(integration)`; without them every agent call throws `unknown option`).
- code-gsd-core: the verb argument/field shapes the scripts use (listed); new `handoff --no-tracer-split`, `roadmap install-draft`, `debug budget`, `debug checkpoint`; generated skill-workflow texts at `.agents/gsd/workflows/<name>.md`; inventory entries; overlay includes for gsd-debugger, gsd-phase-researcher, gsd-roadmapper; ship `gsd-skeleton-reviewer` and `finding-verifier`.
- code-install: gitignore `.claude/worktrees/` and `_workspace/`.

## How to run the tests

`node --test "tests/gsd-flows/*.test.mjs"` (offline; temp projects with spaces in their paths; no daemon). Result at hand-off: 92/92 pass.

## Known gaps

- Scripts are tested against my fake host, not code-workflow's engine (not present while I worked): rerun the script tests through its fake runner at integration; the host mirrors FLOW-01..11 semantics plus the requested options.
- `ph gsd` is faked from the GSDC requirement text; field names in the request list are my reading and must be matched (or the scripts adjusted) at integration.
- The gate reproduces `run-with-timeout` semantics with `lib/proc.runArgv` (process-tree kill, exit 124) instead of shelling to the verb; the test command is normalized through `ph gsd normalize-test-command` by the script.
- The ADPT-15 hook runner in `flow-gate.mjs` is a minimal local implementation (parse, evidence, attribute); dedupe with code-gsd-core's when it exists.
- Debug close on `exit_code_sufficient` kinds accepts exit 0 (executed count null), per ADPT-17; only kinds with an evidence parser prove "executed at least one".
- `gsd-quick` commits only per `commit_policy.docs` (one `docs(quick-<id>)` commit, as the requirement says); code of a quick task is left uncommitted when docs commits are off.
