import assert from "node:assert/strict";
import { test } from "node:test";
import { describeItem, shellLabel, toActivity } from "../../plugins/swarm-map/server/describe.ts";
import { batchFilePaths } from "../../plugins/swarm-map/server/file-input.ts";
import { DETAIL_MAX_CHARS } from "../../plugins/swarm-map/server/limits.ts";

const tool = (detail, name = "x", extra = {}) => ({ type: "tool_call", callId: "c1", name, status: "completed", error: null, detail, ...extra });
const unknown = (name, input) => tool({ type: "unknown", input, output: null }, name);

test("PANL-33 timeline items map to activity kinds, labels and files", () => {
  const rows = [
    [tool({ type: "read", filePath: "C:/p/a.md" }), "read", "a.md", ["C:/p/a.md"]],
    [tool({ type: "edit", filePath: "/p/b.ts" }), "edit", "b.ts", ["/p/b.ts"]],
    [tool({ type: "write", filePath: "/p/c.ts" }), "write", "c.ts", ["/p/c.ts"]],
    [tool({ type: "shell", command: "npm test" }), "shell", "npm test", []],
    [tool({ type: "search", query: "foo", toolName: "grep" }), "search", "foo", []],
    [tool({ type: "search", query: "paseo", toolName: "web_search" }), "search", "web: paseo", []],
    [tool({ type: "fetch", url: "https://example.com/x" }), "fetch", "example.com/x", []],
    [tool({ type: "sub_agent", description: "plan it", log: "" }), "agent", "plan it", []],
    [tool({ type: "worktree_setup", worktreePath: "/w", branchName: "b1", log: "", commands: [] }), "shell", "worktree b1", []],
    [tool({ type: "plan", text: "\nstep one\nstep two" }), "plan", "step one", []],
    [tool({ type: "plain_text", label: "note" }), "tool", "note", []],
    [{ type: "user_message", text: "do it\nnow" }, "command", "do it", []],
    [{ type: "assistant_message", text: "done" }, "reply", "done", []],
    [{ type: "reasoning", text: "hmm" }, "think", "thinking", []],
    [{ type: "compaction", status: "completed" }, "think", "compacting context", []],
    [{ type: "todo", items: [{ text: "a", completed: true }, { text: "b", completed: false }] }, "plan", "1/2 todos done", []],
    [{ type: "error", message: "boom" }, "tool", "boom", []],
  ];
  for (const [item, kind, label, files] of rows) {
    const d = describeItem(item);
    assert.equal(d.kind, kind, JSON.stringify(item));
    assert.equal(d.label, label);
    assert.deepEqual(d.files, files);
  }
  assert.equal(describeItem({ type: "notification", level: "info", message: "x" }), null);
  const err = toActivity({ item: { type: "error", message: "boom" }, timestamp: "t", seqStart: 3 });
  assert.equal(err.status, "failed");
});

test("PANL-34 batchFilePaths covers ranges, files with duplicates, paths with junk, junk input", () => {
  assert.deepEqual(batchFilePaths({ ranges: [{ path: "a" }, { path: "b" }] }), ["a", "b"]);
  assert.deepEqual(batchFilePaths({ files: [{ path: "a" }, { path: "a" }, { path: "c" }] }), ["a", "c"]);
  assert.deepEqual(batchFilePaths({ paths: ["p", null, "", " "], files: [{ path: "f" }] }), ["p", "f"]);
  assert.deepEqual(batchFilePaths({ files: "x", ranges: [null, 3], paths: 5 }), []);
});

test("PANL-34 harness-files and native tools are classified by tool before generic rules", () => {
  const w = describeItem(unknown("mcp__harness-files__write_multiple_files", { files: [{ path: "/p/a.md", content: "x" }, { path: "/p/b.md", content: "y" }] }));
  assert.equal(w.kind, "write");
  assert.deepEqual(w.files, ["/p/a.md", "/p/b.md"]);
  assert.equal(w.label, "2 files: a.md, b.md");
  const e = describeItem(unknown("mcp__harness-files__edit_multiple_files", { files: [{ path: "/p/a.md", edits: [] }], fixes: [{ id: "f1", path: "/p/c.md" }] }));
  assert.equal(e.kind, "edit");
  assert.deepEqual(e.files, ["/p/a.md", "/p/c.md"]);
  const r = describeItem(unknown("mcp__harness-files__read_ranges", { ranges: [{ path: "/p/a.md" }] }));
  assert.equal(r.kind, "read");
  assert.equal(describeItem(unknown("Write", { file_path: "/p/n.md", content: "" })).kind, "write");
  assert.equal(describeItem(unknown("MultiEdit", { file_path: "/p/n.md" })).kind, "edit");
  assert.equal(describeItem(unknown("NotebookEdit", { notebook_path: "/p/n.ipynb" })).kind, "edit");
  assert.equal(describeItem(unknown("PowerShell", { command: "Get-ChildItem" })).kind, "shell");
  assert.equal(describeItem(unknown("mcp__paseo__browser_wait", {})).label, "paseo: browser_wait");
  assert.equal(describeItem(unknown("mcp__other__write_stuff", { files: [{ path: "/q" }] })).kind, "write");
  assert.equal(describeItem(unknown("mcp__other__dump", { files: [{ path: "/q" }] })).kind, "read");
});

test("PANL-35 activity ids are stable and texts are clipped", () => {
  const long = "x ".repeat(2500);
  const a = toActivity({ item: tool({ type: "shell", command: long }, "Bash", { callId: "call-9", status: "running" }), timestamp: "t", seqStart: 4 });
  assert.equal(a.id, "call-9");
  assert.ok(a.detail.length <= DETAIL_MAX_CHARS);
  assert.ok(a.detail.endsWith("…"));
  assert.equal(a.status, "running");
  const later = toActivity({ item: tool({ type: "shell", command: "y" }, "Bash", { callId: "call-9" }), timestamp: "t2", seqStart: 9 });
  assert.equal(later.id, a.id);
  const m = toActivity({ item: { type: "user_message", text: "hi" }, timestamp: "t", seqStart: 12 });
  assert.equal(m.id, "user_message:12");
  const many = toActivity({ item: unknown("mcp__harness-files__read_ranges", { ranges: Array.from({ length: 30 }, (_, i) => ({ path: `/f${i}` })) }), timestamp: "t", seqStart: 1 });
  assert.equal(many.files.length, 24);
});

test("PANL-36 shell labels drop cd/set/export and shorten paths", () => {
  assert.equal(shellLabel("cd C:/x && node tools/build/run.mjs --all"), "node run.mjs --all");
  assert.equal(shellLabel('node "C:\\Program Files\\kit\\run.mjs" --x'), "node run.mjs --x");
  assert.equal(shellLabel("export A=1; set B=2; npm test"), "npm test");
  assert.ok(shellLabel("echo " + "a".repeat(100)).length <= 48);
});
