---
name: gsd-quick
description: "Runs a small GSD task outside the phase plan - one plan of 1-3 tasks under .planning/quick/, executed by a gsd-executor; --full adds discussion, research, a checker and a verifier. Use when the owner asks for a quick fix, small change or one-off task in a project with a ROADMAP. Not for phase work (gsd-plan) or trivial one-line fixes (do those inline). Trigger on: 'quick fix', 'small change', 'one-off task', 'sửa nhanh', 'fix nhanh cái này', 'việc nhỏ thôi'."
---

# gsd-quick

Method text: follow `.agents/gsd/generated/workflows/quick.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay (GSDF-61)

- A trivial one-line fix: do it inline in the main session, no plan.
- Requires `.planning/ROADMAP.md`; the run refuses otherwise.
- The run takes the code-root writer lease (GSDF-64) like plan, execute and debug: while another of them holds the code root it is `refused` and names the holder; it holds the lease until it ends.
- `--full`: first discuss the gray areas in the main session and write the decisions to a CONTEXT file in the quick directory; pass its path as `contextPath`. Without an existing `contextPath` file the run stops at `needs-owner` (stage Discuss) before any agent runs.
- Args file `_workspace/args/gsd-quick.json`: `{"description": "<task text>", "full": false}` (`"contextPath"` and `"dir"` from the discussion when `--full`; `"skipResearch": true` with a `"researchSkipReason"` only when the owner decides to continue without research). Run `node .agents/harness/ph.mjs workflow --name gsd-quick --args-file _workspace/args/gsd-quick.json --detach` and wait as `next:` says. The description reaches agents only as data.
- The run creates `.planning/quick/<YYMMDD-xxx>-<slug>/` (slug at most 40 characters), plans ONE plan of 1-3 tasks with repo-root-relative paths, executes it through the executor contract and, with `--full`, adds research, a checker loop of at most 2 iterations and a verifier.
- One `docs(quick-<id>)` commit per `gsd.commit_policy.docs`; no STATE table row (quick tasks are listed from the directory).
- Checker warnings never send the plan back or stop the run; they come back as `warnings` in the result.
- `needs-owner`: show the reason (a missing discussion for `--full`, a Rule-4 decision, a blocked task, checker blockers after 2 iterations, research that returned nothing or wrote no new report at stage Plan). For a research stop, offer the options the result lists: rerun with `dir` set to the quick directory it names, or rerun with `skipResearch` and a `researchSkipReason` the owner gives. A run that continued without research reports `researchSkipped` with that reason. A stop on a blocked task also returns `taskResults` (the tasks that finished) and `summary` (the SUMMARY path, or null).
- A run never overwrites a file already in its directory: when the plan, summary, research (with `--full`, unless skipping research) or verification of the `dir` exists, it stops with `needs-owner` before any agent runs. Drop `dir` to start a new quick task; the owner's file stays as it is.
