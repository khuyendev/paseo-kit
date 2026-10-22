---
name: gsd-execute
description: "Executes a planned GSD phase wave by wave through the gsd-execute workflow - executors per plan, build/test/obligation gate, bounded code review and fixes, orchestrator commits. Use when the owner asks to execute, build or implement a planned phase, resume an interrupted execution, or run its gap-closure wave. Not before the phase has handoff files (plan it with gsd-plan). Trigger on: 'execute phase 3', 'build the planned phase', 'resume the execution', 'chạy phase 3', 'thực thi phase', 'làm phase này', 'chạy tiếp execute'."
---

# gsd-execute

Method text: the orchestration of upstream `execute-phase` is the workflow script below; for each plan follow `.agents/gsd/generated/workflows/execute-plan.md` (generated upstream text, unchanged; the executor's deviation rules, `.agents/gsd/generated/executor-rules.md`, reach it through its role include), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay

### Run (GSDF-93)
Args file `_workspace/args/gsd-execute.json`: `{"phaseDir": ...}` plus `wave` (N), `plans` (`"03-01,03-02"`), `gapsOnly` (true) or `files` (an explicit review file list). Run `node .agents/harness/ph.mjs workflow --name gsd-execute --args-file _workspace/args/gsd-execute.json --detach` and wait as `next:` says. Never start execution from inside a `ph` agent worktree or on a `harness/*` branch (the run refuses and lists stranded commits and dirty files).

### What the run does
- Refuses a phase without `handoff/` (plan it first), a `--wave` while lower waves are incomplete, and `--gaps-only` when a plan lacks the `gap_closure` key.
- Safe resume: an execute baseline is recorded once; before every dispatch changed files are matched to plans, and an incomplete plan with changes, an unowned changed path, a foreign HEAD move or commits without a SUMMARY stop the run (`needs-owner` with paths, owning plan and HEAD; options close out manually, re-execute from scratch, mark and skip).
- One `gsd-executor` (or the adapter's executor agent) per plan, at most `gsd.parallelization.max_concurrent` at a time (one at a time when parallelization is off); plans sharing a modified file run one after the other. With `gsd.isolation: worktree` each executor works in its own worktree and the orchestrator transfers the owned changes in plan order.
- Gate after each wave (`per-wave`) or once at the end (`batch`): adapter gates, build, tests, every plan obligation; one evidence file per gate run under `<phaseDir>/evidence/`. Tracking (STATE wave log) moves only on green evidence.
- Review after green: one `gsd-code-reviewer` per plan, blocking findings verified by `finding-verifier` (a second, independent verifier decides what the first left uncertain), one `gsd-code-fixer` pass, a resolution check; one finding per defect class carries its instances. Non-blocking findings, and findings outside the lines the plan changed that the change did not cause (pre-existing), go to `<phaseDir>/deferred.md`; metrics to `_workspace/review-metrics.jsonl`.
- Commits by the orchestrator only (`feat(<phase>-w<k>)` per wave or `feat(<phase>-<plan>)` per plan with a `Plans:` trailer), recorded in `<phaseDir>/commits.json`.

### Results
- `executed`: run `gsd-verify` with `evidence` = the result's evidence list.
- `nothing-to-run`: follow `route` (verify, complete, plan-gaps, uat, stuck: resolve the halt record named, never "done").
- `needs-owner`: show stage, reason and options. Quota or rate limits never offer retry-now: report the reset time. A Rule-4 or checkpoint result needs the owner's decision; a red tracer wave starts no later wave.
- `refused` / `failed`: report the reason.
