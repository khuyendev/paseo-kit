import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { acquireSlot, runSyntaxCheck } from "../../ship/.claude/hooks/syntax_check.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { hookProject } from "../hooks/helpers.mjs";

const FAKE = fileURLToPath(new URL("../hooks/fixtures/fake_checker.mjs", import.meta.url));

// The fixture checker; `rejectAll` replaces its verdict rule so the same program now fails every file.
function checkerScript(rejectAll) {
  const text = fs.readFileSync(FAKE, "utf8");
  return rejectAll ? text.replace('text.includes("BROKEN")', "true") : text;
}

const runs = (log) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0);

function hook(ctx) {
  return async (event, tool_input, id) => {
    const input = { session_id: "g172", tool_use_id: id, cwd: ctx.project.root, hook_event_name: event, tool_name: "Edit", tool_input };
    const res = await runSyntaxCheck(input, { env: ctx.env, stateDir: ctx.stateDir });
    return res?.output?.hookSpecificOutput?.additionalContext ?? "";
  };
}

test("HOOK-27 replacing the checker program at the same argv invalidates its cached results", async () => {
  const log = path.join(makeTempDir("syntax log "), "runs.jsonl");
  const argv = [process.execPath, "tools/checker.mjs", "--log", log, "--tag", "A"];
  const project = hookProject({ overlay: { adapter: { syntax_checkers: { ".txt": { argv } } } } });
  project.write("tools/checker.mjs", checkerScript(true));
  const ctx = { project, stateDir: makeTempDir("syntax state "), env: { CLAUDE_PROJECT_DIR: project.root } };
  const h = hook(ctx);
  project.write("a.txt", "ok");
  await h("PreToolUse", { file_path: "a.txt" }, "p1"); // the old program rejects "ok"; the fail is cached
  project.write("tools/checker.mjs", checkerScript(false)); // same argv, new program: accepts "ok"
  await h("PreToolUse", { file_path: "a.txt" }, "p2"); // must run the new program, not return the old fail
  project.write("a.txt", "BROKEN");
  const text = await h("PostToolUse", { file_path: "a.txt" }, "p2");
  assert.match(text, /a\.txt:1:2: syntax error near BROKEN/);
  assert.equal(runs(log), 3);
});

test("HOOK-27 a reclaim guard left by a dead reclaimer does not wedge its slot", async () => {
  const dir = makeTempDir("syntax slots ");
  const lock = path.join(dir, "slot-0.lock");
  const guard = `${lock}.reclaim-crashed-owner`;
  const past = new Date(Date.now() - 600_000);
  fs.writeFileSync(lock, "crashed-owner");
  fs.utimesSync(lock, past, past);
  fs.writeFileSync(guard, "");
  fs.utimesSync(guard, past, past); // the reclaimer died between creating the guard and removing it
  const release = await acquireSlot(dir, 1, Date.now() + 500, 180_000);
  assert.ok(release, "the abandoned slot is taken over");
  release();
  assert.deepEqual(fs.readdirSync(dir), [], "no lock, guard or temp file left");
});

test("HOOK-27 a reclaim guard that is still fresh keeps its stale slot untouched", async () => {
  const dir = makeTempDir("syntax slots ");
  const lock = path.join(dir, "slot-0.lock");
  const guard = `${lock}.reclaim-crashed-owner`;
  const past = new Date(Date.now() - 600_000);
  fs.writeFileSync(lock, "crashed-owner");
  fs.utimesSync(lock, past, past);
  fs.writeFileSync(guard, ""); // another reclaimer is working on this lock right now
  assert.equal(await acquireSlot(dir, 1, Date.now() + 300, 180_000), null);
  assert.ok(fs.existsSync(lock));
  assert.ok(fs.existsSync(guard));
});
