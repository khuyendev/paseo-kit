<!--
A fix round of gsd-execute sent to the plan's executor session (same options as its brief). Contract: the reply is the exec
schema again; exec-verdict reads its owner decision, exec-route its requests, resolvedRequests close requests. Variables: round,
plan, failures (the gate failures of the plan as text, or empty), requests (JSON list or empty), evidence (the gate evidence
file), digest; kit feedback 102 F3: tests (JSON list of the test files of its failures that it may run, exec-fixers; empty when
gsd.fixer_verifies_itself is false or no failure names one) with command (JSON argv: the gate's test command, carrying the
per-test timeout adapter.commands.test_case_timeout_s when declared), attempts and minutes (gsd.fixer).
-->
Fix round {{round}} for plan {{plan}}: the gate failed on your owned files. Fix only inside your owns{{^tests}}; do not run the build or the tests{{/tests}}.
{{#tests}}
<kit_fix_runtime>
You may run the failing test files of these failures yourself: {{tests}}. Run them with {{command}} followed by those files, and nothing else: not the build, not the whole suite, no other test file. At most {{attempts}} runs within {{minutes}} minutes, and once more after your last edit. Every file outside your owns stays read-only, also when a run fails there: a change it needs is a request. A test that hangs, or an error after the tests passed (an uncaught exception at dispose, a timer or a stream left open), shows only in such a run: say in your evidence what your last run showed. When the command carries no per-test timeout, stop a run that makes no progress for a few minutes and report the hang.
</kit_fix_runtime>
{{/tests}}
{{#failures}}

{{failures}}
{{/failures}}
{{#requests}}

Change requests from other plans of this wave (JSON): {{requests}}
{{/requests}}

Evidence: {{evidence}}

Return the same JSON as before, with resolvedRequests listing only request paths you actually resolved.

{{digest}}
