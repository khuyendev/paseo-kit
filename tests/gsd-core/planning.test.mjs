import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { P1, gsd, plan, project, ROADMAP, summary, writeVerification } from "./fixture.mjs";

const executed = (extra = {}) => project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), "src/a.js": "x\n", ...extra } });

async function statusOf(p) {
  const f = (await gsd(p, ["find-phase", "1"])).json.status;
  const a = (await gsd(p, ["roadmap", "analyze"])).json.phases[0].status;
  assert.equal(f, a, "find-phase and roadmap analyze agree");
  return f;
}

test("GSDC-01 init.project initialization predicate and the adopted tree only", async () => {
  const empty = project({ files: { ".planning/ROADMAP.md": null, ".planning/REQUIREMENTS.md": null, ".planning/PROJECT.md": null, ".planning/phases/01-core/.keep": null, ".planning/phases/02-api/.keep": null, ".planning/phases/03-ui/.keep": null, ".planning/.keep": "" } });
  const r = await gsd(empty, ["init.project"]);
  assert.deepEqual([r.json.initialized, r.json.missing], [false, ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"]]);
  const p = project({ files: { ".planning/STATE.md": "---\nstatus: Planning\n---\n" } });
  assert.equal((await gsd(p, ["init.project"])).json.initialized, false, "STATE without gsd_state_version");
  assert.equal((await gsd(p, ["state", "init"])).code, 1, "STATE exists already");
  fs.rmSync(p.path(".planning/STATE.md"));
  assert.equal((await gsd(p, ["state", "init"])).code, 0);
  assert.equal((await gsd(p, ["init.project"])).json.initialized, true);
  await gsd(p, ["phase", "add", "Extra"]);
  await gsd(p, ["state", "decision", "--text", "use x"]);
  await gsd(p, ["revisions", "record", "1", "research"]);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [e.name + "/", ...walk(path.join(d, e.name)).map((x) => `${e.name}/${x}`)] : [e.name]));
  const tree = walk(p.path(".planning"));
  for (const bad of ["config.json", "todos/", "threads/", "seeds/", "workstreams/", "MILESTONES.md"]) assert.ok(!tree.includes(bad), `${bad} created`);
  const code = fs.readdirSync(path.resolve("ship/.agents/harness/gsd")).map((f) => fs.readFileSync(path.resolve("ship/.agents/harness/gsd", f), "utf8")).join("\n");
  assert.doesNotMatch(code, /\.planning\/config\.json"|"config\.json"/);
});

test("GSDC-06 find-phase resolves decimal phases; list-plans omits the outline", async () => {
  const p = project({ files: { ".planning/phases/01.1-x/01.1-01-PLAN.md": plan({ phase: "01.1" }), ".planning/phases/01.1-x/01.1-PLAN-OUTLINE.md": "| Plan ID |\n", [`${P1}/01-PLAN-OUTLINE.md`]: "x", [`${P1}/01-01-PLAN.md`]: plan() } });
  const r = await gsd(p, ["find-phase", "1.1"]);
  assert.equal(r.json.directory, ".planning/phases/01.1-x");
  assert.deepEqual((await gsd(p, ["phase", "list-plans", "1"])).json.plans, ["01-01"]);
  assert.deepEqual((await gsd(p, ["phase", "list-plans", "01.1"])).json.plans, ["01.1-01"]);
});

test("GSDC-07 roadmap get-phase parses the upstream template form and warns on malformed requirement lines", async () => {
  const p = project({ roadmap: ROADMAP.replace("**Requirements**: API-01", "**Requirements**: API-01; API-02") });
  const r = await gsd(p, ["roadmap", "get-phase", "1"]);
  assert.deepEqual([r.json.phase_name, r.json.goal, r.json.requirements, r.json.success_criteria, r.json.depends_on], ["Core", "Core works", ["CORE-01", "CORE-02"], ["Core runs", "Core is tested"], []]);
  const two = await gsd(p, ["roadmap", "get-phase", "2"]);
  assert.equal(two.json.warnings[0].kind, "req-line-misparse");
  assert.ok(two.json.warnings[0].tokens.includes("API-02"));
  assert.deepEqual(two.json.requirements, ["API-01", "API-02"]);
  assert.deepEqual((await gsd(p, ["roadmap", "get-phase", "3"])).json.requirements, []);
  assert.equal((await gsd(p, ["roadmap", "get-phase", "7"])).code, 66);
});

test("GSDC-08 analyze reports checkbox conflicts; annotate-dependencies is idempotent", async () => {
  const p = project({ roadmap: ROADMAP.replace("- [ ] **Phase 1: Core**", "- [x] **Phase 1: Core**"), files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-02-PLAN.md`]: plan({ id: "02", wave: 2, depends: "[01-01]", files: "[src/b.js]", owns: '["Path:src/b.js"]' }) } });
  const a = (await gsd(p, ["roadmap", "analyze"])).json;
  assert.deepEqual(a.checkbox_conflict.map((c) => c.phase), ["1"]);
  assert.equal(a.phases[0].plans, 2);
  assert.equal(a.phases[0].verification, "missing");
  assert.equal(a.next_phase, "2");
  assert.equal((await gsd(p, ["roadmap", "annotate-dependencies", "1"])).json.changed, true);
  const once = p.read(".planning/ROADMAP.md");
  assert.match(once, /Wave 2 \(blocked on Wave 1\): 01-02/);
  assert.match(once, /Core runs \(01-01, 01-02\)/);
  assert.equal((await gsd(p, ["roadmap", "annotate-dependencies", "1"])).json.changed, false);
  assert.equal(p.read(".planning/ROADMAP.md"), once);
});

test("GSDC-09 table and bullet forms parse alike; adapter id regex; unknown id refused", async () => {
  const table = "| ID | Spec | Rule | Phase | Status |\n|---|---|---|---|---|\n| CORE-01 | - | Core starts | Phase 1 | Pending |\n| CORE-02 | - | Core stops | Phase 1 | Pending |\n";
  const bullets = "- [ ] **CORE-01**: Core starts\n- [ ] **CORE-02**: Core stops\n\n| Requirement | Phase | Status |\n|---|---|---|\n| CORE-01 | Phase 1 | Pending |\n| CORE-02 | Phase 1 | Pending |\n";
  const view = async (req) => (await gsd(project({ requirements: req }), ["requirements", "list"])).json.requirements.map(({ id, text, phase, complete }) => ({ id, text, phase, complete }));
  assert.deepEqual(await view(table.replace(/\| - \|/g, "|  |")), await view(bullets));
  const custom = project({ requirements: "- [ ] **auth:R1**: x\n", overlay: { gsd: { requirement_id_regex: "^[a-z]+:R\\d+$" } } });
  assert.equal((await gsd(custom, ["requirements", "list"])).json.requirements[0].valid_id, true);
  const p = project();
  const before = p.read(".planning/REQUIREMENTS.md");
  const bad = await gsd(p, ["requirements", "mark-complete", "X-99"]);
  assert.equal(bad.code, 1);
  assert.match(bad.json.error, /X-99/);
  assert.equal(p.read(".planning/REQUIREMENTS.md"), before);
  assert.equal((await gsd(p, ["requirements", "mark-complete", "[CORE-01, CORE-02]"])).code, 0);
  const after = p.read(".planning/REQUIREMENTS.md");
  assert.match(after, /- \[x\] \*\*CORE-01\*\*/);
  assert.match(after, /\| CORE-02 \| Phase 1 \| Complete \|/);
  await gsd(p, ["requirements", "revert", "1"]);
  assert.match(p.read(".planning/REQUIREMENTS.md"), /- \[ \] \*\*CORE-01\*\*.*\n[\s\S]*\| CORE-01 \| Phase 1 \| Pending \|/);
});

test("GSDC-13 phase status ladder truth table through find-phase and roadmap analyze", async () => {
  assert.equal(await statusOf(project()), "NOT_STARTED");
  assert.equal(await statusOf(project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } })), "PLANNED");
  assert.equal(await statusOf(project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-02-PLAN.md`]: plan({ id: "02" }), [`${P1}/01-01-SUMMARY.md`]: summary("01") } })), "IN_PROGRESS");
  assert.equal(await statusOf(project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-02-PLAN.md`]: plan({ id: "02" }), [`${P1}/01-01-SUMMARY.md`]: summary("01"), [`${P1}/01-02-HALT.json`]: "{}" } })), "IN_PROGRESS");
  assert.equal(await statusOf(executed()), "EXECUTED", "missing report");
  const invalid = executed();
  await writeVerification(invalid, "Passed");
  assert.equal(await statusOf(invalid), "EXECUTED", "invalid report");
  const stale = executed();
  await writeVerification(stale, "passed");
  stale.write("src/a.js", "changed\n");
  assert.equal(await statusOf(stale), "NEEDS_REVIEW", "stale");
  const gaps = executed();
  await writeVerification(gaps, "gaps_found", { gaps: ["g"] });
  assert.equal(await statusOf(gaps), "NEEDS_REVIEW");
  const human = executed();
  await writeVerification(human, "human_needed", { human: ["h"] });
  assert.equal(await statusOf(human), "NEEDS_REVIEW");
  const passed = executed();
  const sha = await writeVerification(passed, "passed");
  assert.equal(await statusOf(passed), "EXECUTED", "passed without completion record");
  passed.write(`${P1}/complete.json`, JSON.stringify({ verification_sha: sha }));
  assert.equal(await statusOf(passed), "COMPLETE");
  const nine = (await gsd(project(), ["find-phase", "9"])).json;
  assert.deepEqual([nine.plan_count, nine.summary_count, nine.plan_count_all], [null, null, null]);
});

test("GSDC-14 a roadmap that cannot be read fully is truncated with null percentages", async () => {
  const p = project({ roadmap: ROADMAP.replace("- [ ] **Phase 3: Ui** - the ui", "- [ ] **Phase 3: Ui** - the ui\n- [ ] **Phase 4: Lost** - no section") });
  const a = (await gsd(p, ["roadmap", "analyze"])).json;
  assert.equal(a.scope, "truncated");
  assert.equal(a.progress_percent, null);
  const ok = (await gsd(project(), ["roadmap", "analyze"])).json;
  assert.deepEqual([ok.scope, ok.progress_percent], ["complete", 0]);
  const st = project({ roadmap: ROADMAP.replace("- [ ] **Phase 3: Ui** - the ui", "- [ ] **Phase 3: Ui** - the ui\n- [ ] **Phase 4: Lost** - x") });
  await gsd(st, ["state", "init"]);
  const r = await gsd(st, ["state", "position", "--activity", "x"]);
  assert.match(st.read(".planning/STATE.md"), /percent: null/);
  assert.ok(r.err.some((l) => /percentage withheld/.test(l)));
});

test("GSDC-36 phase-plan-index: dependents of a halted plan are blocked", async () => {
  const files = { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-02-PLAN.md`]: plan({ id: "02", wave: 2, depends: "[01-01]" }), [`${P1}/01-03-PLAN.md`]: plan({ id: "03", wave: 2, depends: "[01-01, 01-09]" }), [`${P1}/01-01-HALT.json`]: "{}" };
  const p = project({ files });
  const r = (await gsd(p, ["phase-plan-index", "1"])).json;
  assert.deepEqual(r.plans.find((x) => x.id === "01-02").blocked_by, ["01-01"]);
  assert.deepEqual(r.runnable, []);
  assert.ok(r.warnings.some((w) => w.includes("01-09")));
  fs.rmSync(p.path(`${P1}/01-01-HALT.json`));
  assert.deepEqual((await gsd(p, ["phase-plan-index", "1"])).json.runnable, ["01-01"]);
});

test("GSDC-37 read verbs never write; validate plan-gap-closure", async () => {
  const p = executed();
  const snap = () => JSON.stringify(fs.readdirSync(p.path(".planning"), { recursive: true }).map((f) => [f, fs.statSync(p.path(`.planning/${f}`)).isFile() ? p.read(`.planning/${f}`) : ""]));
  const before = snap();
  const reads = [["frontmatter", "get", `${P1}/01-01-PLAN.md`, "wave"], ["frontmatter", "validate", `${P1}/01-01-PLAN.md`, "--schema", "plan"], ["phase", "list-plans", "1"], ["phase", "list-artifacts", "1"], ["summary-extract", ".planning/phases/*/*-SUMMARY.md", "--fields", "key-files"], ["history-digest"], ["state", "load"]];
  for (const argv of reads) assert.equal((await gsd(p, argv)).code, 0, argv.join(" "));
  assert.equal(snap(), before);
  assert.equal((await gsd(p, ["frontmatter", "get", `${P1}/01-01-PLAN.md`, "wave"])).json.value, 1);
  assert.equal((await gsd(p, ["frontmatter", "validate", `${P1}/01-01-PLAN.md`, "--schema", "plan-gap-closure"])).code, 1);
  assert.equal((await gsd(p, ["phase", "list-artifacts", "2"])).code, 66);
  assert.deepEqual((await gsd(p, ["history-digest"])).json.phases[0].summaries[0]["key-files"], { created: ["src/a.js"], modified: [] });
});
