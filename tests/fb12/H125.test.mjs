// Kit feedback 125 F1-F3 and WildEraV6 12: which obligations a wave gate runs, and when the suite report is enough.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadConfig, loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { gateConfigHash } from "../../ship/.agents/harness/gsd/allow.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/05-timeline";
const NODE = process.execPath;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const kind = (prefix, runner, extra = {}) => ({ prefix, parser: null, resolver: null, runner, evidence_parser: null, exit_code_sufficient: true, ...extra });
const commands = (verify, test, extra = {}) => ({ build: [NODE, "-e", "process.exit(0)"], test, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify, ...extra });
const adapter = (verify, vocab, test, extra = {}) => ({ adapter: { commands: commands(verify, test), verify_vocabulary: vocab, ...extra.adapter }, ...extra.rest });

const RUN = `import fs from "node:fs";
const arg = process.argv[2] ?? "";
fs.appendFileSync("runs.txt", arg + "\\n");
if (arg === "all") {
  if (fs.existsSync("wanted.json")) fs.copyFileSync("wanted.json", "report.json");
  if (fs.existsSync("suite-crash.txt")) { console.error("Segmentation fault"); process.exit(1); }
}
if (arg !== "all" && fs.existsSync("ob-fail.txt")) { console.error("FAIL " + arg); process.exit(1); }
`;
const JUNIT = `import fs from "node:fs";
const arg = process.argv[2] ?? "";
fs.appendFileSync("runs.txt", arg + "\\n");
if (arg !== "all") process.exit(0);
fs.writeFileSync("report.xml", \`<?xml version="1.0"?>
<testsuite name="WildEra">
  <testcase classname="WildEra.Foo" name="Bar" file="test/foo.cpp"/>
  <testcase classname="WildEra.Foo" name="Baz"><failure message="Expected length 2000">nope</failure></testcase>
  <testcase classname="WildEra.Foo" name="Skip"><skipped/></testcase>
</testsuite>\`);
`;
const BENCH = `console.log("p90 12.5 ms");
console.log("budget 8");
`;
const FAIL = `console.error("error test/timeline_scroll_stream_test.dart:12: Expected length 2000, actual 50");
process.exit(1);
`;
const DRIVE = `import fs from "node:fs";
fs.appendFileSync("runs.txt", "drive " + process.argv.slice(2).join(" ") + "\\n");
`;

function handoff(p, waves) {
  waves.forEach((w, i) => {
    p.writeJson(`${PD}/handoff/w${i + 1}.args.json`, {
      wave: i + 1,
      waveId: w.id,
      tasks: w.tasks.map((t) => ({ plan: t.plan, owns: t.owns, verify: t.verify ?? [] })),
    });
  });
}
const names = (ev, p) => p.readJson(ev).steps.map((s) => s.name);
const note = (r, re) => assert.ok((r.json.notes ?? []).some((n) => re.test(n)), JSON.stringify(r.json.notes));

test("H125 F1 a wave gate runs the cheapest intersecting earlier obligation and lists the one over the cap", async () => {
  const verify = {
    cheap: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 5 },
    dear: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 500 },
  };
  const vocab = { cheap: kind("cheap:", "cheap"), dear: kind("dear:", "dear") };
  const p = makeTempProject({
    files: { "lib/timeline/page.dart": "old\n" },
    overlay: { ...adapter(verify, vocab, [NODE, "-e", "process.exit(0)"]), gsd: { wave_regression_cap: 1 } },
  });
  handoff(p, [
    { id: "w1", tasks: [{ plan: "05-01", owns: ["Path:lib/timeline/"], verify: [{ task: "1", kind: "cheap", command: "cheap: ok" }, { task: "2", kind: "dear", command: "dear: slow" }] }] },
    { id: "w2", tasks: [{ plan: "05-07", owns: ["Path:lib/timeline/page.dart"], verify: [] }] },
  ]);
  p.write("lib/timeline/page.dart", "paged\n");
  const r = await flow(p.root, ["gate", PD], { waveId: "w2", plans: [{ id: "05-07", owns: ["Path:lib/timeline/page.dart"], verify: [] }] });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  const ev = p.readJson(r.json.evidence);
  assert.ok(names(r.json.evidence, p).includes("05-01-1-cheap"), JSON.stringify(ev.steps.map((s) => s.name)));
  assert.equal(ev.steps.some((s) => s.name === "05-01-2-dear"), false);
  const cheap = ev.steps.find((s) => s.name === "05-01-1-cheap");
  assert.deepEqual(cheap.regression, { of: "05-01", wave: "w2", plans: ["05-07"], files: ["lib/timeline/page.dart"] });
  assert.deepEqual(r.json.skippedObligations, [{ plan: "05-01", step: "05-01-2-dear", command: "dear: slow", cost: 500, reason: "cap" }]);
  note(r, /earlier obligation 05-01-2-dear skipped \(cost 500s, cap 1\)/);
  note(r, /05-01-1-cheap: regression of 05-01 on 05-07 \(wave w2\) via lib\/timeline\/page\.dart/);
});

test("H125 F1 the default cap is 3 and a wave with no intersecting file lists that instead of running earlier obligations", async () => {
  const verify = {
    a: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 10 },
    b: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 20 },
    c: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 30 },
    d: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 40 },
    own: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 5 },
  };
  const vocab = { a: kind("a:", "a"), b: kind("b:", "b"), c: kind("c:", "c"), d: kind("d:", "d"), own: kind("own:", "own") };
  const earlier = ["a", "b", "c", "d"].map((k, i) => ({ task: String(i + 1), kind: k, command: `${k}: x` }));
  const p = makeTempProject({
    files: { "lib/timeline/page.dart": "old\n", "lib/other/x.js": "old\n" },
    overlay: adapter(verify, vocab, [NODE, "-e", "process.exit(0)"]),
  });
  handoff(p, [
    { id: "w1", tasks: [{ plan: "05-01", owns: ["Path:lib/timeline/"], verify: earlier }] },
    { id: "w2", tasks: [{ plan: "05-07", owns: ["Path:lib/timeline/", "Path:lib/other/"], verify: [{ task: "1", kind: "own", command: "own: mine" }] }] },
  ]);
  p.write("lib/timeline/page.dart", "paged\n");
  const wave = { id: "05-07", owns: ["Path:lib/timeline/", "Path:lib/other/"], verify: [{ task: "1", kind: "own", command: "own: mine" }] };
  const r = await flow(p.root, ["gate", PD], { waveId: "w2", plans: [wave] });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  const got = names(r.json.evidence, p);
  for (const n of ["05-07-1-own", "05-01-1-a", "05-01-2-b", "05-01-3-c"]) assert.ok(got.includes(n), got.join(","));
  assert.equal(got.includes("05-01-4-d"), false);
  assert.equal(r.json.skippedObligations.length, 1);
  assert.equal(r.json.skippedObligations[0].step, "05-01-4-d");
  assert.equal(r.json.skippedObligations[0].cost, 40);
  p.write("lib/timeline/page.dart", "old\n");
  p.write("lib/other/x.js", "only other\n");
  const none = await flow(p.root, ["gate", PD], { waveId: "w2", plans: [wave] });
  assert.equal(names(none.json.evidence, p).some((n) => n.startsWith("05-01-")), false, JSON.stringify(names(none.json.evidence, p)));
  note(none, /no earlier obligation intersects this wave's diff/);
});

test("H125 F1 a verify target that is a changed file runs even when the earlier plan's owns do not, and cap 0 runs only this wave", async () => {
  const verify = { bench: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 5 }, own: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 5 } };
  const vocab = { bench: kind("bench:", "bench"), own: kind("own:", "own") };
  const p = makeTempProject({
    files: { "bench/scroll_profile.dart": "old\n", "lib/old/a.js": "a\n" },
    overlay: adapter(verify, vocab, [NODE, "-e", "process.exit(0)"]),
  });
  const ob = { task: "1", kind: "bench", command: "bench: bench/scroll_profile.dart", target: "bench/scroll_profile.dart" };
  handoff(p, [
    { id: "w1", tasks: [{ plan: "05-01", owns: ["Path:lib/old/"], verify: [ob] }] },
    { id: "w2", tasks: [{ plan: "05-07", owns: ["Path:bench/scroll_profile.dart"], verify: [] }] },
  ]);
  p.write("bench/scroll_profile.dart", "new\n");
  const r = await flow(p.root, ["gate", PD], { waveId: "w2", plans: [{ id: "05-07", owns: ["Path:bench/scroll_profile.dart"], verify: [] }] });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  const step = p.readJson(r.json.evidence).steps.find((s) => s.name === "05-01-1-bench");
  assert.ok(step, "target intersection did not run");
  assert.deepEqual(step.regression.files, ["bench/scroll_profile.dart"]);
  assert.deepEqual(step.regression.plans, ["05-07"]);
  const capped = makeTempProject({
    files: { "lib/timeline/page.dart": "old\n" },
    overlay: { ...adapter(verify, vocab, [NODE, "-e", "process.exit(0)"]), gsd: { wave_regression_cap: 0 } },
  });
  handoff(capped, [
    { id: "w1", tasks: [{ plan: "05-01", owns: ["Path:lib/timeline/"], verify: [ob] }] },
    { id: "w2", tasks: [{ plan: "05-07", owns: ["Path:lib/timeline/"], verify: [{ task: "1", kind: "own", command: "own: mine" }] }] },
  ]);
  capped.write("lib/timeline/page.dart", "paged\n");
  const z = await flow(capped.root, ["gate", PD], { waveId: "w2", plans: [{ id: "05-07", owns: ["Path:lib/timeline/"], verify: [{ task: "1", kind: "own", command: "own: mine" }] }] });
  assert.equal(z.json.green, true, JSON.stringify(z.json.failures));
  assert.ok(names(z.json.evidence, capped).includes("05-07-1-own"));
  assert.equal(names(z.json.evidence, capped).includes("05-01-1-bench"), false);
  assert.equal(z.json.skippedObligations[0].reason, "cap");
  assert.equal(z.json.skippedObligations[0].plan, "05-01");
});

test("H125 F1 suite false does not add earlier obligations", async () => {
  const verify = { cheap: { argv: [NODE, "-e", "process.exit(0)"], timeout_s: 5 } };
  const p = makeTempProject({
    files: { "lib/timeline/page.dart": "old\n" },
    overlay: adapter(verify, { cheap: kind("cheap:", "cheap") }, [NODE, "-e", "process.exit(0)"]),
  });
  handoff(p, [
    { id: "w1", tasks: [{ plan: "05-01", owns: ["Path:lib/timeline/"], verify: [{ task: "1", kind: "cheap", command: "cheap: ok" }] }] },
    { id: "w2", tasks: [{ plan: "05-07", owns: ["Path:lib/timeline/page.dart"], verify: [] }] },
  ]);
  p.write("lib/timeline/page.dart", "paged\n");
  const r = await flow(p.root, ["gate", PD], { waveId: "w2", plans: [{ id: "05-07", owns: ["Path:lib/timeline/page.dart"], verify: [] }], suite: false });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  assert.equal(names(r.json.evidence, p).includes("05-01-1-cheap"), false);
  note(r, /suite false: earlier obligations not added \(05-01 cheap\)/);
});

test("H125 F2 a failing earlier obligation names the wave plan whose diff touched its files and is not an unowned test", async () => {
  const verify = { bench: { argv: [NODE, "tools/fail.mjs"], timeout_s: 15 } };
  const p = makeTempProject({
    files: { "lib/timeline/page.dart": "old\n", "test/timeline_scroll_stream_test.dart": "test('s', () {});\n", "tools/fail.mjs": FAIL },
    overlay: adapter(verify, { bench: kind("bench:", "bench") }, [NODE, "-e", "process.exit(0)"]),
  });
  const ob = { task: "1", kind: "bench", command: "bench: timeline_scroll_stream_test", target: "timeline_scroll_stream_test" };
  handoff(p, [
    { id: "w1", tasks: [{ plan: "05-01", owns: ["Path:lib/timeline/", "Path:test/"], verify: [ob] }] },
    { id: "w2", tasks: [{ plan: "05-07", owns: ["Path:lib/timeline/page.dart"], verify: [] }] },
  ]);
  p.write("lib/timeline/page.dart", "paged\n");
  const r = await flow(p.root, ["gate", PD], { waveId: "w2", plans: [{ id: "05-07", owns: ["Path:lib/timeline/page.dart"], verify: [] }] });
  assert.equal(r.json.green, false);
  const f = r.json.failures.find((x) => x.step === "05-01-1-bench");
  assert.ok(f, JSON.stringify(r.json.failures));
  assert.equal(f.plan, "05-07");
  assert.deepEqual(f.regression, { of: "05-01", wave: "w2", plans: ["05-07"], files: ["lib/timeline/page.dart"] });
  assert.deepEqual(r.json.byPlan["05-07"].map((x) => x.step), ["05-01-1-bench"]);
  assert.equal(r.json.byPlan["05-01"], undefined);
  assert.equal((r.json.unownedTests ?? []).some((t) => t.file.includes("timeline_scroll")), false, JSON.stringify(r.json.unownedTests));
  assert.match(p.read(p.readJson(r.json.evidence).steps.find((s) => s.name === "05-01-1-bench").log), /regression failure: wave w2 plan 05-07 touched lib\/timeline\/page\.dart/);
});

test("H125 F3 an obligation records adapter and vocabulary metrics", async () => {
  const verify = { bench: { argv: [NODE, "tools/bench.mjs"], timeout_s: 15 } };
  const vocab = { bench: kind("bench:", "bench", { metrics: ["budget\\s+(?<value>\\d+)"] }) };
  const p = makeTempProject({
    files: { "tools/bench.mjs": BENCH },
    overlay: adapter(verify, vocab, [NODE, "-e", "process.exit(0)"], { adapter: { metrics: ["p90\\s+(?<value>[0-9.]+)"] } }),
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "05-07", owns: ["Path:lib/"], verify: [{ task: "1", kind: "bench", command: "bench: numbers" }] }] });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  const step = p.readJson(r.json.evidence).steps.find((s) => s.name === "05-07-1-bench");
  assert.deepEqual(step.metrics, [{ name: "p90", value: 12.5, raw: "12.5" }, { name: "budget", value: 8, raw: "8" }]);
  assert.deepEqual(r.json.metrics, [{ step: "05-07-1-bench", plan: "05-07", name: "p90", value: 12.5, raw: "12.5" }, { step: "05-07-1-bench", plan: "05-07", name: "budget", value: 8, raw: "8" }]);
});

test("H125 keys are optional and do not move the gate hash; a bad regex or cap is refused", () => {
  const plain = makeTempProject();
  assert.equal(Object.hasOwn(loadConfig(plain.root).adapter, "metrics"), false);
  assert.equal(Object.hasOwn(loadConfig(plain.root).adapter, "test_report"), false);
  assert.equal(Object.hasOwn(loadConfig(plain.root).gsd, "wave_regression_cap"), false);
  const named = makeTempProject({ overlay: { adapter: { metrics: ["p90\\s+(?<value>[0-9.]+)"], test_report: { path: "report.json", format: "json" } }, gsd: { wave_regression_cap: 3 } } });
  assert.equal(gateConfigHash(loadConfig(plain.root)), gateConfigHash(loadConfig(named.root)));
  const bad = makeTempProject({ overlay: { adapter: { metrics: ["("] } } });
  assert.throws(() => loadConfig(bad.root), /adapter\.metrics\[0\].*invalid regular expression/);
  const vocab = makeTempProject({ overlay: { adapter: { verify_vocabulary: { bench: { ...kind("bench:", null), metrics: ["("] } }, commands: commands({}, [NODE, "-e", "process.exit(0)"]) } } });
  assert.throws(() => loadConfig(vocab.root), /adapter\.verify_vocabulary\.bench\.metrics\[0\].*invalid regular expression/);
  const cap = makeTempProject({ overlay: { gsd: { wave_regression_cap: -1 } } });
  assert.throws(() => loadConfig(cap.root), /gsd\.wave_regression_cap/);
  const empty = makeTempProject({ overlay: { adapter: { metrics: [""] } } });
  assert.match(String(loadConfigLenient(empty.root).error?.message), /adapter\.metrics\[0\]/);
});

function reportProject(files, report = { path: "report.json", format: "json" }, testArgv) {
  const verify = { unit: { argv: [NODE, "tools/run.mjs", "{argument}"], timeout_s: 30 } };
  const vocab = { test: kind("test:", "unit") };
  return makeTempProject({
    files: { "tools/run.mjs": RUN, ...files },
    overlay: adapter(verify, vocab, testArgv ?? [NODE, "tools/run.mjs", "all"], { adapter: { test_report: report } }),
  });
}
const ob = (task, arg) => ({ task, kind: "test", command: `test: ${arg}`, target: arg });

test("H125 W12 a covered test is taken from the suite report and is not started again", async () => {
  const p = reportProject({ "wanted.json": JSON.stringify({ "suite-a": "passed", "suite-b": "Success" }) });
  const r = await flow(p.root, ["gate", PD], { waveId: "batch", plans: [{ id: "05-07", owns: ["Path:test/"], verify: [ob("1", "suite-a"), ob("2", "suite-b")] }] });
  assert.equal(r.json.green, true, JSON.stringify({ failures: r.json.failures, notes: r.json.notes }));
  const ev = p.readJson(r.json.evidence);
  for (const name of ["05-07-1-test", "05-07-2-test"]) {
    const s = ev.steps.find((x) => x.name === name);
    assert.equal(s.outcome, "passed");
    assert.ok(s.fromSuiteReport.tests.includes(name.endsWith("2-test") ? "suite-b" : "suite-a"), JSON.stringify(s.fromSuiteReport));
    assert.match(p.read(s.log), /^from suite report/m);
  }
  assert.deepEqual(p.read("runs.txt").trim().split(/\r?\n/), ["all"]);
  note(r, /05-07-1-test: from suite report \(suite-a\)/);
});

test("H125 W12 a report that does not list the obligation's test makes it run", async () => {
  const p = reportProject({ "wanted.json": JSON.stringify({ tests: [{ name: "suite-b", status: "passed" }] }) });
  const r = await flow(p.root, ["gate", PD], { waveId: "batch", plans: [{ id: "05-07", owns: ["Path:test/"], verify: [ob("1", "suite-a")] }] });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  const s = p.readJson(r.json.evidence).steps.find((x) => x.name === "05-07-1-test");
  assert.equal(s.fromSuiteReport, undefined);
  assert.deepEqual(p.read("runs.txt").trim().split(/\r?\n/).sort(), ["all", "suite-a"]);
  note(r, /05-07-1-test: suite report does not list suite-a; running/);
});

test("H125 W12 a listed failure fails the obligation without starting it again", async () => {
  const p = reportProject({ "wanted.json": JSON.stringify({ tests: [{ name: "suite-a", status: "failed", message: "Expected length 2000, actual 50" }] }) });
  const r = await flow(p.root, ["gate", PD], { waveId: "batch", plans: [{ id: "05-07", owns: ["Path:test/"], verify: [ob("1", "suite-a")] }] });
  assert.equal(r.json.green, false);
  const s = p.readJson(r.json.evidence).steps.find((x) => x.name === "05-07-1-test");
  assert.equal(s.outcome, "failed");
  assert.deepEqual(s.fromSuiteReport.tests, ["suite-a"]);
  assert.match(p.read(s.log), /from suite report/);
  assert.match(p.read(s.log), /Expected length 2000/);
  assert.deepEqual(p.read("runs.txt").trim().split(/\r?\n/), ["all"]);
  assert.equal(r.json.byPlan["05-07"].map((f) => f.step).includes("05-07-1-test"), true);
});

test("H125 W12 junit: a pass is reused, a failure and a skip fail, a missing name runs", async () => {
  const verify = { unit: { argv: [NODE, "tools/junit.mjs", "{argument}"], timeout_s: 30 } };
  const p = makeTempProject({
    files: { "tools/junit.mjs": JUNIT },
    overlay: adapter(verify, { test: kind("test:", "unit") }, [NODE, "tools/junit.mjs", "all"], { adapter: { test_report: { path: "report.xml", format: "junit" } } }),
  });
  const plans = [{ id: "05-07", owns: ["Path:test/"], verify: [ob("1", "WildEra.Foo.Bar"), ob("2", "WildEra.Foo.Baz"), ob("3", "WildEra.Foo.Skip"), ob("4", "WildEra.Other")] }];
  const r = await flow(p.root, ["gate", PD], { waveId: "batch", plans });
  assert.equal(r.json.green, false);
  const ev = p.readJson(r.json.evidence);
  const step = (n) => ev.steps.find((s) => s.name === n);
  assert.equal(step("05-07-1-test").outcome, "passed");
  assert.deepEqual(step("05-07-1-test").fromSuiteReport.tests, ["WildEra.Foo.Bar"]);
  assert.equal(step("05-07-2-test").outcome, "failed");
  assert.match(p.read(step("05-07-2-test").log), /Expected length 2000/);
  assert.equal(step("05-07-3-test").outcome, "failed");
  assert.match(p.read(step("05-07-3-test").log), /WildEra\.Foo\.Skip: missing/);
  assert.equal(step("05-07-4-test").fromSuiteReport, undefined);
  assert.equal(step("05-07-4-test").outcome, "passed");
  assert.deepEqual(p.read("runs.txt").trim().split(/\r?\n/).sort(), ["WildEra.Other", "all"]);
});

test("H125 W12 an argv that is not a pure test filter still runs, and so does an obligation the report does not cover because the file is absent or the suite crashed", async () => {
  const verify = {
    unit: { argv: [NODE, "tools/run.mjs", "{argument}"], timeout_s: 30 },
    drive: { argv: [NODE, "tools/drive.mjs", "--profile", "{argument}"], timeout_s: 30 },
  };
  const vocab = { test: kind("test:", "unit"), drive: kind("drive:", "drive") };
  const p = makeTempProject({
    files: { "tools/run.mjs": RUN, "tools/drive.mjs": DRIVE, "wanted.json": JSON.stringify({ bench: "passed", "suite-a": "passed" }) },
    overlay: adapter(verify, vocab, [NODE, "tools/run.mjs", "all"], { adapter: { test_report: { path: "report.json", format: "json" } } }),
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "batch", plans: [{ id: "05-07", owns: ["Path:test/"], verify: [{ task: "1", kind: "drive", command: "drive: bench", target: "bench" }] }] });
  assert.equal(r.json.green, true, JSON.stringify(r.json.failures));
  const s = p.readJson(r.json.evidence).steps.find((x) => x.name === "05-07-1-drive");
  assert.equal(s.fromSuiteReport, undefined);
  assert.match(p.read("runs.txt"), /drive --profile bench/);
  note(r, /05-07-1-drive: not a pure test filter; running/);
  const absent = reportProject({});
  const a = await flow(absent.root, ["gate", PD], { waveId: "batch", plans: [{ id: "05-07", owns: ["Path:test/"], verify: [ob("1", "suite-a")] }] });
  assert.equal(a.json.green, true, JSON.stringify(a.json.failures));
  assert.deepEqual(absent.read("runs.txt").trim().split(/\r?\n/).sort(), ["all", "suite-a"]);
  note(a, /suite report report\.json absent; test obligations run/);
  const crashed = reportProject({ "suite-crash.txt": "1", "wanted.json": JSON.stringify({ "suite-a": "passed" }) });
  const c = await flow(crashed.root, ["gate", PD], { waveId: "batch", plans: [{ id: "05-07", owns: ["Path:test/"], verify: [ob("1", "suite-a")] }] });
  assert.equal(c.json.green, false);
  assert.ok(c.json.crashed.some((line) => /test crashed: Segmentation fault/.test(line)), JSON.stringify(c.json.crashed));
  const ran = crashed.read("runs.txt").trim().split(/\r?\n/).sort();
  assert.deepEqual(ran, ["all", "suite-a"]);
  note(c, /suite report not used: the suite step crashed/);
  assert.equal(crashed.readJson(c.json.evidence).steps.find((x) => x.name === "05-07-1-test").fromSuiteReport, undefined);
});
