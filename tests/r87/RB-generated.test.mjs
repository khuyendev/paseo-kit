// Kit feedback #86, #87 part B (RB): a request or shared change against a generated file (adapter.ownership.regenerated) names its
// generator (via) and every file the generator rewrites (outputs). Without them the state verbs refuse it: it is held for the owner,
// no fixer edits the generated file by hand, and the Integration stop is answered with ph gsd shared clear.
import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { gsd as runGsdIn } from "../gsd-core/fixture.mjs";
import { committedFiles } from "../fb6/q77-helpers.mjs";

const PD = PHASE_DIR;
const GEN = "i18n/strings.g.json";
const OUT = "lib/strings.g.dart";
const regenerated = ["i18n/*.g.json", "lib/*.g.dart", "src/01-02/*.g.js"];
const genWorld = (waves = [[task("01-01")]]) => {
  const w = makeExecWorld({ waves, overlay: { adapter: { ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: [], regenerated } } } });
  w.write(GEN, "{}\n");
  w.write(OUT, "// gen\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "generated");
  return w;
};
async function st(w, name, input) {
  let out = "";
  const code = await main([`state-${name}`, PD], { root: w.root, input: JSON.stringify(input), out: (l) => { out += l; } });
  return { code, json: JSON.parse(out) };
}
const exec = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w, overrides) });
const asking = (w, requests) => { const run = executor(w); return { "exec-01-01": async (...a) => ({ ...(await run(...a)), requests }) }; };

test("RB 86 the state verbs refuse a generated target without via and outputs (holding a shared change, refusing a request)", async () => {
  const w = genWorld([[task("01-01"), task("01-02")]]);
  const held = await st(w, "shared", { op: "add", changes: [{ from: "01-01", path: GEN, change: "add key confirm" }] });
  assert.deepEqual([held.code, held.json.added, held.json.refused], [0, [], ["S1"]]);
  assert.match(held.json.state.shared[0].refused, /generated file \(adapter\.ownership\.regenerated\): a change to it names via/);
  assert.match((await st(w, "shared", { op: "applied", ids: ["S1"] })).json.reason, /refused .* only the owner clears it/);
  const partial = await st(w, "shared", { op: "add", changes: [{ from: "01-01", path: GEN, change: "c", via: "node tools/gen.mjs", outputs: [OUT] }] });
  assert.deepEqual(partial.json.refused, ["S2"], "outputs must hold the target itself");
  const ok = await st(w, "shared", { op: "add", changes: [{ from: "01-01", path: GEN, change: "c", via: "node tools/gen.mjs", outputs: [GEN, OUT] }] });
  assert.deepEqual(ok.json.added, ["S3"]);
  assert.deepEqual([ok.json.state.shared[2].via, ok.json.state.shared[2].outputs], ["node tools/gen.mjs", [GEN, OUT]]);
  const route = await st(w, "request", { op: "route", plan: "01-02", from: "01-01", path: "src/01-02/api.g.js", change: "c" });
  assert.deepEqual([route.code, route.json.status, route.json.generated], [1, "refused", true]);
  assert.equal((await st(w, "request", { op: "route", plan: "01-02", from: "01-01", path: "src/01-02/api.g.js", change: "c", via: "node gen.mjs", outputs: ["src/01-02/api.g.js"] })).json.routed, true);
  assert.equal((await st(w, "shared", { op: "add", changes: [{ from: "01-01", path: "config/plain.json", change: "c" }] })).json.added.length, 1, "a file that is not generated needs no generator");
});

test("RB 86 a run whose executor asks for a generated file without its generator stops at Integration before the gate; shared clear answers it", async () => {
  const w = genWorld();
  const first = await exec(w, asking(w, [{ path: GEN, change: "add common.actions.confirm", reason: "default confirm label" }]));
  assert.deepEqual([first.result.status, first.result.stage], ["needs-owner", "Integration"], JSON.stringify(first.result.reason));
  assert.match(first.result.reason, /target generated files without their generator: 01-01: i18n\/strings\.g\.json is a generated file/);
  assert.deepEqual(first.result.answer, { verb: "shared.clear", command: "ph gsd shared clear 01 w1 [--path <file>] --reason <what you did or accept>" });
  assert.equal(first.calls.some((c) => c.opts.label.startsWith("shared-")), false, "no fixer edits a generated file by hand");
  assert.equal(first.result.events.some((e) => e.startsWith("gate ")), false, "the stop comes before the gate is paid for");
  // The owner runs the generator and answers.
  w.write(GEN, "{\"common\":{\"actions\":{\"confirm\":\"OK\"}}}\n");
  const ans = await runGsdIn(w, ["shared", "clear", "1", "w1", "--path", GEN, "--reason", "ran node tools/gen.mjs; strings.g.json regenerated"]);
  assert.equal(ans.code, 0, JSON.stringify(ans.json));
  const next = await exec(w);
  assert.equal(next.result.status, "executed", JSON.stringify(next.result.reason));
  assert.ok(committedFiles(w, "feat(01-w1)").includes(GEN));
});

test("RB 86 a request naming via and outputs goes to the shared fixer, which owns every output and is told to run the generator", async () => {
  const w = genWorld();
  const r = await exec(w, {
    ...asking(w, [{ path: GEN, change: "add common.actions.confirm", reason: "label", via: "node tools/gen.mjs", outputs: [GEN, OUT] }]),
    "shared-": () => { w.write(GEN, "{\"k\":1}\n"); w.write(OUT, "// gen k\n"); return { status: "fixed", changes: [{ index: 0, applied: true }] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  const prompt = r.calls.find((c) => c.opts.label === "shared-w1").prompt;
  assert.match(prompt, /You own exactly these files: \["i18n\/strings\.g\.json","lib\/strings\.g\.dart"\]/);
  assert.match(prompt, /"via":"node tools\/gen\.mjs","outputs":\["i18n\/strings\.g\.json","lib\/strings\.g\.dart"\]/);
  assert.match(prompt, /made by running that generator command/);
  const files = committedFiles(w, "feat(01-w1)");
  assert.ok(files.includes(GEN) && files.includes(OUT), files.join(","));
  assert.match(r.calls.find((c) => c.opts.label === "exec-01-01").prompt, /is generated: a change to it is made through its generator/);
});
