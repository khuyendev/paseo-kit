<!--
The executor brief of gsd-execute (agent type gsd-executor, session `executor:<plan>`, worktree isolation per gsd.isolation).
Contract: the reply is the exec schema of flow verb exec-setup (taskResults, deviations, requests, resolvedRequests, kitNotes,
plan_defects with gsd.review_metrics); exec-verdict judges it, exec-route routes its requests, transfer and spot-check take its
SUMMARY. Variables: plan (plan file), snapshot (input snapshot root or empty), summary, owns (JSON list), stackSkill,
generated (JSON list of adapter.ownership.regenerated or empty), pending (gsd.pending_request_tasks), metrics
(gsd.review_metrics), answers, notes, accepted (the confirmed accepted checker issues of the plan, kit feedback 89),
requests (JSON lists or empty), digest. Kit feedback 122: check (adapter.commands.check_files is set) with checkCommand (JSON argv, `{files}` is one word) and checkFiles (JSON list of the plan's owned changed files); selfVerify (gsd.executor_verifies_itself) with verifyCommand (JSON argv of the gate's test command), verifyAttempts and verifyMinutes (gsd.fixer). The overlay states the rule; these lines are only the binding. Empty when unset.
-->
<kit_executor_runtime>
Plan: {{plan}}
{{#snapshot}}
Planning inputs (.planning/ files, the stack skill) are read, read-only, from the immutable input snapshot {{snapshot}}: they may not be committed into your worktree. Write code and your SUMMARY only in your worktree.
{{/snapshot}}
Write your SUMMARY to exactly: {{summary}}
You may edit only these paths (owns): {{owns}}
{{#check}}
Check command: {{checkCommand}}
Check files: {{checkFiles}}
{{/check}}
{{#selfVerify}}
Self-verify command: {{verifyCommand}}
Self-verify attempts: {{verifyAttempts}}
Self-verify minutes: {{verifyMinutes}}
{{/selfVerify}}
Stack skill to follow: {{stackSkill}}
- A change needed in a file you do not own: do not edit it; return it in requests [{path, change, reason}].
{{#generated}}
- A file matching {{generated}} is generated: a change to it is made through its generator, so its request also names via (the generator command) and outputs (every file the generator rewrites, that file included); a request for it without them is refused.
{{/generated}}
- Before you return, delete every file you created outside owns (your SUMMARY excepted): scratch files are cleanup, not a Rule-4 decision.
Return JSON {taskResults: [{task, status: implemented|{{#pending}}pending-request|{{/pending}}partial|blocked|skipped, evidence{{#pending}}, blockedBy{{/pending}}}], deviations: [{rule, kind, note}], requests: [{path, change, reason}], kitNotes: [string]}.
{{#metrics}}
Measurement only (it changes nothing in how your reply is judged): when the plan itself was wrong (it named an API, file or symbol that does not exist or behaves otherwise, its owns did not reach a file the work needed, or it missed a dependency), list each such plan defect in plan_defects [{kind: wrong-api|owns-reach|missing-dependency|other, evidence}]; an empty list otherwise.
{{/metrics}}
</kit_executor_runtime>
{{#answers}}

Owner answers to earlier halts of this plan (JSON); follow them: {{answers}}
{{/answers}}
{{#notes}}

Plan-review notes for this plan (medium or low, not blocking; act on each one inside your owns, else say why in your SUMMARY): {{notes}}
{{/notes}}
{{#accepted}}

Checker issues of this plan that the owner accepted at planning (forceProceed) and confirmed for execution (JSON): {{accepted}}. The plan runs with them as they are: do not work around them outside your owns; when a task cannot be done because of one, return it partial with the issue id in its evidence.
{{/accepted}}
{{#requests}}

Change requests from other plans for files you own (JSON): {{requests}}. Make them inside your owns and list each request path you resolved in resolvedRequests.
{{/requests}}

{{digest}}
