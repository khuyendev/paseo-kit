// Bug-hunt fix of group G139 (run results omit nested roles and report unresolved models as agent default): the run's
// effective role table comes from the engine's own calls, so every role of a run is listed with the model it resolved to.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld, PHASE_DIR, plannerResponder } from "../gsd-flows/world.mjs";
import { fakeHost, meta, setup } from "../workflow/helpers.mjs";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";

// A host that resolves a call the way the runner does: the call's own model, else the role's default.
const resolving = () => fakeHost({
  identify: ({ opts }) => (opts.agentType === "nope"
    ? { error: "agent type 'nope' not found: x" }
    : { roleHash: "", model: opts.model ?? (opts.role === "planner" ? "p/pro" : "p/standard"), effort: opts.effort ?? null, provider: "p" }),
});

function engine(body, { host = resolving(), journalPath } = {}) {
  return runWorkflow({
    source: `${meta("t")}${body}`, scriptPath: "C:/p/wf.js", args: undefined, runId: "wf_test", root: process.cwd(), env: process.env,
    limits: { maxConcurrent: 4, maxAgents: 100, budgetTotal: null, shellTimeoutS: 30 }, journalPath, cache: undefined, out: () => {},
    resolveChild: () => { throw new Error("no child"); }, host,
  });
}

test("GSDF-18 the run's roles list every role with the model and effort it resolved to, lanes apart and calls counted", async () => {
  const body = `
    await agent("a", { role: "planner", label: "plan" });
    await agent("b", { role: "planner", label: "plan-2" });
    await parallel([
      () => agent("c", { role: "skeleton_lane", model: "p/lane-a", label: "skeleton-L1" }),
      () => agent("d", { role: "skeleton_lane", model: "p/lane-b", effort: "high", label: "skeleton-L2" }),
    ]);
    return "done";`;
  const r = await engine(body);
  assert.deepEqual(r.roles, [
    { role: "planner", agentType: null, model: "p/pro", effort: null, calls: 2 },
    { role: "skeleton_lane", agentType: null, model: "p/lane-a", effort: null, calls: 1 },
    { role: "skeleton_lane", agentType: null, model: "p/lane-b", effort: "high", calls: 1 },
  ]);
});

test("GSDF-18 a call that cannot resolve is listed with a null model, and its detail reply says so instead of an agent default", async () => {
  const body = `
    const d = await agent("x", { role: "planner", detail: true });
    const e = await agent("y", { agentType: "nope", detail: true });
    return [d.model, d.effort, e.model, e.reason];`;
  const r = await engine(body);
  assert.deepEqual(r.result, ["p/pro", null, null, "agent type 'nope' not found: x"]);
  assert.deepEqual(r.roles.at(-1), { role: null, agentType: "nope", model: null, effort: null, calls: 1 });
});

test("FLOW-15 the start line of a call already names its role, agent type and model, so an interrupted run keeps them", async () => {
  const journalPath = path.join(makeTempDir("g139-journal-"), "journal.jsonl");
  await engine(`await agent("x", { role: "planner", label: "plan" });`, { journalPath });
  const lines = fs.readFileSync(journalPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const start = lines.find((e) => e.status === "start");
  assert.deepEqual([start.role, start.agentType, start.model], ["planner", null, "p/pro"]);
});

test("GSDF-18 an object result.json carries the run's roles; a roles key the script returns itself is kept", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta("roles")}const a = await agent("x", { role: "planner" }); return { a };`);
  const r = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(r.code, 0, r.stderr);
  const runsDir = s.project.path("_workspace/_runs");
  const [id] = fs.readdirSync(runsDir);
  const result = JSON.parse(fs.readFileSync(path.join(runsDir, id, "result.json"), "utf8"));
  assert.equal(result.a, "ok");
  assert.deepEqual(result.roles.map((x) => [x.role, x.calls]), [["planner", 1]]);
  assert.equal(typeof result.roles[0].model, "string");
  // Two runs can start in the same second, so the second run is the one directory that is not the first.
  s.project.write("own.js", `${meta("own")}return { roles: "mine" };`);
  await s.ph(["workflow", "--script", "own.js"]);
  const [own] = fs.readdirSync(runsDir).filter((d) => d !== id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runsDir, own, "result.json"), "utf8")).roles, "mine");
});

test("GSDF-21 the outline review table names each lane's resolved model and effort, lane by lane", async () => {
  const w = makeWorld();
  await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR, skeletonLanes: [{ lens: "fidelity" }, { lens: "integration", model: "p/lane-b", effort: "high" }] }, gsd: w.gsd, agent: plannerResponder(w) });
  const review = w.read(`${PHASE_DIR}/01-OUTLINE-REVIEW.md`);
  assert.match(review, /\| L1 \| fidelity \| host\/default \| agent default \|/);
  assert.match(review, /\| L2 \| integration \| p\/lane-b \| high \|/);
});
