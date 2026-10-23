<!--
GSDF-21: one read-only skeleton review lane. Contract: the reply is ISSUES_SCHEMA; the issues go to the skeleton book (flow verb
plan-skeleton). Variables: lens (the lane's lens text), phase, goal (" (goal: ...)" or empty), files, requirements, tracer,
warnings (JSON), edges (JSON), focusNamed and focusChanged (after a reallocation, else empty), decisions (the owner's decisions,
one line each; kit feedback 99), inherited (JSON [{file, plans, owners}]: the existing test files the manifest's verify commands
run, the plans that run each and the plans that own it; kit feedback 101), policy, digest. An empty optional variable leaves its
paragraph out.
-->
{{lens}}

Review the skeleton of phase {{phase}}{{goal}} read-only. Frozen snapshot: {{files}}.

Requirement IDs: {{requirements}}. TRACER_MODE: {{tracer}}.

Mechanical warnings: {{warnings}}. Cross-plan edges: {{edges}}.

Owner decisions (`ph gsd decide`; they hold where they differ from CONTEXT, a decision naming plans binds those plans):
{{decisions}}

Existing tests the verify commands run, with the plans that own them: {{inherited}}. Judge whether each is owned by the plan that changes the behaviour it asserts, and whether a plan changes behaviour such a test asserts without owning the test (raise it with target outline).

Reallocation: the plan checker sent {{focusNamed}} back to the outline and the allocation of {{focusChanged}} changed (owned paths split or moved). The rest of the skeleton passed review before: judge the changed plans and the edges to and from them.

Return JSON {issues: [{plan, dimension, severity (blocker|warning|info), required_property, description, evidence, fix_hint, target (outline|wiring|both)}]}; an empty list when the skeleton holds under this lens.

{{policy}}

{{digest}}
