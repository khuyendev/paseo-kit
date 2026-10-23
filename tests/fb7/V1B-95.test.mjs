// Kit feedback #95 (V1B): a plan's <shared_changes> are made before the executors of its wave start (F1; in worktree mode each
// executor worktree is seeded with them), a change the tree already holds at HEAD needs no fixer (F3), and the plan checker's owns
// probe refuses a wave timing gsd-execute cannot honour (F2). The turn after the code stays for requests and for a declared
// change that waits for the plan's code or whose file an open plan owns.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { committedFiles, exec, shared, world } from "../fb6/q77-helpers.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { gsd, plan as planText, project, P1 } from "../gsd-core/fixture.mjs";
import { main as flowMain } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";

const labels = (r) => r.calls.map((c) => c.opts.label);
const progress = (w) => JSON.parse(w.read(`${PHASE_DIR}/execute-progress.json`));
async function verb(root, argv, input) {
  let line = "";
  const code = await flowMain(argv, { root, input: input === undefined ? "" : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
// The wave-1 handoff of a world with these declared shared changes.
function declare(w, changes, file = `${PHASE_DIR}/handoff/w1.args.json`) {
  w.write(file, JSON.stringify({ ...JSON.parse(w.read(file)), sharedChanges: changes }));
}

test("V1B 95 F1 a declared shared change is made before the wave's executor starts (shared tree): the executor sees it, the wave commits it", async () => {
  const w = world({ isolation: "shared" });
  const run = executor(w);
  let seen = null;
  const r = await exec(w, {}, { ...shared(w), "exec-01-01": async (...a) => { seen = fs.existsSync(path.join(w.root, "config/app.json")) ? w.read("config/app.json") : null; return run(...a); } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.ok(labels(r).indexOf("shared-w1") >= 0 && labels(r).indexOf("shared-w1") < labels(r).indexOf("exec-01-01"), labels(r).join(","));
  assert.equal(seen, "{\"x\":1}\n", "the executor's tree holds the shared change");
  assert.equal(labels(r).filter((l) => l.startsWith("shared-")).length, 1, "the turn after the code has nothing left");
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
  assert.ok(r.result.events.indexOf("shared w1 1") < r.result.events.indexOf("code w1 01-01"));
});

test("V1B 95 F1 worktree isolation: the executor worktree is seeded with the shared change; the transfer does not copy it, the wave commit has it", async () => {
  const w = world({ isolation: "worktree" });
  const run = executor(w);
  let seen = null;
  const r = await exec(w, {}, { ...shared(w), "exec-01-01": async (p, o, n, calls) => { const wt = calls.find((c) => c.n === n).worktree; seen = w.read(`${wt}/config/app.json`); return run(p, o, n, calls); } });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  assert.equal(seen, "{\"x\":1}\n", "the worktree starts with the shared change, although HEAD lacks it");
  const opts = r.calls.find((c) => c.opts.label === "exec-01-01").opts;
  assert.deepEqual(opts.worktreeSeed.files.map((f) => f.path), ["config/app.json"]);
  const tr = JSON.parse(w.read(`${PHASE_DIR}/transfers/01-01.json`));
  assert.equal(tr.files.some((f) => f.path === "config/app.json"), false, "an unchanged seeded file is not the plan's output");
  assert.ok(committedFiles(w, "feat(01-w1)").includes("config/app.json"));
  assert.deepEqual(JSON.parse(w.read(`${PHASE_DIR}/commits.json`))[0].integration, ["config/app.json"]);
  // A run without shared changes passes no seed: the executor options, and so the journal keys, are the ones of before.
  const plain = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" } } });
  const p = await runScript("gsd-execute", { root: plain.root, args: { phaseDir: PHASE_DIR }, gsd: plain.gsd, agent: executor(plain) });
  assert.equal(p.result.status, "executed", JSON.stringify(p.result.reason));
  assert.equal(p.calls.find((c) => c.opts.label === "exec-01-01").opts.worktreeSeed, undefined);
  assert.equal(labels(p).some((l) => l.startsWith("shared-")), false);
});

test("V1B 95 F1 an unapplied shared change stops the wave before any executor runs (Integration, answered with shared clear)", async () => {
  const w = world({ isolation: "worktree" });
  const r = await exec(w, {}, { "shared-": () => ({ status: "unresolved", evidence: "the manifest has no queries element", changes: [{ index: 0, applied: false }] }) });
  assert.deepEqual([r.result.status, r.result.stage], ["needs-owner", "Integration"]);
  assert.equal(r.result.answer.verb, "shared.clear");
  assert.equal(labels(r).some((l) => l.startsWith("exec-")), false, "no executor starts without the change its tasks need");
  assert.match(r.result.reason, /not applied \(1 of 1\): the manifest has no queries element/);
});

test("V1B 95 F1 a declared change is made before the executor; one that waits for the plan's code, or whose file an open plan owns, after it", async () => {
  for (const [name, changes, waves, before] of [
    ["before the wave", [{ source: "01-01", text: "config/app.json: register app config", paths: ["config/app.json"] }], [[task("01-01")]], true],
    ["waits for code", [{ source: "01-01", text: "config/app.json: register app config when src/01-01/impl.js exists", paths: ["config/app.json"] }], [[task("01-01")]], false],
    ["an open plan owns it", [{ source: "01-01", text: "src/01-02/api.js: export x", paths: ["src/01-02/api.js"] }], [[task("01-01"), task("01-02")]], false],
  ]) {
    const w = makeExecWorld({ waves, overlay: { gsd: { parallelization: { enabled: false, max_concurrent: null } } } });
    declare(w, changes);
    const file = changes[0].paths[0];
    const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, { "shared-": () => { w.write(file, "x\n"); return { status: "fixed", changes: [{ index: 0, applied: true }] }; } }) });
    assert.equal(r.result.status, "executed", `${name}: ${JSON.stringify(r.result.reason)}`);
    const l = labels(r);
    assert.equal(l.indexOf("shared-w1") < l.indexOf("exec-01-01"), before, `${name}: ${l.join(",")}`);
  }
});

test("V1B 95 F1 graph schedule: a plan's declared shared change is made before its executor", async () => {
  const w = world({ isolation: "shared", gsd: { execute_schedule: "graph", execution_mode: "per-wave" } });
  const r = await exec(w, {}, shared(w));
  assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
  const l = labels(r);
  assert.ok(l.indexOf("shared-w1") >= 0 && l.indexOf("shared-w1") < l.indexOf("exec-01-01"), l.join(","));
  assert.equal(progress(w).shared[0].applied, true);
});

test("V1B 95 F3 a declared dependency the manifest already holds at HEAD is applied without a fixer; another constraint still needs one", async () => {
  const PUB = "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  url_launcher: ^6.3.3\ndev_dependencies:\n  lints: ^5.0.0\n";
  for (const [constraint, fixer] of [["^6.3.3", false], ["^6.4.0", true]]) {
    const w = makeExecWorld({ waves: [[task("01-01")]] });
    w.write("pubspec.yaml", PUB);
    w.git("add", "-A");
    w.git("commit", "-qm", "pubspec");
    declare(w, [{ source: "01-01", text: `pubspec.yaml: dependency url_launcher ${constraint}`, paths: ["pubspec.yaml"] }]);
    const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, { "shared-": () => ({ status: "fixed", changes: [{ index: 0, applied: true }] }) }) });
    assert.equal(r.result.status, "executed", JSON.stringify(r.result.reason));
    assert.equal(labels(r).some((l) => l.startsWith("shared-")), fixer, constraint);
    const s = progress(w).shared[0];
    assert.equal(s.applied, true);
    if (!fixer) {
      assert.equal(s.appliedBy, "present");
      assert.match(s.evidence, /url_launcher \^6\.3\.3 declared at HEAD/);
      assert.ok(r.logs.some((x) => /shared w1: pubspec\.yaml holds the change already .*applied without a fixer/.test(x)), r.logs.join("\n"));
    } else assert.equal(s.appliedBy, undefined);
  }
});

test("V1B 95 F3 state-shared present: a dependency is present only at HEAD and in the tree; a line an earlier fixer made counts; free text does not", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write("pubspec.yaml", "dependencies:\n  a: ^1.0.0\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "pub");
  const add = (changes) => verb(w.root, ["state-shared", PHASE_DIR], { op: "add", changes });
  await add([{ key: "k1", from: "01-01", path: "pubspec.yaml", change: "pubspec.yaml: dependency a ^1.0.0" }, { key: "k1", from: "01-01", path: "config/x.json", change: "config/x.json: add key y" }]);
  w.write("pubspec.yaml", "dependencies:\n  b: ^2.0.0\n");
  await add([{ key: "k2", from: "01-01", path: "pubspec.yaml", change: "pubspec.yaml: dependency b ^2.0.0" }]);
  const r = await verb(w.root, ["state-shared", PHASE_DIR], { op: "present", ids: ["S1", "S2", "S3"] });
  assert.equal(r.json.status, "ok");
  assert.deepEqual(r.json.present, [], "S1: the tree no longer declares a; S2: free text; S3: b is not at HEAD");
  await verb(w.root, ["state-shared", PHASE_DIR], { op: "applied", ids: ["S2"] });
  await add([{ key: "k3", from: "01-02", path: "config/x.json", change: "config/x.json: add key y" }]);
  const again = await verb(w.root, ["state-shared", PHASE_DIR], { op: "present", ids: ["S4"] });
  assert.deepEqual(again.json.present.map((x) => x.id), ["S4"]);
  assert.match(again.json.present[0].evidence, /made by an earlier shared change/);
});

test("V1B 95 exec-shared-before picks the declared changes of the wave that no open plan owns and that do not wait for the code", async () => {
  const w = makeExecWorld({ waves: [[task("01-01"), task("01-02")]] });
  await verb(w.root, ["state-shared", PHASE_DIR], { op: "add", changes: [
    { key: "w1:01-01:a", from: "01-01", path: "config/a.json", change: "config/a.json: add" },
    { key: "w1:01-01:b", from: "01-01", path: "src/01-02/x.js", change: "src/01-02/x.js: export x" },
    { key: "w1:01-01:c", from: "01-01", path: "lib/main.dart", change: "lib/main.dart: call AppBootstrap; apply with the tracer segment when AppBootstrap exists" },
    { key: "w2:01-02:d", from: "01-02", path: "config/d.json", change: "config/d.json: add" },
    { from: "01-01", path: "config/req.json", change: "a request" },
  ] });
  const plans = [{ id: "01-01", owns: ["Path:src/01-01/"] }, { id: "01-02", owns: ["Path:src/01-02/"] }];
  const r = await verb(w.root, ["exec-shared-before", PHASE_DIR], { waveId: "w1", plans });
  assert.deepEqual(r.json.ids, ["S1"]);
  assert.deepEqual(r.json.later.map((x) => [x.id, x.why]), [["S2", "an open plan owns its file (01-02)"], ["S3", "its text waits for the plan's code"]]);
});

test("V1B 95 dependency-seed with shared: the applied shared files that differ from HEAD, next to the earlier transfers", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write("config/a.json", "{}\n");
  w.git("add", "-A");
  w.git("commit", "-qm", "a");
  await verb(w.root, ["state-shared", PHASE_DIR], { op: "add", changes: [{ from: "01-01", path: "config/a.json", change: "x" }, { from: "01-01", path: "config/b.json", change: "y" }, { from: "01-01", path: "config/c.json", change: "z" }] });
  await verb(w.root, ["state-shared", PHASE_DIR], { op: "applied", ids: ["S1", "S2"] });
  w.write("config/b.json", "{\"b\":1}\n");
  let r = await verb(w.root, ["dependency-seed", PHASE_DIR], { plans: [], shared: true });
  assert.deepEqual(r.json.files.map((f) => f.path), ["config/b.json"], "a.json equals HEAD, c.json is not applied");
  w.write("config/a.json", "{\"a\":2}\n");
  r = await verb(w.root, ["dependency-seed", PHASE_DIR], { plans: [], shared: true });
  assert.deepEqual(r.json.files.map((f) => f.path), ["config/a.json", "config/b.json"]);
  assert.deepEqual((await verb(w.root, ["dependency-seed", PHASE_DIR], { plans: [] })).json.files, [], "without shared: as before");
});

test("V1B 95 F2 the owns probe names a <shared_changes> wave timing gsd-execute cannot honour; an honoured one is no issue", async () => {
  const body = (line) => planText({ id: "02", wave: 2, files: "[src/b.js]", owns: "[\"Path:src/b.js\"]" }).replace("<tasks>", `<shared_changes>\n${line}\n</shared_changes>\n\n<tasks>`);
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: planText(), [`${P1}/01-02-PLAN.md`]: body("config/app.json: add the intent; apply before wave 1") } });
  const bad = await gsd(p, ["check", "owns", "1"]);
  assert.deepEqual(bad.json.issues.map((i) => [i.plan, i.kind]), [["01-02", "shared-timing"]]);
  assert.match(bad.json.issues[0].message, /asks for "before wave 1": gsd-execute makes a plan's shared changes before its own wave 2/);
  p.write(`${P1}/01-02-PLAN.md`, body("config/app.json: add the intent; apply before wave 2"));
  const ok = await gsd(p, ["check", "owns", "1"]);
  assert.equal(ok.json.issues, undefined);
  assert.equal(bad.code, ok.code, "an issue does not change the exit code of check owns");
  p.write(`${P1}/01-02-PLAN.md`, body("config/app.json: add the intent after wave 3"));
  assert.equal((await gsd(p, ["check", "owns", "1"])).json.issues.length, 1);
  // plan-probes counts it as an owns blocker for the reviser.
  const probes = await verb(p.root, ["plan-probes"], { runs: { owns: { code: bad.code, json: bad.json } } });
  assert.ok(probes.json.found.some((f) => f.probe === "owns" && f.plan === "01-02" && f.severity === "blocker" && /shared_changes/.test(f.description)), JSON.stringify(probes.json.found));
});
