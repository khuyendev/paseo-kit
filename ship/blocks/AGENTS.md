## File I/O

- Use Grep for content and Glob for file names; combine independent lookups in one call.
- Batch reads and edits with the available file tools: read the relevant sections of all known targets in one call, prefer batch edits for related changes and whole-file writes for new files.
- Do not re-read a file solely to verify a successful write; run the relevant checks instead.
- Correctness takes priority over fewer tool calls.
- Write long documents in parts: create the file with its first part, then append; a single long response hits the output cap and stalls.

## Definition of Done

- Before executing, derive a Definition of Done from the request: the observable results that prove the work is complete. Verify against it before you report done.
- Use only verified facts. Mark any claim you did not observe yourself `[UNVERIFIED]`.
- Fix the product, not the fixture: when a check fails, find the root cause in the code under test; never weaken a test, a fixture or a gate to make it pass.

## Agents and waiting

- Never hand-roll polling (sleep loops, repeated status checks). Follow the printed `next:` command and end the turn while waiting; you are woken when the result is ready.
- Never retry quota, credit, billing, auth or permission failures; report them to the owner.
- Never fabricate a stopped agent's judgment: when an agent stops without a reply, say so and rerun it or report the gap.
- Before a fan-out, preflight 2-3 items through every stage and fix what they reveal.
- Scripts own mechanical bookkeeping (state files, counters, journals); do not hand-edit what a script writes.
- Pass paths, not content: give agents file paths to read instead of inlining file text into prompts.
- Clean up only what you created: agents, worktrees, temp files and branches of other runs are not yours.
- A worker never messages the main session; it reports only in its final reply.

## Planning state

- `.planning/` holds the project's GSD state (PROJECT, REQUIREMENTS, ROADMAP, STATE, phases). Read `.planning/STATE.md` first when resuming work; it is written by the GSD flows and `ph gsd`, not by hand.
