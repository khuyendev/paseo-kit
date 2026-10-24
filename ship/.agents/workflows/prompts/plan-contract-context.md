<!--
Kit feedback 67 F2: a reviser's contract block. Contract: a reply with marker CONTRACT_CHANGE and contract_changes entries is
applied by `ph gsd contracts change` and the consumers are revised by the next contract gate. Variables: parts (per plan: what it
produces, its consumers per produced symbol, what it consumes).
-->
<contract_context>
{{parts}}
The manifest owns every produced signature. Never change a produced signature in plan text, and keep every consumed signature quoted exactly as the manifest has it. When an issue can only be met by a different signature, leave the plan on the manifest signature and return marker CONTRACT_CHANGE with contract_changes: [{plan, symbol, old, new, reason}], one entry per symbol: the flow updates the manifest and has every consumer revised in this run. Return REVISION_CONFLICT when a consumer cannot follow. A symbol the manifest does not produce yet is an addition, not an outline change: the same list with old "" and file and kind set (file inside this plan's owns). ph gsd contracts change adds it and replans that plan and its consumers. A new plan, wave or requirement stays an outline decision (ph gsd decide --outline).
</contract_context>
