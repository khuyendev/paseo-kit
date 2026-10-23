import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { CALLER, fakeHost, meta, setup, tick } from "../workflow/helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A run that never ends: its agent is created and still running, then the test abandons the run as a killed process ends.
async function killedRun() {
  const s = setup({ responder: () => [{ hang: true }] });
  s.project.write("wf.js", `${meta()}return await agent("write the report");`);
  s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_a"]);
  const journalA = s.project.path("_workspace/_runs/wf_a/journal.jsonl");
  const created = () => fs.existsSync(journalA) && readJournal(journalA).some((e) => e.status === "created");
  for (let i = 0; i < 100 && !created(); i++) await tick();
  const killed = [...s.fake.agents.keys()].find((id) => id !== CALLER);
  assert.ok(killed, "the first run created its agent");
  s.fake.setResponder(() => [{ reply: "ok", usage: { outputTokens: 1 } }]);
  return { s, killed };
}

test("G123 the agent id of a created call is journaled before the call finishes", async () => {
  const dir = makeTempDir();
  const journalPath = path.join(dir, "journal.jsonl");
  const host = fakeHost({ runner: (s) => (s.journalAgent("A1"), new Promise(() => {})) });
  runWorkflow({
    source: `${meta()}await agent("write the report");`, scriptPath: "wf.js", runId: "wf_test", root: process.cwd(), env: process.env,
    limits: { maxConcurrent: 20, maxAgents: 1000, budgetTotal: null, shellTimeoutS: 30 }, journalPath, out: () => {},
    resolveChild: () => { throw new Error("none"); }, host,
  });
  await sleep(30);
  assert.deepEqual(readJournal(journalPath).map((e) => [e.status, e.agentId ?? null]), [["start", null], ["created", "A1"]]);
});

test("G123 a resume stops the agent a killed run left running before it starts the call again", async () => {
  const { s, killed } = await killedRun();
  const r = await s.ph(["workflow", "--resume", "wf_a", "--run-id", "wf_b"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(s.fake.callsOf("archiveAgent").some((c) => c.args[0] === killed), "the killed run's agent is archived");
  assert.equal(s.fake.callsOf("createAgent").length, 2, "one agent per run, the replacement after the archive");
});

test("G123 a resume does not archive a killed run's agent that is already archived", async () => {
  const { s, killed } = await killedRun();
  s.fake.agents.get(killed).archivedAt = new Date(s.clock.now()).toISOString();
  const r = await s.ph(["workflow", "--resume", "wf_a", "--run-id", "wf_b"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(s.fake.callsOf("archiveAgent").filter((c) => c.args[0] === killed).length, 0);
  assert.equal(s.fake.callsOf("createAgent").length, 2);
});
