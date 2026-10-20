---
name: harness
description: "Designs, extends and audits a project harness: agent definitions, skills and orchestrators that run on Paseo agents (ph). Use to build a harness or agent team for a project, add or restructure agents and skills, or audit and sync an existing harness. Retrospectives and feedback on past runs go to harness-evolve."
---

# Harness v2 (Paseo edition) — design agent teams and their skills

Design a harness for the project. Define each agent's role and create the skills agents follow when working.

The runtime is Paseo. Read `references/paseo-runtime.md` before running or generating an orchestrator. `ph` = `node .agents/skills/harness/scripts/paseo_harness.mjs`, run from the project root (see `paseo-runtime.md`).

## Core principles

1. Put agent definitions in `project/.agents/agents/` and skills in `project/.agents/skills/`. Describe who does the work in an agent definition and how to do the work in a skill.
2. Choose an execution mode according to the workflow. Orchestrate with a workflow when code can define the sequence and repetition conditions. Use persistent agents when the same experts need to exchange feedback. Delegate to subagents when you need a result only once. See step 2 for detailed selection criteria.
3. Choose a model according to task complexity, duration, autonomy, and response speed. Use frontier for the hardest work requiring planning and long-term autonomous execution, pro for design, code generation, complex analysis, and cross-checking, and standard for routine work such as log analysis, format conversion, and simple collection. See step 3 for detailed criteria.
4. Record only invocation conditions in `CLAUDE.md` so that the orchestrator skill can be invoked in a new session. Record change history in `.agents/harness-history.md`, which no session loads automatically.
5. Keep applying lessons from execution results to agents, skills, and `CLAUDE.md`. Use `harness-evolve` to reflect and identify changes.
6. Write generated agent definitions, skills, orchestrators, and `CLAUDE.md` entries in English, whatever language the user chats in; reply to the user in their conversation language. (Owner decision 2026-10-03; upstream wrote outputs in the conversation language.) Use another language only when the user explicitly asks for it for these files.

## Procedure

### Step 0: Inspect the current state

Check the existing configuration first when you load the harness skill.

1. Read `project/.agents/agents/`, `project/.agents/skills/`, and `project/CLAUDE.md`.
2. Choose the procedure according to the current state.
   - **Build from scratch**: If the agent or skill directory does not exist or is empty, perform all steps starting from step 1.
   - **Extend an existing configuration**: If you need to add agents or skills to an existing harness, perform only the required steps in the table below.
   - **Operate or maintain**: If you need to inspect, modify, or synchronize an existing harness, go to the operating procedure in step 7.

   | Change | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 | Step 6 |
   | --- | --- | --- | --- | --- | --- | --- |
   | Add an agent | Skip and use the step 0 results | Decide only which team and stage to put it in for which execution mode | Required | When a dedicated skill is needed | Modify orchestrator | Required |
   | Add or modify a skill | Skip | Skip | Skip | Required | When connections change | Required |
   | Change structure or execution mode | Skip | Required | Only affected agents | Only affected skills | Required | Required |

3. If an existing orchestrator contains `TeamCreate`, `TeamDelete`, or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, it is a v1 artifact. It does not work in the current runtime, so propose porting it to v2. Follow “Migrating from v1 to v2” in `references/execution-modes.md` for details. An existing orchestrator that uses Claude Code in-session primitives is a Claude-Code-native v2 harness; propose migrating those parts to this Paseo edition's `ph` counterparts, following section 5 of `references/execution-modes.md`.
4. Compare the actual agent and skill lists with the `CLAUDE.md` entries to find inconsistencies.
5. Tell the user the inspection results and execution plan and get confirmation.

### Step 1: Analyze the field and work

1. Identify the project's field and goal from the user's request.
2. Divide the required work into types such as generation, validation, editing, and analysis.
3. Inspect the workflow so you can choose an execution mode.
   - Can you list the items to process in advance? For example, move N files or review M perspectives.
   - Does the work require a cycle of validating and then fixing outputs?
   - Would agents produce a better result by exchanging opinions?
   - Must you keep talking with the same expert within one session?
4. Find overlaps or conflicts with existing agents and skills identified in step 0.
5. Inspect the codebase to understand its technology stack, data model, and main modules.
6. Match the explanation's difficulty to the user's terminology and questions. Do not use terms such as validation condition (assertion) or JSON Schema without explanation for users with little coding experience.

### Step 2: Design execution mode and team structure

#### 2-1. Choose an execution mode

Harness v2 uses three multi-agent execution modes on Paseo. Choose one of these modes according to the workflow.

| Execution mode | `ph` commands | Suitable work |
| --- | --- | --- |
| **Workflow orchestration** | `ph workflow --script <file> --args-file <file>` | Work where the item list, validation procedure, and repetition count can be defined in code. Use when structured results are required or when the work needs dozens or more `agent()` calls. |
| **Persistent agent collaboration** | `ph spawn`, `ph send`, `ph task`, `ph watch`, `ph result` | Work requiring named experts to preserve context while repeatedly exchanging feedback, negotiating, or co-editing. |
| **Subagent delegation** | `ph fanout --file <file> --collect <dir>` or `ph spawn`, `ph watch`, `ph result` | Work that needs a result only once and does not require agents to talk to one another. |

Decide in this order.

1. Use a workflow when the item list, validation criteria, and repetition conditions can be represented in code in advance. Re-running a predefined flow the same way requires not leaving that flow to the model's ad hoc judgment.
2. Use persistent agents when the workflow is hard to define in code and agents must talk to one another or remember previous context.
3. Delegate to subagents when neither condition applies and you only need a result.
4. Use a hybrid mode when the work differs by stage. State the execution mode of each stage in the orchestrator.

Run `ph workflow` only when the user asked for orchestration or invoked an orchestrator skill that runs it. Treat either as consent. Keep the default run to a few agents; scale up only when the user asks for “thorough” or “exhaustive” investigation. Concurrency and caps follow section 6-3 of `references/paseo-runtime.md`.

> Compare execution modes and check concurrency limits, schemas, token budgets, and resume conditions in `references/execution-modes.md`.

#### 2-2. Choose a team pattern

1. Divide work by area of expertise.
2. Choose a suitable configuration from the following six patterns. See “Six basic patterns” in `references/team-patterns.md` for detailed criteria.
   - **Pipeline**: Process items in sequence using the previous stage's result. Suitable for `pipeline()`.
   - **Fan-out/fan-in**: Process independent work in parallel, then combine results. Use `pipeline()` and `parallel()` only when needed.
   - **Expert pool**: Select and call only the experts suitable for the input. Suitable for subagents or persistent agents.
   - **Generate and verify**: Have one agent create and another review. Use adversarial verification in a workflow or a pair of persistent agents.
   - **Supervisor**: A central agent monitors progress and redistributes work. Use persistent agents and a shared task list.
   - **Hierarchical delegation**: A higher-level agent delegates again to lower-level agents. Use only within two levels and limit nested workflows to one level.
3. Combine the following verification patterns when output accuracy matters.
   - **Adversarial verification**: Assign N adversarial verification agents to each finding and pass only findings that a majority judge `confirmed` with sufficient evidence. Do not count `refuted` or `uncertain` judgments as passing.
   - **Jury**: Create N proposals separately, judge them in parallel, and make the final version based on the best proposal.
   - **Loop-until-dry**: Continue exploring until the number of new findings is zero for K consecutive rounds.
   - **Explore by multiple criteria**: Investigate in parallel using distinct criteria such as containers, content, entities, or time.
   - **Omission reviewer**: Ask the final agent to find only missing content.

#### 2-3. Criteria for splitting agents

Split agents according to required expertise, parallelizability, context that must be retained, and likelihood of reuse. See “When to split agents” in `references/team-patterns.md` for the detailed table.

### Step 3: Write agent definitions

Define specialist agents for reuse across sessions in `project/.agents/agents/{name}.md`. Do not put a role you will reuse directly only in a `ph` command prompt.

- Define agents in files so they can be reused in later sessions. Call one with `--type {name}` or `opts.agentType: "{name}"` in a workflow.
- Define in advance what agents should exchange to make collaboration results stable.
- Describe who does the work in an agent definition and how to do it in a skill; do not mix them.

Create reusable expert roles as custom types in files and specify the file name in `--type` or `opts.agentType` when calling. Do not create a separate definition file for one-off work that needs no custom type: a general agent (no `--type`) or a read-only one (no `--type` plus `--read-only`), the Paseo counterparts of the built-in types `general-purpose`, `Explore` and `Plan`.

#### Check for overlap with existing agents

Before creating an agent file, check for overlapping roles among the existing agents in `project/.agents/agents/`. Do not skip this check even when adding only an agent and skipping step 1. Building or extending a harness repeatedly can accumulate agents with the same role under different names. If roles overlap, do not create a new name; use or extend the existing agent. See “Designing for agent reuse” in `references/team-patterns.md` for criteria and exceptions (intentional domain specialization).

#### Model selection criteria

Choose a model for each agent according to task complexity, duration, autonomy, and response speed. Set it in YAML front matter `model:` or call arguments `--model` and `opts.model`, and leave the reason in a comment in the agent definition or orchestrator. The tiers `frontier`, `pro`, and `standard` map to real Paseo models in `.agents/harness.defaults.json` (project overrides in `.agents/harness.config.json`) (see section 3 of `references/paseo-runtime.md`).

| Model | Selection criteria | Typical work |
| --- | --- | --- |
| **frontier** | The hardest work requiring independent planning, connecting multiple stages, and long-term autonomous execution | Agent coordination, planning and long-term execution, integrating extensive material, turning vague ideas into specifics |
| **pro** | Specialist work with a defined scope that requires deep reasoning and analysis | Design and architecture, code generation, complex analysis, cross-checking, critiquing research methods, creative work |
| **standard** | Routine work with clear procedures where fast handling matters | Log analysis, format conversion, static-file checks, running deployment scripts, simple collection, general writing and summarization |

- Use frontier when the agent must change its plan based on earlier results and execute autonomously over a long period. Use pro to deeply analyze one problem with a defined scope. For example, pro suits deeply critiquing one paper; frontier suits reviewing dozens of papers and producing a strategy and report.
- Use standard as the default for ordinary work when judgment is uncertain.
- Do not assign frontier or pro to every agent merely because the agent is important. Choose the model based on actual work, not the agent's status.
- Even if a higher-level agent responsible for planning and coordination uses frontier, choose each lower-level worker's model according to its own work.

> See `references/model-selection-guide.md` for detailed criteria by model.

#### What to put in a definition file

YAML front matter must contain `name` and `description`. Add `tools` to limit tools and `model` to change the model if needed. For read-only review and analysis agents, omit Edit and Write from `tools` to prevent file changes.

Conversely, give agents that modify outputs both Write and Edit. Without Edit, an agent must rewrite the whole file even to change one line; for large outputs, it may give up and work around the limitation. Agents always have the filesystem MCP batch tools. A `tools:` list is advisory, and read-only roles are advisory too; do not present them as enforceable permissions.

In the body, specify the core role, work principles, input and output rules, error handling, and collaboration method. Add `## Communication rules` for persistent agents to define whom to contact with `ph send` and how to use the shared task list. When stating which tools are available, treat the list as advisory and have persistent agents confirm in their first reply the tools they can actually use.

> See “Agent definition structure” in `references/team-patterns.md` for a template, full examples, and cautions about limiting `tools`.

#### When using a QA agent

- A QA agent that only runs non-mutating checks (lint, tests, verification scripts) can stay read-only: read-only is an instruction not to change files, and every agent has a shell. Give a scoped editing role only when the checks write artifacts, and name those artifacts in the prompt.
- Do not check only whether files exist. Compare API responses with frontend hook response structures.
- Do not wait until all work is finished to run checks once. Check immediately whenever a module is complete.
- Follow `references/qa-agent-guide.md` for details.

### Step 4: Write skills

Create skills for agents to follow in `project/.agents/skills/{name}/SKILL.md` (the Agent Skills folder Codex, OpenCode and other harnesses read), then run `node .agents/skills/harness/scripts/paseo_harness.mjs skills-sync` so Claude Code, which reads only `.claude/skills/`, sees them too. Agents of any Paseo provider can run the harness: name `codex/<model>`, `opencode/<model>` and so on in a tier or `--model` (`references/paseo-runtime.md` section 3). See `references/skill-writing-guide.md` for detailed writing instructions.

#### 4-0. Check for overlap with existing skills

Before creating a skill, check whether its function overlaps with an existing skill in `project/.agents/skills/`. If it overlaps, do not create a new name; connect or extend the existing skill. See “Designing skills for reuse” in `references/skill-writing-guide.md` for criteria, exceptions (intentional domain specialization), and the appropriate degree of generalization.

#### 4-1. Directory structure

```
skill-name/
├── SKILL.md              # required
│   ├── YAML front matter # name and description required
│   └── Markdown body
├── scripts/              # optional: executable code for repeated work or work that must always produce the same result
├── references/           # optional: reference documents to read only when needed
└── assets/               # optional: files used in outputs, such as templates and images
```

#### 4-2. Write invocation conditions in the description

The agent decides which skill to invoke from its `name` and `description`. Specify clearly what the skill does and when to use it in `description`, and distinguish cases that look similar but should not use it.

**Bad example:** `"A skill for processing PDF documents"`

**Good example:** `"Performs PDF tasks such as reading PDF files, extracting text and tables, merging, splitting, rotating, watermarking, encrypting, and OCR. Always use it when the user mentions a .pdf file or requests a PDF output."`

#### 4-3. Principles for writing the body

| Principle | How to apply it |
| --- | --- |
| **Explain the reason first** | Do not list only `ALWAYS` and `NEVER`; explain why a rule is needed. Knowing why helps make the right decision in exceptional cases. |
| **Be concise** | Keep `SKILL.md` under 500 lines. Remove content that does not help make decisions or move it to `references/`. |
| **Generalize with principles** | Do not create rules that fit only one example. State decision criteria that apply to multiple inputs. |
| **Include repeated code in advance** | Put code in `scripts/` if multiple agents rewrite the same script during testing. |
| **Use imperative instructions** | Choose one consistent imperative style suited to the document. Make the required action clear. |

#### 4-4. Load only needed information in stages

Load skill information and executable code at the following times.

| Information | When to load | Recommended length |
| --- | --- | --- |
| **Metadata** (`name`, `description`) | Always | About 100 words |
| **`SKILL.md` body** | When loading the skill | Under 500 lines |
| **`references/`** | When the material is needed | No limit |
| **`scripts/`** | When running repeated work or work that must always produce the same result | No limit. You can run without reading the contents |

- When `SKILL.md` approaches 500 lines, move details to `references/` and state in the body when to read which file.
- Add a table of contents near the top of a reference document that exceeds 300 lines.
- If guidance differs by field or framework, split reference documents so only the needed file is read.

#### 4-5. Connect agents and skills

- One agent can use one or more skills.
- Multiple agents can share the same skill.
- Describe the work method in a skill and the role responsible for the work in an agent definition.

### Step 5: Integrate and set execution order

An orchestrator is also a skill. Combine individual agents and skills into one workflow and define who collaborates, when, and in what order. See `references/orchestrator-template.md` for complete templates by mode and `references/workflow-recipes.md` for workflow-script examples.

When extending an existing harness, edit the existing orchestrator instead of creating a new one. When adding agents, reflect them in the configuration, task assignment, and data-transfer order, and add their new invocation conditions to `description`.

#### 5-0. Orchestrators by execution mode

**A. Workflow orchestration**

Define a workflow script in the orchestrator skill. Structure the script with `meta`, `phase()`, `pipeline()`, `parallel()`, and `agent()`. Specify custom types with `agentType` and receive schema-conforming results with `schema`. In generated orchestrator templates, write the full command `node .agents/skills/harness/scripts/paseo_harness.mjs workflow --script <file> --args-file <file>` so it can be copied and run as-is.

```
[orchestrator skill] → ph workflow --script <file> --args-file <file>
    ├── phase('Collect'): pipeline(items, ...)   ← distribute a predefined list
    ├── phase('Verify'): adversarial verification or jury
    └── return structured results → main agent writes the synthesis report
```

**B. Persistent agent collaboration**

Start named agents, then coordinate with the shared task list and `ph send`. `TeamCreate` and `TeamDelete` no longer exist. Do not create an explicit team object; named agents started in the session automatically belong to one collaboration group. You can message those agents again while retaining their previous conversation context.

```
[main agent (leader)]
    ├── ph spawn --name researcher ... / ph spawn --name critic ...  ← start in parallel
    ├── node .agents/skills/harness/scripts/paseo_harness.mjs task add --ws _workspace --title "task + dependencies"
    ├── node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt "Review the researcher's draft" critic
    └── node .agents/skills/harness/scripts/paseo_harness.mjs watch researcher critic; then collect and synthesize results
```

**C. Subagent delegation**

Use `ph fanout --file <file> --collect <dir>` for N agents in one operation; it waits, collects each final reply, and archives agents by default. Without `--collect`, the command returns immediately. You can also use `ph spawn`, `ph watch`, and `ph result`.

Use a hybrid mode when the work differs by stage. For example, collect material with a workflow, then have persistent agents reach agreement on the synthesis, or adversarially verify persistent agents' results with a workflow. Label each stage with `**Execution mode:**`.

#### 5-1. Data transfer methods

| Method | Implementation | Suitable execution mode | When to use |
| --- | --- | --- | --- |
| **Structured return value** | `agent(prompt, {schema})` in a workflow returns validated JSON | Workflow orchestration | When the next stage must process results in code |
| **Ordinary return value** | `ph result NAME` final reply | Subagent delegation | When the main agent collects summaries directly |
| **Message** | Pass directly between agents with `ph send` | Persistent agents | When real-time coordination and feedback are needed |
| **Shared task list** | Share status with `ph task add`, `ph task update`, and `ph task list` | Persistent agents | When managing progress, dependencies, and dynamic assignment |
| **File** | Write and read at an agreed path | All modes | When data is large or the work process must be inspected later |

Follow these rules when transferring files.

- Store intermediate outputs under `_workspace/` below the working directory.
- Use the filename format `{phase}_{agent}_{artifact}.{ext}`. For example, `01_analyst_requirements.md`.
- Save only final outputs to a path specified by the user. Keep `_workspace/` for post-run verification.

#### 5-2. Error handling

Include an error-handling policy in the orchestrator.

- Retry once and, if it fails again, continue without that result and note the omission in the final report. Do not delete conflicting data; preserve it with its source.
- However, do not retry failures that will produce the same result, such as exhausted usage limits, expired authentication, or denied permissions. Retrying only consumes the remaining limit. Open partial outputs directly to check how far the work actually progressed, record the omission in a file, and report it to the user. For usage limits, also state when the limit resets.
- When the orchestrator fills a gap left by a stopped agent, include only facts it verified directly. Do not guess an agent's judgment, such as why it excluded a source. Filling the gap by guessing would falsify the record needed for post-run verification.
- A failed or skipped workflow `agent()` returns `null`, and `parallel()` does not throw an exception for failures. Apply `.filter(Boolean)` to result arrays and use `log()` to report the number of missing items.
- If a persistent agent does not respond, check its status and re-instruct it with `ph send`. If it still fails, use `ph spawn` with the same custom type under a new name and pass the required task context in the prompt.

> For responses by error type, see “Error handling” in the template for the relevant execution mode in `references/orchestrator-template.md`.

#### 5-3. Work size

| Work size | Number of persistent agents | Workflow `agent()` call volume |
| --- | --- | --- |
| Small: fewer than 10 tasks | 2–3 | 2–5 |
| Medium: 10–20 tasks | 3–5 | About 10. Calls wait automatically when the concurrency limit is exceeded. |
| Large: more than 20 tasks | Supervisor + 3–5 workers | Dozens to hundreds. Overall limit: 1,000 agents. |

- More agents increase management overhead. Keep the default size small.
- **Preflight a fan-out.** Before a workflow over many items (families, files, modules), run 2-3 representative
  items through every stage end to end, including the scripted stages after the agents (apply, check, activate,
  publish), and fix what fails. Systemic defects (a missing contract field, a tool bug, a wrong path in the prompt)
  otherwise fail every item at once and cost a whole run (spec scaffold, 2026-10-04: 0 of 38 approved families
  passed their first check).
- **Scripts own bookkeeping; agents own judgement.** If an output has mechanical invariants (every input item
  placed exactly once, exact schemas, ordering, derived fields, digests), write a script that produces or repairs
  them and let the agent decide only the semantic choices. Low-effort models fail long lists of exact IDs (57 of 112
  partition plans failed validation on bookkeeping alone); a repair script fixed all 57 in seconds.
- **Keep prompts and inputs small.** Pass paths, not content; give per-item extracts of large data. See
  `references/paseo-runtime.md` section 6-3 for the measured limits (RAM per agent, prompt size, file size).
- If the user specifies a token budget such as `+500k`, check `budget.remaining()` in the workflow script to adjust execution scale.

#### 5-4. Record harness connection information in `CLAUDE.md`

After completing the configuration, record in the project `CLAUDE.md` that a harness exists and its invocation conditions. Since `CLAUDE.md` is read in every new session, do not repeat detailed execution rules there.

````markdown
## Harness: {domain name}

**Goal:** {one line with the harness's core goal}

**Invocation conditions:** When asked to do work related to {domain}, use the `{orchestrator-skill-name}` skill. You may answer simple questions directly.
````

Do not include the agent and skill list, directory structure, or detailed execution rules. Manage that information in the orchestrator skill, `.agents/agents/`, and `.agents/skills/`. Keep only invocation conditions in `CLAUDE.md`; record the first configuration and every later change in `.agents/harness-history.md` (columns Date, Change, Scope with repo-relative paths, Reason).

#### 5-5. Handle follow-up requests

The orchestrator skill must work not only on the first run but also when revising results.

1. Add phrases such as `run again`, `rerun`, `update`, `revise`, `supplement`, `rerun only {partial task} of {domain}`, `based on the previous result`, and `improve the result` to `description`.
2. Check the existing work context at step 0 of the orchestrator.
   - If `_workspace/` exists and the user asks for partial changes, rerun only the relevant stage or agent.
   - If `_workspace/` exists and the user provides new input, move the existing directory to a timestamped directory, then start again.
   - If `_workspace/` does not exist, start from the beginning.
   - If the previous workflow `runId` exists, edit the script file and resume with `ph workflow --script <file> --args-file <file> --resume <runId>` (`ph workflow --resume <runId>` alone reruns the earlier run's own copy of the script and skips your edits; use it only to repeat an unchanged run). Record the `runId` in `_workspace/run_meta.json`.
3. Specify the re-invocation method in agent definitions. If a previous result file exists, read it; if the user provided feedback, revise only that part.

### Step 6: Validation and testing

Validate the generated harness. See `references/skill-testing-guide.md` for detailed methods.

#### 6-1. Validate files and references

- Check that every agent file is in the correct location.
- Check that skill YAML front matter contains `name` and `description`.
- Check that names used for cross-references between agents match.
- Check that no command files were created in `.claude/commands/`.
- Check that outputs contain no v1 mechanisms: `TeamCreate`, `TeamDelete`, `team_name`, or experimental feature flags.
- Check that generated orchestrators contain no Claude Code in-session primitives (`Workflow` tool call, `Agent(`, `SendMessage`, `TaskCreate`).

#### 6-2. Validate by execution mode

- **Workflow orchestration**: Check that `meta` is a literal, that `Date.now()` and `Math.random()` are not used, that `parallel()` is used only when you must wait for all results, that `.filter(Boolean)` is present, and that `phase()` titles match `meta.phases`.
- **Persistent agent collaboration**: Check `ph send` sender and receiver paths, task dependencies, and agent count.
- **Subagent delegation**: Check that each agent's input and output connect, parallel calls are grouped in one `ph fanout` file, and all results are collected.
- **Hybrid mode**: Check that every stage states its execution mode and data does not break at stage boundaries.

#### 6-3. Test skill execution

1. Create 2–3 specific test requests that resemble what an actual user would enter for each skill.
2. Run with-skill and baseline executions in parallel and compare how much the skill improves results. If repeated, you can make the A/B comparison itself a workflow.
3. Use both qualitative evaluation by direct user review and quantitative evaluation with assertions. Follow user judgment when no objective condition can be defined.
4. When problems arise, fix them with principles applicable to multiple situations rather than rules that block only a specific example. Test again and repeat until further changes produce little benefit.
5. Put code in `scripts/` if multiple agents repeatedly create the same code.

#### 6-4. Validate invocation conditions

1. Create 10 requests with different wording and levels of explicitness that should invoke the skill.
2. Create 10 boundary cases with similar wording that should use a different skill or tool.

Clearly unrelated requests do not test boundaries. For example, when testing an image-generation skill, `extract the chart in this Excel file as a PNG` is a better boundary case than `write a Fibonacci function`: the output is an image, but a spreadsheet tool is more appropriate. For trigger checks, use `ph spawn` followed by `ph result --json` and inspect the `skills` field, or use a workflow; do not use headless `claude -p`. Also check whether invocation conditions overlap with existing skills.

#### 6-5. Dry run

- Check that the orchestrator's stage order is logical.
- Check that data-transfer paths do not break midway.
- Check that every agent's input matches the previous stage's output.
- Check that fallback procedures can actually run when an error occurs.

#### 6-6. Record test scenarios

Create `## Test scenarios` in the orchestrator skill and include at least one normal-flow scenario and one error-flow scenario.

### Step 7: Operate, maintain, and improve

A harness is not an output you create once and finish.

Use `harness-evolve` to reflect on execution results and apply feedback. Use `harness-evolve` when the user asks for a harness retrospective, asks to evolve the harness, or asks to apply feedback. This skill analyzes the differences between the initial configuration and current state, organizes feedback so it applies to multiple situations, and applies it to agents, skills, and the orchestrator. It also updates `.agents/harness-history.md`.

This `harness` skill directly handles the following procedure for operating and maintaining an existing harness.

1. **Inspect current state**: Compare `.agents/agents/`, `.agents/skills/`, and the orchestrator configuration, create a list of inconsistencies, and tell the user.
2. **Add or modify incrementally**: Change only one item at a time and immediately run the following validation.
3. **Record change history**: Record the date, change, scope, and reason in `.agents/harness-history.md`.
4. **Validate changes**: Check the file structure. Run invocation tests if invocation conditions are affected. For broad changes, run execution tests and a dry run, then make a final check that `CLAUDE.md` matches the actual files.

Propose improvement through `harness-evolve` in these situations.

- The same kind of feedback has appeared at least twice.
- Agents repeatedly fail for the same reason.
- The user keeps doing the same work manually instead of using the orchestrator.

## Output checklist

- [ ] Create files in `project/.agents/agents/` for every reusable custom type. Exclude one-off work using a built-in type as-is.
- [ ] Create required `SKILL.md` and reference documents in `project/.agents/skills/`.
- [ ] Put data-transfer methods, error handling, and test scenarios in one orchestrator skill.
- [ ] State which execution modes will be used: workflow orchestration, persistent agents, or subagent delegation. Label each stage in a hybrid mode.
- [ ] Choose each agent's `model:` according to complexity, duration, autonomy, and response speed, and leave the reason in a comment. Do not assign the same high-performance model to every agent.
- [ ] Leave no v1 mechanisms, such as `TeamCreate`, `TeamDelete`, or experimental feature flags, in outputs.
- [ ] Put `.filter(Boolean)` in workflow scripts and use only literals in `meta`. Wait for all results with `parallel()` only when necessary.
- [ ] For trigger checks, use `ph spawn` plus `ph result --json` or a workflow; do not use headless `claude -p`.
- [ ] Create no files in `.claude/commands/`.
- [ ] Check for role overlap before creating agents or skills. Unless the domain is intentionally specialized, reuse or extend overlapping definitions and ensure names and roles do not conflict.
- [ ] Wrote agent definitions, skills, orchestrators, and `CLAUDE.md` entries in English (or in the language the user explicitly asked for these files).
- [ ] Specify the skill's work and invocation conditions in its `description`, including follow-up request phrases.
- [ ] Keep the `SKILL.md` body under 500 lines. Move details to `references/` if it reaches 500 lines or more.
- [ ] Run the skill with 2–3 test phrases similar to real requests.
- [ ] Validate invocation conditions using requests that should invoke the skill and boundary cases that should not.
- [ ] Record only invocation conditions in `CLAUDE.md`, and change history in `.agents/harness-history.md`.
- [ ] Distinguish first runs, follow-up runs, and partial reruns at step 0 of the orchestrator. Also handle workflow resumption.

## Reference documents

- **Paseo runtime contract**: `references/paseo-runtime.md`
- **Execution mode details**: `references/execution-modes.md`
- **Model selection guide**: `references/model-selection-guide.md`
- **Team patterns and agent definitions**: `references/team-patterns.md`
- **Practical team examples**: `references/team-examples.md`
- **Workflow-script examples and cautions**: `references/workflow-recipes.md`
- **Orchestrator templates**: `references/orchestrator-template.md`
- **Skill-writing guide**: `references/skill-writing-guide.md`
- **Skill-testing guide**: `references/skill-testing-guide.md`
- **QA-agent guide**: `references/qa-agent-guide.md`
