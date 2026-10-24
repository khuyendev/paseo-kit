---
name: gsd-verify
description: "Verifies an executed GSD phase with one fresh gsd-verifier (or one per success criterion with gsd.verify_mode per-criterion), then routes it - phase complete and transition, UAT with the owner, or gap closure. Use when the owner asks to verify, test, accept or finish a phase, or to continue a UAT session. Not for executing plans (gsd-execute). Trigger on: 'verify phase 3', 'accept the phase', 'run UAT', 'kiểm tra phase', 'nghiệm thu phase', 'verify lại'."
---

# gsd-verify

<!-- PASEO-HARNESS-KIT START: kit-owned; project text belongs outside these markers -->
## Kit contract

Method text: follow `.agents/gsd/generated/workflows/verify-work.md` and, after completion, `.agents/gsd/generated/workflows/transition.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the project section below (overlays win).

The workflow is the project's composition `.agents/workflows/gsd-verify.js`: a script of kit verbs that the project owns and evolves. This block is the kit's contract for every composition; the project section below the markers describes what this project's script takes and returns.

Run: write the args file `_workspace/args/gsd-verify.json` (its fields are in the project section), run `node .agents/harness/ph.mjs workflow --name gsd-verify --args-file _workspace/args/gsd-verify.json --detach` and wait as its `next:` line says. A run that died is continued with `node .agents/harness/ph.mjs workflow --resume <runId>` (finished agent calls replay from the journal); a stopped run is answered, then run again with the same args.

Result statuses (the success statuses, stages and fields of this script are in the project section):
- `needs-owner`: show `stage`, `reason` and the numbered `options`, with the items the result lists for that stage. The answer is the verb the result names (an option, or the answer line of the stop, such as a `ph gsd ... clear` verb): run it as written, then run again with the same args. A stop that names no verb is answered by fixing the tree or the inputs it names, then running again. Quota or rate limits never offer retry-now: report the reset time.
- `refused`: another run holds the lease or lock the reason names; nothing was dispatched. Wait for it to end, then run again.
- `failed`: report the reason and the problems the result lists.
- Never edit the flow's state or record files by hand (progress, transfer, halt, request, answer and revision records, run journals under `_workspace/_runs/`): only the run and the `ph gsd` / `gsd-flow.mjs` verbs write them. Never edit the workflow script to get past a stop: composition changes go through harness-evolve between runs.
<!-- PASEO-HARNESS-KIT END -->

## Project composition

This section is the project's (outside the kit markers; kit updates never change it). It describes `.agents/workflows/gsd-verify.js` as this project runs it: args, switches, stages and result fields. harness-evolve changes it together with the script; seeded from the kit default.

### Verification run (GSDF-55, GSDF-56)
Args file `_workspace/args/gsd-verify.json`: `{"phaseDir": ..., "evidence": [<gate evidence paths from the execute result>], "baseline": "<execute baseline HEAD>"}`; run `node .agents/harness/ph.mjs workflow --name gsd-verify --args-file _workspace/args/gsd-verify.json --detach` and wait as `next:` says. When every evidence file is stale (inputs differ from the current code), the run stops needs-owner at Evidence and does not send those verdicts to the verifier; the answer is `ph gsd evidence refresh <N>`, then rerun gsd-verify with the evidence path it prints (kit feedback 111). Invalid evidence, or a mix of current and stale, is still shown to the verifier as not proof. Partial evidence (an obligation's command changed since the gate ran, kit feedback 97) is shown as proof of everything but the named obligations. The report's own status wins over the verifier's reply.
- `gsd.verify_mode` (kit feedback 66; the owner chooses per project): `phase` (default) runs one verifier for the whole phase. `per-criterion` runs one verifier per ROADMAP success criterion (`SC-<k>`) and one for the phase-wide checks (`phase`) at once; each writes `<phaseDir>/verify/<id>.md` and the run merges them into `<NN>-VERIFICATION.md` (`ph gsd verification merge`), so the UAT holds only the criteria that need a human, each test titled with its criterion. The result lists `criteria` (`id, status, reused`) and `dispatched`. A failed run names the criteria left without a valid part: `ph workflow --resume <run>` reruns only the verifiers that did not finish; a new run verifies every criterion again. A phase without success criteria runs the one verifier (`fallback` in the result).
- `passed`: the run completed the phase (`ph gsd phase complete`). Do the transition: evolve PROJECT.md yourself (move shipped Active requirements to Validated, update Key Decisions, stamp the last-updated footer) and point to the next phase. Never close a milestone. `completion.proposals` (from `phase complete`) names the skills the phase's code now calls for: `gsd-map-codebase` when `.planning/codebase/` holds no map, `harness` when the adapter has no review lens. Show each one to the owner after the transition; run it only when the owner asks.
- `human_needed`: the run wrote `<NN>-UAT.md` (one test per human item). Run the UAT conversation below; the phase does not advance and no ROADMAP checkbox changes.
- `gaps_found`: the run reverted the phase's requirement marks; run `gsd-plan` with `mode: gaps`, then `gsd-execute --gaps-only`, then verify again. Leftovers after that one gap wave go to the owner.
- `stale`: verify again once execution evidence is current.
- `refused`: another verify of this phase holds its lock (the reason names the run); nothing was dispatched or recorded. Wait for that run to end, then verify again.
- `failed` with a reason `UAT write failed` or `requirements revert failed`: the verdict was recorded but its UAT file or requirement revert did not land, so no route was taken. Fix the cause (the file is locked, `REQUIREMENTS.md` is missing or lacks a phase requirement) and run gsd-verify again.

### UAT conversation (GSDF-57)
- Before the first test: when a phase plan changed files matching `adapter.startup_globs` and no cold-start smoke test exists, insert one as test 1. A SUMMARY completion claim counts only when its plan's `commits.json` entry and a current gate evidence file confirm it; otherwise that test is an issue of severity blocker.
- On resume: a gap whose `gap_ids` are covered by a completed gap plan with passing evidence is marked resolved, never asked again.
- Present one test at a time in plain text. Classify the answer: pass (empty, yes, y, ok, next), skip, blocked (infer `blocked_by`: server, physical-device, release-build, third-party, prior-phase), or issue (infer severity; never ask for it). Deferred follow-ups never become gaps.
- Write UAT.md after each issue, every 5 passes and at completion.
- At completion: zero unresolved issues and `node .agents/harness/ph.mjs gsd phase uat-passed <N> --require-verification` exit 0 -> `ph gsd phase complete <N>` runs (then the transition). That `uat-passed` call canonicalises a `human_needed` report to `passed` once the UAT passes: its `human_verification` and `behavior_unverified` items are dropped and `canonicalized: true` is in its JSON. A report that would not read back as passed is left unchanged. `uat-passed` needs at least one passed test and no pending or blocked row, no skipped row without a reason, and no issue unless every `## Gaps` entry for it is a verified resolution (`status: resolved` with a `resolved_by` plan in the phase directory that has its SUMMARY). Issues -> gap planning as above.
