// The adapter contract (ADPT-01..17): config section, helpers the core calls by name, hooks, mutex, evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { loadConfig, loadKitConfig, GSD_ROLES } from "../../ship/.agents/harness/config.mjs";
import { runArgv } from "../../ship/.agents/harness/lib/proc.mjs";
import * as C from "../../ship/.agents/harness/adapter/contract.mjs";
import { invokeHook, hookArgv } from "../../ship/.agents/harness/adapter/hooks.mjs";
import { withMutex } from "../../ship/.agents/harness/adapter/mutex.mjs";
import { currentInputs, evidenceVerdict } from "../../ship/.agents/harness/adapter/evidence.mjs";
import { lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";

const kit = () => loadKitConfig();
const withAdapter = (entries) => loadConfig(makeTempProject({ git: false, overlay: { adapter: entries } }).root);
const ECHO_ARGS = "console.log(JSON.stringify(process.argv.slice(1)))";
const VOCAB = (extra = {}) => ({
  build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
  cmd: { prefix: "cmd:", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
  ...extra,
});
const COMMANDS = (extra = {}) => ({ build: null, test: null, build_timeout_s: 300, test_timeout_s: 600, gates: [], verify: {}, smoke_builds: [], ...extra });
// F57: the shipped smoke triggers (harness.defaults.json adapter.smoke_triggers).
const SMOKE_TRIGGERS = ["**/pubspec.yaml", "**/pubspec.lock", "**/package.json", "**/package-lock.json", "**/Cargo.toml", "**/Cargo.lock", "**/go.mod", "**/go.sum", "**/pyproject.toml", "**/requirements*.txt", "**/Podfile", "**/Podfile.lock", "**/build.gradle*", "**/settings.gradle*", "**/CMakeLists.txt"];

test("ADPT-01 the adapter lives in the overlay, is validated closed and .planning/config.json is ignored", () => {
  const p = makeTempProject({ git: false, overlay: { adapter: { unknown_key: 1 } } });
  assert.throws(() => loadConfig(p.root), /^Error: invalid harness config adapter\.unknown_key: unknown key$|invalid harness config adapter\.unknown_key: unknown key/);
  const q = makeTempProject({ git: false, files: { ".planning/config.json": JSON.stringify({ adapter: { mutex: "x" }, gsd: { granularity: "fine" } }) } });
  const cfg = loadConfig(q.root);
  assert.equal(cfg.adapter.mutex, null);
  assert.equal(cfg.gsd.granularity, "standard");
});

test("ADPT-02 null commands are not configured; argv runs without a shell", async () => {
  assert.deepEqual(C.commandFor(kit(), "test"), { configured: false, argv: null, timeoutS: null });
  const cfg = withAdapter({ commands: COMMANDS({ test: [process.execPath, "-e", ECHO_ARGS, "a;b", "c d"] }) });
  const t = C.commandFor(cfg, "test");
  assert.equal(t.timeoutS, 600);
  const res = await runArgv(t.argv, {});
  assert.deepEqual(JSON.parse(res.stdout), ["a;b", "c d"]);
});

test("ADPT-03 prefixes give kinds; runner placeholders keep targets as single argv elements", async () => {
  const k = kit();
  assert.equal(C.classifyObligation(k, "build").kind, "build");
  assert.deepEqual({ ...C.classifyObligation(k, "cmd: node tools/check.mjs"), entry: undefined }, { kind: "cmd", argument: "node tools/check.mjs", entry: undefined });
  assert.equal(C.classifyObligation(k, "test: login works"), null);
  assert.deepEqual(C.obligationCommand(k, { kind: "cmd", argument: 'node "my tool.mjs" --x' }).argv, ["node", "my tool.mjs", "--x"]);
  assert.equal(C.obligationCommand(k, { kind: "build" }).configured, false);
  const cfg = withAdapter({
    commands: COMMANDS({ verify: { runner: { argv: [process.execPath, "-e", ECHO_ARGS, "filter={argument}", "{targets}"], timeout_s: 60 } } }),
    verify_vocabulary: VOCAB({ test: { prefix: "test:", parser: null, resolver: null, runner: "runner", evidence_parser: null, exit_code_sufficient: false } }),
  });
  const ob = C.classifyObligation(cfg, "test: login flow");
  assert.equal(ob.kind, "test");
  assert.deepEqual(C.defaultTargets(ob.argument), ["login flow"]);
  const run = C.obligationCommand(cfg, { kind: "test", argument: ob.argument, targets: ["login flow", "b"] });
  assert.deepEqual(JSON.parse((await runArgv(run.argv, {})).stdout), ["filter=login flow", "login flow", "b"]);
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "check.mjs"), "");
  assert.equal(C.resolveCmdTarget(root, "node check.mjs").status, "ok");
  assert.equal(C.resolveCmdTarget(root, "node gone/x.mjs").status, "missing");
});

test("ADPT-04 owns forms map to globs and shared globs mark shared files", () => {
  assert.equal(C.ownsGlob(kit(), "Path:pkg/"), "pkg/**");
  assert.equal(C.ownsGlob(kit(), "Path:src/a.js"), "src/a.js");
  assert.equal(C.ownsGlob(kit(), "Module:Core"), null);
  assert.ok(C.matchesGlob("pkg/a.lock", C.ownsGlob(kit(), "Path:pkg/")));
  assert.equal(C.isSharedByGlobs(kit(), "pkg/a.lock"), false);
  const cfg = withAdapter({ ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: ["**/*.lock"], predicate: null }, source_roots: [] } });
  assert.equal(C.isSharedByGlobs(cfg, "pkg/a.lock"), true);
  assert.equal(C.isSharedByGlobs(cfg, "pkg/a.js"), false);
});

test("ADPT-05 review lenses apply to their stage and matching files only", () => {
  assert.deepEqual(C.lensesFor(kit(), { file: "a.js" }), []);
  const cfg = withAdapter({ review_lenses: [
    { name: "security", text: "check auth", applies_to: ["src/auth/**"] },
    { name: "perf", text: "check loops", stage: "code", applies_to: ["src/db/**"] },
    { name: "fidelity", text: "skeleton", stage: "skeleton" },
  ] });
  assert.deepEqual(C.lensesFor(cfg, { file: "src/auth/login.js" }).map((l) => l.name), ["security"]);
  assert.deepEqual(C.lensesFor(cfg, { file: "src/db/q.js" }).map((l) => l.name), ["perf"]);
  assert.deepEqual(C.lensesFor(cfg, { file: "README.md" }), []);
  assert.deepEqual(C.lensesFor(cfg, { stage: "skeleton" }).map((l) => l.name), ["fidelity"]);
});

test("ADPT-06 syntax checkers are looked up by extension; others spawn nothing", () => {
  const cfg = withAdapter({ syntax_checkers: { ".json": { argv: ["node", "check.mjs"] } } });
  assert.deepEqual(C.syntaxCheckerFor(cfg, "a/b.JSON").argv, ["node", "check.mjs"]);
  assert.equal(C.syntaxCheckerFor(cfg, "notes.txt"), null);
  assert.equal(C.syntaxCheckerFor(kit(), "a.json"), null);
});

test("ADPT-07 instruction files resolve against the code root", () => {
  const cfg = withAdapter({ instructions: ["docs/rules.md"] });
  assert.deepEqual(C.instructionFiles(cfg, "/code root"), [path.resolve("/code root", "docs/rules.md")]);
});

test("ADPT-08 the envelope adds the axes block and the rule line, absent both are omitted", () => {
  assert.equal(C.envelopeBlock(kit()), null);
  const cfg = withAdapter({ envelope: [{ axis: "node", values: [20, 24], source: "package.json" }, { axis: "items", range: [0, 10000], source: "spec" }] });
  assert.deepEqual(C.envelopeBlock(cfg), {
    axes: "Operating envelope:\n- node: values 20, 24 (source: package.json)\n- items: range 0 .. 10000 (source: spec)",
    rule: "Judge a fix against the declared envelope, not one sample point.",
  });
});

test("ADPT-09 stack skill line, project agent types and missing agents", () => {
  assert.equal(C.stackSkillLine(kit()), null);
  const p = makeTempProject({ git: false, overlay: { adapter: { stack_skill: "web-stack", agents: { executor: "my-coder" } } } });
  const cfg = loadConfig(p.root);
  assert.match(C.stackSkillLine(cfg), /^Follow the web-stack skill/);
  assert.equal(C.agentTypeFor(cfg, "executor", "gsd-executor"), "my-coder");
  assert.equal(C.agentTypeFor(cfg, "reviewer", "gsd-code-reviewer"), "gsd-code-reviewer");
  assert.equal(C.wiringEnabled(cfg), false);
  const msgs = lintProject(p.root).findings.map((f) => f.msg);
  assert.ok(msgs.includes("adapter.agents.executor: agent type my-coder has no .agents/agents/my-coder.md"));
  assert.ok(msgs.includes("adapter.stack_skill web-stack: no .claude/skills/web-stack/SKILL.md"));
});

test("ADPT-10 a named mutex runs heavy commands one at a time and reports the wait once", async () => {
  const tmp = makeTempDir();
  const lines = [];
  const heavy = () => new Promise((resolve) => setTimeout(resolve, 300));
  const started = Date.now();
  await Promise.all([withMutex("build lock", heavy, { log: (l) => lines.push(l), tmp }), withMutex("build lock", heavy, { log: (l) => lines.push(l), tmp })]);
  assert.ok(Date.now() - started >= 580, "the two runs did not overlap");
  assert.deepEqual(lines, ["waiting for mutex build lock"]);
  assert.equal(fs.readdirSync(tmp).length, 0, "the lock is released");
  assert.equal(await withMutex(null, () => 7), 7);
});

test("ADPT-10 a lock left by a dead process is taken over", async () => {
  const tmp = makeTempDir();
  const dir = path.join(tmp, "ph-mutex-m.lock");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "owner"), JSON.stringify({ pid: 999999999, token: "dead" }));
  const lines = [];
  assert.equal(await withMutex("m", () => "ran", { log: (l) => lines.push(l), tmp }), "ran");
  assert.deepEqual(lines, []);
});

test("ADPT-11 roles resolve per entry; the defaults name no concrete model id", () => {
  const k = kit();
  assert.deepEqual(k.gsd.roles, {});
  for (const t of Object.values(k.tiers)) assert.equal(t.provider, "");
  assert.ok(!JSON.stringify(k.gsd).match(/"[a-z-]+\/[\w.[\]-]+"/), "no provider/model in the gsd defaults");
  assert.equal(GSD_ROLES.length, 21);
  const cfg = loadConfig(makeTempProject({ git: false, overlay: { gsd: { roles: { checker: { model: "pro", reason: "deeper checks" }, custom_role: { effort: "low", reason: "r" } } } } }).root);
  assert.equal(cfg.gsd.roles.checker.model, "pro");
  assert.equal(cfg.gsd.roles.custom_role.effort, "low");
  assert.throws(() => loadConfig(makeTempProject({ git: false, overlay: { gsd: { roles: { checker: { effort: "huge" } } } } }).root), /gsd\.roles\.checker\.effort/);
});

test("ADPT-12 granularity and plan limits default conservatively and a whole entry overrides", () => {
  assert.equal(kit().gsd.granularity, "standard");
  assert.deepEqual(kit().gsd.plan_limits, { tasks_per_plan: 3, plans_per_phase: 12, waves_per_phase: 4 });
  const cfg = loadConfig(makeTempProject({ git: false, overlay: { gsd: { plan_limits: { tasks_per_plan: 3, plans_per_phase: 15, waves_per_phase: 4 } } } }).root);
  assert.equal(cfg.gsd.plan_limits.plans_per_phase, 15);
  assert.equal(cfg.gsd.granularity, "standard");
  assert.throws(() => loadConfig(makeTempProject({ git: false, overlay: { gsd: { granularity: "tiny" } } }).root), /gsd\.granularity/);
});

test("ADPT-13 the gsd section holds exactly the documented keys and ranges are validated", () => {
  assert.deepEqual(Object.keys(kit().gsd).sort(), ["batch_review", "branching", "code_review", "commit_policy", "debug", "drift_threshold", "execution_mode", "fixer", "fixer_verifies_itself",
    "granularity", "isolation", "map_mode", "max_check_iterations", "max_skeleton_passes", "max_verify_rounds", "parallelization", "plan_flow", "plan_limits", "plan_review",
    "protected_branches", "requirement_id_regex", "research", "research_ahead", "review_depth", "roles", "skeleton_lanes", "tracer_extra_files", "verify_mode"]);
  assert.deepEqual(Object.keys(kit().gsd).sort(), ["batch_review", "branching", "code_review", "commit_policy", "debug", "drift_threshold", "execute_schedule", "execution_mode", "fixer", "fixer_verifies_itself",
    "granularity", "isolation", "max_check_iterations", "max_skeleton_passes", "max_verify_rounds", "parallelization", "plan_limits", "plan_review", "protected_branches",
    "requirement_id_regex", "research", "review_depth", "roles", "skeleton_lanes", "tracer_extra_files"]);
  const k = kit();
  assert.deepEqual([k.gsd.isolation, k.gsd.execution_mode, k.gsd.review_depth, k.adapter.hook_timeout_s, k.adapter.attribution], ["worktree", "per-wave", "standard", 30, null]);
  assert.deepEqual(k.adapter.startup_globs, []);
  assert.throws(() => loadConfig(makeTempProject({ git: false, overlay: { gsd: { max_check_iterations: 4 } } }).root), /gsd\.max_check_iterations/);
});

test("ADPT-14 absent entries take the defaults; a partial nested entry fails naming the missing keys", () => {
  assert.deepEqual(loadConfig(makeTempProject({ git: false, overlay: {} }).root).adapter, kit().adapter);
  const fail = (overlay, re) => assert.throws(() => loadConfig(makeTempProject({ git: false, overlay }).root), re);
  fail({ gsd: { plan_limits: { plans_per_phase: 15 } } }, (e) => /tasks_per_plan/.test(e.message) && /waves_per_phase/.test(e.message));
  fail({ adapter: { commands: { build: ["make"] } } }, /adapter\.commands\.test.*missing key|missing key/);
  fail({ gsd: { debug: { max_turns: 4 } } }, /gsd\.debug\.minutes/);
  fail({ gsd: { fixer: { minutes: 4 } } }, /gsd\.fixer\.max_build_attempts/);
  fail({ gsd: { commit_policy: { docs: true } } }, /gsd\.commit_policy\.code/);
  const cfg = loadConfig(makeTempProject({ git: false, overlay: { adapter: { mutex: "heavy" } } }).root);
  assert.equal(cfg.adapter.mutex, "heavy");
  assert.deepEqual(cfg.adapter.commands, kit().adapter.commands);
});

const HOOK = `const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  const req = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (req.kind === "sleep") setTimeout(() => {}, 60000);
  else if (req.kind === "garbage") console.log("not json");
  else if (req.kind === "v2") console.log(JSON.stringify({ v: 2, targets: [] }));
  else if (req.kind === "exit") process.exit(3);
  else if (req.op === "parse") console.log(JSON.stringify({ v: 1, targets: [req.codeRoot, req.argument] }));
  else if (req.op === "resolve") console.log(JSON.stringify({ v: 1, results: req.targets.map((t) => ({ target: t, status: t === "gone" ? "missing" : "ok" })) }));
  else if (req.op === "shared") console.log(JSON.stringify({ v: 1, shared: req.paths.filter((p) => p.endsWith(".lock")) }));
  else if (req.op === "evidence") console.log(JSON.stringify({ v: 1, executed: { count: 0, targets: [] }, failed: [], outcome: "failed" }));
  else if (req.op === "attribute") console.log(JSON.stringify({ v: 1, assignments: req.failures.map((f) => ({ failure: f.text, plan: null })) }));
});
`;

test("ADPT-15 adapter hooks get one JSON request and must answer v:1 with the closed shape", async () => {
  const root = makeTempDir("adapter code root ");
  fs.mkdirSync(path.join(root, "tools"));
  fs.writeFileSync(path.join(root, "tools", "hook.mjs"), HOOK);
  const cfg = { adapter: { hook_timeout_s: 2 } };
  const call = (op, fields) => invokeHook(cfg, { codeRoot: root, script: "tools/hook.mjs", op, ...fields });
  assert.deepEqual(hookArgv(root, "tools/hook.mjs"), [process.execPath, path.join(root, "tools", "hook.mjs")]);
  assert.deepEqual(hookArgv(root, "tools/check.sh"), [path.join(root, "tools", "check.sh")]);
  assert.deepEqual((await call("parse", { kind: "test", argument: "a b" })).response.targets, [root, "a b"]);
  assert.deepEqual((await call("resolve", { kind: "test", targets: ["x", "gone"], plan: "01", filesModified: [] })).response.results.map((r) => r.status), ["ok", "missing"]);
  assert.deepEqual((await call("shared", { paths: ["a.lock", "b.js"] })).response.shared, ["a.lock"]);
  assert.equal((await call("evidence", { kind: "test", argument: "", targets: [], exitCode: 0, stdoutPath: "o", stderrPath: "e" })).response.outcome, "failed");
  assert.deepEqual((await call("attribute", { failures: [{ text: "boom" }], plans: [] })).response.assignments, [{ failure: "boom", plan: null }]);
  for (const kind of ["sleep", "garbage", "v2", "exit"]) {
    const r = await call("parse", { kind, argument: "" });
    assert.equal(r.ok, false, kind);
    assert.equal(r.status, "unresolvable", kind);
  }
  assert.match((await call("parse", { kind: "sleep", argument: "" })).reason, /no response within 2 s/);
  assert.match((await call("parse", { kind: "v2", argument: "" })).reason, /version 2 is not 1/);
  await assert.rejects(call("parse", { kind: "x" }), /misses argument/);
});

test("ADPT-16 the kit ships a neutral adapter and no project adapter", () => {
  const a = kit().adapter;
  assert.deepEqual(a, {
    commands: COMMANDS(), verify_vocabulary: VOCAB(),
    ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: [], regenerated: [] },
    review_lenses: [], syntax_checkers: {}, instructions: [], envelope: null, stack_skill: null, agents: {}, mutex: null,
    startup_globs: [], smoke_triggers: SMOKE_TRIGGERS, hook_timeout_s: 30, dependency_probe: null, dependency_probe_timeout_s: 300, attribution: null, worktree_setup: { copy: [], link: [] },
  });
  assert.equal(fs.existsSync(path.join(SHIP_DIR, ".agents", "harness.config.json")), false);
  assert.equal(fs.existsSync(path.join(SHIP_DIR, ".agents", "skill-tests")), false);
  const deny = /wildera|unreal|\.uproject|Build\.cs|blueprint graph/i;
  const hits = fs.readdirSync(SHIP_DIR, { recursive: true }).map(String)
    .filter((rel) => fs.statSync(path.join(SHIP_DIR, rel)).isFile() && !rel.includes(`gsd${path.sep}upstream`))
    .filter((rel) => deny.test(rel) || deny.test(fs.readFileSync(path.join(SHIP_DIR, rel), "utf8")));
  assert.deepEqual(hits, []);
});

test("ADPT-17 evidence is green only when complete, passing, executed and current", async () => {
  const p = makeTempProject({ files: { "src/a.js": "1\n", "logs/build.log": "ok\n", "logs/test.log": "ok\n" } });
  const inputs = await currentInputs(p.root, ["src/a.js"]);
  assert.match(inputs.head, /^[0-9a-f]{40}$/);
  const step = (name, extra = {}) => ({ name, argv: ["x"], outcome: "passed", exitCode: 0, executed: { count: null, targets: [] }, log: "logs/build.log", ...extra });
  const write = (steps, ins = inputs) => {
    p.writeJson("ev.json", { v: 1, waveId: "w1", at: "2026-10-20T00:00:00Z", inputs: ins, steps });
    return p.path("ev.json");
  };
  const requested = ["build", { name: "t1", targets: ["login"] }];
  const verdict = (file, ins = inputs) => evidenceVerdict(file, { codeRoot: p.root, requested, inputs: ins });
  const good = write([step("build"), step("t1", { kind: "test", executed: { count: 1, targets: ["login"] }, log: "logs/test.log" })]);
  assert.deepEqual(verdict(good), { verdict: "green", reasons: [] });
  const zero = write([step("build"), step("t1", { executed: { count: 0, targets: [] } })]);
  assert.deepEqual(verdict(zero), { verdict: "failed", reasons: ["t1: executed 0 of 1 target(s)"] });
  assert.equal(verdict(write([step("build", { outcome: "timeout" }), step("t1", { executed: { count: 1, targets: ["login"] } })])).verdict, "failed");
  assert.equal(verdict(write([step("build")])).verdict, "incomplete");
  assert.equal(verdict(write([step("build", { log: "logs/none.log" }), step("t1")])).verdict, "invalid");
  p.write("ev.json", "{");
  assert.equal(verdict(p.path("ev.json")).verdict, "invalid");
  const fresh = write([step("build"), step("t1", { executed: { count: 1, targets: ["login"] } })]);
  p.write("src/a.js", "2\n");
  const after = await currentInputs(p.root, ["src/a.js"]);
  assert.deepEqual(verdict(fresh, after), { verdict: "stale", reasons: ["inputs differ from the current code"] });
});
