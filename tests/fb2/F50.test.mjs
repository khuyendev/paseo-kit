// F50 (kit-feedback 50): no phase gate built the declared verification target, so a missing toolchain component (VS Build Tools
// without ATL) surfaced at the first obligation of phase 2. adapter.commands.smoke_builds declares one build argv per target;
// `ph gsd check smoke` builds each once, and gsd-plan stops needs-owner at stage Smoke build before any planner runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";
import { gsd, project } from "../gsd-core/fixture.mjs";
import { lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR, makeWorld, plannerResponder } from "../gsd-flows/world.mjs";

// The overlay replaces adapter.commands whole, so every other commands key is written out.
const smokeOverlay = (smoke_builds, extra = {}) => ({
  adapter: { commands: { build: null, test: null, build_timeout_s: 30, test_timeout_s: 600, gates: [], verify: {}, smoke_builds, ...extra } },
});
const FILES = {
  "tools/ok.mjs": 'console.log("built");\n',
  "tools/bad.mjs": 'console.error("C1083: cannot open include file: atlstr.h");\nprocess.exit(1);\n',
  "tools/slow.mjs": "setTimeout(() => {}, 10000);\n",
};

test("F50 adapter.commands.smoke_builds defaults to nothing, takes one argv per target, and an overlay without it still validates", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.deepEqual(defaults.adapter.commands.smoke_builds, []);
  const check = (commands) => validateAgainstSchema({ ...defaults, adapter: { ...defaults.adapter, commands } });
  const { smoke_builds, ...withoutKey } = defaults.adapter.commands;
  assert.doesNotThrow(() => check(withoutKey));
  assert.doesNotThrow(() => check({ ...defaults.adapter.commands, smoke_builds: [["node", "tools/build-desktop.mjs", "--debug"]] }));
  for (const bad of ["node tools/build.mjs", [[]], [["node", 1]]]) {
    assert.throws(() => check({ ...defaults.adapter.commands, smoke_builds: bad }), /adapter\.commands\.smoke_builds/, JSON.stringify(bad));
  }
});

test("F50 a script named in adapter.commands.smoke_builds must exist, as for the other adapter argv", () => {
  const p = makeTempProject({ git: false, overlay: smokeOverlay([["node", "tools/missing-build.mjs"]]) });
  const { findings } = lintProject(p.root, { all: false });
  assert.ok(findings.some((f) => f.level === "fail" && /adapter\.commands\.smoke_builds\[0\]: script tools\/missing-build\.mjs does not exist/.test(f.msg)), JSON.stringify(findings));
});

test("F50 ph gsd check smoke runs nothing unless a target is declared, and reports every failing target with its output", async () => {
  const none = await gsd(project({ files: FILES }), ["check", "smoke"]);
  assert.deepEqual([none.code, none.json.status, none.json.builds], [0, "none", []]);

  const passed = await gsd(project({ files: FILES, overlay: smokeOverlay([["node", "tools/ok.mjs"]]) }), ["check", "smoke"]);
  assert.deepEqual([passed.code, passed.json.status], [0, "passed"]);
  assert.deepEqual(passed.json.builds, [{ argv: ["node", "tools/ok.mjs"], status: "passed" }]);

  // Every target runs, so the owner sees the missing component and the missing command at once.
  const failing = await gsd(project({ files: FILES, overlay: smokeOverlay([["node", "tools/ok.mjs"], ["node", "tools/bad.mjs"], ["no-such-build-f50"]]) }), ["check", "smoke"]);
  assert.deepEqual([failing.code, failing.json.status], [1, "failed"]);
  assert.deepEqual(failing.json.builds.map((b) => b.status), ["passed", "failed", "unresolvable"]);
  assert.match(failing.json.builds[1].output, /C1083: cannot open include file: atlstr\.h/);
  assert.match(failing.json.reason, /node tools\/bad\.mjs: build exited 1/);
  assert.match(failing.json.reason, /no-such-build-f50: build could not run/);

  const slow = await gsd(project({ files: FILES, overlay: smokeOverlay([["node", "tools/slow.mjs"]], { build_timeout_s: 1 }) }), ["check", "smoke"]);
  assert.deepEqual([slow.code, slow.json.status], [69, "unresolvable"]);
  assert.match(slow.json.reason, /timed out after 1s/);
});

test("F50 gsd-plan stops needs-owner at stage Smoke build before any planner runs, with the failing builds", async () => {
  const w = makeWorld({ overlay: smokeOverlay([["node", "tools/bad.mjs"]]) });
  w.gsd.on("check smoke", () => ({ code: 1, json: { status: "failed", reason: "node tools/bad.mjs: build exited 1", builds: [{ argv: ["node", "tools/bad.mjs"], status: "failed", reason: "build exited 1", output: "C1083" }] } }));
  const responder = plannerResponder(w);
  let agentCalls = 0;
  const agent = (...args) => {
    agentCalls++;
    return responder(...args);
  };
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Smoke build"]);
  assert.equal(r.result.reason, "node tools/bad.mjs: build exited 1");
  assert.deepEqual(r.result.builds.map((b) => [b.argv.join(" "), b.status, b.output]), [["node tools/bad.mjs", "failed", "C1083"]]);
  assert.ok(r.result.options.length >= 2);
  assert.deepEqual(w.gsd.callsOf("check smoke")[0].argv, ["check", "smoke"]);
  assert.equal(agentCalls, 0);
  assert.equal(w.gsd.callsOf("handoff").length, 0);
  assert.ok(r.logs.includes("phase Smoke build"));
});

test("F50 gsd-plan runs the smoke builds only with a declared target, and a passing build plans as before", async () => {
  const unset = makeWorld();
  const quiet = await runScript("gsd-plan", { root: unset.root, args: { phaseDir: PHASE_DIR }, gsd: unset.gsd, agent: plannerResponder(unset) });
  assert.equal(quiet.result.status, "planned");
  assert.equal(unset.gsd.callsOf("check smoke").length, 0);
  assert.ok(!quiet.logs.includes("phase Smoke build"));

  const w = makeWorld({ overlay: smokeOverlay([["node", "tools/ok.mjs"]]) });
  w.gsd.on("check smoke", () => ({ status: "passed", builds: [{ argv: ["node", "tools/ok.mjs"], status: "passed" }] }));
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: plannerResponder(w) });
  assert.equal(r.result.status, "planned");
  assert.equal(w.gsd.callsOf("handoff").length, 1);
  assert.ok(r.logs.includes("phase Smoke build") && r.logs.includes("phase Outline"));
  assert.match(fs.readFileSync(path.join(SHIP_DIR, ".agents", "workflows", "gsd-plan.js"), "utf8").slice(0, 800), /\{ title: "Smoke build" \}/);
});
