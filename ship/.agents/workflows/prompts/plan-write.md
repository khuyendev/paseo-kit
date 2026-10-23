<!--
GSDF-24: the planner of one plan (session planner:<id>), on the frozen outline. Contract: `ph gsd verify plan-structure` checks
the plan; the reply is PLANNER_SCHEMA. Variables: context, specless, plan, id, manifest, entry (JSON), owns (JSON), wiring,
carried (`- ` lines of the open skeleton warnings of this plan, or empty), contract (plan-write-contract, or empty), policy,
returnNote, digest.
-->
{{context}}

{{specless}}

Write {{plan}} for plan {{id}} only.

Frozen manifest entry ({{manifest}}): {{entry}}

owns (repeat exactly in the plan frontmatter): {{owns}}

{{wiring}}

Open skeleton warnings for this plan:
{{carried}}

{{contract}}

{{policy}}

{{returnNote}}

{{digest}}
