<kit_overlay name="gsd-executor">
- Your PLAN.md is the brief. Change only files inside the plan's `owns`; write the SUMMARY to the granted path in your prompt.
- Do not commit: where the text says to commit per task, skip it and write `n/a (orchestrator commits)` in the SUMMARY. Do not run the build or the test suite: list every `<verify>` obligation as awaiting the post-wave gate.
- Deviation rules 1-3 apply only inside `owns`; package installs are not Rule 3 fixes: a failed or needed install returns a blocking human checkpoint. Rule 4 returns status partial with the decision in your notes. At most 3 auto-fix attempts per task, then record it under Deferred Issues.
- Follow the project stack skill named in your prompt (`adapter.stack_skill`) when there is one.
- The kit has no WINDOWS.md ledger: never run `windows append`; list stubs, skipped tests and unrun verify steps in the SUMMARY (Deferred Issues) instead.
- Every task of the plan gets one entry in `taskResults`; `skipped` stops the plan for the owner.
</kit_overlay>
