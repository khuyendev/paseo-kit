import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { P1, gsd, plan, project } from "./fixture.mjs";

const task = (inner, type = "auto", attrs = "") => `<task type="${type}"${attrs}>\n${inner}\n</task>`;
const okTask = task("<name>T</name><files>src/a.js</files><action>do</action><verify><automated>cmd: node src/a.js</automated><fails_when>exit 1</fails_when></verify><done>d</done>");

async function structure(planText, overlay) {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: planText, "src/a.js": "" }, overlay });
  return (await gsd(p, ["verify", "plan-structure", "1"])).json;
}

test("GSDC-17 init payloads hold paths and flags, never plan bodies; unknown phase exits 69", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-CONTEXT.md`]: "<decisions></decisions>", [`${P1}/01-DISCUSS-CHECKPOINT.json`]: "{}" } });
  for (const wf of ["init.plan-phase", "init.phase-op", "init.execute-phase", "init.verify"]) {
    const r = await gsd(p, [wf, "1"]);
    assert.equal(r.code, 0, wf);
    assert.equal(r.json.context_path, ".planning/phases/01-core/01-CONTEXT.md");
    assert.equal(r.json.has_discuss_checkpoint, true);
    assert.deepEqual(r.json.plans, [".planning/phases/01-core/01-01-PLAN.md"]);
    assert.deepEqual(r.json.phase_req_ids, ["CORE-01", "CORE-02"]);
    assert.equal(r.json.gsd.granularity, "standard");
    assert.doesNotMatch(JSON.stringify(r.json), /<tasks>|<action>/);
  }
  const miss = await gsd(p, ["init.plan-phase", "7"]);
  assert.equal(miss.code, 69);
  assert.match(miss.json.error, /phase not found/);
});

test("GSDC-18 plan-structure: one fixture per error and warning class", async () => {
  const errs = async (text, overlay) => (await structure(text, overlay)).errors;
  const warns = async (text) => (await structure(text)).warnings;
  assert.equal((await structure(plan({ tasks: okTask }))).valid, true);
  assert.ok((await errs(plan({ tasks: okTask }).replace("autonomous: true\n", ""))).includes("Missing required frontmatter field: autonomous"));
  assert.ok((await errs(plan({ tasks: "" }))).includes("No <task> elements found"));
  assert.ok((await errs(plan({ tasks: task("<name>T</name><action>a</action><verify>manual</verify><done>d</done><files>f</files>") }))).includes("No task has an <automated> verify obligation"));
  assert.ok((await errs(plan({ tasks: okTask.replace("<name>T</name>", "") }))).includes("Task 1 missing <name>"));
  assert.ok((await errs(plan({ tasks: okTask.replace("<action>do</action>", "") }))).includes("Task 1 (T): missing <action>"));
  const cp = task("<name>Look</name><what-built>x</what-built><resume-signal>ok</resume-signal>", "checkpoint:human-verify");
  const cpErrs = await errs(plan({ tasks: `${okTask}\n${cp}` }));
  assert.ok(cpErrs.includes("Task 2 (Look): checkpoint:human-verify missing <how-to-verify>"));
  assert.ok(cpErrs.includes("Task 2 (Look): checkpoint task in a plan whose autonomous is not false"));
  const dec = task('<name>Pick</name><decision>d</decision><options><option id="a"></option></options><resume-signal>r</resume-signal>', "checkpoint:decision", ' auto_select="b"');
  assert.ok((await errs(plan({ tasks: `${okTask}\n${dec}` }).replace("autonomous: true", "autonomous: false"))).includes('Task 2 (Pick): auto_select "b" names no option id'));
  const cut = plan({ tasks: okTask }).replace(/<\/tasks>\n$/, "").concat("<task type=\"auto\"><name>Half");
  const cutErrs = await errs(cut);
  assert.ok(cutErrs.includes("Truncated: file ends inside a tag"), cutErrs.join("\n"));
  assert.ok(cutErrs.includes("Truncated: <tasks> is not closed"));
  assert.ok((await errs(plan({ tasks: okTask }) + "\n<!-- gsd:write-continue -->\n")).includes("Truncated: write-continue sentinel present"));
  assert.ok((await warns(plan({ tasks: okTask.replace("<done>d</done>", "") }))).includes("Task 1 (T): missing <done>"));
  assert.ok((await warns(plan({ tasks: okTask.replace('type="auto"', 'type="tdd"') }))).some((w) => w.includes("unknown task type tdd")));
  assert.ok((await warns(plan({ wave: 2, tasks: okTask }))).includes("wave 2 with empty depends_on"));
  assert.ok((await warns(plan({ tasks: okTask.replace("<files>", '<reversibility rating="one-way">x</reversibility><files>') }))).some((w) => w.includes("one-way reversibility")));
  assert.ok((await warns(plan({ tasks: [okTask, okTask, okTask, okTask].join("\n") }))).some((w) => w.includes("4 tasks > gsd.plan_limits.tasks_per_plan 3")));
  assert.ok((await warns(plan({ tasks: okTask.replace("cmd: node src/a.js", "test: x") }))).some((w) => w.includes("outside the verify vocabulary")));
  assert.ok((await errs(plan({ tasks: okTask, files: "[src/z.js]" }))).some((e) => e.includes("files_modified outside owns: src/z.js")));
});

// A fixture adapter written only from the ADPT-15 contract.
const RESOLVER = `import fs from "node:fs"; import path from "node:path";
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const r = JSON.parse(s);
  const mode = process.env.HOOK_MODE;
  if (mode === "garbage") { console.log("not json"); return; }
  if (mode === "v2") { console.log(JSON.stringify({ v: 2, results: [] })); return; }
  if (mode === "sleep") { setTimeout(() => {}, 60000); return; }
  if (r.op === "shared") { console.log(JSON.stringify({ v: 1, shared: r.paths.filter((p) => p.endsWith(".cfg")) })); return; }
  const results = r.targets.map((t) => ({ target: t, status: fs.existsSync(path.join(r.codeRoot, t)) ? "ok" : r.filesModified.includes(t) ? "pending_creation" : "missing" }));
  console.log(JSON.stringify({ v: 1, results }));
});
`;
const adapterOverlay = (extra = {}) => ({
  adapter: {
    verify_vocabulary: {
      build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
      check: { prefix: "check:", parser: null, resolver: "hooks/resolve.mjs", runner: null, evidence_parser: null, exit_code_sufficient: true },
    },
    hook_timeout_s: 2,
    ...extra,
  },
});

test("GSDC-19 verify-command-paths: pending_creation, pending_shared, unregistered kind, broken resolvers unresolvable", async () => {
  const obligations = (cmds) => cmds.map((c, i) => task(`<name>T${i}</name><action>a</action><verify><automated>${c}</automated><fails_when>x</fails_when></verify>`)).join("\n");
  const files = {
    "hooks/resolve.mjs": RESOLVER,
    "src/a.js": "",
    [`${P1}/01-01-PLAN.md`]: plan({ files: "[src/a.js, src/new.js]", tasks: obligations(["check: src/a.js", "check: src/new.js", "check: src/shared.js", "check: src/none.js", "foo: x", "build", "MISSING - Wave 0"]) }),
    [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[src/b.js]", owns: '["Path:src/b.js"]', tasks: `${obligations(["build"])}\n<shared_changes>src/shared.js: add an export</shared_changes>` }),
  };
  const p = project({ files, overlay: adapterOverlay() });
  const r = await gsd(p, ["check", "verify-command-paths", "1"]);
  assert.equal(r.code, 0);
  const by = (cmd) => r.json.commands.find((c) => c.command === cmd);
  assert.equal(by("check: src/a.js").status, "ok");
  assert.equal(by("check: src/new.js").status, "pending_creation");
  assert.deepEqual([by("check: src/shared.js").status, by("check: src/shared.js").severity], ["pending_shared", "none"]);
  assert.equal(by("check: src/none.js").severity, "blocker");
  assert.deepEqual([by("foo: x").status, by("foo: x").severity], ["missing", "blocker"]);
  assert.equal(by("MISSING - Wave 0").kind, "sentinel");
  for (const mode of ["garbage", "v2", "sleep"]) {
    process.env.HOOK_MODE = mode;
    const bad = await gsd(p, ["check", "verify-command-paths", "1", "--plans", "01"]).finally(() => delete process.env.HOOK_MODE);
    const row = bad.json.commands.find((c) => c.command === "check: src/a.js");
    assert.deepEqual([row.status, row.severity], ["unresolvable", "warning"], mode);
  }
  assert.equal((await gsd(project(), ["check", "verify-command-paths", "1"])).code, 69);
});

test("GSDC-20 verify-failure-directions: restatement warns, missing blocks", async () => {
  const t = (fw) => task(`<name>T</name><action>a</action><verify><automated>cmd: node x.js</automated>${fw}</verify>`);
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ tasks: [t("<fails_when>fails</fails_when>"), t(""), t("<fails_when>TBD</fails_when>"), t("<fails_when>prints NaN</fails_when>")].join("\n") }) } });
  const c = (await gsd(p, ["check", "verify-failure-directions", "1"])).json.commands;
  assert.deepEqual(c.map((x) => [x.status, x.severity]), [["restatement", "warning"], ["missing", "blocker"], ["rejected", "blocker"], ["stated", "none"]]);
});

const CONTEXT = "<decisions>\n### Storage\n- **D-01:** Use files\n- **D-02:** No database\n- **D-03 [informational]:** Note\n### Claude's Discretion\n- **D-04:** naming\n</decisions>\n";

test("GSDC-21 decision coverage names uncovered trackable decisions", async () => {
  const p = project({ files: { [`${P1}/01-CONTEXT.md`]: CONTEXT, [`${P1}/01-01-PLAN.md`]: plan().replace("Build part 01", "Build part 01 per D-01") } });
  const r = await gsd(p, ["check", "decision-coverage", "1"]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.uncovered, [{ id: "D-02", category: "Storage", text: "No database" }]);
  assert.equal((await gsd(p, ["check", "decision-coverage-verify", "1"])).code, 0);
  p.write(`${P1}/01-CONTEXT.md`, "<decisions>\n- **D1 bad** text\n</decisions>");
  const bad = await gsd(p, ["check", "decision-coverage", "1"]);
  assert.equal(bad.code, 1);
  assert.match(bad.json.message, /- \*\*D-NN:\*\* text/);
});

test("GSDC-22 check coverage fails on a requirement no plan claims", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ reqs: "[CORE-01, EXTRA-9]" }) } });
  const r = await gsd(p, ["check", "coverage", "1"]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.requirements.uncovered, ["CORE-02"]);
  assert.deepEqual(r.json.requirements.extra, ["EXTRA-9"]);
});

test("GSDC-23 check owns: overlapping owns, shared files by glob and by predicate hook", async () => {
  const files = {
    [`${P1}/01-01-PLAN.md`]: plan({ files: "[a/x.txt]", owns: '["Path:a/"]' }),
    [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[a/b.txt]", owns: '["Path:a/b.txt"]' }),
    "a/x.txt": "",
    "a/b.txt": "",
  };
  const r = await gsd(project({ files }), ["check", "owns", "1"]);
  assert.equal(r.code, 1);
  assert.ok(r.json.problems.some((x) => x.kind === "overlapping-owns"));
  const pkg = { [`${P1}/01-01-PLAN.md`]: plan({ files: "[pkg/a.lock, pkg/c.cfg]", owns: '["Path:pkg/"]' }), "pkg/a.lock": "", "pkg/c.cfg": "", "hooks/resolve.mjs": RESOLVER };
  const globbed = await gsd(project({ files: pkg, overlay: { adapter: { ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: ["**/*.lock"], predicate: "hooks/resolve.mjs" }, source_roots: [] } } } }), ["check", "owns", "1"]);
  const kinds = globbed.json.problems.map((x) => `${x.kind}:${x.file}`);
  assert.ok(kinds.includes("shared-file:pkg/a.lock"), kinds.join());
  assert.ok(kinds.includes("shared-file:pkg/c.cfg"), kinds.join());
  assert.ok(kinds.some((k) => k.startsWith("owns-shared:")));
  assert.equal((await gsd(project({ files: { ...pkg, [`${P1}/01-01-PLAN.md`]: plan({ files: "[pkg/x.js]", owns: '["Path:pkg/"]' }) } }), ["check", "owns", "1"])).code, 0, "defaults have no shared files");
});

const outline = (rows, marker = true) => `# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n${rows.map((r) => `| ${r.reqs ?? "CORE-01"} | \`${r.id}\` | ${r.wave ?? 1} | ${r.obj ?? "do"} | ${r.deps ?? "none"} |`).join("\n")}\n\n${marker ? "## OUTLINE COMPLETE\n" : ""}`;
const manifest = (plans) => JSON.stringify({ phase: "01", plans: plans.map((p) => ({ owns: [`Path:src/${p.id}/`], requirements: p.reqs ?? ["CORE-01"], produces: [], consumes: [], tracer: { is: false }, verify: [], ...p })) });

test("GSDC-24 outline parse: reordered columns, backticked ids, completion marker", async () => {
  const p = project({ files: { [`${P1}/01-PLAN-OUTLINE.md`]: outline([{ id: "01-01", deps: "none" }, { id: "01-02", wave: 2, deps: "01-01", reqs: "CORE-01, CORE-02" }]), [`${P1}/01-PLAN-OUTLINE.manifest.json`]: "{bad" } });
  const r = (await gsd(p, ["outline", "parse", "1"])).json;
  assert.equal(r.complete, true);
  assert.deepEqual(r.rows[1], { id: "01-02", objective: "do", wave: 2, depends_on: ["01-01"], requirements: ["CORE-01", "CORE-02"] });
  assert.match(r.manifestError, /not valid JSON/);
  p.write(`${P1}/01-PLAN-OUTLINE.md`, outline([{ id: "01-01" }], false));
  assert.equal((await gsd(p, ["outline", "parse", "1"])).json.complete, false);
  assert.equal((await gsd(p, ["outline", "parse", "2"])).code, 66);
});

test("GSDC-25 outline check: error classes, plan limits, tracer rules, needsWiring", async () => {
  const check = async (rows, plans, args = []) => {
    const p = project({ files: { [`${P1}/01-PLAN-OUTLINE.md`]: outline(rows), [`${P1}/01-PLAN-OUTLINE.manifest.json`]: manifest(plans) } });
    return (await gsd(p, ["outline", "check", "1", ...args])).json;
  };
  const rows = [{ id: "01-01", reqs: "CORE-01" }, { id: "01-02", wave: 2, deps: "01-01", reqs: "CORE-02" }];
  const plans = [{ id: "01-01", tracer: { is: true, outcome: "core runs end to end" } }, { id: "01-02", reqs: ["CORE-02"], consumes: [{ plan: "01-01", symbol: "start" }] }];
  const good = await check(rows, [{ ...plans[0], produces: [{ symbol: "start", kind: "fn", header: "src/a.js" }] }, plans[1]]);
  assert.equal(good.passed, true, good.errors.join("\n"));
  assert.equal(good.needsWiring, true);
  assert.equal((await check(rows, plans, ["--tracer", "false"])).warnings.some((w) => w.includes("not in 01-01 produces")), true);
  const errorOf = async (r, m, args) => (await check(r, m, args)).errors;
  assert.ok((await errorOf([...rows, { id: "01-02" }], plans)).includes("duplicate plan id 01-02"));
  assert.ok((await errorOf([{ id: "1-1" }, rows[1]], plans)).some((e) => e.startsWith("malformed plan id 1-1")));
  assert.ok((await errorOf([{ ...rows[0], obj: "" }, rows[1]], plans)).includes("01-01: empty objective"));
  assert.ok((await errorOf([rows[0], { ...rows[1], deps: "01-09" }], plans)).includes("01-02: depends on unknown plan 01-09"));
  assert.ok((await errorOf([rows[0], { ...rows[1], wave: 1 }], plans)).includes("01-02: depends on 01-01 in the same or a later wave"));
  assert.ok((await errorOf([rows[0]], [plans[0]])).includes("ROADMAP requirement CORE-02 is assigned to no plan"));
  assert.ok((await errorOf(rows, [plans[0]])).includes("manifest has no entry for 01-02"));
  assert.ok((await errorOf(rows, [plans[0], { ...plans[1], owns: [] }])).includes("01-02: empty owns"));
  assert.ok((await errorOf(rows, [plans[0], { ...plans[1], consumes: [{ plan: "01-07", symbol: "x" }] }])).includes("01-02: consumes from unknown plan 01-07"));
  assert.ok((await errorOf([rows[0], { id: "01-02", reqs: "CORE-02" }], [plans[0], { ...plans[1], owns: ["Path:src/01-01/x.js"], consumes: [] }])).some((e) => e.includes("overlapping owns")));
  assert.ok((await errorOf(rows, [{ ...plans[0], tracer: { is: false } }, plans[1]])).includes("tracer mode: no manifest plan has tracer.is"));
  assert.ok((await errorOf(rows, [{ ...plans[0], tracer: { is: true } }, plans[1]])).includes("01-01: tracer plan lacks tracer.outcome"));
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `01-${String(i + 1).padStart(2, "0")}`, reqs: "CORE-01, CORE-02" }));
  const manyPlans = many.map((r, i) => ({ id: r.id, reqs: ["CORE-01", "CORE-02"], ...(i === 0 ? { tracer: { is: true, outcome: "o" } } : {}) }));
  assert.ok((await errorOf(many, manyPlans)).includes("13 plans > plans_per_phase 12"));
  assert.equal((await check(many, manyPlans, ["--plans-per-phase", "15"])).passed, true);
  const fiveWaves = Array.from({ length: 5 }, (_, i) => ({ id: `01-0${i + 1}`, wave: i + 1, deps: i ? `01-0${i}` : "none", reqs: "CORE-01, CORE-02" }));
  const fivePlans = fiveWaves.map((r, i) => ({ id: r.id, reqs: ["CORE-01", "CORE-02"], ...(i === 0 ? { tracer: { is: true, outcome: "o" } } : {}) }));
  assert.ok((await errorOf(fiveWaves, fivePlans)).includes("5 waves > waves_per_phase 4"));
});

test("GSDC-26 waves: a gap subset may depend on executed plans; same-wave file overlap fails", async () => {
  const files = { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-02-PLAN.md`]: plan({ id: "02", wave: 2, depends: "[01-01]", files: "[src/c.js]", owns: '["Path:src/c.js"]' }), [`${P1}/01-03-PLAN.md`]: plan({ id: "03", wave: 2, depends: "[01-01]", files: "[src/c.js]", owns: '["Path:src/d.js"]' }) };
  const p = project({ files });
  const all = await gsd(p, ["waves", "1"]);
  assert.equal(all.code, 1);
  assert.ok(all.json.errors.some((e) => e.includes("both modify src/c.js")));
  const gap = await gsd(p, ["waves", "1", "--plans", "01-02"]);
  assert.equal(gap.code, 0, JSON.stringify(gap.json));
});

test("GSDC-27 handoff: tracer alone first in per-wave mode; tracer with a dependency refused; batch keeps waves", async () => {
  const tracerTask = task("<name>Slice</name><files>src/t.js</files><action>a</action><verify><automated>cmd: node src/t.js</automated><fails_when>x</fails_when></verify><done>d</done>", "tracer");
  const files = {
    [`${P1}/01-01-PLAN.md`]: plan({ files: "[src/t.js]", owns: '["Path:src/t.js"]', tasks: tracerTask }),
    [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[src/b.js]", owns: '["Path:src/b.js"]' }),
    [`${P1}/01-03-PLAN.md`]: plan({ id: "03", files: "[src/c.js]", owns: '["Path:src/c.js"]' }),
    [`${P1}/01-04-PLAN.md`]: plan({ id: "04", wave: 2, depends: "[01-02]", files: "[src/d.js]", owns: '["Path:src/d.js"]' }),
  };
  const p = project({ files, overlay: { gsd: { roles: { executor: { model: "pro", effort: "high" } } } } });
  const r = await gsd(p, ["handoff", "1"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.waves.map((w) => w.tasks), [["01-01"], ["01-02", "01-03"], ["01-04"]]);
  const w1 = p.readJson(`${P1}/handoff/w1.args.json`);
  assert.deepEqual([w1.wave, w1.waveId, w1.gsdPhase, w1.planWave, w1.executionMode], [1, "gsd-01-w1", "01", 1, "per-wave"]);
  const t = w1.tasks[0];
  assert.deepEqual(t.owns, ["Path:src/t.js", "Path:.planning/phases/01-core/01-01-SUMMARY.md"]);
  assert.deepEqual([t.key, t.tracer, t.role, t.model, t.effort, t.summary], ["plan-01-01", true, "executor", "pro", "high", ".planning/phases/01-core/01-01-SUMMARY.md"]);
  assert.equal(t.planHash.length, 12);
  assert.deepEqual([t.plan, t.planPath], ["01-01", ".planning/phases/01-core/01-01-PLAN.md"]);
  assert.deepEqual(t.verify[0], { task: 1, kind: "cmd", command: "cmd: node src/t.js", target: "node src/t.js" });
  const batch = project({ files, overlay: { gsd: { execution_mode: "batch" } } });
  assert.deepEqual((await gsd(batch, ["handoff", "1"])).json.waves.map((w) => w.tasks), [["01-01", "01-02", "01-03"], ["01-04"]]);
  const bad = project({ files: { ...files, [`${P1}/01-01-PLAN.md`]: plan({ files: "[src/t.js]", owns: '["Path:src/t.js"]', depends: "[01-02]", wave: 2, tasks: tracerTask }) } });
  const refused = await gsd(bad, ["handoff", "1"]);
  assert.equal(refused.code, 1);
  assert.ok(refused.json.errors.some((e) => e.includes("tracer plan depends on")));
  const gap = await gsd(p, ["handoff", "1", "--plans", "04", "--prefix", "gap"]);
  assert.equal(gap.json.waves[0].argsFile, ".planning/phases/01-core/handoff/gap-w1.args.json");
  assert.ok(fs.existsSync(p.path(`${P1}/handoff/w3.args.json`)), "unprefixed handoff kept");
});

test("GSDC-35 verify artifacts and key-links: path_rejected, pattern_neutralized, pending", async () => {
  const extra = `  artifacts:\n    - path: src/a.js\n      min_lines: 1\n      contains: hello\n    - path: ../outside.js\n  key_links:\n    - from: ../outside\n      to: src/a.js\n    - from: src/a.js\n      to: src/b.js\n      pattern: "(?=hello)"\n    - from: src/later.js\n      to: src/a.js\n    - from: src/a.js\n      to: hello\n`;
  const files = { [`${P1}/01-01-PLAN.md`]: plan({ extra }), [`${P1}/01-02-PLAN.md`]: plan({ id: "02", wave: 2, depends: "[01-01]", files: "[src/later.js]", owns: '["Path:src/later.js"]' }), "src/a.js": "hello\n" };
  const p = project({ files });
  const a = (await gsd(p, ["verify", "artifacts", "1", "--plans", "01"])).json;
  assert.deepEqual(a.results.map((r) => r.status), ["passed", "path_rejected"]);
  const k = (await gsd(p, ["verify", "key-links", "1", "--plans", "01"])).json;
  assert.deepEqual(k.results.map((r) => r.status), ["path_rejected", "pattern_neutralized", "pending", "verified"]);
  assert.equal((await gsd(p, ["verify", "artifacts", "1", "--plans", "02"])).code, 66);
});
