# Workflow recipes — script patterns and cautions

`ph` = `node .agents/skills/harness/scripts/paseo_harness.mjs`, run from the project root (see `paseo-runtime.md`).

This document explains script patterns that can be placed in an orchestrator skill when building the harness in workflow coordination mode (Mode A). Write scripts in plain JavaScript and run them with `ph workflow --script <file> --args-file <file>`. Save each script as a file (for a reusable orchestrator: `.agents/workflows/<name>.js`, run with `--name <name>`, or the orchestrator skill's `scripts/` folder); `ph` copies the exact script into the run directory.

---

## Contents

1. [Basic template](#1-basic-template)
2. [Fan-out + adversarial verification](#2-fan-out--adversarial-verification)
3. [Judge panel](#3-judge-panel)
4. [Loop until dry](#4-loop-until-dry)
5. [Budget-aware loop](#5-budget-aware-loop)
6. [Custom agent type + structured output](#6-custom-agent-type--structured-output)
7. [Cautions (validation checklist)](#7-cautions-validation-checklist)

---

## 1. Basic template

Start a complete runnable script with the `meta` literal. Match every title used in a `phase()` call exactly to a `title` in `meta.phases`.

```javascript
export const meta = {
  name: 'domain-task',
  description: 'One-line description (shown in the workflow run record)',
  phases: [
    { title: 'Collect', detail: 'Research in parallel from each perspective' },
    { title: 'Verify', detail: 'Find counter-evidence for each finding' },
  ],
}

phase('Collect')
const raw = await pipeline(args.items, item =>
  agent(`...${item}...`, { label: `Collect:${item}`, phase: 'Collect', schema: COLLECT_SCHEMA }))

phase('Verify')
// ...

return { result }   // The final return value is passed to the main agent
```

**Principles:**
- **Use `pipeline()` by default, and use `parallel()` only when you need a synchronization barrier.** A barrier is needed only when the next stage must compare all results from the previous stage with each other. Deduplication, early exit when the total result is zero, and prompts that say "compare with other findings" are such cases.
- Do not write the values of the item list directly in the script. When possible, pass the list confirmed by the main agent's preliminary research as `args.items`.
- Pass timestamps through `args.now` when needed. Do not use `Date.now()`.

## 2. Fan-out + adversarial verification

Collect review findings from each perspective, then verify each finding. Verify findings from a perspective as soon as its review finishes, without waiting for reviews from other perspectives to finish.

```javascript
export const meta = {
  name: 'review-fanout-verify',
  description: 'Review each perspective, then find counter-evidence for each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}

const FINDINGS = { type: 'object', required: ['findings'], properties: {
  findings: { type: 'array', items: { type: 'object',
    required: ['title', 'file', 'evidence'], properties: {
      title: { type: 'string' }, file: { type: 'string' }, evidence: { type: 'string' } } } } } }
const VERDICT = { type: 'object', required: ['status', 'reason'], properties: {
  status: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
  reason: { type: 'string' } } }

const results = await pipeline(
  args.dimensions,   // e.g. [{key:'security', prompt:'...'}, {key:'perf', prompt:'...'}]
  d => agent(d.prompt, { label: `Review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  review => parallel((review?.findings ?? []).map(f => () =>
    agent(`Verify the following review finding. Classify it as confirmed if the evidence is sufficient, refuted if it is clearly disproved, or uncertain if it is difficult to decide: ${JSON.stringify(f)}`,
      { label: `Verify:${f.file}`, phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, verdict: v }))))
)
const confirmed = results.flat().filter(Boolean)
  .filter(f => f.verdict?.status === 'confirmed')
log(`${results.flat().filter(Boolean).length} findings total; ${confirmed.length} passed verification.`)
return { confirmed }
```

To verify more strictly, run three adversarial verification agents per finding. Pass a finding only when at least two of the three judge it `confirmed` because the evidence is sufficient. Give each agent a different criterion, such as correctness, security, or reproducibility, to find a wider range of issues than repeating the same check.

## 3. Judge panel

Use this pattern for design work with many possible solutions. Create N independent drafts, judge them in parallel, and produce a final proposal based on the judging results.

```javascript
export const meta = {
  name: 'design-judge-panel',
  description: 'Create N independent drafts, judge them, and write a final proposal based on the highest-scoring draft',
  phases: [{ title: 'Draft' }, { title: 'Judge' }, { title: 'Synthesize' }],
}

const angles = args.angles?.length
  ? args.angles
  : ['prioritizing the MVP', 'prioritizing risk management', 'prioritizing user experience']
const judgeCount = args.judgeCount ?? 3

phase('Draft')
const drafts = (await parallel(angles.map(a => () =>
  agent(`Write an independent draft from the perspective of ${a}: ${args.brief}`,
    { label: `Draft:${a}`, phase: 'Draft' }))))
  .filter(Boolean)
log(`Created ${drafts.length} of ${angles.length} drafts.`)
if (!drafts.length) return { error: 'No completed drafts.', drafts: [] }

phase('Judge')   // A synchronization barrier is needed: all drafts must be compared with each other
const SCORE = { type: 'object', required: ['scores'], properties: {
  scores: { type: 'array', items: { type: 'object',
    required: ['index', 'score', 'strengths'], properties: {
      index: { type: 'integer' }, score: { type: 'number' }, strengths: { type: 'string' } } } } } }
const judged = (await parallel(Array.from({ length: judgeCount }, (_, j) => () =>
  agent(`Score the following ${drafts.length} drafts:\n${drafts.map((d, i) => `[${i}] ${d}`).join('\n---\n')}`,
    { label: `Judge:${j}`, phase: 'Judge', schema: SCORE })))).filter(Boolean)
log(`Received results from ${judged.length} of ${judgeCount} judges.`)
if (!judged.length) return { error: 'No completed judging results.', drafts }

phase('Synthesize')
const ranked = drafts.map((_, i) => {
  const scores = judged.flatMap(r =>
    r.scores.filter(x => x.index === i).map(x => x.score)).filter(Number.isFinite)
  return scores.length
    ? { index: i, average: scores.reduce((sum, score) => sum + score, 0) / scores.length }
    : null
}).filter(Boolean)
if (!ranked.length) return { error: 'No valid draft scores.', drafts, judged }
const winner = ranked.reduce((best, item) =>
  item.average > best.average ? item : best).index
const finalDraft = await agent(
  `Write the final proposal based on the highest-scoring draft. Incorporate strengths of other drafts where appropriate.\nHighest-scoring draft:\n${drafts[winner]}\nJudges' comments:\n${JSON.stringify(judged)}`,
  { phase: 'Synthesize' })
if (!finalDraft) {
  log('Could not write the final proposal.')
  return { error: 'Could not write the final proposal.', drafts, judged, winner }
}
return finalDraft
```

## 4. Loop until dry

Use this for work where the number of findings to locate is not known in advance. Repeat exploration until no new findings appear for K consecutive runs.

The code in sections 4–6 is a snippet to place in the basic template in section 1. When using it as a complete script, put `meta` at the top and define the phase titles and schemas it uses.

```javascript
const finders = args.finders ?? []
const dryLimit = args.dryRuns ?? 2
const findingKey = finding => JSON.stringify([
  finding.file ?? '', finding.title ?? '', finding.evidence ?? ''
])
const seen = new Set(), confirmed = []
if (!finders.length) return { confirmed, error: 'No search criteria.' }
let dry = 0
while (dry < dryLimit) {
  const found = (await parallel(finders.map(f => () =>
    agent(f.prompt, { phase: 'Explore', schema: FINDINGS })))).filter(Boolean).flatMap(r => r.findings)
  const fresh = found.filter(b => !seen.has(findingKey(b)))   // Use seen to detect duplicates, not confirmed.
  if (!fresh.length) { dry++; continue }
  dry = 0
  fresh.forEach(b => seen.add(findingKey(b)))
  const judged = await parallel(fresh.map(b => () =>
    agent(`Verify the following review finding. Classify it as confirmed if the evidence is sufficient, refuted if it is clearly disproved, or uncertain if it is difficult to decide: ${JSON.stringify(b)}`,
      { phase: 'Verify', schema: VERDICT })
      .then(v => ({ b, ok: v?.status === 'confirmed' }))))
  confirmed.push(...judged.filter(Boolean).filter(x => x.ok).map(x => x.b))
  log(`There are ${confirmed.length} confirmed findings so far, and this run found ${fresh.length} new findings.`)
}
return { confirmed }
```

If you deduplicate against `confirmed`, findings rejected during verification appear again on every run, so the loop never ends. Deduplicate against `seen`, which stores every finding discovered at least once.

## 5. Budget-aware loop

In a session with a user-specified token budget such as "+500k", automatically adjust the search scope to the remaining budget. In an unlimited session, `budget.total` is `null`, so `remaining()` returns `Infinity`; always check that `budget.total` exists first in the condition.

```javascript
const findings = []
while (budget.total && budget.remaining() > 50_000) {
  const r = await agent('Continue the following search task.', { schema: FINDINGS })
  if (r) findings.push(...r.findings)
  log(`Found ${findings.length} findings so far; ${Math.round(budget.remaining() / 1000)}k tokens remain.`)
}
// Set the work size in advance: const FLEET = budget.total ? Math.floor(budget.total / 100_000) : 3
```

## 6. Custom agent type + structured output

Use the `.agents/agents/{name}.md` definition created by the harness as-is in a workflow.

```javascript
const r = await agent(
  `Verify the file _workspace/02_draft.md and return the findings`,
  { agentType: 'qa-inspector',      // .agents/agents/qa-inspector.md
    schema: FINDINGS,               // Custom agent types also return only results matching the specified schema
    effort: 'high' })               // Higher reasoning effort is recommended for verification
```

- If you omit `agentType`, use the default workflow subagent.
- Choose `model` according to the work at each stage. Use `standard` for repetitive collection and transformation stages, `pro` for in-depth verification, judging, and design stages, and `frontier` for overall planning and long-running stages. These tier names map to real Paseo models in `.agents/harness.defaults.json` (see `paseo-runtime.md`, section 3). See `model-selection-guide.md` for detailed criteria.
- If several agents may edit files simultaneously and conflict, specify `isolation: 'worktree'`. Preparing work environments has a cost, so use this only when conflicts are likely.
- Enabled Claude Code file mods provide batch tools (`read_ranges`, `read_multiple_files`, `edit_multiple_files`, `write_multiple_files`); other providers use MCP compatibility adapters. Native file tools remain available if the mod is inactive or a native helper cannot use it. An agent definition's `tools:` list and read-only role remain advisory, not a sandbox.

## 7. Cautions (validation checklist)

Check this list when validating workflow scripts in harness step 6-2.

| Caution | Problem | Prevention |
|------|------|------|
| Use variables or expressions in `meta` | The script cannot be parsed. | Put literals only in `meta`. |
| Use TypeScript syntax (such as `: string[]`) | The script cannot be parsed. | Write plain JavaScript. |
| Use `Date.now()` / `Math.random()` / `new Date()` | Resume protection causes an error. | Pass timestamps and seeds through `args`; when randomness is needed, vary the prompt according to the index. |
| Omit null guards | A failed agent returns `null`, and `pipeline()` passes that `null` to the next stage (only a stage that throws ends the item): the next stage then crashes on it or starts a paid agent with missing input. | Guard each stage (`review => review && verify(review)`), and apply `.filter(Boolean)` to `parallel()` or `pipeline()` results before aggregating them. |
| Unnecessary synchronization barrier | The whole run takes longer because fast agents wait for slow agents. | Rewrite using `pipeline()` unless all results need to be compared. |
| Mismatched `phase` titles | Progress is grouped incorrectly. | Match `phase()` calls to the `title` values in `meta.phases`. |
| Call global `phase()` inside a parallel stage | Progress groups conflict. | Explicitly set `opts.phase` inside stages. |
| Deduplicate against `confirmed` | Rejected findings reappear and the loop never ends. | Deduplicate against the `seen` set. |
| Omit `budget.total` check in a token-budget loop | In an unlimited session, calls to `agent()` continue until the per-workflow cap is reached. | Use the condition `while (budget.total && ...)`. |
| Process only part of the scope without saying so | Report "complete" after processing only the first N items. | Use `log()` to state how many items were not processed. |
| Diagnose a result without checking the run record (`journal`) | Mistake an empty cached result for success. | Before diagnosing a completed workflow, check `<runDir>/journal.jsonl`. |
| Keep the script only inline in the orchestrator text, with no file | `ph workflow` cannot run it, and every session must recreate the file. | Keep the script in one file referenced by the orchestrator. To rerun changed work, edit that file and resume with `ph workflow --script <file> --args-file <file> --resume <runId>` (`ph workflow --resume <runId>` alone reruns the earlier run's own script and args). |


---
