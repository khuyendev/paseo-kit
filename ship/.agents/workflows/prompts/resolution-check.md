<!--
The resolution check of gsd-execute (agent type gsd-code-reviewer, read-only; G080, G126). Contract: the resolution schema of
exec-setup; an id without an answer is unresolved. Variables: plan, findings (JSON list), digest.
-->
Resolution check of plan {{plan}}: decide for each finding below whether the current code resolves it; a finding with instances is resolved only when every instance is. Review only these findings; raise no new ones.

Findings (JSON): {{findings}}

Return JSON {resolution: [{id, resolved, evidence}]}.

{{digest}}
