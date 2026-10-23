<!--
A fix round of gsd-execute sent to the plan's executor session (same options as its brief). Contract: the reply is the exec
schema again; exec-verdict reads its owner decision, exec-route its requests, resolvedRequests close requests. Variables: round,
plan, failures (the gate failures of the plan as text, or empty), requests (JSON list or empty), evidence (the gate evidence
file), digest.
-->
Fix round {{round}} for plan {{plan}}: the gate failed on your owned files. Fix only inside your owns; do not run the build or the tests.
{{#failures}}

{{failures}}
{{/failures}}
{{#requests}}

Change requests from other plans of this wave (JSON): {{requests}}
{{/requests}}

Evidence: {{evidence}}

Return the same JSON as before, with resolvedRequests listing only request paths you actually resolved.

{{digest}}
