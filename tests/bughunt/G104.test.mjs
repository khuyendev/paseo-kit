// Bug-hunt fix G104: gsd-quick --full stops at discuss when its CONTEXT file is missing, before any agent is paid for.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, planText } from "../gsd-flows/world.mjs";

const CTX = ".planning/quick/owner-decisions.md";

function quickWorld() { return makeWorld({ files: { ".planning/ROADMAP.md": "# Roadmap\n" } }); }
function quickAgent(w) {
  return (prompt, opts) => {
    const plan = /Write ONE plan (\S+)/.exec(prompt)?.[1];
    if (plan) { w.write(plan, planText("01-01")); return { marker: "PLANNING COMPLETE" }; }
    if (opts.label === "quick-research") return "researched";
    if (opts.label.startsWith("quick-check")) return { issues: [] };
    if (opts.label === "quick-exec") { w.write(/SUMMARY to exactly: (\S+)/.exec(prompt)[1], "done\n"); return { taskResults: [] }; }
    return { status: "passed" };
  };
}
const quick = (w, args) => runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { description: "bigger", full: true, ...args }, agent: quickAgent(w) });

test("G104 quick --full without a CONTEXT file stops at discuss before the quick directory or any agent", async () => {
  const none = quickWorld();
  const noPath = await quick(none, {});
  assert.deepEqual([noPath.result.status, noPath.result.stage, noPath.calls.length], ["needs-owner", "Discuss", 0]);
  assert.match(noPath.result.reason, /gsd-discuss/);
  assert.equal(fs.existsSync(path.join(none.root, ".planning/quick")), false);
  const missing = quickWorld();
  const gone = await quick(missing, { contextPath: CTX });
  assert.deepEqual([gone.result.status, gone.result.stage, gone.calls.length], ["needs-owner", "Discuss", 0]);
  assert.equal(fs.existsSync(path.join(missing.root, ".planning/quick")), false);
});

test("G104 quick --full with its CONTEXT file runs research on the owner decisions", async () => {
  const w = quickWorld();
  w.write(CTX, "<decisions>\n- **D-01:** keep it small\n</decisions>\n");
  const r = await quick(w, { contextPath: CTX });
  assert.equal(r.calls[0].opts.label, "quick-research");
  assert.ok(r.calls[0].prompt.includes(`Owner decisions: ${CTX} (locked).`));
});
