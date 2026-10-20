#!/usr/bin/env node
// Prints the paseo-kit root this skill belongs to: the first ancestor of this script's real path holding both
// kit.mjs and kit.json (INST-30). The skill is reached through a junction or symlink, so the real path is the kit's.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fs.realpathSync(fileURLToPath(import.meta.url));
let dir = path.dirname(here);
for (;;) {
  if (fs.existsSync(path.join(dir, "kit.mjs")) && fs.existsSync(path.join(dir, "kit.json"))) {
    process.stdout.write(`${dir}\n`);
    break;
  }
  const parent = path.dirname(dir);
  if (parent === dir) {
    process.stderr.write(`failed: no paseo-kit root above ${path.dirname(here)}\n`);
    process.exitCode = 1;
    break;
  }
  dir = parent;
}
