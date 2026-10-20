import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { rescueLongCommand } from "../../ship/.claude/hooks/bash_long_command.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

const bash = (command, extra = {}) => ({ tool_name: "Bash", tool_input: { command, description: "d", timeout: 5000, ...extra } });
const scriptOf = (res) => /^source '(.+)'$/.exec(res.output.hookSpecificOutput.updatedInput.command)[1].replace(/'\\''/g, "'");

test("HOOK-30 a long command and a command with \\\\ are rewritten to source a script equal to the original", () => {
  const tmpDir = makeTempDir("bash tmp ");
  const long = `cat <<'EOF'\n${"x".repeat(9000)}\nEOF`;
  const res = rescueLongCommand(bash(long), { platform: "win32", tmpDir });
  const out = res.output.hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal("permissionDecision" in out, false);
  assert.equal(out.updatedInput.description, "d");
  assert.equal(out.updatedInput.timeout, 5000);
  const script = scriptOf(res);
  assert.ok(!script.includes("\\"));
  assert.equal(path.dirname(path.resolve(script)), path.resolve(tmpDir, "claude-bash-commands"));
  assert.equal(fs.readFileSync(script, "utf8"), `${long}\n`);

  const slashes = "printf '%s' 'a\\\\b'";
  const res2 = rescueLongCommand(bash(slashes), { platform: "win32", tmpDir });
  assert.equal(fs.readFileSync(scriptOf(res2), "utf8"), `${slashes}\n`);

  const crlf = rescueLongCommand(bash(`echo 'C:\\\\x'\r\necho done\r\n`), { platform: "win32", tmpDir });
  assert.equal(fs.readFileSync(scriptOf(crlf), "utf8"), "echo 'C:\\\\x'\necho done\n");
});

test("HOOK-30 quotes count toward the limit; the script path is quote-escaped", () => {
  const tmpDir = path.join(makeTempDir("bash tmp "), "it's here");
  const quoted = "'".repeat(1600) + "x".repeat(1300);
  const res = rescueLongCommand(bash(quoted), { platform: "win32", tmpDir });
  assert.match(res.output.hookSpecificOutput.updatedInput.command, /it'\\''s here/);
  assert.equal(fs.readFileSync(scriptOf(res), "utf8"), `${quoted}\n`);
});

test("HOOK-30 short commands, other tools, non-string commands and non-win32 give no output", () => {
  const tmpDir = makeTempDir("bash tmp ");
  assert.equal(rescueLongCommand(bash("ls -la"), { platform: "win32", tmpDir }), null);
  assert.equal(rescueLongCommand(bash("x".repeat(9000)), { platform: "linux", tmpDir }), null);
  assert.equal(rescueLongCommand(bash("a\\\\b"), { platform: "darwin", tmpDir }), null);
  assert.equal(rescueLongCommand({ tool_name: "Read", tool_input: { command: "x".repeat(9000) } }, { platform: "win32", tmpDir }), null);
  assert.equal(rescueLongCommand({ tool_name: "Bash", tool_input: { command: 5 } }, { platform: "win32", tmpDir }), null);
  assert.equal(fs.existsSync(path.join(tmpDir, "claude-bash-commands")), false);
});

test("HOOK-30 scripts older than one day are pruned", () => {
  const tmpDir = makeTempDir("bash tmp ");
  const dir = path.join(tmpDir, "claude-bash-commands");
  fs.mkdirSync(dir);
  const old = path.join(dir, "old-1.sh");
  fs.writeFileSync(old, "echo\n");
  const past = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  rescueLongCommand(bash("x".repeat(7000)), { platform: "win32", tmpDir });
  assert.equal(fs.existsSync(old), false);
});
