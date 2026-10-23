import assert from "node:assert/strict";
import { test } from "node:test";
import { MSG, normPath, runIoGuard } from "../../ship/.claude/hooks/io_guard.mjs";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { T, writeTranscript } from "../hooks/helpers.mjs";

const WIN = process.platform === "win32";

// One guard call over a synthetic transcript; the claim dir is passed in so calls of one session share claims.
async function guard(tmpDir, entries, tool_name, tool_input, cwd) {
  const transcript_path = writeTranscript(makeTempDir("g168 transcript "), entries);
  const res = await runIoGuard({ session_id: "g168", transcript_path, tool_name, tool_input, cwd }, {
    tmpDir,
    loadConfig: async () => loadKitConfig(),
  });
  return res?.output?.hookSpecificOutput?.additionalContext ?? "";
}

test("G168 normPath maps a Git Bash drive to its native drive on Windows and keeps POSIX paths", () => {
  if (WIN) {
    assert.equal(normPath("/c/Work/file.md"), "c:/work/file.md");
    assert.equal(normPath("C:\\Work\\file.md"), "c:/work/file.md");
    assert.equal(normPath("/c"), "c:/");
    assert.equal(normPath("file.md", "/c/Work"), "c:/work/file.md");
  } else {
    assert.equal(normPath("/c/Work/file.md"), "/c/work/file.md");
  }
});

test("G168 a native edit and a Read by the Git Bash spelling name one file", { skip: !WIN }, async () => {
  const entries = [T.prompt("p"), T.uses("e", [["e1", "Edit", { file_path: "C:\\Work\\file.md" }]]), T.results(["e1"])];
  const text = await guard(makeTempDir("g168 tmp "), entries, "Read", { file_path: "/c/Work/file.md" }, "C:\\Work");
  assert.equal(text, MSG.reread(["c:/work/file.md"]));
});

test("G168 a Git Bash edit and a Read by the native spelling name one file", { skip: !WIN }, async () => {
  const entries = [T.prompt("p"), T.uses("e", [["e1", "Edit", { file_path: "/c/Work/file.md" }]]), T.results(["e1"])];
  const text = await guard(makeTempDir("g168 tmp "), entries, "Read", { file_path: "C:\\Work\\file.md" }, "C:\\Work");
  assert.equal(text, MSG.reread(["c:/work/file.md"]));
});

test("G168 the reread reminder of one file is spoken once when re-read by the other spelling", { skip: !WIN }, async () => {
  const tmpDir = makeTempDir("g168 tmp ");
  const edit = [T.prompt("p"), T.uses("e", [["e1", "Edit", { file_path: "/c/Work/file.md" }]]), T.results(["e1"])];
  assert.equal(await guard(tmpDir, edit, "Read", { file_path: "C:\\Work\\file.md" }, "C:\\Work"), MSG.reread(["c:/work/file.md"]));
  const read = [...edit, T.uses("r1", [["r1", "Read", { file_path: "C:\\Work\\file.md" }]]), T.results(["r1"])];
  const text = await guard(tmpDir, read, "Read", { file_path: "/c/Work/file.md" }, "C:\\Work");
  assert.doesNotMatch(text, /was edited earlier/);
});
