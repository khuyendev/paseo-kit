// An isolated environment: temp home with a space, no live Paseo or Claude settings, no caller (INV-57).
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./temp.mjs";

const DROPPED = /^(PASEO_|CLAUDE_CONFIG_DIR$|CLAUDE_CODE_PLUGIN_DIRS$|CLAUDE_CLI$|CLAUDE_PROJECT_DIR$)/;

export function testEnv(overrides = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !DROPPED.test(key)));
  const home = makeTempDir("paseo kit home ");
  fs.mkdirSync(path.join(home, ".paseo"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  Object.assign(env, { HOME: home, USERPROFILE: home, PASEO_HOME: path.join(home, ".paseo"), CLAUDE_CONFIG_DIR: path.join(home, ".claude") });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
