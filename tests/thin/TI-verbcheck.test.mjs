// THIN.md item 1: the composition verb check (gsd/verb-check.mjs) scans the calls of the engine globals `flow` and `gsd`
// in a script without the copied helper block, still scans a script that carries the old block, and skips a script
// whose own `flow`/`gsd` is not the kit's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCompositionVerbs, verbCalls } from "../../ship/.agents/harness/gsd/verb-check.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { OLD_BLOCK } from "./engine.mjs";

const BODY = 'await flow(["read", "x"]);\nawait flow(["no-such-verb"]);\nawait gsd(["hash"], "x");\n';

test("TI a composition that calls the engine globals is scanned", () => {
  assert.deepEqual(verbCalls(BODY).calls, [
    { kind: "flow", verb: "read", line: 1 },
    { kind: "flow", verb: "no-such-verb", line: 2 },
    { kind: "gsd", verb: "hash", line: 3 },
  ]);
});

test("TI a script with the old copied block is still scanned; one with its own flow or gsd is not", () => {
  assert.equal(verbCalls(`${OLD_BLOCK}${BODY}`).calls.length, verbCalls(OLD_BLOCK).calls.length + 3);
  assert.deepEqual(verbCalls(`const flow = (x) => x;\n${BODY}`).calls.map((c) => c.kind), ["gsd"]);
  assert.deepEqual(verbCalls(`async function gsd(a) { return a; }\n${BODY}`).calls.map((c) => c.kind), ["flow", "flow"]);
});

test("TI the shipped compositions without the block still have every verb call checked, none unknown", () => {
  const r = checkCompositionVerbs(SHIP_DIR);
  assert.equal(r.scripts, 9);
  // THIN stage 3: the verb calls of gsd-execute's shared steps moved into the kit step library (harness/workflow/steps.mjs).
  assert.ok(r.calls > 150, JSON.stringify(r));
  assert.deepEqual(r.problems, []);
});
