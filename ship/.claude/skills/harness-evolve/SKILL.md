---
name: harness-evolve
description: "Evolves an existing harness from run experience: generalizes feedback, applies it to agents, skills and orchestrators, and records the change history. Use for harness retrospectives, feedback on a run, or lessons learned. New builds, redesigns and new agents go to the harness skill."
---

# Harness Evolve — Harness Evolution Mechanism

The harness is not a fixed artifact; it is an evolving system. Capture the delta of “what worked and what did not” and feed it back into the harness so the next run measurably improves.

Kit overlay: in this kit the harness output you evolve is the project adapter and, between workflow runs only, the project's workflow composition (`.agents/workflows/gsd-*.js`); follow `.claude/skills/harness/references/kit-adapter.md` (section 11) for its sources, the history row format, `ph harness lint` and the composition procedure (proposal from run evidence, review, apply between runs, a `composition:` history row, kit pull candidates).

```
Initial harness ──▶ Real project use ──▶ Current harness
                                           │
                                           ▼ (capture the delta with evolve)
                                     Generalize feedback → apply to agents, skills, and orchestrators
                                           │
                                           ▼
                                     Update change history → next run starts from a better draft
```

## Workflow

### Phase 1: Collect the Delta

1. Read `.agents/agents/`, `.claude/skills/`, `CLAUDE.md` (invocation conditions only) and `.agents/harness-history.md` (the change history).
2. If this is a git repository, inspect the change history of the harness files (`git log --oneline -- .agents/ .claude/ AGENTS.md CLAUDE.md`); without git, `.agents/harness-history.md` is the only record. Determine what changed from the initial configuration, when, and why.
3. If `_workspace/` exists, inspect intermediate artifacts from recent runs to confirm traces of actual execution:
   - Do artifacts exist at the paths defined by the orchestrator? (If not, the workflow may have been bypassed or may contain dead code.)
   - Do artifact quality and format follow the requirements stated by the skill?
   - For workflow runs, read `_workspace/_runs/*/run.json` (status, agent counts) and `journal.jsonl` (each agent's actual return value, and the reason of every `null` result) (`harness` skill, `references/paseo-runtime.md` section 6-5). Repeated `null` reasons are failure patterns.
4. Ask the user for feedback (skip this if they have already provided feedback):
   - “Is there anything in the result you would improve?”
   - “Is there anything you would like to change in the agent configuration or workflow?”
   - Do not pressure the user if there is no feedback. However, proactively suggest improvements if any of the observed signals below are present.

**Observed signals for evolution (suggest improvements even without feedback):**
- Evidence of the same type of revision request repeating 2 or more times.
- A pattern of agents repeatedly failing or retrying.
- Evidence that the user bypassed the orchestrator and worked manually (suspected orchestrator trigger failure → candidate for expanding the description).
- v1 artifacts (`TeamCreate`/`TeamDelete`/experimental flags) remain in the orchestrator → direct to the migration procedure in the `harness` skill.
- The orchestrator still calls Claude Code in-session primitives (`Workflow` tool, `Agent(name: ...)`, `SendMessage`, `TaskCreate`) instead of `ph` → direct to the `harness` skill's migration (`references/execution-modes.md` section 5-2).

### Phase 2: Classify Feedback and Map Modification Targets

| Feedback type | Modification target | Example |
|-----------|----------|------|
| Output quality | The relevant agent's skill | “The analysis is too shallow” → add depth criteria to the skill |
| Agent role | Agent definition `.md` | “A security review is also needed” → direct to the `harness` skill to add an agent |
| Workflow order | Orchestrator skill | “Validation should come first” → change the phase order |
| Team composition | Orchestrator + agents | “These two could be combined” → merge agents |
| Missing trigger | Skill description | “It does not work when I use this wording” → expand the description |
| Unsuitable execution mode | Orchestrator | “The same fan-out every time is slow” → switch to workflow orchestration mode |
| Scale/cost | Orchestrator | “It uses too many tokens” → reduce the default scale, add budget integration |

**Scope decision:** If adding or deleting agents or redesigning the architecture is necessary, do not do it directly in this skill; direct the user to the `harness` skill (the existing-configuration expansion procedure in step 0). Evolve focuses on **adjusting the existing configuration**.

### Phase 3: Generalize and Apply

1. **Generalize feedback** — a narrow change tailored to one specific case is overfitting. “The introduction was too long in this report” → do not change it to “Keep the introduction under 10% of the whole”; instead, find why it was long (the skill lacked guidance for allocating length) and modify the principle.
2. **Record the why as well** — include the reason alongside changed instructions. Knowing why helps agents make the right decision in edge cases too.
3. Apply changes one at a time, and run Phase 4 immediately after each change.
4. **Prevent regression:** If a change would undo an earlier change in the existing history, tell the user about the conflict and get confirmation. (If the earlier change shortened something because it was “too long,” but the current feedback says it is “too short,” the right answer is to find a criterion that satisfies both.)
5. **Write in English** — write sentences added to agents, skills, orchestrators, or `CLAUDE.md` in English, like the rest of the harness (owner decision 2026-10-03; the `harness` skill, principle 6). If a target file is still in another language, translate it to English in the same change rather than mixing languages.

### Phase 4: Update Change History and Verify

1. Append a row to the table in `.agents/harness-history.md` (never to `CLAUDE.md`):

```markdown
| Date | Change | Scope | Reason | Supersedes |
|------|----------|------|------|------|
| 2026-07-19 | Add tone guide | .claude/skills/content-creator/SKILL.md | Feedback: “too stiff” | |
```

2. Skills live only in `.claude/skills/`, which Claude Code reads directly, so a new or edited skill needs no sync step before testing.
3. Verify the structure of modified files (front matter, reference consistency).
4. If you modified a description, validate its triggers (at least 3 should-trigger and 3 near-miss examples).
5. Finally, check that `CLAUDE.md` matches the actual files.
6. The harness runtime, these two skills, the hooks and the kit block of `AGENTS.md` come from the paseo-kit (`.agents/harness-kit.json` names the kit). When a change to one of those files applies to every project, tell the user it can go back to the kit: `node <kit>/kit.mjs status <project>` lists the changed files and `node <kit>/kit.mjs pull <project> <files> --kit <kit dir>` copies them into the kit. Project-only settings, the adapter included, belong in `.agents/harness.config.json`, which the kit never overwrites.

### Phase 5: Report Evolution

Report to the user:
- Summary of the captured delta (initial configuration → current).
- Changes applied this time and the basis for generalizing them.
- Feedback not applied and why (if any).
- Improvements expected in the next run.

## Principles

- **The delta is an asset** — as change history accumulates, the next harness for the same domain starts from a draft closer to release-ready. Do not erase history.
- **Do not apply without generalizing** — adding one rule for every single case turns a skill into a pile of rules. Compress feedback into principles.
- **One change at a time** — applying multiple changes in a batch makes it impossible to tell which change was effective.
