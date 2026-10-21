// No upstream: written for the agent states of the office.
// The activity bubble of a working agent from official timeline values (the latest tool kind, reasoning) and one bounded heuristic.
// Pure: no React, no SDK, no timer, no clock read.
import type { AgentView } from "../shared/model-types.ts";
import type { StringKey } from "./strings.ts";

// Heuristic (owner-approved, bounded): a shell command text that names a common test runner is a test run, for the "tests" glyph only.
// It reads the clipped command of the latest shell call; anything unreadable or unmatched is not a test run (safe default: the terminal glyph).
const TEST_RUNNER =
  /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|node\s+--test\b|pytest\b|python[0-9.]*\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+(?:test|nextest)\b|(?:npx\s+)?(?:vitest|jest|mocha|ava|playwright\s+test)\b|mvn\s+(?:\S+\s+){0,4}test\b|gradlew?\s+test\b|dotnet\s+test\b|rspec\b|phpunit\b|make\s+(?:\S+\s+){0,4}test\b|ctest\b|tox\b|deno\s+test\b)/i;
const COMMAND_SCAN_MAX = 200;

export function isTestCommand(command: unknown): boolean {
  if (typeof command !== "string" || command.trim() === "") return false;
  return TEST_RUNNER.test(command.slice(0, COMMAND_SCAN_MAX));
}

export type ActivityInput = Pick<AgentView, "status" | "lastTool" | "activity" | "shell">;

// The glyph key over a running agent, or null: thinking while it reasons, else the kind of its latest tool call.
export function activityGlyph(agent: ActivityInput | null | undefined): StringKey | null {
  if (typeof agent !== "object" || agent === null || agent.status !== "running") return null;
  if (agent.activity === "reasoning") return "glyphThinking";
  switch (agent.lastTool) {
    case "read":
      return "glyphRead";
    case "edit":
    case "write":
      return "glyphEdit";
    case "shell":
      return isTestCommand(agent.shell?.command) ? "glyphTests" : "glyphTerminal";
    case "search":
    case "fetch":
      return "glyphSearch";
    case "plan":
      return "glyphPlan";
    case "sub_agent":
      return "glyphDelegate";
    case "worktree_setup":
      return "glyphTerminal";
    default:
      return null;
  }
}
