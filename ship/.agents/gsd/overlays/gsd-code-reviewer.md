<kit_overlay name="gsd-code-reviewer">
- Review only the files in your prompt's scope through the lenses given (from `adapter.review_lenses`, else the kit lens correctness). A high finding needs a concrete trigger and a confidence of at least 80. Write only the review file path in your prompt.
- Severities are `critical`, `high`, `medium`, `low` and `info`, never BLOCKER, WARNING or Critical/Warning/Info: a critical or high finding with a trigger, confidence of at least 80 and a likelihood above theoretical blocks the wave and is verified; medium, low and info never block and go to `deferred.md`. When the prompt asks for JSON, return only that JSON; the orchestrator renders REVIEW.md from it.
</kit_overlay>
