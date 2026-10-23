// Kit feedback 73 and 68: a record without --settings keeps the workflow's settings digest, and what changed outside the flow is
// listed, logged with its cause category, counted by review-stats and reported by the plan and execute runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";
import { testEnv } from "../helpers/env.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { executor, makeExecWorld } from "../gsd-flows/exec-world.mjs";
import { makeWorld, PHASE_DIR } from "../gsd-flows/world.mjs";
import { setup } from "../workflow/helpers.mjs";
import { meta } from "../workflow/helpers.mjs";

const PLAN1 = `${P1}/01-01-PLAN.md`;
const PLAN2 = `${P1}/01-02-PLAN.md`;
const OUTLINE = `${P1}/01-PLAN-OUTLINE.md`;
const rec = (p, key, ...more) => gsd(p, ["revisions", "record", "1", key, ...more]);
const chk = (p, key, ...more) => gsd(p, ["revisions", "check", "1", key, ...more]);
const scan = (p) => gsd(p, ["hand-edit", "scan", "1"]);
const logEdit = (p, ref, category, note = "fixed by hand", env) => gsd(p, ["hand-edit", "record", "1", ref, "--category", category, "--note", note], env ? { env } : {});
const settingsOf = (p, key) => p.readJson(`${P1}/revisions.json`).keys[key].parts.settings;
const proj = () => project({ files: { [PLAN1]: plan({ id: "01" }), [PLAN2]: plan({ id: "02", files: "[src/b.js]", owns: "[\"Path:src/b.js\"]" }), [OUTLINE]: "# outline\n" } });
const workflowEnv = () => testEnv({ PASEO_HARNESS_WORKFLOW_RUN: "wf_test" });

// ---- 73 ----

test("P68 a hand record of a plan keeps the settings digest of its previous record, so the workflow's check still matches", async () => {
  const p = proj();
  await rec(p, "plan:01-01", "--settings", "S-plan");
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  assert.equal((await chk(p, "plan:01-01", "--settings", "S-plan")).code, 1, "the edit moves the hash");
  const r = await rec(p, "plan:01-01");
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.settings, { digest: "S-plan", source: "previous record" });
  assert.equal(r.json.warnings, undefined);
  assert.equal(settingsOf(p, "plan:01-01"), "S-plan");
  assert.equal((await chk(p, "plan:01-01", "--settings", "S-plan")).code, 0, "the next run keeps the hand-edited plan");
});

test("P68 a plan never recorded takes the digest of another plan record; a settings change by --settings still wins", async () => {
  const p = proj();
  await rec(p, "plan:01-01", "--settings", "S-plan");
  const r = await rec(p, "plan:01-02");
  assert.deepEqual(r.json.settings, { digest: "S-plan", source: "record of plan:01-01" });
  assert.equal((await chk(p, "plan:01-02", "--settings", "S-plan")).code, 0);
  const explicit = await rec(p, "plan:01-02", "--settings", "S-new");
  assert.deepEqual(explicit.json.settings, { digest: "S-new", source: "argument" });
  assert.equal(settingsOf(p, "plan:01-02"), "S-new");
});

test("P68 freeze and checked keep their own digest; keys without settings get none and no warning", async () => {
  const p = proj();
  await rec(p, "freeze", "--settings", "S-freeze");
  await rec(p, "checked", "--settings", "S-checked");
  assert.equal((await rec(p, "freeze")).json.settings.digest, "S-freeze");
  assert.equal((await rec(p, "checked")).json.settings.digest, "S-checked");
  const inputs = await rec(p, "inputs");
  assert.equal(inputs.json.settings, null);
  assert.equal(inputs.json.warnings, undefined);
  assert.equal(inputs.err.length, 0);
  assert.equal(p.readJson(`${P1}/revisions.json`).keys.inputs.parts.settings, undefined);
});

test("P68 a plan record with no digest anywhere warns that the workflow's check will not match", async () => {
  const p = proj();
  const r = await rec(p, "plan:01-01");
  assert.equal(r.code, 0);
  assert.equal(r.json.settings, null);
  assert.match(r.json.warnings[0], /plan:01-01 recorded without a settings part.*--settings/);
  assert.ok(r.err.some((l) => /warning: plan:01-01 recorded without a settings part/.test(l)));
  assert.equal((await chk(p, "plan:01-01", "--settings", "S-plan")).code, 1);
});

// ---- 68: detection ----

test("P68 a hand revisions record keeps the plan edit as a pending hand edit; owner inputs and workflow records do not", async () => {
  const p = proj();
  await rec(p, "plan:01-01", "--settings", "S");
  await rec(p, "inputs");
  p.write(`${P1}/01-CONTEXT.md`, "<decisions>\n- **D-01:** owner changed it\n</decisions>\n");
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  await rec(p, "inputs");
  assert.equal(fs.existsSync(path.join(p.root, P1, "hand-edits.json")), false, "an owner input is no hand fix");
  const r = await rec(p, "plan:01-01");
  assert.equal(r.code, 0);
  const edits = p.readJson(`${P1}/hand-edits.json`).edits;
  assert.equal(edits.length, 1);
  assert.deepEqual({ id: edits[0].id, key: edits[0].key, kind: edits[0].kind, files: edits[0].files, category: edits[0].category }, { id: "HE-1", key: "plan:01-01", kind: "plan", files: [PLAN1], category: null });
  // The same change recorded by a workflow run is the flow's own write.
  p.write(PLAN2, `${plan({ id: "02" })}\nplanner revision\n`);
  await rec(p, "plan:01-02", "--settings", "S");
  p.write(PLAN2, `${plan({ id: "02" })}\nplanner revision 2\n`);
  await gsd(p, ["revisions", "record", "1", "plan:01-02", "--settings", "S"], { env: workflowEnv() });
  assert.equal(p.readJson(`${P1}/hand-edits.json`).edits.length, 1);
});

test("P68 gsd.review_metrics false keeps a hand record from writing the log", async () => {
  const p = project({ files: { [PLAN1]: plan({ id: "01" }) }, overlay: { gsd: { review_metrics: false } } });
  await rec(p, "plan:01-01", "--settings", "S");
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  await rec(p, "plan:01-01");
  assert.equal(fs.existsSync(path.join(p.root, P1, "hand-edits.json")), false);
});

test("P68 scan lists a plan and an artifact changed since their record once, and an owned file changed since its transfer", async () => {
  const p = project({ files: { [PLAN1]: plan({ id: "01" }), [OUTLINE]: "# outline\n", "src/a.js": "v1\n" } });
  await rec(p, "freeze", "--settings", "S");
  await rec(p, "plan:01-01", "--settings", "S");
  await rec(p, "checked", "--settings", "S");
  const none = await scan(p);
  assert.deepEqual({ code: none.code, pending: none.json.pending, new: none.json.new }, { code: 0, pending: [], new: 0 });
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  p.write(OUTLINE, "# outline\nhand fix\n");
  const first = await scan(p);
  assert.equal(first.json.new, 2);
  const byFile = Object.fromEntries(first.json.pending.map((e) => [e.files[0], e]));
  assert.equal(byFile[PLAN1].key, "plan:01-01", "a plan is claimed by its own key, not by checked");
  assert.equal(byFile[PLAN1].kind, "plan");
  assert.equal(byFile[OUTLINE].key, "freeze");
  assert.equal(byFile[OUTLINE].kind, "artifact");
  assert.match(first.json.ask, /hand-edit record 01 <id> --category contract-drift\|wrong-api\|owns-reach\|test-fixture\|other/);
  const again = await scan(p);
  assert.equal(again.json.new, 0);
  assert.equal(again.json.pending.length, 2);
  // A transfer record names path and hash: a later edit of the file is a hand edit.
  const { sha256 } = await import("../../ship/.agents/harness/lib/hash.mjs");
  p.writeJson(`${P1}/transfers/01-01.json`, { plan: "01-01", files: [{ path: "src/a.js", sha256: sha256(Buffer.from("v1\n")) }] });
  assert.equal((await scan(p)).json.new, 0, "unchanged since the transfer");
  p.write("src/a.js", "v2 by hand\n");
  const owned = await scan(p);
  assert.equal(owned.json.new, 1);
  assert.deepEqual(owned.json.pending.filter((e) => e.kind === "owned").map((e) => [e.key, e.files[0]]), [["owned:01-01", "src/a.js"]]);
});

// ---- 68: the cause log ----

test("P68 hand-edit record answers an edit by id, key or file, and refuses a bad category, an empty or multi-line note", async () => {
  const p = project({ files: { [PLAN1]: plan({ id: "01" }), [OUTLINE]: "# outline\n" } });
  await rec(p, "freeze", "--settings", "S");
  await rec(p, "plan:01-01", "--settings", "S");
  p.write(PLAN1, `${plan({ id: "01" })}\nhand fix\n`);
  p.write(OUTLINE, "# outline\nhand fix\n");
  await scan(p);
  assert.equal((await logEdit(p, "HE-1", "typo")).code, 1);
  assert.equal((await gsd(p, ["hand-edit", "record", "1", "HE-1", "--category", "wrong-api"])).code, 1, "no note");
  assert.equal((await logEdit(p, "HE-1", "wrong-api", "line one\nline two")).code, 1);
  const byId = await logEdit(p, "HE-1", "contract-drift", "03-07 read a removed path");
  assert.equal(byId.code, 0);
  assert.deepEqual({ logged: byId.json.logged, category: byId.json.category, count: byId.json.count }, { logged: ["HE-1"], category: "contract-drift", count: 1 });
  const byKey = await logEdit(p, "plan:01-01", "other", "plan wording");
  assert.deepEqual(byKey.json.logged, ["HE-2"]);
  const again = await logEdit(p, "HE-1", "other");
  assert.equal(again.code, 1);
  assert.match(again.json?.error ?? again.err.join(" "), /already logged/);
  const list = await gsd(p, ["hand-edit", "list", "1"]);
  assert.equal(list.json.pending, 0);
  assert.deepEqual(list.json.edits.map((e) => [e.id, e.category, e.note]), [["HE-1", "contract-drift", "03-07 read a removed path"], ["HE-2", "other", "plan wording"]]);
  assert.equal((await scan(p)).json.pending.length, 0, "an answered edit is not asked again");
});

test("P68 a hand fix nobody scanned can be logged after the fact by plan key or file", async () => {
  const p = project({ files: { [PLAN1]: plan({ id: "01" }), "src/a.js": "x\n" } });
  const plan1 = await logEdit(p, "plan:01-01", "owns-reach", "owns missed the barrel file");
  assert.equal(plan1.code, 0);
  const file = await logEdit(p, "src/a.js", "test-fixture", "fixture path");
  assert.equal(file.code, 0);
  assert.equal((await logEdit(p, "src/missing.js", "other", "x")).code, 1);
  assert.deepEqual(p.readJson(`${P1}/hand-edits.json`).edits.map((e) => [e.key, e.kind, e.category]), [["plan:01-01", "plan", "owns-reach"], ["file:src/a.js", "owned", "test-fixture"]]);
});

test("P68 a category logged twice in the project is a kit defect candidate in the scan and record results; other never is", async () => {
  const p = project({ files: { [PLAN1]: plan({ id: "01" }), [PLAN2]: plan({ id: "02" }), ".planning/phases/02-api/02-01-PLAN.md": plan({ phase: "02", id: "01" }) } });
  const first = await logEdit(p, "plan:01-01", "contract-drift", "first");
  assert.deepEqual(first.json.candidates, []);
  const second = await gsd(p, ["hand-edit", "record", "2", "plan:02-01", "--category", "contract-drift", "--note", "second, another phase"]);
  assert.equal(second.json.count, 2);
  assert.equal(second.json.candidates.length, 1);
  assert.match(second.json.candidates[0], /^kit defect candidate: contract-drift seen 2 times \(phase 01, 02\)/);
  assert.deepEqual((await scan(p)).json.candidates, second.json.candidates);
  await logEdit(p, "plan:01-02", "other", "a");
  await logEdit(p, "src/none", "other", "b").catch(() => null);
  await gsd(p, ["hand-edit", "record", "2", ".planning/phases/02-api/02-01-PLAN.md", "--category", "other", "--note", "c"]);
  assert.equal((await scan(p)).json.candidates.length, 1);
});

// ---- 68: review-stats ----

test("P68 review-stats counts the hand fixes per category and phase and prints the defect candidate", async () => {
  const s = setup({ git: true });
  const edit = (id, cat, note) => ({ id, key: "plan:x", kind: "plan", files: ["f"], digest: "d", at: "t", category: cat, note });
  s.project.writeJson(".planning/phases/03-core/hand-edits.json", { v: 1, edits: [edit("HE-1", "contract-drift", "a"), edit("HE-2", "contract-drift", "b"), edit("HE-3", "wrong-api", "c"), edit("HE-4", null, null)] });
  s.project.writeJson(".planning/phases/04-ui/hand-edits.json", { v: 1, edits: [edit("HE-1", "owns-reach", "d"), edit("HE-2", "other", "e"), edit("HE-3", "other", "f")] });
  const r = await s.ph(["review-stats"]);
  assert.equal(r.code, 0, r.stderr);
  const out = r.out.join("\n");
  assert.match(out, /hand fixes 6, 1 not logged yet \(ph gsd hand-edit record <phase> <id> --category [^)]*\): contract-drift 2, wrong-api 1, owns-reach 1, other 2/);
  assert.match(out, /phase 03: hand fixes 3, 1 not logged \(contract-drift 2, wrong-api 1\)/);
  assert.match(out, /phase 04: hand fixes 3 \(owns-reach 1, other 2\)/);
  assert.match(out, /kit defect candidate: contract-drift seen 2 times \(phase 03\): a \| b/);
  assert.equal(/candidate: other/.test(out), false);
  const one = await s.ph(["review-stats", "--phase", "4"]);
  assert.equal(/hand fixes 3 \(|kit defect candidate/.test(one.out.join("\n")), false);
  assert.match(one.out.join("\n"), /hand fixes 3: owns-reach 1, other 2/);
});

test("P68 review-stats without hand edits prints no hand fix line and an unreadable log is counted, not fatal", async () => {
  const s = setup({ git: true });
  s.project.write(".planning/phases/03-core/hand-edits.json", "{ nope");
  const r = await s.ph(["review-stats"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out.some((l) => l.startsWith("hand fixes")), false);
  assert.ok(r.out.some((l) => /skipped .*1 unreadable hand-edit entries/.test(l)), r.out.join("\n"));
});

// ---- 68: the engine marks its shell calls, the flows report ----

test("P68 the workflow engine sets PASEO_HARNESS_WORKFLOW_RUN for its shell calls", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}await shell(["node", "-e", "require('fs').writeFileSync('env.txt', process.env.PASEO_HARNESS_WORKFLOW_RUN ?? 'none')"]); return 1;`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_envtest"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(s.project.path("env.txt"), "utf8"), "wf_envtest");
});

const handScan = (pending, candidates = []) => ({ pending, candidates, logged: 0, new: pending.length, ...(pending.length ? { ask: "say why each was changed: ph gsd hand-edit record 1 <id> --category x --note y" } : {}) });
const EDIT = { id: "HE-1", key: "plan:01-01", kind: "plan", files: [PLAN1], at: "t" };

test("P68 gsd-plan lists the hand edits and the defect candidates in its log and result, and goes on", async () => {
  const w = makeWorld();
  w.gsd.on("hand-edit", () => handScan([EDIT], ["kit defect candidate: contract-drift seen 2 times (phase 01)"]));
  const r = await runScript("gsd-plan", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: async () => null });
  assert.deepEqual(w.gsd.callsOf("hand-edit").map((c) => c.argv), [["hand-edit", "scan", PHASE_DIR]]);
  assert.deepEqual(r.result.handEdits.pending, [EDIT]);
  assert.equal(r.result.handEdits.candidates.length, 1);
  assert.match(r.result.handEdits.ask, /hand-edit record 1 <id>/);
  assert.ok(r.logs.some((l) => /hand edit HE-1 \(plan:01-01\): /.test(l)), r.logs.join("\n"));
  assert.ok(r.logs.some((l) => /warning: 1 hand edits since the last record; say why/.test(l)));
  assert.ok(r.logs.some((l) => /warning: kit defect candidate: contract-drift seen 2 times/.test(l)));
});

test("P68 gsd-plan with nothing to report, an unavailable verb or review_metrics off adds nothing", async () => {
  const quiet = makeWorld();
  quiet.gsd.on("hand-edit", () => handScan([]));
  const a = await runScript("gsd-plan", { root: quiet.root, args: { phaseDir: PHASE_DIR }, gsd: quiet.gsd, agent: async () => null });
  assert.equal(a.result.handEdits, undefined);
  const missing = makeWorld();
  const b = await runScript("gsd-plan", { root: missing.root, args: { phaseDir: PHASE_DIR }, gsd: missing.gsd, agent: async () => null });
  assert.equal(b.result.handEdits, undefined);
  const off = makeWorld({ overlay: { gsd: { review_metrics: false } } });
  off.gsd.on("hand-edit", () => handScan([EDIT]));
  const c = await runScript("gsd-plan", { root: off.root, args: { phaseDir: PHASE_DIR }, gsd: off.gsd, agent: async () => null });
  assert.equal(c.result.handEdits, undefined);
  assert.equal(off.gsd.callsOf("hand-edit").length, 0);
});

test("P68 gsd-execute lists the hand edits in its log and result and runs on; review_metrics off does not scan", async () => {
  const w = makeExecWorld();
  w.gsd.on("hand-edit", () => handScan([{ ...EDIT, kind: "owned", key: "owned:01-01", files: ["src/01-01/a.js"] }]));
  const r = await runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, {}) });
  assert.equal(r.result.status, "executed");
  assert.deepEqual(r.result.handEdits.pending.map((e) => e.key), ["owned:01-01"]);
  assert.ok(r.logs.some((l) => /hand edit HE-1 \(owned:01-01\): src\/01-01\/a\.js/.test(l)), r.logs.join("\n"));
  const off = makeExecWorld({ overlay: { gsd: { review_metrics: false } } });
  off.gsd.on("hand-edit", () => handScan([EDIT]));
  const o = await runScript("gsd-execute", { root: off.root, args: { phaseDir: PHASE_DIR }, gsd: off.gsd, agent: executor(off, {}) });
  assert.equal(o.result.status, "executed");
  assert.equal(o.result.handEdits, undefined);
  assert.equal(off.gsd.callsOf("hand-edit").length, 0);
});
