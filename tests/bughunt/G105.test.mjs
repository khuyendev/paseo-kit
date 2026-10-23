// Bug-hunt regression for G105: quick task ids come from reservations, so a gap, a removed directory, base-36 numbers
// and two runs that count at the same time never hand out a number that is already in use.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";

const { quickDir } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-project.mjs")).href);
const DAY = new Date(2026, 9, 23);
const quick = (root, description) => quickDir(root, description, DAY);
const seed = (root, ...names) => { for (const n of names) fs.mkdirSync(path.join(root, ".planning/quick", n), { recursive: true }); };

test("G105 quick ids skip numbers already in use: a gap, an existing directory and base-36 numbers", () => {
  const root = makeTempDir();
  seed(root, "261023-001-old", "261023-003-new-task");
  assert.deepEqual(quick(root, "other work"), { id: "261023-004", dir: ".planning/quick/261023-004-other-work" });
  const b36 = makeTempDir();
  seed(b36, "261023-00a-x");
  assert.equal(quick(b36, "next").id, "261023-00b");
});

test("G105 a removed quick directory does not free its number", () => {
  const root = makeTempDir();
  quick(root, "first");
  const second = quick(root, "second");
  fs.rmSync(path.join(root, second.dir), { recursive: true });
  assert.equal(quick(root, "third").id, "261023-003");
});

test("G105 runs that count before either creates a directory get different ids, with the same or another description", () => {
  const root = makeTempDir();
  const first = quick(root, "same task");
  // Both later runs read the quick directory before the first run created anything in it.
  mock.method(fs, "readdirSync", () => []);
  try {
    const second = quick(root, "same task");
    const other = quick(root, "other work");
    assert.deepEqual([first.id, second.id, other.id], ["261023-001", "261023-002", "261023-003"]);
    assert.ok(fs.existsSync(path.join(root, second.dir)) && fs.existsSync(path.join(root, other.dir)));
  } finally {
    mock.restoreAll();
  }
});
