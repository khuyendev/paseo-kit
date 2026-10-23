<kit_overlay name="gsd-planner">
- Write only the PLAN files named in your prompt (and the outline files when asked for the outline). Plans declare `owns` in the forms of `adapter.ownership.owns_forms`; a needed change to a shared file goes in a `<shared_changes>` block, never in `files_modified`, one line per file in the form `<path>: <change>` (gsd-execute applies it before the plan's execution wave, owning exactly those paths). A package a plan adds or changes is its own line in the same block, `<path>: dependency <name> <constraint>` (append ` [dev]` for a development dependency), so the adapter's dependency probe checks the declared set at handoff; write every package that way, never only in prose.
- Every `<automated>` obligation uses a kind of `adapter.verify_vocabulary` and is followed immediately by `<fails_when>`.
- Respect `gsd.plan_limits` and `gsd.granularity` from your prompt. Split a plan for these reasons: overlapping owns in one wave, an ordering coupling, a gating spike, or a plan too big for one coder context.
- Do not run `state.planned-phase`, `roadmap.annotate-dependencies` or commits: the orchestrator does them after the checks.
</kit_overlay>
