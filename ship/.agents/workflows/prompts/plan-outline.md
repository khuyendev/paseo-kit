<!--
GSDF-19: the outline writer (session planner:outline). Contract: the outline check `ph gsd outline check` (the writer runs it
itself, G027) and the `## OUTLINE COMPLETE` marker; the reply is PLANNER_SCHEMA. Variables: context, specless, outline, manifest,
contracts (plan-outline-contracts, or empty without gsd.contract_check), ph, checkArgs, policy, returnNote, digest.
-->
{{context}}

{{specless}}

Write the phase outline {{outline}} (table: Plan ID, Objective, Wave, Depends, Requirements; last line exactly `## OUTLINE COMPLETE`) and its manifest {{manifest}} ({phase, plans:[{id, owns, requirements, produces, consumes, tracer, verify}]}). Do not write PLAN files yet.

Each plan id NN-MM is assigned the threat-id range T-NN-MMxx (T-NN-MM plus exactly two digits). Do not write threat ids in the outline; the planner of that plan is told its range.

{{contracts}}

Before you return, run `node {{ph}} gsd {{checkArgs}}`, repair every error it reports in {{outline}} and {{manifest}}, and run it again until it exits 0.

{{policy}}

{{returnNote}}

{{digest}}
