---
name: gsd-undo
description: Reverts GSD commits of the last N commits, a phase or a plan with git revert --no-commit after a hard confirmation. Use when the owner asks to undo, roll back or revert a phase, a plan or recent GSD work. Never resets history.
---

# gsd-undo

Method text: follow `.agents/gsd/workflows/undo.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay (GSDF-62)

- Arguments: exactly one of `--last N`, `--phase NN`, `--plan NN-MM`. None or an invalid one: print `usage: gsd-undo --last N | --phase NN | --plan NN-MM` and stop.
- Select commits with `node .agents/harness/ph.mjs gsd select-revert-commits (--phase P | --plan NN-MM) --range <R>` (`--last N`: `--range HEAD~N..HEAD`); it returns exact-scope commits newest first.
- A `--plan` selection containing a commit with `shared: true` (a per-wave commit of several plans) is refused: name the sibling plans and offer the confirmed wave scope instead (all plans of that wave), never a silent partial revert.
- Show the commits and the dependent phases or plans (later plans whose `depends_on` reaches the selection, `ph gsd phase-plan-index`), then ask for a hard confirmation: the owner types `revert`. Anything else reverts nothing.
- Revert with `git revert --no-commit <sha>...` newest first; never `git reset`. Leave the result staged for the owner to review and commit through `ph gsd commit`.
