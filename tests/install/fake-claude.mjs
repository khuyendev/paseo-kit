// Fake Claude CLI (INST-29): logs {args, cwd, CLAUDE_CONFIG_DIR} as JSON lines to $FAKE_CLAUDE_LOG and simulates
// --version ($FAKE_CC_VERSION, "fail" exits 1), plugin marketplace list ($FAKE_MARKETPLACES) and plugin install ($FAKE_PLUGIN_EXIT).
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const env = process.env;
if (env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, cwd: process.cwd(), CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR ?? null })}\n`);
}
const is = (...words) => words.every((w, i) => args[i] === w);

if (is("--version")) {
  if (env.FAKE_CC_VERSION === "fail") process.exit(1);
  console.log(`${env.FAKE_CC_VERSION ?? "2.1.296"} (Claude Code)`);
} else if (is("plugin", "marketplace", "list")) {
  if (env.FAKE_MARKETPLACES === "fail") process.exit(1);
  console.log(env.FAKE_MARKETPLACES ?? "[]");
} else if (is("plugin", "install")) {
  const code = Number(env.FAKE_PLUGIN_EXIT ?? 0);
  if (code) {
    console.error("fake plugin install failure");
    process.exit(code);
  }
  const file = path.join(process.cwd(), ".claude", "settings.json");
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  settings.enabledPlugins = { ...settings.enabledPlugins, [args[2].includes("@") ? args[2] : `${args[2]}@paseo-harness-kit`]: true };
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
} else {
  console.error(`fake claude: unsupported ${args.join(" ")}`);
  process.exit(3);
}
