// G022 (kit-feedback 22): plans pin dependencies that do not resolve together. The adapter's dependency probe checks the
// set the plans declare at handoff; a failing set stops gsd-plan at stage Dependencies, before the handoff writes waves.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";
import * as planning from "../../ship/.agents/harness/gsd/planning.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR, makeWorld, plannerResponder } from "../gsd-flows/world.mjs";

// A probe that fails on the package bad_pkg and names the set it was given.
const PROBE = [
  'import fs from "node:fs";',
  'const set = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
  'const bad = set.dependencies.filter((d) => d.name === "bad_pkg");',
  'if (bad.length) { console.log("cannot resolve: " + JSON.stringify(bad)); process.exit(1); }',
  'console.log("resolved " + set.dependencies.length);',
  "",
].join("\n");
const SLOW = 'setTimeout(() => {}, 10000);\n';
const probeOverlay = (adapter = {}) => ({ adapter: { dependency_probe: ["node", "tools/probe.mjs"], ...adapter } });
const withShared = (body) => `${plan()}<shared_changes>\n${body}\n</shared_changes>\n`;

test("G022 a dependency line names its package, constraint and dev marker; file and prose lines are not dependencies", () => {
  assert.deepEqual(planning.sharedDependencies("pubspec.yaml: dependency build_runner ^2.17.1 [dev]\nlib/main.dart: import x\npubspec.yaml: add drift_dev ^2.35.1"), [
    { path: "pubspec.yaml", name: "build_runner", constraint: "^2.17.1", dev: true },
  ]);
  assert.deepEqual(planning.sharedDependencies("- `pubspec.yaml`: dependency drift >=2.0 <3.0"), [{ path: "pubspec.yaml", name: "drift", constraint: ">=2.0 <3.0", dev: false }]);
  assert.deepEqual(planning.sharedDependencies("pubspec.yaml: dependency"), [{ path: "pubspec.yaml", name: null, constraint: null, dev: false }]);
  assert.deepEqual(planning.sharedDependencies("pubspec.yaml: dependencies are injected by main"), []);
});

test("G022 the dependency check runs nothing unless a probe is configured, and reports every outcome with its exit code", async () => {
  const files = { [`${P1}/01-01-PLAN.md`]: withShared("pubspec.yaml: dependency bad_pkg ^9.0.0 [dev]"), "tools/probe.mjs": PROBE };
  const unset = await gsd(project({ files }), ["check", "dependencies", "1"]);
  assert.deepEqual([unset.code, unset.json.status], [0, "skipped"]);
  assert.equal(unset.json.dependencies[0].name, "bad_pkg");

  const none = await gsd(project({ files: { [`${P1}/01-01-PLAN.md`]: plan() }, overlay: probeOverlay() }), ["check", "dependencies", "1"]);
  assert.deepEqual([none.code, none.json.status], [0, "none"]);

  const passed = await gsd(project({ files: { [`${P1}/01-01-PLAN.md`]: withShared("pubspec.yaml: dependency good_pkg ^1.0.0"), "tools/probe.mjs": PROBE }, overlay: probeOverlay() }), ["check", "dependencies", "1"]);
  assert.deepEqual([passed.code, passed.json.status], [0, "passed"]);
  assert.deepEqual(passed.json.dependencies, [{ plan: "01-01", path: "pubspec.yaml", name: "good_pkg", constraint: "^1.0.0", dev: false }]);

  // Two plans: the failing entry keeps its plan id, and the probe output reaches the verdict.
  const failing = await gsd(project({ files: { [`${P1}/01-01-PLAN.md`]: withShared("pubspec.yaml: dependency good_pkg ^1.0.0"), [`${P1}/01-02-PLAN.md`]: withShared("pubspec.yaml: dependency bad_pkg ^9.0.0 [dev]"), "tools/probe.mjs": PROBE }, overlay: probeOverlay() }), ["check", "dependencies", "1"]);
  assert.deepEqual([failing.code, failing.json.status], [1, "failed"]);
  assert.equal(failing.json.reason, "dependency probe exited 1");
  assert.match(failing.json.output, /cannot resolve: .*"plan":"01-02".*"name":"bad_pkg".*"constraint":"\^9\.0\.0".*"dev":true/);

  const nameless = await gsd(project({ files: { [`${P1}/01-01-PLAN.md`]: withShared("pubspec.yaml: dependency"), "tools/probe.mjs": PROBE }, overlay: probeOverlay() }), ["check", "dependencies", "1"]);
  assert.deepEqual([nameless.code, nameless.json.status], [1, "failed"]);
  assert.match(nameless.json.reason, /name no package: 01-01 pubspec\.yaml/);

  const missing = await gsd(project({ files: { [`${P1}/01-01-PLAN.md`]: withShared("pubspec.yaml: dependency good_pkg ^1.0.0") }, overlay: probeOverlay({ dependency_probe: ["no-such-probe-g022"] }) }), ["check", "dependencies", "1"]);
  assert.deepEqual([missing.code, missing.json.status], [69, "unresolvable"]);
  assert.match(missing.json.reason, /could not run/);

  const slow = await gsd(project({ files: { [`${P1}/01-01-PLAN.md`]: withShared("pubspec.yaml: dependency good_pkg ^1.0.0"), "tools/slow.mjs": SLOW }, overlay: probeOverlay({ dependency_probe: ["node", "tools/slow.mjs"], dependency_probe_timeout_s: 1 }) }), ["check", "dependencies", "1"]);
  assert.deepEqual([slow.code, slow.json.status], [69, "unresolvable"]);
  assert.match(slow.json.reason, /timed out after 1s/);
});

test("G022 adapter.dependency_probe is null or a non-empty argv, and its timeout is an integer of at least 1", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.equal(defaults.adapter.dependency_probe, null);
  assert.equal(defaults.adapter.dependency_probe_timeout_s, 300);
  const check = (adapter) => validateAgainstSchema({ ...defaults, adapter: { ...defaults.adapter, ...adapter } });
  assert.doesNotThrow(() => check({ dependency_probe: ["node", "tools/probe.mjs"] }));
  for (const bad of [{ dependency_probe: [] }, { dependency_probe: "node tools/probe.mjs" }, { dependency_probe_timeout_s: 0 }]) {
    assert.throws(() => check(bad), /adapter\.dependency_probe/, JSON.stringify(bad));
  }
});

test("G022 gsd-plan stops needs-owner at stage Dependencies with the probe output, before the handoff writes waves", async () => {
  const w = makeWorld({ overlay: probeOverlay() });
  const dependencies = [{ plan: "01-02", path: "pubspec.yaml", name: "bad_pkg", constraint: "^9.0.0", dev: true }];
  w.gsd.on("check dependencies", () => ({ code: 1, json: { status: "failed", reason: "dependency probe exited 1", output: "cannot resolve: bad_pkg", dependencies } }));
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Dependencies"]);
  assert.equal(r.result.reason, "dependency probe exited 1");
  assert.equal(r.result.output, "cannot resolve: bad_pkg");
  assert.deepEqual(r.result.dependencies, dependencies);
  assert.ok(r.result.options.length >= 2);
  assert.equal(w.gsd.callsOf("handoff").length, 0);
  assert.deepEqual(w.gsd.callsOf("check dependencies")[0].argv, ["check", "dependencies", "01", "--plans", "01-01,01-02"]);
  assert.ok(r.logs.includes("phase Dependencies"));
});

test("G022 gsd-plan runs the dependency check only with a probe, and a passing set hands off as before", async () => {
  const unset = makeWorld();
  const quiet = await runScript("gsd-plan", { root: unset.root, args: { phaseDir: PHASE_DIR }, gsd: unset.gsd, agent: plannerResponder(unset) });
  assert.equal(quiet.result.status, "planned");
  assert.equal(unset.gsd.callsOf("check dependencies").length, 0);
  assert.ok(!quiet.logs.includes("phase Dependencies"));

  const w = makeWorld({ overlay: probeOverlay() });
  w.gsd.on("check dependencies", () => ({ status: "passed", dependencies: [] }));
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w) });
  assert.equal(r.result.status, "planned");
  assert.equal(w.gsd.callsOf("handoff").length, 1);
  assert.ok(r.logs.includes("phase Dependencies") && r.logs.includes("phase Handoff"));
  assert.match(fs.readFileSync(path.join(SHIP_DIR, ".agents", "workflows", "gsd-plan.js"), "utf8").slice(0, 800), /\{ title: "Dependencies" \}/);
});
