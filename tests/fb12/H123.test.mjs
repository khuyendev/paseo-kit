// Kit feedback 123 (H123) and WildEraV6 9. F1: a recorded hand edit of a committed plan is committed at the resume
// gate, before any agent. F2: an unowned stop names the hand-edit record. F3: hand-edit.record warns when the plan is
// committed. F4: the commit answer also names commit adopt. F5: hand-edit.attach gives the file to a plan that is not
// committed yet. W9: a halt cleared without --resume redispatches when the SUMMARY is halted or older than the answer.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { sha256 } from "../../ship/.agents/harness/lib/hash.mjs";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { gsd, P1, plan, project } from "../gsd-core/fixture.mjs";
import { executor, makeExecWorld, task } from "../gsd-flows/exec-world.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = PHASE_DIR;
const sum = (id) => `${PD}/${id}-SUMMARY.md`;

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const exec = (w, args = {}, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PD, ...args }, gsd: w.gsd, agent: executor(w, overrides) });
const digestOf = (w, rel) => sha256(fs.readFileSync(path.join(w.root, rel)));
const writeJson = (w, rel, value) => w.write(rel, `${JSON.stringify(value, null, 2)}\n`);
const edit = (id, file, digest, extra = {}) => ({ id, key: `owned:${extra.plan ?? "01-01"}`, kind: "owned", files: [file], digest, at: "2026-10-24T00:00:00.000Z", category: "other", note: "by hand", ...extra });

function twoPlans(owns = '["Path:src/a.js"]') {
  return project({ files: {
    [`${P1}/01-01-PLAN.md`]: plan({ id: "01", owns }),
    [`${P1}/01-02-PLAN.md`]: plan({ id: "02", owns }),
    "src/a.js": "base\n",
  } });
}

test("H123 F3 hand-edit.record warns when every owner is committed, and names attach when one is not", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ id: "01", owns: '["Path:src/a.js"]' }), "src/a.js": "hand\n" } });
  p.writeJson(`${P1}/commits.json`, [{ sha: "abc1234", plans: { "01-01": ["src/a.js"] } }]);
  const logged = await gsd(p, ["hand-edit", "record", "1", "src/a.js", "--category", "other", "--note", "analyzer info"]);
  assert.equal(logged.code, 0, JSON.stringify(logged.json));
  assert.match(logged.json.warning, /HE-1: src\/a.js belongs to committed plan 01-01/);
  assert.match(logged.json.next, /follow-up of 01-01/);
  assert.match(logged.json.next, /before any agent/);

  const both = twoPlans();
  both.writeJson(`${P1}/commits.json`, [{ sha: "abc1234", plans: { "01-01": ["src/a.js"] } }]);
  both.write("src/a.js", "hand\n");
  const mixed = await gsd(both, ["hand-edit", "record", "1", "src/a.js", "--category", "test-fixture", "--note", "shared file"]);
  assert.equal(mixed.code, 0, JSON.stringify(mixed.json));
  assert.match(mixed.json.warning, /01-02/);
  assert.match(mixed.json.warning, /not committed/);
  assert.match(mixed.json.next, /ph gsd hand-edit\.attach 01 HE-1 --plan <id>/);

  const open = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ id: "01", owns: '["Path:src/a.js"]' }), "src/a.js": "hand\n" } });
  const quiet = await gsd(open, ["hand-edit", "record", "1", "src/a.js", "--category", "other", "--note", "not committed yet"]);
  assert.equal(quiet.code, 0, JSON.stringify(quiet.json));
  assert.equal(quiet.json.warning, undefined);
});

test("H123 F5 hand-edit.attach records the plan, and refuses a committed plan or a missing edit", async () => {
  const p = twoPlans();
  p.writeJson(`${P1}/commits.json`, [{ sha: "abc1234", plans: { "01-01": ["src/a.js"] } }]);
  p.write("src/a.js", "hand\n");
  await gsd(p, ["hand-edit", "record", "1", "src/a.js", "--category", "other", "--note", "shared file"]);
  const committed = await gsd(p, ["hand-edit", "attach", "1", "HE-1", "--plan", "01-01"]);
  assert.equal(committed.code, 1);
  assert.match(committed.json.error, /01-01 is committed/);
  assert.match(committed.json.error, /commit adopt/);
  const ok = await gsd(p, ["hand-edit", "attach", "1", "src/a.js", "--plan", "01-02"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.attached, ["HE-1"]);
  assert.equal(ok.json.plan, "01-02");
  assert.equal(ok.json.file, "src/a.js");
  assert.match(ok.json.next, /commit of 01-02 takes src\/a.js/);
  assert.equal(p.readJson(`${P1}/hand-edits.json`).edits[0].attached, "01-02");
  const missing = await gsd(p, ["hand-edit", "attach", "1", "HE-9", "--plan", "01-02"]);
  assert.equal(missing.code, 1);
  assert.match(missing.json.error, /no hand edit HE-9/);
  const noPlan = await gsd(p, ["hand-edit", "attach", "1", "HE-1", "--plan", "01-09"]);
  assert.equal(noPlan.code, 1);
  assert.match(noPlan.json.error, /no plan 01-09/);
});

test("H123 F1 exec-hand-follow lists only a digest-matching owned edit whose owners are all committed", async () => {
  const p = makeTempProject({ files: { "src/a.js": "old\n", "src/b.js": "b\n", [`${PD}/.keep`]: "" } });
  await flow(p.root, ["baseline", PD]);
  p.write("src/a.js", "new\n");
  p.write("src/b.js", "newb\n");
  const a = digestOf({ root: p.root }, "src/a.js");
  const plans = [{ id: "01-01", owns: ["Path:src/a.js", "Path:src/b.js"], wave: 1 }, { id: "01-02", owns: ["Path:src/b.js"], wave: 2 }];
  p.writeJson(`${PD}/commits.json`, [{ sha: "abc1234", plans: { "01-01": ["src/a.js"] } }]);
  p.writeJson(`${PD}/hand-edits.json`, { v: 2, edits: [
    edit("HE-1", "src/a.js", a),
    edit("HE-2", "src/b.js", digestOf({ root: p.root }, "src/b.js"), { plan: "01-02" }),
    edit("HE-3", "src/a.js", "deadbeef"),
  ] });
  const r = await flow(p.root, ["exec-hand-follow", PD], { plans });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.follow, [{ plans: ["01-01"], wave: 1, files: [{ path: "src/a.js", id: "HE-1" }] }]);
  assert.deepEqual(r.json.held, [{ path: "src/b.js", id: "HE-2", committed: ["01-01"], open: ["01-02"] }]);
  p.writeJson(`${PD}/hand-edits.json`, { v: 2, edits: [{ ...edit("HE-1", "src/a.js", a), attached: "01-02" }] });
  const skipped = await flow(p.root, ["exec-hand-follow", PD], { plans });
  assert.deepEqual(skipped.json.follow, []);
});

test("H123 F2 exec-hand-names matches the bytes; F5 attach is skipped by the resume gate and taken by owned-changes", async () => {
  const p = makeTempProject({ files: { "src/a.js": "old\n", "lib/stray.txt": "s\n", [`${PD}/.keep`]: "" } });
  await flow(p.root, ["baseline", PD]);
  p.write("src/a.js", "new\n");
  p.write("lib/stray.txt", "stray\n");
  const stray = digestOf({ root: p.root }, "lib/stray.txt");
  p.writeJson(`${PD}/hand-edits.json`, { v: 2, edits: [
    edit("HE-4", "lib/stray.txt", stray, { key: "file:lib/stray.txt" }),
    { ...edit("HE-5", "src/a.js", digestOf({ root: p.root }, "src/a.js")), attached: "01-02" },
  ] });
  const names = await flow(p.root, ["exec-hand-names", PD], { paths: ["lib/stray.txt", "src/missing.js"] });
  assert.deepEqual(names.json.named, [{ path: "lib/stray.txt", id: "HE-4" }]);
  const plans = [
    { id: "01-01", owns: ["Path:src/a.js"], summary: sum("01-01"), complete: true },
    { id: "01-02", owns: ["Path:src/a.js"], summary: sum("01-02"), complete: false },
  ];
  const gate = await flow(p.root, ["resume-gate", PD], { plans });
  assert.deepEqual(gate.json.problems.map((x) => x.path), ["lib/stray.txt"], JSON.stringify(gate.json.problems));
  const oc = await flow(p.root, ["owned-changes", PD], { plans: [plans[1]], pending: [plans[0]] });
  assert.deepEqual(oc.json.files["01-02"], ["src/a.js"]);
  assert.deepEqual(oc.json.unowned, ["lib/stray.txt"]);
  const seed = await flow(p.root, ["exec-hand-seed", PD], { plans: ["01-02", "01-01"] });
  assert.deepEqual(seed.json.byPlan["01-02"], [{ path: "src/a.js", sha256: digestOf({ root: p.root }, "src/a.js") }]);
  assert.equal(seed.json.byPlan["01-01"], undefined);
});

test("H123 F5 a resumed gate names hand-edit.attach for a matching edit owned by a committed plan and an open one", async () => {
  const p = makeTempProject({ files: { "src/a.js": "old\n", [`${PD}/.keep`]: "" } });
  await flow(p.root, ["baseline", PD]);
  p.write("src/a.js", "new\n");
  p.writeJson(`${PD}/hand-edits.json`, { v: 2, edits: [edit("HE-8", "src/a.js", digestOf({ root: p.root }, "src/a.js"))] });
  const plans = [
    { id: "01-01", owns: ["Path:src/a.js"], summary: sum("01-01"), complete: true },
    { id: "01-02", owns: ["Path:src/a.js"], summary: sum("01-02"), complete: false },
  ];
  const gate = await flow(p.root, ["resume-gate", PD], { plans });
  assert.equal(gate.code, 1);
  assert.equal(gate.json.problems[0].kind, "ambiguous owner");
  assert.equal(gate.json.problems[0].handEdit, "HE-8");
  assert.equal(gate.json.answer.verb, "hand-edit.attach");
  assert.match(gate.json.answer.command, /^ph gsd hand-edit\.attach 01 HE-8 --plan <id>, then rerun/);
});

test("H123 W9 exec-summary-result: halted or older than the answer is prior; a later non-halted SUMMARY is not", async () => {
  const p = makeTempProject({ files: { [`${PD}/01-01-SUMMARY.md`]: "---\nstatus: halted\n---\nold\n", [`${PD}/.keep`]: "" } });
  const summary = path.join(p.root, PD, "01-01-SUMMARY.md");
  p.writeJson(`${PD}/halt-answers.json`, [{ plan: "01-01", answer: "finish both tasks", at: "2000-01-01T00:00:00.000Z" }]);
  const halted = await flow(p.root, ["exec-summary-result", PD], { plans: ["01-01"] });
  assert.deepEqual(halted.json.prior, ["01-01"]);
  fs.writeFileSync(summary, "---\nstatus: complete\n---\ndone\n");
  const newer = await flow(p.root, ["exec-summary-result", PD], { plans: ["01-01"] });
  assert.deepEqual(newer.json.prior, [], "a SUMMARY written after the answer is a result");
  p.writeJson(`${PD}/halt-answers.json`, [{ plan: "01-01", answer: "finish both tasks", at: "2099-01-01T00:00:00.000Z" }]);
  const older = await flow(p.root, ["exec-summary-result", PD], { plans: ["01-01"] });
  assert.deepEqual(older.json.prior, ["01-01"], "older than the halt answer, even when status is complete");
  p.writeJson(`${PD}/halt-answers.json`, [{ plan: "01-01", answer: "stands", at: "2099-01-01T00:00:00.000Z", resume: true }]);
  const resumed = await flow(p.root, ["exec-summary-result", PD], { plans: ["01-01"] });
  assert.deepEqual(resumed.json.prior, []);
});

test("H123 F5 transfer carries an attached path that is not in owns and does not refuse the main-tree hand edit", async () => {
  const p = makeTempProject({ files: { "src/a/x.js": "old\n", [`${PD}/.keep`]: "" } });
  await flow(p.root, ["baseline", PD]);
  p.write("src/a/x.js", "hand\n");
  p.writeJson(`${PD}/hand-edits.json`, { v: 2, edits: [{ ...edit("HE-1", "src/a/x.js", digestOf({ root: p.root }, "src/a/x.js")), attached: "03-01" }] });
  const dir = path.join(makeTempDir(), "wt");
  p.git("worktree", "add", "-q", "-b", "harness/h123", dir);
  fs.writeFileSync(path.join(dir, "src/a/x.js"), "hand\n");
  const r = await flow(p.root, ["transfer", PD], { plan: "03-01", worktree: dir, owns: ["Path:src/b/"], summary: `${PD}/03-01-SUMMARY.md` });
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.ok(r.json.files.some((f) => f.path === "src/a/x.js"), JSON.stringify(r.json.files));
  assert.equal(p.read("src/a/x.js"), "hand\n");
});

const sharedOwns = (id) => ["Path:src/" + id + "/", "Path:src/shared.js", sum(id)];

test("H123 F1 the resume gate commits a hand edit of a committed plan before the next wave's executor", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  const first = await exec(w, { stopAfterWave: 1 });
  assert.equal(first.result.status, "paused", JSON.stringify(first.result));
  const file = "src/01-01/impl.js";
  w.write(file, "impl 01-01\nhand\n");
  writeJson(w, `${PD}/hand-edits.json`, { v: 2, edits: [edit("HE-8", file, digestOf(w, file))] });
  const second = await exec(w);
  assert.equal(second.result.status, "executed", JSON.stringify(second.result));
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-01").length, 0);
  assert.equal(second.calls.filter((c) => c.opts.label === "exec-01-02").length, 1);
  const ev = second.result.events;
  assert.ok(ev.findIndex((e) => e.startsWith("hand-edit HE-8")) < ev.findIndex((e) => e.includes("01-02") && e.startsWith("code")), ev.join("\n"));
  assert.ok(second.logs.some((l) => /hand edit HE-8: src\/01-01\/impl.js committed as a follow-up of 01-01/.test(l)), second.logs.join("\n"));
  const commits = JSON.parse(w.read(`${PD}/commits.json`));
  const row = commits.find((c) => (c.handEdit ?? []).includes("HE-8"));
  assert.deepEqual(row.plans["01-01"], [file]);
  assert.equal(w.git("status", "--porcelain", "--", file).stdout.trim(), "");
  assert.match(w.git("log", "--format=%B").stdout, /fix\(01-01\): hand edit HE-8[\s\S]*Plans: 01-01/);
});

test("H123 F1 a follow-up commit that fails stops before any agent and names commit and commit adopt", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")], [task("01-02")]] });
  assert.equal((await exec(w, { stopAfterWave: 1 })).result.status, "paused");
  const file = "src/01-01/impl.js";
  w.write(file, "impl 01-01\nhand\n");
  writeJson(w, `${PD}/hand-edits.json`, { v: 2, edits: [edit("HE-8", file, digestOf(w, file))] });
  w.gsd.on("commit", (argv) => (String(argv[0]).includes("hand edit") ? { code: 1, json: { committed: false, error: "hook denied" } } : { code: 1, json: { committed: false, error: "unexpected commit" } }));
  const r = await exec(w);
  assert.equal(r.result.status, "needs-owner");
  assert.equal(r.result.stage, "Execute");
  assert.match(r.result.reason, /HE-8/);
  assert.match(r.result.reason, /hook denied/);
  assert.match(r.result.answer.command, /commit src\/01-01\/impl.js/);
  assert.match(r.result.answer.command, /ph gsd commit adopt 01 <sha>/);
  assert.equal(r.calls.filter((c) => c.opts.label === "exec-01-02").length, 0);
});

test("H123 F2 F4 an unowned path names its hand-edit record, and the commit option names commit adopt", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const text = "stray\n";
  const file = "lib/stray.txt";
  w.write(file, text);
  const digest = digestOf(w, file);
  fs.rmSync(path.join(w.root, file));
  writeJson(w, `${PD}/hand-edits.json`, { v: 2, edits: [edit("HE-3", file, digest, { key: "file:lib/stray.txt" })] });
  const r = await exec(w, {}, { "exec-01-01": async (...a) => { const v = await executor(w)(...a); w.write(file, text); return v; } });
  assert.equal(r.result.status, "needs-owner", JSON.stringify(r.result));
  assert.equal(r.result.stage, "Execute");
  assert.match(r.result.reason, /recorded hand edit HE-3 \(lib\/stray.txt\)/);
  assert.match(r.result.options[0], /^commit them separately/);
  assert.match(r.result.options[0], /ph gsd commit adopt 01 <sha> --reason "<why the commit stands>", then rerun/);
  assert.equal(r.result.answer.verb, "fix-and-rerun");
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("review-")).length, 0);
});

test("H123 F5 a file owned by a committed plan and a later plan is not a follow-up; attach makes that plan's commit take it", async () => {
  const w = makeExecWorld({ waves: [[task("01-01", { owns: sharedOwns("01-01") })], [task("01-02", { owns: sharedOwns("01-02") })]] });
  assert.equal((await exec(w, { stopAfterWave: 1 })).result.status, "paused");
  w.write("src/shared.js", "hand\n");
  const digest = digestOf(w, "src/shared.js");
  writeJson(w, `${PD}/hand-edits.json`, { v: 2, edits: [edit("HE-8", "src/shared.js", digest)] });
  const stopped = await exec(w);
  assert.equal(stopped.result.status, "needs-owner", JSON.stringify(stopped.result));
  assert.match(stopped.result.reason, /safe-resume gate/);
  assert.equal(stopped.result.answer.verb, "hand-edit.attach");
  assert.match(stopped.result.answer.command, /ph gsd hand-edit\.attach 01 HE-8 --plan <id>/);
  assert.equal(stopped.calls.filter((c) => c.opts.label === "exec-01-02").length, 0, "no agent before the stop");
  const [row] = JSON.parse(w.read(`${PD}/hand-edits.json`)).edits;
  writeJson(w, `${PD}/hand-edits.json`, { v: 2, edits: [{ ...row, attached: "01-02" }] });
  const ran = await exec(w);
  assert.equal(ran.result.status, "executed", JSON.stringify(ran.result));
  assert.equal(ran.logs.some((l) => /committed as a follow-up/.test(l)), false);
  const commits = JSON.parse(w.read(`${PD}/commits.json`));
  const wave2 = commits.find((c) => c.plans?.["01-02"]);
  assert.ok(wave2.plans["01-02"].includes("src/shared.js"), JSON.stringify(wave2.plans));
  assert.equal(w.git("status", "--porcelain", "--", "src/shared.js").stdout.trim(), "");
});

function haltedSummary(w, id, { status = "halted", at = "2099-01-01T00:00:00.000Z", answer = "finish tasks 1 and 2", resume = false } = {}) {
  w.write(sum(id), `---\nstatus: ${status}\nkey-files:\n  created: []\n---\n${status}\n`);
  writeJson(w, `${PD}/halt-answers.json`, [{ plan: id, halt: "tasks blocked", answer, at, ...(resume ? { resume: true } : {}) }]);
}

test("H123 W9 a halt cleared without --resume runs the executor again when the SUMMARY is halted or older than the answer", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  haltedSummary(w, "01-01");
  const again = await exec(w);
  assert.equal(again.result.status, "executed", JSON.stringify(again.result));
  assert.equal(again.calls.filter((c) => c.opts.label === "exec-01-01").length, 1);
  assert.match(again.calls.find((c) => c.opts.label === "exec-01-01").prompt, /finish tasks 1 and 2/);
  assert.ok(again.logs.some((l) => /01-01: SUMMARY is a previous attempt/.test(l)), again.logs.join("\n"));
  assert.equal(again.logs.some((l) => /SUMMARY present but not committed/.test(l)), false);

  const older = makeExecWorld({ waves: [[task("01-01")]] });
  haltedSummary(older, "01-01", { status: "complete" });
  const redo = await exec(older);
  assert.equal(redo.calls.filter((c) => c.opts.label === "exec-01-01").length, 1, "older than the halt answer, so not a result");

  const fresh = makeExecWorld({ waves: [[task("01-01")]] });
  haltedSummary(fresh, "01-01", { status: "complete", at: "2000-01-01T00:00:00.000Z" });
  const rejoin = await exec(fresh);
  assert.equal(rejoin.result.status, "executed", JSON.stringify(rejoin.result));
  assert.equal(rejoin.calls.filter((c) => c.opts.label === "exec-01-01").length, 0);
  assert.ok(rejoin.logs.some((l) => /SUMMARY present but not committed/.test(l)), rejoin.logs.join("\n"));
});

test("H123 W9 the graph schedule redispatches a halted SUMMARY the same way", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]], overlay: { gsd: { execute_schedule: "graph" } } });
  haltedSummary(w, "01-01", { answer: "do task 2" });
  const r = await exec(w);
  assert.equal(r.result.status, "executed", JSON.stringify(r.result));
  assert.equal(r.calls.filter((c) => c.opts.label === "exec-01-01").length, 1);
  assert.match(r.calls.find((c) => c.opts.label === "exec-01-01").prompt, /do task 2/);
});
