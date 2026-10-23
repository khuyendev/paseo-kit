<!--
GSDF-20: the adapter architect writes WIRING.md. Contract: the reply is ARCHITECT_SCHEMA (lib/flow-plan.mjs); outlineChanges
become skeleton issues, conflicts stop needs-owner. Variables: context, wiring, outline, manifest, why, policy, digest.
-->
{{context}}

Write only {{wiring}}: the wiring contract of the cross-plan edges of {{outline}} (manifest {{manifest}}). {{why}}

Return JSON {status: complete|conflict, sharedChanges[], outlineChanges[], conflicts[]}. outlineChanges are changes the outline must make; conflicts are contradictions only the owner can settle.

{{policy}}

{{digest}}
