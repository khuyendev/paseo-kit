// Kit feedback #92 (V2): check-weakening counts skip markers fairly. F1 a skip marker counts only against a baseline the file
// had: a new test file has none to weaken, while a test moved out of a base file and skipped in a new one still counts. F2
// `adapter.checks.skip_guards` names environment-guard expressions; a marker on a line holding one is no skip (a guard that is
// itself a skip marker is ignored with a note). F3 the weakening, the gate's Checks stop and its log name each counted marker's
// line.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadConfig, loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/03-api";
const NODE = process.execPath;
const GUARD = "TestDaemon.skipReasonIfUnavailable()";
const BASE = "import 'package:test/test.dart';\n\nvoid main() {\n  test('parses empty', () {\n    expect(parse(''), isEmpty);\n  });\n}\n";
const PROBE = `import 'package:test/test.dart';\n\nvoid main() {\n  test('probe answers', skip: ${GUARD}, () async {\n    expect(await probe(), isTrue);\n  });\n}\n`;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const check = async (p) => (await flow(p.root, ["check-weakening", PD])).json;
const kinds = (r) => r.weakened.map((w) => `${w.path} ${w.kind}`);
const sample = (overlay = {}, files = {}) => makeTempProject({ files: { "test/parser_test.dart": BASE, ...files }, overlay });

test("V2 F1 a new test file has no baseline: its skip markers, guards or not, are no weakening", async () => {
  const p = sample();
  p.write("test/integration/connection_probe_test.dart", PROBE);
  p.write("test/flaky_test.dart", "import 'package:test/test.dart';\n\nvoid main() {\n  test('x', skip: 'needs a device', () {\n    expect(1, 1);\n  });\n}\n");
  const r = await check(p);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual([...r.compared].sort(), ["test/flaky_test.dart", "test/integration/connection_probe_test.dart"]);
  // Staged (added in the index) is new as well.
  p.git("add", "-A");
  assert.equal((await check(p)).status, "ok");
  // Once the file is in the base, a skip added to it counts.
  p.git("commit", "-qm", "probe");
  p.write("test/flaky_test.dart", p.read("test/flaky_test.dart").replace("  test('x', skip", "  test('y', skip: 'later', () {\n    expect(2, 2);\n  });\n  test('x', skip"));
  assert.deepEqual(kinds(await check(p)), ["test/flaky_test.dart skips-added"]);
});

test("V2 F1 a test moved out of a base file into a new file and skipped there still counts", async () => {
  const p = sample();
  p.write("test/parser_test.dart", "import 'package:test/test.dart';\n\nvoid main() {\n}\n");
  p.write("test/parser_empty_test.dart", "import 'package:test/test.dart';\n\nvoid main() {\n  test('parses empty', skip: 'flaky', () {\n    expect(parse(''), isEmpty);\n  });\n}\n");
  const r = await check(p);
  assert.deepEqual(kinds(r), ["test/parser_empty_test.dart skips-added"]);
  assert.deepEqual(r.weakened[0].markers, [{ line: 4, text: "test('parses empty', skip: 'flaky', () {" }]);
});

test("V2 F2 adapter.checks.skip_guards: a marker on a line holding a guard is no skip, on either side; other skips still count", async () => {
  const added = (p, line) => p.write("test/parser_test.dart", BASE.replace("}\n", `  ${line}\n    expect(await probe(), isTrue);\n  });\n}\n`));
  const plain = sample();
  added(plain, `test('probe', skip: ${GUARD}, () async {`);
  assert.deepEqual(kinds(await check(plain)), ["test/parser_test.dart skips-added"], "without the guard named it is a skip");

  const guarded = sample({ adapter: { checks: { skip_guards: [GUARD] } } });
  added(guarded, `test('probe', skip: ${GUARD}, () async {`);
  assert.equal((await check(guarded)).status, "ok");
  const spaced = sample({ adapter: { checks: { skip_guards: [GUARD] } } });
  added(spaced, "test('probe', skip: TestDaemon.skipReasonIfUnavailable( ), () async {");
  assert.equal((await check(spaced)).status, "ok", "whitespace inside the expression does not matter");
  const real = sample({ adapter: { checks: { skip_guards: [GUARD] } } });
  added(real, "test('probe', skip: 'flaky on CI', () async {");
  assert.deepEqual(kinds(await check(real)), ["test/parser_test.dart skips-added"]);

  // A guarded marker that turns into a real skip is one more skip.
  const was = sample({ adapter: { checks: { skip_guards: [GUARD] } } }, { "test/probe_test.dart": PROBE });
  was.write("test/probe_test.dart", PROBE.replace(`skip: ${GUARD}`, "skip: 'off for now'"));
  assert.deepEqual(kinds(await check(was)), ["test/probe_test.dart skips-added"]);

  // Python: a skipif whose condition is the guard.
  const py = makeTempProject({ files: { "tests/test_probe.py": "def test_a():\n    assert 1 == 1\n" }, overlay: { adapter: { checks: { skip_guards: ["docker_available()"] } } } });
  py.write("tests/test_probe.py", "import pytest\n\ndef test_a():\n    assert 1 == 1\n\n@pytest.mark.skipif(not docker_available(), reason=\"no docker\")\ndef test_b():\n    assert probe()\n");
  assert.equal((await check(py)).status, "ok");
});

test("V2 F2 a guard that is itself a skip marker or blank is ignored with a note; the schema takes non-empty strings only", async () => {
  const p = sample({ adapter: { checks: { skip_guards: ["skip: 'flaky", "  "] } } });
  p.write("test/parser_test.dart", BASE.replace("test('parses empty', () {", "test('parses empty', skip: 'flaky on CI', () {"));
  const r = await check(p);
  assert.deepEqual(kinds(r), ["test/parser_test.dart skips-added"]);
  assert.ok(r.notes.some((n) => n === "adapter.checks.skip_guards \"skip: 'flaky\" is ignored for dart files: it holds a skip marker itself"), JSON.stringify(r.notes));
  assert.ok(r.notes.some((n) => n === "adapter.checks.skip_guards \"  \" is ignored: it is blank"), JSON.stringify(r.notes));

  const s = setup();
  s.project.writeJson(".agents/harness.config.json", { adapter: { checks: { skip_guards: [""] } } });
  assert.match(String(loadConfigLenient(s.root).error?.message), /adapter\.checks\.skip_guards\[0\]/);
  s.project.writeJson(".agents/harness.config.json", { adapter: { checks: { skip_guards: "x" } } });
  assert.match(String(loadConfigLenient(s.root).error?.message), /adapter\.checks\.skip_guards/);
  s.project.writeJson(".agents/harness.config.json", { adapter: { checks: { skip_guards: [GUARD] } } });
  assert.equal(loadConfigLenient(s.root).error, null);
  // The key is not in the kit defaults, so the gate configuration hash of a phase baseline does not move on a kit update.
  assert.equal(Object.hasOwn(loadConfig(sample().root).adapter.checks, "skip_guards"), false);
});

test("V2 F3 the weakening, the gate's Checks stop and the step log name the line of each added marker", async () => {
  const p = sample({ adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } }, { "test/two_test.dart": BASE.replace("parses empty", "a").replace("}\n", "  test('b', skip: 'old', () {\n    expect(1, 1);\n  });\n}\n") });
  p.write("test/parser_test.dart", BASE.replace("test('parses empty', () {", "test('parses empty', skip: 'flaky on CI', () {"));
  p.write("test/two_test.dart", p.read("test/two_test.dart").replace("test('a', () {", "test('a', skip: 'old', () {"));
  const r = await check(p);
  assert.deepEqual(r.weakened.map((w) => [w.path, w.kind, w.detail, w.markers]), [
    ["test/parser_test.dart", "skips-added", "skip markers 0 -> 1 at line 4: test('parses empty', skip: 'flaky on CI', () {", [{ line: 4, text: "test('parses empty', skip: 'flaky on CI', () {" }]],
    // The base had a marker on another line: only the new one is named.
    ["test/two_test.dart", "skips-added", "skip markers 1 -> 2 at line 4: test('a', skip: 'old', () {", [{ line: 4, text: "test('a', skip: 'old', () {" }]],
  ]);
  const g = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:test/"], verify: [] }] });
  const f = g.json.failures.find((x) => x.step === "checks");
  assert.match(f.needsOwner.reason, /test\/parser_test\.dart \(skips-added: skip markers 0 -> 1 at line 4: test\('parses empty', skip: 'flaky on CI', \(\) \{\)/);
  assert.equal(f.needsOwner.options[0].startsWith("ph gsd allow 3 --path test/parser_test.dart "), true);
  assert.deepEqual(g.json.checks.weakened[0].markers, [{ line: 4, text: "test('parses empty', skip: 'flaky on CI', () {" }]);
  assert.match(p.read(p.readJson(g.json.evidence).steps.find((s) => s.name === "checks").log), /at line 4: test\('parses empty'/);

  const many = sample();
  many.write("test/parser_test.dart", BASE.replace("}\n", `${Array.from({ length: 7 }, (_, i) => `  test('s${i}', skip: 'x${i}', () {\n    expect(${i}, ${i});\n  });\n`).join("")}}\n`));
  const m = await check(many);
  assert.equal(m.weakened[0].markers.length, 7);
  assert.match(m.weakened[0].detail, /^skip markers 0 -> 7 at line 7: .*; line 19: test\('s4', skip: 'x4', \(\) \{ and 2 more$/);
});
