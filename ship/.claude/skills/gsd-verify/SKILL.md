---
name: gsd-verify
description: "Verifies an executed GSD phase with one fresh gsd-verifier, then routes it - phase complete and transition, UAT with the owner, or gap closure. Use when the owner asks to verify, test, accept or finish a phase, or to continue a UAT session. Not for executing plans (gsd-execute). Trigger on: 'verify phase 3', 'accept the phase', 'run UAT', 'kiểm tra phase', 'nghiệm thu phase', 'verify lại'."
---

# gsd-verify

Method text: follow `.agents/gsd/generated/workflows/verify-work.md` and, after completion, `.agents/gsd/generated/workflows/transition.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay

### Verification run (GSDF-55, GSDF-56)
Args file `_workspace/args/gsd-verify.json`: `{"phaseDir": ..., "evidence": [<gate evidence paths from the execute result>], "baseline": "<execute baseline HEAD>"}`; run `node .agents/harness/ph.mjs workflow --name gsd-verify --args-file _workspace/args/gsd-verify.json --detach` and wait as `next:` says. Stale or invalid evidence is shown to the verifier as stale, never as proof; the report's own status wins over the verifier's reply.
- `passed`: the run completed the phase (`ph gsd phase complete`). Do the transition: evolve PROJECT.md yourself (move shipped Active requirements to Validated, update Key Decisions, stamp the last-updated footer) and point to the next phase. Never close a milestone.
- `human_needed`: the run wrote `<NN>-UAT.md` (one test per human item). Run the UAT conversation below; the phase does not advance and no ROADMAP checkbox changes.
- `gaps_found`: the run reverted the phase's requirement marks; run `gsd-plan` with `mode: gaps`, then `gsd-execute --gaps-only`, then verify again. Leftovers after that one gap wave go to the owner.
- `stale`: verify again once execution evidence is current.
- `refused`: another verify of this phase holds its lock (the reason names the run); nothing was dispatched or recorded. Wait for that run to end, then verify again.

### UAT conversation (GSDF-57)
- Before the first test: when a phase plan changed files matching `adapter.startup_globs` and no cold-start smoke test exists, insert one as test 1. A SUMMARY completion claim counts only when its plan's `commits.json` entry and a current gate evidence file confirm it; otherwise that test is an issue of severity blocker.
- On resume: a gap whose `gap_ids` are covered by a completed gap plan with passing evidence is marked resolved, never asked again.
- Present one test at a time in plain text. Classify the answer: pass (empty, yes, y, ok, next), skip, blocked (infer `blocked_by`: server, physical-device, release-build, third-party, prior-phase), or issue (infer severity; never ask for it). Deferred follow-ups never become gaps.
- Write UAT.md after each issue, every 5 passes and at completion.
- At completion: zero unresolved issues and `node .agents/harness/ph.mjs gsd phase uat-passed <N> --require-verification` exit 0 -> `ph gsd phase complete <N>` runs (then the transition). That `uat-passed` call canonicalises a `human_needed` report to `passed` once the UAT passes: its `human_verification` and `behavior_unverified` items are dropped and `canonicalized: true` is in its JSON. A report that would not read back as passed is left unchanged. Blocked or skipped tests never count as passed. Issues -> gap planning as above.
