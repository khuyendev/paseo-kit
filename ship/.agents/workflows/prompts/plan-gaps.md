<!--
GSDF-30: the gap planner (session planner:gaps), one execution wave of gap_closure plans from the verification gaps. The reply is
PLANNER_SCHEMA. Variables: context, report, gaps (JSON), phaseDir, nn, first (the first plan number), kept (gap plans this attempt
already wrote, or empty), policy, returnNote, digest.
-->
{{context}}
<gap_context>
Verification report: {{report}} (status gaps_found). Gaps (JSON): {{gaps}}
Write one plan per gap group as {{phaseDir}}/{{nn}}-<MM>-PLAN.md numbered from {{nn}}-{{first}}, each with frontmatter gap_closure: true and owns taken from the plans that own the gaps' files.
All gap plans form ONE execution wave: no dependencies between them.
Gap plans already written by this attempt (keep them; write only the missing ones): {{kept}}
</gap_context>

{{policy}}

{{returnNote}}

{{digest}}
