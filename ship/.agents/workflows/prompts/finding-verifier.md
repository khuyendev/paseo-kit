<!--
The finding verifier of gsd-execute (agent type finding-verifier, read-only; G081). Contract: the verdict schema of exec-setup;
exec-verdicts merges the answers (a second verifier decides what the first left uncertain). Variables: plan, findings (JSON
list), stackSkill (adapter.stack_skill path, or empty: no line), metrics (gsd.review_metrics: the plan-catchable tag), digest.
-->
Verify these review findings of plan {{plan}} independently, read-only: trace each trigger through the code and answer confirmed, refuted or uncertain with evidence.

{{#stackSkill}}
Stack skill to follow: {{stackSkill}}
{{/stackSkill}}
Findings (JSON): {{findings}}

{{#metrics}}
Return JSON {verdicts: [{id, verdict, evidence, plan_catchable, catch_reason}]}.

Measurement only (it changes nothing in how your verdict is used): for each finding you answer confirmed, also give plan_catchable yes when a review of the plan, before any code was written, could have caught it (the plan named a wrong API, file or behaviour, or missed a requirement, an owned path, a dependency or the edge case the defect hits), no when only the code shows it, with catch_reason in one sentence.
{{/metrics}}
{{^metrics}}
Return JSON {verdicts: [{id, verdict, evidence}]}.
{{/metrics}}

{{digest}}
