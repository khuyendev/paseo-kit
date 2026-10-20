# Orchestrator Skill Template (v2)

`ph` = `node .agents/harness/ph.mjs`, run from the project root (see `paseo-runtime.md`).

The orchestrator coordinates the whole team. Provide three templates according to execution mode, and explain how to combine execution modes by phase.

- **Template A: Workflow orchestration** — large distributed runs or repeated verification with predefined control flow
- **Template B: Persistent agent collaboration** — iterative feedback, negotiation, and long-running collaboration where agents must retain prior conversation context
- **Template C: Subagent delegation** — delegate independent tasks in parallel once and collect only the results
- **Mixed mode** — combine the appropriate execution modes by phase

Every template checks existing work at Phase 0. Include `_workspace/` file layout rules, error handling, and test scenarios.

---

## Template A: Workflow orchestration

```markdown
---
name: {domain}-orchestrator
description: "Coordinate the {domain} workflow. Use when the user asks with one of {initial trigger keywords}, and also for follow-up work such as revising {domain} results, partial reruns, updates, additions, reruns, and improving previous results."
---

# {Domain} Orchestrator

## Execution mode: Workflow orchestration

This skill coordinates work with `node .agents/harness/ph.mjs workflow --script <file> --args-file <file>` scripts whose control flow is predefined. When the user invokes this skill, treat that as agreement to use a workflow. Limit the default number of agents to {N}. Increase the number of agents only when the user asks for "thorough", "exhaustive", or "all".

## Agent composition

| Role | `agentType` | Skill | Deliverable (`schema` summary) |
|------|-----------|------|--------------------|
| {collector} | {custom or default} | {skill} | {findings: [...]} |
| {verifier}  | {custom or default} | {skill} | {status, reason} |

For `{custom or default}`, enter the name of a custom type (an existing `.agents/agents/<name>.md`) or `default`. The runtime has no built-in types such as `Explore` or `general-purpose`: for a general agent omit `agentType`, and for read-only work add `readOnly: true`.

## Procedure

### Phase 0: Check existing work (handle follow-up requests)

1. Check whether `_workspace/` exists.
   - If not, → start from the beginning.
   - If it exists and the request is to fix only part of the work, → rerun only that part.
   - If it exists and new input was provided, → move the existing `_workspace/` to `_workspace_{ts}/` and start fresh.
2. For a partial rerun, if the previous run's `runId` is in `_workspace/run_meta.json`, proceed as follows:
   - Edit the script to change only that phase, then resume using `node .agents/harness/ph.mjs workflow --script <file> --args-file <file> --resume <runId>`. Unchanged `agent()` calls return cached results immediately, reducing run cost.
3. For a fresh run, continue with Phase 1. When Phase 2 starts the workflow, record the `runId` it prints (`workflow started <runId>: ...`) in `_workspace/run_meta.json`.

### Phase 1: Finalize the work list (the main agent does this directly)

Briefly inspect {file list / research dimensions / review targets} before starting the workflow, then organize them into an array. Pass the organized list to the script as `args`.

### Phase 2: Run the workflow

Pass the following script to the workflow. See `workflow-recipes.md` in the harness skill for detailed examples.

- `meta`: Set `name` to '{domain}-run' and `phases` to [{collection}, {verification}, {synthesis}].
- Collection: `pipeline(args.items, item => agent(..., {schema: COLLECT}))`
- Verification: adversarially verify each finding → `.filter(Boolean)` → pass only verified findings to the next phase
- Synthesis: `return` the structured results
- Run it with `node .agents/harness/ph.mjs workflow --script <file> --args-file <file> --detach`.

Watch the detached workflow with the Monitor tool using `node .agents/harness/ph.mjs watch-run <runId>`; it exits when the run ends, so the Monitor ends with it (re-arm only if the Monitor times out while the run is still going). On `workflow done`, read `<runDir>/result.json`; on `workflow failed`, read `journal.jsonl` and `log.txt`. Do not state or assume any result before the `workflow done` line arrives.

### Phase 3: Organize and report results

1. Receive the value returned by the workflow.
2. State in the report if any items were excluded or omitted.
3. Create the final deliverable at `{output-path}/{filename}`.
4. Keep intermediate deliverables and `run_meta.json` under `_workspace/`.

## Error handling

| Situation | Response |
|------|------|
| Individual `agent()` failure (returns `null`) | Exclude it with `.filter(Boolean)` and record the number excluded with `log()`. State the missing items in the report too. |
| Entire workflow failure | Check the actual return values in `journal.jsonl`, edit only the failed phase, and resume with `node .agents/harness/ph.mjs workflow --script <file> --args-file <file> --resume <runId>`. |
| Failure that will not improve on retry (quota exhausted, authentication expired, permission denied) | Do not retry or resume until the cause is resolved. It would only consume the remaining quota. Open `journal.jsonl` and partial deliverables directly to see how far the run actually got, record omissions in files under `_workspace/`, and report them to the user. For quota limits, also state when the quota resets. After the cause is resolved, continue with `node .agents/harness/ph.mjs workflow --script <file> --args-file <file> --resume <runId>`. The main agent may incorporate only facts it has directly verified; do not guess an agent's judgment (for example, which sources it excluded and why). |
| Empty result | Do not mistake it for success. Check each agent's actual return value in `journal.jsonl`. |
| Conflicting data | Do not delete either result; list them side by side with their sources. |

## Test scenarios

### Normal flow
1. When the user provides {input}, preliminary inspection finalizes {M} items.
2. The workflow collects {M} items and organizes the results if {K} of them pass verification.
3. Expected result: `{output-path}/{filename}` is created and run information is recorded in `run_meta.json`.

### Error flow
1. Two items return `null` during collection.
2. Exclude those items with `.filter(Boolean)` and report "2 items excluded" with `log()`.
3. State "Collection failed for 2 {item names}" in the final report.
```

---

## Template B: Persistent agent collaboration

```markdown
---
name: {domain}-orchestrator
description: "Coordinate {domain} agent collaboration. Use when the user asks with one of {initial trigger keywords}, and also for follow-up work such as revisions, partial reruns, updates, additions, reruns, and improving previous results."
---

# {Domain} Orchestrator

## Execution mode: Persistent agent collaboration

Do not create an explicit team object as in v1. Named agents started with `node .agents/harness/ph.mjs spawn` automatically belong to one collaboration group. `TeamCreate` and `TeamDelete` are tools used only in v1.

## Agent composition

| Name | `--type` | Role | Skill | Deliverable |
|------|--------------|------|------|------|
| {teammate-1} | {custom or none} | {role} | {skill} | {output-file} |
| {teammate-2} | {custom or none} | {role} | {skill} | {output-file} |

For `{custom or none}`, enter the name of a custom type (an existing `.agents/agents/<name>.md`) or leave `--type` out for a general agent; add `--read-only` for read-only work. There are no built-in types.

## Procedure

### Phase 0: Check existing work
As in Template A, check whether `_workspace/` exists to decide whether to start, rerun only part, or start fresh. For a partial rerun, include the previous deliverable paths in the agent prompts so agents read and incorporate existing results.

### Phase 1: Prepare
1. Analyze the user's input and identify {what to determine}.
2. Create `_workspace/` and save the input under `_workspace/00_input/`.

### Phase 2: Spawn agents and register tasks

1. Write one fanout file with a block per agent (`=== {teammate-1} type={type}` followed by its role, task and output path), then start them in parallel with `node .agents/harness/ph.mjs fanout --file <file> --ws _workspace` (no `--collect`). The block name is the agent's name, used to address it with `send`.
2. Register the shared task list.
   - `node .agents/harness/ph.mjs task add --ws _workspace --title "{task1}" --assignee {teammate-1}`
   - `node .agents/harness/ph.mjs task add --ws _workspace --title "{task3}" --depends-on 1`
   > Three to six tasks per teammate is appropriate. Explicitly declare task dependencies with `--depends-on`.

### Phase 3: Coordinate collaboration

- Watch for agent completion and waiting status with `node .agents/harness/ph.mjs watch <names>` under the Monitor tool. Check overall progress with `node .agents/harness/ph.mjs task list --ws _workspace`.
- Request a review with `node .agents/harness/ph.mjs send --prompt "Review {teammate-1}'s _workspace/01_... draft and report what to fix" {teammate-2}`. Forward the reply to {teammate-1} so they can revise. Agents retain prior conversation context, so you can narrow instructions with requests such as "only section 2 of that draft from earlier".
- If teammates need to discuss findings, relay messages as the leader. Always save deliverables to files.

**Deliverable locations:**

| Teammate | Output path |
|------|----------|
| {teammate-1} | `_workspace/{phase}_{teammate-1}_{artifact}.md` |
| {teammate-2} | `_workspace/{phase}_{teammate-2}_{artifact}.md` |

Use the batch file tools to read and edit files; advisory `tools:` lists do not remove them.

### Phase 4: Freeze deliverables

Named agents can receive messages even after reporting completion. If they revise a deliverable while answering another teammate's late question, the next phase may work from an earlier version. Do not block cross-check messages between teammates because they can catch errors. Instead, freeze deliverables at every phase boundary so files read by the next phase cannot change during its work. `tools:` lists and `--read-only` are advisory; agents always have the batch file tools, so freeze inputs and check them afterwards where edits would do harm.

1. Use `node .agents/harness/ph.mjs task list --ws _workspace` and `node .agents/harness/ph.mjs watch` completion lines to confirm that every teammate responsible for the previous phase has reported completion.
2. Notify those teammates of the freeze with `node .agents/harness/ph.mjs send`. For example: "Freeze the {phase} deliverables. If anything needs changing afterwards, do not edit the existing file. Write a new version such as `{phase}_{teammate}_{artifact}_v2.md` and notify the leader."
3. Record artifact hashes with `node .agents/harness/ph.mjs freeze --ws _workspace --phase {phase}`.
4. Pass both the artifact paths and freeze information to the next-phase agents in their prompts.

For multiple collaboration phases, follow this procedure at every phase boundary.

### Phase 5: Integrate
1. Use `node .agents/harness/ph.mjs task list --ws _workspace` to confirm that all tasks are complete.
2. Read each deliverable with the batch file tools and apply {integration/verification logic}.
3. Immediately before creating the final deliverable, verify that frozen deliverables have not changed with `node .agents/harness/ph.mjs freeze --check --ws _workspace --phase {phase}`. If a hash differs or a new version file exists, check what changed and decide whether to rerun the phases that read the old version.
4. Create the final deliverable at `{output-path}/{filename}`.

### Phase 6: Finish
1. Keep `_workspace/` so the work can be verified and the process reviewed later.
2. Summarize and report the results to the user.
   Archive the team with `node .agents/harness/ph.mjs archive` when its work is closed; use `node .agents/harness/ph.mjs stop` only to interrupt a running turn.

## Error handling

| Situation | Response |
|------|------|
| A teammate does not respond or has stopped | Check status with `node .agents/harness/ph.mjs team` and send instructions again with `node .agents/harness/ph.mjs send`. If they still fail, spawn the same custom type under a new name and pass the required task context in the prompt. |
| The stop was caused by quota exhaustion, expired authentication, or denied permission | Retrying would produce the same result, so do not resend instructions or spawn a replacement agent. Open partial deliverables directly to see how far work actually got, record omissions in files under `_workspace/`, and report them to the user. For quota limits, also state when the quota resets. The leader may incorporate only facts they directly verified; do not guess an agent's judgment (for example, which sources it excluded and why). |
| More than half the teammates fail | Tell the user and ask whether to continue. |
| The time limit is exceeded | Continue with results received so far and identify unfinished areas in the report. |
| Data conflicts | Do not delete either result; list them side by side with their sources. |
| Task status is stale | Check with `node .agents/harness/ph.mjs task list --ws _workspace`, then update it directly with `node .agents/harness/ph.mjs task update --ws _workspace <id> --status <status>`. |

## Test scenarios

### Normal flow
1. When the user provides {input}, start {N} agents and register {M} tasks in Phase 2.
2. Exchange feedback {K} times in Phase 3, freeze deliverables in Phase 4, then integrate results in Phase 5.
3. Expected result: `{output-path}/{filename}` is created.

### Error flow
1. {teammate-2} does not respond in Phase 3.
2. Check status with `node .agents/harness/ph.mjs team` and send instructions again with `node .agents/harness/ph.mjs send`. If they still fail, spawn a replacement agent named "{teammate-2}b" and pass the existing deliverable path.
3. State "Some {teammate-2} work was redone" in the final report.
```

---

## Template C: Subagent delegation

```markdown
---
name: {domain}-orchestrator
description: "Delegate independent {domain} tasks to subagents. Use when the user asks with one of {initial trigger keywords}, and also for follow-up work such as revising results, partial reruns, updates, additions, reruns, and improving previous results."
---

## Execution mode: Subagent delegation

## Procedure

### Phase 0: Check existing work
Check whether `_workspace/` exists to decide whether to start, rerun only part, or start fresh.

### Phase 1: Prepare
Analyze the input and create `_workspace/`.

### Phase 2: Run in parallel
Run `node .agents/harness/ph.mjs fanout --file <file> --collect <dir>` for the parallel one-shot agents. It creates one agent per block, waits for all agents, writes each final reply, and archives them unless `--keep` is specified.

| Agent | block `type=` | Input | Deliverable |
|---------|--------------|------|------|
| {agent-1} | {type} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` |
| {agent-2} | {type} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` |

For `{type}`, enter the name of a custom type (an existing `.agents/agents/<name>.md`) or leave it out for a general agent (`read-only=true` for read-only work); there are no built-in types. Put the prompts and names in the `--file` blocks; use `--type` for the shared agent type when needed.

Wait for completion. The main agent does not repeat searches already assigned.

### Phase 3: Integrate
1. Gather and integrate returned values and file deliverables, then create the final deliverable.

### Phase 4: Finish
Keep `_workspace/` and summarize and report the results to the user.

## Error handling
- If one agent fails, retry once. If it fails again, state what is missing and continue.
- Do not retry failures that would produce the same result, such as quota exhaustion, expired authentication, or denied permission. Open partial deliverables directly to see how far work actually got, record omissions in files under `_workspace/`, and report them to the user. For quota limits, also state when the quota resets. The main agent may incorporate only facts it directly verified; do not guess an agent's judgment.
- If more than half the agents fail, tell the user and ask whether to continue.
```

---

## Combine execution modes by phase (mixed mode)

Use the appropriate execution mode for each phase. Write `**Execution mode:**` at the top of every phase.

```markdown
## Execution mode: Mixed

| Phase | Execution mode | Reason for choice |
|------|----------|-----------|
| Phase 1 (preliminary inspection) | Main agent does it directly or delegates to subagents | The work list must be finalized. |
| Phase 2 (large-scale collection and verification) | Workflow orchestration | Process a predefined list in a distributed manner and perform adversarial verification. |
| Phase 3 (agreement and integration) | Persistent agent collaboration | Discuss conflicting data and reach agreement. |
| Phase 4 (independent verification) | Subagent delegation | One quality-verification agent can verify independently. |
```

**Execution mode transition rules:**
- Workflow orchestration → persistent agent collaboration: Save the workflow's returned structured data under `_workspace/` and include the file path in the persistent agents' prompts.
- Persistent agent collaboration → workflow orchestration: Freeze team deliverables (Template B, Phase 4), then put the file path list in `args` for the script.
- State the data handoff path at every execution-mode transition so results from earlier phases are not lost.

---

## Writing principles for every template

1. **State the execution mode at the top of the document.** For mixed mode, summarize each phase's execution mode in a table.
2. **Describe the script structure in detail for workflow orchestration.** Specify `phases`, the `schema` summary, and every item to put in `args`. Use the workflow JavaScript API (`agent`, `pipeline`, `parallel`, `phase`, `log`, `args`, `budget`, `workflow`) rather than Claude Code's Workflow tool.
3. **Describe named `fanout` blocks, `ph send`, and `ph task add` in detail for persistent agent collaboration.** Include the agent roster, communication rules, task dependencies, and deliverable-freeze procedure at phase boundaries. Agents always have the batch file tools; `tools:` lists and read-only roles are advisory, not enforceable permissions.
4. **Specify every `fanout` input for subagent delegation.** State that this is a one-shot run with `--collect` and without named persistent agents, and specify `--type`, prompt, and output path. Do not use Claude Code in-session primitives.
5. **State file paths clearly.** Use `_workspace/` as the path base and follow `{phase}_{agent}_{artifact}.{ext}` for file names.
6. **State dependencies between phases.** Be especially detailed about data handoff where execution modes change.
7. **Prepare for errors that can actually occur.** Do not assume every task succeeds; define responses for each situation.
8. **Always include test scenarios.** Write at least one normal scenario and one error scenario.
9. **Do not include items used only in v1.** Referencing `TeamCreate`, `TeamDelete`, `team_name`, broadcast, or experimental flags is incorrect.

## Follow-up request phrases for `description`

Include phrases that make the skill selectable not only for the first run but also for revisions and reruns.

- Rerun, run again, update, revise, add
- "Redo only {part} of {domain}"
- "Based on the previous results", "improve the results"
- Everyday request terms in the domain (for example, "launch", "promotion", "trending" for a launch strategy harness)

Without follow-up request phrases, this harness may not be selected again after its first run.
