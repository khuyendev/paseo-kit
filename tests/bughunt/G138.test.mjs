import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { meta, setup } from "../workflow/helpers.mjs";

const runFile = (project, id, f) => path.join(project.path("_workspace/_runs"), id, f);
const result = (project, id) => JSON.parse(fs.readFileSync(runFile(project, id, "result.json"), "utf8"));
const SCRIPT = `${meta()}return args === undefined ? "undefined" : args === null ? "null" : "value:" + JSON.stringify(args);`;

test("G138 explicit --args null resumes as null, not undefined", async () => {
  const s = setup();
  s.project.write("wf.js", SCRIPT);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_a", "--args", "null"])).code, 0);
  assert.equal(result(s.project, "wf_a"), "null");
  assert.equal((await s.ph(["workflow", "--resume", "wf_a", "--run-id", "wf_b"])).code, 0);
  assert.equal(result(s.project, "wf_b"), "null");
});

test("G138 --args-file holding null resumes as null", async () => {
  const s = setup();
  s.project.write("wf.js", SCRIPT);
  s.project.write("a.json", "null");
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--args-file", "a.json", "--run-id", "wf_c"])).code, 0);
  assert.equal(result(s.project, "wf_c"), "null");
  assert.equal((await s.ph(["workflow", "--resume", "wf_c", "--run-id", "wf_d"])).code, 0);
  assert.equal(result(s.project, "wf_d"), "null");
});

test("G138 omitted args still resume as undefined and write no args.json", async () => {
  const s = setup();
  s.project.write("wf.js", SCRIPT);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_e"])).code, 0);
  assert.equal(fs.existsSync(runFile(s.project, "wf_e", "args.json")), false);
  assert.equal((await s.ph(["workflow", "--resume", "wf_e", "--run-id", "wf_f"])).code, 0);
  assert.equal(result(s.project, "wf_e"), "undefined");
  assert.equal(result(s.project, "wf_f"), "undefined");
});
