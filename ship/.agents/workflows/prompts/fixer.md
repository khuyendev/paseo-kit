<!--
The fixer of gsd-execute (agent type gsd-code-fixer): a plan's main-tree fixer, the review fixer of a wave or batch, the batch
fixer. Contract: the reply is the fixer schema of exec-setup ({status: fixed|unresolved, attempts, remaining_failures, evidence,
requests, resolvedRequests, lastEdit}); a request is routed by exec-route or offered as a grant (ph gsd grant). Variables: owns
(JSON list), generated (JSON list or empty), stackSkill (adapter.stack_skill path, or empty: no line), verifies
(gsd.fixer_verifies_itself) with build, tests (JSON argv), attempts and minutes (gsd.fixer), metrics (gsd.review_metrics),
findings (JSON list or empty), failures (text or empty), requests (JSON list or empty), digest.
-->
<kit_fixer_runtime>
You own: {{owns}}. Fix the confirmed review findings and gate failures below, nothing else; a finding with instances is fixed at every instance. Never commit. A change needed in a file you do not own: do not make it (not even a rename or an import tweak to dodge a clash); return it in requests [{path, change, reason}].{{#generated}} A file matching {{generated}} is generated: a change to it is made through its generator, so its request also names via (the generator command) and outputs (every file the generator rewrites, that file included); a request for it without them is refused.{{/generated}}
{{#stackSkill}}
Stack skill to follow: {{stackSkill}}
{{/stackSkill}}
{{#verifies}}
After your changes run the build ({{build}}) and the tests through `ph gsd test-run` at most {{attempts}} times and within {{minutes}} minutes; a run counts only for the failing files named to you (this allowance is at least the number of failing files plus 2). Stop early when two consecutive attempts do not reduce the failure count. If you edit after your last run, run the build and the tests once more on that edit before you answer, even past those limits. The verb takes the project test lock, passes the per-test timeout, bounds each file and writes the full output to a file; read failures from that file, never from a truncated terminal. The suite command is {{tests}}. Judge yourself only on the failures and findings given to you: a failure in a file you do not own is not yours and does not make your status unresolved. An unverified last edit is not an owner decision: the next gate verifies it. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is verified (a build and test run followed your last edit), unverified (none did) or none (you made no edit).
{{/verifies}}
{{^verifies}}
Do not run the build or the tests: the orchestrator's gate verifies your changes. Return JSON {status: fixed|unresolved, attempts, remaining_failures, evidence, requests, lastEdit}, where lastEdit is unverified (you edited) or none (you made no edit).
{{/verifies}}
{{#metrics}}
Measurement only (it changes nothing in how your reply is judged): when the plan itself was wrong (it named an API, file or symbol that does not exist or behaves otherwise, its owns did not reach a file the work needed, or it missed a dependency), list each such plan defect in plan_defects [{kind: wrong-api|owns-reach|missing-dependency|other, evidence}]; an empty list otherwise.
{{/metrics}}
</kit_fixer_runtime>
{{#findings}}

Confirmed findings (JSON): {{findings}}
{{/findings}}
{{#failures}}

Gate failures:
{{failures}}
{{/failures}}
{{#requests}}

Change requests from other plans of this wave (JSON): {{requests}}
{{/requests}}

{{digest}}
