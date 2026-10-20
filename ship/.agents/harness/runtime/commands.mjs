// The ph commands of the runtime (M5), registered by ph.mjs. The runtime API for other modules is index.mjs.
import { agentCommands } from "./cmd-agents.mjs";
import { startCommands } from "./cmd-start.mjs";
import { worktreeCommands } from "./cmd-worktrees.mjs";
import { compactCommands } from "./compact.mjs";
import { doctorCommands } from "./doctor.mjs";
import { freezeCommands } from "./freeze.mjs";
import { taskCommands } from "./tasks.mjs";

export const commands = [
  ...doctorCommands,
  ...startCommands,
  ...agentCommands,
  ...compactCommands,
  ...taskCommands,
  ...freezeCommands,
  ...worktreeCommands,
];
