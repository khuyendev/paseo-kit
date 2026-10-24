// WildEraV6 #1 and #3: fanout --collect admits by re-reading the caller's running count, and a name clash
// names the live agents and the ph result / ph archive commands.
import assert from "node:assert/strict";
import test from "node:test";
import { assertErrLine, assertExit, assertLine } from "../helpers/assert.mjs";
import { CALLER, addSub, creates, setup } from "../ph/setup.mjs";

const runningOf = (fake) => [...fake.agents.values()].filter((a) => a.status === "running" && a.id !== CALLER).length;

test("GW collect uses a running slot another agent of the caller frees", { timeout: 20000 }, async () => {
  const s = setup({ overlay: { max_subagents: 2 } });
  const busy = addSub(s.fake, { status: "running", title: "busy" });
  // "a" stays in its turn until "b" has been created, so the second admission has to wait and then take the slot
  // "busy" gives up. A one-shot slot count would archive "a" before creating "b".
  s.fake.setResponder((agent) => (agent.title === "a" ? [{ manual: true }] : [{ reply: `ok ${agent.title}` }]));
  let sawFull = false;
  let maxRunning = 0;
  const sample = () => { maxRunning = Math.max(maxRunning, runningOf(s.fake)); };
  const origFetch = s.fake.client.fetchAgents.bind(s.fake.client);
  s.fake.client.fetchAgents = async (opts) => {
    if (sawFull && runningOf(s.fake) >= 2) s.fake.agents.get(busy.id).status = "idle";
    else if (runningOf(s.fake) >= 2) sawFull = true;
    sample();
    return origFetch(opts);
  };
  const origCreate = s.fake.client.createAgent.bind(s.fake.client);
  s.fake.client.createAgent = async (opts) => {
    const res = await origCreate(opts);
    sample();
    const titles = [...s.fake.agents.values()].map((a) => a.title);
    if (titles.includes("a") && titles.includes("b")) {
      const held = [...s.fake.agents.values()].find((a) => a.title === "a");
      s.fake.finish(held.id, [{ reply: "ok a" }]);
    }
    return res;
  };
  s.project.write("f.txt", "=== a\nA\n=== b\nB\n");
  const r = await s.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  assertExit(r, 0);
  assertLine(r, /^waiting for a free running slot \(2 running of 2\); a slot another agent of this caller frees is used$/);
  const calls = s.fake.calls.map((c) => c.method);
  const secondCreate = calls.indexOf("createAgent", calls.indexOf("createAgent") + 1);
  assert.ok(secondCreate !== -1 && secondCreate < calls.indexOf("archiveAgent"), `second create should precede the first archive: ${calls.join(" ")}`);
  assert.ok(maxRunning <= 2, `running cap exceeded: ${maxRunning}`);
  assert.equal(s.project.read("out/a.md"), "ok a\n");
  assert.equal(s.project.read("out/b.md"), "ok b\n");
});

test("GW collect waits out a full running cap, then fails that block", { timeout: 20000 }, async () => {
  const s = setup({ overlay: { max_subagents: 1, wait_timeout_s: 1 } });
  addSub(s.fake, { status: "running", title: "busy" });
  s.project.write("f.txt", "=== a\nA\n");
  const r = await s.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  assertExit(r, 2);
  assertLine(r, "waiting for a free running slot (1 running of 1); a slot another agent of this caller frees is used");
  assertLine(r, "failed a: timed out after 1 s waiting for a free running slot (1 running of 1)");
  assert.equal(creates(s.fake).length, 0);
});

test("GW fanout name clash names the live ids and the result/archive commands", async () => {
  const s = setup();
  const one = addSub(s.fake, { title: "one" });
  const two = addSub(s.fake, { title: "two" });
  s.project.write("f.txt", "=== one\nA\n=== two\nB\n");
  const r = await s.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  assertExit(r, 1);
  // Two full ids do not fit errText's 300 characters, so the line uses the 8-character prefixes ph result and ph archive accept.
  const a = one.id.slice(0, 8);
  const b = two.id.slice(0, 8);
  assertErrLine(r, `usage error: a live subagent already has the name one (id ${a}), two (id ${b}); ph result ${a} ${b} to read them or ph archive ${a} ${b} to free the name`);
  assert.equal(creates(s.fake).length, 0);
});
