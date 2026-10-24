<!--
Kit feedback 67 F1, 76: the planner writes each produced signature as the manifest has it and quotes each consumed one in
<interfaces>; `ph gsd verify contracts` checks it. Variables: produces, consumes (JSON manifest entries, or empty).
-->
Contract: this plan produces (write each signature verbatim in the plan and in <interfaces>; never re-describe or change it): {{produces}}
Contract: this plan consumes (quote each signature verbatim in <interfaces>; call it only as written there): {{consumes}}
If this plan needs an ancestor widget, a provider override or a registration that another plan provides, list it in must_haves.key_links as `- requires: {kind: ancestor_widget|provider_override|registration, name: <name>, by: <plan id>}`; a plan that mounts or registers one lists `- provides: {kind: ..., name: ..., at: <file>}`. The provider is in the same or an earlier wave.
A symbol this plan must produce that the manifest does not list is an addition, not an outline change: return REVISION_CONFLICT with contract_changes [{plan, symbol, old: "", new: the signature, file, kind, reason}] where file is inside owns.
