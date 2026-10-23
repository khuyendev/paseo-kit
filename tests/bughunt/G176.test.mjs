import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { run } from "../../kit/machine/index.mjs";
import { completeMachine, SECRETS } from "../machine/helpers.mjs";

const reloads = (m) => m.logOf("paseo").map((c) => c.args);

// Drops one model from the live config, then stops the apply right after the config write, as an abrupt exit would.
async function killedAfterWrite(m) {
  const live = m.readConfig();
  live.agents.providers.circle.models.pop();
  fs.writeFileSync(m.config, `${JSON.stringify(live, null, 2)}\n`, "utf8");
  const out = (line) => {
    if (line.startsWith("paseo: backup")) throw new Error("killed");
  };
  await assert.rejects(run(["apply"], { out, err: () => {}, env: { ...m.env, ...SECRETS }, kitDir: m.kitDir }), /killed/);
  assert.deepEqual(reloads(m), []);
}

test("G176 a rerun after a write killed before the reload reloads and check reports the pending change", async () => {
  const m = await completeMachine();
  await killedAfterWrite(m);
  const c = await m.run(["check"]);
  assert.equal(c.code, 2, c.stdout);
  assert.ok(c.out.some((l) => /^problem Paseo config change is not reloaded yet; run kit\.mjs machine apply$/.test(l)), c.stdout);
  const r = await m.run(["apply"], SECRETS);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes("paseo: configuration reloaded (paseo reload; no daemon restart)"), r.stdout);
  assert.deepEqual(reloads(m), [["reload"]]);
  assert.equal((await m.run(["check"])).code, 0);
});

test("G176 a rerun after a failed reload retries the reload until it succeeds", async () => {
  const m = await completeMachine();
  const live = m.readConfig();
  live.agents.providers.circle.models.pop();
  fs.writeFileSync(m.config, `${JSON.stringify(live, null, 2)}\n`, "utf8");
  const r = await m.run(["apply"], { ...SECRETS, FAKE_PASEO_EXIT: "1" });
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.out.includes("paseo reload failed (exit 1: daemon unreachable); run it yourself: paseo reload"), r.stdout);
  assert.equal((await m.run(["check"])).code, 2);
  const r2 = await m.run(["apply"], SECRETS);
  assert.equal(r2.code, 0, r2.stdout);
  assert.ok(r2.out.includes("paseo: configuration reloaded (paseo reload; no daemon restart)"), r2.stdout);
  assert.deepEqual(reloads(m), [["reload"], ["reload"]]);
  assert.equal((await m.run(["check"])).code, 0);
});

test("G176 --no-reload after a killed write is the owner's decision: the pending reload is dropped", async () => {
  const m = await completeMachine();
  await killedAfterWrite(m);
  const r = await m.run(["apply", "--no-reload"], SECRETS);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.out.includes("paseo: reload skipped (--no-reload); run paseo reload to load the change"), r.stdout);
  const r2 = await m.run(["apply"], SECRETS);
  assert.equal(r2.code, 0, r2.stdout);
  assert.equal(r2.out[0], "paseo: every template provider, model and policy entry is present");
  assert.deepEqual(reloads(m), []);
  assert.equal((await m.run(["check"])).code, 0);
});
