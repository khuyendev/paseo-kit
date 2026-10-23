<!--
GSDF-22: a lane's resolution check of its own open skeleton issues after a revision. Contract: the reply is RESOLUTION_SCHEMA;
an id not listed stays open (flow verb plan-skeleton resolve). Variables: lens, files, issues (JSON), policy, digest.
-->
{{lens}}

Resolution check, read-only, of your own open skeleton issues after a revision. Snapshot: {{files}}.

Open issues (JSON): {{issues}}

Return JSON {resolved: [{id, evidence}]} listing only the ids now resolved, each with evidence. Do not raise new issues; an id you do not list stays open.

{{policy}}

{{digest}}
