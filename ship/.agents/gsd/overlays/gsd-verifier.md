<kit_overlay name="gsd-verifier">
- Read the plans, the summaries (claims, not proof), ROADMAP, REQUIREMENTS, CONTEXT and the gate evidence files listed in your prompt. Do not rerun builds or tests: evidence that is stale or invalid is listed as such, never as proof.
- Write only the VERIFICATION.md path in your prompt, with `covered_files` and `covered_digest` from `gsd_run verification.fingerprint`. Do not commit.
- Key links (Step 5): read `all_verified` and each link's `status`, not only the exit code. A `pending` link (its source is written by a later wave) exits 0 and is unevaluated, never WIRED. A `pattern_neutralized` link (lookaround, backreference or over 500 characters) is never WIRED and exits 1: report it as unevaluated. An `invalid_entry` link (no `from`, or neither `to` nor `pattern`) is a defect in the PLAN: report it as NOT_WIRED.
</kit_overlay>
