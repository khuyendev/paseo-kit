import { test } from "node:test";
import assert from "node:assert/strict";
import { meta, setup } from "../workflow/helpers.mjs";

const SCHEMA = { type: "object", properties: { x: { type: "integer" }, y: { type: "string" }, z: { type: "boolean" } }, required: ["x"] };
const sent = (fake) => fake.callsOf("sendAgentMessage").map((c) => c.args);

test("G141 a native schema retry (one-shot agent, no session) carries the schema text again", async () => {
  const s = setup({ responder: (a, text, { turn }) => [{ reply: turn === 1 ? '{"y":"a"}' : '{"x":1}', usage: { outputTokens: 1 } }] });
  s.project.write("wf.js", `${meta()}return await agent("give", { schema: ${JSON.stringify(SCHEMA)} });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_g141"]);
  assert.equal(r.code, 0, r.stderr);
  const msgs = sent(s.fake);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0][1], /\/x: missing required property/);
  assert.ok(msgs[0][1].includes(JSON.stringify(SCHEMA)), `retry should carry the schema: ${msgs[0][1]}`);
});

test("G141 a session schema retry also carries the schema text", async () => {
  const s = setup({ responder: (a, text, { turn }) => [{ reply: turn === 1 ? '{"y":"a"}' : '{"x":1}', usage: { outputTokens: 1 } }] });
  s.project.write("wf.js", `${meta()}return await agent("give", { session: "s", schema: ${JSON.stringify(SCHEMA)} });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_g141b"]);
  assert.equal(r.code, 0, r.stderr);
  const msgs = sent(s.fake);
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0][1].includes(JSON.stringify(SCHEMA)), `retry should carry the schema: ${msgs[0][1]}`);
});
