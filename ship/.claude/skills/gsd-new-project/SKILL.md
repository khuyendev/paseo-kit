---
name: gsd-new-project
description: Starts a GSD project - questioning, PROJECT.md, workflow preferences, optional research, REQUIREMENTS, an approved ROADMAP and STATE. Use when the owner wants to start, initialize or set up GSD planning for a project, or resume an unfinished project setup. Not when .planning is already initialized (use gsd-progress).
---

# gsd-new-project

Method text: follow `.agents/gsd/workflows/new-project.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay

### Where to start (GSDF-08)
Decide by the initialization predicate, never by `.planning/` existing: `node .agents/harness/ph.mjs gsd init.project` returns `{initialized, missing[]}`.
- `initialized: true`: refuse with "already initialized; use gsd-progress".
- Nothing of PROJECT, REQUIREMENTS, ROADMAP, STATE exists (an empty `.planning/`, or only `.planning/codebase/` from gsd-map-codebase and an adapter from the harness): start at questioning.
- Partly initialized: resume at the first missing artifact in the order PROJECT -> REQUIREMENTS -> ROADMAP/STATE.
- Never run `git init` inside an existing work tree (check `git rev-parse --is-inside-work-tree` first).

### Steps (GSDF-07)
1. Questioning in the main session, numbered plain-text questions.
2. Write `.planning/PROJECT.md` yourself: What, Core Value, Requirements (Validated / Active / Out of Scope), Key Decisions, evolution footer.
3. Workflow preferences: ask granularity (coarse, standard, fine) and the toggles (research, plan_review, commit_policy.docs, execution_mode); write them into the `gsd` section of `.agents/harness.config.json` (merge, keep other keys). There is no `.planning/config.json`.
4. Optional research: write `_workspace/args/gsd-new-project.json` `{"stage": "research"}` and run `node .agents/harness/ph.mjs workflow --name gsd-new-project --args-file _workspace/args/gsd-new-project.json --detach`. It runs 4 `gsd-project-researcher` agents and the synthesizer; if the synthesizer could not write `.planning/research/SUMMARY.md` but replied with the full document, the script writes it and logs a self-heal line; a bare confirmation without the file fails and the roadmap is not started.
5. Write `.planning/REQUIREMENTS.md` yourself, by category, with v1, v2 and Out of Scope sections and IDs matching `gsd.requirement_id_regex`.
6. Roadmap draft: args `{"stage": "roadmap"}` (add `"feedback"` with the owner's words on a rerun). The `gsd-roadmapper` writes only `.planning/drafts/ROADMAP.md` and `.planning/drafts/traceability.json`; the script checks every v1 requirement is in exactly one phase and every phase has 2-5 success criteria. `draft-invalid` names the unmapped IDs: rerun the roadmap stage with them as feedback.
7. Approval loop: show the draft phases; the owner answers 1) approve, 2) adjust (rerun step 6 with feedback), 3) review a phase in detail. Until approval ROADMAP, STATE and REQUIREMENTS stay untouched.
8. On approval: args `{"stage": "install", "approved": true}`: the single writer installs ROADMAP, the REQUIREMENTS traceability and initialises STATE.
9. Commit per `gsd.commit_policy.docs` through `ph gsd commit` with the exact paths; then point to `gsd-discuss 1`.
