// Kit feedback 119 F1-F4, 124 F1-F2 and WildEraV6 10: which files a red gate counts, who they belong to, and which stop
// fires. The log lines are the ones from the runs (analyzer info, Flutter loading, MSVC C2248, error LNK, the outside reply).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { execSharedReply } from "../../ship/.agents/workflows/lib/flow-exec.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;
const PD = ".planning/phases/03-api";
const INFO = "   info - Use the null-aware marker '?' rather than a null check via an 'if'. Try using '?' - test\\features\\workspace\\workspace_screen_test.dart:34:14 - use_null_aware_elements";
const ERROR = "   error - Expected an identifier - lib\\features\\agent\\permissions\\permission_card.dart:42:74 - missing_identifier";
const WARN = "   warning - The value of the local variable 'builds' isn't used. Try removing the variable or using it - test\\ui\\widgets\\activity_time_test.dart:93:9 - unused_local_variable";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const labels = (r) => r.calls.map((c) => c.opts.label);
const filesOf = (gate, step) => (gate.failures ?? []).filter((f) => f.step === step).flatMap((f) => f.files ?? []);

function gateProject(buildLines, { buildArgs = ["--no-fatal-infos"], testLines = ["process.exit(0);"], plans, answers, shared, grants } = {}) {
  const build = [...buildLines.map((l) => `console.log(${JSON.stringify(l)});`), "process.exit(1);"].join("\n");
  const testScript = [...testLines, ""].join("\n");
  const p = makeTempProject({
    files: {
      "lib/features/agent/permissions/permission_card.dart": "c\n",
      "test/features/workspace/workspace_screen_test.dart": "t\n",
      "test/ui/widgets/activity_time_test.dart": "t\n",
      "test/app/bootstrap_test.dart": "t\n",
      "tools/build.mjs": build,
      "tools/test.mjs": testScript,
    },
    overlay: { adapter: { commands: { build: [NODE, "tools/build.mjs", ...buildArgs], test: [NODE, "tools/test.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } },
  });
  if (shared || answers) {
    fs.mkdirSync(p.path(PD), { recursive: true });
    if (shared) p.writeJson(`${PD}/execute-progress.json`, { version: 2, rev: 1, plans: {}, requests: {}, shared, integration: [] });
    if (answers) p.writeJson(`${PD}/owner-answers.json`, answers);
  }
  if (grants) p.writeJson(`${PD}/grants.json`, grants);
  return p;
}

test("H119 119 F1 an analyzer info line is not a failing file; an error is, and a warning is unless --no-fatal-warnings", async () => {
  const plans = [{ id: "03-02", owns: ["Path:lib/features/agent/"], verify: [] }];
  const answers = [{ id: "OA-2", kind: "decision", plan: "05-01", path: "test/features/workspace/workspace_screen_test.dart", reason: "noDeferredRequests gains openedAgentIds", at: "2026-10-24T00:00:00.000Z" }];
  const withWarn = gateProject([INFO, ERROR, WARN], { answers, plans });
  const r = await flow(withWarn.root, ["gate", PD], { waveId: "w2", plans });
  assert.equal(r.code, 0, JSON.stringify(r.json?.error ?? r.json));
  const files = filesOf(r.json, "build");
  assert.ok(files.includes("lib/features/agent/permissions/permission_card.dart"), files.join(","));
  assert.ok(files.includes("test/ui/widgets/activity_time_test.dart"), files.join(","));
  assert.equal(files.includes("test/features/workspace/workspace_screen_test.dart"), false, files.join(","));
  assert.equal((r.json.unownedTests ?? []).some((t) => t.file.endsWith("workspace_screen_test.dart")), false, JSON.stringify(r.json.unownedTests));
  assert.ok(Object.keys(r.json.byPlan).includes("03-02"), JSON.stringify(Object.keys(r.json.byPlan)));

  const noWarn = gateProject([INFO, ERROR, WARN], { buildArgs: ["--no-fatal-infos", "--no-fatal-warnings"], plans });
  const q = await flow(noWarn.root, ["gate", PD], { waveId: "w2", plans });
  const quiet = filesOf(q.json, "build");
  assert.equal(quiet.includes("test/ui/widgets/activity_time_test.dart"), false, quiet.join(","));
  assert.ok(quiet.includes("lib/features/agent/permissions/permission_card.dart"), quiet.join(","));
});

test("H119 124 F1 a loading failure is attributed to the owned analyzer error, and the fix input carries that error", async () => {
  const p = makeTempProject({
    files: {
      "lib/features/agent/permissions/permission_card.dart": "c\n",
      "test/app/bootstrap_test.dart": "t\n",
      "test/features/workspace/workspace_screen_test.dart": "t\n",
    },
    overlay: { adapter: { commands: { build: [NODE, "tools/build.mjs", "--no-fatal-infos"], test: [NODE, "tools/test.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } },
  });
  const rootSlash = p.root.replace(/\\/g, "/");
  const shown = rootSlash.replace(/^([A-Za-z]):/, (_, d) => `${d.toLowerCase()}:`);
  p.write("tools/build.mjs", `console.log(${JSON.stringify(INFO)});\nconsole.log(${JSON.stringify(ERROR)});\nprocess.exit(1);\n`);
  p.write("tools/test.mjs", [
    `console.log(${JSON.stringify(`00:00 +2 -1: loading ${shown}/test/app/bootstrap_test.dart [E]`)});`,
    `console.log(${JSON.stringify(`  Failed to load "${shown}/test/app/bootstrap_test.dart":`)});`,
    `console.log(${JSON.stringify(`  Compilation failed for testPath=${shown}/test/app/bootstrap_test.dart: lib/features/agent/permissions/permission_card.dart:42:74: Error: Expected ':' before this.`)});`,
    "process.exit(1);",
    "",
  ].join("\n"));
  const plans = [{ id: "05-10", owns: ["Path:lib/features/agent/"], verify: [] }];
  const r = await flow(p.root, ["gate", PD], { waveId: "w4", plans });
  assert.equal(r.code, 0, JSON.stringify(r.json?.error ?? r.json));
  assert.equal((r.json.unownedTests ?? []).some((t) => t.file.endsWith("bootstrap_test.dart")), false, JSON.stringify(r.json.unownedTests));
  assert.equal(filesOf(r.json, "build").includes("test/features/workspace/workspace_screen_test.dart"), false);
  const owned = r.json.byPlan["05-10"] ?? [];
  assert.ok(owned.some((f) => f.step === "build"), JSON.stringify(owned.map((f) => f.step)));
  assert.ok(owned.some((f) => f.step === "test"), JSON.stringify(owned.map((f) => f.step)));
  const testFail = owned.find((f) => f.step === "test");
  assert.match(testFail.excerpt, /missing_identifier/);
  assert.equal((testFail.failingTests ?? []).some((f) => f.endsWith("bootstrap_test.dart")), false);
});

test("H119 WildEraV6 10 MSVC, clang and LNK lines map to repo-relative owned files", async () => {
  const p = makeTempProject({
    files: {
      "game/Source/WildEra/Private/Creature/Pawn/WEMoverSimulation.cpp": "int x;\n",
      "game/Source/WildEra/Private/Creature/Pawn/WEMoverModel.h": "int y;\n",
      "game/Source/WildEra/Private/Creature/Locomotion/Move.cpp": "int z;\n",
      "game/WildEra.uproject": "{}\n",
    },
    overlay: { adapter: { commands: { build: [NODE, "tools/build.mjs"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } },
  });
  const win = (rel) => path.join(p.root, rel).replace(/\//g, "\\").replace(/^([A-Za-z]):/, (_, d) => `${d.toLowerCase()}:`);
  const lines = [
    `${win("game/Source/WildEra/Private/Creature/Pawn/WEMoverSimulation.cpp")}(387,63): error C2248: 'UMoverNetworkPredictionLiaisonComponent::Simulation': cannot access protected member`,
    `${win("game/Source/WildEra/Private/Creature/Pawn/WEMoverModel.h")}(84,92): warning C4996: 'GetObjectsWithOuter': deprecated`,
    `C:\\Program Files\\Epic Games\\UE_5.8\\Engine\\Plugins\\Experimental\\Mover\\Source\\Mover\\Public\\Backends\\MoverNetworkPredictionLiaison.h(107,40): note: see declaration of 'UMoverNetworkPredictionLiaisonComponent::Simulation'`,
    `${win("game/Source/WildEra/Private/Creature/Pawn/WEMoverSimulation.cpp")}.obj : error LNK2019: unresolved external symbol`,
    `${path.join(p.root, "game/Source/WildEra/Private/Creature/Locomotion/Move.cpp").replace(/\\/g, "/")}:12:5: error: use of undeclared identifier`,
    `Using project ${win("game/WildEra.uproject")}`,
  ];
  p.write("tools/build.mjs", `${lines.map((l) => `console.log(${JSON.stringify(l)});`).join("\n")}\nprocess.exit(6);\n`);
  const plans = [
    { id: "01.1-03", owns: ["Path:game/Source/WildEra/Private/Creature/Pawn/"], verify: [] },
    { id: "01.1-06", owns: ["Path:game/Source/WildEra/Private/Creature/Locomotion/"], verify: [] },
  ];
  const r = await flow(p.root, ["gate", PD], { waveId: "batch-1", plans });
  assert.equal(r.code, 0, JSON.stringify(r.json?.error ?? r.json));
  const files = filesOf(r.json, "build");
  assert.ok(files.includes("game/Source/WildEra/Private/Creature/Pawn/WEMoverSimulation.cpp"), files.join(","));
  assert.ok(files.includes("game/Source/WildEra/Private/Creature/Pawn/WEMoverModel.h"), files.join(","));
  assert.ok(files.includes("game/Source/WildEra/Private/Creature/Locomotion/Move.cpp"), files.join(","));
  assert.equal(files.includes("game/WildEra.uproject"), false, files.join(","));
  assert.ok((r.json.byPlan["01.1-03"] ?? []).some((f) => f.step === "build"), JSON.stringify(Object.keys(r.json.byPlan)));
  assert.ok((r.json.byPlan["01.1-06"] ?? []).some((f) => f.step === "build"), JSON.stringify(Object.keys(r.json.byPlan)));
  assert.equal((r.json.unplaced ?? []).some((f) => f.step === "build"), false, JSON.stringify(r.json.unplaced));
});

test("H119 119 F3 a subject match names the line of the shared change", async () => {
  const p = makeTempProject({
    files: { "test/rpc_error_correlation_test.js": "t\n", "tools/run.mjs": "console.log('00:01 +0 -1: test/rpc_error_correlation_test.js: breaks [E]'); process.exit(1);\n" },
    overlay: { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } },
  });
  p.writeJson(`${PD}/execute-progress.json`, { version: 2, rev: 1, plans: {}, requests: {}, shared: [{ id: "S2", from: "03-04", path: "lib/session.js", change: "rpc_error observations carry the daemon code", applied: true }], integration: [] });
  const r = await flow(p.root, ["gate", PD], { waveId: "w1", plans: [{ id: "03-01", owns: ["Path:src/a/"], verify: [] }] });
  const row = r.json.unownedTests.find((t) => t.file === "test/rpc_error_correlation_test.js");
  assert.equal(row.cause.kind, "shared");
  assert.equal(row.cause.matched, "rpc_error observations carry the daemon code");
});

test("H119 119 the outside reply No outside failures observed is not logged as an outside failure", () => {
  const open = [{ id: "S1" }];
  const said = (outside) => execSharedReply({ waveId: "gsd-05-w2", open, reply: { status: "fixed", outside } }).logs;
  assert.deepEqual(said("No outside failures observed"), []);
  assert.deepEqual(said("No outside failures observed. No changes detected under windows/flutter."), []);
  assert.equal(said("No outside failures observed in test/foo_test.dart").length, 1);
  assert.equal(said("test/app/router_test.dart fails to compile").length, 1);
});

function twoWaves(script, extra = {}) {
  const summary = (id) => `${PHASE_DIR}/${id}-SUMMARY.md`;
  const w = makeExecWorld({
    waves: [[task("01-01", { owns: ["Path:test/old_test.js", summary("01-01")] })], [task("01-02")]],
    overlay: { adapter: { commands: { build: [NODE, "tools/run.mjs"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } },
  });
  w.write("tools/run.mjs", script);
  w.write("test/old_test.js", "t\n");
  w.write("src/01-02/a.js", "a\n");
  w.write(`${PHASE_DIR}/execute-progress.json`, `${JSON.stringify({ version: 2, rev: 1, plans: { "01-01": { commit: "abc", tracked: true, verify: "green" } }, requests: {}, shared: [], integration: [] })}\n`);
  w.write(`${PHASE_DIR}/owner-answers.json`, `${JSON.stringify([{ id: "OA-2", kind: "decision", plan: "01-01", path: "test/old_test.js", reason: "old_test must stay strict", at: "2026-10-24T00:00:00.000Z" }])}\n`);
  for (const [rel, text] of Object.entries(extra)) w.write(rel, text);
  w.git("add", "-A");
  w.git("commit", "-qm", "fixture");
  return w;
}
const exec = (w, overrides) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, { "review-": () => ({ findings: [] }), ...overrides }) });
const RED = "console.log('00:01 +0 -1: test/old_test.js: the case [E]'); process.exit(1);\n";

test("H119 119 F3 F4 a grant stop names the matched line and a plan of this wave", async () => {
  const w = twoWaves(RED);
  const r = await exec(w, {});
  assert.equal(r.result.status, "needs-owner", JSON.stringify({ status: r.result.status, stage: r.result.stage, reason: r.result.reason }));
  assert.equal(r.result.stage, "Gate");
  assert.equal(r.result.answer.verb, "grant");
  assert.match(r.result.answer.command, /ph gsd grant 01 --path test\/old_test\.js --plan 01-02$/);
  assert.doesNotMatch(r.result.answer.command, /01-01/);
  assert.match(r.result.reason, /matched "test\/old_test\.js"/);
  assert.match(r.result.reason, /old_test must stay strict/);
  assert.equal(labels(r).some((l) => l.startsWith("fix-") || l.startsWith("integration-fix")), false, labels(r).join(","));
});

test("H119 119 F2 owned failures get a fix round before the grant stop", async () => {
  const script = "console.log('error src/01-02/a.js:1: boom');\nconsole.log('00:01 +0 -1: test/old_test.js: the case [E]');\nprocess.exit(1);\n";
  const w = twoWaves(script);
  const r = await exec(w, { "fix-01-02": () => ({ status: "fixed", taskResults: [], requests: [] }) });
  assert.equal(labels(r).includes("fix-01-02-1"), true, labels(r).join(","));
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.answer.verb, "grant");
  assert.match(r.result.answer.command, /--plan 01-02/);
});

test("H119 119 F4 a grant to a plan of this wave clears the stop and that plan's fixer runs", async () => {
  const script = "import fs from 'node:fs'; if (fs.existsSync('fail.flag')) { console.log('00:01 +0 -1: test/old_test.js: the case [E]'); process.exit(1); } process.exit(0);\n";
  const w = twoWaves(script, { [`${PHASE_DIR}/grants.json`]: `${JSON.stringify([{ path: "test/old_test.js", plan: "01-02", at: "2026-10-24T00:00:00.000Z" }])}\n` });
  fs.writeFileSync(path.join(w.root, "fail.flag"), "1\n");
  const r = await exec(w, {
    "fix-01-02": () => { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { status: "fixed", taskResults: [], requests: [] }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify({ status: r.result.status, stage: r.result.stage, reason: r.result.reason }));
  assert.equal(labels(r).some((l) => l.startsWith("fix-01-02")), true, labels(r).join(","));
  assert.notEqual(r.result.answer?.verb, "grant");
});

test("H119 WildEraV6 10 an unresolved integration fixer does not stop while a placed failure has a fixer", async () => {
  const w = makeExecWorld({
    waves: [[task("01-01"), task("01-02")]],
    overlay: { gsd: { execution_mode: "batch", batch_review: false }, adapter: { commands: { build: [NODE, "tools/build.mjs"], test: [NODE, "tools/test.mjs"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } },
  });
  w.write(".gitignore", ".claude/worktrees/\n_workspace/\nfail.flag\n");
  w.write("src/01-01/WEMoverSimulation.cpp", "int x;\n");
  w.write("src/01-02/Move.cpp", "int z;\n");
  w.write("game/WildEra.uproject", "{}\n");
  w.write("tools/build.mjs", [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "if (!fs.existsSync('fail.flag')) process.exit(0);",
    "const win = (rel) => path.join(process.cwd(), rel).replace(/\\//g, '\\\\').replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase() + ':');",
    "console.log(win('src/01-01/WEMoverSimulation.cpp') + '(387,63): error C2248: cannot access protected member');",
    "console.log(win('src/01-02/Move.cpp').replace(/\\\\/g, '/') + ':12:5: error: use of undeclared identifier');",
    "console.log(win('src/01-01/WEMoverSimulation.cpp') + '.obj : error LNK2019: unresolved external symbol');",
    "console.log('Using project ' + win('game/WildEra.uproject'));",
    "process.exit(6);",
    "",
  ].join("\n"));
  w.write("tools/test.mjs", "import fs from 'node:fs'; if (!fs.existsSync('fail.flag')) process.exit(0); console.log('error game/WildEra.uproject:1: access violation'); process.exit(1);\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "fixture");
  const r = await exec(w, {
    "exec-01-01": async (p, o, n, calls) => { await executor(w)(p, o, n, calls); fs.writeFileSync(path.join(w.root, "fail.flag"), "1\n"); return { taskResults: [{ task: "1", status: "implemented" }], deviations: [], requests: [] }; },
    "integration-fix-batch": () => ({ status: "unresolved", remaining_failures: 1, evidence: "descriptor only" }),
    "batch-fixer": () => { fs.rmSync(path.join(w.root, "fail.flag"), { force: true }); return { status: "fixed", remaining_failures: 0, evidence: "compile fixed" }; },
  });
  assert.equal(r.result.status, "executed", JSON.stringify({ status: r.result.status, stage: r.result.stage, reason: r.result.reason }));
  assert.equal(labels(r).includes("integration-fix-batch"), true, labels(r).join(","));
  assert.equal(labels(r).includes("batch-fixer"), true, labels(r).join(","));
  const prompt = r.calls.find((c) => c.opts.label === "batch-fixer")?.prompt ?? "";
  assert.match(prompt, /error C2248/);
  assert.match(prompt, /src\/01-02\/Move\.cpp/);
  assert.ok(r.logs.some((l) => /placed failures still have a fixer/.test(l)), r.logs.filter((l) => /integration fixer/.test(l)).join("\n"));
});
