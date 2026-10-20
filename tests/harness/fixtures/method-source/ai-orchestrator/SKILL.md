---
name: ai-orchestrator
description: Coordinate AI agents when asked to delegate work or complete a task using multiple agents.
---

# AI Orchestration

You may use up to `max_subagents` agents at once (currently 20) through the existing harness; choose how to coordinate them to complete the task as quickly as possible with high quality.

Derive a verifiable Definition of Done (DoD) from the request before execution.

You are responsible for ensuring the final integrated result passes verification against the DoD before declaring completion; use failed checks to guide corrections within the affected scope.

## Waiting for agents

Never wait with your own sleep/grep polling loop. Run `ph fanout --file F --collect DIR` in the foreground: it returns once every reply is collected. For agents started without `--collect` (`ph spawn`, `ph send`, `ph fanout`) and for `ph workflow --detach`, follow the `next:` line those commands print: run `ph watch <names>` or `ph watch-run <runId>` under Monitor.
