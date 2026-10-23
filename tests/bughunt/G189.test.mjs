import assert from "node:assert/strict";
import test from "node:test";
import { TOOLS } from "../../ship/.agents/harness/files/tools.mjs";
import { client, fixIds, scratch } from "../files/helpers.mjs";

const schema = TOOLS.find((t) => t.name === "edit_multiple_files").inputSchema;

test("G189 an empty fixes[].path is refused at argument validation, naming the fix, and no fix ID is consumed", () => {
  const s = scratch({ "a.txt": "alpha\nbeta\n" });
  const c = client({ cwd: s.root });
  const failed = c.call("edit_multiple_files", { files: [{ path: "a.txt", edits: [{ oldText: "nothing", newText: "x" }, { oldText: "absent", newText: "y" }] }] });
  const [one, two] = fixIds(failed.text.split("failed:\n")[1]);
  assert.ok(one && two, failed.text);
  const batch = { fixes: [{ id: one, oldText: "alpha", newText: "ALPHA" }, { id: two, path: "" }] };
  assert.throws(() => c.stage("edit_multiple_files", batch), (e) => e.message === "edit_multiple_files.fixes[1].path has an invalid string value");
  assert.equal(s.read("a.txt"), "alpha\nbeta\n");
  assert.match(c.call("edit_multiple_files", { fixes: [{ id: one, oldText: "alpha", newText: "ALPHA" }] }).text, /^edited /);
  assert.equal(s.read("a.txt"), "ALPHA\nbeta\n");
});

test("G189 an empty files[].path is refused at argument validation before planning writes any state", () => {
  const s = scratch({ "a.txt": "alpha\n" });
  const c = client({ cwd: s.root });
  const batch = { files: [{ path: "", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, { path: "a.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }] };
  assert.throws(() => c.stage("edit_multiple_files", batch), (e) => e.message === "edit_multiple_files.files[0].path has an invalid string value");
  assert.equal(s.read("a.txt"), "alpha\n");
});

test("G189 the advertised schema rejects an empty path in files and fixes", () => {
  assert.equal(schema.properties.files.items.properties.path.minLength, 1);
  assert.equal(schema.properties.fixes.items.properties.path.minLength, 1);
});
