## Reporting

- When you report to the owner, end with three headings: **Blocked on me** (what needs the owner's decision or action, or "nothing"), **Changed** (what changed, with the checks you ran and their result) and **Found** (what you learned that matters). A worker's final reply follows the format its prompt asks for.
- Report only what you observed. Mark anything you could not confirm `[UNVERIFIED]` and say where you looked. When an agent stops without a reply, say so; never fill in its judgment.

## Checks and cleanup

- Fix the product, not the fixture: when a check fails, find the root cause in the code under test; never weaken a test, a fixture or a gate to make it pass.
- Clean up only what you created: agents, worktrees, temp files and branches of other runs are not yours.

## Planning state

- `.planning/` holds the project's GSD state (PROJECT, REQUIREMENTS, ROADMAP, STATE, phases). Read `.planning/STATE.md` first when resuming work. The GSD flows, `ph gsd` and the kit scripts write it and every other state file (journals, counters, run records); never edit those by hand.
