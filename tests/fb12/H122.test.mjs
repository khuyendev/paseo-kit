// Kit feedback 122 F1-F3: an executor brief carries the optional static check (command and owned files) and, when
// gsd.executor_verifies_itself is on, the self-verify binding; the first gate's evidence tags compile vs behaviour
// and the run result counts those failures. Unset, the brief is unchanged.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const { loadConfig } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/config.mjs")).href);
const { failureClass } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-gate.mjs")).href);
const NODE = process.execPath;
const PD = ".planning/phases/03-api";
const CHECK = [NODE, "analyze", "--no-fatal-infos", "{files}"];

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

const commands = (extra = {}) => ({ build: [NODE, "-e", "process.exit(0)"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {}, ...extra });

async function execPrompt(overlay, meta = {}) {
  const w = makeExecWorld({ waves: [[task("01-01")]], meta, overlay });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason ?? r.result));
  return r.calls.find((c) => c.opts.label === "exec-01-01").prompt;
}

test("H122 F1 the executor prompt carries the check command and the owned changed files, and nothing when unset", async () => {
  const bare = await execPrompt({ adapter: { commands: commands() } });
  assert.doesNotMatch(bare, /Check command|Check files|Self-verify/);
  const prompt = await execPrompt(
    { adapter: { commands: commands({ check_files: CHECK }) } },
    { "01-01": { files: ["src/01-01/impl.js", "docs/note.md"] } },
  );
  assert.match(prompt, /Check command: \[".*analyze","--no-fatal-infos","\{files\}"\]/);
  assert.match(prompt, /Check files: \["src\/01-01\/impl\.js"\]/);
  assert.doesNotMatch(prompt, /docs\/note\.md/, "a file the plan does not own is not a check file");
  assert.doesNotMatch(prompt, /Self-verify/);
  assert.equal(loadConfig(makeTempProject().root).adapter.commands.check_files, undefined);
  assert.throws(() => loadConfig(makeTempProject({ overlay: { adapter: { commands: commands({ check_files: [] }) } } }).root), /check_files/);
});

test("H122 F2 executor_verifies_itself off leaves the brief alone; on names the test-run binding", async () => {
  assert.equal(loadConfig(makeTempProject().root).gsd.executor_verifies_itself, false);
  const off = await execPrompt({ gsd: { executor_verifies_itself: false }, adapter: { commands: commands() } });
  assert.doesNotMatch(off, /Self-verify|ph gsd test-run/);
  const on = await execPrompt({ gsd: { executor_verifies_itself: true }, adapter: { commands: commands() } });
  assert.match(on, /Self-verify command: /);
  assert.match(on, /Self-verify attempts: /);
  assert.match(on, /Self-verify minutes: /);
  assert.doesNotMatch(on, /Check command/);
  assert.throws(() => loadConfig(makeTempProject({ overlay: { gsd: { executor_verifies_itself: "yes" } } }).root), /executor_verifies_itself/);
});

test("H122 F3 a failed build or analyze step is compile, a failed test step is behaviour, and the run counts the first gate", async () => {
  assert.equal(failureClass("build", ["flutter", "analyze"]), "compile");
  assert.equal(failureClass("gate-analyze", []), "compile");
  assert.equal(failureClass("test", ["flutter", "test"]), "behaviour");
  assert.equal(failureClass("03-01-1-cmd", []), "behaviour");
  assert.equal(failureClass("checks", []), null);
  assert.equal(failureClass("build", []), "compile");
  const p = makeTempProject({
    files: { "src/a.js": "a\n" },
    overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(1)"], test: [NODE, "-e", "process.exit(1)"], build_timeout_s: 30, test_timeout_s: 30, gates: [{ name: "analyze", argv: [NODE, "-e", "process.exit(1)"] }], verify: {} } } },
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:src/"], verify: [] }] });
  assert.equal(r.json.green, false);
  const ev = p.readJson(r.json.evidence);
  const step = (name) => ev.steps.find((s) => s.name === name);
  assert.equal(step("build").class, "compile");
  assert.equal(step("gate-analyze").class, "compile");
  assert.equal(step("test").class, "behaviour");
  assert.equal(step("checks")?.class, undefined);
  assert.equal(r.json.failures.find((f) => f.step === "build").class, "compile");
  assert.equal(r.json.failures.find((f) => f.step === "test").class, "behaviour");
  const w = makeExecWorld({
    waves: [[task("01-01")]],
    overlay: { gsd: { max_verify_rounds: 1 }, adapter: { commands: commands({ build: [NODE, "-e", "process.exit(1)"] }) } },
  });
  const run = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(run.result.status, "needs-owner");
  assert.deepEqual(run.result.firstGate, { compile: 1, behaviour: 0 });
});
