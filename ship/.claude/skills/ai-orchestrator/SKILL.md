---
name: ai-orchestrator
description: "Runs the main session's work through Paseo agents: delegates parts of a task, checks each agent's evidence before accepting it, and verifies the integrated result. Use when the owner asks to delegate work, use agents, run things in parallel, or let the session drive the task on its own. Trigger on: 'delegate this', 'use agents', 'run it in parallel', 'drive it yourself', 'tự lái', 'tự chốt', 'giao cho agent', 'chạy song song', 'dùng nhiều agent'."
---

# AI Orchestration

You may use up to `max_subagents` agents at once (the effective value is shown by `node .agents/harness/ph.mjs config`) through the existing harness; choose how to coordinate them to complete the task as quickly as possible with high quality.

Derive a verifiable Definition of Done (DoD) from the request before execution.

You are responsible for ensuring the final integrated result passes verification against the DoD before declaring completion; use failed checks to guide corrections within the affected scope.

## Choosing how to run

Project work in a repository with `.planning/` goes through the GSD skills (`gsd-plan`, `gsd-execute`, `gsd-verify`, `gsd-quick`, `gsd-debug`); they are workflows already. For other work, pick the execution mode with the decision tree in `.claude/skills/harness/references/execution-modes.md` (section 4), the team pattern from `references/team-patterns.md`, and for a workflow script the recipes in `references/workflow-recipes.md`. Doing the work yourself is a valid choice: more agents must earn their coordination cost.

Overlapping phases: while `gsd-execute N` runs, phase N+1 can be discussed (main session, `gsd-discuss`, skipping its STATE step) and researched (`gsd-research`, its own per-phase lock). With `gsd.research_ahead` on, that research is an ahead report (`provisional`); once phase N is COMPLETE, run `gsd-research` with `refresh: "code"` (re-verifies only `## Code APIs`), then `gsd-plan N+1`. Phase order stays the join point: phase N+1 plans on research that matches the finished code of phase N, and executes after phase N completes.

## Accepting an agent's work

An agent's "done" is a claim, not a result. Ask each agent for evidence you can check (the files and lines it changed or read, the commands it ran and their output) and check that evidence before you accept the result: open the cited lines, rerun the deciding command or read its log.

- When the task names N items, confirm N results came back, not a summary of most of them.
- When one conclusion decides the outcome (a bug is real, a test proves the fix), have a different agent confirm it; an agent judging its own work tends to approve it.
- An agent that stopped without a reply produced nothing: rerun it or report the gap.

## Waiting for agents

Never wait with your own sleep/grep polling loop. Run `ph fanout --file F --collect DIR` in the foreground: it returns once every reply is collected, and it names an agent that emits nothing for `agent_silent_s`. For agents started without `--collect` (`ph spawn`, `ph send`, `ph fanout`) and for `ph workflow --detach`, follow the `next:` line those commands print: run `ph watch <names>` or `ph watch-run <runId> --quiet` under Monitor, and run `ph watch-agents` under Monitor beside that wait. A stall line offers `ph stop` or a resend; the watcher does neither. When you stop a run before it ends, say why: `ph archive --run <runId> --reason "<why>"`.
