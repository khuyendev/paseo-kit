// G102: a quick --full research pass that returns nothing, or writes no new report, stops for the owner before any plan;
// an owner's skip with a reason is carried in the result and the report is not committed.
import assert from "node:assert/strict";
import test from "node:test";
import { quickVerification } from "../../ship/.agents/workflows/lib/flow-project.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld, planText } from "../gsd-flows/world.mjs";

const Q = ".planning/quick/261020-001-fix";
const ID = "261020-001";
const RESEARCH = `${Q}/${ID}-RESEARCH.md`;
const quickWorld = (files = {}) => makeWorld({ files: { ".planning/ROADMAP.md": "# Roadmap\n", ...files }, overlay: { gsd: { commit_policy: { docs: true, code: "per-wave" } } } });
const writeResearch = (w) => { w.write(RESEARCH, "report\n"); return "researched"; };
function quickAgent(w, research) {
  return (_prompt, opts) => {
    if (opts.label === "quick-research") return research(w);
    if (opts.label === "quick-plan") { w.write(`${Q}/${ID}-PLAN.md`, planText("01-01")); return { marker: "PLANNING COMPLETE" }; }
    if (opts.label.startsWith("quick-check")) return { issues: [] };
    if (opts.label === "quick-exec") { w.write(`${Q}/${ID}-SUMMARY.md`, "summary\n"); return { taskResults: [] }; }
    if (opts.label === "quick-verify") {
      const fp = quickVerification(w.root, Q, "fingerprint");
      w.write(`${Q}/${ID}-VERIFICATION.md`, `---\nstatus: passed\ncovered_files: ${JSON.stringify(fp.covered_files)}\ncovered_digest: ${fp.covered_digest}\ngaps: []\nhuman_verification: []\n---\nreport\n`);
      return { status: "passed" };
    }
    return { status: "passed" };
  };
}
const quick = (w, args, research) => runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { dir: Q, description: "fix", ...args }, agent: quickAgent(w, research) });
const labels = (r) => r.calls.map((c) => c.opts.label);

test("G102 quick --full stops for the owner when research returns nothing, before any plan is written", async () => {
  const w = quickWorld();
  const r = await quick(w, { full: true }, () => NULL("timed out"));
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Plan");
  assert.match(r.result.reason, /research returned nothing \(timed out\)/);
  assert.equal(r.result.dir, Q);
  assert.deepEqual(labels(r), ["quick-research"]);
});

test("G102 quick --full stops for the owner when research returns a result but writes no report", async () => {
  const r = await quick(quickWorld(), { full: true }, () => "researched");
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /research wrote no new \.planning\/quick\/261020-001-fix\/261020-001-RESEARCH\.md/);
  assert.deepEqual(labels(r), ["quick-research"]);
});

// G108 stops a run whose directory already holds the research before any agent runs, so an old report never reaches the check.
test("G102 a RESEARCH.md left by an earlier run does not pass for this research pass", async () => {
  const r = await quick(quickWorld({ [RESEARCH]: "old report\n" }), { full: true }, () => "researched");
  assert.equal(r.result.status, "needs-owner");
  assert.match(r.result.reason, /already exists/);
  assert.deepEqual(labels(r), []);
});

test("G102 quick --full continues when research writes its report", async () => {
  const w = quickWorld();
  const r = await quick(w, { full: true }, writeResearch);
  assert.equal(r.result.status, "done", JSON.stringify(r.result));
  assert.equal(r.result.researchSkipped, undefined);
  assert.ok(w.events.some((e) => e.startsWith("commit ") && e.includes(RESEARCH)));
});

test("G102 quick --full skips research only when the owner gives skipResearch with a reason, and carries it in the result", async () => {
  const none = quickWorld();
  const bare = await quick(none, { full: true, skipResearch: true }, writeResearch);
  assert.equal(bare.result.status, "needs-owner");
  assert.equal(bare.result.stage, "Plan");
  assert.match(bare.result.reason, /skipResearch needs a non-empty researchSkipReason/);
  assert.deepEqual(labels(bare), []);

  const w = quickWorld();
  const r = await quick(w, { full: true, skipResearch: true, researchSkipReason: "the task is a one-line rename" }, writeResearch);
  assert.equal(r.result.status, "done", JSON.stringify(r.result));
  assert.equal(r.result.researchSkipped, "the task is a one-line rename");
  assert.equal(labels(r).includes("quick-research"), false);
  assert.ok(w.events.some((e) => e.startsWith("commit ") && !e.includes(RESEARCH)));
});
