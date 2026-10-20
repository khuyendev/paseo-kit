// Fake Claude CLI: logs args, cwd and CLAUDE_CONFIG_DIR; answers --version with $FAKE_CLAUDE_VERSION.
import fs from "node:fs";

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, cwd: process.cwd(), configDir: process.env.CLAUDE_CONFIG_DIR ?? null })}\n`);
if (args[0] === "--version") process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? "2.1.300"} (Claude Code)\n`);
process.exitCode = Number(process.env.FAKE_CLAUDE_EXIT ?? 0);
