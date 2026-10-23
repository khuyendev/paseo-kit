---
name: gsd-quick
description: "Runs a small GSD task outside the phase plan - one plan of 1-3 tasks under .planning/quick/, executed by a gsd-executor; --full adds discussion, research, a checker and a verifier. Use when the owner asks for a quick fix, small change or one-off task in a project with a ROADMAP. Not for phase work (gsd-plan) or trivial one-line fixes (do those inline). Trigger on: 'quick fix', 'small change', 'one-off task', 'sửa nhanh', 'fix nhanh cái này', 'việc nhỏ thôi'."
---

# gsd-quick

<!-- PASEO-HARNESS-KIT START: kit-owned; project text belongs outside these markers -->
## Kit contract

Method text: follow `.agents/gsd/generated/workflows/quick.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the project section below (overlays win).

The workflow is the project's composition `.agents/workflows/gsd-quick.js`: a script of kit verbs that the project owns and evolves. This block is the kit's contract for every composition; the project section below the markers describes what this project's script takes and returns.

Run: write the args file `_workspace/args/gsd-quick.json` (its fields are in the project section), run `node .agents/harness/ph.mjs workflow --name gsd-quick --args-file _workspace/args/gsd-quick.json --detach` and wait as its `next:` line says. A run that died is continued with `node .agents/harness/ph.mjs workflow --resume <runId>` (finished agent calls replay from the journal); a stopped run is answered, then run again with the same args.

Result statuses (the success statuses, stages and fields of this script are in the project section):
- `needs-owner`: show `stage`, `reason` and the numbered `options`, with the items the result lists for that stage. The answer is the verb the result names (an option, or the answer line of the stop, such as a `ph gsd ... clear` verb): run it as written, then run again with the same args. A stop that names no verb is answered by fixing the tree or the inputs it names, then running again. Quota or rate limits never offer retry-now: report the reset time.
- `refused`: another run holds the lease or lock the reason names; nothing was dispatched. Wait for it to end, then run again.
- `failed`: report the reason and the problems the result lists.
- Never edit the flow's state or record files by hand (progress, transfer, halt, request, answer and revision records, run journals under `_workspace/_runs/`): only the run and the `ph gsd` / `gsd-flow.mjs` verbs write them. Never edit the workflow script to get past a stop: composition changes go through harness-evolve between runs.
<!-- PASEO-HARNESS-KIT END -->

## Project composition (GSDF-61)

This section is the project's (outside the kit markers; kit updates never change it). It describes `.agents/workflows/gsd-quick.js` as this project runs it: args, switches, stages and result fields. harness-evolve changes it together with the script; seeded from the kit default.

- A trivial one-line fix: do it inline in the main session, no plan.
- Requires `.planning/ROADMAP.md`; the run refuses otherwise.
- The run takes the code-root writer lease (GSDF-64) like execute and debug: while another of them holds the code root it is `refused` and names the holder; it holds the lease until it ends. A planning run does not block it.
- `--full`: first discuss the gray areas in the main session and write the decisions to a CONTEXT file in the quick directory; pass its path as `contextPath`. Without an existing `contextPath` file the run stops at `needs-owner` (stage Discuss) before any agent runs.
- Args file `_workspace/args/gsd-quick.json`: `{"description": "<task text>", "full": false}` (`"contextPath"` and `"dir"` from the discussion when `--full`; `"skipResearch": true` with a `"researchSkipReason"` only when the owner decides to continue without research). Run `node .agents/harness/ph.mjs workflow --name gsd-quick --args-file _workspace/args/gsd-quick.json --detach` and wait as `next:` says. The description reaches agents only as data.
- The run creates `.planning/quick/<YYMMDD-xxx>-<slug>/` (slug at most 40 characters), plans ONE plan of 1-3 tasks with repo-root-relative paths, executes it through the executor contract and, with `--full`, adds research, a checker loop of at most 2 iterations and a verifier.
- One `docs(quick-<id>)` commit per `gsd.commit_policy.docs`; no STATE table row (quick tasks are listed from the directory).
- Checker warnings never send the plan back or stop the run; they come back as `warnings` in the result.
- `needs-owner`: show the reason (a missing discussion for `--full`, a Rule-4 decision, a blocked task, checker blockers after 2 iterations, research that returned nothing or wrote no new report at stage Plan, quick verification gaps or human checks at stage Verify). A Verify stop returns the `gaps`, `human_verification` and `behavior_unverified` of the report next to its `verification` path; show them, not only the path. For a research stop, offer the options the result lists: rerun with `dir` set to the quick directory it names, or rerun with `skipResearch` and a `researchSkipReason` the owner gives. A run that continued without research reports `researchSkipped` with that reason. A stop on a blocked task also returns `taskResults` (the tasks that finished) and `summary` (the SUMMARY path, or null).
- A run never overwrites a file already in its directory: when the plan, summary, research (with `--full`, unless skipping research) or verification of the `dir` exists, it stops with `needs-owner` before any agent runs. Drop `dir` to start a new quick task; the owner's file stays as it is.
