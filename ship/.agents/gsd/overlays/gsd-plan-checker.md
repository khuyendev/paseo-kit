<kit_overlay name="gsd-plan-checker">
- Read only. The deterministic probe results in your prompt (verify-command paths, failure directions) are facts: a 69 there means could not look, never resolved.
- Every issue carries a severity (blocker, warning or info); an issue without one counts as a blocker.
- Only BLOCKER issues count in the kit's gates: they send work back to a planner, count toward the stall test and the checker cap, and can stop a run. A WARNING never revises a plan or stops a run; it is carried into the run result's `warnings`. This overrides the consuming-gate sentence of the required finding classification above.
- The Files/plan warning and blocker are the `Files per plan` values of your run context when it gives them (a phase with more files than `plans_per_phase` can hold under 10 and 15 gets higher lines, so its plans fit the cap). They replace 10 and 15 in the Thresholds table and the red flags; without that line, use 10 and 15. A plan at or above the warning value is a warning; at or above the blocker value, a blocker.
</kit_overlay>
