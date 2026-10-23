// Bug-hunt fix G162: ph result --json says when its skills list could not be read or was cut to the last 1000 timeline entries.
import assert from "node:assert/strict";
import test from "node:test";
import { assertExit } from "../helpers/assert.mjs";
import { addSub, setup } from "../ph/setup.mjs";

const filler = (fake, a, n) => {
  for (let i = 0; i < n; i++) fake.emitToolCall(a.id, { type: "tool_call", name: "Read", input: { path: `f${i}` } });
};

test("G162 result --json: a failed timeline read is unknown (skills null with a warning), not an empty skills list", async () => {
  const s = setup();
  const a = addSub(s.fake, { title: "r1", lastUsage: { outputTokens: 3 } });
  s.fake.emitToolCall(a.id, { type: "tool_call", name: "Skill", input: { skill: "gsd-plan" } });
  s.fake.client.fetchAgentTimeline = async () => {
    throw new Error("daemon unavailable");
  };
  const r = await s.ph(["result", "--json", "r1"]);
  assertExit(r, 0);
  const obj = JSON.parse(r.out[0]);
  assert.equal(obj.final, "");
  assert.equal(obj.status, "idle");
  assert.equal(obj.skills, null);
  assert.match(obj.skillsWarning, /^could not read the timeline, skills unknown: daemon unavailable$/);
});

test("G162 result --json: a timeline longer than the 1000-entry window says the list is partial", async () => {
  const s = setup();
  const a = addSub(s.fake, { title: "r1" });
  s.fake.emitToolCall(a.id, { type: "tool_call", name: "Skill", input: { skill: "gsd-plan" } });
  filler(s.fake, a, 1000);
  const obj = JSON.parse((await s.ph(["result", "--json", "r1"])).out[0]);
  assert.deepEqual(obj.skills, []);
  assert.equal(obj.skillsWarning, "only the last 1000 timeline entries were read; skill calls older than that are not listed");
  assert.equal(s.fake.callsOf("fetchAgentTimeline")[0].args[1].limit, 1000);
});

test("G162 result --json: a skill call inside the window is listed, and a complete timeline has no warning", async () => {
  const s = setup();
  const a = addSub(s.fake, { title: "r1" });
  filler(s.fake, a, 1000);
  s.fake.emitToolCall(a.id, { type: "tool_call", name: "Skill", input: { skill: "gsd-verify" } });
  const partial = JSON.parse((await s.ph(["result", "--json", "r1"])).out[0]);
  assert.deepEqual(partial.skills, ["gsd-verify"]);
  assert.match(partial.skillsWarning, /^only the last 1000 timeline entries/);

  const b = addSub(s.fake, { title: "r2" });
  s.fake.emitToolCall(b.id, { type: "tool_call", name: "Skill", input: { skill: "gsd-plan" } });
  const whole = JSON.parse((await s.ph(["result", "--json", "r2"])).out[0]);
  assert.deepEqual(whole.skills, ["gsd-plan"]);
  assert.equal(whole.skillsWarning, null);
});
