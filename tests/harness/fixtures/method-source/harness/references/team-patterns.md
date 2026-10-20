# Team patterns — six basic patterns, quality verification, and agent definitions

This document supplements steps 2-2 and 3 of `SKILL.md`. It describes the execution modes v2 recommends for each pattern. See `execution-modes.md` for details.

`ph` = `node .agents/skills/harness/scripts/paseo_harness.mjs`, run from the project root (see `paseo-runtime.md`).

---

## Contents

1. [Six basic patterns](#1-six-basic-patterns)
2. [Quality verification patterns (added in v2)](#2-quality-verification-patterns-added-in-v2)
3. [Composite patterns](#3-composite-patterns)
4. [Agent type selection](#4-agent-type-selection)
5. [Agent definition structure](#5-agent-definition-structure)
6. [When to split agents](#6-when-to-split-agents)
7. [Designing for agent reuse](#7-designing-for-agent-reuse)
8. [Distinguishing skills and agents](#8-distinguishing-skills-and-agents)

---

## 1. Six basic patterns

### 1-1. Pipeline

Run tasks in a fixed sequence. The output from the previous agent becomes the input to the next agent.

```
[Analysis] → [Design] → [Implementation] → [Verification]
```

**Suitable when:** Each stage depends heavily on the previous stage's output.

**Example:** Writing a novel — worldbuilding → characters → plot → drafting → editing.

**Caution:** If one stage is delayed, the entire task is delayed. Design each stage to be as independent as possible.

**Execution mode recommended in v2:** If you can list stages and items in advance, prefer **workflow orchestration** and use `pipeline()`. Each item moves to the next stage as soon as its previous stage finishes. The whole run is shorter because it does not need to wait for every item in one stage to finish. If a person must review outputs between stages, call subagents in sequence.

### 1-2. Fan-out / fan-in

Process independent tasks at the same time, then combine the results.

```
         ┌→ [Expert A] ─┐
[Assign] → ├→ [Expert B] ─┼→ [Synthesis]
         └→ [Expert C] ─┘
```

**Suitable when:** You need separate analyses of the same input from several perspectives or domains.

**Example:** Comprehensive research — research official sources, news, communities, and background in parallel, then compile one report.

**Caution:** The way you combine the results determines overall quality.

**Execution mode recommended in v2:** Consider **workflow orchestration** first. Define the perspectives as an array, pass them to `pipeline()`, receive results matching `schema`, and combine them in code. Use `parallel()` only when you need to deduplicate after collecting all results. In that case, the next stage waits for every parallel call to finish. Persistent-agent collaboration also suits research by 2–4 agents when researchers need to share discoveries in real time.

### 1-3. Expert pool

Select and call only the experts that fit the input and situation.

```
[Classifier] → { Expert A | Expert B | Expert C }
```

**Suitable when:** Different input types need different handling.

**Example:** Code review — call only the relevant security, performance, or architecture expert.

**Caution:** If the classifier misclassifies the input, it cannot select the right expert.

**Execution mode recommended in v2:** Call only the required expert once through **subagent delegation**. If you need follow-up conversation with the same expert, switch to persistent-agent collaboration by assigning it a `name` with `ph spawn --name`.

### 1-4. Producer-reviewer

A producer agent and a reviewer agent work as a pair.

```
[Produce] → [Review] → (if an issue is found) → [Run producer again]
```

**Suitable when:** You must verify output quality and can define objective decision criteria.

**Caution:** Set a maximum of 2–3 retries to prevent endless review and revision.

**Execution mode recommended in v2:** Use **workflow orchestration** when you can express review criteria in code. Run parallel verification for each finding discovered by the adversarial verification pattern below. If you need to coordinate subjective judgments, run the producer and reviewer as a **named persistent-agent pair**, and exchange feedback with `ph send`. The producer retains the previous conversation and can accurately fix the criticized parts.

### 1-5. Supervisor

A central agent manages task status and assigns work according to progress.

```
         ┌→ [Worker A]
[Supervisor] ─┼→ [Worker B]    ← assign according to progress
         └→ [Worker C]
```

**Suitable when:** Workload keeps changing, or you must decide how to divide work while it is running.

**Difference from fan-out:** Fan-out determines how to assign work before it starts. A supervisor reassigns work after considering progress.

**Caution:** If tasks are too small, the supervisor must reassign them too often and becomes a bottleneck.

**Execution mode recommended in v2:** Use **persistent-agent collaboration**. The leader (main agent) registers tasks with `ph task add`, then redistributes work with `ph send` and `ph task update` after receiving workers' completion lines from `ph watch`. Switch to workflow orchestration if you can settle the task list in advance and write the assignment procedure as code; in that case, the supervisor has no separate decisions to make.

### 1-6. Hierarchical delegation

An agent delegates work to its own subagents. Use this to divide a complex problem into several levels.

```
[Lead] → [Team lead A] → [Practitioners A1, A2]
      → [Team lead B] → [Practitioner B1]
```

**Suitable when:** You can naturally divide a problem into parent and child tasks.

**Caution:** At more than three levels deep, execution slows down and earlier task context may not be passed along correctly. **Keep to two levels or fewer.**

**Execution mode recommended in v2:** Orchestrate with nested workflows. A parent workflow calls a child workflow with `workflow(nameOrRef, args)`. Nesting supports only one level, preventing an excessively deep hierarchy. Alternatively, remove the hierarchy and rebuild it with `phase()` in a single workflow. In Paseo, use `ph workflow --script <file.js>` (or `--name <name>`) to run workflow scripts; see `paseo-runtime.md`.

## 2. Quality verification patterns (added in v2)

Use these workflow verification patterns in harnesses where output accuracy matters. Their purpose is to filter results that look correct at first glance but are actually wrong.

| Pattern | Structure | When to use |
|------|------|------|
| **Adversarial verification** | Run N independent adversarial-verification agents for each finding. Pass only findings that more than half of the N agents judge `confirmed` with sufficient evidence. | When discoveries or claims must be reliable (review, audit, research). |
| **Perspective-diverse verification** | Give N adversarial-verification agents different perspectives, such as correctness, security, and reproducibility, rather than giving them the same prompt. | When errors can occur in several categories. Dividing criteria can reveal errors missed by repeating the same verification. |
| **Jury panel** | Run N proposals made with different approaches through parallel review. Write the final proposal based on the highest-rated proposal, incorporating strengths of the other proposals where useful. | Design or planning with many possible solutions. Comparing multiple proposals is better than revising one proposal repeatedly. |
| **Loop until dry** | Repeat exploration until K consecutive rounds find zero new findings. Record rejected findings in `seen` too, to prevent the same finding from being proposed again. | Exploration with an unknown number of issues (bugs, issues, edge cases). Choosing a fixed number of rounds in advance may miss additional findings. |
| **Explore by multiple criteria** | Run agents in parallel that explore by different criteria, such as container, content, entity, and time. | When one exploration criterion cannot find everything. |
| **Omission review** | At the end, assign one agent only to check: “Which exploration criteria were not used, which claims were not verified, and which sources were not read?” | Just before combining results. Add newly found omissions to the next exploration task. |
| **Report the number of excluded items** | If `top-N` or sampling limits the review scope, always record the number of excluded items with `log()`. | Every fan-out. If you do not state the excluded count, users may mistakenly think you reviewed everything. |

**Scaling principle:** Set the scale to match the scope of the user's request. For “check whether there are bugs,” use a few explorers and one adversarial-verification agent. For “audit thoroughly,” add explorers, have 3–5 adversarial-verification agents verify each finding, and then synthesize. If the scope is unclear, conduct research, reviews, and audits thoroughly; keep quick checks small.

> See `workflow-recipes.md` for implementation examples.

## 3. Composite patterns

Real tasks combine several patterns.

| Composite pattern | Composition | Example |
|----------|------|------|
| **Fan-out / fan-in + producer-reviewer** | Produce several proposals at once, then review each | Multilingual translation — translate into four languages in parallel, then have a native-language reviewer check each translation. |
| **Pipeline + fan-out / fan-in** | Process some steps in parallel within a sequence | Analysis (sequential) → implementation (parallel) → integration test (sequential). |
| **Supervisor + expert pool** | Supervisor calls experts suited to the situation | Customer support — supervisor classifies the request, then assigns it to the right expert. |
| **Exploration + adversarial verification + synthesis** | Explore by multiple criteria → verify each finding → review omissions → write report | Comprehensive code audit, in-depth research. |

Choose the right execution mode for each stage of a composite pattern. This is called a mixed-mode design. Choose based on whether you can define the control flow for that stage in code in advance.

## 4. Agent type selection

When calling an agent, select its type with `ph spawn --type {name}`, `ph fanout --type {name}`, or a workflow script's `agent()` `opts.agentType` option. For built-in types, omit `--type` to use the general agent; add `--read-only` for an advisory read-only role. Custom types are defined in `.agents/agents/{name}.md` and used with `--type {name}` or `opts.agentType`.

### Built-in types

| Type | Available tools | Suitable use |
|------|----------|-----------|
| No `--type` (general) | All tools at the default tier | Web research, general tasks, file edits. |
| `--type Explore` | Not available as a built-in Paseo type; use no `--type` + `--read-only` (advisory) | Finding code in a codebase. Do not use this role for review or audit. |
| `--type Plan` | Not available as a built-in Paseo type; use no `--type` + `--read-only` (advisory) | Architecture design and implementation planning. |

### Custom types

Define a type in `.agents/agents/{name}.md`. Set `--type {name}` or `opts.agentType: "{name}"` when calling it. Set the model tier in the YAML front matter.

### Selection criteria

| Situation | Recommendation | Reason |
|------|------|------|
| The role is complex and reused across sessions | **Custom type** | Manage expert roles and working principles consistently in a file. |
| Simple one-time research or collection, adequately specified by a detailed prompt | General agent + detailed prompt | Use the built-in general type directly without a separate definition file. |
| Find code locations only | `--type Explore` | Use a custom `.agents/agents/Explore.md` definition if present; otherwise use general + `--read-only` and give explicit instructions. Read-only is advisory and reduces no permissions. Do not use for review or audit. |
| Write design or plans only | `--type Plan` | Use a custom `.agents/agents/Plan.md` definition if present; otherwise use general + `--read-only` and give explicit instructions. Read-only is advisory. |
| Simple one-time file edit | General agent + detailed prompt | Handle it directly with the built-in general type. |
| Implementation reused across tasks or requiring specialist rules | **Custom type** | Provide the required tools and apply specialist guidance. |
| Edit multiple files in parallel | Custom type + `opts.isolation: 'worktree'` | Prevent edit conflicts between agents. Creating a worktree has a cost, so use it only for parallel edits. |

**Principle:** Define expert roles reused across sessions as custom types in `.agents/agents/{name}.md`. Do not create a separate definition file for one-off tasks that use the built-in general type unchanged.

**Model policy:** Choose a model tier based on task complexity, expected duration, the extent of independent judgment required, and response speed. The tiers `frontier`, `pro`, and `standard` map to real Paseo models in `.agents/harness.defaults.json` (see contract section 3). Use **frontier** for the hardest tasks requiring long-term autonomous execution and agent orchestration. Use **pro** for design and architecture, code generation, complex analysis, cross-verification, and creative work. Use **standard** for structured work requiring little judgment, such as log analysis, format conversion, static-file inspection, deployment-script execution, and simple collection. Choose standard when uncertain. Do not assign the same model to every agent without a reason; record the reason in a comment. See `model-selection-guide.md` for detailed criteria.

## 5. Agent definition structure

```markdown
---
name: agent-name
description: "Describe the role in one or two sentences and list phrases that should trigger calling it."
# tools: Read, Grep, Glob, Bash        ← optional: list tools to guide the agent (e.g. a read-only reviewer)
#                                         tools are advisory; filesystem MCP batch tools are always present
# model: standard                         ← choose for the task (model-selection-guide.md); comment the reason
---

# Agent Name — one-line role summary

You are an expert in [role] in [domain].

## Core responsibilities
1. Responsibility 1
2. Responsibility 2

## Working principles
- Principle 1 (include the reason. This keeps decisions consistent in exceptional situations.)
- Principle 2

## Input and output rules
- Input: [what you receive and from where — file paths, args, previous-stage outputs]
- Output: [what and where you write — _workspace/ path or structured return value]
- Format: [file format, structure, schema]

## Communication rules (persistent-agent collaboration)
- First report: confirm that `ph task` works and tell the leader which tools you can actually use (the `tools` list is advisory)
- Incoming messages: [who sends what messages]
- Outgoing messages: use `ph send --prompt "..." <agent>` to tell [whom] what
- Shared tasks: use `ph task add` to register or request [which types of work]

## When called again
- Read previous outputs if available and incorporate improvements.
- If you receive user feedback, revise only the relevant parts.

## Error handling
- [What to do when something fails]
- [What to do when input is missing or ambiguous]

## Collaboration
- Relationships with other agents
```

**Workflow-only agent:** Replace “Communication rules” with “Structured output.” Specify the JSON structure to return, and state that the final text is **return data**, not a message to the user.

**Cautions when listing `tools`:**

- Give an agent that edits outputs both Write and Edit. If it has only Write, it must rewrite the whole file even to fix one line. If the output is large, the agent may give up editing and work around it by writing separately to another file, leaving the original output unfixed.
- Paseo agents always have the filesystem MCP batch tools. A definition's `tools:` list is advisory, and omitting `Edit` and `Write` only adds an advisory read-only note. Persistent agents must confirm in their first reply that `ph task` works and report which tools they can actually use; if a tool is missing, have the orchestrator handle that work instead (for example, the leader can update task status with `ph task update`), or remove the `tools` restriction from the definition.

## 6. When to split agents

| Criterion | Split | Combine |
|------|------|------|
| Expertise | Split when responsibility areas differ. | Combine when responsibility areas overlap. |
| Parallelism | Split when work can run independently. | Consider combining when work must be sequential. |
| Information needed | Split when one agent must process a lot of information. | Combine when little information is needed and the task is short. |
| Reusability | Split when another team can reuse the agent. | Consider combining when only this team uses it. |

## 7. Designing for agent reuse

Before creating an agent, compare its role with existing agents in `.agents/agents/`. Building or extending a harness several times can accumulate agents with the same role under different names.

| Relationship to existing agent | Action |
|------|------|
| An existing agent already covers the entire new role | Call the existing agent instead of creating a new one. |
| Some responsibilities overlap, and generalizing the existing agent would cover the new role | Generalize and extend the existing agent. |
| Some responsibilities overlap, but the domain is intentionally specialized | Create a separate agent. |
| The roles do not overlap | Create a new agent. |

**Principle:** An agent is easier to reuse and less likely to be duplicated when it focuses on one role. If extending it would give it two or more roles, first consider splitting it.

**When extending an existing agent:** The behavior of orchestrators that call that agent may also change. Before extending it, identify which orchestrators call it and update its `description` to reflect its broader role. After extending it, run a simulation (`SKILL.md` step 6-5) to confirm the existing flow still works.

## 8. Distinguishing skills and agents

| Aspect | Skill | Agent |
|------|-------------|-----------------|
| Definition | Task procedures and a collection of tools | Expert role and behavioral principles |
| Location | `.agents/skills/` | `.agents/agents/` |
| Invocation condition | A user request matches the applicability conditions in `description` | Start with `ph spawn` or `ph fanout`; call from a workflow script with `agent()` |
| Purpose | “How to do it” | “Who does it” |

### Ways to connect skills and agents

| Method | Implementation | Suitable when |
|------|------|-----------|
| **Skill tool call** | State in the agent prompt: “Use the Skill tool to call /skill-name.” Paseo agents are Claude Code sessions and have the Skill tool. | The skill is an independent workflow and the user may also call it directly. |
| **Include directly in prompt** | Write the skill content directly in the agent definition. | The skill is 50 lines or shorter and only that agent uses it. |
| **Load a reference file** | Read a skill's `references/` file with the filesystem MCP read tool only when needed. | The skill is large and needed only under specific conditions. |

Agents are Claude Code sessions with the Skill tool. Call skills used by multiple agents with the Skill tool. Put a short skill used by only one agent directly in its prompt, and load only the necessary reference files when the skill is large. The filesystem MCP tools are available for reading those files.
