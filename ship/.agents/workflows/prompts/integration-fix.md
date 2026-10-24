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
You may run the failing test files of these failures yourself: {{tests}}. Run them only through `ph gsd test-run` with those files, never by invoking {{command}} yourself: the verb takes the project test lock, runs that command (it carries the per-test timeout), bounds each file, writes the full output to a file and prints a short failure summary and that file's path. Read the failures from that file, never from a truncated terminal. Nothing else: not the build, not the whole suite, no other test file. At most {{attempts}} runs within {{minutes}} minutes of these failing files (a run of anything else does not count; this allowance is at least the number of failing files plus 2), and once more after your last edit. Every file but the ones you own stays read-only, also when a run fails there: name such a failure in your evidence. A test that hangs, or an error after the tests passed (an uncaught exception at dispose, a timer or a stream left open), shows only in such a run: say in your evidence what your last run showed. A file the verb reports hung hit its whole-file bound; name it. An unverified last edit is not an owner decision: return lastEdit unverified, or put [UNVERIFIED] in evidence, and the next gate verifies the edit. Say that you need an owner decision only when you actually do.
</kit_fix_runtime>
{{/tests}}

{{failures}}

Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.

{{digest}}
