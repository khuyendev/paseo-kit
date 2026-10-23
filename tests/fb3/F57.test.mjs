// F57 (kit-feedback 57): the execute gate never built the shipping target, so a toolchain gap (no make for the native hook of a
// dependency) surfaced after the last wave of phase 2. adapter.smoke_triggers names the dependency manifests and native-asset
// files; the first wave that changes one runs adapter.commands.smoke_builds once per phase, before its gate.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { smokeDue } from "../../ship/.agents/workflows/lib/flow-execute.mjs";
import { TEST_ARGV, executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const SMOKE = [process.execPath, "-e", "process.exit(0)"];
const smokeOverlay = (smoke_builds) => ({
  adapter: { commands: { build: SMOKE, test: TEST_ARGV, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {}, smoke_builds } },
});
// A plan whose owns include one manifest, so a change to it is the plan's own output.
const owning = (id, rel) => task(id, { owns: [`Path:src/${id}/`, rel, `${PHASE_DIR}/${id}-SUMMARY.md`] });
const run = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });

test("F57 adapter.smoke_triggers defaults to the common dependency manifests and validates; a string is rejected", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.ok(defaults.adapter.smoke_triggers.includes("**/pubspec.yaml"));
  assert.ok(defaults.adapter.smoke_triggers.includes("**/pubspec.lock"));
  assert.doesNotThrow(() => validateAgainstSchema(defaults));
  assert.throws(() => validateAgainstSchema({ ...defaults, adapter: { ...defaults.adapter, smoke_triggers: "pubspec.yaml" } }), /smoke_triggers/);
});

test("F57 smokeDue: a changed file (a deleted one too) matching a trigger makes the wave due; other changes do not", () => {
  const globs = ["**/pubspec.yaml", "**/Cargo.toml"];
  assert.deepEqual(smokeDue({ files: ["src/01-01/impl.dart", "packages/a/pubspec.yaml"], globs }), { due: true, matched: ["packages/a/pubspec.yaml"] });
  assert.deepEqual(smokeDue({ files: ["pubspec.yaml", "pubspec.yaml"], globs }), { due: true, matched: ["pubspec.yaml"] });
  assert.deepEqual(smokeDue({ files: ["src/01-01/impl.dart"], globs }), { due: false, matched: [] });
  assert.deepEqual(smokeDue({ files: ["pubspec.yaml"], globs: [] }), { due: false, matched: [] });
});

test("F57 the first wave that changes a manifest runs the smoke builds once per phase, before that wave is committed", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [owning("01-02", "pubspec.yaml")], [owning("01-03", "pubspec.lock")]], overlay: smokeOverlay([SMOKE]) });
  w.gsd.on("check smoke", () => {
    w.events.push("smoke");
    return { status: "passed", builds: [{ argv: SMOKE, status: "passed" }] };
  });
  const r = await run(w, {
    "exec-01-02": () => { w.write("pubspec.yaml", "name: app\n"); },
    "exec-01-03": () => { w.write("pubspec.lock", "packages: {}\n"); },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  // Wave 3 changes the lock file too, but the build of the phase already passed.
  assert.equal(w.gsd.callsOf("check smoke").length, 1);
  const order = w.events.filter((e) => /^(commit|smoke)/.test(e));
  assert.deepEqual(order.map((e) => (e === "smoke" ? "smoke" : e.includes("w1") ? "wave 1" : e.includes("w2") ? "wave 2" : "wave 3")), ["wave 1", "smoke", "wave 2", "wave 3"], JSON.stringify(order));
});

test("F57 a failing smoke build stops the wave that changed the manifest as needs-owner at Smoke build, before the gate of that wave", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [owning("01-02", "pubspec.yaml")], [task("01-03")]], overlay: smokeOverlay([SMOKE]) });
  w.gsd.on("check smoke", () => ({ code: 1, json: { status: "failed", reason: `${SMOKE.join(" ")}: build exited 1`, builds: [{ argv: SMOKE, status: "failed", output: "make: not found" }] } }));
  const r = await run(w, { "exec-01-02": () => { w.write("pubspec.yaml", "name: app\n"); } });
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Smoke build");
  assert.match(r.result.reason, /^wave 2 changes pubspec\.yaml; /);
  assert.deepEqual(r.result.builds, [{ argv: SMOKE, status: "failed", output: "make: not found" }]);
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("exec-01-03")).length, 0, "no later wave starts");
  assert.ok(!r.result.events.some((e) => e.startsWith("gate w2")), JSON.stringify(r.result.events));
});

test("F57 without smoke_builds, or with no trigger in the wave, nothing is built", async () => {
  const none = makeExecWorld({ waves: [[owning("01-01", "pubspec.yaml")]] });
  const r1 = await run(none, { "exec-01-01": () => { none.write("pubspec.yaml", "name: app\n"); } });
  assert.equal(r1.result.status, "executed", JSON.stringify(r1.result));
  assert.equal(none.gsd.callsOf("check smoke").length, 0);

  const quiet = makeExecWorld({ waves: [[task("01-01")]], overlay: smokeOverlay([SMOKE]) });
  const r2 = await run(quiet);
  assert.equal(r2.result.status, "executed", JSON.stringify(r2.result));
  assert.equal(quiet.gsd.callsOf("check smoke").length, 0);
});

test("F57 a build that passed before is kept in execute-progress.json: a resumed run does not build the phase again", async () => {
  const w = makeExecWorld({ waves: [[owning("01-01", "pubspec.yaml")]], overlay: smokeOverlay([SMOKE]) });
  w.write(`${PHASE_DIR}/execute-progress.json`, JSON.stringify({ plans: {}, smoke: { wave: "w1", changed: ["pubspec.yaml"] } }));
  const r = await run(w, { "exec-01-01": () => { w.write("pubspec.yaml", "name: app\n"); } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(w.gsd.callsOf("check smoke").length, 0);
});

test("F57 in batch mode the smoke builds run once before the batch gate when a wave changed a manifest", async () => {
  const w = makeExecWorld({ waves: [[owning("01-01", "pubspec.yaml")], [task("01-02")]], overlay: { ...smokeOverlay([SMOKE]), gsd: { execution_mode: "batch" } } });
  w.gsd.on("check smoke", () => ({ status: "passed", builds: [{ argv: SMOKE, status: "passed" }] }));
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, { "exec-01-01": () => { w.write("pubspec.yaml", "name: app\n"); } }) });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(w.gsd.callsOf("check smoke").length, 1);
});
