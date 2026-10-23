// Bug-hunt fix G107 (quick verification): a needs-owner stop at Verify carries the gaps and human checks the report
// lists, and the fingerprint covers the implementation files the plan owns, so a passed report goes stale when they change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { quickVerification } from "../../ship/.agents/workflows/lib/flow-project.mjs";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const Q = ".planning/quick/261020-001-fix";
const ID = "261020-001";
const PLAN = `${Q}/${ID}-PLAN.md`;
const SUMMARY = `${Q}/${ID}-SUMMARY.md`;
const VERIFY = `${Q}/${ID}-VERIFICATION.md`;
const RESEARCH = `${Q}/${ID}-RESEARCH.md`;
const CONTEXT = `${Q}/${ID}-CONTEXT.md`;

function quickWorld() {
  return makeWorld({ files: { ".planning/ROADMAP.md": "# Roadmap\n", [CONTEXT]: "<decisions>\n- **D-01:** keep it small\n</decisions>\n", "src/impl.js": "export const v = 1;\n", "src/other.js": "export const o = 1;\n" } });
}

// The quick plan owns the implementation files and the SUMMARY, as the planner writes it.
function planText(owns) {
  return `---\nphase: 1\nplan: 01-01\nowns: ${JSON.stringify(owns)}\n---\n<tasks><task><name>t</name><automated>cmd: node -v</automated></task></tasks>\n`;
}

// The executor changes src/impl.js; the verifier writes the report with the fingerprint fields of the flow.
function quickAgent(w, { owns = ["Path:src/impl.js"], verdict = "passed", gaps = [], human = [] } = {}) {
  return (_prompt, opts) => {
    if (opts.label === "quick-research") { w.write(RESEARCH, "research\n"); return "researched"; }
    if (opts.label === "quick-plan") { w.write(PLAN, planText(owns)); return { marker: "PLANNING COMPLETE" }; }
    if (opts.label.startsWith("quick-check")) return { issues: [] };
    if (opts.label === "quick-exec") {
      w.write("src/impl.js", "export const v = 2;\n");
      w.write(SUMMARY, "summary\n");
      return { taskResults: [{ task: "1", status: "implemented" }] };
    }
    if (opts.label === "quick-verify") {
      const fp = quickVerification(w.root, Q, "fingerprint");
      w.write(VERIFY, `---\nstatus: ${verdict}\ncovered_files: ${JSON.stringify(fp.covered_files)}\ncovered_digest: ${fp.covered_digest}\ngaps: ${JSON.stringify(gaps)}\nhuman_verification: ${JSON.stringify(human)}\n---\nreport\n`);
      return { status: verdict };
    }
    return NULL("unexpected label");
  };
}
const quick = (w, agent) => runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { full: true, dir: Q, description: "fix", contextPath: CONTEXT }, agent });

test("G107 a gaps_found quick verification stops at Verify with its gaps", async () => {
  const w = quickWorld();
  const r = await quick(w, quickAgent(w, { verdict: "gaps_found", gaps: ["tests-missing-for-v2"] }));
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Verify");
  assert.equal(r.result.verification, VERIFY);
  assert.deepEqual(r.result.gaps, ["tests-missing-for-v2"]);
});

test("G107 a human_needed quick verification stops at Verify with its human checks", async () => {
  const w = quickWorld();
  const r = await quick(w, quickAgent(w, { verdict: "human_needed", human: ["click-through-settings"] }));
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Verify");
  assert.deepEqual(r.result.human_verification, ["click-through-settings"]);
});

test("G107 a passed quick report goes stale when an owned implementation file changes or is deleted", async () => {
  const w = quickWorld();
  const r = await quick(w, quickAgent(w));
  assert.equal(r.result.status, "done", JSON.stringify(r.result));
  assert.ok(quickVerification(w.root, Q, "fingerprint").covered_files.includes("src/impl.js"));
  assert.equal(quickVerification(w.root, Q, "status").stale, false);
  w.write("src/impl.js", "export const v = 3;\n");
  assert.equal(quickVerification(w.root, Q, "status").stale, true);
  w.write("src/impl.js", "export const v = 2;\n");
  assert.equal(quickVerification(w.root, Q, "status").stale, false);
  fs.rmSync(path.join(w.root, "src/impl.js"));
  assert.equal(quickVerification(w.root, Q, "status").stale, true);
});

test("G107 an owned directory is fingerprinted as the files under it and does not fail the run", async () => {
  const w = quickWorld();
  const r = await quick(w, quickAgent(w, { owns: ["Path:src/"] }));
  assert.equal(r.result.status, "done", JSON.stringify(r.result));
  const { covered_files: files } = quickVerification(w.root, Q, "fingerprint");
  assert.ok(files.includes("src/impl.js") && files.includes("src/other.js"), JSON.stringify(files));
  w.write("src/other.js", "export const o = 2;\n");
  assert.equal(quickVerification(w.root, Q, "status").stale, true);
});
