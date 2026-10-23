// G106: gsd-quick takes the code-root writer lease like gsd-execute and gsd-debug (a plan holds only its phase lease).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { lock, lockCheck, unlock } from "../../ship/.agents/workflows/lib/flow-files.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, planText } from "../gsd-flows/world.mjs";

const quickWorld = () => makeWorld({ files: { ".planning/ROADMAP.md": "# R\n" } });
const quickAgent = (w, onExec = () => {}) => (p, o) => {
  const plan = /Write ONE plan (\S+)/.exec(p)?.[1];
  if (plan) { w.write(plan, planText("q")); return { marker: "PLANNING COMPLETE" }; }
  if (o.label === "quick-exec") { onExec(); w.write(/SUMMARY to exactly: (\S+)/.exec(p)[1], "done\n"); return { taskResults: [{ task: "1", status: "implemented" }] }; }
  return null;
};

test("G106 gsd-quick refuses while a debug run holds the code-root lease, before it creates a quick directory", async () => {
  const w = quickWorld();
  const held = lock(w.root, "debug", "wf_debug_A", process.pid, "gsd-debug");
  assert.equal(held.locked, true);
  try {
    const r = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix a" }, runId: "wf_quick_B", agent: quickAgent(w) });
    assert.equal(r.result.status, "refused");
    assert.equal(r.calls.length, 0);
    assert.match(r.result.reason, /wf_debug_A/);
    assert.equal(fs.existsSync(path.join(w.root, ".planning/quick")), false);
  } finally { unlock(w.root, "debug", held.token); }
});

test("G106 gsd-quick holds the code-root lease while its executor writes, under its own run id", async () => {
  const w = quickWorld();
  const seen = [];
  const r = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix a" }, runId: "wf_quick_B", agent: quickAgent(w, () => seen.push(lockCheck(w.root, "debug"))) });
  assert.equal(r.result.status, "done");
  assert.deepEqual(seen.map((s) => [s.held, s.holder, s.holderKind]), [[true, "wf_quick_B", "gsd-quick"]]);
  assert.equal(lockCheck(w.root, "debug").held, false);
});

test("G106 gsd-quick releases the code-root lease when its run fails", async () => {
  const w = quickWorld();
  const agent = quickAgent(w);
  const r = await runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "fix a" }, runId: "wf_quick_B", agent: (p, o) => (o.label === "quick-exec" ? NULL("quota exhausted") : agent(p, o)) });
  assert.equal(r.result.status, "failed");
  assert.equal(lockCheck(w.root, "debug").held, false);
});
