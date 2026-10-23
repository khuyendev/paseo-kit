// O64 (kit feedback 64) on the O65/O67 streams flow and the O66A graph schedule: each plan's review stream records its own
// findings (part <plan>), the checker join and the dependency checks record theirs, and the graph schedule records its halts,
// red checks and suites and fix calls per plan and commit batch. Measurement only: with gsd.review_metrics off the same runs
// take the same steps.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { makeWorld, PHASE_DIR as PD, planText, plannerResponder } from "../gsd-flows/world.mjs";

const RUN = "wf_20261020-120000_ab12";
const NODE = process.execPath;
const ROWS = [{ id: "01-01", wave: 1 }, { id: "01-02", wave: 2, depends: ["01-01"] }];
const planPath = (id) => `${PD}/${id}-PLAN.md`;
const ids = (p) => [...p.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
const labels = (r) => r.calls.map((c) => c.opts.label);
const streams = (gsd = {}) => makeWorld({ overlay: { gsd: { plan_flow: "streams", ...gsd } } });
const plan = (w, args, overrides) => runScript("gsd-plan", { root: w.root, gsd: w.gsd, args: { phaseDir: PD, ...args }, agent: plannerResponder(w, { rows: ROWS, overrides }) });
const files = (w) => (fs.existsSync(path.join(w.root, PD, "prereview")) ? fs.readdirSync(path.join(w.root, PD, "prereview")).sort() : []);
const record = (w, name) => JSON.parse(w.read(`${PD}/prereview/${name}.json`));
const fates = (rec) => Object.fromEntries(rec.findings.map((f) => [f.id, [f.plan, f.severity, f.fate, f.confirmed]]));

// Both streams find one medium note; 01-01's also a high issue its editor fixes and its resolution check confirms. The
// checker of the frozen set raises a blocker on 01-02 (resolved by its route's recheck) and a warning.
function scenario(w) {
  const edited = new Set();
  return {
    "find-": (p, o) => {
      const id = /find-(\d+-\d+)-/.exec(o.label)[1];
      return { issues: [{ severity: "medium", description: `note ${id}` }, ...(id === "01-01" && !edited.has(id) ? [{ severity: "high", description: "cites a missing symbol" }] : [])] };
    },
    "verify-": (p) => ({ verdicts: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, valid: true })) }),
    "judge-": (p) => ({ decisions: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, keep: true })) }),
    "editor-01-01": () => { w.write(planPath("01-01"), `${planText("01-01")}<!-- revised -->\n`); edited.add("01-01"); return { marker: "REVISION COMPLETE" }; },
    "resolve-01-01": (p) => ({ resolved: ids(p).filter((x) => x.startsWith("C")).map((id) => ({ id, evidence: "fixed" })) }),
    "checker-": () => ({ issues: [
      { plan: "01-02", dimension: "key_links", severity: "blocker", required_property: "links 01-01", description: "no key link" },
      { plan: "01-01", dimension: "scope", severity: "warning", required_property: "files", description: "many files" },
    ] }),
    "recheck-": (p) => ({ resolved: ids(p).filter((x) => x.startsWith("K")).map((id) => ({ id, evidence: "linked" })) }),
  };
}

test("O64 streams: each plan's review stream and the checker join record their findings and fates", async () => {
  const w = streams();
  const r = await plan(w, { planReview: true }, scenario(w));
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  assert.deepEqual(files(w), [`checker-${RUN}.json`, `plan-${RUN}-01-01.json`, `plan-${RUN}-01-02.json`, `skeleton-${RUN}.json`]);
  const s1 = record(w, `plan-${RUN}-01-01`);
  assert.deepEqual([s1.stage, s1.part], ["plan", "01-01"]);
  // The high issue is applied once the stream's resolution check confirms the edit; the medium note is carried.
  assert.deepEqual(fates(s1), { "C1-1-1": ["01-01", "medium", "carried", false], "C1-1-2": ["01-01", "high", "applied", true] });
  assert.deepEqual(fates(record(w, `plan-${RUN}-01-02`)), { "C1-1-1": ["01-02", "medium", "carried", false] });
  // The join's checker: the routed blocker is applied when the route's recheck confirms it; the warning is carried.
  const ck = record(w, `checker-${RUN}`);
  assert.deepEqual(ck.findings.map((f) => [f.plan, f.class, f.severity, f.fate, f.confirmed]), [["01-02", "key_links", "blocker", "applied", true], ["01-01", "scope", "warning", "carried", false]]);
  // The ledger never reaches a prompt: the route's revision and recheck see the checker's issue as it wrote it.
  assert.doesNotMatch(r.calls.find((c) => c.opts.label === "recheck-01-02-1").prompt, /"fate"|"lens"/);
});

test("O64 streams: review_metrics changes no decision; off, the same streams run the same agents and write no record", async () => {
  const on = streams();
  const off = streams({ review_metrics: false });
  const a = await plan(on, { planReview: true }, scenario(on));
  const b = await plan(off, { planReview: true }, scenario(off));
  assert.deepEqual([b.result.status, b.result.streams], [a.result.status, a.result.streams]);
  assert.deepEqual(labels(b).sort(), labels(a).sort());
  assert.deepEqual(b.calls.map((c) => c.prompt).sort(), a.calls.map((c) => c.prompt).sort());
  assert.deepEqual(files(off), []);
});

// O67: a checker revision changes 01-01's signature; 01-02 depends on it and is revised by its dependent stream.
const provider = (w, sig) => w.write(planPath("01-01"), `${planText("01-01")}<interfaces>\nprovides ${sig}\n</interfaces>\n`);
const consumer = (w, sig) => w.write(planPath("01-02"), `${planText("01-02", { wave: 2, depends: ["01-01"] })}<interfaces>\ncalls ${sig}\n</interfaces>\n`);
const dependents = (w, overrides = {}) => ({
  "plan-01-01": () => { provider(w, "connect(host)"); return { marker: "## PLANNING COMPLETE" }; },
  "plan-01-02": () => { consumer(w, "connect(host)"); return { marker: "## PLANNING COMPLETE" }; },
  "checker-": () => ({ issues: [{ plan: "01-01", dimension: "api", severity: "blocker", required_property: "connect takes a timeout", description: "no timeout" }] }),
  "revise-01-01": () => { provider(w, "connect(host, timeout)"); return { marker: "## REVISION COMPLETE" }; },
  "recheck-": (p) => ({ resolved: ids(p).filter((x) => x.startsWith("K")).map((id) => ({ id, evidence: "has a timeout" })) }),
  "depcheck-01-02": () => ({ issues: w.read(planPath("01-02")).includes("connect(host, timeout)") ? [] : [{ plan: "01-02", dimension: "deps", severity: "blocker", required_property: "calls 01-01 as declared", description: "old call" }] }),
  "deprevise-01-02": () => { consumer(w, "connect(host, timeout)"); return { marker: "## REVISION COMPLETE" }; },
  ...overrides,
});

test("O64 streams: the dependency checks record their blockers as their own checker part: applied, open when stuck, conflict", async () => {
  const w = streams();
  const r = await plan(w, { planReview: false }, dependents(w));
  assert.equal(r.result.status, "planned", JSON.stringify(r.result));
  const dep = record(w, `checker-${RUN}-dependents`);
  assert.equal(dep.part, "dependents");
  // Raised in round 1, gone in round 2 after the dependent's revision.
  assert.deepEqual(dep.findings.map((f) => [f.id, f.plan, f.class, f.fate, f.confirmed]), [["D1", "01-02", "deps", "applied", true]]);
  assert.deepEqual(fates(record(w, `checker-${RUN}`)), { K1: ["01-01", "blocker", "applied", true] });

  const stuck = streams();
  const s = await plan(stuck, { planReview: false }, dependents(stuck, { "deprevise-01-02": () => ({ marker: "## REVISION COMPLETE" }) }));
  assert.deepEqual([s.result.status, s.result.stage], ["needs-owner", "Dependents"]);
  assert.deepEqual(fates(record(stuck, `checker-${RUN}-dependents`)), { D1: ["01-02", "blocker", "open", false] });

  const c = streams();
  const cr = await plan(c, { planReview: false }, dependents(c, { "deprevise-01-02": () => ({ marker: "REVISION_CONFLICT", conflict: { issue: "old call", decision: "D-01" } }) }));
  assert.equal(cr.result.marker, "REVISION_CONFLICT");
  assert.deepEqual(fates(record(c, `checker-${RUN}-dependents`)), { D1: ["01-02", "blocker", "conflict", false] });
});

// The suite fails while fail.flag exists and names the file written in it.
const FLAG_TEST = [NODE, "-e", "const fs=require('fs');if(fs.existsSync('fail.flag')){console.log('error '+fs.readFileSync('fail.flag','utf8').trim());process.exit(1)}"];
const flagCommands = { build: [NODE, "-e", "process.exit(0)"], test: FLAG_TEST, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };

test("O64 graph schedule: halts, the red suite of a commit batch and its fix calls are recorded per plan with their cause", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { execute_schedule: "graph" }, adapter: { commands: flagCommands } } });
  const run = executor(w);
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w, {
    "exec-01-01": async (...x) => { await run(...x); w.write("fail.flag", "src/01-01/impl.js"); return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] }; },
    "exec-01-02": async (...x) => ({ ...(await run(...x)), taskResults: [{ task: "1", status: "partial" }], deviations: [{ rule: 4, note: "Api.load does not exist" }], plan_defects: [{ kind: "wrong-api", evidence: "Api.load" }] }),
    "fix-01-01": () => { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { taskResults: [], plan_defects: [{ kind: "missing-dependency", evidence: "pkg" }] }; },
  }) });
  assert.equal(r.result.schedule, "graph", JSON.stringify(r.result));
  assert.deepEqual(r.result.committed, ["01-01"], JSON.stringify(r.result));
  const ev = record(w, `execute-${RUN}`).events;
  const halt = ev.find((e) => e.kind === "halt");
  assert.deepEqual([halt.plan, halt.cause, halt.defects.map((d) => d.kind)], ["01-02", "plan", ["wrong-api"]]);
  const fix = ev.find((e) => e.kind === "fix-round");
  assert.deepEqual([fix.wave, fix.plan, fix.cause, fix.defects.map((d) => d.kind)], ["join", "01-01", "plan", ["missing-dependency"]]);
  const red = ev.find((e) => e.kind === "gate-failure");
  assert.deepEqual([red.wave, red.plans, red.cause], ["join", ["01-01"], "plan"]);
  assert.match(red.label, /the suite before the commit of 01-01/);
});

test("O64 review-stats attributes the streams flow's calls: a stream's resolution check to plan review, the dependency checks to the checker", async () => {
  const { stageOf } = await import("../../ship/.agents/harness/workflow/review-stages.mjs");
  assert.equal(stageOf("gsd-plan", { label: "resolve-01-01-1", phase: "Resolve", role: "plan_verifier" }), "plan");
  assert.equal(stageOf("gsd-plan", { label: "recheck-01-02-1", phase: "Checker", role: "checker" }), "checker");
  assert.equal(stageOf("gsd-plan", { label: "depcheck-01-02-1", phase: "Plans", role: "checker" }), "checker");
  assert.equal(stageOf("gsd-plan", { label: "deprevise-01-02-1", phase: "Plans", role: "planner" }), "checker");
  assert.equal(stageOf("gsd-plan", { label: "plan-01-01", phase: "Plans", role: "planner" }), null);
});
