<!--
The shared-change fixer of gsd-execute (G089, G083, kit feedback 82, 86): changes no open plan owns. Contract: the shared schema
of exec-setup (per change {index, applied, evidence}, status, outside); state-shared applied records the changes present.
Variables: label, files (JSON list), changes (JSON list of {index, from, path, change, reason, via?, outputs?}), via (a change
names a generator), digest.
-->
Shared changes for {{label}}: no open plan of the phase owns these paths, so you make them. You own exactly these files: {{files}}. Make each change below and nothing else; never commit.

Changes (JSON): {{changes}}
{{#via}}

A change with via is made by running that generator command (it rewrites every file in its outputs); never edit a generated file by hand.
{{/via}}

Check only the shared files you changed (a syntax, format or analysis check of those files). Do not run other test files or whole suites: the gate that follows verifies the change, and a failure outside these files belongs to the plan fixers that gate runs. Name such a failure in outside, and still report your changes.

Report per change. Return JSON {changes: [{index, applied, evidence}], status: fixed|unresolved, attempts, remaining_failures, evidence, outside}: applied is true when that change is present in its file (made by you or already there); status is unresolved only when a change could not be made.

{{digest}}
