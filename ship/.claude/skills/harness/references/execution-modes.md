# Execution modes — the three modes in Harness v2

`ph` = `node .agents/harness/ph.mjs`, run from the project root (see `paseo-runtime.md`).

This document explains the key features, constraints, and selection criteria for the three execution modes provided by Harness v2. It supplements step 2-1 of `SKILL.md`.

---

## Contents

1. [Mode A: Workflow orchestration](#1-mode-a-workflow-orchestration)
2. [Mode B: Persistent agent collaboration](#2-mode-b-persistent-agent-collaboration)
3. [Mode C: Subagent delegation](#3-mode-c-subagent-delegation)
4. [Decision tree for choosing an execution mode](#4-decision-tree-for-choosing-an-execution-mode)
5. [Migrating from v1 to v2](#5-migrating-from-v1-to-v2)

---

## 1. Mode A: Workflow orchestration

Run an orchestration script with `ph workflow`. Code, rather than the model's judgment at each moment, determines control flow such as fan-out, iteration, and conditional branches. The same input therefore makes it easy to reproduce the same structure, and this mode is suitable for running many agents in parallel.

```
[Main agent] → ph workflow --script <file.js>
           ├── phase('Explore'): pipeline(items, item => agent(...))
           ├── phase('Verify'): find and test counter-evidence for each finding (in parallel)
           └── return { confirmed }   ← structured final result
```

**Key capabilities:**
- `agent(prompt, opts)` — starts a subagent. If you specify a JSON Schema in `opts.schema`, it returns a structured object validated against the schema. No separate parsing is needed; if the output does not match, the same agent is retried. Set `opts.agentType` to use a custom type defined in `.agents/agents/`. Use `opts.effort` to adjust thinking, and `opts.isolation: 'worktree'` to isolate file changes.
- `pipeline(items, stage1, stage2, ...)` — each item independently passes through multiple stages. There is no synchronization barrier between stages, so **use this by default for multi-stage work.**
- `parallel(thunks)` — a synchronization barrier that waits for all work to finish. Use it only when the next step needs **all** results from the previous step, such as deduplication or early stopping based on the total count.
- `phase(title)` / `log(msg)` — group progress and tell the user what is happening.
- `budget` — connects to the token budget specified by the user (for example, "+500k"). Use `budget.total` and `budget.remaining()` to adjust work size dynamically.
- `workflow(nameOrRef, args)` — runs another workflow nested one level. Use it to delegate work hierarchically.

**Characteristics:**
- Code determines control flow, so the same input follows the same execution structure.
- Structured output (`schema`) passes schema-compliant data between stages.
- Resume an interrupted or edited run with `ph workflow --script <file> --args-file <file> --resume <runId>` (`--resume <runId>` alone reruns the earlier run's own copy of the script, without your edits). Unchanged `agent()` calls return cached results immediately, reducing the cost of rerunning only part of a workflow.
- Workflows run in the foreground by default. Use `--detach` to return immediately and monitor the run log; a Monitor timeout does not stop the workflow.

**Constraints:**
- **The user must ask first.** Use a workflow only if the user directly asks for a workflow or multi-agent orchestration, or invokes a skill that explicitly calls `ph workflow`. An orchestration skill built by Harness meets the second condition. Keep the default agent count small, and use large-scale distributed runs only when the user explicitly asks for them.
- Scripts must use plain JavaScript, not TypeScript syntax. Do not use `Date.now()`, `Math.random()`, or `new Date()` without arguments because they interfere with resuming; pass timestamps in `args`.
- The `meta` block must contain only literals. Variables, function calls, and spread syntax are not allowed.
- A session has a cap on concurrently running agents. Work beyond the cap is automatically queued. A workflow also has a cap on the total agents it can call while running, preventing excessive execution.
- A failed or skipped `agent()` returns `null`. `parallel()` does not throw when a call fails, so always apply `.filter(Boolean)` to its results.
- A `parallel()` barrier synchronizes when work finishes; it does not prevent later edits. In mixed mode, a named agent woken with `ph send` after a workflow stage can edit that stage's artifact files. Freeze artifacts at mode boundaries (`orchestrator-template.md`, template B, step 4).

**Good fits:** Distributed execution over a known list, such as N files or M perspectives; loop-until-dry processing and adversarial verification; large-scale migrations and audits; structured report generation.

**Poor fits:** Work whose target list cannot be known in advance because it must be discovered through ongoing discussion; work requiring frequent consultation with the user during execution.

> See `workflow-recipes.md` for script skeletons and cautions.

## 2. Mode B: Persistent agent collaboration

Start named agents and coordinate with a shared task list and `ph send`. This replaces v1's "agent team" mode.

**The main difference from v1:** `TeamCreate` and `TeamDelete` no longer exist. Do not create an explicit team object as in v1; named agents started in the session belong to one automatically assembled collaboration group.

```
[Main agent (leader)]
    ├── ph spawn --name researcher --type <type> --prompt-file <file>   ← run in parallel
    ├── ph spawn --name critic --type <type> --prompt-file <file>
    ├── ph task add --ws <workspace> --title <task> --depends-on <ids> → shared task list
    ├── ph send --prompt "..." researcher  ← give follow-up instructions with context retained
    └── ph watch researcher critic → collect results after agents become idle
```

**Key capabilities:**
- `ph spawn --name ... --type ... --model ... --prompt ...` — specifying `--name` creates a persistent agent that can be addressed again with `ph send`. It starts in the background and returns immediately. Use `ph watch` under Monitor to wait for completion.
- `ph send ... NAME|ID` — tells a previously started agent to continue work with its conversation context retained. Use it for iterative revisions and exchanges of results.
- `ph task add` / `ph task update` / `ph task list` / `ph task get` — share the task list. Manage dependencies and status between tasks, and use it for a supervisor to assign work based on progress.
- `ph stop NAME|ID` — interrupt a running turn that is excessive or no longer needed.

**Characteristics:**
- Agents remember earlier conversation and work, so they can handle follow-up requests such as "in the same session, revise only section 2 of the draft you made earlier."
- Agents can share discoveries, discuss disagreements, and immediately adjust the direction of work.
- Reuse the same specialist agents for as long as the session remains active.

**Constraints:**
- The main agent (leader) coordinates directly, so more agents increase the leader's workload. Three to five agents is appropriate.
- Deeply nested delegation slows responses and makes conversation context easier to lose. Keep delegation within two levels.
- This uses more tokens than calling a subagent only once.
- Named agents can receive messages after reporting completion and may edit an artifact they already handed off while answering a late question from another agent. If the next stage reads that artifact, freeze it at the stage boundary. See `orchestrator-template.md`, template B, step 4, for the freeze procedure.

**Good fits:** Iterative revisions where writers and reviewers exchange results; discussing incompatible data and merging it into one result; assigning work based on progress; work that needs specialist agents throughout a session.

**Poor fits:** One-off work where only the result is needed; large-scale distributed execution with a known task list.

## 3. Mode C: Subagent delegation

Delegate with one `ph fanout` or `ph spawn` invocation. Only the results return to the main agent; agents do not communicate with one another.

```
[Main agent] → ph fanout --file <blocks.txt> --collect <dir> ─┐
              → one agent per block                           ├→ wait, collect results, archive
              → (parallel; background by default)              ┘
```

**Characteristics:**
- It is lightweight and fast. The main agent receives summarized results.
- Independent calls run concurrently when included as separate blocks in one fanout file.
- Agents run in the background by default. `ph fanout --collect` waits for completion; without `--collect`, use `ph watch` under Monitor.
- The main agent waits for results rather than repeating searches that have already been delegated.

**Constraints:**
- Agents cannot communicate with one another, and their conversation context does not continue after a call ends. To start fresh work, start a new one-shot agent with `ph fanout --file <file> --collect <dir>` instead of messaging an existing agent with `ph send`.
- The main agent handles all coordination.

**Good fits:** One-time research and collection; selecting specialists to return results only; one independent verification pass.

**Poor fits:** Work requiring iterative revisions through exchanged results; large-scale distributed work whose execution flow can be determined in advance.

## 4. Decision tree for choosing an execution mode

```
Can you express the task list, verification criteria, and iteration conditions in code in advance?
├── Yes → Workflow orchestration (Mode A)
│         Code, not the model, determines control flow.
│         However, honor the requirement that the user asks first, and do not use more agents than needed.
│
└── No → Would quality improve by repeatedly exchanging results and retaining conversation context?
          ├── Yes → Persistent agent collaboration (Mode B)
          │
          └── No → Are there two or more agents?
                    ├── Yes → Parallel subagent delegation (Mode C)
                    └── No → Single subagent delegation (Mode C)
```

**Choosing a mixed mode:** Mix execution modes if the answers to the questions above differ by stage. Common combinations follow.

| Combination | Composition | Example |
|------|------|------|
| Workflow collection → persistent integration | A → B | Divide and collect large amounts of material, then have the team discuss incompatible data and agree on a result |
| Persistent generation → workflow verification | B → A | Have the team draft, then distribute adversarial verification for each finding |
| Subagent preliminary research → workflow main task | C → A | Have the main agent or a subagent identify the task list first, then pass that list to the workflow in `args` |

**Principle for checking the list before orchestration:** Before starting a workflow, briefly inspect the file list, review targets, or research items and confirm the task list. Understanding the shape of the work before execution simplifies the script and reduces unnecessary work.

## 5. Migrating from v1 to v2

When you find orchestration skills or agent definitions created by an existing v1 harness, propose converting them to the v2 format using the tables below.

### 5-1. Migrate v1 artifacts to v2

| v1 element | Status | v2 replacement |
|---------|------|---------|
| `TeamCreate(team_name, members)` | **Removed** | Run `node .agents/harness/ph.mjs fanout --file <blocks.txt>` without `--collect`; this starts one persistent named agent per block in parallel. Named agents belong to the automatically assembled collaboration group in the session, so there is no need to create a separate team object. |
| `TeamDelete` / "team cleanup" step | **Removed** | Delete the step. Agents end naturally when their work is complete; stop them with `ph stop` if needed. |
| "Only one active team per session" constraint | **Changed in form** | The v1 constraint does not apply because explicit team objects no longer exist. Named agents work together in the automatically assembled collaboration group in the session; use `ph fanout --file <blocks.txt>` without `--collect` to launch multiple named agents. |
| `SendMessage({to: "all"})` broadcast | Changed | Send `ph send` separately only to the required recipients. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | **Unnecessary** | Remove it from both documentation and scripts. |
| Force `model: "opus"` (tier `pro`) for every agent | Policy retired | Choose models individually based on the work. If uncertain, use `standard`, and retain model inheritance only when it is intentional. |
| Organize large-scale distributed execution as a team | Improved | Move it to a `ph workflow` script. Use code to determine control flow, structured output, and resumable execution; use the documented workflow API and pass arguments with `--args` or `--args-file`. |
| "Step 0: check conversation context" in an orchestration skill | Retained | Keep the existing procedure and add `--resume <runId>` to `ph workflow`. |
| `_workspace/` file-writing rules | Retained | Keep them unchanged. |
| `CLAUDE.md` location guidance | Retained | Keep it unchanged. Change history lives in `.agents/harness-history.md`. |

**Migration procedure:**
1. Remove `TeamCreate`, `TeamDelete`, broadcast messages, and experimental-flag references from existing orchestration skills.
2. Find distributed execution and verification loops. If code can determine the execution flow in advance, convert them to workflow orchestration mode.
3. Rewrite the remaining collaboration sections using persistent-agent collaboration: `ph spawn --name` + `ph send` + `ph task add` / `ph task update`.
4. Remove blanket `model: "opus"` (tier `pro`) assignments from agent definitions and retain only assignments with a rationale.
5. Re-run step 6 verification (structural validation and trial execution) and record the change in `.agents/harness-history.md`.

### 5-2. Migrate Claude Code in-session v2 to the Paseo edition

| Claude Code in-session v2 element | Paseo edition replacement |
|---------|------|
| `Workflow` tool | Run the script with `node .agents/harness/ph.mjs workflow --script <file> --args-file <file>`. Use `--detach` when needed. |
| `Agent(name: ...)` | `node .agents/harness/ph.mjs spawn --name <name> --prompt-file <file>`; add `--type`, `--model`, or other documented options as needed. For multiple named agents launched in parallel, use `node .agents/harness/ph.mjs fanout --file <blocks.txt>` without `--collect`. |
| `SendMessage` | `node .agents/harness/ph.mjs send --prompt "..." <name>`; messages wait until a running agent's turn ends. |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | `node .agents/harness/ph.mjs task add` / `update` / `list` / `get`, using the shared workspace task file. |
| `TaskStop` | `node .agents/harness/ph.mjs stop <name>`; this interrupts the current turn. |
| One-shot `Agent` calls | `node .agents/harness/ph.mjs fanout --file <blocks.txt> --collect <dir>`; use one block per agent. |
| `subagent_type` / `agentType` | Use `--type <name>` or workflow option `agentType`; the `.agents/agents/<name>.md` body is added to the prompt. The definition's `model:` selects its tier unless overridden. |
| `resumeFromRunId` | `node .agents/harness/ph.mjs workflow --script <file> --args-file <file> --resume <runId>`. |
| `model:` tiers | Use the tier names `frontier`, `pro` and `standard` (the kit ships no upstream aliases; a project may add `tier_aliases`); they map to real Paseo provider/models in `tiers` of `.agents/harness.config.json` (see contract section 3). |
| `isolation: 'worktree'` | Keep `opts.isolation: 'worktree'`; `ph` creates a fresh Git worktree for each agent and tells the agent to work there. The working directory itself may remain the orchestrator workspace; worktree isolation is an instruction to the agent (see runtime contract section 10). |

**Migration procedure:**
1. Replace Claude Code in-session calls with the corresponding `ph` commands or workflow API options in the table. The upstream method's mode-selection criteria, constraints, benefits, mixed-mode combinations, and procedures remain unchanged; this table changes only how the runtime operations are invoked.
2. Move workflow scripts into files and run them with `node .agents/harness/ph.mjs workflow --script <file> --args-file <file>`.
3. Re-run step 6 verification (structural validation and trial execution).
4. Record the change in `.agents/harness-history.md`.
