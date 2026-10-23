<!--
The integration fixer of gsd-execute (G064): gate failures no plan owns, in files it owns exactly. Contract: the fixer schema;
the files are recorded with state-integration before the call. Variables: files (JSON list), failures (text), digest.
-->
Integration fix: these gate failures belong to no plan. You own exactly these files: {{files}}.

{{failures}}

Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence}.

{{digest}}
