// G151: a failed provider catalogue lookup is not an empty catalogue. Doctor says the catalogue was unavailable and why;
// "model not offered" is only for a catalogue that loaded without the model. createAgent still proceeds without thinking.
import assert from "node:assert/strict";
import test from "node:test";
import { loadConfigLenient, loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { connectFake } from "../helpers/run.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";

const CALLER = "caller00-0000-4000-8000-000000000001";
const SEL = { provider: "circle-agent", model: "m1", thinking: "high" };

async function doctor(s) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  const code = await runDoctor(ctx, { freemem: () => 64 * 2 ** 30, claudeVersionText: () => "2.1.300 (Claude Code)" });
  return { code, out };
}

const has = (r, re) => assert.ok(r.out.some((l) => re.test(l)), `${re}\n${r.out.join("\n")}`);
const hasNot = (r, re) => assert.ok(!r.out.some((l) => re.test(l)), `${re}\n${r.out.join("\n")}`);

test("G151 doctor: a failed catalogue reply says the catalogue is unavailable and why, not that the models are not offered", async () => {
  const s = setup();
  s.fake.setModels("circle-agent", { error: "Failed to list models for circle-agent: upstream 503" });
  const r = await doctor(s);
  assert.equal(r.code, 2);
  has(r, /^problem tier pro -> circle\/pro-model\[1m\] thinking default \(catalogue unavailable: Failed to list models for circle-agent: upstream 503\)$/);
  has(r, /^problem tier standard -> circle\/std-model\[1m\] thinking default \(catalogue unavailable: Failed to list models for circle-agent: upstream 503\)$/);
  hasNot(r, /model not offered/);
});

test("G151 doctor: a rejected catalogue request (timeout, dropped connection) is also reported as unavailable", async () => {
  const s = setup();
  s.fake.setModels("circle-agent", new Error("request timed out"));
  const r = await doctor(s);
  assert.equal(r.code, 2);
  has(r, /^problem tier frontier -> circle\/front-model\[1m\] thinking default \(catalogue unavailable: request timed out\)$/);
  hasNot(r, /model not offered/);
});

test("G151 doctor: a catalogue that loaded without the model is still 'model not offered'", async () => {
  const s = setup();
  s.fake.setModels("circle-agent", []);
  const r = await doctor(s);
  has(r, /^problem tier pro -> circle\/pro-model\[1m\] thinking default \(model not offered by the provider\)$/);
  hasNot(r, /catalogue unavailable/);
});

test("G151 createAgent: a failed catalogue lookup still creates the agent, without thinkingOptionId", async () => {
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, models: { "circle-agent": { error: "upstream 503" } } });
  const session = await connectFake(fake, { env: testEnv({ PASEO_AGENT_ID: CALLER }), root: makeTempDir(), cfg: loadKitConfig(), clock });
  await session.createAgent({ sel: SEL, prompt: "do it", title: "worker-a", name: "worker-a", swarm: "worker" });
  assert.equal(fake.callsOf("createAgent").length, 1);
  assert.ok(!("thinkingOptionId" in fake.callsOf("createAgent")[0].args[0]));
});
