// Kit feedback 118 F1-F3, 126 F1-F3 and WildEraV6 8, 11: dead runs, a committed phase's worktrees, orphans, auto memory, test file args.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { fileTestArgvs } from "../../ship/.agents/harness/adapter/contract.mjs";
import { runTestFileProbe } from "../../ship/.agents/harness/adapter/lint-probes.mjs";
import { RUNNER_START_SLACK_MS, processStartTimes, runnerLive } from "../../ship/.agents/harness/lib/proc.mjs";
import { runsCommand } from "../../ship/.agents/harness/workflow/cmd-runs.mjs";
import { runGit } from "../../ship/.agents/harness/runtime/worktrees.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";
import { pathToFileURL } from "node:url";

const { runGsd } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/harness/gsd/commands.mjs")).href);
const { main: flowMain } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const NODE = process.execPath;

test("H118 118 F1 a running record whose pid is gone is dead, with its last phase and log line", async () => {
  const s = setup();
  s.project.write("_workspace/_runs/wf_dead/log.txt", "phase Execute\nagent done #2 exec null (stopped)\n");
  s.project.writeJson("_workspace/_runs/wf_dead/run.json", { runId: "wf_dead", status: "running", pid: 999999, startedAt: "2026-10-22T10:00:00.000Z", name: "gsd-plan" });
  s.project.writeJson("_workspace/_runs/wf_live/run.json", { runId: "wf_live", status: "running", pid: process.pid, startedAt: new Date().toISOString(), name: "gsd-execute" });
  const r = await s.ph(["runs"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^wf_dead dead 2026-10-22T10:00:00.000Z gsd-plan last: phase Execute; agent done #2 exec null \(stopped\)$/m);
  assert.match(r.stdout, /^wf_live running /m);
  const liveOnly = await s.ph(["runs", "--live"]);
  assert.match(liveOnly.stdout, /^wf_live running /m);
  assert.doesNotMatch(liveOnly.stdout, /wf_dead/);
  assert.match(liveOnly.stdout, /runs: 1 listed, 0 removed/);
});

test("H118 118 F1 a live pid that started after the run is dead (the pid was reused)", async () => {
  const s = setup();
  const dir = s.project.path("_workspace/_runs/wf_reused");
  s.project.writeJson("_workspace/_runs/wf_reused/run.json", { runId: "wf_reused", status: "running", pid: process.pid, startedAt: "2020-01-01T00:00:00.000Z", name: "gsd-plan" });
  s.project.write("_workspace/_runs/wf_reused/log.txt", "phase Gate\n");
  const lines = [];
  const code = await runsCommand({
    root: s.root, cfg: loadConfig(s.root), opts: {}, out: (l) => lines.push(l),
  }, { startsOf: () => new Map([[process.pid, Date.parse("2026-10-25T00:00:00.000Z")]]) });
  assert.equal(code, 0);
  assert.match(lines[0], /^wf_reused dead 2020-01-01T00:00:00.000Z gsd-plan last: phase Gate$/);
  assert.equal(runnerLive({ status: "running", pid: process.pid, startedAt: new Date().toISOString() }, { starts: new Map([[process.pid, Date.now() - 1000]]) }), true);
  assert.equal(runnerLive({ status: "running", pid: process.pid, startedAt: new Date(Date.now() - RUNNER_START_SLACK_MS - 5000).toISOString() }, { starts: new Map([[process.pid, Date.now()]]) }), false);
  assert.equal(fs.existsSync(dir), true);
});

test("H118 118 F3 ph runs --prune removes dead running records and keeps a live one, a paused one and a failed one", async () => {
  const s = setup();
  s.project.writeJson("_workspace/_runs/wf_dead/run.json", { runId: "wf_dead", status: "running", pid: 999999, startedAt: "2026-10-22T10:00:00.000Z", name: "gsd-plan" });
  s.project.writeJson("_workspace/_runs/wf_live/run.json", { runId: "wf_live", status: "running", pid: process.pid, startedAt: new Date().toISOString(), name: "gsd-execute" });
  s.project.writeJson("_workspace/_runs/wf_pause/run.json", { runId: "wf_pause", status: "paused", pid: 999999, startedAt: "2026-10-21T10:00:00.000Z", name: "gsd-execute" });
  s.project.writeJson("_workspace/_runs/wf_fail/run.json", { runId: "wf_fail", status: "failed", pid: 999999, startedAt: "2026-10-21T09:00:00.000Z", name: "gsd-plan" });
  const r = await s.ph(["runs", "--prune"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^removed wf_dead$/m);
  assert.equal(fs.existsSync(s.project.path("_workspace/_runs/wf_dead")), false);
  assert.equal(fs.existsSync(s.project.path("_workspace/_runs/wf_live")), true);
  assert.equal(fs.existsSync(s.project.path("_workspace/_runs/wf_pause")), true);
  assert.equal(fs.existsSync(s.project.path("_workspace/_runs/wf_fail")), true);
});

test("H118 118 F3 ph doctor names dead running records and ph runs --prune", async () => {
  const s = setup();
  const quiet = await s.ph(["doctor"]);
  assert.doesNotMatch(quiet.stdout, /dead running record/);
  s.project.writeJson("_workspace/_runs/wf_old/run.json", { runId: "wf_old", status: "running", pid: 999999, startedAt: "2026-10-22T10:00:00.000Z", name: "gsd-plan" });
  const r = await s.ph(["doctor"]);
  assert.match(r.stdout, /note 1 dead running record\(s\) \(wf_old\): the runner is gone; ph runs --prune removes them/);
});

test("H118 W8 the kit env disables auto memory, and a truthy value is what Claude Code treats as off", () => {
  const cfg = loadConfig(setup().root);
  assert.equal(cfg.agent_provider_env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(cfg.agent_provider_env.ENABLE_TOOL_SEARCH, "true");
  const started = processStartTimes([process.pid]);
  const at = started.get(process.pid);
  assert.equal(typeof at, "number");
  assert.ok(at <= Date.now() + 5000 && at > Date.now() - 24 * 60 * 60 * 1000, String(at));
});

function phase(s, committed) {
  s.project.writeJson(".planning/phases/05-app/handoff/05-w1.args.json", { tasks: [{ plan: "05-01" }, { plan: "05-02" }] });
  if (committed) s.project.writeJson(".planning/phases/05-app/commits.json", [{ sha: "abc1234", plans: { "05-01": ["a.js"], "05-02": ["b.js"] } }]);
  else s.project.writeJson(".planning/phases/05-app/commits.json", [{ sha: "abc1234", plans: { "05-01": ["a.js"] } }]);
}

function addTree(s, name) {
  const dir = path.join(s.root, ".claude", "worktrees", name);
  s.project.git("worktree", "add", dir, "-b", `harness/${name}`);
  return dir;
}

test("H118 126 F1 --committed-phase removes a phase's dirty executor worktree after archiving, and never follows a junction", async () => {
  const s = setup({ git: true });
  phase(s, true);
  const name = "wf_20261024-120000_abcd-1";
  const dir = addTree(s, name);
  fs.writeFileSync(path.join(dir, "late.txt"), "untransferred delta\n");
  const outside = makeTempDir("h118 outside ");
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep");
  fs.symlinkSync(outside, path.join(dir, "upstream"), "junction");
  s.project.writeJson("_workspace/_runs/wf_20261024-120000_abcd/run.json", { status: "done", pid: 1, runId: "wf_20261024-120000_abcd" });
  s.project.writeJson("_workspace/_runs/wf_20261024-120000_abcd/args.json", { phaseDir: ".planning/phases/05-app" });
  const other = addTree(s, "wf_20261024-130000_eeee-1");
  fs.writeFileSync(path.join(other, "stay.txt"), "other phase\n");
  const r = await s.ph(["worktrees", "--prune", "--committed-phase", "5"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /phase 5 is committed \(05-app\)/);
  assert.match(r.stdout, /removed wf_20261024-120000_abcd-1/);
  assert.match(r.stdout, /archived /);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep");
  assert.equal(fs.existsSync(other), true, "a worktree of another phase stays");
  const archive = fs.readdirSync(s.project.path("_workspace/worktree-archive")).filter((n) => n.includes("wf_20261024-120000_abcd-1"));
  assert.equal(archive.length, 1);
  assert.match(fs.readFileSync(s.project.path(`_workspace/worktree-archive/${archive[0]}`), "utf8"), /untransferred delta/);
  assert.doesNotMatch(fs.readFileSync(s.project.path(`_workspace/worktree-archive/${archive[0]}`), "utf8"), /precious/);
});

test("H118 126 F1 a phase that is not committed keeps its executor worktrees", async () => {
  const s = setup({ git: true });
  phase(s, false);
  const dir = addTree(s, "wf_20261024-120000_abcd-1");
  fs.writeFileSync(path.join(dir, "late.txt"), "still working\n");
  s.project.writeJson("_workspace/_runs/wf_20261024-120000_abcd/run.json", { status: "done", pid: 1, runId: "wf_20261024-120000_abcd" });
  s.project.writeJson("_workspace/_runs/wf_20261024-120000_abcd/args.json", { phaseDir: ".planning/phases/05-app" });
  const r = await s.ph(["worktrees", "--prune", "--committed-phase", "05"]);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /phase 05 is not committed \(05-app: plans not committed: 05-02\)/);
  assert.equal(fs.existsSync(path.join(dir, "late.txt")), true);
  const bare = await s.ph(["worktrees", "--committed-phase", "05"]);
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /--committed-phase needs --prune/);
});

test("H118 126 F2 an unregistered worktree directory is an orphan and prune removes it without running git there", async () => {
  const s = setup({ git: true });
  const orphan = path.join(s.root, ".claude", "worktrees", "wf_20261024-140000_ffff");
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, "only-here.txt"), "orphan delta\n");
  const outside = makeTempDir("h118 orphan ");
  fs.writeFileSync(path.join(outside, "precious.txt"), "keep");
  fs.symlinkSync(outside, path.join(orphan, "upstream"), "junction");
  fs.mkdirSync(path.join(outside, "nested"));
  fs.writeFileSync(path.join(outside, "nested", "deep.txt"), "deep");
  const calls = [];
  const spy = (cwd, args) => {
    calls.push(path.resolve(cwd));
    return runGit(cwd, args);
  };
  const { worktrees } = await import("../../ship/.agents/harness/runtime/cmd-worktrees.mjs");
  const lines = [];
  const code = await worktrees({
    root: s.root, cfg: loadConfig(s.root), opts: { prune: true }, out: (l) => lines.push(l), paseo: async () => { throw new Error("no daemon"); },
  }, { git: spy });
  assert.equal(code, 0, lines.join("\n"));
  assert.ok(lines.some((l) => /^orphan\s+- .*wf_20261024-140000_ffff \(owner unknown\)$/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /removed orphan wf_20261024-140000_ffff/.test(l)), lines.join("\n"));
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), "keep");
  assert.equal(fs.readFileSync(path.join(outside, "nested", "deep.txt"), "utf8"), "deep");
  assert.ok(!calls.some((c) => c === path.resolve(orphan)), calls.join("\n"));
  const patch = fs.readdirSync(s.project.path("_workspace/worktree-archive"));
  assert.match(fs.readFileSync(s.project.path(`_workspace/worktree-archive/${patch[0]}`), "utf8"), /orphan delta/);
});

test("H118 126 F3 gsd-execute's last log names kept worktrees and the prune command", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { isolation: "worktree" } } });
  let first = null;
  const commit = w.gsd.handlers.commit;
  w.gsd.on("commit", (argv, input) => {
    if (first) fs.writeFileSync(path.join(w.root, first, "late.txt"), "after the transfer\n");
    return commit(argv, input);
  });
  const r = await runScript("gsd-execute", {
    root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd,
    agent: executor(w, { "exec-01-01": (_p, _o, n, calls) => { first = calls.find((c) => c.n === n).worktree; } }),
  });
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.result.worktrees.kept.length, 1);
  const line = r.logs.find((l) => l.includes("ph worktrees --prune --committed-phase"));
  assert.ok(line, r.logs.join("\n"));
  assert.match(line, /kept 1 executor worktree\(s\): 01-01 /);
  assert.match(line, /ph worktrees --prune --committed-phase 01 removes them once this phase's waves are committed/);
});

test("H118 W11 test_file_args maps files to filters; the path is not appended", () => {
  const commands = { test: ["node", "tools/ue-test.mjs"] };
  assert.deepEqual(fileTestArgvs(commands, ["Tests/Foo.cpp", "Tests/Bar.cpp"], commands.test), [
    ["node", "tools/ue-test.mjs", "Tests/Foo.cpp"],
    ["node", "tools/ue-test.mjs", "Tests/Bar.cpp"],
  ]);
  const mapped = { ...commands, test_file_args: ["node", "tools/ue-test.mjs", "--files", "{files}"] };
  assert.deepEqual(fileTestArgvs(mapped, ["Tests/Foo.cpp", "Tests/Bar.cpp"]), [["node", "tools/ue-test.mjs", "--files", "Tests/Foo.cpp", "Tests/Bar.cpp"]]);
  const rule = { ...commands, test_file_args: { filter: "WildEra.{stem}" } };
  assert.deepEqual(fileTestArgvs(rule, ["game/Tests/Foo.cpp", "game/Tests/Bar.cpp"]), [["node", "tools/ue-test.mjs", "WildEra.Foo+WildEra.Bar"]]);
  const each = { ...commands, test_file_args: { filter: "{stem}", argv: ["node", "tools/ue-test.mjs", "{file}"] } };
  assert.deepEqual(fileTestArgvs(each, ["Tests/Foo.cpp"]), [["node", "tools/ue-test.mjs", "Tests/Foo.cpp"]]);
});

test("H118 W11 test-run and the gate use test_file_args instead of the source path", async () => {
  const runner = `import fs from "node:fs";
fs.appendFileSync("got.txt", process.argv.slice(2).join(" ") + "\\n");
if (process.argv.slice(2).some((a) => a.includes("/") || a.endsWith(".js"))) { console.error("refused " + process.argv.slice(2).join(" ")); process.exit(2); }
console.log("ok");
`;
  const commands = {
    build: [NODE, "-e", "process.exit(0)"], test: [NODE, "tools/run.mjs"], build_timeout_s: 30, test_timeout_s: 30,
    gates: [], verify: {}, test_file_args: { filter: "Only.{stem}" },
  };
  const p = makeTempProject({ files: { "tools/run.mjs": runner, "test/a.test.js": "a\n", "test/b.test.js": "b\n" }, overlay: { adapter: { commands } } });
  let out = "";
  let written = "";
  const code = await runGsd(["test-run", "test/a.test.js", "test/b.test.js"], { root: p.root, out: (l) => { out += `${l}\n`; }, write: (t) => { written += t; }, err: () => {} });
  assert.equal(code, 0, out + written);
  assert.equal(p.read("got.txt").trim(), "Only.a.test+Only.b.test");
  assert.match(written, /test-run 2 file\(s\)/);
  let line = "";
  const g = await flowMain(["gate", ".planning/phases/03-api"], {
    root: p.root,
    input: JSON.stringify({ waveId: "w1", plans: [{ id: "03-01", owns: ["Path:test/"], verify: [{ task: "1", kind: "cmd", command: `cmd: "${NODE}" tools/run.mjs test/a.test.js test/b.test.js` }] }] }),
    out: (l) => { line = l; },
  });
  assert.equal(g, 0, line);
  const ev = JSON.parse(line);
  assert.equal(ev.green, true, line);
  assert.match(p.read("got.txt"), /Only\.a\.test\+Only\.b\.test/);
  const bad = makeTempProject({ overlay: { adapter: { commands: { ...commands, test_file_args: "nope" } } } });
  assert.throws(() => loadConfig(bad.root), /test_file_args/);
});

test("H118 W11 ph harness lint fails when test_file_args is refused and accepts a command that exits 0", async () => {
  const cfg = { adapter: { commands: { test: ["node", "tools/run.mjs"], test_file_args: { filter: "Only.{stem}" } }, checks: {} } };
  const root = makeTempProject({ files: { "test/a.test.js": "a\n", "tools/run.mjs": "process.exit(0)\n" } }).root;
  const refused = await runTestFileProbe(root, cfg, { run: async (argv) => ({ code: 2, stdout: "", stderr: "refused " + argv.at(-1), timedOut: false }) });
  assert.equal(refused.length, 1);
  assert.match(refused[0].msg, /adapter\.commands\.test_file_args: `node tools\/run\.mjs Only\.a\.test` refuses test\/a\.test\.js \(exit 2: refused Only\.a\.test\)/);
  assert.deepEqual(await runTestFileProbe(root, cfg, { run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }) }), []);
  assert.deepEqual(await runTestFileProbe(root, cfg, { run: async () => ({ code: null, stdout: "", stderr: "", timedOut: true }) }), []);
});
