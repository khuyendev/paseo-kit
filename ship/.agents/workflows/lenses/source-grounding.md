# Lens: source-grounding

Is every concrete reference in the plan real?

Resolve each cited symbol, file path, command, configuration key and test name against the code root (search the repository; do not trust the plan's wording):
- Report `MISSING <reference>` when a cited symbol or path does not exist and no task of this plan or an earlier-wave plan creates it.
- Report `MISMATCH <reference>` when it exists with another signature, location or meaning than the plan assumes.
- A reference created by this plan's own tasks is fine; say which task creates it.

Severity: high for MISSING or MISMATCH that a task depends on (actionable: true); low otherwise. Quote the plan line and the search you ran as evidence.
