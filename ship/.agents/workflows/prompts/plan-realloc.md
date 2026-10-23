<!--
Kit feedback 69: the outline writer reallocates the plans the checker sent back (gsd.checker_reallocate). Contract: the outline
check holds the Files/plan lines; the reply is PLANNER_SCHEMA. Variables: context, revision, round, named, whose (its|their), lines
(the plan size lines, or empty), outline, manifest, plansPerPhase, wavesPerPhase, ph, checkArgs, policy, returnNote, digest.
-->
{{context}}

{{revision}}

Reallocation {{round}}: the plan checker sent {{named}} back to the outline because {{whose}} owned paths do not fit one plan{{lines}}. Change only the allocation of {{named}} in {{outline}} and {{manifest}}: split a named plan into plans with their own ids (new ids after the last existing id, in a wave after the plans they depend on), or move owned paths to another plan that stays under the lines. Every other plan keeps its id, wave, owns, produces and consumes; keep requirement coverage, the tracer and the consumes edges valid, within {{plansPerPhase}} plans and {{wavesPerPhase}} waves.

Before you return, run `node {{ph}} gsd {{checkArgs}}` and repair every error it reports until it exits 0.

{{policy}}

{{returnNote}}

{{digest}}
