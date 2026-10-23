import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { loadJournalCache } from "../../ship/.agents/harness/workflow/journal.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { testEnv } from "../helpers/env.mjs";
import { fakeHost } from "../workflow/helpers.mjs";
import { gsd, plan, ROADMAP, REQUIREMENTS } from "../gsd-core/fixture.mjs";
import { NULL, runScript } from "./host.mjs";
import { makeWorld, PHASE_DIR as PD, planText } from "./world.mjs";
import { quickVerification } from "../../ship/.agents/workflows/lib/flow-project.mjs";

function installed(files, overlay = {}) {
  const p = makeTempProject({ runtime: true, files: { ".gitignore": "_workspace/\n.claude/worktrees/\n", ".planning/ROADMAP.md": ROADMAP, ".planning/REQUIREMENTS.md": REQUIREMENTS, ...files }, overlay });
  fs.cpSync(path.join(SHIP_DIR, ".agents/workflows"), p.path(".agents/workflows"), { recursive: true });
  p.git("add", "-A"); p.git("commit", "-qm", "runtime inputs");
  return p;
}
const run = (p, name, args, host, journalPath, cache) => runWorkflow({
  source: fs.readFileSync(p.path(`.agents/workflows/${name}.js`), "utf8"), scriptPath: p.path(`.agents/workflows/${name}.js`),
  args, runId: "wf_engine", root: p.root, env: testEnv({ PASEO_HARNESS_ROOT: p.root }),
  limits: { maxConcurrent: 2, maxAgents: 100, budgetTotal: null, shellTimeoutS: 30 }, host, journalPath, cache, out() {},
});

test("GSDF-18 CR-GSF-04 real engine preserves a worktree executor session through an attributed repair", async () => {
  const commands = { build: [process.execPath, "-e", "process.exit(0)"], test: [process.execPath, "-e", "if(!require('fs').readFileSync('src/a.js','utf8').includes('fixed')){console.log('error src/a.js');process.exit(1)}"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
  const p = installed({ [`${PD}/01-01-PLAN.md`]: plan(), "src/a.js": "// old\n" }, { adapter: { commands } });
  assert.equal((await gsd(p, ["state", "init"])).code, 0);
  assert.equal((await gsd(p, ["handoff", "1"])).code, 0);
  let wt;
  const host = fakeHost({ runner: async (s) => {
    if (s.opts.role === "executor") {
      if (!wt) {
        wt = p.path(".claude/worktrees/executor");
        p.git("worktree", "add", "-q", "-b", "harness/executor", wt);
      }
      fs.mkdirSync(path.join(wt, PD), { recursive: true });
      fs.writeFileSync(path.join(wt, "src/a.js"), s.label.startsWith("fix-") ? "// fixed\n" : "// broken\n", "utf8");
      fs.writeFileSync(path.join(wt, PD, "01-01-SUMMARY.md"), "---\nkey-files:\n  modified: [src/a.js]\n---\ndone\n", "utf8");
      return { status: "ok", result: { taskResults: [{ task: "1", status: "implemented" }] }, worktree: { path: wt }, agentId: "executor", tokens: 0 };
    }
    return { status: "ok", result: { findings: [] }, agentId: "reviewer", tokens: 0 };
  } });
  const r = await run(p, "gsd-execute", { phaseDir: PD }, host);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const executors = host.calls.runner.filter((s) => s.opts.role === "executor");
  assert.equal(executors.length, 2);
  assert.ok(executors.every((s) => s.opts.isolation === "worktree" && s.opts.session === "executor:01-01"));
  assert.equal(p.git("show", "HEAD:src/a.js"), "// fixed");
});

test("GSDF-03 CR-GSF-19 real engine cache misses after a reviewed PLAN or source edit", async () => {
  const p = installed({ [`${PD}/01-01-PLAN.md`]: plan(), "src/a.js": "original\n" });
  const journal = p.path("_workspace/custom-runs/review/journal.jsonl");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const makeHost = () => fakeHost({ runner: async () => ({ status: "ok", result: { issues: [] }, tokens: 0, agentId: "finder" }) });
  const firstHost = makeHost();
  assert.equal((await run(p, "gsd-plan-review", { phaseDir: PD, plans: ["01-01"] }, firstHost, journal)).result.status, "converged");
  assert.equal(firstHost.calls.runner.length, 1);
  const unchanged = makeHost();
  await run(p, "gsd-plan-review", { phaseDir: PD, plans: ["01-01"] }, unchanged, journal, loadJournalCache(journal));
  assert.equal(unchanged.calls.runner.length, 0);
  for (const file of [`${PD}/01-01-PLAN.md`, "src/a.js"]) {
    p.write(file, p.read(file) + "\nchanged\n");
    const edited = makeHost();
    await run(p, "gsd-plan-review", { phaseDir: PD, plans: ["01-01"] }, edited, journal, loadJournalCache(journal));
    assert.equal(edited.calls.runner.length, 1, file);
    assert.match(edited.calls.runner[0].prompt, /<research_input_policy>/);
    assert.match(edited.calls.runner[0].prompt, /Input digest \(stage\): [a-f0-9]{64}$/);
  }
});

const Q = ".planning/quick/261020-001-fix";
const ID = "261020-001";
const CONTEXT = `${Q}/${ID}-CONTEXT.md`;
function quickWorld() { return makeWorld({ files: { ".planning/ROADMAP.md": "# Roadmap\n", [CONTEXT]: "<decisions>\n- **D-01:** keep it small\n</decisions>\n" } }); }
function quickAgent(w, override) {
  return (prompt, opts) => {
    const v = override?.(prompt, opts);
    if (v !== undefined) return v;
    if (opts.label === "quick-research") { w.write(`${Q}/${ID}-RESEARCH.md`, "research\n"); return "researched"; }
    if (opts.label === "quick-plan") { w.write(`${Q}/${ID}-PLAN.md`, planText("01-01")); return { marker: "PLANNING COMPLETE" }; }
    if (opts.label.startsWith("quick-check")) return { issues: [] };
    if (opts.label === "quick-exec") { w.write(`${Q}/${ID}-SUMMARY.md`, "summary\n"); return { taskResults: [] }; }
    return { status: "passed" };
  };
}
const quick = (w, override) => runScript("gsd-quick", { root: w.root, gsd: w.gsd, args: { full: true, dir: Q, description: "fix", contextPath: CONTEXT }, agent: quickAgent(w, override) });

test("GSDF-61 CR-GSF-14 quick full rejects null checker, missing report and owner revision markers", async () => {
  const w = quickWorld();
  const nullCheck = await quick(w, (_p, o) => o.label.startsWith("quick-check") ? NULL("quota exhausted") : undefined);
  assert.equal(nullCheck.result.status, "failed");
  assert.equal(nullCheck.calls.filter((c) => c.opts.label.startsWith("quick-check")).length, 1);
  const missing = await quick(quickWorld());
  assert.equal(missing.result.status, "failed");
  assert.match(missing.result.reason, /wrote no new/);
  const owner = await quick(quickWorld(), (_p, o) => o.label.startsWith("quick-check") ? { issues: [{ severity: "blocker", description: "revise" }] } : o.label.startsWith("quick-revise") ? { marker: "REVISION_CONFLICT" } : undefined);
  assert.equal(owner.result.status, "needs-owner");
  assert.match(owner.result.reason, /REVISION_CONFLICT/);
});

for (const status of ["passed", "gaps_found", "human_needed", "invalid"]) test(`GSDF-61 CR-GSF-14 quick verification readback requires a valid ${status} report`, async () => {
  const w = quickWorld();
  const r = await quick(w, (_p, o) => {
    if (o.label !== "quick-verify") return;
    const fp = quickVerification(w.root, Q, "fingerprint");
    w.write(`${Q}/${ID}-VERIFICATION.md`, `---\nstatus: ${status === "invalid" ? "passed" : status}\ncovered_files: ${JSON.stringify(fp.covered_files)}\ncovered_digest: ${fp.covered_digest}\ngaps: ${status === "gaps_found" || status === "invalid" ? "[gap]" : "[]"}\nhuman_verification: ${status === "human_needed" ? "[check]" : "[]"}\n---\nreport\n`);
    return { status: "passed" };
  });
  assert.equal(r.result.status, status === "passed" ? "done" : status === "invalid" ? "failed" : "needs-owner", JSON.stringify(r.result));
});
