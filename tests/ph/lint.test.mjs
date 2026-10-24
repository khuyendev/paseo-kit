import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { assertErrLine, assertExit, assertLine } from "../helpers/assert.mjs";
import { SHIP_DIR, makeTempDir } from "../helpers/temp.mjs";
import { setup } from "./setup.mjs";

const RUNTIME = path.join(SHIP_DIR, ".agents", "harness", "runtime");
const SKILL = fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", "ph", "SKILL.md"), "utf8");
const runtimeSources = () => fs.readdirSync(RUNTIME).filter((f) => f.endsWith(".mjs")).map((f) => [f, fs.readFileSync(path.join(RUNTIME, f), "utf8")]);

test("PHCL-01 runtime code reads no kit path from a manifest and imports only inside .agents/harness", () => {
  for (const [file, text] of runtimeSources()) {
    assert.ok(!/harness-kit\.json|MANIFEST_REL/.test(text), `${file} looks up the manifest`);
    for (const [, spec] of text.matchAll(/from "([^"]+)"/g)) {
      assert.ok(spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"), `${file} imports ${spec}`);
      if (spec.startsWith("../")) assert.ok(!spec.startsWith("../../"), `${file} imports outside .agents/harness: ${spec}`);
    }
  }
});

test("PHCL-07 one ph-command renderer: runtime code uses phCommand and builds no node command of its own", () => {
  for (const [file, text] of runtimeSources()) assert.ok(!/node "\$\{|`node "/.test(text), `${file} renders a ph command`);
});

test("PHCL-16 no rotate threshold constant besides context_guard.start_pct", () => {
  const text = fs.readFileSync(path.join(RUNTIME, "cmd-agents.mjs"), "utf8");
  assert.match(text, /context_guard\.start_pct/);
  assert.ok(!/ROTATE_PCT|rotate-pct"\] \?\? \d/.test(text));
});

test("PHCL-04 doctor through ph: lenient config, daemon down, exit 2", async () => {
  const s = setup({ fake: { down: "refused" } });
  const bin = makeTempDir("fake claude ");
  const cli = path.join(bin, "claude.mjs");
  fs.writeFileSync(cli, "console.log('2.1.300 (Claude Code)');\n");
  s.project.write(".agents/harness.config.json", "{ nope");
  const env = { ...s.env, CLAUDE_CLI: cli };
  const conf = await s.ph(["config"], { env });
  assertExit(conf, 1);
  assertErrLine(conf, /^failed: invalid harness config overlay: invalid JSON/);
  const r = await s.ph(["doctor"], { env });
  assertExit(r, 2);
  assertLine(r, /^problem invalid harness config overlay: invalid JSON/);
  assertLine(r, /^problem paseo: Cannot connect to daemon at fake: refused$/);
  assertLine(r, /^ok Claude Code 2\.1\.300 \(Claude Code\)/);
  assertLine(r, /^note overlay none|^ok overlay /);
});

test("PHCL-11 ph skill: batch follow-ups and send when idle", () => {
  assert.match(SKILL, /Batch follow-ups: collect what you want to tell an agent and send it in one `ph send` when the agent is idle/);
});

test("PHCL-17 ph skill: stop Monitors and background commands, then end the turn", () => {
  assert.match(SKILL, /stop your Monitors and background commands/);
  assert.match(SKILL, /end your turn immediately/);
});

test("PHCL-27 ph skill: advisory read-only points to ph freeze --check", () => {
  assert.match(SKILL, /otherwise the note is advisory: freeze the inputs a reviewer must not change \(`ph freeze`\) and verify them after\s+the review with `ph freeze --check`/);
});

test("PHCL-04 ph skill: watchdog numbers equal the shipped defaults; no legacy tool names or facades", () => {
  const cfg = loadKitConfig();
  for (const key of ["agent_nudge_s", "agent_stop_s", "agent_tool_stuck_s", "agent_file_tool_stuck_s", "watchdog_repeat_calls", "watchdog_same_file_reads", "watchdog_reads_without_write", "agent_silent_s"]) {
    const m = new RegExp(`\\| \`${key}\` \\| (\\d+) \\|`).exec(SKILL);
    assert.ok(m, `${key} missing from the skill table`);
    assert.equal(Number(m[1]), cfg[key], key);
  }
  assert.ok(!/fsbatch|mcp__filesystem|paseo_harness\.mjs|skills-sync|\.agents\/skills/.test(SKILL));
  assert.match(SKILL, /native `Agent` and `Workflow` are denied on the main provider/);
  assert.ok(!/SendMessage/.test(SKILL));
});
