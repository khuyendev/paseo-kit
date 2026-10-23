// Bug-hunt fix G018: plan-checker issues must carry required_property (the binding invariant) under the schema the
// agent is held to, and the checker prompt asks for it. The quick checker and the skeleton lanes share the contract.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder, planText } from "../gsd-flows/world.mjs";

const { parseReply } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/workflow/schema.mjs")).href);
const plan = (w, args = {}, overrides = {}) => runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: plannerResponder(w, { overrides }) });
const bare = { issues: [{ plan: "01-01", severity: "blocker", description: "Task 1 has no runnable verification" }] };
const bound = { issues: [{ plan: "01-01", dimension: "task_completeness", severity: "blocker", required_property: "every auto task has a <verify> separating pass from fail", description: "Task 1 has no runnable verification" }] };

test("G018 plan checker: the prompt asks for required_property and an issue without it fails the reply schema", async () => {
  const r = await plan(makeWorld(), { maxCheckIterations: 1 }, { "checker-": () => bare });
  const checker = r.calls.find((c) => c.opts.label === "checker-1");
  assert.match(checker.prompt, /required_property/);
  assert.ok(parseReply(JSON.stringify(bare), checker.opts.schema).errors.some((e) => /required_property/.test(e)));
  assert.deepEqual(parseReply(JSON.stringify(bound), checker.opts.schema).errors, []);
});

test("G018 skeleton lanes share the issue contract: a lane issue without required_property fails its schema too", async () => {
  const r = await plan(makeWorld());
  const lane = r.calls.find((c) => c.opts.label === "skeleton-L1");
  assert.ok(parseReply(JSON.stringify({ issues: [{ severity: "blocker", description: "x" }] }), lane.opts.schema).errors.some((e) => /required_property/.test(e)));
});

test("G018 quick checker: the same contract, its prompt asks for required_property", async () => {
  const w = makeWorld({ files: { ".planning/ROADMAP.md": "# R\n" } });
  const r = await runScript("gsd-quick", {
    root: w.root,
    gsd: w.gsd,
    args: { description: "fix a | b", full: true },
    agent: (p, o) => {
      const planPath = /Write ONE plan (\S+)/.exec(p)?.[1];
      if (planPath) { w.write(planPath, planText("q")); return { marker: "PLANNING COMPLETE" }; }
      if (o.label === "quick-research") { w.write(/write (\S+RESEARCH\.md)/.exec(p)[1], "research\n"); return "researched"; }
      if (o.label.startsWith("quick-check")) return { issues: [{ severity: "blocker", description: "x" }] };
      return { marker: "REVISION COMPLETE" };
    },
  });
  const check = r.calls.find((c) => c.opts.label === "quick-check-1");
  assert.match(check.prompt, /required_property/);
  assert.ok(parseReply(JSON.stringify({ issues: [{ severity: "blocker", description: "x" }] }), check.opts.schema).errors.some((e) => /required_property/.test(e)));
  assert.deepEqual(parseReply(JSON.stringify({ issues: [{ severity: "blocker", required_property: "the plan has a verify", description: "x" }] }), check.opts.schema).errors, []);
});
