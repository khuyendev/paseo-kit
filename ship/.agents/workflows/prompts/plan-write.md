<!--
GSDF-24: the planner of one plan (session planner:<id>), on the frozen outline. Contract: `ph gsd verify plan-structure` checks
the plan; the reply is PLANNER_SCHEMA. Variables: context, specless, plan, id, manifest, entry (JSON), owns (JSON), wave, sameWave
(`<plan> <owns entry>` of the other plans of the wave, joined by `; `, or none), wiring,
carried (`- ` lines of the open skeleton warnings of this plan, or empty), policy,
returnNote, digest.
-->
{{context}}

{{specless}}

Write {{plan}} for plan {{id}} only.

Manifest entry ({{manifest}}): {{entry}}

owns from the outline (put them in the plan frontmatter and add every path your tasks change that they lack): {{owns}}

Owned by other plans of wave {{wave}} (never in this plan's owns; a change one of them needs goes to its plan in plan_changes): {{sameWave}}

{{wiring}}

Open skeleton warnings for this plan:
{{carried}}

Threat ids in this plan use only {{threatRange}} (for example {{threatExample}}). Any other T-<phase>-<number> id belongs to another plan.

{{policy}}

{{returnNote}}

{{digest}}
