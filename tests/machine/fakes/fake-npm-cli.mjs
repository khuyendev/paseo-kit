// Fake npm CLI (reached through npm_execpath): logs args and cwd; `ci` creates node_modules.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
if (args[0] === "ci") fs.mkdirSync(path.join(process.cwd(), "node_modules"), { recursive: true });
