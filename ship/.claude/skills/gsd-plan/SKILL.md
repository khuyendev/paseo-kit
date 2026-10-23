---
name: gsd-plan
description: "Plans one GSD phase (outline, skeleton review, per-plan planners, checker, coverage, handoff) through the gsd-plan workflow, then chains execute and verify. Use when the owner asks to plan a phase, replan it, plan its gaps after verification, or run the next phase. Not for discussing scope (gsd-discuss) or quick one-off tasks (gsd-quick). Trigger on: 'plan phase 3', 'replan', 'plan the gaps', 'run the next phase', 'lên plan phase 3', 'plan lại', 'phase tiếp theo'."
---

# gsd-plan

Method text: the orchestration of upstream `plan-phase` is the workflow script below; its step 8 and step 12 contracts are generated unchanged in `.agents/gsd/generated/plan-phase-contracts.md` and reach the planner through its role include, then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win). The researcher, planner and checker are always separate agents; planning never creates, renames or switches git branches.

## Kit overlay

### Phase (GSDF-35, GSDF-33)
- Without a phase argument pick the first phase (lowest first, `ph gsd roadmap analyze`) whose status is `NOT_STARTED` or that is discussed or researched but unplanned; when none fits, ask.
- The run refuses a `COMPLETE` phase (`refused`, pointing at its VERIFICATION) unless the owner says force: pass `"force": true` and show the warning banner.
- The run refuses a `phaseDir` whose number matches a phase but whose directory is not that phase's directory (`refused`, naming both paths): pass the directory `find-phase` reports; it never plans into a stale slug.

### Run (GSDF-15, GSDF-02)
Args file `_workspace/args/gsd-plan.json`, e.g. `{"phaseDir": ".planning/phases/02-api"}`; optional `mode` (`plan` | `gaps`), `tracer` (default true), `reversibilityGates` (default true), `maxSkeletonPasses` / `maxCheckIterations` (integers 1..3, defaults from `gsd`), `skeletonLanes` (`[{lens, model?, effort?}]`, default `gsd.skeleton_lanes`; a changed lane set, lens text or reviewer definition reruns the skeleton review), `wiring` (`auto|always|never`), `replan`, `skipResearch` + `researchSkipReason`, `forceProceed {reason}`, `planReview`, `roles {role: {model, effort}}`.
`node .agents/harness/ph.mjs workflow --name gsd-plan --args-file _workspace/args/gsd-plan.json --detach`, then wait as `next:` says. Rerunning with the same args reuses everything whose inputs did not change; a run that died is continued with `ph workflow --resume <runId>`.

### Results
- `planned`: apply the architect's `sharedChanges` the result lists (those without `executionWave`) before the first wave; the plans' own shared changes carry `executionWave` and gsd-execute makes them before that wave's gate. STATE already says `Ready to execute` and the ROADMAP carries wave headers. Then chain: `gsd-execute`, then `gsd-verify`, stopping at the first `needs-owner` or `failed`. `--plan-only`: stop after the handoff.
- `needs-owner`: show `stage`, `reason`, the issues or the conflict, and the `options` numbered. For an owner marker also show `summary`, `question` and every item of `plans` (the planner's proposed split or audit options) so the owner decides without opening the run journal. Typical stages: Discuss (finish gsd-discuss), Research (run gsd-research, or rerun with `skipResearch` and a reason the owner gives), Skeleton review / Checker (open blockers or a stall: guidance and rerun, or `forceProceed {reason}` at the checker cap, never over an open REVISION_CONFLICT), Plan (owner marker such as PHASE SPLIT RECOMMENDED), Handoff (coverage gate: re-plan, move to a later phase, or tag the decision informational in CONTEXT).
- `failed` / `refused`: report the reason; nothing to chain.

### Gap closure (GSDF-30, GSDF-56)
After `gsd-verify` returns `gaps_found`, run with `{"phaseDir": ..., "mode": "gaps"}`: one gap wave only, `handoff/gap-w1.args.json`, then `gsd-execute --gaps-only` and `gsd-verify` again. A second gap attempt after a gap wave ran returns `needs-owner`: leftovers go to the owner (a new phase).
