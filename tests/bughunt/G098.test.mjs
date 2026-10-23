// Bug-hunt fix G098: a malformed handoff file ends verify and execute with a failed status that names the file.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeExecWorld } from "../gsd-flows/exec-world.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";

const HANDOFF = `${PHASE_DIR}/handoff/w1.args.json`;
const BAD = ["", "{\"waveId\": \"w1\", \"tasks\": ["];

test("G098 verify: a malformed handoff file returns failed naming the file before any write", async () => {
  for (const text of BAD) {
    const w = makeWorld();
    w.write(HANDOFF, text);
    const r = await runScript("gsd-verify", { root: w.root, gsd: w.gsd, args: { phaseDir: PHASE_DIR }, agent: () => ({ status: "passed" }) });
    assert.equal(r.result.status, "failed");
    assert.match(r.result.reason, /handoff\/w1\.args\.json is not valid handoff JSON/);
    assert.deepEqual([r.calls.length, w.attempts.verify], [0, undefined]);
  }
});

test("G098 execute: a malformed handoff file returns failed naming the file and dispatches no executor", async () => {
  for (const text of BAD) {
    const w = makeExecWorld();
    w.write(HANDOFF, text);
    const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: () => ({ status: "done" }) });
    assert.equal(r.result.status, "failed");
    assert.match(r.result.reason, /handoff\/w1\.args\.json is not valid handoff JSON/);
    assert.equal(r.calls.length, 0);
  }
});
