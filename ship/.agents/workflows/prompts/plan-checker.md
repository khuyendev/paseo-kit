<!--
GSDF-26: one fresh read-only plan checker. Contract: the reply is CHECKER_SCHEMA (CHECKER_SCHEMA_REALLOC with reallocation);
the round op of flow verb plan-checker counts it. Variables: phase, plans, context, filesWarning and filesBlocker (or empty),
tracerWarning and tracerBlocker (or empty), sendBackFile (with reallocation, else empty), probeFile, carried (`- ` lines, or empty),
earlier (JSON of the still-open blockers, or empty), policy, freezeDigest, checkedDigest.
-->
Check the plans of phase {{phase}} read-only: {{plans}}.

{{context}}

Files per plan: warning at {{filesWarning}}+, blocker at {{filesBlocker}}+ (use these for the Files/plan thresholds).

Tracer files per plan (a plan with a type="tracer" task): warning at {{tracerWarning}}+, blocker at {{tracerBlocker}}+.

Files per plan is judged by a deterministic probe ({{sendBackFile}}): do not raise a Files/plan issue. Give an issue "outcome": "reallocate" only when its only fix is a different split of the owned paths between plans (the plan's owns, which a revision of the plan cannot change); every other issue has outcome "revise".

Deterministic probe results are in {{probeFile}}: they are already counted; do not re-derive them, do not repeat them as issues.

Carried warnings:
{{carried}}

Blockers from earlier checker iterations, still open? Judge each against the plans as they are now. Repeat it in issues (same plan, dimension and required_property) while it holds; list its id in resolved, with evidence, once it is fixed. An id you do not list stays open.
{{earlier}}

Return JSON {issues: [{plan (null for phase-level), dimension, severity (blocker|warning|info), required_property (the invariant that must hold), description (the evidence it does not), fix_hint}], resolved: [{id, evidence}] (only ids of the still-open blockers above)}.

{{policy}}

{{freezeDigest}}

{{checkedDigest}}
