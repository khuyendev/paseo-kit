// Kit feedback #58 (F58): phase verify reads one gate over every plan, run after the last wave is committed; and a gate's
// evidence is bound to the adapter commands and verify vocabulary only, so other adapter keys and harness settings do not
// make it stale.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

test("F58 execute returns one phase-wide gate evidence file, and verify finds it current over every plan of every wave", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.result.evidence.length, 1, JSON.stringify(r.result.evidence));
  assert.match(r.result.evidence[0], /\/evidence\/batch-1\.json$/);
  // gsd-verify.js plans every handoff wave under the batch name, so the phase gate is the evidence for all of them.
  const planned = [1, 2].flatMap((k) => JSON.parse(w.read(`${PHASE_DIR}/handoff/w${k}.args.json`)).tasks.map((t) => ({ id: t.plan, owns: t.owns, verify: t.verify ?? [], waveId: `w${k}`, batch: "batch" })));
  const c = await flow(w.root, ["evidence-check", r.result.evidence[0]], { plans: planned });
  assert.equal(c.json.status, "current", JSON.stringify(c.json));
});

test("F58 green evidence stays current when another adapter key or a harness setting changes, and goes stale when a gate command changes", async () => {
  const commands = { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} };
  const p = makeTempProject({ files: { "src/a/x.js": "x\n" }, overlay: { adapter: { commands } } });
  const plans = [{ id: "03-01", owns: ["Path:src/a/"], verify: [] }];
  const r = await flow(p.root, ["gate", ".planning/phases/03-api"], { waveId: "w1", plans });
  assert.equal(r.json.green, true);
  const check = () => flow(p.root, ["evidence-check", r.json.evidence], { plans });
  assert.equal((await check()).json.status, "current");
  p.writeJson(".agents/harness.config.json", { adapter: { commands, stack_skill: "stack-x" }, context_guard: { start_pct: 45 } });
  assert.equal((await check()).json.status, "current");
  p.writeJson(".agents/harness.config.json", { adapter: { commands: { ...commands, test: [NODE, "-e", "process.exit(0)", "--changed"] } } });
  const st = await check();
  assert.equal(st.json.status, "stale");
  assert.equal(st.json.reason, "adapter configuration differs from the gate inputs");
});
