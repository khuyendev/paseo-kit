// Kit feedback #105 F1-F2 and #107 F2 (G105): a <shared_changes> block that says None (prose after it) is no shared change and any
// other entry with no path is a checker issue with its fix; `shared clear` without --path clears only nameless entries and
// refuses while a file is still unapplied; a build-output or check-rerun request is a kit note for the gate, never a shared change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { absentSharedChange, sharedChanges } from "../../ship/.agents/harness/gsd/planning.mjs";
import { pathlessIssues } from "../../ship/.agents/harness/gsd/shared-changes.mjs";
import { isBuildOutput, onlyCheckRerun } from "../../ship/.agents/workflows/lib/flow-exec.mjs";
import { main as flowMain } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { gsd, plan, project, P1 } from "../gsd-core/fixture.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { makeTempProject } from "../helpers/temp.mjs";

const PD = PHASE_DIR;
const block = (text) => `<shared_changes>\n${text}\n</shared_changes>`;
const withBlock = (text) => plan({ id: "01" }).replace("</tasks>", `</tasks>\n${block(text)}`);
async function verb(root, argv, input) {
  let line = "";
  const code = await flowMain(argv, { root, input: input === undefined ? "" : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const exec = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PD }, gsd: w.gsd, agent: executor(w, overrides) });

test("G105 105 F1 a None / n/a / empty block, prose after it, is no shared change; a path line is kept", () => {
  const prose = "None. Catalog, primitives, route files remain with their owners.";
  for (const none of ["", "   ", "None", "None.", "none", "n/a", "N/A.", "empty", "Empty.", "empty. nothing to share", prose]) {
    assert.equal(absentSharedChange(none), true, JSON.stringify(none));
    assert.deepEqual(sharedChanges(block(none)), [], JSON.stringify(none));
  }
  const kept = "lib/main.dart: import bootstrap.dart";
  assert.deepEqual(sharedChanges(`${block(prose)}\n${block(kept)}`), [kept]);
  const mixed = `None.\n${kept}`;
  assert.deepEqual(sharedChanges(block(mixed)), [mixed], "a path line keeps the block");
  assert.equal(absentSharedChange("Keep the catalog with its owner."), false);
});

test("G105 105 F1 the owns probe flags a pathless entry with its fix and ignores a None block; the exit code stays", async () => {
  const issues = pathlessIssues({ id: "01-01", sharedChanges: ["Keep the catalog with its owner.", "lib/a.dart: add x\nNone.\nalso mention it"] });
  assert.deepEqual(issues.map((i) => i.line), ["Keep the catalog with its owner.", "also mention it"]);
  assert.equal(issues[0].kind, "shared-path");
  assert.match(issues[0].fix, /<path>: Keep the catalog/);
  assert.match(issues[0].fix, /None/);
  assert.match(issues[0].message, /names no file/);
  assert.deepEqual(pathlessIssues({ id: "01-01", sharedChanges: [] }), []);

  const bad = project({ files: { [`${P1}/01-01-PLAN.md`]: withBlock("Keep the catalog with its owner.") } });
  const flagged = await gsd(bad, ["check", "owns", "1"]);
  assert.equal(flagged.code, 0, "an issue is not a problem");
  assert.equal(flagged.json.passed, true);
  assert.deepEqual(flagged.json.issues.map((i) => [i.plan, i.kind]), [["01-01", "shared-path"]]);
  assert.match(flagged.json.issues[0].fix, /None/);
  const probes = await verb(bad.root, ["plan-probes"], { runs: { owns: { code: flagged.code, json: flagged.json } } });
  assert.ok(probes.json.found.some((f) => f.probe === "owns" && f.plan === "01-01" && f.severity === "blocker" && /names no file/.test(f.description) && /None/.test(f.fix)), JSON.stringify(probes.json.found));

  const none = project({ files: { [`${P1}/01-01-PLAN.md`]: withBlock("None. Catalog, primitives, route files remain with their owners.") } });
  const ok = await gsd(none, ["check", "owns", "1"]);
  assert.equal(ok.json.issues, undefined);
  assert.equal(ok.code, flagged.code);
});

test("G105 105 F1 handoff publishes no shared change for a None block", async () => {
  const none = project({ files: { [`${P1}/01-01-PLAN.md`]: withBlock("None. Catalog, primitives, route files remain with their owners."), [`${P1}/01-01-SUMMARY.md`]: null } });
  const h = await gsd(none, ["handoff", "1"]);
  assert.equal(h.code, 0, JSON.stringify(h.json));
  assert.deepEqual(h.json.sharedChanges, []);
  assert.deepEqual(none.readJson(`${P1}/handoff/w1.args.json`).sharedChanges, []);

  const both = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ id: "01" }).replace("</tasks>", `</tasks>\n${block("None. nothing")}\n${block("lib/main.dart: import bootstrap.dart")}`), [`${P1}/01-01-SUMMARY.md`]: null } });
  const h2 = await gsd(both, ["handoff", "1"]);
  assert.equal(h2.code, 0, JSON.stringify(h2.json));
  assert.deepEqual(h2.json.sharedChanges.map((s) => s.paths), [["lib/main.dart"]]);
});

test("G105 105 F2 shared clear without --path clears only a nameless entry and refuses while a file is unapplied", async () => {
  const only = makeExecWorld({ waves: [[task("01-01")]] });
  only.write(`${PD}/execute-progress.json`, JSON.stringify({ plans: {}, shared: [{ id: "S1", from: "01-01", path: null, change: "None. catalog stays", applied: false, wave: "w1" }] }));
  const cleared = await gsd(only, ["shared", "clear", "1", "w1", "--reason", "the block was None"]);
  assert.equal(cleared.code, 0, JSON.stringify(cleared.json));
  assert.equal(cleared.json.path, null);
  assert.deepEqual(cleared.json.clears, [{ id: "S1", from: "01-01", path: null, change: "None. catalog stays", applied: false }]);
  assert.equal(JSON.parse(only.read(`${PD}/owner-answers.json`))[0].path, null);

  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const shared = [
    { id: "S1", from: "01-01", path: "lib/rpc.dart", change: "c1", applied: false, wave: "w1" },
    { id: "S2", from: "01-01", path: null, change: "None. catalog stays", applied: false, wave: "w1" },
    { id: "S3", from: "01-01", path: "pubspec.yaml", change: "c3", applied: true, wave: "w1" },
  ];
  w.write(`${PD}/execute-progress.json`, JSON.stringify({ plans: {}, shared }));
  const refused = await gsd(w, ["shared", "clear", "1", "w1", "--reason", "drop the bogus one"]);
  assert.equal(refused.code, 1);
  assert.match(refused.json.error, /lib\/rpc\.dart/);
  assert.match(refused.json.error, /--path <file>/);
  assert.equal(fs.existsSync(path.join(w.root, PD, "owner-answers.json")), false, "a refusal writes no answer");
  const one = await gsd(w, ["shared", "clear", "1", "w1", "--path", "lib\\rpc.dart", "--reason", "made by hand"]);
  assert.equal(one.code, 0, JSON.stringify(one.json));
  assert.deepEqual(one.json.clears, [{ id: "S1", from: "01-01", path: "lib/rpc.dart", change: "c1", applied: false }]);
  shared[0].applied = true;
  w.write(`${PD}/execute-progress.json`, JSON.stringify({ plans: {}, shared }));
  const fileless = await gsd(w, ["shared", "clear", "1", "w1", "--reason", "the block was None"]);
  assert.equal(fileless.code, 0, JSON.stringify(fileless.json));
  assert.deepEqual(fileless.json.clears.map((c) => c.id), ["S2"]);
  assert.equal(JSON.parse(w.read(`${PD}/owner-answers.json`)).at(-1).path, null);
});

test("G105 105 F2 an answer with no path key still clears every open entry; path null clears only nameless", async () => {
  const shared = [
    { id: "S1", path: "a.json", change: "c", applied: false, wave: "w1" },
    { id: "S2", path: null, change: "none", applied: false, wave: "w1" },
  ];
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write(`${PD}/execute-progress.json`, JSON.stringify({ plans: {}, shared }));
  w.write(`${PD}/owner-answers.json`, JSON.stringify([{ id: "OA-1", kind: "shared", wave: "w1", reason: "old kit", at: "2026-10-24T00:00:00.000Z" }]));
  const old = await verb(w.root, ["state-answer", PD], { id: "OA-1" });
  assert.equal(old.code, 0, JSON.stringify(old.json));
  assert.equal(old.json.taken.matched, 2);
  assert.deepEqual(old.json.state.shared.map((s) => s.applied), [true, true]);

  const w2 = makeExecWorld({ waves: [[task("01-01")]] });
  w2.write(`${PD}/execute-progress.json`, JSON.stringify({ plans: {}, shared }));
  w2.write(`${PD}/owner-answers.json`, JSON.stringify([{ id: "OA-9", kind: "shared", wave: "w1", path: null, reason: "fileless", at: "2026-10-24T00:00:00.000Z" }]));
  const neu = await verb(w2.root, ["state-answer", PD], { id: "OA-9" });
  assert.equal(neu.code, 0, JSON.stringify(neu.json));
  assert.equal(neu.json.taken.matched, 1);
  assert.deepEqual(neu.json.state.shared.map((s) => [s.id, s.applied]), [["S1", false], ["S2", true]]);
});

const OWNERSHIP = { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: ["lib", "test"], ignore: [], regenerated: ["native/**/*.dll", "windows/flutter/generated_plugin_registrant.cc", "lib/*.g.dart"] };

test("G105 107 F2 a build output or a check rerun is a gate note; a generated source file and a real edit stay requests", async () => {
  for (const [file, yes] of [["build/native_assets/windows/sqlite3.dll", true], ["android/app/build/app.so", true], [".dart_tool/package_config.json", true], ["node_modules/pkg/index.js", true], ["target/debug/app", true], ["dist/bundle.js", true], ["out/x", true], ["Intermediate/Build/x.obj", true], ["Binaries/Win64/game.exe", true], ["lib/foo.dart", false], ["gen/out.js", false]]) {
    assert.equal(isBuildOutput(file), yes, file);
  }
  const named = { regenerated: OWNERSHIP.regenerated, sourceRoots: OWNERSHIP.source_roots };
  assert.equal(isBuildOutput("native/sqlite3.dll", named), true, "artifact outside source roots");
  assert.equal(isBuildOutput("lib/vendor.dll", { regenerated: ["lib/**/*.dll"], sourceRoots: ["lib"] }), true, "artifact the regenerated globs name");
  assert.equal(isBuildOutput("windows/flutter/generated_plugin_registrant.cc", named), false, "generated source stays a shared change");
  assert.equal(isBuildOutput("lib/strings.g.dart", named), false);
  assert.equal(onlyCheckRerun("rerun the suite serially"), true);
  assert.equal(onlyCheckRerun("Please re-run the tests."), true);
  assert.equal(onlyCheckRerun("run the suite again"), true);
  assert.equal(onlyCheckRerun("add the export and rerun the suite"), false);
  assert.equal(onlyCheckRerun("export the screen"), false);

  const p = makeTempProject({ git: false, overlay: { adapter: { ownership: OWNERSHIP } } });
  const reply = { requests: [
    { path: "build/native_assets/windows/sqlite3.dll", change: "add a retry", reason: "lock" },
    { path: "lib/foo.dart", change: "rerun the suite serially" },
    { path: "lib/foo.dart", change: "add the export and rerun the suite" },
    { path: "native/sqlite3.dll", change: "ship the asset" },
    { path: "windows/flutter/generated_plugin_registrant.cc", change: "register the plugin" },
    { path: "lib/app.dart", change: "export the screen" },
  ] };
  const r = (await verb(p.root, ["exec-route"], { from: "01-04", reply, plans: [{ id: "01-02", owns: ["Path:lib/"] }] })).json;
  assert.deepEqual(r.notes.map((n) => [n.path, n.for, n.note]), [
    ["build/native_assets/windows/sqlite3.dll", "gate", "add a retry"],
    ["lib/foo.dart", "gate", "rerun the suite serially"],
    ["native/sqlite3.dll", "gate", "ship the asset"],
  ]);
  assert.deepEqual(r.routes.map((x) => [x.plan, x.q.path, x.q.change]), [
    ["01-02", "lib/foo.dart", "add the export and rerun the suite"],
    [null, "windows/flutter/generated_plugin_registrant.cc", "register the plugin"],
    ["01-02", "lib/app.dart", "export the screen"],
  ]);
  assert.deepEqual(r.asked.map((x) => x.path), ["lib/foo.dart", "windows/flutter/generated_plugin_registrant.cc", "lib/app.dart"]);
});

test("G105 107 F2 a run whose fixer request is build output or a check rerun logs a gate note and does not stop at Integration", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const run = executor(w);
  const r = await exec(w, {
    "exec-01-01": async (...a) => ({ ...(await run(...a)), requests: [
      { path: "build/native_assets/windows/sqlite3.dll", change: "rerun the suite serially", reason: "native-asset file lock" },
      { path: "lib/foo.dart", change: "Please re-run the tests." },
    ] }),
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.deepEqual(r.result.sharedChanges, []);
  assert.deepEqual(r.result.kitNotes.map((k) => [k.plan, k.path, k.for, k.note]), [
    ["01-01", "build/native_assets/windows/sqlite3.dll", "gate", "rerun the suite serially"],
    ["01-01", "lib/foo.dart", "gate", "Please re-run the tests."],
  ]);
  assert.ok(r.logs.some((l) => /kit note 01-01 \(a request for build\/native_assets\/windows\/sqlite3.dll is a note for the gate\): rerun the suite serially/.test(l)), r.logs.filter((l) => /kit note/.test(l)).join("\n"));
});
