// G027: the outline writer runs the outline check itself, so a deterministic outline failure is repaired in its own turn.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";

const plan = (w, args = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w) });
const outlinePrompt = (r) => r.calls.find((c) => c.opts.label === "outline").prompt;

test("G027 the outline prompt names the outline check command with the same flags the gate runs", async () => {
  const prompt = outlinePrompt(await plan(makeWorld()));
  assert.match(prompt, /`node \.agents\/harness\/ph\.mjs gsd outline check 01`/);
  assert.doesNotMatch(prompt, /--tracer false/);
  const tracerOff = outlinePrompt(await plan(makeWorld(), { tracer: false }));
  assert.match(tracerOff, /`node \.agents\/harness\/ph\.mjs gsd outline check 01 --tracer false`/);
});
