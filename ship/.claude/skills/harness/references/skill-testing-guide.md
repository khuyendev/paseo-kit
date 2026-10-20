# Skill Testing and Iterative Improvement Guide

`ph` = `node .agents/harness/ph.mjs`, run from the project root (see `paseo-runtime.md`).

Explain how to verify and improve the quality of skills built with the harness through multiple iterations. This is a reference that supplements the six steps in `SKILL.md`.

---

## Contents

1. [Testing Method Overview](#1-testing-method-overview)
2. [How to Write Test Prompts](#2-how-to-write-test-prompts)
3. [Compare With-skill and Baseline Runs](#3-compare-with-skill-and-baseline-runs)
4. [Run A/B Tests with a Workflow (v2)](#4-run-ab-tests-with-a-workflow-v2)
5. [Quantitative Evaluation with Assertions](#5-quantitative-evaluation-with-assertions)
6. [Use Specialist Agents](#6-use-specialist-agents)
7. [Iterative Improvement Procedure](#7-iterative-improvement-procedure)
8. [Validate `description` Trigger Conditions](#8-validate-description-trigger-conditions)
9. [Test Workspace Structure](#9-test-workspace-structure)

---

<a id="1-testing-method-overview"></a>

## 1. Testing Method Overview

Check skill quality using both **qualitative evaluation, where a person judges the output**, and **quantitative evaluation, where assertions score it**.

| Evaluation method | Method | Suitable skills |
|----------|------|-----------|
| **Qualitative evaluation** | The user reviews the output directly. | Skills such as style, design, and creative work, where quality requires human judgment |
| **Quantitative evaluation** | Score automatically against assertions. | Skills such as file generation, data extraction, and code generation, where results can be checked objectively |

Follow **Write → Run tests → Evaluate → Improve → Test again**.

## 2. How to Write Test Prompts

### Writing principles

Write test prompts as **specific, natural sentences that a real user might enter**. Abstract or deliberately contrived prompts do not show whether a skill works in real use.

**Poor examples:** `"Process the PDF"`, `"Extract the data"`

**Good example:**

```
"In 'Q4_sales_final_v2.xlsx' in my Downloads folder, use column C (sales) and column D (costs)
to add a profit margin (%) column. Then sort in descending order by profit margin."
```

### How to vary prompts

- Mix formal and casual language.
- Mix requests that state their intent directly with requests whose intent must be inferred from context. For example, include both cases where the file format is named directly and cases where it must be inferred from context.
- Mix simple and complex tasks, and include abbreviations, typos, and colloquial expressions in some prompts.

### Include use cases

Start with two or three prompts. Include one core use case and one edge case, and add one case that requests several tasks at once if needed.

<a id="3-compare-with-skill-and-baseline-runs"></a>

## 3. Compare With-skill and Baseline Runs


### 3-1. How to compare two runs

For each test prompt, run two Paseo agents **concurrently in one `ph fanout --collect` operation**.

- **With-skill run:** Have the agent read the skill and perform the task. Save the result to `_workspace/iteration-N/eval-{id}/with_skill/outputs/`.
- **Baseline run:** Have the agent handle the same prompt without the skill. Save the result to `_workspace/iteration-N/eval-{id}/without_skill/outputs/`.

Use `ph fanout --collect` with one block per agent. For example, create a fanout file containing the shared instructions and the two agent blocks, then run:

```sh
node .agents/harness/ph.mjs fanout --file <fanout-file> --collect <collection-dir>
```

See the runtime contract's fanout block format. Agents always have the batch file tools (`read_multiple_files`, `edit_multiple_files`, `write_multiple_files`, plus the single-file `edit_file` and `write_file`); `tools:` lists are advisory, and read-only roles are not enforced. Use `ph freeze` plus `ph freeze --check` when an agent must not change frozen inputs.

### 3-2. Choose the baseline

| Situation | Baseline run |
|------|----------|
| Creating a new skill | Run the same prompt without the skill. |
| Improving an existing skill | Preserve a separate copy of the pre-change skill and use it. |

### 3-3. Record duration and token usage

`fanout --collect` writes `<collection-dir>/<name>.json` next to each reply before it archives the agent (the same object as `ph result --json`: status, usage, durations, skills used); archived agents cannot be read again, so take timing from these files. Save `timing.json` right away: `total_tokens` = `tokens.input` + `tokens.cachedInput` + `tokens.output` (all turns of the agent), `duration_ms` = `durationS` x 1000, `total_duration_seconds` = `durationS`. For agents started with `ph spawn`, `ph result --json <names>` has no `tokens` (no `ph` process followed them from creation); use `usage` of the last turn, or run the test cases with `fanout --collect` or a workflow instead.

<a id="4-run-ab-tests-with-a-workflow-v2"></a>

## 4. Run A/B Tests with a Workflow (v2)

When there are at least three test cases or validation must be repeated several times, make the A/B test itself a workflow script. Use it only after the user agrees to run the tests. This is a Paseo workflow script: run it with `ph workflow --script <file> --args-file <file>`; the `Workflow` tool and its `resumeFromRunId` option are upstream Claude Code primitives, not runtime operations.

```javascript
export const meta = {
  name: 'skill-ab-test',
  description: 'Run with-skill and baseline runs, then grade them anonymously',
  phases: [{ title: 'Run' }, { title: 'Grade' }],
}
const RUN_RESULT = { type: 'object', required: ['saved', 'files'], properties: {
  saved: { type: 'boolean' },
  files: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1 } } } }
const SLOT_GRADE = { type: 'object', required: ['expectations', 'summary'], properties: {
  expectations: { type: 'array', items: { type: 'object',
    required: ['text', 'passed', 'evidence'], properties: {
      text: { type: 'string' }, passed: { type: 'boolean' }, evidence: { type: 'string' } } } },
  summary: { type: 'object', required: ['passed', 'failed', 'total', 'pass_rate'], properties: {
    passed: { type: 'integer' }, failed: { type: 'integer' }, total: { type: 'integer' },
    pass_rate: { type: 'number' } } } } }
const GRADE = { type: 'object', required: ['A', 'B', 'comparison'], properties: {
  A: SLOT_GRADE,
  B: SLOT_GRADE,
  comparison: { type: 'object', required: ['preferred', 'reason'], properties: {
    preferred: { type: 'string', enum: ['A', 'B', 'tie'] },
    reason: { type: 'string' } } } } }

const results = await pipeline(
  args.evals,   // [{id, prompt, assertions, skillPath, withSkillSlot: 'A' | 'B'}]
  e => {
    const withSkillSlot = e.withSkillSlot === 'B' ? 'B' : 'A'
    const baselineSlot = withSkillSlot === 'A' ? 'B' : 'A'
    return parallel([
      () => agent(
        `${e.prompt}\n\nFirst read and follow ${e.skillPath}. Save the output to ${args.ws}/${e.id}/with_skill/outputs/, and save the same files to ${args.ws}/${e.id}/blind/${withSkillSlot}/outputs/. Return all saved file paths.`,
        { label: `with-skill:${e.id}`, phase: 'Run', schema: RUN_RESULT }),
      () => agent(
        `${e.prompt}\n\nSave the output to ${args.ws}/${e.id}/without_skill/outputs/, and save the same files to ${args.ws}/${e.id}/blind/${baselineSlot}/outputs/. Return all saved file paths.`,
        { label: `baseline:${e.id}`, phase: 'Run', schema: RUN_RESULT }),
    ])
  },
  (runs, e) => {
    const completed = (runs ?? []).filter(Boolean)
    if (completed.length !== 2 || completed.some(r => !r.saved || r.files.length < 2)) {
      log(`${e.id}: Skipping grading because both with-skill and baseline outputs are not ready.`)
      return null
    }
    return agent(
      `First verify that outputs exist in both ${args.ws}/${e.id}/blind/A/outputs/ and ${args.ws}/${e.id}/blind/B/outputs/. If either path is empty, do not grade; report the reason for failure. If both outputs exist, grade A and B separately and decide which is better: A, B, or tie. Preserve anonymity: do not open eval_metadata.json, with_skill/, or without_skill/. Assertions: ${JSON.stringify(e.assertions)}`,
      { label: `grade:${e.id}`, phase: 'Grade', schema: GRADE })
      .then(grade => {
        if (!grade) log(`${e.id}: Skipping this case because no anonymous grade was returned.`)
        return grade
      })
  }
)
const mapped = results.map((grade, index) => {
  if (!grade) return null
  const e = args.evals[index]
  const withSkillSlot = e.withSkillSlot === 'B' ? 'B' : 'A'
  const baselineSlot = withSkillSlot === 'A' ? 'B' : 'A'
  return {
    evalId: e.id,
    withSkill: grade[withSkillSlot],
    baseline: grade[baselineSlot],
    comparison: {
      preferred: grade.comparison.preferred === 'tie'
        ? 'tie'
        : grade.comparison.preferred === withSkillSlot ? 'with_skill' : 'baseline',
      reason: grade.comparison.reason,
    },
  }
}).filter(Boolean)
return { results: mapped }
```

Run the workflow with `ph workflow --script <file> --args-file <file>`. The main agent alternates `withSkillSlot` between A and B for each test case. Because graders read only the neutral `blind/A/` and `blind/B/` paths, they cannot tell which run used the skill. Grade only cases where both runs' outputs are ready. After grading, the main agent maps A/B results back to with-skill and baseline runs. Save the mapped results in `grading.json` in each run directory. Start grading as soon as each test case finishes; do not wait for all cases. After editing the skill, run again with `ph workflow --script <file> --args-file <file> --resume <runId>` so unchanged cases use cached results and are skipped.

<a id="5-quantitative-evaluation-with-assertions"></a>

## 5. Quantitative Evaluation with Assertions

### 5-1. Write assertions

**Good assertions** can be objectively judged true or false, make the check clear from their wording, and measure an outcome that should improve when the skill is used. Assertions that always pass without the skill (for example, “output exists”) or require subjective judgment (for example, “well written”) are poor assertions.

### 5-2. Conditions that code can check

Write scripts for assertions that can be checked by code. Scripts are faster and more reliable than visual inspection, and the same script can be reused in every iteration.

### 5-3. Watch for assertions that do not discriminate

Assertions that pass 100% for both with-skill and baseline runs do not measure a difference from using the skill. When you find one, delete it or make it strict enough to reveal a difference between the runs.

### 5-4. Grading result schema

Follow the `grading.json` format defined in `skill-writing-guide.md` (`text`/`passed`/`evidence` and `summary`).

## 6. Use Specialist Agents

| Role | Responsibilities | When to use |
|------|--------|------------|
| **Grader** | Record whether each assertion passes and its evidence, cross-check factual claims in the outputs, and check the quality of the assertions themselves. | Every iteration |
| **Anonymous comparator** | Hide which of two outputs used the skill, shuffle A/B order, and compare quality. | When rigorously checking that a new version is actually better |
| **Analyzer** | Analyze statistical patterns such as non-discriminating assertions, evaluation cases with high result variance, and tradeoffs between duration and token usage. | After at least three iterations of results |

Use Paseo agents for these roles. Use `ph fanout --collect` for independent grader/comparator/analyzer work, or an A/B workflow where results need to be combined. Agents always have the batch file tools (`read_multiple_files`, `edit_multiple_files`, `write_multiple_files`, plus the single-file `edit_file` and `write_file`); `tools:` lists and read-only roles are advisory, not enforced permissions. Freeze and check inputs when a reviewer must not change them.

<a id="7-iterative-improvement-procedure"></a>

## 7. Iterative Improvement Procedure

### 7-1. Improvement principles

1. **Generalize feedback.** Changes tailored to only one test case can overfit. Fix the skill using principles that apply to other cases too.
2. **Remove instructions that do not help.** Read agent work logs. If the skill causes unnecessary work, remove that instruction.
3. **Explain the reason.** Understand why even brief feedback matters, then improve the skill so that reason is addressed.
4. **Add tools needed for repeated work in advance.** If every test creates the same helper script, put that script in `scripts/`.

### 7-2. Iteration sequence

```
1. Edit the skill.
2. Rerun every test case in a new `iteration-{N+1}/` directory.
3. Show the user the results compared with the previous iteration.
4. Get feedback, edit again, and repeat the same sequence.
```

**Stop when:** the user is satisfied, there is no feedback to incorporate, or no meaningful improvement remains.

### 7-3. Review the draft with fresh eyes

When editing a skill, first make a draft. Then reread it from the beginning as a reviewer seeing it for the first time, and revise it. Do not try to write it perfectly on the first attempt.

<a id="8-validate-description-trigger-conditions"></a>

## 8. Validate `description` Trigger Conditions

### 8-1. Write requests for trigger evaluation

Create 20 evaluation requests. Include 10 `should-trigger` requests where the skill should run and 10 `should-NOT-trigger` requests where it should not run.

**Criteria for evaluation requests:**

- Use specific, natural sentences that a real user might enter.
- Include specific details such as file paths, the user's situation, column names, and company names.
- Focus on **boundary cases** where it is hard to decide whether to apply the skill, rather than obvious examples.

**`should-trigger`:** Include requests that express the same intent in different ways, requests that clearly need this skill even though they do not specify a file type, uncommon use cases, and requests that overlap with another skill but should select this skill.

**`should-NOT-trigger`:** **Near misses—boundary cases that sound similar but are not in scope—are important.** Include requests that use similar words but are better served by another tool or skill. Obvious unrelated requests are not worth testing.

### 8-2. Check for conflicts with existing skills

1. Collect all existing skill `description` values.
2. Check that `should-trigger` requests for the new skill do not incorrectly trigger existing skills.
3. If conflicts arise, make the new skill's scope and exclusions clearer in its `description`.

### 8-3. Automatic optimization (optional, advanced)

1. Split the 20 evaluation requests into 60% training and 40% test data.
2. Measure the current `description` trigger accuracy.
3. Analyze failed cases and improve the `description`.
4. Select the best-performing `description` based on the **test set** results. Selecting based on training results causes overfitting.
5. Repeat this process up to five times.

> Automate checks with a script that runs each evaluation request in a fresh Paseo agent, then read `ph result --json` and inspect its `skills` field (the skills the agent invoked). This replaces headless `claude -p`. It uses many tokens, so run it as a final step after the skill is stable.

<a id="9-test-workspace-structure"></a>

## 9. Test Workspace Structure

```
_workspace/
├── iteration-1/
│   ├── eval-descriptive-name/
│   │   ├── eval_metadata.json
│   │   ├── with_skill/    (outputs/ + timing.json + grading.json)
│   │   ├── without_skill/ (outputs/ + timing.json + grading.json)
│   │   └── blind/         (A/outputs/ + B/outputs/)
│   └── benchmark.json
├── iteration-2/
└── evals/evals.json
```

**Storage rules:**

- Give each `eval` directory a descriptive name instead of a number (for example, `eval-multi-page-table-extraction`).
- Create an independent directory for every iteration; do not overwrite an earlier `iteration` directory.
- Do not delete `_workspace/`; it is needed for post-hoc verification and change tracking.
