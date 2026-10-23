// F45B: a live agent follows its tier when the overlay changes (same provider: the model and thinking switch; another
// provider: the agent keeps its model and the log says why), and `ph model` switches agents and runs by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RETIER_TICK_MS } from "../../ship/.agents/harness/workflow/retier.mjs";
import { TIERS, meta, setup, tick } from "../workflow/helpers.mjs";

const OVERLAY = ".agents/harness.config.json";
const RUN_LOG = (id) => `_workspace/_runs/${id}/log.txt`;
const JOURNAL = (id) => `_workspace/_runs/${id}/journal.jsonl`;
const id8 = (id) => id.slice(0, 8);
// "" until the run has written its first line.
const runLog = (s, id) => (fs.existsSync(s.project.path(RUN_LOG(id))) ? s.project.read(RUN_LOG(id)) : "");
const retierTo = (s, provider) => s.project.writeJson(OVERLAY, { ...TIERS, tiers: { ...TIERS.tiers, pro: { provider } } });

// The test waits for the runner's state, never for a fixed number of ticks.
async function until(cond) {
  for (let i = 0; i < 1000 && !cond(); i++) await tick();
  assert.ok(cond(), "the expected state was not reached");
}

// The first turn edits the overlay (the call has already resolved its model) and then stays running until the test ends it.
// sOf() gives the setup's project: the responder runs after setup() has returned.
function editThenHold(sOf, provider) {
  return (agent, text, { turn }) => {
    if (turn === 1) retierTo(sOf(), provider);
    return [{ manual: true }];
  };
}

test("F45B a tier edited while a call runs switches the live agent: setAgentModel and a retier line", async () => {
  let s = null;
  s = setup({ responder: editThenHold(() => s, "circle/new") });
  s.project.write("wf.js", `${meta()}await agent("long", { model: "pro", label: "long" }); return "done";`);
  const run = s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_f45b_a"]);
  await until(() => s.fake.callsOf("waitForFinish").length > 0);
  await s.clock.advance(RETIER_TICK_MS);
  await until(() => s.fake.callsOf("setAgentModel").length === 1);
  const [agentId, model] = s.fake.callsOf("setAgentModel")[0].args;
  assert.equal(model, "new");
  // The tier names no thinking level, so the live agent keeps its thinking (a null option would turn it off).
  assert.equal(s.fake.callsOf("setAgentThinkingOption").length, 0);
  s.fake.finish(agentId, [{ reply: "ok", usage: { outputTokens: 1 } }]);
  const r = await run;
  assert.equal(r.code, 0, r.stderr);
  assert.match(runLog(s, "wf_f45b_a"), new RegExp(`retier long ${id8(agentId)}: circle-agent/mid -> circle-agent/new`));
  const finished = s.project.read(JOURNAL("wf_f45b_a")).split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.status === "ok");
  assert.equal(finished.model, "circle-agent/new", "the journal names the model the agent ends on");
  assert.deepEqual(finished.retiers, ["circle-agent/mid -> circle-agent/new"]);
});

test("F45B a tier that moves to another provider leaves the live agent on its model and logs why", async () => {
  let s = null;
  s = setup({ responder: editThenHold(() => s, "other/new") });
  s.project.write("wf.js", `${meta()}await agent("long", { model: "pro", label: "long" }); return "done";`);
  const run = s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_f45b_b"]);
  await until(() => s.fake.callsOf("waitForFinish").length > 0);
  const [agentId] = s.fake.callsOf("waitForFinish")[0].args;
  await s.clock.advance(RETIER_TICK_MS);
  await until(() => /moved to provider other/.test(runLog(s, "wf_f45b_b") ?? ""));
  s.fake.finish(agentId, [{ reply: "ok", usage: { outputTokens: 1 } }]);
  const r = await run;
  assert.equal(r.code, 0, r.stderr);
  assert.equal(s.fake.callsOf("setAgentModel").length, 0, "no model change across providers");
  assert.match(runLog(s, "wf_f45b_b"), /retier long: pro moved to provider other; the running agent keeps circle-agent\/mid, the next call uses the new tier/);
});

test("F45B a failed switch is logged and the call still ends ok", async () => {
  let s = null;
  s = setup({ responder: editThenHold(() => s, "circle/new") });
  s.fake.ignoreModelUpdates = true;
  s.project.write("wf.js", `${meta()}await agent("long", { model: "pro", label: "long" }); return "done";`);
  const run = s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_f45b_e"]);
  await until(() => s.fake.callsOf("waitForFinish").length > 0);
  await s.clock.advance(RETIER_TICK_MS);
  await until(() => s.fake.callsOf("setAgentModel").length === 1);
  await until(() => /failed, the agent keeps circle-agent\/mid/.test(runLog(s, "wf_f45b_e") ?? ""));
  const [agentId] = s.fake.callsOf("setAgentModel")[0].args;
  s.fake.finish(agentId, [{ reply: "ok", usage: { outputTokens: 1 } }]);
  const r = await run;
  assert.equal(r.code, 0, r.stderr);
  assert.match(runLog(s, "wf_f45b_e"), /log warning: retier long .* failed, the agent keeps circle-agent\/mid: model readback new != mid/);
});

test("F45B the retier timer stops with the run: no timer is left after the run ends", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}await agent("a", { model: "pro" }); return "done";`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_f45b_d"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(s.clock.pending(), 0, "a timer is still scheduled after the run");
});

test("F45B ph model <agentId> moves a kit agent to a tier, with its thinking level", async () => {
  const s = setup();
  s.fake.setModels("circle-agent", [{ id: "mid", thinkingOptions: [{ id: "high" }] }]);
  const agent = s.fake.addAgent({ provider: "circle-agent", model: "old", title: "reviewer", labels: { "harness.name": "reviewer" } });
  const r = await s.ph(["model", agent.id, "pro", "--thinking", "high"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.out, [`model reviewer ${id8(agent.id)}: circle-agent/old -> circle-agent/mid`]);
  assert.equal(s.fake.agents.get(agent.id).model, "mid");
  assert.equal(s.fake.agents.get(agent.id).thinkingOptionId, "high");
});

test("F45B ph model refuses a change across providers and an agent the kit did not start", async () => {
  const s = setup();
  const other = s.fake.addAgent({ provider: "other-agent", model: "x", labels: { "harness.name": "w" } });
  const bare = s.fake.addAgent({ provider: "circle-agent", model: "x", labels: {} });
  const across = await s.ph(["model", other.id, "circle/new"]);
  assert.equal(across.code, 1);
  assert.match(across.stderr, /runs on other-agent, not circle-agent; a model change stays within one provider/);
  const notKit = await s.ph(["model", bare.id, "pro"]);
  assert.equal(notKit.code, 1);
  assert.match(notKit.stderr, /was not started by the kit/);
  assert.equal(s.fake.callsOf("setAgentModel").length, 0);
});

test("F45B ph model <runId> moves every live agent of the run and names the one it cannot move", async () => {
  const s = setup();
  s.project.write("_workspace/_runs/wf_live/run.json", "{}");
  const a = s.fake.addAgent({ provider: "circle-agent", model: "old", title: "a", labels: { "harness.name": "a", "harness.run": "wf_live" } });
  const b = s.fake.addAgent({ provider: "circle-agent", model: "old", title: "b", labels: { "harness.name": "b", "harness.run": "wf_live" } });
  const c = s.fake.addAgent({ provider: "other-agent", model: "old", title: "c", labels: { "harness.name": "c", "harness.run": "wf_live" } });
  const r = await s.ph(["model", "wf_live", "circle/new"]);
  assert.equal(r.code, 2);
  assert.equal(s.fake.agents.get(a.id).model, "new");
  assert.equal(s.fake.agents.get(b.id).model, "new");
  assert.equal(s.fake.agents.get(c.id).model, "old");
  assert.match(r.out.join("\n"), new RegExp(`failed model c: agent ${id8(c.id)} runs on other-agent, not circle-agent`));
});
