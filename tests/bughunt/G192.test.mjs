import assert from "node:assert/strict";
import test from "node:test";
import { TOOLS, validateArgs } from "../../ship/.agents/harness/files/tools.mjs";
import { client, scratch } from "../files/helpers.mjs";

// G192: a misspelled option is a validation error, not a silently dropped key (atomik would disable atomic mode)
test("G192 an unknown top-level edit option fails with its field path before anything is staged", () => {
  const args = { files: [{ path: "a.txt", edits: [{ oldText: "x", newText: "y" }] }], atomik: true };
  assert.throws(() => validateArgs("edit_multiple_files", args), (e) => e.message === "edit_multiple_files.atomik is not a valid field");
  const s = scratch({ "a.txt": "x" });
  const c = client({ cwd: s.root });
  assert.throws(() => c.stage("edit_multiple_files", args), /edit_multiple_files\.atomik is not a valid field/);
  assert.equal(s.read("a.txt"), "x");
});

test("G192 unknown keys are rejected at every nested object level", () => {
  const cases = [
    [{ files: [{ path: "a.txt", edits: [{ oldText: "x", newText: "y" }], tga: "t" }] }, "edit_multiple_files.files[0].tga is not a valid field"],
    [{ files: [{ path: "a.txt", edits: [{ oldText: "x", newText: "y", frm: 1 }] }] }, "edit_multiple_files.files[0].edits[0].frm is not a valid field"],
    [{ fixes: [{ id: "ab1", ocurrence: 2 }] }, "edit_multiple_files.fixes[0].ocurrence is not a valid field"],
    [{ files: [{ path: "a.txt", edits: [{ oldText: "x", newText: "y" }, { oldText: "x", newText: "z", aftr: 0 }] }] }, "edit_multiple_files.files[0].edits[1].aftr is not a valid field"],
  ];
  for (const [args, message] of cases) assert.throws(() => validateArgs("edit_multiple_files", args), (e) => e.message === message, message);
  assert.throws(() => validateArgs("read_ranges", { ranges: [{ path: "a.txt", to: 2, lines: 3 }] }), /read_ranges\.ranges\[0\]\.lines is not a valid field/);
  assert.throws(() => validateArgs("write_multiple_files", { files: [{ path: "a.txt", content: "x", mode: "w" }] }), /write_multiple_files\.files\[0\]\.mode is not a valid field/);
  assert.throws(() => validateArgs("write_multiple_files", { files: [{ path: "a.txt", content: "x" }], dryrun: true }), /write_multiple_files\.dryrun is not a valid field/);
});

test("G192 the dryRun typo is rejected, so it cannot write where a preview was meant", () => {
  const s = scratch({ "a.txt": "one" });
  const c = client({ cwd: s.root });
  assert.throws(() => c.stage("edit_multiple_files", { files: [{ path: "a.txt", edits: [{ oldText: "one", newText: "1" }] }], dryrun: true }), /edit_multiple_files\.dryrun is not a valid field/);
  assert.equal(s.read("a.txt"), "one");
});

test("G192 every documented option and field is still accepted", () => {
  const args = {
    files: [
      { path: "a.txt", tag: "t1", edits: [{ oldText: "x", newText: "y" }, { from: 2, to: 3, newText: "" }, { after: 0, newText: "top\n" }] },
    ],
    fixes: [{ id: "ab1", occurrence: 1, oldText: "x", newText: "y", path: "a.txt", tag: "t1", from: 1, to: 1, after: 0 }],
    atomic: true,
    dryRun: false,
  };
  assert.equal(validateArgs("edit_multiple_files", args), null);
  assert.equal(validateArgs("read_ranges", { ranges: [{ path: "a.txt", from: 1, to: 2 }] }), null);
  assert.equal(validateArgs("write_multiple_files", { files: [{ path: "a.txt", content: "x" }] }), null);
  assert.equal(validateArgs("read_ranges", { continuation: "a".repeat(64) }), "continuation");
});

test("G192 the published schemas are closed objects, the top level included", () => {
  for (const tool of TOOLS) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  const closed = (schema, where) => {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, where);
      for (const [key, child] of Object.entries(schema.properties)) closed(child, `${where}.${key}`);
    } else if (schema.type === "array") closed(schema.items, `${where}[]`);
  };
  for (const tool of TOOLS) closed(tool.inputSchema, tool.name);
  const edit = TOOLS.find((t) => t.name === "edit_multiple_files");
  assert.deepEqual(Object.keys(edit.inputSchema.properties).sort(), ["atomic", "continuation", "dryRun", "files", "fixes", "receipt"]);
});
