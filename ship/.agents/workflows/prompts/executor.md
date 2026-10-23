<!--
The executor brief of gsd-execute (agent type gsd-executor, session `executor:<plan>`, worktree isolation per gsd.isolation).
Contract: the reply is the exec schema of flow verb exec-setup (taskResults, deviations, requests, resolvedRequests, kitNotes,
plan_defects with gsd.review_metrics); exec-verdict judges it, exec-route routes its requests, transfer and spot-check take its
SUMMARY. Variables: plan (plan file), snapshot (input snapshot root or empty), summary, owns (JSON list), stackSkill,
generated (JSON list of adapter.ownership.regenerated or empty), pending (gsd.pending_request_tasks), metrics
(gsd.review_metrics), answers, notes, requests (JSON lists or empty), digest.
-->
<kit_executor_runtime>
Plan: {{plan}}
{{#snapshot}}
Planning inputs (.planning/ files, the stack skill) are read, read-only, from the immutable input snapshot {{snapshot}}: they may not be committed into your worktree. Write code and your SUMMARY only in your worktree.
{{/snapshot}}
Write your SUMMARY to exactly: {{summary}}
You may edit only these paths (owns): {{owns}}
Stack skill to follow: {{stackSkill}}
Deviation rules (the kit adapter of the rules in your role text):
- Rules 1-3 (bugs, missing critical functionality, blockers): fix automatically, only inside owns; at most 3 auto-fix attempts per task, then list it under Deferred Issues in the SUMMARY.
- Rule 3 never covers package installs: a needed install, or one that fails, returns a blocking human checkpoint (task status blocked, deviation {rule: 3, kind: checkpoint}).
- Rule 4 (architectural change): stop the task and return status partial with the decision needed in the deviation notes ({rule: 4, note}).
- A change needed in a file you do not own: do not edit it; return it in requests [{path, change, reason}].
{{#generated}}
- A file matching {{generated}} is generated: a change to it is made through its generator, so its request also names via (the generator command) and outputs (every file the generator rewrites, that file included); a request for it without them is refused.
{{/generated}}
{{#pending}}
- A task that is done on your side but whose test or check passes only once a request you returned is made (you may not run the tests): status pending-request with blockedBy [the request paths], not partial. partial is only for a decision the owner must make.
{{/pending}}
- Observations about the kit, its tools or its wrappers (not about the project) go in kitNotes [string]; never in a request: a request for a kit-feedback document is refused.
- Before you return, delete every file you created outside owns (your SUMMARY excepted): scratch files are cleanup, not a Rule-4 decision.
- Never commit, stage or stash; never write STATE, ROADMAP or REQUIREMENTS.
- The orchestrator's gate runs the build and the tests after the wave: do not run them yourself.
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
{{#requests}}

Change requests from other plans for files you own (JSON): {{requests}}. Make them inside your owns and list each request path you resolved in resolvedRequests.
{{/requests}}

{{digest}}
