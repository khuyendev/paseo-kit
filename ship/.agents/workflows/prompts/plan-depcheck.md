<!--
O67: a read-only dependency check of one plan against its providers' interface before and after their revision. Contract: the
reply is ISSUES_SCHEMA; the dep op of flow verb plan-checker (part dependents) counts it. Variables: plan, providers, interfaces
(JSON), policy, freezeDigest, planDigest.
-->
Dependency check, read-only, of {{plan}} after a revision of the plans it depends on: {{providers}}.

Their declared interface before and after the revision (JSON): {{interfaces}}

Read the providers as they are now. Return JSON {issues: [{plan, dimension, severity (blocker|warning|info), required_property, description, fix_hint}]}: one blocker for each place this plan still uses a name, signature, parameter, path or link the revision renamed, changed or removed; an empty list when it matches the providers as they are now.

{{policy}}

{{freezeDigest}}

{{planDigest}}
