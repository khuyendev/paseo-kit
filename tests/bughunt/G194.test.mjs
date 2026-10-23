import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fakeEngine } from "../files/fake-engine.mjs";
import { scratch } from "../files/helpers.mjs";

const BACKEND = fileURLToPath(new URL("../../ship/.agents/harness/files/backend.mjs", import.meta.url));
const CAP_MESSAGE = /file request exceeds 16 MiB; split the call/;

test("G194 the mod refuses a request whose UTF-8 size is over 16 MiB before any backend call", async () => {
  const s = scratch();
  const f = await fakeEngine({ cwd: s.root });
  // 6,000,000 CJK characters: 6,000,136 UTF-16 units (under the cap) but 18,000,136 UTF-8 bytes (over it)
  const r = await f.call("write_multiple_files", { files: [{ path: "large.txt", content: "漢".repeat(6000000) }] });
  assert.match(r.deny ?? "", CAP_MESSAGE);
  assert.deepEqual(f.log.actions, []);
  assert.equal(f.log.bash.length, 0);
  assert.equal(s.exists("large.txt"), false);
});

test("G194 the mod still stages a CJK request that is under 16 MiB in UTF-8", async () => {
  const s = scratch();
  const f = await fakeEngine({ cwd: s.root });
  const r = await f.call("write_multiple_files", { files: [{ path: "cjk.txt", content: "漢".repeat(100000) }] });
  assert.equal(r.deny, undefined);
  assert.match(r.result, /cjk\.txt/);
  assert.equal(s.read("cjk.txt"), "漢".repeat(100000));
});

test("G194 the backend counts stdin in UTF-8 bytes: 5.5M CJK characters pass the cap, 5.6M fail", () => {
  // Both inputs are not JSON, so a request that passes the size check reports the parse error instead.
  const under = spawnSync(process.execPath, [BACKEND], { input: "漢".repeat(5500000), encoding: "utf8" });
  assert.equal(under.status, 1);
  assert.match(under.stderr, /file request is not JSON/);
  const over = spawnSync(process.execPath, [BACKEND], { input: "漢".repeat(5600000), encoding: "utf8" });
  assert.equal(over.status, 1);
  assert.match(over.stderr, CAP_MESSAGE);
});
