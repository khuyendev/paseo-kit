import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { fakeHost, meta } from "../workflow/helpers.mjs";

function engine(body, host = fakeHost()) {
  const p = runWorkflow({
    source: `${meta("t")}${body}`, scriptPath: "C:/p/wf.js", args: undefined, runId: "wf_test", root: process.cwd(), env: process.env,
    limits: { maxConcurrent: 4, maxAgents: 100, budgetTotal: null, shellTimeoutS: 30 }, journalPath: undefined, cache: undefined, out: () => {},
    resolveChild: () => { throw new Error("no child"); }, extraSpent: undefined, host,
  });
  return { p, host };
}

test("G130 a non-boolean readOnly is a configuration error, never a silently writable agent", async () => {
  for (const value of ["true", "false", 1, 0, null]) {
    const { p, host } = engine(`await agent("review the code", { readOnly: ${JSON.stringify(value)} });`);
    await assert.rejects(p, /agent\(\): readOnly must be a boolean/, JSON.stringify(value));
    assert.equal(host.calls.runner.length, 0, JSON.stringify(value));
  }
});

test("G130 readOnly true, false and omitted are still accepted", async () => {
  for (const options of ["{ readOnly: true }", "{ readOnly: false }", "{}"]) {
    const { p, host } = engine(`await agent("review the code", ${options});`);
    await p;
    assert.equal(host.calls.runner.length, 1, options);
  }
});
