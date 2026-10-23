import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { assertErrLine, assertExit, assertLine } from "../helpers/assert.mjs";
import { setup } from "../ph/setup.mjs";

// G150: a tasks.json of the wrong shape (hand-edited) must fail with a data-file error, before any operation,
// and the file must stay as it was. Before the fix these reached the array methods and died with a TypeError.
async function refused(text, argv, reason) {
  const s = setup({ caller: false });
  s.project.write("w/tasks.json", text);
  const r = await s.ph(["task", ...argv, "--ws", "w"]);
  assertExit(r, 1);
  assertErrLine(r, `failed: ${path.join(s.root, "w", "tasks.json")}: ${reason}`);
  assert.equal(s.project.read("w/tasks.json"), text);
}

const ADD = ["add", "--title", "new"];

test("G150 tasks that is not an array is refused by add, list and get, and the file is kept", async () => {
  await refused(JSON.stringify({ tasks: "not-an-array" }), ADD, "tasks must be an array");
  await refused(JSON.stringify({ tasks: {} }), ["list"], "tasks must be an array");
  await refused(JSON.stringify({ tasks: 5 }), ["get", "1"], "tasks must be an array");
});

test("G150 a root that is null or an array is refused, so an add cannot rewrite the content", async () => {
  await refused("null", ADD, "the file must hold a JSON object");
  await refused(JSON.stringify([1, 2]), ADD, "the file must hold a JSON object");
});

test("G150 a record that is null, not an object, or missing a field is refused with its index", async () => {
  await refused(JSON.stringify({ tasks: [null] }), ["list"], "tasks[0] must be an object");
  await refused(JSON.stringify({ tasks: [{ id: 1, status: "pending", depends_on: [] }, 7] }), ["list"], "tasks[1] must be an object");
  await refused(JSON.stringify({ tasks: [{ id: "1", title: "a", status: "pending", depends_on: [] }] }), ["list"], "tasks[0].id must be a number");
  await refused(JSON.stringify({ tasks: [{ id: 1, title: "a", status: "done", depends_on: [] }] }), ["list"], "tasks[0].status must be one of pending|in_progress|completed|blocked");
  await refused(JSON.stringify({ tasks: [{ id: 1, title: "a", status: "pending" }] }), ["list"], "tasks[0].depends_on must be an array");
});

test("G150 tasks null and a missing tasks key still read as an empty list", async () => {
  const s = setup({ caller: false });
  s.project.write("w/tasks.json", JSON.stringify({ tasks: null }));
  assertLine(await s.ph(["task", "add", "--ws", "w", "--title", "first"]), "task 1 added");
  s.project.write("w/tasks.json", "{}");
  assertLine(await s.ph(["task", "add", "--ws", "w", "--title", "second"]), "task 1 added");
});
