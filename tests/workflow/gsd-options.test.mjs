// Engine features the GSD scripts rely on (integration requests of code-gsd-flows): the `runId` global kept across
// --resume, agent option `detail` and the per-call deadline `timeoutS`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { cacheKey } from "../../ship/.agents/harness/workflow/journal.mjs";
import { fakeHost, meta, setup } from "./helpers.mjs";

const engine = (body, { host = fakeHost(), attemptRunId } = {}) => runWorkflow({
  source: `${meta()}${body}`, scriptPath: "C:/p/wf.js", runId: "wf_now", attemptRunId, root: process.cwd(), env: process.env,
  limits: { maxConcurrent: 4, maxAgents: 100, budgetTotal: null, shellTimeoutS: 30 }, out: () => {}, resolveChild: () => { throw new Error("no child"); }, host,
});

test("FLOW-04 detail: true resolves {result, reason, agentId, worktree, durationS, model, effort}, also for a null call", async () => {
  const host = fakeHost({ runner: (s) => (s.prompt === "bad"
    ? { status: "null", reason: "usage limit reached", agentId: "a2", tokens: 0, durationS: 3 }
    : { status: "ok", result: "r", agentId: "a1", worktreePath: "/w/1", tokens: 1, durationS: 7 }) });
  const r = await engine(`return [await agent("good", { detail: true }), await agent("bad", { detail: true }), await agent("good")];`, { host });
  assert.deepEqual(r.result, [
    { result: "r", reason: null, agentId: "a1", worktree: "/w/1", durationS: 7, model: "p/m", effort: null },
    { result: null, reason: "usage limit reached", agentId: "a2", worktree: null, durationS: 3, model: "p/m", effort: null },
    "r",
  ]);
});

test("FLOW-04 detail and timeoutS are validated and are not part of the cache key", async () => {
  await assert.rejects(engine(`await agent("x", { detail: 1 });`), /detail must be a boolean/);
  await assert.rejects(engine(`await agent("x", { timeoutS: 0 });`), /timeoutS must be a number > 0/);
  const id = { roleHash: "", model: "p/m", effort: null };
  assert.equal(cacheKey("p", { detail: true, timeoutS: 5 }, id), cacheKey("p", {}, id));
});

test("FLOW-07 the runId global is the run id, and the first run's id on a resume", async () => {
  assert.equal((await engine(`return runId;`)).result, "wf_now");
  assert.equal((await engine(`return runId;`, { attemptRunId: "wf_first" })).result, "wf_first");
  const s = setup();
  s.project.write("wf.js", `${meta()}return runId;`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_a"])).code, 0);
  assert.equal((await s.ph(["workflow", "--resume", "wf_a", "--run-id", "wf_b"])).code, 0);
  assert.equal((await s.ph(["workflow", "--resume", "wf_b", "--run-id", "wf_c"])).code, 0);
  const res = (id) => JSON.parse(fs.readFileSync(s.project.path(`_workspace/_runs/${id}/result.json`), "utf8"));
  assert.deepEqual([res("wf_a"), res("wf_b"), res("wf_c")], ["wf_a", "wf_a", "wf_a"]);
});

test("FLOW-04 timeoutS: an agent that never replies ends null at the deadline and is archived", async () => {
  const s = setup({ responder: () => [{ hang: true }] });
  s.project.write("wf.js", `${meta()}return await agent("slow", { timeoutS: 120, detail: true });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_t"]);
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(fs.readFileSync(path.join(s.project.path("_workspace/_runs/wf_t"), "result.json"), "utf8"));
  assert.equal(out.result, null);
  assert.match(out.reason, /no reply within 120 s/);
  const id = out.agentId;
  assert.ok(s.fake.callsOf("archiveAgent").some((c) => c.args[0] === id));
});
