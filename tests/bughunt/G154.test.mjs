// Bug-hunt fix G154: the ph skill must not say `ph context` rotates agents; it only prints the ROTATE marker.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertExit, assertLine } from "../helpers/assert.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { addSub, setup } from "../ph/setup.mjs";

const SKILL = fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", "ph", "SKILL.md"), "utf8");
const contextRow = SKILL.split("\n").find((l) => l.startsWith("| `ph context"));

test("G154 the ph skill's context row says ROTATE only marks an agent and changes nothing", () => {
  assert.ok(contextRow, "no ph context row in SKILL.md");
  assert.doesNotMatch(contextRow, /replace/);
  assert.match(contextRow, /changes nothing/);
});

test("G154 ph context over the threshold prints the marker and touches no agent", async () => {
  const s = setup();
  addSub(s.fake, { title: "full", lastUsage: { contextWindowUsedTokens: 90, contextWindowMaxTokens: 100 } });
  const r = await s.ph(["context"]);
  assertExit(r, 0);
  assertLine(r, /full  ROTATE$/);
  for (const method of ["createAgent", "archiveAgent", "cancelAgent", "sendAgentMessage"]) {
    assert.equal(s.fake.callsOf(method).length, 0, `ph context called ${method}`);
  }
});
