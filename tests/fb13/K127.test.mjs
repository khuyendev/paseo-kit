// Kit feedback 127: an agent that emits no stream event is a stall at agent_silent_s, for every agent ph starts.
// The report names an open tool call so a long test run is not taken for an API hang, and it never stops or resends.
import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { runWatchAgents } from "../../ship/.agents/harness/runtime/stall.mjs";
import { createWatchdog } from "../../ship/.agents/harness/workflow/watchdog.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { assertErrLine, assertExit, assertLine, assertNoLine } from "../helpers/assert.mjs";
import { connectFake } from "../helpers/run.mjs";
import { addSub, setup as phSetup } from "../ph/setup.mjs";
import { CALLER, setup, tick } from "../workflow/helpers.mjs";

const S = 1000;
const quiet = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };

function armIdleOnNextList(fake, agent) {
  const orig = fake.client.fetchAgents.bind(fake.client);
  let n = 0;
  fake.client.fetchAgents = async (opts) => {
    if (++n >= 2) fake.agents.get(agent.id).status = "idle";
    return orig(opts);
  };
}

test("K127 agent_silent_s defaults to 300; 0 is allowed; a negative value is refused", async () => {
  const s = phSetup();
  assert.equal(loadConfig(s.root).agent_silent_s, 300);
  const off = phSetup({ overlay: { agent_silent_s: 0 } });
  assert.equal(loadConfig(off.root).agent_silent_s, 0);
  const bad = phSetup({ overlay: { agent_silent_s: -1 } });
  const r = await bad.ph(["team"]);
  assertExit(r, 1);
  assertErrLine(r, /agent_silent_s/);
});

test("K127 ph watch-agents reports a silent agent once, offers stop or resend, and does neither", async () => {
  const s = phSetup();
  const old = new Date(s.clock.now() - 300 * S).toISOString();
  const agent = addSub(s.fake, { status: "running", title: "hung", updatedAt: old });
  armIdleOnNextList(s.fake, agent);
  const r = await s.ph(["watch-agents", "--until-idle"]);
  assertExit(r, 0);
  assertLine(r, new RegExp(`^stall hung ${agent.id.slice(0, 8)} silent 300 s \\(no stream event\\); ph stop ${agent.id.slice(0, 8)} or resend the prompt$`));
  assert.equal(r.out.filter((l) => l.startsWith("stall ")).length, 1);
  assert.equal(s.fake.callsOf("cancelAgent").length, 0);
  assert.equal(s.fake.callsOf("sendAgentMessage").length, 0);
});

test("K127 ph watch-agents names an open tool call and how long it has been open", async () => {
  const s = phSetup();
  const old = new Date(s.clock.now() - 420 * S).toISOString();
  const agent = addSub(s.fake, { status: "running", title: "tester", updatedAt: old });
  const orig = s.fake.client.fetchAgents.bind(s.fake.client);
  let n = 0;
  s.fake.client.fetchAgents = async (opts) => {
    n++;
    if (n === 1) {
      s.fake.emitToolCall(agent.id, { type: "tool_call", callId: "c", name: "Bash", status: "running", detail: { type: "shell", command: "npm test" } });
      s.fake.agents.get(agent.id).updatedAt = old;
    }
    if (n >= 2) s.fake.agents.get(agent.id).status = "idle";
    return orig(opts);
  };
  const r = await s.ph(["watch-agents", "--until-idle"]);
  assertExit(r, 0);
  assertLine(r, new RegExp(`^stall tester ${agent.id.slice(0, 8)} silent 420 s during Bash open 420 s \\(a long tool call, not an API hang\\); ph stop ${agent.id.slice(0, 8)} or resend the prompt$`));
  assert.equal(s.fake.callsOf("cancelAgent").length, 0);
  assert.equal(s.fake.callsOf("sendAgentMessage").length, 0);
});

test("K127 ph watch-agents filters by caller, run and label; --until-idle exits, and it does not exit on its own", async () => {
  const s = phSetup();
  const old = new Date(s.clock.now() - 300 * S).toISOString();
  const mine = addSub(s.fake, { status: "running", title: "mine", updatedAt: old });
  s.fake.addAgent({ parent: "someone-else", status: "running", title: "foreign", updatedAt: old });
  armIdleOnNextList(s.fake, mine);
  const own = await s.ph(["watch-agents", "--until-idle"]);
  assertExit(own, 0);
  assertLine(own, /^stall mine /);
  assertNoLine(own, /foreign/);

  const scoped = phSetup();
  const inRun = addSub(scoped.fake, { status: "running", title: "in", labels: { "harness.run": "wf_a" }, updatedAt: old });
  addSub(scoped.fake, { status: "running", title: "out", labels: { "harness.run": "wf_b" }, updatedAt: old });
  armIdleOnNextList(scoped.fake, inRun);
  const byRun = await scoped.ph(["watch-agents", "--until-idle", "--run", "wf_a"]);
  assertExit(byRun, 0);
  assertLine(byRun, /^stall in /);
  assertNoLine(byRun, /stall out /);

  const labeled = phSetup();
  const hit = addSub(labeled.fake, { status: "running", title: "hit", labels: { "harness.lane": "red" }, updatedAt: old });
  addSub(labeled.fake, { status: "running", title: "miss", labels: { "harness.lane": "blue" }, updatedAt: old });
  armIdleOnNextList(labeled.fake, hit);
  const byLabel = await labeled.ph(["watch-agents", "--until-idle", "--label", "harness.lane=red"]);
  assertExit(byLabel, 0);
  assertLine(byLabel, /^stall hit /);
  assertNoLine(byLabel, /stall miss /);
  assertErrLine(await labeled.ph(["watch-agents", "--label", "nocolon"]), /--label must be key=value/);

  const idle = phSetup();
  addSub(idle.fake, { status: "idle", title: "done", updatedAt: old });
  const none = await idle.ph(["watch-agents", "--until-idle"]);
  assertExit(none, 0);
  assertNoLine(none, /^stall /);

  const clock = createFakeClock({ auto: false });
  const held = setup({ clock, overlay: { agent_silent_s: 30 } });
  const session = await connectFake(held.fake, { env: held.env, root: held.project.root, clock });
  held.fake.addAgent({ parent: CALLER, status: "running", title: "hung", updatedAt: new Date(clock.now() - 60 * S).toISOString() });
  const lines = [];
  const ac = new AbortController();
  const pending = runWatchAgents({
    session, cfg: loadConfig(held.project.root), clock, out: (l) => lines.push(l),
    filter: { caller: CALLER, run: null, label: null }, untilIdle: false, signal: ac.signal,
  });
  await quiet();
  assert.ok(lines.some((l) => l.startsWith("stall hung ")), lines.join("\n"));
  let done = false;
  pending.then(() => { done = true; }, () => { done = true; });
  await quiet(5);
  assert.equal(done, false);
  assert.equal(held.fake.callsOf("cancelAgent").length + held.fake.callsOf("sendAgentMessage").length, 0);
  ac.abort();
  await clock.advance(10 * S);
  assert.equal(await pending, 0);
});

test("K127 a stream event after a stall prints one resumed line and still does not stop", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, overlay: { agent_silent_s: 30 } });
  const session = await connectFake(s.fake, { env: s.env, root: s.project.root, clock });
  const agent = s.fake.addAgent({ parent: CALLER, status: "running", title: "hung", updatedAt: new Date(clock.now() - 60 * S).toISOString() });
  const lines = [];
  const ac = new AbortController();
  const pending = runWatchAgents({
    session, cfg: loadConfig(s.project.root), clock, out: (l) => lines.push(l),
    filter: { caller: CALLER, run: null, label: null }, untilIdle: false, signal: ac.signal,
  });
  await quiet();
  assert.equal(lines.filter((l) => l.startsWith("stall ")).length, 1);
  s.fake.emit(agent.id, { type: "thinking" });
  await quiet();
  assert.ok(lines.some((l) => l === `resumed hung ${agent.id.slice(0, 8)}`), lines.join("\n"));
  assert.equal(lines.filter((l) => l.startsWith("resumed ")).length, 1);
  assert.equal(s.fake.callsOf("cancelAgent").length + s.fake.callsOf("sendAgentMessage").length, 0);
  ac.abort();
  await clock.advance(10 * S);
  await pending;
});

test("K127 agent_silent_s 0 reports nothing; spawn's hint names watch-agents", async () => {
  const s = phSetup({ overlay: { agent_silent_s: 0 } });
  const agent = addSub(s.fake, { status: "running", title: "hung", updatedAt: new Date(s.clock.now() - 999 * S).toISOString() });
  armIdleOnNextList(s.fake, agent);
  const r = await s.ph(["watch-agents", "--until-idle"]);
  assertExit(r, 0);
  assertNoLine(r, /^stall /);
  const spawned = await s.ph(["spawn", "--name", "a", "--prompt", "w"]);
  assertExit(spawned, 0);
  assertLine(spawned, /watch-agents` \(one line per stall or recovery; it does not stop or resend\)/);
});

test("K127 fanout --collect names a silent agent and an open tool, and a fast collect stays quiet", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, overlay: { agent_silent_s: 30, wait_timeout_s: 3600 }, responder: () => [{ manual: true }] });
  s.project.write("f.txt", "=== worker\nDo the thing\n=== other\nAlso\n");
  const pending = s.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  await quiet(30);
  // The second admission waits on the cap lock's poll, which only moves with the clock.
  await clock.advance(S);
  await quiet(30);
  const worker = [...s.fake.agents.values()].find((a) => a.title === "worker");
  const other = [...s.fake.agents.values()].find((a) => a.title === "other");
  assert.ok(worker && other, [...s.fake.agents.values()].map((a) => a.title).join(", "));
  s.fake.emitToolCall(worker.id, { type: "tool_call", callId: "t", name: "Bash", status: "running", detail: { type: "shell", command: "npm test" } });
  await clock.advance(40 * S);
  await quiet(30);
  s.fake.finish(worker.id, [{ reply: "done worker" }]);
  s.fake.finish(other.id, [{ reply: "done other" }]);
  const r = await pending;
  assertExit(r, 0);
  assertLine(r, new RegExp(`^stall worker ${worker.id.slice(0, 8)} silent \\d+ s during Bash open \\d+ s \\(a long tool call, not an API hang\\); ph stop ${worker.id.slice(0, 8)} or resend the prompt$`));
  assertLine(r, new RegExp(`^stall other ${other.id.slice(0, 8)} silent \\d+ s \\(no stream event\\); ph stop ${other.id.slice(0, 8)} or resend the prompt$`));
  assert.equal(s.fake.callsOf("cancelAgent").length, 0);
  assert.equal(s.fake.callsOf("sendAgentMessage").length, 0);
  assert.equal(s.project.read("out/worker.md"), "done worker\n");

  const fast = setup();
  fast.project.write("f.txt", "=== worker\nHi\n");
  const q = await fast.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  assertExit(q, 0);
  assertNoLine(q, /^stall /);
});

test("K127 the workflow hub reports silence without steering, including during an open tool call", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, overlay: { agent_nudge_s: 0, agent_stop_s: 0, agent_tool_stuck_s: 0, agent_file_tool_stuck_s: 0, agent_silent_s: 30 } });
  const session = await connectFake(s.fake, { env: s.env, root: s.project.root, clock });
  const agent = s.fake.addAgent({ parent: CALLER, status: "running" });
  await session.observe([agent.id]);
  const out = [];
  const hub = createWatchdog({ session, cfg: loadConfig(s.project.root), clock, out: (l) => out.push(l), root: s.project.root });
  const st = hub.arm(agent.id, "lbl");
  await clock.advance(40 * S);
  hub.tick(clock.now());
  await tick();
  assert.ok(out.some((l) => l === `log watchdog: lbl ${agent.id.slice(0, 8)} stall: silent 30 s (no stream event); ph stop ${agent.id.slice(0, 8)} or resend the prompt`), out.join("\n"));
  assert.equal(s.fake.callsOf("cancelAgent").length + s.fake.callsOf("sendAgentMessage").length + s.fake.callsOf("archiveAgent").length, 0);
  s.fake.emit(agent.id, { type: "thinking" });
  await tick();
  assert.ok(out.some((l) => l === `log watchdog: lbl ${agent.id.slice(0, 8)} resumed`));
  assert.equal(st.stopReason, null);

  const clock2 = createFakeClock({ auto: false });
  const s2 = setup({ clock: clock2, overlay: { agent_nudge_s: 0, agent_stop_s: 0, agent_silent_s: 50, agent_tool_stuck_s: 180 } });
  const session2 = await connectFake(s2.fake, { env: s2.env, root: s2.project.root, clock: clock2 });
  const agent2 = s2.fake.addAgent({ parent: CALLER, status: "running" });
  await session2.observe([agent2.id]);
  const out2 = [];
  const hub2 = createWatchdog({ session: session2, cfg: loadConfig(s2.project.root), clock: clock2, out: (l) => out2.push(l), root: s2.project.root });
  hub2.arm(agent2.id, "lbl");
  s2.fake.emitToolCall(agent2.id, { type: "tool_call", callId: "w", name: "Bash", status: "running", detail: { type: "shell", command: "npm test" } });
  await clock2.advance(50 * S);
  hub2.tick(clock2.now());
  await tick();
  assert.ok(out2.some((l) => /stall: silent 50 s during Bash open 50 s \(a long tool call, not an API hang\)/.test(l)), out2.join("\n"));
  assert.equal(s2.fake.callsOf("cancelAgent").length, 0, "a long tool call is reported, not interrupted at agent_silent_s");
  await clock2.advance(140 * S);
  hub2.tick(clock2.now());
  await tick();
  assert.equal(s2.fake.callsOf("cancelAgent").length, 1, "the file/tool stuck limit still interrupts later");
  hub.close();
  hub2.close();
});

test("K127 help lists watch-agents", async () => {
  const s = phSetup();
  const r = await s.ph(["help", "watch-agents"]);
  assertExit(r, 0);
  assert.match(r.stdout, /--until-idle/);
  assert.match(r.stdout, /never stops or resends/);
});
