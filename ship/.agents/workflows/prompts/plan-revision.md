<!--
The <revision_context> of a gsd-plan revision: each issue is answered by one `changes` entry of the planner reply.
Variables: plans (the files to revise), issues (JSON).
-->
<revision_context>
Existing plans: {{plans}}
Checker issues (JSON): {{issues}}
Instructions: revise in place only what the issues require. Answer every issue with one `changes` entry {issue, change}; when an issue contradicts a locked decision or another issue, return REVISION_CONFLICT with the conflict instead of guessing.
</revision_context>
