// Kit feedback #87 C1 (RC1): the check-weakening invariant inside every gate, its answers and its switch. A gate over a
// weakened test is red with a `checks` step that no fixer gets and whose failure names `ph gsd allow`; a plan's <check_changes>
// line or the owner's allow lets it pass; a change of the gate configuration since the phase baseline is a weakening that only
// an allow recording that configuration accepts; gsd-execute stops at stage Checks; doctor warns when the check is off.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { answerLines } from "../../ship/.agents/harness/lib/owner-answers.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { gsd, plan, project, workerEnv } from "../gsd-core/fixture.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { setup } from "../ph/setup.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/01-core";
const NODE = process.execPath;
const TEST = "test/parser_test.dart";
const DART = "import 'package:test/test.dart';\n\nvoid main() {\n  test('parses empty', () {\n    expect(parse(''), isEmpty);\n  });\n\n  test('parses one', () {\n    expect(parse('a').length, 1);\n  });\n}\n";
const commands = (test = [NODE, "-e", "process.exit(0)"]) => ({ build: [NODE, "-e", "process.exit(0)"], test, build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} });

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const gate = (p) => flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "01-01", owns: ["Path:test/", "Path:lib/"], verify: [] }] });
const fixture = (overlay = { adapter: { commands: commands() } }) => project({ files: { [TEST]: DART, "lib/parser.dart": "List<String> parse(String s) => [];\n" }, overlay });

test("RC1 a gate over a deleted test is red at stage Checks: no fixer gets it, the evidence fails, and the owner's allow turns it green", async () => {
  const p = fixture();
  const clean = await gate(p);
  assert.equal(clean.json.green, true, JSON.stringify(clean.json.failures));
  assert.equal(clean.json.checks.status, "ok");
  assert.equal(p.readJson(clean.json.evidence).steps.some((s) => s.name === "checks"), false, "nothing to judge: the evidence keeps its shape");
  p.write(TEST, `${DART}// a new helper comment\n`);
  assert.equal(p.readJson((await gate(p)).json.evidence).steps.find((s) => s.name === "checks").outcome, "passed");

  fs.rmSync(p.path(TEST));
  const red = await gate(p);
  assert.equal(red.json.green, false);
  assert.deepEqual(red.json.checks.weakened.map((w) => [w.path, w.kind]), [[TEST, "test-file-deleted"]]);
  const f = red.json.failures.find((x) => x.step === "checks");
  assert.equal(f.needsOwner.stage, "Checks");
  assert.match(f.needsOwner.reason, /test\/parser_test\.dart \(test-file-deleted: deleted: 2 test\(s\) removed \(parses empty, parses one\)\)/);
  assert.equal(f.needsOwner.options[0], `ph gsd allow 1 --path ${TEST} --reason "<why this is no weakening, or why it is accepted>", then rerun with the same args`);
  assert.deepEqual(f.files, []);
  assert.deepEqual(red.json.byPlan, {}, "a weakening goes to no fixer");
  assert.deepEqual(red.json.unplaced, []);
  const ev = p.readJson(red.json.evidence);
  assert.equal(ev.steps.find((s) => s.name === "checks").outcome, "failed");
  assert.match(p.read(ev.steps.find((s) => s.name === "checks").log), /ph gsd allow 1 --path test\/parser_test\.dart/);
  assert.equal((await flow(p.root, ["evidence-check", red.json.evidence])).json.status, "failed");

  assert.equal((await gsd(p, ["allow", "1", "--path", TEST, "--reason", "x"], { env: workerEnv() })).code, 1, "a worker cannot answer");
  assert.equal((await gsd(p, ["allow", "1", "--path", TEST])).code, 1, "a reason is required");
  assert.equal((await gsd(p, ["allow", "1", "--path", "test/**", "--reason", "x"])).code, 1, "one file, no glob");
  assert.equal((await gsd(p, ["allow", "1", "--path", "../x_test.dart", "--reason", "x"])).code, 1);
  const a = await gsd(p, ["allow", "1", "--path", "test\\parser_test.dart", "--reason", "the parser moved to the generated grammar; its tests live in tool/"]);
  assert.equal(a.code, 0, JSON.stringify(a.json));
  assert.equal(a.json.answered, "OA-1");
  assert.deepEqual(p.readJson(`${PD}/owner-answers.json`).map((x) => [x.id, x.kind, x.path]), [["OA-1", "allow", TEST]]);
  const green = await gate(p);
  assert.equal(green.json.green, true, JSON.stringify(green.json.failures));
  assert.equal(p.readJson(green.json.evidence).steps.find((s) => s.name === "checks").outcome, "passed");
  assert.deepEqual(green.json.checks.allowed.map((x) => [x.path, x.by, x.answer]), [[TEST, "owner", "OA-1"]]);
  assert.ok(green.json.notes.some((n) => /^checks: test\/parser_test\.dart test-file-deleted allowed by owner answer OA-1/.test(n)));
  assert.deepEqual(answerLines([{ kind: "allow" }, { kind: "halt" }]), ["owner answers 2: halt 1, allow 1"]);
});

test("RC1 a plan's <check_changes> line allows its path; verify plan-structure accepts it and refuses a malformed line or a glob", async () => {
  const block = (lines) => `\n<check_changes>\n${lines.join("\n")}\n</check_changes>\n`;
  const p = fixture();
  const good = plan({ owns: "[\"Path:test/\"]", files: "[test/parser_test.dart]" }).replace("<tasks>", `${block([`- ${TEST}: the empty-input case is covered by the new grammar tests`])}\n<tasks>`);
  p.write(`${PD}/01-01-PLAN.md`, good);
  const st = await gsd(p, ["verify", "plan-structure", "1"]);
  assert.equal(st.json.valid, true, JSON.stringify(st.json));
  assert.deepEqual(st.json.check_changes, [{ path: TEST, reason: "the empty-input case is covered by the new grammar tests" }]);
  p.write(TEST, DART.replace("  test('parses empty', () {\n    expect(parse(''), isEmpty);\n  });\n\n", ""));
  const r = await flow(p.root, ["check-weakening", PD]);
  assert.equal(r.json.status, "ok", JSON.stringify(r.json));
  assert.deepEqual(r.json.allowed.map((x) => [x.path, x.kind, x.by, x.plan]), [[TEST, "tests-removed", "plan", "01-01"], [TEST, "asserts-removed", "plan", "01-01"]]);

  for (const [lines, err] of [[["just prose"], /<check_changes> line is not `<path>: <reason>`: just prose/], [["test/*_test.dart: all of them"], /<check_changes> names a glob, not a file: test\/\*_test\.dart/], [[`${TEST}:`], /<check_changes> test\/parser_test\.dart gives no reason/]]) {
    p.write(`${PD}/01-01-PLAN.md`, good.replace(/<check_changes>[\s\S]*<\/check_changes>/, block(lines).trim()));
    const bad = await gsd(p, ["verify", "plan-structure", "1"]);
    assert.equal(bad.json.valid, false);
    assert.ok(bad.json.errors.some((e) => err.test(e)), JSON.stringify(bad.json.errors));
  }
  p.write(`${PD}/01-01-PLAN.md`, good.replace(`- ${TEST}:`, "- other/x_test.dart:"));
  assert.ok((await gsd(p, ["verify", "plan-structure", "1"])).json.warnings.includes("<check_changes> other/x_test.dart is outside the plan's owns"));
});

test("RC1 the gate configuration: a change since the phase baseline (or since the base commit) is a weakening only an allow of that configuration accepts", async () => {
  const p = fixture();
  assert.equal((await flow(p.root, ["baseline", PD])).json.baseline.gateConfig.length, 64, "the baseline records the gate configuration");
  // Committed or not, the test command changed after the baseline: the phase compares with the recorded hash.
  p.writeJson(".agents/harness.config.json", { adapter: { commands: commands([NODE, "-e", "process.exit(0) // only the fast tests"]) } });
  p.git("commit", "-qam", "relax tests");
  const r = await flow(p.root, ["check-weakening", PD]);
  assert.deepEqual(r.json.weakened.map((w) => [w.path, w.kind]), [[".agents/harness.config.json", "config-changed"]]);
  assert.match(r.json.weakened[0].detail, /execute-baseline\.json/);
  const red = await gate(p);
  assert.equal(red.json.failures.find((f) => f.step === "checks").needsOwner.options[0].startsWith("ph gsd allow 1 --path .agents/harness.config.json "), true);
  const a = await gsd(p, ["allow", "1", "--path", ".agents/harness.config.json", "--reason", "the slow suite runs nightly"]);
  assert.equal(a.json.config.length, 64);
  assert.equal((await gate(p)).json.green, true);
  // A later change is a new configuration: the old allow does not cover it.
  p.writeJson(".agents/harness.config.json", { adapter: { commands: commands([NODE, "-e", "process.exit(0) // none"]) } });
  const again = await flow(p.root, ["check-weakening", PD]);
  assert.equal(again.json.status, "weakened");
  assert.ok(again.json.notes.includes("the owner's allow of .agents/harness.config.json was for another gate configuration"));
  // Reordering keys is no change.
  const q = fixture();
  await flow(q.root, ["baseline", PD]);
  const c = commands();
  q.writeJson(".agents/harness.config.json", { adapter: { commands: Object.fromEntries(Object.entries(c).reverse()) } });
  assert.equal((await flow(q.root, ["check-weakening", PD])).json.status, "ok");
  // Without a baseline hash (the debug flow, an older baseline) the overlay of the base commit is the reference.
  const d = fixture();
  d.writeJson(".agents/harness.config.json", { adapter: { commands: commands([NODE, "-e", "process.exit(0) // skip"]) } });
  const dbg = await flow(d.root, ["check-weakening", ".planning/debug"]);
  assert.match(dbg.json.weakened[0].detail, /\.agents\/harness\.config\.json at [0-9a-f]{7}/);
  const dg = await flow(d.root, ["gate", ".planning/debug"], { waveId: "debug-x", plans: [{ id: "x", owns: [], verify: [] }] });
  assert.match(dg.json.failures.find((f) => f.step === "checks").needsOwner.options[0], /^ph gsd allow debug --path \.agents\/harness\.config\.json /);
  assert.equal((await gsd(d, ["allow", "debug", "--path", ".agents/harness.config.json", "--reason", "x"])).code, 0);
  assert.equal(d.readJson(".planning/debug/owner-answers.json")[0].kind, "allow");
  assert.equal((await flow(d.root, ["check-weakening", ".planning/debug"])).json.status, "ok");
});

test("RC1 adapter.checks.enabled false: no file comparison and no gate step, but switching it off inside a phase is reported; doctor warns", async () => {
  const off = fixture({ adapter: { commands: commands(), checks: { enabled: false } } });
  fs.rmSync(off.path(TEST));
  const g = await gate(off);
  assert.equal(g.json.green, true);
  assert.equal(g.json.checks.status, "off");
  assert.equal(off.readJson(g.json.evidence).steps.some((s) => s.name === "checks"), false);
  const p = fixture();
  await flow(p.root, ["baseline", PD]);
  p.writeJson(".agents/harness.config.json", { adapter: { commands: commands(), checks: { enabled: false } } });
  const r = await flow(p.root, ["check-weakening", PD]);
  assert.deepEqual(r.json.weakened.map((w) => w.kind), ["config-changed"]);

  const s = setup();
  s.project.writeJson(".agents/harness.config.json", { adapter: { checks: { enabled: false } } });
  const { cfg, error } = loadConfigLenient(s.root);
  assert.equal(error, null);
  const out = [];
  await runDoctor({ env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l), paseo: () => null }, { freemem: () => 64 * 2 ** 30, claudeVersionText: () => "2.1.300 (Claude Code)" });
  assert.ok(out.some((l) => /^note warning: adapter\.checks\.enabled is false/.test(l)), out.join("\n"));
  assert.ok(out.every((l) => /^(ok|problem|note) /.test(l)));
});

test("RC1 the config schema: checks keys are optional in an overlay; a bad regex is refused with its key", async () => {
  const s = setup();
  s.project.writeJson(".agents/harness.config.json", { adapter: { checks: { assert: ["(unclosed"] } } });
  const { error } = loadConfigLenient(s.root);
  assert.match(String(error?.message), /adapter\.checks\.assert\[0\].*invalid regular expression/);
  s.project.writeJson(".agents/harness.config.json", { adapter: { checks: { paths: ["test/**"] } } });
  assert.equal(loadConfigLenient(s.root).error, null);
});

test("RC1 gsd-execute: an executor that deletes a test it owns stops the wave at stage Checks with the allow verb; the answer lets the rerun commit", async () => {
  const id = "01-01";
  const w = makeExecWorld({ waves: [[task(id)]] });
  w.write(`src/${id}/a.test.js`, "import test from \"node:test\";\nimport assert from \"node:assert\";\ntest(\"works\", () => { assert.ok(true); });\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "test");
  const run = executor(w);
  const exec = () => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, { [`exec-${id}`]: async (...a) => { fs.rmSync(path.join(w.root, `src/${id}/a.test.js`), { force: true }); return run(...a); } }) });
  const stop = await exec();
  assert.equal(stop.result.status, "needs-owner", JSON.stringify(stop.result.reason));
  assert.equal(stop.result.stage, "Checks");
  assert.match(stop.result.reason, /src\/01-01\/a\.test\.js \(test-file-deleted/);
  assert.equal(stop.result.options[0], `ph gsd allow 1 --path src/${id}/a.test.js --reason "<why this is no weakening, or why it is accepted>", then rerun with the same args`);
  assert.equal(stop.calls.some((c) => /^fix-/.test(c.opts.label)), false, "no fixer is sent to undo or game the weakening");
  assert.equal((await gsd(w, ["allow", "1", "--path", `src/${id}/a.test.js`, "--reason", "the test moved to the shared suite"])).code, 0);
  const next = await exec();
  assert.equal(next.result.status, "executed", JSON.stringify(next.result.reason));
});
