<!--
The <planning_context> block of every gsd-plan planner, architect and checker prompt (flow verb plan-prompt, lib/flow-plan.mjs).
Variables: phase (number and name), phaseDir, mode (outline|standard|revision|wiring|gap_closure), contextFile, research,
requirements, instructions, stackSkill, tracer, reversibilityGates, granularity, tasksPerPlan, plansPerPhase, wavesPerPhase;
validationSkipped (why checker Dimension 8 is skipped) or validationPath (the VALIDATION.md): a plan template line whose
variables are all empty is left out.
-->
<planning_context>
Phase: {{phase}}
Phase directory: {{phaseDir}}
Mode: {{mode}}
Required reading (open these paths yourself):
- .planning/STATE.md
- .planning/ROADMAP.md
- .planning/REQUIREMENTS.md
- {{contextFile}} (user decisions: locked, do not revisit)
- {{research}}
Phase requirement IDs: {{requirements}}
Project instruction files: {{instructions}}
Stack skill to follow: {{stackSkill}}
TRACER_MODE: {{tracer}}
REVERSIBILITY_GATES: {{reversibilityGates}}
MVP_MODE: false
WALKING_SKELETON: false
Granularity: {{granularity}}
Plan limits: {{tasksPerPlan}} tasks per plan, {{plansPerPhase}} plans per phase, {{wavesPerPhase}} waves per phase
Nyquist validation (checker Dimension 8): SKIPPED, {{validationSkipped}}. The checker reports "Dimension 8: SKIPPED (nyquist_validation disabled or not applicable)" and runs no check 8a-8e.
Nyquist validation (checker Dimension 8): applies; {{validationPath}} exists, so check 8e passes; run checks 8a-8d.
</planning_context>
