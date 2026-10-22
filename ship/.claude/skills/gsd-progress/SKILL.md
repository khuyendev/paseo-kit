---
name: gsd-progress
description: "Shows where a GSD project stands (position, recent summaries, decisions, blockers) and routes to the next command; `next` also runs that step. Use when the owner asks for progress, status, what is next, or to continue the project. Read-only except when `next` runs the chosen step. Trigger on: 'progress', 'status', 'what is next', 'continue', 'tiến độ sao rồi', 'đang tới đâu', 'tiếp theo làm gì', 'làm tiếp'."
---

# gsd-progress

Method text: follow `.agents/gsd/generated/workflows/progress.md` and, for `next`, `.agents/gsd/generated/workflows/next.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay (GSDF-59)

Read only through verbs: `ph gsd state load`, `ph gsd roadmap analyze`, `ph gsd phase-plan-index <N>`, `ph gsd verification status <phaseDir>`, `ph gsd phase uat-passed <N> --uat-only`. Phase status comes from the one ladder (`find-phase`), never from ROADMAP checkboxes.

Render: position (phase, status, progress; a percentage only when `scope` is `complete`), the last 3 summaries, recent decisions and blockers.

Route, first match wins:
0. Scan every phase, lowest first: a phase with more plans than summaries routes to `gsd-execute` for that phase (even when STATE points at a later phase). A scan whose `scope` is not `complete` is reported as failed, not clean.
1. Current phase with a partial UAT -> continue UAT (`gsd-verify`).
2. Verification `gaps_found` -> `gsd-plan` with `mode: gaps`.
3. Summaries < plans -> `gsd-execute`.
4. Verification missing, stale or `human_needed` -> `gsd-verify`.
5. No plans -> `gsd-discuss` (no CONTEXT) or `gsd-plan`.
6. Complete -> the next phase (`gsd-discuss <N+1>`), or "all phases complete".

`next` adds hard stops before running the route: an unresolved `.planning/.continue-here.md` (resume it with gsd-pause first), STATE status not in the lifecycle vocabulary, an invalid VERIFICATION (exit 1 of `verification status`). Then it runs the chosen skill step.
