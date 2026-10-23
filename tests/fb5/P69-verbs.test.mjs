// Kit feedback #69, #76 (P69): gsd.files_per_plan and the files-per-plan rule of `outline check`, the tracer flag of
// `check owns`, and the revisions key `checkedbody` (a plan without its write sets).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR, makeTempProject } from "../helpers/temp.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { validateAgainstSchema } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";

const OUTLINE = "# Outline\n\n| Requirements | Plan ID | Wave | Objective | Depends on |\n|---|---|---|---|---|\n| CORE-01 | `01-01` | 1 | do | none |\n| CORE-02 | `01-02` | 1 | do | none |\n\n## OUTLINE COMPLETE\n";
const owns = (n, dir = "a") => Array.from({ length: n }, (_, i) => `Path:src/${dir}/f${i}.js`);
const entry = (id, ownList, extra = {}) => ({ id, owns: ownList, requirements: [id === "01-01" ? "CORE-01" : "CORE-02"], produces: [], consumes: [], tracer: { is: false }, verify: [], ...extra });
const outlineProject = (plans, overlay) => project({
  files: { [`${P1}/01-PLAN-OUTLINE.md`]: OUTLINE, [`${P1}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify({ phase: "01", plans }) },
  overlay,
});
const check = (p, ...more) => gsd(p, ["outline", "check", "1", "--tracer", "false", ...more]);

test("P69 gsd.files_per_plan defaults to null, takes {warning, blocker} and rejects anything else", () => {
  const { _notes, ...defaults } = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), "utf8"));
  assert.equal(defaults.gsd.files_per_plan, null);
  assert.equal(defaults.gsd.checker_reallocate, 0);
  assert.equal(defaults.gsd.checker_recheck, "full");
  const set = (gsdPart) => validateAgainstSchema({ ...defaults, gsd: { ...defaults.gsd, ...gsdPart } });
  assert.doesNotThrow(() => set({ files_per_plan: { warning: 20, blocker: 30 }, checker_reallocate: 2, checker_recheck: "incremental" }));
  assert.throws(() => set({ files_per_plan: { warning: 20 } }), /files_per_plan/);
  assert.throws(() => set({ files_per_plan: { warning: 0, blocker: 3 } }), /files_per_plan/);
  assert.throws(() => set({ checker_reallocate: 3 }), /checker_reallocate/);
  assert.throws(() => set({ checker_recheck: "partial" }), /checker_recheck/);
});

test("P69 outline check: a plan owning 15 paths is an error, 10 a warning, fewer nothing; a directory counts once", async () => {
  const r = await check(outlineProject([entry("01-01", owns(15)), entry("01-02", owns(10, "b"))]));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.errors, ["01-01: owns 15 paths, blocker at 15+ (split the plan or move owned paths to another plan; gsd.files_per_plan sets the lines)"]);
  assert.deepEqual(r.json.warnings.filter((w) => /owns \d+ paths/.test(w)), ["01-02: owns 10 paths, warning at 10+"]);
  assert.deepEqual(r.json.files_per_plan, { warning: 10, blocker: 15 });
  const ok = await check(outlineProject([entry("01-01", owns(14)), entry("01-02", [...owns(9, "b"), "Path:src/dir/"])]));
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.warnings.filter((w) => /owns \d+ paths/.test(w)), ["01-01: owns 14 paths, warning at 10+", "01-02: owns 10 paths, warning at 10+"]);
});

test("P69 outline check: the phase average raises the default lines; a set gsd.files_per_plan is used exactly", async () => {
  const dense = [entry("01-01", owns(30)), entry("01-02", owns(30, "b"))];
  // 60 paths over plans_per_phase 2 = average 30: the lines move to 31, so 30 paths pass.
  const avg = await check(outlineProject(dense), "--plans-per-phase", "2");
  assert.equal(avg.code, 0, JSON.stringify(avg.json));
  assert.deepEqual(avg.json.files_per_plan, { warning: 31, blocker: 31 });
  const exact = await check(outlineProject([entry("01-01", owns(6)), entry("01-02", owns(3, "b"))], { gsd: { files_per_plan: { warning: 4, blocker: 6 } } }));
  assert.deepEqual(exact.json.files_per_plan, { warning: 4, blocker: 6 });
  assert.equal(exact.code, 1);
  assert.match(exact.json.errors[0], /^01-01: owns 6 paths, blocker at 6\+/);
  const wide = await check(outlineProject([entry("01-01", owns(25)), entry("01-02", owns(3, "b"))], { gsd: { files_per_plan: { warning: 30, blocker: 40 } } }));
  assert.equal(wide.code, 0, JSON.stringify(wide.json));
});

test("P69 outline check: a tracer plan gets tracer_extra_files on both lines; --files-per-plan warn turns the error into a warning", async () => {
  const tracerPlan = entry("01-01", owns(17), { tracer: { is: true, outcome: "x" } });
  const plans = [tracerPlan, entry("01-02", owns(2, "b"))];
  const noExtra = await check(outlineProject(plans, { gsd: { tracer_extra_files: 0 } }));
  assert.equal(noExtra.code, 1);
  const extra = await check(outlineProject(plans, { gsd: { tracer_extra_files: 3 } }), "--tracer", "true");
  assert.ok(extra.json.errors.every((e) => !/owns 17 paths/.test(e)), extra.json.errors.join("\n"));
  assert.ok(extra.json.warnings.includes("01-01: owns 17 paths, warning at 13+"), extra.json.warnings.join("\n"));
  const warn = await check(outlineProject(plans), "--files-per-plan", "warn");
  assert.deepEqual(warn.json.errors, []);
  assert.match(warn.json.warnings.find((w) => /owns 17 paths/.test(w)), /blocker at 15\+/);
  const bad = await check(outlineProject(plans), "--files-per-plan", "never");
  assert.notEqual(bad.code, 0);
});

test("P69 check owns: the lines follow gsd.files_per_plan and every plan says whether it is a tracer plan", async () => {
  const tracerTask = `<task type="tracer">\n  <name>Slice</name>\n  <files>src/a.js</files>\n  <action>Write it</action>\n  <verify>\n    <automated>cmd: node src/a.js</automated>\n    <fails_when>exits non-zero</fails_when>\n  </verify>\n  <done>works</done>\n</task>`;
  const files = { [`${P1}/01-01-PLAN.md`]: plan({ id: "01", tasks: tracerTask }), [`${P1}/01-02-PLAN.md`]: plan({ id: "02", files: "[src/b.js]", owns: "[\"Path:src/b.js\"]" }) };
  const r = await gsd(project({ files, overlay: { gsd: { files_per_plan: { warning: 5, blocker: 8 } } } }), ["check", "owns", "1"]);
  assert.deepEqual(r.json.files_per_plan, { warning: 5, blocker: 8 });
  assert.deepEqual(r.json.plans.map((x) => [x.id, x.tracer]), [["01-01", true], ["01-02", false]]);
  const d = await gsd(project({ files }), ["check", "owns", "1"]);
  assert.deepEqual(d.json.files_per_plan, { warning: 10, blocker: 15 });
});

test("P69 config: gsd.files_per_plan reaches the harness config from the overlay", () => {
  const p = makeTempProject({ git: false, overlay: { gsd: { files_per_plan: { warning: 7, blocker: 9 } } } });
  assert.deepEqual(loadConfig(p.root).gsd.files_per_plan, { warning: 7, blocker: 9 });
});

test("P69 revisions checkedbody: an owns or files_modified edit moves checked but not the body; a content edit moves both", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ id: "01" }), [`${P1}/01-02-PLAN.md`]: plan({ id: "02" }) } });
  await gsd(p, ["revisions", "record", "1", "checked"]);
  await gsd(p, ["revisions", "record", "1", "checkedbody"]);
  assert.equal((await gsd(p, ["revisions", "check", "1", "checkedbody"])).code, 0);
  const file1 = `${P1}/01-01-PLAN.md`;
  p.write(file1, plan({ id: "01", files: "[src/a.js, src/c.js]", owns: "[\"Path:src/a.js\", \"Path:src/c.js\"]" }));
  const moved = await gsd(p, ["revisions", "check", "1", "checked"]);
  assert.equal(moved.code, 1);
  assert.deepEqual(moved.json.changed, [file1]);
  assert.equal((await gsd(p, ["revisions", "check", "1", "checkedbody"])).code, 0, "a write-set edit leaves the body digest");
  p.write(file1, plan({ id: "01", reqs: "[CORE-02]" }));
  const edited = await gsd(p, ["revisions", "check", "1", "checkedbody"]);
  assert.equal(edited.code, 1);
  assert.deepEqual(edited.json.changed, [file1]);
  assert.notEqual((await gsd(p, ["revisions", "check", "1", "bogus"])).code, 0);
});
