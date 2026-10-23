// Kit feedback 51: a gate failure goes to the plans owning the file it is reported at, and a fixer's "blocked" that its
// failures do not bear out is not an owner decision (the owned changes of every fixer are transferred and the gate reruns first).
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;
const PD = ".planning/phases/03-api";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const adapter = (test) => ({ adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } });
const plans = [{ id: "03-01", owns: ["Path:src/a/"], verify: [] }, { id: "03-02", owns: ["Path:src/b/"], verify: [] }];

test("F51 a failure is attributed to the plan owning the file it is reported at, not to every plan a passing test names", async () => {
  const p = makeTempProject({
    files: { "src/a/ok_test.js": "a\n", "src/b/y.js": "y\n" },
    overlay: adapter([NODE, "-e", "console.log('ok src/a/ok_test.js');console.log('error src/b/y.js:3: boom');process.exit(1)"]),
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.equal(r.json.green, false);
  assert.deepEqual(Object.keys(r.json.byPlan), ["03-02"]);
  assert.deepEqual(r.json.byPlan["03-02"].map((f) => f.step), ["test"]);
  assert.deepEqual(r.json.unplaced, []);
});

test("F51 without any position, every file a failure names decides its owners, as before", async () => {
  const p = makeTempProject({
    files: { "src/a/x.js": "x\n", "src/b/y.js": "y\n" },
    overlay: adapter([NODE, "-e", "console.log('FAIL src/a/x.js: boom');console.log('ok src/b/y.js');process.exit(1)"]),
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.deepEqual(Object.keys(r.json.byPlan), ["03-01", "03-02"]);
});

// The 01-01 fixer makes the gate green by adding its file in its worktree; the 01-02 fixer answers blocked, not mine.
const fixTest = (second) => [NODE, "-e", `if(!require('fs').existsSync('src/01-01/fix.txt')){console.log('error src/01-01/impl.js:1: fix.txt missing');console.log('${second}');process.exit(1)}`];
const fixerOverrides = (w, blocked) => ({
  "fix-01-01": (p, o, n, calls) => { w.write(`${calls.find((c) => c.n === n).worktree}/src/01-01/fix.txt`, "fixed\n"); return { taskResults: [{ task: "1", status: "implemented", evidence: "fixed" }], deviations: [], requests: [] }; },
  "fix-01-02": () => (blocked ? { taskResults: [{ task: "1", status: "blocked", evidence: "outside owns" }], deviations: [], requests: [] } : { taskResults: [], status: "fixed" }),
});
const commands = (test) => ({ build: [NODE, "-e", "process.exit(0)"], test, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} });

test("F51 a fixer's blocked answer is no owner decision while its failures are gone after the other fixer's transfer and rerun", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation: "worktree" }, adapter: { commands: commands(fixTest("error src/01-02/impl.js:1: shared red")) } } });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, fixerOverrides(w, true)) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(w.read("src/01-01/fix.txt"), "fixed\n");
  assert.equal(r.calls.filter((c) => c.opts.label === "fix-01-02-1").length, 1);
});

test("F51 a fixer is given only the failures its own files carry", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { gsd: { isolation: "worktree" }, adapter: { commands: commands(fixTest("ok src/01-02/impl.js")) } } });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, fixerOverrides(w, false)) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const labels = r.calls.map((c) => c.opts.label);
  assert.equal(labels.includes("fix-01-01-1"), true);
  assert.equal(labels.includes("fix-01-02-1"), false);
});
