# Practical Team Examples

`ph` = `node .agents/skills/harness/scripts/paseo_harness.mjs`, run from the project root (see `paseo-runtime.md`).

Each example shows how to choose an execution mode for a task and the basic Harness v2 syntax. See `execution-modes.md` for mode definitions and `workflow-recipes.md` for writing workflow scripts.

---

## Example 1: Comprehensive Research Team — Workflow Orchestration

**Composition:** Fan-out/fan-in + adversarial verification

**Why this choice:** You can list the research perspectives in advance and define the verification procedure for each claim in code.

```
[Main] Preliminary research: confirm research perspectives (official sources, press, community, background)
     → ph workflow --script <file> --args-file <file>
         phase 'Research': pipeline(axes, axis => agent(..., {schema: FINDINGS}))
         phase 'Verification': run adversarial verification agents per claim → pass only claims a majority rates confirmed
         phase 'Synthesis': run one omission reviewer → conduct additional research if a perspective is missing
     → Main writes the synthesis report from the returned structured results
```

Define research principles and the structured output format in `.agents/agents/researcher.md`; define the rebuttal-first verification principle in `.agents/agents/fact-checker.md`. In the workflow, specify both agents with `agentType`.

Do not arbitrarily discard conflicting information. Include it in the return schema with its sources.

## Example 2: Science-Fiction Writing Team — Mixed Mode with Persistent Agents

**Composition:** Pipeline + generation and verification

**Why this choice:** You must adjust the world, characters, and plot in real time so they do not contradict one another, so each expert must remember the context of earlier discussion. Reviewers, however, can provide results from independent perspectives, so subagents are sufficient.

```
Stage 1 (persistent agents): start `worldbuilder`, `character-designer`, and `plot-architect` in parallel with `node .agents/skills/harness/scripts/paseo_harness.mjs spawn --name` (use `--count` for numbered agents)
                 → `node .agents/skills/harness/scripts/paseo_harness.mjs task add --ws _workspace --title "..." --assignee ... --depends-on ...` (world, characters, and plot; state dependencies on one another)
                 → The leader relays: worldbuilder finalizes the social structure
                   → `node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt "..." character-designer`
                   → If a character's occupation conflicts with the world, use `node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt "..." worldbuilder` to request an adjustment
                 Because prior context remains, request a partial edit such as "change only the merchant class in the hierarchy we set earlier."
Stage 2 (one-shot agent): call prose-stylist once with `node .agents/skills/harness/scripts/paseo_harness.mjs fanout --file <file> --type prose-stylist --collect <dir>` → read the three artifacts saved in `_workspace/` and write
Stage 3 (parallel one-shot agents): run `science-consultant` and `continuity-manager` reviews using `node .agents/skills/harness/scripts/paseo_harness.mjs fanout --file <file> --collect <dir>` to collect their replies
Stage 4 (persistent agent): A one-shot prose-stylist is archived after collection, so you cannot send it a follow-up. If you started it as a persistent named agent in Stage 2, use `node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt "..." prose-stylist` to ask it to apply the review results.
                 If you expect repeated edits, start it as a named agent from the beginning and use `ph watch` before sending the follow-up.
```

Give an agent a name from the start if you may send it another request. A one-shot agent cannot continue using its earlier conversation context.

## Example 3: Comprehensive Code Review — Workflow Orchestration

**Composition:** Fan-out/fan-in + adversarial verification

**Why this choice:** You can define review perspectives such as security, performance, architecture, and testing in advance, and express the procedure for verifying each finding in code.

```javascript
// Review by perspective → adversarially verify each finding
// Do not wait for the full review. Verify a finding from the security review
// as soon as it finishes, even while the performance review is still running.
const FINDINGS = { type: 'object', required: ['findings'], properties: {
  findings: { type: 'array', items: { type: 'object',
    required: ['title', 'file', 'evidence'], properties: {
      title: { type: 'string' }, file: { type: 'string' }, evidence: { type: 'string' } } } } } }
const VERDICT = { type: 'object', required: ['status', 'reason'], properties: {
  status: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
  reason: { type: 'string' } } }
const results = await pipeline(
  [
    { key: 'security', prompt: 'Review from a security perspective.' },
    { key: 'perf', prompt: 'Review from a performance perspective.' },
    { key: 'arch', prompt: 'Review from an architecture perspective.' },
    { key: 'test', prompt: 'Review from a testing perspective.' },
  ],
  d => agent(d.prompt, { phase: 'Review', schema: FINDINGS }),
  r => parallel((r?.findings ?? []).map(f => () =>
    agent(`Verify the following finding. Rate it confirmed if the evidence is sufficient, refuted if it is clearly disproven, or uncertain if it is difficult to judge: ${JSON.stringify(f)}`,
      { phase: 'Verification', schema: VERDICT })
      .then(verdict => ({ ...f, verdict }))))
)
const confirmed = results.flat().filter(Boolean)
  .filter(f => f.verdict?.status === 'confirmed')
```

In v1, reviewers used a persistent team to share findings with `SendMessage`. As in the example above, if a finding can be verified on its own, include enough evidence for that finding in the prompt and verify it immediately. If you must compare findings from other perspectives, gather all review results first, then verify behind a synchronization barrier. Use persistent agents only when real-time conversation is necessary, such as debating the direction of a design.

## Example 4: Large-Scale Code Migration — Persistent Supervisor Collaboration or Workflow Orchestration

**Composition:** Use fan-out/fan-in when work can be divided in advance; use a supervisor when it must be divided again during execution.

**Selection criterion:** Choose an execution mode based on whether you can divide the work into batches in advance.

Use a workflow if you can define the batches in advance.

```javascript
const MIGRATION_RESULT = { type: 'object', required: ['worktreePath', 'changedFiles'], properties: {
  worktreePath: { type: 'string', minLength: 1 },
  changedFiles: { type: 'array', minItems: 1, uniqueItems: true,
    items: { type: 'string', minLength: 1 } } } }
const MIGRATION_VERDICT = { type: 'object', required: ['status', 'reason'], properties: {
  status: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
  reason: { type: 'string' } } }
const migrated = await pipeline(args.batches,   // Estimate complexity through preliminary research, then finalize the batches
  b => agent(`Migrate the following batch, then return the absolute path of the isolated worktree and the actual list of changed files: ${b.files.join(', ')}`,
    { agentType: 'migrator', isolation: 'worktree', schema: MIGRATION_RESULT }),
  (r, b) => r && agent(
    `In isolated worktree ${r.worktreePath}, compare the migration targets with the actual changed files and verify omissions and errors. Original targets: ${b.files.join(', ')}. Actual changes: ${r.changedFiles.join(', ')}`,
    { agentType: 'qa-inspector', schema: MIGRATION_VERDICT })
    .then(verdict => ({ ...r, verdict })))
const confirmed = migrated.filter(Boolean)
  .filter(r => r.verdict?.status === 'confirmed')
return { confirmed }
```

Always give the adversarial verification agent the path to the isolated worktree containing the migration result. When the workflow finishes, the main agent checks each `worktreePath` in the `confirmed` results and merges the changes to the base branch or selectively applies the required commits. If conflicts occur, resolve them before merging the next worktree, and apply the next changes only after the integration tests pass. Do not merge `refuted` or `uncertain` results; report why they were omitted.

Use persistent agents when you must divide the work again based on progress.

```
The leader registers batches with `node .agents/skills/harness/scripts/paseo_harness.mjs task add --ws _workspace --title "..." --depends-on ...`
→ Start `migrator-1`, `migrator-2`, and `migrator-3` in parallel with `node .agents/skills/harness/scripts/paseo_harness.mjs spawn --name ... --count 3 --prompt "..."` (or use `ph fanout --file F` without `--collect`)
→ Run `ph watch <names>` under the Monitor tool; check results each time an agent becomes idle
→ For a failed task, use `ph send --prompt "..." <name>` to ask the cause, then `node .agents/skills/harness/scripts/paseo_harness.mjs task update --ws _workspace <id> --assignee <name>` to reassign it
→ Run integration tests when all tasks are complete
```

## Example 5: Webtoon Production — Persistent Creator and One-Shot Reviewer

**Composition:** Generation and verification

**Why this choice:** You need only one creator and one reviewer. You can send review results back to the creator up to twice, so a lightweight mixed mode is sufficient.

```
Stage 1: start `artist` with `node .agents/skills/harness/scripts/paseo_harness.mjs spawn --name artist --prompt "Create the panels"` → create panels → _workspace/panels/
Stage 2: run `node .agents/skills/harness/scripts/paseo_harness.mjs fanout --file <file> --type webtoon-reviewer --collect <dir>` with prompt "Review the panels" → rate PASS/FIX/REDO
       → save the review report as _workspace/review_report.md
Stage 3: For panels rated REDO only, use `node .agents/skills/harness/scripts/paseo_harness.mjs send --prompt "..." artist` to request regeneration
       Repeat at most twice. Because artist remembers the prior context,
       you can narrow the scope with a request such as "change only the composition of panel 3."
Retry policy: If it still does not pass after two revisions, tell the user what remains unresolved and why.
             If 50% or more of all panels are rated REDO, suggest that the user revise the prompt.
```

---

## Artifact Storage

- **Agent definitions:** Create them at `project/.agents/agents/{name}.md`. Always specify the core role, work principles, input/output rules, how to make follow-up calls, error handling, and collaboration methods. Add communication rules for persistent agents and structured output formats for agents used in workflows.
- **Skills:** Create them at `project/.agents/skills/{name}/SKILL.md`, adding `references/` and `scripts/` as needed.
- **Orchestrator:** Always specify the execution mode. Use the template in `orchestrator-template.md`.
- **Intermediate artifacts:** Save as `_workspace/{phase}_{agent}_{artifact}.{ext}` and keep them after verification is complete.

