// Bug-hunt fix G108: a quick run never writes over the plan, research or summary already in its directory, and a stop
// keeps the task results that finished.
import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, planText } from "../gsd-flows/world.mjs";

const Q = ".planning/quick/261023-001-fix";
const ID = "261023-001";
const PLAN = `${Q}/${ID}-PLAN.md`;
const RESEARCH = `${Q}/${ID}-RESEARCH.md`;
const SUMMARY = `${Q}/${ID}-SUMMARY.md`;

const quickWorld = (files = {}) => makeWorld({ files: { ".planning/ROADMAP.md": "# Roadmap\n", ...files } });
// The planner, researcher and executor write their files as the real agents do.
function writer(w, exec = { taskResults: [{ task: "1", status: "implemented" }] }) {
  return (p, o) => {
    if (o.label === "quick-plan") { w.write(PLAN, planText("01-01")); return { marker: "PLANNING COMPLETE" }; }
    if (o.label === "quick-research") { w.write(RESEARCH, "research\n"); return "researched"; }
    if (o.label === "quick-exec") { w.write(SUMMARY, "summary\n"); return exec; }
    return { issues: [] };
  };
}

test("G108 quick: a directory that already holds the plan or research stops before any agent runs and keeps the file", async () => {
  for (const [file, full] of [[PLAN, false], [RESEARCH, true]]) {
    const w = quickWorld({ [file]: "owner edited\n" });
    const r = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix", dir: Q, full }, agent: writer(w) });
    assert.equal(r.result.status, "needs-owner", file);
    assert.ok(r.result.reason.includes(file), r.result.reason);
    assert.equal(r.calls.length, 0, file);
    assert.equal(w.read(file), "owner edited\n", file);
  }
});

test("G108 quick: a new task directory runs as before", async () => {
  const w = quickWorld();
  const r = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix", dir: Q }, agent: writer(w) });
  assert.equal(r.result.status, "done", JSON.stringify(r.result));
  assert.equal(w.read(PLAN), planText("01-01"));
});

test("G108 quick: a stop on a blocked task returns the task results and the summary", async () => {
  const taskResults = [{ task: "1", status: "implemented", evidence: "edited a.js" }, { task: "2", status: "partial", evidence: "Rule 4: schema" }];
  const w = quickWorld();
  const r = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix", dir: Q }, agent: writer(w, { taskResults }) });
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Execute");
  assert.deepEqual(r.result.taskResults, taskResults);
  assert.equal(r.result.summary, SUMMARY);
});
