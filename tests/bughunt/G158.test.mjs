import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setup } from "../workflow/helpers.mjs";

function fixtureRun(s, id, journal) {
  const dir = path.join(s.project.path("_workspace/_runs"), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), `${JSON.stringify({ runId: id, status: "done", startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T10:01:40.000Z", name: "n" }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "journal.jsonl"), journal.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

// A gsd-quick-shaped run: labels are call names, the journal rows carry the role and the model each call ran on.
const usage = { input: 1, cachedInput: 0, output: 1, costUsd: 0.001 };
const QUICK = [
  { n: 1, status: "start" },
  { n: 1, label: "quick-research", agentType: "gsd-researcher", role: "research", model: "circle/m", agentId: "a1", status: "ok", duration_s: 10, tokens: 1, usage },
  { n: 2, label: "quick-plan", agentType: "gsd-planner", role: "planner", model: "circle/mid", agentId: "a2", status: "ok", duration_s: 12, tokens: 1, usage },
  { n: 3, label: "quick-check-1", agentType: "gsd-checker", role: "checker", model: "circle/m", agentId: "a3", status: "ok", duration_s: 8, tokens: 1, usage },
  { n: 4, label: "exec-03-01", agentType: "gsd-executor", role: "executor", model: "circle/mid", agentId: "a4", status: "ok", duration_s: 20, tokens: 1, usage },
  { n: 5, label: "exec-03-02", agentType: "gsd-executor", role: "executor", model: null, agentId: null, status: "null", reason: "identity error", duration_s: 0, tokens: 0, usage: null },
  { n: 6, label: "quick-research", agentType: "gsd-researcher", role: "research", model: "circle/m", agentId: "a0", status: "cached", duration_s: 0, tokens: 0 },
];

test("G158 run-stats lists each journal role with the model it ran on, not the call labels", async () => {
  const s = setup();
  fixtureRun(s, "wf_g", QUICK);
  const r = await s.ph(["run-stats", "wf_g"]);
  assert.equal(r.code, 0);
  assert.equal(r.out[0], "wf_g [research circle/m, planner circle/mid, checker circle/m, executor circle/mid, executor -] status done");
});

test("G158 run-stats falls back to the label role part for rows journaled without a role or agent type", async () => {
  const s = setup();
  fixtureRun(s, "wf_old", [
    { n: 1, label: "plan:a", agentId: "a1", status: "ok", duration_s: 10, tokens: 1, usage },
    { n: 2, label: "review:b", agentId: "a2", status: "null", reason: "x", duration_s: 5, tokens: 0, usage: null },
  ]);
  const r = await s.ph(["run-stats", "wf_old"]);
  assert.equal(r.out[0], "wf_old [plan -, review -] status done");
});
