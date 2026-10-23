// G125: the stage digest of an agent call covers what the call judges and the settings a judgment reads, so an
// unrelated edit, commit or planning write keeps a resumed call cached, and an edit to a judged file still misses.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { loadJournalCache } from "../../ship/.agents/harness/workflow/journal.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { testEnv } from "../helpers/env.mjs";
import { fakeHost } from "../workflow/helpers.mjs";
import { plan, REQUIREMENTS, ROADMAP } from "../gsd-core/fixture.mjs";
import { PHASE_DIR as PD } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const flagCommands = { build: [process.execPath, "-e", "process.exit(0)"], test: [process.execPath, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const digestOf = async (root, input) => (await flow(root, ["digest"], input)).json.hash;

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

test("G125 a resumed plan review stays cached through an unrelated edit, commit or planning write, and misses on an owned edit", async () => {
  const p = installed({ [`${PD}/01-01-PLAN.md`]: plan(), "src/a.js": "original\n", "README.md": "one\n" });
  const journal = p.path("_workspace/custom-runs/review/journal.jsonl");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  const makeHost = () => fakeHost({ runner: async () => ({ status: "ok", result: { issues: [] }, tokens: 0, agentId: "finder" }) });
  const first = makeHost();
  assert.equal((await run(p, "gsd-plan-review", { phaseDir: PD, plans: ["01-01"] }, first, journal)).result.status, "converged");
  assert.equal(first.calls.runner.length, 1);
  const resume = async () => {
    const host = makeHost();
    assert.equal((await run(p, "gsd-plan-review", { phaseDir: PD, plans: ["01-01"] }, host, journal, loadJournalCache(journal))).result.status, "converged");
    return host.calls.runner.length;
  };
  p.write("README.md", "two\n");
  assert.equal(await resume(), 0, "an uncommitted unrelated edit");
  p.git("commit", "-qam", "docs");
  assert.equal(await resume(), 0, "a commit of an unrelated file");
  p.write(`${PD}/notes.md`, "written by a planner\n");
  assert.equal(await resume(), 0, "a planning file the reviewed plan does not judge");
  p.write("src/a.js", "changed\n");
  assert.equal(await resume(), 1, "an edit to the code the reviewed plan owns");
});

test("G125 the call digest follows the judged files and owns, not gate commands or the run's own settings", async () => {
  const files = { "src/a.js": "1\n", [`${PD}/.keep`]: "" };
  const plain = makeTempProject({ files });
  const gated = makeTempProject({ files, overlay: { adapter: { commands: flagCommands } } });
  const input = { files: ["src/a.js"], owns: ["Path:src/a.js"] };
  assert.equal(await digestOf(gated.root, input), await digestOf(plain.root, input));
  plain.write("src/a.js", "2\n");
  assert.notEqual(await digestOf(plain.root, input), await digestOf(gated.root, input));
});
