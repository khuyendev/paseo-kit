# Skill Writing Guide

`ph` = `node .agents/harness/ph.mjs`, run from the project root (see `paseo-runtime.md`).

This guide explains in detail how to improve the quality of skills built with Harness. It supplements phase 4 of `SKILL.md`.

---

## Contents

1. [`description` writing patterns](#1-description-writing-patterns)
2. [Body writing style](#2-body-writing-style)
3. [Defining output formats](#3-defining-output-formats)
4. [Writing examples](#4-writing-examples)
5. [Loading only the information needed, progressively](#5-progressive-disclosure-patterns)
6. [Deciding whether to bundle scripts](#6-script-bundling-criteria)
7. [Data schema standards](#7-data-schema-standards)
8. [What not to include in a skill](#8-what-not-to-include-in-a-skill)
9. [Designing skills for reuse](#9-designing-skills-for-reuse)

---

<a id="1-description-writing-patterns"></a>

## 1. `description` writing patterns

The skill fields exposed to the agent are `name` and `description`; specify concrete invocation conditions in `description`. The agent reads these two fields to decide which skill to use.

### How skills are invoked

Agents tend not to invoke a skill for a simple task that can be handled easily with their default tools. For example, a simple request such as “Read this PDF” may not invoke a skill even if you write a good `description`. Skills are more likely to be invoked for complex tasks that require multiple steps or specialized judgment.

### Writing principles

1. State both **what the skill does** and **the specific situations in which it must be used**.
2. If there are similar-looking cases where the skill must not be used, clearly state its scope and exclusions.
3. Account for the agent making a conservative invocation decision; describe situations requiring invocation somewhat assertively.
4. For skills that coordinate multiple tasks, always include **words that indicate follow-up work** (rerun, revise, refine, improve previous results).

### Good example

```yaml
description: "Read PDF files and extract text and tables; merge, split, rotate, watermark,
encrypt, decrypt, and run OCR. Always use this skill when the user mentions a .pdf file
or requests a PDF deliverable. It is especially useful for work that requires conversion,
editing, or analysis rather than simply 'reading' a PDF."
```

### Poor examples

- `"A skill for processing data"` — too vague to tell which files or tasks it handles.
- `"PDF-related tasks"` — does not say what tasks it can perform or when to invoke it.

<a id="2-body-writing-style"></a>

## 2. Body writing style

### Explain the reason first

Large language models (LLMs) can make good decisions in exceptional situations when they understand why a rule is necessary. Instead of listing only commands about what to do and not do, explain why the rule must be followed.

**Poor example:**

```markdown
Always use pdfplumber to extract tables. Never use PyPDF2 for tables.
```

**Good example:**

```markdown
Use pdfplumber to extract tables because PyPDF2 is for text extraction and does not
preserve table row and column structure. pdfplumber recognizes cell boundaries and
returns structured data.
```

### Generalize principles to apply across cases

When feedback or tests reveal a problem, do not add an instruction that fits only that example. Revise it into a principle that applies to other cases too.

**Overfit revision:** `Convert the column to a number if it is named "Q4 revenue".`

**Generalized revision:** `Convert a column to a numeric type when its name contains a word that indicates a quantity, such as "revenue", "amount", or "quantity". Preserve values that cannot be converted.`

### Write in the imperative

Write “Do this” rather than “This is done” or “You can do this.” Skills are instructions that AI agents must follow.

### Reduce how much information must be considered at once

The amount of information a model can consider at once (its context window) is limited. This limit includes not only skill instructions but also other information needed for the task. Use the following criteria to decide whether each sentence is worth its tokens:

- “Does the agent already know this?” → Delete it.
- “Will the agent make a mistake without this explanation?” → Keep it.
- “Would one concrete example be clearer than a long explanation?” → Replace it with an example.

<a id="3-defining-output-formats"></a>

## 3. Defining output formats

Specify the required structure for skills where the deliverable's format matters.

```markdown
## Report structure
Follow this template exactly.

# [Title]
## Summary
## Key findings
## Recommendations
```

Keep the format description short and include an actual example for better results.

**Deliverables read by the next workflow step:** If the next step reads and processes a deliverable as code, specify a **JSON structure** instead of a Markdown template. Also state that the final text is return data for the next step, not a message to the user. A workflow agent's `schema` option enforces the return format, so the structures defined in the skill and workflow script must match.

<a id="4-writing-examples"></a>

## 4. Writing examples

Concrete examples communicate rules more clearly than long explanations.

```markdown
## Commit message format

**Example 1:**
Input: Add user authentication using JWT tokens
Output: feat(auth): implement JWT authentication

**Example 2:**
Input: Fix the password visibility button not working on the login page
Output: fix(login): fix password visibility toggle button
```

<a id="5-progressive-disclosure-patterns"></a>

## 5. Loading only the information needed, progressively (Progressive Disclosure)

### Method 1: Split files by work area

```
bigquery-skill/
├── SKILL.md (overview + instructions for choosing a work area)
└── references/
    ├── finance.md (revenue and billing metrics)
    ├── sales.md (sales opportunities and pipeline)
    └── product.md (API usage and features)
```

Load only `finance.md` when the user asks about revenue.

### Method 2: Read detailed instructions only when needed

```markdown
## Editing documents
Make simple edits directly in XML.
**When you need to track changes,** refer to [REDLINING.md](references/redlining.md).
```

### Method 3: Add a table of contents to large reference materials

Add a table of contents near the top of reference materials longer than 300 lines.

<a id="6-script-bundling-criteria"></a>

## 6. Deciding whether to bundle scripts

Review the work records of agents that ran tests. Include a script or procedure in the skill when any of the following activities recur:

| Recurring activity | Action |
|------------|------|
| The same helper script is created in all three test runs. | Put the script in `scripts/`. |
| The same `pip install` or `npm install` command is run every time. | Add a dependency installation step to the skill. |
| The same multi-step procedure is followed each time. | Add the standard procedure to the skill body. |
| The same workaround is used after similar errors each time. | Add the known issue and solution to the skill. |

Run and verify any script included in the skill.

## 7. Data schema standards

Use the following standard schemas to exchange data consistently between skills. You can also use the same schemas when testing and evaluating skills built with Harness.

### `eval_metadata.json`

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": [
    "The deliverable includes X",
    "A file was created in format Y"
  ]
}
```

### `grading.json`

```json
{
  "expectations": [
    {
      "text": "The deliverable includes 'Seoul'",
      "passed": true,
      "evidence": "Confirmed 'Extract data for the Seoul region' in the third step"
    }
  ],
  "summary": { "passed": 1, "failed": 0, "total": 1, "pass_rate": 1.0 }
}
```

**Field names:** Use exactly `text`, `passed`, and `evidence`. Do not replace them with names such as `name`, `met`, or `details`.

### `timing.json`

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

Save `total_tokens` and `duration_ms` as soon as each run ends: `ph fanout --collect` writes them to `<dir>/<name>.json` before archiving the agent, and `ph result --json <agent>` shows them for an agent that is not archived yet (archived agents cannot be read). `total_tokens` = `tokens.input` + `tokens.cachedInput` + `tokens.output` (all turns of the agent), `duration_ms` = `durationS` x 1000.

<a id="8-what-not-to-include-in-a-skill"></a>

## 8. What not to include in a skill

- Supplementary documents such as `README.md`, `CHANGELOG.md`, and `INSTALLATION_GUIDE.md`
- Information needed only while creating the skill (test results, revision history)
- User manuals (a skill is an instruction for an AI agent)
- General knowledge the agent already knows
- Items used only in v1 (`TeamCreate`/`TeamDelete`, experimental flags, `model` assigned uniformly to every agent)

## 9. Designing skills for reuse

Before creating a skill, compare its functionality with existing skills in `.claude/skills/`. Building or extending Harness multiple times can accumulate skills with the same functionality under different names.

| Relationship to existing skill | Action |
|------|------|
| An existing skill already includes all the new functionality | Do not create a new skill; connect the existing skill to the agent. |
| Only some functionality overlaps, and generalizing the existing skill would cover the new functionality too | Generalize and extend the existing skill. |
| Some functionality overlaps, but the domain is intentionally specialized | Create a separate skill. |
| The functionality is entirely different | Create a new skill. |

**Principle:** A skill is easier to reuse and less likely to duplicate functionality when it focuses on one role. If it has two or more roles, first consider whether to split it.

### How far to generalize

Generalization can continue indefinitely, so stop at the boundary of the skill's responsibilities. Keep intentional domain specialization and remove only incidental dependencies.

For example, generalize a "fintech risk assessment PDF" skill as follows:

| Dependency removed | Result |
|------|------|
| Fintech | "Assessment results PDF". Stop here if the responsibility is assessment reports. |
| Assessment | "PDF form filling". Use an existing skill instead of creating a new one if one already has the same functionality. |

If you defined the responsibility from the start as "fintech risk assessment," do not generalize it; keep it as a separate skill.

Extending an existing skill can change the behavior of the agents that use it. Before extending one, check which agents use it and reflect the broader use scope in its `description`.
