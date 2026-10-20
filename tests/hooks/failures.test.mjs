import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { hookEnv, hookProject, runHookSync, T, writeTranscript } from "./helpers.mjs";

const HOOKS = ["context_guard.mjs", "io_guard.mjs", "syntax_check.mjs", "bash_long_command.mjs"];
const NAMES = { "context_guard.mjs": "context guard", "io_guard.mjs": "io guard", "syntax_check.mjs": "syntax check" };

function payload(project, transcript_path) {
  return {
    session_id: "fail",
    tool_use_id: "u1",
    transcript_path,
    cwd: project.root,
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "a.txt", command: "x".repeat(7000) },
  };
}

const noPermissionDecision = (r) => assert.doesNotMatch(r.stdout, /permissionDecision|"decision"|"block"/);

test("HOOK-05 bad JSON and a missing transcript exit 0 silently", () => {
  const project = hookProject();
  const env = hookEnv(project.root);
  for (const hook of HOOKS) {
    const bad = runHookSync(project.root, hook, "{not json", { env });
    assert.deepEqual([bad.code, bad.stdout, bad.stderr], [0, "", ""], hook);
    const missing = runHookSync(project.root, hook, { ...payload(project, path.join(project.root, "nope.jsonl")), tool_name: "Grep" }, { env });
    assert.equal(missing.code, 0, hook);
    assert.equal(missing.stderr, "", hook);
    noPermissionDecision(missing);
  }
});

test("HOOK-05 a broken overlay gives exactly one stderr line and no stdout", () => {
  const project = hookProject({ files: { ".agents/harness.config.json": "{ broken" } });
  const env = hookEnv(project.root);
  const transcript_path = writeTranscript(project.root, [T.prompt("p"), T.usage(900000)]);
  project.write("a.txt", "x");
  for (const hook of HOOKS) {
    const input = payload(project, transcript_path);
    if (hook === "bash_long_command.mjs") Object.assign(input, { tool_name: "Bash" });
    const r = runHookSync(project.root, hook, input, { env });
    assert.equal(r.code, 0, hook);
    if (hook === "bash_long_command.mjs") {
      assert.equal(r.stderr, "", "the rescue reads no config");
      noPermissionDecision(r);
      continue;
    }
    assert.equal(r.stdout, "", hook);
    assert.equal(r.err.length, 1, `${hook}: ${r.stderr}`);
    assert.match(r.err[0], new RegExp(`^${NAMES[hook]} unavailable: invalid harness config overlay: invalid JSON`));
  }
});

test("HOOK-05 a project without the runtime reports the hook unavailable, exit 0", () => {
  const project = hookProject();
  const env = hookEnv(path.join(project.root, "elsewhere"));
  const transcript_path = writeTranscript(project.root, [T.prompt("p")]);
  const r = runHookSync(project.root, "io_guard.mjs", { session_id: "x", transcript_path, tool_name: "Grep", tool_input: {} }, { env });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^io guard unavailable: /);
});
