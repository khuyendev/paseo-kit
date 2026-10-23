// G010: a phaseDir whose number matches but whose directory is not the phase's canonical one (a stale slug) is refused
// before any agent runs or any file is written there.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const STALE_DIR = ".planning/phases/01-old-name";
const plan = (w, phaseDir) => runScript("gsd-plan", { root: w.root, args: { phaseDir }, gsd: w.gsd, agent: plannerResponder(w) });

test("G010 a stale phaseDir with the same phase number is refused before any agent or write", async () => {
  const w = makeWorld({ files: { [`${STALE_DIR}/01-CONTEXT.md`]: "<decisions>\n- **D-01:** stale\n</decisions>\n", [`${STALE_DIR}/01-RESEARCH.md`]: "stale\n" } });
  const r = await plan(w, STALE_DIR);
  assert.equal(r.result.status, "refused");
  assert.match(r.result.reason, /\.planning\/phases\/01-old-name/);
  assert.match(r.result.reason, /\.planning\/phases\/01-core/);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(w.root, STALE_DIR)).sort(), ["01-CONTEXT.md", "01-RESEARCH.md"]);
});

test("G010 the canonical phaseDir of the same phase still plans", async () => {
  const w = makeWorld();
  const r = await plan(w, PHASE_DIR);
  assert.notEqual(r.result.status, "refused");
  assert.ok(r.calls.length > 0);
});
