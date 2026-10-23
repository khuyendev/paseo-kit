// Kit feedback #101 F1 (V5B): `ph gsd outline check` lists the existing test files the manifest's verify commands run, with the plans
// of the phase that own each. A test no plan owns (an earlier phase's) is an error: the outline assigns it to the plan that
// changes the behaviour it asserts, or drops it from the command; `--inherited-tests warn` (a reused outline) only warns.
import assert from "node:assert/strict";
import test from "node:test";
import { gsd, P1, project } from "../gsd-core/fixture.mjs";

const DART = "import 'package:test/test.dart';\n\nvoid main() {\n  test('restores', () {\n    expect(1, 1);\n  });\n}\n";
const OUTLINE = "| Plan ID | Objective | Wave | Depends | Requirements |\n| --- | --- | --- | --- | --- |\n| 01-01 | core | 1 | - | CORE-01 |\n| 01-02 | stop | 2 | 01-01 | CORE-02 |\n\n## OUTLINE COMPLETE\n";
const RUN = "cmd: node tools/run.mjs test";
const manifest = (owns1 = ["Path:lib/a.dart"]) => JSON.stringify({ phase: "1", plans: [
  { id: "01-01", owns: owns1, requirements: ["CORE-01"], tracer: { is: true, outcome: "runs" }, verify: [`${RUN} test/app/route_restore_test.dart:138`, "build"] },
  { id: "01-02", owns: ["Path:lib/b.dart", "Path:test/features/projects/"], requirements: ["CORE-02"], verify: [`${RUN} test/features/projects test/app/`] },
] });
const fixture = (owns1) => project({ files: {
  [`${P1}/01-PLAN-OUTLINE.md`]: OUTLINE, [`${P1}/01-PLAN-OUTLINE.manifest.json`]: manifest(owns1), "tools/run.mjs": "process.exit(0);\n",
  "test/app/route_restore_test.dart": DART, "test/app/helpers.dart": "Widget wrap(Widget w) => w;\n", "test/features/projects/projects_test.dart": DART,
} });
const inherited = (r) => [...r.json.errors, ...r.json.warnings].filter((m) => m.includes("an inherited test"));

test("V5B outline check: a verify command that runs an existing test no plan owns is an error naming the plan and command", async () => {
  const r = await gsd(fixture(), ["outline", "check", "1"]);
  assert.deepEqual(r.json.inheritedTests, [
    { file: "test/app/route_restore_test.dart", plans: ["01-01", "01-02"], owners: [] },
    { file: "test/features/projects/projects_test.dart", plans: ["01-02"], owners: ["01-02"] },
  ], "the runner script and a helper without a test are no tests");
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.errors.filter((m) => m.includes("an inherited test")), [
    "01-01: verify runs test/app/route_restore_test.dart, which no plan of this phase owns (an inherited test): assign it (owns) to the plan that changes the behaviour it asserts, or drop it from the command",
    "01-02: verify runs test/app (1 test file: test/app/route_restore_test.dart), which no plan of this phase owns (an inherited test): assign it (owns) to the plan that changes the behaviour it asserts, or drop it from the command",
  ]);
});

test("V5B outline check: --inherited-tests warn only warns; a test the outline assigns to a plan is no problem", async () => {
  const warned = await gsd(fixture(), ["outline", "check", "1", "--inherited-tests", "warn"]);
  assert.equal(warned.json.errors.filter((m) => m.includes("an inherited test")).length, 0);
  assert.equal(warned.json.warnings.filter((m) => m.includes("an inherited test")).length, 2);
  assert.equal((await gsd(fixture(), ["outline", "check", "1", "--inherited-tests", "maybe"])).code, 1);
  const owned = await gsd(fixture(["Path:lib/a.dart", "Path:test/app/route_restore_test.dart"]), ["outline", "check", "1"]);
  assert.deepEqual(inherited(owned), []);
  assert.deepEqual(owned.json.inheritedTests[0], { file: "test/app/route_restore_test.dart", plans: ["01-01", "01-02"], owners: ["01-01"] });
});
