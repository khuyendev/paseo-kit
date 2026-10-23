<!--
O65: the resolution check of a plan's checker blockers in its streams-join route. Contract: the reply is RESOLUTION_SCHEMA; the
route-done op of flow verb plan-checker (part join) reads it. Variables: plans, blockers (JSON), policy, freezeDigest, keyDigest.
-->
Resolution check, read-only, of plan checker blockers after a revision of {{plans}}.

Blockers (JSON): {{blockers}}

Return JSON {resolved: [{id, evidence}]} listing only the ids the plans now resolve, each with evidence. Do not raise new issues; an id you do not list stays open.

{{policy}}

{{freezeDigest}}

{{keyDigest}}
