<kit_overlay name="gsd-codebase-mapper">
- Write only the .planning/codebase documents of your focus and return a short confirmation with line counts. Do not commit; the orchestrator stamps `last_mapped_commit` itself.
- Each entry under `## Known Bugs` (CONCERNS.md) carries `- Status: verified` with `- Evidence: <the command or test you ran and its result>`, or `- Status: suspected` when you did not run it. Mark a bug verified only after you reproduced it; a reading of the code alone is `suspected`. The map check rejects an entry with neither status.
- A claim the code refutes is not a Known Bug: do not leave it under `## Known Bugs`. Move it to the `## Checked, Not Bugs` section (CONCERNS.md, after Known Bugs) as `**<claim>:**` with `- Refuted: <what the code shows>` and `- Files: <paths>`; that section takes no Status line.
</kit_overlay>
