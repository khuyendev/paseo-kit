<!--
GSDF-21: one read-only skeleton review lane. Contract: the reply is ISSUES_SCHEMA; the issues go to the skeleton book (flow verb
plan-skeleton). Variables: lens (the lane's lens text), phase, goal (" (goal: ...)" or empty), files, requirements, tracer,
warnings (JSON), edges (JSON), focusNamed and focusChanged (after a reallocation, else empty), policy, digest.
-->
{{lens}}

Review the skeleton of phase {{phase}}{{goal}} read-only. Frozen snapshot: {{files}}.

Requirement IDs: {{requirements}}. TRACER_MODE: {{tracer}}.

Mechanical warnings: {{warnings}}. Cross-plan edges: {{edges}}.

Reallocation: the plan checker sent {{focusNamed}} back to the outline and the allocation of {{focusChanged}} changed (owned paths split or moved). The rest of the skeleton passed review before: judge the changed plans and the edges to and from them.

Return JSON {issues: [{plan, dimension, severity (blocker|warning|info), required_property, description, evidence, fix_hint, target (outline|wiring|both)}]}; an empty list when the skeleton holds under this lens.

{{policy}}

{{digest}}
