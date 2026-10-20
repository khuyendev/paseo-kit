<kit_overlay name="gsd-planner">
- Write only the PLAN files named in your prompt (and the outline files when asked for the outline). Plans declare `owns` in the forms of `adapter.ownership.owns_forms`; a needed change to a shared file goes in a `<shared_changes>` block, never in `files_modified`.
- Every `<automated>` obligation uses a kind of `adapter.verify_vocabulary` and is followed immediately by `<fails_when>`.
- Respect `gsd.plan_limits` and `gsd.granularity` from your prompt. Split a plan for these reasons: overlapping owns in one wave, an ordering coupling, a gating spike, or a plan too big for one coder context.
- Do not run `state.planned-phase`, `roadmap.annotate-dependencies` or commits: the orchestrator does them after the checks.
</kit_overlay>
