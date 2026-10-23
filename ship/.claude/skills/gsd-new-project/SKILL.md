---
name: gsd-new-project
description: "Starts a GSD project - questioning, PROJECT.md, workflow preferences, optional research, REQUIREMENTS, an approved ROADMAP and STATE. Use when the owner wants to start, initialize or set up GSD planning for a project, or resume an unfinished project setup. Not when .planning is already initialized (use gsd-progress). Trigger on: 'start a new project', 'set up GSD planning', 'new roadmap', 'bắt đầu dự án mới', 'lên kế hoạch dự án', 'tạo roadmap mới'."
---

# gsd-new-project

<!-- PASEO-HARNESS-KIT START: kit-owned; project text belongs outside these markers -->
## Kit contract

Method text: follow `.agents/gsd/generated/workflows/new-project.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the project section below (overlays win).

The workflow is the project's composition `.agents/workflows/gsd-new-project.js`: a script of kit verbs that the project owns and evolves. This block is the kit's contract for every composition; the project section below the markers describes what this project's script takes and returns.

Run: write the args file `_workspace/args/gsd-new-project.json` (its fields are in the project section), run `node .agents/harness/ph.mjs workflow --name gsd-new-project --args-file _workspace/args/gsd-new-project.json --detach` and wait as its `next:` line says. A run that died is continued with `node .agents/harness/ph.mjs workflow --resume <runId>` (finished agent calls replay from the journal); a stopped run is answered, then run again with the same args.

Result statuses (the success statuses, stages and fields of this script are in the project section):
- `needs-owner`: show `stage`, `reason` and the numbered `options`, with the items the result lists for that stage. The answer is the verb the result names (an option, or the answer line of the stop, such as a `ph gsd ... clear` verb): run it as written, then run again with the same args. A stop that names no verb is answered by fixing the tree or the inputs it names, then running again. Quota or rate limits never offer retry-now: report the reset time.
- `refused`: another run holds the lease or lock the reason names; nothing was dispatched. Wait for it to end, then run again.
- `failed`: report the reason and the problems the result lists.
- Never edit the flow's state or record files by hand (progress, transfer, halt, request, answer and revision records, run journals under `_workspace/_runs/`): only the run and the `ph gsd` / `gsd-flow.mjs` verbs write them. Never edit the workflow script to get past a stop: composition changes go through harness-evolve between runs.
<!-- PASEO-HARNESS-KIT END -->

## Project composition

This section is the project's (outside the kit markers; kit updates never change it). It describes `.agents/workflows/gsd-new-project.js` as this project runs it: args, switches, stages and result fields. harness-evolve changes it together with the script; seeded from the kit default.

### Where to start (GSDF-08)
Decide by the initialization predicate, never by `.planning/` existing: `node .agents/harness/ph.mjs gsd init.project` returns `{initialized, missing[]}`.
- `initialized: true`: refuse with "already initialized; use gsd-progress".
- Nothing of PROJECT, REQUIREMENTS, ROADMAP, STATE exists (an empty `.planning/`, or only `.planning/codebase/` from gsd-map-codebase and an adapter from the harness): start at questioning.
- Partly initialized: resume at the first missing artifact in the order PROJECT -> REQUIREMENTS -> ROADMAP/STATE.
- Never run `git init` inside an existing work tree (check `git rev-parse --is-inside-work-tree` first).

### Steps (GSDF-07)
1. Questioning in the main session, numbered plain-text questions.
2. Write `.planning/PROJECT.md` yourself: What, Core Value, Requirements (Validated / Active / Out of Scope), Key Decisions, evolution footer.
3. Workflow preferences: ask granularity (coarse, standard, fine) and the toggles (research, plan_review, commit_policy.docs, execution_mode); write them into the `gsd` section of `.agents/harness.config.json` (merge, keep other keys). Nothing is written to a config file under `.planning/`.
4. Optional research: write `_workspace/args/gsd-new-project.json` `{"stage": "research"}` and run `node .agents/harness/ph.mjs workflow --name gsd-new-project --args-file _workspace/args/gsd-new-project.json --detach`. It runs 4 `gsd-project-researcher` agents and the synthesizer; if the synthesizer could not write `.planning/research/SUMMARY.md` but replied with the full document, the script writes it and logs a self-heal line; a bare confirmation without the file fails and the roadmap is not started. Only one research run per project runs at a time: a second one is refused while the first holds the research lock. Every researcher must finish and name its report that this run wrote; a failed worker stops the stage with its reason, and an earlier report or SUMMARY is never taken as this run's result.
5. Write `.planning/REQUIREMENTS.md` yourself, by category, with v1, v2 and Out of Scope sections and IDs matching `gsd.requirement_id_regex`.
6. Roadmap draft: args `{"stage": "roadmap"}` (add `"feedback"` with the owner's words on a rerun). The `gsd-roadmapper` writes only `.planning/drafts/ROADMAP.md` and `.planning/drafts/traceability.json`; the script checks every v1 requirement is in exactly one phase and every phase has 2-5 success criteria. `draft-invalid` names the unmapped IDs: rerun the roadmap stage with them as feedback. A roadmapper that fails, or does not rewrite `.planning/drafts/ROADMAP.md` in this run, returns `failed` with its reason; the earlier draft stays on disk and is not offered for approval.
7. Approval loop: show the draft phases; the owner answers 1) approve, 2) adjust (rerun step 6 with feedback), 3) review a phase in detail. Until approval ROADMAP, STATE and REQUIREMENTS stay untouched.
8. On approval: args `{"stage": "install", "approved": true}`: the single writer installs ROADMAP, the REQUIREMENTS traceability and initialises STATE.
9. Commit per `gsd.commit_policy.docs` through `ph gsd commit` with the exact paths; then point to `gsd-discuss 1`.
