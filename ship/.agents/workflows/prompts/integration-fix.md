<!--
The integration fixer of gsd-execute (G064): gate failures no plan owns, in files it owns exactly. Contract: the fixer schema;
the files are recorded with state-integration before the call. Variables: files (JSON list), failures (text), digest; kit
feedback 102 F3: tests (JSON list of the test files of its failures that it may run, exec-fixers; empty when
gsd.fixer_verifies_itself is false or no failure names one) with command (JSON argv: the gate's test command, carrying the
per-test timeout when declared), attempts and minutes (gsd.fixer).
-->
Integration fix: these gate failures belong to no plan. You own exactly these files: {{files}}.
{{#tests}}
<kit_fix_runtime>
You may run the failing test files of these failures yourself: {{tests}}. Run them with {{command}} followed by those files, and nothing else: not the build, not the whole suite, no other test file. At most {{attempts}} runs within {{minutes}} minutes, and once more after your last edit. Every file but the ones you own stays read-only, also when a run fails there: name such a failure in your evidence. A test that hangs, or an error after the tests passed (an uncaught exception at dispose, a timer or a stream left open), shows only in such a run: say in your evidence what your last run showed. When the command carries no per-test timeout, stop a run that makes no progress for a few minutes and report the hang.
</kit_fix_runtime>
{{/tests}}

{{failures}}

Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.

{{digest}}
