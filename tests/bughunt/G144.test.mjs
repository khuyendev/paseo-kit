// Bug-hunt fix G144: a workflow agent() without timeoutS waits for its turn or for the watchdog's stop (agent_stop_s, model
// time), not for wait_timeout_s of wall time. wait_timeout_s stays the cap of unarmed waits and of an explicit timeoutS.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { CALLER, meta, runOwn, setup, tick } from "../workflow/helpers.mjs";

const runDir = (s, id) => s.project.path(`_workspace/_runs/${id}`);
const finalEntry = (s, id) => readJournal(path.join(runDir(s, id), "journal.jsonl")).find((e) => e.status === "ok" || e.status === "null");
const waits = (s) => s.fake.callsOf("waitForFinish").map((c) => c.args[1]);

// Runs the workflow on the fake clock, one simulated second at a time; `each(i, agentId)` runs after every second once the
// agent exists.
async function drive(s, argv, each = () => {}) {
  let res = null;
  const p = runOwn(argv, s).then((r) => (res = r));
  let agentId = null;
  for (let i = 0; i < 20_000 && !res; i++) {
    await s.clock.advance(1000);
    await tick();
    agentId ??= [...s.fake.agents.values()].find((a) => a.id !== CALLER)?.id ?? null;
    if (agentId) each(i, agentId);
  }
  await p;
  return res;
}

test("G144 (i) a no-tool turn past 3600 s with the shipped defaults ends with the watchdog stop at 5400 s", async () => {
  const clock = createFakeClock({ auto: false });
  // The turn never ends and makes no tool call: all of its time is model time. The default nudge (2700 s) lands mid-wait.
  const s = setup({ clock, responder: () => [{ manual: true }] });
  s.project.write("wf.js", `${meta()}return await agent("long", { detail: true });`);
  const r = await drive(s, ["workflow", "--script", "wf.js", "--run-id", "wf_g144i"]);
  assert.equal(r.code, 0, r.stderr);
  const entry = finalEntry(s, "wf_g144i");
  assert.equal(entry.status, "null");
  assert.equal(entry.reason, "watchdog stopped the agent after 5400 s");
  assert.equal(entry.duration_s, 5400);
  assert.deepEqual(waits(s), [3600000, 3600000], "the waits are bounded slices of wait_timeout_s");
  assert.equal(s.fake.callsOf("sendAgentMessage").length, 1, "only the watchdog's nudge was sent; it did not end the wait");
  assert.equal(s.fake.callsOf("archiveAgent").length >= 1, true);
});

test("G144 (ii) five 800 s tool calls with near-zero model time are not cut at the 3600 s wait", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, responder: () => [{ manual: true }] });
  s.project.write("wf.js", `${meta()}return await agent("builds", { detail: true });`);
  let k = 0;
  let prev = null;
  let ended = false;
  const r = await drive(s, ["workflow", "--script", "wf.js", "--run-id", "wf_g144ii"], (i, agentId) => {
    if (i % 800 !== 0 || ended) return;
    if (prev) s.fake.emitToolCall(agentId, { type: "tool_call", callId: prev.id, name: "Bash", status: "completed", detail: prev.detail });
    if (k === 5) {
      ended = true;
      s.fake.finish(agentId, [{ reply: "built" }]);
      return;
    }
    prev = { id: `b${++k}`, detail: { type: "shell", command: `npm run build -- part ${k}` } };
    s.fake.emitToolCall(agentId, { type: "tool_call", callId: prev.id, name: "Bash", status: "running", detail: prev.detail });
  });
  assert.equal(r.code, 0, r.stderr);
  const entry = finalEntry(s, "wf_g144ii");
  assert.equal(entry.status, "ok", JSON.stringify(entry));
  assert.ok(entry.duration_s >= 4000 && entry.duration_s <= 4002, `duration ${entry.duration_s} s`);
  assert.equal(waits(s)[0], 3600000);
  assert.equal(waits(s).length, 2, "the wait went past the first 3600 s slice");
});

test("G144 (iii) a provider error at 3000 s restarts the wait; the watchdog stop still fires at 5400 s of model time", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, overlay: { agent_nudge_s: 0 }, responder: () => [{ manual: true }] });
  s.project.write("wf.js", `${meta()}return await agent("retry", { detail: true });`);
  let errored = false;
  const r = await drive(s, ["workflow", "--script", "wf.js", "--run-id", "wf_g144iii"], (i, agentId) => {
    if (!errored && i === 3000) {
      errored = true;
      s.fake.finish(agentId, [{ error: "overloaded" }]);
    }
  });
  assert.equal(r.code, 0, r.stderr);
  const entry = finalEntry(s, "wf_g144iii");
  assert.equal(entry.status, "null");
  assert.equal(entry.reason, "watchdog stopped the agent after 5400 s");
  assert.equal(entry.duration_s, 5400);
  assert.ok(s.fake.callsOf("sendAgentMessage").some((c) => /Your previous turn ended with an error/.test(c.args[1])), "the retry continued the agent");
});

test("G144 (iv) an unarmed wait still ends at wait_timeout_s: watchdog off, or no stop limit", async () => {
  for (const overlay of [{ watchdog_enabled: false }, { agent_nudge_s: 0, agent_stop_s: 0 }]) {
    const clock = createFakeClock({ auto: false });
    const s = setup({ clock, overlay, responder: () => [{ manual: true }] });
    s.project.write("wf.js", `${meta()}return await agent("long", { detail: true });`);
    const r = await drive(s, ["workflow", "--script", "wf.js", "--run-id", "wf_g144iv"]);
    assert.equal(r.code, 0, r.stderr);
    const entry = finalEntry(s, "wf_g144iv");
    assert.equal(entry.reason, "no reply within 3600 s", JSON.stringify(overlay));
    assert.equal(entry.duration_s, 3600, JSON.stringify(overlay));
    assert.deepEqual(waits(s), [3600000], JSON.stringify(overlay));
  }
});

test("G144 (v) an explicit timeoutS still ends the call at its value", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, responder: () => [{ manual: true }] });
  s.project.write("wf.js", `${meta()}return await agent("short", { detail: true, timeoutS: 1200 });`);
  const r = await drive(s, ["workflow", "--script", "wf.js", "--run-id", "wf_g144v"]);
  assert.equal(r.code, 0, r.stderr);
  const entry = finalEntry(s, "wf_g144v");
  assert.equal(entry.reason, "no reply within 1200 s");
  assert.equal(entry.duration_s, 1200);
  assert.deepEqual(waits(s), [1200000]);
});
