import assert from "node:assert/strict";
import { test } from "node:test";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { createFakeDaemon } from "../fakes/fake-daemon.mjs";
import { testEnv } from "../helpers/env.mjs";
import { connectFake } from "../helpers/run.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

const CALLER = "caller00-0000-4000-8000-000000000001";
const SEL = { provider: "circle-agent", model: "m1" };

async function setup(responder) {
  const clock = createFakeClock();
  const fake = createFakeDaemon({ clock, responder });
  const session = await connectFake(fake, { env: testEnv({ PASEO_AGENT_ID: CALLER }), root: makeTempDir(), cfg: loadKitConfig(), clock });
  const agent = await session.createAgent({ sel: SEL, prompt: "go", title: "a", name: "a", swarm: "a" });
  return { fake, session, clock, agent };
}

const turnsBy = (...perTurn) => (agent, text, { turn }) => perTurn[Math.min(turn, perTurn.length) - 1];

// The idle snapshot of the turns wrapped here carries no lastUsage, so the settle fallback has nothing to count.
function dropSnapshotUsage(session) {
  const waitForFinish = session.client.waitForFinish.bind(session.client);
  const state = { on: false };
  session.client.waitForFinish = async (...args) => {
    const st = await waitForFinish(...args);
    return state.on && st.final ? { ...st, final: { ...st.final, lastUsage: undefined } } : st;
  };
  return state;
}

test("G174 a lost late usage event does not take the next turn's event", async () => {
  // Turn 1's turn_completed never arrives: waitTurn counts its snapshot and expects one late event.
  const { fake, session, agent } = await setup(turnsBy(
    [{ reply: "one", usage: { outputTokens: 4 }, lateUsage: true }],
    [{ reply: "two", usage: { outputTokens: 9 } }],
  ));
  await session.waitTurn(agent.id);
  assert.equal(session.usage.get(agent.id).output, 4);

  // Turn 2's idle snapshot has no lastUsage, so only its own event can count it.
  const snapshot = dropSnapshotUsage(session);
  snapshot.on = true;
  await session.sendPrompt(agent.id, "next");
  await session.waitTurn(agent.id);
  assert.deepEqual(session.usage.get(agent.id), { turns: 2, input: 0, cachedInput: 0, output: 13, reportedCostUsd: null });
  assert.equal(fake.callsOf("sendAgentMessage").length, 1);
});

test("G174 a lost late usage event does not drift the totals for the rest of the agent's life", async () => {
  const { session, agent } = await setup(turnsBy(
    [{ reply: "one", usage: { outputTokens: 4 }, lateUsage: true }],
    [{ reply: "two", usage: { outputTokens: 9 } }],
    [{ reply: "three", usage: { outputTokens: 3 } }],
  ));
  await session.waitTurn(agent.id);
  await session.sendPrompt(agent.id, "next");
  await session.waitTurn(agent.id);
  assert.equal(session.usage.get(agent.id).turns, 2);
  assert.equal(session.usage.get(agent.id).output, 13);

  // Turn 3 is also snapshot-less: it is counted only if no stale late credit is left over.
  const snapshot = dropSnapshotUsage(session);
  snapshot.on = true;
  await session.sendPrompt(agent.id, "again");
  await session.waitTurn(agent.id);
  assert.equal(session.usage.get(agent.id).turns, 3);
  assert.equal(session.usage.get(agent.id).output, 16);
});

test("G174 a late event that arrives before the next prompt is still counted once", async () => {
  const { fake, session, agent } = await setup(turnsBy(
    [{ reply: "one", usage: { outputTokens: 4 }, lateUsage: true }],
    [{ reply: "two", usage: { outputTokens: 9 } }],
  ));
  await session.waitTurn(agent.id);
  fake.emitLate(agent.id);
  assert.equal(session.usage.get(agent.id).turns, 1);
  await session.sendPrompt(agent.id, "next");
  await session.waitTurn(agent.id);
  assert.deepEqual(session.usage.get(agent.id), { turns: 2, input: 0, cachedInput: 0, output: 13, reportedCostUsd: null });
});
