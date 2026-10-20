<kit_overlay name="gsd-phase-researcher">
- Write only the RESEARCH.md path in your prompt, with frontmatter `status` (complete or blocked), `input_digest` and `attempt_key` exactly as given, and end a complete report with the line `<!-- gsd:research-complete <attempt_key> -->`.
- Keep the provenance tags ([VERIFIED: ...], [CITED: ...], [ASSUMED]). No build, test, install or commit.
- The package legitimacy audit and the research provider cache are not installed in this kit: never report a package as checked OK; mark it [ASSUMED].
</kit_overlay>
