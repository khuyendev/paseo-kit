// F45: a running workflow resolves each agent() call's tier from the config as it is when the call starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TIERS, meta, setup } from "../workflow/helpers.mjs";

const OVERLAY = ".agents/harness.config.json";
const created = (fake) => fake.callsOf("createAgent").map((c) => `${c.args[0].provider}/${c.args[0].model}`);
const runLog = (s, id) => fs.readFileSync(path.join(s.project.path(`_workspace/_runs/${id}`), "log.txt"), "utf8");
const retier = (s, provider) => s.project.writeJson(OVERLAY, { ...TIERS, tiers: { ...TIERS.tiers, pro: { provider } } });

// The first agent's turn is the first responder call; the edit happens while that agent runs.
function editOnFirstTurn(edit) {
  let turns = 0;
  return (agent, text, { turn }) => {
    if (++turns === 1) edit();
    return [{ reply: "ok", usage: { outputTokens: 1 } }];
  };
}

test("F45 a tier edited during a run reaches the next agent() call and the run logs the change", async () => {
  let s = null;
  s = setup({ responder: editOnFirstTurn(() => retier(s, "circle/new")) });
  s.project.write("wf.js", `${meta()}await agent("first", { model: "pro" }); await agent("second", { model: "pro" }); return "done";`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_f45"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(created(s.fake), ["circle-agent/mid", "circle-agent/new"]);
  assert.match(runLog(s, "wf_f45"), /tier pro: circle-agent\/mid -> circle-agent\/new/);
});

test("F45 an overlay that stops loading mid-run keeps the last good tiers and warns once", async () => {
  let s = null;
  s = setup({ responder: editOnFirstTurn(() => s.project.write(OVERLAY, "{ not json")) });
  s.project.write("wf.js", `${meta()}await agent("a", { model: "pro" }); await agent("b", { model: "pro" }); await agent("c", { model: "pro" }); return "done";`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_f45b"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(created(s.fake), ["circle-agent/mid", "circle-agent/mid", "circle-agent/mid"]);
  assert.equal(runLog(s, "wf_f45b").match(/config not reloaded/g)?.length, 1);
});
