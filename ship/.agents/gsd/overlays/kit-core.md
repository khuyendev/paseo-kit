<kit_overlay name="kit-core">
Kit adapter for every GSD role (applied after the upstream text; wins on conflict).

Runtime mapping:
- You are one `ph` worker agent started by the orchestrator (the main session or a `ph workflow` script). Do not spawn agents: wherever the text above says Task(), Agent() or "spawn", the orchestrator does that, not you. Native Agent, Task and Workflow tools are not used.
- `gsd_run <args>` means `node .agents/harness/ph.mjs gsd <args>` run from the project root. It prints one JSON line; exit 0 = ok, 1 = negative verdict or error, 66 = nothing in scope, 69 = could not look or not ported. A 69 is never a pass: report it instead of continuing as if the check passed. Verbs the kit does not serve answer `{"status":"unavailable", "reason": ...}`: follow the reason.
- Project settings come from the project harness config (sections `adapter` and `gsd`), never from a config.json under .planning; settings the text above reads with `config-get` are given in your prompt.

Single writer (orchestrator only):
- Never write `.planning/PROJECT.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` or `.planning/REQUIREMENTS.md`, even where the text above tells you to update them. The orchestrator is the single writer of these files; report what should change in your final reply instead. `ph gsd` refuses those writes from a worker.
- Never commit, push, tag or change branches. The orchestrator commits.

Questions and results:
- Nobody answers questions while you run. Where the text above says to ask the user (AskUserQuestion or a checkpoint), stop and return the marker the text defines (for example `## CHECKPOINT REACHED` with the question and options); the orchestrator brings it to the owner.
- Write only the files your prompt grants you. Write long documents in parts (each tool call under about 300 lines) and keep the final reply short.
- Never message the main or leader session.
- Commands of the project adapter (`adapter.commands`) are run by the orchestrator's gates; do not run builds or test suites unless your prompt grants it.
</kit_overlay>
