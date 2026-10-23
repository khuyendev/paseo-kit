// Kit feedback #91 (fb7 V1A): the runtime names an executor worktree by its absolute path. F1 state-plan stores an absolute
// summary or worktree inside the project root-relative (outside it stays refused); F2 a plan halted on a decision through the
// runtime's absolute worktree path is answered with the real `ph gsd halt clear --resume` and the next run transfers that tree
// without an executor; F3 a refused state write is a warning of the run's result, not only a log line.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { gsd as runGsdIn } from "../gsd-core/fixture.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

// ---- F1 ----

test("V1A 91 F1 state-plan executed takes the runtime's absolute worktree inside the project and stores it root-relative", async () => {
  const p = makeTempProject({ files: { [`${PHASE_DIR}/.keep`]: "" } });
  const wt = path.join(p.root, ".claude", "worktrees", "wf_x-1");
  fs.mkdirSync(path.join(wt, PHASE_DIR), { recursive: true });
  fs.writeFileSync(path.join(wt, PHASE_DIR, "01-01-SUMMARY.md"), "done\n");
  const r = await flow(p.root, ["state-plan", PHASE_DIR], { plan: "01-01", stage: "executed", summary: `${PHASE_DIR}/01-01-SUMMARY.md`, worktree: wt });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.state.stages["01-01"], { stage: "executed", summary: `${PHASE_DIR}/01-01-SUMMARY.md`, worktree: ".claude/worktrees/wf_x-1" });
  // The Windows form with backslashes, and an absolute summary path, are the same record.
  const again = await flow(p.root, ["state-plan", PHASE_DIR], { plan: "01-01", stage: "executed", summary: path.join(p.root, PHASE_DIR, "01-01-SUMMARY.md").replace(/\//g, "\\"), worktree: wt.replace(/\//g, "\\") });
  assert.equal(again.code, 0, JSON.stringify(again.json));
  assert.equal(again.json.state.stages["01-01"].worktree, ".claude/worktrees/wf_x-1");
});

test("V1A 91 F1 an absolute worktree outside the project, the project root itself or a .. path stays refused", async () => {
  const p = makeTempProject({ files: { [`${PHASE_DIR}/.keep`]: "" } });
  const outside = makeTempDir("v1a outside ");
  for (const worktree of [outside, p.root, "../elsewhere"]) {
    const r = await flow(p.root, ["state-plan", PHASE_DIR], { plan: "01-01", stage: "executed", summary: `${PHASE_DIR}/01-01-SUMMARY.md`, worktree });
    assert.equal(r.code, 1, worktree);
    assert.match(r.json.reason, /is not a path inside the project/, worktree);
  }
});

// ---- F2 ----

const SUMMARY = (id) => `${PHASE_DIR}/${id}-SUMMARY.md`;
// An executor that writes its output where the runtime put it: the absolute worktree path of its call.
function absExecutor(w, decide = {}) {
  const base = executor(w);
  return async (prompt, o, n, calls) => {
    if (!o.label.startsWith("exec-")) return base(prompt, o, n, calls);
    const id = o.label.slice(5);
    const wt = calls.find((c) => c.n === n)?.worktree;
    assert.ok(wt && path.isAbsolute(wt), `the call of ${id} has an absolute worktree (${wt})`);
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true }); fs.writeFileSync(path.join(wt, rel), text); };
    put(`src/${id}/impl.js`, `impl ${id}\n`);
    put(SUMMARY(id), `---\nkey-files:\n  created: [src/${id}/impl.js]\n---\ndone\n`);
    return decide[id] ?? { taskResults: [{ task: "1", status: "implemented", evidence: "ok" }], deviations: [], requests: [] };
  };
}
const run = (w, agent, runId) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent, absoluteWorktrees: true, ...(runId ? { runId } : {}) });
const decision = { taskResults: [{ task: "1", status: "partial", evidence: "which schema?" }], deviations: [{ rule: 4, note: "pick a schema" }], requests: [] };

test("V1A 91 F2 a decision halt through the runtime's absolute worktree, answered with the real halt clear --resume, is transferred by the next run", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation: "worktree" } } });
  const first = await run(w, absExecutor(w, { "01-02": decision }));
  assert.equal(first.result.status, "needs-owner", JSON.stringify(first.result.reason));
  assert.ok(!first.logs.some((l) => /state-plan refused/.test(l)), first.logs.filter((l) => /refused/.test(l)).join("\n"));
  assert.equal(first.result.warnings, undefined, JSON.stringify(first.result.warnings));
  const halt = JSON.parse(w.read(`${PHASE_DIR}/01-02-HALT.json`));
  assert.equal(halt.finished, true);
  assert.ok(path.isAbsolute(halt.worktree), halt.worktree);

  const cleared = await runGsdIn({ root: w.root }, ["halt", "clear", "1", "--plan", "01-02", "--reason", "the work stands", "--resume"]);
  assert.equal(cleared.code, 0, JSON.stringify(cleared.json));
  assert.equal(cleared.json.resume, true);

  const second = await run(w, absExecutor(w), "wf_20261021-090000_cd34");
  assert.equal(second.result.status, "executed", JSON.stringify(second.result.reason));
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-02").length, 0, "no executor runs for the resumed plan");
  assert.ok(second.result.events.includes("resume w1 01-02"));
  assert.ok(second.result.events.includes("transfer 01-02"));
  assert.ok(!second.logs.some((l) => /state-plan refused/.test(l)), second.logs.filter((l) => /refused/.test(l)).join("\n"));
  assert.equal(second.result.warnings, undefined);
  assert.equal(w.read("src/01-02/impl.js"), "impl 01-02\n");
  assert.equal(fs.existsSync(halt.worktree), false, "the transferred tree goes after the commit");
});

// ---- F3 ----

test("V1A 91 F3 a refused state write is listed in the result's warnings (and still logged)", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  // A grant of a path outside the project: state-integration refuses it.
  w.write(`${PHASE_DIR}/grants.json`, JSON.stringify([{ path: "../outside.js" }]));
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.ok(r.logs.some((l) => /state-integration refused: file "\.\.\/outside\.js" is not a path inside the project/.test(l)));
  assert.ok(r.result.warnings?.some((x) => /^state-integration refused: file "\.\.\/outside\.js" is not a path inside the project/.test(x)), JSON.stringify(r.result.warnings));
});

test("V1A 91 F3 a run whose state writes all hold has no warnings key", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "executed");
  assert.equal(r.result.warnings, undefined);
});
