// Kit feedback 102 F4 and 108 F1-F3: which plans a gate fix round dispatches.
// A failing file named in a failure report (not only path:line) dispatches its owner even when that plan had no fixer
// in the previous round; a request the integration fixer routes to a same-wave owner dispatches that fixer in the same
// round; an unowned failing test a shared change or owner decision names stops for `ph gsd grant` before round 1;
// identical requests to one file merge.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;
const PD = ".planning/phases/03-api";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const labels = (r) => r.calls.map((c) => c.opts.label);
const exec = (w, overrides) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });
const commands = (script) => ({ build: [NODE, "-e", "process.exit(0)"], test: [NODE, script], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} });

function commitWorld(script, files = {}) {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]], overlay: { adapter: { commands: commands(script) } } });
  for (const [rel, text] of Object.entries(files)) w.write(rel, text);
  w.write(".gitignore", ".claude/worktrees/\n_workspace/\nfail.flag\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "fixture");
  return w;
}

test("G108 F1 a gate log's failure report names a file path:line drops, and that file's plan is an owner", async () => {
  const log = [
    "console.log('error src/a/x.js:1: decoy');",
    "console.log('00:01 +0 -1: test/feature_providers_test.js: breaks [E]');",
    "console.log('  src/b/y.js');",
    "console.log('  lib\\\\features\\\\setup\\\\callout.dart');",
    "console.log('  test/feature_providers_test.js 4:1 main');",
    "process.exit(1);",
  ].join("");
  const p = makeTempProject({
    files: {
      "src/a/x.js": "x\n", "src/b/y.js": "y\n", "lib/features/setup/callout.dart": "c\n", "test/feature_providers_test.js": "t\n",
      "tools/run.mjs": log,
    },
    overlay: { adapter: { commands: commands("tools/run.mjs") } },
  });
  p.writeJson(`${PD}/execute-progress.json`, { version: 2, rev: 1, plans: {}, requests: {}, shared: [{ id: "S1", from: "03-05", path: "lib/obs.js", change: "feature_providers now emits three observations", applied: true }], integration: [] });
  p.writeJson(`${PD}/owner-answers.json`, [{ id: "OA-9", kind: "allow", plan: "03-05", path: "test/feature_providers_test.js", reason: "three observations", at: "2026-10-24T00:00:00.000Z" }]);
  const plans = [{ id: "03-01", owns: ["Path:src/a/"], verify: [] }, { id: "03-02", owns: ["Path:src/b/", "Path:lib/features/"], verify: [] }];
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans });
  assert.equal(r.code, 0, JSON.stringify(r.json?.error ?? r.json));
  assert.ok(Object.keys(r.json.byPlan).includes("03-02"), JSON.stringify(Object.keys(r.json.byPlan)));
  const files = r.json.byPlan["03-02"].flatMap((f) => f.files);
  assert.ok(files.includes("src/b/y.js"), files.join(","));
  assert.ok(files.includes("lib/features/setup/callout.dart"), files.join(","));
  const row = r.json.unownedTests.find((t) => t.file === "test/feature_providers_test.js");
  assert.ok(row, JSON.stringify(r.json.unownedTests));
  // A record whose path is the file wins over a shared change that only names the subject.
  assert.equal(row.cause.kind, "decision");
  assert.equal(row.cause.id, "OA-9");
});

test("G108 F1 a shared change that names the subject is the cause when no record's path is the file", async () => {
  const p = makeTempProject({
    files: { "test/rpc_error_correlation_test.js": "t\n", "tools/run.mjs": "console.log('00:01 +0 -1: test/rpc_error_correlation_test.js: breaks [E]');process.exit(1);" },
    overlay: { adapter: { commands: commands("tools/run.mjs") } },
  });
  p.writeJson(`${PD}/execute-progress.json`, { version: 2, rev: 1, plans: {}, requests: {}, shared: [{ id: "S2", from: "03-04", path: "lib/session.js", change: "rpc_error observations carry the daemon code", applied: true }], integration: [] });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:src/a/"], verify: [] }] });
  const row = r.json.unownedTests.find((t) => t.file === "test/rpc_error_correlation_test.js");
  assert.equal(row.cause.kind, "shared");
  assert.equal(row.cause.id, "S2");
  assert.match(row.cause.text, /rpc_error observations/);
});

test("G108 F1 a plan with no fixer in the previous round is dispatched when the next gate log names its file", async () => {
  const script = [
    "import fs from 'node:fs';",
    "const mode = fs.existsSync('fail.flag') ? fs.readFileSync('fail.flag', 'utf8').trim() : '';",
    "if (mode === 'pass') process.exit(0);",
    "if (mode === 'round2') {",
    "  console.log('error src/01-01/a.js:1: still');",
    "  console.log('00:01 +0 -1: src/01-02/b.test.js: the case [E]');",
    "  console.log('  src/01-02/b.js');",
    "  console.log('  src/01-02/b.test.js 10:1 main');",
    "  process.exit(1);",
    "}",
    "console.log('error src/01-01/a.js:1: boom');",
    "process.exit(1);",
  ].join("\n");
  const w = commitWorld("tools/run.mjs", { "tools/run.mjs": script, "src/01-01/a.js": "a\n", "src/01-02/b.js": "b\n", "src/01-02/b.test.js": "t\n" });
  const flag = path.join(w.root, "fail.flag");
  const r = await exec(w, {
    "fix-01-01": () => { if (!fs.existsSync(flag)) fs.writeFileSync(flag, "round2\n"); return { status: "fixed", taskResults: [], requests: [] }; },
    "fix-01-02": () => { fs.writeFileSync(flag, "pass\n"); return { status: "fixed", taskResults: [], requests: [] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(labels(r).includes("fix-01-02-1"), false, labels(r).join(","));
  assert.equal(labels(r).includes("fix-01-02-2"), true, labels(r).join(","));
});

test("G108 F4 a request the integration fixer routes to a same-wave owner dispatches that fixer in the same round", async () => {
  const script = "import fs from 'node:fs'; if (fs.existsSync('fail.flag') && fs.readFileSync('fail.flag','utf8').trim()==='pass') process.exit(0); console.log('error lib/shared.js:3: boom'); process.exit(1);\n";
  const w = commitWorld("tools/run.mjs", { "tools/run.mjs": script, "lib/shared.js": "s\n" });
  const r = await exec(w, {
    "integration-fix": () => ({ status: "unresolved", remaining_failures: 1, requests: [{ path: "src/01-02/api.js", change: "export the helper" }] }),
    "fix-01-02": () => { fs.writeFileSync(path.join(w.root, "fail.flag"), "pass\n"); return { status: "fixed", taskResults: [], requests: [] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  const got = labels(r);
  assert.equal(got.includes("integration-fix-1"), true, got.join(","));
  assert.equal(got.includes("fix-01-02-1"), true, got.join(","));
  assert.ok(r.logs.some((l) => /fixer dispatched this round/.test(l)), r.logs.filter((l) => /routed/.test(l)).join("\n"));
});

test("G108 F2 an unowned failing test a shared change names stops before round 1 with ph gsd grant", async () => {
  const file = "test/feature_providers_test.js";
  const script = `console.log('00:01 +0 -1: ${file}: breaks [E]'); process.exit(1);\n`;
  const state = { version: 2, rev: 1, plans: {}, requests: {}, shared: [{ id: "S1", from: "01-05", path: "lib/obs.js", change: "feature_providers now emits three observations", applied: true }], integration: [] };
  const w = commitWorld("tools/run.mjs", { "tools/run.mjs": script, [file]: "t\n", [`${PHASE_DIR}/execute-progress.json`]: `${JSON.stringify(state)}\n` });
  const r = await exec(w, {});
  assert.equal(r.result.status, "needs-owner", JSON.stringify({ status: r.result.status, stage: r.result.stage, reason: r.result.reason }));
  assert.equal(r.result.stage, "Gate");
  assert.equal(r.result.answer.verb, "grant");
  assert.match(r.result.answer.command, new RegExp(`ph gsd grant 01 --path ${file}`));
  assert.match(r.result.reason, /feature_providers now emits three observations/);
  assert.equal(labels(r).some((l) => l.startsWith("fix-") || l.startsWith("integration-fix")), false, labels(r).join(","));
  assert.equal(r.result.unownedTests[0].cause.kind, "shared");
});

test("G108 F2 an unowned failing test nothing names is listed with no cause", async () => {
  const p = makeTempProject({
    files: { "test/lib.test.js": "t\n", "tools/run.mjs": "console.log('error test/lib.test.js:1: boom'); process.exit(1);\n" },
    overlay: { adapter: { commands: commands("tools/run.mjs") } },
  });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:src/a/"], verify: [] }] });
  const row = r.json.unownedTests.find((t) => t.file === "test/lib.test.js");
  assert.equal(row.cause, null);
  assert.equal(r.json.unplaced.some((f) => (f.tests ?? []).includes("test/lib.test.js")), true);
});

test("G108 F3 identical requests to one file merge and list every requester", async () => {
  const p = makeTempProject({ files: { "src/01-02/a.js": "a\n" } });
  fs.mkdirSync(p.path(PD), { recursive: true });
  const route = (from, change) => flow(p.root, ["state-request", PD], { op: "route", plan: "01-02", from, path: "src/01-02/a.js", change });
  const first = await route("01-01", "remove the unused import");
  assert.equal(first.json.routed, true);
  const second = await route("01-03", "remove   the unused\nimport");
  assert.deepEqual([second.json.routed, second.json.merged, second.json.requesters], [false, true, ["01-01", "01-03"]]);
  const third = await route("01-04", "remove the unused import");
  assert.deepEqual(third.json.requesters, ["01-01", "01-03", "01-04"]);
  const again = await route("01-01", "remove the unused import");
  assert.equal(again.json.duplicate, true);
  const other = await route("01-05", "rename the export");
  assert.equal(other.json.routed, true);
  const open = other.json.state.requests["01-02"];
  assert.equal(open.length, 2);
  assert.equal(open[0].change, "remove the unused import");
  assert.deepEqual(open[0].requesters, ["01-01", "01-03", "01-04"]);
  assert.equal(open[1].requesters, undefined);
});
