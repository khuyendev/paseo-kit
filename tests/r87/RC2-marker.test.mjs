// Kit feedback 87 C2: the runtime marks the agents a workflow run starts (PASEO_HARNESS_RUN), and agents they start.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { connectFake } from "../helpers/run.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { creates, setup as phSetup } from "../ph/setup.mjs";
import { meta, setup as workflowSetup } from "../workflow/helpers.mjs";

const CALLER = "caller00-0000-4000-8000-0000000000c2";
const SEL = { provider: "circle-agent", model: "m1" };

async function sessionWith(env) {
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock });
  const session = await connectFake(fake, { env: testEnv({ PASEO_AGENT_ID: CALLER, ...env }), root: makeTempDir(), cfg: loadKitConfig(), clock });
  return { fake, session };
}

test("RC2 createAgent: a run marks the agent; no run and no marked caller leaves it unmarked; a marked caller passes its run on", async () => {
  const plain = await sessionWith({});
  await plain.session.createAgent({ sel: SEL, prompt: "go", title: "a", name: "a", swarm: "a" });
  await plain.session.createAgent({ sel: SEL, prompt: "go", title: "b", name: "b", swarm: "b", run: "wf_one" });
  const [a, b] = plain.fake.callsOf("createAgent").map((c) => c.args[0].env);
  assert.equal(a.PASEO_HARNESS_RUN, undefined);
  assert.equal(b.PASEO_HARNESS_RUN, "wf_one");
  assert.equal(b.PASEO_HARNESS_ROLE, "worker");

  const marked = await sessionWith({ PASEO_HARNESS_RUN: "wf_parent" });
  await marked.session.createAgent({ sel: SEL, prompt: "go", title: "c", name: "c", swarm: "c" });
  assert.equal(marked.fake.callsOf("createAgent")[0].args[0].env.PASEO_HARNESS_RUN, "wf_parent");
});

test("RC2 every agent of a workflow run carries the run id, session agents included", async () => {
  const s = workflowSetup();
  s.project.write("wf.js", `${meta("mark")}await agent("a"); await agent("b", { session: "coder:x" }); await agent("c", { session: "coder:x" });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_mark"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const envs = s.fake.callsOf("createAgent").map((c) => c.args[0].env);
  assert.equal(envs.length, 2);
  assert.deepEqual(envs.map((e) => e.PASEO_HARNESS_RUN), ["wf_mark", "wf_mark"]);
});

test("RC2 ph spawn from a workflow agent marks the spawned agent with the caller's run; from the orchestrator it does not", async () => {
  const s = phSetup();
  assert.equal((await s.ph(["spawn", "--name", "helper", "--prompt", "go"], { env: { ...s.env, PASEO_HARNESS_RUN: "wf_outer" } })).code, 0);
  assert.equal((await s.ph(["spawn", "--name", "plain", "--prompt", "go"])).code, 0);
  const [helper, plain] = creates(s.fake);
  assert.equal(helper.env.PASEO_HARNESS_RUN, "wf_outer");
  assert.equal(plain.env.PASEO_HARNESS_RUN, undefined);
});
