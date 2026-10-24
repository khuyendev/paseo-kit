<!--
The code reviewer of gsd-execute (agent type gsd-code-reviewer, read-only; GSDF-46..48, GSDF-92). Contract: the findings schema
of exec-setup; exec-findings classes each finding (pre-existing by the changed lines, G056 gate rules). Variables: plan, planPath,
depth (gsd.review_depth), scope (files, comma separated), lines (changed lines per file), codeOnly, built (the build state when
not code-only), lenses (one line per lens), stackSkill (adapter.stack_skill path, or empty: no line), generated (names of
generated files left out of the scope, or empty: no line; kit feedback 120), digest.
-->
Review plan {{plan}} ({{planPath}}) at depth {{depth}}. Review only these files: {{scope}}.
{{#generated}}
Generated files were left out of this review: {{generated}}. Review the source and the generator command, not the output.
{{/generated}}

{{#stackSkill}}
Stack skill to follow: {{stackSkill}}
{{/stackSkill}}
Lines this plan changed:
{{lines}}

{{#codeOnly}}This code is not built yet (code-only review).{{/codeOnly}}{{^codeOnly}}{{built}}{{/codeOnly}}

Lenses:
{{lenses}}

Every finding carries trigger (the concrete input or sequence that makes it fail), likelihood (likely|possible|theoretical), confidence 0-100, impact, file and line.

Set introduced true when this plan's change causes the defect, also on an unchanged line (a caller broken by a changed signature); false when the defect was there before the change. A defect outside the changed lines that the change did not cause is recorded as pre-existing and does not block.

Report one defect once: when the same defect occurs in several places, give it a class (a short name of the defect kind) and list every other place in the reviewed files as instances [{file, line}], so one fix covers all of them.

Return JSON {findings: [{id, severity (critical|high|medium|low|info), trigger, likelihood, confidence, impact, file, line, description, introduced, class, instances}]}; an empty findings list when nothing needs fixing.

{{digest}}
